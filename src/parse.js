// Pure helpers for Pinterest search responses. No network code, so they can be tested offline.

export const CHUNK_BYTES = 190000;

/** source_url and the encoded `data` param for one BaseSearchResource page. */
export function buildSearchRequest(query, { pageSize = 25, bookmark = null, base = 'https://www.pinterest.com' } = {}) {
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
    const options = {
        query,
        scope: 'pins',
        page_size: pageSize,
        rs: 'typed',
        redux_normalize_feed: true,
        source_url: sourceUrl,
        applied_unified_filters: null,
        appliedProductFilters: '---',
        auto_correction_disabled: false,
        top_pin_id: null,
        filters: null,
    };
    if (bookmark) options.bookmarks = [bookmark];
    const data = JSON.stringify({ options, context: {} });
    const url = `${base}/resource/BaseSearchResource/get/?source_url=${encodeURIComponent(sourceUrl)}`
        + `&data=${encodeURIComponent(data)}&_=${Date.now()}`;
    return { sourceUrl, url, pageUrl: `${base}${sourceUrl}` };
}

/** Pick the best MP4 from a pin's videos.video_list (prefer 720p). */
export function bestVideo(pin) {
    const list = pin?.videos?.video_list || pin?.story_pin_data?.pages?.[0]?.blocks?.find?.((b) => b?.video)?.video?.video_list;
    if (!list) return null;
    const pref = ['V_720P', 'V_EXP7', 'V_EXP6', 'V_EXP5', 'V_EXP4', 'V_EXP3'];
    for (const k of pref) if (list[k]?.url?.endsWith?.('.mp4')) return list[k].url;
    const mp4 = Object.values(list).filter((v) => typeof v?.url === 'string' && v.url.includes('.mp4'))
        .sort((a, b) => (b.width || 0) - (a.width || 0));
    return mp4[0]?.url || null;
}

/** Largest image from pin.images (orig preferred). */
export function bestImage(pin) {
    const imgs = pin?.images || {};
    if (imgs.orig?.url) return { url: imgs.orig.url, width: imgs.orig.width ?? null, height: imgs.orig.height ?? null };
    const all = Object.values(imgs).filter((v) => v?.url).sort((a, b) => (b.width || 0) - (a.width || 0));
    if (all[0]) return { url: all[0].url, width: all[0].width ?? null, height: all[0].height ?? null };
    if (pin?.image_large_url) return { url: pin.image_large_url, width: null, height: null };
    return null;
}

/** One search result object -> dataset row (null for ads/non-pins). */
export function normalizePin(pin, query, rank) {
    if (!pin || !pin.id || (pin.type && pin.type !== 'pin')) return null;
    const img = bestImage(pin);
    const videoUrl = bestVideo(pin);
    const saves = pin.aggregated_pin_data?.aggregated_stats?.saves ?? pin.repin_count ?? null;
    const created = pin.created_at ? new Date(pin.created_at) : null;
    return {
        query,
        rank,
        id: String(pin.id),
        url: `https://www.pinterest.com/pin/${pin.id}/`,
        title: (pin.grid_title || pin.title || '').trim() || null,
        description: (pin.description || pin.seo_description || '').trim() || null,
        imageUrl: img?.url ?? null,
        width: img?.width ?? null,
        height: img?.height ?? null,
        isVideo: Boolean(videoUrl || pin.videos),
        videoUrl,
        saves,
        pinner: pin.pinner?.username ?? null,
        pinnerName: pin.pinner?.full_name ?? null,
        board: pin.board?.name ?? null,
        domain: pin.domain ?? null,
        link: pin.link ?? null,
        isPromoted: Boolean(pin.is_promoted),
        createdAt: created && !Number.isNaN(created.getTime()) ? created.toISOString() : null,
        scrapedAt: new Date().toISOString(),
    };
}

/** BaseSearchResource JSON -> { pins: raw[], bookmark } */
export function parseSearchResponse(json) {
    const rr = json?.resource_response;
    const data = rr?.data;
    const results = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
    const bookmark = rr?.bookmark || json?.resource?.options?.bookmarks?.[0] || null;
    return { pins: results, bookmark: bookmark && bookmark !== '-end-' ? bookmark : null };
}

/** Split a buffer into CHUNK_BYTES pieces. */
export function chunk(buf, size = CHUNK_BYTES) {
    const parts = [];
    for (let i = 0; i < buf.length; i += size) parts.push(buf.subarray(i, i + size));
    return parts;
}
