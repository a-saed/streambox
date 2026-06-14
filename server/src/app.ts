import express from 'express';
import cors from 'cors';

export const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (_, res) => res.json({ ok: true, uptime: process.uptime() }));
