import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
// Test-only infra of @waitron/fiscal — the sanctioned deep-import path core's tests and
// `daily-close-demo.ts` already use. Its `recordSale` returns a FiscalRecordRef with NO
// `verificationUrl`, which is how the "empty qr" branch below is exercised at all.
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import type { TillConfig } from "./till-config.js";
import { recordTillSale } from "./till-sale.js";

// Real Postgres, not PGlite: the whole point is a genuine chained fiscal record written by the app
// role under RLS. PGlite runs every connection as a superuser, which bypasses RLS and cannot prove
// the deployment role is permitted to write `registros_facturacion` (CLAUDE.md §4). The sale path
// runs through `asAppUser` (SET LOCAL ROLE app_user) exactly as `catalogue-demo.ts` does on the
// owner connection; provisioning runs as the owner.
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

let backend: FiscalBackend;
let clock: TrustedClock;

/**
 * The wall clock at the moment this process runs, reported as already confident and anchored — the
 * identical stub shape `catalogue-demo.ts`/`record-one-sale.ts` document. `recordSale` reads
 * `now()` once and touches neither `anchor` nor `currentAnchor`.
 */
function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("till-sale.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is
// unique, so each provisioned venue needs its own NIF. A local counter, the same shape
// `provision-till.test.ts`'s `nextNif` uses for the same reason.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(50_000_000 + nifCounter).padStart(8, "0")}K`;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    // No integrated card terminal — the walk-up sale path neither builds nor drives one.
    cardProvider: "none",
    tipsEnabled: false,
    // The walk-up sale path is mode-agnostic; the provisioned venue defaults to prepay.
    orderFlow: "prepay",
  };
}

/**
 * Stand up a fresh chained venue + registered SIF (as the owner), then seed a catalogue as the app
 * role and read back the sellable products — one `each` product (1.50 gross, general/21%) and one
 * `weight` product (24.90 €/kg, reduced/10%). Each test gets its OWN tenant so the
 * `registros_facturacion` count is that test's alone, order-independent (CLAUDE.md §4).
 */
async function setupVenue(): Promise<{ cfg: TillConfig; available: AvailableProduct[] }> {
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
      legalName: "Deli Test SL",
      location: {
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
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
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("dashPass123"),
      },
    }),
    { db: suite.admin },
  );

  const cfg = tillConfigFromVenue(venue);
  const available = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const comida = await createCategory(tx, { name: "Comida" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: comida.id,
      descriptions: { [LOCALE]: "Jamón cortado" },
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua mineral" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    return listAvailableProducts(tx, cfg.locationId);
  });
  return { cfg, available };
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.admin,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("till-sale.test: resolveClient must never be called by recordSale")),
  });
});

describe("recordTillSale", () => {
  it("walk-up: prices the sent basket authoritatively and files a chained immediate cash sale", async () => {
    const { cfg, available } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!; // 1.50 general(21%)

    const result = await recordTillSale({ db: suite.admin, backend, clock }, cfg, {
      lines: [{ productId: each.id, quantity: "2" }],
      tender: { method: "cash", amount: "5.00" },
    });

    expect(result.total).toBe("3.00");
    expect(result.change).toBe("2.00"); // 5.00 tendered − 3.00
    expect(result.invoiceNumber).toMatch(/^A\/\d+$/);
    expect(result.vatBreakdown).toEqual([{ rate: "21.00", base: "2.48", tax: "0.52" }]);
    expect(result.issuedAt).toMatch(/^\d{4}-\d\d-\d\dT/); // ISO-8601 instant
    expect(typeof result.qr).toBe("string"); // regime verification URL (may be empty)

    // A genuine chained fiscal record exists — one, for this tenant's single sale (its own tenant,
    // so the count is order-independent).
    const rows = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(registrosFacturacion);
    });
    expect(rows.length).toBe(1);
  });

  it("ignores a browser-sent price — it only reads productId + quantity", async () => {
    const { cfg, available } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;

    // TillSaleRequest.lines has no price field; sending an extra `unitPrice` cast `as any` must not
    // change the filed total — the server re-reads the catalogue and prices authoritatively.
    const result = await recordTillSale({ db: suite.admin, backend, clock }, cfg, {
      lines: [
        { productId: each.id, quantity: "1", unitPrice: "0.01" } as unknown as {
          productId: string;
          quantity: string;
        },
      ],
      tender: { method: "cash", amount: "1.50" },
    });

    expect(result.total).toBe("1.50"); // 1 × 1.50 gross, NOT the browser's 0.01
    expect(result.change).toBe("0.00");
  });

  it("rejects an empty basket, an unknown product, an unsupported tender, and a shortfall", async () => {
    const { cfg, available } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const UUID_NOT_IN_CAT = "00000000-0000-0000-0000-000000000000";
    const deps = { db: suite.admin, backend, clock };

    await expect(
      recordTillSale(deps, cfg, { lines: [], tender: { method: "cash", amount: "0" } }),
    ).rejects.toMatchObject({ code: "sale.empty_basket" });

    await expect(
      recordTillSale(deps, cfg, {
        lines: [{ productId: UUID_NOT_IN_CAT, quantity: "1" }],
        tender: { method: "cash", amount: "1" },
      }),
    ).rejects.toMatchObject({
      code: "sale.unknown_product",
      params: { productId: UUID_NOT_IN_CAT },
    });

    // cash and card are supported (7a cash + this slice's manual card); every other tender_method is
    // still refused. The `as unknown` cast is how an untrusted till sends one past the widened type.
    for (const method of ["voucher", "transfer", "other"] as const) {
      await expect(
        recordTillSale(deps, cfg, {
          lines: [{ productId: each.id, quantity: "1" }],
          tender: { method: method as unknown as "cash", amount: "1.50" },
        }),
      ).rejects.toMatchObject({ code: "sale.unsupported_tender", params: { method } });
    }

    // Under-tender: 1.00 tendered against a 1.50 total. `settleSale` (inside recordSale's immediate
    // mode) raises `sale.tender_shortfall`; the whole transaction rolls back.
    await expect(
      recordTillSale(deps, cfg, {
        lines: [{ productId: each.id, quantity: "1" }],
        tender: { method: "cash", amount: "1.00" },
      }),
    ).rejects.toMatchObject({ code: "sale.tender_shortfall" });
  });

  it("returns an empty qr when the fiscal backend offers no verification url", async () => {
    // `TillSaleResult.qr` defaults to "" when the regime offers no verification link
    // (`FiscalRecordRef.verificationUrl` is optional). `VerifactuBackend` always sets one, so this
    // uses `FakeFiscalBackend` — a real test double writing through the caller's transaction — whose
    // records carry none. It exercises the same `recordSale` write path (real sale/lines/tenders/
    // settlement rows), only the fiscal record's own link is absent.
    const { cfg, available } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;

    await FakeFiscalBackend.install(suite.admin);
    const fake = new FakeFiscalBackend(suite.admin);
    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await fake.registerNode(tx, cfg.nodeId, { tenantId: cfg.tenantId });
    });

    const result = await recordTillSale({ db: suite.admin, backend: fake, clock }, cfg, {
      lines: [{ productId: each.id, quantity: "1" }],
      tender: { method: "cash", amount: "1.50" },
    });

    expect(result.qr).toBe("");
    expect(result.total).toBe("1.50");
    expect(result.invoiceNumber).toMatch(/^A\/\d+$/);
  });
});
