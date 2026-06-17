import type { IptvPortal, VerifiedPortal, Channel } from '../types';
import { verifyOrNull, categories, streams, streamUrl } from './xtreamClient';
import { scrapePage, type ScrapeSource } from './xtreamScraper';
import { isCredDead, markCredDead } from './portalStore';
import { parseM3U } from './m3uParser';

const UA = 'VLC/3.0.20 LibVLC/3.0.20';
const enc = encodeURIComponent;
const M3U_SIZE_LIMIT = 30 * 1024 * 1024; // 30 MB guard

/** Fetch channels via M3U endpoint — fallback for portals that don't support JSON API. */
export async function portalM3UChannels(portal: IptvPortal): Promise<Channel[]> {
  const url = `${portal.url}/get.php?username=${enc(portal.username)}&password=${enc(portal.password)}&type=m3u_plus&output=m3u8`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) return [];
    const cl = parseInt(resp.headers.get('content-length') ?? '0', 10);
    if (cl > M3U_SIZE_LIMIT) {
      console.warn(`[xtream] M3U too large (${Math.round(cl / 1e6)}MB) ${portal.url}, skipping`);
      return [];
    }
    const text = await resp.text();
    if (!text.trimStart().startsWith('#EXTM3U')) return [];
    return parseM3U(text);
  } catch {
    return [];
  }
}

const VERIFY_CONCURRENCY = 4;

function semaphore(n: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => { if (queue.length && active < n) { active++; queue.shift()!(); } };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise((res, rej) => { queue.push(() => fn().then(res, rej).finally(() => { active--; next(); })); next(); });
}

export interface VerifyOpts {
  portals: IptvPortal[];
  target?: number;
  isCancelled?: () => boolean;
  onAttempt?: (url: string) => void;
  onVerified?: (p: VerifiedPortal) => void;
  onProgress?: (checked: number, total: number, alive: number) => void;
}

/** Verify up to `target` portals concurrently. Stops as soon as target is reached. */
export async function verifyUntil(opts: VerifyOpts): Promise<VerifiedPortal[]> {
  const { portals, target = 10, isCancelled, onAttempt, onVerified, onProgress } = opts;
  const verified: VerifiedPortal[] = [];
  let nextIdx = 0, checked = 0, done = false;
  const run = semaphore(VERIFY_CONCURRENCY);

  async function worker(): Promise<void> {
    while (!done) {
      if (isCancelled?.()) { done = true; return; }
      if (verified.length >= target) { done = true; return; }
      const idx = nextIdx++;
      if (idx >= portals.length) return;

      const portal = portals[idx];
      const credKey = `${portal.username}|${portal.password}`.toLowerCase();
      if (isCredDead(credKey)) { checked++; onProgress?.(checked, portals.length, verified.length); continue; }

      onAttempt?.(portal.url);
      const v = await verifyOrNull(portal).catch(() => null);
      if (done) return;

      checked++;
      if (v) {
        verified.push(v);
        onVerified?.(v);
      } else {
        markCredDead(credKey);
      }
      onProgress?.(checked, portals.length, verified.length);
      if (verified.length >= target) { done = true; }
    }
  }

  const workers = Array.from({ length: Math.min(VERIFY_CONCURRENCY, portals.length) }, () => run(worker));
  await Promise.all(workers);
  return verified;
}

export interface ScrapeVerifyOpts {
  source?: ScrapeSource;
  target?: number;
  isCancelled?: () => boolean;
  onAttempt?: (url: string) => void;
  onVerified?: (p: VerifiedPortal) => void;
  onProgress?: (checked: number, total: number, alive: number) => void;
}

/**
 * Scrape credentials from `source`, verify them, return up to `target` working portals.
 * Paginates through the source until target is reached or source exhausted.
 */
export async function scrapeAndVerify(opts: ScrapeVerifyOpts = {}): Promise<VerifiedPortal[]> {
  const { source = 'best', target = 10, isCancelled, onAttempt, onVerified, onProgress } = opts;
  const allVerified: VerifiedPortal[] = [];
  let cursor: string | undefined;

  while (allVerified.length < target) {
    if (isCancelled?.()) break;
    const page = await scrapePage(source, cursor);
    if (page.portals.length === 0 && !page.nextCursor) break;

    const batch = await verifyUntil({
      portals: page.portals,
      target: target - allVerified.length,
      isCancelled,
      onAttempt,
      onVerified: (p) => { allVerified.push(p); onVerified?.(p); },
      onProgress,
    });

    if (batch.length === 0 && !page.nextCursor) break;
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return allVerified;
}

/**
 * Fetch all live channels from a verified portal (live streams only).
 * Returns them as Channel objects compatible with the existing cache.
 */
export async function buildChannelsFromPortal(portal: VerifiedPortal): Promise<Channel[]> {
  // Try JSON API first (fast, structured)
  const allStreams = await streams(portal, 'live');
  if (allStreams.length > 0) {
    const catMap = new Map<string, string>();
    const cats = await categories(portal, 'live').catch(() => []);
    for (const c of cats) catMap.set(c.id, c.name);

    return allStreams
      .filter(s => s.streamId && s.name)
      .map(s => {
        const url = streamUrl(portal, s);
        if (!url) return null;
        return {
          id:       s.streamId,
          name:     s.name,
          logo:     s.icon,
          url,
          category: catMap.get(s.categoryId) ?? s.categoryId,
          country:  '',
          language: '',
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
  }

  // Fallback: M3U endpoint — many portals block the JSON API for free accounts
  // but still serve /get.php?type=m3u_plus
  console.log(`[xtream] API returned 0 streams for ${portal.url}, trying M3U fallback`);
  const m3uChannels = await portalM3UChannels(portal);
  if (m3uChannels.length > 0) {
    console.log(`[xtream] M3U fallback: ${m3uChannels.length} channels from ${portal.url}`);
  }
  return m3uChannels;
}
