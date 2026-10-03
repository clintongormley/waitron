import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  computeVatSummaryForPeriod,
  currentBusinessDay,
  type CategoryReport,
  type CategoryTotal,
} from "@waitron/reporting";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  rawCentsToDecimal,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { deploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountReportApi } from "./report-api.js";
import type { TillConfig } from "./till-config.js";
import { payWorkingOrder, recordTillSale } from "./till-sale.js";
import { createOpenOrder } from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";

// Review Focus 3: on the till's sale paths a category report's gross is the sum of the issued sales'
// totals, Uncategorised included, and its net is the VAT summary's bases, in both modes. Sales are
// filed through the till's own functions, so each line's gross, net and classification are the
// ones a real sale records.
const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

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
      throw new Error("not used by a sale");
    },
    currentAnchor: () => null,
  };
}

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function flatten(tree: CategoryTotal[]): CategoryTotal[] {
  return tree.flatMap((node) => [node, ...flatten(node.children)]);
}

describe("the category report reconciles with the till's sales", () => {
  it("has a gross equal to the sales' totals and a net equal to the VAT summary's bases, in both modes", async () => {
    const venue = await applyVenue(
      planVenue(
        {
          country: "ES",
          taxId: "71234567W",
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
            email: "owner@example.test",
          },
        },
        ALL_MODULES,
      ),
      { db: suite.db, modules: ALL_MODULES },
    );
    const cfg: TillConfig = {
      tillId: brandTillId(venue.tillId),
      nodeId: brandNodeId(venue.nodeId),
      seriesId: brandSeriesId(venue.seriesIds[0]!),
      locationId: brandLocationId(venue.locationId),
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      tipsEnabled: false,
      simplifiedInvoiceLimit: null,
      orderFlow: "prepay",
    };

    // Drinks > Softs; Water sits in Drinks itself; Bread and Olives have no category. Two rates, and
    // prices whose VAT does not divide evenly, so a net summed some other way would drift a cent.
    const { products, managerSid } = await withTransaction(suite.db, async (tx) => {
      const menu = await createCatalogue(tx, { name: "Delicatessen" });
      const drinks = await createCategory(tx, { name: "Bebidas" });
      const softs = await createCategory(tx, {
        name: "Refrescos",
        parentId: drinks.id,
      });
      const product = async (
        name: string,
        categoryId: string | null,
        unitPrice: string,
        vatClass: "general" | "reduced",
      ) =>
        (
          await createProduct(tx, {
            catalogueId: menu.id,
            categoryId,
            name,
            pricingUnit: "each",
            unitPrice,
            vatClass,
          })
        ).id;
      const ids = {
        cola: await product("Cola", softs.id, "2.35", "general"),
        water: await product("Agua", drinks.id, "1.15", "reduced"),
        bread: await product("Pan", null, "0.95", "reduced"),
        olives: await product("Aceitunas", null, "3.33", "general"),
      };
      await assignCatalogueToLocation(tx, venue.locationId, menu.id);
      const [manager] = await tx
        .insert(persons)
        .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
        .returning({ id: persons.id });
      const session = await startManagementSession(tx, { personId: manager!.id });
      return { products: ids, managerSid: session.token };
    });
    const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, cfg));
    const line = (productId: string, quantity: string) => ({
      menuItemId: offers.offerFor(productId),
      quantity,
    });

    const clock = systemClock();
    const backend = new VerifactuBackend({
      clock,
      db: suite.db,
      environment: deploymentEnvironment(process.env),
      deploymentEnvironment: deploymentEnvironment(process.env),
      resolveClient: () => Promise.reject(new Error("a sale never submits inline")),
    });
    const deps = { db: suite.db, backend, clock };

    // Two walk-up sales, and an order parked and then paid.
    await recordTillSale(deps, cfg, {
      zoneId: offers.zoneId,
      lines: [line(products.cola, "3"), line(products.water, "1"), line(products.bread, "2")],
      tender: { method: "cash", amount: "50.00" },
    });
    await recordTillSale(deps, cfg, {
      zoneId: offers.zoneId,
      lines: [line(products.olives, "1"), line(products.water, "2")],
      tender: { method: "card", amount: "0" },
    });
    const parked = randomUUID();
    await withTransaction(suite.db, (tx) =>
      createOpenOrder(
        tx,
        cfg,
        parked,
        [line(products.cola, "1"), line(products.olives, "2")],
        null,
        {
          zoneId: offers.zoneId,
        },
      ),
    );
    await payWorkingOrder(deps, cfg, {
      id: parked,
      lines: [],
      tender: { method: "cash", amount: "50.00" },
    });

    // Every sale this venue filed, whichever business day the wall clock put it in.
    const today = currentBusinessDay({ timeZone: "Europe/Madrid", dayCutover: "05:00" });
    const from = shiftDay(today, -1);
    const to = shiftDay(today, 1);
    const { rows } = await suite.db.execute<{ total: string; n: string }>(
      sql`select cast(sum(total) as text) as total, cast(count(*) as text) as n from sales`,
    );
    expect(rows[0]!.n).toBe("3");
    const salesTotal = rawCentsToDecimal(rows[0]!.total);
    const vat = await withTransaction(suite.db, (tx) =>
      computeVatSummaryForPeriod(tx, {
        nodeId: cfg.nodeId,
        fromBusinessDay: from,
        toBusinessDay: to,
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      }),
    );
    expect(vat.grossTotal).toBe(salesTotal);
    expect(vat.byRate.map((r) => r.rate)).toEqual(["10.00", "21.00"]);

    const app = new Hono();
    const noopLog: Logger = () => {};
    mountReportApi(
      app,
      {
        db: suite.db,
        cfg: { nodeId: cfg.nodeId, locationId: cfg.locationId },
        venueLocale: LOCALE,
      },
      noopLog,
    );
    for (const mode of ["at_time_of_sale", "current"] as const) {
      const res = await app.request(
        `/management-api/reports/categories?from=${from}&to=${to}&mode=${mode}`,
        { headers: { cookie: `${MANAGEMENT_COOKIE}=${managerSid}` } },
      );
      expect(res.status).toBe(200);
      const report = (await res.json()) as CategoryReport;

      expect(report.gross).toBe(salesTotal);
      expect(report.net).toBe(vat.baseTotal);
      expect(report.grossComplete).toBe(true);
      // The fixture reached every kind of row it is meant to: a parent with its own product and a
      // child, and Uncategorised.
      expect(flatten(report.tree).map((n) => [n.kind, n.name, n.depth, n.direct.lines])).toEqual([
        ["category", "Bebidas", 0, 2],
        ["category", "Refrescos", 1, 2],
        ["uncategorised", "", 0, 3],
      ]);
    }
  });
});
