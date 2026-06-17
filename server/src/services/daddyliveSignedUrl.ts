// Shared signed-URL logic for DaddyLive channels.
// No dependency on cache.ts, routes, or the stream proxy — safe to import anywhere.

const CACHE_TTL_MS = 55 * 60 * 1000;

export const EMBED_HOST  = 'https://donis.jimpenopisonline.online';
export const CDN_HOST    = 'phantemlis.top';
export const EMBED_UA    = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const ATOB_RE = /atob\(['"]([A-Za-z0-9+/=_-]+)['"]\)/;

interface CacheEntry { signedUrl: string; fetchedAt: number }
const _cache = new Map<number, CacheEntry>();

export function getCachedSignedUrl(id: number): string | null {
  const e = _cache.get(id);
  if (e && Date.now() - e.fetchedAt < CACHE_TTL_MS) return e.signedUrl;
  return null;
}

export function setCachedSignedUrl(id: number, url: string): void {
  _cache.set(id, { signedUrl: url, fetchedAt: Date.now() });
}

export function evictSignedUrl(id: number): void {
  _cache.delete(id);
}

// Fast path: fetch embed page HTML and decode the atob('base64...') inline script.
// Takes ~200ms; works as long as DaddyLive keeps hardcoding the URL in JS.
export async function fetchSignedUrl(id: number): Promise<string | null> {
  try {
    const r = await fetch(`${EMBED_HOST}/premiumtv/daddy4.php?id=${id}`, {
      headers: {
        'User-Agent': EMBED_UA,
        'Referer':    `https://dlhd.pk/stream/stream-${id}.php`,
        'Origin':     'https://dlhd.pk',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const html = await r.text();
    const m    = ATOB_RE.exec(html);
    if (!m) return null;
    const decoded = Buffer.from(m[1], 'base64').toString('utf-8');
    if (!decoded.startsWith('https://') || !decoded.includes(CDN_HOST)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export type ChannelStatus = 'h264' | 'hevc' | false;

// Returns the codec ('h264' | 'hevc') if the channel is broadcasting, false if offline.
// Also primes the signed-URL cache so the first viewer gets an instant response.
export async function checkChannelLive(id: number): Promise<ChannelStatus> {
  const signedUrl = await fetchSignedUrl(id);
  if (!signedUrl) return false;
  try {
    const r = await fetch(signedUrl, {
      headers: { 'User-Agent': EMBED_UA },
      signal:  AbortSignal.timeout(10_000),
    });
    if (!r.ok) return false;
    const master = await r.text();
    setCachedSignedUrl(id, signedUrl);
    const isHevc = master.includes('hvc1') || master.includes('hev1');
    return isHevc ? 'hevc' : 'h264';
  } catch {
    return false;
  }
}
