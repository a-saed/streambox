import { Router } from 'express';
import { getChannels, getCategories } from '../cache';

const router = Router();

router.get('/', (req, res) => {
  let result = getChannels();
  const { category, search } = req.query as { category?: string; search?: string };

  if (category && category !== 'All') {
    result = result.filter(c => c.category === category);
  }
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(c => c.name.toLowerCase().includes(q));
  }

  res.json({ channels: result, categories: getCategories() });
});

export default router;
