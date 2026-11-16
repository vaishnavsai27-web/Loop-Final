// Playback is secondary in LOOP and only exists for songs with authorised
// LOOP-owned audio (/api/media/:id). Everything else is shown as unavailable.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';

const PlayerContext = createContext(null);

export function PlayerProvider({ children, onError }) {
  const audio = useRef(null);
  const play = useRef(null);   // { playId, startedAt }
  const [current, setCurrent] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const finish = useCallback(async () => {
    const p = play.current;
    play.current = null;
    if (!p || !audio.current) return;
    const listened = Math.min(1800, Math.round(audio.current.currentTime || 0));
    try { await api.finishPlay(p.playId, listened); } catch { /* the server closes idle plays itself */ }
  }, []);

  const start = useCallback(async (song, { origin = 'MOOD', batchId } = {}) => {
    if (!song?.playback?.playable) return false;
    await finish();
    try {
      const r = await api.startPlay(song.id, origin, batchId);
      play.current = { playId: r.playId };
      setCurrent({ ...song, media: r.media });
      const el = audio.current;
      el.src = r.media.uri;
      await el.play();
      return true;
    } catch (err) {
      setCurrent(null);
      onError?.(err.message || 'This song could not be played.');
      return false;
    }
  }, [finish, onError]);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el || !current) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  }, [current]);

  const stop = useCallback(async () => {
    audio.current?.pause();
    await finish();
    setCurrent(null);
    setProgress(0);
  }, [finish]);

  useEffect(() => {
    const el = audio.current;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setProgress(el.duration ? el.currentTime / el.duration : 0);
    const onEnded = () => { setPlaying(false); finish(); };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnded);
    };
  }, [finish]);

  const value = useMemo(() => ({ current, playing, progress, start, toggle, stop }), [current, playing, progress, start, toggle, stop]);
  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio ref={audio} preload="none" />
    </PlayerContext.Provider>
  );
}

export const usePlayer = () => useContext(PlayerContext);
