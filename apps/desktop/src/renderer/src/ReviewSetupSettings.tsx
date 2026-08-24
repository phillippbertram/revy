import { Badge } from '@revy/ui/components/badge'
import { Button } from '@revy/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@revy/ui/components/card'
import { Input } from '@revy/ui/components/input'
import { Label } from '@revy/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@revy/ui/components/select'
import { Switch } from '@revy/ui/components/switch'
import { Textarea } from '@revy/ui/components/textarea'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronRight,
  Copy,
  Library,
  Plus,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  BootstrapState,
  ReviewerProfile,
  ReviewWorkflow,
  SaveReviewerProfileInput,
  SaveReviewWorkflowInput,
} from '../../shared/contracts.js'
import { standardReviewWorkflowId } from '../../shared/contracts.js'
import { builtInReviewerProfiles } from '../../shared/review-presets.js'
import { WorkflowGraph, type WorkflowGraphReviewer } from './WorkflowGraph'

type ReviewSetupView = 'preset-picker' | 'reviewer' | 'reviewer-library' | 'workflow'
type SaveState = 'idle' | 'saved' | 'saving'

const emptyReviewer: SaveReviewerProfileInput = {
  description: '',
  id: null,
  instructions: '',
  model: null,
  name: '',
  reasoningEffort: null,
}

const emptyWorkflow: SaveReviewWorkflowInput = { id: null, name: '', reviewers: [] }

function profileDraft(profile: ReviewerProfile): SaveReviewerProfileInput {
  return {
    description: profile.description,
    id: profile.id,
    instructions: profile.instructions,
    model: profile.model,
    name: profile.name,
    reasoningEffort: profile.reasoningEffort,
  }
}

function workflowDraft(workflow: ReviewWorkflow): SaveReviewWorkflowInput {
  return { id: workflow.id, name: workflow.name, reviewers: workflow.reviewers }
}

function serialized(value: SaveReviewerProfileInput | SaveReviewWorkflowInput): string {
  return JSON.stringify(value)
}

function hasReviewerContent(draft: SaveReviewerProfileInput): boolean {
  return Boolean(
    draft.name.trim() ||
      draft.description.trim() ||
      draft.instructions.trim() ||
      draft.model ||
      draft.reasoningEffort,
  )
}

function hasWorkflowContent(draft: SaveReviewWorkflowInput): boolean {
  return Boolean(draft.name.trim() || draft.reviewers.length > 0)
}

function SaveIndicator({ dirty, state }: { dirty: boolean; state: SaveState }) {
  if (state === 'saving') {
    return <span className="text-xs font-medium text-primary">Saving…</span>
  }
  if (dirty) {
    return <span className="text-xs font-medium text-amber-300">Unsaved changes</span>
  }
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
        <CheckCircle2 className="size-3.5" />
        Saved
      </span>
    )
  }
  return <span />
}

interface ReviewSetupSettingsProps {
  bootstrap: BootstrapState
  busy: boolean
  onDeleteReviewerProfile: (profileId: string) => Promise<boolean>
  onDeleteWorkflow: (workflowId: string) => Promise<boolean>
  onDirtyChange: (dirty: boolean) => void
  onSaveReviewerProfile: (input: SaveReviewerProfileInput) => Promise<boolean>
  onSaveWorkflow: (input: SaveReviewWorkflowInput) => Promise<boolean>
}

export function ReviewSetupSettings({
  bootstrap,
  busy,
  onDeleteReviewerProfile,
  onDeleteWorkflow,
  onDirtyChange,
  onSaveReviewerProfile,
  onSaveWorkflow,
}: ReviewSetupSettingsProps) {
  const [addReviewerOpen, setAddReviewerOpen] = useState(false)
  const [addCreatedReviewerToWorkflow, setAddCreatedReviewerToWorkflow] = useState(false)
  const [reviewerBackTarget, setReviewerBackTarget] = useState<'library' | 'workflow'>('workflow')
  const [reviewerBaseline, setReviewerBaseline] = useState<string | null>(null)
  const [reviewerDraftValue, setReviewerDraftValue] =
    useState<SaveReviewerProfileInput>(emptyReviewer)
  const [reviewerSaveState, setReviewerSaveState] = useState<SaveState>('idle')
  const [selectedReviewerId, setSelectedReviewerId] = useState<string | null>(null)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(standardReviewWorkflowId)
  const [view, setView] = useState<ReviewSetupView>('workflow')
  const [workflowBaseline, setWorkflowBaseline] = useState<string | null>(null)
  const [workflowDraftValue, setWorkflowDraftValue] =
    useState<SaveReviewWorkflowInput>(emptyWorkflow)
  const [workflowSaveState, setWorkflowSaveState] = useState<SaveState>('idle')

  const configuration = bootstrap.reviewConfiguration
  const profileMap = useMemo(
    () => new Map(configuration.profiles.map((profile) => [profile.id, profile])),
    [configuration.profiles],
  )
  const selectedWorkflow = configuration.workflows.find(
    (workflow) => workflow.id === selectedWorkflowId,
  )
  const editingCustomWorkflow = selectedWorkflowId === 'new' || workflowDraftValue.id !== null
  const workflowDirty = editingCustomWorkflow
    ? workflowBaseline === null
      ? hasWorkflowContent(workflowDraftValue)
      : serialized(workflowDraftValue) !== workflowBaseline
    : false
  const selectedReviewer = selectedReviewerId ? profileMap.get(selectedReviewerId) : undefined
  const editingCustomReviewer = view === 'reviewer' && selectedReviewer?.origin !== 'built-in'
  const reviewerDirty = editingCustomReviewer
    ? reviewerBaseline === null
      ? hasReviewerContent(reviewerDraftValue)
      : serialized(reviewerDraftValue) !== reviewerBaseline
    : false
  const dirty = workflowDirty || reviewerDirty

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  function confirmDiscard(message = 'Discard unsaved changes?'): boolean {
    return !dirty || window.confirm(message)
  }

  function updateWorkflowDraft(changes: Partial<SaveReviewWorkflowInput>): void {
    setWorkflowDraftValue((current) => ({ ...current, ...changes }))
    setWorkflowSaveState('idle')
  }

  function updateReviewerDraft(changes: Partial<SaveReviewerProfileInput>): void {
    setReviewerDraftValue((current) => ({ ...current, ...changes }))
    setReviewerSaveState('idle')
  }

  function loadWorkflow(id: string): void {
    if (!confirmDiscard('Discard the unsaved reviewer or workflow changes?')) {
      return
    }
    setView('workflow')
    setAddReviewerOpen(false)
    setReviewerDraftValue(emptyReviewer)
    setReviewerBaseline(null)
    setSelectedReviewerId(null)
    setReviewerSaveState('idle')
    setSelectedWorkflowId(id)
    const workflow = configuration.workflows.find((candidate) => candidate.id === id)
    if (workflow?.origin === 'custom') {
      const draft = workflowDraft(workflow)
      setWorkflowDraftValue(draft)
      setWorkflowBaseline(serialized(draft))
    } else {
      setWorkflowDraftValue(emptyWorkflow)
      setWorkflowBaseline(null)
    }
    setWorkflowSaveState('idle')
  }

  function startWorkflow(draft: SaveReviewWorkflowInput): void {
    if (!confirmDiscard()) {
      return
    }
    setView('workflow')
    setSelectedWorkflowId('new')
    setWorkflowDraftValue(draft)
    setWorkflowBaseline(null)
    setWorkflowSaveState('idle')
    setAddReviewerOpen(draft.reviewers.length === 0)
  }

  function duplicateSelectedWorkflow(): void {
    if (selectedWorkflowId === standardReviewWorkflowId) {
      startWorkflow({ ...emptyWorkflow, name: 'Standard Review (Custom)' })
      return
    }
    if (selectedWorkflow) {
      startWorkflow({
        id: null,
        name: `${selectedWorkflow.name} (Custom)`,
        reviewers: selectedWorkflow.reviewers,
      })
    }
  }

  function openReviewer(profileId: string, backTarget: 'library' | 'workflow'): void {
    if (reviewerDirty && !window.confirm('Discard unsaved reviewer changes?')) {
      return
    }
    const profile = profileMap.get(profileId)
    if (!profile) {
      return
    }
    setSelectedReviewerId(profile.id)
    setReviewerBackTarget(backTarget)
    setAddCreatedReviewerToWorkflow(false)
    const draft = profileDraft(profile)
    setReviewerDraftValue(draft)
    setReviewerBaseline(serialized(draft))
    setReviewerSaveState('idle')
    setView('reviewer')
  }

  function openPresetPicker(backTarget: 'library' | 'workflow', addToWorkflow: boolean): void {
    if (reviewerDirty && !window.confirm('Discard unsaved reviewer changes?')) {
      return
    }
    setReviewerBackTarget(backTarget)
    setAddCreatedReviewerToWorkflow(addToWorkflow)
    setSelectedReviewerId(null)
    setReviewerDraftValue(emptyReviewer)
    setReviewerBaseline(null)
    setReviewerSaveState('idle')
    setView('preset-picker')
  }

  function startReviewerFromPreset(profile?: ReviewerProfile, customizeCopy = false): void {
    const draft = profile
      ? {
          ...profileDraft(profile),
          id: null,
          name: customizeCopy ? `${profile.name} (Custom)` : profile.name,
        }
      : emptyReviewer
    setSelectedReviewerId(null)
    setReviewerDraftValue(draft)
    setReviewerBaseline(null)
    setReviewerSaveState('idle')
    setView('reviewer')
  }

  function closeReviewer(): void {
    if (reviewerDirty && !window.confirm('Discard unsaved reviewer changes?')) {
      return
    }
    setReviewerDraftValue(emptyReviewer)
    setReviewerBaseline(null)
    setSelectedReviewerId(null)
    setReviewerSaveState('idle')
    setView(reviewerBackTarget === 'workflow' ? 'workflow' : 'reviewer-library')
  }

  function addReviewer(profileId: string): void {
    if (workflowDraftValue.reviewers.some((reviewer) => reviewer.profileId === profileId)) {
      return
    }
    updateWorkflowDraft({
      reviewers: [
        ...workflowDraftValue.reviewers,
        { defaultEnabled: true, profileId, required: false },
      ],
    })
    setAddReviewerOpen(false)
  }

  function updateAssignment(
    profileId: string,
    changes: Partial<{ defaultEnabled: boolean; required: boolean }>,
  ): void {
    updateWorkflowDraft({
      reviewers: workflowDraftValue.reviewers.map((reviewer) =>
        reviewer.profileId === profileId
          ? {
              ...reviewer,
              ...changes,
              defaultEnabled: changes.required
                ? true
                : (changes.defaultEnabled ?? reviewer.defaultEnabled),
            }
          : reviewer,
      ),
    })
  }

  async function saveWorkflow(): Promise<void> {
    const id = workflowDraftValue.id ?? crypto.randomUUID()
    const input = { ...workflowDraftValue, id }
    setWorkflowSaveState('saving')
    if (!(await onSaveWorkflow(input))) {
      setWorkflowSaveState('idle')
      return
    }
    setSelectedWorkflowId(id)
    setWorkflowDraftValue(input)
    setWorkflowBaseline(serialized(input))
    setWorkflowSaveState('saved')
  }

  async function saveReviewer(): Promise<void> {
    const id = reviewerDraftValue.id ?? crypto.randomUUID()
    const input = { ...reviewerDraftValue, id }
    setReviewerSaveState('saving')
    if (!(await onSaveReviewerProfile(input))) {
      setReviewerSaveState('idle')
      return
    }
    if (addCreatedReviewerToWorkflow && editingCustomWorkflow) {
      addReviewer(id)
      setReviewerDraftValue(emptyReviewer)
      setReviewerBaseline(null)
      setSelectedReviewerId(null)
      setReviewerSaveState('idle')
      setView('workflow')
      return
    }
    setSelectedReviewerId(id)
    setReviewerDraftValue(input)
    setReviewerBaseline(serialized(input))
    setReviewerSaveState('saved')
  }

  const activeAssignments = editingCustomWorkflow
    ? workflowDraftValue.reviewers
    : (selectedWorkflow?.reviewers ?? [])
  const graphReviewers: WorkflowGraphReviewer[] = activeAssignments.flatMap((assignment) => {
    const profile = profileMap.get(assignment.profileId)
    if (!profile) {
      return []
    }
    return [
      {
        description: profile.description,
        name: profile.name,
        profileId: profile.id,
        required: assignment.required,
        selected: assignment.required || assignment.defaultEnabled,
        status:
          assignment.required || assignment.defaultEnabled
            ? ('pending' as const)
            : ('not-selected' as const),
        statusLabel: assignment.required
          ? 'Required'
          : assignment.defaultEnabled
            ? 'Default on'
            : 'Default off',
      },
    ]
  })
  const availableProfiles = configuration.profiles.filter(
    (profile) => !workflowDraftValue.reviewers.some((item) => item.profileId === profile.id),
  )
  const usedByWorkflows = selectedReviewerId
    ? configuration.workflows.filter((workflow) =>
        workflow.reviewers.some((reviewer) => reviewer.profileId === selectedReviewerId),
      )
    : []
  const usedByCurrentDraft = Boolean(
    selectedReviewerId &&
      editingCustomWorkflow &&
      workflowDraftValue.reviewers.some((reviewer) => reviewer.profileId === selectedReviewerId),
  )
  const effectiveModelId = reviewerDraftValue.model ?? bootstrap.settings.model
  const effectiveModel = bootstrap.agent.models.find((model) => model.id === effectiveModelId)

  if (view === 'preset-picker') {
    return (
      <Card>
        <CardHeader className="border-b">
          <button
            className="mb-3 flex w-fit items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            onClick={() =>
              setView(reviewerBackTarget === 'workflow' ? 'workflow' : 'reviewer-library')
            }
            type="button"
          >
            <ArrowLeft className="size-3.5" />
            Back to {reviewerBackTarget === 'workflow' ? 'workflow' : 'reviewers'}
          </button>
          <CardTitle>New reviewer</CardTitle>
          <CardDescription>Start with a focused preset or create a blank reviewer.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {builtInReviewerProfiles.map((profile) => (
            <button
              className="rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
              key={profile.id}
              onClick={() => startReviewerFromPreset(profile)}
              type="button"
            >
              <div className="flex items-center gap-2">
                <Bot className="size-4 text-primary" />
                <p className="font-semibold">{profile.name}</p>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{profile.description}</p>
            </button>
          ))}
          <button
            className="rounded-xl border border-dashed p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
            onClick={() => startReviewerFromPreset()}
            type="button"
          >
            <div className="flex items-center gap-2">
              <Plus className="size-4 text-primary" />
              <p className="font-semibold">Start blank</p>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Define a specialist with completely custom instructions.
            </p>
          </button>
        </CardContent>
      </Card>
    )
  }

  if (view === 'reviewer-library') {
    const builtIns = configuration.profiles.filter((profile) => profile.origin === 'built-in')
    const custom = configuration.profiles.filter((profile) => profile.origin === 'custom')
    return (
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <button
                className="mb-3 flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                onClick={() => setView('workflow')}
                type="button"
              >
                <ArrowLeft className="size-3.5" />
                Back to review setup
              </button>
              <CardTitle>Reviewer library</CardTitle>
              <CardDescription className="mt-2">
                Built-in specialists stay available. Custom reviewers can be reused across
                workflows.
              </CardDescription>
            </div>
            <Button onClick={() => openPresetPicker('library', false)} size="sm">
              <Plus />
              New reviewer
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {[
            { items: builtIns, label: 'Built-in reviewers' },
            { items: custom, label: 'Custom reviewers' },
          ].map((group) => (
            <section className="space-y-2" key={group.label}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{group.label}</h3>
                <Badge variant="outline">{group.items.length}</Badge>
              </div>
              {group.items.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                  No custom reviewers yet.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.items.map((profile) => (
                    <button
                      className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
                      key={profile.id}
                      onClick={() => openReviewer(profile.id, 'library')}
                      type="button"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-primary/10 text-primary">
                        <Bot className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{profile.name}</span>
                          {profile.origin === 'built-in' && (
                            <Badge variant="secondary">Built-in</Badge>
                          )}
                        </span>
                        <span className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {profile.description}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </CardContent>
      </Card>
    )
  }

  if (view === 'reviewer') {
    const builtIn = selectedReviewer?.origin === 'built-in'
    if (builtIn && selectedReviewer) {
      return (
        <Card>
          <CardHeader className="border-b">
            <button
              className="mb-3 flex w-fit items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              onClick={closeReviewer}
              type="button"
            >
              <ArrowLeft className="size-3.5" />
              Back to {reviewerBackTarget === 'workflow' ? 'workflow' : 'reviewers'}
            </button>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>{selectedReviewer.name}</CardTitle>
                  <Badge variant="secondary">Built-in</Badge>
                </div>
                <CardDescription className="mt-2">{selectedReviewer.description}</CardDescription>
              </div>
              <Button
                onClick={() => {
                  setAddCreatedReviewerToWorkflow(false)
                  startReviewerFromPreset(selectedReviewer, true)
                }}
                variant="outline"
              >
                <Copy />
                Duplicate and customize
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-xl border bg-muted/15 p-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Instructions
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                {selectedReviewer.instructions}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Built-in reviewers always use the coordinator model settings and cannot be edited or
              deleted.
            </p>
          </CardContent>
        </Card>
      )
    }

    return (
      <Card>
        <CardHeader className="border-b">
          <button
            className="mb-3 flex w-fit items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            onClick={closeReviewer}
            type="button"
          >
            <ArrowLeft className="size-3.5" />
            Back to {reviewerBackTarget === 'workflow' ? 'workflow' : 'reviewers'}
          </button>
          <CardTitle>{reviewerDraftValue.id ? 'Edit reviewer' : 'Create reviewer'}</CardTitle>
          <CardDescription>
            Give this specialist one clear responsibility and focused instructions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reviewer-name">Name</Label>
              <Input
                id="reviewer-name"
                maxLength={80}
                onChange={(event) => updateReviewerDraft({ name: event.target.value })}
                placeholder="Security Reviewer"
                value={reviewerDraftValue.name}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reviewer-description">Description</Label>
              <Input
                id="reviewer-description"
                maxLength={500}
                onChange={(event) => updateReviewerDraft({ description: event.target.value })}
                placeholder="Finds security regressions in changed code."
                value={reviewerDraftValue.description}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reviewer-instructions">Instructions</Label>
            <Textarea
              className="min-h-40 resize-y"
              id="reviewer-instructions"
              maxLength={12_000}
              onChange={(event) => updateReviewerDraft({ instructions: event.target.value })}
              placeholder="Focus this reviewer on one specialist responsibility."
              value={reviewerDraftValue.instructions}
            />
            <p className="text-right text-xs text-muted-foreground">
              {reviewerDraftValue.instructions.length} / 12,000
            </p>
          </div>
          <details className="group rounded-xl border bg-muted/10">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span>
                Advanced model settings
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {reviewerDraftValue.model ? reviewerDraftValue.model : 'Use coordinator settings'}
                </span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
            </summary>
            <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Model</Label>
                <Select
                  value={reviewerDraftValue.model ?? 'inherit'}
                  onValueChange={(value) =>
                    updateReviewerDraft({
                      model: value === 'inherit' ? null : value,
                      reasoningEffort: null,
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Use coordinator model</SelectItem>
                    {bootstrap.agent.models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reasoning effort</Label>
                <Select
                  value={reviewerDraftValue.reasoningEffort ?? 'inherit'}
                  onValueChange={(value) =>
                    updateReviewerDraft({ reasoningEffort: value === 'inherit' ? null : value })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">
                      {reviewerDraftValue.model ? 'Use model default' : 'Use coordinator effort'}
                    </SelectItem>
                    {effectiveModel?.supportedReasoningEfforts.map((effort) => (
                      <SelectItem key={effort.reasoningEffort} value={effort.reasoningEffort}>
                        {effort.reasoningEffort}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </details>
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-card/95 pt-4 backdrop-blur">
            <div className="flex items-center gap-3">
              {reviewerDraftValue.id ? (
                <Button
                  disabled={busy || usedByCurrentDraft || usedByWorkflows.length > 0}
                  onClick={async () => {
                    const id = reviewerDraftValue.id
                    if (
                      id &&
                      window.confirm('Delete this reviewer profile?') &&
                      (await onDeleteReviewerProfile(id))
                    ) {
                      setReviewerDraftValue(emptyReviewer)
                      setReviewerBaseline(null)
                      setSelectedReviewerId(null)
                      setView('reviewer-library')
                    }
                  }}
                  variant="ghost"
                >
                  <Trash2 />
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <SaveIndicator dirty={reviewerDirty} state={reviewerSaveState} />
            </div>
            <Button
              disabled={
                busy ||
                reviewerSaveState === 'saving' ||
                !reviewerDirty ||
                !reviewerDraftValue.name.trim() ||
                !reviewerDraftValue.description.trim() ||
                !reviewerDraftValue.instructions.trim()
              }
              onClick={() => void saveReviewer()}
            >
              {reviewerSaveState === 'saving'
                ? 'Saving…'
                : reviewerDraftValue.id
                  ? 'Save changes'
                  : 'Create reviewer'}
            </Button>
          </div>
          {reviewerDraftValue.id && (usedByCurrentDraft || usedByWorkflows.length > 0) && (
            <p className="text-xs text-muted-foreground">
              {usedByCurrentDraft
                ? 'This reviewer is assigned to the current workflow draft. Remove it there before deleting it.'
                : `Used by ${usedByWorkflows.map((workflow) => workflow.name).join(', ')}. Remove it from those workflows before deleting it.`}
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  const standardSelected = selectedWorkflowId === standardReviewWorkflowId
  const workflowTitle = standardSelected
    ? 'Standard Review'
    : editingCustomWorkflow
      ? workflowDraftValue.name || 'New workflow'
      : (selectedWorkflow?.name ?? 'Review workflow')
  const workflowBuiltIn = standardSelected || selectedWorkflow?.origin === 'built-in'

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle>Review setup</CardTitle>
              <CardDescription className="mt-2">
                Choose a workflow, then configure only the reviewers it uses.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setView('reviewer-library')} size="sm" variant="ghost">
                <Library />
                Manage reviewers
              </Button>
              <Button onClick={() => startWorkflow(emptyWorkflow)} size="sm" variant="outline">
                <Plus />
                New workflow
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <button
              className={`rounded-lg border p-3 text-left ${
                standardSelected ? 'border-primary/50 bg-primary/5' : 'hover:bg-accent/50'
              }`}
              onClick={() => loadWorkflow(standardReviewWorkflowId)}
              type="button"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">Standard Review</p>
                <Badge variant="secondary">Built-in</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Single agent · repository default
              </p>
            </button>
            {configuration.workflows.map((workflow) => (
              <button
                className={`rounded-lg border p-3 text-left ${
                  selectedWorkflowId === workflow.id
                    ? 'border-primary/50 bg-primary/5'
                    : 'hover:bg-accent/50'
                }`}
                key={workflow.id}
                onClick={() => loadWorkflow(workflow.id)}
                type="button"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{workflow.name}</p>
                  {workflow.origin === 'built-in' && <Badge variant="secondary">Built-in</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {workflow.reviewers.length} reviewer{workflow.reviewers.length === 1 ? '' : 's'}
                </p>
              </button>
            ))}
            {selectedWorkflowId === 'new' && (
              <div className="rounded-lg border border-primary/50 bg-primary/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">
                    {workflowDraftValue.name || 'New workflow'}
                  </p>
                  <Badge variant="outline">Draft</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Not saved yet</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{workflowTitle}</CardTitle>
                {workflowBuiltIn && <Badge variant="secondary">Built-in</Badge>}
              </div>
              <CardDescription className="mt-2">
                {standardSelected
                  ? 'Uses the coordinator directly without specialist reviewers.'
                  : workflowBuiltIn
                    ? 'A ready-to-use workflow that stays available in every Revy installation.'
                    : 'A reusable custom workflow. Changes apply after you save them.'}
              </CardDescription>
            </div>
            {workflowBuiltIn && (
              <Button onClick={duplicateSelectedWorkflow} variant="outline">
                <Copy />
                Duplicate and customize
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {editingCustomWorkflow && (
            <div className="space-y-2">
              <Label htmlFor="workflow-name">Workflow name</Label>
              <Input
                id="workflow-name"
                maxLength={80}
                onChange={(event) => updateWorkflowDraft({ name: event.target.value })}
                placeholder="Focused review"
                value={workflowDraftValue.name}
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Workflow preview</Label>
              <p className="text-xs text-muted-foreground">
                Select a reviewer node to view its settings.
              </p>
            </div>
            <WorkflowGraph
              consolidationStatus="pending"
              consolidationStatusLabel={standardSelected ? 'Single agent' : 'Fixed step'}
              onReviewerClick={(profileId) => openReviewer(profileId, 'workflow')}
              reviewers={graphReviewers}
              standardReview={standardSelected}
            />
          </div>

          {!standardSelected && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Reviewers in this workflow</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Required reviewers must succeed. Optional reviewers can be changed before each
                    run.
                  </p>
                </div>
                {editingCustomWorkflow && (
                  <Button
                    onClick={() => setAddReviewerOpen((current) => !current)}
                    size="sm"
                    variant="outline"
                  >
                    <Plus />
                    Add reviewer
                  </Button>
                )}
              </div>

              {addReviewerOpen && editingCustomWorkflow && (
                <div className="rounded-xl border bg-muted/10 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Add an existing reviewer</p>
                    <Button
                      onClick={() => openPresetPicker('workflow', true)}
                      size="sm"
                      variant="ghost"
                    >
                      <Plus />
                      Create custom reviewer
                    </Button>
                  </div>
                  {availableProfiles.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Every available reviewer is already in this workflow.
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {availableProfiles.map((profile) => (
                        <button
                          className="flex items-center gap-3 rounded-lg border bg-background/40 p-3 text-left hover:bg-accent/50"
                          key={profile.id}
                          onClick={() => addReviewer(profile.id)}
                          type="button"
                        >
                          <Bot className="size-4 shrink-0 text-primary" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {profile.name}
                            </span>
                            <span className="mt-1 block truncate text-xs text-muted-foreground">
                              {profile.origin === 'built-in'
                                ? 'Built-in preset'
                                : 'Custom reviewer'}
                            </span>
                          </span>
                          <Plus className="size-4 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeAssignments.length === 0 ? (
                <button
                  className="w-full rounded-xl border border-dashed p-7 text-center hover:border-primary/40 hover:bg-primary/5"
                  onClick={() => setAddReviewerOpen(true)}
                  type="button"
                >
                  <Bot className="mx-auto size-5 text-primary" />
                  <p className="mt-2 text-sm font-medium">Add the first reviewer</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Choose a built-in preset or create a custom specialist.
                  </p>
                </button>
              ) : (
                <div className="space-y-2">
                  {activeAssignments.map((assignment) => {
                    const profile = profileMap.get(assignment.profileId)
                    if (!profile) {
                      return null
                    }
                    return (
                      <div
                        className="grid items-center gap-3 rounded-lg border bg-background/40 p-3 md:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]"
                        key={profile.id}
                      >
                        <button
                          className="min-w-0 text-left"
                          onClick={() => openReviewer(profile.id, 'workflow')}
                          type="button"
                        >
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{profile.name}</span>
                            {profile.origin === 'built-in' && (
                              <Badge variant="secondary">Preset</Badge>
                            )}
                          </span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {profile.description}
                          </span>
                        </button>
                        {editingCustomWorkflow ? (
                          <Select
                            value={assignment.required ? 'required' : 'optional'}
                            onValueChange={(value) =>
                              updateAssignment(profile.id, { required: value === 'required' })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="optional">Optional</SelectItem>
                              <SelectItem value="required">Required</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge className="w-fit" variant="outline">
                            {assignment.required ? 'Required' : 'Optional'}
                          </Badge>
                        )}
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span>On by default</span>
                          {editingCustomWorkflow ? (
                            <Switch
                              checked={assignment.defaultEnabled}
                              disabled={assignment.required}
                              onCheckedChange={(defaultEnabled) =>
                                updateAssignment(profile.id, { defaultEnabled })
                              }
                            />
                          ) : (
                            <Badge variant="outline">
                              {assignment.defaultEnabled ? 'On' : 'Off'}
                            </Badge>
                          )}
                        </div>
                        {editingCustomWorkflow ? (
                          <Button
                            aria-label={`Remove ${profile.name}`}
                            onClick={() =>
                              updateWorkflowDraft({
                                reviewers: workflowDraftValue.reviewers.filter(
                                  (reviewer) => reviewer.profileId !== profile.id,
                                ),
                              })
                            }
                            size="icon-sm"
                            variant="ghost"
                          >
                            <Trash2 />
                          </Button>
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {editingCustomWorkflow && (
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-card/95 pt-4 backdrop-blur">
              <div className="flex items-center gap-3">
                {workflowDraftValue.id ? (
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      const id = workflowDraftValue.id
                      if (
                        id &&
                        window.confirm('Delete this review workflow?') &&
                        (await onDeleteWorkflow(id))
                      ) {
                        setSelectedWorkflowId(standardReviewWorkflowId)
                        setWorkflowDraftValue(emptyWorkflow)
                        setWorkflowBaseline(null)
                        setWorkflowSaveState('idle')
                        setAddReviewerOpen(false)
                      }
                    }}
                    variant="ghost"
                  >
                    <Trash2 />
                    Delete
                  </Button>
                ) : (
                  <span />
                )}
                <SaveIndicator dirty={workflowDirty} state={workflowSaveState} />
              </div>
              <Button
                disabled={
                  busy ||
                  workflowSaveState === 'saving' ||
                  !workflowDirty ||
                  !workflowDraftValue.name.trim() ||
                  workflowDraftValue.reviewers.length === 0
                }
                onClick={() => void saveWorkflow()}
              >
                {workflowSaveState === 'saving'
                  ? 'Saving…'
                  : workflowDraftValue.id
                    ? 'Save changes'
                    : 'Create workflow'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
