import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import { promises as dns } from 'dns';

const PRIVATE_IP = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|::1|fc|fd)/i;

async function isPrivateUrl(url: string): Promise<boolean> {
  try {
    const hostname = new URL(url).hostname;
    const { address } = await dns.lookup(hostname);
    return PRIVATE_IP.test(address);
  } catch {
    return true; // block if lookup fails
  }
}

const router = Router();

export function rewriteM3U8(text: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  return text
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const absolute = new URL(trimmed, base).toString();
      return `/api/stream?url=${encodeURIComponent(absolute)}`;
    })
    .join('\n');
}

router.get('/', async (req: Request, res: Response) => {
  const url = typeof req.query.url === 'string' ? req.query.url : undefined;
  if (!url) return res.status(400).json({ error: 'url query param required' });

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return res.status(400).json({ error: 'url must use http or https scheme' });
  }

  if (await isPrivateUrl(url)) {
    return res.status(400).json({ error: 'requests to private addresses are not allowed' });
  }

  res.set('Access-Control-Allow-Origin', '*');

  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'upstream returned error' });
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    const isM3U8 = url.includes('.m3u8') || contentType.includes('mpegurl');

    if (isM3U8) {
      const text = await upstream.text();
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewriteM3U8(text, url));
    }

    res.set('Content-Type', contentType || 'application/octet-stream');

    if (upstream.body) {
      Readable.fromWeb(upstream.body as any).pipe(res);
    } else {
      res.end();
    }
  } catch (err: any) {
    if (err.name === 'TimeoutError') return res.status(504).json({ error: 'upstream timeout' });
    return res.status(502).json({ error: 'proxy error' });
  }
});

export default router;
