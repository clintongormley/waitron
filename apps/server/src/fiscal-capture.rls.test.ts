import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { insertFiscalRegistro, seedFiscalParents } from "./testing/fiscal-fixtures.js";

// Real Postgres, not PGlite: this suite proves the six fiscal sync_capture triggers (SP-3a,
// packages/fiscal-verifactu/drizzle/0014_fiscal_sync_capture.sql) fire under the genuine
// non-superuser deployment role — capturing byte-identically into sync_log, honouring the
// app.sync_apply echo guard, and, the two fiscal-specific facts:
//   (1) capture works on `registros_facturacion` DESPITE its `REVOKE ALL` — the writer holds
//       INSERT on the table (0001) and INSERT on sync_log (sync 0000), and sync_capture() is NOT
//       SECURITY DEFINER, so it runs as the writer and needs nothing more; and
//   (2) `acks` is the one fiscal table that DELETEs (a delivered ack is pruned), so its trigger is
//       AFTER INSERT OR UPDATE OR DELETE and a delete must propagate.
// PGlite connects as a superuser and bypasses the REVOKE ALL and the RLS WITH CHECK the capture
// path must satisfy, so it is a false pass here (CLAUDE.md §4). The `manifest` template runs the
// whole migration manifest (fiscal last), so the clone carries the fiscal tables + their capture
// triggers + sync_log/sync_capture.
//
// This suite lives in apps/server alongside the rest of the SP-3a fiscal-record-lane gates: its
// apply-lane siblings import the composition root's `mountSyncApi`/`ALL_SYNC_ENROLMENTS`, which
// `fiscal-verifactu` cannot import (dependency inversion), so the lane's suites are co-located here.
// Spanish fiscal table/column names ride verbatim because apps/* is english-only-exempt — an aside
// that does not decide placement (packages/fiscal-verifactu is exempt too).
//
// The deployment role app_login — a non-superuser, non-BYPASSRLS LOGIN member of app_user, so FORCE
// RLS and the REVOKE ALL actually apply to it — is created once in src/testing/global-setup.ts and
// shared across the gate suites; reached below with `postgres.pg.connectAs("app_login", "app_pw")`.
// The RLS-bypassing reader is `postgres.admin` (the clone's superuser), used only for setup and to
// read sync_log back (the app role holds no SELECT on it).
const postgres = useTemplateDb({ template: "manifest" });

// The FK-closure seeding and the registro INSERT are the shared apply-lane fixtures
// (seedFiscalParents / insertFiscalRegistro in ./testing/fiscal-fixtures.ts, which were extracted from
// this file): each seeds a fresh FK closure and inserts one registros_facturacion row against it,
// stamping `entorno` so the verbatim-capture assertion can prove OUR-metadata column rides into
// row_image unchanged (§5). Both stop SHORT of writing the registro as the app role — each test does
// that itself via `asWriter`, so its own INSERT is what the capture trigger sees.

// The app writer (app_login: a non-superuser member of app_user, so FORCE RLS and the REVOKE ALL
// genuinely apply to it). One connection is opened for the whole file and reused by `asWriter`,
// matching the sibling apply-lane suites, rather than reconnecting per call.
let writer: Database;

beforeAll(async () => {
  writer = await postgres.pg.connectAs("app_login", "app_pw");
});

afterAll(async () => {
  // Only this connectAs handle is closed here; the clone and its admin are owned by useTemplateDb
  // (CLAUDE.md §4: never double-close a helper-owned connection).
  if (writer !== undefined) await writer.close();
});

/**
 * Runs `fn` as the app writer inside ONE transaction with the tenant + node GUCs bound
 * transaction-locally, mirroring capture.gate.test.ts's `withTenantNode`. With `apply: true` it also
 * sets app.sync_apply='on' so the WHEN clause suppresses the capture (the echo path).
 */
async function asWriter(
  tenantId: string,
  nodeId: string,
  fn: (tx: Transaction) => Promise<void>,
  opts: { apply?: boolean } = {},
): Promise<void> {
  await writer.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    await tx.execute(sql`select set_config('app.node_id', ${nodeId}, true)`);
    if (opts.apply === true) {
      await tx.execute(sql`select set_config('app.sync_apply', 'on', true)`);
    }
    await fn(tx);
  });
}

describe("fiscal sync capture — the six triggers of 0014", () => {
  it("captures a registros_facturacion insert verbatim, as the app role, despite REVOKE ALL", async () => {
    // Failing case: capture does not fire on the immutable ledger (REVOKE ALL blocks it, or the
    // trigger is absent) → n = "0" and the row would never mirror; OR it fires but mangles the row —
    // the huella drifts, the deliberately-`text` importe_total is re-quoted, or OUR `entorno`
    // metadata is dropped — so a mirrored registro would no longer be byte-identical to the source.
    // Control in the other direction (jsonb_populate_record restoring the exact bytes the app role
    // wrote, exactly one row for THIS tenant) proves capture is verbatim, not merely present.
    //
    // PROVEN BY DELETION (recorded in the task report, restored after): with
    // `drop trigger registros_facturacion_capture on registros_facturacion` executed before the
    // insert, this assertion fails at `n` = "0" — the trigger IS what makes capture happen despite
    // the REVOKE ALL, not some ambient default.
    const p = await seedFiscalParents(postgres.admin);

    let registroId = "";
    await asWriter(p.tenantId, p.nodeId, async (tx) => {
      ({ registroId } = await insertFiscalRegistro(tx, p, {
        numSerie: "A/1",
        secuencia: 1,
        entorno: "preproduction",
      }));
    });

    const captured = await postgres.admin.execute<{
      n: string;
      op: string;
      origin_id: string;
      raw_huella: string;
      raw_importe: string;
      importe_type: string;
      raw_entorno: string;
      row_id: string;
      round_trip_huella: string;
      round_trip_importe: string;
      round_trip_entorno: string;
    }>(sql`
      select
        (select count(*)::text from sync_log
           where table_name = 'registros_facturacion' and tenant_id = ${p.tenantId}) as n,
        s.op,
        s.origin_id::text as origin_id,
        s.row_image->>'huella' as raw_huella,
        s.row_image->>'importe_total' as raw_importe,
        jsonb_typeof(s.row_image->'importe_total') as importe_type,
        s.row_image->>'entorno' as raw_entorno,
        r.id::text as row_id,
        r.huella as round_trip_huella,
        r.importe_total as round_trip_importe,
        r.entorno as round_trip_entorno
      from sync_log s,
           lateral jsonb_populate_record(null::registros_facturacion, s.row_image) r
      where s.table_name = 'registros_facturacion' and s.tenant_id = ${p.tenantId}`);

    expect(captured.rows).toHaveLength(1);
    const row = captured.rows[0]!;
    expect(row.n).toBe("1"); // captured exactly once despite REVOKE ALL
    expect(row.op).toBe("insert");
    expect(row.origin_id).toBe(p.nodeId); // the app.node_id GUC, verbatim
    // importe_total is a `text` column (deliberately, so its bytes ARE the huella input —
    // schema/registros.ts), so to_jsonb maps it to a JSON string, and ->> reads it byte-identical.
    expect(row.importe_type).toBe("string");
    expect(row.raw_importe).toBe("123.45");
    expect(row.raw_huella).toBe("F".repeat(64));
    // OUR metadata rides untouched — the fiscal invariant is that `entorno` is never HASHED, not
    // that it is never CAPTURED; a mirror must carry it so `drain` on the far side can still refuse
    // the wrong environment (schema/registros.ts).
    expect(row.raw_entorno).toBe("preproduction");
    // jsonb_populate_record restores every value into its real column type, byte-for-byte.
    expect(row.row_id).toBe(registroId);
    expect(row.round_trip_huella).toBe("F".repeat(64));
    expect(row.round_trip_importe).toBe("123.45");
    expect(row.round_trip_entorno).toBe("preproduction");
  });

  it("captures an acks DELETE (the one fiscal table that deletes) as op='delete' carrying to_jsonb(OLD)", async () => {
    // Failing case (§the acks prune must propagate): the acks trigger does not branch on TG_OP or is
    // not declared for DELETE, so a pruned ack leaves a stale row on every mirror — no op='delete'
    // sync_log row lands, or it carries a null id/tenant. Control in the other direction: before the
    // delete there are zero op='delete' rows for this tenant and the INSERT did produce an
    // op='insert' row (so the trigger is attached and fires); after, exactly one op='delete' row
    // carrying the deleted ack's registro_id and tenant, and the ack really is gone.
    const p = await seedFiscalParents(postgres.admin);
    // The registro the ack hangs off (acks.registro_id FK). Seeded as admin here — this test is about
    // the ACKS trigger, and the assertions scope to table_name='acks', so the registro's own capture
    // is irrelevant. The ack row itself is written AS THE APP ROLE, so its capture runs as the writer.
    const { registroId } = await insertFiscalRegistro(postgres.admin, p, {
      numSerie: "A/1",
      secuencia: 1,
      entorno: "preproduction",
    });

    await asWriter(p.tenantId, p.nodeId, async (tx) => {
      await tx.execute(sql`
        insert into acks (registro_id, tenant_id, submitted_at, csv, state)
        values (${registroId}, ${p.tenantId}, '2026-07-20T19:25:00+01:00', 'CSV-XYZ', 'accepted')`);
    });

    const before = await postgres.admin.execute<{ del: string; ins: string }>(sql`
      select
        count(*) filter (where op = 'delete')::text as del,
        count(*) filter (where op = 'insert')::text as ins
      from sync_log where table_name = 'acks' and tenant_id = ${p.tenantId}`);
    expect(before.rows[0]!.del).toBe("0"); // nothing deleted yet
    expect(before.rows[0]!.ins).toBe("1"); // the ack's INSERT was captured (trigger is attached)

    await asWriter(p.tenantId, p.nodeId, async (tx) => {
      await tx.execute(sql`delete from acks where registro_id = ${registroId}`);
    });

    const captured = await postgres.admin.execute<{
      n: string;
      origin_id: string;
      tenant_id: string;
      registro_id: string;
    }>(sql`
      select
        count(*)::text as n,
        (array_agg(origin_id::text))[1] as origin_id,
        (array_agg(tenant_id::text))[1] as tenant_id,
        (array_agg(row_image->>'registro_id'))[1] as registro_id
      from sync_log
      where table_name = 'acks' and op = 'delete' and tenant_id = ${p.tenantId}`);
    expect(captured.rows[0]!.n).toBe("1"); // exactly one delete captured
    expect(captured.rows[0]!.origin_id).toBe(p.nodeId); // the app.node_id GUC, verbatim
    expect(captured.rows[0]!.tenant_id).toBe(p.tenantId); // to_jsonb(OLD).tenant_id
    expect(captured.rows[0]!.registro_id).toBe(registroId); // to_jsonb(OLD) carries the deleted id

    // The ack really is gone (the delete happened, not just its capture).
    const remaining = await postgres.admin.execute<{ n: string }>(
      sql`select count(*)::text as n from acks where registro_id = ${registroId}`,
    );
    expect(remaining.rows[0]!.n).toBe("0");
  });

  it("echo guard: an apply-path write (app.sync_apply='on') is not re-captured, but IS once the WHEN clause is removed", async () => {
    // Failing case: an apply-style registro write (app.sync_apply='on', as the apply worker sets it)
    // is re-captured, so a replicated row loops A→B→A. The control that proves the WHEN clause is the
    // MECHANISM (not merely present) is by DELETION: reinstall the trigger WITHOUT the WHEN clause and
    // show the identical apply-path write IS then captured (CLAUDE.md §1 prove-a-guard-by-deletion).
    const guarded = await seedFiscalParents(postgres.admin);

    await asWriter(
      guarded.tenantId,
      guarded.nodeId,
      async (tx) => {
        await insertFiscalRegistro(tx, guarded, {
          numSerie: "A/1",
          secuencia: 1,
          entorno: "preproduction",
        });
      },
      { apply: true },
    );

    const guardedCount = await postgres.admin.execute<{ n: string }>(sql`
      select count(*)::text as n from sync_log
      where table_name = 'registros_facturacion' and tenant_id = ${guarded.tenantId}`);
    expect(guardedCount.rows[0]!.n).toBe("0"); // echo suppressed by the WHEN clause

    // Control: drop the WHEN clause, repeat the same app.sync_apply='on' write on a FRESH tenant
    // (so the count is unambiguously about this write), and show it IS captured. Restore the guarded
    // trigger in `finally` — one shared database, the other suites need it back.
    await postgres.admin.execute(
      sql.raw(`drop trigger registros_facturacion_capture on registros_facturacion`),
    );
    await postgres.admin.execute(
      sql.raw(
        `create trigger registros_facturacion_capture after insert on registros_facturacion
           for each row execute function sync_capture()`,
      ),
    );
    try {
      const unguarded = await seedFiscalParents(postgres.admin);
      await asWriter(
        unguarded.tenantId,
        unguarded.nodeId,
        async (tx) => {
          await insertFiscalRegistro(tx, unguarded, {
            numSerie: "A/1",
            secuencia: 1,
            entorno: "preproduction",
          });
        },
        { apply: true },
      );
      const unguardedCount = await postgres.admin.execute<{ n: string }>(sql`
        select count(*)::text as n from sync_log
        where table_name = 'registros_facturacion' and tenant_id = ${unguarded.tenantId}`);
      expect(unguardedCount.rows[0]!.n).toBe("1"); // no WHEN clause → the echo IS captured
    } finally {
      await postgres.admin.execute(
        sql.raw(`drop trigger registros_facturacion_capture on registros_facturacion`),
      );
      await postgres.admin.execute(
        sql.raw(
          `create trigger registros_facturacion_capture after insert on registros_facturacion
             for each row when (current_setting('app.sync_apply', true) is distinct from 'on')
             execute function sync_capture()`,
        ),
      );
    }
  });
});
