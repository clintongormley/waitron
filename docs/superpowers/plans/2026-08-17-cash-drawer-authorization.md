# Cash-drawer authorization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the manual drawer-open by a configurable per-location policy (default gated), building the first till-side `authorize()`-with-supervisor-override path + a reusable override dialog, and stamping who authorized.

**Architecture:** A `cash.drawer` permission (supervisor+); a `locations.drawer_open_policy` (`gated`/`open`); `POST /api/drawer/open` upgraded to parse an optional `override:{personId,pin}` and call `authorize(sessionId, "cash.drawer", override)` in gated mode; `drawer_opens` records `authorized_by` + `via_override`; a reusable supervisor-override dialog on the till. Reuses `authorize()` unchanged. Non-fiscal.

**Tech Stack:** TypeScript, Drizzle + PostgreSQL (RLS), Hono, Lit + Vite, Vitest, Testcontainers + PGlite.

**Spec:** [docs/superpowers/specs/2026-08-17-cash-drawer-authorization-design.md](../specs/2026-08-17-cash-drawer-authorization-design.md).

## ⛔ Prerequisites — BLOCKED until receipt + drawer lands

Re-verify first (CLAUDE.md §1): the receipt+drawer `POST /api/drawer/open` route + `drawer_opens` + `drawer.no_printer` + the till's receipt-printer resolution; `authorize(tx, { sessionId, permission, override? }) → { authorizedBy, viaOverride }` (`authorize.ts:39-67`); the verb-side pattern `record-void.ts:58-62`; `requireSession → { personId, sessionId }` (`till-session.ts:76-95`); the `SUPERVISOR` permission set (`permissions.ts:42-47`) + `permissions.test.ts`; `till-config.ts:183-203` (the per-location-column read precedent).

## Global Constraints

- **English identifiers** — `drawer_open_policy`, `authorized_by`, `via_override`. No new `SPANISH_WORDS`. UI copy en/es.
- **Reuse `authorize()` unchanged** — do not reimplement the gate; the route parses the override and calls it. A test asserts the call with `permission:"cash.drawer"` + the parsed override.
- **Domain codes** — reuse `authorization.not_permitted` (403) + `drawer.no_printer`. New permission `cash.drawer` (supervisor+manager+admin). **Churn:** `permissions.test.ts`.
- **The auto-open on a cash SALE is unchanged** (receipt+drawer) — this slice only touches the manual open.
- **Non-fiscal** — grep receipt; the audit is append-only.
- **No back-compat / data-migration** (pre-production). **Migration via `db:generate`.** Re-run `inmutabilidad`.
- **Coverage:** db, server, identity → 98/98/98/95; till, dashboard → 95/95/90/88. Real-PG for the authorize/override behaviour (a false pass on PGlite for RLS, but the permission/override logic is testable on either — use real-PG for the role/override e2e). `TESTCONTAINERS_RYUK_DISABLED=true`. Prove the gate by deletion.

## File Structure

**Created:** `packages/db/drizzle/<NNNN>_drawer_authorization.sql` (+ custom part).
**Modified:** `packages/identity/src/permissions.ts` (+ test); `packages/db/src/schema/{locations, drawer-opens}.ts`; `apps/server/src/{till-api.ts (the drawer route), management-api.ts}`; `apps/till/src/{screens/…, widgets/supervisor-override-dialog.ts (new), api/client.ts}`; `apps/dashboard/src/{screens/…, api/client.ts}`; `docs/backlog.md`.

---

### Task 1: `cash.drawer` permission + `drawer_open_policy` + audit columns

- [ ] **Step 1:** Failing test — `roleHasPermission("supervisor","cash.drawer")` true, `("staff",…)` false. Add `cash.drawer` to `PERMISSIONS` + the `SUPERVISOR` set; update `permissions.test.ts`. PASS.
- [ ] **Step 2:** Schema — `drawer_open_policy` pgEnum (`['gated','open']`) + a `locations.drawer_open_policy` column (default `'gated'`); `drawer_opens.authorized_by uuid` (bare) + `via_override bool NOT NULL DEFAULT false`.
- [ ] **Step 3:** `db:generate` → verify. Custom `<NNNN+1>` migration — the `drawer_opens.authorized_by` composite/`persons` FK. Register in `_journal.json`.
- [ ] **Step 4:** Real-PG — the columns visible under `app_user`; `drawer_opens` still append-only; `inmutabilidad` green. `pnpm --filter @waitron/db test:coverage` (unfiltered).
- [ ] **Step 5:** Commit. `git commit -s -m "feat(identity+db): cash.drawer permission + drawer_open_policy + audit columns"`

---

### Task 2: The till authorize()-with-override route

- [ ] **Step 1:** Failing e2e (real-PG):
```ts
it("gated: supervisor opens directly; staff needs a valid supervisor override", async () => {
  await setDrawerPolicy(cfg, "gated");
  const sup = await loginOperator("supervisor"); const cashier = await loginOperator("staff");
  expect((await POST("/api/drawer/open", { session: sup })).status).toBe(200);      // holds cash.drawer
  await expect(POST("/api/drawer/open", { session: cashier })).resolves.toMatchObject({ status: 403 }); // no override
  const ok = await POST("/api/drawer/open", { session: cashier, body: { override: { personId: supId, pin: SUP_PIN } } });
  expect(ok.status).toBe(200);
  const open = await lastDrawerOpen(); expect(open).toMatchObject({ authorizedBy: supId, viaOverride: true });
  await expect(POST("/api/drawer/open", { session: cashier, body: { override: { personId: supId, pin: "0000" } } }))
    .resolves.toMatchObject({ status: 403 });                                         // wrong PIN
});
it("open policy: any operator opens directly", async () => { await setDrawerPolicy(cfg,"open"); /* staff → 200, viaOverride:false */ });
```
- [ ] **Step 2:** Run → FAIL → implement — upgrade `POST /api/drawer/open`: `requireSession` → read `drawer_open_policy`; `open` → proceed (`authorizedBy=personId`); `gated` → parse `override` from the body → `authorize(tx, { sessionId, permission:"cash.drawer", override })` (mirror `record-void.ts:58-62`) → `authorizedBy=authz.authorizedBy`, `viaOverride=authz.viaOverride`; enqueue the kick + INSERT `drawer_opens` with the stamps. `drawer.no_printer` unchanged.
- [ ] **Step 3:** **Prove the gate by deletion** — drop the `authorize()` call → the staff-no-override case wrongly 200s (red); restore. Assert `authorize()` is called (not reimplemented).
- [ ] **Step 4:** PASS, coverage. Commit. `git commit -s -m "feat(server): drawer-open authorize() + supervisor override + audit"`

---

### Task 3: The reusable supervisor-override dialog (till)

- [ ] **Step 1:** Failing tests — in `gated` policy, a non-permitted operator tapping Abrir cajón opens the override dialog (a supervisor picker + PIN → `{personId,pin}` sent with the request); a supervisor / `open` policy opens with no dialog; the PIN is sent only on the authenticated request (never logged/stored).
- [ ] **Step 2:** Run → FAIL → implement `supervisor-override-dialog.ts` (a `@waitron/ui`-based dialog: pick an eligible supervisor + PIN, emit `{personId,pin}`) + wire it to the drawer button; `TillApi.openDrawer(override?)`. **Built reusable** — a generic "authorize this action" dialog other privileged actions reuse. a11y both themes.
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(till): reusable supervisor-override dialog + drawer-open wiring"`

---

### Task 4: Dashboard drawer-open policy toggle

- [ ] **Step 1:** Failing test — the venue-config surface toggles `drawer_open_policy` (`gated`/`open`); `DashboardApi.setDrawerOpenPolicy`. Run → FAIL → implement (`printer.manage`/venue config). a11y both themes.
- [ ] **Step 2:** PASS, coverage. Commit. `git commit -s -m "feat(dashboard): drawer-open policy toggle"`

---

### Task 5: Fiscal grep, guards, backlog

- [ ] **Step 1:** H2 grep — the drawer/authorize touch nothing filed; `record-sale.ts`/alta builders unchanged. Record.
- [ ] **Step 2:** Guard sweep — `pnpm --filter @waitron/db test:coverage` (unfiltered); `inmutabilidad`; `pnpm lint && pnpm typecheck && pnpm format:check`; root Vitest; `permissions.test.ts` green.
- [ ] **Step 3:** Flip `docs/backlog.md` — cash-drawer authorization **BUILT**; note the **first till-side authorize()-with-override path + the reusable override dialog** now exist, which **on-till config** (device-identity manager-on-till, FP-2 Editar plano) and future till void/refund reuse. **The whole surface is now specced/planned with nothing left to design.**
- [ ] **Step 4:** Commit. `git commit -s -m "docs(backlog): cash-drawer authorization built; chore: H2 grep"`

---

## Self-Review (completed at plan-writing time)

**1. Spec coverage** — §2 permission/policy/audit → T1; §3 the authorize-override route → T2; §5 override dialog + policy → T3/T4; §4 fiscal → T5. No gaps.

**2. Placeholder scan** — real test/impl throughout; deferrals are the receipt+drawer/`authorize()` re-verification (Prerequisites) + the `db:generate` number — both flagged. The override-dialog person-picker uses the eligible-supervisor set (concrete), not a vague "pick someone".

**3. Type consistency** — `drawer_open_policy` values `gated`/`open` consistent T1→T2→T4; `authorized_by`/`via_override` consistent T1→T2; `openDrawer(override?)` + `{personId,pin}` consistent T2→T3; `authorize()` reused (not redefined); `cash.drawer` in `SUPERVISOR` consistent T1→T2. The gate-by-deletion (T2) and the four role/override e2e cases are the load-bearing security proofs.

**Known risk** (flagged): this is the **first** till route to parse a supervisor override — a security review is warranted (the override PIN handling, the eligible-supervisor resolution, the audit completeness); fold it into the finish-branch review at build. The override dialog is built reusable so on-till config doesn't re-invent it (re-verify that reuse when those slices build).
