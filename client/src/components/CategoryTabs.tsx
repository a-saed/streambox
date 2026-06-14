import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStore } from '../store/useStore';

interface CategoryTabsProps {
  categories: string[];
}

export function CategoryTabs({ categories }: CategoryTabsProps) {
  const { category, setCategory } = useStore((s) => ({
    category: s.category,
    setCategory: s.setCategory,
  }));

  return (
    <div className="overflow-x-auto">
      <Tabs value={category} onValueChange={(val) => setCategory(val as string)}>
        <TabsList className="bg-zinc-800/50 h-8 flex w-max gap-1 p-1">
          {['All', ...categories].map((cat) => (
            <TabsTrigger
              key={cat}
              value={cat}
              className="text-xs px-3 h-6 rounded text-zinc-400 data-active:bg-zinc-600 data-active:text-white"
            >
              {cat}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
