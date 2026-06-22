import type { Channel, EPGSchedule, Match } from '../types';

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

const TOKEN_KEY = 'streambox_token';
let _onUnauthorized: (() => void) | null = null;

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string): void { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken(): void { localStorage.removeItem(TOKEN_KEY); }
export function onUnauthorized(cb: () => void): void { _onUnauthorized = cb; }

/** Append the access token as a query param — for URLs loaded by the video player or
 *  EventSource, which cannot send an Authorization header. No-op when there's no token. */
export function withToken(url: string): string {
  const t = getToken();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
}

/** fetch wrapper: injects the Authorization header and handles 401 globally. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const t = getToken();
  const headers = new Headers(init.headers);
  if (t) headers.set('Authorization', `Bearer ${t}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    _onUnauthorized?.();
    throw new Error('unauthorized');
  }
  return res;
}

export interface VerifyResult { ok: boolean; status: number; }

/** POST the passphrase; store the token on success. */
export async function verifyAccess(code: string): Promise<VerifyResult> {
  const res = await fetch(`${API_BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (res.ok) {
    const data = await res.json();
    if (data?.token) setToken(data.token);
    return { ok: true, status: res.status };
  }
  return { ok: false, status: res.status };
}

export interface ChannelsResponse {
  channels: Channel[];
  categories: string[];
}

export async function fetchChannels(): Promise<ChannelsResponse> {
  const res = await apiFetch(`/api/channels`);
  if (!res.ok) throw new Error(`Failed to fetch channels: ${res.status}`);
  return res.json();
}

export async function fetchSourceChannels(source: string): Promise<Channel[]> {
  const res = await apiFetch(`/api/channels?source=${encodeURIComponent(source)}`);
  if (!res.ok) return [];
  const data: ChannelsResponse = await res.json();
  return data.channels;
}

export async function fetchEPG(): Promise<EPGSchedule> {
  const res = await apiFetch(`/api/epg`);
  if (!res.ok) throw new Error(`Failed to fetch EPG: ${res.status}`);
  return res.json();
}

export async function fetchMatches(): Promise<Match[]> {
  const res = await apiFetch(`/api/matches`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.matches ?? [];
}

export function proxyStreamUrl(url: string): string {
  // Internal server endpoints serve a pre-rewritten playlist directly.
  if (url.startsWith('/api/')) return withToken(`${API_BASE}${url}`);
  return withToken(`${API_BASE}/api/stream?url=${encodeURIComponent(url)}`);
}

export interface HubChannel {
  id: string;
  name: string;
  short: string;
  category: string;
  broadcasters: string[];
}

export interface HubStatus {
  portalCount: number;
  channelCount: number;
  liveCount: number;
  portals: Array<{ id: string; name: string; streamCount: number }>;
}

export async function fetchHubChannels(): Promise<HubChannel[]> {
  const res = await apiFetch(`/api/hub`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.channels ?? [];
}

export async function fetchHubStatus(): Promise<HubStatus> {
  const res = await apiFetch(`/api/hub/status`);
  if (!res.ok) return { portalCount: 0, channelCount: 0, liveCount: 0, portals: [] };
  return res.json();
}

export async function fetchHubLive(): Promise<string[]> {
  const res = await apiFetch(`/api/hub/live`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.liveChannelIds ?? [];
}

export async function fetchHubBest(channelId: string): Promise<{ url: string; source: string } | null> {
  const res = await apiFetch(`/api/hub/${channelId}/best`);
  if (!res.ok) return null;
  return res.json();
}

export async function discoverPortals(target = 50): Promise<void> {
  await apiFetch(`/api/hub/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target }),
  });
}

export function scanHubChannel(
  channelId: string,
  handlers: {
    onStatus: (msg: string) => void;
    onCandidate: (url: string, streamName: string, portalName: string) => void;
    onProgress: (checked: number, total: number) => void;
    onHit: (url: string, streamName: string, portalName: string) => void;
    onDone: (hits: number, message?: string) => void;
    onError: (msg: string) => void;
  }
): () => void {
  const es = new EventSource(withToken(`${API_BASE}/api/hub/${channelId}/scan`));

  es.addEventListener('status',    e => handlers.onStatus((JSON.parse(e.data) as any).message));
  es.addEventListener('candidate', e => { const d = JSON.parse(e.data) as any; handlers.onCandidate(d.url, d.streamName, d.portalName); });
  es.addEventListener('progress',  e => { const d = JSON.parse(e.data) as any; handlers.onProgress(d.checked, d.total); });
  es.addEventListener('hit',       e => { const d = JSON.parse(e.data) as any; handlers.onHit(d.url, d.streamName, d.portalName); });
  es.addEventListener('done',      e => { const d = JSON.parse(e.data) as any; handlers.onDone(d.hits, d.message); es.close(); });
  es.addEventListener('error',     e => { const d = JSON.parse((e as MessageEvent).data ?? '{}') as any; handlers.onError(d.message ?? 'Scan error'); es.close(); });

  return () => es.close();
}
