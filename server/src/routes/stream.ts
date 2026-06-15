import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import { promises as dns } from 'dns';

const PRIVATE_IP = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|::1|fc|fd)/i;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Per-host cookie jar: some IPTV servers issue session cookies on the M3U8 response
// that are required for subsequent segment requests (HLSR tokenized segments).
const cookieJar = new Map<string, string>();

function getCookies(hostname: string): string {
  return cookieJar.get(hostname) ?? '';
}

function storeCookies(hostname: string, setCookieHeader: string | null): void {
  if (!setCookieHeader) return;
  const incoming = setCookieHeader
    .split(/,(?=[^;]+=[^;])/) // split multiple cookies (crude but works for IPTV)
    .map(c => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
  const existing = cookieJar.get(hostname);
  cookieJar.set(hostname, existing ? `${existing}; ${incoming}` : incoming);
}

async function isPrivateUrl(url: string): Promise<boolean> {
  try {
    const { hostname } = new URL(url);
    if (PRIVATE_IP.test(hostname)) return true; // bare IP literal
    const { address } = await dns.lookup(hostname);
    return PRIVATE_IP.test(address);
  } catch {
    return true;
  }
}

function isPlaylist(url: string, contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return (
    url.includes('.m3u8') ||
    url.includes('.m3u') ||
    ct.includes('mpegurl') ||
    ct.includes('x-mpegurl')
  );
}

export function rewriteM3U8(text: string, baseUrl: string): string {
  const base = new URL(baseUrl);

  function proxy(uri: string): string {
    try {
      const absolute = new URL(uri, base).toString();
      return `/api/stream?url=${encodeURIComponent(absolute)}`;
    } catch {
      return uri;
    }
  }

  return text
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      // Non-comment lines are segment/playlist URIs
      if (!trimmed.startsWith('#')) return proxy(trimmed);
      // Rewrite URI="…" inside tags: EXT-X-MAP, EXT-X-KEY, EXT-X-MEDIA, etc.
      if (trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${proxy(uri)}"`);
      }
      return line;
    })
    .join('\n');
}

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const url = typeof req.query.url === 'string' ? req.query.url : undefined;
  if (!url) return res.status(400).json({ error: 'url query param required' });

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return res.status(400).json({ error: 'url must use http or https scheme' });
  }

  if (await isPrivateUrl(url)) {
    console.log(`[stream] SSRF blocked: ${url}`);
    return res.status(400).json({ error: 'requests to private addresses are not allowed' });
  }

  res.set('Access-Control-Allow-Origin', '*');

  // Abort upstream fetch if the client disconnects early
  const ac = new AbortController();
  res.on('close', () => ac.abort());

  try {
    const { hostname } = new URL(url);
    const reqHeaders: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      'Accept': '*/*',
    };
    const cookies = getCookies(hostname);
    if (cookies) reqHeaders['Cookie'] = cookies;
    if (req.headers['range']) reqHeaders['Range'] = req.headers['range'] as string;

    // Live TS streams are long-lived — don't apply a hard timeout, only disconnect-abort
    const isLiveTs = url.endsWith('.ts') && !url.includes('.m3u8');
    const signal = isLiveTs
      ? ac.signal
      : AbortSignal.any([ac.signal, AbortSignal.timeout(20_000)]);

    const upstream = await fetch(url, { headers: reqHeaders, signal });
    storeCookies(hostname, upstream.headers.get('set-cookie'));

    if (!upstream.ok) {
      console.log(`[stream] FAIL ${upstream.status} ${url}`);
      return res.status(upstream.status).json({ error: 'upstream returned error' });
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    console.log(`[stream] OK ct="${contentType}" url=${url}`);

    if (isPlaylist(url, contentType)) {
      const text = await upstream.text();
      console.log(`[stream] playlist (header) len=${text.length} starts="${text.trimStart().slice(0, 30)}"`);
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-cache');
      return res.send(rewriteM3U8(text, url));
    }

    // Xtream Codes and some providers return M3U8 with generic content-type or no extension.
    // Peek at the body to detect playlists the header check missed.
    const isLikelyText = !contentType || contentType.includes('octet-stream') || contentType.includes('text/');
    if (isLikelyText) {
      const text = await upstream.text();
      console.log(`[stream] peek len=${text.length} starts="${text.trimStart().slice(0, 30)}"`);
      if (text.trimStart().startsWith('#EXT')) {
        console.log(`[stream] playlist (peek)`);
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.set('Cache-Control', 'no-cache');
        return res.send(rewriteM3U8(text, url));
      }
      res.set('Content-Type', contentType || 'application/octet-stream');
      return res.send(Buffer.from(text, 'binary'));
    }

    console.log(`[stream] binary media ct="${contentType}"`);

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'no-cache, no-store');

    // Forward range-response headers so hls.js can seek correctly
    const contentRange  = upstream.headers.get('content-range');
    const contentLength = upstream.headers.get('content-length');
    if (contentRange)  res.set('Content-Range', contentRange);
    if (contentLength) res.set('Content-Length', contentLength);

    if (upstream.body) {
      const readable = Readable.fromWeb(upstream.body as any);
      readable.on('error', () => res.end());
      readable.pipe(res);
    } else {
      res.end();
    }
  } catch (err: any) {
    if (err.name === 'AbortError') return; // client already gone
    if (err.name === 'TimeoutError') return res.status(504).json({ error: 'upstream timeout' });
    return res.status(502).json({ error: 'proxy error' });
  }
});

export default router;
