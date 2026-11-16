import { useState } from 'react';
import { api } from '../../lib/api';
import { useAuth, ROLE_LABEL } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { Link } from '../../lib/router';
import { useToast } from '../../lib/toast';
import { bytes, relativeDate } from '../../lib/format';
import { Empty, ErrorState, Field, Loading, PageHead, StatusBadge, Tabs } from '../../components/ui';

/** Admin console. Every request is re-authorised on the server by permission (users.manage, artist.review, …). */
export default function Admin({ section = 'overview' }) {
  const View = { overview: Overview, users: Users, applications: Applications, uploads: Uploads, catalogue: Catalogue,
    media: Media, permissions: Permissions, health: Health }[section] || Overview;
  return <div className="page"><View /></div>;
}

function useLoad(fn, deps) {
  const state = useAsync(fn, deps);
  const guard = state.loading && !state.data ? <Loading /> : state.error ? <ErrorState error={state.error} onRetry={state.reload} /> : null;
  return { ...state, guard };
}

function Overview() {
  const { data: o, guard } = useLoad(() => api.admin.overview(), []);
  return (
    <>
      <PageHead title="Admin">What needs attention on LOOP right now.</PageHead>
      {guard || (
        <>
          <div className="stats">
            <Link className="stat" to="/admin/applications"><b>{o.pending_artist_applications}</b><span>Artist applications waiting</span></Link>
            <Link className="stat" to="/admin/uploads"><b>{o.uploads_in_review}</b><span>Uploads in review</span></Link>
            <Link className="stat" to="/admin/uploads"><b>{o.open_rights_reports}</b><span>Open rights reports</span></Link>
            <Link className="stat" to="/admin/users"><b>{o.users}</b><span>Active accounts</span></Link>
            <Link className="stat" to="/admin/users"><b>{o.artists_active}</b><span>Artists</span></Link>
            <Link className="stat" to="/admin/catalogue"><b>{o.active_songs}</b><span>Songs in the catalogue</span></Link>
            <Link className="stat" to="/admin/media"><b>{o.playable_songs}</b><span>Songs with LOOP audio</span></Link>
            <div className="stat"><b>{o.mood_requests_7d}</b><span>Mood requests, last 7 days</span></div>
          </div>
          {Number(o.pending_songs) > 0 && <p className="notice notice-warn">{o.pending_songs} songs are waiting for audio analysis and can’t be recommended yet.</p>}
        </>
      )}
    </>
  );
}

function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const { data, guard, reload } = useLoad(() => api.admin.users(term), [term]);
  async function update(u, body, done) {
    try { await api.admin.updateUser(u.id, body); toast(done); reload(); } catch (err) { toast(err.message, 'error'); }
  }
  return (
    <>
      <PageHead title="Users and roles">
        New accounts are Users. Artist access comes from an approved application. Admin access is granted only with the server-side
        <code> admin:provision</code> command, never from this console.
      </PageHead>
      <form role="search" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }} style={{ display: 'flex', gap: 8, maxWidth: 480 }}>
        <label htmlFor="user-q" className="sr-only">Find a user</label>
        <input id="user-q" className="input" type="search" placeholder="Name, username or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">Find</button>
      </form>
      {guard || (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.displayName}</strong><div className="tiny muted">@{u.username}</div></td>
                  <td>{u.email}</td>
                  <td>
                    {u.role === 'ADMIN' ? 'Admin' : (
                      <select className="select" style={{ minHeight: 34, width: 'auto' }} aria-label={`Role for ${u.username}`} value={u.role}
                        onChange={(e) => update(u, { role: e.target.value }, `${u.username} is now ${ROLE_LABEL[e.target.value]}`)}>
                        <option value="LISTENER">User</option><option value="ARTIST">Artist</option>
                      </select>
                    )}
                  </td>
                  <td>{u.isActive ? <span className="badge badge-ok">active</span> : <span className="badge badge-danger">deactivated</span>}{u.locked ? <> <span className="badge badge-warn">locked</span></> : null}</td>
                  <td>
                    {u.id !== me.id && (u.isActive
                      ? <button type="button" className="btn btn-sm btn-danger" onClick={() => update(u, { isActive: false }, `${u.username} deactivated and signed out`)}>Deactivate</button>
                      : <button type="button" className="btn btn-sm" onClick={() => update(u, { isActive: true }, `${u.username} reactivated`)}>Reactivate</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Applications() {
  const toast = useToast();
  const [status, setStatus] = useState('PENDING');
  const [notes, setNotes] = useState({});
  const { data, guard, reload } = useLoad(() => api.admin.applications(status), [status]);
  async function decide(a, action) {
    try { await api.admin.decideApplication(a.id, action, notes[a.id]); toast(action === 'APPROVE' ? `${a.stageName} is now an Artist` : 'Application rejected'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  }
  return (
    <>
      <PageHead title="Artist applications">Approving creates the artist profile and gives the account Artist access.</PageHead>
      <Tabs label="Application status" value={status} onChange={setStatus} items={[['PENDING', 'Waiting'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['ALL', 'All']]} />
      {guard || (data.length === 0 ? <Empty title="No applications here" /> : (
        <ul className="list">
          {data.map((a) => (
            <li key={a.id} className="list-item">
              <div className="list-item-main">
                <span className="title">{a.stageName} <span className="small muted">({a.artistType.toLowerCase()}, {a.countryCode})</span></span>
                <span className="small muted">{a.displayName} @{a.username} — sent {relativeDate(a.submittedAt)}</span>
                {a.bio && <span className="small">{a.bio}</span>}
                <span className="small">
                  {a.websiteUrl && <a href={a.websiteUrl} target="_blank" rel="noreferrer noopener">Website</a>}
                  {a.websiteUrl && a.proofUrl && ' — '}
                  {a.proofUrl && <a href={a.proofUrl} target="_blank" rel="noreferrer noopener">Verification link</a>}
                </span>
              </div>
              {a.status === 'PENDING' ? (
                <div className="row-actions" style={{ alignItems: 'center' }}>
                  <label className="sr-only" htmlFor={`note-${a.id}`}>Note for {a.stageName}</label>
                  <input id={`note-${a.id}`} className="input" style={{ minHeight: 34, width: 200 }} placeholder="Note (optional)" maxLength={500}
                    value={notes[a.id] || ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => decide(a, 'APPROVE')}>Approve</button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => decide(a, 'REJECT')}>Reject</button>
                </div>
              ) : <StatusBadge status={a.status} />}
            </li>
          ))}
        </ul>
      ))}
    </>
  );
}

function Uploads() {
  const toast = useToast();
  const [status, setStatus] = useState('PENDING_REVIEW');
  const { data, guard, reload } = useLoad(() => api.admin.uploads(status), [status]);
  const reports = useLoad(() => api.admin.reports('OPEN'), []);
  async function act(fn, done) {
    try { await fn(); toast(done); reload(); } catch (err) { toast(err.message, 'error'); }
  }
  return (
    <>
      <PageHead title="Upload moderation">Recordings move from quarantine to scan, review and publication. Nothing is playable before it is published.</PageHead>
      <Tabs label="Upload status" value={status} onChange={setStatus}
        items={[['QUARANTINED', 'To scan'], ['PENDING_REVIEW', 'To review'], ['APPROVED', 'To publish'], ['PUBLISHED', 'Published'], ['ALL', 'All']]} />
      {guard || (data.length === 0 ? <Empty title="No uploads here" /> : (
        <ul className="list">
          {data.map((u) => (
            <li key={u.id} className="list-item">
              <div className="list-item-main">
                <span className="title">{u.title}{u.versionLabel ? ` (${u.versionLabel})` : ''}</span>
                <span className="small muted">{u.artistName} — @{u.username} — {u.fileSize ? bytes(u.fileSize) : 'no file yet'} — sent {relativeDate(u.createdAt)}</span>
                <span className="small">Composition {u.compositionRights.toLowerCase()}, recording {u.recordingRights.toLowerCase()}
                  {u.evidenceRef && <> — <a href={u.evidenceRef} target="_blank" rel="noreferrer noopener">evidence</a></>}</span>
                {u.scanDetail && <span className="tiny muted">Scan: {u.scanDetail}</span>}
              </div>
              <div className="row-actions" style={{ alignItems: 'center' }}>
                <StatusBadge status={u.status} />
                {['QUARANTINED', 'PROCESSING_FAILED'].includes(u.status) && <button type="button" className="btn btn-sm" onClick={() => act(() => api.admin.scanUpload(u.id), 'Scan finished')}>Scan</button>}
                {u.status === 'PENDING_REVIEW' && <>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => act(() => api.admin.decideUpload(u.id, 'APPROVE'), 'Approved — publish it when ready')}>Approve</button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => act(() => api.admin.decideUpload(u.id, 'REJECT'), 'Upload rejected')}>Reject</button>
                </>}
                {u.status === 'APPROVED' && <button type="button" className="btn btn-sm btn-primary" onClick={() => act(() => api.admin.publishUpload(u.id), 'Published on LOOP')}>Publish</button>}
              </div>
            </li>
          ))}
        </ul>
      ))}
      <section className="section">
        <h2 className="h3">Open rights reports</h2>
        {reports.guard || (reports.data.length === 0 ? <p className="muted">No open reports.</p> : (
          <ul className="list">
            {reports.data.map((r) => (
              <li key={r.id} className="list-item">
                <div className="list-item-main">
                  <span className="title">{r.title} <span className="small muted">by {r.artistName}</span></span>
                  <span className="small">{r.reportType.replace(/_/g, ' ').toLowerCase()}: {r.details}</span>
                  <span className="tiny muted">Reported by @{r.reporter} {relativeDate(r.createdAt)}</span>
                </div>
                <div className="row-actions">
                  <button type="button" className="btn btn-sm" onClick={async () => { try { await api.admin.resolveReport(r.id, 'RESOLVED'); toast('Report resolved'); reports.reload(); } catch (err) { toast(err.message, 'error'); } }}>Resolve</button>
                  <button type="button" className="btn btn-sm btn-quiet" onClick={async () => { try { await api.admin.resolveReport(r.id, 'DISMISSED'); toast('Report dismissed'); reports.reload(); } catch (err) { toast(err.message, 'error'); } }}>Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        ))}
      </section>
    </>
  );
}

const FEATURE_KEYS = [['energy', 'Energy'], ['valence', 'Positivity'], ['danceability', 'Danceability'], ['acousticness', 'Acousticness'], ['instrumentalness', 'Instrumentalness'], ['speechiness', 'Speechiness']];

function Catalogue() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const { data, guard, reload } = useLoad(() => api.admin.songs({ q: term, page, pageSize: 25 }), [term, page]);
  const refs = useAsync(() => api.admin.references(), []);
  const [adding, setAdding] = useState(false);
  async function setStatus(s, status) {
    try { await api.admin.updateSong(s.id, { status }); toast(status === 'HIDDEN' ? `“${s.title}” hidden` : `“${s.title}” is active`); reload(); }
    catch (err) { toast(err.message, 'error'); }
  }
  return (
    <>
      <PageHead title="Catalogue" actions={<button type="button" className="btn btn-primary" onClick={() => setAdding((v) => !v)}>{adding ? 'Close form' : 'Add a song'}</button>}>
        Songs, their moods and their sound. Hidden songs are never recommended.
      </PageHead>
      {adding && refs.data && <SongForm refs={refs.data} onDone={() => { setAdding(false); reload(); }} />}
      <form role="search" onSubmit={(e) => { e.preventDefault(); setPage(1); setTerm(q.trim()); }} style={{ display: 'flex', gap: 8, maxWidth: 480 }}>
        <label htmlFor="song-q" className="sr-only">Find a song</label>
        <input id="song-q" className="input" type="search" placeholder="Title or artist" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">Find</button>
      </form>
      {guard || (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Song</th><th>Moods</th><th>Audio</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.songs.map((s) => (
                  <tr key={s.id}>
                    <td><Link to={`/song/${s.id}`}><strong>{s.title}</strong></Link><div className="tiny muted">{s.artist.name} — #{s.id}</div></td>
                    <td className="small">{s.moods.join(', ') || <span className="muted">none</span>}</td>
                    <td className="small">{s.playback?.playable ? 'LOOP audio' : <span className="muted">none</span>}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td>{s.status === 'ACTIVE'
                      ? <button type="button" className="btn btn-sm" onClick={() => setStatus(s, 'HIDDEN')}>Hide</button>
                      : s.status === 'HIDDEN' ? <button type="button" className="btn btn-sm" onClick={() => setStatus(s, 'ACTIVE')}>Activate</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="composer-actions">
            <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="small muted">Page {page} of {Math.max(1, Math.ceil(data.total / 25))} — {data.total} songs</span>
            <button type="button" className="btn btn-sm" disabled={page * 25 >= data.total} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </>
      )}
    </>
  );
}

function SongForm({ refs, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', artistId: '', genreId: '', languageId: '', durationSec: '', releaseYear: String(new Date().getFullYear()),
    energy: '0.5', valence: '0.5', danceability: '0.5', acousticness: '0.5', instrumentalness: '0.2', speechiness: '0.05', tempo_bpm: '110' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const features = Object.fromEntries([...FEATURE_KEYS.map(([k]) => k), 'tempo_bpm'].map((k) => [k, Number(f[k])]));
      const s = await api.admin.createSong({ title: f.title.trim(), artistId: Number(f.artistId), genreId: Number(f.genreId),
        ...(f.languageId ? { languageId: Number(f.languageId) } : {}), durationSec: Number(f.durationSec), releaseYear: Number(f.releaseYear), features });
      toast(`“${s.title}” added and analysed`);
      onDone();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  }
  return (
    <form className="panel form" onSubmit={submit}>
      <h2 className="h3">Add a song</h2>
      <div className="form-row">
        <Field label="Title"><input className="input" required maxLength={150} value={f.title} onChange={set('title')} /></Field>
        <Field label="Artist"><select className="select" required value={f.artistId} onChange={set('artistId')}><option value="">Choose…</option>{refs.artists.map((a) => <option key={a.id} value={a.id}>{a.name}{a.disambiguation ? ` (${a.disambiguation})` : ''}</option>)}</select></Field>
      </div>
      <div className="form-row">
        <Field label="Genre"><select className="select" required value={f.genreId} onChange={set('genreId')}><option value="">Choose…</option>{refs.genres.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        <Field label="Language"><select className="select" value={f.languageId} onChange={set('languageId')}><option value="">Instrumental or none</option>{refs.languages.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="Duration (s)"><input className="input" required inputMode="numeric" value={f.durationSec} onChange={set('durationSec')} /></Field>
        <Field label="Year"><input className="input" required inputMode="numeric" value={f.releaseYear} onChange={set('releaseYear')} /></Field>
      </div>
      <p className="small muted">Audio features (0 to 1) decide which moods the song is tagged with and how it is recommended.</p>
      <div className="form-row">
        {FEATURE_KEYS.map(([k, label]) => <Field key={k} label={label}><input className="input" type="number" min="0" max="1" step="0.01" value={f[k]} onChange={set(k)} /></Field>)}
        <Field label="Tempo (BPM)"><input className="input" type="number" min="40" max="220" value={f.tempo_bpm} onChange={set('tempo_bpm')} /></Field>
      </div>
      <div><button className="btn btn-primary" disabled={busy}>Add song</button></div>
    </form>
  );
}

function Media() {
  const toast = useToast();
  const { data, guard, reload } = useLoad(() => api.admin.media(), []);
  const [form, setForm] = useState({ songId: '', fileName: '', rights: 'PERMITTED', attribution: '' });
  async function register(e) {
    e.preventDefault();
    try {
      await api.admin.registerMedia(Number(form.songId), { fileName: form.fileName, rights: form.rights, ...(form.attribution ? { attribution: form.attribution } : {}) });
      toast('Recording registered. The song is now playable.');
      setForm({ songId: '', fileName: '', rights: 'PERMITTED', attribution: '' });
      reload();
    } catch (err) { toast(err.message, 'error'); }
  }
  async function check() {
    try { const r = await api.admin.checkMedia(); toast(`${r.available} available, ${r.unavailable} missing`); reload(); } catch (err) { toast(err.message, 'error'); }
  }
  if (guard) return <><PageHead title="LOOP media" />{guard}</>;
  const disabled = data.storage.state === 'disabled';
  return (
    <>
      <PageHead title="LOOP media">Recordings LOOP is authorised to stream. A song is playable only when one of these files is registered to it.</PageHead>
      {disabled ? (
        <div className="notice notice-warn"><strong>Media storage is off on this deployment.</strong>
          <span>Serverless hosting has no persistent disk, so audio can’t be stored or streamed here. Run LOOP on a host with a persistent media folder to enable playback.</span></div>
      ) : <p className="notice">{data.storage.detail || 'Media folder ready.'}</p>}
      {data.summary.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Source</th><th>Availability</th><th>Files</th></tr></thead>
          <tbody>{data.summary.map((r) => <tr key={`${r.source}-${r.availability}`}><td>{r.source === 'ARTIST_UPLOAD' ? 'Artist uploads' : 'LOOP library'}</td><td>{r.availability.toLowerCase()}</td><td className="num">{r.n}</td></tr>)}</tbody>
        </table></div>
      )}
      {!disabled && (
        <>
          <div><button type="button" className="btn" onClick={check}>Check all registered files</button></div>
          <form className="panel form" onSubmit={register}>
            <h2 className="h3">Register a recording</h2>
            <p className="small muted">Place the file in the server’s media folder first. Only register recordings LOOP owns or is licensed to stream.</p>
            <div className="form-row">
              <Field label="Song ID"><input className="input" required inputMode="numeric" value={form.songId} onChange={(e) => setForm({ ...form, songId: e.target.value })} /></Field>
              <Field label="File"><select className="select" required value={form.fileName} onChange={(e) => setForm({ ...form, fileName: e.target.value })}>
                <option value="">Choose…</option>{data.localFiles.map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
              <Field label="Rights"><select className="select" value={form.rights} onChange={(e) => setForm({ ...form, rights: e.target.value })}>
                <option value="PERMITTED">Owned or licensed</option><option value="ATTRIBUTION_REQUIRED">Licensed with attribution</option></select></Field>
            </div>
            {form.rights === 'ATTRIBUTION_REQUIRED' && <Field label="Attribution"><input className="input" maxLength={200} value={form.attribution} onChange={(e) => setForm({ ...form, attribution: e.target.value })} /></Field>}
            <div><button className="btn btn-primary">Register recording</button></div>
          </form>
        </>
      )}
    </>
  );
}

function Permissions() {
  const { data, guard } = useLoad(() => api.admin.permissions(), []);
  return (
    <>
      <PageHead title="Permissions">What each role can do. The API checks these on every request; the interface only follows them.</PageHead>
      {guard || (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Permission</th>{data.roles.map((r) => <th key={r.code}>{ROLE_LABEL[r.code] || r.name}</th>)}</tr></thead>
            <tbody>
              {data.permissions.map((p) => (
                <tr key={p.code}>
                  <td><strong>{p.description}</strong><div className="tiny muted">{p.code}</div></td>
                  {data.roles.map((r) => <td key={r.code}>{r.permissions.includes(p.code) ? <span className="badge badge-ok">yes</span> : <span className="muted">—</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Health() {
  const { data: h, guard, reload } = useLoad(() => api.admin.health(), []);
  return (
    <>
      <PageHead title="System health" actions={<button type="button" className="btn btn-sm" onClick={reload}>Refresh</button>}>Database, catalogue and storage checks.</PageHead>
      {guard || (
        <>
          <div className="stats">
            <div className="stat"><b>MySQL {String(h.server.version).split('-')[0]}</b><span>{h.server.tables} tables, {Math.round(h.server.sizeKb / 1024)} MB</span></div>
            <div className="stat"><b>{h.catalogue.activeSongs}</b><span>Active songs</span></div>
            <div className="stat"><b>{h.catalogue.playableSongs}</b><span>Playable in LOOP</span></div>
            <div className="stat"><b>{h.sessions.activeSignIns}</b><span>Active sign-ins</span></div>
            <div className="stat"><b>{h.mediaStorage.state}</b><span>Media storage</span></div>
          </div>
          <section className="section">
            <h2 className="h3">Data integrity</h2>
            <ul className="list">
              {h.integrity.map((c) => (
                <li key={c.label} className="list-item"><span>{c.label}</span>{c.ok ? <span className="badge badge-ok">ok</span> : <span className="badge badge-danger">{c.violations} rows</span>}</li>
              ))}
            </ul>
          </section>
          {h.failedJobs.length > 0 && (
            <section className="section">
              <h2 className="h3">Failed background jobs</h2>
              <ul className="list">{h.failedJobs.map((j) => <li key={j.id} className="list-item"><span>{j.type} #{j.id}</span><span className="small muted">{j.error}</span></li>)}</ul>
            </section>
          )}
          <section className="section">
            <h2 className="h3">Recent audit log</h2>
            <ul className="list">{h.recentAudit.map((a) => (
              <li key={a.id} className="list-item"><span>{a.action.replace(/_/g, ' ').toLowerCase()} — {a.entityType} {a.entityId}</span><span className="small muted">{a.actor || 'system'}, {relativeDate(a.createdAt)}</span></li>
            ))}</ul>
          </section>
        </>
      )}
    </>
  );
}
