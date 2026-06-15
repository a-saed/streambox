import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useStore } from '../store/useStore';

function getCategoryIcon(name: string): string {
  const n = name.toLowerCase();
  if (n === 'all')                                                        return '📺';
  if (n.includes('sport'))                                                return '⚽';
  if (n.includes('news'))                                                 return '📰';
  if (n.includes('movie') || n.includes('film') || n.includes('cinema')) return '🎬';
  if (n.includes('music'))                                                return '🎵';
  if (n.includes('kid') || n.includes('child') || n.includes('cartoon')) return '🧸';
  if (n.includes('docu'))                                                 return '🎥';
  if (n.includes('comedy'))                                               return '😄';
  if (n.includes('drama'))                                                return '🎭';
  if (n.includes('entertain'))                                            return '🎉';
  if (n.includes('science'))                                              return '🔬';
  if (n.includes('nature'))                                               return '🌿';
  if (n.includes('travel'))                                               return '✈️';
  if (n.includes('cook') || n.includes('food') || n.includes('culinar')) return '🍳';
  if (n.includes('lifestyle'))                                            return '✨';
  if (n.includes('fitness') || n.includes('health'))                     return '💪';
  if (n.includes('religio') || n.includes('faith') || n.includes('spirit')) return '🕌';
  if (n.includes('business') || n.includes('financ'))                    return '💼';
  if (n.includes('weather'))                                              return '⛅';
  if (n.includes('educat') || n.includes('learn'))                       return '📚';
  if (n.includes('auto') || n.includes('motor'))                         return '🚗';
  if (n.includes('shop') || n.includes('retail'))                        return '🛍️';
  if (n.includes('classic'))                                              return '📼';
  if (n.includes('animat'))                                               return '🎨';
  if (n.includes('legislat') || n.includes('polit'))                     return '🏛️';
  if (n.includes('family'))                                               return '👨‍👩‍👧';
  if (n.includes('relax') || n.includes('ambient'))                      return '🌊';
  if (n.includes('tech') || n.includes('digital'))                       return '💻';
  if (n.includes('fashion') || n.includes('style'))                      return '👗';
  if (n.includes('outdoor') || n.includes('adventure'))                  return '🌲';
  if (n.includes('game') || n.includes('gaming') || n.includes('esport')) return '🎮';
  return '📡';
}

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
          className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg
            pl-7 pr-7 py-1.5 text-[11px] text-zinc-300 placeholder:text-zinc-600
            focus:outline-none focus:border-indigo-500/60 focus:bg-zinc-800
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
                  className={`flex items-center gap-1.5 flex-shrink-0 px-2.5 py-1 rounded-full
                    text-[11px] font-medium transition-all duration-150 outline-none
                    focus-visible:ring-2 focus-visible:ring-indigo-500
                    ${isActive
                      ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/30'
                      : 'bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                    }`}
                >
                  <span aria-hidden="true">{getCategoryIcon(cat)}</span>
                  <span>{cat}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
