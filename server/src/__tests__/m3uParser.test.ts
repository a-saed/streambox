import { describe, it, expect } from 'vitest';
import { parseM3U } from '../services/m3uParser';

const SAMPLE = `#EXTM3U
#EXTINF:-1 tvg-id="AlJazeera.qa" tvg-logo="https://logo.url/aj.png" group-title="News" tvg-country="QA" tvg-language="Arabic" tvg-url="https://epg.url/qa.xml",Al Jazeera
http://stream.aljazeera.net/live.m3u8
#EXTINF:-1 tvg-id="BBC.uk" group-title="News" tvg-country="GB" tvg-language="English",BBC News
http://bbc.stream.url/live.m3u8`;

describe('parseM3U', () => {
  it('returns empty array for empty input', () => {
    expect(parseM3U('')).toEqual([]);
  });

  it('parses correct number of channels', () => {
    expect(parseM3U(SAMPLE)).toHaveLength(2);
  });

  it('parses all channel fields', () => {
    const [ch] = parseM3U(SAMPLE);
    expect(ch.id).toBe('AlJazeera.qa');
    expect(ch.name).toBe('Al Jazeera');
    expect(ch.logo).toBe('https://logo.url/aj.png');
    expect(ch.url).toBe('http://stream.aljazeera.net/live.m3u8');
    expect(ch.category).toBe('News');
    expect(ch.country).toBe('QA');
    expect(ch.language).toBe('Arabic');
    expect(ch.tvgUrl).toBe('https://epg.url/qa.xml');
  });

  it('defaults missing optional fields to empty string', () => {
    const [, ch2] = parseM3U(SAMPLE);
    expect(ch2.logo).toBe('');
    expect(ch2.tvgUrl).toBeUndefined();
  });

  it('skips entries with no stream URL', () => {
    const input = '#EXTM3U\n#EXTINF:-1,NoStream';
    expect(parseM3U(input)).toHaveLength(0);
  });

  it('handles Windows line endings (CRLF)', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n');
    const result = parseM3U(crlf);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Al Jazeera');
    expect(result[0].url).toBe('http://stream.aljazeera.net/live.m3u8');
  });

  it('preserves commas in channel names', () => {
    const input = `#EXTM3U
#EXTINF:-1 tvg-id="cnn" group-title="News",CNN, International
http://cnn.stream.url/live.m3u8`;
    const [ch] = parseM3U(input);
    expect(ch.name).toBe('CNN, International');
  });
});
