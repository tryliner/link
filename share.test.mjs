// validation unit tests, run with: npm test (node --test, no deps)
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveShare, routeFor, deeplink } from './share.mjs';
import { esc } from './page.mjs';

const q = (s) => new URLSearchParams(s);

test('accepts real-world ids', () => {
  assert.deepEqual(resolveShare('/artist', q('id=UCGtGpOIGHfRu1KYL9pi-mNQ')), { type: 'artist', id: 'UCGtGpOIGHfRu1KYL9pi-mNQ' });
  assert.deepEqual(resolveShare('/album', q('id=MPREb_xCxkOKReFZv')), { type: 'album', id: 'MPREb_xCxkOKReFZv' });
  assert.deepEqual(resolveShare('/playlist', q('id=VLPLD8jNKEyHYB2DHh5vXSI4USLFo29vzUYl')), { type: 'playlist', id: 'VLPLD8jNKEyHYB2DHh5vXSI4USLFo29vzUYl' });
  // user playlists are plain uuids / pl- tokens, same safe charset so also fine
  assert.deepEqual(resolveShare('/playlist', q('id=11111111-1111-4111-8111-111111111111')), { type: 'playlist', id: '11111111-1111-4111-8111-111111111111' });
  assert.deepEqual(resolveShare('/playlist', q('id=pl-abc123')), { type: 'playlist', id: 'pl-abc123' });
  assert.equal(resolveShare('/playlist', q('id=' + 'a'.repeat(65))), null);
  assert.deepEqual(resolveShare('/track', q('id=RGdkabupfPI')), { type: 'track', id: 'RGdkabupfPI' });
});

test('rejects pentester shapes', () => {
  const bad = [
    'liner://artist?id=UCaaaaaaaaaaaaaaaaaaaaaa',
    'javascript:alert(1)',
    'UCaaaaaaaaaaaaaaaaaaaaaa&evil=1',
    '../etc/passwd',
    'UCaaaaaaaaaaaaaaaaaaaaaa%2F..',
    '"onmouseover="alert(1)',
    '<script>alert(1)</script>',
    'UC aaaaaaaaaaaaaaaaaaaaaa',
    '🔥'.repeat(11),
    'UCshort',
    'UC' + 'a'.repeat(100),
    'MPRE',
    'dQw4w9WgXcQextrachar',
    '',
  ];
  for (const id of bad) {
    assert.equal(resolveShare('/artist', q('id=' + encodeURIComponent(id))), null, `artist accepted ${id}`);
    assert.equal(resolveShare('/track', q('id=' + encodeURIComponent(id))), null, `track accepted ${id}`);
  }
  // non-UC 24-char token is not an artist channel id
  assert.equal(resolveShare('/artist', q('id=ABaaaaaaaaaaaaaaaaaaaaaa')), null);
  // duplicate / missing id
  assert.equal(resolveShare('/artist', q('id=UCGtGpOIGHfRu1KYL9pi-mNQ&id=UCGtGpOIGHfRu1KYL9pi-mNQ')), null);
  assert.equal(resolveShare('/artist', q('foo=1')), null);
  // unknown routes, case tricks, nested paths
  assert.equal(resolveShare('/Artist', q('id=UCGtGpOIGHfRu1KYL9pi-mNQ')), null);
  assert.equal(resolveShare('/artist/evil', q('id=UCGtGpOIGHfRu1KYL9pi-mNQ')), null);
  assert.equal(resolveShare('/.well-known', q('id=x')), null);
  assert.equal(routeFor('/nope'), undefined);
});

test('trailing slash tolerated, extra params dropped', () => {
  assert.deepEqual(resolveShare('/artist/', q('id=UCGtGpOIGHfRu1KYL9pi-mNQ&next=liner://evil')), { type: 'artist', id: 'UCGtGpOIGHfRu1KYL9pi-mNQ' });
  assert.equal(deeplink('artist', 'UCGtGpOIGHfRu1KYL9pi-mNQ'), 'liner://artist?id=UCGtGpOIGHfRu1KYL9pi-mNQ');
  assert.equal(esc('a"b<c>&'), 'a&quot;b&lt;c&gt;&amp;');
});
