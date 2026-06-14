import { Input } from '@/components/ui/input';
import { useStore } from '../store/useStore';

export function SearchBar() {
  const { searchQuery, setSearchQuery } = useStore((s) => ({
    searchQuery: s.searchQuery,
    setSearchQuery: s.setSearchQuery,
  }));

  return (
    <Input
      value={searchQuery}
      placeholder="Search channels..."
      onChange={(e) => setSearchQuery(e.target.value)}
      className="bg-zinc-800/50 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
    />
  );
}
