import assert from "node:assert/strict";
import { test } from "node:test";

import { createCalendar, parseIcs } from "./src/index.js";

const now = new Date("2026-10-17T10:00:00Z");

test("writes a valid calendar with CRLF line endings", () => {
  const ics = createCalendar({ name: "Rooster", now, events: [{ title: "Avonddienst", start: "2026-10-17T16:00:00Z", end: "2026-10-18T00:30:00Z", location: "Strandtent, Zandvoort" }] });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics));
  assert.match(ics, /X-WR-CALNAME:Rooster\r\n/);
  assert.match(ics, /DTSTART:20261017T160000Z\r\n/);
  assert.match(ics, /DTEND:20261018T003000Z\r\n/);
  assert.match(ics, /LOCATION:Strandtent\\, Zandvoort\r\n/);
  assert.match(ics, /DTSTAMP:20261017T100000Z\r\n/);
});

test("all-day events use dates and an exclusive end", () => {
  const ics = createCalendar({ now, events: [{ title: "Vakantie", start: "2026-12-24", end: "2026-12-26", allDay: true }] });
  assert.match(ics, /DTSTART;VALUE=DATE:20261224\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261227\r\n/);
  const single = createCalendar({ now, events: [{ title: "Vrij", start: "2026-12-31", allDay: true }] });
  assert.match(single, /DTEND;VALUE=DATE:20270101\r\n/);
});

test("the uid is stable, so importing twice updates instead of duplicating", () => {
  const event = { title: "A", start: "2026-10-17T10:00:00Z" };
  const uid = (ics) => /UID:(\S+)/.exec(ics)[1];
  assert.equal(uid(createCalendar({ events: [event] })), uid(createCalendar({ events: [event] })));
  assert.notEqual(uid(createCalendar({ events: [event] })), uid(createCalendar({ events: [{ ...event, title: "B" }] })));
  assert.equal(uid(createCalendar({ events: [{ ...event, uid: "mijn-id" }] })), "mijn-id");
});

test("special characters are escaped and long lines are folded without splitting a character", () => {
  const description = `Regel een; met, komma\nRegel twee \\ ${"é".repeat(120)}`;
  const ics = createCalendar({ now, events: [{ title: "Test", start: "2026-10-17T10:00:00Z", description }] });
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal(parseIcs(ics)[0].description, description);
});

test("round trip", () => {
  const events = [
    { title: "Dienst", start: new Date("2026-10-17T16:00:00Z"), end: new Date("2026-10-18T00:00:00Z"), location: "Bar", description: "Let op: kassa", url: "https://example.com/d/1", status: "confirmed" },
    { title: "Vrij", start: new Date("2026-10-20T00:00:00Z"), end: new Date("2026-10-21T00:00:00Z"), allDay: true }
  ];
  const back = parseIcs(createCalendar({ now, events }));
  assert.equal(back.length, 2);
  assert.deepEqual(back[0], { uid: back[0].uid, title: "Dienst", start: events[0].start, end: events[0].end, allDay: false, description: "Let op: kassa", location: "Bar", url: "https://example.com/d/1", status: "confirmed" });
  assert.equal(back[1].allDay, true);
  assert.deepEqual([back[1].start, back[1].end], [events[1].start, events[1].end]);
});

test("reads files from other programs: folded lines, TZID, recurrence, LF endings", () => {
  const text = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:abc", "SUMMARY:Lange titel die op de volgende regel",
    " doorgaat", "DTSTART;TZID=Europe/Amsterdam:20261017T180000", "RRULE:FREQ=WEEKLY;BYDAY=SA", "END:VEVENT", "END:VCALENDAR"
  ].join("\n");
  const [event] = parseIcs(text);
  assert.equal(event.title, "Lange titel die op de volgende regeldoorgaat");
  assert.equal(event.floating, true);
  assert.equal(event.rrule, "FREQ=WEEKLY;BYDAY=SA");
  assert.equal(event.start.toISOString(), "2026-10-17T18:00:00.000Z");
});

test("bad input is refused clearly", () => {
  assert.throws(() => createCalendar({ events: [{ title: "", start: "2026-10-17" }] }), /needs a title/);
  assert.throws(() => createCalendar({ events: [{ title: "x", start: "geen datum" }] }), /not a valid date/);
  assert.throws(() => createCalendar({ events: [{ title: "x", start: "2026-10-18T10:00:00Z", end: "2026-10-17T10:00:00Z" }] }), RangeError);
  assert.throws(() => parseIcs(5), TypeError);
  assert.deepEqual(parseIcs("niets"), []);
});
