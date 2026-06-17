import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useStore } from '../store/useStore';

export function SearchBar() {
  const searchQuery    = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);

  // Local state updates instantly so the input feels responsive.
  // The expensive store filter only runs after 200ms of no typing,
  // keeping the main thread free so video never stutters while typing.
  const [local, setLocal] = useState(searchQuery);

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(local), 200);
    return () => clearTimeout(t);
  }, [local, setSearchQuery]);

  // Keep local in sync if store query is reset externally (e.g. category click)
  useEffect(() => { setLocal(searchQuery); }, [searchQuery]);

  return (
    <Input
      value={local}
      placeholder="Search channels..."
      onChange={(e) => setLocal(e.target.value)}
      className="bg-zinc-800/50 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
    />
  );
}
