# Device identity-1 — Always-on station enrolment & authentication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a physical kitchen screen enrol once (a pairing code) and authenticate itself thereafter (an httpOnly device cookie) — no per-person login — scoped to bump only its bound station.

**Architecture:** A `devices` table (kind + station binding + a scrypt-hashed token) and a `device_pairing_codes` table (single-use, TTL-from-`created_at`, consumed by a locking `DELETE…RETURNING` — the WebAuthn-challenge model); an unauthenticated enrol route that redeems a code and sets the cookie; a `requireDevice` guard; device-scoped KDS read/bump routes; and a dashboard Devices screen. **Reuses existing crypto** (scrypt `hashSecret`/`verifySecret`, `timingSafeEqual`, cookie helpers) — writes none.

**Tech Stack:** TypeScript, Drizzle + PostgreSQL (RLS), Hono, `node:crypto` (scrypt/randomBytes/sha256/timingSafeEqual), Lit + Vite, Vitest (+ browser), Testcontainers + PGlite.

**Spec:** [docs/superpowers/specs/2026-08-17-device-identity-1-station-enrolment-design.md](../specs/2026-08-17-device-identity-1-station-enrolment-design.md) — read alongside; every task argues from it.

## ⛔ Prerequisites — BLOCKED until KDS-1 (→ TS-1/FP-1) lands

Device identity binds to a `kitchen_station` and drives KDS-1's station display + verbs. Do not start until KDS-1 has landed. **Re-verify borrowed symbols first** (CLAUDE.md §1):

- KDS-1: `kitchen_stations` (+ its `UNIQUE (tenant_id, id)`), `listStationQueue(cfg, stationId)`, `advanceTicketItem(cfg, itemId, to)` (+ its `ticket_items.station_id`), the till station-display screen (gains device mode), `station.not_found`.
- Reused primitives: `hashSecret`/`verifySecret` (`secret-hash.ts:24-48`), the cookie helpers (`management-session.ts:25-39`, `till-session.ts:17,28,56-58`), `timingSafeEqual` shape (`sync-api.ts:80-88`), the WebAuthn single-use model (`passkey.ts:49-93`), `permissions.ts:7-57` (+ `permissions.test.ts`), `boot.ts:290,340-394`, the `booking-api`/`purchasing-api` `gated()` pattern, the `POST /api/session` unauthenticated-login shape (`till-api.ts:139-151`).

## Global Constraints

- **English identifiers** — `devices`, `device_kind`, `station_id`, `token_hash`, `last_seen_at`, `device_pairing_codes`, `code_sha256`, `enrolled_at`. No new `SPANISH_WORDS`. UI copy en/es.
- **Reuse crypto, write none** — token: `randomBytes(32).toString("base64url")` hashed with `hashSecret`, verified with `verifySecret`. Code: high-entropy 8-char Crockford-base32 (**not** a 6-digit PIN), looked up by indexed `createHash("sha256")`. Cookie via the `management-session` helper shape. No home-grown hashing/compare.
- **Two-tier secrets** (spec §2c): scrypt (salted, slow) for the long-lived token; SHA-256 index for the ephemeral high-entropy code. Never store either plaintext (the code's plaintext is returned once at generation; the token's only in the `Set-Cookie`).
- **Domain error codes** — `device.unauthorized` (401), `device.forbidden_station` (403), `device.pairing_invalid` (400), `device.pairing_expired` (400), `device.not_found` (404); reuse `station.not_found`. `import "./errors.js"`. Never renamed.
- **Permission** — new `device.manage`, admin+manager. **Churn:** update `permissions.test.ts`.
- **Non-fiscal** — no `/api/device/*` route reaches the sale/pay path; grep receipt.
- **Security review before merge** (Task 8) — this is auth infra.
- **No backwards-compat / data-migration** (pre-production). **Migration number via `db:generate`** — never hardcode. Re-run `inmutabilidad`.
- **Coverage:** db, server, identity → **98/98/98/95**; till, dashboard → **95/95/90/88**. RLS/concurrency is a false pass on PGlite — real Postgres for it. `TESTCONTAINERS_RYUK_DISABLED=true`. Prove guards by deletion.

## File Structure

**Created:** `packages/db/src/schema/devices.ts` (+ `.rls.test.ts`); `packages/db/drizzle/<NNNN>_devices.sql` + `<NNNN>_devices_rls.sql`; `apps/server/src/device-session.ts` (cookie helpers + `requireDevice`); `apps/server/src/device-api.ts` (enrol + device + management routes) (+ `.test.ts`); a device service (`packages/identity` or `apps/server`) for generate/enrol; `apps/dashboard/src/screens/devices-screen.ts` (+ tests).

**Modified:** `packages/db/src/schema/index.ts`; `packages/identity/src/permissions.ts` (+ `permissions.test.ts`); `apps/server/src/{boot.ts, errors.ts}`; `apps/till/src/screens/<kds station screen>` (device mode) + `apps/till/src/api/client.ts`; `apps/dashboard/src/{dashboard-app.ts, api/client.ts}`; `docs/backlog.md`.

---

### Task 1: Schema — `devices` + `device_pairing_codes` + migration + RLS

**Files:** create `devices.ts`, `devices.rls.test.ts`; modify `index.ts`; generated `<NNNN>_devices.sql` + custom `<NNNN>_devices_rls.sql`.

- [ ] **Step 1: Write `devices.ts`** — the `device_kind` enum `['kds_station']`; the `devices` table (§2a; `token_hash text`, `active` default true, `last_seen_at` nullable, bare `station_id` uuid, `UNIQUE (tenant_id, id)`); the `device_pairing_codes` table (§2b; `code_sha256 text`, `INDEX (tenant_id, code_sha256)`, bare `station_id`). Register both in `index.ts`.
- [ ] **Step 2: Generate the auto migration** (`db:generate`) — enum + two tables. Verify. Note `<NNNN>`.
- [ ] **Step 3: Custom `<NNNN+1>_devices_rls.sql`** — FORCE RLS + `_tenant_isolation` policy on both; `GRANT SELECT,INSERT,UPDATE ON devices` (no DELETE) and `GRANT SELECT,INSERT,DELETE ON device_pairing_codes` (DELETE for single-use redemption); the two `station_id` composite FKs → `kitchen_stations`; the pairing index. Register in `_journal.json`.
- [ ] **Step 4: RLS tests** (real-PG) — tenant isolation + negative `WITH CHECK` on both; `app_user` can INSERT/UPDATE a device and INSERT/DELETE a pairing code; prove FORCE by deletion.
- [ ] **Step 5: Guards** — `pnpm --filter @waitron/db test:coverage` (unfiltered); `inmutabilidad` (both new tables `relforcerowsecurity = true`).
- [ ] **Step 6: Commit.** `git commit -s -m "feat(db): devices + device_pairing_codes with FORCE RLS"`

---

### Task 2: `device.manage` permission + `device.*` error codes

**Files:** `packages/identity/src/permissions.ts` (+ `permissions.test.ts`); `apps/server/src/errors.ts` (+ its test).

- [ ] **Step 1: Failing test** — `roleHasPermission("manager","device.manage")` true, `("staff",…)` false; the five `device.*` codes resolve to their statuses (401/403/400/400/404). Run → FAIL.
- [ ] **Step 2: Add** `device.manage` to `PERMISSIONS` (`:34`) + `MANAGER`/`ALL` (`:48-57`); update the `permissions.test.ts` catalog assertion; register the codes. Run → PASS. Coverage.
- [ ] **Step 3: Commit.** `git commit -s -m "feat(identity): device.manage + device.* error codes"`

---

### Task 3: Pairing-code generation + device enrolment (crypto, the core)

**Files:** a device service (`apps/server/src/device.ts` or `packages/identity`); `errors.ts`; `.test.ts` (PGlite + real-PG for the race).

**Interfaces:**
- Produces: `generatePairingCode(tx, cfg, { kind, stationId, label }) → { code }`; `enrolDevice(tx, cfg, { code }) → { deviceId, kind, stationId, label, token }` (the raw `token` is handed to the route to set the cookie, never persisted plaintext).
- Consumes: `hashSecret`/`verifySecret` (`secret-hash.ts`), `randomBytes`, `createHash("sha256")`, `station.not_found` (KDS-1).

- [ ] **Step 1: Failing test:**
```ts
it("generates a code, enrols a device, and mints a verifiable token", async () => {
  const tx = pgliteTx(); const cfg = testCfg();
  const st = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
  const { code } = await generatePairingCode(tx, cfg, { kind: "kds_station", stationId: st.id, label: "Pantalla" });
  const dev = await enrolDevice(tx, cfg, { code });
  expect(dev).toMatchObject({ kind: "kds_station", stationId: st.id, label: "Pantalla" });
  const row = await deviceRow(tx, dev.deviceId);
  expect(verifySecret(dev.token, row.tokenHash)).toBe(true);        // scrypt round-trip
  expect(row.tokenHash).not.toContain(dev.token);                    // never plaintext at rest
});
it("rejects an unknown / already-consumed / expired code", async () => {
  await expect(enrolDevice(tx, cfg, { code: "BADCODE99" })).rejects.toMatchObject({ code: "device.pairing_invalid" });
  const { code } = await generatePairingCode(tx, cfg, { kind: "kds_station", stationId: st.id, label: "x" });
  await enrolDevice(tx, cfg, { code });                              // consumes it
  await expect(enrolDevice(tx, cfg, { code })).rejects.toMatchObject({ code: "device.pairing_invalid" }); // single-use
});
```
- [ ] **Step 2: Run — FAIL → implement.** `generatePairingCode`: validate the station (`station.not_found`); `code = base32(randomBytes(5))` (8 chars); INSERT `{ code_sha256: sha256(code), kind, stationId, label }`; return the plaintext `code`. `enrolDevice`: locking `DELETE FROM device_pairing_codes WHERE tenant_id AND code_sha256 = sha256(code) RETURNING` (the `consumeChallenge` shape, `passkey.ts:81-93`); no row → `device.pairing_invalid`; `now - created_at > PAIRING_TTL_MS` → `device.pairing_expired`; `token = randomBytes(32).base64url`; INSERT the device (`token_hash = hashSecret(token)`); return `{ …, token }`.
- [ ] **Step 3: Real-PG single-use race** — two concurrent `enrolDevice` with one code → exactly one device, the other `device.pairing_invalid`; **proven by deletion of the locking DELETE** (both then succeed). PASS.
- [ ] **Step 4: Coverage. Commit.** `git commit -s -m "feat(server): device pairing-code generation + enrolment (scrypt token, single-use code)"`

---

### Task 4: Device cookie + `requireDevice` guard

**Files:** `apps/server/src/device-session.ts` (+ `.test.ts`).

**Interfaces:**
- Produces: `DEVICE_COOKIE`, `setDeviceCookie(c, value, secure)`, `clearDeviceCookie(c)`, `readDeviceCookie(c)`, `requireDevice(deps, c) → { deviceId, kind, stationId }`.
- Consumes: the cookie helpers' shape (`management-session.ts:25-39`), `isUuid` (`till-session.ts:28`), `verifySecret`, the `devices` table.

- [ ] **Step 1: Failing test** (real-PG — DB validation): a valid `${deviceId}.${token}` cookie authenticates and touches `last_seen_at`; a wrong token → `device.unauthorized`; a malformed cookie (no `.`, non-uuid selector) → `device.unauthorized`; an unknown id → `device.unauthorized`; a **revoked** device (`active=false`) → `device.unauthorized` (the differential revocation proof).
- [ ] **Step 2: Run — FAIL → implement.** `setDeviceCookie` = `setCookie(c, DEVICE_COOKIE, value, { httpOnly:true, secure, sameSite:"Strict", path:"/", maxAge: 60*60*24*365 })` (long-lived — §3c). `requireDevice`: `readDeviceCookie` → split on `.` → `isUuid(selector)` (else 401) → `withTenant + asAppUser` fetch `active` device by id → `verifySecret(token, token_hash)` (else 401) → UPDATE `last_seen_at` → return the binding.
- [ ] **Step 3: Run — PASS.** Coverage. **Commit.** `git commit -s -m "feat(server): device cookie + requireDevice guard"`

---

### Task 5: HTTP — enrol + device + management route groups

**Files:** `apps/server/src/device-api.ts` + `boot.ts`; `.test.ts` (real-PG e2e).

**Interfaces:**
- Produces: `mountDeviceApi(app, deps, log)` covering the **unauthenticated** enrol route, the **`requireDevice`** device routes, and the **`device.manage`** management routes; mounted in `boot.ts`.
- Consumes: T3 verbs, T4 guard, KDS-1 `listStationQueue`/`advanceTicketItem`.

- [ ] **Step 1: Failing e2e:**
```ts
it("enrol → authenticated station read → bump → revoke stops the cookie", async () => {
  const st = await stationViaKds("Cocina");
  const { code } = await POST("/management-api/device-codes", { session: managerMgmt, body: { kind:"kds_station", stationId: st.id, label:"P" } }).then(r => r.body);
  const enrol = await POST("/api/device/enrol", { body: { code } });          // sets cookie, no session
  const jar = enrol.cookies;
  expect((await GET("/api/device/station", { cookies: jar })).body.station.id).toBe(st.id);
  // bump one of the station's items:
  expect((await POST(`/api/device/ticket-items/${itemId}/advance`, { cookies: jar, body: { to:"preparing" } })).status).toBe(204);
  // a foreign station's item is 403:
  await expect(POST(`/api/device/ticket-items/${otherStationItem}/advance`, { cookies: jar, body: { to:"preparing" } })).resolves.toMatchObject({ status: 403 });
  await POST(`/management-api/devices/${enrol.body.deviceId}/revoke`, { session: managerMgmt });
  await expect(GET("/api/device/station", { cookies: jar })).resolves.toMatchObject({ status: 401 }); // revoked
});
it("device-codes requires device.manage (401/403)", async () => { /* unauth 401, staff 403, gate-by-deletion */ });
```
- [ ] **Step 2: Run — FAIL → implement** `mountDeviceApi`: the enrol route unauthenticated (mirror `POST /api/session` `:139-151`), setting the cookie from T3's returned token; the device routes calling `requireDevice` first, `GET /api/device/station` → `listStationQueue(cfg, device.stationId)`, `POST /api/device/ticket-items/:id/advance` asserting the item's `station_id === device.stationId` (else `device.forbidden_station` 403) then `advanceTicketItem`; the management routes (`device-codes` generate, `devices` list, `devices/:id/revoke`) `gated("device.manage")`. Mount in `boot.ts` (`:340-394`) with `secureCookies` (`:290`). Add the `device.*` codes to the `STATUS` map.
- [ ] **Step 3: Prove the `device.manage` gate + the revocation by deletion.** Coverage. **Commit.** `git commit -s -m "feat(server): device enrol + device-scoped KDS routes + management"`

---

### Task 6: KDS station display — device mode + enrol view (`apps/till`)

**Files:** the KDS-1 station-display screen + `apps/till/src/api/client.ts` (+ tests).

- [ ] **Step 1: Add + test `TillApi` methods** — `enrolDevice(code)` (→ `POST /api/device/enrol`), `getDeviceStation()`, `deviceAdvance(itemId, to)` (no session). Stub. Run → implement → PASS.
- [ ] **Step 2: Failing screen tests** — when a device cookie is present (probe via `getDeviceStation()` succeeding), the screen renders the station queue in **device mode** (no login/station-picker) and bumps via `deviceAdvance`; when absent (401), it shows an **enrol view** (a code field → `enrolDevice` → reload). The KDS-1 session-gated path still works when logged in.
- [ ] **Step 3: Run — FAIL → implement** the device-mode branch + enrol view (reuse the KDS-1 queue rendering; only the data source + the no-login entry differ). a11y both themes.
- [ ] **Step 4: PASS.** Coverage. **Commit.** `git commit -s -m "feat(till): KDS display device mode + pairing-code enrol view"`

---

### Task 7: Dashboard Devices screen

**Files:** `apps/dashboard/src/screens/devices-screen.ts` (+ tests); `dashboard-app.ts`, `api/client.ts`.

- [ ] **Step 1: `DashboardApi` methods** — `listDevices()`, `createDeviceCode({kind,stationId,label})`, `revokeDevice(id)`. Stub-test → implement → PASS.
- [ ] **Step 2: Failing screen tests** — a Devices list (label · station · status · last-seen); **Generate pairing code** (pick station+label → the returned code is shown **once**, with a copy affordance, and is not re-fetchable); **Revoke** a device. Run → FAIL → implement (list+form pattern; `role="alert"` for errors). Register `"devices"` in the shell. a11y both themes.
- [ ] **Step 3: PASS.** Coverage. **Commit.** `git commit -s -m "feat(dashboard): Devices screen (enrol codes + revoke)"`

---

### Task 8: Security review, fiscal grep, guards, backlog

- [ ] **Step 1: Security review** — run the `security-review` skill (or a dedicated adversarial review pass) over the diff. Confirm: token/code never logged or returned except the one-time code + the `Set-Cookie`; `verifySecret`/`timingSafeEqual` used (no `===` on secrets); cookie `httpOnly`+`Secure`(TLS)+`SameSite=Strict`; single-use + TTL + the **redemption rate-limit** (decide + implement the mechanism here — a per-process attempt cap or a DB counter — the spec §8 open item); revocation is immediate; a device cannot reach any sale/tab/config route. Fix findings.
- [ ] **Step 2: Fiscal grep** — `grep -rn "device" packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts` → **zero hits**. Record in the commit.
- [ ] **Step 3: Guard sweep** — `pnpm --filter @waitron/db test:coverage` (unfiltered); `inmutabilidad`; `pnpm lint && pnpm typecheck && pnpm format:check`; the root Vitest project; confirm `permissions.test.ts` green.
- [ ] **Step 4: Flip the `docs/backlog.md` row** — device identity-1 **BUILT** (PR/issue); note other `device_kind`s (till trust), auto-rotation, remote wipe remain future.
- [ ] **Step 5: Commit.** `git commit -s -m "chore(security): device-identity review + rate-limit; docs(backlog): device identity-1 built"`

---

## Self-Review (completed at plan-writing time)

**1. Spec coverage** — §2a `devices` → T1; §2b pairing codes → T1; §3a generate → T3/T5; §3b enrol → T3/T5; §3c cookie+guard → T4; §3d device routes → T5; §3e management → T5; §4 fiscal → T8; §5a till device mode → T6; §5b dashboard → T7; §6 permission/codes → T2; §7 testing → distributed + T8; §8 security → T8. No gaps.

**2. Placeholder scan** — every code step carries real test/impl code; the only deferrals are the KDS-1 re-verification (Prerequisites), the `db:generate` number, and the **rate-limit mechanism** (explicitly a T8 security-review deliverable, flagged in spec §8, not left vague elsewhere).

**3. Type consistency** — `token`/`token_hash` (raw returned only from T3 to set the cookie, hash at rest) consistent T3→T4→T5; `code`/`code_sha256` consistent T1/T3; `requireDevice → { deviceId, kind, stationId }` consistent T4→T5; `device.manage` + the five `device.*` codes consistent T2→T3→T4→T5; `DEVICE_COOKIE` defined once (T4) and set by the enrol route (T5). Crypto calls (`hashSecret`/`verifySecret`/`sha256`/`randomBytes`) name the exact reused functions throughout.

**Known cross-slice risk** (flagged): the device routes reuse KDS-1's `listStationQueue`/`advanceTicketItem` + `ticket_items.station_id` — re-verify against real KDS-1 code at execution; the `station_id` FKs (T1) target KDS-1's `kitchen_stations`, so the migration sequences after KDS-1's.
