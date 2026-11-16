import { useState } from 'react';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { Link, useQuery, useRouter } from '../lib/router';
import { relativeDate, totalDuration, plural } from '../lib/format';
import { useToast } from '../lib/toast';
import SongRow from '../components/SongRow';
import { Empty, ErrorState, Loading, PageHead, Tabs } from '../components/ui';

const TABS = [['playlists', 'Saved and playlists'], ['liked', 'Liked songs'], ['moods', 'Recent moods'], ['hidden', 'Not interested']];

export default function Library() {
  const query = useQuery();
  const { navigate } = useRouter();
  const tab = TABS.some(([id]) => id === query.get('tab')) ? query.get('tab') : 'playlists';
  return (
    <div className="page page-narrow">
      <PageHead title="Library">Your saved mixes, playlists, liked songs and the moods you asked for.</PageHead>
      <Tabs label="Library sections" value={tab} items={TABS} onChange={(id) => navigate(`/library?tab=${id}`, { replace: true })} />
      {tab === 'playlists' && <Playlists />}
      {tab === 'liked' && <Liked />}
      {tab === 'moods' && <Moods />}
      {tab === 'hidden' && <Hidden />}
    </div>
  );
}

function Playlists() {
  const { data, error, loading, reload } = useAsync(() => api.playlists(), []);
  const [name, setName] = useState('');
  const toast = useToast();
  async function create(e) {
    e.preventDefault();
    try { await api.createPlaylist({ name: name.trim() }); setName(''); toast('Playlist created'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  }
  if (loading && !data) return <Loading label="Loading playlists" />;
  return (
    <section className="section">
      <ErrorState error={error} onRetry={reload} />
      {data && data.length === 0 && (
        <Empty title="Nothing saved yet" action={<Link className="btn btn-primary" to="/discover">Find music for a mood</Link>}>
          Save a recommendation list with “Save this mix”, or add songs to a playlist with the + button.
        </Empty>
      )}
      {data && data.length > 0 && (
        <ul className="list">
          {data.map((p) => (
            <li key={p.id} className="list-item">
              <div className="list-item-main">
                <Link className="title" to={`/playlist/${p.id}`}>{p.name}</Link>
                <span className="small muted">{p.kind === 'SAVED_MIX' ? 'Saved mix' : 'Playlist'} — {plural(p.songCount, 'song')}, {totalDuration(p.totalDurationSec)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="form" onSubmit={create} style={{ maxWidth: 420 }}>
        <label className="field"><span>New playlist</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Late-night drive" />
            <button className="btn" type="submit" disabled={!name.trim()}>Create</button>
          </div>
        </label>
      </form>
    </section>
  );
}

function Liked() {
  const { data, error, loading, reload } = useAsync(() => api.likes(), []);
  if (loading && !data) return <Loading label="Loading liked songs" />;
  return (
    <section className="section">
      <ErrorState error={error} onRetry={reload} />
      {data && data.length === 0 && <Empty title="No liked songs yet">Tap the heart on any song. Likes also teach LOOP what you enjoy.</Empty>}
      {data && data.length > 0 && <ul className="songs">{data.map((s) => <SongRow key={s.id} song={s} origin="LIBRARY" />)}</ul>}
    </section>
  );
}

function Moods() {
  const { data, error, loading, reload } = useAsync(() => api.moodHistory(30), []);
  if (loading && !data) return <Loading label="Loading recent moods" />;
  return (
    <section className="section">
      <ErrorState error={error} onRetry={reload} />
      {data && data.length === 0 && <Empty title="No mood requests yet" action={<Link className="btn btn-primary" to="/discover">Describe a mood</Link>} />}
      {data && data.length > 0 && (
        <ul className="list">
          {data.map((b) => (
            <li key={b.id} className="list-item">
              <div className="list-item-main">
                <Link className="title" to={`/discover?batch=${b.id}`}>{b.inputText || b.label}</Link>
                <span className="small muted">{b.moods.map((m) => m.name).join(', ')} — {relativeDate(b.createdAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Hidden() {
  const { data, error, loading, reload } = useAsync(() => api.dismissals(), []);
  if (loading && !data) return <Loading label="Loading" />;
  return (
    <section className="section">
      <p className="muted small">Songs you marked “Not interested” are left out of every recommendation. Undo to allow them again.</p>
      <ErrorState error={error} onRetry={reload} />
      {data && data.length === 0 && <Empty title="Nothing hidden" />}
      {data && data.length > 0 && <ul className="songs">{data.map((s) => <SongRow key={s.id} song={{ ...s, dismissed: true }} origin="LIBRARY" dismissible showWhy={false} />)}</ul>}
    </section>
  );
}
