// playlist and album preview resolvers against trimmed youtube music browse responses
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shareUrl } from '../share.mjs';
import { describeCollection, playlistBrowseId, resolveAlbumMeta, resolvePlaylistMeta } from './playlist.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

// stands in for the shared clients, records every call
function deps({ browse, oembed } = {}) {
  const calls = [];
  return {
    calls,
    shareUrl,
    innertube: async (endpoint, body) => {
      calls.push([endpoint, body]);
      if (browse instanceof Error) throw browse;
      return browse;
    },
    fetchJson: async (url) => {
      calls.push(['fetchJson', url]);
      if (!oembed || oembed instanceof Error) throw oembed ?? new Error('no oembed');
      return oembed;
    },
  };
}

test('catalog playlist shows title, cover, owner, size and the first tracks', async () => {
  const d = deps({ browse: fixture('playlist-browse.json') });
  const meta = await resolvePlaylistMeta('PLx4mDc2tQn8sUs2dW3m1c5uLwJqVv0kYb', d);
  assert.deepEqual(d.calls, [['browse', { browseId: 'VLPLx4mDc2tQn8sUs2dW3m1c5uLwJqVv0kYb' }]]);
  assert.deepEqual(meta, {
    title: 'Late Night Drive',
    description: [
      'Playlist · Liner Picks · 24 tracks · 1 hour, 32 minutes',
      '1. Neon Harbor · Mara Vale',
      '2. Night Drive · Neon Coast & Mara Vale',
      '3. Glass City · The Static Hours',
      '4. Low Tide · Mara Vale',
      '5. Overpass · Kilo Echo',
      '+19 more',
    ].join('\n'),
    image: 'https://lh3.googleusercontent.com/late-night-art=w544-h544-p-l90-rj',
    imageWidth: 544,
    imageHeight: 544,
    imageAlt: 'Late Night Drive cover',
    ogType: 'music.playlist',
    // a user channel is not a liner artist, so no link
    author: { name: 'Liner Picks' },
  });
});

test('browse ids follow the desktop rule, liner playlists never reach youtube', async () => {
  assert.equal(playlistBrowseId('VLPLx4mDc2tQn8sUs2dW3m1c5uLwJqVv0kYb'), 'VLPLx4mDc2tQn8sUs2dW3m1c5uLwJqVv0kYb');
  assert.equal(playlistBrowseId('RDCLAK5uy_kmPRjHDECIcuVwnKsx2Ng7fyNgFKWNJFs'), 'VLRDCLAK5uy_kmPRjHDECIcuVwnKsx2Ng7fyNgFKWNJFs');
  assert.equal(playlistBrowseId('MPREb_afterglow01'), 'MPREb_afterglow01');
  for (const id of ['11111111-1111-4111-8111-111111111111', 'pl-abc123']) {
    assert.equal(playlistBrowseId(id), undefined);
    const d = deps({ browse: fixture('playlist-browse.json'), oembed: fixture('playlist-oembed.json') });
    assert.equal(await resolvePlaylistMeta(id, d), null);
    assert.deepEqual(d.calls, []);
  }
});

test('album lists titles only, links the artists and keeps the release year', async () => {
  const d = deps({ browse: fixture('album-browse.json') });
  const meta = await resolveAlbumMeta('MPREb_afterglow01', d);
  assert.deepEqual(d.calls, [['browse', { browseId: 'MPREb_afterglow01' }]]);
  assert.deepEqual(meta, {
    title: 'Afterglow',
    description: [
      'Album · Mara Vale & Neon Coast · 2025 · 9 songs · 34 minutes',
      '1. Harbor Lights',
      '2. Night Drive',
      '3. Low Tide',
      '4. Undertow',
      '5. Salt & Static',
      '+4 more',
    ].join('\n'),
    image: 'https://lh3.googleusercontent.com/afterglow-art=w544-h544-p-l90-rj',
    imageWidth: 544,
    imageHeight: 544,
    imageAlt: 'Afterglow cover',
    ogType: 'music.album',
    author: { name: 'Mara Vale & Neon Coast', url: 'https://link.tryliner.fun/artist?id=UCmaravale0000000000000a' },
    extra: [
      ['music:musician', 'https://link.tryliner.fun/artist?id=UCmaravale0000000000000a'],
      ['music:musician', 'https://link.tryliner.fun/artist?id=UCneoncoast000000000000a'],
    ],
  });
});

test('short playlists have no "+N more" line, long rows are clipped', async () => {
  const body = fixture('playlist-browse.json');
  const shelf = body.contents.twoColumnBrowseResultsRenderer.secondaryContents.sectionListRenderer.contents[0];
  shelf.musicPlaylistShelfRenderer.contents = shelf.musicPlaylistShelfRenderer.contents.slice(0, 2);
  const header = body.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0];
  header.musicResponsiveHeaderRenderer.secondSubtitle = { runs: [{ text: '2 tracks' }] };
  shelf.musicPlaylistShelfRenderer.contents[0].musicResponsiveListItemRenderer.flexColumns[0] = {
    musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'A'.repeat(90) }] } },
  };
  const meta = await resolvePlaylistMeta('PLx4mDc2tQn8sUs2dW3m1c5uLwJqVv0kYb', deps({ browse: body }));
  const lines = meta.description.split('\n');
  assert.equal(lines[0], 'Playlist · Liner Picks · 2 tracks');
  assert.equal(lines.length, 3);
  assert.equal(Array.from(lines[1]).length, 60);
  assert.ok(lines[1].endsWith('…'));
  assert.equal(lines[2], '2. Night Drive · Neon Coast & Mara Vale');
});

test('descriptions stay under the discord budget and still count what is left', () => {
  const tracks = Array.from({ length: 50 }, (_, i) => ({ title: `${'Long title '.repeat(6)}${i}`, artist: 'Artist' }));
  const text = describeCollection({ summary: 'Playlist · Owner · 50 tracks', tracks, total: 50, withArtists: true });
  const lines = text.split('\n');
  assert.ok(text.length <= 340, `${text.length} chars`);
  const listed = lines.length - 2;
  assert.ok(listed >= 1 && listed <= 5);
  assert.equal(lines.at(-1), `+${50 - listed} more`);
});

test('a blocked browse call falls back to youtube oembed', async () => {
  const d = deps({ browse: new Error('innertube browse failed with HTTP 429'), oembed: fixture('playlist-oembed.json') });
  const meta = await resolvePlaylistMeta('VLPLx4mDc2tQn8sUs2dW3m1c5uLwJqVv0kYb', d);
  assert.deepEqual(d.calls.at(-1), [
    'fetchJson',
    'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fplaylist%3Flist%3DPLx4mDc2tQn8sUs2dW3m1c5uLwJqVv0kYb&format=json',
  ]);
  assert.deepEqual(meta, {
    title: 'Late Night Drive',
    description: 'Playlist · Liner Picks',
    image: 'https://i.ytimg.com/vi/aaaaaaaaaa1/hqdefault.jpg',
    imageWidth: 480,
    imageHeight: 360,
    imageAlt: 'Late Night Drive cover',
    ogType: 'music.playlist',
    author: { name: 'Liner Picks' },
  });
});

test('a response without a header also tries oembed, albums give up', async () => {
  const d = deps({ browse: {}, oembed: fixture('playlist-oembed.json') });
  assert.equal((await resolvePlaylistMeta('PLx4mDc2tQn8sUs2dW3m1c5uLwJqVv0kYb', d)).title, 'Late Night Drive');
  assert.equal(await resolveAlbumMeta('MPREb_afterglow01', deps({ browse: {} })), null);
  assert.equal(await resolveAlbumMeta('MPREb_afterglow01', deps({ browse: null })), null);
});

test('failures reach the caller so the generic page is served', async () => {
  await assert.rejects(
    resolvePlaylistMeta('PLx4mDc2tQn8sUs2dW3m1c5uLwJqVv0kYb', deps({ browse: new Error('down'), oembed: new Error('oembed down') })),
    /oembed down/,
  );
  await assert.rejects(resolveAlbumMeta('MPREb_afterglow01', deps({ browse: new Error('down') })), /down/);
});
