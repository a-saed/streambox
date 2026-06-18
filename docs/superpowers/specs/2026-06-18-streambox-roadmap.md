# StreamBox — Product Roadmap & Feature Specs

**Date:** 2026-06-18  
**Goal:** Turn StreamBox into a shareable, polished streaming platform that people genuinely love — with features no existing IPTV app has.

---

## Priority Ladder

| # | Feature | Phase | Why |
|---|---------|-------|-----|
| 1 | Passphrase access gate | 1 | Can't share without it |
| 2 | Personal IPTV onboarding UI | 1 | Enables "bring your own subscription" |
| 3 | Favorites + watch history | 1 | Core retention loop |
| 4 | Match → Stream Auto-Play | 1 | Killer differentiator |
| 5 | PWA + install on homescreen | 2 | Feels like a real app |
| 6 | Smart match alerts (push) | 2 | Pulls users back at the right moment |
| 7 | Watch Together rooms | 2 | Social differentiator |
| 8 | Anonymous quality crowdsourcing | 2 | Makes pool smarter over time |
| 9 | Ghost channels | 3 | Discovery polish |
| 10 | Chromecast / AirPlay | 3 | TV viewing |

---

## Phase 1 — Foundation & Killer Feature

### 1. Passphrase Access Gate

**What it does:** Before the app loads, visitors see a simple unlock screen. They enter a passphrase configured by the owner. The token is saved in localStorage so they never type it again.

**Architecture:**
- `server/.env`: `ACCESS_CODE=your-passphrase`
- New Express middleware `src/middleware/auth.ts`: checks `Authorization: Bearer <token>` header on all `/api/*` routes. Returns `401` if missing or wrong.
- New route `POST /auth/verify` (public, not behind middleware): accepts `{ code }`, returns `{ ok: true, token: "<hashed>" }` or 401. Token is a HMAC-SHA256 of the code with a server secret — short, unguessable, not the raw passphrase.
- Client: `GateScreen` component rendered in `App.tsx` before any data loads. On submit, calls `POST /auth/verify`. On success, stores token in localStorage and sets it as the default `Authorization` header for all future API calls (`api.ts`).
- All `fetchChannels`, `fetchEPG`, `fetchMatches`, etc. already go through `API_BASE` — add the header there.

**Edge cases:**
- If server restarts with a new `ACCESS_CODE`, old tokens become invalid → user sees gate again automatically (correct behaviour).
- No rate limiting needed yet — this is a private deployment.

**Files touched:**
- `server/src/middleware/auth.ts` (new)
- `server/src/app.ts` (apply middleware)
- `server/src/routes/authRoute.ts` (new — POST /auth/verify)
- `client/src/components/GateScreen.tsx` (new)
- `client/src/lib/api.ts` (inject Authorization header)
- `client/src/App.tsx` (show GateScreen if no token)

---

### 2. Personal IPTV Onboarding UI

**What it does:** A settings panel (gear icon in sidebar) where users enter their Xtream Codes server URL, username, and password. Their personal channels load and merge into the sidebar channel list under a "My Channels" section, visually distinct from the shared hub.

**Architecture:**
- Credentials stored in localStorage only — never persisted server-side.
- Client sends credentials per-request: `GET /api/xtream/channels?url=…&user=…&pass=…`
- Server: new route `GET /api/xtream/channels` — uses existing `xtreamClient.ts` to fetch from the user's server, returns `Channel[]`. No caching server-side (client caches in localStorage with a 1h TTL).
- `SettingsPanel.tsx`: slide-in panel from the right. Fields: Server URL, Username, Password + "Connect" button. Shows channel count on success. "Disconnect" clears localStorage.
- Zustand store: `personalChannels: Channel[]`, `setPersonalChannels()`. `filtered` selector merges public + personal with personal tagged `source: 'personal'`.
- Sidebar channel list: "My Channels" header above personal results when any exist.

**Security:** Credentials travel over HTTPS (Vercel + fly.io both enforce TLS). They're never logged server-side — the route passes them straight to `xtreamClient` and discards.

**Files touched:**
- `server/src/routes/xtream.ts` (new)
- `server/src/app.ts` (mount route)
- `client/src/components/SettingsPanel.tsx` (new)
- `client/src/components/Sidebar.tsx` (settings icon + panel toggle)
- `client/src/store/useStore.ts` (personalChannels state)
- `client/src/lib/api.ts` (fetchXtreamChannels)
- `client/src/components/ChannelList.tsx` (My Channels section)

---

### 3. Favorites + Watch History

**What it does:** Users can star any channel. A "Recently watched" section shows the last 10 channels played, most recent first. Both persist in localStorage.

**Architecture — all client-side, no server changes:**
- Zustand slices:
  - `favorites: Set<string>` (channel URLs), `toggleFavorite(url)`
  - `history: Array<{ channel: Channel; watchedAt: number }>` capped at 50
  - `addToHistory(channel)` called when `status` transitions to `'playing'` in VideoPlayer
- localStorage keys: `sb_favorites`, `sb_history` — hydrated on store init.
- Sidebar: new "Favourites" tab (star icon) alongside Channels / Matches. Shows starred channels.
- ChannelRow: star icon (hollow → filled on hover if not favourite; filled → hollow on hover if favourite). Appears on hover/tap only to keep rows clean.
- Watch history: shown as a horizontal scroll strip at the top of the Channels tab (like "Continue watching"). Clicking resumes the channel instantly.

**Files touched:**
- `client/src/store/useStore.ts` (favorites + history slices)
- `client/src/components/ChannelRow.tsx` (star icon)
- `client/src/components/HistoryStrip.tsx` (new — horizontal scroll)
- `client/src/components/Sidebar.tsx` (Favourites tab)
- `client/src/components/VideoPlayer.tsx` (call addToHistory on playing)

---

### 4. Match → Stream Auto-Play

**What it does:** Tap any match card in the Matches tab → the app automatically finds the right live channel and starts playing. No searching, no browsing. This is the killer feature — no other IPTV app does it end-to-end.

**Architecture:**

**Mapping layer (server):** A `matchChannelMap.ts` file maps competition codes and broadcaster names to `HUB_CHANNEL` ids:

```typescript
// competition code → preferred hub channel ids (in priority order)
const COMPETITION_MAP: Record<string, string[]> = {
  PL:  ['bein_sports_1', 'bein_max_1', 'bein_sports_2'],
  CL:  ['bein_sports_1', 'bein_max_1', 'bein_max_2'],
  WC:  ['bein_sports_1', 'bein_ar_1'],
  PD:  ['bein_sports_2', 'bein_max_1'],
  // … etc
};

// broadcaster name → hub channel ids (for matches without competition map)
const BROADCASTER_MAP: Record<string, string[]> = {
  'beIN Sports':   ['bein_sports_1', 'bein_sports_2'],
  'beIN Sports Max': ['bein_max_1', 'bein_max_2'],
  'Sky Sports':    ['sky_sports_1', 'sky_sports_2'],
  // … etc
};
```

New endpoint: `GET /api/matches/:id/stream` — resolves the match → competition code → best live hub channel URL via `sportsPool.getBest()`. Returns `{ channelId, url, name }`.

**Client flow:**
1. User taps match card → `onWatchMatch(match)` 
2. Client calls `GET /api/matches/:id/stream`
3. While waiting: match card shows a pulsing "Finding stream…" overlay
4. On success: `setActiveChannel(channel)` → VideoPlayer starts playing
5. On failure (no stream found): toast "No live stream found for this match"

**MatchCard update:** Add a "Watch" button (play icon) on match cards. For matches that are `IN_PLAY` or starting within 30 min, the button is prominent (indigo). For future matches, it's subtle.

**Files touched:**
- `server/src/services/matchChannelMap.ts` (new)
- `server/src/routes/matches.ts` (add /:id/stream endpoint)
- `client/src/components/MatchesPanel.tsx` (Watch button, finding-stream state)
- `client/src/lib/api.ts` (fetchMatchStream)
- `client/src/store/useStore.ts` (no change needed — setActiveChannel already exists)

---

## Phase 2 — Premium Feel & Social

### 5. PWA + Install on Homescreen

**What it does:** StreamBox becomes installable on any phone or desktop — tap "Add to Home Screen" and it opens full-screen like a native app.

**Architecture:**
- `vite-plugin-pwa` (Workbox) added to `client/vite.config.ts`
- `manifest.json`: name, icons (192×192, 512×512 in indigo/violet brand color), `display: standalone`, `theme_color: #09090b`
- Service worker strategy: `NetworkFirst` for API routes (always fresh data), `CacheFirst` for static assets (fast loads)
- Offline fallback page: simple "You're offline — StreamBox needs a connection to load streams" screen
- iOS meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black`
- In-app install prompt: detect `beforeinstallprompt` event, show subtle "Install app" button in sidebar footer

**Files touched:**
- `client/vite.config.ts`
- `client/public/manifest.json` (new)
- `client/public/icons/` (new — 192, 512 PNGs)
- `client/src/components/InstallPrompt.tsx` (new)
- `client/index.html` (meta tags)

---

### 6. Smart Match Alerts (Push Notifications)

**What it does:** User taps a bell icon on a match card to set a reminder. 5 minutes before kickoff, they get a push notification: "Arsenal vs Chelsea starts in 5 min — stream is ready." Tapping the notification opens StreamBox directly to the stream.

**Architecture:**
- Requires PWA service worker (depends on item 5).
- **Client:** `subscribeToPush()` uses `PushManager.subscribe()` with the server's VAPID public key. Subscription endpoint sent to server.
- **Server:** 
  - `src/services/pushService.ts`: stores push subscriptions in SQLite (channel, subscription JSON). Uses `web-push` npm package with VAPID keys.
  - New route `POST /api/push/subscribe`: saves `{ matchId, subscription }`.
  - Background job in `index.ts`: every minute, check matches starting in 4-6 minutes → send push via `web-push.sendNotification()`.
  - Push payload: `{ title: "Arsenal vs Chelsea", body: "Kicks off in 5 min — tap to watch", url: "/watch?matchId=123" }`
- **Client service worker:** handles `push` event → shows notification with action URL.

**Files touched:**
- `server/src/services/pushService.ts` (new)
- `server/src/routes/push.ts` (new)
- `server/src/index.ts` (push scheduler)
- `client/public/sw.js` (push event handler — extends Workbox SW)
- `client/src/components/MatchesPanel.tsx` (bell icon per match)
- `client/src/lib/api.ts` (subscribeToPush, unsubscribePush)

---

### 7. Watch Together Rooms

**What it does:** Any user can start a "Watch Together" session — they get a room code (e.g. `TIGER-42`). They share it with friends. Everyone who joins watches the same channel in sync. The host controls the channel; everyone else follows automatically.

**Architecture:**
- **Transport:** Server-Sent Events (SSE) — simpler than WebSockets, works through fly.io's proxy, no extra dependencies.
- **Server:** `src/services/roomService.ts` — in-memory Map of rooms:
  ```typescript
  interface Room {
    id: string;          // "TIGER-42"
    channelUrl: string;
    hostId: string;
    members: Set<string>;
    clients: Map<string, Response>; // SSE connections
  }
  ```
  Routes:
  - `POST /api/rooms` → create room, returns `{ roomId, token }` (host token)
  - `GET /api/rooms/:id/events` → SSE stream; client receives `channel-change` events
  - `POST /api/rooms/:id/channel` → host-only (requires token); broadcasts channel change to all members
  - `DELETE /api/rooms/:id` → host closes room

- **Client:**
  - "Watch Together" button in OverlayControls (share icon).
  - Room creator: creates room, gets shareable URL `streambox.app/?room=TIGER-42`
  - Room joiner: on app load, if `?room=` param present, join room and subscribe to SSE
  - When SSE `channel-change` fires: `setActiveChannel(channel)` automatically
  - Room panel (small overlay): shows member count, room code, "Leave" button

- **Room code generation:** adjective + number (`TIGER-42`, `SOLAR-88`) — readable, shareable verbally

**Files touched:**
- `server/src/services/roomService.ts` (new)
- `server/src/routes/rooms.ts` (new)
- `client/src/components/WatchTogetherPanel.tsx` (new)
- `client/src/components/OverlayControls.tsx` (share icon)
- `client/src/lib/api.ts` (room API calls + SSE subscription)
- `client/src/App.tsx` (handle ?room= URL param on load)

---

### 8. Anonymous Quality Crowdsourcing

**What it does:** While watching, each client silently reports stream health (stall count, error rate) every 60 seconds. The server aggregates these signals to automatically promote healthy sources and demote dead ones in the sports pool — without any server-side active health checks.

**Architecture:**
- **Client:** `qualityReporter.ts` — after 60s of watching, POST `/api/quality` with:
  ```typescript
  { channelId: string; stalls: number; errors: number; playing: boolean }
  ```
  No user ID, no IP stored — purely channel-level signal.
- **Server:** `src/services/qualityAggregator.ts` — rolling 10-minute window per channel. Computes a `crowdScore` (0–1) from recent reports. `sportsPool.ts` blends `crowdScore` into source ranking (weighted 30% crowd, 70% last active health check).
- Reports written to SQLite for persistence; aggregated in-memory for fast reads.
- Clears stale data (>1h old) automatically.

**Files touched:**
- `client/src/lib/qualityReporter.ts` (new)
- `client/src/components/VideoPlayer.tsx` (call reporter)
- `server/src/services/qualityAggregator.ts` (new)
- `server/src/routes/quality.ts` (new — POST /api/quality)
- `server/src/services/sportsPool.ts` (blend crowd score into ranking)

---

## Phase 3 — Polish

### 9. Ghost Channels

**What it does:** In the HubPanel, channels with no live content right now are visually dimmed and sorted to the bottom. Channels with active EPG programs float to the top and glow. Optional "Live only" toggle hides dead channels entirely.

**Architecture:**
- Uses existing EPG data already in the store + health dots from HubPanel.
- `isLiveNow(channel)`: returns true if EPG has a program running now OR health check recently succeeded.
- HubPanel sorts channels: live-now first, then by category, then dead last.
- Dead channels get `opacity-40` + greyscale filter.
- "Live only" toggle in HubPanel header — filters to `isLiveNow === true` only.
- No server changes needed.

**Files touched:**
- `client/src/components/HubPanel.tsx` (sorting, opacity, toggle)
- `client/src/lib/epgUtils.ts` (isLiveNow helper — new or extend existing)

---

### 10. Chromecast / AirPlay

**What it does:** A cast icon in the player controls lets users send the stream to their TV via Chromecast or AirPlay.

**Architecture:**
- **AirPlay (Safari/iOS):** Already half-working — add `x-webkit-airplay="allow"` to the `<video>` element + `WebKitPlaybackTargetAvailabilityEvent` listener to show/hide the AirPlay button. iOS Safari handles the rest natively.
- **Chromecast:** Requires Google Cast SDK (`//www.gstatic.com/cv/js/sender/v1/cast_sender.js`). 
  - Register a custom Cast receiver app at cast.google.com (or use the Default Media Receiver app ID `CC1AD845` for simple streaming)
  - `CastButton` component: shows when Cast devices are available on the network
  - On cast: send the proxy stream URL (`/api/stream?url=…`) to the receiver
  - The Default Media Receiver plays HLS/MP4 natively — our proxy URL serves as the media source
  - No custom receiver app needed for phase 1 of this

**Files touched:**
- `client/index.html` (Cast SDK script tag)
- `client/src/components/CastButton.tsx` (new)
- `client/src/components/OverlayControls.tsx` (cast + AirPlay buttons)
- `client/src/components/VideoPlayer.tsx` (`x-webkit-airplay` attribute)

---

## Implementation Order

```
Phase 1 (ship first — makes it shareable):
  1 → 2 → 3 → 4

Phase 2 (ship second — makes it loved):
  5 → 6 → 7 → 8
  (5 must come before 6 — push requires service worker)
  (7 and 8 are independent of each other)

Phase 3 (polish — nice to have):
  9 and 10 are independent
```

## Tech Decisions Locked In

- **Auth:** HMAC token, not JWT — simpler, no library needed
- **Rooms:** SSE not WebSockets — works through fly.io proxy, no extra config
- **Personal IPTV:** localStorage only — no server-side credential storage
- **Push:** `web-push` (VAPID) — works on all browsers including Safari 16.4+
- **Quality reports:** anonymous, no IP logging, SQLite for persistence
- **Chromecast:** Default Media Receiver first — no custom app registration required
