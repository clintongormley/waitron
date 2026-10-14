import type { SCENARIO_APIS } from "./aws-request-plan.js";
import { createRequestPlan } from "./aws-request-plan.js";
import { installSendGate, openRequestScope, uninstallSendGate } from "./aws-send-gate.js";

export interface LocalPlan {
  bucket: string;
  apis: readonly (typeof SCENARIO_APIS)[number][];
  prefixes: readonly string[];
}

const lateRefusals: string[] = [];

/**
 * Uninstalls the gate, then throws if a request sent from inside a `runUnderPlan` scope after its
 * body ended was refused: no `runUnderPlan` call is left to report it.
 */
export function endLocalPlans(): void {
  uninstallSendGate();
  const late = lateRefusals.splice(0);
  if (late.length > 0) {
    throw new Error(
      `${late.length} request(s) refused after their run had ended; the first: ${late[0]}`,
    );
  }
}

/**
 * Runs a scenario's local version under the plan its Amazon S3 rehearsal declares, so a request the
 * rehearsal would refuse fails here too. Servers the body starts carry the scope into their timers.
 * Requests outside the body pass, because the gate is not strict here. A suite that calls this
 * calls `endLocalPlans` in its `afterAll`.
 */
export async function runUnderPlan<T>(plan: LocalPlan, body: () => Promise<T>): Promise<T> {
  installSendGate();
  const prefixes = new Set(plan.prefixes);
  let ended = false;
  const scope = openRequestScope({
    plan: createRequestPlan({ bucket: plan.bucket, apis: plan.apis, prefixes: () => prefixes }),
    mode: "enforce",
    hosts: "any",
    onRefused: (detail) => {
      if (ended) lateRefusals.push(detail);
    },
  });
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await scope.run(body) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  const { count, first } = scope.refusals();
  scope.close();
  ended = true;
  if (count > 0) {
    throw new Error(`${count} unplanned request(s) refused before sending; the first: ${first}`, {
      cause: outcome.ok ? undefined : outcome.error,
    });
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
