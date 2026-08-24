import { contextBridge, ipcRenderer } from 'electron'
import { ipcChannels, reviewProgressSchema, type ShippyApi } from '../shared/contracts.js'

const api: ShippyApi = {
  cancelReview: () => ipcRenderer.invoke(ipcChannels.reviewCancel),
  chooseCodexExecutable: () => ipcRenderer.invoke(ipcChannels.agentChooseExecutable),
  deleteReview: (reviewId) => ipcRenderer.invoke(ipcChannels.reviewDelete, reviewId),
  getBootstrap: () => ipcRenderer.invoke(ipcChannels.appBootstrap),
  listReviews: () => ipcRenderer.invoke(ipcChannels.reviewList),
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
  openRecentRepository: (path) => ipcRenderer.invoke(ipcChannels.repositoryOpenRecent, path),
  readReview: (reviewId) => ipcRenderer.invoke(ipcChannels.reviewRead, reviewId),
  readSource: (input) => ipcRenderer.invoke(ipcChannels.reviewReadSource, input),
  refreshAgent: () => ipcRenderer.invoke(ipcChannels.agentRefresh),
  refreshRepository: (baseBranch) => ipcRenderer.invoke(ipcChannels.repositoryRefresh, baseBranch),
  selectInstructionFile: () => ipcRenderer.invoke(ipcChannels.repositorySelectInstructions),
  selectRepository: () => ipcRenderer.invoke(ipcChannels.repositorySelect),
  startReview: (input) => ipcRenderer.invoke(ipcChannels.reviewStart, input),
  updateRepositoryPreferences: (input) =>
    ipcRenderer.invoke(ipcChannels.repositoryUpdatePreferences, input),
  updateSettings: (input) => ipcRenderer.invoke(ipcChannels.settingsUpdate, input),
}

contextBridge.exposeInMainWorld('shippy', api)
