# Counter POS 7b — Park & Retrieve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the counter till's working order and share it across registers on one server — park an order, retrieve it from any till, edit it, and pay it — and land the server-side sale-idempotency guard the 7a review deferred.

**Architecture:** The working order becomes a DB row (`working_orders` + `working_order_lines`, already fully RLS-provisioned by migration 0004). The client mints a stable working-order id per basket; **park / update / pay** all send `{ productId, quantity }` and the server prices authoritatively. A parked order stores `product_id + quantity` so any till can rebuild the basket and **re-price at pay** (current prices). `sales.working_order_id` (new, nullable, UNIQUE) makes a lost-response pay retry an idempotent replay instead of a second chained fiscal record.

**Tech Stack:** TypeScript (ESM), Drizzle ORM + PostgreSQL 18, `drizzle-kit generate --custom` migrations, Hono (server routes), Lit 3 (`apps/till`), Vitest (+ `@vitest/browser` playwright for the till, Testcontainers for real-PG), pnpm workspace.

## Global Constraints

- **This is the base branch** (`feat/counter-pos-park-retrieve`). The manual-card slice (`2026-08-05-counter-pos-card-tender.md`) rebases on it; do not build card tender here.
- **Coverage thresholds:** 98/98/98/95 (statements/lines/functions/branches) in every package except `@waitron/ui` (95/95/90/88) and `@waitron/till` (95/95/90/88, `apps/till/vitest.config.ts`). Run `pnpm --filter <pkg> test:coverage`, not `test` — CI shards run coverage (`CLAUDE.md` §2).
- **Real Postgres, not PGlite, for anything about RLS, the non-superuser deployment role, or concurrency.** PGlite is a superuser and serialises queries onto one backend, so a concurrency test there is a false pass (`CLAUDE.md` §4). Set `TESTCONTAINERS_RYUK_DISABLED=true` locally or container suites hang to the 180s timeout.
- **Error codes name the DOMAIN CONCEPT, never the package** (`series.not_found`, not `db.series_not_found`); every file that throws a code does `import "./errors.js"`; grep siblings before inventing a code; codes are **never renamed once shipped** (`CLAUDE.md` §3).
- **Never widen a grant to make a test pass.** A new `tenant_id`-bearing table needs FORCE RLS + a tenant-isolation policy + grants, hand-written in the custom migration (`CLAUDE.md` §3).
- **Spanish schema tokens** go in `SPANISH_WORDS` (`packages/db/src/english-only.ts`); everything this plan adds (`order_number`, `label`, `product_id`, `working_order_counters`, `next_number`) is English, so no addition is needed — but `apps/*` is out of the guard's scope anyway.
- **`git commit -s` on every commit** (DCO). Branch off an up-to-date `main`.
- **Run the whole package unfiltered before believing a pass** — a name-filtered run skips a package's cross-cutting guard suites (`CLAUDE.md` §2, §4). After the migration, run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (the guard that catches a missing FORCE on a new tenant-scoped table lives in that package, `CLAUDE.md` §3).

---

## File Structure

- `packages/db/src/schema/orders.ts` — add `orderNumber`, `label` to `workingOrders`; add `productId` to `workingOrderLines`; revise the `orders.ts:87` "no product column" note (§6 of the spec).
- `packages/db/src/schema/sales.ts` — add nullable `workingOrderId` + composite FK + `UNIQUE`.
- `packages/db/src/schema/catalogue.ts` — add `UNIQUE(tenant_id, id)` to `products` (composite FK target).
- `packages/db/src/schema/working-order-counters.ts` — **new** `working_order_counters` table.
- `packages/db/drizzle/00NN_*.sql` — **one** custom migration carrying every DDL above (FORCE RLS/policy/grant for the counter table, composite FKs, UNIQUEs).
- `packages/db/src/allocate-order-number.ts` — **new** `allocateOrderNumber(tx, tenantId, nodeId)` (mirrors `allocate-number.ts`).
- `packages/db/src/index.ts` — export the new table + allocator.
- `packages/core/src/record-sale.ts` — make `workingOrderId` optional; write it onto the `sales` row.
- `packages/core/src/record-correction.ts`, `record-substitution.ts`, `packages/core/test/fixtures.ts`, and the four `apps/server/scripts/*.ts` demos — drop the now-optional `workingOrderId` (they have no working order → NULL).
- `apps/server/src/working-order.ts` — **new** module: `parkOrder`, `listHeldOrders`, `getHeldOrder`, `updateHeldOrder`, `abandonHeldOrder`, and the idempotent `payWorkingOrder` used by the sale route.
- `apps/server/src/till-api.ts` — mount `/api/working-orders` routes; route `POST /api/sales` through `payWorkingOrder`.
- `apps/server/src/errors.ts` — any new `sale.*` / `working_order.*` codes.
- `apps/till/src/state/working-order.ts` — a stable client-minted id + `loadFrom` / id reset.
- `apps/till/src/api/client.ts` — `parkOrder` / `listWorkingOrders` / `retrieveWorkingOrder` / `updateWorkingOrder` / `abandonWorkingOrder`; thread `workingOrderId` into `recordSale`.
- `apps/till/src/widgets/held-orders.ts` — **new** widget; `apps/till/src/layout.ts` + `screens/till-counter-screen.ts` — the layout seam.
- `apps/till/src/widgets/tender-pay.ts` (or the counter screen) — a **Hold/Park** control + label prompt.
- `apps/till/src/till-app.ts` — handlers for `park-order`, `retrieve-order`, `discard-order`.
- `apps/till/src/i18n/strings.ts` — new keys (`en` + `es` together).
- `apps/server/scripts/park-retrieve-demo.ts` (or extend `demo:till`) + a real-PG e2e suite.

---

## Task 1: DB migration + schema

**Files:**
- Modify: `packages/db/src/schema/orders.ts`, `packages/db/src/schema/sales.ts`, `packages/db/src/schema/catalogue.ts:52-79`
- Create: `packages/db/src/schema/working-order-counters.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/drizzle/00NN_park_retrieve.sql` (via `pnpm --filter @waitron/db exec drizzle-kit generate --custom --name park_retrieve`, then hand-write)
- Test: `packages/db/src/schema/park-retrieve.rls.test.ts`

**Interfaces:**
- Produces: `workingOrders.orderNumber` (`integer` NOT NULL), `workingOrders.label` (`text` nullable); `workingOrderLines.productId` (`uuid` NOT NULL, composite FK to `products`); `sales.workingOrderId` (`uuid` nullable, composite FK to `workingOrders`, `UNIQUE(tenant_id, working_order_id)`); `workingOrderCounters` table `(tenantId, nodeId, nextNumber)`.

- [ ] **Step 1: Write the failing RLS/constraint test.** Use `useRealPostgres` (`@waitron/db/testing/lifecycle.js`) — this is RLS + a new tenant table, so PGlite is a false pass. Model it on an existing `*.rls.test.ts` in `packages/db` (find one with `grep -l "FORCE ROW LEVEL\|current_tenant_id\|asAppUser" packages/db/src/**/*.rls.test.ts`). Assert, as the non-superuser app role under `withTenant`:

```ts
// working_order_counters is FORCE-RLS + tenant-isolated: tenant B cannot see tenant A's counter row.
// Prove by deletion of the policy is out of scope here; prove isolation by cross-tenant read returning none.
// 1. sales.working_order_id is UNIQUE per tenant: two sales rows with the same (tenant, working_order_id) collide.
// 2. working_order_lines.product_id FK: a line pointing at a non-existent product is rejected (23503).
// 3. products now has UNIQUE(tenant_id, id).
```

Write concrete assertions: insert a `working_order_counters` row for tenant A; set tenant B; `select` returns zero rows. Insert two `sales` sharing `working_order_id` → expect the second to throw `23505`. Insert a `working_order_lines` row with a random `product_id` → expect `23503`.

- [ ] **Step 2: Run it, watch it fail** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test park-retrieve.rls` → FAIL (columns/table/constraints absent).

- [ ] **Step 3: Update the Drizzle schema.**
  - `schema/working-order-counters.ts` (new): a `pgTable("working_order_counters", { tenantId, nodeId, nextNumber })` with PK `(tenantId, nodeId)` and `.enableRLS()`. Mirror `catalogue.ts`'s import block and the composite-PK style. Comment that FORCE + policy + grant are in the custom migration (Drizzle emits only ENABLE).
  - `schema/orders.ts`: add `orderNumber: integer("order_number").notNull()` and `label: text("label")` to `workingOrders`; add `productId: uuid("product_id").notNull()` to `workingOrderLines` **plus** the composite FK in its `extraConfig` `foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id], name: "working_order_lines_product_fk" }).onDelete("restrict")`. Revise the "deliberately no product or menu-item column" comment (orders.ts:87) per spec §6 — do **not** delete it; state that the FILED `sale_lines` remain snapshot-based and this reference is a pricing input on the mutable draft.
  - `schema/sales.ts`: add `workingOrderId: uuid("working_order_id")` (nullable, bare column — the FK is composite in `extraConfig`), the composite FK `(tenantId, workingOrderId) → workingOrders(tenantId, id)` MATCH SIMPLE (mirror `sales_corrects_fk`, `sales.ts:158-162`), and `unique("sales_working_order_id_key").on(t.tenantId, t.workingOrderId)`.
  - `schema/catalogue.ts`: add `unique("products_tenant_id_key").on(t.tenantId, t.id)` to `products`'s `extraConfig`.
  - `index.ts`: export `workingOrderCounters`.

- [ ] **Step 4: Generate + hand-write the migration.** Run `pnpm --filter @waitron/db exec drizzle-kit generate --custom --name park_retrieve`. In the generated `.sql`, hand-write (mirroring `0027_light_smiling_tiger.sql` verbatim for the idiom, and `0004_working_orders.sql:44-98` for FORCE/policy/grant):

```sql
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_key" UNIQUE ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "working_orders" ADD COLUMN "order_number" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "working_orders" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD COLUMN "product_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD CONSTRAINT "working_order_lines_product_fk"
  FOREIGN KEY ("tenant_id","product_id") REFERENCES "products"("tenant_id","id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "working_order_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_working_order_fk"
  FOREIGN KEY ("tenant_id","working_order_id") REFERENCES "working_orders"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_working_order_id_key" UNIQUE ("tenant_id","working_order_id");--> statement-breakpoint
CREATE TABLE "working_order_counters" (
  "tenant_id" uuid NOT NULL,
  "node_id" uuid NOT NULL,
  "next_number" integer NOT NULL DEFAULT 1,
  CONSTRAINT "working_order_counters_pk" PRIMARY KEY ("tenant_id","node_id")
);--> statement-breakpoint
ALTER TABLE "working_order_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "working_order_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "working_order_counters_tenant_isolation" ON "working_order_counters"
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "working_order_counters" TO app_user;
```

(NOTE: leave `working_orders`' existing `node_id` FK and grants alone — they exist. `working_order_counters` has a `node_id` but **no** FK to `nodes` is required; it is a counter keyed by node, and a composite FK would need `nodes` unchanged — add `FOREIGN KEY ("tenant_id","node_id") REFERENCES "nodes"("tenant_id","id")` if `nodes` exposes that composite unique; check `schema/nodes.ts` and match whatever `working_orders_node_fk` targets, else omit and rely on RLS.)

- [ ] **Step 5: Run the schema test to green** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test park-retrieve.rls` → PASS.

- [ ] **Step 6: Prove the inmutabilidad guard sees the new table** — `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` → PASS (it scans every `tenant_id`-bearing table for FORCE RLS; `working_order_counters` must not fail it). If it fails, the FORCE line is missing.

- [ ] **Step 7: Full package + typecheck** — `pnpm --filter @waitron/db test:coverage` and `pnpm --filter @waitron/db typecheck` → PASS. Run `@waitron/db` **unfiltered** so its tree-wide guards load.

- [ ] **Step 8: Commit** — `git add -A && git commit -s -m "feat(db): park/retrieve schema — working-order columns, sale idempotency key, order-number counter"`

---

## Task 2: Order-number allocator

**Files:**
- Create: `packages/db/src/allocate-order-number.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/allocate-order-number.test.ts` (PGlite for the happy path) + assertions inside a real-PG suite for concurrency (fold into Task 7's concurrency test, or a `packages/db` `*.rls.test.ts`).

**Interfaces:**
- Produces: `allocateOrderNumber(tx: Transaction, tenantId: string, nodeId: string): Promise<number>` — upserts the `(tenant, node)` counter, increments, returns the new value; first call returns 1.

- [ ] **Step 1: Write the failing test** (mirror `allocate-number.test.ts`, PGlite happy path):

```ts
it("allocates 1, then 2, for a (tenant, node)", async () => {
  await withTenant(db, tenantA, async (tx) => {
    await asAppUser(tx);
    expect(await allocateOrderNumber(tx, tenantA, nodeA)).toBe(1);
    expect(await allocateOrderNumber(tx, tenantA, nodeA)).toBe(2);
  });
});
it("numbers each (tenant, node) independently", async () => { /* nodeB starts at 1 */ });
```

- [ ] **Step 2: Run → FAIL** (`allocateOrderNumber` not defined).

- [ ] **Step 3: Implement.** Use an `INSERT … ON CONFLICT DO UPDATE … RETURNING` so the first call creates the row at 1 and subsequent calls increment atomically (the row lock serialises concurrent callers — the `allocate-number.ts:51-62` guarantee, extended with the upsert):

```ts
export async function allocateOrderNumber(
  tx: Transaction, tenantId: string, nodeId: string,
): Promise<number> {
  const [row] = await tx
    .insert(workingOrderCounters)
    .values({ tenantId, nodeId, nextNumber: 1 })
    .onConflictDoUpdate({
      target: [workingOrderCounters.tenantId, workingOrderCounters.nodeId],
      set: { nextNumber: sql`${workingOrderCounters.nextNumber} + 1` },
    })
    .returning({ allocated: workingOrderCounters.nextNumber });
  // ON CONFLICT DO UPDATE RETURNING yields the NEW row: 1 on first insert, then the incremented value.
  return row!.allocated;
}
```

Export from `index.ts`.

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(db): allocateOrderNumber — race-free per-(tenant,node) counter"`

---

## Task 3: `recordSale` persists `working_order_id`

**Files:**
- Modify: `packages/core/src/record-sale.ts` (the `RecordSaleInput` type + the `sales` insert, ~line 78 and ~266-283)
- Modify (drop the now-optional arg): `packages/core/src/record-correction.ts`, `packages/core/src/record-substitution.ts`, `packages/core/test/fixtures.ts`, `apps/server/scripts/{catalogue-demo,settle-invoice-first,record-one-sale,daily-close-demo}.ts`
- Test: `packages/core/src/record-sale.test.ts` (add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `RecordSaleInput.workingOrderId?: WorkingOrderId` (now **optional**); when supplied, `recordSale` writes it to `sales.working_order_id`; when omitted, the column is NULL.

- [ ] **Step 1: Write the failing tests** in `record-sale.test.ts`. The linkage needs a real `working_orders` row (the FK), so use the real-PG target if the suite has one, else `describeEachTarget`; on PGlite the FK is still enforced (superuser, but constraints hold):

```ts
it("writes working_order_id onto the sale when supplied", async () => {
  // create an open working_orders row with id woId first (FK target), then:
  const { saleId } = await recordSale(tx, backend, { ...input, workingOrderId: woId });
  const [row] = await tx.select({ wo: sales.workingOrderId }).from(sales).where(eq(sales.id, saleId));
  expect(row!.wo).toBe(woId);
});
it("leaves working_order_id NULL when omitted", async () => {
  const { saleId } = await recordSale(tx, backend, inputWithoutWorkingOrderId);
  const [row] = await tx.select({ wo: sales.workingOrderId }).from(sales).where(eq(sales.id, saleId));
  expect(row!.wo).toBeNull();
});
```

- [ ] **Step 2: Run → FAIL** (column not written / `workingOrderId` still required so the omit case won't typecheck).

- [ ] **Step 3: Implement.** In `RecordSaleInput`, change `workingOrderId: WorkingOrderId` → `workingOrderId?: WorkingOrderId`. In the `sales` insert (record-sale.ts:266-283) add `workingOrderId: input.workingOrderId ?? null,`. **Trace every other caller** and drop the argument (they have no working order, so NULL is correct):
  - `record-correction.ts`, `record-substitution.ts`: remove the `workingOrderId: workingOrderId(randomUUID())` line from the `RecordSaleInput` they build (and the now-unused import).
  - `apps/server/scripts/{catalogue-demo,settle-invoice-first,record-one-sale,daily-close-demo}.ts`: same removal.
  - `packages/core/test/fixtures.ts`: drop `workingOrderId` from the default input builder (tests that need linkage pass it explicitly with a real row).
  Grep to confirm none remain: `grep -rn "workingOrderId" packages/core/src apps/server/scripts` — the only surviving producers should be the till path (Task 4/7) and the two new tests.

- [ ] **Step 4: Run → PASS**, then `pnpm --filter @waitron/core test:coverage` and `pnpm --filter @waitron/server test:coverage` (the scripts live there) → PASS. Also re-run `pnpm --filter @waitron/fiscal-verifactu test:coverage` — its write-path fixtures call `recordSale` (they appeared in the import scan); if any pinned a `workingOrderId`, update them.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(core): recordSale persists optional working_order_id; non-till callers pass none"`

---

## Task 4: Working-order module — park

**Files:**
- Create: `apps/server/src/working-order.ts`
- Modify: `apps/server/src/errors.ts` (register any new codes)
- Test: `apps/server/src/working-order.test.ts` (PGlite for the state machine; a real-PG `*.rls.test.ts` in Task 7 for isolation/concurrency)

**Interfaces:**
- Consumes: `allocateOrderNumber` (Task 2); `priceBasket`, `listAvailableProducts` (`@waitron/catalogue`); `withTenant`, `asAppUser`, `workingOrders`, `workingOrderLines` (`@waitron/db`); `TillConfig` (`tenantId, tillId, nodeId, locationId`).
- Produces: `parkOrder(deps, cfg, req): Promise<{ id: string; orderNumber: number }>` where `req = { id: string; lines: { productId: string; quantity: string }[]; label?: string; operatorId?: string }`. `deps = { db }`.

- [ ] **Step 1: Write the failing test.**

```ts
it("parks an open working order with a number and its priced lines", async () => {
  const id = crypto.randomUUID();
  const { orderNumber } = await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "2" }], label: "John" });
  expect(orderNumber).toBe(1);
  const [wo] = await db-scoped select ... where working_orders.id = id;
  expect(wo).toMatchObject({ status: "open", label: "John", nodeId: cfg.nodeId, tillId: cfg.tillId });
  // its lines carry product_id + quantity + the display snapshot
  const lines = ... working_order_lines where working_order_id = id;
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ productId: cafeId, quantity: "2" });
});
it("refuses an empty basket (sale.empty_basket) and an unknown product (sale.unknown_product)", ...);
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `parkOrder`** — one `withTenant`/`asAppUser` tx: refuse empty basket (`sale.empty_basket`); `listAvailableProducts(tx, cfg.locationId)` → map by id, refuse unknown (`sale.unknown_product`, reusing the till-sale codes so no new code is invented — verify they exist in `errors.ts`); `priceBasket(items)`; `allocateOrderNumber(tx, cfg.tenantId, cfg.nodeId)`; insert the `working_orders` row (`id: req.id`, `status: "open"`, `orderNumber`, `label: req.label ?? null`, `tenantId`, `tillId`, `nodeId`); insert `working_order_lines` from `priced.lines` **plus** `productId` and `quantity` per line (the display snapshot columns come straight from `priced.lines`). Return `{ id: req.id, orderNumber }`.

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): parkOrder — persist an open working order with its priced lines"`

---

## Task 5: Working-order module — list + retrieve

**Files:** Modify `apps/server/src/working-order.ts`; Test `apps/server/src/working-order.test.ts`.

**Interfaces:**
- Produces:
  - `listHeldOrders(deps, cfg): Promise<{ id, orderNumber, label, itemCount, total, openedAt }[]>` — the `open` orders for `(tenantId, nodeId)`, `total = sum(line_total)`, newest or number-ordered.
  - `getHeldOrder(deps, cfg, id): Promise<{ id, orderNumber, label, lines: { productId, quantity }[] }>` — throws `working_order.not_found` if absent or not `open`.

- [ ] **Step 1: Write the failing test** — park two orders, `listHeldOrders` returns both with correct `itemCount`/`total`/`label`; `getHeldOrder` returns line `{ productId, quantity }` pairs; an unknown id throws `working_order.not_found`; a settled/abandoned id is not listed and 404s on retrieve.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** `listHeldOrders`: select `working_orders` joined to a `sum(line_total)`/`count(*)` sub-aggregate on `working_order_lines`, `where status = 'open'` (RLS already scopes tenant; add `and node_id = cfg.nodeId`). `getHeldOrder`: select the row (`status = 'open'`) + its lines' `productId`/`quantity`; throw `working_order.not_found` when the row is missing. **Register `working_order.not_found` in `errors.ts`** — grep first (`grep -rn "not_found" apps/server/src/errors.ts`), name the domain concept (`working_order.not_found`, not `server.*`), add `import "./errors.js"` at the top of `working-order.ts`, and map it to 404 in `till-api.ts`'s `STATUS` in Task 8.

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): listHeldOrders + getHeldOrder for the cross-till held list"`

---

## Task 6: Working-order module — update + abandon

**Files:** Modify `apps/server/src/working-order.ts`; Test `apps/server/src/working-order.test.ts`.

**Interfaces:**
- Produces:
  - `updateHeldOrder(deps, cfg, id, req): Promise<void>` — re-price `req.lines`, replace `working_order_lines`, update `label`; only while `open` (throw `working_order.not_open` otherwise).
  - `abandonHeldOrder(deps, cfg, id): Promise<void>` — `open → abandoned` (the DB trigger enforces the transition; a non-`open` order throws `working_order.not_open`).

- [ ] **Step 1: Write the failing test** — update replaces lines and re-prices (total changes); update of a settled order throws `working_order.not_open`; abandon flips status to `abandoned` and removes it from `listHeldOrders`; abandon of an already-terminal order throws `working_order.not_open`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** `updateHeldOrder`: in one tx, load the row `for update`; if not `open` throw `working_order.not_open` (new code — register it, map to 409 in Task 8); delete its `working_order_lines`; re-price `req.lines` (same refuse-unknown path as park); re-insert lines; update `label`. `abandonHeldOrder`: `update working_orders set status='abandoned' where id and status='open'`; if no row updated, throw `working_order.not_open`. The `working_orders_enforce_transition` trigger (0004) is the DB backstop.

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): updateHeldOrder + abandonHeldOrder (open-only, trigger-backed)"`

---

## Task 7: Working-order module — idempotent pay-settle (the core)

**Files:** Modify `apps/server/src/working-order.ts`, `apps/server/src/till-sale.ts`; Test `apps/server/src/working-order.rls.test.ts` (**real Postgres** — concurrency).

**Interfaces:**
- Consumes: `recordSale` (Task 3), `priceBasket`.
- Produces: `payWorkingOrder(deps, cfg, req, operatorId?): Promise<TillSaleResult>` where `req = { id: string; lines: { productId, quantity }[]; tender: { method: "cash"; amount: string } }`. Replaces the body of `recordTillSale`; a walk-up passes a fresh client id, a parked order passes its id.

- [ ] **Step 1: Write the failing real-PG tests** (use `useRealPostgres`; `TESTCONTAINERS_RYUK_DISABLED=true`):

```ts
it("walk-up: creates an open working order, files, and settles it in one tx", async () => {
  const id = crypto.randomUUID();
  const res = await payWorkingOrder({ db, backend, clock }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }], tender: { method: "cash", amount: "5.00" } });
  expect(res.invoiceNumber).toBe("A/1");
  // working order is settled; exactly one sale references it
  ...expect status "settled"; expect one sales row with working_order_id = id
});
it("parked: pays an existing open order at CURRENT prices and settles it", ...);
it("idempotent replay: a second pay with the same id returns the SAME ticket and files no second record", async () => {
  const id = crypto.randomUUID();
  const a = await payWorkingOrder(...id...);
  const b = await payWorkingOrder(...id...);   // retry
  expect(b.invoiceNumber).toBe(a.invoiceNumber);
  // exactly ONE registros_facturacion row for this working order
});
it("concurrent double-pay files ONE sale (two connections, same id)", async () => {
  // two payWorkingOrder calls on distinct connections racing on one id → one succeeds, one replays; one sale total
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `payWorkingOrder`** in one `withTenant`/`asAppUser` tx:
  1. `select … from working_orders where id = req.id for update` (lock; RLS scopes tenant).
  2. If it exists and `status = 'settled'` → **idempotent replay**: read back its sale (`sales where working_order_id = req.id`) and return the `TillSaleResult` shape (re-read invoice number + series like `recordTillSale` does at `till-sale.ts:136-149`). File nothing.
  3. If it does not exist → create it `open` (walk-up): `allocateOrderNumber`, insert `working_orders` + priced `working_order_lines` (the park path, extracted into a shared helper).
  4. If it exists and `status = 'open'`, or was just created → price `req.lines`, compute cash coverage (`till-sale.ts:99-100`), `recordSale(tx, backend, { …, workingOrderId: req.id, settlement: { kind: "immediate", tenders: [...] } })`, then `update working_orders set status='settled', settled_at=now where id=req.id` (trigger validates).
  5. On a `23505` unique violation from the `sales_working_order_id_key` (a concurrent pay beat this one), catch it and fall through to the replay branch (re-read and return the winner's sale) — the concurrent backstop (spec §3).
  6. Return the `TillSaleResult` (invoice number, issuedAt, total, vatBreakdown, change, qr).

  Then **rewrite `recordTillSale`** (`till-sale.ts:61-151`) to delegate to `payWorkingOrder` (it becomes the walk-up special case: mint an id if the caller sent none, keep the empty-basket + cash-only guards). Preserve its `TillSaleRequest`/`TillSaleResult` exports so `till-api.ts` is unaffected until Task 8.

- [ ] **Step 4: Run → PASS** (all four). Prove the guard by deletion: temporarily drop the `for update` **and** the `23505` catch → the concurrent test double-files; restore both.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): payWorkingOrder — idempotent settle over a persisted working order"`

---

## Task 8: Till API routes

**Files:** Modify `apps/server/src/till-api.ts`; Test `apps/server/src/till-api.realpg.test.ts` (rename the existing one-off `.realpg.test.ts` to `.rls.test.ts` per the 7a backlog Minor while you are here, or add to it).

**Interfaces:**
- Consumes: `parkOrder`, `listHeldOrders`, `getHeldOrder`, `updateHeldOrder`, `abandonHeldOrder`, `payWorkingOrder`.
- Produces: the `/api/working-orders` REST surface + `POST /api/sales` routed through `payWorkingOrder`.

- [ ] **Step 1: Write the failing HTTP tests** (mirror the existing till-api suite's app construction): a session-guarded `POST /api/working-orders` returns `{ id, orderNumber }`; `GET /api/working-orders` lists; `GET /:id` retrieves; `PUT /:id` updates; `DELETE /:id` abandons; `POST /api/sales` with a `workingOrderId` files and, on replay, returns the same ticket. Unauthenticated → 401 (`session.required`). Unknown id → 404 (`working_order.not_found`). Update-after-terminal → 409 (`working_order.not_open`).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Add `"working_order.not_found": 404` and `"working_order.not_open": 409` to `till-api.ts`'s `STATUS` map (`till-api.ts:48-59`). Mount the five routes inside `mountTillApi`, each wrapped in `run(c, log, …)` and gated by `requireSession(deps, c)` (the `POST /api/sales` pattern at `till-api.ts:197-209` is the template — the sale route already supplies `operatorId = session.personId`; do the same for park/update so attribution is never browser-sent). Thread the browser-sent `workingOrderId` into `payWorkingOrder`. Reuse `deps.cfg` for tenant/till/node/location.

- [ ] **Step 4: Run → PASS**, then `pnpm --filter @waitron/server test:coverage` → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): /api/working-orders routes + idempotent POST /api/sales"`

---

## Task 9: Till API client

**Files:** Modify `apps/till/src/api/client.ts`; Test `apps/till/src/api/client.test.ts` (if present; else assert via the app test in Task 12).

**Interfaces:**
- Produces on `TillApi`: `parkOrder(req)`, `listWorkingOrders()`, `retrieveWorkingOrder(id)`, `updateWorkingOrder(id, req)`, `abandonWorkingOrder(id)`; `recordSale(lines, tender, workingOrderId)` gains the id. New response types `HeldOrderSummary`, `HeldOrder`.

- [ ] **Step 1: Write the failing test** — a stub `fetchImpl` asserts `parkOrder` POSTs `/api/working-orders` with `{ id, lines, label }` and returns `{ id, orderNumber }`; `listWorkingOrders` GETs and returns summaries; `recordSale` includes `workingOrderId` in the body.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the methods mirroring the existing `#request` pattern (`client.ts:93-115`). Add `HeldOrderSummary = { id; orderNumber; label: string | null; itemCount; total; openedAt }` and `HeldOrder = { id; orderNumber; label: string | null; lines: SaleLine[] }`. Change `recordSale(lines: SaleLine[], tender: CashTender, workingOrderId: string)` to send `{ lines, tender, workingOrderId }`.

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(till): TillApi working-order methods + workingOrderId on recordSale"`

---

## Task 10: `WorkingOrderStore` — stable id + retrieve

**Files:** Modify `apps/till/src/state/working-order.ts`; Test `apps/till/src/state/working-order.test.ts`.

**Interfaces:**
- Produces on `WorkingOrderStore`: `get id(): string` (a stable client-minted uuid, per basket); `clear()` mints a **fresh** id (a new basket is a new working order); `loadFrom(id, lines, label?)` replaces the basket with a retrieved order (sets `id`, populates `#lines` from `OrderLine`s, sets `label`); `get label()` / `set label()`.

- [ ] **Step 1: Write the failing test** — a fresh store has a uuid `id`; `clear()` changes it; `loadFrom(id, lines)` sets the id and repopulates lines and total; adding after `loadFrom` keeps the loaded id.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Add `#id = crypto.randomUUID()` (mint in the constructor); `get id()`; in `clear()` set `#id = crypto.randomUUID()`; add `#label?: string`; `loadFrom(id, lines, label?)` sets `#id = id`, `#lines` from the passed `OrderLine[]`, `#label = label`, invalidates `#priced`, emits `"changed"`. The retrieve mapping from `{ productId, quantity }` to `OrderLine { product, quantity }` (resolving `productId` against the loaded products) happens in the **app** (Task 12), which passes ready `OrderLine`s to `loadFrom`.

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(till): WorkingOrderStore stable client id + loadFrom"`

---

## Task 11: Till UI — Park control + label

**Files:** Modify `apps/till/src/widgets/tender-pay.ts` (or add a small `park-control` in the counter screen), `apps/till/src/till-app.ts`, `apps/till/src/i18n/strings.ts`; Tests `tender-pay.test.ts` / `till-app.test.ts` (+ a11y).

**Interfaces:**
- Produces: a `park-order` CustomEvent `{ label?: string }` (bubbles/composed); `till-app` handler `#onParkOrder` that calls `api.parkOrder({ id: store.id, lines, label })`, then `store.clear()` and stays on the counter (basket emptied, ready for the next customer).

- [ ] **Step 1: Write the failing tests** — a **Hold** button appears near Pay and is disabled on an empty basket; clicking it (with a label entered) emits `park-order` with `{ label }`; the `till-app` test asserts `#onParkOrder` calls `api.parkOrder` with `{ id, lines: [{productId, quantity}], label }` and then the basket is empty. Add a11y assertions (the tender-pay a11y suite already drives modes — extend it).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Add a **Hold** `<wt-button>` (label from `t("action.hold")`) beside the idle Pay button (`tender-pay.ts:216-228`), disabled when `store.lineCount === 0 || busy`. Clicking opens a small label prompt (reuse the numeric-pad pattern or a plain `<wt-input>` from `@waitron/ui` — the label is free text, optional) then emits `park-order`. In `till-app.ts`, wire `@park-order` on the wrapper div (`till-app.ts:184-190` pattern) → `#onParkOrder`: guard reentry, `await this.api.parkOrder({ id: this.#store.id, lines: this.#store.lines.map(l => ({ productId: l.product.id, quantity: l.quantity })), label })`, then `this.#store.clear()`. Add `"action.hold"` to **both** `en` and `es` in `strings.ts` (typecheck fails otherwise, `strings.ts:54-59`).

- [ ] **Step 4: Run → PASS**, incl a11y.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(till): Hold/Park control with optional label"`

---

## Task 12: Till UI — held-orders list widget + retrieve/discard

**Files:** Create `apps/till/src/widgets/held-orders.ts` (+ `.test.ts`, `.a11y.test.ts`); Modify `apps/till/src/layout.ts`, `apps/till/src/screens/till-counter-screen.ts`, `apps/till/src/till-app.ts`, `apps/till/src/i18n/strings.ts`.

**Interfaces:**
- Consumes: `HeldOrderSummary[]` (from `listWorkingOrders`), `TillProduct[]` (to rebuild lines on retrieve).
- Produces: `till-held-orders` widget rendering the summaries with a **Retrieve** and a **Discard** control per row, emitting `retrieve-order` `{ id }` and `discard-order` `{ id }`. `till-app` handlers load the retrieved order into the store and refresh the list.

- [ ] **Step 1: Write the failing tests** — the widget renders one row per summary (number, label, item count, total); a Retrieve click emits `retrieve-order { id }`; a Discard click emits `discard-order { id }`; empty state shows `t("held.empty")`. In `till-app.test.ts`: `#onRetrieveOrder` calls `api.retrieveWorkingOrder(id)`, maps `{ productId, quantity }` → `OrderLine` via the loaded `products`, calls `store.loadFrom(id, lines, label)`, and drops a line whose `productId` no longer resolves with a non-fatal `errorKey` (spec §4 edge). `#onDiscardOrder` calls `api.abandonWorkingOrder(id)` and refreshes the list. a11y: both themes.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**
  - `held-orders.ts`: a LitElement `till-held-orders` with `@property orders: HeldOrderSummary[]`, rendering rows (mirror `basket.ts`'s row/grid + `wt-button` idiom, and give the Retrieve/Discard buttons finger-sized targets — **not** `size="sm"`, per the 7a basket Minor). Emits the two events (bubbles/composed).
  - `layout.ts`: add `"held-orders"` to the `WidgetType` union (`layout.ts:14`) and a `{ type: "held-orders", region: "aside", config: {} }` entry to `LAYOUT_A`.
  - `till-counter-screen.ts`: add the `case "held-orders"` to the exhaustive `#widget` switch (`:125-139`) rendering `<till-held-orders .orders=${this.heldOrders}>`, a side-effect import, and a `@property heldOrders` fed from the app.
  - `till-app.ts`: on entering the counter and after park/discard/pay, `this.heldOrders = await this.api.listWorkingOrders()`; wire `@retrieve-order` → `#onRetrieveOrder` and `@discard-order` → `#onDiscardOrder`. In `#onRetrieveOrder`, resolve each `productId` against `this.products`; unresolved → skip + set `errorKey = "held.product_gone"`.
  - `strings.ts`: `"held.title"`, `"held.empty"`, `"held.retrieve"`, `"held.discard"`, `"held.product_gone"` in `en` **and** `es`.

- [ ] **Step 4: Run → PASS** (behaviour + a11y), then `pnpm --filter @waitron/till test:coverage` → PASS (thresholds 95/95/90/88).
- [ ] **Step 5: Commit** — `git commit -s -m "feat(till): cross-till held-orders list with retrieve + discard"`

---

## Task 13: Demo + end-to-end

**Files:** Create `apps/server/scripts/park-retrieve-demo.ts` (or extend the existing `demo:till`); add its `demo:` script to `apps/server/package.json`. Real-PG e2e already covered by Task 7's suite — extend it with a cross-till read.

**Interfaces:** Consumes the whole stack; produces a runnable narrative.

- [ ] **Step 1: Write the e2e assertion** (extend `working-order.rls.test.ts`): park on "till A" (one `cfg`), then `listHeldOrders`/`getHeldOrder` under a second `cfg` sharing the tenant+node but a different `tillId` → the order is visible and retrievable (cross-till); pay it → filed; the fiscal chain across two sales verifies (`checkIntegrity` ok). Prove tenant isolation: a `cfg` for tenant B sees none of tenant A's held orders.

- [ ] **Step 2: Run → FAIL** (demo script absent / cross-till assertion).

- [ ] **Step 3: Implement the demo script** mirroring `catalogue-demo.ts` / the `demo:till` script: provision a venue (or reuse the demo helper), park an order, list it, retrieve it, pay it by cash, print the ticket + confirm the chain. Add `"demo:park-retrieve": "tsx scripts/park-retrieve-demo.ts"` (match the existing demo script runner).

- [ ] **Step 4: Run the demo** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server demo:park-retrieve` prints a chained sale from a retrieved order.

- [ ] **Step 5: Full gate + commit.** Run `pnpm lint && pnpm typecheck && pnpm format:check` and the coverage suites for every touched package (`@waitron/db`, `@waitron/core`, `@waitron/server`, `@waitron/till`), plus `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`. Then `git commit -s -m "feat(server): park→retrieve→pay demo + cross-till e2e"`.

---

## Notes for the executor

- **`apps/till` is browser-mode Vitest (playwright/chromium).** Widget tests mount via `mountWidget<T>(tag, props, theme?)` (`apps/till/src/widgets/test-helpers.ts`) — set `attribute: false` props by assignment before append. a11y suites use `describe.each(["light","dark"])` + `expectNoA11yViolations(host)`.
- **Events are `bubbles: true, composed: true` CustomEvents**, handled by `@`-bindings on `till-app`'s wrapper `<div>` (`till-app.ts:184-190`). Follow that exact pattern for `park-order`/`retrieve-order`/`discard-order`.
- **The client prices for PREVIEW only** (`WorkingOrderStore` deep-imports `priceBasket`); the server always re-prices for the filed record. Never let a browser-sent price reach a sale.
- **Do not `UPDATE` `sales`** — the app role has no UPDATE on it; `working_order_id` is written once, at insert, inside `recordSale` (Task 3). The working-order status flip is on `working_orders`, which is mutable.
