import type { Channel, EPGSchedule } from '../types';

export interface ChannelsResponse {
  channels: Channel[];
  categories: string[];
}

export async function fetchChannels(): Promise<ChannelsResponse> {
  const res = await fetch('/api/channels');
  if (!res.ok) throw new Error(`Failed to fetch channels: ${res.status}`);
  return res.json();
}

export async function fetchEPG(): Promise<EPGSchedule> {
  const res = await fetch('/api/epg');
  if (!res.ok) throw new Error(`Failed to fetch EPG: ${res.status}`);
  return res.json();
}

export function proxyStreamUrl(url: string): string {
  return `/api/stream?url=${encodeURIComponent(url)}`;
}
