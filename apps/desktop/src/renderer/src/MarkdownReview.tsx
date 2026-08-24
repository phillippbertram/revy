import type { ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface CodeReference {
  endLine?: number
  line: number
  path: string
}

interface MarkdownReviewProps {
  markdown: string
  onCodeReference: (reference: CodeReference) => void
  onExternalLink: (url: string) => void
}

function parseCodeReference(href: string | undefined): CodeReference | null {
  if (!href?.startsWith('revy://code/')) {
    return null
  }
  try {
    const url = new URL(href)
    if (url.protocol !== 'revy:' || url.hostname !== 'code') {
      return null
    }
    const path = decodeURIComponent(url.pathname.slice(1))
    const line = Number.parseInt(url.searchParams.get('line') ?? '', 10)
    const endValue = url.searchParams.get('end')
    const endLine = endValue ? Number.parseInt(endValue, 10) : undefined
    if (!path || !Number.isInteger(line) || line < 1) {
      return null
    }
    return {
      ...(endLine && endLine >= line ? { endLine } : {}),
      line,
      path,
    }
  } catch {
    return null
  }
}

function MarkdownLink({
  children,
  href,
  onCodeReference,
  onExternalLink,
}: ComponentPropsWithoutRef<'a'> &
  Pick<MarkdownReviewProps, 'onCodeReference' | 'onExternalLink'>) {
  const reference = parseCodeReference(href)
  if (reference) {
    return (
      <button
        className="inline rounded-sm font-mono text-[0.92em] text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onCodeReference(reference)}
        type="button"
      >
        {children}
      </button>
    )
  }
  try {
    if (href && new URL(href).protocol === 'https:') {
      return (
        <button
          className="inline rounded-sm text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onExternalLink(href)}
          type="button"
        >
          {children}
        </button>
      )
    }
  } catch {
    // Unsupported links remain visible without becoming navigation targets.
  }
  return (
    <span className="text-primary underline decoration-primary/40 underline-offset-4">
      {children}
    </span>
  )
}

export function MarkdownReview({ markdown, onCodeReference, onExternalLink }: MarkdownReviewProps) {
  return (
    <article className="review-markdown max-w-none text-[0.95rem] leading-7 text-foreground/90">
      <ReactMarkdown
        components={{
          a: (props) => (
            <MarkdownLink
              {...props}
              onCodeReference={onCodeReference}
              onExternalLink={onExternalLink}
            />
          ),
        }}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {markdown}
      </ReactMarkdown>
    </article>
  )
}
