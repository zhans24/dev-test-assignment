// @rev kc-31
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { now } from './clock.ts';
import { getSlots } from './slots.ts';
import { bookingRepo, masters, services } from './store.ts';
import { localDateTime, slotInstant, validDate } from './time.ts';
import type { Booking } from './types.ts';

const port = Number(process.env.PORT ?? 3002);
const masterQueue = new Map<string, Promise<unknown>>();

async function runInMasterQueue<T>(masterId: string, action: () => Promise<T>): Promise<T> {
  const previous = masterQueue.get(masterId) ?? Promise.resolve();
  // Следующий запрос ждёт завершения предыдущего, даже если тот вернул ошибку.
  const current = previous.catch(() => {}).then(action);
  masterQueue.set(masterId, current);
  try {
    return await current;
  } finally {
    if (masterQueue.get(masterId) === current) masterQueue.delete(masterId);
  }
}

function phone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!/^\+?[\d\s()-]+$/.test(input)) return null;
  const digits = input.replace(/\D/g, '');
  if (input.startsWith('+') && !digits.startsWith('7')) return null;
  const normalized = digits.startsWith('8') && digits.length === 11 ? `7${digits.slice(1)}` : digits;
  return /^7(?:70\d|74\d|77\d)\d{7}$/.test(normalized) ? `+${normalized}` : null;
}

function validStart(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    validDate(value.slice(0, 10)) &&
    !Number.isNaN(Date.parse(value));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'GET' && url.pathname === '/masters') return send(res, 200, masters);
    if (req.method === 'GET' && url.pathname === '/services') return send(res, 200, services);

    if (req.method === 'GET' && parts[0] === 'masters' && parts[2] === 'slots' && parts.length === 3) {
      const master = masters.find((m) => m.id === parts[1]);
      if (!master) return send(res, 404, { error: 'master_not_found' });
      const serviceId = url.searchParams.get('serviceId');
      const date = url.searchParams.get('date');
      if (!serviceId || !validDate(date)) return send(res, 400, { error: 'invalid_request' });
      const service = services.find((s) => s.id === serviceId);
      if (!service) return send(res, 404, { error: 'service_not_found' });
      if (!service.masterIds.includes(master.id)) return send(res, 400, { error: 'service_unavailable' });
      const bookings = await bookingRepo.listByMaster(master.id);
      return send(res, 200, { masterId: master.id, serviceId, date, slots: getSlots(master, service, date, bookings) });
    }

    if (req.method === 'POST' && url.pathname === '/bookings') {
      let body: unknown;
      try { body = await readJson(req); } catch { return send(res, 400, { error: 'invalid_json' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'invalid_request' });
      const input = body as Record<string, unknown>;
      if (typeof input.masterId !== 'string' || typeof input.serviceId !== 'string') {
        return send(res, 400, { error: 'invalid_request' });
      }
      const master = masters.find((m) => m.id === input.masterId);
      if (!master) return send(res, 404, { error: 'master_not_found' });
      const service = services.find((s) => s.id === input.serviceId);
      if (!service) return send(res, 404, { error: 'service_not_found' });
      const clientPhone = phone(input.clientPhone);
      if (!validStart(input.start) || !clientPhone || !service.masterIds.includes(master.id)) {
        return send(res, 400, { error: 'invalid_request' });
      }
      const start = new Date(input.start);
      const { date, time } = localDateTime(start);
      const created = await runInMasterQueue(master.id, async () => {
        const bookings = await bookingRepo.listByMaster(master.id);
        if (slotInstant(date, time) !== start.getTime() ||
          !getSlots(master, service, date, bookings).includes(time)) return null;
        const booking: Booking = {
          id: randomUUID(), masterId: master.id, serviceId: service.id,
          start: start.toISOString(), end: new Date(start.getTime() + service.durationMin * 60_000).toISOString(),
          clientPhone, status: 'active',
        };
        await bookingRepo.insert(booking);
        return booking;
      });
      return created ? send(res, 201, created) : send(res, 409, { error: 'slot_unavailable' });
    }

    if (req.method === 'DELETE' && parts[0] === 'bookings' && parts.length === 2) {
      const booking = await bookingRepo.get(parts[1]);
      if (!booking) return send(res, 404, { error: 'booking_not_found' });
      const result = await runInMasterQueue(booking.masterId, async () => {
        const current = (await bookingRepo.get(booking.id))!;
        if (current.status === 'cancelled') return current;
        if (Date.parse(current.start) - now().getTime() < 2 * 60 * 60 * 1000) {
          return null;
        }
        await bookingRepo.update(current.id, { status: 'cancelled' });
        return { ...current, status: 'cancelled' };
      });
      return result ? send(res, 200, result) : send(res, 409, { error: 'too_late' });
    }

    send(res, 404, { error: 'not_found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'internal' });
  }
});

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : null;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

server.listen(port, () => {
  console.log(`booking: http://localhost:${port}`);
});
