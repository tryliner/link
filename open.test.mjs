// app-level tests through hono's app.request (no sockets, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.mjs';

const app = createApp();
const get = (path, method = 'GET') => app.request(path, { method });

test('share pages bounce to the deeplink with a branded loader', async () => {
  const cases = [
    ['/artist?id=UCGtGpOIGHfRu1KYL9pi-mNQ', 'Artist', 'liner://artist?id=UCGtGpOIGHfRu1KYL9pi-mNQ'],
    ['/album?id=MPREb_xCxkOKReFZv', 'Album', 'liner://album?id=MPREb_xCxkOKReFZv'],
    ['/playlist?id=VLPLD8jNKEyHYB2DHh5vXSI4USLFo29vzUYl', 'Playlist', 'liner://playlist?id=VLPLD8jNKEyHYB2DHh5vXSI4USLFo29vzUYl'],
    ['/track?id=RGdkabupfPI', 'Track', 'liner://track?id=RGdkabupfPI'],
  ];
  for (const [path, label, deep] of cases) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    const body = await res.text();
    assert.match(body, new RegExp(label));
    assert.ok(body.includes(deep), `${path} missing deeplink`);
    assert.match(body, /Open in Liner/);
    assert.match(body, /class="eq"/);
  }
  const res = await get('/artist?id=UCGtGpOIGHfRu1KYL9pi-mNQ');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('bad ids and routes get static errors without reflection', async () => {
  const badId = await get('/artist?id=javascript:alert(1)');
  assert.equal(badId.status, 400);
  assert.doesNotMatch(await badId.text(), /javascript/);

  const dup = await get('/track?id=RGdkabupfPI&id=RGdkabupfPI');
  assert.equal(dup.status, 400);

  const unknown = await get('/evil?id=UCGtGpOIGHfRu1KYL9pi-mNQ');
  assert.equal(unknown.status, 404);

  const post = await get('/artist?id=UCGtGpOIGHfRu1KYL9pi-mNQ', 'POST');
  assert.equal(post.status, 405);

  const health = await get('/health');
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');

  const root = await get('/');
  assert.equal(root.status, 200);
});
