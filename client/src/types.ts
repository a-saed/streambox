export interface Channel {
  id: string;
  name: string;
  logo: string;
  url: string;
  category: string;
  country: string;
  language: string;
}

export interface EPGEntry {
  channelId: string;
  title: string;
  start: string;
  end: string;
}

export type EPGSchedule = Record<string, EPGEntry[]>;
