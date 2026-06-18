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
    <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-3 px-5 py-3
                   bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        <span className="text-zinc-300 text-[11px] font-medium">{activeChannel.name}</span>
      </div>
      {current ? (
        <>
          <span className="text-zinc-600 text-[11px]">·</span>
          <span className="text-zinc-400 text-[11px]">
            Now: <span className="text-zinc-200 font-medium">{current.title}</span>
          </span>
          {next && (
            <span className="text-zinc-600 text-[11px] hidden sm:inline">
              · Next: {next.title}
            </span>
          )}
        </>
      ) : null}
    </div>
  );
}
