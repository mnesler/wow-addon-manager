import { existsSync } from 'fs'
import { join } from 'path'
import type { ActionResult, AddonStatus, AddonView, ScanResult, Settings, Source } from '../shared/types'
import { Store, type LinkRow } from './db'
import { getLatest, installFrom, parseRepo, removeFolders } from './github'
import { addonsDir, discoverFolders, groupDiscovered, scanRoot, type Discovered } from './wow'

const norm = (v: string | null): string =>
  (v ?? '').toLowerCase().trim().replace(/^v(?=\d)/, '')

export class AddonService {
  private busy = new Set<number>()
  onChange: () => void = () => {}
  onBusy: (ids: number[]) => void = () => {}

  constructor(private store: Store) {}

  // ----- settings / scan -----
  getSettings(): Settings {
    return this.store.getSettings()
  }
  setSettings(patch: Partial<Settings>): Settings {
    const s = this.store.setSettings(patch)
    this.onChange()
    return s
  }
  scan(): ScanResult {
    return scanRoot(this.store.getSettings().wowRoot)
  }

  // ----- views -----
  list(): AddonView[] {
    const { wowRoot } = this.store.getSettings()
    const scan = scanRoot(wowRoot)
    const links = this.store.listLinks()
    const views: AddonView[] = []

    for (const { folder: flavor } of scan.folders) {
      const found = discoverFolders(wowRoot, flavor)
      const byName = new Map(found.map((d) => [d.folder.toLowerCase(), d]))
      const claimed = new Set<string>()
      const flavorLinks = links.filter((l) => l.flavor === flavor)

      for (const l of flavorLinks) {
        const present = l.folders.map((f) => byName.get(f.toLowerCase())).filter(Boolean) as Discovered[]
        present.forEach((d) => claimed.add(d.folder.toLowerCase()))
        l.folders.forEach((f) => claimed.add(f.toLowerCase()))
        const main = present[0]
        views.push(this.linkedView(flavor, l, main, present))
      }

      const rest = found.filter((d) => !claimed.has(d.folder.toLowerCase()))
      for (const g of groupDiscovered(rest)) {
        views.push({
          key: `${flavor}/${g.main.folder}`,
          flavor,
          folder: g.main.folder,
          folders: [g.main.folder, ...g.modules.map((m) => m.folder)],
          name: g.main.name,
          author: g.main.author,
          version: g.main.version,
          notes: g.main.notes,
          wowIcon: g.main.wowIcon,
          githubHint: g.main.githubHint,
          linkId: null,
          source: 'auto',
          repo: null,
          installedTag: null,
          latestTag: null,
          latestPublished: null,
          lastChecked: null,
          status: 'unlinked',
          error: null
        })
      }
    }
    return views
  }

  private status(l: LinkRow, main: Discovered | undefined): AddonStatus {
    if (!main) return 'missing'
    if (!l.latestTag) return l.error ? 'error' : 'unchecked'
    const installed = l.installedTag ?? main.version
    return norm(installed) === norm(l.latestTag) ? 'current' : 'update'
  }

  private linkedView(flavor: string, l: LinkRow, main: Discovered | undefined, present: Discovered[]): AddonView {
    const repoName = l.repo.split('/')[1]
    return {
      key: `${flavor}/#${l.id}`,
      flavor,
      folder: main?.folder ?? l.folders[0] ?? repoName,
      folders: present.length ? present.map((d) => d.folder) : l.folders,
      name: main?.name ?? repoName,
      author: main?.author || l.repo.split('/')[0],
      version: main?.version ?? '',
      notes: main?.notes ?? '',
      wowIcon: main?.wowIcon ?? null,
      githubHint: null,
      linkId: l.id,
      source: l.source,
      repo: l.repo,
      installedTag: l.installedTag,
      latestTag: l.latestTag,
      latestPublished: l.latestPublished,
      lastChecked: l.lastChecked,
      status: this.status(l, main),
      error: l.error
    }
  }

  // ----- busy tracking -----
  private async withBusy<T>(id: number, fn: () => Promise<T>): Promise<T> {
    this.busy.add(id)
    this.onBusy([...this.busy])
    try {
      return await fn()
    } finally {
      this.busy.delete(id)
      this.onBusy([...this.busy])
    }
  }

  // ----- linking -----
  async link(flavor: string, repoInput: string, folder: string | null): Promise<ActionResult> {
    let repo: string
    try {
      repo = parseRepo(repoInput)
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
    if (this.store.findLink(flavor, repo))
      return { ok: false, message: `${repo} is already linked for this game version.` }

    const { wowRoot } = this.store.getSettings()
    let folders: string[] = []
    if (folder) {
      const group = groupDiscovered(discoverFolders(wowRoot, flavor)).find((g) => g.main.folder === folder)
      folders = group ? [group.main.folder, ...group.modules.map((m) => m.folder)] : [folder]
    }
    const id = this.store.addLink(flavor, repo, folders)
    const checked = await this.check(id)
    if (!checked.ok) {
      this.store.deleteLink(id)
      this.onChange()
      return checked
    }
    if (!folder) {
      const r = await this.update(id)
      if (!r.ok) {
        this.store.deleteLink(id)
        this.onChange()
        return r
      }
      return { ok: true, message: `Linked and installed ${repo}.` }
    }
    // Existing install: if the .toc version already equals the release, record it as current.
    const l = this.store.getLink(id)!
    const main = discoverFolders(wowRoot, flavor).find((d) => d.folder === folder)
    if (l.latestTag && main && norm(main.version) === norm(l.latestTag))
      this.store.updateLink(id, { installedTag: l.latestTag })
    this.onChange()
    return { ok: true, message: `Linked ${repo}.` }
  }

  /** Change where updates come from, then re-check against the new source. */
  async setSource(id: number, source: Source): Promise<ActionResult> {
    this.store.updateLink(id, { source, latestTag: null, latestPublished: null, error: null })
    this.onChange()
    return this.check(id)
  }

  unlink(id: number): ActionResult {
    this.store.deleteLink(id)
    this.onChange()
    return { ok: true, message: 'Unlinked. Files were left in place.' }
  }

  uninstall(flavor: string, folders: string[], linkId: number | null): ActionResult {
    const { wowRoot } = this.store.getSettings()
    removeFolders(addonsDir(wowRoot, flavor), folders)
    if (linkId != null) this.store.deleteLink(linkId)
    this.onChange()
    return { ok: true, message: 'Addon removed.' }
  }

  // ----- checking & updating -----
  async check(id: number): Promise<ActionResult> {
    const l = this.store.getLink(id)
    if (!l) return { ok: false, message: 'Link not found.' }
    const { githubToken } = this.store.getSettings()
    try {
      const latest = await getLatest(l.repo, githubToken, l.source)
      this.store.updateLink(id, {
        latestTag: latest.tag,
        latestPublished: latest.published,
        lastChecked: Date.now(),
        error: null
      })
      this.onChange()
      return { ok: true, message: `${l.repo}: latest is ${latest.tag}.` }
    } catch (e) {
      this.store.updateLink(id, { lastChecked: Date.now(), error: (e as Error).message })
      this.onChange()
      return { ok: false, message: `${l.repo}: ${(e as Error).message}` }
    }
  }

  async checkAll(): Promise<ActionResult> {
    const links = this.store.listLinks()
    let failed = 0
    // Small batches keep GitHub happy and the UI responsive.
    for (let i = 0; i < links.length; i += 4) {
      const res = await Promise.all(
        links.slice(i, i + 4).map((l) => this.withBusy(l.id, () => this.check(l.id)))
      )
      failed += res.filter((r) => !r.ok).length
    }
    const upd = this.list().filter((a) => a.status === 'update').length
    return {
      ok: failed === 0,
      message:
        `Checked ${links.length} linked addon${links.length === 1 ? '' : 's'}: ` +
        `${upd} update${upd === 1 ? '' : 's'} available` +
        (failed ? `, ${failed} failed.` : '.')
    }
  }

  async update(id: number): Promise<ActionResult> {
    const l = this.store.getLink(id)
    if (!l) return { ok: false, message: 'Link not found.' }
    const { wowRoot, githubToken } = this.store.getSettings()
    return this.withBusy(id, async () => {
      try {
        const latest = await getLatest(l.repo, githubToken, l.source)
        const { folders, notes } = await installFrom(latest, addonsDir(wowRoot, l.flavor), githubToken)
        // Remove folders an older version shipped that this release dropped.
        const stale = l.folders.filter((f) => !folders.some((n) => n.toLowerCase() === f.toLowerCase()))
        removeFolders(addonsDir(wowRoot, l.flavor), stale)
        this.store.updateLink(id, {
          folders,
          installedTag: latest.tag,
          latestTag: latest.tag,
          latestPublished: latest.published,
          lastChecked: Date.now(),
          error: null
        })
        this.onChange()
        return {
          ok: true,
          message: `${l.repo} updated to ${latest.tag}.` + (notes.length ? ` Note: ${notes.join(' ')}` : '')
        }
      } catch (e) {
        this.store.updateLink(id, { error: (e as Error).message })
        this.onChange()
        return { ok: false, message: `${l.repo}: ${(e as Error).message}` }
      }
    })
  }

  async updateAll(flavor: string | null): Promise<ActionResult> {
    const todo = this.list().filter(
      (a) => a.status === 'update' && a.linkId != null && (!flavor || a.flavor === flavor)
    )
    let failed = 0
    for (const a of todo) {
      const r = await this.update(a.linkId!)
      if (!r.ok) failed++
    }
    return {
      ok: failed === 0,
      message: todo.length
        ? `Updated ${todo.length - failed} of ${todo.length} addons.`
        : 'Everything is already up to date.'
    }
  }

  /** Scheduled run: always check; install only when auto-update is on. */
  async autoTick(): Promise<void> {
    const { wowRoot, autoUpdate } = this.store.getSettings()
    if (!existsSync(join(wowRoot))) return
    await this.checkAll()
    if (autoUpdate) await this.updateAll(null)
  }
}
