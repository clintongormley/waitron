// Run only by `src/aws-rehearsal-interrupt.e2e.test.ts`, through `vitest.aws-rehearsal-interrupt.config.ts`:
// the interrupt scenario as a Vitest test, so the e2e can stop Vitest itself mid-scenario. Its name
// ends in neither `.test.ts` nor `.spec.ts`, so the package's other Vitest configs do not collect it.
import { appendFileSync } from "node:fs";
import { it } from "vitest";
import {
  DRIVER_DEADLINE_MS,
  DRIVER_SETTLE_MS,
  DRIVER_TEARDOWN_MS,
  INTERRUPT_APIS,
  interruptScenario,
} from "./aws-rehearsal-interrupt-driver.js";
import { withAwsRehearsal } from "./aws-rehearsal.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} must be set`);
  return value;
}

it(
  "runs the interrupt scenario until it is stopped",
  async () => {
    const facts = required("WAITRON_INTERRUPT_FACTS");
    await withAwsRehearsal(
      (ctx) => interruptScenario(ctx, "mid-scenario", (line) => appendFileSync(facts, `${line}\n`)),
      {
        endpoint: required("WAITRON_INTERRUPT_ENDPOINT"),
        receiptDir: required("WAITRON_INTERRUPT_RECEIPT_DIR"),
        apis: INTERRUPT_APIS,
        deadlineMs: DRIVER_DEADLINE_MS,
        settleMs: DRIVER_SETTLE_MS,
        teardownMs: DRIVER_TEARDOWN_MS,
      },
    );
  },
  2 * (DRIVER_DEADLINE_MS + DRIVER_SETTLE_MS + DRIVER_TEARDOWN_MS),
);
