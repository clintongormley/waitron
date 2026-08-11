import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "@waitron/db/testing/postgres.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { lagFor, pruneSyncLog } from "./retention.js";

// Real Postgres, not PGlite: the prune MUST run as a genuine non-superuser member of sync_retention
// so that FORCE ROW LEVEL SECURITY is actually in force and the per-role permissive policy is what
// lets it delete cross-tenant. A superuser prune bypasses RLS entirely and would be a false pass —
// it could not tell a working permissive policy from a missing one (CLAUDE.md §4). The whole
// migration manifest runs (including `sync`, now 0000 + 0001), so the container carries sync_log +
// sync_cursor + the sync_retention role and its policy.
const postgres = useRealPostgres({
  start: () =>
    startMigratedPostgres({
      dockerRequired:
        "The sync retention-gate suite requires a running Docker daemon. It cannot be skipped: " +
        "PGlite connects as a superuser and bypasses FORCE ROW LEVEL SECURITY, so it cannot exercise " +
        "the non-superuser sync_retention prune or prove the per-role permissive policy is what makes " +
        "the cross-tenant DELETE possible — the whole point of this suite (CLAUDE.md §4).",
      migrate: (uri) => runMigrationSets(uri, migrationOptionsFor(manifestSets(), null)),
    }),
  // Two non-superuser, non-BYPASSRLS LOGIN members created once the container is up:
  //  - sync_pruner: a member of sync_retention — the role the prune/lag actually run as, so FORCE RLS
  //    genuinely applies and the sync_log_retention permissive policy is exercised as intended.
  //  - tailer_login: a member of sync_tailer — used only to prove the new retention policy did NOT
  //    leak into sync_tailer (a tailer member must still see only its own tenant).
  // Neither role is widened by hand; each inherits its group's grants (CLAUDE.md §3 "never widen").
  setup: async ({ admin }) => {
    await admin.execute(
      sql.raw(`create role sync_pruner login password 'pp' in role sync_retention`),
    );
    await admin.execute(
      sql.raw(`create role tailer_login login password 'tp' in role sync_tailer`),
    );
  },
  timeoutMs: 180_000,
});

// One producing origin (gate 7 is single-origin), and two subscribers matching the findings doc.
const ORIGIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Clears the outbox so every test starts from a known, order-independent state (one shared
 * container). sync_log/sync_cursor are plain tables to the admin superuser — no truncate trigger. */
async function resetOutbox(): Promise<void> {
  await postgres.admin.execute(sql`delete from sync_log`);
  await postgres.admin.execute(sql`delete from sync_cursor`);
}

/**
 * Seeds `sync_log` seqs 1..count for ORIGIN, alternating the two tenants by parity (odd → a, even →
 * b), using OVERRIDING SYSTEM VALUE so the seqs are EXACTLY 1..count regardless of the identity
 * sequence's state in the shared container. Alternating tenants is deliberate: a per-tenant prune
 * would pass on a single-tenant fixture and prove nothing, so the low seqs a correct prune deletes
 * must span BOTH tenants (CLAUDE.md §1 — a measurement where both answers look alike measures
 * nothing). Inserted as the superuser admin (RLS bypassed; pure setup).
 */
async function seedLog(count: number, a: string, b: string): Promise<void> {
  for (let seq = 1; seq <= count; seq += 1) {
    const tenant = seq % 2 === 1 ? a : b;
    await postgres.admin.execute(
      sql`insert into sync_log (seq, origin_id, table_name, op, tenant_id, row_image)
          overriding system value
          values (${seq}, ${ORIGIN}::uuid, 'products', 'insert', ${tenant}::uuid, '{}'::jsonb)`,
    );
  }
}

/** Upserts one subscriber's cursor for ORIGIN as the superuser admin. */
async function setCursor(subscriberId: string, lastApplied: number, alive: boolean): Promise<void> {
  await postgres.admin.execute(
    sql`insert into sync_cursor (subscriber_id, origin_id, last_applied_seq, alive)
        values (${subscriberId}, ${ORIGIN}::uuid, ${lastApplied}, ${alive})
        on conflict (subscriber_id, origin_id)
          do update set last_applied_seq = excluded.last_applied_seq, alive = excluded.alive`,
  );
}

/** Remaining sync_log seqs, ascending (admin read-back, RLS-bypassed). */
async function remainingSeqs(): Promise<number[]> {
  // Cast to int[] (seqs are 1..10 here): node-postgres parses an int4[] to numbers, but a bigint[]
  // comes back as an array of strings, which would not deep-equal a numeric literal array.
  const r = await postgres.admin.execute<{ seqs: number[] | null }>(
    sql`select array_agg(seq order by seq)::int[] as seqs from sync_log`,
  );
  return r.rows[0]!.seqs ?? [];
}

/** Count of sync_log rows for a tenant (admin read-back). */
async function tenantRows(tenantId: string): Promise<number> {
  const r = await postgres.admin.execute<{ n: string }>(
    sql`select count(*)::int::text as n from sync_log where tenant_id = ${tenantId}::uuid`,
  );
  return Number(r.rows[0]!.n);
}

describe("bounded sync_log retention under a down subscriber (gate 7)", () => {
  it("prunes to the min across ALL cursors — a down subscriber holds the log — then drains when it catches up", async () => {
    // Failing case (findings GATE 7): the log is pruned to the LIVE-ONLY min (=10), destroying seq
    // 5..10 that the down `cloud` subscriber has not yet applied — silent data loss. Control in the
    // other direction: the correct min across ALL cursors (=4, held by down `cloud`) retains 5..10,
    // and the two minima VISIBLY differ (4 vs 10) with 4 vs 10 rows eligible to delete.
    await resetOutbox();
    const a = await seedTenant(postgres.admin);
    const b = await seedTenant(postgres.admin);
    await seedLog(10, a, b);
    await setCursor("peerB", 10, true); // caught up, alive
    await setCursor("cloud", 4, false); // down, behind

    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    try {
      // --- The control that makes the data-loss direction concrete (compute both minima). ---
      const minima = await postgres.admin.execute<{ min_all: string; min_live: string }>(sql`
        select
          min(last_applied_seq)::text as min_all,
          min(last_applied_seq) filter (where alive)::text as min_live
        from sync_cursor`);
      expect(minima.rows[0]!.min_all).toBe("4"); // the correct high-water: min across ALL
      expect(minima.rows[0]!.min_live).toBe("10"); // the naive live-only min
      expect(minima.rows[0]!.min_all).not.toBe(minima.rows[0]!.min_live); // they disagree
      // Rows a prune to each minimum WOULD delete: naive live-only (10) deletes ALL 10 → data loss.
      const wouldDelete = await postgres.admin.execute<{ correct: string; naive: string }>(sql`
        select
          count(*) filter (where seq <= 4)::int::text as correct,
          count(*) filter (where seq <= 10)::int::text as naive
        from sync_log`);
      expect(wouldDelete.rows[0]!.correct).toBe("4");
      expect(wouldDelete.rows[0]!.naive).toBe("10"); // the whole log — the bug gate 7 controls for

      // --- lagFor: cloud is stalled (lag 6, alive false), peerB is caught up (lag 0, alive true). ---
      const lags = await lagFor(pruner);
      const cloud = lags.find((l) => l.subscriberId === "cloud")!;
      const peer = lags.find((l) => l.subscriberId === "peerB")!;
      expect(cloud).toMatchObject({ originId: ORIGIN, lag: 6n, alive: false });
      expect(peer).toMatchObject({ originId: ORIGIN, lag: 0n, alive: true });

      // --- The correct prune, run as the non-superuser sync_retention member. ---
      const aBefore = await tenantRows(a);
      const bBefore = await tenantRows(b);
      const first = await pruneSyncLog(pruner);
      expect(first).toEqual({ pruned: 4, highWater: 4n });
      expect(await remainingSeqs()).toEqual([5, 6, 7, 8, 9, 10]); // 1..4 gone, 5..10 held for `cloud`

      // Cross-tenant proof: the prune (as sync_retention) deleted rows of BOTH tenants, not just one.
      expect(await tenantRows(a)).toBeLessThan(aBefore); // tenant a lost rows (seq 1, 3)
      expect(await tenantRows(b)).toBeLessThan(bBefore); // tenant b lost rows (seq 2, 4)

      // --- Bounded: once `cloud` confirms 10, the min advances and the log drains to 0. ---
      await setCursor("cloud", 10, true);
      const second = await pruneSyncLog(pruner);
      expect(second).toEqual({ pruned: 6, highWater: 10n });
      expect(await remainingSeqs()).toEqual([]); // drained to 0 — growth was bounded by the slow one
    } finally {
      await pruner.close();
    }
  });

  it("does not prune when there are no subscribers — an empty min must not delete the whole log", async () => {
    // Failing case: with no sync_cursor rows the min is empty (NULL); treating that as 0-or-anything
    // and running the delete would wipe the whole log even though NOTHING has confirmed a single row.
    // Control: nothing is deleted and highWater is 0.
    await resetOutbox();
    const a = await seedTenant(postgres.admin);
    const b = await seedTenant(postgres.admin);
    await seedLog(3, a, b); // rows present, but sync_cursor is empty

    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    try {
      const result = await pruneSyncLog(pruner);
      expect(result).toEqual({ pruned: 0, highWater: 0n });
      expect(await remainingSeqs()).toEqual([1, 2, 3]); // the whole log survives
    } finally {
      await pruner.close();
    }
  });

  it("the sync_log_retention policy is load-bearing: removing it blocks the cross-tenant prune", async () => {
    // Prove-a-guard-by-deletion (CLAUDE.md §1/§3 "a GRANT PostgreSQL accepted is not one that did
    // anything"): with the permissive policy DROPPED, the non-superuser sync_pruner sees only
    // sync_log_tenant_isolation, and with no app.tenant_id current_tenant_id() is NULL, so the DELETE
    // matches ZERO rows — the prune is genuinely powerless without the policy. Restored, it deletes
    // all four cross-tenant rows. This is the difference that proves the policy, not its mere presence.
    await resetOutbox();
    const a = await seedTenant(postgres.admin);
    const b = await seedTenant(postgres.admin);
    await seedLog(4, a, b);
    await setCursor("peerB", 4, true); // a correct prune would delete all four (seq <= 4)

    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    try {
      await postgres.admin.execute(sql.raw(`drop policy sync_log_retention on sync_log`));
      try {
        // Blocked: the cursor min is 4 (so the prune proceeds past the no-subscribers short-circuit),
        // but RLS filters every row out of the DELETE, so it removes nothing.
        const blocked = await pruneSyncLog(pruner);
        expect(blocked.pruned).toBe(0);
        expect(await remainingSeqs()).toEqual([1, 2, 3, 4]); // nothing deleted — policy was load-bearing
      } finally {
        // Restore for the other tests (one shared database); then confirm it now works.
        await postgres.admin.execute(
          sql.raw(
            `create policy sync_log_retention on sync_log
               for all to sync_retention using (true) with check (true)`,
          ),
        );
      }

      const restored = await pruneSyncLog(pruner);
      expect(restored).toEqual({ pruned: 4, highWater: 4n }); // policy back → cross-tenant delete works
      expect(await remainingSeqs()).toEqual([]);
    } finally {
      await pruner.close();
    }
  });

  it("did not leak into sync_tailer: a tailer member under withTenant still sees only its own tenant", async () => {
    // The new policy is TO sync_retention only. A sync_tailer member is not a member of
    // sync_retention, so the retention policy must NOT apply to it — sync_tailer stays fenced to its
    // own tenant by sync_log_tenant_isolation, exactly as capture.gate.test.ts sub-test 4 requires.
    // Failing case: the retention policy leaks (e.g. it were TO PUBLIC), and the tailer sees both
    // tenants' rows. Control (both directions): under A only A is visible; under B only B.
    await resetOutbox();
    const a = await seedTenant(postgres.admin);
    const b = await seedTenant(postgres.admin);
    await postgres.admin.execute(
      sql`insert into sync_log (origin_id, table_name, op, tenant_id, row_image) values
            (${ORIGIN}::uuid, 'products', 'insert', ${a}::uuid, '{}'::jsonb),
            (${ORIGIN}::uuid, 'products', 'insert', ${b}::uuid, '{}'::jsonb)`,
    );

    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      const visible = async (tenant: string): Promise<{ av: string; bv: string }> => {
        const r = await withTenant(tailer, tenant, (tx) =>
          tx.execute<{ av: string; bv: string }>(sql`
            select count(*) filter (where tenant_id = ${a}::uuid)::text as av,
                   count(*) filter (where tenant_id = ${b}::uuid)::text as bv
            from sync_log`),
        );
        return r.rows[0]!;
      };
      expect(await visible(a)).toEqual({ av: "1", bv: "0" }); // under A: only A
      expect(await visible(b)).toEqual({ av: "0", bv: "1" }); // under B: only B (the retention policy did not leak)
    } finally {
      await tailer.close();
    }
  });
});
