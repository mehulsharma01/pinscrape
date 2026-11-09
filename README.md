# Pinterest Search (Glimsera)

Apify actor that searches Pinterest by keyword without logging in and returns each pin's image URL, video URL, title, saves, pinner and source link. Built for Glimsera content research and carousel design.

## Input

```json
{
  "queries": ["christmas nails classy", "cherry cola hair"],
  "maxPinsPerQuery": 30,
  "saveImages": true,
  "saveVideos": false,
  "proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"] }
}
```

## Output row

`query`, `rank`, `id`, `url`, `title`, `description`, `imageUrl`, `width`, `height`, `isVideo`, `videoUrl`, `saves`, `pinner`, `board`, `domain`, `link`, `createdAt`, `files`.

## Saved files

With **Save images** / **Save videos**, each file is stored in the run's key-value store in 190 KB parts: `PIN_<id>.p0`, `PIN_<id>.p1`, ... (videos: `PINV_<id>.pN`). The row's `files` entry lists `key`, `parts`, `contentType` and `bytes`. Join the parts in order to get the original file. The parts are small so tools with a ~256 KB read limit can fetch them.

## How it works

It loads the public search page for cookies, then calls Pinterest's `BaseSearchResource` endpoint the same way pinterest.com does, paging with bookmarks. A blocked search is retried on a new IP. Set **Probe responses (debug)** to save a short report if Pinterest changes its responses.

## Development

```bash
npm install
npm test
```

This repo used to contain the `pinscrape` Python package, which has no Apify entry point. It is still in the git history.
