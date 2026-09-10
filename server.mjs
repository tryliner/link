// local runner for the share-link service (keeps :1193 testing dependency-free).
// same hono app the worker serves, just adapted to node:http.
import http from 'node:http';
import { createApp } from './app.mjs';

const PORT = Number(process.env.PORT ?? 1193);
// loopback by default, local reverse proxy or device testing can override
const HOST = process.env.HOST ?? '127.0.0.1';

const app = createApp();

const server = http.createServer(async (req, res) => {
  try {
    const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
    }
    const out = await app.fetch(new Request(url, { method: req.method, headers }));
    const outHeaders = {};
    for (const [key, value] of out.headers.entries()) outHeaders[key] = value;
    res.writeHead(out.status, outHeaders);
    if (req.method === 'HEAD' || out.body === null) {
      res.end();
    } else {
      res.end(Buffer.from(await out.arrayBuffer()));
    }
  } catch {
    // never leak internals, and never log request urls (log injection + privacy)
    try {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('bad request');
    } catch { /* socket already gone */ }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`link server listening on ${HOST}:${PORT}`);
});
