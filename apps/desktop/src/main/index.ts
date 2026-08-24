import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  type OpenDialogOptions,
  shell,
} from 'electron'
import { z } from 'zod'
import {
  clipboardTextSchema,
  externalUrlSchema,
  ipcChannels,
  optionalBaseBranchInputSchema,
  type Result,
  readSourceInputSchema,
  recentRepositoryInputSchema,
  rendererDiagnosticInputSchema,
  reviewIdSchema,
  reviewProgressSchema,
  reviewRunUpdateSchema,
  startReviewInputSchema,
  updateRepositoryPreferencesInputSchema,
  updateSettingsInputSchema,
} from '../shared/contracts.js'
import { ShippyService } from './app-service.js'
import { createLogger, initializeLogging, logError } from './logger.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const authorName = 'Phillipp Bertram'
const repositoryUrl = 'https://github.com/phillippbertram/shippy'
const logger = createLogger('main')
let mainWindow: BrowserWindow | null = null
let service: ShippyService | null = null

function messageFromError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return `Invalid request: ${error.issues.at(0)?.message ?? 'validation failed'}`
  }
  return error instanceof Error ? error.message : 'Shippy could not complete the request.'
}

async function result<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    logError('ipc', 'IPC operation failed', error)
    return { error: messageFromError(error), ok: false }
  }
}

function requireService(): ShippyService {
  if (!service) {
    throw new Error('Shippy is still starting.')
  }
  return service
}

function showOpenDialog(options: OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options)
}

function registerIpc(): void {
  ipcMain.handle(ipcChannels.activityList, () => result(() => requireService().listActivity()))
  ipcMain.handle(ipcChannels.activityRead, (_event, input: unknown) =>
    result(() => requireService().readActivity(reviewIdSchema.parse(input))),
  )
  ipcMain.handle(ipcChannels.activityDelete, (_event, input: unknown) =>
    result(() => requireService().deleteActivity(reviewIdSchema.parse(input))),
  )
  ipcMain.handle(ipcChannels.appBootstrap, () => result(() => requireService().getBootstrap()))
  ipcMain.handle(ipcChannels.agentRefresh, () => result(() => requireService().refreshAgent()))
  ipcMain.handle(ipcChannels.agentChooseExecutable, () =>
    result(async () => {
      const selection = await showOpenDialog({
        buttonLabel: 'Choose Codex',
        properties: ['openFile'],
        title: 'Choose the Codex executable',
      })
      const executable = selection.filePaths[0]
      if (selection.canceled || !executable) {
        return requireService().refreshAgent()
      }
      return requireService().setCodexExecutable(executable)
    }),
  )
  ipcMain.handle(ipcChannels.clipboardWrite, (_event, input: unknown) =>
    result(async () => {
      clipboard.writeText(clipboardTextSchema.parse(input))
      return null
    }),
  )

  ipcMain.handle(ipcChannels.repositorySelect, () =>
    result(async () => {
      const selection = await showOpenDialog({
        buttonLabel: 'Open repository',
        properties: ['openDirectory'],
        title: 'Choose a Git repository',
      })
      const path = selection.filePaths[0]
      return selection.canceled || !path ? null : requireService().openRepository(path)
    }),
  )
  ipcMain.handle(ipcChannels.repositoryOpenRecent, (_event, input: unknown) =>
    result(() => requireService().openRecentRepository(recentRepositoryInputSchema.parse(input))),
  )
  ipcMain.handle(ipcChannels.repositoryRefresh, (_event, input: unknown) =>
    result(() => requireService().refreshRepository(optionalBaseBranchInputSchema.parse(input))),
  )
  ipcMain.handle(ipcChannels.repositoryUpdatePreferences, (_event, input: unknown) =>
    result(() =>
      requireService().updateRepositoryPreferences(
        updateRepositoryPreferencesInputSchema.parse(input),
      ),
    ),
  )
  ipcMain.handle(ipcChannels.repositorySelectInstructions, () =>
    result(async () => {
      const root = requireService().getCurrentRepositoryRoot()
      if (!root) {
        throw new Error('Select a repository first.')
      }
      const selection = await showOpenDialog({
        buttonLabel: 'Use instructions',
        defaultPath: root,
        filters: [{ extensions: ['md'], name: 'Markdown' }],
        properties: ['openFile'],
        title: 'Choose review instructions inside the repository',
      })
      const path = selection.filePaths[0]
      if (selection.canceled || !path) {
        return requireService().refreshRepository()
      }
      return requireService().selectInstructionFile(path)
    }),
  )

  ipcMain.handle(ipcChannels.settingsUpdate, (_event, input: unknown) =>
    result(() => requireService().updateSettings(updateSettingsInputSchema.parse(input))),
  )
  ipcMain.handle(ipcChannels.diagnosticsOpenLogFolder, () =>
    result(async () => {
      const error = await shell.openPath(app.getPath('logs'))
      if (error) {
        throw new Error('Shippy could not open the log folder.')
      }
      return null
    }),
  )
  ipcMain.handle(ipcChannels.externalOpen, (_event, input: unknown) =>
    result(async () => {
      await shell.openExternal(externalUrlSchema.parse(input))
      return null
    }),
  )
  ipcMain.on(ipcChannels.diagnosticsRendererError, (_event, input: unknown) => {
    const diagnostic = rendererDiagnosticInputSchema.safeParse(input)
    if (!diagnostic.success) {
      logger.warn('Ignored an invalid renderer diagnostic')
      return
    }
    logger.error(`Renderer ${diagnostic.data.kind}`)
    logger.debug('Renderer error details', {
      message: diagnostic.data.message,
      stack: diagnostic.data.stack,
    })
  })
  ipcMain.handle(ipcChannels.reviewList, () => result(() => requireService().listReviews()))
  ipcMain.handle(ipcChannels.reviewRead, (_event, input: unknown) =>
    result(() => requireService().readReview(reviewIdSchema.parse(input))),
  )
  ipcMain.handle(ipcChannels.reviewDelete, (_event, input: unknown) =>
    result(() => requireService().deleteReview(reviewIdSchema.parse(input))),
  )
  ipcMain.handle(ipcChannels.reviewReadSource, (_event, input: unknown) =>
    result(() => requireService().readSource(readSourceInputSchema.parse(input))),
  )
  ipcMain.handle(ipcChannels.reviewStart, (_event, input: unknown) =>
    result(() => {
      const request = startReviewInputSchema.parse(input)
      return requireService().startReview(request.baseBranch)
    }),
  )
  ipcMain.handle(ipcChannels.reviewCancel, () =>
    result(async () => {
      await requireService().cancelReview()
      return null
    }),
  )
}

function createWindow(): void {
  const window = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    height: 820,
    minHeight: 600,
    minWidth: 860,
    show: false,
    title: 'Shippy',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(currentDirectory, '../preload/index.cjs'),
      sandbox: true,
    },
    width: 1240,
  })
  mainWindow = window

  window.once('ready-to-show', () => window.show())
  window.once('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault()
    }
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(currentDirectory, '../renderer/index.html'))
  }
}

app.setName('Shippy')
initializeLogging(app.getPath('logs'))

void app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: 'Shippy',
    applicationVersion: app.getVersion(),
    authors: [authorName],
    credits: `Author: ${authorName}\nGitHub: ${repositoryUrl}`,
    website: repositoryUrl,
  })
  logger.info('Shippy app ready')
  service = new ShippyService(
    app.getPath('userData'),
    (progress) => {
      const validated = reviewProgressSchema.safeParse(progress)
      if (validated.success && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(ipcChannels.reviewProgress, validated.data)
      }
    },
    (update) => {
      const validated = reviewRunUpdateSchema.safeParse(update)
      if (validated.success && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(ipcChannels.activityUpdated, validated.data)
      }
    },
  )
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  logger.info('Shippy app quitting')
  void service?.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
