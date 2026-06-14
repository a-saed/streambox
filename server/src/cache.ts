import { Channel, EPGSchedule } from './types';
import { parseM3U } from './services/m3uParser';
import { parseEPG } from './services/epgParser';

const M3U_URL = 'https://iptv-org.github.io/iptv/index.m3u';
const REFRESH_MS = 60 * 60 * 1000; // 1 hour

let channels: Channel[] = [];
let epg: EPGSchedule = {};
let categories: string[] = [];

export const getChannels   = (): Channel[]    => channels;
export const getEPG        = (): EPGSchedule  => epg;
export const getCategories = (): string[]     => categories;

async function fetchAndCacheEPG(): Promise<void> {
  const urls = [...new Set(channels.filter(c => c.tvgUrl).map(c => c.tvgUrl!))];

  const merged: EPGSchedule = {};
  await Promise.allSettled(
    urls.slice(0, 10).map(async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return;
        const xml = await res.text();
        const schedule = await parseEPG(xml);
        Object.assign(merged, schedule);
      } catch {
        // silently skip unreachable EPG sources
      }
    })
  );

  epg = merged;
  console.log(`[cache] EPG loaded for ${Object.keys(epg).length} channels`);
}

async function fetchAndCacheChannels(): Promise<void> {
  try {
    const res = await fetch(M3U_URL, { signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    channels = parseM3U(text);
    categories = [...new Set(channels.map(c => c.category))].sort();
    console.log(`[cache] Loaded ${channels.length} channels across ${categories.length} categories`);
    await fetchAndCacheEPG();
  } catch (err) {
    console.error('[cache] Failed to load channels:', err);
  }
}

export async function initCache(): Promise<void> {
  await fetchAndCacheChannels();
  setInterval(fetchAndCacheChannels, REFRESH_MS);
}
