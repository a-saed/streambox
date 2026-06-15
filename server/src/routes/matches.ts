import { Router } from 'express';
import { getMatches } from '../services/matchesService';

const router = Router();

router.get('/', async (_, res) => {
  try {
    const matches = await getMatches();
    res.json({ matches });
  } catch {
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

export default router;
