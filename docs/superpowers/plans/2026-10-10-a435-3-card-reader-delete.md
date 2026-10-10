# A435 step 3: Card Reader Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manager can permanently delete a card reader from the dashboard's Card readers tab,
after a confirmation that says what the delete will refuse, end and remove; the reader is unpaired
at its provider first where the provider allows it, its settings links go, and its payments keep
pointing at the retained row.

**Architecture:** Step 2's pattern, applied to readers. The `card_readers` row gains `deleted_at`
and its provider-id key stops counting deleted rows. One server rules function
(`apps/server/src/card-reader-delete.ts`) feeds both the impact read and the delete, on the
caller's transaction. Because unpairing calls the provider over the network, the delete route runs
three steps: a refusal check, the provider call and its marker (exactly the writes Unpair makes),
then one `withTransaction` that recomputes the impact and deletes. The dashboard reuses
`wt-delete-dialog` with reader copy.

**Tech Stack:** TypeScript, Drizzle over SQLite (`node:sqlite`), Hono, Lit, Vitest with real venue
databases and Chromium.

**Spec:** [Delete and archive design](../specs/2026-10-08-delete-and-archive-design.md), Build
order step 3 ("Card readers") and "The shared model". Read with the landed step 2 plan,
[2026-10-09-a435-2-printer-delete.md](2026-10-09-a435-2-printer-delete.md), and its code on main.

**Execution base:** code citations were read at main `951d59f01` (step 2 landed as `ad64b10be`,
#1514); this plan was then rebased onto `d1a0a16b3` (origin/main on 2026-10-10), and
`git diff --stat 951d59f01 origin/main -- apps/server/src
apps/dashboard/src/screens/payments-screen.ts apps/dashboard/src/api apps/dashboard/src/i18n
packages/payments` printed nothing, so they still
hold there. Re-run the searches in "Current inventory" if main has moved again.

**Overlap with steps 4 and 5.** Whoever lands second rebases and re-reads the whole changed range
of every shared file, not only the conflict hunks.

- **Step 4, devices** ([2026-10-10-a435-4-device-delete.md](2026-10-10-a435-4-device-delete.md),
  on main as a plan, not built). It edits the device reader PUT in `apps/server/src/payments-api.ts`
  (its device-existence check), removes `device_card_readers` and `card_reader_holders` rows for a
  deleted device, and touches `apps/dashboard/src/api/live-queries.ts`,
  `apps/dashboard/src/i18n/strings.ts` and `codes.ts`, design-system.md and the backlog (its
  "Overlap" paragraph says the same of this step). Its migration is in the core set
  (`packages/db`), this step's in the payments set; if both ever land in one set, the second fixes
  the clash by regenerating (CLAUDE.md §3), never by hand-editing the journal.
- **Step 5, courses and stations**
  ([2026-10-10-a435-5-courses-stations-delete.md](2026-10-10-a435-5-courses-stations-delete.md),
  not built): touches `apps/server/src/errors.ts`, `strings.ts`,
  `apps/dashboard/src/api/{client,live-queries}.ts`, design-system.md and the backlog, and adds a
  core migration. If it lands first with its own name-sorting helper, use that instead of
  creating `delete-impact-items.ts`.

## Decisions this plan makes that the spec does not

Each line is the default that will be built. The owner may overrule any of them before Task 1.

1. **The delete runs in three steps around the provider call.** (a) One transaction recomputes
   the rules and refuses with the first refusal's code; when the reader will be unpaired at its
   provider, the same transaction switches it off (`active = false`, `disabled_at` set if it was
   null), so no new payment is routed to it while the provider is called. (b) If the reader is
   still paired at a provider that can unpair, the provider is called outside any transaction,
   then the unpair marker is written in its own transaction with exactly the columns Unpair writes
   (`apps/server/src/payments-api.ts:651-658`). (c) One `withTransaction` recomputes the impact and
   deletes. **Default when a refusal appears during (b):** the reader stays unpaired and switched
   off, as after a plain Unpair, the delete answers that refusal's code, and nothing else changes;
   a later Delete skips the provider because the reader is already unpaired.
   **Why switching off in (a) is enough, and the gap it leaves:** both card pay paths resolve the
   reader with `active = true` (`apps/server/src/till-api.ts:316`; the bill route goes through the
   same `resolveCardCollector`, `apps/server/src/bill-payments-api.ts:236`), so a pay that starts
   after (a) is refused `reader.not_found`. A pay that resolved the reader before (a) commits its
   `attempting` row in a later transaction, which checks the holder and other devices' payments
   but not `active` (`packages/payments/src/store.ts:129-140,146-164`); that row can still land
   during (b). Step (c)'s recheck then refuses the local delete, but the provider has already
   unpaired the reader under that payment. That window — one in-flight pay that had resolved its
   reader before (a) committed — is accepted, as the existing Unpair route accepts a wider one (it
   has no payment check at all, `payments-api.ts:639-662`).
2. **A provider that cannot unpair (Stripe) does not block the delete.** Stripe's seat declares
   `canUnpair: false` (`packages/payments-stripe/src/card-provider.ts:191`) and its `remove` makes
   no call (`:234-236`), and the Unpair route refuses it (`payments-api.ts:645-646`). Default: the
   reader is deleted without contacting Stripe, `unpaired_at` stays null, and the registration
   stays at Stripe, where discovery offers it as a new reader.
3. **"The provider cannot be reached" has two forms.** A still-paired reader whose provider can
   unpair but has no stored credential is a refusal in the impact, reusing
   `reader.provider_disconnected` (registered at `apps/server/src/errors.ts:226`). A provider call
   that fails answers a new code, **`reader.unpair_failed`** `{ providerId }`, HTTP 502. **It
   leaves the reader switched off** (step (a)'s write, decision 1) and changes nothing else: no
   link removed, `unpaired_at` and `deleted_at` still null. Its dashboard message says so (Task
   5). An `AppError` the seat throws passes through with its own code. The Unpair route keeps
   answering `server.internal` 500 on a failed call, as its test pins
   (`apps/server/src/payments-api.test.ts:1043-1044`).
4. **The provider is looked up only for a reader that is still paired** (`unpaired_at` null), so
   an already-unpaired reader is deleted without consulting its provider at all, as the spec says.
   A still-paired reader whose provider module is not installed answers
   `payment.provider_unknown` from `cardProviderById`, as every other provider-touching reader
   route already does, and cannot be deleted until that provider is installed.
5. **Impact keys.** Refusals: `reader.payment_in_progress` (params `{ readerId }`, targets the
   devices whose payments are in progress) and `reader.provider_disconnected` (params
   `{ providerId }`, no targets), in that order. Ends: `provider_pairing` (one target,
   `{ id: providerId, name: providerId }`). Removes: `device_reader`, `device_reader_default`,
   `profile_reader`, `profile_reader_default`, `reader_holder`. The holder is under removes because
   the spec lists `card_reader_holders` under "Removed"; printers listed theirs under ends
   (`apps/server/src/printer-delete.ts:144`) because the printer spec said "Ended".
6. **`device_reader_default` names active devices with no explicit choice whose profile default
   is this reader**, the same rule as the reader list's "In use by" column
   (`payments-api.ts:546-556`). It is explanatory: those devices lose the default when the profile
   row goes. `device_reader` names every device whose `device_card_readers` row is removed,
   switched off or not, so its count equals the rows removed.
7. **Removing a default leaves none.** A profile whose default was this reader has no default
   afterwards; devices whose choice is cleared go back to Use default and acquire nothing, as
   `setProfileReaderList` does (`packages/payments/src/device-readers.ts:57-61`).
8. **`disabled_at` keeps its first value.** Delete sets `active = false` and `deleted_at = now`,
   sets `disabled_at = now` only when it was null, and never touches `unpaired_at`, `name`,
   `provider` or `provider_ref`. One exception, kept so Unpair's behaviour does not change: when
   the delete unpairs, the marker is written as Unpair writes it, which sets `disabled_at` to the
   unpair time (`payments-api.ts:651-658`).
9. **A stale by-id write answers `reader.not_found`.** Path ids answer it at the route's existing
   status (404 in the payments API, `payments-api.ts:114`; 404 in the till API, `till-api.ts:483`,
   whose boundary the bill payment routes share, `till-api.ts:1086`). A deleted id inside a till
   equipment body answers 400, which is what the error boundary gives a code the device API does
   not map (`packages/server-kit/src/error-boundary.ts:33`; the device API's STATUS map,
   `apps/server/src/device-api.ts:131`, has `reader.payment_in_progress` at `:157` and no other
   `reader.*` code). `selectDeviceReader` returns a new refusal
   `"deleted"` that the server maps to `reader.not_found`, because that code's registry is in
   `apps/server/src/errors.ts:219`, which `@waitron/payments` cannot import.
10. **The rules live in the server, as step 2's did** (`apps/server/src/card-reader-delete.ts`
    beside `printer-delete.ts`). Step 2's private `named` helper (`printer-delete.ts:38-43`) moves
    to `apps/server/src/delete-impact-items.ts` as `namedItem` and both files use it; printer
    behaviour and its tests do not change. The backlog's open layering points for printers (the
    entries "`refuseDeletedPrinters` lives in `@waitron/layouts`…" and "`deletePrinter` writes the
    device choices, profile lists and holders that layouts owns…") stay open.
11. **`DELETE` returns the final transaction's recomputed impact.** After an unpair in the same
    request that impact no longer lists `provider_pairing`; the dashboard does not read the body.
12. **Delete sits in the reader table's row menu only**, beside Disable or Enable, for active and
    disabled readers. It is `danger`, and quiet (`secondary`, disabled) while the screen is busy,
    as its siblings are disabled (`apps/dashboard/src/screens/payments-screen.ts:1642-1695`).
13. **Reader copy has its own keys** (`payments.reader_delete_*`), worded as printers' where the
    sentence is the same. Step 2's `printers.delete_*` keys are not touched.
14. **The open dialog does not re-read when a provider is connected or disconnected**:
    `tenant_credentials` is not a live resource (`apps/dashboard/src/api/live-queries.ts:80`). The
    delete recomputes it anyway.
15. **No configuration-transfer change.** The payments module exports only `payment_policy`
    (`packages/payments/src/configuration-transfer.ts:1-4`), so no reader, choice or profile list
    travels.
16. **The migration belongs to the payments set** (`packages/payments/drizzle`,
    `packages/payments/src/migrations.ts:5-9`). A generation probe, below, emitted no table
    rebuild. Whether a venue reset is needed is decided from `scripts/migration-upgrade.test.ts`
    and the generated SQL, never in advance.
17. **The LOOK uses the screen in real Chromium with a stubbed API**, because the demo stack's only
    reader is the hidden demo reader and listing any other needs a connected provider account. A
    live-stack look is added only if this worktree has a dev slot nobody else uses (Task 8b).
18. **A still-paired reader whose provider account is disconnected cannot be deleted** — built as
    the spec says ("If the provider cannot be reached the delete is refused"). Reconnecting the
    account, or Unpair while connected, makes it deletable; Disable still works meanwhile. The same
    holds while the provider rejects the stored key, since every call fails. **Open question for
    the owner**; the default stands until answered.
19. **The DELETE route says at its site why it is split** across transactions and what a refusal
    after the unpair leaves behind (CLAUDE.md §3: "Splitting one logical change across
    transactions is a commented decision"). One line, in Task 3.

## Global Constraints

- Spec: "Deletion is a permanent deleted state, not row removal."
- Spec: "Disable stays beside Delete for hardware only": Disable, Enable, Unpair, rename and the
  disable dialog's "also unpair" keep their behaviour for readers whose `deleted_at` is null.
- Spec, card readers: "**Refused by:** a payment in progress on it (`reader.payment_in_progress`)."
- Spec, card readers: "a reader still paired is unpaired at the provider first, exactly as Unpair
  does (`POST …/readers/:id/unpair`, `apps/server/src/payments-api.ts`). If the provider cannot be
  reached the delete is refused. An already-unpaired reader is deleted without contacting the
  provider. The unpair marker stays on the deleted row; adopting the same physical reader later
  goes through the provider check and creates a new record."
- Spec, card readers: "**Removed:** its rows in `device_card_readers`,
  `device_profile_card_readers` and `card_reader_holders`."
- Spec, card readers: "**Not deletable:** the seeded demo reader, which management routes already
  hide."
- Spec: "A deleted record cannot be enabled, edited or brought back. A read or write that names
  one by id answers the kind's existing `*.not_found` code" — for readers, `reader.not_found`.
- Spec: "The delete recomputes the same impact inside ONE `withTransaction` and acts on it."
  Never act on counts or ids the client sends.
- Spec: "Each delete route requires the same permission as editing that kind today":
  `payments.manage` (`payments-api.ts:98`, used by `gated` at `:214-225`), for both calls.
- Spec: "No fiscal, sales or hash-chained table is touched, and no history column loses its
  database link." Nothing in this item touches the fiscal core: `computeHuella`, the hash chain,
  invoice numbering, `registros_facturacion`, `recordSale`, `recordCorrection` or
  `recordSubstitution`. The golden huella tests and `inmutabilidad` pass **unedited**; a needed
  change to either is a STOP, not a fixture correction.
- `payments.reader_id` keeps its foreign key to the retained row; no payment row is written.
- Step 2's printer behaviour is unchanged; its tests pass unedited after the `namedItem` move.
- Every task is test-first: write the failing case, run it, see it fail for the stated reason,
  then implement. Read the TDD skill before writing code. A missing-import or type error is not a
  behavioural RED.
- Rejected writes assert the domain error code. A test catches an expected refusal outside
  `withTransaction`. Statements on one transaction are awaited in turn, never `Promise.all`.
- Migrations: `drizzle-kit generate` picks the number; never hand-edit generated SQL, snapshots
  or `_journal.json`; never edit a shipped migration.
- Forms follow design-system.md → Forms. This item adds no form: the dialog stages no input. The
  row-menu Delete follows the quiet-until-it-can-act rule (CLAUDE.md §3).
- UI text is as short as the meaning allows, in English and Spanish.
- One implementer at a time in this worktree. Each task is sized well under 100 tool calls; an
  implementer past about 150 calls stops at a passing or cleanly red point, commits and hands over.
- Record the process id of anything you start and stop only those (`pnpm reap` for orphans).
- Every commit is `git commit -s`; no `--no-verify`. Coverage and mutation bars are unchanged;
  no exclude or ignore comment is added over reachable code.

## Review Focus

1. **Adopt after the migration.** With a partial unique index, an `ON CONFLICT` naming the columns
   without the index's condition is refused for every insert (probe below), so the existing adopt
   route would fail every time. Test: adopting a disabled reader still reuses its id, and adopting a
   deleted reader's provider id creates a new id and leaves the deleted row as it was (Task 1,
   Task 4a).
2. **A payment around the provider call.** Once step (a) has run, a new pay naming the reader, or
   paying on the device's default, is refused `reader.not_found` (Task 4b). A payment row that
   lands during the call anyway (decision 1's accepted window) makes the delete refuse with
   `reader.payment_in_progress`, leaving the reader unpaired and switched off but not deleted, with
   no link removed; a retry after the payment ends deletes without a second provider call
   (Task 3).
3. **A stale form or till list resubmits a deleted reader id**, unchanged: the device reader PUT,
   the profile readers PUT and the till's equipment PUT answer `reader.not_found` and write nothing
   (Tasks 4a, 4b and 7).
4. **Discovery shows a deleted reader's provider id as "disabled" today**, whose Enable would
   re-enable the old row through adopt. It must read "available", and Add must create a new reader
   (Task 4a, Task 6).
5. **An impact read for reader A lands after the dialog closed and reopened on reader B**, or a
   payment starts while the dialog is open: the answer for A is never applied to B, and a new
   payment in progress disables Delete through the live re-read (Task 6).

## Probes run while writing this plan

Run 2026-10-10 on Node v26.7.0 (`node:sqlite`) and drizzle-kit in this worktree. They are
receipts for the defaults above, not substitutes for the tasks' tests.

- **Generation.** With `deletedAt: tsString("deleted_at")` added and the key rewritten as
  `uniqueIndex("card_readers_provider_ref_key").on(t.provider, t.providerRef)
  .where(sql\`${t.deletedAt} is null\`)`, `pnpm exec drizzle-kit generate --name
  card_reader_delete` in `packages/payments` wrote `0007_card_reader_delete.sql` containing only
  `DROP INDEX`, `ALTER TABLE card_readers ADD deleted_at text` and `CREATE UNIQUE INDEX … WHERE
  "card_readers"."deleted_at" is null`. No table rebuild. The probe's files were then removed and
  the schema file restored; the task regenerates for real.
- **Conflict target.** Table `card_readers` with that partial index. `INSERT … ON CONFLICT
  (provider, provider_ref) DO UPDATE …` was refused with "ON CONFLICT clause does not match any
  PRIMARY KEY or UNIQUE constraint", on an empty table as well as with a deleted row present. With
  `… ON CONFLICT (provider, provider_ref) WHERE deleted_at is null DO UPDATE …` the insert
  beside a deleted row with the same key created a second row, and a second such insert updated
  the live row. Both the bare and the table-qualified `"card_readers"."deleted_at" is null`
  forms were accepted. drizzle-orm 0.45.3's SQLite `onConflictDoUpdate` takes `targetWhere`
  (`sqlite-core/query-builders/insert.d.ts:53`).
- **What drizzle emits** (added after review, 2026-10-10). Through `drizzle-orm/sqlite-proxy`
  0.45.3 resolved from `packages/payments`, an insert on a `card_readers` table with that partial
  index and `.onConflictDoUpdate({ target: [provider, providerRef], targetWhere:
  isNull(deletedAt), set: … })` printed, from `.toSQL().sql`:
  `… on conflict ("card_readers"."provider", "card_readers"."provider_ref") where
  "card_readers"."deleted_at" is null do update set "name" = ?, "active" = ?`. That exact
  statement, run on `node:sqlite` beside a deleted row with the same key, inserted a new row the
  first time and updated it the second, leaving the deleted row unchanged.

## Current inventory (read at `951d59f01`, not runtime verified)

Re-run before Task 1: `rg -n 'cardReaders|card_readers|readerId|reader_id|DEMO_READER'
apps packages -g '*.ts' -g '*.sql' -g '!**/node_modules/**'`.

### Tables and columns that name a card reader

Each entry: where, what it is today, and what this step does with it.

- `packages/payments/src/schema/card-readers.ts:10-25`; SQL
  `packages/payments/drizzle/0000_baseline.sql:1-12`. The row: `provider`, `provider_ref`, `name`,
  `active`, `created_at`, `disabled_at`, `unpaired_at`. Key `card_readers_provider_ref_key` on
  `(provider, provider_ref)`, declared with `unique()` at `:24` and emitted as `CREATE UNIQUE
  INDEX` (baseline `:12`). No location column. The header comment (`:4-9`) says "never deleted".
  **T1:** add `deleted_at`; the key becomes a partial unique index on undeleted rows; rewrite the
  comment.
- `packages/payments/src/schema/device-card-readers.ts:10,21-23`; baseline `:13-18`. A device's
  explicit choice, `ON DELETE restrict`. **T2:** settings, removed.
- `packages/payments/src/schema/device-profile-card-readers.ts:11,26-28,30`;
  `packages/payments/drizzle/0006_device_reader_equipment.sql:9-19`. A profile's list, position and
  partial-unique default, `ON DELETE restrict`. **T2:** removed; a removed default leaves none.
- `packages/payments/src/schema/card-reader-holders.ts:9,14-17`; `0006…sql:1-7`. Who holds it,
  `ON DELETE cascade` (nothing cascades, because the row stays). **T2:** removed.
- `packages/payments/src/schema/payments.ts:60,110-114,126`; baseline `:68`. `payments.reader_id`,
  nullable, `ON DELETE restrict`. **T2:** a row in `attempting` or `initiated`
  (`packages/payments/src/provider.ts:25-28`) refuses the delete; every other row is history and
  is not written.
- `packages/payments/src/classification.ts:17-20`: all four reader tables are `state`. Unchanged;
  no new table.
- `packages/payments/src/configuration-transfer.ts:1-4`: exports only `payment_policy`.
  Unchanged (decision 15).
- `packages/fiscal-verifactu/src/privileges.expected.ts:26,39`: a retired privilege record. Not
  touched.

### Server paths that read or write a reader

- `apps/server/src/payments-api.ts:145-153` `requireKnownReader`: unknown or demo id →
  `reader.not_found`; used by the device reader PUT and the profile readers PUT. **T4a:** also
  refuse a deleted id.
- `payments-api.ts:330-340` `requireReader`: the same for rename, disable, enable and unpair.
  **T4a:** also refuse a deleted id.
- `payments-api.ts:342-366` available readers: labels a known provider id `added` or `disabled`
  from every row (`:354-362`). **T4a:** ignore deleted rows, so it reads `available`.
- `payments-api.ts:368-397` adopt: an upsert on the key re-enables the row and clears
  `unpaired_at` (`:386-392`). **T1:** `targetWhere` deleted is null; **T4a:** a deleted row is
  never resurrected.
- `payments-api.ts:399-412` rename and `:414-437` disable and enable, through `requireReader`.
  **T4a:** deleted → 404.
- `payments-api.ts:495-514` provider disconnect: refused while an active reader uses the
  provider. Unchanged: a deleted reader is switched off.
- `payments-api.ts:516-566` reader list: excludes the demo reader (`:529`); "In use by" comes from
  choices, then profile defaults of active devices (`:546-556`). **T4a:** exclude deleted.
- `payments-api.ts:569-618` pair new: a plain insert. Unchanged; **T4a** tests that a deleted
  reader's provider id no longer collides.
- `payments-api.ts:620-637` live status: its own lookup, demo excluded. **T4a:** refuse deleted.
- `payments-api.ts:639-662` unpair: read, provider call, then an update with no deleted guard
  (`:651-658`). **T3:** the final write moves to the guarded `markCardReaderUnpaired`.
- `payments-api.ts:664-691` holders and busy readers, from holder rows and in-progress payments.
  Unchanged; a deleted reader has neither.
- `payments-api.ts:693-707` and `:709-735` device reader GET and PUT; the PUT checks
  `requireKnownReader`, then `selectDeviceEquipment`. **T4a:** deleted → 404.
- `payments-api.ts:737-749` and `:751-789` profile readers GET and PUT; the PUT checks every id
  with `requireKnownReader`. **T4a:** deleted → 404, list unchanged.
- `packages/payments/src/device-readers.ts:265-328` `selectDeviceReader`: refuses
  `not_permitted` unless listed, active, not unpaired and not the demo reader (`:279-292`).
  **T4b:** a new first refusal, `deleted`.
- `device-readers.ts:97-114` `readerPaymentInProgress` and
  `packages/payments/src/store.ts:129-140,146-164`: a payment start checks the holder and other
  devices' in-progress payments, not `active`. Unchanged; with the holder removed a start is
  refused `reader.not_held`.
- `apps/server/src/till-api.ts:297-334` `resolvePayReader`: requires `active = true` (`:316`),
  then `assertReaderStartable`. Unchanged; **T4b** pins it.
- `till-api.ts:1238-1250` the till's boot readers: the resolved reader, `active = true`.
  Unchanged.
- `apps/server/src/bill-payments-api.ts:231-242`: through `resolveCardCollector`. Unchanged.
- `apps/server/src/device-equipment.ts:89-95,152-164,270-278,324-349`: holders, reader
  availability, choices and the select mapping. **T4b:** map `deleted` → `reader.not_found`.
- `apps/server/src/device-api.ts:343-353` the till's equipment PUT, through
  `selectDeviceEquipment`. **T4b:** deleted → 400 `reader.not_found`.
- `apps/server/src/alert-sources.ts:416-423` battery alerts: active readers only, demo excluded.
  Unchanged; **T4b** pins it.
- `apps/server/src/boot.ts:341-375` seeds and switches the demo reader. Unchanged; the demo
  reader is never deletable.

### Screens that list or pick readers

- `apps/dashboard/src/screens/payments-screen.ts:575-597` (list watch), `:1635-1695` (row menu),
  `:1700-1793` (discovery; `:1774` draws Enable for `disabled`), `:1975-2010` (status filter).
  **T6:** Delete in the row menu and the dialog; deleted readers are never listed (server, T4a).
- `apps/dashboard/src/api/client.ts:1597-1605,1614-1621,3773-3853`;
  `apps/dashboard/src/api/live-queries.ts:77-80`. **T5:** new methods and dependencies.
- `apps/dashboard/src/screens/devices-screen.ts:151-153,549-559`;
  `device-profiles-screen.ts:552-555,585`. **T7:** stale-choice tests; code only if they fail.
- `apps/till/src/widgets/equipment-dialog.ts` (its stale printer test is at
  `equipment-dialog.test.ts:435`), `reader-picker.ts`, `tender-pay.ts:218-236`. **T7:** a stale
  reader test; the till's pay list comes from server reads (`till-api.ts:1238-1250`).
- venue-service: `grep -rli 'cardReader\|card_reader\|readerId' packages/venue-service/src`
  printed nothing on 2026-10-10.

### What step 2 built that this step reuses

- `DeleteTarget`, `DeleteImpactItem`, `DeleteImpactRefusal`, `DeleteImpact`
  (`packages/shared/src/delete-impact.ts:5-17`), unchanged.
- The rules-then-act shape: one private rules function, `readPrinterDeleteImpact` and
  `deletePrinter` both calling it (`apps/server/src/printer-delete.ts:46-163,166-172,179-202`).
- Routes under the kind's `gated` helper (`apps/server/src/print-api.ts:1008-1022`).
- `wt-delete-dialog` (`packages/ui/src/components/wt-delete-dialog.ts`: copy `:15-27`, properties
  `:86-94`, enable rule `:99-106`) and its contract in `docs/developers/design-system.md`, the
  paragraph starting "A confirmed Delete asks with `wt-delete-dialog`".
- The screen flow: per-opening generation, its own `DashboardQueries` for the impact, separate
  read and action errors, close-then-reload (`apps/dashboard/src/screens/printers-screen.ts:865-869,
  3922-4077`), and the copy adapter shape (`apps/dashboard/src/widgets/printer-delete-copy.ts`).
- Live dependency style (`apps/dashboard/src/api/live-queries.ts:63-74`).
- `deleted_at` plus a partial unique index (`packages/db/src/schema/printers.ts:49-57`,
  `packages/db/drizzle/0133_printer_delete.sql`).

## Interfaces

`apps/server/src/delete-impact-items.ts` (new; step 2's helper moved, unchanged behaviour):

```ts
/** One item naming each distinct target once, sorted by name then id; count = distinct rows. */
export function namedItem(key: string, targets: DeleteTarget[]): DeleteImpactItem;
```

`apps/server/src/card-reader-delete.ts` (new). Takes the caller's `Transaction`; never opens one:

```ts
export type CardReaderDeletePlan = {
  impact: DeleteImpact;
  provider: string;
  providerRef: string;
  /** Still paired at a provider whose seat can unpair: the delete unpairs it there first. */
  unpairAtProvider: boolean;
};
export function readCardReaderDeleteImpact(
  tx: Transaction, seats: readonly CardProviderContribution[], id: string,
): Promise<DeleteImpact>;
/** Step (a): the rules, throwing the first refusal's code; when `unpairAtProvider`, also switches
 * the reader off (active false, disabled_at set if null) before the provider is called. */
export function prepareCardReaderDelete(
  tx: Transaction, seats: readonly CardProviderContribution[], id: string, now?: Date,
): Promise<CardReaderDeletePlan>;
/** Unpair's local write: active false, disabled_at and unpaired_at = at, undeleted rows only. */
export function markCardReaderUnpaired(tx: Transaction, id: string, at: string): Promise<void>;
/** Step (c): recompute, refuse, or remove the links and mark the row deleted. */
export function deleteCardReader(
  tx: Transaction, seats: readonly CardProviderContribution[], id: string, now?: Date,
): Promise<DeleteImpact>;
```

Item keys, fixed here: refusals `reader.payment_in_progress`, `reader.provider_disconnected`;
ends `provider_pairing`; removes `device_reader`, `device_reader_default`, `profile_reader`,
`profile_reader_default`, `reader_holder`. Zero-count items are left out. Device targets are
`{ id: devices.id, name: devices.label }`; profile targets `{ id, name }` from `device_profiles`.

Routes in `apps/server/src/payments-api.ts`, both under `gated` (`payments.manage`):

- `GET /management-api/payments/readers/:id/delete-impact` → 200 `DeleteImpact`.
- `DELETE /management-api/payments/readers/:id` → 200 `DeleteImpact` (decision 11); no body.
- Errors: `reader.not_found` 404 (unknown, deleted or demo id); `shared.invalid_id` 400
  (malformed); `reader.payment_in_progress` 409; `reader.provider_disconnected` 409;
  `reader.unpair_failed` 502 (new); `payment.provider_unknown` 404; session and permission codes as
  today.

`packages/payments/src/device-readers.ts`: `SelectDeviceReaderResult` gains
`{ ok: false; refusal: "deleted" }`, returned before any other check when the id names a deleted
reader.

Dashboard (`apps/dashboard/src/api/client.ts`):

```ts
getReaderDeleteImpact(id: string): Promise<DeleteImpact>; // GET …/readers/${id}/delete-impact
deleteReader(id: string): Promise<DeleteImpact>;          // DELETE …/readers/${id}
```

`apps/dashboard/src/widgets/reader-delete-copy.ts` (new):

```ts
export function readerDeleteCopy(providerName: (providerId: string) => string): DeleteDialogCopy;
```

## Tasks

### Task 1: The deleted column, the freed provider id, and adopt's conflict target

**Deliverable:** generated payments migration; a deleted reader frees its `(provider,
provider_ref)`; adopt keeps working against the partial index.

**Files:**
- Modify: `packages/payments/src/schema/card-readers.ts:1-25` (column, index, header comment).
- Generated: `packages/payments/drizzle/<number>_card_reader_delete.sql`,
  `packages/payments/drizzle/meta/<number>_snapshot.json`, `meta/_journal.json`.
- Modify: `apps/server/src/payments-api.ts:386-392` (adopt upsert only).
- Test: `packages/payments/src/schema/card-readers.fk.test.ts`,
  `apps/server/src/payments-api.test.ts` (existing adoption cases, `:1055-1200`).

**Interfaces:** Produces `cardReaders.deletedAt: string | null`. No signature changes.

- [ ] **Step 1: Write the failing schema case** in `card-readers.fk.test.ts`, beside the existing
  "rejects a duplicate" case (`:18-49`), which stays as it is. Start with the column check through
  raw SQL, so it runs on today's schema:

```ts
it("a deleted reader frees its provider id; a switched-off one keeps it", async () => {
  const db = suite.db;
  const columns = await db.execute<{ name: string }>(
    sql`select name from pragma_table_info('card_readers')`,
  );
  expect(columns.rows.map((row) => row.name)).toContain("deleted_at");
  const [old] = await withTransaction(db, (tx) =>
    tx.insert(cardReaders)
      .values({ provider: "sumup", providerRef: "rdr_free", name: "Old", active: false })
      .returning({ id: cardReaders.id }),
  );
  const dup = await captureError(() =>
    withTransaction(db, (tx) =>
      tx.insert(cardReaders).values({ provider: "sumup", providerRef: "rdr_free", name: "Dup" }),
    ),
  );
  expect(isRefusal(dup, UNIQUE_VIOLATION)).toBe(true);
  await withTransaction(db, (tx) =>
    tx.update(cardReaders).set({ deletedAt: "2026-10-10T10:00:00.000Z" })
      .where(eq(cardReaders.id, old!.id)),
  );
  const [fresh] = await withTransaction(db, (tx) =>
    tx.insert(cardReaders)
      .values({ provider: "sumup", providerRef: "rdr_free", name: "Old" })
      .returning({ id: cardReaders.id }),
  );
  expect(fresh!.id).not.toBe(old!.id);
  const rows = await withTransaction(db, (tx) =>
    tx.select().from(cardReaders).where(eq(cardReaders.providerRef, "rdr_free")),
  );
  expect(rows.map((r) => [r.id, r.deletedAt])).toEqual(
    expect.arrayContaining([[old!.id, "2026-10-10T10:00:00.000Z"], [fresh!.id, null]]),
  );
});
```

  Import `sql` from `drizzle-orm`. Add a second insert of the same key while `fresh` is live and
  assert `UNIQUE_VIOLATION` again (two live rows still collide).

- [ ] **Step 2: Run it and watch it fail.**
  `pnpm --filter @waitron/payments exec vitest run src/schema/card-readers.fk.test.ts`
  Expected: FAIL at the column assertion, printing an `expected [ 'id', 'provider', …,
  'unpaired_at' ] to include 'deleted_at'`-shaped message.

- [ ] **Step 3: Add the column and the partial index.**

```ts
import { sql } from "drizzle-orm";
import { uniqueIndex } from "drizzle-orm/sqlite-core";
// …
    unpairedAt: tsString("unpaired_at"),
    deletedAt: tsString("deleted_at"),
  },
  (t) => [
    // One undeleted reader per provider id; a deleted row frees it, a disabled one keeps it.
    uniqueIndex("card_readers_provider_ref_key")
      .on(t.provider, t.providerRef)
      .where(sql`${t.deletedAt} is null`),
  ],
```

  Replace the header comment (`:4-9`) with one line that is true after this step, for example
  "Disable clears `active`; Delete also sets `deleted_at`; payments keep the row either way." Do
  not restate the foreign keys.

- [ ] **Step 4: Generate.** `pnpm --filter @waitron/payments db:generate --name card_reader_delete`.
  Read the SQL: expect `DROP INDEX`, `ALTER TABLE … ADD deleted_at`,
  `CREATE UNIQUE INDEX … WHERE … deleted_at is null` and nothing else. **A
  `CREATE TABLE __new_card_readers` or any other table rebuild is a STOP**: three tables point
  at `card_readers` with `restrict` and one with `cascade` (inventory above), and a rebuild's
  `DROP TABLE` with foreign keys on can refuse or cascade (CLAUDE.md §3). Do not hand-edit what
  was generated.

- [ ] **Step 5: Run the schema case again** (same command). Expected: PASS.

- [ ] **Step 6: Watch adopt break.** `pnpm --filter @waitron/server exec vitest run
  src/payments-api.test.ts -t "reader adoption"`. Expected: FAIL — the adoption cases get 500
  instead of 201 (the probe's "ON CONFLICT clause does not match" refusal, logged under
  `payments.failed`). Record the failing case names.

- [ ] **Step 7: Name the index's condition in the conflict target** (`payments-api.ts:386-392`):

```ts
.onConflictDoUpdate({
  target: [cardReaders.provider, cardReaders.providerRef],
  targetWhere: isNull(cardReaders.deletedAt),
  set: { name, active: true, disabledAt: null, unpairedAt: null },
})
```

  Add `isNull` to the `drizzle-orm` import. In the test file, add one assertion that the emitted
  SQL carries the condition: build the same insert on a transaction and assert `.toSQL().sql`
  contains exactly this text (what drizzle 0.45.3 printed in the probe above):

```ts
expect(statement.toSQL().sql).toContain(
  'on conflict ("card_readers"."provider", "card_readers"."provider_ref") ' +
    'where "card_readers"."deleted_at" is null do update set',
);
```

- [ ] **Step 8: Green.** Re-run Step 6's command and the schema command; then
  `pnpm --filter @waitron/payments exec vitest run src/schema/schema-conformance.test.ts
  src/migrations.test.ts src/schema-ownership.test.ts` and from the root
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts
  scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts
  scripts/behavioural-triggers.test.ts scripts/append-only-triggers.test.ts
  scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts
  scripts/module-graph-honesty.test.ts`. Read each `Tests` count and exit status separately.
  `git diff 951d59f01 --stat -- packages/payments/drizzle` must show only added files and the
  journal. Decide the reset question from the SQL and the upgrade test, and write the answer and
  its evidence in the commit message.

- [ ] **Step 9: Commit.**

```bash
git add packages/payments/src/schema/card-readers.ts packages/payments/drizzle \
  packages/payments/src/schema/card-readers.fk.test.ts apps/server/src/payments-api.ts \
  apps/server/src/payments-api.test.ts
git commit -s -m "Card readers can be marked deleted, and a deleted reader frees its provider id"
```

### Task 2: The reader delete rules, on the caller's transaction

**Deliverable:** impact read and delete functions with complete link removal, refusals, rollback
and retained history, tested against a real venue database. No route yet.

**Files:**
- Create: `apps/server/src/delete-impact-items.ts`, `apps/server/src/card-reader-delete.ts`,
  `apps/server/src/card-reader-delete.db.test.ts`.
- Modify: `apps/server/src/printer-delete.ts:37-43` (use `namedItem`; delete the private copy).
- Test (unedited, must pass): `apps/server/src/printer-delete.db.test.ts`.

**Interfaces:** Consumes Task 1's column. Produces everything listed under "Interfaces" for
`delete-impact-items.ts` and `card-reader-delete.ts`.

- [ ] **Step 1: Write the failing impact case.** In the new test file, open a venue with
  `useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) })` as
  `payments-api.test.ts:53-56` does, and seed through the tables: reader R "Lector barra"
  (provider `stripe`, `unpairedAt` set, so no provider is needed in this task) and control reader
  Q; profiles "Sala" (lists R as default, then Q) and "Terraza" (lists Q as default, then R);
  devices "Caja 1" (Sala, explicit choice R, holds R), "Caja 2" (Sala, no choice), "Vieja"
  (Terraza, switched off, explicit choice R) and "Caja 3" (Terraza, no choice). Seat list:
  `[createStripeCardProvider()]` as the server test imports it. Assert the whole object:

```ts
expect(await withTransaction(suite.db, (tx) => readCardReaderDeleteImpact(tx, seats, r)))
  .toEqual({
    target: { id: r, name: "Lector barra" },
    refusals: [],
    ends: [],
    removes: [
      { key: "device_reader", count: 2, targets: [caja1, vieja] },
      { key: "device_reader_default", count: 1, targets: [caja2] },
      { key: "profile_reader", count: 2, targets: [sala, terraza] },
      { key: "profile_reader_default", count: 1, targets: [sala] },
      { key: "reader_holder", count: 1, targets: [caja1] },
    ],
  });
```

  (`caja1` etc. are `{ id, name }`; order within an item is by name then id.) Caja 3 is named
  nowhere: its profile's default is Q.

- [ ] **Step 2: Add the delete, refusal, history and rollback cases** in the same file:
  - **Delete:** snapshot every row of `card_readers`, `device_card_readers`,
    `device_profile_card_readers`, `card_reader_holders`, `payments`, `devices`, `device_profiles`
    before; call `deleteCardReader(tx, seats, r, new Date("2026-10-10T10:00:00.000Z"))`; assert
    R's links are gone, Q's rows and every other table equal the snapshot, and R's row equals the
    old one except `active: false`, `deletedAt: "2026-10-10T10:00:00.000Z"` and — table-driven —
    `disabledAt` set to that time when R was enabled, kept when R was already disabled.
    `unpairedAt` unchanged. The return value equals the impact read before.
  - **History:** seed a `captured` payment on R before the delete; after it, the payment row is
    unchanged and `select card_readers.name from payments join card_readers on … where payments.id
    = ?` returns "Lector barra" even after a new reader with R's provider id and name is inserted;
    `PRAGMA foreign_key_check` returns no rows.
  - **Refusal:** table-driven over `attempting` and `initiated` payments on R from device Caja 2:
    impact `refusals` is `[{ code: "reader.payment_in_progress", params: { readerId: r }, targets:
    [caja2] }]`; `deleteCardReader` inside `withTransaction`, caught outside, has code
    `reader.payment_in_progress`; all snapshots unchanged. Controls: `captured`, `failed` and
    `voided` payments on R do not refuse.
  - **Final-step guard:** a seat `{ ...stripe, readers: { ...stripe.readers, canUnpair: true } }`,
    R with `unpairedAt: null`, **and a stored credential for the seat's `credentialPurpose`** —
    seed it with `putCredential` (`packages/credentials/src/store.ts:95-110`) and the payload the
    Stripe seat's `connect` returns as `sealedPayload`
    (`packages/payments-stripe/src/card-provider.ts`), with a test key ring as
    `payments-api.test.ts:48-51` builds one. Then `deleteCardReader` throws
    `reader.unpair_failed` with `{ providerId: "stripe" }` and writes nothing. Second case, the
    same R and seat **with no credential**: it throws `reader.provider_disconnected`
    `{ providerId: "stripe" }` (the refusal comes first in the rule order) and writes nothing.
    With `canUnpair: false` the same R deletes and `unpairedAt` stays null.
  - **Step (a) switches the reader off:** with the credential seeded and `canUnpair: true`,
    `prepareCardReaderDelete(tx, seats, r, now)` returns `unpairAtProvider: true` and leaves R with
    `active: false`, `disabledAt` = `now` (kept when it was already set), every other column and
    table unchanged. With `canUnpair: false`, or R already unpaired, it writes nothing. When it
    refuses, it writes nothing (the throw rolls its transaction back).
  - **No provider lookup once unpaired:** R with `unpairedAt` set and `provider: "gone"`, which no
    seat serves: the impact read and the delete both succeed. The same R with `unpairedAt: null`
    answers `payment.provider_unknown`.
  - **Not found:** unknown uuid, an already deleted id, and `DEMO_READER_ID` (seed it as
    `apps/server/src/boot.ts:357-362` does) each give `reader.not_found` with `{ id }` from both
    functions.
  - **Rollback:** install a temporary `BEFORE UPDATE ON card_readers` trigger that
    `RAISE(ABORT, 'test_delete_failure')` when `new.deleted_at is not null`; run `deleteCardReader`
    in `withTransaction`, catch outside, assert every snapshot unchanged; drop the trigger in
    `finally`.
  - **Unpair marker:** `markCardReaderUnpaired(tx, r, at)` on an undeleted R sets `active`,
    `disabledAt`, `unpairedAt` exactly as `payments-api.ts:651-658`; on a deleted R it changes
    nothing.

- [ ] **Step 3: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/card-reader-delete.db.test.ts`
  Expected: FAIL. With an empty `card-reader-delete.ts` exporting the four functions as
  `throw new Error("not built")`, every case fails on that message; record it.

- [ ] **Step 4: Move the helper.** Create `delete-impact-items.ts` with `namedItem` — the body of
  `printer-delete.ts:38-43`, unchanged — and import it in `printer-delete.ts`. Run
  `pnpm --filter @waitron/server exec vitest run src/printer-delete.db.test.ts
  src/printer-delete-history.test.ts`; expected PASS, unedited.

- [ ] **Step 5: Implement the rules.** One private `cardReaderDeleteRules(tx, seats, id)` returns
  `CardReaderDeletePlan`; the other exports call it. Await each query in turn.

```ts
const [reader] = await tx
  .select({ id: cardReaders.id, name: cardReaders.name, provider: cardReaders.provider,
    providerRef: cardReaders.providerRef, unpairedAt: cardReaders.unpairedAt })
  .from(cardReaders)
  .where(and(eq(cardReaders.id, id), isNull(cardReaders.deletedAt)));
if (reader === undefined || id === DEMO_READER_ID) throw new AppError("reader.not_found", { id });
const busy = await tx
  .select({ id: devices.id, name: devices.label })
  .from(payments)
  .leftJoin(devices, eq(devices.id, payments.deviceId))
  .where(and(eq(payments.readerId, id), inArray(payments.state, IN_PROGRESS_PAYMENT_STATES)));
// An already-unpaired reader is deleted without consulting its provider (spec), so the seat is
// looked up only while it is still paired.
const seat = reader.unpairedAt === null ? cardProviderById(seats, reader.provider) : undefined;
const unpairAtProvider = seat?.readers.canUnpair === true;
const connected = !unpairAtProvider || (await tx
  .select({ purpose: tenantCredentials.purpose })
  .from(tenantCredentials)
  .where(eq(tenantCredentials.purpose, seat!.credentialPurpose))).length > 0;
```

  Refusals, in order: `busy.length > 0` → payment in progress (targets: `namedItem` over the rows
  with a device; a payment with no device still refuses); `!connected` → provider disconnected.
  Ends: `provider_pairing` when `unpairAtProvider`. Removes: `device_reader` from
  `device_card_readers` joined to `devices`; `device_reader_default` from active `devices` with no
  `device_card_readers` row whose profile's default row names `id`; `profile_reader` and
  `profile_reader_default` from `device_profile_card_readers` joined to `device_profiles`;
  `reader_holder` from `card_reader_holders` joined to `devices`. `prepareCardReaderDelete` throws
  the first refusal through an explicit switch so each `AppError` keeps its registry type, then,
  when `unpairAtProvider`, switches the reader off with the same `coalesce` update shown below
  minus `deletedAt` (`active: false` and `disabledAt` only):

```ts
function refuse(refusal: DeleteImpactRefusal): never {
  if (refusal.code === "reader.payment_in_progress")
    throw new AppError("reader.payment_in_progress", { readerId: String(refusal.params.readerId) });
  throw new AppError("reader.provider_disconnected", {
    providerId: String(refusal.params.providerId),
  });
}
```

  `deleteCardReader`: rules → `refuse` the first refusal → if `unpairAtProvider`, throw
  `reader.unpair_failed` `{ providerId }` → delete `device_card_readers`,
  `device_profile_card_readers` and `card_reader_holders` rows naming `id` → update the row:

```ts
await tx.update(cardReaders)
  .set({ active: false, deletedAt: now.toISOString(),
    disabledAt: sql`coalesce(${cardReaders.disabledAt}, ${now.toISOString()})` })
  .where(and(eq(cardReaders.id, id), isNull(cardReaders.deletedAt)));
```

  Register `"reader.unpair_failed": { providerId: string }` in `apps/server/src/errors.ts` beside
  `reader.provider_disconnected` (`:222-226`), with a one-line comment saying the provider call to
  unpair failed, so the reader was left switched off and not deleted. Import that registry in
  `card-reader-delete.ts` (`import "./errors.js";`).

- [ ] **Step 6: Green.** Re-run Step 3's and Step 4's commands. In a disposable copy of the
  candidate (never by swapping files here), delete the `device_profile_card_readers` removal and
  see the delete case fail on the profile rows; restore only in that copy. Record both runs.

- [ ] **Step 7: Commit.**

```bash
git add apps/server/src/delete-impact-items.ts apps/server/src/card-reader-delete.ts \
  apps/server/src/card-reader-delete.db.test.ts apps/server/src/printer-delete.ts \
  apps/server/src/errors.ts
git commit -s -m "Server: the rules for deleting a card reader, shared by its impact read \
and its delete"
```

### Task 3: The impact and delete routes, with the provider unpair

**Deliverable:** `GET …/delete-impact` and `DELETE …/readers/:id`, the three-step delete, and
Unpair's write moved to the shared guarded helper.

**Files:**
- Modify: `apps/server/src/payments-api.ts` (STATUS `:100-136`, unpair `:651-658`, new routes
  after `:437`).
- Test: `apps/server/src/payments-api.test.ts` (new `describe("reader delete")`, reusing its
  `seedVenue`, `mountApp`, `send`, `connectStripe`, `addReader` and `discoverySeat` helpers).

**Interfaces:** Consumes Task 2. Produces the two routes and `"reader.unpair_failed": 502`.

- [ ] **Step 1: Write the failing route cases.** A seat with a spy:
  `{ ...stripeSeat, readers: { ...stripeSeat.readers, canUnpair: true, remove: spy } }`.
  - Staff cookie → 403 `authorization.not_permitted` for both routes; no cookie → 401
    `management_session.required`; `/readers/not-a-uuid` → 400 `shared.invalid_id`; unknown uuid
    and `DEMO_READER_ID` → 404 `reader.not_found`. No row changes, `remove` not called.
  - Connected, paired reader: GET lists ends `[{ key: "provider_pairing", count: 1, targets:
    [{ id: "stripe", name: "stripe" }] }]`; DELETE → 200; `remove` called once with the reader's
    provider id, and **inside the spy the reader's row already reads `active: false`** (step (a)
    committed before the provider call); the row has `deletedAt`, `unpairedAt`,
    `active: false`; its links are gone; GET `/readers` omits it; a second DELETE → 404 and
    `remove` still called once.
  - `remove` rejects with `new Error("outage")` → 502 `{ error: { code: "reader.unpair_failed",
    params: { providerId: "stripe" } } }`; links equal the snapshot, and the reader row equals it
    except `active: false` and `disabledAt` set (step (a)); `unpairedAt` and `deletedAt` null.
    `remove` rejecting with
    `new AppError("payment.provider_credential_rejected", { providerId: "stripe" })` → that code.
  - Provider disconnected while the reader is paired. Disable the reader first (without unpair):
    disconnect refuses while an active reader uses the provider (`payments-api.ts:495-514`).
    GET refusals
    `[{ code: "reader.provider_disconnected", params: { providerId: "stripe" }, targets: [] }]`;
    DELETE → 409 with that code; `remove` not called.
  - Already unpaired through the Unpair route, then the provider disconnected: DELETE → 200,
    `remove` called only by the earlier Unpair.
  - The unmodified Stripe seat (`canUnpair: false`): DELETE → 200 and `unpairedAt` stays null.
  - An `attempting` payment on the reader → 409 `reader.payment_in_progress`, `remove` not called.
  - **Review focus 2:** `remove` inserts an `attempting` payment on the reader through
    `suite.db`, then resolves. DELETE → 409 `reader.payment_in_progress`; the row has
    `unpairedAt` set, `active: false`, `deletedAt: null`; links unchanged. Mark the payment
    `failed`; DELETE → 200; `remove` called once in total.
  - **Agreement:** an already-unpaired reader: GET body `toEqual` the DELETE body.
  - **Concurrency:** a connected, paired reader (`unpairedAt` null) and the spy seat. Two DELETEs
    with `Promise.all` → statuses sort to `[200, 404]`; one deleted row with `unpairedAt` set.
    Assert `remove` was called once or twice, not an exact count: both requests can pass step (a)
    before either reaches (c), and each then unpairs. A second unpair is harmless at SumUp, whose
    client treats a 404 on that call as success (`packages/payments-sumup/src/sumup-client.ts:282`).

- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts -t "reader delete"`
  Expected: FAIL — the routes do not exist, so GET answers 404 with a non-JSON body and DELETE
  answers 404; the assertions on status 200/403 fail first. Record one printed failure.

- [ ] **Step 3: Implement.** Add `"reader.unpair_failed": 502` to STATUS. Replace the unpair
  route's final update with `markCardReaderUnpaired(tx, id, unpairedAt)`. The routes:

```ts
app.get("/management-api/payments/readers/:id/delete-impact", (c) =>
  run(c, log, async () => {
    const sessionId = requireManagementSession(c);
    const id = requireUuidParam(c.req.param("id"), "CardReaderId");
    return c.json(await gated(sessionId, (tx) =>
      readCardReaderDeleteImpact(tx, deps.providers, id)));
  }),
);

app.delete("/management-api/payments/readers/:id", (c) =>
  run(c, log, async () => {
    const sessionId = requireManagementSession(c);
    const id = requireUuidParam(c.req.param("id"), "CardReaderId");
    // Split because the provider call cannot run inside a transaction; a refusal after the unpair
    // leaves the reader unpaired and switched off, as Unpair would, and not deleted.
    const plan = await gated(sessionId, (tx) => prepareCardReaderDelete(tx, deps.providers, id));
    if (plan.unpairAtProvider) {
      const seat = cardProviderById(deps.providers, plan.provider);
      try {
        await seat.readers.remove(runtimeDeps(), plan.providerRef);
      } catch (error) {
        if (isAppError(error)) throw error;
        throw new AppError(
          "reader.unpair_failed",
          { providerId: plan.provider },
          { reason: codeOf(error) },
        );
      }
      const unpairedAt = nowIso();
      await gated(sessionId, (tx) => markCardReaderUnpaired(tx, id, unpairedAt));
    }
    return c.json(await gated(sessionId, (tx) => deleteCardReader(tx, deps.providers, id)));
  }),
);
```

  The wrapped cause travels as the `AppError`'s log-only `reason` (`packages/shared/src/errors.ts:
  60-75`), which the boundary logs as `logReason` and never answers
  (`packages/server-kit/src/error-boundary.ts:33-37`); no separate `log(...)` call. `codeOf` comes
  from `@waitron/server-kit` (`packages/server-kit/src/index.ts:7`). Keep the two-line comment
  above `prepareCardReaderDelete` (decision 19); it is the site's record of why the change is
  split.

- [ ] **Step 4: Green.** Re-run Step 2's command, then the whole file:
  `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts
  src/payments-api.stuck.test.ts`; the Unpair cases (`:1007-1053`, `:1155-1340`) pass unedited.
  Root: `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts
  scripts/ongoing-alert-codes.test.ts`. Disposable-copy control: drop the recompute in step (c)
  (return the plan's impact instead) and see the Review focus 2 case fail; restore only there.

- [ ] **Step 5: Commit.**

```bash
git add apps/server/src/payments-api.ts apps/server/src/payments-api.test.ts
git commit -s -m "Card readers can be deleted through the payments API, unpaired at the \
provider first"
```

### Task 4a: The payments API's other reader routes, and discovery

**Deliverable:** through the management API, a deleted reader cannot be renamed, enabled,
disabled, unpaired, read, listed, chosen for a device or profile, or re-adopted; discovery offers
its provider id as new; disabled-reader behaviour unchanged.

**Files:**
- Modify: `apps/server/src/payments-api.ts:145-153,330-340,342-366,516-533,620-637`.
- Test: `apps/server/src/payments-api.test.ts`.

**Interfaces:** Consumes Task 3's DELETE. No new exports.

- [ ] **Step 1: Write the failing cases**, each against a reader deleted through the real DELETE:
  - Table-driven: PATCH `{ name }`, POST `disable`, POST `enable`, POST `unpair`, GET `status` →
    404 `reader.not_found`; the row equals its post-delete snapshot; the seat's `remove` and
    `status` spies are not called.
  - PUT `/payments/devices/:id/reader` naming it → 404; PUT
    `/payments/device-profiles/:id/readers` resubmitting a list that still holds it (Review
    focus 3) → 404; the profile's rows unchanged.
  - GET `/readers` omits it; the disabled control reader is still listed with `active: false`.
  - **Review focus 4:** `discoverySeat` listing the deleted reader's provider id → GET
    `available-readers` labels it `available`; POST `adopt` → 201 with a new id; the deleted row
    keeps `deletedAt`, `unpairedAt`, `active: false` and its name. Control: a disabled, undeleted
    reader is still labelled `disabled` and adopt reuses its id (the existing case at `:1071`
    passes unedited).
  - POST `/readers` (pair new) returning the deleted reader's provider id → 201, new id.

- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts -t "deleted reader"`.
  Expected failures: rename and disable answer 204, the list includes the row,
  `available-readers` says `disabled`.

- [ ] **Step 3: Implement.** Add `isNull(cardReaders.deletedAt)` to `requireKnownReader`,
  `requireReader`, the status lookup and the list query; build `registered` in
  `available-readers` from undeleted rows only.

- [ ] **Step 4: Green.** Re-run Step 2's command, then the whole of `src/payments-api.test.ts`.
  Disposable-copy control: remove the `available-readers` filter and see Review focus 4 fail.

- [ ] **Step 5: Commit** (`git commit -s -m "The payments API answers not found for a deleted card
  reader, and discovery offers it as new"`).

### Task 4b: Device equipment, the till's pay paths and battery alerts

**Deliverable:** the till cannot choose or pay on a deleted reader, nor on one whose delete has
passed step (a); battery alerts skip deleted readers.

**Files:**
- Modify: `packages/payments/src/device-readers.ts:33-37,265-292`;
  `apps/server/src/device-equipment.ts:324-349`.
- Test: `packages/payments/src/device-readers.test.ts`,
  `apps/server/src/device-equipment-api.test.ts` (step 2's block `:767` onward is the model),
  `apps/server/src/till-api.test.ts`, `apps/server/src/bill-payments-api.test.ts`, and the battery
  alert suite (`rg -l batteryAlertSource apps/server/src --glob '*.test.ts'`).

**Interfaces:** Consumes Tasks 2 and 3. Produces the `"deleted"` refusal of `selectDeviceReader`.

- [ ] **Step 1: Write the cases.**
  - `device-readers.test.ts`: `selectDeviceReader` with a deleted id returns
    `{ ok: false, refusal: "deleted" }` and writes nothing, even when the device holds nothing and
    the profile lists nothing.
  - `device-equipment-api.test.ts`: the till's PUT `/api/device/equipment` choosing the deleted
    reader by list and by scan with `takeOver` → 400 `reader.not_found`; Use default still 200;
    an undeleted reader the profile does not list still → `device.binding_invalid`.
  - `till-api.test.ts`: pay naming the deleted reader → 404 `reader.not_found`, no `payments`
    row.
  - **Review focus 2, step (a):** in `till-api.test.ts`, with a reader the paying device holds and
    a seat that can unpair plus a stored credential (seeded as in Task 2), run
    `prepareCardReaderDelete` in its own `withTransaction` and stop there (no provider call, no
    step (c)). Then pay naming the reader, and pay with no reader named (the device's choice or
    default): both → 404 `reader.not_found`, no `payments` row. Control: the same pay before
    `prepareCardReaderDelete` reaches the provider fake.
  - `bill-payments-api.test.ts`: a card bill payment (`POST /api/working-orders/:id/payments`,
    `bill-payments-api.ts:213-242`) naming the deleted reader. That route is mounted with the till
    API's error boundary (`till-api.ts:1086`), whose map gives `reader.not_found` 404
    (`till-api.ts:483`) — read, not run. Pin what it answers, and that no `payments` or bill
    payment row is written.
  - Battery suite: a deleted reader raises no alert while an active one still does.

- [ ] **Step 2: Run.**
  `pnpm --filter @waitron/payments exec vitest run src/device-readers.test.ts -t deleted`;
  `pnpm --filter @waitron/server exec vitest run src/device-equipment-api.test.ts
  src/till-api.test.ts src/bill-payments-api.test.ts -t "deleted reader"`, and the battery suite
  by its file. Expected RED: `selectDeviceReader` returns `not_permitted`, so the till PUT answers
  `device.binding_invalid`. The pay, step (a), bill and battery cases may pass at once (they rest
  on `active` filters); report each as a pin, not a RED.

- [ ] **Step 3: Implement.** In `selectDeviceReader`, before reading the device:

```ts
if (selection !== "default") {
  const [target] = await tx.select({ deletedAt: cardReaders.deletedAt })
    .from(cardReaders).where(eq(cardReaders.id, selection.id));
  if (target?.deletedAt != null) return { ok: false, refusal: "deleted" };
}
```

  In `selectDeviceEquipment` (`device-equipment.ts:336`), before the `not_permitted` branch:
  `if (result.refusal === "deleted") throw new AppError("reader.not_found", { id: (selection as
  { id: string }).id });`. Keep the existing branches.

- [ ] **Step 4: Green.** Re-run Step 2's commands without `-t`, plus
  `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts`.

- [ ] **Step 5: Commit** (`git commit -s -m "The till cannot choose or pay on a deleted card reader,
  or on one being unpaired for deletion"`).

### Task 5: Dashboard API, live dependencies and the dialog's words

**Deliverable:** client methods, the impact query's dependencies, the reader copy adapter, and
EN/ES strings and the new code's message.

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (after `unpairReader`, `:3819-3821`),
  `apps/dashboard/src/api/live-queries.ts` (beside `listReaders`, `:77-80`),
  `apps/dashboard/src/i18n/strings.ts` (EN and ES blocks beside `payments.unpair`),
  `apps/dashboard/src/i18n/codes.ts` (beside `reader.provider_disconnected`, `:910`).
- Create: `apps/dashboard/src/widgets/reader-delete-copy.ts`, `reader-delete-copy.test.ts`.
- Test: `apps/dashboard/src/api/live-queries.test.ts`, `apps/dashboard/src/i18n/codes.test.ts`,
  root `scripts/live-subscriptions.test.ts`.

**Interfaces:** Produces `getReaderDeleteImpact`, `deleteReader`, `readerDeleteCopy`.

- [ ] **Step 1: Write the failing cases.** Copy test, in both languages (restore the language after
  each case), for an impact holding every key, with `providerName = (id) => id === "sumup" ?
  "SumUp" : id`. Exact strings:

  Each line: key or field — English / Spanish.

  - heading — Delete reader? / ¿Eliminar el lector?
  - refusals — Why it can't be deleted / Por qué no se puede eliminar
  - ends — What will end / Qué finalizará
  - removes — Settings that will be removed / Configuración que se eliminará
  - irreversible — This can't be undone. / Esta acción no se puede deshacer.
  - retry — Try again / Reintentar
  - loading — Checking what will change… / Comprobando qué cambiará…
  - `reader.payment_in_progress` — Payment in progress on {names} / Cobro en curso en {names}
  - the same with no named device — A payment is in progress / Hay un cobro en curso
  - `reader.provider_disconnected` — Connect {provider} first / Conecta primero {provider}
  - `provider_pairing` — Unpairs it from {provider} / Se desvinculará de {provider}
  - `device_reader` — Chosen on {count} devices: {names} /
    Elegido en {count} dispositivos: {names}
  - `device_reader_default` — Default on {count} devices: {names} /
    Predeterminado en {count} dispositivos: {names}
  - `profile_reader` — In {count} profiles: {names} / En {count} perfiles: {names}
  - `profile_reader_default` — Default of {count} profiles: {names} /
    Predeterminado de {count} perfiles: {names}
  - `reader_holder` — {names} stops holding it / {names} dejará de tenerlo
  - an unknown key — {names} ({count}) / {names} ({count})

  Each counted line has a `_one` twin ("Chosen on 1 device: {names}" / "Elegido en 1
  dispositivo: {names}", and so on). `confirm` and `cancel` reuse `action.delete` and
  `action.cancel`. Codes: `reader.unpair_failed` → "Couldn't reach the provider. The reader is
  disabled; try again." / "No se pudo contactar con el proveedor. El lector queda deshabilitado;
  inténtalo de nuevo." (decision 3: a failed call leaves it switched off). Assert no line
  contains a raw key or a uuid.

  Client and dependencies: assert `getReaderDeleteImpact("r1")` sends GET
  `/management-api/payments/readers/r1/delete-impact` and `deleteReader("r1")` sends DELETE
  `/management-api/payments/readers/r1`, following step 2's cases for the printer methods in
  `live-queries.test.ts`; `QUERY_DEPENDENCIES.getReaderDeleteImpact` equals the list below.

- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/reader-delete-copy.test.ts
  src/api/live-queries.test.ts src/i18n/codes.test.ts`. Expected: the copy file is missing (a
  module error — then add an empty `readerDeleteCopy` returning `{}` cast, and re-run to see the
  string assertions fail), and the dependency assertion fails with `undefined`.

- [ ] **Step 3: Implement.** Client methods as in "Interfaces" (`#request(…, "GET")` and
  `#request(…, "DELETE")`, as `client.ts:3251-3257`). Dependencies:

```ts
getReaderDeleteImpact: [
  "card_readers",
  "payments",
  "devices",
  "device_profiles",
  "device_card_readers",
  "device_profile_card_readers",
  "card_reader_holders",
],
```

  `readerDeleteCopy` follows `printer-delete-copy.ts`: one `line()` using `fill` and the `_one`
  twin, `codeMessage` for an unknown refusal code, names as text.

- [ ] **Step 4: Green.** Re-run Step 2's command and `pnpm exec vitest run
  scripts/live-subscriptions.test.ts`.

- [ ] **Step 5: Commit** (`git commit -s -m "Dashboard: the card reader delete calls and the
  words its confirmation uses"`).

### Task 6: The Card readers tab offers Delete

**Deliverable:** Delete in each reader's row menu, the shared dialog, and correct handling of
refusals, failures and late answers.

**Files:**
- Modify: `apps/dashboard/src/screens/payments-screen.ts` (state beside `:337-392`, row menu
  `:1635-1695`, render beside the editor at `:2017`).
- Create: `apps/dashboard/src/screens/payments-screen.delete.test.ts` (model it on
  `payments-screen.disable.test.ts` and step 2's dialog cases in `printers-screen.test.ts`).
- Modify: `apps/dashboard/src/screens/payments-screen.a11y.test.ts` (dialog open, ready and
  refused, both themes).

**Interfaces:** Consumes Task 5. Dialog bindings exactly as `printers-screen.ts:4062-4077`.

- [ ] **Step 1: Write the failing browser cases**, with the screen's fake API:
  - Delete is in the row menu of an active reader, a disabled reader, and an **unpaired** reader
    (`active: false`, `canEnable: false`), whose menu today shows no Disable, Enable or Unpair
    (`payments-screen.ts:1667-1691`) — Delete must still appear there. It comes after
    Disable/Enable and Unpair; it is `danger`, and `secondary` and disabled while `busy`.
  - Opening reads `getReaderDeleteImpact` once; while loading the dialog's Delete is quiet and
    disabled; a ready impact makes it `danger`; one click sends exactly one `deleteReader`.
  - A refusal impact shows "Payment in progress on Caja 2" and keeps Delete disabled.
  - **Review focus 5:** open A, close, open B before A's read resolves; resolve A's read; B's
    dialog shows B, and confirming sends B's id. A live re-read that now carries a payment
    refusal disables Delete in the open dialog.
  - DELETE rejects `reader.unpair_failed`: the dialog stays open with "Couldn't reach the
    provider. The reader is disabled; try again." and Delete usable; the list's re-read shows the
    reader as Disabled. DELETE rejects `reader.not_found`: the dialog closes,
    the row goes, and the screen shows `reader.not_found`'s message.
  - Success: the dialog closes, the row is gone after the reload, and focus lands on Refresh
    (`[data-test=refresh-readers]`, `:1990`). A reload failure after success shows the read error
    and offers no second Delete.
  - Discovery renders an `available` reader with Add, not Enable (`:1774`) — the server's label
    decides; this pins that the screen does not override it.

- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/payments-screen.delete.test.ts`.
  Expected: FAIL finding no `[data-test=delete-<id>]` button in the row menu.

- [ ] **Step 3: Implement.** Copy step 2's state and methods (`printers-screen.ts:854-869,
  3922-3976,3994-4026`), renamed for readers: `#openDelete(reader, opener)`, `#readImpact`,
  `#impactFailed` (on `reader.not_found`, unless this screen's delete is in flight, close and drop
  the row), `#retryImpact`, `#closeDelete`, `#confirmDelete(id)` and `#readerGone(id, refuse)`
  (closes the dialog and any editor or label open on that reader without saving). Use a new
  `DashboardQueries` for the impact. The opener is the row menu's own button, as `#openEditor`
  finds it (`payments-screen.ts:801-802`). Copy: `readerDeleteCopy((id) =>
  this.#providerName(id))`. Row-menu button:

```ts
html`<wt-button
  variant=${this.busy ? "secondary" : "danger"}
  align="start"
  data-test=${`delete-${reader.id}`}
  ?disabled=${this.busy}
  @click=${(event: Event) => this.#openDelete(reader, event)}
  >${t("action.delete")}</wt-button>`
```

- [ ] **Step 4: Green.** Re-run Step 2's command, then
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/payments-screen.test.ts
  src/screens/payments-screen.a11y.test.ts src/screens/payments-screen.disable.test.ts
  src/screens/payments-screen.save-state.test.ts src/screens/payments-screen.tabs.test.ts
  src/screens/payments-screen.disconnect.test.ts`, unedited except the a11y additions.
  `pnpm exec vitest run scripts/pinned-actions-column.test.ts scripts/native-form-fields.test.ts
  scripts/style-token-names.test.ts`. Disposable-copy control: drop the generation check in
  `#confirmDelete` and see Review focus 5 fail.

- [ ] **Step 5: Commit** (`git commit -s -m "Card readers can be deleted from the Payments screen,
  after a confirmation that says what the delete will do"`).

### Task 7: Stale reader choices on the devices, profiles and till screens

**Deliverable:** pinned behaviour when another tab deletes a reader a form or the till still
shows. Production code changes only where a case fails.

**Files:**
- Test: `apps/dashboard/src/screens/devices-screen.test.ts`,
  `apps/dashboard/src/screens/device-profiles-screen.test.ts`,
  `apps/till/src/widgets/equipment-dialog.test.ts` (model: its printer cases at `:435` and `:456`).
- Modify only if a case fails: `devices-screen.ts`, `device-profiles-screen.ts`,
  `apps/till/src/widgets/equipment-dialog.ts`.

- [ ] **Step 1: Write the cases.**
  - Devices: a device form whose reader choice names a reader the fake API now answers
    `reader.not_found` for on save shows "That card reader no longer exists" at the bottom; after
    the readers are read again the reader is no longer offered and the device reads Use default.
  - Profiles: a profile whose reader list still holds a deleted reader is refused on Save with the
    same message, its other fields are not reported as saved, and after the re-read the deleted
    reader is gone from the list and the default.
  - Till equipment dialog: picking the deleted reader from a stale list shows `reader.not_found`'s
    till message (`apps/till/src/i18n/codes.ts:319`); once re-read it is gone and no held or
    switched-off entry is left for it. Restore the screen language after each case.

- [ ] **Step 2: Run.** `pnpm --filter @waitron/dashboard exec vitest run
  src/screens/devices-screen.test.ts src/screens/device-profiles-screen.test.ts -t "deleted
  reader"` and `pnpm --filter @waitron/till exec vitest run src/widgets/equipment-dialog.test.ts
  -t "deleted"`. Say, per case, whether it failed before any change; a case that passes at once
  is a pin and is reported as such. For a failing one, write the minimal fix and re-run.

- [ ] **Step 3: Green and commit.** Run the three suites whole plus
  `devices-screen.save-state.test.ts`, `device-profiles-screen.save-state.test.ts` and
  `device-profiles-screen.unsaved.test.ts`; `git commit -s -m "Devices, profiles and the till say
  a deleted card reader no longer exists"`.

### Task 8a: Audit, documentation, backlog and guards

**Deliverable:** current prose, the step 3 backlog entry removed, and the focused checks still
owed, all green.

**Files:** `docs/developers/design-system.md` (after the paragraph starting "A printer offers
both"), `docs/developers/conventions-ui.md` (section "A retained hardware registration must remain
re-addable after deactivation"), `docs/backlog.md` (the A435 entries, found by title), comments in
the files this branch touched.

- [ ] **Step 1: Re-run the inventory search** from "Current inventory" against the branch tip and
  classify every hit as live, settings, history or discovery; account for any hit this plan does
  not list. `git diff <branch base> --stat -- packages/fiscal-verifactu packages/core
  packages/fiscal` must be empty.
- [ ] **Step 2: Comments at the split.** Read the comment in `requireReader`
  (`apps/server/src/payments-api.ts:331-335` at the plan's base), which describes the unpair route
  reading and writing in separate transactions. Once Unpair's write is `markCardReaderUnpaired`
  (Task 3) and the DELETE route does the same split, make that comment true for both or cut it;
  confirm the DELETE route's two-line split comment (decision 19) is present and still accurate.
- [ ] **Step 3: Prose.** design-system.md: one paragraph "A card reader offers both", beside the
  printer paragraph: Disable keeps the id; Delete unpairs it at its provider when the provider
  allows it, refuses while a payment is in progress, removes its device and profile links, keeps
  the row for its payments; found again it is added as a new reader. conventions-ui.md's
  re-addable rule: say a deleted reader, like a deleted printer, is offered as new. Search the
  whole tracked tree for stale claims: `rg -n -i 'card reader|lector|reader' docs README.md
  apps/server/src/payments-api.ts packages/payments/src -g '*.md' -g '*.ts'` and read the claims
  around each hit about disabling, deleting or re-adding readers; cut comments that only narrate.
  Historical specs and plans get a dated pointer only where their claim now misleads.
- [ ] **Step 4: Backlog.** In `docs/backlog.md`, delete the entry titled "A435 step 3 — card
  readers: open, next." and update the header entry "A435 — permanent delete for hardware and
  venue setup" to say steps 4–6 are open and devices are next. Leave steps 4–6 and the step 2
  residuals. Any point this branch leaves open becomes its own short entry, including decision
  18's owner question if it is still unanswered.
- [ ] **Step 5: Focused checks still owed:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts
  src/write-path.e2e.test.ts src/sale-amount.huella.test.ts src/correction-amount.huella.test.ts
  src/money-conversion.huella.test.ts` (files unedited; read the passed counts); the root guards
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts
  scripts/live-subscriptions.test.ts scripts/claude-md-pointers.test.ts
  scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
  scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts
  scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts
  scripts/migration-upgrade.test.ts`. Check each command's exit status and `Tests` count. No
  whole-workspace run; CI owns package coverage.
- [ ] **Step 6: Commit** the docs, comments and backlog (`git commit -s`).

### Task 8b: LOOK

**Deliverable:** screenshots of every changed screen state, looked at, with what was seen.

- [ ] **Step 1: Check headroom** (`memory_pressure | grep free`; `ps -axo rss,command | sort -nr
  | head`) before starting Chromium.
- [ ] **Step 2: Capture.** Write a throwaway, uncommitted browser test beside
  `payments-screen.delete.test.ts` that mounts the screen with the fake API and saves screenshots
  with Vitest's browser `page.screenshot` for: the readers table with the row menu open (active,
  disabled and unpaired rows); the dialog loading, ready (every removes line, long names), refused
  (payment in progress, and provider disconnected), after a failed read, after a failed delete;
  discovery showing the re-found reader as Add; the devices and profiles reader choosers after a
  delete. Each in English and Spanish, light and dark, at 1280 and 390 wide — set the viewport
  and record `window.innerWidth`. Save under
  `/Users/clintongormley/waitron-campaign-b/a435-3-shots/`.
- [ ] **Step 3: Look** at each: nothing clipped, footer reachable, Cancel focused on open, Escape
  returns focus, text readable. Write one line per screen state saying what was seen. Delete the
  throwaway file. If `wa-wt ls` shows this worktree on a dev slot no other worktree uses, also
  open the real Payments screen there; do not seed or reset a shared venue (`wa-wt reset` wipes
  it). Stop only the processes you started, by recorded id.
- [ ] **Step 4:** Commit nothing unless a defect was found; a fix is test-first and committed with
  `git commit -s`.

### After the tasks: the finish (driver, not an implementer)

This is the driver's step, run after Task 8b's implementer returns; no implementer is dispatched
for it. Announce the branch is ready for `finish-branch` and run it: the FULL path, because this
branch carries a migration, a permission-gated route and a cross-package contract. The run-it seat
is Codex, run as **two** reviews side by side with `~/workspace/tools/codex-seat.sh review-run`:
the first with this plan, the spec and the Review focus as its checklist; the second told to set
that checklist aside and test what it does not name. No Claude run-it seat. Read each report's
findings, not the wrapper's exit status. Fix valid findings test-first (a fix wave may dispatch
fix implementers), push through the normal pre-push hook, wait for CI on the current head, and
check the `changes` job's scope selected `@waitron/payments`, `@waitron/server`,
`@waitron/dashboard` and `@waitron/till`. The PR's first line states whether a venue reset is
needed, from Task 1's evidence, and the PR deletes the step 3 entry from the backlog (Task 8a).

## Intentional changes to existing checks

- `card-readers.fk.test.ts:18-49`, the duplicate refusal: unchanged; a new case adds reuse after
  a delete.
- `payments-api.test.ts` adoption cases (`:1055-1340`): unchanged; they must pass after Task 1's
  conflict target.
- `payments-api.test.ts`, Unpair's failed vendor call → 500 (`:1043-1044`): unchanged; Unpair
  keeps its answer (decision 3).
- `printer-delete.db.test.ts`, `printer-delete-history.test.ts`: unchanged after the `namedItem`
  move.
- Fixtures comparing whole `card_readers` rows with `toEqual` gain `deletedAt: null` and nothing
  else. Find them with `rg -n 'unpairedAt' apps packages -g '*.test.ts'`.

## Where the code differs from the spec's 2026-10-08 inventory

- **Unpair does not exist for every provider.** The spec says the delete unpairs "exactly as
  Unpair does", but Unpair refuses a provider whose seat cannot unpair
  (`apps/server/src/payments-api.ts:645-646`), which Stripe's cannot
  (`packages/payments-stripe/src/card-provider.ts:191`; its `remove` makes no call, `:234-236`).
  Decision 2 covers it.
- **Re-finding a reader re-enables the old row today.** Adopt upserts on the provider-id key and
  clears the unpair marker (`payments-api.ts:386-392`), and discovery labels a known, switched-off
  provider id `disabled` with an Enable button (`payments-api.ts:354-362`,
  `payments-screen.ts:1774`). The spec's "creates a new record" needs both changed (Tasks 1 and 4),
  and the partial index breaks the upsert outright unless its conflict target names the condition
  (probe above).
- **Nothing reads a payment's reader name.** The only reads of `payments.reader_id` are the
  in-progress checks (`packages/payments/src/device-readers.ts:107`,
  `apps/server/src/device-equipment.ts:213-217`, `payments-api.ts:670-674`). "History kept" for
  readers is the retained row and its foreign key; Task 2 tests that a join still names it.
- **The key is not per location.** `card_readers` has no location column; the key is
  `(provider, provider_ref)` (`packages/payments/src/schema/card-readers.ts:24`), unlike the
  printer key's `(location_id, local_key)`.
- **"Cannot be reached" has no code today.** A failed provider call surfaces as `server.internal`
  500 (`packages/server-kit/src/error-boundary.ts:39-40`); decision 3 adds `reader.unpair_failed`.
- **The schema calls readers undeletable.** `card-readers.ts:4-9` says a reader is "never
  deleted"; Task 1 rewrites it.

## Plan self-review

- Spec coverage: refusal (T2, T3), provider unpair and its three cases (T3), removed links (T2),
  demo reader (T2, T3), freed provider id and re-adoption (T1, T4a), no write to a deleted reader
  (T4a, T4b, T7), impact/delete agreement and a refusal between them (T3), dialog (T5, T6), history
  (T2).
- Tasks: 1, 2, 3, 4a, 4b, 5, 6, 7, 8a, 8b, then the driver's finish.
- Review focus: 1 → T1 Steps 6–7 and T4a; 2 → T3 and T4b; 3 → T4a, T4b and T7;
  4 → T4a and T6; 5 → T6.
- Names used across tasks: `readCardReaderDeleteImpact`, `prepareCardReaderDelete`,
  `markCardReaderUnpaired`, `deleteCardReader`, `namedItem`, `getReaderDeleteImpact`,
  `deleteReader`, `readerDeleteCopy`, refusal `"deleted"`, code `reader.unpair_failed`.
- Not established while planning: whether SumUp gives a re-paired physical reader the same
  provider id (either way a new record results); whether the stale-choice cases in Task 7 need any
  production change; what the bill payment route answers for a deleted reader (Task 4b pins it).
