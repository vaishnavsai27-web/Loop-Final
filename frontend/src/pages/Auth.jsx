import { useState } from 'react';
import { useAuth, homeFor } from '../lib/auth';
import { Link, useQuery, useRouter } from '../lib/router';
import { Mark } from '../components/Icon';
import { Field } from '../components/ui';

const USERNAME = /^[a-z0-9_]{3,30}$/;
const PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

export function validateRegistration(f) {
  const errors = {};
  if (!f.displayName.trim()) errors.displayName = 'Enter the name LOOP should show.';
  if (!USERNAME.test(f.username)) errors.username = 'Use 3–30 lowercase letters, digits or _.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) errors.email = 'Enter a valid email address.';
  if (!PASSWORD.test(f.password)) errors.password = 'Use at least 8 characters with a letter and a number.';
  if (f.confirm !== f.password) errors.confirm = 'The passwords don’t match.';
  return errors;
}

export default function Auth({ mode }) {
  const isLogin = mode === 'login';
  const { login, register, expired, clearExpired } = useAuth();
  const { navigate } = useRouter();
  const query = useQuery();
  const [form, setForm] = useState({ login: '', password: '', displayName: '', username: '', email: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!isLogin) {
      const v = validateRegistration(form);
      setErrors(v);
      if (Object.keys(v).length) return;
    } else if (!form.login.trim() || !form.password) {
      setError('Enter your username or email and your password.');
      return;
    }
    setBusy(true);
    try {
      const user = isLogin
        ? await login(form.login.trim(), form.password)
        : await register({ displayName: form.displayName.trim(), username: form.username, email: form.email.trim(), password: form.password });
      clearExpired();
      const next = query.get('next');
      const target = next && next.startsWith('/') && !next.startsWith('//') ? next : isLogin ? homeFor(user) : '/settings/preferences?welcome=1';
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.message);
      if (err.details && typeof err.details === 'object' && !Array.isArray(err.details)) setErrors(err.details);
    } finally {
      setBusy(false);
    }
  }

  const fe = (k) => ({ error: errors[k], errorId: `${k}-error` });
  const inv = (k) => ({ 'aria-invalid': !!errors[k] || undefined, 'aria-describedby': errors[k] ? `${k}-error` : undefined });

  return (
    <div className="public">
      <header className="public-top">
        <Link className="brand" to="/"><Mark /><span className="brand-word">loop</span></Link>
      </header>
      <main className="public-main" id="main">
        <div className="auth">
          <h1 className="h1" style={{ fontSize: 'var(--t-2xl)' }}>{isLogin ? 'Sign in to LOOP' : 'Create your LOOP account'}</h1>
          {isLogin && query.get('signedOut') && <p className="notice notice-ok" role="status">You’re signed out.</p>}
          {isLogin && expired && !query.get('signedOut') && <p className="notice notice-warn" role="status">{expired}</p>}
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <form className="form" onSubmit={submit} noValidate>
            {isLogin ? (
              <>
                <Field label="Username or email"><input className="input" name="login" autoComplete="username" value={form.login} onChange={set('login')} /></Field>
                <Field label="Password"><input className="input" name="password" type="password" autoComplete="current-password" value={form.password} onChange={set('password')} /></Field>
              </>
            ) : (
              <>
                <Field label="Name" {...fe('displayName')}><input className="input" name="displayName" autoComplete="name" maxLength={60} value={form.displayName} onChange={set('displayName')} {...inv('displayName')} /></Field>
                <Field label="Username" hint="lowercase letters, digits and _" {...fe('username')}><input className="input" name="username" autoComplete="username" maxLength={30} value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase() }))} {...inv('username')} /></Field>
                <Field label="Email" {...fe('email')}><input className="input" name="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} {...inv('email')} /></Field>
                <Field label="Password" hint="8+ characters with a letter and a number" {...fe('password')}><input className="input" name="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} {...inv('password')} /></Field>
                <Field label="Confirm password" {...fe('confirm')}><input className="input" name="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} {...inv('confirm')} /></Field>
                <p className="small muted">New accounts are User accounts. You can apply for Artist access from Settings once you’re signed in.</p>
              </>
            )}
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Please wait…' : isLogin ? 'Sign in' : 'Create account'}</button>
          </form>
          <p className="small muted">
            {isLogin ? <>New to LOOP? <Link to="/register">Create an account</Link></> : <>Already have an account? <Link to="/login">Sign in</Link></>}
          </p>
        </div>
      </main>
    </div>
  );
}
