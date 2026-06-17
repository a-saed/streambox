import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import type { VerifiedPortal } from '../types';

let _db: Database.Database | null = null;

export function initDb(dbPath?: string): void {
  const p = dbPath ?? process.env.PORTAL_DB_PATH
    ?? path.join(process.cwd(), 'data', 'portals.db');

  if (p !== ':memory:') {
    mkdirSync(path.dirname(p), { recursive: true });
  }

  _db = new Database(p);
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS portals (
      id                TEXT PRIMARY KEY,
      url               TEXT NOT NULL,
      username          TEXT NOT NULL,
      password          TEXT NOT NULL,
      source            TEXT NOT NULL DEFAULT '',
      name              TEXT NOT NULL DEFAULT '',
      expiry            TEXT NOT NULL DEFAULT '',
      max_connections   TEXT NOT NULL DEFAULT '1',
      active_connections TEXT NOT NULL DEFAULT '0',
      stream_count      INTEGER NOT NULL DEFAULT 0,
      last_verified_at  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dead_creds (
      cred_key  TEXT PRIMARY KEY,
      failed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channel_health (
      url        TEXT PRIMARY KEY,
      alive      INTEGER NOT NULL,
      checked_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daddylive_channels (
      id          INTEGER PRIMARY KEY,
      name        TEXT    NOT NULL,
      category    TEXT    NOT NULL,
      codec       TEXT,                      -- 'h264' | 'hevc' | NULL (offline)
      verified_at INTEGER NOT NULL DEFAULT 0 -- unix ms of last check
    );
  `);
}

function db(): Database.Database {
  if (!_db) initDb();
  return _db!;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}

// ── Portals ──────────────────────────────────────────────────────────────────

export function savePortal(p: VerifiedPortal): void {
  db().prepare(`
    INSERT OR REPLACE INTO portals
      (id, url, username, password, source, name, expiry,
       max_connections, active_connections, stream_count, last_verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p.id, p.url, p.username, p.password, p.source, p.name, p.expiry,
    p.maxConnections, p.activeConnections, p.streamCount, p.lastVerifiedAt,
  );
}

export function loadPortals(): VerifiedPortal[] {
  return (db().prepare(
    'SELECT id, url, username, password, source, name, expiry, ' +
    'max_connections AS maxConnections, active_connections AS activeConnections, ' +
    'stream_count AS streamCount, last_verified_at AS lastVerifiedAt ' +
    'FROM portals ORDER BY last_verified_at DESC'
  ).all() as VerifiedPortal[]);
}

export function deletePortal(id: string): void {
  db().prepare('DELETE FROM portals WHERE id = ?').run(id);
}

export function countPortalsByHost(hostname: string): number {
  const portals = loadPortals();
  return portals.filter(p => { try { return new URL(p.url).hostname === hostname; } catch { return false; } }).length;
}

/**
 * Enforce a per-host portal cap. Keeps the `maxPerHost` most recently verified
 * portals per hostname and deletes the rest. Prevents one IPTV server from
 * occupying every slot (e.g., 35 accounts on the same adult-content panel).
 */
export function pruneExcessPortals(maxPerHost = 3): number {
  const portals = loadPortals();
  const byHost = new Map<string, VerifiedPortal[]>();
  for (const p of portals) {
    try {
      const host = new URL(p.url).hostname;
      const list = byHost.get(host) ?? [];
      list.push(p);
      byHost.set(host, list);
    } catch { /* skip malformed URLs */ }
  }
  let deleted = 0;
  for (const [host, list] of byHost) {
    if (list.length <= maxPerHost) continue;
    const sorted  = list.sort((a, b) => b.lastVerifiedAt - a.lastVerifiedAt);
    const toDelete = sorted.slice(maxPerHost);
    for (const p of toDelete) deletePortal(p.id);
    deleted += toDelete.length;
    console.log(`[portals] Pruned ${toDelete.length} excess portals from ${host} (kept ${maxPerHost})`);
  }
  return deleted;
}

// ── Dead credentials ─────────────────────────────────────────────────────────

/** Cred key format: `${username}|${password}` (lowercased). */
export function markCredDead(credKey: string): void {
  db().prepare(
    'INSERT OR REPLACE INTO dead_creds (cred_key, failed_at) VALUES (?, ?)'
  ).run(credKey, Date.now());
}

export function isCredDead(credKey: string, ttlMs = 24 * 60 * 60 * 1000): boolean {
  const row = db().prepare(
    'SELECT failed_at FROM dead_creds WHERE cred_key = ?'
  ).get(credKey) as { failed_at: number } | undefined;
  if (!row) return false;
  return Date.now() - row.failed_at < ttlMs;
}

// ── Channel health ────────────────────────────────────────────────────────────

export function setChannelHealth(url: string, alive: boolean): void {
  db().prepare(
    'INSERT OR REPLACE INTO channel_health (url, alive, checked_at) VALUES (?, ?, ?)'
  ).run(url, alive ? 1 : 0, Date.now());
}

/**
 * Returns persisted alive status for a URL, or null if unknown / older than ttlMs.
 * Default TTL 30 min matches the in-memory cache in aliveChecker.
 */
export function getChannelHealth(url: string, ttlMs = 30 * 60 * 1000): boolean | null {
  const row = db().prepare(
    'SELECT alive, checked_at FROM channel_health WHERE url = ?'
  ).get(url) as { alive: number; checked_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.checked_at > ttlMs) return null;
  return row.alive === 1;
}

export function bulkSetHealth(entries: Array<{ url: string; alive: boolean }>): void {
  const stmt = db().prepare(
    'INSERT OR REPLACE INTO channel_health (url, alive, checked_at) VALUES (?, ?, ?)'
  );
  const now = Date.now();
  const bulk = db().transaction((rows: typeof entries) => {
    for (const { url, alive } of rows) stmt.run(url, alive ? 1 : 0, now);
  });
  bulk(entries);
}

// ── DaddyLive channel cache ───────────────────────────────────────────────────

export interface DLChannelRow {
  id:          number;
  name:        string;
  category:    string;
  codec:       string | null;  // 'h264' | 'hevc' | null (was offline at last check)
  verified_at: number;
}

export function upsertDLChannel(row: DLChannelRow): void {
  db().prepare(`
    INSERT OR REPLACE INTO daddylive_channels (id, name, category, codec, verified_at)
    VALUES (@id, @name, @category, @codec, @verified_at)
  `).run(row);
}

export function bulkUpsertDLChannels(rows: DLChannelRow[]): void {
  const stmt = db().prepare(`
    INSERT OR REPLACE INTO daddylive_channels (id, name, category, codec, verified_at)
    VALUES (@id, @name, @category, @codec, @verified_at)
  `);
  const run = db().transaction((r: DLChannelRow[]) => { for (const row of r) stmt.run(row); });
  run(rows);
}

/** Returns all channels whose last check found them live (codec != null). */
export function loadLiveDLChannels(): DLChannelRow[] {
  return db().prepare(
    'SELECT id, name, category, codec, verified_at FROM daddylive_channels WHERE codec IS NOT NULL ORDER BY id'
  ).all() as DLChannelRow[];
}

/** Returns all known channels (live + offline). */
export function loadAllDLChannels(): DLChannelRow[] {
  return db().prepare(
    'SELECT id, name, category, codec, verified_at FROM daddylive_channels ORDER BY id'
  ).all() as DLChannelRow[];
}

/**
 * Returns IDs that need re-verification, using different thresholds for live vs offline channels.
 * Offline channels are rechecked more frequently (offlineMs) so they reappear quickly when
 * the broadcast starts. Live channels are rechecked less often (liveMs) to avoid hammering CDNs.
 * New channels (not yet in DB) are always included.
 */
export function getChannelsToVerify(
  knownIds:  number[],
  liveMs:    number,
  offlineMs: number,
): number[] {
  const inDb = new Map<number, { verified_at: number; codec: string | null }>(
    (db().prepare('SELECT id, verified_at, codec FROM daddylive_channels').all() as Array<{
      id: number; verified_at: number; codec: string | null;
    }>).map(r => [r.id, { verified_at: r.verified_at, codec: r.codec }])
  );
  const now = Date.now();
  return knownIds.filter(id => {
    const row = inDb.get(id);
    if (!row) return true;                                  // new channel — always verify
    const threshold = row.codec ? liveMs : offlineMs;
    return row.verified_at < now - threshold;
  });
}

/** @deprecated Use getChannelsToVerify with separate live/offline thresholds */
export function getStaleDLIds(knownIds: number[], staleMsThreshold: number): number[] {
  return getChannelsToVerify(knownIds, staleMsThreshold, staleMsThreshold);
}
