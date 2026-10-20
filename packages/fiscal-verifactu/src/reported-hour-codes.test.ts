import { expect, it } from "vitest";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { compareHourClocks, type HourClockObservation } from "./hour-clock.js";
import {
  createHourSelection,
  publicHourSelectionHistory,
  type HourSelectionStore,
} from "./hour-selection.js";
import { projectHourHistory } from "./hour-history.js";

const binding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "recovery",
  sourceId: "old-backup",
  targetNodeId: "node1",
};
const scope = { taxpayerNif: "B12345674", environment: "production" as const };
function fixture() {
  let instant = Date.parse("2026-10-16T11:50:00Z");
  let value: unknown = null;
  const writes: unknown[] = [];
  const store: HourSelectionStore = async (_binding, run) =>
    run({
      value,
      history: writes,
      async replace(next) {
        value = structuredClone(next);
        writes.push(value);
      },
    });
  const create = () =>
    createHourSelection({
      withState: store,
      monotonicNow: () => 0,
      read: async () => ({
        scope,
        bases: [{ code: "A", purpose: "standard" }],
        contextKey: "authenticated-selected-source",
        history: [{ reference: "backup-without-latest-setup", complete: true, records: [] }],
        clock: compareHourClocks(
          ["box", "browser"].map(
            (source) =>
              ({
                source,
                result: "usable",
                instantMs: instant,
                uncertaintyMs: 0,
                wallStartedMs: instant,
                wallFinishedMs: instant,
                monotonicStartedMs: 0,
                monotonicFinishedMs: 0,
              }) as HourClockObservation,
          ),
          Date.parse("2026-10-15T00:00:00Z"),
        ),
      }),
    });
  return {
    writes,
    create,
    at: (at: string) => {
      instant = Date.parse(at);
    },
    select: (reportedIdentities: unknown, answer: "no" | "yes" = "no") =>
      withOperationAuthority(binding, "operator", (authority) =>
        create().select({ binding, authority, answer, reportedIdentities } as Parameters<
          ReturnType<typeof create>["select"]
        >[0]),
      ),
  };
}
const refused = (reason: string) => ({ code: "sif.allocation_invalid", params: { reason } });
it.each(["06RB", "06rb", "06RC"])(
  "refuses reported %s missing from backup history before exposing an identity",
  async (code) => {
    const f = fixture();
    await expect(f.select([code])).rejects.toMatchObject(refused("hour_not_later"));
    expect(f.writes).toEqual([]);
  },
);
it("retains the entered code with the selected event and in backup evidence", async () => {
  const f = fixture();
  f.at("2026-10-16T12:00:00Z");
  expect(await f.select(["06rb"])).toMatchObject({
    status: "selected",
    identity: "06RC",
    reportedIdentities: ["06RB"],
  });
  const history = projectHourHistory({ scope, sources: [publicHourSelectionHistory(f.writes)] });
  expect(history.greatestSpentHour).toBe(6924);
  expect(history.references.some((reference) => reference.includes("06RB"))).toBe(true);
  await withOperationAuthority(binding, "operator", async (authority) => {
    expect(await f.create().selected({ binding, authority })).toMatchObject({
      identity: "06RC",
      reportedIdentities: ["06RB"],
    });
  });
  await expect(f.select(["06RA"])).rejects.toMatchObject(refused("event_mismatch"));
  expect(f.writes).toHaveLength(1);
});
it("retains reported codes while waiting even before a fresh hour is selected", async () => {
  const f = fixture();
  f.at("2026-10-16T12:00:00Z");
  expect(await f.select(["06RB"], "yes")).toMatchObject({ status: "waiting" });
  const history = projectHourHistory({ scope, sources: [publicHourSelectionHistory(f.writes)] });
  expect(history.greatestSpentHour).toBe(6923);
  expect(history.contradictions).toEqual([]);
});
it.each(
  [null, [], [""], ["06R!"], ["A-06RB"], [123], Array(257).fill("06RB")].map((codes) => ({
    codes,
  })),
)("rejects malformed reported installation codes $codes", async ({ codes }) => {
  const f = fixture();
  await expect(f.select(codes)).rejects.toMatchObject(refused("installation_codes_invalid"));
  expect(f.writes).toEqual([]);
});
