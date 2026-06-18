import { useDeferredValue } from 'react';
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
  const activeChannel    = useStore((s) => s.activeChannel);
  const setActiveChannel = useStore((s) => s.setActiveChannel);
  const ch = channels[index];
  const isActive = activeChannel?.url === ch.url;

  return (
    <div
      style={style}
      {...ariaAttributes}
      onClick={() => setActiveChannel(ch)}
      className={`group relative flex items-center gap-3 px-3 cursor-pointer transition-all duration-150
        ${isActive
          ? 'bg-gradient-to-r from-indigo-950/70 via-violet-950/40 to-transparent'
          : 'hover:bg-white/[0.025]'
        }`}
    >
      {/* Active left bar */}
      {isActive && (
        <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full
                       bg-gradient-to-b from-indigo-400 to-violet-500" />
      )}

      {/* Logo */}
      {ch.logo ? (
        <img
          src={ch.logo}
          alt={ch.name}
          className={`h-8 w-12 object-contain rounded-lg flex-shrink-0 transition-opacity
            ${isActive ? 'opacity-100' : 'opacity-60 group-hover:opacity-90'}`}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div className={`h-8 w-12 rounded-lg flex-shrink-0 flex items-center justify-center
          text-[10px] font-bold tracking-widest transition-all
          ${isActive
            ? 'bg-gradient-to-br from-indigo-600/30 to-violet-600/30 text-violet-300 border border-violet-500/20'
            : 'bg-zinc-800/70 text-zinc-600 group-hover:text-zinc-500'
          }`}>
          TV
        </div>
      )}

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className={`text-sm truncate transition-colors
          ${isActive ? 'text-white font-medium' : 'text-zinc-300 group-hover:text-zinc-100'}`}>
          {ch.name}
        </p>
        {ch.country && (
          <p className="text-[11px] text-zinc-600 truncate group-hover:text-zinc-500 transition-colors">
            {ch.country}
          </p>
        )}
      </div>

      {/* Live indicator (active only) */}
      {isActive && (
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
      )}
    </div>
  );
}

export function ChannelList() {
  const filtered = useStore((s) => s.filtered);
  // useDeferredValue lets React 18 defer the expensive list re-render.
  // The video player and controls stay responsive during heavy filter updates.
  const deferred  = useDeferredValue(filtered);
  const isPending = deferred !== filtered;

  if (deferred.length === 0 && !isPending) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-zinc-700 text-xs tracking-wide">No channels found</p>
      </div>
    );
  }

  return (
    <div
      className="flex-1 min-h-0 transition-opacity duration-150"
      style={{ overflow: 'hidden', opacity: isPending ? 0.6 : 1 }}
    >
      <List<ChannelRowExtraProps>
        style={{ height: '100%', width: '100%' }}
        rowCount={deferred.length}
        rowHeight={ITEM_HEIGHT}
        rowComponent={ChannelRow}
        rowProps={{ channels: deferred }}
      />
    </div>
  );
}
