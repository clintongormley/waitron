import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId } from "@waitron/shared";
import type { IssueScope } from "@waitron/fiscal";
import { TradingAdmission, requireEconomicWrite } from "./trading-admission.js";

describe("trading admission", () => {
  it("starts closed and only admits after an explicit boot decision", () => {
    const admission = new TradingAdmission();
    expect(admission.snapshot()).toEqual({ state: "unchecked" });
    expect(() => admission.require()).toThrowError(
      expect.objectContaining({
        code: "venue.time_zone_not_ready",
        params: { reason: "unchecked" },
      }),
    );
    admission.admit();
    expect(admission.snapshot()).toEqual({ state: "ready" });
    expect(() => admission.require()).not.toThrow();
  });
  it.each(["missing", "invalid", "restart_required"] as const)(
    "refuses economic work while %s",
    (reason) => {
      const admission = new TradingAdmission();
      admission.admit();
      if (reason === "restart_required") admission.requireRestart();
      else admission.repairOnly(reason);
      expect(admission.snapshot()).toEqual({ state: reason });
      expect(() => admission.require()).toThrowError(
        expect.objectContaining({ code: "venue.time_zone_not_ready", params: { reason } }),
      );
    },
  );
  it("does not let callers change admission by mutating a snapshot", () => {
    const admission = new TradingAdmission();
    const view = admission.snapshot();
    Object.assign(view, { state: "ready" });
    expect(() => admission.require()).toThrowError(
      expect.objectContaining({ params: { reason: "unchecked" } }),
    );
  });
});

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let scope: IssueScope;
beforeEach(async () => {
  await seedTenant(suite.db);
  const [row] = await suite.db
    .insert(locations)
    .values({
      name: "Test venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Restaurant service",
      timeZone: "Europe/Madrid",
    })
    .returning();
  scope = { nodeId: await seedNode(suite.db, locationId(row!.id)), locationId: row!.id };
});
describe("economic transaction admission", () => {
  it.each(["unchecked", "missing", "invalid", "restart_required"] as const)(
    "prevents a direct write while %s",
    async (reason) => {
      const admission = new TradingAdmission();
      if (reason === "missing" || reason === "invalid") admission.repairOnly(reason);
      if (reason === "restart_required") admission.requireRestart();
      const write = vi.fn();
      await expect(
        withTransaction(suite.db, async (tx) => {
          await requireEconomicWrite(tx, scope, admission);
          write();
          await tx
            .update(locations)
            .set({ name: "Changed" })
            .where(eq(locations.id, scope.locationId!));
        }),
      ).rejects.toMatchObject({ code: "venue.time_zone_not_ready", params: { reason } });
      expect(write).not.toHaveBeenCalled();
      expect((await suite.db.select().from(locations))[0]!.name).toBe("Test venue");
    },
  );
  it.each([
    ["", "missing"],
    ["Invalid/Zone", "invalid"],
  ])("rechecks saved %j even after admission", async (timeZone, reason) => {
    const admission = new TradingAdmission();
    admission.admit();
    await suite.db.update(locations).set({ timeZone }).where(eq(locations.id, scope.locationId!));
    const write = vi.fn();
    await expect(
      withTransaction(suite.db, async (tx) => {
        await requireEconomicWrite(tx, scope, admission);
        write();
      }),
    ).rejects.toMatchObject({ code: "venue.time_zone_invalid", params: { reason } });
    expect(write).not.toHaveBeenCalled();
  });
  it("allows an admitted transaction with a valid saved zone", async () => {
    const admission = new TradingAdmission();
    admission.admit();
    await withTransaction(suite.db, async (tx) => {
      await requireEconomicWrite(tx, scope, admission);
      await tx
        .update(locations)
        .set({ name: "Changed" })
        .where(eq(locations.id, scope.locationId!));
    });
    expect((await suite.db.select().from(locations))[0]!.name).toBe("Changed");
  });
});
