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
