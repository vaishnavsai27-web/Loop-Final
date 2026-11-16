import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import { Dialog, Field, Loading, ErrorState } from './ui';

/** Add one song to an existing playlist or a new one. */
export default function SaveDialog({ song, onClose }) {
  const [lists, setLists] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => { api.playlists().then(setLists).catch(setError); }, []);

  async function addTo(p) {
    setBusy(true);
    try { await api.addToPlaylist(p.id, song.id); toast(`Saved to ${p.name}`); onClose(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  }
  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await api.createPlaylist({ name: name.trim(), songIds: [song.id] }); toast(`Saved to ${name.trim()}`); onClose(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Dialog open onClose={onClose} title={`Save “${song.title}”`}
      actions={<button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>}>
      <ErrorState error={error} />
      {!lists && !error && <Loading label="Loading your playlists" />}
      {lists && lists.length > 0 && (
        <ul className="list">
          {lists.map((p) => (
            <li key={p.id} className="list-item">
              <span className="title">{p.name}</span>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => addTo(p)}>Add</button>
            </li>
          ))}
        </ul>
      )}
      <form className="form" onSubmit={create}>
        <Field label="New playlist"><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Rainy evenings" /></Field>
        <div><button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>Create and save</button></div>
      </form>
    </Dialog>
  );
}
