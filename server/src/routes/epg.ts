import { Router } from 'express';
import { getEPG } from '../cache';

const router = Router();

router.get('/', (_, res) => {
  res.json(getEPG());
});

export default router;
