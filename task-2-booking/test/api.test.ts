// @rev kc-31
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function startServer(now: string) {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['task-2-booking/src/server.ts'], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(port), NOW: now }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await Promise.race([
    once(child.stdout!, 'data'),
    once(child, 'exit').then(() => { throw new Error('booking server exited'); }),
  ]);
  return { base: `http://localhost:${port}`, stop: () => child.kill() };
}

test('booking API: validation, concurrent booking and cancellation', async () => {
  const server = await startServer('2030-11-18T04:00:00Z');
  try {
    const request = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`${server.base}${path}`, {
        method, headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    assert.equal((await request('/masters/missing/slots?serviceId=s-cut&date=2030-11-18')).status, 404);
    assert.equal((await request('/masters/m-1/slots?serviceId=s-cut&date=2030-02-30')).status, 400);
    assert.equal((await request('/masters/m-1/slots?serviceId=s-mani&date=2030-11-18')).status, 400);
    const { body: { slots } } = await request('/masters/m-1/slots?serviceId=s-cut&date=2030-11-18');
    assert.ok(Array.isArray(slots));
    assert.ok(!slots.includes('11:00') && slots.includes('11:15'));
    const payload = { masterId: 'm-1', serviceId: 's-cut', start: '2030-11-18T11:15:00+05:00', clientPhone: '8 (701) 234-56-78' };
    assert.deepEqual(await request('/bookings', 'POST', { ...payload, start: '2030-11-18T11:00:00+05:00' }),
      { status: 409, body: { error: 'slot_unavailable' } });
    assert.equal((await request('/bookings', 'POST', { ...payload, clientPhone: '123' })).status, 400);
    assert.equal((await request('/bookings', 'POST', { ...payload, clientPhone: '++7 (701) 234-56-78' })).status, 400);
    assert.equal((await request('/bookings', 'POST', { ...payload, start: '2031-02-29T11:00:00+05:00' })).status, 400);
    const results = await Promise.all([request('/bookings', 'POST', payload), request('/bookings', 'POST', payload)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const created = results.find((r) => r.status === 201)!.body;
    assert.equal(created.clientPhone, '+77012345678');
    assert.equal(created.start, '2030-11-18T06:15:00.000Z');
    assert.deepEqual((await request('/bookings', 'POST', payload)).body, { error: 'slot_unavailable' });
    assert.equal((await request(`/bookings/${created.id}`, 'DELETE')).body.status, 'cancelled');
    assert.equal((await request(`/bookings/${created.id}`, 'DELETE')).status, 200);
    assert.equal((await request('/bookings/missing', 'DELETE')).status, 404);
  } finally { server.stop(); }
});

test('booking API: cancellation within two hours is rejected', async () => {
  const server = await startServer('2030-11-18T05:31:00Z');
  try {
    const response = await fetch(`${server.base}/bookings/bk-2`, { method: 'DELETE' });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'too_late' });
  } finally { server.stop(); }
});
