export interface Channel {
  id: string;
  name: string;
  logo: string;
  url: string;
  category: string;
  country: string;
  language: string;
  tvgUrl?: string;
}

export interface EPGEntry {
  channelId: string;
  title: string;
  start: string; // ISO 8601
  end: string;   // ISO 8601
}

export type EPGSchedule = Record<string, EPGEntry[]>;

// ── IPTV portal types ────────────────────────────────────────────────────────

export interface IptvPortal {
  url: string;
  username: string;
  password: string;
  source: string;
}

export interface VerifiedPortal extends IptvPortal {
  id: string;
  name: string;
  expiry: string;
  maxConnections: string;
  activeConnections: string;
  streamCount: number;
  lastVerifiedAt: number;
}

export interface IptvStream {
  streamId: string;
  name: string;
  icon: string;
  categoryId: string;
  containerExt: string;
  kind: 'live' | 'vod' | 'series';
  epgChannelId: string;
}

export interface IptvCategory {
  id: string;
  name: string;
}

export interface EpgEntry {
  title: string;
  description: string;
  start: Date;
  stop: Date;
}
