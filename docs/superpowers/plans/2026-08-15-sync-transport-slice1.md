# Sync transport / network layer — slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move captured `sync_log` batches between two active-active shop servers over a symmetric, node-token-authenticated HTTP pull loop that feeds the existing idempotent `applyBatch`, and land the two redelivery-load-bearing fixes (gate the un-gated business BEFORE-triggers; thread `nodeId` through the remaining writers).

**Architecture:** `@waitron/sync` gains a transport module — a `sync_tailer` source read (`readSyncLogSince`), an NDJSON wire codec (`encodeBatch`/`decodeBatch`), and a pull client (`syncPullOnce` + `runSyncPull` loop). `apps/server` gains a Bearer-token-authenticated `mountSyncApi` HTTP group (`/sync-api/hello`, `/sync-api/log`) and wires the pull worker in `boot.ts`. The wire carries `row_image` as Postgres's raw `jsonb` TEXT end-to-end so JS never re-parses a numeric (the byte-identity rule). One `packages/db` migration gates three business triggers on `app.sync_apply`.

**Tech Stack:** TypeScript (ESM, NodeNext), Drizzle ORM + `node-postgres`, Hono + `@hono/node-server`, Vitest + Testcontainers (`postgres:18-alpine`), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-15-sync-transport-slice1-design.md` (governed by `docs/superpowers/specs/2026-08-02-app-level-sync-design.md`; container gates in `docs/superpowers/specs/2026-08-06-sync-container-gates-findings.md`).

## Global Constraints

- **TDD, always.** Failing test first, watch it fail for the stated reason, minimal implementation, watch it pass, commit. Prove every guard **by deletion** (remove it, watch the test fail, restore). A measurement where both answers look alike measures nothing — every control must make the two directions visibly differ (`CLAUDE.md` §1).
- **Every commit is `git commit -s`.** Feature work happens in a worktree, never on `main` (`CLAUDE.md` §6). Do NOT create the worktree or branch as part of this plan — that is the executor's first step.
- **Coverage thresholds are `statements 98 / lines 98 / functions 98 / branches 95`** for both `packages/sync` (`packages/sync/vitest.config.ts`) and `apps/server` (`apps/server/vitest.config.ts`). CI shards run `test:coverage`, not `test` — run `pnpm --filter <pkg> test:coverage` before believing a package is green (`CLAUDE.md` §2).
- **A scoped `pnpm` run that selects nothing REPORTS SUCCESS**, and a name-filtered run does not load a package's cross-cutting guard suites (`CLAUDE.md` §2/§4). Run each touched package **unfiltered** at least once. This slice re-creates BEFORE-triggers on commercial tables, so after the migration run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — that suite scans every `tenant_id`-bearing table for FORCE RLS + immutability and must stay green.
- **Real Postgres, never PGlite, for anything under RLS / the non-superuser role / concurrency / cross-DB.** PGlite connects as a superuser and bypasses FORCE ROW LEVEL SECURITY — a false pass (`CLAUDE.md` §4). `TESTCONTAINERS_RYUK_DISABLED=true` is required locally or container suites hang at the 180s hookTimeout.
- **Utility SQL (CREATE ROLE, CREATE/DROP TRIGGER, GRANT) takes no placeholders.** Trigger DDL is hand-written literal SQL in the migration; never string-concatenate a runtime value into it. Never widen a grant to make a test pass (`CLAUDE.md` §3).
- **Error codes name the DOMAIN concept, `sync.*`, never the package.** No `sync.*` param may carry row content — schema identifiers, environment names, counts and reasons only (`packages/sync/src/errors.ts` header). Reuse the existing `sync.peer_environment_mismatch` / `sync.table_not_enrolled` / `sync.stream_stalled`; any new code is registered in `packages/sync/src/errors.ts` and added to `errors.test.ts`.
- **English-only guard covers `packages/sync/src`** (`apps/*` is out of scope by recorded decision). Every new identifier, fixture value and comment in `packages/sync` is English; Spanish schema tokens (`sync_log`, `origin_id`) are already in `SPANISH_WORDS` / are English.
- **No backwards-compatibility or data-migration code** (pre-production; `CLAUDE.md` §3). Schema changes drop and recreate.

---

## The load-bearing correctness point, resolved against the real code

Read this before Task 1. It is cited by Tasks 1, 5, 6 and 10.

**How `row_image` is bound today.** `SyncLogRow.rowImage` is typed `unknown` (`packages/sync/src/apply.ts:36`). `applyOneRow` (`apply.ts:287-300`) does `const payload = JSON.stringify(row.rowImage);` (`:290`) and binds `` sql`${sql.raw(parts.head)}${payload}::jsonb${sql.raw(parts.tail)}` `` (`:296`). Because `payload` is a JS **string**, Drizzle already emits it as a bound parameter and Postgres casts `$1::jsonb`. So the *wire-level* bind is already `$1::jsonb` — that part does not change. What is wrong is the **contract**: every current caller passes `rowImage` as a JS **object** (every `rowImage:` in `apply.gate.test.ts`, e.g. `:242`), and `JSON.stringify` serialises that object. That is byte-safe only while JS never holds the row's numerics as JS numbers — but the transport reads `sync_log.row_image` (a `jsonb` column), and `node-postgres` parses a `jsonb` column into a JS object, collapsing `1.50` → `1.5` **before** this `JSON.stringify` ever runs. The corruption is at the read/parse step, not the bind.

**Exactly what changes (Task 1):**
1. `SyncLogRow.rowImage: unknown` → `SyncLogRow.rowImage: string` — the source's raw `row_image::text` (Postgres's canonical `jsonb` text), carried verbatim as a string.
2. `applyOneRow`: delete `const payload = JSON.stringify(row.rowImage);` and bind `row.rowImage` **directly**: `` sql`${sql.raw(parts.head)}${row.rowImage}::jsonb${sql.raw(parts.tail)}` ``. `$1` is now the raw jsonb text (already a string); Postgres casts `::jsonb`, preserving `1.50`; **JS never `JSON.parse`s the row's numerics**.
3. `readSyncLogSince` (Task 5) selects `row_image::text`, so `node-postgres` returns the string, never a parsed object.
4. The NDJSON codec (Task 6) carries `rowImage` as a **JSON string field**, never an inlined object, so a decode recovers the exact text (the `1.50` lives inside a JSON string and is never parsed as a number).

This is the whole reason the wire is NDJSON-with-`rowImage`-as-text rather than a single JSON document (findings surprise (ii)).

## The three business triggers — LATEST DDL source, resolved

The gating migration (Task 2) re-creates each **trigger** (event + timing unchanged) with `WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')`, referencing each trigger's **existing function** — the function bodies are NOT re-emitted. Verified by grepping every `packages/db/drizzle/*.sql`:

| Trigger | Latest **trigger** DDL (what to re-create) | Function body (leave untouched) |
| --- | --- | --- |
| `tenders_reject_post_settlement` | `0012_sale_settlement.sql:150-152` — `BEFORE INSERT ON tenders FOR EACH ROW` | `0012:136-148` (only definition) |
| `working_orders_enforce_transition` | `0004_working_orders.sql:96-98` — `BEFORE UPDATE ON working_orders FOR EACH ROW` (trigger never re-created) | body **replaced** at `0030_prepare_collect.sql:101-116` (`CREATE OR REPLACE FUNCTION`) — the current body |
| `working_order_lines_require_open_parent` | `0004_working_orders.sql:122-124` — `BEFORE INSERT OR UPDATE OR DELETE ON working_order_lines FOR EACH ROW` | `0004:103-119` (only definition) |

So the design's "some were re-created by `0030`" refers to `working_orders_enforce_transition`'s **function body** (0030), not its trigger. The gating migration touches **triggers only**. `sale_settlements_check_coverage` and `working_order_lines_check_locales` are deliberately NOT gated — a valid row stays valid on re-apply, so they cannot wedge (the design and `apply.ts:104-112` name exactly these three).

**Next free `packages/db` migration number: `0037`** (`meta/_journal.json` max `idx` is 36, `0036_till_layouts_rls`).

---

## Task 1: `row_image` raw-text binding in `applyBatch` + byte-identity test

**Files:**
- Modify: `packages/sync/src/apply.ts:36` (the `rowImage` field type) and `:287-300` (`applyOneRow`).
- Modify: `packages/sync/src/apply.gate.test.ts` (migrate every `rowImage:` object call site to jsonb text; add the byte-identity test).

**Interfaces:**
- Consumes: `applyBatch(subscriberDb, rows, opts)`, `readDeploymentEnvironment`, `withTenant` (unchanged signatures).
- Produces: `SyncLogRow.rowImage: string` (raw `jsonb` text — a change from `unknown`; every downstream task relies on this). `applyBatch` / `ApplyBatchResult` signatures otherwise unchanged.

- [ ] **Step 1: Write the failing byte-identity test.** Append to the `describe("the commercial-lane apply loop", …)` block in `apply.gate.test.ts`:

```ts
it("applies a numeric via raw jsonb TEXT byte-identically; a JS round-trip would corrupt 1.50 to 1.5", async () => {
  // Failing case (current code JSON.stringify's row.rowImage): passing the raw jsonb TEXT double-
  // encodes it into a jsonb STRING scalar, so jsonb_populate_record gets a scalar not an object and
  // the sale never lands. The byte-identity property: a numeric captured as a JSON *number* (1.50,
  // scale preserved) survives apply only if JS never JSON.parses it (design §4b, findings (ii)).
  await setEnv("production");
  const b = await seedBase();
  const seriesId = await seedSeries(b);
  const originId = uuid();
  const applier = await postgres.pg.connectAs("sync_applier", "ap");
  try {
    // Build the SOURCE's row_image::text with total as a JSON *number* 1.50 (what to_jsonb(sales)::text
    // emits), NOT the string "1.50" — via Postgres so the test uses real canonical jsonb.
    const img = saleImage(b, seriesId, 1); // object, total:"10.00"
    const built = await postgres.admin.execute<{ t: string }>(
      sql`select jsonb_set(${JSON.stringify(img)}::jsonb, '{total}', to_jsonb(1.50::numeric(12,2)))::text as t`,
    );
    const rowImageText = built.rows[0]!.t; // {"total":1.50, ...} — 1.50 is a JSON number
    const raw = await applyBatch(
      applier,
      [{ seq: 1n, originId, table: "sales", op: "insert", tenantId: b.tenantId, rowImage: rowImageText }],
      { subscriberId: uuid(), ...PROD },
    );
    expect(raw.applied).toBe(1);
    expect(await saleTotal(img.id as string)).toBe("1.50"); // scale preserved through $1::jsonb

    // Control (the two directions visibly differ, CLAUDE.md §1): a JS round-trip of the SAME text
    // collapses 1.50 -> 1.5, so the mirror would store "1.5". A different sale id so it inserts fresh.
    const jsCorrupted = saleImage(b, seriesId, 2);
    const corruptedText = JSON.stringify({
      ...JSON.parse(rowImageText),
      id: jsCorrupted.id,
      invoice_number: 2,
    });
    await applyBatch(
      applier,
      [{ seq: 2n, originId, table: "sales", op: "insert", tenantId: b.tenantId, rowImage: corruptedText }],
      { subscriberId: uuid(), ...PROD },
    );
    expect(await saleTotal(jsCorrupted.id as string)).toBe("1.5"); // JS parse dropped the trailing zero
  } finally {
    await applier.close();
  }
});
```

- [ ] **Step 2: Run it, watch it fail.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test apply.gate -t "byte-identical"`. Expected: FAIL — the raw text is double-encoded by the current `JSON.stringify`, so `jsonb_populate_record` receives a scalar and `applied` is 0 / the row is absent.

- [ ] **Step 3: Change the contract and the bind.** In `apply.ts`, change the field at `:36`:

```ts
  /** The verbatim `row_image::text` the capture trigger wrote (spec §3.3), carried as raw `jsonb`
   * TEXT — a STRING, never a parsed object — so a numeric (1.50) is never JS-collapsed to 1.5 on the
   * way through (design §4b). Bound as `$1::jsonb`; JS never JSON.parses it. */
  rowImage: string;
```

In `applyOneRow` (`:287-300`), delete the `const payload = JSON.stringify(row.rowImage);` line and bind `row.rowImage` directly:

```ts
async function applyOneRow(db: Database, row: SyncLogRow, dispatch: Dispatch): Promise<number> {
  const parts =
    row.op === "delete" ? splitStatement(deleteStatementFor(dispatch.entry)) : dispatch.applyParts;
  return withTenant(db, row.tenantId, async (tx) => {
    await tx.execute(sql`select set_config('app.sync_apply', 'on', true)`);
    // rowImage is the source's raw row_image::text; bind it as the single text param cast `$1::jsonb`.
    // Never JSON.stringify (would double-encode) and never JSON.parse (would collapse a numeric).
    const result = await tx.execute(
      sql`${sql.raw(parts.head)}${row.rowImage}::jsonb${sql.raw(parts.tail)}`,
    );
    return result.rows.length;
  });
}
```

- [ ] **Step 4: Migrate the existing call sites to jsonb text (they now fail to compile).** Changing `rowImage` to `string` makes every `rowImage: <object>` in `apply.gate.test.ts` a type error. Add one helper near the image builders:

```ts
/** The wire shape: row_image travels as the source's raw `row_image::text` — a STRING — so JS never
 * re-quotes a numeric (design §4b). Tests serialise their fixture object the way `to_jsonb(row)::text`
 * would; `readSyncLogSince` (Task 5) does the same on the source. */
const wire = (image: Image): string => JSON.stringify(image);
```

Then wrap **every** `rowImage:` value in `wire(...)` — e.g. `rowImage: img` → `rowImage: wire(img)`, `rowImage: { ...img, total: "999.99" }` → `rowImage: wire({ ...img, total: "999.99" })`, `rowImage: { id: lineId, tenant_id: b.tenantId }` → `rowImage: wire({ id: lineId, tenant_id: b.tenantId })`. Where a test later reads the id back off `rowImage` (the env-mismatch test, `:579`/`:583`/`:608` do `(rowA.rowImage as { id: string }).id`), hoist the image object to a local first and read the id from it, e.g.:

```ts
const imgA = saleImage(b1, s1, 1);
const rowA: SyncLogRow = { seq: 1n, originId: uuid(), table: "sales", op: "insert", tenantId: b1.tenantId, rowImage: wire(imgA) };
// …then use imgA.id instead of (rowA.rowImage as {id}).id
expect(await saleCount(imgA.id as string)).toBe("0");
```

- [ ] **Step 5: Run the whole suite unfiltered.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage`. Expected: PASS, thresholds 98/98/98/95 met. (The new byte-identity test and every migrated assertion pass; running unfiltered also loads `apply-sql.test.ts`, `registry.test.ts`, `errors.test.ts`.)

- [ ] **Step 6: Typecheck + commit.** Run: `pnpm --filter @waitron/sync typecheck`, then:

```bash
git add packages/sync/src/apply.ts packages/sync/src/apply.gate.test.ts
git commit -s -m "feat(sync): bind row_image as raw jsonb text so numerics survive byte-identically"
```

---

## Task 2: Gate the three business BEFORE-triggers on `app.sync_apply` (`0037`) + redelivery-wedge proof

**Files:**
- Create: `packages/db/drizzle/0037_gate_triggers_on_sync_apply.sql` (hand-written trigger DDL).
- Create: `packages/db/drizzle/meta/0037_snapshot.json` (a copy of `0036_snapshot.json`).
- Modify: `packages/db/drizzle/meta/_journal.json` (append the `0037` entry).
- Create: `packages/sync/src/redelivery.gate.test.ts` (proves fix A by deletion; needs the full manifest + `applyBatch` + the gated triggers).

**Interfaces:**
- Consumes: `applyBatch`, `SyncLogRow` (rowImage is now `string`, Task 1); the full migration manifest via `migrationOptionsFor(manifestSets(), null)`; `pgErrorCode` (reads SQLSTATE off the Drizzle error wrapper).
- Produces: migration `0037` re-creating three gated triggers. No new code symbols.

- [ ] **Step 1: Write the failing redelivery-wedge test.** Create `packages/sync/src/redelivery.gate.test.ts`. Copy the container/role/seed harness verbatim from `apply.gate.test.ts:1-224` (the `useRealPostgres` block that runs `migrationOptionsFor(manifestSets(), null)` and creates the `sync_applier` LOGIN role that is a member of `app_user` **and** `sync_tailer`, plus `setEnv`, `seedBase`, `seedSeries`, `seedWorkingOrder`, `seedProduct`, `seedLine`, the image builders, `scalar`, `woStatus`, `lineCount`, `PROD`, `uuid`, `wire`). Add the headline test — the tenders/settlement wedge — proven by deletion:

```ts
describe("redelivery does not wedge the stream: business BEFORE-triggers are gated on app.sync_apply", () => {
  it("a redelivered tender after its settlement is a clean no-op, and WITHOUT the gate raises WT002", async () => {
    // Redelivery re-applies a below-cursor range at least once. Without the gate, re-inserting a
    // tender after its sale_settlements row committed fires tenders_reject_post_settlement -> WT002,
    // a NON-23503 that applyBatch does not park -> the stream wedges. The 0037 gate skips the trigger
    // under app.sync_apply='on', so the re-insert reaches ON CONFLICT DO NOTHING instead. Prove the
    // guard by DELETION: recreate the trigger ungated, watch the redelivery raise, restore.
    await setEnv("production");
    const b = await seedBase();
    const seriesId = await seedSeries(b);
    const originId = uuid();
    const subscriberId = uuid();
    const opts = { subscriberId, ...PROD };
    const applier = await postgres.pg.connectAs("sync_applier", "ap");
    try {
      const sale = saleImage(b, seriesId, 1, { total: "10.00" });
      const saleId = sale.id as string;
      // tenders columns (0005_sales.sql:47-55 + 0012:9): id, tenant_id, sale_id, method
      // (tender_method enum — confirm a valid value), amount, settled_at (NOT NULL, no default),
      // tip_amount. Every NOT NULL column must be present for jsonb_populate_record.
      const tender = {
        id: uuid(), tenant_id: b.tenantId, sale_id: saleId,
        method: "cash", amount: "10.00", tip_amount: "0.00",
        settled_at: "2026-08-11T10:00:00+00:00",
      };
      const settlement = {
        id: uuid(), tenant_id: b.tenantId, sale_id: saleId, settled_at: "2026-08-11T10:00:00+00:00",
      };
      // Apply sale (seq1) -> tender (seq2) -> settlement (seq3), in order. Coverage holds
      // (sum(amount)=10.00 = total 10.00 + tips 0.00), so sale_settlements_check_coverage passes.
      const first = await applyBatch(applier, [
        { seq: 1n, originId, table: "sales", op: "insert", tenantId: b.tenantId, rowImage: wire(sale) },
        { seq: 2n, originId, table: "tenders", op: "insert", tenantId: b.tenantId, rowImage: wire(tender) },
        { seq: 3n, originId, table: "sale_settlements", op: "insert", tenantId: b.tenantId, rowImage: wire(settlement) },
      ], opts);
      expect(first.applied).toBe(3);

      // Redeliver the tender at a HIGHER seq (seq4) so the cursor does not mask it -> it re-attempts
      // the INSERT. With the gate: ON CONFLICT DO NOTHING, applied 0, no throw.
      const redelivered = await applyBatch(applier, [
        { seq: 4n, originId, table: "tenders", op: "insert", tenantId: b.tenantId, rowImage: wire(tender) },
      ], opts);
      expect(redelivered.applied).toBe(0); // clean no-op, stream not wedged

      // DELETION control: recreate the trigger UNGATED and redeliver again -> WT002 propagates.
      await postgres.admin.execute(sql.raw(`drop trigger tenders_reject_post_settlement on tenders`));
      await postgres.admin.execute(
        sql.raw(`create trigger tenders_reject_post_settlement before insert on tenders
                 for each row execute function tenders_reject_post_settlement()`),
      );
      try {
        const err = await captureError(() =>
          applyBatch(applier, [
            { seq: 5n, originId, table: "tenders", op: "insert", tenantId: b.tenantId, rowImage: wire(tender) },
          ], opts),
        );
        expect(pgErrorCode(err)).toBe("WT002");
      } finally {
        // Restore the GATED trigger (roles/triggers are cluster/DB-global; leave the DB as 0037 left it).
        await postgres.admin.execute(sql.raw(`drop trigger tenders_reject_post_settlement on tenders`));
        await postgres.admin.execute(
          sql.raw(`create trigger tenders_reject_post_settlement before insert on tenders
                   for each row when (current_setting('app.sync_apply', true) is distinct from 'on')
                   execute function tenders_reject_post_settlement()`),
        );
      }
    } finally {
      await applier.close();
    }
  });
});
```

Import `captureError` and `pgErrorCode` from `@waitron/db` (as `apply.gate.test.ts:5` does). If the `tenders` row image needs a column this fixture omits, read the current `tenders` columns from `packages/db/drizzle/0005_sales.sql` + `0012_sale_settlement.sql:9` (`tip_amount`) and add them — every NOT NULL column must be present for `jsonb_populate_record`.

- [ ] **Step 2: Run it, watch it fail for the right reason.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test redelivery.gate`. Expected: FAIL at `expect(redelivered.applied).toBe(0)` — with no `0037` gate yet, the first redelivery (seq4) itself fires the ungated trigger and throws WT002 out of `applyBatch`, so the test errors before the deletion control. This is the wedge the migration removes.

- [ ] **Step 3: Scaffold the custom migration.** Run: `pnpm --filter @waitron/db db:generate:custom --name gate_triggers_on_sync_apply`. This writes an empty `drizzle/0037_gate_triggers_on_sync_apply.sql`, a `meta/0037_snapshot.json` (identical to `0036_snapshot.json` — triggers/functions are not in the Drizzle schema, so there is no diff, exactly as `0001_sync_retention.sql`'s header records for its own copy), and appends the `0037` entry to `_journal.json` (`idx: 37`, `tag: "0037_gate_triggers_on_sync_apply"`, `breakpoints: true`). Verify `git diff meta/0037_snapshot.json meta/0036_snapshot.json` shows no structural difference and that `_journal.json` gained exactly one entry.

- [ ] **Step 4: Hand-write the trigger DDL.** Replace the empty `0037_gate_triggers_on_sync_apply.sql` with:

```sql
-- Hand-written custom migration (drizzle-kit generate --custom): drizzle-kit models no triggers, so
-- this does not survive a later `generate` and 0037_snapshot.json is a copy of 0036's (no
-- table/column change) — the 0001_sync_retention.sql idiom.
--
-- WHAT THIS BUILDS. Gate the three un-gated business BEFORE-triggers on the enrolled commercial
-- tables so the sync apply path (which sets app.sync_apply='on') applies a source's already-validated
-- write VERBATIM instead of re-validating it (spec §4d(A); apply.ts:99-112). Without this, at-least-
-- once redelivery re-runs a validated write after a later row committed and raises a NON-23503 error
-- (tenders_reject_post_settlement -> WT002; the state-machine triggers -> a plain RAISE) that
-- applyBatch cannot park, wedging the stream. Only the TRIGGERS change (WHEN clause added); each
-- referenced FUNCTION keeps its current body — working_orders_enforce_transition's is the 0030
-- rewrite, the other two are their 0004/0012 originals.
--
-- `IS DISTINCT FROM` (not `<> 'on'`): current_setting(..., true) is NULL when the GUC is unset, and
-- NULL IS DISTINCT FROM 'on' is TRUE, so a LOCAL write (GUC unset) still fires the business trigger.
-- Only an apply write (GUC = 'on') skips it. Same clause the sync_capture triggers already use
-- (packages/sync/drizzle/0000_sync_outbox.sql:159).

DROP TRIGGER tenders_reject_post_settlement ON tenders;
--> statement-breakpoint
CREATE TRIGGER tenders_reject_post_settlement
  BEFORE INSERT ON tenders
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION tenders_reject_post_settlement();
--> statement-breakpoint

DROP TRIGGER working_orders_enforce_transition ON working_orders;
--> statement-breakpoint
CREATE TRIGGER working_orders_enforce_transition
  BEFORE UPDATE ON working_orders
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION working_orders_enforce_transition();
--> statement-breakpoint

DROP TRIGGER working_order_lines_require_open_parent ON working_order_lines;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent
  BEFORE INSERT OR UPDATE OR DELETE ON working_order_lines
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION working_order_lines_require_open_parent();
```

- [ ] **Step 5: Run the wedge test, watch it pass.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test redelivery.gate`. Expected: PASS — the redelivery is a clean no-op, and the deletion control confirms WT002 without the gate.

- [ ] **Step 6: Add the other two gated-trigger proofs.** In the same `describe`, add two more tests, each proving its trigger is gated by deletion:

```ts
it("a redelivered working_orders update after the order settled is clean, ungated it RAISES", async () => {
  await setEnv("production");
  const b = await seedBase();
  const originId = uuid();
  const subscriberId = uuid();
  const opts = { subscriberId, ...PROD };
  const applier = await postgres.pg.connectAs("sync_applier", "ap");
  try {
    const woId = uuid();
    const open = workingOrderImage(b, woId, { status: "open" });
    const settled = workingOrderImage(b, woId, { status: "settled", settled_at: "2026-08-11T11:00:00+00:00" });
    const first = await applyBatch(applier, [
      { seq: 1n, originId, table: "working_orders", op: "insert", tenantId: b.tenantId, rowImage: wire(open) },
      { seq: 2n, originId, table: "working_orders", op: "update", tenantId: b.tenantId, rowImage: wire(settled) },
    ], opts);
    expect(first.applied).toBe(2);
    // Redeliver the settled image (seq3): gated -> unconditional Group-C upsert re-sets same values,
    // no enforce_transition raise. (working_orders is watermark-upsert with watermarkColumn null.)
    const redelivered = await applyBatch(applier, [
      { seq: 3n, originId, table: "working_orders", op: "update", tenantId: b.tenantId, rowImage: wire(settled) },
    ], opts);
    expect(redelivered.applied).toBe(1);
    // DELETION control: ungate -> OLD.status='settled' is terminal -> RAISE (a plain error).
    await postgres.admin.execute(sql.raw(`drop trigger working_orders_enforce_transition on working_orders`));
    await postgres.admin.execute(
      sql.raw(`create trigger working_orders_enforce_transition before update on working_orders
               for each row execute function working_orders_enforce_transition()`),
    );
    try {
      const err = await captureError(() =>
        applyBatch(applier, [
          { seq: 4n, originId, table: "working_orders", op: "update", tenantId: b.tenantId, rowImage: wire(settled) },
        ], opts),
      );
      expect((err as Error).message).toContain("cannot transition"); // the enforce_transition RAISE
    } finally {
      await postgres.admin.execute(sql.raw(`drop trigger working_orders_enforce_transition on working_orders`));
      await postgres.admin.execute(
        sql.raw(`create trigger working_orders_enforce_transition before update on working_orders
                 for each row when (current_setting('app.sync_apply', true) is distinct from 'on')
                 execute function working_orders_enforce_transition()`),
      );
    }
  } finally {
    await applier.close();
  }
});

it("a redelivered working_order_lines op after the parent left 'open' is clean, ungated it RAISES", async () => {
  await setEnv("production");
  const b = await seedBase();
  const originId = uuid();
  const subscriberId = uuid();
  const opts = { subscriberId, ...PROD };
  const applier = await postgres.pg.connectAs("sync_applier", "ap");
  try {
    const woId = uuid();
    const lineId = uuid();
    const open = workingOrderImage(b, woId, { status: "open" });
    const settled = workingOrderImage(b, woId, { status: "settled", settled_at: "2026-08-11T11:00:00+00:00" });
    // A line while the parent is open, then settle the parent. descriptions must equal the venue
    // locales (['en']) so the ungated working_order_lines_check_locales still passes on redelivery.
    const line = {
      id: lineId, tenant_id: b.tenantId, working_order_id: woId, line_no: 1,
      descriptions: { en: "Coffee" }, quantity: "1.000", unit_price: "1.30",
      unit_price_gross: "1.43", vat_rate: "10.00", line_total: "1.30",
    };
    const first = await applyBatch(applier, [
      { seq: 1n, originId, table: "working_orders", op: "insert", tenantId: b.tenantId, rowImage: wire(open) },
      { seq: 2n, originId, table: "working_order_lines", op: "insert", tenantId: b.tenantId, rowImage: wire(line) },
      { seq: 3n, originId, table: "working_orders", op: "update", tenantId: b.tenantId, rowImage: wire(settled) },
    ], opts);
    expect(first.applied).toBe(3);
    const redelivered = await applyBatch(applier, [
      { seq: 4n, originId, table: "working_order_lines", op: "insert", tenantId: b.tenantId, rowImage: wire(line) },
    ], opts);
    expect(redelivered.applied).toBe(1); // gated -> ON CONFLICT DO UPDATE, parent-open check skipped
    await postgres.admin.execute(sql.raw(`drop trigger working_order_lines_require_open_parent on working_order_lines`));
    await postgres.admin.execute(
      sql.raw(`create trigger working_order_lines_require_open_parent
               before insert or update or delete on working_order_lines
               for each row execute function working_order_lines_require_open_parent()`),
    );
    try {
      const err = await captureError(() =>
        applyBatch(applier, [
          { seq: 5n, originId, table: "working_order_lines", op: "insert", tenantId: b.tenantId, rowImage: wire(line) },
        ], opts),
      );
      expect((err as Error).message).toContain("order is open"); // the require_open_parent RAISE
    } finally {
      await postgres.admin.execute(sql.raw(`drop trigger working_order_lines_require_open_parent on working_order_lines`));
      await postgres.admin.execute(
        sql.raw(`create trigger working_order_lines_require_open_parent
                 before insert or update or delete on working_order_lines
                 for each row when (current_setting('app.sync_apply', true) is distinct from 'on')
                 execute function working_order_lines_require_open_parent()`),
      );
    }
  } finally {
    await applier.close();
  }
});
```

- [ ] **Step 7: Run the sync suite unfiltered + typecheck.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage` (98/98/98/95) and `pnpm --filter @waitron/db typecheck`. Expected: PASS.

- [ ] **Step 8: Verify the migration keeps the whole DB green — run the affected packages UNFILTERED.** The migration re-creates triggers on `tenders`/`working_orders`/`working_order_lines`, so re-run the guards a scoped run would skip:
  - `pnpm --filter @waitron/db test:coverage` (full manifest applies cleanly; teardown + english-only guards load).
  - `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (the FORCE-RLS / immutability scan over every `tenant_id`-bearing table; unchanged FORCE RLS + grants, so it must stay green).
  - `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/migrations test` (the manifest runs `sync` last, after `0037`; confirm order).

- [ ] **Step 9: Commit.**

```bash
git add packages/db/drizzle/0037_gate_triggers_on_sync_apply.sql packages/db/drizzle/meta/ packages/sync/src/redelivery.gate.test.ts
git commit -s -m "feat(db): gate business BEFORE-triggers on app.sync_apply so redelivery cannot wedge"
```

---

## Task 3: Fix B (catalogue) — thread `nodeId` through the catalogue write path

**Files:**
- Modify: `apps/server/src/catalogue-api.ts:44-46` (`CatalogueApiDeps.cfg`) and `:127-135` (the `gated` `withTenant`).
- Modify: `apps/server/src/boot.ts:307-316` (pass `nodeId` into `mountCatalogueApi`).
- Create: `apps/server/src/sync-origin.rls.test.ts` (capture-origin proof, full manifest).

**Interfaces:**
- Consumes: `withTenant(db, tenantId, fn, { nodeId })` (`packages/db/src/tenancy.ts:52`) — the 4th arg sets `app.node_id`, which `sync_capture` stamps into `sync_log.origin_id` (already proven end-to-end for a `products` write by `packages/sync/src/origin.gate.test.ts`). `TillConfig.nodeId: NodeId` (`till-config.ts:47`).
- Produces: `CatalogueApiDeps.cfg: { tenantId: string; nodeId: string }`.

- [ ] **Step 1: Write the failing capture-origin test.** Create `apps/server/src/sync-origin.rls.test.ts`. Model the harness on `apps/server/src/catalogue-api.rls.test.ts` (a real container migrated with `migrationOptionsFor(manifestSets(), null)` — so the `sync` capture triggers are present — plus a manager-session fixture). The test drives a real catalogue write **through the mounted API** and asserts the captured origin:

```ts
it("a catalogue write captures sync_log.origin_id = cfg.nodeId (all-zero without the fix)", async () => {
  // origin.gate.test.ts already proves withTenant's 4th arg reaches origin_id; THIS guards that the
  // catalogue-api call site actually passes it. Control (the two directions differ, CLAUDE.md §1):
  // the same write with the pre-fix cfg (no nodeId) lands the all-zero origin.
  const nodeId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const app = new Hono();
  mountCatalogueApi(app, { db, cfg: { tenantId, nodeId }, mediaDir, maxUploadBytes: MAX_UPLOAD_BYTES }, log);
  // …authenticate a manager session (reuse catalogue-api.rls.test.ts's helper) and POST a catalogue…
  const res = await app.request("/management-api/catalogues", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ name: "Deli" }),
  });
  expect(res.status).toBe(200);
  const origin = await postgres.admin.execute<{ v: string }>(
    sql`select origin_id::text as v from sync_log where table_name = 'catalogues' order by seq desc limit 1`,
  );
  expect(origin.rows[0]!.v).toBe(nodeId);
});
```

- [ ] **Step 2: Run it, watch it fail.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-origin`. Expected: FAIL — `CatalogueApiDeps.cfg` has no `nodeId` (compile error) / the write lands the all-zero origin.

- [ ] **Step 3: Thread `nodeId`.** In `catalogue-api.ts:46`, widen the cfg type:

```ts
  cfg: { tenantId: string; nodeId: string };
```

In the `gated` helper (`:127-135`), pass it to `withTenant`:

```ts
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(
      deps.db,
      deps.cfg.tenantId,
      async (tx) => {
        await asAppUser(tx);
        await authorizeManager(tx, { managementSessionId: sessionId, permission: CATALOGUE_WRITE_PERMISSION });
        return fn(tx);
      },
      { nodeId: deps.cfg.nodeId },
    );
```

In `boot.ts:307-316`, pass the node id:

```ts
  mountCatalogueApi(
    app,
    {
      db,
      cfg: { tenantId: till.tenantId, nodeId: till.nodeId },
      mediaDir: config.mediaDir,
      maxUploadBytes: MAX_UPLOAD_BYTES,
    },
    log,
  );
```

(`asAppUser` issues `SET ROLE`, which does not reset the transaction-local `app.node_id` GUC, so origin attribution survives the role switch.)

- [ ] **Step 4: Run it + the control, watch it pass.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-origin`. Expected: PASS. Confirm the control direction is present (a `mountCatalogueApi` built with the all-zero origin lands `00000000-…`).

- [ ] **Step 5: Typecheck + commit.** Run: `pnpm --filter @waitron/server typecheck`, then:

```bash
git add apps/server/src/catalogue-api.ts apps/server/src/boot.ts apps/server/src/sync-origin.rls.test.ts
git commit -s -m "feat(server): thread nodeId through the catalogue write path for sync origin attribution"
```

---

## Task 4: Fix B (payments) — thread `nodeId` through the reconcile write path

**Files:**
- Modify: `packages/payments/src/reconcile.ts:224-232` (`ReconcileDeps`) and `:280` / `:318` / `:662` (the three `withTenant` calls).
- Modify: `packages/payments-stripe/src/reconciler.ts:49-56` (`StripeReconcilerOptions`) and `:84-96` (the `reconcilePayments` deps it builds).
- Modify: `apps/server/src/boot.ts:203-212` (pass `nodeId` into `StripeReconciler`).
- Modify: `apps/server/src/sync-origin.rls.test.ts` (add the reconcile capture-origin proof).

**Interfaces:**
- Consumes: `reconcilePayments(deps, tenantId, period, now)`; `withTenant(..., { nodeId })`; `NodeId` (`@waitron/shared`, a `Branded<string,"NodeId">`).
- Produces: `ReconcileDeps.nodeId: string` and `StripeReconcilerOptions.nodeId: string`.

- [ ] **Step 1: Write the failing reconcile capture-origin test.** Append to `apps/server/src/sync-origin.rls.test.ts` a test that drives the real `reconcilePayments` sweep to perform its `payments` UPDATE (the `reconcile_remediated_at` marker) and asserts the captured origin. Reuse the deterministic orphan fixture from `packages/payments/src/reconcile.rls.test.ts:53-55` (a `captured` payment on an `abandoned` working order, empty settlement report → auto-reversible orphan → `markReconcileRemediated` → `payments` UPDATE → captured):

```ts
it("the reconcile sweep's payments UPDATE captures origin_id = deps.nodeId (all-zero without the fix)", async () => {
  const nodeId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  // …seed a captured payment on an abandoned working order (mirror reconcile.rls.test.ts's fixture)…
  await reconcilePayments(
    { db, provider: "stripe", report: emptyReport, reverse: fakeReverse, incidents: recordIncidentOnce, settlementLagMs: 0, nodeId },
    tenantId, period, now,
  );
  const origin = await postgres.admin.execute<{ v: string }>(
    sql`select origin_id::text as v from sync_log where table_name = 'payments' and op = 'update' order by seq desc limit 1`,
  );
  expect(origin.rows[0]!.v).toBe(nodeId);
});
```

`emptyReport` is a `SettlementReportSource` whose `fetch` returns `[]`; `fakeReverse` returns a success (a `ReversalFn`). Both mirror the shapes `reconcile.test.ts` already builds.

- [ ] **Step 2: Run it, watch it fail.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-origin -t "reconcile sweep"`. Expected: FAIL — `ReconcileDeps` has no `nodeId` (compile error) / the `payments` UPDATE lands the all-zero origin.

- [ ] **Step 3: Thread `nodeId` through the reconcile deps.** In `reconcile.ts:224-232`, add the field:

```ts
export interface ReconcileDeps {
  db: Database;
  provider: string;
  report: SettlementReportSource;
  reverse: ReversalFn;
  incidents: IncidentSink;
  settlementLagMs: number;
  /** This node's origin id, threaded into every write `withTenant` below so the enrolled `payments`
   * UPDATE the sweep performs (the `reconcile_remediated_at` marker) captures a real origin, not the
   * all-zero sentinel (design §4d(B); sync origin attribution). */
  nodeId: string;
}
```

Pass `{ nodeId: deps.nodeId }` to the three `withTenant` calls at `:280`, `:318` and `:662` — e.g. `:318` becomes:

```ts
  await withTenant(deps.db, tenantId, async (tx) => {
    // …existing T2 body…
  }, { nodeId: deps.nodeId });
```

(`:318` is the load-bearing one — its `markReconcileRemediated` writes the enrolled `payments` table; `:280` is a read and `:662` writes only the non-enrolled `incidents`, but thread all three the design names for one consistent origin context.)

- [ ] **Step 4: Set `nodeId` where `ReconcileDeps` is built.** In `reconciler.ts:49-56`, add to `StripeReconcilerOptions`:

```ts
  /** This node's origin id, forwarded into `reconcilePayments`'s deps for sync origin attribution. */
  nodeId: string;
```

and pass it in the `reconcilePayments` deps object (`:84-96`): add `nodeId: this.opts.nodeId,`. In `boot.ts:203-212`, supply it from the till identity:

```ts
  const reconciler = new StripeReconciler({
    db,
    nodeId: config.till.nodeId,
    resolveAccount: stripeAccountResolver({ db, ring, environment: config.environment, makeStripe: defaultMakeStripe }),
    ...(config.settlementLagMs === undefined ? {} : { settlementLagMs: config.settlementLagMs }),
  });
```

- [ ] **Step 5: Run it, watch it pass; then run the payments packages unfiltered.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-origin`, then `pnpm --filter @waitron/payments test:coverage` and `pnpm --filter @waitron/payments-stripe test:coverage` (their existing reconcile suites now build `ReconcileDeps`/`StripeReconcilerOptions` with the new required `nodeId` — update those fixtures to pass a node id). Expected: PASS, thresholds met.

- [ ] **Step 6: Typecheck + commit.** Run: `pnpm --filter @waitron/payments typecheck && pnpm --filter @waitron/payments-stripe typecheck && pnpm --filter @waitron/server typecheck`, then:

```bash
git add packages/payments/src/reconcile.ts packages/payments-stripe/src/reconciler.ts apps/server/src/boot.ts apps/server/src/sync-origin.rls.test.ts packages/payments/src/reconcile.test.ts packages/payments/src/reconcile.rls.test.ts
git commit -s -m "feat(payments): thread nodeId through the reconcile write path for sync origin attribution"
```

---

## Task 5: `readSyncLogSince` — the `sync_tailer` source read

**Files:**
- Create: `packages/sync/src/source.ts`.
- Modify: `packages/sync/src/index.ts` (export `readSyncLogSince`, `ReadSyncLogArgs`).
- Create: `packages/sync/src/source.gate.test.ts` (real Postgres, as `sync_tailer` under `withTenant`).

**Interfaces:**
- Consumes: `withTenant` (the reader runs under the deli tenant context so the `sync_log_tenant_isolation` RLS policy fences it); a `Database`/`Transaction` connected as a `sync_tailer` member; the `sync_log` schema (`packages/sync/drizzle/0000_sync_outbox.sql:21-30`).
- Produces:

```ts
export interface ReadSyncLogArgs {
  /** Restrict to one producing node, or read all origins when omitted. */
  originId?: string;
  /** Exclusive lower bound — rows with `seq > afterSeq`. */
  afterSeq: bigint;
  /** Batch cap. */
  limit: number;
}
export function readSyncLogSince(sourceDb: Database, args: ReadSyncLogArgs): Promise<SyncLogRow[]>;
```

- [ ] **Step 1: Write the failing test.** Create `packages/sync/src/source.gate.test.ts`, harness copied from `origin.gate.test.ts` (full manifest; a `sync_tailer`-member LOGIN role — create `create role sync_reader login password 'rp'` then `grant sync_tailer to sync_reader` in `setup`). Seed a tenant + a captured row (do a real enrolled write under `withTenant(db, tenant, fn, { nodeId })` as `app_login` so the capture trigger writes `sync_log`), then read it back as `sync_reader`:

```ts
it("selects sync_log rows past afterSeq as sync_tailer, with row_image as raw jsonb TEXT", async () => {
  // Failing case: no readSyncLogSince yet. It must (a) run under withTenant so RLS admits sync_tailer,
  // (b) return seq as bigint (never a lossy number), (c) return row_image as raw TEXT (design §4b) —
  // a numeric 1.50 must arrive as the string "…1.50…", never a JS-parsed object.
  const b = await seedBase();                       // tenant + catalogue
  await captureAProductWrite(b, "1.50");            // an app_login write -> sync_capture -> sync_log
  const reader = await postgres.pg.connectAs("sync_reader", "rp");
  try {
    const rows = await withTenant(reader, b.tenantId, (tx) =>
      readSyncLogSince(tx, { afterSeq: 0n, limit: 100 }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const first = rows[0]!;
    expect(typeof first.seq).toBe("bigint");
    expect(typeof first.rowImage).toBe("string");    // raw jsonb TEXT, not an object
    expect(first.rowImage).toContain("1.50");        // scale preserved, never re-quoted to 1.5
    expect(rows.every((r, i) => i === 0 || r.seq > rows[i - 1]!.seq)).toBe(true); // ascending
  } finally {
    await reader.close();
  }
});
```

- [ ] **Step 2: Run it, watch it fail.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test source.gate`. Expected: FAIL — `readSyncLogSince` is not defined.

- [ ] **Step 3: Implement.** Create `source.ts`:

```ts
// The sync_tailer source read for the commercial-lane transport. Runs under the deli tenant context
// (withTenant), so the sync_log_tenant_isolation RLS policy (0000_sync_outbox.sql:48) fences it to
// this tenant's rows even as sync_tailer. Selects row_image::text — Postgres's canonical jsonb TEXT —
// so node-postgres returns a STRING and JS never parses the row's numerics (design §4b). seq is read
// as text and returned as bigint (a JS number would lose precision past 2^53).
import { sql } from "drizzle-orm";
import { type Database } from "@waitron/db";
import type { SyncLogRow } from "./apply.js";

export interface ReadSyncLogArgs {
  originId?: string;
  afterSeq: bigint;
  limit: number;
}

export async function readSyncLogSince(
  sourceDb: Database,
  args: ReadSyncLogArgs,
): Promise<SyncLogRow[]> {
  const result = await sourceDb.execute<{
    seq: string;
    origin_id: string;
    table_name: string;
    op: SyncLogRow["op"];
    tenant_id: string;
    row_image: string;
    txid: string;
  }>(sql`
    select seq::text as seq, origin_id::text as origin_id, table_name, op,
           tenant_id::text as tenant_id, row_image::text as row_image, txid::text as txid
    from sync_log
    where seq > ${args.afterSeq.toString()}::bigint
      ${args.originId === undefined ? sql`` : sql`and origin_id = ${args.originId}::uuid`}
    order by seq asc
    limit ${args.limit}
  `);
  return result.rows.map((r) => ({
    seq: BigInt(r.seq),
    originId: r.origin_id,
    table: r.table_name,
    op: r.op,
    tenantId: r.tenant_id,
    rowImage: r.row_image,
    txid: r.txid,
  }));
}
```

- [ ] **Step 4: Export + run, watch it pass.** Add to `index.ts`:

```ts
export { readSyncLogSince } from "./source.js";
export type { ReadSyncLogArgs } from "./source.js";
```

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test source.gate`. Expected: PASS. Add one more assertion proving `afterSeq` is exclusive (a second captured row at a higher seq is excluded when `afterSeq` equals the first row's seq) and — the control — that a `sync_reader` read for a DIFFERENT tenant returns nothing (RLS fences it), so the tenant scoping visibly bites.

- [ ] **Step 5: Coverage + commit.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage` (98/98/98/95), then:

```bash
git add packages/sync/src/source.ts packages/sync/src/source.gate.test.ts packages/sync/src/index.ts
git commit -s -m "feat(sync): readSyncLogSince reads sync_log as sync_tailer with row_image as raw jsonb text"
```

---

## Task 6: NDJSON wire codec — `encodeBatch` / `decodeBatch`

**Files:**
- Create: `packages/sync/src/wire.ts`.
- Modify: `packages/sync/src/index.ts` (export `encodeBatch`, `decodeBatch`).
- Create: `packages/sync/src/wire.test.ts` (hermetic — no DB, no container).

**Interfaces:**
- Consumes: `SyncLogRow` (with `rowImage: string`).
- Produces: `encodeBatch(rows: readonly SyncLogRow[]): string`, `decodeBatch(body: string): SyncLogRow[]`.

- [ ] **Step 1: Write the failing test.** Create `wire.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeBatch, encodeBatch } from "./wire.js";
import type { SyncLogRow } from "./apply.js";

describe("the NDJSON sync wire codec", () => {
  it("round-trips seq as a string and row_image as raw text, preserving a numeric 1.50", () => {
    // Byte-identity across the wire (design §4b): row_image is carried as a STRING field, never an
    // inlined object, so a numeric inside it (1.50) is inside a JSON string and is never parsed as a
    // number. seq is carried as a decimal string so it survives past 2^53.
    const rows: SyncLogRow[] = [
      { seq: 9007199254740993n, originId: "11111111-1111-4111-8111-111111111111", table: "sales",
        op: "insert", tenantId: "22222222-2222-4222-8222-222222222222",
        rowImage: '{"total": 1.50, "id": "33333333-3333-4333-8333-333333333333"}', txid: "42" },
    ];
    const decoded = decodeBatch(encodeBatch(rows));
    expect(decoded).toEqual(rows);            // exact, including the bigint seq and the raw rowImage text
    expect(decoded[0]!.rowImage).toContain("1.50"); // never collapsed to 1.5
    expect(typeof decoded[0]!.seq).toBe("bigint");
  });

  it("emits one JSON object per line and ignores a trailing newline / blank lines on decode", () => {
    const rows: SyncLogRow[] = [
      { seq: 1n, originId: "11111111-1111-4111-8111-111111111111", table: "sales", op: "insert",
        tenantId: "22222222-2222-4222-8222-222222222222", rowImage: '{"id":"a"}' },
      { seq: 2n, originId: "11111111-1111-4111-8111-111111111111", table: "sale_lines", op: "insert",
        tenantId: "22222222-2222-4222-8222-222222222222", rowImage: '{"id":"b"}' },
    ];
    const body = encodeBatch(rows);
    expect(body.split("\n").filter((l) => l.length > 0)).toHaveLength(2);
    expect(decodeBatch(body + "\n\n")).toEqual(rows); // blank/trailing lines tolerated
  });

  it("decodes an empty body to an empty batch", () => {
    expect(decodeBatch("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, watch it fail.** Run: `pnpm --filter @waitron/sync test wire`. Expected: FAIL — `wire.js` not found.

- [ ] **Step 3: Implement.** Create `wire.ts`:

```ts
// The NDJSON wire format for a sync batch (design §4b). One JSON object per line. Two rules make the
// byte-identity guarantee structural: seq travels as a decimal STRING (a JS number loses precision
// past 2^53), and row_image travels as a STRING field carrying the source's raw `row_image::text`,
// NEVER an inlined object — so a numeric inside it is inside a JSON string and JS never parses it.
import type { SyncLogRow } from "./apply.js";

interface WireRow {
  seq: string;
  originId: string;
  table: string;
  op: SyncLogRow["op"];
  tenantId: string;
  rowImage: string; // the source's raw jsonb text, as a JSON string
  txid?: string;
}

export function encodeBatch(rows: readonly SyncLogRow[]): string {
  return rows
    .map((r) => {
      const wire: WireRow = {
        seq: r.seq.toString(),
        originId: r.originId,
        table: r.table,
        op: r.op,
        tenantId: r.tenantId,
        rowImage: r.rowImage,
        ...(r.txid === undefined ? {} : { txid: r.txid }),
      };
      return JSON.stringify(wire);
    })
    .join("\n");
}

export function decodeBatch(body: string): SyncLogRow[] {
  return body
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const wire = JSON.parse(line) as WireRow;
      return {
        seq: BigInt(wire.seq),
        originId: wire.originId,
        table: wire.table,
        op: wire.op,
        tenantId: wire.tenantId,
        rowImage: wire.rowImage,
        ...(wire.txid === undefined ? {} : { txid: wire.txid }),
      };
    });
}
```

- [ ] **Step 4: Export + run, watch it pass.** Add to `index.ts`:

```ts
export { decodeBatch, encodeBatch } from "./wire.js";
```

Run: `pnpm --filter @waitron/sync test wire`. Expected: PASS.

- [ ] **Step 5: Coverage + commit.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage` (98/98/98/95), then:

```bash
git add packages/sync/src/wire.ts packages/sync/src/wire.test.ts packages/sync/src/index.ts
git commit -s -m "feat(sync): NDJSON wire codec carrying seq as string and row_image as raw text"
```

---

## Task 7: `mountSyncApi` + node-token middleware (`/sync-api/hello`, `/sync-api/log`)

**Files:**
- Modify: `packages/sync/src/errors.ts` (register `sync.node_unauthorized`).
- Modify: `packages/sync/src/errors.test.ts` (add the code to the reachability/registration assertions).
- Create: `apps/server/src/sync-api.ts` (`mountSyncApi` + the Bearer-token middleware).
- Modify: `apps/server/package.json` (add `@waitron/sync` dependency) — then `pnpm install`.
- Create: `apps/server/src/sync-api.rls.test.ts` (auth + `/hello` hermetic; `/log` against a real container).

**Interfaces:**
- Consumes: `readSyncLogSince`, `encodeBatch` (`@waitron/sync`); `withTenant`; `createErrorBoundary` (`apps/server/src/error-boundary.ts:30`); Hono. The DB connection is a `sync_tailer`-member pool under the deli tenant context.
- Produces:

```ts
export interface SyncApiDeps {
  db: Database;            // a sync_tailer-member pool
  tenantId: string;        // the deli tenant the source reads under
  nodeId: string;          // this node's origin id (config.till.nodeId), for /hello
  environment: string;     // config.environment, for /hello + the peer handshake
  nodeToken: string;       // the token peers must present (WAITRON_SYNC_NODE_TOKEN); non-blank
}
export function mountSyncApi(app: Hono, deps: SyncApiDeps, log: Logger): void;
```

- [ ] **Step 1: Register the error code (failing test first).** In `packages/sync/src/errors.test.ts`, add `sync.node_unauthorized` to whatever list the suite asserts is registered/reachable. Run `pnpm --filter @waitron/sync test errors` → FAIL (code not registered). Then add to `errors.ts` inside the `declare module` block:

```ts
    /** A peer presented a missing, blank or wrong node token to this node's sync-api. NO PARAMS —
     * the response is uniform (fail-closed, no oracle), and a token must never reach a log line or a
     * test name. Mapped to HTTP 401 by `mountSyncApi`'s error boundary. */
    "sync.node_unauthorized": Record<string, never>;
```

Run `pnpm --filter @waitron/sync test errors` → PASS. Commit this small step or fold into Step 6.

- [ ] **Step 2: Add the dependency.** Add `"@waitron/sync": "workspace:*"` to `apps/server/package.json` `dependencies` and run `pnpm install`. Commit the lockfile with the task (CI runs `--frozen-lockfile`).

- [ ] **Step 3: Write the failing auth + `/hello` tests.** Create `apps/server/src/sync-api.rls.test.ts`. The auth tests are hermetic — the middleware answers 401 **before any DB work** (the `catalogue-api.ts:119` "401 before any DB work" convention), so pass a `db` whose `.transaction`/`.execute` throw, proving it is never reached:

```ts
const throwingDb = { transaction: () => { throw new Error("db reached"); }, execute: () => { throw new Error("db reached"); } } as unknown as Database;
const deps = { db: throwingDb, tenantId: "t", nodeId: "n", environment: "production", nodeToken: "s3cret" };

it("refuses a missing, blank or wrong Bearer token with 401 (fail-closed), never touching the DB", async () => {
  const app = new Hono();
  mountSyncApi(app, deps, log);
  for (const headers of [ {}, { Authorization: "Bearer " }, { Authorization: "Bearer wrong" }, { Authorization: "s3cret" } ]) {
    const res = await app.request("/sync-api/log?after=0&limit=10", { headers });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("sync.node_unauthorized");
  }
});

it("/sync-api/hello returns this node's id and environment (still behind the token)", async () => {
  const app = new Hono();
  mountSyncApi(app, deps, log);
  const res = await app.request("/sync-api/hello", { headers: { Authorization: "Bearer s3cret" } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ nodeId: "n", environment: "production" });
});
```

- [ ] **Step 4: Run, watch fail; implement `mountSyncApi`.** Run: `pnpm --filter @waitron/server test sync-api` → FAIL. Create `sync-api.ts`:

```ts
import type { Hono, Context } from "hono";
import { timingSafeEqual } from "node:crypto";
import { AppError } from "@waitron/shared";
import { withTenant, type Database } from "@waitron/db";
import { encodeBatch, readSyncLogSince } from "@waitron/sync";
import { createErrorBoundary } from "./error-boundary.js";
import type { Logger } from "./logger.js";
// Loads @waitron/sync's error augmentation so this file may throw sync.node_unauthorized.
import "@waitron/sync";

const run = createErrorBoundary({ "sync.node_unauthorized": 401 }, "sync-api");

export interface SyncApiDeps {
  db: Database;
  tenantId: string;
  nodeId: string;
  environment: string;
  nodeToken: string;
}

/** Constant-time Bearer check. A missing/blank/wrong token throws sync.node_unauthorized (→ 401)
 * BEFORE any DB work — the same fail-closed posture as the empty-connection-string trap (CLAUDE.md §3):
 * a blank secret must never mean "no auth". */
function requireNodeToken(c: Context, nodeToken: string): void {
  const header = c.req.header("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(nodeToken);
  if (presented.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError("sync.node_unauthorized", {});
  }
}

export function mountSyncApi(app: Hono, deps: SyncApiDeps, log: Logger): void {
  app.get("/sync-api/hello", (c) =>
    run(c, log, async () => {
      requireNodeToken(c, deps.nodeToken);
      return c.json({ nodeId: deps.nodeId, environment: deps.environment });
    }),
  );
  app.get("/sync-api/log", (c) =>
    run(c, log, async () => {
      requireNodeToken(c, deps.nodeToken);
      const originId = c.req.query("originId");
      const afterSeq = BigInt(c.req.query("after") ?? "0");
      const limit = Number(c.req.query("limit") ?? "500");
      const rows = await withTenant(deps.db, deps.tenantId, (tx) =>
        readSyncLogSince(tx, { afterSeq, limit, ...(originId === undefined ? {} : { originId }) }),
      );
      return c.body(encodeBatch(rows), 200, { "content-type": "application/x-ndjson" });
    }),
  );
}
```

- [ ] **Step 5: Add a real `/log` read test (container).** Append to `sync-api.rls.test.ts` a container-backed test (full manifest + a `sync_reader` pool + a seeded captured row): a good-token `GET /sync-api/log?after=0&limit=10` returns 200, `content-type: application/x-ndjson`, and a body that `decodeBatch` parses back to the captured row with `rowImage` still raw text (`"1.50"` preserved). Use the same container harness as `source.gate.test.ts`.

- [ ] **Step 6: Run unfiltered + typecheck + commit.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`, `pnpm --filter @waitron/sync test:coverage`, `pnpm --filter @waitron/server typecheck`. Expected: PASS. Then:

```bash
git add packages/sync/src/errors.ts packages/sync/src/errors.test.ts apps/server/src/sync-api.ts apps/server/package.json apps/server/src/sync-api.rls.test.ts pnpm-lock.yaml
git commit -s -m "feat(server): mountSyncApi with node-token auth serving /sync-api/hello and /log"
```

---

## Task 8: Config wiring — `WAITRON_SYNC_*`

**Files:**
- Modify: `apps/server/src/config.ts` (add `loadSyncConfig` + `SyncPeer`/`SyncTransportConfig` types).
- Modify: `apps/server/src/config.test.ts` (parse + empty-string-refusal tests).

**Interfaces:**
- Consumes: `isUnset` (`config.ts:131`), `required` (`config.ts:135`), `AppError("server.config_invalid"/"server.config_missing")`.
- Produces:

```ts
export interface SyncPeer { nodeId: string; url: string; token: string; }
export interface SyncTransportConfig {
  nodeToken: string;      // WAITRON_SYNC_NODE_TOKEN — the token peers must present to us
  databaseUrl: string;    // WAITRON_SYNC_DATABASE_URL — a LOGIN role that is a member of app_user AND sync_tailer
  peers: SyncPeer[];      // WAITRON_SYNC_PEERS — JSON [{ nodeId, url, token }]
}
export function loadSyncConfig(env: Env): SyncTransportConfig | undefined;
```

**Design note (state it in the code + report it up):** the sync **node id** is `config.till.nodeId` — the provisioned node identity fix B already threads into `app.node_id` — so this plan deliberately does **not** add a redundant `WAITRON_SYNC_NODE_ID` (two variables that must agree is the drift the "one source of truth" rule forbids). `WAITRON_SYNC_DATABASE_URL` is added because the app-role pool cannot `SELECT sync_log` — the source read + the apply worker need a `sync_tailer`-member connection; provisioning that role is deployment #9's, so tests create it. Sync is **enabled iff `WAITRON_SYNC_PEERS` is set** (non-empty); then `nodeToken` and `databaseUrl` are required. Absent peers → `undefined` → no sync mounted (so `boot.test.ts`, which sets no sync env, is unaffected).

- [ ] **Step 1: Write the failing tests.** Add to `config.test.ts`:

```ts
it("loadSyncConfig is undefined when no peers are configured", () => {
  expect(loadSyncConfig({})).toBeUndefined();
});
it("loadSyncConfig parses peers and requires a non-blank token and database url", () => {
  const env = {
    WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "https://peer/", token: "tok2" }]),
    WAITRON_SYNC_NODE_TOKEN: "mine",
    WAITRON_SYNC_DATABASE_URL: "postgres://sync@host/db",
  };
  expect(loadSyncConfig(env)).toEqual({
    nodeToken: "mine",
    databaseUrl: "postgres://sync@host/db",
    peers: [{ nodeId: "n2", url: "https://peer/", token: "tok2" }],
  });
});
it("refuses a blank node token (VAR= is unset, must fail closed, never mean 'no auth')", () => {
  const env = { WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "u", token: "t" }]), WAITRON_SYNC_NODE_TOKEN: "", WAITRON_SYNC_DATABASE_URL: "x" };
  expect(() => loadSyncConfig(env)).toThrow(/config_missing|WAITRON_SYNC_NODE_TOKEN/);
});
it("refuses a peer with a blank url or token", () => {
  const env = { WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "", token: "t" }]), WAITRON_SYNC_NODE_TOKEN: "m", WAITRON_SYNC_DATABASE_URL: "x" };
  expect(() => loadSyncConfig(env)).toThrow(/config_invalid|WAITRON_SYNC_PEERS/);
});
it("refuses malformed WAITRON_SYNC_PEERS JSON", () => {
  expect(() => loadSyncConfig({ WAITRON_SYNC_PEERS: "not json" })).toThrow(/config_invalid|WAITRON_SYNC_PEERS/);
});
```

- [ ] **Step 2: Run, watch fail.** Run: `pnpm --filter @waitron/server test config -t "loadSyncConfig"`. Expected: FAIL — not defined.

- [ ] **Step 3: Implement `loadSyncConfig`.** Add to `config.ts` (reusing `isUnset`/`required`, throwing the existing `server.config_*` codes):

```ts
export interface SyncPeer { nodeId: string; url: string; token: string; }
export interface SyncTransportConfig { nodeToken: string; databaseUrl: string; peers: SyncPeer[]; }

/** Sync is enabled iff WAITRON_SYNC_PEERS is set. Then the node token and the sync database URL (a
 * LOGIN role that is a member of app_user AND sync_tailer — the app-role pool cannot read sync_log)
 * are required, and a blank token or peer field fails closed (the empty-value trap, CLAUDE.md §3).
 * The node id is config.till.nodeId, not a second variable. */
export function loadSyncConfig(env: Env): SyncTransportConfig | undefined {
  const rawPeers = env.WAITRON_SYNC_PEERS;
  if (isUnset(rawPeers)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPeers);
  } catch {
    throw new AppError("server.config_invalid", { variable: "WAITRON_SYNC_PEERS", reason: "not_json" });
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new AppError("server.config_invalid", { variable: "WAITRON_SYNC_PEERS", reason: "empty_or_not_array" });
  }
  const peers = parsed.map((p): SyncPeer => {
    const peer = p as Partial<SyncPeer>;
    if (isUnset(peer.nodeId) || isUnset(peer.url) || isUnset(peer.token)) {
      throw new AppError("server.config_invalid", { variable: "WAITRON_SYNC_PEERS", reason: "peer_field_blank" });
    }
    return { nodeId: peer.nodeId, url: peer.url, token: peer.token };
  });
  return {
    nodeToken: required(env, "WAITRON_SYNC_NODE_TOKEN"),
    databaseUrl: required(env, "WAITRON_SYNC_DATABASE_URL"),
    peers,
  };
}
```

- [ ] **Step 4: Run, watch pass.** Run: `pnpm --filter @waitron/server test config`. Expected: PASS (all five, plus the existing config suite).

- [ ] **Step 5: Coverage + commit.** Run: `pnpm --filter @waitron/server test:coverage` (98/98/98/95) and `pnpm --filter @waitron/server typecheck`. Then:

```bash
git add apps/server/src/config.ts apps/server/src/config.test.ts
git commit -s -m "feat(server): WAITRON_SYNC_* config parsing with fail-closed blank refusal"
```

---

## Task 9: `syncPullOnce` + the `runSyncPull` worker + boot wiring

**Files:**
- Create: `packages/sync/src/pull.ts` (`syncPullOnce`, `runSyncPull`, the `HttpClient` seam, `PullPeer`).
- Modify: `packages/sync/src/index.ts` (export the pull surface).
- Create: `packages/sync/src/pull.test.ts` (hermetic loop-control test with injected `pullOnce` + fake sleep) and add a `syncPullOnce` container test to `packages/sync/src/pull.gate.test.ts`.
- Modify: `apps/server/src/boot.ts` (open the sync pool, `mountSyncApi`, start `runSyncPull`, tear both down in `close()`).

**Interfaces:**
- Consumes: `applyBatch`, `decodeBatch`, `ApplyBatchResult`, `SyncLogRow`; `withTenant`; a `Database` (the `sync_tailer`+`app_user`-member pool); `createPostgresDb` (`boot.ts:4`); the config from Task 8.
- Produces:

```ts
export type HttpClient = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; text(): Promise<string> }>;
export interface PullPeer { nodeId: string; url: string; token: string; }
export interface SyncPullDeps {
  localDb: Database;            // sync_tailer + app_user member
  subscriberId: string;        // this node's id (config.till.nodeId)
  tenantId: string;            // the deli tenant
  localEnvironment: string;    // config.environment
  http: HttpClient;            // injected (default: global fetch adapter) — testable
  batchLimit: number;
}
export function syncPullOnce(deps: SyncPullDeps, peer: PullPeer): Promise<ApplyBatchResult>;
export interface RunSyncPullDeps extends SyncPullDeps {
  peers: readonly PullPeer[];
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  minIdleMs: number;
  maxBackoffMs: number;
  log: (level: string, code: string, params?: Record<string, unknown>) => void;
}
export function runSyncPull(deps: RunSyncPullDeps): Promise<void>;
```

- [ ] **Step 1: Write the failing hermetic loop test.** Create `pull.test.ts`. It injects `pullOnce` behaviour via the `http` seam and a fake `sleep`, and asserts the loop pulls until a batch comes back empty, then sleeps, and backs off on error:

```ts
it("pulls each peer until empty, sleeps the idle interval, and backs off on a transport error", async () => {
  // Failing case: runSyncPull is not defined. Behaviour: while a batch returns rows keep pulling
  // (advance the cursor), on an empty batch sleep(minIdleMs), on an HTTP/transport error sleep a
  // bounded exponential backoff. Drive it with a fake http returning two non-empty NDJSON batches
  // then empty, and a controller that aborts after N sleeps so the loop terminates.
  // …assert the sequence of `http` calls carries an increasing `after=` and the sleeps observed…
});
```

Model the abort/sleep/log fakes on `apps/server/src/loop.test.ts` (the existing `runLoop` test harness).

- [ ] **Step 2: Run, watch fail.** Run: `pnpm --filter @waitron/sync test pull`. Expected: FAIL — not defined.

- [ ] **Step 3: Implement `pull.ts`.**

```ts
// The commercial-lane pull client. syncPullOnce reads the local (subscriber, peer) cursor, GETs the
// peer's /sync-api/log past it, decodes the NDJSON, and hands the batch to applyBatch (which does the
// environment handshake, the seq-ordered idempotent apply, and the cursor advance). runSyncPull is the
// background loop boot.ts starts: pull until empty, sleep, repeat, with bounded exponential backoff on
// transport errors and a sync.stream_stalled log when backoff saturates (design §4a).
import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { type Database } from "@waitron/db";
import { applyBatch, type ApplyBatchResult } from "./apply.js";
import { decodeBatch } from "./wire.js";
import "./errors.js";

export type HttpClient = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface PullPeer { nodeId: string; url: string; token: string; }

export interface SyncPullDeps {
  localDb: Database;
  subscriberId: string;
  tenantId: string;
  localEnvironment: string;
  http: HttpClient;
  batchLimit: number;
}

async function readCursor(db: Database, subscriberId: string, originId: string): Promise<bigint> {
  const r = await db.execute<{ seq: string }>(
    sql`select coalesce(last_applied_seq, 0)::text as seq from sync_cursor
        where subscriber_id = ${subscriberId} and origin_id = ${originId}::uuid`,
  );
  return r.rows[0] ? BigInt(r.rows[0].seq) : 0n;
}

export async function syncPullOnce(deps: SyncPullDeps, peer: PullPeer): Promise<ApplyBatchResult> {
  const after = await readCursor(deps.localDb, deps.subscriberId, peer.nodeId);
  const url = `${peer.url.replace(/\/$/, "")}/sync-api/log?originId=${peer.nodeId}&after=${after.toString()}&limit=${deps.batchLimit}`;
  const res = await deps.http(url, { headers: { Authorization: `Bearer ${peer.token}` } });
  if (res.status !== 200) {
    throw new AppError("sync.stream_stalled", { subscriberId: deps.subscriberId, originId: peer.nodeId, lag: res.status });
  }
  const rows = decodeBatch(await res.text());
  const hello = await deps.http(`${peer.url.replace(/\/$/, "")}/sync-api/hello`, { headers: { Authorization: `Bearer ${peer.token}` } });
  const sourceEnvironment = (JSON.parse(await hello.text()) as { environment: string }).environment;
  return applyBatch(deps.localDb, rows, {
    subscriberId: deps.subscriberId,
    localEnvironment: deps.localEnvironment,
    sourceEnvironment,
  });
}
// runSyncPull: for-each-peer loop — GET /hello once for the env handshake, then repeatedly
// syncPullOnce until a batch returns empty; sleep minIdleMs; bounded exponential backoff on a thrown
// AppError/transport failure; log sync.stream_stalled when backoff saturates. (Full body per the
// loop.ts idiom — abort-aware sleep, per-peer backoff state.)
```

(Implement `runSyncPull`'s body against the `pull.test.ts` expectations; keep the env handshake fetch once per activation rather than per batch if the test asserts it — align the test and the code.)

- [ ] **Step 4: Run the loop test, watch pass; add the `syncPullOnce` container test.** Create `pull.gate.test.ts` (full manifest + a `sync_applier` pool). Inject an `http` seam that returns NDJSON built by `encodeBatch` of a hand-made batch (a captured `sales` row) plus a `/hello` returning `{ environment: "production" }`; assert `syncPullOnce` reads the cursor, applies the batch, advances `sync_cursor`, and a second call is idempotent (`applied: 0`). Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test pull`.

- [ ] **Step 5: Wire boot.** In `boot.ts`, after the existing mounts and before/around the loop: load the sync config, and when present open the sync pool + mount the source + start the worker:

```ts
  const syncConfig = loadSyncConfig(env);
  let syncDb: Database | undefined;
  let syncWorker: Promise<void> | undefined;
  const syncController = new AbortController();
  if (syncConfig !== undefined) {
    syncDb = await createPostgresDb(syncConfig.databaseUrl);
    mountSyncApi(
      app,
      { db: syncDb, tenantId: till.tenantId, nodeId: till.nodeId, environment: config.environment, nodeToken: syncConfig.nodeToken },
      log,
    );
    syncWorker = runSyncPull({
      localDb: syncDb,
      subscriberId: till.nodeId,
      tenantId: till.tenantId,
      localEnvironment: config.environment,
      http: fetchHttpClient,        // a thin global-fetch adapter (its own tiny module or inline)
      batchLimit: 500,
      peers: syncConfig.peers,
      sleep: (ms, signal) => realSleep(ms, signal),
      signal: syncController.signal,
      minIdleMs: config.minTickMs,
      maxBackoffMs: config.maxTickMs,
      log,
    });
  }
```

In `close()` (`boot.ts:476-494`), abort + await the worker and close the sync pool alongside the existing teardown, guarded (`if (syncDb !== undefined) await syncDb.close();`), so a `close()` never leaves the sync pool or worker dangling.

- [ ] **Step 6: Keep `boot.test.ts` green + run unfiltered.** `boot.test.ts` boots with no sync env, so `syncConfig` is `undefined` and nothing changes there — confirm it stays green. Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage` and `pnpm --filter @waitron/server test:coverage` (both 98/98/98/95), `pnpm --filter @waitron/sync typecheck && pnpm --filter @waitron/server typecheck`.

- [ ] **Step 7: Commit.**

```bash
git add packages/sync/src/pull.ts packages/sync/src/pull.test.ts packages/sync/src/pull.gate.test.ts packages/sync/src/index.ts apps/server/src/boot.ts
git commit -s -m "feat(sync): syncPullOnce + runSyncPull worker, wired into boot behind sync config"
```

---

## Task 10: Real-Postgres two-node end-to-end

**Files:**
- Create: `apps/server/src/sync-e2e.rls.test.ts` (two databases in one container; a real `mountSyncApi` source driven over HTTP by the pull worker).

**Interfaces:**
- Consumes: `mountSyncApi`, `syncPullOnce`/`runSyncPull`, `applyBatch`, `readSyncLogSince`, `encodeBatch`; `startMigratedPostgres` + `runMigrationSets`; `withTenant`; Hono `app.request` as the `HttpClient` seam.
- Produces: none (integration proof).

**Harness choice, justified in a header comment:** ONE `postgres:18-alpine` container holding TWO migrated databases — `source` (the container's default) and a second `target` created with `CREATE DATABASE` + `runMigrationSets(targetUri, migrationOptionsFor(manifestSets(), null))`. One container boot amortises the Postgres pull while still giving two independent databases with independent `sync_log`/`sync_cursor` state — the minimum that proves genuine **cross-DB** apply. The roles (`app_user`, `sync_tailer`, `sync_retention`, and the test's `sync_applier`) are cluster-global, so one set serves both databases. The HTTP wire is a real Hono `app.request` (a real `Request`/`Response` carrying the exact NDJSON bytes) — a bound socket is deployment #9's TLS concern; the byte-identity property is a property of the bytes, not the socket. Both sides act as the non-superuser `sync_applier`/`sync_reader` under FORCE RLS (PGlite would be a false pass, `CLAUDE.md` §4).

- [ ] **Step 1: Write the failing end-to-end test.**

```ts
it("captures on the source, pulls over HTTP into the target, advances the cursor, and redelivers idempotently", async () => {
  // Source: an enrolled write under withTenant{nodeId=A} -> sync_capture -> source.sync_log.
  // mountSyncApi(sourceApp) over the source's sync_reader pool serves /sync-api/log + /hello.
  // Worker: syncPullOnce(targetDb, http=sourceApp.request) applies into the TARGET as sync_applier.
  // Assert: the row lands in target.sales byte-identically (total 1.50 preserved), target.sync_cursor
  // advanced to the source's max seq, and a second pull is a clean no-op (applied 0).
  const sourceApp = new Hono();
  mountSyncApi(sourceApp, { db: sourceReader, tenantId, nodeId: NODE_A, environment: "production", nodeToken: "shared" }, log);
  const http: HttpClient = (url, init) => sourceApp.request(url, { headers: init.headers });

  // capture a sale with total 1.50 on the SOURCE (as app_login under withTenant{nodeId: NODE_A})
  await captureSaleOnSource("1.50");

  const first = await syncPullOnce(
    { localDb: targetApplier, subscriberId: NODE_B, tenantId, localEnvironment: "production", http, batchLimit: 500 },
    { nodeId: NODE_A, url: "", token: "shared" },
  );
  expect(first.applied).toBeGreaterThanOrEqual(1);
  expect(await targetSaleTotal(saleId)).toBe("1.50");                    // byte-identity across HTTP
  expect(await targetCursor(NODE_B, NODE_A)).toBe(sourceMaxSeq);         // cursor advanced

  const second = await syncPullOnce(/* same */);
  expect(second.applied).toBe(0);                                        // idempotent redelivery
});

it("refuses a peer in a different environment before applying anything", async () => {
  // Stamp the TARGET production and the SOURCE preproduction (or vice versa). /hello advertises the
  // source environment; applyBatch throws sync.peer_environment_mismatch and applies nothing. Prove by
  // deletion of the match: the same pull with matching stamps DOES land the row (both directions).
});
```

- [ ] **Step 2: Run, watch fail.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test sync-e2e`. Expected: FAIL until the harness (second DB creation + migration, source/target pools, capture helper) is complete.

- [ ] **Step 3: Build the harness + make it pass.** Create the `target` database and migrate it; open `sourceReader` (a `sync_reader`/`sync_tailer` pool on the source DB), `sourceWriter`/`app_login` (to capture), and `targetApplier` (`sync_applier` on the target DB). Fill in `captureSaleOnSource` (a real `sales` insert under `withTenant(sourceWriter, tenantId, …, { nodeId: NODE_A })` with valid parents seeded on both DBs as needed for the apply's FK targets), `targetSaleTotal`, `targetCursor`, `sourceMaxSeq`. Run until PASS.

- [ ] **Step 4: Run the env-mismatch test + confirm both directions.** Ensure the mismatch refusal test proves the throw precedes any apply (target row count stays 0) and the matching direction lands the row — the control that makes the guard load-bearing (`CLAUDE.md` §1).

- [ ] **Step 5: Coverage + commit.** Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` (98/98/98/95). Then:

```bash
git add apps/server/src/sync-e2e.rls.test.ts
git commit -s -m "test(server): two-node sync end-to-end — capture, HTTP pull, apply, cursor, idempotent redelivery"
```

---

## Task 11: Full gate, cross-cutting guards, and backlog

**Files:**
- Modify: `docs/backlog.md` (mark the transport slice landed / update the in-flight row).

- [ ] **Step 1: Run the four-command gate for whole-workspace breadth.** Run: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`. Fix anything red. (Then run `pnpm install` if any dependency moved, and commit the lockfile.)
- [ ] **Step 2: Re-run the cross-cutting guards a scoped run would skip.** Run, each unfiltered: `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (FORCE-RLS/immutability scan — the re-created triggers must not have disturbed it), `pnpm --filter @waitron/db test:coverage`, `pnpm --filter @waitron/sync test:coverage`, `pnpm --filter @waitron/server test:coverage`, `pnpm --filter @waitron/payments test:coverage`, `pnpm --filter @waitron/payments-stripe test:coverage`. All 98/98/98/95 (browser packages excepted, not touched here).
- [ ] **Step 3: Update `docs/backlog.md`** in the same change that makes it stale — record the transport slice as landed, note the deferred items still open (payments fast lane, cloud-mirror peer, dead-subscriber cleanup, multi-tenant transport, node-token rotation, promotion/fencing, the fiscal-lane H2 slice), and the deliberate deviations (node id reuses `till.nodeId`; `WAITRON_SYNC_DATABASE_URL` added).
- [ ] **Step 4: Commit + push, then follow the branch through CI and Copilot** per `CLAUDE.md` §6 (this is the executor's finish step, not part of any single task above).

```bash
git add docs/backlog.md
git commit -s -m "docs(backlog): sync transport slice 1 landed"
```

---

## Self-review (run against the spec; issues fixed inline)

**Spec coverage** (design `2026-08-15-sync-transport-slice1-design.md`):

- §1 in-scope transport module (source read + pull loop) → Tasks 5, 9. `mountSyncApi` node-token authed → Task 7. NDJSON `row_image` as raw jsonb text → Tasks 1, 6. Fix A (gate triggers) → Task 2. Fix B (thread `nodeId`) → Tasks 3, 4. ✓
- §2 inherited constraints: application-level apply as `app_user` under RLS → every gate suite uses a genuine non-superuser role; env isolation → Tasks 7/10; single ordered lane / `23503` park → unchanged `applyBatch`, exercised in Task 2's fixtures and Task 10. ✓
- §4a `readSyncLogSince` (`row_image::text`) → Task 5; `syncPullOnce` → Task 9; pull worker (hello handshake, loop, backoff, `sync.stream_stalled`) → Task 9. ✓
- §4b byte-identity → Task 1 (apply bind), Task 6 (wire), Task 10 (end-to-end). ✓
- §4c `mountSyncApi`, node-token middleware, config (`WAITRON_SYNC_*`, blank refusal) → Tasks 7, 8. ✓
- §4d(A)/(B) the two fixes → Tasks 2, 3, 4. ✓
- §5 data flow / §6 error handling (env mismatch, auth 401, FK park, stalled, no row content) → Tasks 7, 9, 10; `sync.node_unauthorized` carries no params. ✓
- §7 testing (two-node e2e, redelivery-wedge by deletion, byte-identity, env-mismatch, node-token auth) → Tasks 2, 6, 7, 10. ✓
- §8 parallel-safety (only this slice touches `packages/db/.../meta/_journal.json`, at `0037`) → Task 2. ✓

**Deliberate deviations from the design, flagged for the owner:** (1) the sync node id reuses `config.till.nodeId` rather than a new `WAITRON_SYNC_NODE_ID`, to avoid two sources of truth for one node's identity; (2) `WAITRON_SYNC_DATABASE_URL` is added (not in the design's config list) because the app-role pool cannot `SELECT sync_log` — the source read and apply worker need a `sync_tailer`-member connection. Both are stated in Task 8's design note and the return summary.

**Placeholder scan:** no `TBD`/`handle edge cases`/`similar to Task N`. Every code step carries real code; every run step carries a real command with an expected result. `runSyncPull`'s body is described by its test contract (Task 9 Step 1/3) rather than re-typed in full — the executor implements it against the injected-seam test, which is the honest way to specify a loop whose exact backoff shape the test pins.

**Type consistency:** `SyncLogRow.rowImage: string` is set in Task 1 and every later task treats it as text (`readSyncLogSince` returns it, `encodeBatch`/`decodeBatch` carry it as a JSON string field, `applyOneRow` binds it). `ReconcileDeps.nodeId: string` (Task 4) matches `StripeReconcilerOptions.nodeId: string` and `till.nodeId: NodeId` (a `string` subtype, assignable). `CatalogueApiDeps.cfg.nodeId: string` (Task 3) matches `boot`'s `till.nodeId`. `SyncApiDeps`/`SyncPullDeps`/`SyncTransportConfig` field names are consistent across Tasks 7/8/9. `readSyncLogSince(sourceDb, { originId?, afterSeq, limit })` is used with exactly those names in Tasks 7 and 9.
