import { createHash } from 'crypto';
import { Channel } from '../types';

// ── bintv.online source parsing ───────────────────────────────────────────────
// The upstream catalog (prabashsapkota.github.io/bintvjson/index.json) lists live
// events whose `url_<label>` fields point at streams.  Each url is wrapped in a
// "noooooads" ad-stripping redirector — `…/noooooads/?src=<TARGET>` — and the
// TARGET is one of two shapes:
//   • a direct .m3u8  (e.g. streamhostingcdn.top/stream/94/index.m3u8) — plays as-is
//   • an embed page   (e.g. xyzstreams.shop/wc-5-embed) — a Clappr player that
//     fetches its real m3u8 from an api/get-stream endpoint, so it needs a browser
//     to resolve.
//
// We classify each target and route it through /api/bintv/<token>, where <token>
// encodes both the kind and the target URL so the route can resolve it.

export type BintvKind = 'direct' | 'embed';

const NOOOOADS_RE = /[?&]src=([^&]+)$/;

/** Pull the real target out of a `…/noooooads/?src=<TARGET>` wrapper. */
export function unwrapNooooads(url: string): string {
  const m = url.match(NOOOOADS_RE);
  if (!m) return url;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** Decide how a target URL must be resolved, or null if it isn't a usable stream. */
export function classifyTarget(url: string): BintvKind | null {
  if (!/^https?:\/\//i.test(url)) return null;
  if (/\.m3u8(\?|$)/i.test(url)) return 'direct';
  return 'embed';
}

/**
 * Encode a (kind, url) pair into a url-path-safe token: `<d|e>.<base64url(url)>`.
 * base64url uses only [A-Za-z0-9_-], so the token survives an Express path segment
 * untouched and the `.` separator can never collide with the payload.
 */
export function encodeBintvToken(kind: BintvKind, url: string): string {
  const prefix = kind === 'direct' ? 'd' : 'e';
  return `${prefix}.${Buffer.from(url, 'utf8').toString('base64url')}`;
}

/** Inverse of encodeBintvToken; null if the token is malformed or undecodable. */
export function decodeBintvToken(token: string): { kind: BintvKind; url: string } | null {
  const m = token.match(/^([de])\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const url = Buffer.from(m[2], 'base64url').toString('utf8');
    if (!/^https?:\/\//i.test(url)) return null;
    return { kind: m[1] === 'd' ? 'direct' : 'embed', url };
  } catch {
    return null;
  }
}

function _langToCode(lang: string): string {
  const l = lang.toLowerCase();
  if (l.includes('arabic') || l.includes('arab')) return 'ara';
  if (l.includes('french')) return 'fra';
  if (l.includes('hindi')) return 'hin';
  return 'eng';
}

/** Parse the upstream events array into playable bintv channels. */
export function parseBintvEvents(events: Record<string, unknown>[]): Channel[] {
  const seen = new Set<string>();
  const out: Channel[] = [];

  for (const ev of events) {
    const evName = String(ev['name'] ?? '');
    const logo   = String(ev['logo'] ?? '');

    for (const [key, val] of Object.entries(ev)) {
      if (!key.startsWith('url_') || typeof val !== 'string') continue;

      const target = unwrapNooooads(val);
      const kind = classifyTarget(target);
      if (!kind) continue;
      if (seen.has(target)) continue;
      seen.add(target);

      const label = key.replace(/^url_/, '').replace(/\s*-\s*Stream\s*\d+$/i, '').trim();
      const token = encodeBintvToken(kind, target);
      const id    = createHash('sha256').update(`bintv:${target}`).digest('hex').slice(0, 16);

      out.push({
        id,
        name:     label ? `${evName} (${label})` : evName,
        logo,
        url:      `/api/bintv/${token}`,
        category: 'soccer',
        country:  '',
        language: _langToCode(label),
      });
    }
  }

  return out;
}
