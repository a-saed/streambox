import { Router, Request, Response } from 'express';
import { Readable } from 'stream';

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
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: 'url query param required' });

  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'upstream returned error' });
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    const isM3U8 = url.includes('.m3u8') || contentType.includes('mpegurl');

    res.set('Access-Control-Allow-Origin', '*');

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
