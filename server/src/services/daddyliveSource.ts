// Scrapes the DaddyLive 24/7 channel list and assigns categories.
// No verification is done here — this is pure metadata discovery.

export interface DLChannelMeta {
  id:       number;
  name:     string;
  category: string;
  country:  string;
}

// ── Category inference ────────────────────────────────────────────────────────

const CAT_RULES: Array<{ re: RegExp; category: string }> = [
  // Arabic / MENA sports
  { re: /bein sports.*(arabic|arabia|ar\b|mena|xtra)|ssc sport|alkass|al kass|abu dhabi sports|arabsport|sport.*arabic/i, category: 'arabic' },
  // Football / soccer dedicated
  { re: /football|soccer|futbol|liga|premier.*league|champions.*league|serie.*a|bundesliga|ligue.*1|copa|eredivisie|mls|j\.?league/i, category: 'football' },
  // Cricket
  { re: /cricket|willow/i, category: 'cricket' },
  // Racing / motor sport
  { re: /f1|formula|motogp|nascar|racing|automoto/i, category: 'motorsport' },
  // General sports
  { re: /sport|espn|fox sport|eurosport|dazn|sky sport|bt sport|tnt sport|canal.*sport|bein|supersport|arena sport|astro|altitude|a spor/i, category: 'sports' },
  // News
  { re: /news|cnn|bbc|al jazeera|france 24|dw|sky news|euronews|rt |press tv/i, category: 'news' },
  // Entertainment / general
  { re: /.*/, category: 'entertainment' },  // catch-all
];

function inferCategory(name: string): string {
  for (const { re, category } of CAT_RULES) {
    if (re.test(name)) return category;
  }
  return 'entertainment';
}

// ── Country inference ─────────────────────────────────────────────────────────

const COUNTRY_SUFFIXES: Array<[RegExp, string]> = [
  [/\busa\b|\busa$|\bus\b.*(?:tv|sport|channel)|abc|nbc|cbs|fox|cnn|amc|hbo/i, 'US'],
  [/\buk\b|britain|england|sky.*sport|bt sport|itv|channel.*4/i, 'GB'],
  [/\bfrance\b|\bfr\b$|ligue|canal\+|tmc|m6\b/i, 'FR'],
  [/\bturkey\b|\bturk/i, 'TR'],
  [/\bserbia\b|\bserb/i, 'RS'],
  [/\bcroatia\b|\bcroat/i, 'HR'],
  [/\bportuguese?\b|\bportugal\b/i, 'PT'],
  [/\bspain\b|\bspanish\b|\bespana/i, 'ES'],
  [/\bgerman[y]?\b|\bde\b$|sport\d.*de\b/i, 'DE'],
  [/\bit[a]?[a-z]*\b.*(?:sport|sky)|serie.*a/i, 'IT'],
  [/\buae\b|abu dhabi/i, 'AE'],
  [/\bqatar\b|alkass|al kass/i, 'QA'],
  [/\bsaudi\b|\bksa\b|\bssc sport/i, 'SA'],
  [/\barab/i,                        'AR'],
  [/\bpakistan\b|\bpk\b$/i,          'PK'],
  [/\bmalay/i,                       'MY'],
  [/\bmex[ico]*/i,                   'MX'],
  [/\bbih\b/i,                       'BA'],
];

function inferCountry(name: string): string {
  for (const [re, cc] of COUNTRY_SUFFIXES) {
    if (re.test(name)) return cc;
  }
  return '';
}

// ── Title formatting ──────────────────────────────────────────────────────────

// Words that should be fully uppercased in display names
const ACRONYMS = new Set(['abc', 'ahc', 'amc', 'cnn', 'bbc', 'nbc', 'cbs', 'fox',
  'espn', 'nfl', 'nba', 'mlb', 'nhl', 'mls', 'tnt', 'tbs', 'hbo',
  'dazn', 'ssc', 'hd', 'sd', 'uk', 'usa', 'uae', 'ar',
  'bih', 'pk', 'de', 'fr', 'tv', '4k']);

// Words with specific mixed-case spellings
const MIXED_CASE: Record<string, string> = {
  bein: 'beIN',
};

function titleCase(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .split(' ')
    .map(w => {
      const l = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (MIXED_CASE[l]) return MIXED_CASE[l];
      if (ACRONYMS.has(l)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

// ── HTML parser ───────────────────────────────────────────────────────────────

export function parseChannelList(html: string): DLChannelMeta[] {
  const tokens = html.match(/watch\.php\?id=\d+|data-title="[^"]+"/g) ?? [];
  const result: DLChannelMeta[] = [];
  let pendingId: number | null = null;

  for (const tok of tokens) {
    if (tok.startsWith('watch.php?id=')) {
      pendingId = parseInt(tok.slice('watch.php?id='.length), 10);
    } else if (tok.startsWith('data-title="') && pendingId !== null) {
      const raw  = tok.slice('data-title="'.length, -1).trim();
      const name = titleCase(raw);
      result.push({
        id:       pendingId,
        name,
        category: inferCategory(raw),
        country:  inferCountry(raw),
      });
      pendingId = null;
    }
  }
  return result;
}

// ── Scraper ───────────────────────────────────────────────────────────────────

const LIST_URL = 'https://dlhd.pk/24-7-channels.php';
const UA       = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export async function scrapeDaddyliveChannels(): Promise<DLChannelMeta[]> {
  try {
    const r = await fetch(LIST_URL, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      signal:  AbortSignal.timeout(25_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const list = parseChannelList(html);
    console.log(`[daddylive] scraped ${list.length} channels from DaddyLive`);
    return list;
  } catch (e) {
    console.warn('[daddylive] channel list scrape failed:', (e as Error).message);
    return [];
  }
}
