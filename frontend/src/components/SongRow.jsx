import { useState } from 'react';
import { api } from '../lib/api';
import { cover } from '../lib/mood';
import { colorOf, useMoods } from '../lib/moods';
import { usePlayer } from '../lib/player';
import { Link, useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { duration } from '../lib/format';
import Icon from './Icon';
import SaveDialog from './SaveDialog';

/**
 * One song in a list. Recommendations pass `reasons` and `batchId`; every action
 * is a real API call, and the row reflects the server's answer.
 */
export default function SongRow({ song: initial, rank, batchId, origin = 'MOOD', dismissible = false, onDismissed, showWhy = true, extra = null, showAvailability = true }) {
  const [song, setSong] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(!!initial.dismissed);
  const { moods } = useMoods();
  const player = usePlayer();
  const toast = useToast();
  const { navigate } = useRouter();
  const playable = !!song.playback?.playable;
  const isCurrent = player.current?.id === song.id;
  const why = showWhy && song.reasons && song.reasons[0];
  const lead = song.moods?.[0];

  async function toggleLike() {
    const next = !song.liked;
    setSong((s) => ({ ...s, liked: next }));
    try { await api.like(song.id, next); toast(next ? 'Added to Liked songs' : 'Removed from Liked songs'); }
    catch (err) { setSong((s) => ({ ...s, liked: !next })); toast(err.message, 'error'); }
  }

  async function toggleDismiss() {
    try {
      if (dismissed) { await api.undismiss(song.id); setDismissed(false); toast('Back in your recommendations'); }
      else { await api.dismiss(song.id, batchId); setDismissed(true); toast('You won’t be recommended this song again'); onDismissed?.(song); }
    } catch (err) { toast(err.message, 'error'); }
  }

  async function togglePlay() {
    if (isCurrent) return player.toggle();
    return player.start(song, { origin, batchId });
  }

  return (
    <li className="song" data-dismissed={dismissed}>
      <span className="song-rank" aria-hidden={!rank}>{rank || ''}</span>
      <div className="cover" style={{ background: cover(song.cover) }}>
        {playable && (
          <button type="button" className="cover-play icon-btn" onClick={togglePlay} aria-pressed={isCurrent && player.playing}
            aria-label={isCurrent && player.playing ? `Pause ${song.title}` : `Play ${song.title}`}>
            <Icon name={isCurrent && player.playing ? 'pause' : 'play'} />
          </button>
        )}
      </div>
      <div className="song-main">
        <Link className="song-title" to={`/song/${song.id}`}>{song.title}{song.version ? ` (${song.version})` : ''}</Link>
        <div className="song-meta">
          <Link to={`/artist/${song.artist.id}`}>{song.artist.name}</Link>
          {song.language?.name && <span>{song.language.name}</span>}
          {song.durationSec ? <span className="num">{duration(song.durationSec)}</span> : null}
          {song.moods?.slice(0, 2).map((m) => <span key={m} className="tag" style={{ '--c': colorOf(moods, m) }}><span className="dot" />{m}</span>)}
          {!playable && showAvailability && <span className="unplayable" title="LOOP has no authorised recording of this song yet">Not available to play</span>}
        </div>
        {why && <p className="song-why" style={{ '--c': colorOf(moods, lead) }}>{why.text}</p>}
      </div>
      <div className="song-actions">
        <button type="button" className="icon-btn liked" aria-pressed={!!song.liked} onClick={toggleLike}
          aria-label={song.liked ? `Unlike ${song.title}` : `Like ${song.title}`} title={song.liked ? 'Liked' : 'Like'}>
          <Icon name="heart" />
        </button>
        <button type="button" className="icon-btn" onClick={() => setSaving(true)} aria-label={`Save ${song.title} to a playlist`} title="Save to playlist">
          <Icon name="plus" />
        </button>
        <button type="button" className="icon-btn" onClick={() => navigate(`/discover?similar=${song.id}`)} aria-label={`Find songs similar to ${song.title}`} title="Explore similar">
          <Icon name="similar" />
        </button>
        {dismissible && (
          <button type="button" className="icon-btn" aria-pressed={dismissed} onClick={toggleDismiss}
            aria-label={dismissed ? `Undo not interested in ${song.title}` : `Not interested in ${song.title}`} title={dismissed ? 'Undo' : 'Not interested'}>
            <Icon name={dismissed ? 'back' : 'slash'} />
          </button>
        )}
        {extra}
      </div>
      {saving && <SaveDialog song={song} onClose={() => setSaving(false)} />}
    </li>
  );
}
