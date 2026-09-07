import { describe, expect, it } from "vitest";
import type { FiscalContribution } from "./contribution.js";

describe("FiscalContribution.drain contract", () => {
  it("a contribution can expose an empty drain pass", async () => {
    const c: Pick<FiscalContribution, "id" | "drain"> = {
      id: "test",
      drain: async () => ({
        nextDueAt: null,
        tenantsWithWork: 0,
        batchesSent: 0,
        recordsSubmitted: 0,
        recordsAccepted: 0,
        recordsHalted: 0,
        incidentsRaised: 0,
        skipped: [],
      }),
    };
    expect(await c.drain({} as never, new Date())).toMatchObject({ nextDueAt: null });
  });
});
