import type { TableSignal } from "@waitron/shared";

/**
 * A table's one live step, due at `dueAt`. The default is a fixed past instant, so the step is due
 * whatever `now` a test file uses.
 */
export function dueStepSignal(name: string, dueAt = "2000-01-01T00:00:00.000Z"): TableSignal {
  return { kind: "service_step", steps: [{ stepId: `step-${name}`, name, dueAt }] };
}
