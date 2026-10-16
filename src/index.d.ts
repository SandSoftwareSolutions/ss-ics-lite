export interface CalendarEvent {
  title: string;
  start: Date | string | number;
  /** For an all-day event: the last day, inclusive. */
  end?: Date | string | number;
  allDay?: boolean;
  description?: string;
  location?: string;
  url?: string;
  uid?: string;
  status?: "confirmed" | "tentative" | "cancelled";
}

export interface CalendarOptions {
  name?: string;
  events?: CalendarEvent[];
  prodId?: string;
  /** Fixes DTSTAMP; for tests. */
  now?: Date;
}

export interface ParsedEvent {
  title?: string;
  start?: Date;
  end?: Date;
  allDay?: boolean;
  description?: string;
  location?: string;
  url?: string;
  uid?: string;
  status?: string;
  /** Raw recurrence rule; not expanded. */
  rrule?: string;
  /** The time had no Z or a TZID and was read as UTC. */
  floating?: boolean;
}

export function createCalendar(options?: CalendarOptions): string;
export function parseIcs(text: string): ParsedEvent[];
