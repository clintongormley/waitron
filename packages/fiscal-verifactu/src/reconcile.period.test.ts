import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { invoiceSeries, sales, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { currentSif } from "./registro-sif.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { reconcile, type ReconcileDeps } from "./reconcile.js";

/**
 * Which calendar month `reconcile` audits, and what form the date reaches an incident in.
 *
 * Its own file because every seeding helper in `../test/drain-fixtures.ts` stamps a July 2026
 * expedition date, and a period filter tested against rows that all share a month would pass
 * whichever month it selected. This file seeds each row's date itself.
 *
 * A `pendiente` row AEAT has no trace of is in flight rather than a mismatch, so with an empty
 * authority `checked` counts exactly the rows `rowsForPeriod` selected.
 */

const CLOCK_INSTANT = steadyClock.now().instant;

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

let venue: Awaited<ReturnType<typeof seedTenantWithSif>>;
let nif: string;
let sifId: string;
let sequence: number;

beforeEach(async () => {
  venue = await seedTenantWithSif(suite.db);
  const sif = await suite.db.transaction((tx) => currentSif(tx, venue.nodeId));
  nif = sif.nif;
  sifId = sif.id;
  sequence = 0;
});

/**
 * One alta registro stamped with `fecha` (the stored `YYYY-MM-DD` form), plus its `envios` sidecar.
 * Not routed through `recordSale`, which derives the expedition date from the clock.
 */
async function seedAltaOn(db: Database, fecha: string): Promise<string> {
  sequence += 1;
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId: venue.nodeId, code: `P${String(sequence)}` })
    .returning({ id: invoiceSeries.id });
  const [sale] = await db
    .insert(sales)
    .values({
      tillId: venue.tillId,
      nodeId: venue.nodeId,
      seriesId: series!.id,
      invoiceNumber: sequence,
      issuedAt: `${fecha}T19:20:30+01:00`,
      issuedOffsetMinutes: 60,
      total: 0,
      vatBreakdown: [],
      locale: "es",
      invoiceLocales: ["es"],
      fiscalBackend: "verifactu",
      fiscalState: "recorded",
    })
    .returning({ id: sales.id });
  const [registro] = await db
    .insert(registrosFacturacion)
    .values({
      tillId: venue.tillId,
      nodeId: venue.nodeId,
      sifId,
      saleId: sale!.id,
      secuencia: sequence,
      tipoRegistro: "alta",
      idEmisorFactura: nif,
      numSerieFactura: `P${String(sequence)}/1`,
      fechaExpedicionFactura: fecha,
      nombreRazonEmisor: "Waitron SL",
      tipoFactura: "F2",
      descripcionOperacion: "Venta en establecimiento",
      desglose: [],
      cuotaTotal: "2.10",
      importeTotal: "12.10",
      primerRegistro: true,
      sistemaInformatico: {},
      fechaHoraHusoGenRegistro: new Date(`${fecha}T19:20:30+01:00`),
      offsetMinutos: 60,
      tipoHuella: "01",
      huella: String(sequence).padStart(64, "0"),
      entorno: "production",
    })
    .returning({ id: registrosFacturacion.id });
  await db.insert(envios).values({ registroId: registro!.id });
  return registro!.id;
}

/** An AEAT that holds nothing at all, so every seeded row reads as absent. */
function depsAgainstEmptyAeat(): ReconcileDeps {
  const aeat = createFakeAeat({ serverNow: new Date("2027-02-01T00:00:00Z") });
  return {
    db: suite.db,
    resolveClient: staticResolver(aeat.client()),
    clock: steadyClock,
  };
}

/** How many registros the engine's own prefix comparison matches, asked directly — the control
 * that says a period expression CAN select nothing, so a `checked: 0` above is a real answer. */
async function rowsMatchingPrefix(prefix: string): Promise<number> {
  const { rows } = await suite.db.execute<{ count: number }>(
    sql`select count(*) as count from registros_facturacion
        where substr(fecha_expedicion_factura, 1, 7) = ${prefix}`,
  );
  return rows[0]!.count;
}

describe("reconcile — which calendar month the audit selects", () => {
  it("separates a December period from the January that follows it", async () => {
    await seedAltaOn(suite.db, "2026-12-31");
    await seedAltaOn(suite.db, "2027-01-01");

    // Each period finds its own row and only its own.
    expect((await reconcile(depsAgainstEmptyAeat(), { year: "2026", month: "12" })).checked).toBe(
      1,
    );
    expect((await reconcile(depsAgainstEmptyAeat(), { year: "2027", month: "01" })).checked).toBe(
      1,
    );

    // The control in the other direction, and the one that matters: a filter that compared the
    // MONTH alone would answer 1 here, because January 2027 is in the table.
    expect((await reconcile(depsAgainstEmptyAeat(), { year: "2026", month: "01" })).checked).toBe(
      0,
    );
    // …and a filter that compared the YEAR alone would answer 1 here, because December 2026 is.
    expect((await reconcile(depsAgainstEmptyAeat(), { year: "2026", month: "11" })).checked).toBe(
      0,
    );
  });

  it("finds a single-digit month through the caller's unpadded spelling and the padded one alike", async () => {
    await seedAltaOn(suite.db, "2026-07-05");

    // The stored month is zero-padded, so the unpadded caller spelling only works because
    // `reconcile` normalizes it before building the filter.
    expect((await reconcile(depsAgainstEmptyAeat(), { year: "2026", month: "07" })).checked).toBe(
      1,
    );
    expect((await reconcile(depsAgainstEmptyAeat(), { year: "2026", month: "7" })).checked).toBe(1);

    // The control that says the normalization is what did that work, asked of the engine directly:
    // the unpadded prefix matches nothing, the padded one matches the row.
    expect(await rowsMatchingPrefix("2026-7")).toBe(0);
    expect(await rowsMatchingPrefix("2026-07")).toBe(1);
  });

  it("finds a January row through a two-digit month that starts with a zero", async () => {
    await seedAltaOn(suite.db, "2026-01-09");
    expect((await reconcile(depsAgainstEmptyAeat(), { year: "2026", month: "01" })).checked).toBe(
      1,
    );
    expect((await reconcile(depsAgainstEmptyAeat(), { year: "2026", month: "1" })).checked).toBe(1);
  });
});

describe("reconcile — the date form an incident carries", () => {
  it("reports the expedition date in AEAT's own DD-MM-YYYY, not the stored YYYY-MM-DD", async () => {
    const registroId = await seedAltaOn(suite.db, "2026-07-05");
    // Already re-submitted once by an earlier sweep, so this `noTrace` escalates to an incident
    // carrying the `IDFactura` triple.
    await suite.db.execute(sql`
      update envios set estado = 'aceptado', reconciled_resubmit_at = ${CLOCK_INSTANT.toISOString()}
      where registro_id = ${registroId}
    `);

    const result = await reconcile(depsAgainstEmptyAeat(), { year: "2026", month: "07" });
    expect(result.noTrace.map((m) => m.recordId)).toEqual([registroId]);
    expect(result.incidentsRaised).toBe(1);

    const { rows } = await suite.db.execute<{ code: string; params: unknown }>(
      sql`select code, params from incidents`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe("fiscal.reconcile_no_trace");
    const params = (
      typeof rows[0]!.params === "string"
        ? (JSON.parse(rows[0]!.params) as Record<string, unknown>)
        : (rows[0]!.params as Record<string, unknown>)
    ).fechaExpedicionFactura;
    // AEAT's own `DD-MM-YYYY`, not our storage spelling.
    expect(params).toBe("05-07-2026");
  });
});
