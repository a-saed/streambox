# Sports Streaming Redesign — Spec

**Date:** 2026-06-18  
**Goal:** Solid, self-healing beIN Sports / World Cup streaming with transparent failover, multi-source reliability, and a polished UX that never leaves the user stuck on a dead stream.

---

## 1. Problem Statement

Current state:
- **DaddyLive**: hardcoded embed host (`donis.jimpenopisonline.online`) breaks silently when it rotates; fixed 55-min cache wastes re-fetches when tokens last 4h; no mirror fallback
- **binTV**: Playwright on fly.io gets IP-blocked by `sporttsonline.click` (datacenter IP rejection); streams fail with 503 before Playwright can intercept anything
- **Channels have one URL**: if it dies, the user sees an error screen — no automatic recovery
- **Hub scan is the only way** to find a sport channel stream — takes 30-120s, no cached results
- **No health visibility**: user cannot tell which beIN channels are live before clicking

Root causes:
1. Single-URL-per-channel with no fallback
2. Playwright-dependent sources not proxied through residential IPs on fly.io
3. DaddyLive embed host is a hardcoded constant that rots
4. No proactive health checking of sport-channel URLs

---

## 2. Architecture Overview

```
Sources (server)                 Sports Pool              Client
─────────────────────────────    ─────────────────────    ────────────────────
DaddyLive (fixed)         ──┐
Free-TV/IPTV M3U          ──┤
Arabic community M3U repos ──┼──► sportsPool.ts ◄──── health checker (5 min)
Xtream portal scan results ──┤         │
beIN iptv-org channels     ──┘         │ GET /api/hub/:id/best
Telegram bot (optional)    ──►         ▼
                                  VideoPlayer
                                  (sources[] — cycles silently on failure)
```

The **SportsPool** is a new in-memory service (persisted to SQLite) that maps each `HUB_CHANNEL` id (`bein_ar_1`, `bein_max_1`, etc.) to a ranked list of stream URLs from multiple sources. A background health checker pings all URLs every 5 minutes. When a URL dies, the next one takes over — transparently to the user.

---

## 3. DaddyLive Fixes

### 3a. Auto-discover embed host (self-healing)

**Problem:** `EMBED_HOST = 'donis.jimpenopisonline.online'` is hardcoded. DaddyLive rotates embed hosts every few weeks; when it changes, all DL channels go 503 until someone manually updates the constant.

**Fix:** When `fetchSignedUrl()` fails (HTTP error or no `atob()` match), fall back to scraping the embed URL from the stream page:

```
GET https://dlhd.pk/stream/stream-{id}.php
  → parse <iframe src="https://{embed-host}/premiumtv/daddy4.php?id={id}">
  → cache discovered embed host for 1h
```

Regex: `/https?:\/\/[^"']+premiumtv\/daddy4\.php\?id=\d+/`

The discovered host is stored in a module-level `_discoveredEmbedHost` variable (string | null). `fetchSignedUrl()` tries `EMBED_HOST` first (fast path), then `_discoveredEmbedHost` if set, then triggers discovery if both fail.

### 3b. Dynamic TTL from `expires` param

**Problem:** Fixed 55-min cache evicts tokens early when the CDN issues 4h tokens, causing unnecessary embed re-fetches.

**Fix:** Parse `expires` Unix timestamp from the CDN URL:

```typescript
function _cacheExpiryMs(signedUrl: string): number {
  try {
    const exp = parseInt(new URL(signedUrl).searchParams.get('expires') ?? '', 10);
    if (exp) return Math.max(0, exp * 1000 - Date.now() - 120_000); // 2-min safety margin
  } catch {}
  return CACHE_TTL_MS; // fallback: 55 min
}
```

### 3c. Mirror fallback for channel list

`scrapeDaddyliveChannels()` (in `daddyliveSource.ts`) will try mirrors in order:

```typescript
const LIST_URLS = [
  'https://dlhd.pk/24-7-channels.php',
  'https://dlhd.sx/24-7-channels.php',
];
```

---

## 4. binTV Proxy Fix

**Problem:** Playwright on fly.io uses a datacenter IP; `sporttsonline.click` rejects it before the page loads, so `_interceptHLS()` always times out.

**Fix:** Add `PROXY_URL` environment variable. When set, pass it as the `proxy` option on every Playwright `browser.newContext()` call:

```typescript
const ctxOptions: Parameters<Browser['newContext']>[0] = {
  userAgent: UA,
  ignoreHTTPSErrors: true,
  extraHTTPHeaders: { Referer: 'https://prabashsapkota.github.io/' },
  ...(process.env.PROXY_URL ? { proxy: { server: process.env.PROXY_URL } } : {}),
};
ctx = await browser.newContext(ctxOptions);
```

Same pattern applied to DaddyLive's `_playwrightPath()` in `daddylive.ts`.

**Recommended proxy service:** IPRoyal or Smartproxy (~$5-8/GB residential). Store credentials in fly.io secrets:

```sh
fly secrets set PROXY_URL=http://user:pass@gate.provider.com:10000
```

The proxy is **per-context only** — plain `fetch()` calls for M3U/EPG/portal APIs go direct, so proxy bandwidth is only consumed for Playwright scraping.

---

## 5. Sports Pool Service

### 5a. Data model

**File:** `server/src/services/sportsPool.ts`

```typescript
interface PoolEntry {
  url: string;
  source: string;       // 'daddylive' | 'xtream' | 'm3u' | 'telegram' | 'bintv'
  addedAt: number;
  lastChecked: number;
  alive: boolean;
  failCount: number;    // consecutive health-check failures
}

// In-memory map, persisted to SQLite on write
const _pool = new Map<string, PoolEntry[]>(); // key = HUB_CHANNEL id
```

**API:**
- `addUrls(channelId: string, entries: Omit<PoolEntry, 'addedAt' | 'lastChecked' | 'alive' | 'failCount'>[]): void`
- `getBestUrl(channelId: string): { url: string; source: string } | null` — returns first alive entry
- `getAliveChannelIds(): string[]` — channels with at least one alive URL
- `markResult(url: string, alive: boolean): void`
- `getPoolStats(): { channelId: string; aliveCount: number; totalCount: number }[]`

Pool entries are also persisted in the existing SQLite `portals.db` via a new `sport_pool` table so the pool survives server restarts.

### 5b. Health checker

**Background process** (runs inside `sportsPool.ts`, started by `initCache()`):

- Interval: every 5 minutes
- Concurrency: 10 parallel checks
- Check method: `HEAD` request with 5s timeout; fall back to `GET` with `Range: bytes=0-1023`
- On success: `markResult(url, true)`, reset `failCount`
- On failure: increment `failCount`; if `failCount >= 2` → `markResult(url, false)`; if all URLs for a channel die → trigger re-discovery (one DL embed fetch + scan 1 Xtream portal)
- Health check skips URLs whose `lastChecked` is < 4 minutes old (avoids hammering on rapid re-renders)

### 5c. Pool feeder — DaddyLive mapper

**File:** `server/src/services/dlChannelMapper.ts`

After every `_runDLRefresh()` cycle, iterate live DL channels and match names to HUB_CHANNELS using the existing `matchesChannel()` function from `channelHub.ts`. Add matches to the pool:

```typescript
for (const ch of liveDLChannels) {
  const hubCh = HUB_CHANNELS.find(h => matchesChannel(ch.name, h));
  if (hubCh) {
    sportsPool.addUrls(hubCh.id, [{ url: ch.url, source: 'daddylive' }]);
  }
}
```

### 5d. Pool feeder — M3U beIN source

**File:** `server/src/services/beInM3uSource.ts`

Fetches multiple M3U playlists every 2h, filters channels matching HUB_CHANNELS via `matchesChannel()`, adds live channels to pool:

**Sources:**
```typescript
const M3U_SOURCES = [
  // iptv-org — Arabic country playlist
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/ar.m3u',
  // iptv-org — Sports category
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/sa.m3u',  // Saudi (SSC)
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/qa.m3u',  // Qatar (Alkass)
  // Free-TV community list
  'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
];
```

All are direct GitHub raw fetches — no Cloudflare, work from any IP. Channels are alive-checked before being added to the pool (same `batchCheck` from `aliveChecker.ts`).

### 5e. Pool feeder — Xtream portal scan

When a Hub scan (`GET /api/hub/:id/scan`) finds a live stream URL for a channel, that URL is now **also written to the pool** (not just streamed over SSE). This makes every manual scan an investment — the result is cached and reused.

### 5f. Pool feeder — Telegram bot (optional)

**File:** `server/src/services/telegramSource.ts`

Activated only when both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNELS` env vars are set.

**Config:**
```
TELEGRAM_BOT_TOKEN=<bot token from BotFather>
TELEGRAM_CHANNELS=@channel1,@channel2,-1001234567890
```

The channel list supports both `@username` and numeric chat IDs (for private channels where the bot is a member). Users find channels via [tgstat.com](https://tgstat.com) (search "bein sports iptv" or "iptv arabic"), add them to the env var, no redeployment needed.

**Behavior:**
- Polls `getUpdates` every 60s (long-polling)
- Extracts all URLs from each new message (regex: `https?://\S+`)
- Filters for likely stream URLs (contains `.m3u8`, `.m3u`, `xtream`, `/get.php`, or known IPTV CDN patterns)
- Tests each URL with a 5s HEAD check
- Live URLs are matched to HUB_CHANNELS via `matchesChannel()` and added to pool with `source: 'telegram'`
- Telegram pool entries get a shorter TTL (2h): the health checker evicts entries with `source === 'telegram'` and `addedAt` older than 2h, since posted links are match-specific and expire

**Finding channels:** Search [tgstat.com](https://tgstat.com) for "bein sports" or "iptv arabic 2026" — sort by member count and post frequency. Add channel usernames to `TELEGRAM_CHANNELS`.

---

## 6. API Changes

### New endpoints

**`GET /api/hub/live`**
```json
{ "liveChannelIds": ["bein_ar_1", "bein_max_1", "sky_sports", ...] }
```
Returns HUB_CHANNEL IDs that have at least one alive URL in the pool. Polled by the client every 60s.

**`GET /api/hub/:channelId/best`**
```json
{ "url": "/api/daddylive/42", "source": "daddylive" }
```
Returns the best alive URL from the pool for a given channel, or `404` if none cached. Client calls this on instant-play clicks; response is immediate (no scan).

**Updated `GET /api/hub/status`**
Adds `liveCount` field:
```json
{ "portalCount": 12, "channelCount": 4200, "liveCount": 47, "portals": [...] }
```

### Existing endpoints unchanged
- `GET /api/hub` — channel list
- `GET /api/hub/:id/scan` — SSE live scan (still available for manual re-discovery)
- `POST /api/hub/discover` — portal scrape trigger

---

## 7. Client Changes

### 7a. `Channel` type

Add optional `sources` field for multi-source playback:

```typescript
export interface Channel {
  id: string;
  name: string;
  logo: string;
  url: string;          // primary URL (backward compat)
  sources?: string[];   // all known URLs, ranked by reliability; url = sources[0]
  category: string;
  country: string;
  language: string;
}
```

### 7b. `VideoPlayer` — multi-source cycling

**Prop change:** `VideoPlayer` receives `channel: Channel | null` (unchanged interface). Internally it reads `channel.sources ?? [channel.url]` as the URL list.

**Source cycling logic:**
- `sourceIndex` ref tracks which URL in `sources[]` is currently active
- On fatal error (all HLS/mpegts retries exhausted): if `sourceIndex < sources.length - 1`, increment `sourceIndex` and reload — **no error screen shown**
- When cycling: show `"Switching source…"` in the existing buffering chip (top-right) instead of `"Buffering"` — same component, different text
- When `sourceIndex > 0`: show source indicator chip (top-left, `bg-black/70 backdrop-blur-md`, `"Source N"`, auto-hides after 4s)
- Only after **all sources exhausted**: show the error screen with `"Tried N sources"` subtitle

**Error screen copy update:**
```
"Stream unavailable"         (headline — unchanged)
"Tried 3 sources"            (sub-line — replaces channel name alone)
[Retry]                      (resets sourceIndex to 0, retries from top)
"or select another channel"  (unchanged)
```

### 7c. Zustand store additions

```typescript
interface AppState {
  // existing fields...
  liveHubChannelIds: Set<string>;          // HUB_CHANNEL IDs with alive pool URL
  setLiveHubChannelIds: (ids: string[]) => void;
}
```

`liveHubChannelIds` is refreshed by a `setInterval` in `App.tsx` polling `/api/hub/live` every 60s.

`setActiveChannel` updated to accept an optional `sources` array:
```typescript
setActiveChannel: (channel: Channel, sources?: string[]) => {
  const ch = sources ? { ...channel, sources } : channel;
  set({ activeChannel: ch, sidebarOpen: false });
}
```

### 7d. `HubPanel` — health-aware UI

**Channel cell changes:**

1. **Health dot** (absolute, `bottom-1.5 left-1.5 w-1.5 h-1.5 rounded-full`):
   - Live (id in `liveHubChannelIds`): `bg-green-500` with slow `animate-pulse` (3s)
   - Scanning (scan SSE active): `bg-amber-400 animate-pulse`
   - Dead (scan completed, 0 hits): `bg-zinc-700` (no pulse)
   - Unknown (never scanned): no dot

2. **Dead channel dimming**: `text-zinc-600` for name/short label when dead

3. **Action icon** (absolute, `bottom-1.5 right-1.5`):
   - Live → filled indigo `Play` icon (10px): clicking calls `setActiveChannel` directly with URLs from `/api/hub/:id/best` — no scan panel
   - Not live → zinc `Search` icon (10px): clicking opens existing scan panel

4. **Instant-play flow**: on Play click → `GET /api/hub/:id/best` → if 200, call `setActiveChannel(hubChannel, [url, ...fallbacks])` — closes sidebar, starts playing immediately

**Hub header status bar:**

```
[Satellite]  47 live · 89/150 channels     [Discover more]
             [████████████░░░░░░░░░░░░░░░] ← h-1 indigo progress bar
```

- `liveCount` from `/api/hub/status` (polled every 60s)
- Bar: `w-[${(liveCount/150)*100}%] bg-indigo-500 rounded-full transition-all duration-700`
- Green `text-green-400` for the live count number

---

## 8. Configuration

### New environment variables

| Variable | Required | Description |
|---|---|---|
| `PROXY_URL` | Optional | Residential proxy for Playwright (e.g. `http://user:pass@gate.iproyal.com:10000`). Without it, binTV and DL Playwright fallback remain blocked on fly.io. |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram bot token from BotFather. Telegram source inactive without this. |
| `TELEGRAM_CHANNELS` | Optional | Comma-separated channel usernames/IDs for the bot to monitor (e.g. `@bein_free_hd,@iptv_arabic_2026`). Find channels at tgstat.com. |

All added to `server/.env.example`.

---

## 9. File Map

### New files
| File | Purpose |
|---|---|
| `server/src/services/sportsPool.ts` | URL pool, health checker, SQLite persistence |
| `server/src/services/dlChannelMapper.ts` | DaddyLive channel → HUB_CHANNEL ID matching |
| `server/src/services/beInM3uSource.ts` | Fetch + parse Arabic/sports M3U repos, feed pool |
| `server/src/services/telegramSource.ts` | Telegram bot polling, URL extraction, pool feeding |

### Modified files
| File | Changes |
|---|---|
| `server/src/services/daddyliveSignedUrl.ts` | Auto-discover embed host; dynamic TTL from `expires` |
| `server/src/services/daddyliveSource.ts` | Mirror fallback for channel list URL |
| `server/src/services/browser.ts` | `PROXY_URL` support in shared browser context helper |
| `server/src/routes/bintv.ts` | Pass proxy option to `newContext()` |
| `server/src/routes/daddylive.ts` | Pass proxy option to Playwright fallback |
| `server/src/routes/hub.ts` | Add `/live` + `/best` endpoints; write scan hits to pool |
| `server/src/cache.ts` | Call `dlChannelMapper` after DL refresh; init beIn M3U + Telegram sources |
| `server/src/services/portalStore.ts` | Add `sport_pool` SQLite table — schema, insert, query, upsert helpers |
| `client/src/types.ts` | `Channel.sources?: string[]` |
| `client/src/components/VideoPlayer.tsx` | Multi-source cycling; UX copy updates |
| `client/src/components/HubPanel.tsx` | Health dots; play/scan icons; instant-play flow |
| `client/src/components/VideoPlayer.tsx` | Source indicator chip rendered directly in player (same pattern as buffering chip) |
| `client/src/store/useStore.ts` | `liveHubChannelIds`; updated `setActiveChannel` |
| `client/src/lib/api.ts` | `fetchHubLive()`, updated `fetchHubStatus()` |
| `client/src/App.tsx` | Poll `/api/hub/live` every 60s |
| `server/.env.example` | `PROXY_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNELS` |

---

## 10. Reliability Principles

- **No single point of failure**: every sport channel has 2+ URLs from independent sources
- **Silent recovery**: the user never sees an error screen unless every source is exhausted
- **Self-healing**: DaddyLive embed host auto-discovers; dead pool URLs trigger re-discovery
- **Graceful degradation**: if pool is empty for a channel, the existing manual scan still works
- **Configurable without redeploy**: proxy, Telegram channels via env vars / fly.io secrets
- **Health visibility**: the Hub panel shows pool health at a glance — green dots, live count bar
- **Source diversity**: Xtream portals + DaddyLive + M3U repos + Telegram = no single provider failure takes down beIN channels
