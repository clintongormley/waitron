# SP-B4 — Drop the old widget model + rehome the receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the old widget/layout/region model now that every till surface renders from a canvas, and rehome the non-fiscal receipt trim from the `till_layouts.receipt` column into a new `tenant_receipts` table mirroring `tenant_themes`.

**Architecture:** Additive-first, then repoint, then remove. (1) Create `tenant_receipts`; (2) add a `receipt-store` over it and repoint every receipt reader/writer; (3) make `GET /api/till` always resolve a canvas (even cookieless) and drop the `layout` field; (4) cut the till app + counter screen over to the always-present canvas, deleting the region model; (5) delete the dashboard's old widget editor and repoint the receipt editor; (6) delete the now-unused old-model exports, the `till_layouts` table, and the `/management-api/layout` routes. Nothing is removed while still in use.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL (real Postgres via Testcontainers for RLS), Lit (till + dashboard), Vitest (Node + headless-Chromium browser mode), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-03-sp-b-grid-editor-and-rendering-design.md` (§9 old-model removal + receipt rehoming; §10 boundaries; §11 testing). Note the spec predates the SP-B3.2 `profile`→`canvas` rename (#213): "ProfileDef" in the spec is today `CanvasDef`, `layout_profiles` is `canvases`, and canvas resolution helpers are `getCanvas`/`getCanvasForFormFactor`.

## Global Constraints

- **Sale path is the one hard invariant** (fiscal §5, spec §10). Nothing may block a sale; the counter must always render a usable `product-grid`/`basket`/`total`/`tender-pay`. This slice preserves the sale path by guaranteeing a canvas is always present when the counter renders — the region-model fallback is only removed *after* that guarantee holds.
- **No back-compat / data migration** (pre-production, CLAUDE.md §5). `till_layouts` is DROPPED, not migrated. `tenant_receipts` starts empty; a tenant with no row gets the built-in `DEFAULT_RECEIPT` (`{}`).
- **A new `tenant_id`-bearing table needs FORCE RLS + a tenant-isolation policy + grants** — `.enableRLS()` emits ENABLE only (CLAUDE.md §3). The FORCE/policy/grants are hand-written in a paired `--custom` migration. Grants are `SELECT, INSERT, UPDATE` — no DELETE (config replaced in place, the `tenant_themes`/`till_layouts` shape).
- **Run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after adding the table** — that suite's tenant-scoped scan is the only guard that sees a missing FORCE (CLAUDE.md §3, §4).
- **Error codes name the domain concept and are never renamed once shipped** (CLAUDE.md §3). `receipt.invalid` is kept (still thrown by `validateReceiptConfig`). `layout.invalid` is *removed* (its only thrower, `validateLayout`, is deleted) — a removal, permissible pre-production, not a rename.
- **Bundle rule (#70):** the till never runtime-imports `@waitron/layouts`; it uses local mirror types in `apps/till/src/layout.ts`. The dashboard editor likewise keeps local mirrors. Do not add a runtime import.
- **No hardcoded chrome** — `--wt-*` tokens only (enforced by `no-hardcoded-chrome.test.ts`).
- **TDD throughout** (failing test first, watch it fail, minimal impl). Real Postgres for anything touching RLS as the app role (PGlite is a superuser false pass, CLAUDE.md §4). Browser-mode packages (`apps/till`, `apps/dashboard`, `packages/ui`) are memory-heavy — do not run their `test:coverage` concurrently.
- **Commit every step with `git commit -s`** (DCO). Prefer frequent commits.
- **The gate** (CLAUDE.md §2): `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`; per-package coverage via `pnpm --filter <pkg> test:coverage`. Coverage thresholds are 98/98/98/95 except the browser packages + `packages/ui`/`apps/till`/`apps/dashboard`/`apps/setup` at 95/95/90/88.

---

### Task 1: Create the `tenant_receipts` table (additive)

Mirror `tenant_themes` exactly (schema `packages/db/src/schema/tenant-themes.ts`, migrations `0090`/`0091`). `till_layouts` is untouched here — this task only ADDS.

**Files:**
- Create: `packages/db/src/schema/tenant-receipts.ts`
- Modify: `packages/db/src/schema/index.ts` (add `export * from "./tenant-receipts.js";`)
- Modify: `packages/db/src/index.ts` (add `export { tenantReceipts } from "./schema/tenant-receipts.js";`, alphabetical neighbourhood of `tenantThemes`)
- Create (generated): `packages/db/drizzle/0103_*.sql` (CREATE TABLE + ENABLE RLS + FK)
- Create (hand-written custom): `packages/db/drizzle/0104_*.sql` (FORCE + policy + grants)
- Test: `packages/db/src/schema/tenant-receipts.rls.test.ts`

**Interfaces:**
- Produces: `tenantReceipts` Drizzle table — columns `tenantId` (uuid PK), `receipt` (jsonb notNull), `updatedAt` (timestamptz). Table name `tenant_receipts`; FK `tenant_receipts_tenant_fk`; policy `tenant_receipts_tenant_isolation`.

- [ ] **Step 1: Write the schema RLS test (failing).** Create `packages/db/src/schema/tenant-receipts.rls.test.ts` as a verbatim adaptation of `tenant-themes.rls.test.ts` (read it in full first): replace every `tenant_themes` → `tenant_receipts`, the column `theme` → `receipt`, `tenant_themes_tenant_isolation` → `tenant_receipts_tenant_isolation`, and the jsonb fixtures (`'{"accent":"red"}'` etc.) with receipt-shaped values (`'{"headerSubtitle":"Hola"}'::jsonb`, `'{"footerMessage":"Gracias"}'::jsonb`, `'{}'::jsonb`). Keep all five `it` blocks (isolation positive+negative, in-place UPDATE, WITH-CHECK 42501, prove-by-deletion `using(true)` leak). Use fresh tenant-id constants distinct from other suites.

- [ ] **Step 2: Run it — verify RED for the right reason.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test tenant-receipts.rls`
Expected: FAIL on `relation "tenant_receipts" does not exist` (the raw-SQL insert), not a drizzle mismatch.

- [ ] **Step 3: Add the schema module.** Create `packages/db/src/schema/tenant-receipts.ts`, copied from `tenant-themes.ts` with `theme`→`receipt` and names updated. Content:

```typescript
import { foreignKey, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * The owner-authored NON-FISCAL receipt trim for one tenant (SP-B4; design §9). The trim
 * (`headerSubtitle` / `footerMessage`) renders AROUND the immutable fiscal art on the printed ticket
 * and can never suppress or reorder a mandated element — it is not a fiscal record.
 *
 * ONE ROW PER TENANT (the tenant_themes / till_layouts shape): `tenant_id` is the PRIMARY KEY, so it
 * is both the row identity and the tenant discriminator, and it doubles as the `ON CONFLICT` target
 * the service upserts against. A fresh tenant that has never opened the receipt editor simply has no
 * row — the service returns the built-in DEFAULT_RECEIPT rather than seeding one (no backfill; the
 * database is recreated pre-production, CLAUDE.md §5).
 *
 * `receipt` is PLAIN jsonb, deliberately NOT `.$type<>()`-annotated with the `@waitron/layouts`
 * `ReceiptConfig`: `@waitron/layouts` depends on `@waitron/db`, so importing its types here would be a
 * circular dependency. The service validates the shape on write (`validateReceiptConfig`); the
 * database stores opaque jsonb. Same rationale — and same precedent — as tenant_themes.
 *
 * FK via the array `foreignKey({...})` form, not `.references(() => …)`: the thunk form makes v8 count
 * a never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI process),
 * the same reason tenant-themes.ts uses this form. `restrict`, not cascade: removing a tenant must
 * never silently discard its authored receipt trim.
 *
 * `.enableRLS()` emits only `ENABLE ROW LEVEL SECURITY`. The `FORCE`, the tenant-isolation policy and
 * the app_user grants (SELECT/INSERT/UPDATE — no DELETE, config is replaced in place like
 * tenant_themes) are hand-written in the paired `--custom` migration (CLAUDE.md §3). No separate
 * tenant_id index: the PRIMARY KEY already provides a unique index on it. inmutabilidad requires FORCE.
 */
export const tenantReceipts = pgTable(
  "tenant_receipts",
  {
    tenantId: uuid("tenant_id").primaryKey(),
    receipt: jsonb("receipt").notNull(),
    // Timestamp `mode: "string"` follows the tenant_themes / devices precedent (an inert Drizzle
    // read-type choice, not a column-type difference).
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "tenant_receipts_tenant_fk",
    }).onDelete("restrict"),
  ],
).enableRLS();
```

- [ ] **Step 4: Wire the barrels.** Add `export * from "./tenant-receipts.js";` to `packages/db/src/schema/index.ts` (beside the `tenant-themes` line) and `export { tenantReceipts } from "./schema/tenant-receipts.js";` to `packages/db/src/index.ts` (beside `tenantThemes`).

- [ ] **Step 5: Generate the create migration.**

Run: `pnpm --filter @waitron/db db:generate`
Expected: writes `packages/db/drizzle/0103_<random>.sql` containing `CREATE TABLE "tenant_receipts" (…)`, `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, and the FK. Confirm it touches ONLY `tenant_receipts` (till_layouts still present, so no drop). If drizzle prompts, accept the create.

- [ ] **Step 6: Hand-write the custom RLS migration.**

Run: `pnpm --filter @waitron/db db:generate:custom`
Then fill the emitted empty `0104_<random>.sql` with (copied from `0091`, names swapped):

```sql
-- FORCE ROW LEVEL SECURITY + a tenant-isolation policy + the SELECT/INSERT/UPDATE app-role grant for
-- tenant_receipts (the owner-authored per-tenant NON-FISCAL receipt trim, SP-B4 / design §9).
--
-- 0103 emitted `ENABLE ROW LEVEL SECURITY` from `.enableRLS()` and nothing more — Drizzle does not
-- emit FORCE, CREATE POLICY or GRANT. This hand-written --custom migration adds them, exactly as
-- 0091_moaning_sharon_carter.sql did for tenant_themes and 0036_till_layouts_rls.sql for till_layouts.
-- The `current_tenant_id()` function and the `app_user` role already exist from 0001 and are NOT
-- recreated here; `current_tenant_id()` fails closed — an unset app.tenant_id returns NULL.
--
-- FORCE applies RLS to the table OWNER too, so a deployment connecting as the non-superuser migration
-- owner is still isolated. The guard that CATCHES a missing FORCE is fiscal-verifactu's `inmutabilidad`
-- scan, which asserts relforcerowsecurity on every tenant_id-bearing table.
--
-- FOR ALL, not FOR SELECT: USING filters what is readable and WITH CHECK filters what is writable.
--
-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- tenant_receipts is MUTABLE config — the dashboard upserts one row per tenant (INSERT ... ON CONFLICT
-- (tenant_id) DO UPDATE) — so app_user holds SELECT, INSERT, UPDATE. No DELETE.
ALTER TABLE "tenant_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_receipts_tenant_isolation" ON "tenant_receipts"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "tenant_receipts" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tenant_receipts" TO app_user;
```

- [ ] **Step 7: Run the schema RLS test — verify GREEN.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test tenant-receipts.rls`
Expected: PASS, all five cases.

- [ ] **Step 8: Run the inmutabilidad guard — verify GREEN.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
Expected: PASS — the tenant-scoped scan now sees `tenant_receipts` and confirms it has ENABLE + FORCE RLS. (Prove-by-deletion: temporarily comment out the `FORCE` line in `0104`, drop the template DB / re-run, watch this fail with `tenant_receipts` in the non-compliant list, then restore.)

- [ ] **Step 9: Commit.**

```bash
git add packages/db/src/schema/tenant-receipts.ts packages/db/src/schema/index.ts packages/db/src/index.ts packages/db/drizzle/ packages/db/src/schema/tenant-receipts.rls.test.ts
git commit -s -m "feat(db): add tenant_receipts table (SP-B4 receipt rehome)"
```

---

### Task 2: Receipt store over `tenant_receipts` + repoint every receipt reader/writer

Add `getReceipt`/`putReceipt` over `tenant_receipts` (mirroring `theme-store.ts`), switch the barrel's `putReceipt` to the new one, delete the receipt half of the old `store.ts`, and repoint the server consumers (`receipt-print.ts`, `till-api.ts` receipt read, `management-api.ts`). Add `GET /management-api/receipt` (the dashboard's future read path). The `layout` field of `GET /api/till` and the `/management-api/layout` routes stay for now (removed in Tasks 3/6).

**Files:**
- Create: `packages/layouts/src/receipt-store.ts`
- Create: `packages/layouts/src/receipt-store.rls.test.ts`
- Modify: `packages/layouts/src/store.ts` (remove `putReceipt`; keep `getLayout`/`putLayout` for now)
- Modify: `packages/layouts/src/store.rls.test.ts` (remove the `putReceipt` cases; move them to the new suite)
- Modify: `packages/layouts/src/index.ts` (barrel: `putReceipt` now from `receipt-store.js`; add `getReceipt`)
- Modify: `apps/server/src/receipt-print.ts` (`getLayout`→`getReceipt`)
- Modify: `apps/server/src/till-api.ts` (receipt half: read via `getReceipt`; `definition`/`layout` untouched here)
- Modify: `apps/server/src/management-api.ts` (add `GET /management-api/receipt`; `PUT /management-api/receipt` unchanged in signature, now writes tenant_receipts via the barrel)
- Test: `apps/server/src/management-api.rls.test.ts`, `apps/server/src/till-api.test.ts`, and `receipt-print`'s test

**Interfaces:**
- Consumes: `tenantReceipts` (Task 1); `ReceiptConfig`, `validateReceiptConfig`, `DEFAULT_RECEIPT` (unchanged in `@waitron/layouts`).
- Produces:
  - `getReceipt(tx: Transaction, tenantId: string): Promise<ReceiptConfig>` — returns the stored trim, or `DEFAULT_RECEIPT` (`{}`) when the tenant has no row. Does NOT authorize (boot read is unauthenticated).
  - `putReceipt(tx: Transaction, input: { managementSessionId: string; tenantId: string; receipt: unknown }): Promise<void>` — authorizes `till.configure`, validates, upserts `tenant_receipts`.
  - Server route `GET /management-api/receipt` → `{ receipt: ReceiptConfig }` (gated `till.configure`).

- [ ] **Step 1: Write the receipt-store RLS test (failing).** Create `packages/layouts/src/receipt-store.rls.test.ts` adapted from `theme-store.rls.test.ts` (read it first). Import `getReceipt, putReceipt` from `./receipt-store.js` and `DEFAULT_RECEIPT` + type `ReceiptConfig` from the barrel-local modules. Cases:
  - `getReceipt` returns `DEFAULT_RECEIPT` (`{}`) for a tenant with no row (NOT undefined — differs from theme-store).
  - round-trips a manager-authored `{ headerSubtitle: "Hola" }` through put→get.
  - upserts the single row on a second put (rowCount stays 1) — `select count(*) from tenant_receipts`.
  - refuses a staff-role put with `authorization.not_permitted` before any write (by-deletion of the `authorizeManager` call).
  - rejects an invalid receipt (`{ unknownField: "x" }`) with `receipt.invalid` before the INSERT.
  - RLS isolation: tenant B never sees tenant A's row.

- [ ] **Step 2: Run it — verify RED.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/layouts test receipt-store.rls`
Expected: FAIL — `./receipt-store.js` does not exist / `getReceipt` is not a function.

- [ ] **Step 3: Write `receipt-store.ts`.** Mirror `theme-store.ts`:

```typescript
import { tenantReceipts } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { eq, sql } from "drizzle-orm";
import { DEFAULT_RECEIPT } from "./defaults.js";
import type { ReceiptConfig } from "./types.js";
import { validateReceiptConfig } from "./validate.js";

/**
 * The get/put service over `tenant_receipts` (SP-B4; design §9). ONE row per tenant, keyed on
 * `tenant_id`, which doubles as the `ON CONFLICT` target — the tenant_themes shape. Every function
 * takes a `(tx, …)` the CALLER has already scoped (`withTenant` + `asAppUser`), so RLS supplies
 * `current_tenant_id()` and no function here sets a GUC. Proven under that shape in
 * receipt-store.rls.test.ts (real Postgres — RLS as the app role is a false pass on PGlite, §4).
 *
 * `putReceipt` runs, in order: (1) `authorizeManager(..., "till.configure")` — the write gate, before
 * any DB write, proven by-deletion; (2) `validateReceiptConfig` — fail-closed (throws `receipt.invalid`
 * before the write); (3) `INSERT … ON CONFLICT (tenant_id) DO UPDATE`. `getReceipt` casts the opaque
 * jsonb back WITHOUT re-validating (the write validated it, the only writer is this service) and
 * returns DEFAULT_RECEIPT when the tenant has no row (the get-with-default the till boot relies on).
 */

/** The tenant's authored receipt trim, or DEFAULT_RECEIPT (`{}`) when it has never authored one. */
export async function getReceipt(tx: Transaction, tenantId: string): Promise<ReceiptConfig> {
  const [row] = await tx
    .select({ receipt: tenantReceipts.receipt })
    .from(tenantReceipts)
    .where(eq(tenantReceipts.tenantId, tenantId));
  if (row === undefined) return DEFAULT_RECEIPT;
  return row.receipt as ReceiptConfig;
}

/** Author (create or replace) the tenant's receipt trim. Manager/admin only (`till.configure`). */
export async function putReceipt(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; receipt: unknown },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "till.configure",
  });
  const receipt = validateReceiptConfig(input.receipt);
  await tx
    .insert(tenantReceipts)
    .values({ tenantId: input.tenantId, receipt })
    .onConflictDoUpdate({
      target: tenantReceipts.tenantId,
      set: { receipt, updatedAt: sql`now()` },
    });
}
```

- [ ] **Step 4: Remove `putReceipt` from the old `store.ts`.** Delete the `putReceipt` function (L72-90) and, if it becomes unused there, the `validateReceiptConfig`/`DEFAULT_RECEIPT` imports it needed. `getLayout` (still returns `{ definition, receipt }`) and `putLayout` remain untouched — they are removed in Task 6. Move the `putReceipt`-specific cases out of `store.rls.test.ts` into the new suite (Step 1).

- [ ] **Step 5: Update the barrel.** In `packages/layouts/src/index.ts`: change `export { getLayout, putLayout, putReceipt } from "./store.js";` to `export { getLayout, putLayout } from "./store.js";` and add `export { getReceipt, putReceipt } from "./receipt-store.js";`.

- [ ] **Step 6: Run the layouts package — verify the new suite GREEN and old suites still GREEN.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/layouts test:coverage`
Expected: PASS (receipt-store round-trips; store.ts still green for the layout half).

- [ ] **Step 7: Repoint `receipt-print.ts` (TDD).** Its test seeds a receipt and asserts the printed trim. First change the test's seeding to write `tenant_receipts` (or via `putReceipt`) instead of `till_layouts`; watch it fail; then change the import `getLayout`→`getReceipt` (L52) and `const { receipt } = await getLayout(tx, cfg.tenantId)` → `const receipt = await getReceipt(tx, cfg.tenantId)` (L135). Run its suite green. (`apps/server` real-PG suite — `TESTCONTAINERS_RYUK_DISABLED=true`.)

- [ ] **Step 8: Repoint the receipt read in `till-api.ts` (TDD).** The GET `/api/till` boot still returns `layout: definition` (untouched here) but the `receipt` must now come from `getReceipt`. Update the test that pins the boot `receipt`; then in `till-api.ts` add `getReceipt` to the import, and read `receipt` via `await getReceipt(tx, deps.cfg.tenantId)` instead of destructuring it from `getLayout` (keep the `getLayout` call for `definition` until Task 3). Run the till-api suite green.

- [ ] **Step 9: Add `GET /management-api/receipt` + repoint `PUT` (TDD).** In `management-api.rls.test.ts`, add a case: author via `PUT /management-api/receipt`, read it back via `GET /management-api/receipt`, assert `{ receipt }`; and a `till.configure`-gate case (a staff session gets 403). Watch fail. Then in `management-api.ts`: `putReceipt` is now imported from the barrel (it already is by name — it now resolves to receipt-store). Add the GET route beside the existing receipt PUT (gate `authorizeManager(..., "till.configure")` then `getReceipt`), shaped like the existing `GET /management-api/layout`. Run green.

- [ ] **Step 10: Package gates.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/layouts test:coverage` and `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`
Expected: PASS.

- [ ] **Step 11: Commit.**

```bash
git add packages/layouts apps/server/src/receipt-print.ts apps/server/src/till-api.ts apps/server/src/management-api.ts apps/server/src/*.test.ts
git commit -s -m "feat(layouts,server): rehome receipt config into tenant_receipts store"
```

---

### Task 3: `GET /api/till` always resolves a canvas + drop the `layout` field

Make the boot read resolve a canvas for EVERY request, including cookieless (no device) — the form-factor `till` default. Then drop the `layout` field from the payload and the now-unused `getLayout` call. This is the enabling change that lets Task 4 delete the region-model fallback: the counter always has a canvas to render from.

**Files:**
- Modify: `apps/server/src/till-api.ts` (canvas resolution + drop `layout`)
- Test: `apps/server/src/till-api.test.ts`

**Interfaces:**
- Consumes: `getCanvasForFormFactor(tx, tenantId, "till")` (returns a `CanvasDef`, never undefined — falls back to `DEFAULT_CANVASES.till`).
- Produces: `GET /api/till` response no longer carries `layout`; `canvas` is ALWAYS present (`CanvasDef`, required, not optional). `receipt` unchanged (from Task 2's `getReceipt`).

- [ ] **Step 1: Update the boot tests (failing).** In `till-api.test.ts`: (a) change the existing "no-cookie / cookieless" assertion — it currently expects `canvas` absent and the payload byte-for-byte unchanged; now assert `canvas` IS present and equals the `till` form-factor default (`DEFAULT_CANVASES.till` shape), and that `layout` is ABSENT from the payload. (b) Update the enrolled-device cases to drop `layout` from their expected payloads. (c) Remove the seeds that write `till_layouts.definition` for the boot `layout` field (L879/893/905 area) — keep any receipt seed (now via `tenant_receipts`).

- [ ] **Step 2: Run — verify RED.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test till-api`
Expected: FAIL — payload still has `layout`; cookieless `canvas` still undefined.

- [ ] **Step 3: Resolve a canvas for cookieless + drop `layout`.** In the GET `/api/till` handler:
  - Change the canvas resolution so that when there is NO device, `canvas` resolves to `await getCanvasForFormFactor(tx, deps.cfg.tenantId, "till")` (rather than staying `undefined`). Keep the enrolled-device branch (explicit `canvasId` → `getCanvas`, else `getCanvasForFormFactor(deviceFormFactor(device.kind))`). Type `canvas` as `CanvasDef` (non-optional).
  - Remove the `getLayout` call and the `definition`/`layout` field from the returned payload (`boot.layout`, and the `layout: definition` inner object). Remove `getLayout` from the import (`getCanvas`/`getCanvasForFormFactor` stay).
  - Update the boot-result type / payload shape so `canvas: CanvasDef` is required and `layout` is gone.
  - Update the code comments (§1: a behaviour change retires the receipt about the old behaviour) — the "counter still renders from `layout`/`receipt` until SP-B" note (L621) and the "cookieless stays undefined so byte-for-byte unchanged" note (L664) are now false; rewrite them to state the new behaviour.

- [ ] **Step 4: Run — verify GREEN.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test till-api`
Expected: PASS.

- [ ] **Step 5: Server gate.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/till-api.ts apps/server/src/till-api.test.ts
git commit -s -m "feat(server): GET /api/till always resolves a canvas; drop layout field (SP-B4)"
```

---

### Task 4: Cut the till app + counter screen over to the always-present canvas

Remove the region model entirely. The counter renders only through the canvas `counter` tab (`#counterTab()`); the legacy `#renderScreen` arms (counter/ticket/schedule/floor/table-order/station/expo) are dead now that a canvas is always present off-lock, so `render()` becomes `enrol-overlays → lock → shell`. Keep the lock screen and the `Screen`/`#setScreen` state machine (it is the lock-vs-not-lock marker that flips into the shell).

**Files:**
- Modify: `apps/till/src/till-app.ts`
- Modify: `apps/till/src/screens/till-counter-screen.ts`
- Modify: `apps/till/src/layout.ts` (delete old-model types + `LAYOUT_A`; keep the canvas mirror block)
- Modify: `apps/till/src/api/client.ts` (`TillInfo`: drop `layout`; `canvas` becomes required)
- Modify: `apps/till/src/widgets/product-grid.ts` (comment only — retarget the `WIDGET_CONFIG` docstring reference to the card contract)
- Test: `apps/till/src/till-app.test.ts`, `apps/till/src/screens/till-counter-screen.test.ts`, `apps/till/src/api/client.test.ts`

**Interfaces:**
- Consumes: `GET /api/till` always returns `canvas: CanvasDef`, no `layout` (Task 3).
- Produces: `TillInfo.canvas: CanvasDef` (required), no `TillInfo.layout`. `till-counter-screen` no longer accepts a `layout` prop; it renders solely from `counterTab`.

- [ ] **Step 1: `till-counter-screen` — remove the region render (TDD).** In `till-counter-screen.test.ts`, drop the cases that render via the `layout`/region path and keep/extend the `counterTab` (grid) cases (the sale-path guard: a counter tab always yields product-grid/basket/total/tender-pay). Watch fail. Then in `till-counter-screen.ts`: remove the `layout` `@property` (L202), `#widget` (L294-334), `inRegion` + the `.region-main`/`.region-aside` markup and CSS (L389/L448-453 + the region CSS block), and the `LAYOUT_A`/`LayoutDef`/`WidgetInstance` imports (L6). Keep the menu-switcher/diet-filter (it was shared; now rendered once above the grid) and everything the grid path uses. The screen renders `counterTab` via `till-card-grid`.

- [ ] **Step 2: Run — counter screen GREEN.**

Run: `pnpm --filter @waitron/till test till-counter-screen`
Expected: PASS.

- [ ] **Step 3: `till-app` — collapse `render()` to the shell + lock (TDD).** In `till-app.test.ts`, update stubs so `getTill` always returns a `canvas` (the tests that relied on a canvasless boot rendering the legacy counter must now provide a canvas and assert the shell). Add/keep an assertion that a boot FAILURE (getTill rejects → `canvas` undefined) falls back to the lock screen + `boot.error` banner (not a blank shell). Watch fail. Then in `till-app.ts`:
  - In `render()`, replace the `this.#inShell() ? shell : keyed(currentLocale(), this.#renderScreen())` else-branch: keep `this.#inShell()` as the shell condition, and make the ELSE render the lock screen (inline the current `case "lock"` body). This keeps the boot-error/canvasless state on lock rather than a blank shell.
  - Delete `#renderScreen` entirely (its lock body moved inline; every other arm is dead because a successful boot always has a canvas, so off-lock ⇒ `#inShell()` true).
  - Delete `#layoutFor()` (L2081-2088), `receivedLayout` (@state L485), `isDefaultLayout` (L135), and the `this.receivedLayout = till.layout` assignment in `#boot` (L634). Remove `LayoutDef` from the import (L60); keep `CanvasDef`/`ReceiptConfig`/`TabDef`.
  - The `.layout=${this.#layoutFor()}` prop on the counter screen (in the removed `case "counter"` and in `#tabBody`'s counter arm) goes away — `#tabBody` already passes `counterTab`; confirm the counter arm passes no `layout`.

- [ ] **Step 4: Run — till-app GREEN.**

Run: `pnpm --filter @waitron/till test till-app`
Expected: PASS.

- [ ] **Step 5: `layout.ts` + `api/client.ts` (TDD).** In `client.test.ts`, drop any assertion of `TillInfo.layout`. Then: in `apps/till/src/layout.ts` delete the old-model block (`WidgetType` L14-15, `WidgetInstance` L18-22, `LayoutDef` L25, `LAYOUT_A` L47-54) — KEEP `ReceiptConfig` (L35-38, still threaded to the ticket) and the entire canvas mirror block below it. In `api/client.ts`: remove `LayoutDef` from the import (L22), remove `TillInfo.layout` (L89), and make `TillInfo.canvas: CanvasDef` required (drop the `?`, L99). In `product-grid.ts` update the L67 docstring: the `columns` bound is now stated by the card contract, not `WIDGET_CONFIG`.

- [ ] **Step 6: Run — till package gate.**

Run: `pnpm --filter @waitron/till test:coverage`
Expected: PASS (95/95/90/88). Do not run this concurrently with the dashboard browser suite (RAM).

- [ ] **Step 7: Commit.**

```bash
git add apps/till/src
git commit -s -m "feat(till): render counter from canvas only; remove region/widget model (SP-B4)"
```

---

### Task 5: Delete the dashboard's old widget editor + repoint the receipt editor

Remove `dashboard-layout-screen` and its nav/render/i18n; repoint `dashboard-receipt-screen` to read via the new `GET /management-api/receipt` (`getReceipt` client method) instead of `getLayout().receipt`; drop the old client types + `getLayout`/`putLayout` methods.

**Files:**
- Delete: `apps/dashboard/src/screens/layout-screen.ts`, `layout-screen.test.ts`, `layout-screen.a11y.test.ts`
- Modify: `apps/dashboard/src/dashboard-app.ts` (drop `"layout"` from the Screen union, the import, the nav entry, the render case)
- Modify: `apps/dashboard/src/api/client.ts` (drop `WidgetType`/`WidgetInstance`/`LayoutDef` local types + `getLayout`/`putLayout` methods; add `getReceipt()`)
- Modify: `apps/dashboard/src/screens/receipt-screen.ts` (read via `api.getReceipt()`)
- Modify: `apps/dashboard/src/i18n/strings.ts` (drop `nav.layout` + the "Layout widget kinds" block if unused)
- Test: `receipt-screen.test.ts`, `dashboard-app.test.ts`, `dashboard-app.a11y.test.ts`, `client.test.ts`

**Interfaces:**
- Consumes: `GET /management-api/receipt` → `{ receipt }` (Task 2); `putReceipt` route (unchanged).
- Produces: dashboard no longer has a `layout` screen; `nav.canvases` (the B3.2 canvas editor) is the layout-authoring surface.

- [ ] **Step 1: Add `getReceipt()` to the client + repoint receipt-screen (TDD).** In `client.test.ts`, add a case for `getReceipt()` hitting `GET /management-api/receipt`; in `receipt-screen.test.ts`, change the read stub from `getLayout` to `getReceipt`. Watch fail. Then add `getReceipt(): Promise<{ receipt: ReceiptConfig }>` to `api/client.ts` (shaped like the existing `getLayout` but hitting `/management-api/receipt`), and change `receipt-screen.ts` L105 to read `(await this.api.getReceipt()).receipt`. Run those suites green.

- [ ] **Step 2: Delete the layout screen + wiring (TDD).** In `dashboard-app.test.ts`/`.a11y.test.ts`, remove the cases that render/navigate the `layout` screen (the canvas editor `nav.canvases` case stays). Watch fail. Then: delete the three `layout-screen*` files; in `dashboard-app.ts` remove `"layout"` from the Screen union (L63), the import (L22), the nav entry (L137), and the render `case "layout"` (L703-704); in `i18n/strings.ts` remove `nav.layout` and the now-orphaned "Layout widget kinds" strings (grep to confirm no remaining reference before deleting each key).

- [ ] **Step 3: Drop the old client types + methods.** In `api/client.ts` remove the local `WidgetType`/`WidgetInstance`/`LayoutDef` types (L434-445) and the `getLayout`/`putLayout` methods (L1535-1549). Keep `ReceiptConfig` (L452-455) + `putReceipt` (L1555-1557) + the new `getReceipt`. Grep the dashboard for any lingering reference and fix.

- [ ] **Step 4: Run — dashboard gate.**

Run: `pnpm --filter @waitron/dashboard test:coverage`
Expected: PASS (95/95/90/88).

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src
git commit -s -m "feat(dashboard): remove old widget editor; receipt editor reads tenant_receipts (SP-B4)"
```

---

### Task 6: Remove the now-unused old model — exports, `till_layouts`, `/management-api/layout`

Everything now renders from the canvas and reads the receipt from `tenant_receipts`. Delete the dead old-model surface. Run a grep sweep first to confirm zero remaining consumers.

**Files:**
- Modify: `packages/layouts/src/types.ts` (remove `WIDGET_TYPES`/`WidgetType`/`Region`/`WidgetInstance`/`LayoutDef`; KEEP `ReceiptConfig`)
- Modify: `packages/layouts/src/widget-config.ts` (remove `WIDGET_CONFIG` + `intInRange`; KEEP `ConfigValidator`/`WidgetConfigSchema` types)
- Modify: `packages/layouts/src/validate.ts` (remove `validateLayout` + `SALE_CRITICAL` + `isWidgetType`; KEEP `validateReceiptConfig`/`MAX_RECEIPT_FIELD_LENGTH`/`RECEIPT_FIELDS`)
- Modify: `packages/layouts/src/defaults.ts` (remove `DEFAULT_LAYOUT`; KEEP `DEFAULT_RECEIPT`)
- Delete: `packages/layouts/src/store.ts`, `packages/layouts/src/store.rls.test.ts`
- Modify: `packages/layouts/src/index.ts` (remove `WIDGET_TYPES`, the old type re-exports, `DEFAULT_LAYOUT`, `WIDGET_CONFIG`, `validateLayout`, `getLayout`/`putLayout`)
- Modify: `packages/layouts/src/validate.test.ts`, `index.test.ts` (remove old-model cases)
- Delete: `packages/db/src/schema/layouts.ts`, `packages/db/src/schema/layouts.rls.test.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/index.ts` (remove `layouts`/`tillLayouts` exports)
- Create (generated): `packages/db/drizzle/0105_*.sql` (DROP TABLE `till_layouts`)
- Modify: `apps/server/src/management-api.ts` (remove `GET`/`PUT /management-api/layout`; remove `getLayout`/`putLayout` imports; remove the `layout.invalid` HTTP-status mapping)
- Modify: `apps/server/src/management-api.rls.test.ts` (remove the layout-route cases)
- Modify: `packages/shared/src/errors.ts` or `packages/layouts/src/errors.ts` (remove the `layout.invalid` error code — its only thrower is gone)

**Interfaces:**
- Consumes: nothing new — this task only deletes.
- Produces: `@waitron/layouts` public surface shrinks to the canvas/theme/receipt model. `till_layouts` no longer exists.

- [ ] **Step 1: Grep sweep — confirm nothing still consumes the old model.**

Run:
```bash
grep -rn --include="*.ts" -E "tillLayouts|till_layouts|validateLayout|\bgetLayout\b|\bputLayout\b|WIDGET_TYPES|WIDGET_CONFIG|\bLayoutDef\b|\bWidgetInstance\b|DEFAULT_LAYOUT|\bWidgetType\b|\bRegion\b" apps packages | grep -v node_modules | grep -v "/dist/"
```
Expected: only the definitions about to be deleted (layouts `types.ts`/`validate.ts`/`store.ts`/`defaults.ts`/`widget-config.ts`/`index.ts` + tests, `schema/layouts.ts` + its test, management-api's layout routes). No live consumers in till/dashboard/server business code. If anything else appears, it was missed by Tasks 3-5 — fix it there first.

- [ ] **Step 2: Remove the `/management-api/layout` routes (TDD).** In `management-api.rls.test.ts`, delete the `GET`/`PUT /management-api/layout` cases. Watch the suite (it will still pass — deleting tests). Then in `management-api.ts` delete the `GET`/`PUT /management-api/layout` route blocks (L803-851), the `getLayout`/`putLayout` imports (L42/L46), and the `"layout.invalid": 400` status-map entry (L211). Run `pnpm --filter @waitron/server test management-api` green.

- [ ] **Step 3: Delete the old-model layouts exports.** Edit `types.ts`, `widget-config.ts`, `validate.ts`, `defaults.ts`, `index.ts` per the Files list (delete the old-model members, keep the receipt/config-type members). Delete `store.ts` + `store.rls.test.ts`. Update `validate.test.ts` + `index.test.ts` to drop the `validateLayout`/`WIDGET_*`/`getLayout` cases. Remove the `layout.invalid` code from the layouts error registry (`packages/layouts/src/errors.ts`) and its `declare module` augmentation.

- [ ] **Step 4: Run — layouts gate.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/layouts test:coverage`
Expected: PASS.

- [ ] **Step 5: Drop the `till_layouts` table.** Delete `packages/db/src/schema/layouts.ts` + `layouts.rls.test.ts`; remove their barrel exports from `schema/index.ts` and `db/index.ts`. Then generate the drop migration:

Run: `pnpm --filter @waitron/db db:generate`
Expected: emits `0105_<random>.sql` with `DROP TABLE "till_layouts";` (the policy/FK drop with it). Confirm it drops ONLY `till_layouts`.

- [ ] **Step 6: Run — db gate + inmutabilidad.**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage` then `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
Expected: PASS — `till_layouts` gone, `tenant_receipts` compliant.

- [ ] **Step 7: Whole-workspace typecheck + a final grep.**

Run: `pnpm typecheck` then re-run the Step 1 grep.
Expected: `pnpm typecheck` clean; grep returns nothing (every old-model symbol is gone).

- [ ] **Step 8: Commit.**

```bash
git add -A
git commit -s -m "feat: remove old widget model + till_layouts + /management-api/layout (SP-B4)"
```

---

### Task 7: Backlog update + full gate

**Files:**
- Modify: `docs/backlog.md` (mark SP-B4 landed; note SP-B complete)

- [ ] **Step 1: Update the backlog.** Under the SP-B row, mark B4 landed with a one-line summary (drop widget model + `tenant_receipts` rehome; sale path preserved via always-present canvas; `till_layouts` dropped; `/management-api/layout` removed; receipt editor repointed). If B4 was the last SP-B sub-project, note SP-B / the layout-designer track complete. Record any deferrals discovered during execution.

- [ ] **Step 2: Run the whole-workspace gate.**

Run: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`
Expected: PASS. Then the browser + heavy packages via `test:coverage` one at a time (RAM): `pnpm --filter @waitron/till test:coverage`, `pnpm --filter @waitron/dashboard test:coverage`, `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage`, `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`, `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/layouts test:coverage`, `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test:coverage`.

- [ ] **Step 3: Commit.**

```bash
git add docs/backlog.md
git commit -s -m "docs(backlog): SP-B4 landed (drop widget model + receipt rehome)"
```

Then hand off to `finish-branch` (simplify → review → rebase → PR → CI + Copilot). Do not merge without the owner's `/land-branch`.

---

## Self-Review notes

- **Spec §9 coverage:** new `tenant_receipts` (Task 1); receipt store move (Task 2); receipt-print reads new table (Task 2); drop `till_layouts` + `WIDGET_TYPES`/`WidgetInstance`/`LayoutDef`/`Region`/`WIDGET_CONFIG`/`validateLayout`/`store`/`defaults`/`DEFAULT_LAYOUT` (Task 6); till local `layout.ts` + region render + `#layoutFor` (Task 4); old dashboard layout screen (Task 5); `layout` field from `GET /api/till` + the API clients (Tasks 3-5). §12 open item (receipt editor repoint) = Task 5. §10 sale path = the always-present-canvas guarantee (Task 3) that lets Task 4 remove the region fallback.
- **KEEP set (do not delete):** `ReceiptConfig`, `validateReceiptConfig`, `MAX_RECEIPT_FIELD_LENGTH`, `DEFAULT_RECEIPT`, `ConfigValidator`, `WidgetConfigSchema` (used by `card-contract.ts`), the whole canvas/theme model, `till-ticket-view.receipt`.
- **Type consistency:** `getReceipt(tx, tenantId): Promise<ReceiptConfig>` (Task 2) is consumed by `receipt-print`/`till-api` (Task 2/3) and the `GET /management-api/receipt` route (Task 2) → dashboard `getReceipt()` (Task 5). `TillInfo.canvas` becomes required in both the server payload (Task 3) and the till client (Task 4). `putReceipt` keeps its `(tx, { managementSessionId, tenantId, receipt })` signature across the store move so `management-api.ts` needs no call-site change.
- **Migration numbering:** 0103 (create tenant_receipts) + 0104 (custom RLS) in Task 1; 0105 (drop till_layouts) in Task 6. Sequential generates on one branch — no rebase collision (memory: drizzle-migration-rebase-collision) as long as `main` is not re-synced mid-branch.
