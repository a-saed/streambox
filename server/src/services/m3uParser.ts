import { Channel } from '../types';

export function parseM3U(text: string): Channel[] {
  const channels: Channel[] = [];
  // Normalize Windows line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF')) continue;

    const id       = line.match(/tvg-id="([^"]*)"/)?.[1] ?? '';
    const logo     = line.match(/tvg-logo="([^"]*)"/)?.[1] ?? '';
    const category = line.match(/group-title="([^"]*)"/)?.[1] ?? 'Other';
    const country  = line.match(/tvg-country="([^"]*)"/)?.[1] ?? '';
    const language = line.match(/tvg-language="([^"]*)"/)?.[1] ?? '';
    const tvgUrl   = line.match(/tvg-url="([^"]*)"/)?.[1] || undefined;
    const name     = line.match(/,([^,]+)$/)?.[1]?.trim() ?? 'Unknown';

    // Find next non-empty, non-comment line as the stream URL
    let url = '';
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (next && !next.startsWith('#')) { url = next; break; }
    }

    if (url) {
      channels.push({ id, name, logo, url, category, country, language, tvgUrl });
    }
  }

  return channels;
}
