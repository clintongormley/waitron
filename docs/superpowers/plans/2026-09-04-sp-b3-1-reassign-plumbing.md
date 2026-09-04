# SP-B3.1 — Reassign a layout profile to an enrolled device (plumbing) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner **reassign** an already-enrolled device to a different authored layout profile — or **clear** the assignment back to the form-factor default — from the Devices screen, without re-enrolling. This is the mechanical, low-risk half of SP-B3 (the parent design's §8 "reassign route + API client"); the visual **editor** that authors those profiles is **B3.2** (its own plan). B3.1's full user-facing payoff lands with B3.2 (authored profiles to choose from), but the route, the per-device current-profile visibility, and the tests are real and de-risk B3.2.

**Architecture (grounded on the current tree):** The five profile-CRUD endpoints already exist server-side (`management-api.ts` → `packages/layouts/src/profile-store.ts`), and `getProfile`/`getProfileForFormFactor` already resolve a device's profile at `/api/till` boot (SP-B1). What's missing is: (1) a route to **change** a device's `layout_profile_id` after enrol (it's stamped only once, at enrol, `device.ts:374`), (2) exposing the current `layoutProfileId` on the device list, and (3) the dashboard client method + a per-row reassign control. `app_user` already holds `UPDATE` on `devices` under FORCE RLS + the tenant-isolation policy (`0061_devices_rls.sql`), so **no migration / no new grant**.

**Tech Stack:** TypeScript, Hono (server), Drizzle, Testcontainers real-Postgres RLS tests (`apps/server`), Lit + `wt-*` primitives + Vitest browser-mode (`apps/dashboard`).

**Spec:** parent [`2026-09-03-sp-b-grid-editor-and-rendering-design.md`](../specs/2026-09-03-sp-b-grid-editor-and-rendering-design.md) §8 (B3) + §3.2/§3.5 (the gaps). Reuses that design — no separate B3.1 spec (as B2.1/B2.2 reused the SP-B2 spec).

## Global Constraints

- **Route + permission (owner decision 2026-09-04, departing from §8's `PUT /:id` + `till.configure`):** the reassign route is `POST /management-api/devices/:id/assign-profile`, gated **`device.manage`**, added in **`apps/server/src/device-api.ts`** — matching every sibling `/management-api/devices*` route (list/mint/revoke) and the `POST /:id/revoke` action shape. `device.manage` and `till.configure` map to the same roles {manager, admin} today, so no access change.
- **Error codes name the domain concept; grep siblings; never coin without checking the registry.** A reassign to a non-existent/foreign profile throws **`device.binding_invalid` `{ field: "layoutProfileId" }`** — the SAME code + shape the **enrol** path throws for a bad `layoutProfileId` binding (`apps/server/src/errors.ts:1163`, reachable via `device-api.ts`'s `import "./errors.js"`). An unknown/malformed device id throws **`device.not_found`** (the revoke idiom). Do NOT introduce `profile.not_found` here — that is the profile-CRUD code, not the device-binding one; using it would split one concept across two codes.
- **Isolation is structural (the composite FK) + RLS on the device write** — every write goes through `gated(sessionId, tx => …)` (`device-api.ts:162`, = `withTenant` + `asAppUser` + `authorizeManager(device.manage)`), so a cross-tenant DEVICE is invisible (0 rows → not_found). A cross-tenant PROFILE can never bind because the composite FK `devices_layout_profile_fk (tenant_id, layout_profile_id)` looks for `(this_tenant, id)` and misses → `device.binding_invalid` (never a leak). No read-then-write pre-check (see the Task 1 correction).
- **Null clears.** The route body is `{ layoutProfileId: string | null }`. `null` sets `devices.layout_profile_id = NULL` (device falls back to `getProfileForFormFactor`); a non-null value is set and validated by the FK.
- **Not fiscal / not H2 / no schema change / no migration.** Touches no sale path, chain, or DB schema.
- **Bundle rule:** `apps/dashboard`'s `DeviceRow`/`LayoutProfile` mirror types stay local; do NOT import `@waitron/layouts` into the browser bundle (the #70 rule — `LayoutProfile.definition` stays `unknown`).
- **No hardcoded chrome:** the reassign control uses the same native `<select>` + `wt-*` pattern the enrol-form profile picker already uses (`devices-screen.ts:632-642`); `--wt-*` tokens only.
- **Every commit `-s`.** TDD: failing test first, watch it fail, minimal implementation, watch it pass.
- **Coverage:** `apps/server` `98/98/98/95`, `apps/dashboard` `95/95/90/88`. Run `pnpm --filter <pkg> test:coverage`. Real-PG tests need `TESTCONTAINERS_RYUK_DISABLED=true` locally.

---

## File Structure

- **Modify** `apps/server/src/device-api.ts` — add the `assign-profile` route (after the revoke route, `:420`); add `layoutProfileId: devices.layoutProfileId` to the `GET /management-api/devices` select (`:383-391`); import `bindingFkField` from `./device.js` to translate the composite-FK 23503 (see the correction under Task 1 — no `getProfile` pre-check).
- **Modify** the device-api server test (the RLS suite that already covers list/revoke — find it, e.g. `apps/server/src/device-api.*.test.ts`) — reassign sets/clears/rejects; the list returns `layoutProfileId`.
- **Modify** `apps/dashboard/src/api/client.ts` — add `layoutProfileId: string | null` to `DeviceRow` (`:595-603`); add `reassignDevice(id, layoutProfileId)` (after `revokeDevice`, `:1860`).
- **Modify** `apps/dashboard/src/api/client.test.ts` (or wherever client methods are tested) — the new method's request shape.
- **Modify** `apps/dashboard/src/screens/devices-screen.ts` + test — a per-active-device reassign `<select>` (preselected to the device's current profile, a "Default (form-factor)" option), `#onReassign` handler → `reassignDevice` → `#reloadDevices`, mirroring the `#onRevoke`/`errorKey` idiom.
- **Modify** the dashboard i18n (`apps/dashboard/src/i18n/*` — all locales) — reuse `devices.profile`/`devices.profile_none`; add a `devices.reassign`/aria label if the row control needs one (grep the existing `devices.*` keys first).

---

## Task 1: Server — reassign route + expose `layoutProfileId` on the device list

> **Correction (2026-09-04, as shipped — superseding the `getProfile` pre-check below):** the route does
> NOT pre-check with `getProfile`. Copilot flagged that a read-then-write pre-check leaves a
> delete-between-check-and-update race that surfaces a raw FK 500. The shipped route instead lets the
> composite FK `devices_layout_profile_fk (tenant_id, layout_profile_id)` be the guard — it is
> tenant-isolated (a cross-tenant id looks for `(this_tenant, id)` and misses) AND atomic with the
> UPDATE (no window) — and translates a 23503 on it via the enrol path's `bindingFkField` helper
> (extended to map that constraint) to `device.binding_invalid { field: "layoutProfileId" }`. So there is
> no `getProfile` import, and isolation is proven through the FK, not a pre-check. The `device.test.ts`
> `bindingFkField` unit test pins the new constraint→field mapping.

**Files:**
- Modify: `apps/server/src/device-api.ts` (list select `:383-391`; new route after `:420`; import `bindingFkField` from `./device.js`) + `apps/server/src/device.ts` (extend `BINDING_FK_FIELD` with `devices_layout_profile_fk`) — see the Task 1 correction.
- Test: the device-api real-PG RLS suite (grep `describeEachTarget`/`useRealPostgres` + `/management-api/devices` in `apps/server/src/*.test.ts`) + `device.test.ts`'s `bindingFkField` unit suite.

**Interfaces:**
- Consumes: `bindingFkField(error)` (`./device.js`, maps a 23503's constraint → the input field); `devices.layoutProfileId` column (`@waitron/db`); the `gated(sessionId, fn)` helper; `AppError`, `isUuid`.
- Produces:
  - `GET /management-api/devices` rows gain `layoutProfileId: devices.layoutProfileId` (a `string | null`).
  - `POST /management-api/devices/:id/assign-profile` — `gated` on `device.manage`; body `{ layoutProfileId: string | null }` (screen with `readJsonBody` + a `requireBodyUuid`-or-null screen). Malformed/unknown device id → `device.not_found`. The `tx.update(devices).set({ layoutProfileId }).where(eq(devices.id, id)).returning({ id })` runs inside a try/catch: a 23503 on the composite FK `devices_layout_profile_fk` (a non-null profile — unknown OR cross-tenant — that names no row of this tenant) → `AppError("device.binding_invalid", { field: "layoutProfileId" })` via `bindingFkField`; 0 rows → `device.not_found`; success → `204`.

- [ ] **Step 1: Write the failing tests (real-PG RLS suite)** — mirror the existing list/revoke tests. Cover: (a) `GET /management-api/devices` returns each device's `layoutProfileId` (enrol one with a profile, assert the field); (b) assign-profile sets a device's profile (assert via the list or a direct read); (c) `layoutProfileId: null` clears it; (d) assigning a profile id that does not exist → `device.binding_invalid` `{field:"layoutProfileId"}`; (e) a **cross-tenant** profile id → same `device.binding_invalid` (RLS hides it — never a leak, never a success); (f) unknown/malformed device id → `device.not_found`; (g) the write is tenant-isolated (a manager of tenant A cannot reassign tenant B's device — `device.not_found`).

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @waitron/server test <suite> -t "assign-profile|layoutProfileId"` (with `TESTCONTAINERS_RYUK_DISABLED=true`). Expected FAIL (route + list field absent).

- [ ] **Step 3: Implement** — add the list-select field; add the route after revoke (`:420`) following the revoke idiom exactly (id `isUuid` screen → `gated` → work). Extend `BINDING_FK_FIELD` (`device.ts`) with `devices_layout_profile_fk → "layoutProfileId"`; wrap the UPDATE in a try/catch translating that FK's 23503 via `bindingFkField`.

- [ ] **Step 4: Run to verify pass** — the new suite green; existing device-api tests unaffected.

- [ ] **Step 5: Pin the FK translation** — `device.test.ts` asserts `bindingFkField(fk("devices_layout_profile_fk")) === "layoutProfileId"` (crafted error); the cross-tenant + nonexistent RLS tests exercise the end-to-end 23503 translation on real Postgres. The composite FK is atomic with the UPDATE, so there is no read-then-write race to prove around.

- [ ] **Step 6: Coverage + commit** — `pnpm --filter @waitron/server test:coverage` (98/98/98/95).
```bash
git add apps/server/src/device-api.ts apps/server/src/<device-api test>
git commit -s -m "feat(server): reassign a device's layout profile; expose it on the device list (SP-B3.1)"
```

---

## Task 2: Dashboard API client — `reassignDevice` + `DeviceRow.layoutProfileId`

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`DeviceRow` `:595-603`; new method after `revokeDevice` `:1860`)
- Test: the client's test file (grep `revokeDevice`/`listDevices` in `apps/dashboard/src/api/*.test.ts`)

**Interfaces:**
- Produces: `DeviceRow` gains `layoutProfileId: string | null`. `reassignDevice(id: string, layoutProfileId: string | null): Promise<void>` → `POST /management-api/devices/:id/assign-profile` with body `{ layoutProfileId }` (mirror `revokeDevice`'s shape; the server answers 204).

- [ ] **Step 1: Failing test** — assert `reassignDevice("d1", "p1")` issues `POST /management-api/devices/d1/assign-profile` with `{ layoutProfileId: "p1" }`, and `reassignDevice("d1", null)` sends `{ layoutProfileId: null }`. Mirror the existing `revokeDevice`/`createDeviceCode` request-shape tests.
- [ ] **Step 2: Run to fail.** `pnpm --filter @waitron/dashboard test <client test> -t "reassignDevice"`.
- [ ] **Step 3: Implement** the field + method (copy `revokeDevice`'s doc/shape; `#request<void>`).
- [ ] **Step 4: Run to pass** + existing client tests green.
- [ ] **Step 5: Commit**
```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/api/<client test>
git commit -s -m "feat(dashboard): reassignDevice client method + layoutProfileId on DeviceRow (SP-B3.1)"
```

---

## Task 3: Devices screen — per-device reassign control

**Files:**
- Modify: `apps/dashboard/src/screens/devices-screen.ts` (`#renderDevice` `:513-548`; add `#onReassign`; the profiles state `:177` already exists and `#load` already fetches them `:255`)
- Modify: dashboard i18n (all locales) — reuse `devices.profile`/`devices.profile_none`; add an aria label key if needed.
- Test: `apps/dashboard/src/screens/devices-screen.test.ts`

**Interfaces:**
- Produces: each **active** device row renders a profile `<select>` (`data-test="reassign-<id>"`) — options: a `""` → "Default (form-factor)" (`devices.profile_none`) plus `this.profiles.map(p => option)`, the `<select>`'s value **preselected to `device.layoutProfileId ?? ""`**. On `change`, `#onReassign(device.id, value === "" ? null : value)` calls `this.api.reassignDevice(...)`, then `#reloadDevices()`; a rejection sets `errorKey = codeOf(error)` (the `#onRevoke`/`#generate` idiom). A revoked (inactive) device shows no control (matches revoke, which only shows on active rows).

- [ ] **Step 1: Failing test** — mirror the existing devices-screen tests (stub `api.listDevices` returning a device with `layoutProfileId`, `api.listProfiles` returning 2 profiles). Assert: (a) an active row renders `reassign-<id>` with the profiles + a default option, preselected to the device's current `layoutProfileId`; (b) picking a profile calls `reassignDevice(id, "p2")` then reloads; (c) picking "Default" calls `reassignDevice(id, null)`; (d) a failing `reassignDevice` surfaces the `errorKey` banner and does not throw; (e) a revoked device shows no reassign control.
- [ ] **Step 2: Run to fail.** `pnpm --filter @waitron/dashboard test devices-screen -t "reassign"`.
- [ ] **Step 3: Implement** the control + `#onReassign` (copy the enrol-form profile `<select>` at `:632-642` for the option list; copy `#onRevoke`/`#reloadDevices` for the handler/error idiom). Add any new i18n key to every locale.
- [ ] **Step 4: Run to pass** + a11y test (`pnpm --filter @waitron/dashboard test devices-screen.a11y` if present) — the `<select>` needs an accessible name.
- [ ] **Step 5: Coverage + commit** — `pnpm --filter @waitron/dashboard test:coverage` (95/95/90/88; browser-mode — run ALONE, memory note).
```bash
git add apps/dashboard/src/screens/devices-screen.ts apps/dashboard/src/screens/devices-screen.test.ts apps/dashboard/src/i18n/*
git commit -s -m "feat(dashboard): reassign a device's layout profile from the Devices screen (SP-B3.1)"
```

---

## Task 4: Final verification (before PR)

- [ ] **Whole-workspace gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
- [ ] **Scoped coverage:** `pnpm --filter @waitron/server test:coverage` (98/98/98/95) and `pnpm --filter @waitron/dashboard test:coverage` (95/95/90/88), run separately (browser-mode memory).
- [ ] **Isolation proof:** the cross-tenant reassign test rejects with `device.binding_invalid` (not a leak, not a success) and the tenant-A-can't-touch-tenant-B-device test rejects `device.not_found` — both proven by the RLS suite.
- [ ] **No schema drift:** no migration added; `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` stays green (cheap belt-and-braces — no `tenant_id` table changed).
- [ ] **Manual smoke (optional):** `pnpm dev:setup && pnpm dev`; on the dashboard Devices screen, an enrolled device shows its current profile in a dropdown; changing it persists (reload shows the new value); "Default" clears it.

---

## Self-Review notes (author)

- **Spec coverage (§8 reassign bullet + §3.2/§3.5 gaps):** the route (Task 1), the API client + `DeviceRow.layoutProfileId` (Task 2), the devices-screen control (Task 3). Profile CRUD endpoints already exist (verified) — untouched; the editor that calls them is B3.2.
- **Owner/convention decisions recorded:** route at `POST /management-api/devices/:id/assign-profile` in device-api.ts gated `device.manage` (matches sibling device routes, not §8's `PUT`/`till.configure` — functionally identical roles today); bad target → `device.binding_invalid {field:"layoutProfileId"}` (matches the enrol binding path, not a new `profile.*` code).
- **No migration / no grant:** `app_user` already holds UPDATE on `devices` under FORCE RLS (`0061_devices_rls.sql`); this is a data change, not a schema change.
- **Isolation is the load-bearing test:** the composite FK `devices_layout_profile_fk (tenant_id, layout_profile_id)` means a cross-tenant profile id can neither be set nor distinguished from a non-existent one (both → `device.binding_invalid`) — pinned by the cross-tenant test (real foreign profile + superuser read-back) and the `bindingFkField` unit case. The FK is atomic with the UPDATE, so there is no read-then-write window (Copilot's race, addressed by dropping the pre-check).
- **Known implementer lookups:** the exact device-api RLS test suite file + its enrol/list helpers; the dashboard client test file; the `devices.*` i18n keys + locale files; the `devices_layout_profile_fk` constraint name (migration 0095) for the `BINDING_FK_FIELD` map.
- **B3.1's honest value:** authored profiles to reassign TO only exist once B3.2 ships; B3.1 delivers the route, the current-profile visibility, and the clear-to-default control now, and de-risks B3.2.
