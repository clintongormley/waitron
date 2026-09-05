import { describe, expect, it } from "vitest";
import type { WaitronModule } from "@waitron/module";
import { isAppError } from "@waitron/shared";
import { obligadoTenantId } from "./tenant-id.js";
import { describeVenueAction, planVenue, type VenueRequest } from "./venue-plan.js";

// planVenue is generic over the module list now, so these tests build their own: a seedless module
// and a seeding one, which is all the planner reads.
function fakeModule(name: string, seed?: { summary: string }): WaitronModule {
  return {
    name,
    version: "0.0.0",
    tier: "toggleable",
    migrations: { name, table: `__drizzle_migrations_${name}`, from: `../${name}/drizzle` },
    ...(seed === undefined
      ? {}
      : { provisioning: { seed: { summary: seed.summary, run: async () => "done" } } }),
  };
}

const MODULES: readonly WaitronModule[] = [
  fakeModule("core"),
  fakeModule("probe", { summary: "seed the probe" }),
];

function request(overrides: Partial<VenueRequest> = {}): VenueRequest {
  return {
    country: "ES",
    taxId: "B12345678",
    legalName: "Deli SL",
    location: {
      name: "Mostrador",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "venta en establecimiento",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    },
    tillName: "Caja 1",
    seriesCode: "A",
    rectificativeSeriesCode: "R",
    admin: { displayName: "Owner", pinHash: "scrypt$00$00", passwordHash: "scrypt$aa$bb" },
    ...overrides,
  };
}

describe("planVenue", () => {
  it("emits ensure-tenant → seed-admin → seed-device-profiles → location → till → node → two series → module seeds, in order", () => {
    const actions = planVenue(request(), MODULES);
    expect(actions.map((a) => a.kind)).toEqual([
      "ensure-tenant",
      "seed-admin",
      "seed-device-profiles",
      "create-location",
      "create-till",
      "create-node",
      "create-series",
      "create-series",
      "seed-module",
    ]);
  });

  it("seeds the starter device-profile set right after the admin (the admin holds till.configure)", () => {
    // The profiles are authored under an admin management session (seed-admin runs first), so
    // seed-device-profiles is emitted immediately after seed-admin. Non-fiscal — it touches no
    // series/SIF/chain — so its position relative to create-till onward does not matter.
    const actions = planVenue(request(), MODULES);
    expect(actions[1]?.kind).toBe("seed-admin");
    expect(actions[2]?.kind).toBe("seed-device-profiles");
  });

  it("resolves the starter profiles' names from the venue's primary invoice locale (es → Spanish)", () => {
    const action = planVenue(request(), MODULES).find((a) => a.kind === "seed-device-profiles");
    // es-ES venue → the Spanish names, each carrying its form-factor default capabilities.
    expect(action).toEqual({
      kind: "seed-device-profiles",
      profiles: [
        { name: "Mostrador", capabilities: ["integrated-card-payment", "open-cash-drawer"] },
        { name: "Cocina", capabilities: ["act-as-kds"] },
        { name: "Móvil", capabilities: [] },
      ],
    });
  });

  it("resolves the starter profiles' names in English for an en venue", () => {
    const action = planVenue(
      request({ location: { ...request().location, invoiceLocales: ["en-GB"] } }),
      MODULES,
    ).find((a) => a.kind === "seed-device-profiles");
    expect(action?.kind === "seed-device-profiles" && action.profiles.map((p) => p.name)).toEqual([
      "Counter",
      "Kitchen",
      "Handheld",
    ]);
  });

  it("seeds the admin immediately after ensure-tenant, carrying the display name and pin hash", () => {
    // The admin needs only the tenant scope, so it is emitted right after ensure-tenant and before
    // the location. The pinHash flows straight through from the request — planVenue never sees a
    // plaintext PIN (it is hashed at the CLI boundary).
    const actions = planVenue(request(), MODULES);
    expect(actions[0]?.kind).toBe("ensure-tenant");
    expect(actions[1]).toEqual({
      kind: "seed-admin",
      displayName: "Owner",
      pinHash: "scrypt$00$00",
      passwordHash: "scrypt$aa$bb",
    });
  });

  it("derives the deterministic tenant id and stamps the resolved modules on the node", () => {
    const actions = planVenue(request(), MODULES);
    const tenant = actions.find((a) => a.kind === "ensure-tenant");
    const node = actions.find((a) => a.kind === "create-node");
    expect(tenant).toMatchObject({
      tenantId: obligadoTenantId("ES", "B12345678"),
      country: "ES",
      taxId: "B12345678",
    });
    expect(node).toMatchObject({ filingModule: "verifactu", taxModule: "iva" });
  });

  it("emits a standard series and a rectificative series with the requested codes", () => {
    const series = planVenue(request(), MODULES).filter((a) => a.kind === "create-series");
    expect(series).toEqual([
      { kind: "create-series", code: "A", purpose: "standard" },
      { kind: "create-series", code: "R", purpose: "rectificative" },
    ]);
  });

  it("REFUSES an unimplemented territory (spec D4 input half) before emitting anything", () => {
    try {
      planVenue(
        request({ location: { ...request().location, fiscalTerritory: "ES-PV-bizkaia" } }),
        MODULES,
      );
      expect.unreachable("should have refused");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("fiscal.regime_not_implemented");
    }
  });

  it("refuses fewer than one invoice locale, echoing the count", () => {
    try {
      planVenue(request({ location: { ...request().location, invoiceLocales: [] } }), MODULES);
      expect.unreachable("should have refused an empty locale list");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.code).toBe("provisioning.invalid_locales");
        expect(error.params).toEqual({ count: 0 });
      }
    }
  });

  it("refuses more than two invoice locales, echoing the count", () => {
    try {
      planVenue(
        request({ location: { ...request().location, invoiceLocales: ["a", "b", "c"] } }),
        MODULES,
      );
      expect.unreachable("should have refused three locales");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.code).toBe("provisioning.invalid_locales");
        expect(error.params).toEqual({ count: 3 });
      }
    }
  });

  it("REFUSES equal standard and rectificative series codes before emitting anything", () => {
    // Equal codes collide on the series natural key (tenant, node, code), so ON CONFLICT would
    // silently drop the second and leave the venue with ONE series and no way to issue corrections.
    // Rejected in the pure planner, like the other D4 input refusals.
    try {
      planVenue(request({ seriesCode: "A", rectificativeSeriesCode: "A" }), MODULES);
      expect.unreachable("should have refused equal series codes");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("provisioning.duplicate_series_code");
    }
  });

  it("REFUSES a fiscal_territory that does not belong to the tenant's country", () => {
    // country=PT + fiscalTerritory=ES-common is incoherent: ES-common is Spain/Veri*Factu and
    // applyVenue writes tax_id into registro_sif.nif (a Spanish-NIF field), so a non-ES country would
    // file under a non-NIF identity → mis-filing under the wrong country, unrecoverable in a
    // hash-chained record. Spec §8 assumes a location is in the tenant's country; refused in the pure
    // planner before any admin connection is spent, echoing both operator-typed values.
    try {
      planVenue(request({ country: "PT" }), MODULES);
      expect.unreachable("should have refused an ES territory under a PT country");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.code).toBe("provisioning.territory_country_mismatch");
        expect(error.params).toEqual({ country: "PT", fiscalTerritory: "ES-common" });
      }
    }
  });

  it("still fails an UNIMPLEMENTED territory before the country/territory check (most specific wins)", () => {
    // FR-common is BOTH unimplemented AND country-mismatched under PT. resolveFiscalModules runs
    // before the country check, so the more specific fiscal.regime_not_implemented wins — proving the
    // ordering, not territory_country_mismatch.
    try {
      planVenue(
        request({
          country: "PT",
          location: { ...request().location, fiscalTerritory: "FR-common" },
        }),
        MODULES,
      );
      expect.unreachable("should have refused an unimplemented territory");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("fiscal.regime_not_implemented");
    }
  });

  it("canonicalizes country/taxId case and leading/trailing whitespace so es/ES cannot mint two obligados (§5)", () => {
    // The wizard emits a trimmed-but-not-uppercased country ("es") and never touches taxId casing;
    // the CLI trims taxId but never uppercases it. Both paths go through planVenue, so canonicalizing
    // HERE — once, at the top, via `.trim().toUpperCase()` — makes the derived id AND the stored
    // (country, tax_id) unique-index row canonical for both. Without it, a re-run of the SAME business
    // differing only in case or surrounding whitespace mints a second, permanent, unmergeable obligado
    // (§5). (Internal whitespace is deliberately NOT normalized; see the tenant-id primitive's test.)
    // Proven by deletion: strip planVenue's normalization and the id-equality / stored-value
    // assertions below go red.
    const canonicalTenant = planVenue(request({ country: "ES", taxId: "B12345678" }), MODULES).find(
      (a) => a.kind === "ensure-tenant",
    );
    const messyTenant = planVenue(request({ country: "es", taxId: " b12345678 " }), MODULES).find(
      (a) => a.kind === "ensure-tenant",
    );
    // The stored unique-index row is canonical (so applyVenue's ON CONFLICT (country, tax_id) fires)...
    expect(messyTenant).toMatchObject({ kind: "ensure-tenant", country: "ES", taxId: "B12345678" });
    // ...and the derived id matches the already-canonical run's id.
    expect(messyTenant?.tenantId).toBe(canonicalTenant?.tenantId);
    expect(messyTenant?.tenantId).toBe(obligadoTenantId("ES", "B12345678"));
  });

  it("accepts a country in a different case than the territory prefix (ES matches es-common)", () => {
    // The check is case-insensitive on the country-prefixed convention, so a lowercase country still
    // matches its territory prefix. This never mints two obligados (planVenue canonicalizes country
    // before deriving the id and storing the row — see the casing test above), but planVenue must not
    // refuse the coherent combination on case alone.
    const actions = planVenue(
      request({ country: "es", location: { ...request().location, fiscalTerritory: "ES-common" } }),
      MODULES,
    );
    expect(actions.map((a) => a.kind)).toEqual([
      "ensure-tenant",
      "seed-admin",
      "seed-device-profiles",
      "create-location",
      "create-till",
      "create-node",
      "create-series",
      "create-series",
      "seed-module",
    ]);
  });

  it("emits one seed-module per module declaring a seed, last, in list order, carrying its summary", () => {
    const seeds = planVenue(request(), [
      fakeModule("b", { summary: "seed b" }),
      fakeModule("core"),
      fakeModule("a", { summary: "seed a" }),
    ]).filter((a) => a.kind === "seed-module");
    expect(seeds).toEqual([
      { kind: "seed-module", module: "b", summary: "seed b" },
      { kind: "seed-module", module: "a", summary: "seed a" },
    ]);
  });

  it("emits no seed-module for a list with no seeds", () => {
    expect(planVenue(request(), [fakeModule("core")]).some((a) => a.kind === "seed-module")).toBe(
      false,
    );
  });
});

describe("describeVenueAction", () => {
  it("describes a seed-module action by module and summary", () => {
    expect(
      describeVenueAction({ kind: "seed-module", module: "probe", summary: "seed the probe" }),
    ).toBe("seed module probe: seed the probe");
  });

  it("renders each planned action as a line an operator can check", () => {
    const lines = planVenue(request(), MODULES).map((action) => describeVenueAction(action));
    expect(lines).toEqual([
      "ensure tenant ES/B12345678 (Deli SL)",
      "seed admin Owner",
      "seed device profiles Mostrador, Cocina, Móvil",
      "create location Mostrador in ES-common (es-ES)",
      "create till Caja 1",
      "create node Mostrador filing=verifactu tax=iva",
      "create standard series A",
      "create rectificative series R",
      "seed module probe: seed the probe",
    ]);
  });

  it("names the admin but NEVER the pin hash — the description is operator-facing", () => {
    // The pin_hash is a secret: it must not reach a plan summary an operator sees. Uses a distinctive
    // hash so the negative assertion cannot pass by coincidence.
    const line = describeVenueAction({
      kind: "seed-admin",
      displayName: "Alicia",
      pinHash: "scrypt$deadbeef$cafef00d",
      passwordHash: "scrypt$feedface$0ddba11",
    });
    expect(line).toBe("seed admin Alicia");
    expect(line).not.toContain("scrypt");
    expect(line).not.toContain("deadbeef");
    expect(line).not.toContain("cafef00d");
    expect(line).not.toContain("feedface");
    expect(line).not.toContain("0ddba11");
  });
});
