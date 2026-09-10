# link

Share-link redirector for `link.tryliner.fun`. Takes `/artist?id=…` (album, playlist, track too), validates the id, serves a small "Opening in Liner" page that bounces to the `liner://` deeplink.

## run

```bash
node server.mjs            # :1193, same app the worker serves
PORT=1193 HOST=127.0.0.1 node server.mjs
```

```bash
node --test share.test.mjs open.test.mjs
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
- `/`, `/health`

Anything else → 404. Bad/missing/duplicate id → 400. Only `GET`/`HEAD`.

## security model

Ids must match a strict per-type charset (`[A-Za-z0-9_-]`, length-capped) — no urls, slashes, quotes or scheme breaks, so nothing executable can pass through. Only the validated id is forwarded into `liner://<type>?id=…`; all other query params are dropped. Error pages are static, user input is never reflected. No logs of request urls.

## desktop side

The app must own the `liner` protocol: `electron/main.ts` registers it and routes `liner://artist|album|playlist|track?id=…` to the matching page. Packaged builds self-register via electron-builder `protocols`; for linux dev: `desktop/scripts/register-deeplink-linux.sh`.
