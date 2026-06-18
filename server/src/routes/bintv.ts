import { Router, Request, Response } from 'express';
import { getSharedBrowser } from '../services/browser';

const router = Router();

const SPORTTSONLINE_BASE = 'https://ww2.sporttsonline.click/channels/hd';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Signed m3u8 URLs from 15072669.net expire in ~5-6h; cache for 4h
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

interface StreamEntry { m3u8Url: string; referer: string; fetchedAt: number; }
const _cache = new Map<string, StreamEntry>();

// Navigate sporttsonline via Playwright and intercept:
//   1. The first request to *.dyngutter.net → dyngutter Referer header
//   2. The HLS m3u8 URL from 15072669.net
// Context-level interception catches cross-origin iframe requests.
// We no longer gate on a plain-fetch pre-check because fly.io IPs may be
// blocked by sporttsonline, causing an immediate null return before Playwright
// even gets a chance.
async function _interceptHLS(channelId: string): Promise<{ m3u8Url: string; referer: string } | null> {
  let ctx;
  try {
    const browser = await getSharedBrowser();
    ctx = await browser.newContext({
      userAgent: UA,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        // sporttsonline expects to be embedded from prabashsapkota.github.io
        'Referer': 'https://prabashsapkota.github.io/',
      },
    });

    const page = await ctx.newPage();

    // Spoof visibility so auto-play streams start without a user gesture
    await page.addInitScript(() => {
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { get: () => false });
    });

    const result = await new Promise<{ m3u8Url: string; referer: string } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 35_000);
      let dyngutterReferer = '';

      ctx!.on('request', (req: import('playwright').Request) => {
        const url = req.url();

        // Capture dyngutter subdomain for Referer header on manifest/segment requests
        if (!dyngutterReferer && url.includes('.dyngutter.net')) {
          try { dyngutterReferer = new URL(url).origin + '/'; } catch { /* ignore */ }
        }

        if (url.includes('15072669.net') && url.includes('.m3u8')) {
          clearTimeout(timer);
          resolve({ m3u8Url: url, referer: dyngutterReferer });
        }
      });

      page.goto(`${SPORTTSONLINE_BASE}/${channelId}.php`, {
        waitUntil: 'domcontentloaded',
        timeout: 25_000,
      }).catch(() => {});
    });

    return result;
  } catch (e) {
    console.warn('[bintv] Playwright error:', (e as Error).message);
    return null;
  } finally {
    await ctx?.close().catch(() => {});
  }
}

async function _getStream(channelId: string): Promise<StreamEntry | null> {
  const cached = _cache.get(channelId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  console.log(`[bintv] ${channelId}: intercepting HLS via Playwright…`);
  const hit = await _interceptHLS(channelId);

  if (!hit?.m3u8Url) {
    console.warn(`[bintv] ${channelId}: HLS intercept failed`);
    return null;
  }
  if (!hit.referer) {
    console.warn(`[bintv] ${channelId}: no dyngutter referer captured`);
    return null;
  }

  const entry: StreamEntry = { m3u8Url: hit.m3u8Url, referer: hit.referer, fetchedAt: Date.now() };
  _cache.set(channelId, entry);
  console.log(`[bintv] ${channelId}: cached ${hit.m3u8Url.slice(0, 80)}`);
  return entry;
}

// ── Proxy: fetch a segment/manifest with the dyngutter Referer ────────────────
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

    const buf = Buffer.from(await r.arrayBuffer());
    return res.send(buf);
  } catch {
    return res.status(503).end();
  }
});

// ── Main HLS manifest endpoint ────────────────────────────────────────────────
// GET /api/bintv/:channelId  (e.g. /api/bintv/hd11 for Arabic beIN World Cup)
router.get('/:channelId', async (req: Request, res: Response) => {
  const { channelId } = req.params;
  if (!/^hd\d+$/.test(channelId)) return res.status(400).json({ error: 'invalid id' });

  let entry = await _getStream(channelId);
  if (!entry) return res.status(503).json({ error: 'stream unavailable' });

  // Fetch the manifest (retry once on 403 — signed URL may have expired)
  let text: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(entry.m3u8Url, {
        headers: {
          'User-Agent': UA,
          'Referer': entry.referer,
          'Origin': new URL(entry.referer).origin,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) { text = await r.text(); break; }
      if (r.status === 403 || r.status === 401) {
        _cache.delete(channelId);
        entry = await _getStream(channelId);
        if (!entry) break;
      } else { break; }
    } catch { break; }
  }

  if (!text || !entry) return res.status(503).json({ error: 'manifest unavailable' });

  const liveEntry = entry;
  const baseUrl = new URL(liveEntry.m3u8Url);
  const baseDir = baseUrl.origin + baseUrl.pathname.replace(/\/[^/]*$/, '/');
  const ref = encodeURIComponent(liveEntry.referer);

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

export { _getStream as getBintvStream };
export default router;
