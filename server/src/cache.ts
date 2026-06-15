import { Channel, EPGSchedule } from "./types";
import { parseM3U } from "./services/m3uParser";
import { parseEPG } from "./services/epgParser";

const DEFAULT_M3U_URLS = [
  "https://iptv-org.github.io/iptv/index.m3u",
  "https://iptv-org.github.io/iptv/categories/sports.m3u",
];

const M3U_URLS = process.env.M3U_URLS
  ? process.env.M3U_URLS.split(",").map((u) => u.trim()).filter(Boolean)
  : DEFAULT_M3U_URLS;
const REFRESH_MS = 60 * 60 * 1000; // 1 hour

let channels: Channel[] = [];
let epg: EPGSchedule = {};
let categories: string[] = [];

export const getChannels = (): Channel[] => channels;
export const getEPG = (): EPGSchedule => epg;
export const getCategories = (): string[] => categories;

async function fetchAndCacheEPG(): Promise<void> {
  const urls = [
    ...new Set(channels.filter((c) => c.tvgUrl).map((c) => c.tvgUrl!)),
  ];

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
    }),
  );

  epg = merged;
  console.log(`[cache] EPG loaded for ${Object.keys(epg).length} channels`);
}

async function fetchAndCacheChannels(): Promise<void> {
  try {
    const results = await Promise.allSettled(
      M3U_URLS.map((url) =>
        fetch(url, { signal: AbortSignal.timeout(30_000) })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          })
          .then((text) => parseM3U(text)),
      ),
    );

    const seen = new Set<string>();
    const merged: Channel[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const ch of result.value) {
          if (!seen.has(ch.url)) {
            seen.add(ch.url);
            merged.push(ch);
          }
        }
      }
    }

    channels = merged;
    categories = [...new Set(channels.map((c) => c.category))].sort();
    console.log(
      `[cache] Loaded ${channels.length} channels across ${categories.length} categories`,
    );
    await fetchAndCacheEPG();
  } catch (err) {
    console.error("[cache] Failed to load channels:", err);
  }
}

export async function initCache(): Promise<void> {
  await fetchAndCacheChannels();
  setInterval(fetchAndCacheChannels, REFRESH_MS).unref();
}
