import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { getCountryPack } from "@waitron/country-packs";
import { stampDeployment } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { throwawayApplyInput } from "./throwaway-allocation.js";
import { applyVenue } from "./venue-apply.js";
import { planVenue, type VenueRequest } from "./venue-plan.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

function request(identity: { taxId: string; legalName: string }): VenueRequest {
  return {
    country: "ES",
    ...identity,
    location: {
      name: "Casa Real",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
    },
    seriesCode: "A",
    fullSeriesCode: "FF",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Admin",
      pinHash: "pin-hash",
      passwordHash: "password-hash",
      email: "admin@example.test",
    },
  };
}

const real = { taxId: "B12345674", legalName: "Real Restaurant S.L." };
const santet = { taxId: getCountryPack("ES")!.demo!.taxId, legalName: "SANTET DELI CO S.L." };
const fiscal = () => ALL_MODULES.find((module) => module.name === "fiscal-verifactu")!;

describe("throwawayApplyInput", () => {
  it("swaps only the seat's module's operations, in a copy of the module list", () => {
    const shipped = fiscal();
    const operations = shipped.operations;
    const result = throwawayApplyInput(planVenue(request(real), ALL_MODULES), ALL_MODULES, [
      "preproduction",
    ])!;

    expect(result.initialNodeId).toEqual(expect.any(String));
    expect(result.initialAdministratorId).toEqual(expect.any(String));
    expect([...result.moduleInputs.keys()]).toEqual(["fiscal-verifactu"]);
    expect(result.moduleInputs.get("fiscal-verifactu")).toEqual({
      eventId: expect.any(String),
      sourceId: "throwaway-preproduction",
      input: expect.anything(),
    });
    expect(result.modules).not.toBe(ALL_MODULES);
    expect(result.modules.map((module) => module.name)).toEqual(
      ALL_MODULES.map((module) => module.name),
    );
    result.modules.forEach((module, index) => {
      if (module.name === "fiscal-verifactu") {
        expect(module.operations).not.toBe(operations);
        expect({ ...module, operations: undefined }).toEqual({
          ...shipped,
          operations: undefined,
        });
      } else {
        expect(module).toBe(ALL_MODULES[index]);
      }
    });
    expect(fiscal()).toBe(shipped);
    expect(fiscal().operations).toBe(operations);
  });

  it("takes the taxpayer from ensure-tenant and the bases from create-series", () => {
    const result = throwawayApplyInput(planVenue(request(real), ALL_MODULES), ALL_MODULES, [
      "preproduction",
    ])!;
    const { allocation } = result.moduleInputs.get("fiscal-verifactu")!.input as {
      allocation: { taxpayerNif: string; series: { code: string; purpose: string }[] };
    };
    expect(allocation.taxpayerNif).toBe("B12345674");
    expect(allocation.series).toEqual([
      { code: "A-S000001", purpose: "standard" },
      { code: "FF-S000001", purpose: "full" },
      { code: "R-S000001", purpose: "rectificative" },
    ]);
  });

  it.each([real, santet])(
    "applies a preproduction venue with its own allocation: %j",
    async (identity) => {
      await stampDeployment(suite.db, "preproduction");
      const plan = planVenue(request(identity), ALL_MODULES);
      const venue = await applyVenue(plan, {
        db: suite.db,
        ...throwawayApplyInput(plan, ALL_MODULES, ["preproduction", "preproduction"])!,
      });

      expect(suite.db.all(sql`select numero_instalacion, node_id from registro_sif`)).toEqual([
        { numero_instalacion: "S000001", node_id: venue.nodeId },
      ]);
      expect(suite.db.all(sql`select taxpayer_nif, environment from fiscal_allocations`)).toEqual([
        { taxpayer_nif: identity.taxId, environment: "preproduction" },
      ]);
      expect(suite.db.all(sql`select code, purpose from invoice_series order by code`)).toEqual([
        { code: "A-S000001", purpose: "standard" },
        { code: "FF-S000001", purpose: "full" },
        { code: "R-S000001", purpose: "rectificative" },
      ]);
      expect(suite.db.all(sql`select tax_id, legal_name from tenants`)).toEqual([
        { tax_id: identity.taxId, legal_name: identity.legalName },
      ]);
    },
  );

  it("returns nothing when no enabled module offers the seat", () => {
    const withoutSeat = ALL_MODULES.filter((module) => module.name !== "fiscal-verifactu");
    expect(
      throwawayApplyInput(planVenue(request(real), ALL_MODULES), withoutSeat, ["preproduction"]),
    ).toBeUndefined();
  });

  it("refuses when more than one enabled module offers the seat", () => {
    const second = fakeModule("second-regime", {
      provisioning: { throwawayAllocation: fiscal().provisioning!.throwawayAllocation! },
    });
    expect(() =>
      throwawayApplyInput(
        planVenue(request(real), ALL_MODULES),
        [...ALL_MODULES, second],
        ["preproduction"],
      ),
    ).toThrow(
      expect.objectContaining({
        code: "module.throwaway_allocation_ambiguous",
        params: { candidates: ["fiscal-verifactu", "second-regime"] },
      }),
    );
  });

  it("passes the seat's production refusal through", () => {
    expect(() =>
      throwawayApplyInput(planVenue(request(real), ALL_MODULES), ALL_MODULES, [
        "preproduction",
        "production",
      ]),
    ).toThrow(
      expect.objectContaining({
        code: "sif.throwaway_allocation_refused",
        params: { environment: "production" },
      }),
    );
  });

  it("refuses a plan with no taxpayer as an invalid request", () => {
    const plan = planVenue(request(real), ALL_MODULES).filter(
      (action) => action.kind !== "ensure-tenant",
    );
    expect(() => throwawayApplyInput(plan, ALL_MODULES, ["preproduction"])).toThrow(
      expect.objectContaining({ code: "setup.request_invalid", params: { field: "taxId" } }),
    );
  });
});
