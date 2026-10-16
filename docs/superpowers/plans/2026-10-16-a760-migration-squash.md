# A760 migration squash operator plan

> **For the later executor:** use `superpowers:executing-plans` for native execution in one job.
> Do not delegate implementation. Check off each step and retain its receipt. This procedure is
> approved on 16 October 2026. Start only when the watcher records the freeze and named reset
> roster below; this documentation update does not start the job.

## Owner approval, 16 October 2026

The owner approved the recommended combined decision at 18:00, as relayed by the watcher: squash
all 14 populated sets including fiscal-verifactu, keep fiscal source/tests and empty fiscal-none
unchanged, approve the named history-harness changes, pause other mutating Waitron/Cloud jobs,
and land only after green review and CI. The watcher starts the single job after big work drains
and migration branches finish. Record a named operator for every pre-live reset; stop the job if
you discover a production or real-trading venue.

At 18:05 the owner excluded the physical home box, `waitron.local`, from the job's resets. Keep it
off, with its image pinned and a recorded **must reset before next start** quarantine. The owner
resets it on return after 2 November. The job resets the laptop dev-stack slots and Santet
data venue through the procedures below, once the watcher records their actual paths and operators.
Unreachable boxes stay offline. No unidentified venue or production reset is authorised.

**Goal:** replace each populated Waitron migration history with one baseline before go-live,
while retaining the exact fresh schema, installed protections and product behavior.

**Architecture:** generate each baseline from its unchanged TypeScript schema, then deterministically
preserve the final SQL details the generator does not reproduce. Compare separate old and new fresh
databases, including runtime installers, before one atomic branch and PR reaches main. Every existing
venue enters the new history through an approved reset, never an in-place conversion.

**Tools:** the repository's pinned pnpm, Node, drizzle-kit, SQLite store, Vitest and GitHub CI.

**Requirements:** Lane G `queue.md` A760, added 16 October 2026; `RUNNER.md` H1–H13 and both
“THE RULE” blocks, including the 5 October test-change decision. This is the operator design for
that requirement, not a new product spec. The [inventory appendix](2026-10-16-a760-migration-squash-inventory.md)
holds the long per-object lists and source locations.

## Scope and defaults

You are changing migration history, not the product schema. Cover **all 15 manifest sets**, including
workforce-es, scheduler, credentials and fiscal-verifactu. The default is one schema-generated
baseline for each of the 14 populated sets. Keep fiscal-none's zero-entry journal byte-for-byte:
it owns no schema or SQL to squash (`packages/fiscal-none/src/migrations.test.ts:14`). Adding a no-op
would change bookkeeping without removing history. Merge manual SQL into each populated set's
same baseline file, not a second custom migration. Keep the generator's journal and snapshot intact.

The authoring head is **`13bb9ec1aa4d49eac4903c22b90b39c560085c93`**. It has **302 journal entries**,
not the approximate number in earlier memory. These are dated measurements, not execution constants.
The future job pins a new base after all migration branches have finished or been withdrawn and
refreshes the appendix before deleting any history.

Keep `packages/fiscal-verifactu/src/**`, its huella fixtures, golden assertions and
`inmutabilidad` **unedited**.
The approval above includes squashing fiscal-verifactu's SQL/meta, including the SQL defining
`registros_facturacion`, with unchanged schema and behavior. If any change to fiscal production
source or a protected test becomes necessary, stop this job for a separate decision.

Use one registered feature worktree and one PR. No compatibility reader, journal/hash rewrite,
backfill, number reuse, chain repair or data promotion is in scope. A backup is for returning to the
matching old image and old venue together, not for importing the old venue into the new history.
If a real venue goes live before execution, this pre-live plan expires and you stop.

## Review focus

- A same-name CHECK, index or trigger can carry a different body. Compare definitions and exercise
  omission and same-name mutation controls, not only counts.
- Media's trigger bodies name other sets' tables. Keep their dependency order and final bodies;
  do not recreate deleted category-image or device-binding rules.
- A one-baseline tree can make the upgrade walk vacuous. Keep a populated baseline restart and
  synthetic later migrations, including a late first migration in a dependent set (A624).
- Source tests do not establish what the box ships. Compare source, clean dist and image copies
  and apply each to separate fresh databases in both fiscal compositions.
- An old archive, dev folder or parked branch can reintroduce the old epoch. Keep the freeze until
  resets or explicit offline quarantine are recorded and all current-head CI has completed.

## What you change in the one execution PR

| Files | Responsibility |
| --- | --- |
| Every populated manifest-listed `packages/*/drizzle/` | Replace old SQL/meta with one `0000_baseline.sql` and generator-created meta per set. Core lives under `packages/db/drizzle/`; fiscal-none remains empty and unchanged. |
| Proposed `scripts/migration-baseline.mjs` and sibling `.test.mjs` | Narrow inventory, preservation, equality and negative-control tools, built test-first. They do not exist at the authoring head. |
| Proposed `scripts/migration-baseline-epoch.json` | Committed identity of this squash: version 1, `entries` with each populated set's `name`, `tag`, `when`, `sha256`, and `emptySets: ["fiscal-none"]`. The upgrade guard reads it; future new sets do not expand it. |
| Proposed `scripts/fixtures/a760-history/` | Minimal frozen test-only predecessor databases and target SQL needed by history-dependent regression tests, with provenance and hashes. Never shipped in `dist/drizzle`. |
| `scripts/migration-upgrade.test.ts` | Explicit new baseline epoch and meaningful later-migration controls; no retired historical reset keys. |
| History-dependent tests listed in the appendix | Read frozen test fixtures instead of deleted shipped tags, preserving behavioral assertions. |
| `packages/fiscal-none/**` | No change. Retain the existing zero-row tracking assertion, empty journal and zero owned tables. |
| This procedure, appendix, relevant developer docs, own backlog entries | Record new epoch, operator resets, changed test checks and current behavior. Historical documents get dated pointers rather than rewrites. |

Keep `packages/migrations/migrations.manifest.json`, module descriptors, `requires`, classification,
runtime installers and schema declarations unchanged unless a refreshed inventory reveals a specific
necessary correction. Such a correction needs its own receipt and must still satisfy exact equality.
Do not change a guard or assertion just to get green. The approval above covers the named
history-harness changes; guards remain controversial under the lane's test-change rule. List every
changed test check, before/after and this authorisation in the PR. Preserve the fiscal source tree except the separately approved fiscal **SQL/meta** replacement.

## Freeze before you create the squash branch

The owner's words were “only a single job” while away **17 October–2 November**, once the big work
runs out. The recommended freeze permits **no other mutating work, including non-migration work**:
no code, docs, dependency bots landing, manual migration work, automatic rebases or autonomous
landing in Waitron **or Cloud**. Read-only status observation and this job's checks/review may run.
This wider pause avoids moving the comparison reference or consuming the machine during a long job.
Cloud's own migration history is not squashed.

- [ ] The watcher records the combined owner approval and confirms pre-live status. Finish or
  withdraw all migration work before the pause. The examples at authoring time are G's PR #1800
  (A182-2), E's #1752 and F's A737; these are **not** an exhaustive or current clearance list.
  A parked migration PR is still a blocker. “Withdrawn” means PR closed and its migration branch
  retired after its owner retains any needed work outside active refs; no later merge/rebase of it.
- [ ] Set each lane's existing STOP gate first, let any current firing reach a checkpoint, and
  obtain its acknowledgement. Then boot out its launchd job while idle. Do not boot out an active
  runner to make it appear drained. The watcher also pauses its own change-watch monitor, rearming
  loop, slow cron/task and automatic landing, recording their actual task identifiers and pause
  receipts. A STOP file does not stop an already-running worker or the watcher itself.

The watcher, not this document-authoring session, performs these operations after approval:

```bash
# The watcher records which gates already existed, so resume restores the previous state.
for A760_CAMP in "$HOME/waitron-campaign" "$HOME/waitron-campaign-b" \
  "$HOME/waitron-campaign-c" "$HOME/waitron-campaign-d" "$HOME/waitron-campaign-e" \
  "$HOME/waitron-campaign-f" "$HOME/waitron-campaign-g"; do
  touch "$A760_CAMP/STOP"
done
launchctl list | rg 'com\.waitron\.campaign'
# Only after each lane is idle and acknowledged, run once per loaded label:
launchctl bootout "gui/$(id -u)/com.waitron.campaign"
# Repeat with .b, .c, .d, .e, .f, .g, preserving each exit status.
```

These seven plist names were found under `~/Library/LaunchAgents/`. The STOP/bootout mechanism is
also documented in `~/.agents/skills/watch-campaigns/SKILL.md:163`. Do not guess a launchd name for
the watcher; stop its actual monitor/schedule using the hosting session's controls.

- [ ] Reconcile both repositories read-only first. Fetch, then list **all** PRs with file lists,
  branches, worktrees and unpushed changes. Ask each branch owner to finish/withdraw a migration
  candidate before the job can start; an absence from the PR list is insufficient.

```bash
git fetch origin --prune
git worktree list --porcelain
git branch -vv
git for-each-ref --format='%(refname:short) %(objectname) %(upstream:track)' refs/heads/
gh pr list --state open --limit 200 --json number,headRefName,headRefOid,files
# Repeat read-only inventory from the Cloud checkout, not a reset or migration there.
git -C "$HOME/workspace/repos/waitron-cloud" worktree list --porcelain
git -C "$HOME/workspace/repos/waitron-cloud" branch -vv
ps -axo pid,ppid,etime,command
wa-wt ls
```

For **each** Waitron and Cloud worktree listed, its owner records `git status --porcelain=v1`,
`git log origin/main..HEAD --oneline`, and
`git diff --name-status origin/main...HEAD` plus unstaged/staged/untracked migration/schema changes.
The watcher collects the receipts; do not modify foreign checkouts. Check other remotes and
untracked SQL/config too. Inspect process command lines and launcher PIDs against candidate
checkouts, including paused reviews/tests/dev servers and in-flight install/migration tools.
No live old candidate process may remain. A process is stopped only by its owner using recorded
PIDs, never a name-based kill. A current locked/active long job is a blocker regardless of age.

- [ ] Acquire H11's `~/waitron-campaign-shared/main.lock` with **your successful atomic mkdir**.
  Record holder PID, start time and branch in an external receipt, not inside the empty directory.
  Hold it for this exceptional single job through landing, main update, install and cleanup.
  Use a bounded acquisition loop: 20 attempts separated by 30 seconds; after ten minutes checkpoint
  without starting. Do not remove it by age, even after 30 minutes: H11's empty-directory shortcut
  cannot identify an active long-running owner. A crash recovery requires checking the recorded
  process, launcher and worker descendants before the watcher releases an abandoned lock.
  Only its acquiring process releases it. The later land wrapper must recognise this same owner
  hold rather than try to reacquire its own lock.
- [ ] Pin execution base and save clean status, migration inventory, owner reset roster and freeze
  acknowledgements outside git. Recheck all these conditions immediately before generation and
  again before publication. If another mutation slips through, stop and recapture both reference
  builds from the new agreed base; do not patch only the new side.

## Capture the old reference and prepare the comparison tool

- [ ] Create the registered branch from the agreed frozen main using the inspected workflow:

```bash
python3 "$HOME/workspace/tools/worktree.py" new --headless waitron feat/a760-migration-squash
# Enter the exact path returned by worktree.py before all subsequent mutation commands.
bash
set -euo pipefail
A760_BASE=$(git rev-parse HEAD)
A760_RUN=$(mktemp -d "${TMPDIR:-/tmp}/a760-execution.XXXXXX")
git status --porcelain=v1
printf '%s\n' "$A760_BASE" > "$A760_RUN/base-sha"
pnpm install --frozen-lockfile
```

Use an isolated **throwaway clone** for the old reference; never swap files in the feature checkout.
This is a disposable measurement checkout, not a registered feature environment or dev stack:

```bash
git clone --no-hardlinks --no-checkout . "$A760_RUN/old"
git -C "$A760_RUN/old" checkout --detach "$A760_BASE"
(cd "$A760_RUN/old" && pnpm install --frozen-lockfile)
```

- [ ] Refresh all sets, source references, final SQL, journal dates and history consumers. Repeat:

```bash
rg -n '__drizzle|_journal|migrations\.manifest|entries\.(slice|find|at|length)' packages apps scripts docs
rg -n '[0-9]{4}_[a-z][a-z_]*|RESETS|FLOOR|migrationsFolder' packages apps scripts docs
rg -n 'dialect\.js' packages apps scripts docs
```

Read each hit; prose and compressed predecessor fixtures count as consumers too. The appendix is
the starting inventory, not a complete list of future hits. Repeat the Cloud read-only search for
Waitron manifest/SQL names and dynamic checkout/root inputs, including active branches. Cloud's
backup verifier loads Waitron restore from a supplied checkout, and its local-backup rehearsal
passes a migration root; see the appendix's Cloud call chain. The watcher records and pins those
checkout SHAs and rehearsal roots before freeze. Old-epoch archive verification/recovery stays
paired with the old checkout and its migration root. New-epoch rehearsals use newly created
fixtures and the new checkout/root only after its checks pass. Hold verification/recovery work
stopped or quarantine it when the owning operator cannot establish that pairing. No Cloud source,
PostgreSQL history or live backup data changes in this job. If satisfying this dependency requires
a Cloud code change, stop and replan; a literal-filename search is insufficient clearance.

- [ ] Before writing the tool or its tests, read `superpowers:test-driven-development`. Implement
  the following proposed interface test-first. Run each new test failing for the stated missing
  behavior, implement only that behavior, and run it passing. The commands below become usable
  **only after this task creates the helper**; they are not existing repository commands.

### Comparison and preservation contract

The new `scripts/migration-baseline.mjs` accepts these subcommands through the installed server
`tsx` binary. Use `--repo` explicitly; `pnpm --filter ... exec` changes the working directory.
All inventory outputs and SQLite databases go under `--out` outside the repository; comparison/copy
reports go to their explicit report paths. `preserve` alone writes only the selected candidate baseline SQL.

| New subcommand | Inputs and outputs |
| --- | --- |
| `inventory --repo R [--migration-root M] --out D --compositions both` | Import R's own manifest/descriptors/opener/migrator, never this helper's copy of runtime logic. Save source hashes, set order, journals/snapshots, every SQL statement with file:line, raw SQL-only build, descriptor and manifest product builds for both compositions, pre/post runtime installer builds and complete catalogs/rows. An optional M supplies packaged `<M>/<set>` folders; runtime code still comes from R. Fail on zero discovered sets or mismatched paths. |
| `preserve --repo R --reference D --set S` | Match the generated set's table/index names to the old final set. Preserve complete old final DDL when generator spelling or physical column order differs; append only final manual triggers owned by S. Preserve same-table trigger creation order. Reject missing/extra generated schema objects or unexplained deltas. Leave journal/snapshot bytes untouched. Idempotent, deterministic; emit provenance for every replacement. |
| `compare --old D --new D --report F` | Compare complete schema and seed inventories in both directions at every phase/composition, with the normalization below. Exit 0 only with `EQUAL` and nonzero compared object counts; otherwise exit 1 with structured old/new differences. No allowlist of missing objects. |
| `controls --reference D --out D` | In copies only, make the omission and mutation changes below and require comparison to fail for the changed object; include an unchanged/whitespace-only accepting case. Exit nonzero if a negative control passes. |
| `copies --repo R --dist D --image-root D --report F` | Enumerate all manifest sets and compare every shipped SQL/meta file hash with source; reject any extra/missing/stale file. Never rely on a core-only sentinel. |

Test meaningful comparisons rather than the implementation's own serialization. Fixtures cover
reordered JSON keys and row order as accepted, irrelevant SQL whitespace as accepted, quoted text
containing whitespace as preserved, no sets as rejected, an unexpected extra object as rejected,
and **same-name** changes to FK action, CHECK body, index expression/predicate, type/default,
PK/unique columns and trigger body as rejected. A changed BLOB byte or seeded value also fails. Exclude engine-created objects from the
generator membership list; never emit `CREATE TABLE sqlite_sequence`. Their derived definitions
and state still participate in the applied-schema comparison.
Test that `preserve` leaves all meta bytes unchanged and a second call makes no SQL change.

The schema report includes every table and view, `pragma_table_list` options (STRICT and WITHOUT
ROWID), ordered `pragma_table_xinfo` columns (name, declared type, nullability, default, hidden /
generated status and primary-key ordinal), complete foreign-key tuples and actions, table CHECK
bodies and conflict clauses, and every implicit and explicit index. For indexes include uniqueness,
origin, key order, collation, descending flags, partial predicates and expression SQL, using
`pragma_index_list` and `pragma_index_xinfo`. Include full trigger target/event/WHEN/body SQL and
relative creation order where multiple triggers share a table. Capture all table rows before any
filler, including byte-exact BLOBs and SQLite value types. Do not infer zero seeds from a grep.

**Normalization is deliberately small.** Exclude only the exact per-set drizzle bookkeeping tables
and their rows/indexes from *product-schema* equality; compare that bookkeeping separately for
expected entry count, hashes, dates and table names. Sort maps/object lists by stable keys and rows
as typed tuples; this changes reporting order, not the compared data. In SQL, remove only
insignificant whitespace **between tokens** using a quote/comment-aware tokenizer. Do not collapse
whitespace inside quoted identifiers or literals, strip CHECKs, lowercase text, remove predicates,
ignore column order, replace values, or treat same names as equality. Do not exclude `sqlite_sequence`
or another engine object wholesale: compare AUTOINCREMENT declarations and sequence contents if
present, associating implicit autoindexes with their exact constraints. Runtime UUIDs/timestamps
are not a generic exclusion. Provisioning comparisons use fixed clock/id/allocation inputs in an
isolated adapter so row equality is exact. If that cannot be done without changing protected fiscal
source, compare deterministic public seed outputs in an existing harness and stop before claiming
full seed equality. Do not quietly widen normalization.

Fresh generated table text may use different quoting or physical column order from ALTER/rebuild
history. Align those candidate SQL statements with the old **final stored** CREATE statements in
the deterministic preservation pass. This retains exact schema while the generator still owns its
snapshot and journal. Verify generated object membership first; never hide a missing generator
object by silently restoring it. Any mismatch in actual schema meaning is a stop, not a formatting
exception. All CHECKs and explicit indexes were snapshot-represented by name at the authoring head;
no manual-only CHECK patch was identified, but the refreshed comparison must check their bodies.

Example required failure report (format is this tool's contract, not output already observed):

```text
DIFF composition=fiscal-verifactu phase=post-runtime
missing trigger products_media_image_fk_parent_delete
changed index incidents_open_dedup.expression[1]
old: case when "device_id" is null then '' else "device_id" end
new: "device_id"
changed table sales.check[sales_source_ck].expression
extra table __keep_media_image_data
```

- [ ] Capture the old tree through the helper from the execution checkout, retaining exact commands
  and statuses. The helper must import runtime code from `--repo`, not its own checkout:

```bash
apps/server/node_modules/.bin/tsx scripts/migration-baseline.mjs inventory \
  --repo "$A760_RUN/old" --out "$A760_RUN/old-inventory" --compositions both
apps/server/node_modules/.bin/tsx scripts/migration-baseline.mjs controls \
  --reference "$A760_RUN/old-inventory" --out "$A760_RUN/controls"
```

The controls remove one behavioral trigger, one media parent trigger, one append-only pair, and
one feed trigger; omit one ordinary index, expression index, CHECK and FK; alter each under the
same name; add an unexpected object; and change a seed value in a controlled seeded fixture.
Expect the appropriate `missing`, `changed` or `extra` report and exit 1 from each comparison,
with the unchanged copy reporting `EQUAL`. A quoted incident expression must fail to apply with
`no such column: case when ...`, as the authoring scratch probe did. Also exercise an accepting
write alongside every refusing trigger scenario covered by the existing behavioral suites.

## Adapt the history consumers before generation

- [ ] Capture the predecessor fixtures listed in the appendix **from the frozen old checkout**.
  Use each existing test's own predecessor staging/setup and capture before its assertions;
  create the minimal test-only database plus the exact target SQL sequence that test previously
  applied. Record base SHA, source file:line, SQL SHA-256, journal table and original dates in
  `scripts/fixtures/a760-history/README.md` and case manifests. These are regression fixtures,
  excluded from production manifest/copy paths; no compatibility path ships with them.
- [ ] Change only fixture selection in those tests. Preserve their value, count, refusal,
  rollback, FK, image-byte and unrelated-row assertions. A fixture journal can model its old
  target sequence; do not hand-edit a shipped journal/snapshot. Add a check that no test fixture
  enters dist/image migration directories. Keep a current-baseline check alongside each retained
  historical-operation check so tests cannot pass solely on frozen SQL. Run these cases before
  deleting the shipped history and again afterwards. Never delete an assertion because a tag
  disappeared. If a minimal fixture cannot faithfully preserve its test, checkpoint for review.
- [ ] Rewrite the upgrade walk's epoch setup test-first, with these explicit rules:
  1. Commit `scripts/migration-baseline-epoch.json` after generation/preservation, with `version: 1`,
     an `entries` array of `{name, tag, when, sha256}` for each populated set, and
     `emptySets: ["fiscal-none"]`. Compute each hash from final SQL bytes and each date/tag from
     its generated journal; never edit a journal or snapshot. The upgrade guard reads this fixture
     and verifies each recorded identity still exists with the same SQL hash/date. This is a fixed
     epoch, not a list rediscovered from all current first entries. A later new set is absent from
     the fixture and runs at its own date. Later migrations in existing sets are allowed too; do
     not keep asserting that each current journal has exactly one entry. The initial checkpoint
     applies only these approved entries in descriptor dependency order, installs protection and
     fills the epoch tables; later checkpoints fill new tables and carry populated rows. Keep
     receipt copies of the epoch file. Do not keep the `core/0003` FLOOR tag.
  2. Retire **all** old `RESETS` keys with the deleted SQL history. Start the new epoch's list
     empty, and retain/reset-test its exact refusal-or-exact-lost-tables matcher. A future key
     still must be reached and must fail for exactly its stated reason. Preserve the control
     where unlisted row loss fails, and the control where a listed step carrying rows fails.
  3. Remove the unconditional `entry.idx === 0` inclusion from later dated cuts. Only the explicit
     squash baseline entries belong in the initial checkpoint. A newly introduced set whose
     first migration is later than that checkpoint runs at its own date, **after** its declared
     dependencies at that date. Add the A624 control: base set creates its referenced table in
     migration 1, dependent set first appears later with an FK to that table. The wrong algorithm
     must print `no such table: main.<later_parent>`; the corrected walk must insert and retain
     child/parent rows. Also reject undeclared dependencies and a target not yet available.
  4. Do not insist that real history supplies `cuts.length > 1` after squash. Retain non-vacuity
     with a nonempty, valid committed epoch, nonempty filled-table assertion, a populated
     repeat of `applyMigrations` and runtime reinstall, and synthetic future migrations that
     produce at least two real steps. Exercise the actual epoch-file discovery path with a new
     dependent set absent from it, and a second migration in an existing set; neither may be
     pulled into the initial checkpoint. An unknown epoch set, missing entry or changed hash/date
     fails with its set/tag, while the unchanged epoch passes. Test row loss, NOT NULL failure, duplicate unique value,
     trigger-body rebuild failure and same-name trigger loss with rejecting and accepting cases.
  5. Preserve the course/station row-equality regression currently keyed to `core/0135` with a
     frozen historical fixture plus a new-baseline row equality check. Replace only the historical
     reachability pin, not its comparisons. Keep the final product-trigger checks. Document that
     synthetic rows are still weaker than real product data and that row counts alone miss rewrites.

This is the owner-reviewed resolution of A624, not a reason to split staffing into two new baselines.
Delete A624's backlog entry only in the execution PR once these controls pass; the authoring change
edits only its own A760 entry. Keep unrelated backlog lines intact.

## Generate and preserve one baseline per set

- [ ] Save old inventories and test fixtures first. Check the frozen roster again. Clear only the
  manifest-listed migration folders in the **new execution worktree**. Never clear the old clone,
  another worktree, dist from another session or a venue folder. Run under `bash` with `set -euo
  pipefail`; inspect every command's output, not just its exit status.

```bash
A760_ROOT=$PWD
# This literal list is checked against the refreshed manifest before use.
for A760_PKG in db catalogue venue-service media identity workforce workforce-es payments \
  scheduler credentials fiscal-verifactu fiscal-none bookings adjustments staffing; do
  test -f "$A760_ROOT/packages/$A760_PKG/drizzle.config.ts"
  # fiscal-none has no SQL; retain its existing empty journal and tracking assertion.
  if [ "$A760_PKG" = fiscal-none ]; then
    continue
  fi
  rm -rf -- "$A760_ROOT/packages/$A760_PKG/drizzle"
  pnpm --filter "@waitron/$A760_PKG" db:generate --name baseline
done
```

The `db:generate` script and `--name` are present in the inspected package manifests; each
package config points at its own schema and `./drizzle`. Do not use `push`, `introspect`, `migrate`,
an existing deployed database or an absolute `out` override. For populated sets expect exactly
`0000_baseline.sql`, a new generator snapshot and one journal entry, plus `Your SQL migration file`
completion output. Verify fiscal-none still has zero entries, no SQL, and identical journal bytes.
Do not invent or hand-edit meta. No generator ran during plan authoring.

- [ ] Reject a prompt, import error, missing completion marker, absent file, extra entry or empty
  SQL even if drizzle-kit exits 0. Capture package-by-package logs. Verify new `when` values
  are finite generator-assigned numbers and monotonic within every set; never hand-adjust dates
  to make an old database accept a baseline. Per-set journal table names remain unchanged.
- [ ] Run the new deterministic preservation helper for each of the same 15 manifest names, using
  `core` for package `db`. Do not copy a union of old migrations. The appendix's final objects
  are the recipe: generated tables/columns/keys/CHECKs/indexes; exact final expression indexes;
  final core/media manual trigger bodies after schema; no rebuild wrappers or old seeds.

```bash
for A760_SET in core catalogue venue-service media identity workforce workforce-es payments \
  scheduler credentials fiscal-verifactu fiscal-none bookings adjustments staffing; do
  if [ "$A760_SET" = fiscal-none ]; then
    continue
  fi
  apps/server/node_modules/.bin/tsx scripts/migration-baseline.mjs preserve \
    --repo "$A760_ROOT" --reference "$A760_RUN/old-inventory" --set "$A760_SET"
done
apps/server/node_modules/.bin/tsx scripts/migration-baseline.mjs inventory \
  --repo "$A760_ROOT" --out "$A760_RUN/new-inventory" --compositions both
apps/server/node_modules/.bin/tsx scripts/migration-baseline.mjs compare \
  --old "$A760_RUN/old-inventory" --new "$A760_RUN/new-inventory" \
  --report "$A760_RUN/schema-comparison.json"
```

Use `--> statement-breakpoint` **between** statements, never after the last one. Preserve trigger
bodies as single statements, including their internal semicolons. The meta remains generator-owned;
there is no extra custom SQL migration, and no snapshot hand editing. Rerun generation through
`scripts/migrations-match-schema.test.ts` to check that the snapshots still match schema source.

- [ ] Compare both fiscal compositions through **both** descriptor and manifest-derived paths:
  select exactly one fiscal module, retain every other enabled module and dependency, then call
  `migrationOptionsFor` and the real `applyMigrations`. Compare SQL-only, post-append-only and
  post-change-feed phases independently. Preserve `applyMigrations` removing the feed before
  migrating and boot reinstalling it afterwards. Also check the core-only and existing supported
  minimal dependency combinations through their current suites; full composition can hide a
  dependency accidentally added to core.
- [ ] For every fresh build and a populated repeat migration, read `PRAGMA foreign_keys` and
  `PRAGMA recursive_triggers` on the actual product connection: both must be 1. Run
  `PRAGMA foreign_key_check` (zero rows) and `PRAGMA integrity_check` (one `ok`). A nonempty FK
  result, `foreign key mismatch`, missing table, changed pragma or extra/missing object is a stop.
  Compare seeded rows before fillers. Compare controlled provisioned outputs separately, including
  fiscal-none and an approved preproduction Veri*Factu allocation. Do not activate a real filing
  identity or use a real AEAT certificate for these checks.

## Run the required checks and compare what ships

Run these exact existing checks in the execution worktree. Stop at a failure and keep the full
output, including the `Tests` count. These checks were inspected, **not run during authoring**.
Use an outer deadline if investigating a stall, and record the active operation before retrying.
Do not weaken budgets or exclusions to finish the squash.

```bash
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts \
  scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts \
  scripts/module-graph-honesty.test.ts scripts/classification-complete.test.ts \
  scripts/journal-monotonic.test.ts scripts/append-only-migration-sets.test.ts \
  scripts/apply-migrations-callers.test.ts
pnpm exec vitest run scripts/migration-upgrade.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
pnpm --filter @waitron/migrations exec vitest run
pnpm --filter @waitron/composition exec vitest run
pnpm --filter @waitron/provisioning exec vitest run src/schema-ahead.test.ts
```

Also run every adapted history suite from the appendix with `pnpm exec vitest run <root-file>` or
`pnpm --filter @waitron/<package> exec vitest run <package-relative-file>` as appropriate, plus the
new helper suite `pnpm exec vitest run scripts/migration-baseline.test.mjs`. The fresh suite must
still catch missing append-only tables, changed media bodies and populated row loss. Expect all
assertions to pass, not skipped tests or no-count output. Fiscal source/golden/inmutabilidad have
zero diff against `$A760_BASE` before **and after** these runs; check their paths explicitly.

The watermark is not a migration number. Drizzle selects `max(created_at)` from each journal table
and only applies entries above it (`packages/db/src/migrate.ts:27`, installed
`drizzle-orm/sqlite-core/dialect.js`, and `scripts/journal-monotonic.test.ts:7`). A baseline count of
one does not prove its date is useful; keep synthetic equal/lower-watermark refusal controls and
`migrations.incomplete` tests. Keep `assertNotAhead` unchanged: applying old journals to a new
image must produce `provisioning.database_ahead` with an unknown hash, even when the count happens
to equal one. Validate old DB/new candidate refusal **before any write**, new DB/new candidate
acceptance, and new DB/old image refusal. An old empty fiscal-none journal is distinguished by the
other selected sets; do not use it alone as a rejection control. Both boot/node-entry and bucket
rebuild call paths must retain their checks. Never “fix” the error by deleting a tracking row.


Migration counts also travel outside the migrator. `apps/server/src/backup-manifest.ts:19` reads
applied counts into backup manifests; `apps/server/src/restore.ts:222` reads expected counts;
`apps/server/src/restore-gate.ts:28` refuses a backup count above the image's count.
`apps/server/src/configuration-transfer.ts:599` requires exact module-version equality, and
`apps/server/src/cloud-snapshot-archive.ts:39` carries the module map into Cloud archive data.
Keep these rules and their tests; expect old configuration bundles to be rejected rather than
translated, and re-export/reprovision after reset. Old backups can fail at the version gate before
reaching the hash-based ahead check; both are legitimate old-epoch refusals. Do not weaken either
gate to make an old archive import. Include backup/configuration/rejoin/recovery suites in CI review.

- [ ] Compare clean old and new builds. Remove only this job's candidate `apps/server/dist`, then
  build; the old clone starts without dist. Keep all command statuses and source heads:

```bash
(cd "$A760_RUN/old" && pnpm --filter @waitron/server build)
rm -rf -- "$A760_ROOT/apps/server/dist"
pnpm --filter @waitron/server build
# Candidate box image, built locally without changing any running stack:
docker build -f deploy/Dockerfile -t waitron:a760-candidate .
```

`apps/server/scripts/copy-migrations.mjs:17` clears its own `dist/drizzle` before copying all manifest
folders; `deploy/Dockerfile:205` copies them to `/app/drizzle`, with
`WAITRON_MIGRATIONS_DIR=/app/drizzle` at `:258`. An old dist folder is not an inventory source.
Use an owned, stopped extraction container:

```bash
A760_CONTAINER=$(docker create waitron:a760-candidate)
printf '%s\n' "$A760_CONTAINER" > "$A760_RUN/extraction-container"
docker cp "$A760_CONTAINER:/app/drizzle" "$A760_RUN/image-drizzle"
docker rm "$A760_CONTAINER"
apps/server/node_modules/.bin/tsx scripts/migration-baseline.mjs copies \
  --repo "$A760_ROOT" --dist "$A760_ROOT/apps/server/dist/drizzle" \
  --image-root "$A760_RUN/image-drizzle" --report "$A760_RUN/shipped-copies.json"
```

Build and extract the old image separately, then apply all packaged inputs. These are the exact
commands for the new helper contract above; its implementation must support `--migration-root`:

```bash
(cd "$A760_RUN/old" && docker build -f deploy/Dockerfile -t waitron:a760-old .)
A760_OLD_CONTAINER=$(docker create waitron:a760-old)
printf '%s\n' "$A760_OLD_CONTAINER" > "$A760_RUN/old-extraction-container"
docker cp "$A760_OLD_CONTAINER:/app/drizzle" "$A760_RUN/old-image-drizzle"
docker rm "$A760_OLD_CONTAINER"
apps/server/node_modules/.bin/tsx scripts/migration-baseline.mjs copies \
  --repo "$A760_RUN/old" --dist "$A760_RUN/old/apps/server/dist/drizzle" \
  --image-root "$A760_RUN/old-image-drizzle" --report "$A760_RUN/old-shipped-copies.json"
for A760_SIDE in old new; do
  if [ "$A760_SIDE" = old ]; then
    A760_SIDE_REPO="$A760_RUN/old"
    A760_SIDE_IMAGE="$A760_RUN/old-image-drizzle"
  else
    A760_SIDE_REPO="$A760_ROOT"
    A760_SIDE_IMAGE="$A760_RUN/image-drizzle"
  fi
  apps/server/node_modules/.bin/tsx scripts/migration-baseline.mjs inventory \
    --repo "$A760_SIDE_REPO" --migration-root "$A760_SIDE_REPO/apps/server/dist/drizzle" \
    --out "$A760_RUN/$A760_SIDE-dist" --compositions both
  apps/server/node_modules/.bin/tsx scripts/migration-baseline.mjs inventory \
    --repo "$A760_SIDE_REPO" --migration-root "$A760_SIDE_IMAGE" \
    --out "$A760_RUN/$A760_SIDE-image" --compositions both
  for A760_LAYER in dist image; do
    apps/server/node_modules/.bin/tsx scripts/migration-baseline.mjs compare \
      --old "$A760_RUN/$A760_SIDE-inventory" --new "$A760_RUN/$A760_SIDE-$A760_LAYER" \
      --report "$A760_RUN/$A760_SIDE-source-vs-$A760_LAYER.json"
  done
done
for A760_LAYER in dist image; do
  apps/server/node_modules/.bin/tsx scripts/migration-baseline.mjs compare \
    --old "$A760_RUN/old-$A760_LAYER" --new "$A760_RUN/new-$A760_LAYER" \
    --report "$A760_RUN/old-vs-new-$A760_LAYER.json"
done
```

This creates six distinct scratch builds per fiscal composition: old/new source, dist and image.
Each uses its own side's runtime code/installers. Use fixed inputs and fresh directories, not an
upgrade of old DB to new. The existing bundle/image smoke is still required for actual packaged
boot; a file copy comparison is not evidence that a bundle loads. The exact-head CI bundle-smoke
job and image-nightly dispatch below supply those existing executable checks and cleanup receipts.
No dev stack or real venue is used for comparison.

- [ ] Follow the repository's local/CI split. Focused checks above run locally; the normal push
  hook runs formatting/lint/root guards/types once. Package-wide coverage runs in CI. Do not add
  a whole-workspace local suite solely to finish. If Cloud ever enters scope, stop and replan:
  Cloud's full affected-package suites must run before every push, and it is excluded here.
- [ ] Sign off every execution commit with `git commit -s`. One final candidate tree, one PR whose
  **first line says every existing venue requires a reset**. Use `finish-branch`; retain its one
  required Claude whole-branch run-it review in an independent temporary installed checkout.
  That synchronous review is a phase of this one job, not a parallel implementation lane.
  Include the schema report, negative controls, old/new build heads, full changed-test-check list,
  reset roster and owner fiscal approval in the PR. Do not bypass hooks.
- [ ] Read current-head CI, not only a green aggregate or an earlier rebase. Existing commands:

```bash
git rev-parse HEAD
gh pr checks --required --watch
gh run list --branch feat/a760-migration-squash --limit 20 \
  --json databaseId,headSha,workflowName,status,conclusion
gh run view RUN_ID --json headSha,status,conclusion,jobs
gh workflow run image-nightly.yml --ref feat/a760-migration-squash
```

`RUN_ID` is replaced by the returned exact-head run identifier, never guessed. Wait for the image
run on the same SHA too. `ci.yml` has no workflow_dispatch entry; do not invent a manual `ci.yml`
command. Inspect its `changes` job's `code`, `scope`, `packages` and selected jobs against all
changed packages and their dependents, including migrations' consumers. Require package coverage
or merge jobs, mutation jobs that this workflow owns, bundle checks, root guards, licence and DCO,
and the image-smoke result. A skipped package is not a whole-workspace result. On main, code
pushes deliberately run unfiltered (`.github/workflows/ci.yml:80`); the **exact merge SHA's full CI**
is mandatory before the freeze lifts. Report PR coverage accurately if it is scoped.

## Land, reset the approved roster, then release the freeze

- [ ] The watcher records the combined approval above and fills and acknowledges the actual named
  roster before starting, within that approved pre-live scope. An unidentified venue has no reset authority. Anything outside the approved
  scope needs a new decision; do not assume a roster was attached to the planning approval.
  Land only with green current-head checks and resolved review conversations. Keep the same H11
  owner hold through `land-branch`, main update, `pnpm install`, and branch/worktree cleanup.
  Verify the remote feature branch is gone. Record the merge SHA and its own unfiltered CI/image
  publish run; wait for completion, not merely run creation.
- [ ] Reset only roster entries approved as pre-live. Before any wipe, the assigned operator records
  the actual host, environment stamp, state/venue path or volume, running image SHA, responsible
  person, credential **reference** (never its value), rollback copy and recovery method. Keep a
  stopped copy of the **whole** state/venue directory or volume, sidecars and required keys included,
  plus the matching old image digest/ref. Do not promote a preproduction database, stream or archive
  to production, and do not use an old backup as the new baseline's seed. Suspend old backup writers
  and mark old streams/archives as old-epoch rollback-only so recovery cannot silently select them.

| Venue type | Who owns the reset | Concrete operation after new merge/image passes |
| --- | --- | --- |
| Normal laptop demo/onboarding, first shared slot | Single-job operator, with current instance owner's acknowledgement | Read `wa-wt ls`; choose the recorded worktree updated to the merge. Run `wa-wt reset demo NAME` or `wa-wt reset onboarding NAME` for the approved target. The first slot uses `$HOME/workspace/.waitron-dev/box`; reset it once, then refresh other first-slot checkout env copies through wa-wt. |
| Other laptop slots | Each recorded instance owner, coordinated by the job | Same named wa-wt reset for each distinct `$HOME/workspace/.waitron-dev/instances/NAME/box/venue`; do not confuse shared slot zero with isolated later slots. Stop old code first. |
| Santet real-data laptop venue | Santet worktree owner or the explicitly approved operator | Use **only** the procedure below with `local/square/reset.sh`; no demo reset and no fresh Square fetch by default. |
| Owner's physical home box, `waitron.local` | Owner on return after 2 November | Do not reset it in this job. Keep it off/quarantined, image pinned, with **must reset before next start** recorded. |
| Any additional test/demo box | Named operator with actual access | At that host's inspected installer location run `sudo bash waitron.sh --reset --yes install MERGE_SHA` only for a recorded pre-live reset target. Keep TLS by default; no `--all`, `--force-production` or guessed remote login. `WAITRON_DIR` defaults to `/opt/waitron` (`deploy/waitron.sh:15`) but confirm an override. |
| Cloud-hosted Waitron node, mirror, restore/rehearsal target or offline spare, **if present** | Named node operator | Inventory actual deployment and venue volume. Use that deployment's approved pre-live whole-venue reset and candidate image, or leave it stopped/quarantined pending access. Do not reset the Waitron Cloud control-plane PostgreSQL database. |
| A production-stamped or real-trading venue, **if discovered** | Owner | Stop the whole squash procedure; this plan has no production-reset authority. |

Do not infer a host, account or credential from these types. Unreachable approved test boxes can
remain physically offline only with a recorded “must reset before next start” quarantine and image
pin; a reachable box with old data must not automatically pull the new image. If any roster row
lacks an assigned operator/access path, finish the schema/PR work but hold deployment and freeze
release for that row. The owner approved offline quarantine above; record it explicitly for each
affected box, including `waitron.local`.

Santet's actual script was read at
`~/workspace/worktrees/waitron-local-santet-data/local/square/reset.sh:1`. Its memory is
`~/.claude/projects/-Users-clintongormley-workspace-repos-waitron/memory/santet-real-data-venue.md`.
It pins slot 1, provisions without demo data, imports the downloaded Square snapshot and replays
bills. It is local/untracked and never pushed. **This authoring job did not run or alter it.**
The approved Santet operator first checks its status/untracked files, then:

```bash
# Run only by the assigned Santet operator after the merge and with preserved local scripts/data.
cd "$HOME/workspace/worktrees/waitron-local-santet-data"
git status --porcelain=v1
git fetch origin
# Stop if fast-forward would overwrite local work; never discard it.
git merge --ff-only origin/main
pnpm install --frozen-lockfile
local/square/reset.sh
```

Re-read its `local/square/README.md` and reset script against the merged schema first. If the local
setup/replay scripts need adjustment, that owner resolves it before reset or the venue stays stopped;
never replace the local import with Casa Delgado demo data. Do not display or copy
`~/.square-analysis/env`. No `--fetch` is needed to rebuild from its retained snapshot.

- [ ] For each reset, verify the running image/source SHA, health, all selected journal tables having
  one baseline hash/date for each populated set and zero fiscal-none rows, new expected schema
  versions, required runtime triggers, and
  `foreign_keys=1`, `recursive_triggers=1`, clean FK/integrity checks. Walk setup/sign-in and the
  existing preproduction sale/receipt/working-time flows appropriate to the venue. Record Santet's
  import/replay completion separately. Re-enrol browser/device sessions and reconfigure test hardware
  as required by the reset; never assume old sessions or fiscal allocations survived it.
- [ ] Update developer migration guidance and the relevant dev/Santet memory with the new baseline
  epoch, reset SHA, and “old backups require old image” rule. The memory update is the later named
  operator's responsibility, not a committed campaign file. Keep historical docs with dated pointers.
  Delete A760 and, if actually resolved, A624 from backlog only in the finishing execution change.
- [ ] Recheck no old migration branches, candidate processes, active old streams or unacknowledged
  roster rows remain. Retain all reports and close handles/owned extraction containers. Remove only
  this job's scratch clone/directories after archiving receipts, and release only its acquired H11
  lock. Restore only STOP/schedule states this freeze added, through the watcher. Resuming lanes
  requires a new base from squashed main; abandoned migration diffs must be regenerated, never
  merged back. No old migration PR is reopened.

## Time budget and stop points

Allow **8–16 active engineer hours**, **1–3 elapsed CI/review hours**, and a separate reset/access
window per roster. This is an **unmeasured planning budget**, not a measured runtime promise.
Inventory/fixture preparation gets 2–4 hours; tools/controls and harness adaptation 3–6; generation,
equality and packaged checks 2–4; operator paperwork about 1–2. These ranges overlap and are not
an estimate made by running a squash. The work may span several resumptions of the **same** job. At an intentional checkpoint that
exits, close owned child processes, record the ledger, and release your own H11 hold; the watcher
keeps the STOP/schedule freeze. Resume by reacquiring H11 and repeating the clearance checks.
Never leave an unowned empty directory as a substitute for the freeze.

Checkpoint after old inventories/fixtures, after helper controls, after generated equality, and
before publication/reset. If a stage exceeds its range or active work reaches 16 hours, stop at a
clean checkpoint, retain logs/PIDs/phase and tell the parent what remains. Leave the freeze in
place; do not compensate with skipped tests, broader normalization, an active-lock age deletion or
parallel lanes. A fresh job must not start while the old process still owns the operation. Follow
H10 after two unresolved finish/land failures; no third blind attempt.

## Combined decision approved on 16 October 2026

The owner answered the following published question as recommended at 18:00. The dated approval
above records that answer and the 18:05 home-box exception. Do not repeat the question or treat
approval as clearance of the execution freeze or reset roster.

> Approve this plan for the sole job once migration work drains? Recommended: squash all populated
> sets including fiscal-verifactu, keep fiscal source/tests and empty fiscal-none unchanged, approve
> the named history-harness changes, pause other mutating Waitron/Cloud jobs, and land only after
> green review/CI. Permit pre-live resets only after the watcher records named venues/operators;
> inaccessible boxes stay offline. The actual reset roster is still outstanding. No unidentified
> venue or production reset is authorised.
