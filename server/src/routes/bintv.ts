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

// ── Stage 2: Playwright — JS context extraction ───────────────────────────────
// The dyngutter player uses SwarmCloud P2P HLS which routes segment/manifest
// fetches through a web worker — those requests are invisible to Playwright's
// ctx.on('request').  Instead we:
//  1. Let the page load and trigger the player (click gate)
//  2. Wait for stream.js to decode _econfig and configure Clappr
//  3. Read the m3u8 URL directly from the Clappr player object in the iframe's
//     JS context — it must be in memory since the player is initialised with it
//  4. Also sniff any m3u8 that appears via HTTP (rare but covers edge cases)
// ─────────────────────────────────────────────────────────────────────────────

const _STEALTH_SCRIPT = `
  window.chrome = {
    runtime: { id: undefined, connect: () => {}, sendMessage: () => {} },
    loadTimes: () => ({}), csi: () => ({}), app: { isInstalled: false },
  };
  const _pl = [
    { name: 'Chrome PDF Plugin',  filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer',  filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    { name: 'Native Client',      filename: 'internal-nacl-plugin', description: '' },
  ];
  Object.defineProperty(navigator, 'plugins', {
    get: () => Object.assign(_pl, { item: (i) => _pl[i] ?? null, namedItem: (n) => _pl.find(p => p.name === n) ?? null, refresh: () => {} }),
  });
  Object.defineProperty(navigator, 'languages',           { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'platform',            { get: () => 'Win32' });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  try {
    const _b = [{ brand:'Google Chrome',version:'124'},{ brand:'Chromium',version:'124'},{ brand:'Not-A.Brand',version:'99'}];
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => ({ brands:_b, mobile:false, platform:'Windows',
        getHighEntropyValues: () => Promise.resolve({ brands:_b, mobile:false, platform:'Windows', platformVersion:'10.0.0', architecture:'x86', bitness:'64', model:'', uaFullVersion:'124.0.0.0' }),
        toJSON: () => ({ brands:_b, mobile:false, platform:'Windows' }) }),
      configurable: true,
    });
  } catch(_) {}
  const _oq = navigator.permissions?.query?.bind(navigator.permissions);
  if (_oq) navigator.permissions.query = (p) =>
    p.name==='notifications'
      ? Promise.resolve(Object.assign(Object.create(PermissionStatus.prototype),{state:'default',onchange:null}))
      : _oq(p);
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
  Object.defineProperty(document, 'hidden',          { get: () => false });
  Object.defineProperty(window,   'outerWidth',      { get: () => 1280 });
  Object.defineProperty(window,   'outerHeight',     { get: () => 720 });
  navigator.getBattery = () => Promise.resolve({ charging:true, chargingTime:0, dischargingTime:Infinity, level:1, addEventListener:()=>{}, removeEventListener:()=>{} });
  Object.defineProperty(window, 'devtoolsDetector', { get:()=>undefined, set:()=>{} });
`;

// Read m3u8 from the Clappr player object or <video> element inside the dyngutter iframe.
// SwarmCloud P2P uses web workers for fetching so the URL never appears in ctx.on('request'),
// but stream.js must configure Clappr with the raw URL before handing it to SwarmCloud.
async function _extractFromPlayerContext(page: import('playwright').Page): Promise<string | null> {
  for (const frame of page.frames()) {
    if (!frame.url().includes('dyngutter.net') && !frame.url().includes('sporttsonline')) continue;
    try {
      // Evaluated inside the browser frame — TypeScript can't resolve DOM globals here.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const url: string | null = await frame.evaluate(`(function(){
        var w = globalThis;
        var keys = ['player','Player','_player','clappr','_clappr'];
        for (var i = 0; i < keys.length; i++) {
          var p = w[keys[i]];
          if (!p) continue;
          var src = (p.options && (p.options.source || (p.options.sources && p.options.sources[0] && p.options.sources[0].src))) || (p._options && p._options.source);
          if (typeof src === 'string' && src.indexOf('.m3u8') !== -1) return src;
        }
        var v = document.querySelector('video');
        if (v && v.currentSrc && v.currentSrc.indexOf('.m3u8') !== -1) return v.currentSrc;
        if (v && v.src && v.src.indexOf('.m3u8') !== -1) return v.src;
        return null;
      })()`).catch(() => null) as string | null;
      if (url) return url;
    } catch { /* frame may not be accessible yet */ }
  }
  return null;
}

async function _interceptHLS(channelId: string): Promise<{ m3u8Url: string; referer: string } | null> {
  let ctx;
  const pageUrl = `${SPORTTSONLINE_BASE}/${channelId}.php`;
  let dyngutterReferer = '';
  let networkM3u8 = '';

  try {
    const browser = await getSharedBrowser();
    ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      // ⚠️ NO extraHTTPHeaders — Playwright applies them to ALL requests including
      // iframe navigations.  dyngutter.net domain-checks Referer and requires it
      // to be *.sporttsonline.click.  Without this override the browser sets it
      // correctly from the parent page navigation.
      ...makeProxyContextOptions(),
    });

    await ctx.addInitScript(_STEALTH_SCRIPT);

    // Sniff any m3u8 that appears via HTTP (covers cases where P2P is disabled/slow)
    ctx.on('request', (req: import('playwright').Request) => {
      const url = req.url();
      const type = req.resourceType();
      if (!['image', 'font', 'stylesheet', 'other'].includes(type)) {
        console.log(`[bintv:req] ${type.padEnd(10)} ${url.slice(0, 110)}`);
      }
      if (!dyngutterReferer && url.includes('.dyngutter.net')) {
        try { dyngutterReferer = new URL(url).origin + '/'; } catch { /* ignore */ }
      }
      if (url.includes('.m3u8') && !url.includes('sporttsonline')) {
        networkM3u8 = url;
        console.log(`[bintv] ${channelId}: m3u8 via network → ${url.slice(0, 100)}`);
      }
    });

    const page = await ctx.newPage();

    console.log(`[bintv] ${channelId}: navigating…`);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      .catch((e: Error) => console.warn(`[bintv] goto: ${e.message}`));

    // First click: triggers the ad-gated "click to show player" mechanism
    console.log(`[bintv] ${channelId}: click 1 (player gate)`);
    await page.mouse.click(640, 360).catch(() => {});

    // Wait for Clappr + stream.js to load and decode _econfig
    // stream.js appears ~3-4s after the click in the logs
    await page.waitForRequest(req => req.url().includes('clappr'), { timeout: 12_000 })
      .catch(() => {});
    await new Promise(r => setTimeout(r, 3_000));

    // If we already have it from network, use it
    if (networkM3u8) return { m3u8Url: networkM3u8, referer: dyngutterReferer || pageUrl };

    // Try to read from player JS context (primary path for SwarmCloud P2P sites)
    let m3u8 = await _extractFromPlayerContext(page);
    if (m3u8) {
      console.log(`[bintv] ${channelId}: extracted from player JS → ${m3u8.slice(0, 100)}`);
      return { m3u8Url: m3u8, referer: dyngutterReferer || pageUrl };
    }

    // Second click: in case player rendered a "click to play" button
    console.log(`[bintv] ${channelId}: click 2 (play button)`);
    await page.mouse.click(640, 360).catch(() => {});
    await new Promise(r => setTimeout(r, 4_000));

    if (networkM3u8) return { m3u8Url: networkM3u8, referer: dyngutterReferer || pageUrl };
    m3u8 = await _extractFromPlayerContext(page);
    if (m3u8) {
      console.log(`[bintv] ${channelId}: extracted from player JS (2nd) → ${m3u8.slice(0, 100)}`);
      return { m3u8Url: m3u8, referer: dyngutterReferer || pageUrl };
    }

    console.warn(`[bintv] ${channelId}: all extraction methods failed`);
    return null;
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

// ── Debug endpoint: run interception and return full request trace ────────────
// GET /api/bintv/debug/:channelId — returns JSON with every URL Playwright saw
router.get('/debug/:channelId', async (req: Request, res: Response) => {
  const { channelId } = req.params;
  if (!/^hd\d+$/.test(channelId)) return res.status(400).json({ error: 'invalid id' });

  const pageUrl = `${SPORTTSONLINE_BASE}/${channelId}.php`;
  const log: Array<{ type: string; url: string; status?: number; error?: string }> = [];
  let ctx2;

  try {
    const browser = await getSharedBrowser();
    ctx2 = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      ...makeProxyContextOptions(),
    });

    const page2 = await ctx2.newPage();
    await ctx2.addInitScript(`Object.defineProperty(navigator,'webdriver',{get:()=>undefined});window.chrome={runtime:{id:undefined,connect:()=>{},sendMessage:()=>{}}};`);

    const m3u8Found: string[] = [];

    ctx2.on('request', (r: import('playwright').Request) => {
      const url = r.url();
      log.push({ type: r.resourceType(), url });
      if (url.includes('.m3u8')) m3u8Found.push(url);
    });
    ctx2.on('requestfailed', (r: import('playwright').Request) => {
      log.push({ type: 'FAILED', url: r.url(), error: r.failure()?.errorText });
    });
    ctx2.on('response', (r: import('playwright').Response) => {
      if (r.status() >= 400) {
        const existing = log.find(l => l.url === r.url());
        if (existing) existing.status = r.status();
        else log.push({ type: 'error-resp', url: r.url(), status: r.status() });
      }
    });

    await page2.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => {});
    await page2.mouse.click(300, 300).catch(() => {});
    await new Promise(r => setTimeout(r, 12_000)); // wait 12s for player to init
    await page2.mouse.click(640, 360).catch(() => {});
    await new Promise(r => setTimeout(r, 5_000));

    return res.json({
      pageUrl,
      m3u8Found,
      totalRequests: log.length,
      requests: log.filter(l => !['image', 'font', 'stylesheet'].includes(l.type)),
    });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message, log });
  } finally {
    await ctx2?.close().catch(() => {});
  }
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
