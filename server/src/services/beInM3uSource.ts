import { parseM3U } from './m3uParser';
import { checkUrl } from './aliveChecker';
import { HUB_CHANNELS, matchesChannel } from './channelHub';
import { addUrls } from './sportsPool';

const REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;
const ALIVE_CONCURRENCY   = 20;

const SOURCES = [
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/ar.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/sa.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/qa.m3u',
  'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
];

export async function loadBeInM3uSources(): Promise<void> {
  const results = await Promise.allSettled(
    SOURCES.map(url =>
      fetch(url, { signal: AbortSignal.timeout(30_000) })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then(text => parseM3U(text))
    )
  );

  const all: Array<{ name: string; url: string }> = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      all.push(...result.value);
    }
  }

  const candidates: Array<{ hubId: string; url: string }> = [];
  for (const ch of all) {
    const hubCh = HUB_CHANNELS.find(h => matchesChannel(ch.name, h));
    if (hubCh) candidates.push({ hubId: hubCh.id, url: ch.url });
  }

  if (!candidates.length) {
    console.log('[beInM3u] No matching channels found in M3U sources');
    return;
  }

  let added = 0;
  const sem = _semaphore(ALIVE_CONCURRENCY);
  await Promise.all(candidates.map(c =>
    sem(async () => {
      const alive = await checkUrl(c.url);
      if (alive) {
        addUrls(c.hubId, [{ url: c.url, source: 'm3u' }]);
        added++;
      }
    })
  ));

  console.log(`[beInM3u] Added ${added}/${candidates.length} live channels to sports pool`);
}

export function startBeInM3uRefresh(): void {
  setInterval(() => loadBeInM3uSources().catch(console.error), REFRESH_INTERVAL_MS).unref();
}

function _semaphore(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  function next() {
    if (queue.length && active < concurrency) { active++; queue.shift()!(); }
  }
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject).finally(() => { active--; next(); }));
      next();
    });
  };
}
