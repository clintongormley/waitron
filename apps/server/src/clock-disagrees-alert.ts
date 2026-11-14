import { judgeClockWitnesses } from "@waitron/fiscal";
import type { AlertSource } from "@waitron/module";
import type { ClockWitnessStore } from "./clock-witnesses.js";

export function clockDisagreesAlertSource(
  store: Pick<ClockWitnessStore, "witnesses">,
  readPeer?: () => Promise<{ boxAt: string; peerAt: string } | null>,
): AlertSource {
  return {
    area: "box",
    permission: "system.manage",
    async read({ now }) {
      const witnesses = store.witnesses();
      const group = judgeClockWitnesses(witnesses).devicesDisagreeing;
      if (group.length === 0) {
        const peer = await readPeer?.();
        const comparisons = [
          ...witnesses.map((w) => ({ boxAt: w.boxAt, otherAt: w.witnessAt, peer: false })),
          ...(peer == null ? [] : [{ boxAt: peer.boxAt, otherAt: peer.peerAt, peer: true }]),
        ].map((c) => ({
          ...c,
          differenceMs: Math.abs(Date.parse(c.otherAt) - Date.parse(c.boxAt)),
        }));
        const worst = comparisons
          .filter((c) => c.differenceMs > 15000)
          .sort((a, b) => b.differenceMs - a.differenceMs)[0];
        return worst === undefined
          ? []
          : [
              {
                key: "clock.peer_disagrees",
                code: "clock.peer_disagrees",
                severity: "warning",
                since: null,
                screen: "box-status",
                params: { peer: worst.peer, differenceMs: worst.differenceMs },
              },
            ];
      }
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
