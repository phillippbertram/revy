import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const currentDirectory = dirname(fileURLToPath(import.meta.url))

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    title: 'Shippy',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(currentDirectory, '../preload/index.cjs'),
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const rendererUrl = process.env.ELECTRON_RENDERER_URL

  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(currentDirectory, '../renderer/index.html'))
  }
}

app.setName('Shippy')

void app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
