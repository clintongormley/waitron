# A1301 — Remove the location concept: code and fixture slices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Spec:** `docs/superpowers/specs/2026-11-01-a1301-remove-location-design.md` (the design, as
amended; "§N" below means a section of it). Research inputs: `~/waitron-campaign/a1301/inventory.md`,
`fiscal-check.md`, and the file assignment `file-assignment.tsv` with `file-assignment-summary.md`
(run at main `0e206d34b2` plus A696's branch at `7e824ae233`).

**Plan head:** main `0160250f67` (2026-11-01). Five writers read the code in parallel, so line
numbers were read at the head each slice section names: main `abfe271663`, or A696's branch
`origin/feat/a696-startup-zone-validation` at `7e824ae233` (PR #2369, still open; it lands before
S1). Every implementer re-reads the lines at their own head before editing.

**Tech stack:** TypeScript, drizzle over SQLite (`node:sqlite`), Vitest 4 (browser mode for the
dashboard, till and setup app), pnpm workspace.

## Amendments to the design this plan makes

The design's readers should know these; each is explained where it bites.

1. **Three readers move from S1 to S2.** `saleLanguageFor` and `readOfferedReceiptLanguages`
   (`apps/server/src/venue-locale.ts`) and `readLocationAddress` (`apps/server/src/venue-address.ts`)
   are called from files on the invoice path, so S2 (owner-landed) changes them and all their callers
   (Task S2-5). S1 does not touch them.
2. **Files and lines moved between slices** — see "Files moved from the design's slice" below:
   `record-export-types.ts` to S14; `mirror-bundle.ts`, `mirror-bundle-fetch.ts`, `table-removal.ts`
   and `ApplyResult.locationId` to S18; the rota warnings query and route to S13; the whole restore
   preview rename `locationName` → `venueName` to S16; the device admission checks in S11 and S13
   files to S12a; deleting `GET /management-api/locations` becomes S12d, which waits for S15.
3. **S4's refusal code is `mirror.venue_not_copied`**, not the design's proposed
   `adoption.venue_not_copied`: no `adoption.*` error code exists, and the registry names an adopted
   standby's refusals `mirror.*`.
4. **`apps/server/src/first-fiscal-setup.e2e.test.ts` is edited by S16**, limited to the lines that
   build the setup request (246-254 and 368 at A696's head), with no assertion changed; S16's PR names
   it. S17 later deletes its `fireControl` check, because `fireControl` leaves the bundle (§2.1).
5. **A new error code, `venue.not_found`**, is what the accessor throws on a database with no venue
   row (setup has not run). Two or more rows throw the existing `provisioning.second_venue`.
6. **S17 replaces the nineteen `locationColumns` declarations with one interim import rule**: a
   column whose foreign key points at `locations` is set to the importing venue's row
   (`venueLocationId(tx)`) until the schema slices drop the columns.
7. **S16's reset may reach boxes that finished first setup**, not only boxes in the middle of it:
   `first-setup.json` is read at every start. Task S16b's probe settles it and fixes the PR's first
   line.
8. **Code slices do not wait for the fixture slices** (rule "A database with a second venue row"
   below), and overlap with an open pull request is never a reason to wait: whoever lands second
   rebases.

## Goal

Every box serves exactly one place, so the code stops pretending it might serve several. This plan
takes the word "location" out of the code that reads and passes it: no function takes a location id,
no route or query names one, and every "is this row at the same location?" check is deleted together
with the tests that exist only to prove it. The venue's settings are read through one accessor that
takes no id. Nothing a customer, the tax agency or a fiscal hash sees changes; the venue's staff see
"venue" where they saw "location".

## Approach

**Code slices first.** S1 adds the venue accessor in `@waitron/db` (`readVenue`, `readVenueClock`,
`readVenueClockAndPlace`) and one interim helper, `venueLocationId(tx)`, which returns the id of the
database's single `locations` row and refuses when there is not exactly one. Code that must still
fill a `location_id` column calls it instead of receiving an id, so no code slice needs a migration
or a reset. S2–S12, S16 and S17 then move each area onto the accessor. **Fixture slices next.** F1
makes `packages/db/src/testing/seed.ts` the one place a test gets its venue, node, device and order
rows (`seedVenue`, `seedNode`, `seedDevice`, `seedWorkingOrder`), with a codemod script that rewrites
the common shapes; F2–F5 move every other package's tests onto those helpers. After that a schema
slice changes the helpers' bodies, not hundreds of tests. **The schema work comes later, in its own
plan:** the tables, the `location_id` columns and `venueLocationId` itself go in S20–S28, one reset
window, written once F1–F5 and S18 have landed.

## What this plan covers, and what it does not

Covered: **S1–S12, S16, S17** (code) and **F1–F5** (fixtures).

Not covered, and why:

- **S13, S14, S15** wait for A1268 (#2375, lane B) to land, because A1268 removes the location from
  clock-ins, entries, closures and both working-time hashes itself (§6, "How A1301 meets A1268");
  each of these slices removes only what A1268 leaves, so its plan is written against A1268's merged
  diff. **S14** also waits for the owner's answer to question 4 (§7). Lines this plan hands them are
  in "Notes for the S13–S15 plans" below.
- **S18** (contract and type cleanup) waits for S2–S17, and **S19**'s text sweep runs after S18 (its
  plan-only backlog part may run now).
- **S20–S28** (the schema slices and the reset window) are a separate plan, written once F1–F5 and
  S18 have landed.

## Dependencies, tasks and who lands each slice

The owner lands a slice that (a) changes code on the path that builds, numbers, chains, stores, sends
or prints an invoice record, (b) moves where a value hashed into an invoice record or sent to AEAT is
read from, (c) touches a path that writes an invoicing-system identity, or (d) rebuilds a table
invoice records point at by foreign key (§6). The lane lands the rest.

| Slice | Tasks | Depends on | Lands | Review | Branch |
| --- | --- | --- | --- | --- | --- |
| S1 | 4 (S1a–S1d) | A696 (#2369) landed | lane | FULL | `refactor/a1301-s1-venue-accessor` |
| F1 | 4 (F1a–F1d) | S1 | lane | FULL | `refactor/a1301-f1-seed-helpers` |
| S2 | 5 (S2-1–S2-5) | S1 | **owner** (a, b) | FULL | `refactor/a1301-s2-invoice-inputs` |
| S3 | 4 (S3-1–S3-4) | S1; reuses S2-1 Step 1 if S2 is ahead, else S3-4 does it | **owner** (c) | FULL | `refactor/a1301-s3-fiscal-verifactu` |
| S4 | 2 (S4-1, S4-2) | S1; must land before S25 | **owner** (c) | FULL | `refactor/a1301-s4-adoption-refusal` |
| S5 | 2 (S5-1, S5-2) | S1 | lane | FULL | `refactor/a1301-s5-catalogue` |
| S6 | 2 (S6a, S6b) | S5 | lane | FULL | `refactor/a1301-s6-venue-service-service` |
| S7 | 1 | S6 | lane | FULL | `refactor/a1301-s7-floor` |
| S8 | 1 | S1; runs alongside S5–S7 | lane | FULL | `refactor/a1301-s8-venue-service-calendar` |
| S9 | 2 (S9a, S9b) | S1 | lane | LIGHT | `refactor/a1301-s9-staffing-bookings` |
| S10 | 3 (S10a–S10c) | S1 | lane | LIGHT | `refactor/a1301-s10-printing-layouts` |
| S11 | 3 (S11a–S11c) | S1 | lane | LIGHT | `refactor/a1301-s11-orders-kitchen-refunds` |
| S12 | 3 (S12a–S12c) | S1 | lane | FULL | `refactor/a1301-s12-devices-joins-admission` |
| S12d | 1 | **S15** (not in this plan) | lane | FULL | `refactor/a1301-s12d-locations-route` |
| S16 | 6 (S16a–S16f) | S1 | **owner** (c) | FULL | `refactor/a1301-s16-setup-venue-fields` |
| S17 | 2 (S17a, S17b) | S16 | lane | FULL | `refactor/a1301-s17-bundle-venue-fields` |
| F2 | 7 (F2a–F2g) | F1 | lane | LIGHT | `refactor/a1301-f2-package-fixtures` |
| F3 | 4 (F3a–F3d) | F1 | lane | LIGHT | `refactor/a1301-f3-server-fixtures-a-f` |
| F4 | 4 (F4a–F4d) | F1 | lane | LIGHT | `refactor/a1301-f4-server-fixtures-g-r` |
| F5 | 5 (F5a–F5e) | F1 | lane | LIGHT | `refactor/a1301-f5-server-fixtures-s-z` |

65 tasks in all. Order within S5–S8: **S1 → S5 → S6 → S7, with S8 alongside** (S6's
`department-receipt-languages.ts` change builds on S5's; S7 edits `department-transfers.ts`, an S6
file). S9, S10, S11, S12, S16 and F1 start once S1 has landed, in parallel, in different lanes.

- **Owner lands:** S2 (a, b), S3 (c), S4 (c), S16 (c). Owner-landed slices wait for the owner at
  landing, not at build.
- **Lane lands:** S1, S5, S6, S7, S8, S9, S10, S11, S12, S12d, S17, F1, F2, F3, F4, F5.

"FULL" is the full review path (a risk trigger: fiscal, migration, auth or permissions, concurrency,
tenant isolation or a by-id read, a cross-package contract); "LIGHT" has no per-task reviewer. Each
slice section says which trigger applies.

## Files moved from the design's slice

| What | Design's slice | Now | Why |
| --- | --- | --- | --- |
| `saleLanguageFor`, `readOfferedReceiptLanguages` (`apps/server/src/venue-locale.ts`), `readLocationAddress` (`apps/server/src/venue-address.ts`), and every caller, including `department-receipt-api.ts:87` | S1 | S2 (Task S2-5) | Their callers `till-sale.ts`, `bill-payments.ts`, `working-order.ts` and `receipt-presentation.ts` store and print an invoice record (rule a). |
| `packages/shared/src/record-export-types.ts` (`RecordExportInput.locationId`) | S2 | S14 (not in this plan) | It is the art. 34.9 working-time export's input (read by `packages/module/src/record-export.ts:7`, `packages/workforce-es/src/record-export.ts:156` and `apps/server/src/personal-data-time-record.ts:40`), not an invoice record. Until S14, S12c fills it with `venueLocationId(tx)`. |
| `apps/server/src/mirror-bundle.ts`, `apps/server/src/mirror-bundle-fetch.ts` | S3 | S18 (not in this plan) | Their four matches fill the module contract's `ProvisionedNode` and `AdoptResult.designated.locationId`, which `adopt.ts:205` needs for the mirror's `trading.env` until S18 removes `NodeConfig.locationId`. The design's "join bundle loses `locationId`" is met inside the fiscal module's dormant state (S3-3). |
| `apps/server/src/table-removal.ts` | S7 | S18 (not in this plan) | Every matching line builds the `{ locationId }` argument of the module contract's `TableRemoval` hooks (`packages/module/src/module.ts:148-174`). |
| `ApplyResult.locationId` (`packages/provisioning/src/venue-apply.ts:61`) | none | S18 (not in this plan) | Read by `persistTrading`, the demo scripts and many test helpers; it goes with `ProvisionedNode.locationId`. |
| The rota warnings query and route: `packages/staffing/src/dashboard/client.ts` (`:147-159`), `packages/staffing/src/dashboard/rota-view.ts` (`:416`), `apps/server/src/workforce-api.ts:133-136`, and the lines that feed them, `packages/staffing/src/rota.ts:85,363` and `staffing-types.ts:113` | S9 (the two dashboard files), S13 (the route) | S13 (not in this plan) | The query sends `?locationId=` to a route that refuses a request without it; `roster.draft_exists`'s detail type is `packages/workforce/src/errors.ts:45`, also thrown by `packages/workforce/src/clocking.ts:314,342`. |
| The restore preview rename `locationName` → `venueName`: `apps/server/src/restore-stream.ts` (`RestoredVenue`, `:46,221`), `apps/server/src/errors.ts` (`restore.stream_venue_unconfirmed`), `apps/server/src/restore-command.ts:509`, `scripts/personal-log-params.test.ts:125`, `apps/setup/src/setup-app.ts:493-496`, `apps/setup/src/screens/restore-bucket-screen.ts` and their tests | S12 (`restore-stream.ts`), S16, S18 (`errors.ts`) | S16 (Task S16c) | One value fed by two slices' files; it is renamed once. S12c keeps only `restore-stream.ts`'s lookup of the restored venue row by no id. |
| The device admission checks `device.locationId !== cfg.locationId` in `line-cancel-api.ts:47`, `order-kitchen-note-api.ts:61-62`, `party-allergy-api.ts:109-110` (S11 files) and the `admit` location refusal in `till-attendance-api.ts:101-102`, `till-clock-api.ts:79-80` (S13 files) | S11, S13 | S12a | `DeviceBinding.locationId` cannot go while any of them reads it; the design gives admission and `admit` to S12. |
| Deleting `GET /management-api/locations` and the dashboard's `getLocations` (`apps/server/src/workforce-api.ts:108-118`, `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/api/live-queries.ts:492`) | S12 | S12d, which depends on S15 | Its last user is `apps/dashboard/src/screens/planned-actual-screen.ts:99`, S15's location picker. |
| `packages/fiscal-verifactu/src/testing/seed.ts`, `test/fixtures.ts`, `test/drain-fixtures.ts`, `test/certificate-diagnosis-parent-fixtures.ts` | F2 by glob | S3 | The file assignment's summary gives them to S3 (S3-1 and S3-4); F2 leaves them. |
| `packages/provisioning/test/first-setup-request.ts`, `start-again-attempt.ts` (S16a), `configuration-bundle.ts` (S17a) | F2 | S16, S17 | They build the setup request and the bundle, whose shapes those slices change. |

## Rules every slice follows

### The fiscal pair

```zsh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad
git diff --exit-code origin/main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts
```

Both runs print a `Tests` line with no failures (read the count; a blank output is not a pass), and
the `git diff` prints nothing and exits 0. **Any change to what a fiscal record or hash contains is
a STOP: tell the owner, do not edit the pair.** No task in this plan edits either file, F tasks
included. S2, S3, S4 and S16 run the pair in every task; other slices run it where their section
says.

### Guard groups (copied from §6)

- **Code guards**, run from the repository root in every code task:
  `pnpm exec vitest run scripts/module-seams.test.ts scripts/live-subscriptions.test.ts scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts scripts/english-only.test.ts`,
  plus the touched packages' focused tests (CI runs the package suites). Read each command's `Tests`
  count and exit status separately (CLAUDE.md §2 and §4).
- **Text guards**: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`,
  `scripts/claude-md-pointers.test.ts`.
- **Schema guards** (not used in this plan; listed for the S20–S28 plan): `scripts/schema-constraints.test.ts`,
  `scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts`,
  `scripts/classification-complete.test.ts`, `scripts/two-file-foreign-keys.test.ts`,
  `scripts/migrations-match-schema.test.ts`, `scripts/migration-upgrade.test.ts` (with the slice's
  `RESETS` entry), `scripts/journal-monotonic.test.ts`, `scripts/id-columns-are-references.test.ts`,
  `scripts/append-only-migration-sets.test.ts`, the `sqlite_master` trigger scan (§4), an
  empty-database migrate, and the fiscal pair.
- Every task also runs `pnpm --filter <pkg> typecheck` for each package it touched (crossings
  included) and `pnpm format:check`. Before a browser-mode run (dashboard, till, setup, the
  fiscal-verifactu browser tests), check free memory (`memory_pressure | grep free`).

### The shared done-check

The design's grep (§6), run in the slice's worktree. The Bash tool's shell is zsh: keep the pattern
in single quotes, pass the path list as an array, and write a ref beside a path as `"${REF}:path"`
(zsh reads `$REF:a…` as a path modifier).

```zsh
P='(^|[^A-Za-z])[Ll]ocations?([^A-Za-z]|$)|[Ll]ocation(Id|_id|Name|[A-Z_])|[a-z]Location'
PATHS=('apps/**' 'packages/**' 'scripts/**' ':!*.test.ts' ':!*.test.mjs' ':!**/drizzle/**' ':!*.md')
# whole tree (S18's done-check):
git grep -n -E "$P" -- "${PATHS[@]}"
# one task: replace PATHS with the task's files, e.g.
FILES=(apps/server/src/venue-time-zone.ts apps/server/src/venue-zone-context.ts)
git grep -n -E "$P" -- "${FILES[@]}"
```

Each task says what its run may still print: `venueLocationId` calls, schema table identifiers
(`locations`, `locationBusinessDaySettings`, `locationDayCutoverChanges`, …) that the schema slices
rename, and named leftovers another slice owns. Anything else is unfinished.

### Global constraints (from the brief and the design)

- No migrations in any slice of this plan; no reset except the host-file resets S3, S4 and S16 name
  in their PR's first line.
- No new `location_id`, `locationId`, per-location view, setting, fixture or translation.
- No backwards-compatibility code (CLAUDE.md §3, last rule: pre-production).
- General code is English only (CLAUDE.md §3).
- Each code slice moves its own callers of `readLocationClock(tx, id)` to `readVenueClock(tx)`, and
  fills a `location_id` column it still writes with `await venueLocationId(tx)`, never from `cfg`, a
  request or another row.
- Each slice updates the words its change makes stale (§5): translation keys move with the code that
  uses them, and a backlog or topic-file entry the change makes untrue is reworded or deleted in the
  same PR.
- Comments: a comment that only says "the location's …" is deleted, or reworded to "the venue's …"
  (CLAUDE.md §1, "Prefer deleting to rewording").

### Cross-location tests are deleted, not rewritten

A test case that exists only to prove a refusal or an isolation between two locations is deleted with
the check it proves (§6: "Each code slice also deletes the tests that exist only to prove a
cross-location refusal"). A case that proves something else as well (for example "an unknown id
**or** another location's row") keeps the other half word for word, with the second location's seed
removed. Each deletion is named (file and title) in the commit and the PR. Any other changed
assertion names the design decision that changes it (§8 risk 7). Nothing else is weakened.

### A database with a second venue row

Once a function reads through the accessor, a test database holding two `locations` rows makes it
throw `provisioning.second_venue`, and one holding none makes it throw `venue.not_found`. **When a
code task routes a reader through the accessor, it runs the touched packages' tests and fixes every
suite that then fails with `provisioning.second_venue` or `venue.not_found`:**

- a case that exists only to prove a cross-location refusal is DELETED with its check, and named in
  the PR (the rule above);
- any other suite is changed to seed one venue — F1's `seedVenue` if F1 has landed, else by reusing
  the first row — without changing an assertion. Never make the accessor pick one row.

Find the suites before running: `git grep -c -E 'insert\((schema\.)?locations\)|seedVenue\(|seedLocation\(|insertLocation\(' -- <test files>`
and read every file that prints 2 or more. Several suites share one database across cases
(`resetPerTest: false`), so a second venue seeded by one case breaks the others: read each file's
result, not only the total. Running `apps/server`'s whole suite locally is heavy: check free memory
first.

**Code slices do not wait for the F slices, and F slices leave second-location cases to the code
slices.**

### Calls into another slice's file

- A slice changes the signature of a reader it owns, and every caller, in the same task: a
  half-changed signature does not compile. It may edit a caller in another lane-landed slice's file
  (argument only); that slice rebases over it. Each task lists the callers outside its slice it edits
  ("crossings").
- **A caller in a file of an owner-landed slice (S2, S3, S4, S16) that has not landed yet is not
  edited by a lane slice.** The reader keeps an ignored parameter for that caller — the `_cfg`
  pattern of `narrowDeviceKitchenScreens` and `assertKitchenDisplayHasScreen`
  (`packages/venue-service/src/kitchen-screens.ts:892,925` at `7e824ae233`): renamed with a leading
  underscore and never read; optional when it is the last parameter, so the slice's other callers can
  already drop it. The owner slice drops the argument when it lands after. Once the owner slice has
  landed, the lane slice edits that call itself, argument only, and names it in its PR.
- Owner-landed slices (S2, S3, S4, S16) may make argument-only edits in lane files, and name them in
  their PR.
- A reader another slice owns keeps its signature in a slice that only calls it: the call is left as
  it is. If the owning slice has already landed, the call has already changed; do not change it twice.
- S18 removes every ignored parameter that is left (see "Notes for S18").

### Exported functions behind a module contract keep their `cfg`

The module contract declares `cfg: { locationId: LocationId }` on the venue-service seat's methods,
the `FloorAnnotator` and the `TableRemoval` hooks (`packages/module/src/module.ts`), and the contract
is S18's. A function the contract binds keeps its `cfg` parameter; when it stops reading
`cfg.locationId` and has no other use for it, it is renamed `_cfg` (TypeScript refuses an unused
parameter otherwise: `error TS6133: 'cfg' is declared but its value is never read`, from
`tsc6 --noEmit --strict --noUnusedParameters` on a two-line probe). Local, non-exported functions
drop the parameter. Where a `cfg` object carries other fields (`TradingContext`, a module's
`ctx.cfg`), the parameter stays and only the `.locationId` read goes.

### Scope-blind tests

A failing test that calls a function with a scope naming a location id that exists nowhere shows the
function no longer reads the scope. It fails before the change. It is marked
`// A1301: deleted with cfg in S18`, because it means nothing once the scope is gone.

## Review focus (failure modes no single task's tests exercise)

1. **A database with two `locations` rows.** The fix is to delete the cross-location case (named) or
   to stop inserting the second row — never to make the accessor pick one.
2. **A saved time zone that is not valid** (`""`, `"Invalid/Zone"`, `" Europe/Madrid"`). A696's zone
   repair must still read it raw; `readVenueClock` returns the stored text unvalidated (S1a pins it).
3. **A database before setup** (no venue row). Readers that used to answer "UTC" or "no address" for
   an unknown id keep their answer for "no venue" only where S1 says so; elsewhere they refuse
   `venue.not_found`.
4. **A codemod rewrite that weakens a test.** F1's codemod only removes location plumbing; a review
   reads each rewritten file's assertions unchanged (`git diff --stat` plus the codemod's report).
5. **Interim parameters and helpers outliving their purpose**: `venueLocationId`, ignored `_cfg` and
   `_locationId` parameters, the optional location parameters of `seedNode`/`seedDevice`, and the
   codemod. Each has a named slice that deletes it (below).

## Execution notes

- Each slice is its own branch and its own PR, named `refactor/a1301-<slice id, lower case>-<short name>`
  (the table above), in a worktree made with
  `python3 ~/workspace/tools/worktree.py new waitron <branch> --headless`.
- Implementers run at medium effort: `subagent_type: "implementer"`. Each task is sized for one
  implementer in well under 100 tool calls; one that passes about 150 calls stops at a passing (or
  cleanly red) point, commits, and hands over.
- **S1 waits for A696 (#2369) to land.** Every slice after it re-runs its grep at its own head before
  starting.
- **Overlap with an open pull request (including #2375, A1268) is never a reason to wait** (owner's
  coordination rule, 2026-11-01): whoever lands second rebases. Each slice lists the open PRs that
  touch its files only so the rebase is expected.
- The watcher hands slices to lanes.
- Every commit is `git commit -s`. Then `/finish-branch` with the worktree path.

## Notes for S18 (contract and type cleanup, not in this plan)

- **Ignored parameters.** `_cfg` and `_locationId` do not match the design's grep, so S18's done-check
  adds `git grep -n -E '_cfg\b|_locationId\b' -- apps packages` printing nothing, after it removes
  `cfg` from the venue-service seat, `VenueScope.locationId` (`packages/venue-service/src/operations.ts:64`),
  the `TableRemoval` hooks' and `FloorAnnotator.annotate`'s argument, every `_cfg`/`_locationId`
  parameter and every caller's argument. That is a large mechanical sweep (107 `configureZone(` test
  call lines alone): budget a codemod task for it.
- Files moved to S18 above: `mirror-bundle.ts`, `mirror-bundle-fetch.ts`, `table-removal.ts`,
  `ApplyResult.locationId`.
- `InvoiceDeliverySale.locationId` (`apps/server/src/invoice-delivery-status.ts`), which S2-3 keeps
  filled from `venueLocationId(tx)` until S10b and S11a drop its readers, and the
  `venueLocationId` line S2-3 adds to `invoice-email-contact.ts` for the venue-service seats' scope.
- The `ctx.locationId` field S10a keeps, ignored, on `claimPrintJobs` for `invoice-print.ts:62` if S2
  has not dropped it.

## Notes for the S13–S15 plans

- S13 takes the rota warnings query and route (table above).
- S14 takes `RecordExportInput.locationId`; S12c fills it with `venueLocationId(tx)` meanwhile.
- S12d starts once S15 has removed `planned-actual-screen.ts`'s `getLocations` watch.
- The dashboard and till attendance/hours fixture helpers (`apps/dashboard/test/{attendance,hours,manager-hours}-fixtures.ts`,
  `apps/till/test/{attendance-fixtures,clock-app,hours-fixtures}.ts`) are API mocks; they change with
  S15.

## Carried to the schema plan (S20–S28)

- **Delete the interim items:** `venueLocationId` (S28); the optional location parameters of
  `seedNode` and `seedDevice` (S25 and S26, with the columns), together with the arguments still
  passed in tests no F task selected (F1's codemod rules 2–3 remove them); `scripts/a1301-seed-codemod.mjs` and
  its test (S28). `seedVenue`'s body changes in S23 (also writes `venue_settings`) and S28 (stops
  writing `locations`).
- **`seedKitchenStation`** still takes a `locationId`; S24 gives it the same "at the venue" default.
- **The `country-es` demo capture** (`packages/country-es/test-fixtures/demo/madrid-before-move.*`) is
  a frozen database capture checked by digest; it is never regenerated. Each schema slice that changes
  `locations` or drops a `location_id` adds a transform in
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (as `RENAMED_COLUMNS`, `ADDED_TABLES`,
  `REMOVED_TABLES` do today). S28 needs a new transform for a table dropped with rows: `REMOVED_TABLES`
  requires the dropped table to have held none (`seed.madrid-baseline.test.ts:125-130`), and
  `locations` held one in the `provisioned` and `seeded` phases.
- **Open design point: what replaces the location id as the backup bucket key.**
  `apps/server/src/restore-stream.ts:217` reads `locations where id = venueId`, where `venueId` is the
  backup settings' venue id (`:180-187`), so the bucket layout is keyed by a `locations.id`. No slice
  says what keys it once S28 drops the table.
- **S17's interim import rule** (a column whose foreign key points at `locations` is set to
  `venueLocationId(tx)`) goes when the columns go; S28's `venueLocationId` grep finds it.
- **Second-location cases the code slices did not reach.** F slices leave every case that seeds a
  second location and list it in their commit; the schema slice that drops that table's `location_id`
  deletes any still standing.
- **The live-query table names** (`location_day_cutover_changes`, `{ type: "locations" }`) and the
  unique-index column lists (`columns: ["location_id", "name"]`) named as leftovers below go with
  S23 and S24.

---

## S1 — The venue accessor

**Goal.** Add the one place the venue's settings are read — `readVenue`, `readVenueClock`,
`readVenueClockAndPlace` — and the interim `venueLocationId`, in `@waitron/db`. Then move the readers
already named "venue" (the server's `venue-*.ts` files, A696's zone context and repair, the venue
settings routes, the business-day start) and reporting's daily-close and overdue-order clocks onto
it, so none of them takes or passes a location id. Rename `location-settings-api.ts` to
`venue-settings-api.ts` and the dashboard's `location_settings.*` keys to `venue_settings.*`.

- **Depends on:** A696 (#2369) landed.
- **Lands:** lane. None of rules a–d applies: the daily-close hash's clock is a hash of its own, not
  an invoice record, and its value does not change (§6). S1 deliberately does not touch the three
  readers whose callers sit on the invoice path (see "Left for S2").
- **Lines** were read at A696's head `7e824ae233`.
- **Branch:** `refactor/a1301-s1-venue-accessor`.
- **Review path:** FULL — a cross-package contract (a new `@waitron/db` API every later slice uses).
- **Guards:** code guards.

### Where the accessor lives: `packages/db/src/venue.ts`

The design names `packages/db/src/venue.ts`; `BusinessDayClock` is not in `packages/reporting` but in
`@waitron/shared` (`packages/shared/src/business-day-clock.ts:4`), which `@waitron/db` already
depends on. So the accessor can live in `@waitron/db` with no new dependency. It must: `@waitron/core`,
`@waitron/workforce`, `@waitron/bookings`, `@waitron/fiscal` and others depend on `@waitron/db` but
not on `@waitron/reporting` (checked by reading every `packages/*/package.json`'s `dependencies`), so
an accessor in reporting would be out of their reach. `@waitron/db` cannot import
`@waitron/reporting` (reporting depends on db; `scripts/workspace-cycles.test.ts` refuses a loop,
test-only dependencies included — CLAUDE.md §3). Consequence for the tests: the case comparing
`readVenueClock` with reporting's `readLocationClock` lives in `packages/reporting`, not in
`packages/db`.

### API (other slices rely on these exact names)

```ts
// packages/db/src/venue.ts, exported from packages/db/src/index.ts
export interface Venue {
  name: string;
  invoiceLocales: string[];
  operationDescription: string;
  fiscalTerritory: string;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  timeZone: string;            // as stored, never validated (A696 repairs invalid ones)
  dayCutover: string;          // as stored: "HH:MM:SS"
  defaultCatalogueId: string | null; // today's locations.catalogue_id
}
export interface VenuePlace { province: string | null; city: string | null }

export function readVenue(tx: Transaction): Promise<Venue>;
export function readVenueClock(tx: Transaction): Promise<BusinessDayClock>;
export function readVenueClockAndPlace(
  tx: Transaction,
): Promise<{ clock: BusinessDayClock; place: VenuePlace }>;
/** Interim, until S28: the single `locations` row's id, for code that must still fill a
 *  `location_id` column. */
export function venueLocationId(tx: Transaction): Promise<string>;
```

- Until S23 every function reads the single `locations` row (and, for the clock,
  `location_day_cutover_changes` ordered by `effective_business_day`, each `dayCutover` turned from
  `HH:MM:00` into `HH:MM` as `readLocationClockAndPlace` does today,
  `packages/reporting/src/business-day.ts:153-207`). `readVenueClock` validates nothing.
- **Refusals, the same in all four functions:** no `locations` row → `AppError("venue.not_found", {})`;
  two or more rows → `AppError("provisioning.second_venue", {})`. Read with one
  `select id from locations limit 2`.
- **Error codes.** `venue.not_found` is new, declared in `packages/db/src/errors.ts` as
  `Record<string, never>`; it means "this database has no venue yet" (setup has not run). It names
  the domain (`venue.*`), not the package (CLAUDE.md §3; `packages/shared/src/errors.ts` header).
  `provisioning.second_venue` already exists (`packages/provisioning/src/errors.ts:65`) and keeps its
  name and meaning (§3); `@waitron/db` cannot import provisioning, so `packages/db/src/errors.ts`
  declares it again with identical params, as it already does for `setup.request_invalid` ("Declared
  with identical params in `apps/server/src/errors.ts`"). `venue.ts` imports `"./errors.js"`, which
  the barrel already reaches (`scripts/errors-reachable.test.ts`). No dashboard wording is added:
  neither code can reach a screen on a box that has been set up.
- **Why `string`, not `LocationId`, from `venueLocationId`:** S18 deletes the `LocationId` type before
  S28 deletes this helper. A caller that needs the brand (today's venue-service functions) writes
  `locationId(await venueLocationId(tx))`.
- A `Database` handle is assignable to `Transaction` (`withTransaction` calls `fn(db)`,
  `packages/db/src/tenancy.ts:30-42`), so test helpers may pass `db` directly.

### Files

The TSV's 18 S1 files, at A696's head (`git grep -n -E "$P" "${REF}" -- <file>`), and what changes:

| File | Matches | What changes |
| --- | --- | --- |
| `packages/db/src/venue.ts` | new | the API above |
| `packages/db/src/errors.ts` | — | declares `venue.not_found` and `provisioning.second_venue` |
| `packages/db/src/index.ts` | — | exports the four functions and two types |
| `packages/reporting/src/business-day.ts` | 27 | `resolveVenueClock(tx, nodeId)` keeps its node check and returns `readVenueClock(tx)` (no `nodes.location_id` read); `readLocationClock`, `readLocationClockAndPlace`, `LocationPlace` stay for S18 |
| `packages/reporting/src/index.ts` | 3 | unchanged (the three exports above stay for S18) |
| `packages/reporting/src/overdue-orders.ts` | 2 | `:131-136` reads the node's location to call `orderTableLabels`; passes `await venueLocationId(tx)` instead (S7 then drops the parameter) |
| `packages/reporting/src/record-daily-close.ts` | 1 | `:40` message "must match the node location" → "must match the venue's time zone" |
| `apps/server/src/venue-locale.ts` | 41 | `readVenueLocale(db, { override? })`, `readVenueContentLanguageRules(db)`, `readVenueReceiptLanguageRules(tx)` take no location; `geographyIn(tx)` reads `readVenue`; **left for S2 (Task S2-5)**: `locationLanguageIn`, `readOfferedReceiptLanguages`, `saleLanguageFor` |
| `apps/server/src/venue-time-zone.ts` | 9 | `readVenueTimeZone(db)`; "UTC" when `venue.not_found` (as today for a missing row) or the zone is unknown |
| `apps/server/src/venue-address.ts` | 19 | `LocationAddress` → `VenueAddress` (a type name only, shared with `addressLines` and `receiptAddressLines`); `readReceiptAddress(tx, receipt)` takes the address from `readVenue`; **left for S2 (Task S2-5)**: `readLocationAddress` and its private `readAddress`, which S2 replaces with `readVenueAddress(tx)` |
| `apps/server/src/venue-details.ts` | 19 | `readVenueDetails(tx, at?)`, `writeVenueDetails(tx, input, at?)`; reads `readVenue`; writes `locations`/`locationBusinessDaySettings` keyed by `await venueLocationId(tx)`; `"locationId"` leaves `readOnlyVenueFields`; the two `management.request_invalid { field: "locationId" }` refusals (`:82-89`) become `venue.not_found` |
| `apps/server/src/business-day-start.ts` | 26 | `Scope` type goes; `readBusinessDayClockModel(tx, at)`, `previewBusinessDayStart(tx, input, at)`, `writeBusinessDayStart(tx, input, at)`; `readVenueClock`; the `n.location_id = …`/`w.location_id = …` filters at `:125-133` go (one venue holds every node and order); writes keyed by `await venueLocationId(tx)`; `VENUE_SERVICE.assertBusinessDayClockChange` gets `{ locationId: locationId(await venueLocationId(tx)) }` until S8 |
| `apps/server/src/location-settings-api.ts` | 30 | renamed `venue-settings-api.ts`, `mountLocationSettingsApi` → `mountVenueSettingsApi`, `deps.cfg` goes; receipt language read from `readVenue(tx).invoiceLocales` and written by `venueLocationId`; `ordersBlockingReceiptLanguage` counts every open order (no location filter); `withTaxpayer`/`storedLanguages` refuse `venue.not_found` (boundary maps it to 409) instead of `management.request_invalid { field: "locationId" }` |
| `apps/server/src/venue-zone-context.ts` | 19 | `ZoneContext.locationId` goes; node check (reason `node`) stays; the `mismatch` and `location` refusals go (§2.4); venue fields from `readVenue`, clock from `readVenueClock`; no taxpayer row → `venue.not_found`; revision read from `location_business_day_settings` with no filter (its key is the location id, so one venue has at most one row) |
| `apps/server/src/venue-zone-repair.ts` | 8 | writes keyed by `await venueLocationId(tx)`; `locationId` leaves the view and the `venue.time_zone_repaired` incident params |
| `apps/dashboard/src/screens/appearance-screen.ts`, `department-receipt-editor.ts`, `venue-defaults-panel.ts`, `venue-details-panel.ts`, `venue-privacy-panel.ts` | 1, 6, 1, 1, 1 | `location_settings.*` → `venue_settings.*`; `department-receipt-editor.ts:269`'s `{ type: "locations" }` live-query table name stays for S23 |
| `apps/dashboard/src/screens/business-day-start-editor.ts` | 2 | nothing: both lines are the live-query table name `location_day_cutover_changes`, which S23 renames |

Files outside the TSV's S1 list that S1 edits, each only at the named call site:

- `apps/server/src/boot.ts` (S18's file): `:1773` `readVenueLocale`, `:1817`/`:2251` `readVenueTimeZone`,
  `:1946` `readVenueContentLanguageRules`, `:2268` the settings mount, `:219` its import. `:1779`'s
  `scope` keeps its `locationId` (it is `IssueScope`, S2's type).
- `apps/server/src/receipt-print.ts:214` (S10), `receipt-preview-api.ts:381` (S11):
  `readReceiptAddress(tx, receipt)`.
- `apps/server/src/errors.ts:59-67`: `locationId` out of `venue.time_zone_repaired`.
- `apps/dashboard/src/api/client.ts:85`: `locationId` out of `ZoneRepairView`.
- `apps/dashboard/src/i18n/strings.ts:586-595` and `:4347-4356`: the 16 `location_settings.*` lines
  renamed; "The location settings could not be loaded." → "The venue settings could not be loaded."
  (Spanish already says "del local", unchanged) — §2.5.
- `apps/server/test-durations.json:620-621`: the two renamed test files' keys.

Named by the design but with nothing to change: `venue-zone-repair-api.ts` and `zone-repair-serving.ts`
(no match; they pass `IssueScope` through, which S2 changes); A696's
`apps/dashboard/src/screens/venue-zone-repair.ts` (its only match is `location.reload()`).

**Left for S2, on purpose.** `readOfferedReceiptLanguages` and `saleLanguageFor` (`venue-locale.ts`)
are called from `till-sale.ts:938,999,1633,1812`, `bill-payments.ts:722` and `working-order.ts:7090`,
and `readLocationAddress` (`venue-address.ts`) from `receipt-presentation.ts:39` — files on the path
that stores and prints an invoice record (rule a). Changing their signatures would make S1
owner-landed. Task S2-5 converts the three and every caller (also `department-receipt-api.ts:87`,
`department-receipt-languages.ts:27`, `tender-refund-api.ts:222`, `till-setup.ts:83`,
`transaction-receipt-api.ts:64`, `working-order.ts:4476`), then deletes `readLocationAddress` in
favour of a new `readVenueAddress(tx)`. S1 touches neither the three readers nor their callers.

### Task S1a — the accessor, and reporting's clocks

**Files:** Create `packages/db/src/venue.ts`, `packages/db/src/venue.test.ts`. Modify
`packages/db/src/errors.ts`, `packages/db/src/index.ts`, `packages/reporting/src/business-day.ts`,
`overdue-orders.ts`, `record-daily-close.ts`, `packages/reporting/src/business-day.test.ts`.

**Interfaces — Produces:** the API above.

- [ ] **Step 1: Write the failing tests.** In `packages/db/src/venue.test.ts`
  (`useVenueDb({ migrations: [CORE_MIGRATIONS] })`, rows inserted with `insert(locations)` directly —
  this is the accessor's own test):
  - "reads the one venue's settings": insert a row setting every column the `Venue` interface names
    to a non-default value (`timeZone: "Atlantic/Canary"`, `dayCutover: "04:30:00"`,
    `fiscalTerritory: "ES-canary"`, a catalogue for `catalogueId`); `expect(await withTransaction(db, readVenue)).toEqual({...all twelve keys})`
    (`toEqual`, not `toMatchObject`, so a missing key fails).
  - "reads the clock as stored, cutovers in date order as HH:MM": insert the row plus two
    `location_day_cutover_changes` rows in reverse date order; `readVenueClock` equals
    `{ timeZone: "Atlantic/Canary", dayCutover: "04:30", cutoverChanges: [earlier, later] }`, and
    `readVenueClockAndPlace` adds `place: { province, city }`.
  - "returns a saved zone that is not valid as it is": `timeZone: "Invalid/Zone"` → the clock's
    `timeZone` is `"Invalid/Zone"`.
  - "returns the venue's row id": `venueLocationId` equals the inserted id.
  - `it.each([readVenue, readVenueClock, readVenueClockAndPlace, venueLocationId])`: "refuses with
    no venue" → `rejects.toMatchObject({ code: "venue.not_found" })`; "refuses with two venues" (two
    rows inserted) → `{ code: "provisioning.second_venue" }`.
  In `packages/reporting/src/business-day.test.ts`, inside `describe("readLocationClock")`, add
  "readVenueClock reads what readLocationClock reads for the one location": one row with
  `Atlantic/Canary`, `04:30:00`, province and city, and two cutover changes inserted out of order;
  `expect(await readVenueClockAndPlace(tx)).toEqual(await readLocationClockAndPlace(tx, id))` and the
  same for `readVenueClock`/`readLocationClock`; then, so two equally wrong readers cannot pass,
  `expect(clock.cutoverChanges.map((c) => c.effectiveBusinessDay))` equals the sorted dates and
  `clock.dayCutover` is `"04:30"`. Add "resolveVenueClock refuses an unknown node" (plain Error
  `reporting: no node <id>`, as today) if no case pins it yet.
- [ ] **Step 2: Run** `pnpm --filter @waitron/db exec vitest run src/venue.test.ts` and
  `pnpm --filter @waitron/reporting exec vitest run src/business-day.test.ts` — FAIL: `./venue.js`
  does not exist; `readVenueClock` is not exported by `@waitron/db`.
- [ ] **Step 3: Implement** `venue.ts` and the two error declarations, each with a one-line comment
  saying what the code means (`venue.not_found` outlives `venueLocationId`: from S23 it is the refusal
  when `venue_settings` has no row). Export from `index.ts`.
  `resolveVenueClock` keeps its `nodes` existence check and returns `readVenueClock(tx)`;
  `overdue-orders.ts` passes `await venueLocationId(tx)` to `orderTableLabels`; fix the message at
  `record-daily-close.ts:40` (grep the tests for the old text first; none matched at
  `abfe271663`).
- [ ] **Step 4: Run** both commands again — PASS. Then
  `pnpm --filter @waitron/reporting exec vitest run` (the package is small),
  `pnpm --filter @waitron/db typecheck`, `pnpm --filter @waitron/reporting typecheck`, and from the root
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/workspace-cycles.test.ts`.
- [ ] **Step 5: Done-check** on `packages/reporting/src/{business-day,overdue-orders,record-daily-close,index}.ts`
  — may print only `readLocationClock`, `readLocationClockAndPlace`, `LocationPlace` and their query
  (S18), the `locations`/`locationDayCutoverChanges` table identifiers (S23), and `venueLocationId`.
  `pnpm format:check`. Commit: `git commit -s -m "db: one reader for the venue's settings and clock, and an interim helper for its row id"`.

### Task S1b — the venue readers and A696's zone code

**Files:** Modify `apps/server/src/venue-locale.ts`, `venue-time-zone.ts`, `venue-address.ts`,
`venue-zone-context.ts`, `venue-zone-repair.ts`, `errors.ts` (`:59-67`), `boot.ts` (`:1773`,
`:1817`, `:1946`, `:2251` only), `receipt-print.ts:214`, `receipt-preview-api.ts:381`;
`apps/dashboard/src/api/client.ts:85`. Tests:
`apps/server/src/venue-locale.test.ts`, `venue-time-zone.test.ts`, `venue-address.test.ts`,
`venue-zone-context.test.ts`, `venue-zone-repair.test.ts`, `venue-zone-repair-api.test.ts`,
`boot.box-emails.test.ts`, `boot.zone-admission.test.ts`, `zone-clock-stop-interaction.test.ts`, and
the dashboard's `screens/venue-zone-repair{,.a11y,.unsaved}.test.ts` and `api/venue-zone-repair.test.ts`.

**Interfaces — Consumes:** S1a's API. **Produces:** `readVenueLocale(db, { override?: string })`,
`readVenueContentLanguageRules(db)`, `readVenueReceiptLanguageRules(tx)`, `readVenueTimeZone(db)`,
`readReceiptAddress(tx, receipt)`, `type VenueAddress`,
`ZoneContext` without `locationId`, `ZoneRepairView` without `locationId`.

- [ ] **Step 1: Write the failing tests** (change the existing ones to the new signatures first):
  - `venue-time-zone.test.ts`: "reads the venue's stored time zone" calls `readVenueTimeZone(suite.db)`;
    "uses UTC when no venue is set up" runs on a database with no `locations` row (replaces
    `:33` "uses UTC when the location is missing", which passed a random id — same answer, the
    missing thing is now the venue); "uses UTC for an invalid stored zone" (`:36-52`) updates the one
    row's zone instead of inserting a second row (a second row would now refuse).
  - `venue-address.test.ts`: `readReceiptAddress(tx, receipt)` reads the one venue's address (the
    receipt's `printAddress` switch still decides); a database with no venue makes it refuse
    `venue.not_found`. The `readLocationAddress` cases stay as they are (S2-5's).
  - `venue-locale.test.ts`: the geography readers take no location; their expected locales unchanged.
    The `readOfferedReceiptLanguages` case at `:202-209` stays as it is (S2's).
  - `venue-zone-context.test.ts`: `toEqual` at `:83-91` loses `locationId` from the expected context;
    the no-taxpayer case (`:152-158`) expects `{ code: "venue.not_found" }` instead of reason
    `location` (§2.4: no code throws reason `location` after S1 and S2). Add "refuses with no venue
    row" → `venue.not_found`.
  - `venue-zone-repair.test.ts` / `venue-zone-repair-api.test.ts`: the repaired incident's params and
    the view no longer carry `locationId` (`toEqual` on the params, so a leftover key fails).
  - Dashboard fixtures (`screens/venue-zone-repair*.test.ts`: `locationId: "location"`) lose the key.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/venue-time-zone.test.ts src/venue-address.test.ts src/venue-locale.test.ts src/venue-zone-context.test.ts src/venue-zone-repair.test.ts src/venue-zone-repair-api.test.ts`
  — FAIL (argument counts, the extra `locationId` in results, `reason: "location"` still thrown).
- [ ] **Step 3: Delete the cross-location tests** (each exists only to prove a location check S1
  removes): `venue-zone-context.test.ts:111-115` ("resolves the location from the writing node when
  no configured location is supplied"), `:124-133` ("refuses a configured location that differs
  from the writing node"), `:134-151` ("refuses a node whose saved location no longer exists"). The
  unknown-node case (`:116-123`, reason `node`) stays unedited. Re-read the line numbers at S1's head
  before deleting.
- [ ] **Step 4: Implement** the signatures above and the call sites listed in Files. Keep
  `readZoneContext(tx, scope: IssueScope)`'s signature (S2 changes `IssueScope`); it ignores
  `scope.locationId`.
- [ ] **Step 5: Run** step 2's command, then
  `pnpm --filter @waitron/server exec vitest run src/boot.zone-admission.test.ts src/boot.box-emails.test.ts src/zone-clock-stop-interaction.test.ts src/zone-restored-boot.test.ts src/receipt-print.test.ts src/receipt-preview-api.test.ts`
  (any of these that does not exist at S1's head is skipped by name; read the `Tests` count). A
  failure `provisioning.second_venue` or `venue.not_found` is handled by the header's rule "A
  database with a second venue row". Check free memory, then
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/venue-zone-repair.test.ts src/screens/venue-zone-repair.a11y.test.ts src/screens/venue-zone-repair.unsaved.test.ts src/api/venue-zone-repair.test.ts`.
  `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/dashboard typecheck`; from the
  root `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts scripts/english-only.test.ts`.
- [ ] **Step 6: Done-check** over this task's five `venue-*.ts` files — may print only
  `locationLanguageIn`, `readOfferedReceiptLanguages`, `saleLanguageFor` and their `locations`
  query (S2), `readLocationAddress` and its query (S2), table identifiers (`locations`,
  `locationBusinessDaySettings`, `locationDayCutoverChanges`; S23), and `venueLocationId` calls.
  `pnpm format:check`. Commit: `git commit -s -m "server: the venue readers and the zone repair read the venue, not a location id"`.

### Task S1c — the venue settings routes and the business-day start

**Files:** Modify `apps/server/src/venue-details.ts`, `business-day-start.ts`; rename
`location-settings-api.ts` → `venue-settings-api.ts` (`git mv`); `boot.ts:219,2268`;
`apps/server/test-durations.json:620-621`. Tests: rename `location-settings-api.test.ts` →
`venue-settings-api.test.ts` and `location-settings-api.orders-open.test.ts` →
`venue-settings-api.orders-open.test.ts`; update the call sites in `venue-details.test.ts`,
`business-day-start.test.ts`, `venue-details-api.test.ts`, `venue-legal-name-api.test.ts`,
`venue-privacy-api.test.ts`, `venue-defaults-permission.test.ts`, `attendance-cutover-settings.test.ts`,
`business-day-history.test.ts`, `business-day-persistence.test.ts`, `backup-sweep.test.ts`,
`catalogue-api.test.ts`, `cloud-snapshot-worker.test.ts`, `configuration-transfer.test.ts`,
`print-api.test.ts`, `taxpayer-rename.filing.test.ts`, `till-api.receipt.test.ts`,
`till-sale-integrated.test.ts` (each calls `readVenueDetails`, `writeVenueDetails`, a business-day
start function or the settings mount — counted with
`git grep -c -E 'readVenueDetails\(|writeVenueDetails\(|readBusinessDayClockModel\(|previewBusinessDayStart\(|writeBusinessDayStart\(|mountLocationSettingsApi|location-settings-api' -- 'apps/server/**/*.test.ts'`:
19 files, 129 lines, `venue-details.test.ts` 71 of them).

**Interfaces — Consumes:** S1a. **Produces:** `readVenueDetails(tx, at?)`,
`writeVenueDetails(tx, input, at?)`, `readBusinessDayClockModel(tx, at)`,
`previewBusinessDayStart(tx, input, at)`, `writeBusinessDayStart(tx, input, at)`,
`mountVenueSettingsApi(app, { db, fiscal, now?, readBackupDeadlines? }, log)`.

- [ ] **Step 1: Write the failing tests.** Change every call site above to the new signatures (most
  drop a `{ locationId }`/`cfg` argument). Then:
  - `venue-settings-api.test.ts`: the mount takes no `cfg`.
  - `venue-privacy-api.test.ts:190-198` ("no taxpayer row"): expect 409
    `{ error: { code: "venue.not_found", params: {} } }` instead of 400
    `management.request_invalid { field: "locationId" }` — §1, nothing passes a location id, so a
    refusal cannot name one. The test's purpose (both routes refuse and write nothing) stays.
  - `venue-details.test.ts:355`, `venue-details-api.test.ts:119`, `venue-legal-name-api.test.ts:107`:
    drop `"locationId"` from the read-only field lists (the field no longer exists, §1); the other
    fields' assertions unchanged.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/venue-details.test.ts src/business-day-start.test.ts src/venue-settings-api.test.ts src/venue-privacy-api.test.ts`
  — FAIL (signatures; the new refusal code).
- [ ] **Step 3: Delete the cross-location tests:** `business-day-start.test.ts:729-760` ("keeps
  another location's clock rows isolated and rejects a client-selected location"),
  `location-settings-api.orders-open.test.ts:187-209` ("does not count an open order holding a line
  at another location"), `location-settings-api.test.ts:559-575` ("refuses a read and a write when
  the configured location does not exist"), `venue-details.test.ts:699-706` ("refuses a missing
  deployed location"), `venue-details-api.test.ts:222-234` ("refuses a location identifier on the
  envelope and keeps the deployed location"). A body naming `locationId` is still refused, now as
  `venue.detail_invalid` / `venue.business_day_invalid` `unknown_field`, which the unknown-key cases
  already pin (check one exists in each file; add one if not).
- [ ] **Step 4: Implement** per the Files table. Map `venue.not_found` to 409 in the settings
  route's error boundary.
- [ ] **Step 5: Run** every test file listed under Files with
  `pnpm --filter @waitron/server exec vitest run <files…>` (two or three runs; read each `Tests`
  count). `provisioning.second_venue` and `venue.not_found` failures: the header's rule "A database
  with a second venue row". `pnpm --filter @waitron/server typecheck`.
- [ ] **Step 6: Done-check** over `venue-details.ts`, `business-day-start.ts`, `venue-settings-api.ts`
  — may print only table identifiers (`locations`, `locationBusinessDaySettings`,
  `locationDayCutoverChanges`; S23), `venueLocationId` calls, and the `locationId(...)` brand around
  one of them in the venue-service call (S8). `git grep -n location-settings-api` prints nothing.
  `pnpm format:check`. Commit: `git commit -s -m "server: the venue settings routes and the business-day start read the venue"`.

### Task S1d — dashboard keys `location_settings.*` → `venue_settings.*`

**Files:** `apps/dashboard/src/i18n/strings.ts` (16 lines), `screens/appearance-screen.ts:126`,
`department-receipt-editor.ts:438,445,546,631,742`, `venue-defaults-panel.ts:387`,
`venue-details-panel.ts:676`, `venue-privacy-panel.ts:377`; tests
`screens/department-receipt-editor.test.ts`, `department-receipt-editor.retained.test.ts` (3 key
lines each; `git grep -c location_settings -- apps packages`).

- [ ] **Step 1: Write the failing test.** In `department-receipt-editor.test.ts`, change the expected
  keys to `venue_settings.*` and assert the English load-error text "The venue settings could not be
  loaded." where the file already reads that message (if it does not, assert it in the strings
  test that covers dashboard wording). Run
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/department-receipt-editor.test.ts` —
  FAIL.
- [ ] **Step 2: Rename** the keys in both language tables and every user; reword the one English
  string (§2.5). Spanish text unchanged.
- [ ] **Step 3: Run** the two editor tests plus `pnpm --filter @waitron/dashboard typecheck` (the
  `t()` key type refuses a key that no longer exists). Check free memory first.
- [ ] **Step 4: Done-check** over the six dashboard files — may print only
  `department-receipt-editor.ts:269` `{ type: "locations" }` and `business-day-start-editor.ts:172,178`
  `location_day_cutover_changes` (live-query table names, S23). `git grep -n location_settings -- apps packages`
  prints nothing. `pnpm format:check`. Commit:
  `git commit -s -m "dashboard: venue settings, not location settings"`.

### S1 open PRs touching the same files

`gh pr list --state open --json number,headRefName,files` on 2026-11-01 (main `abfe271663`; the
`files` list is capped at 100, so #2369 and #2373 were re-read with `gh pr diff <n> --name-only`):

- #2369 `feat/a696-startup-zone-validation` — S1's base: lands first.
- #2373 `feat/w41s7-conflict-recovery` — `apps/server/src/boot.ts`, `apps/server/src/errors.ts`.
- #2377 `chore/a1008-retire-sale-script` — `apps/server/test-durations.json`.

---

## F1 — The seed helpers, and `packages/db`'s tests on them

**Goal.** Make `packages/db/src/testing/seed.ts` the one place a test gets the taxpayer and venue
rows, a node, a device and a working order, with helpers that fill `location_id` themselves through
the single venue row; write a codemod that rewrites the common shapes; and move `packages/db`'s own
tests onto the helpers. F2–F5 reuse the codemod for every other package. After the reset window the
schema slices change the helpers' bodies, not the tests.

- **Depends on:** S1 (needs `venueLocationId` and the `Venue` type).
- **Lands:** lane (tests and test helpers only; no rule a–d).
- **Branch:** `refactor/a1301-f1-seed-helpers`.
- **Review path:** FULL — the helpers are a cross-package contract F2–F5 build on, and a codemod
  rewriting tests is where an assertion could be weakened unseen (§8 risk 7). The fiscal pair is not
  needed: no `packages/fiscal-verifactu` file changes.
- **Guards:** code guards (for the codemod's root suite: `scripts/english-only.test.ts`).
- **Lines** were read at main `abfe271663`; measured sizes at `0e206d34b2`.

### Measured size

From `file-assignment-summary.md` §5 (`scripts/fixtures.sh` at `0e206d34b2`), re-checked with
`/usr/bin/grep -c '^packages/db/' fa/fx-loc.txt` and the same on `fx-any.txt`/`fx-insert.txt`:

| What | packages/db test files |
| --- | --- |
| insert `locations` (`git grep -l -E 'insert\((schema\.)?locations\)' -- 'packages/db/*.test.ts'`) | 62 |
| insert `nodes`, `devices` or `workingOrders` | 24 |
| raw `insert into locations` | 2 (`backup-evidence.test.ts`, `change-log.test.ts`) |
| any of those, or naming `locationId`/`location_id` | 66 (15 in `src/`, 50 in `src/schema/`, 1 `src/testing/seed.test.ts`) |
| call `seedNode(`/`seedDevice(` (`git grep -l -E 'seed(Node|Device)\(' -- 'packages/db/*.test.ts'`) | 32 |

How much a codemod reaches, by a shell count over the 62 files (each file's `insert(locations)`
count, and whether the 4 lines after it set `id:`): 55 insert the row once; **50 set an explicit
id**, almost always a module constant (`const LOCATION = "aaaaaaaa-…"`) that the file then uses for
other tables' `location_id`. So the codemod must handle the constant, not only the insert.

Across the workspace the helpers are already used widely (`git grep -l -E 'seedNode\(' -- apps packages scripts`:
190 files; `seedDevice(`: 97 files), so their location parameters cannot be removed in F1: F2–F5
remove the arguments in the files they select, and the schema plan removes the parameters and any
argument left.

### Helper API (`packages/db/src/testing/seed.ts`; F2–F5 and the schema plan rely on these)

```ts
/** Writes the taxpayer row (seedTenant) and the one venue. Refuses (plain Error) when a venue row
 *  already exists. Defaults: name "Test venue", invoiceLocales ["es"], operationDescription
 *  "Restaurant"; every other column its schema default. */
export function seedVenue(db: Database, overrides?: Partial<Venue>): Promise<void>;

/** One node; at the venue unless `location` is given (interim: only for a test that keeps a
 *  second location row until its schema slice deletes the case). */
export function seedNode(db: Database, location?: LocationId): Promise<NodeId>;

/** As today, with `locationId` now optional: omitted, the device is at the venue. */
export function seedDevice(db: Database, opts?: {
  locationId?: LocationId | string; label?: string;
  formFactor?: …; capabilities?: string[]; profileId?: string;
}): Promise<{ deviceId: DeviceId; profileId: string }>;

/** One working order at the venue. Defaults: source "dashboard", orderNumber 1 (a non-device
 *  source needs no device under `originChecks`). Returns the inserted row. */
export function seedWorkingOrder(
  db: Database,
  values?: Partial<Omit<typeof workingOrders.$inferInsert, "locationId">>,
): Promise<typeof workingOrders.$inferSelect>;
```

`seedVenue` maps `defaultCatalogueId` to `locations.catalogue_id`. Tests that still need the venue's
row id for a column a later schema slice drops (a station's, a printer's, a floor zone's
`location_id`) read it with `await venueLocationId(db)`; no helper returns or accepts a venue id.
`seedKitchenStation` is left as it is (a core table, S24's fixtures).

### The codemod: `scripts/a1301-seed-codemod.mjs`

A Node script using the TypeScript compiler API (the root's `typescript`, version 6 API) to find
nodes, then splicing source text so formatting outside each edit is untouched; `prettier --write`
tidies afterwards. Exports `transformSource(path, source) → { output, edits, left }` for its test and
a `main(argv)`: `node scripts/a1301-seed-codemod.mjs [--write] <file…>`; without `--write` it prints
the report and writes nothing. It reads `.ts` and `.mjs` files. It is a `.mjs` under `scripts/`, so
the root project measures its coverage at 98/98/98/95 (`vitest.config.ts` `include:
["scripts/**/*.mjs", …]`) and the pre-push hook runs it with the root guards: its test must reach
every branch.

**What it rewrites** (each only when the file holds exactly one `locations` insert in total, counting
raw SQL `insert into locations`; with two or more, every location rule below is skipped for that
file and the file is reported):

1. **The venue row.** `await R.insert(locations).values({…})` — `locations` or `schema.locations`,
   one object literal whose keys are all `Venue` field names plus `id` and `catalogueId`, the chain
   optionally ending `.returning(…)` or `.onConflictDoNothing(…)` — as an expression statement, or as
   `const [B] = await <chain>` → `await seedVenue(R, {…})` with `id` dropped and `catalogueId`
   renamed `defaultCatalogueId` (no second argument when nothing is left).
   - `id: X` where `X` is a module-level `const X = <expression>`: if `X` still has references after
     rules 2–4, the declaration becomes `let X: string;` and `X = await venueLocationId(R);` is
     inserted after the `seedVenue` statement; if it has none, the declaration is deleted.
   - `const [B] = …`: kept only if `B` has no reference left after rules 2–4 (the statement becomes
     plain `await seedVenue(…)`); otherwise reported.
2. **Nodes.** `seedNode(R, A)` → `seedNode(R)`.
3. **Devices.** `seedDevice(R, { locationId: A, …rest })` (also shorthand `{ locationId }`) →
   `seedDevice(R, { …rest })`, or `seedDevice(R)` when nothing is left.
4. **Orders.** `await R.insert(workingOrders).values({ …, locationId: A, … })` — one object literal,
   `workingOrders` or `schema.workingOrders` — as an expression statement → `await seedWorkingOrder(R, {…rest})`;
   as `const [B] = await <chain>.returning(…)` → `const B = await seedWorkingOrder(R, {…rest})`.
5. **Imports.** Adds `seedVenue`/`seedWorkingOrder` to the file's existing seed import, or a new one
   (`@waitron/db/testing/seed.js` outside `packages/db`; the relative `testing/seed.js` path inside
   it); adds `venueLocationId` from `@waitron/db` (relative `venue.js` inside `packages/db`) when rule
   1 inserted it. Removes an import specifier the rewrite left with no reference (`locations`,
   `workingOrders`, the `locationId`/`LocationId` brand helpers).

**What it reports and leaves** (file:line and a reason, for hand edits):

- a second `locations` row (any cross-location case);
- `.values([…])` arrays, spread elements, computed keys, keys outside the `Venue` set (`bumpMode`,
  `fireControl`);
- raw SQL `insert into locations`;
- raw `insert(nodes)` / `insert(devices)` (rule-less on purpose: in a table's own schema test they
  test that table);
- a `const [B]` whose `B` is still referenced;
- an `id:` that is not a module-level `const`;
- a file that writes its own `tenants` row (`insert(tenants)` / `insert into tenants`): `seedVenue`
  writes one too, so the order must be read by hand;
- a file that defines its own `seedVenue` (`function seedVenue` or `const seedVenue`): the codemod
  adds no import there. The F task whose glob holds the file replaces the local definition by hand
  (the table under "The fixture slices F2–F5"); F1a does `packages/db/src/testing/seed.test.ts`;
- a fiscal pair file (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`, the `inmutabilidad`
  suite): never rewritten, whatever it matches.

**Hand-edit recipes** (in each F slice's PR body, every left site is listed with what was done):

- `B` still referenced (`location!.id`): `const venueId = await venueLocationId(R)` after `seedVenue`,
  and replace the references.
- Raw `insert(nodes)`/`insert(devices)` outside that table's own schema test → `seedNode`/`seedDevice`.
  Inside `schema/nodes.test.ts`, `schema/devices*.test.ts`, `schema/orders*.test.ts`, keep the raw
  insert and take its `locationId` from `venueLocationId`.
- A second location row: the first row goes through `seedVenue`; the second stays a raw insert, and
  calls that use it keep their explicit location argument. The schema slice that drops that table's
  `location_id` deletes the case.
- A test whose purpose is the `locations` table or its side tables (the invoice-locales check, the
  change feed's `locations` source, the business-day side tables, `location_catalogues`) is left
  whole: S23 replaces those tables.

### Task F1a — the helpers

**Files:** Modify `packages/db/src/testing/seed.ts`, `packages/db/src/testing/seed.test.ts`.

**Interfaces — Consumes:** `venueLocationId`, `Venue` (S1). **Produces:** the helper API above.

- [ ] **Step 1: Write the failing tests** in `seed.test.ts` (its `afterEach` already empties the
  tables; add `working_orders`):
  - "seedVenue writes the taxpayer and the one venue": after `seedVenue(db, { name: "Casa", timeZone: "Atlantic/Canary" })`,
    `readTenant` is non-null and `readVenue(db)` `toEqual`s the defaults plus the two overrides.
  - "seedVenue refuses a second venue": a second call rejects with a message naming the existing row.
  - "seedNode with no location puts the node at the venue": the node's `location_id` equals
    `venueLocationId(db)`.
  - "seedDevice with no locationId puts the device at the venue": same for `devices`.
  - "seedWorkingOrder writes an open order at the venue": returned row has `status: "open"`,
    `source: "dashboard"`, `orderNumber: 1`, `locationId` equal to the venue's id; overrides
    (`orderNumber: 7`, a `nodeId`) are written.
  - The existing explicit-location cases for `seedNode` and `seedKitchenStation` stay unedited (they
    insert their own row and pass it).
  - `seed.test.ts` defines a local `seedVenue` today: replace it with the exported helper (or rename
    it for what else it seeds) before adding the cases above.
  - `seedNode` and `seedDevice` keep accepting an explicit location until the schema slices: the
    fiscal pair's `packages/fiscal-verifactu/src/write-path.e2e.test.ts:552-555` passes one, and no F
    task edits that file.
- [ ] **Step 2: Run** `pnpm --filter @waitron/db exec vitest run src/testing/seed.test.ts` — FAIL:
  `seedVenue` and `seedWorkingOrder` are not exported, and `seedNode(db)` with no location inserts a
  null `location_id`, which the column refuses.
- [ ] **Step 3: Implement** the four helpers. `seedVenue` uses drizzle's `insert(locations)` (the
  existing raw-SQL reason in `seedTenant` — earlier migration points — does not apply: no upgrade
  test seeds a venue through this helper).
- [ ] **Step 4: Run** step 2's command — PASS; `pnpm --filter @waitron/db typecheck`.
- [ ] **Step 5: Commit** `git commit -s -m "db testing: seed the venue, and nodes, devices and orders at it"`.

### Task F1b — the codemod, and `packages/db/src/schema/[a-k]*` tests

**Files:** Create `scripts/a1301-seed-codemod.mjs`, `scripts/a1301-seed-codemod.test.mjs`. Modify the
20 files `/usr/bin/grep '^packages/db/src/schema/[a-k]' ~/waitron-campaign/a1301/fa/fx-any.txt` lists
(155 matching lines by `git grep -c -w -E 'locationId|location_id|locations|LocationId'`).

- [ ] **Step 1: Write the failing test** `scripts/a1301-seed-codemod.test.mjs`, one case per rule and
  per report reason above, each an input string and the exact expected output (or the expected
  `left` entry): statement form; `id: CONST` still used → `let` plus assignment; `id: CONST` unused →
  declaration gone; `const [loc]` used only in `seedNode` → plain statement; `const [loc]` used in
  `loc!.id` elsewhere → reported, output unchanged; two `locations` inserts → no location rule
  applied, reported; `seedNode(db, X)`; `seedDevice` with other keys, with only `locationId`, with
  shorthand; `insert(workingOrders)` statement and `const [o] = … .returning()` forms; `.values([…])`
  reported; raw SQL reported; a file with its own `tenants` insert reported; a file defining a local
  `seedVenue` reported with no import added; a fiscal pair path left unread; import added (outside and
  inside `packages/db`) and emptied imports removed; report mode writes nothing (`main` with a temp
  file, no `--write`: file bytes unchanged).
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/a1301-seed-codemod.test.mjs` — FAIL (module
  missing).
- [ ] **Step 3: Implement** the codemod.
- [ ] **Step 4: Run** it — PASS; then
  `pnpm exec vitest run --coverage --coverage.include=scripts/a1301-seed-codemod.mjs scripts/a1301-seed-codemod.test.mjs`
  — the per-file table shows at least 98/98/98/95 for the codemod (read the table, not the exit
  status). `pnpm exec vitest run scripts/english-only.test.ts`.
- [ ] **Step 5: Run the codemod** on the 20 files: report mode first, save the report, then
  `--write`, then `pnpm exec prettier --write <files>`. Hand-edit each reported site by the recipes.
  Expected leftovers in this bucket: the second rows in `schema/devices.test.ts` (`LOCATION_B`, `:19`,
  `:46`), `schema/dining-tables.test.ts` (`:17`, `:35`) and `schema/kitchen-stations.test.ts`
  (`:16`, `:33`); `schema/floor-zones.test.ts` and `schema/drawer-opens.test.ts` insert `locations`
  twice each — read whether the second is a cross-location case (left) or a second test's own seed
  (converted); whole-file: `schema/business-day-clock.test.ts` (the side tables S23 replaces).
- [ ] **Step 6: Run** `pnpm --filter @waitron/db exec vitest run src/schema/[a-k]*` (the shell
  expands the glob; read the `Tests` count) and `pnpm --filter @waitron/db typecheck`. Compare the
  test count with the same run on the base commit: equal (F1 deletes no case).
- [ ] **Step 7: Done-check** for these 20 files:
  `git grep -n -E 'insert\((schema\.)?locations\)|insert into "?locations|seedNode\([^)]*,|locationId: [A-Za-z_]+[,}]' -- <files>`
  prints only the leftovers named in step 5 and `location_id` fills of a table a later schema slice
  owns (each taking its value from `venueLocationId`). `pnpm format:check`. Commit:
  `git commit -s -m "db tests: the schema tests a–k seed the venue through the helpers (codemod a1301-seed-codemod)"`.

### Task F1c — `packages/db/src/schema/[l-z]*` tests

**Files:** the 30 files `/usr/bin/grep -E '^packages/db/src/schema/[l-z]' fa/fx-any.txt` lists (191
matching lines; `[l-o]` 10 files / 71 lines, `[p-z]` 20 / 120 — split there if the run grows past
budget).

- [ ] **Step 1: Baseline** `pnpm --filter @waitron/db exec vitest run src/schema/[l-z]*` — record the
  `Tests` count (passing).
- [ ] **Step 2: Run the codemod** (report, `--write`, prettier) and hand-edit the reported sites.
  Expected leftovers: `schema/nodes.test.ts` (`LOCATION_B`, `:22`, `:45`; the table's own raw
  inserts), `schema/orders.transition.test.ts` (`LOCATION_B`, `:23`, `:132`, and the "its location"
  case at `:542`), `schema/orders.test.ts` (raw `workingOrders` inserts testing the table),
  `schema/page-printers.test.ts` (two inserts); whole-file: `schema/location-catalogues.test.ts`
  (S23's table).
- [ ] **Step 3: Run** step 1's command — same `Tests` count, all passing; `pnpm --filter @waitron/db typecheck`.
- [ ] **Step 4: Done-check** as F1b step 7 over these files. `pnpm format:check`. Commit:
  `git commit -s -m "db tests: the schema tests l–z seed the venue through the helpers"`.

### Task F1d — the `packages/db/src/*.test.ts` files

**Files:** the 15 top-level files `/usr/bin/grep -E '^packages/db/src/[^/]+$' fa/fx-any.txt` lists
(127 matching lines): `allocate-number`, `allocate-order-number`, `append-order-amendment`,
`backup-evidence`, `change-log`, `configuration-transfer`, `constraint-target`, `joined-parts`,
`node-identity`, `party-table-labels`, `reserved-identity`, `station-colour`, `table-in-service`,
`table-short-names`, `tenancy` (each `.test.ts`).

- [ ] **Step 1: Baseline** the 15 files' `Tests` count.
- [ ] **Step 2: Run the codemod** over the files that seed rows (`allocate-*`, `append-order-amendment`,
  `joined-parts`, `node-identity`, `party-table-labels`, `reserved-identity`, `station-colour`,
  `table-in-service`, `table-short-names`) and hand-edit the reported sites. Left whole, with their
  reason: `backup-evidence.test.ts` (tests `backup-evidence.ts`'s location binding, which S18
  removes), `change-log.test.ts` and `tenancy.test.ts` (test the `locations` table itself: its change
  feed and its invoice-locales check; S23), `configuration-transfer.test.ts` (S17's
  `locationColumns`), `constraint-target.test.ts` (a column-list example, no row).
- [ ] **Step 3: Run** the 15 files — same `Tests` count; `pnpm --filter @waitron/db typecheck`.
- [ ] **Step 4: Done-check for the slice.**
  `git grep -n -E 'insert\((schema\.)?locations\)|insert into "?locations' -- 'packages/db/*.test.ts'`
  prints only: the files left whole above and in F1b/F1c, `src/testing/seed.test.ts`'s own cases, and
  the second-location rows named in F1b/F1c. List them in the PR body. `pnpm format:check`. Commit:
  `git commit -s -m "db tests: the remaining db tests seed the venue through the helpers"`.

### F1 open PRs touching the same files

On 2026-11-01 no open PR touches `packages/db/src/testing/seed.ts`, a `packages/db` test file or
`scripts/a1301-*` (`gh pr list --state open --json number,headRefName,files`, and
`gh pr diff <n> --name-only` for #2369, #2373, #2375 and #2377). #2375 (A1268) changes tests in
`packages/workforce` that call `seedNode`; F2 rebases around it.

---

## S2 — Invoice record inputs and invoice documents read the venue

**Goal.** Every value that goes into an invoice record, and every invoice document, stops looking
up a location. The issue zone (whose offset is hashed into the record time since A696) comes from
the venue; `IssueScope` loses `locationId` and with it the `mismatch` and `location` refusals. The
operation-description fallback (sent to AEAT as `DescripcionOperacion` on the paths that use it) and
a full invoice's operation date read the venue. The printed and emailed invoice stops reading the
sale's node's location. Until S23 "the venue" is the single `locations` row, so every value read is
the same value read today; Task S2-1 proves that for the hashed one.

| | |
| --- | --- |
| Depends on | S1 (`readVenue` in `@waitron/db`, which `@waitron/core`, `@waitron/fiscal` and `@waitron/fiscal-verifactu` already depend on) |
| Lands | **owner**, rule (a) invoice path and (b) moves where a hashed and an AEAT-sent value is read |
| Branch | `refactor/a1301-s2-invoice-inputs` |
| Review path | **FULL** (fiscal). `/finish-branch` runs the Codex run-it seat twice, the second angle told to set the checklist aside |

### What S2 changes in a fiscal record: the values traced to the bytes

| Value | Read today (A696 head) | Read after S2 | Where it lands | Bytes |
| --- | --- | --- | --- | --- |
| Issue zone → `offsetMinutes` | `readIssueZone`: `nodes.location_id` → `locations.time_zone` (`packages/fiscal/src/issue-clock.ts:7-23`); `prepareIssueClock` freezes `timeZoneOffsetMinutes(zone, instant)` (`:25-38`) | `readVenue(tx).timeZone`, the same `locations` row until S23 | `recordSale` takes one reading (`packages/core/src/record-sale.ts:274`), stores `issued_offset_minutes` (`:313`) and hands `issuedAt`/`offsetMinutes` to the backend (`:364-365`); `VerifactuBackend.recordSale` puts them in `FechaExpedicionFactura` and `generadoEn`/`offsetMinutes` (`packages/fiscal-verifactu/src/backend.ts:296,311-312`), which `appendToChain` (`:315`) hashes as `FechaHoraHusoGenRegistro` and stores (`registro-row.ts:130`, column `schema/registros.ts:93`). Annulments: `prepareFiscalVoidClock` → `prepareIssueClock({ nodeId })` (`void-issue-clock.ts:24`) → `recordVoid`'s `now` (`backend.ts:420`) → `FechaExpedicionFacturaAnulada` (`:429-431`) and `generadoEn`/`offsetMinutes` (`:436-437`) | **None.** Same zone string from the same row, so the same offset at every instant. Task S2-1's test pins the record text across a daylight-saving change, before and after, with a control |
| Operation description fallback | `operationDescriptionFor`: the supplied text, else `locations.operation_description` through `devices.location_id` or `nodes.location_id` (`sale-location.ts:12-32`) | the supplied text, else `readVenue(tx).operationDescription` | `record-sale.ts:348-353` → `descriptionOfOperation` (`:366`) → `DescripcionOperacion` (`backend.ts:303`; corrections `:528`, substitutions `:651`) → stored `descripcion_operacion` (`registro-row.ts:157`, `schema/registros.ts:76`) → read back into the AEAT body (`registro-row.ts:394`). Not a huella input (`registro-row.ts:391-393` and the design's §3 probe: `SAME` for a changed description, `DIFFERENT` for the control) | **None.** Production routes always supply a description (fiscal-check.md path 1); the fallback paths read the same row's same text |
| Full-invoice operation date | `working_orders.location_id` → `locations.time_zone` (`record-sale.ts:275-282`), formatted at `:288-295` | `readVenue(tx).timeZone`, the raw saved string as today (not re-classified) | `sales.operation_date` (`:314`); printed on a full invoice. Not sent to AEAT: `git grep -n -E 'operationDate\|FechaOperacion' 7e824ae233 -- packages/fiscal-verifactu/src/backend.ts packages/fiscal/src/backend.ts` prints nothing | **None.** Same zone, same date |
| Invoice document language, address, email contact, printer offer | the sale's node's location (`invoice-document.ts:39-49,101`; `invoice-delivery-status.ts:142-146`; `invoice-delivery-actions.ts:130-137`); receipt language and address through `saleLanguageFor`, `readOfferedReceiptLanguages`, `readLocationAddress` | the box's own `cfg`, the venue (`readVenue`, Task S2-5), or no filter (one venue) | printed or emailed document text only. The issuer is the filed record's legal name and NIF, else `tenants` (`invoice-document.ts:86-93`), never a location | Document text only, same text; no fiscal record |

Plainly: **no byte of an invoice record, huella, chain, invoice number or AEAT wire field changes in
S2**, provided `readVenue` returns the single `locations` row's `time_zone` and
`operation_description` unchanged (S1's contract).

Lines in S2, S3 and S4 were read at A696's head `7e824ae233` unless they say main. A696 lands before
S1, and these slices start after S1, so these are the lines the implementer meets (give or take S1's
edits). Every task in S2, S3 and S4 runs the fiscal pair unedited.

Two things the golden case does and does not check, so nobody leans on it for more than it gives:

- It files through the operation-description fallback: it passes no `operationDescription`
  (`write-path.e2e.test.ts:641-671`) and rings on a device (`deviceOrigin(seeded.deviceId)`), so
  `operationDescriptionFor` reads the description through `devices.location_id` today
  (`packages/core/src/sale-location.ts:20-24`). That path is S2's.
- It does **not** go through the issue zone. Its clock is `steadyClock`, a fixed `+01:00` reading
  (`packages/fiscal-verifactu/test/write-path-fixtures.ts:27-40`, used at `:86`). So the golden case
  cannot see S2's zone change; Task S2-1 adds the test that can. S23's plan should reuse that test's
  describe unedited for its own before/after.

### Files

From the TSV (`file-assignment.tsv`, slice `S2`), grouped by task. Lines are the pattern's matches at
`7e824ae233`.

**Task S2-1 — the issue zone**

- `packages/fiscal/src/issue-clock.ts:2,6,9,13-21` — `IssueScope` becomes `{ nodeId: string }`;
  the `mismatch` comparison and the `locations` read go; the zone is `readVenue(tx).timeZone`; the
  node-exists refusal (`reason: "node"`, `:12`) and the zone classification (`:21-22`) stay.
- `packages/provisioning/src/fiscal-readiness-runner.ts:113` — the literal
  `{ nodeId: venue.nodeId, locationId: venue.locationId }` becomes `{ nodeId: venue.nodeId }`.
  `:123-130` (`request.location.invoiceLocales`) is the setup request's shape: S16's, left.
- `packages/provisioning/src/recover-provisioned-venue.ts:45` (S16's file, S2's call per design §2.4)
  — `readIssueZone(tx, { nodeId: row.nodeId })`. The query at `:37-42` is S16's.
- `apps/server/scripts/demo-seed/seed.ts:76-78` — `readIssueZone(tx, { nodeId: venue.nodeId })`.
  Its other twelve matches (`:10,12,40,82,89,97,100,111,112,143,148,149`) are calls into S1, S5, S6,
  S7 and S10's readers. Under the header's rule "Calls into another slice's file", a lane slice does
  not edit this file before S2 lands: its reader keeps an ignored parameter for the call, and S2
  drops the argument for every reader whose slice has landed by then (argument only). S18 removes
  the ignored parameters left, and S19 sweeps the rest.
- No edit, callers that pass `cfg` (whose extra `locationId` the narrower `IssueScope` ignores until
  S18 removes it): `apps/server/src/till-sale.ts:987,1194,1628,1780`, `bill-payments.ts:702,1121`,
  `cancel-credit.ts:54`, `working-order.ts:7038`, `trading-admission.ts:32`,
  `packages/fiscal-verifactu/src/void-issue-clock.ts:24` (its own `mismatch` at `:22-23` compares a
  sale's node with its record's node and stays, design §2.4).
- Test helpers the golden case needs before readers refuse two venue rows (see "The second venue row"
  below and the header's "A database with a second venue row"): `packages/fiscal-verifactu/test/fixtures.ts:222-243` (`insertLocationNodeSeries`) and
  `packages/fiscal-verifactu/src/testing/seed.ts:72-83` (`insertLocation`) reuse the database's one
  `locations` row when it exists. The rest of these helpers is Task S3-4.

**Task S2-2 — operation description and operation date**

- `packages/core/src/sale-location.ts:2,13-32` — renamed `packages/core/src/operation-description.ts`
  (`git ls-files packages/core/src/operation-description.ts` prints nothing at main);
  `operationDescriptionFor(tx, supplied?)`: the supplied text, else `readVenue(tx).operationDescription`.
  The `origin` and `nodeId` parameters go; so does the `v8 ignore` block (`:25-31`), whose comment
  argues from the two not-null foreign keys this function no longer reads.
- `packages/core/src/record-sale.ts:4,9,278,280` — import renamed; the bill read selects
  `openedAt` from `working_orders` alone and the zone from `readVenue(tx).timeZone`, read only when
  `counterparty !== null` (as the join is today).
- `packages/core/src/record-correction.ts:4,298-302`, `record-substitution.ts:4,226-230` — import
  renamed, the two dropped arguments dropped.
- `apps/server/scripts/demo-seed/seed-sales.ts:23,159-161` — the territory read becomes
  `readVenue(tx).fiscalTerritory`; `filingModule` still comes from `nodes`.

**Task S2-3 — invoice documents and their delivery**

- `apps/server/src/invoice-document.ts:6,18,40,43,49,101` — the `nodes` join and `saleCfg` go;
  `readReceiptLanguage(tx, cfg.locationId)` and `{ ...cfg, … }` use the caller's `cfg`. If S5 has
  landed, `readReceiptLanguage` keeps an ignored `_locationId?` for this call: drop the argument.
- `apps/server/src/invoice-delivery-status.ts:75,92,143,145,181,190` — the `nodes` join goes;
  `InvoiceDeliveryState.locationId` goes. `InvoiceDeliverySale` keeps its `locationId` for now,
  filled with `await venueLocationId(tx)` instead of the sale's node's location: its two readers are
  the printer offers `orderInvoicePrinters` (`orders-list.ts`, S11a) and `tillInvoicePrinters`
  (`till-api.ts`, S10b), whose location filters are more than an argument-only edit in a lane file.
  S18 deletes the field once both readers have stopped reading it (header, "Notes for S18").
- `apps/server/src/invoice-delivery-actions.ts:131,133,137,179` — the `nodes` join and both
  `located` objects go; `canEmailInvoice(tx, saleId, transport)`.
- `apps/server/src/invoice-email-contact.ts:2,10,45,51` — `canEmailInvoice(tx, saleId: string,
  transport)`; `resolveInvoiceEmailContact(tx, source)` builds the venue-service seats' scope once as
  `{ locationId: locationId(await venueLocationId(tx)) }`. This is outside `venueLocationId`'s
  stated use (filling a column): no caller here has a `cfg` (`orders-list.ts:688-695` has none), and
  the alternative is threading `cfg` through `readDeliveries` and `readInvoiceDeliveries`. S18
  deletes the line when the seats lose `cfg`.
- `apps/server/src/invoice-choice-delivery.ts:11,31,61` — the `locationId` input goes; the call is
  `resolveInvoiceEmailContact(tx, input.source)`.
- `apps/server/src/invoice-delivery.ts:77` — the A4 destination check drops the `nodes` join on
  `page_printers.location_id`; it checks the printer id and `active` only.
- `apps/server/src/invoice-page-print.ts:37,44,58,76,88` — `ctx` becomes
  `{ exceptPrinterIds?: readonly string[] }`; the three `pagePrinters.locationId = ctx.locationId`
  filters go; the doc comment loses "in the server's location".
- `apps/server/src/receipt-presentation.ts:6,12,21,39,41` — it already reads the caller's `cfg`,
  never a sale's location. `:39`'s `readLocationAddress` becomes `readVenueAddress(tx)` in Task S2-5.
  `:21`'s `readReceiptLanguage` is S5's: if S5 has landed, drop the argument here.
- Callers the narrower types force (files of lane slices; each edit is argument only, header rule
  "Calls into another slice's file"): `apps/server/src/orders-list.ts:694`
  (`canEmailInvoice(tx, sale.id, emailTransport)`); `apps/server/src/working-order.ts:4429` (the
  `locationId: order.locationId` input goes); `apps/server/src/page-print-api.ts:158` (stops passing
  `locationId`).
- **Not S2's:** `orderInvoicePrinters`' two `locationId` filters (`orders-list.ts:717-735`) are
  S11a's; `tillInvoicePrinters`' `sale` parameter and `resolveInvoicePrinter`'s `at`
  (`till-api.ts:2486-2508`, `receipt-print.ts:112-128`) are S10b's. They keep reading
  `InvoiceDeliverySale.locationId`, which now holds the venue's row id, so they still offer every
  printer until those slices drop the filters.
- `apps/server/src/invoice-print.ts:62` — `ctx.locationId` is forwarded to `claimPrintJobs`
  (`:66-70`, `packages/printing`), whose location filter S10a removes. S10a keeps an ignored
  optional `locationId?` on `claimPrintJobs`' context for this call while S2 has not landed; S2
  drops the field here (and S10a does it itself, argument only, if S2 has landed first).

**Task S2-4 — the fiscal demo scripts**

- `apps/server/scripts/daily-close-demo.ts:35,76,94,101,102,105,128,219`,
  `daily-close-z-demo.ts:38,103,110,111,120,132`, `modelo-303-demo.ts:38,247,262,269,270,276,306,512`
  — each script creates its venue: it keeps inserting the one `locations` row (until S23 that row is
  the venue) and fills `nodes.location_id` from it, but its returned venue object stops carrying
  `locationId`, and `scriptSessionDevice` is called without one.
- `apps/server/scripts/script-device.ts:6,11,29` — `scriptSessionDevice(tx, label)` fills
  `devices.location_id` with `venueLocationId(tx)` (the interim helper's stated use). Its third caller,
  `dev-setup.ts`, is S19's file; the call there loses one argument.
- `apps/server/scripts/record-one-sale.ts` — no pattern match; its `prepareIssueClock(tx, { nodeId:
  node }, clock)` (`:145`) needs no edit. Open PR #2377 deletes the file.

**Task S2-5 — the receipt-language and address readers:** listed in the task itself (below).

**Left out of S2, with the slice they belong to:**

- `packages/shared/src/record-export-types.ts:5` — moved to S14 (header, "Files moved from the
  design's slice").
- `apps/server/src/sale-operation-description.ts:2,10` — `cfg.locationId` is only passed to the
  venue-service seats (`:19,27,29,33,41-42`). S18 removes it with the seats' `cfg`.
- `apps/server/src/till-sale.ts:129-137` and `bill-payments.ts:1154,1166-1180` — the attendance
  recorder's `locationId` (working time, not invoicing): S13's, after A1268.
- `till-sale.ts:938,999,1633,1812`, `bill-payments.ts:722`, `working-order.ts:7090` — the calls to
  `saleLanguageFor`/`readOfferedReceiptLanguages` are Task S2-5's, not left out.

### The second venue row

`readVenue` refuses a database with more than one `locations` row (`provisioning.second_venue`,
S1), and the header's rule "A database with a second venue row" says what to do. Once S2 routes
every sale through `readVenue`, any test that seeds a second `locations` row and then files, voids
or dates a sale fails. Two kinds exist:

- **Cross-location tests.** Their only purpose was a second location; they are deleted with the check
  (named per task below).
- **Helpers that insert a fresh row per call.** `seedTenantWithSif` inserts a new `locations` row
  every call (`test/fixtures.ts:222-243`, called at `:282`), and the golden case calls it a second
  time on top of the suite's `beforeEach` seed (`write-path.e2e.test.ts:635`, comment at `:634`).
  Task S2-1 makes these two helpers reuse the existing row. The golden case and its assertions stay
  unedited.

### Task S2-1: the issue zone reads the venue — proved across a daylight-saving change

**Files:** as listed above, plus tests `packages/fiscal/src/issue-clock.test.ts` and
`packages/fiscal-verifactu/src/void-issue-clock.test.ts`.

**Interfaces.**
- Consumes: `readVenue(tx: Transaction): Promise<Venue>` from `@waitron/db` (S1).
- Produces: `type IssueScope = { nodeId: string }`; `readIssueZone(tx, scope): Promise<string>` and
  `prepareIssueClock(tx, scope, source): Promise<TrustedClock>` keep their names and return types.

- [ ] **Step 1: Fold the two fiscal-verifactu seed helpers onto one row.**
  `insertLocationNodeSeries` (`test/fixtures.ts:222-243`) and `insertLocation`
  (`src/testing/seed.ts:72-83`) first `select id from locations`; with one row they return its id,
  with none they insert as today. Run the fiscal pair: PASS, `git diff` of the pair empty. Commit
  (`test(fiscal-verifactu): seed one venue row per database`).

- [ ] **Step 2: Write the pinning test, BEFORE any source change.** In
  `void-issue-clock.test.ts`, a new `describe("the venue's zone across a daylight-saving change")`
  that reuses the file's `seededNode`, `backend`, `records` and `snapshot` helpers (`:28-78`). It sets
  the venue's zone with `update locations set time_zone = 'Atlantic/Canary'` (the one row — no `where`
  on an id), then:
  - files two alta records with `recordSale`, each with `clock: await prepareIssueClock(tx,
    { nodeId: seededNode.nodeId }, sourceAt(instant))` at `2026-10-25T00:30:00.000Z` and
    `2026-10-25T01:30:00.000Z` (Canary leaves summer time at 01:00 UTC that day);
  - annuls the first through `prepareFiscalVoidClock` at `2026-10-25T01:30:00.000Z`;
  - asserts, reading `records(saleId)` and `select issued_offset_minutes from sales`:

  ```ts
  expect(first.FechaHoraHusoGenRegistro).toBe("2026-10-25T01:30:00+01:00");
  expect(second.FechaHoraHusoGenRegistro).toBe("2026-10-25T01:30:00+00:00");
  expect(offsets).toEqual([60, 0]);
  expect(annulment.FechaHoraHusoGenRegistro).toBe("2026-10-25T01:30:00+00:00");
  expect(annulment.IDFactura.FechaExpedicionFacturaAnulada).toBe("25-10-2026");
  for (const raw of storedRows) expect(computeHuella(fromRegistroRow(decodeRegistroRow(raw)))).toBe(raw.huella);
  ```

  Why Canary: its two offsets (60, 0) differ from the host zones a wrong source would read — CI's UTC
  (0, 0) and a Madrid laptop (120, 60) — so a test that passes cannot be passing by reading the host.

- [ ] **Step 3: Run it on the unchanged code.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/void-issue-clock.test.ts`.
  Expected: PASS (the zone is read through `nodes.location_id` today, from the same row). Commit
  (`test(fiscal-verifactu): pin the issue zone's record text across a clock change`) and note the
  commit id: Step 8 checks the file is unchanged since.

- [ ] **Step 4: Write the failing tests for the new source.** In `issue-clock.test.ts`:
  - replace `:92-110` ("refuses a node with a missing location…") with "reads the venue's zone
    whatever the node's location column holds": with `pragma foreign_keys = off`, set the node's
    `location_id` to `randomUUID()`, and expect `await zone({ nodeId: scope.nodeId })` to be
    `"Europe/Madrid"`. Today this rejects with reason `location` — that is the red;
  - in the `it.each(["node", "mismatch"])` at `:79-91`, delete the `"mismatch"` row: it exists only
    to prove a cross-location refusal (design §6, "deleted, not rewritten"). The `"node"` row stays.
  - `scope` (`:18,30`) becomes `{ nodeId }`; the `:54,66,167` updates of `locations` drop their
    `where eq(locations.id, scope.locationId!)` (one row).
  In `void-issue-clock.test.ts`: delete `:95-118` ("resolves the original node rather than another
  location…", which seeds a second location) and `:195-212` ("validates the saved original node's
  location…"). Both exist only for a second location. `:80-94` and the `mismatch` case at `:189-193`
  (sale node versus record node) stay unedited.
  Run `pnpm --filter @waitron/fiscal exec vitest run src/issue-clock.test.ts`: the new case FAILS
  with `venue.time_zone_target_invalid` reason `location`.

- [ ] **Step 5: Change `issue-clock.ts`.** `IssueScope = { nodeId: string }`; read the node row
  (keep `reason: "node"`); zone from `readVenue(tx).timeZone`; classify as today. Fix the three
  literal callers listed under Task S2-1's files.

- [ ] **Step 6: Run** `pnpm --filter @waitron/fiscal exec vitest run src/issue-clock.test.ts` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/void-issue-clock.test.ts`: PASS, the
  Step 2 cases included.

- [ ] **Step 7: The control — the test must fail when the zone source is wrong.** Temporarily make
  `readIssueZone` return the host's zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) instead
  of the venue's. Run Step 2's describe twice:
  `TZ=UTC pnpm --filter @waitron/fiscal-verifactu exec vitest run src/void-issue-clock.test.ts -t "daylight-saving"`
  and the same with `TZ=Europe/Madrid`. Expected: both FAIL on `FechaHoraHusoGenRegistro`
  (`+00:00` or `+02:00` received where `+01:00` was expected). If either passes, the test does not
  discriminate: stop and fix the test. Revert the mutation (`git diff --stat` shows only the intended
  files). Record both outputs' failing line in the commit message.

- [ ] **Step 8: Prove "before and after".** `git diff --exit-code <Step 3 commit> -- packages/fiscal-verifactu/src/void-issue-clock.test.ts`
  must show only Step 4's deletions (the describe from Step 2 unchanged): run
  `git diff <Step 3 commit> -- packages/fiscal-verifactu/src/void-issue-clock.test.ts | /usr/bin/grep -c '^+'`
  and check every added line is one of Step 4's edits. Then the fiscal pair: PASS, unedited.

- [ ] **Step 9: Wider runs.** The files that call the zone code at A696:
  `pnpm --filter @waitron/server exec vitest run src/trading-admission.test.ts src/bill-payments.issue-clock.test.ts src/zone-core-capabilities.test.ts src/zone-preservation.test.ts src/zone-preservation.restore.test.ts src/receipt-issuer.test.ts`.
  A failure that comes from a second `locations` row is classified: a cross-location test is deleted
  (name it in the commit); a helper that seeds a stray second row is folded onto one row. Any other
  failure is a defect. Then `pnpm --filter @waitron/fiscal typecheck`, `pnpm --filter
  @waitron/fiscal-verifactu typecheck`, `pnpm --filter @waitron/provisioning typecheck`,
  `pnpm --filter @waitron/server typecheck`; code guards `pnpm exec vitest run
  scripts/module-seams.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts
  scripts/personal-log-params.test.ts scripts/live-subscriptions.test.ts`; `pnpm format:check`.

- [ ] **Step 10: Done-check and commit.** `git grep -n -E "$P" -- packages/fiscal/src/issue-clock.ts`
  prints nothing. In `fiscal-readiness-runner.ts` only `:123-130` (`request.location`, S16) remain;
  in `recover-provisioned-venue.ts` only `:37-42` (S16). Commit `-s`.

### Task S2-2: the operation description and the operation date read the venue

**Files:** as listed; tests `packages/core/src/record-sale.test.ts` (and `record-correction.test.ts`,
`record-substitution.test.ts` if they name `sale-location`; at A696 `git grep -l -E
'operationDescriptionFor|sale-location' 7e824ae233 -- 'packages/core/src/*.test.ts'` prints nothing).

**Interfaces.** Produces `operationDescriptionFor(tx: Transaction, supplied?: string):
Promise<string>` in `packages/core/src/operation-description.ts`.

- [ ] **Step 1: Failing tests** in `record-sale.test.ts`:
  - "describes a device sale from the venue whatever the device's location column holds": with
    `pragma foreign_keys = off`, point the seeded device's `location_id` at `randomUUID()`, file a
    device sale with no `operationDescription`, expect `descriptionsFiled(...)` to equal the venue
    row's text. Today it throws `no location found for the sale's …` (`sale-location.ts:29`).
  - "dates a full invoice's bill in the venue's zone whatever the order's location column holds":
    as the case at `:2011-2061`, with the order's `location_id` pointed at `randomUUID()` (foreign
    keys off), `openedAt` `2026-02-28T22:50:00Z`, venue zone `Europe/Madrid`: expect
    `operationDate` `"2026-02-28"`. Today the inner join finds no row and the date falls back to the
    issue instant's, `"2026-03-01"` (`record-sale.ts:286-287`).
  Run `pnpm --filter @waitron/core exec vitest run src/record-sale.test.ts`: both FAIL as described.
- [ ] **Step 2: Delete** `record-sale.test.ts:226-238` ("describes the operation from the location of
  the device the sale was rung on" — it inserts a second location; cross-location only). Keep
  `:240-251` (it edits the one row; its title becomes "describes a sale with no device from the
  venue" — title only) and `:2011-2061` unedited: its Madrid/Canary rows and its Honolulu
  "retained" control already pin the zone.
- [ ] **Step 3: Implement** the rename and the two reads (files above). Run Step 1's file: PASS.
- [ ] **Step 4: Run** `pnpm --filter @waitron/core exec vitest run src/record-sale.test.ts src/record-correction.test.ts src/record-substitution.test.ts`,
  the fiscal pair (PASS, unedited — the golden case now files through the venue fallback), and
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-sales.golden.test.ts`
  (it pins the demo's sales; PASS unedited). Typecheck `@waitron/core` and `@waitron/server`; code
  guards; `pnpm format:check`.
- [ ] **Step 5: Done-check** `git grep -n -E "$P" -- packages/core/src/operation-description.ts packages/core/src/record-sale.ts packages/core/src/record-correction.ts packages/core/src/record-substitution.ts apps/server/scripts/demo-seed/seed-sales.ts`
  prints nothing. Commit `-s`.

### Task S2-3: invoice documents and their delivery stop reading the sale's location

**Files:** as listed. Tests touched: `apps/server/src/invoice-delivery.test.ts`,
`orders-invoice-deliveries.test.ts`, `invoice-page-print.test.ts`, `invoice-email-contact.test.ts`,
`invoice-document.test.ts`, `invoice-choice-delivery.test.ts`, `bill-payments-api.test.ts`.

- [ ] **Step 1: Failing test.** In `invoice-page-print.test.ts`, "claims a due A4 delivery whatever
  the printer's location column holds": with foreign keys off, set the printer's
  `page_printers.location_id` to `randomUUID()`; expect `claimInvoicePagePrint(tx, agentId, {})` to
  return the delivery (cast the `{}` while the old type still demands `locationId`). Today the
  location filter (`invoice-page-print.ts:88`) compares against `undefined` and claims nothing: run
  it and see it FAIL on the claimed job, not on a type error (Vitest does not typecheck).
- [ ] **Step 2: Delete the cross-location cases** (each exists only to prove a second location is
  refused or hidden):
  - `invoice-page-print.test.ts:272` ("does not claim another location's delivery…") whole; `:760`
    ("…and lists only this location's printers") — delete only the half that seeds a second
    location's printer; the busy-printer half stays;
  - `invoice-delivery.test.ts:182-…`: the `"other-location"` row of `it.each(["disabled",
    "other-location"])` (`:186-191,195` branch); `"disabled"` stays;
  - `orders-invoice-deliveries.test.ts:339` — the "and refuses any other" half that uses another
    location. (`:1022`, the "or at another location" printer, proves `orderInvoicePrinters`' filter:
    S11a deletes it);
  - `invoice-email-contact.test.ts:173` ("…does not borrow another location") and `:208` ("refuses a
    cross-location department…") — delete the cross-location half of each; the local-fallback half
    of `:173` stays;
  - `invoice-document.test.ts:1119-1127` — the `foreign` location in `expectNoLogoOnceUntrusted`:
    delete the foreign-location branch only;
  - `bill-payments-api.test.ts:1970` and `:2091` — the `"other-location"` rows and the "only another
    location's" clause.
  A case above that still passes after this task, because the check it proves is a printer offer's
  filter (S10b's or S11a's), is left for that slice. Each deletion's commit line names the test.
  **Changed, not deleted:**
  `orders-invoice-deliveries.test.ts:577-606` ("reads the sale's location once…") asserts one
  `from "sales" inner join "nodes"` statement (`:602-605`); after this task there is none, so it
  becomes `toHaveLength(0)` with the title "reads no sale location while mail can be sent" — the
  design decision is §1, "Nothing passes a location id".
- [ ] **Step 3: Implement** the files above, in this order: `invoice-delivery-status.ts` (types),
  `invoice-email-contact.ts`, `invoice-delivery-actions.ts`, `invoice-choice-delivery.ts`,
  `invoice-delivery.ts`, `invoice-page-print.ts`, `invoice-document.ts`, then the forced callers.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/invoice-delivery.test.ts src/orders-invoice-deliveries.test.ts src/invoice-page-print.test.ts src/invoice-email-contact.test.ts src/invoice-document.test.ts src/invoice-choice-delivery.test.ts src/bill-payments-api.test.ts src/receipt-print.test.ts src/page-print-api.test.ts`
  (drop a name `ls` does not find); PASS. Fiscal pair PASS unedited. `pnpm --filter @waitron/server
  typecheck`; code guards; `pnpm format:check`.
- [ ] **Step 5: Done-check** over the task's `apps/server/src/invoice-*.ts` files: only
  `invoice-email-contact.ts`'s and `invoice-delivery-status.ts`'s `venueLocationId` lines and
  `InvoiceDeliverySale.locationId` (S18), `invoice-document.ts`'s `cfg.locationId` call to
  `readReceiptLanguage` (until S5 lands), `invoice-print.ts:62` (until S10a lands) and
  `receipt-presentation.ts`'s calls (S2-5, and S5's reader) may print. Commit `-s`.

### Task S2-4: the fiscal demo scripts

- [ ] **Step 1:** `apps/server/scripts` has tests for these scripts (`git ls-files
  'apps/server/scripts/*.test.ts'`); run the ones naming the four scripts and `script-device.ts`
  before the change: PASS.
- [ ] **Step 2:** Make the edits listed under Task S2-4's files. The scripts' sale clocks
  (`prepareIssueClock(tx, venue, …)`, `daily-close-demo.ts:176,205,249`, `daily-close-z-demo.ts:190`,
  `modelo-303-demo.ts:503,544`) now receive objects without `locationId`.
- [ ] **Step 3:** Run the same tests: PASS. `pnpm --filter @waitron/server typecheck`;
  `pnpm format:check`; fiscal pair.
- [ ] **Step 4: Done-check** over the four scripts and `script-device.ts`: only the `locations`
  insert that creates the venue row and the `nodes.location_id` value filled from it may print
  (S28 removes them). Commit `-s`.

### Task S2-5: the receipt-language and address readers read the venue (moved from S1)

The three readers S1 leaves (header, "Files moved from the design's slice"): their signatures,
their insides and every caller. Lines at `7e824ae233`.

**Files:**

- `apps/server/src/venue-locale.ts` — `locationLanguageIn(tx, locationId)` (`:108-120`) becomes a
  read of `readVenue(tx)`'s `invoiceLocales` and `province` with no id;
  `readOfferedReceiptLanguages(tx)` (`:137-142`) and `saleLanguageFor(tx, stored, warn)`
  (`:151-174`) lose their location argument; the "no location" error goes (`readVenue` refuses
  `venue.not_found`); comments say "the venue's".
- `apps/server/src/venue-address.ts` — `readLocationAddress(tx, locationId)` (`:49`) and its private
  `readAddress` (`:54-68`) are replaced by `readVenueAddress(tx): Promise<string[]>`, built from
  `readVenue(tx)` with S1's `addressLines`.
- Invoice-path callers (S2's own files): `till-sale.ts:938,999,1633,1812`, `bill-payments.ts:722`,
  `receipt-presentation.ts:39`.
- Lane-file callers, argument only (header rule): `working-order.ts:4476,7090` (S11),
  `department-receipt-api.ts:18,87` (S6: the import and the call become `readVenueAddress`),
  `department-receipt-languages.ts:27` (S6), `tender-refund-api.ts:222` and
  `transaction-receipt-api.ts:64` (S11), `till-setup.ts:83` (S12).
- If S5 has landed, `departmentReceiptLanguages`' `cfg` (`department-receipt-languages.ts:15`) is
  now unused: drop it, and its callers' argument (`department-receipt-api.ts:73-75`,
  `department-receipt-draft.ts:34`, `receipt-preview-api.ts:314`). If S5 has not landed, `cfg` still
  feeds `readReceiptLanguage`, and S5 drops it.
- If S5 has landed, also drop the ignored location argument S5 leaves at `invoice-document.ts:101`,
  `receipt-presentation.ts:21` and `apps/server/scripts/demo-seed/seed.ts:109-110`.

**Interfaces — Produces:** `readOfferedReceiptLanguages(tx): Promise<[string, ...string[]]>`,
`saleLanguageFor(tx, stored, warn): Promise<{ locale; invoiceLocales }>`,
`readVenueAddress(tx): Promise<string[]>`. Return shapes unchanged.

- [ ] **Step 1: Failing tests.** In `apps/server/src/venue-locale.test.ts`: "offers the venue's
  receipt languages without being told a location" calls `readOfferedReceiptLanguages(tx)` on the
  one venue and expects the list the case at `:202-209` expects today; and "files a sale in the
  venue's first language" calls `saleLanguageFor(tx, undefined, { log: undefined, workingOrderId })`
  and expects `{ locale, invoiceLocales }` equal to the venue row's. Both fail before: the old
  signatures read `undefined` as the id (`TypeError` on `params.locationId`, and
  `locationLanguageIn: no location`). In `apps/server/src/venue-address.test.ts`: "reads the venue's
  address lines" calls `readVenueAddress(tx)` and expects the one venue's lines; fails before (not
  exported).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/venue-locale.test.ts src/venue-address.test.ts`
  — FAIL as described.
- [ ] **Step 3: Delete** the cases in those two files that pass an id naming no row or another
  location's id (nothing passes a location id, §1): find them with
  `git grep -n -E 'randomUUID\(\)|another|other location|unknown location' -- apps/server/src/venue-locale.test.ts apps/server/src/venue-address.test.ts`
  and name each in the commit.
- [ ] **Step 4: Implement** the files above, then the callers.
- [ ] **Step 5: Run** step 2's command, then
  `pnpm --filter @waitron/server exec vitest run src/receipt-presentation.test.ts src/department-receipt-api.test.ts src/department-receipt-languages.test.ts src/tender-refund-api.test.ts src/transaction-receipt-api.test.ts src/till-setup.test.ts src/invoice-document.test.ts src/bill-payments-api.test.ts src/till-sale-integrated.test.ts`
  (drop a name `ls` does not find; read each `Tests` count) — PASS. A
  `provisioning.second_venue` or `venue.not_found` failure: the header's rule. Fiscal pair PASS,
  unedited. `pnpm --filter @waitron/server typecheck`; code guards; `pnpm format:check`.
- [ ] **Step 6: Done-check** `git grep -n -E "$P" -- apps/server/src/venue-locale.ts apps/server/src/venue-address.ts`
  prints nothing, and `git grep -n -E 'readLocationAddress|locationLanguageIn' -- apps packages`
  prints nothing. Commit `-s`, naming every lane-file call it edited.

### Open PRs touching S2's files (`gh pr list --state open`, 2026-11-01)

- **#2369 A696** — every zone file here; lands before S1, so it is the base, not a conflict.
- **#2373 W41s-7** (`feat/w41s7-conflict-recovery`, "Stop invoice identity conflicts…") —
  `apps/server/src/bill-payments.ts`, `till-sale.ts`, `working-order.ts`, `boot.ts`, `errors.ts`,
  `packages/core/src/record-sale.test.ts`. Rebase around it.
- **#2377 A1008** — deletes `apps/server/scripts/record-one-sale.ts` and its test. If it lands first,
  Task S2-4 has one file fewer.

---

## S3 — Fiscal-verifactu stops reading a location

**Goal.** The Veri*Factu module stops reading a location. Its "is this node in the same venue?"
checks (fiscal-check.md group 3) are deleted, keeping every "does this node exist?" half; the
certificate dates and the certificate check's AEAT query month read the venue's zone; the recovery
document names the venue; the hour-dormant standby state (a host file and part of the join bundle)
loses `locationId`; and the host's certificate and box-health routes stop passing one. The module
contract's `ProvisionedNode` keeps its `locationId` until S18, so values built only to fill that
field stay.

| | |
| --- | --- |
| Depends on | S1; reuses S2-1 Step 1 (the two seed helpers) if S2 is ahead, else Task S3-4 does it |
| Lands | **owner**, rule (c): these checks guard the path that writes an invoicing-system identity |
| Branch | `refactor/a1301-s3-fiscal-verifactu` |
| Review path | **FULL** (fiscal), two Codex angles |
| Reset | a box holding `<state>/module-preparation-state.json` with an hour-dormant entry, or a standby join bundle in flight, is reset (design §4 "Host files") — say so in the PR's first line |

### What S3 changes in a fiscal record

Nothing. Traced:

- **Certificate zone** → `venueTimeZone` (`certificate-install.ts:90-102`) → read once per install
  check (`:184-193`) → `checkLocally` and the live check; `certificate-check.ts:63-67` and
  `certificate-diagnosis-child.ts:141-144` turn "now" in that zone into `Ejercicio`/`Periodo` of an
  AEAT **query** (consulta). Nothing is filed or hashed; `fiscal_certificate_installs` stores instants
  only (fiscal-check.md path 3). Same zone, same month.
- **Same-venue checks** refuse or admit an allocation, a reservation, a backup's evidence; none writes
  a record field (fiscal-check.md path 8; group 3's files). With one venue they could only ever pass
  when the node exists, which is the half kept.
- **Dormant state** is a host file and a bundle member, not a database table (fiscal-check.md path 8:
  `hour-dormant-standby.ts:158-166` → `packages/provisioning/src/module-preparation-state.ts:78,100`).
- **Recovery document** `venueName` is a document the owner keeps (fiscal-check.md path 6).
- No fiscal-verifactu table or trigger names a location (design §3, "Chain, numbering").

### Files

TSV slice `S3`, 26 files, split as the summary proposes (§4: S3a/S3b/S3c) with S3b cut in two.
Matching lines at `7e824ae233`, excluding the `allocation` words the pattern also matches
(`git grep -n -P '(?<![Aa]l)(locationId|location_id|\blocations?\b|LocationId)'`).

**Task S3-1 — certificates (S3a)**

- `packages/fiscal/src/contribution.ts:64,91,104,117,134` — `locationId` leaves
  `FiscalCertificateDiagnosisDeps`, the `read`, `install`, `alerts` and `reminders.claim` deps.
- `packages/fiscal-verifactu/src/certificate-install.ts:3,56,90-98,190` — `InstallDeps.locationId`
  goes; `venueTimeZone(tx)` reads `readVenue(tx).timeZone` and still answers `"UTC"` for a zone name
  `Intl` refuses (`:97-101`).
- `certificate-alerts.ts:16,21`, `certificate-card.ts:34,72`, `certificate-diagnosis.ts:95`
  (passes `deps.db`, a `Database`, where `venueTimeZone` types a `Transaction`; a `Database` is
  assignable to `Transaction`, S1), `certificate-reminders.ts:59,65` — deps lose `locationId`;
  `venueTimeZone(tx)`.
- `apps/server/src/fiscal-certificate-api.ts:20,60,86,166`, `certificate-reminder-worker.ts:15,63` —
  deps lose `locationId`.
- `apps/server/src/box-health-api.ts:4,42-43,217-223` — `venue: { language }`; the wrongly-dated
  sales download names `readVenue(tx).name`.
- Forced callers (other slices' files, deletions only): `apps/server/src/alert-sources.ts:372`
  (`certificateAlertSource` deps), `apps/server/src/boot.ts:2113` (reminder loop), `:2781` (box
  health), the `mountFiscalCertificateApi` call (`:2336`) and the `certificateAlertSource` call.
- `packages/fiscal-verifactu/test/certificate-diagnosis-parent-fixtures.ts` (1 line) — the deps it
  builds lose `locationId`.

**Task S3-2 — allocation and standby checks (S3b, first half)**

| File | Lines | Change |
| --- | --- | --- |
| `allocation-operation.ts` | `:35-36` | refuse `node_mismatch` when the stored node is absent; no location comparison |
| `allocation.ts` | `:62-67`, `:370-376` | `select({ id: nodes.id })`; refuse when absent or `targetNodeId`/`prior.nodeId` differ (both kept) |
| `standby-allocation.ts` | `:44-48`, `:126-135` | source must exist; `standby.nodeId === primary.nodeId` kept; the two location comparisons go |
| `allocated-standby.ts` | `:170-181` | `primary.locationId !== standby.locationId` and the `target.locationId` read go; `sourceId` and same-node checks kept. `:215-218` builds a `ProvisionedNode` for the contract: stays until S18 |
| `cloud-preparation.ts` | `:270-273` | refuse when the stored node is absent |
| `initial-setup.ts` | `:9,625` | `readModuleAllocationSeries` now takes `Pick<ProvisionedNode, "nodeId">`, so the literal is `{ nodeId: nodeId(node.id) }` and the `locationId` import goes |

All in `packages/fiscal-verifactu/src/`. `readModuleAllocationSeries`, `validateStandbyAllocation`'s
internal readers and the like narrow to `Pick<ProvisionedNode, "nodeId">` where they read nothing
else; the seat implementations keep the contract's `ProvisionedNode` parameter type.

**Task S3-3 — dormant state, recovery, backup verification (S3b, second half)**

- `hour-dormant-standby.ts:25,52,66-67,204,211,213,249,276` — `Dormant` has five keys (`kind`,
  `version`, `binding`, `scope`, `bases`); `readDormant` demands exactly those; `configuration`
  keeps `primary.nodeId === standby.nodeId`, `binding.sourceId`, "source exists" and "target required
  and exists", and drops the three location comparisons. `:274-277` builds a contract
  `ProvisionedNode`: stays until S18.
- `hour-recovery-state.ts:58` — the `dormant.locationId !== node.locationId` clause goes.
- `backup-verification-secrets.ts:70-75` — `select id from nodes where id=?`; invalid when absent; the
  comparison with `context.source.locationId` goes (the field is the module contract's,
  `packages/module/src/backup-verification.ts:36`, S18).
- `backup-verification-history.ts:361-366` — both reads become `select id …`; invalid when either is
  absent.
- `completed-recovery-document.ts:2,34-37,41,52,59` — `readVenue(tx)` gives `name` and `timeZone`;
  the `venue === undefined` refusal goes: with no venue row the refusal is now `readVenue`'s
  `venue.not_found` instead of `sif.allocation_invalid` (`history_invalid`). The owner should see
  this code change in the PR, though a provisioned box always has the row. No test pins the old
  code: the refusal table at `completed-recovery-document.test.ts:168-185` has no missing-venue row.
- `apps/server/src/mirror-bundle.ts` and `mirror-bundle-fetch.ts` — moved to S18 (header, "Files
  moved from the design's slice"). The join bundle loses `locationId` where the design means it:
  inside the fiscal module's opaque dormant state (`reservedIdentity.modules`). S3-3 still runs their
  tests, as a check that the bundle is unchanged.

**Task S3-4 — the test helpers (S3c)**

- `packages/fiscal-verifactu/src/testing/seed.ts` (29 lines), `test/fixtures.ts` (29),
  `test/drain-fixtures.ts` (30) — every helper writes at most one `locations` row per database and
  reuses it: `seedNode`/`addNode`, `addDeviceToNode`, `seedTenantNodeSif`, `seedTenants` (TENANT_B's
  node moves under TENANT_A's location; `TENANT_B.locationId` is deleted), `seedSecondChain`,
  `seedIndependentChain`, `seedPinnedChain` (`drain-fixtures.ts:369-385,419-…,473-…`: a second chain
  is a second **node**, not a second location). Helpers keep returning `locationId` where a test
  builds a contract `ProvisionedNode` from it (S18 removes it; F2 moves what is left).
- Skip what S2-1 Step 1 already did.

### Task S3-1: certificates read the venue's zone

- [ ] **Step 1: Failing test.** In `certificate-install.test.ts`, replace `:629-637` ("reads the
  location's zone, and UTC for a missing location or an unknown zone") with "reads the venue's zone,
  and UTC for an unknown zone": `venueTimeZone(tx)` is `"Europe/Madrid"`; after `update locations set
  time_zone = 'Mars/Olympus'` it is `"UTC"`. The `:634` line (another id → UTC) is deleted: it exists
  only for a second location. Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/certificate-install.test.ts`: FAILS — with no id the old reader finds no row and answers
  `"UTC"` where `"Europe/Madrid"` is expected (Vitest does not typecheck, so the red is behavioural).
- [ ] **Step 2: Implement** the files listed; fix the forced callers.
- [ ] **Step 3: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/certificate-install.test.ts src/certificate-alerts.test.ts src/certificate-card.test.ts src/certificate-reminders.test.ts src/certificate-diagnosis.concurrency.test.ts src/certificate-install.concurrency.test.ts src/certificate-install.default-transport.test.ts src/certificate-dates.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/fiscal-certificate-api.test.ts src/certificate-reminder-worker.test.ts src/box-health-api.test.ts src/alert-sources.test.ts`
  (drop names `ls` does not find): PASS, with `locationId` removed from the deps these tests build —
  a fixture change, no assertion changed. Typecheck `@waitron/fiscal`, `@waitron/fiscal-verifactu`,
  `@waitron/server`. Fiscal pair PASS unedited. Code guards; `pnpm format:check`.
- [ ] **Step 4: Done-check** over the task's files: `boot.ts` may still print its other slices'
  lines; nothing else. Commit `-s`.

### Task S3-2: the allocation and standby "same venue" checks go

- [ ] **Step 1: Pin the halves that stay, first.** For each check in Task S3-2's table, name the
  existing case that refuses an **absent** node (stored node, source or target) with the same reason;
  where none exists, add one, run it on the unchanged code (PASS), and prove it by deletion: remove
  the existence half from a scratch copy of the check and see the case FAIL, then restore. List each
  case in the commit message.
- [ ] **Step 2: Delete the cross-location tests** (each sets a node under another location or passes
  `TENANT_B.locationId`, and exists for nothing else):
  `allocated-standby.test.ts:282` and `:613`; `allocation-operation.test.ts:680`;
  `allocation.test.ts:419` and `:805`; `cloud-preparation.test.ts:487`;
  `dormant-allocation.test.ts:236`; `standby-allocation.test.ts:182`. Other uses of `TENANT_B.nodeId`
  as "another node" (`standby-allocation.test.ts:169-177,230,271`, `allocated-standby.test.ts:402`,
  `dormant-takeover.test.ts:351`, `registro-sif.test.ts:88,324`) stay.
- [ ] **Step 3: Implement** Task S3-2's table. Run the eight test files named above plus
  `initial-setup.test.ts`, `initial-cloud-setup.test.ts`, `allocated-lifecycle.test.ts`,
  `dormant-takeover.test.ts`, `registro-sif.test.ts`: PASS, Step 1's cases included. Fiscal pair PASS
  unedited. Typecheck `@waitron/fiscal-verifactu`; code guards; `pnpm format:check`.
- [ ] **Step 4: Done-check** with the narrower pattern over Task S3-2's six files: only
  `allocated-standby.ts:215-218`'s contract literal may print. Commit `-s`.

### Task S3-3: dormant state, recovery and backup verification

- [ ] **Step 1: Failing test.** In `hour-dormant-standby.test.ts`, a state with exactly the five keys
  is read; today `readDormant` refuses it (`reservation_mismatch`, it demands six at `:52`). Delete
  `"location"` from the `it.each` list at `:131` and its branch at `:147`. Run
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/hour-dormant-standby.test.ts`: FAIL.
- [ ] **Step 2: Delete** `hour-recovery-state.test.ts:217` ("refuses a target location that differs…")
  and `backup-verification-secrets.test.ts:399` ("requires the captured source node to belong to its
  captured location"). Before deleting the latter, name or add (as Task S3-2 Step 1) the case that marks
  the backup invalid when the captured source node is absent; same for `reservationRow`'s source and
  target in `backup-verification-history.test.ts`.
- [ ] **Step 3: Implement** Task S3-3's files. Run `hour-dormant-standby`, `hour-recovery-state`,
  `hour-recovery-preparation`, `hour-standby-activation`, `backup-verification-secrets`,
  `backup-verification-history`, `backup-verification`, `completed-recovery-document`,
  `completed-recovery-zone` tests in `@waitron/fiscal-verifactu`, and
  `pnpm --filter @waitron/server exec vitest run src/mirror-bundle.test.ts src/mirror-bundle-api.test.ts src/allocated-standby-host.test.ts`
  (PASS: the bundle still carries `designated.locationId`). Fiscal pair PASS unedited. Typecheck;
  code guards; `pnpm format:check`.
- [ ] **Step 4: Done-check** with the narrower pattern over the five fiscal-verifactu files: only
  `hour-dormant-standby.ts:274-277`'s contract literal may print. Commit `-s`.

### Task S3-4: the fiscal-verifactu test helpers hold one venue row

- [ ] **Step 1:** Change the helpers listed. A helper's change is a test-fixture change; it must not
  change a test's assertion. Run the whole package once, because 40-odd test files import these
  helpers (fiscal-check.md, "Test files with domain-location lines"):
  `pnpm --filter @waitron/fiscal-verifactu test` — check free memory first
  (`memory_pressure | grep free`): the package also runs browser tests. Read the `Tests` count.
- [ ] **Step 2:** Every failure is either a cross-location test Tasks S3-2 and S3-3 missed (delete it and
  name it) or a test that relied on two rows by accident (fold it onto one). Fiscal pair PASS
  unedited. `pnpm format:check`.
- [ ] **Step 3: Done-check** `git grep -n -E 'insert\(locations\)' -- packages/fiscal-verifactu/src/testing packages/fiscal-verifactu/test`
  prints only the guarded first-row inserts. Commit `-s`.

### Open PRs touching S3's files

- **#2369 A696** — `completed-recovery-document.ts` (zone classification), `boot.ts`; the base.
- **#2373 W41s-7** — `allocation-operation.ts`, `allocation.ts`, `backup-verification-history.ts`,
  `hour-recovery-state.ts`, `boot.ts`. Rebase around it; its fiscal identity changes are why S3's
  "existence half kept" cases matter.

---

## S4 — Standby adoption stays refused, on purpose

**Goal.** Adopting a standby fails today at one step only because the standby's `nodes` row needs a
`location_id` that an adopted mirror cannot supply (`apps/server/src/finish-adoption.ts:32-43`). S25
drops that column, which would let the insert through and run each module's
`provisioning.standby.establish` — the fiscal module's dormant-standby state — with no venue rows
copied. S4 makes the refusal deliberate: `establishReservedStandbyIdentity` refuses with a named
code, before inserting the `nodes` row, while the database holds no venue row. The outcome stays
today's: `runFinishAdoption` logs `adoption.establish_failed` and keeps the latch. `PendingAdoption`
loses `locationId`.

| | |
| --- | --- |
| Depends on | S1 (`venueLocationId`). **Must land before S25** (design §3, §8 risk 4); S25's plan should name S4's merge commit |
| Lands | **owner**, rule (c): the path that writes an invoicing-system identity |
| Branch | `refactor/a1301-s4-adoption-refusal` |
| Review path | **FULL** (fiscal identity, cross-package contract), two Codex angles |
| Reset | a box holding `<state>/pending-adoption.json` is reset (design §4); in practice every adopted mirror |

### The refusal code, settled against the registry

**`mirror.venue_not_copied`**, `Record<string, never>`, registered in `apps/server/src/errors.ts`
beside the other `mirror.*` codes (`:1121-1160` at `7e824ae233`: `mirror.not_provisioned`,
`mirror.standby_invalid`, `mirror.vault_not_empty`, …). The design's proposal `adoption.venue_not_copied`
is not taken:

- no `adoption.*` code exists in any registry — `git grep -n -E '"adoption\.' 7e824ae233 --
  'apps/server/src/errors.ts' 'packages/*/src/errors.ts'` prints nothing; `adoption.established` and
  `adoption.establish_failed` are log event names (`finish-adoption.ts:124,128`), not codes;
- the house rule is "a code names the DOMAIN CONCEPT" (`apps/server/src/errors.ts:12-14`), and the
  registry already names an adopted standby's refusals `mirror.*`;
- `git grep -n venue_not_copied 7e824ae233` prints nothing, so the name is free.

Doc comment for the registry entry (one sentence, an invariant): "An adopted mirror's standby
identity was not established because this database holds no venue row; nothing copies the main
box's rows to a mirror yet." It is a log-only code: no screen shows it, so it needs no dashboard
or setup wording (`scripts/errors-reachable.test.ts` checks it is thrown from a file that imports
`./errors.js`; `reserved-identity.ts:21` already does).

### Where the check sits and what it reads

In `apps/server/src/reserved-identity.ts`, inside the transaction, after the idempotency check
(`:66`) and before `insertReservedNodeTx` (`:73`):

```ts
if ((await readOperationalVenueIds(tx)).length === 0)
  throw new AppError("mirror.venue_not_copied", {});
```

`readOperationalVenueIds` (`packages/provisioning/src/tenant-guard.ts:22-27`) is the live-venue
guard's reader, already imported by `adopt.ts:131`. Using it means S23, which switches that reader
to `venue_settings` (design §3, "S23 … the live-venue guard and S4's check read `venue_settings`"),
moves S4's check with it, with no S4 edit. It sits inside the transaction, at the point where the
foreign key refuses today, so module operations are prepared exactly as today (`:64`) and the
outcome is today's.

### Files

TSV slice `S4`, 5 files, one task each half:

- `apps/server/src/reserved-identity.ts:19,47,75,83` — the check above (Task S4-1); then (Task S4-2) the
  `locationId` argument goes, and the two values that still need an id read `venueLocationId(tx)`
  after the check: `insertReservedNodeTx`'s `locationId` (fills `nodes.location_id`, the helper's
  stated use; S25 deletes it) and the contract `ProvisionedNode` handed to each module's `establish`
  (S18 removes the field).
- `apps/server/src/finish-adoption.ts:34-35,38,46,80,112` — `PendingAdoption.locationId` and
  `EstablishArgs.locationId` go; the comment at `:28-44` is rewritten (Task S4-2 Step 3).
- `apps/server/src/adopt.ts:196` — `writePendingAdoption` stops writing `locationId`. `:205`
  (`persistTrading`'s `locationId`, the box's `NodeConfig`) stays: S18's.
- `packages/db/src/reserved-identity.ts:13` — **no change in S4**: `ReservedNodeInput.locationId`
  fills the column; S25 removes it with the column.
- `packages/provisioning/src/tenant-guard.ts:25` — **no change in S4**: S4 calls the reader; S23
  switches what it reads.
- `apps/server/src/errors.ts` — the new code (not in the TSV: it has no pattern match).
- Forced caller: `apps/server/src/testing/dormant-contract.ts:67` (F5's file) drops the argument.
- Tests: `apps/server/src/reserved-identity.test.ts`, a new
  `apps/server/src/reserved-identity.no-venue-key.test.ts`, `finish-adoption.test.ts`,
  `adopt.test.ts`; the pending-file fixtures in `adoption-allocation-refusal.test.ts`,
  `boot.adoption-allocation.test.ts`, `allocated-standby-host.test.ts`, `boot.mirror.test.ts`,
  `boot.failed-start.test.ts`, `boot.node-configuration.test.ts`, `reset-request.test.ts` lose the
  field where they type it (`git grep -n -l -E 'PendingAdoption|writePendingAdoption|pending-adoption' -- '*.test.ts'`).

### Task S4-1: the named refusal, with the foreign-key control

**Interfaces.** Produces the code `mirror.venue_not_copied`. `establishReservedStandbyIdentity`
keeps its signature in this task.

- [ ] **Step 1: Failing test with the real schema.** In `reserved-identity.test.ts`, "refuses with
  mirror.venue_not_copied before writing the standby's node when no venue row exists": delete the
  `beforeEach` row (`delete from locations`; nothing references it yet), call
  `establishReservedStandbyIdentity({ ownerDb: suite.db }, { locationId, standby, nodeName: "cloud",
  filingModule: null, taxModule: null, modules: [], reserved: { modules: {}, series: [], endorsement:
  {...ENDORSEMENT, nodeId: standby.nodeId, publicKey: standby.publicKey} } })`, and expect:

  ```ts
  await expect(call).rejects.toMatchObject({ code: "mirror.venue_not_copied" });
  expect(await count("nodes", standby.nodeId)).toBe(0);
  expect(await count("invoice_series", standby.nodeId)).toBe(0);
  ```

  Add a second case with the fiscal module, built as `:68-89` builds it
  (`preparedReservation`, `allocatedStandbyModules`), deleting the venue row after the fixture is
  prepared, and also expecting `select count(*) from fiscal_reservations` to be unchanged — the
  dormant-standby state the design's §3 worries about. Run
  `pnpm --filter @waitron/server exec vitest run src/reserved-identity.test.ts`: both FAIL — today
  the error is the engine's `FOREIGN KEY constraint failed` (errcode 787, `finish-adoption.ts:38-40`),
  which has no `code`.

- [ ] **Step 2: Failing control — the `nodes` foreign key removed in a scratch schema.** New file
  `apps/server/src/reserved-identity.no-venue-key.test.ts`, its own `useVenueDb` with
  `migrationOptionsFor(manifestSets(), null)` (own file, so the altered schema cannot leak into
  another file's cases). Before the case, rebuild `nodes` without its key to `locations`, as S25's
  migration will leave it:
  1. `pragma foreign_keys = off`;
  2. read `select sql from sqlite_master where type = 'table' and name = 'nodes'`; remove the clause
     matching `/,\s*FOREIGN KEY \(`location_id`\) REFERENCES `locations`\(`id`\)[^,)]*/` and
     **assert exactly one match was removed** (otherwise the control controls nothing — the clause
     text is `0000_baseline.sql:59`);
  3. create `nodes_scratch` from the edited text, copy the rows, `drop table nodes`,
     `alter table nodes_scratch rename to nodes`, `pragma foreign_keys = on`;
  4. assert `pragma foreign_key_list(nodes)` lists no row whose `table` is `locations`, and that
     `pragma foreign_key_check` prints nothing.
  If the rename is refused by a trigger reading `nodes` (design §4 found none in the drizzle SQL,
  but code-made triggers are not in that scan), drop and recreate that trigger around the rebuild
  in the test, and name it in the commit.
  Then the same case as Step 1's first: tenant seeded, **no** `locations` row, `locationId` set to
  `randomUUID()`. Expect `mirror.venue_not_copied` and zero `nodes` rows.
  Run `pnpm --filter @waitron/server exec vitest run src/reserved-identity.no-venue-key.test.ts`
  on the unchanged code. **Expected: FAIL because the call resolves and one `nodes` row exists** —
  this is the measurement that today's refusal rests on the foreign key alone. If it fails for any
  other reason (the rebuild itself), fix the rebuild until the failure is that one.

- [ ] **Step 3: Implement.** Add the registry entry; add the check (above). Run both files: PASS.
  Run `finish-adoption.test.ts`: its real-database case at `:155-198`, which inserts a venue row and
  expects `adoption.established`, PASSES unedited — the positive control that a copied venue is not
  refused.

- [ ] **Step 4: The latch outcome.** In `finish-adoption.test.ts`, a real-database case with a
  tenant and no venue row: `runFinishAdoption` logs
  `{ level: "error", event: "adoption.establish_failed", fields: { code: "mirror.venue_not_copied" } }`
  and `readPendingAdoption(dir)` is still the record written. (On the code before Step 3 the
  `code` field is whatever `codeOf` makes of the engine error; this case was written after Step 3,
  so check it red by commenting the check out once, then restore.)

- [ ] **Step 5: Runs.** `pnpm --filter @waitron/server exec vitest run src/reserved-identity.test.ts src/reserved-identity.no-venue-key.test.ts src/finish-adoption.test.ts src/adopt.test.ts src/adoption-allocation-refusal.test.ts src/boot.adoption-allocation.test.ts src/allocated-standby-host.test.ts`:
  PASS. The two `module.operation_invalid` refusals (`adoption-allocation-refusal.test.ts:235-241`,
  `boot.adoption-allocation.test.ts:128`) come from `assertAdoptionModules`, before the establish
  step, and stay unedited. Fiscal pair PASS unedited.
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/module-seams.test.ts scripts/english-only.test.ts scripts/personal-log-params.test.ts scripts/live-subscriptions.test.ts`.
  `pnpm --filter @waitron/server typecheck`; `pnpm format:check`. A new test file in `apps/server`:
  its shards are packed by `scripts/test-durations.mjs`'s table; check `scripts/vitest-duration-sequencer.test.mjs`
  still passes. Commit `-s`.

### Task S4-2: `PendingAdoption` loses `locationId`

- [ ] **Step 1: Failing test.** In `adopt.test.ts`, replace `:299`
  (`expect(pending.locationId).toBe(DESIGNATED.locationId)`) with
  `expect(pending).not.toHaveProperty("locationId")` — the design decision is §4 "Host files": the
  pending record names no location. Run it: FAIL (`adopt.ts:196` writes it).
- [ ] **Step 2: Implement** the Task S4-2 changes in `adopt.ts`, `finish-adoption.ts`,
  `reserved-identity.ts` and the forced caller. Fixtures lose the field: `finish-adoption.test.ts:31`
  and `:168` (the real-database case keeps inserting its venue row, which the check now reads); the
  `locationId` argument in `reserved-identity.test.ts` and `reserved-identity.no-venue-key.test.ts`
  calls. No assertion besides `adopt.test.ts:299` changes.
- [ ] **Step 3: Rewrite the comment** at `finish-adoption.ts:28-44`. Per the house comment rule,
  keep only the invariant and a pointer:

  > The pending standby identity a boot establishes. Establishing refuses with
  > `mirror.venue_not_copied` while this database holds no venue row (`reserved-identity.ts`), and
  > nothing copies the main box's rows to a mirror yet, so an adopted mirror stays adoption-pending
  > until a replacement copy mechanism lands (`docs/backlog.md` → *Replication, membership &
  > failover*).

  The measurement the old comment recorded (errcode 787) moves to the commit message, with Task S4-1
  Step 2's output as its replacement receipt. Check the three setup comments that point here
  (`apps/setup/src/screens/done-screen.ts:88`, `restore-screen.ts:33`, `role-screen.ts:11`,
  `setup-app.ts:1783`) still read true; they name `PendingAdoption` and the header, not the cause.
- [ ] **Step 4: Runs** as Task S4-1 Step 5, plus `src/boot.mirror.test.ts src/boot.failed-start.test.ts
  src/boot.node-configuration.test.ts src/reset-request.test.ts`. PASS; fiscal pair unedited.
- [ ] **Step 5: Done-check** `git grep -n -E "$P" -- apps/server/src/adopt.ts apps/server/src/finish-adoption.ts apps/server/src/reserved-identity.ts`:
  only `adopt.ts:205` (`persistTrading`, S18) and the two `venueLocationId` lines in
  `reserved-identity.ts` may print. Commit `-s`.

### Open PRs touching S4's files

None of #2373, #2375, #2376, #2377 touches `adopt.ts`, `finish-adoption.ts`, either
`reserved-identity.ts` or `tenant-guard.ts`; #2373 touches `apps/server/src/errors.ts` (a registry
append; rebase). Checked by intersecting each PR's `gh pr diff <n> --name-only` with the files above;
#2369's list (too large for `gh pr diff`) by `git diff --name-only <merge-base> 7e824ae233`.

---

## Notes shared by S5–S8

Lines in S5–S8 were read at main `abfe271663`; A696's lines at `7e824ae233`. Open-PR lists come from
`gh pr list --state open --json number,headRefName,files`, completed with
`gh api repos/{owner}/{repo}/pulls/<n>/files --paginate` because `gh pr list` stops at 100 files a
PR (#2369 has 381, #2373 has 131).

- **Accessor names.** `readVenue`, `readVenueClock`, `readVenueClockAndPlace`, `venueLocationId` and
  the `VenuePlace` type come from `@waitron/db` (S1), which `@waitron/catalogue`,
  `@waitron/venue-service`, `@waitron/reporting` and `apps/server` already depend on.
- **Which cross-location cases go.** The cases listed in each task were found by their wording
  (`another location|another venue|other location|second venue|otherLocation|…`). The run has the
  final say. When a slice's change makes a case fail, and the case proves the check that slice
  removed, it is deleted whatever file it sits in. Any other failing case is fixed, not deleted (the
  header's "A database with a second venue row").
- **No screen changes in S5–S8.** None of these slices touches a dashboard or till screen file.
  S5 changes four dashboard API client methods that no screen calls (`git grep` for
  `listLocationCatalogues` finds only `client.ts` and two tests). It also deletes the wording of an
  error code that is no longer raised. So no look check is due. If an implementer finds a screen to
  change, the task stops and says so.
- **Live subscriptions.** No task here renames a live query, and none changes the tables a live query
  depends on: the readers still read the same tables, only unfiltered. `live-subscriptions` runs
  anyway, with the code guards.
- **Review path.** All four slices are FULL: each removes a by-id location scope from reads and writes
  ("tenant isolation or a by-id read").

---

## S5 — Catalogue: the default and extra menus belong to the venue

**Goal.** The catalogue package stops taking a location id. The default menu and the extra menus
offered are the venue's. Its readers of receipt languages and accessible menus take no id. The four
management routes move from `/management-api/locations/:locationId/…` to
`/management-api/venue/catalogues`, `/management-api/venue/catalogues/:catalogueId` and
`/management-api/venue/default-catalogue`. The error code `location.not_found` is deleted, because
nothing can name a missing location any more. The tables stay `locations.catalogue_id` and
`location_catalogues` until S23 renames them.

- **Depends on:** S1. It lands before S6 (S6's `department-receipt-languages.ts` change builds on
  it): S1 → S5 → S6 → S7.
- **Lands:** lane. None of rules a–d applies. Three call lines sit in S2's files
  (`invoice-document.ts:101`, `receipt-presentation.ts:21`, `apps/server/scripts/demo-seed/seed.ts:109-110`):
  under the header's rule "Calls into another slice's file", S5 does not edit them while S2 has not
  landed (below).
- **Branch:** `refactor/a1301-s5-catalogue`
- **Review path:** FULL. It changes a cross-package contract (the `@waitron/catalogue` exports
  that `apps/server` and the scripts use, and the HTTP routes between dashboard and server). It
  also removes a by-id scope from writes.

### Files

| File | Matching lines | What changes |
| --- | --- | --- |
| `packages/catalogue/src/operations.ts` | 8, 1302-1483 | Every `locationId` parameter is dropped. Renamed: `assignCatalogueToLocation`→`assignCatalogueToVenue`, `setLocationDefaultCatalogue`→`setVenueDefaultCatalogue`, `addCatalogueToLocation`→`addCatalogueToVenue`, `removeCatalogueFromLocation`→`removeCatalogueFromVenue`, `listCataloguesForLocation`→`listCataloguesForVenue`, `LocationCatalogue`→`VenueCatalogue`, `insertLocationCatalogue`→`insertVenueCatalogue`. These keep their names and only lose the id: `resolveAccessibleCatalogueIds`, `listAccessibleCatalogues`, `listAvailableProducts`, `readInvoiceLocales`, `readReceiptLanguage`. The default and the receipt languages are read through `readVenue(tx)` (`defaultCatalogueId`, `invoiceLocales`). The default is written as `update(locations).set({ catalogueId })` with no `where`, because the table holds one row. Member rows are inserted with `locationId: await venueLocationId(tx)`. Member reads and deletes lose the `location_id` filter. Both `location.not_found` throws (1327, 1349) go. Comments say "the venue's menu list". |
| `packages/catalogue/src/provisioning.ts` | 2, 55-66, 100, 119, 128-133 | The seed reads `readVenue(tx)` (province, receipt languages, default menu) and the tenant's country with `readTenant(tx)`. It no longer reads `node.locationId`. It sets the first menu with `assignCatalogueToVenue(tx, catalogueId)` in place of the raw `update locations` (128-129). The member row gets `venueLocationId(tx)`. |
| `packages/catalogue/src/index.ts` | 9, 13, 22, 28, 30, 41 | The renamed exports. |
| `packages/catalogue/src/menu-types.ts` | 14, 122, 153-154 | Comments only: "a location's menu list" → "the venue's menu list". |
| `packages/catalogue/src/errors.ts` | 93-94 | `"location.not_found"` and its comment are deleted (Task S5-2). |
| `apps/server/src/catalogue-api.ts` | 19, 67, 95-96, 123, 134, 325, 451, 1146, 1280-1320, 1628-1631 | Task S5-1: the handlers call the new names and stop reading the path id (1286, 1295, 1305, 1315). `venueTimeZone` (1145-1146) uses `(await readVenueClock(tx)).timeZone`. Task S5-2: the four routes move to `/management-api/venue/…`, `"location.not_found": 404` (325) goes, and the comments at 134, 451, 1280 and 1628-1631 say "the venue's settings" / "the venue's menu list". `venueCfg` stays, because 859 and 1406 still use it. |
| `apps/till/src/widgets/menu-switcher.ts` | 34 | Comment: "a single-menu location" → "a single-menu venue". |

These are outside S5's own files and change by one argument at the call (header rule "Calls into another slice's file"):

| Caller (owning slice) | Line | Change |
| --- | --- | --- |
| `apps/server/src/department-receipt-languages.ts` (S6) | 17 | `readReceiptLanguage(tx)`. `cfg` stays: `:27` still passes it to `readOfferedReceiptLanguages`, which is S2-5's (moved from S1). If S2 has landed, `cfg` is now unused: drop it (`:15`, the `LocationId` import at `:4`) and its callers' argument, `department-receipt-api.ts:73-75` and `department-receipt-draft.ts:34` (S6), `receipt-preview-api.ts:314` (S11); otherwise S2-5 does. |
| `apps/server/src/venue-settings-api.ts` (S1's rename of `location-settings-api.ts`) | 66-68 at A696's head | `readInvoiceLocales(tx)`, if S1 left the call (S1 reads the languages from `readVenue`). |
| `apps/server/src/invoice-document.ts` (S2) | 101 | **Not edited while S2 has not landed** (header rule): `readReceiptLanguage` keeps an ignored optional second parameter, `_locationId?: string`, so this call compiles unchanged, and S2 drops the argument. If S2 has landed, `readReceiptLanguage(tx)` here, argument only. |
| `apps/server/src/receipt-presentation.ts` (S2) | 21 | As `invoice-document.ts:101`. |
| `apps/server/src/page-printers-api.ts` (S10) | 149 | `readReceiptLanguage(tx)` |
| `apps/server/src/print-api.ts` (S10) | 1365 | `readReceiptLanguage(tx)` |
| `apps/server/src/receipt-print.ts` (S10) | 197 | `readReceiptLanguage(tx)` |
| `apps/server/src/working-order.ts` (S11) | 784 | `readInvoiceLocales(tx)` |
| `apps/server/scripts/allergens-demo.ts` (S19) | 192, 196 | `assignCatalogueToVenue(tx, cat.id)`, `listAvailableProducts(tx)` |
| `apps/server/scripts/demo-seed/seed-catalogue.ts` (S19) | 267-270 | `assignCatalogueToVenue` / `addCatalogueToVenue` without `locationId` |
| `apps/server/scripts/demo-seed/seed.ts` (S2) | 109-110 | As `invoice-document.ts:101`: `listAvailableProducts` also keeps an ignored optional `_locationId?: string` while S2 has not landed; otherwise `listAvailableProducts(tx)`, `readReceiptLanguage(tx)`. |
| `apps/server/src/testing/adjustment-venue.ts:430`, `bill-venue.ts:196`, `party-venue.ts:160-161`, `split-extras-venue.ts:60`, `stream-pause-scenario.ts:379`, `venue-fixtures.ts:127`, `zone-offers.ts:192` (F5) | as listed | new names, no id |
| `packages/catalogue/test/fixtures.ts:208` (F2) | 208 | `assignCatalogueToVenue(tx, catalogue.id)` |
| Test files | 174 call lines in 82 files (75 under `apps/server`, 6 under `packages/catalogue`, 1 under `apps/dashboard`) | Same rewrite. Counted with `git grep -c -E '(assignCatalogueToLocation\|…\|readReceiptLanguage)\('` over `*.test.ts`. `assignCatalogueToLocation(` alone is 89 lines in 73 files. |

Dashboard (Task S5-2): `apps/dashboard/src/api/client.ts:499-502,3114-3140` (an S12 file; only these
lines). `LocationCatalogueSummary` becomes `VenueCatalogueSummary`. The methods become
`listVenueCatalogues()`, `addVenueCatalogue(catalogueId)`, `removeVenueCatalogue(catalogueId)` and
`setVenueDefaultCatalogue(catalogueId)`, on the new paths. Also
`apps/dashboard/src/i18n/codes.ts:426-429` (an S19 file; only this entry) loses
`"location.not_found"`.

Docs (Task S5-2), the entries this change makes stale (CLAUDE.md §6):
- `docs/backlog.md:1206-1208` and `docs/backlog/catalogue.md:563-577`. "A location's menu list is
  read by no sale" becomes "The venue's menu list is read by no sale". It names the routes
  `/management-api/venue/catalogues…` and keeps "owner to decide whether to retire" as written. The
  heading and its anchor change together.
- `docs/backlog/architecture.md:773-779` ("Loose ends left by A394-3"). Delete the first bullet
  (unknown location on `GET …/locations/:locationId/catalogues`) and the fourth (the catalogue PATH
  location's `location.not_found`). Reword the second to "A malformed menu path id still answers
  400 `shared.invalid_id` …". Reword the third to "The two venue menu routes' body menu id keeps 404
  until A394-11."

### Task S5-1: the catalogue package takes no location, and every caller follows

**Files:** the `packages/catalogue/src` rows above (except `errors.ts`), `catalogue-api.ts`'s
handler bodies, every caller in the second table, and the tests that call them.

**Interfaces.** Produces (exact):
`assignCatalogueToVenue(tx, catalogueId): Promise<void>`,
`setVenueDefaultCatalogue(tx, catalogueId): Promise<void>`,
`addCatalogueToVenue(tx, catalogueId): Promise<void>`,
`removeCatalogueFromVenue(tx, catalogueId): Promise<void>`,
`listCataloguesForVenue(tx): Promise<VenueCatalogue[]>`,
`resolveAccessibleCatalogueIds(tx)`, `listAccessibleCatalogues(tx)`, `listAvailableProducts(tx)`,
`readInvoiceLocales(tx): Promise<string[]>`,
`readReceiptLanguage(tx): Promise<{ locale; invoiceLocales }>`. The return shapes are unchanged.
While S2 has not landed, `readReceiptLanguage` and `listAvailableProducts` take a second parameter
`_locationId?: string` that they never read, for S2's three call lines; S2 or S18 removes it.
Consumes S1's `readVenue`, `venueLocationId`, `readVenueClock`.

- [ ] **Step 1: Failing tests.** In `packages/catalogue/src/operations.test.ts`, change the
  "setLocationDefaultCatalogue changes the default and keeps the old default sellable" case
  (`:1602`) to call `assignCatalogueToVenue(tx, house.id)`, `addCatalogueToVenue(tx, day.id)`,
  `setVenueDefaultCatalogue(tx, day.id)` and `listAccessibleCatalogues(tx)`. Its assertion stays:
  `[{ id: day.id, name: "Día", isDefault: true }, { id: house.id, name: "Casa", isDefault: false }]`.
  Add `it("readReceiptLanguage reads the venue's first saved language", …)`: it sets
  `invoice_locales = '["gl-ES","es-ES"]'` on the one `locations` row and expects
  `await readReceiptLanguage(tx)` to equal `{ locale: "gl-ES", invoiceLocales: ["gl-ES", "es-ES"] }`.
- [ ] **Step 2: Watch them fail.**
  `pnpm --filter @waitron/catalogue exec vitest run src/operations.test.ts -t "keeps the old default sellable|venue's first saved language"`.
  Expected: FAIL. `assignCatalogueToVenue` is not exported, and `readReceiptLanguage(tx)` throws
  `no location undefined`.
- [ ] **Step 3: Change `operations.ts`, `provisioning.ts`, `index.ts` and `menu-types.ts`** as the
  Files table says. `readInvoiceLocales(tx)` returns `(await readVenue(tx)).invoiceLocales`.
  `resolveAccessibleCatalogueIds(tx)` takes the default and the languages from `readVenue(tx)`, and
  the members from every `location_catalogues` row. On a database with no venue row `readVenue`
  refuses `venue.not_found` (S1); the old "[] for no such location" answer goes with the id (Step 5).
- [ ] **Step 4: Rewrite the callers with a codemod.** Write the codemod in the worktree's scratch
  directory (outside the repository tree) and run it over
  `git grep -l -E '(assignCatalogueToLocation|setLocationDefaultCatalogue|addCatalogueToLocation|removeCatalogueFromLocation|listCataloguesForLocation|resolveAccessibleCatalogueIds|listAccessibleCatalogues|listAvailableProducts|readInvoiceLocales|readReceiptLanguage|LocationCatalogue)' -- apps packages ':!packages/catalogue/src/operations.ts' ':!apps/server/src/invoice-document.ts' ':!apps/server/src/receipt-presentation.ts' ':!apps/server/scripts/demo-seed/seed.ts'`
  (the three S2 files are excluded while S2 has not landed).
  It does exactly this for single-line calls: rename as in the Files table, and delete the second
  argument (`fn(tx, X, Y)` → `fnNew(tx, Y)`; `fn(tx, X)` → `fn(tx)`). Then run
  `pnpm --filter @waitron/catalogue typecheck && pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/dashboard typecheck`
  and fix by hand what it lists: multi-line calls, and the one-level cascades in
  `department-receipt-languages.ts` (only if S2 has landed) and `venue-settings-api.ts`. In `catalogue-api.ts`, delete
  the now-unused `const locationId = requireUuidParam(…)` lines (1286, 1295, 1305, 1315). The path
  segment stays until Task S5-2.
- [ ] **Step 5: Delete the cases that only proved the location check**, and nothing else:
  - `packages/catalogue/src/operations.test.ts:1506` — keep the first `expect` (the venue's list).
    Delete the `readInvoiceLocales(tx, crypto.randomUUID())` → `[]` assertion (`:1512`) and the
    "and [] for no such location" words in the title.
  - `operations.test.ts:1528` "readReceiptLanguage throws for no such location" — delete.
  - `operations.test.ts:1645-1675`, the `describe.each` "with an id naming nothing". Delete
    "refuses an unknown location with location.not_found" (`:1649`) and "names the location first
    when both ids are unknown" (`:1666`). Keep "refuses an unknown catalogue … with
    catalogue.not_found" (`:1658`) and drop "at a real location" from its title.
  - `operations.test.ts:1630-1643` — the count stays, now over every row:
    `select count(*) as count from location_catalogues` (the venue is the only owner).
  - `apps/server/src/catalogue-api.test.ts:1495-1499` (a non-uuid locationId → `shared.invalid_id`)
    and `:1501-1531` (the `describe.each` "at a location that does not exist") — delete. Its
    `beforeEach` (`:1367-1371`) loses both `where` clauses.
- [ ] **Step 6: Run.**
  `pnpm --filter @waitron/catalogue exec vitest run` (the package is small; read the `Tests` count).
  `pnpm --filter @waitron/server exec vitest run src/catalogue-api src/department-receipt src/receipt-print src/working-order.test.ts scripts/demo-seed`.
  The guards. `pnpm exec vitest run scripts/alert-codes.test.ts`. The three typechecks from
  Step 4. `pnpm format:check`.
  Expected: all pass. The two Step 1 cases pass.
- [ ] **Step 7: Done-check.**
  `git grep -n -E "$P" -- packages/catalogue/src apps/till/src/widgets/menu-switcher.ts`.
  It may print: `operations.ts`'s import of `locationCatalogues, locations` and its uses of those
  two tables (renamed by S23), `venueLocationId` calls, the ignored `_locationId` parameters (S2 or
  S18), `errors.ts:93-94` (Task S5-2), and nothing else. Also `git grep -n -E 'CatalogueToLocation|ForLocation\(|LocationDefaultCatalogue|LocationCatalogue\b' -- apps packages`.
  Expected: only the dashboard client lines that Task S5-2 changes.
- [ ] **Step 8: Commit** (`git commit -s`), naming the cross-slice call lines in the body.

### Task S5-2: routes move to `/management-api/venue/…`, `location.not_found` goes, the dashboard client follows

- [ ] **Step 1: Failing test.** In `apps/server/src/catalogue-api.test.ts`, change `cataloguesPath`
  and `defaultPath` (`:1373-1374`) to `/management-api/venue/catalogues` and
  `/management-api/venue/default-catalogue`. Change
  `apps/server/src/catalogue-api.full-manifest.test.ts:344-366` to the same paths (still expecting
  403 for a staff session). In `apps/dashboard/src/api/client.test.ts:615-660`, rename the four
  cases to the new methods. They expect `fetchImpl` to have been called with
  `"/management-api/venue/catalogues"`, `"/management-api/venue/catalogues/c2"` and
  `"/management-api/venue/default-catalogue"`, and the call takes no location argument.
- [ ] **Step 2: Watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts src/catalogue-api.full-manifest.test.ts`.
  Expected: FAIL, 404 where 200/204/403 is expected.
  Check free memory before the dashboard's browser run (`memory_pressure | grep free`; well above
  15%), then `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts`. Expected:
  FAIL, `listVenueCatalogues is not a function`.
- [ ] **Step 3: Change** the four `app.get/post/delete/put` paths in `catalogue-api.ts:1283-1320`.
  Delete `"location.not_found": 404` (325) and `packages/catalogue/src/errors.ts:93-94`. Delete the
  `apps/dashboard/src/i18n/codes.ts:426-429` entry and its case in
  `apps/dashboard/src/i18n/codes.test.ts:603-610`. Change `client.ts` and its a11y mock
  (`apps/dashboard/src/dashboard-app.a11y.test.ts:80`: `listVenueCatalogues`). Reword the comments
  and the backlog entries listed above.
- [ ] **Step 4: Run.** Step 2's commands (now PASS).
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/codes.test.ts src/dashboard-app.a11y.test.ts`.
  The guards, plus `scripts/alert-codes.test.ts` and `scripts/errors-reachable.test.ts` (in the
  guard list). `pnpm --filter @waitron/catalogue typecheck && pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/dashboard typecheck`.
  `pnpm format:check`.
  Then `git grep -n 'location.not_found' -- apps packages scripts`. Expected: nothing.
- [ ] **Step 5: Done-check.**
  `git grep -n -E "$P" -- packages/catalogue/src apps/server/src/catalogue-api.ts apps/till/src/widgets/menu-switcher.ts`.
  It may print: `operations.ts`'s `locationCatalogues`/`locations` table names, `venueLocationId`
  calls, and `provisioning.ts`'s `locationCatalogues` import (renamed by S23). Nothing in
  `catalogue-api.ts`. Also `git grep -n -E 'Location(Catalogue|Catalogues)|locations/' -- apps/dashboard/src`.
  Expected: nothing.
- [ ] **Step 6: Commit** (`git commit -s`).

### Open PRs touching S5's files

- **#2369** (`feat/a696-startup-zone-validation`): `apps/dashboard/src/api/client.ts`,
  `apps/dashboard/src/i18n/codes.ts`, `codes.test.ts`, `apps/server/scripts/allergens-demo.ts`,
  `apps/server/scripts/demo-seed/seed.ts`, `apps/server/src/location-settings-api.ts`,
  `apps/server/src/testing/adjustment-venue.ts`, `bill-venue.ts`, `party-venue.ts`,
  `apps/server/src/working-order.ts`, `docs/backlog.md`. It lands before S1, so S5 is written on top
  of it.
- **#2373** (`feat/w41s7-conflict-recovery`): `apps/server/src/working-order.ts`, `docs/backlog.md`.
- **#2377** (`chore/a1008-retire-sale-script`): `docs/backlog.md`, `docs/backlog/catalogue.md`.
- **#2375** (`feat/a1268-clock-ins-per-venue`): `docs/backlog.md`.

---

## S6 — Venue-service, service side

**Goal.** Venue-service's departments, zone policies, sale policies, order service contexts,
department receipts and transfers, routing, kitchen screens and notices, station times, floor
layouts and service deletes stop narrowing by location. Every row in the database is the venue's.
Clock reads use `readVenueClock(tx)`. Rows still written with a `location_id` get
`venueLocationId(tx)`. Exported functions keep their `cfg` (renamed `_cfg` when unused; header, "Exported functions behind a module contract keep their `cfg`");
local functions drop it. The checks that refused "another location's" department, zone, station,
course, period, order or device go with their tests.

- **Depends on:** S5 (and so S1). S5 has already removed `readReceiptLanguage`'s id.
- **Lands:** lane. None of rules a–d applies.
- **Branch:** `refactor/a1301-s6-venue-service-service`
- **Review path:** FULL. It removes the location scope from by-id reads and writes ("tenant
  isolation or a by-id read").
- **Split: 2 tasks**, as the TSV summary proposed (its S6a/S6b+S6c groups). S6a is departments,
  zones, sale policy, order contexts, receipts, transfers and provisioning. S6b is kitchen,
  stations, routing, floor layouts and deletes. The two tasks' source files are disjoint. Each task
  is green on its own; S6b goes after S6a in the same branch.

### Which `packages/venue-service/src` file is S6's and which is S8's

S6 takes every venue-service source file the TSV gives it. S8 takes `business-day-schedule.ts`,
`day-resolver.ts`, `holidays.ts`, `hours.ts`, `menu-timetable.ts`, `named-days.ts`,
`opening-hours-calendar.ts`, `season-weeks.ts`, `seasons.ts`, `special-days.ts`,
`starter-language.ts` and `zone-closure-hours.ts`, plus `apps/server/src/setup-opening-hours.ts`.
Neither slice edits the other's source files, and `service.ts` is not edited by either (the header's `cfg` rule
keeps every signature the seat binds). Test files follow their source file's slice. The one
exception is a cross-location case whose check sits in the other slice's file: it is deleted by
the slice that removes the check (named below). The two slices call each other's functions in
both directions. For example, `menu-timetable.ts` (S8) imports `assertDepartment` and
`resolveZoneContext` from `operations.ts` (S6), and `operations.ts` imports `placeOpenPeriod` and
`readStarterStaffLanguage` from S8's files. That rule keeps all of those signatures, so S6 and S8 can
land in either order.

### Files

**Task S6a** (16 source files, about 100 matching lines):

| File | Matching lines | What changes |
| --- | --- | --- |
| `packages/venue-service/src/operations.ts` | 27, 45, 64, 87-1494 (41) | Every `eq(<table>.locationId, cfg.locationId)` filter and the two raw `osc.location_id = ${cfg.locationId}` clauses (1238, 1254) go. Inserts at 203 (`departments`), 446 (`zone_service_policies`), 513 (`floor_zones`), 1167 and 1494 (`order_service_contexts`) get `locationId: await venueLocationId(tx)`. 218-223: the new department's menu comes from `(await readVenue(tx)).defaultCatalogueId`, and the `locations` import (27) goes. `zonePeriodMembership` (881) takes `zoneId?: string` in place of the `{ zoneId } \| VenueScope` union. `zoneMenuIdsByZone` (854) calls it with no argument. Exported functions with no other use for `cfg` take `_cfg`: `listDepartments`, `listServiceZones`, `assertDepartment`, `configureZone`, `resolveZoneContext`, `resolveSalePolicy`, `setDepartmentSalePolicyField`, `findOrderServiceContext`, `orderZoneIdSql`, `orderInZones`, `findOrderServiceModes`, `findOrderServiceZones`, plus any the compiler adds. The local `requireDepartmentName` and `zoneMenuIdsByZone` drop `cfg`. **Stays:** 45 and 63-65 (`VenueScope`, S18), and `columns: ["location_id", "name"]` at 523 and 833 (the `floor_zones` unique key's columns, until S24). |
| `packages/venue-service/src/provisioning.ts` | 3, 27-161 (22) | `readVenue(tx)` gives the department's name (63-64) and the default menu (161). `node.locationId` filters (39, 50, 54, 88-103, 146-151) go. Inserts (62, 112, 126) use `venueLocationId(tx)`. **Stays:** `target: [floorZones.locationId, floorZones.name]` (118), which must name the unique index's columns until S24. Calls passing `node` as the scope (`readStarterStaffLanguage`, `ensureDefaultSeasons`, `placeOpenPeriod`, `addStarterServiceSteps`) are unchanged. |
| `packages/venue-service/src/routes.ts` | 881, 1030 | Two `ctx.cfg.locationId` filters go. |
| `packages/venue-service/src/department-receipts.ts` | 87, 174, 312, 326, 340 | Filters go. The local `rowQuery` drops `cfg`. `receiptDepartmentForSale`, `receiptDepartmentForOrder` and `receiptDefaultDepartment` take `_cfg`. |
| `packages/venue-service/src/department-transfers.ts` | 70-492 (7 filters), 534 | Filters on `departments`, `workingOrders` and `diningTables` go. The local `recordedDepartment` and `activeDepartment` drop `cfg`. **Stays until S7:** 534 (`orderTableLabels(tx, cfg.locationId, …)`, which S7 changes along with `summarizeTransfers`'s now-unused `cfg`). |
| `packages/venue-service/src/profile-access.ts` | 107, 293, 315 | Filters go. The local `checkedScope` drops `cfg`. `readProfileZones` takes `_cfg`. |
| `packages/venue-service/src/device-zone-selection.ts` | 38, 95 | The device filter goes, and `cfg.locationId` leaves the snapshot hash's list (95). The snapshot is a concurrency token computed at read and recomputed at write (`setDeviceZoneSelection`), never stored. Its value changes once, so a till holding an old one is refused as stale one time. |
| `packages/venue-service/src/late-send.ts` | 19, 36 | Filters go. `_cfg` on both exports. |
| `packages/venue-service/src/release-reminders.ts` | 29 | Filter goes. `_cfg`. |
| `packages/venue-service/src/table-clearing.ts` | 31 | Filter goes. `_cfg`. |
| `packages/venue-service/src/service-steps.ts` | 41, 52, 87 | Filters go. `_cfg` on `listServiceSteps`, `listStepCourses` and `saveServiceSteps`. |
| `packages/venue-service/src/course-delete-settings.ts` | 19 | Filter goes. `_cfg`. |
| `apps/server/src/department-receipt-api.ts` | 18, 87 | Nothing for S6: both lines (the `readLocationAddress` import and call) are Task S2-5's, which replaces them with `readVenueAddress(tx)` (header, "Files moved from the design's slice"). |
| `apps/server/src/department-receipt-draft.ts` | 10, 22 | `cfg: { locationId: LocationId }` stays. It is spread into the seat's `readDepartmentReceipt` scope at line 35 (seat contract, S18). Nothing changes here unless S5's cascade left something unused. |
| `apps/server/src/department-receipt-languages.ts` | 4, 15, 17 | `:17` done by S5; `:4`, `:15` and `:27` (`cfg` for `readOfferedReceiptLanguages`) go with S5 or S2-5, whichever lands second. S6 only confirms the done-check. |
| `apps/server/src/department-transfer-api.ts` | 270 | The `workingOrders.locationId` filter goes. |

**Task S6b** (13 source files, about 98 matching lines):

| File | Matching lines | What changes |
| --- | --- | --- |
| `packages/venue-service/src/kitchen-screens.ts` | 16, 90-982 (25) | Filters go. The per-location loop in the profile save (190-215) becomes one pass: read the profile's screens before and after (`profileScreens(tx, profileId)`, replacing `profileScreensAt(tx, locationId, profileId)`, 218-224), and narrow every device on the profile together. The comment at 190-191 goes. `narrowDeviceKitchenScreens` (887-918) stops selecting `devices.locationId` and building `here`. `brandLocationId` (16) goes. Local `readStored`, `checkedStations`, `checkedZones` and `placesHere` drop `cfg`, and so do `narrowDevices`/`resolveDevices` if the compiler says they no longer use it. Exported ones take `_cfg`. |
| `packages/venue-service/src/kitchen-notices.ts` | 6, 132, 141, 234, 268, 393 | Filters go. 234 uses `readVenueClock(tx)`. `recordKitchenNotices`, `listStationsNotices` and `acknowledgeKitchenNotice` take `_cfg`. |
| `packages/venue-service/src/station-times.ts` | 3, 15, 29, 98, 132 | `venueMoment` uses `readVenueClock(tx)` and takes `_cfg`. Filters go. The local `requireStation` drops `cfg`. |
| `packages/venue-service/src/station-service-times.ts` | 3, 40, 47 | Filter goes. `readVenueClock(tx)`. |
| `packages/venue-service/src/station-delete-settings.ts` | 29, 37, 44, 87 | Filters go. |
| `packages/venue-service/src/routing-store.ts` | 33, 88-686 (13) | Filters go. The `routing_cells` insert (351) uses `venueLocationId(tx)`. `clockAt` (386-387) uses `readVenueClock(tx)`. The `VenueClock` alias (383) becomes `Awaited<ReturnType<typeof readVenueClock>>`. Local `activeZones`, `activeTarget`, `cellAt`, `clockAt`, `snapshot` and `zoneDepartments` drop `cfg`. |
| `packages/venue-service/src/routing-periods.ts` | 37, 120 | Filters go. `readPeriods` takes `_cfg`. |
| `packages/venue-service/src/floor-layout-due.ts` | 4-5, 94, 115-172, 221 | Filters go. 172 uses `readVenueClock(tx)`. The two `cfg: { locationId: LocationId }` parameters (94, 221) take `_cfg` if exported, or are dropped if local. The `LocationId` import goes when unused. |
| `packages/venue-service/src/floor-plan-set-store.ts` | 30, 94, 128, 277 | Filters go. `linkFloorPlanSet` takes `_cfg`. Local `setRows` and `departmentZones` drop it. |
| `packages/venue-service/src/service-delete.ts` | 69-237 (8) | Filters go, including `orderServiceContexts.locationId` (152). |
| `packages/venue-service/src/service-delete-settings.ts` | 40-240 (9) | Filters go. The local `settings` drops `cfg`. |
| `packages/venue-service/src/period-delete.ts` | 3, 49, 66, 84, 106, 199 | Filters go. 49 and 199 use `readVenueClock(tx)`. Local `businessDayAt` and `paintedIn` drop `cfg`. |
| `packages/venue-service/src/zone-closed-times.ts` | 9, 41, 141-142, 221, 247 | Filters go. 41 and 221 use `readVenueClock(tx)`. `readServiceZones` takes `_cfg`. |

Docs (Task S6b), the entries the change makes stale:
- `docs/backlog.md:1718-1719` and `docs/backlog/kitchen.md:193-198` ("A routing period line naming
  another location's period is flagged but never drawn"): delete both. `readPeriods` now returns
  every period, so no line can name a period outside the model.
- `docs/backlog/till.md:31-34`, the bullet "A profile's explicit station and zone lists … saving
  the profile at one location empties another location's lists": delete. The per-location save is
  gone.

### Task S6a: departments, zones, sale policy, order contexts, receipts, transfers, provisioning

- [ ] **Step 1: Failing tests** (scope-blind, `// A1301: deleted with cfg in S18`):
  - `packages/venue-service/src/operations.test.ts`: add `it("lists the venue's departments whatever location the scope names", …)`.
    It creates a department through `createDepartment(tx, cfg, …)`, then expects
    `listDepartments(tx, { locationId: brandLocationId(randomUUID()) })` to contain it. Today it
    returns `[]`.
  - Same file: add `it("creates a department on the venue's row whatever location the scope names", …)`.
    It calls `createDepartment(tx, { locationId: brandLocationId(randomUUID()) }, { name: "Bar" })`
    and expects the stored `departments.location_id` to equal `await venueLocationId(tx)`. Today it
    is refused by the foreign key.
  - `packages/venue-service/src/department-receipts.test.ts`: add a case. It expects
    `receiptDefaultDepartment(tx, { locationId: brandLocationId(randomUUID()) })` to return the
    venue's default department. Today it returns none.
- [ ] **Step 2: Watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/operations.test.ts src/department-receipts.test.ts -t "whatever location the scope names|whatever location"`.
  Expected: FAIL. `[]`, a `FOREIGN KEY constraint failed` error, and `null`.
- [ ] **Step 3: Implement** the S6a rows of the Files table.
- [ ] **Step 4: Delete the cross-location cases** (or their location half):
  - `operations.test.ts:2838` "returns no menu state for a zone outside the requested location" — delete.
  - `operations.test.ts:3326` "does not read another location's orders" — delete.
  - `operations.test.ts:3359` "reads nothing for an empty list or another location" — keep the empty-list half.
  - `operations.test.ts:3419` — remove the context recorded at another location (comment at `:3447`) and its assertion.
  - `operations.test.ts:1080` — remove the "Second venue" part (from `:1165`).
  - `department-receipts.test.ts:135` (keep "unknown ids"), `:518` (keep "without borrowing a default"); `:747` — delete.
  - `late-send.test.ts:58`, `profile-access.test.ts:226`, `release-reminders.test.ts:140` — delete.
  - `routes.test.ts:1714` — remove "another venue's department". `:2160` and `:2292` — delete. `:3757` — drop `"other location"` from the `it.each` list.
  - `service-steps.test.ts:150` — remove the second venue seeded at `:152`. `:278` — drop `"of another venue"` from the `it.each` list, and keep `"inactive"` and `"of no venue"`.
  - `course-delete-settings.test.ts:196` — delete.
- [ ] **Step 5: Run.**
  `pnpm --filter @waitron/venue-service exec vitest run src/operations src/provisioning src/routes src/department-receipts src/department-transfers src/profile-access src/late-send src/release-reminders src/table-clearing src/service-steps src/course-delete-settings src/device-zone-selection`.
  `pnpm --filter @waitron/server exec vitest run src/department-receipt src/department-transfer`.
  The guards. `pnpm --filter @waitron/venue-service typecheck && pnpm --filter @waitron/server typecheck`.
  `pnpm format:check`. Read every `Tests` count.
- [ ] **Step 6: Done-check.** `git grep -n -E "$P" --` the 16 S6a files.
  It may print: `operations.ts:45` and `:64` (`VenueScope`), `operations.ts` `columns: ["location_id", "name"]` (×2),
  `provisioning.ts` `target: [floorZones.locationId, …]`, `department-transfers.ts:534` (S7),
  `department-receipt-draft.ts:10,22` (seat scope, S18), `department-receipt-api.ts:18,87` and
  `department-receipt-languages.ts:4,15` until S2-5 lands, and `venueLocationId` calls.
- [ ] **Step 7: Commit** (`git commit -s`).

### Task S6b: kitchen, stations, routing, floor layouts, deletes

- [ ] **Step 1: Failing tests** (scope-blind, marked as above):
  - `packages/venue-service/src/kitchen-notices.test.ts`: add a case. It expects
    `listStationsNotices(tx, { locationId: brandLocationId(randomUUID()) }, …)` to return a notice
    recorded at the venue's station. Today it returns none.
  - `packages/venue-service/src/routing-store.test.ts` (or the routing model's test file): add a
    case. The routing model read with a scope naming an unknown location lists the venue's zones.
    Today it lists none.
  - `packages/venue-service/src/kitchen-screens.test.ts`: add `it("narrows every device on the profile in one save", …)`.
    It puts two devices on one profile, saves a station list without station A, and expects both
    devices narrowed. This one is not scope-blind: it pins the collapsed loop, and it stays after
    S18.
- [ ] **Step 2: Watch the first two fail** (`pnpm --filter @waitron/venue-service exec vitest run src/kitchen-notices.test.ts src/routing-store -t "whatever location"`).
  The third passes both before and after: it guards the restructure. Show that it guards it by
  deleting the narrowing call in a scratch edit, seeing the case fail, and putting the call back.
- [ ] **Step 3: Implement** the S6b rows. Reword the docs entries listed above.
- [ ] **Step 4: Delete the cross-location cases:**
  - `kitchen-notices.test.ts:680`, `:710` — keep the "unknown" half. `:1262`, `:1438` — remove the other-location station.
  - `kitchen-screens.test.ts:273`, `:676` — keep "unknown … or one switched off". `:2019` "narrows a device at another location against that location's stations" — delete.
  - `period-delete.test.ts:377`, `:711` — keep "does not exist". `:697` — remove "or another venue's".
  - `service-delete-settings.test.ts:760` — remove the other-location half, keep "preserves defaults when the removed zone was not default". `service-delete.live-targets.test.ts:290` — remove "or another location". `service-delete.test.ts:739` — delete.
  - `station-delete-settings.test.ts:556` — delete. `station-service-times.test.ts:397` — keep "unknown".
  - `zone-closed-times.test.ts:190` "refuses another venue's zone in a special day's zone paint" is **not S6's**. It exercises `special-days.ts`'s paint-owner check, so S8 deletes it.
- [ ] **Step 5: Run.**
  `pnpm --filter @waitron/venue-service exec vitest run src/kitchen-screens src/kitchen-notices src/station-times src/station-service-times src/station-delete-settings src/routing src/floor-layout-due src/floor-plan-set-store src/service-delete src/period-delete src/zone-closed-times`.
  Then the S6a run again (the two tasks share callers). The guards. The two typechecks.
  `pnpm format:check`.
- [ ] **Step 6: Done-check.** `git grep -n -E "$P" --` the 13 S6b files. Expected: `venueLocationId`
  calls only.
- [ ] **Step 7: Commit** (`git commit -s`).

### Open PRs touching S6's files

- **#2369**: `apps/server/src/department-transfer-api.test.ts`. It lands before S1.
- No other open PR touches an S6 file (checked against the full file lists of #2373, #2375, #2376,
  #2377).

---

## S7 — Floor: plan sets, zones, tables, today's floor

**Goal.** The floor's server code (plan sets, zones, tables, today's floor, watch zones, zone access
and the shared table-label reader) stops narrowing by location. Rows still written with a
`location_id` (dining tables, floor plan sets) get `venueLocationId(tx)`. The business day comes
from `readVenueClock(tx)`. `orderTableLabels` loses its `locationId` parameter, and every caller
follows. The cross-location refusals ("another venue's zone/table as not found") go with their
tests.

- **Depends on:** S6 (and so S1): it changes `department-transfers.ts:532-534` (an S6 file) and
  `summarizeTransfers`'s now-unused `cfg`.
- **Lands:** lane. None of rules a–d applies.
- **Branch:** `refactor/a1301-s7-floor`
- **Review path:** FULL. It removes the location scope from by-id reads, and changes a
  `packages/db` export that `apps/server`, `reporting` and `venue-service` call.

**`apps/dashboard/src/screens/floor-plan-editor.ts` is named by the design but has nothing to
change.** Its only matches are the browser's `location.origin` and `location.href` (lines 3 of the
grep; the TSV marks it UNRELATED). S7 does not touch it.

**`apps/server/src/table-removal.ts` moved to S18** (header, "Files moved from the design's
slice"): lines 51, 59, 74, 82, 93, 138, 149 and 152 build the `{ locationId }` argument that the
module contract's `TableRemoval` hooks declare (`packages/module/src/module.ts:148-174`). Bookings
implements those hooks (`packages/bookings/src/table-removal.ts`, S9). S7 leaves the file alone.

### Files (one task)

| File | Matching lines | What changes |
| --- | --- | --- |
| `apps/server/src/floor-delete.ts` | 57, 62, 205, 209-218 | Filters go. 209-218: the `locationZones` subquery and its `inArray(floorResetTables.zoneId, …)` clause go, because every zone is the venue's. |
| `apps/server/src/floor-plan-sets.ts` | 60-96, 165-168, 265, 275, 290 | `setsOfLocation`→`existingSets` and `zonesOfLocation`→`existingZones`. These are local and drop `cfg` once the filter goes. The 265 filter goes. 275 (`floorPlanSets` insert) uses `venueLocationId(tx)`. |
| `apps/server/src/floor-plan.ts` | 83, 336, 340 | Filters go. |
| `apps/server/src/floor-revision.ts` | 100, 140, 150 | Filters go. The 140 comment drops "within the venue's location". |
| `apps/server/src/floor-today-api.ts` | 118-134, 269, 298, 312 | The local `refuseStaleZone` and `hasTodayRow` drop `locationId`, and 269 and 298 pass nothing. The 312 filter goes. |
| `apps/server/src/floor-today-name.ts` | 91, 100, 111 | Filters go. |
| `apps/server/src/floor-today-store.ts` | 38, 110, 342, 397, 447, 715, 1000 | 110 (`todayBusinessDay`) uses `readVenueClock(tx)`. Filters go. 715 (`diningTables` insert) uses `venueLocationId(tx)`. **Stays until S24:** the comments at 679 and 693, which describe the `(location, label)` and `(location, short name key)` unique indexes that still exist. |
| `apps/server/src/floor-today-table.ts` | 24, 43, 60, 73 | Filters go. The two comments drop "of the venue's location". |
| `apps/server/src/management-api.ts` | 143, 323 | `requireLiveZone`'s filter (323) goes, and the `venueCfg` comment (143) says "the venue config the zone, table, station and course routes use". **Not S7:** 1628-1629 (`stationPrintersDown`/`stationScreensDark`, S11). |
| `apps/server/src/tables.ts` | 46, 77, 93 | Filters go. **Stays until S24:** 114 (`columns: ["location_id", "name"]`, the `floor_zones` unique key). |
| `apps/server/src/watch-zones.ts` | 35, 93 | Filters go. |
| `apps/server/src/zone-access.ts` | 33 | Filter goes. **Stays (seat contract, S18):** 4 and 107 (`readZoneScope(tx, cfg: { locationId: LocationId }, …)` passes `cfg` to `VENUE_SERVICE.readProfileZones`). |
| `packages/db/src/party-table-labels.ts` | 105, 243-264 | `orderTableLabels(tx, orders)` drops `locationId` and its `diningTables.locationId` condition (264). The doc comments (105, 243) drop "in any location" and "of `locationId`". |

Callers of `orderTableLabels` (header rule "Calls into another slice's file"; one argument each):

| Caller (owning slice) | Line | Change |
| --- | --- | --- |
| `apps/server/src/kitchen-print.ts` (S11) | 434 | `orderTableLabels(tx, orders)` |
| `apps/server/src/receipt-order.ts` (S11) | 53 | same |
| `apps/server/src/station-delete.ts` (S11) | 79 | same |
| `apps/server/src/working-order.ts` (S11) | 5126, 7467, 8469 | same |
| `packages/reporting/src/overdue-orders.ts` (S1) | 129-137 | S1a replaced the `nodes` read with `await venueLocationId(tx)`; that argument goes. |
| `packages/venue-service/src/department-transfers.ts` (S6) | 532-534 | The argument goes. `summarizeTransfers` (504) then has no use for `cfg`, so it drops it (it is local), and so does its call. |
| `packages/db/src/party-table-labels.test.ts` | its `orderTableLabels(` calls (8 lines) | Two arguments. `OTHER_LOCATION` (`:26`, `:40`) and the `elsewhere` table (`:660`) are deleted. |

Docs: `docs/backlog/till.md:262-263` (the bullet "`leaveMerges` … reads tables by id with no
location filter; every caller checks the location first") is deleted. There is no location filter
left to check.

### Task S7: the floor reads every table and zone as the venue's

- [ ] **Step 1: Failing tests.**
  - `apps/server/src/tables.test.ts`: add a scope-blind case (marked `// A1301: deleted with cfg in S18`).
    It expects `listZones(tx, { ...cfg, locationId: brandLocationId(randomUUID()) })` to return the
    venue's active zones. Today it returns `[]`.
  - `packages/db/src/party-table-labels.test.ts`: change "names an order of no party after the table
    it is delivered to, else its label, else nothing" (`:658`) to call
    `orderTableLabels(tx, [ … ])` with the same three orders. It expects the same labels as today
    for `delivered`, `labelled` and `walk-up`, and removes the `elsewhere` table (`:660`). This
    fails to compile today.
- [ ] **Step 2: Watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/tables.test.ts -t "whatever location"`.
  Expected: FAIL, `[]`. Then `pnpm --filter @waitron/db typecheck`.
  Expected: `error TS2554: Expected 3 arguments, but got 2` on the changed call.
- [ ] **Step 3: Implement** the Files table and the caller table. Reword `till.md`.
- [ ] **Step 4: Delete the cross-location cases** (or their half):
  - `apps/server/src/floor-plan-sets.test.ts:459` "removes nothing for no sets and ignores another location's set" — keep "removes nothing for no sets".
  - `floor-today-api.test.ts:712`, `floor-today-changes.test.ts:455`, `floor-today-merge-api.test.ts:194`, `floor-today-moves.test.ts:217`, `floor-today-seat-api.test.ts:271` — delete.
  - `floor-delete.test.ts:335` "cleans a no-today table, null-live reset target, and every three-member join" — remove the `otherLocation`, `foreignZone` and foreign planned table (`:340-347`) and whatever assertion reads them. Every other assertion stays.
  - `apps/server/src/management-api.test.ts:2744` (another venue's course) is **S11's**: the course check lives in `course-delete.ts` and `kitchen.ts`, not in an S7 file. S7 leaves it.
- [ ] **Step 5: Run.**
  `pnpm --filter @waitron/server exec vitest run src/floor- src/tables src/watch-zones src/zone-access src/management-api.test.ts src/management-api.floor-plan-sets src/kitchen-print src/receipt-order src/station-delete`.
  `pnpm --filter @waitron/db exec vitest run src/party-table-labels.test.ts`.
  `pnpm --filter @waitron/reporting exec vitest run src/overdue-orders`.
  `pnpm --filter @waitron/venue-service exec vitest run src/department-transfers`.
  The guards. `pnpm --filter @waitron/db typecheck && pnpm --filter @waitron/reporting typecheck && pnpm --filter @waitron/venue-service typecheck && pnpm --filter @waitron/server typecheck`.
  `pnpm format:check`.
  The `floor-*` suites share one database per file (`resetPerTest: false`), so read each file's
  result, not only the total.
- [ ] **Step 6: Done-check.**
  `git grep -n -E "$P" -- apps/server/src/floor-delete.ts apps/server/src/floor-plan-sets.ts apps/server/src/floor-plan.ts apps/server/src/floor-revision.ts apps/server/src/floor-today-api.ts apps/server/src/floor-today-name.ts apps/server/src/floor-today-store.ts apps/server/src/floor-today-table.ts apps/server/src/management-api.ts apps/server/src/tables.ts apps/server/src/watch-zones.ts apps/server/src/zone-access.ts packages/db/src/party-table-labels.ts`.
  It may print: `floor-today-store.ts:679,693` (index comments, S24), `management-api.ts:1628-1629`
  (S11), `tables.ts:114` (S24), `zone-access.ts:4,107` (S18), and `venueLocationId` calls.
  `table-removal.ts` is left whole for S18.
  `apps/dashboard/src/screens/floor-plan-editor.ts` prints only `location.origin`/`location.href`.
- [ ] **Step 7: Commit** (`git commit -s`).

### Open PRs touching S7's files

- **#2369**: `apps/server/src/management-api.ts`, `floor-catch-up.test.ts`, `floor-delete.test.ts`,
  `floor-today-api.test.ts`, `floor-today-flatten-api.test.ts`, `floor-today-mark-moved.test.ts`,
  `floor-today-merge-api.test.ts`, `floor-today-reset-table.test.ts`,
  `floor-today-seat-api.test.ts`, `floor-today-split-group.test.ts`, `table-removal.test.ts`,
  `zone-access.finished-party.test.ts`, and the caller `working-order.ts`. It lands before S1.
- **#2373**: the caller `apps/server/src/working-order.ts`.

---

## S8 — Venue-service, calendar side

**Goal.** Seasons, season weeks, special days, holidays, opening hours, the business-day schedule,
the menu timetable and the starter language stop narrowing by location.
- Holidays take the city and province from `readVenue(tx)`.
- The starter language takes the province and receipt languages from `readVenue(tx)`, and the
  country from the tenant.
- Clock reads use `readVenueClock(tx)`, or `readVenueClockAndPlace(tx)` where the place is
  wanted.
- Rows still written with a `location_id` (seasons, special days and their dates, holiday
  geographies) get `venueLocationId(tx)`.

The same `_cfg` rule as S6 applies.

- **Depends on:** S1. It runs alongside S5–S7 (see "Which file is S6's and which is S8's").
- **Lands:** lane. None of rules a–d applies.
- **Branch:** `refactor/a1301-s8-venue-service-calendar`
- **Review path:** FULL. It removes the location scope from by-id reads and writes (seasons,
  special days, periods).
- **One task.** 13 files and 99 matching lines fit the brief's budget. If the implementer passes
  about 60 calls with the timetable half untouched, split there: S8a is seasons, season weeks,
  special days, named days, holidays, starter language and zone closure hours; S8b is the
  business-day schedule, menu timetable, opening hours, hours, day resolver and setup opening
  hours.

### Files

| File | Matching lines | What changes |
| --- | --- | --- |
| `packages/venue-service/src/business-day-schedule.ts` | 3-4, 73-174, 309, 364, 408-410 | Filters go. 364 uses `readVenueClock(tx)`. `readBusinessDayScheduleRevision` (408-410) reads the one `location_business_day_settings` row with no `where`. `businessDayClockConflicts`, `keptOpenConflicts` and `readBusinessDayScheduleRevision` take `_cfg`. **Stays until S23:** the `locationBusinessDaySettings` import and table name (3, 408-409). |
| `packages/venue-service/src/day-resolver.ts` | 4, 85, 95, 168, 290 | 168 uses `readVenueClock(tx)`. The 290 filter goes. 85 uses S1's `VenuePlace`. The 95 comment says "the venue". |
| `packages/venue-service/src/holidays.ts` | 9-10, 83-150, 216 | `readAddress` (84-110, local, drops `cfg`) reads `city`/`province` from `readVenue(tx)` when no `place` is passed, and the `locations` import goes. The local `geographiesOf` (123) loses its filter. The local `createGeography` (135) inserts with `venueLocationId(tx)`. The `place?:` parameters (87, 150, 216) use S1's `VenuePlace`, and the 83 comment says "the venue's own province and city". |
| `packages/venue-service/src/hours.ts` | 3, 28, 36, 81 | 28 uses `readVenueClock(tx)`. The 36 filter goes. 81 uses S1's `VenuePlace`. |
| `packages/venue-service/src/menu-timetable.ts` | 11, 115-715 (9) | Filters go. 248, 477 and 704 use `readVenueClock(tx)`. `readRoutingUses`, `readActiveDepartments` and `readActivePeriods` take `_cfg`. |
| `packages/venue-service/src/named-days.ts` | 4, 22 | `readVenueClock(tx)`. |
| `packages/venue-service/src/opening-hours-calendar.ts` | 4-6, 70, 157, 187, 294 | 70 and 294 use `readVenueClock(tx)`. 187 uses `readVenueClockAndPlace(tx)`. 157 uses S1's `VenuePlace`. |
| `packages/venue-service/src/season-weeks.ts` | 3, 216, 231, 266, 280, 334 | 216, 266 and 334 use `readVenueClock(tx)`. Filters go. `readDepartmentSeasonWeeks` and `readZoneSeasonWeeks` take `_cfg`. |
| `packages/venue-service/src/seasons.ts` | 4, 43, 61, 151, 163, 184, 212 | Filters go. Inserts (61, 184) use `venueLocationId(tx)`. 151 uses `readVenueClock(tx)`. `readSeasons` takes `_cfg` (`packages/staffing/src/paint.ts` and `rota.ts` call it with a `cfg`). |
| `packages/venue-service/src/special-days.ts` | 3, 56, 190, 209-1130 (15) | Filters go. Inserts (1035, 1064) use `venueLocationId(tx)`. 379, 969 and 1130 use `readVenueClock(tx)`. Local `assertPaintOwners`, `assertDatesFree` and `requireSpecialDay` drop `cfg`. `specialDayOccurrences` and `listSpecialDays` take `_cfg`. The comments at 321 and 323 say "the venue's". |
| `packages/venue-service/src/starter-language.ts` | 6, 17-22 | `readStarterStaffLanguage(tx, _cfg)` reads `province` and `invoiceLocales` from `readVenue(tx)` and `country` from the tenant. It keeps today's answer for a database with no tenant row (the comment above the function says so). The `locations` import goes. |
| `packages/venue-service/src/zone-closure-hours.ts` | 2, 37 | `readVenueClock(tx)`. |
| `apps/server/src/setup-opening-hours.ts` | 3, 12, 21, 25 | The `departments.locationId` filter (21) goes. **Stays (seat scope, S18):** 3, 12 and 25. `venue.locationId` comes from boot's setup result (`apps/server/src/boot.ts:1461`) and is handed to `readOpeningHoursModel` as its scope. Nothing in S8 changes `boot.ts`. |

Docs: `docs/backlog.md:1480-1483`. "also reads the tenant, location and holiday area" becomes
"also reads the tenant, the venue and the holiday area".

### Task S8: the calendar reads the venue

- [ ] **Step 1: Failing tests** (the first two are scope-blind, marked as before):
  - `packages/venue-service/src/seasons.test.ts`: add a case. It expects
    `readSeasons(tx, { locationId: brandLocationId(randomUUID()) })` to return the venue's four
    starter seasons. Today it returns `[]`.
  - `packages/venue-service/src/special-days.test.ts`: add a case. It saves a special day through
    a scope naming an unknown location and expects the stored `special_days.location_id` to equal
    `await venueLocationId(tx)`. Today the insert is refused by the foreign key.
  - `packages/venue-service/src/holidays.test.ts`: add `it("takes the holiday area from the venue's city and province", …)`.
    It sets `city`/`province` on the one `locations` row, then reads holidays through a scope
    naming an unknown location, and expects that city's local holidays. Today there are none,
    because the read finds no row. This case stays after S18 with the scope argument removed.
- [ ] **Step 2: Watch them fail.**
  `pnpm --filter @waitron/venue-service exec vitest run src/seasons.test.ts src/special-days.test.ts src/holidays.test.ts -t "whatever location|venue's city"`.
  Expected: FAIL, as described.
- [ ] **Step 3: Implement** the Files table. Reword the backlog line.
- [ ] **Step 4: Delete the cross-location cases** (or their half):
  - `business-day-schedule.test.ts:1962` "leaves the season unnamed for a day row whose season is another venue's" and `:2419` "ignores another venue's keep-open" — delete.
  - `day-resolver.test.ts:915` — keep "a special day it does not hold".
  - `menu-timetable.test.ts:939` — keep "a zone of an inactive department". `:1058` — keep "a department that does not exist".
  - `named-days.test.ts:158`, `seasons.test.ts:433` and `starter-language.test.ts:79` "answers en for a location that does not exist" — delete.
  - `season-weeks.test.ts:244`, `:394`, `:791` — keep "a season it does not know".
  - `holidays-routes.test.ts` — its `fixture()` seeds a second venue for **every** case
    (`otherLocation`, `:97-102`; `other` in the `Fixture` type, `:79`, and the return, `:112`).
    `rows()` (`:176-185`) reads both venues' geographies and entries, so a refusal can be shown to
    change none. Remove the second venue from the fixture. `rows()` then reads every row, with no
    `inArray(…locationId, ids)`. The assertion "a refusal changes no row" stays; only "of either
    venue" goes (design §1). Leaving the second row in would make `createGeography`'s
    `venueLocationId(tx)` throw in every case.
  - `zone-closed-times.test.ts:190` "refuses another venue's zone in a special day's zone paint" (in S6's test file) — delete. It proves `special-days.ts`'s paint-owner check, which this task removes.
  - Before deleting the wording-grep hits in `menu-timetable-routes`, `season-routes`, `special-days-routes`, `period-delete-routes`, `opening-hours-calendar` and `zone-closure-hours` tests, look at what the wording matched. Those hits are the `locationBusinessDaySettings` table name, not a second venue, so those cases stay.
- [ ] **Step 5: Run.**
  `pnpm --filter @waitron/venue-service exec vitest run src/business-day-schedule src/day-resolver src/holidays src/hours src/menu-timetable src/named-days src/opening-hours-calendar src/season src/special-days src/starter-language src/zone-closure-hours src/zone-closed-times src/calendar src/dashboard`.
  `pnpm --filter @waitron/server exec vitest run src/setup-opening-hours`.
  `pnpm --filter @waitron/staffing exec vitest run src/paint src/rota` (they call `readSeasons`).
  The guards. `pnpm --filter @waitron/venue-service typecheck && pnpm --filter @waitron/server typecheck`.
  `pnpm format:check`.
- [ ] **Step 6: Done-check.** `git grep -n -E "$P" --` the 13 S8 files. It may print:
  `business-day-schedule.ts` `locationBusinessDaySettings` (3, 408-409; S23), `setup-opening-hours.ts:3,12,25`
  (S18), and `venueLocationId` calls.
- [ ] **Step 7: Commit** (`git commit -s`).

### Open PRs touching S8's files

- **#2369**: `packages/venue-service/src/holidays.test.ts`, `hours.test.ts`,
  `special-days.holiday-name.test.ts`. It lands before S1.
- No other open PR touches an S8 file.

---

## Rules shared by S9–S12

Lines in S9–S12 were read at main `abfe271663` unless they say otherwise; A696's lines at
`7e824ae233`. Each file's lines were read with the design's pattern (`git grep -n -E "$P" -- <file>`).
These rules add to the header's; a task's own text overrides them only where it says so.

1. **Reads lose the location filter; writes fill the column from the venue.** A query that filters
   by `x.locationId = <a location id>` drops that condition (a box has one location, so the filter
   selects every row it selected before). An insert that fills a `location_id` column takes the
   value from `await venueLocationId(tx)`.
2. **Clocks and settings come from S1's accessors.** `readLocationClock(tx, id)` becomes
   `readVenueClock(tx)`; a direct read of `locations.timeZone`, `.province`, `.invoiceLocales` or
   `.name` becomes `readVenue(tx)`.
3. **Readers other slices own** keep their signature here (header, "Calls into another slice's
   file"): `readReceiptLanguage`, `readInvoiceLocales` — S5; `readOfferedReceiptLanguages`,
   `saleLanguageFor`, `checkedInvoiceChoiceDelivery`, `readSaleOperationDescription`,
   `prepareIssueClock` — S2; `readReceiptAddress` — S1, already changed when these slices start;
   `orderTableLabels` — S7; `VENUE_SERVICE.*` and the seasons and day-plan readers — S6/S8; the
   workforce roster backend — S13; `RecordExportInput` — S14; a module seat's `cfg` such as
   `FloorAnnotator` — S18.
4. **Values that feed the attendance recorder.** `AttendanceFact.locationId`
   (`apps/server/src/attendance-capture.ts:16-19`, type from `@waitron/workforce`) belongs to
   A1268 and S13. If A1268 has removed that field when a task starts, the task deletes the
   argument; otherwise it fills the field with `await venueLocationId(tx)` and deletes the
   parameter or the order/refund lookup that carried the value here. Either way the task stops
   reading a location to get it.
5. **Done-check.** `git grep -n -E "$P" -- <the task's files>` prints only: `venueLocationId`
   calls; the lines this section says are left to another slice; and the unrelated words named per
   task. Anything else is unfinished.

**Interfaces consumed from S1 (and F1 for tests):** `readVenue(tx)`, `readVenueClock(tx)`,
`venueLocationId(tx)`; in tests, `seedVenue(db, overrides?)`, `seedNode`, `seedDevice`,
`seedWorkingOrder` from `packages/db/src/testing/seed.ts` where F1 has landed.

---

## S9 — Staffing and bookings

**Goal.** The bookings and staffing modules stop reading the module's location. Bookings check a
table by its id alone and read the venue's time zone; staffing reads its roles, departments,
stations, seasons, special days and changeover for the venue, and writes new staff roles to the
venue's location row through the interim helper. Two refusals that existed only to keep two
locations apart go: a booking's table "in another location", and a staff role, season or special
day "at another location".

- **Depends on:** S1. No server caller matches (the TSV places no `apps/server` file in S9).
- **Lands:** lane (no owner rule a–d applies).
- **Branch:** `refactor/a1301-s9-staffing-bookings`.
- **Review path:** LIGHT. No risk trigger: no fiscal path, no migration, no auth, no
  cross-package contract change (the module seats keep their shape; see S9a).

### Files (14 in the TSV; the two dashboard files moved to S13)

| File | What changes |
| --- | --- |
| `packages/bookings/src/bookings.ts` | `BookingConfig` (`:14-16`) deleted with `LocationId` import (`:8`); every operation loses its `cfg` parameter; `requireActiveTable` (`:49-70`) loses `locationId` and the `eq(diningTables.locationId, …)` condition (`:63`); create fills `locationId: await venueLocationId(tx)` (`:88`); the day list drops its location filter (`:110`); the edit path's call (`:146`); `seatBooking`'s in-location block (`:240-252`) deleted whole (`seatTable` already refuses a missing or inactive table, per its own comment at `:240-241`); header comment `:1-3` reworded |
| `packages/bookings/src/floor.ts` | the `FloorAnnotator` keeps its `cfg` parameter (seat shape, S18) but stops reading `cfg.locationId` (`:31`, `:39`) |
| `packages/bookings/src/table-removal.ts` | same for the table-removal seat (`:22`, `:37`, `:46`) |
| `packages/bookings/src/wall-clock.ts` | `venueWallClockAt(tx, now)` reads `(await readVenue(tx)).timeZone` through the existing `safeTimeZone`; the `locations` import (`:2`) and id query (`:53-59`) go; comments `:26`, `:49-50` |
| `packages/bookings/src/routes.ts` | (not in the TSV: it matches no location word) callers stop passing `cfg` |
| `packages/staffing/src/staff-roles.ts` | local `Cfg` (`:20`) deleted; every function loses `cfg`; filters at `:44`, `:56`, `:97`, `:125`, `:162`, `:214`, `:235` dropped; insert `:165` fills `venueLocationId(tx)`; comments `:115`, `:120`, `:151`, `:205` |
| `packages/staffing/src/paint.ts` | `Cfg` (`:32`) and `venueScope` (`:34`) go; the season/special-day/role/area reads drop their filters (`:46`, `:51`, `:194`, `:207`, `:234`); `readLocationClock` → `readVenueClock` (`:3`, `:140`, `:341`); comments `:41`, `:198`, `:216-217`, `:404`. **Left to S8:** the `{ locationId }` scope this file hands to venue-service's seasons/day-plan readers stays as S8 leaves it |
| `packages/staffing/src/month.ts` | `cfg` param (`:12`) goes; the scope passed to `readCalendarMonthPlan` (`:18`, S8's function) stays until S8 |
| `packages/staffing/src/rota.ts` | `readLocationClock` → `readVenueClock` (`:4`, `:41`, `:209`, `:329`); role and shift filters (`:193`, `:271`) dropped. **Left to S13:** `:43` (scope to S8 readers — S8), `:85` (`RotaWeek.locationId`, read by the dashboard's warning query), `:363` (`roster.draft_exists`'s detail, whose type is `packages/workforce/src/errors.ts:45`, also thrown by `packages/workforce/src/clocking.ts:314,342`), and the `backend.getRoster(tx, { ...cfg, period })` call (workforce, S13) |
| `packages/staffing/src/rota-data.ts` | `cfg` param (`:13`) and filters `:22`, `:53` dropped |
| `packages/staffing/src/routes.ts` | `readLocationClock` → `readVenueClock` (`:14`, `:166`); calls stop passing `ctx.cfg` to the functions above |
| `packages/staffing/src/paint-rules.ts` | comment `:51` ("the venue's `HH:MM` changeover") |
| `packages/staffing/src/staffing-types.ts` | comments `:39`, `:41`, `:49`. **Left to S13:** `RotaWeek.locationId` (`:113`) |
| `packages/staffing/src/dashboard/client.ts`, `dashboard/rota-view.ts` | **Moved to S13** whole (header, "Files moved from the design's slice"): `watchRotaWarnings` (`client.ts:147-159`, `rota-view.ts:416`) sends `?locationId=` to `GET /management-api/roster/breaches`, which is `apps/server/src/workforce-api.ts:133-136` (S13) and refuses a request without it (`requireUuidParam`, `:136`) |

### Task S9a: bookings

**Files:** the four `packages/bookings/src/*.ts` rows above, plus `routes.ts`; tests
`bookings.test.ts`, `bookings-cas.test.ts`, `floor.test.ts`, `table-removal.test.ts`,
`wall-clock.test.ts`, `routes.test.ts`.

**Produces:** `createBooking(tx, input)`, `listBookings(tx, query)`, `updateBooking(tx, id, patch)`,
`seatBooking(tx, id, req, core)` and the other verbs without `cfg`; `venueWallClockAt(tx, now)`.

- [ ] **Step 1: failing test.** In `wall-clock.test.ts`, add "reads the clock in the venue's zone
  without being told a location": set the one venue's `time_zone` to `Pacific/Auckland`, call
  `venueWallClockAt(tx, new Date("2026-03-01T12:00:00Z"))`, expect `{ date: "2026-03-02", time:
  "01:00" }`. Before the change the `Date` lands in the `locationId` slot, matches no row and the
  default zone answers `2026-03-01`.
- [ ] **Step 2:** run `pnpm --filter @waitron/bookings exec vitest run src/wall-clock.test.ts` —
  FAIL on the date.
- [ ] **Step 3: implement** the table above. Rewrite the test calls with a codemod (the tests pass
  `cfg` as the second argument; `git grep -c cfg -- packages/bookings/src/bookings.test.ts` prints
  230 lines mentioning it), then fix what it leaves by hand.
- [ ] **Step 4: delete the cross-location cases:** `bookings.test.ts:304` ("rejects an ACTIVE table
  in ANOTHER location…"), `:409` ("…assigns a table in ANOTHER location…"), `:578` ("rejects a
  req.tableId in ANOTHER location…") and the helper `makeTableInOtherLocation` (`:100-104`);
  `table-removal.test.ts:183` ("lets go of a booking for the table whose location is another
  venue's"); `wall-clock.test.ts:38` ("default zone when no location has the id") and
  `floor.test.ts:156` ("reads a location with no row as unreserved") — both test an id that names
  no row, and nothing passes an id any more (design §1). Keep `floor.test.ts:145`
  (invalid zone falls back): `safeTimeZone` stays.
- [ ] **Step 5:** run `pnpm --filter @waitron/bookings exec vitest run src/bookings.test.ts
  src/bookings-cas.test.ts src/floor.test.ts src/table-removal.test.ts src/wall-clock.test.ts
  src/routes.test.ts` — PASS; then the code guards, `pnpm --filter @waitron/bookings typecheck`,
  `pnpm format:check`.
- [ ] **Step 6: done-check** over the five source files: prints only `venueLocationId` and the
  seat comments, nothing else. `packages/bookings/src/schema/bookings.test.ts:167` (the foreign key
  case) is schema, S20's.
- [ ] **Step 7: commit** `git commit -s` "Bookings read the venue, not a location (A1301 S9a)".

### Task S9b: staffing

**Files:** the ten `packages/staffing/src` rows above that S9 changes; tests `staff-roles.test.ts`,
`paint.test.ts`, `rota.test.ts`, `month.test.ts`, `routes.test.ts`, `describe-shifts.test.ts`,
`personal-data.test.ts`, `role-retirement-upgrade.test.ts`.

**Produces:** `listStaffRoles(tx)`, `createStaffRole(tx, input)`, `readStaffingMonth(tx, month,
at)`, `readSeasonStaffing(tx, seasonId)` and the rest without `cfg`, except `readRotaWeek` and
`changeRotaWeek`, which keep `cfg` for S13's lines.

- [ ] **Step 1: failing test.** In `staff-roles.test.ts`, change "lists only the venue's own
  roles" (`:128`) — which is a two-venue case — into "lists the venue's roles": one venue, one role
  created, `listStaffRoles(tx)` equals that role. Before the change `cfg` is `undefined` and the
  read throws `TypeError` on `cfg.locationId`.
- [ ] **Step 2:** `pnpm --filter @waitron/staffing exec vitest run src/staff-roles.test.ts` — FAIL.
- [ ] **Step 3: implement** the table above; codemod the test calls (`paint.test.ts` 83,
  `staff-roles.test.ts` 77, `rota.test.ts` 38 lines naming `cfg`, from `git grep -c -E 'cfg' --
  'packages/staffing/*.test.ts' 'packages/staffing/**/*.test.ts'`).
- [ ] **Step 4: delete or trim the cross-location cases.** Delete: `paint.test.ts:220` (season,
  role and area "at another location" — keep its unknown-area assertion by moving it into the
  next case if no other case asserts `staffing_area.not_found` for an unknown id; check with
  `grep -n 'staffing_area.not_found' packages/staffing/src/paint.test.ts`), `staff-roles.test.ts`
  `:128-135`'s second venue and "same name at another location is free" lines. Trim to the unknown
  id: `staff-roles.test.ts:207` and `:355` (loop over `[randomUUID()]` only), `routes.test.ts:281`
  (keep "reads what deleting a role would do" and the unknown-id 404), `routes.test.ts:670` (keep
  the unknown-season 404 and the unknown area/role 400 if the case names them; drop "elsewhere").
  Read `staff-roles.test.ts:407` ("…for this location only"): drop its second venue and the
  "this location only" assertion; keep the label-order assertions.
- [ ] **Step 5:** run the eight test files with `pnpm --filter @waitron/staffing exec vitest run …`
  — PASS; code guards; `pnpm --filter @waitron/staffing typecheck`; `pnpm format:check`.
- [ ] **Step 6: done-check** over `packages/staffing/src/*.ts` (not `dashboard/`): prints only
  `venueLocationId`, the S8 scope lines in `paint.ts`, `month.ts:18`, `rota.ts:43`, and the S13
  lines `rota.ts:85,363` and `staffing-types.ts:113`. The two dashboard files print their S13
  lines.
- [ ] **Step 7: commit** "Staffing reads the venue, not a location (A1301 S9b)".

### Open PRs touching S9's files

`gh pr list --state open` at 2026-11-01 (full file lists from
`gh api repos/{owner}/{repo}/pulls/<n>/files --paginate`): none of #2369, #2373, #2374, #2375,
#2376 or #2377 touches a `packages/bookings` or `packages/staffing` file.

---

## S10 — Printing and layouts

**Goal.** Printing stops scoping by location. The print agent's job claim takes a network printer's
job for any agent of the box (design §6: "the agent's job claim stops filtering by location"); a
print job, printer, page printer or demo printer row gets its `location_id` from the venue; the
device-printer rules in `@waitron/layouts` stop comparing a printer's location with a device's;
the server's printing routes stop passing the server's location around.

- **Depends on:** S1.
- **Lands:** lane. Design §6: "S10 (the print agent's job claim) … [is a] lane slice …: an invoice
  delivery is not an invoice record, and neither slice changes an invoice byte."
- **Branch:** `refactor/a1301-s10-printing-layouts`.
- **Review path:** LIGHT by the trigger list. Two paths need named suites kept green unedited
  (below): the drawer (CLAUDE.md §5) and the invoice receipt claim (`claimInvoicePrintJobs`).

**Drawer jobs (CLAUDE.md §5).** S10 touches the code that queues `drawer` jobs
(`apps/server/src/receipt-print.ts:409,557,648,674`, `apps/server/src/print-api.ts:1247`) and the
resend refusal (`packages/printing/src/outbox.ts:69-119`). These suites must pass with their drawer
assertions unedited (only fixture lines that pass a location to a changed signature may change):
the drawer cases in `apps/server/src/receipt-print.test.ts`, `apps/server/src/till-api.receipt.test.ts`
("opens a handheld's drawer on a cash sale when its profile allows the drawer"),
`apps/server/src/till-api.fiscal-sale-paths.test.ts`, `apps/server/src/bill-payments-api.test.ts`,
the cash refund case in `apps/server/src/till-api.profile-actions.test.ts`, the calibration case in
`apps/server/src/print-api.test.ts`, and the drawer resend refusal in
`packages/printing/src/outbox.test.ts` (list from `docs/developers/conventions-ui.md:490-515`).

### Files (20 from the TSV, plus crossings)

| File | What changes |
| --- | --- |
| `packages/printing/src/runtime.ts` | `claimPrintJobs`'s `ctx.locationId` (`:75`) and the claim's `p.location_id = ${ctx.locationId}` (`:109`) go: a `network_tcp` printer's job is claimable by any agent; `AgentRuntimeDeps.locationId` (`:19`) and its use (`:189-191`) go |
| `packages/printing/src/outbox.ts` | `enqueuePrintJob(tx, printerId, payload, kind?, opts?)` and `insertPrintJob` lose `cfg`; the insert fills `venueLocationId(tx)` (`:56`); the resend copies no location from the old job (`:119` — it fills from the venue too); comment `:85` |
| `packages/printing/src/printers.ts` | `PrintConfig` (`:27-29`) deleted, also from `index.ts:9`; `createPrinter`, `updatePrinter`, `deactivatePrinter`, `listPrinters` lose `cfg`; insert `:75` fills `venueLocationId(tx)` |
| `packages/printing/src/agent.ts` | `PrintAgentConfig` (`:10-12`) deleted with whatever passes it |
| `packages/layouts/src/device-equipment.ts` | `DeviceState.device.locationId` (`:82`), `PrinterInfo.locationId` (`:101`), `ListedPrinter.locationId` (`:113`), `PrinterEquipment.devices[].locationId` (`:120`) and their selects (`:146`, `:162`, `:165`, `:213`, `:230`, `:343`, `:515`) go; the default rule drops `row.locationId === device.locationId` (`:191`); `selectDevicePrinter` drops both location conditions (`:377`, `:401`, `:406`); `listedAt(tx, profileId)` drops its `or(...)` location condition (`:525-541`) — safe because `device_profile_printers_target_ck` (`packages/db/src/schema/device-profile-printers.ts:57-60`) makes exactly one of the two ids non-null and each has its foreign key; the per-location cache in the resettle loop (`:597-603`) becomes one `listedAt` call; comments `:569`, `:585` |
| `packages/layouts/src/device-printers.ts` | comment `:157` |
| `apps/server/src/receipt-print.ts` | `printConfig` (`:42-43`) deleted; `resolveInvoicePrinter(tx, origin)` loses `at` (`:114-127`; its one caller passing `at` is `tillInvoicePrinters`, `till-api.ts:2501`, which S2-3 leaves to S10b); `:197` (`readReceiptLanguage`) is S5's call, which S5 edits; `:214` (`readReceiptAddress`) was changed by S1; the cash-refund drawer lookup drops `eq(tenderRefunds.locationId, cfg.locationId)` (`:628`) and keeps its device, node, method and state conditions |
| `apps/server/src/print-api.ts` | `locations` import (`:19`) and the test page's zone read (`:1331-1334`) → `readVenue(tx).timeZone`; the agent claim's `locationId` (`:711`) and its TODO (`:648`) go; `mountPagePrintersApi`/`mountPagePrintApi` get no `locationId` (`:1044`, `:1059`); demo-printer jobs list drops its filter (`:1392`); `attachPrinterToStation` call (`:1547`) follows S11b; comment `:579`; `:1365` (`readReceiptLanguage`) is S5's call |
| `apps/server/src/page-printers.ts` | every function loses `locationId` (`:27`, `:45`, `:112`, `:131`); `inLocation` (`:106-108`) becomes an id match; the agent-of-this-location check (`:60`) and printer filter (`:79`) go; insert `:95` fills `venueLocationId(tx)` |
| `apps/server/src/page-printers-api.ts` | `deps.locationId` (`:38`) and its uses (`:86`, `:120`, `:143`, `:167`, `:190-191`); `:149` (`readReceiptLanguage`) is S5's call |
| `apps/server/src/page-print-api.ts` | `deps.locationId` (`:53`, `:158`, `:165`) |
| `apps/server/src/demo-printer.ts` | `locationId` parameters (`:30`, `:131`, `:189`, `:219`) go; printer and agent lookups drop the filter (`:39`, `:74`); inserts fill `venueLocationId(tx)` (`:58`, `:84`); `routeToDemoPrinter(tx, printerId)` (`:92`) and the stations read (`:178`); `deliverDemoPrinterJobs(db, identity)` (`:228`) |
| `apps/server/src/station-outputs-down.ts` | `stationPrintersDown(tx, now, …)`, `stationScreensDark(tx, now)`, `stationsWithWaitingDishes(tx, now, …)` lose `locationId` (`:52`, `:91`, `:108`, `:129`) and their filters (`:71`, `:119`, `:216`); the brand import (`:15`) and the local parameter **named `venueLocationId`** (`:141`, `:147`, `:181`) go — it would read as S1's helper in every later done-check. `:147` passes a scope to a venue-service reader (S6): rule 3 |
| `apps/server/src/print-job-trouble.ts` | `options.locationId` (`:109-133`) goes |
| `apps/server/src/box-staff-notices.ts` | `deps.locationId` (`:137`, `:142`, `:157`); comment `:134` |
| `apps/server/src/printer-delete.ts` | `cfg: PrintConfig` (`:39`, `:162`, `:175`) goes; the select of `printers.locationId` (`:42`) and the devices-at-the-printer's-location filter (`:114`) go; comment `:101` |
| `apps/server/src/orders-reprint.ts` | printer filter `:29` |
| `apps/server/src/payment-slip-print.ts` | `enqueuePrintJob` call `:93` |
| `apps/dashboard/src/screens/printers-screen.ts` | comments `:118`, `:1353`. `:2258` (`window.location.origin`) and `:2714` (`location.href`) are browser words: unrelated, left |
| `apps/dashboard/src/widgets/page-printers-panel.ts` | comment `:43` |

**Crossings** (header rule "Calls into another slice's file"; callers in other slices' files).
Two sit in S2's files and are **not edited while S2 has not landed**:
`apps/server/src/invoice-print.ts:59-66` (`claimInvoicePrintJobs` forwards `ctx.locationId` to
`claimPrintJobs`, which keeps an ignored optional `locationId?: string` on its context for it; S2-3
drops the field) and `apps/server/scripts/demo-seed/seed.ts:85,95` (`createPrinter` keeps an ignored
`_cfg: PrintConfig` and `routeToDemoPrinter` an ignored `_locationId: string`, both leading, so every
caller keeps passing them until S18; `PrintConfig` stays exported for that). If S2 has landed when
S10a starts, S10a edits those lines itself, argument only, and drops the ignored parameters.
The rest are lane files: `apps/server/src/kitchen-print.ts:800,
1304,1769,802,1358,1425,1814` (S11: `PrintConfig` values and `enqueuePrintJob` calls);
`apps/server/src/report-api.ts:409`, `apps/server/src/tender-refund-api.ts:230-232` (S11);
`apps/server/src/till-api.ts:2212` and `:2476-2483` (S12: `stationPrintersDown` and
`tillInvoicePrinters`' `sale: { locationId }`); `apps/server/src/device-api.ts:565` (S12);
`apps/server/src/alert-sources.ts:688-694` (S11); `apps/server/src/management-api.ts:1628-1629`
(S7/S11 station status); `apps/server/src/device-equipment.ts:292,370,376,380` (S12: they read
the `locationId` this slice removes from `@waitron/layouts`' types — the device-must-match-printer
check at `:380` goes with it); the F5 test helpers
`apps/server/src/testing/{adjustment-venue,bill-venue,kitchen-allergy-fixture,split-extras-venue}.ts`
(`createPrinter` arguments); whoever builds `box-staff-notices`' and `alert-sources`' deps
(`apps/server/src/boot.ts`, S18 — argument only).

### Task S10a: the printing package and the job claim

**Files:** `packages/printing/src/{runtime,outbox,printers,agent,index}.ts`; the crossings for
`claimPrintJobs`, `claimInvoicePrintJobs` and `PrintConfig`/`enqueuePrintJob`/`createPrinter`
(non-test callers: `git grep -n -E 'enqueuePrintJob\(|createPrinter\(|updatePrinter\(|deactivatePrinter\(|listPrinters\(|claimPrintJobs\(' -- 'apps/**' 'packages/**' ':!*.test.ts'`);
tests `packages/printing/src/*.test.ts`, `apps/server/src/print-api*.test.ts`,
`apps/server/src/invoice-page-print.test.ts`, `apps/server/src/page-print-agent-e2e.test.ts`.

**Produces:** `enqueuePrintJob(tx, printerId, payload, kind?, opts?)`; `createPrinter(tx, input)`,
`updatePrinter(tx, id, patch)`, `deactivatePrinter(tx, id)`, `listPrinters(tx)`;
`claimPrintJobs(tx, agentId, { visibleKeys, printerId?, invoiceReceiptsAt?, invoiceReceiptsAheadAt? })`
(plus the ignored `locationId?` while S2 has not landed). `claimInvoicePrintJobs` is S2's
(`invoice-print.ts`) and is not changed here. No `PrintConfig` export once S2 has landed (until
then it types `createPrinter`'s ignored `_cfg`).

- [ ] **Step 1: failing test.** In `packages/printing/src/runtime.eligibility.test.ts`, replace
  "claims a network_tcp job for any agent in the venue" (`:72`) with a call that names no
  location: `claimPrintJobs(tx, agentId, { visibleKeys: [] })` claims the queued network job.
  Before the change `ctx.locationId` is `undefined` and the claim matches nothing.
- [ ] **Step 2:** `pnpm --filter @waitron/printing exec vitest run src/runtime.eligibility.test.ts` — FAIL.
- [ ] **Step 3: implement** the package rows above, then the callers. The test call sites are many
  (`git grep -c -E '(createPrinter|updatePrinter|deactivatePrinter|listPrinters|enqueuePrintJob|claimPrintJobs|claimInvoicePrintJobs)\(' -- '*.test.ts'`
  summed to 371 lines in 81 files at `abfe271663`): write a small codemod that removes the
  second argument of these calls, run it, then fix what typecheck still reports by hand. While S2
  has not landed it leaves `createPrinter(` calls and `claimInvoicePrintJobs(` calls alone (the
  ignored parameters above), and skips `invoice-print.ts` and `apps/server/scripts/demo-seed/seed.ts`.
- [ ] **Step 4: delete** `runtime.eligibility.test.ts:97` ("does NOT claim a network_tcp job for an
  agent in a DIFFERENT venue") and `runtime.test.ts:357` ("…DIFFERENT venue (venue scope)") with
  their second-location seeds; `apps/server/src/invoice-page-print.test.ts:272` ("does not claim
  another location's delivery…") is an invoice-delivery case — it is S2's to delete if S2 has
  not, and S10 deletes it only if it fails here, saying so in the commit.
- [ ] **Step 5:** run `pnpm --filter @waitron/printing exec vitest run` (the package is small), and
  `pnpm --filter @waitron/server exec vitest run src/print-api.test.ts src/invoice-page-print.test.ts
  src/page-print-agent-e2e.test.ts src/receipt-print.test.ts` — PASS, the drawer and
  `outbox.test.ts` resend cases unedited; code guards; typecheck `@waitron/printing`,
  `@waitron/server`, and every package the codemod touched; `pnpm format:check`.
- [ ] **Step 6: done-check** over `packages/printing/src/*.ts`: prints only `venueLocationId` and,
  while S2 has not landed, the ignored `locationId?` on `claimPrintJobs`' context.
- [ ] **Step 7: commit** "Print jobs are claimed and queued for the venue, not a location (A1301 S10a)".

### Task S10b: layouts and the printers a device may use

**Files:** `packages/layouts/src/device-equipment.ts`, `device-printers.ts`;
`apps/server/src/receipt-print.ts`, `printer-delete.ts`; crossings
`apps/server/src/device-equipment.ts:292,370-382`, `apps/server/src/till-api.ts:2476-2483`;
tests `packages/layouts/src/device-equipment.db.test.ts`, `device-printers.db.test.ts`,
`device-profile-store.db.test.ts`, `apps/server/src/receipt-print.test.ts`,
`printer-delete*.test.ts`, `device-equipment.test.ts`, `device-equipment-api.test.ts`,
`till-api.deliveries.test.ts`.

**Produces:** `PrinterInfo`, `ListedPrinter`, `PrinterEquipment` without `locationId`;
`resolveInvoicePrinter(tx, origin)`.

- [ ] **Step 1: failing test.** In `device-equipment.db.test.ts`, assert that
  `readPrinterEquipment(tx, [deviceId], { lists: true })`'s `printers.get(id)` `toEqual`s
  `{ id, name, kind, portable, active, holderDeviceId }` exactly. FAILS before: the entry carries
  `locationId`.
- [ ] **Step 2:** `pnpm --filter @waitron/layouts exec vitest run src/device-equipment.db.test.ts` — FAIL.
- [ ] **Step 3: implement** the rows above and the crossings.
- [ ] **Step 4: delete or trim:** `device-equipment.db.test.ts:292` (`it.each` — drop the
  `"at another location"` variant, keep "unlisted" and "switched off"), `:378` (the case whose
  default is "a fixed printer at another location": delete if that is its only purpose), `:1077`
  ("resolves None when the default %s printer is at another location") and the
  `"a page printer at another location"` row at `:1106`; `device-printers.db.test.ts:534` ("never
  accepts a listed printer at another location"), `:355` ("devices on one profile at two
  locations…") and the `elsewhere`/`away` seeds at `:103-113` where only those cases use them;
  `apps/server/src/device-equipment.test.ts:583` (drop "or at another location", keep switched
  off) and `:945` (drop "foreign-location", keep deleted); `apps/server/src/till-api.deliveries.test.ts:570`
  ("offers and accepts no invoice printer at another location than the sale's"). Keep
  `till-api.deliveries.test.ts:549` and `:782`: they are about the till's own printer, not a location.
- [ ] **Step 5:** run the listed test files (layouts with `pnpm --filter @waitron/layouts exec
  vitest run …`, server ones with `pnpm --filter @waitron/server exec vitest run …`) — PASS, drawer
  cases unedited; code guards; typecheck `@waitron/layouts`, `@waitron/server`; `pnpm format:check`.
- [ ] **Step 6: done-check** over the four owned files: `receipt-print.ts` prints only `:197`
  (S5's call) if S5 has not landed.
- [ ] **Step 7: commit** "A device's printers are the venue's printers (A1301 S10b)".

### Task S10c: the server's printing routes

**Files:** `print-api.ts`, `page-printers.ts`, `page-printers-api.ts`, `page-print-api.ts`,
`demo-printer.ts`, `station-outputs-down.ts`, `print-job-trouble.ts`, `box-staff-notices.ts`,
`orders-reprint.ts`, `payment-slip-print.ts` (all `apps/server/src/`); the two dashboard comment
files; crossings for `stationPrintersDown`/`stationScreensDark`/`stationsWithWaitingDishes`,
`routeToDemoPrinter`, the deps builders in `boot.ts`. Tests: `page-printers.test.ts`,
`page-printers-api.test.ts`, `page-test-page.test.ts`, `demo-printer*.test.ts`,
`station-outputs-down.test.ts`, `print-job-trouble*.test.ts`, `box-staff-notices*.test.ts`,
`orders-reprint.test.ts`, `alert-sources*.test.ts`, `print-api.printer-wiring.test.ts`,
`apps/dashboard/src/widgets/page-printers-panel.test.ts`.

**Produces:** `stationPrintersDown(tx, now, stationIds?, options?)`, `stationScreensDark(tx, now)`,
`stationsWithWaitingDishes(tx, now, closed?)`; `listPagePrinters(tx)`, `renamePagePrinter(tx, id,
name)`, `disablePagePrinter(tx, id, now?)`; `routeToDemoPrinter(tx, printerId)`.

- [ ] **Step 1: failing test.** In `station-outputs-down.test.ts`, call
  `stationPrintersDown(tx, now)` on a station whose printer is down and expect it listed. Before
  the change `now` sits in the `locationId` slot and nothing matches.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/station-outputs-down.test.ts` — FAIL.
- [ ] **Step 3: implement** the rows above and the crossings.
- [ ] **Step 4: delete or trim:** `page-printers-api.test.ts:674` ("refuses an entry reported by an
  agent of another location"); `page-printers.test.ts:329` ("adds a separate printer in another
  location at the same address" — a case about the per-location key, which S24 changes),
  `:364` (keep the revoked-agent half), `:429` and `:525` (keep the unknown-id half);
  `page-test-page.test.ts:326` (keep disabled and unknown) and `:357` (keep the unknown printer);
  `print-api.printer-wiring.test.ts`: its `tenantA`/`tenantB` cases at `:624-771` call the retired
  `/management-api/locations/:id/receipt-print-mode` and `…/drawer-open-policy` routes — read
  them; a case that proves only "another location's id is refused" is deleted, a case proving the
  route is retired stays.
- [ ] **Step 5:** run the listed tests — PASS (the `print-api.test.ts` calibration case unedited);
  for the dashboard file, check free memory first (`memory_pressure | grep free`, CLAUDE.md §2)
  and run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/page-printers-panel.test.ts`;
  code guards; typecheck `@waitron/server`, `@waitron/dashboard`; `pnpm format:check`.
- [ ] **Step 6: done-check** over the twelve files: `print-api.ts` prints only `:1365` (S5);
  `page-printers-api.ts` only `:149` (S5); `demo-printer.ts` only `routeToDemoPrinter`'s ignored
  `_locationId` while S2 has not landed; `station-outputs-down.ts` only the S6 scope line;
  `printers-screen.ts` only `window.location.origin` and `location.href`.
- [ ] **Step 7: commit** "Printing routes serve the venue, not a location (A1301 S10c)".

### Open PRs touching S10's files

- **#2369** (A696, lands before S1): `apps/server/src/receipt-print.ts`, plus tests
  `orders-reprint.test.ts`, `receipt-print.test.ts`, `station-outputs-down.test.ts`,
  `page-print-agent-e2e.test.ts`. Gone by the time S10 starts.
- **#2373** (W41s-7): no S10 source file; it touches `till-api.ts` and `till-api.test.ts`, which
  S10b crosses into for `tillInvoicePrinters`.
- None of the other open PRs touches an S10 file.

---

## S11 — Server: orders, refunds, kitchen, stations, reports, adjustments

**Goal.** The server's order, kitchen, station, refund, report and adjustments code stops reading
the box's location: it no longer scopes orders, stations, courses, tables or sales by location, no
longer copies an order's location into the next thing it writes, and fills the columns that remain
from the venue. `station.no_default` loses its `locationId` detail (design §5).

- **Depends on:** S1. Lands after nothing else in this part; S10 and S12 cross into a few of its
  files (listed per task), and a lane rebases around them.
- **Lands:** lane. The one invoice-path call in its area is S2's (below), so no owner rule applies.
- **Branch:** `refactor/a1301-s11-orders-kitchen-refunds`.
- **Review path:** LIGHT by the trigger list (no fiscal byte, migration, auth or concurrency
  change). The admission checks in three S11 files move to S12a (below), so S11 changes no
  admission rule.

**What S11 leaves to S2: `working-order.ts:7038`.** At `abfe271663` line 7038 is the comment
`/** Price an order's invoice for {@link issueUnpaidInvoice}. Writes nothing. */`, above
`priceForIssuance` (`:7039-7052`), whose body at `:7050` is
`...issueMoment(clock, await issuancePass(tx, cfg, id, order), backend),`. The design's `:7038` is
A696's numbering: on `7e824ae233`, `apps/server/src/working-order.ts:7038` is
`await prepareIssueClock(tx, cfg, clock),` inside the same `priceForIssuance`
(`git show origin/feat/a696-startup-zone-validation:apps/server/src/working-order.ts | sed -n 7025,7044p`).
After A696 lands, **S11 leaves the `prepareIssueClock(tx, cfg, clock)` call in `priceForIssuance`
to S2**, whatever its line number is then. S11 also leaves, inside `issueUnpaidInvoice`,
`saleLanguageFor(tx, cfg.locationId, …)` (`:7079`, the filed invoice's language) and
`readSaleOperationDescription` (`:7083`) — both on the invoice path, S2's functions (`saleLanguageFor`
moved from S1, Task S2-5) — and
`checkedInvoiceChoiceDelivery(…, { locationId: order.locationId, … })` (`:4427`, S2's
`invoice-delivery*.ts`).

**Admission lines handed to S12a.** `line-cancel-api.ts:47`, `order-kitchen-note-api.ts:61-62` and
`party-allergy-api.ts:109-110` are the device-location admission check
(`device.locationId !== deps.cfg.locationId` → `device.unauthorized`). They go with
`DeviceBinding.locationId` in S12a, which the design names for "admission". S11 leaves them.

### Task S11a: orders and bills

**Files (16):** `working-order.ts` (except the lines above), `order-drafts.ts`, `order-groups.ts`,
`order-kitchen-note.ts`, `order-places.ts`, `orders-api.ts`, `orders-list.ts`, `move-bill.ts`,
`find-bill-api.ts`, `find-bill-bills.ts`, `find-bill-transactions.ts`, `finish-party-service.ts`,
`unpaid-departure.ts`, `party-allergy-api.ts` (`:122` only), `adjustments-apply.ts`,
`order-kitchen-note-api.ts` (nothing left after S12a; listed for the done-check), all
`apps/server/src/`.

| File | What changes |
| --- | --- |
| `working-order.ts` | `captureOrderEdit` (`:326-356`) loses its `locationId` parameter and `captureOrderService` (`:363-381`) its order lookup (rule 4); every caller follows (`:1779`, `:4448-4453`, `:4483-4488`, `:6749-6754`, `:6865`, `:6925`, `:6957-6962`, and `adjustments-apply.ts:1483-1491`); `requireEditableOrder` (`:5479-5498`) stops returning `locationId`; `readChoiceChangeableOrder`'s select (`:4365`) keeps `locationId` only while `:4427` (S2-3) and `:4474` (S2-5) still read it; order creation drops the table and device location conditions (`:1672`, `:1686`) and fills `venueLocationId(tx)` (`:1725`); station routing drops `stationLocationId` (`:2113`, `:2125`) and the default-station filter (`:2162`), and `station.no_default` is thrown with `{}` (`:2169`, `:2182`); courses read without a filter (`:2212`); `listExpoQueue(tx, cfg)` and `listTablesWithState(tx, cfg, annotators?, now?, log?)` lose the optional `locationId` (`:8356-8361`, `:8712-8720`); `readPassBoard(tx, scope)`, `readTodayTables(tx)`, `readSeatedParties(tx, log)` lose it (`:8389`, `:8900`, `:9023`) with their SQL conditions (`:8810`, `:8926`, `:8942`, `:8946`, `:8952`, `:9041`); `:7127-7134` (an order's location copied onward) goes; comments `:5035`, `:8705`, `:8897`, `:9018`. **Left:** `:140` and `:8885` (`annCfg` for the `FloorAnnotator` seat — S18), `:784` (`readInvoiceLocales`, S5), `:817` (read it: a station condition — drop if it filters stations by location), `:4474` (S2-5), `:4427` (S2-3), `:5128`, `:7469`, `:8471` (`orderTableLabels`, S7), `:7079` and the `priceForIssuance` clock (S2) |
| `order-drafts.ts` | `captureDraft` (`:1283-1297`) loses `locationId` (rule 4); its callers (`:290`, `:715`, `:728`, `:782`, `:943`, `:1083`, `:1266`) and the `attendance.locationId` field (`:906`); the course read (`:433`) and the order-location lookup (`:1629-1638`) go |
| `order-groups.ts` | the order-location lookup (`:2414-2422`) goes (rule 4) |
| `order-kitchen-note.ts` | filters `:124`, `:130`, `:147` |
| `order-places.ts` | comment `:75` |
| `orders-api.ts` | printer filter `:260` |
| `orders-list.ts` | full-invoice printers (`:718-731`) drop the sale's-location filter; the `sale.locationId` it reads goes if nothing else uses it |
| `move-bill.ts` | filters `:96`, `:427` |
| `find-bill-api.ts`, `find-bill-bills.ts` | `readLocationClock` → `readVenueClock` (`find-bill-api.ts:6,41`; `find-bill-bills.ts:4,144`); `wo.location_id = …` (`find-bill-bills.ts:71`) |
| `find-bill-transactions.ts` | `scopeRelation` drops `n.location_id = …` (`:20`) — and the `nodes` join if nothing else needs it; `scopeCondition` drops `wo.location_id <> …` (`:36`) and keeps the zone condition; `:75`, `:142` (clock); `resolveTransactionScope` (`:188-205`) returns `{ workingOrderIds }` only (no caller reads its `locationId`: `git grep -n 'resolveTransactionScope(' -- 'apps/**' ':!*.test.ts'` lists seven callers, none naming it) |
| `finish-party-service.ts`, `unpaid-departure.ts` | the attendance `locationId` (`:172`, `:228`; `:183`) per rule 4 |
| `party-allergy-api.ts` | table filter `:122` (the admission line `:109` is S12a's) |
| `adjustments-apply.ts` | `:1483-1491` follow `captureOrderEdit` |

**Produces:** `captureOrderEdit(tx, attendance, orderId, personId, revision, action, at?)`;
`listExpoQueue(tx, cfg)`; `listTablesWithState(tx, cfg, annotators?, now?, log?)`;
`readPassBoard(tx, scope)`; `resolveTransactionScope(tx, cfg, saleId): Promise<{ workingOrderIds: string[] }>`;
`station.no_default` registered as `Record<string, never>` in `apps/server/src/errors.ts:839` (an
S18 file; one line, with its comment `:834-838` cut to the first two sentences).

- [ ] **Step 1: failing test.** In `working-order.test.ts`, change the expectation of "refuses to
  fire when the location has no default station (station.no_default)" (`:3650`) to
  `{ code: "station.no_default", params: {} }` and rename it "…when the venue has no default
  station…". FAILS before: params carry `locationId`. The changed assertion is design §5
  ("codes whose details carry `locationId` (`station.no_default`, …) drop it").
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts -t "no default station"` — FAIL.
- [ ] **Step 3: implement** the table. Also the dashboard's wording for `station.no_default`
  (`apps/dashboard/src/i18n/codes.ts`, S19's file) if it reads `{locationId}` — check with
  `grep -n -A3 'station.no_default' apps/dashboard/src/i18n/codes.ts`; at `abfe271663` it prints
  nothing, so nothing to change.
- [ ] **Step 4: delete or trim:** `working-order.test.ts:7393` ("rejects a DIFFERENT venue's course
  of the same tenant…"); `order-drafts.db.test.ts:1912` ("refuses a course of another location");
  `order-kitchen-note.corrections.test.ts:613` ("does not correct a different location's work…");
  `order-creation-zone.test.ts:255` ("another location's device profile cannot supply the zone…");
  `till-api.kitchen-note.test.ts:421` (`it.each` "hides a %s scope belonging to another location");
  `orders-invoice-deliveries.test.ts:1016` (keep switched off and deleted, drop "or at another
  location"); `transaction-receipt-api.test.ts:159` (keep malformed and missing, drop
  "another-location"); `tender-refund-balance.test.ts:242` (keep the nonexistent sale, drop
  "another location's sale"); `tender-refund-receipt-api.test.ts:383` ("does not reveal or print an
  orderless invoice from another location"). Keep `working-order.test.ts:1501`, `:2018`, `:2922`,
  `:2985`: they are about another **node**, not another location.
- [ ] **Step 5:** run `pnpm --filter @waitron/server exec vitest run` on: `working-order*.test.ts`,
  `order-drafts*.test.ts`, `order-groups.test.ts`, `order-kitchen-note*.test.ts`,
  `order-creation-zone.test.ts`, `orders-*.test.ts`, `move-bill*.test.ts`, `find-bill*.test.ts`,
  `transaction-receipt*.test.ts`, `tender-refund-balance.test.ts`, `tender-refund-receipt-api.test.ts`,
  `finish-party*.test.ts`, `unpaid-departure.test.ts`, `party-allergy*.test.ts`,
  `adjustments-apply.test.ts`, `floor-annotations.test.ts`, `floor-today-state.test.ts`,
  `floor-today-store.test.ts` (the last three call `listTablesWithState` positionally) — PASS;
  code guards (`errors-reachable` sees the registry change); `pnpm --filter @waitron/server
  typecheck`; `pnpm format:check`.
- [ ] **Step 6: done-check** over the sixteen files: prints only `venueLocationId`, the "Left"
  lines of `working-order.ts`, and (until S12a) the three admission lines.
- [ ] **Step 7: commit** "Orders and bills stop scoping by location (A1301 S11a)".

### Task S11b: kitchen and stations

**Files (14):** `apps/server/src/kitchen.ts`, `kitchen-allergy.ts`, `kitchen-print.ts`,
`pass-board.ts`, `alert-sources.ts`, `course-delete.ts`, `dead-ends.ts`, `made-here.ts`,
`station-closing.ts`, `station-delete.ts`, `station-move.ts`, `station-printers.ts`,
`station-today-api.ts`; `packages/db/src/station-colour.ts`.

| File | What changes |
| --- | --- |
| `kitchen.ts` | live-station and live-course checks (`:55-66`, `:261-292`) by id only; default station (`:75-82`) by the flag alone; creates fill `venueLocationId(tx)` (`:106`, `:309`) and `nextStationColour(tx)` (`:111`); list and by-id filters (`:154`, `:219`, `:335`, `:393`); `:164` passes a scope to `VENUE_SERVICE.stationStates` (S6): rule 3; comments `:75`, `:299` |
| `kitchen-allergy.ts` | order filters `:104`, `:243`, `:326`, `:468` |
| `kitchen-print.ts` | `PrintConfig` values (`:800`, `:1304`, `:1769`) already gone if S10a landed, otherwise go with it; order filter `:917`; `:434` (`orderTableLabels`, S7) left |
| `pass-board.ts` | `readPassBoard` calls (`:64`, `:98`); `scopedItems` condition (`:119`); comments `:116`, `:155` |
| `alert-sources.ts` | `deps.locationId` (`:372`, `:676`) and the three station calls (`:688-694`, already changed if S10c landed) |
| `course-delete.ts`, `dead-ends.ts` | filters `:46`; `:35` |
| `made-here.ts` | comment `:247` |
| `station-closing.ts` | `unfinishedAtStation(stationId)` and its caller lose `locationId` (`:11-25`, `:65`) |
| `station-delete.ts` | filters `:48`, `:70`, `:89`, and the draft-order subquery's `draft_order.location_id = …` (`:103`); `:79` (`orderTableLabels`, S7) left |
| `station-move.ts` | order filter `:314`; `:336` (`VENUE_SERVICE.stationStates`, S6) left |
| `station-printers.ts` | `attachPrinterToStation(tx, { stationId, printerId })` (`:25-34`); `cfg: PrintConfig` params (`:50`, `:66`, `:85`, `:108`) go; filters `:91`, `:115`; crossing `print-api.ts:1547` and the F5 helpers `apps/server/src/testing/{adjustment-venue.ts:373,kitchen-allergy-fixture.ts:86,split-extras-venue.ts:96,113}` |
| `station-today-api.ts` | `openDishCount(tx, id)` (`:67`, `:138`; defined in `station-closing.ts`) |
| `station-colour.ts` | `nextStationColour(tx)` (`:8-13`). Its caller `packages/provisioning/src/venue-apply.ts:307` is S16's file: while S16 has not landed, `nextStationColour` keeps an ignored optional `_locationId?: string` for it and S16 drops the argument; if S16 has landed, S11b edits the call, argument only |

**Produces:** `nextStationColour(tx)`; `attachPrinterToStation(tx, { stationId, printerId })`;
`openDishCount(tx, stationId)`.

- [ ] **Step 1: failing test.** In `packages/db/src/station-colour.test.ts`, call
  `nextStationColour(tx)` with one active station and expect the next colour. FAILS before:
  `locationId` is `undefined`.
- [ ] **Step 2:** `pnpm --filter @waitron/db exec vitest run src/station-colour.test.ts` — FAIL.
- [ ] **Step 3: implement** the table and crossings.
- [ ] **Step 4: delete or trim:** `station-colour.test.ts:37` (`it.each` — drop `"another
  location"`, keep `"inactive"`); `kitchen.test.ts:161` (same shape), `:759` ("refuses to edit
  another venue's course"), `:872` (keep unknown id); `kitchen.remove-course.test.ts:230` (keep
  unknown); `kitchen-allergy.capture.test.ts:999` (keep "absent tickets", drop "another location's
  work"); `kitchen-allergy.notices.test.ts:598` ("another location cannot update the copy…");
  `made-here.test.ts:588` (keep switched off, drop foreign-location); `station-move.test.ts:2318`
  ("refuses an order of another location…"); `station-printers.test.ts:273` ("refuses station
  mapping operations through another location") and `:298` (keep "removed", drop
  "other-location"); `station-delete.test.ts:422` — read it: it asserts that other stations and
  dates are untouched; drop only its other-location seed and assertion.
- [ ] **Step 5:** run `pnpm --filter @waitron/server exec vitest run` on `kitchen*.test.ts`,
  `pass-board*.test.ts`, `alert-sources*.test.ts`, `course-delete*.test.ts`, `dead-ends*.test.ts`,
  `made-here*.test.ts`, `station-*.test.ts`, `till-api.station-today.test.ts`,
  `till-api.keep-open.test.ts`; `pnpm --filter @waitron/db exec vitest run src/station-colour.test.ts`;
  `pnpm --filter @waitron/provisioning exec vitest run src/venue-apply.test.ts` (crossing) — PASS;
  code guards; typecheck `@waitron/server`, `@waitron/db`, `@waitron/provisioning`;
  `pnpm format:check`.
- [ ] **Step 6: done-check** over the fourteen files: prints only `venueLocationId`, the S6 scope
  lines (`kitchen.ts:164`, `station-move.ts:336`) and the S7 `orderTableLabels` calls.
- [ ] **Step 7: commit** "Kitchen and stations stop scoping by location (A1301 S11b)".

### Task S11c: refunds, payments, receipts, report, adjustments package

**Files (15):** `apps/server/src/bill-refunds.ts`, `payments-api.ts`, `tender-refund-api.ts`,
`tender-refund-authorization.ts`, `tender-refund-reservation.ts`, `tender-refund-sends.ts`,
`tender-refunds.ts`, `receipt-guests.ts`, `receipt-order.ts`, `receipt-preview-api.ts`,
`report-api.ts`, `line-cancel-api.ts` (nothing left after S12a); `packages/adjustments/src/routes.ts`,
`provisioning.ts`, `dashboard/adjustment-report-screen.ts`.

| File | What changes |
| --- | --- |
| `bill-refunds.ts` | `captureRefundAttendance` (`:98-122`) loses `locationId?` and the order lookup (`:104-113`); callers `:706`, `:746`, `:765` (rule 4). Design §6 names `bill-refunds.ts:104-119,706` for S11; this is that change |
| `payments-api.ts` | stuck-refund list filter `:1495`; `readStuckTenderRefund(tx, db, id)` calls (`:1524`, `:1549`) |
| `tender-refund-sends.ts` | `readStuckTenderRefund` loses `locationId?` and its mismatch refusal (`:209-212`); `:195` (a refund's location copied onward) goes |
| `tender-refunds.ts` | `:131` copies a refund's location onward: goes |
| `tender-refund-reservation.ts` | the refund insert fills `venueLocationId(tx)` (`:239`) |
| `tender-refund-api.ts` | device filter `:72`; print call `:230-232` (S10a) |
| `tender-refund-authorization.ts` | device filter `:105` |
| `receipt-guests.ts` | `cfg: { locationId: LocationId }` (`:5`, `:31`) — the parameter goes if that was its only field |
| `receipt-order.ts` | `:53` (`orderTableLabels`, S7) left |
| `receipt-preview-api.ts` | `activeReceiptSettings(tx)` (`:119-123`) and its call (`:329`); comment `:70`; `:381` (`readReceiptAddress`) was changed by S1; `:314`'s `departmentReceiptLanguages` argument goes with S5 or S2-5 |
| `report-api.ts` | `cfg` type keeps `nodeId` only (`:57-58`); `countOpenTables(tx)` drops the `nodes` join and its `nodeId` parameter (`:142-158`, design `report-api.ts:155`); printer filter `:211`; print call `:409` (S10a); comment `:253` |
| `packages/adjustments/src/routes.ts` | `reportInput(tx, range)` reads `readVenueClock` (`:21`, `:194-200`, `:224`, `:240`) |
| `packages/adjustments/src/provisioning.ts` | the province and invoice locales come from `readVenue(tx)` (`:7`, `:86-91`) instead of `locations` by `node.locationId` |
| `packages/adjustments/src/dashboard/adjustment-report-screen.ts` | comment `:427` |

**Produces:** `readStuckTenderRefund(tx, db, refundId)`; `activeReceiptSettings(tx)` (module-private).

- [ ] **Step 1: failing test.** In `report-api.overview.test.ts`, add "counts the venue's open
  tables whatever node asks": mount the overview with a `cfg.nodeId` that has no `nodes` row and
  expect `openTables` to equal the seeded venue's `{ open: 1, total: 2 }` (the same seed as
  `:233`). FAILS before: the `join nodes n on n.location_id = dt.location_id where n.id = …`
  finds no node and counts `0`.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/report-api.overview.test.ts` — FAIL.
- [ ] **Step 3: implement** the table.
- [ ] **Step 4: delete or trim:** `tender-refund-authorization.test.ts:307` ("rejects a device moved
  to a different location"); `tender-refund-reservation.test.ts:452` ("refuses a sale in a different
  location"); `tender-refund-management.test.ts:450` ("refuses another location's return…");
  `tender-refund-api.test.ts:235` (`it.each` — drop the variant that moves the device at `:279`);
  `receipt-preview-drafts.test.ts:220` is a department case (S6), left. Read
  `report-api.categories.test.ts:465` ("lists this location's active printers…"): drop only a
  second-location printer if it seeds one.
- [ ] **Step 5:** run `pnpm --filter @waitron/server exec vitest run` on `bill-refunds*.test.ts`,
  `payments-api*.test.ts`, `tender-refund*.test.ts`, `receipt-guests*.test.ts`,
  `receipt-order*.test.ts`, `receipt-preview*.test.ts`, `report-api*.test.ts`; and
  `pnpm --filter @waitron/adjustments exec vitest run` — PASS; code guards; typecheck
  `@waitron/server`, `@waitron/adjustments`; `pnpm format:check`.
- [ ] **Step 6: done-check** over the fifteen files: prints only `venueLocationId`, the S7 and S1
  calls named above, and (until S12a) `line-cancel-api.ts:47`.
- [ ] **Step 7: commit** "Refunds, receipts and reports stop scoping by location (A1301 S11c)".

### Open PRs touching S11's files

- **#2373** (W41s-7, `feat/w41s7-conflict-recovery`): `bill-refunds.ts`, `payments-api.ts`,
  `tender-refund-api.ts`, `tender-refund-sends.ts`, `tender-refunds.ts`, `working-order.ts`; tests
  `bill-refunds.card.test.ts`, `tender-refunds.test.ts`, `tender-refund-management.test.ts`.
  S11a and S11c rebase around it.
- **#2369** (A696, lands before S1): `adjustments-apply.ts`, `bill-refunds.ts`,
  `finish-party-service.ts`, `line-cancel-api.ts`, `order-drafts.ts`, `payments-api.ts`,
  `tender-refund-api.ts`, `tender-refund-sends.ts`, `tender-refunds.ts`, `unpaid-departure.ts`,
  `working-order.ts`, and 26 of S11's test files.
- **#2372** (A803 slice 4) **merged** at 2026-11-01T14:54Z as `9a7efbb6b0`
  (`gh pr view 2372 --json state,mergedAt,mergeCommit`), so it is in `abfe271663` and no longer an
  overlap.

---

## S12 — Server: devices, joins, admission, node reads, personal-data export

**Goal.** A device is admitted for what its profile and its signed-in person allow, with no
"same location as the server" check; device, join-request and print-agent rows take their
`location_id` from the venue; the promotion, restore and personal-data paths read the venue
instead of the node's location; and `GET /management-api/locations` with the dashboard's `getLocations` query is deleted (S12d,
its own branch). The restore confirmation's `venueName` rename is S16's (header, "Files moved from
the design's slice").

- **Depends on:** S1. S12d is a separate PR that depends on S15 (header table).
- **Lands:** lane.
- **Branch:** `refactor/a1301-s12-devices-joins-admission`.
- **Review path:** **FULL** — auth and permissions risk trigger: it removes a refusal from the
  device admission checks of every till route that has one, and changes a wire shape the setup
  app reads.

**Admission suites that stay green unedited** (CLAUDE.md §3, "A device's profile and the signed-in
person must both allow a till action"): `apps/server/src/till-api.profile-actions.test.ts` and
`apps/server/src/till-api.profile-zones.test.ts`. Neither holds a location-mismatch case
(`grep -n -i location` prints only a map row about attendance and two fixture inserts,
`till-api.profile-actions.test.ts:495` and `till-api.profile-zones.test.ts:1667`, which are F5's).
Their refusing cases must pass with no assertion edited; the maps at the top of each file do not
change, because no route is added or removed. The drawer suites listed under S10 also stay green:
S12a touches `till-api.ts` routes that take cash.

### Task S12a: device admission

**Files:** `apps/server/src/device-session.ts`, `device-zones.ts`, `till-api.ts` (`:1034`,
`:2937-2938`, `:3465-3466`, `:1438`), crossings `line-cancel-api.ts:47`,
`order-kitchen-note-api.ts:61-62`, `party-allergy-api.ts:109-110` (S11 files) and the two `admit`
functions `till-attendance-api.ts:101-102`, `till-clock-api.ts:79-80` (S13 files; design §6 "Device
admission by location (`admit`) — out of A1268 — S12").

| File | What changes |
| --- | --- |
| `device-session.ts` | `DeviceBinding.locationId` (`:98`), `deviceBindingColumns.locationId` (`:108`) and `toDeviceBinding`'s copy (`:155`) go |
| `device-zones.ts` | `currentZoneDevice(tx, session)` — the `cfg` parameter (`:11`) and the location refusal (`:16`) go |
| `till-api.ts` | the three `device.locationId !== deps.cfg.locationId` refusals (`:1034`, `:2937-2938`, `:3465-3466`); `:1438` (`locationId: current.locationId` into the attendance recorder) per rule 4 |
| crossings | the same refusal in `line-cancel-api.ts:47`, `order-kitchen-note-api.ts:61-62`, `party-allergy-api.ts:109-110`; the `attendance.not_permitted` location refusal in both `admit`s |

**Produces:** `DeviceBinding` without `locationId`; `currentZoneDevice(tx, session)`.

- [ ] **Step 1: failing test.** In `apps/server/src/device-session.test.ts` (no case there calls
  `toDeviceBinding` today; it is exported at `device-session.ts:145`), add one: select
  `deviceBindingColumns` for a seeded device, pass the row to `toDeviceBinding(id, row)`, and
  assert it `toEqual`s `{ deviceId, formFactor, label, deviceProfileId, capabilities }` exactly.
  FAILS before: it carries `locationId`.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/device-session.test.ts` — FAIL.
- [ ] **Step 3: implement** the table; callers of `currentZoneDevice` follow typecheck.
- [ ] **Step 4: delete or trim the cases that move a device to another location** (found with
  `git grep -l -E 'update\(devices\)' -- 'apps/server/src/*.test.ts' | xargs grep -n -E 'set\(\{ *locationId'`):
  `till-api.allergy.test.ts:658` ("A669 refuses a device relocated away from this process for %s")
  and `:474` ("hides another location's party from %s", with its `:490` move);
  `till-api.allergy-move.test.ts:401` ("… refuses a source bill from another location", `:413`);
  `device-zones-api.test.ts:370` ("refuses a session belonging to another venue location…");
  `till-attendance-api.test.ts:229` and `till-hours-api.test.ts:89` (`it.each` — drop the
  `"location"` variant, `:260`, `:125`); `till-clock-api.test.ts:148` (drop `"location"`, `:192`)
  and `:426` (keep revoked person and ended session, drop "device moved to another location",
  `:441`). Every other variant of those `it.each` tables stays as it is.
- [ ] **Step 5:** run `pnpm --filter @waitron/server exec vitest run src/till-api.profile-actions.test.ts
  src/till-api.profile-zones.test.ts` FIRST and confirm `git diff --stat` shows neither file
  changed; then `device-session*.test.ts`, `device-zones*.test.ts`, `till-api.allergy*.test.ts`,
  `till-api.kitchen-note.test.ts`, `line-cancel*.test.ts`, `order-kitchen-note*.test.ts`,
  `party-allergy*.test.ts`, `till-attendance-api.test.ts`, `till-hours-api.test.ts`,
  `till-clock-api.test.ts`, `till-api.receipt.test.ts`, `till-api.fiscal-sale-paths.test.ts` —
  PASS; code guards; `pnpm --filter @waitron/server typecheck`; `pnpm format:check`.
- [ ] **Step 6: done-check:** `git grep -n -E 'locationId !== (deps\.)?cfg\.locationId' -- 'apps/server/src/*.ts' ':!*.test.ts'`
  prints nothing (at `abfe271663` it prints nine lines: `device-zones.ts:16`,
  `line-cancel-api.ts:47`, `order-kitchen-note-api.ts:61`, `party-allergy-api.ts:109`,
  `till-api.ts:1034,2937,3465`, `till-attendance-api.ts:101`, `till-clock-api.ts:79`).
- [ ] **Step 7: commit** "A device is admitted by its profile and person, not by a location (A1301 S12a)".

### Task S12b: devices, joins, promotion, till start read

**Files:** `apps/server/src/device.ts`, `device-api.ts`, `device-equipment.ts` (what S10b left),
`device-levers.ts`, `join-requests.ts`, `promote.ts`, `till-setup.ts`, `till-api.ts` (`:2212`,
`:2481`, `:4345`, comments `:302`, `:2476`).

| File | What changes |
| --- | --- |
| `device.ts` | the profile switch's select (`:305`) loses `locationId`; `:326` passes a scope to `VENUE_SERVICE.narrowDeviceKitchenScreens` (S6): rule 3 — fill it from `cfg` if the function has one, else leave the line for S6 and note it; `DEVICE_NAME_UNIQUE` (`:47-51`) names the key's real columns until S26 changes the key, so it stays (schema-shaped, S26) |
| `device-api.ts` | `stationsHere(tx)` and `worksStation`'s filter (`:1071`, `:1077-1081`); `stationPrintersDown` call (`:565`, S10c); the `Pick<TradingContext, "locationId">` parameters (`:1000`, `:1015`, `:1030`, `:1061`) stay only where they are forwarded to `VENUE_SERVICE.readDeviceKitchenScreens` (S6); comment `:1076` |
| `device-equipment.ts` | whatever S10b did not already remove (`:292`, `:370-380`) |
| `device-levers.ts` | order filter `:47` |
| `join-requests.ts` | the join-request insert fills `venueLocationId(tx)` (`:207`); the read and the two consuming deletes stop returning `locationId` (`:337`, `:348`, `:528`, `:603`); the device and print-agent inserts fill `venueLocationId(tx)` (`:565`, `:613`, `:730`) |
| `promote.ts` | the node read (`:250-255`) keeps its existence check (`node.not_found`) but selects `nodes.id`, and `node.locationId` comes from `await venueLocationId(…)` until S18 removes `ProvisionedNode.locationId` (`packages/module/src/provisioning.ts:9`); brand import `:35` |
| `till-setup.ts` | the error text `:89` names no location ("no taxpayer row"); comment `:96`; `:83-84` (`readOfferedReceiptLanguages`) is S2-5's call |
| `till-api.ts` | `:2212` (S10c's call), `tillInvoicePrinters`' `sale` (`:2476-2483`, S10b), order filter `:4345`; comment `:302`. `:624` (`"bill.allocation_changed"`) is unrelated |

- [ ] **Step 1: failing test.** In `join-requests.test.ts`, assert that the pending join request
  read (`:330-352`'s function) `toEqual`s a record with no `locationId` key. FAILS before.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/join-requests.test.ts` — FAIL.
- [ ] **Step 3: implement** the table.
- [ ] **Step 4: delete or trim:** `join-requests.test.ts:1041` ("takes the printers of a new
  profile at the device's own location, not the request's", with its `:1073` move);
  `device-api.test.ts:1409` ("refuses, on an every-station screen, a switched-off station's dish at
  another location"); `device.test.ts:433` ("accepts the same name at another location" — it proves
  only that two locations may share a device name; the key itself changes in S26).
- [ ] **Step 5:** run `pnpm --filter @waitron/server exec vitest run` on `device*.test.ts`,
  `join-requests*.test.ts`, `promote*.test.ts`, `till-setup*.test.ts`, `till-api.test.ts`,
  `till-api.station-today.test.ts`, `till-api.deliveries.test.ts`, `till-api.allergy*.test.ts` —
  PASS; `till-api.profile-actions.test.ts` and `till-api.profile-zones.test.ts` again, unedited;
  code guards; `pnpm --filter @waitron/server typecheck`; `pnpm format:check`.
- [ ] **Step 6: done-check** over the files: prints only `venueLocationId`, `device.ts:47-51` (S26),
  the S6 forwarding lines in `device-api.ts` and `device.ts:326` if S6 has not landed,
  `till-setup.ts:83-84` until S2-5 lands, and `till-api.ts:624` (unrelated).
- [ ] **Step 7: commit** "Devices, joins and promotion take the venue, not a location (A1301 S12b)".

### Task S12c: personal-data export and the restored venue's lookup

The restore confirmation's `locationName` → `venueName` rename (`RestoredVenue`, the
`restore.stream_venue_unconfirmed` params in `apps/server/src/errors.ts`, `restore-command.ts:509`,
`scripts/personal-log-params.test.ts:125` and the setup app's restore screens) moved to Task S16c
(header, "Files moved from the design's slice"). S12c keeps only the lookup.

**Files:** `packages/module/src/personal-data.ts`, `apps/server/src/personal-data-export-api.ts`,
`personal-data-time-record.ts`, `restore-stream.ts` (`readRestoredVenue`, `:209-223`, only).

| File | What changes |
| --- | --- |
| `packages/module/src/personal-data.ts` | `PersonalDataSubject.locationId` (`:14-15`) goes |
| `personal-data-export-api.ts` | `venuePlace(tx, nodeId)` (`:49-59`) becomes a zone read from `readVenue(tx)` through `knownZone`, with no `nodes` join; the `locations`/`nodes` imports (`:4`) follow |
| `personal-data-time-record.ts` | the time-entry range read drops `eq(timeEntries.locationId, …)` (`:35`) — if A1268 has not already removed it — and the null-location early return (`:26-27`); `exporter.prepare`'s `locationId` (`:40`) stays as long as `RecordExportInput.locationId` exists (moved to S14, header table), filled with `await venueLocationId(tx)`; comment `:16` |
| `restore-stream.ts` | `readRestoredVenue` (`:209-223`) reads the restored copy's one venue row by no id (design `restore-stream.ts:214`) — through `readVenue` if S1's accessor accepts the opened copy's handle (`store.venue`), otherwise the one `locations` row with no `where`. The `RestoredVenue` field name is S16c's: leave it as it is at the task's head |

**Produces:** `PersonalDataSubject` without `locationId`.

- [ ] **Step 1: failing tests.** In `personal-data-export-api.test.ts`, "dates the file in UTC when
  the venue's stored zone is unknown" (`:290`) also asserts the subject has no `locationId` key
  (design §1, "Nothing passes a location id"). In `restore-stream.test.ts`, "confirms the restored
  copy's venue whatever venue id the backup settings name": with the settings' `venueId` set to an id
  no row in the copy holds, the confirmation still names the copy's venue. Both FAIL before (the
  subject carries `locationId`; the lookup's `where id = venueId` finds no row).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/restore-stream.test.ts
  src/personal-data-export-api.test.ts` — FAIL.
- [ ] **Step 3: implement** the table.
- [ ] **Step 4: delete:** `personal-data-export-api.test.ts:280` ("dates the file in UTC with no
  location when this node has no row" — the node no longer decides the zone; the unknown-zone case
  at `:290` keeps the UTC fallback covered); `personal-data-time-record.test.ts:250` ("builds no
  files when the node has no location") and `:254` ("…whose only entries are at another
  location"). Keep `restore-stream.test.ts:292`, `:417`, `:430`: "another venue" there is another
  bucket's copy, not a location.
- [ ] **Step 5:** run `pnpm --filter @waitron/server exec vitest run src/personal-data*.test.ts
  src/restore-stream*.test.ts src/restore-request*.test.ts`;
  `pnpm --filter @waitron/module exec vitest run src/personal-data.test.ts` — PASS; code guards;
  typecheck `@waitron/module`, `@waitron/server`; `pnpm format:check`.
- [ ] **Step 6: done-check** over the four files: prints only `venueLocationId`,
  `personal-data-time-record.ts:40` (S14), and `restore-stream.ts`'s `RestoredVenue.locationName`
  until S16c lands.
- [ ] **Step 7: commit** "Personal-data export and the restored venue's lookup read the venue (A1301 S12c)".

### Task S12d: delete `GET /management-api/locations` and `getLocations`

- **Depends on:** S15 (not in this plan) — **starts only after S15 has removed
  `planned-actual-screen.ts`'s `getLocations` watch** (`apps/dashboard/src/screens/planned-actual-screen.ts:99`,
  the route's last user; header, "Files moved from the design's slice").
- **Lands:** lane. **Branch:** `refactor/a1301-s12d-locations-route`, its own PR.
- **Review path:** FULL — a cross-package contract (a server route the dashboard calls).

Every caller, from `git grep -n -E 'getLocations|LocationSummary|/management-api/locations([^/]|$)' -- apps packages scripts`:

- server: the route `apps/server/src/workforce-api.ts:108-118` (and the `locations` import `:7` if
  nothing else in the file uses it — `:124`, `:136`, `:405` are S13's query parameters, not the
  table); its tests `workforce-api.test.ts:105` and `:208`;
- dashboard: `apps/dashboard/src/api/client.ts:1044-1048` (`LocationSummary`) and `:4147-4149`
  (`getLocations`); `apps/dashboard/src/api/live-queries.ts:492`; the one production caller
  `apps/dashboard/src/screens/planned-actual-screen.ts:99` (S15's); test stubs
  `dashboard-app.a11y.test.ts:79`, `dashboard-app.disk-stop.test.ts:87`, `dashboard-app.help.test.ts:86`,
  `dashboard-app.test.ts:152`, `api/client.test.ts:1029-1036`, and the
  `planned-actual-screen*.test.ts` stubs (S15's, gone with the picker);
- till: none. Setup: none. `packages/`: none. No server live-resource source names `getLocations`
  (`git grep -n getLocations -- apps/server packages scripts` prints nothing).

`/management-api/locations/:id/catalogues…` (`catalogue-api.ts:1283-1312`, S5) and the retired
`/management-api/locations/:id/receipt-print-mode` test paths are other routes.

- [ ] **Step 1: failing test.** In `workforce-api.test.ts`, replace ":105 GET
  /management-api/locations lists the tenant's locations" with "GET /management-api/locations is
  gone": expect `404`. FAILS before (`200`).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/workforce-api.test.ts -t "management-api/locations"` — FAIL.
- [ ] **Step 3: delete** the route, `LocationSummary`, `getLocations`, the live-query entry and the
  four `dashboard-app*.test.ts` stubs; delete `client.test.ts:1029` and `workforce-api.test.ts:208`
  (the 401 for the deleted route). The other `"locations"` table names in `live-queries.ts` are
  S23's.
- [ ] **Step 4:** `pnpm --filter @waitron/server exec vitest run src/workforce-api.test.ts`; check
  free memory (`memory_pressure | grep free`), then `pnpm --filter @waitron/dashboard exec vitest
  run src/api/client.test.ts src/api/live-queries.test.ts src/dashboard-app.test.ts
  src/dashboard-app.a11y.test.ts src/dashboard-app.disk-stop.test.ts src/dashboard-app.help.test.ts`
  — PASS; `pnpm exec vitest run scripts/live-subscriptions.test.ts` and the other code guards;
  typecheck `@waitron/server`, `@waitron/dashboard`; `pnpm format:check`.
- [ ] **Step 5: done-check:** the grep in this task's first paragraph prints only the catalogue
  routes (S5) and `print-api*.test.ts`'s retired-route paths. Over `client.ts` and
  `live-queries.ts`, the design pattern prints only S5's catalogue lines (`client.ts:499`,
  `:3114-3137`), S13/S15's roster and shift types and calls (`:988`, `:999`, `:1014`, `:1087`,
  `:4151-4160`, `:4210-4212`), the comments S12d rewords or leaves (`:616`, `:620`, `:2407` —
  reword to "the venue's"), and S23's table names in `live-queries.ts`.
- [ ] **Step 6: commit** "Delete the locations list route and its dashboard query (A1301 S12d)".

### Open PRs touching S12's files

- **#2369** (A696, lands before S1): `apps/dashboard/src/api/client.ts`, `apps/server/src/till-api.ts`,
  and 37 S12 test files, among them `till-api.profile-actions.test.ts` and
  `till-api.profile-zones.test.ts`.
- **#2373** (W41s-7): tests `till-api.test.ts`, `till-api.fiscal-sale-paths.test.ts`,
  `till-api.zone-required.test.ts`; S12a and S12b rebase around it.
- **#2375** (A1268 part 1): `till-attendance-api.test.ts`, `till-clock-api.test.ts`, which S12a
  trims.

---

## Names used in S16, S17 and F2–F5

Lines in these sections were read at main `abfe271663` and, in a file A696 changes, at
`7e824ae233` (`git show origin/feat/a696-startup-zone-validation:<path>`). Every implementer re-runs
the listing commands at their own head: line numbers move.

- **FX**, the fixture grep: `FX='insert\((schema\.)?(locations|nodes|devices|workingOrders)\)|[Ii][Nn][Ss][Ee][Rr][Tt] [Ii][Nn][Tt][Oo] "?locations'`
  (the summary's three fixture greps in one; the raw-SQL half is spelt case by case because zsh's
  `grep` is ugrep and `git grep -i` would also lower the drizzle half).
- **The venue fields**: the eleven keys of today's `LocationDraft` (`apps/setup/src/api/client.ts:60-72`):
  `name, fiscalTerritory, invoiceLocales, operationDescription, addressLine1, addressLine2, postalCode,
  city, province, timeZone, dayCutover`.
- **F1's codemod** is `scripts/a1301-seed-codemod.mjs` (F1); F2–F5 say what each task runs it over,
  never how it works.

---

## S16 — Setup, restore and provisioning read venue fields

**Goal.** The setup request, the first-setup claim, the frozen request in `first-setup.json` and the
CLI stop nesting the venue's settings under `location`: the eleven venue fields sit directly on the
venue, beside `country`, `taxId` and `legalName`. `LocationDraft` folds into the setup app's venue
draft. Setup and restore choose the filing module from that venue field. The restore preview names
the venue (`venueName`), read with `readVenue`, not through the node's location. The setup app's
words "Location" / "Location name" become "Venue" / "Venue name" (Spanish already says "Local").
`first-setup.json` and its attempt files lose the `location` key, so a box holding an old one is
reset (design §4, "Host files").

- **Depends on:** S1 landed (A696 landed before it).
- **Lands:** **owner**, rule (c): it touches the path that chooses the filing module and starts the
  chain at setup and restore.
- **Branch:** `refactor/a1301-s16-setup-venue-fields`.
- **Review path:** FULL — fiscal (filing-module choice at setup/restore) and a cross-package
  contract (the setup request read by `provisioning`, `apps/server`, `apps/setup`,
  `fiscal-verifactu`).
- **The PR's first line** (wording fixed by Task S16b's probe): "A box whose `<state>/first-setup.json`
  was written before this change is reset: the file names `location`, which this version refuses."
  If the probe shows a box that FINISHED first setup also fails to start, the line says "Every box
  set up through first setup is reset", and the watcher's reset roster is told.
- **Fiscal pair, unedited:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`, at the end of every
  task. Neither file names the setup request (`git grep -n -i location -- packages/fiscal-verifactu/src/inmutabilidad.test.ts`
  prints nothing; `write-path.e2e.test.ts` names a location only at `:552-555`, a device seed F1
  owns). Any change to what a fiscal record or hash contains is a STOP for the owner. Nothing here
  changes one: the request's values are unchanged, only their nesting.
- **Also must pass:** `pnpm --filter @waitron/server exec vitest run src/first-fiscal-setup.e2e.test.ts`.
  It cannot stay byte-for-byte unedited: its lines `:246-254` and `:368` build the claim from the
  request's and the preview's `location` (read at `7e824ae233`). Task S16b edits the lines that build
  the setup request, inside `:246-254` and `:368`, and changes no assertion; the diff of that file
  must show no other changed line (`git diff -U0 main -- apps/server/src/first-fiscal-setup.e2e.test.ts`).
  **S16's PR names this file and these lines.**

### The new request shape (every S16 task uses it)

- `packages/provisioning/src/venue-plan.ts`: `VenueRequest` loses `location`; its eleven venue fields
  sit on `VenueRequest` itself with today's types (`name: string; fiscalTerritory: string;
  invoiceLocales: string[]; operationDescription: string; addressLine1: string; addressLine2:
  string | null; postalCode: string; city: string; province: string; timeZone: string; dayCutover:
  string`). Export `VENUE_FIELDS` (the eleven keys, `as const satisfies readonly (keyof VenueRequest)[]`)
  for the server parsers and `first-setup-state.ts`.
- `VenueAction` kind `create-location` becomes `create-venue`; `describeAction` prints
  `create venue <name> in <territory> (<locales>)`. `applyVenue` still writes the one `locations`
  row (S23 moves it); `ApplyResult.locationId` stays (moved to S18, header table).
- Refusal fields lose the prefix: `setup.request_invalid { field: "location.postalCode" }` becomes
  `{ field: "postalCode" }`, for every venue field (`setup-api.ts:437-511`,
  `fiscal-verifactu/src/venue-fields.ts:53,88`, `apps/setup/src/server-fields.ts:48`). Changed
  assertions name design §2.5 / §6 S16 ("`LocationDraft` folds into the venue draft").
- Wire renames: `ProvisionBody.demoLocationNameSource` → `demoVenueNameSource`
  (`setup-api.ts:571-576`, `apps/setup/src/api/client.ts:93`); CLI `--location-name` →
  `--venue-name` and its prompt `venue name: ` (`packages/provisioning/src/cli.ts:91,168,210`).
  The country pack's `identity.locationName` (`setup-api.ts:589`, `venue-screen.ts:479`) is read
  unchanged: S19 renames `demo.locationName`.

### The venue-request codemod (written in Task S16a, run in S16a–S16f)

A Node `.mjs` script kept outside the repo (its text pasted into the PR description as the receipt;
not committed). It loads `typescript` with `createRequire(<worktree>/package.json)` (the root
resolves the version-6 API) and, for each file named on its command line:

1. replaces a property `location: { … }` whose value is an object literal AND whose parent object
   literal has a property named `country`, `taxId`, `legalName` or `seriesCode`, with the inner
   properties (so `{ taxId, location: { name, city } }` becomes `{ taxId, name, city }`);
2. rewrites `<expr>.location.<f>` and `<expr>?.location?.<f>` to `<expr>.<f>` / `<expr>?.<f>`
   for `<f>` in the venue fields;
3. rewrites the string literals `"location.<f>"` to `"<f>"` for `<f>` in the venue fields;
4. prints, per file, every remaining `location` property or `.location` access it did not rewrite
   (spreads such as `...ownerRequest.location`, assignments `request.venue.location = {`, `delete
   venue.location.name`), which the task then fixes by hand.

A bucket's `location: { endpoint, bucket, region }` (`apps/server/test/hour-recovery-host.ts:670`)
has none of the four parent keys, so rule 1 leaves it.

### Files

Every S16 file in the TSV, with what changes (lines at `7e824ae233`):

| File | Task | What changes |
| --- | --- | --- |
| `packages/provisioning/src/venue-plan.ts` | a | `VenueRequest` flat, `VENUE_FIELDS`, `create-venue` kind; `:11-14` `AdoptResult` comment "node and location" → "node" wording only (its `locationId` is S18's) |
| `packages/provisioning/src/venue-apply.ts` | a | `create-location` → `create-venue` at `:79-84,123,246,334`; table reads/writes of `locations` stay (S23) |
| `packages/provisioning/src/first-setup-state.ts` | a | `:240-280` key lists name the eleven venue fields instead of `location`; `invoiceLocales` checked on `request` |
| `packages/provisioning/src/first-setup-command-deployment.ts` | a | `:92,108,154,283` `request.location.fiscalTerritory` → `request.fiscalTerritory`; `:321` is S17's |
| `packages/provisioning/src/first-setup-command-document.ts` | a | `:111-112` `.location.name/.timeZone` → `.name/.timeZone` |
| `packages/provisioning/src/first-setup-preparation.ts` | a | `:57` territory read |
| `packages/provisioning/src/first-setup-recovery-delivery.ts` | a | `:162,260` venue name |
| `packages/provisioning/src/first-setup-runtime.ts` | a | `:136,187` territory; `:216` passes `state.frozen.request.location` — becomes the venue fields picked with `VENUE_FIELDS` |
| `packages/provisioning/src/first-setup-resolution-inspection.ts` | a | `:90-91` local `locations` renamed `venues`; the count stays on `readOperationalVenueIds` (S23 switches its source) |
| `packages/provisioning/src/fiscal-readiness-input.ts` | a | `:24` territory |
| `packages/provisioning/src/cli.ts` | a | `--venue-name`, `:263-264,292,301` request shape |
| `packages/provisioning/src/recover-provisioned-venue.ts` | a | `:29,40-42` venue fields; the lookup compares `readVenue(tx)`'s `name`/`fiscalTerritory` with the request and finds the node by `n.name` alone, dropping the `locations` join; the `locationId` that `:45` (S2's call) and `:59,81` (the result shape, S18) still need comes from `venueLocationId(tx)` |
| `packages/provisioning/src/errors.ts` | a | `:75` comment names `locations_invoice_locales_len`; cut to "the receipt-language length check" (the check moves to `venue_settings` in S23) |
| `apps/server/src/setup-api.ts` | b | `:437-511` parses venue fields from `v` directly; `:571-589` `demoVenueNameSource`; `:596-606,882` territory/description reads; `:953` stays (S18) |
| `apps/server/src/setup-first-fiscal-api.ts` | b | `:416-447` one `exact(body.venue, …)` list with the eleven fields; the second `exact(raw.location…)` and its spread go |
| `apps/server/src/first-fiscal-activation.ts` | b | `:68` territory; `:290` stays (S18) |
| `apps/server/src/first-fiscal-mode.ts` | b | `:2,25,28` the location half of the check and `readNodeLocation` go; the node-id comparison stays |
| `apps/server/src/module-operation-host.ts` | b | `:109` territory |
| `apps/server/src/provision.ts` | b | `:45` comment: "location" → "venue" |
| `packages/fiscal-verifactu/src/setup/first-hour.ts` | b | `:40` `Context.venue` flat; `:382,390,455,470,474` reads |
| `packages/fiscal-verifactu/src/venue-fields.ts` | b | `:53,88` field `"operationDescription"` |
| `apps/server/src/recovery-backup-preview.ts` | c | `:3,62-70` reads `readVenue(store.venue)` instead of `locations where id = node.locationId`; `:37,94` `venueName` |
| `apps/server/src/restore.ts` | c | `:860-864` `resolveArtifactNode`: the node must exist in `nodes` (else `restore.identity_unknown`, same meaning); `locationId` filled by `venueLocationId(db)` until S18 drops it from `ProvisionedNode`; `:866-882` `readArtifactNode` stays (S18, with `ProvisionedNode`) |
| `apps/server/src/restore-command.ts` | c | `:509` message: `venue ${venue.venueName}` |
| `apps/setup/src/i18n/strings/restore.ts` | c | `restore.preview_location` → `restore.preview_venue` ("Venue" / "Local"); `restore_bucket.venue_details` placeholder `{location}` → `{venue}`; text "location" → "venue" in English |
| `apps/setup/src/screens/recovery-copy.ts` | c | `:313-314` key and `preview.venueName` |
| `apps/setup/src/screens/restore-bucket-screen.ts` | c | `:26,302,456` `venueName` |
| `apps/setup/src/screens/first-setup-backup-screen.ts` | c | `:670` `venueName` |
| `apps/setup/src/first-setup-backup-session.ts` | c | `:42` `venueName` |
| `apps/setup/src/api/client.ts` | c, d | `:233` `venueName` (c); `:60-72,93,104,238` `LocationDraft` folds into `VenueDraft` (d) |
| `apps/setup/src/setup-app.ts` | d | `:54,174,201-220` `CLAIM_VENUE_FIELDS` against `VenueDraft`'s venue fields; `:493-496` `venueName` (c); `:651,896-908,1096,1246,1335,2071-2077,2764` shape |
| `apps/setup/src/screens/venue-screen.ts` | d | `demoVenueNameSource` (`:103,325-396,464-488,727`); `:446,733` shape; `:893-894` new keys |
| `apps/setup/src/screens/review-screen.ts` | d | `:147-184` reads `venue.*`; group id `"venue"`; keys below; row id `summary-name` |
| `apps/setup/src/server-fields.ts` | d | `:48` key `"operationDescription"` |
| `apps/setup/src/i18n/strings/venue.ts` | d | English: `venue.intro` "…the address of this venue."; demo intro "Name your demo venue…"; keys `venue.section.location` → `venue.section.venue` ("Venue"/"Local"), `venue.label.location_name` → `venue.label.venue_name` ("Venue name"/"Nombre del local"), `venue.field.name` "venue name", `venue.hint.name` "The name you use for this venue…", `review.location` → `review.venue_name`, `review.group.location` → `review.group.venue`, `review.help.location` → `review.help.venue` (English text "location" → "venue"; Spanish text kept) |

Not in the TSV but changed by S16, because the request type change does not compile without them
(each is someone else's file; S16 edits only the lines named):

- `apps/server/src/boot.ts:1354,1384,1407` (`request.venue.location.fiscalTerritory`; file is S18's;
  `:1341` is S17's bundle read).
- `packages/provisioning/src/fiscal-readiness-runner.ts:123-130` (`request.location.invoiceLocales`;
  file is S2's, whose change is the `:111` issue-zone call).
- `apps/server/scripts/dev-setup.ts:219` (request literal; file is S19's).
- `apps/server/src/restore-stream.ts:46,221` (`RestoredVenue.locationName` → `venueName`; file is
  S12's, which keeps `:214`), `apps/server/src/errors.ts:1559` (`restore.stream_venue_unconfirmed`
  params; file is S18's), `scripts/personal-log-params.test.ts:125`
  (`restore.stream_venue_unconfirmed.venueName`, "the name of the venue"). The whole restore
  preview rename is S16's (header, "Files moved from the design's slice"); S12c keeps only
  `restore-stream.ts`'s lookup.
- Test helpers holding a request literal or `.location.` read (their other lines stay with F2/F5/S18):
  `packages/provisioning/test/first-setup-request.ts:8`, `packages/provisioning/test/start-again-attempt.ts:48`,
  `apps/server/test/first-fiscal.ts:28`, `apps/server/test/first-setup-backup-cloud-fixture.ts:76-77,151`,
  `apps/server/test/first-setup-backup-recovery-fixture.ts:68-69`, `apps/server/test/first-setup-backup-resume-fixture.ts:59-60`,
  `apps/server/test/held-setup-database.ts:128`, `apps/server/test/hour-recovery-delivery.ts:25`,
  `apps/server/test/owned-hour-setup.ts:111`, `apps/server/test/hour-recovery-host.ts:209` (`venueName`),
  `apps/setup/test/first-setup-browser.ts:10`, `apps/setup/test/first-setup-backup-browser.ts:25` (`venueName`),
  `apps/server/scripts/testing/venue.ts:26`, `apps/server/scripts/demo-seed/testing/provision-venue.ts:74-75`,
  `apps/server/scripts/cloud-integration-fixture.ts:61`, and in `apps/server/src/testing/`:
  `adjustment-venue.ts:329`, `bill-venue.ts:137`, `boot-harness.ts:217`, `clock-venue.ts:39`,
  `party-venue.ts:107`, `signed-in-till.ts:67`, `stream-loop-scenario.ts:290`,
  `stream-pause-scenario.ts:308`, `venue-fixtures.ts:77`.
- Guides: `apps/server/src/guide/en/backup-recovery.md:106` "its source, business, location," →
  "its source, business, venue," (the restore preview's label, Task S16c). Spanish `:117-118`
  already says "el local".
- `CLAUDE.md:400-404` and `docs/developers/conventions-data.md:1707-1730,5609-5615`: identifiers only —
  `LocationDraft` → `VenueDraft`, `CLAIM_LOCATION_FIELDS` → `CLAIM_VENUE_FIELDS`, `exact(raw.location, …)`
  → `exact(body.venue, …)`. S17 rewrites both rules; S16 only stops them naming deleted identifiers
  (CLAUDE.md §6: update in the same change).

Tests: 158 test files (337 lines) build or read the request's `location`
(`git grep -n -E '(^|[^A-Za-z.])location: \{|(venue|request|body|draft|preview)\.location([^A-Za-z]|$)|\.location\.(fiscalTerritory|name|timeZone|invoiceLocales|city|dayCutover|province|postalCode|operationDescription|addressLine1)' -- '*.test.ts' '*.test.mjs' | grep -v -E 'endpoint|bucket|region'`
at `abfe271663`; one hit, `scripts/mutation-aggregate.test.mjs:47`, is a mutant's location and is
left): `packages/provisioning` 26, `packages/fiscal-verifactu` 3, `apps/setup` 14,
`apps/server` 114 (`src/[a-f]*` 51, the rest 63). The restore-preview rename touches 31 test files
(`git grep -l -w locationName` restricted to the restore, recovery, setup-api and `apps/setup` tests;
list in Task S16c).

### Task S16a: the provisioning request is flat

**Files:** the `packages/provisioning/src` rows marked "a" above, `fiscal-readiness-runner.ts:123-130`,
the 26 provisioning test files the test grep names, and the two provisioning test helpers
(`first-setup-request.ts`, `start-again-attempt.ts`). Write the codemod here.

**Interfaces — Produces:** `VenueRequest` (flat), `VENUE_FIELDS`, `VenueAction` kind `create-venue`,
first-setup state files validated against the flat request.

- [ ] **Step 1: failing tests.** In `packages/provisioning/src/venue-plan.test.ts`: "plans a venue from
  a flat request" — `planVenue({ ...flatRequest }, modules)` returns an action with
  `kind: "create-venue"` carrying `name`, `fiscalTerritory`, `invoiceLocales` equal to the request's.
  In `packages/provisioning/src/first-setup-state.test.ts` (the suite that pins `validateFrozen`):
  "refuses a frozen request that still nests a `location` object" — a frozen state whose request
  holds `location: { … }` and none of the flat keys makes `parseState` throw the same refusal an
  unknown key gets today; "accepts the flat request" — the same state with the eleven keys on
  `request` parses. All three fail before: there is no `create-venue` kind, the nested request is
  accepted, and the flat keys are refused.
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/venue-plan.test.ts src/first-setup-state.test.ts` — FAIL as above.
- [ ] **Step 3:** change the types and readers listed; write the codemod; run it over the 26 tests
  and the two helpers; fix by hand what it prints.
- [ ] **Step 4:** `pnpm --filter @waitron/provisioning typecheck` clean;
  `pnpm --filter @waitron/provisioning exec vitest run <the 28 files>` PASS; every changed `expect(`
  line is a refusal-field path (design §6 S16, "`LocationDraft` folds into the venue draft") or a
  shape key (`git diff -U0 | /usr/bin/grep -E '^[-+].*expect\('` read line by line).
- [ ] **Step 5:** fiscal pair (commands above) PASS unedited; `pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts`; `pnpm format:check`.
- [ ] **Done-check:** `git grep -n -E "$P" -- <the S16a src files>` prints only: `venue-apply.ts`
  lines reading or writing the `locations` table and `ApplyResult.locationId`;
  `recover-provisioned-venue.ts`'s `venueLocationId` call and its `:5,45,59,81` (S2 call, `AdoptResult`); `venue-plan.ts:13`
  (`AdoptResult.locationId`, S18); `first-setup-command-deployment.ts:321` (S17).
- [ ] **Commit:** `git commit -s -m "provisioning: the venue request carries its settings directly, not under location"`.

### Task S16b: the server's setup routes, the first-hour page, and the host-file probe

**Files:** the `apps/server` and `fiscal-verifactu` rows marked "b"; `boot.ts:1354,1384,1407`;
`dev-setup.ts:219`; `first-fiscal-setup.e2e.test.ts:246-254,368`; the three first-hour browser tests
(`first-hour.browser.test.ts`, `first-hour-reissue.browser.test.ts`, `first-hour.a11y.browser.test.ts`),
`packages/fiscal-verifactu/src/venue-fields.test.ts`, `slot.test.ts:238`;
`apps/server/src/setup-api.test.ts`, `setup-api.country-pack.test.ts`, `first-fiscal-mode.test.ts`;
`scripts/setup-wizard-fiscal-fields.test.ts` if it names the path (run it either way).

**Interfaces — Consumes:** Task S16a's `VenueRequest`, `VENUE_FIELDS`. **Produces:** the provision
body and the first-setup claim take the venue fields on `venue`; refusal fields without `location.`.

- [ ] **Step 1: failing tests.**
  - `apps/server/src/setup-api.test.ts`, the `:843-879` table: each row's expected field drops the
    `location.` prefix (`"fiscalTerritory"`, `"timeZone"`, `"postalCode"`, `"province"`), sent with a
    flat body. Fails before: the route reads `v.location` and refuses `location`.
  - `apps/server/src/first-fiscal-mode.test.ts`: new case "a completed setup whose stored result names
    only the node is accepted" — `result: { venue: { nodeId } }`, `reconcileFirstSetupBeforeMode`
    resolves and leaves `config.node` unchanged. Fails before with `setup.attempt_uncertain`
    (`first-fiscal-mode.ts:25`).
  - **Deleted, cross-location only:** `first-fiscal-mode.test.ts:60-68` (the `OTHER_LOCATION` row; keep
    the `LOCATION` row in the insert) and `:88-94` (moving the node to the other location is refused).
    The node-id refusal at `:80-86` stays unchanged.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/setup-api.test.ts src/first-fiscal-mode.test.ts` — FAIL as above.
- [ ] **Step 3:** change the files; run the codemod over the tests listed; `first-fiscal-setup.e2e.test.ts`
  by hand, request-building lines only: `:247` becomes
  `const { location: previewLocation, ...preview } = stagedBody.venue;`; `:248` keeps its assertion,
  reading the same value under that name (`expect(previewLocation).toHaveProperty("fireControl")`);
  `:249` stays exactly as it is (it now compares the flat request's keys with the preview's keys other
  than `location`, the version-9 bundle's nested object until S17); `:250-254` build `venue` as
  `{ ...preview, ...<previewLocation's values for the venue-field keys>, admin: request.admin }`;
  `:368` `venue.name`. No other line of that file changes, and no assertion's value changes.
- [ ] **Step 4: host-file probe** (read, not run, so far: `resolveFirstSetupEntry` reads
  `first-setup.json` at every start, `apps/server/src/first-setup-entry.ts:45-62`, and a finished
  setup's state is kept with `publicationComplete`). Before running it, the failing case prints a start
  refusal naming the first-setup state; the passing case starts. In a scratch directory, copy a
  finished first setup's `<state>/first-setup.json` written by `main` (produce it by running
  `first-fiscal-setup.e2e.test.ts`'s owned Live row on a `main` worktree with its scratch directory
  kept), then start this branch's server on it with `boot.test.ts`'s harness. Record the outcome and
  the log line in the PR description; it decides the PR's first line (header above). Control: the
  same file rewritten to the flat shape starts.
- [ ] **Step 5:** `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/fiscal-verifactu typecheck`;
  `pnpm --filter @waitron/server exec vitest run src/setup-api.test.ts src/setup-api.country-pack.test.ts src/first-fiscal-mode.test.ts src/first-fiscal-setup.e2e.test.ts`;
  check free memory (`memory_pressure | grep free`) then
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/setup/first-hour.browser.test.ts src/setup/first-hour-reissue.browser.test.ts src/setup/first-hour.a11y.browser.test.ts src/venue-fields.test.ts src/slot.test.ts`;
  `pnpm exec vitest run scripts/setup-wizard-fiscal-fields.test.ts scripts/module-seams.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts`;
  fiscal pair; `pnpm format:check`.
- [ ] **Done-check:** `git grep -n -E "$P" --` the "b" files prints only `setup-api.ts:953` and
  `first-fiscal-activation.ts:290` (`locationId: result.locationId` into `persistTrading`, S18's
  `TradingConfig.locationId`).
- [ ] **Commit:** `git commit -s -m "setup: the server and the first-hour page read the venue fields directly"`.

### Task S16c: the restore preview names the venue

**Files:** the rows marked "c"; `restore-stream.ts:46,221`; `errors.ts:1559`;
`scripts/personal-log-params.test.ts:125`; `apps/server/src/guide/en/backup-recovery.md:106`;
`apps/server/test/hour-recovery-host.ts:209`; `apps/setup/test/first-setup-backup-browser.ts:25`;
and the 31 tests: `apps/server/src/{boot.recovery-input,first-setup-backup-source,hour-recovery-host,recovery-backup-preview.older,recovery-backup-preview,recovery-page-personal-data,restore-command,restore-stream,setup-api.recovery-preview,setup-api.remote-preview,setup-api}.test.ts`,
`apps/setup/src/{api/client,api/recovery-copy,first-setup-backup-session,setup-app-bucket.unsaved-changes,setup-app}.test.ts`,
`apps/setup/src/screens/{recovery-allocation-binding,recovery-allocation,recovery-copy-identity.a11y,recovery-copy.a11y,recovery-copy,recovery-handover,recovery-hour,recovery-key-fields,remote-preview,restore-bucket-preview-venue,restore-bucket-screen.a11y,restore-bucket-screen,restore-preview,venue-screen.demo-region}.test.ts`,
`scripts/personal-log-params.test.ts`. In those tests rename only the restore preview's and the
refusal's `locationName`; `venue-screen.demo-region.test.ts`'s `locationName` is the country pack's
(S19) and stays.

**Interfaces — Produces:** `RestoredVenue.venueName`, `RecoveryBackupPreview.venueName`,
`restore.stream_venue_unconfirmed` params `{ legalName, taxId, venueName }`.

- [ ] **Step 1: failing tests.** `apps/server/src/recovery-backup-preview.test.ts`: the preview's
  expected object has `venueName: <seeded venue name>` and no `locationName`; the existing
  unknown-node case keeps `restore.identity_unknown` unchanged.
  `scripts/personal-log-params.test.ts:125` row becomes `["restore.stream_venue_unconfirmed.venueName",
  "the name of the venue"]`. Both fail before: the preview returns `locationName`, and the guard's
  `stalePairs` check (`personal-log-params.test.ts:535`) reports a `NOT_PERSONAL` entry whose key the
  registry does not hold.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/recovery-backup-preview.test.ts && pnpm exec vitest run scripts/personal-log-params.test.ts` — FAIL.
- [ ] **Step 3:** change the files; rename in the 31 tests.
- [ ] **Step 4:** `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/setup typecheck`;
  `pnpm --filter @waitron/server exec vitest run` over the 11 server tests; free memory first, then
  `pnpm --filter @waitron/setup exec vitest run` over the 19 setup tests; text guards
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts && pnpm exec vitest run scripts/guide-links.test.ts scripts/personal-log-params.test.ts`;
  fiscal pair; `pnpm format:check`.
- [ ] **Done-check:** the design grep over the "c" files prints only `restore.ts:1,24,862-877`
  (`ProvisionedNode.locationId` fill and `readArtifactNode`, S18) and `apps/setup/src/i18n/strings/restore.ts`
  lines matching only `allocation`.
- [ ] **Commit:** `git commit -s -m "restore: the preview and its refusal name the venue"`.

### Task S16d: the setup app's venue form, review and claim

**Files:** the rows marked "d"; `CLAUDE.md:400-404` and `conventions-data.md:1707-1730,5609-5615`
(identifiers only); `apps/setup/test/first-setup-browser.ts:10`; the 14 `apps/setup` tests the test
grep names (`api/client`, `first-setup-session`, `screens/configuration-preview-screen.a11y`,
`screens/configuration-preview-screen`, `screens/initial-setup-screen`, `screens/review-screen.a11y`,
`screens/review-screen`, `screens/venue-screen.address-lookup`, `screens/venue-screen`,
`setup-app-email.unsaved-changes`, `setup-app-first-fiscal`, `setup-app-venue.unsaved-changes`,
`setup-app`, `setup-app.unsaved-changes`, each `.test.ts` under `apps/setup/src/`), plus
`server-fields.test.ts` (its `"location.operationDescription"` key).

**Interfaces — Consumes:** S16b's wire. **Produces:** `VenueDraft` (the venue fields plus country,
taxId, legalName, taxpayerDomicile, series codes, admin), `CLAIM_VENUE_FIELDS`.

- [ ] **Step 1: failing tests.** `apps/setup/src/setup-app-first-fiscal.test.ts`, "claims a staged
  preview's venue with only the location fields the claim accepts" becomes "claims a staged preview's
  venue with only the venue fields the claim accepts": the claim body's `venue` has the eleven venue
  fields at its top level, no `location` key, and no `id`, `fireControl` or `catalogueId` (the
  preview still carries them under `location` until S17). `apps/setup/src/screens/review-screen.test.ts`:
  the group headed "Venue" shows the venue name in
  `summary-name`. Both fail before.
- [ ] **Step 2:** free memory, then `pnpm --filter @waitron/setup exec vitest run src/setup-app-first-fiscal.test.ts src/setup-app.test.ts` — FAIL.
- [ ] **Step 3:** change the files; codemod over the 14 tests and the helper; rename the string keys in
  tests by hand.
- [ ] **Step 4:** `pnpm --filter @waitron/setup typecheck`; the 15 tests PASS;
  `pnpm exec vitest run scripts/claude-md-pointers.test.ts scripts/setup-wizard-fiscal-fields.test.ts scripts/english-only.test.ts`;
  fiscal pair; `pnpm format:check` (root `CLAUDE.md` is format-checked).
- [ ] **Done-check:** the design grep over `apps/setup/src` prints only lines matching `allocation`
  and the country pack's `identity.locationName` (`venue-screen.ts:479`, S19).
- [ ] **Commit:** `git commit -s -m "setup app: one venue draft; the form and review say Venue"`.

### Task S16e: `apps/server` tests `src/[a-f]*` take the flat request

**Files:** the 51 `apps/server/src/[a-f]*.test.ts` files the test grep names
(`grep -E '^apps/server/src/[a-f]' <test grep output>`), minus those already done in S16b/S16c.

- [ ] **Step 1: the red check.** The test grep over these files prints lines (record the count);
  `pnpm --filter @waitron/server typecheck` lists errors in them.
- [ ] **Step 2:** run the codemod over them; fix what it prints.
- [ ] **Step 3:** typecheck clean for these files; free memory, then
  `pnpm --filter @waitron/server exec vitest run <the files>` PASS with the same `Tests` count as on
  `main` (record it there first); no `expect(` line changed except refusal-field paths.
- [ ] **Step 4:** fiscal pair; `pnpm format:check`.
- [ ] **Done-check:** the test grep over these files prints nothing.
- [ ] **Commit:** `git commit -s -m "test: server suites a–f send the flat venue request"`.

### Task S16f: the remaining `apps/server` tests and the test helpers

**Files:** the other 63 `apps/server` test files the test grep names (`src/[g-z]*`, `scripts/**`),
and every helper in the "Test helpers" list above outside `packages/provisioning` and `apps/setup`.
Same steps as S16e, then the whole-branch checks:

- [ ] `pnpm --filter @waitron/server typecheck` clean across the package; every typecheck of a package
  S16 touched (`provisioning`, `server`, `setup`, `fiscal-verifactu`) clean.
- [ ] Code guards: `pnpm exec vitest run scripts/module-seams.test.ts scripts/live-subscriptions.test.ts scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts scripts/english-only.test.ts`.
- [ ] Fiscal pair; `first-fiscal-setup.e2e.test.ts`; `pnpm format:check`.
- [ ] **Done-check for the slice:** `git grep -n -E "$P" --` every S16 TSV file prints only the
  exceptions named in Tasks S16a–S16d.
- [ ] **Commit:** `git commit -s -m "test: remaining server suites and helpers send the flat venue request"`.

### Open PRs touching S16's files (`gh pr list --state open`, full file lists from `gh pr diff <n> --name-only`, 2026-11-01)

- **#2369** (A696, lands before S1): `venue-apply.ts`, `venue-plan.ts`, `recover-provisioned-venue.ts`,
  and 44 of the 158 request-shape test files (for example `setup-api.country-pack.test.ts`,
  `venue-plan.test.ts`, `venue-apply.test.ts`, `fiscal-readiness-runner.test.ts`,
  `apps/setup/src/screens/venue-screen.test.ts`).
- **#2373** (W41s-7): `apps/server/src/till-api.fiscal-sale-paths.test.ts`,
  `till-sale-integrated.db.test.ts` (request literals); `apps/server/src/guide/en/backup-recovery.md`
  and its Spanish twin; `docs/developers/conventions-data.md`.
- **#2375** (A1268) and **#2377** (A1008): `docs/developers/conventions-data.md` only.

---

## S17 — The configuration bundle carries venue fields; `locationColumns` goes

**Goal.** The configuration export (format 9 today) becomes format 10: `venue` holds the venue's
own setup fields directly (the eleven venue fields beside `country`, `taxId`, `legalName`,
`taxpayerDomicile` and the series codes); the location's `id` and `fireControl` leave the bundle;
the default menu travels outside `venue`'s keys as the top-level `defaultCatalogueId`. The module
contract's `locationColumns` and its declarations go. Until the schema slices drop the columns, the
import fills every column whose foreign key points at `locations` with the importing venue's one row
(`venueLocationId(tx)`) — the one interim rule that replaces nineteen declarations (see S17a's
evidence below and "Carried to the schema plan"). The
two CLAUDE.md rules and their topic sections are rewritten.

- **Depends on:** S16 landed.
- **Lands:** lane (no rule a–d applies: the bundle carries no fiscal record, hash or identity).
- **Branch:** `refactor/a1301-s17-bundle-venue-fields`.
- **Review path:** FULL — cross-package contract (`ConfigurationTransferTable` in `packages/module`,
  read by five modules; the bundle format read by the setup app).
- **The PR's first line:** "Configuration exports made before this change are refused as outdated
  (format 9 → 10); export again after updating." No box reset.
- **Guards:** code guards, `scripts/id-columns-are-references.test.ts`,
  `scripts/claude-md-pointers.test.ts`, `apps/setup/src/setup-app-first-fiscal.test.ts`,
  `apps/server/src/first-fiscal-setup.e2e.test.ts`.

### Files

| File | Task | What changes |
| --- | --- | --- |
| `packages/provisioning/src/configuration-transfer.ts` | a | `PreparedVenue` flat (address fields stay `string \| null`); `fireControl`, `id` gone; `buildConfigurationBundle(db, source: { nodeId; sourceOperatorId? }, …)` reads `readVenue(db)` and `readVenueClock(db)` (`:17,74,110,137`; the `join locations` goes; `parseLocaleList` goes if `readVenue` returns the list parsed); bundle `version: 10` and top-level `defaultCatalogueId: string \| null`; `applyPreparedLocation` → `applyPreparedVenue(tx, { defaultCatalogueId })`, which sets `catalogue_id` on the row `venueLocationId(tx)` names (S23 moves the column); `parseConfigurationBundle` (`:499-560`) checks the flat venue, refuses version 9 as `setup.configuration_outdated`; `importConfigurationTables(tx, bundle, modules, targetVersions)` loses `target`; `:715-716` releases the default menu on the `venueLocationId` row; `:739` `idMap` starts empty; `:757-758` replaced by: read `"from", "table"` from `pragma_foreign_key_list`, and after the id rewrite set every column whose key's `table` is `locations` to `venueLocationId(tx)` (read once) |
| `packages/module/src/module.ts` | a | `:1592` `locationColumns` deleted |
| `packages/db/src/configuration-transfer.ts` | a | `:69-106` the nine `locationColumns` entries go; `:75`'s table name `location_catalogues` stays (S23) |
| `packages/venue-service/src/configuration-transfer.ts` | a | `:700-725` seven entries; `:179` comment: "whatever location the bundle names" → cut to "Every special-day date lands at the importing venue." |
| `packages/staffing/src/configuration-transfer.ts` | a | `:6` |
| `packages/workforce/src/configuration-transfer.ts` | a | `:7` |
| `packages/workforce-es/src/configuration-transfer.ts` | a | `:3` |
| `apps/server/src/configuration-transfer.ts` | a | `:3` re-export `applyPreparedVenue` |
| `apps/server/src/configuration-export-api.ts` | a | `:23` `cfg: { nodeId: string }` |
| `apps/server/src/boot.ts:1341,1446-1449` (S18's file) | a | `bundle.venue.fiscalTerritory`; the import call drops `{ locationId: result.locationId }` |
| `packages/provisioning/src/first-setup-command-deployment.ts:318-321` (S16's file; S16 has landed, so S17 edits the call, argument only) | a | same call |
| `packages/provisioning/test/configuration-bundle.ts:16-17` (F2's file) | a | the test bundle in format 10 |
| `apps/setup/src/api/client.ts:238`, `apps/setup/src/setup-app.ts:2071-2077` | b | `ConfigurationPreview.venue` is flat; the claim copies `preview.venue` by `CLAIM_VENUE_FIELDS` |
| `apps/server/src/first-fiscal-setup.e2e.test.ts:246-254` | b | `:247-248` (S16's destructuring and its `fireControl` check) go: `fireControl` leaves the bundle (§2.1), so the check is deleted and named in S17's PR; `:247` is again `const preview = stagedBody.venue;`; `:249` stands as written, now comparing flat keys; `:250-254` become `{ ...preview, admin: request.admin }` |
| `scripts/id-columns-are-references.test.ts` | b | `:13-19` doc: drop "overwrites `locationColumns` …" and "`locationColumns`"; `:54` handled set loses `locationColumns`; `:102` describe "…is rewritten or left out of the export" |
| `CLAUDE.md:400-404,546-550` | b | the two rules (text below) |
| `docs/developers/conventions-data.md:1707-1730,1732-1745,5609-5615` | b | the two sections and the root-receipts copy (below) |

Tests (25 files exercise the bundle: `git grep -l -E 'buildConfigurationBundle|importConfigurationTables|decodeConfigurationBundle|validateConfigurationBundle|ConfigurationBundle|configuration-bundle|locationColumns' -- '*.test.ts'`):
`apps/server/src/{boot.setup-routes,configuration-export-api,configuration-import.policy-completeness,configuration-import.previous-export,configuration-import.service-steps,configuration-import,configuration-transfer.clock,configuration-transfer,course-delete.service-steps,first-fiscal-hour-import.e2e,first-fiscal-setup.e2e}.test.ts`,
`packages/catalogue/src/{extras,options,product-modifiers}.test.ts`, `packages/db/src/configuration-transfer.test.ts`,
`packages/provisioning/src/{configuration-import,configuration-transfer.boundaries,configuration-transfer.privacy-contact,configuration-transfer.reader-slip-setting,configuration-transfer.security,first-setup-command-import}.test.ts`,
`packages/staffing/src/configuration-transfer.test.ts`, `packages/venue-service/src/{configuration-transfer,routing-store}.test.ts`,
`scripts/id-columns-are-references.test.ts`. The largest, `apps/server/src/configuration-transfer.test.ts`
(8,253 lines), has 40 bundle-shape lines (`git grep -c -E 'venue\.location([^A-Za-z]|$)|location: \{|\.location\.|locationColumns|fireControl|catalogueId'`).
Not edited: `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json` — a real
format-1 export kept to prove old files are refused (`configuration-import.test.ts:97-108`).

### Task S17a: format 10 and the import's location fill

**Interfaces — Consumes:** S1's `readVenue`, `readVenueClock`, `venueLocationId`; S16's flat venue.
**Produces:** `ConfigurationBundle { version: 10; …; venue: PreparedVenue; defaultCatalogueId: string | null }`,
`applyPreparedVenue`, `buildConfigurationBundle(db, { nodeId, sourceOperatorId? }, …)`,
`importConfigurationTables(tx, bundle, modules, targetVersions)`; `ConfigurationTransferTable` without
`locationColumns`.

- [ ] **Step 1: failing tests**, in `packages/provisioning/src/configuration-transfer.boundaries.test.ts`:
  - "refuses a format 9 export as outdated" — `decodeConfigurationBundle` of a version-9 bundle throws
    `setup.configuration_outdated` (today it is accepted).
  - "exports the venue's own fields and the default menu outside them" — the built bundle's
    `Object.keys(venue)` equals the venue fields plus `country, taxId, legalName, taxpayerDomicile,
    seriesCode, fullSeriesCode, rectificativeSeriesCode`, with no `location`; `bundle.defaultCatalogueId`
    equals the source's default menu id (today `venue.location` exists).
  - "puts every row under the importing venue whatever location id it names" — a format-10 bundle whose
    `departments` row carries `location_id: "not-a-location-here"` imports, and
    `select location_id from departments` equals `venueLocationId(tx)`. Fails before at the version check.
  The existing ":5613 exports and imports all seven cell classes into another venue, remapping every id
  and the location" (`apps/server/src/configuration-transfer.test.ts`) must pass unchanged in its
  assertions: it is the regression guard for the fill.
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/configuration-transfer.boundaries.test.ts` — FAIL.
- [ ] **Step 3:** implement the rows marked "a"; update the bundle tests' fixtures to format 10 (the
  25 files above: `version: 9` → `10`, `venue.location.X` → `venue.X`, `location.catalogueId` →
  `defaultCatalogueId`, `fireControl` removed). An assertion that checked `fireControl` travels is
  deleted (design §2.1: `fire_control` is deleted, unused); every other changed assertion names
  design §4 "Configuration bundle".
- [ ] **Step 4:** typecheck `@waitron/provisioning`, `@waitron/module`, `@waitron/db`, `@waitron/server`,
  `@waitron/venue-service`, `@waitron/staffing`, `@waitron/workforce`, `@waitron/workforce-es`; run the
  25 bundle tests with `pnpm --filter <pkg> exec vitest run <files>` per package — PASS.
- [ ] **Step 5:** code guards; `pnpm exec vitest run scripts/id-columns-are-references.test.ts` (still
  green: all nineteen `location_id` columns the declarations listed are foreign keys to `locations`,
  read from each set's latest drizzle snapshot with a `jq` over `packages/*/drizzle/meta/*_snapshot.json`,
  `.tables[t].foreignKeys[] | select(.columnsFrom==["location_id"]) | .tableTo`); `pnpm format:check`.
- [ ] **Done-check:** `git grep -n -E "$P" --` the "a" files prints only
  `packages/db/src/configuration-transfer.ts:75` (`location_catalogues`, S23) and the interim fill's
  `venueLocationId` and `"locations"` lines in `packages/provisioning/src/configuration-transfer.ts`.
- [ ] **Commit:** `git commit -s -m "configuration export: format 10 carries venue fields; the import fills the venue row itself"`.

### Task S17b: the setup app, the guard and the two rules

- [ ] **Step 1: failing tests.** `apps/setup/src/setup-app-first-fiscal.test.ts`'s claim case: the
  stubbed preview's `venue` is flat (format 10) with an extra key `somethingNew`; the claim's `venue`
  carries exactly `CLAIM_VENUE_FIELDS` and `admin`. Fails before (the app reads `preview.venue.location`).
- [ ] **Step 2:** free memory, then `pnpm --filter @waitron/setup exec vitest run src/setup-app-first-fiscal.test.ts` — FAIL.
- [ ] **Step 3:** client type, `setup-app.ts:2071-2077`, the e2e lines, the guard, and the docs.
  New CLAUDE.md rule text (replaces `:400-404`):
  > **A configuration bundle value that is not a setup field stays out of `venue`'s own keys** (the
  > default menu travels as the top-level `defaultCatalogueId`); the setup app copies the preview's
  > `venue` by `CLAIM_VENUE_FIELDS`. Cost: from #1752 to A980 S1a2 no production box could be set up
  > from an export. Guards: `apps/server/src/first-fiscal-setup.e2e.test.ts` and
  > `apps/setup/src/setup-app-first-fiscal.test.ts`, weaker than the rule: one export shape.
  > [Limits](docs/developers/conventions-data.md#root-receipts-moved-on-2026-10-31).

  Replaces `:546-550`:
  > **A column of a transferred table that holds another row's id is a foreign key, a declared
  > `references` entry or left out of the export** (`omit`); any other column the export carries
  > arrives holding the exporting venue's id. Guard: `scripts/id-columns-are-references.test.ts`,
  > weaker than its name — it knows an id column only by a name ending `_id` or `_ids`.

  `conventions-data.md`: in the section at `:1707`, the preview's `venue` is the setup fields alone and
  the claim's `exact(body.venue, …)`; the `id`/`fireControl`/`catalogueId` sentence becomes "the
  default menu travels as the top-level `defaultCatalogueId`"; the guards paragraph: the e2e row now
  sends the preview's venue whole, so it fails if the bundle's `venue` gains a non-setup key, and the
  setup-app case fails if `CLAIM_VENUE_FIELDS` lets one through; "Nothing checks
  `CLAIM_VENUE_FIELDS` against the claim's own `exact(body.venue, …)` list" stays. In the section at
  `:1732` (heading loses "a location column"): drop the `locationColumns` sentence; add one sentence:
  "Until `locations` is dropped, a column whose foreign key points at it is set to the importing
  venue's row (`venueLocationId`), whatever the export carried." The copy at `:5609-5615` follows the
  first rule's text. Then `git grep -n 'a-column-of-a-transferred-table'` and the root-receipts anchor
  to check no link breaks.
- [ ] **Step 4:** `pnpm exec vitest run scripts/claude-md-pointers.test.ts scripts/id-columns-are-references.test.ts`;
  `pnpm --filter @waitron/server exec vitest run src/first-fiscal-setup.e2e.test.ts src/first-fiscal-hour-import.e2e.test.ts`;
  setup tests PASS; fiscal pair (no fiscal file is touched, run as a control); `pnpm format:check`.
- [ ] **Done-check:** `git grep -n -E 'locationColumns|venue\.location([^A-Za-z]|$)|LocationDraft|CLAIM_LOCATION_FIELDS' -- apps packages scripts CLAUDE.md docs/developers`
  prints nothing.
- [ ] **Commit:** `git commit -s -m "setup app reads the format 10 preview; the two bundle rules say venue"`.

### Open PRs touching S17's files

- **#2369** (A696, lands first): `packages/provisioning/src/configuration-transfer.ts` and its tests
  (`configuration-transfer.test.ts`, `configuration-transfer.clock.test.ts`,
  `configuration-transfer.boundaries.test.ts`).
- **#2373**, **#2375**, **#2377**: `docs/developers/conventions-data.md` (other sections).

---

## The fixture slices F2–F5 — rules every F task follows

F2–F5 move tests onto F1's helpers so the schema slices change helper bodies, not tests. They change
no behaviour and no assertion.

**What an F task changes (and only this).** A line that writes a `locations`, `nodes`, `devices` or
`working_orders` row for a test's ONE venue: `insert(locations)`, `insert(nodes)`, `insert(devices)`,
`insert(workingOrders)`, raw `insert into locations`, and a local `seedLocation`/`seedVenue` body
that does those. They become `seedVenue(db, overrides?)` (passing every venue field the test relies
on — name, invoice languages, time zone, day start — as `overrides`), `seedNode`, `seedDevice`,
`seedWorkingOrder`. A `locationId` passed to `seedNode` or `seedDevice` is dropped (F1's helpers fill
it), and a `locationId` variable that existed only to fill those rows goes. Exception: the fiscal
pair's own files (`packages/fiscal-verifactu/src/write-path.e2e.test.ts` and the `inmutabilidad`
suite) are never edited by an F task, whatever a glob selects. Where a test needs a fixed id (one an env file
names, or a constant other rows point at), pass it as an override if F1's helpers accept one; if
they do not, the line stays and is listed like category 1 below.

**What an F task leaves, and to whom:**
1. A case that seeds a SECOND location (85 test files insert `locations` twice or more:
   `git grep -c -E 'insert\((schema\.)?locations\)' -- '*.test.ts' | awk -F: '$2>=2' | wc -l`): left
   as it is, listed by `file:line` in the commit message for the code slice that deletes that
   cross-location refusal.
2. `locationId` passed to code (`cfg.locationId`, `?locationId=`, a function parameter): the code
   slice that removes the parameter.
3. The setup request's or the bundle's shape: S16 / S17.
4. `ProvisionedNode`, `NodeConfig`, `TradingContext` `locationId`: S18.
5. A module table's own `location_id` value (departments, staff roles, zones, stations …): its schema
   slice (design §6, "The test fixtures").

**A local helper named `seedVenue`.** 28 files define one and 64 call one
(`git grep -l -E 'function seedVenue[^A-Za-z]|const seedVenue[^A-Za-z]' -- apps packages scripts | wc -l`,
and `-E '[^A-Za-z.]seedVenue\('`; the same 28 at `0160250f67`). F1's codemod reports each and adds
no import there. **The F task whose glob holds the file replaces the local definition by hand**:
where it only writes the venue it is deleted and its callers call F1's `seedVenue`; where it seeds
more, it is renamed for what else it seeds (for example `seedVenueWithMenu`) and calls F1's
`seedVenue` for the venue row. Which task does which:

| Task | Files defining a local `seedVenue` |
| --- | --- |
| F1a | `packages/db/src/testing/seed.test.ts` |
| F2b | `packages/venue-service/src/kitchen-screens.test.ts`, `profile-access.test.ts` |
| F2c | `packages/venue-service/src/service-steps.test.ts` |
| F2f | `packages/catalogue/test/fixtures.ts`, `packages/recipes/test/fixtures.ts`, `packages/composition/src/node-backup-verification.test.ts` |
| F2g | `packages/reporting/test/fixtures.ts`, `packages/staffing/test/seed.ts`, `packages/fiscal-verifactu/src/throwaway-allocation.test.ts` |
| F3a | `apps/server/src/alerts-api.test.ts`, `alerts.test.ts` |
| F3b | `apps/server/src/backup-deletion-alert.test.ts` |
| F3c | `apps/server/src/boot.backup-recovery-pack.test.ts`, `boot.failed-start.test.ts`, `box-health.payments-off.test.ts`, `card-reader-delete.db.test.ts` |
| F4c | `apps/server/src/payments-api.test.ts`, `printer-delete.db.test.ts` |
| F5c | `apps/server/src/staff-notices.test.ts`, `start-backup-room-record.test.ts` |
| F5d | `apps/server/src/till-api.zone-required.test.ts` |
| F5e | `apps/server/src/testing-zone-offers.test.ts`, `till-reroute-e2e.test.ts` |
| none | `apps/server/scripts/allergens-demo.ts`, `daily-close-demo.ts`, `daily-close-z-demo.ts`, `modelo-303-demo.ts`: demo scripts, not tests; they import no test helper, so nothing clashes (S2-4 and S19 own them) |

**A test that only passes a location to `seedNode` or `seedDevice`** (no FX match) is not selected
by any F task: the helpers keep accepting the argument until the schema slices, which remove the
parameters and the arguments together (header, "Carried to the schema plan").

**Helpers keep their exported signatures** within F2–F5 (a returned `locationId` stays until S18 or
the schema slices), so F3/F4 do not wait for F5's helper tasks and no two F slices edit one caller.

**Every F task's steps:**

- [ ] **Step 1: record the baseline.** `memory_pressure | grep free`; run the task's files on the
  branch base and note each package's `Tests N passed` line. Run the done-check grep
  (`git grep -n -E "$FX" -- <task files>`) and note its count: this is the red check (it must print
  lines now).
- [ ] **Step 2:** run F1's codemod over the task's files (the command F1's section gives).
- [ ] **Step 3:** fix by hand what the codemod leaves in category "changes" above.
- [ ] **Step 4:** typecheck each touched package (`pnpm --filter <pkg> typecheck`); run the same
  files — PASS with the same `Tests N passed` as Step 1 (no test deleted, skipped or added).
- [ ] **Step 5:** `git diff -U0 <base> -- <task files> | /usr/bin/grep -E '^[-+].*expect\('` prints
  nothing (no assertion changed); `pnpm format:check`.
- [ ] **Step 6: done-check.** `git grep -n -E "$FX" -- <task files>` prints only the category-1 lines
  listed in the commit message. The design grep `P` over the task's files may still print categories
  2–5.
- [ ] **Step 7:** `git commit -s -m "test: <area> tests seed their venue through the shared helpers"`.

Each task below gives its files as a command (count at `abfe271663`; re-run at the task's head,
since A696 and the code slices move lines), the packages to typecheck, extra checks, and open PRs.
Write `FILES=( ${(f)"$(git grep -l -E "$FX" -- <paths>)"} )` to get a zsh array (CLAUDE.md global:
an unquoted list is one argument in zsh).

---

## F2 — Package tests and package fixture helpers

- **Goal:** every package's tests other than `packages/db` (F1) and fiscal-verifactu's own helpers
  (S3) take their venue, node, device and order rows from F1's helpers.
- **Depends on:** F1. **Lands:** lane. **Branch:** `refactor/a1301-f2-package-fixtures`.
  **Review path:** LIGHT (tests only, no risk trigger).
- **Size:** 132 test files insert one of the four tables (summary §5, re-run at `abfe271663`), split
  into seven tasks; helpers go with their package's task.

**Non-test files the TSV gives F2**, what each needs:

| File | Task | Change |
| --- | --- | --- |
| `packages/venue-service/src/testing/zone-menus.ts` | F2a | `:75-79` reads `locations.dayCutover` by `cfg.locationId` → `readVenueClock(tx)`'s day start (the one non-seed change F2 makes: a test helper reading a venue setting, which no code slice lists); `:28` is S6's (`zoneServicePolicies.locationId`) |
| `packages/adjustments/test/seed.ts` | F2e | `:10-17` `insert(locations)` + order → `seedVenue` + `seedWorkingOrder` |
| `packages/payments/test/seed.ts` | F2e | `:55-69` venue, node, device, order → F1 helpers; returned `locationId` kept |
| `packages/bookings/src/testing/fake-core.ts` | — | `:31,76` `cfg.locationId` (category 4, S18); no change |
| `packages/catalogue/test/fixtures.ts` | F2f | `:139-149` venue and node → helpers; `:208` `assignCatalogueToLocation` is S5's |
| `packages/catalogue/test/menus-fixture.ts` | F2f | `:55` calls the local `seedVenue` from `fixtures.ts` — rename per the rule above; `:173-176` module rows (S5/S21) |
| `packages/core/test/fixtures.ts` | F2f | `:39-63` venue → device → node → helpers |
| `packages/identity/test/fixtures.ts` | F2f | `:18-22` venue + device → `seedVenue` + `seedDevice` |
| `packages/recipes/test/fixtures.ts` | F2f | `:26-31` venue + node → helpers |
| `packages/provisioning/test/allocated-venue.ts` | — | `:61` `ProvisionedNode` (S18); no change |
| `packages/provisioning/test/configuration-bundle.ts` | — | bundle shape (S17a) |
| `packages/provisioning/test/first-setup-request.ts`, `start-again-attempt.ts` | — | request shape (S16a) |
| `packages/reporting/test/fixtures.ts` | F2g | `:56-72,84,93-94` venue, device, node → helpers; `:470,501-505,550-554` module/order rows (S24/S27, or `seedWorkingOrder` where it is an order) |
| `packages/reporting/test/tender-refund-fixtures.ts` | — | `:76` a refund's `locationId` (S27's table); no change |
| `packages/staffing/test/seed.ts` | F2g | `:11-19` venue → `seedVenue`; `:32-43` module rows and `cfg` (S20/S18) |
| `packages/staffing/src/testing/rota-fixture.ts` | — | `:35` a rota type's field (S9); no change |
| `packages/workforce/test/fixtures.ts` | F2g | `:48-53` `seedLocation` body → `seedVenue`; its callers that seed a second one are category 1 (A1268/S13) |
| `packages/workforce/test/attendance-fixture.ts` | — | `:24-25` seeds `elsewhere`, a second location (category 1, S13 after A1268); no change |
| `packages/workforce-es/test/fixtures.ts` | — | `convenio_config` rows (S20); no change |
| `packages/country-es/test-fixtures/demo/madrid-before-move.en.json`, `packages/country-es/test-fixtures/demo/madrid-before-move.es.json`, `packages/country-es/test-fixtures/demo/madrid-before-move.manifest.json`, `packages/country-es/test-fixtures/demo/original-exporter.ts.txt` | — | **never edited, never regenerated** — see below |

**The four `country-es` demo files (2,499 matching lines).** They are not a configuration export.
They are a frozen database capture of the Madrid demo seed taken before A972 moved it into the
country pack: `madrid-before-move.manifest.json` pins `originalMain`
`d5c7ccb1a7ad8c0a936f6bc7a10b98c56b463360`, the exporter's digest (`exporterSha256`) and each
fixture's sha256; `original-exporter.ts.txt` is that exporter's source, kept so the digest can be
checked. `packages/country-es/src/demo-testing.test.ts:15-40` fails if the exporter source or a
captured fixture stops matching the digests the manifest records, and `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:87-88` checks the same
digests before comparing a fresh seed with the capture. Its live counterpart is
`apps/server/scripts/demo-seed/testing/madrid-semantics.ts` (F5's file list; its `:145,203,248`
canonical keys are schema-slice territory). So no slice regenerates them: regenerating would break
both digest checks and erase what the capture proves. Schema changes are absorbed in the baseline
test by transforms, as `RENAMED_COLUMNS`, `ADDED_TABLES`, `REMOVED_TABLES` and the column pushes at
`seed.madrid-baseline.test.ts:22-35,115-150` do today. The schema slices that change `locations` or
drop a `location_id` (S20–S28, and S23's new tables as `ADDED_TABLES` entries) add those transforms;
see the header's "Carried to the schema plan" for the one transform `REMOVED_TABLES` cannot express.

### Task F2a — venue-service `src/[a-h]*` (21) and `src/testing/zone-menus.ts`
`git grep -l -E "$FX" -- 'packages/venue-service/src/[a-h]*.test.ts'`. Typecheck `@waitron/venue-service`.

### Task F2b — venue-service `src/[i-r]*` (25)
`git grep -l -E "$FX" -- 'packages/venue-service/src/[i-r]*.test.ts'`.

### Task F2c — venue-service `src/[s-z]*` and `src/schema/` (24)
`git grep -l -E "$FX" -- 'packages/venue-service/src/[s-z]*.test.ts' 'packages/venue-service/src/schema/*.test.ts'`.
The three `schema/` tests' own-table rows are category 5.

### Task F2d — printing 12, layouts 3, media 4 (19)
`git grep -l -E "$FX" -- 'packages/printing/**/*.test.ts' 'packages/layouts/**/*.test.ts' 'packages/media/**/*.test.ts'`.
Typecheck `@waitron/printing`, `@waitron/layouts`, `@waitron/media`.

### Task F2e — bookings 9, adjustments 5, payments 4 (18) and their three helpers
Helpers first (`adjustments/test/seed.ts`, `payments/test/seed.ts`; `bookings/src/testing/fake-core.ts`
unchanged). Bookings' four raw-SQL `insert into locations` files (`bookings.test.ts`, `floor.test.ts`,
`table-removal.test.ts`, `wall-clock.test.ts`) get `seedVenue` on the same database handle before
their raw statements; a raw statement that writes a module row keeps its `location_id` value
(category 5) read from `venueLocationId`.

### Task F2f — catalogue 3, core 2, composition 1, credentials 1, identity 2, provisioning 3 (12) and five helpers
Helpers: catalogue ×2, core, identity, recipes. Overlap: **#2373** edits
`packages/core/src/record-sale.test.ts`.
`packages/provisioning/src/venue-apply.test.ts` and `tenant-guard.db.test.ts` test the provisioning
writer and the live-venue guard: where a case inserts `locations` to prove what `applyVenue` or
`readOperationalVenueIds` does with an existing row, that row IS the case (category 1, S23 owns
the guard's switch); only setup rows move.

### Task F2g — reporting 3, staffing 2, workforce 2, workforce-es 3, fiscal-verifactu 3 (13) and helpers
Helpers: reporting `fixtures.ts`, staffing `test/seed.ts`, workforce `test/fixtures.ts`.
The fiscal-verifactu tests (`chain.node-rekey.concurrency.test.ts`, `engine-clock-and-floor.test.ts`,
`throwaway-allocation.test.ts`) are not the fiscal pair; still run the fiscal pair after this task.
Overlap: **#2375** (A1268) edits `packages/workforce/test/fixtures.ts`,
`packages/workforce/src/backup-verification.test.ts`, `packages/workforce-es/src/record-export.test.ts`
— overlap only, never a reason to wait: whoever lands second rebases (if #2375 has landed, read
A1268's merged helpers before editing).

**F2 slice done-check:** `git grep -n -E "$FX" -- 'packages/**/*.test.ts' ':!packages/db/**'`
prints only category-1 lines listed in the seven commit messages; fiscal pair passes unedited.

---

## F3 — `apps/server` tests whose path under `src/` starts `a`–`f`

- **Goal / area:** as design §6: 109 test files insert one of the four tables (re-run at
  `abfe271663`). No non-test file (the TSV has no F3 row).
- **Depends on:** F1. **Lands:** lane. **Branch:** `refactor/a1301-f3-server-fixtures-a-f`.
  **Review path:** LIGHT. Package: `@waitron/server`
  (`pnpm --filter @waitron/server exec vitest run <files>`); check free memory before each run.

| Task | Files | Count | Open PRs |
| --- | --- | --- | --- |
| F3a | `git grep -l -E "$FX" -- 'apps/server/src/a*.test.ts'` | 29 | **#2375**: `attendance-discovery`, `attendance-export-api`, `attendance-loop`, `attendance-restore` tests (whoever lands second rebases) |
| F3b | `… -- 'apps/server/src/b[a-n]*.test.ts'` (`backup*`, `bill-*`) | 22 | — |
| F3c | `… -- 'apps/server/src/b[o-z]*.test.ts' 'apps/server/src/[ce]*.test.ts'` (`boot*`, `c*`, `e*`) | 29 | — |
| F3d | `… -- 'apps/server/src/[df]*.test.ts'` | 29 | — |

`apps/server/src/backup-verification.test.ts` and `backup-verification-compatibility.test.ts` seed
with raw `insert into locations` on a backup copy: use F1's helpers on the same handle where they take
one; a raw statement on a `DatabaseSync` stays and is listed (the schema slices change it).

---

## F4 — `apps/server` tests `g`–`r`

- **Goal / area:** 99 test files (re-run at `abfe271663`). No non-test file.
- **Depends on:** F1. **Lands:** lane. **Branch:** `refactor/a1301-f4-server-fixtures-g-r`.
  **Review path:** LIGHT.

| Task | Files | Count | Open PRs |
| --- | --- | --- | --- |
| F4a | `git grep -l -E "$FX" -- 'apps/server/src/[g-l]*.test.ts'` | 19 | — (`location-settings-api.orders-open.test.ts` is renamed by S1; take its new name) |
| F4b | `… -- 'apps/server/src/[m-o]*.test.ts'` | 26 | **#2375**: `management-hours-api.test.ts` |
| F4c | `… -- 'apps/server/src/p*.test.ts'` | 25 | — |
| F4d | `… -- 'apps/server/src/r*.test.ts'` | 29 | **#2375**: `restore-command.archive.test.ts` |

---

## F5 — `apps/server` `s`–`z`, `src/testing/*`, server scripts and test folders, and the root raw-SQL seed

- **Goal / area.** The design gives F5 "78 `apps/server` files plus the rest". At `abfe271663` it is
  **67** test files under `apps/server/src/[s-z]*` that insert (40 `t*`, 27 `s*`/`v*`/`w*`;
  `src/testing/` holds no inserting test), plus 4 `apps/server/scripts/` tests and the helpers. The
  `z*` tests are F5c's too: at main the only one, `zone-access.finished-party.test.ts`, matches
  nothing; A696 (#2369) adds `zone-*` tests, of which `zone-core-capabilities`,
  `zone-economic-boundaries` and `zone-webhook-admission` insert (FX at `7e824ae233`).
  Root `scripts/`: only `scripts/behavioural-triggers.test.ts` seeds these rows;
  `scripts/write-path-tables.test.ts:337` matches FX only inside a string literal the guard's own
  matcher is tested on, not a seed, and stays. `apps/dashboard` and `apps/till`: no test inserts any
  of the four tables (`git grep -l -E "$FX" -- 'apps/dashboard/**/*.test.ts' 'apps/till/**/*.test.ts'`
  prints nothing); their fixture helpers are API mocks (header, "Notes for the S13–S15 plans") and stay.
- **Depends on:** F1. **Lands:** lane. **Branch:** `refactor/a1301-f5-server-fixtures-s-z`.
  **Review path:** LIGHT. Helper tasks F5a and F5b go first.

**Non-test files the TSV gives F5** (54), with what F5 does. Lines not named stay with the slice in
brackets.

| File | Task | Change |
| --- | --- | --- |
| `apps/server/src/testing/adjustment-venue.ts`, `bill-venue.ts`, `clock-venue.ts`, `party-venue.ts`, `signed-in-till.ts`, `venue-fixtures.ts` | — | provision through `applyVenue` (no insert); request literal (S16f); `cfg.locationId`, `assignCatalogueToLocation` (S18, S5); no F5 change |
| `allocated-contract.ts` | — | `:63-83,97-101` copies a primary's `locations` and `nodes` rows into a standby's database with their ids, which `seedVenue` would not keep (S3/S4's standby path); listed, not changed |
| `allocated-provision.ts`, `dormant-contract.ts` (`:22,31,70`), `staged-hour-crash.ts`, `staged-hour-restore.ts`, `stream-loop-scenario.ts:466` | F5a/F5b | `ProvisionedNode` lines (S18) stay; `dormant-contract.ts:39` `insert(nodes)` → `seedNode` |
| `backup-verification-fixture.ts` | F5a | `:187-193` venue and node → helpers; `:50` the fixture node's `locationId` (S18) |
| `boot-harness.ts` | F5a | `:57-65,335-341` venue and node inserts → helpers with the ids `TILL_ENV`/`KEY_ENV` name (pass them as overrides); `:217` request (S16f) |
| `clear-provision-fixture.ts` | — | `:51-54` table list for clearing (S23/S28 rename the tables) |
| `fiscal-fixtures.ts` | F5a | `:111-118` venue, device, node → helpers; `:52,76-78` (S27) |
| `floor-sets.ts`, `floor-today-venue.ts`, `kitchen-allergy-fixture.ts`, `live-table.ts`, `service-steps.ts`, `service-zone.ts` | — | module rows and `cfg` (S7, S24, S18) |
| `full-invoice-fixture.ts` | — | `:69` text "Current mutable location address" (S19) |
| `session-device.ts` | F5b | `:28-35` stops passing `locationId` to `seedDevice` (F1's helper fills it); `:81-89` `dashboardOrderAt(locationId)` is order values for tests' own inserts (category 2/5, S27); signature kept |
| `split-extras-venue.ts` | F5b | `:49-57` venue and node → helpers |
| `stream-pause-scenario.ts` | F5b | `:360` `insert(devices)` → `seedDevice`; its request literal is S16f's and its catalogue lines S5's |
| `theme-logo.ts`, `zone-offers.ts`, `zone-process-child.ts` | — | module rows, a second location (`theme-logo.ts:70-131`, category 1), a settings read/write (S1) |
| `fixtures/configuration-v1-before-printing-retirement.json` | — | frozen format-1 export (S17 section) |
| `apps/server/test/attendance-export-fixture.ts` | F5b | `:15` `insert(locations)` → `seedVenue`; its attendance lines are S13's |
| the other eight `apps/server/test/*.ts` | — | request/preview shape (S16) or `ProvisionedNode` (S18); none matches FX (`git grep -n -E "$FX" -- 'apps/server/test/*.ts'` prints only `attendance-export-fixture.ts:15`) |
| `apps/server/scripts/cloud-backup-fixture.ts`, `cloud-recovery-client-fixture.ts` | — | read `locations.name`/`id` from a restored copy (S1's `readVenue`, S18) |
| `apps/server/scripts/cloud-integration-fixture.ts` | — | request (S16f); `:138-142` reads a node's location (S18) |
| `apps/server/scripts/testing/venue.ts`, `demo-seed/testing/provision-venue.ts` | — | request (S16f); `locationName` fixture key (S19) |
| `apps/server/scripts/demo-seed/testing/madrid-semantics.ts` | — | canonical keys of the Madrid capture (schema slices) |
| `apps/dashboard/test/attendance-fixtures.ts`, `apps/dashboard/test/hours-fixtures.ts`, `apps/dashboard/test/manager-hours-fixtures.ts`, `apps/till/test/attendance-fixtures.ts`, `apps/till/test/clock-app.ts`, `apps/till/test/hours-fixtures.ts`, `apps/dashboard/src/testing/department-receipt-app-fixture.ts` | — | API mocks, not database seeds: the attendance and hours fixtures change with S15; `department-receipt-app-fixture.ts:114` mocks `/management-api/location-settings`, renamed by S1 (S1 or S19 updates the mock's path) |
| `apps/setup/test/*.ts` | — | S16 |

### Task F5a — helpers `apps/server/src/testing/[a-o]*`
The F5a rows above. Red check: `git grep -n -E "$FX" -- 'apps/server/src/testing/[a-o]*.ts'`.
Run every test file that imports a changed helper
(`git grep -l -E "testing/(backup-verification-fixture|boot-harness|dormant-contract|fiscal-fixtures)" -- 'apps/server/**/*.test.ts'`)
— same `Tests` counts. Fiscal pair after (these helpers seed fiscal tests).

### Task F5b — helpers `apps/server/src/testing/[p-z]*`, `apps/server/test/*`
The F5b rows above; same check over the importing tests.

### Task F5c — `apps/server/src/[svwz]*` (27 at main, plus A696's `z*` tests), the four `apps/server/scripts` tests, and the root seed
`git grep -l -E "$FX" -- 'apps/server/src/[svwz]*.test.ts' 'apps/server/scripts/**/*.test.ts'`
(scripts: `demo-seed/seed-adjustments.test.ts`, `dev-setup.test.ts`, `restore-allocation.test.ts`,
`script-device.test.ts`). `dev-setup.test.ts:538-544` seeds a separate store's `venue` handle: use
F1's helpers on `store.venue`.
`scripts/behavioural-triggers.test.ts` runs raw SQL on a `DatabaseSync` (`:454`), which F1's drizzle
helpers cannot take. Its orders already go through one builder (`workingOrder`, `:213-223`). F5 adds
the same for devices: a `device(id, profileId, label, active)` builder beside `workingOrder` that
writes `location_id` `'loc'`, used by the two inserts at `:353` and `:357`, so S26 changes one place.
Its `locations` rows (`:290,362,370,428`) and the cases on them are S23's (design §2.3: `wo-orphan`,
`loc-es-only`, `loc-relocale`); F5 does not touch them. Run `pnpm exec vitest run scripts/behavioural-triggers.test.ts`
— same count.

### Task F5d — `apps/server/src/till-api*` (16)
`git grep -l -E "$FX" -- 'apps/server/src/till-api*.test.ts'`. Overlap: **#2373** edits
`till-api.test.ts`, `till-api.zone-required.test.ts`.

### Task F5e — the rest of `apps/server/src/t*` (24)
`git grep -l -E "$FX" -- 'apps/server/src/t*.test.ts' ':!apps/server/src/till-api*'`. Overlap:
**#2373** (`tender-refund-management`, `tender-refunds`, `till-sale-integrated.db` tests); **#2375**
(`till-attendance-api`, `till-clock-api`, `till-clock-attendance`, `till-clock-state` tests). Overlap
only: whoever lands second rebases.

**Open PRs touching F5's non-test files:** **#2377** (A1008) edits
`apps/server/src/testing/stream-loop-scenario.ts`; **#2369** (A696, lands first) edits
`adjustment-venue.ts`, `bill-venue.ts`, `kitchen-allergy-fixture.ts`, `party-venue.ts`,
`signed-in-till.ts` and adds `zone-process-child.ts`.

**F5 slice done-check:** `git grep -n -E "$FX" -- 'apps/server/src/[s-z]*.test.ts' 'apps/server/src/testing/**' 'apps/server/test/**' 'apps/server/scripts/**/*.test.ts' 'apps/server/scripts/**/testing/**' 'scripts/*.test.ts'`
prints only category-1 lines (listed), `allocated-contract.ts`'s standby copy, `behavioural-triggers.test.ts`'s
`locations` rows (S23), and `write-path-tables.test.ts:337`. (The demo scripts under
`apps/server/scripts/` that insert venue rows — `allergens-demo.ts`, `daily-close-demo.ts`,
`daily-close-z-demo.ts`, `modelo-303-demo.ts`, `script-device.ts` — are S2's and S19's, not fixtures.)


---

## Controller fold notes

The plan was assembled from five parts written in parallel, then the controller's decisions D1–D11
(`~/waitron-campaign/a1301/decisions.md`) were applied. Where a decision met something a part wrote,
the decision won. These notes record what the fold changed beyond a plain edit, and where a decision
could not be applied exactly as written.

1. **D1 (three readers to S2).** The S1 part already left `saleLanguageFor`,
   `readOfferedReceiptLanguages` and `readLocationAddress` to S2, but it still had S1 add
   `readVenueAddress` and move `department-receipt-api.ts:87` onto it. Both moved to the new Task
   S2-5, so S1 touches neither the readers nor their callers. S1 keeps renaming the type
   `LocationAddress` → `VenueAddress`: the name is shared with `addressLines` and
   `receiptAddressLines` (S1's), and the rename changes nothing `readLocationAddress` does. The S2
   part had treated all three readers as S1's; its "allowed leftover" lines were rewritten.
2. **S5's `departmentReceiptLanguages` `cfg`.** The S5 part said the parameter becomes unused once
   `readReceiptLanguage` loses its id. At A696's head it does not:
   `apps/server/src/department-receipt-languages.ts:27` still passes `cfg` to
   `readOfferedReceiptLanguages`, which D1 makes S2's. The plan has whichever of S5 and S2-5 lands
   second drop it.
3. **D3 and S2-3's printer offers.** The S2 part narrowed `InvoiceDeliverySale` to `{ id }`, which
   forced it to remove the location filters in `orderInvoicePrinters` (`orders-list.ts`, S11),
   `tillInvoicePrinters` (`till-api.ts`, S12) and `resolveInvoicePrinter`'s `at`
   (`receipt-print.ts`, S10). Those are more than argument-only edits in lane files, which D3 does
   not allow an owner slice. So S2-3 keeps `InvoiceDeliverySale.locationId`, filled from
   `venueLocationId(tx)` instead of the sale's node; S11a and S10b remove its readers (they already
   listed those lines), and S18 deletes the field. S2-3's cross-location test deletions that prove
   those filters are left to S11a and S10b.
4. **D3 applied where it bites.** S5: `readReceiptLanguage` and `listAvailableProducts` keep an
   ignored optional `_locationId?` for `invoice-document.ts:101`, `receipt-presentation.ts:21` and
   `apps/server/scripts/demo-seed/seed.ts:109-110`. S10a: `claimPrintJobs` keeps an ignored optional
   `locationId?` for `invoice-print.ts:62`; `createPrinter` (`_cfg`) and `routeToDemoPrinter`
   (`_locationId`) keep ignored leading parameters for `demo-seed/seed.ts:85,95`, which means every
   caller keeps passing them until S2 or S18 — the price of the rule for a leading parameter. S11b:
   `nextStationColour` keeps an ignored optional `_locationId?` for
   `packages/provisioning/src/venue-apply.ts:307` (S16). The S9–S12 part's other two crossings
   (`restore-command.ts:509` and the setup app's restore screens) left with D4's restore rename.
   D3 is read as written: once the owner slice has landed, the lane slice edits the call itself
   (argument only). S17 relies on that for `first-setup-command-deployment.ts:318-321`.
5. **D6 (`first-fiscal-setup.e2e.test.ts`).** Line 248, inside the allowed range, is itself an
   assertion (`expect(preview.location).toHaveProperty("fireControl")`). Flattening the request
   makes line 249's key check fail unless the preview's `location` key is set aside first. S16b
   destructures it on line 247 and line 248 reads the same value under the new name; no assertion's
   value changes and line 249 is untouched. S17 then deletes the `fireControl` check, because
   `fireControl` leaves the bundle (§2.1); that is outside D6's scope (S16) and S17's PR names it.
6. **D8 (`z*` tests).** At main the only `apps/server/src/z*` test is
   `zone-access.finished-party.test.ts`, which matches neither the fixture grep nor a location word.
   The `zone-*` tests that seed rows are added by A696 (#2369): `zone-core-capabilities`,
   `zone-economic-boundaries` and `zone-webhook-admission` insert at `7e824ae233`. F5c's glob is now
   `[svwz]*`.
7. **D9 (local `seedVenue`).** The 28 files are mapped to the F task whose glob holds them (table
   under "The fixture slices F2–F5"); F1's codemod reports them and adds no import there. Four of the
   28 are demo scripts under `apps/server/scripts/`, not tests; they import no test helper, so nothing
   clashes and no F task touches them.
8. **A gap no decision covers: F task selection.** F tasks select files by the fixture grep
   (`FX`), so a test that only passes a location to `seedNode`/`seedDevice` is not selected. The plan
   leaves those arguments (the helpers keep accepting them, D9) and carries their removal to the
   schema slices that delete the parameters.
9. **S2's use of `venueLocationId` beyond filling a column** (`invoice-email-contact.ts`, for the
   venue-service seats' scope) was not decided; the plan keeps the S2 part's version and lists the
   line for S18. S2-3 adds a second such use (`InvoiceDeliverySale.locationId`, note 3).
10. **S12d is its own branch** (`refactor/a1301-s12d-locations-route`), since it waits for S15 and S12
    does not.
11. **Names made consistent:** S1 settled the accessor in `@waitron/db` and the place type
    `VenuePlace`, so the S5–S8 part's "if S1 puts it in reporting" and "if S1 keeps `LocationPlace`"
    branches were removed; `location-settings-api.ts` is `venue-settings-api.ts` after S1; tasks are
    named `S2-1`…`S2-5`, `S3-1`…`S3-4`, `S4-1`, `S4-2` like S5's; `readReceiptLanguage` is S5's
    (the S9–S12 part had it as S1's). Each part's own rule list was cut where it repeated the
    header's, keeping each task's own commands.
12. **D7.** The F tasks' "take this task after #2375 lands" and "run after A1268 lands" were
    removed; the overlaps stay listed so the rebase is expected.
13. **D2.** The S5–S8 part's advice that code slices start after, or wait for, the F tasks owning
    their tests was removed.
14. **Coverage check.** Every file `file-assignment.tsv` gives to S1–S12, S16, S17 or an F slice (355
    rows) appears in this plan by full path (269) or by a path suffix or base name inside its slice's
    section (86); seven listed only in brace form were written out in full. Script:
    `python3 ~/waitron-campaign/a1301/scripts/plan-coverage.py <plan> ~/waitron-campaign/a1301/file-assignment.tsv`
    (prints `missing: 0`).
