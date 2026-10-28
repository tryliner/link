# link

Share-link redirector for `link.tryliner.fun`. Takes `/artist?id=…` (album, playlist, track too), validates the id, serves a small "Opening in Liner" page that bounces to the `liner://` deeplink. The page also carries link-preview tags (Open Graph, oEmbed) so Discord, Slack or Telegram show what the link points to.

## run

```bash
node server.mjs            # :1193, same app the worker serves
PORT=1193 HOST=127.0.0.1 node server.mjs
```

```bash
pnpm test   # node --test, fixtures only, no network
```

## deploy (cloudflare workers)

```bash
wrangler login
wrangler deploy
```

Custom domain: dashboard → worker → Domains & Routes → `link.tryliner.fun`, or add a `routes` line in `wrangler.toml`. Local worker preview: `wrangler dev --port 1193`.

## routes

- `/artist?id=UC…` — channel id, `UC` + 22 chars
- `/album?id=MPRE…`
- `/playlist?id=…` — catalog (`VLPL…`/`PL…`) or user (`uuid`/`pl-…`) token
- `/track?id=…` — 11-char video id
- `/oembed?url=…` — oEmbed (json) for a canonical `https://link.tryliner.fun/…` share link
- `/`, `/health`

Anything else → 404. Bad/missing/duplicate id → 400. Only `GET`/`HEAD`.

## link previews

`meta/` holds one resolver per kind. Each reads the same YouTube Music call the desktop app makes for that page (`browse` / `next`, `WEB_REMIX` client, see `innertube.mjs`) and returns title, description, cover and a few `music:*` tags. YouTube Music artist pages only have a wide banner, so the artist resolver also browses the artist's YouTube channel (`WEB` client, `browse` only) for the profile picture, and keeps the YouTube Music image when that fails. `meta.mjs` gives the lookup a 2.5 s budget, caches results for 30 minutes and sanitizes every field. Any failure or timeout serves the generic page, the deeplink bounce never changes. Liner playlists (uuid / `pl-…`) keep the generic page: they live on the API, which only answers signed app requests.

## security model

Ids must match a strict per-type charset (`[A-Za-z0-9_-]`, length-capped) — no urls, slashes, quotes or scheme breaks, so nothing executable can pass through. Only the validated id is forwarded into `liner://<type>?id=…`; all other query params are dropped. Error pages are static, user input is never reflected. No logs of request urls.

Previews only ever look up the validated id, read-only, without cookies. Upstream text is length-capped and stripped of control and bidi characters, images must be https on YouTube's image hosts, links must be canonical share links, and everything is escaped in the html.

## desktop side

The app must own the `liner` protocol: `electron/main.ts` registers it and routes `liner://artist|album|playlist|track?id=…` to the matching page. Packaged builds self-register via electron-builder `protocols`; for linux dev: `desktop/scripts/register-deeplink-linux.sh`.
