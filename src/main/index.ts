import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { Store } from './db'
import { AddonService } from './service'
import { addonsDir } from './wow'
import type { Settings, Source } from '../shared/types'

let service: AddonService
let timer: NodeJS.Timeout | null = null

function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

/** (Re)start the background check. Always checks; installs only if auto-update is enabled. */
function schedule(): void {
  if (timer) clearInterval(timer)
  const minutes = Math.max(5, service.getSettings().checkIntervalMin)
  timer = setInterval(() => void service.autoTick().catch(console.error), minutes * 60_000)
}

function registerIpc(): void {
  ipcMain.handle('scan', () => service.scan())
  ipcMain.handle('list', () => service.list())
  ipcMain.handle('settings:get', () => service.getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const s = service.setSettings(patch)
    schedule()
    return s
  })
  ipcMain.handle('link', (_e, flavor: string, repo: string, folder: string | null) =>
    service.link(flavor, repo, folder)
  )
  ipcMain.handle('unlink', (_e, id: number) => service.unlink(id))
  ipcMain.handle('setSource', (_e, id: number, source: Source) => service.setSource(id, source))
  ipcMain.handle('uninstall', (_e, flavor: string, folders: string[], linkId: number | null) =>
    service.uninstall(flavor, folders, linkId)
  )
  ipcMain.handle('check', (_e, id: number) => service.check(id))
  ipcMain.handle('checkAll', () => service.checkAll())
  ipcMain.handle('update', (_e, id: number) => service.update(id))
  ipcMain.handle('updateAll', (_e, flavor: string | null) => service.updateAll(flavor))
  ipcMain.handle('openAddons', (_e, flavor: string) =>
    shell.openPath(addonsDir(service.getSettings().wowRoot, flavor))
  )
  ipcMain.handle('openExternal', (_e, url: string) => {
    if (/^https:\/\/github\.com\//.test(url)) return shell.openExternal(url)
    return undefined
  })
  ipcMain.handle('pickFolder', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Select your World of Warcraft folder',
      properties: ['openDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'Azeroth Addon Manager',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d12', symbolColor: '#c8aa6e', height: 40 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https:\/\/github\.com\//.test(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.azeroth.addonmanager')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  service = new AddonService(new Store(join(app.getPath('userData'), 'addons.db')))
  service.onChange = () => broadcast('changed')
  service.onBusy = (ids) => broadcast('busy', ids)
  registerIpc()
  schedule()

  createWindow()
  // First check shortly after launch so the window is up first.
  setTimeout(() => void service.autoTick().catch(console.error), 4000)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
