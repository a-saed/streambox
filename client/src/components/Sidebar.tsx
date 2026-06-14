import { useStore } from '../store/useStore';
import { SearchBar } from './SearchBar';
import { CategoryTabs } from './CategoryTabs';
import { ChannelList } from './ChannelList';

interface SidebarProps {
  categories: string[];
}

export function Sidebar({ categories }: SidebarProps) {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);

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
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
          <span className="text-white font-semibold tracking-wide text-sm uppercase">Channels</span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors text-lg leading-none"
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 p-3 flex-1 min-h-0">
          <SearchBar />
          <CategoryTabs categories={categories} />
          <ChannelList />
        </div>
      </aside>
    </>
  );
}
