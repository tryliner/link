// playlist and album share previews: title, cover, track count and length, plus the
// first tracks so the card shows what is inside (like spotify cards do). reads the
// same youtube music browse call the desktop app makes for the collection page.
import {
  asArray,
  asRecord,
  bestThumbnail,
  browseEndpointOf,
  clip,
  findFirst,
  getRuns,
  getText,
  joinParts,
  pageTypeOf,
  parseDuration,
  textParts,
  walkRecords,
} from '../yt.mjs';

// liner playlists (uuid / pl-…) live on the liner api, which only answers signed
// app requests: they keep the generic card
const USER_PLAYLIST = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|pl-[A-Za-z0-9_-]+)$/i;

const LISTED = 5; // tracks spelled out in the card
const LINE_CHARS = 60;
const DESCRIPTION_CHARS = 340; // discord cuts long descriptions, keep the "+N more" line visible

const KINDS = new Set(['Playlist', 'Album', 'EP', 'Single']);
const COUNT = /^(\d[\d,]*)\+?\s+(?:tracks?|songs?|episodes?|videos?)$/i;
const LENGTH = /^\d[\d,.]*\+?\s+(?:hours?|minutes?|seconds?)\b/i;

// same browse id rule as the desktop app (innertubeCollections.ts)
export function playlistBrowseId(id) {
  if (USER_PLAYLIST.test(id)) return undefined;
  return /^(VL|MPRE|UC|FE)/.test(id) ? id : `VL${id}`;
}

function flexColumn(renderer, index) {
  const column = asRecord(asArray(renderer.flexColumns)[index]);
  return asRecord(column?.musicResponsiveListItemFlexColumnRenderer)?.text;
}

// one row of the track shelf -> { id, title, artist }
function trackRow(renderer) {
  const title = getText(flexColumn(renderer, 0));
  if (!title) return undefined;
  const titleRun = getRuns(flexColumn(renderer, 0))[0];
  const id =
    asRecord(renderer.playlistItemData)?.videoId ??
    asRecord(asRecord(titleRun?.navigationEndpoint)?.watchEndpoint)?.videoId;
  // second column is "Artist" on playlists, featured artists or a play count on albums
  const artist = textParts(flexColumn(renderer, 1))[0];
  const isArtist = artist && !parseDuration(artist) && !/\bplays?$/i.test(artist);
  return { id: typeof id === 'string' ? id : undefined, title, artist: isArtist ? artist : undefined };
}

export function collectTracks(body) {
  const rows = [];
  const seen = new Set();
  walkRecords(body, (record) => {
    const renderer = asRecord(record.musicResponsiveListItemRenderer);
    if (!renderer) return false;
    const row = trackRow(renderer);
    const key = row && (row.id ?? `${row.title}\n${row.artist ?? ''}`);
    if (row && !seen.has(key)) {
      seen.add(key);
      rows.push(row);
    }
    return true;
  });
  return rows;
}

function countOf(text) {
  const match = text?.match(COUNT);
  return match ? Number(match[1].replace(/,/g, '')) : undefined;
}

// "Playlist · Owner · 24 tracks · 1 hour" then "1. Title · Artist" lines and "+19 more"
export function describeCollection({ summary, tracks, total, withArtists }) {
  const lines = [summary];
  let used = summary.length;
  let listed = 0;
  for (const track of tracks.slice(0, LISTED)) {
    const line = clip(`${listed + 1}. ${joinParts([track.title, withArtists ? track.artist : undefined])}`, LINE_CHARS);
    // keep room for the "+N more" line
    if (used + line.length + 16 > DESCRIPTION_CHARS) break;
    lines.push(line);
    used += line.length + 1;
    listed += 1;
  }
  const rest = Math.max(total ?? 0, tracks.length) - listed;
  if (listed > 0 && rest > 0) lines.push(`+${rest} more`);
  return lines.join('\n');
}

function collectionMeta(body, { album, shareUrl }) {
  const header = findFirst(body, 'musicResponsiveHeaderRenderer');
  const title = getText(header?.title);
  if (!title) return null;
  const subtitle = textParts(header.subtitle);
  const kind = KINDS.has(subtitle[0]) ? subtitle[0] : album ? 'Album' : 'Playlist';
  const year = subtitle.find((part) => /^\d{4}$/.test(part));
  const owner = getText(header.straplineTextOne);
  const stats = textParts(header.secondSubtitle);
  const countText = stats.find((part) => COUNT.test(part));
  const lengthText = stats.find((part) => LENGTH.test(part));
  const tracks = collectTracks(body);
  const cover =
    bestThumbnail(header.thumbnail) ?? bestThumbnail(findFirst(body, 'microformatDataRenderer')?.thumbnail);
  const artistIds = getRuns(header.straplineTextOne)
    .filter((run) => pageTypeOf(run) === 'MUSIC_PAGE_TYPE_ARTIST')
    .map((run) => browseEndpointOf(run)?.browseId)
    .filter((browseId) => typeof browseId === 'string');
  const artistLinks = artistIds.map((artistId) => shareUrl('artist', artistId)).filter(Boolean);
  return {
    title,
    description: describeCollection({
      summary: joinParts([kind, owner, album ? year : undefined, countText, lengthText]),
      tracks,
      total: countOf(countText),
      withArtists: !album,
    }),
    ...(cover ? { image: cover.url, imageWidth: cover.width, imageHeight: cover.height, imageAlt: `${title} cover` } : {}),
    ogType: album ? 'music.album' : 'music.playlist',
    ...(owner ? { author: { name: owner, ...(artistLinks[0] ? { url: artistLinks[0] } : {}) } } : {}),
    ...(album && artistLinks.length > 0
      ? { extra: artistLinks.slice(0, 3).map((url) => ['music:musician', url]) }
      : {}),
  };
}

// youtube's public oembed only knows title, channel and the first video's thumbnail,
// still better than nothing when the browse call is blocked
async function oembedPlaylistMeta(id, fetchJson) {
  const list = id.startsWith('VL') ? id.slice(2) : id;
  const page = `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`;
  const data = asRecord(
    await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(page)}&format=json`),
  );
  const title = typeof data?.title === 'string' ? data.title : undefined;
  if (!title) return null;
  const owner = typeof data.author_name === 'string' ? data.author_name : undefined;
  const image = typeof data.thumbnail_url === 'string' ? data.thumbnail_url : undefined;
  return {
    title,
    description: joinParts(['Playlist', owner]),
    ...(image
      ? { image, imageWidth: data.thumbnail_width, imageHeight: data.thumbnail_height, imageAlt: `${title} cover` }
      : {}),
    ogType: 'music.playlist',
    ...(owner ? { author: { name: owner } } : {}),
  };
}

export async function resolvePlaylistMeta(id, { innertube, fetchJson, shareUrl }) {
  const browseId = playlistBrowseId(id);
  if (!browseId) return null;
  try {
    const meta = collectionMeta(await innertube('browse', { browseId }), { album: false, shareUrl });
    if (meta) return meta;
  } catch {
    // blocked or reshaped, try oembed below
  }
  return /^(MPRE|UC|FE)/.test(id) || !fetchJson ? null : oembedPlaylistMeta(id, fetchJson);
}

export async function resolveAlbumMeta(id, { innertube, shareUrl }) {
  return collectionMeta(await innertube('browse', { browseId: id }), { album: true, shareUrl });
}
