import type { Channel, EPGSchedule, Match } from '../types';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export interface ChannelsResponse {
  channels: Channel[];
  categories: string[];
}

export async function fetchChannels(): Promise<ChannelsResponse> {
  const res = await fetch(`${API_BASE}/api/channels`);
  if (!res.ok) throw new Error(`Failed to fetch channels: ${res.status}`);
  return res.json();
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
  return `${API_BASE}/api/stream?url=${encodeURIComponent(url)}`;
}
