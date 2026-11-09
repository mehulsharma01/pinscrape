import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchRequest, parseSearchResponse, normalizePin, bestVideo, bestImage, chunk, CHUNK_BYTES } from '../src/parse.js';

test('buildSearchRequest encodes query, source_url and bookmark', () => {
    const r = buildSearchRequest('christmas nails', { bookmark: 'BM1' });
    assert.equal(r.sourceUrl, '/search/pins/?q=christmas%20nails&rs=typed');
    assert.ok(r.url.startsWith('https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=%2Fsearch%2Fpins%2F'));
    const data = JSON.parse(new URL(r.url).searchParams.get('data'));
    assert.equal(data.options.query, 'christmas nails');
    assert.deepEqual(data.options.bookmarks, ['BM1']);
    assert.equal(r.pageUrl, 'https://www.pinterest.com/search/pins/?q=christmas%20nails&rs=typed');
});

const pin = {
    id: '123',
    type: 'pin',
    grid_title: ' Red velvet nails ',
    description: 'cat eye',
    images: { '236x': { url: 's.jpg', width: 236, height: 400 }, orig: { url: 'o.jpg', width: 1080, height: 1920 } },
    aggregated_pin_data: { aggregated_stats: { saves: 4521 } },
    pinner: { username: 'nailsby', full_name: 'Nails By' },
    board: { name: 'Xmas' },
    domain: 'instagram.com',
    link: 'https://instagram.com/p/x',
    created_at: 'Mon, 03 Nov 2026 10:00:00 +0000',
};

test('normalizePin picks orig image, saves and metadata', () => {
    const row = normalizePin(pin, 'q', 1);
    assert.equal(row.url, 'https://www.pinterest.com/pin/123/');
    assert.equal(row.title, 'Red velvet nails');
    assert.equal(row.imageUrl, 'o.jpg');
    assert.equal(row.width, 1080);
    assert.equal(row.saves, 4521);
    assert.equal(row.pinner, 'nailsby');
    assert.equal(row.isVideo, false);
    assert.equal(row.createdAt, '2026-11-03T10:00:00.000Z');
    assert.equal(normalizePin({ id: 'x', type: 'story' }, 'q', 1), null);
});

test('bestVideo prefers 720p mp4, bestImage falls back', () => {
    const v = { videos: { video_list: { V_HLSV4: { url: 'a.m3u8' }, V_720P: { url: 'b.mp4' }, V_EXP4: { url: 'c.mp4' } } } };
    assert.equal(bestVideo(v), 'b.mp4');
    assert.equal(bestVideo({ videos: { video_list: { V_EXP3: { url: 'd.mp4', width: 360 } } } }), 'd.mp4');
    assert.equal(bestVideo({}), null);
    assert.equal(bestImage({ images: { '474x': { url: 'm.jpg', width: 474 } } }).url, 'm.jpg');
    const row = normalizePin({ ...pin, videos: v.videos }, 'q', 2);
    assert.equal(row.isVideo, true);
    assert.equal(row.videoUrl, 'b.mp4');
});

test('parseSearchResponse reads results and bookmark', () => {
    const r = parseSearchResponse({ resource_response: { status: 'success', bookmark: 'NEXT', data: { results: [pin] } } });
    assert.equal(r.pins.length, 1);
    assert.equal(r.bookmark, 'NEXT');
    assert.equal(parseSearchResponse({ resource_response: { bookmark: '-end-', data: { results: [] } } }).bookmark, null);
});

test('chunk splits into 190000-byte parts that rejoin exactly', () => {
    const buf = Buffer.alloc(CHUNK_BYTES * 2 + 5, 7);
    const parts = chunk(buf);
    assert.equal(parts.length, 3);
    assert.equal(parts[2].length, 5);
    assert.ok(Buffer.concat(parts).equals(buf));
});
