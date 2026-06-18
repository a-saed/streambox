// Scrapes public Telegram channels for IPTV stream URLs.
// No bot token required — uses the public t.me/s/<channel> web view.
// Set TELEGRAM_CHANNELS=@channel1,@channel2,channel3 in .env.
// Optionally set TELEGRAM_BOT_TOKEN to also receive messages sent to the bot.

import { HUB_CHANNELS, matchesChannel } from './channelHub';
import { addUrls } from './sportsPool';

const SCRAPE_INTERVAL_MS = 60 * 60 * 1000; // re-scrape channels every hour
const BOT_POLL_INTERVAL  = 60_000;          // bot getUpdates every 60s
const URL_RE             = /https?:\/\/[^\s<>"'&\]]+/g;
const STREAM_PATTERNS    = [
  /\.m3u8?(\?|$|#)/i,
  /\.m3u(\?|$|#)/i,
  /\/get\.php\?/i,
  /\/live\//i,
  /\/hls\//i,
  /xtream/i,
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let _botLastUpdateId = 0;

function _looksLikeStream(url: string): boolean {
  return STREAM_PATTERNS.some(p => p.test(url));
}

function _matchToHub(url: string, context: string): string | null {
  const hub = HUB_CHANNELS.find(h => matchesChannel(context, h));
  if (hub) return hub.id;
  try {
    const seg = new URL(url).pathname.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
    return HUB_CHANNELS.find(h => matchesChannel(seg, h))?.id ?? null;
  } catch { return null; }
}

async function _addIfAlive(url: string, context: string): Promise<void> {
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok && r.status !== 206 && r.status !== 302) return;
    const channelId = _matchToHub(url, context);
    if (!channelId) return;
    addUrls(channelId, [{ url, source: 'telegram' }]);
    console.log(`[telegram] ${url.slice(0, 70)} → ${channelId}`);
  } catch { /* dead link — ignore */ }
}

// ── Public channel scraping (no bot token) ────────────────────────────────────
// t.me/s/<username> returns a static HTML page of recent posts — parseable
// without executing JavaScript or having any special credentials.
// ─────────────────────────────────────────────────────────────────────────────
async function _scrapePublicChannel(channelName: string): Promise<void> {
  const name = channelName.replace(/^@/, '');
  const url  = `https://t.me/s/${name}`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      console.warn(`[telegram] ${channelName}: HTTP ${r.status}`);
      return;
    }
    const html = await r.text();

    // Extract text from message divs
    const blocks: string[] = [];
    for (const m of html.matchAll(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g)) {
      blocks.push(m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)));
    }
    // Also grab raw URLs from <a href> tags in messages
    for (const m of html.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>/gi)) {
      if (_looksLikeStream(m[1])) blocks.push(m[1]);
    }

    let found = 0;
    for (const block of blocks) {
      for (const rawUrl of block.match(URL_RE) ?? []) {
        if (_looksLikeStream(rawUrl)) {
          await _addIfAlive(rawUrl, block);
          found++;
        }
      }
    }
    if (found > 0) console.log(`[telegram] ${channelName}: found ${found} stream URL(s)`);
    else           console.log(`[telegram] ${channelName}: no stream URLs in current posts`);
  } catch (e) {
    console.warn(`[telegram] ${channelName}: scrape error —`, (e as Error).message);
  }
}

// ── Bot getUpdates mode (requires TELEGRAM_BOT_TOKEN) ─────────────────────────
async function _pollBot(token: string, allowedChatIds: Set<string>): Promise<void> {
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${_botLastUpdateId + 1}&limit=100&timeout=0&allowed_updates=["message","channel_post"]`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!r.ok) return;
    const data = await r.json() as {
      ok: boolean;
      result: Array<{
        update_id: number;
        message?:      { chat: { id: number; username?: string }; text?: string; caption?: string };
        channel_post?: { chat: { id: number; username?: string }; text?: string; caption?: string };
      }>;
    };
    if (!data.ok || !data.result.length) return;
    _botLastUpdateId = data.result.at(-1)!.update_id;

    for (const upd of data.result) {
      const msg = upd.message ?? upd.channel_post;
      if (!msg) continue;

      // Filter to configured channels (empty set = accept all)
      if (allowedChatIds.size > 0) {
        const chatKey = String(msg.chat.id);
        const uname   = msg.chat.username ? `@${msg.chat.username}` : '';
        if (!allowedChatIds.has(chatKey) && !allowedChatIds.has(uname)) continue;
      }

      const text = msg.text ?? msg.caption ?? '';
      for (const rawUrl of text.match(URL_RE) ?? []) {
        if (_looksLikeStream(rawUrl)) await _addIfAlive(rawUrl, text);
      }
    }
  } catch (e) {
    console.warn('[telegram] bot poll error:', (e as Error).message);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
export function startTelegramSource(): void {
  const raw = process.env.TELEGRAM_CHANNELS ?? '';
  const channelList = raw.split(',').map(c => c.trim()).filter(Boolean);
  if (!channelList.length) return;

  const token = process.env.TELEGRAM_BOT_TOKEN;

  // Separate public channel names (@username) from numeric chat IDs
  const publicChannels = channelList.filter(c => c.startsWith('@') || !/^-?\d+$/.test(c));
  const chatIds        = new Set(channelList.filter(c => /^-?\d+$/.test(c)));

  if (publicChannels.length) {
    console.log(`[telegram] Scraping ${publicChannels.length} public channel(s): ${publicChannels.join(', ')}`);
    // Scrape immediately on startup, then every hour
    Promise.allSettled(publicChannels.map(_scrapePublicChannel)).catch(console.error);
    setInterval(
      () => Promise.allSettled(publicChannels.map(_scrapePublicChannel)).catch(console.error),
      SCRAPE_INTERVAL_MS,
    ).unref();
  }

  if (token) {
    const label = chatIds.size ? `${chatIds.size} chat ID(s)` : 'all chats';
    console.log(`[telegram] Bot mode active — monitoring ${label}`);
    // Poll immediately, then every minute
    _pollBot(token, chatIds).catch(console.error);
    setInterval(() => _pollBot(token, chatIds).catch(console.error), BOT_POLL_INTERVAL).unref();
  } else if (!publicChannels.length) {
    console.warn('[telegram] TELEGRAM_CHANNELS is set but no @usernames or bot token — nothing to poll');
  }
}
