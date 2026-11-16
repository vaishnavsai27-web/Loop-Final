import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { Link } from '../lib/router';
import { cover } from '../lib/mood';
import { duration } from '../lib/format';
import SongRow from '../components/SongRow';
import { ErrorState, Loading, Meter } from '../components/ui';

export default function Song({ id }) {
  const { data: s, error, loading, reload } = useAsync(() => api.song(id), [id]);
  if (loading && !s) return <Loading label="Loading song" />;
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (!s) return null;
  const f = s.features;
  return (
    <div className="page page-narrow">
      <header style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--s5)', alignItems: 'end' }}>
        <div className="cover" style={{ width: 120, height: 120, borderRadius: 14, background: cover(s.cover) }} />
        <div style={{ display: 'grid', gap: 6 }}>
          <h1 className="h1" style={{ fontSize: 'var(--t-2xl)' }}>{s.title}{s.version ? ` (${s.version})` : ''}</h1>
          <p className="muted">
            <Link to={`/artist/${s.artist.id}`}>{s.artist.name}</Link>
            {s.album && <> — <Link to={`/album/${s.album.id}`}>{s.album.title}</Link></>}
            {s.releaseYear ? `, ${s.releaseYear}` : ''}
          </p>
          <p className="small muted">{[s.language?.name, s.genre?.name, duration(s.durationSec)].filter(Boolean).join(', ')}</p>
        </div>
      </header>
      <ul className="songs"><SongRow song={s} origin="SEARCH" showWhy={false} /></ul>
      {s.moodsDetailed?.length > 0 && (
        <section className="section" aria-labelledby="song-moods">
          <h2 id="song-moods" className="h3">Moods LOOP hears in it</h2>
          <div className="profile">{s.moodsDetailed.map((m) => <Meter key={m.id} label={m.name} value={Number(m.confidence)} />)}</div>
        </section>
      )}
      {f && (
        <section className="section" aria-labelledby="song-sound">
          <h2 id="song-sound" className="h3">How it sounds</h2>
          <div className="profile">
            <Meter label="Energy" value={f.energy} />
            <Meter label="Positivity" value={f.valence} />
            <Meter label="Danceable" value={f.danceability} />
            <Meter label="Acoustic" value={f.acousticness} />
            <Meter label="Instrumental" value={f.instrumentalness} />
            <Meter label="Tempo" value={null} text={`${Math.round(f.tempo)} BPM${f.keyName ? `, ${f.keyName}` : ''}`} />
          </div>
        </section>
      )}
      <div><Link className="btn btn-primary" to={`/discover?similar=${s.id}`}>Find songs like this</Link></div>
    </div>
  );
}
