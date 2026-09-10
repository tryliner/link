// html rendering for share pages. only the validated deeplink is ever
// interpolated (escaped), everything else is static.
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const KIND_LABEL = {
  artist: 'Artist',
  album: 'Album',
  playlist: 'Playlist',
  track: 'Track',
};

// bouncy eq bars while the os hands off to the app, no external assets
const PAGE_STYLE = `body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0d;color:#ececef;font:15px/1.5 system-ui,-apple-system,sans-serif}.card{text-align:center;padding:32px 24px;max-width:340px}.eq{display:flex;align-items:flex-end;justify-content:center;gap:5px;height:44px;margin-bottom:20px}.eq span{width:5px;border-radius:3px;background:#1d9bf0;animation:bounce 1s ease-in-out infinite}.eq span:nth-child(1){height:40%;animation-delay:-.6s}.eq span:nth-child(2){height:90%;animation-delay:-.75s}.eq span:nth-child(3){height:55%;animation-delay:-.3s}.eq span:nth-child(4){height:100%;animation-delay:-.45s}.eq span:nth-child(5){height:65%;animation-delay:-.15s}@keyframes bounce{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}@media (prefers-reduced-motion:reduce){.eq span{animation:none;transform:scaleY(.7)}}h1{margin:0;font-size:21px;letter-spacing:-.01em}p{margin:8px 0 0;color:#8e8e93}a.btn{display:inline-block;margin-top:22px;padding:11px 28px;border-radius:12px;background:#1d9bf0;color:#fff;text-decoration:none;font-weight:600}`;

export function renderOpenPage({ deep, type }) {
  const label = KIND_LABEL[type] ?? 'Liner';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(label)} • Liner</title>
<meta property="og:site_name" content="Liner">
<meta property="og:title" content="${esc(label)} • Liner">
<meta name="theme-color" content="#0b0b0d">
<style>${PAGE_STYLE}</style>
</head>
<body>
<main class="card">
<div class="eq" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
<h1>Opening in Liner…</h1>
<p>If nothing happens, tap the button below.</p>
<a class="btn" href="${esc(deep)}">Open in Liner</a>
</main>
<script>location.replace(${JSON.stringify(deep)});</script>
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
<title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0d;color:#ececef;font:15px/1.5 system-ui,sans-serif}.card{text-align:center;padding:24px}p{margin:8px 0 0;color:#8e8e93}h1{margin:0;font-size:18px}</style>
</head>
<body>
<main class="card">
<h1>${esc(title)}</h1>
<p>${esc(hint)}</p>
</main>
</body>
</html>`;
}

export function renderLanding() {
  return renderErrorPage(
    'Liner links',
    'Share links for artists, albums, playlists and tracks open directly in the Liner app.',
  );
}
