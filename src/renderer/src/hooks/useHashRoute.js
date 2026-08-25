import { useEffect, useState } from 'react';

// Tiny hand-rolled hash router — no react-router dependency needed for the
// handful of top-level screens this app has. `segments` is the `/`-split
// path with empty segments removed, so `#/projects/abc` -> ['projects','abc'].

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/dashboard';
  const path = raw.split('?')[0] || '/dashboard';
  const segments = path.split('/').filter(Boolean);
  return { path, segments };
}

export function useHashRoute() {
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}

export function navigate(path) {
  window.location.hash = path;
}
