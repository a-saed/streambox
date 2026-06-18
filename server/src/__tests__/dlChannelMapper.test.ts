import { describe, it, expect, beforeEach } from 'vitest';
import { initDb } from '../services/portalStore';

beforeEach(() => { initDb(':memory:'); });

describe('mapDLChannelsToPool', () => {
  it('maps a beIN Sports 1 channel name to bein_ar_1', async () => {
    const { initSportsPool, getBestUrl } = await import('../services/sportsPool?t=' + Date.now());
    const { mapDLChannelsToPool } = await import('../services/dlChannelMapper?t=' + Date.now());
    initSportsPool();
    mapDLChannelsToPool([{ name: 'beIN Sports 1', url: 'http://dl.test/bein1.m3u8' }]);
    const best = getBestUrl('bein_ar_1');
    expect(best?.url).toBe('http://dl.test/bein1.m3u8');
    expect(best?.source).toBe('daddylive');
  });

  it('ignores channels with no HUB_CHANNEL match', async () => {
    const { initSportsPool, getPoolStats } = await import('../services/sportsPool?t=' + Date.now());
    const { mapDLChannelsToPool } = await import('../services/dlChannelMapper?t=' + Date.now());
    initSportsPool();
    mapDLChannelsToPool([{ name: 'Some Unknown Channel XYZ', url: 'http://dl.test/xyz.m3u8' }]);
    expect(getPoolStats().length).toBe(0);
  });

  it('maps SSC Sport 1 to ssc hub channel', async () => {
    const { initSportsPool, getBestUrl } = await import('../services/sportsPool?t=' + Date.now());
    const { mapDLChannelsToPool } = await import('../services/dlChannelMapper?t=' + Date.now());
    initSportsPool();
    mapDLChannelsToPool([{ name: 'SSC Sport 1', url: 'http://dl.test/ssc1.m3u8' }]);
    const best = getBestUrl('ssc');
    expect(best?.url).toBe('http://dl.test/ssc1.m3u8');
  });
});
