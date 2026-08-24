import { z } from 'zod'

export const ipcChannels = {
  activityDelete: 'activity:delete',
  activityList: 'activity:list',
  activityRead: 'activity:read',
  activityUpdated: 'activity:updated',
  appBootstrap: 'app:bootstrap',
  agentChooseExecutable: 'agent:choose-executable',
  agentRefresh: 'agent:refresh',
  clipboardWrite: 'clipboard:write',
  diagnosticsOpenLogFolder: 'diagnostics:open-log-folder',
  diagnosticsRendererError: 'diagnostics:renderer-error',
  externalOpen: 'external:open',
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

export const reviewFormatSchema = z.enum([
  'conventional-comments',
  'concise-markdown',
  'structured-v1',
])
export type ReviewFormat = z.infer<typeof reviewFormatSchema>

export const appSettingsSchema = z
  .object({
    codexExecutable: pathSchema.nullable(),
    debugLoggingEnabled: z.boolean().default(false),
    model: optionalSelectionSchema,
    personalInstructions: z.string().max(12_000),
    reasoningEffort: optionalSelectionSchema,
    recentRepositories: z.array(pathSchema).max(8),
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

export const reviewPrioritySchema = z.enum(['P0', 'P1', 'P2', 'P3'])
export type ReviewPriority = z.infer<typeof reviewPrioritySchema>

const reviewLocationPathSchema = pathSchema.refine(
  (value) =>
    !value.startsWith('/') &&
    !/^[a-z]:\//i.test(value) &&
    !value.includes('\\') &&
    value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
  'Code locations must use a repository-relative path with forward slashes.',
)

export const reviewLocationSchema = z
  .object({
    endLine: z.number().int().positive().max(10_000_000).optional(),
    line: z.number().int().positive().max(10_000_000),
    path: reviewLocationPathSchema,
  })
  .strict()
  .refine((value) => value.endLine === undefined || value.endLine >= value.line, {
    message: 'The end line must not be before the start line.',
    path: ['endLine'],
  })
export type ReviewLocation = z.infer<typeof reviewLocationSchema>

export const reviewExternalLinkSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .refine((value) => !/[\r\n]/.test(value), 'Link labels must stay on one line.'),
    url: z
      .url()
      .max(2_048)
      .refine((value) => new URL(value).protocol === 'https:', 'Only HTTPS links are supported.'),
  })
  .strict()
export type ReviewExternalLink = z.infer<typeof reviewExternalLinkSchema>

export const reviewFindingSchema = z
  .object({
    bodyMarkdown: z
      .string()
      .trim()
      .min(1)
      .max(12_000)
      .refine((value) => !value.includes('revy://'), 'Finding bodies cannot contain Revy URLs.'),
    links: z.array(reviewExternalLinkSchema).max(8),
    locations: z.array(reviewLocationSchema).min(1).max(8),
    priority: reviewPrioritySchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !/[\r\n]/.test(value), 'Finding titles must stay on one line.'),
  })
  .strict()
export type ReviewFinding = z.infer<typeof reviewFindingSchema>

export const structuredReviewSchema = z
  .object({
    findings: z.array(reviewFindingSchema).max(100),
    summary: z.string().trim().min(1).max(4_000),
    version: z.literal(1),
  })
  .strict()
export type StructuredReview = z.infer<typeof structuredReviewSchema>

const userStorySchema = z.string().trim().min(1).max(12_000)

export const reviewContextSchema = z
  .object({
    userStory: userStorySchema.nullable(),
  })
  .strict()
export type ReviewContext = z.infer<typeof reviewContextSchema>

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

export const reviewSummarySchema = reviewMetadataSchema
  .extend({
    findingCount: z.number().int().nonnegative(),
    hasUserStory: z.boolean(),
    highestPriority: reviewPrioritySchema.nullable(),
    stale: z.boolean(),
  })
  .strict()
export type ReviewSummary = z.infer<typeof reviewSummarySchema>

export const reviewDocumentSchema = z
  .object({
    content: structuredReviewSchema.nullable(),
    context: reviewContextSchema,
    markdown: z.string(),
    metadata: reviewMetadataSchema,
    stale: z.boolean(),
  })
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

export const reviewRunStatusSchema = z.enum([
  'preparing',
  'running',
  'saving',
  'completed',
  'cancelled',
  'failed',
  'interrupted',
])
export type ReviewRunStatus = z.infer<typeof reviewRunStatusSchema>

export const activityEntryStatusSchema = z.enum([
  'in-progress',
  'completed',
  'failed',
  'warning',
  'cancelled',
  'interrupted',
])
export type ActivityEntryStatus = z.infer<typeof activityEntryStatusSchema>

export const activityKindSchema = z.enum([
  'lifecycle',
  'command',
  'tool',
  'web-search',
  'subagent',
  'warning',
])
export type ActivityKind = z.infer<typeof activityKindSchema>

export const agentActivityEntrySchema = z
  .object({
    durationMs: z.number().int().nonnegative().nullable(),
    exitCode: z.number().int().nullable(),
    id: z.string().min(1).max(256),
    kind: activityKindSchema,
    name: z.string().min(1).max(128).nullable(),
    occurredAt: z.iso.datetime(),
    paths: z.array(pathSchema).max(32),
    runId: z.uuid(),
    sequence: z.number().int().nonnegative(),
    status: activityEntryStatusSchema,
    title: z.string().min(1).max(256),
  })
  .strict()
export type AgentActivityEntry = z.infer<typeof agentActivityEntrySchema>

export const reviewRunMetadataSchema = z
  .object({
    baseBranch: z.string().min(1),
    branch: z.string().min(1).nullable(),
    endedAt: z.iso.datetime().nullable(),
    error: z.string().min(1).max(2_000).nullable(),
    fingerprint: z.string().length(64),
    headSha: z.string().min(1).nullable(),
    id: z.uuid(),
    model: z.string().min(1),
    reasoningEffort: z.string().min(1),
    repositoryName: z.string().min(1),
    repositoryRoot: pathSchema,
    reviewId: z.uuid().nullable(),
    startedAt: z.iso.datetime(),
    status: reviewRunStatusSchema,
  })
  .strict()
export type ReviewRunMetadata = z.infer<typeof reviewRunMetadataSchema>

export const reviewRunSummarySchema = reviewRunMetadataSchema
export type ReviewRunSummary = z.infer<typeof reviewRunSummarySchema>

export const reviewRunSchema = z
  .object({ activity: z.array(agentActivityEntrySchema), metadata: reviewRunMetadataSchema })
  .strict()
export type ReviewRun = z.infer<typeof reviewRunSchema>

export const reviewRunUpdateSchema = z
  .object({ entry: agentActivityEntrySchema.nullable(), run: reviewRunSummarySchema })
  .strict()
export type ReviewRunUpdate = z.infer<typeof reviewRunUpdateSchema>

export const rendererDiagnosticInputSchema = z
  .object({
    kind: z.enum(['error', 'unhandled-rejection']),
    message: z.string().min(1).max(4_000),
    stack: z.string().min(1).max(16_000).nullable(),
  })
  .strict()
export type RendererDiagnosticInput = z.infer<typeof rendererDiagnosticInputSchema>

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
    debugLoggingEnabled: z.boolean().optional(),
    model: optionalSelectionSchema.optional(),
    personalInstructions: z.string().max(12_000).optional(),
    reasoningEffort: optionalSelectionSchema.optional(),
  })
  .strict()
export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>

export const updateRepositoryPreferencesInputSchema = repositoryPreferencesSchema.partial().strict()
export type UpdateRepositoryPreferencesInput = z.infer<
  typeof updateRepositoryPreferencesInputSchema
>

export const startReviewInputSchema = z
  .object({
    baseBranch: z.string().min(1).max(256),
    userStory: z
      .string()
      .max(12_000)
      .nullable()
      .transform((value) => value?.trim() || null),
  })
  .strict()
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
export const clipboardTextSchema = z.string().min(1).max(200_000)
export const externalUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => new URL(value).protocol === 'https:', 'Only HTTPS links are supported.')

export interface RevyApi {
  cancelReview(): Promise<Result<null>>
  chooseCodexExecutable(): Promise<Result<AgentStatus>>
  copyText(text: string): Promise<Result<null>>
  deleteActivity(runId: string): Promise<Result<ReviewRunSummary[]>>
  deleteReview(reviewId: string): Promise<Result<ReviewSummary[]>>
  getBootstrap(): Promise<Result<BootstrapState>>
  listActivity(): Promise<Result<ReviewRunSummary[]>>
  listReviews(): Promise<Result<ReviewSummary[]>>
  onActivityUpdate(listener: (update: ReviewRunUpdate) => void): () => void
  onReviewProgress(listener: (progress: ReviewProgress) => void): () => void
  openExternal(url: string): Promise<Result<null>>
  openLogFolder(): Promise<Result<null>>
  openRecentRepository(path: string): Promise<Result<RepositorySnapshot>>
  readActivity(runId: string): Promise<Result<ReviewRun>>
  readReview(reviewId: string): Promise<Result<ReviewDocument>>
  readSource(input: ReadSourceInput): Promise<Result<SourcePreview>>
  refreshAgent(): Promise<Result<AgentStatus>>
  refreshRepository(baseBranch?: string): Promise<Result<RepositorySnapshot>>
  reportRendererError(input: RendererDiagnosticInput): void
  selectInstructionFile(): Promise<Result<RepositorySnapshot>>
  selectRepository(): Promise<Result<RepositorySnapshot | null>>
  startReview(input: StartReviewInput): Promise<Result<ReviewDocument>>
  updateRepositoryPreferences(
    input: UpdateRepositoryPreferencesInput,
  ): Promise<Result<RepositorySnapshot>>
  updateSettings(input: UpdateSettingsInput): Promise<Result<BootstrapState>>
}
