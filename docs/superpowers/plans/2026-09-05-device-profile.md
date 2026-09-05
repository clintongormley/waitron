# Device Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a first-class, tenant-wide **device profile** between a device and its canvas — a device carries `device_profile_id`, the profile carries a `canvas_id` reference plus the **capabilities** set relocated off the canvas record — so the chain is device → device profile → canvas.

**Architecture:** Additive-first, then cut over. Tasks 1–7 add the new entity, store, CRUD routes, the device link, enrolment/reassign, and the dashboard editor **without removing anything**, so each leaves its own packages green. Tasks 8–10 flip the consumers (dashboard devices screen, the capability firewall + `/api/till` resolution, then drop `canvas_id` from devices and `capabilities` from the canvas). Task 11 is the whole-workspace gate + backlog.

**Tech Stack:** TypeScript, pnpm workspace, Drizzle ORM + drizzle-kit, PostgreSQL 18 (RLS), Vitest (+ Testcontainers real-PG, PGlite hermetic), Lit (browser-mode Vitest for `apps/dashboard`/`apps/till`).

**Spec:** `docs/superpowers/specs/2026-09-05-device-profile-design.md` (read it first — this plan argues from it).

## Global Constraints

- **Pre-production: no backwards-compat, no backfill** (CLAUDE.md §5). Schema changes drop/recreate; the `canvas_id` → `device_profile_id` move discards nothing real.
- **Error codes name the domain concept, never the package; never renamed once shipped** (CLAUDE.md §3). New family `device_profile.*` in `packages/layouts/src/errors.ts`; every throwing file does `import "./errors.js"`.
- **Every new `tenant_id`-bearing table needs FORCE RLS + a tenant-isolation policy + grants in a hand-written `--custom` migration** (CLAUDE.md §3). `.enableRLS()` alone is a bug. Verify with `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.
- **Composite bare-column FKs are hand-written `--custom`**, `ON DELETE RESTRICT`, `MATCH SIMPLE`, targeting an existing `(tenant_id, id)` UNIQUE (the `devices.station_id` idiom, migration 0095).
- **Never build SQL by string concatenation**; Drizzle parameterises. Utility statements (`GRANT`/`CREATE POLICY`) live only in migration `.sql` files, never composed in code.
- **`withTenant + asAppUser` wraps every RLS-scoped read/write.** RLS is proven against **real Postgres** (`*.rls.test.ts`); PGlite is a false pass for RLS-as-`app_user` (CLAUDE.md §4). Set `TESTCONTAINERS_RYUK_DISABLED=true` locally.
- **`test:coverage`, not `test`** (CLAUDE.md §2). Thresholds 98/98/98/95 everywhere except the browser packages (`apps/dashboard`, `apps/till`, `packages/ui`, `apps/setup`) at 95/95/90/88.
- **Spanish domain vocabulary guard** (`english-only`) scopes `packages/`, not `apps/`. No new Spanish schema tokens here; identifiers stay English.
- **The dashboard never runtime-imports `@waitron/layouts`** (the #70 bundle rule): it deep-imports the pure modules and keeps drift-guarded mirrors. `apps/layouts` types cross the client boundary as `unknown`, defensively parsed.
- **`git commit -s`** on every commit (DCO). Branch: `feat/device-profile` (worktree already created).
- **Migration-number rebase collision** (memory): if `main` moves under you, `git checkout main -- packages/db/drizzle` , keep the schema TS, re-run `pnpm --filter @waitron/db db:generate` + `db:generate:custom`, re-verify RLS + inmutabilidad. Do **not** hand-renumber.

---

## File map

**Create:**
- `packages/layouts/src/device-profile.ts` — pure: `validateCapabilities`, `DEFAULT_PROFILE_CAPABILITIES`.
- `packages/layouts/src/device-profile.test.ts`
- `packages/layouts/src/device-profile-store.ts` — CRUD store (imports `@waitron/db`), beside `canvas-store.ts`.
- `packages/layouts/src/device-profile-store.rls.test.ts`
- `packages/db/src/schema/device-profiles.ts` — the table.
- `packages/db/src/schema/device-profiles.rls.test.ts`, `device-profiles.fk.test.ts`
- `packages/db/drizzle/0106_*.sql` (table) + `0107_*.sql` (`--custom` RLS/policy/grant/FK) — numbers per `db:generate` output; adjust if `main` moved.
- `packages/db/drizzle/0108_*.sql` (devices/pairing `device_profile_id` col) + `0109_*.sql` (`--custom` FK).
- `packages/db/drizzle/0110_*.sql` (`--custom` drop `canvas_id` col + FK, Task 10).
- `apps/dashboard/src/screens/device-profiles-screen.ts` + its `*.test.ts`.
- `apps/server/src/management-api.device-profiles.rls.test.ts`

**Modify:**
- `packages/layouts/src/{errors.ts,index.ts,canvas.ts,validate-canvas.ts,default-canvases.ts,canvas-store.ts}`
- `packages/db/src/schema/{devices.ts,index.ts}` (barrel export the new table) + `devices.fk.test.ts`
- `apps/server/src/{management-api.ts,device.ts,device-api.ts,device-session.ts,till-api.ts}` + their tests
- `apps/server/scripts/dev-setup.ts` + `dev-setup.test.ts`
- `apps/till/src/{layout.ts,till-app.ts}` + `apps/till/src/dev/*` (SP-C dev-switcher canvas mirror) + tests
- `apps/dashboard/src/{dashboard-app.ts,api/client.ts,screens/canvas-editor-screen.ts,screens/devices-screen.ts,screens/canvas-editor/validate-canvas.ts,i18n/{strings.ts,codes.ts}}` + tests
- `docs/backlog.md` (Task 11)

---

## Task 1: `@waitron/layouts` — pure `device-profile.ts` module + error family

**Files:**
- Create: `packages/layouts/src/device-profile.ts`, `packages/layouts/src/device-profile.test.ts`
- Modify: `packages/layouts/src/errors.ts` (add 3 codes), `packages/layouts/src/index.ts` (re-export)

**Interfaces:**
- Produces: `validateCapabilities(input: unknown): CapabilityFlag[]` (fail-closed, throws `device_profile.invalid` on any non-flag); `DEFAULT_PROFILE_CAPABILITIES: Record<FormFactor, CapabilityFlag[]>`; error codes `device_profile.not_found`, `device_profile.name_taken`, `device_profile.invalid`.
- Consumes: `CAPABILITY_FLAGS`, `CapabilityFlag`, `FormFactor` from `./canvas.js`.

**Context:** `validateCapabilities` currently lives inside `validate-canvas.ts` (`packages/layouts/src/validate-canvas.ts:45` calls it). In this task we **add a standalone copy** in the new module (canvas keeps its own until Task 9). `DEFAULT_PROFILE_CAPABILITIES` carries the values today baked into `DEFAULT_CANVASES` (`default-canvases.ts`): `till: ["integrated-card-payment","open-cash-drawer"]`, `kds: ["act-as-kds"]`, `"phone-portrait": []`, `"tablet-landscape": []`.

- [ ] **Step 1: Write the failing test** — `device-profile.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { validateCapabilities, DEFAULT_PROFILE_CAPABILITIES } from "./device-profile.js";
import { FORM_FACTORS, CAPABILITY_FLAGS } from "./canvas.js";

describe("validateCapabilities", () => {
  it("accepts a valid flag array and dedupes order-independently", () => {
    expect(validateCapabilities(["open-cash-drawer", "integrated-card-payment"])).toEqual(
      expect.arrayContaining(["open-cash-drawer", "integrated-card-payment"]),
    );
  });
  it("accepts an empty array", () => {
    expect(validateCapabilities([])).toEqual([]);
  });
  it("rejects a non-array", () => {
    expect(() => validateCapabilities("integrated-card-payment")).toThrow(AppError);
  });
  it("rejects an unknown flag (fail-closed) with device_profile.invalid", () => {
    try {
      validateCapabilities(["not-a-flag"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("device_profile.invalid");
    }
  });
});

describe("DEFAULT_PROFILE_CAPABILITIES", () => {
  it("covers every form factor with only known flags", () => {
    for (const ff of FORM_FACTORS) {
      const caps = DEFAULT_PROFILE_CAPABILITIES[ff];
      expect(Array.isArray(caps)).toBe(true);
      for (const c of caps) expect(CAPABILITY_FLAGS).toContain(c);
    }
  });
  it("gives the till the reader + drawer defaults and the kds act-as-kds", () => {
    expect(DEFAULT_PROFILE_CAPABILITIES.till).toEqual([
      "integrated-card-payment",
      "open-cash-drawer",
    ]);
    expect(DEFAULT_PROFILE_CAPABILITIES.kds).toEqual(["act-as-kds"]);
    expect(DEFAULT_PROFILE_CAPABILITIES["phone-portrait"]).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails** — `pnpm --filter @waitron/layouts test device-profile` → FAIL (module missing).

- [ ] **Step 3: Add the error codes** in `packages/layouts/src/errors.ts`, mirroring the `canvas.*` entries' param shapes (grep `canvas.invalid`/`canvas.name_taken`/`canvas.not_found` first — keep them parallel). `device_profile.invalid` carries the same "what was invalid" param shape as `canvas.invalid`; `device_profile.name_taken` mirrors `canvas.name_taken`; `device_profile.not_found` mirrors `canvas.not_found`.

- [ ] **Step 4: Write `device-profile.ts`**

```ts
import "./errors.js";
import { AppError } from "@waitron/shared";
import { CAPABILITY_FLAGS, type CapabilityFlag, FORM_FACTORS, type FormFactor } from "./canvas.js";

/**
 * Fail-closed validation of a device profile's capability set (design §7). Rejects a non-array or any
 * element not in CAPABILITY_FLAGS with `device_profile.invalid` — the server-authoritative gate, since
 * capabilities drive the /api/pay + /api/drawer firewall. Deduplicates; preserves first-seen order.
 */
export function validateCapabilities(input: unknown): CapabilityFlag[] {
  if (!Array.isArray(input)) {
    throw new AppError("device_profile.invalid", { field: "capabilities" });
  }
  const out: CapabilityFlag[] = [];
  for (const raw of input) {
    if (typeof raw !== "string" || !(CAPABILITY_FLAGS as readonly string[]).includes(raw)) {
      throw new AppError("device_profile.invalid", { field: "capabilities" });
    }
    const flag = raw as CapabilityFlag;
    if (!out.includes(flag)) out.push(flag);
  }
  return out;
}

/**
 * The default capabilities a device of each form factor should get when a profile is seeded from the
 * built-in defaults (design §5.3/§10). These are the values that used to live on DEFAULT_CANVASES,
 * relocated here as capabilities leave the canvas record (Task 9).
 */
export const DEFAULT_PROFILE_CAPABILITIES: Record<FormFactor, CapabilityFlag[]> = {
  till: ["integrated-card-payment", "open-cash-drawer"],
  "phone-portrait": [],
  "tablet-landscape": [],
  kds: ["act-as-kds"],
};

// Referenced so a future FORM_FACTORS change forces this map to be revisited (exhaustive keys above).
void FORM_FACTORS;
```

- [ ] **Step 5: Re-export** from `packages/layouts/src/index.ts` (`export * from "./device-profile.js";`), keeping the barrel's ordering convention.

- [ ] **Step 6: Run tests + the root error-reachability guard** — `pnpm --filter @waitron/layouts test:coverage` → PASS; the root guard `pnpm vitest run scripts/errors-reachable.test.ts` still green.

- [ ] **Step 7: Commit** — `git commit -s -m "feat(layouts): device-profile capability validation + defaults + error family"`

---

## Task 2: `device_profiles` table + migrations + RLS/FK tests

**Files:**
- Create: `packages/db/src/schema/device-profiles.ts`, `.../device-profiles.rls.test.ts`, `.../device-profiles.fk.test.ts`
- Modify: `packages/db/src/schema/index.ts` (or the barrel that re-exports schema — grep how `canvases` is exported and mirror)
- Create: `packages/db/drizzle/0106_*.sql` (generated), `0107_*.sql` (`--custom`)

**Interfaces:**
- Produces: `deviceProfiles` Drizzle table with columns `id`, `tenantId`, `name`, `canvasId` (nullable), `capabilities` (jsonb), `createdAt`, `updatedAt`; UNIQUE `device_profiles_tenant_id_key` on `(tenant_id, id)` and `device_profiles_tenant_name_key` on `(tenant_id, name)`. Composite FK `device_profiles_canvas_fk` `(tenant_id, canvas_id) → canvases(tenant_id, id)`.

- [ ] **Step 1: Write the schema** `packages/db/src/schema/device-profiles.ts` — mirror `canvases.ts` verbatim (same jsonb/v8-ignore/`.enableRLS()` idiom), adding the two device-profile columns:

```ts
import { jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * A reusable DEVICE PROFILE (design 2026-09-05 §5.1): the binding bundle a device uses — a name, a
 * reference to a reusable canvas, and the capabilities set (relocated off the canvas record). MANY per
 * tenant, keyed by name; a device (Task 5) points at one via a composite (tenant_id, id) FK, so two
 * UNIQUEs back that. Tenant-wide, NOT location-scoped (like canvases).
 *
 * `canvas_id` is a BARE uuid (nullable): the tenant-consistent (tenant_id, canvas_id) → canvases FK is
 * hand-written --custom (0107), the devices.station_id idiom. NULL ⇒ the resolver falls back to the
 * form-factor default canvas (design §5.3). MATCH SIMPLE skips the FK check on NULL.
 *
 * `capabilities` is PLAIN jsonb (a CapabilityFlag[]), NOT `.$type<>()`-annotated — @waitron/layouts
 * depends on @waitron/db, so importing its type here is circular; the store validates on write. Same
 * rationale as canvases.definition. DEFAULT '[]' so a profile carries no capability until configured.
 *
 * `.enableRLS()` emits only ENABLE. FORCE + the tenant-isolation policy + the app_user grant
 * (SELECT/INSERT/UPDATE/DELETE — profiles are deletable config) are hand-written --custom (0107).
 * inmutabilidad requires FORCE on every tenant_id-bearing table.
 */
export const deviceProfiles = pgTable(
  "device_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    canvasId: uuid("canvas_id"),
    capabilities: jsonb("capabilities").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    unique("device_profiles_tenant_id_key").on(t.tenantId, t.id),
    unique("device_profiles_tenant_name_key").on(t.tenantId, t.name),
  ],
).enableRLS();
```

- [ ] **Step 2: Barrel export** — add `device_profiles` to the schema barrel exactly where/how `canvases` is exported (grep `canvases` in `packages/db/src/*.ts` and mirror; the `@waitron/db` `exports` map is enumerated — no wildcard change needed, this rides the existing `.` entry).

- [ ] **Step 3: Generate migrations** — `pnpm --filter @waitron/db db:generate` (emits the `CREATE TABLE` + `ENABLE ROW LEVEL SECURITY`, ~`0106`), then hand-write the paired `--custom` (`0107`) — mirror `0089_normal_ted_forrester.sql` for the RLS half and `0095_parched_meteorite.sql` for the FK half:

```sql
-- FORCE ROW LEVEL SECURITY + tenant-isolation policy + app_user grant for device_profiles (design
-- 2026-09-05 §5.1), plus the composite canvas FK. 0106 emitted only ENABLE. Mirrors 0089 (RLS) + 0095
-- (composite bare-column FK). current_tenant_id() + app_user exist from 0001. FORCE isolates the owner
-- (inmutabilidad asserts relforcerowsecurity). REVOKE ALL first so a provisioning GRANT ALL cannot
-- survive. Profiles are mutable + deletable config ⇒ SELECT/INSERT/UPDATE/DELETE.
ALTER TABLE "device_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "device_profiles_tenant_isolation" ON "device_profiles"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "device_profiles" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "device_profiles" TO app_user;--> statement-breakpoint
ALTER TABLE "device_profiles"
  ADD CONSTRAINT "device_profiles_canvas_fk"
  FOREIGN KEY ("tenant_id", "canvas_id") REFERENCES "canvases" ("tenant_id", "id") ON DELETE RESTRICT;
```

Register the custom migration the way the repo does (grep how `0089`/`0102` are tracked in `packages/db`'s drizzle journal / `db:generate:custom` flow — follow the existing mechanism, do not hand-edit the journal blindly; memory [drizzle-migration-rebase-collision]).

- [ ] **Step 4: Write `device-profiles.rls.test.ts`** — mirror `canvases.rls.test.ts` (real Postgres via the shared container): as `app_user` with tenant A's GUC set, a SELECT/INSERT sees only tenant A's rows; a cross-tenant read returns nothing; a WITH CHECK violation (insert row for tenant B) is refused. Prove the policy by the same shape the canvas suite uses.

- [ ] **Step 5: Write `device-profiles.fk.test.ts`** — mirror `devices.fk.test.ts`: a `canvas_id` naming another tenant's canvas is refused (composite FK); a NULL `canvas_id` inserts fine (MATCH SIMPLE); deleting a canvas a profile references is refused (RESTRICT).

- [ ] **Step 6: Run** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage` → PASS; **and** `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` → PASS (FORCE present). If inmutabilidad is red: the `--custom` FORCE didn't apply.

- [ ] **Step 7: Commit** — `git commit -s -m "feat(db): device_profiles table + RLS + composite canvas FK"`

---

## Task 3: `device-profile-store.ts` CRUD + RLS test

**Files:**
- Create: `packages/layouts/src/device-profile-store.ts`, `.../device-profile-store.rls.test.ts`
- Modify: `packages/layouts/src/index.ts` (re-export)

**Interfaces:**
- Produces (mirror `canvas-store.ts` signatures exactly, swapping the row type):
  - `listDeviceProfiles(tx, tenantId): Promise<DeviceProfileRow[]>`
  - `getDeviceProfile(tx, tenantId, id): Promise<DeviceProfileRow | undefined>`
  - `createDeviceProfile(tx, { managementSessionId, tenantId, name, canvasId, capabilities }): Promise<DeviceProfileRow>`
  - `updateDeviceProfile(tx, { managementSessionId, tenantId, id, name, canvasId, capabilities }): Promise<DeviceProfileRow>`
  - `deleteDeviceProfile(tx, { managementSessionId, tenantId, id }): Promise<void>`
  - `DeviceProfileRow = { id; name; canvasId: string | null; capabilities: CapabilityFlag[] }`
- Consumes: `deviceProfiles`, `isUniqueViolation`, `uniqueViolationConstraint`, `Transaction` from `@waitron/db`; `authorizeManager` from `@waitron/identity`; `validateCapabilities` from `./device-profile.js`.

**Context:** `canvas-store.ts` (`packages/layouts/src/canvas-store.ts`) is the exact template: writers `await authorizeManager(tx, { managementSessionId, permission: "till.configure" })` then validate, then insert/update; `asNameTaken` (`:51`) maps `23505` on `canvases_tenant_name_key` → `canvas.name_taken`. Mirror all of it.

- [ ] **Step 1: Write the failing RLS test** `device-profile-store.rls.test.ts` — mirror `canvas-store.rls.test.ts`. Assert, against real PG as `app_user`: create returns a row with validated capabilities; a duplicate name throws `device_profile.name_taken`; an unknown capability throws `device_profile.invalid`; a `canvasId` referencing another tenant's canvas throws `device_profile.invalid` (FK `23503` mapped); list is tenant-scoped; delete removes it; delete of a profile referenced by a device is refused (add once Task 5 exists — for now test delete of an unreferenced profile). Include a `finally` cleanup (order-independent, CLAUDE.md §4).

- [ ] **Step 2: Run → FAIL** (`pnpm --filter @waitron/layouts test device-profile-store` — module missing).

- [ ] **Step 3: Write `device-profile-store.ts`** by adapting `canvas-store.ts`:
  - Reads (`list`/`get`): `select({ id, name, canvasId, capabilities })` from `deviceProfiles`, `where eq(tenantId, current)` (RLS also scopes); order by `name asc` like `listCanvases`.
  - `create`/`update`: `authorizeManager(tx, { managementSessionId, permission: "till.configure" })`; `const caps = validateCapabilities(capabilities)`; insert/update `{ name, canvasId: canvasId ?? null, capabilities: caps }`; catch a unique violation on `device_profiles_tenant_name_key` → `device_profile.name_taken` (an `asNameTaken` twin), and a FK violation on `device_profiles_canvas_fk` (`23503`) → `device_profile.invalid`. `update` throws `device_profile.not_found` when zero rows updated (mirror `updateCanvas`). Read the emitted casts: `capabilities` comes back as parsed jsonb (an array) — no `::text[]` cast needed (jsonb, not PG `name[]`; cf. CLAUDE.md §4 `toMatchObject` note is about `name[]`, not jsonb).
  - `delete`: `authorizeManager`; `delete where id` ; a FK RESTRICT violation (a device still references it) surfaces as the DB error — map it to a clear code or let it propagate as the generic DB error the canvas delete uses (mirror `deleteCanvas` exactly).

- [ ] **Step 4: Re-export** from `index.ts`.

- [ ] **Step 5: Run → PASS** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/layouts test:coverage`.

- [ ] **Step 6: Commit** — `git commit -s -m "feat(layouts): device-profile store (CRUD, RLS, name+canvas validation)"`

---

## Task 4: `/management-api/device-profiles` CRUD routes + error→HTTP map

**Files:**
- Modify: `apps/server/src/management-api.ts` (5 routes + a `requireDeviceProfileId` uuid screen + the error→HTTP map)
- Create: `apps/server/src/management-api.device-profiles.rls.test.ts`

**Interfaces:**
- Produces routes: `GET /management-api/device-profiles`, `GET /management-api/device-profiles/:id`, `POST /management-api/device-profiles`, `PUT /management-api/device-profiles/:id`, `DELETE /management-api/device-profiles/:id`. Response shapes mirror the canvas routes: list → `{ deviceProfiles: [{ id, name, canvasId, capabilities }] }`; get → the single row; create/update → the row; delete → 204.

**Context:** the canvas routes at `management-api.ts:859-987` are the template (each wraps `withTenant + asAppUser`, gates via the store's `authorizeManager` for writes and an explicit `authorizeManager(..., "till.configure")` on reads — `:866`). `requireCanvasId` (`:356`) is the uuid-screen template. The error→HTTP map is at `:218-220`.

- [ ] **Step 1: Write the failing route test** `management-api.device-profiles.rls.test.ts` — mirror `management-api.profiles.rls.test.ts`/the canvas route test: an authenticated manager creates/lists/gets/updates/deletes; a bad uuid → 400; a missing id → 404 (`device_profile.not_found`); a duplicate name → 409 (`device_profile.name_taken`); an unknown capability → 400 (`device_profile.invalid`); a session without `till.configure` → 403.

- [ ] **Step 2: Run → FAIL** (routes missing).

- [ ] **Step 3: Add the routes** by mirroring the canvas block; add `requireDeviceProfileId` next to `requireCanvasId`; extend the error→HTTP map with `device_profile.not_found`→404, `device_profile.name_taken`→409, `device_profile.invalid`→400. Import the store fns. Every throwing file imports its registry (the store already does `import "./errors.js"`; the route module imports the store).

- [ ] **Step 4: Run → PASS** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage management-api.device-profiles` then the file’s suite green.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): /management-api/device-profiles CRUD routes"`

---

## Task 5: devices + pairing-codes carry `device_profile_id` (additive)

**Files:**
- Modify: `packages/db/src/schema/devices.ts` (add `deviceProfileId` to both tables), `devices.fk.test.ts`
- Create: `packages/db/drizzle/0108_*.sql` (columns) + `0109_*.sql` (`--custom` composite FKs)

**Interfaces:**
- Produces: `devices.deviceProfileId` and `devicePairingCodes.deviceProfileId` (`uuid`, nullable, bare) with composite FKs `devices_device_profile_fk` / `device_pairing_codes_device_profile_fk` `(tenant_id, device_profile_id) → device_profiles(tenant_id, id)`. **`canvas_id` stays** on both tables (removed in Task 10).

- [ ] **Step 1:** Add `deviceProfileId: uuid("device_profile_id")` (bare, nullable) to both `devices` and `devicePairingCodes` in `devices.ts`, with a comment mirroring the `canvas_id` comment (the `station_id` idiom; composite FK hand-written; MATCH SIMPLE skips NULL).

- [ ] **Step 2:** `pnpm --filter @waitron/db db:generate` (columns, `0108`); hand-write the `--custom` FK pair (`0109`) mirroring 0095 / the 0107 FK:

```sql
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_device_profile_fk"
  FOREIGN KEY ("tenant_id", "device_profile_id") REFERENCES "device_profiles" ("tenant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_device_profile_fk"
  FOREIGN KEY ("tenant_id", "device_profile_id") REFERENCES "device_profiles" ("tenant_id", "id") ON DELETE RESTRICT;
```

- [ ] **Step 3:** Extend `devices.fk.test.ts` (write the assertion first, watch it fail): a device/pairing-code `device_profile_id` naming another tenant's profile is refused; a NULL inserts fine; deleting a referenced profile is refused (this also satisfies the deferred Task-3 delete-referenced case — add that assertion back to `device-profile-store.rls.test.ts` now).

- [ ] **Step 4: Run** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage` + `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` → PASS.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(db): devices + pairing codes carry device_profile_id (composite FK)"`

---

## Task 6: enrolment + reassign + list carry the device profile (additive)

**Files:**
- Modify: `apps/server/src/device.ts` (`generatePairingCode`, `enrolDevice`, `BINDING_FK_FIELD`), `apps/server/src/device-api.ts` (new `assign-device-profile` route; `GET /management-api/devices` adds `deviceProfileId`), + their tests.

**Interfaces:**
- Produces: `generatePairingCode` accepts an optional `deviceProfileId` and stamps it; `enrolDevice` copies it onto the device; `POST /management-api/devices/:id/assign-device-profile` (body `{ deviceProfileId: string | null }`, `device.manage`-gated) updates `devices.device_profile_id`; `GET /management-api/devices` rows gain `deviceProfileId`. `canvas_id` paths stay untouched (removed Task 10).

**Context:** `device.ts:201` (`generatePairingCode`), `:326` (`enrolDevice` — copies every binding verbatim), `BINDING_FK_FIELD` (`:158`) + `bindingFkField` (`:177`). Reassign template: `assign-canvas` at `device-api.ts:432` (atomic `UPDATE ... SET`, FK violation → `device.binding_invalid` via `bindingFkField`; the B3.1-hardened no-read-then-write shape — do NOT add a pre-check `getDeviceProfile`).

- [ ] **Step 1: Failing tests** — extend the device tests: a pairing code minted with a `deviceProfileId` enrols a device carrying it; a bad `deviceProfileId` → `device.binding_invalid` at mint (FK 23503, mapped via `BINDING_FK_FIELD` gaining `devices_device_profile_fk`/`device_pairing_codes_device_profile_fk` → `deviceProfileId`); `assign-device-profile` updates it and a foreign/bad id → `device.binding_invalid`; clearing to `null` works; `GET /management-api/devices` returns `deviceProfileId`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — thread `deviceProfileId` through `generatePairingCode`'s insert and `enrolDevice`'s copy (verbatim, alongside the existing bindings); add the two FK-constraint names to `BINDING_FK_FIELD`; add the `assign-device-profile` route by mirroring `assign-canvas`; add `deviceProfileId` to the `GET /management-api/devices` select + row shape.

- [ ] **Step 4: Run → PASS** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` (the device suites).

- [ ] **Step 5: Commit** — `git commit -s -m "feat(server): enrol + reassign + list carry device_profile_id"`

---

## Task 7: dashboard device-profile editor screen (additive)

**Files:**
- Create: `apps/dashboard/src/screens/device-profiles-screen.ts` + `.test.ts`
- Modify: `apps/dashboard/src/{dashboard-app.ts (nav), api/client.ts (types + 5 methods), i18n/strings.ts, i18n/codes.ts}`

**Interfaces:**
- Produces client type `DeviceProfile { id: string; name: string; canvasId: string | null; capabilities: string[] }` and methods `listDeviceProfiles`, `getDeviceProfile`, `createDeviceProfile`, `updateDeviceProfile`, `deleteDeviceProfile` (mirror `listCanvases`… at `client.ts:1823-1842`). Nav entry `nav.device_profiles`.

**Context:** additive — the canvas editor and devices screen are untouched here. The editor is simpler than the canvas editor: a list (name + referenced canvas name + capabilities summary; create/duplicate/delete) and an editor form (name text field, a **canvas `<select>`** from `listCanvases`, and the **capability checkboxes** — the three `CAPABILITY_FLAGS`). No grid/tile machinery. Reuse the dashboard's `wt-*` primitives and `--wt-*` tokens (no hardcoded chrome — `no-hardcoded-chrome.test.ts`); match the canvas editor's a11y (plain button group with `aria-current`, not an ARIA `tablist`). Capabilities cross the client boundary as `string[]`, defensively rendered against a local `CAPABILITY_FLAGS` mirror (the #70 bundle rule — do not runtime-import `@waitron/layouts`).

- [ ] **Step 1: Failing screen test** — mirror an existing dashboard screen test (browser-mode Vitest): renders the list from a stubbed `listDeviceProfiles`; create submits `{name, canvasId, capabilities}`; the capability checkboxes reflect + toggle; delete calls the client. Add i18n-key presence assertions if the repo has an i18n completeness guard.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the client methods (mirror the canvas ones), the screen, the nav entry, and the i18n strings (EN + ES) + any `codes.ts` entries for the new error codes (mirror the `canvas.*` code strings).

- [ ] **Step 4: Run → PASS** — `pnpm --filter @waitron/dashboard test:coverage` (browser mode; do not run concurrently with other browser-mode suites — memory [browser-mode-vitest-ram]). Thresholds 95/95/90/88.

- [ ] **Step 5: Commit** — `git commit -s -m "feat(dashboard): device-profile editor screen + client + i18n"`

---

## Task 8: dashboard devices screen assigns a device profile (swap)

**Files:**
- Modify: `apps/dashboard/src/screens/devices-screen.ts`, `apps/dashboard/src/api/client.ts` (`DeviceRow`, `createDeviceCode` bindings, `reassignDevice`→`reassignDeviceProfile`), i18n, tests.

**Context:** `GET /management-api/devices` now returns BOTH `canvasId` (still) and `deviceProfileId` (Task 6), so this swap is safe — the screen stops reading `canvasId` and reads `deviceProfileId`. The mint form and the per-row reassign `<select>` switch from a canvas list to a device-profile list (`listDeviceProfiles`); the reassign calls `assign-device-profile`; `createDeviceCode` sends `deviceProfileId`.

- [ ] **Step 1: Failing test** — the devices screen lists devices showing their device profile; the mint form offers device profiles and posts `deviceProfileId`; the per-row reassign posts to `assign-device-profile`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the swap: `DeviceRow.canvasId`→`deviceProfileId`; `createDeviceCode` bindings `canvasId`→`deviceProfileId`; `reassignDevice`→`reassignDeviceProfile` (POST `/assign-device-profile`); the mint + reassign UI read `listDeviceProfiles`. Update i18n.
- [ ] **Step 4: Run → PASS** — `pnpm --filter @waitron/dashboard test:coverage`.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(dashboard): devices screen assigns a device profile"`

---

## Task 9: relocate capabilities off the canvas — firewall + resolution + render (cutover)

**Files:**
- Modify: `packages/layouts/src/{canvas.ts,validate-canvas.ts,default-canvases.ts}` (drop `capabilities` from `CanvasDef` + validator + defaults); `apps/server/src/{device-session.ts,till-api.ts}`; `apps/till/src/{layout.ts,till-app.ts}` + SP-C dev mirror; `apps/dashboard/src/screens/canvas-editor-screen.ts` + `screens/canvas-editor/validate-canvas.ts` (drop the capabilities section + client mirror); their tests.

**Context:** this is the atomic capability cutover — after it, capabilities live only on the device profile. It touches four packages in one task **because removing the field from `CanvasDef` breaks all readers simultaneously**; splitting it would leave the workspace uncompilable between tasks. The device link + store + routes it depends on all exist (Tasks 1–6).

- [ ] **Step 1: Update the firewall test first** (`device-session.ts` capability suite): rewrite the fixture so capabilities come from a **device profile** — a device whose profile holds `integrated-card-payment` passes `/api/pay`; a device with **no profile** is refused (fail-closed, the `resolved.deviceProfileId === null` branch); a device whose profile lacks the flag is refused. **Preserve the behavioural assertions** (CLAUDE.md — don't rewrite the test to match new code; keep pass/refuse pinned). Watch it fail.

- [ ] **Step 2: Flip `assertDeviceCapability`** (`device-session.ts:359`): replace the `resolved.canvasId`→canvas→`canvas.definition.capabilities` path with `resolved.deviceProfileId`→`getDeviceProfile`→`profile.capabilities`; null profile ⇒ refuse (`device.forbidden_action`, unchanged). Same `withTenant + asAppUser` tx shape.

- [ ] **Step 3: `/api/till` resolution + payload** (`till-api.ts:668`): resolve the device's profile; `canvas = profile.canvasId ? getCanvas(...) : undefined` then `?? getCanvasForFormFactor(deviceFormFactor(kind))`; add a sibling `capabilities: profile?.capabilities ?? []` to the till payload. (Canvas resolution may still consult `device.canvasId` transitionally if the profile is null — but prefer the profile; `device.canvasId` is dropped in Task 10, so keep the fallback minimal and delete it there.) Update the till payload type + `apps/till/src/layout.ts:69` mirror + the SP-C dev-switcher mirror to drop `capabilities` from the canvas type and read the new sibling. `till-app.ts:2129` reads `this.capabilities` from the new field.

- [ ] **Step 4: Remove `capabilities` from the model** — `CanvasDef` (`canvas.ts:71`), `validateCanvas` (`validate-canvas.ts:45` — stop reading/emitting it), `DEFAULT_CANVASES` (drop the key). The dashboard canvas editor's Capabilities section (`canvas-editor-screen.ts:1168-1180`, the `:1050` warning, the `:694` save path, the `canvas_editor.capabilities` i18n) is removed; the client `validate-canvas.ts` mirror drops capabilities in lockstep (drift guard stays green).

- [ ] **Step 5: Update every affected test** across the four packages (canvas snapshots that pinned `capabilities`, the render-axis test, the till boot test). Add the **render-axis behaviour-change** test (design §5.3): a no-profile device renders the form-factor default canvas with `capabilities: []` and hides `tender-pay`/`kds-board`; a profile-carrying device shows them (prove by deleting the profile-read).

- [ ] **Step 6: Run** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/layouts --filter @waitron/server test:coverage`, then `pnpm --filter @waitron/till test:coverage` and `pnpm --filter @waitron/dashboard test:coverage` (browser suites one at a time). **Prove the firewall by mutation** (the security gate): `pnpm --filter @waitron/server test:mutation` on the capability path, or a container mutation à la SP-A.2 §7 — a device without the flag is refused, one with it passes.

- [ ] **Step 7: Commit** — `git commit -s -m "feat: relocate device capabilities from the canvas onto the device profile"`

---

## Task 10: drop `canvas_id` from devices + assign-canvas route; seed dev profile

**Files:**
- Modify: `packages/db/src/schema/devices.ts` (remove `canvasId` from both tables) + `devices.fk.test.ts`; `apps/server/src/{device.ts,device-api.ts,till-api.ts}` (remove `canvasId` stamping/copy/select, `assign-canvas` route, the transitional canvas fallback); `apps/dashboard/src/api/client.ts` (`DeviceRow` drops `canvasId`); `apps/server/scripts/dev-setup.ts` + `dev-setup.test.ts`.
- Create: `packages/db/drizzle/0110_*.sql` (`--custom`: drop the two `canvas_id` columns + their FKs).

**Context:** the final structural cutover. Everything now flows through the profile, so `devices.canvas_id` is dead.

- [ ] **Step 1: dev-setup first** — write/adjust `dev-setup.test.ts` to assert the seeded tenant gets a **default device profile** (`name: "Counter"`, `canvasId: null`, `capabilities: DEFAULT_PROFILE_CAPABILITIES.till`) and that the minted `till` pairing code carries its `deviceProfileId`. Watch it fail; implement in `dev-setup.ts` (create the profile via the store, stamp the code). Without this the dev till enrols with no profile → firewall refuses pay/drawer + cards hidden (design §10).

- [ ] **Step 2: Remove `canvasId`** from both tables in `devices.ts`; `db:generate` won't emit a bare-column drop cleanly for a composite FK — hand-write the `--custom` `0110` dropping `devices_canvas_fk` / `device_pairing_codes_canvas_fk` then the columns. Update `devices.fk.test.ts` (remove the canvas-FK assertions).

- [ ] **Step 3: Remove the server canvas_id paths** — `generatePairingCode`/`enrolDevice` stop stamping/copying `canvasId`; the `assign-canvas` route is deleted; `GET /management-api/devices` drops `canvasId`; `BINDING_FK_FIELD` drops the canvas entries; `/api/till` resolution drops the transitional `device.canvasId` fallback (profile-only now). `DeviceRow` (dashboard client) drops `canvasId`.

- [ ] **Step 4: Run** — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db --filter @waitron/server test:coverage` + `pnpm --filter @waitron/dashboard test:coverage` + `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.

- [ ] **Step 5: Commit** — `git commit -s -m "feat: drop device canvas_id; device profile is the sole binding (dev seed)"`

---

## Task 11: whole-workspace gate + cross-package sweep + backlog

**Files:** Modify: `docs/backlog.md`.

- [ ] **Step 1: Stale-list / snapshot sweep** (CLAUDE.md §2) — grep the whole tree for anything pinning the old shape: `grep -rn "canvasId\|canvas_id\|layout_profile" packages apps` (any surviving device-canvas reference is a miss); `grep -rn "\.capabilities" packages apps` (every consumer must read from the profile/till-payload, not a `CanvasDef`); any `CanvasDef` snapshot/`toEqual` that still lists `capabilities`. Fix in place.
- [ ] **Step 2: Whole-workspace gate** — `pnpm lint && pnpm typecheck && pnpm format:check` then `pnpm -r test:coverage` (do NOT background it — memory [whole-workspace-coverage-spikes-ram]; run browser suites serially). Then the root guards: `pnpm vitest run scripts/` (errors-reachable, english-only, guarded-teardowns). Then `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.
- [ ] **Step 3: `pnpm install`** (lockfile unchanged expected — no new deps) and confirm `--frozen-lockfile` would pass.
- [ ] **Step 4: Update `docs/backlog.md`** — mark the SP-B "Deferred follow-on — device profile" row LANDED (chain device→device-profile→canvas; capabilities relocated off the canvas; till/station/hardware still per-device; area/routing/printer still deferred). Record the deferred follow-ons (aggregated bundle, built-in tenant-facing default profiles).
- [ ] **Step 5: Commit** — `git commit -s -m "chore: whole-workspace gate green; backlog device-profile landed"`

---

## Self-review notes (author)

- **Spec coverage:** §5.1 table→T2; §5.2 device link→T5; §5.3 resolution/fallback→T9 (+ T3 behaviour); §7 layouts relocation→T1(add)+T9(remove); §8.1 store→T3; §8.2 firewall/resolution→T9; §8.3 enrol/reassign→T6; §8.4 CRUD routes→T4; §9 dashboard→T7(editor)+T8(devices)+T9(canvas-editor capability removal); §10 dev seed→T10; §11 error codes→T1/T4; §12 testing→each task + T11. All covered.
- **Green-per-task:** T1–T7 additive; T8 safe (server returns both fields); T9 is the one multi-package task, unavoidable (removing a shared type). T10 finishes the removal. T11 gates.
- **Type consistency:** `deviceProfileId` (camel, TS) / `device_profile_id` (snake, SQL); `DeviceProfileRow` shape identical in store (T3), routes (T4), client (T7/T8). `validateCapabilities` name identical T1→T3→T9. `DEFAULT_PROFILE_CAPABILITIES` identical T1→T10.
