import type { Channel } from '../types';

const TIMEOUT_MS = 8_000;
const MIN_BYTES = 16 * 1024;
const MAX_BYTES = 64 * 1024;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

interface CacheEntry { alive: boolean; at: number }
const _cache = new Map<string, CacheEntry>();

/** Immediately mark a URL dead (called by stream proxy on 4xx). */
export function markDead(url: string): void {
  _cache.set(url, { alive: false, at: Date.now() });
}

export function markAlive(url: string): void {
  _cache.set(url, { alive: true, at: Date.now() });
}

/** Return cached alive status, or null if unknown/stale. */
export function getCached(url: string): boolean | null {
  const e = _cache.get(url);
  if (!e || Date.now() - e.at > CACHE_TTL_MS) return null;
  return e.alive;
}

/**
 * Check if a stream URL is alive. Returns cached result when available.
 * Uses HTTP range request + byte sniffing — same approach as VLC/IPTV apps.
 */
export async function checkUrl(url: string): Promise<boolean> {
  const cached = getCached(url);
  if (cached !== null) return cached;
  const result = await _httpCheck(url);
  _cache.set(url, { alive: result, at: Date.now() });
  return result;
}

async function _httpCheck(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
        'Accept': '*/*',
        'Range': `bytes=0-${MAX_BYTES - 1}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const { status } = resp;
    // Explicit auth/permission failures = definitively dead
    if (status === 401 || status === 403 || status === 404) return false;
    if (status !== 206 && (status < 200 || status >= 300)) return false;

    const ct = (resp.headers.get('content-type') ?? '').toLowerCase();
    if (_isDeadContentType(ct)) return false;

    // HLS playlists: just check the header text
    const isM3u8 = ct.includes('mpegurl') || url.toLowerCase().includes('.m3u8');
    if (isM3u8) {
      const text = await resp.text();
      return text.includes('#EXTM3U');
    }

    // Content-Length filter — only reject small bodies on 200 responses.
    // Do NOT apply to 206 (Partial Content): the server is correctly echoing back the range
    // size we requested (64 KB), so a Content-Length of 65536 is not an error page.
    // Applying the check to 206 was falsely marking working IPTV streams as dead.
    const cl = parseInt(resp.headers.get('content-length') ?? '0', 10);
    if (status !== 206 && cl > 0 && cl < MIN_BYTES) return false;

    const buf = await _readPartial(resp);
    if (buf.length < MIN_BYTES && cl <= 0) return false;

    return _hasVideoSig(buf);
  } catch {
    return false;
  }
}

async function _readPartial(resp: Response): Promise<Uint8Array> {
  if (!resp.body) return new Uint8Array(0);
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
      if (total >= MIN_BYTES) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function _isDeadContentType(ct: string): boolean {
  return ct.includes('text/html') || ct.includes('application/json') ||
    ct.includes('text/xml') || ct.includes('text/plain');
}

function _hasVideoSig(buf: Uint8Array): boolean {
  if (buf.length < 4) return false;

  // MPEG-TS: 0x47 sync byte every 188 bytes, need ≥3 valid packets
  if (buf[0] === 0x47) {
    let valid = true, count = 0;
    for (let i = 0; i < buf.length - 188 && count < 10; i += 188) {
      if (buf[i] !== 0x47) { valid = false; break; }
      count++;
    }
    if (valid && count >= 3) return true;
  }

  // MP4: 'ftyp' box at byte 4
  if (buf.length >= 8) {
    const box = String.fromCharCode(buf[4], buf[5], buf[6], buf[7]);
    if (box === 'ftyp') return true;
  }

  // HLS text header
  if (buf.length >= 7 &&
    String.fromCharCode(buf[0], buf[1], buf[2], buf[3], buf[4], buf[5], buf[6]) === '#EXTM3U') return true;

  // H.264 NAL start code
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 0 && buf[3] === 1) return true;

  // Matroska / WebM
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return true;

  // Large buffer = live stream with no recognisable header
  return buf.length >= 32 * 1024;
}

function _semaphore(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  function next() {
    if (queue.length && active < concurrency) { active++; queue.shift()!(); }
  }
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject).finally(() => { active--; next(); }));
      next();
    });
  };
}

/**
 * Filter channels to only those with live streams.
 * Runs concurrently (default 40). Calls onProgress per checked URL.
 */
export async function batchCheck(
  channels: Channel[],
  opts: {
    concurrency?: number;
    onProgress?: (checked: number, total: number, alive: number) => void;
  } = {}
): Promise<Channel[]> {
  const { concurrency = 40, onProgress } = opts;
  const run = _semaphore(concurrency);
  const alive: Channel[] = [];
  let checked = 0;

  await Promise.all(
    channels.map(ch =>
      run(async () => {
        const ok = await checkUrl(ch.url);
        if (ok) alive.push(ch);
        checked++;
        onProgress?.(checked, channels.length, alive.length);
      })
    )
  );

  return alive;
}
