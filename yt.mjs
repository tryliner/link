// tiny helpers for reading youtube music innertube json, shared by the meta/ resolvers.
// ported from the desktop app (src/shared/utils/json.ts, src/shared/youtube/innertube/*),
// pure functions so node --test covers them with fixtures, no network.

export function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// depth-first search for the first object stored under `key`
export function findFirst(value, key) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirst(item, key);
      if (found) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const direct = asRecord(record[key]);
  if (direct) return direct;
  for (const child of Object.values(record)) {
    const found = findFirst(child, key);
    if (found) return found;
  }
  return undefined;
}

// visits every object, `visit` returns true to skip its children
export function walkRecords(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walkRecords(item, visit);
    return;
  }
  const record = asRecord(value);
  if (!record || visit(record)) return;
  for (const child of Object.values(record)) walkRecords(child, visit);
}

export function getRuns(value) {
  return asArray(asRecord(value)?.runs).map(asRecord).filter(Boolean);
}

export function getText(value) {
  const record = asRecord(value);
  if (typeof record?.simpleText === 'string' && record.simpleText.trim()) return record.simpleText.trim();
  const text = getRuns(value)
    .map((run) => (typeof run.text === 'string' ? run.text : ''))
    .join('')
    .trim();
  return text || undefined;
}

export function browseEndpointOf(run) {
  return asRecord(asRecord(run?.navigationEndpoint)?.browseEndpoint);
}

export function pageTypeOf(run) {
  const config = asRecord(
    asRecord(browseEndpointOf(run)?.browseEndpointContextSupportedConfigs)?.browseEndpointContextMusicConfig,
  );
  return typeof config?.pageType === 'string' ? config.pageType : undefined;
}

// splits "Album • The Weeknd • 2020" style runs on the bullet separators
export function textParts(value) {
  return (getText(value) ?? '')
    .split('•')
    .map((part) => part.trim())
    .filter(Boolean);
}

// youtube music artwork lives on googleusercontent / ggpht and can be resized in the url
const ARTWORK_HOST = /^https:\/\/(?:[a-z0-9-]+\.googleusercontent\.com|yt3\.ggpht\.com)\//i;

// -p crops to the exact square, so og:image:width/height stay true even for a banner
export function squareArtworkUrl(url, size = 544) {
  if (!ARTWORK_HOST.test(url)) return url;
  const suffix = `=w${size}-h${size}-p-l90-rj`;
  if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+(?:-[a-zA-Z0-9_-]+)*/, suffix);
  if (/=s\d+/.test(url)) return url.replace(/=s\d+(?:-[a-zA-Z0-9_-]+)*/, suffix);
  return `${url}${suffix}`;
}

// largest thumbnail of a (music)thumbnail renderer, artwork urls resized to a square
export function bestThumbnail(thumbnail, size = 544) {
  const record = asRecord(thumbnail);
  const inner =
    asRecord(asRecord(record?.musicThumbnailRenderer)?.thumbnail) ??
    asRecord(asRecord(asRecord(record?.croppedSquareThumbnailRenderer)?.thumbnail)) ??
    record;
  const entries = asArray(inner?.thumbnails)
    .map(asRecord)
    .filter((entry) => typeof entry?.url === 'string')
    // some renderers still send protocol-relative //yt3.ggpht.com urls
    .map((entry) => ({
      url: entry.url.startsWith('//') ? `https:${entry.url}` : entry.url,
      width: typeof entry.width === 'number' ? entry.width : 0,
      height: typeof entry.height === 'number' ? entry.height : 0,
    }))
    .filter((entry) => entry.url.startsWith('https://'))
    .sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height));
  const best = entries[0];
  if (!best) return undefined;
  if (ARTWORK_HOST.test(best.url)) return { url: squareArtworkUrl(best.url, size), width: size, height: size };
  return best;
}

// "3:20" / "1:02:03" -> seconds, undefined for anything else
export function parseDuration(text) {
  const parts = String(text ?? '').trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d{1,3}$/.test(part))) return undefined;
  const [h, m, s] = parts.length === 3 ? parts.map(Number) : [0, ...parts.map(Number)];
  if (s > 59 || (parts.length === 3 && m > 59)) return undefined;
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : undefined;
}

// seconds -> "3:20" / "1:02:03"
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// "Playlist · Liner · 12 tracks", skipping empty parts
export function joinParts(parts) {
  return parts.filter((part) => typeof part === 'string' && part.trim()).join(' · ');
}

// cuts on a character budget with an ellipsis, never mid surrogate pair
export function clip(text, max) {
  const chars = Array.from(String(text ?? ''));
  return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}
