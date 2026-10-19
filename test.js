import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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


test("semicolons, commas, backslashes and line breaks in text survive a write and read", () => {
  const texts = ["a;b", "a,b", "a\\b", "a\nb", "a\r\nb", ";\u005c;", "\\n", "end\\", ";;;", "naïve; café, 😀\u005c;"];
  const calendar = createCalendar({ events: texts.map((title) => ({ title, description: title, location: title, start: "2026-10-17T10:00:00Z" })), now });
  assert.ok(calendar.split("\r\n").some((line) => line === "SUMMARY:a\u005c;b"), "the semicolon is written as backslash-semicolon");
  const back = parseIcs(calendar);
  assert.deepEqual(back.map((e) => e.title), texts.map((t) => t.replace(/\r\n/g, "\n")));
  assert.deepEqual(back.map((e) => e.description), back.map((e) => e.title));
});

test("values written as they are cannot carry a line break (no injected alarms or attendees)", () => {
  const base = { title: "x", start: "2026-10-17T10:00:00Z" };
  const evil = "http://example.com\r\nBEGIN:VALARM\r\nACTION:PROCEDURE";
  assert.throws(() => createCalendar({ events: [{ ...base, url: evil }], now }), TypeError);
  assert.throws(() => createCalendar({ events: [{ ...base, uid: "a\nX-EVIL:1" }], now }), TypeError);
  assert.throws(() => createCalendar({ events: [{ ...base, status: "confirmed\r\nX-EVIL:1" }], now }), RangeError);
  assert.throws(() => createCalendar({ prodId: "x\r\nX-EVIL:1", events: [], now }), TypeError);
  assert.throws(() => createCalendar({ events: [{ ...base, status: "maybe" }], now }), RangeError);
  const fine = createCalendar({ events: [{ ...base, url: "https://example.com/a?b=c;d", status: "Confirmed" }], now });
  assert.ok(fine.includes("\r\nSTATUS:CONFIRMED\r\n") && fine.includes("\r\nURL:https://example.com/a?b=c;d\r\n"));
  assert.ok(!/\r\nX-EVIL/.test(createCalendar({ events: [{ ...base, title: "t\r\nX-EVIL:1", description: "d\nX-EVIL:1", location: "l\rX-EVIL:1" }], now })));
});

test("start, end and now must really be dates: null is not 1970", () => {
  assert.throws(() => createCalendar({ events: [{ title: "x", start: null }], now }), TypeError);
  assert.throws(() => createCalendar({ events: [{ title: "x", start: true }], now }), TypeError);
  assert.throws(() => createCalendar({ events: [{ title: "x", start: "2026-10-17T10:00:00Z", end: null }], now }), TypeError);
  assert.throws(() => createCalendar({ events: [{ title: "x", start: "2026-10-17T10:00:00Z" }], now: new Date(NaN) }), TypeError);
  assert.throws(() => createCalendar({ events: [{ title: "x", start: new Date(Date.UTC(10000, 0, 1)) }], now }), RangeError);
  assert.ok(createCalendar({ events: [{ title: "x", start: new Date(Date.UTC(999, 0, 1)) }], now }).includes("DTSTART:09990101T000000Z"));
});

test("an alarm inside an event does not replace the event's description", () => {
  const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:1", "SUMMARY:Meeting", "DESCRIPTION:Real description", "DTSTART:20261017T100000Z", "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-PT15M", "END:VALARM", "LOCATION:Room 1", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  const [event] = parseIcs(ics);
  assert.equal(event.description, "Real description");
  assert.equal(event.location, "Room 1");
  assert.equal(parseIcs(ics.replace(/VEVENT/g, "vevent").replace("SUMMARY", "summary")).length, 1);
});

test("quoted parameters may contain a colon; invalid dates are ignored, not rolled over", () => {
  assert.equal(parseIcs('BEGIN:VEVENT\r\nDESCRIPTION;ALTREP="http://x/y":Plain text\r\nEND:VEVENT\r\n')[0].description, "Plain text");
  assert.deepEqual(parseIcs("BEGIN:VEVENT\r\nDTSTART:20261340T250000Z\r\nEND:VEVENT\r\n"), [{}]);
  assert.deepEqual(parseIcs("BEGIN:VEVENT\r\nDTSTART:20260230T100000Z\r\nEND:VEVENT\r\n"), [{}]);
  assert.equal(parseIcs("BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20240229\r\nEND:VEVENT\r\n")[0].start.toISOString(), "2024-02-29T00:00:00.000Z");
});

test("DURATION without DTEND gives an end", () => {
  const [timed] = parseIcs("BEGIN:VEVENT\r\nDURATION:PT1H30M\r\nDTSTART:20261017T100000Z\r\nEND:VEVENT\r\n");
  assert.equal(timed.end.toISOString(), "2026-10-17T11:30:00.000Z");
  const [allDay] = parseIcs("BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261017\r\nDURATION:P2D\r\nEND:VEVENT\r\n");
  assert.equal(allDay.end.toISOString(), "2026-10-18T00:00:00.000Z"); // the last day, inclusive
});

test("folding: every line is at most 75 octets, no character is split, unfolding gives the original, CRLF only", () => {
  const long = "€".repeat(100) + "😀".repeat(30) + "é".repeat(60) + "a".repeat(77);
  for (const text of [long, "x".repeat(200), "😀".repeat(80), "é".repeat(74), "é".repeat(75)]) {
    const out = createCalendar({ events: [{ title: text, description: text, location: text, start: "2026-10-17T10:00:00Z" }], now });
    for (const line of out.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `${Buffer.byteLength(line)} octets`);
    assert.ok(!/(^|[^\r])\n/.test(out) && !out.includes("�"));
    assert.equal(parseIcs(out)[0].title, text);
    assert.equal(parseIcs(out)[0].description, text);
    // every physical line is valid UTF-8 on its own (a split character would not survive a decode)
    for (const line of out.split("\r\n")) assert.equal(Buffer.from(line, "utf8").toString("utf8"), line);
  }
});

test("random events: write then read gives the same events (UTC times, any process time zone)", () => {
  const pool = ["a", "b c", ";", ",", "\\", "\n", "é", "😀", "€", "x".repeat(40), " ", ":", "=", '"'];
  const pick = (n) => randomBytes(1)[0] % n;
  const text = () => Array.from({ length: 1 + pick(8) }, () => pool[pick(pool.length)]).join("");
  for (let i = 0; i < 300; i++) {
    const start = new Date(Date.UTC(2024 + pick(4), pick(12), 1 + pick(28), pick(24), pick(60), pick(60)));
    const end = new Date(start.getTime() + pick(100) * 3_600_000);
    const allDay = pick(4) === 0;
    const event = { title: text(), description: text(), location: text(), start, end, allDay, uid: `id-${i}@test` };
    const [back] = parseIcs(createCalendar({ events: [event], now }));
    assert.equal(back.title, event.title);
    assert.equal(back.description, event.description);
    assert.equal(back.location, event.location);
    assert.equal(back.uid, event.uid);
    assert.equal(back.allDay, allDay);
    if (allDay) {
      assert.equal(back.start.toISOString().slice(0, 10), start.toISOString().slice(0, 10));
      assert.equal(back.end.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
    } else {
      assert.equal(back.start.getTime(), Math.floor(start.getTime() / 1000) * 1000);
      assert.equal(back.end.getTime(), Math.floor(end.getTime() / 1000) * 1000);
    }
  }
});

test("around the Amsterdam clock changes the file says the same UTC instant", () => {
  const events = [
    { title: "before", start: "2026-03-29T01:30:00+01:00", end: "2026-03-29T03:30:00+02:00" }, // 00:30Z to 01:30Z: the hour 02:00-03:00 does not exist
    { title: "autumn", start: "2026-10-25T02:30:00+02:00", end: "2026-10-25T02:30:00+01:00" }, // 00:30Z to 01:30Z: 02:30 happens twice
    { title: "day", start: "2026-03-29", allDay: true }
  ];
  const ics = createCalendar({ events, now });
  assert.ok(ics.includes("DTSTART:20260329T003000Z\r\nDTEND:20260329T013000Z"));
  assert.ok(ics.includes("DTSTART:20261025T003000Z\r\nDTEND:20261025T013000Z"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20260329\r\nDTEND;VALUE=DATE:20260330"));
});
