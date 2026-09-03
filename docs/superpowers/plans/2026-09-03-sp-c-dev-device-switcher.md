# SP-C — Dev per-tab device switcher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each browser tab act as a different enrolled device — **in dev only** — so a developer can run a till in one tab and a handheld in another, side by side.

**Architecture:** A third `WAITRON_ENV=dev` value maps to `environment=preproduction` (nothing fiscal changes) and sets a new `config.devMode`. Under `devMode`, an unauthenticated `x-waitron-dev-device: <deviceId>` request header is honoured at the single device-resolution chokepoint (`tryReadDevice`) — deviceId-only, no token, RLS/`active`-scoped — so a switched tab behaves as that device everywhere. A dev-only chooser (reached at `?dev`) lists enrolled devices and mints new ones; picking one stores its id in per-tab `sessionStorage`, which the client sends as the header on every request. Everything is inert (header ignored, dev routes not mounted) outside `devMode`.

**Tech Stack:** TypeScript, Hono (server), Drizzle ORM, Vitest (Node + browser mode), Lit (till client), pnpm workspace.

**Spec:** [docs/superpowers/specs/2026-09-03-sp-c-dev-device-switcher-design.md](../specs/2026-09-03-sp-c-dev-device-switcher-design.md)

## Global Constraints

- **The override is honoured ONLY when `config.devMode === true`** (i.e. `WAITRON_ENV=dev`); it must be byte-for-byte inert in `preproduction` and `production`. This is the whole security story — prove it by deletion.
- **`config.environment` stays two-valued** (`production | preproduction`). Do NOT widen the fiscal enum, the `deployment_environment_ck` CHECK, or the Veri\*Factu `Entorno`. `dev` maps to `preproduction`.
- **No new fiscal behaviour.** The override changes only which enrolled device authenticates; it reuses the unchanged `requireSaleTillId` path. `till_id` is inert to `computeHuella` (SP-A.2 receipt); `nodeId`/`seriesId` stay on the node.
- **Header name:** exactly `x-waitron-dev-device` (lowercase kebab, matching `x-request-id`). **sessionStorage key:** exactly `waitron.devDeviceId`.
- **Error codes are never renamed once shipped.** No new codes in this plan; reuse `device.*` / `management.request_invalid`.
- **Every commit uses `git commit -s`** (CI's `dco` job walks the whole range).
- **Real Postgres, not PGlite,** for anything about RLS / the app role / cross-tenant scoping (PGlite connects as superuser and cannot show tenant scoping). Use `describeEachTarget` only where a suite legitimately needs both.
- **Testcontainers:** run with `TESTCONTAINERS_RYUK_DISABLED=true` locally.

---

## File structure

**Server (`apps/server`):**
- `src/config.ts` — modify `deploymentEnvironment` (accept `dev`→`preproduction`); add `isDevMode(env)`; add `Config.devMode`; set it in `loadConfig`. (Task 1)
- `src/device-session.ts` — add `DEV_DEVICE_HEADER`; the override branch in `tryReadDevice`; thread optional `devMode` through the four wrappers. (Task 2)
- `src/device-api.ts` — `DeviceApiDeps.devMode`; `POST /api/device/reset` (Task 3); the dev-only mount group `GET /api/dev/devices` (Task 4) + `POST /api/dev/devices` (Task 5).
- `src/boot.ts` — thread `config.devMode` into the device-api and till-api mounts; fix the reconstructed `{ db, cfg }` call sites so the override reaches the real routes. (Task 6)
- `scripts/dev-setup.ts` + `scripts/dev-setup.test.ts` — emit `WAITRON_ENV=dev`. (Task 9)

**Client (`apps/till`):**
- `src/api/dev-device.ts` (new) — the `sessionStorage` accessors + the `withDevDeviceHeader` fetch wrapper. (Task 7)
- `src/main.ts` — `?dev` branch → render `<till-dev-chooser>`; wrap `fetch` with `withDevDeviceHeader`. (Task 7)
- `src/api/client.ts` — `getDevDevices()`, `mintDevDevice()`, `resetDevice()` + their local response types. (Task 7)
- `src/screens/till-dev-chooser.ts` (new) — the chooser view (list + mint form + reset). (Task 8)

---

## Task 1: `WAITRON_ENV=dev` → `config.devMode` (fiscal-inert)

**Files:**
- Modify: `apps/server/src/config.ts`
- Test: `apps/server/src/config.test.ts` (add cases; file exists)

**Interfaces:**
- Consumes: `deploymentEnvironment(env: Env): DeploymentEnvironment` (existing, `config.ts:510`); `type Env = Record<string, string | undefined>` (`config.ts:213`); `Config` interface (`config.ts:38`+).
- Produces: `isDevMode(env: Env): boolean` (new export); `Config.devMode: boolean` (new field). Later tasks read `config.devMode`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/src/config.test.ts`:

```ts
import { deploymentEnvironment, isDevMode } from "./config.js";

describe("WAITRON_ENV=dev", () => {
  it("deploymentEnvironment maps dev to preproduction (fiscal-inert)", () => {
    expect(deploymentEnvironment({ WAITRON_ENV: "dev" })).toBe("preproduction");
  });
  it("isDevMode is true only for the literal dev", () => {
    expect(isDevMode({ WAITRON_ENV: "dev" })).toBe(true);
    expect(isDevMode({ WAITRON_ENV: "preproduction" })).toBe(false);
    expect(isDevMode({ WAITRON_ENV: "production" })).toBe(false);
    expect(isDevMode({})).toBe(false);
  });
  it("production and devMode are mutually exclusive for every input", () => {
    for (const raw of ["production", "preproduction", "dev", undefined]) {
      const env = { WAITRON_ENV: raw } as Record<string, string | undefined>;
      const isProd = deploymentEnvironment(env) === "production";
      expect(isProd && isDevMode(env)).toBe(false);
    }
  });
  it("an unknown value still throws server.config_invalid", () => {
    expect(() => deploymentEnvironment({ WAITRON_ENV: "staging" })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/server test config.test -- -t "WAITRON_ENV=dev"`
Expected: FAIL (`isDevMode` is not exported; `deploymentEnvironment("dev")` throws today).

- [ ] **Step 3: Implement**

In `apps/server/src/config.ts`, change `deploymentEnvironment` (add the `dev` case BEFORE the reject) and add `isDevMode`:

```ts
export function deploymentEnvironment(env: Env): DeploymentEnvironment {
  const raw = env.WAITRON_ENV;
  if (isUnset(raw)) return "preproduction";
  // `dev` is a DEV-ONLY input: it enables the dev device switcher (see `isDevMode`) but is
  // fiscally identical to preproduction — the stamp, AEAT endpoints and Stripe mode never see it,
  // so no migration and no widening of the fiscal `DeploymentEnvironment`/`Entorno` union.
  if (raw === "dev") return "preproduction";
  if (raw !== "production" && raw !== "preproduction") {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_ENV",
      reason: "not_a_deployment_environment",
    });
  }
  return raw;
}

/**
 * Whether this host runs in DEV mode — `WAITRON_ENV=dev`, the only input that enables the dev per-tab
 * device switcher (SP-C). Distinct from {@link deploymentEnvironment}, which maps `dev` to
 * `preproduction`: `devMode` is the switch the override header + dev routes gate on, so it is `true`
 * for the literal `dev` alone and `false` for `production`, `preproduction`, and unset. Because it
 * requires `WAITRON_ENV=dev` while `production` requires `WAITRON_ENV=production`, a host is never
 * both production and devMode.
 */
export function isDevMode(env: Env): boolean {
  return env.WAITRON_ENV === "dev";
}
```

Add `devMode: boolean;` to the `Config` interface (beside `environment`, `config.ts:43`), and in the `loadConfig` return object (beside `environment`, `config.ts:~641`) add:

```ts
    devMode: isDevMode(env),
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/server test config.test -- -t "WAITRON_ENV=dev"`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @waitron/server typecheck`
```bash
git add apps/server/src/config.ts apps/server/src/config.test.ts
git commit -s -m "feat(config): accept WAITRON_ENV=dev, map to preproduction + set devMode"
```

---

## Task 2: Dev-override resolution in `tryReadDevice`

**Files:**
- Modify: `apps/server/src/device-session.ts`
- Test: `apps/server/src/device-session.test.ts`

**Interfaces:**
- Consumes: `tryReadDevice(deps, c)`, `requireDevice`, `requireSaleTillId`, `assertNotHandheld`, `assertDeviceCapability` (all in `device-session.ts`); `isUuid` (`till-session.ts`); `DEVICE_COOKIE`, `readDeviceCookie`.
- Produces: `DEV_DEVICE_HEADER = "x-waitron-dev-device"` (new export); the four functions' `deps` grows optional `devMode?: boolean` (default `false`). Existing call sites that pass `{ db, cfg }` keep compiling (devMode → `undefined` → `false` → unchanged behaviour).

- [ ] **Step 1: Write the failing tests**

The suite already has a `probe(handler, deps, cookieValue)` helper (`device-session.test.ts:164`) that runs `handler(deps, c)` inside `GET /probe`. The override needs a second request header, so add a tiny local harness in the test that passes headers directly. Add:

```ts
import { DEV_DEVICE_HEADER, tryReadDevice } from "./device-session.js";

// Runs `tryReadDevice` inside a one-route Hono app, passing an optional dev-override header and/or
// cookie. Mirrors the file's existing `probe` helper but exposes the header.
async function readWithHeaders(
  deps: Parameters<typeof tryReadDevice>[0],
  headers: Record<string, string>,
): Promise<DeviceBinding | null> {
  const app = new Hono();
  app.get("/probe", async (c) => c.json({ binding: await tryReadDevice(deps, c) }));
  const res = await app.request("/probe", { headers });
  return ((await res.json()) as { binding: DeviceBinding | null }).binding;
}

describe("dev-override header", () => {
  // (fixtures: enrol a `till` device A and a `kds_station` device B in the tenant; keep A's cookie
  //  string and both device ids — reuse the suite's existing enrol fixtures.)

  it("is IGNORED when devMode is false (fail-closed) — cookie wins", async () => {
    const binding = await readWithHeaders(
      { db, cfg: { tenantId }, devMode: false },
      { cookie: `${DEVICE_COOKIE}=${deviceACookie}`, [DEV_DEVICE_HEADER]: deviceBId },
    );
    expect(binding?.deviceId).toBe(deviceAId); // NOT deviceBId
  });

  it("is honoured when devMode is true — header wins over cookie, no token needed", async () => {
    const binding = await readWithHeaders(
      { db, cfg: { tenantId }, devMode: true },
      { cookie: `${DEVICE_COOKIE}=${deviceACookie}`, [DEV_DEVICE_HEADER]: deviceBId },
    );
    expect(binding?.deviceId).toBe(deviceBId);
    expect(binding?.kind).toBe("kds_station");
  });

  it("an unknown/foreign/malformed override id is a miss, with NO cookie fallback", async () => {
    for (const bad of ["not-a-uuid", randomUUID(), otherTenantDeviceId]) {
      const binding = await readWithHeaders(
        { db, cfg: { tenantId }, devMode: true },
        { cookie: `${DEVICE_COOKIE}=${deviceACookie}`, [DEV_DEVICE_HEADER]: bad },
      );
      expect(binding).toBeNull();
    }
  });

  it("with no override header, devMode reads the cookie unchanged", async () => {
    const binding = await readWithHeaders(
      { db, cfg: { tenantId }, devMode: true },
      { cookie: `${DEVICE_COOKIE}=${deviceACookie}` },
    );
    expect(binding?.deviceId).toBe(deviceAId);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test device-session.test -- -t "dev-override header"`
Expected: FAIL (`DEV_DEVICE_HEADER` not exported; override not implemented).

- [ ] **Step 3: Implement**

In `device-session.ts`, add the constant near `DEVICE_COOKIE`:

```ts
/**
 * The DEV-ONLY per-tab device override header (SP-C). When this host runs in `devMode` (config), a
 * request carrying `x-waitron-dev-device: <deviceId>` is authenticated AS that device WITHOUT a token
 * — a deliberate dev backdoor that lets one browser run several device identities in separate tabs.
 * NEVER read unless `deps.devMode` is true, so it is byte-for-byte inert in preproduction/production.
 * Lowercase kebab, matching `x-request-id`.
 */
export const DEV_DEVICE_HEADER = "x-waitron-dev-device";
```

Add `devMode?: boolean` to the `deps` parameter type of `tryReadDevice`, `requireDevice`, `requireSaleTillId`, `assertNotHandheld`, and `assertDeviceCapability` (each currently `{ db: Database; cfg: { tenantId: string } }` → `{ db: Database; cfg: { tenantId: string }; devMode?: boolean }`). Then insert the override branch at the TOP of `tryReadDevice`, before the cookie read:

```ts
  // SP-C dev override: in devMode ONLY, an `x-waitron-dev-device: <id>` header authenticates AS that
  // device with NO token check. The header WINS over the cookie and does not fall back to it — an
  // override that names a bad device is a clean miss (`null` → `device.unauthorized`), not a silent
  // switch to the cookie's identity. Resolved by the SAME id-selected, RLS-scoped, `active = true`
  // read the cookie path uses below, minus `verifySecret`.
  if (deps.devMode === true) {
    const override = c.req.header(DEV_DEVICE_HEADER);
    if (override !== undefined) {
      if (!isUuid(override)) return null;
      return withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        const [row] = await tx
          .select({
            tokenHash: devices.tokenHash, // selected for shape parity; NOT verified on this path
            kind: devices.deviceKind,
            stationId: devices.stationId,
            tillId: devices.tillId,
            layoutProfileId: devices.layoutProfileId,
            receiptPrinterId: devices.receiptPrinterId,
            hasCashDrawer: devices.hasCashDrawer,
            cardProvider: devices.cardProvider,
            cardReaderId: devices.cardReaderId,
          })
          .from(devices)
          .where(and(eq(devices.id, override), eq(devices.active, true)));
        if (row === undefined) return null;
        return {
          deviceId: override,
          kind: row.kind,
          stationId: row.stationId,
          tillId: row.tillId,
          layoutProfileId: row.layoutProfileId,
          receiptPrinterId: row.receiptPrinterId,
          hasCashDrawer: row.hasCashDrawer,
          cardProvider: row.cardProvider,
          cardReaderId: row.cardReaderId,
        };
      });
    }
  }
```

(Leave the existing cookie path untouched below it. `tokenHash` is intentionally unused here; if the linter flags it, drop it from this select — it is not needed on the override path.)

- [ ] **Step 4: Run to verify it passes + prove-by-deletion**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test device-session.test -- -t "dev-override header"`
Expected: PASS.
Then delete the `if (deps.devMode === true)` guard line (leaving the body always-on), re-run: the "IGNORED when devMode is false" test must FAIL. Restore the guard; re-run: PASS.

- [ ] **Step 5: Full-file + typecheck + commit**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test device-session.test`
Run: `pnpm --filter @waitron/server typecheck`
```bash
git add apps/server/src/device-session.ts apps/server/src/device-session.test.ts
git commit -s -m "feat(device): honour dev-override header in tryReadDevice under devMode"
```

---

## Task 3: `POST /api/device/reset` (wire `clearDeviceCookie`)

**Files:**
- Modify: `apps/server/src/device-api.ts`
- Test: `apps/server/src/device-api.test.ts` (add a case; file exists)

**Interfaces:**
- Consumes: `clearDeviceCookie(c)` (`device-session.ts:56`); the `run(c, log, fn)` route wrapper already used in this file.
- Produces: route `POST /api/device/reset` → `204`, cookie expired.

- [ ] **Step 1: Write the failing test**

```ts
it("POST /api/device/reset clears the device cookie and 204s", async () => {
  const app = mountForTest(/* existing device-api test harness */);
  const res = await app.request("/api/device/reset", { method: "POST" });
  expect(res.status).toBe(204);
  expect(res.headers.get("set-cookie") ?? "").toMatch(/waitron_device=;.*Max-Age=0/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test device-api.test -- -t "device/reset"`
Expected: FAIL (404 — route not mounted).

- [ ] **Step 3: Implement**

Add `clearDeviceCookie` to the `./device-session.js` import at the top of `device-api.ts`, and mount the route inside `mountDeviceApi` (alongside the enrol route; NOT dev-gated — dropping your own cookie is harmless and `sameSite: Strict`):

```ts
  // ── Reset (drop THIS browser's device identity) ──────────────────────────────────────────────────────
  // Wires `clearDeviceCookie`: the device row is untouched (still active) — the browser simply reverts
  // to un-enrolled and can re-enrol. `sameSite: Strict` means a cross-site POST cannot reach the cookie.
  app.post("/api/device/reset", (c) =>
    run(c, log, async () => {
      clearDeviceCookie(c);
      return c.body(null, 204);
    }),
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test device-api.test -- -t "device/reset"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/device-api.ts apps/server/src/device-api.test.ts
git commit -s -m "feat(device): add POST /api/device/reset wiring clearDeviceCookie"
```

---

## Task 4: Dev-only device LIST endpoint (`GET /api/dev/devices`)

**Files:**
- Modify: `apps/server/src/device-api.ts`
- Test: `apps/server/src/device-api.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `asAppUser`, `devices`, `tills` (from `@waitron/db`); `listStations(tx, cfg)` (`./kitchen.js`); `listProfiles(tx, tenantId)` (`@waitron/layouts`); `DeviceApiDeps` (`device-api.ts:40`).
- Produces: `DeviceApiDeps.devMode: boolean` (NEW, required); route `GET /api/dev/devices` → `{ devices, tills, stations, profiles }`, mounted only when `deps.devMode`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("GET /api/dev/devices (dev-only)", () => {
  it("returns devices + option-sources, tenant-scoped, no token field", async () => {
    const app = mountForTest({ devMode: true /* + enrolled devices, a till, a station, a profile */ });
    const res = await app.request("/api/dev/devices");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.devices[0]).toMatchObject({ id: expect.any(String), kind: expect.any(String) });
    expect(body.devices[0]).not.toHaveProperty("tokenHash");
    expect(body.devices[0]).not.toHaveProperty("token");
    expect(Array.isArray(body.tills)).toBe(true);
    expect(Array.isArray(body.stations)).toBe(true);
    expect(Array.isArray(body.profiles)).toBe(true);
  });
  it("is absent (404) when devMode is false", async () => {
    const app = mountForTest({ devMode: false });
    expect((await app.request("/api/dev/devices")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test device-api.test -- -t "GET /api/dev/devices"`
Expected: FAIL (`DeviceApiDeps.devMode` unknown; route not mounted).

- [ ] **Step 3: Implement**

Add to imports: `tills` to the `@waitron/db` import; `import { listStations } from "./kitchen.js";`; `import { listProfiles } from "@waitron/layouts";`. Add `devMode: boolean;` to `DeviceApiDeps`. Then, inside `mountDeviceApi`, open a dev-only group and add the list route:

```ts
  // ── Dev-only per-tab device switcher surface (SP-C) ──────────────────────────────────────────────────
  // Mounted ONLY in devMode, so outside dev these routes DO NOT EXIST (404) — the same fail-closed
  // shape as the override header. All reads are RLS-scoped (`withTenant` + `asAppUser`); nothing here
  // returns a token or reader credential.
  if (deps.devMode) {
    app.get("/api/dev/devices", (c) =>
      run(c, log, async () =>
        c.json(
          await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
            await asAppUser(tx);
            const deviceRows = await tx
              .select({
                id: devices.id,
                kind: devices.deviceKind,
                label: devices.label,
                tillId: devices.tillId,
                layoutProfileId: devices.layoutProfileId,
                stationId: devices.stationId,
                active: devices.active,
              })
              .from(devices)
              .where(eq(devices.active, true))
              .orderBy(desc(devices.enrolledAt));
            const tillRows = await tx
              .select({ id: tills.id, name: tills.name, locationId: tills.locationId })
              .from(tills);
            const stations = await listStations(tx, deps.cfg);
            const profiles = await listProfiles(tx, deps.cfg.tenantId);
            return {
              devices: deviceRows,
              tills: tillRows,
              stations,
              profiles: profiles.map((p) => ({ id: p.id, name: p.name })),
            };
          }),
        ),
      ),
    );
    // (Task 5 adds POST /api/dev/devices inside this same `if (deps.devMode)` block.)
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test device-api.test -- -t "GET /api/dev/devices"`
Expected: PASS. (Every existing `mountForTest`/`DeviceApiDeps` construction in the test file now needs `devMode`; add it — most pass `false`.)

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @waitron/server typecheck`
```bash
git add apps/server/src/device-api.ts apps/server/src/device-api.test.ts
git commit -s -m "feat(device): dev-only GET /api/dev/devices list + option-sources"
```

---

## Task 5: Dev-only MINT endpoint (`POST /api/dev/devices`, mint-and-adopt)

**Files:**
- Modify: `apps/server/src/device-api.ts`
- Test: `apps/server/src/device-api.test.ts`

**Interfaces:**
- Consumes: `generatePairingCode`, `enrolDevice`, `kindRequiresStation` (`./device.js`, already imported); `requireEnum`, `requireString`, `requireBodyUuid` (`./request-screens.js`, already imported); `deviceKind` (`@waitron/db`, already imported); `readJsonBody`.
- Produces: route `POST /api/dev/devices` → `{ deviceId, kind, stationId, label }`, **no `Set-Cookie`**, mounted only when `deps.devMode`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("POST /api/dev/devices (dev-only mint-and-adopt)", () => {
  it("mints a till device and returns its id with NO Set-Cookie", async () => {
    const app = mountForTest({ devMode: true /* + a till fixture tillId */ });
    const res = await app.request("/api/dev/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "till", label: "Dev till", tillId }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.deviceId).toEqual(expect.any(String));
    expect(body.kind).toBe("till");
    expect(res.headers.get("set-cookie")).toBeNull();
    // adoptable: the override header for the new id now resolves under devMode
  });
  it("reuses the existing binding refusals", async () => {
    const app = mountForTest({ devMode: true });
    const res = await app.request("/api/dev/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "till", label: "No till" }), // till with no tillId
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("device.till_required");
  });
  it("is absent (404) when devMode is false", async () => {
    const app = mountForTest({ devMode: false });
    const res = await app.request("/api/dev/devices", { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test device-api.test -- -t "POST /api/dev/devices"`
Expected: FAIL (route not mounted).

- [ ] **Step 3: Implement**

Inside the `if (deps.devMode)` block from Task 4, add:

```ts
    app.post("/api/dev/devices", (c) =>
      run(c, log, async () => {
        const body = await readJsonBody<{
          kind?: unknown;
          label?: unknown;
          stationId?: unknown;
          tillId?: unknown;
          layoutProfileId?: unknown;
        }>(c);
        // The SAME field screens `POST /management-api/device-codes` uses, so validation cannot drift.
        const kind = requireEnum(body.kind, "kind", deviceKind.enumValues);
        const label = requireString(body.label, "label");
        const optionalUuid = (v: unknown, field: string): string | null =>
          v === undefined || v === null ? null : requireBodyUuid(v, field);
        const stationId = kindRequiresStation(kind)
          ? requireBodyUuid(body.stationId, "stationId")
          : null;
        const tillId = optionalUuid(body.tillId, "tillId");
        const layoutProfileId = optionalUuid(body.layoutProfileId, "layoutProfileId");
        // Mint a code then immediately redeem it, in ONE tenant tx, reusing every binding rule
        // (`device.till_required` / `device.station_required` / `device.binding_invalid`). No cookie is
        // set: the dev override authenticates by id, so the tab adopts the device via sessionStorage.
        const enrolled = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          const { code } = await generatePairingCode(tx, deps.cfg, {
            kind,
            stationId,
            tillId,
            layoutProfileId,
            label,
          });
          return enrolDevice(tx, deps.cfg, { code });
        });
        return c.json(
          {
            deviceId: enrolled.deviceId,
            kind: enrolled.kind,
            stationId: enrolled.stationId,
            label: enrolled.label,
          },
          201,
        );
      }),
    );
```

- [ ] **Step 4: Run to verify it passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test device-api.test -- -t "POST /api/dev/devices"`
Expected: PASS.

- [ ] **Step 5: Coverage + commit**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage device-api.test`
```bash
git add apps/server/src/device-api.ts apps/server/src/device-api.test.ts
git commit -s -m "feat(device): dev-only POST /api/dev/devices mint-and-adopt"
```

---

## Task 6: Boot wiring — thread `config.devMode` to the real routes

**Files:**
- Modify: `apps/server/src/boot.ts`
- Modify: `apps/server/src/device-api.ts` (fix reconstructed call sites), `apps/server/src/till-api.ts` (one reconstructed call site)
- Test: `apps/server/src/boot.test.ts` (add an override e2e; file exists)

**Interfaces:**
- Consumes: `config.devMode` (Task 1); `DeviceApiDeps.devMode` (Task 4); the till-api mount deps object.
- Produces: `/api/device/me` and the sale routes honour the override under devMode. Requires: (a) `mountDeviceApi` receives `devMode: config.devMode` (`boot.ts:923`); (b) the till-api mount deps carries `devMode: config.devMode`; (c) the `{ db: deps.db, cfg: deps.cfg }` reconstructions in `device-api.ts` (`:200/:221/:250`) and `till-api.ts:608` add `devMode: deps.devMode`, so `requireDevice`/`tryReadDevice` see it. Call sites that already pass `deps` wholesale (most of `till-api.ts`) need no change once the mount deps carry `devMode`.

- [ ] **Step 1: Write the failing test**

In `boot.test.ts`, boot a devMode server (`WAITRON_ENV=dev`) with two enrolled devices, then:

```ts
it("under devMode, the x-waitron-dev-device header selects the device on /api/device/me", async () => {
  const res = await app.request("/api/device/me", {
    headers: { [DEV_DEVICE_HEADER]: kdsDeviceId }, // no cookie
  });
  expect(res.status).toBe(200);
  expect((await res.json()).deviceId).toBe(kdsDeviceId);
});
it("a boot NOT in devMode ignores the header (401 with no cookie)", async () => {
  // boot a second app with WAITRON_ENV=preproduction
  const res = await preprodApp.request("/api/device/me", {
    headers: { [DEV_DEVICE_HEADER]: kdsDeviceId },
  });
  expect(res.status).toBe(401);
});
```

(If a full sale e2e already exists in `boot.test.ts`, add one asserting a sale posted with the override header of a till-bound device files under THAT device's `till_id` while `nodeId`/series are unchanged — the §7 boundary. Otherwise leave the sale-path proof to the `till-api` tests and keep this task to `/api/device/me`.)

- [ ] **Step 2: Run to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot.test -- -t "x-waitron-dev-device"`
Expected: FAIL (`mountDeviceApi` deps has no `devMode`; the `/me` route reconstructs `{ db, cfg }` dropping it).

- [ ] **Step 3: Implement**

- `boot.ts`: change `mountDeviceApi(app, { db, cfg: till, secureCookies }, log)` → add `devMode: config.devMode`. Find the till-api mount (`mountTillApi(...)`) deps object and add `devMode: config.devMode` to it (and to its `TillApiDeps` type).
- `device-api.ts`: at `:200`, `:221`, `:250`, change `requireDevice({ db: deps.db, cfg: deps.cfg }, c)` → `requireDevice({ db: deps.db, cfg: deps.cfg, devMode: deps.devMode }, c)`.
- `till-api.ts:608`: change `tryReadDevice({ db: deps.db, cfg: deps.cfg }, c)` → add `devMode: deps.devMode`. (The other till-api guard calls pass `deps` wholesale, so they inherit `devMode` from the mount deps — no change.)

- [ ] **Step 4: Run to verify it passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test boot.test -- -t "x-waitron-dev-device"`
Expected: PASS.

- [ ] **Step 5: Full server suite + typecheck + commit**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`
Run: `pnpm --filter @waitron/server typecheck`
```bash
git add apps/server/src/boot.ts apps/server/src/device-api.ts apps/server/src/till-api.ts apps/server/src/boot.test.ts
git commit -s -m "feat(server): thread config.devMode so the override reaches the live routes"
```

---

## Task 7: Client — per-tab header + `?dev` branch + API methods

**Files:**
- Create: `apps/till/src/api/dev-device.ts`
- Create: `apps/till/src/api/dev-device.test.ts`
- Modify: `apps/till/src/main.ts`
- Modify: `apps/till/src/api/client.ts`

**Interfaces:**
- Consumes: `createInstrumentedFetch(baseFetch, log)` (`@waitron/diagnostics`); `TillApi` constructor (`client.ts:1087`); `#request` (`client.ts:1774`).
- Produces: `readDevDeviceId(): string | null`, `setDevDeviceId(id: string): void`, `DEV_DEVICE_STORAGE_KEY = "waitron.devDeviceId"`, `withDevDeviceHeader(fetchImpl: typeof fetch): typeof fetch` (all in `dev-device.ts`); `TillApi.getDevDevices()`, `TillApi.mintDevDevice(req)`, `TillApi.resetDevice()`.

- [ ] **Step 1: Write the failing tests (`dev-device.test.ts`)**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { withDevDeviceHeader, readDevDeviceId, setDevDeviceId, DEV_DEVICE_STORAGE_KEY } from "./dev-device.js";

beforeEach(() => sessionStorage.clear());

describe("withDevDeviceHeader", () => {
  it("adds x-waitron-dev-device iff sessionStorage holds the key", async () => {
    const base = vi.fn(async () => new Response(null));
    setDevDeviceId("dev-123");
    await withDevDeviceHeader(base as unknown as typeof fetch)("/x");
    const init = base.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get(DEV_DEVICE_HEADER_LOWER)).toBe("dev-123");
  });
  it("omits the header when no id is stored", async () => {
    const base = vi.fn(async () => new Response(null));
    await withDevDeviceHeader(base as unknown as typeof fetch)("/x");
    const init = (base.mock.calls[0][1] ?? {}) as RequestInit;
    expect(new Headers(init.headers).get("x-waitron-dev-device")).toBeNull();
  });
  it("degrades to no header if sessionStorage throws", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const base = vi.fn(async () => new Response(null));
    await expect(withDevDeviceHeader(base as unknown as typeof fetch)("/x")).resolves.toBeInstanceOf(Response);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/till test dev-device.test`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `dev-device.ts`**

```ts
/**
 * Dev-only per-tab device identity (SP-C). The chosen device's id lives in `sessionStorage` (per-tab,
 * so one browser can run several devices in separate tabs) and rides every request as the
 * `x-waitron-dev-device` header, which the server honours ONLY in devMode. Inert wherever the key is
 * unset; every storage access is guarded so a private window / blocked storage degrades to "no
 * override" rather than throwing. This is the FIRST sessionStorage use in the app.
 */
export const DEV_DEVICE_STORAGE_KEY = "waitron.devDeviceId";
const DEV_DEVICE_HEADER = "x-waitron-dev-device";

export function readDevDeviceId(): string | null {
  try {
    const v = sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY);
    return v === null || v === "" ? null : v;
  } catch {
    return null;
  }
}

export function setDevDeviceId(id: string): void {
  try {
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, id);
  } catch {
    /* private window / blocked storage — the tab simply falls back to the cookie identity */
  }
}

/** Wrap a `fetch` so it adds the dev-override header when this tab has a stored device id. */
export function withDevDeviceHeader(fetchImpl: typeof fetch): typeof fetch {
  return (input, init) => {
    const id = readDevDeviceId();
    if (id === null) return fetchImpl(input, init);
    const headers = new Headers(init?.headers);
    headers.set(DEV_DEVICE_HEADER, id);
    return fetchImpl(input, { ...init, headers });
  };
}
```

(Use `DEV_DEVICE_HEADER` in the test in place of the `DEV_DEVICE_HEADER_LOWER` placeholder — import it or inline `"x-waitron-dev-device"`.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/till test dev-device.test`
Expected: PASS.

- [ ] **Step 5: Wire `main.ts` + add `client.ts` methods**

In `main.ts`, wrap the raw `fetch` so the header appears in the diagnostics trail too, and branch on `?dev`:

```ts
import { withDevDeviceHeader } from "./api/dev-device.js";
// ...
const fetchImpl = createInstrumentedFetch(withDevDeviceHeader(fetch), diag);
if (new URLSearchParams(location.search).has("dev")) {
  await import("./screens/till-dev-chooser.js");
  render(html`<till-dev-chooser .api=${new TillApi("", fetchImpl)}></till-dev-chooser>`, app);
} else {
  render(html`<till-app .api=${new TillApi("", fetchImpl)}></till-app>`, app);
}
```

In `client.ts`, add local response types and three methods (bundle rule — types NOT imported from server):

```ts
export interface DevDevice {
  id: string; kind: string; label: string;
  tillId: string | null; layoutProfileId: string | null; stationId: string | null; active: boolean;
}
export interface DevTill { id: string; name: string; locationId: string }
export interface DevStation { id: string; name: string; displayOrder: number; isDefault: boolean; active: boolean }
export interface DevProfile { id: string; name: string }
export interface DevDeviceList { devices: DevDevice[]; tills: DevTill[]; stations: DevStation[]; profiles: DevProfile[] }
export interface DevMintRequest { kind: string; label: string; tillId?: string; stationId?: string; layoutProfileId?: string }
export interface DevMintResult { deviceId: string; kind: string; stationId: string | null; label: string }
```

```ts
  /** SP-C dev chooser: list this venue's enrolled devices + binding option-sources (dev-only route). */
  getDevDevices(): Promise<DevDeviceList> {
    return this.#request<DevDeviceList>("/api/dev/devices", "GET");
  }
  /** SP-C dev chooser: mint-and-adopt a new device (dev-only route). */
  mintDevDevice(req: DevMintRequest): Promise<DevMintResult> {
    return this.#request<DevMintResult>("/api/dev/devices", "POST", req);
  }
  /** SP-C: drop this browser's device cookie identity. */
  resetDevice(): Promise<void> {
    return this.#request<void>("/api/device/reset", "POST");
  }
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @waitron/till typecheck && pnpm --filter @waitron/till test dev-device.test`
```bash
git add apps/till/src/api/dev-device.ts apps/till/src/api/dev-device.test.ts apps/till/src/main.ts apps/till/src/api/client.ts
git commit -s -m "feat(till): per-tab dev-device header, ?dev branch, dev API methods"
```

---

## Task 8: The `<till-dev-chooser>` view

**Files:**
- Create: `apps/till/src/screens/till-dev-chooser.ts`
- Create: `apps/till/src/screens/till-dev-chooser.test.ts`

**Interfaces:**
- Consumes: `TillApi.getDevDevices/mintDevDevice/resetDevice` (Task 7); `setDevDeviceId` (`../api/dev-device.js`); the app's `wt-*` UI primitives (`@waitron/ui`) — follow the pattern in `till-enrol-screen.ts`.
- Produces: `<till-dev-chooser>` custom element with a `.api` property; on pick/mint it writes `sessionStorage` and navigates to `/`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("till-dev-chooser", () => {
  it("lists devices from getDevDevices", async () => {
    const api = fakeApi({ devices: [{ id: "d1", kind: "handheld", label: "Phone", ... }], tills: [], stations: [], profiles: [] });
    const el = await fixture(html`<till-dev-chooser .api=${api}></till-dev-chooser>`);
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain("Phone");
  });
  it("picking a device stores its id and navigates to /", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    // ... click the device row's "use" button ...
    expect(sessionStorage.getItem("waitron.devDeviceId")).toBe("d1");
    expect(assign).toHaveBeenCalledWith("/");
  });
  it("submitting the mint form calls mintDevDevice and adopts the returned id", async () => {
    // ... fill kind=handheld/label/till, submit; assert mintDevDevice called and sessionStorage set to the new id ...
  });
  it("a 404 (dev off) renders the dev-mode-off message", async () => {
    const api = fakeApi(() => Promise.reject({ code: "server.internal" /* 404 → route absent */ }));
    // ... assert the "set WAITRON_ENV=dev" message renders ...
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/till test till-dev-chooser.test`
Expected: FAIL (element not defined).

- [ ] **Step 3: Implement `till-dev-chooser.ts`**

A Lit element modelled on `till-enrol-screen.ts`: on `connectedCallback` (or `firstUpdated`) call `this.api.getDevDevices()` into reactive state (catch → set a `devOff`/error flag so a 404 renders the "dev mode is off — set `WAITRON_ENV=dev`" message). Render (using `wt-*` primitives):
  - a list of `devices`, each row showing kind/label/till/profile and a "use this device" button whose handler runs `setDevDeviceId(id); location.assign("/")`;
  - a mint form: a `kind` picker (`till`/`handheld`/`kds_station`), a `label` field, a `till` picker (from `tills`, shown for `till`/`handheld`), a `station` picker (from `stations`, shown for `kds_station`), an optional `profile` picker (from `profiles`); submit → `this.api.mintDevDevice({...})` → on success `setDevDeviceId(res.deviceId); location.assign("/")`; on a rejected `{ code }` render it inline;
  - a "reset this browser's cookie identity" button → `this.api.resetDevice()`.
Register with `customElements.define("till-dev-chooser", TillDevChooser)`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/till test till-dev-chooser.test`
Expected: PASS.

- [ ] **Step 5: Coverage + commit**

Run: `pnpm --filter @waitron/till test:coverage`
```bash
git add apps/till/src/screens/till-dev-chooser.ts apps/till/src/screens/till-dev-chooser.test.ts
git commit -s -m "feat(till): the ?dev device chooser (list + mint + reset)"
```

---

## Task 9: `dev-setup` emits `WAITRON_ENV=dev`

**Files:**
- Modify: `apps/server/scripts/dev-setup.ts`
- Modify: `apps/server/scripts/dev-setup.test.ts`

**Interfaces:**
- Consumes: `buildDevEnv` (`dev-setup.ts:165`), `renderEnvFile`, `DevEnv` (`dev-setup.ts:83`).
- Produces: the generated `apps/server/.env` carries `WAITRON_ENV=dev`; the deployment stamp is UNAFFECTED (`deploymentEnvironment("dev") === "preproduction"`, Task 1).

- [ ] **Step 1: Update the failing test**

In `dev-setup.test.ts`, change the `sampleEnv` `WAITRON_ENV` from `"preproduction"` to `"dev"` (line 27) and the expected `renderEnvFile` line from `"WAITRON_ENV=preproduction"` to `"WAITRON_ENV=dev"` (line 46). Add:

```ts
it("buildDevEnv sets WAITRON_ENV=dev so the switcher is on under pnpm dev", () => {
  const env = buildDevEnv({ /* the five fiscal ids + locale the existing test uses */ });
  expect(env.WAITRON_ENV).toBe("dev");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/server test dev-setup.test`
Expected: FAIL (still `"preproduction"`).

- [ ] **Step 3: Implement**

In `dev-setup.ts:174`, change `WAITRON_ENV: "preproduction",` → `WAITRON_ENV: "dev",`. Update the header comment (lines 1/15) to note the venue is stamped preproduction while the server runs in dev mode. **Confirm** (read `applyVenue`/the boot stamp) that provisioning stamps `preproduction`, not `dev` — it does, because the stamp derives from `deploymentEnvironment`, which maps `dev`→`preproduction` (Task 1); note this in the comment.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/server test dev-setup.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/scripts/dev-setup.ts apps/server/scripts/dev-setup.test.ts
git commit -s -m "feat(dev-setup): boot pnpm dev with WAITRON_ENV=dev (stamp stays preproduction)"
```

---

## Task 10: Final gate + backlog

**Files:**
- Modify: `docs/backlog.md` (mark SP-C landed once merged — do in the same change that lands it)

- [ ] **Step 1: Run the whole gate**

Run: `pnpm lint && pnpm typecheck && pnpm format:check`
Run (changed packages): `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage && pnpm --filter @waitron/till test:coverage`
Run the tree-wide guards: `pnpm vitest run --coverage scripts/` (english-only, teardown, errors-reachable — a new `x-waitron-dev-device`/`waitron.devDeviceId` string is English; the chooser is under `apps/`, out of the english-only scope, but confirm).

- [ ] **Step 2: Manual smoke (optional, real app)**

`pnpm dev:reset && pnpm dev`, open two tabs at `http://localhost:5190/?dev`, mint a till in one and a handheld in the other, confirm each tab boots its own shell.

- [ ] **Step 3: Update the backlog + open the PR**

Move SP-C to landed in `docs/backlog.md` (row under "Layout designer & device profiles"); note SP-B is now the remaining sub-project. Then push and open the PR per `superpowers:finishing-a-development-branch` / the `finish-branch` skill.

---

## Self-review notes (author)

- **Spec coverage:** §3 → Task 1; §4.1 → Tasks 2+6; §4.2 → Task 4; §4.3 → Task 5; §4.4 → Task 3; §5.1 → Task 7; §5.2/§5.3 → Task 8; §6 → Task 9; §7 boundary → asserted in Task 6; §8 (no new codes) → honoured throughout; §9 testing → folded into each task.
- **Type consistency:** `devMode?: boolean` is the deps shape in Task 2 and the required `DeviceApiDeps.devMode`/mount field in Tasks 4/6; header `x-waitron-dev-device` and key `waitron.devDeviceId` are used verbatim in Tasks 2 and 7; `DevMintResult`/`DevDeviceList` names match between client method and chooser consumer.
- **Open confirmations for the executor:** the exact `mountForTest`/`DeviceApiDeps` constructor in `device-api.test.ts` (add `devMode` to every existing one); the till-api mount deps type name (`TillApiDeps` or similar) for Task 6; the `applyVenue` stamp path in Task 9.
