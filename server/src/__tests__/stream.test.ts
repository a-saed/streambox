import { describe, it, expect } from 'vitest';
import { rewriteM3U8 } from '../routes/stream';

describe('rewriteM3U8', () => {
  it('leaves comment and empty lines unchanged', () => {
    const input = '#EXTM3U\n#EXT-X-VERSION:3\n';
    expect(rewriteM3U8(input, 'http://cdn.example.com/stream.m3u8')).toBe(input);
  });

  it('rewrites relative segment URLs through proxy', () => {
    const input = '#EXTM3U\nseg001.ts';
    const result = rewriteM3U8(input, 'http://cdn.example.com/live/stream.m3u8');
    expect(result).toContain('/api/stream?url=');
    expect(result).toContain(encodeURIComponent('http://cdn.example.com/live/seg001.ts'));
  });

  it('rewrites absolute segment URLs through proxy', () => {
    const input = '#EXTM3U\nhttp://other.cdn.com/seg001.ts';
    const result = rewriteM3U8(input, 'http://cdn.example.com/stream.m3u8');
    expect(result).toContain(encodeURIComponent('http://other.cdn.com/seg001.ts'));
  });

  it('rewrites sub-playlist references through proxy', () => {
    const input = '#EXTM3U\nvariant_720p.m3u8';
    const result = rewriteM3U8(input, 'http://cdn.example.com/master.m3u8');
    expect(result).toContain(encodeURIComponent('http://cdn.example.com/variant_720p.m3u8'));
  });
});
