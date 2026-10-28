// preview core: sanitizing, time budget, cache, and the youtube music client (no network)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaResolver, isShareUrl, sanitizeMeta } from './meta.mjs';
import { createFetchJson, createInnertube, WEB, WEB_REMIX } from './innertube.mjs';
import { shareUrl } from './share.mjs';

const ARTIST = 'https://link.tryliner.fun/artist?id=UCGtGpOIGHfRu1KYL9pi-mNQ';

test('sanitize keeps a clean preview as is', () => {
  const meta = {
    title: 'Late Night Drive',
    description: 'Playlist · Liner Picks\n1. Neon Harbor · Mara Vale',
    image: 'https://lh3.googleusercontent.com/art=w544-h544-p-l90-rj',
    imageWidth: 544,
    imageHeight: 544,
    imageAlt: 'Late Night Drive cover',
    ogType: 'music.playlist',
    author: { name: 'Mara Vale', url: ARTIST },
    extra: [['music:musician', ARTIST], ['music:duration', '221']],
  };
  assert.deepEqual(sanitizeMeta(meta), meta);
});

test('sanitize drops images outside the youtube cdns', () => {
  for (const image of [
    'http://lh3.googleusercontent.com/art',
    'https://evil.example/art.jpg',
    'https://lh3.googleusercontent.com.evil.example/art',
    'https://i.ytimg.com/vi/x/hq.jpg" onload="alert(1)',
    'javascript:alert(1)',
    '//yt3.ggpht.com/art',
    42,
  ]) {
    const meta = sanitizeMeta({ title: 't', image, imageWidth: 10, imageHeight: 10, imageAlt: 'alt' });
    assert.deepEqual(meta, { title: 't' }, String(image));
  }
  for (const image of [
    'https://i.ytimg.com/vi/RGdkabupfPI/hqdefault.jpg',
    'https://yt3.ggpht.com/a=s544',
    'https://yt3.googleusercontent.com/a=s544',
    'https://lh5.googleusercontent.com/a=w544-h544',
  ]) {
    assert.equal(sanitizeMeta({ title: 't', image }).image, image);
  }
});

test('sanitize strips control and bidi characters and bounds lengths', () => {
  const meta = sanitizeMeta({
    title: ` A\u0000B\u202eC\tD  ${'x'.repeat(200)}`,
    description: 'line one\r\n\u0007line\u2066 two\n\n\n',
    imageAlt: 'y'.repeat(300),
  });
  assert.equal(Array.from(meta.title).length, 100);
  assert.ok(meta.title.startsWith('A B C D x'));
  assert.ok(meta.title.endsWith('…'));
  assert.equal(meta.description, 'line one\nline two');
  // alt only makes sense next to an image
  assert.equal(meta.imageAlt, undefined);
  assert.ok(Array.from(sanitizeMeta({ title: 't', description: 'd'.repeat(1000) }).description).length <= 350);
});

test('sanitize needs a title and only knows the expected fields', () => {
  assert.equal(sanitizeMeta(null), null);
  assert.equal(sanitizeMeta({}), null);
  assert.equal(sanitizeMeta({ title: ' \n\t ' }), null);
  assert.equal(sanitizeMeta({ title: ['a'] }), null);
  const meta = sanitizeMeta({
    title: 't',
    ogType: 'article',
    script: '<script>',
    image: 'https://i.ytimg.com/vi/x/hq.jpg',
    imageWidth: -5,
    imageHeight: 1e9,
    author: { name: 'Owner', url: 'https://evil.example/' },
  });
  assert.deepEqual(meta, { title: 't', image: 'https://i.ytimg.com/vi/x/hq.jpg', author: { name: 'Owner' } });
});

test('extras are limited to music and profile tags with liner links', () => {
  const meta = sanitizeMeta({
    title: 't',
    extra: [
      ['music:duration', 221],
      ['og:title', 'spoofed'],
      ['music:musician', 'https://evil.example/artist'],
      ['music:album', 'https://link.tryliner.fun/album?id=MPREb_xCxkOKReFZv'],
      ['music:musician', 'https://link.tryliner.fun/artist?id=javascript:alert(1)'],
      ['MUSIC:duration', '1'],
      ['music:"onload', '1'],
      'music:duration',
    ],
  });
  assert.deepEqual(meta.extra, [
    ['music:duration', '221'],
    ['music:album', 'https://link.tryliner.fun/album?id=MPREb_xCxkOKReFZv'],
  ]);
});

test('share urls are canonical link.tryliner.fun links with valid ids', () => {
  assert.equal(shareUrl('artist', 'UCGtGpOIGHfRu1KYL9pi-mNQ'), ARTIST);
  assert.equal(shareUrl('track', 'RGdkabupfPI'), 'https://link.tryliner.fun/track?id=RGdkabupfPI');
  assert.equal(shareUrl('artist', 'not-an-artist'), undefined);
  assert.equal(shareUrl('evil', 'RGdkabupfPI'), undefined);
  assert.equal(shareUrl('track', undefined), undefined);
  assert.ok(isShareUrl(ARTIST));
  assert.ok(!isShareUrl(`${ARTIST}&next=liner://evil`));
  assert.ok(!isShareUrl('http://link.tryliner.fun/track?id=RGdkabupfPI'));
  assert.ok(!isShareUrl('https://link.tryliner.fun.evil.example/track?id=RGdkabupfPI'));
});

test('resolver gets the shared clients and its result is sanitized', async () => {
  const seen = [];
  const innertube = async () => ({});
  const youtube = async () => ({});
  const fetchJson = async () => ({});
  const resolveMeta = createMetaResolver({
    innertube,
    youtube,
    fetchJson,
    resolvers: {
      playlist: async (id, deps) => {
        seen.push([id, deps]);
        return { title: 'Mix\u0000', image: 'https://evil.example/x.jpg' };
      },
    },
  });
  assert.deepEqual(await resolveMeta('playlist', 'PLabcdefgh'), { title: 'Mix' });
  assert.equal(seen[0][0], 'PLabcdefgh');
  assert.equal(seen[0][1].innertube, innertube);
  assert.equal(seen[0][1].youtube, youtube);
  assert.equal(seen[0][1].fetchJson, fetchJson);
  assert.equal(seen[0][1].shareUrl, shareUrl);
  assert.equal(await resolveMeta('album', 'MPREb_xCxkOKReFZv'), null);
});

test('errors and slow upstreams give null instead of holding the page', async () => {
  const resolveMeta = createMetaResolver({
    budgetMs: 20,
    resolvers: {
      track: async () => {
        throw new Error('innertube next failed with HTTP 429');
      },
      playlist: () => new Promise(() => {}),
    },
  });
  assert.equal(await resolveMeta('track', 'RGdkabupfPI'), null);
  const started = Date.now();
  assert.equal(await resolveMeta('playlist', 'PLabcdefgh'), null);
  assert.ok(Date.now() - started < 1000);
});

test('results are cached, misses for a shorter time, oldest entries evicted', async () => {
  let clock = 0;
  const calls = [];
  const resolveMeta = createMetaResolver({
    now: () => clock,
    ttlMs: 1000,
    missTtlMs: 100,
    maxEntries: 2,
    resolvers: {
      track: async (id) => {
        calls.push(id);
        return id === 'missmissmis' ? null : { title: id };
      },
    },
  });
  await resolveMeta('track', 'RGdkabupfPI');
  await resolveMeta('track', 'RGdkabupfPI');
  assert.deepEqual(calls, ['RGdkabupfPI']);
  clock = 1001;
  await resolveMeta('track', 'RGdkabupfPI');
  assert.equal(calls.length, 2);

  await resolveMeta('track', 'missmissmis');
  clock += 50;
  await resolveMeta('track', 'missmissmis');
  assert.equal(calls.length, 3);
  clock += 100;
  await resolveMeta('track', 'missmissmis');
  assert.equal(calls.length, 4);

  // third key pushes out the oldest one
  await resolveMeta('track', 'dQw4w9WgXcQ');
  await resolveMeta('track', 'RGdkabupfPI');
  assert.equal(calls.at(-1), 'RGdkabupfPI');
});

test('innertube posts the WEB_REMIX context to music.youtube.com', async () => {
  const requests = [];
  const innertube = createInnertube({
    fetch: async (url, init) => {
      requests.push([url, init]);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  assert.deepEqual(await innertube('browse', { browseId: 'VLPLabc' }), { ok: true });
  const [url, init] = requests[0];
  assert.equal(url, 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-youtube-client-name'], '67');
  assert.equal(init.headers['x-youtube-client-version'], WEB_REMIX.clientVersion);
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(init.body), { browseId: 'VLPLabc', context: { client: WEB_REMIX } });
});

test('the youtube client posts the WEB context to www.youtube.com and only browses', async () => {
  const requests = [];
  const youtube = createInnertube({
    site: 'youtube',
    fetch: async (url, init) => {
      requests.push([url, init]);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  assert.deepEqual(await youtube('browse', { browseId: 'UCGtGpOIGHfRu1KYL9pi-mNQ' }), { ok: true });
  await assert.rejects(youtube('next', { videoId: 'RGdkabupfPI' }), /unsupported/);
  await assert.rejects(youtube('player', { videoId: 'RGdkabupfPI' }), /unsupported/);
  assert.equal(requests.length, 1);
  const [url, init] = requests[0];
  assert.equal(url, 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.origin, 'https://www.youtube.com');
  assert.equal(init.headers['x-youtube-client-name'], '1');
  assert.equal(init.headers['x-youtube-client-version'], WEB.clientVersion);
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(init.body), { browseId: 'UCGtGpOIGHfRu1KYL9pi-mNQ', context: { client: WEB } });
});

test('innertube refuses other endpoints and surfaces http errors', async () => {
  let fetched = 0;
  const innertube = createInnertube({
    fetch: async () => {
      fetched += 1;
      return new Response('blocked', { status: 429 });
    },
  });
  await assert.rejects(innertube('account/accounts_list', {}), /unsupported/);
  assert.equal(fetched, 0);
  await assert.rejects(innertube('next', { videoId: 'RGdkabupfPI' }), /HTTP 429/);
});

test('innertube gives up after its timeout', async (t) => {
  // AbortSignal.timeout does not keep node's event loop alive on its own
  const hold = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(hold));
  const innertube = createInnertube({
    timeoutMs: 20,
    fetch: (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
  });
  await assert.rejects(innertube('browse', { browseId: 'VLPLabc' }));
});

test('fetchJson only reads youtube oembed', async () => {
  const urls = [];
  const fetchJson = createFetchJson({
    fetch: async (url) => {
      urls.push(url);
      return new Response('{"title":"x"}', { status: 200 });
    },
  });
  assert.deepEqual(await fetchJson('https://www.youtube.com/oembed?url=x&format=json'), { title: 'x' });
  await assert.rejects(fetchJson('https://evil.example/oembed?url=x'), /not allowed/);
  await assert.rejects(fetchJson('https://www.youtube.com.evil.example/oembed?url=x'), /not allowed/);
  assert.deepEqual(urls, ['https://www.youtube.com/oembed?url=x&format=json']);
});
