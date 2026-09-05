import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { seedNode } from "../testing/seed.js";
import { withTenant } from "../tenancy.js";
import { locations, tenants } from "./tenants.js";

// Real Postgres, not PGlite, and not describeEachTarget: the headline assertions are the two
// append-only TRIGGERS (`daily_closes_immutable` and the BEFORE TRUNCATE statement trigger, both
// WT001), each proven against a role that HAS been granted the privilege inside a rolled-back
// transaction. PGlite connects as a superuser that can DISABLE TRIGGER unconditionally, so a PGlite
// pass would be a false pass (CLAUDE.md §4). The column-presence and FK assertions would pass on
// either target; they ride along on the one container this suite already needs. `app_user`'s own
// withheld UPDATE/DELETE — the first layer, which fires before the trigger — is pinned by the
// privilege matrix (packages/fiscal-verifactu/src/privileges.expected.ts).

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

describe("frozen daily close schema (append-only triggers, columns, composite FK)", () => {
  const suite = useTemplateDb({ template: "core" });

  // Scaffolding seeded once as the owner (superuser bypasses RLS — pure setup). Registered after the
  // helper's own hook, which vitest runs first; if it throws this one never runs, so `suite.admin`
  // is never read unstarted (verified pattern, park-retrieve.test.ts).
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

  it("writes and reads back a daily_closes row (the column list, and the snapshot jsonb)", async () => {
    // The positive control for the trigger rejections below: without a write that SUCCEEDS, a
    // rejection could equally mean the role has no access to the table at all. It also pins the column
    // list a close is written with and that the nested snapshot jsonb round-trips.
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

  it("rejects UPDATE of daily_closes by the append-only trigger even when the privilege is granted", async () => {
    // The layered proof. app_user's withheld UPDATE — the first layer, pinned by the privilege
    // matrix in packages/fiscal-verifactu — refuses the statement at privilege-check time, so nothing
    // that matrix covers ever reaches the trigger, and a trigger nobody has seen fire is a comment,
    // not a backstop. Grant UPDATE inside a transaction that rolls back, and watch the second layer
    // (daily_closes_immutable → reject_mutation() → WT001) catch it. Remove that trigger from the
    // migration and THIS test goes red while the matrix stays green.
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

  it("gives daily_closes a composite (tenant_id, node_id) → nodes FK, tenant-consistent", async () => {
    // The FK is the composite (tenant_id, node_id) targeting nodes_tenant_id_key, not a bare node_id:
    // it is what stops a close naming a node of another tenant. A close for tenant A pointing at
    // tenant B's node is refused 23503 (foreign_key_violation). Written as the owner so the FK is
    // unambiguously what bites.
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
