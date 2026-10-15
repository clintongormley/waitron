import { randomUUID } from "node:crypto";
import { getTableColumns, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { saleLines, sales, withTransaction, type Database } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import { registrosFacturacion, VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import type {} from "./till-config.js";
import { recordTillSaleOrchestration as recordTillSale } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";
import { deviceRequestCfg } from "./testing/session-device.js";

// A663 Part 2c: a sale line's unit price before any discount (`list_unit_price_gross`) is
// presentation data that no fiscal record reads. The same sale is filed in two fresh databases provisioned
// identically, once without the stored price and once with it.

const inject = vi.hoisted(() => ({ on: false }));
vi.mock("./receipt-lines.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./receipt-lines.js")>();
  return {
    ...actual,
    withReceiptListPrices: (...args: Parameters<typeof actual.withReceiptListPrices>) => {
      const lines = actual.withReceiptListPrices(...args);
      return inject.on
        ? lines.map((line, i) => (i === 0 ? { ...line, listUnitPriceGross: "9.00" } : line))
        : lines;
    },
  };
});

const LOCALE = "es-ES";
const NIF = "76900001F";
const ISSUED_AT = new Date("2026-09-25T11:30:00.000Z");
const WORKING_ORDER_ID = randomUUID();

const migrations = migrationOptionsFor(manifestSets(), null);
const withoutPrice = useVenueDb({ migrations, timeoutMs: 60_000 });
const withPrice = useVenueDb({ migrations, timeoutMs: 60_000 });

const fixedClock: TrustedClock = {
  now: () => ({
    instant: ISSUED_AT,
    offsetMinutes: 120,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("list-unit-price.fiscal-identity.test: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

const columnsOf = (table: Parameters<typeof getTableColumns>[0], minted: readonly string[]) =>
  Object.values(getTableColumns(table))
    .map((column) => column.name)
    .filter((name) => !minted.includes(name));
/** Ids minted per database, so they differ between the two runs; a parent line is compared by its
 * `line_no` instead. */
const MINTED_ID_COLUMNS = ["id", "sale_id", "parent_line_id"];
/** Catalogue rows' ids, minted per database like the line ids. */
const CATALOGUE_ID_COLUMNS = ["product_id", "parent_product_id", "menu_id", "menu_version_id"];
/** Every other `sale_lines` column but the new one, so a column added later is compared too. */
const OTHER_LINE_COLUMNS = columnsOf(saleLines, [...MINTED_ID_COLUMNS, "list_unit_price_gross"]);

/** The sale header's columns but the ids minted per database. */
const SALE_COLUMNS = columnsOf(sales, ["id", "node_id", "device_id", "series_id"]);
/** The fiscal record's columns but the ids minted per database, and `creado_en`, the wall-clock
 * time of the insert rather than the fixed clock's. */
const REGISTRO_COLUMNS = columnsOf(registrosFacturacion, [
  "id",
  "sale_id",
  "node_id",
  "device_id",
  "sif_id",
  "creado_en",
]);

async function fileOneSale(db: Database) {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: NIF,
        legalName: "Bar Clasificado SL",
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
    { db, modules: ALL_MODULES },
  );
  const cfg = await deviceRequestCfg(db, {
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  });
  const seeded = await withTransaction(db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Carta" });
    const bebidas = await createCategory(tx, { name: "Drinks" });
    const cocteles = await createCategory(tx, {
      name: "Cocktails",
      parentId: bebidas.id,
    });
    const anadidos = await createCategory(tx, { name: "Extras" });
    const product = (name: string, categoryId: string, unitPrice: string) =>
      createProduct(tx, {
        catalogueId: menu.id,
        categoryId,
        name: `${name} staff`,
        customerName: { es: `${name} cliente` },
        kitchenName: `${name} cocina`,
        pricingUnit: "each",
        unitPrice,
        vatClass: "general",
      });
    const negroni = await product("Negroni", cocteles.id, "9.00");
    const hielo = await product("Hielo", anadidos.id, "1.00");
    const extras = await createExtraList(
      tx,
      {
        name: "Extras",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 1,
        active: true,
        items: [{ productId: hielo.id, maxQuantity: 1, preselected: false, price: "0.35" }],
      },
      LOCALE,
    );
    await writeProductModifiers(tx, negroni.id, [{ kind: "extras", id: extras.id }]);
    await assignCatalogueToLocation(tx, venue.locationId, menu.id);
    return { negroni: negroni.id, hielo: hielo.id, extrasListId: extras.id };
  });
  const offers = await withTransaction(db, (tx) => offerProducts(tx, cfg));
  const backend = new VerifactuBackend({
    clock: fixedClock,
    db,
    environment: "preproduction",
    deploymentEnvironment: "preproduction",
    resolveClient: () => Promise.reject(new Error("resolveClient must never be called")),
  });

  await recordTillSale({ db, backend, clock: fixedClock }, cfg, {
    workingOrderId: WORKING_ORDER_ID,
    zoneId: offers.zoneId,
    lines: [
      {
        menuItemId: offers.offerFor(seeded.negroni),
        quantity: "2",
        extras: [
          { listId: seeded.extrasListId, picks: [{ productId: seeded.hielo, quantity: 1 }] },
        ],
      },
    ],
    tender: { method: "cash", amount: "20.00" },
  });

  const header = db.all<Record<string, unknown>>(
    sql.raw(`select ${SALE_COLUMNS.join(", ")} from sales`),
  );
  const lines = db.all<Record<string, unknown>>(
    sql.raw(`select ${OTHER_LINE_COLUMNS.map((c) => `l.${c}`).join(", ")},
      p.line_no as parent_line_no, l.list_unit_price_gross
      from sale_lines l left join sale_lines p on p.id = l.parent_line_id
      order by l.line_no`),
  );
  const registros = db.all<Record<string, unknown>>(sql`
    select ${sql.raw(REGISTRO_COLUMNS.join(", "))} from registros_facturacion`);
  return { header, lines, registros };
}

describe("the unit price before any discount and the fiscal record", () => {
  it("files the same fingerprint, sale header and other line columns with or without the stored list price", async () => {
    inject.on = false;
    const before = await fileOneSale(withoutPrice.db);
    inject.on = true;
    const after = await fileOneSale(withPrice.db);

    // The control: only the stored price tells the two runs apart.
    expect(before.lines[0]!.list_unit_price_gross).toBeNull();
    expect(after.lines[0]!.list_unit_price_gross).toBe(900);

    // Catalogue ids are minted per database, so they are compared as present or absent, and the
    // classification snapshot by its names.
    const withoutStoredPrice = (rows: Record<string, unknown>[]) =>
      rows.map((row) => ({
        ...row,
        ...Object.fromEntries(CATALOGUE_ID_COLUMNS.map((column) => [column, row[column] !== null])),
        classification: JSON.parse(row.classification as string, (key, value: unknown) =>
          key === "id" ? undefined : value,
        ) as unknown,
        list_unit_price_gross: undefined,
      }));
    expect(before.registros).toHaveLength(1);
    expect(after.registros).toEqual(before.registros);
    expect(after.header).toEqual(before.header);
    expect(withoutStoredPrice(after.lines)).toEqual(withoutStoredPrice(before.lines));
  });
});
