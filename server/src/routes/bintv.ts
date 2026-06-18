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

// ── Stage 2: Playwright ───────────────────────────────────────────────────────
// dyngutter embeds a Clappr + SwarmCloud P2P player.  SwarmCloud uses blob: web
// workers for TS segment fetching, but the initial m3u8 manifest fetch IS a
// regular XHR/fetch visible to Playwright's ctx.on('request').
// Strategy:
//  1. Block main-frame ad navigations so stray clicks can't hijack the page
//  2. Patch fetch/XHR/Worker.postMessage in the init script as a secondary net
//  3. Click the player gate then wait up to 25s for the manifest to appear
// ─────────────────────────────────────────────────────────────────────────────

const _INIT_SCRIPT = `
(function(){
  // ── Stealth ─────────────────────────────────────────────────────────────────
  window.chrome = { runtime:{id:undefined,connect:()=>{},sendMessage:()=>{}}, loadTimes:()=>({}), csi:()=>({}), app:{isInstalled:false} };
  var _pl=[{name:'Chrome PDF Plugin',filename:'internal-pdf-viewer',description:'Portable Document Format'},{name:'Chrome PDF Viewer',filename:'mhjfbmdgcfjbbpaeojofohoefgiehjai',description:''},{name:'Native Client',filename:'internal-nacl-plugin',description:''}];
  Object.defineProperty(navigator,'plugins',{get:function(){return Object.assign(_pl,{item:function(i){return _pl[i]||null},namedItem:function(n){return _pl.find(function(p){return p.name===n})||null},refresh:function(){}});}});
  Object.defineProperty(navigator,'languages',{get:function(){return['en-US','en']}});
  Object.defineProperty(navigator,'platform',{get:function(){return'Win32'}});
  Object.defineProperty(navigator,'hardwareConcurrency',{get:function(){return 8}});
  try{var _b=[{brand:'Google Chrome',version:'124'},{brand:'Chromium',version:'124'},{brand:'Not-A.Brand',version:'99'}];Object.defineProperty(navigator,'userAgentData',{get:function(){return{brands:_b,mobile:false,platform:'Windows',getHighEntropyValues:function(){return Promise.resolve({brands:_b,mobile:false,platform:'Windows',platformVersion:'10.0.0',architecture:'x86',bitness:'64',model:'',uaFullVersion:'124.0.0.0'})},toJSON:function(){return{brands:_b,mobile:false,platform:'Windows'}}}},configurable:true});}catch(_){}
  var _oq=navigator.permissions&&navigator.permissions.query&&navigator.permissions.query.bind(navigator.permissions);
  if(_oq)navigator.permissions.query=function(p){return p.name==='notifications'?Promise.resolve(Object.assign(Object.create(PermissionStatus.prototype),{state:'default',onchange:null})):_oq(p);};
  Object.defineProperty(document,'visibilityState',{get:function(){return'visible'}});
  Object.defineProperty(document,'hidden',{get:function(){return false}});
  Object.defineProperty(window,'outerWidth',{get:function(){return 1280}});
  Object.defineProperty(window,'outerHeight',{get:function(){return 720}});
  navigator.getBattery=function(){return Promise.resolve({charging:true,chargingTime:0,dischargingTime:Infinity,level:1,addEventListener:function(){},removeEventListener:function(){}})};
  Object.defineProperty(window,'devtoolsDetector',{get:function(){return undefined},set:function(){}});

  // ── m3u8 interception ───────────────────────────────────────────────────────
  // SwarmCloud P2P routes HLS fetches through blob: web workers.
  // We intercept at three levels: Worker.postMessage (primary, catches the URL
  // as it's handed to the worker), fetch/XHR (fallback if player uses direct
  // HTTP instead of P2P), and URL.createObjectURL (reads blob worker source).
  function _report(url) {
    if (!url || typeof url !== 'string' || url.indexOf('.m3u8') === -1) return;
    try { if (typeof window.__reportM3u8 === 'function') window.__reportM3u8(url); } catch(_) {}
  }
  // Extract the first http(s)://...m3u8 URL from an arbitrary string without regex
  // (avoids backslash escaping headaches inside a template-literal JS string).
  function _findM3u8(str) {
    if (!str) return null;
    var idx = str.indexOf('.m3u8');
    if (idx < 0) return null;
    var start = str.lastIndexOf('http', idx);
    if (start < 0 || idx - start > 400) return null;
    var end = idx + 5; // step past '.m3u8'
    while (end < str.length) {
      var c = str[end];
      if (c === '"' || c === "'" || c === ' ' || c === ',' || c === '\t' || c === '\n' || c === '\r' || c === '{' || c === '}' || c === '[' || c === ']') break;
      end++;
    }
    return str.slice(start, end);
  }

  // fetch
  var _oFetch = window.fetch;
  window.fetch = function(input, init) {
    try { _report(typeof input==='string'?input:(input&&input.url)); } catch(_) {}
    return _oFetch.call(this, input, init);
  };

  // XMLHttpRequest
  var _oXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function() {
    try { _report(arguments[1]); } catch(_) {}
    return _oXHROpen.apply(this, arguments);
  };

  // Worker — intercepts postMessage so we catch m3u8 URLs sent to blob workers
  var _OWorker = window.Worker;
  if (_OWorker) {
    window.Worker = function(url, opts) {
      var w = new _OWorker(url, opts);
      var _oPM = w.postMessage.bind(w);
      w.postMessage = function(data, transfer) {
        try {
          var str = typeof data === 'string' ? data : JSON.stringify(data);
          var found = _findM3u8(str);
          if (found) _report(found);
        } catch(_) {}
        return _oPM(data, transfer);
      };
      return w;
    };
    try { Object.setPrototypeOf(window.Worker, _OWorker); window.Worker.prototype = _OWorker.prototype; } catch(_) {}
  }

  // URL.createObjectURL — read blob worker script content for embedded m3u8 strings
  var _oCOBU = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function(obj) {
    var result = _oCOBU(obj);
    try {
      if (obj && typeof obj.text === 'function') {
        obj.text().then(function(txt) { var u = _findM3u8(txt); if (u) _report(u); }).catch(function(){});
      }
    } catch(_) {}
    return result;
  };
})();
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
  let ctx: import('playwright').BrowserContext | undefined;
  const pageUrl = `${SPORTTSONLINE_BASE}/${channelId}.php`;
  let dyngutterReferer = '';

  try {
    const browser = await getSharedBrowser();
    ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      // ⚠️ NO extraHTTPHeaders — dyngutter.net checks Referer == *.sporttsonline.click
      ...makeProxyContextOptions(),
    });

    // ── m3u8 promise resolved by either the JS intercept callback or network ──
    let _resolveM3u8!: (url: string) => void;
    const m3u8Promise = new Promise<string>(resolve => { _resolveM3u8 = resolve; });

    // exposeFunction registers __reportM3u8 on window in every frame of this context.
    // Our _INIT_SCRIPT calls it whenever fetch/XHR/Worker.postMessage/createObjectURL
    // detects a URL ending in .m3u8.
    await ctx.exposeFunction('__reportM3u8', (url: string) => {
      if (url?.includes('.m3u8')) {
        console.log(`[bintv] ${channelId}: m3u8 via JS intercept → ${url.slice(0, 100)}`);
        _resolveM3u8(url);
      }
    });

    await ctx.addInitScript(_INIT_SCRIPT);

    ctx.on('request', (req: import('playwright').Request) => {
      const url = req.url();
      if (!dyngutterReferer && url.includes('.dyngutter.net')) {
        try { dyngutterReferer = new URL(url).origin + '/'; } catch { /* ignore */ }
      }
      if (url.includes('.m3u8') && !url.includes('sporttsonline')) {
        console.log(`[bintv] ${channelId}: m3u8 via network → ${url.slice(0, 100)}`);
        _resolveM3u8(url);
      }
    });

    const page = await ctx.newPage();

    // Close any popup that ad scripts open via window.open().  We register this
    // AFTER ctx.newPage() so it doesn't fire on our own main page.
    ctx.on('page', async (popup: import('playwright').Page) => {
      if (popup !== page) {
        console.log(`[bintv] closing ad popup: ${popup.url().slice(0, 60)}`);
        await popup.close().catch(() => {});
      }
    });

    // Block main-frame navigations to ad sites so that a stray click on an ad overlay
    // can't send the page to DuckDuckGo/AliExpress and kill the player context.
    // Only main-frame document requests are filtered; iframe navigations are left alone
    // (dyngutter.net iframe must load freely).
    await page.route('**', async (route) => {
      const req = route.request();
      const isMainFrameNav = req.resourceType() === 'document'
                          && req.isNavigationRequest()
                          && req.frame() === page.mainFrame();
      if (isMainFrameNav) {
        const url = req.url();
        const ok = url.includes('sporttsonline.click') || url.startsWith('about:') || url.startsWith('data:');
        if (!ok) {
          console.log(`[bintv] blocked ad nav → ${url.slice(0, 80)}`);
          return route.abort('aborted');
        }
      }
      return route.continue();
    });

    console.log(`[bintv] ${channelId}: navigating…`);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      .catch((e: Error) => console.warn(`[bintv] goto: ${e.message}`));

    // Click 1 at (300, 300) — safe area that triggers the player-gate overlay without
    // landing on an ad overlay at page center.  SwarmCloud fetches the m3u8 manifest
    // via HTTP (visible to Playwright) before routing segments to web workers.
    console.log(`[bintv] ${channelId}: click 1`);
    await page.mouse.click(300, 300).catch(() => {});

    // Give the player 10s to init; if we don't have the URL yet, do a second click
    // at (640, 360) to trigger play — mirroring the debug endpoint sequence that works.
    const m3u8 = await Promise.race([
      m3u8Promise,
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('first-wait')), 12_000)),
    ]).catch(async () => {
      console.log(`[bintv] ${channelId}: click 2 (play)`);
      await page.mouse.click(640, 360).catch(() => {});
      return Promise.race([
        m3u8Promise,
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 13_000)),
      ]).catch(() => '');
    });

    if (!m3u8) {
      // Last resort: read from player JS context (in case Worker intercept missed it)
      const fromPlayer = await _extractFromPlayerContext(page);
      if (fromPlayer) {
        console.log(`[bintv] ${channelId}: extracted from player JS → ${fromPlayer.slice(0, 100)}`);
        return { m3u8Url: fromPlayer, referer: dyngutterReferer || pageUrl };
      }
      console.warn(`[bintv] ${channelId}: all extraction methods failed`);
      return null;
    }

    return { m3u8Url: m3u8, referer: dyngutterReferer || pageUrl };
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
