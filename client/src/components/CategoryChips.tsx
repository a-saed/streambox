import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useStore } from '../store/useStore';


interface CategoryChipsProps {
  categories: string[];
}

export function CategoryChips({ categories }: CategoryChipsProps) {
  const category    = useStore((s) => s.category);
  const setCategory = useStore((s) => s.setCategory);
  const activeRef   = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');

  const all = ['All', ...categories];
  const filtered = query.trim()
    ? all.filter(c => c.toLowerCase().includes(query.toLowerCase()))
    : all;

  // Scroll active pill into view when category changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [category]);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Category search */}
      <div className="relative mx-1">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter categories…"
          className="w-full bg-zinc-900/80 border border-white/[0.05] rounded-lg
            pl-7 pr-7 py-1.5 text-[11px] text-zinc-300 placeholder:text-zinc-600
            focus:outline-none focus:border-violet-500/40
            transition-colors"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label="Clear"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Pill row */}
      <div
        className="relative"
        style={{
          maskImage: 'linear-gradient(to right, transparent, black 12px, black calc(100% - 12px), transparent)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 12px, black calc(100% - 12px), transparent)',
        }}
      >
        <div
          className="flex gap-1.5 overflow-x-auto px-3 py-0.5 scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {filtered.length === 0 ? (
            <span className="text-zinc-600 text-xs px-1 py-1.5">No categories found</span>
          ) : (
            filtered.map(cat => {
              const isActive = cat === category;
              return (
                <button
                  key={cat}
                  ref={isActive ? activeRef : undefined}
                  onClick={() => { setCategory(cat); setQuery(''); }}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-full
                    text-[11px] font-medium transition-all duration-150 outline-none
                    focus-visible:ring-2 focus-visible:ring-violet-500/50
                    ${isActive
                      ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-[0_0_10px_rgba(139,92,246,0.25)]'
                      : 'bg-zinc-900/80 text-zinc-500 border border-white/[0.05] hover:bg-zinc-800/80 hover:text-zinc-300'
                    }`}
                >
                  {cat}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
