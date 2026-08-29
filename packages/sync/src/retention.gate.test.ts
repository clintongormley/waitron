import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { recordSubscriberCursor } from "./cursor-report.js";
import { evictSubscriber, lagFor, pruneSyncLog, runRetentionSweep } from "./retention.js";
import type { SyncLane } from "./registry.js";

// Real Postgres, not PGlite: the prune MUST run as a genuine non-superuser member of sync_retention
// so that FORCE ROW LEVEL SECURITY is actually in force and the per-role permissive policy is what
// lets it delete cross-tenant. A superuser prune bypasses RLS entirely and would be a false pass —
// it could not tell a working permissive policy from a missing one (CLAUDE.md §4). The whole
// migration manifest runs (including `sync`, now 0000 + 0001), so the container carries sync_log +
// sync_cursor + the sync_retention role and its policy.
// The sync_pruner (a sync_retention member — the role the prune/lag run as, so FORCE RLS genuinely
// applies and the sync_log_retention permissive policy is exercised) and tailer_login (a sync_tailer
// member, used only to prove the retention policy did NOT leak into sync_tailer) roles are now
// created once in src/testing/global-setup.ts — a shared cluster is one cluster, so a per-file
// `create role` would collide on the second suite. Neither is widened by hand (CLAUDE.md §3).
const postgres = useTemplateDb({ template: "manifest" });

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
 *
 * `tableFor` picks the seeded row's table_name per seq (default: always 'products', unchanged for
 * every single-lane caller); the two-lane retention tests (spec §4e) pass a selector alternating a
 * FAST-lane table (payments, odd seq) and an ORDERED-lane table (sales, even seq) so the fixture
 * looks like a genuine interleaved two-lane stream. pruneSyncLog ignores table_name (its boundary is
 * the min across cursor rows), so which lane a row "belongs" to is decided only by the two cursor
 * rows the tests set — this proves that min waits for whichever lane is slower.
 */
async function seedLog(
  count: number,
  a: string,
  b: string,
  tableFor: (seq: number) => string = () => "products",
): Promise<void> {
  for (let seq = 1; seq <= count; seq += 1) {
    const tenant = seq % 2 === 1 ? a : b;
    await postgres.admin.execute(
      sql`insert into sync_log (seq, origin_id, table_name, op, tenant_id, row_image)
          overriding system value
          values (${seq}, ${ORIGIN}::uuid, ${tableFor(seq)}, 'insert', ${tenant}::uuid, '{}'::jsonb)`,
    );
  }
}

/** The two-lane table selector for `seedLog`: FAST-lane (payments) on odd seq, ORDERED-lane (sales)
 * on even seq — see `seedLog`'s doc comment for why the split proves what it does. */
const twoLaneTableFor = (seq: number): string => (seq % 2 === 1 ? "payments" : "sales");

/** Upserts one subscriber's cursor for ORIGIN on the given lane as the superuser admin. `lane`
 * defaults to 'ordered' so every existing single-lane call is unchanged; the two-lane retention
 * tests pass 'fast'/'ordered' explicitly. The ON CONFLICT arbiter is the 0002 PK
 * (subscriber_id, origin_id, lane). */
async function setCursor(
  subscriberId: string,
  lastApplied: number,
  alive: boolean,
  lane: SyncLane = "ordered",
): Promise<void> {
  await postgres.admin.execute(
    sql`insert into sync_cursor (subscriber_id, origin_id, last_applied_seq, alive, lane)
        values (${subscriberId}, ${ORIGIN}::uuid, ${lastApplied}, ${alive}, ${lane})
        on conflict (subscriber_id, origin_id, lane)
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
  it("0002 repivoted sync_cursor's primary key to (subscriber_id, origin_id, lane)", async () => {
    // The lane split needs TWO cursor rows per (subscriber, origin), so the PK must include lane. Read
    // the live PK columns in index order; the fast and ordered lanes are then distinct rows, not a
    // second write clobbering the first on the old 2-col key.
    const pk = await postgres.admin.execute<{ cols: string[] | null }>(sql`
      select array_agg(a.attname order by array_position(i.indkey, a.attnum))::text[] as cols
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'sync_cursor'::regclass and i.indisprimary`);
    expect(pk.rows[0]!.cols).toEqual(["subscriber_id", "origin_id", "lane"]);
  });

  it("0003 granted DELETE on sync_cursor to sync_retention", async () => {
    const r = await postgres.admin.execute<{ has: boolean }>(
      sql`select has_table_privilege('sync_retention', 'sync_cursor', 'DELETE') as has`,
    );
    expect(r.rows[0]!.has).toBe(true);
  });

  it("0004 created the sync_log_origin_seq_idx index on sync_log (origin_id, seq)", async () => {
    // Read the index's key columns back from the catalog IN KEY ORDER — a DDL tag is not proof the
    // index landed with the right columns (CLAUDE.md §3), same read-back the PK check above does.
    // WHY the index exists: runRetentionSweep prunes every tick with a per-origin range DELETE
    // (`sl.origin_id = c.origin_id AND sl.seq <= c.min_seq`, retention.ts); with only sync_log's `seq`
    // PK and no index on origin_id that join seq-scans the whole transport log each tick — worst
    // exactly when a subscriber stalls and the log grows.
    const idx = await postgres.admin.execute<{ cols: string[] | null }>(sql`
      select array_agg(a.attname order by array_position(i.indkey, a.attnum))::text[] as cols
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'sync_log'::regclass and c.relname = 'sync_log_origin_seq_idx'`);
    expect(idx.rows[0]!.cols).toEqual(["origin_id", "seq"]);
  });

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

describe("fast and ordered lanes track independent cursors; retention waits for the slower lane (spec §4e)", () => {
  it("holds sync_log at the min across BOTH lane cursors, and advancing the ahead lane alone does not move the boundary", async () => {
    // Two cursor rows per (subscriber, origin) after 0002. pruneSyncLog groups by origin_id and takes
    // min(last_applied_seq) across BOTH lane rows, so the log is held at the SLOWER lane — a fast-lane
    // row below the fast cursor but above the ordered cursor is HELD, the deliberate over-retention of
    // spec §4e. Prove-by-deletion of the "min across BOTH lanes" boundary (CLAUDE.md §1): advancing ONLY
    // the already-ahead lane must NOT move the boundary, and advancing the TRAILING lane must.
    await resetOutbox();
    const a = await seedTenant(postgres.admin);
    const b = await seedTenant(postgres.admin);
    await seedLog(10, a, b, twoLaneTableFor);

    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    try {
      // FAST ahead (8), ORDERED behind (3): boundary = 3 (the slower, ordered lane).
      await setCursor("main", 8, true, "fast");
      await setCursor("main", 3, true, "ordered");
      const first = await pruneSyncLog(pruner);
      expect(first).toEqual({ pruned: 3, highWater: 3n }); // held at the ordered (slower) lane
      expect(await remainingSeqs()).toEqual([4, 5, 6, 7, 8, 9, 10]);
      // seq 5 is a FAST-lane (payments) row below the fast cursor (8) — yet it is HELD, because the
      // ordered cursor (3) has not passed it. That is retention waiting for the slower lane.

      // Advancing ONLY the ahead (fast) lane does not move the boundary — the ordered lane still holds it.
      await setCursor("main", 10, true, "fast");
      const second = await pruneSyncLog(pruner);
      expect(second).toEqual({ pruned: 0, highWater: 3n }); // boundary UNMOVED
      expect(await remainingSeqs()).toEqual([4, 5, 6, 7, 8, 9, 10]);

      // Advancing the TRAILING (ordered) lane moves it.
      await setCursor("main", 6, true, "ordered");
      const third = await pruneSyncLog(pruner);
      expect(third).toEqual({ pruned: 3, highWater: 6n }); // boundary tracks the slower lane
      expect(await remainingSeqs()).toEqual([7, 8, 9, 10]);
    } finally {
      await pruner.close();
    }
  });

  it("holds at the FAST lane when the fast lane is the slower one (the control in the other direction)", async () => {
    // CLAUDE.md §1: the reverse direction must make the two answers visibly differ. Here FAST is behind,
    // so the boundary is the fast lane's seq — not the ordered lane's, which a naive per-lane-max prune
    // (deliberately NOT built, spec §4e) would have used.
    await resetOutbox();
    const a = await seedTenant(postgres.admin);
    const b = await seedTenant(postgres.admin);
    await seedLog(10, a, b, twoLaneTableFor);
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    try {
      await setCursor("main", 2, true, "fast"); // fast is the slower lane now
      await setCursor("main", 9, true, "ordered");
      const result = await pruneSyncLog(pruner);
      expect(result).toEqual({ pruned: 2, highWater: 2n }); // held at the FAST lane
      expect(await remainingSeqs()).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    } finally {
      await pruner.close();
    }
  });
});

describe("recordSubscriberCursor gives the source cross-node visibility (spec §3.1)", () => {
  it("recordSubscriberCursor makes a source-side prune advance (cross-node visibility, spec §3.1)", async () => {
    await resetOutbox();
    const a = await seedTenant(postgres.admin);
    const b = await seedTenant(postgres.admin);
    // sync_log rows are ORIGIN's own captured writes; a source pruning ITS OWN log needs an
    // origin=ORIGIN cursor, which in the real topology only a subscriber's report creates.
    await seedLog(6, a, b);
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      // Control (the §1 gap): with NO reported cursor for origin=ORIGIN, the source prunes nothing.
      expect(await pruneSyncLog(pruner)).toEqual({ pruned: 0, highWater: 0n });
      expect(await remainingSeqs()).toEqual([1, 2, 3, 4, 5, 6]);
      // A subscriber reports it has applied up to seq 4 of ORIGIN → the source can now release 1..4.
      await recordSubscriberCursor(tailer, {
        subscriberId: "peerB",
        originId: ORIGIN,
        lane: "ordered",
        lastAppliedSeq: 4n,
      });
      expect(await pruneSyncLog(pruner)).toEqual({ pruned: 4, highWater: 4n });
      // Monotonic: a stale lower report never regresses; heartbeat: updated_at bumps on a same-seq report.
      const before = await postgres.admin.execute<{ ts: string }>(
        sql`select updated_at::text as ts from sync_cursor where subscriber_id = 'peerB'`,
      );
      await recordSubscriberCursor(tailer, {
        subscriberId: "peerB",
        originId: ORIGIN,
        lane: "ordered",
        lastAppliedSeq: 2n, // lower → must NOT regress
      });
      const after = await postgres.admin.execute<{ seq: string; ts: string }>(
        sql`select last_applied_seq::text as seq, updated_at::text as ts from sync_cursor where subscriber_id = 'peerB'`,
      );
      expect(after.rows[0]!.seq).toBe("4"); // held (monotonic)
      expect(after.rows[0]!.ts).not.toBe(before.rows[0]!.ts); // updated_at bumped (heartbeat)
    } finally {
      await tailer.close();
      await pruner.close();
    }
  });
});

describe("lagFor as sync_tailer needs a tenant context — the box-status durability guard", () => {
  it("a bare sync_tailer reads lag 0 (RLS hides sync_log); the same member under withTenant reads the real lag", async () => {
    // This is the committed guard for GET /api/box/status's `replication` summary (onboarding slice
    // 4a, boot.ts wiring). box-status hands the reader the sync pool, which connects as a `sync_tailer`
    // member. `sync_tailer`'s SELECT on `sync_log` is fenced by the per-tenant `sync_log_tenant_isolation`
    // policy (no TO clause → applies under FORCE RLS to this login too), so with NO `app.tenant_id` set
    // `current_tenant_id()` is NULL and a bare `lagFor(syncDb)` sees ZERO `sync_log` rows — reporting
    // every subscriber at lag 0, a SILENT FALSE-HEALTHY. That reading is fiscally dangerous: an operator
    // who trusts a lag-0 box during a promotion (promotion/failover spec §5.1's durability surface)
    // discards fiscal records the peer never actually replicated — an unrecoverable loss. The box wires
    // `lagFor` INSIDE `withTenant(till.tenantId)` precisely to avoid this; this test fails if anyone
    // collapses that back to a bare `lagFor`.
    //
    // Prove-by-deletion (CLAUDE.md §1): the "deletion" is the tenant context. Removed → lag 0 (the bug);
    // present → the real lag 7. The two answers VISIBLY differ (0 vs 7), so the measurement separates the
    // hypotheses (a §1 control in the other direction).
    await resetOutbox();
    const tenant = await seedTenant(postgres.admin);
    // One tenant only (pass it as both a and b to seedLog, so every seq 1..10 carries `tenant`), so the
    // single-venue box's own tenant context reveals the WHOLE log — matching the appliance shape.
    await seedLog(10, tenant, tenant);
    await setCursor("box_sub", 3, true); // applied 3 of 10 → true lag 7

    const tailer = await postgres.pg.connectAs("tailer_login", "tp");
    try {
      // --- Bare sync_tailer, NO tenant context: RLS hides sync_log → coalesce(NULL, 3) − 3 = 0. ---
      const bare = await lagFor(tailer);
      const bareSub = bare.find((l) => l.subscriberId === "box_sub")!;
      expect(bareSub).toMatchObject({ originId: ORIGIN, lag: 0n }); // the false-healthy reading

      // --- Same member UNDER withTenant: sees the tenant's log (max seq 10) → 10 − 3 = 7. NO asAppUser
      //     (that SET ROLE app_user would drop the sync_tailer SELECT); withTenant only sets the GUC. ---
      const scoped = await withTenant(tailer, tenant, (tx) => lagFor(tx));
      const scopedSub = scoped.find((l) => l.subscriberId === "box_sub")!;
      expect(scopedSub).toMatchObject({ originId: ORIGIN, lag: 7n }); // the real lag the box must report

      expect(bareSub.lag).not.toBe(scopedSub.lag); // the two directions disagree — the context is load-bearing
    } finally {
      await tailer.close();
    }
  });
});

describe("evictSubscriber releases a dead subscriber's cursor (spec §3.3/§3.4)", () => {
  it("evictSubscriber releases a dead subscriber's cursor so retention advances past it", async () => {
    await resetOutbox();
    const a = await seedTenant(postgres.admin);
    const b = await seedTenant(postgres.admin);
    await seedLog(10, a, b);
    await setCursor("peerB", 10, true); // caught up
    await setCursor("cloud", 4, false); // dead, holding the log at 4
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    try {
      expect(await pruneSyncLog(pruner)).toEqual({ pruned: 4, highWater: 4n }); // held by `cloud`
      const evicted = await evictSubscriber(pruner, "cloud");
      expect(evicted).toEqual({ deleted: 1 });
      expect(await pruneSyncLog(pruner)).toEqual({ pruned: 6, highWater: 10n }); // advances past dead `cloud`
      expect(await remainingSeqs()).toEqual([]);
    } finally {
      await pruner.close();
    }
  });

  it("the DELETE grant is load-bearing: without it evictSubscriber cannot release the cursor", async () => {
    await resetOutbox();
    const a = await seedTenant(postgres.admin);
    const b = await seedTenant(postgres.admin);
    await seedLog(2, a, b);
    await setCursor("cloud", 0, false);
    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    try {
      await postgres.admin.execute(sql.raw(`revoke delete on sync_cursor from sync_retention`));
      try {
        await expect(evictSubscriber(pruner, "cloud")).rejects.toThrow(); // 42501 permission denied
      } finally {
        await postgres.admin.execute(sql.raw(`grant delete on sync_cursor to sync_retention`));
      }
      expect(await evictSubscriber(pruner, "cloud")).toEqual({ deleted: 1 }); // restored → works
    } finally {
      await pruner.close();
    }
  });
});

describe("runRetentionSweep runs the real prune + lag each tick, and NEVER evicts (spec §3.2/§3.4)", () => {
  it("prunes to the min across ALL cursors (dead subscriber held), alarms the stalled one, and leaves its cursor in place", async () => {
    // The scheduled loop with its REAL defaults — no injected prune/lag, exactly the wiring boot
    // starts (boot passes neither), so this exercises pruneSyncLog/lagFor through runRetentionSweep,
    // not the injected doubles the hermetic retention-sweep.test.ts uses. One tick: the injected
    // `sleep` aborts the loop so it prunes exactly once.
    //
    // The guardrail, proven end-to-end (spec §3.4, an inherited owner decision):
    //   - NEVER alive-filters the prune — the DOWN `cloud` (cursor 4) HOLDS the log at 4, so 5..10
    //     survive; an alive-filtered prune would have taken the live-only min (10) and wiped the log.
    //   - NEVER evicts — `cloud`'s cursor row is still present after the sweep; only the alarm fired.
    await resetOutbox();
    const a = await seedTenant(postgres.admin);
    const b = await seedTenant(postgres.admin);
    await seedLog(10, a, b);
    await setCursor("peerB", 10, true); // caught up, alive → lag 0, no alarm
    await setCursor("cloud", 4, false); // down, holding the log at 4 → lag 6, past the threshold

    const pruner = await postgres.pg.connectAs("sync_pruner", "pp");
    const controller = new AbortController();
    const logged: Array<{ level: string; code: string; params: Record<string, unknown> }> = [];
    try {
      await runRetentionSweep({
        db: pruner,
        sleep: async () => controller.abort(),
        signal: controller.signal,
        tickMs: 10,
        lagAlarmRows: 5,
        log: (level, code, params) => logged.push({ level, code, params: params ?? {} }),
      });

      // Held at the min across ALL cursors (4), NOT the live-only min (10) — the never-alive-filter half.
      expect(await remainingSeqs()).toEqual([5, 6, 7, 8, 9, 10]);
      // The real prune's result is reported on the swept line (highWater is stringified — see the sweep).
      expect(logged.find((l) => l.code === "sync.retention_swept")).toMatchObject({
        level: "info",
        params: { pruned: 4, highWater: "4" },
      });
      // The stalled `cloud` (lag 6 > 5) alarmed via the REAL lagFor; `peerB` (lag 0) did not. `lag` is
      // stringified at this alarm edge to preserve precision (consistent with `highWater` above).
      const stalled = logged.filter((l) => l.code === "sync.stream_stalled");
      expect(stalled).toHaveLength(1);
      expect(stalled[0]).toMatchObject({
        level: "error",
        params: { subscriberId: "cloud", originId: ORIGIN, lag: "6" },
      });
      // NEVER evicts: the dead subscriber's cursor row is untouched — the alarm INFORMS a manual
      // eviction, it does not perform one.
      const cursor = await postgres.admin.execute<{ n: string }>(
        sql`select count(*)::int::text as n from sync_cursor where subscriber_id = 'cloud'`,
      );
      expect(cursor.rows[0]!.n).toBe("1");
    } finally {
      await pruner.close();
    }
  });
});
