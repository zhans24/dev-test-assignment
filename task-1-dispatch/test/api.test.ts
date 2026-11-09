// @rev kc-31
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function startServer() {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['task-1-dispatch/src/server.ts'], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await Promise.race([
    once(child.stdout!, 'data'),
    once(child, 'exit').then(() => { throw new Error('dispatch server exited'); }),
  ]);
  return { base: `http://localhost:${port}`, stop: () => child.kill() };
}

test('dispatch API: idempotency, daily limit, Almaty date and errors', async () => {
  const server = await startServer();
  try {
    const request = async (path: string, method = 'GET') => {
      const response = await fetch(`${server.base}${path}`, { method });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    assert.equal((await request('/orders/missing/assign', 'POST')).status, 404);
    assert.deepEqual(await request('/orders/o-107/assign', 'POST'),
      { status: 200, body: { orderId: 'o-107', branchId: null, rule: 'too_far' } });
    assert.equal((await request('/branches/b-ala-1/load')).status, 400);
    assert.equal((await request('/branches/b-ala-1/load?date=2026-02-30')).status, 400);
    assert.equal((await request('/branches/missing/load?date=2026-11-16')).status, 404);
    for (const id of ['o-101', 'o-109', 'o-110']) {
      assert.equal((await request(`/orders/${id}/assign`, 'POST')).body.branchId, 'b-ala-1');
    }
    const repeated = await request('/orders/o-101/assign', 'POST');
    assert.equal(repeated.body.rule, 'pickup_point');
    assert.deepEqual((await request('/branches/b-ala-1/load?date=2026-11-16')).body,
      { branchId: 'b-ala-1', date: '2026-11-16', assigned: 3, limit: 3 });
    const fallback = await request('/orders/o-111/assign', 'POST');
    assert.equal(fallback.body.branchId, 'b-ala-2');
    assert.equal(fallback.body.rule, 'geo');
    assert.equal((await request('/orders/o-112/assign', 'POST')).body.branchId, 'b-ala-1');
    assert.equal((await request('/branches/b-ala-1/load?date=2026-11-17')).body.assigned, 1);
    assert.equal((await request('/orders/o-113/assign', 'POST')).body.branchId, 'b-ala-1');
    assert.equal((await request('/branches/b-ala-1/load?date=2026-11-15')).body.assigned, 1);
    const manual = await request('/orders/o-102/assign', 'POST');
    assert.equal(manual.body.rule, 'manual');
    assert.equal((await request('/branches/b-ast-1/load?date=2026-11-16')).body.assigned, 1);
  } finally { server.stop(); }
});
