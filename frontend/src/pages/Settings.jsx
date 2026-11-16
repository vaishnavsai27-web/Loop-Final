import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth, ROLE_LABEL } from '../lib/auth';
import { useAsync } from '../lib/useAsync';
import { Link, useQuery, useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { deviceLabel, relativeDate } from '../lib/format';
import { Dialog, ErrorState, Field, Loading, PageHead, StatusBadge, Tabs } from '../components/ui';

const SECTIONS = [['profile', 'Profile'], ['preferences', 'Preferences'], ['security', 'Sign-in and security'], ['artist', 'Artist access'], ['account', 'Account']];

export default function Settings({ section = 'profile' }) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const items = SECTIONS.filter(([id]) => id !== 'artist' || user.role !== 'ADMIN');
  const current = items.some(([id]) => id === section) ? section : 'profile';
  return (
    <div className="page page-narrow">
      <PageHead title="Settings" />
      <Tabs label="Settings sections" value={current} items={items} onChange={(id) => navigate(id === 'profile' ? '/settings' : `/settings/${id}`)} />
      {current === 'profile' && <Profile />}
      {current === 'preferences' && <Preferences />}
      {current === 'security' && <Security />}
      {current === 'artist' && <ArtistAccess />}
      {current === 'account' && <Account />}
    </div>
  );
}

function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ displayName: user.displayName, contentFilter: user.contentFilter || 'OFF' });
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try { const p = await api.updateSettings({ displayName: form.displayName.trim(), contentFilter: form.contentFilter }); setUser((u) => ({ ...u, ...p })); toast('Profile saved'); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  }
  return (
    <form className="form section" onSubmit={save} style={{ maxWidth: 480 }}>
      <p className="muted small">Signed in as @{user.username} ({user.email}). Role: {ROLE_LABEL[user.role]}.</p>
      <Field label="Display name"><input className="input" maxLength={60} required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
      <Field label="Explicit content">
        <select className="select" value={form.contentFilter} onChange={(e) => setForm({ ...form, contentFilter: e.target.value })}>
          <option value="OFF">Show everything</option>
          <option value="NO_EXPLICIT">Hide explicit songs</option>
          <option value="FAMILY">Family friendly only</option>
        </select>
      </Field>
      <div><button className="btn btn-primary" disabled={busy || !form.displayName.trim()}>Save profile</button></div>
    </form>
  );
}

const LIMITS = { languageIds: 5, genreIds: 6, moodIds: 5, contextCodes: 4, artistIds: 8 };

function Preferences() {
  const query = useQuery();
  const { navigate } = useRouter();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.preferences(), []);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    const c = data.current || {};
    setForm({ languageIds: c.languageIds || [], genreIds: c.genreIds || [], moodIds: c.moodIds || [], contextCodes: c.contextCodes || [],
      artistIds: c.artistIds || [], regionCode: c.regionCode || '', listeningHabit: c.listeningHabit || 'MIXED' });
  }, [data]);
  if (loading && !data) return <Loading label="Loading preferences" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!form) return null;

  const toggle = (key, value) => setForm((f) => {
    const list = f[key];
    if (list.includes(value)) return { ...f, [key]: list.filter((x) => x !== value) };
    if (list.length >= LIMITS[key]) return f;
    return { ...f, [key]: [...list, value] };
  });
  const group = (key, label, options, valueOf, nameOf, hint) => (
    <fieldset className="composer-group" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ fontWeight: 600, fontSize: 'var(--t-sm)', marginBottom: 8 }}>{label} <span className="muted" style={{ fontWeight: 400 }}>— {hint || `up to ${LIMITS[key]}`}</span></legend>
      <div className="chips">
        {options.map((o) => {
          const v = valueOf(o);
          const on = form[key].includes(v);
          return <button key={v} type="button" className="chip" style={o.color ? { '--c': o.color } : undefined} aria-pressed={on}
            disabled={!on && form[key].length >= LIMITS[key]} onClick={() => toggle(key, v)}>{o.color && <span className="dot" />}{nameOf(o)}</button>;
        })}
      </div>
    </fieldset>
  );

  async function save(e) {
    e.preventDefault();
    if (!form.languageIds.length) { toast('Choose at least one language.', 'error'); return; }
    setBusy(true);
    try {
      await api.savePreferences({ ...form, regionCode: form.regionCode || undefined });
      toast('Preferences saved. Recommendations will use them right away.');
      if (query.get('welcome')) navigate('/discover');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <form className="form section" onSubmit={save}>
      {query.get('welcome') && (
        <div className="notice notice-ok">
          <strong>Welcome to LOOP.</strong>
          <span>Tell LOOP a little about what you listen to. You can change this any time, or <Link to="/discover">skip to Discover</Link>.</span>
        </div>
      )}
      {group('languageIds', 'Languages', data.languages, (l) => l.id, (l) => l.name, 'at least 1, up to 5, in order of preference')}
      {group('moodIds', 'Moods you often want', data.moods, (m) => m.id, (m) => m.name)}
      {group('genreIds', 'Genres', data.genres, (g) => g.id, (g) => g.name)}
      {group('contextCodes', 'When you listen', data.contexts, (c) => c.code, (c) => c.name)}
      {data.artists.length > 0 && group('artistIds', 'Artists you like', data.artists, (a) => a.id, (a) => a.name)}
      <div className="form-row">
        <Field label="Region">
          <select className="select" value={form.regionCode} onChange={(e) => setForm({ ...form, regionCode: e.target.value })}>
            <option value="">Not set</option>
            {data.regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="How you listen">
          <select className="select" value={form.listeningHabit} onChange={(e) => setForm({ ...form, listeningHabit: e.target.value })}>
            <option value="MIXED">A bit of both</option>
            <option value="ACTIVE">Mostly focused listening</option>
            <option value="BACKGROUND">Mostly in the background</option>
          </select>
        </Field>
      </div>
      <div><button className="btn btn-primary" disabled={busy}>Save preferences</button></div>
    </form>
  );
}

function Security() {
  const toast = useToast();
  const { navigate } = useRouter();
  const { setUser } = useAuth();
  const sessions = useAsync(() => api.sessions(), []);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  async function change(e) {
    e.preventDefault();
    if (pw.next !== pw.confirm) { toast('The new passwords don’t match.', 'error'); return; }
    setBusy(true);
    try { const r = await api.changePassword(pw.current, pw.next); setPw({ current: '', next: '', confirm: '' }); toast(`Password changed. ${r.otherSessionsRevoked} other sign-ins were ended.`); sessions.reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  }
  async function revoke(id) {
    try { await api.revokeSession(id); toast('Signed out on that device'); sessions.reload(); } catch (err) { toast(err.message, 'error'); }
  }
  async function everywhere() {
    try { await api.logoutAll(); setUser(null); navigate('/login?signedOut=1', { replace: true }); } catch (err) { toast(err.message, 'error'); }
  }
  const list = Array.isArray(sessions.data) ? sessions.data : sessions.data?.sessions || [];
  return (
    <div className="section">
      <form className="form" onSubmit={change} style={{ maxWidth: 480 }}>
        <h2 className="h3">Change password</h2>
        <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="New password" hint="8+ characters with a letter and a number"><input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <Field label="Confirm new password"><input className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
        <div><button className="btn btn-primary" disabled={busy || !pw.current || !pw.next}>Change password</button></div>
      </form>
      <div className="section">
        <div className="section-head"><h2 className="h3">Where you’re signed in</h2><button type="button" className="btn btn-sm" onClick={everywhere}>Sign out everywhere</button></div>
        {sessions.loading && !sessions.data && <Loading label="Loading sign-ins" />}
        <ErrorState error={sessions.error} onRetry={sessions.reload} />
        <ul className="list">
          {list.map((s) => (
            <li key={s.id} className="list-item">
              <div className="list-item-main">
                <span className="title">{deviceLabel(s.userAgent)}{s.current && <> <span className="badge badge-action">This device</span></>}</span>
                <span className="small muted">Last active {relativeDate(s.lastSeenAt || s.createdAt)}</span>
              </div>
              {!s.current && <button type="button" className="btn btn-sm" onClick={() => revoke(s.id)}>Sign out</button>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ArtistAccess() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.artistMe(), []);
  const [form, setForm] = useState({ stageName: '', artistType: 'SOLO', countryCode: 'IN', bio: '', websiteUrl: '', proofUrl: '' });
  const [busy, setBusy] = useState(false);
  if (user.role === 'ARTIST') {
    return <div className="notice notice-ok"><strong>Your Artist access is active.</strong><span>Manage your profile and recordings in the <Link to="/studio">Artist studio</Link>.</span></div>;
  }
  if (loading && !data) return <Loading label="Loading" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const pending = data.applications.find((a) => a.status === 'PENDING');
  async function apply(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => String(v).trim() !== ''));
      await api.applyArtist(body);
      toast('Application sent for review');
      reload();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="section">
      <p className="muted" style={{ maxWidth: 'var(--measure)' }}>
        Artists can publish their own original or properly licensed recordings on LOOP. An Admin reviews every application,
        and every recording is checked before anyone can hear it.
      </p>
      {data.applications.length > 0 && (
        <ul className="list">
          {data.applications.map((a) => (
            <li key={a.id} className="list-item">
              <div className="list-item-main"><span className="title">{a.stageName}</span><span className="small muted">Sent {relativeDate(a.submittedAt)}{a.reviewNote ? ` — “${a.reviewNote}”` : ''}</span></div>
              <StatusBadge status={a.status} />
            </li>
          ))}
        </ul>
      )}
      {pending ? <p className="notice">Your application is waiting for an Admin. You’ll get Artist access as soon as it’s approved.</p> : (
        <form className="form" onSubmit={apply} style={{ maxWidth: 560 }}>
          <h2 className="h3">Apply for Artist access</h2>
          <div className="form-row">
            <Field label="Artist or stage name"><input className="input" required maxLength={100} value={form.stageName} onChange={(e) => setForm({ ...form, stageName: e.target.value })} /></Field>
            <Field label="You are">
              <select className="select" value={form.artistType} onChange={(e) => setForm({ ...form, artistType: e.target.value })}>
                <option value="SOLO">A solo artist</option><option value="GROUP">A band or group</option><option value="COMPOSER">A composer</option><option value="ORCHESTRA">An ensemble or orchestra</option>
              </select>
            </Field>
          </div>
          <Field label="Country" hint="two-letter code"><input className="input" maxLength={2} value={form.countryCode} onChange={(e) => setForm({ ...form, countryCode: e.target.value.toUpperCase() })} /></Field>
          <Field label="Short bio" hint="optional"><textarea className="textarea" maxLength={400} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></Field>
          <Field label="Official website" hint="optional, https://"><input className="input" type="url" value={form.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} /></Field>
          <Field label="Link that shows this is you" hint="optional, https:// — no identity documents"><input className="input" type="url" value={form.proofUrl} onChange={(e) => setForm({ ...form, proofUrl: e.target.value })} /></Field>
          <div><button className="btn btn-primary" disabled={busy || !form.stageName.trim()}>Send application</button></div>
        </form>
      )}
    </div>
  );
}

function Account() {
  const { setUser } = useAuth();
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  async function remove() {
    try { await api.deleteAccount(password); setUser(null); navigate('/', { replace: true }); }
    catch (err) { setError(err); }
  }
  return (
    <div className="section">
      <h2 className="h3">Delete account</h2>
      <p className="muted" style={{ maxWidth: 'var(--measure)' }}>Deleting your account removes your profile, likes, playlists, listening history and preferences. This can’t be undone.</p>
      <div><button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>Delete my account</button></div>
      <Dialog open={open} onClose={() => { setOpen(false); setError(null); }} title="Delete your LOOP account?"
        actions={<><button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Keep my account</button><button type="button" className="btn btn-danger" disabled={!password} onClick={remove}>Delete account</button></>}>
        <ErrorState error={error} />
        <Field label="Enter your password to confirm"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}
