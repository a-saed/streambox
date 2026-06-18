import { HUB_CHANNELS, matchesChannel } from './channelHub';
import { addUrls, type PoolSource } from './sportsPool';

// Direct DaddyLive channel ID → hub channel ID for known beIN Sports / Arabic channels.
// Extracted from the /api/daddylive/:id URL so this is O(1) and unambiguous.
// IDs are stable across DL scrapes; names can change formatting at any time.
const DL_ID_TO_HUB: Record<number, string> = {
  61:  'bein_mena',   // beIN Sports Mena English 1
  90:  'bein_mena',   // beIN Sports Mena English 2
  91:  'bein_ar_1',   // beIN Sports 1 Arabic
  92:  'bein_ar_2',   // beIN Sports 2 Arabic
  93:  'bein_ar_3',   // beIN Sports 3 Arabic
  94:  'bein_ar_4',   // beIN Sports 4 Arabic
  95:  'bein_ar_5',   // beIN Sports 5 Arabic
  96:  'bein_ar_6',   // beIN Sports 6 Arabic
  97:  'bein_ar_7',   // beIN Sports 7 Arabic
  98:  'bein_ar_8',   // beIN Sports 8 Arabic
  99:  'bein_ar_9',   // beIN Sports 9 Arabic
  100: 'bein_xtra',   // beIN Sports Xtra 1
  578: 'bein_ar_1',   // beIN Sports HD Qatar — alternate feed, adds a second source
  597: 'bein_max_1',  // beIN Sports Max AR
};

function _extractDLId(url: string): number | null {
  const m = /^\/api\/daddylive\/(\d+)/.exec(url);
  return m ? parseInt(m[1], 10) : null;
}

export function mapDLChannelsToPool(
  channels: Array<{ name: string; url: string }>,
  source: PoolSource = 'daddylive',
): void {
  for (const ch of channels) {
    // ID-based lookup: fast, reliable, unaffected by name formatting changes
    const dlId = _extractDLId(ch.url);
    if (dlId !== null && DL_ID_TO_HUB[dlId]) {
      addUrls(DL_ID_TO_HUB[dlId], [{ url: ch.url, source }]);
      continue;
    }
    // Fallback: keyword matching for non-beIN channels (SSC, Al Kass, etc.)
    const hubCh = HUB_CHANNELS.find(h => matchesChannel(ch.name, h));
    if (hubCh) {
      addUrls(hubCh.id, [{ url: ch.url, source }]);
    }
  }
}
