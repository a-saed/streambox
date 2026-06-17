export type HubCategory =
  | 'bein'
  | 'combat'
  | 'motorsport'
  | 'soccer'
  | 'us-sport'
  | 'news'
  | 'uk-general'
  | 'movies'
  | 'documentary'
  | 'kids'
  | 'music'
  | 'entertainment'
  | 'arabic'
  | 'indian';

export interface HubChannel {
  id: string;
  name: string;
  short: string;
  category: HubCategory;
  keywords: string[];
  exclude?: string[];
  /** Broadcaster names as they appear in football-data.org fixtures */
  broadcasters?: string[];
}

export function matchesChannel(streamName: string, ch: HubChannel): boolean {
  const lower = streamName.toLowerCase();
  for (const ex of ch.exclude ?? []) {
    if (lower.includes(ex.toLowerCase())) return false;
  }
  for (const k of ch.keywords) {
    if (lower.includes(k.toLowerCase())) return true;
  }
  return false;
}

export function channelById(id: string): HubChannel | undefined {
  return HUB_CHANNELS.find(c => c.id === id);
}

export const HUB_CHANNELS: HubChannel[] = [
  // ── beIN Sports ──────────────────────────────────────────────────────────────
  // All beIN family channels in one dedicated category so users can filter easily.
  // Numbered Arabic channels (1-9), Max channels (1-3), premium, XTRA, and MENA.
  {
    id: 'bein_ar_1', name: 'beIN Sports AR 1', short: 'BEIN1', category: 'bein',
    keywords: ['bein 1 ', ' bein 1', 'bein1 ', 'bein sport 1', 'bein sports 1', 'bein_1', 'bein-1',
      'ar bein 1', 'bein ar 1', 'ar: bein 1', 'ar:bein 1', '[ar] bein 1', '|ar| bein 1',
      'bein sports ar 1', 'bein ar1', 'beinsports1'],
    exclude: ['max', 'premium'],
    broadcasters: ['beIN Sports 1'],
  },
  {
    id: 'bein_ar_2', name: 'beIN Sports AR 2', short: 'BEIN2', category: 'bein',
    keywords: ['bein 2 ', ' bein 2', 'bein2 ', 'bein sport 2', 'bein sports 2', 'bein_2', 'bein-2',
      'ar bein 2', 'bein ar 2', 'ar: bein 2', 'ar:bein 2', '[ar] bein 2', '|ar| bein 2',
      'bein sports ar 2', 'bein ar2', 'beinsports2'],
    exclude: ['max'],
    broadcasters: ['beIN Sports 2'],
  },
  {
    id: 'bein_ar_3', name: 'beIN Sports AR 3', short: 'BEIN3', category: 'bein',
    keywords: ['bein 3 ', ' bein 3', 'bein3 ', 'bein sport 3', 'bein sports 3', 'bein_3', 'bein-3',
      'ar bein 3', 'bein ar 3', 'ar: bein 3', 'ar:bein 3', '[ar] bein 3', '|ar| bein 3',
      'bein sports ar 3', 'bein ar3', 'beinsports3'],
    exclude: ['max'],
    broadcasters: ['beIN Sports 3'],
  },
  {
    id: 'bein_ar_4', name: 'beIN Sports AR 4', short: 'BEIN4', category: 'bein',
    keywords: ['bein 4 ', ' bein 4', 'bein4 ', 'bein sport 4', 'bein sports 4', 'bein_4',
      'ar bein 4', 'bein ar 4', '[ar] bein 4', '|ar| bein 4', 'bein sports ar 4'],
    exclude: ['max'],
    broadcasters: ['beIN Sports 4'],
  },
  {
    id: 'bein_ar_5', name: 'beIN Sports AR 5', short: 'BEIN5', category: 'bein',
    keywords: ['bein 5 ', ' bein 5', 'bein5 ', 'bein sport 5', 'bein sports 5', 'bein_5',
      'ar bein 5', 'bein ar 5', '[ar] bein 5', '|ar| bein 5', 'bein sports ar 5'],
    exclude: ['max'],
    broadcasters: ['beIN Sports 5'],
  },
  {
    id: 'bein_ar_6', name: 'beIN Sports AR 6', short: 'BEIN6', category: 'bein',
    keywords: ['bein 6 ', ' bein 6', 'bein6 ', 'bein sport 6', 'bein sports 6', 'bein_6',
      'ar bein 6', 'bein ar 6', '[ar] bein 6', '|ar| bein 6', 'bein sports ar 6'],
    broadcasters: ['beIN Sports 6'],
  },
  {
    id: 'bein_ar_7', name: 'beIN Sports AR 7', short: 'BEIN7', category: 'bein',
    keywords: ['bein 7 ', ' bein 7', 'bein7 ', 'bein sport 7', 'bein sports 7', 'bein_7',
      'ar bein 7', 'bein ar 7', '[ar] bein 7', '|ar| bein 7', 'bein sports ar 7'],
    broadcasters: ['beIN Sports 7'],
  },
  {
    id: 'bein_ar_8', name: 'beIN Sports AR 8', short: 'BEIN8', category: 'bein',
    keywords: ['bein 8 ', ' bein 8', 'bein8 ', 'bein sport 8', 'bein sports 8', 'bein_8',
      'ar bein 8', 'bein ar 8', '[ar] bein 8', '|ar| bein 8', 'bein sports ar 8'],
  },
  {
    id: 'bein_ar_9', name: 'beIN Sports AR 9', short: 'BEIN9', category: 'bein',
    keywords: ['bein 9 ', ' bein 9', 'bein9 ', 'bein sport 9', 'bein sports 9', 'bein_9',
      'ar bein 9', 'bein ar 9', '[ar] bein 9', '|ar| bein 9', 'bein sports ar 9'],
  },
  {
    id: 'bein_max_1', name: 'beIN Sports Max 1', short: 'MAX1', category: 'bein',
    keywords: ['bein max 1', 'bein sports max 1', 'beinmax1', 'bein max1',
      'ar bein max 1', 'bein ar max 1', '[ar] bein max 1', '|ar| bein max 1',
      'bein max hd 1', 'bein max ar', 'bein sports max ar'],
    broadcasters: ['beIN Sports Max 1', 'beIN SPORTS Max 1'],
  },
  {
    id: 'bein_max_2', name: 'beIN Sports Max 2', short: 'MAX2', category: 'bein',
    keywords: ['bein max 2', 'bein sports max 2', 'beinmax2', 'bein max2',
      'ar bein max 2', 'bein ar max 2', '[ar] bein max 2', '|ar| bein max 2',
      'bein max hd 2'],
    broadcasters: ['beIN Sports Max 2'],
  },
  {
    id: 'bein_max_3', name: 'beIN Sports Max 3', short: 'MAX3', category: 'bein',
    keywords: ['bein max 3', 'bein sports max 3', 'beinmax3', 'bein max3',
      'ar bein max 3', 'bein ar max 3', '[ar] bein max 3', '|ar| bein max 3'],
    broadcasters: ['beIN Sports Max 3'],
  },
  {
    id: 'bein_xtra', name: 'beIN Sports XTRA', short: 'XTRA', category: 'bein',
    keywords: ['bein xtra', 'bein sports xtra', 'bein extra', 'bein sports extra',
      'ar bein xtra', '[ar] bein xtra'],
  },
  {
    id: 'bein_premium', name: 'beIN Premium / 4K', short: 'BEINP', category: 'bein',
    keywords: ['bein premium', 'bein sports premium', 'bein 4k', 'bein ultra', 'bein prem'],
  },
  {
    id: 'bein_mena', name: 'beIN MENA English', short: 'MENA', category: 'bein',
    keywords: ['bein mena', 'bein sports mena', 'bein english', 'bein sports english',
      'bein hd english', 'bein mena english'],
  },
  {
    id: 'bein_sports', name: 'beIN Sports (general)', short: 'BEIN', category: 'bein',
    keywords: ['bein sport', 'bein sports', 'beinsports', 'bein hd', 'bein connect', 'bein+ ', 'beinsport'],
    exclude: ['max', 'premium', 'mena', 'xtra', 'extra', 'arabic', 'arabic 1', 'arabic 2', 'arabic 3',
      'arabic 4', 'arabic 5', 'arabic 6', 'arabic 7', 'arabic 8', 'arabic 9'],
    broadcasters: ['beIN Sports', 'beIN SPORTS'],
  },
  // ── Combat sports ──
  {
    id: 'ufc', name: 'UFC', short: 'UFC', category: 'combat',
    keywords: ['ufc', 'ufc fight pass', 'ufc ppv', 'ufc on espn', 'ufc fight night', 'ufc 3', 'ufc apex', 'ufc on abc'],
  },
  {
    id: 'wwe', name: 'WWE', short: 'WWE', category: 'combat',
    keywords: ['wwe', 'wwe network', 'wwe ppv', 'wwe raw', 'wwe smackdown', 'wwe nxt', 'wwe premium',
      'wrestlemania', 'summerslam', 'royal rumble', 'money in the bank', 'survivor series'],
  },
  {
    id: 'aew', name: 'AEW', short: 'AEW', category: 'combat',
    keywords: ['aew', 'all elite wrestling', 'aew dynamite', 'aew rampage', 'aew collision',
      'aew revolution', 'aew double or nothing', 'aew full gear'],
  },
  {
    id: 'boxing', name: 'Boxing', short: 'BOX', category: 'combat',
    keywords: ['boxing', 'ppv box', 'fight night', 'fite tv', 'fite', 'matchroom', 'top rank',
      'premier boxing', 'pbc ', 'queensberry', 'espn boxing', 'showtime boxing', 'boxnation',
      'fight network', 'dazn boxing', 'boxing nation', 'golden boy', 'wbo', 'wbc', 'ibf', 'wba',
      'world boxing', 'championship boxing', 'super middleweight', 'heavyweight', 'sky sports boxing'],
    exclude: ['box office', 'xbox', 'boxset', 'box set', 'music box', 'kids box'],
  },
  {
    id: 'bellator', name: 'Bellator MMA', short: 'BLR', category: 'combat',
    keywords: ['bellator', 'bellator mma', 'pfl ', 'pfl mma', 'professional fighters league'],
  },
  {
    id: 'ppv_events', name: 'PPV Events', short: 'PPV', category: 'combat',
    keywords: [' ppv', 'ppv ', 'pay per view', 'pay-per-view'],
  },
  {
    id: 'one_championship', name: 'ONE Championship', short: 'ONE', category: 'combat',
    keywords: ['one championship', 'one fc', 'one mma', 'one martial arts'],
  },
  // ── Motorsport ──
  {
    id: 'f1', name: 'Formula 1', short: 'F1', category: 'motorsport',
    keywords: ['f1 tv', 'formula 1', 'formula one', 'sky f1', 'skysports f1', 'sky sport f1',
      'sky sports f1', 'ssf1', 'ss f1', 'espn f1', 'f1 race', 'grand prix', 'gp race',
      'f1 qualifying', 'formula 1 grand prix'],
  },
  {
    id: 'motogp', name: 'MotoGP', short: 'GP', category: 'motorsport',
    keywords: ['motogp', 'moto gp', 'moto-gp', 'moto2', 'moto3', 'motogp race'],
  },
  {
    id: 'nascar', name: 'NASCAR', short: 'NSC', category: 'motorsport',
    keywords: ['nascar', 'nascar cup', 'daytona 500', 'nascar xfinity'],
  },
  {
    id: 'indycar', name: 'IndyCar', short: 'INDY', category: 'motorsport',
    keywords: ['indycar', 'indy car', 'indy 500', 'indianapolis 500'],
  },
  {
    id: 'wrc', name: 'WRC Rally', short: 'WRC', category: 'motorsport',
    keywords: ['wrc', 'world rally', 'rallytv', 'rally tv', 'rally championship'],
  },
  {
    id: 'superbike', name: 'Superbike / WSBK', short: 'WSBK', category: 'motorsport',
    keywords: ['wsbk', 'superbike', 'world superbike', 'worldsbk'],
  },
  // ── Soccer ──
  {
    id: 'sky_sports', name: 'Sky Sports', short: 'SKY', category: 'soccer',
    keywords: ['sky sport', 'sky sports', 'skysports', 'sky sports main event',
      'sky sports premier league', 'sky sports football', 'sky sports action',
      'sky sports arena', 'sky sports cricket', 'sky sports golf', 'sky sports f1'],
    exclude: ['sky sports news'],
    broadcasters: ['Sky Sports', 'Sky Sports UK'],
  },
  {
    id: 'tnt_sports', name: 'TNT Sports', short: 'TNT', category: 'soccer',
    keywords: ['tnt sport', 'tnt sports', 'bt sport', 'btsport', 'tnt sports 1',
      'tnt sports 2', 'tnt sports 3', 'tnt sports 4', 'bt sport 1', 'bt sport 2', 'bt sport 3'],
    broadcasters: ['TNT Sports', 'BT Sport', 'Discovery+'],
  },
  {
    id: 'champions_league', name: 'Champions League', short: 'UCL', category: 'soccer',
    keywords: ['champions league', 'uefa champions', 'ucl ', ' ucl ', 'uefa europa',
      'europa league', 'conference league', 'uecl', 'bein champions', 'bein ucl',
      'tnt sports ucl', 'sky sports ucl', 'cbs sports ucl', 'paramount+ ucl',
      'dazn champions', 'canal+ champions'],
  },
  {
    id: 'premier_league', name: 'Premier League', short: 'EPL', category: 'soccer',
    keywords: ['premier league', 'epl ', 'barclays premier', ' bpl ', 'sky sports pl',
      'bein epl', 'nbc premier league', 'peacock premier league', 'manutd', 'man city', 'arsenal fc'],
  },
  {
    id: 'la_liga', name: 'La Liga', short: 'LL', category: 'soccer',
    keywords: ['laliga', 'la liga', 'movistar laliga', 'laliga tv', 'laliga ea sports'],
  },
  {
    id: 'serie_a', name: 'Serie A', short: 'SA', category: 'soccer',
    keywords: ['serie a', 'dazn italia', 'sky calcio', 'calcio', 'italian football', 'serie a tim'],
  },
  {
    id: 'bundesliga', name: 'Bundesliga', short: 'BL', category: 'soccer',
    keywords: ['bundesliga', 'sky bundesliga', 'dazn bundes', 'german football', 'bundesliga 2'],
  },
  {
    id: 'ligue_1', name: 'Ligue 1', short: 'L1', category: 'soccer',
    keywords: ['ligue 1', 'ligue1', 'canal+ sport', 'canal plus sport', 'rmc sport',
      'prime video ligue', 'french football', 'ligue 2', 'dazn ligue'],
    broadcasters: ['Canal+', 'Canal+ Sport', 'DAZN'],
  },
  {
    id: 'mls', name: 'MLS', short: 'MLS', category: 'soccer',
    keywords: [' mls', 'mls ', 'major league soccer', 'apple mls', 'mls season pass', 'mls next'],
  },
  {
    id: 'world_cup', name: 'FIFA World Cup 2026', short: 'WC26', category: 'soccer',
    keywords: [
      'world cup', 'worldcup', 'world cup 2026', 'wc 2026', 'wc2026', 'wc26',
      'fifa world', 'fifa 2026', 'fifa26', 'fifa+', 'fifa plus',
      'mundial', 'coupe du monde', 'copa mundial', 'كأس العالم',
      'fox sports wc', 'bein wc', 'tnt wc',
    ],
  },
  // SSC — Saudi Sports Channel, primary Arabic broadcaster for FIFA World Cup 2026
  {
    id: 'ssc', name: 'SSC (Saudi Sports)', short: 'SSC', category: 'arabic',
    keywords: [
      'ssc 1', 'ssc1', 'ssc 2', 'ssc2', 'ssc 3', 'ssc3', 'ssc 4', 'ssc4', 'ssc 5', 'ssc5',
      'ssc sport', 'ssc sports', 'saudi sports channel',
      'ar: ssc', 'ar ssc', '[ar] ssc', '|ar| ssc',
      'ksa: ssc', 'sa: ssc',
    ],
  },
  // Alkass — Qatar Sports Channel, also broadcasts World Cup 2026
  {
    id: 'alkass', name: 'Alkass Sports', short: 'AK', category: 'arabic',
    keywords: [
      'alkass', 'al kass', 'al-kass', 'alkass one', 'alkass two', 'alkass three', 'alkass four',
      'alkass 1', 'alkass 2', 'alkass 3', 'alkass 4',
      'kass sport', 'alkass sport', 'qatar sport',
      'ar: alkass', 'ar alkass', '[ar] alkass',
    ],
  },
  // TRT Spor — Turkish national broadcaster for World Cup (Turkey participating 2026)
  {
    id: 'trt_spor', name: 'TRT Spor', short: 'TRT', category: 'soccer',
    keywords: ['trt spor', 'trt1', 'trt 1', 'tr: trt', 'trt sport', 'trt yildiz'],
  },
  {
    id: 'eredivisie', name: 'Eredivisie', short: 'ERE', category: 'soccer',
    keywords: ['eredivisie', 'dutch football', 'netherlands football'],
  },
  {
    id: 'primeira_liga', name: 'Primeira Liga', short: 'PL', category: 'soccer',
    keywords: ['primeira liga', 'liga portugal', 'portuguese football', 'liga nos', 'sport tv portugal'],
  },
  {
    id: 'super_lig', name: 'Süper Lig', short: 'SL', category: 'soccer',
    keywords: ['super lig', 'süper lig', 'turkish football', 'bein turkey'],
  },
  {
    id: 'african_football', name: 'African Football', short: 'CAF', category: 'soccer',
    keywords: ['afcon', 'africa cup', 'caf champions', 'caf cl', 'caf confederations', 'supersport africa'],
  },
  {
    id: 'copa_libertadores', name: 'Copa Libertadores', short: 'LIB', category: 'soccer',
    keywords: ['copa libertadores', 'libertadores', 'copa sudamericana', 'conmebol'],
  },
  {
    id: 'supersport', name: 'SuperSport', short: 'SS', category: 'soccer',
    keywords: ['supersport', 'super sport', 'dstv sport'],
  },
  // ── US sports ──
  {
    id: 'espn', name: 'ESPN', short: 'ESPN', category: 'us-sport',
    keywords: ['espn', 'espn2', 'espn 2', 'espnews', 'espn+', 'espn plus', 'espn deportes', 'espn u', 'espnu'],
    broadcasters: ['ESPN', 'ESPN+', 'ESPN2'],
  },
  {
    id: 'fox_sports', name: 'Fox Sports', short: 'FOX', category: 'us-sport',
    keywords: ['fox sport', 'fox sports', 'fs1', 'fs2', 'fox soccer', 'fox deportes'],
    broadcasters: ['Fox Sports', 'FS1', 'FS2'],
  },
  {
    id: 'nbc_sports', name: 'NBC Sports', short: 'NBC', category: 'us-sport',
    keywords: ['nbc sport', 'nbc sports', 'nbcsn', 'peacock sport', 'nbc gold'],
    broadcasters: ['NBC Sports', 'NBC Sports Network', 'Peacock'],
  },
  {
    id: 'cbs_sports', name: 'CBS Sports', short: 'CBS', category: 'us-sport',
    keywords: ['cbs sport', 'cbs sports', 'paramount sport', 'cbs sports hq'],
    broadcasters: ['CBS Sports', 'CBS Sports Network', 'Paramount+'],
  },
  {
    id: 'nba', name: 'NBA', short: 'NBA', category: 'us-sport',
    keywords: ['nba ', 'nba tv', 'nba league pass', 'nba hd', 'nba g league'],
  },
  {
    id: 'nfl', name: 'NFL', short: 'NFL', category: 'us-sport',
    keywords: ['nfl ', 'nfl network', 'nfl hd', 'nfl sunday ticket', 'nfl game pass'],
  },
  {
    id: 'nfl_redzone', name: 'NFL RedZone', short: 'RZ', category: 'us-sport',
    keywords: ['redzone', 'red zone'],
  },
  {
    id: 'nhl', name: 'NHL', short: 'NHL', category: 'us-sport',
    keywords: ['nhl ', 'nhl network', 'nhl hd', 'nhl tv', 'hockey night'],
  },
  {
    id: 'mlb', name: 'MLB', short: 'MLB', category: 'us-sport',
    keywords: ['mlb ', 'mlb network', 'mlb hd', 'mlb tv', 'mlb extra innings'],
  },
  {
    id: 'bally_sports', name: 'Bally Sports', short: 'BSN', category: 'us-sport',
    keywords: ['bally sport', 'bally sports', 'fanduel sports network'],
  },
  {
    id: 'tennis', name: 'Tennis Channel', short: 'TEN', category: 'us-sport',
    keywords: ['tennis channel', 'tennis hd', 'atp tennis', 'wta tennis', 'tennis tv',
      'wimbledon', 'us open tennis', 'french open', 'australian open',
      'roland garros', 'atp tour', 'wta tour'],
  },
  {
    id: 'golf', name: 'Golf Channel', short: 'GLF', category: 'us-sport',
    keywords: ['golf channel', 'golf tv', 'sky golf', 'pga tour', 'masters golf',
      'the open golf', 'ryder cup', 'golf live'],
  },
  {
    id: 'prime_sport', name: 'Prime Video Sport', short: 'PVS', category: 'us-sport',
    keywords: ['prime video sport', 'prime sport', 'amazon sport', 'amazon prime sport',
      'prime video nfl', 'prime video ucl', 'prime video ligue'],
    broadcasters: ['Amazon Prime Video', 'Prime Video'],
  },
  {
    id: 'cricket', name: 'Cricket', short: 'CRK', category: 'us-sport',
    keywords: ['cricket', 'star sports cricket', 'sky sports cricket', 'willow cricket',
      'willow tv', 'sony ten', 'sony six cricket', 'espn cricinfo', 'icc cricket',
      'test match', 'odi ', 't20 ', 'ipl ', 'indian premier league', 'big bash',
      'cpl cricket', 'the hundred', 'county cricket'],
  },
  {
    id: 'dazn', name: 'DAZN', short: 'DAZN', category: 'us-sport',
    keywords: ['dazn'],
    broadcasters: ['DAZN'],
  },
  {
    id: 'eurosport', name: 'Eurosport', short: 'EURO', category: 'us-sport',
    keywords: ['eurosport', 'eurosport 1', 'eurosport 2', 'discovery+ sport', 'gcn+ ', 'cycling tv'],
  },
  {
    id: 'axs_wrestling', name: 'Wrestling AXS', short: 'AXS', category: 'combat',
    keywords: ['axs tv', 'njpw', 'new japan pro', 'impact wrestling', 'tna '],
  },
  // ── News ──
  {
    id: 'cnn', name: 'CNN', short: 'CNN', category: 'news',
    keywords: ['cnn', 'cnn international', 'cnn hd'],
  },
  {
    id: 'bbc_news', name: 'BBC News', short: 'BBC', category: 'news',
    keywords: ['bbc news', 'bbc world', 'bbc world news'],
  },
  {
    id: 'fox_news', name: 'Fox News', short: 'FXN', category: 'news',
    keywords: ['fox news', 'fox business'],
  },
  {
    id: 'msnbc', name: 'MSNBC', short: 'MSN', category: 'news',
    keywords: ['msnbc'],
  },
  {
    id: 'sky_news', name: 'Sky News', short: 'SKN', category: 'news',
    keywords: ['sky news', 'sky news arabia'],
  },
  {
    id: 'al_jazeera', name: 'Al Jazeera', short: 'AJ', category: 'news',
    keywords: ['al jazeera', 'aljazeera', 'jazeera', 'al jazeera english', 'al jazeera arabic'],
  },
  {
    id: 'cnbc', name: 'CNBC', short: 'CNBC', category: 'news',
    keywords: ['cnbc', 'cnbc international', 'cnbc arabic'],
  },
  {
    id: 'bloomberg', name: 'Bloomberg', short: 'BLM', category: 'news',
    keywords: ['bloomberg', 'bloomberg tv'],
  },
  {
    id: 'france24', name: 'France 24', short: 'F24', category: 'news',
    keywords: ['france 24', 'france24'],
  },
  {
    id: 'dw_news', name: 'DW News', short: 'DW', category: 'news',
    keywords: ['dw news', 'deutsche welle', ' dw '],
  },
  {
    id: 'euronews', name: 'Euronews', short: 'EN', category: 'news',
    keywords: ['euronews', 'euro news'],
  },
  {
    id: 'rt_news', name: 'RT News', short: 'RT', category: 'news',
    keywords: ['rt news', 'russia today'],
  },
  {
    id: 'trt_world', name: 'TRT World', short: 'TRT', category: 'news',
    keywords: ['trt world', 'trt haber'],
  },
  {
    id: 'sky_sports_news', name: 'Sky Sports News', short: 'SSN', category: 'news',
    keywords: ['sky sports news', 'ssn '],
  },
  {
    id: 'alarabiya', name: 'Al Arabiya', short: 'ARB', category: 'news',
    keywords: ['al arabiya', 'alarabiya', 'arabiya'],
  },
  // ── UK general ──
  {
    id: 'bbc_one', name: 'BBC One', short: 'BBC1', category: 'uk-general',
    keywords: ['bbc one', 'bbc1', 'bbc 1'],
  },
  {
    id: 'bbc_two', name: 'BBC Two', short: 'BBC2', category: 'uk-general',
    keywords: ['bbc two', 'bbc2', 'bbc 2'],
  },
  {
    id: 'itv', name: 'ITV', short: 'ITV', category: 'uk-general',
    keywords: ['itv1', 'itv 1', 'itv2', 'itv 2', 'itv3', 'itv 3', 'itv4', 'itv 4', 'itv hd', 'itvx'],
  },
  {
    id: 'channel_4', name: 'Channel 4', short: 'CH4', category: 'uk-general',
    keywords: ['channel 4', 'channel4', 'ch4 ', 'e4 ', ' e4', 'more4'],
  },
  {
    id: 'channel_5', name: 'Channel 5', short: 'CH5', category: 'uk-general',
    keywords: ['channel 5', 'channel5', 'ch5 ', '5star', '5 star', '5usa'],
  },
  // ── Movies / premium ──
  {
    id: 'hbo', name: 'HBO', short: 'HBO', category: 'movies',
    keywords: ['hbo', 'hbo max', 'max originals', 'hbo signature', 'hbo family'],
  },
  {
    id: 'showtime', name: 'Showtime', short: 'SHO', category: 'movies',
    keywords: ['showtime', 'showtime 2'],
  },
  {
    id: 'starz', name: 'Starz', short: 'STZ', category: 'movies',
    keywords: ['starz', 'starz encore'],
  },
  {
    id: 'cinemax', name: 'Cinemax', short: 'CMX', category: 'movies',
    keywords: ['cinemax', 'max prime'],
  },
  {
    id: 'paramount', name: 'Paramount', short: 'PAR', category: 'movies',
    keywords: ['paramount network', 'paramount+', 'paramount plus', 'paramount channel'],
  },
  {
    id: 'amc', name: 'AMC', short: 'AMC', category: 'movies',
    keywords: [' amc ', 'amc hd', 'amc usa', 'amc network', 'amc+'],
  },
  {
    id: 'fx', name: 'FX', short: 'FX', category: 'movies',
    keywords: [' fx ', 'fx hd', 'fxx', 'fx usa', 'fx movie'],
  },
  {
    id: 'tbs', name: 'TBS / TNT Drama', short: 'TBS', category: 'movies',
    keywords: ['tbs ', 'tbs hd', 'tnt drama'],
  },
  {
    id: 'usa_network', name: 'USA Network', short: 'USA', category: 'movies',
    keywords: ['usa network', ' usa hd', 'usa channel'],
  },
  {
    id: 'syfy', name: 'Syfy', short: 'SYFY', category: 'movies',
    keywords: ['syfy', 'sci fi', 'sci-fi'],
  },
  {
    id: 'lifetime', name: 'Lifetime', short: 'LIFE', category: 'movies',
    keywords: ['lifetime', 'lifetime movie'],
  },
  {
    id: 'hallmark', name: 'Hallmark', short: 'HLM', category: 'movies',
    keywords: ['hallmark', 'hallmark channel', 'hallmark movies'],
  },
  {
    id: 'tcm', name: 'TCM', short: 'TCM', category: 'movies',
    keywords: ['tcm ', 'turner classic'],
  },
  {
    id: 'sky_cinema', name: 'Sky Cinema', short: 'SCIN', category: 'movies',
    keywords: ['sky cinema', 'sky movies', 'sky cinema premiere', 'sky cinema action',
      'sky cinema comedy', 'sky cinema drama'],
  },
  {
    id: 'osn_movies', name: 'OSN Movies', short: 'OSNM', category: 'movies',
    keywords: ['osn movies', 'osn cinema', 'osn series', 'osn streaming'],
  },
  // ── Documentary ──
  {
    id: 'discovery', name: 'Discovery', short: 'DISC', category: 'documentary',
    keywords: ['discovery', 'discovery+', 'discovery channel'],
    exclude: ['kids'],
  },
  {
    id: 'history', name: 'History', short: 'HIST', category: 'documentary',
    keywords: ['history channel', 'history hd', 'history us', 'history uk', ' hist '],
  },
  {
    id: 'nat_geo', name: 'Nat Geo', short: 'NATGEO', category: 'documentary',
    keywords: ['national geographic', 'nat geo', 'natgeo', 'nat-geo', 'nat geo wild'],
  },
  {
    id: 'animal_planet', name: 'Animal Planet', short: 'AP', category: 'documentary',
    keywords: ['animal planet'],
  },
  {
    id: 'tlc', name: 'TLC', short: 'TLC', category: 'documentary',
    keywords: ['tlc '],
  },
  {
    id: 'food_network', name: 'Food Network', short: 'FOOD', category: 'documentary',
    keywords: ['food network', 'food channel'],
  },
  {
    id: 'hgtv', name: 'HGTV', short: 'HGTV', category: 'documentary',
    keywords: ['hgtv'],
  },
  {
    id: 'investigation', name: 'Investigation Discovery', short: 'ID', category: 'documentary',
    keywords: ['investigation discovery', ' id channel', ' id hd', 'id usa'],
  },
  // ── Kids ──
  {
    id: 'cartoon_network', name: 'Cartoon Network', short: 'CN', category: 'kids',
    keywords: ['cartoon network', 'cartoonnetwork', ' cn hd'],
  },
  {
    id: 'disney', name: 'Disney Channel', short: 'DSN', category: 'kids',
    keywords: ['disney channel', 'disney hd', 'disney xd', 'disney junior', 'disney jr'],
    exclude: ['disney+', 'disney plus'],
  },
  {
    id: 'nickelodeon', name: 'Nickelodeon', short: 'NICK', category: 'kids',
    keywords: ['nickelodeon', 'nick jr', 'nick hd', 'nicktoons', 'nick '],
  },
  {
    id: 'boomerang', name: 'Boomerang', short: 'BOOM', category: 'kids',
    keywords: ['boomerang'],
  },
  {
    id: 'pbs_kids', name: 'PBS Kids', short: 'PBS', category: 'kids',
    keywords: ['pbs kids', 'pbs hd', ' pbs '],
  },
  {
    id: 'baby_tv', name: 'Baby TV', short: 'BTV', category: 'kids',
    keywords: ['baby tv', 'baby channel'],
  },
  {
    id: 'spacetoon', name: 'Spacetoon', short: 'SPC', category: 'kids',
    keywords: ['spacetoon'],
  },
  // ── Music ──
  {
    id: 'mtv', name: 'MTV', short: 'MTV', category: 'music',
    keywords: [' mtv ', 'mtv hd', 'mtv usa', 'mtv uk', 'mtv live', 'mtv 80s', 'mtv 90s',
      'mtv hits', 'mtv music'],
  },
  {
    id: 'vh1', name: 'VH1', short: 'VH1', category: 'music',
    keywords: ['vh1', 'vh-1'],
  },
  {
    id: 'bet', name: 'BET', short: 'BET', category: 'music',
    keywords: ['bet ', 'bet hd', 'bet hip', 'bet usa'],
  },
  // ── Entertainment ──
  {
    id: 'comedy_central', name: 'Comedy Central', short: 'CC', category: 'entertainment',
    keywords: ['comedy central', 'comedy central hd'],
  },
  {
    id: 'adult_swim', name: 'Adult Swim', short: 'AS', category: 'entertainment',
    keywords: ['adult swim'],
  },
  {
    id: 'telemundo', name: 'Telemundo', short: 'TLM', category: 'entertainment',
    keywords: ['telemundo'],
  },
  {
    id: 'univision', name: 'Univision', short: 'UNI', category: 'entertainment',
    keywords: ['univision', 'unimas'],
  },
  {
    id: 'tudn', name: 'TUDN', short: 'TUDN', category: 'entertainment',
    keywords: ['tudn'],
  },
  // ── Arabic ──
  {
    id: 'mbc', name: 'MBC', short: 'MBC', category: 'arabic',
    keywords: ['mbc1', 'mbc 1', 'mbc2', 'mbc 2', 'mbc3', 'mbc 3', 'mbc4', 'mbc 4',
      'mbc action', 'mbc max', 'mbc drama', 'mbc bollywood', 'mbc persia', 'mbc masr', 'mbc مصر'],
  },
  {
    id: 'rotana', name: 'Rotana', short: 'ROT', category: 'arabic',
    keywords: ['rotana', 'rotana cinema', 'rotana khalijiah', 'rotana music', 'rotana klassik'],
  },
  {
    id: 'osn', name: 'OSN', short: 'OSN', category: 'arabic',
    keywords: ['osn', 'osn hd', 'osn yahala', 'osn living'],
  },
  {
    id: 'abu_dhabi', name: 'Abu Dhabi TV', short: 'ADTV', category: 'arabic',
    keywords: ['abu dhabi tv', 'ad sport', 'ad sports', 'abu dhabi sport'],
  },
  {
    id: 'dubai_tv', name: 'Dubai TV', short: 'DXB', category: 'arabic',
    keywords: ['dubai tv', 'dubai one', 'dubai sport'],
  },
  {
    id: 'saudi_tv', name: 'Saudi TV', short: 'STV', category: 'arabic',
    keywords: ['saudi tv', 'ksa sport', 'ksa sports', 'saudi sport'],
  },
  {
    id: 'almajd', name: 'Al Majd', short: 'MAJ', category: 'arabic',
    keywords: ['al majd', 'almajd', 'majd quran', 'majd kids'],
  },
  // ── Indian ──
  {
    id: 'star_plus', name: 'Star Plus', short: 'STR', category: 'indian',
    keywords: ['star plus', 'star+', 'star sports india', 'star sports 1', 'star sports 2', 'star gold'],
  },
  {
    id: 'zee_tv', name: 'Zee TV', short: 'ZEE', category: 'indian',
    keywords: ['zee tv', 'zee cinema', 'zee anmol', 'zee news', 'zee entertainment'],
  },
  {
    id: 'sony_india', name: 'Sony (India)', short: 'SNY', category: 'indian',
    keywords: ['sony tv', 'sony max', 'sony sab', 'sony six', 'sony pix', 'sony ten', 'sony liv'],
  },
  {
    id: 'colors', name: 'Colors', short: 'CLR', category: 'indian',
    keywords: ['colors tv', 'colors hd', 'colors cineplex', 'colors rishtey'],
  },
  {
    id: 'sun_tv', name: 'Sun TV', short: 'SUN', category: 'indian',
    keywords: ['sun tv', 'sun news', 'sun music', 'surya tv', 'kiran tv'],
  },
  {
    id: 'aaj_tak', name: 'Aaj Tak', short: 'AAJ', category: 'indian',
    keywords: ['aaj tak', 'india today', 'india news'],
  },
];
