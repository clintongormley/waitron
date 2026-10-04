# Device equipment and independent drawers — implementation plan

> **For agentic workers:** implement each task with a failing behavioral test first. Use `superpowers:executing-plans` for inline work and the repository's branch finishing workflow.

**Goal:** Let profiles offer receipt printers, slip printers, terminals and cash drawers with explicit defaults, while devices safely select or take over portable equipment.

**Architecture:** Store allowed/default equipment on profiles and explicit choices on devices. One transactional selection service validates profile and location, enforces one holder for portable equipment, and refuses takeover of a terminal with an active payment. Resolve `Use default` without taking possession of a portable item held elsewhere. Drawer selection is independent of receipt printer selection, though a physical drawer may still use a printer's kick transport.

**Tech Stack:** TypeScript, Drizzle/SQLite, Hono, Lit, Vitest database and browser projects; QR scanner path and a hardware-gated NFC probe.

**Spec:** [Devices, menus and service zones](../specs/2026-10-04-devices-menus-and-service-zones-design.md) §§5, 8–10. The written spec, including §9's proposed details, is approved.

## Global constraints

- Build after W97's approved-profile switch and action gates. A238's printer lists and device choices are the baseline; preserve sale, cash and drawer audit behavior while replacing their selection semantics.
- Profile lists/defaults cover receipt printer, card-slip printer, card terminal and cash drawer; each default is in its permitted list or None. A device stores an explicit choice or `Use default`, and the screen shows the resolved result including None.
- Portable equipment has at most one device holder. QR scan takes over immediately; dropdown takeover identifies the holder and requires confirmation. Both paths call the same server operation. A busy terminal cannot move; its active payment stays with its original terminal/device.
- A profile default is a preference, never an automatic takeover. Lock, session expiry, login change and temporary disconnection retain explicit choices. A profile switch keeps only still-permitted choices and releases the rest. No idle-expiry or cash-float model is added.
- NFC requires a probe on intended handhelds; a mock/browser pass is not hardware evidence. QR and dropdown must work without NFC. Printing never opens a drawer; every real drawer open keeps its audited `drawer` job and profile/person gates.
- New tables get classification, generated constraints and migration guards. Do not edit shipped migrations. Inspect changed screens in both themes and at phone width.

## File map and contracts

| Area | Starting point and responsibility |
| --- | --- |
| `packages/db/src/schema/devices.ts`, `device-profile-printers.ts`, `printers.ts`; new equipment schema and migrations | Profile lists/defaults, device explicit choices and portable-holder uniqueness |
| `packages/layouts/src/device-printers.ts`, new `device-equipment.ts` | Read allowed choices, resolve defaults and perform atomic selection/takeover |
| `apps/server/src/device-api.ts`, `device-session.ts`, payment integration | Device-authenticated choice/scan routes; busy-terminal check from actual payment state |
| `apps/server/src/receipt-print.ts`, `receipt-print.test.ts` | Independent drawer resolution and existing audited kick paths |
| `apps/dashboard/src/screens/device-profiles-screen.ts`, `devices-screen.ts`; `apps/till/src/till-app.ts` | Configure lists/defaults; choose, scan, confirm takeover and show holder/disconnection |

Proposed service: `selectDeviceEquipment(tx, deviceId, role, selection, mode)` where `selection` is `default`, `none` or an equipment id and `mode` is `scan` or `confirmed-dropdown` for a held portable item. It returns the resolved id and prior holder. A public QR/NFC tag identifies registered equipment; it is not an authentication credential. Device authentication and profile permission remain server requirements. Trace each current printer and drawer consumer before changing any device field or fallback.

## Review focus

1. A printer change cannot change which drawer a device opens (Task 3).
2. Two devices racing to take one terminal leave one holder and no split assignment (Task 2).
3. An active payment keeps its starting terminal and device through a rejected takeover (Task 2).
4. `Use default` does not silently reclaim equipment another device carries (Task 1).
5. A disconnected selection remains visible, and a profile switch releases only choices the new profile forbids (Tasks 1 and 4).

---

### Task 1: Store lists, defaults and explicit choices

**Files:** `packages/db/src/schema/` equipment tables and migrations; `packages/layouts/src/device-equipment.ts` and tests; `device-printers.ts` and tests.

- [ ] Write real database tests for each of the four roles, None, default not in allowed list, equipment in another location, `Use default`, disconnected choice retained, and profile switch retaining/releasing choices. Run focused layouts/db suites and confirm the new behavior fails.
- [ ] Add profile allowed/default records, device explicit/default mode, and a portable assignment record with a uniqueness constraint on equipment id. A shared fixed device can resolve a default without an exclusive holder. Keep a portable default unassigned when somebody else holds it; report its holder and require explicit takeover. Replace first-usable fallback only after the new resolution works.
- [ ] Generate migrations; inspect inbound keys and triggers before any table rebuild. Run `pnpm --filter @waitron/layouts test -- src/device-equipment.test.ts`, db schema/migration guards, and commit with `git commit -s`.

### Task 2: Make selection and takeover atomic

**Files:** `packages/layouts/src/device-equipment.ts`; `apps/server/src/device-api.ts`, payment state readers and focused tests; `apps/till/src/till-app.ts` tests.

- [ ] Write failing route tests for QR and confirmed dropdown reaching the same assignment, an unconfirmed dropdown takeover refusal, two simultaneous takers, an unauthorized role/profile, a removed registration, and a terminal with a connected payment in progress. Include a working legitimate selection as the negative control.
- [ ] Trace the actual terminal/payment ownership writers before choosing the busy predicate. Inside one `withTransaction`, validate current device/profile, equipment/location/active state, current holder and busy payment, then move a portable holder and clear the prior device's explicit choice. A rejected attempt changes neither assignment nor payment. Send a live update to the former device after commit.
- [ ] Rerun focused device/payment suites, test the race against a real venue database, and commit with sign-off.

### Task 3: Separate drawer choice from printing

**Files:** `apps/server/src/receipt-print.ts`, `receipt-print.test.ts`, `device-session.ts`, bill payment and till sale route suites; `packages/db/src/schema/printers.ts` and equipment schema if needed.

- [ ] Write failing cases: a device selects a portable receipt printer but its independently chosen drawer stays the same; a no-drawer choice opens none; cash and hand-keyed card create one audited drawer job; connected card and document/reprint jobs open none; manual open still requires the existing profile/person gates; dashboard test-open calibration retains its exception.
- [ ] Resolve a drawer from the device's drawer choice/default, not `resolveReceiptPrinter`. Retain the physical printer transport for a drawer attached to a printer, and keep a standalone drawer transport behind the same audited command interface. Trace all callers of `drawerPrinter`, `enqueue*Drawer` and `resolveReceiptPrinter` before removing the old coupling.
- [ ] Rerun focused server/printing suites, inspect the print-job payload and drawer audit row, then commit with sign-off.

### Task 4: Configure and operate equipment

**Files:** profile/device management routes and screens; `apps/till/src/till-app.ts` and device controls; dashboard/till browser/a11y tests; localization; `docs/backlog.md`.

- [ ] Write failing browser cases for profile lists/defaults, current/resolved device choice, disconnection, QR takeover, dropdown confirmation naming the previous device, busy-terminal refusal, `Use default`, and profile switch retention/release. Test lock and new-person login do not clear selections.
- [ ] Implement the controls with shared form primitives and English/Spanish copy. QR decoding and dropdown submit the same authenticated selection request. Leave NFC to Task 5 so this branch can deliver a complete QR/dropdown path without claiming unmeasured hardware support.
- [ ] Run focused browser/a11y tests, inspect both themes and phone width, update the backlog with NFC still pending, and commit with sign-off. During `finish-branch`, run the normal hook and verify current-head CI and migration guards.

### Task 5: Probe and enable NFC on intended handhelds (separate campaign item)

**Files:** `apps/till/src/till-app.ts`, its equipment picker and focused browser tests; hardware probe record in `docs/developers/conventions-ui.md` or the PR.

- [ ] Record the intended handheld model, browser/runtime and available NFC API, then try reading the registered-equipment tag on that hardware. A simulated NFC read proves only the app path, not compatibility. If no intended handheld is available, leave this campaign item blocked on that hardware and do not edit product code.
- [ ] Once the probe works, write a failing browser test showing NFC and QR resolve the same registered equipment id and call the same authenticated selection operation. A rejected or malformed tag changes no assignment. Run it to see the intended failure.
- [ ] Add only the supported NFC reader path, retain QR and dropdown, rerun focused browser/hardware checks, record the measured result, and commit with sign-off.
