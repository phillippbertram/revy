import { randomUUID } from 'node:crypto'
import type {
  AgentActivityEntry,
  AgentStatus,
  AppSettings,
  BootstrapState,
  ReadSourceInput,
  RepositorySnapshot,
  ReviewDocument,
  ReviewMetadata,
  ReviewProgress,
  ReviewRun,
  ReviewRunMetadata,
  ReviewRunStatus,
  ReviewRunSummary,
  ReviewRunUpdate,
  ReviewSummary,
  SourcePreview,
  UpdateRepositoryPreferencesInput,
  UpdateSettingsInput,
} from '../shared/contracts.js'
import { formatStructuredReviewMarkdown, parseStructuredReview } from '../shared/review-formats.js'
import {
  type BackendActivity,
  CodexAppServerBackend,
  type ReviewBackend,
} from './codex-app-server.js'
import { GitService } from './git-service.js'
import { createLogger, logError, setDebugLogging } from './logger.js'
import { SourceService } from './source-service.js'
import { AppStore } from './storage.js'

const logger = createLogger('service')

const disconnectedAgent: AgentStatus = {
  accountLabel: null,
  error: null,
  executable: null,
  models: [],
  state: 'unavailable',
  version: null,
}

function buildReviewPrompt(
  repository: RepositorySnapshot,
  settings: AppSettings,
  projectInstructions: string | null,
): string {
  return [
    '# Shippy review contract (highest priority)',
    'Review only. Do not edit, create, delete, format, stage, commit, or otherwise modify any repository file or Git state.',
    'Use only read-only inspection commands. Do not request approvals or expanded permissions.',
    `Inspect the complete change set against ${repository.baseBranch}: committed changes from its merge base to HEAD, staged changes, unstaged changes, and untracked files.`,
    'Focus on concrete defects, regressions, security issues, data loss, broken contracts, and important maintainability risks introduced by these changes.',
    'Return exactly one JSON object and nothing else. Do not use a Markdown code fence, raw HTML, or internal reasoning.',
    'The object must match this shape: {"version":1,"summary":"Short overall assessment","findings":[{"priority":"P1","title":"Concise title","bodyMarkdown":"Problem, impact, and actionable recommendation.","locations":[{"path":"src/example.ts","line":42,"endLine":51}],"links":[{"label":"Documentation","url":"https://example.com"}]}]}.',
    'Do not add fields. locations and links must always be JSON arrays; use an empty links array when there are no external references. endLine is optional for a single-line location.',
    'Use P0 only for a critical ship blocker such as data loss or a severe security issue. Use P1 for a significant defect or regression that must be fixed before shipping. Use P2 for a concrete medium-priority issue. Use P3 for a small but useful improvement; never report style-only noise.',
    'Every finding must have at least one actionable location. Paths must be repository-relative, use forward slashes, never be absolute, and never contain `.` or `..` segments.',
    'bodyMarkdown may use concise GitHub-flavoured Markdown but must not contain headings, raw HTML, repository-location links, or internal Shippy URLs.',
    'External links are optional. Include only HTTPS URLs that you actually observed or verified during the review; never invent a URL.',
    'If there are no actionable findings, return an empty findings array and say so briefly in summary.',
    '',
    '# Project review rules',
    projectInstructions ?? 'No additional project-specific review skill was selected.',
    '',
    '# Personal style',
    settings.personalInstructions.trim() || 'No additional personal instructions.',
  ].join('\n')
}

interface ActiveRun {
  itemSequences: Map<string, number>
  metadata: ReviewRunMetadata
  nextSequence: number
  writes: Promise<void>
}

export class ShippyService {
  private activeRun: ActiveRun | null = null
  private agent: AgentStatus = disconnectedAgent
  private agentRefresh: Promise<AgentStatus> | null = null
  private readonly backend: ReviewBackend
  private currentRepository: RepositorySnapshot | null = null
  private readonly git = new GitService()
  private reviewRunning = false
  private readonly source = new SourceService()
  private readonly store: AppStore

  constructor(
    userDataPath: string,
    private readonly publishProgress: (progress: ReviewProgress) => void,
    private readonly publishActivity: (update: ReviewRunUpdate) => void,
    backend: ReviewBackend = new CodexAppServerBackend(),
  ) {
    this.backend = backend
    this.store = new AppStore(userDataPath)
  }

  async getBootstrap(): Promise<BootstrapState> {
    await this.store.initialize()
    const settings = await this.store.getSettings()
    setDebugLogging(settings.debugLoggingEnabled)
    await this.refreshAgent()
    return { agent: this.agent, settings: await this.store.getSettings() }
  }

  async refreshAgent(): Promise<AgentStatus> {
    if (this.agentRefresh) {
      return this.agentRefresh
    }
    this.agentRefresh = this.refreshAgentOnce()
    try {
      return await this.agentRefresh
    } finally {
      this.agentRefresh = null
    }
  }

  private async refreshAgentOnce(): Promise<AgentStatus> {
    const settings = await this.store.getSettings()
    this.agent = await this.backend.probe(settings.codexExecutable)
    if (this.agent.state === 'ready' && this.agent.models.length > 0) {
      const selectedModel =
        this.agent.models.find((model) => model.id === settings.model) ??
        this.agent.models.find((model) => model.isDefault) ??
        this.agent.models[0]
      if (selectedModel) {
        const selectedEffort = selectedModel.supportedReasoningEfforts.some(
          (effort) => effort.reasoningEffort === settings.reasoningEffort,
        )
          ? settings.reasoningEffort
          : selectedModel.defaultReasoningEffort
        if (settings.model !== selectedModel.id || settings.reasoningEffort !== selectedEffort) {
          await this.store.saveSettings({
            ...settings,
            model: selectedModel.id,
            reasoningEffort: selectedEffort,
          })
        }
      }
    }
    return this.agent
  }

  async setCodexExecutable(executable: string): Promise<AgentStatus> {
    const settings = await this.store.getSettings()
    await this.store.saveSettings({ ...settings, codexExecutable: executable })
    return this.refreshAgent()
  }

  async updateSettings(input: UpdateSettingsInput): Promise<BootstrapState> {
    const current = await this.store.getSettings()
    let next: AppSettings = {
      ...current,
      debugLoggingEnabled:
        input.debugLoggingEnabled === undefined
          ? current.debugLoggingEnabled
          : input.debugLoggingEnabled,
      model: input.model === undefined ? current.model : input.model,
      personalInstructions:
        input.personalInstructions === undefined
          ? current.personalInstructions
          : input.personalInstructions,
      reasoningEffort:
        input.reasoningEffort === undefined ? current.reasoningEffort : input.reasoningEffort,
    }
    if (input.model !== undefined && input.model !== null) {
      const model = this.agent.models.find((candidate) => candidate.id === input.model)
      if (!model) {
        throw new Error('The selected model is not available from Codex.')
      }
      if (
        !model.supportedReasoningEfforts.some(
          (effort) => effort.reasoningEffort === next.reasoningEffort,
        )
      ) {
        next = { ...next, reasoningEffort: model.defaultReasoningEffort }
      }
    }
    if (input.reasoningEffort !== undefined && input.reasoningEffort !== null) {
      const model = this.agent.models.find((candidate) => candidate.id === next.model)
      if (
        !model?.supportedReasoningEfforts.some(
          (effort) => effort.reasoningEffort === input.reasoningEffort,
        )
      ) {
        throw new Error('The selected reasoning effort is not supported by this model.')
      }
    }
    await this.store.saveSettings(next)
    setDebugLogging(next.debugLoggingEnabled)
    return { agent: this.agent, settings: next }
  }

  async openRepository(path: string): Promise<RepositorySnapshot> {
    const root = await this.git.resolveRepository(path)
    const preferences = await this.store.getRepositoryPreferences(root)
    const repository = await this.git.inspect(root, preferences)
    await this.store.saveRepositoryPreferences(root, repository.preferences)
    await this.store.rememberRepository(root)
    this.currentRepository = repository
    logger.info('Repository opened', { repositoryName: repository.name })
    logger.debug('Repository root', { repositoryRoot: repository.root })
    return repository
  }

  async openRecentRepository(path: string): Promise<RepositorySnapshot> {
    const settings = await this.store.getSettings()
    if (!settings.recentRepositories.includes(path)) {
      throw new Error('The repository is not in the recent list.')
    }
    return this.openRepository(path)
  }

  async refreshRepository(baseBranch?: string): Promise<RepositorySnapshot> {
    const current = this.requireRepository()
    const preferences = await this.store.getRepositoryPreferences(current.root)
    if (baseBranch && !current.branches.includes(baseBranch)) {
      throw new Error('The selected base branch is unavailable.')
    }
    const nextPreferences = baseBranch ? { ...preferences, baseBranch } : preferences
    const repository = await this.git.inspect(current.root, nextPreferences, baseBranch)
    await this.store.saveRepositoryPreferences(current.root, repository.preferences)
    this.currentRepository = repository
    return repository
  }

  async updateRepositoryPreferences(
    input: UpdateRepositoryPreferencesInput,
  ): Promise<RepositorySnapshot> {
    const current = this.requireRepository()
    if (input.baseBranch && !current.branches.includes(input.baseBranch)) {
      throw new Error('The selected base branch is unavailable.')
    }
    if (input.instructionFile) {
      await this.source.readInstruction(current.root, input.instructionFile)
    }
    const currentPreferences = await this.store.getRepositoryPreferences(current.root)
    const preferences = {
      baseBranch: input.baseBranch === undefined ? currentPreferences.baseBranch : input.baseBranch,
      instructionFile:
        input.instructionFile === undefined
          ? currentPreferences.instructionFile
          : input.instructionFile,
    }
    await this.store.saveRepositoryPreferences(current.root, preferences)
    const repository = await this.git.inspect(
      current.root,
      preferences,
      input.baseBranch ?? undefined,
    )
    this.currentRepository = repository
    return repository
  }

  async selectInstructionFile(selectedPath: string): Promise<RepositorySnapshot> {
    const current = this.requireRepository()
    const instructionFile = await this.source.toRepositoryRelativeMarkdown(
      current.root,
      selectedPath,
    )
    return this.updateRepositoryPreferences({ instructionFile })
  }

  async listReviews(): Promise<ReviewSummary[]> {
    const repository = await this.refreshRepository()
    return this.store.listReviews(repository.root, repository.fingerprint)
  }

  async listActivity(): Promise<ReviewRunSummary[]> {
    const repository = await this.refreshRepository()
    return this.store.listRuns(repository.root)
  }

  async readActivity(runId: string): Promise<ReviewRun> {
    const repository = this.requireRepository()
    return this.store.readRun(repository.root, runId)
  }

  async deleteActivity(runId: string): Promise<ReviewRunSummary[]> {
    const repository = this.requireRepository()
    await this.store.deleteRun(repository.root, runId)
    return this.store.listRuns(repository.root)
  }

  async readReview(reviewId: string): Promise<ReviewDocument> {
    const repository = await this.refreshRepository()
    return this.store.readReview(repository.root, reviewId, repository.fingerprint)
  }

  async deleteReview(reviewId: string): Promise<ReviewSummary[]> {
    const repository = this.requireRepository()
    await this.store.deleteReview(repository.root, reviewId)
    return this.listReviews()
  }

  async readSource(input: ReadSourceInput): Promise<SourcePreview> {
    const repository = await this.refreshRepository()
    const metadata = await this.store.getReviewMetadata(repository.root, input.reviewId)
    return this.source.readPreview(
      repository.root,
      input.path,
      input.line,
      input.endLine,
      metadata.fingerprint !== repository.fingerprint,
    )
  }

  async startReview(baseBranch: string): Promise<ReviewDocument> {
    if (this.reviewRunning) {
      throw new Error('A review is already running.')
    }
    if (this.agent.state !== 'ready') {
      throw new Error('Codex is not ready. Check the connection in Settings.')
    }

    const repository = await this.refreshRepository(baseBranch)
    if (repository.files.length === 0) {
      throw new Error('There are no changes to review.')
    }
    if (!repository.baseBranch) {
      throw new Error('Select a base branch before starting a review.')
    }
    const settings = await this.store.getSettings()
    if (!settings.model || !settings.reasoningEffort) {
      throw new Error('Select a Codex model and reasoning effort in Settings.')
    }

    const projectInstructions = repository.preferences.instructionFile
      ? await this.source.readInstruction(repository.root, repository.preferences.instructionFile)
      : null
    const reviewId = randomUUID()
    const createdAt = new Date().toISOString()
    this.reviewRunning = true
    this.emit('preparing', 'Preparing the repository snapshot…', reviewId)

    try {
      const runMetadata: ReviewRunMetadata = {
        baseBranch: repository.baseBranch,
        branch: repository.branch,
        endedAt: null,
        error: null,
        fingerprint: repository.fingerprint,
        headSha: repository.headSha,
        id: reviewId,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
        repositoryName: repository.name,
        repositoryRoot: repository.root,
        reviewId: null,
        startedAt: createdAt,
        status: 'preparing',
      }
      await this.store.createRun(runMetadata)
      this.activeRun = {
        itemSequences: new Map(),
        metadata: runMetadata,
        nextSequence: 0,
        writes: Promise.resolve(),
      }
      this.publishActivity({ entry: null, run: runMetadata })
      const preparingActivityId = randomUUID()
      await this.recordLifecycle(
        'Preparing the repository snapshot.',
        'in-progress',
        preparingActivityId,
      )
      await this.updateActiveRun('running')
      await this.recordLifecycle('Repository snapshot prepared.', 'completed', preparingActivityId)

      const result = await this.backend.startReview({
        model: settings.model,
        onActivity: (activity) => {
          void this.recordActivity(activity).catch((activityError: unknown) => {
            logError('service', 'Could not record Codex activity', activityError)
          })
        },
        onProgress: (message) => this.emit('running', message, reviewId),
        prompt: buildReviewPrompt(repository, settings, projectInstructions),
        reasoningEffort: settings.reasoningEffort,
        repositoryRoot: repository.root,
      })
      this.emit('saving', 'Saving the completed review…', reviewId)
      const savingActivityId = randomUUID()
      await this.recordLifecycle('Saving the completed review.', 'in-progress', savingActivityId)
      await this.updateActiveRun('saving')
      const content = parseStructuredReview(result.markdown)
      const completedAt = new Date().toISOString()
      const metadata: ReviewMetadata = {
        baseBranch: repository.baseBranch,
        branch: repository.branch,
        completedAt,
        createdAt,
        fingerprint: repository.fingerprint,
        format: 'structured-v1',
        headSha: repository.headSha,
        id: reviewId,
        instructionFile: repository.preferences.instructionFile,
        instructionSources: [
          ...new Set([
            ...result.instructionSources,
            ...(repository.preferences.instructionFile
              ? [repository.preferences.instructionFile]
              : []),
          ]),
        ],
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
        repositoryName: repository.name,
        repositoryRoot: repository.root,
      }
      const document = await this.store.saveReview(
        metadata,
        content,
        formatStructuredReviewMarkdown(content),
      )
      const current = await this.refreshRepository()
      const completedDocument = {
        ...document,
        stale: current.fingerprint !== metadata.fingerprint,
      }
      await this.recordLifecycle('Completed review saved.', 'completed', savingActivityId)
      await this.recordLifecycle('Review completed.', 'completed')
      await this.updateActiveRun('completed', {
        endedAt: completedAt,
        error: null,
        reviewId,
      })
      this.emit('completed', 'Review completed.', reviewId)
      logger.info('Review completed', { reviewId })
      return completedDocument
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The review failed.'
      const cancelled = /cancel/i.test(message)
      const status = cancelled ? 'cancelled' : 'failed'
      try {
        await this.recordLifecycle(cancelled ? 'Review cancelled.' : 'Review failed.', status)
        await this.updateActiveRun(status, {
          endedAt: new Date().toISOString(),
          error: cancelled
            ? null
            : 'The review failed. Open the log folder for diagnostic details.',
          reviewId: null,
        })
      } catch (activityError) {
        logError('service', 'Could not finalize the review activity', activityError)
      }
      this.emit(cancelled ? 'cancelled' : 'failed', message, reviewId, message)
      logError('service', cancelled ? 'Review cancelled' : 'Review failed', error)
      throw error
    } finally {
      try {
        await this.flushActivity()
      } catch (error) {
        logError('service', 'Could not flush review activity', error)
      }
      this.activeRun = null
      this.reviewRunning = false
    }
  }

  async cancelReview(): Promise<void> {
    if (!this.reviewRunning) {
      throw new Error('No review is currently running.')
    }
    await this.backend.cancel()
  }

  async stop(): Promise<void> {
    logger.info('Stopping Shippy services')
    await this.backend.stop()
  }

  getCurrentRepositoryRoot(): string | null {
    return this.currentRepository?.root ?? null
  }

  private requireRepository(): RepositorySnapshot {
    if (!this.currentRepository) {
      throw new Error('Select a repository first.')
    }
    return this.currentRepository
  }

  private emit(
    state: ReviewProgress['state'],
    message: string,
    reviewId: string | null,
    error: string | null = null,
  ): void {
    this.publishProgress({ error, message, reviewId, state })
  }

  private recordActivity(activity: BackendActivity): Promise<void> {
    const run = this.activeRun
    if (!run) {
      return Promise.resolve()
    }
    let sequence = run.itemSequences.get(activity.id)
    if (sequence === undefined) {
      sequence = run.nextSequence
      run.nextSequence += 1
      run.itemSequences.set(activity.id, sequence)
    }
    const entry: AgentActivityEntry = {
      ...activity,
      runId: run.metadata.id,
      sequence,
    }
    run.writes = run.writes.then(async () => {
      await this.store.appendRunActivity(run.metadata.repositoryRoot, entry)
      this.publishActivity({ entry, run: run.metadata })
    })
    return run.writes
  }

  private recordLifecycle(
    title: string,
    status: AgentActivityEntry['status'],
    id = randomUUID(),
  ): Promise<void> {
    return this.recordActivity({
      durationMs: null,
      exitCode: null,
      id,
      kind: 'lifecycle',
      name: null,
      occurredAt: new Date().toISOString(),
      paths: [],
      status,
      title,
    })
  }

  private async flushActivity(): Promise<void> {
    await this.activeRun?.writes
  }

  private async updateActiveRun(
    status: ReviewRunStatus,
    changes: Partial<Pick<ReviewRunMetadata, 'endedAt' | 'error' | 'reviewId'>> = {},
  ): Promise<void> {
    const run = this.activeRun
    if (!run) {
      return
    }
    await this.flushActivity()
    run.metadata = { ...run.metadata, ...changes, status }
    await this.store.updateRun(run.metadata)
    this.publishActivity({ entry: null, run: run.metadata })
  }
}
