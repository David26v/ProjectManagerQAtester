import { useEffect, useState } from 'react';

// Tiny hand-rolled hash router — no react-router dependency needed for the
// handful of top-level screens this app has. `segments` is the `/`-split
// path with empty segments removed, so `#/projects/abc` -> ['projects','abc'].
// `query` parses anything after a `?` in the hash (e.g. `#/suites?panel=recorder`)
// so a nav item can point a query-string sub-view without inventing a new
// top-level route segment — screens that care (like Task 8's Suites screen)
// read `route.query.panel` to decide what to scroll to / highlight.

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/dashboard';
  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart || '/dashboard';
  const segments = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { path, segments, query };
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
