# Working-time chain — per-node rekey — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rekey the working-time hash chain from `(tenant, location)` to `(tenant, node, location)` so a promoted cloud node and a returning box each keep their own chain of clock events, and add a hashed `recorded_at` that orders corrections deterministically across nodes.

**Architecture:** `workforce_chains` (the mutable head) and `time_entries` (the immutable append-only stream) gain a `node_id` column that joins their key; `time_entries` gains a hashed, per-chain-monotonic `recorded_at` and drops the non-replicating `ingest_seq`. The append path (`chain.ts`) stamps both and threads a `ChainKey`. A cold-restored box CONTINUES its chain (no reset, no restore hook); a genuine fork surfaces as a loud unique-index violation at drain. `verifyChain` is unchanged (strict, one segment from position 1).

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL 18 + PGlite (via `@waitron/db` test harness), Vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-07-workforce-chain-per-node-rekey-design.md` (read it alongside this plan; every task argues from it)

## Global Constraints

- **English-only in generic packages** (`CLAUDE.md` §3). New identifiers, columns and comments in `@waitron/workforce`, `@waitron/workforce-es`, `@waitron/core`, `@waitron/db` are English. The chain position is `sequence_no`/`sequenceNo`, never `secuencia` (that Spanish column belongs to the fiscal module only).
- **No backwards-compat / data-migration code** (`CLAUDE.md` §3). Nothing is deployed; the baseline is regenerated, never migrated. No backfill.
- **Never build SQL by string concatenation** — Drizzle `` sql`…${value}` `` parameterises; the schema-defining migrations are regenerated via `drizzle-kit`, and the hand-written triggers/grants are carried verbatim (`CLAUDE.md` §3, §6).
- **A by-id read still needs its own `eq(table.tenantId, …)`** (`CLAUDE.md` §3) — every read this plan adds scopes to the tenant.
- **`recorded_at` is the append's own timestamp**, injected via a clock parameter (default `() => new Date()`), NEVER supplied by the caller.
- **Migration regeneration procedure** (`CLAUDE.md` §6): reset `packages/workforce/drizzle/` to `origin/main`, keep the edited `src/schema/*.ts`, run `db:generate` then `db:generate:custom`, and paste the hand-written custom SQL back verbatim. On `origin/main` that custom SQL for this package is `0001_workforce_baseline_sql.sql`, which contains — and the regenerated file MUST still contain, byte-for-byte — the `reject_mutation()` trigger pair on `time_entries` (lines ~9-15), the two `ALTER TABLE "time_entries" ENABLE ALWAYS TRIGGER …` statements (lines 45-47), and every `REVOKE ALL … / GRANT …` block (the `time_entries` grant is `SELECT, INSERT` only; `workforce_chains` is `SELECT, INSERT, UPDATE`). Verify by running the package's schema/immutability suites.
- **Coverage floor for `@waitron/workforce` / `@waitron/workforce-es`:** 90/90/85/85 (`CLAUDE.md` §2). Run `pnpm --filter <pkg> test:coverage`, not `test`.
- **Gate before any push** (`CLAUDE.md` §2): `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, and the two `apps/server` workforce-api suites, and both workforce packages unfiltered.
- **`TESTCONTAINERS_RYUK_DISABLED=true`** for real-Postgres suites locally; run `pnpm reap` if a prior run was interrupted (`CLAUDE.md` §4).

---

## File Structure

**Modified — `packages/workforce/src/`:**
- `schema/workforce-chains.ts` — add `node_id`, `last_recorded_at`; PK → `(tenant, node, location)`; extend the pointer check to `last_recorded_at`.
- `schema/time-entries.ts` — add `node_id` (named FK), `recorded_at` + its second-check; drop `ingest_seq`; position uq → 4-column.
- `chain-hash.ts` — `EntryHashInput`/`VerifiableEntry` gain `nodeId`, `recordedAt`; `canonicalString` hashes `NodeId`, `RecordedAtMs`.
- `chain.ts` — `ChainKey { tenantId, nodeId, locationId }`; `lockChainHead`/`appendToChain`/`attemptAppend` take it; stamp `node_id` + monotonic `recorded_at`; write `last_recorded_at` to the head; injectable clock; add and export `readChain`.
- `errors.ts` — `attendance.append_contention` param type gains `nodeId: string`.
- `projection.ts` — `TimeEntryRecord` gains `nodeId`, `recordedAt`, drops `ingestSeq`. (`applyCorrections` precedence is Task 2.)
- `clocking.ts` — `ClockEventInput`/`CorrectionRequestInput`/`CorrectionApprovalInput` gain `nodeId`; `append`/`appendCorrection` pass the `ChainKey`; the two entry-read selects add `node_id`/`recorded_at`, drop `ingest_seq`; `currentState` order changes.
- `index.ts` — export `ChainKey`, `readChain`.
- `drizzle/0000_workforce_baseline.sql`, `drizzle/0001_workforce_baseline_sql.sql`, `drizzle/meta/*` — regenerated.

**Modified — `packages/workforce/test/`:**
- `fixtures.ts` — `insertTimeEntry` gains a `nodeId` param and builds a `ChainKey`.

**Modified — `apps/server/src/`:**
- `workforce-api.ts` — `WorkforceApiDeps.cfg` → `{ tenantId, nodeId }`; pass `nodeId` into every clock/correction call.
- `boot.ts:1340` — pass `config.till.nodeId` into `mountWorkforceApi`.

**Modified — `packages/workforce-es/src/`:**
- `registro-jornada.test.ts` — fixtures drop `ingestSeq`, add `nodeId`/`recordedAt`.
- `work-summary.test.ts` — the `clockDay` helper's `clockIn` calls supply `nodeId` (seed a node).

**Modified — `packages/core/src/`:** (Task 5)
- `record-void.ts:22`, `record-substitution.ts:348` — comment word `secuencia` → `sequence number`.

**Modified — docs:** (Task 6) swap spec §4.4, workforce design §5, `CLAUDE.md` §5, `docs/backlog.md`.

**Test files touched:** `chain-hash.test.ts`, `chain.test.ts`, `chain.concurrency.test.ts`, `clocking.test.ts`, `clocking.concurrency.test.ts`, `corrections.test.ts`, `projection.test.ts`, `immutability.test.ts`, `index.test.ts`, `migrations.test.ts` (workforce); `work-summary.test.ts`, `registro-jornada.test.ts` (workforce-es); `workforce-api.test.ts`, `workforce-api.pg.test.ts` (server); a new restore-continuation real-PG test (Task 4).

---

## Task 1: Rekey the schema, thread the chain key, and keep every consumer green (the foundation)

This is the one large task: the schema, the regenerated baseline, and the plumbing across the hash/append/projection/clocking layers all change together, because the package cannot type-check with the columns half-changed. **"Green" here means: the whole workspace compiles and every existing suite passes with the new columns.** The one behaviour deferred is cross-node correction precedence (Task 2) — Task 1 keeps `applyCorrections` on today's `sequence_no` rule and only makes its tests COMPILE (drop `ingestSeq` from fixtures); Task 2 rewrites the precedence test.

**Files:** every file in the "Modified — packages/workforce", "packages/workforce/test", "apps/server", and the two `workforce-es` test entries above, plus the workforce test files listed.

**Interfaces:**
- Produces: `ChainKey { tenantId: string; nodeId: string; locationId: string }` (exported from `chain.ts`, re-exported from `index.ts`).
- Produces: `appendToChain(tx, key: ChainKey, entry: TimeEntryAppend, clock?: () => Date)`, `lockChainHead(tx, key: ChainKey)`, `readChain(tx, key: ChainKey): Promise<VerifiableEntry[]>`.
- Produces: `EntryHashInput`/`VerifiableEntry` gain `nodeId: string`, `recordedAt: string`; `canonicalString` order: `SequenceNo, PersonId, LocationId, NodeId, EntryKind, EventAtMs, RecordedAtMs, EventOffsetMinutes, RecordedByPersonId, CapturedByTillId, CorrectsEntryId, CorrectionReason, CorrectionStatus, CorrectionActorId, PrevEntryHash`.
- Produces: `TimeEntryRecord` gains `nodeId: string`, `recordedAt: string`; loses `ingestSeq`.
- Produces: `ClockEventInput`/`CorrectionRequestInput`/`CorrectionApprovalInput` gain `nodeId: string`.
- Consumes: `nodes` from `@waitron/db`; `seedNode(db, tenant: TenantId, location: LocationId): Promise<NodeId>` from `@waitron/db/testing/seed.js` for suites.

### Phase A — schema + baseline

- [ ] **Step 1: Edit `workforce-chains.ts`** — add the `nodes` import, `node_id` and `last_recorded_at` columns, the new PK, and extend the pointer check so `last_recorded_at` is null iff the pointer is (spec §3.1).

```ts
import { nodes, locations, tenants } from "@waitron/db";
// columns:
tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
nodeId: uuid("node_id").notNull().references(() => nodes.id),
locationId: uuid("location_id").notNull().references(() => locations.id),
sequenceNo: integer("sequence_no").notNull().default(0),
lastEntryId: uuid("last_entry_id").references(() => timeEntries.id),
lastEntryHash: text("last_entry_hash"),
lastRecordedAt: timestamp("last_recorded_at", { withTimezone: true, mode: "string" }),
updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
// (t) => [
primaryKey({ columns: [t.tenantId, t.nodeId, t.locationId] }),
check(
  "workforce_chains_pointer_ck",
  sql`(${t.lastEntryId} is null) = (${t.lastEntryHash} is null)
      and (${t.lastEntryId} is null) = (${t.lastRecordedAt} is null)`,
),
```

- [ ] **Step 2: Edit `time-entries.ts`** — import `nodes`; add `node_id` (named array-form FK, matching this table's siblings), add `recorded_at` + its second-check, DELETE the `ingestSeq` column, widen the position uq.

```ts
// columns, after locationId:
nodeId: uuid("node_id").notNull(),
// ... keep event_at / event_offset_minutes / captured_by_till_id ...
recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull(),
// DELETE: ingestSeq: bigint("ingest_seq", ...).generatedAlwaysAsIdentity(),
// (t) => [ ... add:
foreignKey({ columns: [t.nodeId], foreignColumns: [nodes.id], name: "time_entries_node_fk" }).onDelete("restrict"),
uniqueIndex("time_entries_chain_position_uq").on(t.tenantId, t.nodeId, t.locationId, t.sequenceNo),
check("time_entries_recorded_at_second_ck", sql`date_trunc('second', ${t.recordedAt}) = ${t.recordedAt}`),
```

- [ ] **Step 3: Regenerate the baseline** (Global-Constraints procedure). After regen, OPEN `0001_workforce_baseline_sql.sql` and confirm it still contains, verbatim: the `time_entries` `reject_mutation()` trigger pair, the **two `ALTER TABLE "time_entries" ENABLE ALWAYS TRIGGER` statements** (these are already on `origin/main` — do NOT drop them; they keep the replication apply worker from copying a corrupted UPDATE), the `time_entries` `REVOKE ALL … / GRANT SELECT, INSERT`, and the `workforce_chains` `REVOKE ALL … / GRANT SELECT, INSERT, UPDATE`. Confirm the `ingest_seq` identity sequence is GONE from `0000_workforce_baseline.sql`.

```bash
git checkout origin/main -- packages/workforce/drizzle/
pnpm --filter @waitron/workforce db:generate --name workforce_baseline
pnpm --filter @waitron/workforce db:generate:custom --name workforce_baseline_sql
# paste the trigger pair, the two ENABLE ALWAYS lines, and the grants back verbatim
```

- [ ] **Step 4: Update the schema-shape + ingest_seq-specific tests, run them, watch them pass.**
  - `index.test.ts` (`getTableConfig`): asserted composite key → `(tenant_id, node_id, location_id)`; position uq → 4-column; add `time_entries_node_fk` and the `recorded_at` second-check; remove any `ingest_seq` assertion; assert the extended pointer check.
  - `migrations.test.ts`: DELETE the test "assigns ingest_seq in insertion order, increasing" (lines ~114-136; it selects `order by ingest_seq`, which no longer exists). Refresh any pinned snapshot counts.
  - `immutability.test.ts`: add `node_id` and `recorded_at` to the columns asserted immutable under `reject_mutation`.
  - `schema-ownership.test.ts`: confirm `nodes` is referenced, never re-exported.

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/workforce test -- index migrations schema-ownership immutability
```
Expected: PASS (a FULL package run does not pass until Phase E).

### Phase B — the hash

- [ ] **Step 5: Failing hash test** in `chain-hash.test.ts` — assert re-pointing `nodeId` and changing `recordedAt` each change the digest:

```ts
it("hashes node_id and recorded_at, and detects a re-pointed node", () => {
  const base: EntryHashInput = {
    sequenceNo: 1, personId: "p1", locationId: "L1", nodeId: "N1", entryKind: "in",
    eventAt: "2026-09-07T08:00:00.000Z", recordedAt: "2026-09-07T08:00:01.000Z",
    eventOffsetMinutes: 120, recordedByPersonId: "p1", capturedByTillId: null,
    correctsEntryId: null, correctionReason: null, correctionStatus: null, correctionActorId: null,
    prevEntryHash: null,
  };
  const h1 = computeEntryHash(base);
  expect(computeEntryHash({ ...base, nodeId: "N2" })).not.toBe(h1);
  expect(computeEntryHash({ ...base, recordedAt: "2026-09-07T09:00:00.000Z" })).not.toBe(h1);
});
```

- [ ] **Step 6: Run, verify FAIL** (property missing). `pnpm --filter @waitron/workforce test -- chain-hash`.

- [ ] **Step 7: Implement** — add `nodeId`/`recordedAt` to `EntryHashInput` (doc comments per spec §3.2) and insert into `canonicalString` in the fixed order (`… LocationId, NodeId, EntryKind, EventAtMs, RecordedAtMs, EventOffsetMinutes, …`).

- [ ] **Step 8: Run, verify PASS.** `pnpm --filter @waitron/workforce test -- chain-hash`.

### Phase C — the append path + readChain

- [ ] **Step 9: Update `chain.ts`** — export `ChainKey`; thread it through `selectHeadForUpdate`/`lockChainHead`/`attemptAppend`/`appendToChain`; select `lastRecordedAt` into `ChainHead`; stamp `node_id` and a monotonic whole-second `recorded_at`; write `last_recorded_at` back on the head; add an injectable `clock`. Add `readChain`.

```ts
export interface ChainKey { tenantId: string; nodeId: string; locationId: string }
// ChainHead gains: lastRecordedAt: string | null
// selectHeadForUpdate / lockChainHead: WHERE tenant+node+location; insert values include nodeId.

async function attemptAppend(tx, key: ChainKey, entry: TimeEntryAppend, clock: () => Date) {
  const head = await lockChainHead(tx, key);
  const sequenceNo = head.sequenceNo + 1;
  const isFirstEntry = head.lastEntryId === null;
  const prevEntryHash = head.lastEntryHash;
  const eventAt = truncateToWholeSecond(entry.eventAt);
  const nowMs = clock().getTime();
  const flooredMs = head.lastRecordedAt === null ? nowMs : Math.max(nowMs, Date.parse(head.lastRecordedAt));
  const recordedAt = truncateToWholeSecond(new Date(flooredMs).toISOString());
  const entryHash = computeEntryHash({ sequenceNo, personId: entry.personId, locationId: key.locationId,
    nodeId: key.nodeId, entryKind: entry.entryKind, eventAt, recordedAt,
    eventOffsetMinutes: entry.eventOffsetMinutes, recordedByPersonId: entry.recordedByPersonId,
    capturedByTillId: entry.capturedByTillId ?? null, correctsEntryId: entry.correctsEntryId ?? null,
    correctionReason: entry.correctionReason ?? null, correctionStatus: entry.correctionStatus ?? null,
    correctionActorId: entry.correctionActorId ?? null, prevEntryHash });
  const [inserted] = await tx.insert(timeEntries).values({ tenantId: key.tenantId, personId: entry.personId,
    locationId: key.locationId, nodeId: key.nodeId, entryKind: entry.entryKind, eventAt, recordedAt,
    eventOffsetMinutes: entry.eventOffsetMinutes, capturedByTillId: entry.capturedByTillId ?? null,
    recordedByPersonId: entry.recordedByPersonId, correctsEntryId: entry.correctsEntryId ?? null,
    correctionReason: entry.correctionReason ?? null, correctionStatus: entry.correctionStatus ?? null,
    correctionActorId: entry.correctionActorId ?? null, entryHash, prevEntryHash, sequenceNo, isFirstEntry })
    .returning({ id: timeEntries.id });
  if (inserted === undefined) throw new Error("time_entries: insert returned no row");
  await tx.update(workforceChains)
    .set({ sequenceNo, lastEntryId: inserted.id, lastEntryHash: entryHash, lastRecordedAt: recordedAt })
    .where(and(eq(workforceChains.tenantId, key.tenantId), eq(workforceChains.nodeId, key.nodeId),
               eq(workforceChains.locationId, key.locationId)));
  return { id: inserted.id, sequenceNo, entryHash };
}

export async function appendToChain(tx, key: ChainKey, entry: TimeEntryAppend, clock: () => Date = () => new Date()) {
  for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
    try { return await tx.transaction((n) => attemptAppend(n, key, entry, clock)); }
    catch (error) { if (!isUniqueViolation(error)) throw error; }
  }
  throw new AppError("attendance.append_contention", { ...key, attempts: MAX_APPEND_ATTEMPTS });
}

// readChain: SELECT the VerifiableEntry columns for one (tenant,node,location) ordered by sequence_no,
// reading event_at AND recorded_at through to_char(<col> at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
// so computeEntryHash reproduces the stored hash under node-postgres (the Date-vs-string trap).
export async function readChain(tx: Transaction, key: ChainKey): Promise<VerifiableEntry[]> { /* … */ }
```

Also update the `lockChainHead` genesis-guard throw (`chain.ts` ~line 117) to the key shape.

- [ ] **Step 10: `errors.ts`** — `attendance.append_contention` param type gains `nodeId: string` so the diagnostic names the node. (No test pins the params; `chain.test.ts` asserts only `.code`.)

- [ ] **Step 11: `index.ts`** — `export type { ChainKey }` and `export { readChain }` from `./chain.js`.

### Phase D — projection + clocking (types only; precedence stays today's)

- [ ] **Step 12: `projection.ts`** — `TimeEntryRecord` gains `nodeId: string`, `recordedAt: string`, drops `ingestSeq`; delete the `ingestSeq` doc paragraph, keep the `sequence_no` one. Leave `applyCorrections` on the current `sequenceNo` comparison.

- [ ] **Step 13: `clocking.ts`** — the three input types gain `nodeId: string`; `append`/`appendCorrection` build `{ tenantId, nodeId, locationId }` and pass it to `appendToChain`; the two entry-read selects (`entriesForLocationInPeriod` and the person-window read) replace `ingestSeq: timeEntries.ingestSeq` with `nodeId: timeEntries.nodeId` and `recordedAt: sql<string>\`to_char(${timeEntries.recordedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')\``; `currentState`'s `order by` → `event_at desc, recorded_at desc, node_id desc, sequence_no desc`.

### Phase E — app, fixtures, consumer tests, node seeding

- [ ] **Step 14: App wiring.** `workforce-api.ts`: `WorkforceApiDeps.cfg` → `{ tenantId: string; nodeId: string }`; every `clockIn`/`clockOut`/`requestCorrection`/`approveCorrection` call passes `nodeId: deps.cfg.nodeId`. `boot.ts:1340`: `cfg: { tenantId: till.tenantId, nodeId: config.till.nodeId }`.

- [ ] **Step 15: `test/fixtures.ts`.** `insertTimeEntry`'s `params` gains `nodeId: string`; its body builds `{ tenantId, nodeId, locationId }` and calls `appendToChain(inner, key, {…})`.

- [ ] **Step 16: Seed a node in EVERY appending suite and thread its id.** Each of these currently seeds only tenant+location; add `const nodeId = await seedNode(<ownerDb>, tenantId, locationId)` in setup and pass `nodeId` into the `ChainKey` / `event()` / `clockIn` / `insertTimeEntry` calls (the `time_entries_node_fk` restrict FK is enforced on PGlite too):
  - `packages/workforce/src/chain.test.ts`
  - `packages/workforce/src/chain.concurrency.test.ts`
  - `packages/workforce/src/clocking.test.ts`
  - `packages/workforce/src/clocking.concurrency.test.ts` (its `event()` helper, line ~52; and `insertTimeEntry` calls)
  - `packages/workforce/src/corrections.test.ts` (and change its raw `order by ingest_seq`, line ~96, to `order by recorded_at`)
  - `packages/workforce-es/src/work-summary.test.ts` (its `clockDay` helper's `clockIn`, lines ~37/46/49)
  - `packages/workforce-es/src/registro-jornada.test.ts` (its `TimeEntryRecord` fixtures, ~115/125/135: drop `ingestSeq`, add `nodeId`, `recordedAt`)

- [ ] **Step 17: `projection.test.ts` COMPILE fix (not the semantic rewrite).** Its `entry()` helper (lines ~25/39) sets `ingestSeq`; drop that field and add `nodeId` (default e.g. `"node-1"`) and `recordedAt` (default derived so it ascends with `sequenceNo`, keeping the existing single-chain tests' meaning). The tie-break test at line ~267 still passes under today's `sequenceNo` rule after this fix — Task 2 rewrites it.

### Phase F — new behaviour tests + green

- [ ] **Step 18: Two-node + backward-clock tests** in `chain.test.ts` (PGlite; seed two `nodes` rows for one location via `seedNode`):

```ts
it("keeps one chain per (node, location); two nodes at one location do not collide", async () => {
  const k1 = { tenantId, nodeId: nodeA, locationId: loc };
  const k2 = { tenantId, nodeId: nodeB, locationId: loc };
  await appendToChain(tx, k1, clockEvent()); await appendToChain(tx, k1, clockEvent());
  await appendToChain(tx, k2, clockEvent());
  expect((await readChain(tx, k1)).map((e) => e.sequenceNo)).toEqual([1, 2]);
  expect((await readChain(tx, k2)).map((e) => e.sequenceNo)).toEqual([1]);
  expect(verifyChain(await readChain(tx, k1))).toEqual({ ok: true });
  expect(verifyChain(await readChain(tx, k2))).toEqual({ ok: true });
});

it("keeps recorded_at non-decreasing per chain when the clock steps backward", async () => {
  const k = { tenantId, nodeId, locationId: loc };
  let t = Date.parse("2026-09-07T08:00:05.000Z");
  const clock = () => new Date(t);
  await appendToChain(tx, k, clockEvent(), clock);
  t = Date.parse("2026-09-07T08:00:02.000Z"); // steps BACK
  await appendToChain(tx, k, clockEvent(), clock);
  const rows = await readChain(tx, k);
  expect(rows[1].recordedAt >= rows[0].recordedAt).toBe(true); // clamped to the head high-water mark
  expect(verifyChain(rows)).toEqual({ ok: true });
});
```
Prove the clamp by deletion: temporarily replace `Math.max(nowMs, …)` with `nowMs` and confirm the second test fails (the assertion, or `verifyChain` if the recompute diverges); restore.

- [ ] **Step 19: Full green.** Run and watch pass:

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/workforce test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/workforce-es test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test -- workforce-api
pnpm --filter @waitron/workforce typecheck && pnpm --filter @waitron/server typecheck
pnpm --filter @waitron/workforce lint && pnpm --filter @waitron/workforce format:check
```

- [ ] **Step 20: Commit.**

```bash
git add packages/workforce packages/workforce-es apps/server
git commit -s -m "feat(workforce): rekey the working-time chain per node

Add node_id + hashed recorded_at to workforce_chains/time_entries, key the
chain on (tenant, node, location), drop the non-replicating ingest_seq, and
thread a ChainKey + injectable clock through the append path. recorded_at is
clamped monotonic per chain via the head high-water mark; readChain reads one
chain for verification. Baseline regenerated (immutability triggers, the two
ENABLE ALWAYS statements, and grants carried verbatim). Correction precedence
across nodes is the next commit.
Spec: docs/superpowers/specs/2026-09-07-workforce-chain-per-node-rekey-design.md"
```

---

## Task 2: Cross-node correction precedence

**Files:** Modify `packages/workforce/src/projection.ts` (`applyCorrections`); Test `projection.test.ts`, `corrections.test.ts`.
**Interfaces:** Consumes `TimeEntryRecord.nodeId`, `.recordedAt`, `.sequenceNo` (Task 1).

- [ ] **Step 1: Rewrite the tie-break test** at `projection.test.ts` ~line 267 (today "…on the hashed sequenceNo, not the unhashed ingestSeq") for the new rule, and add a cross-node case:

```ts
it("picks the correction with the greatest (recordedAt, nodeId, sequenceNo) across nodes", () => {
  const base = entry("p1", "in", "2026-01-05T09:00:00Z", { entryId: "e1", sequenceNo: 1 });
  const onBox = correction({ correctsEntryId: "e1", nodeId: "A", sequenceNo: 9,
    recordedAt: "2026-01-05T10:05:00Z", status: "approved", eventAt: "2026-01-05T10:10:00Z" });
  const onCloud = correction({ correctsEntryId: "e1", nodeId: "B", sequenceNo: 2,
    recordedAt: "2026-01-05T10:06:00Z", status: "approved", eventAt: "2026-01-05T10:20:00Z" });
  const [eff] = applyCorrections([base, onBox, onCloud]);
  expect(eff.eventAt).toBe("2026-01-05T10:20:00Z"); // cloud wins on later recorded_at
});
```
Add a same-`recordedAt` case asserting the `nodeId` tie-break, and keep/adjust a single-chain case proving the result equals the old `sequenceNo`-max behaviour when `recordedAt` ascends with `sequenceNo`.

- [ ] **Step 2: Run, verify FAIL** (old rule picks `onBox`). `pnpm --filter @waitron/workforce test -- projection`.

- [ ] **Step 3: Implement** in `applyCorrections`:

```ts
function laterThan(a: TimeEntryRecord, b: TimeEntryRecord): boolean {
  if (a.recordedAt !== b.recordedAt) return a.recordedAt > b.recordedAt;
  if (a.nodeId !== b.nodeId) return a.nodeId > b.nodeId;
  return a.sequenceNo > b.sequenceNo;
}
// in the latestApprovedByTarget loop:
if (current === undefined || laterThan(e, current)) latestApprovedByTarget.set(e.correctsEntryId, e);
```

- [ ] **Step 4: Run projection + corrections, verify PASS.** `pnpm --filter @waitron/workforce test -- projection corrections`.

- [ ] **Step 5: Commit.**

```bash
git add packages/workforce/src/projection.ts packages/workforce/src/projection.test.ts packages/workforce/src/corrections.test.ts
git commit -s -m "feat(workforce): order corrections by (recorded_at, node_id, sequence_no) across nodes"
```

---

## Task 3: Re-prove append contention on the new key (real Postgres)

**Files:** Modify `packages/workforce/src/chain.concurrency.test.ts`.
**Interfaces:** Consumes `ChainKey`, `appendToChain`, `seedNode` (Task 1).

- [ ] **Step 1: Update the concurrency test** to key on `(tenant, node, location)`: keep the "naive read-then-write loses the race, loser retries under the savepoint" assertion (now on the node key); add a case proving two DIFFERENT nodes at one location never contend (different heads). (Node seeding was added in Task 1 Step 16; this task edits the assertions.)

- [ ] **Step 2: Run (real PG), verify PASS; then the negative control:** temporarily narrow `time_entries_chain_position_uq` to drop `node_id`, re-run, confirm the two-node case now FAILS (proves the key is what isolates them), restore.

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/workforce test -- chain.concurrency
```

- [ ] **Step 3: Commit.**

```bash
git add packages/workforce/src/chain.concurrency.test.ts
git commit -s -m "test(workforce): re-prove chain-position contention on the (tenant, node, location) key"
```

---

## Task 4: Restore-continuation and fork test (real Postgres)

**Files:** Test — new `packages/workforce/src/restore-continuation.pg.test.ts` (or a real-PG case in `chain.test.ts`).
**Interfaces:** Consumes `readChain`, `appendToChain`, `verifyChain`, `seedNode` (Task 1).

- [ ] **Step 1: Failing test** — prove a restored chain continues (one strict segment) and a fork with a survivor collides loudly:

```ts
it("continues the chain after a restore; a fork with a survivor collides loudly", async () => {
  const key = { tenantId, nodeId, locationId };
  for (let i = 0; i < 3; i++) await appendToChain(tx, key, clockEvent()); // positions 1..3
  // a cold restore reloads exactly this state (rows 1..3, head at 3); continue:
  await appendToChain(tx, key, clockEvent()); // position 4, chains onto row 3's hash
  expect(verifyChain(await readChain(tx, key))).toEqual({ ok: true }); // one strict segment 1..4

  // fork control: a raw insert reusing position 4 (a survivor's copy) is refused by the uq.
  await expect(
    tx.execute(sql`insert into time_entries (tenant_id, node_id, location_id, sequence_no, /* … */)
                   values (${tenantId}, ${nodeId}, ${locationId}, 4, /* … */)`)
  ).rejects.toMatchObject({ code: "23505" });
});
```

- [ ] **Step 2: Run, verify PASS** (`readChain` and the append path already exist from Task 1; this task adds only the test). If a helper to build a raw insert row is needed, add it locally in the test.

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/workforce test -- restore-continuation
```

- [ ] **Step 3: Commit.**

```bash
git add packages/workforce/src/restore-continuation.pg.test.ts
git commit -s -m "test(workforce): prove a cold restore continues the chain and a fork collides loudly"
```

---

## Task 5: Tidy the core `secuencia` comments

Opportunistic English-only tidy the owner asked to fold in. NOTE: the english-only guard does NOT currently flag `secuencia` (it is not in the guard's word list), so this is a readability fix, not a guard fix — do it, but do not expect a test to have been failing.

**Files:** Modify `packages/core/src/record-void.ts:22`, `packages/core/src/record-substitution.ts:348`.

- [ ] **Step 1: Edit both comments** — the bare Spanish word `secuencia` → `sequence number`. Leave the fiscal INDEX name `registros_tenant_node_secuencia_uq` wherever it appears (a real identifier).

- [ ] **Step 2: Run core typecheck + lint.** `pnpm --filter @waitron/core typecheck && pnpm --filter @waitron/core lint`.

- [ ] **Step 3: Commit.**

```bash
git add packages/core/src/record-void.ts packages/core/src/record-substitution.ts
git commit -s -m "docs(core): use English 'sequence number' in comments (English-only, CLAUDE.md §3)"
```

---

## Task 6: Documentation

**Files:** swap spec §4.4; workforce design §5; `CLAUDE.md` §5; `docs/backlog.md`.

- [ ] **Step 1: Swap spec §4.4** — dated pointer: the rekey landed; key is `(tenant, node, location)` (node ADDED, not substituted); a cold-restored box CONTINUES its chain (no reset), and a fork surfaces as the `multiple_unique_conflicts` stall §4.2 already handles. `time_entries` is no longer the drain-stall shape named there.
- [ ] **Step 2: Workforce design §5** — dated pointer: "one chain per location" → "one chain per (node, location)"; the central-ingest framing now spans a promotion (a location's registro is the union of its per-node chains).
- [ ] **Step 3: `CLAUDE.md` §5** — one line on the re-registration bullet: UNLIKE the fiscal chain, the working-time chain is NOT reset on a cold restore — it continues from the backup's head, and a fork with a surviving copy surfaces as a loud drain stall (the fiscal reset exists to mint a fresh SIF for AEAT, which the working-time record has no equivalent of). State the property, not a count.
- [ ] **Step 4: `docs/backlog.md`** — Track A: the working-time rekey (between steps 2 and 4) marked landed with this PR number; swap S3/S4 prerequisite discharged.
- [ ] **Step 5: Commit.**

```bash
git add docs/ CLAUDE.md
git commit -s -m "docs: record the working-time per-node rekey (swap §4.4, workforce §5, CLAUDE.md §5, backlog)"
```

---

## Self-Review

**Spec coverage:** §2.1 key → T1 (Steps 1-2); §2.2 recorded_at + drop ingest_seq → T1 (Steps 2,7,9,12,13,16,17; migrations test Step 4); §2.3 continue-no-reset → T4 + T6 Step 3; §2.4 one PR → whole plan; §3 schema/hash/append → T1 A-C; §4.1 monotonic clamp → T1 Step 9 (behaviour) + Step 18 (backward-clock test, proven by deletion); §4.2 precedence → T2; §4.3 unchanged reads → T1 Step 13 (columns added to selects; no WHERE change — verified by the plan reviewer); §5 no-hook/strict verifier → T4 proves continuation, verifier untouched; §6 testing → T1-T4; §7 docs → T6; §8 out-of-scope → nothing.

**Placeholder scan:** `readChain` body and the Task 4 raw-insert column list are the only elisions — both are mechanical (the columns are enumerated in `time-entries.ts`) and the surrounding contract (signature, ordering, `to_char` shape) is fully specified.

**Type consistency:** `ChainKey` (T1) used verbatim in T2-T4; `TimeEntryRecord.recordedAt/nodeId` (T1 Step 12) consumed by T2's `laterThan`; `readChain` implemented and exported in T1 (Steps 9,11), only USED in T1 Step 18 and T4 — no forward reference.

**Green-per-task (plan-reviewer's blockers, all folded):** every consumer of the changed symbols is in Task 1's file list — `test/fixtures.ts` (Step 15), `projection.test.ts`/`corrections.test.ts` (Steps 16-17), `clocking.concurrency.test.ts` + `work-summary.test.ts` (Step 16), `migrations.test.ts` ingest_seq test (Step 4). Node FK seeding is enumerated across all appending suites (Step 16). `ENABLE ALWAYS` preservation is corrected in Step 3.

---

## Execution Handoff

Per owner standing preference, execution is **subagent-driven** (one fresh subagent per task, two-stage review between tasks) — REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Each per-task dispatch's verify step includes `pnpm lint`, `pnpm typecheck`, `pnpm format:check` and the package's `test:coverage` (`CLAUDE.md` §2; the `format-check-in-per-slice-gate` standing note). Task 1 is the large foundation; Tasks 2-6 are small and independently reviewable.
