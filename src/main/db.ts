import { DatabaseSync } from 'node:sqlite'
import type { Settings, Source } from '../shared/types'

export interface LinkRow {
  id: number
  flavor: string
  repo: string // owner/name
  source: Source
  folders: string[]
  installedTag: string | null
  latestTag: string | null
  latestPublished: string | null
  lastChecked: number | null
  error: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  wowRoot: 'C:\\Program Files (x86)\\World of Warcraft',
  autoUpdate: false,
  checkIntervalMin: 60,
  githubToken: ''
}

export class Store {
  private db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        flavor TEXT NOT NULL,
        repo TEXT NOT NULL,
        folders TEXT NOT NULL DEFAULT '[]',
        installed_tag TEXT,
        latest_tag TEXT,
        latest_published TEXT,
        last_checked INTEGER,
        error TEXT,
        UNIQUE (flavor, repo)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    // Migration: where updates come from (auto | releases | tags | code).
    const cols = this.db.prepare('PRAGMA table_info(links)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'source'))
      this.db.exec("ALTER TABLE links ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'")
  }

  private toRow(r: Record<string, unknown>): LinkRow {
    return {
      id: r.id as number,
      flavor: r.flavor as string,
      repo: r.repo as string,
      source: ((r.source as string) ?? 'auto') as Source,
      folders: JSON.parse(r.folders as string) as string[],
      installedTag: (r.installed_tag as string) ?? null,
      latestTag: (r.latest_tag as string) ?? null,
      latestPublished: (r.latest_published as string) ?? null,
      lastChecked: (r.last_checked as number) ?? null,
      error: (r.error as string) ?? null
    }
  }

  listLinks(): LinkRow[] {
    return this.db
      .prepare('SELECT * FROM links ORDER BY id')
      .all()
      .map((r) => this.toRow(r as Record<string, unknown>))
  }

  getLink(id: number): LinkRow | null {
    const r = this.db.prepare('SELECT * FROM links WHERE id = ?').get(id)
    return r ? this.toRow(r as Record<string, unknown>) : null
  }

  findLink(flavor: string, repo: string): LinkRow | null {
    const r = this.db
      .prepare('SELECT * FROM links WHERE flavor = ? AND repo = ? COLLATE NOCASE')
      .get(flavor, repo)
    return r ? this.toRow(r as Record<string, unknown>) : null
  }

  addLink(flavor: string, repo: string, folders: string[]): number {
    const res = this.db
      .prepare('INSERT INTO links (flavor, repo, folders) VALUES (?, ?, ?)')
      .run(flavor, repo, JSON.stringify(folders))
    return Number(res.lastInsertRowid)
  }

  updateLink(id: number, patch: Partial<Omit<LinkRow, 'id' | 'flavor' | 'repo'>>): void {
    const map: Record<string, string> = {
      folders: 'folders',
      source: 'source',
      installedTag: 'installed_tag',
      latestTag: 'latest_tag',
      latestPublished: 'latest_published',
      lastChecked: 'last_checked',
      error: 'error'
    }
    for (const [k, v] of Object.entries(patch)) {
      const col = map[k]
      if (!col) continue
      const val = k === 'folders' ? JSON.stringify(v) : (v ?? null)
      this.db.prepare(`UPDATE links SET ${col} = ? WHERE id = ?`).run(val as string | number | null, id)
    }
  }

  deleteLink(id: number): void {
    this.db.prepare('DELETE FROM links WHERE id = ?').run(id)
  }

  getSettings(): Settings {
    const out: Settings = { ...DEFAULT_SETTINGS }
    for (const r of this.db.prepare('SELECT key, value FROM settings').all()) {
      const { key, value } = r as { key: keyof Settings; value: string }
      if (!(key in out)) continue
      ;(out as unknown as Record<string, unknown>)[key] = JSON.parse(value)
    }
    return out
  }

  setSettings(patch: Partial<Settings>): Settings {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    for (const [k, v] of Object.entries(patch)) stmt.run(k, JSON.stringify(v))
    return this.getSettings()
  }

  close(): void {
    this.db.close()
  }
}
