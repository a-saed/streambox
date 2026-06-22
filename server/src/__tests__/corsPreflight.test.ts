import { describe, it, expect } from 'vitest';
import request from 'supertest';

// Regression: the access gate's Authorization header makes API calls non-"simple",
// so browsers preflight them. Without Access-Control-Max-Age the preflight repeats
// every few seconds → an extra cross-origin round-trip per request in prod.
describe('CORS preflight caching', () => {
  it('sets Access-Control-Max-Age so the browser caches the preflight', async () => {
    const { app } = await import('../app?t=' + Date.now());
    const res = await request(app)
      .options('/api/channels')
      .set('Origin', 'https://streambox.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(Number(res.headers['access-control-max-age'])).toBeGreaterThan(0);
  });
});
