# Shift-planning authoring — slice 1 design (2026-08-15)

**Sub-project 16 (Workforce).** The scheduling *engine* landed headless as #50; this slice gives it a
management-dashboard surface so a manager can **author a draft weekly roster, see the advisory breach
warnings, and publish it**. Nothing else.

> **File:line references to existing code in this spec come from the 2026-08-15 research pass and the
> greps recorded in §9. Re-confirm them at implementation time — they are the design's basis, not a
> frozen contract.**

---

## 1. Scope

**In slice 1 — the vertical "author → warn → publish":**

- New draft-authoring verbs in `@waitron/workforce` (the engine ships only `publishRoster`).
- A new `mountWorkforceApi` `/management-api` route group on `apps/server`.
- A new `schedule.manage` permission in `@waitron/identity`.
- A new `<dashboard-roster-screen>` in `apps/dashboard`: a person × day weekly grid.

**Deferred (each its own later slice):** manager approve/reject **swaps** (+ the two missing swap
state transitions + a `swap.approve` permission), **absence** approval, the **planned-vs-actual**
comparison view, and template/availability **generators**. The backlog names the swap-approval flow
as part of this track; it is deferred here to keep slice 1 the size of the staff/catalogue screens.

**Owner decisions (2026-08-15):** slice = author → warn → publish; roster authored as a **person ×
day weekly grid**.

---

## 2. Context — what #50 shipped and the gap

`@waitron/workforce` (PR #50) is fully headless: schema + a pure engine, **no HTTP, no UI, and no
draft-authoring write seam**. The only roster write verb is `publishRoster` (`clocking.ts:357`); the
only inserters of `roster_versions`/`shifts` in the whole package are the test fixtures
(`test/fixtures.ts`). So this slice must *invent* the authoring verbs, not merely surface them.

What already exists and is reused unchanged:

- `WorkforceBackend.publishRoster(tx, input): Promise<RosterBreach[]>` (`clocking.ts:357`) — flips one
  draft → published, supersedes the incumbent, attaches unattached in-period draft shifts, and (only
  if `input.ruleset` is supplied) returns advisory breaches; **publish proceeds regardless of
  breaches** (owner decision 2026-08-02). Throws `roster.already_published` /
  `roster.period_already_published` / `roster.not_found`.
- `validateRoster(shifts, ruleset): RosterBreach[]` (`roster-validation.ts:464`) — pure; the 7
  `RosterBreach` kinds are the union at `roster-validation.ts:129`.
- `resolveWorkTimeRuleset(tx, {tenantId, locationId}): Promise<WorkTimeRuleset>`
  (`@waitron/workforce-es`, `convenio.ts:28`) — maps the venue's `convenio_config` to the neutral
  ruleset; throws `convenio.not_found` when a location has no config.
- **`app_user` already holds `SELECT, INSERT, UPDATE, DELETE` on `roster_versions` and `shifts`**
  (`packages/workforce/drizzle/0006_scheduling_rls.sql:36-39`), with FORCE RLS + tenant-isolation
  policies. **So this slice needs no grants migration and no schema change** — the authoring routes
  write as `app_user` through the existing grants. This is the fact that keeps the slice migration-free.

---

## 3. Components

### 3a. `@waitron/workforce` — draft-authoring verbs (new)

Added to `WorkforceBackend` (same class as `publishRoster`), each taking an open `tx` and a
tenant-scoped input, TDD'd:

- `createRosterVersion(tx, { tenantId, locationId, period }): Promise<string>` — inserts a `draft`
  `roster_versions` row, returns its id. Throws **`roster.draft_exists`** (new code) if a draft
  already exists for `(tenant, location, period)`. (The published-uniqueness index
  `roster_versions_published_period_uq` covers only *published* rows; drafts need their own guard so
  the screen can't silently fork two drafts of one week.)
- `getRoster(tx, { tenantId, locationId, period }): Promise<{ version: RosterVersionRow | null; shifts: ShiftRow[] }>`
  — reads the current draft (or, if none, the published version) for the week and its shifts, for the
  grid.
- `addShift(tx, { tenantId, versionId, personId, locationId, startsAt, startsOffsetMinutes, endsAt, endsOffsetMinutes, role }): Promise<string>`
  — inserts a `shifts` row with `roster_version_id = versionId`. Throws `roster.not_found` if the
  version is missing, **`roster.not_draft`** (new code) if it is not a draft, **`shift.invalid`**
  (new code) if `startsAt >= endsAt`.
- `updateShift(tx, { tenantId, shiftId, ...partial }): Promise<void>` — edit person/times/role.
  Throws **`shift.not_found`** (new code); `roster.not_draft` if the shift's version is published.
- `removeShift(tx, { tenantId, shiftId }): Promise<void>` — throws `shift.not_found`; `roster.not_draft`
  if published.

These live in `@waitron/workforce` (generic); ruleset resolution stays in `@waitron/workforce-es`
(the Spain-specific boundary), reused by the publish route.

**New error codes** (domain-named per `packages/shared/src/errors.ts`, never package-named; grep the
siblings before finalising): `roster.draft_exists`, `roster.not_draft`, `shift.not_found`,
`shift.invalid`. `roster.not_found` and the `roster.*_published` codes already exist (thrown by
`publishRoster`).

### 3b. `@waitron/identity` — `schedule.manage` permission (new)

Append `"schedule.manage"` to `PERMISSIONS` (`packages/identity/src/permissions.ts:7`, currently
`sale.void`/`sale.refund`/`sale.discount`/`sale.rectify`/`person.manage`/`till.configure`) and add it
to the manager + admin role sets (`:30`/`:35`). Code-only — no migration. It gates every workforce
route. (Later slices add `swap.approve` / `absence.decide` beside it.)

### 3c. `apps/server` — `mountWorkforceApi` route group (new)

A new file `apps/server/src/workforce-api.ts` mirroring `catalogue-api.ts`/`mountCatalogueApi`,
mounted in `boot.ts` beside the others. Every route funnels through one `gated()` helper =
`withTenant` + `asAppUser` + `authorizeManager(schedule.manage)`.

| Route | Body / query | Returns |
| --- | --- | --- |
| `GET /management-api/roster?locationId=&period=` | — | `{ version, shifts }` (via `getRoster`) |
| `POST /management-api/roster` | `{ locationId, period }` | `{ versionId }` (via `createRosterVersion`) |
| `POST /management-api/roster/:versionId/shifts` | shift fields | `{ shiftId }` (via `addShift`) |
| `PATCH /management-api/roster/shifts/:shiftId` | partial shift | `204` (via `updateShift`) |
| `DELETE /management-api/roster/shifts/:shiftId` | — | `204` (via `removeShift`) |
| `POST /management-api/roster/:versionId/publish` | — | `{ breaches }` (resolve ruleset → `publishRoster`) |

The publish route resolves the ruleset via `resolveWorkTimeRuleset`; if the location has no
`convenio_config` it surfaces `convenio.not_found` as a 4xx (the manager configures the convenio
first). `:versionId`/`:shiftId` are validated as UUIDs before the query (reuse the `isUuid` guard
pattern) so a malformed id is a 4xx, not an opaque `22P02` 500.

### 3d. `apps/dashboard` — `<dashboard-roster-screen>` (new)

Mirrors the `staff`/`catalogue`/`layout` screen pattern (injected `DashboardApi`, `@waitron/ui`
primitives on `--wt-*` tokens, `codeMessage()` error banner, single-flight guards, per-screen axe
test in both themes). Wiring:

- Shell: add `"roster"` to the `Screen` union (`dashboard-app.ts:21`), a nav `wt-button`, a
  `#renderScreen` case, and a side-effect import.
- `DashboardApi`: one thin `fetch` method per route above, with **browser-local** copies of the
  roster/shift/breach JSON shapes (the bundle-isolation rule — no `@waitron/*` runtime import).
- Screen: a **week picker**; a **person × day grid** (rows = staff from `listStaff`, columns = the 7
  days) whose cells show that person's shifts; clicking an empty cell or a shift opens a
  `<dashboard-shift-dialog>` (add/edit/remove); a **Publish** button that calls the publish route and
  renders the returned `RosterBreach[]` as an advisory banner (publish still succeeds).
- i18n: `nav.roster`, `roster.*` UI keys in `strings.ts`; the new `roster.*`/`shift.*` codes in
  `codes.ts`; the 7 breach-kind + roster-status tokens in `domain.ts` (raw-value fallback so an
  unmapped kind never shows a raw token).

The exact grid layout is a **visual** question — mockups come via the visual companion when the
screen is built; this spec fixes the model (person × day), not the pixels.

---

## 4. Data flow

```
dashboard roster screen
  → GET/POST/PATCH/DELETE /management-api/roster*          (Hono, gated: withTenant + asAppUser + schedule.manage)
    → @waitron/workforce authoring verbs (one withTenant tx per request)
      → roster_versions / shifts  (app_user, FORCE RLS, existing grants)
  → POST /management-api/roster/:id/publish
    → resolveWorkTimeRuleset (@waitron/workforce-es)  →  publishRoster → RosterBreach[]  → advisory banner
```

---

## 5. Error handling

- Authoring verbs throw the domain codes in §3a; the route group maps `AppError` → its status via the
  shared `createErrorBoundary` (`apps/server/src/error-boundary.ts`, from #75).
- Non-UUID `:versionId`/`:shiftId` → 4xx (UUID guard), never a 500.
- Unknown location / no convenio on publish → `convenio.not_found` 4xx.
- Breaches are **not** errors — they are a normal `{ breaches }` success payload; publish always
  succeeds (owner decision 2026-08-02).

---

## 6. Testing

- **Engine verbs:** TDD each (`createRosterVersion`, `addShift`, `updateShift`, `removeShift`,
  `getRoster`), incl. the draft-exists / not-draft / shift-not-found / invalid-times paths, each
  proven by deletion. PGlite for pure logic.
- **RLS + gate:** a real-Postgres `workforce-api.rls.test.ts` (mirror `catalogue`'s) proving, as the
  non-superuser `app_user` under FORCE RLS, that a tenant cannot read or mutate another tenant's
  roster (**differential — fails if `asAppUser` is dropped**) and that a non-`schedule.manage` role
  gets 403 (**proven by deletion**).
- **publishRoster** is already covered by #50; the route only wraps it (a thin route test that a
  publish returns the breaches array).
- **Dashboard:** browser tests for the grid render, the add/edit/remove-shift flow, and the publish →
  breach-banner path; axe per screen/widget in both themes.

---

## 7. Deferred (explicit)

Swap-approval (+ `swap.approve` + the `accepted → approved/rejected` transitions), absence-approval
(+ `absence.decide`), the planned-vs-actual view (`comparePlannedVsActual` needs both planned shifts
and projected work-sessions — its own read model), and template/availability generators. None blocks
slice 1.

---

## 8. Parallel-safety with the sync-transport slice

This slice adds **no migration** (§2 — the grants already exist, the permission is a code array).
The sync-transport slice's only `packages/db` migration is its trigger-gating one. Since only that
slice touches `packages/db/drizzle/meta/_journal.json`, the two branches cannot collide there; they
are safe to build in parallel worktrees.

---

## 9. Receipts (verified 2026-08-15)

- `app_user` write grants on the workforce tables — `grep` of `packages/workforce/drizzle`:
  `0006_scheduling_rls.sql:36-39` (`roster_versions`, `shifts`) and `0008_scheduling_planning_rls.sql:45-52`
  (`absences`, `availability`, `shift_templates`, `shift_swaps`) each do
  `REVOKE ALL … FROM app_user` then `GRANT SELECT, INSERT, UPDATE, DELETE … TO app_user`.
- Workforce migrations live in **`packages/workforce/drizzle`** (its own folder), separate from
  `packages/db/drizzle` — `find … -name drizzle`.
- No workforce route exists in `apps/server` today (research grep of `apps/**` for `@waitron/workforce`
  → zero hits); precedent for the new group is `mountCatalogueApi`.
- `PERMISSIONS` today = `[sale.void, sale.refund, sale.discount, sale.rectify, person.manage,
  till.configure]` (`permissions.ts:7`); `schedule.manage` is additive.
