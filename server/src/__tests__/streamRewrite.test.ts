import { describe, it, expect } from 'vitest';
import { rewriteM3U8 } from '../routes/stream';

describe('rewriteM3U8 token propagation', () => {
  it('appends the auth token to child segment URLs when provided', () => {
    const out = rewriteM3U8('#EXTM3U\nseg1.ts\n', 'http://h/p/x.m3u8', 'http://h/p/x.m3u8', 'AUTHTOK');
    const child = out.split('\n').find(l => l.startsWith('/api/stream'))!;
    expect(child).toContain('token=AUTHTOK');
  });
  it('omits the token when none is provided (gate disabled)', () => {
    const out = rewriteM3U8('#EXTM3U\nseg1.ts\n', 'http://h/p/x.m3u8', 'http://h/p/x.m3u8');
    const child = out.split('\n').find(l => l.startsWith('/api/stream'))!;
    expect(child).not.toContain('token=');
  });
});
