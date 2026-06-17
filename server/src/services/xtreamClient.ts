import { createHash } from 'node:crypto';
import type { IptvPortal, VerifiedPortal, IptvCategory, IptvStream, EpgEntry } from '../types';

const UA = 'VLC/3.0.20 LibVLC/3.0.20';
const enc = encodeURIComponent;

async function httpGet(url: string, timeoutMs = 10_000): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json,*/*' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    return resp.text();
  } catch {
    return null;
  }
}

function formatExpiry(raw: string): string {
  const ts = parseInt(raw, 10);
  if (!ts) return 'Unknown';
  try {
    const d = new Date(ts * 1000);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return raw;
  }
}

/** Attempt login against /player_api.php. Returns user_info on success, null on failure. */
export async function login(
  portal: IptvPortal,
  timeoutMs = 6_000,
): Promise<Record<string, unknown> | null> {
  const url = `${portal.url}/player_api.php?username=${enc(portal.username)}&password=${enc(portal.password)}`;
  const text = await httpGet(url, timeoutMs);
  if (!text) return null;
  try {
    const root = JSON.parse(text) as Record<string, unknown>;
    const info = (root.user_info as Record<string, unknown>) ?? root;
    const auth = String(info.auth ?? '');
    const status = String(info.status ?? '').toLowerCase();
    const ok = auth === '1' || status === 'active' || 'user_info' in root;
    return ok ? info : null;
  } catch {
    return null;
  }
}

/** Login and return a VerifiedPortal, or null if credentials are bad. */
export async function verifyOrNull(
  portal: IptvPortal,
  timeoutMs = 6_000,
): Promise<VerifiedPortal | null> {
  const info = await login(portal, timeoutMs);
  if (!info) return null;
  const id = createHash('sha256')
    .update(`${portal.url}|${portal.username}|${portal.password}`.toLowerCase())
    .digest('hex')
    .slice(0, 16);
  return {
    ...portal,
    id,
    name: String(info.username || portal.username),
    expiry: formatExpiry(String(info.exp_date ?? '')),
    maxConnections: String(info.max_connections ?? '1'),
    activeConnections: String(info.active_cons ?? '0'),
    streamCount: 0,
    lastVerifiedAt: Date.now(),
  };
}

export async function categories(
  portal: IptvPortal,
  kind: 'live' | 'vod' | 'series',
): Promise<IptvCategory[]> {
  const action = kind === 'live' ? 'get_live_categories'
    : kind === 'vod' ? 'get_vod_categories' : 'get_series_categories';
  const url = `${portal.url}/player_api.php?username=${enc(portal.username)}&password=${enc(portal.password)}&action=${action}`;
  const text = await httpGet(url, 8_000);
  if (!text) return [];
  try {
    return (JSON.parse(text) as Array<Record<string, unknown>>).map(o => ({
      id: String(o.category_id ?? ''),
      name: String(o.category_name ?? ''),
    }));
  } catch {
    return [];
  }
}

export async function streams(
  portal: IptvPortal,
  kind: 'live' | 'vod' | 'series',
  categoryId = '',
): Promise<IptvStream[]> {
  const action = kind === 'live' ? 'get_live_streams'
    : kind === 'vod' ? 'get_vod_streams' : 'get_series';
  let url = `${portal.url}/player_api.php?username=${enc(portal.username)}&password=${enc(portal.password)}&action=${action}`;
  if (categoryId) url += `&category_id=${enc(categoryId)}`;
  const text = await httpGet(url, 15_000);
  if (!text) {
    console.warn(`[xtream] streams() null response (timeout?) ${portal.url} user=${portal.username}`);
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      console.warn(`[xtream] streams() non-array response (${text.slice(0, 80).replace(/\n/g,' ')}) ${portal.url}`);
      return [];
    }
    if (parsed.length === 0) {
      console.warn(`[xtream] streams() empty array ${portal.url} user=${portal.username}`);
    }
    return (parsed as Array<Record<string, unknown>>).map(o => {
      const isLive = kind === 'live';
      const isVod  = kind === 'vod';
      return {
        streamId:     String(o.stream_id ?? o.series_id ?? o.id ?? ''),
        name:         String(o.name ?? o.title ?? ''),
        icon:         String(o.stream_icon ?? o.cover ?? ''),
        categoryId:   String(o.category_id ?? ''),
        containerExt: isLive ? 'ts' : isVod ? String(o.container_extension || 'mp4') : '',
        kind,
        epgChannelId: String(o.epg_channel_id ?? ''),
      } satisfies IptvStream;
    });
  } catch (e) {
    console.warn(`[xtream] streams() parse error ${portal.url}:`, String(e).slice(0, 80));
    return [];
  }
}

export function streamUrl(portal: IptvPortal, s: IptvStream): string {
  const u = enc(portal.username);
  const p = enc(portal.password);
  if (s.kind === 'live') return `${portal.url}/live/${u}/${p}/${s.streamId}.${s.containerExt}`;
  if (s.kind === 'vod')  return `${portal.url}/movie/${u}/${p}/${s.streamId}.${s.containerExt}`;
  return '';
}

export async function shortEpg(
  portal: IptvPortal,
  streamId: string,
  limit = 2,
): Promise<EpgEntry[]> {
  if (!streamId) return [];
  const url = `${portal.url}/player_api.php?username=${enc(portal.username)}&password=${enc(portal.password)}&action=get_short_epg&stream_id=${enc(streamId)}&limit=${limit}`;
  const text = await httpGet(url, 6_000);
  if (!text) return [];

  function decode64(v: unknown): string {
    if (!v) return '';
    try { return Buffer.from(String(v), 'base64').toString('utf-8').trim(); } catch { return String(v); }
  }
  function parseTs(v: unknown): Date | null {
    const s = String(v ?? '');
    const secs = parseInt(s, 10);
    if (secs > 1_000_000_000) return new Date(secs * 1000);
    try { return new Date(s.replace(' ', 'T')); } catch { return null; }
  }

  try {
    const root = JSON.parse(text);
    const arr: Array<Record<string, unknown>> = Array.isArray(root)
      ? root : (root as Record<string, unknown>).epg_listings as Array<Record<string, unknown>> ?? [];
    return arr.flatMap(e => {
      const start = parseTs(e.start_timestamp ?? e.start);
      const stop  = parseTs(e.stop_timestamp ?? e.end);
      if (!start || !stop) return [];
      return [{ title: decode64(e.title), description: decode64(e.description), start, stop }];
    }).sort((a, b) => a.start.getTime() - b.start.getTime());
  } catch {
    return [];
  }
}
