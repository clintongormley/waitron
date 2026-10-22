import type { StepRule } from "@waitron/venue-service";
import { serviceCompletedAt } from "./line-service-state.js";

export type { StepRule };

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
      const repeat = repeatShownAt(last, every, nowMs);
      const done = facts.doneAt.get(rule.id);
      if (done === undefined || done <= last) return repeat;
      return Math.max(repeat, repeatShownAt(last, every, done) + every);
    }
  }
}

/** The repeat showing at `at`, or the first one while none has fallen due. */
function repeatShownAt(last: number, every: number, at: number): number {
  return last + Math.max(1, Math.floor((at - last) / every)) * every;
}

/**
 * A step's trigger is the moment its start happened, or for `since_last_order` its next repeat,
 * which may be ahead: a Done clears the repeat showing when it was tapped, or the first one if none
 * had fallen due. It is due at its trigger plus its minutes, or at the repeat itself. A triggered
 * step stays live until its own Done is later than its trigger, an order is sent later than its due time, the party's first order is
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

/**
 * What a Done on `stepId` at `nowMs` records: nothing when the step is not live or a Done now would
 * leave it as it is (a second tap on a repeat already done), else the step and every live step due
 * no later that a Done now would clear, the ones it was hiding.
 */
export function stepsClearedByDone(
  rules: readonly StepRule[],
  facts: StepFacts,
  stepId: string,
  nowMs: number,
): string[] {
  const live = liveSteps(rules, facts, nowMs);
  const shown = live.find((step) => step.stepId === stepId);
  if (shown === undefined) return [];
  const clears = (step: LiveStep): boolean => {
    const doneAt = new Map(facts.doneAt);
    doneAt.set(step.stepId, Math.max(doneAt.get(step.stepId) ?? nowMs, nowMs));
    const after = liveSteps(rules, { ...facts, doneAt }, nowMs).find(
      (next) => next.stepId === step.stepId,
    );
    return after?.triggeredAt !== step.triggeredAt;
  };
  if (!clears(shown)) return [];
  return live
    .filter((step) => step.dueAt <= shown.dueAt && clears(step))
    .map((step) => step.stepId);
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
