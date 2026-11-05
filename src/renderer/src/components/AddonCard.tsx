import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  CircleDashed,
  Download,
  ExternalLink,
  GitBranch,
  Link2,
  Loader2,
  Package,
  RefreshCw,
  Trash2,
  Unlink
} from 'lucide-react'
import type { AddonView, Source } from '../../../shared/types'
import { ago } from '../data'

const ICON_CDN = 'https://wow.zamimg.com/images/wow/icons/large/'

interface Props {
  addon: AddonView
  busy: boolean
  onUpdate: (a: AddonView) => void
  onCheck: (a: AddonView) => void
  onLink: (a: AddonView, repo: string) => Promise<boolean>
  onUnlink: (a: AddonView) => void
  onSource: (a: AddonView, s: Source) => void
  onRemove: (a: AddonView) => void
}

function Icon({ addon }: { addon: AddonView }): React.JSX.Element {
  const sources: string[] = []
  if (addon.wowIcon) sources.push(`${ICON_CDN}${addon.wowIcon}.jpg`)
  const owner = addon.repo?.split('/')[0] ?? addon.githubHint?.split('/')[0]
  if (owner) sources.push(`https://github.com/${owner}.png?size=96`)
  const [i, setI] = useState(0)
  return (
    <div className="icon-frame">
      {i < sources.length ? (
        <img src={sources[i]} alt="" onError={() => setI(i + 1)} />
      ) : (
        <Package size={26} />
      )}
    </div>
  )
}

export default function AddonCard({
  addon,
  busy,
  onUpdate,
  onCheck,
  onLink,
  onUnlink,
  onSource,
  onRemove
}: Props): React.JSX.Element {
  const [linking, setLinking] = useState(false)
  const [repo, setRepo] = useState(addon.githubHint ?? '')
  const [working, setWorking] = useState(false)
  const spin = <Loader2 size={14} className="spin" />

  const installed = addon.installedTag ?? addon.version
  const modules = addon.folders.length - 1

  const submitLink = async (): Promise<void> => {
    setWorking(true)
    const ok = await onLink(addon, repo)
    setWorking(false)
    if (ok) setLinking(false)
  }

  return (
    <article className={'card ' + addon.status}>
      <Icon addon={addon} />

      <div className="card-main">
        <div className="card-title">
          <h3>{addon.name}</h3>
          {addon.author && <span className="author">by {addon.author}</span>}
        </div>
        {addon.notes && <p>{addon.notes}</p>}
        <div className="meta">
          {addon.repo ? (
            <button className="repo" onClick={() => window.api.openExternal(`https://github.com/${addon.repo}`)}>
              <GitBranch size={12} /> {addon.repo} <ExternalLink size={10} />
            </button>
          ) : (
            <span>{addon.folder}</span>
          )}
          {modules > 0 && <span>+{modules} module{modules === 1 ? '' : 's'}</span>}
          {addon.linkId != null && (
            <label className="src" title="Where updates come from">
              Source
              <select
                value={addon.source}
                disabled={busy}
                onChange={(e) => onSource(addon, e.target.value as Source)}
              >
                <option value="auto">Auto</option>
                <option value="releases">Releases</option>
                <option value="tags">Tags</option>
                <option value="code">Latest code</option>
              </select>
            </label>
          )}
          {addon.lastChecked && <span>Checked {ago(addon.lastChecked)}</span>}
          {addon.latestPublished && (
            <span>Released {new Date(addon.latestPublished).toLocaleDateString()}</span>
          )}
        </div>

        {linking && (
          <div className="link-row">
            <input
              autoFocus
              placeholder="https://github.com/owner/repository"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && repo.trim() && submitLink()}
            />
            <button className="btn gold sm" disabled={!repo.trim() || working} onClick={submitLink}>
              {working ? spin : <Link2 size={14} />} Link
            </button>
            <button className="btn ghost sm" onClick={() => setLinking(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="card-side">
        {addon.linkId != null && (
          <div className="versions">
            <span className="ver">{installed || '—'}</span>
            {addon.status === 'update' && (
              <>
                <span className="arrow">→</span>
                <span className="ver new">{addon.latestTag}</span>
              </>
            )}
          </div>
        )}

        {addon.status === 'update' && (
          <button className="btn gold sm" disabled={busy} onClick={() => onUpdate(addon)}>
            {busy ? spin : <Download size={14} />} Update
          </button>
        )}
        {addon.status === 'missing' && (
          <button className="btn gold sm" disabled={busy} onClick={() => onUpdate(addon)}>
            {busy ? spin : <Download size={14} />} Install
          </button>
        )}
        {addon.status === 'current' && (
          <span className="badge ok">
            <Check size={13} /> Up to date
          </span>
        )}
        {addon.status === 'unchecked' && (
          <button className="btn ghost sm" disabled={busy} onClick={() => onCheck(addon)}>
            {busy ? spin : <RefreshCw size={14} />} Check
          </button>
        )}
        {addon.status === 'error' && (
          <>
            <span className="badge err" title={addon.error ?? ''}>
              <AlertTriangle size={13} /> {(addon.error ?? 'Error').slice(0, 34)}
            </span>
            <button className="btn ghost sm" disabled={busy} onClick={() => onCheck(addon)}>
              {busy ? spin : <RefreshCw size={14} />} Retry
            </button>
          </>
        )}
        {addon.status === 'unlinked' && !linking && (
          <button className="btn ghost sm" onClick={() => setLinking(true)}>
            {addon.githubHint ? <Link2 size={14} /> : <CircleDashed size={14} />}
            {addon.githubHint ? 'Link GitHub' : 'Link'}
          </button>
        )}

        {addon.linkId != null && (
          <button className="icon-btn" title="Unlink (keep files)" onClick={() => onUnlink(addon)}>
            <Unlink size={15} />
          </button>
        )}
        <button className="icon-btn" title="Uninstall" onClick={() => onRemove(addon)}>
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  )
}
