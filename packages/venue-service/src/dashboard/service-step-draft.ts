import type { ServiceStepStart } from "../schema/service-steps.js";
import type { ServiceStep, ServiceStepInput } from "../service-steps.js";

/** `minutes` is text so a blank or a fraction can be shown and refused; `key` is the saved id, or
 * one made when the row is added. */
export interface ServiceStepDraft {
  key: string;
  id: string | null;
  name: string;
  start: ServiceStepStart;
  courseId: string | null;
  minutes: string;
}

export const toStepDrafts = (rows: readonly ServiceStep[]): ServiceStepDraft[] =>
  rows.map((row) => ({
    key: row.id,
    id: row.id,
    name: row.name,
    start: row.start,
    courseId: row.courseId,
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
      sameMinutes(step.minutes, b[index]!.minutes),
  );

export const toStepInputs = (drafts: readonly ServiceStepDraft[]): ServiceStepInput[] =>
  drafts.map((draft) => ({
    ...(draft.id === null ? {} : { id: draft.id }),
    name: draft.name.trim(),
    start: draft.start,
    courseId: draft.courseId,
    minutes: Number(draft.minutes.trim()),
  }));
