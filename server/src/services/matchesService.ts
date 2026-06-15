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

// Free-to-air and major broadcasters per competition code (football-data.org)
const BROADCASTERS: Record<string, string[]> = {
  WC:  ['BBC Sport', 'ITV', 'ARD', 'ZDF', 'TF1', 'RAI 1', 'TVE', 'beIN Sports', 'SBS'],
  EC:  ['BBC Sport', 'ITV', 'ARD', 'ZDF', 'TF1', 'RAI 1', 'TVE'],
  CL:  ['CBS Sports', 'BT Sport', 'Canal+', 'Sky Sport', 'DAZN', 'beIN Sports'],
  EL:  ['BT Sport', 'Canal+', 'DAZN', 'RTL'],
  ECL: ['DAZN', 'BT Sport'],
  PL:  ['Sky Sports', 'TNT Sports', 'NBC Sports'],
  BL1: ['Sky Sport', 'DAZN', 'Sport1', 'ARD', 'ZDF'],
  SA:  ['DAZN', 'Sky Sport Italia'],
  PD:  ['DAZN', 'Movistar', 'beIN Sports', 'TVE'],
  FL1: ['DAZN', 'Canal+', 'Amazon Prime'],
  PPL: ['Sport TV', 'RTP'],
  ELC: ['Sky Sports'],
  BSA: ['Globo', 'SporTV', 'ESPN'],
  DED: ['ESPN', 'Ziggo Sport', 'RTL'],
  CLI: ['beIN Sports', 'Globo', 'ESPN'],
};

let cache: { matches: Match[]; fetchedAt: number } = { matches: [], fetchedAt: 0 };
const TTL = 15 * 60 * 1000; // 15 minutes

export async function getMatches(): Promise<Match[]> {
  if (Date.now() - cache.fetchedAt < TTL && cache.matches.length > 0) {
    return cache.matches;
  }

  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) {
    console.warn('[matches] FOOTBALL_DATA_KEY not set');
    return [];
  }

  const now    = new Date();
  const future = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
  const dateFrom = now.toISOString().split('T')[0];
  const dateTo   = future.toISOString().split('T')[0];

  try {
    const res = await fetch(
      `https://api.football-data.org/v4/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      {
        headers: { 'X-Auth-Token': key },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!res.ok) {
      console.warn(`[matches] API returned ${res.status}`);
      return cache.matches;
    }

    const data = await res.json();
    const raw: any[] = data.matches ?? [];

    const enriched: Match[] = raw.map(m => ({
      id:          m.id,
      competition: { name: m.competition?.name ?? '', code: m.competition?.code ?? '', emblem: m.competition?.emblem ?? '' },
      homeTeam:    { name: m.homeTeam?.name ?? '', shortName: m.homeTeam?.shortName ?? '', crest: m.homeTeam?.crest ?? '' },
      awayTeam:    { name: m.awayTeam?.name ?? '', shortName: m.awayTeam?.shortName ?? '', crest: m.awayTeam?.crest ?? '' },
      utcDate:     m.utcDate,
      status:      m.status,
      score:       { fullTime: { home: m.score?.fullTime?.home ?? null, away: m.score?.fullTime?.away ?? null } },
      broadcasters: BROADCASTERS[m.competition?.code ?? ''] ?? [],
    }));

    cache = { matches: enriched, fetchedAt: Date.now() };
    console.log(`[matches] Loaded ${enriched.length} upcoming matches`);
    return enriched;
  } catch (err: any) {
    console.warn('[matches] Fetch failed:', err.message);
    return cache.matches;
  }
}
