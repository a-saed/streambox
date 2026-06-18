export interface Channel {
  id: string;
  name: string;
  logo: string;
  url: string;
  sources?: string[];   // all known stream URLs ranked by reliability; sources[0] === url
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

export interface MatchTeam {
  name: string;
  shortName: string;
  crest: string;
}

export interface Match {
  id: number;
  competition: { name: string; code: string; emblem: string };
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  utcDate: string;
  status: 'TIMED' | 'SCHEDULED' | 'IN_PLAY' | 'PAUSED' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
  score: { fullTime: { home: number | null; away: number | null } };
  broadcasters: string[];
}
