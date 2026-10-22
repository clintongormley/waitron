import type { ServiceStep } from "@waitron/venue-service";
import { serviceCompletedAt } from "./line-service-state.js";

export interface StepRule {
  id: string;
  name: string;
  start: ServiceStep["start"];
  courseId: string | null;
  minutes: number;
}

export interface StepFacts {
  openedAt: number;
  firstOrderAt: number | null;
  lastOrderAt: number | null;
  drafting: boolean;
  courseServedAt: ReadonlyMap<string, number>;
  allServedAt: number | null;
  doneAt: ReadonlyMap<string, number>;
}

export interface LiveStep {
  stepId: string;
  name: string;
  triggeredAt: number;
  dueAt: number;
}

export interface DishServing {
  courseId: string | null;
  quantity: number;
  servedQuantity: number;
  servedAt: string | null;
  cancelledQuantity: number;
  cancelledAt: string | null;
}

const MINUTE_MS = 60_000;

function triggerOf(
  rules: readonly StepRule[],
  index: number,
  facts: StepFacts,
  nowMs: number,
): number | null {
  const rule = rules[index]!;
  switch (rule.start) {
    case "seated":
      return facts.openedAt;
    case "after_previous":
      return index === 0 ? null : (facts.doneAt.get(rules[index - 1]!.id) ?? null);
    case "course_served":
      return rule.courseId === null ? null : (facts.courseServedAt.get(rule.courseId) ?? null);
    case "all_served":
      return facts.allServedAt;
    case "since_last_order": {
      const last = facts.lastOrderAt;
      if (last === null) return null;
      const every = rule.minutes * MINUTE_MS;
      const repeat = last + Math.max(1, Math.floor((nowMs - last) / every)) * every;
      const done = facts.doneAt.get(rule.id);
      if (done === undefined || done <= repeat) return repeat;
      return last + (Math.floor((done - last) / every) + 1) * every;
    }
  }
}

/**
 * A step's trigger is the moment its start happened; it is due at its trigger plus its minutes (a
 * `since_last_order` repeat is due at its trigger). A triggered step stays live until its own Done
 * is later than its trigger, an order is sent later than its due time, the party's first order is
 * later than its trigger, or — before the first order — the party has an open draft. Live steps
 * come soonest due first, ties in list order.
 */
export function liveSteps(rules: readonly StepRule[], facts: StepFacts, nowMs: number): LiveStep[] {
  const live: LiveStep[] = [];
  if (facts.firstOrderAt === null && facts.drafting) return live;
  rules.forEach((rule, index) => {
    const triggeredAt = triggerOf(rules, index, facts, nowMs);
    if (triggeredAt === null) return;
    const dueAt =
      rule.start === "since_last_order" ? triggeredAt : triggeredAt + rule.minutes * MINUTE_MS;
    const done = facts.doneAt.get(rule.id);
    if (done !== undefined && done > triggeredAt) return;
    if (facts.lastOrderAt !== null && facts.lastOrderAt > dueAt) return;
    if (facts.firstOrderAt !== null && facts.firstOrderAt > triggeredAt) return;
    live.push({ stepId: rule.id, name: rule.name, triggeredAt, dueAt });
  });
  return live.sort((a, b) => a.dueAt - b.dueAt);
}

export function servedTimes(dishes: readonly DishServing[]): {
  courseServedAt: Map<string, number>;
  allServedAt: number | null;
} {
  const latest = new Map<string, number>();
  const unserved = new Set<string>();
  let allLatest: number | null = null;
  let allUnserved = false;
  for (const dish of dishes) {
    const completedAt = serviceCompletedAt(dish);
    if (completedAt === null) {
      allUnserved = true;
      if (dish.courseId !== null) unserved.add(dish.courseId);
      continue;
    }
    const end = Date.parse(completedAt);
    allLatest = Math.max(allLatest ?? end, end);
    if (dish.courseId !== null) {
      latest.set(dish.courseId, Math.max(latest.get(dish.courseId) ?? end, end));
    }
  }
  for (const courseId of unserved) latest.delete(courseId);
  return { courseServedAt: latest, allServedAt: allUnserved ? null : allLatest };
}
