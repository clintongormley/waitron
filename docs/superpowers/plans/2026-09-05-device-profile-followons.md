# Device Profile Follow-ons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship three deferred follow-ons from the device-profile slice (#231): (d) a clean 4xx on an in-use delete, (c) a dev-switcher device-profile picker, (b) auto-seeding a starter set of device profiles at provisioning. Defer (a) the aggregated bundle.

**Architecture:** Three independent slices, one per task, on one branch (`feat/device-profile-followons`), one PR. Each is additive and leaves the workspace green.

**Tech Stack:** TypeScript, pnpm workspace, Drizzle + PostgreSQL (RLS), Vitest (+ Testcontainers real-PG, PGlite hermetic), Lit (browser-mode Vitest for `apps/till`).

**Spec:** the parent design `docs/superpowers/specs/2026-09-05-device-profile-design.md` §14 (deferred follow-ons); this plan is the design for the three.

## Global Constraints

- **Error codes name the domain concept, never renamed once shipped** (CLAUDE.md §3). New codes `device_profile.in_use` / `canvas.in_use` live in `packages/layouts/src/errors.ts` beside their families; no-param (`Record<string, never>`) — the fact of the reference is the whole message, never echo which device/profile references it (the param convention at `errors.ts:26-36`). Every throwing file does `import "./errors.js"`.
- **Never build SQL by string concat**; utility DDL only in migrations. No migrations in this plan (no schema change).
- **`withTenant + asAppUser` wraps every RLS-scoped read/write**; RLS proven on **real Postgres** (PGlite is a false pass for RLS-as-app_user, CLAUDE.md §4). `TESTCONTAINERS_RYUK_DISABLED=true` locally.
- **`test:coverage`, not `test`** (98/98/98/95; browser packages `apps/till` 95/95/90/88).
- **Spanish domain vocabulary** (`english-only`) scopes `packages/`, not `apps/`. Seeded profile NAMES are locale content (data), not identifiers — source them from a per-locale map keyed off the venue's primary invoice locale (Spanish for ES), NOT hardcoded English/Spanish literals scattered in code. If a Spanish name literal in a `packages/` seed module trips `english-only`, keep the literals in a small locale map and confirm the guard's scope (it flags Spanish tokens for deliberate schema use; a locale-content map is not a schema token — verify at impl and, if needed, isolate the map so the guard is satisfied without polluting `SPANISH_WORDS`).
- **No fiscal surface.** Provisioning seeds tenant/series/SIF (fiscal), but a device-profile seed is non-fiscal config — it must not touch the series/SIF/chain actions. Keep the new action strictly additive.
- **The dashboard/#70 bundle rule** does not apply here (no dashboard runtime import of `@waitron/layouts` is added); `apps/till` and `apps/server` import `@waitron/layouts` normally.
- **`git commit -s`** every commit. Branch `feat/device-profile-followons` (worktree exists).

---

## Task 1 (d): clean 4xx on in-use delete

**Files:**
- Modify: `packages/layouts/src/errors.ts` (register `device_profile.in_use`, `canvas.in_use`)
- Modify: `packages/layouts/src/device-profile-store.ts` (`deleteDeviceProfile` catches `23001`)
- Modify: `packages/layouts/src/canvas-store.ts` (`deleteCanvas` catches `23001`)
- Modify: `apps/server/src/management-api.ts` (STATUS map: both new codes → 409)
- Modify: `apps/dashboard/src/i18n/codes.ts` (EN/ES messages for both) + `codes.test.ts` if it pins completeness
- Tests: `device-profile-store.rls.test.ts`, `canvas-store` delete test, `management-api.device-profiles.rls.test.ts` (+ the canvas route test), `codes.test.ts`

**Context (grounded):** `deleteDeviceProfile` (`device-profile-store.ts:216-231`) and `deleteCanvas` (`canvas-store.ts:164-179`) delete with `.returning({id})`, throw `*.not_found` on zero rows, and DO NOT try/catch — a referencing FK (`ON DELETE RESTRICT`) raises SQLSTATE **`23001`** (restrict_violation, NOT 23503 — confirmed `device-profiles.fk.test.ts:82`, `devices.fk.test.ts:158`), which propagates raw → generic 500. Referencing constraints: `devices_device_profile_fk` + `device_pairing_codes_device_profile_fk` (on a profile delete), `device_profiles_canvas_fk` (on a canvas delete). `pgErrorConstraint(err, "23001")` (`@waitron/db`, `unique-violation.ts:63`, already exported + SQLSTATE-parameterised) returns the constraint name. STATUS map at `management-api.ts:158-282`; 409 is the house conflict convention (`*.name_taken` → 409). `codes.ts` `CODE_MESSAGES` (`:89-116`); an unmapped code degrades to a generic message, so the entry is required.

- [ ] **Step 1: register the codes** — `errors.ts`, beside `canvas.name_taken` / `device_profile.name_taken`: both `Record<string, never>`, with a doc line ("deleting a row a live device/profile still references; RESTRICT — never echo which one"). Grep the sibling no-param codes and match their shape exactly.

- [ ] **Step 2: failing store tests first.** In `device-profile-store.rls.test.ts`, the delete-referenced test currently asserts the raw `23001` (line ~238/264); CHANGE it to assert the thrown `device_profile.in_use` AppError (and that the profile survives — RESTRICT). In `canvas-store`'s delete test (find it), add/flip a case: a canvas referenced by a profile → `canvas.in_use` (canvas survives). Watch them fail.

- [ ] **Step 3: implement.** In `deleteDeviceProfile`, wrap the delete in try/catch: on catch, `if (pgErrorConstraint(err, "23001") is one of the two referencing constraint names) throw new AppError("device_profile.in_use", {})`, else rethrow. Prefer folding this into the store's existing `translateWriteError` helper (extend it to also handle `23001` → `*.in_use`) and call `translateWriteError` from the delete's catch, so all DB-error translation lives in one place — but only if that reads cleanly; otherwise an inline catch is fine. Mirror in `deleteCanvas` (→ `canvas.in_use`, constraint `device_profiles_canvas_fk`). Match on the constraint NAME (not a bare 23001) so an unrelated RESTRICT can't be mislabeled — the `bindingFkField`/`translateWriteError` precedent.

- [ ] **Step 4: STATUS map** — add `device_profile.in_use` and `canvas.in_use` → 409 in `management-api.ts`, beside the sibling entries.

- [ ] **Step 5: route tests** — in `management-api.device-profiles.rls.test.ts`, add: create a profile, bind a device to it (via the device/enrol path or a direct insert under the tenant), DELETE the profile → **409** `device_profile.in_use`. Add the canvas twin in the canvas route test (a canvas referenced by a profile → 409 `canvas.in_use`).

- [ ] **Step 6: i18n** — `codes.ts`: `device_profile.in_use` + `canvas.in_use` EN + ES messages (e.g. EN "This profile is still assigned to a device — reassign or remove the device first."; ES the locale-appropriate equivalent). If `codes.test.ts` guards completeness, satisfy it.

- [ ] **Step 7: verify** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/layouts --filter @waitron/server test:coverage`; `pnpm --filter @waitron/dashboard test:coverage`; prove-by-deletion on the new catch (remove it → the store test fails with a raw 23001). Commit `-s`: "feat(layouts): device_profile.in_use / canvas.in_use — clean 409 on in-use delete".

---

## Task 2 (c): dev-switcher device-profile picker

**Files:**
- Modify: `apps/server/src/device-api.ts` (`GET /api/dev/devices` returns `deviceProfiles`; `POST /api/dev/devices` reads + forwards `deviceProfileId`)
- Modify: `apps/till/src/api/client.ts` (`DevDeviceProfile`, `deviceProfiles` on `DevDeviceList`, `deviceProfileId?` on `DevMintRequest`)
- Modify: `apps/till/src/screens/till-dev-chooser.ts` (a `#profileField` picker + state + `#mint` attaches `deviceProfileId`)
- Tests: the `device-api` dev-route test, `till-dev-chooser.test.ts`

**Context (grounded):** the exact analogue of the canvas picker removed in #231 (commit `420572a9`). `GET /api/dev/devices` (`device-api.ts:479-515`, `if (deps.devMode)`) returns `{ devices, tills, stations }`; add `deviceProfiles` via `listDeviceProfiles(tx, deps.cfg.tenantId)` (import from `@waitron/layouts`; not currently imported there) mapped to `{id,name}`, RLS-scoped in the same tx. `POST /api/dev/devices` (`:519-561`) screens `kind`/`label`/`stationId`/`tillId` then calls `generatePairingCode(tx, deps.cfg, { kind, stationId, tillId, label })`; `generatePairingCode` (`device.ts:206`) ALREADY accepts `deviceProfileId?: string | null` (stamped at `:278`, FK→`device.binding_invalid` translation at `:301-311`). So POST just reads `deviceProfileId` from the body (screen it with the same optional-uuid idiom used for `tillId` — `requireBodyUuid` / an `optionalBindingUuid` closure) and forwards it. `till-dev-chooser.ts` mint state at `:136-139`, `#mint` at `:167-186`, field renderers `#tillField`/`#stationField` at `:294-324`; `DevMintRequest` at `client.ts:759`, `DevDeviceList` at `:754`.

- [ ] **Step 1: failing server test** — the dev-route test: `GET /api/dev/devices` returns `deviceProfiles: [{id,name}]` for the tenant's profiles; `POST` with a `deviceProfileId` enrols a device carrying it; a bad/foreign `deviceProfileId` → `device.binding_invalid`. Watch fail.
- [ ] **Step 2: server impl** — import `listDeviceProfiles`; add `deviceProfiles` to the GET response; read + screen `deviceProfileId` in POST and pass to `generatePairingCode`; add it to the 201 response shape if useful. Watch pass.
- [ ] **Step 3: failing till test** — `till-dev-chooser.test.ts`: the mint form shows a profile `<select>` from `deviceProfiles`, and minting posts the chosen `deviceProfileId` (and "no profile" posts none). Watch fail.
- [ ] **Step 4: till impl** — `client.ts`: `DevDeviceProfile {id,name}`, `deviceProfiles: DevDeviceProfile[]` on `DevDeviceList`, `deviceProfileId?: string` on `DevMintRequest`. `till-dev-chooser.ts`: `#profileField` (a plain `<select>` leading with a "— no profile —" option), `profileId` mint state, `#mint` attaches `deviceProfileId` when set. Dev-only tool: plain-English copy is fine (`apps/till` is out of the `english-only` guard, but keep identifiers English). Watch pass.
- [ ] **Step 5: verify** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`; `pnpm --filter @waitron/till test:coverage`. Commit `-s`: "feat(dev): dev-switcher device-profile picker (dev-minted devices carry a profile)".

---

## Task 3 (b): auto-seed a starter device-profile set at provisioning

**Files:**
- Create: a shared default-profile-set definition — `packages/layouts/src/device-profile.ts` (extend) or a small new module: `DEFAULT_DEVICE_PROFILES` = the three `{ nameKey, formFactor }` + a per-locale name map.
- Modify: `packages/provisioning/src/venue-plan.ts` (new `seed-device-profiles` VenueAction + `describeVenueAction`)
- Modify: `packages/provisioning/src/venue-apply.ts` (execute the action — seed the three profiles)
- Modify: `apps/server/scripts/dev-setup.ts` (reuse the shared set; simplify `ensureDefaultDeviceProfile` if the provisioned tenant now already has "Counter")
- Tests: `venue-plan.test.ts`, `venue-apply.rls.test.ts` (real-PG), the provisioning e2e; `dev-setup.test.ts`

**Context (grounded):** provisioning seeds NO canvases/profiles today — `planVenue` (`venue-plan.ts:78-172`) → `VenueAction` union (`:40-66`: ensure-tenant, seed-admin, create-location, create-till, create-node, register-sif, create-series). `applyVenue` (`venue-apply.ts`) has no canvas/profile refs. `DEFAULT_PROFILE_CAPABILITIES` (`device-profile.ts:30`) gives per-form-factor capabilities. `device_profiles.canvasId` is nullable → `canvasId: null` resolves the form-factor default canvas at runtime, so NO canvas row is needed. `createDeviceProfile` requires a management session (authorizes `till.configure`); `seed-admin` seeds the admin person who holds it — dev-setup's `ensureDefaultDeviceProfile` (`dev-setup.ts:462`) mints an admin session and calls the store. **Decision (owner 2026-09-05):** starter set = Counter (till), Kitchen (kds), Handheld (phone-portrait); auto-seeded at provisioning.

**Localization (assumption, reversible):** seeded names are locale content — a per-locale map keyed off the venue's primary invoice locale (the `location.invoiceLocales[0]`, `es-ES` for the ES venue): es → `Mostrador`/`Cocina`/`Móvil`; en → `Counter`/`Kitchen`/`Handheld`; default to es. The tenant renames freely.

- [ ] **Step 1: shared default set** — define `DEFAULT_DEVICE_PROFILES` (the three `{ formFactor, capabilities: DEFAULT_PROFILE_CAPABILITIES[formFactor], nameByLocale }`) in `@waitron/layouts`. Unit-test: exhaustive/known flags, three entries, name map covers es+en. If Spanish name literals trip `english-only`, keep them in the isolated map and satisfy the guard (do NOT add profile names to `SPANISH_WORDS` — they are not schema tokens; if the guard cannot be satisfied cleanly, fall back to English seed names + a ledger note, since names are tenant-editable).

- [ ] **Step 2: plan the action (TDD)** — `venue-plan.test.ts`: `planVenue` now emits a `seed-device-profiles` action (after `seed-admin`, since it needs the admin session; before/after create-till doesn't matter — it's non-fiscal). `describeVenueAction` covers it. Watch fail; implement the plan addition + the `VenueAction` union member. Keep it strictly separate from the fiscal actions (series/SIF).

- [ ] **Step 3: apply the action (TDD, real-PG)** — `venue-apply.rls.test.ts`: after `applyVenue`, the tenant has exactly the three profiles (names per the venue locale, `canvasId: null`, capabilities per form factor). Implement in `venue-apply.ts`: for the `seed-device-profiles` action, mint an admin management session (the `seed-admin` shape / dev-setup precedent) and `createDeviceProfile` ×3 — OR, if minting a session inside apply is awkward, insert directly under the provisioner tx (but prefer the store path for its validation; match how apply seeds other rows). Idempotent (find-or-create by name) so a re-provision is safe. Watch fail → pass.

- [ ] **Step 4: dev-setup reuse** — point `dev-setup.ts` at the shared `DEFAULT_DEVICE_PROFILES` (so dev and prod agree). If dev-setup provisions via `applyVenue` (check), the three profiles already exist post-provision, so `ensureDefaultDeviceProfile` collapses to "find the Counter profile for the till code" — simplify accordingly; if dev-setup does NOT go through applyVenue, keep it seeding via the shared set. Update `dev-setup.test.ts`.

- [ ] **Step 5: verify** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/layouts --filter @waitron/provisioning --filter @waitron/server test:coverage`; the provisioning e2e; `inmutabilidad` stays green (no schema change, but confirm the new action didn't disturb the fiscal seed). Commit `-s`: "feat(provisioning): seed a starter device-profile set for every new tenant".

---

## Task 4: whole-workspace gate + backlog

- [ ] **Step 1: sweep** — `grep -rn "in_use\|deviceProfileId\|seed-device-profiles" packages apps` sanity; confirm no stray English seed literal / no fiscal action touched.
- [ ] **Step 2: gate** — `pnpm lint && pnpm typecheck && pnpm format:check`; per-package `test:coverage` (browser suites serial, NOT `pnpm -r`); root guards (`pnpm vitest run scripts/`); `inmutabilidad`.
- [ ] **Step 3: backlog** — `docs/backlog.md`: mark follow-ons (b), (c), (d) LANDED under the device-profile row; (a) aggregated bundle remains the sole deferred item. Commit `-s`.

---

## Self-review
- Coverage: (d)→T1, (c)→T2, (b)→T3, gate→T4. Deferred (a) explicitly out.
- No schema change → no migration, no `_journal` churn, no rebase-collision risk.
- Type consistency: `device_profile.in_use`/`canvas.in_use` (T1); `deviceProfiles`/`DevDeviceProfile`/`deviceProfileId` (T2, matching #231's existing `generatePairingCode` param); `DEFAULT_DEVICE_PROFILES` (T3 shared T3/T4/dev-setup).
