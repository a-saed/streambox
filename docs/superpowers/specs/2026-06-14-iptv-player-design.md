# IPTV Streaming Web App — Design Spec

**Date:** 2026-06-14  
**Stack:** React + Vite + shadcn/ui + Tailwind + Zustand + hls.js (frontend) · Node.js + Express (backend)  
**Phase:** 1 of 2 (Phase 2 = favorites + user settings)

---

## Goal

A modern, immersive IPTV web player that streams free-to-air channels from the `iptv-org/iptv` community playlist. Runs locally. Full-screen video-first UI with a slide-in sidebar, EPG strip, and glassmorphism dark theme.

---

## Architecture

```
Browser (React)
    ↕ REST API calls
Express Server (Node.js)
    ├── GET /api/channels       → cached parsed M3U channel list
    ├── GET /api/epg            → cached parsed EPG schedule
    └── GET /api/stream?url=    → proxies HLS stream (avoids CORS)
```

- No database in Phase 1 — all data cached in-memory on the Express server
- Backend refreshes M3U and EPG data every hour
- Frontend never calls iptv-org directly — all requests go through Express

---

## Data Sources

- **Channels (M3U):** `https://iptv-org.github.io/iptv/index.m3u` — master playlist with 8000+ free-to-air channels
- **EPG:** `https://iptv-org.github.io/epg/` — XML program guide data per channel
- Each channel entry contains: name, logo URL, stream URL, category, country, language

---

## Backend

### Stack
- Node.js + Express
- `iptv-parser` or custom M3U parser
- `node-fetch` for fetching upstream data
- `node-xml2js` for EPG XML parsing

### Routes

| Route | Description |
|---|---|
| `GET /api/channels` | Returns full channel list. Supports `?category=` and `?search=` query params |
| `GET /api/epg` | Returns EPG schedule map: `{ channelId: [{ title, start, end }] }` |
| `GET /api/stream?url=` | Proxies HLS manifest (`.m3u8`) and rewrites segment URLs so `.ts` chunks also route through the proxy — avoids CORS on all HLS traffic |

### Caching Strategy
- On startup: fetch M3U → parse → store in memory as `channels[]`
- On startup: fetch EPG XML → parse → store as `epg{}` map
- `setInterval` refreshes both every 60 minutes
- `/api/channels` responds from cache instantly

---

## Frontend

### Stack
- React 18 + Vite
- shadcn/ui + Tailwind CSS (dark theme)
- Zustand (global state)
- hls.js (HLS stream playback)
- react-window (virtualized channel list for performance)

### Component Tree

```
App
├── VideoPlayer         hls.js instance, swaps src on channel change
├── Sidebar             slides in from left on toggle
│   ├── SearchBar       debounced input, updates Zustand filtered[]
│   ├── CategoryTabs    shadcn Tabs, filters by category
│   └── ChannelList     react-window virtualized list, channel logo + name
├── EPGStrip            bottom bar — current + next program for active channel
└── OverlayControls     top bar — volume slider, fullscreen, channel name; fades after 3s idle
```

### UI Layout

```
┌─────────────────────────────────────────────────────┐
│  [≡]  IPTV                          Vol  [⛶]       │  ← overlay (fades on idle)
│                                                     │
│               VIDEO PLAYER (full screen)            │
│                                                     │
├─────────────────────────────────────────────────────┤
│  📺 Channel Name   Now: Show Title │ Next: Next Show │  ← EPG strip
└─────────────────────────────────────────────────────┘

Sidebar open state:
┌──────────┬──────────────────────────────────────────┐
│ 🔍 Search │                                          │
│ [All][News][Sports][Movies]...                       │
│──────────│                                          │
│ 🏳 Chan 1 │         VIDEO PLAYER                   │
│ 🏳 Chan 2 │                                         │
│ 🏳 Chan 3 │                                         │
└──────────┴──────────────────────────────────────────┘
```

### Zustand Store

```ts
interface Store {
  channels: Channel[]       // full list from /api/channels
  filtered: Channel[]       // after search + category filter
  activeChannel: Channel | null
  epg: Record<string, EPGEntry[]>
  sidebarOpen: boolean
  category: string          // active category filter
  searchQuery: string
}
```

### Styling
- Global dark background: `bg-zinc-950`
- Sidebar: `backdrop-blur-md bg-zinc-900/70` (glassmorphism)
- Active channel: glowing ring `ring-2 ring-primary/60`
- Smooth sidebar transition: `transition-transform duration-300`
- shadcn components: `Tabs`, `Input`, `Slider`, `ScrollArea`, `Badge`

---

## Project Structure

```
iptv-streaming/
├── client/                  # React + Vite app
│   ├── src/
│   │   ├── components/
│   │   │   ├── VideoPlayer.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── ChannelList.tsx
│   │   │   ├── CategoryTabs.tsx
│   │   │   ├── EPGStrip.tsx
│   │   │   └── OverlayControls.tsx
│   │   ├── store/
│   │   │   └── useStore.ts
│   │   ├── lib/
│   │   │   └── api.ts       # fetch helpers for Express API
│   │   └── App.tsx
│   └── package.json
├── server/                  # Node.js + Express
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   │   ├── channels.ts
│   │   │   ├── epg.ts
│   │   │   └── stream.ts
│   │   └── services/
│   │       ├── m3uParser.ts
│   │       └── epgParser.ts
│   └── package.json
└── docs/
```

---

## Phase 2 (Planned, Not In Scope Now)

- Favorites: star a channel, persist to localStorage or a SQLite DB
- User settings: default category, preferred language, theme toggle
- Watch history: last 10 channels viewed

---

## Success Criteria

- [ ] Channels load from iptv-org and display in sidebar
- [ ] Clicking a channel plays the stream full-screen via hls.js
- [ ] Search and category filter work in real-time
- [ ] EPG strip shows current and next program
- [ ] UI controls fade out after 3s of mouse inactivity
- [ ] Sidebar slides in/out smoothly
- [ ] No CORS errors — all stream traffic goes through the proxy
