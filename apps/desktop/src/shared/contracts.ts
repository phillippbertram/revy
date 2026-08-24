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
  reviewerProfileDelete: 'reviewer-profile:delete',
  reviewerProfileSave: 'reviewer-profile:save',
  reviewCancel: 'review:cancel',
  reviewDelete: 'review:delete',
  reviewList: 'review:list',
  reviewProgress: 'review:progress',
  reviewRead: 'review:read',
  reviewReadSource: 'review:read-source',
  reviewStart: 'review:start',
  settingsUpdate: 'settings:update',
  workflowDelete: 'workflow:delete',
  workflowSave: 'workflow:save',
} as const

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const pathSchema = z.string().min(1).max(4_096)
const optionalSelectionSchema = z.string().min(1).max(256).nullable()

export const standardReviewWorkflowId = 'standard'
export const reviewConfigurationOriginSchema = z.enum(['built-in', 'custom'])
export type ReviewConfigurationOrigin = z.infer<typeof reviewConfigurationOriginSchema>

export const reviewerProfileSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    id: z.uuid(),
    instructions: z.string().trim().min(1).max(12_000),
    model: optionalSelectionSchema,
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((value) => !/[\r\n]/.test(value), 'Reviewer names must stay on one line.'),
    origin: reviewConfigurationOriginSchema.default('custom'),
    reasoningEffort: optionalSelectionSchema,
  })
  .strict()
export type ReviewerProfile = z.infer<typeof reviewerProfileSchema>

export const saveReviewerProfileInputSchema = reviewerProfileSchema
  .omit({ id: true, origin: true })
  .extend({ id: z.uuid().nullable() })
  .strict()
export type SaveReviewerProfileInput = z.infer<typeof saveReviewerProfileInputSchema>

export const reviewWorkflowReviewerSchema = z
  .object({
    defaultEnabled: z.boolean(),
    profileId: z.uuid(),
    required: z.boolean(),
  })
  .strict()
  .transform((value) => ({
    ...value,
    defaultEnabled: value.required ? true : value.defaultEnabled,
  }))
export type ReviewWorkflowReviewer = z.infer<typeof reviewWorkflowReviewerSchema>

export const reviewWorkflowSchema = z
  .object({
    id: z.uuid(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((value) => !/[\r\n]/.test(value), 'Workflow names must stay on one line.'),
    origin: reviewConfigurationOriginSchema.default('custom'),
    reviewers: z.array(reviewWorkflowReviewerSchema).min(1).max(24),
  })
  .strict()
  .superRefine((value, context) => {
    const profileIds = new Set<string>()
    for (const [index, reviewer] of value.reviewers.entries()) {
      if (profileIds.has(reviewer.profileId)) {
        context.addIssue({
          code: 'custom',
          message: 'A reviewer profile can only appear once in a workflow.',
          path: ['reviewers', index, 'profileId'],
        })
      }
      profileIds.add(reviewer.profileId)
    }
  })
export type ReviewWorkflow = z.infer<typeof reviewWorkflowSchema>

export const saveReviewWorkflowInputSchema = z
  .object({
    id: z.uuid().nullable(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((value) => !/[\r\n]/.test(value), 'Workflow names must stay on one line.'),
    reviewers: z.array(reviewWorkflowReviewerSchema).min(1).max(24),
  })
  .strict()
  .superRefine((value, context) => {
    const profileIds = new Set<string>()
    for (const [index, reviewer] of value.reviewers.entries()) {
      if (profileIds.has(reviewer.profileId)) {
        context.addIssue({
          code: 'custom',
          message: 'A reviewer profile can only appear once in a workflow.',
          path: ['reviewers', index, 'profileId'],
        })
      }
      profileIds.add(reviewer.profileId)
    }
  })
export type SaveReviewWorkflowInput = z.infer<typeof saveReviewWorkflowInputSchema>

export const reviewConfigurationSchema = z
  .object({
    profiles: z.array(reviewerProfileSchema),
    workflows: z.array(reviewWorkflowSchema),
  })
  .strict()
export type ReviewConfiguration = z.infer<typeof reviewConfigurationSchema>

export const reviewerExecutionStatusSchema = z.enum([
  'not-selected',
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
])
export type ReviewerExecutionStatus = z.infer<typeof reviewerExecutionStatusSchema>

export const reviewCoverageStatusSchema = z.enum(['complete', 'partial'])
export type ReviewCoverageStatus = z.infer<typeof reviewCoverageStatusSchema>

export const resolvedReviewerSchema = z
  .object({
    description: z.string().min(1).max(500),
    error: z.string().min(1).max(1_000).nullable(),
    instructionsHash: z.string().length(64),
    model: z.string().min(1),
    name: z.string().min(1).max(80),
    profileId: z.uuid(),
    reasoningEffort: z.string().min(1),
    required: z.boolean(),
    selected: z.boolean(),
    status: reviewerExecutionStatusSchema,
  })
  .strict()
export type ResolvedReviewer = z.infer<typeof resolvedReviewerSchema>

export const resolvedReviewPlanSchema = z
  .object({
    coverageStatus: reviewCoverageStatusSchema,
    reviewers: z.array(resolvedReviewerSchema).max(24),
    workflowId: z.uuid().nullable(),
    workflowName: z.string().min(1).max(80),
  })
  .strict()
export type ResolvedReviewPlan = z.infer<typeof resolvedReviewPlanSchema>

export const standardResolvedReviewPlan: ResolvedReviewPlan = {
  coverageStatus: 'complete',
  reviewers: [],
  workflowId: null,
  workflowName: 'Standard Review',
}

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
    workflowId: z.uuid().nullable(),
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
    reviewPlan: resolvedReviewPlanSchema.default(standardResolvedReviewPlan),
  })
  .strict()
export type ReviewMetadata = z.infer<typeof reviewMetadataSchema>

export const reviewSummarySchema = reviewMetadataSchema
  .extend({
    findingCount: z.number().int().nonnegative(),
    hasUserStory: z.boolean(),
    highestPriority: reviewPrioritySchema.nullable(),
    selectedReviewerCount: z.number().int().nonnegative(),
    successfulReviewerCount: z.number().int().nonnegative(),
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
    state: z.enum([
      'cancelled',
      'completed',
      'completed-with-warnings',
      'failed',
      'preparing',
      'running',
      'saving',
    ]),
  })
  .strict()
export type ReviewProgress = z.infer<typeof reviewProgressSchema>

export const reviewRunStatusSchema = z.enum([
  'preparing',
  'running',
  'saving',
  'completed',
  'completed-with-warnings',
  'cancelled',
  'failed',
  'interrupted',
])
export type ReviewRunStatus = z.infer<typeof reviewRunStatusSchema>

export const coordinatorReviewStepId = 'coordinator'

export function reviewerReviewStepId(profileId: string): string {
  return `reviewer:${profileId}`
}

export const reviewStepKindSchema = z.enum(['coordinator', 'reviewer'])
export type ReviewStepKind = z.infer<typeof reviewStepKindSchema>

export const reviewStepReasoningSummarySchema = z
  .object({
    id: z.string().min(1).max(256),
    occurredAt: z.iso.datetime(),
    text: z.string().min(1).max(100_000),
  })
  .strict()
export type ReviewStepReasoningSummary = z.infer<typeof reviewStepReasoningSummarySchema>

export const reviewStepDetailSchema = z
  .object({
    endedAt: z.iso.datetime().nullable(),
    error: z.string().min(1).max(2_000).nullable(),
    id: z.string().min(1).max(256),
    kind: reviewStepKindSchema,
    output: structuredReviewSchema.nullable(),
    profileId: z.uuid().nullable(),
    reasoningSummaries: z.array(reviewStepReasoningSummarySchema).max(128),
    reasoningTruncated: z.boolean(),
    startedAt: z.iso.datetime().nullable(),
    status: reviewerExecutionStatusSchema,
  })
  .strict()
export type ReviewStepDetail = z.infer<typeof reviewStepDetailSchema>

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
    reviewer: z
      .object({
        model: z.string().min(1),
        name: z.string().min(1).max(80),
        profileId: z.uuid(),
        reasoningEffort: z.string().min(1),
        threadId: z.string().min(1).max(256),
      })
      .strict()
      .optional(),
    runId: z.uuid(),
    sequence: z.number().int().nonnegative(),
    status: activityEntryStatusSchema,
    stepId: z.string().min(1).max(256).nullable().default(null),
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
    reviewPlan: resolvedReviewPlanSchema.default(standardResolvedReviewPlan),
    reviewId: z.uuid().nullable(),
    startedAt: z.iso.datetime(),
    status: reviewRunStatusSchema,
  })
  .strict()
export type ReviewRunMetadata = z.infer<typeof reviewRunMetadataSchema>

export const reviewRunSummarySchema = reviewRunMetadataSchema
export type ReviewRunSummary = z.infer<typeof reviewRunSummarySchema>

export const reviewRunSchema = z
  .object({
    activity: z.array(agentActivityEntrySchema),
    metadata: reviewRunMetadataSchema,
    steps: z.array(reviewStepDetailSchema).default([]),
  })
  .strict()
export type ReviewRun = z.infer<typeof reviewRunSchema>

export const reviewRunUpdateSchema = z
  .object({
    entry: agentActivityEntrySchema.nullable(),
    run: reviewRunSummarySchema,
    step: reviewStepDetailSchema.nullable().default(null),
  })
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
  .object({
    agent: agentStatusSchema,
    reviewConfiguration: reviewConfigurationSchema,
    settings: appSettingsSchema,
  })
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
    enabledOptionalReviewerIds: z.array(z.uuid()).max(24),
    userStory: z
      .string()
      .max(12_000)
      .nullable()
      .transform((value) => value?.trim() || null),
    workflowId: z.uuid().nullable(),
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
export const reviewerProfileIdSchema = z.uuid()
export const workflowIdSchema = z.uuid()
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
  saveReviewerProfile(input: SaveReviewerProfileInput): Promise<Result<ReviewConfiguration>>
  saveWorkflow(input: SaveReviewWorkflowInput): Promise<Result<ReviewConfiguration>>
  selectInstructionFile(): Promise<Result<RepositorySnapshot>>
  selectRepository(): Promise<Result<RepositorySnapshot | null>>
  startReview(input: StartReviewInput): Promise<Result<ReviewDocument>>
  deleteReviewerProfile(profileId: string): Promise<Result<ReviewConfiguration>>
  deleteWorkflow(workflowId: string): Promise<Result<ReviewConfiguration>>
  updateRepositoryPreferences(
    input: UpdateRepositoryPreferencesInput,
  ): Promise<Result<RepositorySnapshot>>
  updateSettings(input: UpdateSettingsInput): Promise<Result<BootstrapState>>
}
