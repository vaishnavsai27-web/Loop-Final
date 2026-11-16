import { useAuth, ROLE_LABEL } from '../lib/auth';
import { usePlayer } from '../lib/player';
import { cover } from '../lib/mood';
import { Link, useRouter } from '../lib/router';
import Icon, { Mark } from './Icon';

export const NAV = {
  listen: [
    ['/discover', 'Discover', 'discover'],
    ['/search', 'Search', 'search'],
    ['/library', 'Library', 'library'],
    ['/settings', 'Settings', 'settings'],
  ],
  studio: [
    ['/studio', 'Overview', 'home'],
    ['/studio/profile', 'Artist profile', 'studio'],
    ['/studio/upload', 'Upload recording', 'upload'],
    ['/studio/submissions', 'My submissions', 'inbox'],
    ['/studio/rights', 'Rights', 'shield'],
  ],
  admin: [
    ['/admin', 'Overview', 'home'],
    ['/admin/users', 'Users and roles', 'users'],
    ['/admin/applications', 'Artist applications', 'inbox'],
    ['/admin/uploads', 'Upload moderation', 'upload'],
    ['/admin/catalogue', 'Catalogue', 'disc'],
    ['/admin/media', 'LOOP media', 'file'],
    ['/admin/permissions', 'Permissions', 'key'],
    ['/admin/health', 'System health', 'pulse'],
  ],
};
const AREA_NAME = { listen: null, studio: 'Studio', admin: 'Admin' };

/** Exact match for area roots, prefix match for the rest. */
export function isActive(href, path) {
  if (['/studio', '/admin'].includes(href)) return path === href;
  return path === href || path.startsWith(`${href}/`);
}

function PlayerBar() {
  const { current, playing, progress, toggle, stop } = usePlayer();
  if (!current) return null;
  return (
    <div className="playerbar" role="region" aria-label="Now playing">
      <div className="cover" style={{ background: cover(current.cover) }} />
      <div style={{ minWidth: 0 }}>
        <div className="small" style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.title}</div>
        <div className="tiny" style={{ opacity: 0.75 }}>{current.artist?.name}</div>
        <div className="playerbar-progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      </div>
      <div style={{ display: 'flex' }}>
        <button type="button" className="icon-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} /></button>
        <button type="button" className="icon-btn" onClick={stop} aria-label="Stop and close player"><Icon name="x" /></button>
      </div>
    </div>
  );
}

export default function Shell({ area = 'listen', children }) {
  const { user, logout } = useAuth();
  const { path, navigate } = useRouter();
  const items = NAV[area];
  const switches = [];
  if (area !== 'listen' && user.role !== 'ADMIN') switches.push(['/discover', 'Back to listening']);
  if (area === 'admin') switches.push(['/discover', 'Open the listener view']);
  if (area !== 'studio' && user.role === 'ARTIST') switches.push(['/studio', 'Artist studio']);
  if (area !== 'admin' && user.role === 'ADMIN') switches.push(['/admin', 'Admin console']);

  async function signOut() {
    await logout();
    navigate('/login?signedOut=1', { replace: true });
  }

  const nav = (
    <nav aria-label={AREA_NAME[area] ? `${AREA_NAME[area]} navigation` : 'Main navigation'}>
      <ul className="nav">
        {items.map(([href, label, icon]) => (
          <li key={href}><Link to={href} aria-current={isActive(href, path) ? 'page' : undefined}><Icon name={icon} />{label}</Link></li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="shell" data-area={area}>
      <a className="skip" href="#main">Skip to content</a>
      <aside className="rail">
        <Link className="brand" to={area === 'admin' ? '/admin' : area === 'studio' ? '/studio' : '/discover'}>
          <Mark /><span className="brand-word">loop</span>{AREA_NAME[area] && <span className="brand-area">{AREA_NAME[area]}</span>}
        </Link>
        {nav}
        <div className="rail-foot">
          {switches.length > 0 && (
            <div className="area-switch">{switches.map(([href, label]) => <Link key={label} to={href}>{label}</Link>)}</div>
          )}
          <div className="who">
            <strong>{user.displayName}</strong>
            <span className="tiny muted">@{user.username}</span>
            <span><span className="badge">{ROLE_LABEL[user.role] || user.role}</span></span>
            <button type="button" className="btn btn-quiet btn-sm" style={{ justifyContent: 'flex-start', paddingLeft: 0 }} onClick={signOut}>
              <Icon name="out" size={18} />Sign out
            </button>
          </div>
        </div>
      </aside>

      <div style={{ minWidth: 0 }}>
        <header className="topbar">
          <Link className="brand" to={area === 'admin' ? '/admin' : area === 'studio' ? '/studio' : '/discover'}>
            <Mark size={22} /><span className="brand-word" style={{ fontSize: '1.35rem' }}>loop</span>
            {AREA_NAME[area] && <span className="brand-area">{AREA_NAME[area]}</span>}
          </Link>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {switches.slice(0, 1).map(([href, label]) => <Link key={label} className="btn btn-quiet btn-sm" to={href}>{label}</Link>)}
            <button type="button" className="icon-btn" onClick={signOut} aria-label="Sign out"><Icon name="out" /></button>
          </div>
        </header>
        {area !== 'listen' && (
          <nav className="subnav" aria-label={`${AREA_NAME[area]} sections`}>
            {items.map(([href, label]) => <Link key={href} to={href} aria-current={isActive(href, path) ? 'page' : undefined}>{label}</Link>)}
          </nav>
        )}
        <main id="main" className="main" tabIndex={-1}>{children}</main>
      </div>

      {area === 'listen' && (
        <nav className="tabbar" aria-label="Main navigation (mobile)">
          {items.map(([href, label, icon]) => (
            <Link key={href} to={href} aria-current={isActive(href, path) ? 'page' : undefined}><Icon name={icon} />{label}</Link>
          ))}
        </nav>
      )}
      <PlayerBar />
    </div>
  );
}
