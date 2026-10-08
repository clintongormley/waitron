# A394 — refusal statuses by one rule: the audit and its follow-ups

The audit was read, not run (2026-10-08). The owner's rule is in `docs/developers/conventions-data.md` → "A refusal's HTTP status says what was wrong". Each follow-up below is one pull request. Appendices A–C keep the per-route rows the three readers recorded.


**What this is.** One read-only audit of how every API in the repo picks the HTTP status of a
refusal, checked against the owner's rule. Date 2026-10-08. Base: `origin/main` at `164de74f1`
(`git -C /Users/clintongormley/workspace/repos/waitron rev-parse --short origin/main`). The three
part files were read at `d5e09a322`; `git diff --stat d5e09a322 origin/main` shows no audited route
file or status table changed between the two (the diff touches the configuration import in
`packages/venue-service`, `apps/setup/src/setup-app.ts` — which moved its 404 branch from `:393` to
`:398` — tests and the backlog).

**Nothing was run.** No test, no server, no request. Every row is a reading of the source with a
`file:line` receipt, and every "answers 500" is "read, not run". The merge reader re-read 16 rows
across the three parts against the code (list below) and corrected the part files where they were
wrong, each correction marked "corrected by merge reader".

**The rule.** The thing the request's path points at is missing → 404. Something the request body
(a form, a bundle, an import) refers to is missing or unusable → 400. A clash with data already
stored → 409. A file or copy that cannot be opened → 422. Sign-in, permission, rate-limit and
upstream statuses (401/403/429/500/502/503) are outside the rule and listed only where they look
plainly wrong.

**Row detail lives in the parts:** Appendix A below (setup, till,
catalogue, and the adjustments, bookings, media and venue-service packages),
Appendix B below (alerts … membership-removal), Appendix C below
(mirror-bundle … workforce).

## Totals

Boundaries: **49**, in 40 files (`git grep -c "createErrorBoundary(" -- '*.ts' ':!*.test.ts'
':!packages/server-kit/src/error-boundary.ts'`). All 40 files are covered by one part. Codes are
counted once per boundary, so a code on two boundaries counts twice; the parts' counts are partly
approximate ("about").

| Part | Boundaries | Codes checked | Status rows off the rule | Defects (no code, or a 2xx for a missing id) | Owner questions |
| --- | --- | --- | --- | --- | --- |
| 1 | 15 | about 200 | 57 (29 code-on-boundary pairs) | 6 (part 1 lists them under "Out-of-rule") | 10 |
| 2 | 17 | about 220 | 20 | 2 | 6 |
| 3 | 17 | about 127 | 19 (2 of them "unclear") | 9 | 6, plus 7 codes in one 422 question |
| **All** | **49** | **about 550** | **96** | **17** | **22 rows, grouped into 16 questions below** |

(Part 2's and part 3's own section counts include their defect rows; they are split out here.)

Most rows are one shape: **an id the request BODY (or query string) names answers its
`*.not_found` 404**, because the boundary's table maps the code to 404 for the path case and the
body case shares the code. By my count of the part tables that shape is about 70 of the 96.

### What the merge reader re-read (read, not run)

1. `packages/server-kit/src/error-boundary.ts:22-43` and every `createErrorBoundary(` call — see
   "The mechanism".
2. Part 1, setup: `provisioning.foreign_tenant` is absent from `PROVISION_STATUS`
   (`apps/server/src/setup-api.ts:183-208`) and thrown at
   `packages/provisioning/src/tenant-guard.ts:49` from `apps/server/src/provision.ts:135` — default
   400. Confirmed.
3. Part 1, till: `PATCH /api/working-orders/:id/lines/:lineNo/course` takes `courseId` from the
   body (`till-api.ts:2935-2938`) and `course.not_found` is 404 in `STATUS`. Confirmed; **the line
   numbers part 1 cited for six till `STATUS` rows were wrong** — corrected.
4. Part 1, till: `GET /api/service-zones/:zoneId/offers` is the one path-zone route
   (`till-api.ts:1347-1352`). Confirmed.
5. Part 1, bookings: `table.not_found` 404 (`packages/bookings/src/routes.ts:48`) for a body
   `tableId` (`:88`) thrown at `bookings.ts:65`. Confirmed.
6. Part 1, venue-service: the routing grid's save throws `service_zone.not_found` for a body zone in
   a switched-off department (`packages/venue-service/src/routing-store.ts:108-115`), 404 at
   `routes.ts:110`. Confirmed.
7. Part 1, catalogue: `PUT …/default-catalogue` with an unknown location answers 204
   (`packages/catalogue/src/operations.ts:1238-1268`: the read finds no row, the update matches
   none). Confirmed.
8. Part 2, device-api: `PATCH /management-api/devices/:id` passes the body's `profileId` to
   `resolveDeviceBinding`, which throws `device_profile.not_found` (`apps/server/src/device.ts:358`),
   404 in `device-api.ts:137`. Confirmed; the section's row count corrected (5, not 6).
9. Part 2, management-api: `PUT /management-api/products/:id/course` answers 204 for an unknown or
   malformed product id (`management-api.ts:2228-2241`, `kitchen.ts:521-533`). Confirmed; **five
   status-table line numbers in part 2 were wrong** (`management-api.ts:291,298,300,305,315`, not
   `:303,308,310,315,316`) — corrected; row count corrected (7, not 6).
10. Part 2, diagnostics: the table has three entries (`diagnostics-api.ts:32-36`) and
    `authorizeManager` (`packages/identity/src/manager-login.ts:162-175`) can throw
    `management_session.expired` and `person.suspended`, so both answer 400. Confirmed.
11. Part 3, recipes: followed the unknown-ingredient chain to the client — see "Defects".
12. Part 3, purchasing: `updatePurchaseInvoice` (`packages/purchasing/src/operations.ts:298-321`)
    has no unique-violation translation; the constraint is
    `purchase_invoices_supplier_number_key` (`packages/db/src/schema/purchase-invoices.ts:83`).
    Confirmed.
13. Part 3, payments: `POST /stuck/:id/resolve` answers `payment.not_stuck` 409 when `row` is
    undefined (`payments-api.ts:835-842`). Confirmed.
14. Part 3, units: the reassign route raises `unit.not_found` for the path (`units-api.ts:130`) and
    for the body's target (`packages/catalogue/src/units.ts:215-216`). Confirmed.
15. Part 3, workforce: `createRosterVersion` inserts the body's `locationId` with no check
    (`packages/workforce/src/clocking.ts:371-387`). Confirmed.
16. Part 3, orders and recipes: `printer.not_found` from the body `printerId`
    (`orders-api.ts:196`, `orders-reprint.ts:23-33`); `PATCH /ingredients/:id` answers 204 for an
    unknown id (`packages/recipes/src/ingredients.ts:75-78` does not read the row count,
    `recipe-api.ts:129-130`). Confirmed. Part 3's status-table line numbers all re-read correct.

## The mechanism: one table per boundary

`createErrorBoundary(status, tag)` (`packages/server-kit/src/error-boundary.ts:22`) answers an
`AppError` with `status[cause.code] ?? 400` (`:33`) and anything else with an opaque
`server.internal` 500 (`:39-40`). So inside one boundary a code answers the same status on every
route the boundary serves. **Confirmed by reading.**

**Part 1's corollary needed a correction: a per-route status is already possible today, with no
change to server-kit.** A route gets its own status for one code by being wrapped in a second
boundary built from a spread of the same table. `apps/server/src/catalogue-api.ts:351-354` does
exactly this: `runSize = createErrorBoundary({ ...STATUS, "product.variant_not_found": 404 }, …)`,
so that code answers 404 on the single-size route (path id) and 400 on the whole-list PUT (body
ids). `setup-api.ts:265-296` spreads tables the same way. So no follow-up has to wait for a
server-kit mechanism.

What a table cannot do: split one code on **one** route where the path and the body (or the path
and stored state) can both raise it. Those rows need a second code at the throw site:
`unit.not_found` on the units reassign route, `payment.not_stuck` for an unknown payment,
`ticket.invalid_transition` for an unknown ticket item and for a bad body `to`,
`device.pairing_hold_lapsed` (path on `/renew`, body on `/check` — two routes, so a table would
do, but the code is shared with real lapses), `table.zone_inactive` and `table.inactive` (body
versus stored state), `cloud.binding_conflict`, `setup.request_invalid {field:"artifact"}`.

Codes that already answer more than one status today, on different boundaries:
`passkey.not_registered` (404 `me-api.ts:76`, 401 `management-api.ts:263`), `person.not_found`
(401 `till-api.ts:377`, 404 `management-api.ts:269`), `table.inactive` (409 `till-api.ts:481`, 400
`packages/bookings/src/routes.ts:49`), `zone.department_inactive` (400 on the configuration import
since A393, 409 at `packages/venue-service/src/routes.ts:109` and `management-api.ts:295`),
`service_zone.not_found` (400 on the import, 404 on the till and venue-service).

## Client contract: clients branch on the code, not the status

Grep run on 2026-10-08 over the client trees:

```
/usr/bin/grep -rnE '\bstatus\b[^,;]{0,20}(===|!==)\s*[0-9]{3}|[0-9]{3}\s*(===|!==)[^,;]{0,20}\bstatus\b' \
  apps/dashboard/src apps/till/src apps/setup/src apps/print-agent/src packages/*/src/dashboard \
  packages/dashboard-kit/src packages/print-agent/src --include='*.ts' | /usr/bin/grep -v '\.test\.ts'
```

It found eight lines, none on a route a follow-up changes:

- `apps/till/src/state/department-transfer-monitor.ts:39,172` — 401 and 403 only.
- `apps/setup/src/setup-app.ts:398` — `status === 404` in `describeConnectionFailure`, the setup
  app's "is this box already set up" probe; no follow-up adds a 404 to a setup route.
- `packages/print-agent/src/client.ts:154-156,413` — 401, 403, 429 and "not 201" on
  `/api/node/enrol-self`, where part 3 found no mismatch.
- `apps/dashboard/src/screens/menus-screen.ts:920` — `!== 200` on the parts of the `/read` answer.

The parts ran narrower greps of the same trees (`'\b(404|409|422)\b'`, `'\.status\b'` with common
error names, and each mismatch's code string) and found nothing more.

How the request helpers carry a refusal: the dashboard's `createRequest` rejects with
`{ code, params?, status }` and its contract says callers branch "on a stable domain code, never an
HTTP status" (`packages/dashboard-kit/src/request.ts:31-46,122-125`); the till's client throws
`{ ...params, code, status }` (`apps/till/src/api/client.ts:3488`); the setup app passes `status`
through (`apps/setup/src/api/client.ts:166-176`). Session handling also keys on the code: the
dashboard signs a person out on `management_session.expired`, `management_session.required` or
`person.suspended` whatever the status (`apps/dashboard/src/main.ts:19-27`).

Representative code branches a status change leaves alone:
`apps/dashboard/src/screens/catalogue-screen.ts:946-949` (course and category to their fields),
`apps/dashboard/src/screens/devices-screen.ts:112`, `apps/dashboard/src/widgets/order-reprint-dialog.ts:78`,
`apps/till/src/till-app.ts:368,374,467,553,557,727`,
`packages/venue-service/src/dashboard/prep-stations-screen.ts:1820,2015,2027`.

One promise to update: a doc comment at `apps/till/src/api/client.ts:2723` says
`course.not_found` is 404 (part 1).

So, as far as grep shows, every status renumbering below is a change to the number only, not to
a contract a client reads. **The contract that moves is the tests that pin today's number.** A
follow-up that introduces a NEW code (the code splits) is different: a client that maps the old
code to a field or a sentence needs the new one mapped too, in English and Spanish.

## Mismatches, grouped by follow-up

Each group names the follow-up that fixes it (see "Follow-up items"). Row detail and the tests that
pin today's number are in the part named.

- **Venue-service routes (A394-8)** — part 1: `department.not_found` (zones, body),
  `service_zone.not_found` (routing cell, preview, explain), `route.subject_not_found`,
  `route.station_inactive` (409, body), `catalogue.not_found`, `department_menu.not_found` → 400.
- **Till, tables, zones, readers (A394-9)** — part 1: `service_zone.not_found` on 7 body or query
  routes, `reader.not_found` (body `readerId`), `table.not_found` and `table.inactive` (body),
  `zone.not_found`, `status.not_found`, `working_order.not_found` on `/api/dead-ends/order` → 400.
- **Till, lines, groups, drafts, courses (A394-10)** — part 1: `tab.line_not_found`,
  `group.not_found`, `draft.not_found`, `course.not_found`, `station.not_found`,
  `adjustment_reason.not_found` (body, under the till's `run`) → 400.
- **Catalogue statuses (A394-11)** — part 1: `catalogue.not_found`, `category.not_found`,
  `menu_section.not_found`, `course.not_found`, and under `runFolder` `category.not_found` and
  `product.not_found` (all body or query) → 400.
- **Management API (A394-12)** — part 2: `printer.not_found` (device profiles), `zone.not_found`
  (tables, watchers), `station.not_found` (watchers), `course.not_found` (product course) → 400;
  `table.zone_inactive` for a body zone → 400 with a code split.
- **Devices and joining (A394-13)** — part 2: `device_profile.not_found`, `station.not_found`,
  `watcher.not_found` from bodies on `PATCH /devices/:id` and `/device-join-requests/:id/accept` →
  400; `ticket.invalid_transition` for an unknown ticket item → 404 and for a bad body `to` → 400;
  `device.pairing_hold_lapsed` on `/check` (body) → 400 and on `/renew` (path) → 404.
- **Printing, orders, reports (A394-14)** — part 3: `printer.not_found` from a body on
  `/orders/:id/reprint`, `/reports/categories/print`, `/watchers/:id/printers`,
  `/stations/:sid/printers` → 400; `watcher.not_found` on `/printers/:id/watcher` → 400;
  `printer.invalid_config` 422 → 400.
- **Payments (A394-15)** — part 3: `payment.provider_unknown` (body, 2 routes), `reader.not_found`
  (body, 2 routes) → 400; `reader.not_listed` on adopt 422 → 400; `payment.not_stuck` for an unknown
  payment 409 → 404.
- **Setup (A394-16)** — part 1: `provisioning.foreign_tenant` (provision, adopt),
  `provisioning.second_venue` (adopt), `mirror.environment_mismatch` (adopt) default 400 → 409.
- **Shift swaps (A394-17)** — parts 2 and 3: `shift.not_found` from the body on
  `POST /management-api/me/schedule/swaps` and `POST /api/schedule/swaps` → 400.
- **Bookings package (A394-18)** — part 1: `table.not_found` (body, 3 routes) → 400.
- **Adjustments package (A394-19)** — part 1: `adjustment_reason.not_found` on `PUT /reason-order`
  (body `ids`) → 400.
- **One-off rows that wait on an owner answer (A394-20)** — `units-api` target unit (code split),
  `venue.detail_read_only`, `cloud.binding_conflict`, `promotion.not_a_local_secondary`,
  `department.not_found` as a query value on receipt preview, `backup.stream_test_failed` 422,
  `backup.recovery_key_too_short` against a stored key, the till's `reader.not_found` when the
  device has no reader.

## Statuses outside the rule that look wrong

- **Diagnostics answers 400 for an expired session and for a suspended person** (A394-7).
  `diagnostics-api.ts:32-36` maps neither `management_session.expired` nor `person.suspended`,
  though its gate throws both; every sibling boundary answers 401 and 403. The dashboard still
  signs the person out, because it reacts to the code (`apps/dashboard/src/main.ts:19-27`), so the
  visible effect is small; no test covers either case.
- **Server faults answered 400, as if the request were wrong** (A394-21): the configuration export's
  `setup.request_invalid` when the box's own venue row, series or stored locales are broken
  (`configuration-transfer.ts:22-25,99-107,174-195,264-279`); `server.credential_unusable` on
  `GET /management-api/email/settings` (`email-settings-api.ts:98`); `backup.effective_mismatch`
  after a successful write (`backup-api.ts:294,333,342`); `management.request_invalid
  {field:"locationId"}` when the box's own location row is missing (`location-settings-api.ts:42,123,154`);
  `mirror.no_relay`, `mirror.not_provisioned`, `module.config_invalid` on the mirror bundle;
  `menu.reset_required` (catalogue, stored data). In the same family, answered 409:
  `time_zone.unreadable` (catalogue `:317`, venue-service `:123`), a broken venue setting.
- **Stored state answered 400**: `backup.request_invalid {field:"config"}` on rotate with no loaded
  destination (`backup-api.ts:184-186`); `email.settings_invalid {field:"recipient"}` when the
  caller's own account has no email (`email-settings-api.ts:136-137`).
- **Wrong code for the cause**: `booking.not_found` 404 when the booking exists but is no longer
  booked (`packages/bookings/src/bookings.ts:117,146-148`; a state clash, 409 as
  `booking.invalid_transition`); `payments-api.ts:628-629` answers `management.request_invalid
  {field:"providerId"}` on `/unpair`, which has no such field; `device_profile.not_found` 404 on
  `POST /api/device/join` in dev mode when the venue has no till profile (`device-api.ts:203`).
- **A malformed path id** answers `shared.invalid_id` 400 through `requireUuidParam`
  (`packages/server-kit/src/request-screens.ts:14-15`) on most boundaries, the resource's
  `*.not_found` 404 on management-api and orders-api, and 409 on three till routes (`tab.not_open`,
  `party.not_open`, `working_order.not_open`; reported by a part 1 reader, not re-checked). Owner
  question 7.
- `swap.not_permitted` 403 when the body's `toShiftId` belongs to someone other than its
  `toPersonId` (`packages/workforce/src/shift-swaps.ts:40-43`): the body contradicts itself, 400.

## Defects the audit found that are not status choices

These answer a server fault (500), or report success (204 or 200) for something that does not
exist. Each is real whatever the owner decides about statuses. All are "read, not run".

**How a foreign-key refusal reaches the client, followed once (recipes, read not run).**
`PUT /management-api/products/:id/recipe` (`recipe-api.ts:143-155`) screens each body id's shape
only and calls `setProductRecipe`, which inserts them unchecked
(`packages/recipes/src/recipes.ts:91-99`). The store turns foreign keys on for every connection
(`packages/store/src/index.ts:154`); `withTransaction` (`packages/db/src/tenancy.ts:30-42`) runs the
body under the write lock and translates nothing. So the driver's `FOREIGN KEY constraint failed`
reaches `error-boundary.ts:32` as a non-`AppError`, is logged at `error` under `recipe.failed`, and
the client receives `{ "error": { "code": "server.internal" } }` with status 500. The dashboard
helper turns that into `{ code: "server.internal", status: 500 }`. The other "foreign key → 500"
rows depend on the same chain.

| Where | What happens | Should be | Part | Follow-up |
| --- | --- | --- | --- | --- |
| `POST /management-api/roster`, body `locationId` | foreign key → 500 (`clocking.ts:385-387`) | 400 | 3 | A394-1 |
| `POST /management-api/roster/:versionId/shifts`, body `personId`/`locationId` | foreign key → 500 (`clocking.ts:453-455`) | 400 | 3 | A394-1 |
| `PATCH /management-api/roster/shifts/:shiftId`, body `personId` | foreign key → 500 (`clocking.ts:472`) | 400 | 3 | A394-1 |
| `POST /api/schedule/swaps` and `POST /management-api/me/schedule/swaps`, body `toPersonId` with no `toShiftId` | foreign key → 500 (`shift-swaps.ts:47-54`); part 2 left the me-api case "not established", it is the same function | 400 | 3 (2) | A394-1 |
| `PUT /management-api/products/:id/recipe`, body `ingredientIds` | foreign key → 500 | 400 | 3 | A394-2 |
| same, unknown product in the path | foreign key → 500 when the list is non-empty; empty list not established | 404 | 3 | A394-2 |
| `GET /management-api/products/:id/recipe`, unknown product | 200 `[]` | 404 | 3 | A394-2 |
| `PATCH /management-api/ingredients/:id`, unknown ingredient | 204 | 404 | 3 | A394-2 |
| `POST /management-api/products`, unknown body `catalogueId` | believed foreign key → 500 (`operations.ts:970-1017`) | 400 | 1 | A394-3 |
| `POST /management-api/locations/:locationId/catalogues`, unknown location | likely foreign key → 500 (`location-catalogues.ts:9-12`) | 404 | 1 | A394-3 |
| `PUT …/locations/:locationId/default-catalogue`, unknown location | 204 (re-read, confirmed) | 404 | 1 | A394-3 |
| `GET /management-api/catalogues/:id/products`, unknown catalogue | 200 `[]` (`operations.ts:1031-1043`) | 404 | 1 | A394-3 |
| `PUT /management-api/products/:id/course`, unknown or malformed product | 204 (re-read, confirmed) | 404 | 2 | A394-3 |
| `PATCH /management-api/purchase-invoices/:id` to another invoice's supplier number | unique index → 500 | 409 `purchase.duplicate` | 3 | A394-4 |
| `POST /setup-api/restore`, manifest entry not JSON | `JSON.parse` `SyntaxError` → 500 (`restore.ts:160`) | 422 (owner question 1) | 1 | A394-5 |
| cloud-recovery routes, Cloud upstream failing | plain `Error` → 500 (`cloud-recovery.ts:25-27`) | 502 with a code, as `mirror.bundle_fetch_failed` | 1 | A394-5 |
| `GET /management-api/email/message/:id`, unknown id | plain `Error` → 500, indistinguishable from Mailpit down (`mailpit-client.ts:63`) | 404 | 2 | A394-6 |

Not counted as defects: the adjustments report routes' `readLocationClock` throws a plain `Error`
(`packages/reporting/src/business-day.ts:228`), a server fault answered 500, which is right.

## Questions for the owner, each with a recommended default

1. **A restore archive that decrypts but is missing parts or holds unexpected entries**
   (`restore.archive_incomplete`, `restore.unexpected_entry`, `restore.unsafe_entry_path`,
   `restore.identity_incomplete`, default 400 today). **Recommend 422**, as the bucket restore
   already answers a copy missing its parts (`setup-api.ts:285,289`).
2. **A configuration export that decrypts but whose contents do not parse** (`setup.request_invalid
   {field:"artifact"}`, 400). **Recommend 422 under a new code** (the old one also covers real body
   faults), with the setup app mapping it to the file field in English and Spanish.
3. **Cloud restore naming a point that is not the bound one** (`setup.operation_conflict` 409).
   **Recommend keep 409**: it clashes with the saved binding.
4. **422 for things that are not files**: payments' `payment.provider_credential_rejected`,
   `payment.credential_environment_mismatch`, `payment.pairing_refused`,
   `payment.resolve_unsupported`, `reader.not_listed`, `payment.refund_exceeds_capture`,
   `payment.not_refundable`, and printing's `printer.invalid_config`. **Recommend reading the rule
   literally**: a body value the provider refuses → 400; the provider cannot do it, or the reader
   was unpaired → 409; 422 only for a file or copy.
5. **A bucket that cannot be opened** (`backup.stream_test_failed` 422). **Recommend keep 422**: a
   backup copy that cannot be opened.
6. **Bytes that are not an image** (`media.unsupported_type` 415). **Recommend 422**, the same
   answer as `image.invalid_file` for an upload that cannot be decoded.
7. **A malformed path id** (400 `shared.invalid_id` on most boundaries, 404 on two, 409 on three
   till routes). **Recommend 404**: an id that cannot exist names nothing. Done last, as its own
   item, because it touches every boundary.
8. **A query-string id** (receipt preview's `departmentId`, the till's `zoneId` on menu state,
   venue-service's routing explain, catalogue folder summary). **Recommend treating a query value
   like the body → 400.**
9. **A body naming a thing that exists but is switched off or the wrong kind**
   (`table.inactive` and `table.zone_inactive` from a body, `route.station_inactive`,
   `zone.department_inactive`, `menu_section.wrong_role`, `menu.shortcut_unreachable`,
   `extras.product_has_variants`, `station.always_open`, `printer.bluetooth_not_discovered`,
   `printer.bluetooth_not_paired`). **Recommend 400** ("unusable" in the rule), keeping 409 for a
   clash with stored state that does not depend on what the body named. This also makes A393's
   import (400) and the dashboard's saves (409 today) agree on `zone.department_inactive`.
10. **The request clashes with this box's own state, not with a row**: `mirror.environment_mismatch`,
    `promotion.not_a_local_secondary`, `backup.recovery_key_too_short` against a stored key,
    `cloud.binding_conflict` when no request is saved. **Recommend 409**, except
    `cloud.binding_conflict` with no saved request → 400 under a new code.
11. **A field the body may never set** (`venue.detail_read_only` 409, a fixed read-only list).
    **Recommend 400.**
12. **Server faults answered 400** (the list under "Statuses outside the rule"). **Recommend 500**
    for broken stored data or a broken server file, and **409** where the box is simply not set up
    for the request (`mirror.no_relay`, `mirror.not_provisioned`, rotate with no destination).
13. **A swap whose body contradicts itself** (`swap.not_permitted` 403). **Recommend 400.**
14. **The till's `reader.not_found` when the device has no reader at all** (404, pinned by
    `till-api.fiscal-sale-paths.test.ts:1106-1107`). **Recommend 409**: the device's set-up clashes
    with a card payment.
15. **The join `createdAt` version guard** (`join_request.not_found` 404 when the stored ask
    differs). **Recommend keep 404**: the ask at that path is gone.
16. **`person.not_found` 401 on the till** when the signed-in operator's own row has gone.
    **Recommend keep 401**: the session no longer stands; it is a sign-in answer.

## Follow-up items

"Clients" means a client that reads the status; none was found for any item, so every pure
renumbering is a light-path change by that measure. Items that ADD a by-id existence check (the
defect fixes) touch the "by-id read" risk trigger in `~/.claude/CLAUDE.md` and take the full path.
"Tests to change" are the tests the parts found pinning today's number (proximity matches — check
which case each covers); per the owner's 2026-10-05 rule each changed assertion is listed, old and
new and why, in the item's `item-a394-<n>-changed-tests.md`. Sizes: S = well under 40 tool calls,
M = about 40–80. **No item waits for a server-kit change** (see "The mechanism"). **PR #1399 has
landed** (`eb6403150`, merged 2026-10-08T08:29Z, part of this base), and on 2026-10-08 no open PR
touched any audited route file (`gh pr list --state open --json number,files`), so changes to
`apps/server/src/setup-api.ts` need not wait. Check open PRs again at dispatch.

Defect fixes first:

- **A394-1 — Workforce: an unknown person or location in a body crashes the request.** Files:
  `packages/workforce/src/clocking.ts` (`createRosterVersion`, shift create and update),
  `packages/workforce/src/shift-swaps.ts` (`requestSwap`'s `toPersonId`), route tests in
  `apps/server/src/workforce-api.test.ts`, `schedule-api.test.ts`, `me-api.test.ts`. Fixes: 500 →
  400, with `management.request_invalid {field}` as the default code (no `location.not_found`
  exists). Clients: none. Tests to change: none found pin the 500. Size S. Depends on: nothing.
- **A394-2 — Recipes: unknown ingredients and products crash, or answer success.** Files:
  `packages/recipes/src/recipes.ts`, `ingredients.ts`, `apps/server/src/recipe-api.ts` and its test.
  Fixes: unknown body ingredient 500 → 400; unknown path product 500/200 → 404 (`product.not_found`,
  already 404 in this table); unknown ingredient on `PATCH` 204 → 404 (a new `ingredient.not_found`,
  registered with dashboard wording). Clients: none. Tests: none found. Size S. Depends on: nothing.
- **A394-3 — Catalogue: unknown catalogues, locations and products answer 500, 204 or 200.** Files:
  `packages/catalogue/src/operations.ts` (the location functions; the schema file
  `packages/db/src/schema/location-catalogues.ts` does not change), `apps/server/src/catalogue-api.ts`,
  the product-course route in `apps/server/src/management-api.ts` with `kitchen.ts`. Fixes the five
  catalogue rows in the defects table. Clients: none. Tests: none found. Size M. Depends on: nothing.
- **A394-4 — Purchasing: editing an invoice to another invoice's supplier number crashes.** Files:
  `packages/purchasing/src/operations.ts` (`updatePurchaseInvoice`, the same `isUniqueViolation`
  translation create has). Fixes: 500 → 409 `purchase.duplicate`. Clients: none. Tests: none. Size S.
  Depends on: nothing.
- **A394-5 — Setup restore and cloud recovery: two plain errors become 500.** Files:
  `apps/server/src/restore.ts:160`, `apps/server/src/cloud-recovery.ts:25-27`, the tables in
  `setup-api.ts`, setup wording in `apps/setup`. Fixes: unparseable manifest → a `restore.*` code at
  422; Cloud upstream failure → a new code at 502. Clients: the setup app needs wording for the new
  codes. Tests: none found. Size S. Depends on: owner question 1.
- **A394-6 — Email test inbox: an unknown message cannot be told from the inbox being down.** Files:
  `apps/server/src/mailpit-client.ts`, `email-inbox-api.ts`. First probe what Mailpit answers for an
  unknown id (not established). Fixes: 500 → 404 for an unknown id, keeping
  `email.test_inbox_unavailable` for an outage. Clients: none. Tests: `email-inbox-api.test.ts`
  gains a case. Size S. Depends on: nothing.

Status changes:

- **A394-7 — Diagnostics: an expired session and a suspended person answer 401 and 403.** Files:
  `apps/server/src/diagnostics-api.ts:32-36` and its test. Changes 400 → 401/403. Clients: the
  dashboard reacts to the code already. Tests: none pin it; add two. Size S. Depends on: nothing.
- **A394-8 — Venue-service routes: ids from a body answer 400.** Files:
  `packages/venue-service/src/routes.ts` (table `:95-134`, second boundaries for the path routes),
  `routes.test.ts`, `menu-timetable-routes.test.ts`, `hours-routes.test.ts`. Changes the six codes
  in its group 404/409 → 400. **This is the item that settles A374's open point** (commit
  `7f0e38789`, backlog bullet "Done by A374 (#1403 …)"): under the rule the configuration import's
  400 for `service_zone.not_found` is already right (pinned by `apps/server/src/setup-api.test.ts:1229,1615-1632`),
  and it is the routing grid's save that should move from 404 to 400. No change to `setup-api.ts`.
  With owner question 9, `zone.department_inactive` and `route.station_inactive` → 400 too, which
  makes A393's import and the dashboard agree. Clients: code only (`menu-timetable-screen.ts:647,694,1376`).
  Tests to change: `routes.test.ts:409,843,1907,1913,1915,1920,1926,1933,1941,2056,2313`,
  `menu-timetable-routes.test.ts:335` (and `:381`, `hours-routes.test.ts:830,841` with question 9).
  Size M. Depends on: nothing (question 9 for its two optional rows).
- **A394-9 — Till, tables, zones and readers: body and query ids answer 400.** Files:
  `apps/server/src/till-api.ts` (`STATUS` `:370-551`, a second boundary for
  `GET /api/service-zones/:zoneId/offers` and for `POST /api/tables/:id/seat`),
  `bill-payments-api.ts`. Changes `service_zone.not_found`, `reader.not_found`, `table.not_found`,
  `table.inactive` (body), `zone.not_found`, `status.not_found`, and `working_order.not_found` on
  `/api/dead-ends/order` → 400; every route where these come from the path keeps 404 (check each
  code's path routes before moving its table row). Clients: code only. Tests to change:
  `till-api.sell-published.test.ts:1008-1010`, `till-api.fiscal-sale-paths.test.ts:2886-2888`,
  `till-api.table-actions.test.ts:427-429`, `till-api.move-bill.test.ts:909-911`,
  `till-api.status.test.ts:222-232`, `till-api.test.ts:3927-3929`. Size M. Depends on: question 8
  for the query rows.
- **A394-10 — Till, lines, groups, drafts and courses: body ids answer 400.** Same files plus
  `adjustments-api.ts` and the doc comment at `apps/till/src/api/client.ts:2723`. Changes
  `tab.line_not_found`, `group.not_found`, `draft.not_found`, `course.not_found`, `station.not_found`,
  `adjustment_reason.not_found` → 400 where a body names them. Tests to change:
  `till-api.station-move.test.ts:102-106,185-189`, `till-api.transfer.test.ts:315-317`,
  `bill-payments-api.test.ts:1310-1311`, `adjustments-api.test.ts:770-774`,
  `till-api.courses.test.ts:440-442`, `till-api.groups.test.ts:328-329,595-596,730-731`,
  `till-api.test.ts:3693-3695`, `location-settings-api.orders-open.test.ts:495`. Size M. Depends on:
  A394-9 (same table; run them one after the other).
- **A394-11 — Catalogue statuses: body ids answer 400.** Files: `apps/server/src/catalogue-api.ts`
  (`STATUS`, `runFolder`). Changes `catalogue.not_found`, `category.not_found`,
  `menu_section.not_found`, `course.not_found`, `product.not_found` from bodies → 400; question 9
  for `menu_section.wrong_role`, `menu.shortcut_unreachable`, `extras.product_has_variants`. Tests
  to change: `catalogue-api.test.ts:1123-1138,2651-2655` (and the question-9 pins listed in part 1).
  Size M. Depends on: A394-3 (same file).
- **A394-12 — Management API: body ids answer 400.** Files: `apps/server/src/management-api.ts`
  (`STATUS` `:222-317`), `apps/server/src/tables.ts` for the `table.zone_inactive` split. Changes
  `printer.not_found`, `zone.not_found`, `station.not_found`, `course.not_found` → 400 where a body
  names them; `table.zone_inactive` for a body zone → 400 with a second code (question 9);
  `zone.department_inactive` per question 9. Tests to change:
  `management-api.device-profiles.test.ts:1098,1119`, `management-api.test.ts` zone, station and
  course pins listed in part 2. Size M. Depends on: A394-3 (same file).
- **A394-13 — Devices and joining: body ids answer 400, unknown ticket items 404.** Files:
  `apps/server/src/device-api.ts`, `join-api.ts`, `working-order.ts:6026-6050`. Changes the three
  binding codes → 400 on both files; splits `ticket.invalid_transition` (unknown item → a new
  `ticket_item.not_found` 404; bad `to` → `management.request_invalid` 400) and
  `device.pairing_hold_lapsed` (`/check` body → 400, `/renew` path → 404 under a second code or
  boundary). Clients: the till and dashboard read these CODES (`apps/till/src/api/client.ts:2510,2614`,
  `apps/dashboard/src/api/pairing-hold.ts:9,92`), so a new code needs mapping. Tests to change:
  `device-api.test.ts:683,1487,1584,1620,1767,2560,2576`, `join-api.db.test.ts:245-272,656,914,1453,1468`,
  `join-e2e.test.ts:1263,1340,1365`. Size M. Depends on: nothing.
- **A394-14 — Printing, orders and reports: a body printer or watcher answers 400.** Files:
  `apps/server/src/print-api.ts`, `orders-api.ts`, `report-api.ts`. Changes `printer.not_found` (4
  routes) and `watcher.not_found` (1 route) → 400 with second boundaries for the path routes;
  `printer.invalid_config` 422 → 400 and the two Bluetooth rows per questions 4 and 9. Tests to
  change: `orders-reprint.test.ts:292-312`, `report-api.categories.test.ts:550-557`,
  `print-api.printer-wiring.test.ts:935,1073`, `print-api.test.ts:962,1265-1267,1425,3236-3329`.
  Size S. Depends on: questions 4 and 9 for their rows.
- **A394-15 — Payments: body ids answer 400, an unknown stuck payment 404.** Files:
  `apps/server/src/payments-api.ts`. Changes `payment.provider_unknown` and `reader.not_found` from
  bodies → 400; `reader.not_listed` on adopt → 400; `payment.not_stuck` for an unknown payment →
  `bill.payment_not_found` 404 (already in this table; check its params); the `/unpair` field
  param; the 422 group per question 4. Tests to change: `payments-api.test.ts:586,1027,1448`,
  `payments-api.stuck.test.ts:838`. Size M. Depends on: question 4 for the 422 group.
- **A394-16 — Setup: clashes answer 409, unreadable copies 422.** Files: `apps/server/src/setup-api.ts`
  (`PROVISION_STATUS`, `ADOPT_STATUS`), `configuration-transfer.ts:524,529`, `apps/setup` for a new
  code. Changes `provisioning.foreign_tenant`, `provisioning.second_venue`,
  `mirror.environment_mismatch` → 409; archive codes → 422 (question 1); configuration contents →
  422 under a new code (question 2). Clients: the setup app maps `setup.request_invalid
  {field:"artifact"}` (`apps/setup/src/setup-app.ts:216`), so question 2's new code needs mapping.
  Tests: none pin the 409 rows at HTTP level; add them. Size S. Depends on: A394-5 (same file),
  questions 1 and 2. Not on PR #1399 (landed).
- **A394-17 — Shift swaps: a body shift answers 400.** Files: `apps/server/src/schedule-api.ts`,
  `me-api.ts`. Changes `shift.not_found` → 400 on both swap routes (the path routes keep 404 under
  a second boundary); `swap.not_permitted` per question 13. Tests: none found at HTTP level. Size S.
  Depends on: A394-1 (same function).
- **A394-18 — Bookings: a body table answers 400; a no-longer-booked booking 409.** Files:
  `packages/bookings/src/routes.ts`, `bookings.ts`. Changes `table.not_found` → 400 on three routes;
  `booking.not_found` for a booking that exists → `booking.invalid_transition` 409. Clients: code
  only (`apps/dashboard/src/i18n/codes.ts:493`). Tests: none at route level. Size S. Depends on:
  nothing.
- **A394-19 — Adjustments: reordering with an unknown reason answers 400.** Files:
  `packages/adjustments/src/routes.ts`. Changes `adjustment_reason.not_found` on `PUT /reason-order`
  → 400 under a second boundary. Tests: none found. Size S. Depends on: nothing.
- **A394-20 — One-off rows after the owner's answers.** Files: `units-api.ts` with
  `packages/catalogue/src/units.ts` (target unit → a second code), `location-settings-api.ts`,
  `cloud-api.ts`, `promote-api.ts`, `receipt-preview-api.ts`, `stream-api.ts`, `backup-api.ts`, the
  till's no-reader case. Statuses per questions 5, 8, 10, 11, 14. Tests listed per row in the parts.
  Size M; split by file if it grows. Depends on: those questions.
- **A394-21 — Server faults answer 500, an unset box 409.** Files:
  `configuration-transfer.ts`, `email-settings-api.ts`, `backup-api.ts`, `location-settings-api.ts`,
  `mirror-bundle-api.ts`, catalogue's `menu.reset_required` and the two `time_zone.unreadable`
  rows. Statuses per question 12. Tests: `catalogue-api.test.ts:5836`,
  `catalogue-api.menu-schedule.test.ts:321-323` and the rest found when the rows move. Size M; split
  in two if it passes one area. Depends on: question 12.
- **A394-22 — Malformed path ids, one answer everywhere.** Files:
  `packages/server-kit/src/request-screens.ts` and every table that maps `shared.invalid_id`, plus the
  three till 409s (re-check them first). Statuses per question 7. Size: split by package or
  `apps/server` area before dispatching. Depends on: question 7, and last, after A394-8 to A394-21.

---

# Appendix A — audit part 1

## A394 part 1: status-code audit (setup, till, catalogue, adjustments, bookings, media, venue-service)

Read only, against `origin/main` at `d5e09a322` in `/Users/clintongormley/workspace/repos/waitron`.
**I ran no tests and no code.** Every row comes from reading the source and grepping it, so every
"reachable" and "client reads it" claim here comes from reading, not from a test run.

How a boundary picks a status (`packages/server-kit/src/error-boundary.ts:22-43`): it takes
`status[cause.code] ?? 400` (`:33`) from the single table it was built with. So within one boundary
a code gets the same status on every route that boundary serves. The only way to give one code a
different status on two routes is to put those routes behind different boundaries (different
tables), or to throw a different code. A non-`AppError` becomes an opaque `server.internal` 500
(`:39-40`).

**Corrected by merge reader (2026-10-08, read, not run).** True as stated, but giving one route
its own status needs no new mechanism: a second boundary built from a spread of the same table
already does it. `apps/server/src/catalogue-api.ts:351-354` builds `runSize` from
`{ ...STATUS, "product.variant_not_found": 404 }` so that code answers 404 on the single-size route
and 400 on the whole-list PUT, and `setup-api.ts:265-296` spreads tables the same way. What a
table cannot do is split one code on ONE route where both the path and the body can raise it
(for example `unit.not_found` on the units reassign route); that needs a second code.

The rule: the thing the request's address/path points at is missing → 404; something the body
refers to is missing or unusable → 400; a clash with existing data → 409; a file or copy that
cannot be opened → 422.

---

### apps/server/src/setup-api.ts

Setup routes take no path ids at all. Every reference comes from a body, an uploaded file or a
header. So the rule never gives 404 here, and none of these tables maps anything to 404.

| Boundary | Table | Routes |
| --- | --- | --- |
| `runProvision` `:212` | `PROVISION_STATUS` `:183-208` | POST `/setup-api/fiscal-test` `:606`, POST `/setup-api/provision` `:636` |
| `runAdopt` `:230` | `ADOPT_STATUS` `:219-228` | POST `/setup-api/adopt` `:777` |
| `runReset` `:240` | `RESET_STATUS` `:232-238` | POST `/setup-api/reset-incomplete-adopt` `:863` |
| `runRestore` `:298` | `ARCHIVE_RESTORE_STATUS` `:265-272` | POST `/setup-api/cloud-recovery/{start,start-again,restore}`, GET `/setup-api/cloud-recovery/status` `:914-978`, POST `/setup-api/restore` `:980` |
| `runBucketRestore` `:299` | `BUCKET_RESTORE_STATUS` `:282-296` | POST `/setup-api/restore-bucket` `:1043` |
| `runConfiguration` `:300` | `PROVISION_STATUS` | POST `/setup-api/configuration` `:1107` |

Codes I followed down the call chain: `provision.ts`, `packages/provisioning/src/{tenant-guard,venue-plan,venue-apply,fiscal-modules}.ts`,
`adopt.ts`, `mirror-bundle-fetch.ts`, `primary-url.ts`, `configuration-import.ts`,
`configuration-transfer.ts`, `restore.ts`, `restore-gate.ts`, `restore-request.ts`,
`restore-stream.ts`, `artifact-cipher.ts`, `backup-archive.ts`, `cloud-recovery.ts`,
`packages/stream/src/{kit,names,generations,litestream}.ts`.

**Counts.** Codes checked: about 60 across the six boundaries (the table entries plus the unmapped
codes found by `grep -o 'AppError("…"'` over the chain). Clear mismatches: 3 codes (4 route rows).
Judgement calls the owner should rule on: 6. The rest match.

- runProvision: 16 entries plus about 10 unmapped codes checked; 1 mismatch (`provisioning.foreign_tenant`).
- runAdopt: 8 entries plus 4 unmapped; 3 mismatches.
- runReset: 5 entries; 0 mismatches.
- runRestore: 23 entries (spread) plus about 9 unmapped `restore.*`; 0 clear mismatches, 4 judgement calls, 1 non-`AppError` 500.
- runBucketRestore: 33 entries (spread) plus about 4 unmapped `backup.stream_*`; 0 mismatches.
- runConfiguration: shares the provision table; 0 clear mismatches, 1 judgement call. `service_zone.not_found`, thrown when an imported bundle points at a zone, already answers the rule's 400. That is pinned by `apps/server/src/setup-api.test.ts:1222-1240` (it lists `service_zone.not_found` at 400) and `:1610-1627` (the configuration route answers 400 with `service_zone.not_found`).

#### Mismatches

| Route | Code | Current | Rule | Why | Clients that read the status | Tests pinning the status |
| --- | --- | --- | --- | --- | --- | --- |
| POST `/setup-api/provision` | `provisioning.foreign_tenant` | default 400 (not in `PROVISION_STATUS` `:183`) | 409 | The database already holds a taxpayer with a different identity, which is a clash with existing data. Thrown at `packages/provisioning/src/tenant-guard.ts:49`, called from `apps/server/src/provision.ts:135` | apps/setup reads codes, not statuses (`apps/setup/src/api/client.ts:166-176` passes `status` through). Its only status branch is `status === 404` in `describeConnectionFailure`, `apps/setup/src/setup-app.ts:393`, which is not on this route's path. No client match from grepping `foreign_tenant` in apps/setup, apps/dashboard and packages/*/src/dashboard | none at HTTP level. `apps/server/src/provision.test.ts:369` asserts the code only |
| POST `/setup-api/adopt` | `provisioning.foreign_tenant` | default 400 (not in `ADOPT_STATUS` `:219`) | 409 | Same clash. `apps/server/src/adopt.ts:105` | as above | none at HTTP level. `adopt.test.ts:241,334` assert the code only |
| POST `/setup-api/adopt` | `provisioning.second_venue` | default 400 | 409 | This box already has a venue: `assertNoOperationalVenue`, `packages/provisioning/src/tenant-guard.ts:35`, called from `adopt.ts:110` | none found by grepping `second_venue` in apps/setup and apps/dashboard | none at HTTP level. `adopt.test.ts:269,348` and `boot.test.ts:2715` assert the code only |
| POST `/setup-api/adopt` | `mirror.environment_mismatch` | default 400 | 409 (my reading) | The primary's environment clashes with this box's configured one (`adopt.ts:98-103`). Its siblings `deployment.already_stamped` (`ADOPT_STATUS` 409) and `restore.environment_mismatch` (`ARCHIVE_RESTORE_STATUS` 409) already answer 409 | none found by grepping `mirror.environment_mismatch` in apps/setup. apps/setup maps only `restore.environment_mismatch` (`setup-app.ts:212,223,280,300`) | none at HTTP level. `adopt.test.ts:233,319` assert the code only |

`provisioning.tenant_identity_mismatch` and `provisioning.second_venue` are also thrown inside
`applyVenue` (`packages/provisioning/src/venue-apply.ts:92,147,164,219,263`), behind the provision
boundary, both at default 400 where the rule says 409. But `provision.ts:137-139` already throws
`setup.already_provisioned` (409) when any taxpayer row exists. So on this route I believe they
are reachable only in the race the comment at `provision.ts:106` describes. I did not establish
that they are reachable.

#### Judgement calls (rule unclear; the owner should decide)

- **A copy that decrypts and unpacks but is missing parts or holds unexpected entries.** Restore
  archive, POST `/setup-api/restore`, through `validateArtifact`, `restore.ts:127-196`:
  `restore.archive_incomplete` (`:158,163`), `restore.unexpected_entry` (`:176`),
  `restore.unsafe_entry_path` (`:190`) and `restore.identity_incomplete` (`:537,541`, reached at
  `:196`) all fall to default 400. The bucket table already treats a copy missing its parts as 422
  (`restore.stream_pointer_missing`, `restore.stream_state_missing`, `setup-api.ts:285,289`). If the
  same reading applies to archives, these four should be 422.
- **Configuration import, POST `/setup-api/configuration`.** A file that decrypts but whose entries
  are wrong, or whose JSON does not parse, throws `setup.request_invalid {field:"artifact"}` at
  default 400 (`configuration-transfer.ts:524,529`). That reads like "a file that cannot be
  opened", so 422. But `setup.request_invalid` is also the code for genuine body faults, so
  answering 422 here would need a different code. apps/setup maps `setup.request_invalid` with
  `field:"artifact"` to the artifact field (`apps/setup/src/setup-app.ts:216`; test
  `apps/setup/src/setup-app.test.ts:2713,3569`), so a new code would need a client mapping.
- **Cloud restore's `pointId`.** POST `/setup-api/cloud-recovery/restore` with a body `pointId`
  that is not the bound point throws `setup.operation_conflict` 409 (`setup-api.ts:~946`). Under
  the rule that is either a body reference to something unusable (400) or a clash with the saved
  binding (409).

#### Out-of-rule statuses that look wrong

- `restore.ts:160`: `JSON.parse` on the manifest entry has no guard. A manifest that is not JSON
  throws a `SyntaxError`, which is not an `AppError`, so it answers `server.internal` 500 on POST
  `/setup-api/restore`. Found by reading only; not run.
- `cloud-recovery.ts:25-27`: `unavailable()` throws a plain `Error`, so a failing Cloud upstream
  answers 500 on the cloud-recovery routes. Two siblings answer an upstream failure with 502:
  `mirror.bundle_fetch_failed` (`setup-api.ts:221`) and `backup.stream_request_failed` (`:292`).

---

### apps/server/src/till-api.ts

How these rows were produced: three read-only reader agents traced the till, catalogue and package
boundaries, and I spot-checked some of their rows against the source. The till reader covered
every code the till table maps to 404, plus a sweep for unmapped not-found and clash codes. It did
not cover every 409 and 400 row in the 180-line table.

| Boundary | Table | Routes |
| --- | --- | --- |
| `run` `:553` | `STATUS` `:370-551` | about 93 routes in till-api.ts, plus those passed `run` at `:1054-1059`: `bill-payments-api.ts`, `adjustments-api.ts`, unpaid-departure, `department-transfer-api.ts`, `bill-lookup-api.ts`, `invoice-lookup-api.ts` |
| `demoRun` `:993` | inline `:994-1001` | the demo reader decision route `:1016`. Its `reader.not_found` is for a path id (`:1027-1029`), so it matches. 0 mismatches |

**Counts (`run`).** 19 codes mapped to 404 were checked. 5 match on every route that raises them
(`watcher.not_found`, `kitchen_notice.not_found`, `department_transfer.not_found`,
`bill.payment_not_found`, `print_job.not_found`). 12 are mismatches on at least one route. For 2,
the source of the id could not be established (`department.not_found`, raised only from an id
stored on the order, `packages/venue-service/src/operations.ts:1138`; and
`route.subject_not_found`, raised for stored or priced line products,
`packages/venue-service/src/routing-store.ts:640`). The sweep found no unmapped not-found code for
a path id, and no reachable unmapped clash code. One extra code, `table.inactive`, I checked
myself.

**`service_zone.not_found` (`STATUS` `:458`, 404).** The zone is in the path on only one route,
GET `/api/service-zones/:zoneId/offers` `:1347`. On every other route that raises it, the zone
comes from the query string or body. So the same code needs 404 on one route and 400 on the rest,
and one table cannot give it both (see the top of this file). _Corrected by merge reader: a second
boundary over `{ ...STATUS, "service_zone.not_found": 404 }` for that one route would, as
`catalogue-api.ts:351-354` already does for sizes._

_Corrected by merge reader (2026-10-08): several `STATUS` line numbers cited below were wrong (the
statuses were right). Checked with `/usr/bin/grep -n '"<code>": '` on `till-api.ts`, which is
unchanged between `d5e09a322` and `164de74f1`: `course.not_found` is `:459` (not `:440`),
`service_zone.not_found` `:464` (not `:458`), `station.not_found` `:462` (not `:443`),
`status.not_found` `:533` (not `:530`), `draft.not_found` `:510` (not `:506`), `group.not_found`
`:513` (not `:509`)._

#### Mismatches (an id from the body or query string answers 404, or an unusable body reference answers 409; the rule says 400)

Clients that read the status, for every row: none found. The till's request helper puts `status`
on every rejection (`apps/till/src/api/client.ts:3488`). The only till code that reads `.status`
is `apps/till/src/state/department-transfer-monitor.ts:37-39,168-172`, and it checks only 401 and
403. Grepping `=== 404|\.status` in apps/till/src, apps/dashboard/src and packages/*/src/dashboard
found no branch on these routes. Where a client branches on the error CODE instead, that is noted.

| Route | Code (current) | Where the id comes from | Tests pinning the current status |
| --- | --- | --- | --- |
| GET `/api/menu-state` `:1369` | `service_zone.not_found` (404 `:458`) | query `zoneId` `:1373` → `resolveZoneContext` `:1384` → `venue-service/src/operations.ts:549` | `till-api.sell-published.test.ts:1008-1010` |
| POST `/api/working-orders` `:1615` | `service_zone.not_found` | `body.zoneId` `:1629` → `priceOrderLines` (`working-order.ts:1097-1104`) → `operations.ts:817` | none found |
| POST `/api/sales` `:1518`, POST `/api/pay` `:1556` | `service_zone.not_found` | `body.zoneId` `:1527` / `:1577` (inferred down the sale chain) | none found |
| POST `/api/dead-ends/sale` `:1401` | `service_zone.not_found` | `body.zoneId` `:1408` → `:1450` | none found |
| POST `/api/dead-ends/order` `:2741` | `service_zone.not_found` | `body.toZoneId` `:2745` → `move-bill.ts:428` | none found |
| POST `/api/bills/:id/move` `:3111` | `service_zone.not_found` | `body.to.counter.zoneId` `:720-724` → `move-bill.ts:403/428` (inferred) | none found |
| POST `/api/department-transfers/:id/accept` (`department-transfer-api.ts:283`) | `service_zone.not_found` | `body.zoneId` `:289` → `department-transfers.ts:425` | none found |
| POST `/api/pay` `:1556` | `reader.not_found` (404 `:476`) | `body.readerId` `:1590` → `resolveCardCollector` `:340-356` | `till-api.fiscal-sale-paths.test.ts:2886-2888` |
| POST `/api/working-orders/:id/payments` (`bill-payments-api.ts:213`) | `reader.not_found` | `parseReaderId(body)` `bill-payments-api.ts:168-172` | none found |
| POST `/api/parties/:id/move`, `/join` `:2334-2345` | `table.not_found` (404 `:480`) | body `toTableId`/`tableId` → `move-bill.ts:231` | `till-api.table-actions.test.ts:427-429`. Code branch at `apps/till/src/till-app.ts:374` |
| POST `/api/bills/:id/move` `:3111` | `table.not_found` | `body.to.tableId` `:717` → `move-bill.ts:171→231` | `till-api.move-bill.test.ts:909-911` |
| POST `/api/sales` / `/api/pay` with `deliveryTableId` | `table.not_found` | `working-order.ts:1092` via `till-sale.ts:540,1899` (inferred) | none found |
| POST `/api/parties/:id/move`, `/join`, POST `/api/bills/:id/move` | `table.inactive` (409 `:481`) | body table that exists but is retired → `move-bill.ts:232`. On POST `/api/tables/:id/seat` the table is in the path (`working-order.ts:1211`), so 409 matches there | no HTTP-status pin found. `party-move-bill.test.ts:487` and `party-table-actions.test.ts:561` assert the code only. Code branch at `apps/till/src/till-app.ts:368` |
| POST `…/lines/move-station` `:2876` | `station.not_found` (404 `:443`) | `body.stationId` `:2893-2894` → `station-move.ts:203` | `till-api.station-move.test.ts:106,188-189`. Code branch at `till-app.ts:553` |
| POST `…/lines/move-station` `:2876` | `tab.line_not_found` (404 `:487`) | body `lineIds` `:2891` → `station-move.ts:232` | `till-api.station-move.test.ts:102,185-186` |
| POST `…/lines/recall` `:2962` | `tab.line_not_found` | `body.lineNos` `:2970` → `working-order.ts:2139` | none found |
| POST `/api/bills/:id/split` `:3053`, `/transfer` `:3092` | `tab.line_not_found` | body lines → `bill-actions.ts:149,224` → `working-order.ts:3581` | `till-api.transfer.test.ts:315-317` |
| POST `/api/working-orders/:id/payments`, `/preview` (`bill-payments-api.ts:202,213`) | `tab.line_not_found` | body `lineNo` → `bill-payments.ts:816` | `bill-payments-api.test.ts:1310-1311` |
| POST `/api/working-orders/:id/adjustments`, `/preview` (`adjustments-api.ts:127,162`) | `tab.line_not_found` | `body.lineId` `adjustments-api.ts:59-60` → `adjustments-apply.ts:436` | `adjustments-api.test.ts:770` |
| POST `/api/working-orders/:id/adjustments`, `/preview` | `adjustment_reason.not_found` (404 `:537`) | `body.reasonId` `adjustments-api.ts:75` → `packages/adjustments/src/operations.ts:125` | `adjustments-api.test.ts:771-774`. Code branches at `till-app.ts:727` and `adjustment-dialog.ts:78` |
| PATCH `…/lines/:lineNo/course` `:2928` | `course.not_found` (404 `:440`) | `body.courseId` `:2935-2937` → `kitchen.ts:347` | `till-api.courses.test.ts:440-442`. A doc comment at `apps/till/src/api/client.ts:2723` says 404 |
| order, round and draft line bodies with a `courseId` | `course.not_found` | `working-order.ts:651/653`, `order-drafts.ts:486` | none found |
| POST `/api/tables/:id/status` `:2976` | `status.not_found` (404 `:530`) | `body.statusId` `:2983-2985` → `tables.ts:540` | `till-api.status.test.ts:222-223,231-232` |
| PUT `/api/tables/:id/placement` `:2996` | `zone.not_found` (404 `:483`) | `body.zoneId` `:3015` → `tables.ts:227` | `till-api.test.ts:3927-3929` |
| POST `/api/dead-ends/draft` `:2657` | `draft.not_found` (404 `:506`) | `body.draftId` `:2663,2669` | none found. Code branches at `till-app.ts:467`, `draft-sync.ts:20` |
| PUT `/api/parties/:id/drafts` `:2623` | `draft.not_found` | body `draftId` → `order-drafts.ts:136` | none found |
| PUT `/api/parties/:id/groups/order` `:2574` | `group.not_found` (404 `:509`) | body `heldGroupIds` → `order-groups.ts:499` | `till-api.groups.test.ts:595-596`. Code branches at `till-app.ts:557,564` |
| POST `/api/parties/:id/groups/move` `:2593` | `group.not_found` | body `moves[].lineId` / `target.groupId` → `order-groups.ts:651,1393` | `till-api.groups.test.ts:730-731` |
| POST `/api/parties/:id/served`, `/unserved` `:2498-2502` | `group.not_found` | body `items[].lineId` → `working-order.ts:2978` | `till-api.test.ts:3693-3695`; `location-settings-api.orders-open.test.ts:495` |
| POST `/api/parties/:id/groups` `:2436`, `…/drafts/:did/submit` `:2715` | `group.not_found` | body `joinGroupId` (`:832,2446,2727`) | `till-api.groups.test.ts:328-329` |
| POST `/api/dead-ends/order` `:2741` | `working_order.not_found` (404 `:420`) | `body.workingOrderId` `:2746` → `:2765` | none found |

**Not established.** `reader.not_found` when the device has no reader (`:309`): the request
carries no id at all. Pinned at 404 by `till-api.fiscal-sale-paths.test.ts:1106-1107`.

#### Out-of-rule statuses that look wrong (till)

- `person.not_found` is 401 (`:377`). Under `run` it is thrown only at `adjustments-apply.ts:518`,
  when the signed-in operator's own row has gone; the PIN login refuses an unknown person with
  `pin.invalid` (`:1072`). The same code is 404 in `management-api.ts:269`. So it already answers
  different statuses on different boundaries, and on the till it is not a login refusal.
- Malformed path ids answer 409 instead of 404: `tab.not_open` (`:639-641`), `party.not_open`
  (`:666-668`), `working_order.not_open` (`:2818,2912`). This is what the reader reported; I did
  not re-check these lines.

---

### apps/server/src/catalogue-api.ts

| Boundary | Checked | Match | Mismatch | Debatable |
| --- | --- | --- | --- | --- |
| `run` `:344` (`STATUS`) | about 48 | about 41 | 4 codes | 3 |
| `runFolder` `:345` (POST `/management-api/folders/move` `:1237`, `/delete` `:1247`, GET `/summary` `:1262`) | 7 | 5 | 2 | 0 |
| `runSize` `:351` (PATCH `…/catalogues/:id/items/:itemId/variants/:variantId` `:1152`) | 5 | 5 | 0 | 0 |

`runFolder`'s one override (`"category.parent_cycle": 409`, `:346`) is already in `STATUS` (`:293`),
so in effect `runFolder` uses the same table as `run`.

Clients for every row: none read the status. `packages/dashboard-kit/src/request.ts:122-125`
copies `status` onto the rejection, but the handlers branch on the code. `menus-screen.ts:920`
checks only `!== 200` on the parts of the `/read` answer.

| Route | Code (current) | Rule | Where the id comes from | Code branches in clients | Tests pinning |
| --- | --- | --- | --- | --- | --- |
| POST `/management-api/locations/:locationId/catalogues` `:1183`, PUT `…/default-catalogue` `:1206` | `catalogue.not_found` (404 `:290`) | 400 | body `catalogueId` `:405-410`, thrown at `:419` (spot-checked) | none | `catalogue-api.test.ts:1123-1129,1132-1138` |
| POST `/management-api/categories` `:1227`, PATCH `/management-api/categories/:id` `:1277` (body `parentId` only; the path id at `categories.ts:97` correctly answers 404) | `category.not_found` (404 `:291`) | 400 | `validateParent` → `categories.ts:50` | `widgets/category-form.ts:84` (code) | none found |
| POST `/management-api/products` `:1418` | `category.not_found` | 400 | body `categoryId`, `operations.ts:1016` | none | none found |
| POST `/catalogues/:id/product-editor` `:1356`, PUT `/products/:id/editor` `:1397` | `category.not_found` | 400 | body `primaryCategoryId`, `product-editor.ts:216` | `screens/catalogue-screen.ts:946` (code) | none found |
| POST `/folders/move`, `/folders/delete` (`runFolder`) | `category.not_found` | 400 | body `categoryIds`/`to`, `catalogue-items.ts:107,118` | none | none found |
| GET `/folders/summary` (`runFolder`) | `category.not_found` | 400 | query `id` values `:1265` → `catalogue-items.ts:246` | none | none found |
| POST `/folders/move`, `/folders/delete` (`runFolder`) | `product.not_found` (404 `:297`) | 400 | body `productIds`, `catalogue-items.ts:106` | none | none found |
| POST `/sections/:id/members` `:602`, `…/members/:memberId/replace` `:652` (body `ref.sectionId` only) | `menu_section.not_found` (404 `:299`) | 400 | `checkListRef` → `sections.ts:132` | none | none for the body case |
| POST `/catalogues/:id/home/shortcuts` `:695`, `…/shortcuts/:memberId/replace` `:706` | `menu_section.not_found` | 400 | body `ref.sectionId` → `section-members.ts:84` | `menus-screen.ts:164-169` (code) | none for the body case |
| POST `/catalogues/:id/product-editor`, PUT `/products/:id/editor` | `course.not_found` (404 `:321`) | 400 | body `courseId` `:774-788` → `kitchen.ts:347` | `catalogue-screen.ts:949` (code) | `catalogue-api.test.ts:2651-2655` |

**Debatable (409 today; the rule could read them as unusable body references, so 400).**
`menu_section.wrong_role` (`sections.ts:134`, `section-members.ts:86`; pinned at 409 by
`catalogue-api.include-folder.test.ts:271-289` and `catalogue-api.test.ts:5002,5359`, though those
tests use path targets). `menu.shortcut_unreachable` (`menu-home.ts:147,162`; pinned by
`catalogue-api.test.ts:5297,5346-5347`). `extras.product_has_variants` for a body
`items[].productId` (`extras.ts:279`; pinned by `catalogue-api.test.ts:3826-3836`).

#### Out-of-rule statuses that look wrong (catalogue). These are inferred from reading; none was run.

- POST `/management-api/products` with an unknown body `catalogueId`: nothing checks it
  (`operations.ts:970-1017`), so I believe the foreign-key refusal comes back as a 500. The rule
  says 400.
- POST `/locations/:locationId/catalogues` with an unknown location in the path: likely a
  foreign-key 500 (`location-catalogues.ts:9-12`). The rule says 404. PUT `…/default-catalogue`
  with an unknown location answers 204 because the update matches no rows
  (`operations.ts:1254-1271`).
- GET `/catalogues/:id/products` with an unknown path id answers 200 `[]`
  (`operations.ts:1031-1043`).
- A malformed `courseId` answers `course.not_found` instead of a shape error (`:774-775`).
- `time_zone.unreadable` 409 (`:317`, pinned by `catalogue-api.menu-schedule.test.ts:321-323`) is a
  broken venue setting, not a clash with the request.
- `menu.reset_required` is unmapped, so 400 (`menu-publication.ts:184`). It is caused by the
  format of stored data, not by the request. Pinned at 400 by `catalogue-api.test.ts:5836`.

---

### packages/adjustments/src/routes.ts (boundary `:53`, table `:42-52`)

6 codes checked: 5 match, 1 mismatch. `adjustment_reason.not_found` on PUT, DELETE and reactivate
`/reasons/:reasonId` is for the path id, so 404 matches (pinned by `routes.test.ts:221,384`).

| Route | Code (current) | Rule | Where the id comes from | Clients | Tests |
| --- | --- | --- | --- | --- | --- |
| PUT `/reason-order` `:291` | `adjustment_reason.not_found` (404 `:50`) | 400 | body `ids`, `operations.ts:231-233` | code only: `apps/till/src/…/adjustment-dialog.ts:78`, adjustments `dashboard/strings.ts:313` | none found |

The report routes call `readLocationClock`, which throws a plain `Error`
(`packages/reporting/src/business-day.ts:228`), so that path answers 500.

### packages/bookings/src/routes.ts (boundary `:54`, table `:37-52`)

11 codes checked: 10 match, 1 mismatch (on 3 routes). **`table.inactive` is 400 here (`:49`)**,
because the table comes from the body or the booking. That fits the rule. On the till the same
code is 409 (`till-api.ts:481`). Seating goes `core.seatTable` → `apps/server/src/parties.ts:91` →
`openTab` (`working-order.ts:1208-1230`).

| Route | Code (current) | Rule | Where the id comes from | Clients | Tests |
| --- | --- | --- | --- | --- | --- |
| POST `/bookings` `:153`, PATCH `/bookings/:id` `:167`, POST `/bookings/:id/seat` `:179` | `table.not_found` (404 `:48`) | 400 | body `tableId` `:88,104,187` → `bookings.ts:65,226`, `working-order.ts:1208` | code only: `apps/dashboard/src/i18n/codes.ts:493` | none at route level. `bookings.test.ts:253-300,370-383` assert the code only |

**Looks wrong.** PATCH `/bookings/:id` answers `booking.not_found` 404 when the booking exists but
is no longer `booked` (`bookings.ts:117,146-148`). That is a state clash; the other verbs answer
`booking.invalid_transition` 409 (`bookings.ts:171`).

### packages/media/src/routes.ts (boundary `:44`, table `:27-43`)

11 codes checked: 10 match, 0 mismatches, 1 borderline. `image.not_found` is raised only for the
path id (`images.ts:154,273,380`). An upload that cannot be decoded answers 422
`image.invalid_file` (`prepare.ts:50,61`; pinned by `routes.test.ts:221,265`).

**Borderline.** Bytes that are not a recognised image answer 415 `media.unsupported_type`
(`packages/catalogue/src/media.ts:46-51`, table `:42`; pinned by `routes.test.ts:205`, which posts
three zero bytes and expects 415). Whether "cannot be opened" covers this case, making it 422, is
the owner's call.

### packages/venue-service/src/routes.ts (boundary `:135`, table `:95-134`, 47 routes `:289-1063`)

About 33 code-and-route pairs checked: 25 match, 6 clear mismatches, 2 borderline. Every not-found
code for a path id answers 404 (department, service_zone, menu_period, special_date, holiday,
station), and the clash codes are 409.

| Route | Code (current) | Rule | Where the id comes from | Clients | Tests |
| --- | --- | --- | --- | --- | --- |
| POST `/venue-service/zones` `:813` | `department.not_found` (404 `:105`) | 400 | body `departmentId` `:826` → `operations.ts:489` | none found | `routes.test.ts:409` |
| PUT `/zones/:zoneId` `:833` | `department.not_found` | 400 | body `departmentId` `:841` → `operations.ts:432` | none found | none found |
| PUT `/routing/cell` `:529`, POST `/routing/preview` `:521` | `service_zone.not_found` (404 `:110`) | 400 | body `address.zoneId` → `routing-store.ts:115` | none found | `routes.test.ts:1915,1933,1941` |
| PUT `/routing/cell` `:529`, POST `/routing/preview` `:521` | `route.subject_not_found` (404 `:119`) | 400 | body category/product → `routing-store.ts:125,134` | none found | `routes.test.ts:1907,1913` |
| GET `/routing/explain` `:483` | `route.subject_not_found` | 400 | query `productId`/`extraId` → `routing-store.ts:351,376` | none found | `routes.test.ts:2313` |
| GET `/routing/explain` | `service_zone.not_found` | 400 | query `zoneId` → `routing-store.ts:321` | none found | none found |
| PUT `/routing/cell`, POST `/routing/preview` | `route.station_inactive` (409 `:120`) | 400 | body `target.stationId` missing or retired, `routing-store.ts:150` | none found on this boundary | `routes.test.ts:1920,1926,1933,2056` |
| PUT `/stations/:stationId/fallback` `:545` | `route.station_inactive` | 400 | body `fallbackStationId`, `station-times.ts:47` | none found | `routes.test.ts:843` |
| PUT `/departments/:id/menus` `:935` | `catalogue.not_found` (404 `:118`) | 400 | body `menuIds`, `department-menus.ts:74` | code only: `menu-timetable-screen.ts:694`, dashboard `codes.ts:303` | none found |
| PUT `/departments/:id/all-day-menu` `:947`, PUT `/zones/:zoneId/all-day-menu` `:959`, POST `/departments/:id/menu-periods` `:979`, PATCH `/menu-periods/:periodId` `:994`, PUT `/zones/:zoneId/period-menus/:periodId` `:1063` | `department_menu.not_found` (404 `:111`) | 400 | body `menuId`, `department-menus.ts:87` | code only: `menu-timetable-screen.ts:647,1376` | `menu-timetable-routes.test.ts:335` |

**Borderline.** `zone.department_inactive` 409 (`:109`) on PUT `/zones/:zoneId`, when the body's
department is retired (`operations.ts:434-435`; pinned by `routes.test.ts:381`). `station.always_open`
409 (`:127`) on the hours and special-dates routes (`hours.ts:115-116`; pinned by
`hours-routes.test.ts:830,841`).

**Looks wrong.** `time_zone.unreadable` 409 (`:123`, raised at `station-times.ts:75`) is a broken
venue setting, not a clash. `zone.table_in_use` 409 is in the table, but I could not establish
that any route raises it (`deactivateServiceZone`, `operations.ts:294`, is not imported by routes.ts).

---

### Codes already answering more than one status (as of this commit)

- `passkey.not_registered`: 404 in `apps/server/src/me-api.ts:76`, 401 in
  `apps/server/src/management-api.ts:263`. Neither is in this share's files.
- `person.not_found`: 401 in `till-api.ts:377`, 404 in `management-api.ts:269`.
- `table.inactive`: 409 in `till-api.ts:481`, 400 in `packages/bookings/src/routes.ts:49`.

### Client contract

No client in this share branches on a status a mismatch would change. Every client branch found
is on the error code. The only `status === 404` branch is `apps/setup/src/setup-app.ts:393`
(`describeConnectionFailure`), and nothing in this audit changes a status on its path. Exceptions
to watch:

- `apps/till/src/api/client.ts:2723` is a doc comment that promises 404 for `course.not_found`.
- A 422 for the configuration import's unreadable file would need a new code, which apps/setup
  would have to map (it maps `setup.request_invalid` `field:"artifact"` today,
  `apps/setup/src/setup-app.ts:216`).

### Not audited

- Till: the 409 and 400 rows of `STATUS` beyond the clash sweep; whether `sendLines` (`:2956`)
  raises `tab.line_not_found`; the full chains inside `recordTillSale` and
  `payWorkingOrderIntegrated` (including a body `workingOrderId` on `/api/pay`); whether zone
  checks answer 403 before 404; where `printer.not_found` gets its id.
- Catalogue: the deeper code of `menuStatus`, `readMenuStructure` and `settleDue`; the
  `describeMakers`, `readLocationClock` and `authorizeManager` codes; whether product image ids are
  checked.
- Venue-service: the internals of `saveSpecialDate`, `replaceWeekHours` and the holiday
  participants; the read routes' `from`/`to` query codes.
- Bookings: `insertParty`, `createOpenOrder`, `resolveZoneContext` on the seat path.
- That `boot.ts` mounts each package at exactly these paths.
- Setup: whether a bundle row pointing at a missing row fails at commit as a non-`AppError` 500
  (`configuration-transfer.ts:652` turns foreign-key checking off until commit); not established.

---

# Appendix B — audit part 2

## A394 part 1 — status-code audit, share 2 (16 files, 17 boundaries)

**What this is.** A READ-ONLY audit, 2026-10-08, of the main checkout at origin/main
(`d5e09a322`). I read source with `cat`/`sed`/`grep` only. **I ran nothing**: no tests, no server, no
probe. Every row below is a reading, with `file:line` receipts; nothing here is a measured behaviour.
Paths are under `apps/server/src/` unless they say otherwise.

**The rule applied.** Path id missing → 404; something the body names missing or unusable → 400;
clash with stored data → 409; a file or copy that cannot be opened → 422. Confirmed the default:
`packages/server-kit/src/error-boundary.ts:33` is `status[cause.code] ?? 400`; a non-AppError
answers `server.internal` 500 (`:39-40`).

**Shared gate codes, checked once.** `requireManagementSession` throws `management_session.required`
(`packages/server-kit/src/management-cookie.ts:32`); `resolveManagementSession` throws
`management_session.required`, `management_session.expired`, `person.suspended`
(`packages/identity/src/management-session.ts:79-85`); `authorizeManager` adds
`authorization.not_permitted` (`packages/identity/src/manager-login.ts:172`). They are out of the rule
(401/403); I count them as "match" wherever they are mapped, and list the one boundary that does not
map them.

**About the "tests pinning it" column.** Found by a proximity search: a test line within six lines
of the code string that mentions the current status. The search cannot tell a path case from a body
case, so a listed test may pin a CORRECT case of the same code (for example
`device-api.test.ts:1047` pins a real state clash, which stays 409). Treat it as where to look.

**Clients.** No client branches on 400 vs 404 vs 409 for any route in this share. Evidence:
`packages/dashboard-kit/src/request.ts:36-39` (the dashboard primitive) rejects with
`{ code, status }` and its contract says callers branch on the code, "never an HTTP status"; a grep
for `status === 4xx` / `.status !==` / `case 40x` over `apps/dashboard/src`, `apps/till/src`,
`apps/setup/src`, `apps/print-agent/src`, `packages/*/src/dashboard`, `packages/dashboard-kit/src`
found only `apps/setup/src/setup-app.ts:393` (404 on setup routes, not in this share) and
`apps/dashboard/src/screens/menus-screen.ts:920,983` (menus, not in this share). The till client
attaches `status` (`apps/till/src/api/client.ts:3488`), and the only reader found is
`apps/till/src/state/department-transfer-monitor.ts:37,169`, which tests 401/403 on transfer routes.
Clients DO branch on the code strings (listed per row) — a status-only change leaves those intact.

---

### alerts-api.ts — boundary `alerts-api.ts:37` (STATUS `:24-30`)

5 codes checked / 5 match / 0 mismatch. `alert.not_found` 404 is the path `:id` (`:82`).

### backup-api.ts — boundary `backup-api.ts:201` (STATUS `:48-63`)

17 codes checked / 15 match / 0 rule mismatches; 2 out-of-rule (below). Body-shape codes
(`backup.request_invalid` from `readApplyBody`/`readRotateBody` `:153-176`,
`backup.recovery_key_unstorable` `:74,77`, `backup.schedule_invalid` `backup-config.ts:43-79`,
`backup.destinations_invalid` `backup-config.ts:94-126`, `backup-env-writer.ts:53,62`) are 400;
state clashes (`backup.managed_by_environment` `:213`, `backup.not_primary` `:214`,
`backup.reload_in_progress` `backup-supervisor.ts:100`, `backup.recovery_key_exists` `:277`) are 409.
Borderline, left as match: `backup.recovery_key_too_short` 400 at `:268`, thrown when the body names
no key and the STORED key is too short — arguably a clash with stored data (409).

### box-retire.ts — boundary `box-retire.ts:44` (STATUS `:26-35`)

11 codes checked / 11 match / 0 mismatch. `node.retire_*` 409 (`retire.ts:45,51,77`) and the four
mint refusals 409 (`membership-mint.ts:17-22`, thrown at `packages/membership/src/build.ts:47-66`).

### box-status.ts — boundary `box-status.ts:111` (STATUS `:103-108`)

4 codes checked / 4 match / 0 mismatch. No route id or body.

### cloud-api.ts — boundary `cloud-api.ts:26-45`

15 codes checked / 14 match / 1 mismatch (arguable).

| Route | Code | Current | Rule | Why | Clients | Tests pinning |
| --- | --- | --- | --- | --- | --- | --- |
| POST /management-api/cloud/complete | `cloud.binding_conflict` | 409 (`cloud-api.ts:35`) | 400 (arguable 409) | The body's `requestId`/`organisationId`/`legalBusinessId` (`cloud-api.ts:152-169`) name no saved request, or a different one: `cloud-client.ts:510-516` throws when `!state` or any id differs. No saved state = the body names a missing thing. A DIFFERENT saved request could be read as a clash. The same code is also a real clash elsewhere (`cloud-client.ts:343,345,368,439`; `cloud-replacement.ts:62`), so a fix would be a different code for the body case, not a status change. | none found by grep `cloud.binding_conflict` over the client dirs | `cloud-api.test.ts:74,179,185,262` assert 409; which cases they cover not established |

### configuration-export-api.ts — boundary `configuration-export-api.ts:19` (STATUS `:12-18`)

6 codes checked / 5 match / 0 rule mismatches; 1 out-of-rule (below).

### device-api.ts — boundary `device-api.ts:153` (STATUS `:101-150`)

40 codes checked / 34 match / 6 mismatch rows (4 codes). _Corrected by merge reader: the table
below has 5 rows on 4 codes, not 6._ _Merge reader, read not run: confirmed the PATCH row —
`device-api.ts:625-638` passes the body's `profileId` to `resolveDeviceBinding`, which throws
`device_profile.not_found` at `device.ts:358`._

| Route | Code | Current | Rule | Why | Clients | Tests pinning |
| --- | --- | --- | --- | --- | --- | --- |
| POST /api/device/ticket-items/:id/advance | `ticket.invalid_transition` (path id malformed or no row) | 409 (`device-api.ts:146`) | 404 | Malformed path id → `device-api.ts:443`; a well-formed id with no row falls through to `working-order.ts:6050` (the `item !== undefined` test at `:6046` only catches a held item). | Till branches on the CODE: `apps/till/src/api/client.ts:2510,2614` (doc comments), `apps/till/src/till-app.test.ts:9522` | proximity: `device-api.test.ts:1047` is a genuine state skip (stays 409); path-missing case not found |
| same | `ticket.invalid_transition` (body `to` not a transition) | 409 | 400 | `working-order.ts:6026-6028` refuses the body's `to` before reading the row. | same | not found |
| PATCH /management-api/devices/:id | `device_profile.not_found` | 404 (`device-api.ts:137`) | 400 | Body `profileId` → `device.ts:356-358` (`resolveDeviceBinding`); body `approvedProfileIds` → `device.ts:199-200` (`approveDeviceProfiles`). The path id's own refusal is `device.not_found` (`device-api.ts:600,613`), which is right. | Dashboard branches on the code: `apps/dashboard/src/screens/devices-screen.test.ts:2129,2288` (`under: "edit-profile"`) | `device-api.test.ts:683,1487,2560,2576` (proximity) |
| same | `station.not_found` | 404 (`:138`) | 400 | Body `stationId` → `device.ts:368` → `kitchen.ts:61` (`requireLiveStation`); body `madeHereStationIds` → `made-here.ts:255` → `kitchen.ts:61`. | `apps/dashboard/src/screens/devices-screen.test.ts:1808,2131` (`under: "edit-binding"`) | `device-api.test.ts:1584,1767` (proximity) |
| same | `watcher.not_found` | 404 (`:139`) | 400 | Body `watcherId` → `device.ts:374-376`. | `apps/dashboard/src/screens/devices-screen.ts:112` maps the code to the binding field | `device-api.test.ts:1620` (proximity) |

Out of rule but noted (not counted): `watcher.not_found` 404 on GET /api/device/watcher and POST
/api/device/watcher/done is the CALLER DEVICE's own bound watcher gone (`watcher-board.ts:129`) —
neither path nor body; the till branches on it (`apps/till/src/screens/till-expo-screen.ts:590`).
Body `ticketItemIds` that name nothing answer `management.request_invalid` 400
(`watcher-board.ts:145`) — match. Equipment body ids that name nothing answer
`device.binding_invalid` 400 (`device-equipment.ts:336`) — match. Kitchen notice path id →
`kitchen_notice.not_found` 404 (`device-api.ts:429`) — match.

### diagnostics-api.ts — boundary `diagnostics-api.ts:58` (STATUS `:32-36`)

5 codes checked / 2 match / 0 rule mismatches; 2 out-of-rule and plainly wrong (below).

### email-inbox-api.ts — boundary `email-inbox-api.ts:28` (STATUS `:18-24`)

5 codes checked / 5 match / 1 mismatch with NO code.

| Route | Code | Current | Rule | Why | Clients | Tests pinning |
| --- | --- | --- | --- | --- | --- | --- |
| GET /management-api/email/message/:id | none — a plain `Error` | 500 `server.internal` (`error-boundary.ts:39-40`) | 404 | The path `:id` goes straight to Mailpit (`email-inbox-api.ts:52`); any non-OK answer becomes `throw new Error(...)` (`mailpit-client.ts:63`), so an unknown id cannot be told from Mailpit being down. What Mailpit answers for an unknown id: not established (nothing run). | none found by grep `email/message` and `email.test_inbox_unavailable` | `email-inbox-api.test.ts:167,178` read `mail-1`; a missing-id case not found |

### email-settings-api.ts — boundary `email-settings-api.ts:71-82`

7 codes checked / 6 match / 0 rule mismatches; 2 out-of-rule (below).

### join-api.ts — boundary `join-api.ts:78` (STATUS `:54-76`)

19 codes checked / 14 match / 5 mismatch rows.

| Route | Code | Current | Rule | Why | Clients | Tests pinning |
| --- | --- | --- | --- | --- | --- | --- |
| POST /management-api/device-join-requests/:id/accept | `device_profile.not_found` | 404 (`join-api.ts:63`) | 400 | Body `profileId` (`join-api.ts:342`) → `acceptDeviceJoinRequest` → `join-requests.ts:510` → `device.ts:358`. | as device-api row (code-based) | `join-api.db.test.ts:914`, `join-e2e.test.ts:1340,1365` (proximity) |
| same | `station.not_found` | 404 (`:64`) | 400 | Body `stationId` → `device.ts:368` → `kitchen.ts:61`. | as above | not found in join tests by proximity |
| same | `watcher.not_found` | 404 (`:65`) | 400 | Body `watcherId` → `device.ts:376`. | as above | `join-api.db.test.ts:656` (proximity) |
| POST /management-api/device-join-requests/:id/check | `device.pairing_hold_lapsed` | 409 (`:72`) | 400 | Body `holdId` names no live hold (`join-api.ts:297`). | Dashboard branches on the CODE: `apps/dashboard/src/api/pairing-hold.ts:9,92`, `apps/dashboard/src/screens/devices-screen.ts:835` | `join-api.db.test.ts:245,259,272,1453,1468`, `join-e2e.test.ts:1263` (proximity; which route each covers not established) |
| POST /management-api/pairing-mode/holds/:holdId/renew | `device.pairing_hold_lapsed` | 409 | 404 | Path `:holdId` names no live hold: `renew` returns null (`join-api.ts:193-194`). | same as above (`renewPairingHold` in `devices-screen.a11y.test.ts:763`, `printers-screen.test.ts:6267`) | same |

Borderline, left as match: on `/deny` and `/check`, a body `createdAt` that differs from the stored
ask answers `join_request.not_found` 404 (`join-api.ts:267-268,299-300`). `createdAt` acts as a
version guard on the PATH resource, so 404 (the ask at that path is gone) or 409 both read
defensibly.

### live-api.ts — boundary `live-api.ts:51-58`

5 codes checked / 5 match / 0 mismatch. It never calls `authorizeManager` (only
`resolveManagementSession`, `live-api.ts:101`), so the missing `authorization.not_permitted` is not
a gap.

### location-settings-api.ts — boundary `location-settings-api.ts:16-28`

12 codes checked / 10 match / 1 mismatch (arguable); 1 out-of-rule (below).

| Route | Code | Current | Rule | Why | Clients | Tests pinning |
| --- | --- | --- | --- | --- | --- | --- |
| PATCH /management-api/venue-details | `venue.detail_read_only` | 409 (`location-settings-api.ts:26`) | 400 (arguable) | The body names a field from a FIXED read-only set (`venue-details.ts:42`); whether it is allowed does not depend on stored data, so it is a body that cannot be used, not a clash. | Dashboard branches on the code: `apps/dashboard/src/screens/venue-details-panel.ts:417` | `venue-details-api.test.ts:123,222` (proximity) |

`venue.detail_locked` 409 (`venue-details.ts:209,231`) depends on stored sales/orders — clash, match.
`venue.detail_changed` 409 (`:220`) — clash, match. `receipt.language_fixed` 400 — body value the
venue's rules refuse; left as match.

### management-api.ts — boundary `management-api.ts:319` (STATUS `:222-317`)

~80 codes mapped; 75 routes. I followed every `*.not_found` code to its throw sites and every
body-referencing route; I did NOT trace each auth/login route's deep chain (passkey, Google, TOTP,
account actions), whose codes are 401/429 auth answers out of the rule. Counted: 30 codes checked in
depth / 24 match / 6 mismatch rows (_corrected by merge reader: the table below has 7 rows — 6
status rows plus the no-code 204 row; I re-read that row at `management-api.ts:2228-2241` and
`kitchen.ts:521-533`: a malformed path id returns before any write, a well-formed unknown one
updates no row, and both answer 204_). Path ids screened by `require*Id` (`:325-393`) and checked by the
verbs answer their own `*.not_found` 404 — match.

| Route | Code | Current | Rule | Why | Clients | Tests pinning |
| --- | --- | --- | --- | --- | --- | --- |
| POST /management-api/device-profiles and PUT /management-api/device-profiles/:id | `printer.not_found` | 404 (`management-api.ts:315`, _corrected by merge reader from `:316`_) | 400 | Body printer lists → `requireListedPrinters` (`:649-669`, throw `:669`), called at `:1469,1504`. (Other body refs on these routes already answer 400: `device_profile.access_invalid` via `packages/venue-service/src/profile-access.ts:47-48,451,459,558`; a bad `canvasId` → `device_profile.invalid` `packages/layouts/src/device-profile-store.ts:132`.) | Dashboard client doc comments name the code (`apps/dashboard/src/api/client.ts`, seen in coverage HTML); no status branch | `management-api.device-profiles.test.ts:1098,1119` (proximity) |
| POST /management-api/tables, PATCH /management-api/tables/:id, PUT /management-api/tables/:id/placement | `zone.not_found` | 404 (`:291`, _corrected by merge reader from `:303`_) | 400 | Body `zoneId`: malformed → `management-api.ts:1728,1774,1827`; well-formed but missing → `tables.ts:46` (`requireZone`, create/update) and `tables.ts:227` (placement; also an INACTIVE zone). | Floor screen shows it as a banner by code (`apps/dashboard/src/screens/floor-screen.ts`, per coverage HTML) | `management-api.test.ts:670,678,792,1049,1059,1167,1184,2015,2023` (proximity) |
| same three routes | `table.zone_inactive` (when the BODY's zone is inactive) | 409 (`:298`, _corrected by merge reader from `:308`_) | 400 (arguable) | Body `zoneId` names an unusable zone → `tables.ts:56-58`. The same code on reactivating a table whose STORED zone is inactive is a real clash (409). | `apps/dashboard/src/screens/floor-screen.test.ts:455-467` (code-based) | `management-api.test.ts:1398,1565,1596,1649,1709,1724,1733,1754` (proximity) |
| POST /management-api/watchers, PUT /management-api/watchers/:id | `station.not_found` | 404 (`:300`, _corrected by merge reader from `:310`_) | 400 | Body `stationIds` → `watchers.ts:66` → `kitchen.ts:61`. | `packages/venue-service/src/dashboard/watcher-form.test.ts:212` maps `watcher.not_found` only; station code not found | `management-api.test.ts:2408,2599,2640,2647,2803` (proximity; may be station path routes) |
| same | `zone.not_found` | 404 | 400 | Body `zoneIds` → `watchers.ts:79`. | none found by grep | covered by the zone list above (proximity) |
| PUT /management-api/products/:id/course | `course.not_found` | 404 (`:305`, _corrected by merge reader from `:315`_) | 400 | Body `courseId`: malformed → `management-api.ts:2235`; missing/inactive → `kitchen.ts:529` → `kitchen.ts:347`. | Dashboard maps it to the course FIELD: `apps/dashboard/src/screens/catalogue-screen.ts:949` | `management-api.test.ts:3017,3024,3063,3159,3223,3269` (proximity) |
| same | none — missing PRODUCT path id | 204 | 404 | A malformed `:id` returns early (`management-api.ts:2238`); a well-formed missing one runs an update that matches nothing (`kitchen.ts:531`) and answers 204. | none | not found |

### me-api.ts — boundary `me-api.ts:96` (STATUS `:70-94`)

24 codes checked / 21 match / 2 mismatch rows (2 codes). `passkey.not_registered` 404 here is the
path `:id` (`me-api.ts:219`) — match; management-api's 401 for the same code is a sign-in refusal
(an auth answer, out of the rule, and the owner-approved exception in CLAUDE.md §3).

| Route | Code | Current | Rule | Why | Clients | Tests pinning |
| --- | --- | --- | --- | --- | --- | --- |
| POST /management-api/me/schedule/swaps | `shift.not_found` | 404 (`me-api.ts:89`) | 400 | Body `fromShiftId` / `toShiftId` (`me-api.ts:397-399`) → `packages/workforce/src/shift-swaps.ts:28,38`. A body `toPersonId` naming no person is not checked before the insert; what then happens is not established. | `apps/dashboard/src/screens/roster-screen.test.ts:574-582` (code-based) | `workforce-api.test.ts:323` (proximity; a different file's route) |
| POST /management-api/me/schedule/swaps/:swapId/accept, DELETE /management-api/session/me/passkeys/:id | `shared.invalid_id` (MALFORMED path id) | 400 (`:87`) | 404 (owner to confirm) | `requireUuidParam` (`packages/server-kit/src/request-screens.ts:14-15`) answers 400 for a malformed path id, while a well-formed missing one answers 404 (`swap.not_found` `shift-swaps.ts:69`; `passkey.not_registered`). management-api treats a malformed path id as the resource's not-found (`management-api.ts:320-324`). | `apps/dashboard/src/screens/recipe-screen.test.ts:516-536` (catalogue, not this share); none for these routes | `catalogue-api*.test.ts` pin 400 for catalogue routes (not this share) |

### membership-removal-api.ts — boundaries `membership-removal-api.ts:38` and `:39` (one STATUS, `:18-31`)

15 codes checked / 15 match / 0 mismatch (same map for both). `membership.node_not_found` 404 is the
path `:nodeId` (`membership-removal.ts:116`); the other refusals are clashes, 409
(`membership-removal.ts:67-118,260`); `membership.write_contended` 503 is out of scope.

---

### Out-of-rule statuses that look plainly wrong

1. **diagnostics-api.ts:32-36 maps neither `management_session.expired` nor `person.suspended`**,
   though `authorizeManager` (`diagnostics-api.ts:66`) throws both
   (`packages/identity/src/management-session.ts:80,83`). An idle-expired or suspended manager gets
   400 on all three diagnostics routes, where every sibling boundary answers 401/403. Clients:
   none found that read the status. No test found for either case (`diagnostics-api.test.ts` has no
   `expired`/`suspended`). _Merge reader, read not run: confirmed — `STATUS` at
   `diagnostics-api.ts:32-36` has three entries, and `authorizeManager`
   (`packages/identity/src/manager-login.ts:162-175`) calls `resolveManagementSession`, which throws
   both codes. The dashboard still signs the person out, because it reacts to the CODE:
   `apps/dashboard/src/main.ts:19-27` fires `waitron-session-invalid` for
   `management_session.expired` and `person.suspended` whatever the status._
2. **configuration-export-api.ts — `setup.request_invalid` at default 400 for server faults.** The only
   body field is `passphrase`; yet `buildConfigurationBundle` throws `setup.request_invalid` when the
   box's OWN venue row or series is missing (`configuration-transfer.ts:99-107`), when stored
   `invoice_locales` is not JSON (`:22,25`), and when a module's transfer declaration is wrong
   (`:174-195,264-279`). These are stored-data or programming faults, not request faults.
3. **email-settings-api.ts — `server.credential_unusable` at default 400** on GET
   /management-api/email/settings (`email-settings-api.ts:98`): the STORED SMTP credential cannot be
   read. Not a request fault. Same family: `email.settings_invalid` `{field:"recipient"}` 400 on POST
   .../test (`:136-137`) is the caller's own account lacking an email — stored state, nearest 409.
4. **backup-api.ts — `backup.effective_mismatch` 400** (`backup-api.ts:294,333,342`): raised AFTER a
   successful write, when the reloaded box encrypts under a different key. A server-side fault, not a
   bad request. Also `backup.request_invalid` `{field:"config"}` 400 on POST /api/backup/rotate
   (`backup-api.ts:184-186`, via `fromCurrent`) is the box having no loaded destination — stored
   state, nearest 409.
5. **location-settings-api.ts — `management.request_invalid` `{field:"locationId"}` 400** when the
   box's OWN configured location row is missing (`location-settings-api.ts:42,123,154`;
   `venue-details.ts:78,84`). No request carries a location id.
6. **device-api.ts — `device_profile.not_found` 404 on POST /api/device/join in dev mode** when the
   venue has no till profile (`device-api.ts:203`): stored state, not the request's address.

### Not audited / not established

- management-api's sign-in and account routes (`:724-978`, `:2276-2363`) were checked only at the
  STATUS map, not down each call chain: their codes are 401/429 auth answers.
- Whether Mailpit answers 404 for an unknown message id; what an unknown `toPersonId` does in
  `requestSwap`.
- Which case each proximity-matched test covers.

---

# Appendix C — audit part 3

## A394 part 1 — HTTP status audit, share 3 (17 boundaries under `apps/server/src/`)

**What this is.** A read-only audit of the 17 files below in the shared main checkout
(`/Users/clintongormley/workspace/repos/waitron`, at `d5e09a322`), against the owner's rule:
the request's address (path id) is missing → 404; something the request body refers to is missing
or unusable → 400; a clash with existing data → 409; a file or copy that cannot be opened → 422.

**What I did.** I read each file's status map and routes, and followed the calls into the packages
they use (`packages/printing`, `packages/catalogue`, `packages/recipes`, `packages/purchasing`,
`packages/workforce`, `packages/identity`, and the `apps/server` helpers). I grepped the clients
(`apps/dashboard`, `apps/till`, `apps/setup`, `apps/print-agent`, `packages/*/src/dashboard`,
`packages/dashboard-kit`, `packages/print-agent`) and the server's test files. **I ran nothing**: no
tests, no requests. Every "answers 500" below comes from reading: a foreign-key refusal that is not
turned into an `AppError` reaches the boundary as a plain error, which
`packages/server-kit/src/error-boundary.ts:39-40` answers `server.internal` 500. That was read, not run.

**How a boundary maps a code.** `packages/server-kit/src/error-boundary.ts:33`:
`status[cause.code] ?? 400`. A code missing from the map answers 400.

**Out of scope throughout.** The sign-in and permission codes (`management_session.*` 401,
`person.suspended` 403, `authorization.not_permitted` 403, `password.invalid` 401, `pin.*`) and the
429/503/502 statuses. They are not counted. None of `passkey.not_registered`, `person.not_found` or
`table.inactive` is raised on any route in this share (grep of the 17 files and the helpers they call).

### How clients read these statuses (applies to every mismatch below)

- The dashboard request helper turns a refusal into `{ code, params?, status }`
  (`packages/dashboard-kit/src/request.ts:122-125`); the till does the same
  (`apps/till/src/api/client.ts:3488`). Every dashboard and till screen I found branches on the
  **code**: `apps/dashboard/src/widgets/order-reprint-dialog.ts:78`,
  `packages/venue-service/src/dashboard/prep-stations-screen.ts:1820,2015,2027`,
  `packages/venue-service/src/dashboard/watcher-form.ts:241`,
  `packages/payments-stripe/src/dashboard/stripe-add-reader.ts:165`,
  `packages/payments-stripe/src/dashboard/stripe-connect-form.ts:150`,
  `packages/payments-sumup/src/dashboard/sumup-connect-form.ts:206`,
  `packages/payments-sumup/src/dashboard/sumup-add-reader.ts:185`,
  `apps/dashboard/src/screens/catalogue-screen.ts:948`.
- The only client code that reads the number itself: `apps/till/src/state/department-transfer-monitor.ts:37-39,168-172`
  (401/403 only), `apps/setup/src/setup-app.ts:393` (404 from the setup probe, not one of these
  routes), and `packages/print-agent/src/client.ts:154-164,413` (401, 403, 429, 5xx and "not 201"
  for `/api/node/enrol-self`; any other 4xx is lumped together as `bad_reply`).
- Searches run: `grep -rnE '\b(404|409|422)\b'` and
  `grep -rnE '(error|err|e|cause|failure|refusal|reason|rejection)\??\.status\b'` over those trees,
  and each mismatch's code string. **No client found by grep branches on 404 vs 400, or 409/422 vs
  400, for any route below.** So, as far as grep shows, every change below alters the status number
  only and is not a cross-package contract change. The tests that pin the current number are the
  contract that would move.

---

### mirror-bundle-api.ts — boundary `mirror-bundle-api.ts:64` (map `:48-57`)

Route: `POST /management-api/mirror-bundle`. Codes checked 7 (plus 3 outside the rule) / match 7 / mismatch 0.
`mirror.standby_invalid` 400 (body, `:89-97`), `mirror.standby_removed` 409 and
`mirror.membership_full` 409 (`mirror-bundle.ts:77,94`), the four chart refusals at 409
(`membership-mint.ts:17-22`) all fit the rule.

Outside the rule (listed for the owner, not counted as mismatches):

| Code | Current | Why it is outside the rule |
| --- | --- | --- |
| `mirror.no_relay` | 400 (`:51`) | No relay URL in the server's own configuration (`:118`); nothing in the request is wrong. |
| `mirror.not_provisioned` | default 400 | The deployment row is missing (`mirror-bundle.ts:119`); server state, not the request. |
| `module.config_invalid` | default 400 | The server's own `modules.json` cannot be parsed (`module-config.ts:26`), read at `mirror-bundle.ts:123`. A server file, not a file the request sends, so I believe the 422 clause does not cover it. |

### node-api.ts — boundary `node-api.ts:39` (map `:31`, empty)

Route: `GET /api/node`. Codes checked 0 / match 0 / mismatch 0. It raises no `AppError`.

### node-enrol-api.ts — boundary `node-enrol-api.ts:42` (map `:27-34`)

Route: `POST /api/node/enrol-self`. Codes checked 2 / match 2 / mismatch 0.
`management.request_invalid` 400 (body name) and `node.enrol_unavailable` 409 (this node is not
primary, `:51`) fit. `device.join_revoked` 403 (`join-requests.ts:655`) and `node.enrol_not_local` 403
are permission refusals, out of scope.

### orders-api.ts — boundary `orders-api.ts:44` (map `:34-43`)

Codes checked 3 / match 2 / mismatch 1. `working_order.not_found` 404 is the path id on
`GET /management-api/orders/:id` and the reprint route (`:139-141,148-166`, `orders-list.ts:552`,
`orders-reprint.ts:22`). `management.request_invalid` 400 fits.

| Route | Code | Current | Rule | Why | Clients | Tests pinning it |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /management-api/orders/:id/reprint` | `printer.not_found` | 404 (`orders-api.ts:42`) | 400 | `printerId` is a body field (`orders-api.ts:195-196`), looked up at `orders-reprint.ts:23-33` | code only: `apps/dashboard/src/widgets/order-reprint-dialog.ts:78` | `apps/server/src/orders-reprint.test.ts:292,308,312` (`status: 404`) |

### payments-api.ts — boundary `payments-api.ts:141` (map `:99-135`)

Codes checked 28 / match 21 / mismatch 6 rows (on 4 codes), plus 7 codes where 422 is used for
something that is not a file (owner question, below). Fitting: `device.not_found`,
`device_profile.not_found`, `bill.payment_not_found`, `bill.refund_not_found` (all path, 404);
`device_profile.invalid`, `device.binding_invalid`, `management.request_invalid`, `shared.invalid_id`
(400); `reader.provider_disconnected`, `payment.provider_in_use`, `reader.payment_in_progress`,
`device.equipment_held`, `payment.outcome_unknown`, the `bill.*_not_stuck`, `bill.*_unconfirmed` and
`bill.attestation_contradicted` codes (409). `payment.provider_unknown` and `reader.not_found` fit on
routes where the id is the path (`/providers/:id/...`, `/readers/:id/...`).

| Route | Code | Current | Rule | Why | Clients | Tests pinning it |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /management-api/payments/readers/adopt` | `payment.provider_unknown` | 404 (`:106`) | 400 | `providerId` is a body field (`:371`), looked up at `:375` | none found by grep of the code string | none found |
| `POST /management-api/payments/readers` | `payment.provider_unknown` | 404 (`:106`) | 400 | body `providerId` (`:556,561`) | none found | none found |
| `POST /management-api/payments/readers/adopt` | `reader.not_listed` | 422 (`:114`) | 400 | body `providerRef` is not in the provider's list (`:378-379`); not a file | none found | `payments-api.test.ts:1027` (422) |
| `PUT /management-api/payments/devices/:id/reader` | `reader.not_found` | 404 (`:113`) | 400 | body `readerId` (`:700`), checked by `requireKnownReader` (`:144-151`, called `:708`) | `stripe-add-reader.ts:165` reads this code on a different route (adding a reader); none for this one | `payments-api.test.ts:1448` |
| `PUT /management-api/payments/device-profiles/:id/readers` | `reader.not_found` | 404 (`:113`) | 400 | body `readerIds` (`:743`), checked at `:757` | none found | `payments-api.test.ts:586` |
| `POST /management-api/payments/stuck/:id/resolve` | `payment.not_stuck` (for an id naming NO payment) | 409 (`:121`) | 404 | a path id with no row (`row?.state !== "attempting"`, `:835-841`) gets the same code as a payment that exists but is not stuck | none found | `payments-api.stuck.test.ts:838` (unknown id → 409) |

Owner question: 422 used for something other than a file. The rule's 422 is "a file or copy that cannot
be opened". These answer 422 for a body value the provider or the stored state refuses, which the
rule's wording would put at 400:
`payment.provider_credential_rejected` and `payment.credential_environment_mismatch` (the body's
credential, `POST /providers/:id/connect`, `:461-475`; thrown in
`packages/payments-stripe/src/card-provider.ts` / `packages/payments-sumup/src/card-provider.ts`),
`payment.pairing_refused` (`POST /readers`, the body's pairing code), `payment.resolve_unsupported`
(`:297`, the provider cannot resolve; not a request fault), `reader.not_listed` on
`POST /readers/:id/enable` (`:422-423`, the reader was unpaired: closer to a state clash, 409), and
`payment.refund_exceeds_capture` / `payment.not_refundable` (mapped at `:131-132`; thrown in
`packages/payments/src/store.ts`; I found no route in this file that reaches them, not established).
`payment.provider_merchant_ambiguous` 409: not established which bucket. Clients read these by
code only (`stripe-connect-form.ts:150`, `sumup-connect-form.ts:206`, `sumup-add-reader.ts:185`).

Also noted: on `POST /readers/:id/enable` and `/unpair`, `cardProviderById` is called with the
STORED provider (`:421,626`), so a reader whose provider module is switched off answers
`payment.provider_unknown` 404 although the path reader exists. And `/unpair` answers
`management.request_invalid` `{ field: "providerId" }` 400 (`:628-629`) when the provider cannot unpair,
though the request has no `providerId` field.

### print-api.ts — boundary `print-api.ts:136` (map `:110-134`)

Codes checked 13 / match 8 / mismatch 6 rows (on 5 codes). Fitting: `printer.not_found` on every
`/printers/:id/...` route and `stations/:sid/printers/:pid` (path), `watcher.not_found` on
`PUT /watchers/:id/printers` (path), `agent.not_found`, `print_job.not_found`, `station.not_found` (path
404); `printer.makes_and_watches`, `print_job.not_resendable`, `printer.already_registered` (409);
`management.request_invalid`, `shared.invalid_id` (400).

| Route | Code | Current | Rule | Why | Clients | Tests pinning it |
| --- | --- | --- | --- | --- | --- | --- |
| `PUT /management-api/watchers/:id/printers` | `printer.not_found` | 404 (`:115`) | 400 | body `printerIds` (`:999-1006`), checked at `watchers.ts:303` via `setPrinterWatcher` | code only: `prep-stations-screen.ts:1820,2015` | `print-api.printer-wiring.test.ts:1073` (`kind === "blocked" ? 409 : 404`) |
| `PUT /management-api/printers/:id/watcher` | `watcher.not_found` | 404 (`:117`) | 400 | body `watcherId` (`:1016-1021`), checked at `watchers.ts:318` | code only: `watcher-form.ts:241`, `prep-stations-screen.ts:2027,2213,2815` | `print-api.test.ts:1265-1267` (unknown `watcherId` → 404) |
| `PUT /management-api/stations/:sid/printers` | `printer.not_found` | 404 (`:115`) | 400 | body `printerIds` (`:1292-1302`), checked at `station-printers.ts:37` via `replaceStationPrinters` | code only: `prep-stations-screen.ts:1820,2015` | `print-api.printer-wiring.test.ts:935` (`kind === "watcher" ? 409 : 404`; `f.path` is this route, `:881`) |
| `POST /management-api/printers` and `PATCH /management-api/printers/:id` | `printer.invalid_config` | 422 (`:124`) | 400 | the body's transport fields are missing or contradict (`packages/printing/src/printers.ts:21,65`); not a file | none found | `print-api.test.ts:962,1425` (422) |
| `POST /management-api/print-agents/:id/bluetooth/pair` | `printer.bluetooth_not_discovered` | 409 (`:120`) | 400 (judgment) | body `address` (`:737-738`) names a printer the agent has not reported (`:745-746`) | none found | `print-api.test.ts:3236,3251,3265,3329` (409) |
| `POST /management-api/print-agents/:id/bluetooth/forget` | `printer.bluetooth_not_paired` | 409 (`:121`) | 400 (judgment) | body `address` names a printer not reported as paired (`:762-763`). Could also be read as a state clash (409); owner's call | none found | `print-api.test.ts:3294,3308` (409) |

### promote-api.ts — boundary `promote-api.ts:55` (map `:44-52`)

Route: `POST /management-api/promote`. Codes checked 8 / match 7 / mismatch 1.
`promotion.fence_not_attested` 400 (body `oldNodeNeutralised`, `promote.ts:49`),
`promotion.node_fenced` and `promotion.membership_superseded` 409, and the four chart refusals fit.

| Route | Code | Current | Rule | Why | Clients | Tests pinning it |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /management-api/promote` | `promotion.not_a_local_secondary` | default 400 | 409 (judgment) | this node is in mirror mode (`promote.ts:81-83`); nothing in the body is wrong, it clashes with the node's state | none found | none found at the HTTP level (`promote.test.ts` checks the code only) |

### purchasing-api.ts — boundary `purchasing-api.ts:54` (map `:39-52`)

Codes checked 7 / match 6 / mismatch 1. `purchase.not_found` 404 on the path id for GET, PATCH,
DELETE (`:114`, `packages/purchasing/src/operations.ts:320,334`), `purchase.duplicate` 409 on create
(`operations.ts:226-235`), `purchase.invalid` and the `shared.*` codes 400 fit.

| Route | Code | Current | Rule | Why | Clients | Tests pinning it |
| --- | --- | --- | --- | --- | --- | --- |
| `PATCH /management-api/purchase-invoices/:id` | none (a raw unique-index refusal) | 500, by reading | 409 | the patch may change `supplierTaxId` / `supplierInvoiceNumber` (`purchasing-api.ts:105-111`), but `updatePurchaseInvoice` (`operations.ts:302-320`) has no `isUniqueViolation` translation, unlike create (`:227`). Not run | none | none |

### receipt-preview-api.ts — boundary `receipt-preview-api.ts:45` (map `:46-55`)

Route: `GET /management-api/receipt-preview`. Codes checked 4 / match 3 / unclear 1.
`receipt.invalid`, `management.request_invalid`, `shared.invalid_id` fit.

| Route | Code | Current | Rule | Why | Clients | Tests pinning it |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /management-api/receipt-preview?departmentId=` | `department.not_found` | 404 (`:54`) | unclear: the rule names path and body, not a query parameter | `departmentId` is a query value (`:196,235-236`), not the thing the route addresses; if a query value counts with the body, 400 | code only, other routes: `menu-timetable-screen.ts:695,1379`, `venue-operations-screen.ts:1808,1866` | `receipt-preview-api.test.ts:220` (404) |

### recipe-api.ts — boundary `recipe-api.ts:47` (map `:33-45`)

Codes checked 7 / match 7 / mismatch 4 rows, all places where NO code is raised. Fitting: the four
`allergen.*`/`diet.*` codes, `management.request_invalid`, `shared.invalid_id` (400), and
`product.not_found` 404 for a variant id on the recipe PUT (`packages/recipes/src/recipes.ts:90`).

| Route | Code | Current | Rule | Why | Clients | Tests pinning it |
| --- | --- | --- | --- | --- | --- | --- |
| `PUT /management-api/products/:id/recipe` | none (foreign-key refusal on `recipe_lines.ingredient_id`) | 500, by reading | 400 | body `ingredientIds` (`recipe-api.ts:148-151`); inserted with no check (`recipes.ts:92-99`); key at `packages/db/src/schema/recipes.ts:50` | none | none |
| `PUT /management-api/products/:id/recipe` | none (unknown product) | 500 when `ingredientIds` is non-empty (key at `packages/db/src/schema/recipes.ts:45`), by reading; with an empty list, not established | 404 | path id; `recipes.ts:84-85` says the unknown id is "deliberately left to its existing answer" | none | none |
| `GET /management-api/products/:id/recipe` | none | 200 `[]`, by reading (`recipes.ts:28-35`) | 404 | path id never checked | none | none |
| `PATCH /management-api/ingredients/:id` | none | 204, by reading (`packages/recipes/src/ingredients.ts:75-78`: the update's row count is not read) | 404 | path id | none | none |

### recovery-bundle-api.ts — boundary `recovery-bundle-api.ts:39` (map `:24-32`)

Route: `POST /api/box/recovery-bundle`. Codes checked 2 / match 2 / mismatch 0.
`recovery.passphrase_required`, `recovery.passphrase_too_short` 400 fit. Outside the rule:
`recovery.state_incomplete` 500 (`state-secrets.ts:31`) is a missing SERVER file, not one the request
sends; 500 looks right to me.

### report-api.ts — boundary `report-api.ts:97` (map `:66-75`)

Codes checked 3 / match 2 / mismatch 1. `management.request_invalid` 400 fits;
`sale_classification.invalid` 409 (`packages/catalogue/src/sale-classification.ts:80`, today's
catalogue clashes with the checks) I read as a clash, so it fits.

| Route | Code | Current | Rule | Why | Clients | Tests pinning it |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /management-api/reports/categories/print` | `printer.not_found` | 404 (`:72`) | 400 | body `printerId` (`:401`), checked at `:405-410` | none found for this route | `report-api.categories.test.ts:550-557` (three cases, 404) |

### schedule-api.ts — boundary `schedule-api.ts:43` (map `:31-41`)

Codes checked 8 / match 6 / mismatch 2. Fitting: `swap.not_found` 404 (path, accept),
`swap.not_acceptable` and `absence.overlaps` 409, `absence.invalid`, `management.request_invalid`,
`shared.invalid_id` 400.

| Route | Code | Current | Rule | Why | Clients | Tests pinning it |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /api/schedule/swaps` | `shift.not_found` | 404 (`:36`) | 400 | body `fromShiftId` / `toShiftId` (`schedule-api.ts:79-81`), checked at `packages/workforce/src/shift-swaps.ts:28,38` | none found | none found |
| `POST /api/schedule/swaps` | none (foreign-key refusal on `shift_swaps.to_person_id`) | 500, by reading | 400 | body `toPersonId` with `toShiftId: null` is inserted unchecked (`shift-swaps.ts:47-54`); key at `packages/workforce/src/schema/shift-swaps.ts:40` | none | none |

### setup-email-api.ts — boundary `setup-email-api.ts:23`

Route: `POST /setup-api/email-test`. Codes checked 3 / match 3 / mismatch 0
(`setup.already_provisioning` 409, `setup.request_invalid` and the email-settings codes at the default 400).

### stream-api.ts — boundary `stream-api.ts:85` (map `:65-82`)

Routes: `GET/PUT/DELETE /api/backup/stream`, `POST /api/backup/stream/test`, `GET /api/backup/stream/kit`.
Codes checked 11 / match 10 / unclear 1. The 400s (`backup.request_invalid`,
`backup.stream_config_unsafe`, `backup.recovery_key_too_short`) and the 409s (`managed_by_environment`,
`not_primary`, `reload_in_progress`, `stream_not_configured`, `stream_signer_missing`,
`recovery_key_missing`) fit.

| Route | Code | Current | Rule | Why | Clients | Tests pinning it |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /api/backup/stream/test`, `PUT /api/backup/stream` | `backup.stream_test_failed` | 422 (`:76`) | 422 or 400: owner's call | the body's bucket settings fail a probe (`:105-106`). If "a copy that cannot be opened" covers a bucket that cannot be opened, 422 fits; otherwise it is an unusable body value, 400 | not checked | not checked |

Also: `server.credential_unusable` is caught only in the view (`:121-124`). On `GET /kit`,
`readStreamSettings` (`:213`) may raise it, which would answer the default 400. Whether that can
happen there is not established.

### units-api.ts — boundary `units-api.ts:40` (map `:26-39`)

Codes checked 8 / match 7 / mismatch 1. `unit.not_found` 404 on the path id (`getUnit`,
`packages/catalogue/src/units.ts:113,120,156,243`), `unit.in_use` 409, the three translation codes,
`management.request_invalid`, `shared.invalid_id` fit. `product.not_found` is mapped at `:38`, but I
found no route in this file that raises it (not established).

| Route | Code | Current | Rule | Why | Clients | Tests pinning it |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /management-api/units/:id/products/reassign` | `unit.not_found` (the TARGET unit) | 404 (`:36`) | 400 | body `unitId` (`units-api.ts:123-127`), checked at `units.ts:215-216`. The same code answers the path id on the same route (`:130`), so the fix needs the two told apart | `catalogue-screen.ts:948` reads `unit.not_found` with `params.unitId` on a different form (product save) | none found for the target case (`units-api.test.ts:353` pins the path case, which is correct) |

### workforce-api.ts — boundary `workforce-api.ts:65` (map `:45-63`)

Codes checked 13 / match 12 / mismatch 3 rows, all places where NO code is raised. Fitting:
`roster.not_found`, `shift.not_found`, `swap.not_found`, `absence.not_found` (path, 404);
`roster.draft_exists`, `roster.not_draft`, `roster.already_published`, `roster.period_already_published`,
`swap.not_decidable` (409); `shift.invalid`, `management.request_invalid`, `shared.invalid_id` (400).
`convenio.not_found` 409 (no work-time rules for the version's location) is server configuration,
not the request; I read it as a clash and count it as fitting.

| Route | Code | Current | Rule | Why | Clients | Tests pinning it |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /management-api/roster` | none (foreign key `roster_versions_location_fk`) | 500, by reading | 400 | body `locationId` (`workforce-api.ts:134`), inserted unchecked (`packages/workforce/src/clocking.ts:385-387`); key at `packages/workforce/src/schema/roster-versions.ts:44` | none | none |
| `POST /management-api/roster/:versionId/shifts` | none (`shifts_person_fk`, `shifts_location_fk`) | 500, by reading | 400 | body `personId`, `locationId` (`:148-149`), inserted unchecked (`clocking.ts:453-455`); keys at `packages/workforce/src/schema/shifts.ts:29-38` | none | none |
| `PATCH /management-api/roster/shifts/:shiftId` | none (`shifts_person_fk`) | 500, by reading | 400 | body `personId` (`:182`), written at `clocking.ts:472` | none | none |

---

### Statuses outside the rule that look wrong

- `swap.not_permitted` 403 on `POST /api/schedule/swaps` when the body's `toShiftId` belongs to someone
  other than its `toPersonId` (`shift-swaps.ts:40-43`). The caller is allowed to ask; the body
  contradicts itself, so 400 looks closer than 403. (The other `swap.not_permitted`, a caller who does
  not own `fromShiftId`, `:30-33`, is a fair 403.)
- A malformed PATH id answers `shared.invalid_id` 400 through `requireUuidParam` across this share
  (for example `print-api.ts:679`, `payments-api.ts:401`, `workforce-api.ts:177`), while `orders-api.ts:140,149`
  answers a malformed path id with `working_order.not_found` 404. The rule does not say which a
  malformed address is; the two boundaries disagree.
- `mirror.no_relay`, `mirror.not_provisioned`, `module.config_invalid` (mirror bundle) answer 400 for
  server-side configuration faults the request did not cause (see that section).

### Not audited or not established

- Every package-level code reached through `readSettledTicket` / `enqueueReceiptCopy` (reprint),
  `printerProbes.add` (discovery probe), `selectDeviceEquipment` beyond its two mapped codes,
  `resolveAtProvider`, `buildReportContext` / `categoryReport`, and `parseEmailSettings` was not
  traced line by line; I relied on the status maps for them.
- Whether any `withTransaction` wrapper turns a foreign-key refusal into an `AppError` before the
  boundary: I found none by reading, but did not run a request. Every "500, by reading" row depends on it.
  _Merge reader, 2026-10-08, read not run: followed the recipe row's chain. `withTransaction`
  (`packages/db/src/tenancy.ts:30-42`) runs the body under the write lock and translates nothing;
  the store turns foreign keys on for every connection (`packages/store/src/index.ts:154`); the PUT
  route (`recipe-api.ts:143-155`) catches nothing; and `setProductRecipe` inserts the body's
  ingredient ids unchecked (`packages/recipes/src/recipes.ts:91-99`). So by reading, the
  driver's `FOREIGN KEY constraint failed` error reaches `error-boundary.ts:32` as a non-`AppError`
  and the client gets `{ error: { code: "server.internal" } }` with 500. The purchasing row's
  constraint is `purchase_invoices_supplier_number_key`
  (`packages/db/src/schema/purchase-invoices.ts:83`). The roster, ingredient-PATCH (204) and
  units-reassign rows also re-read as stated._

## A394-1 — tasks (lane C, 2026-10-08)

Landed as #1441.

Re-read on `main` at `dd7490505` before writing: the four inserts still take the body ids unchecked
(`packages/workforce/src/clocking.ts` `createRosterVersion`, `addShift`, `updateShift`;
`packages/workforce/src/shift-swaps.ts` `requestSwap`), and `management.request_invalid` is already
400 in all three status tables that serve them (`apps/server/src/workforce-api.ts`,
`schedule-api.ts`, `me-api.ts`), so no table changes. The check goes in the workforce package, where
every caller passes through it; package code already throws `management.request_invalid` elsewhere
(`packages/venue-service/src/routing-store.ts`). Existence only — the same thing the foreign key
holds — never "active" or "not suspended", which would be a new rule.

1. **Package, test first.** In `scheduling.test.ts` and `shift-swaps.test.ts`: an unknown body
   `locationId` on `createRosterVersion`; an unknown `personId` and an unknown `locationId` on
   `addShift`; an unknown `personId` on `updateShift`; an unknown `toPersonId` on `requestSwap`, both
   as a give-away (`toShiftId: null`) and beside a real `toShiftId`. Each asserts
   `management.request_invalid` with the body field's name (`locationId`, `personId`, `toPersonId`)
   and that no row was written. Run them on `main`'s code first and record what each throws (a
   driver foreign-key error, or `swap.not_permitted` for the second swap case).
2. **Package, the fix.** One existence read per body id, after the checks on the thing the path
   names, so a missing roster version or shift still answers its own 404: `createRosterVersion`
   checks the location first; `addShift` after the version's status; `updateShift` after
   `shiftForWrite`, and only when `personId` is in the patch; `requestSwap` after the `fromShift`
   checks and before the `toShift` block. `addShift` checks `personId` before `locationId` (the
   route's screening order), the two reads awaited in turn on `tx`, never in `Promise.all`. Two
   precedence cases: an unknown version with an unknown person still throws `roster.not_found`, and
   an unknown shift with an unknown person still throws `shift.not_found`. For `updateShift`, "no row
   written" means the shift's `person_id` is unchanged. Two swap answers move, and the PR says so:
   an unknown `toPersonId` beside a real `toShiftId` (today `swap.not_permitted`, 403) and beside an
   unknown `toShiftId` (today `shift.not_found`) both become `management.request_invalid`; no test
   pins either (plan review, 2026-10-08).
3. **Routes, test first.** One case per route that reaches each check, asserting status 400 AND
   `{ code: "management.request_invalid", params.field }`: `POST /management-api/roster`,
   `POST /management-api/roster/:versionId/shifts` (person, location),
   `PATCH /management-api/roster/shifts/:shiftId` (person), `POST /api/schedule/swaps` and
   `POST /management-api/me/schedule/swaps` (give-away to an unknown person). Run them on `main`
   first: each must answer 500 `server.internal` there.
4. **Proof by deletion.** Remove each new check in turn and confirm its package and route cases
   fail; restore.

Clients: none read these statuses (the dashboard and till map refusals by code). No migration.
Tests changed: none expected; any that change go in `~/waitron-campaign-c/item-a394-1-changed-tests.md`.

## A394-2 — tasks (lane C, 2026-10-08)

Re-read on `main` at `c68ad3468` before writing. The four rows still hold, by reading:
`setProductRecipe` (`packages/recipes/src/recipes.ts`) refuses a variant but inserts the body's
ingredient ids unchecked, and with an EMPTY list an unknown product falls through
`applyDerivation` (`packages/catalogue/src/operations.ts`, `written === undefined` and no row →
`return`) to a 204; `getProductRecipe` never reads `products`; `updateIngredient`
(`packages/recipes/src/ingredients.ts`) does not read the update's row count. Products are never
hard-deleted (no `delete(products)` outside tests), so a 404 on the recipe read cannot meet a
product the dashboard listed a moment earlier. The dashboard reads these refusals by code only
(`recipe-screen.ts` `#showReadError` / `codeOf`). Neither these routes nor the recipe screen is
reachable today: `mountRecipeApi` is mounted only by tests and `recipe-screen.ts` is imported only by
tests (#345; `docs/backlog.md`, "The recipe routes and the recipe screen are unreached"), so these
answers are what the tests, and any future remount, see. Existence only, the thing the foreign key holds —
never "active": an inactive ingredient stays usable in a recipe, and a variant's recipe read keeps
answering `[]` (`recipes.test.ts`, the variant case).

1. **Package, test first.** In `packages/recipes/src/recipes.test.ts` and `ingredients.test.ts`:
   - `setProductRecipe` with an unknown product id, once with an empty list and once with a real
     ingredient → `product.not_found` `{ productId }`; nothing written (the real ingredient has no
     `recipe_lines` row afterwards).
   - `setProductRecipe` with the same real ingredient id twice → `management.request_invalid`
     `{ field: "ingredientIds" }`, recipe unchanged.
   - `setProductRecipe` on a real product with one real and one unknown ingredient id →
     `management.request_invalid` `{ field: "ingredientIds" }`; the product's existing recipe
     unchanged (set a recipe first, then try the bad one, then read it back).
   - Precedence: an unknown product with an unknown ingredient → `product.not_found` (the path
     first).
   - `getProductRecipe` with an unknown product id → `product.not_found`.
   - `updateIngredient` with an unknown id → `ingredient.not_found` `{ ingredientId }`, both for a
     rename-only patch and for an allergens patch (the fan-out branch).
   Run them on `main`'s code first and record what each does (driver foreign-key error, a silent
   success, or `[]`).
2. **Package, the fix.**
   - `setProductRecipe`: replace the variant-only read with one read of the product's
     `parentId`; no row → `product.not_found`, a variant → `product.not_found` as today. Then, before
     the delete, read the ingredient ids that exist among the DISTINCT body ids (one `inArray`
     select, skipped for an empty list); fewer than the distinct count →
     `management.request_invalid` `{ field: "ingredientIds" }`. A body naming the same id twice
     meets `recipe_lines_product_ingredient_key` today (a 500); it answers the same 400 instead,
     checked before the read (plan review, 2026-10-08). Delete the clause "an unknown id is
     deliberately left to its existing answer" from the comment above the variant read: it stops
     being true.
   - `getProductRecipe`: one existence read of the product first; no row → `product.not_found`.
   - `updateIngredient`: add `.returning({ id: ingredients.id })` to the update; no row →
     `ingredient.not_found` `{ ingredientId: id }`, thrown before the fan-out. Body validation
     (`validateAllergens`, `validateOrigin`) stays first, matching the route, which screens the body
     before any read.
   - New `packages/recipes/src/errors.ts` declaring `"ingredient.not_found": { ingredientId: string }`
     in the shared registry (same shape as `packages/workforce/src/errors.ts`), imported for its side
     effect by `ingredients.ts`, so it is reachable from `src/index.ts` (the reachability guard
     finds packages itself). `product.not_found` is declared at `packages/catalogue/src/errors.ts`,
     reached through `recipes.ts`'s `@waitron/catalogue` import; `management.request_invalid` at
     `packages/shared/src/errors.ts`, reached through `AppError`'s import.
3. **Route, test first.** In `apps/server/src/recipe-api.test.ts`, assert status AND `{ code, params }`:
   `GET /management-api/products/:id/recipe` unknown → 404 `product.not_found`;
   `PUT …/recipe` unknown product (empty list, and with a real ingredient) → 404
   `product.not_found`; `PUT` real product with an unknown ingredient → 400
   `management.request_invalid` `{ field: "ingredientIds" }`; `PATCH /management-api/ingredients/:id`
   unknown → 404 `ingredient.not_found`; `PUT` with the same real ingredient twice → 400
   `management.request_invalid`. Run them on `main` first: GET 200, PUT unknown product with an
   empty list 204, with a real ingredient 500, real product with an unknown ingredient 500, a
   repeated ingredient 500, PATCH 204 — each 500 as `server.internal`. Add
   `"ingredient.not_found": 404` to `recipe-api.ts`'s `STATUS`.
4. **Dashboard wording.** `ingredient.not_found` in `apps/dashboard/src/i18n/codes.ts`, English and
   Spanish, beside `ingredient.name_required`, saying the ingredient no longer exists and to refresh;
   a case in `codes.test.ts` that it is not the generic message in either language.
5. **Proof by deletion.** Remove each new check in turn (product existence in set and get, the
   ingredient-id check, the update's row check) and confirm its package and route cases fail;
   restore.
6. **Guards.** `pnpm exec vitest run scripts/errors-reachable.test.ts` from the root; the golden huella and `inmutabilidad` unedited.

`product.not_found` has no dashboard wording, so the recipe screen shows the generic message for
it, as it already does for a variant; not this item's to add — say so in the PR.

Clients: none read these statuses. No migration. Tests changed: none expected; any that change go in
`~/waitron-campaign-c/item-a394-2-changed-tests.md`.

## A394-3 — tasks (lane C, 2026-10-08)

Re-read on `main` at `6a8320998` before writing. The five rows still hold, by reading:
`insertProduct` (`packages/catalogue/src/operations.ts`, behind `createProduct`) checks the body's
category and unit but never its `catalogueId`, so an unknown one meets the `products.catalogue_id`
foreign key; `addCatalogueToLocation` inserts the path's `locationId` unchecked (foreign key), and
`setLocationDefaultCatalogue` reads the location row, finds none, and its `assignCatalogueToLocation`
update matches nothing (204); `GET /management-api/catalogues/:id/products` hands the path id to
`listProducts`, which filters by it (200 `[]`); `PUT /management-api/products/:id/course`
(`apps/server/src/management-api.ts`) returns early on a malformed id and `setProductCourse`
(`apps/server/src/kitchen.ts`) updates no row for an unknown or variant id (both 204). No
`location.not_found` code exists anywhere (`git grep -n 'location.not_found'`), and
`management-api.ts`'s `STATUS` has no `product.not_found` row (it would fall to 400). Precedence as
A394-1 and A394-2: the thing the path names is checked before anything the body names. Existence
only, never "active".

The two location routes' body `catalogueId` keeps answering `catalogue.not_found` 404 here; moving
a body catalogue to 400 there is A394-11's (pinned by `catalogue-api.test.ts:1123-1138`). The
location list `GET …/locations/:locationId/catalogues` and the member `DELETE` are not in the
defects table and are left as they are (the DELETE is documented as a no-op for a non-member); the
PR names both as open points, with a third: a MALFORMED location or catalogue path id on these
catalogue routes keeps answering 400 `shared.invalid_id` (pinned at `catalogue-api.test.ts:1147,1545`)
until A394-22, while the course route below answers 404 for the same mistake.

Catalogues are never deleted (no `delete(catalogues)` outside tests), and the dashboard asks for a
catalogue's product list only for catalogues it has just listed (`catalogue-screen.ts:294-300`), so
a live screen cannot meet the new 404 on the product list. Plan review (fresh context, 2026-10-08)
folded in below.

1. **Package, test first** (`packages/catalogue`, its existing suites beside `operations.ts`'s
   location and product tests):
   - `createProduct` with an unknown `catalogueId` → `catalogue.not_found` `{ catalogueId }`.
     Precedence: an unknown catalogue with an unknown `categoryId` → still `catalogue.not_found`
     (the route screens `catalogueId` first).
   - `addCatalogueToLocation` with an unknown location → `location.not_found` `{ locationId }`, no
     `location_catalogues` row; with a real location and an unknown catalogue →
     `catalogue.not_found` `{ catalogueId }`; unknown both → `location.not_found`.
   - `setLocationDefaultCatalogue` with an unknown location → `location.not_found`; real location,
     unknown catalogue → `catalogue.not_found`; unknown both → `location.not_found`.
   No "nothing written" read-backs: a throw rolls the whole transaction back wherever the check
   sits, so such a read-back passes for a right and a wrong fix alike; the asserted CODE is what
   tells them apart. Run each on `main`'s code first and record what it does (a driver foreign-key
   error, or a silent success).
2. **Package, the fix.**
   - New code `"location.not_found": { locationId: string }` in `packages/catalogue/src/errors.ts`
     (the only thrower; `operations.ts` already imports that registry).
   - `insertProduct`: `catalogueExists` just before `readCategory` (after the plain input checks,
     as A394-2 kept them first); no row → `catalogue.not_found` `{ catalogueId }`. Only
     `createProduct` asks for it: `insertProduct`'s boolean becomes an options object
     `{ checkNames, checkCatalogue }`, and `createProductSkippingNameCheck` passes both false, because
     its one caller, the product editor, has already read its PATH catalogue in the same transaction
     (`product-editor.ts:155-161`) — so the editor pays no second read and its answer is unchanged.
     Say so in that function's doc comment.
   - `addCatalogueToLocation`: read the location (`locations.id`), none → `location.not_found`; then
     `catalogueExists`, none → `catalogue.not_found`; then insert. `setLocationDefaultCatalogue`:
     its existing location read, no row → `location.not_found`; then `catalogueExists`; its demote of
     the old default goes through an unexported unchecked insert (the old default is a stored
     foreign key, so it exists), so the location is not read twice. Reads awaited in turn on `tx`.
     The route's `assertCatalogueVisible` calls on these two routes are removed (the package now
     checks, path first); `assertCatalogueVisible` stays for the product list in step 3. Fix the doc comment on
     `catalogueExists` / `assertCatalogueVisible` if a sentence stops being true.
3. **Routes, test first** (`apps/server/src/catalogue-api.test.ts`, `management-api.test.ts`),
   asserting status AND `{ code, params }`:
   - `POST /management-api/products` with an unknown body `catalogueId` → 400
     `catalogue.not_found` `{ catalogueId }`: a second boundary for this route only,
     `{ ...STATUS, "catalogue.not_found": 400 }`, beside `runSize`, with a one-line comment (body id
     → 400, the rule in `docs/developers/conventions-data.md`).
   - `POST /management-api/locations/:locationId/catalogues` and `PUT …/default-catalogue`, unknown
     location (with a real catalogue, and with an unknown one) → 404 `location.not_found`
     `{ locationId }`; add `"location.not_found": 404` to `STATUS`. The existing
     real-location/unknown-catalogue cases (`:1123-1138`) must still pass unedited.
   - `GET /management-api/catalogues/:id/products`, unknown catalogue → 404 `catalogue.not_found`
     `{ catalogueId }`, by `assertCatalogueVisible` in the route before `listProducts` (other
     `listProducts` callers keep their answer).
   - `PUT /management-api/products/:id/course`: a malformed `:id` → 404 `product.not_found`
     `{ productId }` (owner answer to question 7: a malformed path id is 404; the sibling course
     routes already answer a malformed course id this way, `requireCourseId`). Add a
     `requireProductId` beside the other `require*Id` helpers (`management-api.ts` ~326-390) and call
     it right after `requireManagementSession`, before `readJsonBody`, so the path is screened before
     the body — like the sibling course routes, it answers before the permission check. Precedence
     case: malformed `:id` with a malformed `courseId` → `product.not_found`. An unknown
     product and a variant's id → 404 `product.not_found`, nothing written. In `setProductCourse`,
     read the product with `productWithId(productId, scope)` FIRST, none → `product.not_found`
     `{ productId }`, then the course check, then the update; replace the doc comment's "an absent
     `productId` … is a no-op" with the new answer. Precedence: unknown product with a well-formed
     unknown course → `product.not_found`. Add `"product.not_found": 404` to `management-api.ts`'s
     `STATUS` after checking with `git grep` that no other route on that boundary can raise it.
     Fix the route comment naming `registerStationRoute`, which no longer exists.
   Run every route case on `main` first and record each: unknown body catalogue 500
   `server.internal`; unknown location with a real catalogue 500 (add) and 204 (default); unknown
   location with an unknown catalogue 404 `catalogue.not_found` on both (the route's catalogue
   check runs first today); product list 200 `[]`; course 204 for malformed, unknown and variant ids.
   **Two existing checks change** (they pin the no-op this item replaces; list each in the
   changed-tests file, old → new → why):
   - `apps/server/src/management-api.test.ts:3230` (title "a malformed product is a no-op") and
     `:3273-3274` (a malformed product id answers 204) → 404 `product.not_found`.
   - `apps/server/src/kitchen.test.ts:565-574` ("leaves a variant's id alone, as it does an id
     naming no product") → split: a variant's id or an unknown id under the default scope →
     `product.not_found`, and scope `"any"` still writes to a variant.
4. **Dashboard wording.** `location.not_found` in `apps/dashboard/src/i18n/codes.ts`, English and
   Spanish ("local", as the file's other location wording), saying the location no longer exists
   and to refresh; a case in `codes.test.ts` that it is not the generic message in either language.
   `product.not_found` has no dashboard wording; not this item's (say so in the PR).
5. **Proof by deletion.** Remove each new check in turn (catalogue in `insertProduct`, location and
   catalogue in each location function, the route's catalogue check on the product list, the product
   read in `setProductCourse`, the malformed-id check) and confirm its package and route cases fail;
   restore.
6. **Guards.** From the root: `pnpm exec vitest run scripts/errors-reachable.test.ts
   scripts/alert-codes.test.ts`; the golden huella and `inmutabilidad` unedited. Coverage is CI's;
   run `pnpm --filter @waitron/catalogue test:coverage` only if chasing a gap.

Clients: none read these statuses (the dashboard maps refusals by code). No migration. Tests
changed: the two above, and any other existing assertion that changes, go in
`~/waitron-campaign-c/item-a394-3-changed-tests.md` (old, new, why); `setProductCourse`'s callers' suites in `apps/server` are run in full because its
no-op answer changes.
