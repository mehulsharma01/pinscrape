// Glimsera Pinterest Search (Apify actor).
// Keyword -> pins with image/video URLs, titles, saves, source. Optional file saving in chunks.
// Logged-out: warm up the search page for cookies, then call BaseSearchResource like pinterest.com does.

import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import { CookieJar } from 'tough-cookie';
import { buildSearchRequest, parseSearchResponse, normalizePin, chunk } from './parse.js';

const BASE = 'https://www.pinterest.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const queries = [...new Set((input.queries || []).map((q) => String(q || '').trim()).filter(Boolean))];
    const maxPins = Math.min(Math.max(Number(input.maxPinsPerQuery) || 30, 1), 250);
    const maxRetries = Number.isInteger(input.maxRetries) ? input.maxRetries : 3;

    if (!queries.length) {
        const msg = 'Nothing to search. Add at least one line in "Search terms".';
        log.error(msg, { receivedInput: input });
        await Actor.fail(msg);
    }

    let proxy = null;
    try {
        proxy = await Actor.createProxyConfiguration(input.proxyConfiguration ?? { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] });
    } catch (err) {
        log.warning(`Proxy not available (${err.message}). Continuing without one.`);
    }

    /** A session = one IP + one cookie jar, reused for warm-up and API pages of one query. */
    async function newSession() {
        const id = `pin_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        return { proxyUrl: proxy ? await proxy.newUrl(id) : undefined, cookieJar: new CookieJar() };
    }

    async function get(session, url, { json = false, headers = {}, buffer = false } = {}) {
        const res = await gotScraping({
            url,
            proxyUrl: session.proxyUrl,
            cookieJar: session.cookieJar,
            timeout: { request: 45000 },
            throwHttpErrors: false,
            followRedirect: true,
            responseType: buffer ? 'buffer' : 'text',
            headerGeneratorOptions: { browsers: ['chrome'], devices: ['desktop'], locales: ['en-US'] },
            headers,
        });
        if (res.statusCode !== 200) {
            const snip = buffer ? '' : String(res.body || '').slice(0, 150).replace(/\s+/g, ' ');
            throw new Error(`HTTP ${res.statusCode} ${snip}`);
        }
        if (buffer) return { body: res.body, contentType: res.headers['content-type'] };
        if (!json) return res.body;
        try {
            return JSON.parse(res.body);
        } catch {
            throw new Error(`Expected JSON, got: ${String(res.body).slice(0, 120).replace(/\s+/g, ' ')}`);
        }
    }

    const apiHeaders = (sourceUrl) => ({
        accept: 'application/json, text/javascript, */*, q=0.01',
        'x-requested-with': 'XMLHttpRequest',
        'x-pinterest-appstate': 'active',
        'x-pinterest-pws-handler': 'www/search/[scope].js',
        'x-pinterest-source-url': sourceUrl,
        referer: `${BASE}/`,
    });

    /** Run one query with retries on a fresh IP. Returns raw pin objects (deduped, up to maxPins). */
    async function searchQuery(query) {
        let lastErr;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const session = await newSession();
            const seen = new Set();
            const out = [];
            try {
                const first = buildSearchRequest(query, { base: BASE });
                await get(session, first.pageUrl, { headers: { accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' } });
                let bookmark = null;
                for (let page = 0; page < 20 && out.length < maxPins; page++) {
                    const req = buildSearchRequest(query, { base: BASE, bookmark });
                    const json = await get(session, req.url, { json: true, headers: apiHeaders(req.sourceUrl) });
                    const { pins, bookmark: next } = parseSearchResponse(json);
                    for (const p of pins) {
                        if (p?.id && !seen.has(p.id) && (!p.type || p.type === 'pin')) {
                            seen.add(p.id);
                            out.push(p);
                        }
                    }
                    if (!next || !pins.length) break;
                    bookmark = next;
                    await sleep(800 + Math.floor(Math.random() * 800));
                }
                if (!out.length) throw new Error('Search returned no pins');
                return { pins: out.slice(0, maxPins), session };
            } catch (err) {
                lastErr = err;
                if (attempt === maxRetries) break;
                const wait = Math.min(2000 * 2 ** attempt, 20000);
                log.warning(`"${query}" attempt ${attempt + 1}/${maxRetries + 1} failed: ${err.message}. Retrying with a new IP in ${Math.round(wait / 1000)}s.`);
                await sleep(wait);
            }
        }
        throw lastErr;
    }

    /** Download a file and store it as KEY.p0, KEY.p1 ... Returns a files[] entry or null. */
    async function saveFile(session, url, key) {
        try {
            let file;
            try {
                file = await get(session, url, { buffer: true });
            } catch {
                file = await get(await newSession(), url, { buffer: true });
            }
            const parts = chunk(file.body);
            const contentType = file.contentType || (key.startsWith('PINV_') ? 'video/mp4' : 'image/jpeg');
            for (let i = 0; i < parts.length; i++) {
                await Actor.setValue(`${key}.p${i}`, parts[i], { contentType: 'application/octet-stream' });
            }
            return { key, parts: parts.length, contentType, bytes: file.body.length };
        } catch (err) {
            log.warning(`Could not save ${key}: ${err.message}`);
            return null;
        }
    }

    if (input.debugProbe) {
        const q = queries[0];
        const session = await newSession();
        const report = {};
        const first = buildSearchRequest(q, { base: BASE });
        try {
            const html = await get(session, first.pageUrl);
            report.page = { length: html.length, hasPws: html.includes('__PWS_DATA__'), sample: html.slice(0, 300) };
        } catch (err) { report.page = { error: err.message }; }
        try {
            const json = await get(session, first.url, { json: true, headers: apiHeaders(first.sourceUrl) });
            const { pins, bookmark } = parseSearchResponse(json);
            report.api = { status: json?.resource_response?.status, pins: pins.length, bookmark: Boolean(bookmark), firstKeys: Object.keys(pins[0] || {}).slice(0, 40) };
        } catch (err) { report.api = { error: err.message }; }
        await Actor.setValue('PROBE', report);
        await Actor.exit('Probe saved to key-value store record PROBE.');
    }

    const stats = { queriesOk: 0, pinsSaved: 0, filesSaved: 0, failed: [] };
    for (const [qi, query] of queries.entries()) {
        await Actor.setStatusMessage(`Search ${qi + 1}/${queries.length}: "${query}"`);
        try {
            const { pins, session } = await searchQuery(query);
            let rank = 0;
            for (const raw of pins) {
                const row = normalizePin(raw, query, ++rank);
                if (!row) continue;
                row.files = [];
                if (input.saveImages && row.imageUrl) {
                    const f = await saveFile(session, row.imageUrl, `PIN_${row.id}`);
                    if (f) row.files.push(f);
                }
                if (input.saveVideos && row.videoUrl) {
                    const f = await saveFile(session, row.videoUrl, `PINV_${row.id}`);
                    if (f) row.files.push(f);
                }
                stats.filesSaved += row.files.length;
                await Actor.pushData(row);
                stats.pinsSaved += 1;
            }
            stats.queriesOk += 1;
            log.info(`"${query}": ${rank} pins saved.`);
        } catch (err) {
            log.error(`"${query}" failed: ${err.message}`);
            stats.failed.push({ query, error: err.message });
            await Actor.pushData({ type: 'error', query, error: err.message, scrapedAt: new Date().toISOString() });
        }
    }

    await Actor.setValue('SUMMARY', stats);
    const summary = `Done: ${stats.queriesOk}/${queries.length} searches, ${stats.pinsSaved} pins, ${stats.filesSaved} files, ${stats.failed.length} failed.`;
    if (stats.pinsSaved === 0) await Actor.fail(`${summary} Pinterest blocked every search; try again or use the Residential proxy.`);
    else await Actor.exit(summary);
} catch (err) {
    log.exception(err, 'Run stopped by an unexpected error');
    await Actor.fail(`Unexpected error: ${err.message}`);
}
