import { parseStringPromise } from 'xml2js';
import { EPGEntry, EPGSchedule } from '../types';

function parseXMLTVDate(dateStr: string): string {
  const m = dateStr.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!m) return new Date().toISOString();
  const [, year, month, day, hour, min, sec, tz] = m;
  const offset = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : '+00:00';
  return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}${offset}`).toISOString();
}

export async function parseEPG(xml: string): Promise<EPGSchedule> {
  const result = await parseStringPromise(xml, { explicitArray: true });
  const schedule: EPGSchedule = {};

  const programmes: any[] = result?.tv?.programme ?? [];

  for (const prog of programmes) {
    const channelId: string = prog.$?.channel ?? '';
    if (!channelId) continue;

    const titleRaw = prog.title?.[0];
    const title = typeof titleRaw === 'string' ? titleRaw : titleRaw?._ ?? 'Unknown';
    const start = parseXMLTVDate(prog.$?.start ?? '');
    const end   = parseXMLTVDate(prog.$?.stop  ?? '');

    if (!schedule[channelId]) schedule[channelId] = [];
    schedule[channelId].push({ channelId, title, start, end });
  }

  return schedule;
}
