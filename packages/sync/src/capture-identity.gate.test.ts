import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant, type Database, type Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

// PostgreSQL exercises identity capture through a non-superuser app_user member; PGlite's
// superuser sessions cannot check the caller's grants. The shared template includes identity tables
// and their capture triggers. Global setup creates app_login once per cluster.
const postgres = useTemplateDb({ template: "manifest" });

// A producing node's id — capture writes it into sync_log.origin_id from the app.node_id GUC.
const NODE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Runs the callback in one transaction with app.node_id set for capture's producing origin. */
async function withNode<T>(
  db: Database,
  nodeId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.node_id', ${nodeId}, true)`);
    return fn(tx);
  });
}

/**
 * Seeds one tenant plus a location, till and person, as the superuser admin (fixture
 * setup, not the thing under test). English fixture values throughout — packages/sync/src is inside
 * the english-only guard.
 */
async function seedTenantPersonTill(admin: Database): Promise<{
  tenantId: string;
  personId: string;
  locationId: string;
  tillId: string;
}> {
  const tenantId = await seedTenant(admin);
  const loc = await admin.execute<{ id: string }>(
    sql`insert into locations (tenant_id, name, invoice_locales, operation_description)
        values (${tenantId}, 'Location', array['en']::text[], 'Hospitality') returning id`,
  );
  const locationId = loc.rows[0]!.id;
  const till = await admin.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Till') returning id`,
  );
  const person = await admin.execute<{ id: string }>(
    sql`insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'Ada', 'hash', 'staff') returning id`,
  );
  return { tenantId, personId: person.rows[0]!.id, locationId, tillId: till.rows[0]!.id };
}

async function syncCount(tenantId: string, table: string): Promise<string> {
  const r = await postgres.admin.execute<{ n: string }>(
    sql`select count(*)::text as n from sync_log where table_name = ${table} and tenant_id = ${tenantId}`,
  );
  return r.rows[0]!.n;
}

describe("identity CONFIG tables capture; ephemeral auth tables do NOT (spec §2)", () => {
  it("a persons INSERT and UPDATE by the app role capture, with origin = app.node_id", async () => {
    // Failing case: no persons_capture trigger, so a person write leaves ZERO sync_log rows and the
    // secondary can never learn of the account. Control: the write lands exactly one insert row
    // carrying NODE_A, and an UPDATE lands one more op='update' row.
    const tenantId = await seedTenant(postgres.admin);
    const probe = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      const ins = await withNode(probe, NODE_A, (tx) =>
        tx.execute<{ id: string }>(
          sql`insert into persons (tenant_id, display_name, pin_hash, role)
              values (${tenantId}, 'Ada', 'hash', 'staff') returning id`,
        ),
      );
      const personId = ins.rows[0]!.id;
      await withNode(probe, NODE_A, (tx) =>
        tx.execute(sql`update persons set role = 'manager' where id = ${personId}`),
      );
      const rows = await postgres.admin.execute<{ op: string; origin: string }>(sql`
        select op, origin_id::text as origin from sync_log
        where table_name = 'persons' and tenant_id = ${tenantId} order by seq asc`);
      expect(rows.rows.map((r) => r.op)).toEqual(["insert", "update"]);
      expect(rows.rows.every((r) => r.origin === NODE_A)).toBe(true);
    } finally {
      await probe.close();
    }
  });

  it("a webauthn_credentials DELETE captures as op='delete' carrying to_jsonb(OLD)", async () => {
    // Failing case: no webauthn_credentials_capture, so a revoked passkey's DELETE never reaches the
    // secondary and the credential stays valid there. Control: exactly one op='delete' row with the id.
    const { tenantId, personId } = await seedTenantPersonTill(postgres.admin);
    const probe = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      const cred = await withNode(probe, NODE_A, (tx) =>
        tx.execute<{ id: string }>(
          sql`insert into webauthn_credentials (tenant_id, person_id, credential_id, public_key)
              values (${tenantId}, ${personId}, 'cred-1', 'pk-1') returning id`,
        ),
      );
      const credId = cred.rows[0]!.id;
      await withNode(probe, NODE_A, (tx) =>
        tx.execute(sql`delete from webauthn_credentials where id = ${credId}`),
      );
      const del = await postgres.admin.execute<{ id: string }>(sql`
        select row_image->>'id' as id from sync_log
        where table_name = 'webauthn_credentials' and op = 'delete' and tenant_id = ${tenantId}`);
      expect(del.rows).toHaveLength(1);
      expect(del.rows[0]!.id).toBe(credId);
    } finally {
      await probe.close();
    }
  });

  it("sessions, management_sessions and webauthn_challenges do NOT capture (the exclusion)", async () => {
    // The 'sessions must NOT replicate' guarantee (spec §2), as a measurement where the two answers
    // DIFFER (CLAUDE.md §1): a persons write captures (1) while each ephemeral write captures nothing (0).
    const { tenantId, personId, tillId } = await seedTenantPersonTill(postgres.admin);
    const probe = await postgres.pg.connectAs("app_login", "app_pw");
    try {
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`insert into sessions (tenant_id, person_id, till_id)
                       values (${tenantId}, ${personId}, ${tillId})`),
      );
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`insert into management_sessions (tenant_id, person_id)
                       values (${tenantId}, ${personId})`),
      );
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`insert into webauthn_challenges (tenant_id, person_id, challenge)
                       values (${tenantId}, ${personId}, 'chal-1')`),
      );
      // Control (the other direction): a persons write DOES capture, so 0 below is a real exclusion.
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`insert into persons (tenant_id, display_name, pin_hash, role)
                       values (${tenantId}, 'Grace', 'hash', 'staff')`),
      );
      expect(await syncCount(tenantId, "sessions")).toBe("0");
      expect(await syncCount(tenantId, "management_sessions")).toBe("0");
      expect(await syncCount(tenantId, "webauthn_challenges")).toBe("0");
      // Both persons writes captured: the seed 'Ada' (trigger firing is role-independent, so even the
      // admin insert in seedTenantPersonTill is captured with app.sync_apply unset) AND the control
      // 'Grace'. The number is not the point — that persons is NON-ZERO while all three ephemeral
      // tables sit at 0 is the DIFFERING measurement (CLAUDE.md §1); 0 above is a real exclusion.
      expect(await syncCount(tenantId, "persons")).toBe("2");
    } finally {
      await probe.close();
    }
  });

  it("suppresses the echo under app.sync_apply='on', re-captures once the WHEN clause is removed", async () => {
    // Prove the WHEN clause is the mechanism, by DELETION (CLAUDE.md §1). Mirrors capture.gate.test.ts.
    const tenantId = await seedTenant(postgres.admin);
    const probe = await postgres.pg.connectAs("app_login", "app_pw");
    async function applyStyleInsert(name: string): Promise<void> {
      await probe.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.sync_apply', 'on', true)`);
        await tx.execute(sql`insert into persons (tenant_id, display_name, pin_hash, role)
                             values (${tenantId}, ${name}, 'hash', 'staff')`);
      });
    }
    try {
      await applyStyleInsert("Echo");
      expect(await syncCount(tenantId, "persons")).toBe("0"); // suppressed
      await postgres.admin.execute(sql.raw(`drop trigger persons_capture on persons`));
      await postgres.admin.execute(
        sql.raw(
          `create trigger persons_capture after insert or update on persons
           for each row execute function sync_capture()`,
        ),
      );
      try {
        await applyStyleInsert("NoGuard");
        expect(await syncCount(tenantId, "persons")).toBe("1"); // no WHEN → echo captured
      } finally {
        await postgres.admin.execute(sql.raw(`drop trigger persons_capture on persons`));
        await postgres.admin.execute(
          sql.raw(
            `create trigger persons_capture after insert or update on persons
             for each row when (current_setting('app.sync_apply', true) is distinct from 'on')
             execute function sync_capture()`,
          ),
        );
      }
    } finally {
      await probe.close();
    }
  });
});
