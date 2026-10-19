import { createHash } from "node:crypto";

// RFC 5545 TEXT: backslash, semicolon and comma get a backslash, a line break becomes \\n.
const escapeText = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\" + ";").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
const unescapeText = (s) => s.replace(/\\([nN,;\\])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
const pad = (n, w = 2) => String(n).padStart(w, "0");

function utc(date) {
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}
function day(date) {
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
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
  if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") throw new TypeError(`createCalendar: ${name} must be a Date, a date text or a timestamp`); // new Date(null) would be 1970
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`createCalendar: ${name} is not a valid date`);
  if (date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999) throw new RangeError(`createCalendar: ${name} is outside the years 0000 to 9999`);
  return date;
};

// Values that are written as they are (UID, URL, PRODID, STATUS) must not contain a line break or other control character, or they
// could add properties (an attendee, an alarm) to the file.
const plain = (value, name) => {
  const text = String(value);
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new TypeError(`createCalendar: ${name} contains a control character or line break`);
  return text;
};
const STATUSES = new Set(["CONFIRMED", "TENTATIVE", "CANCELLED"]);

/**
 * Builds an .ics calendar text. Events: `{ title, start, end?, allDay?, description?, location?, url?, uid?, status? }`.
 * Times are written in UTC, so every calendar app shows them at the right local time. An all-day event uses dates only
 * (`end` is the last day, inclusive). Without `uid`, a stable one is made from the content, so importing the same file twice
 * updates the events instead of duplicating them. `now` fixes the DTSTAMP, for tests.
 */
export function createCalendar({ name, events = [], prodId = "-//Sand Software Solutions//ics-lite//EN", now = new Date() } = {}) {
  const stamp = toDate(now, "now");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${plain(prodId, "prodId")}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (name) lines.push(`X-WR-CALNAME:${escapeText(name)}`);
  for (const [i, event] of events.entries()) {
    if (!event || typeof event.title !== "string" || event.title === "") throw new TypeError(`createCalendar: event ${i} needs a title`);
    const start = toDate(event.start, `event ${i} start`);
    let end = event.end === undefined ? undefined : toDate(event.end, `event ${i} end`);
    if (end && end < start) throw new RangeError(`createCalendar: event ${i} ends before it starts`);
    const uid = event.uid ?? `${createHash("sha256").update([event.title, start.toISOString(), end?.toISOString() ?? "", event.location ?? "", event.allDay ? "d" : ""].join("\n")).digest("hex").slice(0, 32)}@ics-lite`;
    lines.push("BEGIN:VEVENT", `UID:${plain(uid, `event ${i} uid`)}`, `DTSTAMP:${utc(stamp)}`);
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
    if (event.url) lines.push(`URL:${plain(event.url, `event ${i} url`)}`);
    if (event.status) {
      const status = String(event.status).toUpperCase();
      if (!STATUSES.has(status)) throw new RangeError(`createCalendar: event ${i} status must be confirmed, tentative or cancelled`);
      lines.push(`STATUS:${status}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

const DAY_MS = 86_400_000;

function parseWhen(value, params) {
  if (/VALUE=DATE(?!-)/i.test(params) || /^\d{8}$/.test(value)) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    return m && validDate(+m[1], +m[2], +m[3]) ? { date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), allDay: true } : null;
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, z] = match;
  if (!validDate(+y, +mo, +d) || +h > 23 || +mi > 59 || +s > 60) return null; // 20261340T250000 would roll over into another month
  // Without Z the time is "floating" (or belongs to a TZID we do not resolve); it is read as UTC and flagged.
  return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false, floating: z !== "Z" };
}

function validDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(0);
  probe.setUTCFullYear(year, month, 0); // day 0 of the next month is the last day of this one
  return day <= probe.getUTCDate();
}

// P1W, P1DT12H, PT30M ... in milliseconds, or null.
function parseDurationValue(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!m || m.slice(2).every((v) => v === undefined)) return null;
  const [, sign, w = 0, d = 0, h = 0, mi = 0, s = 0] = m;
  const ms = (((Number(w) * 7 + Number(d)) * 24 + Number(h)) * 60 + Number(mi)) * 60_000 + Number(s) * 1000;
  return sign === "-" ? -ms : ms;
}

// The first colon that is not inside a quoted parameter value: DESCRIPTION;ALTREP="http://x":text.
function splitProperty(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) return [line.slice(0, i), line.slice(i + 1)];
  }
  return null;
}

/**
 * Reads the events from .ics text: title, start, end, allDay, description, location, url, uid, status. Folded lines and
 * escapes are handled. Times with a TZID or without Z are read as UTC and marked `floating: true` (time zones are not resolved).
 * A DURATION without DTEND becomes `end`. Alarms and other components inside an event are skipped, so a reminder's description
 * does not replace the event's. Recurrence rules are not expanded; the raw rule is returned as `rrule`.
 */
export function parseIcs(text) {
  if (typeof text !== "string") throw new TypeError("parseIcs: text must be a string");
  const raw = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").replace(/\r[ \t]/g, "").split(/\r\n|\n|\r/);
  const events = [];
  let current = null;
  let duration = null;
  let nested = 0; // depth of components inside the event (VALARM...)
  for (const line of raw) {
    const upper = line.toUpperCase();
    if (!current) {
      if (upper === "BEGIN:VEVENT") {
        current = {};
        duration = null;
        nested = 0;
      }
      continue;
    }
    if (nested === 0 && upper === "END:VEVENT") {
      if (duration !== null && current.start && !current.end) {
        current.end = current.allDay ? new Date(current.start.getTime() + Math.max(duration - DAY_MS, 0)) : new Date(current.start.getTime() + duration);
      }
      events.push(current);
      current = null;
    } else if (upper.startsWith("BEGIN:")) nested++;
    else if (upper.startsWith("END:")) nested = Math.max(0, nested - 1);
    else if (nested === 0) {
      const parts = splitProperty(line);
      if (!parts) continue;
      const [name, ...paramParts] = parts[0].split(";");
      const params = paramParts.join(";");
      const value = parts[1];
      switch (name.toUpperCase()) {
        case "SUMMARY": current.title = unescapeText(value); break;
        case "DESCRIPTION": current.description = unescapeText(value); break;
        case "LOCATION": current.location = unescapeText(value); break;
        case "URL": current.url = value; break;
        case "UID": current.uid = value; break;
        case "STATUS": current.status = value.toLowerCase(); break;
        case "RRULE": current.rrule = value; break;
        case "DURATION": duration = parseDurationValue(value); break;
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
          if (w) current.end = w.allDay ? new Date(w.date.getTime() - DAY_MS) : w.date; // all-day DTEND is exclusive
          break;
        }
      }
    }
  }
  return events;
}
