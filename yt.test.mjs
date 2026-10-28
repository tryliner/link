// json and artwork helpers shared by the meta/ resolvers
import test from 'node:test';
import assert from 'node:assert/strict';
import { bestThumbnail, clip, formatDuration, getText, joinParts, parseDuration, squareArtworkUrl, textParts } from './yt.mjs';

test('text helpers read runs and simpleText', () => {
  assert.equal(getText({ runs: [{ text: 'Neon ' }, { text: 'Coast' }] }), 'Neon Coast');
  assert.equal(getText({ simpleText: ' Mara Vale ' }), 'Mara Vale');
  assert.equal(getText({ runs: [{ text: '  ' }] }), undefined);
  assert.equal(getText(null), undefined);
  assert.deepEqual(textParts({ runs: [{ text: 'Album' }, { text: ' • ' }, { text: '2025' }] }), ['Album', '2025']);
  assert.equal(joinParts(['Playlist', undefined, '', ' ', '24 tracks']), 'Playlist · 24 tracks');
  assert.equal(clip('abcdef', 4), 'abc…');
  assert.equal(clip('abc', 4), 'abc');
  // never cuts an emoji in half
  assert.equal(clip('ab😀😀c', 4), 'ab😀…');
});

test('durations parse and format both ways', () => {
  assert.equal(parseDuration('3:41'), 221);
  assert.equal(parseDuration('1:02:03'), 3723);
  for (const bad of ['3:61', '1:61:00', '221', '0:00', 'a:bc', '', undefined]) {
    assert.equal(parseDuration(bad), undefined, String(bad));
  }
  assert.equal(formatDuration(221), '3:41');
  assert.equal(formatDuration(3723), '1:02:03');
  assert.equal(formatDuration(59), '0:59');
});

test('artwork is resized to an exact square on google cdns only', () => {
  assert.equal(
    squareArtworkUrl('https://lh3.googleusercontent.com/a=w60-h60-l90-rj'),
    'https://lh3.googleusercontent.com/a=w544-h544-p-l90-rj',
  );
  assert.equal(
    squareArtworkUrl('https://yt3.ggpht.com/a=s88-c-k-c0x00ffffff-no-rj', 300),
    'https://yt3.ggpht.com/a=w300-h300-p-l90-rj',
  );
  assert.equal(squareArtworkUrl('https://lh3.googleusercontent.com/a'), 'https://lh3.googleusercontent.com/a=w544-h544-p-l90-rj');
  assert.equal(squareArtworkUrl('https://i.ytimg.com/vi/x/hqdefault.jpg'), 'https://i.ytimg.com/vi/x/hqdefault.jpg');
});

test('best thumbnail takes the largest https entry', () => {
  const thumbnail = (thumbnails) => ({ musicThumbnailRenderer: { thumbnail: { thumbnails } } });
  assert.deepEqual(
    bestThumbnail(
      thumbnail([
        { url: 'https://lh3.googleusercontent.com/a=w60-h60', width: 60, height: 60 },
        { url: 'https://lh3.googleusercontent.com/a=w226-h226', width: 226, height: 226 },
      ]),
    ),
    { url: 'https://lh3.googleusercontent.com/a=w544-h544-p-l90-rj', width: 544, height: 544 },
  );
  assert.deepEqual(bestThumbnail({ thumbnails: [{ url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', width: 480, height: 360 }] }), {
    url: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
    width: 480,
    height: 360,
  });
  assert.equal(
    bestThumbnail({ thumbnails: [{ url: '//yt3.ggpht.com/a=s88', width: 88, height: 88 }] }).url,
    'https://yt3.ggpht.com/a=w544-h544-p-l90-rj',
  );
  assert.equal(bestThumbnail({ thumbnails: [{ url: 'http://yt3.ggpht.com/a=s88' }, { url: 'javascript:x' }] }), undefined);
  assert.equal(bestThumbnail(undefined), undefined);
});
