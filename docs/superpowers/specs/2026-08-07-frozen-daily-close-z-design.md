# Frozen daily close (cierre Z) — design (sub-project 8, slice 8b)

**Date:** 2026-08-07 · **Status:** approved in brainstorm, spec under review · **Branch:** `feat/daily-close-z`

## Naming (read first)

The domain concept is the Spanish **_cierre Z_** (the signed end-of-day close) and its **_descuadre_**
(cash over/short). Those Spanish words are the operator's vocabulary and appear **only** as UI display
labels (in `apps/till` i18n, guard-exempt, when the close screen lands) and in code **comments**. All
**schema, type and function tokens are English** — `@waitron/reporting` and `packages/db`'s generic
schema are under the `english-only` guard, and the fiscal Spanish vocabulary (`huella`, `secuencia`,
`cuota`) is reserved for `packages/fiscal-verifactu`. This record is an internal control document, not
an AEAT filing, so it follows the English convention the daily close (#56, `tax` not `cuota`) and the
non-fiscal hash chains (workforce `time_entries`, the 7c `order_amendments` log — `entry_hash`,
`prev_entry_hash`, `sequence_no`) already established.

| Concept | English token |
| --- | --- |
| the cierre Z record | `daily_closes` |
| its per-node chain head | `daily_close_chain` |
| descuadre (cash over/short) | `cash_variance` |
| the chained fingerprint | `entry_hash` / `prev_entry_hash` |
| write / verify | `recordDailyClose()` / `verifyDailyCloseChain()` |

## Purpose

Turn the *derived* daily close (#56, made VAT-exact by 8a) into a **frozen, numbered, immutable,
tamper-evident** record: a supervisor closes a `(tenant, node, business-day)`, supplying the physical
cash count per till; the system snapshots the exact figures, computes the cash variance, assigns a
per-node sequence number and a chained `entry_hash`, and writes one append-only row. This is the
deli's signed end-of-day close and an audit trail of the cash reconciliation.

**Headless** — the close operation, chain verification, and a demo. A "close day" till screen is a
later slice (as every sub-project's first slice is headless).

## Context — what this builds on

- **8a** makes `computeDailyClose`'s VAT summary exact (reads `sales.vat_breakdown`), so a frozen
  snapshot carries correct figures. **8b depends on 8a.**
- **`computeDailyClose`** (`packages/reporting`) returns a serializable `DailyClose` (VAT summary +
  cash-up by till + counts) — the snapshot payload. Its cash-up already breaks down **by till** with a
  `cashTakings` per till, which is the input the variance is computed against.
- **The immutability recipe** (`packages/db/src/immutability.sql.md`, applied by
  `registros_facturacion`'s migration): `REVOKE ALL` → `GRANT SELECT, INSERT` (no UPDATE/DELETE), a
  `BEFORE UPDATE OR DELETE` append-only trigger, a `BEFORE TRUNCATE` block, `FORCE ROW LEVEL SECURITY`
  + a tenant-isolation policy. Applied in the **same migration that creates the table**.
- **The non-fiscal hash-chain kit** (`packages/workforce/src/chain-hash.ts`,
  `packages/db/src/order-amendment-hash.ts`): a canonical `name=value&…` string → SHA-256 → uppercase
  hex; `entry_hash = H(content ‖ prev_entry_hash)`; genesis hashes an empty predecessor;
  single-active-writer under a `FOR UPDATE` lock; `sequence_no` 1-based contiguous; a
  `UNIQUE(scope…, sequence_no)` backstop; whole-second truncation of hashed timestamps.
- **The per-`(tenant, node)` counter pattern** (`working_order_counters` + `allocateOrderNumber`): a
  PK-`(tenant_id, node_id)` row with a monotonic number, FORCE RLS + policy + grants, **no** append-only
  trigger (it updates). The `daily_close_chain` head is this shape, extended with `last_entry_hash`.

## Decisions

- **D1 — The record is a frozen document: one immutable `daily_closes` row carrying a `snapshot jsonb`.**
  Per-till cash lives inside the snapshot, not a child table — the whole close is one frozen document,
  so one immutable row + jsonb beats a second immutable table (and its own RLS/immutability recipe).
- **D2 — Hash chain per `(tenant, node)`.** Each close links the prior (`sequence_no`, `prev_entry_hash`,
  `entry_hash = H(content ‖ prev)`), so a deleted, reordered, or altered close is detectable — not just
  an altered one. The per-node **number and chain head are one row** (`daily_close_chain`).
- **D3 — One close per `(tenant, node, business-day)`, final.** `UNIQUE(tenant_id, node_id, business_day)`.
  A wrong close is **not** editable in this slice (correction — a superseding Z, the rectificativa
  analog — is deferred). Re-closing a day throws `close.already_closed`.
- **D4 — `cash_variance` never blocks and never touches the fiscal huella or VAT.** It is operational:
  `counted_cash − (opening_float + cash_takings − payouts)`, per till + a node total, recorded as-is
  (positive = over, negative = short).
- **D5 — Cash inputs are entered at close, per till.** No separate "open day / set float" action; the
  supervisor supplies `opening_float`, `payouts`, `counted_cash` per till when closing.
- **D6 — `@waitron/reporting` gains a guarded write.** It was read-only (#56); the close is a write
  (an immutable insert under the app role). The table schema lives in `packages/db`; the operation and
  hashing live in `@waitron/reporting` (a local `daily-close-hash.ts`, as each chain package carries
  its own). No new DB privilege.
- **D7 — Not an AEAT filing.** No Veri\*Factu submission, no `computeHuella` (the fiscal hash); the
  close carries its **own** internal `entry_hash`. English tokens throughout (see Naming).

## Schema (`packages/db`)

**`daily_closes`** — immutable, append-only (full recipe, hand-written migration):

```
id            uuid pk
tenant_id     uuid   → tenants(id)
node_id       uuid   (composite FK (tenant_id, node_id) → nodes(tenant_id, id))
business_day  date
sequence_no   integer            -- 1-based per (tenant, node), monotonic
prev_entry_hash text             -- the predecessor's entry_hash ("" for the genesis close)
entry_hash    text               -- SHA-256(canonical(identity + snapshot) ‖ prev_entry_hash), UPPER hex
closed_at     timestamptz
closed_by     uuid               -- the counting actor (identity person id)
snapshot      jsonb  NOT NULL    -- the frozen document (below)
UNIQUE(tenant_id, node_id, business_day)
UNIQUE(tenant_id, node_id, sequence_no)     -- chain-position backstop
```

Immutability recipe in the creating migration: `REVOKE ALL … FROM app_user; GRANT SELECT, INSERT`
(no UPDATE/DELETE), `daily_closes_immutable BEFORE UPDATE OR DELETE`, `daily_closes_no_truncate BEFORE
TRUNCATE`, `FORCE ROW LEVEL SECURITY` + `daily_closes_tenant_isolation` policy. (This makes it a
`tenant_id`-bearing FORCE-RLS table the `inmutabilidad` guard will scan — the recipe must be complete
or that guard goes red.)

**`daily_close_chain`** — the mutable per-`(tenant, node)` head (Part-4-only: FORCE RLS + policy +
grants **including UPDATE**, no append-only trigger):

```
tenant_id       uuid
node_id         uuid   (composite FK → nodes)
sequence_no     integer NOT NULL default 0   -- last assigned; next close is +1
last_entry_hash text    NOT NULL default ''   -- last close's entry_hash ("" before the first)
PK(tenant_id, node_id)
```

**The `snapshot` document** (stored verbatim, and the thing the `entry_hash` covers):

```ts
interface DailyCloseSnapshot {
  close: DailyClose;                    // the VAT-exact computeDailyClose output (vat, cash, counts)
  cashReconciliation: {
    byTill: {
      tillId: string;
      openingFloat: string;             // supplied
      payouts: string;                  // supplied (cash removed during the day)
      countedCash: string;              // supplied (physical drawer count)
      cashTakings: string;              // from close.cash.byTill[].cashTakings (cash added to the drawer)
      cashVariance: string;             // countedCash − (openingFloat + cashTakings − payouts)
    }[];
    nodeVariance: string;               // Σ per-till cashVariance
  };
}
```

All money is `Decimal` strings.

## The close operation (`@waitron/reporting`)

`recordDailyClose(tx, input): Promise<DailyCloseRecord>` — one transaction, single-active-writer:

```
input: { tenantId, nodeId, businessDay, timeZone, dayCutover, closedBy,
         cashCounts: { tillId, openingFloat, payouts, countedCash }[] }
```

1. **Validate** the cash inputs (non-negative floats/payouts/counted; every till with cash takings is
   counted; no count for an unknown till) → `close.invalid_cash_input` on violation.
2. **Lock** the `daily_close_chain` head `FOR UPDATE` (create it `on conflict do nothing` then re-select
   if fresh), read `sequence_no` + `last_entry_hash`.
3. **Compute** `computeDailyClose(tx, {tenant, node, businessDay, timeZone, dayCutover})` (VAT-exact).
4. **Reconcile** per till: match each `cashCounts` entry to the close's `cash.byTill` `cashTakings`,
   compute `cashVariance`; sum `nodeVariance`. Build the `snapshot`.
5. **Hash**: `entry_hash = SHA-256(canonical(identity ‖ snapshot) ‖ last_entry_hash)` (uppercase hex),
   using a local `daily-close-hash.ts` that mirrors the workforce/amendment canonicalisation; hashed
   timestamps truncated to whole seconds.
6. **Insert** the immutable `daily_closes` row (`sequence_no+1`, `prev_entry_hash = last_entry_hash`).
7. **Update** the head (`sequence_no+1`, `last_entry_hash = entry_hash`).
8. Catch `UNIQUE(tenant, node, business_day)` `23505` → `close.already_closed` (the day is already
   closed; nothing is written twice).

`verifyDailyCloseChain(tx, tenantId, nodeId): Promise<VerifyResult>` — re-walk the closes in
`sequence_no` order: contiguity, genesis carries no predecessor, each `prev_entry_hash` links, and each
`entry_hash` recomputes from `canonical(row) ‖ prev`. Mirrors the kit's `verify*Chain`.

## Determinism

The close snapshots at cut time. Closing the *current* business day before its cutover risks a later
sale being excluded from the snapshot — an operational responsibility (a deli cuts after trading, with
the cutover in dead hours), not enforced by a guard. `UNIQUE` guarantees one close per day; the derived
close over a fully-elapsed day recomputes byte-identically (the property #56 preserved), so re-deriving
a closed day and comparing to its snapshot is a valid audit.

## Errors, migration, testing

- **Error codes** (English, domain-concept, declared in `@waitron/reporting`'s errors registry by
  declaration-merging into `@waitron/shared`): `close.already_closed` `{ businessDay }`,
  `close.invalid_cash_input` `{ tillId?; reason }`. Never renamed once shipped; grep siblings before
  finalising the params.
- **Migration:** `packages/db`, **after allergens `0031` + 8a `0032` → `0033`**. Two tables in it:
  `daily_closes` (immutable, full recipe — hand-written, `drizzle-kit generate --custom` or a
  hand-edited custom migration, since Drizzle won't emit the REVOKE/triggers/policy) and
  `daily_close_chain` (Part-4-only). Rebase the number if the three land out of order.
- **Testing (TDD):**
  - the close snapshots the **exact** derived figures (VAT from 8a, cash-up, counts);
  - `cash_variance` per till: **over**, **short**, and **exact** cases; `nodeVariance` sums;
  - the **hash chain** links across two closes; `verifyDailyCloseChain` **passes** a good chain and
    **fails** a tampered snapshot and a deleted middle close (prove each by mutation/deletion);
  - `UNIQUE` / `close.already_closed` on a second close of the same day;
  - **concurrency** (two closes racing the head, or two of the same day) on **real Postgres** — one
    wins, the other errors cleanly, exactly one row, chain intact;
  - the immutability triggers **reject** UPDATE/DELETE on `daily_closes` under the app role (real PG);
  - **RLS isolation** (a second tenant cannot see or write another's closes);
  - `close.invalid_cash_input` on negative inputs / an uncounted cash-active till;
  - `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` stays green (the new FORCE-RLS table
    is fully protected).
  - A `demo:daily-close-z` script: ring sales across two tills → close the day (with counts) → print
    the record + variances → verify the chain → attempt a second close (rejected).

## Scope out / deferred

- **Correction / superseding Z** (the rectificativa analog) — a later slice.
- **The "close day" till UI** — headless first; the operator screen (per-till count entry, the printed
  Z) lands with a till slice; the Spanish display labels live there.
- **`modelo 303` / date ranges / monthly aggregation** — a separate reporting slice.
- **Multi-node roll-up**, a **separate "open day / set float"** action, and **absolute drawer
  reconciliation** beyond the per-till variance — out.

## Provenance (tree receipts)

| Claim | Receipt |
| --- | --- |
| `computeDailyClose` returns a serializable close with a by-till `cashTakings` | `packages/reporting/src/daily-close.ts`, `types.ts` (`DailyClose`, `TillCashUp.cashTakings`) |
| The immutability recipe (REVOKE → SELECT/INSERT, triggers, FORCE RLS) | `packages/db/src/immutability.sql.md`; `packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql` |
| The non-fiscal chain kit (canonical `name=value`, SHA-256 hex, `entry_hash`/`prev_entry_hash`, `verify*Chain`, single-writer `FOR UPDATE`) | `packages/workforce/src/chain-hash.ts` + `src/chain.ts`; `packages/db/src/order-amendment-hash.ts` + `src/append-order-amendment.ts` |
| The per-`(tenant,node)` counter shape (FORCE RLS, no append-only trigger, `allocate…`) | `packages/db/src/schema/working-order-counters.ts`; `packages/db/src/allocate-order-number.ts` |
| The `inmutabilidad` guard scans every `tenant_id`-bearing table for FORCE + policy | `packages/fiscal-verifactu` inmutabilidad suite (`CLAUDE.md` §3) |

Re-confirm each receipt while implementing rather than trusting this table.
