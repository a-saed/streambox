import { Router, Request, Response } from 'express';
import { verifyCode, expectedToken } from '../services/accessToken';

const router = Router();

const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const _attempts = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (_attempts.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  _attempts.set(ip, recent);
  return recent.length >= MAX_ATTEMPTS;
}

function recordAttempt(ip: string): void {
  const arr = _attempts.get(ip) ?? [];
  arr.push(Date.now());
  _attempts.set(ip, arr);
}

router.post('/verify', (req: Request, res: Response) => {
  const ip = req.ip ?? 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'too_many_attempts' });

  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (verifyCode(code)) {
    _attempts.delete(ip);
    return res.json({ ok: true, token: expectedToken() });
  }
  recordAttempt(ip);
  return res.status(401).json({ ok: false });
});

export default router;
