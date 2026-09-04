# SP-B3.2 Phase A — `profile → canvas` rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the display-layout concept from **layout profile** to **canvas** across every package, behaviour-preserving, so the B3.2 editor (Phase B) is built on final names. Reserve "profile" for the future device profile.

**Architecture:** A pure rename — no behaviour change. Renaming an exported symbol breaks its importers in the same instant, so the rename lands in **dependency order** (`@waitron/db` + `@waitron/layouts` together → `apps/server` → `apps/till` → `apps/dashboard`); each layer's own typecheck/suite goes green as its task completes (its deps are already renamed), and the **whole workspace is green only after the last task**. Intermediate commits are checkpoints. The one schema change is a pre-production **drop/recreate** migration (no backfill) that re-establishes FORCE RLS + policy + grants on the renamed table.

**Tech Stack:** pnpm workspace; TypeScript; Drizzle ORM + drizzle-kit; Postgres (Testcontainers) + PGlite; Hono (server); Lit (till/dashboard); Vitest (Node + headless-Chromium browser mode).

**Spec:** `docs/superpowers/specs/2026-09-04-sp-b3-2-canvas-editor-design.md` (§2 terminology, §5 the rename inventory).

## Global Constraints

- **Behaviour-preserving.** Only names change. **Preserve existing behavioural assertions** — update fixtures/mocks/expected codes, never rewrite a test to match new behaviour (there is none). (CLAUDE.md: "a test rewritten to match the new code hides the regression".)
- **This is a rename, not `s/profile/canvas/`.** Only the **layout-display** concept renames. Do **not** touch the deferred *device-profile* term, unrelated "profile" strings, or the `theme.*` family. Grep the concrete tokens listed per task, site by site.
- **No backfill / pre-production.** The migration drops and recreates; developer DBs and CI rebuild fresh (CLAUDE.md §3, §5).
- **Error codes name the domain concept, carry identical param shapes across the rename**, and every throwing file imports its registry (`import "./errors.js"`). `canvas.not_found`/`canvas.name_taken` stay param-less; `canvas.invalid` keeps the full `reason`/`tabIndex`/`card`/`configKey` shape.
- **New tenant-scoped table needs FORCE RLS + policy + grants** (not just `.enableRLS()`); run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after the migration.
- **Don't hand-edit drizzle snapshots** — regenerate via `db:generate`/`db:generate:custom` (CLAUDE.md; the rebase-collision lesson).
- **CI runs `test:coverage`, not `test`.** Before calling a package green, run `pnpm --filter <pkg> test:coverage`. Coverage bars: 98/98/98/95 everywhere except the browser packages (`apps/till`, `apps/dashboard`, `packages/ui`, …) at 95/95/90/88.
- **A rename of a shared export is cross-package** — a filtered green proves nothing; the final task runs the **whole workspace's** suites (CLAUDE.md §2).
- **Every commit `-s`.** Feature branch `feat/sp-b3-2-grid-editor`, worktree `~/workspace/worktrees/waitron-feat-sp-b3-2-grid-editor`.

## Canonical token map (apply everywhere the layout-display concept appears)

| Old | New |
| --- | --- |
| `layout_profiles` (table) | `canvases` |
| `layoutProfiles` (db export) | `canvases` |
| `layout_profiles_tenant_id_key` | `canvases_tenant_id_key` |
| `layout_profiles_tenant_name_key` | `canvases_tenant_name_key` |
| `layout_profiles_tenant_isolation` (policy) | `canvases_tenant_isolation` |
| `layout_profiles_tenant_id_tenants_id_fk` | `canvases_tenant_id_tenants_id_fk` |
| `layout_profile_id` (column, devices + device_pairing_codes) | `canvas_id` |
| `devices_layout_profile_fk` | `devices_canvas_fk` |
| `device_pairing_codes_layout_profile_fk` | `device_pairing_codes_canvas_fk` |
| `ProfileDef` (type) | `CanvasDef` |
| `profile.ts` (layouts) | `canvas.ts` |
| `validate-profile.ts` / `validateProfile` | `validate-canvas.ts` / `validateCanvas` |
| `default-profiles.ts` / `DEFAULT_PROFILES` | `default-canvases.ts` / `DEFAULT_CANVASES` |
| `profile-store.ts` | `canvas-store.ts` |
| `listProfiles`/`getProfile`/`createProfile`/`updateProfile`/`deleteProfile`/`getProfileForFormFactor` | `listCanvases`/`getCanvas`/`createCanvas`/`updateCanvas`/`deleteCanvas`/`getCanvasForFormFactor` |
| `asNameTaken` (keep name; it's generic) | `asNameTaken` (unchanged) |
| `profile.invalid` / `profile.not_found` / `profile.name_taken` (error codes) | `canvas.invalid` / `canvas.not_found` / `canvas.name_taken` |
| `layoutProfileId` (server/client field) | `canvasId` |
| `/management-api/profiles[/:id]` (routes) | `/management-api/canvases[/:id]` |
| `requireProfileId` | `requireCanvasId` |
| `/management-api/devices/:id/assign-profile` (route) | `/management-api/devices/:id/assign-canvas` |
| `LayoutProfile` (dashboard client type) | `Canvas` |
| `reassignDevice`'s `layoutProfileId` param | `canvasId` |
| `TillInfo.profile` / `/api/till` `profile` key | `TillInfo.canvas` / `canvas` |
| `till-app.ts` `this.profile` | `this.canvas` |
| i18n `devices.profile` / `devices.profile_none` / `devices.reassign` values ("profile"→"canvas") | (see Task A5) |

Leave **unchanged**: `theme.*`, `CardType`/`CardInstance`/`TabDef`/`CARD_CONTRACTS`/card names, `CAPABILITY_FLAGS`, `FORM_FACTORS`, `bindingFkField` (function name; its mapped constraint string changes), `device.binding_invalid`.

---

## Task A1: Rename in `@waitron/db` + `@waitron/layouts` (schema, migration, model, store, codes)

These two land together: `@waitron/layouts` imports `layoutProfiles` from `@waitron/db`, so renaming the db export breaks layouts the same instant. Do both, then verify both.

**Files:**
- Rename: `packages/db/src/schema/layout-profiles.ts` → `packages/db/src/schema/canvases.ts`
- Rename: `packages/db/src/schema/layout-profiles.rls.test.ts` → `canvases.rls.test.ts`
- Modify: `packages/db/src/schema/devices.ts` (both `layoutProfileId` columns → `canvasId`), `devices.fk.test.ts`, and the schema barrel that re-exports `layoutProfiles` (grep `layoutProfiles` / `layout-profiles` under `packages/db/src`)
- Create: `packages/db/drizzle/00NN_*.sql` (the rename migration, generated) + a hand-written `--custom` RLS migration; update `packages/db/drizzle/meta/_journal.json` via generation (never by hand)
- Rename: `packages/layouts/src/profile.ts`→`canvas.ts`, `validate-profile.ts`→`validate-canvas.ts` (+ `.test.ts`), `default-profiles.ts`→`default-canvases.ts` (+ `.test.ts`), `profile-store.ts`→`canvas-store.ts`, `profile-store.test.ts`→`canvas-store.test.ts`, `profile-store.rls.test.ts`→`canvas-store.rls.test.ts`
- Modify: `packages/layouts/src/errors.ts` (codes `profile.*`→`canvas.*`), `packages/layouts/src/index.ts` (barrel), `packages/layouts/src/card-contract.ts` (its `import type { CardType } from "./profile.js"` → `"./canvas.js"`), `packages/layouts/src/theme.ts` (only if it imports from `profile.ts`), and every intra-package importer.

**Interfaces:**
- Produces (for later tasks): db export `canvases` (table); `@waitron/layouts` barrel now exports `CanvasDef`, `validateCanvas`, `DEFAULT_CANVASES`, `listCanvases`/`getCanvas`/`createCanvas`/`updateCanvas`/`deleteCanvas`/`getCanvasForFormFactor`, error codes `canvas.invalid`/`canvas.not_found`/`canvas.name_taken`. Store fn signatures are **unchanged except their names** (e.g. `getCanvas(tx, tenantId, id)`, `createCanvas(tx, { managementSessionId, tenantId, name, definition })`).
- Consumes: nothing from later tasks.

- [ ] **Step 1: Confirm the whole workspace is green before starting** (the rename's safety net is the pre-existing suite).

Run: `pnpm typecheck` — Expected: PASS. This is the baseline the rename must return to.

- [ ] **Step 2: Rename the schema file + table + constraints.**

`git mv packages/db/src/schema/layout-profiles.ts packages/db/src/schema/canvases.ts`. In it: export `const canvases = pgTable("canvases", …)`; rename the two `unique(...)` names per the token map; keep columns `id`/`tenantId`/`name`/`definition`/`createdAt`/`updatedAt` unchanged; update the doc comment's `layout_profiles`/`layout_profiles_tenant_*_key` references. In `packages/db/src/schema/devices.ts` rename **both** `layoutProfileId: uuid("layout_profile_id")` occurrences (devices ~:84 and device_pairing_codes ~:169) to `canvasId: uuid("canvas_id")` and update their doc comments (which name the composite FK). Update the schema barrel export (`layoutProfiles` → `canvases`) and any `packages/db/src/index.ts` re-export.

- [ ] **Step 3: Regenerate the structural migration.**

Run: `pnpm --filter @waitron/db db:generate`. drizzle-kit will detect a table rename (`layout_profiles`→`canvases`) and column renames (`layout_profile_id`→`canvas_id` ×2). If it prompts rename-vs-drop/create and the shell is non-interactive, prefer generating drop/create (pre-prod, no data) — but the cleaner result is a `RENAME`; if the tool cannot be driven interactively here, hand-write the structural migration following the drop/recreate shape of `0088` (CREATE TABLE `canvases` with the renamed constraints + the tenants FK) and drop `layout_profiles`, and update `devices`/`device_pairing_codes` columns + re-add the composite FKs from `0095` with the renamed constraint names. Do **not** hand-edit `meta/*` snapshots — let generation write them.

- [ ] **Step 4: Hand-write the `--custom` RLS migration for `canvases`** (drizzle emits only `ENABLE`; this is the verbatim adaptation of `0089`).

Run: `pnpm --filter @waitron/db db:generate:custom` to scaffold the next migration file, then fill it:

```sql
-- FORCE ROW LEVEL SECURITY + a tenant-isolation policy + the SELECT/INSERT/UPDATE/DELETE app-role
-- grant for canvases (renamed from layout_profiles, SP-B3.2 Phase A). Verbatim adaptation of 0089:
-- current_tenant_id() + app_user exist from 0001; FORCE isolates the owner too (inmutabilidad asserts
-- relforcerowsecurity on every tenant_id-bearing table); FOR ALL so USING+WITH CHECK both apply;
-- REVOKE ALL first so a prior GRANT ALL cannot survive. Canvases are mutable AND deletable config —
-- the editor creates, edits and removes named canvases — so app_user holds SELECT, INSERT, UPDATE, DELETE.
ALTER TABLE "canvases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "canvases_tenant_isolation" ON "canvases"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "canvases" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "canvases" TO app_user;
```

- [ ] **Step 5: Rename the layouts model + store files + their intra-package imports.**

`git mv` the four source files + their tests per the token map. In each renamed file and every importer within `packages/layouts/src`, apply the token map: `ProfileDef`→`CanvasDef`, `validateProfile`→`validateCanvas`, `DEFAULT_PROFILES`→`DEFAULT_CANVASES`, `listProfiles`→`listCanvases` (etc.), `layoutProfiles`→`canvases` (the db import in `canvas-store.ts`), and the `./profile.js`→`./canvas.js` import specifiers. In `canvas-store.ts` update `asNameTaken`'s constraint check `"layout_profiles_tenant_name_key"` → `"canvases_tenant_name_key"` and the `profile.name_taken`/`profile.not_found` throws → `canvas.*`.

- [ ] **Step 6: Rename the error codes.**

In `packages/layouts/src/errors.ts`: `"profile.invalid"`→`"canvas.invalid"` (keep the full param interface), `"profile.not_found"`→`"canvas.not_found"`, `"profile.name_taken"`→`"canvas.name_taken"` (both `Record<string, never>`). Update the grep-receipt comment block to a dated note recording the rename (do not delete the provenance; add: `// 2026-09-04 SP-B3.2 Phase A: profile.* renamed to canvas.* (pre-prod, no shipped consumers).`). Update the barrel `index.ts` exports.

- [ ] **Step 7: Update the layouts tests (fixtures + expected codes only).**

In the renamed `*.test.ts` files, update imports, the expected error codes (`profile.invalid`→`canvas.invalid` etc.), and any `layout_profiles`/`layoutProfiles` references in the RLS suite. **Do not change what each test asserts** — same behaviour, renamed identifiers. In `packages/db`'s renamed `canvases.rls.test.ts`, update the table reference and any grant/policy-name assertions to `canvases_*`.

- [ ] **Step 8: Run db + layouts suites + the inmutabilidad guard.**

Run: `pnpm --filter @waitron/db test:coverage` — Expected: PASS (incl. `canvases.rls.test.ts`, `devices.fk.test.ts`).
Run: `pnpm --filter @waitron/layouts test:coverage` — Expected: PASS.
Run: `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — Expected: PASS with `canvases: relforcerowsecurity=true` (the renamed tenant-scoped table is scanned by column, so it must show FORCE).
Run: `pnpm --filter @waitron/db typecheck && pnpm --filter @waitron/layouts typecheck` — Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add -A packages/db packages/layouts
git commit -s -m "refactor(canvas): rename layout_profiles→canvases in db + @waitron/layouts

Table, constraints, FK columns (devices + device_pairing_codes), the model
(ProfileDef→CanvasDef), store fns, and error codes profile.*→canvas.*.
Behaviour-preserving; pre-prod drop/recreate migration re-establishes FORCE
RLS + policy + grants. inmutabilidad green on canvases."
```

---

## Task A2: Rename in `apps/server` (routes, boot, capability enforcement)

`apps/server` imports the (now renamed) `@waitron/layouts` + `@waitron/db`, so it is red after A1 until this task; its own suite is verifiable green at the end of this task.

**Files:**
- Modify: `apps/server/src/management-api.ts` (imports `createProfile`/`getProfile`/`listProfiles`/`updateProfile`/`deleteProfile` → `*Canvas*`; the five `/management-api/profiles[/:id]` routes → `/canvases[/:id]`; `requireProfileId`→`requireCanvasId`; the error→HTTP map keys `profile.*`→`canvas.*`; every doc comment)
- Modify: `apps/server/src/till-api.ts` (import `getProfile`/`getProfileForFormFactor`→`getCanvas`/`getCanvasForFormFactor`; the boot resolution `let profile`→`let canvas`, `device.layoutProfileId`→`device.canvasId`; the response spread key `profile`→`canvas`)
- Modify: `apps/server/src/device-session.ts` (`assertDeviceCapability`: `resolved.layoutProfileId`→`resolved.canvasId`, `getProfile`→`getCanvas`, `profile.definition.capabilities`→`canvas.definition.capabilities`)
- Modify: `apps/server/src/device-api.ts` (the `assign-profile` route → `assign-canvas`; the enrolment `layoutProfileId` binding → `canvasId`; `bindingFkField`'s mapped constraint `devices_layout_profile_fk`→`devices_canvas_fk` and the pairing-codes one)
- Modify: any `DeviceBinding`/device projection type carrying `layoutProfileId`→`canvasId` (grep `layoutProfile` under `apps/server/src`)
- Rename/modify tests: `management-api.profiles.rls.test.ts`→`management-api.canvases.rls.test.ts`; the boot/e2e tests asserting the `/api/till` `profile` key and the `assign-profile` route (grep `layoutProfile`, `/profiles`, `assign-profile`, `profile.not_found|name_taken|invalid` under `apps/server`)

**Interfaces:**
- Consumes: `@waitron/layouts` renamed exports (Task A1); db `canvases` (A1).
- Produces: `GET/POST/PUT/DELETE /management-api/canvases[/:id]`; `/api/till` response now carries `canvas` (not `profile`); `POST /management-api/devices/:id/assign-canvas` with body `{ canvasId }`; error map maps `canvas.not_found`→404 / `canvas.name_taken`→409 / `canvas.invalid`→400.

- [ ] **Step 1: Apply the token map across the four server files + their imports.** Grep first: `grep -rn "layoutProfile\|/profiles\|assign-profile\|requireProfileId\|profile\.\(not_found\|name_taken\|invalid\)\|getProfile\|listProfiles\|createProfile\|updateProfile\|deleteProfile\|DEFAULT_PROFILES" apps/server/src | grep -v "\.test\."` and change each site.

- [ ] **Step 2: Update the boot contract test to pin the renamed key.** In the boot/e2e test that asserts the `/api/till` payload, change the expectation from `profile` to `canvas`. Add/keep an explicit assertion that an enrolled device's boot payload has a `canvas` key and a cookieless boot does **not** (behaviour unchanged — the key just renamed).

- [ ] **Step 3: Run to verify the rename compiles + behaves.**

Run: `pnpm --filter @waitron/server typecheck` — Expected: PASS.
Run: `pnpm --filter @waitron/server test:coverage` — Expected: PASS (renamed `management-api.canvases.rls.test.ts`; boot/e2e green with the `canvas` key; `device-session` capability tests green).

- [ ] **Step 4: Commit.**

```bash
git add -A apps/server
git commit -s -m "refactor(canvas): rename profile→canvas in apps/server

Routes /management-api/canvases[/:id], /api/till 'canvas' key,
assign-canvas route + canvasId binding, capability firewall reads
canvas.definition.capabilities, error map canvas.*. Behaviour-preserving."
```

---

## Task A3: Rename in `apps/till` (local mirror, boot, card grid)

**Files:**
- Modify: `apps/till/src/layout.ts` (`ProfileDef`→`CanvasDef`; keep the other mirror types)
- Modify: `apps/till/src/api/client.ts` (`TillInfo.profile?: ProfileDef`→`canvas?: CanvasDef`; read the `canvas` key)
- Modify: `apps/till/src/till-app.ts` (`@state() private profile?`→`canvas?`; every `this.profile` read → `this.canvas` — the grep list: ~220-222, 257-259, 489-495, 569-575, 636-642, 717, 765-769, 1453-1460, 1569, 1620-1621, 1934-1941, 2029, 2091-2096, 2100-2118, 2122-2148, 2185-2188, 2227, 2369-2379; `till.profile`→`till.canvas`; helpers `#counterTab`/`#shellActive`/`#inShell`/`#activeTab`/`#tableOrderTabKey` read `this.canvas.tabs`)
- Modify: `apps/till/src/widgets/card-grid.ts` (only if it names `ProfileDef`; the `.capabilities`/`.tab` props are unchanged)
- Modify tests: grep `ProfileDef`, `\.profile\b`, `till.profile`, `profile:` under `apps/till/src` `*.test.ts` and update fixtures/imports (a stub `TillInfo` now uses `canvas:`)

**Interfaces:**
- Consumes: the `/api/till` `canvas` key (Task A2).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Apply the token map.** Grep: `grep -rn "ProfileDef\|this\.profile\|till\.profile\|\bprofile\b" apps/till/src | grep -v "\.test\."` — rename the layout-display sites (leave any unrelated "profile"). The till uses `CanvasDef` from its own `layout.ts` mirror (never `@waitron/layouts`).

- [ ] **Step 2: Update till tests (fixtures + names).** A boot stub's `profile: {...}` becomes `canvas: {...}`; imports of `ProfileDef` become `CanvasDef`. **Preserve every behavioural assertion** (counter renders from the canvas's counter tab, tab shell, capability→absent, etc.).

- [ ] **Step 3: Verify.**

Run: `pnpm --filter @waitron/till typecheck` — Expected: PASS.
Run: `pnpm --filter @waitron/till test:coverage` — Expected: PASS (95/95/90/88).

- [ ] **Step 4: Commit.**

```bash
git add -A apps/till
git commit -s -m "refactor(canvas): rename profile→canvas in apps/till

Local mirror CanvasDef, TillInfo.canvas, till-app this.canvas + helpers,
reads the /api/till 'canvas' key. Behaviour-preserving."
```

---

## Task A4: Rename in `apps/dashboard` (client, devices screen, i18n)

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`LayoutProfile`→`Canvas`; `listProfiles`→`listCanvases` + its `/management-api/profiles`→`/canvases` path and `{ profiles }`→`{ canvases }` unwrap; `DeviceRow.layoutProfileId`→`canvasId`; `reassignDevice(id, layoutProfileId)`→`(id, canvasId)` with the `/assign-profile`→`/assign-canvas` path and `{ layoutProfileId }`→`{ canvasId }` body; the enrolment input `layoutProfileId?`→`canvasId?`)
- Modify: `apps/dashboard/src/screens/devices-screen.ts` (`profiles: LayoutProfile[]`→`canvases: Canvas[]`; `selectedProfile`→`selectedCanvas`; `#profileSelect`→`#canvasSelect`; `#onProfileChange`→`#onCanvasChange`; `#onReassign(id, layoutProfileId)`→`(id, canvasId)`; `device.layoutProfileId`→`device.canvasId`; `this.api.listProfiles()`→`listCanvases()`; the per-row `reassign-${device.id}` select + the enrol `profile-select`; the i18n keys — see next file)
- Modify: `apps/dashboard/src/i18n/strings.ts` — rename the **device** binding strings' VALUES from "profile" to "canvas" (`devices.profile`, `devices.profile_none`, `devices.reassign`) in both `en` and `es`; if the plan keeps the key names, only the values change — but for consistency rename the keys to `devices.canvas`/`devices.canvas_none` and update the screen. (Grep `devices.profile`/`devices.reassign` in `strings.ts` + `devices-screen.ts`.)
- Modify: `apps/dashboard/src/i18n/codes.ts` — no `profile.*` entries exist yet, so nothing to rename here (Phase B adds `canvas.*`).
- Modify tests: `devices-screen.test.ts`, `devices-screen.a11y.test.ts` (stub `listProfiles`→`listCanvases`, `layoutProfileId`→`canvasId`, `data-test` `reassign-`/`profile-select` if renamed, expected labels)

**Interfaces:**
- Consumes: `/management-api/canvases`, `/assign-canvas` (Task A2).
- Produces: dashboard client `listCanvases()`, `reassignDevice(id, canvasId)`, `Canvas` type, `DeviceRow.canvasId` — Phase B builds on these.

- [ ] **Step 1: Apply the token map to the client + devices screen + i18n.** Grep: `grep -rn "LayoutProfile\|listProfiles\|layoutProfileId\|selectedProfile\|#profileSelect\|assign-profile\|devices\.profile\|devices\.reassign" apps/dashboard/src | grep -v "\.test\."`.

- [ ] **Step 2: Update the devices-screen tests** (stub method name, field name, any renamed `data-test`/label). Preserve the reassign behavioural assertions (the select preselects to the device's binding; a failed reassign snaps back).

- [ ] **Step 3: Verify.**

Run: `pnpm --filter @waitron/dashboard typecheck` — Expected: PASS.
Run: `pnpm --filter @waitron/dashboard test:coverage` — Expected: PASS (95/95/90/88).

- [ ] **Step 4: Whole-workspace gate (a shared-export rename is cross-package — a filtered green proves nothing).**

Run: `pnpm typecheck` — Expected: PASS (workspace re-green).
Run: `pnpm lint && pnpm format:check` — Expected: PASS.
Run: `pnpm test` — Expected: PASS. Then the coverage-shard breadth the four-command gate misses: run each package's `test:coverage` that touched the rename is already done above; additionally run `pnpm --filter @waitron/fiscal-verifactu test:coverage` (inmutabilidad in its shard) and confirm no other package references the old names: `grep -rn "layoutProfiles\|layout_profiles\|ProfileDef\|DEFAULT_PROFILES\|\"profile\.\(not_found\|name_taken\|invalid\)\"\|/management-api/profiles\|assign-profile" packages apps | grep -v "\.test\.\|drizzle/meta\|docs/"` — Expected: **no output** (every live reference renamed; historical drizzle snapshots and docs are exempt).

- [ ] **Step 5: Commit.**

```bash
git add -A apps/dashboard
git commit -s -m "refactor(canvas): rename profile→canvas in apps/dashboard

Client Canvas/listCanvases/reassignDevice(canvasId), devices-screen binding
select, i18n device-binding strings. Whole workspace green; no live
references to the old names remain. Behaviour-preserving."
```

---

## Task A5: Docs pointers (backlog + parent spec)

**Files:**
- Modify: `docs/backlog.md` (the SP-B / B3 rows: note B3.2 in flight; that Phase A renamed profile→canvas)
- Modify: `docs/superpowers/specs/2026-09-03-sp-b-grid-editor-and-rendering-design.md` (a dated pointer at §8 that "layout profile" is now "canvas"; do **not** rewrite its history)

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a dated pointer to the parent spec §8** (one line): `> **2026-09-04 (SP-B3.2):** the "layout profile" authored here is renamed **canvas**; "profile" is reserved for a future device profile. See 2026-09-04-sp-b3-2-canvas-editor-design.md.` Do not edit the surrounding prose.

- [ ] **Step 2: Update `docs/backlog.md`** — mark B3.2 in flight on `feat/sp-b3-2-grid-editor`, phase A = rename (behaviour-preserving), and record the device-profile follow-on. (A backlog edit is normally the lightweight direct-to-main flow, but here it rides the feature branch since it documents this branch's work — commit it with the branch.)

- [ ] **Step 3: Commit.**

```bash
git add -A docs/
git commit -s -m "docs: SP-B3.2 Phase A landed the profile→canvas rename; dated pointers

Backlog: B3.2 in flight; parent spec §8 dated pointer (history not rewritten)."
```

---

## Self-review checklist (run before handing off Phase A)

- **Spec coverage:** §5's inventory — layouts ✓ (A1), db + both FK tables + migration + RLS ✓ (A1), server routes/boot/enforcement/assign route ✓ (A2), till mirror/app ✓ (A3), dashboard client/devices/i18n ✓ (A4), docs pointer ✓ (A5). The `/api/till` `canvas` key contract-pinned ✓ (A2 Step 2).
- **Guards:** inmutabilidad on `canvases` ✓ (A1 Step 8); errors-reachable runs in the whole-workspace suite ✓ (A4 Step 4); the `canvases.rls.test.ts` FORCE/policy/grant proof ✓ (A1); the final grep-for-old-names ✓ (A4 Step 4).
- **Behaviour preserved:** every task updates fixtures/codes, none rewrites an assertion.
- **Order:** db+layouts → server → till → dashboard keeps each layer's own suite verifiable as it completes; workspace green only at A4.
