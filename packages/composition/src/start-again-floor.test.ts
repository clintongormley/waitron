import { expect, it } from "vitest";
import { initialSetupFor } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";

it("the fiscal module's start-again floor is reachable through the installed module list", () => {
  const seat = initialSetupFor(ALL_MODULES, "fiscal-verifactu");
  expect(
    seat?.startAgainFloor?.({
      attempts: [],
      preparations: [],
      publicEvidence: [
        {
          format: "waitron-hour-history",
          scope: { taxpayerNif: "89890001K", environment: "preproduction" },
          sources: [
            {
              reference: "retired",
              complete: true,
              records: [
                {
                  taxpayerNif: "89890001K",
                  environment: "preproduction",
                  reference: "row/retired",
                  kind: "intent",
                  softwareId: "W1",
                  nodeId: "node",
                  identity: "0CNQT",
                  recordedAtMs: null,
                },
              ],
            },
          ],
        },
      ],
    }),
  ).toEqual({ floorMs: Date.parse("2026-10-16T12:43:00.000Z"), lastName: "0CNQT" });
});
