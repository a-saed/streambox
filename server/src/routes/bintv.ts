import { Router, Request, Response } from 'express';
import { getSharedBrowser, makeProxyContextOptions } from '../services/browser';
import { decodeBintvToken } from '../services/bintvSource';

const router = Router();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Signed m3u8 URLs expire (typically a few hours); cache resolutions for 4h.
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

interface StreamEntry { m3u8Url: string; referer: string; fetchedAt: number; }
const _cache = new Map<string, StreamEntry>();

// Minimal stealth: hide navigator.webdriver before page JS reads it.  The launch
// flags in browser.ts already strip it at the C++ level; this is belt-and-braces
// for the embed contexts.
const _STEALTH = `Object.defineProperty(navigator,'webdriver',{get:()=>undefined});window.chrome={runtime:{}};`;

// ── Embed resolver ────────────────────────────────────────────────────────────
// xyzstreams-style embeds run a Clappr player that fetches its real m3u8 from an
// `api/get-stream?channel=<slug>` endpoint (JSON `{ url }`), then loads it.  That
// endpoint is bot-gated, so we drive a real browser and intercept whichever comes
// first: the get-stream JSON `url`, or the first `.m3u8` network request.
async function _resolveEmbed(embedUrl: string): Promise<{ m3u8Url: string; referer: string } | null> {
  let ctx: import('playwright').BrowserContext | undefined;
  let origin = '';
  try {
    origin = new URL(embedUrl).origin;
    const browser = await getSharedBrowser();
    ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      ...makeProxyContextOptions(),
    });
    await ctx.addInitScript(_STEALTH);

    let _resolve!: (url: string) => void;
    const m3u8Promise = new Promise<string>(resolve => { _resolve = resolve; });

    ctx.on('response', async (res: import('playwright').Response) => {
      const url = res.url();
      if (!url.includes('get-stream')) return;
      if (!(res.headers()['content-type'] || '').includes('json')) return;
      try {
        const j = await res.json() as { url?: unknown };
        if (typeof j?.url === 'string' && j.url.includes('.m3u8')) {
          console.log(`[bintv] embed get-stream → ${j.url.slice(0, 100)}`);
          _resolve(j.url);
        }
      } catch { /* not the JSON we wanted */ }
    });

    ctx.on('request', (req: import('playwright').Request) => {
      const url = req.url();
      if (url.includes('.m3u8')) {
        console.log(`[bintv] embed m3u8 via network → ${url.slice(0, 100)}`);
        _resolve(url);
      }
    });

    const page = await ctx.newPage();

    // Close ad popups the embed opens via window.open().
    ctx.on('page', async (popup: import('playwright').Page) => {
      if (popup !== page) await popup.close().catch(() => {});
    });

    // Block main-frame navigations away from the embed origin so a stray ad click
    // can't kill the player context.  Iframe/sub-resource requests pass through.
    await page.route('**', async (route) => {
      const req = route.request();
      const isMainFrameNav = req.resourceType() === 'document'
                          && req.isNavigationRequest()
                          && req.frame() === page.mainFrame();
      if (isMainFrameNav) {
        const url = req.url();
        const ok = url.startsWith(origin) || url.startsWith('about:') || url.startsWith('data:');
        if (!ok) {
          console.log(`[bintv] blocked ad nav → ${url.slice(0, 80)}`);
          return route.abort('aborted');
        }
      }
      return route.continue();
    });

    console.log(`[bintv] embed navigating → ${embedUrl}`);
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      .catch((e: Error) => console.warn(`[bintv] goto: ${e.message}`));

    // Click center to trigger autoplay-gated players.
    await page.mouse.click(640, 360).catch(() => {});

    const m3u8 = await Promise.race([
      m3u8Promise,
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 20_000)),
    ]).catch(() => '');

    if (!m3u8) {
      console.warn(`[bintv] embed resolve failed → ${embedUrl}`);
      return null;
    }
    return { m3u8Url: m3u8, referer: origin + '/' };
  } catch (e) {
    console.warn('[bintv] embed resolve error:', (e as Error).message);
    return null;
  } finally {
    await ctx?.close().catch(() => {});
  }
}

// ── Stream resolver: decode token → direct (instant) or embed (browser) ───────
async function _getStream(token: string): Promise<StreamEntry | null> {
  const cached = _cache.get(token);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const decoded = decodeBintvToken(token);
  if (!decoded) return null;

  if (decoded.kind === 'direct') {
    const entry: StreamEntry = {
      m3u8Url: decoded.url,
      referer: new URL(decoded.url).origin + '/',
      fetchedAt: Date.now(),
    };
    _cache.set(token, entry);
    return entry;
  }

  const hit = await _resolveEmbed(decoded.url);
  if (!hit?.m3u8Url) return null;
  const entry: StreamEntry = { ...hit, fetchedAt: Date.now() };
  _cache.set(token, entry);
  console.log(`[bintv] embed resolved → ${hit.m3u8Url.slice(0, 80)}`);
  return entry;
}

// ── Debug: resolve a token and report the result ─────────────────────────────
// GET /api/bintv/debug/:token
router.get('/debug/:token', async (req: Request, res: Response) => {
  const decoded = decodeBintvToken(req.params.token);
  if (!decoded) return res.status(400).json({ error: 'invalid token' });
  const entry = await _getStream(req.params.token);
  return res.json({ decoded, resolved: entry });
});

// ── Proxy: forward manifest/segment with correct Referer ──────────────────────
router.get('/proxy', async (req: Request, res: Response) => {
  const rawUrl = req.query.url as string;
  const rawRef = req.query.ref as string;
  if (!rawUrl) return res.status(400).end();

  try {
    const url = decodeURIComponent(rawUrl);
    const ref = rawRef ? decodeURIComponent(rawRef) : '';
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        ...(ref ? { 'Referer': ref, 'Origin': new URL(ref).origin } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return res.status(r.status).end();

    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const isTs = ct.includes('mp2t') || ct.includes('octet') || url.endsWith('.ts');
    res.set('Content-Type', isTs ? 'video/mp2t' : (ct || 'application/octet-stream'));
    res.set('Cache-Control', 'no-store');
    res.set('Access-Control-Allow-Origin', '*');
    return res.send(Buffer.from(await r.arrayBuffer()));
  } catch {
    return res.status(503).end();
  }
});

// ── Main manifest endpoint ────────────────────────────────────────────────────
// GET /api/bintv/:token  (token = <d|e>.<base64url(target)>, see bintvSource.ts)
router.get('/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!decodeBintvToken(token)) return res.status(400).json({ error: 'invalid id' });

  let entry = await _getStream(token);
  if (!entry) return res.status(503).json({ error: 'stream unavailable' });

  // Fetch manifest; retry once if the signed URL has expired (403/401).
  let text: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(entry.m3u8Url, {
        headers: {
          'User-Agent': UA,
          'Referer': entry.referer,
          ...(entry.referer.startsWith('http') ? { 'Origin': new URL(entry.referer).origin } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) { text = await r.text(); break; }
      if (r.status === 403 || r.status === 401) {
        _cache.delete(token);
        entry = await _getStream(token);
        if (!entry) break;
      } else { break; }
    } catch { break; }
  }

  if (!text || !entry) return res.status(503).json({ error: 'manifest unavailable' });

  const liveEntry = entry;
  const baseUrl   = new URL(liveEntry.m3u8Url);
  const baseDir   = baseUrl.origin + baseUrl.pathname.replace(/\/[^/]*$/, '/');
  const ref       = encodeURIComponent(liveEntry.referer);

  const rewritten = text.replace(/^(?!#)(\S+)$/gm, (line) => {
    if (!line.trim()) return line;
    const absolute = line.startsWith('http') ? line : `${baseDir}${line}`;
    return `/api/bintv/proxy?url=${encodeURIComponent(absolute)}&ref=${ref}`;
  });

  res.set('Content-Type', 'application/vnd.apple.mpegurl');
  res.set('Cache-Control', 'no-store');
  res.set('Access-Control-Allow-Origin', '*');
  return res.send(rewritten);
});

export default router;
