import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getToken, setToken, clearToken, withToken, apiFetch, verifyAccess, onUnauthorized } from './api';

beforeEach(() => {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };
  vi.restoreAllMocks();
  clearToken();
});

describe('token helpers + withToken', () => {
  it('stores and clears the token', () => {
    setToken('abc'); expect(getToken()).toBe('abc');
    clearToken(); expect(getToken()).toBe(null);
  });
  it('withToken appends token, choosing ? or &', () => {
    setToken('t1');
    expect(withToken('http://x/a')).toBe('http://x/a?token=t1');
    expect(withToken('http://x/a?b=1')).toBe('http://x/a?b=1&token=t1');
  });
  it('withToken is a no-op without a token', () => {
    expect(withToken('http://x/a')).toBe('http://x/a');
  });
});

describe('apiFetch', () => {
  it('injects the Authorization header when a token is present', async () => {
    setToken('tok');
    const spy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    await apiFetch('/api/x');
    const call = spy.mock.calls[0] as any[];
    const headers = (call[1] as RequestInit).headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer tok');
  });
  it('on 401 clears the token and fires onUnauthorized', async () => {
    setToken('tok');
    let fired = false;
    onUnauthorized(() => { fired = true; });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(apiFetch('/api/x')).rejects.toThrow();
    expect(getToken()).toBe(null);
    expect(fired).toBe(true);
  });
});

describe('verifyAccess', () => {
  it('stores the token on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, token: 'newtok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const r = await verifyAccess('pw');
    expect(r.ok).toBe(true);
    expect(getToken()).toBe('newtok');
  });
  it('returns ok:false on a wrong code and stores no token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    const r = await verifyAccess('bad');
    expect(r.ok).toBe(false);
    expect(getToken()).toBe(null);
  });
});
