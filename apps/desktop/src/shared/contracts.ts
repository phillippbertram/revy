import { z } from 'zod'

export const ipcChannels = {
  appBootstrap: 'app:bootstrap',
  agentChooseExecutable: 'agent:choose-executable',
  agentRefresh: 'agent:refresh',
  repositoryOpenRecent: 'repository:open-recent',
  repositoryRefresh: 'repository:refresh',
  repositorySelect: 'repository:select',
  repositorySelectInstructions: 'repository:select-instructions',
  repositoryUpdatePreferences: 'repository:update-preferences',
  reviewCancel: 'review:cancel',
  reviewDelete: 'review:delete',
  reviewList: 'review:list',
  reviewProgress: 'review:progress',
  reviewRead: 'review:read',
  reviewReadSource: 'review:read-source',
  reviewStart: 'review:start',
  settingsUpdate: 'settings:update',
} as const

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const pathSchema = z.string().min(1).max(4_096)
const optionalSelectionSchema = z.string().min(1).max(256).nullable()

export const reviewFormatSchema = z.enum(['conventional-comments', 'concise-markdown'])
export type ReviewFormat = z.infer<typeof reviewFormatSchema>

export const appSettingsSchema = z
  .object({
    codexExecutable: pathSchema.nullable(),
    model: optionalSelectionSchema,
    personalInstructions: z.string().max(12_000),
    reasoningEffort: optionalSelectionSchema,
    recentRepositories: z.array(pathSchema).max(8),
    reviewFormat: reviewFormatSchema,
  })
  .strict()
export type AppSettings = z.infer<typeof appSettingsSchema>

export const repositoryPreferencesSchema = z
  .object({
    baseBranch: optionalSelectionSchema,
    instructionFile: pathSchema.nullable(),
  })
  .strict()
export type RepositoryPreferences = z.infer<typeof repositoryPreferencesSchema>

export const reasoningEffortOptionSchema = z
  .object({ description: z.string(), reasoningEffort: z.string().min(1) })
  .strict()
export type ReasoningEffortOption = z.infer<typeof reasoningEffortOptionSchema>

export const codexModelSchema = z
  .object({
    defaultReasoningEffort: z.string().min(1),
    displayName: z.string().min(1),
    id: z.string().min(1),
    isDefault: z.boolean(),
    supportedReasoningEfforts: z.array(reasoningEffortOptionSchema),
  })
  .strict()
export type CodexModel = z.infer<typeof codexModelSchema>

export const agentStatusSchema = z
  .object({
    accountLabel: z.string().nullable(),
    error: z.string().nullable(),
    executable: pathSchema.nullable(),
    models: z.array(codexModelSchema),
    state: z.enum(['error', 'ready', 'unauthenticated', 'unavailable']),
    version: z.string().nullable(),
  })
  .strict()
export type AgentStatus = z.infer<typeof agentStatusSchema>

export const fileChangeSchema = z
  .object({
    path: pathSchema,
    previousPath: pathSchema.nullable(),
    sources: z.array(z.enum(['branch', 'staged', 'unstaged', 'untracked'])).min(1),
    status: z.enum([
      'added',
      'conflicted',
      'copied',
      'deleted',
      'modified',
      'renamed',
      'untracked',
    ]),
  })
  .strict()
export type ChangeSource = z.infer<typeof fileChangeSchema>['sources'][number]
export type FileChangeStatus = z.infer<typeof fileChangeSchema>['status']
export type FileChange = z.infer<typeof fileChangeSchema>

export const repositorySnapshotSchema = z
  .object({
    baseBranch: optionalSelectionSchema,
    branches: z.array(z.string().min(1)),
    branch: z.string().min(1).nullable(),
    files: z.array(fileChangeSchema),
    fingerprint: z.string().length(64),
    headSha: z.string().min(1).nullable(),
    instructionFiles: z.array(pathSchema),
    name: z.string().min(1),
    preferences: repositoryPreferencesSchema,
    root: pathSchema,
  })
  .strict()
export type RepositorySnapshot = z.infer<typeof repositorySnapshotSchema>

export const reviewMetadataSchema = z
  .object({
    baseBranch: z.string().min(1),
    branch: z.string().min(1).nullable(),
    completedAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    fingerprint: z.string().length(64),
    format: reviewFormatSchema,
    headSha: z.string().min(1).nullable(),
    id: z.uuid(),
    instructionFile: pathSchema.nullable(),
    instructionSources: z.array(pathSchema),
    model: z.string().min(1),
    reasoningEffort: z.string().min(1),
    repositoryName: z.string().min(1),
    repositoryRoot: pathSchema,
  })
  .strict()
export type ReviewMetadata = z.infer<typeof reviewMetadataSchema>

export const reviewSummarySchema = reviewMetadataSchema.extend({ stale: z.boolean() }).strict()
export type ReviewSummary = z.infer<typeof reviewSummarySchema>

export const reviewDocumentSchema = z
  .object({ markdown: z.string(), metadata: reviewMetadataSchema, stale: z.boolean() })
  .strict()
export type ReviewDocument = z.infer<typeof reviewDocumentSchema>

export const reviewProgressSchema = z
  .object({
    error: z.string().nullable(),
    message: z.string(),
    reviewId: z.uuid().nullable(),
    state: z.enum(['cancelled', 'completed', 'failed', 'preparing', 'running', 'saving']),
  })
  .strict()
export type ReviewProgress = z.infer<typeof reviewProgressSchema>

export const sourcePreviewSchema = z
  .object({
    content: z.string(),
    endLine: z.number().int().positive(),
    path: pathSchema,
    stale: z.boolean(),
    startLine: z.number().int().positive(),
    targetEndLine: z.number().int().positive(),
    targetLine: z.number().int().positive(),
  })
  .strict()
export type SourcePreview = z.infer<typeof sourcePreviewSchema>

export const bootstrapStateSchema = z
  .object({ agent: agentStatusSchema, settings: appSettingsSchema })
  .strict()
export type BootstrapState = z.infer<typeof bootstrapStateSchema>

export const updateSettingsInputSchema = z
  .object({
    model: optionalSelectionSchema.optional(),
    personalInstructions: z.string().max(12_000).optional(),
    reasoningEffort: optionalSelectionSchema.optional(),
    reviewFormat: reviewFormatSchema.optional(),
  })
  .strict()
export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>

export const updateRepositoryPreferencesInputSchema = repositoryPreferencesSchema.partial().strict()
export type UpdateRepositoryPreferencesInput = z.infer<
  typeof updateRepositoryPreferencesInputSchema
>

export const startReviewInputSchema = z.object({ baseBranch: z.string().min(1).max(256) }).strict()
export type StartReviewInput = z.infer<typeof startReviewInputSchema>

export const readSourceInputSchema = z
  .object({
    endLine: z.number().int().positive().max(10_000_000).optional(),
    line: z.number().int().positive().max(10_000_000),
    path: pathSchema,
    reviewId: z.uuid(),
  })
  .strict()
export type ReadSourceInput = z.infer<typeof readSourceInputSchema>

export const reviewIdSchema = z.uuid()
export const recentRepositoryInputSchema = pathSchema
export const optionalBaseBranchInputSchema = z.string().min(1).max(256).optional()

export interface ShippyApi {
  cancelReview(): Promise<Result<null>>
  chooseCodexExecutable(): Promise<Result<AgentStatus>>
  deleteReview(reviewId: string): Promise<Result<ReviewSummary[]>>
  getBootstrap(): Promise<Result<BootstrapState>>
  listReviews(): Promise<Result<ReviewSummary[]>>
  onReviewProgress(listener: (progress: ReviewProgress) => void): () => void
  openRecentRepository(path: string): Promise<Result<RepositorySnapshot>>
  readReview(reviewId: string): Promise<Result<ReviewDocument>>
  readSource(input: ReadSourceInput): Promise<Result<SourcePreview>>
  refreshAgent(): Promise<Result<AgentStatus>>
  refreshRepository(baseBranch?: string): Promise<Result<RepositorySnapshot>>
  selectInstructionFile(): Promise<Result<RepositorySnapshot>>
  selectRepository(): Promise<Result<RepositorySnapshot | null>>
  startReview(input: StartReviewInput): Promise<Result<ReviewDocument>>
  updateRepositoryPreferences(
    input: UpdateRepositoryPreferencesInput,
  ): Promise<Result<RepositorySnapshot>>
  updateSettings(input: UpdateSettingsInput): Promise<Result<BootstrapState>>
}
