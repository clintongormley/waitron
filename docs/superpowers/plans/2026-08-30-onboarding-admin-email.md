# Onboarding admin email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Capture the admin's dashboard-login **email** during onboarding (the `apps/setup` wizard),
threaded through `setup-api` → provisioning's `seed-admin`, so a production-provisioned admin can sign
in to the dashboard by email + password immediately — closing the Tier A #2 bootstrap gap without a
CLI flag or mirror-only workaround.

**Design (owner-approved, 2026-08-30):** the admin account is set up during onboarding via the setup UI.
The wizard's admin step already captures displayName/password/pin; add an **email** field and write it
through provisioning. Dashboard login is email-based (Tier A #2, landed #172); email uniqueness is
already enforced per-tenant by `persons_tenant_email_uq`.

**Key rulings:**
- **Email is OPTIONAL in the provisioning admin shape** (so existing `applyVenue` callers — dev-setup,
  e2e tests, seeds — do not break) but **REQUIRED in the onboarding UI** (the admin's dashboard
  credential). setup-api always sends it.
- **Validation/normalization at the `setup-api` boundary** (it already imports `@waitron/identity`).
  Provisioning just writes the value it is given (raw-SQL insert, no identity import — the existing
  seed-admin convention). Export `normalizeEmail`/`isValidEmail` from the identity barrel for setup-api.

## Global Constraints
- TDD (failing test first); every commit `git commit -s`.
- `TESTCONTAINERS_RYUK_DISABLED=true` for real-PG suites; `pnpm reap` if interrupted.
- Error codes name the domain concept, never renamed once shipped; `person.email_invalid` already exists.
- Design system for the setup screen: `wt-*` primitives + `--wt-*` tokens (setup uses `form-styles.ts`;
  follow the existing admin-screen field pattern), no hardcoded chrome.
- Provisioning is fiscal-adjacent: the `seed-admin` insert stays raw-SQL, RLS-scoped, `where not exists`
  (idempotent). Do NOT change its idempotency or add an identity import there.
- Before the PR: whole-workspace gate + `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
  (persons is tenant-scoped; a new value written to an existing column — confirm the guard stays green).

---

## Task 1: provisioning writes the admin email

**Files:**
- Modify: `packages/provisioning/src/venue-plan.ts` (admin request shape + `seed-admin` action), `packages/provisioning/src/venue-apply.ts` (the seed-admin insert)
- Test: `packages/provisioning/src/venue-apply.e2e.test.ts` or a sibling real-PG test

**Interfaces:**
- Produces: `ProvisionVenueRequest.admin` gains `email?: string`; the `seed-admin` action gains `email?: string`; the insert writes `email` (NULL when absent).

- [ ] **Step 1: Failing test** — extend the provisioning apply test to assert that when the admin request carries `email: "owner@x.com"`, the seeded `persons` admin row has that email; and when omitted, `email` is NULL. Real Postgres (uses `useTemplateDb`/applyVenue as the existing e2e does).
- [ ] **Step 2: Run — expect FAIL** (email not written). `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test venue-apply`
- [ ] **Step 3: Implement** — `venue-plan.ts`: add `email?: string` to the `admin` request shape and to the `seed-admin` action (`{ kind: "seed-admin"; displayName; pinHash; passwordHash; email? }`); thread `request.admin.email` into the planned action. `venue-apply.ts`: add `email` to the insert column list + `${action.email ?? null}` to the select, e.g.:
  ```ts
  insert into persons (tenant_id, display_name, pin_hash, password_hash, email, role)
  select ${tenantId}, ${action.displayName}, ${action.pinHash}, ${action.passwordHash}, ${action.email ?? null}, 'admin'
  where not exists (select 1 from persons where tenant_id = ${tenantId} and role = 'admin')
  ```
  Keep the idempotent `where not exists` and the raw-SQL/no-identity-import convention. Update the seed-admin comment to mention the email column.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `-s`: `feat(provisioning): seed-admin writes the admin's dashboard email`.

## Task 2: setup-api validates + threads the admin email

> **Correction (2026-08-30, finish-branch simplify).** The steps below export `normalizeEmail`/`isValidEmail`
> and re-compose them in setup-api — as implemented. The finish-branch simplify pass then CONSOLIDATED
> this: setup-api calls identity's existing composed helper **`normalizeAndValidateEmail`** (now exported
> from the barrel) directly, and the `normalizeEmail`/`isValidEmail` barrel exports were removed. Read
> `normalizeAndValidateEmail` wherever the steps below say `normalizeEmail`/`isValidEmail`.

**Files:**
- Modify: `packages/identity/src/index.ts` (export `normalizeEmail`/`isValidEmail`), `apps/server/src/setup-api.ts` (admin request → provisioning)
- Test: `apps/server/src/setup-api.*test.ts` (extend the admin-request path)

**Interfaces:**
- Consumes: provisioning `admin.email` (Task 1); `normalizeEmail`/`isValidEmail` from `@waitron/identity`.
- Produces: `setup-api` accepts `admin.email` (required string), normalizes + validates it, passes it to `planVenue`/`applyVenue`.

- [ ] **Step 1: Failing test** — the setup provision request with `admin.email: "Owner@X.com"` provisions an admin whose stored email is the normalized `owner@x.com`; a malformed `admin.email` (e.g. `"nope"`) is refused with a 400 (`person.email_invalid`, or setup-api's existing field-validation code — match the sibling convention for a bad `admin.*` field).
- [ ] **Step 2: Run — expect FAIL.** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test setup-api`
- [ ] **Step 3: Implement** — export `normalizeEmail`, `isValidEmail` from `packages/identity/src/index.ts`. In `setup-api.ts`'s admin parsing (~line 209): read `admin.email` via `asString`, `normalizeEmail` it, `isValidEmail`-check (throw the appropriate 400 code on malformed — reuse `person.email_invalid` and add it to setup-api's STATUS map if not present, or the code sibling `admin.*` fields use), and put the normalized value on the provisioning `admin` shape. Do NOT hash it (email is not a secret).
- [ ] **Step 4: Run — expect PASS**, then `pnpm --filter @waitron/server typecheck`.
- [ ] **Step 5: Commit** `-s`: `feat(server): setup-api validates + threads the onboarding admin email`.

## Task 3: onboarding admin step captures the email

**Files:**
- Modify: `apps/setup/src/api/client.ts` (`AdminDraft`), `apps/setup/src/screens/admin-screen.ts` (+ its `.test.ts` / `.a11y.test.ts`)

**Interfaces:**
- Consumes: setup-api `admin.email` (Task 2).
- Produces: `AdminDraft` gains `email: string`; the admin screen collects it (required) and emits it.

- [ ] **Step 1: Failing test** — extend `admin-screen.test.ts`: the step renders an email `wt-input` (`data-test="email"`, `type="email"`); it is required (empty → the `invalid`/error path, no advance); a completed step emits the draft including `email`. Update the a11y test for the new field's accessible name.
- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @waitron/setup test admin-screen`
- [ ] **Step 3: Implement** — `AdminDraft`: add `email: string`. `admin-screen.ts`: add `"email"` to `AdminField`, seed it from the draft on mount, add the `wt-input` field (`type="email"`, follow the existing `#field` pattern), include it in the required-fields validation (`values.email.trim() === "" → invalid`), and include it in the emitted advance detail. Update the error copy ("Enter a display name, email, password and PIN …"). Design system: `wt-input`, tokens only.
- [ ] **Step 4: Run — expect PASS** (+ a11y), then `pnpm --filter @waitron/setup typecheck`.
- [ ] **Step 5: Commit** `-s`: `feat(setup): capture the admin's dashboard email in the onboarding wizard`.

## Task 4: end-to-end — the onboarding-provisioned admin logs in by email

**Files:**
- Modify: `packages/provisioning/src/venue-apply.e2e.test.ts` (the existing admin-auth e2e)

- [ ] **Step 1: Failing test** — provision a venue via `applyVenue` WITH an `admin.email`, then assert `loginManager(tx, { tenantId, email, password })` succeeds (mints a session) and a wrong password is rejected — i.e. the onboarding-provisioned admin can now sign in by EMAIL (not only by id via `loginManagerById`). Keep the existing by-id case.
- [ ] **Step 2: Run — expect FAIL** (admin seeded without email → `loginManager` by email finds nothing → `password.invalid`). `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test venue-apply`
- [ ] **Step 3: Implement** — pass `admin.email` through the test's `applyVenue` call (the code paths from Tasks 1-2 do the rest; no new product code expected here — if something is missing, that's a Task 1/2 gap, fix it there).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `-s`: `test(provisioning): onboarding-provisioned admin authenticates by email`.

## Final verification
- [ ] Whole-workspace gate: `pnpm lint && pnpm typecheck && pnpm format:check`, then `TESTCONTAINERS_RYUK_DISABLED=true pnpm -r test:coverage`.
- [ ] `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.
- [ ] Update `docs/backlog.md`: the *Open threads* admin-onboarding item → BUILT/LANDED (at land-branch).

## Deferred (not this slice)
- **dev-setup demo cleanup:** now that provisioning accepts an admin email, `dev-setup.ts` could pass
  `DEMO_ADMIN_EMAIL` through `applyVenue` and drop `seedStaff`'s post-provision admin-email UPDATE hack.
  Optional simplification; leave the working UPDATE in place unless trivially clean. Note in the report.
