import { Router, Request, Response } from 'express';
import { getSharedBrowser, makeProxyContextOptions } from '../services/browser';

const router = Router();

const SPORTTSONLINE_BASE = 'https://ww2.sporttsonline.click/channels/hd';
// Windows UA — Linux + headless Chromium is a strong automation signal
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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
      ...makeProxyContextOptions(),
    });

    // Block the rotating daily anti-bot JS (lolo_YYYYMMDD_NN.js) before it runs.
    // The script detects Playwright via webdriver, chrome object, and timing heuristics.
    // Intercepting it at context level catches it even when loaded from iframes.
    await ctx.route('**/lolo_*.js', route => route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: '',
    }));

    // Also block common ad/fingerprinting networks that phone home with bot scores.
    await ctx.route(/\/(ads?|analytics|fingerprint|captcha|challenge|turnstile)\b/i,
      route => route.abort());

    const page = await ctx.newPage();

    // Stealth patches — run before any page script so the environment looks like
    // a real Windows Chrome browser.
    await page.addInitScript(`
      // 1. Remove webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // 2. chrome runtime (absent in headless)
      window.chrome = {
        runtime: { id: undefined, connect: () => {}, sendMessage: () => {} },
        loadTimes: () => ({}),
        csi: () => ({}),
        app: { isInstalled: false },
      };

      // 3. Plugins — empty length is a headless giveaway
      const _plugins = [
        { name: 'Chrome PDF Plugin',         filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer',          filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client',             filename: 'internal-nacl-plugin', description: '' },
      ];
      Object.defineProperty(navigator, 'plugins', {
        get: () => Object.assign(_plugins, { item: (i) => _plugins[i] ?? null, namedItem: (n) => _plugins.find(p => p.name === n) ?? null, refresh: () => {} }),
      });
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => Object.assign([], { item: () => null, namedItem: () => null }),
      });

      // 4. Language / platform
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'platform',  { get: () => 'Win32' });

      // 5. Hardware concurrency (headless often reports 2)
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

      // 6. Permissions — headless lacks notification permission context
      const _origPermQuery = navigator.permissions?.query?.bind(navigator.permissions);
      if (_origPermQuery) {
        navigator.permissions.query = (params) =>
          params.name === 'notifications'
            ? Promise.resolve(Object.assign(Object.create(PermissionStatus.prototype), { state: 'default', onchange: null }))
            : _origPermQuery(params);
      }

      // 7. Visibility — streams may not start in a 'hidden' tab
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
      Object.defineProperty(document, 'hidden',          { get: () => false });

      // 8. Window size — headless defaults to 800×600
      Object.defineProperty(window, 'outerWidth',  { get: () => 1280 });
      Object.defineProperty(window, 'outerHeight', { get: () => 720 });

      // 9. Battery — absence triggers detection in some scripts
      navigator.getBattery = () => Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1, addEventListener: () => {}, removeEventListener: () => {} });

      // 10. Devtools detector suppression
      Object.defineProperty(window, 'devtoolsDetector', { get: () => undefined, set: () => {} });
    `);

    const pageUrl = `${SPORTTSONLINE_BASE}/${channelId}.php`;
    const result = await new Promise<{ m3u8Url: string; referer: string } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 35_000);
      let dyngutterReferer = '';

      ctx!.on('request', (req: import('playwright').Request) => {
        const url = req.url();

        // Capture dyngutter subdomain for Referer header on manifest/segment requests
        if (!dyngutterReferer && url.includes('.dyngutter.net')) {
          try { dyngutterReferer = new URL(url).origin + '/'; } catch { /* ignore */ }
        }

        // Match any m3u8 from 15072669.net or other streaming CDNs that aren't the site itself
        if (url.includes('.m3u8') && !url.includes('sporttsonline')) {
          clearTimeout(timer);
          // Fall back to the page URL as referer if dyngutter subdomain wasn't seen yet
          resolve({ m3u8Url: url, referer: dyngutterReferer || pageUrl });
        }
      });

      page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 25_000,
      }).then(async () => {
        // Simulate user click to unblock autoplay-gated stream players
        await page.mouse.click(300, 300).catch(() => {});
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
    console.warn(`[bintv] ${channelId}: no referer captured, proceeding without`);
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
