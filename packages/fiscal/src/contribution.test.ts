import { describe, expect, expectTypeOf, it } from "vitest";
import type { FiscalContribution, FiscalOutboxSeat, FiscalOutboxState } from "./contribution.js";

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

describe("FiscalContribution.certificate contract", () => {
  it("a contribution can leave the certificate seat out", () => {
    const c: Pick<FiscalContribution, "id" | "certificate"> = {
      id: "test",
      certificate: undefined,
    };
    expect(c.certificate).toBeUndefined();
  });
});

describe("FiscalContribution.outbox contract", () => {
  it("the outbox seat is optional and its read answers the outbox state", () => {
    expectTypeOf<FiscalContribution["outbox"]>().toEqualTypeOf<FiscalOutboxSeat | undefined>();
    expectTypeOf<
      Awaited<ReturnType<FiscalOutboxSeat["read"]>>
    >().toEqualTypeOf<FiscalOutboxState>();
  });
});
