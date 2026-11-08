# A1308 dv3: every read of `printers` says which kind it means — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Prepare `printers` to hold A4 printers before any arrive. Add `printers.kind`
(`receipt` or `a4`; every row is `receipt` after this slice), and give every read of
`printers` in product code the kind it means, so that when dv4 moves A4 printers in, no receipt
list, receipt route or print job can pick one up. This is measurement M5, run in the slice that
introduces the reads it tests.

**Why a slice of its own:** two tables kept the kinds apart "without anyone having to ask"
(`tables-devices.md` §1.6). Doing the ~60 reads here, with no A4 row in the table yet, keeps the
merge (dv4) to the schema and the A4 code, and lets this slice prove every read with an A4 row
added only by the tests.

**Spec:** [tables-devices.md](../specs/2026-11-02-rationalisation/tables-devices.md) §1.6 "Reads
have to say which kind they mean", §5 row "print_jobs: FK `printer_id` as proof of a thermal
printer", §8 M5; README §3 R9. Rules: [slice rules](2026-11-08-a1308-slice-rules.md).
Area order: [dv1](2026-11-08-a1308-dv1-devices-row.md).

**Base:** `main` after dv2. Lines read at `a086eedfb7`; a cite that no longer says what this plan
says is a stop (rules §5.1). The floor and kitchen slice may have moved the station-printer reads
(`station_printers` becomes `kitchen_stations.printer_ids`); follow them to their new place, the
rule below still applies.

**Owner lands:** no (rules §6).

**Pull request's first line (rules §2):** "Every venue is reset: core; backups and exports from
before this cannot be restored or imported."

## The rule every site follows

**Each read keeps the answer it gives today.** A read of `printers` today sees only thermal
printers, so it gains `kind = 'receipt'`. Nothing reads both kinds through `printers` yet; the
reads that will want both (they read `page_printers` too today) also get `kind = 'receipt'` here,
and dv4 merges their two queries into one with no kind filter. The filter is one exported
fragment, so a reviewer can grep for reads without it.

```ts
// packages/db/src/schema/printers.ts — re-exported from "@waitron/db"
export const printerKind = enumType(["receipt", "a4"]);
/** The condition every read of thermal printers carries (dv3). */
export const isReceiptPrinter: () => SQL; // eq(printers.kind, "receipt")
```

## M5: the measurement, written before the code

**What runs:** an A4 row is added to the fixtures of the printer, device, order, report and station
suites (Task 1), first with no filter in the code. **Expected first result:** failures in those
suites, each an A4 printer appearing in a receipt list or accepted by a receipt route; Task 1 lists
each failure in the pull request. **Then** the filters go in (Task 2) and every suite passes with
its assertions unchanged. **The failing result** (rules §5.4): after Task 2, a suite still shows the
A4 row in a receipt list, or a receipt route still accepts its id. The design names no fallback for
M5 beyond "every read means one kind"; the builder stops and the watcher decides the site.

Before dv4, an A4 row cannot have the A4 columns (they do not exist), so the test row is a
`printers` row with `kind = 'a4'` and receipt-shaped fields (`transport = 'network_tcp'`,
`host = '10.255.0.4'`). A helper builds it, so dv4 can change the one place:

```ts
// packages/db/src/testing/printers.ts — new; exported as "@waitron/db/testing/printers.js"
/** Inserts an A4 printer row for kind checks; dv4 gives it the real A4 columns. */
export function insertA4Printer(tx: Transaction, fields?: { name?: string; active?: boolean }): Promise<string>;
```

## The sites (read at `a086eedfb7`)

Every site gets `isReceiptPrinter()` (or `p.kind = 'receipt'` in raw SQL) in its `where`/join
condition. "Both in dv4" marks a read that dv4 turns into one query of both kinds.

| File:line | What it reads | Note |
| --- | --- | --- |
| `apps/server/src/alert-sources.ts:582` | untracked receipt originals | |
| `apps/server/src/box-health.ts:298` | printers on the health page | A4 printers are not on it today |
| `apps/server/src/demo-printer.ts:38`, `:50`, `:69`, `:129` | the demo printer by `local_key`; its switch off and on (updates) | |
| `apps/server/src/device-delete.ts:95-99` (after dv2), `:117` | held and chosen printers | |
| `apps/server/src/device-equipment.ts:360-366` | a scanned printer label | an A4 id answers `printer.not_found`, as an unknown id does today |
| `apps/server/src/invoice-delivery-actions.ts:91` | a receipt printer's paper settings | |
| `apps/server/src/invoice-delivery.ts:57`, `:227`, `:292` | a thermal job's printer; `notEndedByDelete`'s `${printers}` subquery | |
| `apps/server/src/kitchen-print.ts:166`, `apps/server/src/station-delete.ts:102`, `apps/server/src/station-outputs-down.ts:65`, `apps/server/src/station-printers.ts:34` | station printers | wherever the floor slice put them |
| `apps/server/src/management-api.ts:715` | profile list validation | both in dv4 (its `pagePrinters` read at `:722-725`) |
| `apps/server/src/orders-api.ts:258` | the reprint dialog's printers | |
| `apps/server/src/orders-list.ts:721` | `orderInvoicePrinters`' receipt part | both in dv4 (its `pagePrinters` read below it) |
| `apps/server/src/orders-list.ts:1113` | a job's printer | |
| `apps/server/src/orders-reprint.ts:25` | a receipt copy's printer | |
| `apps/server/src/print-api.ts:707`, `:952`, `:1205`, `:1283`, `:1292`, `:1340`, `:1398`, `:1459`, `:1531` | the receipt printers' management routes, the queue, the demo jobs | the update at `:707` gains it in its `where` |
| `apps/server/src/print-job-trouble.ts:121` | printers in trouble | |
| `apps/server/src/printer-delete.ts:38`, `:182` | delete impact and delete | an A4 id answers `printer.not_found` |
| `apps/server/src/receipt-preview-api.ts:136` | devices' receipt printers | |
| `apps/server/src/receipt-print.ts:155`, `:454` | receipt printer lookup; original receipt jobs | |
| `apps/server/src/report-api.ts:370`, `:394` | report printers | |
| `apps/server/src/document-printer-offers.ts` (#2455, its `printers` read near `:131-133`) | A790's offers | both in dv4 |
| `packages/layouts/src/device-equipment.ts:163`, `:204`, `:286`, `:376`, `:603`, `:607` | role printers, printer info, deleted check, portable | `:204` both in dv4 |
| `packages/layouts/src/device-printers.ts:127`, `:177` | drawer check; list validation | `:177` both in dv4 |
| `packages/printing/src/outbox.ts:55` | `insertPrintJob`'s printer check | see decision 2 |
| `packages/printing/src/outbox.ts:100` | a resend's target | |
| `packages/printing/src/printers.ts:134`, `:141`, `:154`, `:179` | receipt printer edit and list | the insert at `:67` writes `kind: 'receipt'` explicitly |
| `packages/printing/src/runtime.ts:106`, `:128-131`, `:163` | the agent's job pull and its returned printer fields; unpaired Bluetooth jobs | already safe by transport (`tables-devices.md` §1.6); add `p.kind = 'receipt'` anyway, so dv13's A4 jobs stay out of the thermal pull |

Before Task 2, the builder re-runs the inventory to catch reads added since this plan:

```bash
git grep -n -E "from\(printers\)|innerJoin\(printers|leftJoin\(printers|update\(printers\)|from printers|join printers|\$\{printers\}" -- apps packages ':!*.test.ts' ':!*/testing/*' ':!*/drizzle/*'
```

A site not in the table above is a stop (rules §5.5) unless it is plainly one of the rows moved.

## Decisions this plan makes

1. **No trigger locks the kind** (coordinator's decision, 2026-11-08). Today a page printer can
   never become a thermal printer because they are different tables. After dv4,
   `printers_kind_fields_ck` gives the same protection: a receipt row needs its paper width and
   resolution and no A4 field, an A4 row the reverse, so an update of `kind` alone is refused by
   that CHECK, and a change of kind would have to rewrite every field of both groups at once, which
   no code does. Until dv4 there is no A4 row at all.
2. **`insertPrintJob` matches the job to the printer.** Its printer check
   (`packages/printing/src/outbox.ts:53-58`) gains `isReceiptPrinter()` for `document` and `drawer`
   jobs, so a job queued on an A4 id keeps today's answer, `printer.not_found`
   (`tables-devices.md` §1.6: "A drawer job or a receipt on an `a4` id therefore keeps today's
   answer"). dv13 adds the `a4` branch.
3. **No wire change.** No API field names a kind that it did not before.

## What it builds

`printers.kind` (`printerKind("kind").notNull().default("receipt")`, `printers_kind_ck`
`enumCheck`), `isReceiptPrinter`, the filter at every site, and the M5 fixtures.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Any A4 row in product code; `ipp`; the A4 columns; deleting `page_printers` | dv4 |
| Merging the "both in dv4" reads | dv4 |
| `print_jobs.kind = 'a4'` | dv13 |

## Files

**Modify:** `packages/db/src/schema/printers.ts`, `packages/db/src/index.ts:159-165`, `packages/db/package.json`
(`exports` entry for `./testing/printers.js`), every file in the sites table, and the fixtures of
the suites in the finish line (set-up only: one `insertA4Printer` call each).
Generated: core's starting migration files and the epoch file.

**Create:** `packages/db/src/testing/printers.ts`, `packages/db/src/schema/printers.kind.test.ts`.

## Size

| Counted | Lines |
| --- | --- |
| Code: schema and fragment 20, ~65 sites at about 1.5 lines each 100, outbox 5 | ~125 |
| Tests: kind test 40, helper 25, M5 fixture lines and cases in ~14 suites 210 | ~275 |
| **Total** | **~400** |

About 2½ hours (the sites are mechanical; the M5 runs take the time).

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/printers.kind.test.ts
pnpm --filter @waitron/printing exec vitest run
pnpm --filter @waitron/layouts exec vitest run src/device-equipment.db.test.ts src/device-printers.db.test.ts
pnpm --filter @waitron/server exec vitest run src/print-api.test.ts src/print-api.printer-wiring.test.ts src/printer-delete.db.test.ts src/device-equipment-api.test.ts src/device-delete.db.test.ts src/receipt-print.test.ts src/orders-reprint.test.ts src/orders-invoice-deliveries.test.ts src/report-api.test.ts src/station-printers.test.ts src/station-delete.test.ts src/box-health.test.ts src/print-job-trouble.test.ts src/demo-printer.test.ts src/receipt-preview-api.test.ts src/alert-sources.invoice-delivery.test.ts
pnpm --filter @waitron/db --filter @waitron/printing --filter @waitron/layouts --filter @waitron/server typecheck
pnpm exec vitest run scripts/starting-migrations.test.ts scripts/schema-constraints.test.ts scripts/migration-upgrade.test.ts
```

(If a named suite file does not exist under that name at the base, use the suite that covers the
site; list the substitution in the pull request.)

## Expected protection-list difference

Under all six headers:

```text
changed table printers.columnOrder
extra table printers.checks[printers_kind_ck]
extra table printers.columns[kind]
```

Under the two `change-feed` headers, also `changed trigger waitron_change_printers_update.when`.

Reason: `tables-devices.md` §1.6 (`kind` is new).

## Stop points (beyond rules §5)

1. M5's failing result (above).
2. A site in the inventory grep that this plan does not list (beyond moved rows).
3. Adding `p.kind = 'receipt'` to the claim query changes its plan away from
   `print_jobs_pull_idx` (`packages/printing/src/runtime.ts:105-111` names the index; a test that
   reads the plan, if one exists, fails).

## Needs

dv2.

## In-flight work folded in (rules §8)

- **D1, PR #2594:** changes `runtime.ts` and `print-api.ts` reads (drawer expiry, queue
  explanations). If landed, its new reads of `printers` are sites too (the inventory grep finds
  them); if still open, it rebases after this and adds the filter to its own reads.
- **A405 PR 4** ("reprint to another printer"): its target-printer check is a receipt read and
  gains the filter, whichever lands second.

---

### Task 0: base protection list

- [ ] `pnpm protection-list list --out <empty absolute dir A>` in a throwaway worktree of the base.

### Task 1: the column, the fixture, and M5's first run

- [ ] **Step 1: failing test** `printers.kind.test.ts`: "a printer is a receipt printer unless
  stated" (a raw insert without `kind` reads `receipt`); "refuses a kind other than receipt or a4"
  (`printers_kind_ck`). Run: FAIL.
- [ ] **Step 2:** add the column and the CHECK; rebuild core. Run: PASS. Commit.
- [ ] **Step 3: M5, first run.** Write `insertA4Printer`. In each suite of the finish line, add one
  A4 row to the shared set-up (`beforeEach` or the venue seed the suite already uses) and one case
  per receipt route the suite covers: "an A4 printer is not offered" for lists, "an A4 printer's id
  is refused as `printer.not_found`" for routes taking an id, "a job cannot be queued on an A4
  printer" for `enqueuePrintJob`. Run the suites: record every failure (expected: many). Commit the
  red cases on the branch only if the lane's process allows; otherwise keep them in the working
  tree for Task 2.

### Task 2: the filter at every site

- [ ] **Step 1:** run the inventory grep; reconcile with the table (stop 2).
- [ ] **Step 2:** add `isReceiptPrinter()` at each site; decision 2 in `insertPrintJob`.
- [ ] **Step 3:** run the finish line: every suite passes with its original assertions and the new
  M5 cases (M5's failing result is a stop). Commit.

### Task 3: protection list, finish

- [ ] **Step 1:** protection list after; `compare`; mark each line.
- [ ] **Step 2:** `docs/developers/conventions-data.md`: a short entry "Every read of `printers`
  names its kind" with the fragment's name, why (two kinds, one table), and the inventory grep as
  the check; no guard is built (a text scan cannot tell a read that wants both kinds). CLAUDE.md
  §3 gets one line: "**Every read of `printers` names its kind** with `isReceiptPrinter()` or the
  A4 condition; a read that wants both says so in a comment. Nothing guards it.
  [Receipt](docs/developers/conventions-data.md#…)". Run `scripts/claude-md-pointers.test.ts`.
- [ ] **Step 3:** commit; `/finish-branch`; reset dev slots and Santet after landing.
