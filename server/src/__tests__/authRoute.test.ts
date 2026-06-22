import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

beforeEach(() => {
  delete process.env.ACCESS_CODE;
  delete process.env.AUTH_SECRET;
  vi.resetModules();
});

// Fresh import per call → fresh in-memory rate-limiter Map (test isolation).
async function makeApp() {
  const authRoute = (await import('../routes/authRoute?t=' + Date.now())).default;
  const app = express();
  app.use(express.json());
  app.use('/auth', authRoute);
  return app;
}

describe('POST /auth/verify', () => {
  it('returns a token for the correct code', async () => {
    process.env.ACCESS_CODE = 'pw';
    const res = await request(await makeApp()).post('/auth/verify').send({ code: 'pw' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
  });

  it('401 for a wrong code', async () => {
    process.env.ACCESS_CODE = 'pw';
    const res = await request(await makeApp()).post('/auth/verify').send({ code: 'nope' });
    expect(res.status).toBe(401);
  });

  it('429 after 10 failed attempts from the same IP', async () => {
    process.env.ACCESS_CODE = 'pw';
    const app = await makeApp();
    for (let i = 0; i < 10; i++) await request(app).post('/auth/verify').send({ code: 'x' });
    const res = await request(app).post('/auth/verify').send({ code: 'x' });
    expect(res.status).toBe(429);
  });

  it('a successful verify resets the attempt counter', async () => {
    process.env.ACCESS_CODE = 'pw';
    const app = await makeApp();
    for (let i = 0; i < 9; i++) await request(app).post('/auth/verify').send({ code: 'x' });
    await request(app).post('/auth/verify').send({ code: 'pw' }); // success → reset
    const res = await request(app).post('/auth/verify').send({ code: 'x' });
    expect(res.status).toBe(401); // not 429
  });
});
