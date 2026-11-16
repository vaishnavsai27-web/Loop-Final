// A small history-API router: LOOP needs path params, links and redirects, not a framework.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const RouterContext = createContext({ path: '/', search: '', navigate: () => {} });

/** Match "/playlist/:id" against "/playlist/42" → { id: '42' }; null when it does not match. "*" matches a tail. */
export function matchPath(pattern, path) {
  if (pattern === '*') return { '*': path.replace(/^\/+/, '') };
  const clean = (s) => s.replace(/\/+$/, '') || '/';
  const p = clean(pattern).split('/');
  const a = clean(path).split('/');
  const params = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i] === '*') { params['*'] = a.slice(i).join('/'); return params; }
    if (a[i] === undefined) return null;
    if (p[i].startsWith(':')) {
      try { params[p[i].slice(1)] = decodeURIComponent(a[i]); } catch { return null; }
    } else if (p[i] !== a[i]) return null;
  }
  return a.length === p.length ? params : null;
}

export function RouterProvider({ children }) {
  const [loc, setLoc] = useState(() => ({ path: window.location.pathname, search: window.location.search }));
  useEffect(() => {
    const onPop = () => setLoc({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to, { replace = false } = {}) => {
    const url = new URL(to, window.location.origin);
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', url.pathname + url.search + url.hash);
    setLoc({ path: url.pathname, search: url.search });
    if (!replace) window.scrollTo(0, 0);
  }, []);
  const value = useMemo(() => ({ ...loc, navigate }), [loc, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export const useRouter = () => useContext(RouterContext);
export const useQuery = () => {
  const { search } = useRouter();
  return useMemo(() => new URLSearchParams(search), [search]);
};

export function Link({ to, children, onClick, ...rest }) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

export function Redirect({ to }) {
  const { navigate } = useRouter();
  useEffect(() => { navigate(to, { replace: true }); }, [navigate, to]);
  return null;
}

/** First matching route wins. routes: [{ path, render(params) }] */
export function Routes({ routes }) {
  const { path } = useRouter();
  for (const r of routes) {
    const params = matchPath(r.path, path);
    if (params) return r.render(params);
  }
  return null;
}
