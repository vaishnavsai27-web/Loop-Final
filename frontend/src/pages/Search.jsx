import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Link, useQuery, useRouter } from '../lib/router';
import SongRow from '../components/SongRow';
import { Empty, ErrorState, Loading, PageHead } from '../components/ui';

export default function Search() {
  const query = useQuery();
  const { navigate } = useRouter();
  const q = query.get('q') || '';
  const [value, setValue] = useState(q);
  const [state, setState] = useState({ data: null, error: null, loading: false });

  useEffect(() => { setValue(q); }, [q]);
  useEffect(() => {
    if (q.trim().length < 2) { setState({ data: null, error: null, loading: false }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.search(q.trim()).then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => { live = false; };
  }, [q]);

  function submit(e) {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(value.trim())}`);
  }

  const d = state.data;
  return (
    <div className="page page-narrow">
      <PageHead title="Search">Songs, artists, albums and moods in LOOP’s catalogue.</PageHead>
      <form role="search" onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <label htmlFor="q" className="sr-only">Search LOOP</label>
        <input id="q" className="input" type="search" value={value} autoFocus minLength={2} maxLength={80}
          placeholder="Try a song, an artist or a mood" onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={value.trim().length < 2}>Search</button>
      </form>
      {state.loading && <Loading label="Searching" />}
      <ErrorState error={state.error} />
      {d && d.total === 0 && <Empty title={`Nothing in LOOP matches “${q}”`}>Check the spelling, or describe a mood on Discover instead.</Empty>}
      {d && d.moods.length > 0 && (
        <section className="section" aria-labelledby="r-moods">
          <h2 id="r-moods" className="h3">Moods</h2>
          <div className="chips">{d.moods.map((m) => <Link key={m.id} className="chip" style={{ '--c': m.color, textDecoration: 'none' }} to={`/discover?mood=${m.id}`}><span className="dot" />{m.name}</Link>)}</div>
        </section>
      )}
      {d && d.songs.length > 0 && (
        <section className="section" aria-labelledby="r-songs">
          <h2 id="r-songs" className="h3">Songs</h2>
          <ul className="songs">{d.songs.map((s) => <SongRow key={s.id} song={s} origin="SEARCH" showWhy={false} />)}</ul>
        </section>
      )}
      {d && d.artists.length > 0 && (
        <section className="section" aria-labelledby="r-artists">
          <h2 id="r-artists" className="h3">Artists</h2>
          <ul className="list">{d.artists.map((a) => (
            <li key={a.id} className="list-item"><div className="list-item-main"><Link className="title" to={`/artist/${a.id}`}>{a.name}</Link>
              <span className="small muted">{[a.language, a.matchedAlias && `also known as ${a.matchedAlias}`].filter(Boolean).join(', ')}</span></div></li>
          ))}</ul>
        </section>
      )}
      {d && d.albums.length > 0 && (
        <section className="section" aria-labelledby="r-albums">
          <h2 id="r-albums" className="h3">Albums</h2>
          <ul className="list">{d.albums.map((a) => (
            <li key={a.id} className="list-item"><div className="list-item-main"><Link className="title" to={`/album/${a.id}`}>{a.title}</Link><span className="small muted">{a.artist}</span></div></li>
          ))}</ul>
        </section>
      )}
    </div>
  );
}
