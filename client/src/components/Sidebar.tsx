import { useRef } from 'react';
import { Tv2, Trophy, Satellite, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { SearchBar } from './SearchBar';
import { CategoryChips } from './CategoryChips';
import { ChannelList } from './ChannelList';
import { MatchesPanel } from './MatchesPanel';
import { HubPanel } from './HubPanel';
import { useState } from 'react';

const MIN_W = 220;
const MAX_W = 600;

interface SidebarProps {
  categories: string[];
}

type Tab = 'channels' | 'hub' | 'matches';

export function Sidebar({ categories }: SidebarProps) {
  const sidebarOpen    = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const sidebarWidth   = useStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setCategory    = useStore((s) => s.setCategory);

  const [tab, setTab] = useState<Tab>('channels');
  const draggingRef = useRef(false);
  const widthRef    = useRef(sidebarWidth);
  widthRef.current  = sidebarWidth;

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startW = widthRef.current;

    function onMove(ev: MouseEvent) {
      const newW = Math.max(MIN_W, Math.min(MAX_W, startW + ev.clientX - startX));
      widthRef.current = newW;
      setSidebarWidth(newW);
    }

    function onUp() {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  const handleBroadcasterClick = (name: string) => {
    const { channels } = useStore.getState();
    const lc = name.toLowerCase();
    const exact = channels.filter(c => c.name.toLowerCase().includes(lc));
    const term = exact.length > 0
      ? name
      : name.replace(/\s+(Sports?|Network|Channel|HD|TV)$/i, '').trim();
    setSearchQuery(term);
    setCategory('All');
    setTab('channels');
  };

  return (
    <>
      {sidebarOpen && (
        <div
          className="absolute inset-0 z-10"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        style={{ width: sidebarWidth }}
        className={`absolute left-0 top-0 h-full z-20 flex flex-col
          bg-zinc-950/90 backdrop-blur-xl border-r border-white/[0.05]
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Header: brand + close */}
        <div className="flex items-center justify-between px-4 py-3.5 flex-shrink-0
                       border-b border-white/[0.04]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600
                           flex items-center justify-center flex-shrink-0
                           shadow-[0_0_12px_rgba(139,92,246,0.4)]">
              <Satellite size={13} className="text-white" strokeWidth={1.5} />
            </div>
            <span className="text-white text-sm font-semibold tracking-[0.2em] uppercase select-none">
              StreamBox
            </span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="w-6 h-6 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 transition-colors
                      flex items-center justify-center text-zinc-500 hover:text-zinc-300"
            aria-label="Close sidebar"
          >
            <X size={12} />
          </button>
        </div>

        {/* Sliding pill tabs */}
        <div className="px-3 pt-3 pb-2 flex-shrink-0">
          <div className="relative flex bg-zinc-900/80 rounded-xl p-0.5 border border-white/[0.04]">
            <div
              className="absolute top-0.5 bottom-0.5 rounded-[10px]
                         bg-gradient-to-r from-indigo-600 to-violet-600
                         transition-all duration-250 ease-out"
              style={{
                width: 'calc(33.333% - 2px)',
                left: tab === 'channels' ? '2px'
                     : tab === 'hub'      ? 'calc(33.333% + 0px)'
                     : 'calc(66.666% - 2px)',
              }}
            />
            {([
              { key: 'channels', label: 'Channels', Icon: Tv2 },
              { key: 'hub',      label: 'Hub',      Icon: Satellite },
              { key: 'matches',  label: 'Matches',  Icon: Trophy },
            ] as const).map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key as Tab)}
                className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-2
                           text-[11px] font-medium transition-colors duration-200
                           ${tab === key ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                <Icon size={11} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-3 p-3 pt-1 flex-1 min-h-0">
          {tab === 'channels' && (
            <>
              <SearchBar />
              <CategoryChips categories={categories} />
              <ChannelList />
            </>
          )}
          {tab === 'hub' && <HubPanel />}
          {tab === 'matches' && (
            <MatchesPanel onBroadcasterClick={handleBroadcasterClick} />
          )}
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={startResize}
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize
            hover:bg-violet-500/40 active:bg-violet-500/60 transition-colors z-30"
        />
      </aside>
    </>
  );
}
