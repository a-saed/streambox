import { useStore } from '../store/useStore';
import type { EPGEntry } from '../types';

function getCurrentAndNext(entries: EPGEntry[]): { current: EPGEntry | null; next: EPGEntry | null } {
  const now = Date.now();
  const upcoming = entries
    .filter(e => new Date(e.end).getTime() > now)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const current = upcoming.find(e => new Date(e.start).getTime() <= now) ?? null;
  const next    = upcoming.find(e => new Date(e.start).getTime() > now)  ?? null;
  return { current, next };
}

export function EPGStrip() {
  const activeChannel = useStore((s) => s.activeChannel);
  const epg = useStore((s) => s.epg);

  if (!activeChannel) return null;

  const entries = epg[activeChannel.id] ?? [];
  const { current, next } = getCurrentAndNext(entries);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent">
      <span className="text-zinc-400 text-xs font-medium flex-shrink-0">
        📺 {activeChannel.name}
      </span>

      {current ? (
        <>
          <span className="text-white text-xs">
            Now: <span className="font-semibold">{current.title}</span>
          </span>
          {next && (
            <span className="text-zinc-500 text-xs hidden sm:inline">
              │ Next: {next.title}
            </span>
          )}
        </>
      ) : (
        <span className="text-zinc-500 text-xs">● Live</span>
      )}
    </div>
  );
}
