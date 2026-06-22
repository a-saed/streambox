import { describe, it, expect, beforeEach } from 'vitest';
import { isAuthEnabled, expectedToken, verifyCode, verifyToken } from '../services/accessToken';

beforeEach(() => { delete process.env.ACCESS_CODE; delete process.env.AUTH_SECRET; });

describe('accessToken', () => {
  it('is disabled when ACCESS_CODE is unset', () => {
    expect(isAuthEnabled()).toBe(false);
    expect(expectedToken()).toBe('');
    expect(verifyCode('anything')).toBe(false);
    expect(verifyToken('anything')).toBe(false);
  });

  it('verifyCode matches the configured passphrase only', () => {
    process.env.ACCESS_CODE = 'open-sesame';
    expect(verifyCode('open-sesame')).toBe(true);
    expect(verifyCode('wrong')).toBe(false);
    expect(verifyCode('')).toBe(false);
  });

  it('expectedToken is deterministic and verifyToken accepts it', () => {
    process.env.ACCESS_CODE = 'pw';
    const t = expectedToken();
    expect(t).toBe(expectedToken());
    expect(t.length).toBeGreaterThan(0);
    expect(verifyToken(t)).toBe(true);
    expect(verifyToken('bad')).toBe(false);
  });

  it('token changes when AUTH_SECRET changes', () => {
    process.env.ACCESS_CODE = 'pw';
    const a = expectedToken();
    process.env.AUTH_SECRET = 'different-secret';
    expect(expectedToken()).not.toBe(a);
  });
});
