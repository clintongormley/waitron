# A1308 venue and box, PR vb6: the operation description is the department's, and a sale must be given one — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). Implementers are
> dispatched as `subagent_type: "implementer"`.

**FISCAL — the owner lands this PR** (rules §6; README §10, "Operation description … Fiscal, so the
owner lands it"). The description is the text sent to AEAT as `DescripcionOperacion`
(`apps/server/src/sale-operation-description.ts:7-50`). Nothing else in this area waits for it.

**Goal:** The operation description has one home, `departments.operation_description`. The venue's
copy is deleted, and recording a sale, a correction or a substitution requires the description as an
input: there is no fallback any more.

**Architecture:** A nullable text column on `departments`, read by `readSaleOperationDescription`
in place of the receipt JSON, with today's configured default (`offeredOperationDescriptionDefault`)
still filling an empty one. `operationDescription` becomes a required field of the three record
inputs in `@waitron/core`, so the compiler finds every caller that relied on the venue's copy.

**Tech Stack:** TypeScript (required field), Drizzle, Vitest; the setup app (a field removed).

**Spec:** [tables-venuebox.md](../specs/2026-11-02-rationalisation/tables-venuebox.md) §1.10 (the
`operation_description` row), §2.1 ("Not carried … `operation_description` is deleted (§6.5)"),
§6.5 (every site to delete), §2.4 (the bundle loses `operationDescription`).

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2). Second line: "FISCAL: changes where the operation
description sent to AEAT is read; owner lands." Then the two owner decisions below, before anything
else.

## Owner decisions (in the PR's first lines)

1. **The readiness test sale.** `packages/provisioning/src/fiscal-readiness-runner.ts:110-139` records
   a test sale that goes to AEAT's test service, with no description: today it takes the venue's
   copy, which `testVenue` stored from `request.operationDescription`. This PR deletes that field
   from the venue request. Proposed: pass the fiscal contribution's default,
   `args.contribution.venueFields?.defaults?.operationDescription`. For a setup made in the setup
   app the bytes stay identical, because the app never sends the field and setup fills in that same
   default (`apps/server/src/setup-api.ts:504-509`); a command-line setup that typed its own
   description would send the default instead. **Owner, 2026-11-09:** the proposal — the readiness
   test sale uses the fiscal contribution's default.
2. **The configured default as a fallback.** `readSaleOperationDescription` still fills an empty
   department description with the fiscal contribution's default (item 2). The design's "one home"
   could be read as deleting that too. **Owner, 2026-11-09:** keep the fallback, so a sale in a
   department with no description still sends the default (an empty description refuses
   `department.operation_description_required` only when there is no default, as today).

## What it builds

1. `departments.operation_description` (text, nullable). The department receipt store
   (`packages/venue-service/src/department-receipts.ts`) writes the editor's `operationDescription`
   there and reads it back into `DepartmentReceiptConfig.operationDescription`, so the editor's wire
   and the module contract are unchanged; `receipt_text` (vb5) no longer holds it.
   `listDepartmentReceiptReadiness` (`:170-187`) reads the column.
2. `readSaleOperationDescription` (`apps/server/src/sale-operation-description.ts:38-49`) reads the
   column for the sale's or order's department (retained or active, as today); empty or blank → the
   configured default (`operation-description-default.ts:3-5`, from the fiscal contribution,
   `packages/fiscal-verifactu/src/slot.ts:116`), else `department.operation_description_required`.
   Unchanged behaviour, changed source.
3. **The venue's copy is deleted.** Where it lives depends on slice 5d (owner), which moves the
   venue's operation description off `locations` (5a's sweep table). **First check (Task 1, Step 1):**
   `git grep -n "operationDescription" -- packages/db/src/venue.ts` and 5d's venue or business-day
   document. Delete it wherever 5d left it — a `settings.venue` field, or still `readVenue`'s field
   (`packages/db/src/venue.ts:12, :37` at `a086eedfb7`) — together with:
   `operationDescriptionFor` (`packages/core/src/operation-description.ts`, whole file) and its calls
   (`record-sale.ts:347`, `record-correction.ts:304`, `record-substitution.ts:226`); setup's fill
   (`apps/server/src/setup-api.ts:504-509`, `:609`, `:738`); `setup-first-fiscal-api.ts:380, :386`;
   the write and re-apply comparison (`packages/provisioning/src/venue-apply.ts:250, :287, :308`);
   `venue-plan.ts:24, :54, :89, :207`; the CLI option (`cli.ts:217, :266, :299`); the bundle field
   (`configuration-transfer.ts:45, :502`; format version +1, rules §9); the setup app's request type
   and refusal routing (`apps/setup/src/api/client.ts:239`, `screens/venue-screen.ts:88, :602`,
   `server-fields.ts:15, :49-50`). The venue screen never showed the field (`:602`).
   `GET /setup-api/venue-defaults` (`apps/server/src/setup-api.ts:728-745`) is deleted: it serves only
   this default, would answer empty objects once it goes, and has no production reader; with it its
   two cases (`apps/server/src/setup-api.test.ts:2957, :4339`) and the backlog entry "The setup route
   `GET /setup-api/venue-defaults` has no production reader" (`docs/backlog/setup.md:636-638`).
   > **2026-11-13:** branch `fix/setup-wizard-tidy` already deleted that route, its two cases and
   > that backlog entry; the route's path now sits in `setup-api.test.ts`'s "keeps missing files and
   > API paths as 404" list.
4. `RecordSaleInput.operationDescription` (`packages/core/src/record-sale.ts:66`) and the matching
   fields of `record-correction.ts:38` and `record-substitution.ts:29` become `string` (required).
   Every caller passes one:
   - production paths already do (`till-sale.ts:978/999, :1647/1651, :1814/1818`,
     `working-order.ts:7308/7312`, `bill-payments.ts:735/739`, `cancel-credit.ts:64/68`, and
     `packages/fiscal-verifactu/src/record-remedy-corrective.ts:134`, whose entry point refuses a
     blank text (`text()`, `record-remedy-corrective-http.ts:21-24`; its test at `:522`) — so slice
     5d's note that this path "may carry none" does not hold;
   - the readiness test sale (`packages/provisioning/src/fiscal-readiness-runner.ts:112`) passes the
     contribution's default (owner decision 1);
   - scripts and helpers that relied on the venue's copy pass the text their venue fixture stored at
     the base: `apps/server/scripts/demo-seed/seed-sales.ts:300` and `scripts/testing/sale.ts:47`
     (the demo venue's description), `apps/server/src/testing/backup-verification-fixture.ts:216`
     (its `:191`), `invoice-customer-fixture.ts:122`, `order-venue.ts:199, :257`,
     `staged-hour-crash.ts:150`, `synthetic-invoice.ts:55`, `apps/server/test/held-setup-database.ts:225`,
     `apps/server/test/hour-recovery-host.ts:606`, `packages/fiscal-verifactu/test/write-path-fixtures.ts`'s
     `saleInput` (so the fiscal pair stays unedited);
   - test calls: measured at `a086eedfb7`, 204 calls in 85 files that never name the field
     (`for f in $(git grep -l -E "record(Sale|Correction|Substitution)\(" -- '*.ts' | grep -E "test|testing"); do grep -q operationDescription $f || grep -c -E "record(Sale|Correction|Substitution)\(" $f; done`),
     plus calls in 37 more files that pass it on only some calls (the reviewer's count). The
     compiler is the complete list once the field is required;
     each passes the text its venue fixture stored (`seedVenue`'s `"Restaurant"`,
     `packages/db/src/testing/seed.ts:51`; the fiscal seed's `"Venta en establecimiento"`,
     `packages/fiscal-verifactu/src/testing/seed.ts:79`), so every filed record keeps its text.
     Where a file builds its inputs through one local helper, the helper takes it once.

## What it leaves out

| Left out | Owner |
| --- | --- |
| The configured default itself (`operationDescriptionDefault`) | stays: it is code configuration from the fiscal contribution, not a stored copy |
| Any change to what the dashboard's receipt editor shows | none needed (item 1) |

## Files

Modify: `packages/db/src/schema/venue-service/service.ts`; `packages/venue-service/src/department-receipts.ts`,
`configuration-transfer.ts` (`:617-626`: the length and control-character check moves from the
receipt JSON to the column); `apps/server/src/sale-operation-description.ts`; the item 3 and 4 files;
5d's document file if the copy lives there; the bundle version constant
(`packages/provisioning/src/configuration-transfer.ts:123, :160`); the Madrid baseline (expected
`departments` gains the column, filled from each folded row's `receipt_text.operationDescription`,
which leaves `receipt_text`; the venue copy leaves whichever expected row 5d put it in).

Delete: `packages/core/src/operation-description.ts` (it has no test file of its own).

Docs: `docs/backlog/setup.md:41` ("`operation_description` comes from the installed fiscal
contribution") is rewritten to say a sale's description comes from its department, with the fiscal
contribution's default filling an empty one; `docs/backlog/setup.md:113`'s mention of a refused
`operationDescription` is cut (the field leaves setup). `docs/backlog/setup.md:636-638` (the `venue-defaults` route entry) is
deleted (item 3). `apps/server/README.md` and
`packages/provisioning/README.md` lines naming the venue's description
(`git grep -n -i "operation.description" -- apps/server/README.md packages/provisioning/README.md`).

Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`.

## Size

| Part | Code | Tests |
| --- | --- | --- |
| Column, store, sale read, import check | ~60 | ~60 (read source, empty → default, required refusal) |
| Required inputs, scripts, helpers, readiness runner | ~45 | ~260 (one line per test call in about 120 files, fewer through helpers) |
| Setup app and server, venue copy removal (beyond pure deletion) | ~40 | ~30 |
| Madrid, docs | ~25 | — |
| **Total** | **~170** | **~350** |

About 520 counted lines (the route and its two tests go as deletions); deletions are not counted. About 2–3 hours.

## Finish line

1. `pnpm --filter @waitron/core typecheck` and every package's typecheck through the pre-push hook
   (the required field must leave no caller).
2. `pnpm --filter @waitron/server exec vitest run src/sale-operation-description.test.ts src/sale-operation-description.integration.test.ts src/till-sale.test.ts src/till-sale-integrated.db.test.ts src/bill-payments.test.ts src/setup-api.test.ts src/configuration-transfer.test.ts src/configuration-import.test.ts src/department-receipt-settings-api.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts scripts/demo-seed/seed.test.ts`
3. `pnpm --filter @waitron/core exec vitest run`; `pnpm --filter @waitron/provisioning exec vitest run src/venue-apply.test.ts src/venue-plan.test.ts src/cli.test.ts src/configuration-import.test.ts src/configuration-transfer.boundaries.test.ts src/fiscal-readiness-runner.test.ts src/fiscal-readiness.test.ts` (the readiness sale files the contribution's default: a new case "the readiness test sale files the fiscal contribution's default description");
   `pnpm --filter @waitron/venue-service exec vitest run src/department-receipts.test.ts src/configuration-transfer.test.ts`;
   `pnpm --filter @waitron/setup exec vitest run src/screens/venue-screen.test.ts src/server-fields.test.ts src/setup-app-first-fiscal.test.ts`, and `pnpm --filter @waitron/server exec vitest run src/first-fiscal-setup.e2e.test.ts` (it drives `setup-first-fiscal-api.ts`)
4. **Fiscal:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run` passes, and the fiscal
   pair passes unedited (`git diff --exit-code origin/main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`).
   A record suite whose filed description text changed is stop point 1.
5. `git grep -n "operationDescriptionFor\|operation_description\|operationDescription\|venue-defaults" -- apps packages scripts ':!**/drizzle/**' ':!**/test-fixtures/**'`
   prints only the `departments` column and its readers and writers, the department receipt's
   wire field (`packages/layouts/src/validate.ts:134` and the editor), the record inputs and their
   callers, the configured default, and the readiness runner's line. Read every other hit: an
   untyped place (a script, a JSON fixture, a SQL string) the compiler cannot find.
6. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Under each of the six `venue` headers:

```text
changed table departments.columnOrder
extra table departments.columns[operation_description]
```

Under the two `change-feed` headers also:

```text
changed trigger waitron_change_departments_update.when
```

If 5d left the venue's copy as a column of a table (not a settings field), add
`missing table <that table>.columns[operation_description]` and, if that table is a change source,
`changed trigger waitron_change_<that table>_update.when`, and say so in the PR; otherwise those lines
are a stop. Why: appendix §1.10 (a real column) and §6.5 (the venue copy deleted). By analogy with
vb4's simulated lines.

## Assertions that change, by design (rules §4)

- Tests asserting that a sale recorded with no description files the venue's text (the
  `operationDescriptionFor` fallback): deleted, since appendix §6.5 makes the input required; each
  listed in the PR.
- Setup tests asserting `operationDescription` in the venue request, plan, bundle or CLI output, and
  the refusal routing to the venue screen (`apps/setup/src/server-fields.ts:49-50`): removed with the
  field (§6.5).
- `apps/setup/src/screens/review-screen.test.ts:54, :428` and `configuration-preview-screen*.test.ts:17`
  drop the field from their samples.

## Stop points (beyond rules §5)

1. Any filed record's `DescripcionOperacion` text differs from the base in any suite: a test call
   was given different text from its venue fixture. (The readiness test sale is the one named
   exception, owner decision 1.)
2. 5d left the venue's copy somewhere item 3 does not name.
3. A product path reaches a record function without a description (a compile error outside tests
   and scripts that item 4 does not list).

## Needs

vb5 (the department receipt is on the department row). Outside: 5d (owner) — where the venue's copy
is. Nothing in this area waits for this PR; vb7–vb9 may land before it.

---

## Task 1: The department column, and the sale reads it

**Files:** schema; `department-receipts.ts`; `sale-operation-description.ts`; venue-service
`configuration-transfer.ts`.

- [ ] **Step 1:** Item 3's first check; `pnpm protection-list list --out <A>`.
- [ ] **Step 2: Write the failing tests** in `apps/server/src/sale-operation-description.test.ts`:
  "files the department's description from its column" (set the column, not the receipt text);
  "an empty column takes the configured default"; "with no default, an empty column refuses
  `department.operation_description_required`". `department-receipts.test.ts`: "the editor's
  description is stored in the column and read back"; "receipt text never holds the description".
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement** items 1 and 2; rebuild core.
- [ ] **Step 5: Run** — PASS. **Commit** `git commit -s -m "departments: the operation description is a column (FISCAL)"`.

## Task 2: No venue copy, and every record names its description

**Files:** items 3 and 4.

- [ ] **Step 1: Write the failing test** in `packages/core`: a type-level case that
  `recordSale(tx, backend, { …input without operationDescription })` fails to compile
  (`// @ts-expect-error`), and "records the description it is given".
- [ ] **Step 2: Run** `pnpm --filter @waitron/core exec vitest run` and typecheck — FAIL.
- [ ] **Step 3: Implement** items 3 and 4; the test calls each get their fixture's text.
- [ ] **Step 4: Run** Finish-line items 1–5 — PASS.
- [ ] **Step 5:** Docs; `pnpm protection-list list --out <B>`; `compare`; paste and mark.
- [ ] **Step 6: Commit** `git commit -s -m "sales: the operation description is a required input; the venue's copy goes (FISCAL)"`.
