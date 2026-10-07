// The host's offset is stamped on each sale and hashed into each record, so the zone is pinned
// before the seed runs.
process.env.TZ = "Europe/Madrid";

/**
 * A Spanish venue's practice sales, row for row, against a copy captured before the seed changed how
 * it gets its fiscal backend. A failing comparison means the Spanish records changed: that is a
 * stop, never a reason to re-record. `WAITRON_WRITE_GOLDEN=1` writes the copy; it was for the first
 * capture only.
 *
 * Generated ids are left out of every column list; a column a later migration adds is not compared.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedSales } from "./seed-sales.js";
import type { SeedSalesProduct } from "./seed-sales.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const FIXTURE = fileURLToPath(
  new URL("./testing/spanish-practice-sales.golden.json", import.meta.url),
);

const SALES_COLUMNS = [
  "source",
  "device_id",
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
  "operation_date",
  "counterparty_address",
  "taxpayer_domicile",
];

const SALE_LINES_COLUMNS = [
  "line_no",
  "name",
  "descriptions",
  "variant_name",
  "variant_descriptions",
  "variant_kitchen_name",
  "kitchen_name",
  "option_snapshots",
  "unit_name",
  "unit_precision",
  "quantity",
  "price_quantity",
  "unit_price",
  "vat_rate",
  "line_total",
  "category",
  "parent_line_id",
  "product_id",
  "parent_product_id",
  "menu_id",
  "menu_version_id",
  "line_gross",
  "classification",
  "corrects_line_id",
  "list_gross",
];

const TENDERS_COLUMNS = [
  "method",
  "amount",
  "cash_tendered",
  "tip_amount",
  "settled_at",
  "bill_payment_id",
];

const REGISTROS_COLUMNS = [
  "source",
  "device_id",
  "secuencia",
  "tipo_registro",
  "id_emisor_factura",
  "num_serie_factura",
  "fecha_expedicion_factura",
  "nombre_razon_emisor",
  "tipo_factura",
  "tipo_rectificativa",
  "facturas_rectificadas",
  "facturas_sustituidas",
  "importe_rectificacion",
  "destinatarios",
  "descripcion_operacion",
  "desglose",
  "cuota_total",
  "importe_total",
  "primer_registro",
  "anterior_id_emisor_factura",
  "anterior_num_serie_factura",
  "anterior_fecha_expedicion_factura",
  "anterior_huella",
  "sistema_informatico",
  "fecha_hora_huso_gen_registro",
  "offset_minutos",
  "tipo_huella",
  "huella",
  "entorno",
  "creado_en",
];

const ENVIOS_COLUMNS = [
  "estado",
  "intentos",
  "proximo_intento_en",
  "incidencia",
  "csv",
  "codigo_error",
  "mensaje_error",
  "enviado_en",
  "confirmado_en",
  "reconciled_resubmit_at",
];

// One product per Spanish VAT class, and one with no customer-facing name.
const PRODUCTS: SeedSalesProduct[] = [
  {
    id: "p-general",
    name: "Solomillo",
    customerName: { es: "Solomillo de ternera", en: "Beef tenderloin" },
    unitPrice: "18.50",
    vatClass: "general",
  },
  {
    id: "p-reduced",
    name: "Pan",
    customerName: { es: "Pan de la casa", en: "House bread" },
    unitPrice: "2.40",
    vatClass: "reduced",
  },
  {
    id: "p-super",
    name: "Leche",
    customerName: { es: "Leche entera", en: "Whole milk" },
    unitPrice: "1.30",
    vatClass: "super_reduced",
  },
  {
    id: "p-zero",
    name: "Agua",
    customerName: { es: "Agua mineral", en: "Mineral water" },
    unitPrice: "1.00",
    vatClass: "zero",
  },
  {
    id: "p-unnamed",
    name: "Croquetas",
    customerName: null,
    unitPrice: "7.25",
    vatClass: "reduced",
  },
];

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 81_000_000,
  nifFormat: "calculated",
  invoiceLocale: "es-ES",
});

function columns(alias: string, names: readonly string[]): SQL {
  return sql.join(
    names.map((name) => sql`${sql.identifier(alias)}.${sql.identifier(name)}`),
    sql`, `,
  );
}

async function readPracticeSales() {
  const db = suite.db;
  const { rows: saleRows } = await db.execute(
    sql`select ${columns("s", SALES_COLUMNS)} from sales s order by s.invoice_number`,
  );
  const { rows: lineRows } = await db.execute(
    sql`select ${columns("l", SALE_LINES_COLUMNS)} from sale_lines l
        join sales s on s.id = l.sale_id
        order by s.invoice_number, l.line_no`,
  );
  const { rows: tenderRows } = await db.execute(
    sql`select ${columns("t", TENDERS_COLUMNS)} from tenders t
        join sales s on s.id = t.sale_id
        order by s.invoice_number, t.method`,
  );
  const { rows: registroRows } = await db.execute(
    sql`select ${columns("r", REGISTROS_COLUMNS)} from registros_facturacion r
        order by r.secuencia`,
  );
  const { rows: envioRows } = await db.execute(
    sql`select ${columns("e", ENVIOS_COLUMNS)} from envios e
        join registros_facturacion r on r.id = e.registro_id
        order by r.secuencia`,
  );
  return {
    sales: saleRows,
    sale_lines: lineRows,
    tenders: tenderRows,
    registros_facturacion: registroRows,
    envios: envioRows,
  };
}

describe("seedSales on a Spanish venue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records the same practice sales, row for row, as the captured copy", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-01T09:30:00.000Z") });
    const venue = await provisionVenue();
    await seedSales(suite.db, {
      venue: { nodeId: venue.nodeId, seriesId: venue.seriesId },
      invoiceLocale: "es-ES",
      days: 3,
      products: PRODUCTS,
    });
    vi.useRealTimers();

    const actual = await readPracticeSales();
    if (process.env["WAITRON_WRITE_GOLDEN"] === "1") {
      writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const golden: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));

    expect(actual.registros_facturacion.length).toBeGreaterThan(0);
    expect(actual).toEqual(golden);
  });
});
