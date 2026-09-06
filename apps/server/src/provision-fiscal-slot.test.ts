import { describe, expect, it, vi } from "vitest";
import type { FiscalBackend, FiscalContribution } from "@waitron/fiscal";
import type { WaitronModule } from "@waitron/module";
import { isAppError } from "@waitron/shared";

// A minimal fiscal-slot contribution: the slot check reads only that the seat is present and
// selects among the enabled members. The backend/drain seats are never invoked — the slot check
// throws before any DB write, so this suite needs no Postgres.
const contribution = (id: string): FiscalContribution => ({
  id,
  makeBackend: () => ({ id }) as unknown as FiscalBackend,
  drain: () => Promise.reject(new Error("slot-selection tests never run the drain seat")),
});

const mod = (
  name: string,
  tier: WaitronModule["tier"],
  seats: Partial<Pick<WaitronModule, "fiscal">> = {},
): WaitronModule => ({
  name,
  version: "0.0.0",
  tier,
  migrations: { name, table: `__drizzle_migrations_${name}`, from: `../${name}/drizzle` },
  ...seats,
});

// A SYNTHETIC composition list carrying TWO fiscal-slot members — the shape ALL_MODULES takes once
// fiscal-none joins the slot (Task 9) — plus a provision-only module with NO fiscal seat, which the
// provision-only gate (not the slot) still governs. Mocked so provisionVenue's slot wiring can be
// proven against two members before that landing, and the gate proven for a non-slot member — the
// real ALL_MODULES has only one fiscal member and no non-fiscal provision-only module.
vi.mock("./modules.js", () => ({
  ALL_MODULES: [
    mod("core", "mandatory"),
    mod("fiscal-verifactu", "provision-only", { fiscal: contribution("verifactu") }),
    mod("fiscal-none", "provision-only", { fiscal: contribution("none") }),
    mod("legacy-provision", "provision-only"),
  ],
}));

// Import AFTER the mock is registered so provisionVenue binds the synthetic list.
const { provisionVenue } = await import("./provision.js");
const { parseModuleConfig } = await import("@waitron/module");
const { ALL_MODULES } = await import("./modules.js");

/** An ownerDb Proxy that throws on ANY property access — the slot check must refuse before the DB is
 * ever reached, so touching it is the failure. */
const untouchableDb = new Proxy(
  {},
  {
    get() {
      throw new Error("ownerDb must not be touched");
    },
  },
) as never;

function venueRequest() {
  return {
    country: "ES",
    taxId: "00000001K",
    legalName: "Deli Test SL",
    location: {
      name: "Sala principal",
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
    tillName: "Caja 1",
    seriesCode: "A",
    rectificativeSeriesCode: "R",
    admin: { displayName: "Administradora", pinHash: "x", passwordHash: "y" },
  };
}

describe("provisionVenue fiscal-slot resolution (synthetic two-member slot)", () => {
  it("refuses with fiscal_slot_ambiguous when BOTH fiscal-slot members are enabled — before any DB write", async () => {
    // Both members enabled (the default sparse map) → two candidates fill the slot → ambiguous.
    const moduleConfig = parseModuleConfig({}, ALL_MODULES);
    const err = await provisionVenue(
      { ownerDb: untouchableDb, moduleConfig, stateDir: "/unused" },
      { environment: "preproduction", venue: venueRequest() as never },
    ).catch((e: unknown) => e);
    expect(isAppError(err)).toBe(true);
    expect(isAppError(err) && err.code).toBe("module.fiscal_slot_ambiguous");
  });

  it("passes the slot check when exactly one fiscal-slot member is enabled (reaches the DB, then throws there)", async () => {
    // Disabling fiscal-none leaves exactly one member → the slot resolves and the flow proceeds past
    // the slot check to planVenue and the DB, where the untouchable Proxy throws. A NON-slot error
    // (not fiscal_slot_*) is the proof the slot check let exactly-one through.
    const moduleConfig = parseModuleConfig({ modules: { "fiscal-none": false } }, ALL_MODULES);
    const err = await provisionVenue(
      { ownerDb: untouchableDb, moduleConfig, stateDir: "/unused" },
      { environment: "preproduction", venue: venueRequest() as never },
    ).catch((e: unknown) => e);
    // planVenue is pure (no DB) and validates first; either it accepts and the DB Proxy throws, or it
    // rejects the fixture. Either way the code must NOT be a fiscal-slot refusal.
    const code = isAppError(err) ? err.code : String(err);
    expect(code.startsWith("module.fiscal_slot_")).toBe(false);
  });

  it("refuses with provision_only_disabled when a NON-slot provision-only module is disabled — the gate, not the slot", async () => {
    // Disabling a provision-only module with no fiscal seat trips the provision-only gate (step 0),
    // which runs BEFORE the slot check, so the refusal is `module.provision_only_disabled` and the DB
    // is never touched. This is the gate the fiscal slot does NOT subsume.
    const moduleConfig = parseModuleConfig({ modules: { "legacy-provision": false } }, ALL_MODULES);
    const err = await provisionVenue(
      { ownerDb: untouchableDb, moduleConfig, stateDir: "/unused" },
      { environment: "preproduction", venue: venueRequest() as never },
    ).catch((e: unknown) => e);
    expect(isAppError(err)).toBe(true);
    expect(isAppError(err) && err.code).toBe("module.provision_only_disabled");
  });
});
