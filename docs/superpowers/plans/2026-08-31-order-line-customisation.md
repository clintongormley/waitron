# Order-Line Customisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free-text `note` ("hold the mayo") to any order line, and a `doneness` choice (rare→well-done) that auto-appears on dishes containing meat — both kitchen instructions that reach the KDS/expo/printed ticket and NEVER enter the fiscal record.

**Architecture:** `note` (text) and `doneness` (enum) live on `working_order_lines`, are snapshotted onto `ticket_items` at fire time (like `station_id`/`course_id`), and are absent from `sale_lines` and `computeHuella`. The doneness picker is gated on the till by the product's derived `diet.contains` including `meat` (from the dietary-classification feature). A huella-invariance test pins that neither field changes the hash.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL 18), Vitest, PGlite + Testcontainers, Lit (till widgets), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-31-order-line-customisation-design.md`

## Global Constraints

- **DEPENDENCY:** Tasks touching **doneness gating** need `TillProduct.diet.contains` from the **dietary-classification plan** (`docs/superpowers/plans/2026-08-31-dietary-classification.md`) already landed. The **`note`** feature is independent — its steps carry no dietary dependency and may proceed first. Doneness-only steps are tagged **[needs dietary]**.
- **Fiscal boundary (load-bearing):** `note`/`doneness` are NON-FISCAL. They must never be threaded into `RecordSaleLine` (`packages/core/src/record-sale.ts:44`), `TillSaleLine` (`apps/server/src/till-sale.ts:115`), `sale_lines` (`packages/db/src/schema/sales.ts:217`), or `computeHuella` (`packages/verifactu/src/huella.ts:99`). (CLAUDE.md §5)
- **Migration numbering:** after rebasing on a `main` that already carries the dietary feature's `0086`, this plan's generated migration will be **`0087_*`** — do NOT hand-number; re-run `db:generate` post-rebase and let drizzle-kit assign it (drizzle-rebase-collision pattern).
- **Additive nullable columns + one new pgEnum on existing RLS tables = plain `db:generate`**, no custom migration — both tables' FORCE RLS/policy/`app_user` grants already cover new columns (0004 for working_order_lines, 0055 for ticket_items). Run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after. (map §1/§2/§8)
- **No backfill / no backwards-compat** (pre-production; CLAUDE.md §3). Existing rows get NULL — correct empty state.
- **Error codes `working_order.*`, domain-named, never renamed** — grep siblings first. (CLAUDE.md §3. Corrected 2026-09-01 in pre-merge review from the `order.*` first written here: the entity's six existing sibling codes are `working_order.*`.)
- **TESTCONTAINERS_RYUK_DISABLED=true** locally; `pnpm reap` after an interrupted run; serialise browser-package coverage runs (till). (CLAUDE.md §4)

### Shared type (defined in Task 1; consumed verbatim later)

```ts
export const DONENESS = ["rare", "medium_rare", "medium", "medium_well", "well_done"] as const;
export type Doneness = (typeof DONENESS)[number];
```

---

## Task 1: Schema — `doneness` enum + `note`/`doneness` columns + migration

**Files:**
- Modify: `packages/db/src/schema/orders.ts:34` (enum), `:142-243` (working_order_lines) — add `note`, `doneness`.
- Modify: `packages/db/src/schema/ticket-items.ts:11` (import the enum), `:37-89` — add `note`, `doneness`.
- Create: `packages/db/drizzle/0087_*.sql` (generated).
- Test: `packages/db/src/schema/orders.test.ts`, `packages/db/src/schema/ticket-items.test.ts`.

**Interfaces:**
- Produces: pgEnum `doneness`; `workingOrderLines.note` (`text`, nullable), `workingOrderLines.doneness` (enum, nullable); `ticketItems.note`, `ticketItems.doneness`.

- [ ] **Step 1: Failing schema test** — `orders.test.ts`: assert `working_order_lines` has nullable `note` (text) and `doneness` (enum `doneness`). Mirror the file's column-introspection style.

```ts
it("working_order_lines carries nullable note + doneness columns", async () => {
  const { rows } = await db.execute(sql`
    select column_name, is_nullable, data_type, udt_name
    from information_schema.columns
    where table_name = 'working_order_lines' and column_name in ('note','doneness')
    order by column_name`);
  expect(rows).toEqual([
    { column_name: "doneness", is_nullable: "YES", data_type: "USER-DEFINED", udt_name: "doneness" },
    { column_name: "note", is_nullable: "YES", data_type: "text", udt_name: "text" },
  ]);
});
```

- [ ] **Step 2: Run, watch fail** — `pnpm --filter @waitron/db test orders` → FAIL.

- [ ] **Step 3: Declare the enum + columns in `orders.ts`** — near line 34, beside `workingOrderStatus`:

```ts
/** How a meat dish is cooked (KDS-only, spec §3). pgEnum over a text CHECK because the values are
 * settled by the spec (same rationale as `working_order_status`). Optional even on meat: a stewed/minced
 * meat line leaves it NULL. */
export const doneness = pgEnum("doneness", ["rare", "medium_rare", "medium", "medium_well", "well_done"]);
```

Inside `working_order_lines` columns, after `optionGroupItemId` (`:213`), mirroring the `courseId`/`servedAt` additive-nullable NON-FISCAL comment:

```ts
    // Free-text kitchen instruction ("hold the mayo"). Additive nullable; working_order_lines' TS-1
    // FORCE-RLS policy + app_user grants already cover it. NON-FISCAL: snapshotted to ticket_items at
    // fire, never read into a filed record (spec §2).
    note: text("note"),
    // How the dish is cooked, for meat dishes (spec §3). NON-FISCAL, same as `note`. NULL = not chosen.
    doneness: doneness("doneness"),
```

Add `text` to the `drizzle-orm/pg-core` import if not already present (it is — `descriptions`/`category` use it).

- [ ] **Step 4: Add the same two columns to `ticket_items.ts`** — import `doneness` from `./orders.js` at `:11` area; after `awayAt` (`:80`), mirroring the `awayAt` additive-nullable comment:

```ts
    // Snapshotted from the working-order line at fire time (like station_id/course_id) so a later line
    // edit never mutates fired kitchen state. NON-FISCAL. (spec §2)
    note: text("note"),
    doneness: doneness("doneness"),
```

- [ ] **Step 5: Generate migration** — `pnpm --filter @waitron/db db:generate`. Inspect `0087_*.sql`: exactly `CREATE TYPE "doneness" AS ENUM (...)` + four `ADD COLUMN` (note/doneness on both tables), no RLS/policy/grant DDL.

- [ ] **Step 6: Run tests + inmutabilidad**

Run: `pnpm --filter @waitron/db test orders ticket` → PASS.
Run: `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/orders.ts packages/db/src/schema/ticket-items.ts packages/db/drizzle/ packages/db/src/schema/orders.test.ts packages/db/src/schema/ticket-items.test.ts
git commit -s -m "feat(db): per-line note + doneness on working_order_lines and ticket_items"
```

---

## Task 2: Wire contract + validation + snapshot at fire

**Files:**
- Modify: `apps/server/src/working-order.ts:115-134` (`priceOrderLines` line param), `:865-1037` (`fireLines` param `:878-883` + snapshot `:1003-1031` + insert `:1037`).
- Modify: `apps/server/src/till-api.ts:796-800`, `:855-858`, `:1423-1434` (the three line-bearing request bodies).
- Modify: `apps/server/src/errors.ts` — add `working_order.note_too_long`, `working_order.invalid_doneness`.
- Test: `apps/server/src/working-order.test.ts`, `apps/server/src/till-api.test.ts`.

**Interfaces:**
- Consumes: Task 1 columns; `DONENESS`/`Doneness` (import from `@waitron/db` where the enum's values are exported, or redefine the tuple in a shared spot — prefer exporting `DONENESS` from the db schema module).
- Produces: `priceOrderLines` line param gains `note?: string; doneness?: Doneness`; `fireLines` threads them; ticket_items rows carry snapshotted values.

- [ ] **Step 1: Failing wire test** — `till-api.test.ts`: a round-send with `{ note: "no onions", doneness: "medium" }` persists them on the `working_order_lines` row; an out-of-enum doneness is rejected `working_order.invalid_doneness`; an over-long note (>200) rejected `working_order.note_too_long`.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Add the error codes** in `apps/server/src/errors.ts` (grep the entity's family first; `server.*` is process-only, and the six existing sibling codes are `working_order.*`, so these are `working_order.*`):

```ts
    "working_order.note_too_long": { length: number; limit: number };
    "working_order.invalid_doneness": { value: string };
```

- [ ] **Step 4: Extend `priceOrderLines`** (`:129-134`) — add `note?: string; doneness?: Doneness` to the line param; validate: trim `note`, `if (note.length > 200) throw new AppError("working_order.note_too_long", {length, limit:200})`; `if (doneness !== undefined && !DONENESS.includes(doneness)) throw new AppError("working_order.invalid_doneness", {value:String(doneness)})`. Carry validated `note`/`doneness` onto the `working_order_lines` insert this function performs.

- [ ] **Step 5: Extend the three till-api bodies** (`:796-800`, `:855-858`, `:1423-1434`) — add optional `note`/`doneness` to each per-line body shape, forwarded into `priceOrderLines`. (The round body `:1423-1434` is the richest; mirror it.)

- [ ] **Step 6: Snapshot at fire** — in `fireLines` add `note`/`doneness` to the `lines` param (`:878-883`), have each caller's line-select include them from `working_order_lines`, and add them to the `values` object (`:1003-1031`) so the `ticket_items` insert (`:1037`) snapshots them.

- [ ] **Step 7: Run tests + coverage** — `pnpm --filter @waitron/server test:coverage` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/working-order.ts apps/server/src/till-api.ts apps/server/src/errors.ts apps/server/src/working-order.test.ts apps/server/src/till-api.test.ts
git commit -s -m "feat(server): accept + validate line note/doneness; snapshot onto ticket_items at fire"
```

---

## Task 3: Fiscal hash-invariance + snapshot-immutability tests (the crux guards)

**Files:**
- Test: `packages/fiscal-verifactu/src/verify.test.ts` (mirror the `entorno` invariance block `:196-225`), and `apps/server/src/working-order.test.ts` (snapshot immutability).

**Interfaces:** consumes Task 1/2 only.

- [ ] **Step 1: Write the huella-invariance test** — mirror `verify.test.ts:213-225`: build two sales identical but for a line's `note`/`doneness`, assert identical `huella`, and assert the two sales are otherwise materially distinct so the test can't pass on a plumbing regression. Because no line data feeds `computeHuella` (map §4), this should pass immediately — it is a **regression guard**, not a red-first test. State that in a comment (a guard that can never have been red still earns its place: it fails the day someone threads a line field into the record).

```ts
describe("line note/doneness are not part of the huella", () => {
  it("two sales differing only in a line note/doneness hash identically", async () => {
    const a = await recordSaleWith({ lineNote: "no mayo", doneness: "rare" });
    const b = await recordSaleWith({ lineNote: "extra mayo", doneness: "well_done" });
    expect(a.huella).toBe(b.huella);
    // and the note/doneness never reached sale_lines:
    const cols = await columnsOf("sale_lines");
    expect(cols).not.toContain("note");
    expect(cols).not.toContain("doneness");
  });
});
```

- [ ] **Step 2: Write the snapshot-immutability test** — `working-order.test.ts`: fire a line, then UPDATE the working_order_line's `note`/`doneness`; assert the already-created `ticket_items` row is unchanged (mirrors the station/course snapshot tests).

- [ ] **Step 3: Run** — `pnpm --filter @waitron/fiscal-verifactu test verify` and `pnpm --filter @waitron/server test working-order` → PASS.

- [ ] **Step 4: Prove the invariance guard by construction** — temporarily thread `note` into the record builder feeding `computeHuella`, confirm the invariance test goes red, revert. Note it in the commit.

- [ ] **Step 5: Commit**

```bash
git add packages/fiscal-verifactu/src/verify.test.ts apps/server/src/working-order.test.ts
git commit -s -m "test: pin line note/doneness out of the huella + snapshot-immutable on ticket_items"
```

---

## Task 4: Till state + line-configuration UI (note box + gated doneness picker)

**Files:**
- Modify: `apps/till/src/state/working-order.ts:40-71` (`OrderLine`), `:238-241` (`addProduct`).
- Modify: `apps/till/src/state/order-line.ts` (wire mapping) + the line-payload builders in `apps/till/src/till-app.ts` (~800) and `till-table-order-screen.ts` round builder.
- Modify: `apps/till/src/widgets/modifier-picker.ts:19-22` (`ModifierConfirmDetail`), `:139-190` (render/state) — add note `<textarea>` + doneness `<select>` **[needs dietary]** gated on `product.diet?.contains.includes("meat")`.
- Test: `apps/till/src/widgets/modifier-picker.test.ts` (+ a11y), `apps/till/src/state/working-order.test.ts`, `apps/till/src/state/order-line.test.ts`.

**Interfaces:**
- Consumes: `Doneness` (local redefinition in `client.ts`, like the other local till types); `TillProduct.diet` (dietary plan) for gating.
- Produces: `OrderLine.note?: string`, `OrderLine.doneness?: Doneness`; `addProduct(product, quantity, options?, extras?: { note?; doneness? })`; `ModifierConfirmDetail` gains `note?`/`doneness?`.

- [ ] **Step 1: Add local `Doneness` + `OrderLine` fields** — `client.ts`: `export type Doneness = "rare"|"medium_rare"|"medium"|"medium_well"|"well_done";`. `working-order.ts` `OrderLine` (`:59-71`): add `note?: string; doneness?: Doneness;`.

- [ ] **Step 2: Failing state test** — `working-order.test.ts`: `addProduct(p, "1", undefined, { note: "no mayo", doneness: "medium" })` attaches both to the line; the wire builder forwards them.

- [ ] **Step 3: Run, watch fail.**

- [ ] **Step 4: Extend `addProduct`** (`:238-241`) — add an `extras?: { note?: string; doneness?: Doneness }` param; attach `line.note`/`line.doneness` when present (omit the keys otherwise, matching the `options` omission pattern). Forward through the `till-app.ts`/`till-table-order-screen.ts` line-payload builders into the wire body.

- [ ] **Step 5: Failing UI test** — `modifier-picker.test.ts`: the picker shows a note textarea for any product; shows the doneness select ONLY when `product.diet.contains` includes `"meat"`; the confirm event carries `note`/`doneness`. **[doneness half needs dietary]**

- [ ] **Step 6: Run, watch fail.**

- [ ] **Step 7: Implement in `modifier-picker.ts`** — add `note` state + a `<textarea maxlength=200>` (always shown); add `doneness` state + a `<select>` over `DONENESS` shown when `this.product.diet?.contains?.includes("meat")` **[needs dietary]**; include both in `ModifierConfirmDetail` (`:19-22`) and the `modifier-confirm` emit. i18n the labels (`doneness.rare` … `doneness.well_done`, `line.note.placeholder`). `e.stopPropagation()` on the confirm emit.

- [ ] **Step 8: Run tests + a11y + coverage** — `pnpm --filter @waitron/till test:coverage` (serialise browser runs) → PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/till/src
git commit -s -m "feat(till): per-line note box + meat-gated doneness picker; thread to wire"
```

---

## Task 5: KDS / expo / kitchen-ticket rendering

**Files:**
- Modify: `apps/server/src/working-order.ts:3321-3358` (`listStationQueue` select + `StationQueueItem` `:3136-3170` + row-map `:3453`), `:3582` (`listExpoQueue` + `ExpoQueueItem` + row-map `:3773`).
- Modify: `apps/server/src/kitchen-print.ts:148-247` (line read + `KitchenTicketItem` assembly), `apps/server/src/kitchen-ticket.ts:38-82` (`KitchenTicketItem` type + `emitItem`).
- Modify: `apps/till/src/widgets/station-queue.ts:180-213` (render), `apps/till/src/screens/till-expo-screen.ts`.
- Test: the corresponding `*.test.ts` + `*.a11y.test.ts`.

**Interfaces:** consumes the snapshotted `ticket_items.note`/`doneness` (Task 1/2) and the queue reads.

- [ ] **Step 1: Failing server-read test** — `working-order.test.ts`: `listStationQueue`/`listExpoQueue` return `note`/`doneness` for a fired line that had them.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Thread note/doneness onto the reads** — add them to the `StationQueueItem`/`ExpoQueueItem` types and each `.select({...})` (reading the snapshotted `ticket_items` columns, or the joined line — prefer `ticket_items` for snapshot fidelity) and row-maps.

- [ ] **Step 4: Failing ticket-render test** — `kitchen-ticket.test.ts`: `emitItem` prints the doneness and note as indented sub-lines beneath `qty x name` (same shape as `+ <modifier>`).

- [ ] **Step 5: Implement kitchen-ticket + print** — add `note`/`doneness` to `KitchenTicketItem` (`kitchen-ticket.ts:38-42`), print them in `emitItem` (`:79-82`); include them in the `enqueueKitchenTickets` assembly (`kitchen-print.ts:242-247`) from the line read (`:148-158`).

- [ ] **Step 6: Client KDS render** — `station-queue.ts` (and expo screen): render doneness prominently (cooks need it) + note as sub-text beside the modifiers list (`:180-213`). i18n labels reused from Task 4.

- [ ] **Step 7: Run tests + a11y + coverage** — `pnpm --filter @waitron/server test:coverage`, `pnpm --filter @waitron/till test:coverage` (serialise) → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src apps/till/src
git commit -s -m "feat(kds): render line note + doneness on station queue, expo, and kitchen ticket"
```

---

## Task 6: Whole-workspace gate + backlog

- [ ] **Step 1: Full gate** — `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, then `test:coverage` for db, server, fiscal-verifactu, till (serialise browser), then `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`. Fix red.

- [ ] **Step 2: Update `docs/backlog.md`** — record note+doneness landed; note doneness gating consumed the dietary `meat` origin. Commit `-s`.

- [ ] **Step 3: Finish the branch** — the `finish-branch` flow (simplify + two-reviewer + base-to-tip review + rebase + PR + CI/Copilot), per CLAUDE.md §6.

---

## Self-review notes (author)

- **Spec coverage:** note on any line (Task 1/2/4/5), doneness auto for meat (Task 1/2/4 gating, 5 render), fiscal boundary + huella invariance (Task 3), snapshot at fire (Task 2) + immutability (Task 3), optional doneness even for meat (nullable column Task 1, no required-ness in Task 4). ✓
- **Type consistency:** `DONENESS`/`Doneness` defined once (Task 1), consumed in 2/4/5; `OrderLine.note/doneness`, `addProduct` extras param, `ModifierConfirmDetail` fields stable. ✓
- **Dependency honesty:** doneness gating steps tagged **[needs dietary]**; the note feature is independent and could ship without the dietary plan. ✓
- **Migration:** `0087` after rebasing on dietary's `0086` — regenerate, don't hand-number. ✓
```
