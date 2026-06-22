# Passphrase Access Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the app behind a single shared passphrase: a visitor enters it once, a derived token is stored, and all API access (JSON, video, SSE) is authenticated.

**Architecture:** A stateless HMAC token (`HMAC-SHA256(AUTH_SECRET, ACCESS_CODE)`) verified per-request. Express middleware guards `/api/*`, accepting the token via `Authorization: Bearer` header or — only on GET — a `?token=` query param (so the video player and `EventSource` authenticate). A public `POST /auth/verify` issues the token with brute-force rate limiting. The client stores the token, injects the header on fetches, appends `?token=` to media/SSE URLs, and shows a `GateScreen` on any `401`.

**Tech Stack:** TypeScript, Node, Express 4, `node:crypto`, Vitest + supertest (server), Vitest (client), React.

## Global Constraints

- Gate is DISABLED when `ACCESS_CODE` is unset/empty → all `/api/*` pass through (keeps local dev open). Enabled only when `ACCESS_CODE` is a non-empty string.
- Token = `base64url(HMAC-SHA256(key, ACCESS_CODE))`, `key = AUTH_SECRET || 'streambox-access-gate-v1'` (fixed pepper fallback → tokens stable across restarts).
- All passphrase/token comparisons use `crypto.timingSafeEqual` (length-mismatch → false, never throws).
- Query-param token (`?token=`) is honored ONLY on `req.method === 'GET'`; non-GET requires the `Authorization` header.
- `POST /auth/verify` rate limit: max 10 attempts / 5-minute sliding window per IP → `429`; a successful verify clears that IP's counter.
- Raw passphrase is never returned to the client or stored client-side; only the derived token is stored (localStorage key `streambox_token`).
- `/health` and `POST /auth/verify` are public (mounted before the guard).
- TDD: failing test → minimal code → green → commit. Server logic + client api.ts logic are unit-tested; `GateScreen`/`App` wiring is verified by typecheck (no DOM test stack is added — YAGNI).

---

## Task 1: Access-token service

**Files:**
- Create: `server/src/services/accessToken.ts`
- Test: `server/src/__tests__/accessToken.test.ts`

**Interfaces:**
- Produces:
  - `isAuthEnabled(): boolean`
  - `expectedToken(): string` (`''` when disabled)
  - `verifyCode(code: string): boolean`
  - `verifyToken(token: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/accessToken.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `server/`): `node_modules/.bin/vitest run src/__tests__/accessToken.test.ts`
Expected: FAIL — cannot find module `../services/accessToken`.

- [ ] **Step 3: Write the implementation**

Create `server/src/services/accessToken.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vitest run src/__tests__/accessToken.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/accessToken.ts server/src/__tests__/accessToken.test.ts
git commit -m "feat(auth): stateless HMAC access-token service with timing-safe checks"
```

---

## Task 2: Auth middleware

**Files:**
- Create: `server/src/middleware/auth.ts`
- Test: `server/src/__tests__/authMiddleware.test.ts`

**Interfaces:**
- Consumes: `isAuthEnabled`, `verifyToken`, `expectedToken` (Task 1).
- Produces: `authMiddleware(req, res, next): void` (named export).

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/authMiddleware.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../middleware/auth';
import { expectedToken } from '../services/accessToken';

beforeEach(() => { delete process.env.ACCESS_CODE; delete process.env.AUTH_SECRET; });

function makeApp() {
  const app = express();
  app.use('/api', authMiddleware);
  app.get('/api/ping', (_req, res) => { res.json({ ok: true }); });
  app.post('/api/ping', (_req, res) => { res.json({ ok: true }); });
  return app;
}

describe('authMiddleware', () => {
  it('passes through when auth is disabled', async () => {
    const res = await request(makeApp()).get('/api/ping');
    expect(res.status).toBe(200);
  });
  it('401 when enabled with no token', async () => {
    process.env.ACCESS_CODE = 'pw';
    const res = await request(makeApp()).get('/api/ping');
    expect(res.status).toBe(401);
  });
  it('accepts a valid Bearer token', async () => {
    process.env.ACCESS_CODE = 'pw';
    const res = await request(makeApp()).get('/api/ping').set('Authorization', `Bearer ${expectedToken()}`);
    expect(res.status).toBe(200);
  });
  it('accepts a valid ?token= on GET', async () => {
    process.env.ACCESS_CODE = 'pw';
    const res = await request(makeApp()).get('/api/ping').query({ token: expectedToken() });
    expect(res.status).toBe(200);
  });
  it('rejects ?token= on POST (GET-only)', async () => {
    process.env.ACCESS_CODE = 'pw';
    const res = await request(makeApp()).post('/api/ping').query({ token: expectedToken() });
    expect(res.status).toBe(401);
  });
  it('rejects a wrong token', async () => {
    process.env.ACCESS_CODE = 'pw';
    const res = await request(makeApp()).get('/api/ping').set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run src/__tests__/authMiddleware.test.ts`
Expected: FAIL — cannot find module `../middleware/auth`.

- [ ] **Step 3: Write the implementation**

Create `server/src/middleware/auth.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vitest run src/__tests__/authMiddleware.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/middleware/auth.ts server/src/__tests__/authMiddleware.test.ts
git commit -m "feat(auth): /api guard accepting Bearer header or GET ?token="
```

---

## Task 3: Verify route with rate limiting

**Files:**
- Create: `server/src/routes/authRoute.ts`
- Test: `server/src/__tests__/authRoute.test.ts`

**Interfaces:**
- Consumes: `verifyCode`, `expectedToken` (Task 1).
- Produces: default-export Express `Router` with `POST /verify` (mount at `/auth`).

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/authRoute.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

beforeEach(() => { delete process.env.ACCESS_CODE; delete process.env.AUTH_SECRET; });

// Fresh import per call → fresh in-memory rate-limiter Map (test isolation).
async function makeApp() {
  const authRoute = (await import('../routes/authRoute?t=' + Date.now())).default;
  const app = express();
  app.use(express.json());
  app.use('/auth', authRoute);
  return app;
}

describe('POST /auth/verify', () => {
  it('returns a token for the correct code', async () => {
    process.env.ACCESS_CODE = 'pw';
    const res = await request(await makeApp()).post('/auth/verify').send({ code: 'pw' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
  });

  it('401 for a wrong code', async () => {
    process.env.ACCESS_CODE = 'pw';
    const res = await request(await makeApp()).post('/auth/verify').send({ code: 'nope' });
    expect(res.status).toBe(401);
  });

  it('429 after 10 failed attempts from the same IP', async () => {
    process.env.ACCESS_CODE = 'pw';
    const app = await makeApp();
    for (let i = 0; i < 10; i++) await request(app).post('/auth/verify').send({ code: 'x' });
    const res = await request(app).post('/auth/verify').send({ code: 'x' });
    expect(res.status).toBe(429);
  });

  it('a successful verify resets the attempt counter', async () => {
    process.env.ACCESS_CODE = 'pw';
    const app = await makeApp();
    for (let i = 0; i < 9; i++) await request(app).post('/auth/verify').send({ code: 'x' });
    await request(app).post('/auth/verify').send({ code: 'pw' }); // success → reset
    const res = await request(app).post('/auth/verify').send({ code: 'x' });
    expect(res.status).toBe(401); // not 429
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run src/__tests__/authRoute.test.ts`
Expected: FAIL — cannot find module `../routes/authRoute`.

- [ ] **Step 3: Write the implementation**

Create `server/src/routes/authRoute.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vitest run src/__tests__/authRoute.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/authRoute.ts server/src/__tests__/authRoute.test.ts
git commit -m "feat(auth): POST /auth/verify issues token with per-IP rate limit"
```

---

## Task 4: Wire auth into app.ts

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/.env.example`
- Test: `server/src/__tests__/appAuth.test.ts`

**Interfaces:**
- Consumes: `authMiddleware` (Task 2), `authRoute` (Task 3), `expectedToken` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/appAuth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

beforeEach(() => { delete process.env.ACCESS_CODE; delete process.env.AUTH_SECRET; });

async function getApp() { return (await import('../app?t=' + Date.now())).app; }

describe('app auth wiring', () => {
  it('/health is public even when auth enabled', async () => {
    process.env.ACCESS_CODE = 'pw';
    const res = await request(await getApp()).get('/health');
    expect(res.status).toBe(200);
  });

  it('/api/* returns 401 without a token when ACCESS_CODE is set', async () => {
    process.env.ACCESS_CODE = 'pw';
    const res = await request(await getApp()).get('/api/channels');
    expect(res.status).toBe(401);
  });

  it('/api/* passes with a valid token', async () => {
    process.env.ACCESS_CODE = 'pw';
    const { expectedToken } = await import('../services/accessToken?t=' + Date.now());
    const res = await request(await getApp()).get('/api/channels').set('Authorization', `Bearer ${expectedToken()}`);
    expect(res.status).toBe(200);
  });

  it('/api/* is open when ACCESS_CODE is unset', async () => {
    const res = await request(await getApp()).get('/api/channels');
    expect(res.status).toBe(200);
  });

  it('/auth/verify is reachable without a token', async () => {
    process.env.ACCESS_CODE = 'pw';
    const res = await request(await getApp()).post('/auth/verify').send({ code: 'pw' });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run src/__tests__/appAuth.test.ts`
Expected: FAIL — `/api/channels` returns 200 (no guard yet) for the 401 test, and `/auth/verify` returns 404.

- [ ] **Step 3: Wire the middleware and route into `server/src/app.ts`**

Add these imports alongside the existing route imports near the top:

```ts
import authRoute from './routes/authRoute';
import { authMiddleware } from './middleware/auth';
```

Then change the section after `app.use(express.json());` so the public route + guard sit before the `/api/*` routers. The block should read exactly:

```ts
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true, uptime: process.uptime() }));

// Public: passphrase verification (must be before the /api guard)
app.use('/auth', authRoute);

// Gate all API routes (no-op when ACCESS_CODE is unset)
app.use('/api', authMiddleware);

app.use('/api/channels', channelsRouter);
```

(Leave the remaining `app.use('/api/...', ...)` router lines unchanged after this.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vitest run src/__tests__/appAuth.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Document the env vars**

Append to `server/.env.example`:

```
# ── Access gate ─────────────────────────────────────────────────────────────
# Set a passphrase to require it before the app loads. Leave unset = open.
# ACCESS_CODE=your-passphrase
# Optional: HMAC key for the access token. Recommended in production.
# Tokens stay valid across restarts as long as ACCESS_CODE and AUTH_SECRET are unchanged.
# AUTH_SECRET=long-random-string
```

- [ ] **Step 6: Run the full server suite (no regressions)**

Run: `node_modules/.bin/vitest run`
Expected: all tests pass (existing 54 + the new auth tests).

- [ ] **Step 7: Commit**

```bash
git add server/src/app.ts server/.env.example server/src/__tests__/appAuth.test.ts
git commit -m "feat(auth): mount /auth route + guard /api in app; document env vars"
```

---

## Task 5: Client API token plumbing

**Files:**
- Modify: `client/src/lib/api.ts`
- Test: `client/src/lib/api.test.ts`

**Interfaces:**
- Produces: `getToken()`, `setToken(t)`, `clearToken()`, `onUnauthorized(cb)`, `withToken(url)`, `apiFetch(path, init?)`, `verifyAccess(code): Promise<{ ok: boolean; status: number }>`. Existing fetchers (`fetchChannels`, `fetchEPG`, `fetchMatches`, `fetchSourceChannels`, `fetchHub*`, `discoverPortals`) route through `apiFetch`; `proxyStreamUrl` and `scanHubChannel` route through `withToken`.

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/api.test.ts`:

```ts
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
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Headers;
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
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `client/`): `npx vitest run src/lib/api.test.ts`
Expected: FAIL — `withToken`/`apiFetch`/`verifyAccess` not exported.

- [ ] **Step 3: Rewrite `client/src/lib/api.ts`**

Replace the entire file with:

```ts
import type { Channel, EPGSchedule, Match } from '../types';

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

const TOKEN_KEY = 'streambox_token';
let _onUnauthorized: (() => void) | null = null;

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string): void { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken(): void { localStorage.removeItem(TOKEN_KEY); }
export function onUnauthorized(cb: () => void): void { _onUnauthorized = cb; }

/** Append the access token as a query param — for URLs loaded by the video player or
 *  EventSource, which cannot send an Authorization header. No-op when there's no token. */
export function withToken(url: string): string {
  const t = getToken();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
}

/** fetch wrapper: injects the Authorization header and handles 401 globally. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const t = getToken();
  const headers = new Headers(init.headers);
  if (t) headers.set('Authorization', `Bearer ${t}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    _onUnauthorized?.();
    throw new Error('unauthorized');
  }
  return res;
}

export interface VerifyResult { ok: boolean; status: number; }

/** POST the passphrase; store the token on success. */
export async function verifyAccess(code: string): Promise<VerifyResult> {
  const res = await fetch(`${API_BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (res.ok) {
    const data = await res.json();
    if (data?.token) setToken(data.token);
    return { ok: true, status: res.status };
  }
  return { ok: false, status: res.status };
}

export interface ChannelsResponse {
  channels: Channel[];
  categories: string[];
}

export async function fetchChannels(): Promise<ChannelsResponse> {
  const res = await apiFetch(`/api/channels`);
  if (!res.ok) throw new Error(`Failed to fetch channels: ${res.status}`);
  return res.json();
}

export async function fetchSourceChannels(source: string): Promise<Channel[]> {
  const res = await apiFetch(`/api/channels?source=${encodeURIComponent(source)}`);
  if (!res.ok) return [];
  const data: ChannelsResponse = await res.json();
  return data.channels;
}

export async function fetchEPG(): Promise<EPGSchedule> {
  const res = await apiFetch(`/api/epg`);
  if (!res.ok) throw new Error(`Failed to fetch EPG: ${res.status}`);
  return res.json();
}

export async function fetchMatches(): Promise<Match[]> {
  const res = await apiFetch(`/api/matches`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.matches ?? [];
}

export function proxyStreamUrl(url: string): string {
  // Internal server endpoints serve a pre-rewritten playlist directly.
  if (url.startsWith('/api/')) return withToken(`${API_BASE}${url}`);
  return withToken(`${API_BASE}/api/stream?url=${encodeURIComponent(url)}`);
}

export interface HubChannel {
  id: string;
  name: string;
  short: string;
  category: string;
  broadcasters: string[];
}

export interface HubStatus {
  portalCount: number;
  channelCount: number;
  liveCount: number;
  portals: Array<{ id: string; name: string; streamCount: number }>;
}

export async function fetchHubChannels(): Promise<HubChannel[]> {
  const res = await apiFetch(`/api/hub`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.channels ?? [];
}

export async function fetchHubStatus(): Promise<HubStatus> {
  const res = await apiFetch(`/api/hub/status`);
  if (!res.ok) return { portalCount: 0, channelCount: 0, liveCount: 0, portals: [] };
  return res.json();
}

export async function fetchHubLive(): Promise<string[]> {
  const res = await apiFetch(`/api/hub/live`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.liveChannelIds ?? [];
}

export async function fetchHubBest(channelId: string): Promise<{ url: string; source: string } | null> {
  const res = await apiFetch(`/api/hub/${channelId}/best`);
  if (!res.ok) return null;
  return res.json();
}

export async function discoverPortals(target = 50): Promise<void> {
  await apiFetch(`/api/hub/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target }),
  });
}

export function scanHubChannel(
  channelId: string,
  handlers: {
    onStatus: (msg: string) => void;
    onCandidate: (url: string, streamName: string, portalName: string) => void;
    onProgress: (checked: number, total: number) => void;
    onHit: (url: string, streamName: string, portalName: string) => void;
    onDone: (hits: number, message?: string) => void;
    onError: (msg: string) => void;
  }
): () => void {
  const es = new EventSource(withToken(`${API_BASE}/api/hub/${channelId}/scan`));

  es.addEventListener('status',    e => handlers.onStatus((JSON.parse(e.data) as any).message));
  es.addEventListener('candidate', e => { const d = JSON.parse(e.data) as any; handlers.onCandidate(d.url, d.streamName, d.portalName); });
  es.addEventListener('progress',  e => { const d = JSON.parse(e.data) as any; handlers.onProgress(d.checked, d.total); });
  es.addEventListener('hit',       e => { const d = JSON.parse(e.data) as any; handlers.onHit(d.url, d.streamName, d.portalName); });
  es.addEventListener('done',      e => { const d = JSON.parse(e.data) as any; handlers.onDone(d.hits, d.message); es.close(); });
  es.addEventListener('error',     e => { const d = JSON.parse((e as MessageEvent).data ?? '{}') as any; handlers.onError(d.message ?? 'Scan error'); es.close(); });

  return () => es.close();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/api.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck the client**

Run (from `client/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/api.ts client/src/lib/api.test.ts
git commit -m "feat(auth): client token plumbing — apiFetch header, withToken for media/SSE, verifyAccess"
```

---

## Task 6: GateScreen + App wiring

**Files:**
- Create: `client/src/components/GateScreen.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `verifyAccess`, `onUnauthorized` (Task 5).
- Produces: `GateScreen` component (`{ onUnlock: () => void }`).

> No DOM unit-test stack exists in the client; this task is verified by typecheck + the build. `GateScreen` is thin UI over `verifyAccess`, which is already unit-tested in Task 5.

- [ ] **Step 1: Create the GateScreen component**

Create `client/src/components/GateScreen.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { verifyAccess } from '../lib/api';

export function GateScreen({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    const r = await verifyAccess(code.trim());
    setBusy(false);
    if (r.ok) { onUnlock(); return; }
    setError(r.status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'Incorrect passphrase.');
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#09090b]">
      <form onSubmit={submit} className="flex flex-col items-center gap-6 w-[320px]">
        <div className="w-16 h-16 rounded-[20px] flex items-center justify-center
                        bg-gradient-to-br from-indigo-600 via-violet-600 to-violet-700
                        shadow-[0_0_50px_rgba(139,92,246,0.45)]">
          <Lock size={26} className="text-white" strokeWidth={1.5} />
        </div>
        <p className="text-white text-sm font-semibold tracking-[0.35em] uppercase select-none">StreamBox</p>
        <input
          type="password"
          value={code}
          onChange={e => { setCode(e.target.value); if (error) setError(''); }}
          placeholder="Enter passphrase"
          autoFocus
          className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-white
                     placeholder-zinc-500 outline-none focus:border-violet-500"
        />
        {error && <p className="text-red-400 text-xs -mt-3 self-start">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50
                     text-white py-3 text-sm font-medium transition-colors"
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Wire the gate into `client/src/App.tsx`**

(a) Add to the imports — extend the existing `./lib/api` import and the component imports:

```ts
import { fetchChannels, fetchEPG, fetchHubLive, onUnauthorized } from './lib/api';
import { GateScreen } from './components/GateScreen';
```

(b) Add `locked` state alongside the existing `loading`/`error`/`retryKey` state declarations:

```ts
  const [locked, setLocked]         = useState(false);
```

(c) Register the global 401 handler once. Add this effect next to the other `useEffect`s:

```ts
  useEffect(() => {
    onUnauthorized(() => setLocked(true));
  }, []);
```

(d) Render the gate first. Immediately before the existing `if (loading) return <AppLoader />;` line, add:

```ts
  if (locked) return <GateScreen onUnlock={() => { setLocked(false); setRetryKey(k => k + 1); }} />;
```

(The existing data-load `useEffect` already re-runs when `retryKey` changes, so bumping it after unlock reloads the app.)

- [ ] **Step 3: Typecheck the client**

Run (from `client/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Manual verification (operator)**

```bash
# Terminal 1: server with a passphrase set
ACCESS_CODE=test123 npm run dev --prefix server
# Terminal 2: client
npm run dev --prefix client
```
Expected: the app shows the GateScreen; a wrong code shows "Incorrect passphrase."; `test123` unlocks and the app loads and plays normally. Restarting the client (reload) stays unlocked (token persisted). With `ACCESS_CODE` unset, the gate never appears.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/GateScreen.tsx client/src/App.tsx
git commit -m "feat(auth): GateScreen + App lock-on-401 wiring"
```

---

## Self-Review

**Spec coverage:**
- §3 token model (HMAC, AUTH_SECRET fallback, deterministic, invalidation) → Task 1 ✅
- §4.1 accessToken service → Task 1 ✅; §4.2 middleware (disabled passthrough, header, GET-only query token, 401) → Task 2 ✅; §4.3 authRoute + rate limit → Task 3 ✅; §4.4 app mount order → Task 4 ✅
- §5.1 client api.ts (token helpers, apiFetch, withToken, verifyAccess, onUnauthorized) → Task 5 ✅; §5.2 GateScreen → Task 6 ✅; §5.3 App lock-on-401 → Task 6 ✅
- §6 security (timing-safe, rate limit, HMAC, GET-only query token) → Tasks 1–3 ✅
- §7 reliability table → Tasks 1/2/4 (disabled passthrough, restart stability, re-gate on change) + Task 6 (auto-relock) ✅
- §8 testing (server unit + client api unit; GateScreen/App by typecheck) → Tasks 1–6 ✅
- §10 env vars → Task 4 Step 5 ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output.

**Type consistency:** `expectedToken()/verifyCode()/verifyToken()/isAuthEnabled()` used consistently across Tasks 1–4. `apiFetch(path, init?)`, `withToken(url)`, `verifyAccess(code): {ok,status}`, `onUnauthorized(cb)` consistent across Tasks 5–6. `GateScreen({onUnlock})` matches its usage in Task 6. Token storage key `streambox_token` defined once in Task 5.
