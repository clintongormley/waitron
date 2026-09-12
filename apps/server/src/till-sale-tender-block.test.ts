import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { asAppUser, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { recordSale } from "@waitron/core";
import { associatePaymentWithSale, insertCapturedPayment } from "@waitron/payments";
import type { CardDetails } from "@waitron/payments";
import {
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { readTenderBlock } from "./till-sale.js";
import { createOpenOrder } from "./working-order.js";
import "./errors.js";

// `readTenderBlock` reads back the committed tender (+ payment) rows, so it exercises the app role's
// grants on `tenders`/`payments` — a real-PG concern, not a PGlite superuser one (CLAUDE.md §4). The
// shared manifest template supplies the schema; each case seeds its own sale under its own
// working-order id (unique, so `sales_working_order_id_key` never collides across cases).
const LOCALE = "es-ES";

const suite = useTemplateDb({ template: "manifest" });

let backend: FiscalBackend;
let clock: TrustedClock;

/** The system wall clock, reported confident/anchored — the stub the sibling suites use. */
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
      throw new Error("till-sale-tender-block.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the shape the sibling suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

let cfg: TillConfig;
let productId: string;

beforeAll(async () => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.admin,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(
        new Error("till-sale-tender-block.test: resolveClient must never be called by recordSale"),
      ),
  });

  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Tender SL",
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
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );

  cfg = tillConfigFromVenue(venue);
  productId = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, cfg.tenantId, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, cfg.tenantId, { name: "Bebidas" });
    // A product priced at exactly 1.00 gross so the filed total is "1.00" — the figure every case
    // below asserts against.
    const product = await createProduct(tx, cfg.tenantId, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua" },
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, cfg.locationId, cat.id);
    return product.id;
  });
});

/**
 * File a settled sale for a fresh working order with a single 1.00 line, using the supplied tender
 * settlement, and return the sale + working-order ids. A card case may seed the captured `payments`
 * row (with or without card facts / a manual reference) so `readTenderBlock` can read it back.
 */
async function seedSale(
  tx: Transaction,
  tender: { method: "cash" | "card"; amount: string; tipAmount: string; cashTendered?: string },
  payment?: { provider: string; externalRef?: string; card?: CardDetails },
): Promise<{ saleId: ReturnType<typeof brandSaleId>; workingOrderId: string }> {
  const workingOrderId = randomUUID();
  const settledAt = new Date();
  const { priced } = await createOpenOrder(
    tx,
    cfg,
    workingOrderId,
    [{ productId, quantity: "1" }],
    null,
  );
  const { saleId } = await recordSale(tx, backend, {
    tenantId: cfg.tenantId,
    tillId: cfg.tillId,
    nodeId: cfg.nodeId,
    seriesId: cfg.seriesId,
    workingOrderId: brandWorkingOrderId(workingOrderId),
    locale: cfg.locale,
    invoiceLocales: cfg.invoiceLocales,
    total: priced.total,
    lines: priced.lines,
    vatBreakdown: priced.vatBreakdown,
    clock,
    settlement: {
      kind: "immediate",
      tenders: [
        {
          method: tender.method,
          amount: tender.amount,
          tipAmount: tender.tipAmount,
          cashTendered: tender.cashTendered,
          settledAt,
        },
      ],
    },
  });
  if (payment !== undefined) {
    const paymentRef = randomUUID();
    await insertCapturedPayment(tx, {
      tenantId: cfg.tenantId,
      workingOrderId,
      provider: payment.provider,
      paymentRef,
      amount: decimal(tender.amount),
      settledAt,
      externalRef: payment.externalRef,
      card: payment.card,
    });
    await associatePaymentWithSale(tx, {
      provider: payment.provider,
      paymentRef,
      saleId,
      tenantId: cfg.tenantId,
    });
  }
  return { saleId, workingOrderId };
}

describe("readTenderBlock", () => {
  it("returns a cash block with the passed change", async () => {
    const block = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const { saleId, workingOrderId } = await seedSale(tx, {
        method: "cash",
        cashTendered: "2.00",
        amount: "1.00",
        tipAmount: "0.00",
      });
      return readTenderBlock(tx, cfg, saleId, workingOrderId);
    });
    expect(block).toEqual({ method: "cash", change: "1.00" });
  });

  it("returns the card amounts without exposing payment identity", async () => {
    const block = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const { saleId, workingOrderId } = await seedSale(
        tx,
        { method: "card", amount: "1.00", tipAmount: "0.00" },
        {
          provider: "stripe",
          card: { scheme: "VISA", last4: "5838", entryMode: "contactless", authCode: "328600" },
        },
      );
      return readTenderBlock(tx, cfg, saleId, workingOrderId);
    });
    expect(block).toEqual({
      method: "card",
      charged: "1.00",
      tip: "0.00",
      reference: null,
    });
  });

  it("shows tip and charged when a tip rode on the card", async () => {
    const block = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      // total 1.00 + tip 0.50 → tenders.amount 1.50, tip_amount 0.50.
      const { saleId, workingOrderId } = await seedSale(
        tx,
        { method: "card", amount: "1.50", tipAmount: "0.50" },
        {
          provider: "stripe",
          card: { scheme: "VISA", last4: "5838", entryMode: "chip", authCode: null },
        },
      );
      return readTenderBlock(tx, cfg, saleId, workingOrderId);
    });
    expect(block).toMatchObject({ method: "card", charged: "1.50", tip: "0.50" });
  });

  it("a manual card tender carries the operator reference", async () => {
    const block = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const { saleId, workingOrderId } = await seedSale(
        tx,
        { method: "card", amount: "1.00", tipAmount: "0.00" },
        { provider: "manual", externalRef: "4471" },
      );
      return readTenderBlock(tx, cfg, saleId, workingOrderId);
    });
    expect(block).toEqual({
      method: "card",
      charged: "1.00",
      tip: "0.00",
      reference: "4471",
    });
  });

  it("keeps card amounts when the payment row has no card facts and is not manual", async () => {
    const block = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const { saleId, workingOrderId } = await seedSale(
        tx,
        { method: "card", amount: "1.00", tipAmount: "0.00" },
        { provider: "stripe" },
      );
      return readTenderBlock(tx, cfg, saleId, workingOrderId);
    });
    expect(block).toEqual({ method: "card", charged: "1.00", tip: "0.00", reference: null });
  });

  it("keeps card amounts when the card tender's payment row is absent entirely", async () => {
    // A settled CARD sale with its `tenders` row but NO `payments` row at all (seedSale omits the
    // payment insert when no payment arg is passed) — the `payment === null` branch of readTenderBlock,
    // which every other case misses. A filed, immutable sale must PRESENT, never throw (CLAUDE.md §5),
    // so this degrades to a bare card block rather than failing.
    const block = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const { saleId, workingOrderId } = await seedSale(tx, {
        method: "card",
        amount: "1.00",
        tipAmount: "0.00",
      });
      return readTenderBlock(tx, cfg, saleId, workingOrderId);
    });
    expect(block).toEqual({
      method: "card",
      charged: "1.00",
      tip: "0.00",
      reference: null,
    });
  });
});
