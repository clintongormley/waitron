# A till is a device — design (A238, piece 1 of 3)

Status: design approved in conversation with the owner, 2026-10-03; this written spec awaits review.
Backlog: A238 (`docs/backlog.md`). Pieces 2 and 3 are separate backlog entries and are NOT in this
spec.

## 1. The problem

Waitron has two things called a "till":

- **A till device**: a screen at the counter, a row in `devices` whose profile has the `till` form
  factor.
- **A till record**: a row in the `tills` table (`packages/db/src/schema/tenants.ts`) with a name, a
  receipt printer and an "opens the cash drawer" switch, and no screen of its own. Sales, payments,
  orders, sign-ins, drawer openings, alerts and order history are all stamped with one.

Pairing a till device creates a till record with the same name (`createRegister`,
`apps/server/src/device.ts`). A handheld has to be pointed at an existing record
(`resolveDeviceBinding`). Setup creates one more record with no device behind it, and the server
uses its id as a process-wide default (`cfg.tillId`, `WAITRON_TILL_TILL_ID`,
`apps/server/src/till-config.ts`). Several routes use that default even when the request came from
a device, so a receipt reprint picks the setup till's printer rather than the device's
(`till-api.ts`, the receipt, payment-slip and reprint routes, through `receipt-print.ts`). The
device's own `receipt_printer_id` is saved and shown but nothing prints from it.

The owner expected a Prepare or Live venue to start with no devices and add each one.

## 2. Owner decisions (2026-10-03)

1. A till is a device. The `tills` table goes. A counter can have two tills, each with its own cash
   drawer, counted separately.
2. Every stamped record carries a **source**: usually the device, otherwise a named non-device
   source (the dashboard, a background job and so on), as a hint of where it came from.
3. Every device has two switches: **Takes cash** (on by default for the `till` form factor, off for
   every other) and **Opens the cash drawer** (available on any device whose receipt printer has a
   drawer, handhelds included). Even without a float a waiter can take cash, just without giving
   change.
4. A waiter's cash float belongs to the waiter, not the handheld. A float decides whether that
   waiter may take cash on a handheld, and is settled at a till before the waiter leaves. That is
   piece 3, not this spec.
5. Recorded cash in and out of a drawer is piece 2, not this spec.
6. The Printing rules screen is the one place a device's receipt printer and drawer switch are set,
   for now; the screen needs revisiting later (backlog).
7. Demo venues start with no devices too. Sample sales are recorded with source `demo_seed`.
8. This ships with a **venue reset**: existing venues, the owner's box included, are wiped and set up
   again. No code carries existing data across.

## 3. The source

Every record that today names a till names a **source** and, when the source is `device`, the
**device**. Two columns replace each till column: `source` (a `label` column) and `device_id` (an
`id` column, nullable, foreign key to `devices`, `restrict`).

The sources are a fixed list in code, in `@waitron/shared`, beside the other cross-package
vocabularies:

| Source              | Meaning                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `device`            | Done on a paired device; `device_id` names it.                        |
| `dashboard`         | Done by a signed-in manager in the dashboard.                         |
| `fiscal_filing`     | The Veri\*Factu filing and checking passes.                           |
| `payment_check`     | The card payment and bill payment checking loops.                     |
| `kitchen_timer`     | Kitchen alerts raised by time or by a course release.                 |
| `demo_seed`         | Sample data written by the Demo seed.                                 |
| `readiness_test`    | The fiscal readiness test sale, in its own scratch database.          |

The implementation adds a source for any other background writer it finds; each one is a named job,
never a generic `system`.

**The database enforces the pairing.** Each table carries a CHECK that `device_id` is not null
exactly when `source = 'device'`, and a CHECK that `source` is one of the list. Two kinds of table are
held tighter:

- **Sales and the payments that file them** (`sales`, `registros_facturacion`, `bill_payments`,
  `bill_payment_refunds`, `payments`): `source` is one of `device`, `demo_seed`, `readiness_test`.
  A sale is never recorded from the dashboard or a background job without a device. The one
  dashboard path that files a sale, resolving a stuck card payment, files it under the device that
  started the payment (§5).
- **Till sign-in sessions** (`sessions`): always `device`, so the table keeps a non-null `device_id`
  and needs no `source`.

### Tables that change

| Table                   | Today                                | After                                                     |
| ----------------------- | ------------------------------------ | --------------------------------------------------------- |
| `tills`                 | the till record                      | **dropped**                                               |
| `devices`               | `till_id` (nullable)                 | `till_id` dropped; gains `takes_cash`, `opens_drawer` (§4) |
| `working_orders`        | `till_id`, finds its location by it  | `source`, `device_id` (who opened it) and `location_id`   |
| `sales`                 | `till_id`                            | `source`, `device_id`                                     |
| `registros_facturacion` | `till_id` (informational)            | `source`, `device_id` (informational, not hashed)         |
| `payments`              | no till; reads the order's           | `source`, `device_id` (the device that started it)        |
| `bill_payments`, `bill_payment_refunds` | `till_id`            | `source`, `device_id`                                     |
| `unpaid_departures`     | `till_id`                            | `source`, `device_id`                                     |
| `order_amendments`      | `captured_by_till_id`                | `captured_by_source`, `captured_by_device_id`             |
| `incidents`             | `till_id`, in the open-alert unique index | `source`, `device_id`; the index keys on both        |
| `drawer_opens`          | `till_id`, tied to `reason` by a CHECK | `device_id`; the CHECK rewritten on the device          |
| `sessions`              | `till_id` (plain id)                 | `device_id` (not null, foreign key)                       |
| `time_entries`          | `captured_by_till_id` (nullable)     | `captured_by_source`, `captured_by_device_id`             |
| `daily_closes.snapshot` | `byTill[].tillId` in the JSON        | `byDevice[].deviceId`                                     |

`drawer_opens` needs no `source`: every opening but a calibration is made on a device, and a
calibration already records none.

Every trigger that names `till_id` or joins `tills` is rewritten in the same change:
`working_orders_enforce_transition`, `bill_payments_guard_update`,
`bill_payment_refunds_guard_update`, `device_binding_rule_insert`/`_update`, and the four
line-language triggers, which find an order's location through its till today and will read
`working_orders.location_id` instead.

**Device names become unique within a location**, replacing the till name rule
(`tills_tenant_location_name_key`). A source shown as a device's name has to identify one device.
`device.register_name_taken` is renamed `device.name_taken`. This is the designer's default, not an
owner decision; strike it in review if unwanted.

### Hashes

- **Order history** (`packages/db/src/order-amendment-hash.ts`): `CapturedByTillId` becomes
  `CapturedBySource` and `CapturedByDeviceId` (empty when none).
- **Working time** (`packages/workforce/src/chain-hash.ts`): the same change.
- **Daily close** (`packages/reporting/src/daily-close-hash.ts`): hashes its snapshot, so it covers
  `byDevice` once the snapshot changes.
- **Veri\*Factu huella**: does not include the till (`packages/fiscal-verifactu/src/chain.ts`) and is
  untouched.

Because the order history and working-time hashes change, history recorded on an existing venue no
longer verifies. That is why this ships with a reset (§9).

## 4. Device settings

- **Receipt printer**: the device's existing `receipt_printer_id`, now the one every print path
  reads (`receipt-print.ts`, `receipt-preview-api.ts`, `payment-slip-print.ts`). The receipt,
  payment-slip and reprint routes resolve it from the requesting device.
- **Opens the cash drawer** (`opens_drawer`, moved from `tills`): on by default for the `till` form
  factor, off otherwise. Settable on any device whose receipt printer has a drawer. Automatic
  openings and the manual Open drawer button read it. `assertNotHandheld`'s drawer refusal goes;
  the manual open is refused when the switch is off, as today (`drawer.till_switched_off`, renamed
  `drawer.device_switched_off`). A kitchen display never opens a drawer.
- **Takes cash** (`takes_cash`, new): on by default for the `till` form factor, off otherwise. A cash
  sale, a cash collection or a cash bill payment from a device with it off is refused with
  `device.cash_switched_off`. The till app does not offer cash on such a device and says to take
  cash at a till. Card payments are unaffected.

At the close, cash is counted against the device that took it (`packages/reporting/src/cash-up.ts`
groups by device).

The `cash.drawer` permission and the profile's drawer capability still apply as they do today.

## 5. Where each source comes from

| Path                                                            | Source / device                           |
| --------------------------------------------------------------- | ----------------------------------------- |
| Any till-app route (sell, park, seat, split, collect, pay, cancel, unpaid departure, print, reprint, drawer, sign-in) | `device`, the requesting device |
| Course release and the alerts it raises from a device route     | `device`                                  |
| Kitchen alerts raised by time                                   | `kitchen_timer`                           |
| Seating a booking from the dashboard (`packages/bookings/src/routes.ts`) | `dashboard`; the order carries its location |
| Resolving a stuck card payment (`payments-api.ts`)              | the sale is filed under the payment's own `device_id` |
| Attesting or resolving a bill payment or refund from the dashboard | reuses the stored source and device     |
| Fiscal filing and checking alerts (`drain.ts`, `reconcile.ts`)  | `fiscal_filing`. Today these alerts take the till of the record concerned; a pass skipped with no record behind it raises none, only a log line, because an alert needs a till (`apps/server/src/pass.ts`). This change makes such an alert possible; raising one is not in scope. |
| Card and bill payment checking loops and their alerts           | `payment_check`                           |
| Demo sample sales (`apps/server/scripts/demo-seed/`)            | `demo_seed`                               |
| Fiscal readiness test sale (`fiscal-readiness-runner.ts`)       | `readiness_test`                          |

The PIN retry limit is keyed by device instead of till. The trusted clock's `tillId`
(`packages/fiscal/src/clock.ts`) becomes a device id; nothing in production creates the clock today.

## 6. Server configuration

`TillConfig.tillId`, `WAITRON_TILL_TILL_ID` and every writer of it go: setup (`setup-api.ts`),
adopt (`adopt.ts`), promotion (`boot.ts`), the mirror bundle (`mirror-bundle-fetch.ts`),
`scripts/dev-setup.ts` and `scripts/cloud-integration-fixture.ts`. The server starts with no
default till. `deviceTillCfg` (`device-session.ts`) becomes the request's device context, carrying
the device id, its printer and its two switches. A path with no device passes its source
explicitly; nothing falls back to a default.

## 7. Setup, provisioning and pairing

- **Setup** creates no till. The `create-till` step and `tillName` leave the venue plan
  (`packages/provisioning/src/venue-plan.ts`, `venue-apply.ts`), the setup request
  (`setup-api.ts`), the wizard's venue page and its strings (`apps/setup/src/screens/venue-screen.ts`,
  `apps/setup/src/i18n/strings/venue.ts`) and the provisioning command's `--till-name`
  (`packages/provisioning/src/cli.ts`).
- **Finding a half-finished setup again** (`recoverProvisionedVenue`, `apps/server/src/provision.ts`)
  matches on location, node and series alone.
- **The Prepare to Live transfer** (`configuration-transfer.ts`) drops `tillName`.
- **Pairing**: `createRegister` and `requireLiveRegister` go. The handheld's till picker leaves the
  accept dialog (`apps/dashboard/src/screens/devices-screen.ts`). `device.register_required` and
  `device.till_required` are deleted.
- **Demo** creates no device. You pair one as in any venue.
- **`scripts/dev-setup.ts`** keeps seeding its till, handheld and kitchen display through the real
  pairing path, now with no setup till beside them.

## 8. Screens

- **Printing rules** (`printing-rules-screen.ts`): lists every device that can print, with its
  receipt printer and, where the printer has a drawer, the drawer switch. It also shows the Takes
  cash switch for every device that can sell. Routes in `print-api.ts` move from tills to devices.
- **Devices screen**: the receipt printer picker in the hardware editor goes.
- **Sales, payments and the printer detail page** show the device's name, or the source's name
  (in English and Spanish) when there is no device. The Sales screen's per-till table stops showing a
  raw id as its row heading.
- **Live updates**: `apps/dashboard/src/api/live-queries.ts` stops naming `tills`, and the server's
  matching subscription sources change with it (`scripts/live-subscriptions.test.ts`).
- **Till app**: no cash option where Takes cash is off, with a line saying to take cash at a till;
  the Open drawer button shows where Opens the cash drawer is on.

## 9. Migrations and the reset

New migrations are generated in each affected set; no shipped migration file is edited. Several
changed tables are append-only or are pointed at by cascading keys. A drizzle table rebuild on this
engine runs with foreign keys on and can empty a cascading child table (CLAUDE.md §3), so every
rebuild is checked against the keys pointing at its table. `scripts/migration-upgrade.test.ts` will
need a `RESETS` entry at the step that cannot carry rows from a till column into a source column.

The PR's first line says it needs a venue reset. The dev venue is rebuilt with
`wa-wt reset demo <name>`; the owner's box is set up again.

## 10. Testing

Failing test first for each behaviour. The cases that must tell the old behaviour from the new:

- Receipt, payment-slip and reprint printing from a device whose printer differs from every other
  device's printer.
- A cash sale, cash collection and cash bill payment refused with `device.cash_switched_off` when
  Takes cash is off, and accepted when it is on, on a handheld as well as a till.
- Automatic and manual drawer openings on a handheld with the switch on, and none with it off.
- The database refusing a row whose source and device do not pair, a sale with source `dashboard`,
  and an unknown source.
- The order history and working-time hashes differing when only the source or only the device
  differs.
- Setup completing with no till, the setup retry finding the venue, and the server starting with no
  `WAITRON_TILL_TILL_ID`.
- A stuck card payment resolved from the dashboard filed under the device that started it.
- Seating a booking from the dashboard recording `dashboard`, and a fiscal filing alert recording
  `fiscal_filing`.
- The cash-up and the daily close grouping by device.
- Each changed screen opened and looked at in both themes and at phone width.

Database tests keep using `useVenueDb`. The roughly 110 test files that insert into `tills` move to
a shared helper that pairs a device.

## 11. Docs and rules to update in the same change

- CLAUDE.md §5's drawer rule: a handheld may open a drawer when its switch is on; the rule names
  `opens_drawer` on the device and `takes_cash`.
- `docs/developers/conventions-ui.md`'s drawer section, which states the handheld rule.
- Every prose claim about tills, the setup till or `WAITRON_TILL_TILL_ID`, across the whole tree
  (CLAUDE.md §1, "a behaviour change retires every receipt about the old behaviour").
- `docs/backlog.md`: A238 closed; its findings retired.

## 12. Out of scope

- Piece 2, recorded cash in and out of a drawer (backlog).
- Piece 3, waiter floats (backlog).
- A mock printer in Demo mode (backlog).
- Revisiting the Printing rules screen (backlog).
