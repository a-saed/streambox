import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import { promises as dns } from 'dns';
import http from 'node:http';
import https from 'node:https';
import { reportDeadUrl, reportUnreachable } from '../cache';

const PRIVATE_IP = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|::1|fc|fd)/i;

// Keep-alive agents — reuse TCP connections to the same IPTV server.
// This eliminates the TCP+TLS handshake on every HLS segment (biggest latency win).
const httpAgent  = new http.Agent({ keepAlive: true, maxSockets: 64, scheduling: 'lifo' });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, scheduling: 'lifo', rejectUnauthorized: false });

// DNS result cache — isPrivateUrl() was doing a fresh DNS lookup on every segment (every 2s).
// Cache results per hostname for 10 minutes.
const _dnsCache = new Map<string, { private: boolean; at: number }>();
const DNS_TTL   = 10 * 60 * 1000;

async function isPrivateUrl(url: string): Promise<boolean> {
  try {
    const { hostname } = new URL(url);
    if (PRIVATE_IP.test(hostname)) return true;
    const cached = _dnsCache.get(hostname);
    if (cached && Date.now() - cached.at < DNS_TTL) return cached.private;
    const { address } = await dns.lookup(hostname);
    const isPrivate = PRIVATE_IP.test(address);
    _dnsCache.set(hostname, { private: isPrivate, at: Date.now() });
    return isPrivate;
  } catch {
    return true;
  }
}

// Per-host cookie jar: some panels issue session cookies on the M3U8 that are
// required for subsequent HLSR segment requests.
const cookieJar = new Map<string, string>();

function getCookies(hostname: string): string { return cookieJar.get(hostname) ?? ''; }
function storeCookies(hostname: string, header: string | null): void {
  if (!header) return;
  const incoming = header.split(/,(?=[^;]+=[^;])/).map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
  const existing = cookieJar.get(hostname);
  cookieJar.set(hostname, existing ? `${existing}; ${incoming}` : incoming);
}

function isPlaylist(url: string, ct: string): boolean {
  return url.includes('.m3u8') || url.includes('.m3u') ||
    ct.includes('mpegurl') || ct.includes('x-mpegurl');
}

export function rewriteM3U8(text: string, baseUrl: string, rootUrl?: string): string {
  const base = new URL(baseUrl);
  const root = rootUrl ?? baseUrl;
  function proxy(uri: string): string {
    try {
      const absolute = new URL(uri, base).toString();
      return `/api/stream?url=${encodeURIComponent(absolute)}&_root=${encodeURIComponent(root)}`;
    } catch { return uri; }
  }
  return text.split('\n').map(line => {
    const t = line.trim();
    if (!t) return line;
    if (!t.startsWith('#')) return proxy(t);
    if (t.includes('URI="')) return t.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxy(u)}"`);
    return line;
  }).join('\n');
}

// Single-hop HTTP/HTTPS request with keep-alive agents.
function fetchOne(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const isHttps  = parsed.protocol === 'https:';
    const lib      = isHttps ? https : http;
    const agent    = isHttps ? httpsAgent : httpAgent;

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port:     parsed.port || (isHttps ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'GET',
        agent,
        headers:  { ...headers, Connection: 'keep-alive' },
        timeout:  30_000,
      },
      resolve,
    );

    signal.addEventListener('abort', () => { req.destroy(); reject(new DOMException('AbortError', 'AbortError')); }, { once: true });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new DOMException('TimeoutError', 'TimeoutError')); });
    req.end();
  });
}

// Follow 3xx redirects up to 5 hops — http.request() does not auto-redirect.
async function fetchStream(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  hops = 0,
): Promise<{ res: http.IncomingMessage; finalUrl: string }> {
  const res    = await fetchOne(url, headers, signal);
  const status = res.statusCode ?? 0;

  if (status >= 300 && status < 400 && hops < 5) {
    const location = res.headers['location'];
    res.resume(); // drain body so the socket can be reused
    if (!location) throw new Error('Redirect with no Location header');
    const next = new URL(location, url).toString();
    if (await isPrivateUrl(next)) throw new Error('Redirect to private address blocked');
    return fetchStream(next, headers, signal, hops + 1);
  }

  return { res, finalUrl: url };
}

// CDNs that disguise MPEG-TS segments as non-video MIME types to bypass filters.
// HLS.js rejects these; override them so the player can decode the segments.
const FAKE_SEGMENT_MIMES = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'text/javascript', 'application/javascript', 'text/plain',
]);

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const url     = typeof req.query.url     === 'string' ? req.query.url     : undefined;
  const rootUrl = typeof req.query._root   === 'string' ? req.query._root   : undefined;

  if (!url) return res.status(400).json({ error: 'url query param required' });
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return res.status(400).json({ error: 'url must use http or https scheme' });
  }

  if (await isPrivateUrl(url)) {
    return res.status(400).json({ error: 'requests to private addresses are not allowed' });
  }

  res.set('Access-Control-Allow-Origin', '*');

  const ac = new AbortController();
  res.on('close', () => ac.abort());

  try {
    const { hostname } = new URL(url);
    const reqHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept':     '*/*',
    };
    const cookies = getCookies(hostname);
    if (cookies) reqHeaders['Cookie'] = cookies;
    if (req.headers['range']) reqHeaders['Range'] = req.headers['range'] as string;

    const { res: upstream, finalUrl } = await fetchStream(url, reqHeaders, ac.signal);
    storeCookies(hostname, upstream.headers['set-cookie']?.join(', ') ?? null);

    const status = upstream.statusCode ?? 0;

    if (status < 200 || status >= 300) {
      upstream.resume(); // drain to free the socket
      // 401/403 = auth failure → mark dead + count toward portal eviction (subscription expired)
      // 404     = dead channel → mark dead only; portals always have some dead channels,
      //           so a 404 should NOT count toward evicting the whole portal
      // 5xx     = server error → count toward eviction only (temporary, don't mark URL dead)
      if (status === 401 || status === 403) {
        reportDeadUrl(rootUrl ?? url, true);
      } else if (status === 404) {
        reportDeadUrl(rootUrl ?? url, false);
      } else if (status === 500 || status === 502 || status === 503) {
        reportUnreachable(rootUrl ?? url);
      }
      console.warn(`[stream] FAIL ${status} ${url.slice(0, 80)}`);
      return res.status(status).json({ error: 'upstream returned error' });
    }

    // 200 with Content-Length: 0 = server acknowledged the request but has no stream data
    // (channel not broadcasting, slot full, soft 404). Treat as unavailable.
    if (upstream.headers['content-length'] === '0') {
      upstream.resume();
      return res.status(502).json({ error: 'empty stream' });
    }

    const ct = upstream.headers['content-type'] ?? '';

    // ── Playlist handling ──────────────────────────────────────────────────────
    // Use finalUrl as base for rewriting so relative segment paths resolve correctly
    // after any redirects.
    if (isPlaylist(finalUrl, ct)) {
      const chunks: Buffer[] = [];
      for await (const chunk of upstream) chunks.push(chunk as Buffer);
      const text = Buffer.concat(chunks).toString('utf-8');
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-store');
      return res.send(rewriteM3U8(text, finalUrl, rootUrl ?? url));
    }

    // Peek for playlists served with wrong/no content-type.
    // IMPORTANT: we read only the FIRST chunk (~4-8 KB), not the whole body.
    // Live .ts streams are infinite — buffering them hangs forever and causes
    // the client to see 200 with no body data (the bug that caused "loading stream…").
    const needsPeek = !ct || ct.includes('octet-stream') || ct.startsWith('text/');
    // Skip peek for URLs that are obviously raw binary streams — no point checking.
    const isObviouslyBinary =
      finalUrl.endsWith('.ts') || finalUrl.endsWith('.mp4') ||
      finalUrl.endsWith('.mkv') || finalUrl.endsWith('.flv') ||
      /\/live\/[^/?#]+\/[^/?#]+\/\d+$/.test(finalUrl);  // Xtream without extension

    if (needsPeek && !isObviouslyBinary) {
      const firstChunk = await new Promise<Buffer>((resolve, reject) => {
        upstream.once('data', (d: Buffer) => resolve(d));
        upstream.once('end',  ()          => resolve(Buffer.alloc(0)));
        upstream.once('error', reject);
      });

      if (firstChunk.toString('utf-8', 0, Math.min(firstChunk.length, 12)).trimStart().startsWith('#EXT')) {
        // It's a playlist — buffer the remainder and rewrite
        const rest: Buffer[] = [firstChunk];
        for await (const chunk of upstream) rest.push(chunk as Buffer);
        const text = Buffer.concat(rest).toString('utf-8');
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.set('Cache-Control', 'no-cache');
        return res.send(rewriteM3U8(text, finalUrl, rootUrl ?? url));
      }

      // Not a playlist — write the peeked chunk then pipe the rest as binary
      res.set('Content-Type', FAKE_SEGMENT_MIMES.has(ct) ? 'video/mp2t' : (ct || 'application/octet-stream'));
      res.set('Cache-Control', 'no-cache, no-store');
      res.write(firstChunk);
      upstream.on('error', () => res.end());
      upstream.pipe(res, { end: true });
      return;
    }

    // ── Binary media: stream straight through ─────────────────────────────────
    const effectiveCt = FAKE_SEGMENT_MIMES.has(ct) ? 'video/mp2t' : (ct || 'application/octet-stream');
    res.set('Content-Type', effectiveCt);
    res.set('Cache-Control', 'no-cache, no-store');
    const cr = upstream.headers['content-range'];
    const cl = upstream.headers['content-length'];
    if (cr) res.set('Content-Range', cr);
    if (cl) res.set('Content-Length', cl);

    upstream.on('error', () => res.end());
    upstream.pipe(res, { end: true });

  } catch (err: any) {
    if (err.name === 'AbortError')   return;
    if (err.name === 'TimeoutError') return res.status(504).json({ error: 'upstream timeout' });
    return res.status(502).json({ error: 'proxy error' });
  }
});

export default router;
