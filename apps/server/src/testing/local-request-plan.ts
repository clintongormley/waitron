import type { SCENARIO_APIS } from "./aws-request-plan.js";
import { createRequestPlan } from "./aws-request-plan.js";
import { installSendGate, openRequestScope } from "./aws-send-gate.js";

export interface LocalPlan {
  bucket: string;
  apis: readonly (typeof SCENARIO_APIS)[number][];
  prefixes: readonly string[];
}

/**
 * Runs a scenario's local version under the plan its Amazon S3 rehearsal declares, so a request the
 * rehearsal would refuse fails here too. Servers the body starts carry the scope into their timers.
 * Requests outside the body pass, because the gate is not strict here. A suite that calls this
 * uninstalls the gate in its `afterAll`.
 */
export async function runUnderPlan<T>(plan: LocalPlan, body: () => Promise<T>): Promise<T> {
  installSendGate();
  const prefixes = new Set(plan.prefixes);
  const scope = openRequestScope({
    plan: createRequestPlan({ bucket: plan.bucket, apis: plan.apis, prefixes: () => prefixes }),
    mode: "enforce",
  });
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await scope.run(body) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  const { count, first } = scope.refusals();
  scope.close();
  if (count > 0) {
    throw new Error(`${count} unplanned request(s) refused before sending; the first: ${first}`, {
      cause: outcome.ok ? undefined : outcome.error,
    });
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
