import { createHash } from 'node:crypto';
import type { Channel, EPGSchedule } from './types';
import { parseM3U } from './services/m3uParser';
import { parseEPG } from './services/epgParser';
import { batchCheck, markDead } from './services/aliveChecker';
import {
  initDb, loadPortals, savePortal, bulkSetHealth, deletePortal, pruneExcessPortals, countPortalsByHost,
  loadLiveDLChannels, upsertDLChannel, getChannelsToVerify, type DLChannelRow,
} from './services/portalStore';
import { buildChannelsFromPortal, scrapeAndVerify } from './services/xtreamVerifier';
import { scrapeDaddyliveChannels, type DLChannelMeta } from './services/daddyliveSource';
import { checkChannelLive } from './services/daddyliveSignedUrl';

const DEFAULT_M3U_URLS = [
  'https://iptv-org.github.io/iptv/index.m3u',
  'https://iptv-org.github.io/iptv/categories/sports.m3u',
];
const M3U_URLS: string[] = process.env.M3U_URLS
  ? process.env.M3U_URLS.split(',').map(u => u.trim()).filter(Boolean)
  : DEFAULT_M3U_URLS;

const M3U_REFRESH_MS         = 60 * 60 * 1000;
const PORTAL_RECHECK_MS      = 4 * 60 * 60 * 1000;
const ALIVE_CONCURRENCY    = 40;
const TARGET_PORTALS       = 50;
const MAX_PORTALS_PER_HOST = 3;

// How many auth errors (401/403) from the same portal host before evicting the whole portal.
// A portal with an expired subscription returns 401 on every channel. A portal with a
// valid subscription but some dead channels should survive this many dead plays before
// we conclude the whole subscription is gone.
const PORTAL_EVICT_THRESHOLD = 15;
const _portalErrorCounts = new Map<string, number>();

let _channels: Channel[]  = [];
let _epg: EPGSchedule     = {};
let _categories: string[] = [];
let _aliveRunning = false;

export const getChannels   = (): Channel[]    => _channels;
export const getEPG        = (): EPGSchedule  => _epg;
export const getCategories = (): string[]     => _categories;

function _hostname(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

function _evictPortalsByHost(hostname: string): void {
  const before = _channels.length;
  _channels    = _channels.filter(c => _hostname(c.url) !== hostname);
  _categories  = [...new Set(_channels.map(c => c.category))].sort();
  const removed = before - _channels.length;

  const portals = loadPortals().filter(p => _hostname(p.url) === hostname);
  const names   = portals.map(p => p.name).join(', ');
  for (const p of portals) deletePortal(p.id);

  if (portals.length > 0 || removed > 0) {
    console.warn(
      `[cache] Auto-evicted ${portals.length} portal(s) on ${hostname} (${names}) — too many auth errors. Removed ${removed} channels.`,
    );
  }
}

/**
 * Called by the stream proxy when upstream returns 4xx.
 * Always marks the individual URL as dead and removes it from the pool.
 * Only counts toward portal eviction for auth failures (401/403).
 * 404 = dead channel (normal — portals always have some dead channels),
 *       not a dead subscription → do NOT evict the portal for 404s.
 */
export function reportDeadUrl(url: string, countTowardEviction = true): void {
  markDead(url);
  _channels    = _channels.filter(c => c.url !== url);
  _categories  = [...new Set(_channels.map(c => c.category))].sort();
  if (countTowardEviction) {
    _incrementPortalErrors(_hostname(url));
  }
}

/**
 * Called by the stream proxy when upstream returns 5xx (server error / unavailable).
 * Does NOT permanently mark the URL dead (5xx is often temporary) but does increment
 * the portal error counter so that a consistently broken portal gets auto-evicted.
 */
export function reportUnreachable(url: string): void {
  _incrementPortalErrors(_hostname(url));
}

function _incrementPortalErrors(host: string | null): void {
  if (!host) return;
  const count = (_portalErrorCounts.get(host) ?? 0) + 1;
  if (count >= PORTAL_EVICT_THRESHOLD) {
    _portalErrorCounts.delete(host);
    _evictPortalsByHost(host);
  } else {
    _portalErrorCounts.set(host, count);
  }
}

function _mergeIn(incoming: Channel[]): void {
  const existing = new Set(_channels.map(c => c.url));
  const novel = incoming.filter(c => !existing.has(c.url));
  if (!novel.length) return;
  _channels    = [..._channels, ...novel];
  _categories  = [...new Set(_channels.map(c => c.category))].sort();
}

function _removeUrls(urls: Set<string>): void {
  _channels    = _channels.filter(c => !urls.has(c.url));
  _categories  = [...new Set(_channels.map(c => c.category))].sort();
}

// ── Alive checking ────────────────────────────────────────────────────────────
// We only alive-check the M3U/iptv-org channels (stable public streams, ~12k).
// Portal channels are cleaned up on demand via reportDeadUrl — checking 290k
// Xtream Codes URLs would take 25+ minutes and accomplishes nothing useful.

async function _runAliveCheck(channels: Channel[]): Promise<void> {
  if (_aliveRunning || channels.length === 0) return;
  _aliveRunning = true;
  console.log(`[cache] Alive check: ${channels.length} channels`);

  const checkedUrls = new Set(channels.map(c => c.url));
  const alive = await batchCheck(channels, {
    concurrency: ALIVE_CONCURRENCY,
    onProgress: (checked, total, ok) => {
      if (checked % 200 === 0 || checked === total)
        console.log(`[cache] Alive ${checked}/${total} ok=${ok}`);
    },
  });

  const aliveUrls = new Set(alive.map(c => c.url));
  const deadUrls  = new Set([...checkedUrls].filter(u => !aliveUrls.has(u)));

  bulkSetHealth([
    ...alive.map(c => ({ url: c.url, alive: true })),
    ...[...deadUrls].map(url => ({ url, alive: false })),
  ]);

  _removeUrls(deadUrls);
  console.log(`[cache] Alive check done: kept ${alive.length}, removed ${deadUrls.size}`);
  _aliveRunning = false;
}

// ── M3U sources ───────────────────────────────────────────────────────────────

async function _loadM3u(): Promise<Channel[]> {
  const results = await Promise.allSettled(
    M3U_URLS.map(url =>
      fetch(url, { signal: AbortSignal.timeout(30_000) })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then(t => parseM3U(t))
    )
  );
  const seen   = new Set<string>();
  const merged: Channel[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const ch of r.value) {
        if (!seen.has(ch.url)) { seen.add(ch.url); merged.push(ch); }
      }
    }
  }
  console.log(`[cache] M3U: ${merged.length} channels from ${M3U_URLS.length} sources`);
  return merged;
}

// ── Portal stream test ────────────────────────────────────────────────────────
// The portal API login may succeed (account exists) but streams can still return
// 401 if the subscription expired. Test-play a sample channel before adding any
// channels from a portal to the pool.

async function _portalStreamsWork(channels: Channel[]): Promise<boolean> {
  if (channels.length === 0) return false;
  // Sample from the middle of the list — less likely to be a broken channel at index 0
  const sample = channels[Math.min(Math.floor(channels.length / 2), channels.length - 1)];
  try {
    const ctrl = AbortSignal.timeout(6_000);
    const r = await fetch(sample.url, {
      method:  'GET',
      headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20', Range: 'bytes=0-1023' },
      signal:  ctrl,
    });
    // Drain the body so the socket can be reused
    await r.body?.cancel();
    // 401/403 = subscription expired. Anything else (200, 206, timeout, 404) = give benefit of doubt
    return r.status !== 401 && r.status !== 403;
  } catch {
    // Timeout or network error — not an auth failure, keep the portal
    return true;
  }
}

// ── Portal channels ───────────────────────────────────────────────────────────

async function _loadPortalChannels(): Promise<number> {
  const portals = loadPortals();
  if (!portals.length) return 0;
  console.log(`[cache] Loading channels from ${portals.length} portal(s)`);
  let working = 0;
  for (const portal of portals) {
    try {
      const chs = await buildChannelsFromPortal(portal);
      if (chs.length === 0) {
        deletePortal(portal.id);
        console.warn(`[cache] ${portal.name}: 0 channels (dead host?), removed`);
        continue;
      }

      // Stream-test before polluting the pool with thousands of dead URLs
      const ok = await _portalStreamsWork(chs);
      if (!ok) {
        deletePortal(portal.id);
        _evictPortalsByHost(_hostname(portal.url) ?? '');
        console.warn(`[cache] ${portal.name}: stream test returned 401/403, account expired, removed`);
        continue;
      }

      _mergeIn(chs);
      console.log(`[cache] ${portal.name}: +${chs.length} channels`);
      working++;
    } catch (e) {
      console.warn(`[cache] Portal ${portal.name} failed:`, e);
    }
  }
  return working;
}

// ── EPG ───────────────────────────────────────────────────────────────────────

async function _loadEpg(): Promise<void> {
  const urls   = [...new Set(_channels.filter(c => c.tvgUrl).map(c => c.tvgUrl!))];
  const merged: EPGSchedule = {};
  await Promise.allSettled(
    urls.slice(0, 10).map(async url => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!r.ok) return;
        Object.assign(merged, await parseEPG(await r.text()));
      } catch { /* skip */ }
    })
  );
  _epg = merged;
  console.log(`[cache] EPG: ${Object.keys(_epg).length} channels`);
}

// ── Background portal scraping ────────────────────────────────────────────────
// Each source scrapes a different data set — allow them to run concurrently.

const _scrapingBySource = new Set<string>();

export async function triggerPortalScrape(source: 'best' | 'fastest' | 'works' | 'arabic' = 'fastest', target = TARGET_PORTALS): Promise<void> {
  if (_scrapingBySource.has(source)) return;
  _scrapingBySource.add(source);
  console.log(`[cache] Scraping portals (source=${source}, target=${target})`);
  try {
    const found = await scrapeAndVerify({
      source, target,
      onVerified: (p) => {
        // Enforce per-host cap before saving — prevents one panel from flooding all slots
        try {
          const host = new URL(p.url).hostname;
          if (countPortalsByHost(host) >= MAX_PORTALS_PER_HOST) {
            console.log(`[cache] Scrape: ${p.name} skipped — already ${MAX_PORTALS_PER_HOST} portals from ${host}`);
            return;
          }
        } catch { /* malformed URL — let it through */ }
        savePortal(p);
        buildChannelsFromPortal(p).then(async chs => {
          if (chs.length === 0) return;
          const ok = await _portalStreamsWork(chs);
          if (!ok) {
            deletePortal(p.id);
            console.warn(`[cache] Scrape: ${p.name} streams 401/403, discarded`);
            return;
          }
          _mergeIn(chs);
          console.log(`[cache] Scrape: ${p.name} +${chs.length} channels`);
        }).catch((e: unknown) => {
          console.warn(`[cache] Scrape: ${p.name} channel load failed:`, (e as Error)?.message ?? e);
        });
      },
    });
    console.log(`[cache] Scrape done (${source}): ${found.length} new portal(s)`);
  } catch (e) {
    console.error(`[cache] Scrape error (${source}):`, e);
  } finally {
    _scrapingBySource.delete(source);
  }
}

async function _revalidatePortals(): Promise<void> {
  const portals = loadPortals();
  const stale   = portals.filter(p => Date.now() - p.lastVerifiedAt > PORTAL_RECHECK_MS);
  if (!stale.length) return;
  console.log(`[cache] Re-validating ${stale.length} stale portal(s)`);
  for (const p of stale) {
    const { verifyOrNull } = await import('./services/xtreamClient');
    const result = await verifyOrNull(p).catch(() => null);
    if (result) {
      savePortal({ ...p, lastVerifiedAt: Date.now() });
    } else {
      deletePortal(p.id);
      _evictPortalsByHost(_hostname(p.url) ?? '');
      console.log(`[cache] Portal ${p.name} expired, removed`);
    }
  }
}

// ── DaddyLive channel management ──────────────────────────────────────────────
//
// Strategy (best practice for ~900 channels):
//
//  1. INSTANT STARTUP  — load previously verified live channels from SQLite.
//     Users see channels immediately, even on a cold server restart.
//
//  2. BACKGROUND SCRAPE+VERIFY — after startup, scrape the full channel list
//     from DaddyLive, then verify only the stale/unknown entries (concurrency=15,
//     100 ms between batches). New channels appear as they clear verification.
//
//  3. PERSISTENT CACHE — every result (live OR offline) is written to SQLite
//     so the next restart is always instant, even after a long downtime.
//
//  4. PERIODIC REFRESH — repeats every 30 min: re-scrape list (picks up newly
//     added channels) + re-verify everything older than 30 min.

const DL_VERIFY_CONCURRENCY  = 15;         // parallel embed-page fetches
const DL_BATCH_DELAY_MS      = 80;         // ms between batches (rate-limit protection)
const DL_LIVE_STALE_MS       = 30 * 60 * 1000;  // re-verify live channels every 30 min
const DL_OFFLINE_STALE_MS    = 5 * 60 * 1000;   // re-verify offline channels every 5 min
let   _dlVerifyRunning        = false;

function _dlBaseUrl(id: number) { return `/api/daddylive/${id}`; }
function _dlTsUrl(id: number)   { return `/api/daddylive/${id}/ts`; }
function _isDlUrl(url: string)  { return url.startsWith('/api/daddylive/'); }

function _dlRowToChannel(row: DLChannelRow): Channel {
  const url = row.codec === 'hevc' ? _dlTsUrl(row.id) : _dlBaseUrl(row.id);
  const id  = createHash('sha256').update(`daddylive:${row.id}`).digest('hex').slice(0, 16);
  return { id, name: row.name, logo: '', url, category: row.category, country: '', language: 'mul' };
}

/** Load previously verified live channels from DB and inject them into the pool. */
function _loadDLFromDb(): void {
  const rows = loadLiveDLChannels();
  if (!rows.length) return;
  _mergeIn(rows.map(_dlRowToChannel));
  console.log(`[cache] DaddyLive: loaded ${rows.length} live channels from DB`);
}

/** Run a rate-limited parallel verification over a list of channel metas. */
async function _verifyBatch(metas: DLChannelMeta[]): Promise<void> {
  let i = 0;
  while (i < metas.length) {
    const batch = metas.slice(i, i + DL_VERIFY_CONCURRENCY);
    i += DL_VERIFY_CONCURRENCY;

    await Promise.allSettled(batch.map(async meta => {
      const codec = await checkChannelLive(meta.id).catch((): false => false);
      const now   = Date.now();

      // Persist result to DB regardless of live/offline status
      upsertDLChannel({
        id:          meta.id,
        name:        meta.name,
        category:    meta.category,
        codec:       codec || null,
        verified_at: now,
      });

      if (codec) {
        // Channel is live — inject into pool with correct URL
        _mergeIn([_dlRowToChannel({ id: meta.id, name: meta.name, category: meta.category, codec, verified_at: now })]);
      } else {
        // Channel went offline — evict from pool
        const base = _dlBaseUrl(meta.id);
        const ts   = _dlTsUrl(meta.id);
        _channels   = _channels.filter(c => c.url !== base && c.url !== ts);
        _categories = [...new Set(_channels.map(c => c.category))].sort();
      }
    }));

    if (i < metas.length) await new Promise(r => setTimeout(r, DL_BATCH_DELAY_MS));
  }
}

/** Full scrape+verify cycle. Safe to call concurrently (second call is a no-op). */
async function _runDLRefresh(): Promise<void> {
  if (_dlVerifyRunning) return;
  _dlVerifyRunning = true;
  try {
    // 1. Scrape the full channel list
    const scraped = await scrapeDaddyliveChannels();
    if (!scraped.length) return;                        // scrape failed, keep DB state

    // 2. Find channels that need verification.
    // Live channels: recheck every 30 min. Offline channels: recheck every 5 min so
    // they reappear quickly when a broadcast starts.
    const verifyIds = new Set(getChannelsToVerify(
      scraped.map(m => m.id), DL_LIVE_STALE_MS, DL_OFFLINE_STALE_MS,
    ));
    const toVerify = scraped.filter(m => verifyIds.has(m.id));

    if (!toVerify.length) {
      console.log('[cache] DaddyLive: all channels fresh, skipping verification');
      return;
    }

    console.log(`[cache] DaddyLive: verifying ${toVerify.length}/${scraped.length} stale channels…`);
    await _verifyBatch(toVerify);

    const liveCount = _channels.filter(c => _isDlUrl(c.url)).length;
    console.log(`[cache] DaddyLive: refresh done — ${liveCount} live in pool`);
  } finally {
    _dlVerifyRunning = false;
  }
}

// ── bintv.online live event channels ─────────────────────────────────────────
// Each sporttsonline stream becomes a channel at /api/bintv/<channelId>

const BINTV_JSON_URL  = 'https://prabashsapkota.github.io/bintvjson/index.json';
const BINTV_REFRESH_MS = 2 * 60 * 60 * 1000; // 2h

function _isBintvUrl(url: string) { return url.startsWith('/api/bintv/'); }

function _langToCode(lang: string): string {
  const l = lang.toLowerCase();
  if (l.includes('arabic') || l.includes('arab')) return 'ara';
  if (l.includes('french')) return 'fra';
  if (l.includes('hindi')) return 'hin';
  return 'eng';
}

function _parseBintvEvents(events: Record<string, unknown>[]): Channel[] {
  const seen = new Set<string>();
  const out: Channel[] = [];
  for (const ev of events) {
    const evName = String(ev['name'] ?? '');
    const logo   = String(ev['logo'] ?? '');
    for (const [key, val] of Object.entries(ev)) {
      if (!key.startsWith('url_') || typeof val !== 'string') continue;
      const m = val.match(/sporttsonline\.click\/channels\/hd\/(hd\d+)\.php/);
      if (!m) continue;
      const channelId = m[1];
      if (seen.has(channelId)) continue;
      seen.add(channelId);
      const lang = key.replace('url_', '').replace(/\s*-\s*Stream\s*\d+$/, '').trim();
      const id   = createHash('sha256').update(`bintv:${channelId}`).digest('hex').slice(0, 16);
      out.push({
        id,
        name:     `${evName} (${lang})`,
        logo,
        url:      `/api/bintv/${channelId}`,
        category: 'soccer',
        country:  '',
        language: _langToCode(lang),
      });
    }
  }
  return out;
}

async function _loadBintvChannels(): Promise<void> {
  try {
    const r = await fetch(BINTV_JSON_URL, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return;
    const events = await r.json() as Record<string, unknown>[];
    if (!Array.isArray(events)) return;
    const channels = _parseBintvEvents(events);
    if (!channels.length) return;
    _channels = _channels.filter(c => !_isBintvUrl(c.url));
    _mergeIn(channels);
    console.log(`[cache] bintv: ${channels.length} live event channel(s)`);
  } catch (e) {
    console.warn('[cache] bintv fetch failed:', (e as Error).message);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initCache(): Promise<void> {
  initDb();

  // Prune excess portals from the same server before loading — prevents one host
  // (e.g. 35+ xc.adultiptv.net accounts) from consuming all portal slots.
  const pruned = pruneExcessPortals(MAX_PORTALS_PER_HOST);
  if (pruned > 0) console.log(`[cache] Pruned ${pruned} excess portals at startup`);

  // DaddyLive: load previously verified live channels from DB instantly so
  // users see channels right away, then kick off background scrape+verify.
  _loadDLFromDb();
  _runDLRefresh().catch(console.error);

  // bintv and M3U load in parallel — both are fast HTTP fetches, independent of portals
  const [m3uChannels] = await Promise.all([
    _loadM3u().catch((): Channel[] => []),
    _loadBintvChannels().catch(console.error),
  ]);

  _channels   = [..._channels, ...m3uChannels];
  _categories = [...new Set(_channels.map(c => c.category))].sort();

  setInterval(() => _loadBintvChannels().catch(console.error), BINTV_REFRESH_MS).unref();

  const workingPortals = await _loadPortalChannels();

  await _loadEpg().catch(() => {});

  // Only alive-check the M3U channels (~12k) — fast enough (~30s at concurrency 40).
  // Portal channels (290k+) are cleaned up on demand via reportDeadUrl/auto-eviction.
  _runAliveCheck([...m3uChannels]).catch(console.error);

  // Always search all sources in parallel — more portals = more channel diversity.
  // Each source runs concurrently (different data sets, independent locks).
  // 'best' = Xtreamity R2 pre-validated DB (thousands of accounts)
  // 'fastest' = XML2 GitHub credential dumps
  // 'works' = Reddit r/IPTV_ZONENEW
  // 'arabic' = Reddit r/IPTV (more international, better for Arabic/beIN content)
  triggerPortalScrape('best',    TARGET_PORTALS).catch(console.error);
  triggerPortalScrape('fastest', TARGET_PORTALS).catch(console.error);
  triggerPortalScrape('works',   TARGET_PORTALS).catch(console.error);
  triggerPortalScrape('arabic',  TARGET_PORTALS).catch(console.error);

  // Run every 5 min — offline channels are re-verified every 5 min, live ones only
  // if older than 30 min. The interval just determines how often we check the schedule.
  setInterval(() => _runDLRefresh().catch(console.error), DL_OFFLINE_STALE_MS).unref();

  setInterval(async () => {
    const chs = await _loadM3u().catch(() => []);
    _mergeIn(chs);
    _runAliveCheck(chs).catch(console.error);
    await _loadEpg().catch(() => {});
  }, M3U_REFRESH_MS).unref();

  setInterval(() => _revalidatePortals().catch(console.error), PORTAL_RECHECK_MS).unref();
}
