# Layout profiles — SP-A.2: device unification & hardware — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist reusable layout profiles + themes, make a till a first-class enrolled device with per-device hardware, enforce the profile capability flags server-side, and cut the sale-time `till_id` over from an env var to the authenticated device — one H2-gated slice.

**Architecture:** New tenant-scoped `layout_profiles` + `tenant_themes` tables (opaque validated jsonb, FORCE RLS) added *alongside* the still-live `till_layouts` (removed only in SP-B). A `till` device kind and a `till_id`/`layout_profile_id`/hardware column set on `devices` + `device_pairing_codes`, stamped at enrol. `@waitron/layouts` gains a profile/theme store service; `apps/server` gains management CRUD, an enrolment extension, profile-capability enforcement generalising `assertNotHandheld`, and a per-request sale-`till_id` resolved from the device. The fiscal chain/series/huella are untouched — proven by a container/unit receipt + owner sign-off before landing.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Drizzle ORM + PostgreSQL 18 (Testcontainers) / PGlite, Vitest, `@waitron/shared` `AppError` registry, Hono (server routes).

**Spec:** `docs/superpowers/specs/2026-09-02-layout-designer-and-device-profiles-design.md` — the whole design; **§16 is the SP-A.2 slice resolutions this plan implements**. Read both.

## Global Constraints

- **H2 fiscal gate.** Nothing in this slice lands without the §16.4 receipt (Task 16) **and** explicit owner sign-off. Never widen a grant to make a test pass.
- **No back-compat / no data migration** (pre-production): schema changes drop/recreate; no backfill. `till_layouts` is **kept**, not migrated or dropped (removal is SP-B).
- **New `tenant_id`-bearing table ⇒ FORCE RLS + `<t>_tenant_isolation` policy + `app_user` grants** in a hand-written `--custom` migration (`.enableRLS()` gives only ENABLE). After adding any such table run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.
- **Migrations:** never hand-edit drizzle snapshots. Model tables in TS, then `pnpm --filter @waitron/db db:generate` (modelled DDL) and `pnpm --filter @waitron/db db:generate:custom` (RLS/CHECK/composite-FK SQL). Migration numbers continue from **0087** (next free is 0088).
- **Error codes** name the domain concept, never the package; never renamed once shipped; every throwing file does `import "./errors.js"`. `profile.invalid`/`theme.invalid` already exist in `packages/layouts/src/errors.ts`; `device.*` in `apps/server/src/errors.ts`. Add new **leaf reasons** under existing codes; grep siblings before coining anything new.
- **Error params never echo an author value** — a `reason` enum, a key/field NAME, or a numeric index only (CLAUDE.md §1).
- **No SQL by string concatenation.** Drizzle parameterises `sql` templates; utility statements (`GRANT`, `ALTER TYPE`) in `--custom` SQL are static text, no interpolation of user values.
- **Real Postgres** (`useRealPostgres` / `describeEachTarget`) for anything about RLS-as-`app_user`, grants, or the enrol/redeem concurrency; PGlite is a false pass there. Run container suites with `TESTCONTAINERS_RYUK_DISABLED=true`; `pnpm reap` after an interrupted run.
- **Gate before pushing:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, plus `pnpm --filter <pkg> test:coverage` for each touched package (CI runs coverage, not `test`). Coverage floors: `98/98/98/95` (server/db/layouts).
- **Prove every guard by deletion** — remove the check, watch the test fail, restore.
- Every commit: `git commit -s`.

---

## Phase 1 — `@waitron/layouts` pure logic (SP-A.1 deferrals). No DB; lands green independently.

### Task 1: Deferral (b) — dedicated `bad_capabilities` reason

**Files:**
- Modify: `packages/layouts/src/errors.ts:75-91` (add reason to the `profile.invalid` enum + doc)
- Modify: `packages/layouts/src/validate-profile.ts:53-59` (`validateCapabilities`)
- Test: `packages/layouts/src/validate-profile.test.ts`

**Interfaces:**
- Produces: `profile.invalid` gains `reason: "bad_capabilities"`; `validateCapabilities` throws it instead of `not_object`.

- [ ] **Step 1: Failing test** — add to `validate-profile.test.ts`:

```ts
it("rejects a non-array capabilities with bad_capabilities", () => {
  expect(() => validateProfile({ formFactor: "till", capabilities: "x", tabs: [] }))
    .toThrowError(expect.objectContaining({ code: "profile.invalid", params: { reason: "bad_capabilities" } }));
});
it("rejects an unknown capability flag with bad_capabilities", () => {
  expect(() => validateProfile({ formFactor: "till", capabilities: ["nope"], tabs: [] }))
    .toThrowError(expect.objectContaining({ code: "profile.invalid", params: { reason: "bad_capabilities" } }));
});
```

- [ ] **Step 2: Run — expect FAIL** (`reason` is `not_object` today): `pnpm --filter @waitron/layouts test validate-profile`
- [ ] **Step 3: Implement** — in `errors.ts` add `| "bad_capabilities"` to the `profile.invalid` `reason` union and update the doc line for it (`bad_capabilities — capabilities was not an array of known capability flags`); adjust the `not_object` doc to drop the capabilities clause. In `validate-profile.ts:56` change `{ reason: "not_object" }` → `{ reason: "bad_capabilities" }`.
- [ ] **Step 4: Run — expect PASS**, and confirm the existing `not_object` (non-object input) test still passes.
- [ ] **Step 5: Commit** — `git add -A && git commit -s -m "feat(layouts): dedicated profile.invalid bad_capabilities reason (SP-A.2 deferral b)"`

### Task 2: Deferral (d) — defensively copy card `config`

**Files:**
- Modify: `packages/layouts/src/validate-profile.ts:134`
- Test: `packages/layouts/src/validate-profile.test.ts`

**Interfaces:**
- Produces: a validated `CardInstance.config` no longer aliases the untrusted input object.

- [ ] **Step 1: Failing test:**

```ts
it("does not alias the input card config", () => {
  const input = { formFactor: "till", capabilities: [], tabs: [{ key: "t", title: "T", columns: 12,
    cards: [{ type: "product-grid", colSpan: 8, rowSpan: 6, config: { columns: 4 } }] }] };
  const out = validateProfile(input);
  expect(out.tabs[0].cards[0].config).not.toBe(input.tabs[0].cards[0].config);
  (input.tabs[0].cards[0].config as Record<string, unknown>).columns = 999;
  expect(out.tabs[0].cards[0].config.columns).toBe(4);
});
```

- [ ] **Step 2: Run — expect FAIL** (`.not.toBe` fails; config is the same reference).
- [ ] **Step 3: Implement** — at `validate-profile.ts:134` change `const card: CardInstance = { type, colSpan, rowSpan, config };` → `const card: CardInstance = { type, colSpan, rowSpan, config: { ...config } };`. Update the copy-comment above it to say both `config` and (a non-empty) `visibleWhen` are copied.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -s -m "fix(layouts): defensively copy validated card config (SP-A.2 deferral d)"`

### Task 3: Deferral (a) — a profile's `theme` round-trips

**Files:**
- Modify: `packages/layouts/src/validate-profile.ts` (import + call `validateThemeOverride`, include on the returned profile)
- Test: `packages/layouts/src/validate-profile.test.ts`

**Interfaces:**
- Consumes: `validateThemeOverride(input: unknown): ThemeOverride` from `./theme.js` (throws `theme.invalid`).
- Produces: `validateProfile` sets `profile.theme` when `input.theme` is present; a bad theme surfaces as `theme.invalid` (delegated, not re-wrapped).

- [ ] **Step 1: Failing tests:**

```ts
it("round-trips a valid theme override", () => {
  const theme = { tokens: { "--wt-color-primary": "#123456" } };
  const out = validateProfile({ formFactor: "phone-portrait", capabilities: [], tabs: [
    { key: "t", title: "T", columns: 4, cards: [] }], theme });
  expect(out.theme).toEqual(theme);
  expect(out.theme).not.toBe(theme); // validated copy, not the input alias
});
it("omits theme when absent", () => {
  const out = validateProfile({ formFactor: "phone-portrait", capabilities: [], tabs: [
    { key: "t", title: "T", columns: 4, cards: [] }] });
  expect("theme" in out).toBe(false);
});
it("surfaces an invalid theme as theme.invalid", () => {
  expect(() => validateProfile({ formFactor: "phone-portrait", capabilities: [], tabs: [
    { key: "t", title: "T", columns: 4, cards: [] }], theme: { tokens: { "--evil": "x" } } }))
    .toThrowError(expect.objectContaining({ code: "theme.invalid", params: { reason: "unknown_token" } }));
});
```

(`phone-portrait` is a non-selling form factor, so an empty `tabs[].cards` is allowed — `assertSaleCritical` only fires for `till`.)

- [ ] **Step 2: Run — expect FAIL** (`out.theme` is `undefined`; the invalid case does not throw).
- [ ] **Step 3: Implement** — in `validate-profile.ts` add `import { validateThemeOverride } from "./theme.js";`. After `assertSaleCritical(profile, SELLING_FORM_FACTORS);` and before `return profile;`:

```ts
if (input.theme !== undefined) profile.theme = validateThemeOverride(input.theme);
```

Update the `validateProfile` doc comment: "a present `theme` is validated via `validateThemeOverride` (so a bad theme surfaces as `theme.invalid`) and round-trips on the returned profile".

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(layouts): validateProfile round-trips theme via validateThemeOverride (SP-A.2 deferral a)"`

### Task 4: Deferral (c) — `THEMEABLE_TOKENS` registry-consistency guard

**Files:**
- Create: `packages/layouts/src/theme-registry.test.ts`

**Interfaces:**
- Consumes: `THEMEABLE_TOKENS` from `./theme.js`; the real registry files `packages/ui/src/tokens/{colors,structure}.css`.

- [ ] **Step 1: Write the guard test** (all 7 provisional tokens were verified to exist on 2026-09-02: `--wt-color-{primary,on-primary,surface,text,danger}` in colors.css, `--wt-radius-md` + `--wt-font-family` in structure.css):

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEMEABLE_TOKENS } from "./theme.js";

// Guard: every allowlisted theme token MUST be a real `--wt-*` token declared by the design-system
// registry, so the allowlist can never drift onto a phantom (the earlier draft allowlisted four
// non-existent names — theme.ts). NB staleness caveat: a ui-SIDE removal only re-runs this when
// @waitron/layouts is in scope; the unfiltered `main` merge is the backstop (CLAUDE.md §2).
function declaredTokens(): Set<string> {
  const dir = fileURLToPath(new URL("../../ui/src/tokens/", import.meta.url));
  const css = readFileSync(dir + "colors.css", "utf8") + readFileSync(dir + "structure.css", "utf8");
  return new Set([...css.matchAll(/(--wt-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

describe("THEMEABLE_TOKENS registry consistency", () => {
  it("allowlists only real --wt-* tokens from the design-system registry", () => {
    const declared = declaredTokens();
    const phantom = THEMEABLE_TOKENS.filter((t) => !declared.has(t));
    expect(phantom).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect PASS** (the 7 are all real): `pnpm --filter @waitron/layouts test theme-registry`
- [ ] **Step 3: Prove-by-deletion (temporary)** — append a phantom to `THEMEABLE_TOKENS` in `theme.ts`, run, confirm the test FAILS naming it; **remove the phantom**. Also flip the regex once to a wrong pattern to confirm the negative control fails for the reason expected; restore.
- [ ] **Step 4: Replace `theme.ts`'s dated-comment claim** — update the `PROVISIONAL SET` comment to cite this test as the live guard (drop "verified … on 2026-09-02"; the test now proves it every run).
- [ ] **Step 5: Commit** — `git commit -s -m "test(layouts): guard THEMEABLE_TOKENS against the real --wt-* registry (SP-A.2 deferral c)"`

---

## Phase 2 — `@waitron/db` schema, migrations, RLS, exports.

### Task 5: `layout_profiles` table + RLS + exports + inmutabilidad

**Files:**
- Create: `packages/db/src/schema/layout-profiles.ts`
- Modify: `packages/db/src/schema/index.ts` (barrel export) and the src barrel + `packages/db/package.json` `exports` map (add `./store` entry the layouts store will import — enumerated, not wildcard)
- Create (generated): `packages/db/drizzle/0088_*.sql` (modelled) + `packages/db/drizzle/0089_*.sql` (`--custom` RLS)
- Test: `packages/db/src/schema/layout-profiles.rls.test.ts` (real Postgres, modelled on `packages/layouts/src/store.rls.test.ts`)

**Interfaces:**
- Produces: `layoutProfiles` drizzle table with `{ id, tenantId, name, definition (jsonb), createdAt, updatedAt }`, `UNIQUE(tenant_id, name)`, `UNIQUE(tenant_id, id)`. Consumed by the store service (Task 9) and the device FK (Task 8).

- [ ] **Step 1: Write the table** (`layout-profiles.ts`) — mirror `layouts.ts`'s opaque-jsonb rationale (no `.$type<>()`, avoids the `@waitron/layouts`↔`@waitron/db` cycle; the store validates on write):

```ts
import { jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/** A reusable layout PROFILE (design §4, SP-A.2 §16.3). Many per tenant, keyed by name. `definition`
 * is the whole validated ProfileDef as opaque jsonb (validated on write by @waitron/layouts, stored
 * opaque here to avoid the layouts↔db cycle — the till_layouts precedent). FORCE RLS + policy + grants
 * are hand-written in the paired --custom migration; inmutabilidad requires FORCE. */
export const layoutProfiles = pgTable(
  "layout_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    definition: jsonb("definition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    unique("layout_profiles_tenant_id_key").on(t.tenantId, t.id),   // composite-FK target (devices)
    unique("layout_profiles_tenant_name_key").on(t.tenantId, t.name), // names unique per tenant
  ],
).enableRLS();
```

- [ ] **Step 2: Export** from the schema barrel and `@waitron/db` src barrel. Run `pnpm --filter @waitron/db db:generate` → new `0088_*.sql` creating the table (review it). Then `pnpm --filter @waitron/db db:generate:custom` → `0089_*.sql`; hand-write the RLS (copy the `0036_till_layouts_rls.sql` idiom, **grant DELETE too** — profiles are deletable):

```sql
ALTER TABLE "layout_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "layout_profiles_tenant_isolation" ON "layout_profiles"
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "layout_profiles" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "layout_profiles" TO app_user;
```

- [ ] **Step 3: Write the RLS behavioural test** (`layout-profiles.rls.test.ts`, `useRealPostgres` + `asAppUser`, modelled on `store.rls.test.ts`): assert (a) a row inserted under tenant A is invisible under tenant B; (b) `app_user` may INSERT/SELECT/UPDATE/DELETE its own tenant's rows; (c) a cross-tenant `WITH CHECK` write is refused. Prove the isolation by deletion (drop the policy locally → the cross-tenant read leaks → restore).
- [ ] **Step 4: Run** `pnpm --filter @waitron/db test:coverage layout-profiles` **and** `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (must stay green — `layout_profiles` now shows FORCE). Expect PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(db): layout_profiles table + FORCE RLS + app_user grants (SP-A.2)"`

### Task 6: `tenant_themes` table + RLS

**Files:**
- Create: `packages/db/src/schema/tenant-themes.ts`; barrel + exports
- Generated: `0090_*.sql` (modelled) + `0091_*.sql` (`--custom` RLS)
- Test: `packages/db/src/schema/tenant-themes.rls.test.ts`

**Interfaces:**
- Produces: `tenantThemes` = `{ tenantId (pk), theme (jsonb), updatedAt }`. One base theme per tenant; get-with-default returns absent → no override.

- [ ] **Step 1: Write the table** — one row per tenant, `tenant_id` PK (the `till_layouts` shape), opaque jsonb `theme`, FK `restrict`, `.enableRLS()`.
- [ ] **Step 2:** barrel + exports; `db:generate` → 0090; `db:generate:custom` → 0091 RLS (FOR ALL, `tenant_themes_tenant_isolation`, `GRANT SELECT, INSERT, UPDATE` — no DELETE, config replaced in place like `till_layouts`).
- [ ] **Step 3:** RLS behavioural test (isolation + insert/select/update as `app_user`, proven-by-deletion).
- [ ] **Step 4: Run** the db test:coverage + `inmutabilidad`. PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(db): tenant_themes table + FORCE RLS (SP-A.2)"`

### Task 7: `till` device kind + `kindRequiresStation` + CHECK

**Files:**
- Modify: `packages/db/src/schema/devices.ts:24` (add `"till"` to the enum + update the doc)
- Modify: `apps/server/src/device.ts:103-105` (`kindRequiresStation`)
- Generated: `0092_*.sql` (`--custom`: `ALTER TYPE "device_kind" ADD VALUE 'till'` + extend the per-kind station CHECK on both device tables)
- Test: `apps/server/src/device.test.ts` (or the device suite) + a db-level test that a `till` row with a `station_id` is rejected by the CHECK

**Interfaces:**
- Produces: `device_kind` gains `till`; `kindRequiresStation("till") === false`.

- [ ] **Step 1: Failing test** — `expect(kindRequiresStation("till")).toBe(false)` and (real PG) inserting a `devices` row `device_kind='till'` with a non-null `station_id` violates the CHECK.
- [ ] **Step 2: Run — expect FAIL** (`"till"` is not assignable / CHECK absent).
- [ ] **Step 3: Implement** — add `"till"` to the pgEnum array and extend the enum doc (`till` — a first-class till device, binds NO station, rings sales under its node's SIF, §16). `kindRequiresStation` stays `=== "kds_station"` (so `till` and `handheld` both return false — no change needed beyond confirming; add the test). Generate `0092` custom: `ALTER TYPE "device_kind" ADD VALUE IF NOT EXISTS 'till';` then `DROP`/`ADD` the station CHECK on `devices` and `device_pairing_codes` so it reads "`kds_station` ⇒ station NOT NULL, else station NULL" (till + handheld both require NULL). `ALTER TYPE … ADD VALUE` cannot run in the same tx as a use of the new value — keep it its own migration file / statement-breakpoint; verify the migration applies against `postgres:18-alpine`.
- [ ] **Step 4: Run** the device suite + a real-PG migration apply. PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(db): till device kind + station CHECK (SP-A.2)"`

### Task 8: `till_id` / `layout_profile_id` / hardware columns on devices + pairing codes

**Files:**
- Modify: `packages/db/src/schema/devices.ts` (both `devices` and `devicePairingCodes`)
- Generated: `0093_*.sql` (modelled columns) + `0094_*.sql` (`--custom`: the three composite FKs + a nullable-consistency note)
- Test: `packages/db/src/schema/devices.fk.test.ts` (real PG — composite FKs enforce tenant consistency)

**Interfaces:**
- Produces on both tables: `layoutProfileId` (bare uuid, nullable), `tillId` (bare uuid, nullable), `receiptPrinterId` (bare uuid, nullable), `hasCashDrawer` boolean notNull default false, `cardProvider` text notNull default `'none'`, `cardReaderId` text nullable.

- [ ] **Step 1: Failing test** — real-PG: a `devices` row whose `(tenant_id, till_id)` names a `tills` row of a *different* tenant is rejected by the composite FK; likewise `layout_profile_id`.
- [ ] **Step 2: Run — expect FAIL** (columns/FKs absent).
- [ ] **Step 3: Implement** — add the six columns to **both** tables as **bare** uuid/text/boolean (composite FKs hand-written, the `station_id` idiom). Doc each: `till_id` — the `tills` row this sale-capable device rings against (§16.4), NULL for `kds_station`; `layout_profile_id` — assigned profile; hardware trio — static binding (§16.3), credentials stay in the vault. Generate `0093` (columns), then `0094` custom with the three composite FKs, e.g.:

```sql
ALTER TABLE "devices" ADD CONSTRAINT "devices_till_fk"
  FOREIGN KEY ("tenant_id","till_id") REFERENCES "tills"("tenant_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_layout_profile_fk"
  FOREIGN KEY ("tenant_id","layout_profile_id") REFERENCES "layout_profiles"("tenant_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_receipt_printer_fk"
  FOREIGN KEY ("tenant_id","receipt_printer_id") REFERENCES "printers"("tenant_id","id") ON DELETE RESTRICT;
-- (repeat the three for device_pairing_codes)
```

(Confirm `printers` and `tills` each expose a `(tenant_id, id)` unique target; `tills` has `tills` PK `id` + the tenant scope — add a `UNIQUE(tenant_id, id)` on `tills`/`printers` in this migration if absent. MATCH SIMPLE skips the check on any NULL column, so a NULL `till_id`/profile/printer is unconstrained.)

- [ ] **Step 4: Run** the db test:coverage + `inmutabilidad` (devices already had FORCE; unchanged). PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(db): device till_id/profile/hardware columns + composite FKs (SP-A.2)"`

---

## Phase 3 — `@waitron/layouts` store service.

### Task 9: Profile store service (list / get / create / update / delete / get-with-default)

**Files:**
- Create: `packages/layouts/src/profile-store.ts`
- Modify: `packages/layouts/src/index.ts` (barrel)
- Test: `packages/layouts/src/profile-store.rls.test.ts` (real PG + `asAppUser`)

**Interfaces:**
- Consumes: `layoutProfiles` from `@waitron/db`; `Transaction`; `authorizeManager` (`@waitron/identity`); `validateProfile`, `ProfileDef`, `DEFAULT_PROFILES`, `FormFactor`.
- Produces:
  - `listProfiles(tx, tenantId): Promise<{ id: string; name: string; definition: ProfileDef }[]>`
  - `getProfile(tx, tenantId, id): Promise<{ id; name; definition: ProfileDef } | undefined>`
  - `createProfile(tx, { managementSessionId, tenantId, name, definition }): Promise<{ id: string }>`
  - `updateProfile(tx, { managementSessionId, tenantId, id, name, definition }): Promise<void>`
  - `deleteProfile(tx, { managementSessionId, tenantId, id }): Promise<void>`
  - `getProfileForFormFactor(tx, tenantId, formFactor: FormFactor): Promise<ProfileDef>` — get-with-default: first stored profile of that form factor, else `DEFAULT_PROFILES[formFactor]` (the `getLayout` defaults precedent).

- [ ] **Step 1: Failing tests** (real PG, one tenant scoped via `withTenant`/`asAppUser`): create→get round-trips a `validateProfile`d definition; `getProfile` on an unknown id → `undefined`; `getProfileForFormFactor` with no rows → the built-in default; `createProfile` with an **invalid** definition throws `profile.invalid` **before** any INSERT; a write without `till.configure` throws (proven-by-deletion of the `authorizeManager` call); a second tenant cannot see tenant A's rows (RLS).
- [ ] **Step 2: Run — expect FAIL** (`profile-store.ts` absent).
- [ ] **Step 3: Implement** `profile-store.ts` mirroring `store.ts`: every fn takes a caller-scoped `tx`; writes call `authorizeManager(tx, { managementSessionId, permission: "till.configure" })` **first**, then `validateProfile(definition)`, then the drizzle write; reads cast the opaque jsonb back to `ProfileDef` without re-validating (the write validated it — the `getLayout` rationale). `createProfile` inserts `{ tenantId, name, definition }`; `updateProfile` updates by `(tenantId, id)` setting `name`, `definition`, `updatedAt: sql\`now()\``; `deleteProfile` deletes by `(tenantId, id)`. Header doc: same RLS/GUC contract as `store.ts`.
- [ ] **Step 4: Run** `pnpm --filter @waitron/layouts test:coverage`. PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(layouts): profile store service over layout_profiles (SP-A.2)"`

### Task 10: Tenant theme store service

**Files:**
- Create: `packages/layouts/src/theme-store.ts`; barrel
- Test: `packages/layouts/src/theme-store.rls.test.ts`

**Interfaces:**
- Produces:
  - `getTenantTheme(tx, tenantId): Promise<ThemeOverride | undefined>` — get-with-default = `undefined` when no row.
  - `putTenantTheme(tx, { managementSessionId, tenantId, theme }): Promise<void>` — `authorizeManager("till.configure")` then `validateThemeOverride(theme)` then upsert `ON CONFLICT (tenant_id)`.

- [ ] **Step 1: Failing tests** — put→get round-trips a validated theme; get with no row → `undefined`; invalid theme throws `theme.invalid` before INSERT; write without `till.configure` throws (proven-by-deletion); cross-tenant isolation.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** mirroring `putReceipt`'s upsert shape over `tenantThemes`.
- [ ] **Step 4: Run** `pnpm --filter @waitron/layouts test:coverage`. PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(layouts): tenant theme store service (SP-A.2)"`

---

## Phase 4 — server management API.

### Task 11: Management API — profile CRUD + tenant theme

**Files:**
- Modify: `apps/server/src/management-api.ts` (new routes after the layout/receipt block ~807)
- Test: `apps/server/src/management-api.test.ts` (or the profile-management test file)

**Interfaces:**
- Consumes: `listProfiles`/`getProfile`/`createProfile`/`updateProfile`/`deleteProfile`/`getTenantTheme`/`putTenantTheme`.
- Produces routes, all `requireManagementSession` + `withTenant`/`asAppUser`, writes gated `till.configure` (via the store's `authorizeManager`; reads add an explicit `authorizeManager` like `GET /management-api/layout` does):
  - `GET /management-api/profiles` → `{ profiles: [{id,name,definition}] }`
  - `GET /management-api/profiles/:id` → the profile, or 404 (`profile.not_found`? — see step 3)
  - `POST /management-api/profiles` `{ name, definition }` → 201 `{ id }`
  - `PUT /management-api/profiles/:id` `{ name, definition }` → 204
  - `DELETE /management-api/profiles/:id` → 204
  - `GET /management-api/theme` → `{ theme: ThemeOverride | null }`
  - `PUT /management-api/theme` `{ theme }` → 204

- [ ] **Step 1: Failing tests** — round-trip create/list/get/update/delete via the routes; a bad `definition` → `profile.invalid` 4xx (`management.request_invalid` shape for a missing body field, mirroring `PUT /management-api/layout`); an unknown `:id` on GET → 404; a session lacking `till.configure` → 403; the theme routes round-trip and reject an unknown token.
- [ ] **Step 2: Run — expect FAIL** (routes absent).
- [ ] **Step 3: Implement** the routes mirroring the layout/receipt handlers (`management-api.ts:743-807`). For a missing/nonobject body field throw `management.request_invalid { field: "definition" }` (existing code) before calling the store. For GET-by-id 404: reuse an existing not-found shape — **grep first** for a sibling (`series.not_found`/`station.not_found` style); if none fits, add `profile.not_found { }` to `packages/layouts/src/errors.ts` (domain-concept, new leaf under a new code) rather than a server-prefixed one. `requireUuidParam(:id)`.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server test:coverage management-api`. PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): management API for layout profiles + tenant theme (SP-A.2)"`

---

## Phase 5 — enrolment extension.

### Task 12: Pairing code + enrol carry profile / till_id / hardware; device-codes route

**Files:**
- Modify: `apps/server/src/device.ts` (`generatePairingCode` input + INSERT `118-153`; `enrolDevice` `.returning()` + `devices` INSERT `194-244`)
- Modify: `apps/server/src/device-api.ts` (`POST /management-api/device-codes` `250-274` — read/validate the new fields)
- Test: `apps/server/src/device.test.ts` + `device-api.test.ts`

**Interfaces:**
- Consumes: `getProfile` (validate the profile exists for the tenant); `layoutProfiles`/`tills`/`printers` for existence checks.
- Produces: `generatePairingCode` input gains `{ layoutProfileId?, tillId?, receiptPrinterId?, hasCashDrawer?, cardProvider?, cardReaderId? }`; `enrolDevice` returns them and stamps them on the device. **Rule:** a sale-capable kind (`till`, `handheld`) requires a non-null `tillId`; `kds_station` forbids it.

- [ ] **Step 1: Failing tests** — (a) minting a `till`/`handheld` code without a `tillId` throws a new `device.till_required` (grep siblings first — `device.station_required` is the model; add `device.till_required` to `apps/server/src/errors.ts`); (b) minting with a `layoutProfileId` that doesn't exist for the tenant throws `profile.not_found`/`device.pairing_invalid` (choose per grep); (c) a full round-trip: mint a `till` code carrying profile+till+hardware → redeem → the `devices` row has all fields; (d) `kds_station` with a `tillId` is rejected.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — thread the fields through `generatePairingCode`'s `input`, its existence checks (`getProfile` for the profile; a `(tenant, id)` existence select for till/printer — or rely on the composite FK to reject at INSERT and translate 23503), and the `devicePairingCodes` INSERT; add the sale-capable-kind `tillId` gate beside the existing `kindRequiresStation` gate. Extend `enrolDevice`'s `.returning({...})` and the `devices` INSERT to copy them. In `device-api.ts:250` read + `requireBodyUuid`/`requireString`/`requireEnum` the new body fields and pass them on.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server test:coverage device`. PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): enrolment carries profile, till_id + hardware (SP-A.2)"`

### Task 13: Surface profile + hardware on `/api/device/me` and `/api/till`

**Files:**
- Modify: `apps/server/src/device-session.ts` (`DeviceBinding` `66-70` + `tryReadDevice` select `115-127` gain `tillId`, `layoutProfileId`, hardware)
- Modify: `apps/server/src/device-api.ts` (`GET /api/device/me` `187-192` echoes them)
- Modify: `apps/server/src/till-api.ts` (`GET /api/till` `642-681` surfaces the device's assigned profile when a device cookie is present — additive, non-breaking; the counter still renders from `layout`/`receipt` until SP-B)
- Test: `device-session.test.ts`, `device-api.test.ts`, `till-api.test.ts`

**Interfaces:**
- Produces: `DeviceBinding` gains `tillId: string | null`, `layoutProfileId: string | null`, and the hardware fields; `/api/device/me` returns them; `/api/till` returns `profile?: ProfileDef` (resolved via `getProfile`) alongside the existing fields.

- [ ] **Step 1: Failing tests** — `tryReadDevice`/`requireDevice` return the new fields; `/api/device/me` includes `tillId`/`layoutProfileId`/hardware; `/api/till` for a request carrying a till-device cookie includes the resolved `profile`; for no cookie, `profile` is absent and the response is otherwise unchanged.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — extend the `DeviceBinding` interface and the `tryReadDevice` select/return; echo in `/api/device/me`; in `/api/till`, after resolving the device (reuse `tryReadDevice`), `getProfile(tx, tenantId, device.layoutProfileId)` when set and add `profile` to the JSON. Keep `layout`/`receipt` exactly as-is.
- [ ] **Step 4: Run** the three suites' `test:coverage`. PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): surface assigned profile + hardware on device boot reads (SP-A.2)"`

---

## Phase 6 — server-side capability enforcement.

### Task 14: `assertDeviceCapability` — enforce the profile capability flags

**Files:**
- Modify: `apps/server/src/device-session.ts` (new `assertDeviceCapability`)
- Modify: `apps/server/src/till-api.ts` (pay `765` → `integrated-card-payment`; drawer `1192` → `open-cash-drawer`) and `apps/server/src/device-api.ts` (KDS advance `217-247` → `act-as-kds`)
- Test: `device-session.test.ts`, `till-api.test.ts`, `device-api.test.ts`

**Interfaces:**
- Consumes: the device's `layoutProfileId` → `getProfile` → `definition.capabilities`.
- Produces: `assertDeviceCapability(deps, c, capability: CapabilityFlag, action: string): Promise<void>` — resolves the device + its profile; throws `device.forbidden_action { action }` if the profile lacks `capability`. **A request with no device cookie passes** (an env-configured/legacy caller), matching `assertNotHandheld`'s absent-cookie behaviour.

- [ ] **Step 1: Failing tests** — a device whose profile **lacks** `integrated-card-payment` is refused at `/api/pay` with `device.forbidden_action { action: "pay" }`; one whose profile **has** it passes the guard; the built-in **handheld default profile** lacks `integrated-card-payment` and `open-cash-drawer` (so a handheld is still blocked from pay + drawer — behaviour preserved), and its default **has no** `act-as-kds`; a kds default profile **has** `act-as-kds`. Prove-by-deletion: remove the `assertDeviceCapability` line → the "lacks it is refused" test fails.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — write `assertDeviceCapability` (reads via `tryReadDevice` + `getProfile`; absent device ⇒ return). Replace `assertNotHandheld(deps, c, "pay")` at `till-api.ts:765` with `assertDeviceCapability(deps, c, "integrated-card-payment", "pay")`, and the drawer one at `1192` with `open-cash-drawer`. Add `assertDeviceCapability(deps, c, "act-as-kds", "advance")` to the KDS advance route. **Leave `assertNotHandheld` at `place`/`reprint`/`collect`/`cancel`** (`912`/`1136`/`1253`/`1279`) unchanged — no capability flag models "counter operations"; inventing one is out of scope (§16.6 residue, documented in a code comment citing this task). Confirm the built-in `DEFAULT_PROFILES` (from SP-A.1) carry the right capability sets — if the handheld/kds defaults don't yet declare capabilities, set them here (till+kds get their flags; handheld gets none of pay/drawer).
- [ ] **Step 4: Run** the three suites' `test:coverage`, and re-run the existing handheld-firewall tests to confirm no regression. PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): enforce profile capability flags (generalises assertNotHandheld) (SP-A.2)"`

---

## Phase 7 — fiscal `till_id` cutover + the H2 receipt. (Owner sign-off gate.)

### Task 15: Resolve sale-time `till_id` from the authenticated device

**Files:**
- Modify: `apps/server/src/device-session.ts` (new `requireSaleTillId`)
- Modify: `apps/server/src/till-api.ts` (`/api/sales` `720-745`, `/api/pay`, the collect route) — resolve the till_id and pass a per-request `saleCfg`
- Modify: `apps/server/src/till-sale.ts` (`recordTillSale`/`payWorkingOrder`/`collectOrder` accept the caller's `cfg`, which already flows in — the change is at the call site that builds `cfg`), `apps/server/src/working-order.ts` (the `recordSale` call sites at `708`/`3095` read `cfg.tillId` — unchanged once `cfg` is per-request)
- Test: `apps/server/src/till-sale.test.ts` / a new `sale-till-source.test.ts` (real PG end-to-end)

**Interfaces:**
- Produces: `requireSaleTillId(deps, c): Promise<TillId>` — reads the authenticated device; returns `device.tillId` branded; throws `device.unauthorized` if no device cookie, `device.till_required` if the device carries no `till_id`. The sale handlers build `const saleCfg: TillConfig = { ...deps.cfg, tillId: await requireSaleTillId(deps, c) };` and pass `saleCfg` where they pass `deps.cfg` today.

- [ ] **Step 1: Failing tests** (real PG) — a sale filed by an enrolled device writes `sales.till_id` = the **device's** assigned `till_id`, NOT `WAITRON_TILL_TILL_ID`; a request with no device cookie is refused `device.unauthorized` (setup precondition, §16.5 — not a per-sale block); a device with a NULL `till_id` (e.g. a kds_station, which can't sell) is refused `device.till_required`. Assert the value is the device's till by enrolling two till-devices on two different `tills` rows and checking each sale lands its own.
- [ ] **Step 2: Run — expect FAIL** (`till_id` still comes from `cfg`/env).
- [ ] **Step 3: Implement** — add `requireSaleTillId`. In each sale-recording handler (`/api/sales`, `/api/pay`'s `payWorkingOrderIntegrated`, the ticket collect route) resolve it and build `saleCfg`, passing it in place of `deps.cfg` to `recordTillSale`/`payWorkingOrder…`/`collectOrder`. Do **not** touch `cfg.nodeId`/`cfg.seriesId` (the SIF/series stay from env). Leave `cfg.tillId` (env) in place for the non-sale paths (corrections, receipt-print, incidents) — documented boundary (§16.4). Confirm `till-config.ts` still loads `WAITRON_TILL_TILL_ID` (setup/adopt seeding) — it is not removed.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server test:coverage` (the sale suites). PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): sale-time till_id from the authenticated device, not env (SP-A.2 cutover)"`

### Task 16: The H2 receipt — fiscal untouched (container + unit) + owner sign-off

**Files:**
- Create/Modify: `packages/verifactu/src/huella.test.ts` (or the existing huella suite) — the `till_id`-inert proof
- Create: `apps/server/src/sale-till-source.receipt.test.ts` (real PG) — resolution + nodeId
- Modify: this plan / a handoff line recording the receipt output for the PR body

**Interfaces:** none new — this task proves invariants.

- [ ] **Step 1 — (b) huella is inert to `till_id`** (mirrors the existing `entorno` identity test, CLAUDE.md §5): a unit test computing the alta huella for two `RegistroAlta` inputs identical **except** `till_id` (if `till_id` is not even a field of the huella-input tuple, assert that directly against `types.ts:197/209` — the tuple has 8 fields and none is `till_id`) → the canonical string + huella are identical. Prove-by-mutation: temporarily add `till_id` to the canonical-string builder → the test fails → revert.
- [ ] **Step 2 — (a) resolution correctness / same-till identity** (real PG): file a sale for `tills` row X (i) with `deps.cfg.tillId = X` directly and (ii) via a till-device whose `till_id = X`; assert the two `registros_facturacion` rows are byte-identical in `huella`, `huella_anterior`, `secuencia`, and the canonical string (both filed as the first record of a fresh chain for X). State the failing case: a device resolving `till_id = Y ≠ X` produces a different `sales.till_id` (Step 3 covers it).
- [ ] **Step 3 — (b) mutation control + (c) nodeId untouched** (real PG): (b) change the device's `till_id` to Y and re-file an otherwise-identical first-of-chain sale → **only** `sales.till_id` / the record `till_id` differ; `huella`/`secuencia`/`entorno`/`node_id` are identical. (c) Assert the sale path passes `cfg.nodeId` (env) to `recordSale` regardless of the device — a test that fails if the device is wired to influence `nodeId` (e.g. spy/param assertion on the `recordSale` input's `nodeId`).
- [ ] **Step 4: Run the full receipt** — `pnpm --filter @waitron/verifactu test:coverage` + `pnpm --filter @waitron/server test:coverage sale-till-source` + `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`, in a container (`TESTCONTAINERS_RYUK_DISABLED=true`). Capture the output verbatim for the PR body.
- [ ] **Step 5: Commit** — `git commit -s -m "test(fiscal): H2 receipt — till_id cutover leaves the chain untouched (SP-A.2)"`
- [ ] **Step 6 — OWNER SIGN-OFF GATE.** Present the receipt output to the owner. **Do not open/merge the PR until the owner signs off** on the fiscal change (Global Constraints, spec §7/§16.4).

---

## Self-Review

**1. Spec coverage (§16):**
- §16.1 one-slice — the whole plan. ✓
- §16.2 `till_layouts` stays — Global Constraints + Task 13 keeps `layout`/`receipt` on `/api/till`. ✓
- §16.3 schema — Tasks 5–8. ✓
- §16.4 fiscal cutover + receipt — Tasks 15, 16. ✓
- §16.5 sale-block risk — Task 15 Step 1 (no-cookie ⇒ `device.unauthorized`, a setup precondition). ✓
- §16.6 capability enforcement — Task 14 (+ documented `assertNotHandheld` residue). ✓
- §16.7 deferrals (a)(b)(c)(d) — Tasks 3,1,4,2. ✓
- §16.8 static-only hardware — Tasks 8, 12 (no reader-device/transient tables). ✓
- Backlog extras: theme storage — Tasks 6, 10; enrolment extension — Task 12; db exports — Task 5. ✓

**2. Placeholder scan:** every code step carries real snippets or a precise diff instruction with the target `file:line`; not-found/error codes say "grep siblings, add a leaf if none fits" with the concrete sibling named. No "TBD"/"add validation". ✓

**3. Type consistency:** `ProfileDef`/`ThemeOverride`/`CapabilityFlag`/`FormFactor` used as defined in SP-A.1 (`profile.ts`); store fns' names are reused verbatim in Tasks 9→11→13; `assertDeviceCapability`/`requireSaleTillId` signatures defined once and consumed as written; `DeviceBinding` gains `tillId`/`layoutProfileId` in Task 13 and is read by Tasks 14/15. ✓

**Open items the executor must resolve by grep (named, not vague):** the GET-by-id 404 code (Task 11) and the `device.till_required` mint gate (Task 12) — grep the sibling families first, add a domain-concept leaf only if none fits, per Global Constraints.
