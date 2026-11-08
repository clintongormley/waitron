# A1308 slice 4a-ii — delete the venue's extra-menu list and the venue receipt table

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Remove two things the design deletes, each with everything only it used, in one pull request:
- the venue's list of extra menus (`location_catalogues`), which the owner dropped: "offered" is
  gone, no screen calls it, and sales run from menu periods and staff menus;
- the venue-wide receipt settings table (`tenant_receipts`), which department receipts replaced.

**Architecture:** Mostly deletion. Two tables go.
- `setVenueDefaultCatalogue` keeps its job and loses its "demote the old default to a member row" rule.
- `listAvailableProducts` keeps its signature and now reads every active menu, because there is no
  list any more.
- `listAccessibleCatalogues` is deleted. Nothing outside tests calls it, so it is dead under R5.
- The logo-picture helpers that lived beside the venue receipt store stay, in a file named for them.
- Core's starting migration is rebuilt with slice 1a's command.

**Tech Stack:** TypeScript, drizzle over SQLite (`node:sqlite`), Hono, Vitest 4, pnpm workspace.

**Spec:**
- [the approved design](../specs/2026-11-02-rationalisation/README.md) §5 U6, U8 and R5;
- [`tables-menu.md`](../specs/2026-11-02-rationalisation/tables-menu.md) §1.1, "The venue's list of
  extra menus goes, and `offered` with it", and §4;
- [`tables-devices.md`](../specs/2026-11-02-rationalisation/tables-devices.md) §2, §4 and §6 item 6;
- [`tables-venuebox.md`](../specs/2026-11-02-rationalisation/tables-venuebox.md) §6.8.

**Rules:** [the slice rules](2026-11-08-a1308-slice-rules.md) ("rules §n").

**Order:** [build order](2026-11-08-a1308-build-order.md), batch 1, lane 2, after slice 1a.
- This slice owns `location_catalogues`. The location sweep (slice 5) does not touch it, and this
  slice lands **before slice 5's S23 part** (coordinator, 2026-11-08). See stop point 1.
- It is independent of [4a-i](2026-11-08-a1308-4a-dropped-menu-features.md) (recipes); either may
  land first.

**Owner lands:** no (rules §6). Neither table feeds a sale, an invoice number or a fiscal hash.
- `location_catalogues` is read by no sale (`tables-menu.md` §1.1, citing
  `packages/venue-service/src/operations.ts:805-835`).
- `tenant_receipts` has no reader outside its own store (`tables-devices.md` §2).

## What it builds

1. **The venue's extra-menu list leaves.**
   - The table `location_catalogues` goes.
   - The routes `GET` and `POST /management-api/venue/catalogues` and
     `DELETE /management-api/venue/catalogues/:catalogueId` go.
   - The functions `listCataloguesForVenue`, `addCatalogueToVenue`, `removeCatalogueFromVenue`,
     `insertVenueCatalogue`, `resolveAccessibleCatalogueIds` and `listAccessibleCatalogues` go, with
     the type `VenueCatalogue`.
   - The dashboard client methods `listVenueCatalogues`, `addVenueCatalogue` and
     `removeVenueCatalogue` go, with the type `VenueCatalogueSummary`. None has a caller.
   - Catalogue provisioning stops writing a member row.
   - The demo seed stops adding its three extra menus to the list.
   - `PUT /management-api/venue/default-catalogue` and `setVenueDefaultCatalogue` stay. The owner
     kept the default, and R5 keeps the route.
2. **`listAvailableProducts` reads every active menu.** Same signature as before. Outside tests,
   only the demo seed (`apps/server/scripts/demo-seed/seed.ts:105`) and the test helper
   `apps/server/src/testing/party-venue.ts:163` call it. No till or sale path reads it.
3. **`tenant_receipts` leaves.**
   - These store functions go from `packages/layouts/src/receipt-store.ts`: `getReceipt`,
     `getPrintedReceipt`, `getStoredLogoRasters`, `putReceipt`, `getVenueReceiptSettings` and
     `putVenueReceiptSettings`.
   - `validateVenueReceiptSettings` (`packages/layouts/src/validate.ts:166-170`) and `DEFAULT_RECEIPT`
     (`packages/layouts/src/defaults.ts`) go too; once the store goes, nothing outside tests uses them.
   - These logo-picture helpers stay, in a file renamed `logo-rasters.ts`: `storedPictureMaxBytes`
     (`receipt-store.ts:43`), `readLogoRaster` (`:99`), `encodeLogoRaster` (`:108`) and
     `printableLogoRasters` (`:193`). Themes and department receipts use them.
4. **The configuration export format moves up by one** from `main`'s value when the slice is built
   (rules §9). The configuration export is the encrypted file one box writes and a new box imports at
   setup.
   - Its `location_catalogues` entry goes (`packages/db/src/configuration-transfer.ts:73`).
   - `tenant_receipts` was never in the export (`tables-devices.md` §2).
   - A file in the previous format is refused as `setup.configuration_outdated`.
5. **Housekeeping** (rules §9):
   - classification;
   - guards;
   - the mutation cost table;
   - the Madrid seed comparison;
   - developer docs;
   - the backlog entries this finishes.

## What it leaves out (and who takes it)

| Left out | Why | Taken by |
| --- | --- | --- |
| Recipes | Split out by the coordinator, 2026-11-08 | [4a-i](2026-11-08-a1308-4a-dropped-menu-features.md) |
| `menus.is_default` replacing `locations.catalogue_id`; `readVenue`'s `defaultCatalogueId` | The flag belongs to the location sweep. This slice keeps `locations.catalogue_id` as it is. | Slice 5 (S23 as amended) |
| Renaming `listAvailableProducts`, or deleting it once `products.catalogue_id` goes | Its meaning changes again when any menu can offer any product | Menu and photos (batch 2) |
| `assignCatalogueToVenue`, and the dashboard client's `setVenueDefaultCatalogue` method (it has no caller) | The owner kept the default | Slice 5 / menu and photos |
| `VenueReceiptSettings` (`packages/shared/src/receipt-text.ts:32`) | It is the base of `VenueReceiptConfig`, which department receipts use | — |
| The bench | No measured path reads either table | — (stated so the reviewer can disagree) |

## Decisions

- **D1. `listAvailableProducts` reads every active menu.**
  - Today it reads "the default plus every member row" (`packages/catalogue/src/operations.ts:1379-1388`,
    `:1441-1495`). With no list left, "the venue's menus" means every active menu.
  - For the demo seed this is the same set it reads today: provisioning adds the starter menu as a
    member (`packages/catalogue/src/provisioning.ts:127-130`), and the seed adds its other three
    (`apps/server/scripts/demo-seed/seed-catalogue.ts:264-266`).
  - The Madrid manifest agrees: it records 1 member row after provisioning and 4 after seeding
    (`madrid-before-move.manifest.json:368`, `:600`).
- **D2. A test helper replaces `listAccessibleCatalogues` where tests read the venue's menus.**
  - The demo-seed tests and one till-api test assert `{ id, name, isDefault }` lists. They are
    `seed.test.ts:260`, `:276`, `:331`, `:459`, `seed.integration.test.ts:119`,
    `seed-catalogue.test.ts:246`, `:360-366` and `till-api.test.ts:2195`.
  - They get `venueMenus(tx)` in `apps/server/src/testing/venue-menus.ts`. It returns every active
    catalogue, default first, then by name. That is the order the deleted function gave.
  - So their assertions stay unchanged. `src/testing/**` is outside coverage (`apps/server/vitest.config.ts:43`).
  - The catalogue package's own cases of the deleted function's order (`operations.test.ts:1462`,
    `:1477`, `:1495`, `:1527`) are deleted with it (D4), because their subject is the deleted
    function.
- **D3. Tests that only used `tenant_receipts` as a decoy.** Many receipt tests write a venue row
  and then assert the department's receipt wins. In those tests:
  - (a) Delete every line that writes, reads, restores or hides `tenant_receipts`.
  - (b) Keep every other assertion, even one that now holds trivially (for example
    `not.toContain("Venue subtitle")`).
  - (c) Delete an `it.each` arm whose only difference is hiding `tenant_receipts` (the `"venue"`
    arm). Delete an arm that hides both tables (`"both"`) too, because it is now the same as the
    `"department"` arm.
  - (d) Delete an assertion that reads `tenant_receipts` itself, or calls a deleted store function.
  - (e) **Owner's call, default shown** (`docs/backlog/printers.md:1125-1130`). Two choices:
    - default: in `receipt-print.test.ts`, "omits a corrupt explicit department picture without
      substituting the `tenant_receipts` logo" (`:3517`) keeps its corrupt-picture half, under the
      title "omits a corrupt explicit department picture";
    - the owner's alternative: delete the case, because the newer case for a department naming a
      logo whose pictures are bad already covers the rule.
    The pull request asks the owner and applies the default unless told otherwise.
- **D4. A test whose subject is a deleted thing is deleted; a test that only used one as set-up is
  re-pointed.**
  - Removing a deleted field from an expected object (`sellable`, from the removed GET route) is not
    a changed assertion.
  - Any other changed expected value is a stop (rules §5.3), unless it is listed under "Assertions
    that change, by design".
  - The pull request lists every deleted case by file and title.

## Cases deleted (D3, D4), by title

- `packages/catalogue/src/operations.test.ts`:
  - "lists products across the default AND other accessible catalogues, tagged" (`:1422`); a new
    case replaces it;
  - "lists accessible catalogues with the default flagged, default first" (`:1462`);
  - "sorts non-default accessible catalogues alphabetically after the default" (`:1477`);
  - "sorts the default first regardless of creation order" (`:1495`);
  - "returns [] from listAccessibleCatalogues for a venue with no accessible catalogue" (`:1527`);
  - "removes a member catalogue from the venue's menu list" (`:1533`);
  - "removeCatalogueFromVenue is a no-op for a catalogue that is not a member" (`:1546`);
  - "removeCatalogueFromVenue never removes the default (it is not a member row)" (`:1560`);
  - "lists every tenant catalogue with sellable + default flags" (`:1574`);
  - "setVenueDefaultCatalogue is idempotent when the catalogue is already the default" (`:1622`; it
    counts member rows directly);
  - the `addCatalogueToVenue` row of the not-found table at `:1638`.
- `apps/server/src/catalogue-api.test.ts`:
  - "GET lists every tenant catalogue with sellable + default flags (200)" (`:1361`);
  - "POST adds a catalogue to the venue's menu list (204)" (`:1377`);
  - "DELETE removes a catalogue from the venue's menu list (204)" (`:1389`);
  - "POST unauthenticated → 401" (`:1419`);
  - "POST as a staff-role session → 403 authorization.not_permitted" (`:1428`);
  - "POST with a missing/non-string catalogueId → management.request_invalid 400" (`:1437`);
  - "POST with a valid-but-nonexistent catalogueId → catalogue.not_found 404" (`:1455`);
  - "POST with a malformed-uuid catalogueId → shared.invalid_id 400" (`:1473`).
- `apps/server/src/catalogue-api.full-manifest.test.ts:342-349`: the POST and DELETE refusals.
- `apps/dashboard/src/api/client.test.ts:615-650`: the three venue-catalogue cases.
- `packages/db/src/schema/location-catalogues.test.ts` (the whole file).
- `packages/layouts/src/receipt-store.test.ts`:
  - every case that calls a deleted store function;
  - what remains moves to `logo-rasters.test.ts`, or the file is deleted if nothing remains.
- `packages/layouts/src/department-receipt-validation.test.ts:125-170`: the
  `validateVenueReceiptSettings` cases.
- D3(c) arms:
  - `receipt-print.test.ts:3560`, the `"venue"` arm;
  - `receipt-presentation.test.ts:210`, the `"venue"` and `"both"` arms;
  - `till-sale.test.ts:3077` ("keeps surviving fields when the %s optional source cannot be read"),
    the `"venue"` and `"both"` arms;
  - every other arm the D3 file list turns up.

## Assertions that change, by design

- **`packages/catalogue/src/operations.test.ts`, the `setVenueDefaultCatalogue` cases.** They read
  through the deleted `listAccessibleCatalogues`.
  - "setVenueDefaultCatalogue changes the default and keeps the old default sellable" (`:1594`)
    becomes "setVenueDefaultCatalogue moves the default and leaves the old default an active menu".
    - Its set-up drops `addCatalogueToVenue`.
    - It asserts `(await readVenue(tx)).defaultCatalogueId === day.id`.
    - It asserts `house` still reads `active: true` from `listCatalogues(tx)`.
  - "setVenueDefaultCatalogue sets the default when the venue had none" (`:1609`) asserts
    `defaultCatalogueId === house.id`.
- **`apps/server/src/catalogue-api.test.ts:1402`**, "PUT default-catalogue sets the default and keeps
  the old default sellable (204)", becomes "PUT default-catalogue sets the default (204)". It reads
  `locations.catalogue_id` (expect `day`) instead of the removed GET route.
- **`apps/server/src/till-api.test.ts:2193`**, "reads the venue's accessible menus and product
  values", reads `menus` through `venueMenus` (D2). Its expected values are unchanged.
- **`packages/catalogue/src/provisioning.test.ts:158`** counts `catalogues` instead of
  `location_catalogues`. It still expects `[{ count: 1 }]`: the initial menu is reused, not
  duplicated.
- **`packages/layouts/src/index.test.ts:9-17`**, "exports the receipt-trim surface", changes.
  - It drops `expect(api.DEFAULT_RECEIPT).toBeDefined()` (`:10`), because deleting `defaults.ts`
    breaks it.
  - It drops `getPrintedReceipt` and `getStoredLogoRasters` (`:12-13`).
  - It gains `expect("getPrintedReceipt" in api).toBe(false)`, `expect("getStoredLogoRasters" in api).toBe(false)`
    and `expect(typeof api.printableLogoRasters).toBe("function")`.
- **`apps/server/src/configuration-transfer.test.ts:6770-6860`**, "transfers department receipt
  maps and pictures with remapped ids and no venue defaults", loses the `global` and `pictures`
  result keys and their expectations (D3 d). The department expectations are unchanged.
- No other expected value may change.

## Files

Line numbers are at this plan's base (`main` d908a5b8d4 plus docs commits). Re-find each one by its
identifier after slice 1a or 4a-i.

**Create:** `apps/server/src/testing/venue-menus.ts` (D2).

**Delete:**
- `packages/db/src/schema/location-catalogues.ts`, `location-catalogues.test.ts`
- `packages/db/src/schema/tenant-receipts.ts`
- `packages/layouts/src/defaults.ts`

**Rename:** `packages/layouts/src/receipt-store.ts` → `logo-rasters.ts` (and its test, see above).

**Modify — schema, lists, guards:**
- `packages/db/src/schema/index.ts:37`, `:44`
- `packages/db/src/index.ts:176`, `:191`
- `packages/db/src/classification.ts:115`, `:147`
- `packages/db/src/configuration-transfer.ts:73`
- `packages/db/src/schema/tenants.ts:86-87`: cut the comment that names `location_catalogues`.
- `packages/db/mutation-costs.json:87`, `:117`
- `scripts/schema-constraints.test.ts:190-191`, `:829`
- Generated by `pnpm --filter @waitron/server migration-baseline rebuild --set core`:
  `packages/db/drizzle/0000_baseline.sql`, `packages/db/drizzle/meta/*` and
  `scripts/migration-baseline-epoch.json`.
- `packages/db/triggers/core.sql` is not changed: no hand-written trigger names either table.

**Modify — production code:**
- `packages/catalogue/src/operations.ts`:
  - the import at `:27`;
  - `setVenueDefaultCatalogue` (`:1322-1338`);
  - delete `:1340-1388`;
  - delete `VenueCatalogue`, `listCataloguesForVenue` and `listAccessibleCatalogues` (`:1407-1439`);
  - `listAvailableProducts` (`:1441-1495`).
- `packages/catalogue/src/index.ts:20`, `:30`, `:33`, `:39-40`
- `packages/catalogue/src/provisioning.ts:5`, `:127-130`
- `apps/server/src/catalogue-api.ts:19`, `:67`, `:95`, `:1276-1303`
- `apps/server/scripts/demo-seed/seed-catalogue.ts:5`, `:264-266`
- `apps/dashboard/src/api/client.ts:502-505`, `:3135-3145`
- `packages/layouts/src/index.ts:2`, `:9`, `:77-85`
- `packages/layouts/src/validate.ts:166-170`
- `packages/layouts/src/theme-store.ts:9`
- `packages/layouts/src/theme-configuration.ts:4`
- `apps/server/src/receipt-logo.ts:28`: delete the clause "ready for `putReceipt`". The comment
  becomes "The logo as each paper prints it. Outside any transaction." It then makes no new claim
  about its callers.
- `packages/provisioning/src/configuration-transfer.ts:123`, `:160`, `:473-476`

**Modify — tests:** the cases above, plus:
- `apps/server/src/testing/zone-offers.ts:187-196`
- `apps/server/src/testing/clear-provision-fixture.ts:51`
- `apps/server/src/order-portions.counter.test.ts:55-62`, `order-portions.filing.test.ts:83-90`,
  `order-portions.lifecycle.test.ts:55-62`
- `apps/server/src/catalogue-api.test.ts:1347-1356` (the `beforeEach`)
- `apps/server/src/till-api.test.ts:58`, `:71`, `:214`, `:2195`
- `apps/server/scripts/demo-seed/seed.test.ts`, `seed.integration.test.ts` and
  `seed-catalogue.test.ts` (D2 imports)
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:22-40`
- `apps/dashboard/src/dashboard-app.a11y.test.ts:79-81`, `dashboard-app.disk-stop.test.ts:74`,
  `dashboard-app.help.test.ts:73`, `dashboard-app.test.ts:201`. These are stale `listVenueCatalogues`,
  `getReceipt` and `putReceipt` mocks; `git grep -n -w -E 'getReceipt|putReceipt' -- apps/dashboard/src/api/client.ts`
  prints nothing.
- The D3 files:
  - in `apps/server/src/`: `bill-payments.test.ts`, `configuration-transfer.test.ts`,
    `department-receipt-preview-api.test.ts`, `invoice-choice-delivery.test.ts`,
    `invoice-document.test.ts`, `invoice-email-contact.test.ts`,
    `management-api.accounts-and-receipt-config.test.ts`,
    `management-api.department-receipt-mount.test.ts`, `receipt-presentation.test.ts`,
    `receipt-preview-api.test.ts`, `receipt-preview-drafts.test.ts`, `receipt-print.test.ts`,
    `till-api.receipt.test.ts`, `till-api.test.ts`, `till-sale-integrated.db.test.ts`,
    `till-sale.test.ts`;
  - in `packages/media/src/`: `department-logo-uses.test.ts`, `images.test.ts`;
  - `packages/layouts/src/index.test.ts`.
- The format files:
  - `apps/server/src/configuration-import.test.ts:48`, `:200-204`;
  - `apps/server/src/configuration-transfer.test.ts:389`, `:5481`;
  - `packages/provisioning/test/configuration-bundle.ts:5`;
  - `packages/provisioning/src/configuration-transfer.privacy-contact.test.ts:79`;
  - `packages/provisioning/src/configuration-transfer.boundaries.test.ts:104`.

**Modify — docs:**
- `docs/developers/design-system.md:5840`
- `docs/developers/conventions-data.md:1821-1824`
- `docs/backlog/kitchen.md:414`
- `docs/backlog/architecture.md:1247-1249`, `:1276`, `:1282`, `:1288-1290`
- `docs/backlog/catalogue.md:538-553`
- `docs/backlog/printers.md:1125-1130`

## Size

Estimated by reading, not by building.

| What | Lines |
| --- | --- |
| **Counted:** production code written or changed by hand (re-scoped list, default setter, imports after the rename, comments, format) | about 40 |
| **Counted:** tests written or changed by hand (new cases, `venueMenus`, re-pointed set-ups, D3 arm edits, Madrid, format rows) | about 160 |
| **Counted:** docs and backlog | about 20 |
| **Counted total** | **about 220** (cap about 1,000) |
| Not counted: pure deletions (schema files and tests about 120; catalogue functions and their tests about 450; routes and their tests about 180; layouts store and its test about 700; D3 decoy lines about 300; client about 30) | about 1,800 |
| Not counted: generated files | — |

**Time:** about 2.5 hours, across about 60 files. The D3 receipt tests are the slowest part: each
file needs reading arm by arm.

## Finish line

1. The leftover search (Task 3, step 1) prints only the lines listed there.
2. `pnpm --filter @waitron/server exec vitest run src/configuration-import.test.ts` passes. Its case
   "refuses A1308 4a-ii pre-menu-list-removal export" refuses the previous format as
   `setup.configuration_outdated`.
3. `pnpm --filter @waitron/catalogue exec vitest run src/operations.test.ts` passes, including:
   - "lists the products of every active menu, with no venue list";
   - "lists every active menu's products when the venue has no default".
4. From `apps/server`, `pnpm protection-list compare --old <base> --new <tip> --report <file>` prints
   exactly "Expected protection-list difference".
5. On a dev stack (`wa-wt demo <worktree>`), `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/management-api/venue/catalogues`
   prints `404`. Before this slice it printed `401` without a session (`catalogue-api.test.ts:1419`
   asserts the 401 for POST).
6. CI is green on the head commit. The pull request's first line reads: "Every venue is reset: core;
   backups and exports from before this cannot be restored or imported."

## Expected protection-list difference

The protection list is slice 0's tool. It builds the databases from the migrations and lists every
protection in them. How it works: `docs/developers/testing-guide.md#the-protection-list`.

The lines below are predicted by reading `apps/server/scripts/protection-list/compare.ts:66-246`
and `packages/db/drizzle/0000_baseline.sql:998-1004` and `:1125-1130`. They were not run.
- `node.db` prints nothing.
- `venue.db` prints one `DIFF` header for each of six builds: compositions `fiscal-verifactu` and
  `fiscal-none`, at phases `sql-only`, `migrated` and `change-feed`.

**In each of the six builds:**

```text
missing index location_catalogues.primary key(location_id,catalogue_id)
missing table location_catalogues
missing table tenant_receipts
```

**In each of the two `change-feed` builds, also:**

```text
missing trigger waitron_change_location_catalogues_delete
missing trigger waitron_change_location_catalogues_insert
missing trigger waitron_change_location_catalogues_update
missing trigger waitron_change_tenant_receipts_delete
missing trigger waitron_change_tenant_receipts_insert
missing trigger waitron_change_tenant_receipts_update
```

Why each line:
- Both tables are deleted (README U6).
- Their foreign keys and `tenant_receipts_singleton_ck` belong to the table object, so they print no
  separate line (`tables-menu.md` §5; `tables-devices.md` §5).
- `tenant_receipts`' primary key is an integer row id (`0000_baseline.sql:1126`), so it has no index
  line.
- The change-feed triggers follow their tables. The change feed is the set of triggers that tell the
  dashboard a row changed.
- No column of a surviving table changes, and no surviving foreign key points at either table.

Any other line is a stop (rules §5.2).

## Stop points (beyond rules §5)

1. **Slice 5 got there first.** Stop and ask if slice 5 (the location sweep) has already done either
   of these:
   - changed `readVenue` (`packages/db/src/venue.ts`), for example its `defaultCatalogueId` or where
     it reads it from;
   - dropped or changed `location_catalogues`.
2. **D1's re-scope changes another test.** Stop if a test outside the deleted cases fails after the
   re-scope, because its expected product list changes when an active menu that was not on the venue
   list now appears. Do not re-point its expectation. The fallback is "the default menu only"; the
   watcher confirms it before you take it.
3. **A `seed.madrid-baseline.test.ts` failure outside this slice.** Stop if it fails for anything
   other than the two tables removed here.
4. **A copy of `listAccessibleCatalogues`' order is not unchanged.** Stop if `venueMenus` cannot
   reproduce an existing seed or till-api expectation without change.

## Global Constraints

- Rules §1–§9 apply. Never edit generated migration files by hand. Rebuild core after every schema
  change, in the same task.
- No backwards-compatibility code: venues are reset (CLAUDE.md §3).
- Every commit uses `git commit -s`.
- Work in your own worktree: `python3 ~/workspace/tools/worktree.py new waitron a1308-4a-ii-menu-list-and-venue-receipt --headless`.
- Comments: delete a comment that names the member list or `tenant_receipts`. Do not reword one into
  a new claim (CLAUDE.md §1).
- Run focused tests locally. CI runs the package suites (CLAUDE.md §2).

## Review Focus

1. **A venue with menus but no default** (a box before setup picks one). `listAvailableProducts`
   must still list every active menu's products. Covered by Task 1: "lists every active menu's
   products when the venue has no default".
2. **A deactivated menu's products** must not appear. Covered by the kept case "hides every product
   of a deactivated catalogue" (`operations.test.ts:1682`), and by Task 1's new case.
3. **Setting the default to a menu that does not exist** still refuses with `catalogue.not_found`,
   which is a 404 through the route. The `operations.test.ts` case "refuses an unknown catalogue
   with catalogue.not_found" and `catalogue-api.test.ts:1464` both stay unchanged.
4. **A department receipt is unaffected** when no venue receipt row can exist any more. Its printed
   text, logo and diagnostics must be the same as today. Covered by the D3-kept assertions in
   `receipt-print.test.ts`, `receipt-presentation.test.ts` and `till-sale.test.ts`.
5. **A configuration file from before this slice** is refused as outdated, not as an invalid
   request (rules §9). Covered by Task 1's format row.

---

### Task 0: Record the base

- [ ] **Step 1:** Make a throwaway worktree of the base and run `pnpm install` in it. From its
  `apps/server`, run `pnpm protection-list list --out <empty absolute dir A>` (rules §3).
- [ ] **Step 2:** Save the base hits:
  `git grep -n -E 'location_catalogues|locationCatalogues|tenant_receipts|tenantReceipts|listCataloguesForVenue|addCatalogueToVenue|removeCatalogueFromVenue|resolveAccessibleCatalogueIds|listAccessibleCatalogues|venue/catalogues|VenueCatalogue|getPrintedReceipt|getVenueReceiptSettings|putVenueReceiptSettings|getStoredLogoRasters|putReceipt|DEFAULT_RECEIPT|validateVenueReceiptSettings' -- ':!docs' > <scratch>/before.txt`.
  Add `git grep -n -w getReceipt -- ':!docs'` to it.

### Task 1: The venue's extra-menu list

**Interfaces — Produces:**
- `listAvailableProducts(tx): Promise<{ products: AvailableProduct[]; invoiceLocales: string[] }>`.
  - Same signature as today.
  - It reads the active, available, top-level products of every active catalogue, ordered as today
    (`catalogues.name, products.createdAt, products.id`).
  - It reads `invoiceLocales` from `readVenueInvoiceLocales(tx)`.
- `setVenueDefaultCatalogue(tx, catalogueId): Promise<void>`. It refuses an unknown menu with
  `catalogue.not_found`, then calls `assignCatalogueToVenue`. There is no demotion.
- `venueMenus(tx: Transaction): Promise<{ id: string; name: string; isDefault: boolean }[]>` in
  `apps/server/src/testing/venue-menus.ts`. It returns every active catalogue, default first, then by
  name.
- Removes: everything listed in "What it builds", item 1.

- [ ] **Step 1: Failing tests** in `operations.test.ts`.
  - "lists the products of every active menu, with no venue list" replaces `:1422`.
    - Set up three menus with one product each: Main (made default), Lunch (never added to anything)
      and Old (deactivated).
    - Expect the listed names `["Set menu", "Steak"]`, with `catalogueName` `"Lunch"` and `"Main"`.
    - Expect nothing from Old.
  - "lists every active menu's products when the venue has no default".
    - Set up two active menus with one product each and no `assignCatalogueToVenue`.
    - Expect both products.
  - Replace the `setVenueDefaultCatalogue` cases' reads, as listed under "Assertions that change, by
    design".
  - Run `pnpm --filter @waitron/catalogue exec vitest run src/operations.test.ts`. Expected: FAIL.
    Lunch is not in today's list, and with no default today returns `[]`.
- [ ] **Step 2: Implement** the interfaces above.
  - Delete the removed functions and their exports.
  - Delete the member insert in `provisioning.ts:127-130`. Remove its import if it becomes unused.
  - Delete the three routes and their comment in `catalogue-api.ts:1276-1303`. The PUT route stays.
  - Delete the three calls in `seed-catalogue.ts:264-266`.
  - Delete the client methods and `VenueCatalogueSummary`.
- [ ] **Step 3: Re-point and delete tests.**
  - Delete the cases listed under "Cases deleted".
  - Make the changes listed under "Assertions that change, by design".
  - Add `venueMenus`, and swap the D2 call sites to it.
  - `till-api.test.ts:214`: drop `addCatalogueToVenue(tx, cat2.id)`. Its expectation at `:2198-2203`
    is unchanged, because Happy Hour is active.
  - `order-portions.{counter,filing,lifecycle}.test.ts`: read the default menu as
    `(await readVenue(tx)).defaultCatalogueId` instead of selecting from `locationCatalogues`.
  - `catalogue-api.test.ts`: the `beforeEach` drops its `location_catalogues` delete.
  - `zone-offers.ts`: `topLevelProducts` joins `catalogues` with `eq(catalogues.active, true)` and
    `isNull(products.parentId)`, ordered by `products.id`.
  - `clear-provision-fixture.ts:51`: drop the table name.
  - Dashboard: drop the stale mocks.
- [ ] **Step 4: Format bump** (rules §9). Set the value to `main`'s plus one at:
  - `packages/provisioning/src/configuration-transfer.ts:123`, `:160`, `:473` and `:476`;
  - `packages/provisioning/test/configuration-bundle.ts:5`;
  - `configuration-transfer.privacy-contact.test.ts:79`;
  - `apps/server/src/configuration-transfer.test.ts:389` and `:5481`.

  In `configuration-import.test.ts`:
  - `:48` takes the new value;
  - add the row `["A1308 4a-ii pre-menu-list-removal export", { version: <main's value> }]`;
  - the "future version" row, and `configuration-transfer.boundaries.test.ts:104`, take one above the
    new value.
- [ ] **Step 5: Schema and lists.**
  - Delete `location-catalogues.ts`, `schema/index.ts:37`, `index.ts:176`, `classification.ts:115`,
    `configuration-transfer.ts:73`, `schema-constraints.test.ts:190-191` and `mutation-costs.json:87`.
  - Cut the comment at `tenants.ts:86-87`.
  - Madrid: add `const REMOVED_TABLES_WITH_ROWS = ["location_catalogues"]`, commented "dropped by
    A1308 4a-ii; the seed wrote its rows". The per-phase loop deletes it from `expected[phase].tables`
    and from `phases[phase]`, without `REMOVED_TABLES`' zero-row checks.
- [ ] **Step 6: Rebuild and run.**
  - Rebuild core: `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
  - From the root:
    `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts scripts/classification-complete.test.ts scripts/mutation-shard.test.mjs scripts/live-subscriptions.test.ts`.
  - Then `pnpm --filter @waitron/catalogue exec vitest run` and
    `pnpm --filter @waitron/provisioning exec vitest run`.
  - Then `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts src/catalogue-api.full-manifest.test.ts src/till-api.test.ts src/order-portions.counter.test.ts src/order-portions.filing.test.ts src/order-portions.lifecycle.test.ts src/configuration-import.test.ts src/configuration-transfer.test.ts scripts/demo-seed`.
  - Every file that `git grep -l -E 'listAvailableProducts|offerProducts|zone-offers|party-venue' -- apps/server/src`
    prints is part of stop point 2's check. Run them in batches, sized by free memory.
  - Each run must print a `Tests` count and no failure.
- [ ] **Step 7:** Commit `-s -m "Remove the venue's extra-menu list; listing reads every active menu"`.

### Task 2: `tenant_receipts`

**Interfaces — Produces:** `packages/layouts/src/logo-rasters.ts`. It exports `storedPictureMaxBytes`,
`readLogoRaster`, `encodeLogoRaster` and `printableLogoRasters`, with today's signatures.
`@waitron/layouts` still exports `encodeLogoRaster` and `printableLogoRasters`.

- [ ] **Step 1: Failing test.** Make the `index.test.ts` change listed under "Assertions that change,
  by design". Run `pnpm --filter @waitron/layouts exec vitest run src/index.test.ts`. Expected: FAIL,
  because `getPrintedReceipt` is still exported.
- [ ] **Step 2: Rename and delete.**
  - `git mv` the file.
  - Delete the six store functions, and the private helpers only they use: `DOCUMENT`,
    `boundedString`, `TRIM`, `storedPicture` and `parseTrim`. `PAPER_WIDTHS` stays, because
    `printableLogoRasters` uses it.
  - Delete `validateVenueReceiptSettings`, `defaults.ts` and the `DEFAULT_RECEIPT` export.
  - Fix the imports in `index.ts`, `theme-store.ts:9` and `theme-configuration.ts:4`.
  - Edit the comment at `receipt-logo.ts:28`.
- [ ] **Step 3: Schema and lists.**
  - Delete `tenant-receipts.ts`, `schema/index.ts:44`, `index.ts:191`, `classification.ts:147`,
    `schema-constraints.test.ts:829` and `mutation-costs.json:117`.
  - Add `"tenant_receipts"` to the Madrid test's `REMOVED_TABLES`. It has 0 rows in every phase
    (manifest `:233`).
- [ ] **Step 4: Apply D3** to every file that
  `git grep -l -E 'tenant_receipts|tenantReceipts|getPrintedReceipt|getStoredLogoRasters|putReceipt' -- apps packages`
  or `git grep -l -w getReceipt -- apps packages` prints.
  - `configuration-transfer.test.ts`: drop the inserts at `:2223` and `:6808`. Keep
    `not.toHaveProperty("tenant_receipts")` at `:2233` and `:6831`, because both still pass.
  - Apply D3(e) as the default.
- [ ] **Step 5: Rebuild and run.**
  - Rebuild core, then run the root guards from Task 1.
  - Run `pnpm --filter @waitron/layouts exec vitest run`.
  - Run `pnpm --filter @waitron/media exec vitest run src/department-logo-uses.test.ts src/images.test.ts`.
  - Run `pnpm --filter @waitron/server exec vitest run` on the D3 file list, plus
    `scripts/demo-seed/seed.madrid-baseline.test.ts`.
  - Each run must print a `Tests` count and no failure.
- [ ] **Step 6:** Commit `-s -m "Remove tenant_receipts and its store; department receipts are the only receipt trim"`.

### Task 3: Leftovers, protection list, docs, backlog

- [ ] **Step 1: Leftover search.** Run Task 0 step 2's commands again. The only lines they may print
  are these:
  - `not.toHaveProperty("tenant_receipts")` in `configuration-transfer.test.ts` (D3 b);
  - the Madrid test's removal lists;
  - the captured fixtures, which stay as they are: `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json`
    and `packages/country-es/test-fixtures/demo/madrid-before-move.*`;
  - `docs/backlog/printers.md:502`. It describes a probe from 2026-10-01; it is a historical record.

  Anything else is a leftover. Remove it, or stop if it is outside this plan's files (rules §5.5).
- [ ] **Step 2: Protection list.** From `apps/server`, run
  `pnpm protection-list list --out <empty absolute dir B>`, then
  `pnpm protection-list compare --old <A> --new <B> --report <absolute file>`. Paste the report into
  the pull request and mark each line against the prediction. Then remove the throwaway worktree.
- [ ] **Step 3: Developer docs.** In `design-system.md:5840` and `conventions-data.md:1821-1824`,
  give the new format number. `conventions-data.md` also says the export no longer carries the
  venue's menu list.
- [ ] **Step 4: Backlog** (CLAUDE.md §6).
  - In `architecture.md`'s "What A1308 retires", delete:
    - "The venue's menu list is read by no sale" (`:1247-1249`);
    - "`location_catalogues`: decide the remaining UPDATE restriction" (`:1276`);
    - "`tenant_receipts`: decide the remaining DELETE restriction" (`:1282`).
  - Delete `catalogue.md:538-553`.
  - "Half of an older receipt test can no longer fail" (`architecture.md:1288-1290`,
    `printers.md:1125-1130`) is the owner's call (D3 e):
    - if the owner confirms the default before landing, delete both entries;
    - otherwise, reword both to say that 4a-ii kept only the corrupt-picture half, and that whether
      to delete the case stays the owner's call.
  - `kitchen.md:414`: append "**<date>:** A1308 4a-ii moved it to version <n>."
- [ ] **Step 5:** Commit `-s -m "docs: A1308 4a-ii retires the venue's menu list and tenant_receipts"`.
  Then run `/finish-branch` with this plan's path. In the pull request:
  - the first line is the reset sentence;
  - the body lists the protection-list report, every deleted case, every D3(c) arm, and the D3(e)
    question to the owner.

## Other plans that name these (docs only; not edited here)

- **A1301 plan** ([plan](2026-11-01-a1301-remove-location.md)): `:45`, `:1089`, `:2173-2176`, `:2194`,
  `:2214-2216`, `:2231`, `:2247-2272`, `:2299`, `:2320-2325`, `:3967`, `:4035`, `:4560`.
- **A1301 design** ([design](../specs/2026-11-01-a1301-remove-location-design.md)): `:35-37`, `:137`,
  `:429`, `:585`.
- What they name: `location_catalogues`, the venue-catalogue routes, or the deleted functions. Most
  describe landed slices (S2, S5, S19).
- What changes for S23: it must now find `location_catalogues` already gone, as the coordinator's
  ordering requires. Slice 5's plan should say so.
- **`tables-menu.md` §1.1** says `listAvailableProducts` and `listAccessibleCatalogues` go. The
  coordinator decided on 2026-11-08:
  - `listAccessibleCatalogues` goes;
  - `listAvailableProducts` stays, re-scoped. Outside tests it has two callers, and the appendix
    counted only demo scripts.

## Questions for the watcher

- **Q1.** `listAvailableProducts` stays, reading every active menu (D1). Outside tests only the demo
  seed (`seed.ts:105`) and the test helper `party-venue.ts:163` call it. No till or sale path reads
  it. The default is to keep it re-scoped. The fallback if stop point 2 fires is "the default menu
  only".
- **Q2 (for the owner).** D3(e): keep only the corrupt-picture half of the older receipt test, or
  delete the case. This is the owner's call; the default is shown above.
