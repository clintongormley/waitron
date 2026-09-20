import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

// Reads run as `app_user`, the role a real alert read holds — `asAppUser(tx)` before every read, so
// the test proves the source works with the grants `app_user` actually has (SELECT on
// `registros_facturacion` and `envios`) rather than the fixture owner's wider privileges.
const pg = useVenueDb({ migrations: TEST_MIGRATIONS });

const NOW = new Date("2026-09-15T12:00:00Z");
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * 3_600_000);

interface Identity {
  tillId: string;
  nodeId: string;
  sifId: string;
  nif: string;
}

// Each test mints its own node/SIF identity; the suite empties every data table after each test,
// so one test's rows never reach another's read.
async function seedIdentity(db: Database): Promise<Identity> {
  const { tillId, nodeId } = await seedTenantWithSif(db);
  const { rows } = await db.execute<{ id: string; nif: string }>(sql`
    select id, nif from registro_sif where node_id = ${nodeId}
  `);
  return { tillId, nodeId, sifId: rows[0]!.id, nif: rows[0]!.nif };
}

// Distinct per row: `secuencia`, `num_serie_factura` and the sale's `invoice_number` are all unique
// per identity, so one monotonic counter keeps every seeded registro/envío collision-free.
let seq = 0;

/** One `registros_facturacion` row generated at `genTime`, returning its id. Minimal columns,
 * mirroring `seedSoldRegistro`. */
async function seedRegistro(db: Database, id: Identity, genTime: Date): Promise<string> {
  seq += 1;
  const s = seq;
  const series = await db.execute<{ id: string }>(sql`
    insert into invoice_series (node_id, code) values (${id.nodeId}, ${"W" + String(s)})
    returning id
  `);
  const sale = await db.execute<{ id: string }>(sql`
    insert into sales (till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state) values (${id.tillId}, ${id.nodeId}, ${series.rows[0]!.id}, ${s},
      '2026-07-20T19:20:30+01:00', 60, '0.00', '[]'::jsonb,
      'es', array['es'], 'verifactu', 'recorded'
    ) returning id
  `);
  const huella = String(s).padStart(64, "0");
  const registro = await db.execute<{ id: string }>(sql`
    insert into registros_facturacion (
      till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella
    ) values (${id.tillId}, ${id.nodeId}, ${id.sifId}, ${sale.rows[0]!.id}, ${s}, 'alta',
      ${id.nif}, ${"W" + String(s) + "/1"}, '2026-07-20', 'Waitron SL',
      true, '{}'::jsonb,
      ${genTime.toISOString()}, 60, '01', ${huella}
    ) returning id
  `);
  return registro.rows[0]!.id;
}

/** One `registros_facturacion` row generated at `genTime`, plus its 1:1 `envios` sidecar in
 * `estado` — the two rows the source joins. */
async function seedWaiting(
  db: Database,
  id: Identity,
  genTime: Date,
  estado: string,
): Promise<void> {
  const registroId = await seedRegistro(db, id, genTime);
  await db.execute(sql`
    insert into envios (registro_id, estado)
    values (${registroId}, ${estado})
  `);
}

describe("fiscalSubmissionSource", () => {
  it("is silent when the oldest waiting record is 3 hours old", async () => {
    const id = await seedIdentity(pg.db);
    await seedWaiting(pg.db, id, hoursAgo(3), "pendiente");
    await withTransaction(pg.db, async (tx) => {
      await asAppUser(tx);
      expect(await fiscalSubmissionSource.read({ tx, now: NOW })).toEqual([]);
    });
  });

  it("warns at 5 hours and errors at 25 hours, with count and hours", async () => {
    const id = await seedIdentity(pg.db);
    await seedWaiting(pg.db, id, hoursAgo(5), "enviando");
    await withTransaction(pg.db, async (tx) => {
      await asAppUser(tx);
      const [a] = await fiscalSubmissionSource.read({
        tx,
        now: NOW,
      });
      expect(a).toMatchObject({
        code: "fiscal.submission_delayed",
        severity: "warning",
        params: { count: 1, hours: 5 },
        since: hoursAgo(5).toISOString(),
      });
    });

    await seedWaiting(pg.db, id, hoursAgo(25), "pendiente");
    await withTransaction(pg.db, async (tx) => {
      await asAppUser(tx);
      const [a] = await fiscalSubmissionSource.read({
        tx,
        now: NOW,
      });
      expect(a).toMatchObject({
        code: "fiscal.submission_delayed",
        severity: "error",
        params: { count: 2, hours: 25 },
        since: hoursAgo(25).toISOString(),
      });
    });
  });

  it("errors on a detenido record", async () => {
    const id = await seedIdentity(pg.db);
    await seedWaiting(pg.db, id, hoursAgo(1), "detenido");
    await withTransaction(pg.db, async (tx) => {
      await asAppUser(tx);
      const alerts = await fiscalSubmissionSource.read({
        tx,
        now: NOW,
      });
      const stopped = alerts.find((a) => a.code === "fiscal.submission_stopped");
      expect(stopped).toMatchObject({
        severity: "error",
        params: { count: 1 },
        since: hoursAgo(1).toISOString(),
      });
    });
  });

  // Exactly at each threshold, because the source compares with `>=`: a mutation to `>` would still
  // pass the 3h/5h/25h cases but must fail here — 4h is the warning boundary, 24h the error boundary.
  it("treats exactly 4 hours as a warning and exactly 24 hours as an error", async () => {
    const warn = await seedIdentity(pg.db);
    await seedWaiting(pg.db, warn, hoursAgo(4), "pendiente");
    await withTransaction(pg.db, async (tx) => {
      await asAppUser(tx);
      const [a] = await fiscalSubmissionSource.read({
        tx,
        now: NOW,
      });
      expect(a).toMatchObject({
        code: "fiscal.submission_delayed",
        severity: "warning",
        params: { count: 1, hours: 4 },
      });
    });

    // A second, older record: the oldest is now exactly 24 hours, so the alert becomes an error.
    await seedWaiting(pg.db, warn, hoursAgo(24), "pendiente");
    await withTransaction(pg.db, async (tx) => {
      await asAppUser(tx);
      const [a] = await fiscalSubmissionSource.read({
        tx,
        now: NOW,
      });
      expect(a).toMatchObject({
        code: "fiscal.submission_delayed",
        severity: "error",
        params: { count: 2, hours: 24 },
      });
    });
  });
});
