import { Badge } from '@shippy/ui/components/badge'
import { Button } from '@shippy/ui/components/button'
import { ScrollArea } from '@shippy/ui/components/scroll-area'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Globe2,
  History,
  SearchCode,
  TerminalSquare,
  Trash2,
  Users,
  Wrench,
  XCircle,
} from 'lucide-react'
import type {
  AgentActivityEntry,
  ReviewRun,
  ReviewRunStatus,
  ReviewRunSummary,
} from '../../shared/contracts.js'

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${durationMs} ms`
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(1)} s`
  }
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1_000)
  return `${minutes}m ${seconds}s`
}

function runDuration(run: ReviewRunSummary): string | null {
  if (!run.endedAt) {
    return null
  }
  return formatDuration(
    Math.max(0, new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()),
  )
}

function statusVariant(
  status: ReviewRunStatus,
): 'default' | 'destructive' | 'outline' | 'secondary' {
  if (status === 'completed') {
    return 'default'
  }
  if (status === 'failed') {
    return 'destructive'
  }
  return status === 'running' || status === 'preparing' || status === 'saving'
    ? 'secondary'
    : 'outline'
}

function ActivityIcon({ entry }: { entry: AgentActivityEntry }) {
  const className = `size-4 ${
    entry.status === 'failed' || entry.status === 'warning'
      ? 'text-amber-300'
      : entry.status === 'completed'
        ? 'text-emerald-400'
        : 'text-primary'
  }`
  if (entry.kind === 'command') {
    return <TerminalSquare className={className} />
  }
  if (entry.kind === 'tool') {
    return <Wrench className={className} />
  }
  if (entry.kind === 'web-search') {
    return <Globe2 className={className} />
  }
  if (entry.kind === 'subagent') {
    return <Users className={className} />
  }
  if (entry.kind === 'warning') {
    return <AlertTriangle className={className} />
  }
  if (entry.status === 'completed') {
    return <CheckCircle2 className={className} />
  }
  if (entry.status === 'failed' || entry.status === 'interrupted') {
    return <XCircle className={className} />
  }
  return <Bot className={className} />
}

function ActivityEntry({ entry }: { entry: AgentActivityEntry }) {
  const hasDetails =
    Boolean(entry.name) ||
    entry.paths.length > 0 ||
    entry.durationMs !== null ||
    entry.exitCode !== null
  return (
    <li className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-7 last:pb-0">
      <span className="absolute top-7 bottom-0 left-[0.95rem] w-px bg-border last:hidden" />
      <span className="relative z-10 flex size-8 items-center justify-center rounded-full border bg-card">
        <ActivityIcon entry={entry} />
      </span>
      <div className="min-w-0 pt-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{entry.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{formatDate(entry.occurredAt)}</p>
          </div>
          <Badge variant="outline">{entry.status}</Badge>
        </div>
        {hasDetails && (
          <details className="mt-3 rounded-lg border bg-muted/15 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">Details</summary>
            <dl className="mt-3 grid gap-2 sm:grid-cols-[7rem_1fr]">
              {entry.name && (
                <>
                  <dt className="text-muted-foreground">Action</dt>
                  <dd className="font-mono">{entry.name}</dd>
                </>
              )}
              {entry.paths.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Paths</dt>
                  <dd className="space-y-1">
                    {entry.paths.map((path) => (
                      <span className="block break-all font-mono" key={path}>
                        {path}
                      </span>
                    ))}
                  </dd>
                </>
              )}
              {entry.durationMs !== null && (
                <>
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd>{formatDuration(entry.durationMs)}</dd>
                </>
              )}
              {entry.exitCode !== null && (
                <>
                  <dt className="text-muted-foreground">Exit code</dt>
                  <dd>{entry.exitCode}</dd>
                </>
              )}
            </dl>
          </details>
        )}
      </div>
    </li>
  )
}

interface ActivitySurfaceProps {
  activity: ReviewRun | null
  onDelete: (id: string) => void
  onOpen: (id: string) => void
  onOpenReview: (id: string) => void
  runs: ReviewRunSummary[]
}

export function ActivitySurface({
  activity,
  onDelete,
  onOpen,
  onOpenReview,
  runs,
}: ActivitySurfaceProps) {
  return (
    <div className="grid h-full min-h-0 min-w-0 grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="min-h-0 min-w-0 overflow-hidden border-r bg-card/20">
        <div className="flex h-16 items-center border-b px-5">
          <div>
            <h1 className="font-semibold">Agent activity</h1>
            <p className="text-xs text-muted-foreground">{runs.length} review runs</p>
          </div>
        </div>
        <ScrollArea className="h-[calc(100%-4rem)] w-full">
          <div className="min-w-0 space-y-1 p-3">
            {runs.length === 0 && (
              <div className="px-3 py-10 text-center text-sm leading-6 text-muted-foreground">
                Review runs will appear here as soon as they start.
              </div>
            )}
            {runs.map((run) => {
              const duration = runDuration(run)
              return (
                <button
                  className={`block w-full min-w-0 max-w-full overflow-hidden rounded-lg border px-3 py-3 text-left transition-colors hover:bg-accent/50 ${
                    activity?.metadata.id === run.id
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-transparent'
                  }`}
                  key={run.id}
                  onClick={() => onOpen(run.id)}
                  type="button"
                >
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                    <span className="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere]">
                      {run.branch ?? 'Detached HEAD'}
                    </span>
                    <Badge className="shrink-0" variant={statusVariant(run.status)}>
                      {run.status}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{run.model}</p>
                  <p className="mt-2 flex items-center gap-1 text-[0.68rem] text-muted-foreground">
                    <Clock3 className="size-3" />
                    {formatDate(run.startedAt)}
                    {duration ? ` · ${duration}` : ''}
                  </p>
                </button>
              )
            })}
          </div>
        </ScrollArea>
      </aside>

      <main className="min-h-0 min-w-0 overflow-auto">
        {!activity ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
              <History className="mx-auto mb-3 size-8 text-muted-foreground/60" />
              <p className="font-medium">Select a review run</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Activity records actions and outcomes without prompts, reasoning, or command output.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl px-8 py-8 lg:px-12">
            <header className="mb-8 border-b pb-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Badge variant={statusVariant(activity.metadata.status)}>
                      {activity.metadata.status}
                    </Badge>
                    <Badge variant="outline">{activity.metadata.model}</Badge>
                    <Badge variant="outline">{activity.metadata.reasoningEffort}</Badge>
                  </div>
                  <h2 className="break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
                    {activity.metadata.branch ?? 'Detached HEAD'} → {activity.metadata.baseBranch}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Started {formatDate(activity.metadata.startedAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {activity.metadata.reviewId && (
                    <Button
                      onClick={() => onOpenReview(activity.metadata.reviewId ?? '')}
                      size="sm"
                      variant="outline"
                    >
                      <SearchCode />
                      Open review
                    </Button>
                  )}
                  <Button onClick={() => onDelete(activity.metadata.id)} size="sm" variant="ghost">
                    <Trash2 />
                    Delete
                  </Button>
                </div>
              </div>
              {activity.metadata.error && (
                <div className="mt-5 flex gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm leading-6 text-red-200">
                  <AlertTriangle className="mt-1 size-4 shrink-0" />
                  {activity.metadata.error}
                </div>
              )}
            </header>

            {activity.activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Waiting for agent activity…</p>
            ) : (
              <ol>
                {activity.activity.map((entry) => (
                  <ActivityEntry entry={entry} key={entry.id} />
                ))}
              </ol>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
