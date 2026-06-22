import express from 'express';
import cors from 'cors';
import channelsRouter from './routes/channels';
import epgRouter from './routes/epg';
import streamRouter from './routes/stream';
import matchesRouter from './routes/matches';
import portalsRouter from './routes/portals';
import hubRouter from './routes/hub';
import daddyliveRouter from './routes/daddylive';
import authRoute from './routes/authRoute';
import { authMiddleware } from './middleware/auth';

export const app = express();
app.set('trust proxy', true);

// maxAge caches the CORS preflight (OPTIONS) for 24h so the browser doesn't
// re-preflight every cross-origin request. Without it, the Authorization header
// added by the access gate forces a preflight round-trip before each API call.
app.use(cors({ maxAge: 86400 }));
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true, uptime: process.uptime() }));

// Public: passphrase verification (must be before the /api guard)
app.use('/auth', authRoute);

// Gate all API routes (no-op when ACCESS_CODE is unset)
app.use('/api', authMiddleware);

app.use('/api/channels', channelsRouter);
app.use('/api/epg', epgRouter);
app.use('/api/stream', streamRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/portals', portalsRouter);
app.use('/api/hub', hubRouter);
app.use('/api/daddylive', daddyliveRouter);
