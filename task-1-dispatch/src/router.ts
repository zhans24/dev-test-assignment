// @rev kc-31
import type { Assignment, Branch, Order, Rule } from './types.ts';
import { distanceKm } from './geo.ts';

const MAX_GEO_DISTANCE_KM = 42;

export function assignBranch(
  order: Order,
  branches: Branch[],
  assignedCount: (branchId: string) => number = () => 0,
): Assignment {
  const activeBranches = branches.filter((branch) => branch.storeId === order.storeId && branch.active);
  const result = (branch: Branch | null, rule: Rule): Assignment => ({
    orderId: order.id,
    branchId: branch?.id ?? null,
    rule,
  });

  const manual = activeBranches.find((branch) => branch.id === order.manualBranchId);
  if (manual) return result(manual, 'manual');

  const hasCapacity = (branch: Branch) => assignedCount(branch.id) < branch.dailyLimit;
  const geoResult = (candidate: NearestBranch | null): Assignment => {
    if (!candidate) return result(null, 'unassigned');
    if (candidate.distance > MAX_GEO_DISTANCE_KM) return result(null, 'too_far');
    return result(candidate.branch, 'geo');
  };
  const fallback = () => geoResult(findNearest(order, activeBranches.filter(hasCapacity)));
  const choose = (branch: Branch, rule: Rule) =>
    hasCapacity(branch) ? result(branch, rule) : fallback();

  if (activeBranches.length === 1) return choose(activeBranches[0], 'single');
  if (order.pickupPointId !== null) {
    const pickupPointId = order.pickupPointId;
    const pickup = activeBranches.find((branch) => branch.pickupPointIds.includes(pickupPointId));
    if (pickup) return choose(pickup, 'pickup_point');
  }

  const inCity = activeBranches.filter((branch) => branch.city === order.city);
  if (inCity.length === 1) return choose(inCity[0], 'city');
  const nearest = findNearest(order, inCity.length > 1 ? inCity : activeBranches);
  if (nearest && !hasCapacity(nearest.branch)) return fallback();
  return geoResult(nearest);
}

type NearestBranch = { branch: Branch; distance: number };

function findNearest(order: Order, branches: Branch[]): NearestBranch | null {
  if (order.lat === null || order.lon === null) return null;

  let best: NearestBranch | null = null;
  for (const b of branches) {
    const distance = distanceKm(order.lat, order.lon, b.lat, b.lon);
    if (distance < (best?.distance ?? Infinity)) best = { branch: b, distance };
  }
  return best;
}
