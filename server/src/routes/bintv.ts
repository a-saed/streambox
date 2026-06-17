import { Router, Request, Response } from 'express';
import { getSharedBrowser } from '../services/browser';

const router = Router();

const SPORTTSONLINE_BASE = 'https://ww2.sporttsonline.click/channels/hd';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Signed m3u8 URLs from 15072669.net expire in ~5-6h; cache for 4h
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

interface StreamEntry { m3u8Url: string; referer: string; fetchedAt: number; }
const _cache = new Map<string, StreamEntry>();

// Extract dyngutter iframe URL from sporttsonline HTML (plain fetch, no JS needed)
async function _getDyngutterReferer(channelId: string): Promise<string | null> {
  try {
    const r = await fetch(`${SPORTTSONLINE_BASE}/${channelId}.php`, {
      headers: { 'User-Agent': UA, 'Referer': 'https://prabashsapkota.github.io/' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/src="(https?:\/\/[a-f0-9]+\.dyngutter\.net\/e\/[a-z0-9]+)"/);
    return m ? new URL(m[1]).origin + '/' : null;
  } catch {
    return null;
  }
}

// Navigate to sporttsonline via Playwright; intercept m3u8 at context level so
// dyngutter iframe requests are included (direct dyngutter navigation gets blocked)
async function _interceptHLS(channelId: string, referer: string): Promise<string | null> {
  let ctx;
  try {
    const browser = await getSharedBrowser();
    ctx = await browser.newContext({
      userAgent: UA,
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();

    const result = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 30_000);
      ctx!.on('request', (req: import('playwright').Request) => {
        const url = req.url();
        if (url.includes('15072669.net') && url.includes('.m3u8')) {
          clearTimeout(timer);
          resolve(url);
        }
      });
      page.goto(`${SPORTTSONLINE_BASE}/${channelId}.php`, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
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

  // Fetch dyngutter origin for Referer header (plain HTTP, fast)
  const referer = await _getDyngutterReferer(channelId);
  if (!referer) {
    console.warn(`[bintv] ${channelId}: no dyngutter iframe found`);
    return null;
  }
  console.log(`[bintv] ${channelId}: referer = ${referer}`);

  // Launch browser, navigate sporttsonline, intercept m3u8
  const m3u8Url = await _interceptHLS(channelId, referer);
  if (!m3u8Url) {
    console.warn(`[bintv] ${channelId}: HLS intercept failed`);
    return null;
  }

  const entry: StreamEntry = { m3u8Url, referer, fetchedAt: Date.now() };
  _cache.set(channelId, entry);
  console.log(`[bintv] ${channelId}: stream cached ${m3u8Url.slice(0, 80)}`);
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

  // Fetch the manifest (retry once on 403 — URL may have expired)
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
        // Signed URL expired — evict and re-extract
        _cache.delete(channelId);
        entry = await _getStream(channelId);
        if (!entry) break;
      } else { break; }
    } catch { break; }
  }

  if (!text || !entry) return res.status(503).json({ error: 'manifest unavailable' });

  // Resolve relative segment paths and rewrite through our proxy
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
