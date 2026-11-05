import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ActionResult, AddonView, ScanResult, Settings, Source } from '../shared/types'

const on = <T>(channel: string, cb: (payload: T) => void): (() => void) => {
  const fn = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.removeListener(channel, fn)
}

const api = {
  scan: (): Promise<ScanResult> => ipcRenderer.invoke('scan'),
  list: (): Promise<AddonView[]> => ipcRenderer.invoke('list'),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:set', patch),
  link: (flavor: string, repo: string, folder: string | null): Promise<ActionResult> =>
    ipcRenderer.invoke('link', flavor, repo, folder),
  unlink: (id: number): Promise<ActionResult> => ipcRenderer.invoke('unlink', id),
  setSource: (id: number, source: Source): Promise<ActionResult> =>
    ipcRenderer.invoke('setSource', id, source),
  uninstall: (flavor: string, folders: string[], linkId: number | null): Promise<ActionResult> =>
    ipcRenderer.invoke('uninstall', flavor, folders, linkId),
  check: (id: number): Promise<ActionResult> => ipcRenderer.invoke('check', id),
  checkAll: (): Promise<ActionResult> => ipcRenderer.invoke('checkAll'),
  update: (id: number): Promise<ActionResult> => ipcRenderer.invoke('update', id),
  updateAll: (flavor: string | null): Promise<ActionResult> =>
    ipcRenderer.invoke('updateAll', flavor),
  openAddons: (flavor: string): Promise<string> => ipcRenderer.invoke('openAddons', flavor),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('openExternal', url),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pickFolder'),
  onChanged: (cb: () => void): (() => void) => on<void>('changed', cb),
  onBusy: (cb: (ids: number[]) => void): (() => void) => on<number[]>('busy', cb)
}

export type Api = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
