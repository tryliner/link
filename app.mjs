// hono app shared by the cloudflare worker and the local node runner.
// zero framework magic: strict routes, validated ids, metadata-enriched pages.
import { Hono } from 'hono';
import { resolveShare, deeplink, shareUrl } from './share.mjs';
import { renderOpenPage, renderErrorPage, renderLanding } from './page.mjs';
import { createMetaResolver, isShareUrl } from './meta.mjs';

const MAX_URL_CHARS = 2048;

const BAD_LINK = renderErrorPage('Invalid link', 'This share link is broken or expired.');
const NOT_FOUND = renderErrorPage('Not found', 'Nothing lives at this address.');

// resolveMeta is injectable so tests never touch the network
export function createApp({ resolveMeta = createMetaResolver() } = {}) {
  const app = new Hono({ strict: false });

  // tiny static pages, no sniffing, no embedding, no referrer leakage
  app.use(async (c, next) => {
    await next();
    c.header('x-content-type-options', 'nosniff');
    c.header('referrer-policy', 'no-referrer');
    c.header('x-frame-options', 'DENY');
    c.header('cross-origin-opener-policy', 'same-origin');
    c.header(
      'content-security-policy',
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
    );
  });

  // browsers and bots only ever GET, block everything else early
  app.use(async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      return c.text('method not allowed', 405, { allow: 'GET, HEAD' });
    }
    await next();
  });

  app.get('/', (c) => c.html(renderLanding(), 200, { 'cache-control': 'public, max-age=300' }));

  app.get('/health', (c) => c.text('ok'));

  for (const kind of ['artist', 'album', 'playlist', 'track']) {
    app.get(`/${kind}`, async (c) => {
      if (c.req.url.length > MAX_URL_CHARS) return c.html(BAD_LINK, 414);
      // dup detection needs the raw list, hono query helpers collapse it
      const params = new URL(c.req.url).searchParams;
      const share = resolveShare(`/${kind}`, params);
      if (!share) return c.html(BAD_LINK, 400);
      // preview metadata for link unfurlers, null (generic card) on any failure or timeout
      const meta = c.req.method === 'HEAD' ? null : await resolveMeta(share.type, share.id);
      // the author line (artist above the title on discord) only exists in oembed
      const oembedUrl = meta?.author
        ? `${new URL(c.req.url).origin}/oembed?url=${encodeURIComponent(shareUrl(share.type, share.id))}&format=json`
        : null;
      return c.html(
        renderOpenPage({ deep: deeplink(share.type, share.id), type: share.type, meta, oembedUrl }),
        200,
        { 'cache-control': 'no-store' },
      );
    });
  }

  // oembed for the same canonical share links, data comes from the same validated lookup
  app.get('/oembed', async (c) => {
    if (c.req.url.length > MAX_URL_CHARS) return c.json({ error: 'bad request' }, 414);
    const params = new URL(c.req.url).searchParams;
    const format = params.get('format');
    if (format !== null && format !== 'json') return c.json({ error: 'only json' }, 501);
    const target = params.getAll('url').length === 1 ? params.get('url') : '';
    if (!isShareUrl(target)) return c.json({ error: 'not found' }, 404);
    const url = new URL(target);
    const share = resolveShare(url.pathname, url.searchParams);
    const meta = await resolveMeta(share.type, share.id);
    if (!meta) return c.json({ error: 'not found' }, 404);
    return c.json(
      {
        version: '1.0',
        type: 'link',
        provider_name: 'Liner',
        title: meta.title,
        ...(meta.author ? { author_name: meta.author.name } : {}),
        ...(meta.author?.url ? { author_url: meta.author.url } : {}),
        ...(meta.image ? { thumbnail_url: meta.image } : {}),
        ...(meta.image && meta.imageWidth ? { thumbnail_width: meta.imageWidth, thumbnail_height: meta.imageHeight } : {}),
      },
      200,
      { 'cache-control': 'no-store' },
    );
  });

  app.notFound((c) => c.html(NOT_FOUND, 404));
  return app;
}
