# A1308 venue and box, PR vb5: a department's receipt design is part of the department, and its logo is a checked key — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). Implementers are
> dispatched as `subagent_type: "implementer"`.

**Goal:** `department_receipts` folds into `departments`: the receipt's texts become
`departments.receipt_text`, its logo becomes `departments.receipt_logo_image_id`, a key to
`media_images` that refuses deleting an image in use, and its printer-ready pictures become
`departments.receipt_logo_rasters`, kept until the appendix's §8.4 timing is run on the reference
micro PC.

**Architecture:** The receipt editor's and printing's API keeps today's shape (`DepartmentReceiptConfig`
with `logo` as the image's file name, `packages/shared/src/receipt-text.ts:3-11`): the store resolves
the file name to the image's id on save and joins `media_images` for the name on read. Media finds a
department's logo by that column instead of searching JSON. The operation description stays inside
`receipt_text` until vb6 moves it.

**Tech Stack:** Drizzle on `node:sqlite`, Vitest.

**Spec:** [tables-venuebox.md](../specs/2026-11-02-rationalisation/tables-venuebox.md) §1.10 (the
`receipt_text`, `receipt_logo_image_id`, `receipt_logo_rasters`, `receipt_updated_at` rows and "The
logo is a checked key…"), §5 (the `department_receipts` rows), §6.7, §8.4.

**Lands:** the lane (rules §6): the operation description, the one receipt field that reaches AEAT,
moves unchanged inside `receipt_text`.

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2).

## What it builds

1. **The picture cache stays (a decision of the plan review, 2026-11-08).** Appendix §8.4 asks for
   the logo's 80 mm drawing to be timed on the reference box, and drops the cache if it takes under
   about 20 ms. A developer Mac is faster than that box, so a lane's timing cannot show the box is
   under; the lane does not run it. `receipt_logo_rasters` is built here. **Owner, 2026-11-09:** "We
   can test it" — the owner runs the timing on the reference box; when the lane reaches vb5, the
   watcher asks the owner to run it (unless the owner has already posted a result). vb5 lands with the
   cache either way; dropping the cache would be its own later PR.
2. `departments` gains `receipt_text` (JSON, nullable: `printAddress`, `phone`, `email`,
   `headerSubtitle`, `footerMessage`, and until vb6 `operationDescription`), `receipt_logo_image_id`
   (nullable, foreign key `departments_receipt_logo_fk` → `media_images.id`, `on delete restrict`),
   `receipt_logo_rasters` (JSON `ReceiptLogoRasters`, nullable),
   `receipt_updated_at` (text, nullable). `department_receipts`
   (`packages/db/src/schema/venue-service/department-receipts.ts:6-21`) goes. A department with
   `receipt_updated_at` null has never saved a receipt (today: no row).
3. The store (`packages/venue-service/src/department-receipts.ts`) keeps its exported functions and
   their signatures (the module contract, `packages/module/src/module.ts:877-915`):
   `writeDepartmentReceipt` (`:279-300`) and `saveDepartmentReceiptSettings` (`:350-369`) resolve
   `receipt.logo` to `media_images.id` by file name in the same transaction (none found:
   `receipt.invalid { reason: "image_not_found", field: "logo" }`, what `logoNotFound()` throws
   today, `apps/server/src/department-receipt-api.ts:38-40`; the store throws it, and the route's
   own copy goes) and update the department row;
   `readDepartmentReceipt`, `readRetainedDepartmentReceipt`, `readPrintedDepartmentReceipt`,
   `readDepartmentLogoRasters`, `listDepartmentReceiptReadiness` (`:170-277`) read the columns and
   left-join `media_images` for `logo`. `receipt_text` never holds `logo`.
4. **The save re-checks the image's id as well as its revision** (fixes the backlog entry "A
   department's receipt logo save re-checks only the image's revision, not its id"): in
   `apps/server/src/department-receipt-api.ts:102-150`, the first transaction records the logo's
   `id` and `revision`; the second refuses `image.changed` when either differs
   (`:140-145` compares revision only today), as `recheckThemeLogo` does for themes.
5. **Media reads the column** (`packages/media/src/images.ts:112-117, :262-267, :618-624`;
   `image-edits.ts:77-97`): usages of kind `department_receipt` are departments whose
   `receipt_logo_image_id` is the image's id (inactive departments included, as today); a pixel edit
   refreshes `receipt_logo_rasters` on those rows. `deleteImage`'s in-use answer (`:422-438`) is
   unchanged and still runs first, so a person sees where the image is used; the key is the
   database's own refusal behind it.
6. **Backup verification:** `packages/media/src/backup-verification.ts:157-170` drops the
   `["department_receipts", "receipt", "logo"]` entry and checks instead that every non-null
   `departments.receipt_logo_image_id` names a `media_images` row with data.
7. **Configuration transfer:** `department_receipts` leaves the venue-service list
   (`packages/venue-service/src/configuration-transfer.ts:701`); `validateReceiptFields`
   (`:602-628`) reads `departments.receipt_text` and refuses a `logo` key in it, and any key that is
   not one of the six above; the key column is rewritten like every foreign key
   (`packages/provisioning/src/configuration-transfer.ts:662-665, :720`); media's tables travel in
   the same bundle (`packages/media/src/module.ts:12-24`). Format version +1 (rules §9).
8. Lists: classification (`packages/db/src/classification.ts:326`,
   `packages/venue-service/src/classification.ts:8`), exports, live dependencies
   (`apps/dashboard/src/api/live-queries.ts:503`, `packages/venue-service/src/dashboard/live-queries.ts:239`,
   `apps/dashboard/src/screens/department-receipt-editor.ts:265`, `packages/media/src/dashboard/live-queries.ts:11`)
   name `departments`.
9. Test helper `seedDepartmentReceipt(db: Database | Transaction, departmentId: string, receipt: DepartmentReceiptConfig, logoRasters?: ReceiptLogoRasters | null): Promise<void>`
   in `packages/db/src/testing/seed.ts` (resolves `logo` by file name; throws if no such image), and
   a committed fixture script `scripts/a1308/vb5-department-receipt-fixtures.mjs` (+ test) built on
   fk1's `runFoldCli` (`scripts/a1308/lib/fold-inserts.mjs`) with no fold rule and an `extra`
   callback that rewrites `X.insert(departmentReceipts).values({ departmentId: D, receipt: R[, logoRasters: L][, updatedAt: U] })`
   (with or without a trailing `.onConflictDoUpdate(…)`/`.onConflictDoNothing(…)`) into
   `await seedDepartmentReceipt(X, D, R, L)` (U dropped), adds the import, and reports anything else
   naming `departmentReceipts` as `path:line: reason`. Measured at `a086eedfb7`: 70 inserts in 42
   files, and 9 raw-SQL inserts in 5 files (`git grep -c "insert into department_receipts"`), which
   are hand edits, as are the raw updates and renames listed under Files.

## The backlog entries this PR finishes

Delete from `docs/backlog/architecture.md` "What A1308 retires" (`:1291-1300`) and their detail in
`docs/backlog/printers.md`:
- "A department's receipt logo save re-checks only the image's revision, not its id" (`printers.md:602-608`) — item 4.
- "A copied department receipt that names `logo` twice, or once more as `"logo\u0000"`…"
  (`printers.md:610-619`) — the logo leaves the JSON, and the import refuses a `logo` key (item 7).
- "Left open by #1261's review (W111)" (`printers.md:506-514`) — **edited, not deleted:** the
  department logo now has the database's refusal; the entry keeps only the theme logo
  (`custom_themes`, the devices area) and the copied phone and email limits.

## What it leaves out

| Left out | Owner |
| --- | --- |
| `operation_description` as a column; the venue's copy | vb6 (owner) |
| A theme logo as a checked key | devices area (`custom_themes`) |
| Whether the picture cache belongs to the image rather than the department (§8.4's second half) | menu and photos area; this PR keeps it on the department |
| The §8.4 timing on the reference micro PC, and dropping the cache if it shows under about 20 ms | the owner runs it, asked by the watcher when the lane reaches vb5 (owner, 2026-11-09); a drop is its own later PR |
| "Half of an older receipt test can no longer fail" | 4a |

## Files

Create: `scripts/a1308/vb5-department-receipt-fixtures.mjs`, `.test.mjs`.

Modify: `packages/db/src/schema/venue-service/service.ts`, `department-receipts.ts` (deleted),
`index.ts`; `packages/db/src/testing/seed.ts`; `packages/venue-service/src/department-receipts.ts`,
`configuration-transfer.ts`, `classification.ts`, `index.ts`, `dashboard/live-queries.ts`;
`packages/media/src/images.ts`, `image-edits.ts`, `backup-verification.ts`, `dashboard/live-queries.ts`;
`apps/server/src/department-receipt-api.ts`; `apps/dashboard/src/api/live-queries.ts`,
`screens/department-receipt-editor.ts`; the raw SQL that names the table outside inserts: `apps/server/src/receipt-print.test.ts:3581` (a
table rename used to make a read fail — re-point it at `departments`' receipt columns, stop point 3
if that cannot fail the same read) and its direct updates at `:3531` and `:3926`,
`till-sale.test.ts:3121`, `receipt-preview-api.test.ts:1029`; the test helpers `apps/server/src/testing/bill-venue.ts:179`,
`signed-in-till.ts:114-119`, `zone-offers.ts:126-131`, `theme-logo.ts:83-106` (its `UNTRUSTED_CASES`
table rename re-pointed to rename `departments`' column read — or the case deleted if it only proved
a JSON read can throw; ask, stop point 3); the bundle version constant
(`packages/provisioning/src/configuration-transfer.ts:123, :160`).

Guards: `scripts/schema-constraints.test.ts` (`:79`, foreign keys), `packages/db/src/schema/venue-service/migrations.test.ts`,
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (fold `department_receipts` into
`departments` with `madridWithFoldedTables`, `columns: { receipt: "receipt_text", logo_rasters: "receipt_logo_rasters", updated_at: "receipt_updated_at" }`,
then for each folded row take `logo` out of `receipt_text` into `receipt_logo_image_id` by matching
`media_images.filename` in the same phase; a capture row whose logo names no image is a stop).

Docs: `docs/developers/design-system.md` or `conventions-ui.md` lines that say the logo is a name in
the receipt JSON (`git grep -n "department_receipts" -- docs/developers`).

Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`.

## Size

| Part | Code | Tests |
| --- | --- | --- |
| Schema, store, helper | ~170 | ~60 (key refusal, resolve-by-name, never-saved reads) |
| Save re-check, media, backup check | ~80 | ~70 |
| Transfer validator, format, lists | ~50 | ~40 |
| Fixture script and test | ~90 | ~70 |
| Raw-SQL, raw-update, rename and logo fixture hand edits | — | ~110 |
| Madrid | ~30 | — |
| **Total** | **~420** | **~350** |

About 770 counted lines; the script's output is not counted. About 3 hours; split the dispatch
after Task 2.

## Finish line

1. (Removed: no timing in this PR, item 1.)
2. `pnpm exec vitest run scripts/a1308/vb5-department-receipt-fixtures.test.mjs`; the script re-run
   with `--write` on the branch's test files changes nothing.
3. `pnpm --filter @waitron/venue-service exec vitest run src/department-receipts.test.ts src/configuration-transfer.test.ts src/routes.test.ts`
4. `pnpm --filter @waitron/media exec vitest run src/images.test.ts src/image-edits.test.ts src/department-logo-uses.test.ts src/backup-verification.test.ts`
5. `pnpm --filter @waitron/server exec vitest run src/department-receipt-settings-api.test.ts src/department-receipt-preview-api.test.ts src/management-api.department-receipt-mount.test.ts src/management-api.accounts-and-receipt-config.test.ts src/receipt-print.test.ts src/receipt-preview-api.test.ts src/receipt-preview-drafts.test.ts src/invoice-document.test.ts src/till-api.receipt.test.ts src/bill-payments.test.ts src/configuration-transfer.test.ts src/configuration-import.test.ts src/themes-api.test.ts src/sale-operation-description.test.ts src/sale-operation-description.integration.test.ts src/till-sale.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts`
   (the two `sale-operation-description` suites because `readSaleOperationDescription` reads the
   operation description through the store this PR rewrites)
6. Root: `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/id-columns-are-references.test.ts scripts/starting-migrations.test.ts`
7. `git grep -n "departmentReceipts\|department_receipts" -- apps packages scripts ':!**/drizzle/**' ':!**/test-fixtures/**'`
   prints only the Madrid fold and `configuration-v1-*.json`.
8. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Under each of the six `venue` headers:

```text
missing index department_receipts.primary key(department_id)
missing table department_receipts
changed table departments.columnOrder
extra table departments.columns[receipt_text]
extra table departments.columns[receipt_logo_image_id]
extra table departments.columns[receipt_logo_rasters]
extra table departments.columns[receipt_updated_at]
extra table departments.foreignKeys[receipt_logo_image_id->media_images(id)]
```

Under the two `change-feed` headers also:

```text
missing trigger waitron_change_department_receipts_delete
missing trigger waitron_change_department_receipts_insert
missing trigger waitron_change_department_receipts_update
changed trigger waitron_change_departments_update.when
```

Why: appendix §1.10, §5 ("gained: FK `departments.receipt_logo_image_id` →
`media_images.id`, on delete restrict"; the side table's key to `departments` goes with it). By
analogy with vb4's simulated lines (same table, same kinds of change), not simulated separately.

## Assertions that change, by design (rules §4)

- Tests that store a department receipt whose `logo` names no image and assert how printing or
  media treats the dangling name: the state cannot be stored any more (appendix §1.10, the key).
  Each such case is deleted and listed in the PR; find them as the fixture script's and the key's
  failures, with the file and case name.
- `validateReceiptFields`' refusal field for a receipt row: `department_receipts.receipt` →
  `departments.receipt_text` in `packages/venue-service/src/configuration-transfer.test.ts`.

## Stop points (beyond rules §5)

1. The owner reports a reference-box timing under about 20 ms before this PR lands.
   The design's fallback is to drop `receipt_logo_rasters` and draw at print time (R6); do not fold
   it into this PR — finish with the cache, and the drop is planned as its own PR.
2. A Madrid capture receipt names a logo file with no `media_images` row in its phase.
3. `theme-logo.ts`'s untrusted-read cases (`:83-106`) depend on renaming `department_receipts` to
   make a read throw: ask whether to re-point or delete each.
4. The menu and photos area has changed `media_images`' key or file-name rules on `main`: re-read
   items 3, 5, 6 against it.

## Needs

vb4 (both change `departments`; one after the other). Outside: 4a (the venue receipt is gone), fk1's
`fold-inserts.mjs` and `madridWithFoldedTables` (or build them as vb4 says).

---

## Task 1: The columns, the key and the store

**Files:** schema, `packages/venue-service/src/department-receipts.ts`, `packages/db/src/testing/seed.ts`.

**Interfaces — Produces:** `seedDepartmentReceipt(…)` (above). Store signatures unchanged.

- [ ] **Step 1:** `pnpm protection-list list --out <A>`.
- [ ] **Step 2: Write the failing tests** in `department-receipts.test.ts`: "saves a logo chosen by
  file name as the image's id" (`select receipt_logo_image_id from departments` equals the image's
  id); "reads the logo back by its file name"; "refuses a logo naming no image" (`receipt.invalid`, reason `image_not_found`);
  "refuses deleting an image a department's receipt uses" (a raw `delete from media_images` throws a
  foreign-key error); "a department that never saved a receipt reads as today's no-row answer";
  "never writes a logo key into the receipt text".
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement** items 2, 3, 9 (helper); rebuild core.
- [ ] **Step 5: Run** — PASS. **Commit** `git commit -s -m "departments: the receipt design is a column set, and the logo a key to the image"`.

## Task 2: The fixture script

**Files:** `scripts/a1308/vb5-department-receipt-fixtures.mjs`, `.test.mjs`; the tests it rewrites;
the raw-SQL hand edits.

- [ ] **Step 1: Write the failing tests** on fixture strings: "rewrites an insert into
  seedDepartmentReceipt"; "drops updatedAt and a trailing onConflict"; "adds the import once";
  "reports a spread, an array of values and raw SQL"; "running twice changes nothing".
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/a1308/vb5-department-receipt-fixtures.test.mjs` — FAIL.
- [ ] **Step 3: Implement**; run it with `--write` over `git ls-files '*.test.ts' '**/testing/**' '**/test/**'`;
  commit its output alone (`git commit -s -m "Department receipt fixtures write through seedDepartmentReceipt (script output, A1308 vb5)"`).
- [ ] **Step 4:** Hand-edit the reported lines, the 9 raw inserts and the raw updates and rename under Files; run Finish-line items 3–5.
- [ ] **Step 5: Commit** `git commit -s -m "tests: department receipts seeded on the department row"`.

## Task 3: The save re-check, media, backups, transfer, lists

**Files:** `apps/server/src/department-receipt-api.ts`; the media files; the transfer file; lists;
Madrid; docs; backlog.

- [ ] **Step 1: Write the failing tests:** `apps/server/src/department-receipt-settings-api.test.ts`
  "refuses a save whose logo was deleted and uploaded again under the same name between the two
  checks" (`image.changed`); `packages/media/src/department-logo-uses.test.ts` "lists a department
  by its logo column"; `image-edits.test.ts` "a pixel edit refreshes the pictures of every
  department using the image"; `backup-verification.test.ts` "refuses a copy whose department logo
  names no image"; `configuration-transfer.test.ts` "refuses receipt text holding a logo key" and
  "refuses an unknown receipt text key".
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** items 4–8; bump the format.
- [ ] **Step 4: Run** Finish-line items 3–7 — PASS.
- [ ] **Step 5:** Backlog edits; `pnpm protection-list list --out <B>`; `compare`; paste and mark.
- [ ] **Step 6: Commit** `git commit -s -m "media: a department's logo is found by its key; the save rechecks the image's id"`.
