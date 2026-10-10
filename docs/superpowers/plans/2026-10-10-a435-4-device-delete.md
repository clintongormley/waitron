# A435 step 4: Device Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. An implementer that passes about 150 tool calls with its task unfinished stops at a passing (or cleanly red) point, commits, and returns a handover: what is done, what is left, the files, and each check's state. A fresh implementer continues from it.

**Goal:** Add a permanent Delete beside Disable for devices. Delete refuses while a payment is in progress on the device, signs everyone out of it and ends the rest of its live work, removes its settings, and keeps the device row so history still names it. It reuses step 2's impact read, delete shape and confirmation dialog.

**Architecture:** The `devices` row gains `deleted_at`. A delete also switches the row off (`active = false`), so every read that already skips disabled devices skips deleted ones unchanged. One server module, `apps/server/src/device-delete.ts`, owns a single rules function that both the impact read and the delete call. The delete runs that function again inside the request's one `withTransaction` and acts on it. The few reads that deliberately include disabled devices learn to skip deleted ones. The dashboard reuses `wt-delete-dialog` (`packages/ui/src/components/wt-delete-dialog.ts`) with its own copy, following the printers screen's request handling.

**Tech Stack:** TypeScript, Drizzle on SQLite (drizzle-kit for migrations), Hono, Lit, Vitest (real venue databases; Chromium for the dashboard).

**Spec:** [docs/superpowers/specs/2026-10-08-delete-and-archive-design.md](../specs/2026-10-08-delete-and-archive-design.md). This plan builds "The shared model", "Each kind → Devices" and "Testing", for devices only. The pattern it follows is [the printer plan](2026-10-09-a435-2-printer-delete.md) and its landed code (#1514, `ad64b10be`).

## Global Constraints

- "Deletion is a permanent deleted state, not row removal." No `DELETE FROM devices` anywhere.
- "Disable stays beside Delete for hardware only." Disable (`POST /management-api/devices/:id/revoke`) keeps its behaviour for a device whose `deleted_at` is null, and so does a disabled device coming back.
- "A deleted record cannot be enabled, edited or brought back. A read or write that names one by id answers the kind's existing `*.not_found` code": for devices that is `device.not_found` (`apps/server/src/errors.ts:745`).
- "The delete recomputes the same impact inside ONE `withTransaction` and acts on it." Counts shown in the dialog are never used as input to the delete.
- "No fiscal, sales or hash-chained table is touched, and no history column loses its database link." The golden huella test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`, `GOLDEN` at :612, asserted at :697) and `packages/fiscal-verifactu/src/inmutabilidad.test.ts` must pass UNEDITED, and `git diff ad64b10be -- packages/fiscal-verifactu` must stay empty.
- The dialog shows refusals first, then work that will end, then settings that will be removed, then "This can't be undone." It names the device in bold (the shared dialog does this from `impact.target.name`). Its Delete stays disabled while any refusal stands.
- "Each delete route requires the same permission as editing that kind today": `device.manage` (`apps/server/src/device-api.ts:124`).
- Codes are reused, never invented for the same concept: `device.payment_in_progress`, `device.not_found`, `join_request.not_found`, `device.join_stale`. This step adds no new error code.
- Migrations come from drizzle-kit only. Do not hardcode the number and do not hand-edit generated SQL, snapshots or `_journal.json`.
- Failing test first for every behaviour (superpowers:test-driven-development). Tests that expect a refusal catch it OUTSIDE `withTransaction`. Statements in one transaction are awaited one after another, never with `Promise.all`.
- Every commit uses `git commit -s`, with a plain-English message. Never use `--no-verify`. Each task is a separate commit on `feat/a435-4-device-delete`.
- Dashboard copy is EN and ES, as short as keeps the meaning (owner, 2026-10-09).

## Review Focus

1. **A payment started between the impact read and the delete.** The dialog showed no refusal, but a card payment began on the device after that. The delete must refuse with `device.payment_in_progress` and write nothing. Test: Task 3, "a refusal created between the read and the delete".
2. **A knock that proved the device before the delete and writes after it.** `provenDisabledDevice` runs outside any transaction (`apps/server/src/join-requests.ts:228-240`). If the delete commits before `createJoinRequest` re-reads the row (:131-137), the knock must answer `device.join_stale` and must not write the new token onto the deleted row (:207-208). Test: Task 4.
3. **A profile save after a device was deleted.** `setProfileKitchenScreens` narrows every device on the profile, disabled ones included (`packages/venue-service/src/kitchen-screens.ts:159-183`), and reports each narrowed device to the dashboard. It must neither write removal rows for a deleted device nor report one. Test: Task 5.
4. **A printer delete after a device was deleted.** The printer impact's "devices using a default" list (`apps/server/src/printer-delete.ts:108-131`) finds devices through their profile and does not filter on `active`. It must not name a deleted device. Test: Task 5.
5. **The same browser after a delete, in dev mode as well.** In dev mode a disabled device's knock re-enables it at once (`docs/developers/conventions-ui.md:567-570`). A deleted device's browser must arrive as a NEW device with a new id, and the old row must stay deleted. Test: Task 4.

---

## Starting point and overlap

Base: `main` `ad64b10be` (A435 step 2, #1514). The inventory below was **read, not run**, at that commit, on 2026-10-10. Each task re-checks the lines it touches before editing.

**Step 3 (card readers)** is being built in parallel on its own branch and adds `deleted_at` to `card_readers`. This plan changes no card-reader code except the device-side rows a device delete must remove (`device_card_readers`, `card_reader_holders`) and the device-existence check on `PUT /management-api/payments/devices/:id/reader`. If step 3 lands first, rebase onto it. A migration-number collision is fixed by regenerating (CLAUDE.md §3: reset `packages/db/drizzle` to main's state, regenerate, then run the regeneration guard list in Task 1). Files both branches may touch: `apps/server/src/payments-api.ts`, `apps/dashboard/src/api/{client,live-queries}.ts`, `apps/dashboard/src/i18n/{strings,codes}.ts`, `docs/developers/design-system.md`, `docs/backlog.md`. After a rebase, review the full changed range of those files, not only the conflict hunks.

## Verified inventory: every link to `devices.id`

Found with `rg -n "devices\.id" packages apps -g '*.ts' -g '!*.test.ts' | rg "references|foreignColumns"` and `rg -n '"[a-z_]*device_id"' packages -g '**/schema/**'`, at `ad64b10be`. The classification follows the spec's three kinds of link.

| Table and column | Pointer | Kind | What the delete does |
| --- | --- | --- | --- |
| `payments.device_id`, state `attempting`/`initiated` | `packages/payments/src/schema/payments.ts:53`; states `packages/payments/src/provider.ts:25-28` | Live work | **Refuses** `device.payment_in_progress` |
| `bill_payments.device_id`, state `pending` | `packages/db/src/schema/bill-payments.ts:23,55` | Live work | **Refuses** `device.payment_in_progress` |
| `bill_payment_refunds.device_id`, state `pending` | `packages/db/src/schema/bill-payments.ts:24,157` | Live work | **Refuses** `device.payment_in_progress` |
| `sessions.device_id`, open while `ended_at` is null | `packages/identity/src/schema/sessions.ts:18-22` | Live work | **Ended** with `endDeviceSessions` (`packages/identity/src/login.ts:69-74`), as Disable does (`apps/server/src/device-api.ts:685`) |
| `printer_holders.device_id` | `packages/db/src/schema/printer-holders.ts:11,21-25` | Live work (equipment held) | **Ended** with `releaseDevice` (`apps/server/src/device-equipment.ts:105-108`), as Disable does (`device-api.ts:686`) |
| `card_reader_holders.device_id` | `packages/payments/src/schema/card-reader-holders.ts:10,21-24` | Live work (equipment held) | **Ended** with `releaseDevice`, as above |
| `join_requests` row whose `id` is the device's id, `kind = 'device'` | `packages/db/src/schema/join-requests.ts:32-72`; `apps/server/src/join-requests.ts:138-143,193` | Live work (a request to come back) | **Ended**: this node's row is deleted, and the in-memory pairing claim is dropped after commit |
| `device_made_here_stations.device_id` | `packages/db/src/schema/device-made-here-stations.ts:7-17` | Settings | **Removed** |
| `device_approved_profiles.device_id` | `packages/db/src/schema/device-approved-profiles.ts:11-26` | Settings | **Removed** |
| `device_card_readers.device_id` | `packages/payments/src/schema/device-card-readers.ts:6-19` | Settings | **Removed** |
| `device_kitchen_screens.device_id` (its `device_kitchen_screen_stations` and `_zones` rows cascade from it) | `packages/venue-service/src/schema/kitchen-screens.ts:116-137,139-163,165-190` | Settings | **Removed**, all three explicitly, through a new venue-service seat (Task 2) |
| `device_kitchen_screen_removals.device_id` | `packages/venue-service/src/schema/kitchen-screens.ts:197-229` | Settings (what a narrowing took from it) | **Removed**, through the same seat |
| `devices.receipt_printer_id`, `payment_slip_printer_id`, `cash_drawer_printer_id` (on the device's own row) | `packages/db/src/schema/devices.ts:29-43` | Settings | **Cleared** (Plan default 3) |
| `devices.token_hash` (own row) | `packages/db/src/schema/devices.ts:46-47` | Credential | **Cleared** to `""` (Plan default 1) |
| `pass_item_marks.device_id` | `packages/db/src/schema/pass-item-marks.ts:6-27` | A device's own Done marks on kitchen records, removed with the record | **Left as is** (Plan default 9) |
| `working_orders.device_id` | `packages/db/src/schema/orders.ts:65,71` | Open orders | **Not touched**: an order belongs to its table or bill |
| `sales.device_id` | `packages/db/src/schema/sales.ts:72` | History | Kept |
| `registros_facturacion.device_id` | `packages/fiscal-verifactu/src/schema/registros.ts:33` | History (fiscal) | Kept |
| `order_groups.fired_by_device_id`, `order_group_events.actor_device_id` | `packages/db/src/schema/order-groups.ts:29,44,79,96` | History | Kept |
| `order_amendments.captured_by_device_id` | `packages/db/src/schema/order-amendments.ts:40,57` | History (hash-chained) | Kept |
| `ticket_item_moves.moved_by_device_id` | `packages/db/src/schema/ticket-item-moves.ts:18,44` | History | Kept |
| `time_entries.captured_by_device_id` | `packages/workforce/src/schema/time-entries.ts:56,95` | History (hash-chained) | Kept |
| `bill_payments`, `bill_payment_refunds` and `payments` not in progress | as above | History | Kept |
| `unpaid_departures.device_id` | `packages/db/src/schema/unpaid-departures.ts:30` | History | Kept |
| `drawer_opens.device_id` | `packages/db/src/schema/drawer-opens.ts:25` | History | Kept |
| `incidents.device_id` | `packages/db/src/schema/incidents.ts:29` | History | Kept |

**History reads that name a device and must keep working (no filter added):** alerts, through `packages/core/src/incidents.ts:137,181,195,206`; the cash-up by device, through `namedCashUp` (`apps/server/src/report-api.ts:440-462`, "no `active` filter" by design); the stuck-payment lists (`apps/server/src/payments-api.ts:812`, `:948`, `:1110`); who fired a group (`apps/server/src/order-groups.ts:1122-1135`); station queue moves (`apps/server/src/station-queue-moves.ts:24-30`); a sale's operation description (`packages/core/src/sale-location.ts:22-25`).

**Reads and writes that deliberately reach disabled devices (each must learn about deleted ones):**

| Site | Today | Task |
| --- | --- | --- |
| `GET /management-api/devices`, `apps/server/src/device-api.ts:609-667` | lists every device, with no filter | 4: omit deleted, keep disabled |
| `POST /management-api/devices/:id/revoke`, `device-api.ts:670-689` | updates by id with no `active` filter, so a deleted device would answer 204 | 4: a deleted device answers `device.not_found` |
| `PATCH /management-api/devices/:id`, `device-api.ts:692-720` | refuses a disabled device with `device.not_found` | 4: pin it for a deleted device too (it is already off) |
| `PUT /management-api/payments/devices/:id/reader`, `apps/server/src/payments-api.ts:709-731` | existence check by id, no `active` filter | 4: a deleted device answers `device.not_found` |
| `GET /management-api/payments/devices/:id/reader`, `payments-api.ts:693-705` | reads `device_card_readers` only; an unknown id answers `{readerId:null}` | unchanged (Plan default 13) |
| `provenDisabledDevice`, `apps/server/src/join-requests.ts:228-240` | finds an id that is `active = false` | 4: also `deleted_at is null` |
| `createJoinRequest`'s re-read and token write, `join-requests.ts:131-137,207-208` | re-reads `active = false`, then writes the new token hash onto the row | 4: also `deleted_at is null` on the re-read and the write |
| `returningDevicesOf`, `join-requests.ts:258-285` | `active = false` rows among pending ids | 4: also `deleted_at is null` |
| `acceptDeviceJoinRequest`, `join-requests.ts:492-555` | re-enables a disabled row with the request's id, else inserts a new row with that id | 4: an id that names a deleted row is refused `join_request.not_found` (backstop) |
| `setProfileKitchenScreens` narrowing, `packages/venue-service/src/kitchen-screens.ts:159-183` | every device on the profile | 5: skip deleted |
| `readPrinterDeleteImpact` inherited-default candidates, `apps/server/src/printer-delete.ts:108-131` | devices on the profile at the printer's location | 5: skip deleted |
| `settleProfilePrinterDevices`, `packages/layouts/src/device-equipment.ts:505-540`; `settleProfileReaderDevices`, `packages/payments/src/device-readers.ts:405-425` | every device on the profile | 5: no change, because a deleted device has no choices or holds left to settle; pinned by a test |
| `deleteDeviceProfile`, `packages/layouts/src/device-profile-store.ts:303-337` | a profile held only by disabled devices is retired, not deleted | unchanged: a deleted row keeps its `device_profile_id` key, so retiring is still right; pinned by a test (Task 5) |

**Already safe, no change, because they read `active = true`:** device cookie authentication (`apps/server/src/device-session.ts:202-204,215-224`, re-checked at :237-238 and :243-251); `assertDeviceStillProven` (`device-session.ts:330-344`); shift sessions (`apps/server/src/till-session.ts:105-117`); `readJoinStatus` (`join-requests.ts:415-440`); the dev devices list (`device-api.ts:818-820`); reader assignments (`payments-api.ts:537`); receipt preview (`apps/server/src/receipt-preview-api.ts:103`); dark station and pass screens (`apps/server/src/station-outputs-down.ts:152,207`). Device-authenticated writes (battery `device-api.ts:371-402`, sighting `device-session.ts:285-301`, profile switch `apps/server/src/device.ts:295-318`) run only after `requireDevice` has found an active row.

**Configuration export:** `devices` is not exported (`packages/db/src/configuration-transfer.ts:19-70` has no `devices` or `device_*` link row; `apps/server/src/configuration-transfer.test.ts:1736` asserts it is absent). Nothing to do.

### Plan corrections against the spec

1. **`join_requests` has no device-id column.** A returning device's request takes the device's id as its own primary key (`apps/server/src/join-requests.ts:138-143,193`), and the table is `local`, keyed by `node_id` (`packages/db/src/schema/join-requests.ts:30-41`). "`join_requests` carrying its id" therefore means this node's row with `id = <device id>` and `kind = 'device'`.
2. **Devices have no Enable route.** A disabled device comes back only when its browser knocks (`provenDisabledDevice` → `createJoinRequest`) and a manager (or dev mode) accepts (`acceptDeviceJoinRequest`, `join-requests.ts:525-537`). "Enable refuses on a deleted device" is built on those three functions.
3. **`device.payment_in_progress` today checks card payments only.** `assertNoPaymentInProgress` (`apps/server/src/device.ts:240-254`) reads `payments` in `attempting`/`initiated`. The spec also counts bill payments and refunds, so the delete's refusal adds `bill_payments.state = 'pending'` and `bill_payment_refunds.state = 'pending'`. The profile-switch check is left as it is (Plan default 2).
4. **Kitchen-screen settings landed after the spec** (A366 slice 5): `device_kitchen_screens` with its station and zone rows, and `device_kitchen_screen_removals`, all in venue-service. They are Settings and are removed. The spec's list (`device_made_here_stations`, `device_approved_profiles`, `device_card_readers`) is incomplete without them.
5. **The equipment a device holds is two tables**, `printer_holders` and `card_reader_holders`. Both are released by `releaseDevice`, as Disable does.
6. **The stuck-payment lists can never hold a deleted device's payment through the product.** An `attempting` payment, a `pending` bill payment and a `pending` refund are exactly what refuses the delete. The spec's test "history still names it: … the stuck-payment lists" is therefore built as a backstop: the row is written straight into the database after the delete, to show that those reads join `devices` without a filter. The test says so in its name.
7. **No uniqueness rule needs narrowing.** The only unique index on `devices` is `devices_location_label_active_key`, which already counts only active rows (`packages/db/src/schema/devices.ts:60-64`), and a deleted device is always inactive. There is no unique index on `token_hash`.
8. **The token cannot be set to NULL without rebuilding `devices`.** `token_hash` is `NOT NULL` (`devices.ts:47`), and dropping that on this engine is a table rebuild. `devices` has cascading children (`printer_holders`, `card_reader_holders`, `device_approved_profiles`), so a rebuild with foreign keys on would delete their rows (CLAUDE.md §3). "Cleared" is therefore `""` (Plan default 1).

### Plan defaults (conservative choices a reviewer can overturn)

- **Plan default 1 — the token is cleared to `""`.** `verifySecretAsync` returns false for any stored value that is not `scrypt$<salt>$<key>` (`packages/identity/src/secret-hash.ts:22-29,46-50`). Every authentication read also requires `active = true`. Task 3 tests this, not just reads it: the old cookie is refused after the delete.
- **Plan default 2 — one refusal names every unfinished payment.** The impact carries at most one refusal, `{ code: "device.payment_in_progress", params: {}, targets }`. `targets` are the distinct open orders those payments belong to, named by `working_orders.label`, or `#<order_number>` when the label is null. `params` stays `{}` because the registry types it `Record<string, never>` (`errors.ts:730`). `assertNoPaymentInProgress` and the profile switch do not change.
- **Plan default 3 — the deleted device's own printer choices are cleared.** The three columns are set to null in the delete, and the impact names the printers in one item. The deleted row is then never matched by `deletePrinter`'s clearing (`printer-delete.ts:188-193`) or the printer-delete impact's "devices choosing" list (`:73-87`). That keeps a deleted row unwritten after its delete. `device_profile_id` stays, because it is `NOT NULL`.
- **Plan default 4 — the printer-delete inherited-default list skips deleted devices.** One `isNull(devices.deletedAt)` predicate in `printer-delete.ts`.
- **Plan default 5 — the profile-wide kitchen-screen narrowing skips deleted devices.** The printer and reader settle loops are left alone, because a deleted device has nothing left for them to change; a test pins that a profile save leaves a deleted device's rows byte-for-byte.
- **Plan default 6 — a malformed id answers 404 `device.not_found` after the permission check.** This follows `PATCH /management-api/devices/:id` (`device-api.ts:707-709`), not printers' 400 from `requireUuidParam`. An unauthorised caller learns nothing about the id.
- **Plan default 7 — the delete ends only this node's request to come back**, filtered by `node_id` as every other join-request verb is (`join-requests.ts:26`), and drops the pairing claim after commit, as deny does (`apps/server/src/join-api.ts:262-264`). As a backstop, `acceptDeviceJoinRequest` refuses `join_request.not_found` when the request's id names a deleted device, so the product never tries to insert a second row under that id.
- **Plan default 8 — kitchen screens go through two new venue-service seat methods**, `countDeviceKitchenScreens` and `removeDeviceKitchenScreens`, on `VenueServiceContribution` (`packages/module/src/module.ts:523` onward). The server reaches venue-service tables only through that seat today (`VENUE_SERVICE`, `apps/server/src/modules.ts:16`).
- **Plan default 9 — `pass_item_marks` are left alone.** They are a device's own Done marks on a kitchen record, and are removed with that record (`pass-item-marks.ts:6`). Nothing shows another device's marks.
- **Plan default 10 — Delete is in the row menu only.** It is offered on active rows (Edit, Disable, Delete) and on disabled rows (Delete only; today a disabled row has no menu, `apps/dashboard/src/screens/devices-screen.ts:1521-1522`). The Edit dialog gains no Delete.
- **Plan default 11 — the dashboard's `device.payment_in_progress` sentence becomes neutral**, because the delete dialog's action error shows it too. Today it says "Change its profile once the payment finishes…" (`apps/dashboard/src/i18n/codes.ts:612-615`). The till's wording (`apps/till/src/i18n/codes.ts:496-499`) is about switching profile on the till and stays.
- **Plan default 12 — sign-ins are counted, not named.**
- **Plan default 13 — `GET /management-api/payments/devices/:id/reader` keeps answering `{readerId: null}` for a deleted device**, as it does for an unknown one today. It reads only `device_card_readers`, whose row the delete removes.
- **Plan default 14 — the shared `named()` helper moves out of `printer-delete.ts`** into `apps/server/src/delete-impact.ts`, so both kinds sort and deduplicate targets the same way.
- **Plan default 15 — `DELETE` answers 200 with the recomputed `DeleteImpact`**, as the printer delete does (`apps/server/src/print-api.ts:1015-1021`).

## Interfaces and file boundaries

Reused unchanged: `DeleteImpact`, `DeleteImpactItem`, `DeleteImpactRefusal`, `DeleteTarget` (`packages/shared/src/delete-impact.ts`); `WtDeleteDialog` and `DeleteDialogCopy` (`packages/ui/src/components/wt-delete-dialog.ts`).

**Device impact item keys** (fixed here; the dashboard copy keys on them):

- refusal code: `device.payment_in_progress`, targets = open orders.
- `ends`: `sessions` (count only, no targets), `held_printers` (printer names), `held_readers` (card reader names), `join_request` (count 0/1, no targets).
- `removes`: `printer_choices` (distinct printer names across the three columns), `made_here_stations` (station names), `approved_profiles` (profile names), `card_reader` (reader name), `kitchen_screens` (count of `device_kitchen_screens` rows, no targets).
- An item whose count is 0 is left out, as for printers.

**New server module** `apps/server/src/device-delete.ts`:

```ts
readDeviceDeleteImpact(tx: Transaction, cfg: TillConfig, id: string): Promise<DeleteImpact>
deleteDevice(tx: Transaction, cfg: TillConfig, id: string, now?: Date): Promise<DeleteImpact>
```

Both call one private `deviceDeleteRules(tx, cfg, id): Promise<DeleteImpact>`. It throws `device.not_found` for a missing or deleted id. `deleteDevice` throws `device.payment_in_progress` when the recomputed impact has that refusal, before any write. It never opens a transaction.

**New server helper** `apps/server/src/delete-impact.ts`: `export function named(key: string, targets: DeleteTarget[]): DeleteImpactItem` (moved from `printer-delete.ts:37-43`, unchanged).

**New seat methods** on `VenueServiceContribution` (`packages/module/src/module.ts`), implemented in `packages/venue-service/src/kitchen-screens.ts` and wired in `packages/venue-service/src/service.ts` beside `setDeviceKitchenScreens` (:90, :157):

```ts
/** How many kitchen screens the device stores a choice for (its `device_kitchen_screens` rows). */
countDeviceKitchenScreens(tx: Transaction, deviceId: string): Promise<number>;
/** Removes the device's kitchen-screen choices, their station and zone rows, and what narrowings
 *  took from it. Checks nothing: for a device being deleted. */
removeDeviceKitchenScreens(tx: Transaction, deviceId: string): Promise<void>;
```

**New join-request helpers** in `apps/server/src/join-requests.ts`:

```ts
/** Whether this node holds a device's request to come back (a request whose id is the device's). */
hasReturningRequest(tx: Transaction, cfg: TillConfig, deviceId: string): Promise<boolean>
/** Deletes that request; true when there was one. */
endReturningRequest(tx: Transaction, cfg: TillConfig, deviceId: string): Promise<boolean>
```

**Routes** in `apps/server/src/device-api.ts`, both through the file's existing `gated` (`device.manage`):

- `GET /management-api/devices/:id/delete-impact` → 200 `DeleteImpact`.
- `DELETE /management-api/devices/:id` → 200 the recomputed `DeleteImpact`. After commit it calls `deps.pairingMode.dropClaim(id)` (dropping a claim that does not exist is a no-op: `apps/server/src/pairing-mode.ts:95-97`).

**Dashboard API** (`apps/dashboard/src/api/client.ts`, beside `revokeDevice` at :3136):

```ts
getDeviceDeleteImpact(id: string): Promise<DeleteImpact>
deleteDevice(id: string): Promise<DeleteImpact>
```

**Dashboard copy** `apps/dashboard/src/widgets/device-delete-copy.ts`: `export function deviceDeleteCopy(): DeleteDialogCopy`, shaped like `printer-delete-copy.ts`.

## Tasks

### Task 1: `deleted_at` on devices, and its migration

**Deliverable:** a nullable `deleted_at` column on `devices`, generated by drizzle-kit, with the schema guards green and the venue-reset question answered from the generated SQL.

**Files:**
- Modify: `packages/db/src/schema/devices.ts` (column; rewrite the header comment at :8-14 so it says Disable clears `active` and Delete also sets `deleted_at`, and drop its history)
- Test: `packages/db/src/schema/devices.test.ts`
- Generated only: `packages/db/drizzle/<n>_device_delete.sql`, `packages/db/drizzle/meta/<n>_snapshot.json`, `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `devices.deletedAt: string | null` (Drizzle property `deletedAt`, SQL column `deleted_at`).

- [ ] **Step 1: Write the failing test.** In `packages/db/src/schema/devices.test.ts`, inside `describe("devices schema (columns, FKs, unique)")`, add the following. It uses raw pragma first, so it runs on the current schema and fails on the assertion rather than on a type error:

```ts
it("devices: carries a nullable deleted_at that reads back, null by default", async () => {
  const columns = suite.db
    .all<{ name: string; notnull: number }>(sql`select name, "notnull" from pragma_table_info('devices')`);
  expect(columns.find((c) => c.name === "deleted_at")).toEqual({ name: "deleted_at", notnull: 0 });
  const id = await seedDevice("Caja 1");
  const [fresh] = suite.db.all<{ deleted_at: string | null }>(
    sql`select deleted_at from devices where id = ${id}`,
  );
  expect(fresh!.deleted_at).toBeNull();
});

it("devices: a deleted device frees its name, as a disabled one does", async () => {
  const first = await seedDevice("Caja 1");
  await inTx((tx) =>
    tx.execute(sql`update devices set active = 0, deleted_at = '2026-10-10T10:00:00.000Z' where id = ${first}`),
  );
  const second = await seedDevice("Caja 1");
  expect(second).not.toBe(first);
});
```

  Check that `seedDevice` and `inTx` are the file's existing helpers (they are used at `devices.test.ts:69-80`). If `seedDevice` seeds a fixed label, give it a parameter rather than writing a second helper. The second case already passes today, because the index counts only active rows. Keep it as a control for plan correction 7, and say so in a one-line test name, not a comment.

- [ ] **Step 2: Run it and see it fail.**

Run: `pnpm --filter @waitron/db exec vitest run src/schema/devices.test.ts`
Expected: the first new case FAILS: `expected undefined to deeply equal { name: 'deleted_at', notnull: 0 }`. The second passes.

- [ ] **Step 3: Add the column.** In `devices.ts`, after `active`:

```ts
    // Disable clears `active`; Delete also sets `deleted_at`. Rows elsewhere keep pointing at it.
    deletedAt: tsString("deleted_at"),
```

  Do not add a CHECK (such as `deleted_at is null or active = 0`): a CHECK makes drizzle-kit rebuild `devices` (the battery comment at `devices.ts:50-52` records the same choice). Do not touch `devices_location_label_active_key`.

- [ ] **Step 4: Generate the migration.**

Run: `pnpm --filter @waitron/db db:generate --name device_delete`
Then read the generated SQL. Expected: one statement, `ALTER TABLE \`devices\` ADD \`deleted_at\` text;`, and no `__new_devices`, `DROP TABLE` or `INSERT INTO`. If anything else appears, STOP: do not commit, and report the SQL. A rebuild of `devices` with foreign keys on would delete the rows of its cascading children (CLAUDE.md §3).

- [ ] **Step 5: Add a typed readback.** Now that the property exists, extend the first test with a write and read through Drizzle (`tx.update(devices).set({ deletedAt: "2026-10-10T10:00:00.000Z" })`, then select `deletedAt`), so the Drizzle mapping is checked too.

- [ ] **Step 6: Run the test and the schema guards.**

Run, each separately, reading each `Tests` count and exit status:
```
pnpm --filter @waitron/db exec vitest run src/schema/devices.test.ts src/schema/devices.fk.test.ts src/schema/devices.trigger.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/module-graph-honesty.test.ts
pnpm exec vitest run scripts/migration-upgrade.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts
```
Expected: all pass. `devices.trigger.test.ts` pins `device_profile_form_factor_locked`, whose body reads `devices` (`devices.trigger.test.ts:9-23`); the upgrade test walks every migration with rows in place. Then `git diff ad64b10be --stat -- packages/db/drizzle` must list only the new SQL file, the new snapshot and `_journal.json`.

- [ ] **Step 7: Decide the reset question from what ran.** If Step 4's SQL was the single `ADD` and Step 6's upgrade test passed, the commit message says: "No venue reset is needed: the migration only adds a column (the generated SQL is one ALTER TABLE … ADD), and scripts/migration-upgrade.test.ts passed with it." Otherwise state what was found and that a reset is needed.

- [ ] **Step 8: Format, lint, commit.**

```
pnpm format:check && pnpm lint
git add packages/db/src/schema/devices.ts packages/db/src/schema/devices.test.ts packages/db/drizzle
git commit -s -m "Devices can be marked deleted (a new deleted_at time), ready for a permanent Delete"
```

### Task 2: Kitchen-screen seat methods and join-request helpers

**Deliverable:** the two venue-service seat methods and the two join-request helpers, each tested against a real database. No route uses them yet.

**Files:**
- Modify: `packages/module/src/module.ts` (two methods on `VenueServiceContribution`, beside `setDeviceKitchenScreens` at :866)
- Modify: `packages/venue-service/src/kitchen-screens.ts` (two exported functions after `setDeviceKitchenScreens`, :538-575)
- Modify: `packages/venue-service/src/service.ts` (:90 and :157, wire both)
- Modify: `apps/server/src/join-requests.ts` (two exported functions after `denyJoinRequest`, :632-640)
- Test: the venue-service suite that already covers `setDeviceKitchenScreens` (find it with `rg -l "setDeviceKitchenScreens" packages/venue-service/src -g '*.test.ts'`); `apps/server/src/join-requests.test.ts`
- Check also: any test double that implements `VenueServiceContribution` in full (`rg -n "VenueServiceContribution" packages apps -g '*.test.ts' -g '**/testing/**'`) gets the two methods, or typecheck fails.

**Interfaces:**
- Produces: `countDeviceKitchenScreens(tx, deviceId): Promise<number>`, `removeDeviceKitchenScreens(tx, deviceId): Promise<void>` (seat and package exports); `hasReturningRequest(tx, cfg, deviceId): Promise<boolean>`, `endReturningRequest(tx, cfg, deviceId): Promise<boolean>`.

- [ ] **Step 1: Write the failing venue-service test.** Use that suite's existing fixture to give device A a station screen with one station and a pass screen with one zone, plus one removal row (a narrowing, or a direct insert into `device_kitchen_screen_removals`); give device B one screen. Then:

```ts
it("counts a device's kitchen screens, then removes them with their stations, zones and removals, leaving other devices alone", async () => {
  const before = await snapshotKitchenScreenRows(); // every row of the four device_kitchen_screen* tables
  expect(await inTx((tx) => countDeviceKitchenScreens(tx, deviceA))).toBe(2);
  await inTx((tx) => removeDeviceKitchenScreens(tx, deviceA));
  const after = await snapshotKitchenScreenRows();
  for (const table of Object.keys(before) as (keyof typeof before)[]) {
    expect(after[table]).toEqual(before[table].filter((row) => row.device_id !== deviceA));
  }
  expect(await inTx((tx) => countDeviceKitchenScreens(tx, deviceA))).toBe(0);
  expect(await inTx((tx) => countDeviceKitchenScreens(tx, deviceB))).toBe(1);
});
```

  `snapshotKitchenScreenRows` is a small local helper that selects `*` from `device_kitchen_screens`, `device_kitchen_screen_stations`, `device_kitchen_screen_zones` and `device_kitchen_screen_removals`, ordered by every column. Before running, assert that device A really has station, zone and removal rows, so the removal is not tested on empty tables.

- [ ] **Step 2: Write the failing join-request test** in `apps/server/src/join-requests.test.ts`, using that file's fixtures. Make a disabled device's knock (as `apps/server/src/device-api.test.ts:669-686` does: enrol, `update devices set active = 0`, knock again with the cookie), so a request with the device's id exists. Add a second node's row with the same id by a direct insert (`node_id` of another node), and an unrelated pending request.

```ts
it("finds and ends only this node's request to come back, by the device's id", async () => {
  expect(await inTx((tx) => hasReturningRequest(tx, cfg, deviceId))).toBe(true);
  expect(await inTx((tx) => endReturningRequest(tx, cfg, deviceId))).toBe(true);
  expect(await inTx((tx) => hasReturningRequest(tx, cfg, deviceId))).toBe(false);
  expect(await inTx((tx) => endReturningRequest(tx, cfg, deviceId))).toBe(false);
  const rows = await suite.db.select({ id: joinRequests.id, nodeId: joinRequests.nodeId }).from(joinRequests);
  expect(rows).toEqual(expect.arrayContaining([{ id: deviceId, nodeId: otherNode }, { id: unrelatedId, nodeId: cfg.nodeId }]));
  expect(rows).toHaveLength(2);
});
```

- [ ] **Step 3: Run both and see them fail.**

```
pnpm --filter @waitron/venue-service exec vitest run <the kitchen-screens suite>
pnpm --filter @waitron/server exec vitest run src/join-requests.test.ts
```
Expected: each fails on the missing export (an import error is acceptable here only because the behaviour cannot be reached any other way; say so in the task report).

- [ ] **Step 4: Implement.** In `kitchen-screens.ts`:

```ts
export async function countDeviceKitchenScreens(tx: Transaction, deviceId: string): Promise<number> {
  const rows = await tx
    .select({ screen: deviceKitchenScreens.screen })
    .from(deviceKitchenScreens)
    .where(eq(deviceKitchenScreens.deviceId, deviceId));
  return rows.length;
}

export async function removeDeviceKitchenScreens(tx: Transaction, deviceId: string): Promise<void> {
  await tx.delete(deviceKitchenScreenStations).where(eq(deviceKitchenScreenStations.deviceId, deviceId));
  await tx.delete(deviceKitchenScreenZones).where(eq(deviceKitchenScreenZones.deviceId, deviceId));
  await tx.delete(deviceKitchenScreens).where(eq(deviceKitchenScreens.deviceId, deviceId));
  await tx.delete(deviceKitchenScreenRemovals).where(eq(deviceKitchenScreenRemovals.deviceId, deviceId));
}
```

  The children are deleted explicitly rather than through the cascade, so the code does not depend on foreign keys being on. In `join-requests.ts` (reuse the file's private `ownedBy`, :26):

```ts
const returningOf = (cfg: TillConfig, deviceId: string) =>
  and(ownedBy(cfg), eq(joinRequests.id, deviceId), eq(joinRequests.kind, "device"));

export async function hasReturningRequest(tx: Transaction, cfg: TillConfig, deviceId: string): Promise<boolean> {
  const [row] = await tx.select({ id: joinRequests.id }).from(joinRequests).where(returningOf(cfg, deviceId));
  return row !== undefined;
}

export async function endReturningRequest(tx: Transaction, cfg: TillConfig, deviceId: string): Promise<boolean> {
  const ended = await tx.delete(joinRequests).where(returningOf(cfg, deviceId)).returning({ id: joinRequests.id });
  return ended.length > 0;
}
```

  Doc comments: one line each, saying what the function does (see Interfaces). No history.

- [ ] **Step 5: Run again, then the seat guards.**

```
pnpm --filter @waitron/venue-service exec vitest run <the kitchen-screens suite>
pnpm --filter @waitron/server exec vitest run src/join-requests.test.ts
pnpm exec vitest run scripts/module-seams.test.ts scripts/workspace-cycles.test.ts
pnpm --filter @waitron/module typecheck && pnpm --filter @waitron/venue-service typecheck && pnpm --filter @waitron/server typecheck
```
Expected: all pass. Read the `Tests` count of each.

- [ ] **Step 6: Commit.** `git commit -s -m "Venue service can count and remove a device's kitchen screens; the server can find and end a device's request to come back"`

### Task 3: The device impact read and delete, and their routes

**Deliverable:** `GET /management-api/devices/:id/delete-impact` and `DELETE /management-api/devices/:id`, behind `device.manage`, sharing one set of rules, with every refusal, ending and removal checked in the database.

**Files:**
- Create: `apps/server/src/delete-impact.ts` (the moved `named`)
- Modify: `apps/server/src/printer-delete.ts` (import `named`; no behaviour change)
- Create: `apps/server/src/device-delete.ts`
- Modify: `apps/server/src/device-api.ts` (two routes after the revoke route, :670-689)
- Modify: `apps/server/src/errors.ts` (comments only: `device.payment_in_progress` at :726-730 now also refuses a delete, including bill payments and refunds; `device.not_found` at :741-745 now also answers for a deleted device on every device-management route)
- Create: `apps/server/src/device-delete.db.test.ts` (rules and transaction)
- Create: `apps/server/src/device-api.delete.test.ts` (routes, over `app.request`)

**Interfaces:**
- Consumes: Task 1's `devices.deletedAt`; Task 2's seat methods and join-request helpers; `endDeviceSessions` (`@waitron/identity`); `releaseDevice` (`apps/server/src/device-equipment.ts:105`); `IN_PROGRESS_PAYMENT_STATES`, `payments`, `cardReaders`, `cardReaderHolders`, `deviceCardReaders` (`@waitron/payments`); `billPayments`, `billPaymentRefunds`, `workingOrders`, `printers`, `printerHolders`, `deviceMadeHereStations`, `deviceApprovedProfiles`, `deviceProfiles`, `kitchenStations`, `sessions` (from `@waitron/db` and `@waitron/identity`).
- Produces: `readDeviceDeleteImpact`, `deleteDevice` (signatures above) and the two routes.

- [ ] **Step 1: Write the failing rules tests** in `apps/server/src/device-delete.db.test.ts`. Use `useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) })` (as `device-api.test.ts:60-63` does), `setupVenue` (`apps/server/src/testing/venue-fixtures.ts:68`) and `enrolDeviceForTest` (`apps/server/src/testing/enrol.ts:15`). The fixture, "Bar till" (the device to delete) and "Pass" (a control device), has:
  - an open sign-in on each (`loginWithPin`, as `device-api.test.ts:3240-3256` does);
  - Bar till holding portable printer "Handheld P" and card reader "Reader R"; Pass holding another printer;
  - Bar till's explicit receipt, slip and drawer choices (two distinct printers);
  - made-here stations "Grill" and "Bar"; approved profile "Waiters"; card reader choice "Reader R"; one station kitchen screen;
  - a pending request to come back under Bar till's id (disable it, knock again with its cookie, then set it active again by direct update, so the request and an active device coexist; or seed the `join_requests` row directly with this node's id, which is closer to the case);
  - history: a sale, an incident, a drawer opening and an order group fired from Bar till (whatever the existing fixtures make cheaply: at least the incident and the cash sale, because Task 4 reads them).

  Cases (each compares whole rows, not counts alone):

```ts
it("names every sign-in, held printer and reader, request and setting the delete touches, and writes nothing", async () => {
  const before = await snapshot(); // every table named in the inventory, ordered
  const impact = await inTx((tx) => readDeviceDeleteImpact(tx, venue.cfg, barTill));
  expect(impact).toEqual({
    target: { id: barTill, name: "Bar till" },
    refusals: [],
    ends: [
      { key: "sessions", count: 1, targets: [] },
      { key: "held_printers", count: 1, targets: [{ id: handheldP, name: "Handheld P" }] },
      { key: "held_readers", count: 1, targets: [{ id: readerR, name: "Reader R" }] },
      { key: "join_request", count: 1, targets: [] },
    ],
    removes: [
      { key: "printer_choices", count: 2, targets: [/* the two printers, by name */] },
      { key: "made_here_stations", count: 2, targets: [{ id: bar, name: "Bar" }, { id: grill, name: "Grill" }] },
      { key: "approved_profiles", count: 1, targets: [{ id: waiters, name: "Waiters" }] },
      { key: "card_reader", count: 1, targets: [{ id: readerR, name: "Reader R" }] },
      { key: "kitchen_screens", count: 1, targets: [] },
    ],
  });
  expect(await snapshot()).toEqual(before);
});

it("refuses with device.payment_in_progress naming each open order with a card payment, bill payment or refund in progress", async () => { /* … */ });
it("does not refuse for payments that finished, failed or were declined", async () => { /* … */ });
it("answers device.not_found for an unknown device and a deleted one", async () => { /* … */ });
it("answers an empty impact for a disabled device with nothing left on it, and deletes it", async () => { /* … */ });
it("deletes: ends sign-ins, holds and the request, removes every setting, clears the token and printer choices, keeps the row and every history row", async () => { /* … */ });
it("recomputes inside the delete: a sign-in or setting added after the read is ended or removed too", async () => { /* … */ });
it("a payment started after the read refuses the delete, and nothing is written", async () => { /* … */ });
it("a refused final write leaves every row as it was and publishes no change", async () => { /* … */ });
it("leaves the control device, its sign-in, its hold and its settings exactly as they were", async () => { /* … */ });
```

  Details each case must pin:
  - **Refusal.** Seed in turn, on Bar till, using `device-api.test.ts:3268-3289`'s `paymentInProgress` shape and `bill-payments-loop.test.ts:584-600,636-650`'s rows: a card payment `attempting`; a card payment `initiated`; a bill payment `pending`; a refund `pending`. Each alone gives `refusals: [{ code: "device.payment_in_progress", params: {}, targets: [{ id: <working order id>, name: "Mesa 1" }] }]`; an order with a null label is named `#<order_number>`. `deleteDevice` with that state rejects with `{ code: "device.payment_in_progress" }`, caught OUTSIDE `withTransaction`, and `snapshot()` is unchanged. A payment on the control device does not refuse Bar till.
  - **Not refusing.** `payments.state` `captured`, `failed` and `declined` (`PaymentState`, `packages/payments/src/provider.ts:11-21`), bill payment `received`/`failed`/`declined`, refund `completed`/`failed`: `refusals: []`. This is the case that would fail if the refusal read ignored state.
  - **Delete.** After `deleteDevice` (with `now = new Date("2026-10-10T10:00:00.000Z")`): the row has `active: false`, `deletedAt: "2026-10-10T10:00:00.000Z"`, `tokenHash: ""`, all three printer columns null, and every other column unchanged (compare the whole row with `before`, overriding those fields). Bar till's `sessions` have `endedAt` set, and the control's do not. Its `printer_holders` and `card_reader_holders` rows are gone. `device_made_here_stations`, `device_approved_profiles`, `device_card_readers` and the four kitchen-screen tables hold no row with its id. The `join_requests` row is gone. Every history table (sales, incidents, drawer openings, order groups, `registros_facturacion`, `order_amendments`, `time_entries`) is byte-for-byte equal to `before`. The function returns the impact the read gave.
  - **Recompute.** Read the impact; then add a second sign-in and a second made-here station; then delete. Both are ended or removed, and the returned impact counts them (2 and 3).
  - **Rollback.** Install a temporary trigger in the test (`create trigger test_refuse before update of deleted_at on devices begin select raise(abort, 'test_delete_failure'); end`), subscribe to changes as `printer-delete.db.test.ts` does (`subscribeToChanges`, `installChangeFeed`), run the whole `withTransaction(… deleteDevice …)`, and catch outside. Every row equals `before` and no change was published. Drop the trigger in `finally`. Note the order of writes in Step 3: the `devices` update comes LAST so this trigger fires after every other write.

- [ ] **Step 2: Write the failing route tests** in `apps/server/src/device-api.delete.test.ts`. Copy the small helpers it needs from `device-api.test.ts` (`mountApp`, `send` with `"DELETE"` added to its method union, `deviceCookieFrom`, `seedProfile`); do not import from another test file.

```ts
it("device.manage gates both routes: 401 with no session, 403 for staff, 200 for a manager, and the gate is the file's own", async () => { /* … */ });
it("a malformed id answers 404 device.not_found, after the permission check", async () => { /* … */ });
it("reads the impact, then deletes with it recomputed, and a second delete answers device.not_found and writes nothing", async () => { /* … */ });
it("a refusal created between the read and the delete makes the delete answer 409 device.payment_in_progress", async () => { /* … */ });
it("after the delete, the device's cookie is refused and its sign-in cookie is refused", async () => { /* … */ });
it("the delete drops the pairing claim on the device's request to come back", async () => { /* … */ });
```

  - Permission: assert status and `error.code` for each caller (`management_session.required`, `authorization.not_permitted`); for the staff caller also assert the device row and its sessions are unchanged. "The gate is the file's own": in a disposable checkout, change the new route to skip `gated` and see the 403 case fail; record what ran in the task report, then restore.
  - Cookie: before the delete, `GET /api/device/me` with the device's cookie answers 200; after, 401 `device.unauthorized`. Same for a shift-session route the till uses (pick one that `till-session.ts:92-117` guards, for instance the one `device-api.test.ts:3936` uses). This is the test behind Plan default 1.
  - Claim: open the pairing window, knock with the disabled device's cookie, claim the request as `join-api.ts` does (read how a claim is made: `PairingMode.claim`, `apps/server/src/pairing-mode.ts:85-87`), delete, and assert `pairingMode.claimOf(deviceId)` is undefined.

- [ ] **Step 3: Run both files and see them fail.**

```
pnpm --filter @waitron/server exec vitest run src/device-delete.db.test.ts src/device-api.delete.test.ts
```
Expected: FAIL on the missing module, then (once a stub exports the names) on the assertions.

- [ ] **Step 4: Move `named`.** Create `apps/server/src/delete-impact.ts` with `named` exactly as it is at `printer-delete.ts:37-43` (with its imports), export it, import it in `printer-delete.ts`. Run `pnpm --filter @waitron/server exec vitest run src/printer-delete.db.test.ts` and see it still pass.

- [ ] **Step 5: Implement `device-delete.ts`.** Shape:

```ts
import "./errors.js";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { AppError, type DeleteImpact, type DeleteImpactItem, type DeleteTarget } from "@waitron/shared";
import {
  billPaymentRefunds, billPayments, deviceApprovedProfiles, deviceMadeHereStations, deviceProfiles,
  devices, kitchenStations, printerHolders, printers, workingOrders, type Transaction,
} from "@waitron/db";
import { endDeviceSessions, sessions } from "@waitron/identity";
import {
  IN_PROGRESS_PAYMENT_STATES, cardReaderHolders, cardReaders, deviceCardReaders, payments,
} from "@waitron/payments";
import { named } from "./delete-impact.js";
import { releaseDevice } from "./device-equipment.js";
import { endReturningRequest, hasReturningRequest } from "./join-requests.js";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";

const orderName = (row: { id: string; label: string | null; orderNumber: number }): DeleteTarget => ({
  id: row.id,
  name: row.label ?? `#${row.orderNumber}`,
});

async function deviceDeleteRules(tx: Transaction, cfg: TillConfig, id: string): Promise<DeleteImpact> {
  const [device] = await tx
    .select({
      id: devices.id, name: devices.label,
      receiptPrinterId: devices.receiptPrinterId,
      paymentSlipPrinterId: devices.paymentSlipPrinterId,
      cashDrawerPrinterId: devices.cashDrawerPrinterId,
    })
    .from(devices)
    .where(and(eq(devices.id, id), isNull(devices.deletedAt)));
  if (device === undefined) throw new AppError("device.not_found", { deviceId: id });

  const orderColumns = { id: workingOrders.id, label: workingOrders.label, orderNumber: workingOrders.orderNumber };
  const cardOrders = await tx.select(orderColumns).from(payments)
    .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
    .where(and(eq(payments.deviceId, id), inArray(payments.state, IN_PROGRESS_PAYMENT_STATES)));
  const billOrders = await tx.select(orderColumns).from(billPayments)
    .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
    .where(and(eq(billPayments.deviceId, id), eq(billPayments.state, "pending")));
  const refundOrders = await tx.select(orderColumns).from(billPaymentRefunds)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentRefunds.billPaymentId))
    .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
    .where(and(eq(billPaymentRefunds.deviceId, id), eq(billPaymentRefunds.state, "pending")));
  const unfinished = named("device.payment_in_progress", [...cardOrders, ...billOrders, ...refundOrders].map(orderName));

  // … sessions (count of open rows), held printers and readers (joined for names),
  // hasReturningRequest, printer choices (distinct non-null ids of the three columns, joined to
  // `printers` with no active or deleted filter: they are names), made-here stations, approved
  // profiles, card reader choice, VENUE_SERVICE.countDeviceKitchenScreens.

  return {
    target: { id: device.id, name: device.name },
    refusals: unfinished.count === 0 ? [] : [{ code: "device.payment_in_progress", params: {}, targets: unfinished.targets }],
    ends: [/* sessions, held_printers, held_readers, join_request */].filter((item) => item.count > 0),
    removes: [/* printer_choices, made_here_stations, approved_profiles, card_reader, kitchen_screens */].filter((item) => item.count > 0),
  };
}

export async function readDeviceDeleteImpact(tx: Transaction, cfg: TillConfig, id: string): Promise<DeleteImpact> {
  return deviceDeleteRules(tx, cfg, id);
}

export async function deleteDevice(tx: Transaction, cfg: TillConfig, id: string, now = new Date()): Promise<DeleteImpact> {
  const impact = await deviceDeleteRules(tx, cfg, id);
  if (impact.refusals.length > 0) throw new AppError("device.payment_in_progress", {});
  await endDeviceSessions(tx, id);
  await releaseDevice(tx, id);
  await endReturningRequest(tx, cfg, id);
  await tx.delete(deviceMadeHereStations).where(eq(deviceMadeHereStations.deviceId, id));
  await tx.delete(deviceApprovedProfiles).where(eq(deviceApprovedProfiles.deviceId, id));
  await tx.delete(deviceCardReaders).where(eq(deviceCardReaders.deviceId, id));
  await VENUE_SERVICE.removeDeviceKitchenScreens(tx, id);
  await tx.update(devices)
    .set({
      active: false, deletedAt: now.toISOString(), tokenHash: "",
      receiptPrinterId: null, paymentSlipPrinterId: null, cashDrawerPrinterId: null,
    })
    .where(and(eq(devices.id, id), isNull(devices.deletedAt)));
  return impact;
}
```

  `named` sorts and deduplicates by id, which is what both the refusal targets and each item need. The `device_kitchen_screens` count is the seat's. Confirm `endDeviceSessions` is exported from `@waitron/identity` (`packages/identity/src/index.ts:9`) and the payments names from `@waitron/payments` (`packages/payments/src/index.ts:134-137`; `IN_PROGRESS_PAYMENT_STATES` is imported by `apps/server/src/device.ts:23`). Doc comments on the two exports say what they do in one or two lines each, like `printer-delete.ts:163-178`.

- [ ] **Step 6: Add the routes** in `device-api.ts`, after the revoke route:

```ts
  app.get("/management-api/devices/:id/delete-impact", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      return c.json(
        await gated(sessionId, (tx) => {
          if (!isUuid(id)) throw new AppError("device.not_found", { deviceId: id });
          return readDeviceDeleteImpact(tx, deps.cfg, id);
        }),
      );
    }),
  );

  app.delete("/management-api/devices/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      const impact = await gated(sessionId, (tx) => {
        if (!isUuid(id)) throw new AppError("device.not_found", { deviceId: id });
        return deleteDevice(tx, deps.cfg, id, deps.now?.());
      });
      deps.pairingMode.dropClaim(id);
      return c.json(impact);
    }),
  );
```

  `STATUS` already maps `device.not_found` to 404 and `device.payment_in_progress` to 409 (`device-api.ts:139,159`). Check whether `deps.now` exists on `DeviceApiDeps` (`device-api.ts:120`: "The battery route's clock"); reuse it.

- [ ] **Step 7: Run both files until green, then the neighbours and guards.**

```
pnpm --filter @waitron/server exec vitest run src/device-delete.db.test.ts src/device-api.delete.test.ts src/printer-delete.db.test.ts
pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/device-equipment.test.ts src/join-requests.test.ts
pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/module-seams.test.ts
pnpm --filter @waitron/server typecheck
```
Expected: all pass, with `Tests` counts read. No new code was added, so `alert-codes` and `errors-reachable` must stay green with no edit to their lists.

- [ ] **Step 8: Controls by deletion**, in a disposable worktree made with `git worktree add --detach <dir> HEAD` (CLAUDE.md §4), never by editing files in this one. Remove, one at a time: the `billPayments` refusal read (the pending-bill-payment case must fail); the `endReturningRequest` call (the request assertion must fail); the `tokenHash: ""` (the cookie case still passes, because `active = false` alone refuses it; record that, and keep the token assertion in the row comparison, which does fail). Record what ran and what failed in the task report, then remove the worktree.

- [ ] **Step 9: Commit.** `git commit -s -m "Managers can see what deleting a device will do, then delete it"`. The body lists the routes, what refuses, what ends, what is removed, and that the row is kept switched off with its token and printer choices cleared.

### Task 4: A deleted device can't be listed, edited, disabled, or brought back

**Deliverable:** every management route and every return path refuses a deleted device; the same browser knocking again arrives as a new device, in dev mode too.

**Files:**
- Modify: `apps/server/src/device-api.ts` (list query :616-635 adds `isNull(devices.deletedAt)`; revoke's update at :678-682 adds it to its `where`)
- Modify: `apps/server/src/payments-api.ts` (:720-724 adds it)
- Modify: `apps/server/src/join-requests.ts` (:131-137, :207-208, :228-240, :258-285, :492-555)
- Test: `apps/server/src/device-api.delete.test.ts` (extend), `apps/server/src/join-requests.test.ts`, `apps/server/src/join-e2e.test.ts` (one case), the payments reader route suite (`rg -l "payments/devices/" apps/server/src -g '*.test.ts'`)

**Interfaces:**
- Consumes: Task 3's routes, used to make a real deleted device in every test (never a direct `update devices set deleted_at`, except where a case says it is a backstop).

- [ ] **Step 1: Write the failing tests** (in `device-api.delete.test.ts` unless named otherwise):

```ts
it("the device list leaves out a deleted device and still lists a disabled one", async () => { /* … */ });
it("a deleted device answers 404 device.not_found to Disable, Edit, the delete-impact read, Delete and the reader choice, and nothing is written", async () => { /* … */ });
it("a deleted device's browser knocking again is a new request under a new id, and accepting it makes a second device", async () => { /* … */ });
it("in dev mode, a deleted device's browser knocking again is enrolled at once as a new device", async () => { /* … */ });
it("a knock proved before the delete and written after it answers device.join_stale and leaves the deleted row as it was", async () => { /* … */ });
it("a pending request whose id names a deleted device is refused join_request.not_found on accept (backstop: another node's request)", async () => { /* … */ });
```

  - List: compare `GET /management-api/devices`' ids with the set of undeleted devices; the disabled control is present with `active: false`.
  - Writes: for each route, assert status, `error.code`, and that the device row and every settings table are equal to before (the PATCH body must be a valid one, so that a missing check, not a bad body, is what the test would catch).
  - New device: the dev-mode case uses `mountDevApp(cfg, true)` and the old cookie, as `device-api.test.ts:669-686` does for a disabled device; assert the new `joinId` differs from the old id, `select count(*) from devices` is 2, and the old row still has `deleted_at` set, `active` false and `token_hash` `""`. The window case opens the pairing window, knocks with the old cookie, accepts through `acceptDeviceJoinRequest`, and asserts the same. Also assert, before the accept, that the pending list (`listPendingJoinRequests` or the route `join-api.ts` serves) does not mark the request `returning`.
  - Stale knock: call `provenDisabledDevice` with the disabled device's parsed cookie (it returns a proof), then delete the device through the route, then call `createJoinRequest` with `returning:` that proof; expect `device.join_stale` (caught outside the transaction) and the row unchanged, including `token_hash` still `""`.
  - Backstop: insert a `join_requests` row whose id is the deleted device's and whose `node_id` is this node's (as another node's leftover would look if it were ours), then accept it; expect `join_request.not_found`, and the devices table unchanged.

  In `join-e2e.test.ts`, add one end-to-end case beside its disabled-device cases: enrol, sign in, delete through the route, and the same browser knocks and is accepted as a new device whose sign-in works, while the old cookie stays refused.

- [ ] **Step 2: Run and see them fail.**

```
pnpm --filter @waitron/server exec vitest run src/device-api.delete.test.ts src/join-requests.test.ts src/join-e2e.test.ts
```
Expected: list, Disable, reader choice and the knock cases FAIL (Disable answers 204; the knock takes the old id because `provenDisabledDevice` matches the deleted row, which is `active = false`; the reader route answers 204). Edit already answers 404, because a deleted device is inactive; keep that case as a pin, and say in the task report that it passed before the change.

- [ ] **Step 3: Implement.**
  - `device-api.ts` list: `.where(isNull(devices.deletedAt))`. Revoke: `.where(and(ownDeviceById(id), isNull(devices.deletedAt)))`.
  - `payments-api.ts:720-724`: `.where(and(eq(devices.id, deviceId), isNull(devices.deletedAt)))`.
  - `join-requests.ts`: add `isNull(devices.deletedAt)` to `provenDisabledDevice`'s and `createJoinRequest`'s reads and to its token write (`and(eq(devices.id, returningId), isNull(devices.deletedAt))`), and to `returningDevicesOf`. In `acceptDeviceJoinRequest`, after the request row is taken and before `resolveDeviceKitchenScreens`, add:

```ts
  const [deleted] = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, row.id), isNotNull(devices.deletedAt)));
  if (deleted !== undefined) throw new AppError("join_request.not_found", {});
```

  The throw rolls the request's delete back, so the row stays and lapses as any other (`sweepLapsed`, `join-requests.ts:42-51`). Update the doc comments of `provenDisabledDevice` (:217-227: "an id that names no device, an active one, or a deleted one") and of the `join_requests` schema only if a sentence there becomes false.

- [ ] **Step 4: Run until green, plus the existing suites these functions already have.**

```
pnpm --filter @waitron/server exec vitest run src/device-api.delete.test.ts src/join-requests.test.ts src/join-e2e.test.ts src/device-api.test.ts src/join-api.test.ts src/join-api.db.test.ts
pnpm --filter @waitron/server exec vitest run <the payments reader route suite>
```
Expected: all pass, with every existing disabled-device case unchanged (`device-api.test.ts:669` "a disabled device's browser comes back as the same device" in particular).

- [ ] **Step 5: Control.** In a disposable worktree, remove the `isNull(devices.deletedAt)` from `provenDisabledDevice` only, and run the dev-mode knock case: it must fail (the knock takes the old id, or the accept re-enables the deleted row). Record it.

- [ ] **Step 6: Commit.** `git commit -s -m "A deleted device can't be listed, edited, disabled or brought back; its browser comes back as a new device"`

### Task 5: Profile saves, printer deletes and history after a device is deleted

**Deliverable:** the profile-wide loops and the printer-delete impact ignore deleted devices; history still names a deleted device.

**Files:**
- Modify: `packages/venue-service/src/kitchen-screens.ts` (:159-163, add `isNull(devices.deletedAt)` to `onProfile`)
- Modify: `apps/server/src/printer-delete.ts` (:108-120, add `isNull(devices.deletedAt)` to the candidates' `where`)
- Test: the venue-service suite for `setProfileKitchenScreens` (`rg -l "setProfileKitchenScreens" packages/venue-service/src -g '*.test.ts'`), `apps/server/src/printer-delete.db.test.ts`, `apps/server/src/device-delete.history.test.ts` (new), `packages/layouts/src/device-profile-store.db.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - Venue-service: a profile with a disabled device A and a deleted device B (deleted by `deleteDevice` through a real transaction where the package can reach it; otherwise by the column update plus `removeDeviceKitchenScreens`, which is exactly what the delete leaves, and the test says so). A save that narrows the profile returns a `NarrowedDevice` for A and none for B, and writes no `device_kitchen_screen_removals` row for B.
  - `printer-delete.db.test.ts`: add a case where a device that inherited printer P as its profile's default receipt printer is deleted (through `deleteDevice`), and `readPrinterDeleteImpact` for P no longer names it under `device_receipt_default`, while a disabled device in the same position is still named. Then `deletePrinter(P)` leaves the deleted device's row byte-for-byte unchanged.
  - Profile save leaves a deleted device alone: in `apps/server/src/device-delete.history.test.ts` or the layouts suite, change the profile's printer list and reader list (through `setProfilePrinterLists` and the reader list writer) after the delete, and assert the deleted device's row and every settings table are unchanged.
  - `device-profile-store.db.test.ts`: a profile held only by a deleted device is retired by `deleteDeviceProfile`, not deleted, exactly as one held only by a disabled device is (the existing case for disabled devices is the model; find it with `rg -n "retire" packages/layouts/src/device-profile-store.db.test.ts`).
  - History, in `apps/server/src/device-delete.history.test.ts` (own `useVenueDb`, full manifest): make a cash sale on the device and raise an incident naming it; delete the device through `deleteDevice`; then the alerts list (`listOpenIncidents`, `packages/core/src/incidents.ts`) still gives its `deviceName`; the cash-up report (the route `report-api.ts` serves, so `namedCashUp` runs) still gives its name in `byOrigin`. Then, as a backstop (plan correction 6), insert straight into the database an `attempting` payment, a `pending` bill payment and a `pending` refund naming the deleted device on an open order, and read the three stuck lists (`payments-api.ts:800-830`, `:935-960`, `:1095-1120`): each row carries the deleted device's `deviceName`. The case name says "backstop: written after the delete, which the product would refuse".

- [ ] **Step 2: Run and see the first two fail; the rest pass already.**

```
pnpm --filter @waitron/venue-service exec vitest run <the setProfileKitchenScreens suite>
pnpm --filter @waitron/server exec vitest run src/printer-delete.db.test.ts src/device-delete.history.test.ts
pnpm --filter @waitron/layouts exec vitest run src/device-profile-store.db.test.ts
```
Expected: the narrowing case and the printer-default case FAIL (B is narrowed and reported; the deleted device is named). The history, settle and retire cases pass before any change: they pin behaviour this branch must keep, and the task report says they passed first.

- [ ] **Step 3: Implement the two predicates.** Nothing else.

- [ ] **Step 4: Run until green**, then the printer step's neighbouring suites: `pnpm --filter @waitron/server exec vitest run src/print-api.printer-wiring.test.ts src/printer-delete.db.test.ts` and `pnpm --filter @waitron/server exec vitest run src/management-api.device-profiles.test.ts`.

- [ ] **Step 5: Commit.** `git commit -s -m "Profile saves and printer deletes skip a deleted device, and its history still names it"`

### Task 6: Dashboard: Delete on the devices screen

**Deliverable:** Delete in the devices row menu (active and disabled rows), opening the shared dialog with device copy, in English and Spanish, with the printers screen's request handling.

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (two methods beside `revokeDevice`, :3136)
- Modify: `apps/dashboard/src/api/live-queries.ts` (`getDeviceDeleteImpact` dependencies)
- Create: `apps/dashboard/src/widgets/device-delete-copy.ts`, `apps/dashboard/src/widgets/device-delete-copy.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (EN and ES), `apps/dashboard/src/i18n/codes.ts` (:612-615, Plan default 11)
- Modify: `apps/dashboard/src/screens/devices-screen.ts` (row menu :1521-1537; dialog state, handlers and render, modelled on `printers-screen.ts:854-864` and :3920-4077)
- Test: `apps/dashboard/src/screens/devices-screen.test.ts`, `apps/dashboard/src/screens/devices-screen.a11y.test.ts`, `apps/dashboard/src/api/live-queries.test.ts`

**Interfaces:**
- Consumes: Task 3's routes and item keys.
- Produces: `getDeviceDeleteImpact(id)`, `deleteDevice(id)` on the dashboard API; `deviceDeleteCopy(): DeleteDialogCopy`.

- [ ] **Step 1: Write the failing copy test** in `device-delete-copy.test.ts`, shaped like `printer-delete-copy.test.ts` (:19, :80, :145, :157, :174): the fixed text in EN and ES; one line per key below with its names; no line shows a key or an id; an unknown key reads "names (count)"; the refusal line names the orders.

  Strings (EN / ES). Keys are the dialog's own, as the printer review asked:

| Key | EN | ES |
| --- | --- | --- |
| `devices.delete_heading` | Delete device? | ¿Eliminar el dispositivo? |
| `devices.delete_refusals` | Why it can't be deleted | Por qué no se puede eliminar |
| `devices.delete_ends` | Work that will end | Trabajo que finalizará |
| `devices.delete_removes` | Settings that will be removed | Configuración que se eliminará |
| `devices.delete_irreversible` | This can't be undone. | Esta acción no se puede deshacer. |
| `devices.delete_retry` | Try again | Reintentar |
| `devices.delete_loading` | Checking what will change… | Comprobando qué cambiará… |
| `devices.delete_payment` | Payment in progress: {names} | Pago en curso: {names} |
| `devices.delete_sessions` / `_one` | Signs out {count} people / Signs out 1 person | Cierra la sesión de {count} personas / Cierra la sesión de 1 persona |
| `devices.delete_held` | Stops carrying {names} | Deja de llevar {names} |
| `devices.delete_join_request` | Its request to come back | Su solicitud para volver |
| `devices.delete_printer_choices` | Printers: {names} | Impresoras: {names} |
| `devices.delete_made_here` | Made here, no ticket: {names} | Se prepara aquí, sin comanda: {names} |
| `devices.delete_approved_profiles` | Can switch to: {names} | Puede cambiar a: {names} |
| `devices.delete_card_reader` | Card reader: {names} | Lector de tarjetas: {names} |
| `devices.delete_kitchen_screens` / `_one` | {count} kitchen screens / Kitchen screen | {count} pantallas de cocina / Pantalla de cocina |
| `devices.delete_unknown` | {names} ({count}) | {names} ({count}) |
| `device.payment_in_progress` (codes.ts) | A payment on this device is still in progress. Try again once it finishes or is cancelled | Hay un pago en curso en este dispositivo. Vuelve a intentarlo cuando termine o se cancele |

  Before committing to them, grep the existing Spanish for a card reader (`rg -n '"[^"]*reader[^"]*": "' apps/dashboard/src/i18n/strings.ts | sed -n '/es/,$p'`, or read the ES block near `devices.receipt_printer_now`, :3698) and use the noun the devices screen already uses. "Made here, no ticket" and "Profiles staff can switch to" reuse the field labels at `strings.ts:1095,1098`. `held_printers` and `held_readers` share `devices.delete_held`. A refusal line with no targets reads "Payment in progress" / "Pago en curso" (a `_none` variant, or trim the colon as `printer-delete-copy.ts:51-55` does).

- [ ] **Step 2: Write the failing screen tests** in `devices-screen.test.ts`, using its own harness (`mountWidget`, `stubApi`, `flush`, `devicesTable`, `q`, `dq`):

```ts
describe("Delete", () => {
  it("an active device's menu offers Edit, Disable and Delete; a disabled one's offers Delete only, and its row still opens nothing", async () => { /* … */ });
  it("Delete opens the dialog, quiet and disabled while it loads, then red with the device named and its impact listed in order", async () => { /* … */ });
  it("a refusal lists the orders and keeps Delete disabled", async () => { /* … */ });
  it("a double press sends one DELETE; success closes the dialog, drops the row and reads the list again", async () => { /* … */ });
  it("a refused delete keeps the dialog with the reason and Delete pressable", async () => { /* … */ });
  it("a failed read offers Try again, and a later good read clears only the read's message", async () => { /* … */ });
  it("an answer for an earlier opening is never applied to the next one", async () => { /* … */ });
  it("device.not_found from the read or the delete closes the dialog and says the device no longer exists", async () => { /* … */ });
  it("a device deleted in another tab closes its dialog and its open edit without asking about drafts", async () => { /* … */ });
  it("words the menu and the dialog in English and Spanish", async () => { /* … */ });
});
```

  These two existing tests pin the menu and change, more strictly, in the same commit:
  - `devices-screen.test.ts:824` "a disabled device's row opens nothing, and it has no Edit or Disable": the `dashboard-row-actions` is now present with exactly one item, `delete-device-d2`; the row still opens nothing and there is still no `edit-device-d2` or `remove-d2`. Rename it to say so.
  - `devices-screen.test.ts:841` "an active device's menu, named for it, offers Edit and Disable": items become `["edit-device-d1", "remove-d1", "delete-device-d1"]`, with Delete's text `t("action.delete")`; keep its `data-keep-open` and Edit assertions.

  The ordering test reads the dialog's shadow DOM and checks the refusal group comes before the ends group, which comes before the removes group, then the irreversible sentence; the Delete button is `secondary` and its inner native `button` disabled while loading or refused, and `danger` and enabled when ready (as `packages/ui/src/components/wt-delete-dialog.test.ts` reads it). The stale-answer case uses deferred promises for two openings, as the printers screen's tests do (find them with `rg -n "earlier opening|generation" apps/dashboard/src/screens/printers-screen.test.ts`). Restore the language after each locale case (`currentLocale()` / `setLocale`, as `devices-screen.test.ts:858` does).

- [ ] **Step 3: Run and see them fail.**

```
pnpm --filter @waitron/dashboard exec vitest run src/widgets/device-delete-copy.test.ts src/screens/devices-screen.test.ts
```

- [ ] **Step 4: Implement.**
  - Client:

```ts
  getDeviceDeleteImpact(id: string): Promise<DeleteImpact> {
    return this.#request(`/management-api/devices/${id}/delete-impact`, "GET");
  }

  deleteDevice(id: string): Promise<DeleteImpact> {
    return this.#request(`/management-api/devices/${id}`, "DELETE");
  }
```

  - Live query dependencies for `getDeviceDeleteImpact`: `devices`, `payments`, `bill_payments`, `bill_payment_refunds`, `working_orders`, `sessions`, `printer_holders`, `printers`, `card_reader_holders`, `card_readers`, `join_requests`, `device_made_here_stations`, `kitchen_stations`, `device_approved_profiles`, `device_profiles`, `device_card_readers`, `device_kitchen_screens`. Run `pnpm exec vitest run scripts/live-subscriptions.test.ts`: drop any name it reports as undeclared (it only accepts declared server resources) and say which in the commit message. The delete recomputes anyway, so a missing dependency only leaves the dialog's counts older until another listed table changes.
  - Screen: copy the printers screen's delete state and handlers (`deleteTarget`, `deleteImpact`, `deleteLoading`, `deleteSubmitting`, `deleteReadError`, `deleteActionError`, a generation counter, the opener, a separate `DashboardQueries` for the impact read, `#openDelete`, `#readImpact`, `#impactFailed`, `#retryImpact`, `#closeDelete`, `#confirmDelete`, a `#deviceGone(id, refuse)`), renamed for devices, and render `<wt-delete-dialog data-test="delete-device-dialog" …>` with `.copy=${deviceDeleteCopy()}`. Do not copy the printer page, calibration or label branches; the devices screen has the Edit dialog instead: `#deviceGone` closes it (disposing its draft scope without the leave prompt) when it is open on that device. After a successful delete, the opener becomes the screen's Add a device button (`data-test="open-add-device"`, `devices-screen.ts:1673`), as the printers screen does with Add printer (`printers-screen.ts:4024`).
  - Row menu (`#deviceActions`): for an active device, Edit, Disable (unchanged), then

```ts
      <wt-button
        variant="danger"
        data-test=${`delete-device-${device.id}`}
        @click=${(event: Event) => this.#openDelete(device, event.currentTarget as HTMLElement)}
        >${t("action.delete")}</wt-button
      >
```

    and for a disabled device a menu holding only that button (remove the `if (!device.active) return nothing;` early return; keep `.rowClickable` at :1664 as it is). Use the printers screen's row-menu opener lookup (`#rowMenuButton`, `printers-screen.ts:2359`) so Escape returns focus to the menu's button.
  - `#deviceGone` runs when a live list refresh no longer has the device (deleted in another tab), and on `device.not_found` from the read or the delete, setting the screen's error to `device.not_found` only when something was open on it and the delete in flight was not this screen's own (same rule as `printers-screen.ts:4034-4060`).

- [ ] **Step 5: Run until green, then the screen's other suites.**

```
pnpm --filter @waitron/dashboard exec vitest run src/widgets/device-delete-copy.test.ts src/screens/devices-screen.test.ts src/screens/devices-screen.a11y.test.ts src/screens/devices-screen.save-state.test.ts src/api/live-queries.test.ts src/api/client.test.ts
pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/pinned-actions-column.test.ts scripts/native-form-fields.test.ts scripts/style-token-names.test.ts
```
Before a browser run, check free memory (`memory_pressure | grep free`) and run beside another session's browser run only when free memory is well above 15%. In `devices-screen.a11y.test.ts`, add axe runs, both themes, for the dialog open and ready, open and refused, and loading; and one for a disabled row's menu open.

- [ ] **Step 6: Commit.** `git commit -s -m "Dashboard: delete a device from its row, after a confirmation that says what the delete will do"`

### Task 7: Look at it: screenshots

**Deliverable:** the dialog and the row menus seen in the real dashboard, EN and ES, light and dark, at 1280 and 390 wide, with anything wrong fixed in Task 6's files (test first) before this task closes.

**Files:** none committed, unless a defect is found (then a fix with its own failing test, committed separately). Screenshots go in `mktemp -d`, never in the worktree.

- [ ] **Step 1:** `wa-wt ls`, confirm this worktree is registered, then `wa-wt demo waitron-feat-a435-4-device-delete`. Check nothing else holds the venue first (`lsof` on the venue folder and port 8080), and never run `wa-wt reset` on a slot another lane uses.
- [ ] **Step 2:** Make two devices: enrol one by opening the till in a second browser context and pairing it from the dashboard's Add a device (or in dev mode, by knocking), give it a made-here station, an approved profile and a card reader choice, sign in on it, and disable a second one.
- [ ] **Step 3:** With the workspace's Playwright Chromium, capture at 1280×800 and 390×844, light and dark, EN and ES: the active row's open menu; the disabled row's open menu; the dialog loading (throttle the request or take it from the browser test); the dialog ready. The refused dialog comes from the Task 6 browser test fixture (a `page.screenshot()` in a throwaway run), because putting a stuck payment into the dev venue means writing its database by hand.
- [ ] **Step 4:** Look at every image. Check: the device's name in bold; the groups in order; long names wrap without clipping; the footer's buttons are reachable at 390 wide; Delete is quiet while loading or refused and red when ready; Spanish fits. Then press Escape and check focus returns to the menu button; Tab through the dialog.
- [ ] **Step 5:** Stop only the processes you started, by the ids you recorded. Report the image paths and what was checked.

### Task 8: Docs, backlog and the final sweep

**Deliverable:** current prose says what Disable and Delete do to a device; the backlog's step 4 entry is gone; the final checks run.

**Files:**
- Modify: `CLAUDE.md` (:346-348: "A deleted printer or device is not matched … and comes back under a new id"; keep it one to three lines)
- Modify: `docs/developers/conventions-ui.md` (:545-575: in the devices paragraph, a deleted device's knock is not matched and arrives as a new device; Delete signs it out, ends its hold and its request to come back)
- Modify: `docs/developers/design-system.md` (after the printer paragraph at :3427-3430: "A device offers both…", two or three lines)
- Modify: `docs/backlog.md` (A435 entries at :4863-4875)

- [ ] **Step 1: Sweep for stale prose and missed reads.** Run `rg -n "from\(devices\)|\.from\(devices|join\(devices|Join\(devices|update\(devices\)" apps packages -g '*.ts' -g '!*.test.ts' -g '!**/testing/**'` and compare every hit with the inventory's three lists; any new hit is classified and either filtered (with a test) or listed as history. Then `rg -n -i "revoke|disabled device|never a hard DELETE|durable identity" packages/db/src/schema/devices.ts apps/server/src/device-api.ts apps/server/src/errors.ts docs/developers README.md`: change only sentences that are now false, and prefer deleting to rewording.
- [ ] **Step 2: Backlog.** Delete the line "A435 step 4 — devices: …". Update the A435 header's "steps 3–6 open" and "Card readers are next" to what is true when this lands (check whether step 3 has landed: `git log --oneline origin/main | rg -i "card reader.*delet|A435 step 3"`). Any open point this branch leaves (for example, if the owner wants sign-ins named rather than counted, Plan default 12) becomes its own short entry in the same area, ending "Left open by A435 step 4." Do not add entries for decisions the owner has not questioned.
- [ ] **Step 3: Final checks.** Run, reading each `Tests` count and exit status:

```
pnpm exec vitest run scripts/claude-md-pointers.test.ts scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/live-subscriptions.test.ts scripts/module-seams.test.ts scripts/id-columns-are-references.test.ts scripts/pinned-actions-column.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts src/write-path.e2e.test.ts
git diff ad64b10be --stat -- packages/fiscal-verifactu
pnpm format:check && pnpm lint
```
Expected: all green and the fiscal diff empty. `docs/` is ignored by prettier, so for a doc file use `pnpm exec prettier --file-info <file>` before believing a clean `--check`; `CLAUDE.md` is checked. No whole-workspace test run: CI runs the package suites and coverage.
- [ ] **Step 4: Commit.** `git commit -s -m "Docs: a deleted device comes back only as a new device; backlog drops A435 step 4"`
- [ ] **Step 5:** Tell the owner the branch is ready for `finish-branch`. This branch touches a migration, a permission-gated route and identity (device tokens and sign-ins), so it takes the full review path, with two run-it reviews.

## Existing tests this branch changes

Changed, and stricter than before:

- `apps/dashboard/src/screens/devices-screen.test.ts:824` (a disabled row now has a one-item menu holding Delete) and `:841` (the active menu gains Delete), as Task 6 Step 2 describes.
- Any test that pins the dashboard's `device.payment_in_progress` wording as a literal. The one found (`devices-screen.test.ts:2016-2025`) compares with `codeMessage(...)`, so it follows the new wording without an edit; check for others with `rg -n "Change its profile once" apps/dashboard/src`.
- Any test double implementing `VenueServiceContribution` in full gains the two seat methods (Task 2).

Unchanged and expected to stay green: every disabled-device case in `apps/server/src/device-api.test.ts` (including :669, :1736, :1881-1920, :3128), `join-requests.test.ts`, `join-e2e.test.ts`, `configuration-transfer.test.ts:1736`, `printer-delete.db.test.ts` and `print-api.printer-wiring.test.ts`; the golden huella test and `inmutabilidad`, unedited.

## Plan self-review

- Spec "Devices": refusals (Task 3), ended sign-ins, holds and request (Task 3), no way back (Tasks 3–4), removed settings (Task 3), open orders untouched (Task 3's history comparison), history kept and named (Tasks 3 and 5). Shared model: two calls with one set of rules (Task 3), routes and permission (Task 3), the shared dialog (Task 6). Testing: each item maps to a named case in Tasks 3–6.
- Interfaces: item keys, seat methods, join-request helpers, server functions and client methods are named the same in every task that uses them.
- Corrections and defaults are listed above, each with the line it rests on. Nothing here has been run; every claim about behaviour is a reading of code at `ad64b10be`, and each task's first step turns it into a test.
