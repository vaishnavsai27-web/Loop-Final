import { useMemo } from 'react';
import { aura } from '../lib/mood';
import { useMoods } from '../lib/moods';
import { Link } from '../lib/router';
import { Mark } from '../components/Icon';

/** Signed-out home: what LOOP does, shown with LOOP's real moods. */
export default function Landing() {
  const { moods } = useMoods();
  const colors = useMemo(() => moods.filter((m) => ['Nostalgic', 'Calm', 'Melancholic', 'Romantic'].includes(m.name)).map((m) => m.color), [moods]);
  return (
    <div className="public">
      <header className="public-top">
        <Link className="brand" to="/"><Mark /><span className="brand-word">loop</span></Link>
        <nav style={{ display: 'flex', gap: 8 }} aria-label="Account">
          <Link className="btn btn-quiet" to="/login">Sign in</Link>
          <Link className="btn btn-primary" to="/register">Create account</Link>
        </nav>
      </header>
      <main className="public-main" id="main">
        <div className="landing">
          <section className="composer" aria-labelledby="landing-title">
            <div className="composer-aura" aria-hidden="true" style={{ background: aura(colors, 0.5) }} />
            <h1 id="landing-title" className="composer-prompt">Tell LOOP how you feel. It finds the music.</h1>
            <p className="composer-text" aria-hidden="true">Peaceful, but slightly melancholic — something for a quiet rainy evening.</p>
                <p className="lede">
              Write it in your own words or pick a few moods. LOOP reads the feeling, matches it against the sound of every
              song in its catalogue, and tells you why each one fits.
            </p>
            <div className="composer-actions">
              <Link className="btn btn-primary btn-lg" to="/register">Start with a mood</Link>
              <Link className="btn btn-lg" to="/login">I already have an account</Link>
            </div>
          </section>
          {moods.length > 0 && (
            <section className="landing-moods" aria-labelledby="moods-title">
              <h2 id="moods-title" className="h3">{moods.length} moods to start from</h2>
              <ul className="chips">
                {moods.map((m) => <li key={m.id} className="chip" style={{ '--c': m.color, cursor: 'default' }}><span className="dot" />{m.name}</li>)}
              </ul>
            </section>
          )}
        </div>
      </main>
      <footer className="public-foot">LOOP recommends from its own catalogue and plays only recordings it is authorised to stream.</footer>
    </div>
  );
}
