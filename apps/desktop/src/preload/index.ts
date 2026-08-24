import { contextBridge, ipcRenderer } from 'electron'
import {
  ipcChannels,
  type RevyApi,
  reviewProgressSchema,
  reviewRunUpdateSchema,
} from '../shared/contracts.js'

const api: RevyApi = {
  cancelReview: () => ipcRenderer.invoke(ipcChannels.reviewCancel),
  chooseCodexExecutable: () => ipcRenderer.invoke(ipcChannels.agentChooseExecutable),
  copyText: (text) => ipcRenderer.invoke(ipcChannels.clipboardWrite, text),
  deleteActivity: (runId) => ipcRenderer.invoke(ipcChannels.activityDelete, runId),
  deleteReview: (reviewId) => ipcRenderer.invoke(ipcChannels.reviewDelete, reviewId),
  getBootstrap: () => ipcRenderer.invoke(ipcChannels.appBootstrap),
  listActivity: () => ipcRenderer.invoke(ipcChannels.activityList),
  listReviews: () => ipcRenderer.invoke(ipcChannels.reviewList),
  onActivityUpdate: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const update = reviewRunUpdateSchema.safeParse(value)
      if (update.success) {
        listener(update.data)
      }
    }
    ipcRenderer.on(ipcChannels.activityUpdated, handler)
    return () => ipcRenderer.removeListener(ipcChannels.activityUpdated, handler)
  },
  onReviewProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const progress = reviewProgressSchema.safeParse(value)
      if (progress.success) {
        listener(progress.data)
      }
    }
    ipcRenderer.on(ipcChannels.reviewProgress, handler)
    return () => ipcRenderer.removeListener(ipcChannels.reviewProgress, handler)
  },
  openExternal: (url) => ipcRenderer.invoke(ipcChannels.externalOpen, url),
  openLogFolder: () => ipcRenderer.invoke(ipcChannels.diagnosticsOpenLogFolder),
  openRecentRepository: (path) => ipcRenderer.invoke(ipcChannels.repositoryOpenRecent, path),
  readActivity: (runId) => ipcRenderer.invoke(ipcChannels.activityRead, runId),
  readReview: (reviewId) => ipcRenderer.invoke(ipcChannels.reviewRead, reviewId),
  readSource: (input) => ipcRenderer.invoke(ipcChannels.reviewReadSource, input),
  refreshAgent: () => ipcRenderer.invoke(ipcChannels.agentRefresh),
  refreshRepository: (baseBranch) => ipcRenderer.invoke(ipcChannels.repositoryRefresh, baseBranch),
  reportRendererError: (input) => ipcRenderer.send(ipcChannels.diagnosticsRendererError, input),
  selectInstructionFile: () => ipcRenderer.invoke(ipcChannels.repositorySelectInstructions),
  selectRepository: () => ipcRenderer.invoke(ipcChannels.repositorySelect),
  startReview: (input) => ipcRenderer.invoke(ipcChannels.reviewStart, input),
  updateRepositoryPreferences: (input) =>
    ipcRenderer.invoke(ipcChannels.repositoryUpdatePreferences, input),
  updateSettings: (input) => ipcRenderer.invoke(ipcChannels.settingsUpdate, input),
}

contextBridge.exposeInMainWorld('revy', api)
