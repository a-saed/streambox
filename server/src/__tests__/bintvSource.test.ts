import { describe, it, expect } from 'vitest';
import {
  unwrapNooooads,
  classifyTarget,
  encodeBintvToken,
  decodeBintvToken,
  parseBintvEvents,
} from '../services/bintvSource';

const NOOOOADS = 'https://prabashsapkota.github.io/noooooads/?src=';

describe('unwrapNooooads', () => {
  it('extracts the src target from a noooooads wrapper', () => {
    expect(unwrapNooooads(`${NOOOOADS}https://xyzstreams.shop/wc-5-embed`))
      .toBe('https://xyzstreams.shop/wc-5-embed');
  });
  it('url-decodes an encoded src', () => {
    expect(unwrapNooooads(`${NOOOOADS}https%3A%2F%2Fa.b%2Fx.m3u8`))
      .toBe('https://a.b/x.m3u8');
  });
  it('returns a bare url unchanged', () => {
    expect(unwrapNooooads('https://a.b/x.m3u8')).toBe('https://a.b/x.m3u8');
  });
});

describe('classifyTarget', () => {
  it('classifies an .m3u8 url as direct', () => {
    expect(classifyTarget('https://1nyaler.streamhostingcdn.top/stream/94/index.m3u8')).toBe('direct');
  });
  it('classifies an .m3u8 with query as direct', () => {
    expect(classifyTarget('https://a.b/index.m3u8?token=x')).toBe('direct');
  });
  it('classifies an embed page as embed', () => {
    expect(classifyTarget('https://xyzstreams.shop/wc-5-embed')).toBe('embed');
  });
  it('returns null for non-http junk', () => {
    expect(classifyTarget('javascript:void(0)')).toBe(null);
  });
});

describe('token encode/decode roundtrip', () => {
  it('roundtrips a direct token', () => {
    const url = 'https://a.b/index.m3u8?token=x';
    const t = encodeBintvToken('direct', url);
    expect(t.startsWith('d.')).toBe(true);
    expect(decodeBintvToken(t)).toEqual({ kind: 'direct', url });
  });
  it('roundtrips an embed token', () => {
    const url = 'https://xyzstreams.shop/wc-5-embed';
    const t = encodeBintvToken('embed', url);
    expect(t.startsWith('e.')).toBe(true);
    expect(decodeBintvToken(t)).toEqual({ kind: 'embed', url });
  });
  it('returns null for a malformed token', () => {
    expect(decodeBintvToken('garbage')).toBe(null);
    expect(decodeBintvToken('x.abc')).toBe(null);
  });
  it('produces url-path-safe tokens (no /, +, =, or whitespace)', () => {
    const t = encodeBintvToken('embed', 'https://a.b/c?d=e&f=g/h+i');
    expect(t).toMatch(/^[de]\.[A-Za-z0-9_-]+$/);
  });
});

describe('parseBintvEvents', () => {
  const events = [{
    name: 'World Cup 2026 - All Channels',
    logo: 'https://img/logo.jpg',
    category: 'Football',
    time: 'Live',
    'url_FOX 4K HD - Stream 1': `${NOOOOADS}https://xyzstreams.shop/wc-5-embed`,
    'url_DAZN HD - Stream 2': `${NOOOOADS}https://1nyaler.streamhostingcdn.top/stream/94/index.m3u8`,
  }];

  it('produces one channel per url_ field', () => {
    expect(parseBintvEvents(events)).toHaveLength(2);
  });

  it('routes every channel through /api/bintv/ with a decodable token', () => {
    for (const ch of parseBintvEvents(events)) {
      expect(ch.url.startsWith('/api/bintv/')).toBe(true);
      const token = ch.url.slice('/api/bintv/'.length);
      expect(decodeBintvToken(token)).not.toBe(null);
    }
  });

  it('encodes the direct m3u8 target as a direct token', () => {
    const dazn = parseBintvEvents(events).find(c => c.name.includes('DAZN'))!;
    const decoded = decodeBintvToken(dazn.url.slice('/api/bintv/'.length))!;
    expect(decoded.kind).toBe('direct');
    expect(decoded.url).toBe('https://1nyaler.streamhostingcdn.top/stream/94/index.m3u8');
  });

  it('encodes the xyzstreams page as an embed token', () => {
    const fox = parseBintvEvents(events).find(c => c.name.includes('FOX'))!;
    const decoded = decodeBintvToken(fox.url.slice('/api/bintv/'.length))!;
    expect(decoded.kind).toBe('embed');
    expect(decoded.url).toBe('https://xyzstreams.shop/wc-5-embed');
  });

  it('carries the event name + stream label into the channel name', () => {
    const fox = parseBintvEvents(events).find(c => c.url.includes('e.'))!;
    expect(fox.name).toContain('World Cup 2026');
    expect(fox.name).toContain('FOX 4K HD');
  });

  it('produces stable unique ids per stream', () => {
    const ids = parseBintvEvents(events).map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(parseBintvEvents(events).map(c => c.id)).toEqual(ids); // deterministic
  });

  it('skips junk url_ values that classify to nothing', () => {
    const bad = [{ name: 'X', 'url_a': 'javascript:void(0)', 'url_b': `${NOOOOADS}https://a.b/x.m3u8` }];
    expect(parseBintvEvents(bad)).toHaveLength(1);
  });
});
