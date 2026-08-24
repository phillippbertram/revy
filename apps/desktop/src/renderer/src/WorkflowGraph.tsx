import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react'
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  GitMerge,
  LoaderCircle,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentActivityEntry,
  ResolvedReviewPlan,
  ReviewerExecutionStatus,
  ReviewProgress,
  ReviewRunStatus,
  ReviewStepDetail,
} from '../../shared/contracts.js'
import { coordinatorReviewStepId, reviewerReviewStepId } from '../../shared/contracts.js'

export interface WorkflowGraphReviewer {
  description: string
  name: string
  profileId: string
  required: boolean
  selected: boolean
  status: ReviewerExecutionStatus
  statusLabel?: string
}

type WorkflowNodeData = {
  clickable: boolean
  description: string
  kind: 'consolidation' | 'reviewer'
  meta: string
  name: string
  onActivate: (() => void) | null
  profileId: string | null
  selected: boolean
  status: ReviewerExecutionStatus
  statusLabel: string
  stepId: string
  targetHandleIds: string[]
}

type WorkflowNode = Node<WorkflowNodeData, 'workflowStep'>

const nodeTypes = { workflowStep: WorkflowStepNode } satisfies NodeTypes

const statusColors: Record<ReviewerExecutionStatus, string> = {
  cancelled: 'oklch(0.75 0.14 75)',
  completed: 'oklch(0.72 0.17 155)',
  failed: 'oklch(0.7 0.19 25)',
  'not-selected': 'oklch(0.5 0 0)',
  pending: 'oklch(0.62 0.08 255)',
  running: 'var(--primary)',
}

function formatStatus(status: ReviewerExecutionStatus): string {
  if (status === 'not-selected') {
    return 'Not selected'
  }
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`
}

function statusClasses(status: ReviewerExecutionStatus): string {
  if (status === 'completed') {
    return 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200'
  }
  if (status === 'failed') {
    return 'border-red-400/35 bg-red-400/10 text-red-200'
  }
  if (status === 'cancelled') {
    return 'border-amber-400/35 bg-amber-400/10 text-amber-200'
  }
  if (status === 'running') {
    return 'border-primary/55 bg-primary/10 text-primary shadow-lg shadow-primary/10'
  }
  if (status === 'not-selected') {
    return 'border-border/70 bg-muted/30 text-muted-foreground opacity-70'
  }
  return 'border-border bg-card text-foreground'
}

function StatusIcon({ status }: { status: ReviewerExecutionStatus }) {
  if (status === 'running') {
    return <LoaderCircle className="size-3 animate-spin" />
  }
  if (status === 'completed') {
    return <Check className="size-3" />
  }
  if (status === 'failed' || status === 'cancelled') {
    return <X className="size-3" />
  }
  return <Circle className="size-2.5 fill-current" />
}

function WorkflowStepNode({ data }: NodeProps<WorkflowNode>) {
  const Icon = data.kind === 'consolidation' ? GitMerge : Bot
  return (
    <div
      className={`nodrag nopan relative w-[13.5rem] rounded-xl border p-3.5 transition-colors ${statusClasses(
        data.status,
      )} ${data.status === 'running' ? 'animate-pulse' : ''} ${
        data.clickable ? 'cursor-pointer hover:border-primary/70 hover:bg-primary/10' : ''
      } ${data.selected ? 'ring-2 ring-primary/70 ring-offset-2 ring-offset-background' : ''}`}
    >
      {data.onActivate && (
        <button
          aria-label={`Open details for ${data.name}`}
          className="nodrag nopan absolute inset-0 z-10 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={(event) => {
            event.stopPropagation()
            data.onActivate?.()
          }}
          type="button"
        />
      )}
      {data.kind === 'consolidation' &&
        data.targetHandleIds.map((handleId, index) => (
          <Handle
            className="pointer-events-none! size-0! border-0! bg-transparent!"
            id={handleId}
            key={handleId}
            position={Position.Top}
            style={{ left: `${((index + 1) / (data.targetHandleIds.length + 1)) * 100}%` }}
            type="target"
          />
        ))}
      <div className="pointer-events-none relative z-20 flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-current/15 bg-background/40">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={data.name}>
            {data.name}
          </p>
          <p className="mt-1 truncate text-[0.68rem] opacity-75" title={data.meta}>
            {data.meta}
          </p>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 min-h-8 text-[0.68rem] leading-4 opacity-75">
        {data.description}
      </p>
      <div className="mt-3 flex items-center gap-1.5 text-[0.65rem] font-semibold tracking-wide uppercase">
        <StatusIcon status={data.status} />
        {data.statusLabel}
      </div>
      {data.kind === 'reviewer' && (
        <Handle
          className="pointer-events-none! size-0! border-0! bg-transparent!"
          id={data.profileId ? `source:${data.profileId}` : null}
          position={Position.Bottom}
          type="source"
        />
      )}
    </div>
  )
}

export function resolveWorkflowGraphReviewers(
  plan: ResolvedReviewPlan,
  activity: AgentActivityEntry[],
  steps: ReviewStepDetail[] = [],
): WorkflowGraphReviewer[] {
  return plan.reviewers.map((reviewer) => {
    if (!reviewer.selected || reviewer.status === 'not-selected') {
      return { ...reviewer, status: 'not-selected' }
    }
    if (reviewer.status !== 'pending' && reviewer.status !== 'running') {
      return reviewer
    }
    const step = steps.find(
      (candidate) => candidate.id === reviewerReviewStepId(reviewer.profileId),
    )
    if (step) {
      return { ...reviewer, status: step.status }
    }
    const reviewerActivity = activity.filter(
      (entry) => entry.reviewer?.profileId === reviewer.profileId,
    )
    const terminalEntry = reviewerActivity.findLast(
      (entry) =>
        entry.kind === 'lifecycle' &&
        ['cancelled', 'completed', 'failed', 'interrupted'].includes(entry.status),
    )
    if (terminalEntry?.status === 'completed') {
      return { ...reviewer, status: 'completed' }
    }
    if (terminalEntry?.status === 'failed') {
      return { ...reviewer, status: 'failed' }
    }
    if (terminalEntry?.status === 'cancelled' || terminalEntry?.status === 'interrupted') {
      return { ...reviewer, status: 'cancelled' }
    }
    return { ...reviewer, status: reviewerActivity.length > 0 ? 'running' : 'pending' }
  })
}

export function resolveConsolidationStatus(
  runStatus: ReviewProgress['state'] | ReviewRunStatus,
  reviewers: WorkflowGraphReviewer[],
  coordinatorStep?: ReviewStepDetail,
): ReviewerExecutionStatus {
  if (coordinatorStep) {
    return coordinatorStep.status
  }
  if (runStatus === 'completed' || runStatus === 'completed-with-warnings') {
    return 'completed'
  }
  if (runStatus === 'failed') {
    return 'failed'
  }
  if (runStatus === 'cancelled' || runStatus === 'interrupted') {
    return 'cancelled'
  }
  if (runStatus === 'saving') {
    return 'completed'
  }
  if (runStatus === 'preparing') {
    return 'pending'
  }
  const selected = reviewers.filter((reviewer) => reviewer.selected)
  if (
    selected.length > 0 &&
    selected.some((reviewer) => reviewer.status === 'pending' || reviewer.status === 'running')
  ) {
    return 'pending'
  }
  return 'running'
}

interface WorkflowGraphProps {
  consolidationStatus: ReviewerExecutionStatus
  consolidationStatusLabel?: string
  onReviewerClick?: ((profileId: string) => void) | undefined
  onStepClick?: ((stepId: string) => void) | undefined
  reviewers: WorkflowGraphReviewer[]
  selectedStepId?: string | null
  standardReview?: boolean
}

export function WorkflowGraph({
  consolidationStatus,
  consolidationStatusLabel,
  onReviewerClick,
  onStepClick,
  reviewers,
  selectedStepId,
  standardReview,
}: WorkflowGraphProps) {
  const batchSize = 4
  const reviewerSnapshotKey = JSON.stringify(reviewers)
  const reviewerSnapshotRef = useRef({ key: reviewerSnapshotKey, reviewers })
  if (reviewerSnapshotRef.current.key !== reviewerSnapshotKey) {
    reviewerSnapshotRef.current = { key: reviewerSnapshotKey, reviewers }
  }
  const graphReviewers = reviewerSnapshotRef.current.reviewers
  const onReviewerClickRef = useRef(onReviewerClick)
  const onStepClickRef = useRef(onStepClick)
  onReviewerClickRef.current = onReviewerClick
  onStepClickRef.current = onStepClick
  const reviewersClickable = Boolean(onReviewerClick || onStepClick)
  const coordinatorClickable = Boolean(onStepClick)
  const batchCount = Math.max(1, Math.ceil(graphReviewers.length / batchSize))
  const runningReviewerIndex = graphReviewers.findIndex((reviewer) => reviewer.status === 'running')
  const runningBatch =
    runningReviewerIndex >= 0 ? Math.floor(runningReviewerIndex / batchSize) : null
  const [selectedBatch, setSelectedBatch] = useState(runningBatch ?? 0)
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<WorkflowNode, Edge> | null>(
    null,
  )
  const canvasRef = useRef<HTMLDivElement>(null)
  const currentBatch = Math.min(selectedBatch, batchCount - 1)
  const visibleReviewers = useMemo(
    () => graphReviewers.slice(currentBatch * batchSize, currentBatch * batchSize + batchSize),
    [currentBatch, graphReviewers],
  )
  const visibleReviewerKey = visibleReviewers.map((reviewer) => reviewer.profileId).join(':')

  useEffect(() => {
    setSelectedBatch((current) => Math.min(current, batchCount - 1))
  }, [batchCount])

  useEffect(() => {
    if (runningBatch !== null) {
      setSelectedBatch(runningBatch)
    }
  }, [runningBatch])

  const { edges, height, nodes } = useMemo(() => {
    const isStandardReview = standardReview ?? graphReviewers.length === 0
    const horizontalGap = 288
    const reviewerWidth = Math.max(0, (visibleReviewers.length - 1) * horizontalGap)
    const targetHandleIds = visibleReviewers.map((reviewer) => `target:${reviewer.profileId}`)
    const nextNodes: WorkflowNode[] = visibleReviewers.map((reviewer, index) => {
      return {
        className: 'nopan',
        data: {
          clickable: reviewersClickable,
          description: reviewer.description,
          kind: 'reviewer',
          meta: reviewer.required ? 'Required reviewer' : 'Optional reviewer',
          name: reviewer.name,
          onActivate: reviewersClickable
            ? () => {
                const reviewerHandler = onReviewerClickRef.current
                if (reviewerHandler) {
                  reviewerHandler(reviewer.profileId)
                  return
                }
                onStepClickRef.current?.(reviewerReviewStepId(reviewer.profileId))
              }
            : null,
          profileId: reviewer.profileId,
          selected: selectedStepId === reviewerReviewStepId(reviewer.profileId),
          status: reviewer.status,
          statusLabel: reviewer.statusLabel ?? formatStatus(reviewer.status),
          stepId: reviewerReviewStepId(reviewer.profileId),
          targetHandleIds: [],
        },
        deletable: false,
        draggable: false,
        focusable: false,
        id: `reviewer:${reviewer.profileId}`,
        position: { x: index * horizontalGap - reviewerWidth / 2, y: 0 },
        selectable: false,
        type: 'workflowStep',
      }
    })
    const consolidationId = 'consolidation'
    nextNodes.push({
      className: 'nopan',
      data: {
        clickable: coordinatorClickable,
        description: isStandardReview
          ? 'Runs the existing single-agent review and produces the final structured result.'
          : 'Combines the selected specialist results into the final structured review.',
        kind: 'consolidation',
        meta: isStandardReview ? 'Built-in single-agent workflow' : 'Fixed final step',
        name: isStandardReview ? 'Standard Review' : 'Consolidated Review',
        onActivate: coordinatorClickable
          ? () => onStepClickRef.current?.(coordinatorReviewStepId)
          : null,
        profileId: null,
        selected: selectedStepId === coordinatorReviewStepId,
        status: consolidationStatus,
        statusLabel: consolidationStatusLabel ?? formatStatus(consolidationStatus),
        stepId: coordinatorReviewStepId,
        targetHandleIds,
      },
      deletable: false,
      draggable: false,
      focusable: false,
      id: consolidationId,
      position: { x: 0, y: graphReviewers.length > 0 ? 245 : 20 },
      selectable: false,
      type: 'workflowStep',
    })
    const nextEdges: Edge[] = visibleReviewers.map((reviewer) => {
      const color = statusColors[reviewer.status]
      const animated =
        reviewer.status === 'running' ||
        (consolidationStatus === 'running' && reviewer.status === 'completed')
      return {
        animated,
        deletable: false,
        focusable: false,
        id: `reviewer:${reviewer.profileId}:consolidation`,
        markerEnd: { color, height: 14, type: MarkerType.ArrowClosed, width: 14 },
        selectable: false,
        source: `reviewer:${reviewer.profileId}`,
        sourceHandle: `source:${reviewer.profileId}`,
        style: {
          opacity: reviewer.status === 'not-selected' ? 0.35 : 0.9,
          stroke: color,
          strokeDasharray: reviewer.status === 'not-selected' ? '4 5' : undefined,
          strokeWidth: animated ? 2 : 1.5,
        },
        target: consolidationId,
        targetHandle: `target:${reviewer.profileId}`,
        type: 'default',
      }
    })
    return {
      edges: nextEdges,
      height: graphReviewers.length === 0 ? 250 : 410,
      nodes: nextNodes,
    }
  }, [
    consolidationStatus,
    consolidationStatusLabel,
    coordinatorClickable,
    graphReviewers.length,
    reviewersClickable,
    selectedStepId,
    standardReview,
    visibleReviewers,
  ])

  useEffect(() => {
    if (!flowInstance) {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      void flowInstance.fitView({ maxZoom: 1, padding: 0.18 })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [flowInstance, height, visibleReviewerKey])

  useEffect(() => {
    if (!flowInstance || !canvasRef.current) {
      return
    }
    let frame: number | null = null
    let lastHeight = -1
    let lastWidth = -1
    const fitVisibleCanvas = (): void => {
      const canvas = canvasRef.current
      if (!canvas) {
        return
      }
      const bounds = canvas.getBoundingClientRect()
      const nextHeight = Math.round(bounds.height)
      const nextWidth = Math.round(bounds.width)
      if (nextHeight < 64 || nextWidth < 64) {
        return
      }
      if (nextHeight === lastHeight && nextWidth === lastWidth) {
        return
      }
      lastHeight = nextHeight
      lastWidth = nextWidth
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
      frame = window.requestAnimationFrame(() => {
        frame = null
        void flowInstance.fitView({ maxZoom: 1, padding: 0.18 })
      })
    }
    const observer = new ResizeObserver(() => {
      fitVisibleCanvas()
    })
    observer.observe(canvasRef.current)
    fitVisibleCanvas()
    return () => {
      observer.disconnect()
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [flowInstance])

  return (
    <div className="overflow-hidden rounded-xl border bg-background/50">
      {batchCount > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/15 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Reviewers {currentBatch * batchSize + 1}–
            {Math.min((currentBatch + 1) * batchSize, graphReviewers.length)} of{' '}
            {graphReviewers.length}
            <span className="mx-2 opacity-50">·</span>
            Batch {currentBatch + 1} of {batchCount}
          </p>
          <div className="flex items-center gap-1">
            <button
              aria-label="Previous reviewer batch"
              className="flex size-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-35"
              disabled={currentBatch === 0}
              onClick={() => setSelectedBatch((batch) => Math.max(0, batch - 1))}
              type="button"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <button
              aria-label="Next reviewer batch"
              className="flex size-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-35"
              disabled={currentBatch === batchCount - 1}
              onClick={() => setSelectedBatch((batch) => Math.min(batchCount - 1, batch + 1))}
              type="button"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}
      <div ref={canvasRef} style={{ height, width: '100%' }}>
        <ReactFlow
          colorMode="dark"
          edges={edges}
          edgesFocusable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.18 }}
          maxZoom={1.25}
          minZoom={0.3}
          nodes={nodes}
          nodesConnectable={false}
          nodesDraggable={false}
          nodesFocusable={false}
          nodeTypes={nodeTypes}
          onInit={setFlowInstance}
          onNodeClick={(_, node) => node.data.onActivate?.()}
          panOnDrag
          preventScrolling={false}
          zoomOnDoubleClick={false}
          zoomOnPinch
          zoomOnScroll={false}
        >
          <Background color="oklch(0.5 0 0 / 0.18)" gap={18} variant={BackgroundVariant.Dots} />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
