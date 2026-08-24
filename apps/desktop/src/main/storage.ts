import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AppSettings,
  RepositoryPreferences,
  ReviewDocument,
  ReviewMetadata,
  ReviewSummary,
} from '../shared/contracts.js'
import {
  appSettingsSchema,
  repositoryPreferencesSchema,
  reviewMetadataSchema,
} from '../shared/contracts.js'

const defaultSettings: AppSettings = {
  codexExecutable: null,
  model: null,
  personalInstructions: '',
  reasoningEffort: null,
  recentRepositories: [],
  reviewFormat: 'conventional-comments',
}

const defaultRepositoryPreferences: RepositoryPreferences = {
  baseBranch: null,
  instructionFile: null,
}

function parseSettings(value: unknown): AppSettings {
  const parsed = appSettingsSchema.safeParse(value)
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
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

export class AppStore {
  readonly root: string

  constructor(userDataPath: string) {
    this.root = join(userDataPath, 'storage-v1')
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true })
  }

  async getSettings(): Promise<AppSettings> {
    await this.initialize()
    return parseSettings(await readJson(join(this.root, 'settings.json')))
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

  async saveReview(metadata: ReviewMetadata, markdown: string): Promise<ReviewDocument> {
    const validatedMetadata = reviewMetadataSchema.parse(metadata)
    const reviewsDirectory = join(
      await this.ensureRepositoryDirectory(validatedMetadata.repositoryRoot),
      'reviews',
    )
    const reviewDirectory = join(reviewsDirectory, validatedMetadata.id)
    await mkdir(reviewDirectory, { recursive: true })
    await writeFile(join(reviewDirectory, 'review.md'), markdown, 'utf8')
    await writeJsonAtomic(join(reviewDirectory, 'metadata.json'), validatedMetadata)
    return { markdown, metadata: validatedMetadata, stale: false }
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
        return metadata.success
          ? { ...metadata.data, stale: metadata.data.fingerprint !== fingerprint }
          : null
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

    return {
      markdown: await readFile(join(reviewDirectory, 'review.md'), 'utf8'),
      metadata: metadata.data,
      stale: metadata.data.fingerprint !== fingerprint,
    }
  }

  async deleteReview(repositoryRoot: string, reviewId: string): Promise<void> {
    await rm(this.reviewDirectory(repositoryRoot, reviewId), { recursive: true })
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
}
