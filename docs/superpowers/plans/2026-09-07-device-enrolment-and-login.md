# Device enrolment & login redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the device profile the single description of a device — `device_kind` derives from the profile's form factor — and rebuild enrolment (verify-key → describe-device, register auto-created for a till) and the login screen (remembered operator, phone PIN pad, capped width, per-(device,person) wrong-PIN backoff).

**Architecture:** A device is defined by its `device_profile_id` (now `NOT NULL`); the profile carries a new `form_factor`; a pure `kindOfFormFactor` derives the old three-way `DeviceKind` for the five readers that still want it. A DB trigger enforces the station-XOR-register binding rule through the profile. The pairing code sheds every binding column and becomes a bare bearer token; `POST /api/device/enrol/verify` returns the catalogue (profiles/stations/registers) a live key authorises, and `POST /api/device/enrol` consumes the key, creates a register for a till profile, and inserts the device. A pure PIN-throttle module in `@waitron/identity` (closure, injectable clock, keyed by `deviceId:personId`) gates `POST /api/session`, which now also stamps the device's own register. The till gets a device-chooser front door (dev), a two-step enrol screen, and a reworked lock screen; the dashboard's generate form collapses to one button and grows a per-device hardware editor and a profile form-factor picker.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL 18 + PGlite test target), Hono (server), Lit (till/dashboard web components), Vitest (+ real-Chromium browser mode for UI packages, Testcontainers for real-PG), pnpm workspace.

**Spec:** [`docs/superpowers/specs/2026-09-07-device-enrolment-and-login-design.md`](../specs/2026-09-07-device-enrolment-and-login-design.md) — read it alongside this plan; every task argues from a spec section (cited as “spec §N”).

## Global Constraints

- **No backwards-compatibility / no data-migration code.** Pre-production: schema drops and recreates, dev DB is reseeded. Never write a backfill. (CLAUDE.md §"No backwards-compatibility"; spec §1.4.)
- **Error codes are never renamed once shipped.** Add siblings; `pin.invalid` stays. New codes name the DOMAIN concept and live in the domain package's `errors.ts`, which the throwing file imports as `import "./errors.js"`. (CLAUDE.md §3.)
- **Never build SQL by string concatenation** except utility DDL PostgreSQL cannot bind (CREATE/GRANT/trigger bodies), which go in a `--custom` migration. Drizzle `` sql`…${v}` `` parameterises. (CLAUDE.md §3.)
- **A by-id read still needs its own `eq(table.tenantId, cfg.tenantId)`** — one-tenant-per-DB is not the query isolation boundary. (CLAUDE.md §3.)
- **Multi-table writes share ONE `withTenant` transaction.** (CLAUDE.md §3.)
- **New/changed tables + triggers:** classify (`ledger`/`state`/`local`); `devices`/`device_profiles` are `state`. Run the `inmutabilidad` trigger scan after any trigger change. (CLAUDE.md §3/§5.)
- **Migration collisions on rebase are fixed by regeneration, never hand-edits.** (CLAUDE.md §3.)
- **Copy rule:** UI shows human labels only — never `till` / `kds_station` / `phone-portrait` literals. "Till" → **"Cash register"** in both apps. (spec §3.3/§4.)
- **Gate before every commit that touches a package:** `pnpm --filter <pkg> typecheck && pnpm --filter <pkg> test:coverage && pnpm --filter <pkg> lint && pnpm format:check`. CI runs `test:coverage`, not `test`. Browser packages run real Chromium — check `memory_pressure | grep free` first. (CLAUDE.md §2/§4.)
- **`errors-reachable` guard** (root project) text-walks the import graph from each package barrel; a new code must be reachable via a real `import "./errors.js"` in a shipped (non-test) file. (CLAUDE.md §4.)
- **Local real-PG:** `TESTCONTAINERS_RYUK_DISABLED=true`; run `pnpm reap` if a prior run was interrupted. (CLAUDE.md §4.)

---

## File structure

**Schema / migrations (`packages/db`)**
- `src/schema/device-profiles.ts` — add `formFactor` column + `form_factor` pgEnum.
- `src/schema/devices.ts` — drop `deviceKind` from `devices` and `device_pairing_codes`; make `devices.device_profile_id` NOT NULL; drop the `device_kind` pgEnum export; drop the binding columns from `device_pairing_codes`.
- `drizzle/****_*.sql` (db:generate) — enum + column adds/drops.
- `drizzle/****_*_sql.sql` (db:generate:custom) — drop old `device_kind` CHECKs; the device binding-rule trigger; the profile form-factor drift-guard trigger; grants for the auto-created register path; drop the pairing-code binding FKs.

**Layouts (`packages/layouts`)** — the form-factor vocabulary lives here.
- `src/canvas.ts` — `kindOfFormFactor` (+ `DeviceKind` type re-home decision, see Task 3).
- `src/device-profile.ts` — `DefaultDeviceProfile` already has `formFactor`; nothing to add beyond persisting it.
- `src/device-profile-store.ts` — `DeviceProfileRow`, `PROFILE_COLUMNS`, `createDeviceProfile`, `updateDeviceProfile` gain `formFactor`.

**Identity (`packages/identity`)**
- `src/pin-throttle.ts` (new) — pure throttle; owns `pin.throttled`.
- `src/errors.ts` — register `pin.throttled`.
- `src/login.ts` — unchanged signature; the register value is chosen by the caller (already a param).

**Server (`apps/server`)**
- `src/device.ts` — `enrolDevice`/`generatePairingCode` reshaped: the code carries no bindings; enrol takes the device description; register auto-create for a till profile.
- `src/dev-pairing.ts` — `enrolDevTill` deleted; `DEMO` now feeds the real verify/enrol path.
- `src/device-api.ts` — add `POST /api/device/enrol/verify`; reshape `POST /api/device/enrol`; delete `POST /api/dev/devices` (mint) and `POST /api/device/reset`; keep `GET /api/dev/devices`; add `PATCH /management-api/devices/:id/hardware`; reshape `POST /management-api/device-codes` (bare key); `GET /api/device/me` returns `formFactor`.
- `src/till-api.ts` — `POST /api/session`: PIN throttle + device's register.
- `scripts/dev-setup.ts` — seed three devices via the real enrol path.

**Till (`apps/till`)**
- `src/main.ts` — drop the `?dev` fork; one boot path.
- `src/till-app.ts` — boot decision (chooser/enrol-step-1/login/kds); render the chooser and the two-step enrol; "Switch device" (dev).
- `src/screens/till-device-chooser.ts` (rename/rework of `till-dev-chooser.ts`) — list + "Set up a new device" (opens enrol at step 2 with DEMO).
- `src/screens/till-enrol-screen.ts` (rework of `till-device-enrol-screen.ts`) — step 1 key, step 2 describe.
- `src/screens/till-lock-screen.ts` — remembered operator, keypad-on-select, capped width, Cancel, throttle countdown; remove the three setup affordances.
- `src/widgets/numeric-pad.ts` — pin-mode key order `1 2 3 / 4 5 6 / 7 8 9 / _ 0 ⌫`.
- `src/api/client.ts` — new/changed API methods + types.

**Dashboard (`apps/dashboard`)**
- `src/screens/devices-screen.ts` — collapse generate form to one button; per-row hardware editor.
- `src/screens/device-profiles` editor — form-factor picker.
- `src/api/client.ts`, `src/i18n/strings.ts` — methods + copy.

---

## Phase A — the model: profile carries the form factor

### Task 1: `form_factor` on `device_profiles`

**Files:**
- Modify: `packages/db/src/schema/device-profiles.ts`
- Modify: `packages/layouts/src/device-profile-store.ts` (`PROFILE_COLUMNS`, `DeviceProfileRow`, `toRow`, `createDeviceProfile`, `updateDeviceProfile`)
- Test: `packages/layouts/src/device-profile-store.pg.test.ts`, `packages/db/src/schema/device-profiles.fk.test.ts`

**Interfaces:**
- Produces: `deviceProfiles.formFactor` column; `formFactor` pgEnum `device_form_factor` over `["till","phone-portrait","tablet-landscape","kds"]`; `DeviceProfileRow` gains `formFactor: FormFactor`; `createDeviceProfile`/`updateDeviceProfile` inputs gain `formFactor: FormFactor`.

- [ ] **Step 1: Write the failing store test.** In `device-profile-store.pg.test.ts`, add: create a profile with `formFactor: "kds"`, read it back via `getDeviceProfile`, assert `row.formFactor === "kds"`; assert `listDeviceProfiles` carries it. Use `toEqual` on the whole row shape so a dropped key is caught (CLAUDE.md §4).

- [ ] **Step 2: Run it, watch it fail.** `pnpm --filter @waitron/db test:coverage 2>/dev/null; pnpm --filter @waitron/layouts test -- device-profile-store.pg` → FAIL (`formFactor` unknown / column missing).

- [ ] **Step 3: Add the enum + column.** In `device-profiles.ts`:
```ts
export const deviceFormFactorEnum = pgEnum("device_form_factor", [
  "till", "phone-portrait", "tablet-landscape", "kds",
]);
// …inside the table:
formFactor: deviceFormFactorEnum("form_factor").notNull(),
```
The enum values MUST equal `FORM_FACTORS` in `packages/layouts/src/canvas.ts:9`. In `device-profile-store.ts` add `formFactor: deviceProfiles.formFactor` to `PROFILE_COLUMNS`, `formFactor` to `DeviceProfileRow` and `toRow`, and thread `formFactor` through `createDeviceProfile`/`updateDeviceProfile` `.values`/`.set`.

- [ ] **Step 4: Regenerate the migration.** `pnpm --filter @waitron/db db:generate --name device_profile_form_factor`. Inspect the emitted SQL: a `CREATE TYPE device_form_factor` + `ALTER TABLE device_profiles ADD COLUMN form_factor`. Because pre-production drops/recreates, no default/backfill is needed; the column is `NOT NULL` and every insert now supplies it.

- [ ] **Step 5: Run tests to green.** Same command as Step 2 → PASS. Then `pnpm --filter @waitron/db test:coverage` and `pnpm --filter @waitron/layouts test:coverage`.

- [ ] **Step 6: Commit.** `git add -A && git commit -s -m "feat(db): device profiles carry a form_factor"`

### Task 2: seed the starter profiles with their form factor

**Files:**
- Modify: `packages/layouts/src/device-profile.ts` (seeding path — where `DEFAULT_DEVICE_PROFILES` is written to the DB)
- Modify: `packages/provisioning/src/venue-plan.ts:153` area (the `applyVenue` seed) and any dev-setup seed of profiles
- Test: `packages/layouts/src/device-profile.test.ts` (or the provisioning seed test)

**Interfaces:**
- Consumes: `DEFAULT_DEVICE_PROFILES[i].formFactor` (already present).
- Produces: seeded rows now persist `formFactor`.

- [ ] **Step 1: Write the failing test.** Assert that after seeding, the "till"/"Mostrador" profile row has `formFactor === "till"`, "Cocina"/kds → `"kds"`, "Móvil"/handheld → `"phone-portrait"`.

- [ ] **Step 2: Run, watch fail** (seed does not pass `formFactor`).

- [ ] **Step 3: Thread `formFactor` into the seed insert.** Find where `DEFAULT_DEVICE_PROFILES` is inserted (grep `createDeviceProfile\|insert(deviceProfiles)` in `packages/layouts` and `packages/provisioning`) and pass `formFactor: profile.formFactor`.

- [ ] **Step 4: Run to green.** `pnpm --filter @waitron/layouts test:coverage && pnpm --filter @waitron/provisioning test:coverage`.

- [ ] **Step 5: Commit.** `git commit -s -m "feat(layouts): seed device profiles with their form factor"`

### Task 3: `kindOfFormFactor` and re-home `DeviceKind`

**Files:**
- Modify: `packages/layouts/src/canvas.ts` (add `kindOfFormFactor`, export a `DeviceKind` type)
- Modify: `packages/layouts/src/index.ts` (barrel export)
- Test: `packages/layouts/src/canvas.test.ts`

**Interfaces:**
- Produces: `export type DeviceKind = "kds_station" | "handheld" | "till";` and
```ts
export function kindOfFormFactor(ff: FormFactor): DeviceKind
```
`till→till`, `kds→kds_station`, `phone-portrait|tablet-landscape→handheld`.

**Note (spec §9):** `kindOfFormFactor` lives in `@waitron/layouts` so both `apps/server` and the till import it. Verify `@waitron/layouts` has no forbidden dep added (it is already imported by server + provisioning). The `DeviceKind` type currently derives from the (about-to-be-deleted) `deviceKind` pgEnum in `packages/db`; re-home it here as a plain union so it survives the enum's deletion in Task 4.

- [ ] **Step 1: Write the failing test.** Table-drive all four form factors → expected kind; assert exhaustiveness (a `satisfies Record<FormFactor, DeviceKind>` map or a switch with no default).

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement** the union + function beside `FORM_FACTORS`.

- [ ] **Step 4: Run to green.** `pnpm --filter @waitron/layouts test:coverage`.

- [ ] **Step 5: Commit.** `git commit -s -m "feat(layouts): kindOfFormFactor derives the device kind from a form factor"`

### Task 4: drop `device_kind`; device requires a profile; binding-rule trigger

**Files:**
- Modify: `packages/db/src/schema/devices.ts` (drop `deviceKind` from both tables + the `deviceKind` pgEnum; `device_profile_id` NOT NULL; drop `device_pairing_codes` binding columns — `station_id`, `till_id`, `device_profile_id`, `receipt_printer_id`, `has_cash_drawer`, `card_provider`, `card_reader_id`, `label`)
- Create: a `--custom` migration `drizzle/****_device_binding_rule_sql.sql`
- Test: `packages/fiscal-verifactu` `inmutabilidad` suite (trigger scan); a new real-PG test `packages/db/src/schema/devices.trigger.pg.test.ts`

**Interfaces:**
- Produces: `devices` with `device_profile_id NOT NULL`, no `device_kind`; a constraint trigger enforcing form-factor→binding.

**Binding rule (spec §1.3):** joining `devices` to `device_profiles` on `(tenant_id, device_profile_id)`:
- form factor `kds` ⇒ `station_id IS NOT NULL AND till_id IS NULL`
- otherwise ⇒ `station_id IS NULL AND till_id IS NOT NULL`

- [ ] **Step 1: Write the failing real-PG trigger test.** In `devices.trigger.pg.test.ts` (real Postgres via `useRealPostgres`, because triggers do not fire meaningfully unless the row is inserted as the app role — but they DO fire on PGlite; use real PG for the grant/role realism per CLAUDE.md §4): seed a `kds` profile and a `till` profile. Assert:
  - inserting a device with the `kds` profile and a NULL `station_id` → rejected;
  - inserting with the `till` profile and a NULL `till_id` → rejected;
  - the correct XOR each way → inserted. Prove-by-deletion is Step 6.

- [ ] **Step 2: Run, watch fail** (no trigger yet; column still exists).

- [ ] **Step 3: Edit the schema.** Remove `deviceKind` columns from `devices` and `device_pairing_codes`; remove `export const deviceKind = pgEnum(...)`; set `deviceProfileId: uuid("device_profile_id").notNull()` on `devices`; delete the six binding columns + `label`… **wait:** `label` stays on `devices` (the human name) but leaves `device_pairing_codes`. Delete from `device_pairing_codes` only: `deviceKind`, `stationId`, `tillId`, `deviceProfileId`, `receiptPrinterId`, `hasCashDrawer`, `cardProvider`, `cardReaderId`, `label`.

- [ ] **Step 4: Regenerate the drizzle migration** for the column/enum drops: `pnpm --filter @waitron/db db:generate --name drop_device_kind`. Inspect: DROP COLUMN ×N, DROP TYPE device_kind, ALTER COLUMN device_profile_id SET NOT NULL.

- [ ] **Step 5: Write the custom migration** `db:generate:custom --name device_binding_rule_sql` and paste:
```sql
-- Drop the old kind-based CHECKs (defined in the baseline custom migration).
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_station_kind_check;
ALTER TABLE device_pairing_codes DROP CONSTRAINT IF EXISTS device_pairing_codes_station_kind_check;
-- (Confirm the exact constraint names in 0001_db_baseline_sql.sql before pasting.)

CREATE OR REPLACE FUNCTION device_binding_rule() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE ff text;
BEGIN
  SELECT p.form_factor INTO ff
    FROM device_profiles p
   WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.device_profile_id;
  IF ff IS NULL THEN
    RAISE EXCEPTION 'device % has no profile in its tenant', NEW.id;
  END IF;
  IF ff = 'kds' THEN
    IF NEW.station_id IS NULL OR NEW.till_id IS NOT NULL THEN
      RAISE EXCEPTION 'a kds device binds a station and no register';
    END IF;
  ELSE
    IF NEW.till_id IS NULL OR NEW.station_id IS NOT NULL THEN
      RAISE EXCEPTION 'a % device binds a register and no station', ff;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER device_binding_rule_trg
  AFTER INSERT OR UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION device_binding_rule();
```
This is a `state`-table integrity trigger (ordinary, NOT `ENABLE ALWAYS`/`reject_mutation` — that is for append-only ledger tables). Keep the enrol grants unchanged (`app_user` already holds INSERT/UPDATE on `devices`).

- [ ] **Step 6: Prove by deletion + run inmutabilidad.** Add a test variant (or a scratch step) dropping `device_binding_rule_trg` and confirming the bad insert now succeeds, so the trigger is what enforces it. Run the `fiscal-verifactu` inmutabilidad trigger scan → still green, and confirm `devices` is classified `state`.

- [ ] **Step 7: Run to green.** `pnpm --filter @waitron/db test:coverage` (real PG). Note many existing tests set `deviceKind` on inserts — they will fail to compile; fixing them is Task 5's job, so expect this package red on `typecheck` until Task 5. Commit the schema+migration+trigger here; typecheck-green is restored in Task 5. **Do not** mark the package green yet.

- [ ] **Step 8: Commit.** `git commit -s -m "feat(db): device is defined by its profile; binding rule via trigger"`

### Task 5: form-factor drift guard + fix every `deviceKind` reader

**Files:**
- Modify: `apps/server/src/device.ts` (`deviceFormFactor`, `kindRequiresStation`, `kindRequiresTill` → operate on form factor / via `kindOfFormFactor`)
- Modify: `apps/server/src/device-session.ts:360` (`assertNotHandheld` reads the device's form factor)
- Modify: `apps/till/src/till-app.ts:704-713` (boot switch reads `formFactor`)
- Modify: the custom migration from Task 4 (append the drift-guard trigger) OR a new custom migration
- Test: the trigger test (drift guard), plus updating every test that constructed a device/kind

**Interfaces:**
- Consumes: `kindOfFormFactor`, `DeviceProfileRow.formFactor`.
- Produces: `GET /api/device/me` payload carries `formFactor: FormFactor` (drop `kind`).

- [ ] **Step 1: Write the failing drift-guard test.** Real PG: an `active` device references a `kds` profile; `UPDATE device_profiles SET form_factor='till'` on it → rejected; with the device `active=false` (or absent) → succeeds.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Add the drift-guard trigger** (custom migration):
```sql
CREATE OR REPLACE FUNCTION device_profile_form_factor_locked() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.form_factor <> OLD.form_factor
     AND EXISTS (SELECT 1 FROM devices d
                  WHERE d.tenant_id = NEW.tenant_id
                    AND d.device_profile_id = NEW.id
                    AND d.active) THEN
    RAISE EXCEPTION 'cannot change form factor of a profile in use by an active device';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER device_profile_form_factor_locked_trg
  BEFORE UPDATE ON device_profiles
  FOR EACH ROW EXECUTE FUNCTION device_profile_form_factor_locked();
```

- [ ] **Step 4: Rewrite the kind readers.** Delete `deviceFormFactor(kind)` (the form factor is now the source). `kindRequiresStation`/`kindRequiresTill` become `formFactorRequiresStation(ff)` / `formFactorRequiresTill(ff)` (or keep names but take a `FormFactor`). `assertNotHandheld` resolves the device's profile → form factor and forbids the action when `kindOfFormFactor(ff) === "handheld"`. The till boot switch reads `identity.formFactor` and calls `kindOfFormFactor` for its handheld/till/kds branching.

- [ ] **Step 5: Fix all broken tests + `GET /api/device/me`.** Update every test that built a device with `deviceKind`; change `me` to return `formFactor`. Run `pnpm --filter @waitron/db test:coverage`, `pnpm --filter @waitron/server test:coverage`, `pnpm --filter @waitron/till test:coverage` (browser — check memory first).

- [ ] **Step 6: Commit.** `git commit -s -m "feat: derive device kind from profile form factor; lock a profile's form factor in use"`

---

## Phase B — enrolment: the key is just a key

### Task 6: the pairing code sheds its bindings; `generatePairingCode` reshaped

**Files:**
- Modify: `apps/server/src/device.ts` (`generatePairingCode` → mints a bare code; drop all binding params + FK translation for the code path; `enrolDevice` → takes the device description)
- Modify: `apps/server/src/device-api.ts:328` (`POST /management-api/device-codes` sends nothing but auth)
- Test: `apps/server/src/device.test.ts` (or wherever `generatePairingCode`/`enrolDevice` are unit-tested)

**Interfaces:**
- Produces:
```ts
export async function generatePairingCode(
  tx: Transaction, cfg: TillConfig,
  codeSource?: () => string,
): Promise<{ code: string }>   // no bindings, no kind

export async function enrolDevice(
  tx: Transaction, cfg: TillConfig,
  input: {
    code: string;
    name: string;
    profileId: string;
    stationId?: string | null;
    registerId?: string | null;  // an existing tills.id (handheld/tablet); ignored for a till profile
  },
): Promise<{ deviceId: string; name: string; formFactor: FormFactor; token: string }>
```

- [ ] **Step 1: Write the failing test.** `generatePairingCode` returns a code and inserts a `device_pairing_codes` row with only `{tenant_id, location_id, code_sha256, created_at}` (assert the row shape with `toEqual` on selected columns). The old binding-invalid / till-required / station-required paths move to `enrolDevice` (Task 7) — assert `generatePairingCode` no longer throws them.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Reshape.** Strip `generatePairingCode` to: hash a fresh code, insert the bare row, translate only the 23505 digest collision (`device.pairing_code_unavailable`). Delete `BINDING_FK_FIELD` entries for `device_pairing_codes_*` (keep `devices_device_profile_fk` for the assign route). `POST /management-api/device-codes` now takes no body fields (auth only) and returns `{ code }`.

- [ ] **Step 4: Run to green.** `pnpm --filter @waitron/server test:coverage` (expect `enrolDevice` callers still red — Task 7).

- [ ] **Step 5: Commit.** `git commit -s -m "feat(server): pairing code is a bare bearer token"`

### Task 7: `enrolDevice` describes the device; register auto-created for a till

**Files:**
- Modify: `apps/server/src/device.ts` (`enrolDevice`)
- Modify: `packages/db` grants if a new `tills` INSERT grant is needed (check `app_user` already holds INSERT on `tills`; the register auto-create needs it)
- Test: `apps/server/src/device.test.ts` + a real-PG enrol test

**Interfaces:**
- Consumes: `getDeviceProfile` (`@waitron/layouts`), `kindOfFormFactor`.
- Produces: the `enrolDevice` above; a `till`-form-factor profile creates one `tills` row named `input.name` at `cfg.locationId` and binds it; a non-`kds`, non-`till` profile (phone/tablet) requires `registerId`; a `kds` profile requires `stationId`.

**Register-name collision (spec §9):** if a `tills` row named `input.name` already exists at the location, throw a clear error (`device.register_name_taken`, a new code) so the operator renames the device. Reject, do not suffix.

- [ ] **Step 1: Write failing tests.**
  - a `till` profile: enrol creates exactly one `tills` row named `input.name`, device bound to it, `station_id` NULL;
  - a `phone-portrait` profile with a `registerId`: device bound to that register, no new `tills` row;
  - a `kds` profile with a `stationId`: bound to the station, `till_id` NULL;
  - a `kds` profile with a NULL `stationId` → `device.station_required`;
  - a phone profile with a NULL `registerId` → `device.register_required` (new code) ;
  - a `till` profile whose `name` collides at the location → `device.register_name_taken`;
  - the whole enrol is one transaction: force a failure after the register insert (inject a failing device insert) → no orphan `tills` row.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement.** After the consume-DELETE (unchanged), resolve the profile via `getDeviceProfile(tx, cfg.tenantId, input.profileId)` (throw `device.profile_missing` if absent). Branch on `profile.formFactor`:
  - `kds`: require `stationId` (`requireLiveStation`), `till_id = null`;
  - `till`: create the register (`insert(tills).values({tenantId, locationId, name: input.name})` — catch the unique-name violation → `device.register_name_taken`), bind `till_id`;
  - else: require `registerId`, verify it is a live register of this tenant/location, bind `till_id`.
  Insert the `devices` row with `deviceProfileId: input.profileId`, `label: input.name`, `station_id`/`till_id` per the branch, hardware columns left at defaults (bound later via the dashboard). The binding-rule trigger (Task 4) is the backstop.

- [ ] **Step 4: Register new codes.** Add `device.register_required` and `device.register_name_taken` to `apps/server/src/errors.ts` (device family; empty params).

- [ ] **Step 5: Run to green.** `pnpm --filter @waitron/server test:coverage`.

- [ ] **Step 6: Commit.** `git commit -s -m "feat(server): enrol describes the device; a till profile mints its register"`

### Task 8: `verify` + `enrol` routes; delete the dev mint/reset; DEMO on the real path

**Files:**
- Modify: `apps/server/src/device-api.ts` (add `POST /api/device/enrol/verify`; reshape `POST /api/device/enrol`; delete `POST /api/dev/devices` + `POST /api/device/reset`; keep `GET /api/dev/devices` but drop the mint fields it advertised)
- Modify: `apps/server/src/dev-pairing.ts` (delete `enrolDevTill` + `TILL_PROFILE_NAMES`; keep `DEV_PAIRING_CODE`/`isDevPairingCode`)
- Modify: `apps/server/src/device.ts` — add a `verifyPairingCode(tx, cfg, code)` that SELECTs (no DELETE), TTL-checks, returns the catalogue
- Test: `apps/server/src/device-api.test.ts` (e2e)

**Interfaces:**
- Produces:
```ts
// POST /api/device/enrol/verify  { code }  ->  200 { profiles: {id,name,formFactor}[], stations: {id,name}[], registers: {id,name}[] }
// POST /api/device/enrol  { code, name, profileId, stationId?, registerId? }  ->  200 { deviceId, name, formFactor }  + Set-Cookie
```
`verifyPairingCode` accepts `DEMO` in devMode (returns the catalogue without a real code row); `enrol` accepts `DEMO` in devMode via the real `enrolDevice` (not `enrolDevTill`).

- [ ] **Step 1: Write failing e2e tests.**
  - `verify` with a live minted code returns the catalogue and does NOT consume it (a following `enrol` with the same code succeeds);
  - `verify`/`enrol` with `DEMO` succeed only under devMode; outside devMode `DEMO` → `device.pairing_invalid`;
  - `enrol` with a `till` profile sets the cookie and creates the register;
  - both routes are behind `enrolLimiter` (a flood → `device.pairing_rate_limited`).

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement.** `verifyPairingCode`: `enrolLimiter.check()` first (courtesy: keep it before DB work as `enrol` does), SELECT the code by `code_sha256` (or accept `DEMO` in devMode), TTL-check → `device.pairing_invalid`/`device.pairing_expired`, then read the catalogue (`listDeviceProfiles`, `listStations`, `listTills` — the register list) scoped to tenant. The route wires it. `enrol` route: rate-limit, `readJsonBody`, `requireString` the `code`/`name`/`profileId`, optional `stationId`/`registerId`, call `enrolDevice`, set the cookie, return `{deviceId,name,formFactor}`. Delete the `devTill` branch and `enrolDevTill`. Delete `POST /api/dev/devices` and `POST /api/device/reset` and their client methods (Task 13 removes the last UI caller).

- [ ] **Step 4: Run to green.** `pnpm --filter @waitron/server test:coverage`.

- [ ] **Step 5: Commit.** `git commit -s -m "feat(server): verify-then-enrol; DEMO runs the real enrol path"`

---

## Phase C — login: throttle + register

### Task 9: pure PIN-throttle module (`@waitron/identity`)

**Files:**
- Create: `packages/identity/src/pin-throttle.ts`
- Modify: `packages/identity/src/errors.ts` (register `pin.throttled`)
- Modify: `packages/identity/src/index.ts` (barrel)
- Test: `packages/identity/src/pin-throttle.test.ts`

**Interfaces:**
- Produces:
```ts
export interface PinThrottle {
  // throws AppError("pin.throttled", { retryAfterSeconds }) when inside a window; else returns
  check(deviceId: string, personId: string): void;
  recordFailure(deviceId: string, personId: string): void;
  clear(deviceId: string, personId: string): void;   // on success
}
export function createPinThrottle(opts?: { now?: () => number }): PinThrottle
```
Policy (spec §5): 3 free failures per `(deviceId,personId)`, then wait `2^(n-3)` seconds capped at 60 (2,4,8,16,32,60); `check` throws while `now < unlockAt`; a failure past the 3rd sets `unlockAt`; `clear` on success; an entry with no attempt for 15 min is pruned (idle-expiry) so `check` treats it as fresh.

- [ ] **Step 1: Write the failing test.** Injectable clock. Assert: 3 `recordFailure`+`check` cycles do not throw; the 4th window throws `pin.throttled` with `retryAfterSeconds: 2`, then 4, 8, …, capped 60; `clear` resets to zero; advancing the clock 15 min with no attempt resets; the key is `(device,person)` (a different person or device is independent). Register `pin.throttled` reachability: the module does `import "./errors.js"`.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Register the code.** In `packages/identity/src/errors.ts`, next to `pin.invalid`:
```ts
"pin.throttled": { retryAfterSeconds: number };
```

- [ ] **Step 4: Implement** the closure (a `Map<string, {fails: number; unlockAt: number; lastAt: number}>`, pruned on access by the 15-min idle rule). Model the window math on `enrol-rate-limit.ts`.

- [ ] **Step 5: Run to green.** `pnpm --filter @waitron/identity test:coverage`.

- [ ] **Step 6: Commit.** `git commit -s -m "feat(identity): per-(device,person) PIN-attempt throttle"`

### Task 10: `POST /api/session` — throttle + device register

**Files:**
- Modify: `apps/server/src/till-api.ts:515-539` (session route) + the deps wiring where the server constructs singletons (grep `createEnrolRateLimiter` in the boot to place the throttle singleton beside it)
- Test: `apps/server/src/till-api.test.ts` (or the session e2e)

**Interfaces:**
- Consumes: `createPinThrottle` (one singleton per process), `tryReadDevice` (to resolve the device + its `till_id`).

- [ ] **Step 1: Write failing tests.**
  - a wrong PIN 4× on the same `(device,person)` → the 4th returns `pin.throttled` carrying `retryAfterSeconds`, and `loginWithPin` is NOT called on the throttled attempt;
  - a successful login clears the throttle;
  - the session's `till_id` is the DEVICE's register (a handheld bound to register B, box env register A → the created session names B), not `deps.cfg.tillId`;
  - two different persons on the same device throttle independently.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement.** Resolve `device = await tryReadDevice(deps, c)` (the device cookie/header). Before `loginWithPin`: `throttle.check(device.id, personId)` (guard `device` present — a login with no device is already `device.unauthorized` upstream on sale routes, but the session route is device-gated too; confirm and reuse). Pass `tillId: device.tillId` to `loginWithPin`. On a caught `pin.invalid`, `throttle.recordFailure(...)` then rethrow. On success, `throttle.clear(...)`. Ensure the error boundary maps `pin.throttled` → HTTP 429 with the payload.

- [ ] **Step 4: Run to green.** `pnpm --filter @waitron/server test:coverage`.

- [ ] **Step 5: Commit.** `git commit -s -m "feat(server): throttle wrong PINs and key the shift to the device register"`

---

## Phase D — the till UI

### Task 11: PIN pad key order

**Files:**
- Modify: `apps/till/src/widgets/numeric-pad.ts` (`#keys()` — pin mode)
- Test: `apps/till/src/widgets/numeric-pad.test.ts`

- [ ] **Step 1: Failing test.** Assert that in `mode="pin"` the rendered `[data-key]` order is `1,2,3,4,5,6,7,8,9,0,backspace` (top-to-bottom dialpad), and in `mode="decimal"` it stays `7,8,9,4,5,6,1,2,3,.,0,backspace`.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement.** Build the base list in dialpad order and, for decimal mode, reorder to calculator order (or keep two explicit arrays). Keep the `.`-filter for pin mode. Do not change `nextPinValue`/`nextPadValue`.

- [ ] **Step 4: Run to green.** `pnpm --filter @waitron/till test:coverage` (browser — check memory).

- [ ] **Step 5: Commit.** `git commit -s -m "feat(till): phone-dialpad order for PIN entry"`

### Task 12: lock screen rework — remembered operator, keypad-on-select, capped width, Cancel, throttle countdown

**Files:**
- Modify: `apps/till/src/screens/till-lock-screen.ts`
- Modify: `apps/till/src/i18n/strings.ts` (Cancel, "Try again in {n}s", device-name heading; remove the three setup strings if now unused elsewhere)
- Test: `apps/till/src/screens/till-lock-screen.test.ts`

**Interfaces:**
- Consumes: `GET /api/device/me` (device `name`), `pin.throttled` `{ retryAfterSeconds }` from `api.login`.

- [ ] **Step 1: Failing tests.**
  - the heading shows the device name;
  - on connect with a remembered operator (localStorage `waitron.lastOperator.<deviceId>` set to a roster personId), that person is preselected and the keypad is shown immediately;
  - selecting a person shows the keypad (no separate step);
  - a successful login writes `waitron.lastOperator.<deviceId>`;
  - a `pin.throttled` response greys the keypad and shows "Try again in Ns" counting down, re-enabling at 0;
  - the action button reads "Cancel" (was "Back") and clears selection + PIN;
  - the three "Set up as …" affordances are gone.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement.** Add a `deviceId`/`deviceName` property (threaded from `till-app`). Preselect from localStorage in `connectedCallback` after the roster loads (guard: the remembered id must still be in the roster). Render the pad whenever `selected` is set. On `pin.throttled`, set a `throttledUntil` timestamp from `retryAfterSeconds`, disable the pad + submit, and tick a countdown (a `setInterval` cleared on disconnect/success). Cap the form width (`max-width: 24rem; margin-inline: auto`). Rename the action string. Delete `#setupDevice/#setupHandheld/#setupTill` and `.device-setup` markup + the `deviceEnrolled` gating (the front door now lives in boot — Task 13).

- [ ] **Step 4: Wrap localStorage in try/catch** (private windows throw). A failed read → no default; a failed write → ignored.

- [ ] **Step 5: Run to green.** `pnpm --filter @waitron/till test:coverage`.

- [ ] **Step 6: Commit.** `git commit -s -m "feat(till): lock screen — remembered operator, keypad on select, capped width, Cancel, throttle countdown"`

### Task 13: enrol screen (two steps) + boot front door + chooser rework

**Files:**
- Modify: `apps/till/src/main.ts` (drop the `?dev` fork)
- Modify: `apps/till/src/till-app.ts` (boot decision; render chooser/enrol; "Switch device")
- Rename+rework: `apps/till/src/screens/till-device-enrol-screen.ts` → two-step (key → describe); `till-dev-chooser.ts` → `till-device-chooser.ts` (list + "Set up a new device" opening enrol at step 2 with DEMO)
- Modify: `apps/till/src/api/client.ts` (`enrolVerify`, `enrol`, `deviceMe` returns `formFactor`+`name`; drop `mintDevDevice`/`resetDevice`; keep `getDevDevices`)
- Modify: `apps/till/src/api/dev-device.ts` (unchanged; the header mechanism stays)
- Test: the screen tests + `till-app` boot test

**Interfaces:**
- Consumes: Task 8 routes.
- Produces: boot renders — dev+no-tab-device → chooser; not-enrolled → enrol step 1; enrolled kds → kiosk; enrolled other → lock screen with `deviceId`/`deviceName`.

- [ ] **Step 1: Failing tests.**
  - `till-device-chooser`: lists enrolled devices with "Use this device" (writes sessionStorage, navigates `/`); "Set up a new device" is collapsed, expands to the enrol step-2 form, and enrolling writes the new id to this tab's sessionStorage;

  Follow-up (2026-09-07): user review replaced the inline expansion with a cancellable modal,
  centred both front-door forms, and kept `/` until the authenticated shell opens.
  - `till-enrol-screen`: step 1 posts the key to `enrolVerify` and advances with the catalogue; step 2 shows Name + Profile, and a station picker for a kds profile / a register picker for a phone-or-tablet profile / neither for a till profile; "Set up device" posts to `enrol`;
  - `till-app` boot: the four-way decision table (spec §3.1); the dev "Switch device" link clears the tab device and returns to the chooser.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement.** `main.ts`: always `render(<till-app>)` (drop the `?dev` import fork; keep `withDevDeviceHeader`). `till-app` boot: read `?dev`/devMode + `getDevDeviceId()`; branch per the table; thread `deviceName`/`deviceId` into the lock screen; render `<till-device-chooser>` and `<till-enrol-screen>` states. The enrol screen holds `step` (`"key" | "describe"`) and the catalogue; the chooser's "Set up" mounts it pre-advanced to `describe` with `code="DEMO"`. Human labels: map `formFactor` → a display name via a small `t()`-backed helper; never render the raw value. On enrol success in a dev tab, `setDevDeviceId(deviceId)`.

- [ ] **Step 4: Delete** `mintDevDevice`/`resetDevice` client methods and the `DevMintRequest`/`DevMintResult` types; keep `getDevDevices`/`DevDeviceList` (drop its now-unused mint option-sources if the list no longer needs them, but it still needs tills/stations to label rows).

- [ ] **Step 5: Run to green.** `pnpm --filter @waitron/till test:coverage`.

- [ ] **Step 6: Commit.** `git commit -s -m "feat(till): device-chooser front door + two-step enrol; one boot path"`

---

## Phase E — dashboard

### Task 14: generate-key button + per-device hardware editor

**Files:**
- Modify: `apps/dashboard/src/screens/devices-screen.ts`
- Modify: `apps/server/src/device-api.ts` (`PATCH /management-api/devices/:id/hardware`)
- Modify: `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/screens/devices-screen.test.ts`, server route test

**Interfaces:**
- Produces: `PATCH /management-api/devices/:id/hardware { receiptPrinterId?, hasCashDrawer?, cardProvider?, cardReaderId? }` → the updated device (manager only, `till.configure`); a device-row hardware editor; the generate form is one button returning `{ code }`.

- [ ] **Step 1: Failing tests.** The generate form is a single "Generate enrolment key" button (no kind/station/till/profile/hardware fields) that shows the returned code; a device row's hardware editor PATCHes the trio and rejects an unknown `cardProvider`; rows show `name · profile · station-or-register`.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement** the route (an `update(devices).set(...)` scoped to tenant+id, `.returning({id})` → 404 as `device.not_found`; validate `cardProvider` against the known set) and collapse the form; add the hardware editor modelled on the existing row controls.

- [ ] **Step 4: Run to green.** `pnpm --filter @waitron/server test:coverage && pnpm --filter @waitron/dashboard test:coverage` (browser — check memory).

- [ ] **Step 5: Commit.** `git commit -s -m "feat(dashboard): bare enrolment-key button + per-device hardware editor"`

### Task 15: profile form-factor picker + register/device wording

**Files:**
- Modify: the dashboard device-profile create/edit screen + its API client call (`createDeviceProfile`/`updateDeviceProfile` now take `formFactor`)
- Modify: `apps/server/src/management-api.ts:1127,1713…` (the profile POST/PATCH pass `formFactor` through to the store)
- Modify: `apps/dashboard/src/i18n/strings.ts`, `apps/till/src/i18n/strings.ts` ("Till" → "Cash register" everywhere)
- Test: the profile-screen test + the management-api profile route test

**Interfaces:**
- Consumes: `createDeviceProfile`/`updateDeviceProfile` (`formFactor` param, Task 1).

- [ ] **Step 1: Failing tests.** Creating/editing a profile sends `formFactor`; the picker shows human labels (Cash register / Handheld phone / Handheld tablet / Kitchen display) mapped to the four values; the server route persists it; "Till" copy now reads "Cash register".

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement** the picker + thread `formFactor` through the management route + the string renames.

- [ ] **Step 4: Run to green.** `pnpm --filter @waitron/server test:coverage && pnpm --filter @waitron/dashboard test:coverage`.

- [ ] **Step 5: Commit.** `git commit -s -m "feat(dashboard): profile form-factor picker; register/device wording"`

---

## Phase F — dev seeding

### Task 16: `dev:setup` seeds three devices via the real enrol path

**Files:**
- Modify: `apps/server/scripts/dev-setup.ts`
- Test: whatever pins `dev-setup`'s output/effects (or add a light assertion in a dev-setup test if one exists; otherwise a manual `wa-wt reset` verification step)

**Interfaces:**
- Consumes: `verifyPairingCode`/`enrolDevice` with `DEMO`, the seeded profiles + a seeded station.

- [ ] **Step 1: Failing test / check.** After `dev:setup`, three devices exist: a till (with an auto-created register), a handheld (bound to that register), a kitchen display (bound to a seeded station). If no dev-setup test harness exists, write a small real-PG test that runs the seed helper and asserts the three device rows; else document the `wa-wt reset` manual check and assert via `GET /api/dev/devices`.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement.** Replace any direct device insert with three `enrolDevice(tx, cfg, {code: "DEMO", name, profileId, stationId?/registerId?})` calls (devMode). The till seeds its own register; the handheld picks it; the kds picks the seeded station. Update the printed instructions to name the chooser (`/?dev`) and DEMO.

- [ ] **Step 4: Run to green + manual.** `pnpm --filter @waitron/server test:coverage`; then `wa-wt reset` on a worktree and eyeball the chooser at `http://localhost:5190/?dev`.

- [ ] **Step 5: Commit.** `git commit -s -m "feat(server): dev:setup seeds a till, handheld and kitchen display via the real enrol path"`

---

## Phase G — whole-workspace verification

### Task 17: full gate + docs

**Files:**
- Modify: `docs/backlog.md` (area 19 "now" half → landed; note the device_kind→form_factor collapse; PIN-throttle gap closed)
- Modify: `CLAUDE.md` only if a rule was paid for (e.g. a new trap)

- [ ] **Step 1: Whole-workspace gate.** Check memory headroom, then `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`. Fix anything a name-filtered per-package run hid (boot suites, e2e `toEqual` wire bodies, cross-package lists — CLAUDE.md §2).
- [ ] **Step 2: Guards.** `errors-reachable` sees `pin.throttled`/`device.register_*`; `english-only` green; `inmutabilidad` green with the two new triggers; `module-seams`/`module-graph-honesty` unaffected.
- [ ] **Step 3: Update the backlog** in the same change (CLAUDE.md §6). Move area-19's "now" half to landed; record that `device_kind` is gone.
- [ ] **Step 4: Commit.** `git commit -s -m "docs(backlog): device enrolment & login redesign landed; area-19 now-half done"`
- [ ] **Step 5:** Hand to `/finish-branch`.

---

## Self-review (author)

**Spec coverage:** §1 model → Tasks 1–5; §2 enrolment server → Tasks 6–8; §3.1 boot / §3.2 chooser / §3.3 enrol / §3.4 login → Tasks 11–13; §4 dashboard → Tasks 14–15; §5 throttle → Tasks 9–10; §6 session register → Task 10; §3.5 dev seeding → Task 16; §8 testing folded into each task; §9 open questions resolved in Tasks 3 (kindOfFormFactor in layouts) and 7 (register-name collision → reject). No section unmapped.

**Type consistency:** `formFactor: FormFactor` (the `@waitron/layouts` `FORM_FACTORS` union) is used identically across the schema enum, `DeviceProfileRow`, the stores, `kindOfFormFactor`, `enrolDevice`'s return, and `GET /api/device/me`. `DeviceKind` is re-homed to `@waitron/layouts` (Task 3) before the pgEnum is dropped (Task 4). `enrolDevice` input/return in Task 6 matches its use in Tasks 7/8/16. `pin.throttled { retryAfterSeconds }` is defined once (Task 9) and consumed in Tasks 10/12.

**Placeholder scan:** no TBD/TODO; every code step carries concrete SQL/TS or an exact assertion. The two SQL constraint names to confirm against `0001_db_baseline_sql.sql` (Task 4 Step 5) are flagged as a read-first, not a guess.

**Ordering hazard:** Task 4 leaves `packages/db` typecheck-red (existing tests set `deviceKind`) until Task 5 fixes the readers — called out explicitly so a reviewer does not treat it as a regression. Everything downstream of the schema (B–F) depends on A; the phases run in order.
