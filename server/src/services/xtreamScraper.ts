import { createHmac, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { IptvPortal } from '../types';

const SCRAPER_UA = 'Mozilla/5.0 (Linux; Android 11; PlayTorrio) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

// ── Regex patterns for extracting credentials ────────────────────────────────

/** Matches: http://host:port/get.php?username=X&password=Y */
const URL_PARAM_RE = /(https?:\/\/[^?\s"'<]+)\?(?:[^\s"'<]*?&)?(?:username|user)=([^&\s"'<]+)(?:&[^\s"'<]*?)?[&\s](?:password|pass)=([^&\s"'<]+)/gi;

/** Matches label-style posts: Host: ... / Username: ... / Password: ... */
const LABEL_RE = /(?:Portal|Host(?:\s*URL)?|URL|Panel|Real)\W{0,10}?(https?:\/\/[^\s"'<]{8,})[\s\S]{1,500}?(?:Username|User)\W{0,10}?([^\s|"'\n<]{3,60})[\s\S]{1,200}?(?:Password|Pass)\W{0,10}?([^\s|"'\n<]{3,60})/gi;

const BASE64_RE = /aHR0c[a-zA-Z0-9+/=]{10,}/g;
const RAW_PASTE_RE = /https?:\/\/(?:paste\.sh|pastebin\.com|justpaste\.it|pastes\.dev|rentry\.co)\/[a-zA-Z0-9#_=-]+/gi;

const JUNK_MARKERS = ['Array.isArray', 'prototype.', 'function(', 'var ', 'const ', 'let ', 'return!', 'void ', 'window.', 'document.'];

function isJunk(text: string): boolean {
  let hits = 0;
  for (const m of JUNK_MARKERS) { if (text.includes(m) && ++hits >= 2) return true; }
  return false;
}

function cleanPortalUrl(raw: string): string {
  let url = raw.replace(/\s+/g, '');
  const q = url.indexOf('?');
  if (q >= 0) url = url.slice(0, q);
  url = url.replace(/\/(?:get|live|portal|c|index|playlist|player_api|xmltv)(?:\.php)?$/i, '');
  url = url.replace(/\/+$/, '');
  if (!url.startsWith('http')) url = `http://${url}`;
  return url;
}

function cleanCred(raw: string): string {
  let s = raw.replace(/^=+/, '');
  const stop = s.search(/[\s&?]/);
  return stop >= 0 ? s.slice(0, stop).trim() : s.trim();
}

export function extractPortals(text: string, source: string): IptvPortal[] {
  if (text.length < 15 || isJunk(text)) return [];

  const cleaned = text
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/<(?:p|br|div|li|h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  const seen = new Set<string>();
  const portals: IptvPortal[] = [];

  function add(rawUrl: string, rawUser: string, rawPass: string) {
    const url = cleanPortalUrl(rawUrl);
    const username = cleanCred(rawUser);
    const password = cleanCred(rawPass);
    if (!url || username.length < 3 || password.length < 3) return;
    if (username.includes('http') || password.includes('http')) return;
    const key = `${url}|${username}|${password}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    portals.push({ url, username, password, source });
  }

  for (const m of cleaned.matchAll(URL_PARAM_RE)) add(m[1], m[2], m[3]);
  for (const m of cleaned.matchAll(LABEL_RE)) add(m[1], m[2], m[3]);
  return portals;
}

// ── Xtreamity R2 (pre-validated portal database) ─────────────────────────────

const XTREAMITY_HOST   = '145ef3f7a9832804bef0e31548db8a83.r2.cloudflarestorage.com';
const XTREAMITY_BUCKET = 'xtreamity';
const XTREAMITY_OBJECT = 'xtreamity-plus-db.csv.gz';
const XTREAMITY_AK = process.env.XTREAMITY_ACCESS_KEY ?? '4b36152b6b64b8a9f4d7010b84f535fc';
const XTREAMITY_SK = process.env.XTREAMITY_SECRET_KEY ?? '7ad1ed517b6baa6af2fa00d50a1a18b0ce416bb0b6fb14f4c122a2960f1ab9bc';
const XTREAMITY_TTL      = 6  * 60 * 60 * 1000;
const XTREAMITY_FAIL_TTL = 24 * 60 * 60 * 1000; // if endpoint returns 4xx, don't retry for 24h

let _xtreamityCache: IptvPortal[] | null = null;
let _xtreamityAt      = 0;
let _xtreamityFailAt  = 0; // when it last returned a fatal error (404/403)

function _amzDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
function _hmac(key: Buffer, data: string): Buffer { return createHmac('sha256', key).update(data).digest(); }
function _sha256Hex(s: string): string { return createHash('sha256').update(s).digest('hex'); }

async function fetchXtreamityPortals(): Promise<IptvPortal[]> {
  if (_xtreamityCache && Date.now() - _xtreamityAt < XTREAMITY_TTL) return _xtreamityCache;
  if (_xtreamityFailAt && Date.now() - _xtreamityFailAt < XTREAMITY_FAIL_TTL) return [];

  const now = new Date();
  const datetime = _amzDate(now);
  const datestamp = datetime.slice(0, 8);
  const path = `/${XTREAMITY_BUCKET}/${XTREAMITY_OBJECT}`;
  const payload = 'UNSIGNED-PAYLOAD';
  const canonHeaders = `host:${XTREAMITY_HOST}\nx-amz-content-sha256:${payload}\nx-amz-date:${datetime}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const scope = `${datestamp}/auto/s3/aws4_request`;
  const canonReq = `GET\n${path}\n\n${canonHeaders}\n${signedHeaders}\n${payload}`;
  const strToSign = `AWS4-HMAC-SHA256\n${datetime}\n${scope}\n${_sha256Hex(canonReq)}`;
  const kDate = _hmac(Buffer.from(`AWS4${XTREAMITY_SK}`), datestamp);
  const sig = _hmac(_hmac(_hmac(kDate, 'auto'), 's3'), 'aws4_request');
  const signature = _hmac(sig, strToSign).toString('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${XTREAMITY_AK}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    const resp = await fetch(`https://${XTREAMITY_HOST}${path}`, {
      headers: { Authorization: auth, 'x-amz-content-sha256': payload, 'x-amz-date': datetime, 'User-Agent': 'aws-sdk-android/2.x' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      if (resp.status === 404 || resp.status === 403) {
        _xtreamityFailAt = Date.now();
        console.warn(`[Xtreamity] R2 HTTP ${resp.status} — endpoint unavailable, skipping for 24h`);
      } else {
        console.warn(`[Xtreamity] R2 HTTP ${resp.status}`);
        return _setCached([]);
      }
      return [];
    }

    const buf = Buffer.from(await resp.arrayBuffer());
    const csv = gunzipSync(buf).toString('utf-8');
    const portals: IptvPortal[] = [];
    for (const raw of csv.split('\n')) {
      const cols = raw.trim().split(',');
      if (cols.length < 3) continue;
      const [url, username, password] = cols.map(s => s.trim());
      if (!url.startsWith('http') || !username || !password) continue;
      portals.push({ url, username, password, source: 'Xtreamity' });
    }
    // Shuffle for regional diversity
    for (let i = portals.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [portals[i], portals[j]] = [portals[j], portals[i]];
    }
    console.log(`[Xtreamity] loaded ${portals.length} portals`);
    return _setCached(portals);
  } catch (e) {
    console.warn('[Xtreamity] fetch failed:', e);
    return _setCached([]);
  }
}

function _setCached(p: IptvPortal[]): IptvPortal[] { _xtreamityCache = p; _xtreamityAt = Date.now(); return p; }

// ── XML2 GitHub dumps ─────────────────────────────────────────────────────────

const XML2_API  = 'https://api.github.com/repos/akeotaseo/world_repo/contents/Updater_Matrix/XML2?ref=main';
const XML2_BASE = 'https://raw.githubusercontent.com/akeotaseo/world_repo/main/Updater_Matrix/XML2/';
const XML2_TTL  = 6 * 60 * 60 * 1000;

let _xml2Files: string[] | null = null;
let _xml2At = 0;

async function getXml2Files(): Promise<string[]> {
  if (_xml2Files && Date.now() - _xml2At < XML2_TTL) return _xml2Files;
  try {
    const resp = await fetch(XML2_API, { headers: { 'User-Agent': SCRAPER_UA, 'Accept': 'application/vnd.github+json' }, signal: AbortSignal.timeout(12_000) });
    if (resp.ok) {
      const list = await resp.json() as Array<Record<string, unknown>>;
      const entries = list
        .filter(e => e.type === 'file' && String(e.name ?? '').endsWith('.txt'))
        .map(e => ({ name: encodeURIComponent(String(e.name)), size: Number(e.size ?? 1e9) }))
        .sort((a, b) => a.size - b.size)
        .map(e => e.name);
      if (entries.length) { _xml2Files = entries; _xml2At = Date.now(); return entries; }
    }
  } catch { /* fall through */ }
  const fallback = ['25.txt','71.txt','ABN.txt','DOV.txt','br.txt','channels_fulltime.txt','kgen.txt','rg.txt','x.txt'].map(encodeURIComponent);
  _xml2Files = fallback; _xml2At = Date.now();
  return fallback;
}

async function fetchXml2File(idx: number): Promise<{ portals: IptvPortal[]; nextIdx: number | null }> {
  const files = await getXml2Files();
  if (idx >= files.length) return { portals: [], nextIdx: null };
  const next = idx + 1 < files.length ? idx + 1 : null;
  try {
    const resp = await fetch(`${XML2_BASE}${files[idx]}`, { headers: { 'User-Agent': SCRAPER_UA }, signal: AbortSignal.timeout(25_000) });
    if (!resp.ok) return { portals: [], nextIdx: next };
    const body = await resp.text();
    return { portals: extractPortals(body, `XML2/${files[idx]}`), nextIdx: next };
  } catch {
    return { portals: [], nextIdx: next };
  }
}

// ── Reddit scraper ────────────────────────────────────────────────────────────

// IPTV_ZONENEW: smaller, mostly western accounts
// IPTV: the main subreddit — much larger, more regional diversity including Arabic
const REDDIT_SUBS: Record<string, string> = {
  works:  'IPTV_ZONENEW',
  arabic: 'IPTV',
};

const REDDIT_PROXIES = [
  'https://corsproxy.io/?{URL}',
  'https://api.allorigins.win/raw?url={URL}',
  'https://api.codetabs.com/v1/proxy?quest={URL}',
];

async function fetchRedditJson(sub: string, after?: string): Promise<string | null> {
  const base = `https://www.reddit.com/r/${sub}/new/.json?limit=100&sort=new${after ? `&after=${after}` : ''}`;
  // Try direct with Googlebot UA first
  try {
    const r = await fetch(base, { headers: { 'User-Agent': 'Googlebot/2.1', Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
    const body = await r.text();
    if (r.ok && body.trimStart().startsWith('{')) return body;
  } catch { /* fall through */ }

  // Proxy fallback
  const encoded = encodeURIComponent(base);
  for (const tmpl of REDDIT_PROXIES) {
    try {
      const r = await fetch(tmpl.replace('{URL}', encoded), { headers: { 'User-Agent': SCRAPER_UA }, signal: AbortSignal.timeout(20_000) });
      const body = await r.text();
      if (r.ok && body.trimStart().startsWith('{')) return body;
    } catch { /* try next */ }
  }
  return null;
}

async function fetchPaste(url: string): Promise<string | null> {
  try {
    let target = url;
    if (url.includes('pastebin.com/') && !url.includes('/raw/')) {
      const id = url.split('/').pop() ?? '';
      target = `https://pastebin.com/raw/${id}`;
    } else if (url.includes('pastes.dev/')) {
      const id = url.split('/').pop() ?? '';
      target = `https://api.pastes.dev/${id}`;
    } else if (url.includes('rentry.co/') && !url.includes('/raw')) {
      const id = url.split('/').filter(Boolean).pop() ?? '';
      target = `https://rentry.co/${id}/raw`;
    }
    const r = await fetch(target, { headers: { 'User-Agent': SCRAPER_UA }, signal: AbortSignal.timeout(15_000) });
    return r.ok ? r.text() : null;
  } catch { return null; }
}

async function scrapeReddit(sub: string, after?: string, maxResults = 50): Promise<{ portals: IptvPortal[]; nextAfter: string | null }> {
  const json = await fetchRedditJson(sub, after);
  if (!json) return { portals: [], nextAfter: null };

  let data: Record<string, unknown>;
  try { data = (JSON.parse(json) as Record<string, unknown>).data as Record<string, unknown>; }
  catch { return { portals: [], nextAfter: null }; }

  const posts = (data.children as Array<Record<string, unknown>>) ?? [];
  const nextAfter = String(data.after ?? '').replace('null','') || null;
  const seen = new Map<string, IptvPortal>();

  for (const post of posts) {
    if (seen.size >= maxResults) break;
    const pd = (post.data as Record<string, unknown>);
    const body = `${pd.title ?? ''} ${pd.selftext ?? ''}`;

    for (const p of extractPortals(body, 'Reddit')) {
      seen.set(p.url + p.username + p.password, p);
    }

    // Follow base64-encoded paste links
    const deepLinks: string[] = [];
    for (const m of body.matchAll(BASE64_RE)) {
      try {
        const dec = Buffer.from(m[0], 'base64').toString('utf-8');
        if (dec.startsWith('http')) deepLinks.push(dec);
      } catch { /* ignore */ }
    }
    for (const m of body.matchAll(RAW_PASTE_RE)) deepLinks.push(m[0]);

    for (const dl of [...new Set(deepLinks)].slice(0, 4)) {
      if (seen.size >= maxResults) break;
      const text = await fetchPaste(dl);
      if (text) extractPortals(text, 'Reddit(paste)').forEach(p => seen.set(p.url + p.username + p.password, p));
    }
  }

  return { portals: [...seen.values()], nextAfter };
}

// ── Public API ────────────────────────────────────────────────────────────────

export type ScrapeSource = 'best' | 'fastest' | 'works' | 'arabic';

export interface ScrapePage {
  portals: IptvPortal[];
  nextCursor: string | null;
}

/**
 * Fetch a page of raw (unverified) portal credentials.
 * `cursor` is opaque — pass the value from the previous call's `nextCursor`.
 */
export async function scrapePage(source: ScrapeSource, cursor?: string): Promise<ScrapePage> {
  switch (source) {
    case 'best': {
      const all = await fetchXtreamityPortals();
      const offset = cursor ? (parseInt(cursor, 10) || 0) : 0;
      const PAGE = 50;
      const slice = all.slice(offset, offset + PAGE);
      return { portals: slice, nextCursor: offset + PAGE < all.length ? String(offset + PAGE) : null };
    }
    case 'fastest': {
      const idx = cursor ? (parseInt(cursor, 10) || 0) : 0;
      const { portals, nextIdx } = await fetchXml2File(idx);
      return { portals, nextCursor: nextIdx !== null ? String(nextIdx) : null };
    }
    case 'works': {
      const { portals, nextAfter } = await scrapeReddit(REDDIT_SUBS['works'], cursor || undefined);
      return { portals, nextCursor: nextAfter };
    }
    case 'arabic': {
      // r/IPTV is the main subreddit — larger, more internationally diverse,
      // more likely to have Arabic/Middle-East portal credentials with beIN Sports.
      const { portals, nextAfter } = await scrapeReddit(REDDIT_SUBS['arabic'], cursor || undefined);
      return { portals, nextCursor: nextAfter };
    }
  }
}
