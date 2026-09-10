// share link validation + deeplink building for link.tryliner.fun
// zero deps, pure functions so node --test can cover them without booting http

export const DEEP_SCHEME = 'liner';

// strict allowlist: only these paths exist, everything else 404s.
// id patterns only permit opaque catalog tokens (no urls, slashes, quotes,
// spaces or scheme breaks), so a pentester can't smuggle arbitrary data through.
const ROUTES = {
  // youtube channel ids, always UC + 22 base64url chars
  '/artist': { type: 'artist', id: /^[A-Za-z0-9_-]{24}$/, prefix: 'UC' },
  // innertube album browse ids, e.g. MPREb_xCxkOKReFZv
  '/album': { type: 'album', id: /^MPRE[A-Za-z0-9_-]{4,64}$/ },
  // catalog playlists (VLPL…/PL…/RD…) and user playlists (uuid / pl-…),
  // all just opaque tokens from the same safe charset
  '/playlist': { type: 'playlist', id: /^[A-Za-z0-9_-]{8,64}$/ },
  // youtube video ids are always 11 base64url chars
  '/track': { type: 'track', id: /^[A-Za-z0-9_-]{11}$/ },
};

export function routeFor(pathname) {
  // tolerate one trailing slash, nothing else (no case folding, no normalization tricks)
  const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return ROUTES[clean];
}

// returns { type, id } or null. extra query params are ignored (never forwarded),
// duplicate id params are rejected so ?id=a&id=b can't pick a winner downstream.
export function resolveShare(pathname, params) {
  const route = routeFor(pathname);
  if (!route) return null;
  if (params.getAll('id').length !== 1) return null;
  const id = params.get('id') ?? '';
  if (id.length > 128 || !route.id.test(id)) return null;
  if (route.prefix && !id.startsWith(route.prefix)) return null;
  return { type: route.type, id };
}

// id charset is already url-safe, encode anyway so the builder stays safe
// even if a pattern is ever loosened
export function deeplink(type, id) {
  return `${DEEP_SCHEME}://${type}?id=${encodeURIComponent(id)}`;
}

// escape for html attribute context, belt and suspenders on top of validation
export function escAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderOpenPage(deep) {
  const href = escAttr(deep);
  // json stringify for the js context (validated charset has no quotes, still cheap to be exact)
  const js = JSON.stringify(deep);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Open in Liner</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0d;color:#ececef;font:15px/1.5 system-ui,sans-serif}.card{text-align:center;padding:24px}a{display:inline-block;margin-top:12px;padding:10px 22px;border-radius:10px;background:#1d9bf0;color:#fff;text-decoration:none;font-weight:600}p{margin:0;color:#8e8e93}</style>
</head>
<body>
<main class="card">
<p>Opening Liner…</p>
<a href="${href}">Open in Liner</a>
</main>
<script>location.replace(${js});</script>
</body>
</html>`;
}

// static error pages only, never reflect user input back
export function renderErrorPage(title, hint) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0d;color:#ececef;font:15px/1.5 system-ui,sans-serif}.card{text-align:center;padding:24px}p{margin:8px 0 0;color:#8e8e93}h1{margin:0;font-size:18px}</style>
</head>
<body>
<main class="card">
<h1>${title}</h1>
<p>${hint}</p>
</main>
</body>
</html>`;
}
