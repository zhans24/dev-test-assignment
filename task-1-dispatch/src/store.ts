// @rev kc-31
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assignBranch } from './router.ts';
import type { Assignment, Branch, Order } from './types.ts';

const dataDir = process.env.DATA_DIR ?? join(import.meta.dirname, '..', 'data');

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as T;
}

export const branches: Branch[] = load('branches.json');
const orders = new Map(load<Order[]>('orders.json').map((order) => [order.id, order]));
const assignments = new Map<string, Assignment>();
const dailyLoads = new Map<string, Map<string, number>>();
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

export function getOrder(id: string): Order | undefined {
  return orders.get(id);
}

export function getBranchLoad(branchId: string, date: string): number {
  return dailyLoads.get(date)?.get(branchId) ?? 0;
}

export function assignOrder(order: Order): Assignment {
  const existing = assignments.get(order.id);
  if (existing) return existing;

  const date = new Date(Date.parse(order.createdAt) + ALMATY_OFFSET_MS).toISOString().slice(0, 10);
  const assignment = assignBranch(order, branches, (id) => getBranchLoad(id, date));
  if (assignment.branchId !== null) {
    const loads = dailyLoads.get(date) ?? new Map<string, number>();
    loads.set(assignment.branchId, getBranchLoad(assignment.branchId, date) + 1);
    dailyLoads.set(date, loads);
  }
  assignments.set(order.id, assignment);
  return assignment;
}
