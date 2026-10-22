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
