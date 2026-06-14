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
