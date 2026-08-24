import { Badge } from '@shippy/ui/components/badge'
import { Button } from '@shippy/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shippy/ui/components/card'
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
import { Textarea } from '@shippy/ui/components/textarea'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  FileCode2,
  FolderGit2,
  FolderOpen,
  History,
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
  BootstrapState,
  RepositorySnapshot,
  Result,
  ReviewDocument,
  ReviewProgress,
  ReviewSummary,
  SourcePreview,
} from '../../shared/contracts.js'
import { type CodeReference, MarkdownReview } from './MarkdownReview'

type Surface = 'repository' | 'reviews' | 'settings'

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
  onOpenRecent: (path: string) => void
  onSelectSurface: (surface: Surface) => void
  repository: RepositorySnapshot | null
  surface: Surface
}

function Sidebar({ bootstrap, onOpenRecent, onSelectSurface, repository, surface }: SidebarProps) {
  const items: Array<{ icon: typeof FolderGit2; id: Surface; label: string }> = [
    { icon: FolderGit2, id: 'repository', label: 'Repository' },
    { icon: History, id: 'reviews', label: 'Reviews' },
    { icon: Settings2, id: 'settings', label: 'Settings' },
  ]
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
      <nav className="space-y-1 px-3 py-3">
        {items.map((item) => {
          const Icon = item.icon
          const disabled = item.id === 'reviews' && !repository
          return (
            <button
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                surface === item.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              } disabled:pointer-events-none disabled:opacity-40`}
              disabled={disabled}
              key={item.id}
              onClick={() => onSelectSurface(item.id)}
              type="button"
            >
              <Icon className="size-4" />
              {item.label}
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
            {bootstrap.settings.recentRepositories.length === 0 && (
              <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">
                Open a repository to keep it close at hand.
              </p>
            )}
            {bootstrap.settings.recentRepositories.map((path) => (
              <button
                className="group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent/60"
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
      <div className="border-t p-4">
        <button
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent/60"
          onClick={() => onSelectSurface('settings')}
          type="button"
        >
          <span
            className={`size-2 rounded-full ${
              bootstrap.agent.state === 'ready' ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium">Codex {bootstrap.agent.state}</span>
            <span className="block truncate text-[0.68rem] text-muted-foreground">
              {bootstrap.agent.version ?? 'Not connected'}
            </span>
          </span>
        </button>
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
  onUpdateBase: (base: string) => void
  onUpdateInstructions: (path: string | null) => void
  progress: ReviewProgress | null
  repository: RepositorySnapshot | null
}

function RepositorySurface({
  agentReady,
  busy,
  onChooseInstructions,
  onRefresh,
  onSelectRepository,
  onStartReview,
  onUpdateBase,
  onUpdateInstructions,
  progress,
  repository,
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
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline">{branchLabel(repository)}</Badge>
            {repository.baseBranch && (
              <span className="text-xs text-muted-foreground">against {repository.baseBranch}</span>
            )}
          </div>
          <h1 className="truncate text-3xl font-semibold tracking-tight">{repository.name}</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{repository.root}</p>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={busy || Boolean(reviewRunning)}
            onClick={onSelectRepository}
            variant="outline"
          >
            <FolderOpen />
            Open
          </Button>
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

      {reviewRunning && progress && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <LoaderCircle className="size-4 animate-spin text-primary" />
          <span>{progress.message}</span>
        </div>
      )}
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
            Choose the comparison base and optional project review rules.
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
  onDelete: (id: string) => void
  onOpenReview: (id: string) => void
  onOpenSource: (reference: CodeReference) => void
  onCloseSource: () => void
  review: ReviewDocument | null
  reviews: ReviewSummary[]
  source: SourcePreview | null
}

function ReviewsSurface({
  onCloseSource,
  onDelete,
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
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {item.branch ?? 'Detached HEAD'}
                  </span>
                  {item.stale && <span className="size-1.5 rounded-full bg-amber-400" />}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">against {item.baseBranch}</p>
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
                <Badge variant="secondary">{review.metadata.format}</Badge>
                <Badge variant="outline">{review.metadata.model}</Badge>
              </div>
              <Button onClick={() => onDelete(review.metadata.id)} size="sm" variant="ghost">
                <Trash2 />
                Delete
              </Button>
            </div>
            {review.stale && (
              <div className="mb-6 flex gap-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                <AlertTriangle className="mt-1 size-4 shrink-0" />
                HEAD or the working tree changed after this review. Code links show current files.
              </div>
            )}
            <MarkdownReview markdown={review.markdown} onCodeReference={onOpenSource} />
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

interface SettingsSurfaceProps {
  bootstrap: BootstrapState
  busy: boolean
  onChooseExecutable: () => void
  onRefreshAgent: () => void
  onUpdateSettings: (input: Parameters<typeof window.shippy.updateSettings>[0]) => void
}

function SettingsSurface({
  bootstrap,
  busy,
  onChooseExecutable,
  onRefreshAgent,
  onUpdateSettings,
}: SettingsSurfaceProps) {
  const [instructions, setInstructions] = useState(bootstrap.settings.personalInstructions)
  useEffect(() => setInstructions(bootstrap.settings.personalInstructions), [bootstrap.settings])
  const model = bootstrap.agent.models.find(
    (candidate) => candidate.id === bootstrap.settings.model,
  )

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8 lg:p-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-muted-foreground">
          Configure the local Codex connection and your default review style.
        </p>
      </div>

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
          <div className="space-y-2 sm:col-span-2">
            <Label>Review format</Label>
            <Select
              value={bootstrap.settings.reviewFormat}
              onValueChange={(value: 'concise-markdown' | 'conventional-comments') =>
                onUpdateSettings({ reviewFormat: value })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conventional-comments">Conventional Comments</SelectItem>
                <SelectItem value="concise-markdown">Concise Markdown</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Personal instructions</CardTitle>
          <CardDescription>
            Applied after the read-only contract, project rules, and format preset.
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
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<ReviewProgress | null>(null)
  const [repository, setRepository] = useState<RepositorySnapshot | null>(null)
  const [review, setReview] = useState<ReviewDocument | null>(null)
  const [reviews, setReviews] = useState<ReviewSummary[]>([])
  const [source, setSource] = useState<SourcePreview | null>(null)
  const [surface, setSurface] = useState<Surface>('repository')

  const reviewRunning = useMemo(
    () => Boolean(progress && ['preparing', 'running', 'saving'].includes(progress.state)),
    [progress],
  )

  useEffect(() => {
    const unsubscribe = window.shippy.onReviewProgress(setProgress)
    void (async () => {
      try {
        setBootstrap(unwrapResult(await window.shippy.getBootstrap()))
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Shippy could not start.')
      }
    })()
    return unsubscribe
  }, [])

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

  function acceptRepository(next: RepositorySnapshot): void {
    setRepository(next)
    setReview(null)
    setSource(null)
  }

  async function openRepository(): Promise<void> {
    await run(async () => {
      const selected = unwrapResult(await window.shippy.selectRepository())
      if (!selected) {
        return
      }
      acceptRepository(selected)
      await refreshHistory()
      setBootstrap(unwrapResult(await window.shippy.updateSettings({})))
      setSurface('repository')
    })
  }

  async function openRecent(path: string): Promise<void> {
    await run(async () => {
      acceptRepository(unwrapResult(await window.shippy.openRecentRepository(path)))
      await refreshHistory()
      setSurface('repository')
    })
  }

  async function refreshRepository(): Promise<void> {
    await run(async () => {
      acceptRepository(unwrapResult(await window.shippy.refreshRepository()))
      await refreshHistory()
    })
  }

  async function updateBase(baseBranch: string): Promise<void> {
    await run(async () => {
      setRepository(unwrapResult(await window.shippy.refreshRepository(baseBranch)))
      await refreshHistory()
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
        await window.shippy.startReview({ baseBranch: repository.baseBranch }),
      )
      setReview(document)
      setSource(null)
      setRepository(unwrapResult(await window.shippy.refreshRepository()))
      await refreshHistory()
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
    if (!window.confirm('Delete this review permanently?')) {
      return
    }
    await run(async () => {
      const nextReviews = unwrapResult(await window.shippy.deleteReview(id))
      setReviews(nextReviews)
      setReview(null)
      setSource(null)
    })
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
    <main className="grid h-screen min-h-0 grid-cols-[15rem_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
      <Sidebar
        bootstrap={bootstrap}
        onOpenRecent={(path) => void openRecent(path)}
        onSelectSurface={setSurface}
        repository={repository}
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
                onUpdateBase={(base) => void updateBase(base)}
                onUpdateInstructions={(path) => void updateInstructions(path)}
                progress={progress}
                repository={repository}
              />
            </div>
          )}
          {surface === 'reviews' && (
            <ReviewsSurface
              onCloseSource={() => setSource(null)}
              onDelete={(id) => void deleteReview(id)}
              onOpenReview={(id) => void openReview(id)}
              onOpenSource={(reference) => void openSource(reference)}
              review={review}
              reviews={reviews}
              source={source}
            />
          )}
          {surface === 'settings' && (
            <div className="h-full overflow-auto">
              <SettingsSurface
                bootstrap={bootstrap}
                busy={busy}
                onChooseExecutable={() => void chooseExecutable()}
                onRefreshAgent={() => void refreshAgent()}
                onUpdateSettings={(input) => void updateSettings(input)}
              />
            </div>
          )}
        </div>
        {reviewRunning && (
          <div className="absolute right-5 bottom-5 flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-2xl">
            <LoaderCircle className="size-4 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium">{progress?.message}</p>
              <p className="text-xs text-muted-foreground">One review runs at a time.</p>
            </div>
            <Button
              aria-label="Cancel review"
              onClick={() => void cancelReview()}
              size="icon-sm"
              variant="outline"
            >
              <Square className="fill-current" />
            </Button>
          </div>
        )}
      </section>
    </main>
  )
}
