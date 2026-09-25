import { describe, expect, it, vi } from "vitest";
import type { FiscalBackend, FiscalContribution } from "@waitron/fiscal";
import type { WaitronModule } from "@waitron/module";
import { isAppError } from "@waitron/shared";

// The slot check reads only that the seat is present, so the backend and drain seats are never run.
const contribution = (id: string): FiscalContribution => ({
  id,
  activationReadiness: "not-applicable",
  makeBackend: () => ({ id }) as unknown as FiscalBackend,
  drain: () => Promise.reject(new Error("slot-selection tests never run the drain seat")),
  resetInFlight: () => Promise.reject(new Error("slot-selection tests never run the reset seat")),
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

// The real ALL_MODULES has no provision-only module without a fiscal seat, so this synthetic list
// adds one for the provision-only gate.
vi.mock("./modules.js", () => ({
  ALL_MODULES: [
    mod("core", "mandatory"),
    mod("fiscal-verifactu", "provision-only", { fiscal: contribution("verifactu") }),
    mod("fiscal-none", "provision-only", { fiscal: contribution("none") }),
    mod("legacy-provision", "provision-only"),
  ],
}));

const { provisionVenue } = await import("./provision.js");
const { parseModuleConfig } = await import("@waitron/module");
const { ALL_MODULES } = await import("./modules.js");

/** Throws on any access: every refusal here must happen before the database is reached. */
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
    admin: {
      displayName: "Administradora",
      pinHash: "x",
      passwordHash: "y",
      email: "owner@example.test",
    },
    email: "owner@example.test",
  };
}

describe("provisionVenue fiscal-slot resolution (synthetic two-member slot)", () => {
  it("refuses with fiscal_slot_ambiguous when BOTH fiscal-slot members are enabled — before any DB write", async () => {
    const moduleConfig = parseModuleConfig({}, ALL_MODULES);
    const err = await provisionVenue(
      { ownerDb: untouchableDb, moduleConfig, database: "waitron", stateDir: "/unused" },
      { environment: "preproduction", venue: venueRequest() as never },
    ).catch((e: unknown) => e);
    expect(isAppError(err)).toBe(true);
    expect(isAppError(err) && err.code).toBe("module.fiscal_slot_ambiguous");
  });

  it("passes the slot check when exactly one fiscal-slot member is enabled (reaches the DB, then throws there)", async () => {
    const moduleConfig = parseModuleConfig({ modules: { "fiscal-none": false } }, ALL_MODULES);
    const err = await provisionVenue(
      { ownerDb: untouchableDb, moduleConfig, database: "waitron", stateDir: "/unused" },
      { environment: "preproduction", venue: venueRequest() as never },
    ).catch((e: unknown) => e);
    // planVenue may reject the fixture or the Proxy may throw; either way it is not a slot refusal.
    const code = isAppError(err) ? err.code : String(err);
    expect(code.startsWith("module.fiscal_slot_")).toBe(false);
  });

  it("refuses with provision_only_disabled when a NON-slot provision-only module is disabled — the gate, not the slot", async () => {
    const moduleConfig = parseModuleConfig({ modules: { "legacy-provision": false } }, ALL_MODULES);
    const err = await provisionVenue(
      { ownerDb: untouchableDb, moduleConfig, database: "waitron", stateDir: "/unused" },
      { environment: "preproduction", venue: venueRequest() as never },
    ).catch((e: unknown) => e);
    expect(isAppError(err)).toBe(true);
    expect(isAppError(err) && err.code).toBe("module.provision_only_disabled");
  });
});
