import { Router } from 'express';
import { getChannels, getCategories } from '../cache';

const router = Router();

const SOURCE_PREFIXES: Record<string, string> = {
  daddylive: '/api/daddylive/',
  bintv:     '/api/bintv/',
};

router.get('/', (req, res) => {
  let result = getChannels();
  const { category, search, source } = req.query as { category?: string; search?: string; source?: string };

  if (source && SOURCE_PREFIXES[source]) {
    result = result.filter(c => c.url.startsWith(SOURCE_PREFIXES[source]));
  } else if (category && category !== 'All') {
    result = result.filter(c => c.category === category);
  }
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(c => c.name.toLowerCase().includes(q));
  }

  res.json({ channels: result, categories: getCategories() });
});

export default router;
