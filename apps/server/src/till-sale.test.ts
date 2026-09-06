import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  asAppUser,
  optionGroupItems,
  optionGroups,
  productOptionGroups,
  saleLines,
  sales,
  withTenant,
  workingOrderLines,
} from "@waitron/db";
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
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { payWorkingOrder, recordTillSale } from "./till-sale.js";
import { addTabRound, createOpenOrder, openTab, voidTabLine } from "./working-order.js";

// Exercise the sale path and chained fiscal write as app_user on PostgreSQL. Provision as owner.
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
    planVenue(
      {
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
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );

  const cfg = tillConfigFromVenue(venue);
  const available = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, cfg.tenantId, { name: "Delicatessen" });
    const comida = await createCategory(tx, cfg.tenantId, { name: "Comida" });
    const bebidas = await createCategory(tx, cfg.tenantId, { name: "Bebidas" });
    await createProduct(tx, cfg.tenantId, {
      catalogueId: cat.id,
      categoryId: comida.id,
      descriptions: { [LOCALE]: "Jamón cortado" },
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    await createProduct(tx, cfg.tenantId, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua mineral" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    return (await listAvailableProducts(tx, cfg.locationId)).products;
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

/**
 * Feature B: catalogue content is authored under the BARE language tag (`es` = "our Spanish"), and a
 * write-side transform (`toInvoiceLineDescriptions`, wired into `priceOrderLines`) re-keys it to the
 * location's full-tag `invoice_locales` at the single point content enters a fiscal line — so the
 * `working_order_lines_check_locales` trigger (which requires the per-line `descriptions` map to hold
 * EXACTLY the venue's `invoice_locales`) passes on the insert, and the same re-keyed `priced` flows on
 * to `sale_lines`. Real Postgres, exactly like the sales above: the trigger and the chained record are
 * the point. A bare-`es` product on a `{es-ES}` venue would otherwise be REJECTED by the trigger.
 */
describe("priceOrderLines re-keys bare catalogue content to the venue invoice_locales", () => {
  async function setupBareVenue(
    invoiceLocales: string[],
    descriptions: Record<string, string>,
  ): Promise<{ cfg: TillConfig; productId: string }> {
    const venue = await applyVenue(
      planVenue(
        {
          country: "ES",
          taxId: nextNif(),
          legalName: "Deli Bare SL",
          location: {
            name: "Sala principal",
            fiscalTerritory: "ES-common",
            invoiceLocales,
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
        },
        ALL_MODULES,
      ),
      { db: suite.admin, modules: ALL_MODULES },
    );
    const cfg = tillConfigFromVenue(venue);
    const productId = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, cfg.tenantId, { name: "Delicatessen" });
      const bebidas = await createCategory(tx, cfg.tenantId, { name: "Bebidas" });
      const product = await createProduct(tx, cfg.tenantId, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        descriptions,
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, venue.locationId, cat.id);
      return product.id;
    });
    return { cfg, productId };
  }

  it("re-keys bare `es` to full-tag `es-ES` — reading invoice_locales FRESH from the DB, not cfg", async () => {
    // The venue's DB `invoice_locales` is {es-ES}; the catalogue product carries BARE `es`. We
    // deliberately DRIFT `cfg.invoiceLocales` to a WRONG value — if the re-key read cfg (env-derived)
    // rather than the DB, it would produce `ca-ES` and the trigger (checking the DB's {es-ES}) would
    // REJECT the insert. That it succeeds with `es-ES` proves the re-key reads the location fresh.
    const { cfg, productId } = await setupBareVenue(["es-ES"], { es: "Café" });
    const driftedCfg: TillConfig = { ...cfg, invoiceLocales: ["ca-ES"], locale: "ca-ES" };
    const workingOrderId = randomUUID();

    const result = await payWorkingOrder({ db: suite.admin, backend, clock }, driftedCfg, {
      id: workingOrderId,
      lines: [{ productId, quantity: "1" }],
      tender: { method: "cash", amount: "1.50" },
    });
    expect(result.invoiceNumber).toMatch(/^A\/\d+$/);

    const { woLines, slLines } = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const woLines = await tx
        .select({ descriptions: workingOrderLines.descriptions })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, workingOrderId));
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, workingOrderId));
      const slLines = await tx
        .select({ descriptions: saleLines.descriptions })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id));
      return { woLines, slLines };
    });

    // The working_order_lines insert SUCCEEDED (the trigger would reject bare `es`) with the re-keyed map…
    expect(woLines).toHaveLength(1);
    expect(woLines[0]!.descriptions).toEqual({ "es-ES": "Café" });
    // …and the same re-keyed `priced` flowed on to the filed sale_lines.
    expect(slLines).toHaveLength(1);
    expect(slLines[0]!.descriptions).toEqual({ "es-ES": "Café" });
  });

  it("re-keys a bilingual bare product to both venue locales", async () => {
    const { cfg, productId } = await setupBareVenue(["es-ES", "ca-ES"], { es: "Café", ca: "Cafè" });
    const workingOrderId = randomUUID();

    await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
      id: workingOrderId,
      lines: [{ productId, quantity: "1" }],
      tender: { method: "cash", amount: "1.50" },
    });

    const lines = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select({ descriptions: workingOrderLines.descriptions })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, workingOrderId));
    });
    expect(lines[0]!.descriptions).toEqual({ "es-ES": "Café", "ca-ES": "Cafè" });
  });
});

/**
 * Ordering modifiers (Task 6): the till rings a dish with selected options, and `priceOrderLines`
 * expands each dish into a PARENT line plus one CHILD line per option, validating the selection
 * server-side (the client is never the gate). These are the fiscal-adjacent invariants — a filed
 * modifier sale carries parent + child `sale_lines`, and a parked-then-paid one re-prices its children
 * from their add-time lock to the same total/desglose. Real Postgres, like the sales above: the
 * chained record, the self-referential `parent_line_id`, and the app-role inserts are the point.
 */
describe("ordering modifiers — parent + child lines", () => {
  interface ModifierVenue {
    cfg: TillConfig;
    available: AvailableProduct[];
  }

  /**
   * Stand up a fresh chained venue and seed a catalogue with two modifiable `each` dishes and one
   * `weight` product, authored under the BARE `es` tag (feature B). Groups/items are inserted directly
   * (no CRUD verbs exist for them yet) as the app role, then read back through `listAvailableProducts`
   * exactly as production does — so a test resolves option ids from the SAME shape the server prices
   * against:
   *  - "Hamburguesa" (each, 9.00 general) + optional group "Extras" (min 0, max 3): Bacon +0.50
   *    reduced, Queso +0.75 inherit-general.
   *  - "Menú" (each, 12.00 general) + REQUIRED group "Tamaño" (min 1, max 1): Pequeño +0.00, Grande +2.00.
   *  - "Jamón" (weight, 24.90 reduced), no groups — for the non-`each` rejection.
   */
  async function setupModifierVenue(): Promise<ModifierVenue> {
    const venue = await applyVenue(
      planVenue(
        {
          country: "ES",
          taxId: nextNif(),
          legalName: "Deli Mods SL",
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
        },
        ALL_MODULES,
      ),
      { db: suite.admin, modules: ALL_MODULES },
    );
    const cfg = tillConfigFromVenue(venue);
    const available = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, cfg.tenantId, { name: "Delicatessen" });
      const comida = await createCategory(tx, cfg.tenantId, { name: "Comida" });
      const burger = await createProduct(tx, cfg.tenantId, {
        catalogueId: cat.id,
        categoryId: comida.id,
        descriptions: { es: "Hamburguesa" },
        pricingUnit: "each",
        unitPrice: "9.00",
        vatClass: "general",
      });
      const menu = await createProduct(tx, cfg.tenantId, {
        catalogueId: cat.id,
        categoryId: comida.id,
        descriptions: { es: "Menú" },
        pricingUnit: "each",
        unitPrice: "12.00",
        vatClass: "general",
      });
      await createProduct(tx, cfg.tenantId, {
        catalogueId: cat.id,
        categoryId: comida.id,
        descriptions: { es: "Jamón" },
        pricingUnit: "weight",
        unitPrice: "24.90",
        vatClass: "reduced",
      });
      // "Combo" carries a REQUIRED group whose only item is INACTIVE — so it resolves to `items: []`.
      // A required-but-empty group is an authoring bug and must NOT deadlock a sale (CLAUDE.md §5).
      const combo = await createProduct(tx, cfg.tenantId, {
        catalogueId: cat.id,
        categoryId: comida.id,
        descriptions: { es: "Combo" },
        pricingUnit: "each",
        unitPrice: "8.00",
        vatClass: "general",
      });
      // "Plato" carries a NON-required group demanding at least TWO picks (`min_select` 2) — the
      // `below_min` selection-invalid path (a non-required group with a floor is DB-legal).
      const plato = await createProduct(tx, cfg.tenantId, {
        catalogueId: cat.id,
        categoryId: comida.id,
        descriptions: { es: "Plato" },
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });

      const [extras] = await tx
        .insert(optionGroups)
        .values({
          tenantId: cfg.tenantId,
          name: { es: "Extras" },
          minSelect: 0,
          maxSelect: 3,
          required: false,
          sort: 0,
        })
        .returning({ id: optionGroups.id });
      await tx.insert(optionGroupItems).values([
        {
          tenantId: cfg.tenantId,
          groupId: extras!.id,
          name: { es: "Bacon" },
          priceDelta: "0.50",
          vatClass: "reduced",
          // Per-option quantity: Bacon may be taken up to ×3 on one dish (the per-option quantity
          // filing test rings it ×3). Queso keeps the NOT-NULL default of 1.
          maxQuantity: 3,
          sort: 0,
        },
        {
          tenantId: cfg.tenantId,
          groupId: extras!.id,
          name: { es: "Queso" },
          priceDelta: "0.75",
          vatClass: null,
          sort: 1,
        },
      ]);

      const [size] = await tx
        .insert(optionGroups)
        .values({
          tenantId: cfg.tenantId,
          name: { es: "Tamaño" },
          minSelect: 1,
          maxSelect: 1,
          required: true,
          sort: 0,
        })
        .returning({ id: optionGroups.id });
      await tx.insert(optionGroupItems).values([
        {
          tenantId: cfg.tenantId,
          groupId: size!.id,
          name: { es: "Pequeño" },
          priceDelta: "0",
          vatClass: null,
          sort: 0,
        },
        {
          tenantId: cfg.tenantId,
          groupId: size!.id,
          name: { es: "Grande" },
          priceDelta: "2.00",
          vatClass: null,
          sort: 1,
        },
      ]);

      // An ACTIVE required group whose ONLY item is INACTIVE → resolves to `items: []` on Combo.
      const [salsa] = await tx
        .insert(optionGroups)
        .values({
          tenantId: cfg.tenantId,
          name: { es: "Salsa" },
          minSelect: 1,
          maxSelect: 1,
          required: true,
          sort: 0,
        })
        .returning({ id: optionGroups.id });
      await tx.insert(optionGroupItems).values({
        tenantId: cfg.tenantId,
        groupId: salsa!.id,
        name: { es: "Alioli" },
        priceDelta: "0",
        vatClass: null,
        sort: 0,
        active: false,
      });

      // A non-required group with a floor of two picks (min 2, max 3) on Plato.
      const [guarnicion] = await tx
        .insert(optionGroups)
        .values({
          tenantId: cfg.tenantId,
          name: { es: "Guarnición" },
          minSelect: 2,
          maxSelect: 3,
          required: false,
          sort: 0,
        })
        .returning({ id: optionGroups.id });
      await tx.insert(optionGroupItems).values([
        {
          tenantId: cfg.tenantId,
          groupId: guarnicion!.id,
          name: { es: "Patatas" },
          priceDelta: "1.00",
          vatClass: null,
          sort: 0,
        },
        {
          tenantId: cfg.tenantId,
          groupId: guarnicion!.id,
          name: { es: "Ensalada" },
          priceDelta: "1.50",
          vatClass: null,
          sort: 1,
        },
      ]);

      await tx.insert(productOptionGroups).values([
        { tenantId: cfg.tenantId, productId: burger.id, groupId: extras!.id, sort: 0 },
        { tenantId: cfg.tenantId, productId: menu.id, groupId: size!.id, sort: 0 },
        { tenantId: cfg.tenantId, productId: combo.id, groupId: salsa!.id, sort: 0 },
        {
          tenantId: cfg.tenantId,
          productId: plato.id,
          groupId: guarnicion!.id,
          sort: 0,
        },
      ]);

      await assignCatalogueToLocation(tx, venue.locationId, cat.id);
      return (await listAvailableProducts(tx, cfg.locationId)).products;
    });
    return { cfg, available };
  }

  const burgerOf = (v: ModifierVenue) =>
    v.available.find((p) => p.descriptions.es === "Hamburguesa")!;
  const menuOf = (v: ModifierVenue) => v.available.find((p) => p.descriptions.es === "Menú")!;
  const jamonOf = (v: ModifierVenue) => v.available.find((p) => p.descriptions.es === "Jamón")!;
  const comboOf = (v: ModifierVenue) => v.available.find((p) => p.descriptions.es === "Combo")!;
  const platoOf = (v: ModifierVenue) => v.available.find((p) => p.descriptions.es === "Plato")!;
  const itemOf = (p: AvailableProduct, name: string) =>
    p.optionGroups.flatMap((g) => g.items).find((i) => i.name.es === name)!;

  it("counter sale of a dish with two options files THREE sale_lines with parent/child links", async () => {
    const v = await setupModifierVenue();
    const burger = burgerOf(v);
    const bacon = itemOf(burger, "Bacon"); // +0.50 reduced(10%)
    const queso = itemOf(burger, "Queso"); // +0.75 inherit general(21%)
    const workingOrderId = randomUUID();

    const result = await recordTillSale({ db: suite.admin, backend, clock }, v.cfg, {
      lines: [
        {
          productId: burger.id,
          quantity: "1",
          options: [{ optionGroupItemId: bacon.id }, { optionGroupItemId: queso.id }],
        },
      ],
      tender: { method: "cash", amount: "20.00" },
      workingOrderId,
    });

    // 9.00 dish + 0.50 bacon + 0.75 queso = 10.25 gross.
    expect(result.total).toBe("10.25");
    expect(result.change).toBe("9.75");
    // The receipt line list is parent + both children.
    expect(result.lines).toHaveLength(3);
    expect(result.lines.map((l) => l.descriptions["es-ES"])).toEqual([
      "Hamburguesa",
      "Bacon",
      "Queso",
    ]);

    const { wol, sl } = await withTenant(suite.admin, v.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const wol = await tx
        .select({
          id: workingOrderLines.id,
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
          parentLineId: workingOrderLines.parentLineId,
          optionGroupItemId: workingOrderLines.optionGroupItemId,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, workingOrderId))
        .orderBy(workingOrderLines.lineNo);
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, workingOrderId));
      const sl = await tx
        .select({ parentLineId: saleLines.parentLineId })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id));
      return { wol, sl };
    });

    // THREE working_order_lines: one parent (product set, no parent/option), two children (product
    // NULL, parent_line_id → the parent's id, the source option_group_item_id).
    expect(wol).toHaveLength(3);
    const [parent, childBacon, childQueso] = wol;
    expect(parent!.productId).toBe(burger.id);
    expect(parent!.parentLineId).toBeNull();
    expect(parent!.optionGroupItemId).toBeNull();

    expect(childBacon!.productId).toBeNull();
    expect(childBacon!.parentLineId).toBe(parent!.id);
    expect(childBacon!.optionGroupItemId).toBe(bacon.id);

    expect(childQueso!.productId).toBeNull();
    expect(childQueso!.parentLineId).toBe(parent!.id);
    expect(childQueso!.optionGroupItemId).toBe(queso.id);

    // THREE filed sale_lines too, the two children carrying parent_line_id (Task 5 resolves it).
    expect(sl).toHaveLength(3);
    expect(sl.filter((l) => l.parentLineId !== null)).toHaveLength(2);
  });

  it("counter sale of a dish ×2 with an option ×3 files the child at the COMBINED quantity 6", async () => {
    const v = await setupModifierVenue();
    const burger = burgerOf(v);
    const bacon = itemOf(burger, "Bacon"); // +0.50 reduced(10%), max_quantity 3
    const workingOrderId = randomUUID();

    const result = await recordTillSale({ db: suite.admin, backend, clock }, v.cfg, {
      // Two burgers, each carrying Bacon ×3 → the Bacon child is priced dish(2) × option(3) = 6.
      lines: [
        {
          productId: burger.id,
          quantity: "2",
          options: [{ optionGroupItemId: bacon.id, quantity: 3 }],
        },
      ],
      tender: { method: "cash", amount: "30.00" },
      workingOrderId,
    });

    // 9.00 × 2 dish = 18.00, plus 0.50 × 6 Bacon = 3.00 → 21.00 gross.
    expect(result.total).toBe("21.00");
    expect(result.lines).toHaveLength(2); // parent + one child (the duplicate is a single summed line)

    const { wol, sl } = await withTenant(suite.admin, v.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const wol = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
          parentLineId: workingOrderLines.parentLineId,
          optionGroupItemId: workingOrderLines.optionGroupItemId,
          quantity: workingOrderLines.quantity,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, workingOrderId))
        .orderBy(workingOrderLines.lineNo);
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, workingOrderId));
      const sl = await tx
        .select({
          parentLineId: saleLines.parentLineId,
          quantity: saleLines.quantity,
        })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id))
        .orderBy(saleLines.lineNo);
      return { wol, sl };
    });

    // Parent burger ×2 unchanged; child Bacon at the COMBINED 6, priced 0.50 × 6 = 3.00 gross.
    expect(wol).toHaveLength(2);
    expect(wol[0]).toMatchObject({ productId: burger.id, parentLineId: null, quantity: "2.000" });
    expect(wol[1]!.optionGroupItemId).toBe(bacon.id);
    expect(wol[1]!.quantity).toBe("6.000");
    expect(wol[1]!.lineTotal).toBe("3.00");

    // The FILED child sale_line carries the same combined quantity (fiscal record).
    expect(sl).toHaveLength(2);
    const child = sl.find((l) => l.parentLineId !== null)!;
    expect(child.quantity).toBe("6.000");
  });

  it("park → retrieve → pay re-prices children from their lock to the same total and desglose", async () => {
    const v = await setupModifierVenue();
    const burger = burgerOf(v);
    const bacon = itemOf(burger, "Bacon");
    const queso = itemOf(burger, "Queso");
    const workingOrderId = randomUUID();

    // PARK: persist an OPEN order with parent + child lines, and capture the PREVIEW price its lines
    // were built from (the same authoritative `priceBasketWithOptions` result).
    const preview = await withTenant(suite.admin, v.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const { priced } = await createOpenOrder(
        tx,
        v.cfg,
        workingOrderId,
        [
          {
            productId: burger.id,
            quantity: "1",
            options: [{ optionGroupItemId: bacon.id }, { optionGroupItemId: queso.id }],
          },
        ],
        null,
      );
      return priced;
    });

    // RETRIEVE + PAY: the till sends the parked order's id and NO basket, so payWorkingOrder files from
    // the STORED locked lines (readLockedLines → priceStoredOrder), re-pricing the children from their
    // add-time `unit_price_gross`/`vat_rate` — never a re-read of the catalogue.
    const result = await payWorkingOrder({ db: suite.admin, backend, clock }, v.cfg, {
      id: workingOrderId,
      lines: [],
      tender: { method: "cash", amount: "20.00" },
    });

    // The filed total and desglose equal the previewed ones to the céntimo — the load-bearing fiscal
    // invariant: a locked-line filing of a modifier order never diverges from its preview.
    expect(result.total).toBe(preview.total);
    // `result.vatBreakdown` is `{rate, base, tax}` strings (the ticket shape); the preview's bands
    // carry the same three fields (Decimals are branded strings), so compare that projection.
    expect(result.vatBreakdown).toEqual(
      preview.vatBreakdown.map((b) => ({ rate: b.rate, base: b.base, tax: b.tax })),
    );
    // The filed record carries all three lines.
    expect(result.lines).toHaveLength(3);

    // LINKAGE must survive the lock round-trip (fix round 1): the filed child sale_lines point at the
    // filed PARENT's id, not `null`. `readLockedLines` reconstructs each child's `parentLineNo` from
    // its stored `parent_line_id`, so the persisted-order file path preserves parent→child linkage
    // exactly as a live walk-up does — a child sale_line is never orphaned by the re-price.
    const filed = await withTenant(suite.admin, v.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, workingOrderId));
      return tx
        .select({
          id: saleLines.id,
          lineNo: saleLines.lineNo,
          parentLineId: saleLines.parentLineId,
        })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id))
        .orderBy(saleLines.lineNo);
    });
    expect(filed).toHaveLength(3);
    const [filedParent, filedBacon, filedQueso] = filed;
    expect(filedParent!.parentLineId).toBeNull();
    expect(filedBacon!.parentLineId).toBe(filedParent!.id);
    expect(filedQueso!.parentLineId).toBe(filedParent!.id);

    // The JSON-facing `TillSaleResult.lines[i].parentLineNo` carries the SAME linkage (the till's
    // settled-ticket view, Task 14, groups on this field) — the dish renders `null`, each child the
    // parent's own `lineNo`, proven against the real persisted lineNo rather than an assumed constant.
    expect(result.lines[0]!.parentLineNo).toBeNull();
    expect(result.lines[1]!.parentLineNo).toBe(filedParent!.lineNo);
    expect(result.lines[2]!.parentLineNo).toBe(filedParent!.lineNo);
  });

  it("settling a TAB with modifiers files child sale_lines linked to their parent (the primary path)", async () => {
    // Tabs are the PRIMARY modifier path and settle through `priceStoredOrder` (the locked-line file),
    // so this proves the linkage survives openTab → addTabRound(options) → settle, not just the parked
    // counter retrieve above. Provisioning already ships the venue's default 'Cocina' station (so
    // addTabRound can fire); we add only the dining table the tab opens on.
    const v = await setupModifierVenue();
    const burger = burgerOf(v);
    const bacon = itemOf(burger, "Bacon");
    const queso = itemOf(burger, "Queso");

    const tableId = randomUUID();
    await withTenant(suite.admin, v.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.execute(
        sql`insert into dining_tables (id, tenant_id, location_id, label, active)
            values (${tableId}, ${v.cfg.tenantId}, ${v.cfg.locationId}, 'Mesa 1', true)`,
      );
    });

    // Open a tab and send a round of the burger with two options.
    const tabId = await withTenant(suite.admin, v.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const { tabId } = await openTab(tx, v.cfg, { tableId });
      await addTabRound(tx, v.cfg, tabId, [
        {
          productId: burger.id,
          quantity: "1",
          options: [{ optionGroupItemId: bacon.id }, { optionGroupItemId: queso.id }],
        },
      ]);
      return tabId;
    });

    // Settle the tab (files from the STORED locked lines via priceStoredOrder).
    const result = await payWorkingOrder({ db: suite.admin, backend, clock }, v.cfg, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "20.00" },
    });
    expect(result.total).toBe("10.25");
    expect(result.lines).toHaveLength(3);

    const filed = await withTenant(suite.admin, v.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, tabId));
      return tx
        .select({ id: saleLines.id, parentLineId: saleLines.parentLineId })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id))
        .orderBy(saleLines.lineNo);
    });
    expect(filed).toHaveLength(3);
    const [filedParent, ...children] = filed;
    expect(filedParent!.parentLineId).toBeNull();
    expect(children.map((c) => c.parentLineId)).toEqual([filedParent!.id, filedParent!.id]);
  });

  it("settles a tab through recordTillSale (the /api/sales entry point) with an EMPTY basket", async () => {
    // REGRESSION (table-service settle 400s). The tab-pay flow posts `lines: []` with the tab id to
    // `POST /api/sales` (till-app `#onPayTab`) — a retrieved order files its STORED locked lines and
    // IGNORES the sent basket. That route calls `recordTillSale`, whose entry-point empty-basket
    // early-out fired BEFORE `payWorkingOrder`'s walk-up-ONLY guard, refusing every tab settle with
    // `sale.empty_basket`. The sibling tab test above exercises `payWorkingOrder` directly and so
    // never saw it; this drives the SAME entry point the HTTP route does, where the guard lived.
    const v = await setupModifierVenue();
    const burger = burgerOf(v);

    const tableId = randomUUID();
    const tabId = await withTenant(suite.admin, v.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.execute(
        sql`insert into dining_tables (id, tenant_id, location_id, label, active)
            values (${tableId}, ${v.cfg.tenantId}, ${v.cfg.locationId}, 'Mesa 1', true)`,
      );
      const { tabId } = await openTab(tx, v.cfg, { tableId });
      await addTabRound(tx, v.cfg, tabId, [{ productId: burger.id, quantity: "1" }]);
      return tabId;
    });

    const result = await recordTillSale({ db: suite.admin, backend, clock }, v.cfg, {
      lines: [],
      tender: { method: "cash", amount: "20.00" },
      workingOrderId: tabId,
    });
    // Files the tab's stored burger line (9.00 gross), never a `sale.empty_basket` refusal.
    expect(result.total).toBe("9.00");
    expect(result.lines).toHaveLength(1);
  });

  it("settles a NON-CONTIGUOUS tab (a voided child) with each child linked to its OWN dish", async () => {
    // FIX 1 (Critical, unrepairable fiscal record): after a void leaves a tab's `line_no`
    // non-contiguous, the STORED `line_no` space diverges from the COMPACTED array-position space
    // `priceRows` renumbers into and `recordSale`'s `byLineNo` map is keyed on. `readLockedLines` must
    // reconstruct each child's `parentLineNo` in that position space, else a child files with a WRONG
    // `parent_line_id` (self / null / wrong sibling) — a permanent error in the append-only record.
    const v = await setupModifierVenue();
    const burger = burgerOf(v);
    const bacon = itemOf(burger, "Bacon");
    const queso = itemOf(burger, "Queso");

    const tableId = randomUUID();
    await withTenant(suite.admin, v.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.execute(
        sql`insert into dining_tables (id, tenant_id, location_id, label, active)
            values (${tableId}, ${v.cfg.tenantId}, ${v.cfg.locationId}, 'Mesa NC', true)`,
      );
    });

    // Tab: dish#1 (line_no 1) + bacon child (line_no 2); dish#2 (line_no 3) + queso child (line_no 4).
    // Then VOID the bacon child (line_no 2), leaving {1,3,4} — non-contiguous.
    const tabId = await withTenant(suite.admin, v.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const { tabId } = await openTab(tx, v.cfg, { tableId });
      await addTabRound(tx, v.cfg, tabId, [
        { productId: burger.id, quantity: "1", options: [{ optionGroupItemId: bacon.id }] },
        { productId: burger.id, quantity: "1", options: [{ optionGroupItemId: queso.id }] },
      ]);
      await voidTabLine(tx, v.cfg, tabId, 2);
      return tabId;
    });

    const result = await payWorkingOrder({ db: suite.admin, backend, clock }, v.cfg, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "30.00" },
    });
    // Two dishes (9.00 each) + queso (0.75) = 18.75, unchanged by line_no compaction.
    expect(result.total).toBe("18.75");
    expect(result.lines).toHaveLength(3);

    const filed = await withTenant(suite.admin, v.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, tabId));
      return tx
        .select({ id: saleLines.id, parentLineId: saleLines.parentLineId })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id))
        .orderBy(saleLines.lineNo);
    });
    // Filed (sorted by line_no): dish#1, dish#2, queso — the compaction gives emitted lineNo 1,2,3.
    expect(filed).toHaveLength(3);
    const [dish1, dish2, quesoChild] = filed;
    expect(dish1!.parentLineId).toBeNull();
    expect(dish2!.parentLineId).toBeNull();
    // The queso child points at DISH#2's filed id — never at itself (the self-reference the bug files),
    // never null, never dish#1.
    expect(quesoChild!.parentLineId).toBe(dish2!.id);
    expect(quesoChild!.parentLineId).not.toBe(quesoChild!.id);
    expect(quesoChild!.parentLineId).not.toBeNull();
    expect(quesoChild!.parentLineId).not.toBe(dish1!.id);
  });

  it("fails loud server-side: bad option, an invalid selection, options on a weight product", async () => {
    const v = await setupModifierVenue();
    const burger = burgerOf(v);
    const menu = menuOf(v);
    const jamon = jamonOf(v);
    const bogus = "00000000-0000-0000-0000-000000000000";
    const deps = { db: suite.admin, backend, clock };

    // (a) an option id that belongs to no active group of the product → option.not_found.
    await expect(
      recordTillSale(deps, v.cfg, {
        lines: [{ productId: burger.id, quantity: "1", options: [{ optionGroupItemId: bogus }] }],
        tender: { method: "cash", amount: "20.00" },
      }),
    ).rejects.toMatchObject({
      code: "option.not_found",
      params: { optionGroupItemId: bogus, productId: burger.id },
    });

    // (b) a REQUIRED group (Tamaño, min 1) with nothing selected → options.selection_invalid.
    await expect(
      recordTillSale(deps, v.cfg, {
        lines: [{ productId: menu.id, quantity: "1", options: [] }],
        tender: { method: "cash", amount: "20.00" },
      }),
    ).rejects.toMatchObject({
      code: "options.selection_invalid",
      params: { productId: menu.id },
    });

    // (b2) exceeding maxSelect (Tamaño max 1, two picked) → options.selection_invalid.
    const size = menu.optionGroups[0]!;
    await expect(
      recordTillSale(deps, v.cfg, {
        lines: [
          {
            productId: menu.id,
            quantity: "1",
            options: size.items.map((i) => ({ optionGroupItemId: i.id })),
          },
        ],
        tender: { method: "cash", amount: "20.00" },
      }),
    ).rejects.toMatchObject({ code: "options.selection_invalid", params: { productId: menu.id } });

    // (c) options on a `weight` product → options.unsupported_product (modifiers attach to `each` only).
    await expect(
      recordTillSale(deps, v.cfg, {
        lines: [
          { productId: jamon.id, quantity: "0.250", options: [{ optionGroupItemId: bogus }] },
        ],
        tender: { method: "cash", amount: "20.00" },
      }),
    ).rejects.toMatchObject({
      code: "options.unsupported_product",
      params: { productId: jamon.id, pricingUnit: "weight" },
    });

    // (d) fewer than a non-required group's `min_select` (Guarnición demands 2, one picked) →
    // options.selection_invalid.
    const plato = platoOf(v);
    const oneGuarnicion = plato.optionGroups[0]!.items[0]!;
    await expect(
      recordTillSale(deps, v.cfg, {
        lines: [
          {
            productId: plato.id,
            quantity: "1",
            options: [{ optionGroupItemId: oneGuarnicion.id }],
          },
        ],
        tender: { method: "cash", amount: "20.00" },
      }),
    ).rejects.toMatchObject({ code: "options.selection_invalid", params: { productId: plato.id } });
  });

  it("does NOT deadlock on a required-but-EMPTY group — an authoring bug never blocks a sale", async () => {
    // Combo carries a REQUIRED "Salsa" group whose only item is inactive, so it resolves to `items: []`.
    // A required group that can never be satisfied would deadlock the till; §5 forbids blocking a sale,
    // so an empty group is treated as no constraint and the sale files (with no children).
    const v = await setupModifierVenue();
    const combo = comboOf(v);
    // The group is present on the product but carries no selectable items.
    expect(combo.optionGroups).toHaveLength(1);
    expect(combo.optionGroups[0]!.required).toBe(true);
    expect(combo.optionGroups[0]!.items).toEqual([]);

    const result = await recordTillSale({ db: suite.admin, backend, clock }, v.cfg, {
      lines: [{ productId: combo.id, quantity: "1", options: [] }],
      tender: { method: "cash", amount: "10.00" },
    });
    expect(result.total).toBe("8.00");
    expect(result.lines).toHaveLength(1);
  });
});
