// track preview tests: fixtures mirror youtube music `next` and youtube oembed replies, no network
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTrackMeta } from './track.mjs';
import { createMetaResolver } from '../meta.mjs';
import { renderOpenPage } from '../page.mjs';
import { deeplink, shareUrl } from '../share.mjs';
import { formatDuration, parseDuration } from '../yt.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const NEXT = fixture('track-next-song.json');
const OEMBED = fixture('track-oembed.json');

const ARTIST = 'https://link.tryliner.fun/artist?id=UCGtGpOIGHfRu1KYL9pi-mNQ';
const SECOND_ARTIST = 'https://link.tryliner.fun/artist?id=UCmaraVale000000000000aa';
const ALBUM = 'https://link.tryliner.fun/album?id=MPREb_xCxkOKReFZv';

// fake clients that record what the resolver asked for, an Error value makes the call reject
function deps({ next = NEXT, oembed = OEMBED } = {}) {
  const calls = [];
  return {
    calls,
    shareUrl,
    innertube: async (endpoint, body) => {
      calls.push(['innertube', endpoint, body]);
      if (next instanceof Error) throw next;
      return structuredClone(next);
    },
    fetchJson: async (url) => {
      calls.push(['fetchJson', url]);
      if (oembed instanceof Error) throw oembed;
      return structuredClone(oembed);
    },
  };
}

// queue entry of the shared song, so a test can change one field at a time
const songEntry = (body) =>
  body.contents.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer.watchNextTabbedResultsRenderer.tabs[0]
    .tabRenderer.content.musicQueueRenderer.content.playlistPanelRenderer.contents[0]
    .playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer;

test('song: one next call gives title, credits, album, length and a square cover', async () => {
  const d = deps();
  const meta = await resolveTrackMeta('RGdkabupfPI', d);
  assert.deepEqual(d.calls, [['innertube', 'next', { videoId: 'RGdkabupfPI' }]]);
  assert.deepEqual(meta, {
    title: 'Night Drive',
    description: 'Neon Coast & Mara Vale · Afterglow · 3:41',
    image: 'https://lh3.googleusercontent.com/fixture-cover=w544-h544-p-l90-rj',
    imageWidth: 544,
    imageHeight: 544,
    imageAlt: 'Night Drive cover',
    ogType: 'music.song',
    author: { name: 'Neon Coast & Mara Vale', url: ARTIST },
    extra: [
      ['music:duration', '221'],
      ['music:musician', ARTIST],
      ['music:musician', SECOND_ARTIST],
      ['music:album', ALBUM],
    ],
  });
});

test('small or unsized artwork comes back as a 544 px square', async () => {
  const body = structuredClone(NEXT);
  const song = songEntry(body);
  song.thumbnail.thumbnails = song.thumbnail.thumbnails.slice(0, 2);
  let meta = await resolveTrackMeta('RGdkabupfPI', deps({ next: body }));
  assert.equal(meta.image, 'https://lh3.googleusercontent.com/fixture-cover=w544-h544-p-l90-rj');

  song.thumbnail.thumbnails = [{ url: 'https://lh3.googleusercontent.com/bare' }];
  meta = await resolveTrackMeta('RGdkabupfPI', deps({ next: body }));
  assert.equal(meta.image, 'https://lh3.googleusercontent.com/bare=w544-h544-p-l90-rj');
  assert.equal(meta.imageWidth, 544);
  assert.equal(meta.imageHeight, 544);
});

test('a music video shared by its own id reads its counterpart entry, view counts never show', async () => {
  const meta = await resolveTrackMeta('nightDrive1', deps());
  assert.equal(meta.title, 'Night Drive (Official Video)');
  assert.equal(meta.description, 'Neon Coast · 3:58');
  assert.equal(meta.image, 'https://i.ytimg.com/vi/nightDrive1/hq720.jpg?sqp=fixture-large');
  assert.equal(meta.imageWidth, 1280);
  assert.equal(meta.imageHeight, 720);
  assert.deepEqual(meta.author, { name: 'Neon Coast', url: ARTIST });
  assert.deepEqual(meta.extra, [
    ['music:duration', '238'],
    ['music:musician', ARTIST],
  ]);
});

test('plain queue entries work, unlinked byline text is never taken for an album', async () => {
  const meta = await resolveTrackMeta('radioNext01', deps());
  assert.equal(meta.title, 'Coastline');
  assert.equal(meta.description, 'Mara Vale · 1:02:03');
  assert.equal(meta.image, 'https://yt3.ggpht.com/fixture-single=w544-h544-p-l90-rj');
  assert.deepEqual(meta.extra, [
    ['music:duration', '3723'],
    ['music:musician', SECOND_ARTIST],
  ]);
});

test('a single named like the track keeps its album link but is not repeated', async () => {
  const body = structuredClone(NEXT);
  songEntry(body).longBylineText.runs[4].text = 'NIGHT DRIVE';
  const meta = await resolveTrackMeta('RGdkabupfPI', deps({ next: body }));
  assert.equal(meta.description, 'Neon Coast & Mara Vale · 3:41');
  assert.deepEqual(meta.extra.at(-1), ['music:album', ALBUM]);
});

test('no length and an unlinked uploader: no duration, no artist links', async () => {
  const body = structuredClone(NEXT);
  const song = songEntry(body);
  delete song.lengthText;
  song.longBylineText = { runs: [{ text: 'Uploader Name' }, { text: ' • ' }, { text: '12K views' }] };
  const meta = await resolveTrackMeta('RGdkabupfPI', deps({ next: body }));
  assert.equal(meta.description, 'Uploader Name');
  assert.deepEqual(meta.author, { name: 'Uploader Name' });
  assert.equal(meta.extra, undefined);
});

test('never borrows another queue entry: an unknown id goes to oembed', async () => {
  const other = {
    title: 'Some Upload',
    author_name: 'Some Channel',
    thumbnail_url: 'https://i.ytimg.com/vi/zzzzzzzzzzz/hqdefault.jpg',
    thumbnail_width: 480,
    thumbnail_height: 360,
  };
  const d = deps({ oembed: other });
  const meta = await resolveTrackMeta('zzzzzzzzzzz', d);
  assert.deepEqual(d.calls[1], [
    'fetchJson',
    'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dzzzzzzzzzzz&format=json',
  ]);
  assert.deepEqual(meta, {
    title: 'Some Upload',
    description: 'Some Channel',
    image: 'https://i.ytimg.com/vi/zzzzzzzzzzz/hqdefault.jpg',
    imageWidth: 480,
    imageHeight: 360,
    imageAlt: 'Some Upload cover',
    ogType: 'music.song',
    author: { name: 'Some Channel' },
  });
});

test('innertube down: the oembed fallback drops the " - Topic" channel suffix', async () => {
  const meta = await resolveTrackMeta('RGdkabupfPI', deps({ next: new Error('innertube next failed with HTTP 429') }));
  assert.equal(meta.title, 'Night Drive');
  assert.equal(meta.description, 'Neon Coast');
  assert.equal(meta.image, 'https://i.ytimg.com/vi/RGdkabupfPI/hqdefault.jpg');
  assert.equal(meta.extra, undefined);
});

test('nothing usable gives null, a failing fallback reaches the caller', async () => {
  assert.equal(await resolveTrackMeta('RGdkabupfPI', deps({ next: {}, oembed: { title: '  ' } })), null);
  const { innertube } = deps({ next: {} });
  assert.equal(await resolveTrackMeta('RGdkabupfPI', { innertube, shareUrl }), null);
  await assert.rejects(resolveTrackMeta('RGdkabupfPI', deps({ next: new Error('down'), oembed: new Error('HTTP 404') })));
});

test('end to end: the track page carries the sanitized preview as open graph tags', async () => {
  const { innertube, fetchJson } = deps();
  const resolveMeta = createMetaResolver({ innertube, fetchJson });
  const meta = await resolveMeta('track', 'RGdkabupfPI');
  const html = renderOpenPage({ deep: deeplink('track', 'RGdkabupfPI'), type: 'track', meta });
  for (const tag of [
    '<title>Night Drive • Liner</title>',
    '<meta property="og:type" content="music.song">',
    '<meta property="og:title" content="Night Drive">',
    '<meta property="og:description" content="Neon Coast &amp; Mara Vale · Afterglow · 3:41">',
    '<meta property="og:image" content="https://lh3.googleusercontent.com/fixture-cover=w544-h544-p-l90-rj">',
    '<meta property="og:image:width" content="544">',
    '<meta property="og:image:height" content="544">',
    '<meta name="twitter:card" content="summary">',
    '<meta property="music:duration" content="221">',
    `<meta property="music:musician" content="${ARTIST}">`,
    `<meta property="music:album" content="${ALBUM}">`,
  ]) {
    assert.ok(html.includes(tag), `missing ${tag}`);
  }
  // people clicking the link still bounce straight into the app
  assert.ok(html.includes('liner://track?id=RGdkabupfPI'));
});

test('end to end: hostile upstream data is escaped or dropped, failures keep the generic card', async () => {
  const hostile = {
    title: 'Night <script>alert(1)</script> "Drive"',
    author_name: 'Neon\u202e Coast - Topic',
    thumbnail_url: 'https://evil.example/cover.jpg',
    thumbnail_width: 480,
    thumbnail_height: 360,
  };
  const { innertube, fetchJson } = deps({ next: new Error('down'), oembed: hostile });
  const meta = await createMetaResolver({ innertube, fetchJson })('track', 'RGdkabupfPI');
  const html = renderOpenPage({ deep: deeplink('track', 'RGdkabupfPI'), type: 'track', meta });
  assert.ok(html.includes('<meta property="og:title" content="Night &lt;script&gt;alert(1)&lt;/script&gt; &quot;Drive&quot;">'));
  assert.ok(html.includes('<meta property="og:description" content="Neon Coast">'));
  assert.doesNotMatch(html, /<script>alert|evil\.example|og:image|\u202e/);

  const down = deps({ next: new Error('down'), oembed: new Error('HTTP 404') });
  const generic = await createMetaResolver(down)('track', 'RGdkabupfPI');
  assert.equal(generic, null);
  const plain = renderOpenPage({ deep: deeplink('track', 'RGdkabupfPI'), type: 'track', meta: generic });
  assert.ok(plain.includes('<meta property="og:title" content="Track • Liner">'));
});

test('durations parse and print like the app shows them', () => {
  assert.equal(parseDuration('3:41'), 221);
  assert.equal(parseDuration(' 1:02:03 '), 3723);
  assert.equal(parseDuration('0:59'), 59);
  for (const text of ['0:00', '3:61', '1:60:00', '3 minutes', '', undefined]) {
    assert.equal(parseDuration(text), undefined, String(text));
  }
  assert.equal(formatDuration(221), '3:41');
  assert.equal(formatDuration(59), '0:59');
  assert.equal(formatDuration(3723), '1:02:03');
});
