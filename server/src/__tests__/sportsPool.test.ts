import { describe, it, expect, beforeEach } from 'vitest';
import { initDb } from '../services/portalStore';

// Use in-memory DB for tests
beforeEach(() => { initDb(':memory:'); });

// Dynamically re-import pool after each initDb so SQLite is fresh
async function freshPool() {
  const mod = await import('../services/sportsPool?t=' + Date.now());
  return mod;
}

describe('addUrls / getBestUrl', () => {
  it('returns null for unknown channel', async () => {
    const { getBestUrl, initSportsPool } = await freshPool();
    initSportsPool();
    expect(getBestUrl('bein_ar_1')).toBeNull();
  });

  it('returns best alive url after adding', async () => {
    const { addUrls, getBestUrl, initSportsPool } = await freshPool();
    initSportsPool();
    addUrls('bein_ar_1', [{ url: 'http://a.test/s.m3u8', source: 'daddylive' }]);
    expect(getBestUrl('bein_ar_1')).toEqual({ url: 'http://a.test/s.m3u8', source: 'daddylive' });
  });

  it('skips duplicate urls', async () => {
    const { addUrls, getPoolStats, initSportsPool } = await freshPool();
    initSportsPool();
    addUrls('bein_ar_1', [{ url: 'http://a.test/s.m3u8', source: 'daddylive' }]);
    addUrls('bein_ar_1', [{ url: 'http://a.test/s.m3u8', source: 'daddylive' }]);
    const stats = (getPoolStats() as Array<{ channelId: string; aliveCount: number; totalCount: number }>).find(s => s.channelId === 'bein_ar_1');
    expect(stats?.totalCount).toBe(1);
  });
});

describe('markResult', () => {
  it('marks url dead and skips it in getBestUrl', async () => {
    const { addUrls, markResult, getBestUrl, initSportsPool } = await freshPool();
    initSportsPool();
    addUrls('bein_ar_1', [
      { url: 'http://dead.test/s.m3u8', source: 'daddylive' },
      { url: 'http://alive.test/s.m3u8', source: 'm3u' },
    ]);
    markResult('http://dead.test/s.m3u8', false);
    expect(getBestUrl('bein_ar_1')).toEqual({ url: 'http://alive.test/s.m3u8', source: 'm3u' });
  });
});

describe('getAliveChannelIds', () => {
  it('lists channels with at least one alive url', async () => {
    const { addUrls, markResult, getAliveChannelIds, initSportsPool } = await freshPool();
    initSportsPool();
    addUrls('bein_ar_1', [{ url: 'http://a.test/1.m3u8', source: 'daddylive' }]);
    addUrls('bein_ar_2', [{ url: 'http://a.test/2.m3u8', source: 'daddylive' }]);
    markResult('http://a.test/2.m3u8', false);
    const ids = getAliveChannelIds();
    expect(ids).toContain('bein_ar_1');
    expect(ids).not.toContain('bein_ar_2');
  });
});
