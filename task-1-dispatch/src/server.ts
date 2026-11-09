// @rev kc-31
import { createServer, type ServerResponse } from 'node:http';
import { assignOrder, branches, getBranchLoad, getOrder } from './store.ts';

const port = Number(process.env.PORT ?? 3001);

function validDate(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'GET' && url.pathname === '/branches') {
      return send(res, 200, branches);
    }

    if (req.method === 'GET' && parts[0] === 'orders' && parts.length === 2) {
      const order = getOrder(parts[1]);
      if (!order) return send(res, 404, { error: 'order_not_found' });
      return send(res, 200, order);
    }

    if (req.method === 'POST' && parts[0] === 'orders' && parts[2] === 'assign' && parts.length === 3) {
      const order = getOrder(parts[1]);
      if (!order) return send(res, 404, { error: 'order_not_found' });
      return send(res, 200, assignOrder(order));
    }

    if (req.method === 'GET' && parts[0] === 'branches' && parts[2] === 'load' && parts.length === 3) {
      const date = url.searchParams.get('date');
      if (!validDate(date)) return send(res, 400, { error: 'invalid_date' });
      const branch = branches.find((b) => b.id === parts[1]);
      if (!branch) return send(res, 404, { error: 'branch_not_found' });
      return send(res, 200, { branchId: branch.id, date, assigned: getBranchLoad(branch.id, date), limit: branch.dailyLimit });
    }

    send(res, 404, { error: 'not_found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'internal' });
  }
});

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

server.listen(port, () => {
  console.log(`dispatch: http://localhost:${port}`);
});
