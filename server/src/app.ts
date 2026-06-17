import express from 'express';
import cors from 'cors';
import channelsRouter from './routes/channels';
import epgRouter from './routes/epg';
import streamRouter from './routes/stream';
import matchesRouter from './routes/matches';
import portalsRouter from './routes/portals';
import hubRouter from './routes/hub';
import daddyliveRouter from './routes/daddylive';
import bintvRouter from './routes/bintv';

export const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true, uptime: process.uptime() }));

app.use('/api/channels', channelsRouter);
app.use('/api/epg', epgRouter);
app.use('/api/stream', streamRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/portals', portalsRouter);
app.use('/api/hub', hubRouter);
app.use('/api/daddylive', daddyliveRouter);
app.use('/api/bintv', bintvRouter);
