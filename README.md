# @sandsoftwaresolutions/ics-lite

[![CI](https://github.com/SandSoftwareSolutions/ss-ics-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/SandSoftwareSolutions/ss-ics-lite/actions/workflows/ci.yml)

Make calendar files (`.ics`) from your own data, and read them back. For rosters, bookings, deadlines: your people click a link and the shifts are in their phone's calendar. No dependencies.

## Install

```bash
npm install @sandsoftwaresolutions/ics-lite
```

## Write

```js
import { createCalendar } from "@sandsoftwaresolutions/ics-lite";

const ics = createCalendar({
  name: "Rooster Strandtent",
  events: [
    { title: "Avonddienst", start: "2026-10-17T16:00:00Z", end: "2026-10-18T00:30:00Z", location: "Strandtent, Zandvoort" },
    { title: "Vrij", start: "2026-10-20", allDay: true }
  ]
});
// Serve it as text/calendar, or save it as rooster.ics
```

- Times are written in UTC, so every calendar app shows them at the right local time.
- **Stable ids.** Without a `uid`, one is made from the content. Importing the same file twice therefore updates instead of duplicating. Give your own `uid` (such as your shift id) if events can change their title or time and must still count as the same event.
- All-day events use dates; `end` is the last day, inclusive (the file format itself wants it exclusive, this package does that for you).
- Text is escaped, lines are folded at 75 bytes without cutting a character in half, and line endings are CRLF as the standard asks.
- Wrong input fails clearly: no title, an invalid date (`null` is not 1970), an end before the start, a year outside 0000-9999, a `status` other than confirmed, tentative or cancelled, and a line break or other control character in `uid`, `url` or `prodId` (those are written as they are, so they could otherwise add an alarm or attendee to the file). Text fields are escaped (`;` `,` `\` and line breaks).
- An all-day event uses the **UTC date** of the Date you give. `new Date(2026, 9, 20)` is local midnight, which in Asia/Kolkata is still 19 October in UTC: pass a date text (`"2026-10-20"`) or a UTC Date.

## Read

```js
import { parseIcs } from "@sandsoftwaresolutions/ics-lite";

parseIcs(text); // [{ uid, title, start: Date, end: Date, allDay, description, location, url, status }]
```

Handles folded lines and escapes, and the files other programs make. Limits you should know about:

- A time without `Z`, or with a `TZID`, is read as UTC and marked `floating: true`. Time zones are not resolved.
- Recurring events are not expanded; the raw rule is returned as `rrule`.
- A `DURATION` without `DTEND` becomes `end`. Alarms (`VALARM`) and other components inside an event are skipped. Dates that do not exist (`20261340`) are ignored instead of rolling over into another month.
