import type { DestinationDutyDeps } from "../handover-destination-duty.js";
import { waitHandover } from "../handover-store.js";

/**
 * Stops a destination duty at its first accepted compare, holding the file, for a test of a step
 * before accepting. The throw is what leaves the file held, and the stopped clock is what keeps it
 * from being compared again however short the test's `compareRetryMs`.
 */
export function stopShortOfAccepting(): Pick<DestinationDutyDeps, "accept" | "monotonicNow"> {
  let stopped = false;
  return {
    accept: async (deps, operation) => {
      if (operation.waitingReason !== null) {
        await waitHandover(deps, operation.operationId, null);
      }
      stopped = true;
      throw new Error("a test stopped short of accepting");
    },
    monotonicNow: () => (stopped ? Number.NEGATIVE_INFINITY : performance.now()),
  };
}
