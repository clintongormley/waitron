# Workforce — Staff-Facing Request Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **staff-facing request half** of shift swaps and absences — the counterpart to #87's manager-approval half. A logged-in till operator (a `staff`-role person, identified by their PIN shift-session) can: view **their own** upcoming shifts, **request** a shift give-away / cover (offer one of their shifts to a named colleague), **accept** a swap offered **to them**, view **their own** absences, and **request** an absence. #87 built `decideSwap`/`setAbsenceStatus`/`listPendingSwaps`/`listPendingAbsences` (the approval queue) but no surface FEEDS them; this slice is that feed.

**Surface decision (owner, 2026-08-16):** the **till PIN session today**, with the design kept **surface-agnostic** so a **staff dashboard portal later** reuses the same verbs and read-models by swapping only the session→personId resolver. The requester's identity ALWAYS comes from the authenticated session (`session.person_id`), NEVER from the request body — that is the core security property of this slice.

**Architecture:** Two correctness fixes to the existing `@waitron/workforce` swap verbs (`acceptSwap` requested-only guard + new `swap.not_acceptable` code; `requestSwap` return-shift ownership) → three new **person-scoped** read-models (`listShiftsForPerson`, `listSwapsForPerson`, `listAbsencesForPerson`, all filtering on the requester's `person_id` in application code, since RLS is tenant-scoped only) → a new `apps/server` `mountScheduleApi` route group gated by the till `requireSession` (requester = `session.personId`), wired into `boot.ts` → new `TillApi` client methods + a `<till-schedule-screen>` reachable from the counter, wired into `till-app.ts`'s screen machine (Lit 3 + `@waitron/ui`, axe both themes) + till i18n copy and code messages.

**Tech Stack:** TypeScript (pnpm workspace), Drizzle `sql` templates over PGlite + real Postgres (Testcontainers), Hono routes, Lit 3 + `@waitron/ui` primitives, Vitest (Node + happy-dom/Chromium browser), axe-core.

**Spec:** none — this is a bounded fast-follow to #87 (spec `docs/superpowers/specs/2026-08-15-workforce-roster-management-slice2-design.md`); the design rationale is inline here.

## Global Constraints

- **TDD, always.** Failing test FIRST, run it, watch it fail for the right reason, minimal implementation, watch it pass, commit. Every guard is **proven by deletion** (remove the guard → test goes red → restore it); every negative control is confirmed to fail for the reason you think it does (CLAUDE.md §4).
- **The requester identity is the session's, never the body's.** Every write route resolves `personId` from `requireSession(deps, c)` and passes THAT as `requestedByPersonId` / `acceptingPersonId` / `personId`. A route must not read a `personId`/`requestedByPersonId` field from the JSON body at all. A real-Postgres test proves a staff member cannot request/accept/read as someone else (Task 3), proven by deletion.
- **NO migration.** The tables (`shift_swaps`, `absences`, `shifts`) and grants already exist: `app_user` holds `SELECT, INSERT, UPDATE, DELETE` on the planning tables (`packages/workforce/drizzle/0008_scheduling_planning_rls.sql:45-52`) and on `shifts` (`0006_scheduling_rls.sql`). The request path only READs and INSERTs via existing verbs. If a task appears to need a migration, STOP and flag it. (This also keeps the `packages/db`/workforce `drizzle/meta/_journal.json` untouched — no collision with any parallel branch.)
- **Error codes name the DOMAIN concept, never the package** (`packages/shared/src/errors.ts`); **never renamed once shipped.** The one new code, **`swap.not_acceptable`**, was grepped against its siblings `swap.not_found` (`errors.ts:120`), `swap.not_permitted` (`errors.ts:126`), `swap.not_decidable` (`errors.ts:133`) — all `swap.not_<x>`, and it mirrors `swap.not_decidable`'s exists-but-wrong-state shape. `requestSwap`'s new return-shift-ownership check **reuses `swap.not_permitted`** (the same "this swap arrangement is not permitted" concept the from-shift check already uses) — its doc comment is extended, no new code. Every file that `throw new AppError(...)` imports its registry directly (`shift-swaps.ts:7` already does).
- **No backwards-compatibility / data-migration code** (CLAUDE.md §3). Nothing is deployed.
- **Spanish schema tokens** — this slice adds NO new schema identifiers. Engine identifiers stay English (`packages/workforce` is scanned by the english-only guard; `apps/*` is exempt, so till UI Spanish copy is translation, not schema vocabulary). Run `@waitron/workforce` **unfiltered** so `english-only`/`index.test.ts` load.
- **Coverage thresholds:** `@waitron/workforce` / `@waitron/server` are `98/98/98/95` (statements/lines/functions/branches); `@waitron/till` is `95/95/90/88` (`apps/till/vitest.config.ts`). CI shards + the pre-push hook gate on **`test:coverage`, not `test`** — run `pnpm --filter <pkg> test:coverage` before claiming green (CLAUDE.md §2).
- **Run each changed package UNFILTERED before believing a pass** (CLAUDE.md §2/§4) — a name-filtered run skips the package's tree-wide guards.
- **Real-Postgres suites require `TESTCONTAINERS_RYUK_DISABLED=true` locally** (CLAUDE.md §4) or they hang to the 180s hook timeout.
- **No new tenant-scoped table is added, so the fiscal `inmutabilidad` guard needs no new coverage** — but this slice touches nothing near the fiscal core (H2): `shift_swaps`/`absences`/`shifts` are commercial/management-lane planning tables, no `computeHuella`/hash-chain/`registros`/invoice-number path. A whole-branch review must confirm the boundary.
- **Every commit is `git commit -s`.** Feature work happens in this worktree (`waitron-feat-workforce-staff-request-path`), not the main checkout — the worktree already exists; do NOT create one.

---

## Resolved facts (read before starting)

1. **The verbs already exist and self-gate on identity ownership.** `requestSwap` checks `fromShift` is owned by `requestedByPersonId` (`shift-swaps.ts:46-51`, `swap.not_permitted`); `acceptSwap` checks the acceptor is the `to_person` (`:85-90`). Two gaps this slice closes (the recorded workforce debt, backlog "Swap-workflow hardening"): `acceptSwap` has **no `status='requested'` guard** (`:91-93` — any status can be flipped back to `accepted`), and `requestSwap` **never checks the return `toShift` is owned by `toPerson`** (`:52-57` — it only checks the shift EXISTS).

2. **`createAbsence` is the absence "request" verb** (`absences.ts:44-64`) — there is no function named `requestAbsence`. It inserts status `requested`, rejecting an overlapping range for the same person (`absence.overlaps`). Reuse it as-is; the route supplies `personId` from the session.

3. **RLS on the planning tables is tenant-scoped only** (`0008_scheduling_planning_rls.sql:26-41`, `USING (tenant_id = current_tenant_id())`) — there is NO per-person row policy. "A staff member sees/acts on only their own rows" MUST be enforced in application code (the read verbs' `person_id` predicate + the routes passing the session's personId). Do not rely on the database for it.

4. **`shift_swaps` has no `location_id`** (the location lives on the referenced shifts). Person-scoping is on `requested_by_person_id` / `to_person_id`. The `shifts` table has the index `shifts_tenant_person_starts_idx` on `(tenant_id, person_id, starts_at)` (`schema/shifts.ts:81`) — `listShiftsForPerson`'s window read is covered by it.

5. **`index.test.ts` pins the exact RUNTIME export surface** (`packages/workforce/src/index.test.ts`, `Object.keys(api).sort()`). Adding the VALUE exports `listShiftsForPerson`/`listSwapsForPerson`/`listAbsencesForPerson` to `index.ts` REQUIRES adding them to that array, or the test goes red. Type-only exports do not appear in `Object.keys`.

6. **The till already has the colleague roster** — `GET /api/staff` → `TillApi.listStaff()` returns `{ personId, displayName }[]` for active staff (unauthenticated, pre-login; `till-api.ts:180`, `client.ts:253`). The swap-request form uses it for the "offer to" colleague picker; no new endpoint needed. `session.personId` (not in that list's shape) is the current operator — filter self out of the picker.

7. **The till screen machine is `type Screen = "lock" | "counter" | "ticket"`** (`till-app.ts:35`), one screen shown at a time, basket preserved across screen switches (logout keeps it — `:696`). This slice adds a `"schedule"` member, a counter→schedule entry (a `show-schedule` event + a header control) and a schedule→counter return, both basket-preserving.

8. **Minimal-UI scope = the give-away / cover flow** (`toShiftId = null`, the schema's documented one-sided case, `schema/shift-swaps.ts` doc). The two-sided return-shift picker needs cross-person shift visibility (a colleague's roster) — deferred, out of this slice — but the `requestSwap` return-shift-ownership **verb** fix still lands (Task 1), defending the API for when a `toShift` is supplied.

9. **`apps/till` uses an i18n layer** (`apps/till/src/i18n/`: `strings.ts` en-base + `es`, `t.ts`, `codes.ts` code→copy with a generic fallback). New UI copy → `strings.ts`; new `swap.*`/`absence.*` code messages → `codes.ts` (degrade an unmapped code to the generic sentence, never the raw code — the #82 dashboard-i18n pattern).

---

## File Structure

**Create:**
- `apps/server/src/schedule-api.ts` + `schedule-api.test.ts` (PGlite route mechanics) + `schedule-api.rls.test.ts` (real-PG: tenant isolation + the session-is-the-requester identity property, both by deletion).
- `apps/till/src/screens/till-schedule-screen.ts` + `.test.ts` + `.a11y.test.ts`.

**Modify:**
- `packages/workforce/src/shift-swaps.ts` — `acceptSwap` requested-only guard; `requestSwap` return-shift ownership; the three person-scoped read-models + their row/input types.
- `packages/workforce/src/errors.ts` — the one new code `swap.not_acceptable`; extend `swap.not_permitted`'s doc for the return-shift case.
- `packages/workforce/src/index.ts` — new value + type exports.
- `packages/workforce/src/index.test.ts` — the runtime export-name array.
- `packages/workforce/src/shift-swaps.test.ts` — new PGlite tests for the two fixes + three read-models.
- `apps/server/src/boot.ts` — `mountScheduleApi(app, { db, cfg: { tenantId }, ... }, log)` beside the existing till/workforce mounts.
- `apps/till/src/api/client.ts` + `client.test.ts` — new methods (`listMyShifts`, `listMySwaps`, `requestSwap`, `acceptSwap`, `listMyAbsences`, `requestAbsence`) + browser-local row types.
- `apps/till/src/till-app.ts` + `till-app.test.ts` + `till-app.a11y.test.ts` — the `"schedule"` Screen member, the `show-schedule`/`back-to-counter` wiring (basket-preserving), `#renderScreen`, the screen-element import.
- `apps/till/src/screens/till-counter-screen.ts` + tests — a "My schedule" control that emits `show-schedule` (bubbling, composed).
- `apps/till/src/i18n/strings.ts`, `codes.ts` (+ tests) — schedule-screen copy, swap/absence code messages, absence-kind + swap/absence-status display names.

---

## Task 1: Workforce — swap-verb hardening (two fixes + `swap.not_acceptable`)

**Files:** Modify `packages/workforce/src/shift-swaps.ts`, `packages/workforce/src/errors.ts`; test `packages/workforce/src/shift-swaps.test.ts`.

**Fix A — `acceptSwap` requested-only guard.** Currently the UPDATE (`:91-93`) matches on `(tenant_id, id)` with no status predicate, so an `accepted`/`approved`/`rejected` swap can be flipped back to `accepted` by the `to_person`. Change it to the `decideSwap` pattern (`:117-139`): a single conditional `UPDATE … WHERE … AND status = 'requested' RETURNING id`; on no-match, one SELECT disambiguates `swap.not_found` (absent) vs the NEW `swap.not_acceptable` (exists but not `requested`). Keep the existing `to_person` permission check BEFORE the state check (a non-recipient gets `swap.not_permitted` whatever the status — screen identity before state, mirroring the read order today).

**Fix B — `requestSwap` return-shift ownership.** After the existing `toShift`-exists check (`:52-57`), also require `toShiftOwner === input.toPersonId`; otherwise `throw new AppError("swap.not_permitted", { tenantId, personId: input.toPersonId })` — the offered return shift is not owned by the person the swap is offered to. Extend `swap.not_permitted`'s doc comment in `errors.ts` to name this third case.

**New code** in `errors.ts`: `"swap.not_acceptable": { tenantId: string; swapId: string }` with a doc comment mirroring `swap.not_decidable` (exists-but-wrong-state; grepped against siblings; never renamed).

**Tests (PGlite — pure planning data, no privilege/RLS/concurrency need; state why in a comment):**
- `acceptSwap` on a `requested` swap by the `to_person` → `accepted` (unchanged happy path).
- `acceptSwap` on an already-`accepted`/`approved`/`rejected` swap by the `to_person` → `swap.not_acceptable` (NEW). **Prove by deletion:** drop the `status='requested'` predicate → the already-accepted case stops throwing → red.
- `acceptSwap` by a non-recipient on a `requested` swap → still `swap.not_permitted` (identity beats state).
- `acceptSwap` on an absent id → `swap.not_found`.
- `requestSwap` with a `toShift` owned by a THIRD person → `swap.not_permitted` (NEW). **Prove by deletion:** drop the `toShiftOwner === toPersonId` check → red.
- `requestSwap` with a `toShift` owned by `toPerson` → succeeds (the two-sided happy path still works).
- `requestSwap` with `toShiftId = null` → succeeds (give-away unaffected).

**Verify:** `pnpm --filter @waitron/workforce test:coverage` (unfiltered).

---

## Task 2: Workforce — person-scoped read-models

**Files:** Modify `packages/workforce/src/shift-swaps.ts` (or a new `schedule-reads.ts` if cleaner), `index.ts`, `index.test.ts`; test `shift-swaps.test.ts`.

Add three read-models, each **filtering on the requester's `person_id` in SQL** (RLS is tenant-only, fact 3), with the date normalisation the sibling read-models use (`to_char(... at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` for timestamptz, `::text` for `date`):

- **`listShiftsForPerson(tx, { tenantId, personId, from, to })`** → the requester's shifts with `starts_at` in the half-open `[from, to)` window (YYYY-MM-DD bounds compared against the local wall date `(starts_at at time zone 'UTC' + offset)`, the `publishRoster`/`getPlannedVsActual` pattern), ordered by `starts_at`. Row: `{ id, locationId, startsAt, startsOffsetMinutes, endsAt, endsOffsetMinutes, role, rosterVersionId }`.
- **`listSwapsForPerson(tx, { tenantId, personId })`** → swaps where `to_person_id = personId` OR `requested_by_person_id = personId`, ordered by `created_at` desc. Each row carries a `direction: "offered_to_me" | "requested_by_me"` discriminator (derived from which column matched; a swap can only match one since a requester can't offer to themselves — but assert that) plus the full swap fields + `status`. The UI uses `direction === "offered_to_me" && status === "requested"` to show an Accept control.
- **`listAbsencesForPerson(tx, { tenantId, personId })`** → the requester's absences, all statuses, ordered by `starts_on` desc. Row mirrors `PendingAbsenceRow` (+ `decidedBy`/`decidedAt` if useful; keep minimal).

Export all three (value) + their row types from `index.ts`; add the three names to `index.test.ts`'s runtime-export array.

**Tests (PGlite):** for each, seed rows for the requester AND a second person under the same tenant, assert only the requester's are returned. **Prove by deletion:** drop the `person_id` predicate → the other person's rows leak → red. Window edges for `listShiftsForPerson` (a shift exactly at `from` included, at `to` excluded). `direction` correctness for a swap the person requested vs one offered to them.

**Verify:** `pnpm --filter @waitron/workforce test:coverage` (unfiltered) — `index.test.ts` export pin must be green.

---

## Task 3: Server — `mountScheduleApi` (till-session-gated staff routes)

**Files:** Create `apps/server/src/schedule-api.ts`, `schedule-api.test.ts`, `schedule-api.rls.test.ts`; modify `apps/server/src/boot.ts`.

`mountScheduleApi(app, deps, log)` where `deps = { db, cfg: { tenantId } }` (the same shape `mountWorkforceApi` takes; it also needs whatever `requireSession` needs — `{ db, cfg }`). Every route resolves the requester via `requireSession(deps, c)` FIRST (returns `{ personId }`) and passes THAT personId into the verb — the body is never trusted for identity. Reuse the `createErrorBoundary(STATUS, "schedule.failed")` pattern (`error-boundary.ts`), the `isUuid`/`requireBodyUuid`/`requirePeriod`/`requireNullableString` screens from `workforce-api.ts` (extract shared ones if duplicated — or import; do not re-implement subtly differently), and a `requireAbsenceKind` screen (one of `holiday|sick_leave|leave|unpaid`, else `management.request_invalid`-style 400 — reuse a `schedule.request_invalid`? NO: reuse the existing generic request-invalid code family; if none fits a till route, use `shared.invalid_id`/a 400 the boundary maps — decide during TDD, do not invent a package-named code).

Routes (prefix `/api/schedule`):
- `GET /api/schedule/shifts?from&to` → `listShiftsForPerson({ tenantId, personId, from, to })`.
- `GET /api/schedule/swaps` → `listSwapsForPerson({ tenantId, personId })`.
- `POST /api/schedule/swaps` `{ fromShiftId, toPersonId, toShiftId|null }` → `requestSwap({ tenantId, requestedByPersonId: personId, fromShiftId, toPersonId, toShiftId })`, returns `{ swapId }` 201.
- `POST /api/schedule/swaps/:swapId/accept` → `acceptSwap({ tenantId, swapId, acceptingPersonId: personId })`, 204.
- `GET /api/schedule/absences` → `listAbsencesForPerson({ tenantId, personId })`.
- `POST /api/schedule/absences` `{ kind, startsOn, endsOn, note|null }` → `createAbsence({ tenantId, personId, kind, startsOn, endsOn, note })`, returns `{ absenceId }` 201.

STATUS map: `session.required`→401, `swap.not_found`→404, `swap.not_permitted`→403, `swap.not_acceptable`→409, `shift.not_found`→404, `absence.overlaps`→409, plus the request-invalid→400 and `shared.invalid_id`→400. Wire into `boot.ts` beside `mountWorkforceApi` (`boot.ts:341`), reusing the same `db`/`till.tenantId`.

**Tests:**
- `schedule-api.test.ts` (PGlite): happy paths + validation 400s + the not-logged-in 401 (no cookie → `session.required`).
- `schedule-api.rls.test.ts` (real-Postgres, `describeEachTarget`/`useRealPostgres`; `TESTCONTAINERS_RYUK_DISABLED=true`): (a) tenant isolation — a session under tenant A cannot see tenant B's shifts/swaps/absences; (b) **the identity property** — with two persons P and Q under one tenant, a request authenticated as P's session that puts Q's id in the body still acts as P (the body id is ignored): `requestSwap` files with `requested_by_person_id = P`, `GET /shifts` returns only P's shifts. **Prove by deletion:** make a route read `body.personId` instead of the session → the cross-person test goes red. Both under the non-superuser `app_user` with FORCE RLS.

**Verify:** `pnpm --filter @waitron/server test:coverage` (unfiltered).

---

## Task 4: Till API client — typed methods

**Files:** Modify `apps/till/src/api/client.ts`, `client.test.ts`.

Add methods mirroring the Task 3 routes, with browser-LOCAL row types (never a runtime `@waitron/*` import — the bundle rule, `client.ts:11-17`): `listMyShifts(from, to)`, `listMySwaps()`, `requestSwap({ fromShiftId, toPersonId, toShiftId })`, `acceptSwap(swapId)`, `listMyAbsences()`, `requestAbsence({ kind, startsOn, endsOn, note })`. Each funnels through the existing `#request` (credentials: include). Local interfaces: `MyShift`, `MySwap` (with `direction`/`status`), `MyAbsence`, `AbsenceKind` union. TDD via the injected-fetch stub pattern already in `client.test.ts`.

**Verify:** `pnpm --filter @waitron/till test:coverage` (unfiltered).

---

## Task 5: Till UI — `<till-schedule-screen>` + navigation + i18n

**Files:** Create `apps/till/src/screens/till-schedule-screen.ts` (+ `.test.ts` + `.a11y.test.ts`); modify `till-app.ts` (+ tests), `till-counter-screen.ts` (+ tests), `i18n/strings.ts`, `i18n/codes.ts` (+ tests).

`<till-schedule-screen>` (Lit + `@waitron/ui` primitives, `baseStyles`, HA-free — this is the till's own design system) takes `.api`, `.staff` (the roster for the colleague picker), and the current `.operatorPersonId`. On connect it loads my shifts (a sensible default window, e.g. the next ~14 days), my swaps, my absences. It renders:
- **My upcoming shifts** — a list (date/time/role/location).
- **Swaps offered to me** — the `direction==="offered_to_me" && status==="requested"` subset, each with an **Accept** control → `acceptSwap` → reload.
- **Request a cover** — pick one of my shifts + a colleague (roster minus self) → `requestSwap({ fromShiftId, toPersonId, toShiftId: null })` → reload. (Two-sided return-shift deferred, fact 8.)
- **My absences** + a **Request absence** form (kind select + from/to dates + optional note) → `requestAbsence` → reload; surface `absence.overlaps` as a friendly message.

Errors surface as non-fatal banners via the till `codes.ts` code→copy (never a raw code). A "Back to counter" control emits `back-to-counter`. Wire into `till-app.ts`: add `"schedule"` to `Screen`, a `show-schedule` handler (from the counter) that switches screen WITHOUT clearing the basket (like logout), a `back-to-counter` handler, `#renderScreen` case, and the element import. Add a "My schedule" control to `till-counter-screen`'s header emitting `show-schedule` (bubbling, composed). i18n: add all copy to `strings.ts` (en + es) and the new `swap.*`/`absence.*`/validation code messages to `codes.ts`.

**Tests:** view tests (happy paths + each action + the offered-to-me Accept + the overlap-error banner + basket-preserved-across-navigation), a11y (axe) in BOTH themes for the new screen and the counter's new control, and the till-app wiring tests. **Prove** the basket survives a schedule round-trip (navigate to schedule and back → store lines intact).

**Verify:** `pnpm --filter @waitron/till test:coverage` (unfiltered); `pnpm --filter @waitron/till test` for the a11y/browser shard.

---

## Task 6: Whole-slice verification + finish

- `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test` from the worktree root (the four-command gate, CLAUDE.md §2), plus `test:coverage` on each changed package.
- Confirm the **fiscal boundary (H2)** by grep: no `computeHuella`/`registros`/`invoice_series`/hash-chain path is touched; a whole-branch review confirms.
- Confirm **no migration** landed (`git status` shows no `drizzle/` or `meta/_journal.json` change).
- Then the finish-branch flow: whole-branch base-to-tip review → fix wave → 4-lens simplify → Copilot → PR. Do NOT merge (owner's `/land-branch`).

**Deferred follow-ups (record in the PR + backlog on land):**
- The **staff dashboard portal** (owner: "we'll want it later") — reuses these verbs/read-models with a management/staff session resolver.
- The **two-sided swap** (offer to take a colleague's specific return shift) — needs cross-person shift visibility.
- A staff-facing **cancel/withdraw** of one's own pending swap/absence request (not built; only request + accept here).
- Widening the read window / pagination for `listShiftsForPerson` (fixed default window this slice).
