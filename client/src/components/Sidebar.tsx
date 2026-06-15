import { useState } from 'react';
import { Tv2, Trophy } from 'lucide-react';
import { useStore } from '../store/useStore';
import { SearchBar } from './SearchBar';
import { CategoryChips } from './CategoryChips';
import { ChannelList } from './ChannelList';
import { MatchesPanel } from './MatchesPanel';

interface SidebarProps {
  categories: string[];
}

type Tab = 'channels' | 'matches';

export function Sidebar({ categories }: SidebarProps) {
  const sidebarOpen    = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setCategory    = useStore((s) => s.setCategory);

  const [tab, setTab] = useState<Tab>('channels');

  const handleBroadcasterClick = (name: string) => {
    const { channels } = useStore.getState();
    const lc = name.toLowerCase();
    const exact = channels.filter(c => c.name.toLowerCase().includes(lc));

    // Use full name if channels exist; otherwise strip generic suffixes for broader match
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
        className={`absolute left-0 top-0 h-full z-20 flex flex-col w-72
          backdrop-blur-md bg-zinc-900/85 border-r border-zinc-800/60
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60 flex-shrink-0">
          <span className="text-white font-semibold tracking-wide text-sm uppercase">
            {tab === 'channels' ? 'Channels' : 'Matches'}
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors text-lg leading-none"
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
          {tab === 'channels' ? (
            <>
              <SearchBar />
              <CategoryChips categories={categories} />
              <ChannelList />
            </>
          ) : (
            <MatchesPanel onBroadcasterClick={handleBroadcasterClick} />
          )}
        </div>
      </aside>
    </>
  );
}
