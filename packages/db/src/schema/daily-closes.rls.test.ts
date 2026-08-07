import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useRealPostgres } from "../testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "../testing/postgres.js";
import { asAppUser } from "../testing/roles.js";
import { seedNode } from "../testing/seed.js";
import { withTenant } from "../tenancy.js";
import { locations, tenants } from "./tenants.js";

// Real Postgres, not PGlite, and not describeEachTarget: the headline assertions here are that
// `daily_closes` is append-only under the app role (42501 on UPDATE/DELETE via the withheld grant,
// WT001 via the trigger backstop) and that FORCE ROW LEVEL SECURITY isolates one tenant's closes
// from another's. PGlite connects as a superuser that bypasses FORCE ROW LEVEL SECURITY and can
// DISABLE TRIGGER unconditionally, so a PGlite pass would be a false pass (CLAUDE.md §4). The
// column-presence and constraint assertions would pass on either target; they ride along on the one
// container this suite already needs for the immutability + RLS checks. Mirrors
// park-retrieve.rls.test.ts (this package) and inmutabilidad.test.ts (fiscal-verifactu).

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
// The counting actor recorded in `closed_by` — an identity person id, plain uuid, no FK (D3 in the
// design owns the person schema; a raw uuid keeps this table independent of it).
const CLOSED_BY = "cccccccc-0000-4000-8000-000000000001";

// Captured at seed time — the node ids the raw inserts below need for tenant-consistent FKs.
let nodeA = "";
let nodeB = "";

// A minimal-but-real snapshot document: `close` is the VAT-exact computeDailyClose output (owned by
// @waitron/reporting, opaque `unknown` here) and `cashReconciliation` is the per-till/per-node variance
// block. Stored verbatim; the readback below proves the jsonb column round-trips a nested value.
function snapshotLiteral(nodeVariance: string): string {
  return JSON.stringify({
    close: { vat: { taxTotal: "12.35" }, cash: {}, counts: { sales: 3, corrections: 0, voids: 0 } },
    cashReconciliation: {
      byTill: [
        {
          tillId: "dddddddd-0000-4000-8000-000000000001",
          openingFloat: "50.00",
          payouts: "0.00",
          countedCash: "173.45",
          cashTakings: "123.45",
          cashVariance: nodeVariance,
        },
      ],
      nodeVariance,
    },
  });
}

// Raw SQL, not the drizzle `dailyCloses` object: the RED phase then fails at runtime on
// `relation "daily_closes" does not exist` — the real cause — rather than at compile time on a
// missing import, and the assertion exercises the actual column list a migration produces.
function insertCloseSql(opts: {
  tenantId: string;
  nodeId: string;
  businessDay: string;
  sequenceNo: number;
  snapshot?: string;
}): ReturnType<typeof sql> {
  return sql`
    insert into daily_closes (
      tenant_id, node_id, business_day, sequence_no,
      prev_entry_hash, entry_hash, closed_by, snapshot
    ) values (
      ${opts.tenantId}, ${opts.nodeId}, ${opts.businessDay}, ${opts.sequenceNo},
      '', ${"A".repeat(64)}, ${CLOSED_BY}, ${opts.snapshot ?? snapshotLiteral("0.00")}::jsonb
    ) returning id`;
}

class RollbackSignal extends Error {}

describe("frozen daily close schema under real row-level security", () => {
  const suite = useRealPostgres({
    start: () =>
      startMigratedPostgres({
        dockerRequired:
          "The frozen daily close schema suite requires a running Docker daemon. It cannot be " +
          "skipped: PGlite runs every connection as a superuser, which bypasses the FORCE ROW " +
          "LEVEL SECURITY and the append-only triggers this suite exists to prove on daily_closes.",
        migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      }),
    // Restates this package's own vitest hookTimeout (120s), which the helper's 60s default would
    // otherwise narrow — the figure covers pulling the Postgres image on a cold runner.
    timeoutMs: 120_000,
  });

  // Scaffolding seeded once as the owner (superuser bypasses RLS — pure setup). Registered after the
  // helper's own hook, which vitest runs first; if it throws this one never runs, so `suite.admin`
  // is never read unstarted (verified pattern, park-retrieve.rls.test.ts).
  beforeAll(async () => {
    const admin = suite.admin;
    await admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    await admin.insert(locations).values([
      {
        id: LOCATION_A,
        tenantId: TENANT_A,
        name: "Fixture Location A",
        invoiceLocales: ["es"],
        operationDescription: "Hosteleria",
      },
      {
        id: LOCATION_B,
        tenantId: TENANT_B,
        name: "Fixture Location B",
        invoiceLocales: ["es"],
        operationDescription: "Hosteleria",
      },
    ]);
    nodeA = await seedNode(admin, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
    nodeB = await seedNode(admin, brandTenantId(TENANT_B), brandLocationId(LOCATION_B));
  });

  it("lets the app role INSERT and read back a daily_closes row (columns present, grant + WITH CHECK)", async () => {
    // The positive control. Without it, the rejection tests below would all pass against a role that
    // simply has no access to the table at all — proving nothing about append-only-ness. It also
    // proves the column list a close is written with and that the snapshot jsonb round-trips.
    const row = await withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      await tx.execute(
        insertCloseSql({
          tenantId: TENANT_A,
          nodeId: nodeA,
          businessDay: "2026-08-01",
          sequenceNo: 1,
          snapshot: snapshotLiteral("1.23"),
        }),
      );
      const result = await tx.execute<{
        business_day: string;
        sequence_no: number;
        prev_entry_hash: string;
        entry_hash: string;
        closed_by: string;
        node_variance: string;
      }>(sql`
        select business_day, sequence_no, prev_entry_hash, entry_hash, closed_by,
               snapshot->'cashReconciliation'->>'nodeVariance' as node_variance
          from daily_closes
         where tenant_id = ${TENANT_A} and node_id = ${nodeA} and business_day = '2026-08-01'`);
      return result.rows[0];
    });
    expect(row?.sequence_no).toBe(1);
    expect(row?.prev_entry_hash).toBe("");
    expect(row?.entry_hash).toBe("A".repeat(64));
    expect(row?.closed_by).toBe(CLOSED_BY);
    expect(row?.node_variance).toBe("1.23");
  });

  it("rejects UPDATE of a daily_closes row under the app role with insufficient_privilege", async () => {
    // The grant is SELECT, INSERT only — no UPDATE — so this fails at privilege-check time (42501),
    // BEFORE the append-only trigger is ever reached. Insert then update in one transaction: the
    // update's throw rolls the insert back, so nothing accumulates.
    const error = await captureError(() =>
      withTenant(suite.admin, TENANT_A, async (tx) => {
        await asAppUser(tx);
        await tx.execute(
          insertCloseSql({
            tenantId: TENANT_A,
            nodeId: nodeA,
            businessDay: "2026-08-02",
            sequenceNo: 2,
          }),
        );
        await tx.execute(sql`update daily_closes set entry_hash = ${"B".repeat(64)}`);
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");
  });

  it("rejects DELETE of a daily_closes row under the app role with insufficient_privilege", async () => {
    const error = await captureError(() =>
      withTenant(suite.admin, TENANT_A, async (tx) => {
        await asAppUser(tx);
        await tx.execute(
          insertCloseSql({
            tenantId: TENANT_A,
            nodeId: nodeA,
            businessDay: "2026-08-03",
            sequenceNo: 3,
          }),
        );
        await tx.execute(sql`delete from daily_closes`);
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");
  });

  it("rejects UPDATE of daily_closes by the append-only trigger even when the privilege is granted", async () => {
    // The layered proof, and the one the recipe-by-deletion step targets. Revocation fires first, so
    // the two tests above never reach the trigger — and a trigger nobody has seen fire is a comment,
    // not a backstop. Grant UPDATE inside a transaction that rolls back, and watch the second layer
    // (daily_closes_immutable → reject_mutation() → WT001) catch it. Remove that trigger from the
    // migration and THIS test goes red while the 42501 tests stay green.
    await withTenant(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`grant update on daily_closes to app_user`);
      await tx.execute(sql`set local role app_user`);
      await tx.execute(
        insertCloseSql({
          tenantId: TENANT_A,
          nodeId: nodeA,
          businessDay: "2026-08-04",
          sequenceNo: 4,
        }),
      );
      const error = await captureError(() =>
        tx.execute(sql`update daily_closes set entry_hash = ${"C".repeat(64)}`),
      );
      expect(pgErrorCode(error)).toBe("WT001");
      throw new RollbackSignal();
    }).catch((e: unknown) => {
      if (!(e instanceof RollbackSignal)) throw e;
    });
  });

  it("rejects TRUNCATE of daily_closes by the statement trigger", async () => {
    // A row trigger does NOT fire on TRUNCATE. Without the separate BEFORE TRUNCATE … FOR EACH
    // STATEMENT trigger, TRUNCATE walks straight through every row-level protection above. No
    // CASCADE: nothing references daily_closes.id (the whole close is one frozen jsonb document — no
    // child table — design D1).
    await withTenant(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`grant truncate on daily_closes to app_user`);
      await tx.execute(sql`set local role app_user`);
      const error = await captureError(() => tx.execute(sql`truncate daily_closes`));
      expect(pgErrorCode(error)).toBe("WT001");
      throw new RollbackSignal();
    }).catch((e: unknown) => {
      if (!(e instanceof RollbackSignal)) throw e;
    });
  });

  it("lets the app role UPDATE daily_close_chain — it is the mutable head/counter", async () => {
    // The chain head advances on every close (sequence_no+1, last_entry_hash = the new entry_hash),
    // so it gets Part 4 of the recipe (tenant isolation) plus a SELECT/INSERT/UPDATE grant and NO
    // append-only trigger — the same shape invoice_series and working_order_counters carry. Prove
    // the UPDATE the head depends on actually succeeds under the app role.
    const updated = await withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into daily_close_chain (tenant_id, node_id, sequence_no, last_entry_hash)
        values (${TENANT_A}, ${nodeA}, 0, '')`);
      await tx.execute(sql`
        update daily_close_chain
           set sequence_no = 1, last_entry_hash = ${"A".repeat(64)}
         where tenant_id = ${TENANT_A} and node_id = ${nodeA}`);
      const result = await tx.execute<{ sequence_no: number; last_entry_hash: string }>(sql`
        select sequence_no, last_entry_hash from daily_close_chain
         where tenant_id = ${TENANT_A} and node_id = ${nodeA}`);
      return result.rows[0];
    });
    expect(updated?.sequence_no).toBe(1);
    expect(updated?.last_entry_hash).toBe("A".repeat(64));
  });

  it("isolates one tenant's daily_closes from another under FORCE row-level security", async () => {
    // Insert a close for tenant A, under A's GUC, as the app role. Tenant A then sees at least its
    // own rows and tenant B — the SAME app role, the SAME SELECT grant — sees NONE of them. The only
    // thing standing between B's query and A's rows is the isolation policy's USING clause
    // (tenant_id = current_tenant_id()) evaluated against B's GUC. The positive read (A sees ≥1) is
    // load-bearing: without it, B's 0 could equally mean "app_user has no access at all". FORCE
    // itself is asserted structurally by the inmutabilidad guard (fiscal-verifactu), which reads
    // relforcerowsecurity; this proves the POLICY works.
    await withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      await tx.execute(
        insertCloseSql({
          tenantId: TENANT_A,
          nodeId: nodeA,
          businessDay: "2026-08-06",
          sequenceNo: 6,
        }),
      );
    });

    const seenByA = await withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ n: string }>(sql`select count(*)::text as n from daily_closes`);
    });
    expect(Number(seenByA.rows[0]?.n)).toBeGreaterThanOrEqual(1);

    const seenByB = await withTenant(suite.admin, TENANT_B, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ n: string }>(sql`select count(*)::text as n from daily_closes`);
    });
    expect(seenByB.rows[0]?.n).toBe("0");
  });

  it("gives daily_closes a composite (tenant_id, node_id) → nodes FK, tenant-consistent", async () => {
    // The FK is the composite (tenant_id, node_id) targeting nodes_tenant_id_key, not a bare node_id:
    // it is what stops a close naming a node of another tenant. A close for tenant A pointing at
    // tenant B's node is refused 23503 (foreign_key_violation). Read as the owner so the FK, not the
    // isolation policy, is unambiguously what bites.
    const error = await captureError(() =>
      suite.admin.execute(
        insertCloseSql({
          tenantId: TENANT_A,
          nodeId: nodeB,
          businessDay: "2026-08-07",
          sequenceNo: 7,
        }),
      ),
    );
    expect(pgErrorCode(error)).toBe("23503");
  });
});
