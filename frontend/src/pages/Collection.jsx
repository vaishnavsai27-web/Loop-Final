import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import SongRow from '../components/SongRow';
import { Empty, ErrorState, Loading, PageHead } from '../components/ui';

/** Artist and album pages: a heading and the songs LOOP holds for them. */
export default function Collection({ kind, id }) {
  const { data, error, loading, reload } = useAsync(() => (kind === 'artist' ? api.artist(id) : api.album(id)), [kind, id]);
  if (loading && !data) return <Loading label={`Loading ${kind}`} />;
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return null;
  const title = kind === 'artist' ? data.name : data.title;
  const sub = kind === 'artist'
    ? [data.language, data.region, data.formedYear && `since ${data.formedYear}`].filter(Boolean).join(', ')
    : [data.artists?.map((a) => a.name).join(', '), data.releaseYear, data.language].filter(Boolean).join(', ');
  return (
    <div className="page page-narrow">
      <PageHead title={title}>{sub}</PageHead>
      {kind === 'artist' && data.bio && <p style={{ maxWidth: 'var(--measure)' }}>{data.bio}</p>}
      {data.songs.length === 0 ? <Empty title="No songs in LOOP yet" /> : (
        <ul className="songs">{data.songs.map((s) => <SongRow key={s.id} song={s} origin="SEARCH" showWhy={false} />)}</ul>
      )}
    </div>
  );
}
