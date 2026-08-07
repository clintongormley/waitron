# Frozen daily close (cierre Z, slice 8b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A frozen, numbered, immutable, tamper-evident end-of-day close: `recordDailyClose` snapshots the (VAT-exact) `computeDailyClose` + a per-till cash count into an append-only `daily_closes` row, chained per `(tenant, node)`.

**Architecture:** Two tables in `packages/db` — the immutable `daily_closes` (full immutability recipe) and the mutable per-`(tenant, node)` `daily_close_chain` head. The write + hashing live in `@waitron/reporting` (which gains a guarded write). One transaction, single-active-writer via a `FOR UPDATE` lock on the head. `entry_hash = SHA-256(canonical(identity ‖ snapshot) ‖ prev_entry_hash)`, uppercase hex — the non-fiscal chain idiom.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres/PGlite), Vitest, Node `crypto`.

**Design:** `docs/superpowers/specs/2026-08-07-frozen-daily-close-z-design.md`. **Depends on 8a** (`sales.vat_breakdown`, exact `computeVatSummary`).

## Global Constraints

- **English schema/type/function tokens only** (`@waitron/reporting` + `packages/db` are under the `english-only` guard). `daily_closes`, `daily_close_chain`, `cash_variance`, `entry_hash`, `prev_entry_hash`, `sequence_no`. The Spanish _cierre Z_ / _descuadre_ appear only in comments (the guard strips comments) — never as tokens or string literals. Do NOT add them to `SPANISH_WORDS`.
- **TDD; commit `-s` per task.** Coverage `packages/*` = 98/98/98/95; run `pnpm --filter <pkg> test:coverage`.
- **Immutability recipe applied in the SAME migration that creates `daily_closes`** (`immutability.sql.md` — a later migration leaves an unprotected gap): `REVOKE ALL … FROM app_user; GRANT SELECT, INSERT` (no UPDATE/DELETE), a `BEFORE UPDATE OR DELETE` append-only trigger, a `BEFORE TRUNCATE` block, `FORCE ROW LEVEL SECURITY` + a tenant-isolation policy. `daily_close_chain` gets Part-4 only (FORCE + policy + grants **including UPDATE**, no append-only trigger — it updates).
- **`recordDailyClose` snapshots the exact `computeDailyClose` output** — never a re-derivation with different math. The stored VAT figures are 8a's exact ones.
- **`cash_variance` never blocks, never touches the fiscal huella or VAT.** Operational only.
- **Migration sequencing:** adds the next free `packages/db` migration after allergens (`0031`) and 8a (`0032`) → **`0033`**. Rebase if they land out of order (`_journal.json` collides).
- **Real Postgres** for anything about RLS, the immutability triggers, the non-superuser role, and concurrency (PGlite serialises and runs as superuser — a false pass there). PGlite for pure hash/reconciliation math.
- **Gate additionally runs** `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (the new FORCE-RLS table must be fully protected) and `pnpm --filter @waitron/reporting test:coverage`.

---

### Task 1: `daily_closes` + `daily_close_chain` schema & migration (`packages/db`)

**Files:**
- Create: `packages/db/src/schema/daily-closes.ts` (both tables)
- Modify: `packages/db/src/schema/index.ts` + `packages/db/src/index.ts` (re-export)
- Create/generate: `packages/db/drizzle/0033_*.sql` (+ `_journal.json` + snapshot), then **hand-edit** to append the immutability recipe
- Test: `packages/db/src/schema/daily-closes.rls.test.ts` (real PG: columns present; immutability triggers reject UPDATE/DELETE; FORCE RLS isolates tenants; the head is UPDATE-able)

**Interfaces:**
- Produces: `dailyCloses`, `dailyCloseChain` Drizzle tables. `daily_closes(id, tenant_id, node_id, business_day, sequence_no, prev_entry_hash, entry_hash, closed_at, closed_by, snapshot jsonb)` with `UNIQUE(tenant_id,node_id,business_day)` + `UNIQUE(tenant_id,node_id,sequence_no)`; `daily_close_chain(tenant_id, node_id, sequence_no, last_entry_hash)` PK `(tenant_id,node_id)`.

- [ ] **Step 1: Write the failing real-PG test** — `daily-closes.rls.test.ts` (mirror `packages/catalogue/src/operations.rls.test.ts` for harness + `useRealPostgres`):

```ts
it("daily_closes rejects UPDATE and DELETE under the app role", async () => {
  // insert one daily_closes row as app_user under a tenant (via raw insert)
  await expect(asAppUser(tx).then(() => tx.update(dailyCloses).set({ closedBy: other }).where(eq(dailyCloses.id, id))))
    .rejects.toThrow(/WT001|permission denied/);
  await expect(/* delete */).rejects.toThrow(/WT001|permission denied/);
});
it("daily_close_chain IS updatable (it is the counter/head)", async () => { /* update sequence_no succeeds */ });
it("a second tenant cannot see another tenant's daily_closes", async () => { /* RLS isolation */ });
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @waitron/db test daily-closes` → FAIL (tables missing).

- [ ] **Step 3: Write `daily-closes.ts`** — both tables with Drizzle, `.enableRLS()` on each. The immutable table:

```ts
export const dailyCloses = pgTable("daily_closes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  nodeId: uuid("node_id").notNull(),
  businessDay: date("business_day").notNull(),
  sequenceNo: integer("sequence_no").notNull(),
  prevEntryHash: text("prev_entry_hash").notNull(),
  entryHash: text("entry_hash").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  closedBy: uuid("closed_by").notNull(),
  snapshot: jsonb("snapshot").$type<DailyCloseSnapshot>().notNull(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.nodeId], foreignColumns: [nodes.tenantId, nodes.id] }),
  unique("daily_closes_business_day_key").on(t.tenantId, t.nodeId, t.businessDay),
  unique("daily_closes_sequence_key").on(t.tenantId, t.nodeId, t.sequenceNo),
]).enableRLS();

export const dailyCloseChain = pgTable("daily_close_chain", {
  tenantId: uuid("tenant_id").notNull(),
  nodeId: uuid("node_id").notNull(),
  sequenceNo: integer("sequence_no").notNull().default(0),
  lastEntryHash: text("last_entry_hash").notNull().default(""),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.nodeId] }),
  foreignKey({ columns: [t.tenantId, t.nodeId], foreignColumns: [nodes.tenantId, nodes.id] }),
]).enableRLS();
```

(`DailyCloseSnapshot` is defined in `@waitron/reporting`; `packages/db` cannot import it — reporting depends on db. Type the `$type` structurally here with an inline `{ close: unknown; cashReconciliation: {...} }` or a local shape, and let reporting own the precise type. Prefer a minimal inline structural type.)

- [ ] **Step 4: Generate + hand-edit the migration** — `pnpm --filter @waitron/db db:generate` emits `0033_*.sql` with the two `CREATE TABLE`s + `ENABLE ROW LEVEL SECURITY`. **Append by hand** (Drizzle does not emit these), mirroring `packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql` verbatim for the idioms:
  - For `daily_closes`: `ALTER TABLE daily_closes FORCE ROW LEVEL SECURITY;` + `CREATE POLICY daily_closes_tenant_isolation ON daily_closes FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());` + `REVOKE ALL ON daily_closes FROM app_user; GRANT SELECT, INSERT ON daily_closes TO app_user;` + the append-only trigger (`BEFORE UPDATE OR DELETE … EXECUTE FUNCTION reject_mutation()`) + the TRUNCATE block (`BEFORE TRUNCATE … FOR EACH STATEMENT`).
  - For `daily_close_chain`: Part-4 only — `FORCE ROW LEVEL SECURITY` + `daily_close_chain_tenant_isolation` policy + `REVOKE ALL … ; GRANT SELECT, INSERT, UPDATE ON daily_close_chain TO app_user;` (NO append-only trigger).
  - Add a header comment explaining the recipe (as `0017_nodes_rls.sql` does), and that `reject_mutation()`/`current_tenant_id()` pre-exist.

- [ ] **Step 5: Run** — `pnpm --filter @waitron/db test:coverage` (real-PG immutability + RLS pass) and `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` → green (the new tenant-scoped table is FORCE-RLS + policy).

- [ ] **Step 6: Prove the recipe by deletion** — remove the append-only trigger line from the migration, re-run; confirm the "rejects UPDATE/DELETE" test FAILS; restore.

- [ ] **Step 7: Commit** — `git add -A && git commit -s -m "feat(db): daily_closes + daily_close_chain, immutable + chained (0033)"`

---

### Task 2: Close hashing + snapshot types + error codes (`@waitron/reporting`, pure)

**Files:**
- Create: `packages/reporting/src/daily-close-hash.ts` (+ `.test.ts`)
- Create: `packages/reporting/src/close-types.ts` (`DailyCloseSnapshot`, `RecordDailyCloseInput`, `DailyCloseRecord`)
- Create: `packages/reporting/src/errors.ts`
- Modify: `packages/reporting/src/index.ts` (exports)

**Interfaces:**
- Produces:
  - `interface DailyCloseSnapshot { close: DailyClose; cashReconciliation: { byTill: TillReconciliation[]; nodeVariance: string } }`; `TillReconciliation = { tillId; openingFloat; payouts; countedCash; cashTakings; cashVariance }` (all `Decimal` strings).
  - `computeCloseEntryHash(content: CloseHashContent, prevEntryHash: string): string` — canonical `name=value&…` over the ordered identity + a stable serialization of the snapshot, SHA-256, uppercase hex; whole-second timestamps.
  - error codes `close.already_closed` `{ businessDay: string }`, `close.invalid_cash_input` `{ tillId?: string; reason: string }`.

- [ ] **Step 1: Write the failing hash tests** (mirror `packages/workforce/src/chain-hash.test.ts`):

```ts
it("is deterministic and order-independent of object key order", () => { /* same content → same hash */ });
it("changes when any snapshot figure changes", () => { /* flip a cashVariance digit → different hash */ });
it("chains: hash depends on prevEntryHash", () => { /* same content, different prev → different hash */ });
it("genesis uses an empty predecessor", () => { /* prev = "" is valid */ });
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Write `close-types.ts`, `errors.ts`, `daily-close-hash.ts`** — mirror `packages/workforce/src/chain-hash.ts` for the canonicalisation (the ordered `name=value&…` join, `sha256(...).toUpperCase()`, whole-second timestamp truncation). `errors.ts` mirrors `packages/identity/src/errors.ts` (`import "@waitron/shared"; declare module … interface ErrorParams { "close.already_closed": {...}; "close.invalid_cash_input": {...} }`). Flatten the snapshot into the canonical string deterministically (sort by a fixed field order; serialize the `byTill` array in `tillId` order).

- [ ] **Step 4: Run** — `pnpm --filter @waitron/reporting test daily-close-hash` → PASS.

- [ ] **Step 5: Prove tamper-detection by mutation** — in a test, take a valid content+hash, change one `base` digit, recompute, assert the hash differs (already covered by Step 1's test — confirm it fails if you make `computeCloseEntryHash` ignore the snapshot).

- [ ] **Step 6: Commit** — `git add -A && git commit -s -m "feat(reporting): daily-close snapshot types, hashing, error codes"`

---

### Task 3: `recordDailyClose` — the close operation (`@waitron/reporting`)

**Files:**
- Create: `packages/reporting/src/record-daily-close.ts` (+ `.rls.test.ts` real PG)
- Modify: `packages/reporting/src/index.ts`

**Interfaces:**
- Consumes: `dailyCloses`/`dailyCloseChain` (Task 1), the hash + types + errors (Task 2), `computeDailyClose` (existing).
- Produces: `recordDailyClose(tx, input: RecordDailyCloseInput): Promise<DailyCloseRecord>`.

- [ ] **Step 1: Write the failing real-PG tests** (mirror the chain-append tests in `packages/workforce`/`packages/fiscal-verifactu` for the single-writer + concurrency shape):

```ts
it("snapshots the exact computeDailyClose figures + per-till variance", async () => {
  // ring cash + card sales across two tills, then:
  const rec = await recordDailyClose(tx, { ...input, cashCounts: [
    { tillId: A, openingFloat: "50.00", payouts: "0.00", countedCash: "173.45" }, // over/short crafted
    { tillId: B, openingFloat: "50.00", payouts: "10.00", countedCash: "88.00" },
  ]});
  expect(rec.snapshot.close.vat).toEqual(await computeVatSummary(tx, closeInput)); // exact (8a)
  const tillA = rec.snapshot.cashReconciliation.byTill.find(t => t.tillId === A)!;
  expect(tillA.cashVariance).toBe(/* counted − (float + takings − payouts) */);
});
it("assigns sequence 1 then 2 and chains prev_entry_hash", async () => { /* two different business days */ });
it("rejects a second close of the same day with close.already_closed", async () => { /* 23505 → code */ });
it("rejects negative cash input with close.invalid_cash_input", async () => {});
it("serialises two concurrent closes of the same day: one wins, one errors, exactly one row", async () => {
  // real PG, two connections
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `recordDailyClose`** — one `tx`:
  1. Validate `cashCounts` (non-negative; every cash-taking till in the close is counted; no count for an unknown till) → `throw new AppError("close.invalid_cash_input", {...})`.
  2. `lockChainHead(tx, tenantId, nodeId)` — `insert dailyCloseChain … on conflict do nothing`, then `select … for update`; read `sequenceNo` + `lastEntryHash`.
  3. `const close = await computeDailyClose(tx, { tenantId, nodeId, businessDay, timeZone, dayCutover });`
  4. Reconcile per till against `close.cash.byTill[].cashTakings`; compute `cashVariance = countedCash − (openingFloat + cashTakings − payouts)` (via `@waitron/shared` Decimal ops); `nodeVariance = Σ`. Build `snapshot`.
  5. `const entryHash = computeCloseEntryHash({ tenantId, nodeId, businessDay, sequenceNo: seq+1, closedAt, closedBy, snapshot }, lastEntryHash);`
  6. `insert dailyCloses (… sequenceNo: seq+1, prevEntryHash: lastEntryHash, entryHash, snapshot)` — wrap in a savepoint; on `23505` from `daily_closes_business_day_key`, `throw new AppError("close.already_closed", { businessDay })`.
  7. `update dailyCloseChain set sequenceNo = seq+1, lastEntryHash = entryHash where (tenant,node)`.
  8. Return the `DailyCloseRecord`.

- [ ] **Step 4: Run** — `pnpm --filter @waitron/reporting test:coverage` (real PG) → PASS, incl. concurrency.

- [ ] **Step 5: Prove single-writer by deletion** — remove the `for update` from `lockChainHead`; confirm the concurrency test FAILS (double sequence / duplicate) on real PG; restore.

- [ ] **Step 6: Commit** — `git add -A && git commit -s -m "feat(reporting): recordDailyClose — snapshot + cash reconciliation + chain append"`

---

### Task 4: `verifyDailyCloseChain` (`@waitron/reporting`)

**Files:**
- Create: `packages/reporting/src/verify-daily-close-chain.ts` (+ `.test.ts`)
- Modify: `packages/reporting/src/index.ts`

**Interfaces:**
- Produces: `verifyDailyCloseChain(tx, tenantId, nodeId): Promise<{ ok: true } | { ok: false; brokenAt: number; reason: string }>`.

- [ ] **Step 1: Write the failing tests:**

```ts
it("passes a well-formed chain", async () => { /* two closes → ok:true */ });
it("fails when a snapshot was tampered", async () => { /* rewrite a row's snapshot (raw superuser) → entry_hash no longer recomputes → ok:false */ });
it("fails when a middle close was deleted", async () => { /* delete seq 2 of 3 (raw superuser) → contiguity/link break → ok:false, brokenAt */ });
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement** — select the closes for `(tenant,node)` ordered by `sequence_no`; walk: assert 1-based contiguity, genesis `prev_entry_hash === ""`, each row's `prev_entry_hash === previous.entry_hash`, and `computeCloseEntryHash(rowContent, prev) === row.entry_hash`. Return the first break.

- [ ] **Step 4: Run** — `pnpm --filter @waitron/reporting test:coverage` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -s -m "feat(reporting): verifyDailyCloseChain"`

---

### Task 5: End-to-end demo (`apps/server`)

**Files:**
- Create: `apps/server/scripts/daily-close-z-demo.ts` (mirror `apps/server/scripts/daily-close-demo.ts`)
- Modify: `apps/server/package.json` (`"demo:daily-close-z": "tsx scripts/daily-close-z-demo.ts"`)

- [ ] **Step 1: Write the demo** — provision a venue, ring cash + card sales across two tills, `recordDailyClose` with per-till counts, print the record (sequence, entry_hash, per-till variance, node variance), `verifyDailyCloseChain` → ok, then attempt a second close of the same day → `close.already_closed`. Real/PGlite DB, exit 0.

- [ ] **Step 2: Run** — `pnpm --filter @waitron/server demo:daily-close-z` → prints the close + variances + verify ok + the rejected re-close, exit 0.

- [ ] **Step 3: Commit** — `git add -A && git commit -s -m "feat(server): frozen daily close (cierre Z) end-to-end demo"`

---

## Self-review

- **Spec coverage:** D1 jsonb snapshot→Task 1 (`snapshot` col) + Task 2 (`DailyCloseSnapshot`); D2 chain→Task 1 (columns) + Task 2 (hash) + Task 3 (append) + Task 4 (verify); D3 one-per-day/final→Task 1 (`UNIQUE`) + Task 3 (`close.already_closed`); D4 cash_variance→Task 3 Step 3.4; D5 inputs-at-close→Task 3 input; D6 guarded write→Task 3; D7 own entry_hash / English→Global Constraints + Task 2. Immutability recipe→Task 1 Step 4.
- **Placeholder scan:** the migration recipe and the hash canonicalisation say "mirror `<exact sibling file>` verbatim" — a named file to copy, not an invented snippet. The reconciliation arithmetic and validation rules are spelled out. No `TODO`/vague-error placeholders.
- **Type consistency:** `DailyCloseSnapshot` defined in Task 2, consumed in Task 3, structurally typed on the column in Task 1 (reporting owns the precise type; db uses an inline structural shape — reporting depends on db, not the reverse). `computeCloseEntryHash` signature identical in Tasks 2/3/4. `sequence_no`/`entry_hash`/`prev_entry_hash` spelled identically everywhere.

## Execution handoff

Implement via **superpowers:subagent-driven-development**. Linear (1→5). **Depends on 8a landing first** (`sales.vat_breakdown` + exact `computeVatSummary`); rebase onto the updated `main` after 8a merges. Task 1's migration number rebases against allergens + 8a.
