import { createHash } from "node:crypto";

const escapeText = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
const unescapeText = (s) => s.replace(/\\([nN,;\\])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
const pad = (n, w = 2) => String(n).padStart(w, "0");

function utc(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}
function day(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/** Lines may be at most 75 octets; longer ones are continued on the next line that starts with a space. Never splits a character. */
function fold(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const toDate = (value, name) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`createCalendar: ${name} is not a valid date`);
  return date;
};

/**
 * Builds an .ics calendar text. Events: `{ title, start, end?, allDay?, description?, location?, url?, uid?, status? }`.
 * Times are written in UTC, so every calendar app shows them at the right local time. An all-day event uses dates only
 * (`end` is the last day, inclusive). Without `uid`, a stable one is made from the content, so importing the same file twice
 * updates the events instead of duplicating them. `now` fixes the DTSTAMP, for tests.
 */
export function createCalendar({ name, events = [], prodId = "-//Sand Software Solutions//ics-lite//EN", now = new Date() } = {}) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${prodId}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (name) lines.push(`X-WR-CALNAME:${escapeText(name)}`);
  for (const [i, event] of events.entries()) {
    if (!event || typeof event.title !== "string" || event.title === "") throw new TypeError(`createCalendar: event ${i} needs a title`);
    const start = toDate(event.start, `event ${i} start`);
    let end = event.end === undefined ? undefined : toDate(event.end, `event ${i} end`);
    if (end && end < start) throw new RangeError(`createCalendar: event ${i} ends before it starts`);
    const uid = event.uid ?? `${createHash("sha256").update([event.title, start.toISOString(), end?.toISOString() ?? "", event.location ?? "", event.allDay ? "d" : ""].join("\n")).digest("hex").slice(0, 32)}@ics-lite`;
    lines.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${utc(now)}`);
    if (event.allDay) {
      const last = end ?? start;
      lines.push(`DTSTART;VALUE=DATE:${day(start)}`, `DTEND;VALUE=DATE:${day(new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate() + 1)))}`);
    } else {
      lines.push(`DTSTART:${utc(start)}`);
      if (end) lines.push(`DTEND:${utc(end)}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    if (event.status) lines.push(`STATUS:${String(event.status).toUpperCase()}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

function parseWhen(value, params) {
  if (/VALUE=DATE(?!-)/i.test(params) || /^\d{8}$/.test(value)) {
    const [, y, m, d] = /^(\d{4})(\d{2})(\d{2})$/.exec(value) ?? [];
    return y ? { date: new Date(Date.UTC(+y, +m - 1, +d)), allDay: true } : null;
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, z] = match;
  // Without Z the time is "floating" (or belongs to a TZID we do not resolve); it is read as UTC and flagged.
  return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false, floating: z !== "Z" };
}

/**
 * Reads the events from .ics text: title, start, end, allDay, description, location, url, uid, status. Folded lines and
 * escapes are handled. Times with a TZID or without Z are read as UTC and marked `floating: true` (time zones are not resolved).
 * Recurrence rules are not expanded; the raw rule is returned as `rrule`.
 */
export function parseIcs(text) {
  if (typeof text !== "string") throw new TypeError("parseIcs: text must be a string");
  const raw = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r\n|\n|\r/);
  const events = [];
  let current = null;
  for (const line of raw) {
    if (line === "BEGIN:VEVENT") current = {};
    else if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
    } else if (current && line.includes(":")) {
      const colon = line.indexOf(":");
      const [name, ...paramParts] = line.slice(0, colon).split(";");
      const params = paramParts.join(";");
      const value = line.slice(colon + 1);
      switch (name.toUpperCase()) {
        case "SUMMARY": current.title = unescapeText(value); break;
        case "DESCRIPTION": current.description = unescapeText(value); break;
        case "LOCATION": current.location = unescapeText(value); break;
        case "URL": current.url = value; break;
        case "UID": current.uid = value; break;
        case "STATUS": current.status = value.toLowerCase(); break;
        case "RRULE": current.rrule = value; break;
        case "DTSTART": {
          const w = parseWhen(value, params);
          if (w) {
            current.start = w.date;
            current.allDay = w.allDay;
            if (w.floating || /TZID=/i.test(params)) current.floating = true;
          }
          break;
        }
        case "DTEND": {
          const w = parseWhen(value, params);
          if (w) current.end = w.allDay ? new Date(w.date.getTime() - 86_400_000) : w.date; // all-day DTEND is exclusive
          break;
        }
      }
    }
  }
  return events;
}
