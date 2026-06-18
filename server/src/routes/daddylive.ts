import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import { Request as PwRequest } from 'playwright';
import { rewriteM3U8 } from './stream';
import {
  getCachedSignedUrl, setCachedSignedUrl, evictSignedUrl,
  fetchSignedUrl, EMBED_HOST, CDN_HOST, EMBED_UA as UA,
} from '../services/daddyliveSignedUrl';
import { getSharedBrowser, makeProxyContextOptions } from '../services/browser';

const router = Router();

async function _playwrightPath(id: number): Promise<string | null> {
  console.log(`[daddylive] ${id}: falling back to Playwright`);
  let ctx;
  try {
    const browser = await getSharedBrowser();
    ctx = await browser.newContext({
      ...makeProxyContextOptions(),
      extraHTTPHeaders: {
        'Referer': `https://dlhd.pk/stream/stream-${id}.php`,
        'Origin':  'https://dlhd.pk',
      },
    });
    const page = await ctx.newPage();

    // Block ads/trackers so the page loads faster
    await page.route('**/*', route => {
      const url = route.request().url();
      if (
        url.includes('histats') || url.includes('effectivecpm') ||
        url.includes('doubleclick') || url.includes('googlesyndication') ||
        url.includes('adservice') || url.includes('llvpn.com') ||
        url.includes('waust.at')
      ) return route.abort();
      return route.continue();
    });

    // Intercept the first m3u8 CDN request — this is the signed URL we need
    const signedUrl = await new Promise<string | null>(async (resolve) => {
      const timer = setTimeout(() => resolve(null), 12_000);

      page.on('request', (browserReq: PwRequest) => {
        const url = browserReq.url();
        if (url.includes(CDN_HOST) && url.includes('.m3u8') && url.includes('md5')) {
          clearTimeout(timer);
          resolve(url);
        }
      });

      try {
        await page.goto(`${EMBED_HOST}/premiumtv/daddy4.php?id=${id}`, {
          waitUntil: 'domcontentloaded',
          timeout: 12_000,
        });
      } catch {
        // Page may time out but we might still capture the request
      }
    });

    return signedUrl;
  } catch (e) {
    console.warn(`[daddylive] Playwright error for ${id}:`, (e as Error).message);
    return null;
  } finally {
    await ctx?.close().catch(() => {});
  }
}

// ── Main: try fast path, fall back to Playwright ──────────────────────────────

async function getSignedUrl(id: number): Promise<string | null> {
  const cached = getCachedSignedUrl(id);
  if (cached) return cached;

  // Layer 1: fast HTML extraction (shared service)
  let url = await fetchSignedUrl(id);
  let layer = 'fast';

  if (!url) {
    // Layer 2: real browser network interception
    url   = await _playwrightPath(id);
    layer = 'browser';
  }

  if (url) {
    setCachedSignedUrl(id, url);
    console.log(`[daddylive] ${id}: signed URL cached via ${layer} path`);
  } else {
    console.warn(`[daddylive] ${id}: could not obtain signed URL`);
  }

  return url;
}

// ── Helper: extract sub-manifest URL from master playlist ────────────────────

async function _getSubManifestUrl(signedMasterUrl: string): Promise<string | null> {
  try {
    const r = await fetch(signedMasterUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const text = await r.text();
    const rel  = text.split('\n').find(l => l.trim() && !l.startsWith('#'));
    if (!rel) return null;
    return new URL(rel.trim(), signedMasterUrl).toString();
  } catch {
    return null;
  }
}

// ── Route: GET /api/daddylive/:id/ts ─────────────────────────────────────────
// Server-side HEVC→H.264 transcoding via ffmpeg (ultrafast preset).
// Used as automatic fallback when the browser can't decode the native codec.
// ffmpeg reads the live HLS sub-manifest directly so no segment buffering occurs
// server-side — it just re-encodes and pipes the transport stream to the client.

router.get('/:id/ts', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'invalid channel id' });

  const signedUrl = await getSignedUrl(id);
  if (!signedUrl) return res.status(503).json({ error: 'could not obtain signed stream URL' });

  const subUrl = await _getSubManifestUrl(signedUrl);
  if (!subUrl) return res.status(503).json({ error: 'stream unavailable' });

  res.set('Content-Type', 'video/mp2t');
  res.set('Cache-Control', 'no-store');
  res.set('Access-Control-Allow-Origin', '*');

  const ff = spawn('ffmpeg', [
    '-loglevel', 'error',
    // Minimize HLS probe time so first frames arrive faster
    '-fflags', 'nobuffer+discardcorrupt',
    '-flags', 'low_delay',
    '-probesize', '500000',
    '-analyzeduration', '500000',
    // Input: live HLS with auth headers
    '-user_agent', UA,
    '-headers', `Referer: https://dlhd.pk/\r\nOrigin: https://dlhd.pk\r\n`,
    '-live_start_index', '-3',   // start from 3 segments behind live edge
    '-i', subUrl,
    // Video: H.264 ultrafast — CPU stays low, latency stays under 2 s
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-x264-params', 'keyint=60:min-keyint=60:scenecut=0',
    '-b:v', '2500k', '-maxrate', '3000k', '-bufsize', '1000k',
    // Audio: AAC stereo 128kbps
    '-c:a', 'aac', '-ac', '2', '-ar', '44100', '-b:a', '128k',
    // Output: MPEG-TS, no re-mux buffering
    '-f', 'mpegts',
    '-flush_packets', '1',
    'pipe:1',
  ]);

  console.log(`[daddylive/ts] ${id}: ffmpeg started`);
  ff.stdout.pipe(res, { end: true });
  ff.stderr.on('data', (d: Buffer) => process.stderr.write(`[daddylive/ts] ${id}: ${d}`));

  const kill = () => { if (!ff.killed) ff.kill('SIGTERM'); };
  req.on('close', kill);
  res.on('close', kill);
  ff.on('exit', (code: number | null) => {
    console.log(`[daddylive/ts] ${id}: ffmpeg exited (${code})`);
    if (!res.writableEnded) res.end();
  });
});

// ── Route handler ─────────────────────────────────────────────────────────────
// GET /api/daddylive/:id
// Returns a signed HLS master playlist with sub-manifest URLs rewritten through
// /api/stream?url=… so the stream proxy handles segments with valid CDN tokens.

router.get('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'invalid channel id' });

  let signedUrl = await getSignedUrl(id);
  if (!signedUrl) return res.status(503).json({ error: 'could not obtain signed stream URL' });

  // Fetch the master playlist
  let playlistText: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(signedUrl, {
        headers: { 'User-Agent': UA },
        signal:  AbortSignal.timeout(10_000),
      });

      if (r.ok) {
        playlistText = await r.text();
        break;
      }

      // Signed URL expired — bust cache and re-fetch
      evictSignedUrl(id);
      signedUrl = await getSignedUrl(id);
      if (!signedUrl) break;
    } catch {
      break;
    }
  }

  if (!playlistText) return res.status(503).json({ error: 'stream unavailable' });

  // Strip CODECS attribute so HLS.js skips the isTypeSupported() pre-check.
  // Without it, HLS.js rejects HEVC streams before requesting a single segment,
  // even on browsers that can decode HEVC via hardware. The player will still
  // fail gracefully if the browser truly can't decode the codec.
  const strippedPlaylist = playlistText.replace(/,?CODECS="[^"]*"/g, '');

  res.set('Content-Type', 'application/vnd.apple.mpegurl');
  res.set('Cache-Control', 'no-store');
  return res.send(rewriteM3U8(strippedPlaylist, signedUrl!, signedUrl!));
});

export default router;
