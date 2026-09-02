import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  captureError,
  pgErrorCode,
  withTenant,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

// Real Postgres, not PGlite: this suite proves sync_log's FORCE ROW LEVEL SECURITY, the app role's
// INSERT-only grant, the sync_tailer read path and echo suppression under a genuine non-superuser
// role — PGlite connects as a superuser and bypasses all of it, so it is a false pass here
// (CLAUDE.md §4). The whole migration manifest runs (now including `sync` last), so the container
// carries sync_log + sync_capture + the 19 capture triggers over the enrolled tables (17 commercial+dining + 2 identity-config).
// The deployment role app_login — a non-superuser, non-BYPASSRLS LOGIN member of app_user, so FORCE
// RLS actually applies to it — is now created once in src/testing/global-setup.ts and shared across
// the gate suites: a shared cluster is one cluster, so a per-file `create role` would collide on the
// second suite. The suite reaches it below with `postgres.pg.connectAs("app_login", "app_pw")`, and
// reads back per-tenant as `tailer_login` (a sync_tailer member, likewise created once in
// global-setup and shared with retention.gate).
const postgres = useTemplateDb({ template: "manifest" });

// A producing node's id — capture writes it into sync_log.origin_id from the app.node_id GUC.
const NODE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ZERO = "00000000-0000-0000-0000-000000000000";

/** Mirrors withTenant, but also sets app.node_id so the capture trigger records the origin. */
async function withTenantNode<T>(
  db: Database,
  tenantId: string,
  nodeId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    await tx.execute(sql`select set_config('app.node_id', ${nodeId}, true)`);
    return fn(tx);
  });
}

interface Base {
  tenantId: string;
  locationId: string;
  tillId: string;
  catalogueId: string;
}

/**
 * Seeds one tenant plus the FK parents an enrolled commercial row needs — location, till,
 * catalogue — as the superuser admin (RLS bypassed; this is setup, not the thing under test). It
 * deliberately does NOT seed a product: the capture tests that need one insert it themselves (as
 * the app role, so its own INSERT is captured) or add it inline (as admin, when it is only an FK
 * parent). English fixture values throughout — packages/sync/src is inside the english-only guard.
 */
async function seedBase(admin: Database): Promise<Base> {
  const tenantId = await seedTenant(admin);
  const loc = await admin.execute<{ id: string }>(
    sql`insert into locations (tenant_id, name, invoice_locales, operation_description)
        values (${tenantId}, 'Location', array['en']::text[], 'Hospitality') returning id`,
  );
  const locationId = loc.rows[0]!.id;
  const till = await admin.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name)
        values (${tenantId}, ${locationId}, 'Till') returning id`,
  );
  const tillId = till.rows[0]!.id;
  const cat = await admin.execute<{ id: string }>(
    sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Deli') returning id`,
  );
  const catalogueId = cat.rows[0]!.id;
  return { tenantId, locationId, tillId, catalogueId };
}

describe("the generic capture trigger over the commercial lane", () => {
  it("captures a byte-identical products row: origin, verbatim numeric/jsonb, exactly once", async () => {
    // Failing case: the capture mangles the row on the way into sync_log — the numeric unit_price
    // is re-quoted as a JSON number and drifts, the jsonb descriptions do not round-trip, or the
    // origin is lost — so a mirrored row would no longer equal the source. Or the trigger fires
    // more than once. Control in the other direction: jsonb_populate_record restores the exact same
    // id/price/descriptions the app role wrote, and exactly one sync_log row exists for this tenant.
    const { tenantId, catalogueId } = await seedBase(postgres.admin);
    const probe = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      const inserted = await withTenantNode(probe, tenantId, NODE_A, (tx) =>
        tx.execute<{ id: string }>(
          sql`insert into products
                (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
              values (${tenantId}, ${catalogueId}, '{"en":"Coffee"}'::jsonb, 'each', '12.34', 'general')
              returning id`,
        ),
      );
      const productId = inserted.rows[0]!.id;

      const captured = await postgres.admin.execute<{
        n: string;
        op: string;
        origin_id: string;
        raw_unit_price: string;
        unit_price_type: string;
        vat_class_type: string;
        row_id: string;
        round_trip_price: string;
        round_trip_descriptions: Record<string, string>;
      }>(sql`
        select
          (select count(*)::text from sync_log where table_name = 'products' and tenant_id = ${tenantId}) as n,
          s.op,
          s.origin_id::text as origin_id,
          s.row_image->>'unit_price' as raw_unit_price,
          jsonb_typeof(s.row_image->'unit_price') as unit_price_type,
          jsonb_typeof(s.row_image->'vat_class') as vat_class_type,
          p.id::text as row_id,
          p.unit_price::text as round_trip_price,
          p.descriptions as round_trip_descriptions
        from sync_log s, lateral jsonb_populate_record(null::products, s.row_image) p
        where s.table_name = 'products' and s.tenant_id = ${tenantId}
      `);

      expect(captured.rows).toHaveLength(1);
      const row = captured.rows[0]!;
      expect(row.n).toBe("1"); // captured exactly once
      expect(row.op).toBe("insert");
      expect(row.origin_id).toBe(NODE_A); // the app.node_id GUC, verbatim
      // to_jsonb maps a `numeric` column to a JSON NUMBER and a `text` column to a JSON STRING.
      // Verified on postgres:18-alpine: jsonb_typeof(to_jsonb('12.34'::numeric)) = 'number'. This
      // corrects the task brief's "numeric stays a JSON string", which is true only of the fiscal
      // lane's `registros_facturacion.importe_total` — a TEXT column (findings GATE 1). What matters
      // for §3's verbatim requirement is that BOTH round-trip exactly: jsonb stores a numeric with
      // full precision, so `->>` reads '12.34' back and jsonb_populate_record restores 12.34 into
      // the numeric(12,2) column identically.
      expect(row.unit_price_type).toBe("number");
      expect(row.vat_class_type).toBe("string"); // a text column DOES stay a JSON string
      expect(row.raw_unit_price).toBe("12.34"); // ->> extraction, byte-identical
      expect(row.round_trip_price).toBe("12.34"); // jsonb_populate_record restores it identically
      expect(row.row_id).toBe(productId);
      expect(row.round_trip_descriptions).toEqual({ en: "Coffee" });
    } finally {
      await probe.close();
    }
  });

  it("suppresses the echo under app.sync_apply='on', and re-captures once the WHEN clause is removed", async () => {
    // Failing case: an apply-style write (app.sync_apply='on') is re-captured, so a replicated row
    // loops A→B→A. The control that proves the WHEN clause is the mechanism (not merely present) is
    // by DELETION: reinstall the trigger WITHOUT the WHEN clause and show the identical write IS
    // then captured (findings GATE 1; CLAUDE.md §1 prove-a-guard-by-deletion).
    const { tenantId, catalogueId } = await seedBase(postgres.admin);
    const probe = await postgres.pg.connectAs("app_login", "app_pw");

    async function applyStyleInsert(price: string): Promise<void> {
      await probe.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        await tx.execute(sql`select set_config('app.sync_apply', 'on', true)`);
        await tx.execute(
          sql`insert into products
                (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
              values (${tenantId}, ${catalogueId}, '{"en":"Coffee"}'::jsonb, 'each', ${price}, 'general')`,
        );
      });
    }

    async function productCount(): Promise<string> {
      const r = await postgres.admin.execute<{ n: string }>(
        sql`select count(*)::text as n from sync_log
            where table_name = 'products' and tenant_id = ${tenantId}`,
      );
      return r.rows[0]!.n;
    }

    try {
      await applyStyleInsert("1.00");
      expect(await productCount()).toBe("0"); // echo suppressed by the WHEN clause

      // Control: drop the WHEN clause, repeat the same app.sync_apply='on' write.
      await postgres.admin.execute(sql.raw(`drop trigger products_capture on products`));
      await postgres.admin.execute(
        sql.raw(
          `create trigger products_capture after insert or update on products
             for each row execute function sync_capture()`,
        ),
      );
      try {
        await applyStyleInsert("2.00");
        expect(await productCount()).toBe("1"); // no WHEN clause → the echo IS captured
      } finally {
        // Restore the guarded trigger for the other tests (one shared database).
        await postgres.admin.execute(sql.raw(`drop trigger products_capture on products`));
        await postgres.admin.execute(
          sql.raw(
            `create trigger products_capture after insert or update on products
               for each row when (current_setting('app.sync_apply', true) is distinct from 'on')
               execute function sync_capture()`,
          ),
        );
      }
    } finally {
      await probe.close();
    }
  });

  it("captures a working_order_lines DELETE as op='delete' carrying to_jsonb(OLD)", async () => {
    // Failing case (spec §2, the op the fiscal-shaped design omitted): the capture does not branch
    // on TG_OP, so on a DELETE it reads NEW (NULL) — no delete row lands, or it carries a null
    // tenant/id — and a removed line leaves a stale row on every mirror. Control in the other
    // direction: before the delete there are zero op='delete' rows for this tenant, and the parent
    // INSERT did produce an op='insert' row (so the trigger is attached and fires); after the
    // delete there is exactly one op='delete' row carrying the deleted line's id and tenant.
    const { tenantId, tillId, catalogueId } = await seedBase(postgres.admin);
    const prod = await postgres.admin.execute<{ id: string }>(
      sql`insert into products
            (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
          values (${tenantId}, ${catalogueId}, '{"en":"Coffee"}'::jsonb, 'each', '1.30', 'general')
          returning id`,
    );
    const productId = prod.rows[0]!.id;
    const order = await postgres.admin.execute<{ id: string }>(
      sql`insert into working_orders (tenant_id, till_id, order_number, status)
          values (${tenantId}, ${tillId}, 1, 'open') returning id`,
    );
    const orderId = order.rows[0]!.id;
    const line = await postgres.admin.execute<{ id: string }>(
      sql`insert into working_order_lines
            (tenant_id, working_order_id, line_no, product_id, descriptions,
             quantity, unit_price, unit_price_gross, vat_rate, line_total)
          values (${tenantId}, ${orderId}, 1, ${productId}, '{"en":"Coffee"}'::jsonb,
                  '1.000', '1.30', '1.43', '10.00', '1.30') returning id`,
    );
    const lineId = line.rows[0]!.id;

    const before = await postgres.admin.execute<{ del: string; ins: string }>(
      sql`select
            count(*) filter (where op = 'delete')::text as del,
            count(*) filter (where op = 'insert')::text as ins
          from sync_log where table_name = 'working_order_lines' and tenant_id = ${tenantId}`,
    );
    expect(before.rows[0]!.del).toBe("0"); // nothing deleted yet
    expect(before.rows[0]!.ins).toBe("1"); // the seeded line's INSERT was captured

    // Delete the line as the app role (parent is still open, so require_open_parent permits it).
    const probe = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`delete from working_order_lines where id = ${lineId}`),
      );
    } finally {
      await probe.close();
    }

    const captured = await postgres.admin.execute<{ tenant_id: string; line_id: string }>(sql`
      select tenant_id::text as tenant_id, row_image->>'id' as line_id
      from sync_log
      where table_name = 'working_order_lines' and op = 'delete' and tenant_id = ${tenantId}
    `);
    expect(captured.rows).toHaveLength(1); // exactly one delete captured
    expect(captured.rows[0]).toMatchObject({ tenant_id: tenantId, line_id: lineId });

    // The line really is gone (the delete happened, not just its capture).
    const remaining = await postgres.admin.execute<{ n: string }>(
      sql`select count(*)::text as n from working_order_lines where id = ${lineId}`,
    );
    expect(remaining.rows[0]!.n).toBe("0");
  });

  it("fences sync_log: FORCE RLS is on, the app role cannot read or mutate it, sync_tailer reads only its own tenant", async () => {
    const a = await seedTenant(postgres.admin);
    const b = await seedTenant(postgres.admin);
    // Two rows, one per tenant, inserted directly as the superuser (RLS bypassed for setup). Both
    // present so "invisible" below cannot be the trivial "nothing was there" answer (CLAUDE.md §1).
    await postgres.admin.execute(
      sql`insert into sync_log (origin_id, table_name, op, tenant_id, row_image) values
            (${ZERO}, 'products', 'insert', ${a}, '{"marker":"a"}'::jsonb),
            (${ZERO}, 'products', 'insert', ${b}, '{"marker":"b"}'::jsonb)`,
    );

    // The FORCE-RLS catalog check. This is the real guard for sync_log's FORCE: the fiscal
    // inmutabilidad suite (CLAUDE.md §3) scans a database that only carries core+identity+fiscal
    // and CANNOT run this migration (its triggers need the payments tables), so it never sees
    // sync_log — the check has to live here. FORCE without ENABLE is silently inert, so both flags
    // are asserted (mirroring inmutabilidad.test.ts's teeth check).
    const flags = await postgres.admin.execute<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'sync_log'`);
    expect(flags.rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });

    // The app role holds INSERT only (REVOKE ALL then GRANT INSERT). Failing case for each: a
    // SELECT/UPDATE/DELETE that succeeds (or returns rows) would mean the grant leaked read/write
    // access. app_user has none, so each is refused 42501 at the privilege layer.
    const app = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      expect(
        pgErrorCode(await captureError(() => app.execute(sql`select seq from sync_log`))),
      ).toBe("42501");
      expect(
        pgErrorCode(
          await captureError(() => app.execute(sql`update sync_log set row_image = row_image`)),
        ),
      ).toBe("42501");
      expect(
        pgErrorCode(
          await captureError(() => app.execute(sql`delete from sync_log where seq = -1`)),
        ),
      ).toBe("42501");
    } finally {
      await app.close();
    }

    // The dedicated reader: `tailer_login`, a LOGIN member of sync_tailer created once in
    // src/testing/global-setup.ts (shared with retention.gate — a shared cluster is one cluster, so a
    // per-file create would collide, and a per-file drop/recreate would churn a role retention.gate
    // also uses). Under tenant A it sees the tenant-A row and NOT the tenant-B row; under tenant B the
    // reverse (the control) — the FORCE-RLS policy holding under a genuine RLS-subject role.
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const underA = await withTenant(tailer, a, (tx) =>
        tx.execute<{ av: string; bv: string }>(sql`
          select count(*) filter (where tenant_id = ${a})::text as av,
                 count(*) filter (where tenant_id = ${b})::text as bv
          from sync_log`),
      );
      expect(underA.rows[0]).toMatchObject({ av: "1", bv: "0" }); // A visible, B hidden

      const underB = await withTenant(tailer, b, (tx) =>
        tx.execute<{ av: string; bv: string }>(sql`
          select count(*) filter (where tenant_id = ${a})::text as av,
                 count(*) filter (where tenant_id = ${b})::text as bv
          from sync_log`),
      );
      expect(underB.rows[0]).toMatchObject({ av: "0", bv: "1" }); // control: B visible, A hidden
    } finally {
      await tailer.close();
    }
  });

  it("the C1 table-service triggers capture an app-role insert (dining_tables/floor_zones/table_service_statuses)", async () => {
    const base = await seedBase(postgres.admin);
    const app = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      // floor_zone + status as the app role → each capture fires.
      const [zone, status, table] = [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ];
      await withTenantNode(app, base.tenantId, NODE_A, async (tx) => {
        await tx.execute(
          sql`insert into floor_zones (id, tenant_id, location_id, name)
              values (${zone}, ${base.tenantId}, ${base.locationId}, 'Dining Room')`,
        );
        await tx.execute(
          sql`insert into table_service_statuses (id, tenant_id, label, color)
              values (${status}, ${base.tenantId}, 'Needs cleaning', '#ef4444')`,
        );
        await tx.execute(
          sql`insert into dining_tables (id, tenant_id, location_id, label, zone_id, status_id)
              values (${table}, ${base.tenantId}, ${base.locationId}, 'T1', ${zone}, ${status})`,
        );
      });
      const captured = await postgres.admin.execute<{
        table_name: string;
        op: string;
        origin_id: string;
      }>(
        sql`select table_name, op, origin_id from sync_log
            where tenant_id = ${base.tenantId}
              and table_name in ('floor_zones','table_service_statuses','dining_tables')
            order by seq`,
      );
      expect(captured.rows.map((r) => r.table_name)).toEqual([
        "floor_zones",
        "table_service_statuses",
        "dining_tables",
      ]);
      for (const r of captured.rows) {
        expect(r.op).toBe("insert");
        expect(r.origin_id).toBe(NODE_A); // the app.node_id GUC, verbatim
      }
    } finally {
      await app.close();
    }
  });

  it("the three C1 capture triggers fire on {INSERT, UPDATE} and NOT DELETE (spec §6)", async () => {
    // Spec §6 promises "the new triggers are asserted present with the right op set". These tables
    // deactivate via `active`, never hard-delete (the app-role grant is SELECT/INSERT/UPDATE with no
    // DELETE — 0044/0048/0052), so 0006 declares them AFTER INSERT OR UPDATE: a DELETE must never be
    // captured. information_schema.triggers carries ONE row per (trigger, event_manipulation), so a
    // trigger firing on INSERT OR UPDATE shows exactly {INSERT, UPDATE} — the presence of a DELETE row
    // would mean a delete is captured. Read as the superuser admin (it sees every trigger).
    const triggers: [table: string, trigger: string][] = [
      ["floor_zones", "floor_zones_capture"],
      ["table_service_statuses", "table_service_statuses_capture"],
      ["dining_tables", "dining_tables_capture"],
    ];
    // One query for all three (the sibling capture test above batches the same way): a row per
    // (trigger, event_manipulation), so a captured DELETE would surface as a third event row.
    const events = await postgres.admin.execute<{ tbl: string; event: string }>(
      sql`select event_object_table as tbl, event_manipulation as event
          from information_schema.triggers
          where trigger_schema = 'public'
            and event_object_table in ('floor_zones', 'table_service_statuses', 'dining_tables')
            and trigger_name in ('floor_zones_capture', 'table_service_statuses_capture', 'dining_tables_capture')
          order by event_object_table, event_manipulation`,
    );
    for (const [table] of triggers) {
      const set = events.rows.filter((r) => r.tbl === table).map((r) => r.event);
      // Exactly {INSERT, UPDATE}: the AFTER INSERT OR UPDATE op set. toEqual pins it, so a captured
      // DELETE (a third event row) fails here — no delete captured (deactivate-only).
      expect(set).toEqual(["INSERT", "UPDATE"]);
    }
  });
});
