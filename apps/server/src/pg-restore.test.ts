import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createPostgresDb } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { databaseUrl } from "@waitron/db/testing/postgres.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { type ExecFileFn, type PgRestoreRunner, pgRestoreWith } from "./pg-restore.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------------------------
// DI unit: the argv `pg_restore` is shelled out with. The real spawn (execFileAsync) is v8-ignored
// in pg-restore.ts and proven by the fiscal receipt below; here a fake exec records the argv so the
// SHAPE — --no-owner, --dbname <connstring>, the dump file last — is asserted without a binary.
// ---------------------------------------------------------------------------------------------
describe("pgRestoreWith", () => {
  it("shells out to pg_restore with --no-owner, --dbname <url>, the file last", async () => {
    const calls: { file: string; args: readonly string[]; options: { signal?: AbortSignal } }[] =
      [];
    const fakeExec: ExecFileFn = async (file, args, options) => {
      calls.push({ file, args, options });
    };
    const runner: PgRestoreRunner = pgRestoreWith(fakeExec);
    const signal = new AbortController().signal;

    await runner({
      databaseUrl: "postgresql://u:p@h:5432/fresh",
      inFile: "/tmp/waitron.dump",
      signal,
    });

    expect(calls).toEqual([
      {
        file: "pg_restore",
        args: ["--no-owner", "--dbname", "postgresql://u:p@h:5432/fresh", "/tmp/waitron.dump"],
        options: { signal },
      },
    ]);
  });

  it("threads no signal when the caller omits one", async () => {
    const calls: { options: { signal?: AbortSignal } }[] = [];
    const fakeExec: ExecFileFn = async (_file, _args, options) => {
      calls.push({ options });
    };
    await pgRestoreWith(fakeExec)({ databaseUrl: "postgresql://x/y", inFile: "/tmp/y.dump" });
    expect(calls[0]?.options).toEqual({ signal: undefined });
  });

  it("rejects when the underlying exec rejects (a failed restore surfaces)", async () => {
    const fakeExec: ExecFileFn = () => Promise.reject(new Error("pg_restore: exit 1"));
    await expect(
      pgRestoreWith(fakeExec)({ databaseUrl: "postgresql://x/y", inFile: "/tmp/y.dump" }),
    ).rejects.toThrow("pg_restore: exit 1");
  });
});

// ---------------------------------------------------------------------------------------------
// THE FISCAL RECEIPT (real container, docker exec).
//
// The load-bearing claim BR-3 rests on: `pg_restore` can reconstruct the IMMUTABLE fiscal ledger —
// `registros_facturacion`, which carries REVOKE ALL, a BEFORE UPDATE OR DELETE append-only trigger
// and a BEFORE TRUNCATE block trigger (packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql)
// — without the restore tripping those triggers. It is proven, not asserted (CLAUDE.md §5): seed one
// real fiscal row, `pg_dump --format=custom`, restore into a FRESH database, and assert the row
// landed, no `reject_mutation` (SQLSTATE WT001) fired anywhere in the restore output, and the two
// triggers are present on the restored table. The trigger is UPDATE/DELETE-only, so the COPY-insert
// a custom-format restore uses never fires it — this run is the receipt for that.
//
// pg_dump / pg_restore / createdb are pg18 CLIENT binaries the HOST does not carry, so — exactly like
// backup-sweep.test.ts's realPgDump smoke — they run INSIDE the shared container via `docker exec`
// (the server there listens on localhost:5432). The seed and the assertions run from the host over
// the published port, where a pg client is not needed. A skipped smoke proves nothing (CLAUDE.md §2),
// so this degrades to a LOUD skip only when the `docker` CLI or the container id genuinely cannot be
// resolved; it is never silently green.
// ---------------------------------------------------------------------------------------------

// Fixed literal ids for the one seeded tenant/till/node/SIF/sale/registro, mirroring
// packages/fiscal-verifactu/test/fixtures.ts's TENANT_A so a failing assertion's id is recognisable.
const F = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  locationId: "c0000000-0000-4000-8000-000000000002",
  tillId: "c0000000-0000-4000-8000-000000000003",
  seriesId: "c0000000-0000-4000-8000-000000000004",
  saleId: "c0000000-0000-4000-8000-000000000005",
  sifId: "c0000000-0000-4000-8000-000000000006",
  nodeId: "c0000000-0000-4000-8000-000000000008",
};

// Seeds exactly the FK closure `registros_facturacion` needs plus the row itself, as plain unscoped
// statements: `suite.admin` is the container's superuser, which bypasses row-level security outright
// (FKs are still enforced), so no `app.tenant_id` is set. The column shapes are
// packages/fiscal-verifactu/test/fixtures.ts's `seedTenantTillSif` + inmutabilidad.test.ts's
// `insertRegistro`, which is the current migrated schema (country/tax_id on tenants, vat_breakdown on
// sales, node-keyed series/sif/registro).
async function seedFiscalRegistro(admin: Database): Promise<void> {
  await admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${F.tenantId}, 'ES', '89890001K', 'Waitron SL')
  `);
  await admin.execute(sql`
    insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${F.locationId}, ${F.tenantId}, 'Local principal', array['es'], 'Venta en establecimiento')
  `);
  await admin.execute(sql`
    insert into tills (id, tenant_id, location_id, name)
    values (${F.tillId}, ${F.tenantId}, ${F.locationId}, 'Caja 1')
  `);
  await admin.execute(sql`
    insert into nodes (id, tenant_id, location_id, name)
    values (${F.nodeId}, ${F.tenantId}, ${F.locationId}, 'Node 1')
  `);
  await admin.execute(sql`
    insert into invoice_series (id, tenant_id, node_id, code)
    values (${F.seriesId}, ${F.tenantId}, ${F.nodeId}, 'A')
  `);
  await admin.execute(sql`
    insert into sales (
      id, tenant_id, till_id, node_id, series_id, invoice_number,
      issued_at, issued_offset_minutes,
      total, vat_breakdown,
      locale, invoice_locales, fiscal_backend, fiscal_state
    ) values (
      ${F.saleId}, ${F.tenantId}, ${F.tillId}, ${F.nodeId}, ${F.seriesId}, 1,
      '2026-07-20T19:20:30+01:00', 60,
      '0.00', '[]'::jsonb,
      'es', array['es'], 'verifactu', 'recorded'
    )
  `);
  await admin.execute(sql`
    insert into registro_sif (id, tenant_id, node_id, nif, id_sistema_informatico, numero_instalacion)
    values (${F.sifId}, ${F.tenantId}, ${F.nodeId}, '89890001K', 'WAITRON01', 1)
  `);
  await admin.execute(sql`
    insert into registros_facturacion (
      tenant_id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella
    ) values (
      ${F.tenantId}, ${F.tillId}, ${F.nodeId}, ${F.sifId}, ${F.saleId}, 1, 'alta',
      '89890001K', 'A/1', '2026-07-20', 'Waitron SL',
      'F2', 'Venta en establecimiento', '[]'::jsonb, '12.35', '123.45',
      true, '{}'::jsonb,
      '2026-07-20T19:20:30+01:00', 60, '01', repeat('F', 64)
    )
  `);
}

const suite = useTemplateDb({ template: "manifest" });

describe("realPgRestore restores the immutable fiscal ledger (real container, docker exec)", () => {
  it("restores registros_facturacion + its append-only/TRUNCATE triggers without tripping WT001", async () => {
    // 1. Seed one real fiscal row into the clone (as the container superuser, over the host port).
    await seedFiscalRegistro(suite.admin);

    const uri = new URL(suite.pg.uri);

    // 2. Locate the shared container by its published host port + the harness label.
    let containerId: string;
    try {
      const { stdout } = await execFileAsync("docker", [
        "ps",
        "--filter",
        `publish=${uri.port}`,
        "--filter",
        "label=com.waitron.reapable",
        "--format",
        "{{.ID}}",
      ]);
      containerId = stdout.trim().split("\n")[0]!.trim();
    } catch (err) {
      console.warn(
        `[pg-restore fiscal receipt SKIPPED] could not run \`docker ps\` to locate the test container: ${String(err)}. ` +
          `realPgRestore restoring the immutable fiscal ledger is UNPROVEN in this run.`,
      );
      return;
    }
    if (containerId === "") {
      console.warn(
        `[pg-restore fiscal receipt SKIPPED] no running container published on port ${uri.port} with label ` +
          `com.waitron.reapable. realPgRestore restoring the immutable fiscal ledger is UNPROVEN in this run.`,
      );
      return;
    }

    // Inside the container the server listens on localhost:5432; creds come from the suite uri.
    const cloneDb = uri.pathname.replace(/^\//, "");
    const internal = (db: string) =>
      `postgresql://${uri.username}:${uri.password}@localhost:5432/${db}`;
    const dumpFile = `/tmp/waitron-restore-smoke-${process.pid}.dump`;
    // A fresh, empty target database name unique to this process. Lowercased pid keeps it a valid
    // unquoted identifier for the `create database` utility statement below.
    const freshDb = `restore_smoke_${process.pid}`;

    try {
      // 3. pg_dump --format=custom the clone (the exact custom format realPgDump produces).
      await execFileAsync("docker", [
        "exec",
        containerId,
        "pg_dump",
        "--format=custom",
        "--file",
        dumpFile,
        internal(cloneDb),
      ]);

      // 4. Create a FRESH empty database in the container.
      await execFileAsync("docker", [
        "exec",
        containerId,
        "psql",
        internal("postgres"),
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `create database ${freshDb}`,
      ]);

      // 5. pg_restore --no-owner into the fresh database — the exact argv realPgRestore builds.
      const { stdout, stderr } = await execFileAsync("docker", [
        "exec",
        containerId,
        "pg_restore",
        "--no-owner",
        "--dbname",
        internal(freshDb),
        dumpFile,
      ]);
      const restoreOutput = `${stdout}\n${stderr}`;

      // 6a. The immutability guard NEVER fired during the restore. `reject_mutation()` raises SQLSTATE
      // WT001 (0001_registros_inmutables.sql); its absence is the direct proof the COPY-insert did not
      // trip the append-only trigger, and pg_restore prints ignored errors here rather than throwing.
      expect(restoreOutput).not.toContain("WT001");
      expect(restoreOutput).not.toContain("reject_mutation");
      expect(restoreOutput).not.toMatch(/errors ignored on restore/i);

      // 6b. Assert the restored state from the host, connecting to the FRESH database.
      const fresh = await createPostgresDb(databaseUrl(suite.pg.uri, freshDb));
      try {
        // The fiscal row LANDED — had the COPY tripped the trigger, this would be 0.
        const rows = await fresh.execute<{ n: number }>(
          sql`select count(*)::int as n from registros_facturacion`,
        );
        expect(rows.rows[0]?.n).toBe(1);

        // And it is the row we seeded (its huella survived the round trip intact).
        const huella = await fresh.execute<{ huella: string }>(
          sql`select huella from registros_facturacion`,
        );
        expect(huella.rows[0]?.huella).toBe("F".repeat(64));

        // The append-only + TRUNCATE triggers are present on the RESTORED table — the ledger is
        // immutable again in the recovered database, not merely populated.
        const triggers = await fresh.execute<{ tgname: string }>(sql`
          select tgname from pg_trigger
          where tgrelid = 'registros_facturacion'::regclass and not tgisinternal
          order by tgname
        `);
        const names = triggers.rows.map((t) => t.tgname);
        expect(names).toContain("registros_facturacion_enforce_immutability");
        expect(names).toContain("registros_facturacion_block_truncate");
      } finally {
        await fresh.close();
      }
    } finally {
      // Best-effort cleanup: drop the fresh database and remove the in-container dump file. The clone
      // itself is dropped by useTemplateDb's afterAll.
      await execFileAsync("docker", [
        "exec",
        containerId,
        "psql",
        internal("postgres"),
        "-c",
        `drop database if exists ${freshDb}`,
      ]).catch(() => {});
      await execFileAsync("docker", ["exec", containerId, "rm", "-f", dumpFile]).catch(() => {});
    }
  }, 180_000);
});
