import { randomUUID } from 'node:crypto'
import type {
  AgentStatus,
  AppSettings,
  BootstrapState,
  ReadSourceInput,
  RepositorySnapshot,
  ReviewDocument,
  ReviewMetadata,
  ReviewProgress,
  ReviewSummary,
  SourcePreview,
  UpdateRepositoryPreferencesInput,
  UpdateSettingsInput,
} from '../shared/contracts.js'
import { CodexAppServerBackend, type ReviewBackend } from './codex-app-server.js'
import { GitService } from './git-service.js'
import { SourceService } from './source-service.js'
import { AppStore } from './storage.js'

const disconnectedAgent: AgentStatus = {
  accountLabel: null,
  error: null,
  executable: null,
  models: [],
  state: 'unavailable',
  version: null,
}

function formatInstructions(format: AppSettings['reviewFormat']): string {
  if (format === 'concise-markdown') {
    return [
      'Use concise Markdown.',
      'Start with a one-sentence verdict, then list only actionable findings in priority order.',
      'If there are no findings, say so explicitly and keep the report brief.',
    ].join('\n')
  }
  return [
    'Use Conventional Comments for findings.',
    'Begin each finding with one of: issue, suggestion, question, thought, praise, or nitpick.',
    'Add (blocking) or (non-blocking) where useful, followed by a concise subject and explanation.',
    'Order findings by severity and finish with a short summary.',
  ].join('\n')
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
    'Return GitHub-flavoured Markdown only. Never emit raw HTML or internal reasoning.',
    'Every actionable source location must be linked as `[path:line](shippy://code/path?line=LINE)` or `[path:start-end](shippy://code/path?line=START&end=END)`.',
    'In those links, `path` must be repository-relative, use forward slashes, percent-encode special characters, and never be absolute or contain `..`.',
    '',
    '# Project review rules',
    projectInstructions ?? 'No additional project-specific review skill was selected.',
    '',
    '# Output format',
    formatInstructions(settings.reviewFormat),
    '',
    '# Personal style',
    settings.personalInstructions.trim() || 'No additional personal instructions.',
  ].join('\n')
}

function prependMetadata(markdown: string, metadata: ReviewMetadata): string {
  const branch = metadata.branch ?? 'detached HEAD'
  return [
    '# Shippy review',
    '',
    `> **Repository:** ${metadata.repositoryName}  `,
    `> **Branch:** ${branch} → ${metadata.baseBranch}  `,
    `> **Model:** ${metadata.model} · ${metadata.reasoningEffort}  `,
    `> **State:** ${metadata.headSha?.slice(0, 12) ?? 'unborn'} · ${metadata.fingerprint.slice(0, 12)}  `,
    `> **Completed:** ${metadata.completedAt}`,
    '',
    '---',
    '',
    markdown.trim(),
    '',
  ].join('\n')
}

export class ShippyService {
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
    backend: ReviewBackend = new CodexAppServerBackend(),
  ) {
    this.backend = backend
    this.store = new AppStore(userDataPath)
  }

  async getBootstrap(): Promise<BootstrapState> {
    await this.store.initialize()
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
      model: input.model === undefined ? current.model : input.model,
      personalInstructions:
        input.personalInstructions === undefined
          ? current.personalInstructions
          : input.personalInstructions,
      reasoningEffort:
        input.reasoningEffort === undefined ? current.reasoningEffort : input.reasoningEffort,
      reviewFormat: input.reviewFormat ?? current.reviewFormat,
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
    return { agent: this.agent, settings: next }
  }

  async openRepository(path: string): Promise<RepositorySnapshot> {
    const root = await this.git.resolveRepository(path)
    const preferences = await this.store.getRepositoryPreferences(root)
    const repository = await this.git.inspect(root, preferences)
    await this.store.saveRepositoryPreferences(root, repository.preferences)
    await this.store.rememberRepository(root)
    this.currentRepository = repository
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
      const result = await this.backend.startReview({
        model: settings.model,
        onProgress: (message) => this.emit('running', message, reviewId),
        prompt: buildReviewPrompt(repository, settings, projectInstructions),
        reasoningEffort: settings.reasoningEffort,
        repositoryRoot: repository.root,
      })
      this.emit('saving', 'Saving the completed review…', reviewId)
      const completedAt = new Date().toISOString()
      const metadata: ReviewMetadata = {
        baseBranch: repository.baseBranch,
        branch: repository.branch,
        completedAt,
        createdAt,
        fingerprint: repository.fingerprint,
        format: settings.reviewFormat,
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
        prependMetadata(result.markdown, metadata),
      )
      const current = await this.refreshRepository()
      const completedDocument = {
        ...document,
        stale: current.fingerprint !== metadata.fingerprint,
      }
      this.emit('completed', 'Review completed.', reviewId)
      return completedDocument
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The review failed.'
      const cancelled = /cancel/i.test(message)
      this.emit(cancelled ? 'cancelled' : 'failed', message, reviewId, message)
      throw error
    } finally {
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
}
