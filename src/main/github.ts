import AdmZip from 'adm-zip'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync
} from 'fs'
import { tmpdir } from 'os'
import { basename, join, sep } from 'path'
import type { Source } from '../shared/types'

const UA = 'wow-addon-manager'

export function parseRepo(input: string): string {
  const s = input.trim().replace(/\.git$/i, '')
  const m =
    s.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i) ??
    s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (!m) throw new Error('That does not look like a GitHub repository (use owner/repo or a URL).')
  return `${m[1]}/${m[2].replace(/\.git$/i, '')}`
}

async function gh<T>(path: string, token: string): Promise<T | null> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': UA,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
  if (res.status === 404) return null
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get('x-ratelimit-remaining') === '0')
      throw new Error('GitHub rate limit reached. Add a token in Settings or try again later.')
    throw new Error(`GitHub refused the request (${res.status}).`)
  }
  if (!res.ok) throw new Error(`GitHub error ${res.status}.`)
  return (await res.json()) as T
}

export interface Latest {
  tag: string
  published: string | null
  url: string
  assetName: string
  via: 'release' | 'tag' | 'code'
  /** The file name suggests another client; check the .toc inside before installing. */
  verify?: boolean
}

interface Asset {
  name: string
  browser_download_url: string
}

// Release zips are often named per client. Skip builds made for other clients (Classic, Era,
// Cataclysm, ...) and prefer plain/mainline builds, which is what Forever uses.
const OTHER_CLIENT = /classic|vanilla|(^|[^a-z])era([^a-z]|$)|cata|wrath|wotlk|tbc|bcc|(^|[^a-z])mop([^a-z]|$)|pandaria/i
const MAINLINE = /(^|[^a-z])(retail|mainline|main)([^a-z]|$)/i

export function pickAsset(assets: Asset[]): { asset: Asset; certain: boolean } | null {
  const zips = assets.filter((a) => a.name.toLowerCase().endsWith('.zip'))
  const score = (name: string): number => {
    if (OTHER_CLIENT.test(name)) return -10
    let s = MAINLINE.test(name) ? 10 : 0
    if (/nolib|debug|source|src/i.test(name)) s -= 1
    return s
  }
  const ranked = zips.map((a) => ({ a, s: score(a.name) })).sort((x, y) => y.s - x.s)
  if (!ranked.length) return null
  // Packagers often mislabel multi-client zips (e.g. "-bcc" on a package whose .toc also lists
  // retail). A name that looks like another client is only a hint: installFrom checks the .toc.
  return { asset: ranked[0].a, certain: ranked[0].s >= 0 }
}

interface Rel {
  tag_name: string
  published_at: string
  zipball_url: string
  assets: Asset[]
}

async function fromRelease(repo: string, token: string): Promise<Latest | null> {
  const rel = await gh<Rel>(`/repos/${repo}/releases/latest`, token)
  if (!rel) return null
  const pick = pickAsset(rel.assets)
  if (pick)
    return {
      tag: rel.tag_name,
      published: rel.published_at,
      url: pick.asset.browser_download_url,
      assetName: pick.asset.name,
      via: 'release',
      verify: !pick.certain
    }
  return {
    tag: rel.tag_name,
    published: rel.published_at,
    url: rel.zipball_url,
    assetName: 'source',
    via: 'release'
  }
}

const tagZip = (repo: string, tag: string): string =>
  `https://codeload.github.com/${repo}/zip/refs/tags/${encodeURIComponent(tag)}`

/** Newest tag by date. GitHub's API lists tags in name order, but the Atom feed is newest-first. */
async function fromTags(repo: string, token: string): Promise<Latest | null> {
  try {
    const res = await fetch(`https://github.com/${repo}/tags.atom`, { headers: { 'User-Agent': UA } })
    if (res.ok) {
      const xml = await res.text()
      const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)
      const title = entry?.[1].match(/<title>([\s\S]*?)<\/title>/)?.[1].trim()
      if (!title) return null // repo exists but has no tags
      const updated = entry?.[1].match(/<updated>(.*?)<\/updated>/)?.[1] ?? null
      return { tag: title, published: updated, url: tagZip(repo, title), assetName: 'source', via: 'tag' }
    }
  } catch {
    /* fall through to the API */
  }
  const tags = await gh<{ name: string }[]>(`/repos/${repo}/tags?per_page=1`, token)
  if (!tags || !tags.length) return null
  return { tag: tags[0].name, published: null, url: tagZip(repo, tags[0].name), assetName: 'source', via: 'tag' }
}

async function fromCode(repo: string, token: string): Promise<Latest> {
  const commits = await gh<{ sha: string; commit: { committer: { date: string } } }[]>(
    `/repos/${repo}/commits?per_page=1`,
    token
  )
  if (!commits || !commits.length) throw new Error('Repository not found (is it private or misspelled?).')
  const c = commits[0]
  return {
    tag: c.sha.slice(0, 7),
    published: c.commit.committer.date,
    url: `https://codeload.github.com/${repo}/zip/${c.sha}`,
    assetName: 'source',
    via: 'code'
  }
}

/** Source-based fallback for when a release's zip is for another client. */
export async function getSourceFallback(repo: string, token: string): Promise<Latest> {
  return (await fromTags(repo, token)) ?? fromCode(repo, token)
}

const STALE_MS = 90 * 24 * 3600 * 1000

/**
 * source = releases | tags | code picks exactly that. `auto` uses the latest release, unless a
 * tag is more than ~3 months newer (some projects stopped cutting releases but keep tagging).
 */
export async function getLatest(repo: string, token: string, source: Source = 'auto'): Promise<Latest> {
  if (source === 'releases') {
    const r = await fromRelease(repo, token)
    if (!r) throw new Error('This repository has no GitHub releases. Try the Tags or Latest code source.')
    return r
  }
  if (source === 'tags') {
    const t = await fromTags(repo, token)
    if (!t) throw new Error('This repository has no tags. Try the Latest code source.')
    return t
  }
  if (source === 'code') return fromCode(repo, token)

  const rel = await fromRelease(repo, token)
  const tag = await fromTags(repo, token)
  if (rel && tag) {
    const relT = rel.published ? Date.parse(rel.published) : 0
    const tagT = tag.published ? Date.parse(tag.published) : 0
    return tagT - relT > STALE_MS ? tag : rel
  }
  if (rel) return rel
  if (tag) return tag
  return fromCode(repo, token)
}

// ---------- install ----------

const SUFFIX = /[-_](mainline|vanilla|classic|cata|wrath|wotlk|tbc|bcc|mists|mop|era)$/i
const tocBase = (file: string): string => file.replace(/\.toc$/i, '').replace(SUFFIX, '')

/** Find addon folders inside an extracted archive. Returns [sourcePath, addonName]. */
export function findAddonDirs(dir: string, depth = 0): [string, string][] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const tocs = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.toc'))
  const found: [string, string][] = []

  if (tocs.length) {
    const own = basename(dir).toLowerCase()
    const match = tocs.find((t) => tocBase(t.name).toLowerCase() === own)
    // Name matches the folder: a normal addon. Otherwise (e.g. a GitHub zipball root such as
    // "owner-repo-sha") the repo itself is the addon, named after its .toc.
    found.push([dir, match ? basename(dir) : tocBase(tocs[0].name)])
    return found
  }
  if (depth >= 4) return found
  for (const e of entries) {
    if (e.isDirectory() && e.name !== '__MACOSX' && !e.name.startsWith('.'))
      found.push(...findAddonDirs(join(dir, e.name), depth + 1))
  }
  return found
}

/** Interface numbers a folder's .toc files declare (e.g. 120100). Empty if none are declared. */
function tocInterfaces(dir: string): number[] {
  const nums: number[] = []
  for (const f of readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.toc')) continue
    if (/[-_](mainline)\.toc$/i.test(f)) nums.push(120000) // a dedicated mainline toc
    const m = readFileSync(join(dir, f), 'utf8').match(/^##\s*Interface\s*:\s*(.+)$/im)
    if (m) for (const n of m[1].split(/[,\s]+/)) if (/^\d+$/.test(n)) nums.push(Number(n))
  }
  return nums
}

/** Forever runs the current (mainline-numbered, 10xxxx+) client. Classic builds use 1xxxx-5xxxx. */
const supportsForever = (nums: number[]): boolean => nums.length === 0 || nums.some((n) => n >= 100000)

interface PkgMeta {
  packageAs: string | null
  moves: [string, string][] // [path inside the package, new top-level folder]
  hasExternals: boolean
}

/** Minimal reader for the packager `.pkgmeta` fields that matter for a source install. */
export function parsePkgmeta(text: string): PkgMeta {
  const out: PkgMeta = { packageAs: null, moves: [], hasExternals: false }
  let section = ''
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    if (!/^\s/.test(raw)) {
      const m = raw.match(/^([A-Za-z-]+):\s*(.*)$/)
      section = m ? m[1] : ''
      if (m && section === 'package-as') out.packageAs = m[2].trim()
      if (m && section === 'externals') out.hasExternals = true
    } else if (section === 'move-folders') {
      const m = raw.trim().match(/^(.+?):\s*(.+)$/)
      if (m) out.moves.push([m[1].replace(/\\/g, '/'), m[2].trim()])
    }
  }
  return out
}

/** The download is a build for another client (Classic, Era...). */
export class WrongClientError extends Error {}

export interface InstallResult {
  folders: string[]
  notes: string[]
}

interface Job {
  src: string
  name: string
  exclude: string[] // paths inside src that were moved out to their own folder
}

export async function installFrom(latest: Latest, addonsPath: string, token: string): Promise<InstallResult> {
  const host = new URL(latest.url).hostname
  const res = await fetch(latest.url, {
    headers: {
      'User-Agent': UA,
      Accept: '*/*', // octet-stream makes GitHub's source-zip endpoint answer 415
      ...(token && host === 'api.github.com' ? { Authorization: `Bearer ${token}` } : {})
    },
    redirect: 'follow'
  })
  if (!res.ok) throw new Error(`Download failed (${res.status}).`)
  const buf = Buffer.from(await res.arrayBuffer())

  const tmp = mkdtempSync(join(tmpdir(), 'wam-'))
  try {
    new AdmZip(buf).extractAllTo(tmp, true)
    const found = findAddonDirs(tmp)
    if (found.length === 0) throw new Error('No addon (.toc) found inside the download.')
    if (latest.verify && !found.some(([src]) => supportsForever(tocInterfaces(src))))
      throw new WrongClientError(
        `${latest.assetName} is built for another client (its .toc has no retail-era Interface).`
      )

    // A source download is not packaged. `.pkgmeta` says what the packager would have done:
    // name the folder and move bundled plugins out to the top level.
    const notes: string[] = []
    const jobs: Job[] = []
    for (const [src, name] of found) {
      const metaFile = join(src, '.pkgmeta')
      if (!existsSync(metaFile)) {
        jobs.push({ src, name, exclude: [] })
        continue
      }
      const pm = parsePkgmeta(readFileSync(metaFile, 'utf8'))
      const main = pm.packageAs || name
      const exclude: string[] = []
      const plugins: Job[] = []
      for (const [from, to] of pm.moves) {
        const parts = from.split('/')
        const rel = parts[0].toLowerCase() === main.toLowerCase() ? parts.slice(1) : parts
        const inner = join(src, ...rel)
        if (inner.startsWith(src + sep) && existsSync(inner)) {
          plugins.push({ src: inner, name: to, exclude: [] })
          exclude.push(inner)
        }
      }
      jobs.push({ src, name: main, exclude }, ...plugins) // main addon first
      if (pm.hasExternals && latest.via !== 'release')
        notes.push('This repo pulls some libraries in at build time, so a source install may be missing them.')
    }

    mkdirSync(addonsPath, { recursive: true })
    const names: string[] = []
    for (const job of jobs) {
      if (names.some((n) => n.toLowerCase() === job.name.toLowerCase())) continue
      const dest = join(addonsPath, job.name)
      const staging = dest + '.wam-new'
      rmSync(staging, { recursive: true, force: true })
      cpSync(job.src, staging, { recursive: true, filter: (p) => !job.exclude.includes(p) })
      rmSync(dest, { recursive: true, force: true })
      renameSync(staging, dest)
      names.push(job.name)
    }
    return { folders: names, notes: [...new Set(notes)] }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function removeFolders(addonsPath: string, folders: string[]): void {
  for (const f of folders) {
    // Folder names come from our own scan/DB, but never allow path traversal.
    if (!f || f.includes('/') || f.includes('\\') || f === '..' || f === '.') continue
    const p = join(addonsPath, f)
    if (existsSync(p)) rmSync(p, { recursive: true, force: true })
  }
}
