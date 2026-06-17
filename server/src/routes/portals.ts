import { Router } from 'express';
import { loadPortals, savePortal, deletePortal } from '../services/portalStore';
import { verifyOrNull } from '../services/xtreamClient';
import { scrapeAndVerify, buildChannelsFromPortal } from '../services/xtreamVerifier';
import { triggerPortalScrape } from '../cache';
import type { ScrapeSource } from '../services/xtreamScraper';
import type { IptvPortal } from '../types';

const router = Router();

/** List all verified portals stored in the DB. */
router.get('/', (_req, res) => {
  const portals = loadPortals().map(p => ({
    id:               p.id,
    name:             p.name,
    url:              p.url,
    expiry:           p.expiry,
    maxConnections:   p.maxConnections,
    activeConnections: p.activeConnections,
    streamCount:      p.streamCount,
    source:           p.source,
    lastVerifiedAt:   p.lastVerifiedAt,
  }));
  res.json({ portals });
});

/** Add a manual portal (url + username + password). */
router.post('/', async (req, res) => {
  const { url, username, password } = req.body as Partial<IptvPortal>;
  if (!url || !username || !password) {
    return res.status(400).json({ error: 'url, username and password are required' });
  }
  const portal: IptvPortal = { url: url.trim(), username: username.trim(), password: password.trim(), source: 'Manual' };
  const verified = await verifyOrNull(portal);
  if (!verified) return res.status(422).json({ error: 'Portal authentication failed' });
  savePortal(verified);
  res.status(201).json({ portal: verified });
});

/** Delete a portal by id. */
router.delete('/:id', (req, res) => {
  deletePortal(req.params.id);
  res.json({ ok: true });
});

/**
 * SSE endpoint — streams real-time progress while scraping + verifying portals.
 * Query: ?source=best|fastest|works&target=5
 * Events: attempt, verified, progress, done, error
 */
router.get('/scrape/stream', async (req, res) => {
  const source = (['best', 'fastest', 'works', 'arabic'].includes(req.query.source as string)
    ? req.query.source : 'fastest') as ScrapeSource;
  const target = Math.min(parseInt(String(req.query.target ?? '25'), 10) || 25, 50);

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
    const portals = await scrapeAndVerify({
      source,
      target,
      isCancelled: () => cancelled,
      onAttempt:  (url)  => send('attempt',  { url }),
      onVerified: (p)    => {
        savePortal(p);
        // Kick off channel loading in background so they appear without waiting
        buildChannelsFromPortal(p).then(() => {}).catch(() => {});
        send('verified', { id: p.id, name: p.name, url: p.url, expiry: p.expiry, streamCount: p.streamCount });
      },
      onProgress: (checked, total, alive) => send('progress', { checked, total, alive }),
    });
    if (!cancelled) send('done', { count: portals.length });
  } catch (e: any) {
    send('error', { message: e?.message ?? 'Unknown error' });
  } finally {
    res.end();
  }
});

/**
 * Trigger a background scrape without SSE (fire-and-forget).
 * Useful for automated re-population.
 */
router.post('/scrape', (req, res) => {
  const source = (['best', 'fastest', 'works', 'arabic'].includes(req.body?.source)
    ? req.body.source : 'fastest') as ScrapeSource;
  const target = Math.min(parseInt(String(req.body?.target ?? '25'), 10) || 25, 50);
  triggerPortalScrape(source, target).catch(console.error);
  res.json({ ok: true, message: 'Scrape started in background' });
});

export default router;
