import { useEffect, useState } from 'react';
import { api } from './api';

// Moods are reference data from the moods table; fetched once per page load.
let cache = null;
let pending = null;
export function loadMoods() {
  if (cache) return Promise.resolve(cache);
  if (!pending) pending = api.moods().then((m) => { cache = m; return m; }).finally(() => { pending = null; });
  return pending;
}

export function useMoods() {
  const [state, setState] = useState({ moods: cache || [], error: null, loading: !cache });
  useEffect(() => {
    let live = true;
    if (!cache) loadMoods().then((moods) => live && setState({ moods, error: null, loading: false }))
      .catch((error) => live && setState({ moods: [], error, loading: false }));
    return () => { live = false; };
  }, []);
  return state;
}

export const colorOf = (moods, name) => (moods.find((m) => m.name === name) || {}).color;
