import { Badge } from '@revy/ui/components/badge'
import { Button } from '@revy/ui/components/button'
import { ScrollArea } from '@revy/ui/components/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@revy/ui/components/tabs'
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCode2,
  ListTree,
  LoaderCircle,
  X,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AgentActivityEntry,
  ReviewerExecutionStatus,
  ReviewRun,
  ReviewStepDetail,
  StructuredReview,
} from '../../shared/contracts.js'
import { coordinatorReviewStepId, reviewerReviewStepId } from '../../shared/contracts.js'
import { formatReviewLocation } from '../../shared/review-formats.js'
import { MarkdownReview } from './MarkdownReview'

export type ReviewStepInspectorTab = 'activity' | 'reasoning' | 'result'

interface ReviewStepInspectorProps {
  highlightedActivityId?: string | null | undefined
  onClose: () => void
  onOpenExternal: (url: string) => void
  preferredTab?: ReviewStepInspectorTab | undefined
  run: ReviewRun
  stepId: string
}

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

function stepDuration(step: ReviewStepDetail | null): string | null {
  if (!step?.startedAt) {
    return null
  }
  return formatDuration(
    Math.max(
      0,
      (step.endedAt ? new Date(step.endedAt).getTime() : Date.now()) -
        new Date(step.startedAt).getTime(),
    ),
  )
}

function formatStatus(status: ReviewerExecutionStatus): string {
  return status === 'not-selected'
    ? 'Not selected'
    : `${status.charAt(0).toUpperCase()}${status.slice(1)}`
}

function statusIcon(status: ReviewerExecutionStatus) {
  if (status === 'running') {
    return <LoaderCircle className="size-4 animate-spin text-primary" />
  }
  if (status === 'completed') {
    return <CheckCircle2 className="size-4 text-emerald-400" />
  }
  if (status === 'failed' || status === 'cancelled') {
    return <XCircle className="size-4 text-red-300" />
  }
  return <Clock3 className="size-4 text-muted-foreground" />
}

function defaultTab(status: ReviewerExecutionStatus, output: StructuredReview | null) {
  if (status === 'running') {
    return 'reasoning' as const
  }
  if (status === 'failed' && !output) {
    return 'activity' as const
  }
  return 'result' as const
}

function ResultContent({
  coordinator,
  onOpenExternal,
  output,
  status,
}: {
  coordinator: boolean
  onOpenExternal: (url: string) => void
  output: StructuredReview | null
  status: ReviewerExecutionStatus
}) {
  if (status === 'not-selected') {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <Clock3 className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Not selected</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          This optional reviewer remains part of the frozen plan but did not execute for this run.
        </p>
      </div>
    )
  }
  if (!output) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        {status === 'running' || status === 'pending' ? (
          <LoaderCircle className="mx-auto size-6 animate-spin text-primary" />
        ) : (
          <FileCode2 className="mx-auto size-6 text-muted-foreground" />
        )}
        <p className="mt-3 text-sm font-medium">
          {status === 'running' || status === 'pending'
            ? 'Waiting for the validated result'
            : 'No validated result is available'}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Revy stores output only after it matches the structured review contract.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!coordinator && (
        <div className="rounded-lg border border-sky-400/20 bg-sky-400/10 p-3 text-xs leading-5 text-sky-100">
          This is independent specialist evidence. The consolidated review may verify, combine, or
          omit these findings.
        </div>
      )}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">Summary</p>
          <Badge variant="secondary">
            {output.findings.length} {output.findings.length === 1 ? 'finding' : 'findings'}
          </Badge>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{output.summary}</p>
      </div>
      {output.findings.length === 0 ? (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-5 text-center">
          <CheckCircle2 className="mx-auto size-6 text-emerald-300" />
          <p className="mt-2 text-sm font-medium">No actionable findings</p>
        </div>
      ) : (
        output.findings.map((finding, index) => (
          <article className="rounded-xl border bg-card p-4" key={`${finding.title}-${index}`}>
            <div className="flex items-start gap-3">
              <Badge variant="outline">{finding.priority}</Badge>
              <p className="min-w-0 flex-1 text-sm font-semibold leading-5">{finding.title}</p>
            </div>
            <div className="mt-3 text-sm leading-6">
              <MarkdownReview
                markdown={finding.bodyMarkdown}
                onCodeReference={() => undefined}
                onExternalLink={onOpenExternal}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
              {finding.locations.map((location, locationIndex) => (
                <Badge
                  className="max-w-full truncate font-mono font-normal"
                  key={`${formatReviewLocation(location)}-${locationIndex}`}
                  title={formatReviewLocation(location)}
                  variant="outline"
                >
                  {formatReviewLocation(location)}
                </Badge>
              ))}
              {finding.links.map((link) => (
                <Button
                  className="max-w-full"
                  key={link.url}
                  onClick={() => onOpenExternal(link.url)}
                  size="sm"
                  variant="outline"
                >
                  <ExternalLink />
                  <span className="truncate">{link.label}</span>
                </Button>
              ))}
            </div>
          </article>
        ))
      )}
    </div>
  )
}

function ReasoningContent({ step }: { step: ReviewStepDetail | null }) {
  if (!step || step.reasoningSummaries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <BrainCircuit className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">No reasoning summary available</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          The model may not have provided a readable summary for this step.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
        These are model-generated summaries for understanding the review process, not the model's
        complete internal chain of thought.
      </div>
      {step.reasoningSummaries.map((summary, index) => (
        <section className="rounded-xl border bg-card p-4" key={summary.id}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Reasoning {index + 1}
            </p>
            <span className="text-[0.68rem] text-muted-foreground">
              {formatDate(summary.occurredAt)}
            </span>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{summary.text}</p>
        </section>
      ))}
      {step.reasoningTruncated && (
        <div className="flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          The recorded reasoning summary was shortened to Revy's storage limit.
        </div>
      )}
    </div>
  )
}

function ActivityContent({
  activity,
  highlightedActivityId,
}: {
  activity: AgentActivityEntry[]
  highlightedActivityId?: string | null | undefined
}) {
  if (activity.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <ListTree className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">No step activity recorded</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Run-wide preparation and saving events remain in the main timeline.
        </p>
      </div>
    )
  }
  return (
    <ol className="space-y-3">
      {activity.map((entry) => (
        <li
          className={`rounded-xl border bg-card p-4 ${
            entry.id === highlightedActivityId ? 'ring-2 ring-primary/70' : ''
          }`}
          key={entry.id}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{entry.title}</p>
              <p className="mt-1 text-[0.68rem] text-muted-foreground">
                {formatDate(entry.occurredAt)}
              </p>
            </div>
            <Badge variant="outline">{entry.status}</Badge>
          </div>
          {(entry.name || entry.paths.length > 0 || entry.durationMs !== null) && (
            <div className="mt-3 space-y-2 border-t pt-3 text-xs">
              {entry.name && <p className="font-mono text-muted-foreground">{entry.name}</p>}
              {entry.paths.map((path) => (
                <p className="break-all font-mono" key={path}>
                  {path}
                </p>
              ))}
              {entry.durationMs !== null && (
                <p className="text-muted-foreground">Duration {formatDuration(entry.durationMs)}</p>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

export function ReviewStepInspector({
  highlightedActivityId,
  onClose,
  onOpenExternal,
  preferredTab,
  run,
  stepId,
}: ReviewStepInspectorProps) {
  const reviewer = run.metadata.reviewPlan.reviewers.find(
    (candidate) => reviewerReviewStepId(candidate.profileId) === stepId,
  )
  const coordinator = stepId === coordinatorReviewStepId
  const step = run.steps.find((candidate) => candidate.id === stepId) ?? null
  const status = step?.status ?? reviewer?.status ?? 'pending'
  const [tab, setTab] = useState<ReviewStepInspectorTab>(
    preferredTab ?? defaultTab(status, step?.output ?? null),
  )
  const relatedActivity = useMemo(
    () => run.activity.filter((entry) => entry.stepId === stepId),
    [run.activity, stepId],
  )
  const duration = stepDuration(step)
  const name = coordinator
    ? run.metadata.reviewPlan.reviewers.length === 0
      ? 'Standard Review'
      : 'Consolidated Review'
    : (reviewer?.name ?? 'Reviewer')
  const model = coordinator ? run.metadata.model : reviewer?.model
  const reasoningEffort = coordinator ? run.metadata.reasoningEffort : reviewer?.reasoningEffort

  useEffect(() => {
    setTab(preferredTab ?? defaultTab(status, step?.output ?? null))
  }, [highlightedActivityId, preferredTab, status, step?.output, stepId])

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <aside className="flex h-full min-h-0 w-[28rem] max-w-[45vw] shrink-0 flex-col border-l bg-background shadow-2xl max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:z-30 max-xl:max-w-[min(32rem,90vw)]">
      <header className="shrink-0 border-b px-5 py-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-primary/10 text-primary">
            <Bot className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {statusIcon(status)}
              <h2 className="truncate font-semibold" title={name}>
                {name}
              </h2>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="outline">{formatStatus(status)}</Badge>
              <Badge variant="outline">
                {coordinator ? 'Coordinator' : reviewer?.required ? 'Required' : 'Optional'}
              </Badge>
              {model && <Badge variant="outline">{model}</Badge>}
              {reasoningEffort && <Badge variant="outline">{reasoningEffort}</Badge>}
            </div>
          </div>
          <Button aria-label="Close step details" onClick={onClose} size="icon-sm" variant="ghost">
            <X />
          </Button>
        </div>
        {(step?.startedAt || duration) && (
          <p className="mt-3 text-xs text-muted-foreground">
            {step?.startedAt ? `Started ${formatDate(step.startedAt)}` : ''}
            {duration ? ` · ${duration}` : ''}
          </p>
        )}
        {step?.error && (
          <div className="mt-4 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs leading-5 text-red-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {step.error}
          </div>
        )}
      </header>

      <Tabs
        className="min-h-0 flex-1 gap-0"
        onValueChange={(value) => setTab(value as ReviewStepInspectorTab)}
        value={tab}
      >
        <TabsList className="mx-5 mt-4 grid w-auto grid-cols-3" variant="line">
          <TabsTrigger value="result">Result</TabsTrigger>
          <TabsTrigger value="reasoning">Reasoning</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-5">
            {run.steps.length === 0 && (
              <div className="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                Step details were not recorded for this older run.
              </div>
            )}
            <TabsContent value="result">
              <ResultContent
                coordinator={coordinator}
                onOpenExternal={onOpenExternal}
                output={step?.output ?? null}
                status={status}
              />
            </TabsContent>
            <TabsContent value="reasoning">
              <ReasoningContent step={step} />
            </TabsContent>
            <TabsContent value="activity">
              <ActivityContent
                activity={relatedActivity}
                highlightedActivityId={highlightedActivityId}
              />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </aside>
  )
}
