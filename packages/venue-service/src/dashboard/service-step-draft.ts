import type { ServiceStepStart } from "@waitron/db";
import type { ServiceStep, ServiceStepInput } from "../service-steps.js";

/** `minutes` is text so a blank or a fraction can be shown and refused; `key` is the saved id, or
 * one made when the row is added. */
export interface ServiceStepDraft {
  key: string;
  id: string | null;
  name: string;
  start: ServiceStepStart;
  courseId: string | null;
  afterStepKey?: string | null;
  minutes: string;
}

export const toStepDrafts = (rows: readonly ServiceStep[]): ServiceStepDraft[] =>
  rows.map((row) => ({
    key: row.id,
    id: row.id,
    name: row.name,
    start: row.start,
    courseId: row.courseId,
    afterStepKey: row.afterStepId,
    minutes: String(row.minutes),
  }));

const WHOLE = /^\d+$/;
const sameMinutes = (a: string, b: string) => {
  const x = a.trim(),
    y = b.trim();
  return WHOLE.test(x) && WHOLE.test(y) ? Number(x) === Number(y) : x === y;
};

export const stepsEqual = (a: readonly ServiceStepDraft[], b: readonly ServiceStepDraft[]) =>
  a.length === b.length &&
  a.every(
    (step, index) =>
      step.id === b[index]!.id &&
      step.name.trim() === b[index]!.name.trim() &&
      step.start === b[index]!.start &&
      step.courseId === b[index]!.courseId &&
      ((step.afterStepKey ?? null) === (b[index]!.afterStepKey ?? null) ||
        (step.afterStepKey != null &&
          b[index]!.afterStepKey != null &&
          a.findIndex((row) => row.key === step.afterStepKey) >= 0 &&
          a.findIndex((row) => row.key === step.afterStepKey) ===
            b.findIndex((row) => row.key === b[index]!.afterStepKey))) &&
      sameMinutes(step.minutes, b[index]!.minutes),
  );

/** `saved` with each id-less row given the id `model` holds at its place, when that makes the two
 * lists equal: the model is then the list `saved` was, after the save that gave those rows ids. */
export function withSavedIds(
  saved: readonly ServiceStepDraft[],
  model: readonly ServiceStepDraft[],
): ServiceStepDraft[] | undefined {
  if (saved.length !== model.length) return undefined;
  const filled = saved.map((step, index) => ({ ...step, id: step.id ?? model[index]!.id }));
  return stepsEqual(filled, model) ? filled : undefined;
}

export const toStepInputs = (drafts: readonly ServiceStepDraft[]): ServiceStepInput[] =>
  drafts.map((draft) => ({
    ...(draft.id === null ? {} : { id: draft.id }),
    key: draft.key,
    afterStepKey: draft.afterStepKey ?? null,
    name: draft.name.trim(),
    start: draft.start,
    courseId: draft.courseId,
    minutes: Number(draft.minutes.trim()),
  }));

export function dependentStepKeys(steps: readonly ServiceStepDraft[], key: string): Set<string> {
  const removed = new Set([key]);
  let size: number;
  do {
    size = removed.size;
    for (const step of steps)
      if (step.afterStepKey != null && removed.has(step.afterStepKey)) removed.add(step.key);
  } while (size !== removed.size);
  return removed;
}

export function placeServiceSteps(
  steps: readonly ServiceStepDraft[],
  courseIds: readonly string[],
): ServiceStepDraft[] {
  const rootRank = (step: ServiceStepDraft): number => {
    switch (step.start) {
      case "seated":
        return 0;
      case "course_served":
        return 1 + Math.max(0, courseIds.indexOf(step.courseId!));
      case "all_served":
        return courseIds.length + 1;
      case "since_last_order":
        return courseIds.length + 2;
      case "after_step":
        return courseIds.length + 3;
    }
  };
  const result: ServiceStepDraft[] = [];
  const seen = new Set<string>();
  const visit = (step: ServiceStepDraft): void => {
    if (seen.has(step.key)) return;
    seen.add(step.key);
    result.push(step);
    for (const child of steps
      .filter((row) => row.afterStepKey === step.key)
      .sort((a, b) => Number(a.minutes) - Number(b.minutes)))
      visit(child);
  };
  for (const step of [...steps].sort(
    (a, b) => rootRank(a) - rootRank(b) || Number(a.minutes) - Number(b.minutes),
  ))
    visit(step);
  return result;
}
