import { useEffect } from 'react'
import type {
  BootstrapState,
  Result,
  ReviewDocument,
  ReviewRun,
  SaveReviewerProfileInput,
  SaveReviewWorkflowInput,
} from '../../shared/contracts.js'
import { type ReviewStepInspectorTab, type Surface, useAppStore } from './app-store'
import type { CodeReference } from './MarkdownReview'

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

function reviewRunning(): boolean {
  const { progress, reviewStarting } = useAppStore.getState()
  return (
    reviewStarting ||
    Boolean(progress && ['preparing', 'running', 'saving'].includes(progress.state))
  )
}

async function runOperation(operation: () => Promise<void>): Promise<void> {
  const { setBusy, setError } = useAppStore.getState().actions
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
  const { openReview: presentReview, setReviews } = useAppStore.getState().actions
  const nextReviews = unwrapResult(await window.revy.listReviews())
  setReviews(nextReviews)
  if (openLatest && nextReviews[0]) {
    const document = unwrapResult(await window.revy.readReview(nextReviews[0].id))
    presentReview(document, await readRunForReview(document))
  }
}

async function refreshActivity(openLatest = false): Promise<void> {
  const { setActivity, setRuns } = useAppStore.getState().actions
  const nextRuns = unwrapResult(await window.revy.listActivity())
  setRuns(nextRuns)
  if (openLatest && nextRuns[0]) {
    setActivity(unwrapResult(await window.revy.readActivity(nextRuns[0].id)))
  }
}

async function openRepository(): Promise<void> {
  await runOperation(async () => {
    const { acceptRepository, setBootstrap, setSurface } = useAppStore.getState().actions
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
  await runOperation(async () => {
    const { acceptRepository, setSurface } = useAppStore.getState().actions
    acceptRepository(unwrapResult(await window.revy.openRecentRepository(path)))
    await Promise.all([refreshHistory(), refreshActivity()])
    setSurface('repository')
  })
}

async function refreshRepository(): Promise<void> {
  await runOperation(async () => {
    useAppStore
      .getState()
      .actions.acceptRepository(unwrapResult(await window.revy.refreshRepository()))
    await Promise.all([refreshHistory(), refreshActivity()])
  })
}

async function updateBase(baseBranch: string): Promise<void> {
  await runOperation(async () => {
    useAppStore
      .getState()
      .actions.setRepository(unwrapResult(await window.revy.refreshRepository(baseBranch)))
    await Promise.all([refreshHistory(), refreshActivity()])
  })
}

async function updateInstructions(instructionFile: string | null): Promise<void> {
  await runOperation(async () => {
    useAppStore
      .getState()
      .actions.setRepository(
        unwrapResult(await window.revy.updateRepositoryPreferences({ instructionFile })),
      )
  })
}

async function updateWorkflow(workflowId: string | null): Promise<void> {
  await runOperation(async () => {
    useAppStore
      .getState()
      .actions.setRepository(
        unwrapResult(await window.revy.updateRepositoryPreferences({ workflowId })),
      )
  })
}

async function chooseInstructions(): Promise<void> {
  await runOperation(async () => {
    useAppStore
      .getState()
      .actions.setRepository(unwrapResult(await window.revy.selectInstructionFile()))
  })
}

async function startReview(): Promise<void> {
  const { enabledOptionalReviewerIds, repository, userStory } = useAppStore.getState()
  if (!repository?.baseBranch) {
    return
  }
  const { beginReview, completeReview, failReview, setReviewStarting } =
    useAppStore.getState().actions
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
    failReview(caught instanceof Error ? caught.message : 'The review failed.')
  } finally {
    setReviewStarting(false)
  }
}

async function cancelReview(): Promise<void> {
  if (!useAppStore.getState().progress?.reviewId) {
    return
  }
  await runOperation(async () => {
    unwrapResult(await window.revy.cancelReview())
  })
}

async function openReview(id: string): Promise<void> {
  await runOperation(async () => {
    const document = unwrapResult(await window.revy.readReview(id))
    useAppStore.getState().actions.openReview(document, await readRunForReview(document))
  })
}

async function deleteReview(id: string): Promise<void> {
  if (!window.confirm('Delete this review and its activity permanently?')) {
    return
  }
  await runOperation(async () => {
    const {
      setActivity,
      setReview,
      setReviewRun,
      setReviews,
      setRuns,
      setSource,
      setStepInspector,
    } = useAppStore.getState().actions
    setReviews(unwrapResult(await window.revy.deleteReview(id)))
    setRuns(unwrapResult(await window.revy.listActivity()))
    setActivity((current) => (current?.metadata.id === id ? null : current))
    setReview(null)
    setReviewRun(null)
    setSource(null)
    setStepInspector(null)
  })
}

async function openActivity(id: string): Promise<void> {
  await runOperation(async () => {
    const { setActivity, setStepInspector } = useAppStore.getState().actions
    setActivity(unwrapResult(await window.revy.readActivity(id)))
    setStepInspector(null)
  })
}

async function deleteActivity(id: string): Promise<void> {
  if (!window.confirm('Delete this run and its review, if one exists?')) {
    return
  }
  await runOperation(async () => {
    const { setActivity, setRuns, setStepInspector } = useAppStore.getState().actions
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
  useAppStore.getState().actions.setStepInspector({
    highlightedActivityId: activityId ?? null,
    preferredTab,
    run,
    stepId,
  })
}

async function openReviewFromActivity(id: string): Promise<void> {
  await openReview(id)
  useAppStore.getState().actions.setSurface('reviews')
}

async function openSource(reference: CodeReference): Promise<void> {
  const review = useAppStore.getState().review
  if (!review) {
    return
  }
  await runOperation(async () => {
    useAppStore.getState().actions.setSource(
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
  const { setError } = useAppStore.getState().actions
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
  const { setError } = useAppStore.getState().actions
  setError(null)
  try {
    unwrapResult(await window.revy.openExternal(url))
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : 'The external link could not be opened.')
  }
}

async function refreshAgent(): Promise<void> {
  await runOperation(async () => {
    unwrapResult(await window.revy.refreshAgent())
    useAppStore.getState().actions.setBootstrap(unwrapResult(await window.revy.updateSettings({})))
  })
}

async function chooseExecutable(): Promise<void> {
  await runOperation(async () => {
    unwrapResult(await window.revy.chooseCodexExecutable())
    useAppStore.getState().actions.setBootstrap(unwrapResult(await window.revy.updateSettings({})))
  })
}

async function updateSettings(
  input: Parameters<typeof window.revy.updateSettings>[0],
): Promise<void> {
  await runOperation(async () => {
    useAppStore
      .getState()
      .actions.setBootstrap(unwrapResult(await window.revy.updateSettings(input)))
  })
}

async function saveReviewerProfile(input: SaveReviewerProfileInput): Promise<boolean> {
  const { applyReviewConfiguration, setBusy, setError } = useAppStore.getState().actions
  setBusy(true)
  setError(null)
  try {
    applyReviewConfiguration(unwrapResult(await window.revy.saveReviewerProfile(input)))
    return true
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : 'The reviewer could not be saved.')
    return false
  } finally {
    setBusy(false)
  }
}

async function deleteReviewerProfile(profileId: string): Promise<boolean> {
  const { applyReviewConfiguration, setBusy, setError } = useAppStore.getState().actions
  setBusy(true)
  setError(null)
  try {
    applyReviewConfiguration(unwrapResult(await window.revy.deleteReviewerProfile(profileId)))
    return true
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : 'The reviewer could not be deleted.')
    return false
  } finally {
    setBusy(false)
  }
}

async function saveWorkflow(input: SaveReviewWorkflowInput): Promise<boolean> {
  const { applyReviewConfiguration, setBusy, setError } = useAppStore.getState().actions
  setBusy(true)
  setError(null)
  try {
    applyReviewConfiguration(unwrapResult(await window.revy.saveWorkflow(input)))
    return true
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : 'The workflow could not be saved.')
    return false
  } finally {
    setBusy(false)
  }
}

async function deleteWorkflow(workflowId: string): Promise<boolean> {
  const { applyReviewConfiguration, setBusy, setError } = useAppStore.getState().actions
  setBusy(true)
  setError(null)
  try {
    applyReviewConfiguration(unwrapResult(await window.revy.deleteWorkflow(workflowId)), workflowId)
    return true
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : 'The workflow could not be deleted.')
    return false
  } finally {
    setBusy(false)
  }
}

async function openLogFolder(): Promise<void> {
  await runOperation(async () => {
    unwrapResult(await window.revy.openLogFolder())
  })
}

function openLiveActivity(): void {
  const { activity, progress, runs } = useAppStore.getState()
  const { setStepInspector, setSurface } = useAppStore.getState().actions
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
  const { settingsDirty } = useAppStore.getState()
  const { setSettingsDirty, setSettingsOpen } = useAppStore.getState().actions
  if (!open && settingsDirty && !window.confirm('Discard unsaved settings changes?')) {
    return
  }
  setSettingsOpen(open)
  if (!open) {
    setSettingsDirty(false)
  }
}

function selectSurface(next: Surface): void {
  const { activity, review, reviews, runs } = useAppStore.getState()
  const { setStepInspector, setSurface } = useAppStore.getState().actions
  setStepInspector(null)
  setSurface(next)
  if (
    next === 'reviews' &&
    !reviewRunning() &&
    reviews[0] &&
    review?.metadata.id !== reviews[0].id
  ) {
    void openReview(reviews[0].id)
  }
  if (next === 'activity' && !activity && runs[0]) {
    void openActivity(runs[0].id)
  }
}

const navigationCommands = {
  cancelReview,
  openLiveActivity,
  openRecent,
  openRepository,
  selectSurface,
  setSettingsVisibility,
}

const repositoryCommands = {
  chooseInstructions,
  inspectReviewStep,
  openRepository,
  refreshRepository,
  startReview,
  updateBase,
  updateInstructions,
  updateWorkflow,
}

const reviewCommands = {
  cancelReview,
  copyText,
  deleteReview,
  inspectReviewStep,
  openExternal,
  openReview,
  openSource,
}

const activityCommands = {
  deleteActivity,
  inspectReviewStep,
  openActivity,
  openReviewFromActivity,
}

const settingsCommands = {
  chooseExecutable,
  deleteReviewerProfile,
  deleteWorkflow,
  openLogFolder,
  refreshAgent,
  saveReviewerProfile,
  saveWorkflow,
  updateSettings,
}

export function useNavigationCommands() {
  return navigationCommands
}

export function useRepositoryCommands() {
  return repositoryCommands
}

export function useReviewCommands() {
  return reviewCommands
}

export function useActivityCommands() {
  return activityCommands
}

export function useSettingsCommands() {
  return settingsCommands
}

export function useReviewRunning(): boolean {
  const progressState = useAppStore((state) => state.progress?.state)
  const reviewStarting = useAppStore((state) => state.reviewStarting)
  return (
    reviewStarting ||
    Boolean(progressState && ['preparing', 'running', 'saving'].includes(progressState))
  )
}

export function useRequiredBootstrap(): BootstrapState {
  const bootstrap = useAppStore((state) => state.bootstrap)
  if (!bootstrap) {
    throw new Error('The Revy bootstrap state is not available.')
  }
  return bootstrap
}

export function useAppLifecycle(): void {
  const actions = useAppStore((state) => state.actions)
  const repositoryRoot = useAppStore((state) => state.repository?.root)
  const repositoryWorkflowId = useAppStore((state) => state.repository?.preferences.workflowId)
  const workflowDefaultsKey = useAppStore(
    (state) =>
      state.bootstrap?.reviewConfiguration.workflows
        .map(
          (workflow) =>
            `${workflow.id}:${workflow.reviewers
              .map(
                (reviewer) =>
                  `${reviewer.profileId}:${reviewer.required}:${reviewer.defaultEnabled}`,
              )
              .join(',')}`,
        )
        .join('|') ?? '',
  )

  useEffect(() => {
    const unsubscribe = window.revy.onReviewProgress(actions.setProgress)
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
        actions.setBootstrap(unwrapResult(await window.revy.getBootstrap()))
      } catch (caught) {
        actions.setError(caught instanceof Error ? caught.message : 'Revy could not start.')
      }
    })()
    return () => {
      unsubscribe()
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [actions])

  useEffect(() => {
    function openSettingsWithShortcut(event: KeyboardEvent): void {
      if (
        event.code === 'Comma' &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault()
        actions.setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', openSettingsWithShortcut)
    return () => window.removeEventListener('keydown', openSettingsWithShortcut)
  }, [actions])

  useEffect(() => {
    if (!repositoryRoot) {
      return undefined
    }
    return window.revy.onActivityUpdate(actions.applyActivityUpdate)
  }, [actions, repositoryRoot])

  useEffect(() => {
    actions.syncOptionalReviewerDefaults()
  }, [actions, repositoryRoot, repositoryWorkflowId, workflowDefaultsKey])
}
