import { HUB_CHANNELS, matchesChannel } from './channelHub';
import { addUrls, type PoolSource } from './sportsPool';

export function mapDLChannelsToPool(
  channels: Array<{ name: string; url: string }>,
  source: PoolSource = 'daddylive',
): void {
  for (const ch of channels) {
    const hubCh = HUB_CHANNELS.find(h => matchesChannel(ch.name, h));
    if (hubCh) {
      addUrls(hubCh.id, [{ url: ch.url, source }]);
    }
  }
}
