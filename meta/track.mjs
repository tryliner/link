// track share previews: title, artists, album, length and square cover from the
// youtube music `next` queue (the same call the desktop app makes for a track),
// youtube oembed when that call fails. null keeps the generic card.
import {
  asRecord,
  bestThumbnail,
  browseEndpointOf,
  formatDuration,
  getRuns,
  getText,
  joinParts,
  pageTypeOf,
  parseDuration,
  walkRecords,
} from '../yt.mjs';

const ARTIST_PAGES = new Set(['MUSIC_PAGE_TYPE_ARTIST', 'MUSIC_PAGE_TYPE_USER_CHANNEL']);

function browseIdOf(run) {
  const id = browseEndpointOf(run)?.browseId;
  return typeof id === 'string' ? id : '';
}

// queue entry for exactly this id, plain or inside the wrapper that pairs a song
// with its music video (primaryRenderer / counterpart), never another track
function queueEntry(body, id) {
  let found;
  walkRecords(body, (record) => {
    const renderer = asRecord(record.playlistPanelVideoRenderer);
    if (!found && renderer?.videoId === id) found = renderer;
    return Boolean(found);
  });
  return found;
}

// "Artist & Artist • Album • 2024" for songs, "Artist • 2.1M views" for videos: the
// first segment is the credit, an album only counts when it links to one
function byline(value) {
  const runs = getRuns(value).filter((run) => typeof run.text === 'string');
  const cut = runs.findIndex((run) => run.text.trim() === '•');
  const credit = cut === -1 ? runs : runs.slice(0, cut);
  const albumRun = runs.find(
    (run) => pageTypeOf(run) === 'MUSIC_PAGE_TYPE_ALBUM' || browseIdOf(run).startsWith('MPRE'),
  );
  return {
    credit: credit.map((run) => run.text).join('').trim(),
    artistIds: credit
      .filter((run) => ARTIST_PAGES.has(pageTypeOf(run)) || browseIdOf(run).startsWith('UC'))
      .map(browseIdOf)
      .filter(Boolean),
    album: albumRun && browseIdOf(albumRun) ? { id: browseIdOf(albumRun), title: albumRun.text.trim() } : undefined,
  };
}

function trackPreview({ title, credit, artistIds = [], album, seconds, cover }, shareUrl) {
  const artistLinks = artistIds.map((artistId) => shareUrl('artist', artistId)).filter(Boolean);
  const albumLink = album && shareUrl('album', album.id);
  // singles link an "album" named like the track, no point repeating it
  const albumTitle = album && album.title.toLowerCase() !== title.toLowerCase() ? album.title : undefined;
  const extra = [
    ...(seconds ? [['music:duration', String(seconds)]] : []),
    ...artistLinks.map((url) => ['music:musician', url]),
    ...(albumLink ? [['music:album', albumLink]] : []),
  ];
  return {
    title,
    description: joinParts([credit, albumTitle, seconds ? formatDuration(seconds) : undefined]),
    ...(cover ? { image: cover.url, imageWidth: cover.width, imageHeight: cover.height, imageAlt: `${title} cover` } : {}),
    ogType: 'music.song',
    ...(credit ? { author: { name: credit, ...(artistLinks[0] ? { url: artistLinks[0] } : {}) } } : {}),
    ...(extra.length > 0 ? { extra } : {}),
  };
}

function nextTrackMeta(body, id, shareUrl) {
  const entry = queueEntry(body, id);
  const title = getText(entry?.title);
  if (!title) return null;
  return trackPreview(
    {
      title,
      ...byline(entry.longBylineText ?? entry.shortBylineText),
      seconds: parseDuration(getText(entry.lengthText)),
      cover: bestThumbnail(entry.thumbnail),
    },
    shareUrl,
  );
}

// youtube's public oembed only knows the title, the channel and the video thumbnail
async function oembedTrackMeta(id, fetchJson, shareUrl) {
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const data = asRecord(await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`));
  const title = typeof data?.title === 'string' ? data.title.trim() : '';
  if (!title) return null;
  // auto-generated song uploads live on "Artist - Topic" channels
  const credit = typeof data.author_name === 'string' ? data.author_name.replace(/\s+-\s+Topic$/, '').trim() : '';
  const cover =
    typeof data.thumbnail_url === 'string'
      ? { url: data.thumbnail_url, width: data.thumbnail_width, height: data.thumbnail_height }
      : undefined;
  return trackPreview({ title, credit, cover }, shareUrl);
}

export async function resolveTrackMeta(id, { innertube, fetchJson, shareUrl }) {
  try {
    const meta = nextTrackMeta(await innertube('next', { videoId: id }), id, shareUrl);
    if (meta) return meta;
  } catch {
    // blocked or reshaped, try oembed below
  }
  return fetchJson ? oembedTrackMeta(id, fetchJson, shareUrl) : null;
}
