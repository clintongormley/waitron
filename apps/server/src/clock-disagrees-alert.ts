import { judgeClockWitnesses } from "@waitron/fiscal";
import type { AlertSource } from "@waitron/module";
import type { ClockWitnessStore } from "./clock-witnesses.js";

/** Raised whenever two or more fresh devices agree with each other that the box's clock is more
 * than a minute off, whether or not payments are stopped. */
export function clockDisagreesAlertSource(
  store: Pick<ClockWitnessStore, "witnesses">,
): AlertSource {
  return {
    area: "box",
    permission: "system.manage",
    async read({ now }) {
      const group = judgeClockWitnesses(store.witnesses()).devicesDisagreeing;
      if (group.length === 0) return [];
      const meanDifferenceMs =
        group.reduce(
          (sum, witness) => sum + Date.parse(witness.witnessAt) - Date.parse(witness.boxAt),
          0,
        ) / group.length;
      return [
        {
          key: "clock.disagrees",
          code: "clock.disagrees",
          severity: "warning",
          since: null,
          screen: "box-status",
          params: {
            count: group.length,
            deviceAt: new Date(now.getTime() + Math.round(meanDifferenceMs)).toISOString(),
            boxAt: now.toISOString(),
          },
        },
      ];
    },
  };
}
