const CACHE_TTL_MS   = 55 * 60 * 1000;
const DISCOVERY_STALE_MS = 60 * 60 * 1000;
const IFRAME_RE      = /https?:\/\/[^"']+premiumtv\/daddy4\.php\?id=\d+/;
const ATOB_RE        = /atob\(['"]([A-Za-z0-9+/=_-]+)['"]\)/;

export const EMBED_HOST = 'https://donis.jimpenopisonline.online';
export const CDN_HOST   = 'phantemlis.top';
export const EMBED_UA   = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

interface CacheEntry { signedUrl: string; expiresAt: number }
const _cache = new Map<number, CacheEntry>();

let _discoveredEmbedBase: string | null = null;
let _discoveryFetchedAt = 0;

export function getCachedSignedUrl(id: number): string | null {
  const e = _cache.get(id);
  if (e && Date.now() < e.expiresAt) return e.signedUrl;
  return null;
}

function _cacheExpiryMs(signedUrl: string): number {
  try {
    const exp = parseInt(new URL(signedUrl).searchParams.get('expires') ?? '', 10);
    if (exp > 0) {
      const remaining = exp * 1000 - Date.now() - 120_000;
      if (remaining > 0) return remaining;
    }
  } catch { /* ignore */ }
  return CACHE_TTL_MS;
}

export function setCachedSignedUrl(id: number, url: string): void {
  _cache.set(id, { signedUrl: url, expiresAt: Date.now() + _cacheExpiryMs(url) });
}

export function evictSignedUrl(id: number): void {
  _cache.delete(id);
}

async function _discoverEmbedBase(id: number): Promise<string | null> {
  if (_discoveredEmbedBase && Date.now() - _discoveryFetchedAt < DISCOVERY_STALE_MS) {
    return _discoveredEmbedBase;
  }
  try {
    const r = await fetch(`https://dlhd.pk/stream/stream-${id}.php`, {
      headers: { 'User-Agent': EMBED_UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const html  = await r.text();
    const match = IFRAME_RE.exec(html);
    if (!match) return null;
    const base = new URL(match[0]).origin;
    _discoveredEmbedBase  = base;
    _discoveryFetchedAt   = Date.now();
    console.log(`[daddylive] discovered embed host: ${base}`);
    return base;
  } catch {
    return null;
  }
}

async function _tryFetch(embedUrl: string, id: number): Promise<string | null> {
  try {
    const r = await fetch(embedUrl, {
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

export async function fetchSignedUrl(id: number): Promise<string | null> {
  // Try known embed base (discovered or hardcoded constant)
  const base    = _discoveredEmbedBase ?? EMBED_HOST;
  const primary = await _tryFetch(`${base}/premiumtv/daddy4.php?id=${id}`, id);
  if (primary) return primary;

  // Primary failed — discover current embed host
  const discovered = await _discoverEmbedBase(id);
  if (discovered && discovered !== base) {
    return _tryFetch(`${discovered}/premiumtv/daddy4.php?id=${id}`, id);
  }
  return null;
}

export type ChannelStatus = 'h264' | 'hevc' | false;

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
