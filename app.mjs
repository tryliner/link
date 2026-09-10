// hono app shared by the cloudflare worker and the local node runner.
// zero framework magic: strict routes, validated ids, metadata-enriched pages.
import { Hono } from 'hono';
import { resolveShare, deeplink } from './share.mjs';
import { renderOpenPage, renderErrorPage, renderLanding } from './page.mjs';

const MAX_URL_CHARS = 2048;

const BAD_LINK = renderErrorPage('Invalid link', 'This share link is broken or expired.');
const NOT_FOUND = renderErrorPage('Not found', 'Nothing lives at this address.');

export function createApp() {
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
    app.get(`/${kind}`, (c) => {
      if (c.req.url.length > MAX_URL_CHARS) return c.html(BAD_LINK, 414);
      // dup detection needs the raw list, hono query helpers collapse it
      const params = new URL(c.req.url).searchParams;
      const share = resolveShare(`/${kind}`, params);
      if (!share) return c.html(BAD_LINK, 400);
      return c.html(
        renderOpenPage({ deep: deeplink(share.type, share.id), type: share.type }),
        200,
        { 'cache-control': 'no-store' },
      );
    });
  }

  app.notFound((c) => c.html(NOT_FOUND, 404));
  return app;
}
