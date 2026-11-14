import { randomUUID } from "node:crypto";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { withOperationAuthority } from "@waitron/module";
import {
  applyVenue as applyMinuteVenue,
  mergeModulePreparationRevisions,
} from "@waitron/provisioning";
import { createHourTestClock, selectPastWaits } from "./hour-test-clock.js";

/**
 * A venue applied with its first Veri*Factu setup chosen by the real minute selection, on a clock
 * ten minutes behind, its selection kept in `stateDir` as a real first setup keeps it.
 */
export function applyWithFirstSetup(stateDir: string): typeof applyMinuteVenue {
  return async (actions, deps) => {
    // Leave room for selection's minute wait before the real-time sales.
    const clock = createHourTestClock(Date.now() - 10 * 60_000);
    const taxpayer = actions.find((action) => action.kind === "ensure-tenant")!;
    const initialNodeId = randomUUID();
    const initialAdministratorId = randomUUID();
    const binding = {
      module: "fiscal-verifactu",
      action: "setup",
      eventId: randomUUID(),
      sourceId: randomUUID(),
      targetNodeId: initialNodeId,
    } as const;
    let kept: unknown = null;
    const preparation = createHourPreparation({
      monotonicNow: () => clock.monotonic(),
      withState: async (_binding, run) =>
        run({
          get value() {
            return structuredClone(kept);
          },
          history: [],
          async replace(next) {
            kept = structuredClone(next);
          },
        }),
      read: async () => ({
        scope: { taxpayerNif: taxpayer.taxId, environment: "preproduction" },
        bases: actions
          .filter((action) => action.kind === "create-series")
          .map(({ code, purpose }) => ({ code, purpose })),
        contextKey: "first",
        history: [{ reference: "empty", complete: true, records: [] }],
        clock: compareHourClocks(
          ["box", "browser"].map((source) => ({
            source: source as "box" | "browser",
            result: "usable",
            instantMs: clock.wall(),
            uncertaintyMs: 0,
            wallStartedMs: clock.wall(),
            wallFinishedMs: clock.wall(),
            monotonicStartedMs: clock.monotonic(),
            monotonicFinishedMs: clock.monotonic(),
          })),
          Date.parse("2026-10-15T00:00:00Z"),
        ),
      }),
    });
    const held = await selectPastWaits(clock, () =>
      withOperationAuthority(binding, initialAdministratorId, (authority) =>
        preparation.select({ binding, authority, comparisonId: "comparison" }),
      ),
    );
    if (held.status !== "selected") throw new Error(`first setup answered ${held.status}`);
    const result = await applyMinuteVenue(actions, {
      ...deps,
      initialNodeId,
      initialAdministratorId,
      moduleInputs: new Map([
        [
          "fiscal-verifactu",
          { eventId: binding.eventId, sourceId: binding.sourceId, input: held.input },
        ],
      ]),
      modules: deps.modules.map((module) =>
        module.name === "fiscal-verifactu" ? { ...module, operations: preparation } : module,
      ),
    });
    await mergeModulePreparationRevisions({ stateDir }, [{ binding, value: kept }]);
    return result;
  };
}
