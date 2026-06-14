import { List } from 'react-window';
import { useStore } from '../store/useStore';
import type { Channel } from '../types';

const ITEM_HEIGHT = 60;

interface ChannelRowExtraProps {
  channels: Channel[];
}

interface ChannelRowProps extends ChannelRowExtraProps {
  ariaAttributes: {
    'aria-posinset': number;
    'aria-setsize': number;
    role: 'listitem';
  };
  index: number;
  style: React.CSSProperties;
}

function ChannelRow({ index, style, channels, ariaAttributes }: ChannelRowProps) {
  const { activeChannel, setActiveChannel } = useStore((s) => ({
    activeChannel: s.activeChannel,
    setActiveChannel: s.setActiveChannel,
  }));
  const ch = channels[index];
  const isActive = activeChannel?.url === ch.url;

  return (
    <div
      style={style}
      {...ariaAttributes}
      onClick={() => setActiveChannel(ch)}
      className={`flex items-center gap-3 px-3 cursor-pointer transition-colors hover:bg-zinc-700/50 ${
        isActive ? 'bg-zinc-700/80 ring-1 ring-inset ring-indigo-500/60' : ''
      }`}
    >
      {ch.logo ? (
        <img
          src={ch.logo}
          alt={ch.name}
          className="h-8 w-12 object-contain rounded bg-zinc-800 flex-shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div className="h-8 w-12 rounded bg-zinc-800 flex-shrink-0 flex items-center justify-center text-xs text-zinc-500">
          TV
        </div>
      )}
      <div className="min-w-0">
        <p className="text-sm text-zinc-200 truncate">{ch.name}</p>
        <p className="text-xs text-zinc-500 truncate">{ch.country}</p>
      </div>
    </div>
  );
}

export function ChannelList() {
  const filtered = useStore((s) => s.filtered);

  if (filtered.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-zinc-600 text-sm">No channels found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0" style={{ overflow: 'hidden' }}>
      <List<ChannelRowExtraProps>
        style={{ height: '100%', width: '100%' }}
        rowCount={filtered.length}
        rowHeight={ITEM_HEIGHT}
        rowComponent={ChannelRow}
        rowProps={{ channels: filtered }}
      />
    </div>
  );
}
