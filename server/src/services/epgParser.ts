import { parseStringPromise } from "xml2js";
import { EPGEntry, EPGSchedule } from "../types";

function parseXMLTVDate(dateStr: string): string {
  const m = dateStr.match(
    /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/,
  );
  if (!m) return new Date(0).toISOString();
  const [, year, month, day, hour, min, sec, tz] = m;
  const offset = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : "+00:00";
  const d = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}${offset}`);
  return isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

export async function parseEPG(xml: string): Promise<EPGSchedule> {
  let result: any;
  try {
    result = await parseStringPromise(xml, { explicitArray: true });
  } catch {
    return {};
  }
  const schedule: EPGSchedule = {};

  const programmes: any[] = result?.tv?.programme ?? []; // xml2js returns untyped output; runtime guards below compensate

  for (const prog of programmes) {
    const channelId: string = prog.$?.channel ?? "";
    if (!channelId) continue;

    const titleRaw = prog.title?.[0];
    const title =
      typeof titleRaw === "string" ? titleRaw : (titleRaw?._ ?? "Unknown");
    const start = prog.$?.start
      ? parseXMLTVDate(prog.$?.start)
      : new Date(0).toISOString();
    const end = prog.$?.stop
      ? parseXMLTVDate(prog.$?.stop)
      : new Date(0).toISOString();

    if (!schedule[channelId]) schedule[channelId] = [];
    schedule[channelId].push({ channelId, title, start, end });
  }

  return schedule;
}
