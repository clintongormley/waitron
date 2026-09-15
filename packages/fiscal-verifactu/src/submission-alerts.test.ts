import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

// Reads run as `app_user`, the role a real alert read holds — `asAppUser(tx)` before every read, so
// the test proves the source works with the grants `app_user` actually has (SELECT on
// `registros_facturacion` and `envios`) rather than the fixture owner's wider privileges.
const pg = usePgliteDb({ migrations: TEST_MIGRATIONS });

const NOW = new Date("2026-09-15T12:00:00Z");
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * 3_600_000);

interface Identity {
  tenantId: string;
  tillId: string;
  nodeId: string;
  sifId: string;
  nif: string;
}

// Each test mints its own tenant/SIF identity; the source scopes by tenant, so one test's rows are
// invisible to another reading a different tenant — the same shared-`pg.db` isolation convention the
// rest of this package's PGlite suites use.
async function seedIdentity(db: Database): Promise<Identity> {
  const { tenantId, tillId, nodeId } = await seedTenantWithSif(db);
  const { rows } = await db.execute<{ id: string; nif: string }>(sql`
    select id, nif from registro_sif where tenant_id = ${tenantId} and node_id = ${nodeId}
  `);
  return { tenantId, tillId, nodeId, sifId: rows[0]!.id, nif: rows[0]!.nif };
}

// Distinct per row: `secuencia`, `num_serie_factura` and the sale's `invoice_number` are all unique
// per identity, so one monotonic counter keeps every seeded registro/envío collision-free.
let seq = 0;

/** One `registros_facturacion` row generated at `genTime`, plus its 1:1 `envios` sidecar in
 * `estado` — the two rows the source joins. Minimal columns, mirroring `seedSoldRegistro`. */
async function seedWaiting(
  db: Database,
  id: Identity,
  genTime: Date,
  estado: string,
): Promise<void> {
  seq += 1;
  const s = seq;
  const series = await db.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, node_id, code)
    values (${id.tenantId}, ${id.nodeId}, ${"W" + String(s)})
    returning id
  `);
  const sale = await db.execute<{ id: string }>(sql`
    insert into sales (
      tenant_id, till_id, node_id, series_id, invoice_number,
      issued_at, issued_offset_minutes, total, vat_breakdown,
      locale, invoice_locales, fiscal_backend, fiscal_state
    ) values (
      ${id.tenantId}, ${id.tillId}, ${id.nodeId}, ${series.rows[0]!.id}, ${s},
      '2026-07-20T19:20:30+01:00', 60, '0.00', '[]'::jsonb,
      'es', array['es'], 'verifactu', 'recorded'
    ) returning id
  `);
  const huella = String(s).padStart(64, "0");
  const registro = await db.execute<{ id: string }>(sql`
    insert into registros_facturacion (
      tenant_id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella
    ) values (
      ${id.tenantId}, ${id.tillId}, ${id.nodeId}, ${id.sifId}, ${sale.rows[0]!.id}, ${s}, 'alta',
      ${id.nif}, ${"W" + String(s) + "/1"}, '2026-07-20', 'Waitron SL',
      true, '{}'::jsonb,
      ${genTime.toISOString()}, 60, '01', ${huella}
    ) returning id
  `);
  await db.execute(sql`
    insert into envios (registro_id, tenant_id, estado)
    values (${registro.rows[0]!.id}, ${id.tenantId}, ${estado})
  `);
}

describe("fiscalSubmissionSource", () => {
  it("is silent when the oldest waiting record is 3 hours old", async () => {
    const id = await seedIdentity(pg.db);
    await seedWaiting(pg.db, id, hoursAgo(3), "pendiente");
    await withTenant(pg.db, id.tenantId, async (tx) => {
      await asAppUser(tx);
      expect(
        await fiscalSubmissionSource.read({ tx, tenantId: id.tenantId as never, now: NOW }),
      ).toEqual([]);
    });
  });

  it("warns at 5 hours and errors at 25 hours, with count and hours", async () => {
    const id = await seedIdentity(pg.db);
    await seedWaiting(pg.db, id, hoursAgo(5), "enviando");
    await withTenant(pg.db, id.tenantId, async (tx) => {
      await asAppUser(tx);
      const [a] = await fiscalSubmissionSource.read({
        tx,
        tenantId: id.tenantId as never,
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
    await withTenant(pg.db, id.tenantId, async (tx) => {
      await asAppUser(tx);
      const [a] = await fiscalSubmissionSource.read({
        tx,
        tenantId: id.tenantId as never,
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
    await withTenant(pg.db, id.tenantId, async (tx) => {
      await asAppUser(tx);
      const alerts = await fiscalSubmissionSource.read({
        tx,
        tenantId: id.tenantId as never,
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

  it("scopes to the tenant", async () => {
    const other = await seedIdentity(pg.db);
    await seedWaiting(pg.db, other, hoursAgo(25), "pendiente");
    const mine = await seedIdentity(pg.db);
    await withTenant(pg.db, mine.tenantId, async (tx) => {
      await asAppUser(tx);
      expect(
        await fiscalSubmissionSource.read({ tx, tenantId: mine.tenantId as never, now: NOW }),
      ).toEqual([]);
    });
  });
});
