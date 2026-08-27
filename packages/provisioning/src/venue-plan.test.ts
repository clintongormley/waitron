import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { obligadoTenantId } from "./tenant-id.js";
import { describeVenueAction, planVenue, type VenueRequest } from "./venue-plan.js";

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
  it("emits ensure-tenant → seed-admin → location → till → node → register-sif → two series, in order", () => {
    const actions = planVenue(request());
    expect(actions.map((a) => a.kind)).toEqual([
      "ensure-tenant",
      "seed-admin",
      "create-location",
      "create-till",
      "create-node",
      "register-sif",
      "create-series",
      "create-series",
    ]);
  });

  it("seeds the admin immediately after ensure-tenant, carrying the display name and pin hash", () => {
    // The admin needs only the tenant scope, so it is emitted right after ensure-tenant and before
    // the location. The pinHash flows straight through from the request — planVenue never sees a
    // plaintext PIN (it is hashed at the CLI boundary).
    const actions = planVenue(request());
    expect(actions[0]?.kind).toBe("ensure-tenant");
    expect(actions[1]).toEqual({
      kind: "seed-admin",
      displayName: "Owner",
      pinHash: "scrypt$00$00",
      passwordHash: "scrypt$aa$bb",
    });
  });

  it("derives the deterministic tenant id and stamps the resolved modules on the node", () => {
    const actions = planVenue(request());
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
    const series = planVenue(request()).filter((a) => a.kind === "create-series");
    expect(series).toEqual([
      { kind: "create-series", code: "A", purpose: "standard" },
      { kind: "create-series", code: "R", purpose: "rectificative" },
    ]);
  });

  it("REFUSES an unimplemented territory (spec D4 input half) before emitting anything", () => {
    try {
      planVenue(request({ location: { ...request().location, fiscalTerritory: "ES-PV-bizkaia" } }));
      expect.unreachable("should have refused");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("fiscal.regime_not_implemented");
    }
  });

  it("refuses fewer than one invoice locale, echoing the count", () => {
    try {
      planVenue(request({ location: { ...request().location, invoiceLocales: [] } }));
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
      planVenue(request({ location: { ...request().location, invoiceLocales: ["a", "b", "c"] } }));
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
      planVenue(request({ seriesCode: "A", rectificativeSeriesCode: "A" }));
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
      planVenue(request({ country: "PT" }));
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
    const canonicalTenant = planVenue(request({ country: "ES", taxId: "B12345678" })).find(
      (a) => a.kind === "ensure-tenant",
    );
    const messyTenant = planVenue(request({ country: "es", taxId: " b12345678 " })).find(
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
    );
    expect(actions.map((a) => a.kind)).toEqual([
      "ensure-tenant",
      "seed-admin",
      "create-location",
      "create-till",
      "create-node",
      "register-sif",
      "create-series",
      "create-series",
    ]);
  });
});

describe("describeVenueAction", () => {
  it("renders each planned action as a line an operator can check", () => {
    const lines = planVenue(request()).map((action) => describeVenueAction(action));
    expect(lines).toEqual([
      "ensure tenant ES/B12345678 (Deli SL)",
      "seed admin Owner",
      "create location Mostrador in ES-common (es-ES)",
      "create till Caja 1",
      "create node Mostrador filing=verifactu tax=iva",
      "register the node as a SIF (id_sistema W1)",
      "create standard series A",
      "create rectificative series R",
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
