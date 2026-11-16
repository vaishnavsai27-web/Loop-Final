// Signed-in state. The role always comes from the server session (/auth/session);
// the browser never decides who is an Artist or an Admin.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';

const AuthContext = createContext(null);

export const ROLE_LABEL = { LISTENER: 'User', ARTIST: 'Artist', ADMIN: 'Admin' };
export const homeFor = (user) => (!user ? '/' : user.role === 'ADMIN' ? '/admin' : '/discover');

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.session();
      setUser(s && s.authenticated ? s : null);
      return s && s.authenticated ? s : null;
    } catch {
      setUser(null);
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    setUnauthorizedHandler((e) => {
      setUser(null);
      setExpired(e?.message || 'Your session has ended. Sign in again.');
    });
  }, []);

  const login = useCallback(async (login, password) => {
    await api.login(login, password);
    setExpired(null);
    return refresh();
  }, [refresh]);
  const register = useCallback(async (body) => {
    await api.register(body);
    setExpired(null);
    return refresh();
  }, [refresh]);
  const logout = useCallback(async () => {
    try { await api.logout(); } finally { setUser(null); }
  }, []);

  const value = useMemo(() => ({ user, ready, expired, login, register, logout, refresh, setUser, clearExpired: () => setExpired(null) }),
    [user, ready, expired, login, register, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
