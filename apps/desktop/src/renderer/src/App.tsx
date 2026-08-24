import { Badge } from '@shippy/ui/components/badge'
import { Button } from '@shippy/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shippy/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@shippy/ui/components/dialog'
import { Label } from '@shippy/ui/components/label'
import { ScrollArea } from '@shippy/ui/components/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shippy/ui/components/select'
import { Separator } from '@shippy/ui/components/separator'
import { Switch } from '@shippy/ui/components/switch'
import { Textarea } from '@shippy/ui/components/textarea'
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
  ShipWheel,
  Square,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AgentActivityEntry,
  BootstrapState,
  RepositorySnapshot,
  Result,
  ReviewDocument,
  ReviewProgress,
  ReviewRun,
  ReviewRunSummary,
  ReviewRunUpdate,
  ReviewSummary,
  SourcePreview,
} from '../../shared/contracts.js'
import { formatLegacyReviewMarkdown } from '../../shared/review-formats.js'
import { ActivitySurface } from './ActivitySurface'
import { type CodeReference, MarkdownReview } from './MarkdownReview'
import { CopyButton, StructuredReview } from './StructuredReview'

type Surface = 'activity' | 'repository' | 'reviews'

function unwrapResult<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.value
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

function mergeActivityEntry(
  activity: AgentActivityEntry[],
  entry: AgentActivityEntry,
): AgentActivityEntry[] {
  const next = activity.filter((candidate) => candidate.id !== entry.id)
  next.push(entry)
  return next.sort((left, right) => left.sequence - right.sequence)
}

function mergeRunUpdate(current: ReviewRun, update: ReviewRunUpdate): ReviewRun {
  return {
    activity: update.entry ? mergeActivityEntry(current.activity, update.entry) : current.activity,
    metadata: update.run,
  }
}

function reportRendererError(
  kind: 'error' | 'unhandled-rejection',
  value: unknown,
  fallback: string,
): void {
  const error = value instanceof Error ? value : null
  const message = (error?.message || (typeof value === 'string' ? value : fallback)).slice(0, 4_000)
  window.shippy.reportRendererError({
    kind,
    message: message || fallback,
    stack: error?.stack?.slice(0, 16_000) || null,
  })
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
      <div className="flex h-16 items-center gap-3 px-5">
        <span className="flex size-9 items-center justify-center rounded-xl border bg-primary/10 text-primary">
          <ShipWheel className="size-5" />
        </span>
        <div>
          <p className="text-sm font-semibold tracking-wide">SHIPPY</p>
          <p className="text-xs text-muted-foreground">Review before you ship</p>
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
  agentReady: boolean
  busy: boolean
  onChooseInstructions: () => void
  onRefresh: () => void
  onSelectRepository: () => void
  onStartReview: () => void
  onUserStoryChange: (value: string) => void
  onUpdateBase: (base: string) => void
  onUpdateInstructions: (path: string | null) => void
  progress: ReviewProgress | null
  repository: RepositorySnapshot | null
  userStory: string
}

function RepositorySurface({
  agentReady,
  busy,
  onChooseInstructions,
  onRefresh,
  onSelectRepository,
  onStartReview,
  onUserStoryChange,
  onUpdateBase,
  onUpdateInstructions,
  progress,
  repository,
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
            Shippy combines branch, staged, unstaged, and untracked changes into one focused Codex
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

interface ReviewsSurfaceProps {
  onCopy: (text: string) => Promise<boolean>
  onDelete: (id: string) => void
  onOpenExternal: (url: string) => void
  onOpenReview: (id: string) => void
  onOpenSource: (reference: CodeReference) => void
  onCloseSource: () => void
  review: ReviewDocument | null
  reviews: ReviewSummary[]
  source: SourcePreview | null
}

function ReviewsSurface({
  onCloseSource,
  onCopy,
  onDelete,
  onOpenExternal,
  onOpenReview,
  onOpenSource,
  review,
  reviews,
  source,
}: ReviewsSurfaceProps) {
  return (
    <div
      className={`grid h-full min-h-0 ${
        source
          ? 'grid-cols-[17rem_minmax(0,1fr)_minmax(22rem,34rem)]'
          : 'grid-cols-[17rem_minmax(0,1fr)]'
      }`}
    >
      <aside className="min-h-0 border-r bg-card/20">
        <div className="flex h-16 items-center border-b px-5">
          <div>
            <h1 className="font-semibold">Review history</h1>
            <p className="text-xs text-muted-foreground">{reviews.length} saved reviews</p>
          </div>
        </div>
        <ScrollArea className="h-[calc(100%-4rem)]">
          <div className="space-y-1 p-3">
            {reviews.length === 0 && (
              <div className="px-3 py-10 text-center text-sm leading-6 text-muted-foreground">
                Completed reviews will appear here.
              </div>
            )}
            {reviews.map((item) => (
              <button
                className={`w-full rounded-lg border px-3 py-3 text-left transition-colors hover:bg-accent/50 ${
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
        {!review ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
              <History className="mx-auto mb-3 size-8 text-muted-foreground/60" />
              <p className="font-medium">Select a review</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Saved reviews are immutable and stay in Shippy's app data.
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
  onUpdateSettings: (input: Parameters<typeof window.shippy.updateSettings>[0]) => void
}

function SettingsContent({
  bootstrap,
  busy,
  onChooseExecutable,
  onOpenLogFolder,
  onRefreshAgent,
  onUpdateSettings,
}: SettingsContentProps) {
  const [instructions, setInstructions] = useState(bootstrap.settings.personalInstructions)
  useEffect(() => setInstructions(bootstrap.settings.personalInstructions), [bootstrap.settings])
  const model = bootstrap.agent.models.find(
    (candidate) => candidate.id === bootstrap.settings.model,
  )
  return (
    <div className="space-y-6 p-6 md:p-7">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Codex App Server</CardTitle>
              <CardDescription className="mt-2">
                Experimental local integration. Shippy never installs, updates, or authenticates
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
              <code className="rounded bg-muted px-1 py-0.5">codex login</code>, then retry. Shippy
              does not change{' '}
              <code className="rounded bg-muted px-1 py-0.5">~/.codex/config.toml</code>.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
          <CardDescription>
            Local rotating logs help diagnose Shippy, Electron, Git, and Codex connection failures.
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
              Shippy keeps one 5 MiB log and one rotated archive on this computer.
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
            <span className="text-xs text-muted-foreground">{instructions.length} / 12,000</span>
            <Button
              disabled={instructions === bootstrap.settings.personalInstructions}
              onClick={() => onUpdateSettings({ personalInstructions: instructions })}
            >
              Save instructions
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function App() {
  const [activity, setActivity] = useState<ReviewRun | null>(null)
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<ReviewProgress | null>(null)
  const [repository, setRepository] = useState<RepositorySnapshot | null>(null)
  const [review, setReview] = useState<ReviewDocument | null>(null)
  const [reviews, setReviews] = useState<ReviewSummary[]>([])
  const [runs, setRuns] = useState<ReviewRunSummary[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [source, setSource] = useState<SourcePreview | null>(null)
  const [surface, setSurface] = useState<Surface>('repository')
  const [userStory, setUserStory] = useState('')

  const reviewRunning = useMemo(
    () => Boolean(progress && ['preparing', 'running', 'saving'].includes(progress.state)),
    [progress],
  )

  useEffect(() => {
    const unsubscribe = window.shippy.onReviewProgress(setProgress)
    const onError = (event: ErrorEvent): void =>
      reportRendererError('error', event.error ?? event.message, 'Renderer error')
    const onUnhandledRejection = (event: PromiseRejectionEvent): void =>
      reportRendererError('unhandled-rejection', event.reason, 'Unhandled renderer rejection')
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    void (async () => {
      try {
        setBootstrap(unwrapResult(await window.shippy.getBootstrap()))
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Shippy could not start.')
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
    return window.shippy.onActivityUpdate((update) => {
      if (update.run.repositoryRoot !== repository.root) {
        return
      }
      setRuns((current) =>
        [...current.filter((run) => run.id !== update.run.id), update.run].sort((left, right) =>
          right.startedAt.localeCompare(left.startedAt),
        ),
      )
      setActivity((current) =>
        current?.metadata.id === update.run.id ? mergeRunUpdate(current, update) : current,
      )
    })
  }, [repository])

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

  async function refreshHistory(openLatest = false): Promise<void> {
    const nextReviews = unwrapResult(await window.shippy.listReviews())
    setReviews(nextReviews)
    if (openLatest && nextReviews[0]) {
      setReview(unwrapResult(await window.shippy.readReview(nextReviews[0].id)))
    }
  }

  async function refreshActivity(openLatest = false): Promise<void> {
    const nextRuns = unwrapResult(await window.shippy.listActivity())
    setRuns(nextRuns)
    if (openLatest && nextRuns[0]) {
      setActivity(unwrapResult(await window.shippy.readActivity(nextRuns[0].id)))
    }
  }

  function acceptRepository(next: RepositorySnapshot): void {
    if (repository?.root !== next.root) {
      setUserStory('')
    }
    setRepository(next)
    setActivity(null)
    setReview(null)
    setRuns([])
    setSource(null)
  }

  async function openRepository(): Promise<void> {
    await run(async () => {
      const selected = unwrapResult(await window.shippy.selectRepository())
      if (!selected) {
        return
      }
      acceptRepository(selected)
      await Promise.all([refreshHistory(), refreshActivity()])
      setBootstrap(unwrapResult(await window.shippy.updateSettings({})))
      setSurface('repository')
    })
  }

  async function openRecent(path: string): Promise<void> {
    await run(async () => {
      acceptRepository(unwrapResult(await window.shippy.openRecentRepository(path)))
      await Promise.all([refreshHistory(), refreshActivity()])
      setSurface('repository')
    })
  }

  async function refreshRepository(): Promise<void> {
    await run(async () => {
      acceptRepository(unwrapResult(await window.shippy.refreshRepository()))
      await Promise.all([refreshHistory(), refreshActivity()])
    })
  }

  async function updateBase(baseBranch: string): Promise<void> {
    await run(async () => {
      setRepository(unwrapResult(await window.shippy.refreshRepository(baseBranch)))
      await Promise.all([refreshHistory(), refreshActivity()])
    })
  }

  async function updateInstructions(instructionFile: string | null): Promise<void> {
    await run(async () => {
      setRepository(
        unwrapResult(await window.shippy.updateRepositoryPreferences({ instructionFile })),
      )
    })
  }

  async function chooseInstructions(): Promise<void> {
    await run(async () => {
      setRepository(unwrapResult(await window.shippy.selectInstructionFile()))
    })
  }

  async function startReview(): Promise<void> {
    if (!repository?.baseBranch) {
      return
    }
    setError(null)
    try {
      const document = unwrapResult(
        await window.shippy.startReview({
          baseBranch: repository.baseBranch,
          userStory: userStory.trim() || null,
        }),
      )
      setUserStory('')
      setReview(document)
      setSource(null)
      setRepository(unwrapResult(await window.shippy.refreshRepository()))
      await Promise.all([refreshHistory(), refreshActivity()])
      setSurface('reviews')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The review failed.'
      if (!/cancel/i.test(message)) {
        setError(message)
      }
    }
  }

  async function cancelReview(): Promise<void> {
    await run(async () => {
      unwrapResult(await window.shippy.cancelReview())
    })
  }

  async function openReview(id: string): Promise<void> {
    await run(async () => {
      setReview(unwrapResult(await window.shippy.readReview(id)))
      setSource(null)
    })
  }

  async function deleteReview(id: string): Promise<void> {
    if (!window.confirm('Delete this review and its activity permanently?')) {
      return
    }
    await run(async () => {
      const nextReviews = unwrapResult(await window.shippy.deleteReview(id))
      setReviews(nextReviews)
      setRuns(unwrapResult(await window.shippy.listActivity()))
      setActivity((current) => (current?.metadata.id === id ? null : current))
      setReview(null)
      setSource(null)
    })
  }

  async function openActivity(id: string): Promise<void> {
    await run(async () => {
      setActivity(unwrapResult(await window.shippy.readActivity(id)))
    })
  }

  async function deleteActivity(id: string): Promise<void> {
    if (!window.confirm('Delete this run and its review, if one exists?')) {
      return
    }
    await run(async () => {
      setRuns(unwrapResult(await window.shippy.deleteActivity(id)))
      setActivity(null)
      await refreshHistory()
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
          await window.shippy.readSource({
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
      unwrapResult(await window.shippy.copyText(text))
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The review could not be copied.')
      return false
    }
  }

  async function openExternal(url: string): Promise<void> {
    setError(null)
    try {
      unwrapResult(await window.shippy.openExternal(url))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The external link could not be opened.')
    }
  }

  async function refreshAgent(): Promise<void> {
    await run(async () => {
      unwrapResult(await window.shippy.refreshAgent())
      setBootstrap(unwrapResult(await window.shippy.updateSettings({})))
    })
  }

  async function chooseExecutable(): Promise<void> {
    await run(async () => {
      unwrapResult(await window.shippy.chooseCodexExecutable())
      setBootstrap(unwrapResult(await window.shippy.updateSettings({})))
    })
  }

  async function updateSettings(
    input: Parameters<typeof window.shippy.updateSettings>[0],
  ): Promise<void> {
    await run(async () => {
      setBootstrap(unwrapResult(await window.shippy.updateSettings(input)))
    })
  }

  async function openLogFolder(): Promise<void> {
    await run(async () => {
      unwrapResult(await window.shippy.openLogFolder())
    })
  }

  function openLiveActivity(): void {
    setSurface('activity')
    if (progress?.reviewId) {
      void openActivity(progress.reviewId)
      return
    }
    if (!activity && runs[0]) {
      void openActivity(runs[0].id)
    }
  }

  function selectSurface(next: Surface): void {
    setSurface(next)
    if (next === 'reviews' && reviews[0] && review?.metadata.id !== reviews[0].id) {
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
          <ShipWheel className="mx-auto mb-4 size-8 animate-pulse text-primary" />
          <p className="text-sm text-muted-foreground">Starting Shippy…</p>
        </div>
      </main>
    )
  }

  return (
    <Dialog onOpenChange={setSettingsOpen} open={settingsOpen}>
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
          <div className={error ? 'h-[calc(100%-3.05rem)] min-h-0' : 'h-full min-h-0'}>
            {surface === 'repository' && (
              <div className="h-full overflow-auto">
                <RepositorySurface
                  agentReady={bootstrap.agent.state === 'ready'}
                  busy={busy}
                  onChooseInstructions={() => void chooseInstructions()}
                  onRefresh={() => void refreshRepository()}
                  onSelectRepository={() => void openRepository()}
                  onStartReview={() => void startReview()}
                  onUserStoryChange={setUserStory}
                  onUpdateBase={(base) => void updateBase(base)}
                  onUpdateInstructions={(path) => void updateInstructions(path)}
                  progress={progress}
                  repository={repository}
                  userStory={userStory}
                />
              </div>
            )}
            {surface === 'reviews' && (
              <ReviewsSurface
                onCloseSource={() => setSource(null)}
                onCopy={copyText}
                onDelete={(id) => void deleteReview(id)}
                onOpenExternal={(url) => void openExternal(url)}
                onOpenReview={(id) => void openReview(id)}
                onOpenSource={(reference) => void openSource(reference)}
                review={review}
                reviews={reviews}
                source={source}
              />
            )}
            {surface === 'activity' && (
              <ActivitySurface
                activity={activity}
                onDelete={(id) => void deleteActivity(id)}
                onOpen={(id) => void openActivity(id)}
                onOpenReview={(id) => void openReviewFromActivity(id)}
                runs={runs}
              />
            )}
          </div>
        </section>
      </main>
      <DialogContent className="flex h-[85vh] max-h-[52rem] min-h-[32rem] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
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
            onOpenLogFolder={() => void openLogFolder()}
            onRefreshAgent={() => void refreshAgent()}
            onUpdateSettings={(input) => void updateSettings(input)}
          />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
