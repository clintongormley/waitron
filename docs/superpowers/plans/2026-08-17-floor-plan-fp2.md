# Floor plan FP-2 — Spatial canvas + drag-drop edit mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the spatial floor plan on top of FP-1 — nullable placement coordinates on `dining_tables`, a shared drag-drop canvas, a map/list toggle on the till, and edit mode in both the dashboard and (manager-on-till) the till.

**Architecture:** Four nullable placement columns + a `floor_table_shape` enum on `dining_tables` (all non-fiscal); `setTablePlacement`/`clearPlacement` verbs; a shared `@waitron/ui` `wt-floor-canvas` (view + edit) reusing FP-1's occupancy token; two persistence routes — dashboard (`authorizeManager(till.configure)`, precedented) and the **first-ever till `authorize(till.configure)` route** (operator role, no override).

**Tech Stack:** TypeScript, Drizzle + PostgreSQL (RLS), Hono, Lit + Vite, `@waitron/ui`, Vitest (+ browser), Testcontainers + PGlite.

**Spec:** [docs/superpowers/specs/2026-08-17-floor-plan-fp2-spatial-canvas-design.md](../specs/2026-08-17-floor-plan-fp2-spatial-canvas-design.md) — read alongside; every task argues from it.

## ⛔ Prerequisites — BLOCKED until FP-1 (→ TS-1/TS-2) is built and merged

FP-2 extends FP-1, which extends TS-1/TS-2 — all **unbuilt** at plan-writing time. Do not start Task 1 until FP-1 has landed on `main`. **Re-verify each borrowed symbol against the real built code** before coding (CLAUDE.md §1):

- `dining_tables` (with FP-1's `zone_id`) — the ALTER target. **Task 1.**
- `listTablesWithState` (FP-1: returns `zoneId` + `pendingToServe`) — extend it. **Task 2.**
- FP-1's occupancy **token** component (the card element the floor screen renders) — reused as the on-canvas token. **Task 5.**
- FP-1's `till-floor-screen` + `sala-screen` — extended, not recreated. **Tasks 6, 7.**
- `zone.not_found` / `table.not_found` (FP-1) — reused by the placement validator. **Task 2.**
- `authorize(tx, { sessionId, permission, override? })` (`packages/identity/src/authorize.ts:39-42`, role check `:54`), `requireSession` returning `{ personId, sessionId }` (`till-session.ts:76-95`), the verb-side pattern `record-void.ts:58-62`, `authorizeManager` (`packages/layouts/src/store.ts:56`). **Tasks 3, 4.**

## Global Constraints

_Every task's requirements implicitly include this section. Values verbatim from the spec._

- **English identifiers** — `pos_x`, `pos_y`, `shape`, `rotation`, `floor_table_shape`. No new `SPANISH_WORDS`. UI copy localised en/es.
- **Domain error code** `placement.invalid` (400; params **name the field, never echo the value** — CLAUDE.md §1). Reuse `table.*` / `zone.*`. `import "./errors.js"` in the throwing file. Never renamed once shipped.
- **Permission:** reuse `till.configure` (dashboard via `authorizeManager`; till via `authorize`). No new permission. **Manager + admin hold it; supervisor + staff do NOT** (`permissions.ts:16`/`:51`/`:63`).
- **On-till editing is manager-on-till only** — `authorize()` with the operator's role, **no `override` parsing** this slice.
- **Non-fiscal** — nothing near the huella; pay path unchanged; a test pins the huella is independent of placement.
- **No backwards-compat / data-migration code** (pre-production).
- **Migration number via `db:generate`** — never hardcode. Commit journal + snapshot.
- **Coordinates:** `pos_x`/`pos_y` are integers `0..1000`; `rotation` `0..359`. **Canvas aspect ratio = a single constant `FLOOR_ASPECT = 3 / 2`** (landscape) shared client-side; define it once (e.g. `packages/ui` export) and reuse — do not scatter magic numbers. Size-from-plazas thresholds: `≤2 → S`, `3–4 → M`, `5–6 → L`, `≥7 → XL`; null capacity → M.
- **Coverage:** db, server → **98/98/98/95**; ui, till, dashboard → **95/95/90/88**.
- **Testing discipline:** RLS/authorize behaviour is a false pass on PGlite — use real Postgres. `TESTCONTAINERS_RYUK_DISABLED=true` locally. Run `packages/db` unfiltered. Re-run `inmutabilidad` after the ALTER. Prove gates by deletion.

## File Structure

**Created:**
- `packages/db/drizzle/<NNNN>_floor_plan_fp2.sql` — enum + 4 columns (via `db:generate`).
- `packages/ui/src/components/wt-floor-canvas.ts` (+ `.test.ts`, `.a11y.test.ts`) — the shared canvas.
- `packages/ui/src/floor.ts` — `FLOOR_ASPECT`, `sizeForCapacity()`, placement types (shared constants).

**Modified:**
- `packages/db/src/schema/<dining-tables>.ts` (FP-1/TS-1) — add `pos_x`, `pos_y`, `shape`, `rotation` + the `floor_table_shape` enum.
- `packages/db/src/schema/<dining-tables>.rls.test.ts` — extend for the new columns' visibility.
- `apps/server/src/tables.ts` — `setTablePlacement` / `clearPlacement`; extend `listTablesWithState` with placement fields.
- `apps/server/src/errors.ts` — `placement.invalid`.
- `apps/server/src/management-api.ts` — `PUT/DELETE /management-api/tables/:id/placement` (`authorizeManager`).
- `apps/server/src/till-api.ts` — `PUT/DELETE /api/tables/:id/placement` (**new `authorize()` hop**).
- `packages/ui/src/index.ts` — export `wt-floor-canvas` + `floor.ts`.
- `apps/till/src/screens/till-floor-screen.ts` — map/list toggle, tray, Editar-plano toggle.
- `apps/till/src/api/client.ts` — `setTablePlacement` / `clearPlacement`.
- `apps/dashboard/src/screens/sala-screen.ts` — per-zone floor-plan editor tab.
- `apps/dashboard/src/api/client.ts` — placement methods.
- `docs/backlog.md` — flip FP-2 row to BUILT (Task 8).

---

### Task 1: Placement columns + `floor_table_shape` enum + migration

**Files:**
- Modify: `packages/db/src/schema/<dining-tables>.ts`, `…/<dining-tables>.rls.test.ts`
- Create (generated): `packages/db/drizzle/<NNNN>_floor_plan_fp2.sql`

**Interfaces:**
- Produces: `dining_tables.pos_x`, `pos_y` (smallint), `shape` (`floor_table_shape` enum), `rotation` (smallint) — all nullable; the exported `floorTableShape` pgEnum.
- Consumes: FP-1/TS-1's `dining_tables` table + its FORCE-RLS policy.

- [ ] **Step 1: Add the enum + columns to the schema.** In the dining-tables schema file:

```ts
export const floorTableShape = pgEnum("floor_table_shape", ["round", "square", "rect"]);
// …inside pgTable("dining_tables", { …existing…,
  posX: smallint("pos_x"),
  posY: smallint("pos_y"),
  shape: floorTableShape("shape"),
  rotation: smallint("rotation"),
// })
```

- [ ] **Step 2: Generate the migration.** `pnpm --filter @waitron/db db:generate`. Expected: create type `floor_table_shape`; `ALTER TABLE dining_tables ADD COLUMN pos_x smallint, …`. **Verify nothing else.** No custom migration needed (columns inherit `dining_tables`'s RLS). Note `<NNNN>`.

- [ ] **Step 3: Extend the RLS/visibility test.** In the dining-tables RLS test, assert `app_user` can UPDATE the new columns on its own row and read them back (differential — drop `asAppUser` → fails):

```ts
it("exposes placement columns to app_user under the tenant policy", async () => {
  await withTenant(db, tenantA, (tx) => asAppUser(tx, async (q) => {
    await q.update(diningTables).set({ posX: 500, posY: 250, shape: "square", rotation: 15 })
           .where(eq(diningTables.id, tableA));
    const [row] = await q.select().from(diningTables).where(eq(diningTables.id, tableA));
    expect(row).toMatchObject({ posX: 500, posY: 250, shape: "square", rotation: 15 });
  }));
});
```

- [ ] **Step 4: Run tests + guards.** `pnpm --filter @waitron/db test:coverage` (unfiltered, incl. the RLS test); `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (`dining_tables` still `relforcerowsecurity = true` after the ALTER).

- [ ] **Step 5: Commit.**

```bash
git add packages/db/src/schema/ packages/db/drizzle/
git commit -s -m "feat(db): dining_tables placement columns + floor_table_shape enum"
```

---

### Task 2: Placement verbs + `placement.invalid` + read extension

**Files:**
- Modify: `apps/server/src/tables.ts`, `apps/server/src/errors.ts`
- Test: `apps/server/src/tables.test.ts` (PGlite), `apps/server/src/errors.test.ts`

**Interfaces:**
- Consumes: the placement columns (Task 1); `table.not_found` / `zone.not_found` (FP-1); FP-1's `listTablesWithState`.
- Produces:
  - `setTablePlacement(tx, cfg, tableId: string, p: { zoneId: string; posX: number; posY: number; shape: "round"|"square"|"rect"; rotation: number }): Promise<void>`
  - `clearPlacement(tx, cfg, tableId: string): Promise<void>`
  - `listTablesWithState` result gains `posX?`, `posY?`, `shape?`, `rotation?` (null when unplaced).
  - error code `placement.invalid` (400, params: `{ field: string }`).

- [ ] **Step 1: Register `placement.invalid`** in `errors.ts` (`declare module` block + status map, beside FP-1's `zone.*`): `"placement.invalid": { field: string }` → 400. Add a registration test assertion (mirror Task-2 of FP-1). Run → add → PASS.

- [ ] **Step 2: Write the failing verb test** (PGlite):

```ts
it("places a table, rejects bad input field-by-field, and clears", async () => {
  const tx = pgliteTx(); const cfg = testCfg();
  const { id: zoneId } = await createZone(tx, cfg, { name: "Comedor" });
  const { id } = await createTable(tx, cfg, { label: "4", capacity: 4 });
  await setTablePlacement(tx, cfg, id, { zoneId, posX: 500, posY: 250, shape: "square", rotation: 15 });
  const placed = (await listTablesWithState(tx, cfg)).find((t) => t.id === id)!;
  expect(placed).toMatchObject({ posX: 500, posY: 250, shape: "square", rotation: 15, zoneId });
  await expect(setTablePlacement(tx, cfg, id, { zoneId, posX: 2000, posY: 0, shape: "square", rotation: 0 }))
    .rejects.toMatchObject({ code: "placement.invalid", params: { field: "posX" } });
  await expect(setTablePlacement(tx, cfg, id, { zoneId, posX: 0, posY: 0, shape: "hexagon" as any, rotation: 0 }))
    .rejects.toMatchObject({ code: "placement.invalid", params: { field: "shape" } });
  await clearPlacement(tx, cfg, id);
  const cleared = (await listTablesWithState(tx, cfg)).find((t) => t.id === id)!;
  expect(cleared.posX).toBeNull();
});
```

- [ ] **Step 3: Run — FAIL.**
- [ ] **Step 4: Implement** `setTablePlacement` / `clearPlacement` in `tables.ts` (import `"./errors.js"`): validate active table (`table.not_found`), live zone (`zone.not_found`), `posX`/`posY` integer in `0..1000` (else `placement.invalid { field: "posX"|"posY" }`), `shape` in the enum (`{ field: "shape" }`), `rotation` `0..359` (`{ field: "rotation" }`); UPDATE the columns. `clearPlacement` sets all four NULL. Extend `listTablesWithState`'s select to include the four columns.
- [ ] **Step 5: Run — PASS**, then `pnpm --filter @waitron/server test:coverage tables errors`.
- [ ] **Step 6: Commit.**

```bash
git add apps/server/src/tables.ts apps/server/src/errors.ts apps/server/src/tables.test.ts apps/server/src/errors.test.ts
git commit -s -m "feat(server): setTablePlacement/clearPlacement + placement.invalid + placement in read"
```

---

### Task 3: Dashboard placement routes (management API, `authorizeManager`)

**Files:**
- Modify: `apps/server/src/management-api.ts`
- Test: `apps/server/src/management-api.test.ts` (real-PG e2e)

**Interfaces:**
- Consumes: `setTablePlacement`/`clearPlacement` (Task 2); `requireManagementSession` (`:278`); `authorizeManager(till.configure)` (`store.ts:56` / `management-api.ts:444`).
- Produces: `PUT /management-api/tables/:id/placement`, `DELETE /management-api/tables/:id/placement`.

- [ ] **Step 1: Write the failing e2e test** — 401 unauth, 403 non-manager, 204 manager writes then read-back shows the placement:

```ts
it("manager places a table via the dashboard route; staff is 403", async () => {
  await expect(PUT(`/management-api/tables/${tableId}/placement`, { session: staffMgmt, body: place() }))
    .resolves.toMatchObject({ status: 403 });
  expect((await PUT(`/management-api/tables/${tableId}/placement`, { session: managerMgmt, body: place() })).status).toBe(204);
  const state = (await GET("/api/tables/state", { session: op })).body.find((t: any) => t.id === tableId);
  expect(state).toMatchObject({ posX: 500, posY: 250, shape: "square" });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Mount the routes** in `mountManagementApi`, each `run`-wrapped: `requireManagementSession` (401) → the verb calls `authorizeManager(tx, { managementSessionId, permission: "till.configure" })` under `withTenant`+`asAppUser` (the layout `PUT` shape). Body-shape screen; `requireUuidId`; `placement.invalid` in `STATUS`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Prove the gate by deletion** — drop `authorizeManager`, confirm the 403 case goes red, restore.
- [ ] **Step 6: Coverage + commit.**

```bash
git add apps/server/src/management-api.ts apps/server/src/management-api.test.ts
git commit -s -m "feat(server): management-api table placement routes (authorizeManager till.configure)"
```

---

### Task 4: On-till placement routes — the first till `authorize(till.configure)` hop

**Files:**
- Modify: `apps/server/src/till-api.ts`
- Test: `apps/server/src/till-api.test.ts` (real-PG e2e)

**Interfaces:**
- Consumes: `setTablePlacement`/`clearPlacement` (Task 2); `requireSession` → `{ personId, sessionId }` (`till-session.ts:76-95`); `authorize(tx, { sessionId, permission })` (`authorize.ts:39-42`, role satisfied `:54`); the verb-side pattern `record-void.ts:58-62` (minus the override).
- Produces: `PUT /api/tables/:id/placement`, `DELETE /api/tables/:id/placement` — gated by the operator's **own** `till.configure` role, **no override parsing**.

- [ ] **Step 1: Write the failing e2e test** — this is the novel gate; test both role outcomes and prove it by deletion:

```ts
it("a manager operator places a table from the till; a staff operator is 403", async () => {
  const managerOp = await loginOperator("manager"); // holds till.configure
  const staffOp = await loginOperator("staff");      // does not
  expect((await PUT(`/api/tables/${tableId}/placement`, { session: managerOp, body: place() })).status).toBe(204);
  await expect(PUT(`/api/tables/${tableId}/placement`, { session: staffOp, body: place() }))
    .resolves.toMatchObject({ status: 403 }); // authorization.not_permitted
});
```

- [ ] **Step 2: Run — FAIL** (route 404 / no gate).
- [ ] **Step 3: Implement the route** in `mountTillApi`, `run`-wrapped: `const { sessionId } = requireSession(deps, c)` (note: pass `sessionId`, which existing routes don't use), `requireUuidId`, parse the placement body, then inside `withTenant`+`asAppUser` call `authorize(tx, { sessionId, permission: "till.configure" })` (which throws `authorization.not_permitted` → 403 when the operator's role lacks it — no override), then `setTablePlacement(...)`. **Do not** add override parsing (manager-on-till only — spec §3c). Add `authorization.not_permitted` to the `STATUS` map if not already present (it is, from identity — verify). `DELETE` mirrors with `clearPlacement`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Prove the gate by deletion** — remove the `authorize` call; confirm the staff-403 case wrongly returns 204 (red); restore. This is a differential proof of the first till-side `authorize()`.
- [ ] **Step 6: Coverage + commit.**

```bash
git add apps/server/src/till-api.ts apps/server/src/till-api.test.ts
git commit -s -m "feat(server): on-till table placement route gated by authorize(till.configure)"
```

---

### Task 5: Shared `wt-floor-canvas` component (`@waitron/ui`)

**Files:**
- Create: `packages/ui/src/floor.ts`, `packages/ui/src/components/wt-floor-canvas.ts` (+ `.test.ts`, `.a11y.test.ts`)
- Modify: `packages/ui/src/index.ts` (export both)

**Interfaces:**
- Consumes: `@waitron/ui` base (`baseStyles`, `applyTokens`, `dispatchWtChange` — `index.ts:1-3`); FP-1's occupancy-token markup (reuse its render, or a shared sub-render — verify FP-1's token is importable; if it lives in `apps/till`, extract the pure token render into `floor.ts` so both consume it).
- Produces:
  - `floor.ts`: `FLOOR_ASPECT = 3 / 2`; `sizeForCapacity(capacity?: number): "S"|"M"|"L"|"XL"`; the `Placement` + `FloorTable` types.
  - `<wt-floor-canvas>` with props `.tables`, `.editable`, `.gridSnap` and events `open-table`, `placement-change`, `placement-clear`.

- [ ] **Step 1: Write `floor.ts` + its test** (pure functions, fast): `sizeForCapacity(2)==="S"`, `(4)==="M"`, `(6)==="L"`, `(8)==="XL"`, `(undefined)==="M"`; `FLOOR_ASPECT===1.5`. Run → implement → PASS.
- [ ] **Step 2: Write the failing view-mode render test:**

```ts
it("draws a placed token at the scaled position, sized + rotated", async () => {
  const el = await fixture(html`<wt-floor-canvas .tables=${[
    { id: "t1", label: "4", capacity: 4, posX: 500, posY: 250, shape: "square", rotation: 15, state: "open-tab", tabTotal: "47.50", pendingToServe: 0, status: null }
  ]}></wt-floor-canvas>`);
  const tok = el.shadowRoot!.querySelector<HTMLElement>('[data-table="t1"]')!;
  expect(tok.style.left).toBe("50%");          // 500‰
  expect(tok.style.transform).toContain("rotate(15deg)");
  expect(tok).to.have.attribute("data-size", "M");   // capacity 4
});
```

- [ ] **Step 3: Run — FAIL → implement view mode.** A fixed-aspect canvas (`aspect-ratio: ${FLOOR_ASPECT}`); each table absolutely positioned at `left: posX/10%`, `top: posY/10%`, `transform: translate(-50%,-50%) rotate(${rotation}deg)`, `data-size` from `sizeForCapacity`; render the FP-1 occupancy token inside (colour + status badge + `por servir`). Tap → `open-table`. Theme tokens only.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Write the failing edit-mode test** (drag emits grid-snapped placement; rotate snaps 15°):

```ts
it("emits placement-change with grid-snapped coords on drag", async () => {
  const el = await fixture(html`<wt-floor-canvas .editable=${true} .gridSnap=${true} .tables=${[oneTable("t1")]}></wt-floor-canvas>`);
  setTimeout(() => dragTokenTo(el, "t1", { xFrac: 0.333, yFrac: 0.52 }));
  const e = await oneEvent(el, "placement-change");
  expect(e.detail.tableId).toBe("t1");
  expect(e.detail.posX % 50).toBe(0);   // snapped to the 50‰ grid
});
```

- [ ] **Step 6: Run — FAIL → implement edit mode.** Pointer-drag updates position (snap to a 50‰ grid when `.gridSnap`); a shapes palette sets `shape`; a rotate handle (snap 15°); a selection inspector (label/plazas/shape/zone/deactivate). Emit `placement-change { tableId, posX, posY, shape, rotation, zoneId }` / `placement-clear { tableId }`. Keyboard-accessible (arrow keys nudge — a11y). Run → PASS.
- [ ] **Step 7: a11y test** both themes (axe) → PASS. Export from `index.ts`.
- [ ] **Step 8: Coverage + commit.**

```bash
git add packages/ui/src/floor.ts packages/ui/src/components/wt-floor-canvas.* packages/ui/src/index.ts
git commit -s -m "feat(ui): wt-floor-canvas shared drag-drop floor component"
```

---

### Task 6: Till floor screen — map/list toggle, tray, Editar-plano

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (+ its tests), `apps/till/src/api/client.ts`
- Test: `…/till-floor-screen.test.ts`, `…/till-floor-screen.a11y.test.ts`

**Interfaces:**
- Consumes: `wt-floor-canvas` (Task 5); the placement routes (Tasks 3/4 — till uses the till route); FP-1's `till-floor-screen` (list view) + occupancy read; the operator role (from `getTill`/session context).
- Produces: `TillApi.setTablePlacement(tableId, body)` / `clearPlacement(tableId)`; the map/list toggle + tray + edit toggle behaviour.

- [ ] **Step 1: Add + test `TillApi` placement methods** (FetchLike stub — assert `PUT/DELETE /api/tables/:id/placement`, body). Run → implement → PASS.
- [ ] **Step 2: Write the failing screen tests:** (a) shows the **map** (`wt-floor-canvas`) when the zone has ≥1 placed table, else the **list**; (b) a manual toggle flips it; (c) unplaced tables appear in a **tray**; (d) the **Editar plano** button is **hidden** when the operator lacks `till.configure` and shown when present; (e) in edit mode, a `placement-change` from the canvas calls `api.setTablePlacement`.

```ts
it("hides Editar plano for a non-manager operator", async () => {
  const el = await mountFloor({ role: "staff", tables: [placed("t1")] });
  expect(el.shadowRoot!.querySelector('[data-edit-toggle]')).toBeNull();
});
it("persists a canvas placement-change via the till route", async () => {
  const api = fakeTillApi();
  const el = await mountFloor({ role: "manager", api, editing: true, tables: [placed("t1")] });
  el.shadowRoot!.querySelector("wt-floor-canvas")!
    .dispatchEvent(new CustomEvent("placement-change", { detail: { tableId: "t1", posX: 100, posY: 100, shape: "round", rotation: 0, zoneId: "z1" }, bubbles: true, composed: true }));
  expect(api.setTablePlacement).toHaveBeenCalledWith("t1", expect.objectContaining({ posX: 100 }));
});
```

- [ ] **Step 3: Run — FAIL → implement.** Add a `view: "map"|"list"` `@state` (default map when `tables.some(placed)` for the current zone); a toggle control; the tray (unplaced tables, tap → `open-table`, drag in edit → drops onto canvas); the `Editar plano` toggle rendered only when the role holds `till.configure`; wire `@placement-change`/`@placement-clear` → the `TillApi` methods, then refresh. The server re-checks the gate (client hiding is convenience).
- [ ] **Step 4: Run — PASS**; a11y both themes → PASS.
- [ ] **Step 5: Coverage + commit.**

```bash
git add apps/till/src/screens/till-floor-screen.* apps/till/src/api/client.ts
git commit -s -m "feat(till): floor map/list toggle + unplaced tray + on-till Editar plano"
```

---

### Task 7: Dashboard Sala editor — per-zone floor-plan editor

**Files:**
- Modify: `apps/dashboard/src/screens/sala-screen.ts` (+ tests), `apps/dashboard/src/api/client.ts`

**Interfaces:**
- Consumes: `wt-floor-canvas` (Task 5); the management placement routes (Task 3); FP-1's `sala-screen`.
- Produces: `DashboardApi.setTablePlacement(tableId, body)` / `clearPlacement(tableId)`; a per-zone floor-editor tab.

- [ ] **Step 1: Add + test `DashboardApi` placement methods** (stub — `PUT/DELETE /management-api/tables/:id/placement`). Run → implement → PASS.
- [ ] **Step 2: Write the failing screen test** — the Sala screen gains a **Plano** tab per zone hosting `wt-floor-canvas` in edit mode; a `placement-change` calls `api.setTablePlacement`:

```ts
it("persists a placement from the dashboard floor editor", async () => {
  const api = fakeDashboardApi({ zones: [{ id: "z1", name: "Comedor" }], tables: [{ id: "t1", label: "4", zoneId: "z1" }] });
  const el = await fixture(html`<sala-screen .api=${api}></sala-screen>`);
  await el.updateComplete;
  el.shadowRoot!.querySelector('[data-tab="plano"]')!.dispatchEvent(new Event("click"));
  await el.updateComplete;
  el.shadowRoot!.querySelector("wt-floor-canvas")!
    .dispatchEvent(new CustomEvent("placement-change", { detail: { tableId: "t1", posX: 200, posY: 300, shape: "rect", rotation: 90, zoneId: "z1" }, bubbles: true, composed: true }));
  expect(api.setTablePlacement).toHaveBeenCalledWith("t1", expect.objectContaining({ shape: "rect" }));
});
```

- [ ] **Step 3: Run — FAIL → implement** the Plano tab (reuse `wt-floor-canvas`, `.editable`), wiring `@placement-change`/`@placement-clear` to the `DashboardApi` methods. `role="alert"` for `placement.invalid`.
- [ ] **Step 4: Run — PASS**; a11y both themes → PASS.
- [ ] **Step 5: Coverage + commit.**

```bash
git add apps/dashboard/src/screens/sala-screen.* apps/dashboard/src/api/client.ts
git commit -s -m "feat(dashboard): per-zone floor-plan editor in the Sala screen"
```

---

### Task 8: Fiscal-independence, guard sweep, backlog

**Files:**
- Modify: the FP-1 huella-independence test; `docs/backlog.md`

- [ ] **Step 1: Grep the fiscal boundary** — `grep -rn "pos_x\|posX\|rotation\|\bshape\b" packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts` → expect **zero hits**. Record command + output in the commit.
- [ ] **Step 2: Extend the huella-independence test** — file the same basket for a **placed** table and a walk-up; assert identical `huella` (placement never reaches the filed record). Run → PASS (if it fails, a placement field leaked — fix the leak, not the test).
- [ ] **Step 3: Full guard sweep** — `pnpm --filter @waitron/db test:coverage` (unfiltered); `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`; `pnpm lint && pnpm typecheck && pnpm format:check`; the root Vitest project. **No churn expected** (no new package, no manifest change) — confirm by grep that no test pins a list this slice altered.
- [ ] **Step 4: Flip the `docs/backlog.md` FP-2 row to BUILT** — record FP-2 (spatial canvas + editor) **LANDED** (with the PR/issue number), on-till editing **manager-on-till** (supervisor-override deferred). Note the floor-plan surface is now complete through FP-2; KDS + bookings remain to spec.
- [ ] **Step 5: Commit.**

```bash
git add packages/**/*huella*.test.ts docs/backlog.md
git commit -s -m "test(fiscal): huella independent of placement; docs(backlog): floor-plan FP-2 built"
```

---

## Self-Review (completed at plan-writing time)

**1. Spec coverage** — §2a placement columns → T1; §2b migration → T1; §3a verbs → T2; §3b read → T2; §3c dashboard route → T3, on-till route → T4; §4 fiscal → T8; §5a shared canvas → T5; §5b till map view → T6; §5c dashboard editor → T7; §6 conventions → T2/T4/T8; §7 testing → distributed + T8. No gaps.

**2. Placeholder scan** — no "TBD"/"add validation"/"similar to Task N"; every code step carries real code. `FLOOR_ASPECT`, the size thresholds, and coord ranges are concrete constants. The only forward-deferral is the FP-1/TS-1/TS-2 re-verification (Prerequisites) + the `db:generate` number — both flagged.

**3. Type consistency** — `posX/posY/shape/rotation` named identically across T1 (column), T2 (verb + read), T3/T4 (routes), T5 (`placement-change` detail), T6/T7 (client). `placement.invalid { field }` consistent T2→T3→T4→T7. `wt-floor-canvas` events `open-table`/`placement-change`/`placement-clear` named once (T5) and consumed unchanged (T6/T7). `sizeForCapacity`/`FLOOR_ASPECT` defined once in `floor.ts` (T5).

**Known cross-slice risk** (flagged): FP-1's occupancy-token may live in `apps/till`; Task 5 extracts its pure render into `packages/ui/floor.ts` if so, so the canvas and the list view share one token — re-verify at execution.
