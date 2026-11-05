import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleAlert,
  CircleCheck,
  Download,
  FolderOpen,
  GitBranch,
  Library,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Swords
} from 'lucide-react'
import { GAME, type ActionResult, type AddonView, type ScanResult, type Settings } from '../../shared/types'
import AddonCard from './components/AddonCard'

type View = 'installed' | 'updates' | 'add' | 'settings'

const NAV: { id: View; label: string; icon: typeof Library }[] = [
  { id: 'installed', label: 'Installed', icon: Library },
  { id: 'updates', label: 'Updates', icon: Download },
  { id: 'add', label: 'Link Addon', icon: PackagePlus },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

const INTERVALS = [
  { v: 15, l: 'Every 15 minutes' },
  { v: 30, l: 'Every 30 minutes' },
  { v: 60, l: 'Every hour' },
  { v: 180, l: 'Every 3 hours' },
  { v: 360, l: 'Every 6 hours' }
]

export default function App(): React.JSX.Element {
  const [view, setView] = useState<View>('installed')
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [addons, setAddons] = useState<AddonView[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<number[]>([])
  const [working, setWorking] = useState<'check' | 'updateAll' | null>(null)
  const [toast, setToast] = useState<ActionResult | null>(null)
  const [repo, setRepo] = useState('')
  const [linkWorking, setLinkWorking] = useState(false)
  const [rootDraft, setRootDraft] = useState('')
  const [loaded, setLoaded] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const say = useCallback((r: ActionResult) => {
    setToast(r)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }, [])

  const refresh = useCallback(async () => {
    const [s, a] = await Promise.all([window.api.scan(), window.api.list()])
    setScan(s)
    setAddons(a)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
    void window.api.getSettings().then((s) => {
      setSettings(s)
      setRootDraft(s.wowRoot)
    })
    const offChanged = window.api.onChanged(() => void refresh())
    const offBusy = window.api.onBusy(setBusy)
    return () => {
      offChanged()
      offBusy()
    }
  }, [refresh])

  const flavor = GAME.folder
  const installed = !!scan?.folders.some((f) => f.folder === GAME.folder)

  const forFlavor = useMemo(() => addons.filter((a) => a.flavor === flavor), [addons, flavor])
  const updates = useMemo(() => forFlavor.filter((a) => a.status === 'update'), [forFlavor])
  const allUpdates = addons.filter((a) => a.status === 'update')
  const suggestions = addons.filter((a) => a.status === 'unlinked' && a.githubHint)

  const list = useMemo(() => {
    const base = view === 'updates' ? updates : forFlavor
    const q = query.trim().toLowerCase()
    return q ? base.filter((a) => (a.name + a.author + (a.repo ?? '')).toLowerCase().includes(q)) : base
  }, [view, forFlavor, updates, query])

  // ----- actions -----
  const checkAll = async (): Promise<void> => {
    setWorking('check')
    say(await window.api.checkAll())
    setWorking(null)
  }
  const updateAll = async (): Promise<void> => {
    setWorking('updateAll')
    say(await window.api.updateAll(flavor))
    setWorking(null)
  }
  const doLink = async (flv: string, r: string, folder: string | null): Promise<boolean> => {
    const res = await window.api.link(flv, r, folder)
    say(res)
    return res.ok
  }
  const saveSettings = async (patch: Partial<Settings>): Promise<void> => {
    const s = await window.api.setSettings(patch)
    setSettings(s)
    setRootDraft(s.wowRoot)
  }
  const changeRoot = async (path: string): Promise<void> => {
    await saveSettings({ wowRoot: path })
    await refresh()
  }

  const card = (a: AddonView): React.JSX.Element => (
    <AddonCard
      key={a.key}
      addon={a}
      busy={a.linkId != null && busy.includes(a.linkId)}
      onUpdate={async (x) => say(await window.api.update(x.linkId!))}
      onCheck={async (x) => say(await window.api.check(x.linkId!))}
      onLink={(x, r) => doLink(x.flavor, r, x.folder)}
      onUnlink={async (x) => say(await window.api.unlink(x.linkId!))}
      onSource={async (x, src) => say(await window.api.setSource(x.linkId!, src))}
      onRemove={async (x) => {
        const msg = `Delete ${x.name} from disk?\n\nThis removes: ${x.folders.join(', ')}`
        if (window.confirm(msg)) say(await window.api.uninstall(x.flavor, x.folders, x.linkId))
      }}
    />
  )

  const noRoot = scan && !scan.rootExists

  return (
    <div className="shell">
      <div className="titlebar">
        <Swords size={16} />
        <span>Azeroth Addon Manager</span>
      </div>

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-crest">
            <Swords size={22} />
          </div>
          <div>
            <h1>Addon Manager</h1>
            <p>Your interface, kept in order</p>
          </div>
        </div>

        <nav>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={'nav-item' + (view === id ? ' active' : '')}
              onClick={() => setView(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === 'updates' && allUpdates.length > 0 && <em className="pill">{allUpdates.length}</em>}
            </button>
          ))}
        </nav>

        <div className="flavors">
          <h2>Game Version</h2>
          <div className={'flavor active' + (installed ? '' : ' missing')}>
            <strong>{GAME.label}</strong>
            <small>
              {installed
                ? `${addons.length} addon${addons.length === 1 ? '' : 's'}`
                : 'Not found in your WoW folder'}
            </small>
          </div>
        </div>

        <button
          className="path"
          disabled={!installed}
          onClick={() => window.api.openAddons(GAME.folder)}
          title="Open AddOns folder"
        >
          <FolderOpen size={14} />
          <span>…\{GAME.folder}\Interface\AddOns</span>
        </button>
      </aside>

      <main className="content">
        {noRoot && (
          <div className="banner err">
            <CircleAlert size={16} /> World of Warcraft folder not found at {scan?.root}. Set the right
            path in Settings.
          </div>
        )}

        {(view === 'installed' || view === 'updates') && (
          <>
            <header className="page-head">
              <div>
                <h2>{view === 'installed' ? 'Installed Addons' : 'Available Updates'}</h2>
                <p>
                  {view === 'installed'
                    ? `${forFlavor.length} addon${forFlavor.length === 1 ? '' : 's'} found`
                    : `${updates.length} ready to update`}
                </p>
              </div>
              <div className="head-actions">
                <label className="search">
                  <Search size={15} />
                  <input
                    placeholder="Search addons…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <button className="btn ghost" disabled={working !== null} onClick={checkAll}>
                  {working === 'check' ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Check
                </button>
                <button
                  className="btn gold"
                  disabled={updates.length === 0 || working !== null}
                  onClick={updateAll}
                >
                  {working === 'updateAll' ? <Loader2 size={15} className="spin" /> : <Download size={15} />}{' '}
                  Update All
                </button>
              </div>
            </header>

            <div className="list">
              {list.map(card)}
              {loaded && list.length === 0 && (
                <div className="empty">
                  <Library size={34} />
                  <p>
                    {view === 'updates'
                      ? 'Everything is up to date.'
                      : query
                        ? 'No addons match your search.'
                        : 'No addons installed yet. Link one from GitHub to install it.'}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {view === 'add' && (
          <div className="panel-page">
            <header className="page-head">
              <div>
                <h2>Link an Addon</h2>
                <p>Paste a GitHub repository. We install it and keep it up to date.</p>
              </div>
            </header>

            <div className="link-card">
              <GitBranch size={26} />
              <input
                placeholder="https://github.com/owner/repository"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
              />
              <button
                className="btn gold"
                disabled={!repo.trim() || !installed || linkWorking}
                onClick={async () => {
                  setLinkWorking(true)
                  if (await doLink(flavor, repo, null)) setRepo('')
                  setLinkWorking(false)
                }}
              >
                {linkWorking ? <Loader2 size={15} className="spin" /> : <PackagePlus size={15} />} Install
              </button>
            </div>
            <p className="hint">
              Installs into Forever from the latest GitHub release, falling back to tags or the default branch.
              Downloads built for other clients (Classic, Era) are skipped.
            </p>

            {suggestions.length > 0 && (
              <>
                <h3 className="section">Found in your installed addons</h3>
                <p className="hint">These addons advertise a GitHub page. Link them to start tracking updates.</p>
                <div className="suggest">
                  {suggestions.map((a) => (
                    <div key={a.key} className="suggest-row">
                      <div>
                        <strong>{a.name}</strong>
                        <small>{a.githubHint}</small>
                      </div>
                      <button
                        className="btn ghost sm"
                        onClick={() => doLink(a.flavor, a.githubHint!, a.folder)}
                      >
                        Link
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {view === 'settings' && settings && (
          <div className="panel-page">
            <header className="page-head">
              <div>
                <h2>Settings</h2>
                <p>Game folder and update behaviour.</p>
              </div>
            </header>

            <h3 className="section">World of Warcraft folder</h3>
            <div className="link-card">
              <FolderOpen size={26} />
              <input
                value={rootDraft}
                onChange={(e) => setRootDraft(e.target.value)}
                onBlur={() => rootDraft !== settings.wowRoot && changeRoot(rootDraft)}
              />
              <button
                className="btn ghost"
                onClick={async () => {
                  const p = await window.api.pickFolder()
                  if (p) await changeRoot(p)
                }}
              >
                Browse
              </button>
            </div>
            <p className="hint">
              {installed ? `Found the ${GAME.label} client (${GAME.folder}).` : `No ${GAME.folder} folder found here.`}
            </p>

            <h3 className="section">Updates</h3>
            <div className="opt">
              <div>
                <strong>Update automatically</strong>
                <small>Install new versions in the background as soon as they are found.</small>
              </div>
              <button
                role="switch"
                aria-checked={settings.autoUpdate}
                className={'switch' + (settings.autoUpdate ? ' on' : '')}
                onClick={() => saveSettings({ autoUpdate: !settings.autoUpdate })}
              >
                <span />
              </button>
            </div>
            <div className="opt">
              <div>
                <strong>Check for updates</strong>
                <small>Runs while the app is open, and once at startup.</small>
              </div>
              <select
                value={settings.checkIntervalMin}
                onChange={(e) => saveSettings({ checkIntervalMin: Number(e.target.value) })}
              >
                {INTERVALS.map((i) => (
                  <option key={i.v} value={i.v}>
                    {i.l}
                  </option>
                ))}
              </select>
            </div>
            <div className="opt">
              <div>
                <strong>GitHub token (optional)</strong>
                <small>Raises the API limit from 60 to 5,000 requests per hour. Stored locally.</small>
              </div>
              <input
                type="password"
                placeholder="ghp_…"
                defaultValue={settings.githubToken}
                onBlur={(e) => e.target.value !== settings.githubToken && saveSettings({ githubToken: e.target.value.trim() })}
              />
            </div>
          </div>
        )}
      </main>

      {toast && (
        <div className={'toast ' + (toast.ok ? 'ok' : 'err')} onClick={() => setToast(null)}>
          {toast.ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  )
}
