# Sync Transport Slice 2 — Payments Fast Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, tighter replication cadence carrying only `payments` + `payment_refunds` on an independent per-`(subscriber, origin)` cursor, so the customer-money (double-charge) exposure active-active selling creates is mirrored ahead of the rest of the commercial stream.

**Architecture:** A `lane` dimension is added to `sync_cursor` (PK repivots to `(subscriber_id, origin_id, lane)`) so the fast and ordered streams track independent cursors. The enrolment registry marks `payments`/`payment_refunds` as `fast` and derives per-lane table lists (`tablesForLane`). `readSyncLogSince` and `/sync-api/log` gain a lane/table filter, `applyBatch`/`syncPullOnce`/`runSyncPull` thread a `lane`, and `boot.ts` starts two lane-scoped pull loops (ordered at `minTickMs`, fast at a new `fastMinIdleMs`) against the same peers. No new correctness machinery: the cross-lane FK hazard is absorbed by the pre-existing `23503` park.

**Tech Stack:** TypeScript, Drizzle raw-SQL migrations, Hono, undici, Vitest, PGlite + Testcontainers.

**Spec:** docs/superpowers/specs/2026-08-15-sync-transport-slice2-design.md

## Global Constraints

- **TDD, always.** Failing test first, watch it fail for the stated reason, minimal implementation, watch it pass, commit. Prove every guard **by deletion** where the shape allows (remove/revert it, watch the test fail, restore); where a hard PK forbids reverting the schema in-test, prove the invariant with a **two-direction control** whose answers visibly differ (`CLAUDE.md` §1 — "a measurement where both answers look alike measures nothing").
- **Every commit is `git commit -s`.** Feature work happens in this worktree (`waitron-feat-sync-transport-slice2`), never on `main` (`CLAUDE.md` §6). Do NOT commit at the end of this planning task — the plan file is the only artifact.
- **Coverage thresholds are `statements 98 / lines 98 / functions 98 / branches 95`** for both `@waitron/sync` (`packages/sync/vitest.config.ts:24`) and `apps/server` (`apps/server/vitest.config.ts`). CI shards run `test:coverage`, **not** `test` — verify green with `pnpm --filter <pkg> test:coverage` before believing a package is green (`CLAUDE.md` §2).
- **Run each touched package UNFILTERED at least once.** A name-filtered run skips a package's in-package cross-cutting guards — for `@waitron/sync` that is `registry.test.ts:146-155`'s `^[a-z_]+$` enrolled-name guard. A scoped run that selects nothing REPORTS SUCCESS (`CLAUDE.md` §2/§4). The tree-wide guards (errors-reachability, english-only, teardown) run from the **root** Vitest project via the pre-push hook / CI `lint` job, not from these packages (`CLAUDE.md` §4).
- **Real Postgres, never PGlite, for anything under RLS / the non-superuser roles / GRANT-effectiveness / concurrency / ordering.** PGlite connects as a superuser, bypasses `FORCE ROW LEVEL SECURITY`, and serialises every query onto one backend — a false pass for all of the above (`CLAUDE.md` §4). `TESTCONTAINERS_RYUK_DISABLED=true` is required locally or container suites hang at the 180s `hookTimeout` (`packages/sync/vitest.config.ts:11`).
- **Error codes name the DOMAIN concept, `sync.*`, never the package, and are never renamed once shipped.** Adding a `lane` field to the `sync.stream_stalled` transport variant's param SHAPE is permitted (a param-shape change, not a rename — `CLAUDE.md` §3). No `sync.*` param may carry row content: `lane` is a fixed enum, a schema fact (`errors.ts:6-15`; spec §7).
- **`sync_cursor` migrations are hand-written CUSTOM.** `sync_cursor`/`sync_log` are raw-SQL tables drizzle-kit does not model, so there is nothing to diff and no `drizzle-kit generate` for this package — **verified: `packages/sync` carries no `drizzle.config.*` and no `db:generate*` script.** The migration `.sql`, its `_journal.json` entry, and its `<tag>_snapshot.json` copy are ALL written by hand (the `0000`/`0001` idiom; `migrations.ts:9-14` — the migrator reads only the journal + `<tag>.sql`, never the snapshot at runtime).
- **Never build SQL by string concatenation.** The table filter binds the array as one parameter (`table_name = any($n)`), so no identifier is interpolated (`CLAUDE.md` §3; the values are fixed registry names regardless).
- **Both peers upgrade together, so the wire lane param is a clean break** — the single undifferentiated slice-1 stream (all 14 tables in one pull) no longer exists; every pull is lane-scoped. Permitted because nothing is deployed (`CLAUDE.md` §3, spec §4c).
- **No new `tenant_id`-bearing table.** `sync_cursor` stays `tenant_id`-free and RLS-free (`0000_sync_outbox.sql:95-99`), so no `inmutabilidad` FORCE-RLS scan run is needed (spec §8).
- **English-only guard covers `packages/sync/src`** (`apps/*` out of scope by recorded decision). Every new identifier, fixture value and comment in `packages/sync` is English; `lane`/`fast`/`ordered` are English.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `packages/sync/drizzle/0002_sync_cursor_lane.sql` | The `lane` column + PK repivot to `(subscriber_id, origin_id, lane)`. Hand-written custom migration. |
| `packages/sync/drizzle/meta/0002_snapshot.json` | Convention-only snapshot copy of `0001_snapshot.json` (new `id`, `prevId` = 0001's `id`). Never read at runtime. |

**Modified:**

| File | Change |
| --- | --- |
| `packages/sync/drizzle/meta/_journal.json` | Append the `0002_sync_cursor_lane` entry (idx 2). |
| `packages/sync/src/registry.ts` | `SyncLane` type + `lane` field on all 14 `EnrolledTable` entries + `tablesForLane(lane)`. |
| `packages/sync/src/apply.ts` | Thread `lane` through `ApplyBatchOptions`, `readCursors`, `advanceCursor` (3-col arbiter), the seq-skip. |
| `packages/sync/src/source.ts` | `ReadSyncLogArgs.tables?: string[]` → `and table_name = any($n)`. |
| `packages/sync/src/pull.ts` | Lane-scoped `syncPullOnce`/`runSyncPull` (request `?lane=`, read/advance the lane cursor); progress-guard comment names the cross-lane cause; `lane` on `sync.stream_stalled`/`sync.pull_failed`. |
| `packages/sync/src/errors.ts` | `lane` on the `sync.stream_stalled` transport variant. |
| `packages/sync/src/index.ts` | Export `SyncLane`, `tablesForLane`. |
| `apps/server/src/sync-api.ts` | `/sync-api/log` gains `?lane=`, mapped via `tablesForLane`; unknown/missing clamps to `ordered`. |
| `apps/server/src/config.ts` | `fastMinIdleMs` on `SyncTransportConfig`, from `WAITRON_SYNC_FAST_TICK_MS` (positive-int, default 1000). |
| `apps/server/src/boot.ts` | Start TWO lane-scoped `runSyncPull` invocations (`Promise.all`), under the existing abort/teardown. |
| `packages/sync/src/retention.gate.test.ts` | `setCursor` gains a `lane` param (3-col arbiter); PK-shape assertion; the two-lane retention-boundary tests. |
| `packages/sync/src/registry.test.ts`, `apply.gate.test.ts`, `source.gate.test.ts`, `pull.gate.test.ts`, `pull.test.ts`, `errors.test.ts` | Extend for the lane split. |
| `apps/server/src/sync-api.rls.test.ts`, `config.test.ts`, `boot.test.ts`, `sync-e2e.rls.test.ts` | Extend for `?lane=`, `fastMinIdleMs`, two invocations, and the two-lane end-to-end. |

**Untouched, verified — do NOT edit:**

- `packages/sync/src/retention.ts` — `pruneSyncLog` `group by origin_id` + `min` already spans both lane rows (spec §4a); `lagFor` locates rows via `.find` + `toMatchObject` with no row-count, so the extra lane rows are invisible to its gate test (`retention.gate.test.ts:134-138`; spec §4a). Only the `setCursor` **fixture** changes.
- `packages/sync/src/apply-sql.ts`, `wire.ts` — unaffected by the lane split.
- `packages/migrations/migrations.manifest.json` — points at the `sync` folder; the journal enumerates its members, so `0002` needs no manifest edit (spec §5). The one shared file with the workforce-roster branch is `apps/server/src/boot.ts` (the sync block, `boot.ts:348-386`, distinct lines from the `mountWorkforceApi` mount at `:340` — a trivial textual merge; spec §9).

---

## Task 1: Migration `0002_sync_cursor_lane.sql` — `lane` column + 3-col PK repivot

**Files:**
- Create: `packages/sync/drizzle/0002_sync_cursor_lane.sql` (hand-written custom migration).
- Create: `packages/sync/drizzle/meta/0002_snapshot.json` (copy of `0001_snapshot.json`).
- Modify: `packages/sync/drizzle/meta/_journal.json` (append the `0002` entry).
- Modify: `packages/sync/src/retention.gate.test.ts` (`setCursor` gains a `lane` param; add the PK-shape assertion).

**Interfaces:**
- Consumes: the full migration manifest via `migrationOptionsFor(manifestSets(), null)` (unchanged — the journal enumerates members).
- Produces: `sync_cursor` with column `lane text NOT NULL DEFAULT 'ordered'` and PK `(subscriber_id, origin_id, lane)`. No new code symbols.

- [ ] **Step 1: Update `setCursor` to the 3-col arbiter and add the PK-shape test (both fail first).** In `packages/sync/src/retention.gate.test.ts`, change the `setCursor` helper (`:73-80`) to carry a `lane` (defaulting to `"ordered"` so every existing call is unchanged) and pivot its `ON CONFLICT` to the new PK:

```ts
/** Upserts one subscriber's cursor for ORIGIN on the given lane as the superuser admin. `lane`
 * defaults to 'ordered' so every existing single-lane call is unchanged; the two-lane retention
 * tests pass 'fast'/'ordered' explicitly. The ON CONFLICT arbiter is the 0002 PK
 * (subscriber_id, origin_id, lane). */
async function setCursor(
  subscriberId: string,
  lastApplied: number,
  alive: boolean,
  lane: "ordered" | "fast" = "ordered",
): Promise<void> {
  await postgres.admin.execute(
    sql`insert into sync_cursor (subscriber_id, origin_id, last_applied_seq, alive, lane)
        values (${subscriberId}, ${ORIGIN}::uuid, ${lastApplied}, ${alive}, ${lane})
        on conflict (subscriber_id, origin_id, lane)
          do update set last_applied_seq = excluded.last_applied_seq, alive = excluded.alive`,
  );
}
```

Add a schema-shape test inside the top `describe` (this suite already boots a full-manifest container, so the PK assertion is container-cost-free — it reuses the same boot):

```ts
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
```

- [ ] **Step 2: Run it, watch both fail.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test retention.gate`. Expected: FAIL — the container migrates through `0001` only, so `sync_cursor` still has the 2-col PK and no `lane` column: the PK-shape test reports `["subscriber_id", "origin_id"]`, and every `setCursor` call throws `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification` (the 3-col arbiter has no matching constraint yet), so the retention tests error too. This is the schema `0002` supplies.

- [ ] **Step 3: Write the migration.** Create `packages/sync/drizzle/0002_sync_cursor_lane.sql`:

```sql
-- Hand-written custom migration: sync_cursor is a raw-SQL table (0000_sync_outbox.sql:100-107), NOT a
-- Drizzle-modelled table, so drizzle-kit has nothing to diff a PK change against and 0002_snapshot.json
-- is a copy of 0001's (no table/column drizzle-kit tracks) — the 0000/0001 idiom
-- (0000_sync_outbox.sql:1-3, 0001_sync_retention.sql:1-4). @waitron/sync carries NO drizzle.config and
-- no db:generate script, so this .sql, its journal entry and its snapshot copy are all written by hand.
-- Runs LAST in migrations.manifest.json's `sync` set, after 0000/0001, so sync_cursor already exists.
--
-- WHAT THIS BUILDS. A `lane` dimension on sync_cursor so the fast (payments) and ordered streams track
-- INDEPENDENT cursors per (subscriber, origin): two lanes need two cursor rows, so the primary key
-- repivots from (subscriber_id, origin_id) to (subscriber_id, origin_id, lane). `default 'ordered'`
-- matches the wire default (an unknown/missing ?lane= clamps to ordered — sync-api.ts) and the
-- ApplyBatchOptions default, so a hand-run INSERT that omits lane lands on the ordered lane. NO data
-- migration: nothing is deployed (CLAUDE.md §3), a freshly-migrated database has zero sync_cursor rows,
-- so the default backfills nothing. The sync_cursor DELETE grant that dead-subscriber eviction needs is
-- NOT here — it ships with the verb in the deferred retention-operations slice (spec §1).

ALTER TABLE sync_cursor ADD COLUMN lane text NOT NULL DEFAULT 'ordered';
--> statement-breakpoint
ALTER TABLE sync_cursor DROP CONSTRAINT sync_cursor_pkey;
--> statement-breakpoint
ALTER TABLE sync_cursor ADD PRIMARY KEY (subscriber_id, origin_id, lane);
```

- [ ] **Step 4: Append the journal entry.** In `packages/sync/drizzle/meta/_journal.json`, add a third entry to `"entries"` (after the `0001_sync_retention` object), matching the existing shape:

```json
    {
      "idx": 2,
      "version": "7",
      "when": 1786492800002,
      "tag": "0002_sync_cursor_lane",
      "breakpoints": true
    }
```

- [ ] **Step 5: Copy the snapshot.** Create `packages/sync/drizzle/meta/0002_snapshot.json` as a copy of `0001_snapshot.json` with a fresh `id` and its `prevId` chained to `0001`'s `id`:

```json
{
  "id": "2c8e3fa4-4d7b-4029-9c3e-7f2b4e5d6f32",
  "prevId": "1b7d2e93-3c6a-4f18-8b2d-6f1a3d4c5e21",
  "version": "7",
  "dialect": "postgresql",
  "tables": {},
  "enums": {},
  "schemas": {},
  "sequences": {},
  "roles": {},
  "policies": {},
  "views": {},
  "_meta": {
    "columns": {},
    "schemas": {},
    "tables": {}
  }
}
```

- [ ] **Step 6: Run it, watch it pass.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test retention.gate`. Expected: PASS — the container now migrates through `0002`, so the PK is `(subscriber_id, origin_id, lane)`, `setCursor`'s 3-col arbiter resolves, and every existing retention test (all `lane='ordered'` cursors) is unchanged (`pruneSyncLog`'s per-origin `min` spans them exactly as before).

- [ ] **Step 7: Confirm the manifest still resolves + the migrator runs `0002` in order.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/migrations test` (the manifest test at `manifest.test.ts:42-44` asserts each source folder resolves to a real journal; `apply.concurrency.test.ts` runs the full set). Expected: PASS — `migrations.manifest.json` is unchanged and the journal now enumerates three `sync` members.

- [ ] **Step 8: Coverage + commit.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage` (unfiltered, 98/98/98/95). Then:

```bash
git add packages/sync/drizzle/0002_sync_cursor_lane.sql packages/sync/drizzle/meta/ packages/sync/src/retention.gate.test.ts
git commit -s -m "feat(sync): add lane column + 3-col PK to sync_cursor (0002) for the payments fast lane"
```

---

## Task 2: The fast-lane retention invariant — `pruneSyncLog` holds at the slower lane

**Files:**
- Modify: `packages/sync/src/retention.gate.test.ts` (add the two-lane retention-boundary `describe`, plus a `seedLog`-style helper that alternates a fast-lane and an ordered-lane `table_name`).

**Interfaces:**
- Consumes: `pruneSyncLog(db)` (UNCHANGED — `retention.ts:65-89`), `setCursor(subscriberId, lastApplied, alive, lane)` (Task 1), `remainingSeqs()`, `seedTenant`. No new code symbols — this is the load-bearing correctness proof for the lane split (spec §4e); `pruneSyncLog` itself is unchanged, only the fixture (two lane cursors per origin) is new.

- [ ] **Step 1: Add a two-lane seed helper.** Near `seedLog` in `retention.gate.test.ts`, add a helper that seeds seqs `1..count` for `ORIGIN`, alternating a fast-lane `table_name` (`payments`) and an ordered-lane one (`sales`) so the fixture reads like a real interleaved two-lane stream. `pruneSyncLog` is `table_name`-agnostic — its boundary is `min(last_applied_seq)` across cursor ROWS — so the lane split lives entirely in the two cursor rows the tests set, and this fixture makes the "held fast-lane row" concrete:

```ts
/** Seeds sync_log seqs 1..count for ORIGIN, alternating a FAST-lane table (payments, odd seq) and an
 * ORDERED-lane table (sales, even seq) across the two tenants by parity of a running index, so the
 * fixture looks like a genuine interleaved two-lane stream. pruneSyncLog ignores table_name (its
 * boundary is the min across cursor rows), so which lane a row "belongs" to is decided only by the two
 * cursor rows the tests set — this proves that min waits for whichever lane is slower. Admin insert. */
async function seedTwoLaneLog(count: number, a: string, b: string): Promise<void> {
  for (let seq = 1; seq <= count; seq += 1) {
    const table = seq % 2 === 1 ? "payments" : "sales";
    const tenant = seq % 2 === 1 ? a : b;
    await postgres.admin.execute(
      sql`insert into sync_log (seq, origin_id, table_name, op, tenant_id, row_image)
          overriding system value
          values (${seq}, ${ORIGIN}::uuid, ${table}, 'insert', ${tenant}::uuid, '{}'::jsonb)`,
    );
  }
}
```

- [ ] **Step 2: Write the invariant test (fails first — no `pruneSyncLog` call is wrong, the FIXTURE is new).** Add a new `describe` block:

```ts
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
    await seedTwoLaneLog(10, a, b);

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
    await seedTwoLaneLog(10, a, b);
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
```

- [ ] **Step 3: Run it, watch it pass (the invariant is a property of the unchanged `pruneSyncLog` against the new fixture).** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test retention.gate`. Expected: PASS — the two lane cursor rows are distinct after `0002`, and `pruneSyncLog`'s `group by origin_id` `min` spans both. If it FAILS with `pruned: 8` / `highWater: 8n` in the first block, `0002`'s PK did not include `lane` (the second `setCursor` clobbered the first on a 2-col key) — return to Task 1.

- [ ] **Step 4: Coverage + commit.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage`. Then:

```bash
git add packages/sync/src/retention.gate.test.ts
git commit -s -m "test(sync): prove pruneSyncLog holds sync_log at the slower of the two lane cursors"
```

---

## Task 3: `registry.ts` — `SyncLane` + `lane` field + `tablesForLane`

**Files:**
- Modify: `packages/sync/src/registry.ts` (add `SyncLane`, the `lane` field on all 14 entries, `tablesForLane`).
- Modify: `packages/sync/src/index.ts` (export `SyncLane`, `tablesForLane`).
- Modify: `packages/sync/src/registry.test.ts` (extend the independent `SPEC` with `lane`; pin the fast set is exactly `{payments, payment_refunds}`).

**Interfaces:**
- Consumes: `ENROLLED` (`registry.ts:39-164`).
- Produces: `export type SyncLane = "ordered" | "fast";`, `EnrolledTable.lane: SyncLane`, `export function tablesForLane(lane: SyncLane): string[]`.

- [ ] **Step 1: Write the failing registry test.** In `packages/sync/src/registry.test.ts`, add `lane` to the independent `SPEC` value type and to every entry (`payments`/`payment_refunds` = `"fast"`, the other twelve = `"ordered"`), and add a `describe` pinning the split. Extend the `SPEC` type:

```ts
const SPEC: Record<
  string,
  {
    mode: EnrolledTable["mode"];
    conflictKey: string[];
    watermarkColumn: string | null;
    captureOps: EnrolledTable["captureOps"];
    lane: EnrolledTable["lane"];
  }
> = {
```

Add `lane: "ordered"` to each Group A entry EXCEPT `payment_refunds` (which gets `lane: "fast"`), `lane: "ordered"` to `catalogues`/`categories`/`products`/`payment_policy`/`working_orders`/`working_order_lines`, and `lane: "fast"` to `payments`. Then extend the per-table assertion (`registry.test.ts:135-142`) with `expect(e.lane).toBe(spec.lane);`, and add:

```ts
describe("the fast lane carries exactly payments and payment_refunds (spec §4b)", () => {
  it("tablesForLane('fast') is exactly {payments, payment_refunds}", () => {
    expect(new Set(tablesForLane("fast"))).toEqual(new Set(["payments", "payment_refunds"]));
  });
  it("tablesForLane('ordered') is the remaining twelve enrolled tables", () => {
    const fast = new Set(["payments", "payment_refunds"]);
    const expected = ENROLLED.filter((e) => !fast.has(e.table)).map((e) => e.table);
    expect(tablesForLane("ordered").sort()).toEqual(expected.sort());
    expect(tablesForLane("ordered")).toHaveLength(12);
  });
  it("every enrolled table carries a lane, and the two lanes partition ENROLLED", () => {
    expect(tablesForLane("fast").length + tablesForLane("ordered").length).toBe(ENROLLED.length);
    for (const e of ENROLLED) expect(e.lane === "fast" || e.lane === "ordered").toBe(true);
  });
});
```

Add `tablesForLane` to the import (`registry.test.ts:2`): `import { ENROLLED, tablesForLane, type EnrolledTable } from "./registry.js";`.

- [ ] **Step 2: Run it, watch it fail.** Run: `pnpm --filter @waitron/sync test registry`. Expected: FAIL — `tablesForLane` is not exported (`TypeError`/compile error) and `e.lane` is `undefined` on every entry.

- [ ] **Step 3: Add `SyncLane`, the `lane` field, and `tablesForLane`.** In `registry.ts`, after the `CaptureOp` type (`:11`):

```ts
/** Which replication lane carries a table. `payments`/`payment_refunds` ride the tight FAST lane
 * (ahead of the rest, to shrink the double-charge exposure active-active selling creates); every other
 * enrolled table rides the ORDERED lane. The lane is the wire dimension both peers agree on (spec §4b).*/
export type SyncLane = "ordered" | "fast";
```

Add the field to `EnrolledTable` (after `fkRank`, `:28`):

```ts
  /** Which replication lane carries this table (spec §4b). `payments`/`payment_refunds` ride the tight
   * fast lane; every other enrolled table rides the ordered lane. */
  lane: SyncLane;
```

Set `lane: "fast"` on the `payment_refunds` entry (`:93-100`) and the `payments` entry (`:128-135`); set `lane: "ordered"` on the other twelve entries. Then, after the `ENROLLED` array, derive the per-lane list once from `ENROLLED` (never a second hand-kept array — the drift `CLAUDE.md` §2 warns of):

```ts
/** The physical table names on one lane, derived once from ENROLLED (never a second hand-kept array).
 * The source route maps `?lane=` → this list → readSyncLogSince's `tables` filter (spec §4c). */
export function tablesForLane(lane: SyncLane): string[] {
  return ENROLLED.filter((e) => e.lane === lane).map((e) => e.table);
}
```

- [ ] **Step 4: Export from the barrel.** In `packages/sync/src/index.ts`, extend the registry export block (`:13-14`):

```ts
export { ENROLLED, tablesForLane } from "./registry.js";
export type { CaptureOp, EnrolledTable, SyncLane, SyncMode } from "./registry.js";
```

- [ ] **Step 5: Run it (unfiltered), watch it pass.** Run: `pnpm --filter @waitron/sync test:coverage`. Expected: PASS, 98/98/98/95 — running unfiltered also loads `registry.test.ts`'s `^[a-z_]+$` enrolled-name guard (`CLAUDE.md` §3). `pnpm --filter @waitron/sync typecheck`.

- [ ] **Step 6: Commit.**

```bash
git add packages/sync/src/registry.ts packages/sync/src/registry.test.ts packages/sync/src/index.ts
git commit -s -m "feat(sync): mark payments/payment_refunds as the fast lane + tablesForLane"
```

---

## Task 4: `source.ts` — `readSyncLogSince` gains a `tables?` filter

> **2026-08-15 (shipped):** the filter binds as `and table_name in ${tables}`, not `= any($n)` — drizzle expands an interpolated array to `in ($1, $2, …)`, so `= any(...)` becomes `any(($1, $2))` and fails 42809. Same param-binding property (no identifier interpolated); empty `[]` → `and false`. See `source.ts:37-42` and `drain.ts:588`.

**Files:**
- Modify: `packages/sync/src/source.ts` (`ReadSyncLogArgs.tables?: string[]` + the `where` clause).
- Modify: `packages/sync/src/source.gate.test.ts` (add a table-filter assertion — reuses the suite's already-booting container).

**Interfaces:**
- Consumes: `sync_log` (as `sync_tailer` under `withTenant`).
- Produces:

```ts
export interface ReadSyncLogArgs {
  originId?: string;
  afterSeq: bigint;
  limit: number;
  tables?: string[]; // restrict to these table_names (a lane's tables); omitted → every table
}
```

- [ ] **Step 1: Write the failing table-filter test.** In `source.gate.test.ts`, `captureAProductWrite` already captures a `products` (ordered) row and `seedBase` captures a `catalogues` (ordered) row. Add a capture of a fast-lane table so the filter has two lanes to separate, then read each subset back. Add a helper beside `captureAProductWrite`:

```ts
/** An app_login write into a fast-lane table (payment_policy: watermark table, standalone PK tenant_id,
 * no FK parent needed beyond the tenant) under withTenant{nodeId: NODE_A}, so sync_capture writes one
 * payment_policy row to sync_log. Columns per packages/payments/src/schema/payment-policy.ts: tenant_id,
 * offline_mode (text, NOT NULL, CHECK in ('accept_offline','cash_only')), offline_amount_cap (numeric,
 * NOT NULL, CHECK >= 0); created_at/updated_at default. Same INSERT shape as packages/payments/test/
 * seed.ts:136. Used to prove readSyncLogSince's `tables` filter separates the lanes. */
async function capturePaymentPolicyWrite(b: Base): Promise<void> {
  const app = await postgres.pg.connectAs("app_login", "app_pw");
  try {
    await withTenant(
      app,
      b.tenantId,
      (tx) =>
        tx.execute(
          sql`insert into payment_policy (tenant_id, offline_mode, offline_amount_cap)
              values (${b.tenantId}, 'cash_only', '0.00')`,
        ),
      { nodeId: NODE_A },
    );
  } finally {
    await app.close();
  }
}
```

Add the test:

```ts
it("restricts to the named tables when `tables` is supplied (the lane filter)", async () => {
  // A fast-lane table (payment_policy) and ordered-lane tables (catalogues from seedBase, products)
  // are all captured under one tenant. `tables: ['payment_policy','payments']` returns ONLY the fast
  // rows; `tables: <the ordered set>` returns the ordered rows and NOT payment_policy. The array binds
  // as a single `= any($n)` parameter — no identifier is interpolated (CLAUDE.md §3).
  const b = await seedBase();
  await captureAProductWrite(b, "1.50"); // products (ordered)
  await capturePaymentPolicyWrite(b); //     payment_policy (fast)
  const reader = await postgres.pg.connectAs("sync_reader", "rp");
  try {
    const fast = await withTenant(reader, b.tenantId, (tx) =>
      readSyncLogSince(tx, { afterSeq: 0n, limit: 100, tables: ["payment_policy", "payments"] }),
    );
    expect(fast.length).toBeGreaterThanOrEqual(1);
    expect(fast.every((r) => r.table === "payment_policy" || r.table === "payments")).toBe(true);
    expect(fast.some((r) => r.table === "products")).toBe(false); // ordered rows excluded

    const ordered = await withTenant(reader, b.tenantId, (tx) =>
      readSyncLogSince(tx, { afterSeq: 0n, limit: 100, tables: ["catalogues", "products"] }),
    );
    expect(ordered.some((r) => r.table === "products")).toBe(true);
    expect(ordered.some((r) => r.table === "payment_policy")).toBe(false); // fast rows excluded
  } finally {
    await reader.close();
  }
});
```

- [ ] **Step 2: Run it, watch it fail.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test source.gate`. Expected: FAIL — `readSyncLogSince` ignores `tables` (the field does not exist), so `fast` still contains the `products`/`catalogues` rows and the exclusion assertions fail (or a compile error on the unknown `tables` field).

- [ ] **Step 3: Add the filter.** In `source.ts`, add the field to `ReadSyncLogArgs` (`:10-17`):

```ts
export interface ReadSyncLogArgs {
  /** Restrict to one producing node, or read all origins when omitted. */
  originId?: string;
  /** Exclusive lower bound — rows with `seq > afterSeq`. */
  afterSeq: bigint;
  /** Batch cap. */
  limit: number;
  /** Restrict to these `table_name`s (a lane's tables, from `tablesForLane`); omitted → every table.
   * Binds as a single `= any($n)` array parameter — no identifier is interpolated (CLAUDE.md §3). */
  tables?: string[];
}
```

Add the clause to the `where` (after the `originId` clause, `source.ts:39`):

```ts
    where seq > ${args.afterSeq.toString()}::bigint
      ${args.originId === undefined ? sql`` : sql`and origin_id = ${args.originId}::uuid`}
      ${args.tables === undefined ? sql`` : sql`and table_name = any(${args.tables})`}
    order by seq asc
    limit ${args.limit}
```

- [ ] **Step 4: Run it, watch it pass.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test source.gate`. Expected: PASS — the filter returns only the named tables; the existing three tests (no `tables`) are unaffected because the omitted field falls to `sql\`\``.

- [ ] **Step 5: Coverage + commit.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage`, then:

```bash
git add packages/sync/src/source.ts packages/sync/src/source.gate.test.ts
git commit -s -m "feat(sync): readSyncLogSince gains a table filter (a lane's tables via = any($n))"
```

---

## Task 5: `apply.ts` — thread `lane` through the cursor read/skip/advance

**Files:**
- Modify: `packages/sync/src/apply.ts` (`ApplyBatchOptions.lane`, `readCursors`, `advanceCursor`, the seq-skip).
- Modify: `packages/sync/src/apply.gate.test.ts` (a `paymentImage` builder; the fast-lane cursor-independence test; the cross-lane `23503`-park test).

**Interfaces:**
- Consumes: `SyncLane` (`registry.ts`), `ENROLLED`, `withTenant`.
- Produces: `ApplyBatchOptions.lane?: SyncLane` (OPTIONAL, defaults to `"ordered"` — so every existing caller, `pull.ts` included, compiles and behaves as the ordered lane, matching the `0002` `DEFAULT 'ordered'`). `readCursors(db, subscriberId, lane)`, `advanceCursor(db, subscriberId, originId, lane, seq)`.

> **Design note (why `lane` is optional here):** making `ApplyBatchOptions.lane` optional-with-default-`"ordered"` keeps THIS task green without forward-coupling into `pull.ts` (Task 6) or the many existing `applyBatch` callers (`apply.gate.test.ts`, `redelivery.gate.test.ts`, `pull.gate.test.ts`, `sync-e2e.rls.test.ts`) — they omit `lane` and get ordered, exactly the slice-1 behaviour. The default matches the migration's `DEFAULT 'ordered'` and the wire's ordered-clamp, so it is safe; the fast lane is reached only by callers that pass `lane: "fast"` explicitly (Task 6's fast pull; boot's fast invocation, Task 9).

- [ ] **Step 1: Write the failing fast-lane cursor-independence test.** In `apply.gate.test.ts`, add a `paymentImage` builder near the other image builders (every NOT-NULL column present for `jsonb_populate_record`; columns per `packages/payments/src/schema/payments.ts`):

```ts
/** A captured `payments` row image (spec §4b's cross-lane fast table). Every NOT-NULL column is present
 * for jsonb_populate_record — id, tenant_id, working_order_id (NOT NULL FK → working_orders), provider,
 * payment_ref, amount (>0), state (a valid payment_state enum), created_at, updated_at (the watermark).
 * sale_id/node_id/external_ref/settled_at/reconcile_remediated_at are nullable and left null. */
function paymentImage(
  b: Base,
  workingOrderId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: uuid(),
    tenant_id: b.tenantId,
    working_order_id: workingOrderId,
    sale_id: null,
    node_id: null,
    provider: "stripe",
    payment_ref: uuid(),
    external_ref: null,
    amount: "10.00",
    state: "captured",
    settled_at: null,
    reconcile_remediated_at: null,
    created_at: "2026-08-11T10:00:00+00:00",
    updated_at: "2026-08-11T10:00:00+00:00",
    ...overrides,
  };
}

/** Reads one lane's cursor for (subscriber, origin), or 0n when absent — the admin read-back. */
async function laneCursor(subscriberId: string, originId: string, lane: string): Promise<bigint> {
  const r = await postgres.admin.execute<{ seq: string | null }>(
    sql`select last_applied_seq::text as seq from sync_cursor
        where subscriber_id = ${subscriberId} and origin_id = ${originId}::uuid and lane = ${lane}`,
  );
  return r.rows[0]?.seq ? BigInt(r.rows[0].seq) : 0n;
}
```

> **Note:** `apply.gate.test.ts` carries a `wire(image)` helper (`JSON.stringify`) and `PROD` (the `localEnvironment`/`sourceEnvironment` pair). If `saleImage`/`wire`/`PROD` are not visible where you add the new tests, re-read `apply.gate.test.ts:1-224` for their exact shapes — reuse, do not re-invent.

Add the test:

```ts
describe("the fast and ordered lanes advance independent cursors (spec §4e)", () => {
  it("a fast apply advances ONLY the fast cursor and never drags the ordered lane past an un-applied lower seq", async () => {
    // Two lanes read the same sync_log ordered by the same seq, but a fast pull (lane 'fast') advances
    // only the fast cursor row. With ONE shared cursor, a fast apply to seq 5 would make the ordered
    // lane skip an un-applied ordered row at seq 3 — silent data loss (spec §4e). Separate lane cursors
    // remove that: apply a payments row (fast) at seq 5, then a sales row (ordered) at the LOWER seq 3,
    // and the sales row still lands (the ordered cursor started at 0, independent of the fast cursor).
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const woId = await seedWorkingOrder(b, 1); // the payments FK parent, seeded so the fast row lands
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      // FAST: a payments row at seq 5 → advances the fast cursor to 5, leaves the ordered cursor at 0.
      const pay = paymentImage(b, woId);
      const fast = await applyBatch(
        applier,
        [{ seq: 5n, originId, table: "payments", op: "insert", tenantId: b.tenantId, rowImage: wire(pay) }],
        { subscriberId, ...PROD, lane: "fast" },
      );
      expect(fast.applied).toBe(1);
      expect(await laneCursor(subscriberId, originId, "fast")).toBe(5n);
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(0n); // untouched

      // ORDERED: a sales row at the LOWER seq 3. A shared cursor at 5 would SKIP it (3 <= 5) — the
      // data-loss bug. With an independent ordered cursor (still 0) it applies.
      const sale = saleImage(b, seriesId, 1);
      const ordered = await applyBatch(
        applier,
        [{ seq: 3n, originId, table: "sales", op: "insert", tenantId: b.tenantId, rowImage: wire(sale) }],
        { subscriberId, ...PROD, lane: "ordered" },
      );
      expect(ordered.applied).toBe(1); // NOT skipped — the ordered lane's own cursor was 0
      expect(await saleCount(sale.id as string)).toBe("1");
      expect(await laneCursor(subscriberId, originId, "ordered")).toBe(3n);
      expect(await laneCursor(subscriberId, originId, "fast")).toBe(5n); // fast still 5 — lanes disjoint
    } finally {
      await applier.close();
    }
  });
});
```

> **Note:** `saleCount(id)` is a read-back helper `apply.gate.test.ts` already defines (used at `:160`); reuse it. If absent under that exact name, add `const saleCount = async (id) => (await postgres.admin.execute<{v:string}>(sql\`select count(*)::int::text as v from sales where id = ${id}\`)).rows[0]!.v;`.

- [ ] **Step 2: Run it, watch it fail.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test apply.gate -t "independent cursors"`. Expected: FAIL — `ApplyBatchOptions` has no `lane` field (compile error), and with the current shared 2-col cursor the ordered sales row at seq 3 would be SKIPPED after the fast apply reached 5 (`ordered.applied` is 0). This is the data-loss the lane split removes.

- [ ] **Step 3: Thread `lane` through `apply.ts`.** Add the import (`apply.ts:16`):

```ts
import { ENROLLED, type EnrolledTable, type SyncLane } from "./registry.js";
```

Add the optional field to `ApplyBatchOptions` (`:43-51`):

```ts
  /** Which replication lane this batch belongs to — selects the `(subscriber, origin, lane)` cursor
   * rows read, skipped against, and advanced. Optional, defaulting to `"ordered"` (the 0002 column
   * default and the wire's ordered-clamp), so an ordered-lane caller need not name it. */
  lane?: SyncLane;
```

In `applyBatch`, resolve the lane once and thread it into `readCursors`/`advanceCursor` (`:150`, `:214`):

```ts
  const lane: SyncLane = opts.lane ?? "ordered";
  // …
  const cursorAtStart = await readCursors(subscriberDb, opts.subscriberId, lane);
```

and at the advance (`:214`):

```ts
    if (high > start) await advanceCursor(subscriberDb, opts.subscriberId, originId, lane, high);
```

(The seq-skip at `:183-188` reads `cursorAtStart.get(row.originId)`, and `cursorAtStart` now holds only this lane's cursors, so it compares against the applying lane's cursor with no further change.)

Update `readCursors` (`:307-317`):

```ts
async function readCursors(
  db: Database,
  subscriberId: string,
  lane: SyncLane,
): Promise<Map<string, bigint>> {
  const result = await db.execute<{ origin_id: string; last_applied_seq: string }>(
    sql`select origin_id::text as origin_id, last_applied_seq::text as last_applied_seq
        from sync_cursor where subscriber_id = ${subscriberId} and lane = ${lane}`,
  );
  const cursors = new Map<string, bigint>();
  for (const r of result.rows) cursors.set(r.origin_id, BigInt(r.last_applied_seq));
  return cursors;
}
```

Update `advanceCursor` (`:325-338`) — arbiter = the new 3-col PK, carry `lane` in the insert:

```ts
async function advanceCursor(
  db: Database,
  subscriberId: string,
  originId: string,
  lane: SyncLane,
  seq: bigint,
): Promise<void> {
  await db.execute(
    sql`insert into sync_cursor (subscriber_id, origin_id, lane, last_applied_seq)
        values (${subscriberId}, ${originId}::uuid, ${lane}, ${seq.toString()}::bigint)
        on conflict (subscriber_id, origin_id, lane) do update
          set last_applied_seq = excluded.last_applied_seq, updated_at = now()
          where excluded.last_applied_seq > sync_cursor.last_applied_seq`,
  );
}
```

- [ ] **Step 4: Run it, watch it pass.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test apply.gate -t "independent cursors"`. Expected: PASS — the two lane cursors advance independently and the lower-seq ordered row is no longer skipped.

- [ ] **Step 5: Write the cross-lane `23503`-park test.** Add a second `it` in the same `describe` (the pre-existing `23503` park is the backstop — `apply.ts:277,190,212-214`; this proves the cross-lane case, spec §4e):

```ts
it("a fast payments row whose ordered working_orders parent is absent parks, holds the fast cursor, and lands on redelivery", async () => {
  // payments.working_order_id is NOT NULL → working_orders (packages/payments/src/schema/payments.ts:56),
  // and working_orders is an ORDERED-lane table. So a fast payments row can arrive before its parent.
  // The pre-existing 23503 park (apply.ts:277,190,212-214) holds the fast cursor below it; the in-batch
  // retry cannot land it (the parent is never in a fast batch); a later fast pull redelivers it, and it
  // lands once the parent exists. No new code — this proves the cross-lane case reuses the backstop.
  await setEnv("production");
  const b = await seedBase();
  const originId = uuid();
  const subscriberId = uuid();
  const woId = uuid(); // a working_orders id NOT yet present on the mirror
  const pay = paymentImage(b, woId);
  const batch = [
    { seq: 4n, originId, table: "payments", op: "insert" as const, tenantId: b.tenantId, rowImage: wire(pay) },
  ];
  const applier = await postgres.pg.connectAs("sync_applier", "ap");
  try {
    // Parent absent → 23503 → parked. applied 0, deferred 1, fast cursor NOT advanced.
    const parked = await applyBatch(applier, batch, { subscriberId, ...PROD, lane: "fast" });
    expect(parked.applied).toBe(0);
    expect(parked.deferred).toBe(1);
    expect(await laneCursor(subscriberId, originId, "fast")).toBe(0n); // held below the parked seq
    const absent = await postgres.admin.execute<{ v: string }>(
      sql`select count(*)::int::text as v from payments where id = ${pay.id as string}`,
    );
    expect(absent.rows[0]!.v).toBe("0"); // nothing applied

    // The ordered lane delivers the parent (seed it — the FK resolves once the parent exists, exactly
    // as the ordered lane applying a working_orders row would leave the mirror).
    await postgres.admin.execute(
      sql`insert into working_orders (id, tenant_id, till_id, order_number)
          values (${woId}, ${b.tenantId}, ${b.tillId}, 99)`,
    );

    // Redeliver the SAME fast batch → now lands. applied 1, fast cursor advances.
    const landed = await applyBatch(applier, batch, { subscriberId, ...PROD, lane: "fast" });
    expect(landed.applied).toBe(1);
    expect(await laneCursor(subscriberId, originId, "fast")).toBe(4n);
    const present = await postgres.admin.execute<{ v: string }>(
      sql`select count(*)::int::text as v from payments where id = ${pay.id as string}`,
    );
    expect(present.rows[0]!.v).toBe("1"); // landed once the parent arrived
  } finally {
    await applier.close();
  }
});
```

- [ ] **Step 6: Run the whole sync suite unfiltered, watch it pass.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage` (98/98/98/95). Expected: PASS — the two new tests plus every existing `applyBatch` caller (which omits `lane` → ordered) are green. `pnpm --filter @waitron/sync typecheck`.

- [ ] **Step 7: Commit.**

```bash
git add packages/sync/src/apply.ts packages/sync/src/apply.gate.test.ts
git commit -s -m "feat(sync): thread lane through applyBatch's cursor read/skip/advance (independent lane cursors)"
```

---

## Task 6: `pull.ts` — lane-scoped `syncPullOnce` / `runSyncPull`

**Files:**
- Modify: `packages/sync/src/pull.ts` (`SyncPullDeps.lane`, `readCursor` gains `lane`, the `/log` URL gains `&lane=`, `applyBatch` opts carry `lane`, the `stream_stalled`/`pull_failed` logs carry `lane`; the progress-guard comment names the cross-lane cause).
- Modify: `packages/sync/src/errors.ts` (`lane` on the `sync.stream_stalled` transport variant).
- Modify: `packages/sync/src/errors.test.ts` (the transport-variant construction gains `lane`).
- Modify: `packages/sync/src/pull.gate.test.ts` (a fast-lane pull test — URL carries `lane=fast`, the fast cursor advances, the ordered cursor is untouched).
- Modify: `packages/sync/src/pull.test.ts` (assert `lane` in the `sync.stream_stalled` params).

**Interfaces:**
- Consumes: `SyncLane`, `applyBatch(…, { …, lane })` (Task 5).
- Produces: `SyncPullDeps.lane?: SyncLane` (OPTIONAL, defaults to `"ordered"` — so `boot.ts`'s existing single call and every loop-control test compile unchanged; boot's Task 9 passes both lanes explicitly). `sync.stream_stalled` transport variant `{ subscriberId; originId; backoffMs; lane: SyncLane }`.

- [ ] **Step 1: Write the failing fast-lane pull test.** In `pull.gate.test.ts`, add a test that a `lane: "fast"` pull requests `?lane=fast`, applies onto the fast cursor, and leaves the ordered cursor untouched. Reuse the existing `saleImage`/`seedBase`/`seedSeries` harness (a `sales` row is fine — `pull.ts` is lane-agnostic about which table rides which lane; that mapping is the SERVER's job in Task 7). A URL-capturing fake http proves the wire param:

```ts
it("a fast pull requests ?lane=fast and advances ONLY the fast cursor row", async () => {
  await setEnv("production");
  const b = await seedBase();
  const seriesId = await seedSeries(b);
  const peerNode = uuid();
  const subscriberId = uuid();
  const sale = saleImage(b, seriesId, 1);
  const batch: SyncLogRow[] = [
    { seq: 1n, originId: peerNode, table: "sales", op: "insert", tenantId: b.tenantId, rowImage: JSON.stringify(sale) },
  ];
  const ndjson = encodeBatch(batch);
  const urls: string[] = [];
  const http: HttpClient = async (url) => {
    urls.push(url);
    if (url.includes("/sync-api/hello")) {
      return { status: 200, text: async () => JSON.stringify({ environment: "production" }) };
    }
    return { status: 200, text: async () => ndjson };
  };
  const applier = await postgres.pg.connectAs("sync_applier", "ap");
  try {
    const deps = {
      localDb: applier,
      subscriberId,
      tenantId: b.tenantId,
      localEnvironment: "production",
      http,
      batchLimit: 500,
      lane: "fast" as const,
    };
    const peer = { nodeId: peerNode, url: "http://peer/", token: "tok" };
    const result = await syncPullOnce(deps, peer);
    expect(result.applied).toBe(1);
    // The wire carried lane=fast (spec §4c/§4d).
    expect(urls.some((u) => u.includes("/sync-api/log") && u.includes("lane=fast"))).toBe(true);
    // The FAST cursor advanced; the ORDERED cursor row for this (subscriber, origin) does not exist.
    const fast = await postgres.admin.execute<{ seq: string }>(
      sql`select last_applied_seq::text as seq from sync_cursor
          where subscriber_id = ${subscriberId} and origin_id = ${peerNode}::uuid and lane = 'fast'`,
    );
    expect(fast.rows[0]!.seq).toBe("1");
    const ordered = await postgres.admin.execute<{ seq: string | null }>(
      sql`select last_applied_seq::text as seq from sync_cursor
          where subscriber_id = ${subscriberId} and origin_id = ${peerNode}::uuid and lane = 'ordered'`,
    );
    expect(ordered.rows[0]).toBeUndefined(); // no ordered cursor row — the lanes are disjoint
  } finally {
    await applier.close();
  }
});
```

- [ ] **Step 2: Run it, watch it fail.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test pull.gate -t "lane=fast"`. Expected: FAIL — `SyncPullDeps` has no `lane` (compile error); the URL carries no `lane=` param; and `applyBatch` (without a lane opt) advances the ordered cursor, so the `lane='fast'` cursor row is absent.

- [ ] **Step 3: Thread `lane` through `pull.ts`.** Add the import (`pull.ts:11`): `import { applyBatch, type ApplyBatchResult } from "./apply.js";` stays; add `import type { SyncLane } from "./registry.js";`. Add the optional field to `SyncPullDeps` (`:28-42`):

```ts
  /** Which replication lane this worker drives — 'fast' (payments/payment_refunds) or 'ordered'.
   * Threaded into the `?lane=` request, the `(subscriber, origin, lane)` cursor read/advance, and the
   * applyBatch opts. Optional, defaulting to 'ordered' (the wire + 0002 default), so an ordered worker
   * need not name it; boot passes both lanes explicitly (spec §4d). */
  lane?: SyncLane;
```

Update `readCursor` (`:62-68`) to read the lane's cursor:

```ts
async function readCursor(
  db: Database,
  subscriberId: string,
  originId: string,
  lane: SyncLane,
): Promise<bigint> {
  const r = await db.execute<{ seq: string }>(
    sql`select coalesce(last_applied_seq, 0)::text as seq from sync_cursor
        where subscriber_id = ${subscriberId} and origin_id = ${originId}::uuid and lane = ${lane}`,
  );
  return r.rows[0] ? BigInt(r.rows[0].seq) : 0n;
}
```

In `syncPullOnce` (`:80-107`) resolve the lane once and thread it into the URL, both cursor reads, and the applyBatch opts:

```ts
export async function syncPullOnce(deps: SyncPullDeps, peer: PullPeer): Promise<SyncPullResult> {
  const base = trimSlash(peer.url);
  const auth = { Authorization: `Bearer ${peer.token}` };
  const lane: SyncLane = deps.lane ?? "ordered";

  const hello = await deps.http(`${base}/sync-api/hello`, { headers: auth });
  if (hello.status !== 200) {
    throw new Error(`sync pull: peer /sync-api/hello responded ${hello.status}`);
  }
  const sourceEnvironment = (JSON.parse(await hello.text()) as { environment: string }).environment;

  const before = await readCursor(deps.localDb, deps.subscriberId, peer.nodeId, lane);
  const url = `${base}/sync-api/log?originId=${peer.nodeId}&after=${before.toString()}&limit=${deps.batchLimit}&lane=${lane}`;
  const res = await deps.http(url, { headers: auth });
  if (res.status !== 200) {
    throw new Error(`sync pull: peer /sync-api/log responded ${res.status}`);
  }
  const rows = decodeBatch(await res.text());
  const result = await applyBatch(deps.localDb, rows, {
    subscriberId: deps.subscriberId,
    localEnvironment: deps.localEnvironment,
    sourceEnvironment,
    lane,
  });
  const after = await readCursor(deps.localDb, deps.subscriberId, peer.nodeId, lane);
  return { ...result, fetched: rows.length, advanced: after > before };
}
```

In `runSyncPull` (`:160-196`) resolve the lane once and add it to both log lines:

```ts
export async function runSyncPull(deps: RunSyncPullDeps): Promise<void> {
  const pullOnce = deps.pullOnce ?? syncPullOnce;
  const lane: SyncLane = deps.lane ?? "ordered";
  const backoff = new Map<string, number>();
  // …inside the catch:
        deps.log("warn", "sync.pull_failed", { originId: peer.nodeId, backoffMs: next, lane });
        if (prev < deps.maxBackoffMs && next >= deps.maxBackoffMs) {
          deps.log("error", "sync.stream_stalled", {
            subscriberId: deps.subscriberId,
            originId: peer.nodeId,
            backoffMs: next,
            lane,
          });
        }
```

- [ ] **Step 4: Add `lane` to the `sync.stream_stalled` transport variant.** In `errors.ts`, import the type and extend only the transport arm of the union (`:38-40`):

```ts
import type { SyncLane } from "./registry.js";
// …
    "sync.stream_stalled":
      | { subscriberId: string; originId: string; backoffMs: number; lane: SyncLane }
      | { subscriberId: string; originId: string; lag: number };
```

Update the transport-variant construction in `errors.test.ts` (`:26-38`) to carry `lane` in both the constructed params and the `toEqual`:

```ts
  it("constructs sync.stream_stalled with the TRANSPORT backoff-saturation params (pull.ts)", () => {
    const error = new AppError("sync.stream_stalled", {
      subscriberId: "cloud",
      originId: "00000000-0000-0000-0000-000000000000",
      backoffMs: 400,
      lane: "fast",
    });
    expect(error.code).toBe("sync.stream_stalled");
    expect(error.params).toEqual({
      subscriberId: "cloud",
      originId: "00000000-0000-0000-0000-000000000000",
      backoffMs: 400,
      lane: "fast",
    });
  });
```

- [ ] **Step 5: Tighten the loop-control test's stalled assertion + update the progress-guard comment.** In `pull.test.ts`, extend the `sync.stream_stalled` `toMatchObject` (`:192-196`) to include the lane (`dummyDeps` omits `lane`, so it defaults to `"ordered"`):

```ts
    expect(stalled[0]!.params).toMatchObject({
      subscriberId: "node-a",
      originId: peerA.nodeId,
      backoffMs: 400,
      lane: "ordered",
    });
```

In `pull.ts`, extend the progress-guard prose (the `SyncPullResult.advanced` doc, `:49-52`, and the `runSyncPull` drain note, `:147-158`) to name the **cross-lane** cause beside the existing cross-origin one: a full page whose rows are all `23503`-parked on an FK parent that rides the **other lane** (a fast `payments` row whose `working_orders` parent is still on the ordered lane, never in a fast batch) has the identical signature — `advanced === false` — so the guard breaks and yields the same way (spec §4e; the mechanism is unchanged).

- [ ] **Step 6: Run it, watch it pass.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage` (unfiltered — loads `pull.test.ts`, `pull.gate.test.ts`, `errors.test.ts`). Expected: PASS — the fast pull carries `lane=fast` and advances only the fast cursor; the loop-control and existing pull.gate tests (deps omit `lane` → ordered) are unchanged. `pnpm --filter @waitron/sync typecheck`.

- [ ] **Step 7: Commit.**

```bash
git add packages/sync/src/pull.ts packages/sync/src/errors.ts packages/sync/src/errors.test.ts packages/sync/src/pull.gate.test.ts packages/sync/src/pull.test.ts
git commit -s -m "feat(sync): lane-scope syncPullOnce/runSyncPull (?lane=, lane cursor, lane on stream_stalled)"
```

---

## Task 7: `apps/server/src/sync-api.ts` — `/sync-api/log` gains `?lane=`

**Files:**
- Modify: `apps/server/src/sync-api.ts` (a `laneParam` clamp; map `?lane=` → `tablesForLane` server-side; pass `tables` to `readSyncLogSince`).
- Modify: `apps/server/src/sync-api.rls.test.ts` (assert `?lane=fast` returns only the fast tables; missing/garbage clamps to `ordered`).

**Interfaces:**
- Consumes: `tablesForLane`, `SyncLane` (`@waitron/sync`, Task 3), `readSyncLogSince(…, { tables })` (Task 4).
- Produces: no new exported symbols — a private `laneParam(raw): SyncLane` and the mapped `tables` argument.

- [ ] **Step 1: Write the failing lane-filter test.** In `sync-api.rls.test.ts`, the existing `/log` test seeds a `products` (ordered) write. Add a fast-lane capture and assert the lane routing. Extend the main `it` (or add a sibling) — after the existing products write, capture a `payment_policy` (fast) write under the `app_login` pool (`payment_policy` columns per `packages/payments/src/schema/payment-policy.ts`; same INSERT shape as `packages/payments/test/seed.ts:136`):

```ts
await withTenant(
  app_,
  tenantId,
  (tx) =>
    tx.execute(
      sql`insert into payment_policy (tenant_id, offline_mode, offline_amount_cap)
          values (${tenantId}, 'cash_only', '0.00')`,
    ),
  { nodeId: NODE_A },
);
```

then:

```ts
// ?lane=fast returns ONLY the fast-lane tables (payments/payment_refunds/…): the payment_policy row is
// present, the products row is NOT. The server maps ?lane= → tablesForLane server-side; the client
// never supplies a table list (spec §4c).
const fast = await app.request("/sync-api/log?after=0&limit=100&lane=fast", {
  headers: { Authorization: "Bearer s3cret" },
});
expect(fast.status).toBe(200);
const fastRows = decodeBatch(await fast.text());
expect(fastRows.some((r) => r.table === "payment_policy")).toBe(true);
expect(fastRows.some((r) => r.table === "products")).toBe(false);

// ?lane=ordered returns the ordered set (products present, payment_policy absent).
const ordered = await app.request("/sync-api/log?after=0&limit=100&lane=ordered", {
  headers: { Authorization: "Bearer s3cret" },
});
expect(decodeBatch(await ordered.text()).some((r) => r.table === "products")).toBe(true);
expect(decodeBatch(await ordered.text()).some((r) => r.table === "payment_policy")).toBe(false);

// An unknown or MISSING lane clamps to ordered (fail-safe, spec §4c): garbage returns the ordered set,
// never the fast one, and never a 400 (this endpoint has no param-invalid convention).
for (const bad of ["lane=weird", "lane=", ""]) {
  const clamped = await app.request(`/sync-api/log?after=0&limit=100&${bad}`, {
    headers: { Authorization: "Bearer s3cret" },
  });
  expect(clamped.status).toBe(200);
  const rows = decodeBatch(await clamped.text());
  expect(rows.some((r) => r.table === "products")).toBe(true); // ordered tables never silently vanish
  expect(rows.some((r) => r.table === "payment_policy")).toBe(false);
}
```

> **Note:** the existing test's default (no `?lane=`) request at `sync-api.rls.test.ts:122-126` asserts the `products` row is returned. That stays green: a missing lane clamps to `ordered`, and `products` is an ordered-lane table.

- [ ] **Step 2: Run it, watch it fail.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-api`. Expected: FAIL — `?lane=fast` is ignored, so `readSyncLogSince` returns every table and the `products`-absent / `payment_policy`-present assertions fail.

- [ ] **Step 3: Add the lane clamp + mapping.** In `sync-api.ts`, add the import (`:5`): `import { encodeBatch, readSyncLogSince, tablesForLane, type SyncLane } from "@waitron/sync";`. Add the clamp helper beside `logLimit`/`afterSeq`:

```ts
/** The `?lane=` query param as a `SyncLane`, clamping anything that is NOT the literal `fast` — a
 * missing param, `ordered`, or garbage — to `ordered`. Same machine-to-machine fail-safe posture this
 * endpoint takes for `after`/`limit` (no 400 convention): the ordered tables never silently disappear,
 * and the fast tick always sends `lane=fast` explicitly (spec §4c). */
function laneParam(raw: string | undefined): SyncLane {
  return raw === "fast" ? "fast" : "ordered";
}
```

In the `/sync-api/log` handler (`:94-109`) map the lane to a table list and pass it:

```ts
  app.get("/sync-api/log", (c) =>
    run(c, log, async () => {
      requireNodeToken(c, deps.nodeToken);
      const originId = c.req.query("originId");
      const after = afterSeq(c.req.query("after"));
      const limit = logLimit(c.req.query("limit"));
      const tables = tablesForLane(laneParam(c.req.query("lane")));
      const rows = await withTenant(deps.db, deps.tenantId, (tx) =>
        readSyncLogSince(tx, {
          afterSeq: after,
          limit,
          tables,
          ...(originId === undefined ? {} : { originId }),
        }),
      );
      return c.body(encodeBatch(rows), 200, { "content-type": "application/x-ndjson" });
    }),
  );
```

- [ ] **Step 4: Run it, watch it pass.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-api`. Expected: PASS — `?lane=fast` returns only the fast tables; missing/garbage clamps to ordered.

- [ ] **Step 5: Coverage + commit.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` (98/98/98/95) and `pnpm --filter @waitron/server typecheck`. Then:

```bash
git add apps/server/src/sync-api.ts apps/server/src/sync-api.rls.test.ts
git commit -s -m "feat(server): /sync-api/log maps ?lane= to a lane's tables, clamping unknown/missing to ordered"
```

---

## Task 8: `apps/server/src/config.ts` — `fastMinIdleMs` from `WAITRON_SYNC_FAST_TICK_MS`

**Files:**
- Modify: `apps/server/src/config.ts` (`SyncTransportConfig.fastMinIdleMs`; parse in `loadSyncConfig`; a `DEFAULT_SYNC_FAST_TICK_MS`).
- Modify: `apps/server/src/config.test.ts` (the `loadSyncConfig` `toEqual`s gain `fastMinIdleMs`; a custom value; an invalid value).

**Interfaces:**
- Consumes: `positiveInt(env, variable, fallback)` (`config.ts:216`) — the existing positive-int-with-default shape.
- Produces: `SyncTransportConfig.fastMinIdleMs: number`.

- [ ] **Step 1: Write the failing config tests.** In `config.test.ts`'s `loadSyncConfig` `describe` (`:420`), update the "parses peers" `toEqual` (`:431-435`) to include the default, and add two cases:

```ts
  it("parses peers and requires a non-blank token and database url, defaulting the fast tick to 1000ms", () => {
    const env = {
      WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "https://peer/", token: "tok2" }]),
      WAITRON_SYNC_NODE_TOKEN: "mine",
      WAITRON_SYNC_DATABASE_URL: "postgres://sync@host/db",
    };
    expect(loadSyncConfig(env)).toEqual({
      nodeToken: "mine",
      databaseUrl: "postgres://sync@host/db",
      peers: [{ nodeId: "n2", url: "https://peer/", token: "tok2" }],
      fastMinIdleMs: 1000,
    });
  });

  it("reads WAITRON_SYNC_FAST_TICK_MS as the fast lane's idle interval", () => {
    const env = {
      WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "u", token: "t" }]),
      WAITRON_SYNC_NODE_TOKEN: "m",
      WAITRON_SYNC_DATABASE_URL: "x",
      WAITRON_SYNC_FAST_TICK_MS: "500",
    };
    expect(loadSyncConfig(env)!.fastMinIdleMs).toBe(500);
  });

  it("refuses a non-positive-integer WAITRON_SYNC_FAST_TICK_MS", () => {
    const env = {
      WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "u", token: "t" }]),
      WAITRON_SYNC_NODE_TOKEN: "m",
      WAITRON_SYNC_DATABASE_URL: "x",
      WAITRON_SYNC_FAST_TICK_MS: "0",
    };
    expect(() => loadSyncConfig(env)).toThrow(/config_invalid|WAITRON_SYNC_FAST_TICK_MS/);
  });
```

- [ ] **Step 2: Run it, watch it fail.** Run: `pnpm --filter @waitron/server test config -t "fast"`. Expected: FAIL — `fastMinIdleMs` is not on the returned object (the `toEqual` fails / the field is `undefined`).

- [ ] **Step 3: Add the field, the default, and the parse.** In `config.ts`, add a default near the other tick constants (`:101`):

```ts
/** The fast lane's idle interval when WAITRON_SYNC_FAST_TICK_MS is unset. A tight starting point that
 * governing §9 explicitly calls a TUNING TARGET, not a settled constant (spec §4d). No cross-guard
 * against minTickMs: a fast tick not tighter than the ordered tick is a mis-tuning, not a correctness
 * failure. */
const DEFAULT_SYNC_FAST_TICK_MS = 1000;
```

Add the field to `SyncTransportConfig` (`:148-152`):

```ts
export interface SyncTransportConfig {
  nodeToken: string;
  databaseUrl: string;
  peers: SyncPeer[];
  /** The fast lane's idle interval (ms) — the tighter tick the payments lane polls at, beside the
   * ordered lane's config.minTickMs. From WAITRON_SYNC_FAST_TICK_MS, default 1000 (spec §4d). Lives on
   * the sync config because it is meaningless without sync enabled, like nodeToken/peers. */
  fastMinIdleMs: number;
}
```

In `loadSyncConfig`'s return (`:192-196`) add the parse (`positiveInt` and `parsePositiveInt` are function declarations, hoisted, so callable here though defined lower in the file):

```ts
  return {
    nodeToken: required(env, "WAITRON_SYNC_NODE_TOKEN"),
    databaseUrl: required(env, "WAITRON_SYNC_DATABASE_URL"),
    peers,
    fastMinIdleMs: positiveInt(env, "WAITRON_SYNC_FAST_TICK_MS", DEFAULT_SYNC_FAST_TICK_MS),
  };
```

- [ ] **Step 4: Run it, watch it pass.** Run: `pnpm --filter @waitron/server test config`. Expected: PASS — default `1000`, `500` when set, and `0`/non-integer rejected as `server.config_invalid` (via `parsePositiveInt`).

- [ ] **Step 5: Coverage + commit.** Run: `pnpm --filter @waitron/server test:coverage` and `pnpm --filter @waitron/server typecheck`. Then:

```bash
git add apps/server/src/config.ts apps/server/src/config.test.ts
git commit -s -m "feat(server): fastMinIdleMs from WAITRON_SYNC_FAST_TICK_MS (default 1000) on the sync config"
```

---

## Task 9: `apps/server/src/boot.ts` — start TWO lane-scoped `runSyncPull` invocations

**Files:**
- Modify: `apps/server/src/boot.ts` (the sync block, `:355-386`: two `runSyncPull` calls wrapped in `Promise.all`).
- Modify: `apps/server/src/boot.test.ts` (assert `runSyncPull` is invoked twice — ordered at `minTickMs`, fast at `fastMinIdleMs`).

**Interfaces:**
- Consumes: `runSyncPull` (`@waitron/sync`), `syncConfig.fastMinIdleMs` (Task 8), `config.minTickMs`/`config.maxTickMs`.
- Produces: `syncWorker: Promise<void>` = `Promise.all([ordered, fast]).then(() => {})`, torn down by the existing `syncController.abort()` (`:547`) + `await syncWorker.catch(() => {})` (`:556`).

- [ ] **Step 1: Write the failing two-invocation test.** `boot.test.ts` mocks `@waitron/sync` with `runSyncPull: vi.fn(actual.runSyncPull)` (`:72-74`), so `vi.mocked(runSyncPull).mock.calls` is assertable. Extend the sync boot test (`boot.test.ts:435`) to set the fast tick and assert two lane-scoped invocations. After the `/sync-api/hello` assertions and before `server.close()`:

```ts
      // TWO lane-scoped pull workers were started against the same peer: ordered at config.minTickMs
      // and fast at fastMinIdleMs (spec §4d). Assert the two calls' lane + minIdleMs pairing.
      const calls = vi.mocked(runSyncPull).mock.calls.map((c) => c[0]);
      const ordered = calls.find((d) => d.lane === "ordered");
      const fast = calls.find((d) => d.lane === "fast");
      expect(ordered).toBeDefined();
      expect(fast).toBeDefined();
      expect(ordered!.minIdleMs).toBe(5_000); // config.minTickMs default
      expect(fast!.minIdleMs).toBe(250); // WAITRON_SYNC_FAST_TICK_MS below
      expect(fast!.maxBackoffMs).toBe(ordered!.maxBackoffMs); // both share config.maxTickMs
```

and add `WAITRON_SYNC_FAST_TICK_MS: "250"` to that test's `startServer` env (`:451-459`).

- [ ] **Step 2: Run it, watch it fail.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot -t "sync"`. Expected: FAIL — boot starts ONE `runSyncPull` with no `lane`, so `calls.find((d) => d.lane === "fast")` is `undefined`.

- [ ] **Step 3: Start two lane-scoped invocations.** In `boot.ts`, replace the single `syncWorker = runSyncPull({...})` (`:372-385`) with two, sharing everything but `lane` + `minIdleMs`, wrapped in `Promise.all` (kept `Promise<void>` via `.then(() => {})` so the existing `syncWorker: Promise<void> | undefined` type and the `await syncWorker.catch(() => {})` teardown at `:556` are unchanged):

```ts
    const runLane = (lane: "ordered" | "fast", minIdleMs: number): Promise<void> =>
      runSyncPull({
        localDb: syncDb,
        subscriberId: till.nodeId,
        tenantId: till.tenantId,
        localEnvironment: config.environment,
        http: fetchHttpClient,
        batchLimit: 500,
        peers: syncConfig.peers,
        sleep: realSleep,
        signal: syncController.signal,
        minIdleMs,
        maxBackoffMs: config.maxTickMs,
        log,
        lane,
      });
    // The ORDERED lane at the existing idle interval (config.minTickMs) and the FAST payments lane at
    // the tighter syncConfig.fastMinIdleMs, both against the same peers/localDb/http, both under the one
    // syncController and the existing close() teardown (spec §4d). Promise.all so a rejection from
    // either reaches close()'s `await syncWorker.catch(() => {})` swallow (boot.ts:556); the two lanes
    // touch disjoint tables and disjoint cursor rows, so they never race (spec §4d).
    syncWorker = Promise.all([
      runLane("ordered", config.minTickMs),
      runLane("fast", syncConfig.fastMinIdleMs),
    ]).then(() => {});
```

> **Note:** `syncDb` is narrowed to non-`undefined` inside the `if (syncConfig !== undefined)` block (it is assigned two lines above at `:360`), so `runLane`'s closure over `syncDb` typechecks. If `tsc` complains about the closure widening `syncDb` back to `Database | undefined`, hoist a `const localSyncDb = syncDb;` inside the `if` and close over that.

- [ ] **Step 4: Run it, watch it pass.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot -t "sync"`. Expected: PASS — two invocations, ordered `minIdleMs` 5000, fast `minIdleMs` 250, shared `maxBackoffMs`. The `close() swallows a REJECTING pull worker` test (`boot.test.ts:481`) also stays green: `mockReturnValueOnce(rejectedWorker)` mocks the FIRST (ordered) invocation to reject, `Promise.all` rejects, and `close()`'s `.catch(() => {})` swallows it (the fast invocation calls through to the real `runSyncPull`, backs off against the unreachable peer, and resolves on `syncController.abort()`).

- [ ] **Step 5: Run the whole server suite unfiltered + typecheck.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` (98/98/98/95) and `pnpm --filter @waitron/server typecheck`. Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/boot.ts apps/server/src/boot.test.ts
git commit -s -m "feat(server): boot starts two lane-scoped pull workers (ordered + fast payments lane)"
```

---

## Task 10: Two-lane end-to-end over the real HTTP wire

**Files:**
- Modify: `apps/server/src/sync-e2e.rls.test.ts` (seed a `working_orders` parent; capture a `payments` write on the source; the two-lane e2e test).

**Interfaces:**
- Consumes: `syncPullOnce(deps, peer)` with `lane` (Task 6), `mountSyncApi` honouring `?lane=` (Task 7), the lane cursors (Task 5). No new code symbols — this is the capstone composition proof (spec §8, "two-lane end-to-end"). Depends on Tasks 5/6/7; independent of boot (Task 9), which is why it drives `syncPullOnce`/`mountSyncApi` directly, exactly as the existing single-lane e2e does.

- [ ] **Step 1: Seed a `working_orders` parent on both databases.** In `sync-e2e.rls.test.ts`, add a fixed id constant beside the others (`:31-35`): `const WORKING_ORDER = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";`. In `seedParents` (`:56-67`), add a working order (both DBs get the same parents, so the source can capture a payment referencing it and the target's FK resolves):

```ts
  await admin.execute(sql`insert into working_orders (id, tenant_id, till_id, order_number)
    values (${WORKING_ORDER}, ${TENANT}, ${TILL}, 1) on conflict do nothing`);
```

Add a `payments` capture on the source (a real INSERT under `withTenant{nodeId: NODE_A}`, so `sync_capture` writes it to `source.sync_log` with `origin_id = NODE_A`; `payments` has defaults for `created_at`/`updated_at` and nullable `sale_id`/`node_id`/…, so only the NOT-NULL columns are supplied), and a target payment-count read-back beside `targetSaleCount` (`:105-110`):

```ts
async function capturePaymentOnSource(paymentId: string): Promise<void> {
  await withTenant(
    sourceWriter,
    TENANT,
    (tx) =>
      tx.execute(sql`insert into payments
        (id, tenant_id, working_order_id, provider, payment_ref, amount, state)
        values (${paymentId}, ${TENANT}, ${WORKING_ORDER}, 'stripe', ${paymentId}, '10.00', 'captured')`),
    { nodeId: NODE_A },
  );
}

const targetPaymentCount = async (id: string): Promise<string> => {
  const r = await targetAdmin.execute<{ v: string }>(
    sql`select count(*)::int::text as v from payments where id = ${id}`,
  );
  return r.rows[0]!.v;
};
```

- [ ] **Step 2: Write the failing two-lane e2e test.** Add an `it` inside the `describe("two-node sync end-to-end over a real HTTP wire", …)` block:

```ts
it("two lanes land their own tables on independent cursors over the HTTP wire (spec §8)", async () => {
  // The fast lane (?lane=fast) carries ONLY payments/payment_refunds; the ordered lane (?lane=ordered)
  // carries the rest. Capture a sale AND a payment on the source, then pull each lane: the payment
  // lands on the fast cursor, the sale on the ordered cursor, and the two (subscriber, origin) cursor
  // rows advance INDEPENDENTLY. This is the full composition — sync-api ?lane= (Task 7) → source table
  // filter (Task 4) → pull lane (Task 6) → apply lane cursor (Task 5) — over a real Hono app.request.
  await stampEnv(targetAdmin, "production");
  const saleId = "88888888-8888-4888-8888-888888888888";
  const paymentId = "99999999-9999-4999-8999-999999999999";
  await captureSaleOnSource(saleId, 3);
  await capturePaymentOnSource(paymentId);

  const base = {
    localDb: targetApplier,
    subscriberId: SUB_MAIN,
    tenantId: TENANT,
    localEnvironment: "production",
    http: sourceHttp("production"),
    batchLimit: 500,
  };
  const peer = { nodeId: NODE_A, url: "", token: "shared" };

  // FAST lane → the payment lands; the sale is not carried on this lane.
  const fast = await syncPullOnce({ ...base, lane: "fast" as const }, peer);
  expect(fast.applied).toBeGreaterThanOrEqual(1);
  expect(await targetPaymentCount(paymentId)).toBe("1");

  // ORDERED lane → the sale lands on its own cursor.
  const ordered = await syncPullOnce({ ...base, lane: "ordered" as const }, peer);
  expect(ordered.applied).toBeGreaterThanOrEqual(1);
  expect(await targetSaleCount(saleId)).toBe("1");

  // Two distinct lane cursor rows for one (subscriber, origin), each advanced past 0 — independent.
  const cursors = await targetAdmin.execute<{ lane: string; seq: string }>(
    sql`select lane, last_applied_seq::text as seq from sync_cursor
        where subscriber_id = ${SUB_MAIN} and origin_id = ${NODE_A}::uuid order by lane`,
  );
  expect(cursors.rows.map((r) => r.lane)).toEqual(["fast", "ordered"]);
  expect(cursors.rows.every((r) => BigInt(r.seq) > 0n)).toBe(true);
});
```

- [ ] **Step 3: Run it, watch it fail (then pass once the earlier tasks are in).** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-e2e`. Expected once Tasks 5/6/7 are landed: PASS. If run before them, it fails at `syncPullOnce({ …, lane })` (no `lane` field) or because `?lane=fast` returns every table and the sale would land on the fast pull too — the exact behaviours those tasks add.

- [ ] **Step 4: Coverage + commit.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` (unfiltered, 98/98/98/95). Then:

```bash
git add apps/server/src/sync-e2e.rls.test.ts
git commit -s -m "test(server): two-lane end-to-end — fast payments + ordered sale land on independent cursors"
```

---

## Final gate (before opening the PR)

- [ ] **Run the four-command gate for whole-workspace breadth** (`CLAUDE.md` §2): `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
- [ ] **Run the touched packages UNFILTERED with coverage** (the hook/CI shard shape): `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage` and `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`, plus `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/migrations test` (the manifest runs `sync` last, after `0002`).
- [ ] **No `inmutabilidad` run needed** — this slice adds no `tenant_id`-bearing table (`sync_cursor` stays RLS-free; spec §8).
- [ ] **`--frozen-lockfile` unaffected** — no dependency moved between `dependencies`/`devDependencies`; no new package. (Run `pnpm install` only if a manifest changed.)
- [ ] Open the PR, `-s` on every commit, wait for CI + Copilot, address findings (`CLAUDE.md` §6).
