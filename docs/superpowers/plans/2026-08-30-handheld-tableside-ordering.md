# Handheld Tableside Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a waiter take and fire orders at the table on an enrolled handheld phone, order-only (never settling payment), reusing the existing tableside flow.

**Architecture:** Add a `handheld` value to the `device_kind` enum (enrolled like a KDS display, but station-less and location-bound). A waiter still PIN-logs-in on top of the device (the first device+session combination). The till SPA gains a handheld mode selected by a kind-aware boot probe, rendering a fixed phone face-set (lock → floor → table-order) shipped as a declarative constant keyed by device kind. Order-only is enforced on the server: a handheld device cookie is refused on the sale/pay/cash routes.

**Tech Stack:** TypeScript, Drizzle ORM + PostgreSQL (Testcontainers + PGlite), Hono (server), Lit web components (till + dashboard), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-handheld-tableside-ordering-design.md` — read it alongside this plan; every task argues from it.

## Global Constraints

- **Order-only is a server-enforced fiscal invariant, not a UI preference** (spec §5, decision 0.1). A handheld must be unable to file a sale even if the client were bypassed. Nothing in this feature writes a `registros_facturacion` row, a `huella`, an invoice number, or a chain link.
- **English identifiers** (CLAUDE.md §3): `handheld`, `HANDHELD_FACES`, `canSettle`, `tryReadDevice`, `getDeviceIdentity`. No new `SPANISH_WORDS`. UI copy is bilingual (en + es i18n keys).
- **Error codes name the domain concept, never renamed once shipped** (CLAUDE.md §3): reuse the `device.*` family; mint exactly one new code, `device.forbidden_action` (403). Grep the `device.*` siblings (`apps/server/src/errors.ts:786-889`) before adding.
- **Permission:** reuse the existing `device.manage` (manager + admin, `packages/identity/src/permissions.ts:59`). No new permission.
- **No backwards-compat / data-migration code** (CLAUDE.md §3, pre-production). Fresh DB every run; schema drops and recreates.
- **Migration numbers come from `db:generate` / `db:generate:custom`, never hand-chosen** (CLAUDE.md/memory Drizzle-rebase note). The next number is `0075` at plan time; if it has moved, take whatever `db:generate` emits and do NOT hand-edit snapshots.
- **Coverage:** `98/98/98/95` for `packages/db` and `apps/server`; `95/95/90/88` for `apps/till` and `apps/dashboard`. Run `pnpm --filter <pkg> test:coverage`.
- **Run `packages/db` unfiltered** and run the tree-wide guards after any schema change: `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`, plus the root guards (`english-only`, `errors-reachable`) via `pnpm vitest run --coverage` from the root. `TESTCONTAINERS_RYUK_DISABLED=true` locally; `pnpm reap` if a run is interrupted.
- **Prove every guard by deletion** (CLAUDE.md §4): remove the check, watch the test fail, restore.
- **Every commit is `git commit -s`** (CLAUDE.md §6).

---

## File Structure

**`packages/db`**
- `src/schema/devices.ts:20` — widen the `deviceKind` pgEnum to `["kds_station", "handheld"]`.
- `drizzle/0075_*.sql` (generated) — `ALTER TYPE "device_kind" ADD VALUE 'handheld'`.
- `drizzle/0076_*.sql` (custom) — a per-kind station CHECK on `devices` and `device_pairing_codes`.
- `src/schema/devices.rls.test.ts` — extend with the CHECK's both-direction proof.

**`apps/server`**
- `src/device.ts` — `generatePairingCode` becomes station-optional per kind; add `kindRequiresStation`.
- `src/device-api.ts` — the `device-codes` route accepts a station-less `handheld`; add `GET /api/device/me`.
- `src/device-session.ts` — refactor `requireDevice` onto a new non-throwing `tryReadDevice`; add `assertNotHandheld`.
- `src/errors.ts:786-889` — register `device.forbidden_action` (403) in the `device.*` cluster.
- `src/till-api.ts` — call `assertNotHandheld` on `POST /api/sales`, `/api/pay`, `/api/sales/:id/reprint`, `/api/drawer/open`; add `device.forbidden_action → 403` to the local STATUS map (`:122`).
- Tests: `src/device.test.ts`, `src/device-api.rls.test.ts` (or a sibling e2e), `src/errors.test.ts`.

**`apps/till`**
- `src/api/client.ts` — add `getDeviceIdentity()` + a `DeviceIdentity` type.
- `src/till-app.ts` — kind-aware boot probe; `handheldMode` state; `HANDHELD_FACES` constant; `#onLoggedIn` lands a handheld on `floor`; `#onSetupHandheld`; a handheld enrol view host.
- `src/screens/till-handheld-enrol-screen.ts` (new) — a minimal "enter pairing code → enrol" view for a fresh handheld.
- `src/screens/till-lock-screen.ts` — a twin "set up as waiter handheld" affordance emitting `setup-handheld`.
- `src/screens/till-table-order-screen.ts` — a `canSettle` prop gating the pay section.
- i18n locale files — `device.setup_handheld`, handheld enrol strings (en + es).

**`apps/dashboard`**
- `src/screens/devices-screen.ts` — a kind picker; the station picker gated to `kds_station`; `#generate` branches for `handheld`.
- `src/api/client.ts` — `createDeviceCode` input `stationId` becomes optional.
- i18n locale files — the kind-picker labels (en + es).

---

## Task 1: `handheld` device kind + per-kind station CHECK (`packages/db`)

**Files:**
- Modify: `packages/db/src/schema/devices.ts:20`
- Create (generated): `packages/db/drizzle/0075_*.sql`
- Create (custom): `packages/db/drizzle/0076_*.sql`
- Test: `packages/db/src/schema/devices.rls.test.ts`

**Interfaces:**
- Produces: the `deviceKind` enum now includes `"handheld"`; a DB CHECK such that `kds_station ⇒ station_id NOT NULL` and `handheld ⇒ station_id NULL`, on both `devices` and `device_pairing_codes`.

- [ ] **Step 1: Widen the enum**

In `packages/db/src/schema/devices.ts:20`:

```ts
export const deviceKind = pgEnum("device_kind", ["kds_station", "handheld"]);
```

- [ ] **Step 2: Generate the enum-add migration**

Run: `pnpm --filter @waitron/db db:generate`
Expected: a new `drizzle/0075_*.sql` containing `ALTER TYPE "public"."device_kind" ADD VALUE 'handheld';` plus the journal/snapshot updates. Do NOT hand-edit the snapshot. If the number is not `0075`, use whatever was emitted.

- [ ] **Step 3: Write the failing CHECK test**

Add to `packages/db/src/schema/devices.rls.test.ts` (real Postgres via the existing harness in that file — RLS/constraints as the app role are a false pass on PGlite, CLAUDE.md §4). Mirror the existing insert style (`:89-90`):

```ts
it("enforces the per-kind station rule on devices", async () => {
  await withTenant(db, tenant, async (tx) => {
    await asAppUser(tx);
    // handheld MUST NOT carry a station
    await expect(
      tx.execute(sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash)
        values (${tenant}, ${location}, 'handheld', ${station}, 'Bad handheld', ${TOKEN_HASH})`),
    ).rejects.toThrow();
    // handheld WITHOUT a station succeeds
    const ok = await tx.execute(sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash)
      values (${tenant}, ${location}, 'handheld', ${null}, 'Good handheld', ${TOKEN_HASH}) returning id`);
    expect(ok.length).toBe(1);
    // kds_station WITHOUT a station is rejected
    await expect(
      tx.execute(sql`insert into devices (tenant_id, location_id, device_kind, station_id, label, token_hash)
        values (${tenant}, ${location}, 'kds_station', ${null}, 'Bad kds', ${TOKEN_HASH})`),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run it to watch it fail**

Run: `pnpm --filter @waitron/db test devices.rls`
Expected: FAIL — the CHECK does not exist yet, so the "bad" inserts do not throw.

- [ ] **Step 5: Write the custom CHECK migration**

Run: `pnpm --filter @waitron/db db:generate:custom` to scaffold `drizzle/0076_*.sql`, then fill it (mirroring the `--custom` style of `drizzle/0061_devices_rls.sql`, statements separated by `--> statement-breakpoint`):

```sql
-- Custom: a device's station presence is tied to its kind. Only kds_station binds a station;
-- handheld (a roving, location-wide waiter device) carries none. drizzle-kit does not model raw
-- CHECK constraints, so this is hand-written. A future device_kind must add its own clause here.
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_station_kind_ck"
  CHECK ((device_kind = 'kds_station' AND station_id IS NOT NULL)
      OR (device_kind = 'handheld' AND station_id IS NULL));--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_station_kind_ck"
  CHECK ((device_kind = 'kds_station' AND station_id IS NOT NULL)
      OR (device_kind = 'handheld' AND station_id IS NULL));
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @waitron/db test devices.rls`
Expected: PASS.

- [ ] **Step 7: Run the tree-wide guards touched by a schema change**

Run: `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (the enum-add touches the `tenant_id` `devices`/`device_pairing_codes` tables) → Expected: PASS (`relforcerowsecurity` still true; the CHECK does not affect RLS).
Run the root guards: `pnpm vitest run --coverage` from the repo root → Expected: `english-only` PASS (`handheld` is English), `errors-reachable` PASS.

- [ ] **Step 8: Full package coverage + commit**

Run: `pnpm --filter @waitron/db test:coverage` → Expected: PASS at 98/98/98/95.

```bash
git add packages/db/src/schema/devices.ts packages/db/drizzle packages/db/src/schema/devices.rls.test.ts
git commit -s -m "feat(db): handheld device_kind + per-kind station CHECK"
```

---

## Task 2: Station-optional pairing per kind (`apps/server/src/device.ts`)

**Files:**
- Modify: `apps/server/src/device.ts:101-144` (`generatePairingCode`)
- Test: `apps/server/src/device.test.ts`

**Interfaces:**
- Consumes: `deviceKind` (Task 1); `requireLiveStation` (`kitchen.ts`), `PAIRING_TTL_MS` (`device.ts:39`).
- Produces: `kindRequiresStation(kind: DeviceKind): boolean`; `generatePairingCode(tx, cfg, input: { kind: DeviceKind; stationId: string | null; label: string }, codeSource?) => Promise<{ code: string }>` — for `kds_station` it validates a live station; for `handheld` it stores `station_id = NULL` and never calls `requireLiveStation`.

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/device.test.ts` (the real-PG suite that already exercises `generatePairingCode`):

```ts
it("mints a station-less handheld pairing code", async () => {
  await withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const { code } = await generatePairingCode(tx, cfg, {
      kind: "handheld",
      stationId: null,
      label: "Waiter phone",
    });
    const [row] = await tx.select().from(devicePairingCodes)
      .where(eq(devicePairingCodes.codeSha256, sha256(code)));
    expect(row.deviceKind).toBe("handheld");
    expect(row.stationId).toBeNull();
  });
});

it("rejects a kds_station pairing code with no station", async () => {
  await withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    await expect(
      generatePairingCode(tx, cfg, { kind: "kds_station", stationId: null, label: "X" }),
    ).rejects.toMatchObject({ code: "station.not_found" });
  });
});
```

- [ ] **Step 2: Run to watch it fail**

Run: `pnpm --filter @waitron/server test device.test`
Expected: FAIL — `stationId: null` is not assignable / `requireLiveStation` is called unconditionally.

- [ ] **Step 3: Implement the per-kind branch**

In `apps/server/src/device.ts`, add near `PAIRING_TTL_MS`:

```ts
/** Which device kinds bind a kitchen station. A handheld is location-wide (spec §D2), so it carries none. */
export function kindRequiresStation(kind: DeviceKind): boolean {
  return kind === "kds_station";
}
```

Rewrite `generatePairingCode`'s signature and station handling:

```ts
export async function generatePairingCode(
  tx: Transaction,
  cfg: TillConfig,
  input: { kind: DeviceKind; stationId: string | null; label: string },
  codeSource: () => string = () => encodePairingCode(randomBytes(PAIRING_CODE_BYTES)),
): Promise<{ code: string }> {
  const requiresStation = kindRequiresStation(input.kind);
  if (requiresStation) {
    if (input.stationId === null) throw new AppError("station.not_found", { stationId: "" });
    await requireLiveStation(tx, cfg, input.stationId);
  }
  const stationId = requiresStation ? input.stationId : null;
  const code = codeSource();
  try {
    await tx.insert(devicePairingCodes).values({
      tenantId: cfg.tenantId,
      locationId: cfg.locationId,
      codeSha256: createHash("sha256").update(code).digest("hex"),
      deviceKind: input.kind,
      stationId,
      label: input.label,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("device.pairing_code_unavailable", {});
    throw error;
  }
  return { code };
}
```

(`station.not_found` is reused from KDS-1 — grep to confirm the exact code and its params before relying on the `{ stationId: "" }` shape; adjust to match.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/server test device.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/device.ts apps/server/src/device.test.ts
git commit -s -m "feat(server): station-optional pairing codes per device kind"
```

---

## Task 3: `device-codes` route accepts a station-less handheld (`apps/server/src/device-api.ts`)

**Files:**
- Modify: `apps/server/src/device-api.ts:241-260` (the `POST /management-api/device-codes` handler)
- Test: `apps/server/src/device-api.rls.test.ts` (the management-route e2e suite)

**Interfaces:**
- Consumes: `kindRequiresStation` (Task 2); `requireEnum`, `requireBodyUuid`, `requireString` (`request-screens.ts`); `generatePairingCode` (Task 2).
- Produces: the route mints a `handheld` code from `{ kind: "handheld", label }` (no `stationId`), and still requires `stationId` for `kds_station`.

- [ ] **Step 1: Write the failing test**

Add to the device-codes e2e suite (`device.manage`-gated, manager session):

```ts
it("mints a handheld code with no station", async () => {
  const res = await app.request("/management-api/device-codes", {
    method: "POST",
    headers: managerHeaders,
    body: JSON.stringify({ kind: "handheld", label: "Waiter phone" }),
  });
  expect(res.status).toBe(201);
  expect((await res.json()).code).toEqual(expect.any(String));
});
```

- [ ] **Step 2: Run to watch it fail**

Run: `pnpm --filter @waitron/server test device-api.rls`
Expected: FAIL — `requireBodyUuid(body.stationId, …)` rejects the missing station.

- [ ] **Step 3: Make the station conditional on kind**

Rewrite the body-screening in the handler (`device-api.ts:245-257`):

```ts
const kind = requireEnum(body.kind, "kind", deviceKind.enumValues);
const stationId = kindRequiresStation(kind)
  ? requireBodyUuid(body.stationId, "stationId")
  : null;
const label = requireString(body.label, "label");
const result = await gated(sessionId, (tx) =>
  generatePairingCode(tx, deps.cfg, { kind, stationId, label }),
);
return c.json(result, 201);
```

- [ ] **Step 4: Run to verify it passes, and that kds still requires a station**

Run: `pnpm --filter @waitron/server test device-api.rls`
Expected: PASS, including the existing `kds_station` cases (a `kds_station` body with no `stationId` still 400s via `requireBodyUuid`).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/device-api.ts apps/server/src/device-api.rls.test.ts
git commit -s -m "feat(server): device-codes route mints station-less handheld codes"
```

---

## Task 4: Kind-aware identity probe `GET /api/device/me` (`apps/server/src/device-api.ts`)

**Files:**
- Modify: `apps/server/src/device-api.ts` (add a route in `mountDeviceApi`)
- Test: `apps/server/src/device-api.rls.test.ts`

**Interfaces:**
- Consumes: `requireDevice` (`device-session.ts`, returns `{ deviceId, kind, stationId }`).
- Produces: `GET /api/device/me → 200 { deviceId, kind, stationId }` for an enrolled device; `401 device.unauthorized` for no/invalid cookie. This is the client boot probe (Task 7).

- [ ] **Step 1: Write the failing test**

```ts
it("reports an enrolled handheld's kind", async () => {
  const { cookie } = await enrolHandheld();           // helper: mint a handheld code, enrol, capture the device cookie
  const res = await app.request("/api/device/me", { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ kind: "handheld", stationId: null });
});

it("401s a request with no device cookie", async () => {
  const res = await app.request("/api/device/me");
  expect(res.status).toBe(401);
  expect((await res.json()).error.code).toBe("device.unauthorized");
});
```

- [ ] **Step 2: Run to watch it fail**

Run: `pnpm --filter @waitron/server test device-api.rls`
Expected: FAIL — the route 404s (not mounted).

- [ ] **Step 3: Add the route**

In `mountDeviceApi`, beside `GET /api/device/station`:

```ts
app.get("/api/device/me", (c) =>
  run(c, log, async () => {
    const device = await requireDevice({ db: deps.db, cfg: deps.cfg }, c);
    return c.json({ deviceId: device.deviceId, kind: device.kind, stationId: device.stationId });
  }),
);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/server test device-api.rls`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/device-api.ts apps/server/src/device-api.rls.test.ts
git commit -s -m "feat(server): GET /api/device/me kind-aware identity probe"
```

---

## Task 5: Pre-fiscal firewall — helper + `device.forbidden_action` + guard on `POST /api/sales`

**Files:**
- Modify: `apps/server/src/device-session.ts` (add `tryReadDevice`, refactor `requireDevice`, add `assertNotHandheld`)
- Modify: `apps/server/src/errors.ts:786-889` (register `device.forbidden_action`)
- Modify: `apps/server/src/till-api.ts` (guard `POST /api/sales`; STATUS map `:122`)
- Test: `apps/server/src/device-session.test.ts`, the sales e2e suite

**Interfaces:**
- Produces: `tryReadDevice(deps, c): Promise<DeviceBinding | null>` (the current `requireDevice` body, returning `null` on any miss instead of throwing); `requireDevice` now calls it and throws `device.unauthorized` on `null` (behaviour identical); `assertNotHandheld(deps, c): Promise<void>` throws `device.forbidden_action` when the caller is an active `handheld` device; the `device.forbidden_action` error code (403).

- [ ] **Step 1: Write the failing firewall test**

In the sales e2e suite (a handheld holds BOTH a device cookie and a valid operator session):

```ts
it("refuses a sale from a handheld device", async () => {
  const { cookie: deviceCookie } = await enrolHandheld();
  const sessionCookie = await loginOperator();           // a real PIN session
  const res = await app.request("/api/sales", {
    method: "POST",
    headers: { cookie: `${deviceCookie}; ${sessionCookie}` },
    body: JSON.stringify({ lines: [], tender: cashTender() }),
  });
  expect(res.status).toBe(403);
  expect((await res.json()).error.code).toBe("device.forbidden_action");
});

it("allows a sale from an ordinary till (no device cookie)", async () => {
  const sessionCookie = await loginOperator();
  const res = await app.request("/api/sales", {
    method: "POST",
    headers: { cookie: sessionCookie },
    body: JSON.stringify(validCounterSale()),
  });
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run to watch it fail**

Run: `pnpm --filter @waitron/server test` (the sales suite)
Expected: FAIL — the handheld sale currently returns 200.

- [ ] **Step 3: Register the error code**

In `apps/server/src/errors.ts`, within the `device.*` cluster (`:786-889`), modelled on `device.forbidden_station`:

```ts
/**
 * A handheld device tried to reach a fiscal/cash route (record a sale, take a payment, reprint, open the
 * drawer). A handheld is ORDER-ONLY by design (spec §5, decision 0.1): it takes and fires orders but never
 * settles — the bill is paid at the fixed till. Enforced on the server so order-only holds even if the
 * client is bypassed. `device.*` names the domain concept (an enrolled device), never the throwing package.
 * Mapped to HTTP 403 by till-api.ts's local STATUS map. Never renamed once shipped.
 */
"device.forbidden_action": { action: string };
```

- [ ] **Step 4: Refactor `requireDevice` onto `tryReadDevice` and add `assertNotHandheld`**

In `apps/server/src/device-session.ts`, extract the current `requireDevice` body into `tryReadDevice`, returning `null` at every point that currently throws `device.unauthorized` (no cookie, malformed split, non-uuid selector, no active row, failed `verifySecret`). Keep the throttled `last_seen_at` update on the success path only:

```ts
export async function tryReadDevice(
  deps: { db: Database; cfg: { tenantId: string } },
  c: Context,
): Promise<DeviceBinding | null> {
  // ...the existing requireDevice body, but `return null` instead of throwing on every miss...
}

export async function requireDevice(
  deps: { db: Database; cfg: { tenantId: string } },
  c: Context,
): Promise<DeviceBinding> {
  const device = await tryReadDevice(deps, c);
  if (device === null) throw new AppError("device.unauthorized", {});
  return device;
}

/** Order-only firewall (spec §5): a handheld device may not reach a fiscal/cash route. Absence of a
 * device cookie (an ordinary till) passes. */
export async function assertNotHandheld(
  deps: { db: Database; cfg: { tenantId: string } },
  c: Context,
  action: string,
): Promise<void> {
  const device = await tryReadDevice(deps, c);
  if (device?.kind === "handheld") throw new AppError("device.forbidden_action", { action });
}
```

Add a `device-session.test.ts` case pinning that `requireDevice` still throws `device.unauthorized` on each miss (behaviour-preserving refactor, CLAUDE.md §"preserve behavioural assertions").

- [ ] **Step 5: Guard `POST /api/sales` + STATUS map**

In `apps/server/src/till-api.ts`, `POST /api/sales` (`:652`), immediately after `requireSession`:

```ts
const { personId } = await requireSession(deps, c);
await assertNotHandheld(deps, c, "record_sale");
```

Add to the local `STATUS` map (`:122`): `"device.forbidden_action": 403,`.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @waitron/server test`
Expected: PASS — handheld sale 403, counter sale 200, and the `requireDevice` miss cases still 401.

- [ ] **Step 7: Prove the guard by deletion**

Comment out the `assertNotHandheld` line, run the firewall test → Expected: the handheld-sale test FAILS (200 instead of 403). Restore it.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/device-session.ts apps/server/src/errors.ts apps/server/src/till-api.ts apps/server/src/device-session.test.ts apps/server/src/errors.test.ts
git commit -s -m "feat(server): pre-fiscal firewall — handheld cannot record a sale"
```

---

## Task 6: Extend the firewall to pay / reprint / drawer-open (`apps/server/src/till-api.ts`)

**Files:**
- Modify: `apps/server/src/till-api.ts` (`POST /api/pay` `:682`, `POST /api/sales/:id/reprint` `:1039`, `POST /api/drawer/open` `:1091`)
- Test: the pay / drawer e2e suites

**Interfaces:**
- Consumes: `assertNotHandheld` (Task 5).

- [ ] **Step 1: Write the failing tests**

One per route — a handheld device cookie + a valid session must 403:

```ts
it.each([
  ["/api/pay", { id: someTabId }],
  ["/api/sales/" + someSaleId + "/reprint", {}],
  ["/api/drawer/open", {}],
])("refuses %s from a handheld", async (path, body) => {
  const { cookie: deviceCookie } = await enrolHandheld();
  const sessionCookie = await loginOperator();
  const res = await app.request(path, {
    method: "POST",
    headers: { cookie: `${deviceCookie}; ${sessionCookie}` },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(403);
  expect((await res.json()).error.code).toBe("device.forbidden_action");
});
```

- [ ] **Step 2: Run to watch them fail**

Run: `pnpm --filter @waitron/server test`
Expected: FAIL on all three.

- [ ] **Step 3: Add the guard after each route's `requireSession`**

```ts
// POST /api/pay (after `const { personId } = await requireSession(deps, c);`)
await assertNotHandheld(deps, c, "pay");
// POST /api/sales/:id/reprint (after `await requireSession(deps, c);`)
await assertNotHandheld(deps, c, "reprint");
// POST /api/drawer/open (after `const { personId, sessionId } = await requireSession(deps, c);`)
await assertNotHandheld(deps, c, "drawer_open");
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS at 98/98/98/95.

- [ ] **Step 5: H2 grep receipt**

Run: `grep -rn "record-sale\|recordTillSale\|computeHuella\|alta" apps/server/src/device*.ts apps/till/src/screens/till-handheld-enrol-screen.ts 2>/dev/null` → Expected: no device/handheld path imports the fiscal builders. Record the command + empty result in the commit body.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/till-api.ts apps/server/src/*.test.ts
git commit -s -m "feat(server): fence pay/reprint/drawer against handheld devices"
```

---

## Task 7: Client — kind-aware boot + handheld mode + face-set (`apps/till`)

**Files:**
- Modify: `apps/till/src/api/client.ts` (add `getDeviceIdentity` + `DeviceIdentity`)
- Modify: `apps/till/src/till-app.ts` (boot probe, `handheldMode`, `HANDHELD_FACES`, `#onLoggedIn`)
- Test: `apps/till/src/till-app.test.ts`

**Interfaces:**
- Consumes: `GET /api/device/me` (Task 4).
- Produces: `TillApi.getDeviceIdentity(): Promise<DeviceIdentity>` where `DeviceIdentity = { deviceId: string; kind: string; stationId: string | null }`; a `handheldMode` boolean the render path reads; `HANDHELD_FACES: Screen[]`.

- [ ] **Step 1: Write the failing test**

In `till-app.test.ts` (the boot suite uses a fake `TillApi`):

```ts
it("boots a handheld into the phone shell and lands on the floor after login", async () => {
  const api = fakeApi({ deviceIdentity: { deviceId: "d1", kind: "handheld", stationId: null } });
  const el = await fixture<TillApp>(html`<till-app .api=${api}></till-app>`);
  await el.updateComplete;
  expect(el).toHaveShadowDom(/* handheld mode: not the counter, shows the lock screen */);
  await el.loginAs("waiter");                 // helper drives #onLoggedIn
  expect(currentScreen(el)).toBe("floor");    // NOT "counter"
});

it("boots an ordinary till to the lock screen (no device)", async () => {
  const api = fakeApi({ deviceIdentity: reject({ code: "device.unauthorized" }) });
  const el = await fixture<TillApp>(html`<till-app .api=${api}></till-app>`);
  await el.updateComplete;
  expect(currentScreen(el)).toBe("lock");
});
```

- [ ] **Step 2: Run to watch it fail**

Run: `pnpm --filter @waitron/till test till-app`
Expected: FAIL — `getDeviceIdentity` does not exist; no handheld mode.

- [ ] **Step 3: Add the client method + type**

In `apps/till/src/api/client.ts`:

```ts
export interface DeviceIdentity {
  deviceId: string;
  kind: string;
  stationId: string | null;
}
```
```ts
  getDeviceIdentity(): Promise<DeviceIdentity> {
    return this.#request<DeviceIdentity>("/api/device/me", "GET");
  }
```

- [ ] **Step 4: Rework the boot probe + add handheld mode**

In `apps/till/src/till-app.ts`, add the seam constant near the `Screen` type:

```ts
/** The phone face-set for a handheld device (spec §6a). Shipped as a constant keyed by device kind; a
 * later slice persists this per device and adds a dashboard editor (spec §9). Lock, then the floor, then
 * per-table ordering — no counter POS, KDS, expo, or schedule. */
const HANDHELD_FACES: Screen[] = ["lock", "floor", "table-order"];
```

Add state beside `deviceMode` (`:195`):

```ts
@state() private handheldMode = false;
```

Replace the DEVICE PROBE block (`:500-516`) with a kind-aware branch. Keep the KDS path prefetching its station (preserves the existing one-read optimization / behaviour); a handheld enters handheld mode; anything else stays on lock:

```ts
try {
  const identity = await this.api.getDeviceIdentity();
  if (identity.kind === "handheld") {
    this.handheldMode = true;            // stay on `lock`; the waiter PIN-logs-in, then lands on floor
  } else if (identity.kind === "kds_station") {
    this.initialDeviceStation = await this.api.getDeviceStation();
    this.deviceMode = true;
    this.screen = "station";
  }
} catch {
  // Not an enrolled device (or a transient probe failure) — remain a normal operator till on `lock`.
}
```

In `#onLoggedIn` (`:542`), land a handheld on the floor (the face-set's post-lock face) instead of the counter:

```ts
this.screen = this.handheldMode ? "floor" : "counter";
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @waitron/till test till-app`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/till/src/api/client.ts apps/till/src/till-app.ts apps/till/src/till-app.test.ts
git commit -s -m "feat(till): kind-aware boot probe + handheld phone shell"
```

---

## Task 8: Client — handheld enrol view + lock-screen affordance (`apps/till`)

**Files:**
- Create: `apps/till/src/screens/till-handheld-enrol-screen.ts`
- Modify: `apps/till/src/till-app.ts` (`#onSetupHandheld`, render the enrol view, wire `setup-handheld`)
- Modify: `apps/till/src/screens/till-lock-screen.ts` (twin affordance)
- Modify: the till i18n locale files (`device.setup_handheld`, enrol strings; en + es)
- Test: `apps/till/src/screens/till-handheld-enrol-screen.test.ts`, `till-lock-screen.test.ts`

**Interfaces:**
- Consumes: `TillApi.enrolDevice(code)` (`client.ts:959`).
- Produces: a `till-handheld-enrol-screen` that on a valid code calls `enrolDevice` and emits `handheld-enrolled`; a `setup-handheld` event from the lock screen; `#onSetupHandheld` showing the enrol view.

- [ ] **Step 1: Write the failing enrol-view test**

```ts
it("enrols on a submitted code and signals success", async () => {
  const api = fakeApi({ enrolDevice: async () => ({ deviceId: "d1", kind: "handheld", stationId: "", label: "Phone" }) });
  const el = await fixture(html`<till-handheld-enrol-screen .api=${api}></till-handheld-enrol-screen>`);
  const done = oneEvent(el, "handheld-enrolled");
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-code]")!.value = "ABCD1234";
  el.shadowRoot!.querySelector<HTMLElement>("[data-enrol]")!.click();
  await done;                       // resolves iff the event fired
});
```

- [ ] **Step 2: Run to watch it fail**

Run: `pnpm --filter @waitron/till test till-handheld-enrol`
Expected: FAIL — the component does not exist.

- [ ] **Step 3: Write the enrol view**

Create `apps/till/src/screens/till-handheld-enrol-screen.ts` — a `wt-input` for the code, a `wt-button`, an error line, `@waitron/ui` primitives, both-theme a11y. On click: `await this.api.enrolDevice(code)` then `dispatchEvent(new CustomEvent("handheld-enrolled", { bubbles: true, composed: true }))`; on throw, show `t("device.enrol_failed")`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/till test till-handheld-enrol`
Expected: PASS.

- [ ] **Step 5: Add the lock-screen twin affordance + host it in the app**

In `till-lock-screen.ts` (beside the `setup-device` button, `:226-234`), add a second `wt-button` emitting `setup-handheld`:

```ts
#setupHandheld(): void {
  this.dispatchEvent(new CustomEvent("setup-handheld", { bubbles: true, composed: true }));
}
```

In `till-app.ts`, add `#onSetupHandheld()` (mirrors `#onSetupDevice`, `:886-896`) setting a `handheldEnrolling` state; render `<till-handheld-enrol-screen>` when it is set; on its `handheld-enrolled` event, re-run `#boot()` (the device cookie is now set → boot detects `handheld`). Wire `@setup-handheld` beside `@setup-device` (`:1424`).

Add the i18n keys `device.setup_handheld`, `device.enrol_failed`, and the enrol-view strings to the en and es locale files.

- [ ] **Step 6: Run the screen suites + a11y**

Run: `pnpm --filter @waitron/till test:coverage`
Expected: PASS at 95/95/90/88, a11y green in both themes.

- [ ] **Step 7: Commit**

```bash
git add apps/till/src/screens/till-handheld-enrol-screen.ts apps/till/src/till-app.ts apps/till/src/screens/till-lock-screen.ts apps/till/src/**/*.test.ts apps/till/src/i18n
git commit -s -m "feat(till): handheld enrol view + lock-screen affordance"
```

---

## Task 9: Client — table-order `canSettle` (hide pay on handheld) (`apps/till`)

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (add `canSettle`, gate the pay section)
- Modify: `apps/till/src/till-app.ts` (`#renderScreen` table-order case passes `.canSettle`)
- Test: `apps/till/src/screens/till-table-order-screen.test.ts`

**Interfaces:**
- Produces: `canSettle: boolean` prop on `till-table-order-screen` (default `true`); when `false`, the pay `<section class="pay">` (`:599-606`) is not rendered.

- [ ] **Step 1: Write the failing test**

```ts
it("hides the pay section when settlement is disabled", async () => {
  const el = await renderTableOrder({ canSettle: false });
  expect(el.shadowRoot!.querySelector("section.pay")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-tab-total]")).not.toBeNull();  // total stays visible
});
it("shows the pay section by default", async () => {
  const el = await renderTableOrder({});
  expect(el.shadowRoot!.querySelector("section.pay")).not.toBeNull();
});
```

- [ ] **Step 2: Run to watch it fail**

Run: `pnpm --filter @waitron/till test till-table-order`
Expected: FAIL — no `canSettle`; the pay section always renders.

- [ ] **Step 3: Add the prop and gate the section**

In `till-table-order-screen.ts`, add beside the other properties (`:316`):

```ts
@property({ type: Boolean }) canSettle = true;
```

In `#drawer(pending)` (`:599-606`), wrap the pay section:

```ts
${this.canSettle
  ? html`<section class="pay"
      @confirm-payment=${(event: Event) => this.#onTenderConfirm(event)}
      @park-order=${(event: Event) => this.#onTenderPark(event)}>
      <h2>${t("table.pay_title")}</h2>
      <till-tender-pay .store=${this.#payStore} .busy=${this.busy}></till-tender-pay>
    </section>`
  : nothing}
```

In `till-app.ts` `#renderScreen` table-order case (`:1517-1527`), add:

```ts
.canSettle=${!this.handheldMode}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/till test:coverage`
Expected: PASS at 95/95/90/88.

- [ ] **Step 5: Prove by deletion**

Remove the `.canSettle=${!this.handheldMode}` binding, run the handheld boot+order test → the pay section reappears on a handheld. Restore.

- [ ] **Step 6: Commit**

```bash
git add apps/till/src/screens/till-table-order-screen.ts apps/till/src/till-app.ts apps/till/src/screens/till-table-order-screen.test.ts
git commit -s -m "feat(till): order-only handheld hides the pay section"
```

---

## Task 10: Dashboard — handheld kind in the pairing generator (`apps/dashboard`)

**Files:**
- Modify: `apps/dashboard/src/screens/devices-screen.ts` (kind picker; station gated to `kds_station`; `#generate` branch)
- Modify: `apps/dashboard/src/api/client.ts:1376-1380` (`createDeviceCode` `stationId` optional)
- Modify: dashboard i18n locale files (kind-picker labels; en + es)
- Test: `apps/dashboard/src/screens/devices-screen.test.ts` (+ `.a11y`)

**Interfaces:**
- Consumes: `POST /management-api/device-codes` accepting a station-less handheld (Task 3).
- Produces: `createDeviceCode(input: { kind: string; stationId?: string; label: string })`.

- [ ] **Step 1: Write the failing test**

```ts
it("generates a handheld code with no station picker", async () => {
  const created: unknown[] = [];
  const api = fakeApi({ createDeviceCode: async (i) => { created.push(i); return { code: "XYZ" }; } });
  const el = await renderDevices(api);
  selectKind(el, "handheld");
  expect(el.shadowRoot!.querySelector('[data-test="station-select"]')).toBeNull();  // station hidden
  setLabel(el, "Waiter phone");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="generate"]')!.click();
  await el.updateComplete;
  expect(created).toEqual([{ kind: "handheld", label: "Waiter phone" }]);           // no stationId
});
```

- [ ] **Step 2: Run to watch it fail**

Run: `pnpm --filter @waitron/dashboard test devices-screen`
Expected: FAIL — no kind picker; `#generate` blocks on an empty `selectedStation` and always sends `kds_station` + `stationId`.

- [ ] **Step 3: Loosen the client type**

In `apps/dashboard/src/api/client.ts:1376`:

```ts
createDeviceCode(input: { kind: string; stationId?: string; label: string }): Promise<{ code: string }> {
  return this.#request<{ code: string }>("/management-api/device-codes", "POST", input);
}
```

- [ ] **Step 4: Add the kind picker + gate the station + branch `#generate`**

In `devices-screen.ts`: add `@state() private kind = "kds_station";` and a native token-styled `<select>` (kind: *Pantalla cocina* `kds_station` / *Móvil camarero* `handheld`) above the station field; render the station `<label class="field">` only when `this.kind === "kds_station"`. Rewrite `#generate` (`:233-250`):

```ts
async #generate(): Promise<void> {
  this.errorKey = null;
  const label = this.label.trim();
  if (label === "") return;
  const needsStation = this.kind === "kds_station";
  if (needsStation && this.selectedStation === "") return;
  try {
    const { code } = await this.api.createDeviceCode(
      needsStation ? { kind: this.kind, stationId: this.selectedStation, label } : { kind: this.kind, label },
    );
    this.generatedCode = code;
    this.copied = false;
    this.label = "";
    await this.#reloadDevices();
  } catch (error) {
    this.errorKey = codeOf(error);
  }
}
```

Add the kind-label i18n keys (en + es).

- [ ] **Step 5: Run to verify it passes + a11y both themes**

Run: `pnpm --filter @waitron/dashboard test:coverage`
Expected: PASS at 95/95/90/88, a11y green in both themes.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/screens/devices-screen.ts apps/dashboard/src/api/client.ts apps/dashboard/src/screens/devices-screen.test.ts apps/dashboard/src/i18n
git commit -s -m "feat(dashboard): pairing generator offers the handheld kind"
```

---

## Task 11: Closeout — full guards, backlog follow-ups

**Files:**
- Modify: `docs/backlog.md` (two follow-ups + the handheld row)

- [ ] **Step 1: Run the whole gate**

Run: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`
Then the coverage + guard runs the four-command gate does NOT cover (CLAUDE.md §2): `pnpm --filter @waitron/db test:coverage` (unfiltered), `pnpm --filter @waitron/server test:coverage`, `pnpm --filter @waitron/till test:coverage`, `pnpm --filter @waitron/dashboard test:coverage`, `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`, and the root guards (`pnpm vitest run --coverage`).
Expected: all PASS.

- [ ] **Step 2: Add the backlog follow-ups**

In `docs/backlog.md`, under the appropriate section, add: (a) *handheld live updates (SSE/WebSocket)* (spec decision 0.4 — the app is pull-only today; multiple waiters on one table see stale data until refetch); (b) *configurable per-device layout editor* (spec §9 — persist the `HANDHELD_FACES` shape per device + a dashboard editor, and optionally make the table-order screen layout-driven). Mark the handheld tableside slice as landed once the PR merges.

- [ ] **Step 3: Commit**

```bash
git add docs/backlog.md
git commit -s -m "docs(backlog): handheld live-updates + configurable per-device layout follow-ups"
```

- [ ] **Step 4: Hand off to finishing-a-development-branch**

Use the finish-branch flow (simplify → review → rebase → PR → CI + Copilot). Note for review: the security-adjacent surface (a new `device_kind` + the pre-fiscal firewall) — flag the firewall's prove-by-deletion test and the H2 grep in the PR description.

---

## Self-Review

**Spec coverage:** §2 data model → Task 1. §3 enrolment → Tasks 2–3. §4 device+session combo → Tasks 7–8 (device cookie selects shell; PIN session unchanged). §5 firewall → Tasks 5–6. §6a face-set → Task 7 (`HANDHELD_FACES`). §6b kind-aware probe → Tasks 4, 7. §6c enrol → Task 8. §6d `canSettle` → Task 9. §6e phone polish → folded into Tasks 7–9's a11y/render (a dedicated polish pass can be added if review finds gaps). §7 server summary → Tasks 2–6. §8 conventions/migration → Tasks 1, 5. §9 seam → Task 7 (constant) + Task 11 (backlog). §10 testing → each task's TDD + Task 11. §11 sequencing → tasks ordered DB → server → client → dashboard.

**Placeholder scan:** no TBD/TODO; each code step carries real code. Two spec "verify before coding" items are handled: the fenced-route set is enumerated (Tasks 5–6); the boot-probe endpoint is decided (`GET /api/device/me`, Task 4). The `station.not_found` param shape (Task 2, Step 3) is flagged to grep-confirm.

**Type consistency:** `DeviceBinding` (`{ deviceId, kind, stationId }`) flows from `tryReadDevice` (Task 5) through `requireDevice` and `GET /api/device/me` (Task 4) to the client `DeviceIdentity` (`{ deviceId, kind, stationId }`, Task 7). `kindRequiresStation` is defined in Task 2 and consumed in Task 3. `assertNotHandheld` is defined in Task 5 and reused in Task 6. `canSettle` is defined in Task 9 and passed from `handheldMode` (Task 7). `handheldMode` is defined in Task 7 and read in Tasks 8–9.
