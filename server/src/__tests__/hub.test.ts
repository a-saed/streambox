import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDb } from '../services/portalStore';

beforeEach(() => { initDb(':memory:'); });

describe('GET /api/hub/live', () => {
  it('returns empty liveChannelIds when pool is empty', async () => {
    const { initSportsPool } = await import('../services/sportsPool?t=' + Date.now());
    initSportsPool();
    const hubRouter = (await import('../routes/hub?t=' + Date.now())).default;
    const app = express();
    app.use('/api/hub', hubRouter);
    const res = await request(app).get('/api/hub/live');
    expect(res.status).toBe(200);
    expect(res.body.liveChannelIds).toEqual([]);
  });

  it('returns channelId when pool has alive entry', async () => {
    const { initSportsPool, addUrls } = await import('../services/sportsPool?t=' + Date.now());
    initSportsPool();
    addUrls('bein_ar_1', [{ url: 'http://test.m3u8', source: 'daddylive' }]);
    const hubRouter = (await import('../routes/hub?t=' + Date.now())).default;
    const app = express();
    app.use('/api/hub', hubRouter);
    const res = await request(app).get('/api/hub/live');
    expect(res.body.liveChannelIds).toContain('bein_ar_1');
  });
});

describe('GET /api/hub/:id/best', () => {
  it('returns 404 when no pool entry', async () => {
    const { initSportsPool } = await import('../services/sportsPool?t=' + Date.now());
    initSportsPool();
    const hubRouter = (await import('../routes/hub?t=' + Date.now())).default;
    const app = express();
    app.use('/api/hub', hubRouter);
    const res = await request(app).get('/api/hub/bein_ar_1/best');
    expect(res.status).toBe(404);
  });

  it('returns best url when pool has alive entry', async () => {
    const { initSportsPool, addUrls } = await import('../services/sportsPool?t=' + Date.now());
    initSportsPool();
    addUrls('bein_ar_1', [{ url: 'http://best.m3u8', source: 'daddylive' }]);
    const hubRouter = (await import('../routes/hub?t=' + Date.now())).default;
    const app = express();
    app.use('/api/hub', hubRouter);
    const res = await request(app).get('/api/hub/bein_ar_1/best');
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('http://best.m3u8');
    expect(res.body.source).toBe('daddylive');
  });
});
