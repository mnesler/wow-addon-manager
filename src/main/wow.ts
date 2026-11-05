import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { GAME, type FlavorFolder, type ScanResult } from '../shared/types'

export function addonsDir(root: string, flavor: string): string {
  return join(root, flavor, 'Interface', 'AddOns')
}

/** Only the Forever client folder is managed; other clients in the install are ignored. */
export function scanRoot(root: string): ScanResult {
  if (!existsSync(root)) return { root, rootExists: false, folders: [] }
  const folders: FlavorFolder[] = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name === GAME.folder)
    .map((d) => ({ folder: d.name, hasAddonsDir: existsSync(addonsDir(root, d.name)) }))
  return { root, rootExists: true, folders }
}

// ---------- .toc parsing ----------

export function cleanText(s: string): string {
  return s
    .replace(/\|c[0-9a-fA-F]{8}/g, '')
    .replace(/\|r/g, '')
    .replace(/\|T.*?\|t/g, '')
    .replace(/\|n/g, ' ')
    .trim()
}

export function parseToc(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^##\s*([^:]+?)\s*:\s*(.*?)\s*$/)
    if (m) out[m[1].toLowerCase()] = m[2]
  }
  return out
}

export interface Discovered {
  folder: string
  name: string
  author: string
  version: string
  notes: string
  wowIcon: string | null
  githubHint: string | null
  deps: string[]
}

const GH_RE = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i

export function githubFromText(text: string): string | null {
  const m = text.match(GH_RE)
  if (!m) return null
  return `${m[1]}/${m[2].replace(/\.git$/i, '')}`
}

function readToc(dir: string, folder: string): Record<string, string> | null {
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.toc'))
  } catch {
    return null
  }
  if (files.length === 0) return null
  // Prefer the plain <Folder>.toc, else any (flavour-specific tocs share metadata).
  const exact = files.find((f) => f.toLowerCase() === `${folder.toLowerCase()}.toc`)
  const file = exact ?? files[0]
  try {
    return parseToc(readFileSync(join(dir, file), 'utf8'))
  } catch {
    return null
  }
}

export function discoverFolders(root: string, flavor: string): Discovered[] {
  const base = addonsDir(root, flavor)
  if (!existsSync(base)) return []
  const out: Discovered[] = []
  for (const d of readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('Blizzard_') || d.name.endsWith('.wam-new')) continue
    const toc = readToc(join(base, d.name), d.name)
    if (!toc) continue
    const title = cleanText(toc['title'] ?? '') || d.name
    const iconRaw = toc['icontexture'] ?? toc['iconatlas'] ?? ''
    const iconM = iconRaw.match(/Interface[\\/]+Icons[\\/]+([A-Za-z0-9_]+)/i)
    const meta = Object.entries(toc)
      .filter(([k]) => k.startsWith('x-') || k === 'notes' || k === 'website')
      .map(([, v]) => v)
      .join(' ')
    const deps = [toc['dependencies'], toc['requireddeps']]
      .filter(Boolean)
      .join(',')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    out.push({
      folder: d.name,
      name: title,
      author: cleanText(toc['author'] ?? ''),
      version: cleanText(toc['version'] ?? ''),
      notes: cleanText(toc['notes'] ?? ''),
      wowIcon: iconM ? iconM[1].toLowerCase() : null,
      githubHint: githubFromText(meta),
      deps
    })
  }
  return out
}

/** Is `child` a module/plugin of `parent` (e.g. DBM-GUI of DBM-Core)? */
export function isModuleOf(child: Discovered, parent: Discovered): boolean {
  if (child.folder === parent.folder) return false
  const c = child.folder.toLowerCase()
  const p = parent.folder.toLowerCase()
  if (c.startsWith(p + '_') || c.startsWith(p + '-')) return true
  const dependsOn = child.deps.some((d) => d.toLowerCase() === p)
  if (!dependsOn) return false
  const token = (s: string): string => s.split(/[-_ ]/)[0]
  return c.startsWith(p) || token(c) === token(p)
}

export interface Group {
  main: Discovered
  modules: Discovered[]
}

/** Collapse module folders under their parent so the UI shows one row per addon. */
export function groupDiscovered(all: Discovered[]): Group[] {
  const parentOf = new Map<string, Discovered>()
  for (const c of all) {
    // Choose the shortest-named parent so DBM-GUI groups under DBM-Core, not a sibling.
    const parents = all.filter((p) => isModuleOf(c, p))
    if (parents.length) {
      parents.sort((a, b) => a.folder.length - b.folder.length)
      parentOf.set(c.folder, parents[0])
    }
  }
  const rootOf = (d: Discovered): Discovered => {
    let cur = d
    const seen = new Set<string>()
    while (parentOf.has(cur.folder) && !seen.has(cur.folder)) {
      seen.add(cur.folder)
      cur = parentOf.get(cur.folder)!
    }
    return cur
  }
  const groups = new Map<string, Group>()
  for (const d of all) {
    const r = rootOf(d)
    if (!groups.has(r.folder)) groups.set(r.folder, { main: r, modules: [] })
    if (r.folder !== d.folder) groups.get(r.folder)!.modules.push(d)
  }
  return [...groups.values()].sort((a, b) =>
    a.main.name.toLowerCase().localeCompare(b.main.name.toLowerCase())
  )
}
