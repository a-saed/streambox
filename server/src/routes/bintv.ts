import { Router, Request, Response } from 'express';
import { getSharedBrowser, makeProxyContextOptions } from '../services/browser';

const router = Router();

const SPORTTSONLINE_BASE = 'https://ww2.sporttsonline.click/channels/hd';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Signed URLs from 15072669.net expire in ~5-6h; cache for 4h
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

interface StreamEntry { m3u8Url: string; referer: string; fetchedAt: number; }
const _cache = new Map<string, StreamEntry>();

// ── Stage 1: Pure HTTP parse ──────────────────────────────────────────────────
// Fetch the page without a browser.  If the site serves the player config in
// static HTML (common on simple PHP pages), we get the URL without executing
// any JavaScript and without touching any bot detection.
// ─────────────────────────────────────────────────────────────────────────────
const _NAV_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
  'Cache-Control': 'no-cache',
};

function _extractM3u8(html: string, baseReferer: string): { m3u8Url: string; referer: string } | null {
  const patterns: RegExp[] = [
    // bare .m3u8 URL in quotes
    /["'`](https?:\/\/[^"'`\s]+\.m3u8(?:\?[^"'`\s]*)?)["'`]/,
    // player config: file/source/src/url/stream/hls = "..."
    /(?:file|source|src|url|stream|hls)\s*[:=]\s*["'`](https?:\/\/[^"'`\s]+\.m3u8(?:\?[^"'`\s]*)?)["'`]/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && !m[1].includes('sporttsonline')) return { m3u8Url: m[1], referer: baseReferer };
  }
  return null;
}

async function _staticParse(channelId: string): Promise<{ m3u8Url: string; referer: string } | null> {
  const pageUrl = `${SPORTTSONLINE_BASE}/${channelId}.php`;
  try {
    const r = await fetch(pageUrl, {
      headers: { ..._NAV_HEADERS, 'Referer': 'https://prabashsapkota.github.io/' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const html = await r.text();

    // Direct hit in the main page HTML
    const direct = _extractM3u8(html, pageUrl);
    if (direct) return direct;

    // Follow iframe / embed src
    const iframeM = html.match(/<(?:iframe|embed)[^>]+(?:src|data-src)=["']([^'"]+)["']/i);
    if (!iframeM) return null;

    let iframeUrl = iframeM[1];
    if (iframeUrl.startsWith('//')) iframeUrl = 'https:' + iframeUrl;
    else if (iframeUrl.startsWith('/')) iframeUrl = new URL(iframeUrl, pageUrl).href;
    if (!iframeUrl.startsWith('http')) return null;

    const ir = await fetch(iframeUrl, {
      headers: { ..._NAV_HEADERS, 'Referer': pageUrl },
      signal: AbortSignal.timeout(10_000),
    });
    if (!ir.ok) return null;
    return _extractM3u8(await ir.text(), iframeUrl);
  } catch {
    return null;
  }
}

// ── Stage 2: Playwright HLS interception ──────────────────────────────────────
// Navigate the page inside a stealth-patched headless Chromium and intercept
// the first m3u8 request.  We do NOT block lolo.js — with
// --disable-blink-features=AutomationControlled in the browser launch args,
// navigator.webdriver is false at the C++ level and lolo.js sees a real browser,
// passes its check, and triggers the player normally.
// ─────────────────────────────────────────────────────────────────────────────
async function _interceptHLS(channelId: string): Promise<{ m3u8Url: string; referer: string } | null> {
  let ctx;
  const pageUrl = `${SPORTTSONLINE_BASE}/${channelId}.php`;
  try {
    const browser = await getSharedBrowser();
    ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      // ⚠️  Do NOT set extraHTTPHeaders with a hardcoded Referer here.
      // Playwright applies extraHTTPHeaders to EVERY request in the context,
      // including iframe navigation requests.  The dyngutter.net player iframe
      // is domain-protected: it checks that the HTTP Referer comes from
      // *.sporttsonline.click.  When we override Referer globally it sends
      // prabashsapkota.github.io instead and dyngutter returns "Not allowed".
      // Without extraHTTPHeaders the browser sets Referer automatically to the
      // parent page (sporttsonline.click), which passes dyngutter's check.
      ...makeProxyContextOptions(),
    });

    // Block ad / fingerprinting endpoints that could phone home with bot scores
    await ctx.route(/\/(ads?|analytics|fingerprint|captcha|challenge|turnstile)\b/i,
      route => route.abort());

    const page = await ctx.newPage();

    // Stealth patches — browser.ts already adds --disable-blink-features=AutomationControlled
    // which handles navigator.webdriver at the C++ level.  These patches cover the
    // remaining JS-accessible properties that headless Chrome exposes differently.
    await ctx.addInitScript(`
      // chrome runtime (absent in headless)
      window.chrome = {
        runtime: { id: undefined, connect: () => {}, sendMessage: () => {} },
        loadTimes: () => ({}), csi: () => ({}), app: { isInstalled: false },
      };

      // Plugins — empty length is a headless giveaway
      const _pl = [
        { name: 'Chrome PDF Plugin',  filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer',  filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client',      filename: 'internal-nacl-plugin', description: '' },
      ];
      Object.defineProperty(navigator, 'plugins', {
        get: () => Object.assign(_pl, { item: (i) => _pl[i] ?? null, namedItem: (n) => _pl.find(p => p.name === n) ?? null, refresh: () => {} }),
      });

      Object.defineProperty(navigator, 'languages',          { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'platform',           { get: () => 'Win32' });
      Object.defineProperty(navigator, 'hardwareConcurrency',{ get: () => 8 });

      // Client Hints (navigator.userAgentData) — headless Chromium exposes
      // "HeadlessChrome" in the brands list, which third-party tracker scripts
      // (crwdcntrl, adexchangerapid) read and leak into their request URLs.
      // Although dyngutter's own check is Referer-based (not UA-data-based), we
      // spoof this defensively so fingerprinting scripts don't identify the bot.
      try {
        const _brands = [
          { brand: 'Google Chrome', version: '124' },
          { brand: 'Chromium',      version: '124' },
          { brand: 'Not-A.Brand',   version: '99'  },
        ];
        const _fullBrands = [
          { brand: 'Google Chrome', version: '124.0.0.0' },
          { brand: 'Chromium',      version: '124.0.0.0' },
          { brand: 'Not-A.Brand',   version: '99.0.0.0'  },
        ];
        Object.defineProperty(navigator, 'userAgentData', {
          get: () => ({
            brands: _brands, mobile: false, platform: 'Windows',
            getHighEntropyValues: () => Promise.resolve({
              brands: _brands, fullVersionList: _fullBrands,
              mobile: false, platform: 'Windows', platformVersion: '10.0.0',
              architecture: 'x86', bitness: '64', model: '', uaFullVersion: '124.0.0.0',
            }),
            toJSON: () => ({ brands: _brands, mobile: false, platform: 'Windows' }),
          }),
          configurable: true,
        });
      } catch (_) { /* property may already exist on some Chromium builds */ }

      // Permissions — headless lacks notification context
      const _oq = navigator.permissions?.query?.bind(navigator.permissions);
      if (_oq) {
        navigator.permissions.query = (p) =>
          p.name === 'notifications'
            ? Promise.resolve(Object.assign(Object.create(PermissionStatus.prototype), { state: 'default', onchange: null }))
            : _oq(p);
      }

      // Tab visibility — player may refuse to start in a hidden tab
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
      Object.defineProperty(document, 'hidden',          { get: () => false });

      Object.defineProperty(window, 'outerWidth',  { get: () => 1280 });
      Object.defineProperty(window, 'outerHeight', { get: () => 720 });

      navigator.getBattery = () => Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1, addEventListener: () => {}, removeEventListener: () => {} });

      Object.defineProperty(window, 'devtoolsDetector', { get: () => undefined, set: () => {} });
    `);

    const result = await new Promise<{ m3u8Url: string; referer: string } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 35_000);
      let dyngutterReferer = '';

      ctx!.on('request', (req: import('playwright').Request) => {
        const url = req.url();
        if (!dyngutterReferer && url.includes('.dyngutter.net')) {
          try { dyngutterReferer = new URL(url).origin + '/'; } catch { /* ignore */ }
        }
        // Match any m3u8 that isn't from sporttsonline itself
        if (url.includes('.m3u8') && !url.includes('sporttsonline')) {
          clearTimeout(timer);
          resolve({ m3u8Url: url, referer: dyngutterReferer || pageUrl });
        }
      });

      page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 })
        .then(async () => { await page.mouse.click(300, 300).catch(() => {}); })
        .catch(() => {});
    });

    return result;
  } catch (e) {
    console.warn('[bintv] Playwright error:', (e as Error).message);
    return null;
  } finally {
    await ctx?.close().catch(() => {});
  }
}

// ── Stream resolver (static → Playwright) ────────────────────────────────────
async function _getStream(channelId: string): Promise<StreamEntry | null> {
  const cached = _cache.get(channelId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  // Fast path: try without a browser first
  const staticHit = await _staticParse(channelId);
  if (staticHit) {
    const entry: StreamEntry = { ...staticHit, fetchedAt: Date.now() };
    _cache.set(channelId, entry);
    console.log(`[bintv] ${channelId}: static parse → ${staticHit.m3u8Url.slice(0, 80)}`);
    return entry;
  }

  // Fallback: Playwright interception
  console.log(`[bintv] ${channelId}: Playwright interception…`);
  const hit = await _interceptHLS(channelId);
  if (!hit?.m3u8Url) {
    console.warn(`[bintv] ${channelId}: HLS intercept failed`);
    return null;
  }

  const entry: StreamEntry = { m3u8Url: hit.m3u8Url, referer: hit.referer, fetchedAt: Date.now() };
  _cache.set(channelId, entry);
  console.log(`[bintv] ${channelId}: Playwright → ${hit.m3u8Url.slice(0, 80)}`);
  return entry;
}

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
// GET /api/bintv/:channelId  e.g. /api/bintv/hd11
router.get('/:channelId', async (req: Request, res: Response) => {
  const { channelId } = req.params;
  if (!/^hd\d+$/.test(channelId)) return res.status(400).json({ error: 'invalid id' });

  let entry = await _getStream(channelId);
  if (!entry) return res.status(503).json({ error: 'stream unavailable' });

  // Fetch manifest; retry once if signed URL has expired (403/401)
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
        _cache.delete(channelId);
        entry = await _getStream(channelId);
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

export { _getStream as getBintvStream };
export default router;
