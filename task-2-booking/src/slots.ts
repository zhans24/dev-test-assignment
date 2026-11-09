// @rev kc-31
import type { Booking, Master, Service } from './types.ts';
import { now } from './clock.ts';
import { fromMinutes, overlaps, slotInstant, toMinutes, weekday } from './time.ts';

export const SLOT_STEP_MIN = 15;
const CLEANUP_MS = 7 * 60_000;

// Свободные слоты мастера на дату, 'HH:mm' по Алматы
export function getSlots(master: Master, service: Service, date: string, bookings: Booking[], current = now()): string[] {
  const day = master.schedule[weekday(date)];
  if (!day) return [];

  const result: string[] = [];
  const end = toMinutes(day.to);
  const occupied = bookings
    .filter((booking) => booking.masterId === master.id && booking.status === 'active')
    .map((booking) => ({ start: Date.parse(booking.start), end: Date.parse(booking.end) + CLEANUP_MS }));
  for (let t = toMinutes(day.from); t + service.durationMin <= end; t += SLOT_STEP_MIN) {
    const time = fromMinutes(t);
    const start = slotInstant(date, time);
    const range = { start, end: start + service.durationMin * 60_000 + CLEANUP_MS };
    if (start <= current.getTime()) continue;
    if (day.breaks.some((pause) => overlaps({ start: t, end: t + service.durationMin },
      { start: toMinutes(pause.from), end: toMinutes(pause.to) }))) continue;
    if (occupied.some((booking) => overlaps(range, booking))) continue;
    result.push(time);
  }
  return result;
}
