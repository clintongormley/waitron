# Layout & receipt editors + per-widget config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (or
> `superpowers:executing-plans`). Steps use checkbox (`- [ ]`) syntax. **TDD throughout**: write the
> failing test, watch it fail, then the minimal implementation, then the verify command.

**Design:** [`2026-08-08-layout-receipt-editors-design.md`](../specs/2026-08-08-layout-receipt-editors-design.md).
**Goal:** author a till `LayoutDef` + a receipt trim config in `apps/dashboard`, persist it per-tenant
(FORCE RLS), have the till render the authored layout, and wire one real per-widget config key
(`product-grid.columns`) end to end.

## Global constraints

- **Every commit `git commit -s`.** Feature branch in a worktree (`worktree.py new waitron
  feat/layout-receipt-editors`), never on `main`.
- **Coverage:** node packages **98/98/98/95**; `apps/till` + `apps/dashboard` **95/95/90/88**.
  Before green: `pnpm --filter <pkg> test:coverage` (CI runs coverage, not plain `test` — CLAUDE.md §2).
- **RLS / privilege behaviour → real Postgres** (PGlite is a false pass for RLS-as-app-role and
  concurrency, CLAUDE.md §4). `TESTCONTAINERS_RYUK_DISABLED=true` locally.
- **Migration is `0034`** in `packages/db/drizzle/` (last is `0033`). Sequence around any concurrent
  `_journal.json` collision (backlog note).
- **Prove every guard by deletion** (remove the check, watch the test fail, restore).

---

### Task 1: `@waitron/layouts` scaffold + canonical types + defaults + errors

**Files (create):** `packages/layouts/package.json`, `tsconfig.json`, `vitest.config.ts`,
`src/index.ts`, `src/types.ts`, `src/defaults.ts`, `src/errors.ts`, `src/errors.test.ts`.

- [ ] **Step 1 — scaffold** the package cloning `packages/identity/package.json`'s scripts/devDeps,
  name `@waitron/layouts`, deps `@waitron/db` + `@waitron/identity` + `@waitron/shared` + `drizzle-orm`.
  `tsconfig` extends `../../tsconfig.base.json`, `include: ["src"]`. `vitest.config.ts` cloned from a
  sibling node package (coverage 98/98/98/95).
- [ ] **Step 2 — `types.ts`**: `WidgetType` (the six from `apps/till/src/layout.ts:14-15`),
  `WidgetInstance`, `LayoutDef`, `ReceiptConfig = { headerSubtitle?: string; footerMessage?: string }`.
- [ ] **Step 3 — `defaults.ts`**: `DEFAULT_LAYOUT` (= the current `LAYOUT_A`, `layout.ts:34-41`),
  `DEFAULT_RECEIPT = {}`.
- [ ] **Step 4 — failing test `errors.test.ts`**: `new AppError("layout.invalid", {…})` and
  `"receipt.invalid"` construct and are recognised. Run: `pnpm --filter @waitron/layouts test errors`
  · Expected: FAIL (codes unregistered).
- [ ] **Step 5 — `errors.ts`**: the `declare module "@waitron/shared"` augmentation registering
  `layout.invalid` + `receipt.invalid`, plus the `import "./errors.js"` reachability side-effect in
  `index.ts` — modelled on `packages/identity/src/errors.ts`. **Grep first** (design §6):
  `grep -rn "\"layout\.\|\"receipt\.\|\"till\." packages/*/src/errors.ts apps/server/src/errors.ts` —
  confirm no sibling family before minting.
- [ ] **Step 6 — verify:** `pnpm --filter @waitron/layouts test errors` · PASS. Commit.

---

### Task 2: `WIDGET_CONFIG` registry + `validateLayout` + `validateReceiptConfig`

**Files:** `packages/layouts/src/widget-config.ts`, `src/validate.ts`, `src/validate.test.ts`.

- [ ] **Step 1 — failing test** `validate.test.ts` (pure, no DB). Cover, each as its own case:
  - a valid `LayoutDef` round-trips;
  - **not an array** → `layout.invalid { reason: "not_array" }`;
  - **unknown widget type** → `layout.invalid`;
  - **bad region** → `layout.invalid`;
  - **`product-grid` with `{ columns: 3 }`** valid; `{ columns: 0 }` / `{ columns: 13 }` / `{ columns: "x" }`
    → `layout.invalid`; **`{ columns: 3, bogus: 1 }`** (unknown key) → `layout.invalid` (D8);
  - a widget carrying a key when its schema is empty → `layout.invalid`;
  - **duplicate type** (two `basket`) → `layout.invalid { duplicate }` (D5);
  - **missing a sale-critical widget** (drop `total`) → `layout.invalid { missing }` (D4);
  - `validateReceiptConfig`: `{}` ok, `{ footerMessage: "x" }` ok, a >200-char string / non-string
    → `receipt.invalid`.
  Run: `pnpm --filter @waitron/layouts test validate` · Expected: FAIL (module missing).
- [ ] **Step 2 — implement** `widget-config.ts` (`WIDGET_CONFIG`: `product-grid → { columns: intInRange(1,12) }`,
  the other five → `{}`) and `validate.ts` (`validateLayout`, `validateReceiptConfig`) per design §6.
- [ ] **Step 3 — verify + prove a guard by deletion** (remove the duplicate-check, confirm that case
  fails, restore). Run: `pnpm --filter @waitron/layouts test validate` · PASS. Export all from
  `index.ts`. Commit.

---

### Task 3: `till_layouts` schema + core migration + RLS test

**Files:** `packages/db/src/schema/layouts.ts`, edit `packages/db/src/schema/index.ts`,
`packages/db/drizzle/0034_till_layouts.sql`, `packages/db/src/schema/layouts.rls.test.ts`.

- [ ] **Step 1 — schema** `layouts.ts`: `tillLayouts = pgTable("till_layouts", { tenantId (pk), definition
  (jsonb, notNull), receipt (jsonb, notNull), updatedAt })` with the `foreignKey({...})` array form to
  `tenants` (`onDelete("restrict")`) + `.enableRLS()` — mirror
  `packages/identity/src/schema/management-sessions.ts`. Re-export from `schema/index.ts`.
- [ ] **Step 2 — failing RLS test** `layouts.rls.test.ts` (real Postgres via the db harness /
  `useRealPostgres`): (a) a row written under tenant A is invisible under tenant B (positive
  isolation); (b) an INSERT of a row with tenant B's id while `app.tenant_id` = A is **refused** by
  `WITH CHECK` (the negative the sibling `sessions.rls` lacks). Run:
  `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test layouts.rls` · Expected: FAIL
  (no table / no policy).
- [ ] **Step 3 — migration** `0034_till_layouts.sql`: the `CREATE TABLE` + FK, then the FORCE RLS
  recipe from design §4 (verbatim shape of `packages/identity/drizzle/0003_sessions_rls.sql`:
  `FORCE ROW LEVEL SECURITY`, `CREATE POLICY … USING/WITH CHECK (tenant_id = current_tenant_id())`,
  `REVOKE ALL … FROM app_user`, `GRANT SELECT, INSERT, UPDATE … TO app_user`). Generate the journal
  entry with `drizzle-kit generate --custom` from `packages/db` (or hand-add the `_journal.json` line
  the way the custom migrations do) and confirm `db:generate` is then a no-op.
- [ ] **Step 4 — verify + prove FORCE/policy by deletion:** run the RLS test → PASS; delete the
  `FORCE` line → confirm the isolation-as-owner or `inmutabilidad` signal changes, restore; delete the
  `WITH CHECK` → confirm case (b) fails, restore. Commit.

---

### Task 4: inmutabilidad + english-only cover the new table

- [ ] **Step 1 — run inmutabilidad:** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter
  @waitron/fiscal-verifactu test inmutabilidad` · Expected: PASS, `till_layouts` scanned as a core
  tenant_id table with `relforcerowsecurity=true`. If it reports `false`, Task 3's `FORCE` is missing
  — fix there.
- [ ] **Step 2 — run english-only** (root project): `pnpm vitest run scripts/english-only` · Expected:
  PASS (`till_layouts` tokens are English). No commit (verification only) — or commit if a token needs
  adjusting.

---

### Task 5: `getLayout` / `putLayout` / `putReceipt` service (authorize + upsert)

**Files:** `packages/layouts/src/store.ts`, `src/store.rls.test.ts`; edit `src/index.ts`.

- [ ] **Step 1 — failing test** `store.rls.test.ts` (real Postgres): seed a tenant + a manager
  management session (reuse identity test helpers). Assert:
  - `getLayout` on a never-authored tenant returns `DEFAULT_LAYOUT`/`DEFAULT_RECEIPT`;
  - `putLayout` by a `till.configure`-holder persists; `getLayout` reads it back;
  - `putLayout` **by a staff-role session → `authorization.not_permitted`** (differential — deleting
    the `authorizeManager` call makes this pass, i.e. proves the gate);
  - a second `putLayout` **upserts** (updates the one row, no duplicate);
  - cross-tenant: tenant A's `putLayout` never appears under tenant B.
  Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/layouts test store.rls` · FAIL.
- [ ] **Step 2 — implement** `store.ts`: `getLayout(tx, tenantId)`; `putLayout`/`putReceipt` calling
  `authorizeManager(tx, { managementSessionId, permission: "till.configure" })`
  (`packages/identity/src/manager-login.ts:43-52`) then `validate*` then
  `INSERT … ON CONFLICT (tenant_id) DO UPDATE`. Export from `index.ts`.
- [ ] **Step 3 — verify + prove the gate by deletion.** Run the suite → PASS. Then
  `pnpm --filter @waitron/layouts test:coverage` → PASS at 98/98/98/95. Commit.

---

### Task 6: `till.configure` permission

**Files:** edit `packages/identity/src/permissions.ts` (+ its test if one pins the list).

- [ ] **Step 1 — grep** `grep -rn "PERMISSIONS" packages --include="*.test.ts"` for a test pinning the
  exact array (none found at design time). If found, extend it in this same commit (stale-list trap).
- [ ] **Step 2 — failing test:** assert `roleHasPermission("manager","till.configure")` and `admin`
  true, `staff`/`supervisor` false. Run `pnpm --filter @waitron/identity test permissions` · FAIL.
- [ ] **Step 3 — implement:** add `"till.configure"` to `PERMISSIONS` and to the `MANAGER` set (admin
  inherits via `ALL`), `permissions.ts:7-34`.
- [ ] **Step 4 — verify:** `pnpm --filter @waitron/identity test:coverage` · PASS. Commit.

---

### Task 7: management-api write routes

**Files:** edit `apps/server/src/management-api.ts`; extend `apps/server/src/management-api.rls.test.ts`.

- [ ] **Step 1 — failing e2e** (real Postgres, mirror the existing management-api suite): for
  `GET /management-api/layout`, `PUT /management-api/layout`, `PUT /management-api/receipt` —
  unauth **401**; staff-role session **403** (differential); manager `PUT` valid → `204` → `GET`
  reads it back; invalid `definition` → **400 `layout.invalid`**; non-object body → **400
  `management.request_invalid`**; a cross-tenant differential (fails if `withTenant`/`asAppUser`
  dropped). Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test management-api`
  · FAIL.
- [ ] **Step 2 — implement** the three routes in `mountManagementApi` (`management-api.ts:145`),
  each `run`-wrapped, `requireManagementSession` first, `withTenant`+`asAppUser`, body screened
  `?? {}` + `typeof` (pattern at `:250-266`) → call `getLayout`/`putLayout`/`putReceipt`. Add
  `layout.invalid` + `receipt.invalid` to the `STATUS` map (`:64-91`). Add `import "@waitron/layouts"`
  reachability if needed for its error codes.
- [ ] **Step 3 — verify.** `pnpm --filter @waitron/server test management-api` · PASS. Commit.

---

### Task 8: till read — `GET /api/till` returns the layout + receipt

**Files:** edit `apps/server/src/till-api.ts`; extend `apps/server/src/till-api.test.ts`.

- [ ] **Step 1 — failing test:** `GET /api/till` returns `layout` = the authored definition when one
  exists, else `DEFAULT_LAYOUT`; and `receipt` similarly. Run: `pnpm --filter @waitron/server test
  till-api` · FAIL.
- [ ] **Step 2 — implement:** in the `GET /api/till` handler (`till-api.ts:216-249`), call
  `getLayout(tx, deps.cfg.tenantId)` in the same `withTenant`+`asAppUser` block and add `layout` +
  `receipt` to the JSON.
- [ ] **Step 3 — verify.** `pnpm --filter @waitron/server test:coverage` · PASS. Commit.

---

### Task 9: till renders the authored layout + `product-grid.columns` wired

**Files:** edit `apps/till/src/api/client.ts`, `layout.ts` (re-export/adjust types only if needed),
`till-app.ts`, `screens/till-counter-screen.ts`, `screens/till-ticket-view.ts`,
`widgets/product-grid.ts`; extend their `.test.ts`.

- [ ] **Step 1 — client type:** add `layout: LayoutDef` + a local `ReceiptConfig` + `receipt` to
  `TillInfo` (`client.ts:32-39`), importing `LayoutDef` from `../layout.js`.
- [ ] **Step 2 — product-grid config (TDD):** failing test — a `till-product-grid` with `columns=4`
  renders `grid-template-columns: repeat(4, 1fr)`; unset keeps the `auto-fill` default. Implement a
  `@property() columns?: number` driving a style binding (`product-grid.ts`). Run:
  `pnpm --filter @waitron/till test product-grid` · FAIL → implement → PASS.
- [ ] **Step 3 — counter-screen threads config (TDD):** failing test — given a layout whose
  `product-grid` instance has `config: { columns: 4 }`, `#widget` passes `.columns=4`. Implement in
  `#widget` (`till-counter-screen.ts:183-209`). Run: `pnpm --filter @waitron/till test till-counter-screen`.
- [ ] **Step 4 — till-app boot (TDD):** failing test — a stub `getTill` returning a `layout`/`receipt`
  makes the counter render that layout (authored verbatim) and threads `receipt` to the ticket; a stub
  omitting them falls back to `#layoutFor()`. Implement in `#boot` (`till-app.ts:230-242`) + thread
  `receipt` to `till-ticket-view`.
- [ ] **Step 5 — receipt trim (TDD):** failing test — `till-ticket-view` with
  `receipt: { headerSubtitle, footerMessage }` renders both around the fixed core; absent → `nothing`;
  **a test pins that no `ReceiptConfig` field can suppress the art. 7.1 core** (design §8). Implement
  in `till-ticket-view.ts`.
- [ ] **Step 6 — verify.** `pnpm --filter @waitron/till test:coverage` · PASS at 95/95/90/88
  (`.a11y` suites still green, both themes). Commit.

---

### Task 10: dashboard API client methods

**Files:** edit `apps/dashboard/src/api/client.ts`, `client.test.ts`.

- [ ] **Step 1 — failing test** (stub `fetch`, per `apps/dashboard/src/api/client.test.ts`):
  `getLayout()` → `GET /management-api/layout` credentials-included; `putLayout(def)` → `PUT` with the
  JSON body; `putReceipt(cfg)` → `PUT /management-api/receipt`; a non-2xx throws the envelope code.
  Run: `pnpm --filter @waitron/dashboard test client` · FAIL.
- [ ] **Step 2 — implement** the three methods + local `LayoutDef`/`WidgetInstance`/`ReceiptConfig`
  types (bundle-decoupled). Run: PASS. Commit.

---

### Task 11: dashboard layout editor screen

**Files:** `apps/dashboard/src/screens/layout-screen.ts`, `.test.ts`, `.a11y.test.ts`;
`apps/dashboard/src/widgets/widget-config-form.ts` (+ tests) if the config sub-form is extracted.

- [ ] **Step 1 — failing test:** stub `api.getLayout` (returns a layout) + `api.putLayout`. Assert the
  screen renders one row per widget per region; **↑/↓** reorders (order in the next `putLayout` call
  reflects it); **Eliminar** removes; the **Añadir** picker (of not-yet-placed types) appends;
  **Editar** on `product-grid` exposes a `columns` field whose value reaches `putLayout`; **Guardar**
  calls `putLayout` with the composed definition; a rejected `putLayout` shows a `role="alert"`.
  `.a11y.test.ts` both themes (mirror `staff-screen.a11y.test.ts`). Run:
  `pnpm --filter @waitron/dashboard test layout-screen` · FAIL.
- [ ] **Step 2 — implement** on `@waitron/ui` primitives (list-based, button-reorder — design §9, D1),
  `WIDGET_CONFIG`-driven config sub-form. Run: PASS (spec + a11y). Commit.

---

### Task 12: dashboard receipt editor screen

**Files:** `apps/dashboard/src/screens/receipt-screen.ts`, `.test.ts`, `.a11y.test.ts`.

- [ ] **Step 1 — failing test:** stub `api.getLayout`/`api.putReceipt`; assert two fields
  (`headerSubtitle`, `footerMessage`) load and **Guardar** calls `putReceipt` with them; a11y both
  themes. Run: `pnpm --filter @waitron/dashboard test receipt-screen` · FAIL.
- [ ] **Step 2 — implement** (two `wt-input`s + Guardar). Run: PASS. Commit.

---

### Task 13: dashboard shell nav (login → staff → layout → receipt)

**Files:** edit `apps/dashboard/src/dashboard-app.ts`, `dashboard-app.test.ts`, `dashboard-app.a11y.test.ts`.

- [ ] **Step 1 — failing test:** logged-in shell shows a nav; clicking *Disposición* mounts
  `dashboard-layout-screen`, *Recibo* mounts `dashboard-receipt-screen`, *Personal* the staff screen;
  a11y both themes. Run: `pnpm --filter @waitron/dashboard test dashboard-app` · FAIL.
- [ ] **Step 2 — implement:** extend the screen machine to `login | staff | layout | receipt` + a
  header nav (three `wt-button`s), importing the two new screen modules for registration.
- [ ] **Step 3 — verify.** `pnpm --filter @waitron/dashboard test:coverage` · PASS at 95/95/90/88
  (`test-dashboard` Chromium shard — no new shard). Commit.

---

### Task 14: GENERIC_PACKAGES + pinning-test churn

**Files:** edit `packages/db/src/english-only.ts`, `packages/fiscal-verifactu/src/vocabulary-scope.test.ts`.

- [ ] **Step 1 — failing test first:** run `pnpm --filter @waitron/fiscal-verifactu test
  vocabulary-scope` — with `"layouts"` added to `GENERIC_PACKAGES` it goes RED (pins the list), which
  is the stale-list trap firing (CLAUDE.md §3). Add `"layouts"` to `GENERIC_PACKAGES`
  (`english-only.ts`, beside `catalogue`), then update the pinned list in `vocabulary-scope.test.ts`
  in the SAME commit.
- [ ] **Step 2 — verify** both: `pnpm --filter @waitron/fiscal-verifactu test vocabulary-scope` +
  `pnpm vitest run scripts/english-only` · PASS. (Decision D10-alt: if the reviewer prefers, skip the
  GENERIC_PACKAGES add — `layouts` carries no Spanish; default here is to add for consistency.) Commit.

---

### Task 15: workspace green + finish

- [ ] **Step 1 — lockfile:** `pnpm install` (new package) and commit `pnpm-lock.yaml`.
- [ ] **Step 2 — the gate:** from root `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
- [ ] **Step 3 — coverage per changed package:** `pnpm --filter @waitron/layouts --filter @waitron/db
  --filter @waitron/identity --filter @waitron/server --filter @waitron/till --filter @waitron/dashboard
  test:coverage` (CI runs coverage, not `test` — CLAUDE.md §2). Real-PG suites with
  `TESTCONTAINERS_RYUK_DISABLED=true`.
- [ ] **Step 4 — cross-cutting guards unfiltered** (they don't load under a package filter, CLAUDE.md §2/§4):
  `pnpm vitest run scripts/english-only scripts/guarded-teardowns` and
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.
- [ ] **Step 5 — PR + backlog.** Open the PR (this is code, not docs — full CI + Copilot). Update
  `docs/backlog.md`: move "The layout & receipt editors + per-widget config" from *Counter POS
  follow-ups* to shipped, and record deferrals as new follow-ups (drag-and-drop; per-widget config
  beyond `product-grid.columns`; per-till/per-location scope; the `showCashChange` receipt toggle; a
  live preview; i18n of the editor's raw error codes — same debt 1c carries). Wait for CI + Copilot,
  address findings, reply on each thread (CLAUDE.md §6).

---

## Self-review

- **Persistence** (design §4) — Tasks 3–4. **Service + validation** (§5–6) — Tasks 1–2, 5. **Write API
  + till read** (§7) — Tasks 7–8. **Till render + one wired config key** (§7, D6) — Task 9. **Editor
  UI** (§9) — Tasks 10–13. **Receipt fiscal-safety** (§8) — Task 9 Step 5. **Guards + churn** (§10) —
  Tasks 4, 6, 14, 15.
- **Every guard proved by deletion** (Tasks 2, 3, 5, 6). **RLS/authorize on real Postgres** (Tasks 3,
  5, 7). **Negative `WITH CHECK`** written where the sibling suite lacks it (Task 3).
- **Ordering:** the package + validation land before the schema so the migration's RLS test can import
  the service; the permission (Task 6) lands before the routes that gate on it (Task 7); the client
  types (Task 9 Step 1) before the widgets that consume them.
- **Out of slice (correctly):** drag-and-drop, config keys past `product-grid.columns`, named/multiple
  layouts, per-till/per-location scope, live preview, editor i18n — all in design §2, recorded as Task
  15 backlog follow-ups.
