import type {
  ReviewFinding,
  ReviewLocation,
  ReviewPriority,
  StructuredReview,
} from './contracts.js'
import { structuredReviewSchema } from './contracts.js'

export const reviewPriorities = ['P0', 'P1', 'P2', 'P3'] as const

export const reviewPriorityLabels: Record<ReviewPriority, string> = {
  P0: 'Critical',
  P1: 'High priority',
  P2: 'Medium priority',
  P3: 'Low priority',
}

const priorityRank = new Map<ReviewPriority, number>(
  reviewPriorities.map((priority, index) => [priority, index]),
)

function stripOuterJsonFence(value: string): string {
  const trimmed = value.trim()
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed)
  return match?.[1]?.trim() ?? trimmed
}

function escapeMarkdownLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
}

export function parseStructuredReview(value: string): StructuredReview {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripOuterJsonFence(value)) as unknown
  } catch {
    throw new Error('Codex returned an invalid structured review. No review was saved.')
  }

  const review = structuredReviewSchema.safeParse(parsed)
  if (!review.success) {
    throw new Error(
      `Codex returned an invalid structured review: ${review.error.issues.at(0)?.message ?? 'validation failed'}. No review was saved.`,
    )
  }
  return review.data
}

export function sortReviewFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((left, right) => {
      const priorityDifference =
        (priorityRank.get(left.finding.priority) ?? Number.MAX_SAFE_INTEGER) -
        (priorityRank.get(right.finding.priority) ?? Number.MAX_SAFE_INTEGER)
      return priorityDifference || left.index - right.index
    })
    .map(({ finding }) => finding)
}

export function highestReviewPriority(review: StructuredReview): ReviewPriority | null {
  return sortReviewFindings(review.findings)[0]?.priority ?? null
}

export function reviewAssessment(review: StructuredReview): string {
  const highestPriority = highestReviewPriority(review)
  if (!highestPriority) {
    return 'Ready to ship'
  }
  return highestPriority === 'P0' || highestPriority === 'P1' ? 'Changes requested' : 'Comments'
}

export function formatReviewLocation(location: ReviewLocation): string {
  const lines =
    location.endLine && location.endLine > location.line
      ? `${location.line}-${location.endLine}`
      : `${location.line}`
  return `${location.path}:${lines}`
}

export function formatReviewFindingMarkdown(finding: ReviewFinding): string {
  const locations = finding.locations
    .map((location) => `\`${formatReviewLocation(location)}\``)
    .join(', ')
  const references = finding.links
    .map((link) => `[${escapeMarkdownLabel(link.label)}](${link.url})`)
    .join(', ')

  return [
    `### [${finding.priority}] ${finding.title}`,
    '',
    finding.bodyMarkdown.trim(),
    '',
    `**Location:** ${locations}`,
    ...(references ? ['', `**References:** ${references}`] : []),
  ].join('\n')
}

export function formatStructuredReviewMarkdown(review: StructuredReview): string {
  const findings = sortReviewFindings(review.findings)
  return [
    '## Review summary',
    '',
    review.summary.trim(),
    '',
    ...(findings.length === 0
      ? ['No actionable findings.']
      : ['## Findings', '', findings.map(formatReviewFindingMarkdown).join('\n\n')]),
    '',
  ].join('\n')
}

export function formatLegacyReviewMarkdown(markdown: string): string {
  const trimmed = markdown.trim()
  if (!trimmed.startsWith('# Revy review')) {
    return trimmed
  }
  const separator = '\n---\n'
  const separatorIndex = trimmed.indexOf(separator)
  return separatorIndex < 0 ? trimmed : trimmed.slice(separatorIndex + separator.length).trim()
}
