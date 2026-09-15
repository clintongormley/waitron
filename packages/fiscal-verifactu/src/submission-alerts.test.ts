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

/** One `registros_facturacion` row generated at `genTime`, returning its id. Minimal columns,
 * mirroring `seedSoldRegistro`. */
async function seedRegistro(db: Database, id: Identity, genTime: Date): Promise<string> {
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
  return registro.rows[0]!.id;
}

/** Insert one `envios` sidecar in `estado`, owned by `envioTenantId`, pointing at `registroId`. The
 * FK on `registro_id` is single-column (to `registros_facturacion.id`), so `envioTenantId` need not
 * match the registro's tenant — which is what lets the cross-tenant fixtures below exist. */
async function seedEnvio(
  db: Database,
  registroId: string,
  envioTenantId: string,
  estado: string,
): Promise<void> {
  await db.execute(sql`
    insert into envios (registro_id, tenant_id, estado)
    values (${registroId}, ${envioTenantId}, ${estado})
  `);
}

/** One `registros_facturacion` row generated at `genTime`, plus its 1:1 same-tenant `envios` sidecar
 * in `estado` — the two rows the source joins. */
async function seedWaiting(
  db: Database,
  id: Identity,
  genTime: Date,
  estado: string,
): Promise<void> {
  const registroId = await seedRegistro(db, id, genTime);
  await seedEnvio(db, registroId, id.tenantId, estado);
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

  // Exactly at each threshold, because the source compares with `>=`: a mutation to `>` would still
  // pass the 3h/5h/25h cases but must fail here — 4h is the warning boundary, 24h the error boundary.
  it("treats exactly 4 hours as a warning and exactly 24 hours as an error", async () => {
    const warn = await seedIdentity(pg.db);
    await seedWaiting(pg.db, warn, hoursAgo(4), "pendiente");
    await withTenant(pg.db, warn.tenantId, async (tx) => {
      await asAppUser(tx);
      const [a] = await fiscalSubmissionSource.read({
        tx,
        tenantId: warn.tenantId as never,
        now: NOW,
      });
      expect(a).toMatchObject({
        code: "fiscal.submission_delayed",
        severity: "warning",
        params: { count: 1, hours: 4 },
      });
    });

    const err = await seedIdentity(pg.db);
    await seedWaiting(pg.db, err, hoursAgo(24), "pendiente");
    await withTenant(pg.db, err.tenantId, async (tx) => {
      await asAppUser(tx);
      const [a] = await fiscalSubmissionSource.read({
        tx,
        tenantId: err.tenantId as never,
        now: NOW,
      });
      expect(a).toMatchObject({
        code: "fiscal.submission_delayed",
        severity: "error",
        params: { count: 1, hours: 24 },
      });
    });
  });

  // Partition, not mere absence: both tenants hold waiting rows, so dropping a tenant predicate would
  // inflate the queried tenant's `count` (and leak the other's detenido row) rather than read empty.
  it("counts only the queried tenant's rows when both tenants have data", async () => {
    const other = await seedIdentity(pg.db);
    await seedWaiting(pg.db, other, hoursAgo(25), "pendiente");
    await seedWaiting(pg.db, other, hoursAgo(25), "enviando");
    await seedWaiting(pg.db, other, hoursAgo(25), "detenido");

    const mine = await seedIdentity(pg.db);
    await seedWaiting(pg.db, mine, hoursAgo(25), "pendiente");
    await seedWaiting(pg.db, mine, hoursAgo(25), "enviando");

    await withTenant(pg.db, mine.tenantId, async (tx) => {
      await asAppUser(tx);
      const alerts = await fiscalSubmissionSource.read({
        tx,
        tenantId: mine.tenantId as never,
        now: NOW,
      });
      // Only mine's two waiting rows, never the other tenant's three.
      expect(alerts.find((a) => a.code === "fiscal.submission_delayed")).toMatchObject({
        severity: "error",
        params: { count: 2 },
      });
      // The other tenant's detenido row must not surface here.
      expect(alerts.find((a) => a.code === "fiscal.submission_stopped")).toBeUndefined();
    });
  });

  // The join predicate is a single-column FK (`envios.registro_id → registros_facturacion.id`) with no
  // tenant column, so the database PERMITS an `envios` row whose tenant differs from its registro's.
  // Both tenant predicates are therefore independently load-bearing: `envios.tenantId` against a row
  // whose registro is ours but whose envío is another tenant's, and `registrosFacturacion.tenantId`
  // against a row whose envío is ours but whose registro is another tenant's.
  it("excludes rows whose envío and registro belong to different tenants", async () => {
    const a = await seedIdentity(pg.db);
    const b = await seedIdentity(pg.db);

    // A's own waiting row — envío and registro both A. Only this may be counted.
    await seedWaiting(pg.db, a, hoursAgo(25), "pendiente");

    // Cross-tenant #1: registro is A's, envío is B's. Without `eq(envios.tenantId, A)` the query would
    // join this registro (A's) and count B's envío — inflating A's count and moving `since` to 30h.
    const registroOfA = await seedRegistro(pg.db, a, hoursAgo(30));
    await seedEnvio(pg.db, registroOfA, b.tenantId, "pendiente");

    // Cross-tenant #2: envío is A's, registro is B's. Without `eq(registrosFacturacion.tenantId, A)`
    // the query would match A's envío and join B's registro — inflating A's count and moving `since`
    // to 40h.
    const registroOfB = await seedRegistro(pg.db, b, hoursAgo(40));
    await seedEnvio(pg.db, registroOfB, a.tenantId, "pendiente");

    await withTenant(pg.db, a.tenantId, async (tx) => {
      await asAppUser(tx);
      const alerts = await fiscalSubmissionSource.read({
        tx,
        tenantId: a.tenantId as never,
        now: NOW,
      });
      // Only A's own row: count 1, and `since`/`hours` from its 25h age — neither cross-tenant row.
      expect(alerts.find((al) => al.code === "fiscal.submission_delayed")).toMatchObject({
        severity: "error",
        params: { count: 1, hours: 25 },
        since: hoursAgo(25).toISOString(),
      });
      expect(alerts.find((al) => al.code === "fiscal.submission_stopped")).toBeUndefined();
    });
  });
});
