import { chromium, Browser } from 'playwright';

let _browser: Browser | null = null;
let _launching = false;

export function makeProxyContextOptions(): Parameters<Browser['newContext']>[0] {
  const proxyUrl = process.env.PROXY_URL;
  if (!proxyUrl) return {};
  return { proxy: { server: proxyUrl } };
}

export async function getSharedBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;
  if (_launching) {
    await new Promise(r => setTimeout(r, 200));
    return getSharedBrowser();
  }
  _launching = true;
  try {
    _browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--mute-audio',
        '--disable-extensions',
        // Critical for bypassing bot detection — removes navigator.webdriver at the
        // C++ level before any JS runs.  Without this, addInitScript patches are a
        // race against inline scripts that read the real value first.
        '--disable-blink-features=AutomationControlled',
        '--exclude-switches=enable-automation',
      ],
    });
    _browser.on('disconnected', () => { _browser = null; _launching = false; });
    console.log('[browser] Chromium launched');
    return _browser;
  } finally {
    _launching = false;
  }
}
