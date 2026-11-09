// @rev kc-31
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignBranch } from '../src/router.ts';
import { distanceKm } from '../src/geo.ts';
import type { Branch, Order } from '../src/types.ts';

const branch = (over: Partial<Branch>): Branch => ({
  id: 'b-1',
  storeId: 's-1',
  name: 'Филиал',
  city: 'Алматы',
  lat: 43.24,
  lon: 76.91,
  active: true,
  pickupPointIds: [],
  dailyLimit: 100,
  ...over,
});

const order = (over: Partial<Order>): Order => ({
  id: 'o-1',
  storeId: 's-1',
  city: 'Алматы',
  lat: 43.25,
  lon: 76.92,
  pickupPointId: null,
  manualBranchId: null,
  createdAt: '2026-11-16T06:00:00Z',
  ...over,
});

const almaty = branch({ id: 'b-ala', city: 'Алматы', lat: 43.2567, lon: 76.9286 });
const astana = branch({ id: 'b-ast', city: 'Астана', lat: 51.128, lon: 71.43 });

test('distanceKm: Алматы — Астана около 970 км', () => {
  const d = distanceKm(43.2389, 76.8897, 51.1694, 71.4491);
  assert.ok(Math.abs(d - 970) < 15, `получили ${d.toFixed(1)}`);
});

test('manual: заказ уходит в указанный филиал', () => {
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'manual' });
});

test('manual: неактивный филиал пропускается', () => {
  const closed = { ...astana, active: false };
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, closed]);
  assert.notEqual(res.rule, 'manual');
});

test('single: у магазина один активный филиал', () => {
  const res = assignBranch(order({ city: 'Шымкент' }), [almaty]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'single' });
});

test('geo: выбирается ближайший филиал', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: 43.25, lon: 76.93 }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'geo' });
});

test('geo: без координат заказ не распределяется', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: null, lon: null }), [almaty, astana]);
  assert.equal(res.rule, 'unassigned');
});

test('geo: радиус 42 км применяется только к выбору по координатам', () => {
  const request = order({ city: 'Конаев', lat: 0, lon: 0 });
  const nearby = branch({ id: 'b-near', lat: 0, lon: 0.377 });
  const outside = branch({ id: 'b-far', lat: 0, lon: 0.378 });
  assert.equal(assignBranch(request, [nearby, outside]).branchId, nearby.id);
  assert.deepEqual(assignBranch(request, [outside, astana]),
    { orderId: request.id, branchId: null, rule: 'too_far' });
  assert.equal(assignBranch(request, [outside, astana], () => 100).rule, 'unassigned');
  assert.equal(assignBranch({ ...request, manualBranchId: outside.id }, [outside, astana]).rule, 'manual');
  assert.equal(assignBranch({ ...request, pickupPointId: 'pp-1' },
    [{ ...nearby, pickupPointIds: ['pp-1'], dailyLimit: 0 }, outside]).rule, 'too_far');
});

test('pickup_point: пункт выдачи закреплён за филиалом', () => {
  const selected = branch({ id: 'b-pickup', city: 'Астана', pickupPointIds: ['pp-1'] });
  assert.deepEqual(assignBranch(order({ pickupPointId: 'pp-1' }), [almaty, selected]),
    { orderId: 'o-1', branchId: 'b-pickup', rule: 'pickup_point' });
});

test('city: в городе заказа один филиал магазина', () => {
  assert.deepEqual(assignBranch(order({ lat: null, lon: null }), [almaty, astana]),
    { orderId: 'o-1', branchId: 'b-ala', rule: 'city' });
});

test('geo: если в городе несколько филиалов, выбирается ближайший из них', () => {
  const second = branch({ id: 'b-ala-2', lat: 43.26, lon: 76.94 });
  const otherCity = branch({ id: 'b-other', city: 'Астана', lat: 43.25, lon: 76.92 });
  assert.deepEqual(assignBranch(order({ lat: 43.259, lon: 76.941 }), [almaty, second, otherCity]),
    { orderId: 'o-1', branchId: 'b-ala-2', rule: 'geo' });
});

test('лимит: заполненный филиал пропускается', () => {
  const selected = branch({ id: 'b-full', pickupPointIds: ['pp-1'], dailyLimit: 1 });
  const fallback = branch({ id: 'b-free', lat: 43.3, lon: 76.9 });
  assert.deepEqual(assignBranch(order({ pickupPointId: 'pp-1' }), [selected, fallback],
    (id) => id === 'b-full' ? 1 : 0),
  { orderId: 'o-1', branchId: 'b-free', rule: 'geo' });
});

test('manual: лимит не применяется', () => {
  const full = branch({ id: 'b-full', dailyLimit: 0 });
  assert.equal(assignBranch(order({ manualBranchId: 'b-full' }), [full], () => 10).branchId, 'b-full');
});

test('лимит: без координат резервный филиал не выбирается', () => {
  const full = branch({ id: 'b-full', dailyLimit: 0 });
  assert.equal(assignBranch(order({ lat: null, lon: null }), [full]).rule, 'unassigned');
});
