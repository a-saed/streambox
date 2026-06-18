import { describe, it, expect } from 'vitest';

// Test the TTL calculation logic by extracting it as a pure function
function cacheExpiryMs(signedUrl: string, fallbackMs: number): number {
  try {
    const exp = parseInt(new URL(signedUrl).searchParams.get('expires') ?? '', 10);
    if (exp > 0) {
      const remaining = exp * 1000 - Date.now() - 120_000;
      if (remaining > 0) return remaining;
    }
  } catch { /* ignore */ }
  return fallbackMs;
}

describe('dynamic TTL from expires param', () => {
  it('uses expires param when present and future', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const url = `https://cdn.example.com/stream/index.m3u8?md5=abc&expires=${futureExp}`;
    const ttl = cacheExpiryMs(url, 55 * 60 * 1000);
    // Should be ~3598s - 120s safety = ~3478s (between 3400-3600s)
    expect(ttl).toBeGreaterThan(3400 * 1000);
    expect(ttl).toBeLessThan(3600 * 1000);
  });

  it('falls back to default when no expires param', () => {
    const url = 'https://cdn.example.com/stream/index.m3u8?md5=abc';
    const fallback = 55 * 60 * 1000;
    expect(cacheExpiryMs(url, fallback)).toBe(fallback);
  });

  it('falls back when expires is in the past', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 60;
    const url = `https://cdn.example.com/stream/index.m3u8?md5=abc&expires=${pastExp}`;
    const fallback = 55 * 60 * 1000;
    expect(cacheExpiryMs(url, fallback)).toBe(fallback);
  });
});

describe('embed host discovery regex', () => {
  it('extracts embed URL from stream page HTML', () => {
    const IFRAME_RE = /https?:\/\/[^"']+premiumtv\/daddy4\.php\?id=\d+/;
    const html = `<iframe src="https://donis.jimpenopisonline.online/premiumtv/daddy4.php?id=42" />`;
    expect(IFRAME_RE.exec(html)?.[0]).toBe('https://donis.jimpenopisonline.online/premiumtv/daddy4.php?id=42');
  });

  it('returns null when no embed URL in HTML', () => {
    const IFRAME_RE = /https?:\/\/[^"']+premiumtv\/daddy4\.php\?id=\d+/;
    expect(IFRAME_RE.exec('<html>no embed here</html>')).toBeNull();
  });
});
