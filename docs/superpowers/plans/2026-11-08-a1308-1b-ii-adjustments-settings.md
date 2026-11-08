# A1308 slice 1b-ii: documents in the configuration copy, and the adjustments document — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry settings documents through a configuration export and import, and move the venue's
comp limit (`adjustment_settings`) into the `settings` row `adjustments`, end to end: the server's
reader, the routes, the dashboard screen and its live updates, the copy, and backup verification.

**Architecture:** A configuration export gains a top-level `settings` object, `{ <key>: { version,
doc } }`, holding every document whose definition says `transfers: true` and that the venue has
saved. An import checks each one with its module's own definition before anything is written, then
replaces exactly those modules' rows, with the revision reset and no saver named. The adjustments
module declares its document with `defineSettingsDocument` and keeps its public functions
(`readAdjustmentSettings`, `saveAdjustmentSettings`), which now carry a revision.

**Tech Stack:** TypeScript, Drizzle on `node:sqlite`, Hono, Lit (dashboard), Vitest (Node and browser
mode).

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 "Shared tables", §5 U2
("Configuration export"), R4; [tables-venuebox.md](../specs/2026-11-02-rationalisation/tables-venuebox.md)
§2.4 "Configuration export/import" and "Backup verification";
[tables-fiscal.md](../specs/2026-11-02-rationalisation/tables-fiscal.md) §2 (the `adjustments`
document) and §5 (the `adjustment_settings` row). Slice rules: [rules](2026-11-08-a1308-slice-rules.md)
("rules §n").

**Needs:** slice 1b-i ([plan](2026-11-08-a1308-1b-settings-table.md)) landed. Every name in its
"Interfaces fixed by this slice" block is used here as written, and its no-upgrade decision holds:
a document's version stays 1 and nothing converts an older one.

**Format number.** This slice moves the configuration export format to **N = main's value + 1**
(rules §9). At HEAD `a086eedfb7` main's value is 10, but slice 4a also bumps it, so the builder reads
`version: <n>` in `packages/provisioning/src/configuration-transfer.ts:123` on the base and writes
N everywhere below; "N + 1" is the "future version" a test refuses. No literal number is written
from this plan.

**Owner lands:** no (rules §6). Read, not run: the comp limit and approver list are read in one
place, `apps/server/src/adjustments-apply.ts:1093`, and passed to `evaluateComp` as `billLimit`
(`:1103`), which decides only whether someone must approve a comp
(`packages/adjustments/src/policy.ts:162-203`). They are not written into a sale, an invoice number,
a fiscal record or any value hashed into the chain.

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2; the export format also moves to N).

---

## What it builds

1. The `adjustments` settings document (tables-fiscal §2): `maxBillComp`, whole cents or null (no
   limit), must be above 0; `billApproverRoles`, a non-empty list of distinct roles, default
   `["manager", "admin"]`. Version 1, `transfers: true`. Its CHECKs become its checker
   (tables-fiscal §5).
2. The adjustments module reads and saves through it; the settings routes carry `revision`; a stale
   save is answered 409 `settings.out_of_date`, and a stored document the code refuses 500
   `settings.invalid`.
3. The limit form on the reasons screen sends the revision its draft is based on, depends on the
   live type `settings.adjustments`, and on a clash keeps the person's draft and says what happened.
4. Configuration export and import of documents, format N.
5. `adjustment_settings` is deleted, with every list that named it.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Role ids instead of role names in `billApproverRoles`, and clearing a deleted role from it | A1002 cut 2 (tables-fiscal §2: "role ids once A1002 lands"); it now changes the document's checker and the import's id rewrite instead of a CHECK |
| Recording a save of the limit in `activity_log`; only the latest saver and time are kept. tables-fiscal §3 expects saves "logged however the shared settings table logs saves"; README §5 U11 does not name such a kind | a follow-up the owner may want, after slice 2; not planned |
| Importing an export whose document is at another version (no conversion before go-live, CLAUDE.md §3) | the first document shape change after go-live |
| Every other document | each area's slice; core's in slice 5 |
| `adjustments.comped_extras`, `adjustments.splits` (tables-fiscal §1.4) | the payments-and-adjustments area slice |

## Files

Create:

- `packages/provisioning/src/settings-transfer.ts` — export, check and import of documents.
- `packages/provisioning/src/settings-transfer.test.ts`.

Modify:

- `packages/db/src/settings.ts` — add `replaceTransferredSettings`; `packages/db/src/index.ts` —
  export it, and stop exporting `adjustmentSettings` and `DEFAULT_BILL_APPROVER_ROLES` (`:431,434`).
- `packages/db/src/schema/adjustments/index.ts` — drop `export * from "./settings.js"` (`:3`).
- `packages/db/src/classification.ts:455-459` — drop the `adjustment_settings` entry.
- `packages/adjustments/src/settings.ts` (whole file, 72 lines today), `index.ts:3-11`,
  `classification.ts:4-10`, `configuration-transfer.ts:58-61,66`, `routes.ts:54-65,212-223,307-326`,
  `dashboard/client.ts:27-30,184-195`, `dashboard/live-queries.ts:4`,
  `dashboard/reasons-screen.ts:524-560,975-1041`.
- `packages/dashboard-kit/src/codes.ts:4` — the shared wording for `settings.out_of_date`.
- `packages/composition/src/modules.ts:351-363` — the adjustments descriptor's `settings` seat.
- `packages/provisioning/src/configuration-transfer.ts:59-140` (export, version at `:123`),
  `:155-166` (bundle type, `:160`), `:469-528` (parse, `:473`, `:476`), `:576-620` (validate),
  `:622-799` (import).
- Tests and fixtures (set-up and re-pointing; each changed assertion is listed under
  **Assertions that change, by design**): `packages/adjustments/src/{settings,routes,classification,configuration-transfer,backup-verification,provisioning}.test.ts`,
  `packages/adjustments/src/dashboard/{reasons-screen,reasons-screen.save-state,reasons-screen.unsaved,client}.test.ts`,
  `packages/dashboard-kit/src/codes.test.ts`,
  `packages/composition/src/composition.test.ts:384-400`,
  `packages/provisioning/test/configuration-bundle.ts:5`,
  `packages/provisioning/src/configuration-transfer.privacy-contact.test.ts:79`,
  `packages/provisioning/src/configuration-transfer.boundaries.test.ts:104`,
  `apps/server/src/configuration-transfer.test.ts:389,2189-2203,5481`,
  `apps/server/src/configuration-import.test.ts:48,203`,
  `apps/server/src/{adjustments-api,adjustments-apply,held-setup-database,backup-verification.settings}.test.ts`,
  `apps/server/test/held-setup-database.ts:238-241`,
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:39` (`REMOVED_TABLES`),
  `scripts/schema-constraints.test.ts:536-538`.
- Docs: `docs/developers/conventions-data.md` (1b-i's settings section, and "Retiring configuration
  tables also retires their export format", `:1787-1828`).
- Regenerated by `pnpm --filter @waitron/server migration-baseline rebuild --set core`:
  `packages/db/drizzle/*`, `scripts/migration-baseline-epoch.json`.

Unchanged on purpose (they name the old table or function today, and stop point 2 must not fire on
them):

- `apps/server/src/adjustments-apply.ts:13,1093` keeps calling `readAdjustmentSettings` and
  destructuring `maxBillComp` and `billApproverRoles`; the answer gains a `revision` it does not
  read. No change.
- `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json:537` stays
  byte-identical: it is a real format-1 export, refused as `setup.configuration_outdated` before its
  tables are read (`apps/server/src/configuration-import.test.ts:118-130`).

Delete:

- `packages/db/src/schema/adjustments/settings.ts`, `packages/db/src/schema/adjustments/settings.test.ts`.
- The `adjustment_settings` cases in `packages/db/src/schema/adjustments/migrations.test.ts:390-446`
  (their behaviour moves to the document's checker cases in Task 1).

## Size

| Part | Code | Tests |
| --- | --- | --- |
| Adjustments document, module functions, routes | 110 | 120 |
| Dashboard client, screen, shared wording | 45 | 110 |
| Transfer path (db helper, provisioning, bundle format) | 120 | 150 |
| Removing `adjustment_settings` from lists and fixtures; format number | 15 | 50 |
| Docs | 25 | — |
| **Total** | **~315** | **~430** |

About 745 counted lines. Not counted: the deleted schema file, its test and the deleted migration
cases, and the regenerated migration files. About 3 hours.

## Finish line

1. `pnpm --filter @waitron/adjustments exec vitest run` passes (Node and browser projects; read the
   `Tests` count).
2. `pnpm --filter @waitron/provisioning exec vitest run src/settings-transfer.test.ts src/configuration-transfer.boundaries.test.ts src/configuration-transfer.privacy-contact.test.ts src/configuration-import.test.ts` passes.
3. `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts src/configuration-import.test.ts src/adjustments-api.test.ts src/adjustments-apply.test.ts src/held-setup-database.test.ts src/backup-verification.settings.test.ts src/first-fiscal-setup.e2e.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts` passes.
4. `pnpm --filter @waitron/db exec vitest run src/settings.test.ts`,
   `pnpm --filter @waitron/composition exec vitest run` and
   `pnpm --filter @waitron/dashboard-kit exec vitest run src/codes.test.ts` pass.
5. `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/migrations-match-schema.test.ts scripts/live-subscriptions.test.ts scripts/write-path-tables.test.ts scripts/settings-not-migrated.test.ts scripts/module-seams.test.ts` passes.
6. `pnpm protection-list compare` prints exactly the lines below.
7. The clash and the screen are proven by browser tests (Task 2), not by hand. The look is checked
   by the Claude review seat, not the Codex builder: it opens the reasons screen on a dev stack
   (`wa-wt demo <worktree>`, after `wa-wt reset demo <worktree>` since the schema changed) with the
   clash message showing, and screenshots it in both themes and at phone width (CLAUDE.md §4: "Open
   it and LOOK, in both themes and at phone width"); screenshots stay in the reviewer's working
   folder, never committed (CLAUDE.md §6).

## Expected protection-list difference

Six `DIFF` headers (both compositions, all three phases, `database=venue`). Reason: tables-fiscal §4
maps `adjustment_settings` → `settings.adjustments`, and §5 moves its three CHECKs
(`adjustment_settings_singleton_ck`, `_max_bill_comp_ck`, `_bill_approver_roles_ck`) to the
document's validation; the singleton rule is the `settings` primary key.

In each `sql-only` and `migrated` block:

```text
missing table adjustment_settings
```

In each `change-feed` block:

```text
missing table adjustment_settings
missing trigger waitron_change_adjustment_settings_delete
missing trigger waitron_change_adjustment_settings_insert
missing trigger waitron_change_adjustment_settings_update
```

Nothing `extra` or `changed`: `settings` is unchanged from 1b-i. `adjustment_settings` has no index of
its own (an integer primary key), which the base list at `a086eedfb7` showed.

## Assertions that change, by design

Rules §4 makes a changed assertion a stop unless the plan names it. These are the only ones, each
for the reason given:

- **A `revision` appears** (README §3: "a save names the revision it read"): the read and save
  results in `packages/adjustments/src/settings.test.ts:30-72`, the route answers in
  `packages/adjustments/src/routes.test.ts:535-543`, the saved-body assertions in
  `packages/adjustments/src/dashboard/reasons-screen.test.ts` (`saveSettings` calls from `:2225`)
  and `reasons-screen.save-state.test.ts:135,156`, and the import round trip in
  `apps/server/src/configuration-transfer.test.ts:2203`, which reads revision 1 after an import.
- **Where the limit is stored**: `stored()` in `routes.test.ts:523-527` and `rows()` in
  `settings.test.ts:20-26` read `doc` from the `adjustments` row; the stored values they assert are
  the same amounts and roles, in cents and as a list.
- **What a refused import names** (tables-venuebox §2.4: documents have their own path): a bad
  approver list is refused at `settings.adjustments.billApproverRoles`, not
  `adjustment_settings.bill_approver_roles` (`packages/adjustments/src/configuration-transfer.test.ts:162-186`
  move to `settings-transfer.test.ts`).
- **What the module declares**: `ADJUSTMENTS_CONFIGURATION_TRANSFER` lists `adjustment_reasons`
  only (`configuration-transfer.test.ts:61-67`); `ADJUSTMENTS_TABLES` and the change sources lose
  `adjustment_settings` (`classification.test.ts:12-40`, `composition.test.ts:388-394`).
- **The live type**: `reasons-screen.unsaved.test.ts:790,804` invalidate `settings.adjustments`.
- **The format number** (rules §9): the export pins N where main's value is today
  (`apps/server/src/configuration-transfer.test.ts:5481`,
  `packages/provisioning/src/configuration-transfer.privacy-contact.test.ts:79`), and the "future
  version" refusals use N + 1 (`apps/server/src/configuration-import.test.ts:203`,
  `packages/provisioning/src/configuration-transfer.boundaries.test.ts:104`). The fixtures move to N
  (`packages/provisioning/test/configuration-bundle.ts:5`,
  `apps/server/src/configuration-import.test.ts:48`, `apps/server/src/configuration-transfer.test.ts:389`).

Every other assertion stays as it is; set-up may change (the third argument to
`saveAdjustmentSettings`, a person created first).

## Stop points (beyond rules §5)

1. The base's `adjustment_settings` CHECKs are not the three in `packages/db/src/schema/adjustments/settings.ts:22-32`
   (for example A1002 cut 2 has relaxed the approver list): stop, because the document's checker must
   copy whatever the base enforces.
2. A reader or writer of `adjustment_settings`, `readAdjustmentSettings` or `saveAdjustmentSettings`
   exists outside the files listed here, including the two "unchanged on purpose"
   (`git grep -n "adjustment_settings\|adjustmentSettings\|AdjustmentSettings"` at the base,
   excluding `docs/`, `packages/db/drizzle/` and `packages/country-es/test-fixtures/`).
3. Another assertion naming the format number turns up beyond the four listed
   (`git grep -n "version: 10\|toBe(10)\|version: 11" -- apps packages`, with main's value in place
   of 10 and 11).
4. `apps/server/src/first-fiscal-setup.e2e.test.ts`'s `claimFrom: "preview"` row or
   `apps/setup/src/setup-app-first-fiscal.test.ts` fails because the bundle gained `settings`
   (conventions-data "A configuration bundle value that is not a setup field stays out of the venue's
   own keys"): the setup app may be copying bundle keys it should not.
5. Waitron Cloud reads configuration exports (none found: `docs/cloud-ownership.md` does not mention
   them, read 2026-11-08). If the builder finds otherwise, stop: the Cloud lane changes its side in
   the same slice (README §5 U11).

## Global Constraints

- All of 1b-i's constraints, including no shape upgrades before go-live.
- The import never writes a person id from the source: `updated_by` is null (tables-venuebox §2.4:
  "the importer or null"). Setup runs the import inside first setup's transaction
  (`packages/provisioning/src/venue-apply.ts:500`), before any person has signed in to this box, so
  there is no importer to name.
- An import replaces only the rows of documents that say `transfers: true`; it never touches another
  module's row (tables-venuebox §2.4).
- A document arrives checked by its own module's definition before any row is written
  (README §5 U2).
- An export from older code is refused as `setup.configuration_outdated`; no conversion code
  (CLAUDE.md §3 "No backwards-compatibility … until … production").
- Money in a document is whole cents; the module converts at its boundary with `decimalToCents` /
  `centsToDecimal` (CLAUDE.md §3).
- Dashboard wording is short (owner's concise-text rule) and in English and Spanish.

## Review Focus

1. **A manager saving a limit from a screen opened before someone else's save:** refused 409
   `settings.out_of_date`; the screen keeps the draft, says so, and the next save replaces the other
   change. Task 2.
2. **A manager who keeps editing after a save, while someone else saves:** the next save names the
   revision the manager's own save returned, so it clashes instead of silently overwriting. Task 2.
3. **An export from a venue that never set a limit:** no `adjustments` key; after import the target
   reads the defaults, even if the target had saved a limit before the import. Task 3.
4. **A hand-edited or damaged export** (an unknown document key, a version other than the code's, an
   approver list that is empty or names "owner"): refused before anything is written. Task 3.
5. **A stored document the code refuses:** the settings route answers 500 `settings.invalid` naming
   the module and field, not 400 and not a generic failure. Task 1.

---

## Interfaces

Consumes from 1b-i: `defineSettingsDocument`, `readSettings`, `saveSettings`, `SettingsDocument`,
`SettingsRead`, `settings`, `settings.out_of_date`, `settings.invalid`, `WaitronModule.settings`.

Produces:

```ts
// packages/adjustments/src/settings.ts
export const DEFAULT_BILL_APPROVER_ROLES: readonly PersonRoleValue[]; // ["manager", "admin"], moved from @waitron/db
export interface AdjustmentsDocument { maxBillComp: number | null; billApproverRoles: PersonRoleValue[] } // cents
export const ADJUSTMENTS_SETTINGS: SettingsDocument<AdjustmentsDocument>; // module "adjustments", version 1, transfers true
export interface AdjustmentSettings { maxBillComp: Decimal | null; billApproverRoles: PersonRoleValue[] } // unchanged
export type AdjustmentSettingsRead = AdjustmentSettings & { revision: number };
export function readAdjustmentSettings(tx: Transaction): Promise<AdjustmentSettingsRead>;
export function saveAdjustmentSettings(
  tx: Transaction,
  settings: AdjustmentSettings,
  change: { expectedRevision: number; personId: string | null },
): Promise<AdjustmentSettingsRead>;

// packages/db/src/settings.ts
/** Deletes the row of every definition given, then inserts each doc in `docs` at its definition's
 * version, revision 1, updated_by null. A key in `docs` that no definition names throws. */
export function replaceTransferredSettings(
  tx: Transaction,
  definitions: readonly SettingsDocument<object>[],
  docs: ReadonlyMap<string, object>,
): Promise<void>;

// packages/provisioning/src/settings-transfer.ts
export interface TransferredSettings { readonly version: number; readonly doc: object }
export function transferredDocuments(modules: readonly WaitronModule[]): SettingsDocument<object>[];
export function exportSettingsDocuments(
  db: Database | Transaction,
  modules: readonly WaitronModule[],
): Promise<Record<string, TransferredSettings>>;
export function checkImportedSettings(
  entries: Readonly<Record<string, TransferredSettings>>,
  modules: readonly WaitronModule[],
): Map<string, object>;
export function importSettingsDocuments(
  tx: Transaction,
  entries: Readonly<Record<string, TransferredSettings>>,
  modules: readonly WaitronModule[],
): Promise<void>;

// packages/provisioning/src/configuration-transfer.ts
interface ConfigurationBundle { version: N; /* …unchanged… */ settings: Record<string, TransferredSettings> }

// Wire: GET/PUT /management-api/adjustments/settings
// answer and PUT body: { maxBillComp: string | null, billApproverRoles: PersonRole[], revision: number }
// 409 settings.out_of_date { module, revision }; 500 settings.invalid { module, field, version? }
```

---

### Task 1: The adjustments document, and the module reading and saving through it

**Files:**
- Modify: `packages/adjustments/src/settings.ts`, `index.ts`, `classification.ts`,
  `routes.ts`, `packages/composition/src/modules.ts:351-363`, `packages/db/src/index.ts`,
  `packages/db/src/schema/adjustments/index.ts`, `packages/db/src/classification.ts:455-459`,
  `scripts/schema-constraints.test.ts:536-538`,
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:39`
- Delete: `packages/db/src/schema/adjustments/settings.ts`, its test, and
  `packages/db/src/schema/adjustments/migrations.test.ts:390-446`
- Test: `packages/adjustments/src/settings.test.ts`, `routes.test.ts`, `classification.test.ts`,
  `provisioning.test.ts:106`, `packages/composition/src/composition.test.ts:384-400`,
  `apps/server/src/adjustments-api.test.ts:409,452`, `adjustments-apply.test.ts:2369,4054`,
  `held-setup-database.test.ts:87-127`, `apps/server/test/held-setup-database.ts:238-241`

**Interfaces:** produces everything under `packages/adjustments/src/settings.ts` above.

- [ ] **Step 1: Base protection list** (rules §3), as 1b-i Task 1 Step 1.

- [ ] **Step 2: Failing cases.**
  - In `packages/adjustments/src/settings.test.ts`, re-point `rows()` to
    `select doc, revision from settings where module = 'adjustments'`, keep every existing case
    and its values, and add `revision` where the module function's result is asserted. Add:
    - `"the document's checker keeps what the table's CHECKs refused"`: `ADJUSTMENTS_SETTINGS.parse`
      answers `{ ok: false, field: "maxBillComp" }` for `0`, `-100`, `12.5` and `"40"`, and
      `{ ok: false, field: "billApproverRoles" }` for `[]`, `["manager","manager"]`, `["owner"]` and
      a missing list; `{ ok: false, field: "colour" }` for an unknown key; ok for
      `{ maxBillComp: null, billApproverRoles: ["admin"] }` and `{ maxBillComp: 4000, … }`.
      (These replace `migrations.test.ts:423,439-440`'s CHECK cases.)
    - `"refuses a save from a stale revision"`: two saves both naming 0 → the second rejects
      `settings.out_of_date` `{ module: "adjustments", revision: 1 }`.
    - `"names the person who saved"`: `updated_by` equals a person the test created.
  - In `routes.test.ts`, the settings cases send `revision` (0, then the answer's revision) and
    expect it back. Add:
    - `"refuses a save from a stale revision with 409"`: two PUTs naming 0 → the second is 409
      `{ error: { code: "settings.out_of_date", params: { module: "adjustments", revision: 1 } } }`
      and the stored document is the first's.
    - `"refuses a missing or negative revision"`: `revision` absent, `-1`, `"1"` → 400
      `management.request_invalid` `{ field: "revision" }`, nothing stored.
    - `"answers a stored document the code refuses with 500 settings.invalid"`: a raw row
      `('adjustments', 1, 1, '{"maxBillComp":0,"billApproverRoles":["admin"]}', …)` → GET answers 500
      `{ error: { code: "settings.invalid", params: { module: "adjustments", field: "maxBillComp" } } }`.
    The existing field cases (`:583-605`) keep their bodies plus `revision: 0`.
  - In `composition.test.ts`, add `"no two modules declare the same settings document key"`:
    `ALL_MODULES.flatMap((m) => m.settings ?? []).map((d) => d.module)` has no repeat (compare its
    length with its `Set`'s); and the adjustments case asserts its descriptor's `settings` is
    `[ADJUSTMENTS_SETTINGS]`.

- [ ] **Step 3: Run them and see them fail.**

- [ ] **Step 4: Implement.**
  - `settings.ts`: `ADJUSTMENTS_SETTINGS` with `defaults: () => ({ maxBillComp: null, billApproverRoles: [...DEFAULT_BILL_APPROVER_ROLES] })`
    and the checker above (`isRoleList` from `./policy.js` for the list; a safe integer above 0 or
    null for the amount; any other key refused by its name). `readAdjustmentSettings` converts cents
    with `centsToDecimal`; `saveAdjustmentSettings` keeps its two `RangeError` checks
    (`:49-58`, so the existing cases at `settings.test.ts:92-112` still pass unchanged), converts
    with `decimalToCents`, and calls `saveSettings`.
  - `routes.ts`: `gatedBy` hands `fn` the `authorizedBy` that `authorizeManager` returns
    (`packages/identity/src/manager-login.ts:191-198`); GET answers `{ ...settings, revision }`; PUT
    adds `requireRevision(body.revision)` (a non-negative safe integer, else `invalid("revision")`)
    and saves with `personId: authorizedBy`; `STATUS` gains `"settings.out_of_date": 409` and
    `"settings.invalid": 500` (an unmapped code would answer 400,
    `packages/server-kit/src/error-boundary.ts:43-48`).
  - Remove `adjustment_settings` from `ADJUSTMENTS_TABLES`, from core's classification, from the
    db exports and schema index; delete its schema file and cases; drop its three names from
    `scripts/schema-constraints.test.ts`; add it to `REMOVED_TABLES` in the demo baseline test.
  - Add `settings: [ADJUSTMENTS_SETTINGS]` to the adjustments descriptor; export
    `ADJUSTMENTS_SETTINGS` and `DEFAULT_BILL_APPROVER_ROLES` from `packages/adjustments/src/index.ts`.
  - Set-up in `apps/server` suites: `saveAdjustmentSettings(tx, settings, { expectedRevision: 0, personId: null })`
    (a later save in the same test names the revision the earlier one returned); the held-setup
    database helper and test insert
    `insert into settings (module, version, revision, doc, updated_at) values ('adjustments', 1, 1, '{}', ?)`
    and count rows of `settings`; `provisioning.test.ts:106` asserts no `adjustments` row in `settings`.

- [ ] **Step 5: Rebuild** `pnpm --filter @waitron/server migration-baseline rebuild --set core`.

- [ ] **Step 6: Run** finish-line commands 1, 3 (the adjustments and held-setup files), 4 and 5, and
  see them pass.

- [ ] **Step 7: Commit** (`git commit -s`), citing tables-fiscal §4's mapping row.

### Task 2: The limit form names its revision, and the shared clash wording

**Files:**
- Modify: `packages/adjustments/src/dashboard/client.ts:27-30,184-195`, `live-queries.ts:4`,
  `reasons-screen.ts:524-560,975-1041`, `packages/dashboard-kit/src/codes.ts:4`
- Test: `packages/adjustments/src/dashboard/reasons-screen.test.ts` (the limit block from `:2140`),
  `reasons-screen.save-state.test.ts`, `reasons-screen.unsaved.test.ts:790,804`, `client.test.ts`,
  `packages/dashboard-kit/src/codes.test.ts`

**Interfaces:** consumes the wire shape above.

The rule the screen follows: the revision a save names is the one the draft is **based on**. A
draft starts from the revision on screen when it is first edited; a successful save that leaves the
draft still dirty (the person typed while it was in flight) rebases the draft on the revision that
save returned. A live update never moves it.

- [ ] **Step 1: Failing browser cases** in `reasons-screen.test.ts`; mocks of `getSettings` answer
  `revision` (the `body()` helper gains `revision`):
  - `"saves naming the revision its draft started from, even after a live update"`: load revision
    4, edit the amount, then a live refresh answers revision 5 with another amount; Save sends
    `revision: 4`, and the draft is unchanged on screen.
  - `"after a save it keeps editing on, the next save names the revision that save returned"`: load
    revision 4; edit; Save (held pending); edit again while pending; the save resolves with
    revision 5; a live refresh then answers revision 6 (another manager); the next Save sends
    `revision: 5`, so the server can refuse it, never `6`.
  - `"keeps the draft and explains a clash, then saves over it"`: `saveSettings` rejects once with
    `{ code: "settings.out_of_date", params: { module: "adjustments", revision: 5 } }`; the form's
    message is `codeMessage("settings.out_of_date")`, the draft amount is still in the field, and
    `getSettings` was called again (answering revision 5); the next Save sends `revision: 5` and
    succeeds.
  - In `packages/dashboard-kit/src/codes.test.ts`: `codeMessage("settings.out_of_date", "en")` and
    `"es"` give the two sentences below.

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement.**
  - `client.ts`: `AdjustmentSettings` gains `revision: number`.
  - `live-queries.ts`: `settings: ["settings.adjustments"]`.
  - `reasons-screen.ts`: a private `#limitRevision: number | undefined`, set to
    `this.settings!.revision` in `#limitEdit` when `limitDraft` was undefined. Save sends
    `revision: this.#limitRevision ?? this.settings!.revision`. On success: if the draft is now
    unchanged (`:1033-1035`), clear `#limitRevision`; otherwise set it to the revision the save
    returned. On `settings.out_of_date`: set `limitError` to `codeMessage(code)`, clear
    `#limitRevision`, keep the draft and call `#loadSettings()` (the observer at `:540-560` already
    keeps a dirty draft), so the next save names the reloaded revision.
  - `packages/dashboard-kit/src/codes.ts`: the `messages` table starts with
    `"settings.out_of_date": { en: "Someone else saved these settings while you were editing. Save again to replace their change with yours.", es: "Otra persona guardó estos ajustes mientras editabas. Vuelve a guardar para sustituir su cambio por el tuyo." }`,
    shared by every module's settings screen.

- [ ] **Step 4: Run** `pnpm --filter @waitron/adjustments exec vitest run src/dashboard`, the
  dashboard-kit codes test, and `pnpm exec vitest run scripts/live-subscriptions.test.ts`.

- [ ] **Step 5: Commit.** The look (finish line 7) is the Claude review seat's, not this task's.

### Task 3: Documents in the configuration copy (format N)

**Files:**
- Create: `packages/provisioning/src/settings-transfer.ts`, `settings-transfer.test.ts`
- Modify: `packages/db/src/settings.ts`, `packages/db/src/index.ts`,
  `packages/provisioning/src/configuration-transfer.ts`,
  `packages/adjustments/src/configuration-transfer.ts:58-61,66` and its test, the format sites in
  **Assertions that change, by design**
- Test: `packages/db/src/settings.test.ts` (describe `"replaceTransferredSettings"`)

**Interfaces:** produces `replaceTransferredSettings` and everything in `settings-transfer.ts`.

Why its own path (tables-venuebox §2.4, read; confirmed at HEAD): an import empties every declared
table before inserting (`packages/provisioning/src/configuration-transfer.ts:706-722`) and rewrites
ids only in key columns (`:679-686`, `:741`), and a table may be declared by one module only
(`:181-183`), so `settings` declared as a table would wipe the rows of modules that do not transfer.

- [ ] **Step 1: Failing cases.**
  - db, `"replaceTransferredSettings"`: with rows `probe` (revision 4, `updated_by` a person) and
    `other`, replacing for `[PROBE]` with `{ probe: { size: 1, unit: "in" } }` leaves `other`
    untouched and `probe` at version 1, revision 1, `updated_by` null; replacing for `[PROBE]` with
    an empty map deletes `probe`; a key not among the definitions throws.
  - `settings-transfer.test.ts`, with `ALL_MODULES` and `useVenueDb`:
    - `"exports each saved transferring document at the code's version"`: after
      `saveAdjustmentSettings` of €40.00 for Manager: `{ adjustments: { version: 1, doc: { maxBillComp: 4000, billApproverRoles: ["manager"] } } }`.
    - `"exports nothing for a document never saved"`: `{}`.
    - `"leaves out a document that does not transfer"`: a module list carrying a test document with
      `transfers: false` and a saved row exports `{}`.
    - `"refuses an unknown key, another version and a bad document before writing"`:
      `{ nope: … }` → `setup.request_invalid` `{ field: "settings" }`; `{ adjustments: { version: 2, … } }`
      → `setup.configuration_newer`; for each approver list `["owner"]`, `["manager","manager"]`,
      `[]`, `"manager"` and missing → `setup.request_invalid` `{ field: "settings.adjustments.billApproverRoles" }`
      (moved from `packages/adjustments/src/configuration-transfer.test.ts:162-186`, with the
      accepting case moved too). Nothing is written in any of these.
    - `"imports by replacing the transferring rows, revision 1, no saver"`: a target that had
      saved its own limit receives the bundle's; `revision` 1, `updated_by` null.
    - `"an export with no adjustments key resets the target to the defaults"`.
  - `configuration-transfer.boundaries.test.ts`: a bundle at main's value (N − 1) answers
    `setup.configuration_outdated`; a bundle whose `settings` is missing, an array, or holds an
    entry without an integer `version` ≥ 1 or with a non-object `doc` answers
    `setup.request_invalid` `{ field: "artifact" }`.
  - `apps/server/src/configuration-transfer.test.ts:2189-2203` keeps its round trip and reads
    `{ ...settings, revision: 1 }` on the target.

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement.**
  - `replaceTransferredSettings` in `packages/db/src/settings.ts` (the one writer, per 1b-i's
    write-path entry).
  - `settings-transfer.ts` per **Interfaces**: `exportSettingsDocuments` reads each transferring
    document with `readSettings` and keeps those with revision above 0; `checkImportedSettings`
    refuses an unknown key (`setup.request_invalid` `{ field: "settings" }`), a version above the
    definition's (`setup.configuration_newer`), a version below it (`setup.configuration_outdated`,
    no conversion before go-live), and a `parse` fault (`setup.request_invalid`
    `{ field: "settings.<module>.<field>" }`); `importSettingsDocuments` checks, then calls
    `replaceTransferredSettings`.
  - `configuration-transfer.ts`: N at `:123`, `:160`, `:473` and `:476`; the bundle gains
    `settings` (built with `exportSettingsDocuments`); `parseConfigurationBundle` checks its shape;
    `validateConfigurationBundle` calls `checkImportedSettings`; `importConfigurationTables` calls
    `importSettingsDocuments` after the table rows are inserted and before the modules'
    `afterImport` hooks (`:795-798`).
  - `packages/adjustments/src/configuration-transfer.ts`: declare `adjustment_reasons` only; drop the
    `adjustment_settings` loop; its test's `"refuses a bundle with no adjustment reasons table"`
    passes `{}` instead of `{ adjustment_settings: [] }`.
  - The format sites listed under **Assertions that change, by design**: fixtures to N with
    `settings: {}`, pins to N, "future" cases to N + 1.

- [ ] **Step 4: Run** finish-line commands 2, 3 and 4, and see them pass.

- [ ] **Step 5: Commit.**

### Task 4: Backup verification, docs, protection list, finish

**Files:**
- Modify: `packages/adjustments/src/backup-verification.test.ts:185-222`,
  `apps/server/src/backup-verification.settings.test.ts`, `docs/developers/conventions-data.md`

- [ ] **Step 1: Re-point the backup cases** (tables-venuebox §2.4: `settings` is core's table).
  - In `packages/adjustments/src/backup-verification.test.ts`, drop
    `"update adjustment_settings set max_bill_comp=500"` from `"compares all retained rows"`, drop
    `adjustment_settings` from the emptied tables at `:212-216`, and make the invented row at
    `:219-221` an `adjustment_reasons` row copied from the suite's own reason fixture; both cases keep
    their assertions.
  - In `apps/server/src/backup-verification.settings.test.ts`, re-point 1b-i's case to the comp
    limit: the backup holds
    `('adjustments', 1, 1, '{"maxBillComp":4000,"billApproverRoles":["manager"]}', …)`, the control
    without the spy answers `passed`, and the spy sets the restored row's `maxBillComp` to 500, which
    core's module answers `invalid` (the dropped adjustments case's assertion, now on core's row
    comparison). Like 1b-i's case, it shows that a differing restored row is refused, not that no
    migration rewrites documents.

- [ ] **Step 2: Docs.** In 1b-i's section of `docs/developers/conventions-data.md`, a paragraph on the
  copy: `transfers`, what an export holds, that an import replaces only transferring rows with
  revision 1 and no saver, that a document at another version is refused rather than converted
  before go-live, and why a document may hold no row id (R4: nothing rewrites JSON). In "Retiring
  configuration tables also retires their export format", one sentence: A1308 slice 1b-ii (format
  N) moved the comp limit from the `adjustment_settings` table to the `settings` key, and an export at
  the previous format is refused as outdated.

- [ ] **Step 3: Protection list** — `list` then `compare` as 1b-i Task 5 Step 4; paste and mark the
  report against **Expected protection-list difference**.

- [ ] **Step 4: Run the whole finish line**, commit, and run `/finish-branch`; its Claude review seat
  does finish line 7's look. The pull request description lists **Assertions that change, by
  design** and marks each.
