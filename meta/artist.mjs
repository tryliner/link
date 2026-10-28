// artist share previews: name, profile picture and monthly audience. name and audience come
// from the same youtube music browse call the desktop app makes for the artist page, whose
// header only has a wide banner; the profile picture comes from the artist's youtube channel.
import { bestThumbnail, findFirst, getText, joinParts } from '../yt.mjs';

// same header lookup order as the desktop app (innertubeArtistMapper.ts)
const HEADERS = [
  'musicImmersiveHeaderRenderer',
  'musicVisualHeaderRenderer',
  'musicHeaderRenderer',
  'musicResponsiveHeaderRenderer',
];

// "1.2M monthly audience", alone or inside an "Artist • 3.4K monthly audience" subtitle
const LISTENERS = /([\d.,]+\s?[KMB]?)\s+monthly (?:audience|listeners)/i;

function artistHeader(body) {
  for (const key of HEADERS) {
    const header = findFirst(body, key);
    if (header) return header;
  }
  return undefined;
}

function monthlyListeners(header) {
  for (const value of [header.monthlyListenerCount, header.subtitle, header.secondSubtitle]) {
    const count = getText(value)?.match(LISTENERS)?.[1];
    if (count) return `${count.replace(/\s/g, '')} monthly listeners`;
  }
  return undefined;
}

export async function resolveArtistMeta(id, { innertube, youtube }) {
  // both at once; without the channel the youtube music images below still give a picture
  const [body, channel] = await Promise.all([
    innertube('browse', { browseId: id }),
    youtube ? youtube('browse', { browseId: id }).catch(() => null) : null,
  ]);
  const header = artistHeader(body);
  const title = getText(header?.title);
  if (!title) return null;
  // channel profile picture first, then the header's own, the page's preview image, the banner last
  const picture =
    bestThumbnail(findFirst(channel, 'channelMetadataRenderer')?.avatar) ??
    bestThumbnail(header.foregroundThumbnail) ??
    bestThumbnail(findFirst(body, 'microformatDataRenderer')?.thumbnail) ??
    bestThumbnail(header.thumbnail);
  return {
    title,
    description: joinParts(['Artist', monthlyListeners(header)]),
    ...(picture
      ? { image: picture.url, imageWidth: picture.width, imageHeight: picture.height, imageAlt: title }
      : {}),
    ogType: 'profile',
  };
}
