import { useRef } from 'react';
import { Tv2, Trophy, Satellite } from 'lucide-react';
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
          backdrop-blur-md bg-zinc-900/85 border-r border-zinc-800/60
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60 flex-shrink-0">
          <span className="text-white font-semibold tracking-wide text-sm uppercase truncate">
            {tab === 'channels' ? 'Channels' : tab === 'hub' ? 'Channel Hub' : 'Matches'}
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors text-lg leading-none flex-shrink-0 ml-2"
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-zinc-800/60 flex-shrink-0">
          <button
            onClick={() => setTab('channels')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors
              ${tab === 'channels'
                ? 'text-white border-b-2 border-indigo-500'
                : 'text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent'}`}
          >
            <Tv2 size={13} />
            Channels
          </button>
          <button
            onClick={() => setTab('hub')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors
              ${tab === 'hub'
                ? 'text-white border-b-2 border-indigo-500'
                : 'text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent'}`}
          >
            <Satellite size={13} />
            Hub
          </button>
          <button
            onClick={() => setTab('matches')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors
              ${tab === 'matches'
                ? 'text-white border-b-2 border-indigo-500'
                : 'text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent'}`}
          >
            <Trophy size={13} />
            Matches
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-3 p-3 flex-1 min-h-0">
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

        {/* Drag-to-resize handle */}
        <div
          onMouseDown={startResize}
          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize
            hover:bg-indigo-500/50 active:bg-indigo-500/70 transition-colors z-30"
          title="Drag to resize"
        />
      </aside>
    </>
  );
}
