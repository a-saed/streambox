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
