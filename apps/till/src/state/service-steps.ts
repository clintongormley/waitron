import type { ServiceStepDue, TableSignal } from "@waitron/shared";
import { signalOf } from "./table-signals.js";

const stepsOf = (signals: readonly TableSignal[]): readonly ServiceStepDue[] =>
  signalOf(signals, "service_step")?.steps ?? [];

/** The step a table shows: the latest one already due, from a list sent soonest due first. */
export function currentStep(signals: readonly TableSignal[], now: number): ServiceStepDue | null {
  return (
    stepsOf(signals)
      .filter((step) => Date.parse(step.dueAt) <= now)
      .at(-1) ?? null
  );
}

/** When the next step falls due, or never. */
export function nextStepDueAt(signals: readonly TableSignal[], now: number): number {
  const next = stepsOf(signals).find((step) => Date.parse(step.dueAt) > now);
  return next === undefined ? Number.POSITIVE_INFINITY : Date.parse(next.dueAt);
}

export function stepWaitMinutes(step: ServiceStepDue, now: number): number | null {
  const minutes = Math.floor((now - Date.parse(step.dueAt)) / 60_000);
  return minutes >= 5 ? minutes : null;
}

export function nextStepChangeAt(signals: readonly TableSignal[], now: number): number {
  const nextDue = nextStepDueAt(signals, now);
  const step = currentStep(signals, now);
  if (step === null) return nextDue;
  const dueAt = Date.parse(step.dueAt);
  const nextMinute = (stepWaitMinutes(step, now) ?? 4) + 1;
  return Math.min(nextDue, dueAt + nextMinute * 60_000);
}
