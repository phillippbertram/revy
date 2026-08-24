import { Badge } from '@revy/ui/components/badge'
import { Button } from '@revy/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@revy/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@revy/ui/components/dialog'
import { Label } from '@revy/ui/components/label'
import { ScrollArea } from '@revy/ui/components/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@revy/ui/components/select'
import { Separator } from '@revy/ui/components/separator'
import { Switch } from '@revy/ui/components/switch'
import { Textarea } from '@revy/ui/components/textarea'
import {
  AlertTriangle,
  BookOpenText,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  FileCode2,
  FolderGit2,
  FolderOpen,
  History,
  ListTree,
  LoaderCircle,
  PanelRightClose,
  RefreshCw,
  Settings2,
  Square,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import appIconUrl from '../../assets/app-icon.png'
import type {
  AgentActivityEntry,
  BootstrapState,
  RepositorySnapshot,
  Result,
  ReviewDocument,
  ReviewProgress,
  ReviewRun,
  ReviewSummary,
  SaveReviewerProfileInput,
  SaveReviewWorkflowInput,
  SourcePreview,
} from '../../shared/contracts.js'
import { coordinatorReviewStepId } from '../../shared/contracts.js'
import { formatLegacyReviewMarkdown } from '../../shared/review-formats.js'
import { ActivitySurface } from './ActivitySurface'
import { type Surface, useAppStore } from './app-store'
import { type CodeReference, MarkdownReview } from './MarkdownReview'
import { ReviewSetupSettings } from './ReviewSetupSettings'
import { ReviewStepInspector, type ReviewStepInspectorTab } from './ReviewStepInspector'
import { CopyButton, StructuredReview } from './StructuredReview'
import {
  resolveConsolidationStatus,
  resolveWorkflowGraphReviewers,
  WorkflowGraph,
  type WorkflowGraphReviewer,
} from './WorkflowGraph'

type SettingsPage = 'general' | 'review-setup'
type InspectReviewStep = (
  run: ReviewRun,
  stepId: string,
  tab?: ReviewStepInspectorTab,
  activityId?: string,
) => void

interface ActiveReviewPresentation {
  activity: AgentActivityEntry[]
  progress: ReviewProgress
  reviewers: WorkflowGraphReviewer[]
  run: ReviewRun | null
  workflowName: string
}

function resolveActiveReviewPresentation({
  active,
  enabledOptionalReviewerIds,
  liveActivity,
  progress,
  repository,
  reviewConfiguration,
}: {
  active: boolean
  enabledOptionalReviewerIds: string[]
  liveActivity: ReviewRun | null
  progress: ReviewProgress | null
  repository: RepositorySnapshot | null
  reviewConfiguration: BootstrapState['reviewConfiguration']
}): ActiveReviewPresentation | null {
  if (!active || !repository) {
    return null
  }
  const currentProgress: ReviewProgress =
    progress ??
    ({
      error: null,
      message: 'Starting the review…',
      reviewId: null,
      state: 'preparing',
    } satisfies ReviewProgress)
  const currentRun = liveActivity?.metadata.id === currentProgress.reviewId ? liveActivity : null
  if (currentRun) {
    return {
      activity: currentRun.activity,
      progress: currentProgress,
      reviewers: resolveWorkflowGraphReviewers(
        currentRun.metadata.reviewPlan,
        currentRun.activity,
        currentRun.steps,
      ),
      run: currentRun,
      workflowName: currentRun.metadata.reviewPlan.workflowName,
    }
  }
  const workflow = reviewConfiguration.workflows.find(
    (candidate) => candidate.id === repository.preferences.workflowId,
  )
  const profiles = new Map(reviewConfiguration.profiles.map((profile) => [profile.id, profile]))
  const reviewers: WorkflowGraphReviewer[] =
    workflow?.reviewers.flatMap((assignment) => {
      const profile = profiles.get(assignment.profileId)
      if (!profile) {
        return []
      }
      const selected =
        assignment.required || enabledOptionalReviewerIds.includes(assignment.profileId)
      return [
        {
          description: profile.description,
          name: profile.name,
          profileId: profile.id,
          required: assignment.required,
          selected,
          status: selected ? ('pending' as const) : ('not-selected' as const),
        },
      ]
    }) ?? []
  return {
    activity: [],
    progress: currentProgress,
    reviewers,
    run: null,
    workflowName: workflow?.name ?? 'Standard Review',
  }
}

function unwrapResult<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.value
}

function legacyRunFromReview(review: ReviewDocument): ReviewRun {
  return {
    activity: [],
    metadata: {
      baseBranch: review.metadata.baseBranch,
      branch: review.metadata.branch,
      endedAt: review.metadata.completedAt,
      error: null,
      fingerprint: review.metadata.fingerprint,
      headSha: review.metadata.headSha,
      id: review.metadata.id,
      model: review.metadata.model,
      reasoningEffort: review.metadata.reasoningEffort,
      repositoryName: review.metadata.repositoryName,
      repositoryRoot: review.metadata.repositoryRoot,
      reviewId: review.metadata.id,
      reviewPlan: review.metadata.reviewPlan,
      startedAt: review.metadata.createdAt,
      status:
        review.metadata.reviewPlan.coverageStatus === 'partial'
          ? 'completed-with-warnings'
          : 'completed',
    },
    steps: [],
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function branchLabel(repository: RepositorySnapshot): string {
  return repository.branch ?? `Detached at ${repository.headSha?.slice(0, 8) ?? 'unborn'}`
}

function reportRendererError(
  kind: 'error' | 'unhandled-rejection',
  value: unknown,
  fallback: string,
): void {
  const error = value instanceof Error ? value : null
  const message = (error?.message || (typeof value === 'string' ? value : fallback)).slice(0, 4_000)
  window.revy.reportRendererError({
    kind,
    message: message || fallback,
    stack: error?.stack?.slice(0, 16_000) || null,
  })
}

function isResizeObserverLoopError(value: unknown): boolean {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : ''
  return message.startsWith('ResizeObserver loop')
}

function ErrorBanner({ error, onClose }: { error: string; onClose: () => void }) {
  return (
    <div className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/10 px-6 py-3 text-sm text-red-200">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1">{error}</p>
      <button className="text-red-200/70 hover:text-red-100" onClick={onClose} type="button">
        Dismiss
      </button>
    </div>
  )
}

function SourcePanel({ onClose, source }: { onClose: () => void; source: SourcePreview }) {
  const lines = source.content.split('\n')
  return (
    <aside className="flex min-w-0 flex-col border-l bg-background/80">
      <div className="flex h-14 items-center gap-3 border-b px-4">
        <Code2 className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs font-medium">{source.path}</p>
          <p className="text-xs text-muted-foreground">
            Line {source.targetLine}
            {source.targetEndLine > source.targetLine ? `–${source.targetEndLine}` : ''}
          </p>
        </div>
        <Button aria-label="Close source preview" onClick={onClose} size="icon-sm" variant="ghost">
          <PanelRightClose />
        </Button>
      </div>
      {source.stale && (
        <div className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs leading-5 text-amber-100">
          This review is stale. The preview shows the current working-tree file.
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-black/20 py-3 font-mono text-xs leading-5">
        {lines.map((line, index) => {
          const lineNumber = source.startLine + index
          const highlighted = lineNumber >= source.targetLine && lineNumber <= source.targetEndLine
          return (
            <div
              className={`grid min-w-max grid-cols-[4rem_1fr] px-3 ${
                highlighted ? 'bg-primary/15 text-foreground' : 'text-foreground/75'
              }`}
              key={`${lineNumber}-${line}`}
            >
              <span className="select-none pr-4 text-right text-muted-foreground">
                {lineNumber}
              </span>
              <span className="whitespace-pre pr-8">{line || ' '}</span>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

interface SidebarProps {
  bootstrap: BootstrapState
  onCancelReview: () => void
  onOpenActivity: () => void
  onOpenRecent: (path: string) => void
  onSelectRepository: () => void
  onSelectSurface: (surface: Surface) => void
  progress: ReviewProgress | null
  repository: RepositorySnapshot | null
  repositoryChangeDisabled: boolean
  reviewRunning: boolean
  surface: Surface
}

function Sidebar({
  bootstrap,
  onCancelReview,
  onOpenActivity,
  onOpenRecent,
  onSelectRepository,
  onSelectSurface,
  progress,
  repository,
  repositoryChangeDisabled,
  reviewRunning,
  surface,
}: SidebarProps) {
  const items: Array<{ icon: typeof FolderGit2; id: Surface; label: string }> = [
    { icon: FolderGit2, id: 'repository', label: 'Overview' },
    { icon: History, id: 'reviews', label: 'Reviews' },
    { icon: ListTree, id: 'activity', label: 'Activity' },
  ]
  const recentRepositories = bootstrap.settings.recentRepositories.filter(
    (path) => path !== repository?.root,
  )
  const currentBranch = repository ? branchLabel(repository) : null
  const settingsShortcut = navigator.userAgent.includes('Macintosh') ? '⌘,' : 'Ctrl+,'

  return (
    <aside className="flex min-h-0 flex-col border-r bg-card/40">
      <div className="flex min-h-24 items-center gap-3 px-4 py-4">
        <img
          alt=""
          className="size-12 shrink-0 rounded-2xl border object-cover shadow-md shadow-black/30"
          src={appIconUrl}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-wide">REVY</p>
          <p className="mt-0.5 text-[0.68rem] leading-4 text-muted-foreground">
            Your code deserves a second opinion. Or five.
          </p>
        </div>
      </div>
      <div className="px-3 pb-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-2">
          <p className="text-[0.68rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Current project
          </p>
          <button
            className="text-xs font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-40"
            disabled={repositoryChangeDisabled}
            onClick={onSelectRepository}
            type="button"
          >
            {repository ? 'Change…' : 'Open…'}
          </button>
        </div>
        <div className="rounded-xl border bg-background/60 p-3 shadow-sm shadow-black/5">
          {repository && currentBranch ? (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FolderGit2 className="size-3.5" />
                </span>
                <p
                  className="min-w-0 flex-1 truncate text-sm font-semibold"
                  title={repository.name}
                >
                  {repository.name}
                </p>
              </div>
              <p
                className="mt-2 truncate font-mono text-[0.68rem] text-muted-foreground"
                title={repository.root}
              >
                {repository.root}
              </p>
              {repository.baseBranch && (
                <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[0.68rem] text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate" title={currentBranch}>
                    {currentBranch}
                  </span>
                  <span className="sr-only">compared with</span>
                  <span aria-hidden="true" className="shrink-0 text-foreground/60">
                    →
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={repository.baseBranch}>
                    {repository.baseBranch}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="py-1">
              <p className="text-sm font-medium">No repository selected</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Open a local repository to begin.
              </p>
            </div>
          )}
        </div>
      </div>
      <Separator />
      <nav className="space-y-1 px-3 py-3">
        <p className="mb-2 px-2 text-[0.68rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Project
        </p>
        {items.map((item) => {
          const Icon = item.icon
          const disabled = (item.id === 'reviews' || item.id === 'activity') && !repository
          return (
            <button
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                surface === item.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              } disabled:pointer-events-none disabled:opacity-40`}
              aria-current={surface === item.id ? 'page' : undefined}
              disabled={disabled}
              key={item.id}
              onClick={() => onSelectSurface(item.id)}
              type="button"
            >
              <Icon className="size-4" />
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.id === 'activity' && reviewRunning && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[0.62rem] font-semibold tracking-wide text-primary uppercase">
                  Live
                </span>
              )}
            </button>
          )
        })}
      </nav>
      <Separator />
      <div className="min-h-0 flex-1 px-3 py-4">
        <p className="mb-2 px-2 text-[0.68rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Recent
        </p>
        <ScrollArea className="h-full">
          <div className="space-y-1 pr-2">
            {recentRepositories.length === 0 && (
              <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">
                {repository
                  ? 'No other recent repositories.'
                  : 'Open a repository to keep it close at hand.'}
              </p>
            )}
            {recentRepositories.map((path) => (
              <button
                className="group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent/60 disabled:pointer-events-none disabled:opacity-40"
                disabled={repositoryChangeDisabled}
                key={path}
                onClick={() => onOpenRecent(path)}
                type="button"
              >
                <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs">{path.split('/').at(-1)}</span>
                <ChevronRight className="size-3 opacity-0 group-hover:opacity-60" />
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
      {reviewRunning && progress && (
        <div className="mx-3 mb-3 rounded-xl border border-primary/30 bg-primary/10 p-3 shadow-lg shadow-primary/5">
          <div className="flex items-center gap-2">
            <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
            <p className="text-sm font-semibold">Agent active</p>
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {progress.message}
          </p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              className="text-xs font-medium text-primary hover:underline"
              onClick={onOpenActivity}
              type="button"
            >
              Open activity
            </button>
            <Button
              aria-label="Cancel review"
              disabled={!progress.reviewId}
              onClick={onCancelReview}
              size="icon-sm"
              variant="outline"
            >
              <Square className="fill-current" />
            </Button>
          </div>
        </div>
      )}
      <div className="border-t p-3">
        <div className="flex items-start gap-2.5 px-3 py-2">
          <span
            className={`mt-1 size-2 shrink-0 rounded-full ${
              bootstrap.agent.state === 'ready' ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">Codex {bootstrap.agent.state}</p>
            <p className="mt-1 break-words font-mono text-[0.68rem] leading-4 text-muted-foreground [overflow-wrap:anywhere]">
              {bootstrap.agent.version ?? 'Not connected'}
            </p>
          </div>
        </div>
        <DialogTrigger asChild>
          <button
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            type="button"
          >
            <Settings2 className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 text-sm font-medium text-foreground">Settings</span>
            <kbd className="rounded border bg-muted/50 px-1.5 py-0.5 font-sans text-[0.62rem] text-muted-foreground">
              {settingsShortcut}
            </kbd>
          </button>
        </DialogTrigger>
      </div>
    </aside>
  )
}

interface RepositorySurfaceProps {
  activeReview: ActiveReviewPresentation | null
  agentReady: boolean
  busy: boolean
  onChooseInstructions: () => void
  onInspectStep: InspectReviewStep
  onRefresh: () => void
  onSelectRepository: () => void
  onStartReview: () => void
  onToggleOptionalReviewer: (profileId: string, enabled: boolean) => void
  onUserStoryChange: (value: string) => void
  onUpdateBase: (base: string) => void
  onUpdateInstructions: (path: string | null) => void
  onUpdateWorkflow: (workflowId: string | null) => void
  progress: ReviewProgress | null
  repository: RepositorySnapshot | null
  reviewConfiguration: BootstrapState['reviewConfiguration']
  selectedStepId: string | null
  enabledOptionalReviewerIds: string[]
  userStory: string
}

function RepositorySurface({
  activeReview,
  agentReady,
  busy,
  onChooseInstructions,
  onInspectStep,
  onRefresh,
  onSelectRepository,
  onStartReview,
  onToggleOptionalReviewer,
  onUserStoryChange,
  onUpdateBase,
  onUpdateInstructions,
  onUpdateWorkflow,
  progress,
  repository,
  reviewConfiguration,
  selectedStepId,
  enabledOptionalReviewerIds,
  userStory,
}: RepositorySurfaceProps) {
  if (!repository) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <div className="max-w-xl text-center">
          <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl border bg-card text-primary shadow-xl shadow-black/10">
            <FolderGit2 className="size-7" />
          </div>
          <Badge className="mb-4" variant="secondary">
            Local and read-only
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight">Open a repository to review.</h1>
          <p className="mx-auto mt-4 max-w-md leading-7 text-muted-foreground">
            Revy combines branch, staged, unstaged, and untracked changes into one focused Codex
            review.
          </p>
          <Button className="mt-7" disabled={busy} onClick={onSelectRepository} size="lg">
            <FolderGit2 />
            Choose repository
          </Button>
        </div>
      </div>
    )
  }

  const reviewRunning = progress && ['preparing', 'running', 'saving'].includes(progress.state)
  const instructionsRequired =
    repository.instructionFiles.length > 1 && !repository.preferences.instructionFile
  const canReview =
    agentReady &&
    repository.files.length > 0 &&
    Boolean(repository.baseBranch) &&
    !instructionsRequired &&
    !reviewRunning
  const staged = repository.files.filter((file) => file.sources.includes('staged')).length
  const untracked = repository.files.filter((file) => file.sources.includes('untracked')).length
  const workflow = reviewConfiguration.workflows.find(
    (candidate) => candidate.id === repository.preferences.workflowId,
  )
  const profiles = new Map(reviewConfiguration.profiles.map((profile) => [profile.id, profile]))

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8 lg:p-10">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <Badge
              className="min-w-0 max-w-72 shrink truncate"
              title={branchLabel(repository)}
              variant="outline"
            >
              {branchLabel(repository)}
            </Badge>
            {repository.baseBranch && (
              <>
                <span className="sr-only">compared with</span>
                <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">
                  →
                </span>
                <span
                  className="min-w-0 max-w-72 truncate text-xs text-muted-foreground"
                  title={repository.baseBranch}
                >
                  {repository.baseBranch}
                </span>
              </>
            )}
          </div>
          <h1 className="truncate text-3xl font-semibold tracking-tight">{repository.name}</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{repository.root}</p>
        </div>
        <div className="flex gap-2">
          <Button disabled={busy || Boolean(reviewRunning)} onClick={onRefresh} variant="outline">
            <RefreshCw />
            Refresh
          </Button>
          <Button disabled={!canReview} onClick={onStartReview}>
            {reviewRunning ? <LoaderCircle className="animate-spin" /> : <Bot />}
            {reviewRunning ? 'Reviewing…' : 'Start review'}
          </Button>
        </div>
      </header>

      {!agentReady && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <AlertTriangle className="size-4" />
          Connect Codex in Settings before starting a review.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Changed files', value: repository.files.length },
          { label: 'Staged', value: staged },
          { label: 'Untracked', value: untracked },
        ].map((item) => (
          <Card className="gap-2 py-4" key={item.label}>
            <CardContent className="px-5">
              <p className="text-2xl font-semibold">{item.value}</p>
              <p className="text-xs text-muted-foreground">{item.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {activeReview && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Live workflow</CardTitle>
                <CardDescription className="mt-2">{activeReview.progress.message}</CardDescription>
              </div>
              <Badge variant="secondary">{activeReview.workflowName}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <WorkflowGraph
              consolidationStatus={resolveConsolidationStatus(
                activeReview.progress.state,
                activeReview.reviewers,
                activeReview.run?.steps.find((step) => step.id === coordinatorReviewStepId),
              )}
              onStepClick={
                activeReview.run
                  ? (stepId) => onInspectStep(activeReview.run as ReviewRun, stepId)
                  : undefined
              }
              reviewers={activeReview.reviewers}
              selectedStepId={activeReview.run ? selectedStepId : null}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Review scope</CardTitle>
          <CardDescription>
            Choose the comparison base, optional project rules, and story context.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Base branch</Label>
            <Select
              {...(repository.baseBranch ? { value: repository.baseBranch } : {})}
              onValueChange={onUpdateBase}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a base branch" />
              </SelectTrigger>
              <SelectContent>
                {repository.branches.map((branch) => (
                  <SelectItem key={branch} value={branch}>
                    {branch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label>Project review instructions</Label>
              <button
                className="text-xs text-primary hover:underline"
                onClick={onChooseInstructions}
                type="button"
              >
                Choose file…
              </button>
            </div>
            <Select
              value={repository.preferences.instructionFile ?? 'none'}
              onValueChange={(value) => onUpdateInstructions(value === 'none' ? null : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No additional review skill</SelectItem>
                {repository.instructionFiles.map((path) => (
                  <SelectItem key={path} value={path}>
                    {path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {instructionsRequired && (
              <p className="text-xs leading-5 text-amber-200">
                Multiple review skills were found. Choose one before starting.
              </p>
            )}
          </div>
          <div className="space-y-3 md:col-span-2">
            <div className="space-y-2">
              <Label>Review workflow</Label>
              <Select
                disabled={Boolean(reviewRunning)}
                value={workflow?.id ?? 'standard'}
                onValueChange={(value) => onUpdateWorkflow(value === 'standard' ? null : value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard Review</SelectItem>
                  {reviewConfiguration.workflows.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {workflow ? (
              <div className="grid gap-2 rounded-lg border bg-muted/15 p-4 sm:grid-cols-2">
                {workflow.reviewers.map((assignment) => {
                  const profile = profiles.get(assignment.profileId)
                  if (!profile) {
                    return null
                  }
                  const checked =
                    assignment.required || enabledOptionalReviewerIds.includes(profile.id)
                  return (
                    <div
                      className="flex items-start justify-between gap-4 rounded-lg border bg-background/40 p-3"
                      key={profile.id}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{profile.name}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {profile.description}
                        </p>
                        <Badge className="mt-2" variant="outline">
                          {assignment.required ? 'Required' : 'Optional'}
                        </Badge>
                      </div>
                      <Switch
                        checked={checked}
                        disabled={assignment.required || Boolean(reviewRunning)}
                        onCheckedChange={(enabled) => onToggleOptionalReviewer(profile.id, enabled)}
                      />
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">
                Uses the existing single-agent review without specialist reviewers.
              </p>
            )}
          </div>
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="user-story">User story (optional)</Label>
              <span className="text-xs text-muted-foreground">{userStory.length} / 12,000</span>
            </div>
            <Textarea
              className="min-h-40 resize-y"
              disabled={Boolean(reviewRunning)}
              id="user-story"
              maxLength={12_000}
              onChange={(event) => onUserStoryChange(event.target.value)}
              placeholder={
                'Paste a story, description, and acceptance criteria. Markdown is supported.'
              }
              value={userStory}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Used only for the next review and saved with a successful result.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="min-h-0 gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-5">
          <CardTitle>Changed files</CardTitle>
          <CardDescription>The complete review scope without a full diff browser.</CardDescription>
        </CardHeader>
        {repository.files.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <CheckCircle2 className="mb-3 size-7 text-emerald-400" />
            <p className="font-medium">Nothing to review</p>
            <p className="mt-1 text-sm text-muted-foreground">The branch and worktree are clean.</p>
          </div>
        ) : (
          <div className="divide-y">
            {repository.files.map((file) => (
              <div className="flex items-center gap-3 px-6 py-3" key={file.path}>
                <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs">{file.path}</p>
                  {file.previousPath && (
                    <p className="truncate text-xs text-muted-foreground">
                      from {file.previousPath}
                    </p>
                  )}
                </div>
                <div className="hidden gap-1 sm:flex">
                  {file.sources.map((source) => (
                    <Badge key={source} variant="secondary">
                      {source}
                    </Badge>
                  ))}
                </div>
                <Badge variant="outline">{file.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function ActiveReviewProgressSurface({
  activeReview,
  onCancelReview,
  onInspectStep,
  selectedStepId,
}: {
  activeReview: ActiveReviewPresentation
  onCancelReview: () => void
  onInspectStep: InspectReviewStep
  selectedStepId: string | null
}) {
  const stages = [
    {
      description: 'Capturing the repository context.',
      id: 'preparing',
      label: 'Preparing',
    },
    {
      description: 'Reviewing the selected changes.',
      id: 'running',
      label: 'Reviewing',
    },
    {
      description: 'Validating and storing the result.',
      id: 'saving',
      label: 'Saving',
    },
  ] as const
  const currentStage = ['completed', 'completed-with-warnings'].includes(
    activeReview.progress.state,
  )
    ? stages.length
    : stages.findIndex((stage) => stage.id === activeReview.progress.state)
  const recentActivity = activeReview.activity.slice(-4).toReversed()

  return (
    <div className="mx-auto max-w-4xl px-8 py-8 lg:px-12">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-5 border-b pb-6">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge variant="secondary">In progress</Badge>
            <Badge variant="outline">{activeReview.workflowName}</Badge>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-primary/10 text-primary">
              <LoaderCircle className="size-5 animate-spin" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Review in progress</h1>
              <p className="mt-1 text-sm text-muted-foreground">{activeReview.progress.message}</p>
            </div>
          </div>
        </div>
        <Button
          disabled={!activeReview.progress.reviewId}
          onClick={onCancelReview}
          size="sm"
          variant="outline"
        >
          <Square className="fill-current" />
          Cancel review
        </Button>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {stages.map((stage, index) => {
          const complete = currentStage > index
          const active = currentStage === index
          return (
            <div
              className={`rounded-xl border p-4 transition-colors ${
                active
                  ? 'border-primary/40 bg-primary/10'
                  : complete
                    ? 'border-emerald-400/25 bg-emerald-400/5'
                    : 'bg-card/40'
              }`}
              key={stage.id}
            >
              <div className="flex items-center gap-2">
                {complete ? (
                  <CheckCircle2 className="size-4 text-emerald-400" />
                ) : active ? (
                  <LoaderCircle className="size-4 animate-spin text-primary" />
                ) : (
                  <Clock3 className="size-4 text-muted-foreground" />
                )}
                <p className="text-sm font-semibold">{stage.label}</p>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{stage.description}</p>
            </div>
          )
        })}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Workflow</CardTitle>
          <CardDescription>
            Status updates appear here while the review is running. Connections animate during
            active work.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkflowGraph
            consolidationStatus={resolveConsolidationStatus(
              activeReview.progress.state,
              activeReview.reviewers,
              activeReview.run?.steps.find((step) => step.id === coordinatorReviewStepId),
            )}
            onStepClick={
              activeReview.run
                ? (stepId) => onInspectStep(activeReview.run as ReviewRun, stepId)
                : undefined
            }
            reviewers={activeReview.reviewers}
            selectedStepId={activeReview.run ? selectedStepId : null}
          />
        </CardContent>
      </Card>

      {recentActivity.length > 0 && (
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-5">
            <CardTitle>Latest activity</CardTitle>
            <CardDescription>
              Recent safe status events. Open a workflow step for its result and reasoning summary.
            </CardDescription>
          </CardHeader>
          <div className="divide-y">
            {recentActivity.map((entry) => (
              <div className="flex items-center gap-3 px-6 py-3" key={entry.id}>
                {entry.status === 'completed' ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                ) : (
                  <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
                )}
                <p className="min-w-0 flex-1 truncate text-sm">{entry.title}</p>
                <Badge variant="outline">{entry.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="mt-5 text-center text-xs text-muted-foreground">
        The completed review will replace this progress view automatically.
      </p>
    </div>
  )
}

interface ReviewsSurfaceProps {
  activeReview: ActiveReviewPresentation | null
  onCancelReview: () => void
  onCopy: (text: string) => Promise<boolean>
  onDelete: (id: string) => void
  onOpenExternal: (url: string) => void
  onOpenReview: (id: string) => void
  onOpenSource: (reference: CodeReference) => void
  onInspectStep: InspectReviewStep
  onCloseSource: () => void
  review: ReviewDocument | null
  reviewRun: ReviewRun | null
  reviews: ReviewSummary[]
  selectedStepId: string | null
  source: SourcePreview | null
}

function ReviewsSurface({
  activeReview,
  onCancelReview,
  onCloseSource,
  onCopy,
  onDelete,
  onOpenExternal,
  onOpenReview,
  onOpenSource,
  onInspectStep,
  review,
  reviewRun,
  reviews,
  selectedStepId,
  source,
}: ReviewsSurfaceProps) {
  return (
    <div
      className={`grid h-full min-h-0 min-w-0 ${
        source
          ? 'grid-cols-[17rem_minmax(0,1fr)_minmax(22rem,34rem)]'
          : 'grid-cols-[17rem_minmax(0,1fr)]'
      }`}
    >
      <aside className="min-h-0 min-w-0 overflow-hidden border-r bg-card/20">
        <div className="flex h-16 items-center border-b px-5">
          <div>
            <h1 className="font-semibold">Review history</h1>
            <p className="text-xs text-muted-foreground">{reviews.length} saved reviews</p>
          </div>
        </div>
        <ScrollArea className="h-[calc(100%-4rem)] w-full [&>[data-slot=scroll-area-viewport]>div]:min-w-0! [&>[data-slot=scroll-area-viewport]>div]:w-full! [&>[data-slot=scroll-area-viewport]>div]:block!">
          <div className="min-w-0 space-y-1 p-3">
            {activeReview && (
              <div className="mb-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-3">
                <div className="flex items-center gap-2">
                  <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">Review in progress</p>
                  <Badge variant="secondary">Live</Badge>
                </div>
                <p className="mt-2 truncate text-xs text-muted-foreground">
                  {activeReview.workflowName}
                </p>
              </div>
            )}
            {reviews.length === 0 && !activeReview && (
              <div className="px-3 py-10 text-center text-sm leading-6 text-muted-foreground">
                Completed reviews will appear here.
              </div>
            )}
            {reviews.map((item) => (
              <button
                className={`block w-full min-w-0 max-w-full overflow-hidden rounded-lg border px-3 py-3 text-left transition-colors hover:bg-accent/50 ${
                  review?.metadata.id === item.id
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-transparent'
                }`}
                key={item.id}
                onClick={() => onOpenReview(item.id)}
                type="button"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium"
                    title={item.branch ?? 'Detached HEAD'}
                  >
                    {item.branch ?? 'Detached HEAD'}
                  </span>
                  <span className="sr-only">compared with</span>
                  <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">
                    →
                  </span>
                  <span
                    className="min-w-0 max-w-[45%] truncate text-xs text-muted-foreground"
                    title={item.baseBranch}
                  >
                    {item.baseBranch}
                  </span>
                  {item.stale && <span className="size-1.5 shrink-0 rounded-full bg-amber-400" />}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.hasUserStory && <Badge variant="outline">Story</Badge>}
                  <Badge
                    className="max-w-full truncate"
                    title={item.reviewPlan.workflowName}
                    variant="outline"
                  >
                    {item.reviewPlan.workflowName}
                  </Badge>
                  {item.reviewPlan.coverageStatus === 'partial' && (
                    <Badge variant="outline">Partial coverage</Badge>
                  )}
                  {item.format === 'structured-v1' ? (
                    <>
                      <Badge variant="secondary">
                        {item.findingCount} {item.findingCount === 1 ? 'finding' : 'findings'}
                      </Badge>
                      {item.highestPriority && (
                        <Badge variant="outline">{item.highestPriority}</Badge>
                      )}
                    </>
                  ) : (
                    <Badge variant="outline">Legacy</Badge>
                  )}
                </div>
                <p className="mt-2 flex items-center gap-1 text-[0.68rem] text-muted-foreground">
                  <Clock3 className="size-3" />
                  {formatDate(item.completedAt)}
                </p>
              </button>
            ))}
          </div>
        </ScrollArea>
      </aside>

      <main className="min-h-0 min-w-0 overflow-auto">
        {activeReview ? (
          <ActiveReviewProgressSurface
            activeReview={activeReview}
            onCancelReview={onCancelReview}
            onInspectStep={onInspectStep}
            selectedStepId={selectedStepId}
          />
        ) : !review ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
              <History className="mx-auto mb-3 size-8 text-muted-foreground/60" />
              <p className="font-medium">Select a review</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Saved reviews are immutable and stay in Revy's app data.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl px-8 py-8 lg:px-12">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {review.content ? 'Structured review' : 'Legacy review'}
                </Badge>
                <Badge variant="outline">{review.metadata.reviewPlan.workflowName}</Badge>
                <Badge variant="outline">{review.metadata.model}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <CopyButton
                  label="Copy review"
                  onCopy={onCopy}
                  showLabel
                  text={
                    review.content ? review.markdown : formatLegacyReviewMarkdown(review.markdown)
                  }
                />
                <Button onClick={() => onDelete(review.metadata.id)} size="sm" variant="ghost">
                  <Trash2 />
                  Delete
                </Button>
              </div>
            </div>
            {review.stale && (
              <div className="mb-6 flex gap-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                <AlertTriangle className="mt-1 size-4 shrink-0" />
                HEAD or the working tree changed after this review. Code links show current files.
              </div>
            )}
            {review.metadata.reviewPlan.coverageStatus === 'partial' && (
              <div className="mb-6 flex gap-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                <AlertTriangle className="mt-1 size-4 shrink-0" />
                This review has partial coverage because one or more selected optional reviewers did
                not complete.
              </div>
            )}
            <details className="group mb-6 rounded-xl border bg-card text-card-foreground shadow-sm">
              <summary className="flex cursor-pointer list-none items-center gap-4 rounded-xl px-5 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-primary/10 text-primary">
                  <Bot className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-none">Review workflow</span>
                  <span className="mt-2 block text-sm text-muted-foreground">
                    {review.metadata.reviewPlan.reviewers.length === 0
                      ? 'Built-in single-agent review.'
                      : `${
                          review.metadata.reviewPlan.reviewers.filter(
                            (reviewer) => reviewer.status === 'completed',
                          ).length
                        } of ${
                          review.metadata.reviewPlan.reviewers.filter(
                            (reviewer) => reviewer.selected,
                          ).length
                        } selected reviewers completed.`}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <div className="space-y-3 border-t p-4">
                <WorkflowGraph
                  consolidationStatus={resolveConsolidationStatus(
                    'completed',
                    resolveWorkflowGraphReviewers(
                      review.metadata.reviewPlan,
                      reviewRun?.activity ?? [],
                      reviewRun?.steps ?? [],
                    ),
                    reviewRun?.steps.find((step) => step.id === coordinatorReviewStepId),
                  )}
                  onStepClick={reviewRun ? (stepId) => onInspectStep(reviewRun, stepId) : undefined}
                  reviewers={resolveWorkflowGraphReviewers(
                    review.metadata.reviewPlan,
                    reviewRun?.activity ?? [],
                    reviewRun?.steps ?? [],
                  )}
                  selectedStepId={reviewRun ? selectedStepId : null}
                />
                {review.metadata.reviewPlan.reviewers
                  .filter((reviewer) => reviewer.error)
                  .map((reviewer) => (
                    <div
                      className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3"
                      key={reviewer.profileId}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium">{reviewer.name}</p>
                        <Badge variant="outline">{reviewer.status}</Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-amber-200">{reviewer.error}</p>
                    </div>
                  ))}
              </div>
            </details>
            {review.context.userStory && (
              <details
                className="group mb-6 rounded-xl border bg-card text-card-foreground shadow-sm"
                key={review.metadata.id}
              >
                <summary className="flex cursor-pointer list-none items-center gap-4 rounded-xl px-5 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-primary/10 text-primary">
                    <BookOpenText className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-none">User story</span>
                    <span className="mt-2 block text-sm text-muted-foreground">
                      Requirement context supplied for this review.
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                </summary>
                <div className="border-t px-5 py-4">
                  <MarkdownReview
                    markdown={review.context.userStory}
                    onCodeReference={onOpenSource}
                    onExternalLink={onOpenExternal}
                  />
                </div>
              </details>
            )}
            {review.content ? (
              <StructuredReview
                content={review.content}
                onCopy={onCopy}
                onOpenExternal={onOpenExternal}
                onOpenSource={onOpenSource}
              />
            ) : (
              <MarkdownReview
                markdown={review.markdown}
                onCodeReference={onOpenSource}
                onExternalLink={onOpenExternal}
              />
            )}
            {review.metadata.instructionSources.length > 0 && (
              <div className="mt-10 border-t pt-5">
                <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Instruction sources
                </p>
                {review.metadata.instructionSources.map((path) => (
                  <p className="truncate font-mono text-xs text-muted-foreground" key={path}>
                    {path}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      {source && <SourcePanel onClose={onCloseSource} source={source} />}
    </div>
  )
}

interface SettingsContentProps {
  bootstrap: BootstrapState
  busy: boolean
  onChooseExecutable: () => void
  onOpenLogFolder: () => void
  onRefreshAgent: () => void
  onDeleteReviewerProfile: (profileId: string) => Promise<boolean>
  onDeleteWorkflow: (workflowId: string) => Promise<boolean>
  onDirtyChange: (dirty: boolean) => void
  onSaveReviewerProfile: (input: SaveReviewerProfileInput) => Promise<boolean>
  onSaveWorkflow: (input: SaveReviewWorkflowInput) => Promise<boolean>
  onUpdateSettings: (input: Parameters<typeof window.revy.updateSettings>[0]) => void
}

function SettingsContent({
  bootstrap,
  busy,
  onChooseExecutable,
  onOpenLogFolder,
  onRefreshAgent,
  onDeleteReviewerProfile,
  onDeleteWorkflow,
  onDirtyChange,
  onSaveReviewerProfile,
  onSaveWorkflow,
  onUpdateSettings,
}: SettingsContentProps) {
  const [instructions, setInstructions] = useState(bootstrap.settings.personalInstructions)
  const [page, setPage] = useState<SettingsPage>('general')
  const [reviewSetupDirty, setReviewSetupDirty] = useState(false)
  useEffect(() => setInstructions(bootstrap.settings.personalInstructions), [bootstrap.settings])
  useEffect(() => onDirtyChange(reviewSetupDirty), [onDirtyChange, reviewSetupDirty])
  const model = bootstrap.agent.models.find(
    (candidate) => candidate.id === bootstrap.settings.model,
  )
  const pages: Array<{ icon: typeof Settings2; id: SettingsPage; label: string }> = [
    { icon: Settings2, id: 'general', label: 'General' },
    { icon: ListTree, id: 'review-setup', label: 'Review Setup' },
  ]

  function selectPage(nextPage: SettingsPage): void {
    if (
      page === 'review-setup' &&
      nextPage !== 'review-setup' &&
      reviewSetupDirty &&
      !window.confirm('Discard unsaved review setup changes?')
    ) {
      return
    }
    if (page === 'review-setup' && nextPage !== 'review-setup') {
      setReviewSetupDirty(false)
    }
    setPage(nextPage)
  }

  return (
    <div className="space-y-6 p-6 md:p-7">
      <nav aria-label="Settings sections" className="grid gap-2 sm:grid-cols-2">
        {pages.map((item) => {
          const Icon = item.icon
          return (
            <button
              aria-current={page === item.id ? 'page' : undefined}
              className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                page === item.id
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              }`}
              key={item.id}
              onClick={() => selectPage(item.id)}
              type="button"
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          )
        })}
      </nav>

      {page === 'general' && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Codex App Server</CardTitle>
                  <CardDescription className="mt-2">
                    Experimental local integration. Revy never installs, updates, or authenticates
                    Codex.
                  </CardDescription>
                </div>
                <Badge variant={bootstrap.agent.state === 'ready' ? 'default' : 'secondary'}>
                  {bootstrap.agent.state}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-[9rem_1fr]">
                <span className="text-muted-foreground">Executable</span>
                <span className="truncate font-mono text-xs">
                  {bootstrap.agent.executable ?? 'Not detected'}
                </span>
                <span className="text-muted-foreground">Version</span>
                <span>{bootstrap.agent.version ?? '—'}</span>
                <span className="text-muted-foreground">Account</span>
                <span>{bootstrap.agent.accountLabel ?? '—'}</span>
              </div>
              {bootstrap.agent.error && (
                <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                  {bootstrap.agent.error}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={onRefreshAgent} variant="outline">
                  <RefreshCw />
                  Retry connection
                </Button>
                <Button disabled={busy} onClick={onChooseExecutable} variant="ghost">
                  Choose executable…
                </Button>
              </div>
              {bootstrap.agent.state !== 'ready' && (
                <p className="text-xs leading-5 text-muted-foreground">
                  Install the Codex CLI, run{' '}
                  <code className="rounded bg-muted px-1 py-0.5">codex login</code>, then retry.
                  Revy does not change{' '}
                  <code className="rounded bg-muted px-1 py-0.5">~/.codex/config.toml</code>.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Diagnostics</CardTitle>
              <CardDescription>
                Local rotating logs help diagnose Revy, Electron, Git, and Codex connection
                failures.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-5 rounded-lg border bg-muted/20 p-4">
                <div>
                  <Label htmlFor="debug-logging">Enable debug logging</Label>
                  <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">
                    Adds local paths and stack traces until you turn it off. Repository contents,
                    prompts, reasoning, tool arguments, and command output are never logged.
                  </p>
                </div>
                <Switch
                  checked={bootstrap.settings.debugLoggingEnabled}
                  disabled={busy}
                  id="debug-logging"
                  onCheckedChange={(checked) => onUpdateSettings({ debugLoggingEnabled: checked })}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs leading-5 text-muted-foreground">
                  Revy keeps one 5 MiB log and one rotated archive on this computer.
                </p>
                <Button disabled={busy} onClick={onOpenLogFolder} variant="outline">
                  <FolderOpen />
                  Open log folder
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Model and style</CardTitle>
              <CardDescription>
                Models and reasoning efforts come directly from App Server.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Model</Label>
                <Select
                  disabled={bootstrap.agent.models.length === 0}
                  {...(bootstrap.settings.model ? { value: bootstrap.settings.model } : {})}
                  onValueChange={(value) => onUpdateSettings({ model: value })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="No models available" />
                  </SelectTrigger>
                  <SelectContent>
                    {bootstrap.agent.models.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reasoning effort</Label>
                <Select
                  disabled={!model}
                  {...(bootstrap.settings.reasoningEffort
                    ? { value: bootstrap.settings.reasoningEffort }
                    : {})}
                  onValueChange={(value) => onUpdateSettings({ reasoningEffort: value })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select effort" />
                  </SelectTrigger>
                  <SelectContent>
                    {model?.supportedReasoningEfforts.map((effort) => (
                      <SelectItem key={effort.reasoningEffort} value={effort.reasoningEffort}>
                        {effort.reasoningEffort}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Personal instructions</CardTitle>
              <CardDescription>
                Applied after the read-only contract, structured format, and project rules.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                className="min-h-32 resize-y"
                maxLength={12_000}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="For example: Keep findings direct and explain user impact."
                value={instructions}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {instructions.length} / 12,000
                </span>
                <Button
                  disabled={instructions === bootstrap.settings.personalInstructions}
                  onClick={() => onUpdateSettings({ personalInstructions: instructions })}
                >
                  Save instructions
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {page === 'review-setup' && (
        <ReviewSetupSettings
          bootstrap={bootstrap}
          busy={busy}
          onDeleteReviewerProfile={onDeleteReviewerProfile}
          onDeleteWorkflow={onDeleteWorkflow}
          onDirtyChange={setReviewSetupDirty}
          onSaveReviewerProfile={onSaveReviewerProfile}
          onSaveWorkflow={onSaveWorkflow}
        />
      )}
    </div>
  )
}

export function App() {
  const activity = useAppStore((state) => state.activity)
  const bootstrap = useAppStore((state) => state.bootstrap)
  const busy = useAppStore((state) => state.busy)
  const enabledOptionalReviewerIds = useAppStore((state) => state.enabledOptionalReviewerIds)
  const error = useAppStore((state) => state.error)
  const liveActivity = useAppStore((state) => state.liveActivity)
  const progress = useAppStore((state) => state.progress)
  const repository = useAppStore((state) => state.repository)
  const review = useAppStore((state) => state.review)
  const reviewRun = useAppStore((state) => state.reviewRun)
  const reviewStarting = useAppStore((state) => state.reviewStarting)
  const reviews = useAppStore((state) => state.reviews)
  const runs = useAppStore((state) => state.runs)
  const settingsDirty = useAppStore((state) => state.settingsDirty)
  const settingsOpen = useAppStore((state) => state.settingsOpen)
  const source = useAppStore((state) => state.source)
  const stepInspector = useAppStore((state) => state.stepInspector)
  const surface = useAppStore((state) => state.surface)
  const userStory = useAppStore((state) => state.userStory)
  const {
    acceptRepository,
    applyActivityUpdate,
    applyReviewConfiguration,
    beginReview,
    completeReview,
    failReview,
    openReview: presentReview,
    setActivity,
    setBootstrap,
    setBusy,
    setError,
    setProgress,
    setRepository,
    setReview,
    setReviewRun,
    setReviewStarting,
    setReviews,
    setRuns,
    setSettingsDirty,
    setSettingsOpen,
    setSource,
    setStepInspector,
    setSurface,
    setUserStory,
    syncOptionalReviewerDefaults,
    toggleOptionalReviewer,
  } = useAppStore((state) => state.actions)
  const workflowDefaultsKey =
    bootstrap?.reviewConfiguration.workflows
      .map(
        (workflow) =>
          `${workflow.id}:${workflow.reviewers
            .map(
              (reviewer) => `${reviewer.profileId}:${reviewer.required}:${reviewer.defaultEnabled}`,
            )
            .join(',')}`,
      )
      .join('|') ?? ''

  const reviewRunning = useMemo(
    () =>
      reviewStarting ||
      Boolean(progress && ['preparing', 'running', 'saving'].includes(progress.state)),
    [progress, reviewStarting],
  )

  useEffect(() => {
    const unsubscribe = window.revy.onReviewProgress(setProgress)
    const onError = (event: ErrorEvent): void => {
      const value = event.error ?? event.message
      if (isResizeObserverLoopError(value)) {
        event.preventDefault()
        return
      }
      reportRendererError('error', value, 'Renderer error')
    }
    const onUnhandledRejection = (event: PromiseRejectionEvent): void =>
      reportRendererError('unhandled-rejection', event.reason, 'Unhandled renderer rejection')
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    void (async () => {
      try {
        setBootstrap(unwrapResult(await window.revy.getBootstrap()))
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Revy could not start.')
      }
    })()
    return () => {
      unsubscribe()
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  useEffect(() => {
    function openSettingsWithShortcut(event: KeyboardEvent): void {
      if (
        event.code === 'Comma' &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault()
        setSettingsOpen(true)
      }
    }

    window.addEventListener('keydown', openSettingsWithShortcut)
    return () => window.removeEventListener('keydown', openSettingsWithShortcut)
  }, [])

  useEffect(() => {
    if (!repository) {
      return undefined
    }
    return window.revy.onActivityUpdate((update) => {
      applyActivityUpdate(update)
    })
  }, [applyActivityUpdate, repository])

  useEffect(() => {
    syncOptionalReviewerDefaults()
  }, [
    repository?.preferences.workflowId,
    repository?.root,
    syncOptionalReviewerDefaults,
    workflowDefaultsKey,
  ])

  async function run(operation: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The operation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function readRunForReview(document: ReviewDocument): Promise<ReviewRun> {
    const result = await window.revy.readActivity(document.metadata.id)
    return result.ok ? result.value : legacyRunFromReview(document)
  }

  async function refreshHistory(openLatest = false): Promise<void> {
    const nextReviews = unwrapResult(await window.revy.listReviews())
    setReviews(nextReviews)
    if (openLatest && nextReviews[0]) {
      const document = unwrapResult(await window.revy.readReview(nextReviews[0].id))
      presentReview(document, await readRunForReview(document))
    }
  }

  async function refreshActivity(openLatest = false): Promise<void> {
    const nextRuns = unwrapResult(await window.revy.listActivity())
    setRuns(nextRuns)
    if (openLatest && nextRuns[0]) {
      setActivity(unwrapResult(await window.revy.readActivity(nextRuns[0].id)))
    }
  }

  async function openRepository(): Promise<void> {
    await run(async () => {
      const selected = unwrapResult(await window.revy.selectRepository())
      if (!selected) {
        return
      }
      acceptRepository(selected)
      await Promise.all([refreshHistory(), refreshActivity()])
      setBootstrap(unwrapResult(await window.revy.updateSettings({})))
      setSurface('repository')
    })
  }

  async function openRecent(path: string): Promise<void> {
    await run(async () => {
      acceptRepository(unwrapResult(await window.revy.openRecentRepository(path)))
      await Promise.all([refreshHistory(), refreshActivity()])
      setSurface('repository')
    })
  }

  async function refreshRepository(): Promise<void> {
    await run(async () => {
      acceptRepository(unwrapResult(await window.revy.refreshRepository()))
      await Promise.all([refreshHistory(), refreshActivity()])
    })
  }

  async function updateBase(baseBranch: string): Promise<void> {
    await run(async () => {
      setRepository(unwrapResult(await window.revy.refreshRepository(baseBranch)))
      await Promise.all([refreshHistory(), refreshActivity()])
    })
  }

  async function updateInstructions(instructionFile: string | null): Promise<void> {
    await run(async () => {
      setRepository(
        unwrapResult(await window.revy.updateRepositoryPreferences({ instructionFile })),
      )
    })
  }

  async function updateWorkflow(workflowId: string | null): Promise<void> {
    await run(async () => {
      setRepository(unwrapResult(await window.revy.updateRepositoryPreferences({ workflowId })))
    })
  }

  async function chooseInstructions(): Promise<void> {
    await run(async () => {
      setRepository(unwrapResult(await window.revy.selectInstructionFile()))
    })
  }

  async function startReview(): Promise<void> {
    if (!repository?.baseBranch) {
      return
    }
    beginReview()
    try {
      const document = unwrapResult(
        await window.revy.startReview({
          baseBranch: repository.baseBranch,
          enabledOptionalReviewerIds,
          userStory: userStory.trim() || null,
          workflowId: repository.preferences.workflowId,
        }),
      )
      const [documentRun, nextRepository] = await Promise.all([
        readRunForReview(document),
        window.revy.refreshRepository().then(unwrapResult),
      ])
      completeReview(document, documentRun, nextRepository)
      await Promise.all([refreshHistory(), refreshActivity()])
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The review failed.'
      failReview(message)
    } finally {
      setReviewStarting(false)
    }
  }

  async function cancelReview(): Promise<void> {
    if (!progress?.reviewId) {
      return
    }
    await run(async () => {
      unwrapResult(await window.revy.cancelReview())
    })
  }

  async function openReview(id: string): Promise<void> {
    await run(async () => {
      const document = unwrapResult(await window.revy.readReview(id))
      presentReview(document, await readRunForReview(document))
    })
  }

  async function deleteReview(id: string): Promise<void> {
    if (!window.confirm('Delete this review and its activity permanently?')) {
      return
    }
    await run(async () => {
      const nextReviews = unwrapResult(await window.revy.deleteReview(id))
      setReviews(nextReviews)
      setRuns(unwrapResult(await window.revy.listActivity()))
      setActivity((current) => (current?.metadata.id === id ? null : current))
      setReview(null)
      setReviewRun(null)
      setSource(null)
      setStepInspector(null)
    })
  }

  async function openActivity(id: string): Promise<void> {
    await run(async () => {
      setActivity(unwrapResult(await window.revy.readActivity(id)))
      setStepInspector(null)
    })
  }

  async function deleteActivity(id: string): Promise<void> {
    if (!window.confirm('Delete this run and its review, if one exists?')) {
      return
    }
    await run(async () => {
      setRuns(unwrapResult(await window.revy.deleteActivity(id)))
      setActivity(null)
      setStepInspector(null)
      await refreshHistory()
    })
  }

  function inspectReviewStep(
    run: ReviewRun,
    stepId: string,
    preferredTab?: ReviewStepInspectorTab,
    activityId?: string,
  ): void {
    setStepInspector({
      highlightedActivityId: activityId ?? null,
      preferredTab,
      run,
      stepId,
    })
  }

  async function openReviewFromActivity(id: string): Promise<void> {
    await openReview(id)
    setSurface('reviews')
  }

  async function openSource(reference: CodeReference): Promise<void> {
    if (!review) {
      return
    }
    await run(async () => {
      setSource(
        unwrapResult(
          await window.revy.readSource({
            endLine: reference.endLine,
            line: reference.line,
            path: reference.path,
            reviewId: review.metadata.id,
          }),
        ),
      )
    })
  }

  async function copyText(text: string): Promise<boolean> {
    setError(null)
    try {
      unwrapResult(await window.revy.copyText(text))
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The review could not be copied.')
      return false
    }
  }

  async function openExternal(url: string): Promise<void> {
    setError(null)
    try {
      unwrapResult(await window.revy.openExternal(url))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The external link could not be opened.')
    }
  }

  async function refreshAgent(): Promise<void> {
    await run(async () => {
      unwrapResult(await window.revy.refreshAgent())
      setBootstrap(unwrapResult(await window.revy.updateSettings({})))
    })
  }

  async function chooseExecutable(): Promise<void> {
    await run(async () => {
      unwrapResult(await window.revy.chooseCodexExecutable())
      setBootstrap(unwrapResult(await window.revy.updateSettings({})))
    })
  }

  async function updateSettings(
    input: Parameters<typeof window.revy.updateSettings>[0],
  ): Promise<void> {
    await run(async () => {
      setBootstrap(unwrapResult(await window.revy.updateSettings(input)))
    })
  }

  async function saveReviewerProfile(input: SaveReviewerProfileInput): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const reviewConfiguration = unwrapResult(await window.revy.saveReviewerProfile(input))
      applyReviewConfiguration(reviewConfiguration)
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The reviewer could not be saved.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function deleteReviewerProfile(profileId: string): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const reviewConfiguration = unwrapResult(await window.revy.deleteReviewerProfile(profileId))
      applyReviewConfiguration(reviewConfiguration)
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The reviewer could not be deleted.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveWorkflow(input: SaveReviewWorkflowInput): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const reviewConfiguration = unwrapResult(await window.revy.saveWorkflow(input))
      applyReviewConfiguration(reviewConfiguration)
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The workflow could not be saved.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function deleteWorkflow(workflowId: string): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const reviewConfiguration = unwrapResult(await window.revy.deleteWorkflow(workflowId))
      applyReviewConfiguration(reviewConfiguration, workflowId)
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The workflow could not be deleted.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function openLogFolder(): Promise<void> {
    await run(async () => {
      unwrapResult(await window.revy.openLogFolder())
    })
  }

  function openLiveActivity(): void {
    setStepInspector(null)
    setSurface('activity')
    if (progress?.reviewId) {
      void openActivity(progress.reviewId)
      return
    }
    if (!activity && runs[0]) {
      void openActivity(runs[0].id)
    }
  }

  function setSettingsVisibility(open: boolean): void {
    if (!open && settingsDirty && !window.confirm('Discard unsaved settings changes?')) {
      return
    }
    setSettingsOpen(open)
    if (!open) {
      setSettingsDirty(false)
    }
  }

  function selectSurface(next: Surface): void {
    setStepInspector(null)
    setSurface(next)
    if (
      next === 'reviews' &&
      !reviewRunning &&
      reviews[0] &&
      review?.metadata.id !== reviews[0].id
    ) {
      void openReview(reviews[0].id)
    }
    if (next === 'activity' && !activity && runs[0]) {
      void openActivity(runs[0].id)
    }
  }

  if (!bootstrap) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <img
            alt=""
            className="mx-auto mb-4 size-16 animate-pulse rounded-2xl shadow-lg shadow-black/30"
            src={appIconUrl}
          />
          <p className="text-sm text-muted-foreground">Starting Revy…</p>
        </div>
      </main>
    )
  }

  const activeReview = resolveActiveReviewPresentation({
    active: reviewStarting || reviewRunning,
    enabledOptionalReviewerIds,
    liveActivity,
    progress,
    repository,
    reviewConfiguration: bootstrap.reviewConfiguration,
  })
  const inspectedRunId = stepInspector?.run.metadata.id ?? null
  const inspectedStepId = stepInspector?.stepId ?? null
  const inspectedActivityId = stepInspector?.highlightedActivityId ?? null

  return (
    <Dialog onOpenChange={setSettingsVisibility} open={settingsOpen}>
      <main className="grid h-screen min-h-0 grid-cols-[15rem_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
        <Sidebar
          bootstrap={bootstrap}
          onCancelReview={() => void cancelReview()}
          onOpenActivity={openLiveActivity}
          onOpenRecent={(path) => void openRecent(path)}
          onSelectRepository={() => void openRepository()}
          onSelectSurface={selectSurface}
          progress={progress}
          repository={repository}
          repositoryChangeDisabled={busy || reviewRunning}
          reviewRunning={reviewRunning}
          surface={surface}
        />
        <section className="relative min-h-0 min-w-0 overflow-hidden">
          {error && <ErrorBanner error={error} onClose={() => setError(null)} />}
          <div
            className={`relative flex min-w-0 ${
              error ? 'h-[calc(100%-3.05rem)] min-h-0' : 'h-full min-h-0'
            }`}
          >
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              {surface === 'repository' && (
                <div className="h-full overflow-auto">
                  <RepositorySurface
                    activeReview={activeReview}
                    agentReady={bootstrap.agent.state === 'ready'}
                    busy={busy}
                    onChooseInstructions={() => void chooseInstructions()}
                    onInspectStep={inspectReviewStep}
                    onRefresh={() => void refreshRepository()}
                    onSelectRepository={() => void openRepository()}
                    onStartReview={() => void startReview()}
                    onToggleOptionalReviewer={toggleOptionalReviewer}
                    onUserStoryChange={setUserStory}
                    onUpdateBase={(base) => void updateBase(base)}
                    onUpdateInstructions={(path) => void updateInstructions(path)}
                    onUpdateWorkflow={(workflowId) => void updateWorkflow(workflowId)}
                    progress={progress}
                    repository={repository}
                    reviewConfiguration={bootstrap.reviewConfiguration}
                    selectedStepId={
                      inspectedRunId === activeReview?.run?.metadata.id ? inspectedStepId : null
                    }
                    enabledOptionalReviewerIds={enabledOptionalReviewerIds}
                    userStory={userStory}
                  />
                </div>
              )}
              {surface === 'reviews' && (
                <ReviewsSurface
                  activeReview={activeReview}
                  onCancelReview={() => void cancelReview()}
                  onCloseSource={() => setSource(null)}
                  onCopy={copyText}
                  onDelete={(id) => void deleteReview(id)}
                  onInspectStep={inspectReviewStep}
                  onOpenExternal={(url) => void openExternal(url)}
                  onOpenReview={(id) => void openReview(id)}
                  onOpenSource={(reference) => void openSource(reference)}
                  review={review}
                  reviewRun={reviewRun}
                  reviews={reviews}
                  selectedStepId={
                    inspectedRunId === (activeReview?.run?.metadata.id ?? reviewRun?.metadata.id)
                      ? inspectedStepId
                      : null
                  }
                  source={source}
                />
              )}
              {surface === 'activity' && (
                <ActivitySurface
                  activity={activity}
                  onDelete={(id) => void deleteActivity(id)}
                  onInspectStep={inspectReviewStep}
                  onOpen={(id) => void openActivity(id)}
                  onOpenReview={(id) => void openReviewFromActivity(id)}
                  runs={runs}
                  selectedActivityId={
                    inspectedRunId === activity?.metadata.id ? inspectedActivityId : null
                  }
                  selectedStepId={inspectedRunId === activity?.metadata.id ? inspectedStepId : null}
                />
              )}
            </div>
            {stepInspector && (
              <ReviewStepInspector
                highlightedActivityId={stepInspector.highlightedActivityId}
                onClose={() => setStepInspector(null)}
                onOpenExternal={(url) => void openExternal(url)}
                preferredTab={stepInspector.preferredTab}
                run={stepInspector.run}
                stepId={stepInspector.stepId}
              />
            )}
          </div>
        </section>
      </main>
      <DialogContent className="flex h-[85vh] max-h-[52rem] min-h-[32rem] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14 text-left md:px-7">
          <DialogTitle className="text-2xl tracking-tight">Settings</DialogTitle>
          <DialogDescription>
            Configure the local Codex connection and your default review style.
          </DialogDescription>
        </DialogHeader>
        {error && <ErrorBanner error={error} onClose={() => setError(null)} />}
        <ScrollArea className="min-h-0 flex-1">
          <SettingsContent
            bootstrap={bootstrap}
            busy={busy}
            onChooseExecutable={() => void chooseExecutable()}
            onDeleteReviewerProfile={deleteReviewerProfile}
            onDeleteWorkflow={deleteWorkflow}
            onDirtyChange={setSettingsDirty}
            onOpenLogFolder={() => void openLogFolder()}
            onRefreshAgent={() => void refreshAgent()}
            onSaveReviewerProfile={saveReviewerProfile}
            onSaveWorkflow={saveWorkflow}
            onUpdateSettings={(input) => void updateSettings(input)}
          />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
