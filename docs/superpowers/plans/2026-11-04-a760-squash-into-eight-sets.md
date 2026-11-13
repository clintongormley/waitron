# A760: squash the migration history into eight sets — Implementation Plan

> 2026-11-13: the nightly sharded callers now use `mutation-sharded.yml` and its `aggregate` job. The old aggregate names below describe the earlier workflow. See [the current workflow guide](../../developers/ci-and-gates.md#mutation-floors-and-where-each-one-actually-bites).

> **2026-11-07 (A1422):** `scripts/fixtures/a760-history/` and the tests that replayed it were
> deleted on the owner's word; the files are readable at commit f519799de0.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace today's migration history with one starting migration in each of U1's eight sets,
with every table, protection and behaviour unchanged, so A1308's later slices can edit those
starting migrations instead of adding steps.

**Architecture:** three pull requests, so the lanes stop only for the last. PR 1 teaches the code
that a module may have no migration set of its own, and builds the comparison tools. PR 2 moves the
table definitions while every set stays as it is. PR 3, under the watcher's freeze, merges the sets
and replaces the history. After each, the protection list from
[slice 0](2026-11-04-a1308-slice-0-bench.md) must print `EQUAL` against the previous base.

**Tech stack:** drizzle-kit 0.31, `node:sqlite`, pnpm workspaces, Vitest, GitHub CI.

**Spec:** [the design](../specs/2026-11-02-rationalisation/README.md), §5 U1 and §9 step 2.
**Procedure:** [the A760 runbook](../../operations/a760-migration-squash.md) and its
[inventory](../../operations/a760-migration-squash-inventory.md). Both are dated 16 October; refresh
every count and line number at the execution head.

## What changes from the runbook

The runbook governs everything this table does not change: the freeze mechanics, the `main.lock`
hold, the throwaway old clone, normalisation, the negative controls, the upgrade walk's five rules,
the shipped-copy checks, the old-epoch refusals, the reset roster and the stop points.

| Runbook says | This plan says | Why |
| --- | --- | --- |
| One baseline per set; 15 sets; keep the manifest, descriptors, `requires` and classification unchanged (`:47-52`, `:96-98`) | Eight sets. Today there are 16, and `handover` makes 17 once A1018 Slice 5 lands. Those files change | U1, approved 4 November |
| One PR, one job, no delegation | Three PRs. Only PR 3 needs the freeze. Implementers are subagents, one at a time on one branch | Shortens the freeze; `implementer` rule in `~/.claude/CLAUDE.md` |
| Finish or withdraw **every** migration branch; a parked one blocks | A790 Cut A (#2455), A802, A799 and A739 do not block. Pin the base without them. They land afterwards with regenerated migrations. There is no A790 Cut B. Every other migration branch still blocks | Owner, 4 November |
| `inventory` and `compare` are built here, with `--repo` | They exist from slice 0, as `protection-list list` and `compare`. Each checkout runs its own copy, so there is no `--repo` | One tool; the old clone holds it because slice 0 lands first |
| The new `scripts/migration-baseline.mjs`, run with `--repo` | Built in Task 4 as `apps/server/scripts/migration-baseline/`, run from `apps/server` as `pnpm migration-baseline preserve\|controls\|copies`, with no `--repo` | Beside slice 0's protection-list, which it builds on |
| `compare` exits 1 on any failure; `inventory` saves drizzle snapshots and every SQL statement with its file and line | `compare` exits 1 on a difference and 2 on a refusal (1 through `pnpm -s`), a list with nothing to compare among them; `list` saves no drizzle snapshots and no statement's file and line | As slice 0 built them |
| The owner resets the home box on return after 2 November | The home box stays quarantined until A1308 ends, then is reset once | Design §6; hold file |
| "Land only after green review and CI" | PR 3 replaces the fiscal set's SQL, so it waits for the owner's `/land-branch` | `lanes-land-their-own-prs` |
| Stop if any fiscal test must change | Six named fiscal test files change their setup only (see Global Constraints) | Owner, 4 November |
| A parked branch is withdrawn, so it cannot bring old schema back | The four kept branches can: a new file in a retired folder rebases cleanly and silently creates no table. Task 15's guard refuses it | Reviewed 4 November |

## The eight sets

| Set after | Takes in | Journal table | Source home |
| --- | --- | --- | --- |
| `core` | core, catalogue, venue-service, media, adjustments, credentials, identity, handover | `__drizzle_migrations_db` | `packages/db` |
| `node` | node | `__drizzle_migrations_node` | `packages/node-db` |
| `workforce` | workforce, staffing | `__drizzle_migrations_workforce` | `packages/workforce` |
| `workforce-es` | unchanged | `__drizzle_migrations_workforce_es` | `packages/workforce-es` |
| `payments` | payments, scheduler | `__drizzle_migrations_payments` | `packages/payments` |
| `bookings` | unchanged | `__drizzle_migrations_bookings` | `packages/bookings` |
| `fiscal-verifactu` | unchanged | `__drizzle_migrations_fiscal` | `packages/fiscal-verifactu` |
| `fiscal-none` | unchanged, empty | `__drizzle_migrations_fiscal_none` | `packages/fiscal-none` |

**`handover` goes into core.** A1018's plan gave it a set of its own, but its descriptor says
`tier: "mandatory"`, and U1's rule is that a module that cannot be switched off keeps its code as a
module while its tables go into core. Later A1018 slices add their tables to core.

**Modules stay.** Every module keeps its name, code, routes, permissions and seats. What leaves is
`migrations` and `classification`. `identity` and `credentials` become `tier: "mandatory"`.
`scheduler` stops being a module: its code folds into `@waitron/payments`, because its only job is
payment reconciliation, and a separate switch would let it run with its table absent. `staffing`
stays switchable, with its tables always present once workforce is on.

## Global Constraints

- **No table changes shape.** Names stay, including `scheduled_runs`. The protection list prints
  `EQUAL` on product schema for both fiscal compositions at every phase, after every PR.
- **Fiscal source stays unedited.** `packages/fiscal-verifactu/src/**`, its huella fixtures, golden
  assertions and `inmutabilidad` have zero diff, with one exception the owner approved on 4 November:
  **setup only** in `slot.test.ts`, `provisioning-secret.test.ts` and `aeat-transport.test.ts`, which
  drop `CREDENTIALS_MIGRATIONS`, and in `outage-upgrade.test.ts`, `clock-confirmations-upgrade.test.ts`
  and `record-replacement-upgrade.test.ts`, which read a frozen history fixture instead of cutting the
  journal at an old tag. Their assertions stay, and the PR lists each edit. `drain.ts:54` and `:1930`
  will name a package that has gone; leave them for the fiscal slice. Any other change: stop.
- **Behavioural assertions stay.** Mocks and setup may change; a test is never rewritten to match.
  Every changed test check goes in the PR description, before and after.
- **No Cloud change in these PRs.** The backup verification target keeps its format: one entry per
  set, each with its own journal table. Cloud pins the old names and digest in
  `deploy/backup-verifier/target.json` and `packages/backups/test/verification-target.test.ts:15-31`,
  and re-pins them from the merged `main` as a follow-up (Task 18).
- **Packages keep their public names.** A module package goes on exporting its tables, re-exported
  from `@waitron/db`, so importers elsewhere do not change.
- **Never hand-edit a journal or snapshot.** Regenerate.
- **Editing shipped migrations:** PR 3's first line says every existing venue needs a reset.
- Every commit `git commit -s`. Plain English in commits and PRs. No `git stash`.
- Worktrees through `python3 ~/workspace/tools/worktree.py new waitron <branch> --headless`.

## Review Focus

1. **Eight tables losing append-only protection in database suites.** `menu_versions`,
   `menu_version_images`, `sale_receipt_headers`, `bill_number_allocations`, `adjustments`,
   `adjustment_refunds`, `adjustment_lines` and `handover_activations` get their triggers today from
   their own descriptors.
   `CORE_MIGRATIONS` derives its list from `CORE_CLASSIFICATION`, so a core-only `useVenueDb` must
   refuse an update to each. Pinned in Task 11.
2. **The backup check quietly checking less.** A tampered table owned by a set-less module fails; the
   credentials secret check still runs; a venue with staffing on or off gets a verifiable copy. Pinned
   in Task 3.
3. **Old things meeting the new image.** An old database refuses with `provisioning.database_ahead`
   before any write. An old backup is refused. An old configuration bundle naming `catalogue` is
   refused. Pinned in Task 16.
4. **Trigger order across former sets.** Two triggers with the same table, timing and event from
   different old sets keep their old relative order, and media's bodies still name their tables.
   Triggers that differ in timing or event may move: installers run after a set's SQL. Pinned in
   Tasks 4 and 12.
5. **Module switches.** `{identity:false}` and `{credentials:false}` refuse with
   `module.mandatory_not_disableable`; `{scheduler:false}` refuses with `module.config_unknown`;
   `{staffing:false}` starts; `{payments:false}` runs no reconciliation duty. Pinned in Tasks 11 and 13.

---

# PR 1: `feat/a760-prepare`

**When:** after slice 0 lands. No freeze; changes no table. Touches a cross-package contract, so per-task
review applies.

### Task 1: The menu document's types leave catalogue

`@waitron/db` may depend only on `membership`, `shared`, `store` and `sync-enrolment`, so the imports
in Tasks 1 and 1b would close a loop once the schema files move.

**Files:**
- Create: `packages/shared/src/menu-document/`
- Modify: `packages/catalogue/src/menu-document-types.ts` and its closure of about 20 files, and
  every importer

`catalogue/src/schema/publication.ts:15` imports `MenuDocument`, and `sections.ts:16` imports
`IncludeFolderOverrides` and `SectionRole`. Move `menu-document-types.ts` and its closure into
`@waitron/shared`. The closure's only link to `core` and `fiscal` is `PricingUnit`
(`pricing.ts:17`), a plain union: move that too. These files are browser-safe and apps deep-import
some of them, which is why they go to `shared` rather than `db`. Leave no stub at the old path:
update each importer. A package's `index.ts` goes on exporting the names. Tests move with their
source. The three biggest files have 45, 31 and 26 importers: use a throwaway script.

- [ ] **Step 1: Move them.**
- [ ] **Step 2: Typecheck the affected packages and run `scripts/workspace-cycles.test.ts`,
  `scripts/english-only.test.ts` and the moved tests,** reading each `Tests` count.
- [ ] **Step 3: Run the protection list** and compare with slice 0's baseline: `EQUAL`.
- [ ] **Step 4: Commit.**

### Task 1b: The other imports

| Schema file | Imports | Fix |
| --- | --- | --- |
| `catalogue/src/schema/menu.ts:14-15` | `HOME_DISPLAY_DEFAULTS`, `HomeOrder`, `HomeTileMode` | Move `device-home.ts` and `color-inheritance.ts` to `@waitron/shared` |
| `catalogue/src/schema/settings.ts:4` | `VAT_CLASSES` | Move `vat-rates.ts` to `@waitron/shared` |
| `catalogue/src/schema/suggestions.ts:17` | `TRANSLATION_GAP_KINDS` | Move `content-translation-kinds.ts` to `@waitron/shared` |
| `venue-service/src/schema/kitchen-notices.ts:2`, `kitchen-allergy.ts:4` | types from `@waitron/module` (`module.ts:639`, `party-allergy.ts:3`) | Move those types to `@waitron/shared`; `@waitron/module` re-exports them |
| `venue-service/src/schema/menus.ts:14` | `CALENDAR_COLOURS` through `hours-types.ts` | Import from `@waitron/shared` directly |
| `adjustments/src/schema/adjustments.ts:19` | `ADJUSTMENT_ACTIONS`, `AdjustmentPolicySnapshot` from `policy.ts`, which value-imports identity | Move these two and `AdjustmentAction` to `@waitron/shared` |
| `adjustments/src/schema/reasons.ts:18`, `settings.ts:4` | `PersonRoleValue` | Move the type to `@waitron/shared` |

Keep every constant's value order: `enumType` writes it into the SQL. The same rules as Task 1 apply.

- [ ] **Step 1: Move them,** one row at a time.
- [ ] **Step 2: Confirm by search** that no schema file in the eight packages imports anything but
  drizzle, `@waitron/db`, `@waitron/shared`, each other, or (staffing only) workforce. The handover
  schema is not on main yet: Task 5 handles `activations.ts:3`.
- [ ] **Step 3:** Run the checks in Task 1's Steps 2 and 3.
- [ ] **Step 4:** `@waitron/shared` holds a 90 mutation floor, and `mutation-shared` runs on pull
  requests with a 10-minute limit. Read that job on this PR. Add assertions if the score falls, and
  split its shards if the job nears the limit.
- [ ] **Step 5: Commit.**

### Task 2: A module may have no set of its own

**Files:**
- Modify: `packages/module/src/module.ts`, and each reader below
- Test: `packages/module/src/module.test.ts`, `packages/composition/src/composition.test.ts`, each
  reader's suite

**Interfaces:**
- Produces, from `@waitron/module`:
  - `WaitronModule.migrations?: MigrationSetSource`, now optional.
  - `WaitronModule.tablesIn?: string`: the name of the module whose set holds this module's tables.
  - `modulesWithSets(modules): (WaitronModule & { migrations: MigrationSetSource })[]`.
  - `orderedMigrationSets` still sorts every module by `requires`, then returns sets for those with
    `migrations`, and throws `module.set_ownership_invalid` when a module has both or neither of
    `migrations`/`tablesIn`, its host is missing or has no set, or it has no set but carries a
    `classification` (which belongs in the host's).
  - `packageDirOf` still throws for a module with no set: guards filter first.

Readers that must use `modulesWithSets`: `apps/server/src/backup-manifest.ts:25`, `restore.ts:349`,
`handover-capture.ts:244`, `boot.ts:1221`; `packages/provisioning/src/first-setup-command-deployment.ts:96,:111`,
`first-setup-runtime.ts:117` (`first-setup-empty-database.ts:29` treats a name with no set as "not
empty"), `configuration-transfer.ts:573-580` (both the expected names and the version loop);
guards `scripts/schema-constraints.test.ts:880`, `module-graph-honesty.test.ts:104`,
`classification-complete.test.ts:19`, `append-only-migration-sets.test.ts:43`. Refresh this list with
`grep -rn '\.migrations\b' packages apps scripts`; the search, not this list, is the requirement.

- [ ] **Step 1: Write the failing tests.** A synthetic set-less module with `tablesIn: "core"`:
  `orderedMigrationSets` omits it and still orders by its `requires`; `schemaVersionsByModule` has no
  key for it; a configuration bundle round-trips without it; first-setup's expected sets omit it;
  `boot.ts:1229` does not log it as `toMigrate`.
  In `composition.test.ts`: every real module has exactly one of `migrations` and `tablesIn`, a
  `tablesIn` names a module with `migrations`, and a module without a set carries no `classification`.
- [ ] **Step 2: Run, and see them fail.**
- [ ] **Step 3: Implement.** Correct the JSDoc at `module.ts:1507`.
- [ ] **Step 4: Run** `packages/module`, `packages/composition`, `packages/provisioning` and the
  named server suites, and the four guards.
- [ ] **Step 5: Commit.**

### Task 3: The backup check covers a set, not a module

**Files:**
- Modify: `packages/module/src/backup-verification.ts`,
  `packages/composition/src/backup-verification.ts`,
  `apps/server/src/backup-verification-target.ts`, `backup-verification-compatibility.ts`
- Test: `packages/composition/src/backup-verification.test.ts`,
  `apps/server/src/backup-verification.test.ts`

**Interfaces:**
- Produces: `combineBackupVerification(host, hosted): BackupVerificationContribution`, exported from
  `@waitron/module` so `modules.ts` can use it; `backupVerificationInventory(modules)` returns one
  entry per set, combining its own contribution with that of every module in `modules` whose
  `tablesIn` names it. Its three callers (`backup-verification-compatibility.ts:140`,
  `backup-verification-target.ts:103`, `backup-verification.ts:180`) forward what they received,
  which is `ALL_MODULES` in production, so a switched-off module's tables stay covered. Never hard-code
  `ALL_MODULES` here: it would merge real modules into tests' synthetic `core`.

The verifier reads one entry per set with a unique journal table
(`backup-verification-protocol.ts:316`), and requires a set's classified tables to equal its
verification's tables (`backup-verification-compatibility.ts:171`). So the format stays, and Cloud
changes nothing. Combining: `data.tables`, `immutableTables`, `checks`, `secrets`, `effects` and
`entries` are unions, and `required` wins for a repeated entry; `kind` is `custom` if any is;
`targetOnly` is `unsupported` if any is; `zeroSchema` is the host's; `publicEvidenceDigest` is the
digest of the non-null values in order, or null if none. `verifyRestoredData` runs host first, then
each hosted module by name, and returns **one check per code**, since
`validateBackupModuleResult` refuses a repeated code, each with the worst status, and the worst
status overall. In the target, `requires` lists only names that are in the target.
`moduleConfig` (`backup-verification-compatibility.ts:106-107`) refuses any `modules.json` override
missing from the manifest's version map. A set-less module has no entry there, so a box overriding
`staffing`, on or off, would fail every backup. Change it to: an override naming a module with a set
must be in the version map; a set-less module is checked by `parseModuleConfig` alone. Do not remove
the clause: the "target only" test needs it.

- [ ] **Step 1: Write the failing tests.** With a real module set and a synthetic hosted module: a
  combined entry's tables are the union; `required` beats `optional`; the worst status wins; a check
  from a hosted module that fails fails the set; `credentials`' `secret` check is present in the
  combined result; two contributions sharing a check code return it once; a disabled hosted module's
  tables are still covered; a copy whose `modules.json` sets `staffing` true, and one setting it false,
  both pass; an override naming an unknown module still refuses. **For today's real modules,
  where nothing is hosted, `buildBackupVerificationTarget` gives byte-identical output to the
  previous commit:** pin the digest.
- [ ] **Step 2: Run, and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the composition suite and `apps/server/src/backup-verification*.test.ts`.
- [ ] **Step 5: Commit.**

### Task 4: The baseline tools

**Files:**
- Create: `apps/server/scripts/migration-baseline/preserve.ts`, `controls.ts`, `copies.ts`, `cli.ts`,
  and a `.test.ts` beside each
- Modify: `apps/server/scripts/protection-list/build.ts` (a `--path manifest` option alongside
  today's descriptor path)

**Interfaces:**
- Consumes: `SchemaListFile`, `compareSchemaLists`, `normaliseSql` from slice 0.
- Produces, with the runbook's contract at "Comparison and preservation contract", changed as
  follows:
  - `preserve --reference <dir> --set <name> --from <old-set,old-set,...>`: reads the reference's
    **`sql-only` phase**, or runtime append-only triggers would land in the baseline. It replaces
    generated `CREATE TABLE` and index text with the old final stored text across all the named old
    sets, and appends the final manual triggers in **old `sqlite_schema.rowid` order across all of them**.
    Refuses an object in one and not the other. Leaves journal and snapshot bytes alone.
  - `controls --reference <dir> --out <dir>` and `copies --dist <dir> --image-root <dir> --report <file>`
    as the runbook says, enumerating the current manifest.

- [ ] **Step 1: Write the failing tests** the runbook lists for these subcommands, plus: two triggers
  on one table from different old sets come out in old order; running `preserve` twice changes
  nothing; `preserve` leaves meta bytes unchanged; a generated table missing from the reference, and
  a reference table the generator lost, are both refused.
- [ ] **Step 2: Run, and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, and see them pass, then run `controls` on a list of the real schema:** every
  control fails for its stated reason and the unchanged copy prints `EQUAL`.
- [ ] **Step 5: Commit, then run `/finish-branch`** with this plan's path and the note "PR 1 only".

---

# PR 2: `refactor/a760-move-table-source`

**When:** after PR 1, and after A1018 Slice 5, A1131b-4 and A803 4b have landed, since each touches
these files or adds a table. No freeze: lanes keep working, because importers do not change. Check the
hold file for anything else in flight on a schema file.

The method for every task here:
1. `git mv` the package's `src/schema/*` to the new home. **A test goes with them only if it needs
   nothing from a package that depends on db.** Any test needing `../migrations.js` or a module
   package stays, because a `packages/db` test cannot import those: each `schema-conformance.test.ts`
   and `schema-ownership.test.ts`, `suggestions.db.test.ts`, `service.test.ts`,
   `bill-identities.test.ts`, `service-steps.test.ts`, staffing's `constraints.test.ts`,
   `adjustment-lines.test.ts`, handover's `schema.test.ts` and media's `name-only-upgrade.test.ts`.
   They move, where they can, in Task 11.
2. Turn `@waitron/db` imports in moved files into relative ones; a package may not depend on itself.
3. Point the set's `drizzle.config.ts` at the new barrel, for example
   `schema: "../db/src/schema/catalogue/index.ts"`. **The set itself does not change.**
4. List the moved names explicitly in `packages/db/src/index.ts`, and have the package's `index.ts`
   re-export those names from `@waitron/db`. Add an enumerated export to `packages/db/package.json`
   for the moved barrel (`"./schema/catalogue.js"`), because a kept conformance suite passes the barrel
   as `declarations`. Task 11 removes those exports.
5. Rewrite the package's own `../schema/*` and `./schema/*` imports, in `src/` and `test/`, with a
   throwaway script, not committed.
6. Keep the moved files **out of** `packages/db/src/schema/index.ts`, or core's generator would claim
   them: they join the barrel in Task 11. They sit behind `packages/db/src/schema/hosted.ts`.

Checks for every task: the package's typecheck; `scripts/migrations-match-schema.test.ts` and
`scripts/schema-constraints.test.ts`; the protection list compared with the base (`EQUAL`);
`git diff --stat origin/main -- 'packages/*/drizzle'` empty.

### Task 5: Move credentials, media, handover and identity into `@waitron/db`

**Files:** `packages/{credentials,media,handover,identity}/src/schema/**` to
`packages/db/src/schema/{credentials,media,handover,identity}/`; `packages/db/src/schema/hosted.ts`;
those packages' `drizzle.config.ts` and `index.ts`.

Media has no schema barrel: create one. Handover's `schema/activations.ts:3` imports
`../envelope.js`, which would close a loop: move what it needs to `@waitron/shared` first.

- [ ] Steps: the method above; the checks; commit.

### Task 6: Move catalogue and adjustments into `@waitron/db`

**Files:** `packages/{catalogue,adjustments}/src/schema/**` to `packages/db/src/schema/{catalogue,adjustments}/`.

`settings.ts` exists in both, so the folders keep them apart. `packages/db/src/schema/catalogue.ts`
already exists beside the new `catalogue/` folder and stays. Fix the two guards this move turns red in
this task, since the pre-push hook runs them: `scripts/catalogue-engine-neutral.test.ts:26-28,:41-42`
and `scripts/menu-sections-upgrade.test.ts:6-7`.

- [ ] Steps: the method above; the checks; commit.

### Task 7: Move venue-service into `@waitron/db`

**Files:** `packages/venue-service/src/schema/**` to `packages/db/src/schema/venue-service/`.

`service.ts:4` imports `menuItems` and `menuVersions` from `@waitron/catalogue`; that becomes a
relative import. This is the largest move: if it passes about 100 tool calls, hand over as the
global rule says.

- [ ] Steps: the method above; the checks; commit.

### Task 8: Move staffing's tables into workforce

**Files:** `packages/staffing/src/schema/**` to `packages/workforce/src/schema/staffing/`;
`packages/staffing/drizzle.config.ts`.

`staffing/src/schema/staffing.ts:15-18` imports `persons`, three venue-service tables,
`CALENDAR_COLOURS` and `shifts`: all resolve from `@waitron/db`, `@waitron/shared` or workforce.
`scheduled_runs` does not move here: scheduler may not import payments (`eslint.config.js:162-215`),
so it moves in Task 11 and the package folds straight after.

- [ ] Steps: the method above, with `packages/workforce` as the receiving barrel (same `hosted.ts`
  arrangement); the checks; commit.

### Task 9: Coverage and mutation for the moved source

`packages/db` must now cover the moved files at 98/98/98/95, including `$defaultFn` bodies, and its
Stryker config mutates `src/**/*.ts`. Of the moved packages only `handover` has a Stryker config, so
all but its one table file have never been mutation-tested, and until Task 11 the suites that would
kill their mutants sit in other packages. Hold them out of mutation for that one gap rather than let
the nightly run fail.

- [ ] **Step 1:** Run `pnpm --filter @waitron/db test:coverage` and read the per-file table. Add a
  test for any moved file below the bar: a `$defaultFn` can be called directly. Never add a coverage
  exclude or an ignore comment.
- [ ] **Step 2:** Run the package suites that lost their schema tests, for their own bars.
- [ ] **Step 3:** Add one entry per moved folder to `mutate` in `packages/db/stryker.config.json`,
  as exclusions (`!src/schema/catalogue/**` and so on). The only check this suspends is
  `activations.ts`'s, until Task 16 removes them all. The PR description says so.
- [ ] **Step 4:** Compare the db suite's duration with the base, for CLAUDE.md's 4-minute budget.
- [ ] **Step 5: Commit, then run `/finish-branch`** with this plan's path and the note "PR 2 only".

---

# PR 3: `feat/a760-migration-squash`

**When:** the watcher has recorded the freeze and the named reset roster in the runbook, and no plan
but this one is running on Waitron. **Tell the watcher when PR 2 lands, so it can drain the lanes.**
Expect the tree to stay red from Task 11 until Task 15: commit at each task end anyway, and say so.

### Task 10: Clearance, the old reference and the history fixtures

> **2026-11-07 (A1422):** `scripts/fixtures/a760-history/` and the tests that replayed it were
> deleted on the owner's word; the files are readable at commit f519799de0.

Follow the runbook's "Freeze before you create the squash branch", "Capture the old reference" and
"Adapt the history consumers before generation", with this plan's overrides.

- [ ] **Step 1:** Confirm the freeze, take `main.lock`, reconcile both repositories, and list every
  migration branch. A790, A802, A799 and A739 may remain; anything else stops the job.
- [ ] **Step 2:** Pin `A760_BASE`; clone the old reference; refresh the runbook's history-consumer
  searches, the inventory's counts, and Cloud's pinned checkout and rehearsal roots.
- [ ] **Step 3:** Build the old `protection-list` from the clone, for source; `controls` must pass.
- [ ] **Step 4:** Capture the frozen predecessor fixtures into `scripts/fixtures/a760-history/`, with
  provenance, change only fixture selection in each test, and confirm those suites pass before any
  history is deleted. Include `packages/media/src/schema/name-only-upgrade.test.ts`,
  `scripts/menu-sections-upgrade.test.ts`, and the three fiscal upgrade tests in the approved
  exception, which are not in the inventory. A test that would pass vacuously after the squash is a
  defect: run each once with the frozen fixture, then confirm it fails if the migration under test
  is removed from the fixture.
- [ ] **Step 5: Commit.**

### Task 11: Merge the sets

**Files:**
- Modify: `packages/db/src/schema/index.ts` (fold `hosted.ts` in); `packages/db/src/classification.ts`;
  `packages/db/src/index.ts`; `packages/composition/src/modules.ts`, `packages/media/src/module.ts`;
  `packages/migrations/migrations.manifest.json`; `packages/workforce/src/classification.ts`;
  `packages/payments/src/classification.ts`
- Move: each kept suite from PR 2's method that can now live with its tables, and each retiring
  set's `schema-conformance.test.ts` into
  `packages/db/src/schema/schema-conformance.test.ts` (staffing's to workforce's, scheduler's to
  payments'), with the exact cases kept. Media, scheduler and credentials set
  `declaresClosedVocabularies: false` where core sets `true`: keep each table under its old setting
- Move: `packages/scheduler/src/schema/scheduled-runs.ts` to `packages/payments/src/schema/`
- Delete: from catalogue, venue-service, media, adjustments, credentials, identity, handover, staffing
  and scheduler, `migrations.ts` and `drizzle.config.ts`. **`classification.ts` stays in part:** five
  of them also hold `*_CHANGE_SOURCES`, which stay, and each `backup-verification.ts` derives its table
  list from `*_CLASSIFICATION` (`packages/identity/src/backup-verification.ts:20,:43,:187`), and four
  `*_CHANGE_SOURCES` read it too. Keep a plain `*_TABLES` name list in the module for those.
  **`migrations.test.ts` holds 102 real cases:** move them to the receiving package rather than
  delete them. Also move or change the suites that read a retired classification:
  every `classification.test.ts` and `index.test.ts`, `kitchen-allergy`, `sale-receipt-headers:20`,
  `options:602`, media's `module.test.ts:38`, handover's `schema.test.ts:17`,
  `catalogue-media-backup-verification.test.ts`

**Interfaces:**
- Produces: `CORE_MIGRATIONS` with every core-set append-only table; the eight manifest entries, whose
  `appendOnlyTables` are the union of the old ones; module descriptors with `tablesIn` and no
  `migrations` or `classification`, `scheduler` with `tablesIn: "payments"` until Task 13 removes it;
  `identity` and `credentials` at `tier: "mandatory"`; every `hosted.ts` folded into its barrel.

Move classification entries, with their reasons unchanged, into the receiving package: it holds the
tables, and `@waitron/db` cannot import a module's classification. Keep each module's `backup`,
`changes`, `configurationTransfer`, `provisioning` and other seats. `requires` stays as it is, which
keeps set order correct. Delete the `*_MIGRATIONS` exports.

- [ ] **Step 1: Write the failing tests.** In `packages/db/src/classification.test.ts`: a core-only
  `useVenueDb` refuses an update to each of the eight tables in Review Focus 1, asserting the
  database's own append-only refusal and accepting an insert. In `composition.test.ts`: eight sets;
  the manifest equal to the descriptors; and the union of each set's module `*_TABLES` equal to the
  set's classification. In `apps/server/src/boot.test.ts`: `{identity:false}` and
  `{credentials:false}` refuse, and `{staffing:false}` starts.
- [ ] **Step 2: Run, and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Commit.** These tests stay red until Task 12 generates the SQL; the `boot.test.ts`
  cases stay red until Task 14 has replaced the retired constants.

### Task 12: Generate and preserve the baselines

Follow the runbook's "Generate and preserve one baseline per set", changed as follows.

- [ ] **Step 1:** Check the list below against the manifest. In this worktree only, delete the old
  `drizzle/` folders and generate once for each of `db`, `node-db`, `workforce`, `workforce-es`,
  `payments`, `bookings` and `fiscal-verifactu`, with `db:generate --name baseline`, logging each.
  Leave `fiscal-none` byte-identical. Reject a prompt, import error, missing file or extra entry.
  Measure the time `db` takes: `scripts/migrations-match-schema.test.ts:38-44` bounds it at 300
  seconds, measured on smaller sets. If the generator's time needs a higher bound, change it with the
  measurement.
- [ ] **Step 2:** Run `preserve` for each set, with `--from` as in this table:

| `--set` | `--from` |
| --- | --- |
| `core` | `core,catalogue,venue-service,media,adjustments,credentials,identity,handover` |
| `workforce` | `workforce,staffing` |
| `payments` | `payments,scheduler` |
| `node`, `workforce-es`, `bookings`, `fiscal-verifactu` | the set itself |

- [ ] **Step 3:** Run `protection-list list`, then `compare` against the old list. It must print
  `EQUAL`. Journal tables are excluded from product schema, so 17 becoming 8 is not a difference. Any
  other difference is a stop, never a change to normalisation. Run it by the manifest path as well.
- [ ] **Step 4:** Read `PRAGMA foreign_keys`, `recursive_triggers`, `foreign_key_check` and
  `integrity_check` for both compositions, as the runbook says, and run Task 11's `classification` and
  `composition` tests: they pass now.
- [ ] **Step 5: Commit.**

### Task 13: Fold scheduler into payments

**Files:**
- Move: `packages/scheduler/src/**` to `packages/payments/src/reconciliation-schedule/`, keeping file
  names
- Delete: `packages/scheduler/`
- Modify: `packages/composition/src/modules.ts`, `composition.test.ts`, `packages/composition/package.json`;
  `apps/server/package.json`, `src/boot.ts`, `reconcile-duty.ts`, `config.ts`, `pass.ts`, and their
  tests; `apps/server/README.md`; `scripts/changed-scope.mjs:61,:72,:294`, `.github/workflows/ci.yml:3532`,
  `eslint.config.js:162-215`, `packages/db/src/english-only.ts:24`, `scripts/english-only.test.ts:101`

**Interfaces:**
- Produces: `@waitron/payments` exports what `@waitron/scheduler` exported. In `modules.ts`, payments'
  `backup.verification` is `combineBackupVerification` of its own and `SCHEDULER_BACKUP_VERIFICATION`.
- The reconciliation duty runs only when `payments` is enabled.
- The lint rule stays: re-aim both blocks at `eslint.config.js:162-215` so
  `packages/payments/src/reconciliation-schedule/**` may not import the rest of `@waitron/payments`,
  fiscal or `@waitron/verifactu`. Folding moves the runner, and removing its seam is a separate choice
  for the payments slice. In `import-x/no-restricted-paths`, `except` must be globs, and `./` forms
  never matched in testing. This form worked: `import.meta.dirname + "/packages/payments/src/reconciliation-schedule/**"`.
  `except` also needs `.../schema/scheduled-runs.*`, or the runner's own table import is refused, and
  fiscal needs a zone of its own.

- [ ] **Step 1: Write the failing test.** `{payments:false}` starts no reconciliation duty, and
  `{scheduler:false}` refuses with `module.config_unknown`.
- [ ] **Step 2: Run, and see it fail.**
- [ ] **Step 3: Implement.** Do not rename `scheduled_runs`: the payments slice does.
- [ ] **Step 4: Run** the payments suite and the named server suites.
- [ ] **Step 5: Commit.**

### Task 14: Replace the retired constants everywhere

**Files:** about 381 files naming a retired `*_MIGRATIONS` constant; `apps/server/scripts/allergens-demo.ts:27`,
`recipes-demo.ts:19`, `daily-close-demo.ts:49`, `modelo-303-demo.ts:67`.

- [ ] **Step 1:** Measure `useVenueDb`'s per-test reset time on a core-only suite, on the base and
  here. 161 suites use core alone, and core now holds about twice the tables.
- [ ] **Step 2:** The three fiscal tests naming `CREDENTIALS_MIGRATIONS` are the approved exception:
  change only that line. With a throwaway script, not committed, drop each retired constant from `migrations`
  arrays and imports. Keep `STAFFING_MIGRATIONS` users on `WORKFORCE_MIGRATIONS`, and
  `SCHEDULER_MIGRATIONS` users on `PAYMENTS_MIGRATIONS`, de-duplicated. Each array keeps core first.
- [ ] **Step 3:** Typecheck the workspace. Fix what the script could not, by hand.
- [ ] **Step 4:** Delete dead conditionals the merge leaves, each confirmed by reading:
  `packages/catalogue/src/catalogue-items.ts:261`, `packages/catalogue/src/sections.ts:66`.
- [ ] **Step 5:** Run a sample of changed suites from each package; a suite may now meet seeded rows
  or media's triggers it never saw. Fix setup, never assertions.
- [ ] **Step 6: Commit.** If reset time rose enough to threaten the 4-minute budget, say so with the
  figures: fix the reset, not a shard count.

### Task 15: The guards

**Files:** `scripts/module-graph-honesty.test.ts:428-436`, `append-only-migration-sets.test.ts:64-66`,
`migrations-match-schema.test.ts:212`, `menu-sections-upgrade.test.ts:197,:208`,
`backup-verification-runtime.test.mjs:231`, `journal-monotonic.test.ts:78,:80`,
`postgres-sql-residue.test.ts`;
`apps/server/src/backup-data-placement.test.ts`, `configuration-import.test.ts`,
`configuration-transfer.test.ts`, `restore-operation-placement.test.ts`;
`packages/provisioning/src/first-setup-resolution-inspection.test.ts:584`;
payments' and workforce's `schema-ownership.test.ts`. Refresh this list with the search in the
runbook, and a search for each retired folder path.

- [ ] **Step 1:** Update each guard so it still fails for what it existed to catch. Move an anchor to
  a surviving edge (`module-graph-honesty`: for example workforce → core). The minimum `modules.length`
  floor becomes the number of sets; `journal-monotonic`'s floors of 10 and 8 become 8 and 7. The
  negative control in `migrations-match-schema` moves to a surviving folder.
- [ ] **Step 2: Prove each moved guard by deletion,** and that its accepting case still passes.
- [ ] **Step 3: Write a new guard,** `scripts/retired-schema-folders.test.ts`: no `drizzle/` folder or
  `src/schema/` file other than a test exists in a package that has no set, naming the file.
  `adjustment-lines.test.ts` and `name-only-upgrade.test.ts` stay where they are. It is what stops the four
  kept branches bringing a table back unseen. Prove it by adding a file to `packages/adjustments/src/schema/`.
- [ ] **Step 4:** Run the whole root guard suite: `pnpm exec vitest run`, reading its `Tests` count.
- [ ] **Step 5: Commit.**

### Task 16: The upgrade walk, the refusals and what ships

Follow the runbook's "Rewrite the upgrade walk's epoch setup" rules 1–5 and "Run the required checks
and compare what ships", in full. A624's control comes with it; delete A624's backlog entry in Task 17
only if the control passes.

- [ ] **Step 1:** Rewrite the epoch setup test-first, with `scripts/migration-baseline-epoch.json`
  listing the seven populated sets and `emptySets: ["fiscal-none"]`.
- [ ] **Step 2: Write and watch fail, then pass, the refusals in Review Focus 3.** Old database and new
  image; new database and old image; an old backup, noting that `restore-gate.ts:28-30` skips names
  the target lacks, so the refusal must come from core's count; an old bundle naming `catalogue`.
- [ ] **Step 3:** Run the runbook's listed suites, the adapted history suites, and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`. Confirm zero
  diff on fiscal source against `A760_BASE`, before and after.
- [ ] **Step 4:** Compare old and new clean builds and images with `protection-list` and `copies`.
  Six builds per fiscal composition, as the runbook says, on the old and new sides.
- [ ] **Step 5:** Remove Task 9's exclusions from `packages/db/stryker.config.json`, push, and
  dispatch `mutation.yml` on the branch. Read `mutation-db-aggregate`: the merged score must hold 90
  and no shard may pass its 25-minute limit. If a shard does, refresh `packages/db/mutation-costs.json`
  with `scripts/mutation-costs.mjs` from that run's reports. If the score falls, add assertions: the
  conformance suites should kill most of these mutants. Workforce and payments are not mutation-tested,
  so nothing changes for them.
- [ ] **Step 6: Commit.**

### Task 17: Documents

- [ ] `CLAUDE.md` §3: "No new table enters the core migration set" becomes: a module that can be
  switched off or swapped keeps a set, any other adds tables to core, with the commit stating which;
  "classify new tables in their module" names the package that holds the set; "a new append-only
  table travels in both" names the host set's descriptor; `requires` speaks of sets. Same text in
  `docs/developers/conventions-data.md:371-376`, `:1557`, `:1679`, `:5438`.
- [ ] `packages/module/src/module.ts:1552,:1562-1566` ("a disabled module's tables are not migrated"
  is no longer true of staffing); `packages/composition/src/modules.ts:143-146`;
  `packages/db/README.md:40`; `docs/developers/modifiers.md:491`, `products.md:817`,
  `product-categories.md:567`. Grep the rest across the range: a behaviour change retires every
  receipt about the old behaviour, wherever it is written.
- [ ] Runbook: a dated section recording the epoch, reset SHA and "old backups need the old image".
  Backlog: delete A760, and A624 if resolved. Add the regeneration note to A790, A802, A799 and A739.
- [ ] Narrow what three places say about a rewritten history: `scripts/main-tag-guard.sh`'s header,
  `docs/developers/ci-and-gates.md` (the paragraph after "The print-agent image carries no
  `WAITRON_BUILD_ID`") and `docs/backlog/ci.md` → "What the per-push CI concurrency groups (#384) left
  open". Each says a rewritten history stops every later publish, and the script's header adds that
  the `sha-` tags keep coming. Both need narrowing, checked on 6 November:
  - GitHub's comparison answered `diverged` for `f8b36a6086`, a commit no branch or tag holds but
    which shares history with `main` (#2442's head before its rebase), so the guard answers `move`.
    For two commits with no shared history it answered 404, "No common ancestor" (`ha-fado`'s
    `v0.0.2` against its `main`), so the guard fails. A rewrite stops publishing only when it leaves
    the old and new tips with no commit in common.
  - The guard runs inside the step "Work out the tags". The steps after it have no `if:`, so when the
    guard fails nothing is published, `sha-` tag included. This part is read from
    `.github/workflows/ci.yml`, not run, and the corrected text should say so.

### Task 18: Finish, land and reset

- [ ] **Step 1:** Run `/finish-branch`. This is the full path, with two Codex reviews side by side.
  PR's first line: **every existing venue requires a reset.** Include the schema report, controls,
  changed-check list, roster and the owner's fiscal approval.
- [ ] **Step 2:** Read current-head CI, the image-nightly run on the same SHA, and the `changes` job's
  scope. **Lane A lands this PR itself** (owner, through the watcher, 6 November, for this PR only),
  once the protection list prints `EQUAL` for both fiscal compositions, all CI is green and every
  review, Codex included, is done. Tell the watcher just before landing, so the owner can look if
  they are around; do not wait for them.
- [ ] **Step 3:** After landing, confirm the merge SHA's own unfiltered CI. If the owner chose to
  rewrite history in this freeze, do Task 19 now, so the boxes are reset once, onto the rewritten
  `main`'s image. Then reset the roster by the runbook's table. Santet through its own `reset.sh`. The home box stays quarantined.
- [ ] **Step 4:** Tell the watcher the squash has landed. It lifts the hold and the freeze, and:
  - queues a Cloud item to re-pin `deploy/backup-verifier/target.json` and the owner list and digest
    in `packages/backups/test/verification-target.test.ts` from the merged `main`, rewritten if Task 19
    ran: Cloud pins a Waitron commit by its id (`ec91a9e34d…` in that `target.json` today). Until that lands,
    Cloud's verifier refuses new-epoch backups. Only pre-live venues exist, so nothing depends on it.
  - tells A790, A802, A799 and A739 to rebase and regenerate. A790's and A802's tables go in core,
    in `packages/db`, and A739's in payments. **Each branch shows its new tables in the protection
    list before it lands:** a table in a retired folder creates nothing, silently.

### Task 19: The history rewrite (A1306) and the `:main` image tag

Every push to `main` builds an image and, after asking `scripts/main-tag-guard.sh`, moves the `:main`
tag on GitHub's container registry to it; boxes follow that tag. The guard asks GitHub to compare
the commit `:main` was built from with the commit being published (Task 17's two findings). This task
rewrites the history and makes sure `:main` still moves.

**When:** only if the owner chooses to rewrite history in this freeze, with the paths the owner
chooses (the question is with the watcher). Otherwise A1306 stays at the design's §9 step 7 and
this task goes with it. It runs inside Task 18 Step 3, after the merge's own CI is green and before
the resets. The owner does Step 4, because it replaces `main` for everyone.

- [ ] **Step 1: Record what is there.** `git ls-remote origin` (the branches, the tag
  `pre-sqlite-migration`, and about 2,500 `refs/pull/*` refs), the open pull requests, and the commit
  `:main` was built from: `docker buildx imagetools inspect ghcr.io/clintongormley/waitron:main --format '{{range .Image.Config.Env}}{{println .}}{{end}}' | grep WAITRON_BUILD_ID`.
- [ ] **Step 2: Rewrite a copy, and check it.** In a fresh clone of `main` and the tag only, outside
  every worktree, run `git filter-repo` (the tool that rewrites every commit without the chosen
  paths, installed on the owner's Mac). Then, with the old history fetched back
  into a second ref so both can be read:
  - `git merge-base <old tip> <new tip>` must print a commit. If it prints nothing (the paths
    include something in the first commit, which holds the first design document), Step 5 will
    take its fallback; say so to the owner before pushing.
  - `git diff --stat <old tip> <new tip>` lists only the chosen paths.
  - The number of commits with no `Signed-off-by` line is the same before and after. (The number
    with one can fall, because `filter-repo` drops a commit the rewrite leaves empty.)
  - Say in the owner's note what else changes: every signed commit loses its signature (none is
    required), and commit ids quoted inside commit messages are rewritten.
  - Measure what a plain `git clone` fetches, before and after, with A1306's method (`git rev-list
    --objects --all` with `git cat-file --batch-check`). GitHub's own copy does not shrink: the
    `refs/pull/*` refs keep the old history and nobody can delete them.
- [ ] **Step 3: Decide every other branch.** Each remote branch other than `main` still holds the old
  history, and a plain `git clone` fetches it. A790, A802, A799 and A739 are rebased onto the new
  `main` with `git rebase --onto <new main> <old main tip> <branch>` and force-pushed, before they
  regenerate their migrations. Every other remote branch is listed for the owner to delete or
  rebase. Until a branch is rebased, its pull request must not be landed: `/land-branch`'s fallbacks
  would bring the old history back.
- [ ] **Step 4 (owner): Push.** In the rewritten clone, add the `origin` remote back (`filter-repo`
  removes it), then `git push --force origin main` and `git push --force origin
  refs/tags/pre-sqlite-migration`. The repository's ruleset refuses a force push to `main`, but an
  administrator bypasses it.
- [ ] **Step 5: Check that `:main` follows.** The push's CI run finds no earlier `main` run to compare
  with, so it runs every check; a red check skips publishing, and is fixed as any red `main` is. When
  green, the `publish` job runs the guard:
  - If the old and new tips share a commit, GitHub answers `diverged`, the guard answers `move`, and
    `:main` is rebuilt from the new tip. Confirm with Step 1's command that its build id is the new
    tip.
  - If they share none, the job fails at "Work out the tags" with "cannot place", and nothing is
    published. Delete the `waitron` package version that holds `:main`: find its id with
    `gh api /user/packages/container/waitron/versions --jq '.[] | select(.metadata.container.tags | index("main")) | .id'`
    and delete it with `gh api -X DELETE /user/packages/container/waitron/versions/<id>`, after
    `gh auth refresh -s delete:packages`. That version also carries the merge's `sha-` tag, which goes
    with it. Then re-run the failed job: the guard reads `not found` and answers `move`. The
    print-agent image needs nothing: the guard reads only the app image, and both tags move on its
    answer.
- [ ] **Step 6: Tell everyone what moved.** Every lane's worktrees and branches restart from the
  rewritten `main`. Record the old and new tips, and which Step 5 path ran, in the runbook's dated
  section. Then carry on with Task 18 Step 3's resets.
