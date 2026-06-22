import { createHmac, timingSafeEqual } from 'node:crypto';

const FALLBACK_PEPPER = 'streambox-access-gate-v1';

function key(): string {
  return process.env.AUTH_SECRET || FALLBACK_PEPPER;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isAuthEnabled(): boolean {
  return typeof process.env.ACCESS_CODE === 'string' && process.env.ACCESS_CODE.length > 0;
}

export function expectedToken(): string {
  if (!isAuthEnabled()) return '';
  return createHmac('sha256', key()).update(process.env.ACCESS_CODE as string).digest('base64url');
}

export function verifyCode(code: string): boolean {
  if (!isAuthEnabled()) return false;
  return safeEqual(code ?? '', process.env.ACCESS_CODE as string);
}

export function verifyToken(token: string): boolean {
  if (!isAuthEnabled()) return false;
  const expected = expectedToken();
  return expected.length > 0 && safeEqual(token ?? '', expected);
}
