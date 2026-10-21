// Pinned before anything loads: a clock not replaced here would stamp the host's offset.
process.env.TZ = "Europe/Madrid";

import { createHash } from "node:crypto";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { saleLines, sales, workingOrders, type Database } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import {
  decodeRegistroRow,
  fromRegistroRow,
  type RegistroRow,
} from "@waitron/fiscal-verifactu/src/registro-row.js";
import type { TrustedClock } from "@waitron/fiscal";
import type { CountryPack, ReceiptLabels } from "@waitron/country";
import { serializeEnvio, type Cabecera, type RegistroAlta } from "@waitron/verifactu";
import { decimal } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { applyAdjustment } from "./adjustments-apply.js";
import type { AdjustmentArgs } from "./adjustments-apply.js";
import { formatReceipt } from "./receipt-ticket.js";
import { printedLines } from "./testing/decode-ticket.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import {
  billWith,
  inTx,
  lineIdOf,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import "./errors.js";

// A758-4: the words a receipt prints for a full comp are presentation only. The same bill is filed
// in two fresh databases, once with the shipped receipt words and once with every word replaced by
// a marker at its source, and the sale header, filed record, lines and alta XML are compared.

type CountryEs = {
  SPAIN: CountryPack;
  SPAIN_RECEIPT_LABELS: Record<"es-ES" | "ca-ES" | "gl-ES" | "eu-ES", ReceiptLabels>;
};

// The server does not depend on `@waitron/country-es`, so the specifier does not resolve from here;
// the pack is mocked by the file `@waitron/country-packs` loads it from.
const inject = vi.hoisted(() => ({ on: false }));
vi.mock("../../../packages/country-es/src/index.ts", async (importOriginal) => {
  const actual = await importOriginal<CountryEs>();
  const marked = new Map<string, object>();
  const markedSet = (set: object) =>
    new Proxy(set, {
      get: (target, key, receiver) =>
        inject.on && typeof key === "string" && Object.hasOwn(target, key)
          ? `MARK-${key}`
          : Reflect.get(target, key, receiver),
    });
  const labels = new Proxy(actual.SPAIN_RECEIPT_LABELS, {
    get: (target, key, receiver) => {
      const set = Reflect.get(target, key, receiver) as unknown;
      if (typeof key !== "string" || typeof set !== "object" || set === null) return set;
      let proxy = marked.get(key);
      if (proxy === undefined) {
        proxy = markedSet(set);
        marked.set(key, proxy);
      }
      return proxy;
    },
  });
  const spain = new Proxy(actual.SPAIN, {
    get: (target, key, receiver) =>
      key === "receiptLabels" ? labels : Reflect.get(target, key, receiver),
  });
  return { ...actual, SPAIN_RECEIPT_LABELS: labels, SPAIN: spain };
});

const ISSUED_AT = new Date("2026-09-25T11:30:00.000Z");
const MINUTE = 60_000;

const fixedClock: TrustedClock = {
  now: () => ({
    instant: ISSUED_AT,
    offsetMinutes: 120,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("full-comp.fiscal-identity.test: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

const columnsOf = (table: Parameters<typeof getTableColumns>[0], minted: readonly string[]) =>
  Object.values(getTableColumns(table))
    .map((column) => column.name)
    .filter((name) => !minted.includes(name));
/** Ids minted per database; a parent line is compared by its `line_no` instead. */
const MINTED_ID_COLUMNS = ["id", "sale_id", "parent_line_id"];
/** Catalogue rows' ids, minted per database like the line ids. */
const CATALOGUE_ID_COLUMNS = ["product_id", "parent_product_id", "menu_id", "menu_version_id"];
const LINE_COLUMNS = columnsOf(saleLines, MINTED_ID_COLUMNS);
/** The sale header's columns but the ids minted per database. */
const SALE_COLUMNS = columnsOf(sales, [
  "id",
  "node_id",
  "device_id",
  "series_id",
  "working_order_id",
]);
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

type Ask = Partial<Omit<AdjustmentArgs, "amount">> & {
  action: AdjustmentArgs["action"];
  amount?: string;
};

async function adjust(venue: AdjustmentVenue, billId: string, lineNo: number, ask: Ask) {
  const lineId = await lineIdOf(venue, billId, lineNo);
  return inTx(venue, async (tx) => {
    const [order] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    const { amount, ...rest } = ask;
    const args: AdjustmentArgs = {
      orderId: billId,
      expectedEdit: await readBillEditState(tx, billId),
      submissionId: crypto.randomUUID(),
      expectedRevision: order!.revision,
      lineId,
      reasonId: venue.reasonId.house,
      note: null,
      operatorId: venue.supervisorId,
      ...rest,
      ...(amount === undefined ? {} : { amount: decimal(amount) }),
    };
    return applyAdjustment(tx, venue.cfg, args, venue.venueLocale);
  });
}

/** One bill: Burger comped, Bottle's whole list price taken off, Bread 50% then €1.25 off, Water
 * paid. */
async function fileFullComps(db: Database) {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const at = (minutesBefore: number) =>
      vi.setSystemTime(new Date(ISSUED_AT.getTime() - minutesBefore * MINUTE));
    at(10);
    const venue = await provisionAdjustmentVenue(db, { clock: fixedClock });
    const { billId } = await billWith(venue, [
      { name: "Burger" },
      { name: "Bottle" },
      { name: "Bread" },
      { name: "Water" },
    ]);
    at(8);
    await adjust(venue, billId, 1, { action: "comp" });
    at(6);
    await adjust(venue, billId, 2, { action: "discount_amount", amount: "30.00" });
    at(4);
    await adjust(venue, billId, 3, { action: "discount_percent", percentBp: 5000 });
    at(2);
    await adjust(venue, billId, 3, { action: "discount_amount", amount: "1.25" });
    at(0);
    const ticket = await payWorkingOrder(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      { id: billId, tender: { method: "cash", amount: "2.00" }, lines: [] },
    );
    const printed = printedLines(
      formatReceipt({
        result: ticket,
        issuer: { venueName: "Ajustes SL", nif: "62000003F" },
        receipt: {},
        invoiceLocale: "es-ES",
        printer: { paperWidth: "80mm", resolution: "180dpi" },
      }),
    );
    const header = db.all<Record<string, unknown>>(
      sql.raw(`select ${SALE_COLUMNS.join(", ")} from sales`),
    );
    const registros = db.all<Record<string, unknown>>(sql`
      select ${sql.raw(REGISTRO_COLUMNS.join(", "))} from registros_facturacion`);
    const lines = db
      .all<Record<string, unknown>>(
        sql.raw(`select ${LINE_COLUMNS.map((c) => `l.${c}`).join(", ")},
          p.line_no as parent_line_no
          from sale_lines l left join sale_lines p on p.id = l.parent_line_id
          order by l.line_no`),
      )
      .map((row) => ({
        ...row,
        ...Object.fromEntries(CATALOGUE_ID_COLUMNS.map((column) => [column, row[column] !== null])),
        classification: JSON.parse(row.classification as string, (key, value: unknown) =>
          key === "id" ? undefined : value,
        ) as unknown,
      }));
    const [row] = db.all<RegistroRow>(sql`select * from registros_facturacion`);
    const cabecera: Cabecera = {
      ObligadoEmision: { NombreRazon: row!.nombre_razon_emisor, NIF: row!.id_emisor_factura },
    };
    const xml = serializeEnvio(cabecera, [
      { RegistroAlta: fromRegistroRow(decodeRegistroRow(row!)) as RegistroAlta },
    ]);
    return { header, registros, lines, xml, printed };
  } finally {
    vi.useRealTimers();
  }
}

const migrations = migrationOptionsFor(manifestSets(), null);
const shippedDb = useVenueDb({ migrations, timeoutMs: 60_000, resetPerTest: false });
const markedDb = useVenueDb({ migrations, timeoutMs: 60_000, resetPerTest: false });

let shipped: Awaited<ReturnType<typeof fileFullComps>>;
let marked: Awaited<ReturnType<typeof fileFullComps>>;

beforeAll(async () => {
  inject.on = false;
  shipped = await fileFullComps(shippedDb.db);
  inject.on = true;
  try {
    marked = await fileFullComps(markedDb.db);
  } finally {
    inject.on = false;
  }
}, 120_000);

describe("a full comp's filed record and the receipt's words", () => {
  it("files the same sale header, record, lines and alta XML whatever words the receipt prints", () => {
    // The control: the marker reached the printed receipt, and only in the marked run.
    expect(marked.printed.some((line) => line.startsWith("  MARK-"))).toBe(true);
    expect(shipped.printed.some((line) => line.includes("MARK-"))).toBe(false);

    expect(shipped.registros).toHaveLength(1);
    expect(shipped.header).toHaveLength(1);
    expect(marked.header).toEqual(shipped.header);
    expect(marked.registros).toEqual(shipped.registros);
    expect(marked.lines).toEqual(shipped.lines);
    expect(marked.xml).toBe(shipped.xml);
  });

  it("files the full comps' sale with these figures", () => {
    const row = shipped.registros[0]!;
    expect({
      tipo_factura: row.tipo_factura,
      num_serie_factura: row.num_serie_factura,
      importe_total: row.importe_total,
      cuota_total: row.cuota_total,
      desglose: JSON.parse(row.desglose as string) as unknown,
      descripcion_operacion: row.descripcion_operacion,
      fecha_hora_huso_gen_registro: row.fecha_hora_huso_gen_registro,
      huella: row.huella,
    }).toEqual({
      tipo_factura: "F2",
      num_serie_factura: "A/1",
      importe_total: "2.00",
      cuota_total: "0.35",
      desglose: [
        {
          ClaveRegimen: "01",
          CalificacionOperacion: "S1",
          BaseImponibleOimporteNoSujeto: "1.65",
          TipoImpositivo: "21.00",
          CuotaRepercutida: "0.35",
        },
        // Bread: a zero row at 10%, kept because rateLines does not drop empty groups.
        {
          ClaveRegimen: "01",
          CalificacionOperacion: "S1",
          BaseImponibleOimporteNoSujeto: "0.00",
          TipoImpositivo: "10.00",
          CuotaRepercutida: "0.00",
        },
      ],
      descripcion_operacion: "Restaurante",
      fecha_hora_huso_gen_registro: "2026-09-25T11:30:00.000Z",
      huella: "60A40E8701DAB1526AC551BEF1FF522BCD88CE3471DCECBBFB10828374748E94",
    });
    expect(createHash("sha256").update(shipped.xml).digest("hex")).toBe(
      "0f6468b1b3efb1b5acaee335371d486204adacac45a1b1ed64dbfee313c3517b",
    );
  });

  it("serialises no receipt word into the alta XML", async () => {
    const real = (await vi.importActual<CountryEs>("../../../packages/country-es/src/index.ts"))
      .SPAIN_RECEIPT_LABELS;
    for (const locale of ["es-ES", "ca-ES", "gl-ES", "eu-ES"] as const) {
      expect(shipped.xml).not.toContain(real[locale].discount);
    }
    for (const word of ["Invitación", "Invitació", "Gonbidapena", "100%", "MARK-"]) {
      expect(shipped.xml).not.toContain(word);
    }
    expect(shipped.xml).toContain("<sf:DescripcionOperacion>Restaurante</sf:DescripcionOperacion>");
  });
});
