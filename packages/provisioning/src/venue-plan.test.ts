import { describe, expect, it } from "vitest";
import type { WaitronModule } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { isAppError } from "@waitron/shared";
import { describeVenueAction, planVenue, type VenueRequest } from "./venue-plan.js";

// planVenue is generic over the module list now, so these tests build their own: a seedless module
// and a seeding one, which is all the planner reads.
const MODULES: readonly WaitronModule[] = [
  fakeModule("core"),
  fakeModule("probe", {
    provisioning: { seed: { summary: "seed the probe", run: async () => "done" } },
  }),
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
    admin: {
      displayName: "Owner",
      pinHash: "scrypt$00$00",
      passwordHash: "scrypt$aa$bb",
      email: "owner@example.test",
    },
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
    // es-ES venue → the Spanish names, each carrying its form factor and form-factor default
    // capabilities.
    expect(action).toEqual({
      kind: "seed-device-profiles",
      profiles: [
        {
          name: "Mostrador",
          formFactor: "till",
          capabilities: ["integrated-card-payment", "open-cash-drawer", "print-receipt"],
          inactivityTimeoutSeconds: 300,
        },
        {
          name: "Cocina",
          formFactor: "kds",
          capabilities: ["act-as-kds"],
          inactivityTimeoutSeconds: null,
        },
        {
          name: "Móvil",
          formFactor: "phone-portrait",
          capabilities: [],
          inactivityTimeoutSeconds: 300,
        },
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
      firstNames: null,
      lastNames: null,
      locale: null,
      pinHash: "scrypt$00$00",
      passwordHash: "scrypt$aa$bb",
      email: "owner@example.test",
    });
  });

  it("carries the admin's real names into the seed-admin action", () => {
    const actions = planVenue(
      request({
        admin: {
          displayName: "Clint",
          firstNames: "Clinton",
          lastNames: "Gormley",
          pinHash: "pin-hash",
          passwordHash: "password-hash",
          email: "clinton@example.com",
        },
      }),
      MODULES,
    );
    expect(actions.find((a) => a.kind === "seed-admin")).toMatchObject({
      displayName: "Clint",
      firstNames: "Clinton",
      lastNames: "Gormley",
    });
  });

  it("carries the admin's UI language into the seed-admin action, and plans an absent one as null", () => {
    // The applier writes the column unconditionally, so the action always carries it; `null` is what
    // `persons.locale`'s `is null or length > 0` check accepts for "this person has no preference",
    // which makes the apps fall back to the venue default.
    const withLocale = planVenue(
      request({
        admin: {
          displayName: "Clint",
          locale: "en-GB",
          pinHash: "pin-hash",
          passwordHash: "password-hash",
          email: "clinton@example.com",
        },
      }),
      MODULES,
    );
    expect(withLocale.find((a) => a.kind === "seed-admin")).toMatchObject({ locale: "en-GB" });
    expect(planVenue(request(), MODULES).find((a) => a.kind === "seed-admin")).toMatchObject({
      locale: null,
    });
  });

  it("REFUSES a UI language the apps cannot render rather than storing it", () => {
    // `persons.locale` is a plain text column whose only constraint is non-empty, so an unrenderable
    // code would be stored happily and then show the operator a screen of missing strings. The
    // person's own write boundary (`setPersonLocale`) refuses one; the planner refuses it here so
    // provisioning is not the one path that can write it, and so the refusal costs no connection.
    try {
      planVenue(
        request({
          admin: {
            displayName: "Clint",
            locale: "fr-FR",
            pinHash: "pin-hash",
            passwordHash: "password-hash",
            email: "clinton@example.com",
          },
        }),
        MODULES,
      );
      expect.unreachable("should have refused an unsupported UI language");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("locale.unsupported");
    }
  });

  it("plans an admin with no real names as null rather than dropping the field", () => {
    // The applier writes both columns unconditionally, so the action always carries them; `null` is
    // what the column's `is null or length > 0` check accepts for "not given".
    const actions = planVenue(request(), MODULES);
    expect(actions.find((a) => a.kind === "seed-admin")).toMatchObject({
      firstNames: null,
      lastNames: null,
    });
  });

  it("carries the canonical fiscal identity and stamps the resolved modules on the node", () => {
    const actions = planVenue(request(), MODULES);
    const tenant = actions.find((a) => a.kind === "ensure-tenant");
    const node = actions.find((a) => a.kind === "create-node");
    expect(tenant).toMatchObject({ country: "ES", taxId: "B12345678" });
    expect(node).toMatchObject({ filingModule: "verifactu", taxModule: "vat" });
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
        request({ location: { ...request().location, fiscalTerritory: "ES-canary" } }),
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

  it("canonicalizes country/taxId case and leading/trailing whitespace so es/ES reads as the SAME taxpayer (§5)", () => {
    // The setup API currently emits the pack's canonical country and normalized tax ID, while the CLI
    // accepts operator-entered casing and surrounding space. Both paths go through planVenue, so canonicalizing
    // HERE — once, at the top, via `.trim().toUpperCase()` — makes the stored
    // `tenants (country, tax_id)` row canonical for both. Without it, a re-run of the SAME business
    // differing only in case or surrounding whitespace reads as a DIFFERENT taxpayer and is refused
    // (`provisioning.tenant_identity_mismatch`) instead of being the no-op it should be (§5).
    // Internal whitespace is deliberately NOT normalized.
    // Proven by deletion: strip planVenue's normalization and the stored-value assertions below go
    // red.
    const canonicalTenant = planVenue(request({ country: "ES", taxId: "B12345678" }), MODULES).find(
      (a) => a.kind === "ensure-tenant",
    );
    const messyTenant = planVenue(request({ country: "es", taxId: " b12345678 " }), MODULES).find(
      (a) => a.kind === "ensure-tenant",
    );
    // The stored row is canonical, so applyVenue reads a messy re-run as the SAME taxpayer and the
    // re-run is the no-op it should be, not `provisioning.tenant_identity_mismatch`.
    expect(messyTenant).toMatchObject({ kind: "ensure-tenant", country: "ES", taxId: "B12345678" });
    expect(messyTenant).toEqual(canonicalTenant);
  });

  it("accepts a country in a different case than the territory prefix (ES matches es-common)", () => {
    // The check is case-insensitive on the country-prefixed convention, so a lowercase country still
    // matches its territory prefix. The stored row is canonical either way (planVenue canonicalizes
    // country before storing it — see the casing test above), so a lowercase re-run is still read as
    // the same taxpayer; planVenue must not refuse the coherent combination on case alone.
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
      fakeModule("b", {
        provisioning: { seed: { summary: "seed b", run: async () => "done" } },
      }),
      fakeModule("core"),
      fakeModule("a", {
        provisioning: { seed: { summary: "seed a", run: async () => "done" } },
      }),
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
      "create node Mostrador filing=verifactu tax=vat",
      "create standard series A",
      "create rectificative series R",
      "seed module probe: seed the probe",
    ]);
  });

  it("shows only the parts of the admin a plan actually carries", () => {
    const admin = {
      kind: "seed-admin" as const,
      displayName: "Owner",
      firstNames: null,
      lastNames: null,
      locale: null,
      pinHash: "scrypt$00$00",
      passwordHash: "scrypt$aa$bb",
      email: "owner@example.test",
    };
    expect(describeVenueAction(admin)).toBe("seed admin Owner");
    expect(describeVenueAction({ ...admin, locale: "en-GB" })).toBe("seed admin Owner (en-GB)");
    expect(describeVenueAction({ ...admin, lastNames: "Ruiz" })).toBe("seed admin Owner (Ruiz)");
  });

  it("names the admin but NEVER the pin hash — the description is operator-facing", () => {
    // The pin_hash is a secret: it must not reach a plan summary an operator sees. Uses a distinctive
    // hash so the negative assertion cannot pass by coincidence.
    const line = describeVenueAction({
      kind: "seed-admin",
      displayName: "Alicia",
      firstNames: "Alicia Maria",
      lastNames: "Fernandez Ruiz",
      locale: "es-ES",
      pinHash: "scrypt$deadbeef$cafef00d",
      passwordHash: "scrypt$feedface$0ddba11",
      email: "owner@example.test",
    });
    expect(line).toBe("seed admin Alicia (Alicia Maria Fernandez Ruiz, es-ES)");
    expect(line).not.toContain("scrypt");
    expect(line).not.toContain("deadbeef");
    expect(line).not.toContain("cafef00d");
    expect(line).not.toContain("feedface");
    expect(line).not.toContain("0ddba11");
  });
});
