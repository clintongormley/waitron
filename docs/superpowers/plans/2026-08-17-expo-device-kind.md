# Expo device kind — always-on pass display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `expo_pass` device kind so the KDS-3 pass screen runs always-on (enrolled, no login), reusing device-identity's enrolment/auth and KDS-3's expo verbs.

**Architecture:** `device_kind` gains `expo_pass` (station-less); device-authed expo routes (`requireDevice` + kind assert) call KDS-3's verbs; the expo screen gains device mode; the dashboard pairing generator offers the kind. No new table.

**Tech Stack:** TypeScript, Drizzle + PostgreSQL, Hono, Lit + Vite, Vitest, Testcontainers + PGlite.

**Spec:** [docs/superpowers/specs/2026-08-17-expo-device-kind-design.md](../specs/2026-08-17-expo-device-kind-design.md).

## ⛔ Prerequisites — BLOCKED until device identity-1 + KDS-3 land

Re-verify: device-identity `devices` (+ `device_kind` enum, nullable `station_id`), `generatePairingCode`/`enrolDevice`, `requireDevice`, the Devices screen, `device.unauthorized`; KDS-3 `listExpoQueue`, `fireCourse`/`bumpCourseReady`/`markCourseAway`, `till-expo-screen`.

## Global Constraints

- **English identifiers** — `expo_pass`. No new `SPANISH_WORDS`. UI copy en/es.
- **Domain codes** — `device.forbidden_kind` (403); reuse `device.unauthorized`. `import "./errors.js"`. Never renamed.
- **Additive** — KDS-3's session-gated expo path + the `kds_station` kind are unchanged.
- **Permission** — `device.manage` (device-identity's). Device routes are device-authed.
- **Non-fiscal** — grep receipt.
- **No back-compat / data-migration** (pre-production). **Migration via `db:generate`.** Re-run `inmutabilidad`. Mind the Postgres enum `ADD VALUE`-in-tx caveat (split if needed).
- **Coverage:** db, server → 98/98/98/95; till, dashboard → 95/95/90/88. Real-PG for the CHECK + auth. `TESTCONTAINERS_RYUK_DISABLED=true`. Prove guards by deletion.

## File Structure

**Modified:** device-identity's `devices` schema (enum value + CHECK); `apps/server/src/{device-api.ts, errors.ts}` (enrol kind + expo routes); `apps/till/src/{screens/till-expo-screen.ts, api/client.ts}`; `apps/dashboard/src/screens/devices-screen.ts`; `docs/backlog.md`. **Created:** `packages/db/drizzle/<NNNN>_expo_device_kind.sql`.

---

### Task 1: Schema — `expo_pass` enum value + the station CHECK

- [ ] **Step 1:** Add `'expo_pass'` to the `device_kind` pgEnum; add a CHECK `(kind='kds_station' AND station_id IS NOT NULL) OR (kind='expo_pass' AND station_id IS NULL)`.
- [ ] **Step 2:** `db:generate` → inspect; if `ADD VALUE` is wrapped in a tx with the CHECK's use, split (enum-add migration, then the CHECK). Note `<NNNN>`.
- [ ] **Step 3:** Real-PG: apply; enrolling `expo_pass` with a station is rejected by the CHECK; `inmutabilidad` green. `pnpm --filter @waitron/db test:coverage` (unfiltered).
- [ ] **Step 4:** Commit. `git commit -s -m "feat(db): device_kind expo_pass + station-binding CHECK"`

---

### Task 2: `device.forbidden_kind` + enrol an `expo_pass` device

- [ ] **Step 1:** Failing test — `generatePairingCode({ kind:'expo_pass' })` (no station) → `enrolDevice` creates a station-less `expo_pass` device; `device.forbidden_kind` resolves (403).
- [ ] **Step 2:** Run → FAIL → implement — extend `generatePairingCode`/`enrolDevice` to accept `kind='expo_pass'` (no `station_id`); register the code. PASS.
- [ ] **Step 3:** Coverage. Commit. `git commit -s -m "feat(server): enrol expo_pass devices + device.forbidden_kind"`

---

### Task 3: Device-authenticated expo routes

- [ ] **Step 1:** Failing e2e — an enrolled `expo_pass` device: `GET /api/device/expo/queue` returns the location's expo aggregation; `POST /api/device/expo/orders/:id/courses/:cid/{fire,ready,away}` act; a `kds_station` device hitting these → `device.forbidden_kind` (403); a station device's `/api/device/station` still works (unchanged).
- [ ] **Step 2:** Run → FAIL → implement the device expo group in `device-api.ts`: `requireDevice` → assert `kind==='expo_pass'` (`device.forbidden_kind`) → call KDS-3's `listExpoQueue(cfg, device.locationId)` / `fireCourse` / `bumpCourseReady` / `markCourseAway`. Leave KDS-3's session routes untouched.
- [ ] **Step 3:** Prove the kind gate by deletion. PASS, coverage. Commit. `git commit -s -m "feat(server): device-authed expo routes (expo_pass)"`

---

### Task 4: Expo screen device mode + dashboard kind

- [ ] **Step 1:** Failing tests — the KDS-3 `till-expo-screen` renders device mode (no login) when a `GET /api/device/expo/queue` probe succeeds, an enrol view when it 401s, and device actions call the device routes; the session path still works. The dashboard Devices pairing generator offers `expo_pass` (no station picker).
- [ ] **Step 2:** Run → FAIL → implement (mirror the KDS-1 station display's device mode from device-identity; `TillApi.getDeviceExpoQueue`/`deviceExpoFire`/`deviceExpoReady`/`deviceExpoAway`; the dashboard kind option). a11y both themes.
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(ui): expo screen device mode + dashboard expo_pass enrol"`

---

### Task 5: Fiscal grep, guards, backlog

- [ ] **Step 1:** H2 grep — `grep -rn "expo\|device" packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts` → zero relevant hits. Record.
- [ ] **Step 2:** Guard sweep — `pnpm --filter @waitron/db test:coverage` (unfiltered); `inmutabilidad`; `pnpm lint && pnpm typecheck && pnpm format:check`; root Vitest.
- [ ] **Step 3:** Flip `docs/backlog.md` — expo device kind **BUILT**; the KDS always-on story (station + pass) complete.
- [ ] **Step 4:** Commit. `git commit -s -m "docs(backlog): expo device kind built; chore: H2 grep"`

---

## Self-Review (completed at plan-writing time)

**1. Spec coverage** — §2 enum + CHECK → T1; §3a enrol → T2; §3b device expo routes → T3; §5 screen device mode + §6 dashboard → T4; §4 fiscal → T5. No gaps.

**2. Placeholder scan** — real test/impl throughout; deferrals are the device-identity/KDS-3 re-verification (Prerequisites), the `db:generate` number, and the enum-in-tx split (a concrete T1 step) — all flagged.

**3. Type consistency** — `expo_pass` consistent T1→T2→T3→T4; `device.forbidden_kind` consistent T2/T3; the device expo routes call KDS-3's verbs unchanged; `requireDevice` + the kind assert is the single new guard (T3, proven by deletion). Station-less binding enforced by the CHECK (T1).

**Known risk** (flagged): the device mode mirrors the KDS-1 station display's (device-identity) — re-verify that pattern at execution; the enum `ADD VALUE`-in-tx caveat is handled in T1.
