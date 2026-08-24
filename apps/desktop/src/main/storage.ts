import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AgentActivityEntry,
  AppSettings,
  RepositoryPreferences,
  ReviewContext,
  ReviewDocument,
  ReviewMetadata,
  ReviewRun,
  ReviewRunMetadata,
  ReviewRunSummary,
  ReviewSummary,
  StructuredReview,
} from '../shared/contracts.js'
import {
  agentActivityEntrySchema,
  appSettingsSchema,
  repositoryPreferencesSchema,
  reviewContextSchema,
  reviewMetadataSchema,
  reviewRunMetadataSchema,
  structuredReviewSchema,
} from '../shared/contracts.js'
import { highestReviewPriority } from '../shared/review-formats.js'
import { createLogger } from './logger.js'

const logger = createLogger('storage')

const defaultSettings: AppSettings = {
  codexExecutable: null,
  debugLoggingEnabled: false,
  model: null,
  personalInstructions: '',
  reasoningEffort: null,
  recentRepositories: [],
}

const defaultRepositoryPreferences: RepositoryPreferences = {
  baseBranch: null,
  instructionFile: null,
}

const defaultReviewContext: ReviewContext = {
  userStory: null,
}

function parseSettings(value: unknown): AppSettings {
  const normalized =
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'reviewFormat'))
      : value
  const parsed = appSettingsSchema.safeParse(normalized)
  return parsed.success ? parsed.data : { ...defaultSettings }
}

function parseRepositoryPreferences(value: unknown): RepositoryPreferences {
  const parsed = repositoryPreferencesSchema.safeParse(value)
  return parsed.success ? parsed.data : { ...defaultRepositoryPreferences }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function readStructuredReview(path: string): Promise<StructuredReview | null> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return null
    }
    throw error
  }

  let value: unknown
  try {
    value = JSON.parse(content) as unknown
  } catch {
    throw new Error('The saved structured review is invalid.')
  }
  const parsed = structuredReviewSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('The saved structured review is invalid.')
  }
  return parsed.data
}

async function readReviewContext(path: string): Promise<ReviewContext> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return { ...defaultReviewContext }
    }
    throw error
  }

  let value: unknown
  try {
    value = JSON.parse(content) as unknown
  } catch {
    throw new Error('The saved review context is invalid.')
  }
  const parsed = reviewContextSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('The saved review context is invalid.')
  }
  return parsed.data
}

async function readActivity(path: string): Promise<AgentActivityEntry[]> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    return []
  }

  const entries = new Map<string, AgentActivityEntry>()
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue
    }
    try {
      const parsed = agentActivityEntrySchema.safeParse(JSON.parse(line) as unknown)
      if (parsed.success) {
        entries.set(parsed.data.id, parsed.data)
      }
    } catch {
      // Ignore a partial final line left by an interrupted append.
    }
  }
  return [...entries.values()].sort((left, right) => left.sequence - right.sequence)
}

function isActiveRun(status: ReviewRunMetadata['status']): boolean {
  return status === 'preparing' || status === 'running' || status === 'saving'
}

export class AppStore {
  private initialization: Promise<void> | null = null
  readonly root: string

  constructor(userDataPath: string) {
    this.root = join(userDataPath, 'storage-v1')
  }

  async initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce()
    await this.initialization
  }

  async getSettings(): Promise<AppSettings> {
    await this.initialize()
    const path = join(this.root, 'settings.json')
    const stored = await readJson(path)
    const settings = parseSettings(stored)
    if (stored && typeof stored === 'object' && Object.hasOwn(stored, 'reviewFormat')) {
      await writeJsonAtomic(path, settings)
    }
    return settings
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.initialize()
    await writeJsonAtomic(join(this.root, 'settings.json'), appSettingsSchema.parse(settings))
  }

  async rememberRepository(repositoryRoot: string): Promise<AppSettings> {
    const settings = await this.getSettings()
    const recentRepositories = [
      repositoryRoot,
      ...settings.recentRepositories.filter((path) => path !== repositoryRoot),
    ].slice(0, 8)
    const nextSettings = { ...settings, recentRepositories }
    await this.saveSettings(nextSettings)
    return nextSettings
  }

  async getRepositoryPreferences(repositoryRoot: string): Promise<RepositoryPreferences> {
    const repositoryDirectory = await this.ensureRepositoryDirectory(repositoryRoot)
    return parseRepositoryPreferences(await readJson(join(repositoryDirectory, 'preferences.json')))
  }

  async saveRepositoryPreferences(
    repositoryRoot: string,
    preferences: RepositoryPreferences,
  ): Promise<void> {
    const repositoryDirectory = await this.ensureRepositoryDirectory(repositoryRoot)
    await writeJsonAtomic(
      join(repositoryDirectory, 'preferences.json'),
      repositoryPreferencesSchema.parse(preferences),
    )
  }

  async saveReview(
    metadata: ReviewMetadata,
    context: ReviewContext,
    content: StructuredReview,
    markdown: string,
  ): Promise<ReviewDocument> {
    const validatedMetadata = reviewMetadataSchema.parse(metadata)
    const validatedContext = reviewContextSchema.parse(context)
    const validatedContent = structuredReviewSchema.parse(content)
    const reviewsDirectory = join(
      await this.ensureRepositoryDirectory(validatedMetadata.repositoryRoot),
      'reviews',
    )
    const reviewDirectory = join(reviewsDirectory, validatedMetadata.id)
    await mkdir(reviewDirectory, { recursive: true })
    await writeJsonAtomic(join(reviewDirectory, 'context.json'), validatedContext)
    await writeJsonAtomic(join(reviewDirectory, 'review.json'), validatedContent)
    await writeFile(join(reviewDirectory, 'review.md'), markdown, 'utf8')
    await writeJsonAtomic(join(reviewDirectory, 'metadata.json'), validatedMetadata)
    return {
      content: validatedContent,
      context: validatedContext,
      markdown,
      metadata: validatedMetadata,
      stale: false,
    }
  }

  async createRun(metadata: ReviewRunMetadata): Promise<ReviewRunSummary> {
    const validated = reviewRunMetadataSchema.parse(metadata)
    const directory = this.runDirectory(validated.repositoryRoot, validated.id)
    await mkdir(directory, { recursive: true })
    await writeJsonAtomic(join(directory, 'metadata.json'), validated)
    await writeFile(join(directory, 'activity.jsonl'), '', { encoding: 'utf8', flag: 'wx' })
    logger.info('Review run created', { runId: validated.id })
    logger.debug('Review run repository', { repositoryRoot: validated.repositoryRoot })
    return validated
  }

  async updateRun(metadata: ReviewRunMetadata): Promise<ReviewRunSummary> {
    const validated = reviewRunMetadataSchema.parse(metadata)
    const directory = this.runDirectory(validated.repositoryRoot, validated.id)
    await mkdir(directory, { recursive: true })
    await writeJsonAtomic(join(directory, 'metadata.json'), validated)
    return validated
  }

  async appendRunActivity(
    repositoryRoot: string,
    entry: AgentActivityEntry,
  ): Promise<AgentActivityEntry> {
    const validated = agentActivityEntrySchema.parse(entry)
    const metadata = await this.readRunMetadata(repositoryRoot, validated.runId)
    if (metadata.repositoryRoot !== repositoryRoot) {
      throw new Error('The review run does not belong to this repository.')
    }
    await appendFile(
      join(this.runDirectory(repositoryRoot, validated.runId), 'activity.jsonl'),
      `${JSON.stringify(validated)}\n`,
      'utf8',
    )
    return validated
  }

  async listRuns(repositoryRoot: string): Promise<ReviewRunSummary[]> {
    const runsDirectory = join(await this.ensureRepositoryDirectory(repositoryRoot), 'runs')
    let entries: string[]
    try {
      entries = (await readdir(runsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return []
    }

    const runs = await Promise.all(
      entries.map(async (id) => {
        const metadata = reviewRunMetadataSchema.safeParse(
          await readJson(join(runsDirectory, id, 'metadata.json')),
        )
        return metadata.success && metadata.data.repositoryRoot === repositoryRoot
          ? metadata.data
          : null
      }),
    )
    return runs
      .filter((run): run is ReviewRunSummary => run !== null)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  }

  async readRun(repositoryRoot: string, runId: string): Promise<ReviewRun> {
    const metadata = await this.readRunMetadata(repositoryRoot, runId)
    return {
      activity: await readActivity(
        join(this.runDirectory(repositoryRoot, runId), 'activity.jsonl'),
      ),
      metadata,
    }
  }

  async deleteRun(repositoryRoot: string, runId: string): Promise<void> {
    const metadata = await this.readRunMetadata(repositoryRoot, runId)
    await Promise.all([
      rm(this.runDirectory(repositoryRoot, runId), { force: true, recursive: true }),
      metadata.reviewId
        ? rm(this.reviewDirectory(repositoryRoot, metadata.reviewId), {
            force: true,
            recursive: true,
          })
        : Promise.resolve(),
    ])
    logger.info('Review run deleted', { runId })
  }

  async listReviews(repositoryRoot: string, fingerprint: string): Promise<ReviewSummary[]> {
    const reviewsDirectory = join(await this.ensureRepositoryDirectory(repositoryRoot), 'reviews')
    let entries: string[]

    try {
      entries = (await readdir(reviewsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return []
    }

    const reviews = await Promise.all(
      entries.map(async (id): Promise<ReviewSummary | null> => {
        const metadata = reviewMetadataSchema.safeParse(
          await readJson(join(reviewsDirectory, id, 'metadata.json')),
        )
        if (!metadata.success) {
          return null
        }
        let content: StructuredReview | null = null
        let context = defaultReviewContext
        try {
          content = await readStructuredReview(join(reviewsDirectory, id, 'review.json'))
        } catch {
          logger.warn('Ignored invalid structured review summary', { reviewId: id })
        }
        try {
          context = await readReviewContext(join(reviewsDirectory, id, 'context.json'))
        } catch {
          logger.warn('Ignored invalid review context summary', { reviewId: id })
        }
        return {
          ...metadata.data,
          findingCount: content?.findings.length ?? 0,
          hasUserStory: context.userStory !== null,
          highestPriority: content ? highestReviewPriority(content) : null,
          stale: metadata.data.fingerprint !== fingerprint,
        }
      }),
    )

    return reviews
      .filter((review): review is ReviewSummary => review !== null)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
  }

  async readReview(
    repositoryRoot: string,
    reviewId: string,
    fingerprint: string,
  ): Promise<ReviewDocument> {
    const reviewDirectory = this.reviewDirectory(repositoryRoot, reviewId)
    const metadata = reviewMetadataSchema.safeParse(
      await readJson(join(reviewDirectory, 'metadata.json')),
    )
    if (!metadata.success || metadata.data.repositoryRoot !== repositoryRoot) {
      throw new Error('The selected review is unavailable.')
    }
    const content = await readStructuredReview(join(reviewDirectory, 'review.json'))
    const context = await readReviewContext(join(reviewDirectory, 'context.json'))
    if (metadata.data.format === 'structured-v1' && !content) {
      throw new Error('The selected structured review is unavailable.')
    }

    return {
      content,
      context,
      markdown: await readFile(join(reviewDirectory, 'review.md'), 'utf8'),
      metadata: metadata.data,
      stale: metadata.data.fingerprint !== fingerprint,
    }
  }

  async deleteReview(repositoryRoot: string, reviewId: string): Promise<void> {
    await Promise.all([
      rm(this.reviewDirectory(repositoryRoot, reviewId), { force: true, recursive: true }),
      rm(this.runDirectory(repositoryRoot, reviewId), { force: true, recursive: true }),
    ])
    logger.info('Review and linked run deleted', { reviewId })
  }

  async getReviewMetadata(repositoryRoot: string, reviewId: string): Promise<ReviewMetadata> {
    const metadata = reviewMetadataSchema.safeParse(
      await readJson(join(this.reviewDirectory(repositoryRoot, reviewId), 'metadata.json')),
    )
    if (!metadata.success || metadata.data.repositoryRoot !== repositoryRoot) {
      throw new Error('The selected review is unavailable.')
    }
    return metadata.data
  }

  private repositoryId(repositoryRoot: string): string {
    return createHash('sha256').update(repositoryRoot).digest('hex')
  }

  private async initializeOnce(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await this.recoverInterruptedRuns()
    logger.debug('App storage initialized', { root: this.root })
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const repositoriesDirectory = join(this.root, 'repositories')
    let repositories: string[]
    try {
      repositories = (await readdir(repositoriesDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return
    }

    let recovered = 0
    for (const repositoryId of repositories) {
      const repositoryDirectory = join(repositoriesDirectory, repositoryId)
      const runsDirectory = join(repositoryDirectory, 'runs')
      let runs: string[]
      try {
        runs = (await readdir(runsDirectory, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      } catch {
        continue
      }

      for (const runId of runs) {
        const runDirectory = join(runsDirectory, runId)
        const parsed = reviewRunMetadataSchema.safeParse(
          await readJson(join(runDirectory, 'metadata.json')),
        )
        if (!parsed.success || !isActiveRun(parsed.data.status)) {
          continue
        }

        const reviewMetadata = reviewMetadataSchema.safeParse(
          await readJson(join(repositoryDirectory, 'reviews', runId, 'metadata.json')),
        )
        let reviewExists = false
        if (reviewMetadata.success) {
          try {
            await readFile(join(repositoryDirectory, 'reviews', runId, 'review.md'), 'utf8')
            reviewExists =
              reviewMetadata.data.format !== 'structured-v1' ||
              Boolean(
                await readStructuredReview(
                  join(repositoryDirectory, 'reviews', runId, 'review.json'),
                ),
              )
          } catch {
            reviewExists = false
          }
        }

        const endedAt = reviewExists
          ? (reviewMetadata.data?.completedAt ?? new Date().toISOString())
          : new Date().toISOString()
        const metadata: ReviewRunMetadata = {
          ...parsed.data,
          endedAt,
          error: reviewExists ? null : 'Shippy closed before the review run finished.',
          reviewId: reviewExists ? parsed.data.id : null,
          status: reviewExists ? 'completed' : 'interrupted',
        }
        await writeJsonAtomic(join(runDirectory, 'metadata.json'), metadata)
        const activity = await readActivity(join(runDirectory, 'activity.jsonl'))
        const entry: AgentActivityEntry = {
          durationMs: null,
          exitCode: null,
          id: randomUUID(),
          kind: 'lifecycle',
          name: null,
          occurredAt: endedAt,
          paths: [],
          runId: metadata.id,
          sequence: (activity.at(-1)?.sequence ?? -1) + 1,
          status: reviewExists ? 'completed' : 'interrupted',
          title: reviewExists
            ? 'Review completed before Shippy closed.'
            : 'Review interrupted when Shippy closed.',
        }
        await appendFile(join(runDirectory, 'activity.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8')
        recovered += 1
      }
    }
    if (recovered > 0) {
      logger.warn(`Recovered ${recovered} unfinished review run${recovered === 1 ? '' : 's'}`)
    }
  }

  private async ensureRepositoryDirectory(repositoryRoot: string): Promise<string> {
    await this.initialize()
    const directory = join(this.root, 'repositories', this.repositoryId(repositoryRoot))
    await mkdir(directory, { recursive: true })
    await writeJsonAtomic(join(directory, 'repository.json'), { root: repositoryRoot })
    return directory
  }

  private reviewDirectory(repositoryRoot: string, reviewId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(reviewId)) {
      throw new Error('The review identifier is invalid.')
    }
    return join(this.root, 'repositories', this.repositoryId(repositoryRoot), 'reviews', reviewId)
  }

  private runDirectory(repositoryRoot: string, runId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(runId)) {
      throw new Error('The review run identifier is invalid.')
    }
    return join(this.root, 'repositories', this.repositoryId(repositoryRoot), 'runs', runId)
  }

  private async readRunMetadata(repositoryRoot: string, runId: string): Promise<ReviewRunMetadata> {
    const metadata = reviewRunMetadataSchema.safeParse(
      await readJson(join(this.runDirectory(repositoryRoot, runId), 'metadata.json')),
    )
    if (!metadata.success || metadata.data.repositoryRoot !== repositoryRoot) {
      throw new Error('The selected review run is unavailable.')
    }
    return metadata.data
  }
}
