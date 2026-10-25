# A1088: wrongly dated sales stay listed after "handled", download for the adviser, and a note

**Status: plan, 2026-10-25. Nothing was built when this was written.** Item A1088 (lane B's queue,
`~/waitron-campaign-b/a1088-plan-review/item.md`, owner-approved scope). Builds on A798-B slice 9
(#2025, `3a242a11e`): design
[§4.9 f](../specs/2026-10-19-a798-degraded-trading-design.md#f-wrongly-dated-records-go-to-the-owner),
plan [2026-10-23-a798-9-clock-restart.md](2026-10-23-a798-9-clock-restart.md) (its revision 8
block governs). Branch `feat/a1088-misdated-sales-download`, worktree
`waitron-feat-a1088-misdated-sales-download`, from `main` at `f0c5a44a7`.

**One migration, in the core set (`packages/db/drizzle`, the next number, 0190 today): one nullable
column added to `incidents`. Nothing in `registros_facturacion` is written or changed**: the only
new fiscal code is a reader. **FULL review** (fiscal records read; a by-id read; a migration; a
cross-package seat contract): per-task reviews run, then `/finish-branch`, which runs **two Codex
run-it reviews**, the second told to set this plan aside and test what it does not name. The pull
request's first line says no fiscal record is written; if any task finds it must touch how a
record is written, it stops and the pull request is parked for the owner.

## Words used here

- An **episode** is one `clock.records_misdated` alert: one closing of a clock check that found
  sales dated wrongly (a **list**), or found that the box cannot tell which (**cannot tell**). The
  alert's params name the closing (`confirmationId`) and the from–to times
  (`packages/fiscal-verifactu/src/clock-stop-incidents.ts:61-90`).
- The **corrected start** is the real time when the payment stop began, as the closing worked it
  out and stored it in `proof.closing.correctedStart`
  (`packages/fiscal-verifactu/src/clock-checks.ts:75-89`, `:146-162`).
- **Handled** means the incident's `acknowledged_at` is set (`packages/core/src/incidents.ts:306-314`).
- The **seat** is the fiscal module's slot on `FiscalBackend` (`packages/fiscal/src/backend.ts`);
  `misdatedRecords` is the one slice 9 added (`:365-367`).

## What the code does today (receipts)

- `readMisdatedOpen` selects only incidents whose `acknowledged_at` is null
  (`apps/server/src/box-health.ts:195-203`), and `GET /api/box/clock-misdated` gives a list only
  for those (`apps/server/src/box-health-api.ts:115-142`). **The item calls point 1 inferred; it
  is in fact asserted**: the case "lists the sales a closing found dated wrongly … until its alert
  is handled" ends by marking the alert handled and expecting the list gone
  (`apps/server/src/clock-confirm.route.test.ts:1314-1327`). Run on `f0c5a44a7`:
  `pnpm --filter @waitron/server exec vitest run src/clock-confirm.route.test.ts -t "until its alert is handled"`
  → 1 passed, 36 skipped. Task 1 turns those assertions round on purpose.
- **No note field exists on an acknowledgement**: `incidents` has `acknowledged_at` and
  `acknowledged_by` only (`packages/db/src/schema/incidents.ts:40-41`), and the mark-handled route
  reads no body (`apps/server/src/alerts-api.ts:89-103`). So the note is a column, hence a
  migration.
- **`incidents` carries no trigger and is not append-only**: classified `classify("incidents",
  "state", …)` (`packages/db/src/classification.ts:141`); "the table carries no trigger, so the rule
  is the code's to keep" (`incidents.ts:14-16`). Acknowledging is the one permitted change
  (`incidents.ts:14-15`); writing the note in the same UPDATE stays inside that rule.
- **A rebuild of `incidents` would break its expression index** (`incidents.ts:60-63`). Adding a
  nullable column with no CHECK is an `ALTER TABLE … ADD` in drizzle-kit, as core 0077 did for this
  table (`packages/db/drizzle/0077_incident_origin_add.sql:3-4`). Task 2 reads the generated SQL and
  stops on anything else.
- **The real time of a listed sale is not stored anywhere.** A closing stores the corrected start
  of the stop and its own readings (`clock-checks.ts:146-162`); the check stores the box's reading
  when the stop began, which is after the clock was put back (`clock-checks.ts:257-273`). Neither
  gives the error the clock had when a listed sale was stamped. What is known: every listed record
  was written before the check opened and stamped more than a minute after the corrected start
  (`packages/fiscal-verifactu/src/clock-misdated.ts:21-26`, `:54-66`), so it was really made before
  the corrected start.
- **The venue's time zone** is `locations.time_zone` (`packages/db/src/schema/tenants.ts:68`,
  `:81`). Calendar dates in a zone: `civilDateOf` (`packages/reporting/src/business-day.ts:126-134`),
  already used by the server (`apps/server/src/find-bill-dates.ts:2`, `:36`).
- **The venue's language** is worked out at boot as `venueLocale === "es-ES" ? "es" : "en"` for the
  managers' emails (`apps/server/src/boot.ts:1738`, `:2297`).
- **The amount a record holds** is `registros_facturacion.importe_total`, plain text because it is
  a hashed input, null on an anulación (`packages/fiscal-verifactu/src/schema/registros.ts:78-85`).
  No code reads it today (`git grep -n importeTotal` outside tests: only the writer
  `registro-row.ts:160`, `:185` and the schema).
- **CSV and download patterns**: the working-time export's CSV (`apps/server/src/attendance-export-csv.ts:3-38`:
  every cell quoted, formula guard, BOM, CRLF) and its headers (`apps/server/src/attendance-export-api.ts:134-144`);
  the dashboard saves a blob through a link (`apps/dashboard/src/screens/vat-return-screen.ts:122-128`,
  client `downloadVatReturnFile`, `apps/dashboard/src/api/client.ts:4142-4151`).
- **No printable page exists in the reporting area**: `git grep -n "window.print\|@media print"`
  finds only `apps/dashboard/src/screens/node-recovery-print.ts:46` and the custodian tool in
  `packages/fiscal-verifactu/src/custodian/`. The reports print to receipt printers
  (`printCategorySales`, `client.ts:4133-4139`).
- **The "cannot tell" alert can be handled by the box itself**, `personId: null`, when a later
  closing that cannot tell starts earlier (`clock-stop-incidents.ts:100-120`).

## Decisions this plan makes that the item does not

Each is the DEFAULT this build makes; the owner may override any of them, and the build does not
wait.

1. **The history lives in the box read.** `BoxHealth.misdatedOpen` stays the open alerts, oldest
   first, and each entry gains `incidentId`. A new `BoxHealth.misdatedHandled` holds every handled
   `clock.records_misdated`, newest first by detection, **with no time window and no cap** (one per
   clock episode; the bell's Handled tab keeps 30 days, `apps/server/src/alerts.ts:17`, which is too
   short for a tax period). `GET /api/box/clock-misdated` gives the lists of open and handled
   episodes alike.
2. **Who handled it.** A person's display name (read from `persons`, as `readHandledAlerts` does,
   `alerts.ts:193-201`); a null `acknowledged_by` is shown as "the box" (the box handles a "cannot tell"
   itself, `clock-stop-incidents.ts:100-120`); a person id with no row shows no name.
3. **The note is a new nullable column `incidents.acknowledged_note`**, in the core set, with no
   CHECK (a CHECK would rebuild the table, `incidents.ts:60-63`). The route trims it; empty or
   whitespace means no note; more than 500 characters is refused `management.request_invalid`
   with `field: "note"`. The note is written only by the UPDATE that first marks the incident
   handled (`incidents.ts:306-314` keeps the first handler), so marking an already-handled incident
   with a note still answers 204 and stores nothing.
4. **The note is entered only on Box status.** Each open entry gets its own **Mark handled**, which
   opens a small dialog with the optional note. The bell's and the Alerts screen's Mark handled stay
   one click, with no note, and the Alerts screen's Handled tab does not show notes (backlog entry,
   Task 12).
5. **CSV only, no printable page**: the reporting area has none to follow (receipt above).
6. **The CSV is in the venue's language** (worked out as the emails' is, `boot.ts:2297`), not the signed-in
   person's dashboard language, and is fixed until the server restarts, as the emails are. The file
   name is English: `misdated-sales-<yyyy-mm-dd>.csv`.
7. **Every time in the CSV is written in the venue's time zone** (`locations.time_zone` of this
   node's location), as `dd/mm/yyyy hh:mm`, and the "different day" mark compares **calendar
   dates** in that zone, not business days (`locations.day_cutover`), because the VAT period follows
   the invoice's issue date.
8. **"Real time" reads "Unknown" on every row in this build** (no stored value gives it, receipt
   above). The header line gives the bound instead: every listed sale was made before the corrected
   start. Slice 9c's change checks are the first place a real time could be worked out (design
   §4.9 f, the e₀ paragraph); a backlog entry says so (Task 12).
9. **"Different day" is "Yes" or "Cannot tell", never "No"**: "Yes" when the recorded calendar date
   is later than the corrected start's calendar date (the real date is then certainly earlier, since
   the sale was made before the corrected start); otherwise "Cannot tell". A `partial` closing's
   corrected start is the closing's own time (`clock-checks.ts:83-84`), later than the real start,
   so the bound still holds, only looser.
10. **The amount is the record's own `importe_total`**, turned into a `Decimal` with `decimal()`
    (`packages/shared/src/money.ts:16`) and `toScale(…, 2)` (`money.ts:159`), written with two
    places, the venue language's decimal mark, no currency sign and no grouping (`12.30` / `12,30`;
    the column heading names EUR). An anulación's amount cell says "Cancellation". No `Number()`.
11. **A new seat method, `misdatedDetail`, not a wider `misdatedRecords`**, so the closing's write
    path (`recordMisdated`, `clock-stop-incidents.ts:47-98`) and `misdatedRecords`'s 40 `toEqual`
    assertions (`packages/fiscal-verifactu/src/clock-misdated.test.ts`) are untouched. It answers
    the closing's source, person id, confirmation time, corrected start and `partial`, and each
    listed record with its kind (issue or cancellation) and stored amount text.
12. **The header line** (one quoted cell, the file's first line), English:
    "{venue}: {count} sales were recorded with a time later than the real one, from {from} to {to}.
    Each was made before {start}, when payments stopped for the clock. The clock was confirmed by
    {confirmedBy} on {confirmedAt}." ("One sale was recorded … at {from}. It was made before …" for
    one.) `{confirmedBy}` reuses `CLOCK_CONFIRMED_BY_WORDS` (`apps/server/src/i18n/box-emails.ts:45-58`),
    followed by the administrator's name in brackets for `admin`. A `partial` closing appends the
    existing sentence "The box restarted during the stop, so the list may be short."
    (`box-emails.ts:78`, `:88`). The CSV carries no handled line and no note.
13. **The download route is keyed by incident id**: `GET /api/box/clock-misdated/:incidentId/download`,
    `system.manage` as the rest of the page (`box-health-api.ts:54-64`). An id that is not a UUID,
    names no incident, names another code, or names a "cannot tell" episode answers 404
    `alert.not_found` (an existing code, `apps/server/src/errors.ts:1294`), so no error code is
    added. A closing the seat does not know is logged `box-clock-misdated.unknown_confirmation`, as
    the list route does (`box-health-api.ts:123-126`), and answers the same 404.
14. **The download is offered for every episode with a list, open or handled; never for "cannot
    tell"**, which has no list.
15. **Mark handled is an action, not a save**: enabled from the start, with or without a note. The
    dialog takes a draft scope because the note is typed input (design-system.md → "Protect an
    edited dialog before closing it").
16. **The section's guidance line changes** from "Go through these with your tax adviser, then
    mark the alert as handled in the bell." to "Download each list for your tax adviser and go
    through it with them, then mark it handled here with a note of what was done."

## Global constraints

- **English only** in code, identifiers, comments, fixtures and tests. Spanish only in
  `apps/server/src/i18n/misdated-sales.ts` (new), the Spanish half of
  `apps/dashboard/src/i18n/strings.ts` and `apps/server/src/guide/es/box-status.md`. A test of
  Spanish text reads its expected words from the words file or `t()`, never a Spanish literal of
  its own. `scripts/english-only.test.ts` does not scan `apps/*`, so review greps the diff.
- **Fiscal**: nothing in `registros_facturacion` is written or changed. The new seat method only
  selects. `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (the golden huella case,
  `:125-131`) and `packages/fiscal-verifactu/src/inmutabilidad.test.ts` run **unedited** in Task 4
  and again in Task 12, and the pull request quotes both test counts.
- **Reads take no transaction of their own.** The download, like the list route, authorises with
  `authorizeSystemManager` (its own `withTransaction`, or a read on a full disk,
  `box-health-api.ts:54-64`) and then reads everything in **one** `db.withWriteLock` turn, not a
  `withTransaction`, whose closing drain a full disk refuses (`box-health-api.ts:118-119`). The seat
  method opens none. Queries are awaited in turn, never `Promise.all`. The CSV is built after the
  turn.
- **The note's write** is the one `withTransaction` the mark-handled route already opens
  (`alerts-api.ts:39-49`).
- **Migration**: generated by `pnpm --filter @waitron/db db:generate`, never hand-edited; no
  shipped migration file is touched. A number collision on rebase is fixed by regenerating
  (CLAUDE.md §3).
- **Every database test uses `useVenueDb`.** A refused request asserts the domain error code. Exact
  shapes use `toEqual`/`toBe`, not `toMatchObject`, in new assertions.
- **Fixtures use values the two sides could treat differently**: a sale whose UTC date differs from
  its local date (Task 5); an amount whose trailing zero matters (`"12.30"`) and a negative one
  (`"-5.00"`); a Spanish decimal mark; a handler's display name that differs from every other
  person's in the suite.
- **Existing assertions that change on purpose** (named in the pull request):
  `clock-confirm.route.test.ts:1314-1327` (the list now stays, Task 1); `:1519` (the whole `lists`
  now also holds earlier cases' handled lists, so it is filtered by `confirmationId`, Task 1);
  `box-health.test.ts:366-411` (entries gain `incidentId`; the handled row now appears in
  `misdatedHandled`, Task 1); the `health()` fixtures of the seven dashboard test files that build a
  `BoxHealth` (Task 7). No other existing assertion changes.
- **Coverage** 98/98/98/95 in `@waitron/db`, `@waitron/core`, `@waitron/fiscal`,
  `@waitron/fiscal-verifactu`, `@waitron/server`, `@waitron/dashboard`; no exclude or ignore comment
  is added. `@waitron/db` and `@waitron/fiscal` are mutation-tested (`packages/db/stryker.config.json`,
  `packages/fiscal/stryker.config.json:7`); this branch adds a column literal to the first and only
  types to the second's `backend.ts`.
- **Browser runs** (`apps/dashboard` runs in real headless Chromium): check `memory_pressure | grep
  free` first.
- Commits `git commit -s`; `pnpm format:check` before each commit. Run each focused command with
  `AI_AGENT` and `CLAUDECODE` unset when a test's console output matters, and read the `Tests` count.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and hands over: what is done, what is left, the files, each
  check's state.

## Review focus

- **The by-id read** (Task 6): an incident id from another code, a "cannot tell" episode, a
  malformed id and an unknown id each answer 404 `alert.not_found`; a supervisor without
  `system.manage` answers 403 before any read.
- **The migration** (Task 2): the generated SQL is one `ALTER TABLE incidents ADD
  acknowledged_note text`; no rebuild, no index dropped.
- **The seat contract** (Task 4): a new optional method on `FiscalBackend`; `fiscal-none` and the
  fake backend leave it undefined, and the download route is mounted only where it exists.
- **Every sentence the CSV, the screen and the guide say about time**: "Unknown" and "Cannot tell"
  are claims (decisions 8 and 9); the review checks the bound against `clock-misdated.ts:54-66`.
- **The day mark reads the venue's time zone** (decision 7), proved by a fixture whose UTC date
  differs from its local date and a control in UTC.
- **Money**: no `Number()` on an amount; `toScale` and the decimal mark only.
- **The draft scope and the action rule** on the new dialog (decision 15).
- **Performance**: the box read now selects every handled episode every 15 seconds, and the list
  route reads every episode's list (decision 1); one indexed read of `incidents` by code plus two
  reads per episode. Unbounded on purpose; a backlog entry records the limit to revisit.
- **Personal data**: the note is free text a manager writes, stored in `incidents` and streamed
  with the database; the A980 audit's `incidents` row predates it (Task 12 adds a pointer).

## Task 1 — the list stays after "handled" (server)

Files: `apps/server/src/box-health.ts`, `apps/server/src/box-health-api.ts`,
`apps/server/src/clock-confirm.route.test.ts`, `apps/server/src/box-health.test.ts`.

Interface:

```ts
export interface MisdatedOpen { incidentId: string; /* the existing params fields, unchanged */ }
export type MisdatedHandler = { kind: "box" } | { kind: "person"; name: string | null };
export interface MisdatedHandled extends MisdatedOpen { handledAt: string; handledBy: MisdatedHandler }
// BoxHealth gains: misdatedHandled: MisdatedHandled[];
/** Every clock.records_misdated alert: open ones oldest first, handled ones newest first. */
export async function readMisdatedEpisodes(tx: Transaction): Promise<{ open: MisdatedOpen[]; handled: MisdatedHandled[] }>;
```

`readMisdatedOpen` is replaced by `readMisdatedEpisodes` (one select on `incidents` by code, left
join `persons` on `acknowledged_by`, ordered in SQL, split in JavaScript). `collectBoxHealth` reads
it in the same write-lock turn (`box-health.ts:213-243`). The list route iterates open then handled.

1. **Failing test first (point 1).** In the case at `clock-confirm.route.test.ts:1263`, rename it
   "…, and keeps it, marked handled, after its alert is handled", and replace `:1318-1327` with: the
   list for `confirmationId` is still in `misdatedOf(stop.app)` and `toEqual(listed)`; it is no
   longer in `misdatedOpen`; `misdatedHandled` holds `toEqual({ incidentId, …the open entry's
   params, handledAt: <the alerts app's clock, boxMs, as ISO>, handledBy: { kind: "person", name:
   "Marta" } })`. Run
   `pnpm --filter @waitron/server exec vitest run src/clock-confirm.route.test.ts -t "after its alert is handled"`;
   watch it fail on the missing list. **If it passes on the unmodified code**, stop and report: the
   list already survives, Task 1 shrinks to adding `incidentId`, `handledAt` and `handledBy`, and the
   receipt section above is wrong and must be corrected before Task 2.
2. More failing cases in `box-health.test.ts` (rewrite the case at `:366-411`): open entries carry
   their `incidentId`, oldest first; the handled row is in `misdatedHandled`; two handled rows come
   newest first by `detected_at`; a row with null `acknowledged_by` reads `{ kind: "box" }`; one
   whose `acknowledged_by` names no person reads `{ kind: "person", name: null }`; the other code
   appears in neither list. In `clock-confirm.route.test.ts`, the "cannot tell" replaced by an
   earlier start (`clock-stop-incidents.ts:100-120`; reached as in the case at `:1465`) shows in
   `misdatedHandled` with `{ kind: "box" }`.
3. Make `:1519` read only this case's lists (`lists.filter((list) => list.confirmationId ===
   confirmationId)`), since handled lists from earlier cases now appear in the shared database
   (`resetPerTest: false`, `:78-79`); its expectation is otherwise unchanged.
4. Implement. Omission controls, each run and reverted: drop the handled half of the list route →
   step 1 fails; order handled oldest first → the two-row case fails; map a null handler to
   `{ kind: "person", name: null }` → the "box" case fails.
5. Run `pnpm --filter @waitron/server exec vitest run src/clock-confirm.route.test.ts src/box-health.test.ts src/box-alert-email.test.ts src/box-alert-email.duty.test.ts`
   (the email duty still reads open alerts only, `box-alert-email.ts:110-122`) and
   `pnpm --filter @waitron/server typecheck`.

## Task 2 — the note column (db, core)

Files: `packages/db/src/schema/incidents.ts`, the generated `packages/db/drizzle/0190_*.sql`,
`meta/0190_snapshot.json`, `meta/_journal.json`, `packages/core/src/incidents.ts`,
`packages/core/src/incidents.test.ts`.

Interface: `acknowledgedNote: label("acknowledged_note")` beside `acknowledgedBy`, with a one-line
comment that it is written only with the acknowledgement. `markIncidentHandled(tx, { id, personId,
handledAt, note?: string | null })` sets `acknowledgedNote: input.note ?? null` in the same UPDATE,
whose `acknowledged_at is null` condition stays. `TenantIncident` is not widened (no reader needs
it there).

1. Failing cases in `packages/core/src/incidents.test.ts`: marking with a note stores it beside the
   handler and time; marking again with another note changes neither the first handler nor the
   (absent) note; marking with no note stores null. Run
   `pnpm --filter @waitron/core exec vitest run src/incidents.test.ts`; watch them fail (no column).
2. Add the column; run `pnpm --filter @waitron/db db:generate`. **Read the SQL: it must be exactly
   one `ALTER TABLE \`incidents\` ADD \`acknowledged_note\` text;`. A `__new_incidents` table, a
   dropped index or anything else: STOP** and report (the expression-index trap,
   `incidents.ts:60-63`).
3. Implement the parameter. Control, run and reverted: write the note in a second UPDATE without
   the `acknowledged_at is null` condition → the "marking again" case fails.
4. Run the migration guards: `pnpm exec vitest run scripts/schema-constraints.test.ts
   scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
   scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts
   scripts/classification-complete.test.ts scripts/migration-upgrade.test.ts
   scripts/column-vocabulary.test.ts`, then `pnpm --filter @waitron/db exec vitest run` and
   `pnpm --filter @waitron/core exec vitest run src/incidents.test.ts src/incidents.concurrency.test.ts`,
   and `typecheck` in both packages. Read every count.

## Task 3 — "Mark handled" takes the note (server)

Files: `apps/server/src/alerts-api.ts`, `apps/server/src/alerts-api.test.ts`,
`apps/server/src/box-health.ts`, `apps/server/src/box-health.test.ts`.

Interface: the route reads `readRawJsonBody` (`packages/server-kit/src/read-json-body.ts:21-26`,
null for an empty body). Null, `{}` or `{ note: undefined }` → no note; `note` a string → trimmed,
`""` → no note, over 500 characters → `management.request_invalid` `{ field: "note" }`; `note` any
other type, or a body that is not an object → the same refusal. `STATUS` gains
`"management.request_invalid": 400`. Validation happens before the transaction. `MisdatedHandled`
gains `note: string | null`, read in `readMisdatedEpisodes`.

1. Failing cases in `alerts-api.test.ts`: a note is stored (read back with SQL) and the response is
   204; 500 characters accepted, 501 refused with the code and `field`; whitespace-only stores null;
   a number refused; no body still works (the existing case at `:228` stays as it is); an
   already-handled incident with a note answers 204 and stores nothing. In `box-health.test.ts`, a
   handled row's `note` comes through, and a row with none reads `null`. Run
   `pnpm --filter @waitron/server exec vitest run src/alerts-api.test.ts src/alerts-api.full-disk.test.ts src/box-health.test.ts`;
   watch the new cases fail.
2. Implement. Control, run and reverted: skip the trim → the whitespace case fails.
3. Run the same files, `src/clock-confirm.route.test.ts`, and `pnpm --filter @waitron/server typecheck`.

## Task 4 — the seat's `misdatedDetail` (fiscal, fiscal-verifactu)

Files: `packages/fiscal/src/backend.ts`, `packages/fiscal/src/index.ts`,
`packages/fiscal/src/testing/fake-backend.test.ts`, `packages/fiscal-none/src/backend.test.ts`,
`packages/fiscal-verifactu/src/clock-misdated.ts`, `packages/fiscal-verifactu/src/backend.ts`,
`packages/fiscal-verifactu/src/clock-misdated-detail.test.ts` (new).

Interface (in `packages/fiscal/src/backend.ts`, beside `MisdatedRecords`, `:262-271`):

```ts
export interface MisdatedDetailRecord extends MisdatedRecord {
  kind: "issue" | "cancellation";
  /** The record's stored total, as hashed; null on a cancellation. */
  amount: string | null;
}
export type MisdatedDetail =
  | {
      known: true;
      closing: { source: ClockConfirmationSource; personId: string | null; confirmedAt: string;
                 correctedStart: string; partial: boolean };
      records: MisdatedDetailRecord[];
    }
  | { known: false };
// FiscalBackend gains, beside misdatedRecords (:365-367):
/** misdatedRecords' list with each record's kind and amount, and the closing's own values; reads
 * only. Null when no confirmation has the id. */
misdatedDetail?(tx: Transaction, confirmationId: string): Promise<MisdatedDetail | null>;
```

In `clock-misdated.ts`: `misdatedDetail` calls `misdatedRecords`; null or `known: false` is passed
through; otherwise one select of `clock_confirmations` by id (source, person id, confirmed at,
`proof`) and one select of `registros_facturacion` (`id`, `tipo_registro`, `importe_total`) with
`inArray` over the listed ids (skipped when the list is empty), awaited in turn, joined in
JavaScript in the list's order. `tipo_registro` `alta` → `issue`, `anulacion` → `cancellation`.
`correctedStart` and `partial` come from `proof.closing`.

1. Failing cases (`useVenueDb` as `clock-misdated.test.ts` sets it up; reuse its fixture shape,
   copied into the new file rather than exported): the worked example's list with amounts and kinds
   `toEqual`, including one anulación (`amount: null`, `kind: "cancellation"`) and one amount
   `"12.30"` kept as written; the closing's values for an admin closing (`personId` set) and a
   devices closing; a `partial` closing; "cannot tell" passes through as `{ known: false }`; an
   unknown id answers null; an empty list answers `records: []` with its closing. Run
   `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-misdated-detail.test.ts`;
   watch it fail.
2. Implement, and the backend method (`backend.ts:225-227`'s neighbour). In
   `fake-backend.test.ts:72` and `fiscal-none/src/backend.test.ts:80` add the same "undefined"
   expectation for `misdatedDetail`.
3. Control, run and reverted: read `amount` from a `Number()` round trip → the `"12.30"` case fails.
4. **Fiscal guards, unedited**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run
   src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/clock-misdated.test.ts
   src/clock-stop-incidents.test.ts`; `git diff --stat main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts
   packages/fiscal-verifactu/src/inmutabilidad.test.ts` prints nothing. Then
   `pnpm --filter @waitron/fiscal exec vitest run`, `pnpm --filter @waitron/fiscal-none exec vitest run`,
   and `typecheck` in the three packages.

## Task 5 — the CSV builder and its words (server)

Files: `apps/server/src/csv.ts` (new), `apps/server/src/attendance-export-csv.ts`,
`apps/server/src/misdated-sales-csv.ts` (new), `apps/server/src/misdated-sales-csv.test.ts` (new),
`apps/server/src/i18n/misdated-sales.ts` (new).

Interface:

```ts
// csv.ts — moved from attendance-export-csv.ts:3-10, unchanged
export function csvCell(value: RecordExportValue): string;
export function csvBytes(lines: readonly (readonly RecordExportValue[])[]): Uint8Array; // BOM + CRLF, as :37
// misdated-sales-csv.ts
export interface MisdatedSalesInput {
  venue: string;
  language: "en" | "es";
  timeZone: string;
  confirmedByName: string | null; // the administrator's display name for an admin closing
  episode: { count: number; from: string; to?: string }; // the alert's params
  detail: Extract<MisdatedDetail, { known: true }>;
}
export function renderMisdatedSalesCsv(input: MisdatedSalesInput): Uint8Array;
export function misdatedSalesFileName(input: Pick<MisdatedSalesInput, "episode" | "timeZone">): string;
```

Layout: line 1 the header sentence (decision 12) in one cell; line 2 the column headings —
Series, Number, Time recorded, Real time, Amount (EUR), Different day (Spanish in the words file:
Serie, Número, Hora registrada, Hora real, Importe (EUR), Otro día); then one row per record in the
list's order. Series and number through `invoiceNumberParts` (`apps/server/src/invoice-number-parts.ts`),
number empty when null. Times: `Intl.DateTimeFormat("en-GB", { timeZone, day, month, year, hour,
minute, hourCycle: "h23" })` → `dd/mm/yyyy hh:mm` (the day order the emails use in both languages,
`box-alert-email.ts:102`). Real time: the words' "Unknown" / "Desconocida". Amount: decision 10
("Cancellation" / "Anulación" for a cancellation). Different day: decision 9 with `civilDateOf`
("Yes"/"Sí", "Cannot tell"/"No se sabe"). The file name uses the venue-zone date of `episode.from`.

1. Failing cases, the words read from `MISDATED_SALES_WORDS` in each language, never Spanish
   literals in the test:
   - **The day mark in the venue's zone.** `timeZone: "Europe/Madrid"`, corrected start
     `2026-10-24T21:00:00.000Z` (23:00 on the 24th in Madrid); a record at `2026-10-24T22:30:00.000Z`
     (00:30 on the 25th in Madrid, the 24th in UTC) → "Yes"; one at `2026-10-24T21:30:00.000Z`
     (23:30 on the 24th) → "Cannot tell". Control: the same input with `timeZone: "UTC"` → both
     "Cannot tell" (proves the zone is read, not UTC).
   - **Times in the zone**: the first record's cell is `25/10/2026 00:30` under Madrid.
   - **Amounts**: `"12.30"` → `12.30` (en) and `12,30` (es); `"-5.00"` → `-5.00` / `-5,00`; a
     cancellation → the cancellation word.
   - **Header**: the exact English sentence for 2 records from an admin closing named "Mario"
     (`… confirmed by an administrator (Mario) on …`), the one-sale form, the `partial` sentence
     appended, and the Spanish header equals the Spanish template filled with the same values.
   - **Shape**: BOM first, CRLF line ends, every cell quoted, a series beginning with `=` gets the
     formula guard; the file name is `misdated-sales-2026-10-25.csv` for a `from` of
     `2026-10-24T22:30:00.000Z` under Madrid.
   Run `pnpm --filter @waitron/server exec vitest run src/misdated-sales-csv.test.ts`; watch it fail.
2. Move `cell` to `csv.ts` as `csvCell` and use it, and `csvBytes`, from `attendance-export-csv.ts`;
   `pnpm --filter @waitron/server exec vitest run src/attendance-export-csv.test.ts src/attendance-export-api.test.ts`
   stays green with no test edited.
3. Implement. Controls, each run and reverted: compare `toISOString().slice(0, 10)` instead of
   `civilDateOf` → the Madrid case fails; format the amount with `String(Number(amount))` → the
   `"12.30"` case fails.
4. Run the four files and `pnpm --filter @waitron/server typecheck`.

## Task 6 — the download route (server)

Files: `apps/server/src/box-health-api.ts`, `apps/server/src/box-health.ts` (one by-id reader),
`apps/server/src/boot.ts` (`mountBoxHealthApi`'s deps, `:2412`), `apps/server/src/clock-confirm.route.test.ts`
(the cases, and the deps in `stoppedBox` `:215-251` and `boxApp` `:1222-1245`).

Interface: `BoxHealthApiDeps` gains `venue: { locationId: string; language: "en" | "es" }`; boot
passes `{ locationId: till.locationId, language: venueLocale === "es-ES" ? "es" : "en" }`. The route
`GET /api/box/clock-misdated/:incidentId/download` is mounted only when the seat has
`misdatedDetail`. Inside one `withWriteLock` turn: `readMisdatedEpisode(db, incidentId)` (the
incident's code and params, by id), the seat's `misdatedDetail`, the location's `name` and
`time_zone`, and `displayNameOf` (`box-health.ts:122-128`) for an admin closing. After the turn:
`renderMisdatedSalesCsv`; headers `Content-Type: text/csv; charset=utf-8`, `Content-Disposition:
attachment; filename="<misdatedSalesFileName>"`, `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff` (as `attendance-export-api.ts:134-143`). Refusals: decision 13.

1. Failing cases in `clock-confirm.route.test.ts`, on an episode made as in the case at `:1263`:
   - the CSV's rows match the list route's records for the same episode, one for one, and every
     row's Real time is the "Unknown" word; the header names Mario (the confirming administrator)
     and the episode's count; the bytes start with the BOM; the four headers are set;
   - the same after the alert is marked handled (decision 14);
   - **the venue's time zone and language are read**: with `update locations set time_zone =
     'Pacific/Kiritimati'` (UTC+14) the header's from time differs from the UTC rendering by 14
     hours, then restored; with `language: "es"` in the deps the column headings are the Spanish
     words;
   - 404 `alert.not_found` for a malformed id, an unknown UUID, the incident id of a
     `clock.behind_chain_restarted` alert, and a "cannot tell" episode; 403 for Sergio (supervisor);
   - on a full disk with a change waiting (as the case at `:1395` does), the download still
     answers and the change still waits.
   Run `pnpm --filter @waitron/server exec vitest run src/clock-confirm.route.test.ts -t "download"`;
   watch them fail.
2. Implement and wire boot.
3. Controls, each run and reverted: drop the code check from the by-id read → the restarted-alert
   case answers 200; read the time zone from `Intl` instead of the location → the Kiritimati case
   fails.
4. Run `pnpm --filter @waitron/server exec vitest run src/clock-confirm.route.test.ts src/box-health.test.ts src/boot.test.ts`
   and `pnpm --filter @waitron/server typecheck`. If the new or longer files push a server shard
   past 4 minutes in CI, refresh `apps/server/test-durations.json` with `scripts/test-durations.mjs`
   (CLAUDE.md §2).

## Task 7 — the dashboard's client and types

Files: `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/api/client.test.ts`,
`apps/dashboard/src/api/live-queries.ts`, and the `health()` fixtures in
`apps/dashboard/src/screens/box-status-rows.test.ts`, `box-status-rows.tax.test.ts`,
`box-status-screen.test.ts`, `box-status-screen.a11y.test.ts`, `box-status-screen.retry.test.ts`,
`box-status-screen.retry.a11y.test.ts` (each gains `misdatedHandled: []`; entries of
`misdatedOpen` gain an `incidentId`).

Interface: the LOCAL copies (`client.ts:1749-1775`) gain `incidentId` on `MisdatedOpenView` and a
`MisdatedHandledView` (`handledAt`, `handledBy`, `note`), and `BoxHealth.misdatedHandled`.
`markIncidentHandled(incidentId: string, note?: string)` sends `{ note }` only when `note` is given
(the bell's and Alerts screen's calls are unchanged). `downloadMisdatedSales(incidentId: string):
Promise<Blob>` → `GET /api/box/clock-misdated/<id>/download` with `{ as: "blob" }`, as
`downloadVatReturnFile` (`client.ts:4142-4151`). `QUERY_DEPENDENCIES.clockMisdated` stays
`["incidents"]`; `getBoxHealth` stays `[]` (`live-queries.ts:529-531`).

1. Failing cases in `client.test.ts`: the note is in the POST body when given and the body is
   absent when not; the download hits the path with the id encoded and answers a Blob. Run
   `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts`; watch them fail.
2. Implement; update the fixtures; `pnpm --filter @waitron/dashboard typecheck`.
3. Run `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts src/screens/box-status-rows.test.ts src/screens/box-status-rows.tax.test.ts`.

## Task 8 — Box status: the history and the download button

Files: `apps/dashboard/src/screens/box-status-screen.ts`, `apps/dashboard/src/i18n/strings.ts`,
`apps/dashboard/src/screens/box-status-screen.test.ts`, `box-status-screen.a11y.test.ts`.

What it draws (decisions 1, 2, 14, 16): the section as today (`box-status-screen.ts:748-770`) with
the new line (`box_status.misdated.line`, both languages). Each open entry keeps its sentence and
table and gains an actions row: **Download for your adviser** (`secondary`, only for a list) and
**Mark handled** (`secondary`; its dialog is Task 9, so in this task it is drawn but wired in Task
9). Then, when any handled entry has something to show, an `h3` **Handled** and the handled entries
newest first, each: a line "Marked handled by {name} on {time}." / "Marked handled by the box on
{time}." / "Marked handled on {time}." (no name), the note as "Note: {note}" when there is one, the
entry's sentence and table, and Download for a list. `#followMisdated` (`:291-313`) watches the
lists while any open or handled entry has one. The several-tables label (`:733-738`) counts open and
handled tables. Download: `api.downloadMisdatedSales(incidentId)`, saved through a link as
`vat-return-screen.ts:122-128` does, named `misdated-sales-<date of from>.csv`; `loading` on its own
button while asked; a failure shows `codeMessage(code)` under that entry, until the next press.
New string keys under `box_status.misdated.*` (`download`, `mark_handled`, `handled_heading`,
`handled_by`, `handled_by_box`, `handled_no_name`, `note`, `download_error`), English and Spanish.

1. Failing browser cases in `box-status-screen.test.ts`: a handled entry's table still shows with
   who and when and its note; two handled entries newest first; "the box" line for a box-handled
   one; no Download for a "cannot tell" entry, open or handled; Download asks for the entry's
   incident id and clicks a link whose `download` is the file name (spy on `HTMLAnchorElement.prototype.click`);
   a refused download shows the sentence under that entry only; the section is drawn when only a
   handled entry exists. Spanish case: switch the language, expected words from `t()`, restore the
   language after (CLAUDE.md §4). Run (memory first)
   `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-screen.test.ts`; watch them fail.
2. Implement. Control, run and reverted: keep `#followMisdated` open-only → the handled-only case
   fails.
3. Add to `box-status-screen.a11y.test.ts`: the section with an open list (both buttons) and a
   handled entry with a note, in both themes, no axe violations.
4. Run both files and `pnpm --filter @waitron/dashboard typecheck`.

## Task 9 — Box status: "Mark handled" with a note

Files: `apps/dashboard/src/widgets/misdated-handle-dialog.ts` (new),
`misdated-handle-dialog.test.ts`, `misdated-handle-dialog.unsaved.test.ts`,
`misdated-handle-dialog.a11y.test.ts` (new), `apps/dashboard/src/screens/box-status-screen.ts`,
`apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/screens/box-status-screen.test.ts`.

Built like `apps/dashboard/src/widgets/attendance-export-dialog.ts` (its draft scope and its
`.unsaved.test.ts`). A `wt-dialog` headed "Mark handled", a line naming the episode ("{count} sales
from {from} to {to}", or the one-sale or "cannot tell" form), one `wt-textarea` `name="note"`,
label "Note", placeholder "What your tax adviser said, or what was done (optional)", `maxlength`
500, and `wt-form-actions` with Cancel (`secondary`) and **Mark handled** (`primary`, enabled from
the start, `loading` while sent; both disabled and the dialog not dismissible while sent). It takes
`draftScopeFor(this, owner)`; the draft is the trimmed note against `""`; `beforeClose` goes through
the coordinator; Cancel and Escape through `requestClose`. On success: `commit`, `closeAfter("saved")`,
then the screen calls `api.liveData.refresh()` (as its other actions do, `box-status-screen.ts:347`).
A refusal `management.request_invalid` with `field: "note"` puts "Write a note of 500 characters
or fewer." under the field until it changes; any other refusal shows `codeMessage(code)` in the
footer above the buttons; neither disables the action.

1. Failing cases: the dialog sends the trimmed note and no note when empty; the action is enabled
   on open; the field refusal sits under the field and clears when the note changes; `alert.not_found`
   shows in the footer; success closes the dialog and the screen re-reads (spy on
   `liveData.refresh`); in `.unsaved.test.ts`, closing with a typed note asks, Keep keeps it,
   Discard closes, and closing untouched asks nothing; in `box-status-screen.test.ts`, Mark handled
   opens the dialog for that entry's incident. Run (memory first)
   `pnpm --filter @waitron/dashboard exec vitest run src/widgets/misdated-handle-dialog.test.ts src/widgets/misdated-handle-dialog.unsaved.test.ts src/screens/box-status-screen.test.ts`;
   watch them fail.
2. Implement. Control, run and reverted: leave out `changed()` after input → the unsaved case fails.
3. `misdated-handle-dialog.a11y.test.ts`: open, with a field refusal, and while sending, both
   themes.
4. Run the four widget files, the screen file and `pnpm --filter @waitron/dashboard typecheck`.

## Task 10 — the guides

Files: `apps/server/src/guide/en/box-status.md`, `apps/server/src/guide/es/box-status.md`.

1. In `#clock-behind` (`en/box-status.md:214-223` and its Spanish twin), the sentence quoting the
   section's line takes the new line (decision 16), and "then mark the alert as handled" points to
   the new section.
2. Add `## Sales dated wrongly {#sales-dated-wrongly}` to both, after `#clock-behind`, saying in the
   screen's own words: each list stays under **Handled** after it is marked handled, with who, when
   and the note, newest first, and the box's own handling when a later check replaced a "cannot
   tell"; **Download for your adviser** gives a CSV in the venue's language with the header line,
   the columns, the times in the venue's time zone, "Unknown" real times with the bound, "Yes" or
   "Cannot tell" and what each means for the VAT period, amounts as recorded, and cancellations;
   **Mark handled** on this page takes an optional note of up to 500 characters, the bell's does
   not. No sentence claims more than decisions 3 to 14 deliver.
3. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
   `pnpm exec vitest run scripts/guide-links.test.ts`.

## Task 11 (visual) — LOOK

Docker Desktop's socket is missing on this machine, so no dev stack starts. Scripts and pictures
live outside the worktree: `~/waitron-campaign-b/a1088-scripts/` and `~/waitron-campaign-b/a1088-shots/`;
nothing here is committed (`git status --short` shows none of it).

1. A throwaway browser test beside `box-status-screen.a11y.test.ts`, gated as
   `department-receipt-editor.a11y.test.ts:66-76` gates its captures, takes `page.screenshot` of:
   the section with an open list (both buttons), the note dialog (empty, with a field refusal), and
   a handled entry with a long note, in English and Spanish, light and dark, at 1280 and 390 px.
   Check at 390 px that the table, the two buttons and the note wrap inside the page and nothing
   scrolls sideways except the table. Deleted after.
2. A throwaway copy of Task 6's download case writes the English and the Spanish CSV to the shots
   folder; read both whole, and open each in the workspace's playwright Chromium to check that
   accented words render. Look for: the header names the episode and how the clock was
   confirmed; every time in the venue's zone; "Unknown" on every row; the day mark; the amounts'
   decimal mark.
3. Write one line per picture or file for the pull request's **LOOK** section.

## Task 12 — docs, backlog and the final fiscal run

Files: `docs/backlog.md`, `docs/backlog/box.md`, `docs/developers/design-system.md`,
`docs/developers/conventions-data.md`, `docs/compliance/asesor-questions.md`,
`docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md`,
`docs/superpowers/specs/2026-10-16-a664-personal-data-audit.md`.

1. Grep the siblings first: `grep -n -i "misdated\|dated wrongly\|readMisdatedOpen\|Q60" docs/backlog.md docs/backlog/*.md docs/developers/*.md`.
   A1088 itself is in lane B's queue, not `docs/backlog.md`; no A798-B point there names the
   download, the history or the note (grep on `f0c5a44a7`: only `docs/backlog.md:4627`, `:4635`,
   `:4652`, `:5063-5066` and `docs/backlog/box.md:1238-1247`), so nothing is deleted.
2. `docs/backlog/box.md:1238-1247`: the cast point now names `readMisdatedEpisodes`.
3. New short entries in the box area of `docs/backlog.md` (after the A798 follow-ups,
   `:4636-4655`), detail in `docs/backlog/box.md` where longer than three lines:
   - **Correct the sales dated wrongly once the tax adviser answers Q60** — what the correction is
     waits on Q60 (rectifying invoices, a notice to AEAT, or keeping the list); A1088 built only the
     list, its history and the download.
   - **Some sales dated wrongly are in no list** (design §4.9 f): a clock put right from little more
     than a minute ahead, which the 15-second look can miss; and a "cannot tell" episode, which asks
     for every sale since its start to be checked but has no list and no download.
   - **The real time of a sale dated wrongly is unknown**: every row says so (A1088 decision 8);
     slice 9c's change checks are where it could first be worked out.
   - **The bell's and the Alerts screen's Mark handled take no note**, and the Handled tab does not
     show notes (A1088 decision 4).
   - **Every handled list stays on Box status with no limit**, read every 15 seconds (A1088
     decision 1).
4. `docs/developers/design-system.md` → Box status page: the "holds no staged input" sentence
   (`:5448-5449`) and the Sales dated wrongly bullet (`:5525-5532`) describe the history, the two
   buttons and the dialog; the cases list names the new widget's tests.
5. `docs/developers/conventions-data.md:3861-3862`: the list route now gives a list for every
   confirmation a `clock.records_misdated` alert names, open or handled (`readMisdatedEpisodes`).
6. Dated pointers (historical or unsent text is not rewritten): Q60 in
   `docs/compliance/asesor-questions.md` (after `:3832`): "2026-10-25 (A1088): the list now stays on
   the Box status page after the alert is handled, with who handled it and an optional note, and
   each list downloads as a CSV for the adviser (series and number, time recorded, real time
   unknown, amount, whether the date may differ)." The spec's §4.9 f, after its last paragraph, one
   line pointing at this plan. The A980 audit's `incidents` row (`2026-10-16-a664-personal-data-audit.md:116`):
   one line that `acknowledged_note` (free text a manager writes) was added by A1088.
7. `pnpm exec prettier --file-info` on each changed doc (each prints `"ignored": true`).
8. **Final fiscal run, unedited**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`;
   record both counts for the pull request, and `git diff --stat main -- packages/fiscal-verifactu/src/schema/
   packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/clock-stop-incidents.ts`
   prints nothing.

Then `/finish-branch` (FULL path, two Codex run-it reviews).
