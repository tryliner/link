// link preview metadata (discord, slack, telegram, imessage...) for share pages.
// each kind has a resolver in meta/ that reads youtube music and returns a plain
// { title, description, image, ... } object. this module bounds the time spent,
// caches results, and sanitizes every field before it reaches the html. any failure
// means null, and the page falls back to the generic "Playlist • Liner" card.
import { createFetchJson, createInnertube } from './innertube.mjs';
import { PUBLIC_ORIGIN, resolveShare, shareUrl } from './share.mjs';
import { asArray, asRecord, clip } from './yt.mjs';
import { resolveArtistMeta } from './meta/artist.mjs';
import { resolveAlbumMeta, resolvePlaylistMeta } from './meta/playlist.mjs';
import { resolveTrackMeta } from './meta/track.mjs';

// kinds without a resolver keep the generic card
export const RESOLVERS = {
  artist: resolveArtistMeta,
  album: resolveAlbumMeta,
  playlist: resolvePlaylistMeta,
  track: resolveTrackMeta,
};

const LIMITS = { title: 100, description: 350, imageAlt: 120, author: 100, extra: 200, extraCount: 16 };

// youtube's image cdns only, so a preview can never point at an arbitrary host
const IMAGE_URL =
  /^https:\/\/(?:i\.ytimg\.com|yt3\.ggpht\.com|yt3\.googleusercontent\.com|lh[3-6]\.googleusercontent\.com)\/[^\s"'<>\\]+$/;

const OG_TYPES = new Set(['website', 'profile', 'music.song', 'music.album', 'music.playlist']);

// open graph music/profile extras (music:duration, music:musician...), the core og tags are fixed
const EXTRA_PROPERTY = /^(?:music|profile):[a-z][a-z_:]{0,40}$/;

// control chars and bidi overrides out, whitespace collapsed
const STRIP = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function cleanLine(value, max) {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(STRIP, ' ').replace(/\s+/g, ' ').trim();
  return text ? clip(text, max) : undefined;
}

// same, but keeps line breaks (track lists in descriptions)
function cleanBlock(value, max) {
  if (typeof value !== 'string') return undefined;
  const text = value
    .split(/\r?\n/)
    .map((line) => line.replace(STRIP, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return text ? clip(text, max) : undefined;
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 4096 ? n : undefined;
}

// only canonical link.tryliner.fun share urls with a valid id
export function isShareUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(`${PUBLIC_ORIGIN}/`)) return false;
  try {
    const url = new URL(value);
    const share = resolveShare(url.pathname, url.searchParams);
    return Boolean(share) && shareUrl(share.type, share.id) === value;
  } catch {
    return false;
  }
}

export function sanitizeMeta(raw) {
  const meta = asRecord(raw);
  const title = cleanLine(meta?.title, LIMITS.title);
  if (!title) return null;
  const out = { title };
  const description = cleanBlock(meta.description, LIMITS.description);
  if (description) out.description = description;
  if (typeof meta.image === 'string' && IMAGE_URL.test(meta.image)) {
    out.image = meta.image;
    const width = positiveInt(meta.imageWidth);
    const height = positiveInt(meta.imageHeight);
    if (width && height) Object.assign(out, { imageWidth: width, imageHeight: height });
    const alt = cleanLine(meta.imageAlt, LIMITS.imageAlt);
    if (alt) out.imageAlt = alt;
  }
  if (OG_TYPES.has(meta.ogType)) out.ogType = meta.ogType;
  const author = asRecord(meta.author);
  const authorName = cleanLine(author?.name, LIMITS.author);
  if (authorName) out.author = isShareUrl(author.url) ? { name: authorName, url: author.url } : { name: authorName };
  const extra = asArray(meta.extra)
    .filter((entry) => Array.isArray(entry) && EXTRA_PROPERTY.test(entry[0]))
    .map(([property, content]) => [property, cleanLine(String(content ?? ''), LIMITS.extra)])
    .filter(([, content]) => content && (!/^https?:/i.test(content) || isShareUrl(content)))
    .slice(0, LIMITS.extraCount);
  if (extra.length > 0) out.extra = extra;
  return out;
}

export function createMetaResolver({
  resolvers = RESOLVERS,
  innertube = createInnertube(),
  youtube = createInnertube({ site: 'youtube' }),
  fetchJson = createFetchJson(),
  budgetMs = 2500,
  ttlMs = 30 * 60 * 1000,
  missTtlMs = 60 * 1000,
  maxEntries = 500,
  now = Date.now,
} = {}) {
  const deps = { innertube, youtube, fetchJson, shareUrl };
  // settled results only: workers must not share in-flight promises across requests
  const cache = new Map();

  async function lookup(type, id) {
    const resolver = resolvers[type];
    if (!resolver) return null;
    let timer;
    const budget = new Promise((resolve) => {
      timer = setTimeout(resolve, budgetMs, null);
    });
    try {
      return sanitizeMeta(await Promise.race([resolver(id, deps), budget]));
    } catch {
      // upstream down, blocked or reshaped: generic card, never an error page
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return async function resolveMeta(type, id) {
    const key = `${type}:${id}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.meta;
    const meta = await lookup(type, id);
    cache.delete(key);
    cache.set(key, { meta, expires: now() + (meta ? ttlMs : missTtlMs) });
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return meta;
  };
}
