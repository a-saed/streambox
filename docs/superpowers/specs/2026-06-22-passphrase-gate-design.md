# Passphrase Access Gate — Design

**Date:** 2026-06-22
**Status:** Approved (brainstorming) — pending spec review
**Roadmap item:** StreamBox Phase 1, Feature #1 (`docs/superpowers/specs/2026-06-18-streambox-roadmap.md`)

## 1. Goal

Gate the app behind a single shared passphrase so the owner can share it without it being fully public. A visitor enters the passphrase once; a derived token is stored in the browser so they never type it again. This is a private-deployment access gate, not a multi-user auth system.

## 2. Key constraint that shaped the design

The app loads `/api` URLs through two channels that **cannot send an `Authorization` header**:

1. **Video playback** — `proxyStreamUrl()` returns `/api/stream?url=…`, `/api/daddylive/:id`, `/api/bintv/<token>`; these are loaded by the HLS player / `<video>` element.
2. **SSE scan** — `new EventSource('/api/hub/:id/scan')`; `EventSource` cannot set headers.

The deployment is **cross-origin** (Dockerfile runs the server only; the client is hosted separately and talks to the API via `VITE_API_URL`, with CORS enabled), which makes cross-origin cookies + a `<video>` element unreliable. Therefore auth uses a **hybrid transport**: `Authorization` header for JSON calls, `?token=` query param for media/SSE.

## 3. Token model

- `token = base64url(HMAC-SHA256(key, message))` where `key = AUTH_SECRET`, `message = ACCESS_CODE`.
- `AUTH_SECRET` is an optional env var. When unset, a fixed in-code pepper string is used as the key so tokens remain **stable across server restarts**. Production deployments SHOULD set `AUTH_SECRET` for real key entropy.
- The token is **stateless and deterministic**: the server recomputes the expected token per request and compares — no session store. Changing `ACCESS_CODE` or `AUTH_SECRET` invalidates every issued token, so users are re-gated automatically (correct behaviour).
- The raw passphrase is never returned to the client and never stored client-side. Only the derived token is stored. The token does not reveal the passphrase.

## 4. Server components

### 4.1 `server/src/services/accessToken.ts` (new — pure, testable)
- `isAuthEnabled(): boolean` — true iff `process.env.ACCESS_CODE` is a non-empty string.
- `expectedToken(): string` — the HMAC token for the current `ACCESS_CODE` + key. Returns `''` when auth disabled.
- `verifyCode(code: string): boolean` — timing-safe (`crypto.timingSafeEqual`) compare of `code` to `ACCESS_CODE`. Length-mismatch returns false without throwing.
- `verifyToken(token: string): boolean` — timing-safe compare of `token` to `expectedToken()`.

### 4.2 `server/src/middleware/auth.ts` (new)
- Express middleware applied to `/api/*` (mounted before the API routers in `app.ts`).
- If `!isAuthEnabled()` → `next()` (gate disabled; keeps local dev frictionless).
- Otherwise resolve the candidate token:
  - from `Authorization: Bearer <t>` header (any method), OR
  - from `req.query.token` **only when `req.method === 'GET'`** (so media/SSE GETs authenticate; non-GET mutations must use the header, narrowing where a URL-borne token is valid).
- `verifyToken(candidate)` → `next()`, else `res.status(401).json({ error: 'unauthorized' })`.

### 4.3 `server/src/routes/authRoute.ts` (new — public)
- Mounted at `/auth` **before** the auth middleware so it is reachable without a token.
- `POST /auth/verify`, body `{ code: string }`:
  - In-memory per-IP rate limit: max 10 attempts per 5-minute sliding window → `429 { error: 'too_many_attempts' }`. A successful verify clears that IP's counter.
  - `verifyCode(code)` true → `200 { ok: true, token: expectedToken() }`; false → `401 { ok: false }`.
- The limiter is a module-level `Map<ip, number[]>` of attempt timestamps, pruned per request. No external dependency.

### 4.4 `server/src/app.ts` (modified)
- Mount order: `cors`, `express.json`, `GET /health` (public), `app.use('/auth', authRoute)` (public), then `app.use('/api', authMiddleware)`, then the existing `/api/*` routers.

## 5. Client components

### 5.1 `client/src/lib/api.ts` (modified)
- Token helpers: `getToken()`, `setToken(t)`, `clearToken()` backed by `localStorage` key `streambox_token`.
- `onUnauthorized(cb)` — register a single callback the app uses to react to a `401` (clear token + show gate).
- `apiFetch(path, init?)` — wraps `fetch`, injects `Authorization: Bearer <token>` when a token exists; on a `401` response it calls `clearToken()` and the registered unauthorized callback, then throws. All existing JSON fetch functions (`fetchChannels`, `fetchEPG`, `fetchMatches`, `fetchHub*`, `discoverPortals`) route through `apiFetch`.
- `withToken(url)` helper — appends `?token=<t>` (or `&token=`) when a token exists. `proxyStreamUrl()` and `scanHubChannel()`'s `EventSource` URL use `withToken`.
- `verifyAccess(code)` — `POST /auth/verify`; on `{ ok, token }` stores the token and returns true; on `401`/`429` returns a typed result the gate can show.

### 5.2 `client/src/components/GateScreen.tsx` (new)
- Centered unlock screen matching the existing StreamBox visual style (reuse the `App.tsx` loader aesthetic). Passphrase input + unlock button.
- Submit → `verifyAccess(code)`. Success → notify `App` to proceed. Wrong code → inline error; rate-limited (`429`) → "too many attempts, wait a minute" message. Error clears on next keystroke.

### 5.3 `client/src/App.tsx` (modified)
- State `locked: boolean`. On mount, attempt the initial data load (`fetchChannels` etc.) through `apiFetch`.
  - A `401` (via `onUnauthorized`) sets `locked = true` → render `GateScreen`.
  - Success → render the app as today.
- If the server has no `ACCESS_CODE`, requests succeed and the gate never appears — no status endpoint required.
- After a successful gate unlock, re-run the initial load and clear `locked`.

## 6. Security posture

- Timing-safe comparisons for both the passphrase and the token (no timing oracle).
- Brute-force resistance via the `/auth/verify` rate limit.
- The token is an HMAC, never the passphrase; the passphrase is never stored or echoed.
- Query-param token is honored **only on GET**, narrowing the surface of a leaked URL.
- Relies on **HTTPS in production** (fly.io) so the `?token=` is not exposed in transit.
- If request logging is ever added to the server, the `token` query param MUST be redacted. (No request logger exists today.)

## 7. Error handling & reliability

| Situation | Behaviour |
|---|---|
| `ACCESS_CODE` unset | Gate disabled; app fully open (dev/default) |
| No token / wrong token on `/api/*` | `401`; client clears token, shows gate |
| Server restart, same `ACCESS_CODE`+`AUTH_SECRET` | Stored token still valid; no re-gate |
| `ACCESS_CODE` or `AUTH_SECRET` changed | Old tokens invalid → user re-gated automatically |
| Repeated wrong codes | `429` after 10/5 min per IP |
| Media/SSE request without token | `401` (won't play); the JSON load 401s first and shows the gate before playback is attempted |

## 8. Testing strategy

**Server (unit):**
- `accessToken`: token determinism; `verifyCode` right/wrong/length-mismatch; `verifyToken` valid/invalid; `isAuthEnabled` true/false; token changes when secret changes.
- `auth` middleware: disabled-passthrough; valid header; valid GET `?token=`; rejected POST `?token=`; missing/bad token → 401.
- `authRoute`: correct code → token; wrong code → 401; >10 attempts → 429; success resets the counter.

**Client (unit):**
- `apiFetch` injects header and, on 401, clears token + fires the unauthorized callback.
- `withToken` appends the token correctly to both query-less and query-bearing URLs.
- `GateScreen` happy path (calls verify, stores token) and error path (wrong code shows message).

## 9. Out of scope

- Multiple users / per-user accounts / roles.
- Token expiry/rotation beyond secret change.
- Server-side request logging (and thus token redaction is only a documented note).
- Password reset / recovery flows.

## 10. Env vars

```
# server/.env
ACCESS_CODE=your-passphrase        # unset = gate disabled
AUTH_SECRET=long-random-string     # optional; recommended in prod for token key entropy
```
