# IPTV Streaming Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-screen IPTV web player with glassmorphism sidebar, EPG strip, and HLS stream proxying, fed by iptv-org/iptv free-to-air playlists.

**Architecture:** Express backend caches M3U + EPG data in memory and exposes three API routes; React + Vite frontend with Zustand state, hls.js playback, and shadcn/ui dark components consumes those routes. All stream traffic is proxied through the backend to avoid CORS.

**Tech Stack:** React 18, Vite, TypeScript, shadcn/ui, Tailwind CSS, Zustand, hls.js, react-window, react-virtualized-auto-sizer / Node.js 18+, Express, TypeScript, tsx, Vitest

---

## File Map

```
iptv-streaming/
├── package.json                          root: concurrently script
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                      Express entry, CORS, route mounting, initCache
│       ├── types.ts                      Channel, EPGEntry, EPGSchedule
│       ├── cache.ts                      in-memory store, fetch+parse on startup, 1h refresh
│       ├── services/
│       │   ├── m3uParser.ts              parseM3U(text) → Channel[]
│       │   └── epgParser.ts              parseEPG(xml) → EPGSchedule
│       ├── routes/
│       │   ├── channels.ts               GET /api/channels
│       │   ├── epg.ts                    GET /api/epg
│       │   └── stream.ts                 GET /api/stream?url= (HLS proxy)
│       └── __tests__/
│           ├── m3uParser.test.ts
│           ├── epgParser.test.ts
│           └── stream.test.ts
└── client/
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── index.css
        ├── App.tsx
        ├── types.ts                      Channel, EPGEntry, EPGSchedule (client-side)
        ├── store/
        │   └── useStore.ts               Zustand store
        ├── lib/
        │   └── api.ts                    fetch helpers + proxyStreamUrl
        └── components/
            ├── VideoPlayer.tsx
            ├── Sidebar.tsx
            ├── SearchBar.tsx
            ├── CategoryTabs.tsx
            ├── ChannelList.tsx
            ├── EPGStrip.tsx
            └── OverlayControls.tsx
```

---

## Task 1: Root + Server Scaffolding

**Files:**
- Create: `package.json` (root)
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/types.ts`
- Create: `server/src/index.ts` (health-check only for now)

- [ ] **Step 1: Write root package.json**

```json
{
  "name": "iptv-streaming",
  "private": true,
  "scripts": {
    "dev": "concurrently \"npm run dev --prefix server\" \"npm run dev --prefix client\"",
    "install:all": "npm install --prefix server && npm install --prefix client"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

- [ ] **Step 2: Write server/package.json**

```json
{
  "name": "iptv-server",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "xml2js": "^0.6.2"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.0.0",
    "@types/xml2js": "^0.4.14",
    "tsx": "^4.11.0",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 3: Write server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Write server/src/types.ts**

```typescript
export interface Channel {
  id: string;
  name: string;
  logo: string;
  url: string;
  category: string;
  country: string;
  language: string;
  tvgUrl?: string;
}

export interface EPGEntry {
  channelId: string;
  title: string;
  start: string; // ISO 8601
  end: string;   // ISO 8601
}

export type EPGSchedule = Record<string, EPGEntry[]>;
```

- [ ] **Step 5: Write server/src/index.ts (health check only)**

```typescript
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () =>
  console.log(`[server] Running on http://localhost:${PORT}`)
);
```

- [ ] **Step 6: Install server dependencies**

Run from `server/`:
```bash
cd server && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Verify server starts**

```bash
cd server && npm run dev
```

In a second terminal:
```bash
curl http://localhost:3001/health
```

Expected: `{"ok":true}`

Stop the server (Ctrl+C).

- [ ] **Step 8: Install root dependencies**

```bash
cd /home/asaed/apdo/projects/iptv-streaming && npm install
```

- [ ] **Step 9: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git init
git add server/package.json server/tsconfig.json server/src/types.ts server/src/index.ts package.json
git commit -m "feat: server scaffolding with health check"
```

---

## Task 2: M3U Parser + Tests

**Files:**
- Create: `server/src/services/m3uParser.ts`
- Create: `server/src/__tests__/m3uParser.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/__tests__/m3uParser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseM3U } from '../services/m3uParser';

const SAMPLE = `#EXTM3U
#EXTINF:-1 tvg-id="AlJazeera.qa" tvg-logo="https://logo.url/aj.png" group-title="News" tvg-country="QA" tvg-language="Arabic" tvg-url="https://epg.url/qa.xml",Al Jazeera
http://stream.aljazeera.net/live.m3u8
#EXTINF:-1 tvg-id="BBC.uk" group-title="News" tvg-country="GB" tvg-language="English",BBC News
http://bbc.stream.url/live.m3u8`;

describe('parseM3U', () => {
  it('returns empty array for empty input', () => {
    expect(parseM3U('')).toEqual([]);
  });

  it('parses correct number of channels', () => {
    expect(parseM3U(SAMPLE)).toHaveLength(2);
  });

  it('parses all channel fields', () => {
    const [ch] = parseM3U(SAMPLE);
    expect(ch.id).toBe('AlJazeera.qa');
    expect(ch.name).toBe('Al Jazeera');
    expect(ch.logo).toBe('https://logo.url/aj.png');
    expect(ch.url).toBe('http://stream.aljazeera.net/live.m3u8');
    expect(ch.category).toBe('News');
    expect(ch.country).toBe('QA');
    expect(ch.language).toBe('Arabic');
    expect(ch.tvgUrl).toBe('https://epg.url/qa.xml');
  });

  it('defaults missing optional fields to empty string', () => {
    const [, ch2] = parseM3U(SAMPLE);
    expect(ch2.logo).toBe('');
    expect(ch2.tvgUrl).toBeUndefined();
  });

  it('skips entries with no stream URL', () => {
    const input = '#EXTM3U\n#EXTINF:-1,NoStream';
    expect(parseM3U(input)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd server && npm test
```

Expected: FAIL — `Cannot find module '../services/m3uParser'`

- [ ] **Step 3: Implement m3uParser**

Create `server/src/services/m3uParser.ts`:

```typescript
import { Channel } from '../types';

export function parseM3U(text: string): Channel[] {
  const channels: Channel[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF')) continue;

    const id       = line.match(/tvg-id="([^"]*)"/)?.[1] ?? '';
    const logo     = line.match(/tvg-logo="([^"]*)"/)?.[1] ?? '';
    const category = line.match(/group-title="([^"]*)"/)?.[1] ?? 'Other';
    const country  = line.match(/tvg-country="([^"]*)"/)?.[1] ?? '';
    const language = line.match(/tvg-language="([^"]*)"/)?.[1] ?? '';
    const tvgUrl   = line.match(/tvg-url="([^"]*)"/)?.[1] || undefined;
    const name     = line.match(/,([^,]+)$/)?.[1]?.trim() ?? 'Unknown';

    // Find next non-empty, non-comment line as the stream URL
    let url = '';
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (next && !next.startsWith('#')) { url = next; break; }
    }

    if (url) {
      channels.push({ id, name, logo, url, category, country, language, tvgUrl });
    }
  }

  return channels;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd server && npm test
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git add server/src/services/m3uParser.ts server/src/__tests__/m3uParser.test.ts
git commit -m "feat: M3U parser with tests"
```

---

## Task 3: EPG Parser + Tests

**Files:**
- Create: `server/src/services/epgParser.ts`
- Create: `server/src/__tests__/epgParser.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/__tests__/epgParser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseEPG } from '../services/epgParser';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="AlJazeera.qa">
    <display-name>Al Jazeera</display-name>
  </channel>
  <programme start="20260614120000 +0000" stop="20260614130000 +0000" channel="AlJazeera.qa">
    <title lang="en">World News</title>
  </programme>
  <programme start="20260614130000 +0000" stop="20260614140000 +0000" channel="AlJazeera.qa">
    <title lang="en">The Listening Post</title>
  </programme>
</tv>`;

describe('parseEPG', () => {
  it('returns empty schedule for empty xml', async () => {
    const result = await parseEPG('<tv></tv>');
    expect(result).toEqual({});
  });

  it('groups programmes by channel id', async () => {
    const schedule = await parseEPG(SAMPLE_XML);
    expect(Object.keys(schedule)).toContain('AlJazeera.qa');
    expect(schedule['AlJazeera.qa']).toHaveLength(2);
  });

  it('parses programme title correctly', async () => {
    const schedule = await parseEPG(SAMPLE_XML);
    expect(schedule['AlJazeera.qa'][0].title).toBe('World News');
  });

  it('parses start and end as ISO strings', async () => {
    const schedule = await parseEPG(SAMPLE_XML);
    const entry = schedule['AlJazeera.qa'][0];
    expect(new Date(entry.start).toISOString()).toBe('2026-06-14T12:00:00.000Z');
    expect(new Date(entry.end).toISOString()).toBe('2026-06-14T13:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd server && npm test
```

Expected: FAIL — `Cannot find module '../services/epgParser'`

- [ ] **Step 3: Implement epgParser**

Create `server/src/services/epgParser.ts`:

```typescript
import { parseStringPromise } from 'xml2js';
import { EPGEntry, EPGSchedule } from '../types';

function parseXMLTVDate(dateStr: string): string {
  const m = dateStr.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!m) return new Date().toISOString();
  const [, year, month, day, hour, min, sec, tz] = m;
  const offset = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : '+00:00';
  return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}${offset}`).toISOString();
}

export async function parseEPG(xml: string): Promise<EPGSchedule> {
  const result = await parseStringPromise(xml, { explicitArray: true });
  const schedule: EPGSchedule = {};

  const programmes: any[] = result?.tv?.programme ?? [];

  for (const prog of programmes) {
    const channelId: string = prog.$?.channel ?? '';
    if (!channelId) continue;

    const titleRaw = prog.title?.[0];
    const title = typeof titleRaw === 'string' ? titleRaw : titleRaw?._ ?? 'Unknown';
    const start = parseXMLTVDate(prog.$?.start ?? '');
    const end   = parseXMLTVDate(prog.$?.stop  ?? '');

    if (!schedule[channelId]) schedule[channelId] = [];
    schedule[channelId].push({ channelId, title, start, end });
  }

  return schedule;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd server && npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git add server/src/services/epgParser.ts server/src/__tests__/epgParser.test.ts
git commit -m "feat: XMLTV EPG parser with tests"
```

---

## Task 4: Cache Service

**Files:**
- Create: `server/src/cache.ts`

- [ ] **Step 1: Write cache.ts**

```typescript
import { Channel, EPGSchedule } from './types';
import { parseM3U } from './services/m3uParser';
import { parseEPG } from './services/epgParser';

const M3U_URL = 'https://iptv-org.github.io/iptv/index.m3u';
const REFRESH_MS = 60 * 60 * 1000; // 1 hour

let channels: Channel[] = [];
let epg: EPGSchedule = {};
let categories: string[] = [];

export const getChannels  = (): Channel[]     => channels;
export const getEPG       = (): EPGSchedule   => epg;
export const getCategories = (): string[]     => categories;

async function fetchAndCacheEPG(): Promise<void> {
  const urls = [...new Set(channels.filter(c => c.tvgUrl).map(c => c.tvgUrl!))];

  const merged: EPGSchedule = {};
  await Promise.allSettled(
    urls.slice(0, 10).map(async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return;
        const xml = await res.text();
        const schedule = await parseEPG(xml);
        Object.assign(merged, schedule);
      } catch {
        // silently skip unreachable EPG sources
      }
    })
  );

  epg = merged;
  console.log(`[cache] EPG loaded for ${Object.keys(epg).length} channels`);
}

async function fetchAndCacheChannels(): Promise<void> {
  try {
    const res = await fetch(M3U_URL, { signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    channels = parseM3U(text);
    categories = [...new Set(channels.map(c => c.category))].sort();
    console.log(`[cache] Loaded ${channels.length} channels across ${categories.length} categories`);
    await fetchAndCacheEPG();
  } catch (err) {
    console.error('[cache] Failed to load channels:', err);
  }
}

export async function initCache(): Promise<void> {
  await fetchAndCacheChannels();
  setInterval(fetchAndCacheChannels, REFRESH_MS);
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git add server/src/cache.ts
git commit -m "feat: in-memory cache with hourly refresh"
```

---

## Task 5: API Routes + Stream Proxy

**Files:**
- Create: `server/src/routes/channels.ts`
- Create: `server/src/routes/epg.ts`
- Create: `server/src/routes/stream.ts`
- Create: `server/src/__tests__/stream.test.ts`

- [ ] **Step 1: Write channels route**

Create `server/src/routes/channels.ts`:

```typescript
import { Router } from 'express';
import { getChannels, getCategories } from '../cache';

const router = Router();

router.get('/', (req, res) => {
  let result = getChannels();
  const { category, search } = req.query as { category?: string; search?: string };

  if (category && category !== 'All') {
    result = result.filter(c => c.category === category);
  }
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(c => c.name.toLowerCase().includes(q));
  }

  res.json({ channels: result, categories: getCategories() });
});

export default router;
```

- [ ] **Step 2: Write EPG route**

Create `server/src/routes/epg.ts`:

```typescript
import { Router } from 'express';
import { getEPG } from '../cache';

const router = Router();

router.get('/', (_, res) => {
  res.json(getEPG());
});

export default router;
```

- [ ] **Step 3: Write failing stream proxy test**

Create `server/src/__tests__/stream.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// Inline the rewrite function to test it in isolation
function rewriteM3U8(text: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  return text
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const absolute = new URL(trimmed, base).toString();
      return `/api/stream?url=${encodeURIComponent(absolute)}`;
    })
    .join('\n');
}

describe('rewriteM3U8', () => {
  it('leaves comment and empty lines unchanged', () => {
    const input = '#EXTM3U\n#EXT-X-VERSION:3\n';
    expect(rewriteM3U8(input, 'http://cdn.example.com/stream.m3u8')).toBe(input);
  });

  it('rewrites relative segment URLs through proxy', () => {
    const input = '#EXTM3U\nseg001.ts';
    const result = rewriteM3U8(input, 'http://cdn.example.com/live/stream.m3u8');
    expect(result).toContain('/api/stream?url=');
    expect(result).toContain(encodeURIComponent('http://cdn.example.com/live/seg001.ts'));
  });

  it('rewrites absolute segment URLs through proxy', () => {
    const input = '#EXTM3U\nhttp://other.cdn.com/seg001.ts';
    const result = rewriteM3U8(input, 'http://cdn.example.com/stream.m3u8');
    expect(result).toContain(encodeURIComponent('http://other.cdn.com/seg001.ts'));
  });

  it('rewrites sub-playlist references through proxy', () => {
    const input = '#EXTM3U\nvariant_720p.m3u8';
    const result = rewriteM3U8(input, 'http://cdn.example.com/master.m3u8');
    expect(result).toContain(encodeURIComponent('http://cdn.example.com/variant_720p.m3u8'));
  });
});
```

- [ ] **Step 4: Run stream test — expect failure**

```bash
cd server && npm test -- stream
```

Expected: FAIL — `rewriteM3U8 is not defined` (function not imported yet).

- [ ] **Step 5: Write stream proxy route**

Create `server/src/routes/stream.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { Readable } from 'stream';

const router = Router();

function rewriteM3U8(text: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  return text
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const absolute = new URL(trimmed, base).toString();
      return `/api/stream?url=${encodeURIComponent(absolute)}`;
    })
    .join('\n');
}

router.get('/', async (req: Request, res: Response) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: 'url query param required' });

  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'upstream returned error' });
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    const isM3U8 = url.includes('.m3u8') || contentType.includes('mpegurl');

    res.set('Access-Control-Allow-Origin', '*');

    if (isM3U8) {
      const text = await upstream.text();
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewriteM3U8(text, url));
    }

    res.set('Content-Type', contentType || 'application/octet-stream');
    Readable.fromWeb(upstream.body as any).pipe(res);
  } catch (err: any) {
    if (err.name === 'TimeoutError') return res.status(504).json({ error: 'upstream timeout' });
    return res.status(502).json({ error: 'proxy error' });
  }
});

export default router;
```

- [ ] **Step 6: Update stream.test.ts to import from the route file**

Update `server/src/__tests__/stream.test.ts` — replace the inline `rewriteM3U8` with an import. First, export it from the route file by adding this line at the bottom of `stream.ts`:

```typescript
export { rewriteM3U8 };
```

Then update the test file:

```typescript
import { describe, it, expect } from 'vitest';
import { rewriteM3U8 } from '../routes/stream';

describe('rewriteM3U8', () => {
  it('leaves comment and empty lines unchanged', () => {
    const input = '#EXTM3U\n#EXT-X-VERSION:3\n';
    expect(rewriteM3U8(input, 'http://cdn.example.com/stream.m3u8')).toBe(input);
  });

  it('rewrites relative segment URLs through proxy', () => {
    const input = '#EXTM3U\nseg001.ts';
    const result = rewriteM3U8(input, 'http://cdn.example.com/live/stream.m3u8');
    expect(result).toContain('/api/stream?url=');
    expect(result).toContain(encodeURIComponent('http://cdn.example.com/live/seg001.ts'));
  });

  it('rewrites absolute segment URLs through proxy', () => {
    const input = '#EXTM3U\nhttp://other.cdn.com/seg001.ts';
    const result = rewriteM3U8(input, 'http://cdn.example.com/stream.m3u8');
    expect(result).toContain(encodeURIComponent('http://other.cdn.com/seg001.ts'));
  });

  it('rewrites sub-playlist references through proxy', () => {
    const input = '#EXTM3U\nvariant_720p.m3u8';
    const result = rewriteM3U8(input, 'http://cdn.example.com/master.m3u8');
    expect(result).toContain(encodeURIComponent('http://cdn.example.com/variant_720p.m3u8'));
  });
});
```

- [ ] **Step 7: Run all server tests — expect pass**

```bash
cd server && npm test
```

Expected: All tests PASS (m3uParser, epgParser, stream).

- [ ] **Step 8: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git add server/src/routes/ server/src/__tests__/stream.test.ts
git commit -m "feat: channels, EPG, and stream proxy routes"
```

---

## Task 6: Wire Up Server Entry Point

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Replace index.ts with full version**

```typescript
import express from 'express';
import cors from 'cors';
import channelsRouter from './routes/channels';
import epgRouter from './routes/epg';
import streamRouter from './routes/stream';
import { initCache } from './cache';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true }));
app.use('/api/channels', channelsRouter);
app.use('/api/epg', epgRouter);
app.use('/api/stream', streamRouter);

async function start() {
  await initCache();
  app.listen(PORT, () =>
    console.log(`[server] Listening on http://localhost:${PORT}`)
  );
}

start();
```

- [ ] **Step 2: Start server and verify channels load**

```bash
cd server && npm run dev
```

Expected output (after ~10-30 seconds while M3U fetches):
```
[server] Listening on http://localhost:3001
[cache] Loaded XXXX channels across XX categories
[cache] EPG loaded for X channels
```

- [ ] **Step 3: Verify channels API**

```bash
curl "http://localhost:3001/api/channels?category=News" | head -c 500
```

Expected: JSON with `{ channels: [...], categories: [...] }`.

Stop the server.

- [ ] **Step 4: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git add server/src/index.ts
git commit -m "feat: wire server entry with cache init and routes"
```

---

## Task 7: Client Scaffolding + shadcn Setup

**Files:**
- Create: `client/` (via Vite)
- Modify: `client/vite.config.ts`
- Create: `client/tailwind.config.ts`
- Create: `client/src/index.css`

- [ ] **Step 1: Scaffold React+TS app with Vite**

From project root:
```bash
cd /home/asaed/apdo/projects/iptv-streaming
npm create vite@latest client -- --template react-ts
```

- [ ] **Step 2: Install client dependencies**

```bash
cd client
npm install
npm install zustand hls.js react-window react-virtualized-auto-sizer
npm install -D @types/react-window @types/react-virtualized-auto-sizer
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p --ts
```

- [ ] **Step 3: Update client/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
```

- [ ] **Step 4: Update client/tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#6366f1',
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 5: Replace client/src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  overflow: hidden;
  background: #09090b;
}
```

- [ ] **Step 6: Initialize shadcn**

```bash
cd client
npx shadcn@latest init --yes
```

When prompted:
- Style: **Default**
- Base color: **Zinc**
- CSS variables: **Yes**

- [ ] **Step 7: Add shadcn components**

```bash
cd client
npx shadcn@latest add tabs input slider scroll-area badge button
```

- [ ] **Step 8: Verify client builds**

```bash
cd client && npm run build
```

Expected: Build succeeds, `dist/` created.

- [ ] **Step 9: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git add client/
git commit -m "feat: client scaffolding with Vite, shadcn, Tailwind"
```

---

## Task 8: Client Types + Zustand Store + Tests

**Files:**
- Create: `client/src/types.ts`
- Create: `client/src/store/useStore.ts`
- Create: `client/src/store/useStore.test.ts`

- [ ] **Step 1: Write client/src/types.ts**

```typescript
export interface Channel {
  id: string;
  name: string;
  logo: string;
  url: string;
  category: string;
  country: string;
  language: string;
}

export interface EPGEntry {
  channelId: string;
  title: string;
  start: string;
  end: string;
}

export type EPGSchedule = Record<string, EPGEntry[]>;
```

- [ ] **Step 2: Write failing store test**

Create `client/src/store/useStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './useStore';
import type { Channel } from '../types';

const makeChannel = (overrides: Partial<Channel> = {}): Channel => ({
  id: '1', name: 'BBC News', logo: '', url: 'http://1', category: 'News', country: 'GB', language: 'English',
  ...overrides,
});

beforeEach(() => {
  useStore.setState({
    channels: [], filtered: [], activeChannel: null,
    epg: {}, sidebarOpen: true, category: 'All', searchQuery: '',
  });
});

describe('useStore', () => {
  it('setChannels populates both channels and filtered', () => {
    useStore.getState().setChannels([makeChannel()]);
    expect(useStore.getState().channels).toHaveLength(1);
    expect(useStore.getState().filtered).toHaveLength(1);
  });

  it('setSearchQuery filters by name case-insensitively', () => {
    useStore.getState().setChannels([
      makeChannel({ id: '1', name: 'BBC News' }),
      makeChannel({ id: '2', name: 'Al Jazeera', url: 'http://2' }),
    ]);
    useStore.getState().setSearchQuery('bbc');
    expect(useStore.getState().filtered).toHaveLength(1);
    expect(useStore.getState().filtered[0].name).toBe('BBC News');
  });

  it('setCategory filters by category', () => {
    useStore.getState().setChannels([
      makeChannel({ id: '1', name: 'BBC', category: 'News' }),
      makeChannel({ id: '2', name: 'MTV', url: 'http://2', category: 'Music' }),
    ]);
    useStore.getState().setCategory('Music');
    expect(useStore.getState().filtered).toHaveLength(1);
    expect(useStore.getState().filtered[0].name).toBe('MTV');
  });

  it('setCategory All shows all channels', () => {
    useStore.getState().setChannels([
      makeChannel({ id: '1', category: 'News' }),
      makeChannel({ id: '2', url: 'http://2', category: 'Music' }),
    ]);
    useStore.getState().setCategory('Music');
    useStore.getState().setCategory('All');
    expect(useStore.getState().filtered).toHaveLength(2);
  });

  it('setActiveChannel closes the sidebar', () => {
    const ch = makeChannel();
    useStore.getState().setChannels([ch]);
    useStore.getState().setActiveChannel(ch);
    expect(useStore.getState().activeChannel?.id).toBe('1');
    expect(useStore.getState().sidebarOpen).toBe(false);
  });

  it('toggleSidebar flips sidebarOpen', () => {
    useStore.getState().toggleSidebar();
    expect(useStore.getState().sidebarOpen).toBe(false);
    useStore.getState().toggleSidebar();
    expect(useStore.getState().sidebarOpen).toBe(true);
  });
});
```

- [ ] **Step 3: Run store test — expect failure**

```bash
cd client && npx vitest run src/store/useStore.test.ts
```

Expected: FAIL — `Cannot find module './useStore'`

- [ ] **Step 4: Write client/src/store/useStore.ts**

```typescript
import { create } from 'zustand';
import type { Channel, EPGSchedule } from '../types';

interface AppState {
  channels: Channel[];
  filtered: Channel[];
  activeChannel: Channel | null;
  epg: EPGSchedule;
  sidebarOpen: boolean;
  category: string;
  searchQuery: string;

  setChannels: (channels: Channel[]) => void;
  setEpg: (epg: EPGSchedule) => void;
  setActiveChannel: (channel: Channel) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setCategory: (category: string) => void;
  setSearchQuery: (query: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  channels: [],
  filtered: [],
  activeChannel: null,
  epg: {},
  sidebarOpen: true,
  category: 'All',
  searchQuery: '',

  setChannels: (channels) => set({ channels, filtered: channels }),
  setEpg: (epg) => set({ epg }),

  setActiveChannel: (channel) => set({ activeChannel: channel, sidebarOpen: false }),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  setCategory: (category) => {
    const { channels, searchQuery } = get();
    const q = searchQuery.toLowerCase();
    const filtered = channels.filter(c => {
      const matchCat    = category === 'All' || c.category === category;
      const matchSearch = !q || c.name.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
    set({ category, filtered });
  },

  setSearchQuery: (searchQuery) => {
    const { channels, category } = get();
    const q = searchQuery.toLowerCase();
    const filtered = channels.filter(c => {
      const matchCat    = category === 'All' || c.category === category;
      const matchSearch = !q || c.name.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
    set({ searchQuery, filtered });
  },
}));
```

- [ ] **Step 5: Run store tests — expect pass**

```bash
cd client && npx vitest run src/store/useStore.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git add client/src/types.ts client/src/store/
git commit -m "feat: client types and Zustand store with tests"
```

---

## Task 9: API Client

**Files:**
- Create: `client/src/lib/api.ts`

- [ ] **Step 1: Write client/src/lib/api.ts**

```typescript
import type { Channel, EPGSchedule } from '../types';

export interface ChannelsResponse {
  channels: Channel[];
  categories: string[];
}

export async function fetchChannels(): Promise<ChannelsResponse> {
  const res = await fetch('/api/channels');
  if (!res.ok) throw new Error(`Failed to fetch channels: ${res.status}`);
  return res.json();
}

export async function fetchEPG(): Promise<EPGSchedule> {
  const res = await fetch('/api/epg');
  if (!res.ok) throw new Error(`Failed to fetch EPG: ${res.status}`);
  return res.json();
}

export function proxyStreamUrl(url: string): string {
  return `/api/stream?url=${encodeURIComponent(url)}`;
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git add client/src/lib/api.ts
git commit -m "feat: API client with fetch helpers and stream URL proxy"
```

---

## Task 10: VideoPlayer Component

**Files:**
- Create: `client/src/components/VideoPlayer.tsx`

- [ ] **Step 1: Write VideoPlayer.tsx**

```tsx
import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import type { Channel } from '../types';
import { proxyStreamUrl } from '../lib/api';

interface VideoPlayerProps {
  channel: Channel | null;
}

export function VideoPlayer({ channel }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef   = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel) return;

    const src = proxyStreamUrl(channel.url);

    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = src;
      video.play().catch(() => {});
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [channel]);

  if (!channel) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-950">
        <div className="text-center space-y-3">
          <div className="text-6xl">📺</div>
          <p className="text-zinc-500 text-lg">Open the sidebar and select a channel</p>
        </div>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      className="h-full w-full object-contain bg-black"
      autoPlay
      playsInline
      muted={false}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git add client/src/components/VideoPlayer.tsx
git commit -m "feat: VideoPlayer component with hls.js"
```

---

## Task 11: Sidebar Components (SearchBar, CategoryTabs, ChannelList)

**Files:**
- Create: `client/src/components/SearchBar.tsx`
- Create: `client/src/components/CategoryTabs.tsx`
- Create: `client/src/components/ChannelList.tsx`

- [ ] **Step 1: Write SearchBar.tsx**

```tsx
import { Input } from '@/components/ui/input';
import { useStore } from '../store/useStore';

export function SearchBar() {
  const setSearchQuery = useStore((s) => s.setSearchQuery);

  return (
    <Input
      placeholder="Search channels..."
      onChange={(e) => setSearchQuery(e.target.value)}
      className="bg-zinc-800/50 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-primary/50"
    />
  );
}
```

- [ ] **Step 2: Write CategoryTabs.tsx**

```tsx
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStore } from '../store/useStore';

interface CategoryTabsProps {
  categories: string[];
}

export function CategoryTabs({ categories }: CategoryTabsProps) {
  const { category, setCategory } = useStore((s) => ({
    category: s.category,
    setCategory: s.setCategory,
  }));

  const all = ['All', ...categories];

  return (
    <ScrollArea className="w-full">
      <Tabs value={category} onValueChange={setCategory}>
        <TabsList className="bg-zinc-800/50 h-8 flex w-max gap-1 p-1">
          {all.map((cat) => (
            <TabsTrigger
              key={cat}
              value={cat}
              className="text-xs px-3 h-6 rounded data-[state=active]:bg-zinc-600 data-[state=active]:text-white text-zinc-400"
            >
              {cat}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
```

- [ ] **Step 3: Write ChannelList.tsx**

```tsx
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useStore } from '../store/useStore';
import type { Channel } from '../types';

const ITEM_HEIGHT = 60;

interface RowProps {
  index: number;
  style: React.CSSProperties;
  data: Channel[];
}

function ChannelRow({ index, style, data }: RowProps) {
  const { activeChannel, setActiveChannel } = useStore((s) => ({
    activeChannel: s.activeChannel,
    setActiveChannel: s.setActiveChannel,
  }));
  const ch = data[index];
  const isActive = activeChannel?.url === ch.url;

  return (
    <div
      style={style}
      onClick={() => setActiveChannel(ch)}
      className={`flex items-center gap-3 px-3 cursor-pointer transition-colors hover:bg-zinc-700/50 ${
        isActive ? 'bg-zinc-700/80 ring-1 ring-inset ring-primary/60' : ''
      }`}
    >
      {ch.logo ? (
        <img
          src={ch.logo}
          alt={ch.name}
          className="h-8 w-12 object-contain rounded bg-zinc-800 flex-shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div className="h-8 w-12 rounded bg-zinc-800 flex-shrink-0 flex items-center justify-center text-xs text-zinc-500">
          TV
        </div>
      )}
      <div className="min-w-0">
        <p className="text-sm text-zinc-200 truncate">{ch.name}</p>
        <p className="text-xs text-zinc-500 truncate">{ch.country}</p>
      </div>
    </div>
  );
}

export function ChannelList() {
  const filtered = useStore((s) => s.filtered);

  if (filtered.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-zinc-600 text-sm">No channels found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0">
      <AutoSizer>
        {({ height, width }) => (
          <List
            height={height}
            width={width}
            itemCount={filtered.length}
            itemSize={ITEM_HEIGHT}
            itemData={filtered}
          >
            {ChannelRow}
          </List>
        )}
      </AutoSizer>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git add client/src/components/SearchBar.tsx client/src/components/CategoryTabs.tsx client/src/components/ChannelList.tsx
git commit -m "feat: SearchBar, CategoryTabs, ChannelList sidebar components"
```

---

## Task 12: Sidebar + OverlayControls

**Files:**
- Create: `client/src/components/Sidebar.tsx`
- Create: `client/src/components/OverlayControls.tsx`

- [ ] **Step 1: Write Sidebar.tsx**

```tsx
import { useStore } from '../store/useStore';
import { SearchBar } from './SearchBar';
import { CategoryTabs } from './CategoryTabs';
import { ChannelList } from './ChannelList';

interface SidebarProps {
  categories: string[];
}

export function Sidebar({ categories }: SidebarProps) {
  const sidebarOpen = useStore((s) => s.sidebarOpen);

  return (
    <>
      {/* Backdrop — closes sidebar on click when over the video */}
      {sidebarOpen && (
        <div
          className="absolute inset-0 z-10"
          onClick={() => useStore.getState().setSidebarOpen(false)}
        />
      )}

      <aside
        className={`absolute left-0 top-0 h-full z-20 flex flex-col w-72
          backdrop-blur-md bg-zinc-900/85 border-r border-zinc-800/60
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
          <span className="text-white font-semibold tracking-wide text-sm uppercase">Channels</span>
          <button
            onClick={() => useStore.getState().setSidebarOpen(false)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors text-lg leading-none"
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 p-3 flex-1 min-h-0">
          <SearchBar />
          <CategoryTabs categories={categories} />
          <ChannelList />
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Write OverlayControls.tsx**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { useStore } from '../store/useStore';

export function OverlayControls() {
  const { activeChannel, toggleSidebar } = useStore((s) => ({
    activeChannel: s.activeChannel,
    toggleSidebar: s.toggleSidebar,
  }));

  const [visible, setVisible] = useState(true);
  const [volume, setVolume]   = useState(80);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = () => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 3000);
  };

  useEffect(() => {
    window.addEventListener('mousemove', resetTimer);
    resetTimer();
    return () => {
      window.removeEventListener('mousemove', resetTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (video) video.volume = volume / 100;
  }, [volume]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div
      className={`absolute top-0 left-0 right-0 z-30 flex items-center gap-3 px-4 py-3
        bg-gradient-to-b from-black/75 to-transparent
        transition-opacity duration-300
        ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <button
        onClick={toggleSidebar}
        className="text-white hover:text-zinc-300 transition-colors text-xl w-8 flex-shrink-0"
        aria-label="Toggle sidebar"
      >
        ☰
      </button>

      <span className="text-white font-semibold text-sm tracking-wide truncate flex-1">
        {activeChannel?.name ?? 'IPTV Player'}
      </span>

      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-zinc-400 text-xs">🔊</span>
        <Slider
          value={[volume]}
          onValueChange={([v]) => setVolume(v)}
          min={0}
          max={100}
          step={1}
          className="w-24"
        />
        <button
          onClick={toggleFullscreen}
          className="text-white hover:text-zinc-300 transition-colors ml-2"
          aria-label="Toggle fullscreen"
        >
          ⛶
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git add client/src/components/Sidebar.tsx client/src/components/OverlayControls.tsx
git commit -m "feat: Sidebar with slide animation and OverlayControls with volume"
```

---

## Task 13: EPGStrip Component

**Files:**
- Create: `client/src/components/EPGStrip.tsx`

- [ ] **Step 1: Write EPGStrip.tsx**

```tsx
import { useStore } from '../store/useStore';
import type { EPGEntry } from '../types';

function getCurrentAndNext(entries: EPGEntry[]): { current: EPGEntry | null; next: EPGEntry | null } {
  const now = Date.now();
  const upcoming = entries
    .filter(e => new Date(e.end).getTime() > now)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const current = upcoming.find(e => new Date(e.start).getTime() <= now) ?? null;
  const next    = upcoming.find(e => new Date(e.start).getTime() > now)  ?? null;
  return { current, next };
}

export function EPGStrip() {
  const { activeChannel, epg } = useStore((s) => ({
    activeChannel: s.activeChannel,
    epg: s.epg,
  }));

  if (!activeChannel) return null;

  const entries = epg[activeChannel.id] ?? [];
  const { current, next } = getCurrentAndNext(entries);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent">
      <span className="text-zinc-400 text-xs font-medium flex-shrink-0">
        📺 {activeChannel.name}
      </span>

      {current ? (
        <>
          <span className="text-white text-xs">
            Now: <span className="font-semibold">{current.title}</span>
          </span>
          {next && (
            <span className="text-zinc-500 text-xs hidden sm:inline">
              │ Next: {next.title}
            </span>
          )}
        </>
      ) : (
        <span className="text-zinc-500 text-xs">● Live</span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git add client/src/components/EPGStrip.tsx
git commit -m "feat: EPGStrip showing current and next programme"
```

---

## Task 14: App.tsx + main.tsx — Wire Everything Together

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/main.tsx`

- [ ] **Step 1: Replace client/src/App.tsx**

```tsx
import { useEffect, useState } from 'react';
import { VideoPlayer } from './components/VideoPlayer';
import { Sidebar } from './components/Sidebar';
import { EPGStrip } from './components/EPGStrip';
import { OverlayControls } from './components/OverlayControls';
import { useStore } from './store/useStore';
import { fetchChannels, fetchEPG } from './lib/api';

export default function App() {
  const { setChannels, setEpg, activeChannel } = useStore((s) => ({
    setChannels: s.setChannels,
    setEpg: s.setEpg,
    activeChannel: s.activeChannel,
  }));

  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { channels, categories: cats } = await fetchChannels();
        setChannels(channels);
        setCategories(cats);
        const epgData = await fetchEPG();
        setEpg(epgData);
      } catch (err) {
        setError('Failed to connect to server. Make sure the backend is running on port 3001.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [setChannels, setEpg]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950">
        <div className="text-center space-y-3">
          <div className="text-4xl animate-pulse">📡</div>
          <p className="text-zinc-400">Loading channels...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950">
        <div className="text-center space-y-3 max-w-sm px-4">
          <div className="text-4xl">⚠️</div>
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-zinc-950">
      <VideoPlayer channel={activeChannel} />
      <OverlayControls />
      <Sidebar categories={categories} />
      <EPGStrip />
    </div>
  );
}
```

- [ ] **Step 2: Replace client/src/main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 3: Remove Vite boilerplate**

Delete these files:
```bash
cd client
rm -f src/App.css src/assets/react.svg public/vite.svg
```

Update `client/index.html` — replace the title:
```html
<title>IPTV Player</title>
```

- [ ] **Step 4: Run both servers**

In terminal 1 (server):
```bash
cd server && npm run dev
```

Wait for `[cache] Loaded X channels` message.

In terminal 2 (client):
```bash
cd client && npm run dev
```

Expected: Both start without errors. Client at `http://localhost:5173`.

- [ ] **Step 5: Verify the app works**

Open `http://localhost:5173` in a browser.

Check:
- [ ] Loading spinner appears briefly
- [ ] Sidebar opens with channel list
- [ ] Search input filters channels
- [ ] Category tabs filter channels
- [ ] Clicking a channel starts the video (may take a few seconds to buffer)
- [ ] Sidebar closes when a channel is selected
- [ ] ☰ button reopens the sidebar
- [ ] Volume slider works
- [ ] EPG strip shows channel name at the bottom
- [ ] Controls fade after 3 seconds of mouse inactivity

- [ ] **Step 6: Commit**

```bash
cd /home/asaed/apdo/projects/iptv-streaming
git add client/src/App.tsx client/src/main.tsx client/index.html
git commit -m "feat: wire App.tsx with all components — IPTV player complete"
```

---

## Done ✓

The IPTV player is fully functional. Here's how to run it:

```bash
# Install all deps (first time only)
npm install
npm run install:all

# Start both servers
npm run dev
```

Then open `http://localhost:5173`.

**Phase 2 items (not in scope):**
- Favorites (star channels, persist to localStorage)
- User settings (default category, language filter)
- Watch history (last 10 channels)
