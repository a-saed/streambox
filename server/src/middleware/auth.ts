import { Request, Response, NextFunction } from 'express';
import { isAuthEnabled, verifyToken } from '../services/accessToken';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) { next(); return; }

  let token = '';
  const header = req.header('authorization');
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (req.method === 'GET' && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (verifyToken(token)) { next(); return; }
  res.status(401).json({ error: 'unauthorized' });
}
