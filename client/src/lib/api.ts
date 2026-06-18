import type { Channel, EPGSchedule, Match } from '../types';

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export interface ChannelsResponse {
  channels: Channel[];
  categories: string[];
}

export async function fetchChannels(): Promise<ChannelsResponse> {
  const res = await fetch(`${API_BASE}/api/channels`);
  if (!res.ok) throw new Error(`Failed to fetch channels: ${res.status}`);
  return res.json();
}

export async function fetchSourceChannels(source: string): Promise<Channel[]> {
  const res = await fetch(`${API_BASE}/api/channels?source=${encodeURIComponent(source)}`);
  if (!res.ok) return [];
  const data: ChannelsResponse = await res.json();
  return data.channels;
}

export async function fetchEPG(): Promise<EPGSchedule> {
  const res = await fetch(`${API_BASE}/api/epg`);
  if (!res.ok) throw new Error(`Failed to fetch EPG: ${res.status}`);
  return res.json();
}

export async function fetchMatches(): Promise<Match[]> {
  const res = await fetch(`${API_BASE}/api/matches`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.matches ?? [];
}

export function proxyStreamUrl(url: string): string {
  // Internal server endpoints (e.g. /api/daddylive/:id) serve a pre-rewritten playlist
  // directly — no need to wrap them in the generic stream proxy.
  if (url.startsWith('/api/')) return `${API_BASE}${url}`;
  return `${API_BASE}/api/stream?url=${encodeURIComponent(url)}`;
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
  const res = await fetch(`${API_BASE}/api/hub`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.channels ?? [];
}

export async function fetchHubStatus(): Promise<HubStatus> {
  const res = await fetch(`${API_BASE}/api/hub/status`);
  if (!res.ok) return { portalCount: 0, channelCount: 0, liveCount: 0, portals: [] };
  return res.json();
}

export async function fetchHubLive(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/hub/live`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.liveChannelIds ?? [];
}

export async function fetchHubBest(channelId: string): Promise<{ url: string; source: string } | null> {
  const res = await fetch(`${API_BASE}/api/hub/${channelId}/best`);
  if (!res.ok) return null;
  return res.json();
}

export async function discoverPortals(target = 50): Promise<void> {
  await fetch(`${API_BASE}/api/hub/discover`, {
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
  const es = new EventSource(`${API_BASE}/api/hub/${channelId}/scan`);

  es.addEventListener('status',    e => handlers.onStatus((JSON.parse(e.data) as any).message));
  es.addEventListener('candidate', e => { const d = JSON.parse(e.data) as any; handlers.onCandidate(d.url, d.streamName, d.portalName); });
  es.addEventListener('progress',  e => { const d = JSON.parse(e.data) as any; handlers.onProgress(d.checked, d.total); });
  es.addEventListener('hit',       e => { const d = JSON.parse(e.data) as any; handlers.onHit(d.url, d.streamName, d.portalName); });
  es.addEventListener('done',      e => { const d = JSON.parse(e.data) as any; handlers.onDone(d.hits, d.message); es.close(); });
  es.addEventListener('error',     e => { const d = JSON.parse((e as MessageEvent).data ?? '{}') as any; handlers.onError(d.message ?? 'Scan error'); es.close(); });

  return () => es.close();
}
