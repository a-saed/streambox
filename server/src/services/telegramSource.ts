import { HUB_CHANNELS, matchesChannel } from './channelHub';
import { addUrls } from './sportsPool';

const TELEGRAM_API      = 'https://api.telegram.org';
const POLL_INTERVAL_MS  = 60_000;
const URL_RE            = /https?:\/\/[^\s<>"']+/g;
const STREAM_PATTERNS   = [
  /\.m3u8?(\?|$|#)/i,
  /\.m3u(\?|$|#)/i,
  /\/get\.php\?/i,
  /\/live\//i,
  /\/hls\//i,
  /xtream/i,
];

let _lastUpdateId = 0;

function _looksLikeStream(url: string): boolean {
  return STREAM_PATTERNS.some(p => p.test(url));
}

function _matchToHubChannel(url: string, msgText: string): string | null {
  const urlIndex = msgText.indexOf(url);
  const context  = msgText.slice(Math.max(0, urlIndex - 60), urlIndex + 60);

  const hub = HUB_CHANNELS.find(h => matchesChannel(context, h));
  if (hub) return hub.id;

  try {
    const segment = new URL(url).pathname.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
    return HUB_CHANNELS.find(h => matchesChannel(segment, h))?.id ?? null;
  } catch {
    return null;
  }
}

async function _processUrl(url: string, msgText: string): Promise<void> {
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20' },
      signal: AbortSignal.timeout(5_000),
    });
    const alive = r.ok || r.status === 206 || r.status === 302;
    if (!alive) return;

    const channelId = _matchToHubChannel(url, msgText);
    if (!channelId) return;

    addUrls(channelId, [{ url, source: 'telegram' }]);
    console.log(`[telegram] ${url.slice(0, 60)} → ${channelId}`);
  } catch { /* ignore — connection errors are expected for dead links */ }
}

async function _poll(token: string): Promise<void> {
  try {
    const r = await fetch(
      `${TELEGRAM_API}/bot${token}/getUpdates?offset=${_lastUpdateId + 1}&limit=100&timeout=0`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!r.ok) return;

    const data = await r.json() as {
      ok: boolean;
      result: Array<{ update_id: number; message?: { text?: string; caption?: string } }>;
    };
    if (!data.ok || !data.result.length) return;

    _lastUpdateId = data.result[data.result.length - 1].update_id;

    for (const update of data.result) {
      const text = update.message?.text ?? update.message?.caption ?? '';
      if (!text) continue;
      const urls = text.match(URL_RE) ?? [];
      for (const url of urls) {
        if (_looksLikeStream(url)) {
          _processUrl(url, text).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.warn('[telegram] poll error:', (e as Error).message);
  }
}

export function startTelegramSource(): void {
  const token    = process.env.TELEGRAM_BOT_TOKEN;
  const channels = process.env.TELEGRAM_CHANNELS;
  if (!token || !channels) return;
  console.log('[telegram] Telegram source active — polling every 60s');
  setInterval(() => _poll(token).catch(console.error), POLL_INTERVAL_MS).unref();
}
