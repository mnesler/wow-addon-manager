export type Source = 'auto' | 'releases' | 'tags' | 'code'

export type AddonStatus = 'unlinked' | 'current' | 'update' | 'unchecked' | 'missing' | 'error'

export interface FlavorFolder {
  folder: string // always _forever_
  hasAddonsDir: boolean
}

export interface ScanResult {
  root: string
  rootExists: boolean
  folders: FlavorFolder[]
}

/** One addon as shown in the UI: a discovered folder (plus its modules) merged with its GitHub link. */
export interface AddonView {
  key: string
  flavor: string
  folder: string // primary folder name
  folders: string[] // primary + module folders
  name: string
  author: string
  version: string // from the .toc
  notes: string
  wowIcon: string | null // Interface\Icons\<name> from the .toc, if any
  githubHint: string | null // owner/repo found in the .toc metadata
  linkId: number | null
  source: Source
  repo: string | null
  installedTag: string | null
  latestTag: string | null
  latestPublished: string | null
  lastChecked: number | null
  status: AddonStatus
  error: string | null
}

export interface Settings {
  wowRoot: string
  autoUpdate: boolean
  checkIntervalMin: number
  githubToken: string
}

export interface ActionResult {
  ok: boolean
  message: string
}

/** This app manages one game client only: WoW Forever. */
export const GAME = { folder: '_forever_', label: 'Forever' } as const
