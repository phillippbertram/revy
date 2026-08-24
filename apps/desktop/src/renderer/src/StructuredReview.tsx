import { Badge } from '@shippy/ui/components/badge'
import { Button } from '@shippy/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@shippy/ui/components/card'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  MapPin,
  MessageSquareText,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  ReviewFinding,
  ReviewPriority,
  StructuredReview as StructuredReviewContent,
} from '../../shared/contracts.js'
import {
  formatReviewFindingMarkdown,
  formatReviewLocation,
  reviewAssessment,
  reviewPriorities,
  reviewPriorityLabels,
  sortReviewFindings,
} from '../../shared/review-formats.js'
import { type CodeReference, MarkdownReview } from './MarkdownReview'

const priorityStyles: Record<ReviewPriority, string> = {
  P0: 'border-red-400/30 bg-red-400/10 text-red-200',
  P1: 'border-orange-400/30 bg-orange-400/10 text-orange-200',
  P2: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  P3: 'border-slate-400/30 bg-slate-400/10 text-slate-200',
}

const cardBorderStyles: Record<ReviewPriority, string> = {
  P0: 'border-l-red-400/70',
  P1: 'border-l-orange-400/70',
  P2: 'border-l-sky-400/70',
  P3: 'border-l-slate-400/70',
}

interface CopyButtonProps {
  className?: string
  label: string
  onCopy: (text: string) => Promise<boolean>
  showLabel?: boolean
  text: string
}

export function CopyButton({ className, label, onCopy, showLabel = false, text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return undefined
    }
    const timer = window.setTimeout(() => setCopied(false), 2_000)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <Button
      aria-label={copied ? `${label} copied` : label}
      className={`${className ?? ''} ${
        copied ? 'text-emerald-300' : showLabel ? '' : 'text-muted-foreground'
      }`}
      onClick={() => {
        void onCopy(text).then(setCopied)
      }}
      size={showLabel ? 'sm' : 'icon-sm'}
      title={copied ? `${label} copied` : label}
      variant={showLabel ? 'outline' : 'ghost'}
    >
      {copied ? <Check /> : <Copy />}
      {showLabel && (copied ? 'Copied' : label)}
      <span aria-live="polite" className="sr-only">
        {copied ? `${label} copied to the clipboard.` : ''}
      </span>
    </Button>
  )
}

interface FindingCardProps {
  finding: ReviewFinding
  index: number
  onCopy: (text: string) => Promise<boolean>
  onOpenExternal: (url: string) => void
  onOpenSource: (reference: CodeReference) => void
}

function FindingCard({ finding, index, onCopy, onOpenExternal, onOpenSource }: FindingCardProps) {
  return (
    <Card className={`gap-0 border-l-4 py-0 ${cardBorderStyles[finding.priority]}`}>
      <CardHeader className="relative flex-row items-start gap-4 px-5 py-4 pr-14">
        <Badge className={priorityStyles[finding.priority]} variant="outline">
          {finding.priority}
        </Badge>
        <div className="min-w-0 flex-1">
          <CardTitle className="text-base leading-6">{finding.title}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {reviewPriorityLabels[finding.priority]}
          </p>
        </div>
        <CopyButton
          className="absolute top-3 right-3"
          label="Copy finding"
          onCopy={onCopy}
          text={formatReviewFindingMarkdown(finding)}
        />
      </CardHeader>
      <CardContent className="space-y-4 border-t px-5 py-4">
        <MarkdownReview
          markdown={finding.bodyMarkdown}
          onCodeReference={onOpenSource}
          onExternalLink={onOpenExternal}
        />
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {finding.locations.map((location, locationIndex) => (
            <Button
              className="font-mono text-xs"
              key={`${index}-${formatReviewLocation(location)}-${locationIndex}`}
              onClick={() =>
                onOpenSource({
                  ...(location.endLine === undefined ? {} : { endLine: location.endLine }),
                  line: location.line,
                  path: location.path,
                })
              }
              size="sm"
              variant="outline"
            >
              <MapPin />
              {formatReviewLocation(location)}
            </Button>
          ))}
          {finding.links.map((link, linkIndex) => (
            <Button
              key={`${link.url}-${linkIndex}`}
              onClick={() => onOpenExternal(link.url)}
              size="sm"
              variant="outline"
            >
              <ExternalLink />
              {link.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

interface StructuredReviewProps {
  content: StructuredReviewContent
  onCopy: (text: string) => Promise<boolean>
  onOpenExternal: (url: string) => void
  onOpenSource: (reference: CodeReference) => void
}

export function StructuredReview({
  content,
  onCopy,
  onOpenExternal,
  onOpenSource,
}: StructuredReviewProps) {
  const findings = useMemo(() => sortReviewFindings(content.findings), [content.findings])
  const assessment = reviewAssessment(content)
  const AssessmentIcon =
    assessment === 'Ready to ship'
      ? CheckCircle2
      : assessment === 'Changes requested'
        ? AlertTriangle
        : MessageSquareText

  return (
    <div className="space-y-8">
      <Card className="gap-0 py-0">
        <CardHeader className="flex-row items-start gap-4 px-5 py-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-primary/10 text-primary">
            <AssessmentIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-xl">{assessment}</CardTitle>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{content.summary}</p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 border-t px-5 py-4">
          <Badge variant="secondary">
            {findings.length} {findings.length === 1 ? 'finding' : 'findings'}
          </Badge>
          {reviewPriorities.map((priority) => {
            const count = findings.filter((finding) => finding.priority === priority).length
            return (
              <Badge className={priorityStyles[priority]} key={priority} variant="outline">
                {priority} {count}
              </Badge>
            )
          })}
        </CardContent>
      </Card>

      {findings.length === 0 ? (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-5 py-8 text-center">
          <CheckCircle2 className="mx-auto size-7 text-emerald-300" />
          <p className="mt-3 font-medium">No actionable findings</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Codex did not identify a concrete issue in the reviewed changes.
          </p>
        </div>
      ) : (
        reviewPriorities.map((priority) => {
          const priorityFindings = findings.filter((finding) => finding.priority === priority)
          if (priorityFindings.length === 0) {
            return null
          }
          return (
            <section className="space-y-3" key={priority}>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold tracking-wide">
                  {priority} · {reviewPriorityLabels[priority]}
                </h2>
                <Badge variant="secondary">{priorityFindings.length}</Badge>
              </div>
              {priorityFindings.map((finding, index) => (
                <FindingCard
                  finding={finding}
                  index={index}
                  key={`${priority}-${finding.title}-${index}`}
                  onCopy={onCopy}
                  onOpenExternal={onOpenExternal}
                  onOpenSource={onOpenSource}
                />
              ))}
            </section>
          )
        })
      )}
    </div>
  )
}
