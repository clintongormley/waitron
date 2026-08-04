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
    ...overrides,
  };
}

describe("planVenue", () => {
  it("emits ensure-tenant → location → till → node → register-sif → two series, in order", () => {
    const actions = planVenue(request());
    expect(actions.map((a) => a.kind)).toEqual([
      "ensure-tenant",
      "create-location",
      "create-till",
      "create-node",
      "register-sif",
      "create-series",
      "create-series",
    ]);
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

  it("refuses fewer than one or more than two invoice locales", () => {
    expect(() =>
      planVenue(request({ location: { ...request().location, invoiceLocales: [] } })),
    ).toThrow();
    expect(() =>
      planVenue(request({ location: { ...request().location, invoiceLocales: ["a", "b", "c"] } })),
    ).toThrow();
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
});

describe("describeVenueAction", () => {
  it("renders each planned action as a line an operator can check", () => {
    const lines = planVenue(request()).map((action) => describeVenueAction(action));
    expect(lines).toEqual([
      "ensure tenant ES/B12345678 (Deli SL)",
      "create location Mostrador in ES-common (es-ES)",
      "create till Caja 1",
      "create node Mostrador filing=verifactu tax=iva",
      "register the node as a SIF (id_sistema W1)",
      "create standard series A",
      "create rectificative series R",
    ]);
  });
});
