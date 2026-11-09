// @rev kc-31
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSlots } from '../src/slots.ts';
import { overlaps, toMinutes } from '../src/time.ts';
import type { Booking, Master, Service } from '../src/types.ts';

const day = { from: '10:00', to: '13:00', breaks: [] };

const master: Master = {
  id: 'm-1',
  name: 'Тест',
  schedule: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: null, sun: null },
};

const cut: Service = { id: 's-cut', name: 'Стрижка', durationMin: 60, masterIds: ['m-1'] };

const range = (from: string, to: string) => ({ start: toMinutes(from), end: toMinutes(to) });

test('overlaps: пересекающиеся интервалы', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('10:30', '11:30')), true);
});

test('overlaps: запись сразу после другой не пересекается', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('11:00', '12:00')), false);
});

test('getSlots: свободный день', () => {
  // 2030-11-18 — понедельник
  const slots = getSlots(master, cut, '2030-11-18', []);
  assert.deepEqual(slots, ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45', '12:00']);
});

test('getSlots: выходной', () => {
  assert.deepEqual(getSlots(master, cut, '2030-11-23', []), []);
});

test('getSlots: слот не пересекает перерыв', () => {
  const withBreak: Master = { ...master, schedule: { ...master.schedule,
    mon: { from: '10:00', to: '13:00', breaks: [{ from: '11:00', to: '11:30' }] } } };
  assert.deepEqual(getSlots(withBreak, cut, '2030-11-18', []), ['10:00', '11:30', '11:45', '12:00']);
});

test('getSlots: занятое время не выдаётся, отменённые записи не мешают', () => {
  const booking: Booking = { id: 'b-1', masterId: 'm-1', serviceId: 's-cut',
    start: '2030-11-18T06:00:00.000Z', end: '2030-11-18T07:00:00.000Z',
    clientPhone: '+77012345678', status: 'active' };
  assert.deepEqual(getSlots(master, cut, '2030-11-18', [booking]), []);
  assert.deepEqual(getSlots(master, cut, '2030-11-18', [{
    ...booking, start: '2030-11-18T06:07:00.000Z', end: '2030-11-18T06:53:00.000Z',
  }]), ['10:00', '12:00']);
  assert.equal(getSlots(master, cut, '2030-11-18', [{ ...booking, status: 'cancelled' }]).length, 9);
});

test('getSlots: прошедшее время не выдаётся', () => {
  assert.deepEqual(getSlots(master, cut, '2030-11-18', [], new Date('2030-11-18T06:15:00Z')),
    ['11:30', '11:45', '12:00']);
});
