# Split `till.configure` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `till.configure` permission with three permissions named for what they guard — `layout.configure`, `venue.configure`, `system.manage` — with no change to which roles hold what.

**Architecture:** Two green commits. Commit 1 adds the three permissions to the catalogue and the manager role, and moves every call site onto them, leaving `till.configure` present but unused. Commit 2 removes `till.configure` and adds a guard that the retired name appears nowhere. Splitting this way keeps the tree compiling and every test green after each commit, and gives a reviewer a clean add-then-remove boundary.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, drizzle, Hono. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-14-split-till-configure-permission-design.md` — read it; it carries the exact call-site→permission mapping this plan implements.

## Global Constraints

- **No role's access changes.** manager and admin hold all three new permissions; staff and supervisor hold none. Any test whose expected 401/403/200 changes is a bug in the split (`CLAUDE.md` global rule: preserve behavioural assertions).
- **The compiler does not trace these consumers.** `authorizeManager({ permission })` is typed `Permission | (string & {})`, so a missed `authorizeManager` call site with `"till.configure"` still compiles. Only the `MANAGER` set and `packages/layouts/src/card-contract.ts:96` (both typed to the `Permission` union) fail to compile when the name is removed. Completeness rests on the grep mapping and the Task 3 guard, not on the typechecker.
- **Names follow the dotted style** already in the catalogue (`report.view`, `device.manage`).
- **Every commit is `git commit -s`.** Plain-English commit messages (`CLAUDE.md`); exact identifiers appear once as pointers.
- **Run focused tests while implementing**; the pre-push hook and CI run the package suites. Fiscal-adjacent gating: this is an auth change, so it takes the full review path at `/finish-branch` and owner sign-off at land.

---

### Task 1: Add the three permissions, keep `till.configure`, and migrate the catalogue tests

**Files:**

- Modify: `packages/identity/src/permissions.ts` (the `PERMISSIONS` array and the `MANAGER` set)
- Test: `packages/identity/src/permissions.test.ts`

**Interfaces:**

- Consumes: `roleHasPermission(role, permission)`, `PERMISSIONS`, the `Permission` union — all already exported from `packages/identity/src/permissions.ts`.
- Produces: three new members of `PERMISSIONS` and `Permission`: `"layout.configure"`, `"venue.configure"`, `"system.manage"`, each held by `manager` and `admin`.

- [ ] **Step 1: Write the failing parity test** for the three new names, beside the existing `till.configure` test in `packages/identity/src/permissions.test.ts`:

```ts
it("grants layout.configure, venue.configure and system.manage to manager and admin only", () => {
  // The three permissions that replace till.configure (spec 2026-09-14). Each is held by exactly the
  // roles that held till.configure — manager and admin — and never by staff or supervisor, so no
  // role's access moves when the call sites migrate.
  for (const p of ["layout.configure", "venue.configure", "system.manage"] as const) {
    expect(PERMISSIONS).toContain(p);
    expect(roleHasPermission("manager", p)).toBe(true);
    expect(roleHasPermission("admin", p)).toBe(true);
    expect(roleHasPermission("staff", p)).toBe(false);
    expect(roleHasPermission("supervisor", p)).toBe(false);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/identity test -- permissions.test.ts`
Expected: FAIL — `PERMISSIONS` does not contain the new names, so `toContain` fails (and `roleHasPermission` returns false).

- [ ] **Step 3: Add the three to the catalogue and the manager set** in `packages/identity/src/permissions.ts`. In `PERMISSIONS`, add the three entries near `till.configure`, each with a one-line comment naming what it guards (screen/receipt authoring; the physical venue incl. floor plan; box lifecycle). In the `MANAGER` set, add the three beside `till.configure` (leave `till.configure` in place for now). `ALL`/admin spreads `PERMISSIONS`, so admin gains them automatically.

- [ ] **Step 4: Run the identity tests and watch them pass**

Run: `pnpm --filter @waitron/identity test -- permissions.test.ts`
Expected: PASS — the new test passes; the existing `till.configure` test and the all-permissions loops (`staff` false; `manager` = `!ADMIN_ONLY`) still pass because `till.configure` is unchanged and the three new names are not admin-only.

- [ ] **Step 5: Commit**

```bash
git add packages/identity/src/permissions.ts packages/identity/src/permissions.test.ts
git commit -s -m "Add layout/venue/system permissions beside till.configure"
```

---

### Task 2: Move every call site onto the new names

`till.configure` still exists after this task; it is simply no longer referenced by any call site. The tree stays green throughout. Change each site to the permission the spec's mapping assigns it. Group the edits by target permission; commit once at the end.

**Files (from the spec's mapping — change the permission string at each):**

- → `layout.configure`:
  - `packages/layouts/src/canvas-store.ts` (three write verbs)
  - `packages/layouts/src/theme-store.ts`
  - `packages/layouts/src/receipt-store.ts`
  - `packages/layouts/src/device-profile-store.ts` (three write verbs)
  - `apps/server/src/management-api.ts` — the six read routes: `/management-api/receipt`, `/canvases`, `/canvases/:id`, `/theme`, `/device-profiles`, `/device-profiles/:id`
- → `venue.configure`:
  - `apps/server/src/management-api.ts` — `withVenueAuth` (the shared helper the zone/table verbs use)
  - `apps/server/src/till-api.ts` — the table-placement PUT and DELETE gates, and the `canConfigureTill` capability computed in the till login response
  - `apps/server/src/tables.ts` — `requireConfigure` (the service-status CRUD gate)
  - `apps/server/src/location-settings-api.ts` — the gate and the `AppError` param
  - `packages/layouts/src/card-contract.ts` — the `table-layout-editor` card's `requiredPermission`
  - `apps/dashboard/src/screens/canvas-editor/card-contracts.ts` — the `table-layout-editor` card's `requiredPermission`
  - `apps/till/src/layout.ts` — `CARD_REQUIRED_PERMISSION["table-layout-editor"]`
  - `apps/till/src/widgets/card-grid.ts` — the `=== "till.configure"` comparison
- → `system.manage`:
  - `apps/server/src/backup-api.ts`
  - `apps/server/src/recovery-bundle-api.ts`
  - `apps/server/src/configuration-export-api.ts`
  - `apps/server/src/box-retire.ts`
  - `apps/server/src/box-status.ts`
- Tests: every `*.test.ts` that asserts a 401/403/200 on one of these routes and names `"till.configure"` — update the permission string only, never the expected status. Find them with the grep in Step 1. Known: `apps/server/src/till-api.test.ts`, `apps/server/src/awaiting-fiscal-cert.test.ts`, and the per-area route suites (`management-api.pg.test.ts`, the `tables`, `backup`, `box-status`, `location-settings`, `configuration-export`, `recovery-bundle` suites).

**Interfaces:**

- Consumes: the three permissions from Task 1.
- Produces: no source reference to `"till.configure"` outside `packages/identity/src/permissions.ts` and test/spec files. (The catalogue entry itself is removed in Task 3.)

- [ ] **Step 1: List every remaining occurrence** so nothing is missed (the compiler will not catch most):

Run: `git grep -n '"till.configure"' -- packages apps`
Expected: the full set above. Keep this list; Step 4 re-runs it.

- [ ] **Step 2: Update each production call site** to the mapped permission. Where a comment names `till.configure` (e.g. `tables.ts:456`, `till-api.ts:736`, the `management-api.ts` route comments), update the comment to the new name too. Leave `canConfigureTill`'s field name unchanged (spec: internal client field, rename is a noted follow-up), but its value now comes from `roleHasPermission(role, "venue.configure")`.

- [ ] **Step 3: Update each test's permission string**, never its expected status. A staff-role backup route still expects 403, now against `system.manage`.

- [ ] **Step 4: Verify no production site remains** and typecheck:

Run: `git grep -n '"till.configure"' -- packages apps | grep -v '\.test\.' ; echo "---" ; pnpm -w typecheck`
Expected: the only line printed before `---` is `packages/identity/src/permissions.ts` (the catalogue entry, removed in Task 3); typecheck passes.

- [ ] **Step 5: Run the affected package suites**

Run: `pnpm --filter @waitron/layouts --filter @waitron/server --filter @waitron/identity test:coverage`
Expected: PASS, with no changed expected statuses.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -s -m "Move every call site off till.configure onto the new permissions"
```

---

### Task 3: Remove `till.configure` and guard that it is gone

**Files:**

- Modify: `packages/identity/src/permissions.ts` (remove from `PERMISSIONS` and `MANAGER`, and its doc comment)
- Modify: `packages/identity/src/permissions.test.ts` (remove the old `till.configure` parity test — the Task 1 test replaces it)
- Create: `scripts/till-configure-retired.test.ts` (a root-project guard)

**Interfaces:**

- Consumes: the migrated tree from Task 2.
- Produces: `till.configure` absent from the `Permission` union and from all source.

- [ ] **Step 1: Write the retired-name guard** at `scripts/till-configure-retired.test.ts`. It reads source text (say so in a comment — it is weaker than a type check, which is the whole reason it exists) and fails if the retired literal appears in any non-test source under `packages/` or `apps/`:

```ts
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Reads TEXT, not types: the permission is passed as `Permission | (string & {})`, so a stray
// `"till.configure"` on a missed route compiles clean. This guard is the safety net the typechecker
// cannot be — it greps the source. A `git grep` miss (a name built from pieces at runtime) escapes it.
describe("till.configure is retired", () => {
  it("appears in no production source under packages/ or apps/", () => {
    let out = "";
    try {
      out = execFileSync("git", ["grep", "-l", "till.configure", "--", "packages", "apps"], {
        encoding: "utf8",
      });
    } catch {
      out = ""; // git grep exits non-zero when there are no matches
    }
    const offenders = out
      .split("\n")
      .filter((f) => f.length > 0 && !f.endsWith(".test.ts"));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the guard and watch it fail**

Run: `pnpm vitest run scripts/till-configure-retired.test.ts`
Expected: FAIL — `packages/identity/src/permissions.ts` still contains the catalogue entry.

- [ ] **Step 3: Remove `till.configure`** from the `PERMISSIONS` array and the `MANAGER` set in `packages/identity/src/permissions.ts`, and delete or rewrite the doc comment that described it. Delete the old `till.configure` parity test in `permissions.test.ts` (the Task 1 test covers the replacements).

- [ ] **Step 4: Run the guard and the identity tests**

Run: `pnpm vitest run scripts/till-configure-retired.test.ts && pnpm --filter @waitron/identity test -- permissions.test.ts`
Expected: PASS — no offenders; the `Permission` union no longer includes `till.configure` and all parity tests pass.

- [ ] **Step 5: Full typecheck and the affected suites**

Run: `pnpm -w typecheck && pnpm --filter @waitron/identity --filter @waitron/layouts --filter @waitron/server test:coverage`
Expected: PASS. If `apps/till`'s `CARD_REQUIRED_PERMISSION` or `card-grid.ts` still named the old string, its own suite is the only place that would catch a now-dead comparison — confirm the till suite is green too (`pnpm --filter @waitron/till test:coverage`).

- [ ] **Step 6: Commit**

```bash
git add packages/identity/src/permissions.ts packages/identity/src/permissions.test.ts scripts/till-configure-retired.test.ts
git commit -s -m "Remove till.configure and guard that the retired name is gone"
```

---

## Notes for the whole-branch review (`/finish-branch`)

- **Grant parity is the one thing to verify hardest.** For a route per new permission, confirm by deletion that removing its `authorizeManager` call flips a staff case from 403 to 200 — the suites already do this for the sites they cover; spot-check one per permission.
- **The floor-plan grouping is a judgement call the owner made** (floor plan → `venue.configure`). If a reviewer thinks a specific site is mis-bucketed, that is a mapping question for the spec, not a silent re-edit.
- **`canConfigureTill` keeps its name** and now reflects `venue.configure`. A rename to `canEditFloorPlan` is a noted follow-up, out of scope here.
