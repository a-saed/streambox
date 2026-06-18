import {
  upsertSportPoolEntry, updateSportPoolHealth,
  loadSportPoolEntries, deleteSportPoolEntry,
} from './portalStore';

export type PoolSource = 'daddylive' | 'xtream' | 'm3u' | 'telegram' | 'bintv';

export interface PoolEntry {
  url: string;
  source: PoolSource;
  addedAt: number;
  lastChecked: number;
  alive: boolean;
  failCount: number;
}

const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const HEALTH_CHECK_CONCURRENCY = 10;
const TELEGRAM_TTL_MS          = 2 * 60 * 60 * 1000;
const SKIP_IF_CHECKED_WITHIN   = 4 * 60 * 1000;

const _pool = new Map<string, PoolEntry[]>();

export function addUrls(channelId: string, entries: Array<{ url: string; source: PoolSource }>): void {
  const existing = _pool.get(channelId) ?? [];
  for (const { url, source } of entries) {
    const hit = existing.find(e => e.url === url);
    if (hit) {
      // URL already tracked — revive it if dead (source is confirming it's live again)
      if (!hit.alive || hit.failCount > 0) {
        hit.alive     = true;
        hit.failCount = 0;
        updateSportPoolHealth(url, true, 0);
      }
      continue;
    }
    const entry: PoolEntry = { url, source, addedAt: Date.now(), lastChecked: 0, alive: true, failCount: 0 };
    existing.push(entry);
    upsertSportPoolEntry({ url, channelId, source, addedAt: entry.addedAt, lastChecked: 0, alive: true, failCount: 0 });
  }
  _pool.set(channelId, existing);
}

export function getBestUrl(channelId: string): { url: string; source: string } | null {
  const alive = (_pool.get(channelId) ?? []).find(e => e.alive);
  return alive ? { url: alive.url, source: alive.source } : null;
}

export function getAliveChannelIds(): string[] {
  return [..._pool.entries()]
    .filter(([, entries]) => entries.some(e => e.alive))
    .map(([id]) => id);
}

export function markResult(url: string, alive: boolean): void {
  for (const [, entries] of _pool.entries()) {
    const entry = entries.find(e => e.url === url);
    if (!entry) continue;
    entry.alive       = alive;
    entry.lastChecked = Date.now();
    entry.failCount   = alive ? 0 : entry.failCount + 1;
    updateSportPoolHealth(url, alive, entry.failCount);
    return;
  }
}

export function getPoolStats(): Array<{ channelId: string; aliveCount: number; totalCount: number }> {
  return [..._pool.entries()].map(([channelId, entries]) => ({
    channelId,
    aliveCount: entries.filter(e => e.alive).length,
    totalCount: entries.length,
  }));
}

function _isProxyUrl(url: string): boolean {
  return !url.startsWith('http://') && !url.startsWith('https://');
}

function _evictDeadEntries(): void {
  for (const [channelId, entries] of _pool.entries()) {
    // Never evict internal proxy URLs — their lifecycle is managed by their own
    // verify cycles (DL every 5-30 min, bintv every 2h), not the health checker.
    const keep = entries.filter(e => _isProxyUrl(e.url) || e.failCount < 2);
    entries
      .filter(e => !_isProxyUrl(e.url) && e.failCount >= 2)
      .forEach(e => deleteSportPoolEntry(e.url));
    _pool.set(channelId, keep);
  }
}

function _evictStaleTelegram(): void {
  const now = Date.now();
  for (const [channelId, entries] of _pool.entries()) {
    _pool.set(channelId, entries.filter(e => !(e.source === 'telegram' && now - e.addedAt > TELEGRAM_TTL_MS)));
  }
}

async function _runHealthCheck(): Promise<void> {
  _evictStaleTelegram();

  const toCheck: Array<{ url: string }> = [];
  const now = Date.now();
  for (const entries of _pool.values()) {
    for (const entry of entries) {
      // Internal proxy URLs (/api/daddylive/*, /api/bintv/*) are not direct HTTP
      // streams — fetching them would fail and falsely mark them dead. Their freshness
      // is managed by the DL verify cycle and bintv refresh, not the health checker.
      if (_isProxyUrl(entry.url)) continue;
      if (now - entry.lastChecked < SKIP_IF_CHECKED_WITHIN) continue;
      toCheck.push({ url: entry.url });
    }
  }
  if (!toCheck.length) return;

  let i = 0;
  while (i < toCheck.length) {
    const batch = toCheck.slice(i, i + HEALTH_CHECK_CONCURRENCY);
    i += HEALTH_CHECK_CONCURRENCY;
    await Promise.allSettled(batch.map(async ({ url }) => {
      try {
        const r = await fetch(url, {
          method: 'HEAD',
          headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20' },
          signal: AbortSignal.timeout(5_000),
        });
        // Some servers reject HEAD — fall back to range GET
        if (r.status === 405) {
          const r2 = await fetch(url, {
            headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20', Range: 'bytes=0-1023' },
            signal: AbortSignal.timeout(5_000),
          });
          await r2.body?.cancel();
          markResult(url, r2.ok || r2.status === 206);
        } else {
          markResult(url, r.ok || r.status === 206 || r.status === 302);
        }
      } catch {
        markResult(url, false);
      }
    }));
  }

  _evictDeadEntries();
}

export function initSportsPool(): void {
  _pool.clear();
  const rows = loadSportPoolEntries();
  for (const row of rows) {
    const existing = _pool.get(row.channelId) ?? [];
    existing.push({
      url: row.url, source: row.source as PoolSource,
      addedAt: row.addedAt, lastChecked: row.lastChecked,
      alive: row.alive, failCount: row.failCount,
    });
    _pool.set(row.channelId, existing);
  }
  setInterval(() => _runHealthCheck().catch(console.error), HEALTH_CHECK_INTERVAL_MS).unref();
  console.log(`[sportsPool] Loaded ${rows.length} entries from DB`);
}
