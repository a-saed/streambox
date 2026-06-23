import { describe, it, expect } from 'vitest';
import request from 'supertest';

// The channel catalog is large repetitive JSON; without gzip it ships as tens of
// MB per request. /api/hub returns the full hub-channel list (>1KB), enough to
// exceed compression's default threshold.
describe('response compression', () => {
  it('gzip-compresses sizable API responses when the client accepts it', async () => {
    const { app } = await import('../app?t=' + Date.now());
    const res = await request(app).get('/api/hub').set('Accept-Encoding', 'gzip');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
  });
});
