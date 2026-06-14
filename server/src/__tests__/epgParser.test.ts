import { describe, it, expect } from 'vitest';
import { parseEPG } from '../services/epgParser';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="AlJazeera.qa">
    <display-name>Al Jazeera</display-name>
  </channel>
  <programme start="20260614120000 +0000" stop="20260614130000 +0000" channel="AlJazeera.qa">
    <title lang="en">World News</title>
  </programme>
  <programme start="20260614130000 +0000" stop="20260614140000 +0000" channel="AlJazeera.qa">
    <title lang="en">The Listening Post</title>
  </programme>
</tv>`;

describe('parseEPG', () => {
  it('returns empty schedule for empty tv element', async () => {
    const result = await parseEPG('<tv></tv>');
    expect(result).toEqual({});
  });

  it('groups programmes by channel id', async () => {
    const schedule = await parseEPG(SAMPLE_XML);
    expect(Object.keys(schedule)).toContain('AlJazeera.qa');
    expect(schedule['AlJazeera.qa']).toHaveLength(2);
  });

  it('parses programme title correctly', async () => {
    const schedule = await parseEPG(SAMPLE_XML);
    expect(schedule['AlJazeera.qa'][0].title).toBe('World News');
  });

  it('parses start and end as ISO strings', async () => {
    const schedule = await parseEPG(SAMPLE_XML);
    const entry = schedule['AlJazeera.qa'][0];
    expect(new Date(entry.start).toISOString()).toBe('2026-06-14T12:00:00.000Z');
    expect(new Date(entry.end).toISOString()).toBe('2026-06-14T13:00:00.000Z');
  });

  it('parses plain string title (no xml attributes)', async () => {
    const xml = `<tv>
    <programme start="20260614120000 +0000" stop="20260614130000 +0000" channel="test.ch">
      <title>Plain Title</title>
    </programme>
  </tv>`;
    const schedule = await parseEPG(xml);
    expect(schedule['test.ch'][0].title).toBe('Plain Title');
  });

  it('returns empty schedule for malformed XML', async () => {
    const result = await parseEPG('this is not xml!!!');
    expect(result).toEqual({});
  });

  it('skips programmes with no channel attribute', async () => {
    const xml = `<tv>
    <programme start="20260614120000 +0000" stop="20260614130000 +0000">
      <title>No Channel</title>
    </programme>
  </tv>`;
    const result = await parseEPG(xml);
    expect(Object.keys(result)).toHaveLength(0);
  });
});
