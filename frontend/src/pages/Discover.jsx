import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { aura } from '../lib/mood';
import { useMoods } from '../lib/moods';
import { useQuery, useRouter, Link } from '../lib/router';
import { useToast } from '../lib/toast';
import { useAuth } from '../lib/auth';
import { relativeDate } from '../lib/format';
import SongRow from '../components/SongRow';
import { Empty, ErrorState, Loading, Meter } from '../components/ui';

const EXAMPLES = [
  'I’m feeling nostalgic and want something emotional',
  'Music for a quiet rainy evening',
  'I need something energetic to lift my mood',
  'Peaceful but slightly melancholic',
];
const MAX_MOODS = 4;

/** Mood input → recommendation generation → results → feedback and saving. */
export default function Discover() {
  const { user } = useAuth();
  const query = useQuery();
  const { navigate } = useRouter();
  const toast = useToast();
  const { moods, error: moodsError, loading: moodsLoading } = useMoods();
  const [contexts, setContexts] = useState([]);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState([]);
  const [context, setContext] = useState(null);
  const [heard, setHeard] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState(null);
  const [saving, setSaving] = useState(false);
  const resultsRef = useRef(null);

  useEffect(() => { api.contexts().then(setContexts).catch(() => setContexts([])); }, []);
  useEffect(() => { api.moodHistory(6).then(setRecent).catch(() => setRecent([])); }, [result]);

  // Deep links: ?mood=ID preselects, ?similar=SONG explores similar, ?batch=ID reopens a list.
  const similarId = query.get('similar');
  const batchId = query.get('batch');
  const moodParam = query.get('mood');
  useEffect(() => {
    if (moodParam && /^\d+$/.test(moodParam)) setPicked([Number(moodParam)]);
  }, [moodParam]);
  useEffect(() => {
    if (!similarId && !batchId) return;
    let live = true;
    setBusy(true); setError(null);
    const load = similarId ? api.similar(Number(similarId), 20) : api.batch(Number(batchId));
    load.then((r) => { if (live) { setResult(r); scrollToResults(); } })
      .catch((err) => live && setError(err))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [similarId, batchId]);

  // Live interpretation of the sentence, from LOOP's own mood lexicon.
  useEffect(() => {
    const t = text.trim();
    if (t.length < 3) { setHeard(null); return undefined; }
    const id = setTimeout(() => { api.parseMood(t).then(setHeard).catch(() => setHeard(null)); }, 350);
    return () => clearTimeout(id);
  }, [text]);

  const selectedColors = useMemo(() => {
    const ids = new Set([...picked, ...((heard?.moods || []).map((m) => m.moodId))]);
    return moods.filter((m) => ids.has(m.id)).map((m) => m.color);
  }, [picked, heard, moods]);

  function scrollToResults() {
    setTimeout(() => {
      const el = resultsRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }, 50);
  }

  function toggleMood(id) {
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= MAX_MOODS ? list : [...list, id]));
  }

  async function submit(e) {
    e?.preventDefault();
    const t = text.trim();
    if (!t && !picked.length && !context) { setError({ message: 'Describe how you feel, or pick at least one mood.' }); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.recommend({
        ...(picked.length ? { moodIds: picked } : {}),
        ...(t.length >= 2 ? { text: t } : {}),
        ...(context ? { contextCode: context } : {}),
        limit: 20,
      });
      setResult(r);
      if (similarId || batchId) navigate('/discover', { replace: true });
      scrollToResults();
    } catch (err) {
      setResult(null);
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveMix() {
    if (!result?.batchId) return;
    setSaving(true);
    try {
      const name = `${result.title}`.slice(0, 70) + ` · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
      const p = await api.saveMix(result.batchId, name.slice(0, 80));
      toast(`Saved “${p.name}” to your library`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const heardMoods = heard?.moods || [];
  const suggestions = error?.details?.suggestions;

  return (
    <div className="page">
      <h1 className="sr-only">Discover music by mood</h1>
      <form className="composer" onSubmit={submit} aria-label="Mood request">
        <div className="composer-aura" aria-hidden="true" style={{ background: aura(selectedColors) }} />
        <label id="composer-prompt" htmlFor="feeling" className="composer-prompt">
          {greeting(user)} How are you feeling, and what do you want to hear?
        </label>
        <textarea
          id="feeling" className="composer-text" rows={2} maxLength={280} value={text}
          placeholder={EXAMPLES[0]}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
        <div className="hears" aria-live="polite">
          {heardMoods.length > 0 ? (
            <>
              <span>LOOP hears</span>
              {heardMoods.map((m) => <strong key={m.moodId}>{m.name}</strong>)}
              {heard.context && <span>for <strong>{heard.context.name.toLowerCase()}</strong></span>}
            </>
          ) : text.trim().length >= 3 && heard ? (
            <span>No mood words recognised yet. Pick moods below, or try words like calm, nostalgic or energetic.</span>
          ) : (
            <span>Try: {EXAMPLES.slice(1).map((ex, i) => (
              <button key={ex} type="button" className="btn btn-quiet btn-sm" style={{ padding: '0 6px', minHeight: 28 }} onClick={() => setText(ex)}>
                “{ex}”
              </button>
            ))}</span>
          )}
        </div>

        <div className="composer-group">
          <p id="moods-label">Moods <span className="muted" style={{ fontWeight: 400 }}>— choose up to {MAX_MOODS}</span></p>
          {moodsLoading && <Loading label="Loading moods" />}
          <ErrorState error={moodsError} />
          <div className="chips" role="group" aria-labelledby="moods-label">
            {moods.map((m) => (
              <button key={m.id} type="button" className="chip" style={{ '--c': m.color }} aria-pressed={picked.includes(m.id)}
                disabled={!picked.includes(m.id) && picked.length >= MAX_MOODS} onClick={() => toggleMood(m.id)} title={m.description}>
                <span className="dot" />{m.name}
              </button>
            ))}
          </div>
        </div>

        {contexts.length > 0 && (
          <div className="composer-group">
            <p id="context-label">Listening for <span className="muted" style={{ fontWeight: 400 }}>— optional</span></p>
            <div className="chips" role="group" aria-labelledby="context-label">
              {contexts.map((c) => (
                <button key={c.code} type="button" className="chip" aria-pressed={context === c.code}
                  onClick={() => setContext((v) => (v === c.code ? null : c.code))} title={c.description}>{c.name}</button>
              ))}
            </div>
          </div>
        )}

        <div className="composer-actions">
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Finding music…' : 'Find music'}</button>
          {(text || picked.length > 0 || context) && (
            <button type="button" className="btn btn-quiet" onClick={() => { setText(''); setPicked([]); setContext(null); setHeard(null); setError(null); }}>Clear</button>
          )}
        </div>
      </form>

      {error && (
        <div className="notice notice-warn" role="alert">
          <strong>{error.message}</strong>
          {suggestions && (
            <div className="chips">{suggestions.map((s) => <button key={s} type="button" className="chip" onClick={() => setText(s)}>{s}</button>)}</div>
          )}
        </div>
      )}

      <section ref={resultsRef} tabIndex={-1} aria-label="Recommendations" className="section" style={{ outline: 'none' }}>
        {busy && <Loading label="Matching your mood against LOOP’s catalogue" />}
        {!busy && result && <Results result={result} onSave={saveMix} saving={saving} />}
      </section>

      {!result && !busy && recent && recent.length > 0 && (
        <section className="section" aria-labelledby="recent-head">
          <div className="section-head"><h2 id="recent-head" className="h3">Your recent moods</h2><Link className="small" to="/library?tab=moods">See all</Link></div>
          <ul className="list">
            {recent.map((b) => (
              <li key={b.id} className="list-item">
                <div className="list-item-main">
                  <Link className="title" to={`/discover?batch=${b.id}`}>{b.inputText || b.label}</Link>
                  <span className="small muted">{b.moods.map((m) => m.name).join(', ')} — {relativeDate(b.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function greeting(user) {
  const name = user?.displayName?.split(' ')[0];
  return name ? `Hi ${name}.` : '';
}

function Results({ result, onSave, saving }) {
  const songs = result.songs || [];
  const interp = result.interpretation;
  const summary = interp?.summary || [];
  return (
    <>
      <header className="result-head">
        <p className="muted small">{result.seed ? 'Songs that sound like' : interp?.moods?.length ? 'Your mood sounds like' : 'Recommendations'}</p>
        <h2 className="h1" style={{ fontSize: 'var(--t-2xl)' }}>{result.seed ? result.seed.title : result.title}</h2>
        {summary.length > 0 && (
          <div className="profile" aria-label="Target sound">
            {summary.map((s) => <Meter key={s.label} label={s.label} value={s.score} text={s.value} />)}
          </div>
        )}
        {result.coverage && !result.coverage.complete && (
          <p className="notice" role="status">{result.coverage.message}</p>
        )}
        {songs.length > 0 && (
          <div className="composer-actions">
            {result.batchId && <button type="button" className="btn" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save this mix'}</button>}
            <span className="small muted">
              {songs.length} {songs.length === 1 ? 'song' : 'songs'}
              {typeof result.playableCount === 'number' && ` — ${result.playableCount === 0 ? 'none' : result.playableCount} playable in LOOP`}
            </span>
          </div>
        )}
      </header>
      {result.playableCount === 0 && songs.length > 0 && (
        <p className="small muted" style={{ maxWidth: 'var(--measure)' }}>
          These songs are in LOOP’s catalogue, but LOOP doesn’t hold an authorised recording of them yet, so they can’t be played here.
          You can still like and save them.
        </p>
      )}
      {songs.length === 0 ? (
        <Empty title="Nothing in the catalogue fits closely enough">
          {result.message || result.coverage?.message || 'Try a broader feeling, fewer moods, or a different listening context.'}
        </Empty>
      ) : (
        <ol className="songs">
          {songs.map((s, i) => <SongRow key={s.id} song={s} rank={i + 1} batchId={result.batchId} origin="MOOD" dismissible showAvailability={result.playableCount !== 0} />)}
        </ol>
      )}
    </>
  );
}
