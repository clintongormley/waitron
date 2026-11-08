# A1308 slice 1b-i: the shared `settings` table and its plumbing — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the one shared `settings` table that every module will keep its configuration in, the
small typed API every module reads and saves it through, and the live-update plumbing that wakes
only the screens of the module whose document changed.

**Architecture:** A "settings document" is one JSON object per module, stored as one row of
`settings` keyed by a short name (the `module` column). Code declares each document once with
`defineSettingsDocument` (its key, shape version, defaults and checker); `readSettings` and
`saveSettings` are the only read and write paths. Every save names the revision it read, so two
people editing at once cannot silently overwrite each other. A change to row `x` is announced to live
screens as the type `settings.x`, not as a bare `settings`.

**Tech Stack:** TypeScript, Drizzle on `node:sqlite`, Vitest, Hono (live events), Stryker for
`packages/db`.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 "Shared tables", §5 U2
and §6 "Migrations and upgrades"; [tables-venuebox.md](../specs/2026-11-02-rationalisation/tables-venuebox.md)
§2.4, §5 (the `locations_invoice_locales_len` row, for where a per-module rule lives) and §8 items 1
and 3; [tables-fiscal.md](../specs/2026-11-02-rationalisation/tables-fiscal.md) §2 for the first
consumer, which is slice 1b-ii. Every slice rule in [the slice rules](2026-11-08-a1308-slice-rules.md)
applies; this plan cites them as "rules §n".

**This is half of slice 1b.** The whole of 1b measured about 1,300 counted lines, past rules §1's
cap, so it is split:

- **1b-i (this plan):** the table, the API, per-module live updates, the per-module rule pattern,
  measurement 1 (tables-venuebox §8.1), the guards that keep documents out of migrations, and the
  write-path rule restated, all proven with test-only documents.
- **1b-ii** ([plan](2026-11-08-a1308-1b-ii-adjustments-settings.md)): configuration export and
  import of documents, and `adjustment_settings` becoming the `settings` row `adjustments`, with its
  screen, routes and every reader.

The consumer travels with the transfer path, not with the table: today's export carries
`adjustment_settings`, and `apps/server/src/configuration-transfer.test.ts:2189-2203` asserts that the
limit survives an export and import, so moving adjustments without the transfer path would make that
behaviour test fail (rules §4, §5.3).

**No shape upgrades before go-live** (coordinator decision, 2026-11-08, from README §6 "After
go-live, a settings document's shape changes through a version number and one tested upgrade step per
version, applied on read" and CLAUDE.md §3 "No backwards-compatibility or data-migration code until
Waitron is in production"). The `version` column exists so the first shape change after go-live has
somewhere to record it; until then a read refuses any stored version other than the definition's.
That first change adds the upgrade step, its machinery, and tables-venuebox §8.3's measurement.

**Owner lands:** no (rules §6). Nothing here touches sales, invoice numbering, the fiscal records,
the fiscal identity, AEAT sending or any value that feeds a fiscal hash: the slice adds one empty
table that no product code writes yet.

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2).

---

## What it builds

1. Table `settings` in core's migration set (`venue.db`, classified `state`): `module` (text primary
   key, not null), `version` (integer, the document's shape), `revision` (integer, bumped on every
   save), `doc` (JSON object), `updated_at` (text timestamp), `updated_by` (person id, foreign key to
   `persons(id)`, `on delete restrict`, null allowed). Four named CHECKs: `settings_module_ck` (a
   lowercase name: starts with a letter, then letters, digits or `_`), `settings_version_ck`
   (`>= 1`), `settings_revision_ck` (`>= 1`), `settings_doc_ck` (valid JSON whose top level is an
   object).
2. The typed API in `@waitron/db` (names fixed in **Interfaces** below): define a document, read it
   (an absent row reads as the defaults at revision 0; a stored version other than the definition's
   is refused), save it (the checked, normalised document is what is stored; refused with
   `settings.out_of_date` when the revision it names is not the row's current one).
3. Per-module live updates: the change trigger on `settings` announces `settings.<module>`; the
   server admits `settings.<key>` as a subscription type for each document an enabled module
   declares, and no longer admits a bare `settings`.
4. A descriptor seat, `WaitronModule.settings`, where a module lists its documents.
5. The per-module database rule pattern, written down in `docs/developers/conventions-data.md` and
   proven by a test that installs a sample rule in its own test database.
6. Measurement 1 as a test: a save to one module's document does not wake another module's
   subscriber (tables-venuebox §8.1).
7. Guards for "a document's shape changes on read, never in a migration": the exact CHECKs on
   `settings` pinned, and a scan that no migration or trigger SQL writes `settings`. Backup
   verification's row comparison of `settings` is shown to refuse a restored row that differs.
8. The write-path rule restated as "writes live only in the files the JSON names" (the wording slice
   2's plan fixed), with `settings` pinned to `packages/db/src/settings.ts`.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Configuration export and import of documents | 1b-ii |
| `adjustment_settings` → the `adjustments` document, its routes, screen and readers | 1b-ii |
| The shared dashboard wording for `settings.out_of_date` | 1b-ii (its first screen) |
| Shape upgrades (an `upgrade` step on the definition, applied on read) and tables-venuebox §8.3's backup measurement | the first document shape change after go-live (README §6) |
| Recording each save in `activity_log`. `updated_by` and `updated_at` keep only the latest save. tables-fiscal §3 says saves "are logged however the shared settings table logs saves", and README §5 U11 does not name a settings kind | a follow-up the owner may want, after slice 2 lands `activity_log`; not planned |
| Core's own `venue` and `business_day` documents, and the `invoiceLocales` trigger (tables-venuebox §2.1, §2.2, §5) | slice 5 (the location sweep) |
| tables-venuebox §8.2, the language triggers reading a document, timed | slice 5, which rewrites those triggers |
| `settings.menu`, `settings.payments`, `settings.identity` and the other documents the appendices name | each area's slice |
| `modules.json` moving into `settings` (README §7) | the environment and file-layout slices (batch 3) |
| `settings.updated_by` in the personal-data download | the existing backlog point "The rest of 'who did what' in the download" (`docs/backlog/data-protection.md:79`) |
| A per-module rule for a module with its own migration set (only core has a hand-written trigger file after slice 1a) | the first slice that needs one extends 1a's rebuild command |

## Files

Create:

- `packages/db/src/schema/settings.ts` — the table.
- `packages/db/src/settings.ts` — the API.
- `packages/db/src/settings.test.ts` — the API's and the table's cases, the pinned CHECKs, and the
  per-module rule pattern.
- `apps/server/src/live-api.settings.test.ts` — measurement 1.
- `apps/server/src/backup-verification.settings.test.ts` — a restored `settings` row that differs
  is refused.
- `scripts/settings-not-migrated.test.ts` — no migration or trigger SQL writes `settings`.

Modify:

- `packages/db/src/schema/index.ts` (add `export * from "./settings.js";`), `packages/db/src/index.ts`
  (export the table and the API; the root's exports are an explicit list, `:425-436` shows its
  shape).
- `packages/db/src/errors.ts` — two codes.
- `packages/db/src/classification.ts` — `settings` in `CORE_OWN_CLASSIFICATION` (`:12`), and its
  change source in `CORE_CHANGE_SOURCES` (`:492-498`).
- `packages/db/src/classification.test.ts` — the change source case.
- `packages/db/src/change-feed.ts` — `typeSuffixColumn` support in `identitySql` (`:44-51`) and the
  column checks in `installChangeFeed` (`:103-133`).
- `packages/db/src/change-feed.test.ts` — a probe table with a suffixed type.
- `packages/shared/src/live-updates.ts` — `ChangeSource.typeSuffixColumn`, `SETTINGS_CHANGE_TYPE`,
  `settingsChangeType`.
- `packages/module/src/module.ts` — the `settings` seat beside `changes` (`:1531`).
- `apps/server/src/live-resources.ts` — a second parameter (`:10-24`).
- `apps/server/src/boot.ts` — pass the declared keys (`:2216-2223`).
- `packages/db/drizzle/0000_baseline.sql`, `packages/db/drizzle/meta/*`,
  `scripts/migration-baseline-epoch.json` — regenerated by 1a's rebuild command, never by hand.
- Guards: `scripts/schema-constraints.test.ts` (foreign keys from `:33`, CHECK names from `:527`),
  `scripts/live-subscriptions.test.ts` (`:12`), `scripts/write-path-tables.json`,
  `scripts/write-path-tables.test.ts` (header `:6-9` and its why-list, `describe` at `:170`, failure
  message `:180-186`, pinned list `:192-205`),
  `apps/server/src/personal-data-actions.coverage.test.ts` (`NOT_YET`, `:43-74`),
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (`ADDED_TABLES`, `:24-37`).
- Docs: `CLAUDE.md` §3 (the write-path rule at `:467-471`, and one new settings rule),
  `docs/developers/conventions-data.md` (the write-path section at `:916-918`, and a new settings
  section), `docs/developers/grants-retirement-audit.md:53` (the link to the renamed anchor).

Delete: nothing.

## Size

Estimated hand-written changed lines (rules §1):

| Part | Code | Tests |
| --- | --- | --- |
| Table, classification, errors, exports | 70 | 70 (CHECK, key and pinned-CHECK cases) |
| API (`settings.ts`) | 105 | 140 |
| Change type, seat, live resources, boot | 50 | 55 (change feed, classification) |
| Measurement 1 | — | 95 |
| Per-module rule pattern | — | 40 |
| Restored-row refusal; migration-SQL scan | — | 75 |
| Guards, write-path rewording | 25 | 15 |
| Docs | 60 | — |
| **Total** | **~310** | **~490** |

About 800 counted lines. Not counted: the regenerated `packages/db/drizzle/0000_baseline.sql`,
`packages/db/drizzle/meta/*` and `scripts/migration-baseline-epoch.json`. About 2½ hours.

## Finish line

Run each from the worktree root unless it says otherwise; read the `Tests` count of every Vitest
run, not its exit status (CLAUDE.md §4).

1. `pnpm --filter @waitron/db exec vitest run src/settings.test.ts src/change-feed.test.ts src/classification.test.ts src/backup-evidence.test.ts` passes.
2. `pnpm --filter @waitron/server exec vitest run src/live-api.settings.test.ts src/backup-verification.settings.test.ts src/live-api.test.ts src/personal-data-actions.coverage.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts` passes.
3. `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/live-subscriptions.test.ts scripts/write-path-tables.test.ts scripts/settings-not-migrated.test.ts scripts/migration-upgrade.test.ts scripts/errors-reachable.test.ts scripts/claude-md-pointers.test.ts` passes.
4. From `apps/server`, `pnpm protection-list compare` prints exactly the lines in the next section.
5. `pnpm --filter @waitron/db exec stryker run --mutate src/settings.ts` scores at least 90
   (CLAUDE.md §2: `db` is mutation-tested and the nightly breaks under 90).

## Expected protection-list difference

Six `DIFF` headers, one per composition (`fiscal-verifactu`, `fiscal-none`) and phase (`sql-only`,
`migrated`, `change-feed`), all `database=venue`; `node.db` is untouched. Reason for every line: the
design adds `settings` as a new shared table (README §3 "Shared tables").

In each `sql-only` and `migrated` block:

```text
extra index settings.primary key(module)
extra table settings
```

In each `change-feed` block:

```text
extra index settings.primary key(module)
extra table settings
extra trigger waitron_change_settings_delete
extra trigger waitron_change_settings_insert
extra trigger waitron_change_settings_update
```

The index line is SQLite's automatic index for a text primary key (`origin` `pk`, printed by
`indexName` in `apps/server/scripts/protection-list/compare.ts:139-143`). The three change-feed
triggers come from core's new change source. Nothing is `missing` or `changed`. Any other line is a
stop (rules §5.2), in particular a `changed trigger waitron_change_*` on another table, which would
mean the rebuild reordered columns again.

## Stop points (beyond rules §5)

1. Slice 1a has not landed: `pnpm --filter @waitron/server migration-baseline rebuild` does not exist
   or `packages/db/triggers/core.sql` is absent.
2. Measurement 1's failing case appears: the `settings.venue` stream's first change carries
   `settings.menu`. The design's fallback is to emit `id = module` and let dependencies carry ids
   (tables-venuebox §2.4, last sentence of "Live updates"); the watcher confirms before it is taken.
3. `scripts/write-path-tables.test.ts` reports a writer of `settings` outside
   `packages/db/src/settings.ts`.
4. Slice 2 has landed first and already restated the write-path rule: check its text matches Task 5
   Step 1 and skip that rewording; any difference is a stop.
5. `scripts/settings-not-migrated.test.ts` finds a write of `settings` in today's SQL.

## Global Constraints

- One row per module key; the key is `^[a-z][a-z0-9_]*$` (README §3: "One row per module").
- A document's shape changes on read, never in a migration (README §5 U2, "Backups"); before
  go-live it does not change at all, and a read refuses a stored version other than the
  definition's (coordinator decision above).
- A save names the revision it read; a clashing save is refused (README §3).
- No row ids inside a document, except a short list owned by the row itself (README §3 R4). The API
  cannot enforce this; the convention section states it.
- A per-module database rule is a trigger on `settings`, never a CHECK, so a later rule never
  rebuilds the table (tables-venuebox §5, `locations_invoice_locales_len` row).
- Writes take a `Transaction` from `withTransaction` (CLAUDE.md §3); queries on one transaction are
  awaited in turn.
- Column types come from `packages/db/src/schema/columns.ts` (CLAUDE.md §3; guard
  `scripts/column-vocabulary.test.ts`).
- Error codes name the domain (`settings.*`) and are declared in the throwing package's registry,
  `packages/db/src/errors.ts` (CLAUDE.md §3).
- Generic code never names a module: nothing in `packages/db` mentions `adjustments` or any other
  module (CLAUDE.md §3, `scripts/module-seams.test.ts`).
- Person-id columns get a foreign key to `persons`; fixtures create the person first (rules §4,
  README §5 U11).

## Review Focus

1. **A key that is not a plain lowercase name** ("Venue", "business-day", "", "_x"): the definition
   is refused when the module loads, and the database refuses the row. Task 1 and Task 2 cases.
2. **Two managers saving from the same starting revision:** the second save is refused with the
   current revision, and the first save's document is what stays. Task 2.
3. **A row at another version than the code's, or one the checker refuses:** the read fails with
   `settings.invalid` naming the module and the field (and the stored version); it never quietly
   answers the defaults. Task 2.
4. **A save naming a person who does not exist:** refused by the foreign key; `personId: null` is
   allowed (a save made by the system, such as an import). Task 1 and Task 2.
5. **A broken change feed:** measurement 1's stream reads fail on a timeout rather than hang the
   suite. Task 3.

---

## Interfaces fixed by this slice

Later plans (1b-ii, the location sweep, menu, payments, environment, A646) use exactly these names.

```ts
// packages/shared/src/live-updates.ts
export interface ChangeSource {
  table: string;
  type: string;
  related?: readonly { type: string; column: string }[];
  /** When set, the change's type is `<type>.<value of this column>` and carries no id. The column
   * must be NOT NULL. */
  typeSuffixColumn?: string;
}
export const SETTINGS_CHANGE_TYPE = "settings";
export function settingsChangeType(module: string): string; // `settings.${module}`

// packages/db/src/settings.ts (exported from "@waitron/db")
export type SettingsParse<T> =
  | { readonly ok: true; readonly doc: T }
  | { readonly ok: false; readonly field: string };

export interface SettingsDocument<T extends object> {
  /** The row's key: usually the owning module's name; core will own `venue` and `business_day`. */
  readonly module: string;
  /** The current shape, an integer from 1. Stays 1 until go-live (README §6). */
  readonly version: number;
  /** What a venue that never saved reads. A function, so no caller shares a mutable object. */
  readonly defaults: () => T;
  /** Checks a document and returns it normalised (the value that is stored), or names the bad field. */
  readonly parse: (doc: unknown) => SettingsParse<T>;
  /** Whether a configuration export carries this document (1b-ii reads it). */
  readonly transfers: boolean;
}

export interface SettingsRead<T> {
  readonly doc: T;
  /** 0 when the venue has never saved this document. */
  readonly revision: number;
}

export interface SettingsChange<T> {
  readonly doc: T;
  /** The revision the caller read; 0 when it read the defaults. */
  readonly expectedRevision: number;
  /** Who saved; null for a save no person made. */
  readonly personId: string | null;
}

export function defineSettingsDocument<T extends object>(
  definition: SettingsDocument<T>,
): SettingsDocument<T>;
export function readSettings<T extends object>(
  db: Database | Transaction,
  definition: SettingsDocument<T>,
): Promise<SettingsRead<T>>;
export function saveSettings<T extends object>(
  tx: Transaction,
  definition: SettingsDocument<T>,
  change: SettingsChange<T>,
): Promise<SettingsRead<T>>;

// packages/db/src/schema/settings.ts (exported from "@waitron/db")
export const settings; // the drizzle table `settings`

// packages/db/src/errors.ts
"settings.out_of_date": { module: string; revision: number }; // revision = the row's current one, 0 if none
"settings.invalid": { module: string; field: string; version?: number }; // field "version", with the stored version, for a version other than the definition's

// packages/module/src/module.ts, on WaitronModule
readonly settings?: readonly SettingsDocument<object>[];

// apps/server/src/live-resources.ts
export function liveResourceTypes(
  sources: readonly ChangeSource[],
  settingsModules?: readonly string[], // default []
): string[];
```

A route that reads a document maps `settings.invalid` to **500** in its status table: the box holds a
document its code refuses, which is the server's fault. The error boundary answers an unmapped code
400 (`packages/server-kit/src/error-boundary.ts:43-48`), which would blame the caller; with the
mapping the answer keeps `settings.invalid` and its params. 1b-ii's routes are the first to do this.

---

### Task 1: The `settings` table in core's set

**Files:**
- Create: `packages/db/src/schema/settings.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`,
  `packages/db/src/classification.ts` (one `classify` entry in `CORE_OWN_CLASSIFICATION`),
  `scripts/schema-constraints.test.ts`, `apps/server/src/personal-data-actions.coverage.test.ts:43-74`,
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:24-37`
- Regenerated: `packages/db/drizzle/*`, `scripts/migration-baseline-epoch.json`
- Test: `packages/db/src/settings.test.ts` (describe `"the settings table"`)

**Interfaces:**
- Produces: the drizzle table `settings` with columns `module`, `version`, `revision`, `doc`,
  `updatedAt`, `updatedBy`.

- [ ] **Step 1: Take the base protection list** (rules §3). In a throwaway worktree of the base commit
  (`git worktree add --detach <dir> <base-sha>`, `pnpm install`), from its `apps/server`:
  `pnpm protection-list list --out <empty absolute dir A>`. Keep `A` outside the repository. (On
  `a086eedfb7` the command took about 3 seconds.)

- [ ] **Step 2: Write the failing table cases** in `packages/db/src/settings.test.ts`, suite
  `useVenueDb({ migrations: [CORE_MIGRATIONS] })`, each insert as raw SQL so the database alone is
  tested:
  - `"refuses a key that is not a lowercase name"`: for each of `"Venue"`, `"business-day"`, `""`,
    `"_x"`, an insert with a valid doc is refused and `checkFailed(error, "settings_module_ck")`
    (`packages/db/src/constraint-target.ts:197`) is true; control: `"business_day"` inserts.
  - `"refuses a document that is not a JSON object"`: `'not json'`, `'[1]'`, `'"s"'` are refused with
    `settings_doc_ck`; control: `'{}'` inserts.
  - `"refuses a version or revision below 1"`: version 0 → `settings_version_ck`; revision 0 →
    `settings_revision_ck`; control: both 1 insert.
  - `"refuses a module key twice"`: a second row with the same `module` is refused (primary key).
  - `"names its saver by a real person"`: an `updated_by` naming no person is refused at the write
    (CLAUDE.md §3: a key is proven by writing through it); control: a person inserted through
    `persons` (`displayName: "Owner"`) is accepted, and `updated_by` null is accepted; deleting that
    person afterwards is refused (`restrict`).
  - `"holds exactly the four named CHECKs"` (guard for "a per-module rule is a trigger, never a
    CHECK"): from `select sql from sqlite_schema where name = 'settings'`, the names after
    `CONSTRAINT` equal `["settings_doc_ck", "settings_module_ck", "settings_revision_ck", "settings_version_ck"]`
    sorted, and the text holds exactly four case-insensitive `check(` occurrences, so an unnamed CHECK
    fails too. Weaker than the rule: it reads the built table's text, so it cannot tell what each
    check enforces, and a per-module rule written as a CHECK on another table is not its business.

  The SQL these cases rest on was run on `node:sqlite` on 2026-11-08 in a scratch database (not the
  real schema): `Bad`, `a-b`, `""` and `_x` printed `CHECK constraint failed: settings_module_ck`,
  `business_day` inserted; `not json`, `[1]` and `"s"` printed `settings_doc_ck`.

- [ ] **Step 3: Run them and see them fail.**
  `pnpm --filter @waitron/db exec vitest run src/settings.test.ts` — FAIL, `no such table: settings`.

- [ ] **Step 4: Declare the table** in `packages/db/src/schema/settings.ts`:
  `module: label("module").primaryKey().notNull()` (a text primary key admits null without
  `notNull`), `version: count("version").notNull()`, `revision: count("revision").notNull()`,
  `doc: json<Record<string, unknown>>("doc").notNull()`,
  `updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso)`, `updatedBy: id("updated_by")`;
  `foreignKey({ columns: [t.updatedBy], foreignColumns: [persons.id], name: "settings_updated_by_fk" }).onDelete("restrict")`
  (shape of `packages/db/src/schema/identity/recovery-codes.ts:17-21`); the four CHECKs:
  - `settings_module_ck`: `` sql`${t.module} glob '[a-z]*' and ${t.module} not glob '*[^a-z0-9_]*'` ``
  - `settings_version_ck`: `` sql`${t.version} >= 1` ``
  - `settings_revision_ck`: `` sql`${t.revision} >= 1` ``
  - `settings_doc_ck`: `` sql`case when json_valid(${t.doc}) then json_type(${t.doc}) = 'object' else 0 end` ``
    (`json_type` on text that is not JSON is an error, not a false, so the `case` guards it).

  No index on `updated_by`: the table holds one row per module.
  Export it from `schema/index.ts` and from the root `index.ts`. Add to `CORE_OWN_CLASSIFICATION`:
  `classify("settings", "state", "each module's configuration document; copied to a standby, never drained back")`.

- [ ] **Step 5: Rebuild core's starting migration:**
  `pnpm --filter @waitron/server migration-baseline rebuild --set core` (rules §2). Never edit
  `drizzle/*` or the epoch file by hand.

- [ ] **Step 6: Update the guards, not loosen them.**
  - `scripts/schema-constraints.test.ts`: add `["settings", ["updated_by"], "persons"]` to
    `EXPECTED_FOREIGN_KEYS`, and `settings_doc_ck`, `settings_module_ck`, `settings_revision_ck`,
    `settings_version_ck` to `EXPECTED_CHECK_CONSTRAINTS`, each in alphabetical place.
  - `apps/server/src/personal-data-actions.coverage.test.ts`: add `"settings.updated_by"` to the
    `NOT_YET` list (it matches the guard's `by$` pattern; the download does not carry it yet).
  - `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`: add `"settings"` to
    `ADDED_TABLES` (the seed writes no row to it).

- [ ] **Step 7: Run and see them pass.** Finish-line command 1 (this file only), the
  `schema-constraints`, `classification-complete`, `starting-migrations`, `append-only-triggers`,
  `behavioural-triggers` and `migration-upgrade` files of command 3, and
  `pnpm --filter @waitron/server exec vitest run src/personal-data-actions.coverage.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts`.

- [ ] **Step 8: Commit** — `git commit -s`, message citing design README §3 "Shared tables" as the
  reason a new table enters core's set (rules §9), and the reset line (rules §2).

### Task 2: The typed API — define, read, save

**Files:**
- Create: `packages/db/src/settings.ts`
- Modify: `packages/db/src/errors.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/settings.test.ts` (describes `"defineSettingsDocument"`, `"readSettings"`,
  `"saveSettings"`)

**Interfaces:**
- Consumes: Task 1's `settings` table.
- Produces: everything under `packages/db/src/settings.ts` and the two error codes in
  **Interfaces fixed by this slice**.

Test documents, local to the test file:

```ts
interface Probe { size: number; unit: string }
const PROBE = defineSettingsDocument<Probe>({ module: "probe", version: 1,
  defaults: () => ({ size: 0, unit: "cm" }),
  parse: /* ok when size is an integer 0–10 and unit "cm" | "in"; an unknown key is refused by name;
            a unit written " cm " is answered "cm" (normalised) */,
  transfers: false });
```

- [ ] **Step 1: Write the failing cases.**
  - `defineSettingsDocument` throws an `Error` naming the problem for a key `"Probe"` and for version
    `0` and `1.5`; it returns the definition unchanged for `PROBE`.
  - `readSettings` with no row: `toEqual({ doc: { size: 0, unit: "cm" }, revision: 0 })`; two reads
    return different objects (mutating one leaves the next read's defaults intact).
  - `readSettings` of a raw row `('probe', 1, 3, '{"size":2,"unit":"in"}', …)`:
    `{ doc: { size: 2, unit: "in" }, revision: 3 }`.
  - `readSettings` refuses with `AppError` `settings.invalid`
    `{ module: "probe", field: "version", version: 2 }` a row at version 2 (no upgrade before
    go-live), and `{ module: "probe", field: "size" }` a row `'{"size":99,"unit":"cm"}'` at version 1
    (`toMatchObject({ code, params })`, per CLAUDE.md §4 "Rejected writes assert the domain error
    code").
  - `saveSettings` with `expectedRevision: 0` and no row: returns `{ doc, revision: 1 }`; the row
    holds `version` 1, `revision` 1, `updated_by` the fixture person, and an `updated_at` equal to
    the faked clock.
  - `"stores the checked document, not the one offered"`: saving `{ size: 2, unit: " cm " }` stores
    `doc` `'{"size":2,"unit":"cm"}'` and returns that doc.
  - Saving again with `expectedRevision: 1`: revision 2.
  - Two saves both naming revision 0: the second is refused `settings.out_of_date`
    `{ module: "probe", revision: 1 }` and the first's document is what a read returns.
  - A save naming revision 5 with no row: refused `{ module: "probe", revision: 0 }`; nothing
    written.
  - A save whose doc fails `parse`: refused `settings.invalid` `{ module: "probe", field: "unit" }`;
    nothing written.
  - `expectedRevision` of `-1` or `1.5` throws `RangeError` (a caller's bug, as
    `packages/adjustments/src/settings.ts:41-58` treats one today).
  - `personId: null` saves with `updated_by` null.

- [ ] **Step 2: Run them and see them fail** — `defineSettingsDocument is not a function`.

- [ ] **Step 3: Implement** `packages/db/src/settings.ts` with the signatures in **Interfaces**.
  - `readSettings`: select the row by `module`; absent → defaults, revision 0; a stored version other
    than `definition.version` → `settings.invalid` with `field: "version"` and the stored version;
    otherwise `parse`, throwing `settings.invalid` on a fault. Never writes.
  - `saveSettings`: `parse(change.doc)` first (fault → `settings.invalid`); the doc `parse` returns
    is what is stored and returned. `expectedRevision === 0` → insert with revision 1 and
    `.onConflictDoNothing({ target: settings.module })` (named target, CLAUDE.md §3), `returning` the
    revision; otherwise update `set` doc, `version: definition.version`, `revision: revision + 1`,
    `updatedAt: nowIso()`, `updatedBy` `where module = ? and revision = ?`, `returning` the revision.
    No row returned → read the current revision (0 if absent) and throw `settings.out_of_date`.
  - Declare both codes in `packages/db/src/errors.ts` with a one-line doc comment each.

- [ ] **Step 4: Run and see them pass** — the db file, then
  `pnpm exec vitest run scripts/errors-reachable.test.ts`.

- [ ] **Step 5: Mutation check.** `pnpm --filter @waitron/db exec stryker run --mutate src/settings.ts`
  — at least 90; add the case that kills a survivor, never an ignore comment (CLAUDE.md §2).

- [ ] **Step 6: Commit.**

### Task 3: One module's save wakes only its own screens

**Files:**
- Modify: `packages/shared/src/live-updates.ts`, `packages/db/src/change-feed.ts:44-51,103-133`,
  `packages/db/src/classification.ts:492-498`, `packages/module/src/module.ts:1531`,
  `apps/server/src/live-resources.ts:10-24`, `apps/server/src/boot.ts:2216-2223`,
  `scripts/live-subscriptions.test.ts:12`
- Test: `packages/db/src/change-feed.test.ts`, `packages/db/src/classification.test.ts`,
  `apps/server/src/live-api.settings.test.ts`

**Interfaces:**
- Consumes: Task 2's `defineSettingsDocument`, `saveSettings`.
- Produces: `ChangeSource.typeSuffixColumn`, `SETTINGS_CHANGE_TYPE`, `settingsChangeType`,
  `WaitronModule.settings`, the two-parameter `liveResourceTypes`.

Why the change is needed (tables-venuebox §2.4, read, and confirmed at HEAD): the change trigger
adds an id only when the table has a column named `id` (`packages/db/src/change-feed.ts:44-51,115`),
so a `settings` row change would be `{ "type": "settings" }`, and the server matches every interest
of that type (`apps/server/src/live-api.ts:117-121`).

- [ ] **Step 1: Write the failing change-feed cases** in `packages/db/src/change-feed.test.ts`:
  add probe table `live_probe_suffixed (module text primary key not null, doc text)` to the suite's
  setup with source `{ table: "live_probe_suffixed", type: "suffixed", typeSuffixColumn: "module" }`,
  and probe table `live_probe_nullable (id text primary key, module text)` with no source.
  - `"types a suffixed source's change by its column's value, with no id"`: insert `('menu', '{}')`
    → `[{ resources: [{ type: "suffixed.menu" }] }]`; update its doc → two rows, both
    `suffixed.menu`; delete → `suffixed.menu`.
  - `"refuses a suffix column the table lacks, one that is not a plain name, or one that may be null"`:
    `installChangeFeed` with `typeSuffixColumn: "nope"` rejects naming `nope`; with `'a"b'` rejects
    as not a plain column name; on `live_probe_nullable` with `typeSuffixColumn: "module"` rejects
    naming the column as nullable (a null would emit `{"type":null}`). The earlier install still
    answers the insert case afterwards.
  - In `classification.test.ts`: `CORE_CHANGE_SOURCES` contains
    `{ table: "settings", type: "settings", typeSuffixColumn: "module", related: [] }`.

- [ ] **Step 2: Write the failing measurement** `apps/server/src/live-api.settings.test.ts`
  (tables-venuebox §8.1). Fixture as `apps/server/src/live-api.test.ts:30-48` (a manager person and
  a management session), suite `useVenueDb({ migrations: [CORE_MIGRATIONS], setup: (db) => installChangeFeed(db, CORE_CHANGE_SOURCES) })`,
  bus wired as `:326-327` (`subscribeToChanges(changeSubscriber(bus, …))`), app mounted with
  `resourceTypes: liveResourceTypes(CORE_CHANGE_SOURCES, ["venue", "menu"])`. Test documents
  `VENUE_PROBE` (key `venue`) and `MENU_PROBE` (key `menu`), each `{ note: string }`. Every stream
  read goes through a local `readWithin(reader, 5_000)` that rejects with "no event within 5 s", so a
  broken feed fails the case rather than hanging it; the cases' own time limit is 20 s.
  - `"a save to one module's document wakes only that module's subscribers"`: open stream A on
    `[{"type":"settings.venue"}]` and stream B on `[{"type":"settings.menu"}]`, read each `ready`;
    save `MENU_PROBE`; B's next message is exactly
    `'event: change\ndata: [{"type":"settings.menu"}]\n\n'`; then save `VENUE_PROBE`; A's next
    message is exactly `'event: change\ndata: [{"type":"settings.venue"}]\n\n'`. **The failing case**
    prints A's first change as `settings.menu` (or both in one batch); the venue save is the control
    that A is listening at all.
  - `"refuses a subscription to the bare settings type"`: `[{"type":"settings"}]` answers 400
    `management.request_invalid` `{ field: "resources" }`.

- [ ] **Step 3: Run both files and see them fail.**

- [ ] **Step 4: Implement.**
  - `live-updates.ts`: the field, the constant and the function in **Interfaces**.
  - `change-feed.ts`: in `installChangeFeed`, read each column's `notnull` as well as its name; check
    `typeSuffixColumn` with `plainName("column", …)`, refuse one not in the table
    (`change feed: no column named <c> on <table>`) and one that is nullable
    (`change feed: <table>.<c> may be null`); in `identitySql`, when the source has a suffix column,
    the type expression is `${quoteLiteral(type)} || '.' || ${row}."${column}"` and no id is added.
    (Run on `node:sqlite`, 2026-11-08, scratch database: a trigger
    `json_object('type', 'settings' || '.' || new."module")` wrote `{"type":"settings.business_day"}`.)
  - `classification.ts`: the `settings` source gets `type: SETTINGS_CHANGE_TYPE, typeSuffixColumn: "module"`.
  - `module.ts`: the `settings` seat, with a one-line comment that boot admits
    `settings.<module>` for each document listed.
  - `live-resources.ts`: a source with `typeSuffixColumn` contributes its related types but not its
    own bare type; add `settingsModules.map(settingsChangeType)`.
  - `boot.ts:2223`: `liveResourceTypes(changeSources, setsToMigrate.flatMap((module) => (module.settings ?? []).map((document) => document.module)))`.
  - `scripts/live-subscriptions.test.ts:12`: pass the same keys from `ALL_MODULES`.

- [ ] **Step 5: Run and see them pass**, plus `src/live-api.test.ts` and
  `scripts/live-subscriptions.test.ts`.

- [ ] **Step 6: Commit.**

### Task 4: The per-module rule pattern, and keeping documents out of migrations

**Files:**
- Create: `apps/server/src/backup-verification.settings.test.ts`, `scripts/settings-not-migrated.test.ts`
- Test: `packages/db/src/settings.test.ts` (describe `"a per-module rule on settings"`)

**Interfaces:**
- Consumes: `defineSettingsDocument`, `saveSettings`, `triggerRaised`
  (`packages/db/src/constraint-target.ts:224`), `useBackupVerificationFixture`
  (`apps/server/src/testing/backup-verification-fixture.ts:109`).
- Produces: no product code; the pattern Task 5 documents.

- [ ] **Step 1: The rule pattern, as a test.** A second `useVenueDb` suite in the db file whose
  `setup` installs two sample triggers in that test database only, written exactly as the
  convention will say:
  `settings_probe_size_insert` `before insert on settings when new.module = 'probe' and json_extract(new.doc, '$.size') > 3 begin select raise(abort, 'probe.too_big'); end`
  and `settings_probe_size_update` (`before update of doc on settings`, same `when` and body).
  Cases:
  - `"refuses the module's bad document through saveSettings"`: a save of `{ size: 4, unit: "cm" }`
    under `PROBE` rejects and `triggerRaised(error, "probe.too_big")` is true; a later update from
    size 2 to size 4 is refused the same way.
  - `"leaves the module's good document and every other module's alone"`: size 3 under `probe`
    saves; size 4 under a document keyed `other` saves.
  (Run 2026-11-08 on `node:sqlite` in a scratch database: the insert trigger printed
  `probe.too_big` for `probe` size 4 and let size 3 and key `other` through.)

- [ ] **Step 2: A restored settings row that differs is refused**,
  `apps/server/src/backup-verification.settings.test.ts`, with
  `const suite = useBackupVerificationFixture()` and the `verify` helper of
  `apps/server/src/backup-verification.installed.test.ts:26-34` (copy it; it is nine lines).
  - `"refuses a restored settings row that differs from the backup's"`: put
    `('probe', 1, 3, '{"size":2,"unit":"cm"}', <verificationTime>, null)` into the backup with
    `f.corrupt`. Control first: `verify(f)` answers `passed`, so the row itself is acceptable. Then
    spy `placement.placeBackupData` as in `backup-verification.installed.test.ts:173-195` to run
    `update settings set doc = '{"size":3,"unit":"cm"}' where module = 'probe'` in the restored
    `venue.db`: the answer is `invalid` and core's module status is `invalid`.

  What this shows, and no more: core's row comparison (`packages/db/src/backup-evidence.ts:40-95`,
  over every core table, `:97-107`) refuses a restored `settings` row that is not the backup's. It
  runs no migration, so it does not show that no migration rewrites documents; Step 3's scan and
  Task 1's pinned CHECKs are what guard that rule.

- [ ] **Step 3: No migration SQL writes `settings`.** `scripts/settings-not-migrated.test.ts`:
  - `"no migration or trigger SQL writes the settings table"`: for every file matching
    `packages/*/drizzle/*.sql` and `packages/*/triggers/*.sql`, with `--` comments blanked, no match
    of `/\b(?:insert(?:\s+or\s+\w+)?\s+into|replace\s+into|delete\s+from)\s+[`"]?settings[`"]?(?![\w])|\bupdate(?:\s+or\s+\w+)?\s+[`"]?settings[`"]?\s+set\b/i`;
    the failure message names each file and says a document's shape changes on read, never in a
    migration (README §5 U2).
  - `"sees a write it should refuse, and passes a rule on settings"`: the same reader applied to the
    strings `"INSERT INTO \`settings\` VALUES (1)"` and `"update settings set doc = '{}'"` reports a
    write; `"create trigger x before insert on settings when new.module = 'a' begin select raise(abort, 'a'); end"`
    and `"CREATE TABLE \`settings\` ("` report none.
  - `"reads some SQL"`: the file list is not empty and includes `packages/db/drizzle/0000_baseline.sql`.

  Weaker than the rule: it reads SQL text, so a write made in TypeScript at migration or start
  (an installer inside `applyMigrations`, a boot step) is not seen, nor a write through a view or a
  name built at run time.

- [ ] **Step 4: Run all three** and see them pass; prove the scan by deletion: append
  `update settings set doc = '{}';` to `packages/db/triggers/core.sql`, run
  `pnpm exec vitest run scripts/settings-not-migrated.test.ts`, see it name that file, then
  `git checkout packages/db/triggers/core.sql` (CLAUDE.md §4 "Prove a guard by deletion").

- [ ] **Step 5: Commit.**

### Task 5: The write-path rule restated, the settings convention, protection list, finish

**Files:**
- Modify: `scripts/write-path-tables.json`, `scripts/write-path-tables.test.ts`, `CLAUDE.md`,
  `docs/developers/conventions-data.md`, `docs/developers/grants-retirement-audit.md:53`

The rewording below is slice 2's text (`2026-11-08-a1308-2-activity-log.md`, Task 2 Step 4 and Task
4 Steps 1–2), copied with `settings` in place of `activity_log`, because 1b-i lands first in lane 1
and `settings` is written on request paths, which makes today's "may read and never write" false.

- [ ] **Step 1: The guard.**
  - `scripts/write-path-tables.json`: add `"settings": ["packages/db/src/settings.ts"]`.
  - `scripts/write-path-tables.test.ts` header (`:6-9`): "The tables whose writes live only in the
    files `write-path-tables.json` names: venue.db's `tenants`, `nodes`, `deployment` and
    `settings`, and node.db's …" (the node.db list unchanged). Add the "why" line:
    "`packages/db/src/settings.ts` `saveSettings`, the one writer of `settings`, so every document
    passes its module's checker and its revision check."
  - Rename `describe("no source writes a table the application role may only read")` (`:170`) to
    `describe("no source writes a listed table outside the files the JSON names")`, and
    `it("keeps every table whose writes belong in the named provisioning or identity files")`
    (`:192`) to `it("keeps every table whose writes live only in named files")`; add `"settings"`
    to that case's pinned list (`:193-205`).
  - The failure message (`:180-186`) becomes: "This guard is the ONLY thing refusing this write:
    SQLite has no roles, so nothing at runtime will stop it. A write of these tables lives only in
    the files scripts/write-path-tables.json names. Move the write into one of them, or add the
    file to the JSON only if it is where such a write belongs, and say why in this file's header:"
    followed by the offenders, as now.
  - Run `pnpm exec vitest run scripts/write-path-tables.test.ts` (PASS). Prove the allowance by
    deletion: set `"settings": []` (removing the key would take the table out of the guard's list,
    `:101-103`), see "finds no forbidden write" fail with
    `packages/db/src/settings.ts writes settings`; restore it.

- [ ] **Step 2: `CLAUDE.md` §3.** Replace the write-path rule (`CLAUDE.md:467-471`) with slice 2's
  text: "**A write of a table `scripts/write-path-tables.json` lists lives only in the files that
  JSON names; the database refuses no write elsewhere.** Guard: `scripts/write-path-tables.test.ts`
  is the whole of the enforcement, weaker than its name: it reads TEXT and judges a FILE, not a call
  chain. Receipt: [conventions-data.md](docs/developers/conventions-data.md#a-write-of-a-table-scriptswrite-path-tablesjson-lists-lives-only-in-the-files-it-names)."
  Then add, near the configuration-bundle rule: "**A module's configuration is one document in the
  shared `settings` table, declared with `defineSettingsDocument` and saved only through
  `saveSettings`; its shape changes on read, never in a migration (and not at all before go-live),
  and a per-module database rule is a trigger on `settings`, never a CHECK.** Guards:
  `scripts/settings-not-migrated.test.ts` (weaker than the rule: reads SQL text, not TypeScript run
  at migration or start) and the pinned-CHECK case in `packages/db/src/settings.test.ts` (reads the
  built table's text, not what each check does).
  [Detail](docs/developers/conventions-data.md#a-modules-settings-are-one-document-in-the-shared-settings-table)."

- [ ] **Step 3: `docs/developers/conventions-data.md`.**
  - Rename the heading at `:918` to "## A write of a table `scripts/write-path-tables.json` lists
    lives only in the files it names" (anchor
    `a-write-of-a-table-scriptswrite-path-tablesjson-lists-lives-only-in-the-files-it-names`), and
    the bold label above it (`:916`, "Tables the application code may read and never write") to
    "Tables whose writes live only in named files" (slice 2's plan does not name this label; the
    coordinator's note to slice 2 should). Add `settings` to its table list and one sentence:
    `settings` is written on request paths, through its one writer `packages/db/src/settings.ts`.
    Point `docs/developers/grants-retirement-audit.md:53` at the new anchor.
  - New section after "A column of a transferred table that holds another row's id…" (`:1857`),
    headed `## A module's settings are one document in the shared settings table`. It states, each
    with its pointer: declare with `defineSettingsDocument`, read with `readSettings`, save with
    `saveSettings` (the only writer); what is stored is what the checker returns; a save names the
    revision it read and a route answers `settings.out_of_date` with 409 and `settings.invalid`
    with 500; a shape change happens on read and is saved by the next save, never in a migration,
    and not at all before go-live (a read refuses another version; the first change after go-live
    adds an upgrade step and tables-venuebox §8.3's backup measurement); the live type is
    `settings.<module>` and a dashboard query depends on that string; no row id inside a document
    beyond R4's exception; a per-module database rule is a pair of triggers in
    `packages/db/triggers/core.sql` named `settings_<module>_<rule>_insert` and `_update`,
    `before insert` and `before update of doc on settings`, `when new.module = '<module>'`,
    raising the domain code with `raise(abort, '<code>')`, matched by the caller with
    `triggerRaised` (Task 4's cases); never a CHECK, which would rebuild the table; saves are not
    recorded in `activity_log` (only the latest saver and time are kept). Say what the guards do
    not see: nothing checks that a document holds no row ids, nothing makes a module declare its
    document in the `settings` seat, and the migration scan reads SQL only.
  - Run `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and
    `pnpm exec prettier --check CLAUDE.md`.

- [ ] **Step 4: Protection list.** From `apps/server`:
  `pnpm protection-list list --out <empty absolute dir B>` then
  `pnpm protection-list compare --old <A> --new <B> --report <absolute file>`. Paste the report in
  the pull request and mark each line against **Expected protection-list difference**. An
  unpredicted line is a stop.

- [ ] **Step 5: Run the whole finish line**, then commit and run `/finish-branch` (rules §9). The
  pull request description names this plan, the split, the no-upgrade decision, and the predicted
  protection-list lines.
