import { useState } from 'react';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { totalDuration, plural } from '../lib/format';
import SongRow from '../components/SongRow';
import { Dialog, Empty, ErrorState, Field, Loading, PageHead } from '../components/ui';
import Icon from '../components/Icon';

export default function Playlist({ id }) {
  const { data, error, loading, reload, setData } = useAsync(() => api.playlist(id), [id]);
  const { navigate } = useRouter();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState('');

  if (loading && !data) return <Loading label="Loading playlist" />;
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return null;

  async function rename(e) {
    e.preventDefault();
    try { const p = await api.renamePlaylist(id, { name: name.trim() }); setData((d) => ({ ...d, name: p.name ?? name.trim() })); setRenaming(false); toast('Playlist renamed'); }
    catch (err) { toast(err.message, 'error'); }
  }
  async function remove() {
    try { await api.deletePlaylist(id); toast('Playlist deleted'); navigate('/library'); }
    catch (err) { toast(err.message, 'error'); }
  }
  async function removeSong(songId) {
    try { await api.removeFromPlaylist(id, songId); setData((d) => ({ ...d, songs: d.songs.filter((s) => s.id !== songId), songCount: d.songCount - 1 })); toast('Removed from playlist'); }
    catch (err) { toast(err.message, 'error'); }
  }

  return (
    <div className="page page-narrow">
      <PageHead title={data.name} actions={(
        <div className="row-actions">
          <button type="button" className="btn btn-sm" onClick={() => { setName(data.name); setRenaming(true); }}>Rename</button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}>Delete</button>
        </div>
      )}>
        {data.description ? `${data.description}. ` : ''}{plural(data.songs.length, 'song')}, {totalDuration(data.totalDurationSec)}.
      </PageHead>
      {data.songs.length === 0 ? <Empty title="This playlist is empty">Add songs from Discover or Search with the + button.</Empty> : (
        <ul className="songs">
          {data.songs.map((s) => (
            <SongRow key={s.id} song={s} origin="PLAYLIST" showWhy={false}
              extra={<button type="button" className="icon-btn" onClick={() => removeSong(s.id)} aria-label={`Remove ${s.title} from this playlist`} title="Remove from playlist"><Icon name="x" /></button>} />
          ))}
        </ul>
      )}
      <Dialog open={renaming} onClose={() => setRenaming(false)} title="Rename playlist">
        <form className="form" onSubmit={rename}>
          <Field label="Name"><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="dialog-actions"><button type="button" className="btn btn-quiet" onClick={() => setRenaming(false)}>Cancel</button><button className="btn btn-primary" disabled={!name.trim()}>Rename</button></div>
        </form>
      </Dialog>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete “${data.name}”?`}
        actions={<><button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>Keep it</button><button type="button" className="btn btn-danger" onClick={remove}>Delete playlist</button></>}>
        <p className="muted">The songs stay in LOOP. Only this playlist is removed.</p>
      </Dialog>
    </div>
  );
}
