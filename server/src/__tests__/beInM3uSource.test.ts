import { describe, it, expect, beforeEach } from 'vitest';
import { initDb } from '../services/portalStore';

beforeEach(() => { initDb(':memory:'); });

describe('filterAndMatchM3u (internal logic via integration)', () => {
  it('matches beIN Sports 1 from M3U channel list', async () => {
    const { HUB_CHANNELS, matchesChannel } = await import('../services/channelHub');
    const testChannels = [
      { name: 'beIN Sports 1', url: 'http://test.m3u8' },
      { name: 'Sky Sports Main Event', url: 'http://sky.m3u8' },
      { name: 'Some Random Channel', url: 'http://random.m3u8' },
    ];
    const matched = testChannels
      .map(ch => ({ ...ch, hubId: HUB_CHANNELS.find(h => matchesChannel(ch.name, h))?.id }))
      .filter(ch => ch.hubId !== undefined);
    expect(matched.length).toBeGreaterThanOrEqual(1);
    expect(matched[0].hubId).toBe('bein_ar_1');
  });
});
