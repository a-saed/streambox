import { Router } from 'express';
import { loadPortals } from '../services/portalStore';
import { streams, streamUrl } from '../services/xtreamClient';
import { checkUrl } from '../services/aliveChecker';
import { HUB_CHANNELS, channelById, matchesChannel, type HubChannel } from '../services/channelHub';
import { portalM3UChannels } from '../services/xtreamVerifier';
import { getChannels, triggerPortalScrape } from '../cache';
import type { VerifiedPortal } from '../types';
import { addUrls, getBestUrl, getAliveChannelIds } from '../services/sportsPool';

const router = Router();

function semaphore(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  function next() {
    if (queue.length && active < concurrency) { active++; queue.shift()!(); }
  }
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject).finally(() => { active--; next(); }));
      next();
    });
  };
}

/** List all curated hub channels. */
router.get('/', (_req, res) => {
  res.json({
    channels: HUB_CHANNELS.map(ch => ({
      id: ch.id,
      name: ch.name,
      short: ch.short,
      category: ch.category,
      broadcasters: ch.broadcasters ?? [],
    })),
  });
});

/** Portal count + scrape status for the UI. */
router.get('/status', (_req, res) => {
  const portals = loadPortals();
  res.json({
    portalCount: portals.length,
    channelCount: getChannels().length,
    liveCount: getAliveChannelIds().length,
    portals: portals.map(p => ({ id: p.id, name: p.name, streamCount: p.streamCount })),
  });
});

/** Returns all channel IDs that have at least one alive stream in the pool. */
router.get('/live', (_req, res) => {
  res.json({ liveChannelIds: getAliveChannelIds() });
});

/** Returns the best (first alive) stream URL for a given channel. */
router.get('/:channelId/best', (req, res) => {
  const best = getBestUrl(req.params.channelId);
  if (!best) return res.status(404).json({ error: 'no live stream cached' });
  res.json(best);
});

/** Trigger a fresh portal scrape (fire-and-forget). */
router.post('/discover', (req, res) => {
  const target = Math.min(parseInt(String(req.body?.target ?? '50'), 10) || 50, 100);
  // All 4 sources run concurrently — each has its own scraping lock
  triggerPortalScrape('best',    target).catch(console.error);
  triggerPortalScrape('fastest', target).catch(console.error);
  triggerPortalScrape('works',   target).catch(console.error);
  triggerPortalScrape('arabic',  target).catch(console.error);
  res.json({ ok: true, message: `Discovering up to ${target} portals from 4 sources` });
});

/**
 * SSE scan — searches the live M3U channel pool first (instant), then all
 * verified portals (takes longer). Alive-checks every candidate.
 *
 * Events: status | candidate | progress | hit | done | error
 */
router.get('/:id/scan', async (req, res) => {
  const channel = channelById(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Unknown channel id' });

  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'Access-Control-Allow-Origin': req.headers.origin ?? '*',
  });
  res.flushHeaders();

  let cancelled = false;
  req.on('close', () => { cancelled = true; });

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const candidateUrls = new Set<string>();
    interface Candidate { url: string; streamName: string; portalName: string }
    const candidates: Candidate[] = [];

    // ── Phase 1: search already-loaded M3U channels (instant) ─────────────────
    const poolMatches = getChannels().filter(ch => matchesChannel(ch.name, channel as HubChannel));
    if (poolMatches.length > 0) {
      send('status', { message: `Found ${poolMatches.length} candidate(s) in channel pool…` });
      for (const ch of poolMatches) {
        if (!ch.url || candidateUrls.has(ch.url)) continue;
        candidateUrls.add(ch.url);
        candidates.push({ url: ch.url, streamName: ch.name, portalName: 'M3U' });
        send('candidate', { url: ch.url, streamName: ch.name, portalName: 'M3U' });
      }
    }

    if (cancelled) return res.end();

    // ── Phase 2: search all verified portals (8 concurrent) ───────────────────
    const portals = loadPortals() as VerifiedPortal[];
    if (portals.length > 0) {
      send('status', { message: `Scanning ${portals.length} portal(s)…` });
      const portalRun = semaphore(8);

      await Promise.all(portals.map(portal =>
        portalRun(async () => {
          if (cancelled) return;
          const live = await streams(portal, 'live').catch(() => []);

          if (live.length > 0) {
            for (const s of live) {
              if (!matchesChannel(s.name, channel as HubChannel)) continue;
              const url = streamUrl(portal, s);
              if (!url || candidateUrls.has(url)) continue;
              candidateUrls.add(url);
              candidates.push({ url, streamName: s.name, portalName: portal.name });
              send('candidate', { url, streamName: s.name, portalName: portal.name });
            }
          } else {
            // M3U fallback for portals that block the JSON API
            const m3uChs = await portalM3UChannels(portal).catch(() => []);
            for (const ch of m3uChs) {
              if (!matchesChannel(ch.name, channel as HubChannel)) continue;
              if (!ch.url || candidateUrls.has(ch.url)) continue;
              candidateUrls.add(ch.url);
              candidates.push({ url: ch.url, streamName: ch.name, portalName: portal.name });
              send('candidate', { url: ch.url, streamName: ch.name, portalName: portal.name });
            }
          }
        })
      ));
    }

    if (cancelled) return res.end();

    if (candidates.length === 0) {
      const hint = portals.length === 0
        ? 'No portals found — click "Discover portals" to search for more.'
        : 'No matching streams found. Try discovering more portals.';
      send('done', { hits: 0, message: hint });
      return res.end();
    }

    // ── Phase 3: alive-check all candidates (24 concurrent) ───────────────────
    send('status', { message: `Checking ${candidates.length} stream(s)…` });
    let checked = 0;
    let hits = 0;
    const checkRun = semaphore(24);

    await Promise.all(candidates.map(c =>
      checkRun(async () => {
        if (cancelled) return;
        const alive = await checkUrl(c.url);
        checked++;
        send('progress', { checked, total: candidates.length });
        if (alive) {
          hits++;
          send('hit', { url: c.url, streamName: c.streamName, portalName: c.portalName });
          addUrls(channel.id, [{ url: c.url, source: 'xtream' }]);
        }
      })
    ));

    send('done', { hits });
  } catch (e: any) {
    send('error', { message: e?.message ?? 'Scan failed' });
  } finally {
    res.end();
  }
});

export default router;
