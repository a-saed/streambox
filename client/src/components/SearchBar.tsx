import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useStore } from '../store/useStore';

export function SearchBar() {
  const searchQuery    = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const [local, setLocal] = useState(searchQuery);

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(local), 200);
    return () => clearTimeout(t);
  }, [local, setSearchQuery]);

  useEffect(() => { setLocal(searchQuery); }, [searchQuery]);

  return (
    <div className="relative">
      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
      <input
        value={local}
        placeholder="Search channels…"
        onChange={(e) => setLocal(e.target.value)}
        className="w-full bg-zinc-900/80 border border-white/[0.05] rounded-xl
                  pl-9 pr-8 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-600
                  focus:outline-none focus:border-violet-500/40 focus:bg-zinc-900
                  transition-all duration-150"
      />
      {local && (
        <button
          onClick={() => setLocal('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
