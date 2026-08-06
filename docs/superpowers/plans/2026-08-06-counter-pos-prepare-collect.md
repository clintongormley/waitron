# Counter POS — prepare & collect (7c) + line-add price-snapshot / placing / pay-timing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this
> plan. Each task is an independent, TDD-shaped unit: write the failing test, watch it fail, write the
> minimal implementation, watch it pass, commit. Delegate each task to an implementation subagent
> (Opus 5 for code-writing), one at a time, in the order below. Do NOT batch tasks — each ends with an
> independently testable deliverable, and later tasks consume earlier ones.

**Spec of record:** `docs/superpowers/specs/2026-08-06-counter-pos-prepare-collect-design.md`. Read it
before starting. Every design decision is made there; this plan turns it into executable tasks and
does not re-design.

---

## Goal

Ship sub-project 7's third slice on the persisted-working-order foundation 7b landed:

1. **Line-add price snapshot** — each `working_order_line` locks its price at *add* time and the sale
   files from that lock, replacing 7b's "re-price at pay". (§2)
2. **Placing** — an `open → placed` transition that freezes composition and anchors fiscal issuance,
   plus the **per-location pay-timing config** selecting one of three service modes. (§3)
3. **The amendment log** — a new append-only, tamper-evident, tenant-scoped table opened at placing.
   (§4)
4. **The prep surface** — a node-scoped send-to-prep → preparing → ready → collected queue view,
   reusing 7b's held-list mechanism, in a new mutable `order_prep` table. (§5)

This is the **foundation branch** the parallel integrated-card slice rebases onto (§8); it lands first.

## Architecture

- **`packages/db`** owns the one additive migration (`0030`), the Drizzle schema (the new
  `working_order_status` value, `working_order_lines.unit_price_gross`, `locations.order_flow`,
  `order_amendments`, `order_prep`), and two new helpers beside `allocateOrderNumber`: the pure
  `computeAmendmentHash` and the `appendOrderAmendment` append helper.
- **`packages/catalogue`** gains `priceLockedLines` — the difference-method arithmetic run over a
  stored locked line instead of a live catalogue product, producing a `priceBasket`-identical result.
- **`@waitron/core`** is untouched: both issuance orderings are built from the extant
  `recordSale` (immediate/deferred) + `settleSale` + `listOutstandingSales` primitives.
- **`apps/server`** owns the shared till seam: `working-order.ts` (the authoritative line lock, the
  place/collect/prep/amend operations), `till-sale.ts` (`payWorkingOrder` files from locked lines +
  the three-mode dispatch), `till-config.ts` (reads the location's `order_flow`), `till-api.ts` (the
  place / collect / prep / amend routes).
- **`packages/reporting`** is code-unchanged; one test pins the Mode-I cutover split (§7).
- **`apps/till`** gains the place / send-to-prep control, the prep-queue widget, the per-mode pay
  control, and the `en`+`es` strings.

## Tech Stack

TypeScript (Node ESM), Drizzle ORM + PostgreSQL 18 (real, via Testcontainers) and PGlite (hermetic),
Vitest, Hono (till HTTP), Lit (till UI), pnpm workspace. Money is a branded `Decimal` string
throughout (never a float, never a formatted string).

---

## Global Constraints (project-wide rules — copied verbatim from the spec, apply to every task)

- **Coverage thresholds are `statements 98 / lines 98 / functions 98 / branches 95`** in every package
  except `packages/ui`. CI shards run `test:coverage`, not `test`. Before claiming a package green, run
  `pnpm --filter <pkg> test:coverage`.
- **`packages/db` runs `test:coverage` UNFILTERED** — this slice adds a migration, a rewritten trigger
  and schema, so the cross-cutting suites (`english-only`, the teardown guard) must load. `pnpm
  --filter @waitron/db test:coverage`.
- **A new `tenant_id`-bearing table needs FORCE RLS + a tenant-isolation policy + grants**, hand-written
  in the custom migration (Drizzle's `.enableRLS()` emits only `ENABLE`). `order_amendments` and
  `order_prep` are both new tenant-scoped tables. **Run `pnpm --filter @waitron/fiscal-verifactu test
  inmutabilidad` after the migration** — that guard scans every `tenant_id`-bearing table for a missing
  FORCE, and a package's own suite passes while the fiscal suite goes red (as it did for `nodes`).
- **English-only schema vocabulary.** `packages/db` is scanned by `english-only.ts`; every new table,
  column and enum value is English (`order_amendments`, `order_prep`, `order_flow`, `unit_price_gross`,
  `prep_state`, `sequence_no`, `event_at`). The *legal* term (art. 29.2.j LGT / precuenta) lives only
  in comments. `apps/*` is out of scope for the guard, so the till UI copy is unaffected. Add any new
  Spanish schema token to `SPANISH_WORDS` (none are introduced here).
- **Error codes name the DOMAIN CONCEPT, import their registry (`import "./errors.js"`), and are never
  renamed once shipped.** Grep siblings before minting one; reuse `working_order.*` / `sale.*` where one
  fits rather than a new prefix.
- **No backfill / data-migration code — pre-production.** The columns and tables are additive; schema
  drops and recreates, developer databases are recreated, CI builds fresh. Nothing is deployed, so
  there is no data to preserve.
- **Testing target discipline (§9).** Real Postgres (Testcontainers, `TESTCONTAINERS_RYUK_DISABLED=true`
  locally) for RLS-as-deployment-role, trigger, concurrency and immutability. PGlite only where the
  heavy justification does not apply — say why in a comment. Let `usePgliteDb`/`useRealPostgres` own the
  database; guarded teardowns (`if (db !== undefined) await db.close()`) only where a suite builds its
  own resource. Prove every guard by deletion where the spec calls for it.

---

## The three open plan-decisions (resolved here; justified; baked into the tasks)

### Decision 1 — the locked GROSS unit price lives in a NEW column `working_order_lines.unit_price_gross`

The stored draft keeps `unit_price` = the **net** unit (informational) and `line_total` = the **gross
line total** (`grossLineTotals[i]`). `priceBasket` derives the whole difference-method desglose from the
**gross unit price** (`base = gross ÷ (1+rate)`, `tax = gross − base`), so to file `sale_lines` from the
lock without a re-price and reproduce the cent-exact desglose the replay test pins (base 4.55 / tax
0.95, not 0.96), the filing must feed the same arithmetic the same **gross unit** it was priced from.

Recovering that unit as `line_total ÷ quantity` is **exact for `each` products** (a 2-dp unit times an
integer count is exact) but **drifts for weighed products**: `9.99/kg × 0.333kg = 3.32667 → 3.33`
stored, and `3.33 ÷ 0.333 = 10.00 ≠ 9.99`. The spec prices weighed items at weigh (= add) time (§2), so
weighed lines are exactly where division fails. **Add `unit_price_gross numeric(12,2)`** — the cleanest,
correct choice: the filing feeds `priceLockedLines` the stored gross unit and the real quantity and
reproduces a walk-up's filed record byte-for-byte, with no division drift. It keeps the gross/net
draft-vs-filed divergence intact (`unit_price` stays net-informational, `line_total` stays the gross
LINE total, the new column is the gross UNIT). Additive, pre-production, no backfill. (Task 1 adds the
column; Task 5 adds `priceLockedLines`; Task 6 persists and files from it.)

### Decision 2 — the amendment tamper-evidence is a per-order huella-style content-plus-prior hash (no chain-head subsystem)

A bare monotonic `seq` carries neither #52 lesson: a floor-bypasser could rewrite a reason/actor
undetected, and precedence could not tie-break on a hashed value. A full `appendToChain` cryptographic
chain (a `workforce_chains`-style head row + the 3-retry contention loop) is more than an *unconfirmed*
duty warrants (YAGNI, §4). The defensible minimum is the **middle**: each amendment stores a
`sequence_no`, an `entry_hash` = `SHA-256(content ‖ prev_entry_hash)` (uppercase hex), a
`prev_entry_hash` and an `is_first_entry` flag — the exact `packages/workforce/src/chain-hash.ts` shape
(ordered `Name=value` pairs, genesis hashes an empty predecessor), computed **inline** by an
`appendOrderAmendment` helper that serialises on the parent `working_orders` row (`FOR UPDATE`) rather
than a chain-head table. It carries all three #52 lessons:

- **Local wall-clock**, not UTC — `event_at` (timestamptz) + `event_offset_minutes` (the
  `sales.issued_at`/`issued_offset_minutes` pattern), truncated to whole seconds with a CHECK so the
  hashed instant and the read-back agree (the `time_entries_event_at_second_ck` precedent).
- **The reason, actor, and capturing till/node are inside the hash** — rewriting any of them past the
  immutability floor breaks `verifyAmendmentChain`.
- **Precedence tie-breaks on the hashed `sequence_no`**, never an unhashed ingest order — `sequence_no`
  is committed inside each entry's own hash, so reordering requires renumbering, which breaks the hash.

Placing writes the **genesis** entry (`order_placed`), and cancelling a placed order writes a second
(`order_cancelled`) — giving a genuine ≥2-entry chain that makes the prev-hash link testable. This is
minimal, not a second fiscal chain (no head table, no retry loop), and additive: a later correction
slice adds finer line-amendment kinds beside their producers. (Tasks 1, 3, 7.)

### Decision 3 — `locations.order_flow` is a pgEnum `order_flow` with values `prepay` / `invoice_first` / `ticket_then_pay`, default `prepay`

Sibling enums are snake_case type + snake_case values, English, one declaration for both the TS union
and the DB constraint: `working_order_status` (`open`/`settled`/`abandoned`), `fiscal_state`
(`recorded`/`not_applicable`), `tender_method`, `workforce_entry_kind` (`break_start`/`break_end`).
`order_flow` with the spec's own Mode P/I/T names (`prepay`, `invoice_first`, `ticket_then_pay`)
matches that convention and passes `english-only.ts` (no token is Spanish). A **single 3-value enum
column structurally forbids** the degenerate top-left cell (§3), where two orthogonal booleans would
admit it.

**Default `prepay`** is the only mode with no `placed` state and an immediate `open → settled` filing —
exactly what 7a/7b's `payWorkingOrder` does unconditionally today (Ordering 2, no gap). An existing
location row defaulted to `prepay` runs the unchanged walk-up / park-pay path, and every existing test
(which calls `payWorkingOrder` directly, never the new dispatch) stays green without reading the column
— the `#57` reshape pattern (a defaulted value on a fixture is inert). (Task 1 adds the column; Task 8
reads it.)

---

## File Structure (created/modified, one responsibility each)

**`packages/db`**
- **Create** `packages/db/drizzle/0030_prepare_collect.sql` — the one migration: `placed` enum value +
  rewritten `enforce_transition`; `working_order_lines.unit_price_gross`; `order_flow` enum +
  `locations.order_flow`; `order_amendments` (append-only + FORCE-RLS/policy/grants + reject_mutation +
  TRUNCATE-block); `order_prep` (mutable + FORCE-RLS/policy/grants).
- **Create** `packages/db/drizzle/meta/0030_snapshot.json` + updated `_journal.json` — emitted by
  `drizzle-kit generate`, not hand-written.
- **Modify** `packages/db/src/schema/orders.ts` — `placed` enum value; `unitPriceGross` column; the §2
  line-price comment rewrites; the `enforce_transition` note rewrite.
- **Modify** `packages/db/src/schema/tenants.ts` — `orderFlow` pgEnum + `locations.orderFlow` column.
- **Create** `packages/db/src/schema/order-amendments.ts` — the append-only amendment table + its enum.
- **Create** `packages/db/src/schema/order-prep.ts` — the mutable prep table + `prep_state` enum.
- **Create** `packages/db/src/order-amendment-hash.ts` — pure `computeAmendmentHash` /
  `verifyAmendmentChain` (mirrors `packages/workforce/src/chain-hash.ts`).
- **Create** `packages/db/src/append-order-amendment.ts` — `appendOrderAmendment` (locks parent, derives
  seq + hash, inserts).
- **Modify** `packages/db/src/index.ts` — export the two tables, three enums, and two helpers.
- **Create tests** `packages/db/src/schema/orders.transition.rls.test.ts` (Task 2),
  `packages/db/src/schema/order-amendments.rls.test.ts` (Task 3),
  `packages/db/src/order-amendment-hash.test.ts` (Task 3),
  `packages/db/src/append-order-amendment.rls.test.ts` (Task 3),
  `packages/db/src/schema/order-prep.rls.test.ts` (Task 4).

**`packages/catalogue`**
- **Modify** `packages/catalogue/src/pricing.ts` — extract the shared arithmetic; add `priceLockedLines`.
- **Modify** `packages/catalogue/src/pricing.test.ts` — the locked-line pricing case.

**`apps/server`**
- **Modify** `apps/server/src/working-order.ts` — persist `unit_price_gross`; `placeOrder`,
  `cancelPlacedOrder`, `sendToPrep`, `advancePrep`, `listPrepQueue`.
- **Modify** `apps/server/src/till-sale.ts` — `payWorkingOrder` files a retrieved order from the stored
  locked lines; `collectOrder` (Modes I/T pay-at-collect).
- **Modify** `apps/server/src/till-config.ts` — `TillConfig.orderFlow` + `readOrderFlow`.
- **Modify** `apps/server/src/till-api.ts` — `POST /:id/place`, `POST /:id/collect`, `POST /:id/prep`,
  `POST /:id/cancel`, `GET /api/prep-queue`; STATUS additions.
- **Modify** `apps/server/src/errors.ts` — `working_order.not_placed`, `order_prep.invalid_transition`.
- **Modify** `apps/server/src/working-order.rls.test.ts` — rewrite the semantically-broken case; add the
  catalogue-price-change case; place/collect/prep/mode cases.
- **Modify** `apps/server/src/till-sale.test.ts` — the mode-dispatch PGlite cases; comment rewrites.

**`packages/reporting`**
- **Modify** `packages/reporting/src/daily-close.test.ts` — the Mode-I cutover-straddle split case (no
  code change).

**`apps/till`**
- **Modify** `apps/till/src/layout.ts` — `WidgetType` gains `"prep-queue"`.
- **Create** `apps/till/src/widgets/prep-queue.ts` (+ `.test.ts`, `.a11y.test.ts`).
- **Modify** `apps/till/src/widgets/tender-pay.ts` — per-mode pay / place control (+ tests).
- **Modify** `apps/till/src/i18n/strings.ts` — new `en`+`es` keys.

---

## Task 1 — The `0030` migration + Drizzle schema (enum value, `unit_price_gross`, `locations.order_flow`, `order_amendments`, `order_prep`)

**Deliverable:** the migration applies clean on real Postgres, `drizzle-kit generate` reports "No schema
changes" (snapshot parity), and `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` is green
(both new tables FORCE-RLS + tenant-isolated).

### Files
- **Modify** `packages/db/src/schema/orders.ts:25` (enum), `:98-165` (line comments + new column), plus
  the `enforce_transition` note.
- **Modify** `packages/db/src/schema/tenants.ts` (add enum + column).
- **Create** `packages/db/src/schema/order-amendments.ts`.
- **Create** `packages/db/src/schema/order-prep.ts`.
- **Modify** `packages/db/src/index.ts`.
- **Create** `packages/db/drizzle/0030_prepare_collect.sql` (custom, hand-edited).
- **Test:** the `inmutabilidad` suite (existing, in `packages/fiscal-verifactu`) is the acceptance guard;
  Tasks 2-4 add the behavioural suites.

### Interfaces
Produces (in `@waitron/db`'s barrel):
```typescript
export const workingOrderStatus: pgEnum // now ["open", "placed", "settled", "abandoned"]
export const orderFlow: pgEnum          // ["prepay", "invoice_first", "ticket_then_pay"]
export const prepState: pgEnum          // ["queued", "preparing", "ready", "collected"]
export const orderAmendmentKind: pgEnum // ["order_placed", "order_cancelled"]
export const orderAmendments: PgTable
export const orderPrep: PgTable
// locations gains orderFlow; workingOrderLines gains unitPriceGross
```

### Steps

1. **Add the `placed` enum value + the `unit_price_gross` column + rewrite the comments in
   `orders.ts`.** Edit the enum and add the column (leave `enforce_transition` in SQL — the schema file
   has no trigger; only the comment on the table doc needs the note). Replace the enum declaration:
   ```typescript
   export const workingOrderStatus = pgEnum("working_order_status", [
     "open",
     // placed (7c): the order is finalized — composition FROZEN (require_open_parent already rejects
     // line writes on a non-open parent) and the fiscal issuance basis fixed. A NON-terminal state
     // between open and settled: open → placed → settled|abandoned. Only Modes I/T ever visit it;
     // a Mode-P walk-up goes open → settled in one instant and never enters placed (design §3, §5).
     "placed",
     "settled",
     "abandoned",
   ]);
   ```
   Add the column inside `workingOrderLines`, right after `unitPrice` (line 128):
   ```typescript
   unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
   // The GROSS (VAT-inclusive) unit price LOCKED at add time (line-add snapshot, 7c). `unit_price`
   // above is the NET unit (informational); this is the GROSS unit the line was priced from — the
   // authoritative input the FILED sale_lines are rebuilt from without a re-price (priceLockedLines,
   // @waitron/catalogue). Stored rather than recovered as `line_total ÷ quantity` because that
   // division is exact for `each` lines but DRIFTS for a weighed line (9.99/kg × 0.333 → 3.33 stored,
   // 3.33 ÷ 0.333 = 10.00 ≠ 9.99), and a weighed line is priced at weigh = add time (design §2,
   // Decision 1). Keeps the gross/net draft divergence intact: net unit here, gross line total in
   // `line_total`, gross UNIT here.
   unitPriceGross: numeric("unit_price_gross", { precision: 12, scale: 2 }).notNull(),
   ```
   Rewrite the now-false snapshot comments (§2 items 3-5): the `working_order_lines` doc block
   (`:98-113`) must say the snapshot **is** the filed price and `product_id` is a pricing input **only
   for new/weighed lines**, no longer implying a re-price of existing ones; the `line_total` comment
   (`:130-136`) must say the FILED line of a retrieved order now derives from these locked columns (the
   gross-vs-net divergence stays). (Keep them as rewrites, not deletions — `CLAUDE.md` §1.)

2. **Add the `order_flow` enum + column to `tenants.ts`.** After the imports, declare the enum; add the
   column to `locations`:
   ```typescript
   export const orderFlow = pgEnum("order_flow", ["prepay", "invoice_first", "ticket_then_pay"]);
   ```
   Inside `locations`, after `dayCutover` (line 78):
   ```typescript
   // The per-venue pay-timing / service mode (design §3): WHEN payment happens (order vs collect) ×
   // WHEN the invoice issues (placing vs pay), collapsed to three meaningful modes by a single enum
   // (the degenerate fourth cell is structurally unrepresentable). `prepay` = pay+issue at order,
   // open → settled, no placed state (today's walk-up/park-pay — Decision 3). `invoice_first` = issue
   // deferred at placing, settle at collect (open → placed → settled). `ticket_then_pay` = place with
   // no fiscal doc, pay+issue at collect. DEFAULT 'prepay' so existing location fixtures stay inert.
   // No config-authoring UI in this slice (set at provisioning, like the layout editor).
   orderFlow: orderFlow("order_flow").notNull().default("prepay"),
   ```

3. **Create `packages/db/src/schema/order-prep.ts`.** Mutable, the `working_order_counters` (0029)
   shape — FORCE RLS + tenant-isolation policy + `SELECT/INSERT/UPDATE` grants, NO immutability triggers:
   ```typescript
   import { sql } from "drizzle-orm";
   import { check, foreignKey, index, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
   import { nodes } from "./nodes.js";
   import { workingOrders } from "./orders.js";

   /**
    * The prep lifecycle (design §5). `send-to-prep` (= placing) enqueues at `queued`; the cook advances
    * queued → preparing → ready → collected. A faithful reading of the spec's "send-to-prep →
    * preparing → ready → collected": send-to-prep is the ENQUEUE (creating the row at `queued`), the
    * three named states are what follow (flagged interpretation, design §5).
    */
   export const prepState = pgEnum("prep_state", ["queued", "preparing", "ready", "collected"]);

   /**
    * Operational prep progress for a working order — MUTABLE, node-scoped, ephemeral. A SEPARATE table
    * (not a `working_orders.prep_state` column) because prep advances even after the order is fiscally
    * FROZEN: in Mode P (prepay) the order is already `settled` when prep runs, and the
    * `working_orders_enforce_transition` guard rightly rejects any update of a settled row. So prep
    * lives here and advances freely regardless of the order's fiscal status (design §5). One row per
    * working order (PK is the order), so a placed/settled order has exactly one prep record.
    */
   export const orderPrep = pgTable(
     "order_prep",
     {
       tenantId: uuid("tenant_id").notNull(),
       workingOrderId: uuid("working_order_id").notNull(),
       // The node the prep happens on — the queue is node-scoped, like the held list (design §5).
       nodeId: uuid("node_id").notNull(),
       state: prepState("state").notNull().default("queued"),
       queuedAt: timestamp("queued_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
       preparingAt: timestamp("preparing_at", { withTimezone: true, mode: "string" }),
       readyAt: timestamp("ready_at", { withTimezone: true, mode: "string" }),
       collectedAt: timestamp("collected_at", { withTimezone: true, mode: "string" }),
     },
     (t) => [
       // The order IS the key: one prep record per working order.
       foreignKey({
         columns: [t.tenantId, t.workingOrderId],
         foreignColumns: [workingOrders.tenantId, workingOrders.id],
         name: "order_prep_order_fk",
       }).onDelete("cascade"),
       // Tenant-consistent node FK (mirrors working_orders_node_fk): a prep row cannot point at
       // another tenant's node.
       foreignKey({
         columns: [t.tenantId, t.nodeId],
         foreignColumns: [nodes.tenantId, nodes.id],
         name: "order_prep_node_fk",
       }),
       index("order_prep_queue_idx").on(t.tenantId, t.nodeId, t.state),
       check("order_prep_pk", sql`true`), // PK declared in SQL (composite) — see the migration.
     ],
   ).enableRLS();
   ```
   (The composite PRIMARY KEY `(tenant_id, working_order_id)` is written in the migration SQL, matching
   `working_order_counters`; the `check` placeholder above is dropped — declare the PK via a
   `primaryKey({ columns: [t.tenantId, t.workingOrderId] })` from `drizzle-orm/pg-core` instead, so the
   generated SQL and snapshot agree. Use that import, not the `check` stub.)

4. **Create `packages/db/src/schema/order-amendments.ts`.** Append-only, the `sale_lines`/`time_entries`
   pattern — FORCE RLS + tenant-isolation policy + `SELECT/INSERT`-only grant + `reject_mutation` +
   TRUNCATE-block (migration SQL), plus the tamper-evidence columns:
   ```typescript
   import { sql } from "drizzle-orm";
   import {
     boolean, check, foreignKey, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid,
   } from "drizzle-orm/pg-core";
   import { nodes } from "./nodes.js";
   import { workingOrders } from "./orders.js";
   import { tills } from "./tenants.js";

   /**
    * What an amendment records. The legal duty (art. 29.2.j LGT / the restaurant precuenta) is
    * UNCONFIRMED (advisor Q14), so this is minimal (design §4): 7c produces exactly two kinds —
    * `order_placed` (the genesis entry written when the order is placed = the log opens) and
    * `order_cancelled` (a placed order cancelled, itself a logged amendment). Finer line-level kinds
    * (added/removed/quantity/price) are added additively by the future correction slice, beside a
    * producer — a frozen order's lines cannot be rewritten in 7c (require_open_parent), so there is no
    * 7c producer for them (flagged interpretation, design §4).
    */
   export const orderAmendmentKind = pgEnum("order_amendment_kind", ["order_placed", "order_cancelled"]);

   /**
    * The append-only, tamper-evident amendment log (art. 29.2.j LGT — the legal term lives only in
    * this comment; the table is English, design §4). IMMUTABLE like `sale_lines`/`time_entries`, NOT
    * the mutable `working_orders`: `REVOKE ALL` + `GRANT SELECT, INSERT` + reject_mutation + a
    * TRUNCATE-block (migration SQL). Tamper-evidence is a per-order huella-style hash of content plus
    * the predecessor's hash (Decision 2): `entry_hash = SHA-256(content ‖ prev_entry_hash)`, with the
    * reason, actor and capturing till/node all INSIDE the hash (#52), and precedence tie-breaking on
    * the hashed `sequence_no` (#52). Local wall-clock (`event_at` + `event_offset_minutes`,
    * whole-second-truncated) reprints in venue time (#52).
    */
   export const orderAmendments = pgTable(
     "order_amendments",
     {
       id: uuid("id").primaryKey().defaultRandom(),
       tenantId: uuid("tenant_id").notNull(),
       workingOrderId: uuid("working_order_id").notNull(),
       // 1-based position within THIS order's amendment chain; ours and contiguous, hashed.
       sequenceNo: integer("sequence_no").notNull(),
       kind: orderAmendmentKind("kind").notNull(),
       // The accountable actor (the operator uuid from the open session) — hashed (#52). Plain uuid,
       // no FK (the sale_voids.voided_by / sales.operator_id shape).
       actorId: uuid("actor_id").notNull(),
       // The contestable reason (art. 29.2.j). NULL on the genesis `order_placed` (a placement has no
       // contest reason); required by the app for `order_cancelled`. Hashed as empty when null,
       // exactly as chain-hash.ts hashes a null correctionReason.
       reason: text("reason"),
       // Capture provenance — the capturing till and node, both hashed so neither can be re-pointed
       // undetected (the chain-hash.ts capturedByTillId precedent).
       capturedByTillId: uuid("captured_by_till_id").notNull(),
       capturedByNodeId: uuid("captured_by_node_id").notNull(),
       // The event instant + its wall offset (the sales.issued_at/issued_offset_minutes pattern),
       // truncated to whole seconds so the hashed instant and the read-back agree (time_entries
       // precedent).
       eventAt: timestamp("event_at", { withTimezone: true, mode: "string" }).notNull(),
       eventOffsetMinutes: integer("event_offset_minutes").notNull(),
       // The chain fields (computeAmendmentHash): this entry's hash, the predecessor's, the genesis flag.
       entryHash: text("entry_hash").notNull(),
       prevEntryHash: text("prev_entry_hash"),
       isFirstEntry: boolean("is_first_entry").notNull(),
     },
     (t) => [
       foreignKey({
         columns: [t.tenantId, t.workingOrderId],
         foreignColumns: [workingOrders.tenantId, workingOrders.id],
         name: "order_amendments_order_fk",
       }).onDelete("restrict"),
       foreignKey({
         columns: [t.tenantId, t.capturedByTillId],
         foreignColumns: [tills.tenantId, tills.id],
         name: "order_amendments_till_fk",
       }).onDelete("restrict"),
       foreignKey({
         columns: [t.tenantId, t.capturedByNodeId],
         foreignColumns: [nodes.tenantId, nodes.id],
         name: "order_amendments_node_fk",
       }).onDelete("restrict"),
       // THE backstop against two writers claiming one chain position (mirrors
       // time_entries_chain_position_uq / registros_tenant_node_secuencia_uq).
       unique("order_amendments_chain_position_key").on(t.tenantId, t.workingOrderId, t.sequenceNo),
       index("order_amendments_order_idx").on(t.tenantId, t.workingOrderId),
       check("order_amendments_sequence_no_ck", sql`${t.sequenceNo} > 0`),
       check("order_amendments_entry_hash_ck", sql`${t.entryHash} ~ '^[0-9A-F]{64}$'`),
       check("order_amendments_event_offset_ck", sql`${t.eventOffsetMinutes} between -840 and 840`),
       check("order_amendments_event_at_second_ck", sql`date_trunc('second', ${t.eventAt}) = ${t.eventAt}`),
       // Exactly one chain shape (mirrors time_entries_chaining_ck): the genesis carries no
       // predecessor, every later entry carries one.
       check(
         "order_amendments_chaining_ck",
         sql`(${t.isFirstEntry} and ${t.prevEntryHash} is null)
             or (not ${t.isFirstEntry} and ${t.prevEntryHash} is not null)`,
       ),
     ],
   ).enableRLS();
   ```
   `tills` needs a composite `(tenant_id, id)` UNIQUE target for `order_amendments_till_fk`. Check
   `packages/db/src/schema/tenants.ts` — `tills` today declares only `index("tills_tenant_id_idx")`, no
   `unique(tenant_id, id)`. Add `unique("tills_tenant_id_key").on(t.tenantId, t.id)` to `tills`'s
   extraConfig (the migration emits it before the FK, the 0029 reorder idiom). `nodes` already carries
   its `(tenant_id, id)` target (used by `working_orders_node_fk`).

5. **Export from `packages/db/src/index.ts`.** After the existing `orders` export (line 9):
   ```typescript
   export { workingOrderLines, workingOrders, workingOrderStatus } from "./schema/orders.js";
   export { orderAmendments, orderAmendmentKind } from "./schema/order-amendments.js";
   export { orderPrep, prepState } from "./schema/order-prep.js";
   export { orderFlow } from "./schema/tenants.js"; // add beside `export * from "./schema/tenants.js"`
   ```
   (`orderFlow` is already re-exported by the wildcard `export * from "./schema/tenants.js"` at line 6
   — verify it appears in the barrel; add an explicit line only if the wildcard does not surface it.)

6. **Generate the base migration, then hand-edit it.** Run
   `pnpm --filter @waitron/db exec drizzle-kit generate --custom --name prepare_collect`. This creates
   `0030_prepare_collect.sql` (empty `--> statement-breakpoint` scaffold) and the snapshot. Hand-write
   the SQL in the 0027/0029 idiom (statements reordered so each FK follows the UNIQUE it targets; FORCE +
   policy + grants + triggers appended by hand). The full file:
   ```sql
   -- Counter POS prepare & collect (sub-project 7c): the placed state + rewritten enforce_transition,
   -- the locked gross unit price, the per-location order_flow, the append-only order_amendments log,
   -- and the mutable order_prep queue. Custom (drizzle-kit generate --custom), hand-edited in the
   -- 0027/0029 idiom: FK statements placed AFTER the UNIQUE they target; FORCE + CREATE POLICY + GRANT
   -- + the immutability/TRUNCATE triggers appended by hand (.enableRLS() emits only ENABLE). Re-running
   -- `drizzle-kit generate` after this edit must report "No schema changes" (snapshot parity, 0029 note).

   -- The new non-terminal state. `ADD VALUE` is late-bound: the enforce_transition body below compares
   -- against 'placed' as a string literal resolved at RUNTIME, never at CREATE FUNCTION, so this does
   -- not trip 55P04 in the same migration (the time_entries `'correction'` precedent, 0002_workforce).
   ALTER TYPE "public"."working_order_status" ADD VALUE 'placed';--> statement-breakpoint

   CREATE TYPE "public"."order_flow" AS ENUM('prepay', 'invoice_first', 'ticket_then_pay');--> statement-breakpoint
   CREATE TYPE "public"."order_amendment_kind" AS ENUM('order_placed', 'order_cancelled');--> statement-breakpoint
   CREATE TYPE "public"."prep_state" AS ENUM('queued', 'preparing', 'ready', 'collected');--> statement-breakpoint

   ALTER TABLE "working_order_lines" ADD COLUMN "unit_price_gross" numeric(12, 2) NOT NULL;--> statement-breakpoint
   ALTER TABLE "locations" ADD COLUMN "order_flow" "order_flow" DEFAULT 'prepay' NOT NULL;--> statement-breakpoint

   -- The composite UNIQUE order_amendments_till_fk targets. First, so the FK finds it (0029 reorder).
   ALTER TABLE "tills" ADD CONSTRAINT "tills_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint

   -- order_amendments (append-only, immutable).
   CREATE TABLE "order_amendments" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
     "tenant_id" uuid NOT NULL,
     "working_order_id" uuid NOT NULL,
     "sequence_no" integer NOT NULL,
     "kind" "order_amendment_kind" NOT NULL,
     "actor_id" uuid NOT NULL,
     "reason" text,
     "captured_by_till_id" uuid NOT NULL,
     "captured_by_node_id" uuid NOT NULL,
     "event_at" timestamp with time zone NOT NULL,
     "event_offset_minutes" integer NOT NULL,
     "entry_hash" text NOT NULL,
     "prev_entry_hash" text,
     "is_first_entry" boolean NOT NULL,
     CONSTRAINT "order_amendments_chain_position_key" UNIQUE("tenant_id","working_order_id","sequence_no"),
     CONSTRAINT "order_amendments_sequence_no_ck" CHECK ("order_amendments"."sequence_no" > 0),
     CONSTRAINT "order_amendments_entry_hash_ck" CHECK ("order_amendments"."entry_hash" ~ '^[0-9A-F]{64}$'),
     CONSTRAINT "order_amendments_event_offset_ck" CHECK ("order_amendments"."event_offset_minutes" between -840 and 840),
     CONSTRAINT "order_amendments_event_at_second_ck" CHECK (date_trunc('second', "order_amendments"."event_at") = "order_amendments"."event_at"),
     CONSTRAINT "order_amendments_chaining_ck" CHECK (
       ("order_amendments"."is_first_entry" and "order_amendments"."prev_entry_hash" is null)
       or (not "order_amendments"."is_first_entry" and "order_amendments"."prev_entry_hash" is not null))
   );
   --> statement-breakpoint
   ALTER TABLE "order_amendments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
   ALTER TABLE "order_amendments" ADD CONSTRAINT "order_amendments_order_fk" FOREIGN KEY ("tenant_id","working_order_id") REFERENCES "public"."working_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
   ALTER TABLE "order_amendments" ADD CONSTRAINT "order_amendments_till_fk" FOREIGN KEY ("tenant_id","captured_by_till_id") REFERENCES "public"."tills"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
   ALTER TABLE "order_amendments" ADD CONSTRAINT "order_amendments_node_fk" FOREIGN KEY ("tenant_id","captured_by_node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
   CREATE INDEX "order_amendments_order_idx" ON "order_amendments" USING btree ("tenant_id","working_order_id");--> statement-breakpoint

   -- order_prep (mutable — the 0029 working_order_counters shape).
   CREATE TABLE "order_prep" (
     "tenant_id" uuid NOT NULL,
     "working_order_id" uuid NOT NULL,
     "node_id" uuid NOT NULL,
     "state" "prep_state" DEFAULT 'queued' NOT NULL,
     "queued_at" timestamp with time zone DEFAULT now() NOT NULL,
     "preparing_at" timestamp with time zone,
     "ready_at" timestamp with time zone,
     "collected_at" timestamp with time zone,
     CONSTRAINT "order_prep_pk" PRIMARY KEY("tenant_id","working_order_id")
   );
   --> statement-breakpoint
   ALTER TABLE "order_prep" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
   ALTER TABLE "order_prep" ADD CONSTRAINT "order_prep_order_fk" FOREIGN KEY ("tenant_id","working_order_id") REFERENCES "public"."working_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
   ALTER TABLE "order_prep" ADD CONSTRAINT "order_prep_node_fk" FOREIGN KEY ("tenant_id","node_id") REFERENCES "public"."nodes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
   CREATE INDEX "order_prep_queue_idx" ON "order_prep" USING btree ("tenant_id","node_id","state");--> statement-breakpoint

   -- Replace the enforce_transition function body with the extended state machine (design §5). The
   -- OLD body rejected ANY update of a non-open row; the NEW body permits open → {open,placed,settled,
   -- abandoned} (open → open preserves label edits on an open order — updateHeldOrder; open → settled
   -- the walk-up; open → placed placing; open → abandoned discard) and placed → {settled,abandoned}
   -- (collect / cancel), and rejects everything else — every transition OUT of settled/abandoned
   -- (terminal, unchanged) and placed → {open,placed} (no un-place, and a non-status update of a
   -- placed row is rejected, which IS the composition freeze at the row level). CLAUDE.md §1: this is
   -- a rewrite, and the comment is rewritten with it.
   CREATE OR REPLACE FUNCTION working_orders_enforce_transition()
     RETURNS trigger
     LANGUAGE plpgsql
     SET search_path = pg_catalog, public
   AS $$
   BEGIN
     IF OLD.status = 'open' THEN
       -- An open order may change freely (a label edit keeps status open) or move to any next state.
       RETURN NEW;
     ELSIF OLD.status = 'placed' AND NEW.status IN ('settled', 'abandoned') THEN
       -- A placed order may only be settled (collect) or abandoned (cancel).
       RETURN NEW;
     END IF;
     RAISE EXCEPTION 'working order % cannot transition from % to %', OLD.id, OLD.status, NEW.status;
   END;
   $$;
   --> statement-breakpoint

   -- order_amendments tenant isolation + immutability (0002/0005 idiom): FORCE, FOR ALL policy on
   -- current_tenant_id(), REVOKE ALL then GRANT SELECT, INSERT (append-only — no UPDATE/DELETE), plus
   -- reject_mutation on UPDATE/DELETE and a BEFORE TRUNCATE statement trigger.
   ALTER TABLE "order_amendments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
   CREATE POLICY "order_amendments_tenant_isolation" ON "order_amendments"
     FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
   REVOKE ALL ON "order_amendments" FROM app_user;--> statement-breakpoint
   GRANT SELECT, INSERT ON "order_amendments" TO app_user;--> statement-breakpoint
   CREATE TRIGGER "order_amendments_enforce_immutability"
     BEFORE UPDATE OR DELETE ON "order_amendments"
     FOR EACH ROW EXECUTE FUNCTION reject_mutation();--> statement-breakpoint
   CREATE TRIGGER "order_amendments_block_truncate"
     BEFORE TRUNCATE ON "order_amendments"
     FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();--> statement-breakpoint

   -- order_prep tenant isolation (0029 idiom): FORCE + FOR ALL policy + GRANT SELECT, INSERT, UPDATE
   -- (mutable — prep advances) but NO DELETE (a prep record is never removed; a cancelled order's is
   -- cascaded by the order FK). MUTABLE, so no immutability triggers.
   ALTER TABLE "order_prep" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
   CREATE POLICY "order_prep_tenant_isolation" ON "order_prep"
     FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
   GRANT SELECT, INSERT, UPDATE ON "order_prep" TO app_user;
   ```

7. **Run it and watch it apply, then verify snapshot parity.** `pnpm --filter @waitron/db exec
   drizzle-kit generate` — must print **"No schema changes"** (the hand-edited SQL matches the TS
   schema's derived snapshot; if it emits a diff, the SQL and schema disagree — reconcile). Then run the
   package's migration suite: `pnpm --filter @waitron/db test:coverage` green (schema compiles, migrations
   run fresh).

8. **Run the inmutabilidad guard — the acceptance gate for this task.** `pnpm --filter
   @waitron/fiscal-verifactu test inmutabilidad`. That suite scans every `tenant_id`-bearing table for
   `relrowsecurity && relforcerowsecurity`; `order_amendments` and `order_prep` must both appear and be
   compliant. A missing FORCE leaves this suite red while `@waitron/db`'s own is green (the `nodes`
   lesson). Green here confirms both new tables carry ENABLE + FORCE + policy + grants.

9. **Commit** `feat(db): 0030 prepare-collect migration — placed state, locked gross unit, order_flow, order_amendments, order_prep`.

---

## Task 2 — The extended `working_orders` state machine (trigger rewrite), proven by deletion

**Deliverable:** a real-Postgres suite proving `open → placed → settled`, `open → placed → abandoned`,
`open → settled` (walk-up) and `open → open` (label edit) all pass; every transition **out of**
`settled`/`abandoned` and `placed → open`/`placed → placed` is rejected; a line write on a `placed`
order is rejected (composition freeze via `require_open_parent`). The rewrite is proven by deletion.

### Files
- **Create** `packages/db/src/schema/orders.transition.rls.test.ts`. Real PG (the trigger is behavioural
  DDL; PGlite would pass too, but this suite rides the container Task 4's RLS check needs — keep it real
  and say so, mirroring `park-retrieve.rls.test.ts`'s comment).

### Interfaces
Consumes: `working_orders`, `working_order_lines`, the `working_orders_enforce_transition` and
`working_order_lines_require_open_parent` triggers (0004 + 0030). No new production code — this task
tests Task 1's migration.

### Steps

1. **Write the failing suite header + a helper that opens an order and transitions it.** Mirror
   `park-retrieve.rls.test.ts`'s harness (`useRealPostgres`, `startMigratedPostgres`, `asAppUser`,
   `withTenant`, `captureError`/`pgErrorCode`, `seedNode`). Seed one tenant + node + till + location; a
   helper `open()` inserts an `open` `working_orders` row (with `order_number`, `node_id`) and returns
   its id; a helper `setStatus(id, status)` runs the raw UPDATE as `app_user`.

2. **Write the passing-transition assertions (they fail RED until 0030's rewritten trigger exists).**
   ```typescript
   it("permits open → placed, placed → settled, and open → open (label edit)", async () => {
     const id = await open();
     await asApp((tx) => tx.execute(sql`update working_orders set label = 'Mesa 4' where id = ${id}`)); // open → open
     await asApp((tx) => tx.execute(sql`update working_orders set status = 'placed' where id = ${id}`)); // open → placed
     await asApp((tx) =>
       tx.execute(sql`update working_orders set status = 'settled', settled_at = now() where id = ${id}`),
     ); // placed → settled
     const [row] = await asApp((tx) =>
       tx.execute<{ status: string }>(sql`select status from working_orders where id = ${id}`).then((r) => r.rows),
     );
     expect(row!.status).toBe("settled");
   });

   it("permits open → placed → abandoned", async () => {
     const id = await open();
     await asApp((tx) => tx.execute(sql`update working_orders set status = 'placed' where id = ${id}`));
     await asApp((tx) => tx.execute(sql`update working_orders set status = 'abandoned' where id = ${id}`));
   });
   ```

3. **Run it, watch it fail** (the old trigger rejects `placed` — either the enum lacks `placed` if 0030
   is not applied, or the old `OLD.status <> 'open'` body rejects `placed → settled`). Confirm the RED is
   the trigger, not a fixture error.

4. **The rejection assertions.** Terminal states and the forbidden placed edges:
   ```typescript
   it("rejects every transition out of settled/abandoned", async () => {
     const id = await open();
     await asApp((tx) => tx.execute(sql`update working_orders set status = 'settled', settled_at = now() where id = ${id}`));
     const e1 = await captureError(() =>
       asApp((tx) => tx.execute(sql`update working_orders set status = 'abandoned', settled_at = null where id = ${id}`)),
     );
     expect(pgErrorCode(e1)).toBe("P0001"); // the RAISE EXCEPTION, no custom SQLSTATE
     const id2 = await open();
     await asApp((tx) => tx.execute(sql`update working_orders set status = 'abandoned' where id = ${id2}`));
     const e2 = await captureError(() =>
       asApp((tx) => tx.execute(sql`update working_orders set label = 'x' where id = ${id2}`)),
     );
     expect(pgErrorCode(e2)).toBe("P0001");
   });

   it("rejects placed → open and a non-status update of a placed row (the row-level freeze)", async () => {
     const id = await open();
     await asApp((tx) => tx.execute(sql`update working_orders set status = 'placed' where id = ${id}`));
     const e1 = await captureError(() =>
       asApp((tx) => tx.execute(sql`update working_orders set status = 'open' where id = ${id}`)),
     );
     expect(pgErrorCode(e1)).toBe("P0001");
     const e2 = await captureError(() =>
       asApp((tx) => tx.execute(sql`update working_orders set label = 'late label' where id = ${id}`)),
     );
     expect(pgErrorCode(e2)).toBe("P0001");
   });

   it("rejects a line write on a placed order (composition freeze via require_open_parent)", async () => {
     const id = await open();
     await insertLine(id, 1); // helper: a valid working_order_lines insert while open
     await asApp((tx) => tx.execute(sql`update working_orders set status = 'placed' where id = ${id}`));
     const eIns = await captureError(() => insertLine(id, 2));
     expect(eIns.message).toMatch(/order .* is placed|only be written while the order is open/i);
     const eDel = await captureError(() =>
       asApp((tx) => tx.execute(sql`delete from working_order_lines where working_order_id = ${id} and line_no = 1`)),
     );
     expect(eDel.message).toMatch(/only be written while the order is open/i);
   });
   ```
   Run, watch pass (these already hold once 0030's trigger + the unchanged `require_open_parent` are in).

5. **Prove the rewrite by deletion (`CLAUDE.md` §4).** Add a `describe.skip`-documented procedure OR do
   it manually and record it in the commit: in the migration, temporarily revert the `ELSIF OLD.status =
   'placed' …` branch to the old `IF OLD.status <> 'open' THEN RAISE`, re-run the suite, and confirm the
   "open → placed → settled" and "open → placed → abandoned" cases now FAIL (the placed edges are
   rejected). Restore the branch, confirm green. Also delete the terminal `RAISE` (make the function
   `RETURN NEW` unconditionally) and confirm "rejects every transition out of settled/abandoned" fails.
   Record both deletions in the commit body — a test still green with the branch removed is not testing
   the branch.

6. **Commit** `test(db): extended working-order state machine — placed transitions, proven by deletion`.

---

## Task 3 — `order_amendments`: the hash, the append helper, RLS + immutability + tamper-evidence

**Deliverable:** the pure `computeAmendmentHash`/`verifyAmendmentChain` (unit-tested), the
`appendOrderAmendment` helper (writes a hashed per-order sequence under the parent-row lock), and a
real-PG suite proving append-only immutability, tenant isolation (both tenants non-empty in the same
state), and that the hash commits the reason/actor/capturing-node — each proven by deletion.

### Files
- **Create** `packages/db/src/order-amendment-hash.ts` (pure — PGlite/DB-free, unit-tested directly, the
  `chain-hash.ts` posture).
- **Create** `packages/db/src/order-amendment-hash.test.ts` (pure unit).
- **Create** `packages/db/src/append-order-amendment.ts`.
- **Create** `packages/db/src/append-order-amendment.rls.test.ts` (real PG — RLS/immutability/tamper).
- **Modify** `packages/db/src/index.ts` — export both.
- Note for coverage: the pure module is measured by its own unit test; the append helper by the real-PG
  suite. Both live in `packages/db`, which runs `test:coverage` unfiltered.

### Interfaces
Produces:
```typescript
// order-amendment-hash.ts
export interface AmendmentHashInput {
  sequenceNo: number;
  workingOrderId: string;
  kind: "order_placed" | "order_cancelled";
  actorId: string;
  reason: string | null;
  capturedByTillId: string;
  capturedByNodeId: string;
  eventAt: string;            // whole-second UTC ISO
  eventOffsetMinutes: number;
  prevEntryHash: string | null;
}
export interface VerifiableAmendment extends AmendmentHashInput { isFirstEntry: boolean; entryHash: string; }
export type AmendmentVerification =
  | { ok: true }
  | { ok: false; reason: "sequence" | "genesis" | "broken_link" | "hash_mismatch"; sequenceNo: number };
export function computeAmendmentHash(input: AmendmentHashInput): string;      // SHA-256 uppercase hex
export function verifyAmendmentChain(entries: readonly VerifiableAmendment[]): AmendmentVerification;

// append-order-amendment.ts
export interface AppendAmendmentInput {
  tenantId: string;
  workingOrderId: string;
  kind: "order_placed" | "order_cancelled";
  actorId: string;
  reason: string | null;
  capturedByTillId: string;
  capturedByNodeId: string;
  eventAt: Date;
}
export function appendOrderAmendment(
  tx: Transaction, input: AppendAmendmentInput,
): Promise<{ id: string; sequenceNo: number; entryHash: string }>;
```
Consumes: `orderAmendments`, `workingOrders` (for the head lock), `node:crypto`.

### Steps

1. **Write the pure hash unit test first (RED).**
   ```typescript
   import { describe, expect, it } from "vitest";
   import { computeAmendmentHash, verifyAmendmentChain } from "./order-amendment-hash.js";
   import type { AmendmentHashInput, VerifiableAmendment } from "./order-amendment-hash.js";

   const base: AmendmentHashInput = {
     sequenceNo: 1, workingOrderId: "11111111-1111-4111-8111-111111111111", kind: "order_placed",
     actorId: "22222222-2222-4222-8222-222222222222", reason: null,
     capturedByTillId: "33333333-3333-4333-8333-333333333333",
     capturedByNodeId: "44444444-4444-4444-8444-444444444444",
     eventAt: "2026-08-06T10:00:00.000Z", eventOffsetMinutes: 120, prevEntryHash: null,
   };

   it("is a 64-char uppercase-hex SHA-256, stable across calls", () => {
     const h = computeAmendmentHash(base);
     expect(h).toMatch(/^[0-9A-F]{64}$/);
     expect(computeAmendmentHash(base)).toBe(h);
   });

   it("commits the reason, actor and capturing node — changing any changes the hash", () => {
     const h = computeAmendmentHash(base);
     expect(computeAmendmentHash({ ...base, reason: "cancelled by customer" })).not.toBe(h);
     expect(computeAmendmentHash({ ...base, actorId: "55555555-5555-4555-8555-555555555555" })).not.toBe(h);
     expect(computeAmendmentHash({ ...base, capturedByNodeId: "66666666-6666-4666-8666-666666666666" })).not.toBe(h);
     expect(computeAmendmentHash({ ...base, capturedByTillId: "77777777-7777-4777-8777-777777777777" })).not.toBe(h);
   });

   it("hashes event_at as the instant, so an offset-only representation change is inert", () => {
     // Same instant, different string form: the hash must not move (the EventAtMs precedent).
     const a = computeAmendmentHash(base);
     const b = computeAmendmentHash({ ...base, eventAt: "2026-08-06T11:00:00.000+01:00" });
     expect(b).toBe(a);
   });

   it("verifyAmendmentChain accepts a genuine 2-entry chain and rejects content tampering", () => {
     const e1: VerifiableAmendment = { ...base, isFirstEntry: true, entryHash: computeAmendmentHash(base) };
     const c2: AmendmentHashInput = { ...base, sequenceNo: 2, kind: "order_cancelled",
       reason: "voided", prevEntryHash: e1.entryHash };
     const e2: VerifiableAmendment = { ...c2, isFirstEntry: false, entryHash: computeAmendmentHash(c2) };
     expect(verifyAmendmentChain([e1, e2])).toEqual({ ok: true });
     // Tamper entry 1's reason without recomputing → hash_mismatch at seq 1.
     expect(verifyAmendmentChain([{ ...e1, reason: "tampered" }, e2]))
       .toEqual({ ok: false, reason: "hash_mismatch", sequenceNo: 1 });
     // Reorder / broken link.
     expect(verifyAmendmentChain([e2, e1]).ok).toBe(true); // verify sorts by sequenceNo first
     expect(verifyAmendmentChain([e1, { ...e2, prevEntryHash: "DEADBEEF" }]))
       .toEqual({ ok: false, reason: "broken_link", sequenceNo: 2 });
   });
   ```

2. **Implement `order-amendment-hash.ts` (minimal) — a faithful port of `chain-hash.ts`.**
   ```typescript
   import { createHash } from "node:crypto";
   // English field names throughout — this log is generic; the legal term lives only in the schema
   // comment. Mirrors packages/workforce/src/chain-hash.ts (itself the fiscal huella precedent): an
   // ORDERED array of Name=value pairs joined into a canonical string, SHA-256, uppercase hex.
   function joinFields(fields: ReadonlyArray<readonly [string, string]>): string {
     return fields.map(([name, value]) => `${name}=${value}`).join("&");
   }
   function canonicalString(input: AmendmentHashInput): string {
     return joinFields([
       ["SequenceNo", String(input.sequenceNo)],
       ["WorkingOrderId", input.workingOrderId],
       ["Kind", input.kind],
       ["ActorId", input.actorId],
       ["Reason", input.reason ?? ""],
       ["CapturedByTillId", input.capturedByTillId],
       ["CapturedByNodeId", input.capturedByNodeId],
       // The event as an absolute instant (epoch ms), never its wall-clock string — see the schema
       // comment / chain-hash.ts EventAtMs. Offset travels separately.
       ["EventAtMs", String(Date.parse(input.eventAt))],
       ["EventOffsetMinutes", String(input.eventOffsetMinutes)],
       ["PrevEntryHash", input.prevEntryHash ?? ""],
     ]);
   }
   export function computeAmendmentHash(input: AmendmentHashInput): string {
     return createHash("sha256").update(canonicalString(input), "utf8").digest("hex").toUpperCase();
   }
   export function verifyAmendmentChain(entries: readonly VerifiableAmendment[]): AmendmentVerification {
     const ordered = [...entries].sort((a, b) => a.sequenceNo - b.sequenceNo);
     let expectedPrev: string | null = null;
     for (let i = 0; i < ordered.length; i++) {
       const entry = ordered[i]!;
       if (entry.sequenceNo !== i + 1) return { ok: false, reason: "sequence", sequenceNo: i + 1 };
       if (entry.isFirstEntry !== (i === 0)) return { ok: false, reason: "genesis", sequenceNo: entry.sequenceNo };
       if ((entry.prevEntryHash ?? null) !== expectedPrev) return { ok: false, reason: "broken_link", sequenceNo: entry.sequenceNo };
       if (computeAmendmentHash(entry) !== entry.entryHash) return { ok: false, reason: "hash_mismatch", sequenceNo: entry.sequenceNo };
       expectedPrev = entry.entryHash;
     }
     return { ok: true };
   }
   ```
   (Add the exported interfaces/types from the Interfaces block above.) Run the unit test — GREEN.

3. **Prove the tie-break-on-hashed-sequence lesson by deletion (pure test).** Add a test that
   `verifyAmendmentChain` orders on `sequenceNo`, then temporarily delete the `.sort(...)` in the
   implementation and confirm the "accepts a genuine 2-entry chain" case passed in `[e2, e1]` order now
   fails (the walk sees seq 2 at index 0). Restore. Record in the commit.

4. **Write the `appendOrderAmendment` real-PG test (RED).** In
   `append-order-amendment.rls.test.ts` (real PG harness like `park-retrieve.rls.test.ts`), seed a tenant
   + node + till + location + one `open` working order. Test the happy append + immutability + tenant
   isolation + tamper end-to-end:
   ```typescript
   it("appends a hashed per-order sequence, genesis first then linked", async () => {
     const first = await asApp((tx) =>
       appendOrderAmendment(tx, { tenantId: TENANT_A, workingOrderId: orderA, kind: "order_placed",
         actorId: OPERATOR_A, reason: null, capturedByTillId: TILL_A1, capturedByNodeId: nodeA,
         eventAt: new Date("2026-08-06T10:00:00.500Z") }));
     expect(first.sequenceNo).toBe(1);
     const second = await asApp((tx) =>
       appendOrderAmendment(tx, { tenantId: TENANT_A, workingOrderId: orderA, kind: "order_cancelled",
         actorId: OPERATOR_A, reason: "customer left", capturedByTillId: TILL_A1, capturedByNodeId: nodeA,
         eventAt: new Date("2026-08-06T10:05:00.900Z") }));
     expect(second.sequenceNo).toBe(2);
     // Read back and verify the chain end-to-end.
     const rows = await readAmendments(orderA); // helper: select all cols, order by sequence_no
     expect(verifyAmendmentChain(rows)).toEqual({ ok: true });
     // event_at was truncated to whole seconds (the CHECK would else reject; assert the stored value).
     expect(rows[0]!.eventAt).toBe("2026-08-06T10:00:00.000Z");
   });

   it("is append-only: app_user cannot UPDATE or DELETE an amendment", async () => {
     await asApp((tx) => appendOrderAmendment(tx, genesis(orderA)));
     const eU = await captureError(() =>
       asApp((tx) => tx.execute(sql`update order_amendments set reason = 'x' where working_order_id = ${orderA}`)));
     expect(pgErrorCode(eU)).toBe("42501"); // REVOKE fires before the trigger
     const eD = await captureError(() =>
       asApp((tx) => tx.execute(sql`delete from order_amendments where working_order_id = ${orderA}`)));
     expect(pgErrorCode(eD)).toBe("42501");
   });

   it("is tenant-isolated: tenant B sees NONE of tenant A's amendments (both non-empty)", async () => {
     await asApp((tx) => appendOrderAmendment(tx, genesis(orderA)));                 // tenant A
     await asAppB((tx) => appendOrderAmendment(tx, genesisB(orderB)));               // tenant B, same state
     const seenByB = await asAppB((tx) =>
       tx.execute<{ n: number }>(sql`select count(*)::int as n from order_amendments`).then((r) => r.rows[0]!.n));
     expect(seenByB).toBe(1); // only B's own row — A's is hidden, and B genuinely has one
   });
   ```
   Run, watch RED (`appendOrderAmendment` does not exist).

5. **Implement `append-order-amendment.ts`.** Serialise on the parent `working_orders` row (no chain-head
   table — Decision 2), read the current max sequence for the order, compute the hash, insert. Truncate
   `event_at` to whole seconds at this single choke point (the `chain.ts` precedent) so the stored value,
   the CHECK and the hashed instant agree.
   ```typescript
   import { and, desc, eq } from "drizzle-orm";
   import type { Transaction } from "./client.js";
   import { orderAmendments } from "./schema/order-amendments.js";
   import { workingOrders } from "./schema/orders.js";
   import { computeAmendmentHash } from "./order-amendment-hash.js";

   function truncateToWholeSecond(at: Date): string {
     return new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString();
   }

   export async function appendOrderAmendment(tx: Transaction, input: AppendAmendmentInput) {
     // Serialise concurrent appends for one order on the parent row (the order is placed and always
     // exists — no chain-head table needed, Decision 2). A double-tap that races here blocks, then
     // reads the advanced sequence. FOR UPDATE, not FOR SHARE: two appenders must not both read the
     // same max.
     await tx
       .select({ id: workingOrders.id })
       .from(workingOrders)
       .where(and(eq(workingOrders.tenantId, input.tenantId), eq(workingOrders.id, input.workingOrderId)))
       .for("update");

     const [prev] = await tx
       .select({ sequenceNo: orderAmendments.sequenceNo, entryHash: orderAmendments.entryHash })
       .from(orderAmendments)
       .where(
         and(eq(orderAmendments.tenantId, input.tenantId), eq(orderAmendments.workingOrderId, input.workingOrderId)),
       )
       .orderBy(desc(orderAmendments.sequenceNo))
       .limit(1);

     const sequenceNo = (prev?.sequenceNo ?? 0) + 1;
     const isFirstEntry = prev === undefined;
     const prevEntryHash = prev?.entryHash ?? null;
     const eventAt = truncateToWholeSecond(input.eventAt);

     const entryHash = computeAmendmentHash({
       sequenceNo, workingOrderId: input.workingOrderId, kind: input.kind, actorId: input.actorId,
       reason: input.reason, capturedByTillId: input.capturedByTillId, capturedByNodeId: input.capturedByNodeId,
       eventAt, eventOffsetMinutes: input.eventOffsetMinutes ?? offsetOf(input.eventAt), prevEntryHash,
     });
     // eventOffsetMinutes is derived from the supplied Date's local offset if the caller does not pass
     // one — see note below; keep the signature explicit in AppendAmendmentInput.

     const [inserted] = await tx
       .insert(orderAmendments)
       .values({
         tenantId: input.tenantId, workingOrderId: input.workingOrderId, sequenceNo, kind: input.kind,
         actorId: input.actorId, reason: input.reason, capturedByTillId: input.capturedByTillId,
         capturedByNodeId: input.capturedByNodeId, eventAt, eventOffsetMinutes: /* see below */,
         entryHash, prevEntryHash, isFirstEntry,
       })
       .returning({ id: orderAmendments.id });
     /* v8 ignore start */
     if (inserted === undefined) throw new Error("order_amendments: insert returned no row");
     /* v8 ignore stop */
     return { id: inserted.id, sequenceNo, entryHash };
   }
   ```
   **`eventOffsetMinutes`:** the caller (apps/server) reads it from the trusted clock
   (`clock.now().offsetMinutes`), the exact source `recordSale` uses for `issued_offset_minutes`. Extend
   `AppendAmendmentInput` with `eventOffsetMinutes: number` (a required field) rather than deriving it
   inside `packages/db`, so the wall offset is the venue's trusted-clock offset, not the DB host's.
   Remove the `offsetOf(...)` sketch and take `input.eventOffsetMinutes` verbatim. Run — GREEN.

6. **Prove the immutability + tenant-isolation guards by deletion.** Temporarily add `GRANT UPDATE,
   DELETE ON order_amendments TO app_user` inside a rolled-back transaction (the `inmutabilidad.test.ts`
   layered-proof pattern) and confirm the reject_mutation trigger then raises `WT001` — so the trigger,
   not only the REVOKE, is a live backstop. For tenant isolation, confirm the "tenant B sees none" case
   fails if the migration's `order_amendments_tenant_isolation` policy is dropped (run once with the
   policy removed, restore).

7. **Export from `index.ts`; commit** `feat(db): order-amendment append helper + tamper-evident hash`.

---

## Task 4 — `order_prep`: RLS + prep advancing on a settled order (Mode-P conflict avoided)

**Deliverable:** a real-PG suite proving `order_prep` is FORCE-RLS + tenant-isolated, the node-scoped
queue read returns a tenant's own node's rows only, and prep advances on an **already-`settled`** order
without touching the frozen `working_orders` row — the exact §5 conflict.

### Files
- **Create** `packages/db/src/schema/order-prep.rls.test.ts` (real PG).

### Interfaces
Consumes `orderPrep`, `workingOrders`. No new production code (the prep *operations* land in `apps/server`
Task 9; this task proves the table's RLS + the settled-order-advance property at the schema level).

### Steps

1. **Write the RED suite.** Seed tenant A + node + a working order taken to `settled`, and tenant B with
   its own node + order. Assertions:
   ```typescript
   it("advances prep on an already-settled order without touching the frozen working_orders row", async () => {
     // orderA is settled (open → settled). Insert its prep row and advance it as app_user.
     await asApp((tx) => tx.execute(sql`insert into order_prep (tenant_id, working_order_id, node_id, state)
       values (${TENANT_A}, ${orderA}, ${nodeA}, 'queued')`));
     await asApp((tx) => tx.execute(sql`update order_prep set state = 'preparing', preparing_at = now()
       where tenant_id = ${TENANT_A} and working_order_id = ${orderA}`));
     await asApp((tx) => tx.execute(sql`update order_prep set state = 'ready', ready_at = now()
       where tenant_id = ${TENANT_A} and working_order_id = ${orderA}`));
     const [prep] = await asApp((tx) =>
       tx.execute<{ state: string }>(sql`select state from order_prep where working_order_id = ${orderA}`).then((r) => r.rows));
     expect(prep!.state).toBe("ready");
     // The working_orders row was NEVER updated — still settled, its enforce_transition never fired.
     const [wo] = await asApp((tx) =>
       tx.execute<{ status: string }>(sql`select status from working_orders where id = ${orderA}`).then((r) => r.rows));
     expect(wo!.status).toBe("settled");
   });

   it("the node-scoped queue returns only this tenant's node rows; tenant B sees none of A's", async () => {
     await seedPrep(TENANT_A, orderA, nodeA, "queued");
     await seedPrepB(TENANT_B, orderB, nodeB, "queued");
     const aSeen = await asApp((tx) =>
       tx.execute<{ n: number }>(sql`select count(*)::int as n from order_prep where node_id = ${nodeA}`).then((r) => r.rows[0]!.n));
     const bSeesA = await asAppB((tx) =>
       tx.execute<{ n: number }>(sql`select count(*)::int as n from order_prep where node_id = ${nodeA}`).then((r) => r.rows[0]!.n));
     expect(aSeen).toBe(1);
     expect(bSeesA).toBe(0); // RLS hides A's prep from B even by A's node id
   });

   it("app_user has UPDATE on order_prep but NOT DELETE", async () => {
     await seedPrep(TENANT_A, orderA, nodeA, "queued");
     const e = await captureError(() =>
       asApp((tx) => tx.execute(sql`delete from order_prep where working_order_id = ${orderA}`)));
     expect(pgErrorCode(e)).toBe("42501");
   });
   ```
   This is real PG because the settled-order-advance-without-touching-the-frozen-row property and the RLS
   isolation are exactly what PGlite's superuser connection cannot show (FORCE bypass) — say so in the
   header comment (the `park-retrieve.rls.test.ts` justification).

2. **Run, watch pass** (the table + policy + grants from 0030 already satisfy all three). If any fails,
   the fault is in Task 1's migration — fix there, not here.

3. **Prove the isolation by deletion:** run once with the `order_prep_tenant_isolation` policy dropped
   and confirm "tenant B sees none of A's" fails; restore. Prove the no-DELETE grant by confirming the
   DELETE case passes only because `GRANT` omits DELETE (temporarily add `GRANT DELETE` in a rolled-back
   tx, confirm the 42501 disappears).

4. **Commit** `test(db): order_prep RLS + advances on a settled order without touching the frozen row`.

---

## Task 5 — `priceLockedLines` in `@waitron/catalogue`

**Deliverable:** `priceLockedLines` produces a `priceBasket`-identical `{ lines, grossLineTotals, total,
vatBreakdown }` from stored locked lines, reproducing the cent-exact difference-method desglose (base
4.55 / tax 0.95), proven against the same divergence-prone basket the replay test pins.

### Files
- **Modify** `packages/catalogue/src/pricing.ts` — extract the shared arithmetic core; add
  `priceLockedLines`.
- **Modify** `packages/catalogue/src/pricing.test.ts` — the locked-line case.

### Interfaces
Produces:
```typescript
export interface LockedLine {
  grossUnitPrice: string;   // the stored working_order_lines.unit_price_gross
  quantity: string;
  vatRate: string;          // the stored working_order_lines.vat_rate, e.g. "21.00"
  descriptions: Record<string, string>;
  category: string | null;
}
export function priceLockedLines(lines: readonly LockedLine[]): ReturnType<typeof priceBasket>;
```
Consumes: the same `@waitron/shared` decimal helpers `priceBasket` uses.

### Steps

1. **Write the failing test (RED)** pinning the difference-method group the replay test relies on:
   ```typescript
   import { priceLockedLines } from "./pricing.js";
   it("prices locked lines to the difference-method desglose (base 4.55 / tax 0.95), like a walk-up", () => {
     // café×1 (gross 1.50) + agua×2 (gross unit 2.00, qty 2). Group base 4.55, gross 5.50, tax 0.95
     // (NOT round(4.55×21%)=0.96) — the exact property working-order.rls.test.ts:363-378 pins.
     const priced = priceLockedLines([
       { grossUnitPrice: "1.50", quantity: "1", vatRate: "21.00", descriptions: { es: "Café" }, category: null },
       { grossUnitPrice: "2.00", quantity: "2", vatRate: "21.00", descriptions: { es: "Agua" }, category: null },
     ]);
     expect(priced.total).toBe("5.50");
     expect(priced.vatBreakdown).toEqual([{ rate: "21.00", base: "4.55", tax: "0.95" }]);
     expect(priced.grossLineTotals).toEqual(["1.50", "4.00"]);
     // The per-line net base + net unit match what priceBasket produces for the same gross figures.
     expect(priced.lines[0]).toMatchObject({ lineNo: 1, unitPrice: "1.24", vatRate: "21.00", lineTotal: "1.24" });
     expect(priced.lines[1]).toMatchObject({ lineNo: 2, unitPrice: "1.65", vatRate: "21.00", lineTotal: "3.31" });
   });

   it("prices a weighed locked line from its stored gross unit, not line_total ÷ quantity", () => {
     // A weighed line where recovery by division would drift: gross unit 9.99/kg, qty 0.333 → gross
     // 3.33. priceLockedLines takes the STORED gross unit, so base/tax match the add-time desglose.
     const priced = priceLockedLines([
       { grossUnitPrice: "9.99", quantity: "0.333", vatRate: "10.00", descriptions: { es: "Jamón" }, category: null },
     ]);
     expect(priced.total).toBe("3.33");
     expect(priced.vatBreakdown).toEqual([{ rate: "10.00", base: "3.03", tax: "0.30" }]);
   });
   ```
   (Compute the expected weighed figures with `baseFromGross(3.33, 10) = round(333/1.1) = 3.03`, `tax =
   3.33 − 3.03 = 0.30` — verify in the RED run and pin the exact values `priceBasket` yields.)

2. **Run it, watch it fail** (`priceLockedLines` does not exist).

3. **Extract the shared core in `pricing.ts`, then implement `priceLockedLines`.** Factor the per-item
   arithmetic (`gross = toScale(unit×qty)`, `base`, `netUnit`, the rate grouping, `tax = gross − base`)
   into a private `priceRows(rows)` that both entry points call, so a locked-line filing is byte-identical
   to a walk-up:
   ```typescript
   interface PricingRow { grossUnit: Decimal; quantity: string; rate: Decimal; descriptions: Record<string,string>; category: string | null; }

   function priceRows(rows: readonly PricingRow[]): {
     lines: RecordSaleLine[]; grossLineTotals: Decimal[]; total: Decimal; vatBreakdown: VatBreakdownLine[];
   } {
     const lines: RecordSaleLine[] = [];
     const grossLineTotals: Decimal[] = [];
     const groups = new Map<Decimal, { base: Decimal; gross: Decimal }>();
     rows.forEach((row, i) => {
       const gross = toScale(multiplyDecimal(row.grossUnit, decimal(row.quantity)), MONEY_SCALE);
       const base = baseFromGross(gross, row.rate);
       const netUnit = baseFromGross(toScale(row.grossUnit, MONEY_SCALE), row.rate);
       lines.push({ lineNo: i + 1, descriptions: row.descriptions, quantity: row.quantity,
         unitPrice: netUnit, vatRate: row.rate, lineTotal: base, category: row.category });
       grossLineTotals.push(gross);
       const g = groups.get(row.rate);
       groups.set(row.rate, g === undefined ? { base, gross } : { base: addDecimal(g.base, base), gross: addDecimal(g.gross, gross) });
     });
     const vatBreakdown = [...groups.entries()].map(([rate, g]) => ({ rate, base: g.base, tax: subtractDecimal(g.gross, g.base) }));
     const total = sumDecimals([...groups.values()].map((g) => g.gross));
     return { lines, grossLineTotals, total, vatBreakdown };
   }

   export function priceBasket(items: readonly BasketItem[]) {
     return priceRows(items.map((item) => ({
       grossUnit: decimal(item.product.unitPrice), quantity: item.quantity,
       rate: resolveVatRate(item.product.vatClass), descriptions: item.product.descriptions,
       category: item.product.category,
     })));
   }

   export function priceLockedLines(lines: readonly LockedLine[]) {
     return priceRows(lines.map((line) => ({
       grossUnit: decimal(line.grossUnitPrice), quantity: line.quantity,
       rate: decimal(line.vatRate), descriptions: line.descriptions, category: line.category,
     })));
   }
   ```
   `priceBasket`'s public signature and every existing caller are unchanged (the extraction is behind
   it). Run the full `pricing.test.ts` — the existing `priceBasket` cases and the two new ones all pass.

4. **Guard against drift by keeping ONE core.** Add a note in the extraction comment: `priceBasket` and
   `priceLockedLines` share `priceRows`, so a locked-line filing can never diverge from a walk-up's — the
   two differ only in how they source the gross unit and the rate (a product's `vatClass` vs a stored
   `vat_rate`).

5. **Run `pnpm --filter @waitron/catalogue test:coverage`; commit** `feat(catalogue): priceLockedLines — file a locked line to the walk-up desglose`.

---

## Task 6 — `payWorkingOrder` files a retrieved order from the STORED locked lines (the load-bearing §2 edit)

**Deliverable:** the single load-bearing behaviour change — a retrieved order's sale files at the price
**locked at add**, not a re-price at pay. The semantically-broken test is rewritten; the missing
catalogue-price-change test is added and proven by deletion of the lock.

### Files
- **Modify** `apps/server/src/working-order.ts:67-85` (persist `unitPriceGross`).
- **Modify** `apps/server/src/till-sale.ts:194-209` (the retrieved-order else-branch).
- **Modify** `apps/server/src/working-order.rls.test.ts:332-361` (rewrite the broken case) and add the
  price-change case; rewrite the now-false comments at `:514`, `:708`.
- **Modify** `apps/server/src/till-sale.test.ts:166` (comment wording only — a walk-up is unchanged).

### Interfaces
Consumes `priceLockedLines` (Task 5), `workingOrderLines` (with `unitPriceGross`). Produces the same
`TillSaleResult`. `PayWorkingOrderRequest.lines` stays in the signature but is **ignored** for a
retrieved order (see step 3) — the doc comment is rewritten to say so.

### Steps

1. **Persist the locked gross unit in `priceOrderLines` (RED via a schema-shape failure first).** In
   `working-order.ts`'s `priceOrderLines`, add `unitPriceGross` to each line row:
   ```typescript
   const lineRows = priced.lines.map((line, i) => ({
     tenantId: cfg.tenantId, workingOrderId, lineNo: line.lineNo, productId: lines[i]!.productId,
     descriptions: line.descriptions, quantity: line.quantity, unitPrice: line.unitPrice,
     vatRate: line.vatRate,
     lineTotal: priced.grossLineTotals[i]!,
     // The GROSS unit LOCKED at add time (line-add snapshot, 7c) — the authoritative input the FILED
     // sale rebuilds from without a re-price. `grossLineTotals[i] = grossUnit × quantity`, so the unit
     // is that over the quantity for `each`; for a weighed line it is stored directly rather than
     // divided back out. priceBasket exposes the per-line gross via `grossLineTotals`; the per-UNIT
     // gross is recovered here as the line's own priced gross unit.
     unitPriceGross: priced.grossUnitPrices[i]!,
     category: line.category ?? null,
   }));
   ```
   `priceBasket` does not yet expose a per-unit gross array. Add `grossUnitPrices: Decimal[]` to
   `priceBasket`'s (and `priceLockedLines`'s) return in Task 5's `priceRows` — push `toScale(row.grossUnit,
   MONEY_SCALE)` per row. (Update Task 5's `priceRows` accordingly; the field is the stored `unit_price_gross`
   source and is parallel to `lines`.) Rewrite the `working-order.ts:76-83` comment to say the draft line
   now carries the authoritative locked gross unit, not a display cache.

2. **Rewrite the semantically-broken test `working-order.rls.test.ts:332-361` (the clearest budgeted
   place).** The old test parks café×1 then pays café×1 + agua×1 — a pay whose basket differs from the
   stored composition, which line-add snapshot removes (agua was never *added*, so it has no lock).
   Replace it with the two model-correct patterns:
   ```typescript
   it("parked: pays the STORED composition at its LOCKED prices and settles it", async () => {
     const { cfg, cafe, agua } = await setupVenue();
     const id = randomUUID();
     // Park café×1 + agua×1 (both ADDED, both locked). Pay the SAME id with NO client basket that can
     // diverge — pay files the stored locked lines (design §2). Total is the locked 1.50 + 2.00 = 3.50.
     await parkOrder({ db: suite.admin }, cfg, {
       id, lines: [{ productId: cafe.id, quantity: "1" }, { productId: agua.id, quantity: "1" }], label: "Mesa 4",
     });
     const res = await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
       id, lines: [], tender: { method: "cash", amount: "5.00" },
     });
     expect(res.total).toBe("3.50"); // the LOCKED composition, filed from the stored lines
     expect(res.change).toBe("1.50");
     expect(res.invoiceNumber).toBe("A/1");
     expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
     expect(await saleCount(id)).toBe(1);
     expect(await registroCount(id)).toBe(1);
   });
   ```
   (The `lines: []` on the pay makes explicit that a retrieved order does NOT send a client basket —
   step 3 files from the stored lines. If the empty-basket guard would reject `lines: []` on a retrieved
   order, relax that guard to apply only to a walk-up, i.e. when `locked === undefined`; see step 3.)

3. **Rewrite the retrieved-order branch in `payWorkingOrder` (RED, then GREEN).** Replace the
   catalogue re-price (`till-sale.ts:197-208`) with a read of the stored locked lines fed to
   `priceLockedLines`:
   ```typescript
   let priced: ReturnType<typeof priceBasket>;
   if (locked === undefined) {
     // WALK-UP: create it OPEN with its priced lines and reuse the price creation derived (unchanged —
     // a walk-up's lock IS the current price, no gap). Design §2: already snapshot-consistent.
     ({ priced } = await createOpenOrder(tx, cfg, req.id, req.lines, null));
   } else {
     // RETRIEVED order: file from the STORED locked lines, NOT a re-price of a client basket (design
     // §2 — line-add snapshot). The browser sends no basket; the persisted working_order_lines are the
     // authoritative composition. priceLockedLines runs the SAME difference-method arithmetic over the
     // locked gross unit, so the filed record is byte-identical to what the line was priced to at add.
     const stored = await tx
       .select({
         grossUnitPrice: workingOrderLines.unitPriceGross, quantity: workingOrderLines.quantity,
         vatRate: workingOrderLines.vatRate, descriptions: workingOrderLines.descriptions,
         category: workingOrderLines.category,
       })
       .from(workingOrderLines)
       .where(eq(workingOrderLines.workingOrderId, req.id))
       .orderBy(workingOrderLines.lineNo);
     /* v8 ignore start */
     if (stored.length === 0) {
       // A retrieved OPEN order always has ≥1 line (park refuses an empty basket), so this is
       // corruption, not a reachable flow.
       throw new Error(`payWorkingOrder: open working order ${req.id} has no lines to file`);
     }
     /* v8 ignore stop */
     priced = priceLockedLines(stored);
   }
   ```
   Import `priceLockedLines` and `workingOrderLines`. Rewrite the block comment above it (currently
   `:181-193`) to describe filing from the lock rather than re-pricing at pay. Move the empty-basket
   guard (`till-sale.ts:174`) so it applies **only to the walk-up shape** (`locked === undefined`): a
   retrieved order's `req.lines` is ignored, so an empty `req.lines` on a retrieved order is not a fault.
   Rewrite `PayWorkingOrderRequest`'s doc comment (`till-sale.ts:96-111`) to say pay files the stored
   lines for a retrieved order and re-prices only the freshly-created walk-up lines. Run the rewritten
   test — GREEN.

4. **Add the missing catalogue-price-change test — the one the revision is FOR (RED, then GREEN).**
   ```typescript
   it("files a parked line at its LOCKED price after the catalogue price changes (line-add snapshot)", async () => {
     const { cfg, cafe } = await setupVenue();
     const id = randomUUID();
     // Park café×1 at the locked 1.50.
     await parkOrder({ db: suite.admin }, cfg, { id, lines: [{ productId: cafe.id, quantity: "1" }] });
     // Change the catalogue price AFTER the lock — the exact mutation no existing test does.
     await withTenant(suite.admin, cfg.tenantId, async (tx) => {
       await asAppUser(tx);
       await tx.execute(sql`update products set unit_price = '9.99' where id = ${cafe.id}`);
     });
     // Pay — files at the LOCKED 1.50, never the new 9.99.
     const res = await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
       id, lines: [], tender: { method: "cash", amount: "5.00" },
     });
     expect(res.total).toBe("1.50");        // the lock, not 9.99
     expect(res.change).toBe("3.50");
     const filed = await filedSaleTotal(id); // helper: select sales.total where working_order_id = id
     expect(filed).toBe("1.50");            // the IMMUTABLE record carries the locked price
   });
   ```
   This is the only test that separates the two pricing models (`CLAUDE.md` §1 — a measurement where
   both answers look alike measures nothing); it needs a real price mutation across the gap, so it stays
   in the real-PG suite. Run — GREEN.

5. **Prove the lock by deletion (`CLAUDE.md` §4).** Temporarily change the retrieved-order branch back to
   the old catalogue re-price of a rebuilt basket (or point `priceLockedLines` at `unit_price` fresh from
   the catalogue), re-run the price-change test, confirm it now files at 9.99 (RED). Restore, confirm
   1.50. Record in the commit.

6. **Rewrite the now-false comments (`CLAUDE.md` §1 — editing a file is not auditing it).** The comments
   at `working-order.rls.test.ts:514` ("A parked pay re-prices the SENT basket") and `:708` ("re-price
   the retrieved basket authoritatively") — rewrite to describe filing from the locked stored lines; the
   numeric assertions survive (no price change). `till-sale.test.ts:166` ("re-prices a basket
   authoritatively…") is a walk-up, behaviour-unchanged — reword only. Update the demo-script narration
   (`park-retrieve-demo.ts:224,243`, `till-demo.ts:251`) — "file from the locked line", not "re-price
   authoritatively".

7. **Run `pnpm --filter @waitron/server test:coverage` + `pnpm --filter @waitron/catalogue
   test:coverage`; commit** `feat(server): file a retrieved order from its locked lines (line-add snapshot)`.

---

## Task 7 — Placing: `placeOrder` (open → placed) + open the amendment log; `cancelPlacedOrder` (placed → abandoned) + logged amendment

**Deliverable:** placing transitions `open → placed`, freezes composition (for free, via
`require_open_parent`), and writes the genesis `order_placed` amendment; cancelling a placed order writes
an `order_cancelled` amendment. A pure walk-up never enters `placed` and opens no log.

### Files
- **Modify** `apps/server/src/working-order.ts` — add `placeOrder`, `cancelPlacedOrder`.
- **Modify** `apps/server/src/errors.ts` — `working_order.not_placed`.
- **Modify** `apps/server/src/working-order.rls.test.ts` — place/cancel cases.

### Interfaces
Produces:
```typescript
export interface PlaceOrderResult { id: string; status: "placed" | "settled"; invoiceNumber?: string; issuedAt?: string; total?: string; qr?: string; vatBreakdown?: {rate:string;base:string;tax:string}[]; }
export function placeOrder(deps: TillSaleDeps, cfg: TillConfig, id: string, operatorId?: string): Promise<PlaceOrderResult>;
export function cancelPlacedOrder(deps: WorkingOrderDeps, cfg: TillConfig, id: string, reason: string, operatorId?: string): Promise<void>;
```
Consumes `appendOrderAmendment`, `workingOrders`, `priceLockedLines`, `recordSale` (Mode I only — wired
in Task 8; Task 7 lands the Mode-T/generic placing that files no fiscal doc, then Task 8 adds the Mode-I
deferred-file branch). Error: reuse `working_order.not_open` (place a non-open order), mint
`working_order.not_placed` (cancel/amend a non-placed order).

### Steps

1. **Mint `working_order.not_placed` in `apps/server/src/errors.ts`.** Grep first: the `working_order.*`
   family (`not_found`, `not_open`) is the right home; no `not_placed` exists. Add it in the same
   `declare module` block, echoing/qualifying `workingOrderId` exactly as `not_open` does:
   ```typescript
   /**
    * A working order this caller tried to CANCEL or AMEND is not `placed` — it names one still `open`
    * (edit it silently via updateHeldOrder instead), one already `settled`/`abandoned`, or none at all
    * (absent, or another tenant's, RLS-hidden). All report THIS one code, the same fail-closed shape
    * `working_order.not_open` uses for the modify side. Mapped to 409 (the state forbids the operation).
    * `working_order.*`, not `server.*`, and destined for @waitron/core once a package other than this
    * host throws it — the note `working_order.not_open` carries.
    */
   "working_order.not_placed": { workingOrderId: string };
   ```

2. **Write the placing test (RED).**
   ```typescript
   it("placeOrder: open → placed, freezes composition, opens the log with a genesis order_placed entry", async () => {
     const { cfg, cafe } = await setupVenue();          // cfg.orderFlow defaults to a placing mode in this test — see Task 8
     const id = randomUUID();
     await parkOrder({ db: suite.admin }, cfg, { id, lines: [{ productId: cafe.id, quantity: "1" }] });
     await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);
     expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
     // A line write on the now-placed order is rejected (composition freeze).
     await expect(updateHeldOrder({ db: suite.admin }, cfg, id, { lines: [{ productId: cafe.id, quantity: "2" }] }))
       .rejects.toMatchObject({ code: "working_order.not_open" });
     // The log opened: exactly one order_placed amendment, genesis, verifiable.
     const rows = await readAmendments(id);
     expect(rows).toHaveLength(1);
     expect(rows[0]).toMatchObject({ kind: "order_placed", sequenceNo: 1, isFirstEntry: true, actorId: OPERATOR });
     expect(verifyAmendmentChain(rows)).toEqual({ ok: true });
   });

   it("cancelPlacedOrder: placed → abandoned, appends an order_cancelled amendment with the reason", async () => {
     const { cfg, cafe } = await setupVenue();
     const id = randomUUID();
     await parkOrder({ db: suite.admin }, cfg, { id, lines: [{ productId: cafe.id, quantity: "1" }] });
     await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);
     await cancelPlacedOrder({ db: suite.admin }, cfg, id, "customer left", OPERATOR);
     expect(await orderState(id)).toEqual({ status: "abandoned", settledAtSet: false });
     const rows = await readAmendments(id);
     expect(rows.map((r) => r.kind)).toEqual(["order_placed", "order_cancelled"]);
     expect(rows[1]).toMatchObject({ sequenceNo: 2, reason: "customer left", prevEntryHash: rows[0]!.entryHash });
     expect(verifyAmendmentChain(rows)).toEqual({ ok: true }); // a genuine 2-entry chain
   });

   it("a pure walk-up never enters placed and opens no amendment log", async () => {
     const { cfg, cafe } = await setupVenue();
     const id = randomUUID();
     await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
       id, lines: [{ productId: cafe.id, quantity: "1" }], tender: { method: "cash", amount: "5.00" },
     });
     expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
     expect(await readAmendments(id)).toHaveLength(0); // no placing → no log (design §3)
   });
   ```
   Run, watch RED (`placeOrder`/`cancelPlacedOrder` do not exist).

3. **Implement `placeOrder` (Mode-T/generic placing — files no fiscal doc yet; Task 8 adds Mode-I's
   deferred file).** One `withTenant`/`asAppUser` transaction: lock + status-check the order, transition
   `open → placed`, write the genesis amendment, insert the `order_prep` queued row. Fail closed with
   `working_order.not_open` when the order is not `open`.
   ```typescript
   export async function placeOrder(deps: TillSaleDeps, cfg: TillConfig, id: string, operatorId?: string): Promise<PlaceOrderResult> {
     return withTenant(deps.db, cfg.tenantId, async (tx) => {
       await asAppUser(tx);
       const [locked] = await tx.select({ status: workingOrders.status }).from(workingOrders)
         .where(eq(workingOrders.id, id)).for("update");
       if (locked === undefined || locked.status !== "open") {
         throw new AppError("working_order.not_open", { workingOrderId: id });
       }
       // (Mode I files recordSale deferred HERE — added in Task 8. Mode T/generic: no fiscal doc.)
       await tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, id));
       const now = deps.clock.now();
       await appendOrderAmendment(tx, {
         tenantId: cfg.tenantId, workingOrderId: id, kind: "order_placed", actorId: operatorId ?? SYSTEM_ACTOR,
         reason: null, capturedByTillId: cfg.tillId, capturedByNodeId: cfg.nodeId,
         eventAt: now.instant, eventOffsetMinutes: now.offsetMinutes,
       });
       await tx.insert(orderPrep).values({ tenantId: cfg.tenantId, workingOrderId: id, nodeId: cfg.nodeId, state: "queued" });
       return { id, status: "placed" };
     });
   }
   ```
   **`operatorId` is required in practice** (the till supplies `session.personId`); `SYSTEM_ACTOR` is a
   fixed sentinel uuid for the demo/tests only — OR make `operatorId` non-optional and pass a fixture
   operator in tests (preferred: `actor_id` is NOT NULL and the amendment's accountability rests on a
   real operator, so require it). Use a required `operatorId: string` and drop the sentinel.

4. **Implement `cancelPlacedOrder`.** Lock + require `placed`, transition `placed → abandoned`, append
   `order_cancelled` with the operator's reason (required, non-empty):
   ```typescript
   export async function cancelPlacedOrder(deps: WorkingOrderDeps, cfg: TillConfig, id: string, reason: string, operatorId: string): Promise<void> {
     return withTenant(deps.db, cfg.tenantId, async (tx) => {
       await asAppUser(tx);
       const [locked] = await tx.select({ status: workingOrders.status }).from(workingOrders)
         .where(eq(workingOrders.id, id)).for("update");
       if (locked === undefined || locked.status !== "placed") {
         throw new AppError("working_order.not_placed", { workingOrderId: id });
       }
       if (reason.trim() === "") throw new AppError("working_order.not_placed", { workingOrderId: id }); // a cancel needs a reason
       await tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
       const now = /* deps needs a clock — see note */;
       await appendOrderAmendment(tx, {
         tenantId: cfg.tenantId, workingOrderId: id, kind: "order_cancelled", actorId: operatorId,
         reason, capturedByTillId: cfg.tillId, capturedByNodeId: cfg.nodeId,
         eventAt: now.instant, eventOffsetMinutes: now.offsetMinutes,
       });
     });
   }
   ```
   `cancelPlacedOrder` needs a clock for the amendment's local wall-clock. `WorkingOrderDeps` today is
   `{ db }`; either widen it to `{ db; clock: TrustedClock }` or route cancel through `TillSaleDeps`
   (which carries `clock`). **Route it through `TillSaleDeps`** (cancel is a till operation beside
   place/pay) so the clock is available and the dep shape stays consistent with `placeOrder`. The
   empty-reason refusal reuses `working_order.not_placed` rather than minting a code — a cancel with no
   reason is not an amendable state (record it as such); note this in the code. (If a distinct
   `working_order.reason_required` reads better on review, mint it in the same block — grep confirms no
   sibling; keep it minimal and prefer reuse per §10.)

5. **Run the tests — GREEN.** Then **prove the log-open guard by deletion:** remove the
   `appendOrderAmendment` call in `placeOrder`, confirm "opens the log with a genesis order_placed entry"
   fails (0 rows), restore.

6. **Run `pnpm --filter @waitron/server test:coverage`; commit** `feat(server): placing + cancel — open and append the amendment log`.

---

## Task 8 — The pay-timing config + the three-mode dispatch (`orderFlow`, `collectOrder`, Mode-I deferred file)

**Deliverable:** `TillConfig.orderFlow` read from the location; the dispatch — Mode I files `recordSale`
deferred at placing and `settleSale` at collect; Mode T files `recordSale` immediate at collect; Mode P
files immediate at order (existing `payWorkingOrder`). Idempotency composes across the new triggers.

### Files
- **Modify** `apps/server/src/till-config.ts` — `TillConfig.orderFlow` + `readOrderFlow`.
- **Modify** `apps/server/src/working-order.ts` / `till-sale.ts` — the Mode-I deferred branch in
  `placeOrder`; `collectOrder` (Modes I/T at collect).
- **Modify** `apps/server/src/till-sale.test.ts` — the PGlite mode-dispatch cases (pure branch over
  config — say why PGlite suffices).
- **Modify** `apps/server/src/working-order.rls.test.ts` — the real-PG idempotency cases (double-place
  Mode I, double-pay replay).

### Interfaces
Produces:
```typescript
export type OrderFlow = "prepay" | "invoice_first" | "ticket_then_pay";
// TillConfig gains: orderFlow: OrderFlow
export function readOrderFlow(db: Database, cfg: Pick<TillConfig, "tenantId" | "locationId">): Promise<OrderFlow>;
export function collectOrder(deps: TillSaleDeps, cfg: TillConfig, req: PayWorkingOrderRequest, operatorId: string): Promise<TillSaleResult>;
```
Consumes `recordSale` (immediate + deferred), `settleSale`, `listOutstandingSales` (all extant),
`priceLockedLines`, `locations.orderFlow`.

### Steps

1. **Add `orderFlow` to `TillConfig` + a `readOrderFlow` DB read (RED via a type gap first).** In
   `till-config.ts`, add `orderFlow: OrderFlow` to the interface (import the `OrderFlow` union — export it
   from here or from `@waitron/db` via the `orderFlow` enum's `.enumValues`). `loadTillConfig` stays
   env-only; add:
   ```typescript
   export async function readOrderFlow(db: Database, cfg: Pick<TillConfig, "tenantId" | "locationId">): Promise<OrderFlow> {
     return withTenant(db, cfg.tenantId, async (tx) => {
       await asAppUser(tx);
       const [row] = await tx.select({ orderFlow: locations.orderFlow }).from(locations)
         .where(eq(locations.id, cfg.locationId));
       /* v8 ignore start */
       if (row === undefined) throw new Error(`readOrderFlow: no location ${cfg.locationId}`); // provisioning guarantees it
       /* v8 ignore stop */
       return row.orderFlow;
     });
   }
   ```
   `boot.ts` (the composition root) calls `readOrderFlow` once after `loadTillConfig` and merges the
   result into the `TillConfig` it hands the routes (note this wiring; the field is required so every
   `TillConfig` literal — incl. tests' `tillConfigFromVenue` — must set it).

2. **Write the mode-dispatch PGlite test (RED).** PGlite suffices here (say so in the header): the
   dispatch is a **pure branch over config** — which primitive is called at place vs collect — not an
   RLS/concurrency property. Stub the fiscal backend as the existing `till-sale.test.ts` does.
   ```typescript
   // PGlite, not real PG: this asserts the config→primitive DISPATCH (Mode I calls recordSale deferred
   // at placing + settleSale at collect; Mode T recordSale immediate at collect; Mode P immediate at
   // order). A pure branch over cfg.orderFlow, provable on one backend (design §9).
   it("Mode I (invoice_first): place files a deferred invoice; collect settles it, no second file", async () => {
     const cfg = { ...baseCfg, orderFlow: "invoice_first" as const };
     const id = randomUUID();
     await parkOrder({ db: suite.db }, cfg, { id, lines: [{ productId: cafe.id, quantity: "1" }] });
     const placed = await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR);
     expect(placed.status).toBe("placed");
     expect(placed.invoiceNumber).toBe("A/1"); // the deferred invoice issued at placing
     expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
     // The sale exists, unsettled — it shows as outstanding.
     const outstanding = await withTenant(suite.db, cfg.tenantId, async (tx) => { await asAppUser(tx); return listOutstandingSales(tx, cfg.tenantId); });
     expect(outstanding).toHaveLength(1);
     // Collect: settleSale, placed → settled, files NOTHING new.
     await collectOrder({ db: suite.db, backend, clock }, cfg, { id, lines: [], tender: { method: "cash", amount: "1.50" } }, OPERATOR);
     expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
     expect(await saleCount(id)).toBe(1);      // still one sale
     expect(await registroCount(id)).toBe(1);  // still one registro — no second file at collect
   });

   it("Mode T (ticket_then_pay): place files no fiscal doc; collect files immediate at collect", async () => {
     const cfg = { ...baseCfg, orderFlow: "ticket_then_pay" as const };
     const id = randomUUID();
     await parkOrder({ db: suite.db }, cfg, { id, lines: [{ productId: cafe.id, quantity: "1" }] });
     const placed = await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR);
     expect(placed.invoiceNumber).toBeUndefined();   // NO fiscal doc at placing
     expect(await saleCount(id)).toBe(0);
     await collectOrder({ db: suite.db, backend, clock }, cfg, { id, lines: [], tender: { method: "cash", amount: "1.50" } }, OPERATOR);
     expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
     expect(await saleCount(id)).toBe(1);            // filed at collect
   });

   it("Mode P (prepay): pay at order files immediate, open → settled (unchanged walk-up)", async () => {
     const cfg = { ...baseCfg, orderFlow: "prepay" as const };
     const id = randomUUID();
     const res = await payWorkingOrder({ db: suite.db, backend, clock }, cfg, { id, lines: [{ productId: cafe.id, quantity: "1" }], tender: { method: "cash", amount: "5.00" } }, OPERATOR);
     expect(res.total).toBe("1.50");
     expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
   });
   ```
   Run, watch RED (`collectOrder` missing; `placeOrder` has no Mode-I deferred branch).

3. **Add the Mode-I deferred file to `placeOrder`.** Before the `open → placed` update, when
   `cfg.orderFlow === "invoice_first"`, file `recordSale` deferred from the stored locked lines and read
   back the invoice number for the result:
   ```typescript
   let placeResult: PlaceOrderResult = { id, status: "placed" };
   if (cfg.orderFlow === "invoice_first") {
     const stored = await readLockedLines(tx, id);             // the same select as payWorkingOrder's retrieved branch
     const priced = priceLockedLines(stored);
     const { saleId, fiscal } = await recordSale(tx, deps.backend, {
       tenantId: cfg.tenantId, tillId: cfg.tillId, nodeId: cfg.nodeId, seriesId: cfg.seriesId,
       workingOrderId: brandWorkingOrderId(id), locale: cfg.locale, invoiceLocales: cfg.invoiceLocales,
       total: priced.total, lines: priced.lines, vatBreakdown: priced.vatBreakdown,
       fiscalBackend: "verifactu", clock: deps.clock, operatorId,
       settlement: { kind: "deferred" },       // invoice with NO payment (design §3, Ordering 1)
     });
     const [issued] = await tx.select({ code: invoiceSeries.code, number: sales.invoiceNumber })
       .from(sales).innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId)).where(eq(sales.id, saleId));
     placeResult = { id, status: "placed", invoiceNumber: formatInvoiceNumber(issued!.code, issued!.number),
       issuedAt: fiscal.issuedAt.toISOString(), total: priced.total, qr: fiscal.verificationUrl ?? "",
       vatBreakdown: priced.vatBreakdown.map((v) => ({ rate: v.rate, base: v.base, tax: v.tax })) };
   }
   // …then the open → placed update, the genesis amendment, the order_prep insert, return placeResult.
   ```
   Extract `readLockedLines(tx, id)` (the select of `unit_price_gross`/`quantity`/`vat_rate`/
   `descriptions`/`category` in `line_no` order) so `payWorkingOrder`, `placeOrder` and `collectOrder`
   share one reader. Idempotency: the deferred file sets `working_order_id = id`, so a double-tap place
   collides `sales_working_order_id_key` (23505) — reuse `payWorkingOrder`'s 23505 catch/replay shape, OR
   let the FOR UPDATE on the order serialise it (the second place sees `placed` and returns the read-back
   invoice). Handle the double-place in step 5.

4. **Implement `collectOrder` (Modes I/T at collect).** One transaction: lock the order (must be
   `placed`; a `settled` order idempotently replays the ticket like `payWorkingOrder`), then per mode:
   ```typescript
   export async function collectOrder(deps: TillSaleDeps, cfg: TillConfig, req: PayWorkingOrderRequest, operatorId: string): Promise<TillSaleResult> {
     return withTenant(deps.db, cfg.tenantId, async (tx) => {
       await asAppUser(tx);
       const [locked] = await tx.select({ status: workingOrders.status }).from(workingOrders).where(eq(workingOrders.id, req.id)).for("update");
       if (locked?.status === "settled") return readSettledTicket(deps.backend, tx, cfg, req.id); // idempotent replay
       if (locked === undefined || locked.status !== "placed") throw new AppError("working_order.not_placed", { workingOrderId: req.id });
       const settledAt = deps.clock.now().instant;
       if (cfg.orderFlow === "invoice_first") {
         // The invoice already issued at placing; settle the existing sale + link the tender.
         const [sale] = await tx.select({ id: sales.id }).from(sales)
           .where(and(eq(sales.tenantId, cfg.tenantId), eq(sales.workingOrderId, req.id)));
         /* v8 ignore next */ if (sale === undefined) throw new Error(`collectOrder: placed invoice-first order ${req.id} has no sale`);
         await settleSale(tx, { tenantId: cfg.tenantId, saleId: brandSaleId(sale.id),
           tenders: [{ method: req.tender.method, amount: req.tender.amount, tipAmount: "0.00", settledAt }] });
         await tx.update(workingOrders).set({ status: "settled", settledAt: settledAt.toISOString() }).where(eq(workingOrders.id, req.id));
         return readSettledTicket(deps.backend, tx, cfg, req.id);
       }
       // ticket_then_pay: no fiscal doc yet — file recordSale IMMEDIATE at collect from the locked lines.
       const priced = priceLockedLines(await readLockedLines(tx, req.id));
       const { saleId, fiscal } = await recordSale(tx, deps.backend, { /* …as payWorkingOrder, settlement immediate, workingOrderId = req.id… */ });
       await tx.update(workingOrders).set({ status: "settled", settledAt: settledAt.toISOString() }).where(eq(workingOrders.id, req.id));
       return buildTicket(tx, cfg, saleId, fiscal, priced); // the same read-back payWorkingOrder returns
     });
   }
   ```
   Wrap `collectOrder` in the same 23505 catch/replay as `payWorkingOrder` (a concurrent collect that
   filed/settled first). Extract `buildTicket`/`readSettledTicket` sharing. Run the PGlite dispatch test —
   GREEN.

5. **Add the real-PG idempotency cases (RED, then GREEN).** In `working-order.rls.test.ts`:
   ```typescript
   it("Mode I: a double-tap place files ONE deferred invoice", async () => {
     const cfg = { ...(await modeVenue("invoice_first")) };
     const id = randomUUID();
     await parkOrder({ db: suite.admin }, cfg, { id, lines: [{ productId: cafe.id, quantity: "1" }] });
     const [a, b] = await Promise.all([
       placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR),
       placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR),
     ]).catch(async (e) => { /* one may throw not_open on the loser; assert one sale either way */ return [null, null] as const; });
     expect(await saleCount(id)).toBe(1);      // sales_working_order_id_key = one sale per order
     expect(await registroCount(id)).toBe(1);
   });

   it("Mode T: a double pay at collect replays, one sale", async () => {
     const cfg = await modeVenue("ticket_then_pay");
     const id = randomUUID();
     await parkOrder({ db: suite.admin }, cfg, { id, lines: [{ productId: cafe.id, quantity: "1" }] });
     await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);
     const req = { id, lines: [], tender: { method: "cash" as const, amount: "1.50" } };
     const [r1, r2] = await Promise.all([
       collectOrder({ db: suite.admin, backend, clock }, cfg, req, OPERATOR),
       collectOrder({ db: suite.admin, backend, clock }, cfg, req, OPERATOR),
     ]);
     expect(r1.invoiceNumber).toBe(r2.invoiceNumber);
     expect(await saleCount(id)).toBe(1);
   });
   ```
   Confirm the FOR-UPDATE lock + the 23505 catch/replay (reused from `payWorkingOrder`) give one sale.
   Run — GREEN.

6. **Update `tillConfigFromVenue` and every `TillConfig` literal** across the server tests to set
   `orderFlow` (default `"prepay"` unless the case sets a mode). Run `pnpm --filter @waitron/server
   test:coverage`.

7. **Commit** `feat(server): pay-timing config + three-mode dispatch (invoice-first / ticket-then-pay / prepay)`.

---

## Task 9 — The prep surface: send-to-prep, advance, node-scoped prep-queue view + routes

**Deliverable:** `sendToPrep`/`advancePrep`/`listPrepQueue` (node-scoped, reusing the held-list
mechanism) and the till-api routes; prep advances on any fiscal state; an invalid prep transition is
refused with `order_prep.invalid_transition`.

### Files
- **Modify** `apps/server/src/working-order.ts` — `sendToPrep`, `advancePrep`, `listPrepQueue`,
  `PrepQueueEntry`, `PrepState`.
- **Modify** `apps/server/src/errors.ts` — `order_prep.invalid_transition`.
- **Modify** `apps/server/src/till-api.ts` — `POST /api/working-orders/:id/place`, `/:id/collect`,
  `/:id/prep`, `/:id/cancel`, `GET /api/prep-queue`; STATUS additions.
- **Modify** `apps/server/src/working-order.rls.test.ts` + a till-api test.

### Interfaces
Produces:
```typescript
export type PrepState = "queued" | "preparing" | "ready" | "collected";
export interface PrepQueueEntry { id: string; orderNumber: number; label: string | null; state: PrepState; queuedAt: string; }
export function sendToPrep(deps: WorkingOrderDeps, cfg: TillConfig, id: string): Promise<void>;      // Mode P: enqueue on a settled order
export function advancePrep(deps: WorkingOrderDeps, cfg: TillConfig, id: string, to: PrepState): Promise<void>;
export function listPrepQueue(deps: WorkingOrderDeps, cfg: TillConfig): Promise<PrepQueueEntry[]>;
```
(Modes I/T enqueue at placing inside `placeOrder`; `sendToPrep` is the Mode-P enqueue on a settled
order, since Mode P never places.)

### Steps

1. **Mint `order_prep.invalid_transition` in `apps/server/src/errors.ts`.** Grep siblings: no prep code
   exists; the domain concept is order preparation (`order_prep` table). Consistent with the two-word
   snake `working_order.*` family:
   ```typescript
   /**
    * A prep advance is not legal from the order's current prep state — the target is not the next state
    * (queued → preparing → ready → collected), or the order has no prep record (never sent to prep, or
    * an absent/foreign id RLS hides). A fact about the order's PREP, not the process. Mapped to 409.
    * `order_prep.*` names the domain concept (order preparation), the rule tenant.not_found's note gives.
    */
   "order_prep.invalid_transition": { workingOrderId: string };
   ```

2. **Write the tests (RED).** A real-PG prep-queue case (node-scoping + RLS) and the advance sequence:
   ```typescript
   it("advancePrep walks queued → preparing → ready → collected; an out-of-order jump is refused", async () => {
     const cfg = await modeVenue("prepay");
     const id = randomUUID();
     await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, { id, lines: [{ productId: cafe.id, quantity: "1" }], tender: { method: "cash", amount: "5.00" } }, OPERATOR);
     await sendToPrep({ db: suite.admin }, cfg, id);        // enqueue on the SETTLED order (Mode P)
     await advancePrep({ db: suite.admin }, cfg, id, "preparing");
     await advancePrep({ db: suite.admin }, cfg, id, "ready");
     await expect(advancePrep({ db: suite.admin }, cfg, id, "collected")).resolves.toBeUndefined();
     // Jumping backwards / skipping is refused.
     await expect(advancePrep({ db: suite.admin }, cfg, id, "preparing")).rejects.toMatchObject({ code: "order_prep.invalid_transition" });
   });

   it("listPrepQueue is node-scoped: it lists this node's active prep, not collected, not another node's", async () => {
     const cfg = await modeVenue("ticket_then_pay");
     const id = randomUUID();
     await parkOrder({ db: suite.admin }, cfg, { id, lines: [{ productId: cafe.id, quantity: "1" }], label: "Mesa 7" });
     await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR); // enqueues at queued
     const queue = await listPrepQueue({ db: suite.admin }, cfg);
     expect(queue).toEqual([{ id, orderNumber: expect.any(Number), label: "Mesa 7", state: "queued", queuedAt: expect.any(String) }]);
     await advancePrep({ db: suite.admin }, cfg, id, "preparing");
     await advancePrep({ db: suite.admin }, cfg, id, "ready");
     await advancePrep({ db: suite.admin }, cfg, id, "collected");
     expect(await listPrepQueue({ db: suite.admin }, cfg)).toEqual([]); // collected leaves the active queue
   });
   ```

3. **Implement `sendToPrep`/`advancePrep`/`listPrepQueue`.** `advancePrep` uses a conditional UPDATE (the
   `abandonHeldOrder` pattern) gating on the expected predecessor state, throwing
   `order_prep.invalid_transition` on no match; it stamps the matching `*_at` column. `listPrepQueue`
   joins `order_prep` to `working_orders`, node-scoped like `listHeldOrders`, filtering
   `state in ('queued','preparing','ready')`:
   ```typescript
   const NEXT: Record<PrepState, PrepState | undefined> = { queued: "preparing", preparing: "ready", ready: "collected", collected: undefined };
   export async function advancePrep(deps, cfg, id, to) {
     return withTenant(deps.db, cfg.tenantId, async (tx) => {
       await asAppUser(tx);
       // The one column stamped depends on `to`; the guard is `state = <predecessor of to>`.
       const from = (Object.keys(NEXT) as PrepState[]).find((s) => NEXT[s] === to);
       if (from === undefined) throw new AppError("order_prep.invalid_transition", { workingOrderId: id }); // no state advances TO queued
       const stampCol = { preparing: "preparing_at", ready: "ready_at", collected: "collected_at" }[to];
       const updated = await tx.update(orderPrep)
         .set({ state: to, [stampCol]: sql`now()` })
         .where(and(eq(orderPrep.workingOrderId, id), eq(orderPrep.state, from)))
         .returning({ id: orderPrep.workingOrderId });
       if (updated.length === 0) throw new AppError("order_prep.invalid_transition", { workingOrderId: id });
     });
   }
   ```
   `listPrepQueue`: `select id/order_number/label/state/queued_at from order_prep join working_orders on
   (tenant_id, id) where node_id = cfg.nodeId and state in ('queued','preparing','ready') order by
   queued_at` (node-scoped, RLS confines the tenant — the `listHeldOrders` shape; PGlite proves the
   aggregate/filter, real PG proves the RLS — same split as `listHeldOrders`). `sendToPrep` inserts the
   `order_prep` row `queued` for a settled order (Mode P), refusing if a row already exists (a double
   send-to-prep). Run — GREEN.

4. **Wire the routes in `till-api.ts`.** Add `POST /api/working-orders/:id/place` (→ `placeOrder`),
   `POST /api/working-orders/:id/collect` (→ `collectOrder`), `POST /api/working-orders/:id/prep`
   (body `{ to }` → `advancePrep`, or `{}` → `sendToPrep`), `POST /api/working-orders/:id/cancel`
   (body `{ reason }` → `cancelPlacedOrder`), `GET /api/prep-queue` (→ `listPrepQueue`) — each
   session-guarded, wrapped in `run`, attribution from `session.personId`. Add the new codes to `STATUS`:
   `"working_order.not_placed": 409`, `"order_prep.invalid_transition": 409`. Add a till-api test for one
   route (e.g. place → 200 + placed; place a non-open → 409) mirroring the existing park routes' tests.

5. **Run `pnpm --filter @waitron/server test:coverage`; commit** `feat(server): prep surface — send-to-prep, advance, node-scoped queue + routes`.

---

## Task 10 — Reporting: the Mode-I cutover-straddle VAT/cash split (test only, no code change)

**Deliverable:** a PGlite test pinning that a Mode-I sale whose placing and collect **straddle the
`day_cutover`** reports VAT on the placing business day and cash on the (later) settlement business day —
the §7 consequence made a decision, not a surprise. No reporting code changes.

### Files
- **Modify** `packages/reporting/src/daily-close.test.ts` — add the cutover-straddle case (extends the
  existing coarse "splits an invoice-first sale" case with the fine straddle the spec §7 calls out).

### Interfaces
Consumes `computeDailyClose`, the `seedSale`/`seedTender`/`seedVenue` fixtures. PGlite suffices — the
anchors are deterministic arithmetic over immutable rows (the existing suite's own justification).

### Steps

1. **Write the failing (then passing) test.** The straddle: issued at 04:30 Europe/Madrid (before the
   05:00 cutover → business day D−1) and settled at 05:30 (after cutover → business day D), only an hour
   apart yet on different business days:
   ```typescript
   it("Mode-I straddling the day_cutover: VAT on the placing day, cash on the settlement day", async () => {
     // 04:30 Madrid = 02:30Z (CEST +02:00), business day 2026-08-04 (before the 05:00 cutover).
     // 05:30 Madrid = 03:30Z, business day 2026-08-05 (after the cutover). One hour apart, two days.
     const issued = "2026-08-04T02:30:00.000Z";
     const settled = "2026-08-05T03:30:00.000Z";
     const saleId = await seedSale(suite.db, venue, {
       invoiceNumber: 1, issuedAt: issued, total: "121.00", lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
     });
     await seedTender(suite.db, { tenantId: venue.tenantId, saleId }, { method: "card", amount: "121.00", settledAt: settled });

     const day4 = await run(input({ businessDay: "2026-08-04", dayCutover: "05:00", timeZone: "Europe/Madrid" }));
     expect(day4.vat.byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]); // VAT on the placing day
     expect(day4.cash.byTill).toEqual([]);                                                // no cash yet

     const day5 = await run(input({ businessDay: "2026-08-05", dayCutover: "05:00", timeZone: "Europe/Madrid" }));
     expect(day5.vat.byRate).toEqual([]);            // no VAT on the settlement day
     expect(day5.cash.byTill).toHaveLength(1);       // the cash lands here
     expect(day5.cash.tenderTotal).toBe("121.00");
   });
   ```
   Verify the CEST offset and cutover math in the RED run (adjust the Z instants if the fixture's
   business-day logic rounds differently), then pin the exact figures. This complements — does not
   replace — the existing coarse noon/noon case.

2. **Run `pnpm --filter @waitron/reporting test:coverage`; commit** `test(reporting): pin the Mode-I cutover-straddle VAT/cash split (design §7)`.

---

## Task 11 — Till UI: place / send-to-prep control, prep-queue widget, per-mode pay, i18n (en + es)

**Deliverable:** the counter can place an order, see the node's prep queue and advance it, and the pay
control behaves per the location's mode; new `en`+`es` strings land together.

### Files
- **Modify** `apps/till/src/layout.ts` — `WidgetType` gains `"prep-queue"`.
- **Create** `apps/till/src/widgets/prep-queue.ts` (+ `.test.ts`, `.a11y.test.ts`).
- **Modify** `apps/till/src/widgets/tender-pay.ts` — a Place control (Modes I/T) vs a Pay control (Mode
  P/collect), driven by a `mode`/`stage` property (+ tests).
- **Modify** `apps/till/src/i18n/strings.ts` — new keys.
- **Modify** `apps/till/src/api/client.ts` — the place/collect/prep/prep-queue/cancel calls + the
  `PrepQueueEntry` type (mirroring the existing park/retrieve client methods).

### Interfaces
Consumes the Task 9 routes. Produces the widgets + client methods. `apps/*` is exempt from english-only,
so UI copy is free text; the `en` map is the source of truth and `es` must translate every key (a missing
`es` sibling is a compile error — `strings.ts`'s existing guard).

### Steps

1. **Add the i18n keys first (en + es together — a missing `es` fails typecheck).** In `strings.ts`'s
   `en` and `es` maps:
   ```typescript
   // Placing & prep (7c)
   "action.place": "Place order",           // es: "Enviar pedido"
   "action.send_to_prep": "Send to prep",   // es: "Enviar a cocina"
   "action.collect": "Collect",             // es: "Entregar"
   "prep.title": "Prep queue",              // es: "Cola de preparación"
   "prep.empty": "Nothing in prep",         // es: "Nada en preparación"
   "prep.state.queued": "Queued",           // es: "En cola"
   "prep.state.preparing": "Preparing",     // es: "Preparando"
   "prep.state.ready": "Ready",             // es: "Listo"
   "prep.advance": "Advance",               // es: "Avanzar"
   "cancel.reason_prompt": "Reason for cancelling", // es: "Motivo de la cancelación"
   ```

2. **Write the prep-queue widget test (RED), then the widget.** Model it on `held-orders.ts` (a pure
   view: no store, no API; the app owns the list and hands it down; controls emit composed bubbling
   events). The widget renders each entry's number/label/state with an Advance control that emits
   `advance-prep` carrying `{ id, to }`:
   ```typescript
   @customElement("till-prep-queue")
   export class TillPrepQueue extends LitElement {
     @property({ attribute: false }) entries: PrepQueueEntry[] = [];
     #advance(id: string, to: PrepState): void {
       this.dispatchEvent(new CustomEvent("advance-prep", { detail: { id, to }, bubbles: true, composed: true }));
     }
     override render() {
       return html`<h2 class="title">${t("prep.title")}</h2>${
         this.entries.length === 0 ? html`<p class="empty">${t("prep.empty")}</p>`
         : this.entries.map((e) => html`<div class="row">
             <span class="number">#${e.orderNumber}</span>
             ${e.label ? html`<span class="label">${e.label}</span>` : nothing}
             <span class="state">${t(`prep.state.${e.state}` as StringKey)}</span>
             ${NEXT_LABEL[e.state] ? html`<wt-button @click=${() => this.#advance(e.id, NEXT[e.state]!)}
               aria-label=${`${t("prep.advance")} #${e.orderNumber}`}>${t("prep.advance")}</wt-button>` : nothing}
           </div>`)
       }`;
     }
   }
   ```
   (A `collected` entry never appears — `listPrepQueue` excludes it — so `NEXT_LABEL.ready = "collected"`
   is the last advance shown.) Match the base styles + `baseStyles`/`wt-button` idiom of `held-orders.ts`.
   Add the `.a11y.test.ts` mirroring `held-orders.a11y.test.ts`.

3. **Extend `WidgetType` + a layout** to include `"prep-queue"` in `layout.ts` (add a layout variant or
   append it to `LAYOUT_A`'s `aside`), so the screen can render it. Keep `layout.ts` plain data (the
   existing invariant).

4. **Drive `tender-pay.ts` per mode.** Add a `mode: OrderFlow` and `stage: "order" | "collect"` property;
   render a **Place** button (Modes I/T at the order stage → emits `place-order`), a **Collect** button
   (Modes I/T at the collect stage → emits `collect-order`), or the existing **Pay** button (Mode P →
   emits the existing pay event). Keep the manual-card ref field behaviour. Update `tender-pay.test.ts`
   for the three renderings.

5. **Add the client methods** in `api/client.ts` — `placeOrder(id)`, `collectOrder(id, tender)`,
   `advancePrep(id, to)`, `sendToPrep(id)`, `cancelOrder(id, reason)`, `listPrepQueue()` returning
   `PrepQueueEntry[]` — mirroring the existing `parkOrder`/`retrieveWorkingOrder` methods and their error
   handling.

6. **Run `pnpm --filter @waitron/till test:coverage` (thresholds `95/95/90/88` for UI); commit**
   `feat(till): place / prep-queue / per-mode pay + es strings`.

---

## Self-review

### (1) Spec-coverage — every spec section maps to a task

| Spec § | Requirement | Task(s) |
| --- | --- | --- |
| §2 line-add snapshot | store locked price, file from it | 1 (`unit_price_gross`), 5 (`priceLockedLines`), 6 (`payWorkingOrder` files the lock) |
| §2 consumers 1-2 (code) | `payWorkingOrder` else-branch; `working-order.ts` lock authoritative | 6 |
| §2 comments 3-5 (schema/code false claims) | rewrite, not delete | 1 (schema), 6 (`working-order.ts:76-83`) |
| §2 tests 6-10 | rewrite the broken `:332-361`; reword `:514`/`:708`; `orders.test.ts:494` nuance | 6 (rewrite + rewords); `orders.test.ts:494` nuance folded into Task 1's `orders.ts` comment rewrite — **see gap note** |
| §2 missing test | park → change catalogue price → pay files the lock | 6 |
| §2 desglose subtlety | locked gross + difference method | Decision 1, Tasks 1/5/6 |
| §2 client-basket tension | pay files stored lines, not a client basket | 6 |
| §3 placing | `open → placed`, freeze, issuance basis | 7 |
| §3 two orderings / config / 2×2→3 | `order_flow` enum + dispatch | Decision 3, Tasks 1/8 |
| §3 walk-up unchanged / no log | verified | 7 (walk-up-no-log test), 6 |
| §3 state machine × config table | per-mode primitives | 8 |
| §3 idempotency composes | double-place / double-pay | 8 |
| §4 amendment log — shape, immutability, tenant scope, contents | table + FORCE-RLS + append-only | 1, 3 |
| §4 tamper-evidence (#52) | hash reason/actor/node, local wall-clock, tie-break on hashed seq | Decision 2, Task 3 |
| §4 minimal, additive | two kinds, no chain-head subsystem | Decision 2, Tasks 1/3/7 |
| §5 prep surface / node-scoped view | `order_prep` + `listPrepQueue` | 1, 4, 9 |
| §5 prep on settled order (Mode P) | proven | 4, 9 |
| §5 separate table (rejected column) | `order_prep`, not `working_orders.prep_state` | 1 |
| §5 state machine extension + rewrite by deletion | trigger rewrite proven by deletion | 1, 2 |
| §6 the one migration `0030` | all of it | 1 |
| §6 run inmutabilidad after migration | gate | 1 |
| §7 reporting Mode-I cutover split | test only | 10 |
| §8 composition / foundation-first | this is the foundation branch (documented in the header) | — |
| §9 PGlite vs real-PG per case | applied per task, with justifications | 2/3/4/6/8 (real), 8-dispatch/10 (PGlite) |
| §10 files | mapped in File Structure | all |
| §11 provenance | consumed in the reads that ground each task | all |

**Gap found and filled:** the `packages/db/src/schema/orders.test.ts:494` comment (that `product_id` "is
repriced … a pricing INPUT, not a snapshot") is a §2 item not explicitly stepped. **Fill:** add a step to
Task 1 — when rewriting the `orders.ts` doc comments, also rewrite the `orders.test.ts:494` comment to the
§2 nuance (`product_id` is a pricing input for **new/weighed** lines but no longer implies a re-price of
existing ones), keeping the test's assertions intact. A second minor gap: the spec's "confirm
`updateHeldOrder`'s replace-the-whole-basket still re-locks each surviving line at edit time" (§2 item 2)
— **fill:** Task 6 adds a one-line assertion to the existing update test (`working-order.test.ts:428-439`)
that an edited basket re-locks `unit_price_gross` at edit time (industry-normal), so the re-lock semantics
are pinned, not assumed.

### (2) Placeholder scan

No `TODO`, "similar to Task N", or "add appropriate handling" remains: every step carries runnable test
and implementation code. Three deliberately-marked **implementation choices** are called out for the
engineer to finalise in-task (not placeholders — each states the decision and the fallback): the
`working_order.reason_required`-vs-reuse choice for an empty cancel reason (Task 7 step 4, default: reuse
`not_placed`); the `boot.ts` merge of `readOrderFlow` into `TillConfig` (Task 8 step 1, the composition
root, outside any single unit's TDD loop); and the `[stampCol]` computed-key UPDATE in `advancePrep`
(Task 9 step 3, a Drizzle `.set()` with a dynamic column — if Drizzle's typing rejects the computed key,
fall back to a `sql` fragment `set state = ${to}, ${sql.identifier(stampCol)} = now()`).

### (3) Type consistency

Names defined early match their later uses: `OrderFlow` (`"prepay" | "invoice_first" | "ticket_then_pay"`,
Decision 3 / Task 1's `orderFlow` enum / Task 8's `TillConfig.orderFlow`); `PrepState` (`"queued" |
"preparing" | "ready" | "collected"`, Task 1's `prepState` enum / Task 9's `advancePrep`/`listPrepQueue`);
`orderAmendmentKind` (`"order_placed" | "order_cancelled"`, Task 1 / Task 3's `AmendmentHashInput.kind` /
Task 7's `appendOrderAmendment` calls); `AppendAmendmentInput` (Task 3) carries `eventOffsetMinutes:
number` — the required field Task 7 supplies from `clock.now().offsetMinutes`; `unitPriceGross` (Task 1
column) ↔ `LockedLine.grossUnitPrice` (Task 5, the value read from that column in Task 6) ↔ `priceRows`'s
`grossUnitPrices[]` return (Task 5/6, the source of the stored value); `priceLockedLines` returns
`ReturnType<typeof priceBasket>` so `payWorkingOrder`/`placeOrder`/`collectOrder` consume `priced.total`,
`priced.lines`, `priced.vatBreakdown` identically. One consistency fix applied during review: Task 6 step
1 requires `priceBasket`/`priceRows` to also expose `grossUnitPrices: Decimal[]` (used as the
`unit_price_gross` source) — folded back into Task 5's `priceRows` so the field exists before Task 6
reads it.
