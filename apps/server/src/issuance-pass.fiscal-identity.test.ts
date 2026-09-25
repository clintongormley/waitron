import { randomUUID } from "node:crypto";
import { getTableColumns, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { saleLines, withTransaction, type Database } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createLabel,
  createProduct,
  setProductLabels,
  writeProductModifiers,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { recordTillSale } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";

// Review Focus 5 of the sales classification plan: the issuance pass adds to the new `sale_lines`
// columns and changes nothing that was filed before it. The same sale is filed in two fresh
// databases provisioned identically, once with the pass bypassed and once through it.

const bypass = vi.hoisted(() => ({ on: false }));
vi.mock("./issuance-pass.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./issuance-pass.js")>();
  return {
    issuancePass: (...args: Parameters<typeof actual.issuancePass>) =>
      bypass.on ? Promise.resolve(args[3].priced) : actual.issuancePass(...args),
  };
});

const LOCALE = "es-ES";
const NIF = "76900001K";
const ISSUED_AT = new Date("2026-09-25T11:30:00.000Z");
const WORKING_ORDER_ID = randomUUID();

const migrations = migrationOptionsFor(manifestSets(), null);
const bypassed = useVenueDb({ migrations, timeoutMs: 60_000 });
const issued = useVenueDb({ migrations, timeoutMs: 60_000 });

const fixedClock: TrustedClock = {
  now: () => ({
    instant: ISSUED_AT,
    offsetMinutes: 120,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("issuance-pass.fiscal-identity.test: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

/** The sale-line classification columns (spec §4), left out of the comparison. */
const CLASSIFICATION_COLUMNS = [
  "product_id",
  "parent_product_id",
  "menu_id",
  "menu_version_id",
  "line_gross",
  "classification",
];
/** Ids minted per database, so they differ between the two runs; a parent line is compared by its
 * `line_no` instead. */
const MINTED_ID_COLUMNS = ["id", "sale_id", "parent_line_id"];
/** Every other `sale_lines` column, so a column added later is compared too. */
const PRE_EXISTING_LINE_COLUMNS = Object.values(getTableColumns(saleLines))
  .map((column) => column.name)
  .filter((name) => !CLASSIFICATION_COLUMNS.includes(name) && !MINTED_ID_COLUMNS.includes(name));

/** The sale header's columns that name no row minted by provisioning. */
const SALE_COLUMNS = [
  "invoice_number",
  "issued_at",
  "issued_offset_minutes",
  "total",
  "vat_breakdown",
  "locale",
  "invoice_locales",
  "fiscal_backend",
  "fiscal_state",
  "corrects_sale_id",
  "counterparty_tax_id",
  "counterparty_legal_name",
  "counterparty_country_code",
  "authorized_by",
  "operator_id",
  "working_order_id",
];

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
    { db, modules: ALL_MODULES },
  );
  const cfg: TillConfig = {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const seeded = await withTransaction(db, async (tx) => {
    const menu = await createCatalogue(tx, { name: "Carta" });
    const bebidas = await createCategory(tx, { name: { es: "Bebidas", en: "Drinks" } });
    const cocteles = await createCategory(tx, {
      name: { es: "Cócteles", en: "Cocktails" },
      parentId: bebidas.id,
    });
    const anadidos = await createCategory(tx, { name: { es: "Añadidos", en: "Extras" } });
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
    await setProductLabels(tx, negroni.id, [(await createLabel(tx, "Happy hour drinks")).id]);
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
    sql.raw(`select ${PRE_EXISTING_LINE_COLUMNS.map((c) => `l.${c}`).join(", ")},
      p.line_no as parent_line_no, l.classification
      from sale_lines l left join sale_lines p on p.id = l.parent_line_id
      order by l.line_no`),
  );
  const registros = db.all<Record<string, unknown>>(sql`
    select huella, anterior_huella, importe_total, cuota_total, desglose, fecha_hora_huso_gen_registro
    from registros_facturacion`);
  return { header, lines, registros };
}

describe("the issuance pass and the fiscal record", () => {
  it("files the same fingerprint, sale header and pre-existing line columns with or without it", async () => {
    bypass.on = true;
    const before = await fileOneSale(bypassed.db);
    bypass.on = false;
    const after = await fileOneSale(issued.db);

    // The control: only the pass tells the two runs apart.
    expect(before.lines.map((line) => line.classification)).toEqual([null, null]);
    expect(after.lines.every((line) => typeof line.classification === "string")).toBe(true);

    const withoutSnapshot = (rows: Record<string, unknown>[]) =>
      rows.map((row) => ({ ...row, classification: undefined }));
    expect(before.registros).toHaveLength(1);
    expect(after.registros).toEqual(before.registros);
    expect(after.header).toEqual(before.header);
    expect(withoutSnapshot(after.lines)).toEqual(withoutSnapshot(before.lines));
  });
});
