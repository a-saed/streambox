import { chromium, Browser } from 'playwright';

let _browser: Browser | null = null;
let _launching = false;

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
        '--single-process',          // lower memory in constrained envs
        '--disable-extensions',
      ],
    });
    _browser.on('disconnected', () => { _browser = null; _launching = false; });
    console.log('[browser] Chromium launched');
    return _browser;
  } finally {
    _launching = false;
  }
}
