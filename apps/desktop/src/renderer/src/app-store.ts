import { create } from 'zustand'
import type {
  AgentActivityEntry,
  BootstrapState,
  RepositorySnapshot,
  ReviewDocument,
  ReviewProgress,
  ReviewRun,
  ReviewRunSummary,
  ReviewRunUpdate,
  ReviewSummary,
  SourcePreview,
} from '../../shared/contracts.js'
import type { ReviewStepInspectorTab } from './ReviewStepInspector'

export type Surface = 'activity' | 'repository' | 'reviews'

export interface StepInspectorSelection {
  highlightedActivityId: string | null
  preferredTab?: ReviewStepInspectorTab | undefined
  run: ReviewRun
  stepId: string
}

type StateUpdater<T> = T | ((current: T) => T)

interface AppStoreState {
  activity: ReviewRun | null
  bootstrap: BootstrapState | null
  busy: boolean
  enabledOptionalReviewerIds: string[]
  error: string | null
  liveActivity: ReviewRun | null
  progress: ReviewProgress | null
  repository: RepositorySnapshot | null
  review: ReviewDocument | null
  reviewRun: ReviewRun | null
  reviewStarting: boolean
  reviews: ReviewSummary[]
  runs: ReviewRunSummary[]
  settingsDirty: boolean
  settingsOpen: boolean
  source: SourcePreview | null
  stepInspector: StepInspectorSelection | null
  surface: Surface
  userStory: string
}

interface AppStoreActions {
  acceptRepository: (repository: RepositorySnapshot) => void
  applyActivityUpdate: (update: ReviewRunUpdate) => void
  applyReviewConfiguration: (
    reviewConfiguration: BootstrapState['reviewConfiguration'],
    removedWorkflowId?: string,
  ) => void
  beginReview: () => void
  completeReview: (
    review: ReviewDocument,
    reviewRun: ReviewRun,
    repository: RepositorySnapshot,
  ) => void
  failReview: (message: string) => void
  openReview: (review: ReviewDocument, reviewRun: ReviewRun) => void
  setActivity: (value: StateUpdater<ReviewRun | null>) => void
  setBootstrap: (value: StateUpdater<BootstrapState | null>) => void
  setBusy: (value: StateUpdater<boolean>) => void
  setError: (value: StateUpdater<string | null>) => void
  setProgress: (value: StateUpdater<ReviewProgress | null>) => void
  setRepository: (value: StateUpdater<RepositorySnapshot | null>) => void
  setReview: (value: StateUpdater<ReviewDocument | null>) => void
  setReviewRun: (value: StateUpdater<ReviewRun | null>) => void
  setReviewStarting: (value: StateUpdater<boolean>) => void
  setReviews: (value: StateUpdater<ReviewSummary[]>) => void
  setRuns: (value: StateUpdater<ReviewRunSummary[]>) => void
  setSettingsDirty: (value: StateUpdater<boolean>) => void
  setSettingsOpen: (value: StateUpdater<boolean>) => void
  setSource: (value: StateUpdater<SourcePreview | null>) => void
  setStepInspector: (value: StateUpdater<StepInspectorSelection | null>) => void
  setSurface: (value: StateUpdater<Surface>) => void
  setUserStory: (value: StateUpdater<string>) => void
  syncOptionalReviewerDefaults: () => void
  toggleOptionalReviewer: (profileId: string, enabled: boolean) => void
}

interface AppStore extends AppStoreState {
  actions: AppStoreActions
}

const initialState: AppStoreState = {
  activity: null,
  bootstrap: null,
  busy: false,
  enabledOptionalReviewerIds: [],
  error: null,
  liveActivity: null,
  progress: null,
  repository: null,
  review: null,
  reviewRun: null,
  reviewStarting: false,
  reviews: [],
  runs: [],
  settingsDirty: false,
  settingsOpen: false,
  source: null,
  stepInspector: null,
  surface: 'repository',
  userStory: '',
}

function resolveUpdater<T>(value: StateUpdater<T>, current: T): T {
  return typeof value === 'function' ? (value as (current: T) => T)(current) : value
}

function mergeActivityEntry(
  activity: ReviewRun['activity'],
  entry: AgentActivityEntry,
): ReviewRun['activity'] {
  const next = activity.filter((candidate) => candidate.id !== entry.id)
  next.push(entry)
  return next.sort((left, right) => left.sequence - right.sequence)
}

function mergeRunUpdate(current: ReviewRun, update: ReviewRunUpdate): ReviewRun {
  return {
    activity: update.entry ? mergeActivityEntry(current.activity, update.entry) : current.activity,
    metadata: update.run,
    steps: update.step
      ? [...current.steps.filter((step) => step.id !== update.step?.id), update.step]
      : current.steps,
  }
}

export const useAppStore = create<AppStore>()((set, get) => ({
  ...initialState,
  actions: {
    acceptRepository: (repository) =>
      set((state) => ({
        activity: null,
        liveActivity: null,
        repository,
        review: null,
        reviewRun: null,
        runs: [],
        source: null,
        stepInspector: null,
        userStory: state.repository?.root === repository.root ? state.userStory : '',
      })),
    applyActivityUpdate: (update) =>
      set((state) => {
        if (state.repository?.root !== update.run.repositoryRoot) {
          return state
        }
        return {
          activity:
            state.activity?.metadata.id === update.run.id
              ? mergeRunUpdate(state.activity, update)
              : state.activity,
          liveActivity:
            state.liveActivity?.metadata.id === update.run.id
              ? mergeRunUpdate(state.liveActivity, update)
              : {
                  activity: update.entry ? [update.entry] : [],
                  metadata: update.run,
                  steps: update.step ? [update.step] : [],
                },
          reviewRun:
            state.reviewRun?.metadata.id === update.run.id
              ? mergeRunUpdate(state.reviewRun, update)
              : state.reviewRun,
          runs: [...state.runs.filter((run) => run.id !== update.run.id), update.run].sort(
            (left, right) => right.startedAt.localeCompare(left.startedAt),
          ),
          stepInspector:
            state.stepInspector?.run.metadata.id === update.run.id
              ? {
                  ...state.stepInspector,
                  run: mergeRunUpdate(state.stepInspector.run, update),
                }
              : state.stepInspector,
        }
      }),
    applyReviewConfiguration: (reviewConfiguration, removedWorkflowId) =>
      set((state) => ({
        bootstrap: state.bootstrap ? { ...state.bootstrap, reviewConfiguration } : state.bootstrap,
        repository:
          removedWorkflowId && state.repository?.preferences.workflowId === removedWorkflowId
            ? {
                ...state.repository,
                preferences: { ...state.repository.preferences, workflowId: null },
              }
            : state.repository,
      })),
    beginReview: () =>
      set({
        error: null,
        progress: {
          error: null,
          message: 'Starting the review…',
          reviewId: null,
          state: 'preparing',
        },
        review: null,
        reviewRun: null,
        reviewStarting: true,
        source: null,
        stepInspector: null,
        surface: 'reviews',
      }),
    completeReview: (review, reviewRun, repository) =>
      set({ repository, review, reviewRun, userStory: '' }),
    failReview: (message) =>
      set((state) => ({
        error: /cancel/i.test(message) ? state.error : message,
        progress:
          state.progress?.state === 'cancelled' || state.progress?.state === 'failed'
            ? state.progress
            : state.progress?.reviewId
              ? { ...state.progress, error: message, message, state: 'failed' }
              : null,
      })),
    openReview: (review, reviewRun) =>
      set({ review, reviewRun, source: null, stepInspector: null }),
    setActivity: (value) => set((state) => ({ activity: resolveUpdater(value, state.activity) })),
    setBootstrap: (value) =>
      set((state) => ({ bootstrap: resolveUpdater(value, state.bootstrap) })),
    setBusy: (value) => set((state) => ({ busy: resolveUpdater(value, state.busy) })),
    setError: (value) => set((state) => ({ error: resolveUpdater(value, state.error) })),
    setProgress: (value) => set((state) => ({ progress: resolveUpdater(value, state.progress) })),
    setRepository: (value) =>
      set((state) => ({ repository: resolveUpdater(value, state.repository) })),
    setReview: (value) => set((state) => ({ review: resolveUpdater(value, state.review) })),
    setReviewRun: (value) =>
      set((state) => ({ reviewRun: resolveUpdater(value, state.reviewRun) })),
    setReviewStarting: (value) =>
      set((state) => ({ reviewStarting: resolveUpdater(value, state.reviewStarting) })),
    setReviews: (value) => set((state) => ({ reviews: resolveUpdater(value, state.reviews) })),
    setRuns: (value) => set((state) => ({ runs: resolveUpdater(value, state.runs) })),
    setSettingsDirty: (value) =>
      set((state) => ({ settingsDirty: resolveUpdater(value, state.settingsDirty) })),
    setSettingsOpen: (value) =>
      set((state) => ({ settingsOpen: resolveUpdater(value, state.settingsOpen) })),
    setSource: (value) => set((state) => ({ source: resolveUpdater(value, state.source) })),
    setStepInspector: (value) =>
      set((state) => ({ stepInspector: resolveUpdater(value, state.stepInspector) })),
    setSurface: (value) => set((state) => ({ surface: resolveUpdater(value, state.surface) })),
    setUserStory: (value) =>
      set((state) => ({ userStory: resolveUpdater(value, state.userStory) })),
    syncOptionalReviewerDefaults: () => {
      const { bootstrap, repository } = get()
      const workflow = bootstrap?.reviewConfiguration.workflows.find(
        (candidate) => candidate.id === repository?.preferences.workflowId,
      )
      set({
        enabledOptionalReviewerIds:
          workflow?.reviewers
            .filter((reviewer) => !reviewer.required && reviewer.defaultEnabled)
            .map((reviewer) => reviewer.profileId) ?? [],
      })
    },
    toggleOptionalReviewer: (profileId, enabled) =>
      set((state) => ({
        enabledOptionalReviewerIds: enabled
          ? [...new Set([...state.enabledOptionalReviewerIds, profileId])]
          : state.enabledOptionalReviewerIds.filter((candidate) => candidate !== profileId),
      })),
  },
}))
