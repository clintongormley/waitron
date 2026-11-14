# Conventions — data, migrations and module boundaries

This file holds the evidence behind the data- and module-boundary conventions in the repo root
`CLAUDE.md` section 3: the mechanisms, measurements, error codes, drizzle internals and the incidents
that paid for each rule. `CLAUDE.md` keeps the one-line version of each rule and points here for the
rest.

**A note on the error codes.** `node:sqlite` reports a numeric `errcode`. Measured 2026-09-22 on
Node v26.7.0, in one transaction: a duplicate primary key is 1555, a null in a `not null` column
1299, and a trigger's `RAISE(ABORT)` 1811. The tree spells it that way too
(`packages/db/src/sql-state.ts`).

## State-file replacements flush the file before replacement and its folder afterward

Use `writeFileDurable` when replacing a state file. It flushes the temporary file,
renames it into place, then flushes the containing folder. The recovery-state and
trading-config tests observe that order through real file handles. A successful
write and rename alone do not exercise either flush.

The local backup backend uses `stageFileDurable`, checks cancellation, renames,
then calls `syncFolderHolding`. This preserves the old object when cancellation
arrives during staging. Its write, upload and download cases observe both flushes;
the cancellation cases retain the old bytes. The watcher cleared this exception
to fl3's direct-helper wording on 2026-11-10 at 21:27.

`scripts/durable-writes.test.ts` reads text in non-test source files importing
`fs` or `fs/promises`, with or without `node:`. It sees plain `rename(`,
`renameSync(` and object `.rename(` calls after comments are blanked. Its named
exceptions come from the fl3 inventory; it does not verify their flushes.
Plain writes, aliases, re-exports and indirect file-system access escape it.
The venue-holder heartbeat deliberately stays unflushed. `writeDurableHostJson`
keeps its exclusive temporary names and linked-parent refusal.

## Read live SQLite state through SQLite

If your process holds SQLite connections, inspect their live state through SQLite too.
Closing a separate raw descriptor for a file can release the engine's locks on that file.
For commit notifications, compare `PRAGMA data_version` on the store's read connection:
SQLite does not change a connection's version for that connection's own writes.
Keep the row-change count as well, so reads and schema-only changes do not send notifications.

The 12 November 2026 SIGBUS reproduction held a read transaction, subscribed to store commits,
and asked another process to checkpoint. The checkpoint returned `busy: 0` instead of `busy: 1`.
In Cloud's translation proof, a native trace then caught its snapshot reader shortening
`venue.db-shm` from 32768 to 3 bytes in SQLite's `unixLockSharedMemory`; the server's next read
ended with SIGBUS. Keeping the raw descriptors open made that baseline exit 0, but owning
those descriptors across multiple stores would add another lifecycle. The detector instead
uses the existing SQLite reader. The cross-process cases in `connections.test.ts` and
`index.test.ts` check the held reader, commits through the writer, and two stores sharing a file.
Run `pnpm --filter @waitron/store exec vitest run src/connections.test.ts src/index.test.ts`.

| Source | Exact words | What you should do |
| --- | --- | --- |
| [SQLite corruption guide, §2.2](https://www.sqlite.org/howtocorrupt.html#posix_advisory_locks_canceled_by_a_separate_thread_doing_close_) | “cancel all POSIX advisory locks on the same file” | Avoid raw open/read/close access beside your process's SQLite connections. |
| [SQLite WAL format, §1.3](https://www.sqlite.org/walformat.html#the_wal_index_or_shm_file) | “the first client to connect to a quiescent database will normally truncate the shm file” | Preserve SQLite's locks so another client does not mistake a live mapping for an unused one. |
| [SQLite `data_version`](https://www.sqlite.org/pragma.html#pragma_data_version) | “unchanged for commits made on the same database connection” | Observe the write connection through the separate read connection. |

**Naming and error codes**

## Error codes name the DOMAIN CONCEPT, never the throwing package

`series.not_found`, not `db.series_not_found` (design note atop `packages/shared/src/errors.ts`).
**Before a venue is live, a code may be renamed or deleted freely; once one is live, either is a
migration** (owner decision 2026-09-26, replacing "never renamed once shipped; deprecate and add a
sibling"). Either way it is one change in which every copy in the tree moves or goes. Grepping the
code finds the registry, the wording keyed
by it, the tests and the HTTP status maps. It does not find a consumer that matches a code by its
prefix — the alert area claims (`claimFor`, `apps/server/src/alerts.ts`), the setup wizard's
`provisioning.`/`fiscal.` routing (`apps/setup/src/setup-app.ts`),
`apps/server/src/rejoin-command.ts`'s `rejoin.` handling and `apps/server/src/restore-command.ts`'s
`restore.`/`recovery.`/`backup.` handling — so a rename that changes the prefix, or a deletion, is checked
against those too. It does not find the stored copies, because each store takes whatever code arrives: `incidents.code` (`packages/db/src/schema/incidents.ts`), `scheduled_runs.error_code`
(`packages/payments/src/schema/scheduled-runs.ts`), `print_jobs.last_error`
(`packages/db/src/schema/print-jobs.ts`), which also holds an agent's free-text report, and
`recovery.json`'s `lastErrorCode` (`apps/server/src/recovery-state.ts`). Before a venue is live they are not rewritten (CLAUDE.md
§3's no-data-migration rule); once one is live they are, and anything outside this repository that
reads the code accepts both names until both sides are deployed. Old log lines keep the old name. `server.*` is
reserved for facts about the process itself (`apps/server/src/errors.ts`). Every file that throws a
code imports its registry (`import "./errors.js"`); reachability is guarded once, in the root
project (§4).

## A refusal's HTTP status says what was wrong, by one rule for every API

The owner's rule (2026-10-08): the thing the request's path points at is missing → 404; something
the body (a form, a bundle, an import) refers to is missing or unusable → 400; a clash with stored
data → 409; a file or copy that cannot be opened → 422. So one code can rightly answer 404 on one
route and 400 on another: `service_zone.not_found` for `GET /api/service-zones/:zoneId/offers`,
and for a zone a body names. A boundary (`createErrorBoundary`,
`packages/server-kit/src/error-boundary.ts`) answers the status its table gives a code, and 400
for a code its table leaves out — except a full disk anywhere in the error's causes, which answers
`storage.disk_full`, at 507 unless the table names it; a route that needs another status for one code gets a second
boundary over a spread of the table, as `runVariant` in `apps/server/src/catalogue-api.ts` does.
On 2026-10-08 `git grep -E 'status (===|!==) ?[0-9]{3}'` over the client trees found three
status reads: the till's 403 check (`department-transfer-monitor.ts`), the setup app's 404 read as
"already set up" (`setup-app.ts`) and the menus screen's `!== 200`; refusals are told apart by
code. Nothing guards the rule. The routes that broke it on that date, and the follow-ups that fix
them: `docs/superpowers/plans/2026-10-08-a394-refusal-statuses.md`.

## A recorded incident code needs an area claim and English and Spanish alert wording

An incident whose code no module claims (`alerts.events` on its module descriptor, matched by the
longest prefix) is shown under diagnostics, to `system.manage` only
(`UNCLAIMED` in `apps/server/src/alerts.ts`). A code with no entry in
`apps/dashboard/src/i18n/alert-messages.ts` is shown as a generic sentence with the raw code beneath
it. The guard, `scripts/alert-codes.test.ts` (root project), collects code-shaped string literals
from the files in its `INCIDENT_CODE_SOURCES` list, minus `NOT_RECORDED`, and checks each has a claim
and both wordings. It reads text, which makes it weaker than its name in the same ways its opening
comment lists:

- It matches only double-quoted literals with one dot and nothing but lowercase letters and
  underscores (`/"([a-z_]+\.[a-z_]+)"/`). A single-quoted or backtick code, a code with a digit or a
  second dot, and a code built at runtime all escape the scan.
- A listed code counts as recorded because its text appears in a listed file, not because anything
  in production raises it. The guard's opening comment names the codes counted that way.
- A file that only names a code and hands it to a writer elsewhere (as `packages/fiscal/src/clock.ts`
  builds the clock warnings that `packages/core/src/record-sale.ts` records) is scanned only if it is
  listed.
- It spots a new writer only by the call shapes `recordIncident(`, `recordIncidentOnce(` and
  `incidents(tx`. A file recording through a sink under another name, or through a transaction
  variable not named `tx`, is not caught, and neither are the codes that file names.
- It looks for writers only in `.ts` files under `packages/*/src` and `apps/*/src`, skipping any
  `testing` directory, so a writer elsewhere (such as `apps/server/scripts/`) is not seen.

The guard also requires wording for `alert.source_unavailable`, the alert the server builds in place
of an ongoing check that failed.

**The `backup` source is for incidents only.** `incidents.source` takes `INCIDENT_SOURCES` (every
entry of `SOURCES` plus `backup`, `packages/shared/src/origin.ts`, declared through
`incidentSourceColumn` in `packages/db/src/schema/origin.ts`); every other column declared from
that file takes `SOURCES` (`sourceColumn`) or `SALE_SOURCES` (`saleSourceColumn`). Why: a backup
run writes only incidents, and widening the general list would rebuild `working_orders`, `order_amendments`, `unpaid_departures` and
`time_entries` too, and `working_orders` has many children pointing at it (A1167 slice 1 plan,
deviation 3).

A sibling guard, `scripts/ongoing-alert-codes.test.ts`, holds the ongoing (non-incident) source codes
to the same English-and-Spanish wording bar; it too reads source TEXT and hand-lists its source files
(`apps/server/src/alert-sources.ts`, `packages/fiscal-verifactu/src/submission-alerts.ts`,
`packages/fiscal-verifactu/src/certificate-alerts.ts`,
`packages/fiscal-verifactu/src/clock-behind-alerts.ts`, `apps/server/src/clock-disagrees-alert.ts`), so an ongoing source added in any other file
is silently missed until it is added to that list.

## General code is English only

**The owner's decisions.** On 2026-09-07, recorded at the time rather than quoted: core code is
English only; Spanish belongs only in the Veri\*Factu code (`packages/fiscal-verifactu`, and
`packages/verifactu`, which became the registry library `@waitron/verifactu` in #486) and in
translations, with AEAT's wire-protocol field names (`ObligadoEmision`, `NIFObligado`) as the one
exception, because they are AEAT's API. That came from #258, which renamed
a generic guard ONTO the fiscal word `obligado` (`assertNoForeignObligado`,
`provisioning.foreign_obligado`) through `packages/provisioning` and `apps/server`; #260 reverted it
to the English `tenant` names. On 2026-10-19, answering lane C's A758-1 question: "These default
starter names in the general module should be in English only, and should be translated into
Spanish and catalán etc when the box is set up only. There should be no text in Spanish in the
general code."

**What it covers.** Literals, template text, comments, identifiers, file names, hand-written SQL,
seed and starter content, and tests, in every package and app outside the homes the rule names. A
module's screen keeps its translations in its `dashboard/strings.ts`, an app's in
`apps/<app>/src/i18n/`, and the user guides' Spanish twins live under `apps/server/src/guide/es/`;
a test that checks the Spanish screen reads the expected text from that file rather than spelling
it. Starter content Waitron writes into a new venue, from a module's seed or a core setup step, is
English in its code and translated at setup from a translation file in the writing package,
`src/starter-content.ts`, keyed by the English. So far that holds for the void and comp reasons
(`packages/adjustments/src/starter-content.ts`), for the default kitchen station and the device
profiles (`packages/provisioning/src/starter-content.ts`), and for the service steps, the default
seasons, the counter zone and the starter menu period
(`packages/venue-service/src/starter-content.ts`); and for the units and the first
menu (`packages/catalogue/src/starter-content.ts`), A918.
A language map, such as a reason's names, gets the venue's starting content languages (the area's
default content language, the languages the area requires every venue to keep, then English) that
the file carries, plus English. A field holding one name, such as a reason's plain name, the
station's, a profile's, the first menu's or a unit's staff name, gets the explicit English or Spanish
working language chosen at initial setup. Without that choice, and for a department added later,
it uses the receipt language when the staff screens have it, `es-ES` or `en-GB`, otherwise the area's
screen language, cut to `es` or `en`. So a file of one-name rows carries only the staff languages other
than English (`es`). A starter unit's abbreviation is the same letters in every language, so it is
not in the file: its map holds the staff abbreviation under each language its name holds. The
first menu's root section takes the menu's name and starts with no customer-facing names; the home
layout's internal name, "Home", is shown nowhere and stays English in code.

**What it cost.** A758-1 (branch `feat/a758-1-reason-rules`) seeded the starter reasons «Cambio del
cliente» and «Queja del cliente» from `packages/adjustments/src/provisioning.ts`. The push hook's
English-only check refused them only because «cliente» is on `FISCAL_VOCABULARY`
(`packages/fiscal-verifactu/src/vocabulary.ts`). Measured 2026-10-19 on main b6db40ce1, with
`findSpanish` over the assembled forbidden set in a throwaway root test: `"Cambio del cliente",
"Queja del cliente"` reported `cliente` twice; `"Cambio de idea", "Queja", "Plato frío", "Propina"`
reported nothing; `export const obligado = 1;` reported `obligado`. So a Spanish word nobody listed
passes, and only review stops it.

**The packages written for Spain, and country packs (owner, answering the A913 audit, 2026-10-20).**
In the owner's words: "The Spanish specific packs are fine to house official quotes and Spanish
specific terms. Also, I think in country packs we should also always provide English, even though it
is not an official language." And: "The receipt in Spain should always be printed in the receipt
language (eg catalán), not English. Anything that lives in the non Spanish country pack/or verifactu
[fiscal] package should be in English only, with translations provided in an i18n file." And: "Each
country pack should have country specific demo data", then: "Even region specific demo data, eg
catalán demo in Catalunya." So `country-es`, `workforce-es` and `reporting`'s modelo 303 are homes, like
the Veri\*Factu package, for text official only in Spain (BOE holiday names, INE province names,
AEAT's form descriptions), for Spanish-specific terms, and for Spain-only printed text with its
translations in Spain's official languages; Spain-only text or logic found in general code moves
into them. Every country pack must also carry English for the words it shows, and a receipt in Spain prints in the venue's receipt language, never English. A963 moved recipient-address completeness and country names into Spain's pack. Remaining fixes are tracked under A913
([A913 in the backlog](../backlog/architecture.md#a913s-fix-items-general-code-english-only)).

## Spanish domain terms are deliberate, and a module declares its own

The guard (`packages/db/src/english-only.ts`; suite `scripts/english-only.test.ts`, root project)
reads every file `git ls-files` lists under `apps/` and `packages/`, skipping as binary a file that
holds a NUL byte. In each it refuses a base list of generic Spanish plus every module's declared
`vocabulary` seat, and any of the letters `áéíóúñÁÉÍÓÚÑ¿¡àèòçÀÈÒÇüÜ`. One declaring home per word: a
fiscal term goes in `FISCAL_VOCABULARY` (`packages/fiscal-verifactu`), a labour term in
`WORKFORCE_ES_VOCABULARY` (`packages/workforce-es`), never the base list — the suite fails on a
clash. Designed and built in #240.

It never reads the homes `isHome` names: the packages written for Spain (`fiscal-verifactu`,
`country-es`, `workforce-es`, `reporting`), a file inside an `i18n` folder or named `strings.ts`,
the guide in every language but English (`apps/server/src/guide/<lang>/`), a
package's `src/starter-content.ts`, and the two files that list forbidden words
(`english-only.ts` itself and `packages/fiscal/src/no-regime-vocabulary.test.ts`).

Two lists sit beside it. `KEEPS_NON_ENGLISH` in `english-only.ts` names the files outside the homes
whose job needs non-English text, each with its reason. `scripts/english-only-still-to-clean.ts`
names the files that held non-English text on 2026-11-10 and that nobody has yet cleaned or judged to
need it. A listed file with nothing left to find fails the suite until its entry is deleted, and
the suite holds the list's length equal to `STILL_TO_CLEAN_COUNT` in the suite, so deleting an entry lowers the
count in the same change and adding one has to raise it where the diff shows it. A renamed or moved
file's entry follows it, and the count stays. Never add a file to the list; clean the file, or move
it to `KEEPS_NON_ENGLISH` with its reason. Each keep carries the number of findings its file holds,
and the suite fails when the file holds more or fewer.

**What the guard does not see.** `scripts/english-only.test.ts` is weaker than its name. It knows a
fixed word list plus a set of accented letters, so a Spanish word with no accent and not on the list
passes. A kept file is held to its number of findings, not to which lines they are on, so new text
that replaces kept text passes. A file on the still-to-clean list is checked only for holding at
least one finding, never line by line. The pinned count stops the list growing on its own, not a
swap: deleting a cleaned file's entry and adding another file in the same change keeps the length
and passes, and nothing compares the list with `main`'s copy.
It reads tracked files only, and never checks a file's NAME. It finds comments without a parser,
guessing from the code before a `/` whether it opens a regular expression, and a wrong guess can
hide a word in code on a later line; it applies the same guessing to every file, including
Markdown, JSON and SQL. It skips a `«…»` quote anywhere in the source (code included) and a backtick
citation in a comment. Nothing checks that a home holds only what its job needs: no home is read
at all, comments and identifiers included, and that takes in every file in an `i18n` folder (tests
and code too), any file named `strings.ts`, and a package's `src/starter-content.ts`.

**Module and package boundaries**

## The composition list lives in `@waitron/composition`, and it is the only place that names every module

Generic provisioning code imports neither that list nor a REGIME package (`@waitron/fiscal-verifactu`,
`@waitron/verifactu`) — `packages/provisioning/src/bin.ts` excepted, it is the CLI's composition root
— and no file under `apps/server/src` imports a regime package outside the allowlisted runtime pass.
The regime is reached through the descriptor's `provisioning` and `fiscal` seats. The boundary is the
swappable SLOT, not "any module": provisioning's `@waitron/identity` and `@waitron/layouts` imports
are legitimate. `scripts/module-seams.test.ts` (root project, reads text) pins it, each allowlist
entry carrying its deferral reason — shrink that list in `fiscal-none`, never grow it. A module's
per-node seed runs INSIDE `applyVenue`'s one transaction: a seed that throws rolls the venue back.
Cost of the old shape: the generic venue runner, the node runner, the standby reservation and
establishment, and the till's backend construction imported the Spanish regime directly, and
`fiscal-none` could not land. Designed and built in #245. On the browser side
`@waitron/dashboard-modules` is the composition list's twin — the one place that names every
UI-bearing module (guarded by `module-seams` + `dashboard-browser-purity`), so `apps/dashboard`
mounts modules without naming one, exactly as generic provisioning does not.

**What the guard does not see.** `scripts/module-seams.test.ts` blanks comments then reads text; the
shared reader guesses whether `/` opens a regular expression, and import-like strings can still
match.

### Modules can describe staff shifts

When your module owns a shift's area or staff role, contribute `describeShifts(tx, shiftIds)` on
`WaitronModule`. Return a map only for the ids you can label. The host calls the enabled modules
inside the own-shift read's transaction. Both own-shift routes return `description`, or null when no contribution labels the shift. The till and My schedule render that
field. See `apps/server/src/boot.shift-descriptions.test.ts` for enabled and disabled boot cases.

The dashboard's `listMyShifts` subscription watches `shifts` and `roster_versions`. An area or staff-role rename alone
does not refresh an already open own schedule; the next read picks it up.

## A test-only dependency closes a workspace dependency loop as surely as a runtime one

pnpm counts `devDependencies` when it looks for a loop, and prints "There are cyclic workspace
dependencies" on every install. Two test-only links made one: `@waitron/migrations` listed twelve
modules to compare their journal table names with the manifest, while those modules used
`@waitron/migrations` in their own tests; and the replication suites in `@waitron/sync`
used `@waitron/provisioning`, which reached `@waitron/sync` again through `@waitron/composition`. The
journal-table test moved to `packages/composition/src/composition.test.ts`, and the replication suites
moved to a package nothing depends on. Receipt, 2026-09-13:
`scripts/workspace-cycles.test.ts` listed the ten-package loop before the move; on the finished tree
it passed, failed again when `@waitron/provisioning` was added back to `sync`'s `devDependencies`, and
`pnpm install` printed no loop warning.

The two packages named in that receipt — `@waitron/sync` and the replication-test package — were both
deleted on 2026-09-19, so the loop they closed no longer exists.
The RULE and the guard stand: any future test that needs packages from both ends of a loop needs the
same home.

The guard reads each member's `package.json` rather than asking pnpm for its graph, and counts every
dependency whose name is another workspace member.

## A command name is declared under `waitron.commands`, never `bin`

pnpm links a `bin` while it INSTALLS and skips one whose target is missing, and nothing here builds
at install time, so a `bin` under `dist/` is never linked by the install that reads it. Every CLI is
run by path anyway (`node /app/bin-restore.js` in the image). Cost: repeated `Failed to create bin`
warnings on every install, in every worktree and in the image build, plus an AEAT runbook whose
`pnpm --filter … exec waitron-credentials` steps could never have run; the measurement, taken both
ways, is in #326's commit message. Guards:
`scripts/manifest-commands.test.ts` (a declared `bin` target must be tracked by git; a
`waitron.commands` target must be the outfile of an `<entry>=<outfile>` pair its own package's
`build` script hands to `scripts/bundle-node.mjs`, which is a text match) and
`scripts/deploy-image-env.test.ts` (the image ships every name the server declares).

## A change adding third-party code or a binary to the image carries its licence notices

Owner decision 2026-09-24: a change that adds third-party code or a binary to the box image carries
its licence notices in the same change. They ship in the image's `/app/third-party/`, either
committed under `deploy/third-party/` or copied there by the build (libvips's notices come out of
its npm package in `deploy/Dockerfile`); `deploy/third-party/README.md` says what each file is.

What it cost. Litestream 0.5.17 landed in the image (#590) with its own Apache 2.0 licence alone,
while the binary is a statically linked Go program carrying the Go standard library and runtime
and 97 Go modules (`go version -m` on each of the two 0.5.17 linux binaries listed 97 `dep` lines).
`deploy/third-party/litestream/NOTICES.txt` then printed 68 distinct texts; counted 2026-09-24 over
those printed blocks with whitespace collapsed and case ignored, 23 contain MIT's "shall be
included in all copies" and 28 BSD's "Redistributions in binary form must reproduce the above
copyright notice" (29 counting the toolchain's `src/crypto/internal/boring/LICENSE`, where ` * `
comment markers break the phrase). That file is produced by `scripts/litestream-notices.mjs` from the
`go version -m` output of both pinned binaries, fetching each module's archive, and one
golang.org/toolchain archive per platform, from proxy.golang.org; `deploy/third-party/README.md`
has the steps to regenerate it.

What the guards leave open. The third-party blocks in `scripts/deploy-image-env.test.ts` read
text and cover libvips, Litestream, versitygw, the print agent's python3-minimal, the Iosevka font, the
dashboard's Google Sans, the bundled npm notices in the two images, and the Google "G" trademark
line in the notice only; for Google Sans they check the copyright line in the notice and in
`deploy/third-party/google-sans/OFL.txt`, that the font file in the dashboard's source matches the
SHA-256 the notice records, and that image-smoke looks for `google-sans/OFL.txt`, never that a
build emits the font or that the built image serves it;
for Litestream and versitygw they compare each `NOTICES.txt`'s version line with the pin, never the
module list with the binary, and never versitygw's `NOTICE` with the release's; for Iosevka they check that `deploy/third-party/iosevka/LICENSE.md`
carries the copyright line `packages/printing/src/glyphs.ts`'s header names and that the
provenance file names the header's font sha256, never that the table was drawn from that font
(added 2026-10-01, C107). Bundled npm packages now have generated notice files in both images
(`scripts/npm-bundle-notices.mjs`; the image-smoke job checks that they are present). The print-agent
image (`deploy/Dockerfile`'s `print-agent` stage) also ships the Debian copyright
files of python3-minimal and the packages its install added under `/app/third-party/python3-minimal/`,
and none for bluez (`docs/backlog.md`).

**What the guards do not see.** Every third-party block but the npm one covers one named component,
so a new binary or system package is seen by none of them. npm notices are generated per bundle;
that block reads the Dockerfile and image-smoke as text for a hand-written list of apps, so it
checks that each app's notice folder is named, not that each generated file is copied.

## `@waitron/db`'s `exports` map is enumerated, not a wildcard

Every entry is written out one by one in `packages/db/package.json` — the main entry, one per
test helper this package deliberately publishes to other packages, and, until A760's Task 11, one
per folder of module table definitions (`./schema/<folder>.js`), which module packages' source and
suites, and an `apps/server` suite, import. Read that file for the current
list rather than any copy of it kept here; a copy in prose is a thing to maintain, and this one had
already gone stale once. A wildcard would publish the whole harness. Consequence: `apps/server`
cannot deep-import `packages/db`'s `errors.ts`.

## A new product domain lands as a MODULE, not as new code in the core

A domain is a package that fills the contract seats (schema, sync, provisioning, fiscal,
vocabulary…) and is named only by `@waitron/composition`; generic code never learns it exists. Cost
of the other shape: a whole regime wired straight into `apps/server`, the till backend and the venue
runners, so `fiscal-none` could not be added until SP-3 pulled it back behind the slot — after which
the no-op regime was a package with an empty runtime duty and `apps/server` imported no regime at all
(`fiscal-none`, designed and built in #262).

## A country pack is a browser-safe preset over modules, not a module

Generic contracts live in `@waitron/country`; each country owns its validation and geography in a
separate package; and `@waitron/country-packs` is the only package that names every installed
country implementation. Packs name module and fiscal contribution ids as strings and never carry an
external-provider credential. Setup derives geography-dependent values in the browser and repeats the
derivation at the server boundary. Guarded by `scripts/module-seams.test.ts`; designed and built in
#292.

## `packages/db/src/schema/columns.ts` is the only file that names the engine's column and table types

A table file declares its columns from that vocabulary — `id`, `ts`, `day`, `money`, `quantity`,
`rate`, `label`, `flag`, `count`, `json`, `binary`, `enumText`, `table` and the rest — and never
calls `integer(…)`, `text(…)` or `sqliteTable(…)` straight from `drizzle-orm/sqlite-core`, which is
where the vocabulary itself imports from now. That import line is also what the guard derives its
forbidden set from, so the list moves when the vocabulary's does. Task F1 is what the rule bought:
the switch replaced the bodies in that one file rather than every column declaration in the tree
(the vocabulary landed in #390, the switch in #489).

What it cost: fourteen pull requests, #393 through #414, most of them one package at a time. Each
conversion proved "no schema change" the same way — generate that package's migrations into a copy
of its migration folder, diff the copy against the real one, expect no difference. Two changed what a
CALLER is handed rather than what the database stores, both in the same direction: the hand-rolled
`bytea` block behind `print_jobs.payload` in `packages/db` (#396) and the three sealed columns in
`packages/credentials` (#413) typed their values as node `Buffer`s, where the shared `binary` helper
hands a `Uint8Array`. `packages/media`'s block already declared the `Uint8Array` shape, so converting
it changed nothing a caller sees.

No `pgEnum` column was left behind in the end. A closed vocabulary is `enumText`: a `text` column
whose permitted values are listed in a `check()` constraint that `enumCheck` builds from the same
array the TypeScript type is derived from, so the type and the constraint cannot state different
sets. On this engine that constraint is the only thing between the column and any string at all.
`products.ordering` has no CHECK at all: its values are refused by a trigger pair instead
(`packages/db/drizzle/0000_baseline.sql`), because adding a CHECK to an existing table
makes drizzle rebuild it.

Guarded by `scripts/column-vocabulary.test.ts`, whose own header says what it reads and where it is
blind — read that before changing it, rather than this. It forbids only the builders the vocabulary
itself imports, so one it does not import passes anywhere: measured 2026-09-23, a file importing
`blob` and a file importing `text` added side by side under `packages/fiscal-verifactu/src`, and
the guard reported only the `text` one. Two things about it belong here, because they are decisions
rather than mechanism:

- **It is a ROOT guard, not a case in `packages/db`'s own suite**, which is where the plan put it. CI
  runs a package's suite only when the scoping selects it, and a pull request selects only the
  changed packages (A1461, 2026-11-08; before that it added their dependents, and measured
  2026-09-18, `pnpm --filter "...@waitron/bookings" ls --depth -1 --json` listed seven packages
  without `@waitron/db`), so the check would never have run on a pull request adding a table file
  in `packages/bookings`. Same defect that moved the repo-wide
  guards out of `packages/db` on 2026-08-01; the root `vitest.config.ts` header carries that history.
- **One exception, scoped to a single builder rather than to the file**: `text` in
  `packages/fiscal-verifactu/src/schema/registros.ts`, whose `cuota_total` and `importe_total` store
  the exact bytes hashed into the Veri\*Factu huella and so must not pass through a helper that could
  re-render them. A different builder in that same file is still reported.

The rule landed in the same change as the guard and not earlier, although a reviewer asked for it
after the first package converted: root `CLAUDE.md` §7 says a written rule with standing violations
needs a guard rather than another paragraph, and until the last package converted every unconverted
one was such a violation.

A table declares its columns from the vocabulary so the NEXT engine change replaces one file rather
than every column in the tree.

**What the guard does not see.** `scripts/column-vocabulary.test.ts` reads the IMPORT or re-export
line as text, so a builder reached through `import * as` is invisible to it. A builder the
vocabulary STOPS importing would leave the set the same day; the hand-written list that holds such a
name forbidden sits beside the derived one, and it is empty.

## A module that can be switched off or swapped keeps a migration set of its own; any other adds its tables to core's set, and the commit says which

Since A760 (November 2026), a module that can be switched off or swapped keeps its own migration
set (`migrations.from`); every other module adds its tables to core's set and names core in
`tablesIn`. Staffing and workforce became permanent in A1002; staffing’s remaining tables stay in
workforce’s set (`tablesIn: "workforce"`, `packages/composition/src/modules.ts`), while job roles
and their holders live in core under identity. Workforce keeps its existing set. `node` cannot be switched off and keeps its own set, because that
set is applied to `node.db` rather than `venue.db` (`database: "node"` on its descriptor). Either way the
append-only declaration travels with the set that holds the table — the table is declared with
`appendOnly()` in that set's classification, and `MigrationSet.appendOnlyTables` carries the names
to `applyMigrations` (`packages/migrations/src/manifest.ts`). The commit that adds a table says
which of the two it did and why. Same defect class as §1's unstated claims — an unexplained choice
of set is a boundary decision no future reader can audit.

**Writing SQL safely**

## Never build SQL by string concatenation — except for an identifier, which SQLite will not bind

Drizzle's `` sql`… ${value}` `` parameterises (verified: `o'brien; drop table x --` round-trips
intact), but no engine binds an IDENTIFIER, and this one says so plainly. Measured 2026-09-22 on Node
v26.7.0: `db.prepare("delete from ?")` throws `near "?": syntax error`, and `delete from "?"` is a
query against a table literally called `?` (`no such table: ?`) — both errcode 1. So a table or
trigger name that has to reach a statement arrives as text or not at all, which leaves the same two
options as before: **escape** (`quoteIdent` in `packages/provisioning/src/identifiers.ts` and
`quoteLiteral` in `packages/shared/src/sql-literal.ts`) or **validate and throw** (`assertSafeIdentifier`,
`packages/db/src/testing/identifiers.ts`, which records the same reading at its own head). Neither is
not acceptable; "the callers only pass safe values" is the §1 defect class.

The engine takes no bound value in the body of a generated trigger either. For an identifier and
for such a body, either escape (`quoteIdent`/`quoteLiteral`, as the change feed does with each
source's type, `packages/db/src/change-feed.ts`) or validate and throw (as the append-only installer
does with each table name, `packages/store/src/append-only.ts`).

## A `sql` scalar subquery correlated to the OUTER query's table breaks silently when that table is the `.from()` base rather than a join

Drizzle renders `` `${table.column}` `` as the bare quoted column; joined tables are aliased so it
resolves outward, but a base table's bare `"id"` binds to the SUBQUERY's table — no error, a wrong
answer (#152: a null table label). Copying a correlated subquery: check base-vs-join and READ the
emitted SQL with `.toSQL()`.

## An untargeted `.onConflictDoNothing()` absorbs every unique conflict, not only the primary key's

`writeItems` in `packages/catalogue/src/extras.ts` inserted each of an extras list's items with a
bare `.onConflictDoNothing()` and read "nothing came back" as "another transaction already holds
this id". Verified with `.toSQL()` on drizzle 0.45.2: the untargeted call emits
`… on conflict do nothing`, and the same insert with `{ target: extraListItems.id }` emits
`… on conflict ("id") do nothing`. The table also carries
`extra_list_items_list_product_uq` over `(list_id, product_id)`, so the bare clause swallowed a
PRODUCT collision too: a body adding an item for the product a retained item was moving away from
came back as `extras.invalid` naming `items.0.id`, an `id` field that body never sent, which breaks
the rule that a refusal is placed beside a field by what the error carries.

Name the target whenever the table has more than one unique constraint and the code reads the empty
result as a specific cause. Other untargeted calls are still in the tree and nothing guards this;
`grep -rn 'onConflictDoNothing()' --include='*.ts' packages apps` finds them.

## Editing rows one at a time can break a unique index the final state satisfies

That same `writeItems` kept the rows a save still named and updated each where it stood, so a body
exchanging two items' products would have put both rows on the same product midway through, which
the index refuses, although the body's final product set was legal. Measured 2026-10-02 on
`node:sqlite` (Node v26.7.0, SQLite 3.53.4), on a bare table with a unique index over `(list_id,
product_id)` holding products A and B: inside one transaction, updating the first row to B printed
`UNIQUE constraint failed: extra_list_items.list_id, extra_list_items.product_id`, errcode 2067, and
deleting both rows then inserting the swapped pair committed. The case is `saves a body that
exchanges two retained items' products` (`packages/catalogue/src/extras.concurrency.test.ts`). It
now deletes every one of the list's rows and inserts the body's fresh, each under the id the body
sent or a new one, which removes the intermediate state rather than ordering around it.

That is safe under two conditions, and the second one is easy to miss. The FIRST is that nothing
outside the table holds a key into it, so the rows may lose their identity — and it is
`extra_list_items` that is being rewritten, so what matters is who references THAT table. The grep
had to be respelled for the storage switch: the generated SQLite baselines quote with backticks and
name no schema, so the old `REFERENCES "public"."extra_l` pattern matches nothing at all now. Run
``grep -rn 'REFERENCES `extra_l' --include='*.sql' packages`` — two lines on 2026-11-09,
`packages/db/drizzle/0000_baseline.sql:1966` and `:1994`, both naming `extra_lists`, the PARENT (three
on 2026-09-22, then in catalogue's own baseline). None names `extra_list_items`, so the condition
still holds; the count does not stand on its own, because the
pattern matches the parent's name as well. Scope it to `packages` rather than `packages apps`:
`apps/server/dist/drizzle` holds built copies of the same baselines, and it is git-ignored build
output rather than a second place a key could live. A table something else references cannot be
rewritten this way.

The SECOND is that two writers replacing the same set must be serialised. That condition is about
the WRITE, not about row identity, and the grep says nothing about it: an unserialised second
transaction's `delete` cannot see the first's uncommitted inserts, so it removes nothing, and its own
inserts then meet the first's committed rows on `(list_id, product_id)`.

**What serialises them now is the venue file's write queue, and there is no lock left to take.**
`withTransaction` (`packages/db/src/tenancy.ts`) runs its body inside `db.withWriteLock`, and
`packages/store/src/write-queue.ts` issues `begin immediate`, awaits the body, then `commit`, so the
next caller's `begin` does not run until that `commit` has returned. That holds for every row in the
file rather than for the one a clause named. SQLite has no row locks to take instead, and drizzle's
SQLite query builder has no `.for()` at all — so `assertExtraListForWrite`
(`packages/catalogue/src/extras.ts`, under the heading *Why this stopped being a lock*) is now the
404 it always also was, and nothing else.

**The control.** The thing to observe is "the second one has not STARTED". That is `racePair` in
`packages/catalogue/test/fixtures.ts`, which every concurrency case in the package goes through, and
its header records the reading in both directions taken back to back: two bodies started through
`withTransaction` report `secondStarted === false` while the first is held, and the same two bodies
started without it report `true`.

**The swap measurement in this section's first paragraph is on a bare table, not through
`writeItems`.** `saves a body that exchanges two retained items' products` passes; that deleting the
delete-then-insert turns it red has not been re-taken on this engine. `writeItems`'s own header says
the same thing at the site.

## Resolve shared catalogue data once before a basket's line loop

The Products review found that each basket line called `resolveZoneOffer`, which reloaded the whole
zone offer catalogue, then performed separate product-variant and menu-variant reads. Repeated items
therefore repeated the same sequential database work. `priceOrderLines` now reads one zone snapshot
before its in-memory line loop; the variants come from the offers it holds (`LiveOffer.variants`).
`working-order.test.ts` spies on `listZoneOffers` and checks that a basket repeating one offer calls
it once. Kitchen routing follows the same
rule: `fireLines` calls `VENUE_SERVICE.resolveMakers` once with the distinct product IDs for the
fire. The case "resolves every fired product's venue-service route in ONE batched call" in
`apps/server/src/working-order.test.ts` checks both that call and the stations reached by its
three fired lines. This checks batching at the service boundary, not a fixed database-read count.

## Opening hours store "no claim" as no row

**2026-10-13, A506-5:** named days are gone, and special days hold the calendar's dated choices
(see "Special days" below). A special-day date stores only what it changes: a department or zone
with no paint on that date follows the season's day, and each painted stretch replaces only its
own stretch of it (`layerPaint`, `layerZonePaint` in `packages/venue-service/src/day-paint.ts`;
`resolveDepartmentDays` and `resolveZoneClosedDays` in `day-resolver.ts`). A date Closed all day
closes every department. Venue-service migration `0051_wakeful_loa.sql` dropped `special_dates`,
`menu_day_timetables`, `menu_slots` and `zone_closed_times`, and their rows with them, so this
change required a venue reset.

Public holidays come only from the shipped country calendar; the venue is not a holiday source
(`readHolidays`, `holidays.ts`; see [public-holidays.md](public-holidays.md)).
Venue-service's old `venue-service/0038_clammy_klaw.sql` dropped `local_holidays`; that file was
deleted with the frozen history on 2026-11-07 (A1422), and
`git show f519799de0:scripts/fixtures/a760-history/venue-service/0038_clammy_klaw.sql` reads it. The earlier A261
storage account below is historical.

The upgrade guard's reset list describes losses in its synthetic rows, rather than every table
that can lose venue data. A 2026-10-09 probe on Node v26.7.0 / SQLite 3.53.4 applied the actual
`0028_menu_timetables.sql` and `0038_clammy_klaw.sql` to a small schema, running the rebuild inside
one transaction with foreign keys on: its dated `menu_day_timetables` row and `menu_slots` row
were deleted, while the weekday timetable and its slot remained. The `local_holidays` table was
absent afterwards. These losses are part of the reset requirement too.


### Permanent course and station deletion

You delete these kinds through management after reading their `DeleteImpact`. The write reads
that impact again inside its transaction, so a preview does not grant permission to delete.
Courses clear every product default; a course referenced before cleanup remains as history.
Stations refuse the default, explicit effective KDS bindings (including off devices), and
unfinished food. Fired ready food may remain. A permitted station delete removes its base
routing rules and all their period children, clears incoming daily destinations without
reopening those stations, clears its own "When closed, send to" choice and every other station's that names it, and clears only eligible unsent/open-draft choices. Recorded tickets, sent
order lines, draft events and groups stay unchanged.

An Every station screen keeps the deleted station visible while its queue has dishes. The
screen reads historical states through `routingAt().stations()`; setup and new selections use
the active-only `stationStates` map. The actual-delete ready-dish case in
`apps/server/src/device-api.test.ts` checks the screen, notice acknowledgement and disappearance
after collection.

An empty screen scope keeps its parent: `stationIds: []` means no stations, never Every. The
resolved device read has `available: true` and `stations: []` for that retained parent. A
removed screen kind has `available: false`; its removal marker is a different state.
`kitchen-delete.integration.test.ts` checks the management/history/routing path, and the
station and configuration-transfer suites check empty parents and exports.

### Prep stations without authored hours

**2026-10-10, A366 slice 4 Part B:** prep stations have no authored hours or configured
fallbacks. Routing uses an active station unless it is closed for today's business date.
A closed station follows its chosen daily destination. Deleted stations are not new routing targets.
A missing destination or a cycle also ends at the active default. With none, the route has no
replacement (`routing.ts`). Reopening deletes the daily state; it does not move sent work back.

Closing with unfinished dishes requires a Send or Leave choice. Send moves waiting
unserved queued or held dishes; started dishes stay. Leave keeps unfinished dishes at their station,
including held dishes when released (`apps/server/src/station-closing.ts`). The dashboard records
moves with the authenticated person's id and no device; till and device closures record their
actors in `ticket_item_moves`.

The Calendar's Show picker displays planned prep-station times. `stationServiceTimes` uses the shared
`readPlannedServiceGuides` reader to combine routed products on period menus with department
hours. The forecast ends each share at its period's end before subtracting zone closed times, and
joins overlapping shares of the same period. The public reader takes at most 42 dates
and works out each from that date's own plan, season and special day (`readDayPlan`); its route
refuses a `week` query (`packages/venue-service/src/station-service-times.ts`). The staffing season
painter instead passes the selected season's weekdays directly to the shared reader. The special-day
staffing painter passes the edited special day's own plan, including when another repeating day
would stand on one of its dates. All requested stations share the schedule and routing reads. Planning
ignores today's station closures and kept-open extensions. The default station answers
`always: "default"` and no dates, and the tab shows a sentence in place of the month; a deleted
station's id is refused (`station.not_found`). The default station's staffing guides show
scheduled demand from period menus and untimed routes.

Venue-service migration `0047_retire_station_hours_fallbacks.sql` dropped `hours_week_cells`,
`hours_week_periods`, `special_date_hours`, `special_date_hours_periods` and `station_fallbacks`.
The old Station hours page, client, wire types, readers and writers are removed. Configuration
exports omit those tables; import refuses them with `setup.request_invalid`, field `tables`.
Named days retained their calendar facts and department/zone schedules; they no longer copied,
validated or returned station cells. (2026-10-13, A506-5: named days are gone; the Calendar uses
`SpecialDaysApi`, `packages/venue-service/src/dashboard/special-days-client.ts`. A506-6 replaced the
Calendar with the Year view.)

Core migration `0131_station_retention_and_dashboard_moves.sql` adds held-dish retention and
permits a person-only move, refusing a move with neither person nor device. The populated upgrade
walk passed on this branch; station-hours and fallback settings are deleted. The slice 4 plan
requires a reset warning only if that walk reports a casualty.
The earlier hours accounts below describe their dated implementations.

### Earlier A261 hours storage

The dated slice 1 account below records the model before slice 4 retired it. (2026-10-13,
A506-5: `special_dates` is dropped too; see "Special days" below.)

**2026-10-08, A366 slice 1:** department opening hours now come from service periods.
The Hours grid described below now edits station restrictions only. Its `special_dates` calendar
also anchors department period schedules. `readHoursModel` and the Station hours page omit
department subjects; hours requests refuse them at `kind`, and
configuration import refuses a department owner. The old department Hours types and resolver
have been retired. The earlier A261 account below is historical; use the service-period model
in the next section for departments.

Hours (A261 step 5) keeps opening hours in five venue-service tables, all classified `state`:
`hours_week_cells` and `hours_week_periods` for each department's and non-default station's
standard week, and `special_dates`, `special_date_hours` and `special_date_hours_periods` for dated
exceptions (venue-service's `schema/hours.ts`, deleted in A506-5). They replace `station_hours` and
`department_hours`, which venue-service `0022_retire_legacy_hours` drops; old rows are not carried
over (the pre-production rule in "No backwards-compatibility or data-migration code until Waitron
is in production" below).

- A stored cell is `closed`, `all_day` or `periods` (the `*_mode_ck` CHECKs). "No hours set" for a
  subject's week and "keep the standard week" for a subject on a special date are both stored as
  no row at all; `not_set` and `inherit` exist only on the wire (`packages/venue-service/src/hours-types.ts`).
  A week is seven cells or none: `replaceWeekHours` (`packages/venue-service/src/hours.ts`) writes
  all seven or deletes them, and the configuration import's `validate` refuses anything else.
- A cell names its owner as a department or a station, and the SQL cannot tie that owner to the
  cell's venue; the writers in `hours.ts` resolve each owner within the venue before writing.
- A default station's special-date cells are dormant, not deleted: a save never removes one because
  the request left it out (no request can carry it), and duplicating a date copies it. It applies
  again if the station stops being the default, so that change is refused with `hours.invalid`
  when, on a special date from the venue's yesterday on, the hours it kept would clash with the day
  before or after, or open or close at a minute the clock skips (`assertDemotedStationHours`,
  `hours.ts`). When the venue's clock cannot be read, only the clash is checked, on every special
  date. The refusal names the special date to move or delete.
- A cell's periods are replaced by deleting and inserting the whole set, so a reordering cannot trip
  the position index midway ("Editing rows one at a time can break a unique index the final state
  satisfies" above).
- One special date per venue and date (`special_dates_location_date_key`).

## Menu timetables share the special-day calendar

**2026-10-08, A366 slice 1:** the W98 account below records the earlier model. All-day
menus, a zone's period-menu choices and separately authored department hours are retired.
Configuration-transfer verification is recorded under
[service-period configuration](#service-period-configuration) below.

You set a department's opening hours by placing its periods on the normal week. Each period has
a name, a colour, one customer menu and zero or more staff-only menus. Its ranges run inside the
venue's business day, from one changeover to the next. With a 06:00 changeover, Friday's
21:00–03:00 range ends on Saturday morning; 06:00–06:00 covers the whole business day.

With a readable venue clock, a special-day date with no paint for a department follows that
department's season week for that weekday; paint replaces the stretches it covers, a range with no
period closing that stretch. A date Closed all day closes every department. See "Special days"
below.

A period's menus can be picked and sent from its start until its end, one window for both: for
Lunch 12:00–14:00, 14:00 itself is refused (`orderableMenuIds` in `resolveDepartmentService`,
`packages/venue-service/src/menu-timetable.ts`). A dish line whose period has ended is refused
`menu_period.not_running` (`apps/server/src/working-order.ts`); increasing a line already sent to
an order is refused the same way, while unchanged lines, decreases and notes keep their stored-line
behaviour. A new dish whose period ended earlier the same business day (`endedMenus`) is the
exception: `priceOrderLines` accepts it at its taken price when a menu the running period offers
in the zone also sells its product and variant on its own, and otherwise refuses it
`menu_period.ended` (409) unless the request's `lateSend` names its menu and, where its department's
`late_send_needs_manager` is on, someone holding `venue.configure` authorises it — the
sender, or a manager's PIN (`apps/server/src/late-send.ts`). A confirmed dish's service context
rows (`working_line_contexts.late_period_name` and `late_confirmed_by`) record the period and who
confirmed; the kitchen ticket and the kitchen screen read them through `readLateSendMarks`. Plan
D19–D28. The till learns which menus ended from each menu's `endedPeriodName` on the zone-offers and
menu-state reads, and marks such a dish; when its 15-second poll has not caught up, from a
`menu_period.ended` refusal's params (`lateSendRefusalOf`, `apps/till/src/state/late-send.ts`). It
sends `lateSend` only after the waiter chooses Kitchen agreed in its late-send window
(`till-late-send-dialog`; plan D34–D38). Saving an unsent table draft does not check the window:
the till gates additions and increases, and the server checks the window when the order is sent. A
period save changes no time and takes no clock revision. Picking and sending remain separate from the department's actual open
state. The [A789 plan](../superpowers/plans/2026-10-21-a789-last-orders.md) records the decisions
(it retired A432's period end offset); `apps/server/src/till-api.service-periods.test.ts`
exercises the request boundary.
Pricing reads static period membership, without resolving ranges, dates or the clock. If the venue
clock cannot be read, timetable resolution leaves the department's period menus orderable.

Provisioning places the first department's starter period (named "Open" in the staff language)
at 09:00–17:00 Monday to Friday when there is a catalogue and no existing period. Setup's
completion screen shows those normal-week hours, with a link to Opening hours' Year, only when its
saved schedule matches them; the check finds that period by "Open" or any name the starter file
gives it (`STARTER_OPEN_PERIOD_NAMES`, `menu-timetable.ts`).
A different authored or demo schedule is not described as that first weekday schedule. The checks are in
`apps/server/src/setup-opening-hours.test.ts`, with the response and completed-request replay in
`apps/server/src/setup-api.test.ts`.

### Zone closed times

You subtract a zone's closed times from its department's service day, rather than writing another
opening schedule. A zone's week of closed times is in the season tables (see "Seasons and season
weeks" below), and a special-day date's zone paint is in the same tables (see "Special days"
below). `closedZoneIdsAt` (`packages/venue-service/src/zone-closed-times.ts`) reads the business
day's closures through `resolveZoneClosedDays` (`day-resolver.ts`): on a special-day date Closed all
day it reports no closed zone, as the departments are closed; on any other special-day date it lays
the date's zone paint over the season's closures (`layerZonePaint`), `closed` paint adding closed
time and `open` paint cutting it out; on any other day it uses the season's week. The start is
closed and the end is open.
When the venue clock is unreadable, this zone check reports no closed zone; department checks
remain separate.

A closed zone refuses new service, new dish lines and quantity increases with `service_zone.closed`.
`assertZoneTakesNewOrders` is called by
`apps/server/src/table-actions.ts`, `working-order.ts` and `move-bill.ts`; the route cases in
`apps/server/src/till-api.zone-closed.test.ts` check the resulting refusals. A move bringing an open
bill or guests into that zone is refused. Accepting a department transfer into it is also refused,
before resolving the request or changing its bill (`acceptDepartmentTransfer` in
`packages/venue-service/src/department-transfers.ts`; the closed-destination case in
`packages/venue-service/src/department-transfers.test.ts`). Notes, decreases, payment and splitting
existing bills (moving dishes to a new bill included) or joined tables remain possible. Bills and
guests can move within the closed zone or out to an open zone (`moveGuests` in `table-actions.ts`,
`adoptZone` in `move-bill.ts`, and the move-dishes-to-a-new-bill and same-zone/outbound
cases in `till-api.zone-closed.test.ts`). A presented bill moved on its own into another party or
to a free table in the closed zone takes its service context, because `adoptZone` refuses a closed
zone only for an open bill. Printing existing orders remains
possible: `/api/orders/:id/reprint` in `apps/server/src/till-api.ts` checks profile zone access through
`apps/server/src/zone-access.ts` and enqueues through `reprintOrderTickets` in
`apps/server/src/kitchen-print.ts`.
Pricing still reads static offer membership; zone closures do not change recorded prices.
`working-order.ts` performs the zone check when adding lines, separately from its offer read.

_2026-11-14: DEAD-CODE-1 retires the separate menu-week and closed-week HTTP routes
named below. The season painter saves through `PUT …/seasons/:seasonId/weeks`;
`replaceMenuWeek` and `replaceZoneClosedWeek` remain in-process writers._

**2026-10-18, A723.** Stored closures can still lie outside a department's hours (backlog,
Service periods). The routes refuse a closed range the request writes outside its department's hours, read in the same transaction
after the write (`packages/venue-service/src/zone-closure-hours.ts`): `PUT …/seasons/:seasonId/weeks`
and `PUT …/zones/:zoneId/closed-week` with `zone_closed_time.invalid`, reason `outside_hours`,
naming `field` (`zones.<i>.days.<j>.ranges.<k>`, or `days.<j>.ranges.<k>` on the closed-week
route), `zoneId` and `weekday`; the special-day routes with `special_day.invalid`, reason
`outside_hours`, naming `field` (`zonePaint.<i>.ranges.<k>`), `zoneId` and `date`, skipping a date
Closed all day. A configuration import refuses the same as `setup.request_invalid` with field
`zone_day_ranges` (`validateSeasonWeeks`, `configuration-transfer.ts`). The writers themselves do
not check: the season-week, closed-week and special-day routes pass the check to
`saveSeasonWeeks`, `replaceZoneClosedWeek` and `saveSpecialDay` as their `afterWrite` hook.

### Seasons and season weeks

**2026-10-12, A506-1.** `seasons` holds the venue's seasons, each a name and an `MM-DD` start;
`department_days` and `department_day_ranges` hold each department's week per season, and
`zone_days` and `zone_day_ranges` each zone's closed times per season
(`packages/db/src/schema/venue-service/seasons.ts`). A venue gets four seasons from
`ensureDefaultSeasons` (`packages/venue-service/src/seasons.ts`), called by venue-service
provisioning and, for a venue with none, by `targetSeasons` before a week write
(`packages/venue-service/src/season-weeks.ts`).

A week saved with no season named goes into every season; a week saved with a season named
changes that season alone (`replaceMenuWeek` in `packages/venue-service/src/menu-timetable.ts`,
`replaceZoneClosedWeek` in `packages/venue-service/src/zone-closed-times.ts`). The two week routes
(`PUT …/departments/:departmentId/menu-week`, `PUT …/zones/:zoneId/closed-week`,
`packages/venue-service/src/routes.ts`) require `seasonId`: a missing or malformed one is refused
`management.request_invalid`, an unknown one `season.not_found` (404).
In-process callers that name no season, such as `placeOpenPeriod` (`menu-timetable.ts`), which gives a new
department its first starter period (named "Open" in the staff language) at provisioning and
whenever a department is created, and the demo
seed, still write every season.

**2026-10-13, A506-6** (its three writes and routes replaced by `saveSeasons` on 2026-10-17, A721,
below). `addSeason`, `saveSeason` and `deleteSeason`
(`packages/venue-service/src/seasons.ts`) add, rename or move, and delete a season, behind
`POST …/seasons`, `PUT …/seasons/:seasonId` and `DELETE …/seasons/:seasonId` (`routes.ts`);
`GET …/seasons/:seasonId/delete-impact` names the departments whose painted hours a delete loses. A
new season starts with a copy of the department and zone weeks of the season it starts inside (a
venue with no seasons first gets its four); a deleted season's days join the season before it, and
its weeks go with it. A blank or taken name, a malformed or taken start, and deleting the last
season are refused `season.invalid` naming the `field`. Every write
must send `expectedClockRevision`; a stale one refuses an add, a move or a delete with
`hours.clock_changed`, but not a rename. An unknown or another venue's `seasonId` is refused
`season.not_found`, and while a day-cutover change was pending an add, a move or a delete was refused
`hours.clock_change_pending` (retired 2026-10-18, A788: see A721 below).

**2026-10-17, A721.** `saveSeasons` (`packages/venue-service/src/seasons.ts`), behind
`PUT …/seasons` (`routes.ts`), replaced `addSeason`, `saveSeason` and `deleteSeason` and their three
routes; `GET …/seasons/:seasonId/delete-impact` stays. The body may hold only `save`, `delete` and
`expectedClockRevision`. A `save` entry holds `name`, `startsOn` and `colour`, and an `id` when it
changes a stored season; one without an `id` adds a season. `delete` lists the ids to delete. A
malformed body, an unknown key or an id named twice across the two lists is refused
`management.request_invalid`, and an id the venue does not hold, in either list, `season.not_found`
naming `seasonId`. A refusal names
its place in the request, as `saveSeasonWeeks`' do: `season.invalid` with `field`
`save.<i>.name`, `save.<i>.startsOn` or `save.<i>.colour` (reason `taken` for a name or start
another season holds), or `delete` (reason `last`). Every entry is
checked before the clock: a call that only renames or recolours skips the clock check, and one with
an add, a delete or a moved start is refused `hours.clock_changed` on a stale
`expectedClockRevision` (`assertBusinessDayScheduleWrite`). Since 2026-10-18 (A788) such a call is
not refused because a business-day start change is waiting: after writing, it checks the venue's
hours as written against each waiting start and refuses `hours.clock_change_conflict` on a clash
(`assertWaitingChangeFits`, `packages/venue-service/src/business-day-schedule.ts`); cases "refuses
adding a season while a stored range clashes, since the new season copies it" and "adds a season
while a change waits when no stored range clashes" in `business-day-schedule.test.ts`. It is one transaction. Changed names and starts are written in two passes, first to temporary values no real season can
hold, so a swap of two names or two starts never meets the unique indexes; ids are kept, so each
season's weeks stay with it. A new season copies the weeks of the season that held its start
before the call, read before any delete. It answers the venue's seasons by start.

`seasons.colour` (`packages/db/src/schema/venue-service/seasons.ts`) is a plain text column,
`$type<CalendarColour>()`, defaulting to `grey`, with no CHECK. A CHECK makes drizzle-kit rebuild
`seasons`, and that rebuild's `DROP TABLE` empties `department_days`, `zone_days` and
`staffing_days`, whose season keys cascade (A721 plan, Decision 1, from a plan reviewer's probe in
a throwaway worktree, 2026-10-17). The refusal lives where a colour arrives from outside instead:
`saveSeasons` (`season.invalid`, field `save.<i>.colour`) and the configuration transfer's `validateSeasonWeeks`
(`setup.request_invalid`, field `seasons.colour`, `packages/venue-service/src/configuration-transfer.ts`). A stored value that
names no calendar colour is painted grey (`seasonTints`, `season-tint.ts`).

**2026-10-13, A506-8.** `saveSeasonWeeks` (`packages/venue-service/src/season-weeks.ts`), behind
`PUT …/seasons/:seasonId/weeks` (`routes.ts`), saves several departments' weeks and zones' closed
weeks of one season in one transaction; it is what the season painter calls. The body may hold only
`departments`, `zones` and `expectedClockRevision`; a department or zone named twice is refused
`management.request_invalid`, and a refusal that names a field names it by the entry's place in the
request (`departments.<i>.…`, `zones.<i>.…`); an unknown or inactive department is refused
`department.not_found` and an unknown zone `service_zone.not_found`, each naming its id.
`expectedClockRevision` is checked once for the whole request.

A configuration transfer carries the five season tables (`VENUE_SERVICE_CONFIGURATION_TRANSFER` in
`packages/venue-service/src/configuration-transfer.ts`). `importConfigurationTables`
(`packages/provisioning/src/configuration-transfer.ts`) deletes every row of a transferred table
before inserting the bundle's, so the target's four provisioned seasons give way to the exported
ones: the case "arrives as exactly the exported seasons, and the imported venue sells and closes by
them" in `apps/server/src/configuration-transfer.test.ts` renames and moves one season before
export, finds the target holding the exported four, and asks `resolveDepartmentService` and
`closedZoneIdsAt` about one Saturday in each of two seasons.

`validateSeasonWeeks` (`packages/venue-service/src/configuration-transfer.ts`) refuses, among
others: a season name that is blank, held by another season, or has spaces around it
(`setup.request_invalid`, field `seasons.name`); a season start that is not a common year's date or is `02-29`; a range off the
quarter-hour or overlapping another on the same day; on a season day, a department range with no
period (Closed) and a zone range of any kind but `closed`. It accepts a season with fewer than
seven day rows, and checks no skipped clock hour on a season day, as a season week has no date.
A day row naming a special-day date the bundle does not hold is refused; special days themselves
are under "Special days" below. The cases are under "season weeks in a configuration bundle" in
`packages/venue-service/src/configuration-transfer.test.ts`.

### Special days

**2026-10-12, A506-4.** A special day is a name, a `repeats_yearly` flag and a list of dates, possibly empty
(`special_days`, `special_day_dates`); each date is Closed all day or carries paint, which
`department_days` and `zone_days` rows naming `special_day_date_id` hold (no season, no weekday).
A department range with no period is Closed; a zone range is `closed` or `open`. Paint is laid
over the season's day for that date (`layerPaint`, `layerZonePaint` in
`packages/venue-service/src/day-paint.ts`); a Closed-all-day date closes every department.
Whether a date falls on a day is decided in one place, `specialDateIn` and `sharedSpecialDate`
(`packages/venue-service/src/special-days.ts`): a repeating date from its first year on, and a
29 February only in leap years. A repeating date saved on a public holiday records the holiday's
name (`special_day_dates.holiday_name`) and, after its first year, falls where the shipped calendar
puts that name, or nowhere (see [public-holidays.md](public-holidays.md)). `saveSpecialDay` in the
same file is the writer behind the API; a configuration import inserts a bundle's rows directly
(below). In the dashboard, the special-day painter, opened from the Year, the Month or the Week, writes a special
day's name, dates, Every year and the paint of each department or zone and date it changed, in one
request (see [design-system.md](design-system.md), "Forms").

**2026-10-14, A506-11.** The refusing `DELETE …/menu-periods/:periodId`, `deleteMenuPeriod` and
`menu_period.in_use` are gone; `POST …/menu-periods/:periodId/delete` is the only delete.

(2026-10-24, A789 slice 2: period extensions are gone; this paragraph's sentences about a period's keep-open extension record the earlier rule.)
**2026-10-13, A506-10.** `POST …/menu-periods/:periodId/delete` deletes a period in use
(`deletePeriod`, `packages/venue-service/src/period-delete.ts`), taking the clock revision as the
other hours writes do. `GET …/menu-periods/painted-in` lists where each period is painted, and
`GET …/menu-periods/:periodId/delete-impact` counts what the delete dialog shows: while the
venue's clock can be read, neither counts a one-off special day with no date today or later, and
the impact says only whether the period has a keep-open extension today, though the delete changes
those special days' paint and every day's extension too. With a replacement, which must be another
period of the same department, every range painting the period, in season weeks
and on special-day dates past or future, names the replacement, and on each day that held the
period touching ranges of one period then join; and every keep-open extension of it names the
replacement, and where one of the replacement's
ranges that day covers the extension's start, the extension then starts at that range's end, or is
deleted when the range already reaches the extension's end. Without one,
its painted ranges are deleted, a special-day date left with no paint loses its `department_days`
row so the season shows through, and its extensions go with the period through their cascading
foreign key. Its routing-cell lines go with the period through their cascading foreign key whether
or not there is a replacement; none is moved to the replacement (owner, 2026-10-13, A578). It all
runs in the caller's transaction.
2026-10-14, A506-11: `GET …/menu-periods/painted-in?periodId=` lists that period alone, and a
malformed id is refused as `shared.invalid_id`.
2026-10-14, A506-11: the delete-impact answer also carries `clockRevision`, read in the same
transaction with `readBusinessDayScheduleRevision`, the reader the delete's own check uses; the
delete dialog sends it back as `expectedClockRevision`.

A configuration transfer carries both tables (`VENUE_SERVICE_CONFIGURATION_TRANSFER`). The import refuses, as `setup.request_invalid` naming
the field, a bundle the writer could not have stored: two special-day dates on one date; a
special-day day row with a season or a weekday; paint off the quarter-hour or overlapping; paint at a time the clocks skip, a repeating date checked at its
next occurrence from the venue's date of the bundle's `createdAt`; and a zone's Closed paint outside its department's hours on that date
(field `zone_day_ranges`), which the special-day routes refuse though `saveSpecialDay` alone would
store it. The cases are under "special days in a configuration bundle" in
`packages/venue-service/src/configuration-transfer.test.ts` and "special days in a configuration
transfer" in `apps/server/src/configuration-transfer.test.ts`.

### Earlier W98 menu timetable model

**2026-10-13, A506-5:** `special_dates`, `menu_day_timetables` and `menu_slots` are dropped. Since
A506-10 `POST …/menu-periods/:periodId/delete` deletes a period in use; see "Special days" above.

W98 keeps each department's menu timetable in four venue-service tables, all classified `state`
(`packages/db/src/schema/venue-service/menus.ts`): `menu_periods` (a named period such as
"Mañanas" and its menu), `menu_day_timetables` (one department's timetable for one special date),
`menu_slots` (a named period placed on that day, wall-clock times) and `zone_period_menus` (a
zone's own menu for one named period). They are not opening-hours rows: a menu period has its own
boundaries and a menu, and opening hours never stop a sale. What they share with Hours is the
calendar.

- A special date's menu timetable hangs off `special_dates` with a cascading key, so deleting the
  date deletes its timetables and slots. `duplicateSpecialDate`, `saveSpecialDate` and
  `deleteSpecialDate` (`packages/venue-service/src/hours.ts`) hand a date to a participant only
  when their caller passes one: the special-date routes in `packages/venue-service/src/routes.ts`
  (the PUT, the duplicate and the DELETE) pass `VENUE_SERVICE_CALENDAR_PARTICIPANTS`, whose one
  member is `MENU_TIMETABLE_CALENDAR_PARTICIPANT` (`packages/venue-service/src/menu-timetable.ts`),
  and nothing checks that a new caller does. Handed one, the participant copies a date's timetables
  to each target and refuses, with `menu_timetable.invalid` and a `reason`, a copy, move or delete
  that would leave a slot overlapping a neighbouring day's across a midnight (`overlap`), or a copied
  or moved slot opening or closing at a minute the clock skips there (`clock_skips`). A duplicate's
  copies are checked together, after every target exists.
- A special date with no `menu_day_timetables` row for a department follows that department's
  week. A row with no slots on a special date replaces the week with the all-day menu.
- A zone's override names a named period, not a slot, so it holds on every day and special date
  that places the period. Deleting a period is refused `menu_period.in_use` while any slot places
  it, past special dates included; once none does, its zones' overrides and the routing cells'
  choices for it (`routing_cell_periods`) cascade with it. The Periods tab's delete dialog lists
  those routing cells first (`routingWarning`, `packages/venue-service/src/dashboard/opening-hours-screen.ts`).
  (2026-10-14, A506-11: that refusal and the Periods tab are gone; see "Special days" above.)
- A whole-venue closure does not close menus: the clash checks build their date state with
  `closeWholeVenue: false` (`firstMenuClash`, `packages/venue-service/src/menu-timetable-rules.ts`)
  and the resolver never reads `special_dates.close_whole_venue`.
- A day's slots are replaced by deleting and inserting the whole set; nothing references a slot.
- Pricing (`readBasketOffers` in `apps/server/src/working-order.ts`, `offersFor` in
  `apps/server/src/order-drafts.ts`) passes `withDefault: false` to `listZoneOffers`, which then
  reads no timetable table. The case "price a basket's offers without reading the timetable at all"
  in `packages/venue-service/src/menu-timetable.test.ts` pins what `listZoneOffers` reads with that
  option, by statement text; nothing checks that the pricing callers pass it.

**Tables whose writes live only in named files**

## A write of a table `scripts/write-path-tables.json` lists lives only in the files it names

`venue.db`'s `tenants`, `nodes`, `deployment`, `settings`, `activity_log`, `invoice_corrections` and `invoice_correction_refunds`, and `node.db`'s `node_mode`, `node_mirror_link`,
`node_pair_link`, `node_primary_key`, `node_recovery_key`, `node_signing_key`, `node_handover_operations`,
`node_handover_events` and `node_handover_restriction`. NOTHING BUT
`scripts/write-path-tables.test.ts` REFUSES THEM.
SQLite has no roles and no grants, and every path, request and provisioning alike, shares the one
venue handle and the one node handle a process opens (`ownerDb` is a name, not a separate handle).
So the rule is a convention over source text, and that guard is not a second opinion on an engine
that would refuse the write anyway.

`settings` is written on request paths through its one writer,
`packages/db/src/settings.ts` (`saveSettings`). `activity_log` is written on request paths through
`packages/db/src/activity-log.ts` (`recordActivity`). `invoice_corrections` is written only in
`apps/server/src/invoice-corrections.ts`. `invoice_correction_refunds` is written only in
`apps/server/src/invoice-correction-legs.ts`, where `linkRefundToCorrection` links a refund to its
correction; `reserveTenderRefund` calls it.

The guard reads `scripts/write-path-tables.json` and pins its table set independently. It reads
TEXT, judges a FILE rather than a call chain, and walks `<member>/src` under `apps` and `packages`
alone. Read its header for the full limits. The [2026-10-19 grants-record audit](grants-retirement-audit.md)
records the removal of the old matrix and the restrictions still awaiting individual decisions.

Real code does write them, legitimately: the setup-mode provision route reaches `tenants`,
`nodes` and `deployment`; joining as a spare (`apps/server/src/adopt.ts`) reaches `deployment`,
`node_mode`, `node_mirror_link`, `node_pair_link`, `node_primary_key`, `node_recovery_key` and
`node_signing_key`, writing this box's rows and deleting any an abandoned earlier attempt left in
those six `node.db` tables under another node id; the main box's joining route
(`apps/server/src/mirror-bundle-api.ts`) reaches `node_pair_link`; promotion and its repair (`promote.ts`, `promoted-role.ts`) reach
`node_mode`; first setup and replacing the recovery key reach `node_recovery_key`; first setup and
`waitron-credentials rotate` reach `node_signing_key`; a handover (`apps/server/src/handover-store.ts`, and the server's files that call `appendHandoverEventTx` directly) reaches `node_handover_operations` and `node_handover_events`, and a stepdown (`apps/server/src/handover-stepdown.ts`) reaches `node_handover_restriction`; and the dashboard's legal-name change
(`PUT /management-api/venue-details/legal-name`, owner A494) reaches `tenants` through
`packages/provisioning/src/taxpayer-name.ts`, which updates `legal_name` alone, and the
dashboard's privacy contact (`PUT /management-api/venue-privacy`, A980 S1a) reaches it through
`packages/provisioning/src/privacy-contact.ts`, which updates `privacy_notice_url` and
`privacy_email` alone; a configuration import reaches the same writer for those two columns
(A980 S1a2). Each does it by calling into one of the
files `scripts/write-path-tables.json` names, which is where such a write is allowed to live.
Keeping them in a handful of named files is the whole of the property now, because no connection
makes the distinction for us any more.

`waitron-credentials rotate` re-seals nothing while `node.db` holds a pair link under any node id:
it refuses with `credentials.rotation_spare_joined`, because the spare holds the same key ring and
nothing sends it a new one (decision D7 in
[the 3b plan](../superpowers/plans/2026-11-04-a947-3b-spare-hosts-store.md)). Removing the spare on
Servers deletes the link, and rotation then runs; a spare that finished joining is removed only
after an administrator declares it switched off and no other recovery in progress (A1321). On the spare,
whose own link names its main box, `rotate` refuses too. A ring changed by hand in `secrets.env` is
not stopped by this.

**What the guard does not see.** `scripts/write-path-tables.test.ts` reads TEXT, so a table name
reached through a variable is invisible to it; it judges a FILE against an allowance list rather
than a call chain, so a request path that calls into an allowed file writes through it unseen; and
it walks `<member>/src` under `apps` and `packages` alone, so a package's `test/` directory and
`apps/<app>/scripts` are outside it.

## A money column holds a count of whole cents, and the conversion happens at the row

Landed 2026-09-20 as task P5 of the SQLite storage swap (#475). EVERY column declared through
`money()` stopped being `numeric(12, 2)` and became an integer counting cents: the storage engine
the vocabulary exists to switch to has no exact decimal type, and a float cannot hold a cent
exactly. The property is the rule, not a number — the set grows, and a number written here would be
wrong the next time a table lands. To see today's set:
`grep -rn '\bmoney(' packages apps --include='*.ts' | grep -v '\.test\.ts'` — read the lines rather
than counting them. The pattern matches any line naming the helper, so a COMMENT that mentions
`money()` is a hit like a declaration, and the next comment to mention it will be another one:
check each line is a column. The one prose hit on 2026-09-22 is
`packages/db/src/schema/daily-closes.ts`.

**Where the boundary is, and why it is there.** The database is the edge and only the database.
A read turns the stored count into the exact `Decimal` that `packages/shared/src/money.ts`
already works in; a write turns it back; both happen at the row. Above that line nothing moved —
the arithmetic, the HTTP contract both single-page apps consume, the receipt strings and the
literals a fiscal record hashes. The alternative, cents as the in-memory type through core,
catalogue, payments, reporting and `apps/server`, reaches the same storage with a far larger
change and a live risk of rounding drift in the arithmetic the hash chain depends on.

The converters live alone in `packages/shared/src/cents.ts` (which also uses
`packages/shared/src/scales.ts`'s `scaledCount` for the rounding and the bound, its literal renderer
and its raw pattern) rather than beside the arithmetic.
`money.ts` is read as TEXT by `packages/shared/src/conventions.test.ts` and fails on any
float-shaped operation in it, including the number constructor; keeping that check that strict is
worth more than one module. `cents.ts` has its own version of the check, which allows the number
conversion it exists for and forbids the rest.

**There is no column width left to measure, and that is the change.** SQLite's INTEGER is 64-bit
whatever the declared type says (`packages/db/src/schema/columns.ts` states it at
`smallCount`/`bigCount`), so nothing below the converters bounds a money value at all. The bound the
system states is twelve integer digits — 99999999999999 cents, `MAX_MONEY_INTEGER_DIGITS`, enforced
by `decimalToCents` on the amount after rounding it to cents, and by `packages/catalogue`'s price
validators — and it is now the only thing
enforcing anything. That figure is well inside the 9007199254740991 a JavaScript number counts
exactly, so nothing in range loses a cent to the number type.

Drizzle's typed `.select()` needs no cast at all: the column maps the value, and the read mapping is
now the ONLY thing separating helpers that emit the same SQL type — `money`, `quantity`, `count` and
`flag` are all `integer`. The pin is `gives flag a boolean where every other integer helper gives a
number` in `packages/db/src/schema/columns.test.ts`, which is the one case that can tell them apart
at all; nothing distinguishes `money` from `quantity` there, because nothing in the column does.
Those call sites hand the number straight to `centsToDecimal`.

**Raw SQL is not safe, and a raw read that produces an AMOUNT casts to text.** A raw money read — a
`tx.execute`, or a `sql` fragment inside a select list, both untyped at each end — whose value becomes
an amount wraps the expression in `cast(<expr> as text)` and passes the string to `rawCentsToDecimal`
(`packages/shared/src/cents.ts`), which checks the shape, refuses anything past a safe integer with
`shared.invalid_cents`, and returns the exact `Decimal`. Product source obeys it —
`packages/reporting/src/cash-up.ts`, `top-sellers.ts`, `input-vat.ts` and
`packages/core/src/list-outstanding-sales.ts` among them. This engine has no `::` cast operator at
all. Measured 2026-09-22 on Node v26.7.0, `select count(*)::int` is
`unrecognized token: ":"`, errcode 1.

**A test asserting the stored COUNT is not reading an amount, and several cast to int.** The shape is
`select cast(unit_price_gross as int) as unit_price_gross` followed by
`expect(...).toEqual([{ unit_price_gross: 325 }])` (`apps/server/src/working-order.test.ts`);
`till-api.test.ts` carries the same shape. Nothing converts, so there
is no amount to get wrong, and the cast is there only to give the assertion a number.

**That cast refuses nothing.** `cast(x as int)` on SQLite raises nothing at all: the declared type
carries no width. What keeps these assertions safe is only that their literals are
small, and `apps/server/src/till-api.test.ts` says so at its own call site. A test that converts an
amount is a different thing and casts to text like production:
`apps/server/scripts/demo-seed/seed-sales.test.ts` is the live example.

**What the compiler could not see.** Three classes, each found by hand and each worth re-checking
whenever a money column is added:

- The hundredfold hazard, which is real on any engine: a raw read that renders a money count as a
  DECIMAL rather than as a count hands back a plausible string a hundred times too LARGE — a stored
  7734 cents is €77.34 and renders as `"7734.00"`, which a consumer reads as €7734.00. The direction
  is worth getting right: too large is a bill a hundred times the price, not a rounding slip. What
  to watch for is any raw read handing a count to a consumer expecting an amount. That sentence is
  written once, in `rawCentsToDecimal`'s doc comment (`packages/shared/src/cents.ts`), so
  `grep -rn "hundred times" packages apps --include='*.ts' | grep -v '\.test\.ts'` returns that one
  line.
- Raw-SQL inserts: **nothing is refused, in any form.** Measured 2026-09-22 on `node:sqlite`, Node
  v26.7.0, against a plain `integer` column, by bound parameter and by raw SQL alike — `25.00` and
  `"25.00"` each store the integer 25, `"21.50"` stores the REAL 21.5, and `"abc"` stores the text
  `abc`. Not one of the four raised anything. A bare whole number succeeds and means cents. One
  instance was found and corrected while money was moving to cents: a fixture inserting
  `('cash_only', 50)` into `payment_policy` had meant an offline cap of fifty euros and silently
  became fifty cents. It read `('cash_only', 5000)` until A1308 slice 4b deleted `payment_policy` and that insert
  (`apps/server/src/configuration-transfer.test.ts`, 2026-11). Whether that was
  the only one in the tree is not established; what was run was a hand sweep, not a check anything
  re-runs.
- Money held as strings inside a JSON document — `sales.vat_breakdown` and the hashed
  `daily_closes.snapshot`. Both are above the line and stay decimal strings, so a reader applying the
  cents rule to them would break working code. **The grouping and the summing moved out of SQL
  altogether**, because this engine has no exact decimal type and summing filed cuotas in SQL would
  sum them as binary floating point. `packages/reporting/src/vat-summary.ts` reads one row per
  breakdown ELEMENT and folds them with `@waitron/shared`'s Decimal arithmetic at the money scale,
  which is exact by construction; the comparison it was checked by and the controls that break it
  are recorded in #601's commit message (`git log --grep='(#601)'`), not in the file.

  What that costs belongs in this list, and the file states it: nothing in that path bounds an
  element's width, so an out-of-range filed amount is summed rather than refused.
  `packages/fiscal-verifactu/src/monetary-columns.test.ts` states the twelve-TOTAL-digits against
  twelve-INTEGER-digits split in its own comment but does not hold it down: it neither imports
  `decimalToCents` nor reads `MAX_MONEY_INTEGER_DIGITS`, and what it would catch is those two fiscal
  columns ceasing to be `text`. The bound on the write path is pinned in
  `packages/shared/src/cents.test.ts` (`decimalToCents`, after rounding).

**Every document written before 2026-09-20 that states a money column as `numeric(12, 2)`
describes the old storage.** There are dozens, nearly all dated plans and specs recording what was
true when written; they were not rewritten.

The documents corrected in place are named here rather than described as a class, because the
class was not swept: this file and `CLAUDE.md` §3, which carry the rule.

**The converters, by name.** `packages/shared/src/cents.ts` has `decimalToCents` in
(`stringToCents` when the value is still a decimal string), `centsToDecimal` out, and
`rawCentsToDecimal` for a raw-SQL read of an AMOUNT, which casts the expression `cast(x as text)` —
this engine has no `::` operator, and an uncast integer arrives as a JavaScript number, which that
reader refuses.

**Guards, both narrower than their names:** `packages/db/src/schema/columns.test.ts` (`money` and
`bigCount` emit the SAME SQL type, so only its read-mode case separates them) and
`packages/shared/src/conventions.test.ts` (reads `cents.ts` as TEXT, and nothing outside
`packages/shared/src`, so a second file crossing into the number type is seen by nobody).

## A sale's correctives are summed through `correctivesOf`

A corrective by replacement repeats its original's full total, and the original carries the sale:
its payments and settlement stay on it, and a later refund corrects the replacement (Q37-FIX plan,
`docs/superpowers/plans/2026-11-13-q37-fix-put-right.md`, "How the sale is counted once"). So what
a sale owes is its total plus its own correctives except the replacement, plus the replacement's
correctives. `correctivesOf(corrective, saleId)` in `packages/db/src/correctives-of.ts` is that
set, as a condition on the caller's own `sales` row named `corrective`. Money readers and "has it been credited" tests use it. The lines the guard below
allows instead, each with its reason there: the correction target's own sums and history in
`packages/core/src/record-correction.ts` and `correction-history.ts`, the order list's number
search, the lines that find a replacement itself, the first-corrective check in
`record-replacement.ts`, and top-sellers' line netting.

`scripts/corrective-sums.test.ts` holds the rule, and is weaker than its name. It reads non-test
`.ts` files under `apps/*/src` and `packages/*/src`, leaving out `testing/` folders, one LINE at a
time, and flags an SQL equality on `corrects_sale_id` and a Drizzle `eq(` or `inArray(` whose
first argument is a `correctsSaleId` column. Everything else passes it: a comparison split across
lines, a column reached through an alias the pattern does not spell, a helper it does not
recognise, and SQL outside those folders. The `sale_settlements_check_coverage` trigger in
`packages/db/triggers/core.sql` is such SQL: it spells the same rule out by hand, and
`scripts/behavioural-triggers.test.ts` tests it with a refunded replacement. Each allowlist entry carries its reason and the number of lines it matches; any other number
fails the guard.

## A quantity counts whole thousandths and a rate whole basis points, and neither is the money scale

Task P6, 2026-09-21. Seven columns followed money out of `numeric`: two quantities
(`working_order_lines.quantity`, `sale_lines.quantity`) and five rates (`vat_rate` twice,
`purchase_invoices.deductible_proportion`, `purchase_invoice_vat.rate`,
`convenio_config.night_premium_pct`). _2026-09-27 (A68): `working_order_lines.vat_rate` was
replaced by `vat_class`._

**Why they are not cents.** A quantity carries three decimal places and the money scale holds two,
so one conversion cannot serve both. Five grams — `0.005` kg — is the count 5 at the quantity scale
and the count 1 at the money scale, because `decimalToCents` ROUNDS that third place half away from
zero rather than dropping it: `decimalToCents(decimal("0.005"))` returns 1, measured 2026-09-21. An
earlier draft of this paragraph said it returned 0, which is why the measurement is written down —
the shared conversion nobody wrote would not have refused anything or emptied the line, it would
have returned a number five times too small. That is the whole reason the scales
are separate, and it is the second case in `packages/shared/src/scales.test.ts`; the
`the two scales do not share a conversion` case reads
one literal, `"21.00"`, in both scales and gets 21000 and 2100, so a caller reaching for the wrong
converter by autocomplete gets an answer that is wrong by a factor of ten rather than one that
looks plausible.

**Where the conversions live, and why not where the plan put them.** The plan said
`packages/db/src/schema/columns.ts`. They are `packages/shared/src/scales.ts`, beside
`packages/shared/src/cents.ts`, because that is where the money crossing went and where a reader
greps. `columns.ts` is the engine vocabulary; a conversion in it would be the second thing the
SQLite switch has to think about in the one file that exists so it only has to think about one.
The names follow `cents.ts`'s pair, not the plan's shorter ones, for the same reason.

**The bodies could not be written the way the plan sketched them.** `Number(value) * 1000`,
`Math.round` and `.toFixed(3)` are all float operations, and
`packages/shared/src/conventions.test.ts` reads this family of files as text and fails on every one
of them. The rounding is `toScale`'s, in BigInt, half away from zero — which is also the rule the
decimal columns applied on the way in, so the conversion is exact rather than close. The guard was
extended to `scales.ts` and proved by deletion: a `Math.round` added to the file turns
`contains no Math.round` red.

**The bound is the converter's.** An integer column takes any width silently, so
`MAX_QUANTITY_INTEGER_DIGITS` (nine) and `MAX_RATE_INTEGER_DIGITS` (three) are where a too-wide
quantity or rate is refused. The raw RATE reader carries the same bound; the raw QUANTITY reader,
`rawThousandthsToDecimal`, does not (owner decision 2026-09-24). Its caller, `top-sellers.ts`, reads
sums, which can be wider than any one quantity, so its only width limit is what a JavaScript number
holds exactly, refused with `shared.invalid_thousandths` (like `rawCentsToDecimal`).

**A rate's CHECK constraint is written against 10000, not 100.** One written as `rate <= 100`
refuses every rate above one percent, because a rate column counts basis points
(`packages/db/src/schema/columns.ts` says so at the `rate` builder). A QUANTITY check such as
`quantity <> 0` reads the same in either scale. What compares the checks a set's migrations build
with the schema's is the shared schema-conformance suite,
`packages/db/src/testing/schema-conformance.ts`, a suite factory that any migration set can call.
Which sets have a call site is `ls packages/*/src/schema/schema-conformance.test.ts`; a set with
none is unguarded.

**Three ways a raw-SQL site can be wrong, and none of them is loud.** The readings are in the money
rule's raw-insert bullet above, taken 2026-09-22 on `node:sqlite`, Node v26.7.0.

1. A QUOTED literal with a fractional part: `"21.50"` into an `integer` column is stored as the REAL
   21.5.
2. An UNQUOTED numeric literal: `25.00` into an `integer` column stores 25 — a hundredfold wrong,
   nothing red. Found in `packages/workforce-es/src/convenio.test.ts`, where the test PASSED before
   the conversion because the reader was unconverted too and the two errors cancelled. CLAUDE.md
   §1's "a measurement taken where both answers look alike", with a green suite attached.
3. A value whose text is already a whole number is accepted silently in either form and means a
   thousandth of what the author meant: a quantity sent as `'2'` stores 2, which is 0.002 units.
   Seen in `packages/core`'s pre-fix failure dump.

**A column-level codec was weighed and not taken.** Drizzle's `customType` with `toDriver`/`fromDriver`
would put each crossing in `columns.ts` once and leave every typed `.select()` and `.values()` call
site handling decimal strings unchanged — roughly twenty-five hand-written conversions that would not
exist. It was not taken, for the reason *Where the conversions live, and why not where the plan put them*
gives above: `columns.ts` is the
one file the SQLite switch has to think about, and a conversion living in it is a second thing to
think about there. The helpers would still be `scales.ts`; only the crossing would move. The raw-SQL
readers would be needed either way. Recorded here rather than left as a silent default, because the
cost is now paid twice (money and these two scales) and a third scale would pay it again.

So a green run is not evidence that every raw-SQL site was found. They were found by grep, and the
sites that stayed green got more attention than the ones that went red.

**What the byte-identical fiscal gate does and does not establish.**
`packages/fiscal-verifactu/src/money-conversion.huella.test.ts` passed against the same literals,
which is the gate this task was required to clear. Read it narrowly: the breakdown a sale files is
built by `buildVatBreakdown` from the sale's own `RecordSaleLine.vatRate`, a domain value, and
never from a stored row — traced through `record-sale.ts`, `record-correction.ts` and
`record-substitution.ts`, each of which calls it on `input.lines`. So on the converted tree the
rate reaching the fiscal record does not cross the storage boundary at all. The gate would have
caught a conversion placed ABOVE the row; it cannot see one placed below it.

_2026-09-30 (A144):_ `recordCorrection` now passes `buildVatBreakdown` the lines with each
`lineTotal` rounded to the cent; the rate is still the input's.

_2026-10-01 (A158):_ that rounding moved into `buildVatBreakdown` itself, so a sale and a
substitution take each `lineTotal` at the cent too. The three files now reach it through
`deriveVatBreakdown`, which refuses with `sale.total_mismatch` when a line total is past the cent
and the breakdown, built from the lines at the cent, does not sum to the total at the cent. A breakdown a caller supplies to `recordSale` does not go
through `buildVatBreakdown`: it has its base and tax each rounded to the cent, and is refused with
`sale.total_mismatch` if the rounded amounts no longer add up to the total.

_2026-10-02 (C126):_ a correction that credits the whole invoice (`wholeInvoice`) does not reach
`deriveVatBreakdown`: it files the invoice's stored breakdown negated
(`packages/core/src/record-correction.ts`). So for a whole-invoice credit the rates and amounts
reaching the fiscal record DO cross the storage boundary, read back from the original's
`sales.vat_breakdown`, and the "does not cross the storage boundary at all" above holds only for
a breakdown built from lines or supplied by a caller. The huella gate above records sales from
literals and does not file a whole-invoice credit, so it says nothing about that path.

_2026-11-09 (A802 slice 2):_ a partial correction may supply its breakdown (`partialVatBreakdown`).
It is not rounded: it is refused with `sale.correction_breakdown_invalid` unless every amount is at
the cent and agrees with its own total and lines, the invoice and the corrections already recorded
against it, and with `sale.correction_history_unusable` when what is stored about the invoice or
those corrections cannot be checked.

**A guard got quietly weaker and had to be shored up.** With `quantity` and `rate` converted, the
vocabulary stopped importing `numeric` at all — and `scripts/column-vocabulary.test.ts` DERIVES its
forbidden set from the vocabulary's own import block, so `numeric` would have become legal in every
table file on the same day it stopped being used in any. The guard now carries a hand-written
`RETIRED` set beside the derived one, holding `numeric`. That list GROWS as builders retire, where
the `ALLOWED` list only shrinks. It still cannot cover a builder the vocabulary never imported —
`bigserial` is the standing example.

_2026-10-07: that paragraph describes the PostgreSQL-era guard. The move to SQLite (#489) emptied
`RETIRED` in `scripts/column-vocabulary.test.ts`; the current guard is described under "`columns.ts`
is the only file that names the engine's column and table types" above._

**What the conversion did NOT touch.** The pricer, `assertQuantityPrecision`, the purchasing
validators, every receipt and ticket formatter, the HTTP contract, `apps/till` and `apps/dashboard`.
All of them work in decimal strings and all of them still do.

`packages/shared/src/scales.ts` sits beside `cents.ts`, with the same two raw-SQL readers and the
same cast-to-text rule. The money rule's two guards and both its hedges apply unchanged, and
`quantity`, `money` and `bigCount` are all `integer(name)`, so only the caller separates them.

### The database never rounds a quantity — the converter owns the third place

`packages/catalogue`'s precision guard — the `rejects excess precision before anything downstream
can round it` case in `packages/catalogue/src/units.operations.test.ts` — holds no SQL rounding
probe beside the converter, because this engine has no exact decimal type to compare it with. Run
on 2026-09-22:

```
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); const q = (s) => JSON.stringify(db.prepare('select ' + s + ' as v').get().v); console.log(q('round(1.2345, 3)'), q('cast(1.2345 as numeric(12,3))'), q(\"printf('%.3f', 1.2345)\"), q('round(1.2355, 3)'));"
```

On Node v26.7.0 that prints `1.234 1.2345 "1.234" 1.236`. So `round` takes the tie DOWN; a cast's
declared scale is ignored entirely, because SQLite's `numeric(12,3)` is a type name carrying NUMERIC
affinity and no scale; and the fourth reading is the control in the other direction —
`round(1.2355, 3)` going up says this is binary float representation rather than "SQLite always
rounds down".

Nor would such a probe test anything real: a quantity column holds a whole count of thousandths and
`decimalToThousandths` has already decided the third place before any value reaches storage, so a
test asking SQL to round a quantity asks about something no product path does. The converter's own
rounding is pinned by the `rounds a fourth decimal place half away from zero` case in
`packages/shared/src/scales.test.ts`. The precision guard's own subject is its two assertions:
`stringToThousandths("1.2345")` is `1235`, and `assertQuantityPrecision` throws `quantity.invalid`.

## A time stored as text and compared or sorted as text needs one spelling across its writers

`ts`, `tsString`, `timeOfDay` and `day` (`packages/db/src/schema/columns.ts`) all emit `text`, and
the engine orders text by its characters. JavaScript's own string comparison, run on 2026-10-03
(Node v26.7.0):

```
node -e 'console.log("10:00:00Z"<"10:00:00.500Z", "2026-10-03T09:00:00+02:00"<"2026-10-03T07:30:00Z", "07:00">="6:00")'
```

It prints `false false false`, and each of the three is wrong as time: a whole second written
without milliseconds sorts after the same second with them (`Z` follows `.`), an offset spelling
sorts by its local digits, and an unpadded hour sorts after a padded one.

The database's own comparison, measured on 2026-10-03 on `node:sqlite` (Node v26.7.0):

```
node -e 'const{DatabaseSync}=require("node:sqlite");console.log(Object.values(new DatabaseSync(":memory:").prepare("select ? < ? a, ? < ? b, ? >= ? c, ? <> ? d").get("10:00:00Z","10:00:00.500Z","2026-10-03T09:00:00+02:00","2026-10-03T07:30:00Z","07:00","6:00","12:00","12:00:00")).join(" "))'
```

It prints `0 0 0 1`: the database answers the first three the same wrong way as JavaScript, and the
fourth says `12:00` and `12:00:00` are different values. The control: the same `select ? < ?` with
the first pair reversed (`"10:00:00.500Z","10:00:00Z"`) prints `1`.

**The instance (W22, #1134).** `addShift` and the shift update stored `starts_at` and `ends_at` as
the caller sent them. `shifts_interval_ck` (`packages/workforce/src/schema/shifts.ts`) and the
roster's ordering compare that text, so two valid times spelled differently were refused with a raw
CHECK error instead of `shift.invalid`, or listed in the wrong order. The fix stores both ends as
the UTC whole second through `shiftInterval` (`packages/workforce/src/clocking.ts`), and its review
found the next problem before it landed: a shift written at `+02:00` would have read back at its
UTC hour, because the roster and the shift dialog read the hour straight off the text. They now work it out from the
stored offset (`wallClock` and `instantAt`, `apps/dashboard/src/date-utils.ts`).

**Update, 2026-10-11 (A484).** Roster and dialog rendering still use the stored wall offset.
The dialog now resolves each saved endpoint in the selected location's time zone with
`localTimeOccurrences` (`packages/venue-service/src/hours-occurrences.ts`), using the next civil
day when the end is at or before the start. The overnight storage case in
`apps/server/src/workforce-api.test.ts` reads back distinct offsets across the spring clock change.

**Update, 2026-10-15 (A585 part 8).** The core roster screen and its shift dialog are retired.
The references above describe those historical screens; Calendar → Rota and staffing's shift
editor replace them. The storage convention and overnight route case remain.

**The siblings, swept 2026-10-03 at `575aff691`.** Every `ts`, `tsString` and `timeOfDay` column
was listed with `grep -rn --include='*.ts' -E '\b(ts|tsString|timeOfDay)\("' packages apps`, then
each column's name was searched across `packages/` and `apps/` for a text comparison (drizzle's
`lt`/`gt`/`lte`/`gte`/`asc`/`desc`/`min`/`max`, raw SQL, a CHECK in a migration, and JavaScript `<`,
`>`, `localeCompare` and `.sort`) and for its writers. That was a reading sweep, not a run, and
`day` columns were not part of it.

- **One spelling on every product writer.** Apart from `shifts`, whose `shiftInterval`
  (`packages/workforce/src/clocking.ts`) stores the UTC whole second without milliseconds, every
  other instant column found compared or sorted as text is written through `nowIso()`, a `Date`'s
  `toISOString()` or the `ts` mapping, which is also `toISOString()` — one spelling per column
  either way. `time_entries` and `order_amendments` pin it in the database as well:
  `time_entries_event_at_second_ck` and
  `time_entries_recorded_at_second_ck` (`packages/workforce/drizzle/0000_baseline.sql`) and
  `order_amendments_event_at_second_ck` (`packages/db/drizzle/0000_baseline.sql`), each a `glob`
  for the whole-second `.000Z` spelling. The paging cursors that are compared with `created_at` or
  `issued_at` are checked against the millisecond spelling before use (the `CURSOR` pattern in
  `apps/server/src/orders-api.ts` and in `packages/adjustments/src/routes.ts`).
**2026-10-10, A366 slice 4 Part B:** the station period tables and their `storedTime` writer
in the sweep below are retired. The booking writer remains; the account below records the
2026-10-03 sweep.

- **Times of day normalised by a helper.** `bookings.booking_time` and the opening periods'
  `opens_at` and `closes_at` (`hours_week_periods`, `special_date_hours_periods`) go through a
  `storedTime` helper (`packages/bookings/src/bookings.ts`,
  `packages/venue-service/src/operations.ts`) that pads `HH:MM` to `HH:MM:SS`, behind a check that
  allows `HH:MM` (for a booking, the route's pattern, which also allows `HH:MM:SS`; for an opening
  period, `CLOCK_TIME` in `packages/venue-service/src/hours-rules.ts`). The interval tables
  `station_hours` and `department_hours` this line named until 2026-10-06 are dropped by
  venue-service `0022_retire_legacy_hours`.
- **`day_cutover_changes`** keeps the initial business-day start in its earliest row, dated
  `FIRST_DAY_START` (`2000-01-01`), and later dated starts in the rows after it. Provisioning writes
  the first row with `normalizeDayCutover`. `readVenueClock` (`packages/db/src/venue.ts`) returns
  the same clock shape, and the shared resolver selects each date's boundary. The general venue-details PATCH refuses a changed start. Since 2026-10-18 (A788)
  a new start is not scheduled for a chosen date: `writeBusinessDayStart`
  (`apps/server/src/business-day-start.ts`) takes it from the next changeover, or from the one
  after when the new time has already passed today (`planBusinessDayStart`,
  `apps/server/src/business-day-changeover.ts`; the cases under "a Save takes the next changeover"
  and "the preview chooses the changeover itself" in
  `apps/server/src/business-day-start.test.ts`). The PUT still carries the date its preview showed,
  and one that no longer matches is refused `venue.business_day_invalid`, reason
  `changeover_passed` ("replaces a waiting change up to its changeover, and after it the next Save
  takes the following one"). A waiting change that already ends today stays and the new one follows
  it; any other waiting change is removed, and saving the start in force removes it (cases (a)–(d)
  under "while tonight's 21:00 waits and the 05:00 changeover has passed", and "Example 5: 05:00
  undoes tonight's 03:00"). There is no cancel route ("answers a removed cancel route as it answers
  any unknown route, writing nothing"). The writer stores `HH:MM:00` and checks the revision,
  retained history and authored schedules inside the write transaction. Unrelated venue edits
  preserve the baseline spelling.
- **Hours writes and the business-day start (A788, 2026-10-18).** A write that changes opening
  hours checks its weekly ranges against the start in force (the cases under "undated hours are
  checked against the start in force" in `packages/venue-service/src/business-day-schedule.test.ts`)
  and a one-off date's against that date's own start ("accepts a one-off menu day under its own
  07:00 start"), then, after
  writing, against each start change still waiting, and refuses `hours.clock_change_conflict` (409)
  on a clash, with the waiting `dayCutover`, its `startsAt`, the venue's `timeZone` and the clashing
  ranges (`assertWaitingChangeFits`; the cases under "a waiting change checks the hours written
  while it waits"). It checks the venue's hours as written, so a clash in another department refuses
  an unrelated write ("refuses a clean season week while another department holds a clash, naming
  that department"). A period rename is not checked ("accepts a period rename beside a stored range
  that clashes with the waiting start"), but a special day's save is checked even when it changes
  only the name (`saveSpecialDay`, `packages/venue-service/src/special-days.ts`). The Calendar cuts a weekly range at a past
  day's own changeover when the range misfits that day's start but fits the start in force
  (`cutToOwnDay`, `packages/venue-service/src/calendar-cut.ts`; "a past day's range that misfits its
  own start" in `opening-hours-calendar.test.ts`). The editor shows an
  unreadable clock but provides no repair path. The request cases are in
  `apps/server/src/business-day-start.test.ts`; historical reports and frozen close/fiscal rows
  are compared in `apps/server/src/business-day-history.test.ts`.
- **Writers that skip the helpers.** The configuration import (`importConfigurationTables`,
  `packages/provisioning/src/configuration-transfer.ts`) copies the time values in a bundle's rows
  as written, without the normalising helpers. Several `created_at` columns that are ordered travel
  in a bundle this way. A bundle a Waitron venue exported carries that venue's spellings, so it
  takes a hand-edited bundle to store another. The opening periods are the exception:
  venue-service's transfer `validate` refuses a period whose `opens_at` or `closes_at` is not
  spelled `HH:MM:00` (`STORED_TIME` in `packages/venue-service/src/configuration-transfer.ts`)
  before the import writes anything.

Nothing guards the one-spelling rule across these columns. A new text time column, or a new writer
of an old one, is seen by nothing unless its table carries a CHECK like the ones above.

## A new table is classified `ledger`, `state` or `local` (swap design §2.1) in the `<MODULE>_CLASSIFICATION` list of the package holding its migration set (`CORE_CLASSIFICATION` in `packages/db/src/classification.ts` for core's) via `classify()` (`@waitron/sync-enrolment`), and a table that must never be corrected is declared with `appendOnly()` instead

The enforcement is no longer written into each migration by hand: `installAppendOnlyTriggers`
(`packages/store/src/append-only.ts`) puts a `RAISE(ABORT)` trigger pair on each named table, and
`applyMigrations` (`packages/migrations/src/apply.ts`) calls it after each set migrates, so boot
(`apps/server/src/boot.ts`), the cold restore (`apps/server/src/restore.ts`) and `rejoin-command`
all install them. `waitron-provision venue` is not one of them: it migrates nothing — no non-test
file under `packages/provisioning/src` calls `applyMigrations` at all (the one caller left there is
`schema-ahead.migrate.test.ts`, which migrates its own fixture). The two dev scripts,
`apps/server/scripts/dev-setup.ts` and `apps/server/scripts/dev-onboard.ts`, are converted: each
calls `applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null))`, so each installs the
triggers the way everything else does. The retired fake-backend demos now run as ordinary server
integration tests in `catalogue-allergen-workflow.test.ts` and `reporting-write-workflows.test.ts`;
`useVenueDb` applies their migration sets.

**2026-09-22: the names do NOT come from the `ledger` class, and for one step group they were
going to.** The first design said "every table the modules classify `ledger`", and the guard that
stood here asserted exactly that — against a database it migrated and then installed the triggers
on itself, so it proved the installer and never the product. Nothing in the product called the
installer at all, which is why the mismatch stayed invisible. Measured when the wiring went in: with
the trigger set taken from the class, nine tables came back refusing an update and a delete that
ordinary product code performs — `payments` (nine call sites in `packages/payments/src/store.ts`,
a card payment's row moving through its states), `cadenas` and `registro_sif`
(`packages/fiscal-verifactu`), `ticket_items` (`apps/server/src/working-order.ts`),
`daily_close_chain`, `purchase_invoices`, `purchase_invoice_vat`, `workforce_chains` and `envios` —
and `order_amendments`, which must refuse both, came back with no trigger at all, because it is
classified `state`. The class is wrong in both directions.

So the declaration is its own marker: `appendOnly(table, class, reason)` beside `classify()` in
`@waitron/sync-enrolment`, read by `orderedMigrationSets` off the descriptor's `classification` seat
and carried to `applyMigrations` through `MigrationSet.appendOnlyTables`. The cost of the
class-derived version was never paid in production because the installer was never
wired; it would have been paid by the first card capture after the flip.

Three things about the replacement that a reader should not have to re-derive:

- **`PRAGMA recursive_triggers` is not optional.** SQLite's default is off, and with it off the
  delete that `INSERT OR REPLACE` performs internally does not fire a `BEFORE DELETE` trigger, so
  that one statement rewrites a ledger row and nothing is raised. Plain `UPDATE`, plain `DELETE` and
  `INSERT … ON CONFLICT DO UPDATE` are refused either way — which is the trap, because a suite that
  omits the replace case passes while the hole is open. Measured 2026-09-21 on Node v26.7.0 by
  turning the pragma off in `packages/store/src/append-only.test.ts` and re-running: exactly one
  case of nine went red, the replace one. The store sets the pragma in `openConnection`
  (`packages/store/src/index.ts`), beside `foreign_keys`.
- **`DROP TABLE` is not refusable.** SQLite has no trigger event for it, and no `TRUNCATE` statement
  at all. A caller that can issue DDL can drop a ledger table.
- **A row trigger needs a row.** SQLite's only trigger granularity is `FOR EACH ROW`, so an `UPDATE`
  or `DELETE` against an EMPTY ledger table succeeds and changes nothing whether the triggers exist
  or not. Any test of this has to seed a row first; the root guard does, and states it.

**A start refuses to trade when an append-only trigger is still missing, or is changed, after
migrating; and a check every 10 seconds while trading stops the server on either**
(`apps/server/src/append-only-watch.ts`, A483). The engine still lets any connection drop or replace
a trigger, and installing again does not undo a replacement: the installer writes `create trigger if
not exists`, so a trigger dropped and re-created under the same name with a permissive body stays.
So the check compares each expected trigger's stored text in `sqlite_master` with the text
`installAppendOnlyTriggers` writes (both built by `appendOnlyTriggers`,
`packages/store/src/append-only.ts`). Measured 2026-10-11 on `node:sqlite`, Node v26.7.0, SQLite
3.53.4: the stored text is the statement sent with everything up to the trigger's name rewritten to
`CREATE TRIGGER `, and the rest kept byte for byte; after a same-name replacement, running the
installer again left the permissive body in place; and trigger names ignore case, so with an
upper-case same-name replacement in place a lookup by the exact lower-case name found nothing while
the installer ran without error and left the replacement there. The check therefore matches names
without case, and reads such a replacement as changed. A start runs the check after
`applyMigrations`, which puts back a trigger that was only dropped, so the start goes on and records
it as the dashboard warning `append_only.triggers_restored` (`missingBeforeMigration` reads which
were missing before migrating); a changed one is refused. That warning also appears after a crash
between a set's migration and its trigger install, and can appear at a box's first start on a
release that marks an EXISTING table `appendOnly()`. **Such a release says so in its PR
description**, so the warning is expected. While trading, a fault stops the server, and the next
start serves the recovery page at once, with no count of failed starts (`refusedWhileRunning`,
`apps/server/src/recovery-state.ts`). The check does not see:

- a trigger dropped, rows changed and the exact text re-created within one 10-second interval, or
  the same done while the box is off;
- retained tables of an unselected provision-only module, such as `registros_facturacion` and
  the filing-case tables on a box later moved to `fiscal-none`;
- `PRAGMA recursive_triggers` turned off, which reopens the `INSERT OR REPLACE` hole above without
  touching a trigger;
- anything but the stored text: it reads `sqlite_master.sql` and nothing else;
- a trigger put back by a restore (`waitron-restore`, a staged restore, or a rebuild from the
  bucket, each through `placeValidated`, `apps/server/src/restore.ts`) or by `waitron-rejoin`
  (`apps/server/src/rejoin-command.ts`): each migrates before any start can look, so none raises
  the warning.

**2026-11-14, A646:** startup also selects existing tables from toggleable modules' append-only
classifications. It records missing trigger names before migrating, installs missing pairs on those
retained tables, and includes them in the startup check and trading watch. It does not migrate an
Off module or create its absent tables. `boot.failed-start.test.ts` checks all three retained
Payments tables with populated rows, the warning, changed-trigger refusal and unchanged entries in an already-current journal;
that last assertion does not establish whether the set was passed to the migrator.
`boot.restore.test.ts` checks a dropped Payments-Off trigger during trading, and
`boot.payments-off-alerts.test.ts` checks a never-installed Payments set stays absent.
The contained upgrade data check uses the same retained selection, installer and assertion;
`boot.upgrade.test.ts` checks missing-pair repair and replaced-trigger refusal there. That check
reports the data-check result without the startup repair warning. The installer and stored-text
comparison retain the limits above.

No policies, no `ROW LEVEL SECURITY`: one tenant per database (owner
decision 2026-09-05). Two root guards enforce the classification on every non-docs push:
`scripts/classification-complete.test.ts` (every table each migration set's `drizzle/` creates is
classified exactly once) and `scripts/append-only-triggers.test.ts` (every declared table refuses a plain
`UPDATE` and a plain `DELETE`, tried against a database `applyMigrations` migrated — the product's
own entry point, not one the guard builds and protects itself). The second is narrower than its name
in two ways it states itself: it covers those two statement shapes only, because the other two need
a conflicting key, which is per-table — those are proven once against the trigger pair in
`packages/store/src/append-only.test.ts`; and it drives the DESCRIPTOR path, leaving the
manifest-JSON path that `rejoin-command`, `dev-setup` and `dev-onboard` take to
`packages/composition/src/composition.test.ts`'s `toEqual` of the two, plus
`packages/migrations/src/apply-append-only.test.ts`, which runs it end to end. It also PINS the set
by name rather than counting it, so adding or dropping an append-only table costs a deliberate edit.
Run both after adding any table anywhere.

Neither sees a caller that migrates with a plain options array: `applyMigrations` reads each set's
`appendOnlyTables` as `?? []`, so such a caller gets a migrated database with none of the
append-only triggers and no error. Measured 2026-09-27 on `node:sqlite`, Node v26.7.0, by
migrating the full manifest twice: through `migrationOptionsFor(...)`, `registros_facturacion`,
`sales` and `time_entries` each carried a `RAISE(ABORT)` trigger; with the same array stripped of
`appendOnlyTables`, none of them did, and `applyMigrations` returned normally.
`scripts/apply-migrations-callers.test.ts` holds that every non-test call under `packages/` and
`apps/` passes a `migrationOptionsFor(...)` result, directly or through a `const` declared once in
the file; its header lists where it is weaker than its name.

**What the callers guard does not see.** `scripts/apply-migrations-callers.test.ts` is weaker than
its name in the ways its header lists, among them: it checks the call's shape and trusts what that
function returns, never reading the sets handed to it; a `const` it accepts can be changed after it
is declared; a function injected beside it through `??` runs unseen; and a path that migrates
without `applyMigrations` (`runMigrations` called directly) is invisible to it.

## A `local` row belongs to one node, so no foreign key may join a `local` table to a `ledger`/`state` one

`venue.db` holds every table but `node.db`'s, and a primary streams it whole to the owner's bucket once
one is set up. `node.db`, beside it, holds what a box must remember about itself — its mode and
singleton role (`node_mode`), its link to the main box (`node_mirror_link`), its link to the other box of its pair — the spare's
store address and the store's access key, its secret sealed (`node_pair_link`) — the main box's key it
pinned when it joined (`node_primary_key`), its recovery-key check (`node_recovery_key`), its
sealed signing key (`node_signing_key`), and its handover records: each handover operation it
takes part in (`node_handover_operations`), what it decided and received during them
(`node_handover_events`), and why it no longer acts as the main box (`node_handover_restriction`) — so a spare holding a copy of the main box's `venue.db`
still knows who it is (A947 slice 3a). `node.db` is never streamed (`packages/stream/src/litestream.ts`
names only `venue.db`); a backup file carries it whole as `node.dump`, and the bucket's sealed state
carries a `node.dump` entry. Every other `local` table stays in `venue.db`. No venue row may depend
on a `local` row, and a key in either direction would
block moving a `local` table into `node.db`. Guard: `scripts/two-file-foreign-keys.test.ts`, weaker
than its name: it sides tables by class, not by file, so a key from a `node.db` table into one of
`venue.db`'s `local` tables passes it; SQLite refuses the write instead (`no such table`), because
the target is not in `node.db`.

**Writing across the two files.** Three rules, each because the two files have independent write
queues (`packages/store/src/index.ts`):

- **`node.db`'s write lock is taken outside `venue.db`'s, never inside**, so two writers cannot each
  hold one file and wait for the other.
- **Where one change spans both files, `venue.db` is saved first and `node.db` follows**, and a
  re-run repairs a `node.db` left behind; each such site says so in a one-line comment. The sites:
  promotion's role (`apps/server/src/promote.ts`; `finishPromotedRole` in `promoted-role.ts`
  finishes a role left behind at the next press or the next start), the recovery-key replacement
  and its pack record (`backup-recovery-pack-api.ts`), and first setup's key and first pack
  (`packages/provisioning/src/first-setup-node-key.ts`). The last two hold the node lock around
  the venue save; promotion takes the two one after the other. A signing key is the stated exception: it is sealed in `node.db` before its public
  half reaches `venue.db`, because a public key with no private half could never sign as the box.
- **`withTransaction` never takes the node handle**, and the compiler refuses it: it drains
  `change_log`, which `node.db` does not have (`packages/db/src/tenancy.ts`). A `node.db` write
  uses `withNodeTransaction`. Nothing guards the first two rules.

Cost of the shape it replaced: six such keys existed and nothing would have failed at the flip.

**What it reads, and the two things it therefore cannot see.** It reads drizzle's own generated head
snapshot for each migration set — `meta/_journal.json` names the head and `tables[*].foreignKeys[*]`
holds the graph — so a key declared in TypeScript but not yet generated is invisible to it, and so is
one added by hand-written migration SQL, because a custom migration leaves the snapshot alone.
The first gap is caught by `rebuild-check` in
`scripts/starting-migrations.test.ts`, which compares the regenerated snapshot and SQL with the
committed files. The second cannot arise while `readTriggers` admits only `CREATE TRIGGER`
statements and no set holds a second migration. The reading was chosen over the TypeScript
deliberately: a reading
taken from the TypeScript passes the moment somebody edits a table file, while the constraint is still
live in every migrated database, and it would have gone silently vacuous at the flip, when `PgTable`
stops matching anything.

**How the six that existed were resolved (task P7, 2026-09-19).** All six were a `local` row naming a
venue row by id — a person, a till, a location — so neither of the two routes §2.1 named applied: an
id is the payload, not a value that can be copied elsewhere. The constraint was dropped and the column
kept, with what now establishes the id's target named at the column. Five take their id from a row the
request had already read. The sixth, `join_requests.location_id`, is the node's configured location: it
is checked by nothing when the row is written, and its refusal moved to accept, where the accepted row
(`devices` or `print_agents`) still holds a key to `locations`. Never weaken a classification to make
this guard pass — that is the one wrong answer §2.1 rules out.

_2026-11-14 (A1308 5h):_ the historical location target described above has been removed, after slices 5a–5g moved its consumers. See [the drop plan](../superpowers/plans/2026-11-08-a1308-5h-locations-drop.md).

_2026-09-24:_ five of the six keys were on identity tables that slice-2 Task 1b reclassified
`state` (`sessions` to `persons` and `tills`; `management_sessions`, `totp_enrollments` and
`google_oidc_states` to `persons`). Their keys were not restored; `docs/backlog.md` lists that as
open under Task 1b. _2026-10-04 (A238):_ `tills` is gone; `sessions.device_id` now holds a
`restrict` key to `devices`, and `sessions` still has none to `persons`
(`packages/db/src/schema/identity/sessions.ts`).

_2026-11-03 (A1301 S12b):_ `join_requests.location_id` was stamped with the venue's id.
_2026-11-12 (A1308 5e):_ that column and the venue foreign keys on `devices` and `print_agents` are removed.
_2026-11-14 (A1308 5h):_ `locations` and its interim id accessor are removed; venue and business-day reads use the shared settings documents.

**What ties a `local` row to its node, and which ties are pinned.** A `local` table's reason says
which of three ties it uses: a `node_id` column every read and write names (`join_requests`,
`node_sealed_state`, `recovery_packs`; every `node.db` table carries one too, though a key-ring
rotation reads `node_signing_key` and `node_pair_link` whole), a seal only a box holding the key ring opens
(`tenant_credentials`, whose ring a joining spare receives from the main box), or rows the
transaction that wrote them deletes (`change_log`). `fiscal_certificate_installs` and
`fiscal_certificate_reminders` use the first tie widened to a list: a `node_id` column every read
and write names as one of `readHistoryNodes(tx, thisNode)`, this box and every box it took over from. Identity has no `local` table: slice-2
Task 1b reclassified its logins and sign-in ceremonies `state`, with a login's cookie token stored
only as its hash (`packages/db/src/classification.ts`; #554, and the owner's decision that a
login survives a rebuild and a promotion). Pinned,
each by deleting the node filter and watching a case fail: the `node_mode` and
`node_mirror_link` readers in `node.db` (the "keeps each node's row apart" case in
`packages/node-db/src/mode.test.ts` and the "reads a mirror link only for the node that was
adopted" case in `packages/node-db/src/mirror-link.test.ts`), and every node filter on
`join_requests` in `apps/server/src/join-requests.ts` but deny's delete, which runs only after a
node-filtered read of the same id (the "belong to the node" cases in
`apps/server/src/join-requests.test.ts`), and the `node_sealed_state` reader
(`readSealedStateRow`, the "reads only the named node's row" case in
`apps/server/src/sealed-state.test.ts`).

## Anything that works as a live login is stored as a hash

**Anything that works as a live login is stored as a hash, because a primary streams the whole
database to the owner's bucket once one is set up.** The dashboard and till session cookies carry a
random token and the row keeps its SHA-256 (`hashSessionToken`, `@waitron/identity`), as device and
print-agent tokens (`hashDeviceToken`) and the Google sign-in state do: reading the bucket must never let anyone into the
live box.

**Guards, weaker than the rule:** the "what a copy of the database holds" cases in
`apps/server/src/me-api.test.ts` and `apps/server/src/till-api.test.ts` present the row's id alone,
and only the dashboard's stored hash (`packages/identity/src/management-session.test.ts`) and a
device token's (`packages/identity/src/device-token.test.ts`, at the function, not through a route)
are tried as a token; a new login table is seen by nothing.

## A change carrying the dashboard's sign-in cookie is checked for the page that sent it

**The rule.** `requireManagementChangeFromOwnPage` (`apps/server/src/own-page.ts`) judges every
request whose method is not `GET`, `HEAD` or `OPTIONS` and that carries a
`waitron_management_session` cookie, whatever its value. It takes the request when it came from the
box's own page or a trusted one, and otherwise answers 403 `management.origin_refused` and logs a
warning with the method, `origin` and `site` (the `Sec-Fetch-Site` value), and `lookupFailed: true`
when the trusted-page lookup failed. On the waiting start's app the logged `requestId` is
`undefined`: that app mounts no request-id middleware (`grep -n requestId
apps/server/src/waiting-start.ts` printed nothing, 2026-11-06). The check reads headers only, never
the body.

**Where it runs.** `startServer` builds it once (`apps/server/src/boot.ts:1314-1317`) and mounts it
with `app.use("*", …)` straight after the request-id and build-header middleware on the main app
(`boot.ts:1319`), so it runs ahead of every route registered after it, in the full, restricted and
setup starts, and ahead of routes merged in with `app.route()`. The waiting start gets the same
middleware through `WaitingStartDeps.pageCheck` and mounts it ahead of its routes
(`apps/server/src/waiting-start.ts:100`). A new route on either app needs nothing, but must not be
registered ahead of it. The recovery listener's own app (`recovery-surface.ts`,
`recovery-start-again.ts`, `recovery-listener.ts`), the first-setup apps (`first-setup-entry.ts`,
`first-setup-launch.ts`), `landing-app.ts` and `node-entry.ts` never reach it; none of them read the
management cookie (A1371's plan, D1).

**What counts as the box's own page** (`sentFromThisOrigin` and `sentFromOwnPage`, `own-page.ts`).
"Absent" means the header was not sent; an empty header counts as present and foreign.

- Taken when `Origin` is absent or equals the request's own origin, and `Sec-Fetch-Site` is absent,
  `same-origin` or `none`. The page checks in other files under `apps/server/src/` call
  `sentFromThisOrigin` for the same test.
- Also taken when `Origin` is some other address, not `""` and not `null`, that the trusted-page
  lookup accepts, whatever its `Sec-Fetch-Site`, since a browser rightly calls a trusted page on
  another address `same-site` or `cross-site`. If the lookup fails the change is refused.
- The trusted pages are `managementOrigin` and whatever the CORS allow-list accepts
  (`apps/server/src/allowed-origins.ts:57-58`): this server's advertised address, every routable
  server address in the held membership document, and, in dev mode only, the dev Vite pages. Those
  addresses can already make signed-in cross-origin requests to `/api/*` and read the answers.
- No `Origin` and no `Sec-Fetch-Site` is taken: that is a tool, not a browser. A browser always sends
  `Origin` on a request that is not a `GET` or `HEAD`. The Fetch standard's "append a request
  `Origin` header" (`curl -sL https://fetch.spec.whatwg.org/`, 2026-11-06): "Otherwise, if request’s
  method is neither `GET` nor `HEAD`, then: If request’s mode is not "cors", then switch on
  request’s referrer policy: "no-referrer" Set serializedOrigin to `null`." So a post from another
  page arrives with its real address or `null`, never with none. `Sec-Fetch-Site` is a second
  signal only: Fetch Metadata sends it only to a potentially trustworthy address (`curl -sL
  https://w3c.github.io/webappsec-fetch-metadata/`, 2026-11-06: "To append the Fetch metadata
  headers for a request, given request r: If r’s current URL is not an potentially trustworthy URL,
  return."), so on a box served over plain HTTP at a LAN name or address the check rests on
  `Origin`. Loopback is potentially trustworthy even over HTTP (`curl -sL
  https://w3c.github.io/webappsec-secure-contexts/`, 2026-11-06: "If origin’s host matches one of
  the CIDR notations 127.0.0.0/8 or ::1/128 [RFC4632], return "Potentially Trustworthy".").

**Why.** SameSite ignores the port: the HTML standard's "Sites" are "(origin's scheme, origin's host's
registrable domain)", with no port. So a page on another port of the box's own name is sent the
manager's cookie, and a post with a plain-text body, or with none, reaches the route with no
preflight. B3 PR 9's review showed such a page, in real Chromium, changing the start screen and
forgetting the saved Wi-Fi network.

**Deliberate limits** (each recorded in `docs/backlog/box.md` → _Decisions and deliberate limits_):
the cookie's presence decides, not a live session; `GET`, `HEAD` and `OPTIONS` pass, so another page
can still move a session's last-seen time, and the Google sign-in's return is a cross-site `GET` by
design; `cloud-api.ts`, `content-suggestions-api.ts`, `content-translations-api.ts` and
`venue-zone-repair-api.ts` keep their own stricter checks, which require `Origin` to be exactly
`managementOrigin`; and a page on another of the venue's servers is trusted through the allow-list
with no started-server test sending one.

**Left open:** the till's sign-in cookie and the device cookie are `SameSite=Strict` too, and the
check does not look at them; see the backlog entry "Till changes do not check which page sent them".

**Guards, weaker than their names:** the "refuses the attack on every write route" cases in
`apps/server/src/boot.management-origin.test.ts` and `apps/server/src/waiting-start.test.ts` send
one attack shape (a random cookie, another port's `Origin`, `Sec-Fetch-Site: same-site`) to every
write route in their own app's route table, as their harness mounts it:

- The main-app sweep runs over a full start only, so a module the harness leaves off, and a route
  mounted only on the restricted or setup start, is swept by nothing.
- The waiting sweep runs over a waiting app built with its own stand-in check
  (`requireManagementChangeFromOwnPage(async () => false, …)`), so it proves the waiting app mounts
  whatever check it is given ahead of its routes. That boot hands it the server's real check is
  proved by "the waiting start refuses a carry-on from another port of the box's address, and takes
  its own pages'" in `apps/server/src/boot.start-check.test.ts`: on a started box waiting for a peer,
  the attack on `POST /carry-on` answers 403 `management.origin_refused`, and neither the box's own
  page nor `managementOrigin` is refused. That case sends one route, not a sweep.
- A route registered on any other app is seen by no sweep. The recovery listener's, first-setup's,
  landing and node-entry apps are seen by neither the check nor the sweeps.
Since the check refuses a cookie-carrying change to any path, matched or not, a path no route
serves would also look covered.

## A migration set depends on another through a foreign key, a trigger on its table, or a trigger body naming its table

FK `REFERENCES`, and a `CREATE TRIGGER … ON <table>` where the TABLE is owned by a different
migration set. Since A760 (November 2026) only the first exists in the tree: every trigger a
migration creates is in core's set (`packages/db/drizzle/0000_baseline.sql`) and names only tables
core's set creates. Write its source in `packages/db/triggers/core.sql`.

Until A760 the live instance of the trigger edge was `packages/media`; the account below describes
that old set in the present tense of its day. Its old migration files were deleted with the frozen
history on 2026-11-07 (A1422); read one with
`git show f519799de0:scripts/fixtures/a760-history/media/<file>`. Its
`drizzle/0001_image_references.sql` carries eight triggers standing in for two foreign keys, and four
of them sit on tables another set owns: `products`, created by core in
`packages/db/drizzle/0000_baseline.sql` and rebuilt by core's
`0003_variant_inherited_nullable.sql`, and `category_details`, created by catalogue (catalogue
`0013` and media `0004` have since dropped the two on `category_details`).
`drizzle/0002_section_image_references.sql` adds four more of the same shape for `sections.image`,
two of them on catalogue's `sections`. `drizzle/0003_published_image_references.sql` adds three for
`menu_version_images.filename`: one on catalogue's `menu_version_images`, and two on `media_images`
whose bodies read catalogue's `menu_version_images` and `menu_publications` — edges
`scripts/module-graph-honesty.test.ts` now reads from their trigger bodies.
`drizzle/0008_queued_edition_image_references.sql` re-creates those two so their bodies also read
catalogue's `menu_scheduled_publications`, keeping a photo a queued edition names.
`drizzle/0009_include_folder_image_references.sql` adds four for the photo an include's folder
names (`section_members.folder_overrides`, key `image`): two ON catalogue's `section_members`, and
two on `media_images` whose bodies read `section_members`. A catalogue rebuild of any catalogue
table these bodies read — `sections`, `section_members`, `menu_version_images`,
`menu_publications` or `menu_scheduled_publications` — is the trigger-body shape described below,
which fails on an upgrade. Measured 2026-10-07 on `node:sqlite` (Node v26.7.0), with media's `0009`
applied to a stand-in `media_images` and `section_members`: drizzle's create-copy-drop-rename of
`section_members` inside `begin` failed with `error in trigger
section_members_media_image_fk_parent_delete: no such table: main.section_members`, and without
media's triggers the same rebuild committed. With the two body triggers dropped first, the rebuild
committed and the two triggers ON `section_members` were gone afterwards, with no error. A
rebuild of `menu_version_images` that got past that, by removing media's two body triggers first,
would also drop the insert trigger ON it with no error — inferred from the
`products` measurement below, not measured on this table. Media's two edges, to core and to
catalogue, are both declared — media's descriptor reads
`requires: { core: "*", modules: { catalogue: "*" } }` (`packages/media/src/module.ts`) — and for
the triggers ON another set's tables that declaration is what the guard checks; the guard's job is
the case where such an edge is NOT declared. Core's own triggers, in its migration files under
`packages/db/drizzle/`, sit on core tables and name only core tables, and so are not edges at all.
The live-update triggers are installed at boot and sit outside this migration-text guard; their
behaviour is exercised by `packages/db/src/change-feed.test.ts`.

2026-10-10 receipt-slice update: the media descriptor also requires venue-service for its
department-logo usage reads. Composition and the migration manifest now put venue-service
before media. The earlier trigger measurements above still describe the core/catalogue edges.

**A core rebuild of a table that another set's trigger BODY names applies fresh and fails on an
upgrade; a trigger ON the rebuilt table is dropped with it, silently.** Core's
`0003_variant_inherited_nullable.sql` rebuilds `products`. On a fresh database core migrates before
media creates its triggers, and the whole chain applies. On a venue `main` had already migrated, the
core set aborted at the rebuild's final rename of `__new_products` to `products` with
`error in trigger products_media_image_fk_parent_delete: no such table: main.products` — a trigger
on `media_images` whose body reads `products` — and rolled back: afterwards core's journal still held
its two earlier rows and `products` had no `parent_id` (measured 2026-09-23 through
`applyMigrations`: every set's folders at `5bc04408e`, then `feat/variants-parent-id`'s). The two
shapes separated, measured 2026-09-23 on `node:sqlite` (Node v26.7.0) with the same
create-copy-drop-rename sequence inside `begin`: a trigger ON `products` raised nothing and was gone
afterwards, while a trigger on another table whose body reads `products` failed the rename with
`error in trigger t_body: no such table: main.products`. 2026-11-10: what a migration does about it
from go-live is under
[From go-live, a rebuild drops and recreates every trigger whose body reads the table](#from-go-live-a-rebuild-drops-and-recreates-every-trigger-whose-body-reads-the-table).

**A drizzle table rebuild runs with foreign keys ON, so its `DROP TABLE` acts on every row that
points at the table.** Drizzle rebuilds a SQLite table to change a column's nullability, with the
sequence `PRAGMA foreign_keys=OFF`, create `__new_<table>`, copy the rows, `DROP TABLE <table>`,
rename, `PRAGMA foreign_keys=ON`. SQLite ignores `PRAGMA foreign_keys` inside an open transaction,
and the migrator runs each set inside one. Measured 2026-09-23 on `node:sqlite` (Node v26.7.0), with
that sequence on a parent holding one row and a child holding one row that points at it: inside
`begin … commit`, an `ON DELETE CASCADE` child went from 1 row to 0 with no error, while a child
with no `ON DELETE` action, and separately one with `ON DELETE RESTRICT`, failed the drop itself with
`FOREIGN KEY constraint failed`. The control, the same sequence outside a transaction, kept the
child row in all three cases and raised nothing. Two rebuilds in
the variants-as-products work hit it. (2026-11-07, A1422: both old migration files named below
were deleted with the frozen history; read one with
`git show f519799de0:scripts/fixtures/a760-history/<set>/<file>`.) Task 1's rebuild of `products` (core's
`core/0003_variant_inherited_nullable.sql`, #511) cascade-deleted `product_categories`
on a venue without the media triggers (measured 2026-09-23 by a review of #511's plan, through
`applyMigrations` on a scratch copy of `packages/db`). Task 4's rebuild of `menu_items`
(`catalogue/0003_menu_price_nullable.sql`, #532), measured 2026-09-23 through
`applyMigrations`, emptied `menu_item_extra_lists`, `menu_item_extra_items` and
`menu_item_variant_overrides` while reporting success, and failed with
`FOREIGN KEY constraint failed` when a `working_line_contexts` row named the offer. A paid order
keeps such a row (measured 2026-09-23: after a completed walk-up cash sale from a menu offer, its
`working_line_contexts` row was still there on a `settled` order), so that failure is any venue that
has sold from a menu. Today this costs
nothing beyond a reset, while the rule of no data-migration code until production stands. Once a
venue is live, a rebuild has to carry the child rows across by hand.

**2026-10-12, W41s-4 migration experiment; no migration shipped.** Before changing
`registro_sif.numero_instalacion` from integer to text, qualify the generated parent rebuild
against fiscal records. In a disposable clone of `21ce89a2b`, drizzle-kit 0.31.11 generated that
rebuild after the column became `label` and its CHECK became a length bound of 1–30 characters.
On Node v26.7.0, the generated SQL migrated a SIF with no record but failed at
`DROP TABLE registro_sif` when `seedSale` and `appendToChain` had written a record referring to it.

The experiment replaced the generated foreign-key toggles with `defer_foreign_keys=ON`,
then checked `pragma_foreign_key_check` through a temporary table whose CHECK required zero
violations, before setting deferral OFF. Through `applyMigrations`, with the change feed installed
before migration, that candidate retained the complete fiscal-record and chain rows and the
record's append-only trigger pair. Deliberately changing the copied SIF id refused the integrity
CHECK and rolled back the SIF rebuild and journal advance. Removing the integrity check let that
orphan commit; the same refusal test then failed. Commands in the disposable clone were
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/allocation-boot-migration.probe.test.ts`
and the deletion control with `-t 'deferred orphan control with check'`. The temporary probe and
SQL are retained with the campaign's migration receipts.

This experiment covers this SIF rebuild and its sampled records. It does not cover cascading
children, every possible stored value, or the future allocation ledger and runtime consumers.
The candidate also passed the migration-upgrade, schema-constraints, append-only-triggers,
behavioural-triggers and migrations-match-schema suites. Repeat the product and integrity
controls against the final schema and generated migration before connecting activation.

`scripts/module-graph-honesty.test.ts` derives its edge kinds from the SQL text, and says so. **Two
hedges from its own header belong here, because a failing test can never restore them.** The
`EXECUTE (FUNCTION|PROCEDURE)` detector was DELETED as dead syntax — SQLite has no functions, so
`CREATE FUNCTION` and `FOR EACH ROW EXECUTE FUNCTION f()` are both syntax errors on it. And a SQLite
trigger's body is read as text for five statement shapes: `FROM`, `JOIN`, `INSERT INTO`, `UPDATE`
and `DELETE FROM`. At top level it checks plain `INSERT INTO`, `UPDATE` and `DELETE FROM`
at the start of a statement. Other SQL syntax, top-level reads, WITH-prefixed writes, REPLACE and
INSERT/UPDATE OR variants can still name a table without being detected; the guard does not parse SQL. The engine does not catch a missing body target either. Measured 2026-09-23 on
`node:sqlite` (Node v26.7.0): a trigger whose body reads or writes a
table that does not exist is created without complaint, and the insert that fires it fails with
`no such table: main.<name>`; create the table and the same insert succeeds. The control in the
other direction: a trigger ON a missing table is refused when it is created. So a missing
dependency of this shape surfaces only when the trigger first fires.

**The rule in full.** A module depends on another migration set when its SQL `REFERENCES` one of
that set's tables, puts a `CREATE TRIGGER … ON` one of them, names one inside a trigger's body, or
writes one at top level — and its descriptor's `requires` must name it. Cost: the first `requires`
graph was derived from `REFERENCES` alone and missed two edges made by triggers ON another module's
tables, caught by hand in review.

### Retiring configuration tables also retires their export format

**Check imported settings against the destination's retained configuration too.** A989's
run-it review imported a Barcelona bundle into a venue configured for Madrid and observed that
the destination kept Madrid. Checking only the bundle therefore cannot establish the
destination's language requirements. Modules can use `configurationTransfer.beforeImport`
to read the destination in the import transaction before any transferred table is replaced.
The source-Madrid/destination-Barcelona case in
`packages/provisioning/src/configuration-transfer.content-languages.test.ts` refuses the copy
without Catalan and retains the destination setting; its accepting control imports Catalan
without changing the province. The same suite checks that a module's hook sees the old rows.

Implementation pointer, 2026-10-17: the configuration staging and transfer services now live in
`packages/provisioning/src/configuration-import.ts` and `configuration-transfer.ts`. Their server
entry points forward to those implementations. The setup command imports no configuration: its
claim never asks for one (`packages/provisioning/src/cli.ts` passes no import to
`claimFirstSetup`). The setup page stages a configuration with `POST /setup-api/configuration` in
`apps/server/src/setup-api.ts`; it is imported when the setup runs with `configurationImport`
(`apps/server/src/boot.ts`).

A182 part 2 removes `canvases` from the transfer declarations. Every earlier format-2 export
includes that table key, even when it has no rows. With the format left unchanged, the real setup
route refused both empty and populated canvas lists as `setup.request_invalid` on `tables`.
Format 3 refused those older files as `setup.configuration_outdated`, before replacing staged
files. Current exports still round-trip; future formats keep their version refusal. The cases in
`apps/server/src/configuration-import.test.ts` cover both old canvas lists and retained staging
files; `configuration-transfer.test.ts` retains the receipt-choice round-trip and pins format 3.
No old settings are converted. Cost: the whole-branch run-it review found the generic refusal
while checking this reset-only release.
A725 (format 4), A757 slice 2 (format 5, 2026-10-19, when it dropped `table_service_statuses`),
A841 slice 2 (format 6, 2026-10-21, when it replaced `tenant_themes` with `custom_themes`), A756
PR 5 (format 7, 2026-10-23, when it dropped `kitchen_timing_defaults` and `kitchen_station_timing`
and the station's own minutes joined the copy), A756 PR 8 (format 8, 2026-10-24, when it
dropped `service_settings`) and A980 S1a2 (format 9, 2026-10-26, when the copy gained the venue's
privacy contact as the required top-level `privacyContact` key) moved the format for the same
reason. A1301 S17 (format 10) made the venue's setup fields `venue`'s own keys, moved
the default menu to the top-level `defaultCatalogueId` and dropped the location's `id` and
`fireControl`; a format-9 export is refused as outdated. `configuration-transfer.test.ts` pins
the current format, and older files are refused as `setup.configuration_outdated`.
A1308 slice 1b-ii (format 11) moves the comp limit from `adjustment_settings` to the
`settings.adjustments` document; a format-10 export is refused as outdated.
A1308 slice 4a-i (format 12) removes the recipe tables and derivation columns;
a format-11 export is refused as outdated.

**2026-11-10, A1308 slice 4a-ii:** format 15 removes the venue's extra-menu list
(`location_catalogues`) from configuration exports; a format-14 export is refused as
`setup.configuration_outdated`.

**2026-11-10, A1308 slice 4b:** format 17 removes `payment_policy`; the payments module
transfers no configuration tables. A format-16 export is refused as `setup.configuration_outdated`.

**2026-11-12, A1308 slice 5e:** format 19 removes the remaining transferred `location_id` columns and top-level `defaultCatalogueId`; the default menu travels as `catalogues.is_default`. Format-18 exports are refused as `setup.configuration_outdated`.

**2026-11-11, A739 cut 7(c):** format 18 removes `receipt_print_mode` from department and zone sale policies; format-17 exports are refused as `setup.configuration_outdated`.

**2026-11-10, A1308 slice 5a:** format 12 removes `location_id` from the service, calendar,
staff and booking tables and makes `convenio_config` a singleton with integer id 1.
The format-11 refusal is exercised by `apps/server/src/configuration-import.test.ts`.

From go-live, retiring a module also ships a way for an older export that names it to load (owner,
2026-11-07), because setup answers an export refused as `setup.configuration_parts_differ` by
telling the person to update this server. Until go-live a server is reset instead (CLAUDE.md §3).

### A configuration bundle value that is not a setup field stays out of the venue's own keys

The setup app copies into the claim only the preview's `country`, the taxpayer fields (`TAXPAYER_FIELDS`) and `CLAIM_VENUE_FIELDS`
(`apps/setup/src/setup-app.ts`). The claim refuses any venue key it does not list
(`exact(body.venue, …)` in `apps/server/src/setup-first-fiscal-api.ts`). So a bundle value that is
not a setup field lives outside `venue`'s own keys; the privacy contact and content languages
travel as top-level fields
(`packages/provisioning/src/configuration-transfer.ts`). Cost: from #1752 to A980 S1a2 every Live
setup from an export on a production box was refused at the claim, because the setup app, which
dropped only the location's `id`, copied its `fireControl` and `catalogueId` into it (probes 2 to 4
of the
[S1a2 plan](../superpowers/plans/2026-10-26-a980-s1a2-export-privacy-contact.md#what-was-run-while-writing-this-plan));
the tests that set up a production box from an export
(`apps/server/src/first-fiscal-setup.e2e.test.ts`'s owned Live setup rows, and
`apps/server/src/first-fiscal-hour-import.e2e.test.ts`'s `production` rows through
`apps/server/test/owned-hour-setup.ts`) sent the claim a hand-written venue, never the preview's.

Two guards, both weaker than the rule. The `claimFrom: "preview"` row in
`apps/server/src/first-fiscal-setup.e2e.test.ts` sends the preview's venue whole through a
production claim, so it fails if the bundle's `venue` gains a key that is not a setup field.
`apps/setup/src/setup-app-first-fiscal.test.ts`'s "claims a staged preview's venue with only the
venue fields the claim accepts", against a stubbed server, fails if the setup app copies the
test's own extra key (`somethingNew`) into the claim, as it does when the preview is copied whole.
Both cover one export shape. Nothing checks `CLAIM_VENUE_FIELDS` against the claim's own
`exact(body.venue, …)` list: the compile-time check ties it to `VenueDraft` alone, a hand copy of
the server's shape.

## A column of a transferred table that holds another row's id is a foreign key, a declared `references` entry or left out of the export

A configuration import gives every row whose `id` is text a new one, and rewrites a whole value to the new
id in a table's `id` column, its foreign-key columns, and the columns its module lists as
`references` (`importConfigurationTables`, `packages/provisioning/src/configuration-transfer.ts`,
which reads `pragma_foreign_key_list` for the keys), and the export leaves out the columns a table
lists in `omit`. Declared `jsonReferences` paths rewrite ids inside JSON as described below.
Any other column the export
carries that holds a row's id arrives holding the EXPORTING venue's id. Before W72a (#1230) the
import replaced any text equal to a bundle id in every column, so a product named like an id arrived
renamed; the narrowing is what makes this rule necessary. A reference the schema cannot give a
foreign key goes in `references`, as `option_lists.default_label_id` does.

Cost: W72a's narrowing (#1230) made two existing columns need a `references` entry; without them
two transfer cases failed.

Guard: `scripts/id-columns-are-references.test.ts`, which migrates a real database and reads every
transferred table's columns and keys. Weaker than its name: it knows an id column only by a name
ending `_id` or `_ids`, so a reference named otherwise is unseen; a column on its `NOT_REFERENCES`
list is trusted by the reason written there, so one that later starts holding an id passes; and a
JSON column without a `json_valid` CHECK is invisible unless its name ends in `_ids`.
An `_ids` column needs `jsonReferences` or `omit`; a whole-value `references` entry does not
describe the ids inside a list. JSON columns holding no row ids need a reason in `JSON_WITHOUT_IDS`.

Short id lists owned by one row use `jsonReferences` (rationalisation design R4). Each declaration
names a column and paths made of object keys and `*` steps, which visit every object value or array
element. Export removes an id when no exported row has it: an array loses that element, and an
object field becomes null. Import rewrites each id through the bundle's id map and refuses a
missing id with `setup.request_invalid`, naming the table and column. An id naming the source
operator or a row skipped with that operator is refused too. Both export and import refuse
malformed JSON, a non-string id, or a non-null container of the wrong kind at the root or after a
named key. Unrelated scalar values selected by a wildcard are skipped. String values outside the declared paths are not remapped;
parsing and serialization can normalize whitespace or numeric values. Whole-column nulls, nulls along a path,
null id fields and missing keys are skipped. Fixed-key rows that an import keeps must be put in
the id map by their owning module; this helper does not add them. It does not check target kinds.

Deleting a referenced row calls `removeIdFromJson` in the same transaction. It removes matching
array elements and nulls matching object fields, including nested ones, leaving other rows' text
unchanged. These choices address the import-rewrite and export-pruning gaps in
`docs/superpowers/specs/2026-11-02-rationalisation/tables-devices.md` §7. Its third gap is not built:
department deletion refuses a live profile in `service-delete.ts`, and `checkedScope` in
`profile-access.ts` refuses disabled departments or zones; retired profiles are deliberately left
behind. The synthetic round-trip and refusal cases are in
`packages/provisioning/src/configuration-transfer.json-lists.test.ts`; each later list owner adds
its own declaration, deletion call and round-trip case.

The export leaves behind each row whose `leaveBehindWhenSet` column is not null (a retired
device profile, `retired_at`), or whose `leaveBehindWhenFalse` column holds false or 0
(a deleted course or station, `active`). Archived products still travel: their `active` field
has no leave-behind selector. The export then excludes every row of a transferred table whose foreign key names a
row left behind, repeating until nothing more is left behind (`exportConfigurationTables`,
`packages/provisioning/src/configuration-transfer.ts`). It reads the keys from `pragma_foreign_key_list`,
never the `references` lists, and follows only those between transferred tables that lead from a
table declaring either selector to its children, and on to theirs. A key's parent table is
matched ignoring the case of ASCII letters, as SQLite matches table names; a key that names no
parent columns points at the parent's primary key. SQLite itself decides which rows a key names,
by joining the two tables, so the parent column's collation and type rules apply, and a key with a
null in it names nothing. Among the tables it follows, the export refuses with
`setup.request_invalid`: a selector name the table has no column for
(`<table>.<column>`); a table stored `WITHOUT ROWID` (`table:<table>`); a column named `rowid` in
any case, or exactly `__export_rowid` (`<table>.<column>`); and a key whose parent columns do not
number the same as its own, as when it names none and the parent has no primary key
(`table:<child>`). Both column checks count generated columns. Guard: the leave-behind cases in `apps/server/src/configuration-transfer.test.ts`.

**A module's transfer `validate` may read when and where the bundle was made.**
`ModuleConfigurationTransfer.validate` (`packages/module/src/module.ts`) takes an optional second
argument, `{ createdAt, timeZone, dayCutover }`, which `validateConfigurationBundle`
(`apps/server/src/configuration-transfer.ts`) fills from the bundle and passes to every module's
`validate` before the import writes anything. Core, catalogue and media take only the tables.
Venue-service's `validateSeasonWeeks` (`packages/venue-service/src/configuration-transfer.ts`)
checks ranges against the exported day changeover, and uses the bundle's time zone to refuse
special-day paint at a time the clocks skip, a repeating date at its next occurrence from the
bundle's `createdAt` (`refuseSkippedPaint`). The menu validator takes only the tables. The station-hours validator was removed in A366 slice 4.

### Service-period configuration

(2026-10-21, A789: the period end offset is gone. The first measurement below tested it; the
second's `-t` filter names a test since renamed "round-trips service periods with colours, ordered
staff menus and remapped business-day ranges".)

Measured 2026-10-08 for A432 with `pnpm --filter @waitron/venue-service exec vitest run
src/schema/schema-conformance.test.ts src/migrations.test.ts src/period-end-offset.test.ts
src/menu-timetable.test.ts src/menu-timetable-routes.test.ts src/configuration-transfer.test.ts
src/hours.test.ts`: 550 cases passed. The offset cases exercised exclusive selection/sending
cutoffs, yesterday's grace into a closed day, repeated and skipped wall minutes, and rejected
calendar changes with unchanged saved rows. `pnpm --filter @waitron/server exec vitest run
src/till-api.service-periods.test.ts src/configuration-transfer.test.ts src/venue-details.test.ts`
passed 222 cases, including signed-offset roundtrips under remapped IDs, fresh requests during
grace, refusal of stored increases and clock-edit rollback. These focused runs do not replace CI's
package-wide coverage checks.

Measured 2026-10-08 with `pnpm --filter @waitron/venue-service exec vitest run
src/configuration-transfer.test.ts` and `pnpm --filter @waitron/server exec vitest run
src/configuration-transfer.test.ts`: period colours and ordered staff-menu rows travelled to a
second real venue under new period, department and menu IDs. The server roundtrip uses 04:30:
21:00–03:00 imports, and a `department_day_ranges` range ending 05:00 is refused with
`setup.request_invalid`, field `department_day_ranges`. Measured 2026-10-12: with the source
venue's changeover set to 06:00 instead of 04:30, `pnpm --filter @waitron/server exec vitest run
src/configuration-transfer.test.ts -t "round-trips service periods with end offset"` failed both
cases at that refusal assertion ("expected function to throw an error, but it didn't"); with
04:30 restored both passed. The callback context now carries `createdAt`,
`timeZone`, and `dayCutover` (`packages/module/src/module.ts`, `apps/server/src/configuration-transfer.ts`).

(2026-10-13, A506-5: named days and their slots are gone; this paragraph records the earlier
validator.) The menu validator puts a named day's slots through `parseServiceDay`, so they stop at the
business-day boundary and use quarter-hours; an old weekday row's slots are checked only for what
inserting them needs, quarter-hours included. Special-date endpoints below changeover are checked on the next calendar
morning; an end exactly at changeover is next morning and a start there is the business date.
Removing each endpoint-date branch in the disposable checkout failed its skipped-time
assertion. Unlike station hours, the menu writer and import check skipped endpoints on past
business dates too (`saveSpecialDateMenus`, `packages/venue-service/src/menu-timetable.ts`).
The station-hour assertions were retained at that checkpoint. **2026-10-10:** slice 4 Part B
retires their subject, the station-hours schema and its writers. The menu endpoint checks remain.
These experiments are not a complete-slice result.

### Today's station destination and zone extension

A station's by-hand state and chosen destination belong to one business date. A closed station
follows that destination, then the active venue default if the destination is missing or the walk
cycles. A deleted station is not offered as a destination. With no active default, a failed walk
has no replacement. Opening the station does not move already sent work back.
The station row holds `closed_on_day` and `closed_sends_to_station_id`; the zone row holds
`kept_open_day`, `kept_open_from` and `kept_open_until`. A day other than today's business date
reads as unset. Configuration exports omit all five columns, so a new venue starts without
today's service choices.

Focused receipts: `packages/venue-service/src/station-times.test.ts`, `routing.test.ts`,
`routing-store.test.ts`, `keep-open.test.ts`,
and `configuration-transfer.floor-kitchen.test.ts`. Changes made through the keep-open and
station-today controls are written to `activity_log` as `zone.kept_open`, `zone.keep_open_ended`,
`station.closed_for_day` or `station.reopened`; the acting person and device are recorded separately
from the authoriser.

To keep a zone open through its next closed range, choose **Keep Terrace open later** beside
the till's service line, in its closed-zone notice or on the floor's selected-zone bar. Choose
a later quarter-hour and confirm; staff without the service permission can ask a manager to
approve with a PIN. **End the extension** removes today's zone override. The server checks that
the department stays open throughout the requested range: a zone can be kept open only while its
department's own hours for the day run (`zone_extension.not_allowed`, `department_closed`).
The zone override lifts its closed times; it changes no menu timetable or price.

The real-route cases in `apps/server/src/till-api.keep-open.test.ts` seat a table during the
zone's extension and refuse it at its exact end, and refuse an extension beyond the department's
closing time without writing. `packages/venue-service/src/keep-open.test.ts` checks a department
gap, an extension spanning two closed ranges, and the pricing path without zone-extension queries. The till's
`zone-keep-open.test.ts`, `zone-keep-open-screens.test.ts` and menu-refresh cases check the
zone write, manager retry and refreshed controls.

**Transactions**

## Multi-table writes share ONE transaction, and `withTransaction` IS that transaction

(`packages/db/src/tenancy.ts`). Write-path functions take a `tx: Transaction` and never open their
own; a route handler opens exactly one `withTransaction` per request (`recordSale`'s header says why —
`packages/core/src/record-sale.ts`). A convention, not a compiler guarantee: `Database` is assignable
to `Transaction`, and an ESLint backstop was declined (2026-09-03). **Splitting one logical change
across transactions is a commented decision, never a default.** `provisionVenue` stamps the database
before its venue transaction opens, and its header says so. `adoptFromPrimary` opens no transaction
around its writes and has file writes between them, and its header does not say so (tracked in
`docs/backlog.md`, from #625's review).

A secret check that derives an scrypt key should be the exception: it takes the `Database` rather
than a `tx` and derives the key with no transaction open, because `withTransaction` is the venue's
single write lock (`packages/db/src/tenancy.ts`) and every other write would wait on scrypt. One
that must act on the row afterwards re-reads it once the key is derived, and opens a transaction
only for its own write.

The PIN, manager-password and own-password checks follow it in two halves (W1, #1117). The route first
calls `checkPin` (`packages/identity/src/credential.ts`), `checkManagerPassword`
(`packages/identity/src/manager-login.ts`) or `checkOwnPassword` (`packages/identity/src/profile.ts`)
with no transaction open, and hands the result to the check inside its transaction
(`verifyPersonCredential`, `authorize`'s override, `loginWithPin`, `loginManager`, `loginManagerById`,
the profile changes). That inner check re-reads the row and reuses the result only if identity issued
it, for the same person and secret, against the same stored hash
(`packages/identity/src/secret-check.ts`); otherwise it derives inside the transaction exactly as
before. A wrong-PIN or wrong-password limit that sat inside the transaction stays there, ahead of the
reuse. The server's early halves include `withPinCheckAhead` (`apps/server/src/pin-check-ahead.ts`),
`ownPasswordChanges` (`apps/server/src/own-password-ahead.ts`), `pinGated`
(`apps/server/src/payments-api.ts`) and direct `checkManagerPassword` calls in the dashboard
sign-in, promote and mirror-bundle routes.
`grep -rn 'withPinCheckAhead\|ownPasswordChanges\|pinGated\|checkPin(\|checkManagerPassword(' apps/server/src --exclude='*.test.ts'`
lists the two helpers' own files and every route file with an early check. Each runs the early check when what the route can read before the transaction says the
secret will be checked, so a request the transaction refuses before its own check (an order already
cancelled, a profile save that changes the email and blanks the name) has derived a key for nothing. `withPinCheckAhead` and
`ownPasswordChanges` ask the throttle's `wouldRefuse`, which changes no state, and attempts on the
same throttle key take turns, outside the write lock, from the early check until the request's
transaction finishes and its outcome is counted or cleared (`inTurn`, `apps/server/src/attempt-turns.ts`;
at the till's sign-in and the dashboard's payment attestation routes a PIN that is not text takes the same turn to be counted, through `inPinTurn`), so attempts sent at once are
each checked only after the outcomes before them are counted. `inTurn` must never be awaited inside
a transaction, and nothing checks that. **Weaker than it looks:** nothing makes a route pass a result or take turns, so a new
route that forgets the early half still derives under the write lock, one that skips the turns derives a key for every attempt
sent at once even after the limit would refuse them, and no guard notices. The tests that see
it are per route: each converted route has a case in which another writer commits while the key is
derived, and it fails if a key is derived while the request's own transaction holds the lock.

Queries sharing one transaction are awaited one at a time, never started together with
`Promise.all`. The MECHANISM changed with the engine; the rule did not. On this one there is nothing
to overlap in the first place: the driver is synchronous — `execute` hands back its rows rather than
a promise of them (`packages/store/src/node-sqlite-adapter.ts`) — and a venue file takes one write
transaction at a time, because `withTransaction` runs its body inside `db.withWriteLock`
(`packages/db/src/tenancy.ts`, `packages/store/src/write-queue.ts`). So `Promise.all` over a
transaction's queries buys nothing and hides the order the statements really run in. **No timing has
been taken on this engine**, and none is claimed here. What was measured is an outcome, not a
timing — 2026-09-22: two reads and two `create table`s issued with `Promise.all` inside one
`withTransaction` all completed, so the hazard is ORDER, not loss. Re-run 2026-10-03 on
`node:sqlite`, Node v26.7.0, through the real `withTransaction`: both tables existed afterwards.

**No test or guard enforces this rule anywhere.** The `fireLines` single-call test and the
preparation-route read-count test count calls and queries; neither can tell whether queries overlap.
The missing guard is an item in `docs/backlog.md`, under "Modules, data and code health".

## A zone's floor plan: sets, layouts and today's plan

Edit a set's layouts on the dashboard; work from today's plan on the till. Saving a layout does
not rearrange tables during service: only a reset does.

A zone's tables are shared by every layout of the zone (`floor_plan_tables`, keyed by `zone_id`,
with a joined table's parts pointing at it through `part_of_table_id`). A set (`floor_plan_sets`)
holds its department, name and default, with a unique name per department and one default each.
It holds at most one layout per zone (`floor_plans`, unique on set and zone). A placement row holds
a table's size; null coordinates, shape and rotation retain that size while the table is off the
layout. A never-sized table off the layout has no placement row. Venue-service owns the set a
period picks (`menu_periods.floor_plan_set_id`, null for the default). That key names core's table, so the database takes another department's set; the
period routes refuse it `menu_period.invalid`. A set with no `floor_plans` row for a zone reads as
the zone's tables all off, at revision 0 (`readLayout`, `apps/server/src/floor-plan.ts`). A save
that changes the zone's shared tables (adds, deletes or renames one, or changes its short name,
seats, "Moveable" or parts) moves the revision of every layout of the zone in the set's department,
writing the missing rows (`saveLayout`, `changedShared`), so an editor open on another set cannot
save a stale table list. A set is removed only through `FloorDeletion.removeSets`
(`apps/server/src/floor-plan-sets.ts`), which deletes its layouts and empties
`floor_zones.today_set_id` wherever it was recorded. A zone in no set's department has no plan on
the till (`plannedZones`, `apps/server/src/floor-layout-due.ts`).

A table's short name (`short_name`) is on the plan's tables (`floor_plan_tables`), the reset rows
(`floor_reset_tables`) and the live tables (`dining_tables`), and may be null. The live tables also
hold a folded copy, `short_name_key`, unique in the venue
(`dining_tables_short_name_key_uq`) and written only through `shortNameColumns`
(`packages/db/src/table-short-names.ts`). Nothing in the database ties the copy to the short name: a
writer that skips the helper is not refused. A save resolves each table's short name
(`resolveShortNames`, `apps/server/src/table-short-names.ts`, called from `checkSave` in
`apps/server/src/floor-plan.ts`). A table the save sends none for, and whose name it leaves
unchanged, keeps its stored one, or gets none when another table holds that one; one with no stored
short name, or one the save adds or renames, is given one proposed from its name
(`proposeShortName`, `@waitron/shared`), or none when that proposal is taken. A sent one is refused
`floor_plan.invalid` when blank or longer than five characters, and `table.short_name_taken` when,
ignoring case, the save keeps it for another table or sends it for an earlier one, or a table of the
venue's other zones (plan or live) holds it or, having no short name, has it as its full name.
The dashboard's floor plan editor sends a short name for every table, the stored one or else its
name's proposal (`draftFromPlan` and `saveFromDraft`,
`apps/dashboard/src/screens/floor-plan-draft.ts`), so every short name in its saves is a sent one;
only a sender that sends none (the seed, the API) meets the kept and proposed cases or the
`table.label_taken` refusal with `takenBy`. A table the save adds or renames that is left with none
is refused `table.label_taken`, with `takenBy` naming the other table, when, ignoring case, a table
of the venue's other zones (plan or live) holds its full name as a short name or, having no short
name, as its full name. A table the save leaves under its stored name is not checked for this, and
neither is a clash with a short name the same save gives another of its own tables. A reset gives a
live table its new name and short name together, or waits while either is held by another table
(`planReset`, `apps/server/src/floor-reset-plan.ts`). A configuration file carries `short_name` and
never `short_name_key`; the import sets the key (`storeTableShortNameKeys`, the core transfer's
`afterImport`).

Which set is due at a moment is venue-service's answer (`dueFloorLayouts`,
`packages/venue-service/src/floor-layout-due.ts`): the set of the department's period running,
else the next run later today, else the last that ran, never one starting earlier than the
recorded run while that still matches; with no run, the department's default. A zone's own closed
times and keep open play no part. Every reset records what it was made from on
`floor_zones`: `today_business_day`, `today_set_id`, `today_layout_revision` and the run's `today_occurrence`
(`resetZoneFor`, `apps/server/src/floor-today-store.ts`). The zones read offers Update layout
while the due set, or its revision, differs from today's record (`layoutOffer`).

A zone is reset onto one set's layout by four paths. The day's first floor read or change
(`ensureToday`) resets onto the due layout, and only when the due set has a `floor_plans` row for
the zone; otherwise the zone is left as it is. A save of a zone with no recorded `today_business_day`
resets it onto the layout due then (`firstSaveReset`, `apps/server/src/floor-plan.ts`). Reset to
{set} plan (`POST /api/zones/:id/today/reset`) resets onto the recorded set, and is refused
`floor_today.layout_changed` when that set is gone or is not the zone's department's
(`recordedOnto`, `apps/server/src/floor-today-api.ts`). Update layout (`POST
/api/zones/:id/today/update-layout`, `updateLayout`) resets onto the due layout only when it is the
set and revision the till sent, else refuses `floor_today.layout_changed`, and keeps a table taken
off today off, at its new place.

A reset copies the layout into `floor_reset_tables`, one row per table with its place in that
layout, with each member's `part_of_reset_table_id` naming its group row, then runs the catch-up
(`catchUpZone`). New real tables are created from those rows, including rows that had to wait for
a name. Joined design rows remain reset metadata; their members become the live group. The copy keeps a later save from changing what a reset is still applying.

A table waits, its reset row left pending, while a party holds it, a module refuses to let it go,
or it needs clearing. `waitingTogether` grows that set until it is closed: a merge with a waiting
table waits whole, as does a saved group with a waiting member or food on its way to one.
Outside a full reset, a group containing an outside member waits until that member leaves;
a subgroup wholly inside the saved membership may reform. A full reset may dissolve free groups.

Inside a reset a free table goes to its new place at once. Outside one, the catch-up never moves a
table drawn on today's map: a pending row whose table would move (`movesTable`,
`apps/server/src/floor-reset-plan.ts`), or a table of whose joined group would, is marked
`floor_reset_tables.ready_to_move`, the whole group with it. The till shows "Needs moving" while the
mark holds and the change would still move the table (`needsMoving`,
`packages/db/src/joined-parts.ts`). Mark moved (`POST /api/tables/:id/today/mark-moved`, `markMoved`
in `apps/server/src/floor-today-mark-moved.ts`) applies the whole group's change and clears the
marks; on a table that does not need moving it changes nothing. Leave it here (`POST
/api/tables/:id/today/leave-here`, `leaveHere` in the same file) instead leaves the whole group
where today's map has it, without changing the saved layout, and on a table that does not need
moving it too changes nothing. A group row whose table already has the row's name and short name is
ended (`pending`, `ready_to_move` false, `placed` true), the state the catch-up leaves once it has
applied a placed row; ending it, rather than leaving it waiting, keeps a member with guests from
making every floor read run the catch-up (`catchUpDue`). A row that gives its table a new name or
short name, as a dashboard rename does, stays waiting, marked placed and not ready to move, so the
catch-up gives the table its names, as for any row waiting only for its names, and never marks it
again; while another table holds either name it keeps waiting. A saved group's metadata row has no live table and is ended rather than marked placed. The catch-up reads only waiting rows and skips placed ones, so none
of these is marked again until a reset rewrites the zone's rows; that reset treats them as any reset
does: a free table goes to its new place, or is marked again when that place is still taken; a table
with guests waits and, once free, is marked whatever stands in its new place. Once none of a marked
group's tables would move (taken off, say), the catch-up applies it as any other row. Back to its
saved place on a table that needs moving is Mark moved (`backToSaved`). A table that needs moving is
refused `table.needs_moving` when a tab is opened at it (`openTab`,
`apps/server/src/working-order.ts`), a bill is moved to it (`readTargetTable`,
`apps/server/src/move-bill.ts`) or it is merged (`apps/server/src/floor-today-merges.ts`).

Automatic resets and catch-up keep a table in place while another staying on the map stands in
its new place (`standsIn`, `apps/server/src/joined-split-layout.ts`): drawn, it is marked
`ready_to_move`; off the map, it waits. Its current place then blocks in turn (`blockedMoves`,
`apps/server/src/floor-reset-plan.ts`; in SQL, `placeTaken` in `catchUpDue`). Tables moving together,
tables needing moving block nothing. A table standing
exactly at its own place in the recorded layout also blocks nothing (`blocksPlace` and
`blocksPlaceSql`): the layout was saved that way. Mark moved carries its reset rows past these
place checks. Mark moved and Back to its saved place accept occupied places.

A closing party keeps its table names as text and releases its `party_tables` rows
(`closePartyTables`, `apps/server/src/parties.ts`). Permanent removal releases order delivery
references and calls each module's `TableRemoval` seat before deleting the table
(`apps/server/src/table-removal.ts`). Boot supplies these contributions from modules with an applied
schema version above zero, including switched-off modules; never-installed modules are left out.
`apps/server/src/boot.table-removal.test.ts` exercises the enabled, switched-off and never-installed
bookings cases through the trading till's floor read. Bookings copies the table label and clears its pointer
(`packages/bookings/src/table-removal.ts`); the delivery release copies the label onto referenced
orders (`apps/server/src/delivery-release.ts`). A table is in service through `tableInService`
(`packages/db/src/table-in-service.ts`): it has a today's row in a live zone. That test does not
exclude a table taken off today. There is no active column on `dining_tables`.

A saved joined table starts as one named ordinary group of its real members. Its design row is
metadata only. Reset slots use each member's recorded placement size, then its kept size, then
`NEW_TABLE_SIZE`, in table-number order (`resetZoneFor`, `floor-today-store.ts`). The reset copy
keeps these slots as the members' before-places. Group formation waits for the members, and a
later catch-up keeps an already formed group's identity.

`GET /api/tables` and bookings offer real members under their own labels and ids. They have no
saved-part exclusion. Today's table reads carry ordinary `joinId`, `joinSeats` and `joinName`;
there is no synthetic joined-table row, joined-only action or Reset table route. Split tables…
uses `splitGroup`; Join with… uses `writeMerge`. Fixed seats retain their party joins. Merge membership and its three before-place values live on `dining_tables`; `table_merges`
holds the group name and seats. Its members leave before the group row is deleted.

Split tables… also requires the till's `expectedParties`, distinct party ids and revisions from
its ticked tables. After validating the
selected members, `splitOff` compares the observed holders and revisions before the split's
stranding, seats and placement checks or writes. A free read sends `[]`. Seating stays outside
the room's revision.

Each room's plan for the day has a revision (`floor_zones.today_revision`, read as `revision`). A
reset adds one to it (`resetZoneFor`, `apps/server/src/floor-today-store.ts`). Any other request
moves it by one for its own writes, however many rows they touch, when they change the room: the
request compares the room's print before and after its writes (`roomPrints`,
`apps/server/src/floor-revision.ts`: each table's name and short name, `on_floor` and today's values, group and
reset row's `ready_to_move`). So a read whose catch-up marks a table "Needs moving" moves the
revision. The catch-up in `ensureToday`, which runs first, moves a room it did not reset by one when
it changes it; a room it resets moves only by the reset's one. The table routes, the two zone routes
(reset and update layout) and the party join refuse a sent revision that is not the room's revision
after the catch-up, before their own write (`floor_today.out_of_date`, `refuseStale` in
`apps/server/src/floor-revision.ts`, called by `changeRoom` and `refuseStaleZone` in
`apps/server/src/floor-today-api.ts` and by `movingRooms` in `apps/server/src/till-api.ts`). A
refusal rolls back the catch-up with everything else. The till sends the revision with a table
route, a zone route and a party join with a merge, and any of those that sends none is refused
(`management.request_invalid`, `requiredRevision` in `apps/server/src/floor-revision.ts`); a zone
route alone may send `null`, for a read that held no table of the zone with a today's row.

A live table carries today's state in its `today_*` columns, `on_floor` and `taken_off`.
`on_floor` distinguishes an unplaced spare from a table outside today's map. Clearing that flag
also clears the other today values; `dining_tables_off_floor_ck` refuses a partial clear.

A table's name for today is `dining_tables.today_name`, a group's is
`table_merges.name`; null means the saved name. `POST /api/tables/:id/today/name` writes it
(`nameToday`, `apps/server/src/floor-today-name.ts`); a table in a group names the group. A name is
refused `table.label_taken` when, compared after `normalize("NFC")` and `toLowerCase()` in
JavaScript (`sameName`), it is the saved name of another table or the today's name
of another group or of another table on the map, spare or taken off; a group's own tables count as
other tables. Saved joined-group names remain reserved after a full split; a remaining group can restore its
saved name. A reset clears a table's name when it puts the table back (`todayValues`). A group's name goes
with its row when the group ends; a remaining group keeps it after a split. The room's print reads both columns, so a rename moves the revision.
Bills, receipts, kitchen tickets and MOVED slips, the expo board and pass screens, overdue orders
and the floor's party name read a table's shown name — its group's today's name, else its own, else
its saved name, a group's name once per party (`partyTableLabels` and `orderTableLabels`,
`packages/db/src/party-table-labels.ts`). A bill split off a party bill, or taken to the counter
from a party with no name, stores the shown names of that moment; an issued bill keeps the label it
was issued with. The closing party's `table_names`, the orders list and its table filter keep saved
names.

Back to its saved place puts a table at its reset row's place; on a table that needs moving it is
Mark moved (`backToSaved`, `apps/server/src/floor-today-store.ts`). Back takes the table out of
its merge first: in a merge of three the partners stay where they stand, and in a merge of two the
partner goes back to where it stood before the merge.

Measured on 2026-10-11, Node v26.7.0, after applying every manifest migration to `node:sqlite`:
`pragma_foreign_key_list` reports six incoming keys, all `ON DELETE NO ACTION`:
`party_tables.table_id`, `working_orders.delivery_table_id`, `floor_reset_tables.table_id`,
`floor_today_tables.table_id`, `floor_today_join_tables.table_id` and `bookings.table_id`.
Cascading here would allow removal to discard the records the release and refusal paths must
handle. The only trigger whose SQL names `dining_tables` is `parties_clear_table_status`.
**2026-10-19:** A757 slice 2 dropped `parties_clear_table_status` (core 0180).
**2026-11-12:** fk4 removes the `floor_today_tables.table_id` key: today's values now live on the table itself. The earlier measurement above remains historical.
**2026-11-13:** fk5 removes the membership and dormant split keys. The fully migrated
`table-removal.test.ts` inventory checks the four surviving keys: `bookings.table_id`,
`floor_reset_tables.table_id`, `party_tables.table_id` and `working_orders.delivery_table_id`,
all `NO ACTION`. Merge membership alone no longer blocks a direct table deletion;
`removeLiveTables` leaves the merge before deleting its live row.

> Added 2026-10-13 by A503 part 3: two more incoming keys, `floor_today_split_parts.joined_table_id`
> and `.part_table_id`, both `no action`.

A504's `0169_floor_tables_keep_no_place.sql` (core's old history, deleted with the frozen history on 2026-11-07, A1422; read a file with
`git show f519799de0:scripts/fixtures/a760-history/core/<file>`) rebuilt `floor_plan_tables`,
`floor_plan_table_sizes` and `floor_plans`; every venue needed a reset for it
(`scripts/migration-upgrade.test.ts` listed it under `RESETS` until A760 left that list empty). Measured on 2026-10-18, Node
v26.11.1, after applying every manifest migration through `useVenueDb`, by reading
`pragma_foreign_key_list` for every table: the keys pointing at `floor_plan_tables` are
`dining_tables.plan_table_id`, `floor_plan_placements.plan_table_id`,
`floor_plan_table_parts.joined_table_id` and `.part_table_id`,
`floor_plan_table_sizes.plan_table_id` and `floor_reset_tables.plan_table_id`; at `floor_plans`,
`floor_plan_placements.plan_id` and `floor_plan_table_sizes.plan_id`; at `floor_plan_table_sizes`,
none. All are `ON DELETE NO ACTION`. In that database no trigger's SQL names any of the three
tables; it holds no change feed, which `bootServer` installs.

**2026-11-12:** fk3 supersedes the saved-design side tables in that measurement.
Membership is stored on the design and reset rows, and kept sizes share placement rows.
The rebuilt protections are compared with fk3's base by `protection-list`.

Slice 5's rebuild uses `0137_floor_retire_drop_table_triggers.sql`,
`0138_floor_retire_old_table_columns.sql` and `0139_floor_retire_recreate_table_triggers.sql` in
core's old history. Every venue needed a reset for that change. Running
`pnpm exec vitest run scripts/migration-upgrade.test.ts` before adding its declared reset failed
with `NOT NULL constraint failed: __new_dining_tables.zone_id`; the same guard then passed with
that reset declared. In a disposable checkout, replacing the trigger drop with `SELECT 1;`
made it fail with `error in trigger parties_clear_table_status: no such table: main.dining_tables`.
The required zone is not the only reset reason. Measured on 2026-10-11 with Node v26.7.0,
applying core SQL through `0136` with foreign keys on, then applying `0137`–`0139` inside one
transaction: a zoned table with a `floor_today_tables` row failed with
`FOREIGN KEY constraint failed`. A zoned table with no child row upgraded; a separate control
that switched foreign keys off **before** the transaction upgraded and kept its today's row.
The generated `PRAGMA foreign_keys=OFF` inside the transaction did not let the first case
upgrade. Those controls establish the retained today's-row refusal; the six-key metadata
measurement above is separate. Saving master plans does not remove this reset requirement.

The schema guards passed 497 tests; `packages/db/src/schema/dining-tables.test.ts` also checks
that a zoneless insert is refused and only the eight kept columns exist.

## Permanent hierarchy deletion

You delete a zone or department permanently. Preview and Delete use the same impact rules, and
Delete recomputes that impact inside the one write transaction before changing rows. Open parties,
unpaid or uncollected deliveries, booked or seated bookings, open or placed orders, pending
transfers and affected ordering profiles can refuse the whole change. No live work is ended to make
Delete succeed. A successful hierarchy Delete clears its saved, today, reset and join floor state,
including tables with no today row and reset targets with no live table. Shared menus, venue dates
and holidays remain; owned routing, periods, opening overrides, transfer settings and service steps are removed.

Ordering profiles keep one department. A nonretired ordering profile bound to the department
refuses its deletion, even without an active device. Removing its only usable zone also refuses.
When a removed starting zone has a permitted survivor, its replacement follows the declared order.
Default department and counter-zone replacements use surviving configuration; deletion creates no
menu or zone. A deleted zone keeps its row and department, with its sale overrides and counter-default mark cleared. An explicit empty kitchen-screen parent stays empty, and Every stays Every, so
cleanup cannot widen access.

Deleted names become available for a new id. Current configuration reads and writes refuse the old
id; export omits deleted hierarchy and its owned settings, and import refuses deleted hierarchy
rows. Department receipt configuration and media remain available to internal printing, with no
configuration-editor access. Changing a default does not rewrite a recorded sale's department.
Fiscal, sales, issued receipt, order and line contexts, finished transfer and chain facts stay as
recorded. Terminal booking and delivery table pointers may clear with copied labels through the
existing floor release path. Individual table Delete still follows the master/today lifecycle above.

These limits follow the owner-approved
[A435 step 6 reconciliation](../superpowers/plans/2026-10-11-a435-6-tables-zones-departments-delete.md),
which gives the later floor design precedence over the original immediate-table Delete proposal.

## A read taken while ANOTHER caller's write transaction is open sees committed rows only

The store opens two connections per database file: the single writer, and a reader opened
`readOnly: true` beside it (`packages/store/src/index.ts` → `openReadConnection`). A statement goes
to the reader only while one of the store's own transactions is running AND the caller's
asynchronous context is outside THAT transaction's body — `packages/store/src/connections.ts` →
`forStatement`. A read written inside the body still sees the body's own rows, which is what a
transaction is for.

Two refinements the first implementation did not have, each with its own control below. The window
spans the whole transaction, `commit` and `rollback` included, not the body alone. And each body
carries its own TOKEN rather than a shared mark, because asynchronous context is inherited and never
expires.

**What it fixed.** The flip landed one connection per file and recorded the consequence rather than
hiding it: measured 2026-09-21 on Node v26.7.0, with a second connection to the same file as the
control, a read issued while the write lock held a transaction open returned that transaction's
rows — including a row a rollback then removed — where the second connection returned committed
rows only. It is reachable rather than theoretical: the
write queue holds the lock across the body's awaits, so the event loop serves other requests inside
that window.

**Why the rule counts the store's own bodies instead of asking the engine.**
`DatabaseSync.isTransaction` is the engine's own truth about whether a transaction is open, and
keying the routing on it reads as equivalent. It is not. Drizzle's migrator opens and closes its
transaction by RUNNING `begin`, `commit` and `rollback` as ordinary statements through the session,
never through the transaction shim, so every statement between them routed to the read-only
connection: the writes were refused errcode 8 and re-run on the writer, but `rollback` there is
refused `cannot rollback - no transaction is active`, errcode 1 — not the read-only refusal, so
nothing could route it back. Measured on the branch that built this: 54 of `packages/db`'s 65 test
files failed that way on 2026-09-23 — a reading of that day's tree, not a standing count — and the
case is now pinned as `keeps to the writer for a transaction opened as an ordinary statement`.

**Three exposures left open deliberately**, all recorded in `docs/backlog/architecture.md`. A transaction opened
by running `begin` is not one the store is told about, so a read concurrent with it still lands on
the writer and sees its rows. A write issued from outside a running body while one is open is
refused by the reader and re-run on the writer, where it joins that transaction if it is still open
and commits or rolls back with it — which is what one connection did, and nothing refuses it; in the
moment after the queue's `commit` and before the body has ended, none is open and the write commits
by itself. And `readOnly: true`
refuses a write to the database FILE rather than every write: measured 2026-09-23 on Node v26.7.0, a
`create temp table` succeeds on such a connection, because SQLite keeps a temporary table outside
that file.

**Two things the review wave found by RUNNING, and both were real.** The window first closed when a
transaction's BODY settled rather than when the transaction itself finished — the queue issues its
`rollback` after the body, and a handler registered on the body's own promise runs in that gap and
read the writer's still-uncommitted rows. And the asynchronous context first carried a plain "inside
a body" mark, which never expires, so a callback detached inside one transaction and settling during
a LATER one was read as inside that later one. Each is now a case in
`packages/store/src/index.test.ts`, and each fails when its fix is reverted.

The window fix is marked in TWO files, and it took a case each to pin them, because reverting one
alone left the other's case green. Narrowing the window in `packages/store/src/write-queue.ts` back
to the body alone reddens `sends a read registered on the write lock's body promise to the reader`;
narrowing it in `packages/store/src/node-sqlite-adapter.ts`, which marks a transaction taken
directly rather than through the lock, reddens
`sends a read registered on a direct transaction's body promise to the reader` — measured by
reverting that file alone, which fails that case on `expected [ { id: 1 } ] to deeply equal []` and
passes restored. The never-expiring mark is pinned separately: replacing the per-body identity set
in `packages/store/src/connections.ts` with a plain inside-a-body flag reddens the detached-callback
cases in `index.test.ts` and `connections.test.ts`.

**The routing cases are not all controls, and the set is weaker than its name.** Deleting the
routing outright — `forStatement` replaced by `return write;`, so every statement goes to the writer
— leaves `serves a read routed to the reader on a file with no tables in it` green: that case passes
whichever connection serves it, so it is a smoke test over the read path rather than evidence about
where a statement lands. Re-run that mutation before treating any single case in these files as a
control; what the other cases in the set catch is not what this one catches.

**The three shapes outside the rule, as the rule states them.** Each is stated at its site: a
transaction opened by RUNNING `begin`, a write issued from outside a running body, and a statement
that changes a CONNECTION rather than the file — a temporary table, an `ATTACH` of an existing
file or `:memory:` (one naming a missing file is refused, errcode 14 — measured 2026-10-07, Node
v26.7.0), a connection-scoped pragma — which a read-only connection does not refuse.

## A refused statement does NOT abort the transaction here, and all a savepoint still buys is confinement of a losing attempt's own writes

**This is the sentence in the file most worth getting right: a refusal leaves the transaction
usable.** A full disk sometimes ends the whole transaction, as `RAISE(ROLLBACK)`,
`INSERT OR ROLLBACK` and `ON CONFLICT ROLLBACK` always do: see
[A full disk sometimes ends the whole transaction](#a-full-disk-sometimes-ends-the-whole-transaction).
Measured 2026-09-22 on `node:sqlite`, Node v26.7.0, inside one `begin immediate`: a
duplicate primary key (errcode 1555), a null in a `not null` column (1299) and a trigger's
`RAISE(ABORT)` (1811) were each caught and the next statement ran normally, and at `commit` the rows
written before AND after every refusal were all present while the refused rows were not.
`bench/sqlite-failover/README.md` records the same codes from its own probe, plus 2067 for a
two-column `UNIQUE`. A `RAISE(FAIL)` leaves the transaction usable too, but does not back out its
own statement: measured 2026-10-21 on `node:sqlite`, Node v26.11.1, inside one `begin immediate`,
a three-row insert whose `before insert` trigger raised `FAIL` on the second row failed with
errcode 1811 and `isTransaction` still true, and after an insert of a fourth row and `commit` the
table held rows 1 and 4. Control, the same trigger raising `ABORT`: the table held row 4 alone.
The `FAIL` conflict algorithm does the same: measured 2026-10-21 on Node v26.11.1, `insert or fail`
of rows 1, 2 and 3 where 2 already existed failed with errcode 2067 and the transaction still open,
and after an insert of 4 and `commit` the table held 1, 2 and 4; a column declared
`unique on conflict fail` gave the same. Control, `insert or abort`: 2 and 4.

**So what a savepoint can still buy here is confinement, and the sites named below say whether they
need it.** Among the nested calls, `enqueueSuccessor` (`packages/payments/src/reconciliation-schedule/store.ts`), the two
`appendToChain` functions (`packages/fiscal-verifactu/src/chain.ts`,
`packages/workforce/src/chain.ts`) and `insertClose`
(`packages/reporting/src/record-daily-close.ts`) wrap a statement that may be refused in a nested
`tx.transaction(...)`, which the adapter emits as `savepoint` / `release` / `rollback to` whenever a
transaction is already open (`packages/store/src/node-sqlite-adapter.ts` — SQLite refuses a `begin`
inside a `begin`). What that buys is CONFINEMENT: a losing attempt's own partial writes are backed
out with it rather than left for the enclosing transaction to commit. In `enqueueSuccessor` and
`insertClose` the nested body is one insert, which SQLite backs out by itself when refused, so there
it confines nothing today. #581's review replaced `enqueueSuccessor`'s nested call with a bare
insert and reported `store.test.ts` and `store.concurrency.test.ts` passing, 24 tests, without
mentioning stubs. Re-run 2026-09-24 alongside the `insertClose` check below, the same replacement
gave 22 passed and 2 failed, because two stubs in `store.concurrency.test.ts` offer `insert` only
inside `transaction`; once those two stubs offered it outside too, all 24 passed. With
`insertClose`'s nested call replaced by a plain insert on `tx`, `@waitron/reporting`'s whole suite
passed (220 tests), and a probe run on that same modified copy refused a second close of the same
day inside a transaction that then committed and left the row count of every table unchanged, where
the control, a close for a new day, moved `daily_closes` from 1 to 2 — the table's only triggers are
its append-only pair, on update and delete (2026-09-24).

Since 2026-09-21 `withTransaction` ends every transaction with a drain of `change_log`
(`packages/db/src/tenancy.ts`). On this engine the drain is there for the change feed alone.

**The test corollary, and its REASON is gone.** A test for a refusal caught it around the whole
`withTransaction` call and never inside the callback, because inside, the expectation itself ran in
an aborted transaction. That reason is retired by the measurement above. Two test files had it the
other way round and were changed by hand on the branch that added the drain
(`packages/purchasing/src/operations.test.ts` and `packages/db/src/schema/join-requests.test.ts`);
they were not changed back, and no guard reads for the shape either way. Whether catching inside the
callback is now harmless has NOT been established, so the outside-the-call shape is still the one to
copy — as a habit whose receipt has expired, not as a rule with one.

### A full disk sometimes ends the whole transaction

Exceptions to the measurement above: a full disk sometimes ends the whole transaction, as
`RAISE(ROLLBACK)`, `INSERT OR ROLLBACK` and `ON CONFLICT ROLLBACK` always do (E13, E5). Measured 2026-10-21 on `node:sqlite`, Node v26.11.1,
macOS, for A798-B slice 1. The probe scripts were kept outside the repository; the plan lists them
and how each ran
([plan, "Measured for this plan"](../superpowers/plans/2026-10-21-a798-b-degraded-trading-build.md#measured-for-this-plan)).
The scripts ran as `node <script> <scratch dir>`; the Vitest probes as
`env -u AI_AGENT -u CLAUDECODE node_modules/.bin/vitest run --root <probe dir>` from the worktree,
importing its own `packages/store/src` and `apps/server/src`. A "page limit" below is
`pragma max_page_count` set just above the database's size.

**The engine at a page limit.**

- E1. `begin immediate`, one insert, then an insert past the page limit. Printed
  `errcode 13 | database or disk is full`, `isTransaction after error: false`; an insert after it
  `ok`; `commit: errcode 1 | cannot commit - no transaction is active`; `rows kept: ["after"]`. Had
  the full disk backed out only the statement, it would have printed `isTransaction ... true`.
  Control (E4), a unique refusal in the same shape: `isTransaction after error: true`, both rows
  kept.
- E2. The same inside a savepoint: `isTransaction after error: false`,
  `rollback to wt_sp_1: errcode 1 | no such savepoint: wt_sp_1`, `rows kept: []`. The failing case
  would have printed `true` and `rollback to … ok`.
- E3. Can a page limit be met at `commit`? With `cache_size = -65536` and `cache_spill = off`, so
  dirty pages stay in memory until commit, the insert printed `errcode 13` and
  `isTransaction after insert: false`. Had the limit been checked at commit, the insert would have
  printed `ok` and the commit `errcode 13`.
- E3b. More shapes: cache large, spill off, a 6-page headroom, rows of about 100 bytes inserted one
  at a time into an indexed table inside one transaction, in the `delete`, `wal` and `truncate`
  journal modes. Each printed `inserts before failure 111, failure errcode 13 | database or disk is
  full isTransaction false`. A `create index` inside a transaction at a 2-page headroom (WAL):
  `errcode 13`, `isTransaction: true`, then `commit: ok`. The failing case would have printed every
  insert `ok` and the commit `errcode 13`. **In every shape tried, a page limit was met at a
  statement, never at commit.** No other shape was tried.
- E13. Which full disks end the transaction. Each probe: `begin immediate`, an insert of `before`
  (in two of the three scripts), the filling statement at a 4-page headroom, then `isTransaction`.
  Every filling statement failed with errcode 13. For "a full disk always ends the transaction" the
  failing case would print `isTransaction true`, and some did:
  - **Ended** (`isTransaction false`; where checked, `before` not kept): an insert of a 64 KiB row
    into a plain table; the same into a table with a foreign key; with a `unique` column; an
    `insert … select` of three rows; an insert into a table whose only triggers refuse updates and
    deletes (the append-only shape); an insert with `on conflict do nothing`, and one with
    `on conflict (…) do update`, into a table with a unique index.
  - **Left open, only the statement backed out** (`isTransaction true`; where checked, `before`
    kept): a three-row `update`; an insert into a table carrying a `before insert` trigger whose
    `when` did not match; `create index` (E3b); an insert whose `after insert` trigger writes a
    64 KiB row to another table; and an insert of a 64 KiB row into a table carrying a trigger
    shaped like the change feed's (`after insert`, one small row into `change_log`; compare
    `packages/db/src/change-feed.ts`), in memory and on a WAL file.

  The change feed puts an `after insert` trigger on every change source at start, so by shape an
  insert into a change source on a running box is in the second group. That was read, not run on a
  real change-source table.
- E5. A trigger's `RAISE(ROLLBACK)`: `errcode 1811 | refused x`, `isTransaction after error:
  false`. `INSERT OR ROLLBACK` and `ON CONFLICT ROLLBACK` end it too, in SQLite's own words: the
  ROLLBACK algorithm "aborts the current SQL statement with an SQLITE_CONSTRAINT error and rolls
  back the current transaction" (<https://www.sqlite.org/lang_conflict.html>, read 2026-10-21; not
  run here). A grep of `packages` and `apps` for the three found them only in comments and tests.
  The record of E5 gives no failing case; it says only that the run matched the design's §12
  experiment 5.

**A real full disk at commit (E7).** A 4 MB HFS+ image (`hdiutil create -size 4m -fs HFS+`), the
database in WAL mode on it, cache large and spill off, a filler file leaving 16 KiB. Printed
`statement: ok (dirty pages held in cache)`, `commit: errcode 13 | database or disk is full`,
`isTransaction after commit attempt: false`, `rows on reopen: ["committed before"]`. Control, no
filler: `commit: ok`, both rows on reopen. A disk that fills at commit also ends the transaction
itself and keeps nothing.

**What the store did before slice 1.**

- E8, the write queue through `openVenueStore` (a temp folder, WAL, a page limit):
  - a body that let the error escape: the caller saw `cannot rollback - no transaction is active |
    errcode 1`, `sales: []` — the queue's own rollback hid the full disk;
  - a body that caught it and carried on: `caught: database or disk is full`, the caller saw
    `cannot rollback …`, and `sales: ["part 2"]` — **a statement after the failure committed by
    itself.** For slice 1's fix, the failing case is anything but `sales: []`. Control, a caught
    unique refusal: `sales: ["part 1","part 2"]`;
  - a nested `db.transaction(...)` that filled: the nested caller saw `no such savepoint: wt_sp_1`,
    the outer caller `cannot rollback …`, `sales: []`;
  - the outer body swallowed the nested failure, wrote a row, then opened another nested
    transaction: the caller saw `cannot rollback …`, and `sales: ["after nested","second nested"]`.
    With the engine's transaction gone, the adapter's `transaction()` opened a fresh top-level
    `begin`, which committed on its own;
  - the queue's own commit on E7's real full disk: `statement ok`, the caller saw `cannot rollback
    - no transaction is active | errcode 1`, then `next transaction: ok`.
- E9, a migration that fills: drizzle's migrator on a store at its page limit printed
  `caller sees: Failed to run the query 'ROLLBACK' | first engine failure in chain:
  {"errcode":1,"message":"cannot rollback - no transaction is active"}` and `filler table exists:
  0`. The migrator issues its own `ROLLBACK` after a failure. Read, not run: `runSet` in
  `packages/migrations/src/apply.ts` wraps any error carrying an engine failure as
  `migrations.apply_failed`, so that errcode 1 would reach the start as a failed migration, not a
  full disk; E9 printed only drizzle's error. The record of E9 gives no failing case.
- E14, a full disk that left the transaction open, through the same queue: a body inserted
  `before`, then a three-row `update` filled; the run rejected `database or disk is full | errcode
  13`, the next run was `ok`, and the table held `["a","b","c","next"]`, without `before`. Through
  `createWriteQueue` on a raw in-memory connection, with a `when`-guarded `after insert` trigger
  writing 64 KiB: `isTransaction right after the failure: true | after run: false`, `rows: []`,
  `next: ok`; the same trigger in a nested `db.transaction`: both callers saw `database or disk is
  full | errcode 13`, `sales: []`, `next: ok`. The failing case — the next transaction refused, or
  `before` kept — did not appear: the queue already rolled these back, so slice 1 changed only the
  error the caller sees there.

**What the store does now** (`packages/store/src/node-sqlite-adapter.ts`, `write-queue.ts`,
`connections.ts`, `disk-full.ts`; the cases are in `packages/store/src/disk-full.test.ts` and
`write-queue.test.ts`):

- Every result code 13 that reaches a statement through the store comes out as
  `AppError("storage.disk_full")`. Where drizzle wraps it, it is in the cause chain, which the
  error boundary and the start's classifier read: a route behind `createErrorBoundary`
  (`packages/server-kit/src/error-boundary.ts`) answers `507` with `storage.disk_full` unless its
  own status table names the code. The Stripe webhook (`apps/server/src/webhook.ts`) is not behind
  it: it catches its own failures and answers a bare `500` for any code outside its two client
  codes, a full disk included. A start that fails on one is classified
  `storage.disk_full` and has its own recovery-page text.
- When the writer had a transaction open before the statement and none after it, the store records
  that failure for its connection pair. While the record stands, a statement or a `transaction()`
  issued from inside a body throws the recorded failure without running.
- The write queue never rolls back a transaction the engine ended and never reports success for
  one. It hands back the failure that ended the transaction, even when the body caught it and
  returned, or went on to throw something else.
- A nested `transaction()` whose transaction the engine ended throws a fresh error — a new
  `storage.disk_full`, or an `Error` whose cause is the recorded failure — never the object its body
  caught, so code that compares failures by identity cannot mistake it for its own.
- A full disk that left the transaction open is recorded as nothing: code that catches it may carry
  on and what it writes afterwards commits; one that escapes is rolled back by the queue.
- A bare `rollback` issued outside any body after a statement ended the transaction throws the
  recorded failure. That is the migrator's path: its error is now drizzle's
  `Failed to run the query 'ROLLBACK'` with `storage.disk_full` as its cause, and the start classified
  it `storage.disk_full` (a run of the real `applyMigrations` and `classifyBootFailure` on a page
  limit, not of the whole start).
- Unchanged: a statement issued straight on the raw write connection, which only the store itself
  does, bypasses the refusal; and the checkpoint opens no transaction and keeps its old error.

**Weaker than the rule.**

- Slice 1 measured nothing on Linux's filesystems, which is what the box runs. Slice 2's engine-only
  probes on Linux tmpfs and ext4 in Docker did (F8 in the
  [slice 2 plan](../superpowers/plans/2026-10-21-a798-2-full-disk-at-start.md#measured-for-this-plan)):
  the commit failed with 13 and nothing was kept; never through the store, and never on a box.
- The commit point is tested here on a stand-in: a `Proxy` over a real in-memory connection whose
  `commit` runs the real `rollback` and then throws errcode 13. Through the old queue it printed the
  same lines the real disk image did (E8's last case). No page-limit shape TRIED met the limit at
  commit (E3, E3b). Since slice 2 a real disk meets it: the at-commit case in
  `apps/server/src/start-full-disk.e2e.test.ts` passes on a 32 MiB HFS+ image, and passed on a GitHub
  runner's 32 MiB tmpfs in that file's first CI run
  ([testing-guide.md](testing-guide.md#the-full-disk-start-tests-run-on-a-small-filesystem)).
- The change-feed shape in E13 was a copy of its trigger, not the feed itself.
- **The record of an ended transaction belongs to the connection pair, not to the body.** An
  outermost `db.transaction` opened outside the write queue, while a queue body's transaction is
  ended, clears the record, and that body's later writes are kept.
  Measured with a throwaway test through the store, each ordering after a queue body filled the
  disk and waited:
  - A, the outside transaction finished first (inserting `outside`), then the body inserted
    `part 2`: `outside txn: ok | part2: ran | run: Error: write queue: the engine ended this
    transaction before its body finished | rows: [{"body":"outside"},{"body":"part 2"}]` — the
    write kept, and the run rejected with the queue's generic error, not `storage.disk_full`;
  - B, the body wrote while the outside transaction was open, which then threw:
    `B outside: Error: outside body throws | part2: ran | run: resolved | rows:
    [{"body":"outside"},{"body":"part 2"}]` — the run resolved and the body's write was kept, and
    so was the outside transaction's own write, although its body threw.

  Not closed, because product writes go through `withTransaction` (`packages/db/src/tenancy.ts`),
  which runs inside `withWriteLock`.
  `/usr/bin/grep -rnE "\b(db|venue|database|store\.venue|deps\.db|target)\.transaction\(" packages apps --include='*.ts'`,
  less `*.test.*` files, re-run 2026-10-21 at `475d06c38`, found seven calls, every one under a
  `test/` or `src/testing/` folder — weaker than "none in product code": a receiver with another
  name is not matched. The backlog holds the ways to close it.

### A full disk stops the till's writes

Since A798-B slice 3 (#1950), one save refused for a full disk, or a start with less than 16 MiB free, stops every write the
till app and the kitchen screens send, except a short open list (below), until the venue folder
has 16 MiB free again. The owner chose this on 2026-10-21, following the design's §4.6 item 5:
every sale, order, kitchen send and clock-in is refused, even one whose own save would still fit. The decisions behind it are numbered in the
[slice 3 plan](../superpowers/plans/2026-10-21-a798-3-refuse-before-reader.md#decisions-this-plan-makes-that-the-spec-does-not).

**How the box knows.**

- Each of the venue folder's two database files tells its `onDiskFull` listeners when the engine
  refuses a statement, a write lock's `begin`, a `commit` or a `release` with result code 13
  ("database or disk is full"), before it throws `storage.disk_full` (`packages/store/src/index.ts`, the `onDiskFull` doc; the
  call is `Connections.refusal` in `connections.ts`). An error the store had already turned into
  `storage.disk_full` is not reported again. A full disk the engine reports another way (14, 4874,
  `ENOSPC`; see [A full disk is not one error code](#a-full-disk-is-not-one-error-code)) is not
  reported and does not start the stop.
- Boot keeps one `DiskFullState` (`apps/server/src/disk-full-state.ts`) for the venue folder, listens
  to both files, and reads the folder's free space once at start: under 16 MiB (`FULL_DISK_BYTES`,
  `apps/server/src/boot-failure.ts`), or while the spare's release marker exists
  ([The box's spare file](#the-boxs-spare-file)), the stop starts on; with no marker, a reading the
  filesystem cannot give leaves it off and logs `storage.start_space_unread` (`boot.ts`, after the
  long-lived open). While the marker exists the stop holds whatever the free space; it lifts only
  once the spare is back whole and 16 MiB is free.
- While the stop is on, a write the gate sees, each of the four sale routes and each card-reader
  payment reads the folder's free space before its first transaction. At 16 MiB or more, with no release
  marker, the stop is forgotten and the write goes on; under it, or unreadable, the stop holds. A reading does not clear
  the stop when another refusal was noted while it was in flight, even one noted after a faster
  reading had already cleared it. With the stop off, nothing is read: each of those checks awaits
  `full()` only while `since()` names a refusal, because the extra await would let another write's
  transaction get into the write queue ahead of a payment's first transaction (#1950;
  the in-flight cases in `placed-order-one-payment.test.ts` and `bill-payments.in-flight.test.ts`).
  A free-space deletion on the Box status page (`createSpaceFreer`,
  `apps/server/src/free-space-now.ts`) also reads it straight after deleting, so the stop can lift
  at once (A798-B slice 7).
- The free-space watch (`apps/server/src/free-space-watch.ts`, started by boot in trading mode)
  reads the venue folder's free space at start, then a minute after each reading finishes. While the
  stop is on, each reading also awaits `full()`, so the stop lifts within about a minute of 16 MiB
  being free (while the spare's marker exists, of 24 MiB: each reading writes the spare back before its own free-space reading,
  see [The box's spare file](#the-boxs-spare-file)), with no write. The watch never turns the stop on.
- Before that, each reading runs `lowSpaceBackupDeletion` (`apps/server/src/low-space-backups.ts`,
  A1167 slice 2), which under 2 GiB free deletes old backups toward 2.5 GiB (see
  [A backup run makes room for itself](#a-backup-run-makes-room-for-itself-or-is-refused-before-it-copies)),
  so the reading, the spare's write-back and the stop's re-check all see the room it made.
- Below 2 GiB free the watch turns on `storage.space_low`, shown in the bell to people with
  `system.manage`; it goes off only at 2.5 GiB or more. While the stop is on, the bell shows
  `storage.disk_full` instead (`storageAlertSource`, `apps/server/src/alert-sources.ts`). A signed-in
  dashboard asks for its alerts every 60 s, so the bell can lag the watch by up to about two minutes.

**What is refused, and where.**

- One gate per mount, `mountGatedWhileDiskFull` (`apps/server/src/disk-full-gate.ts`), on the three
  mounts the till and the kitchen screens write through: `mountTillApi`, `mountDeviceApi` and
  `mountScheduleApi`. It is put on the parent app route by route, for each `POST`, `PUT`, `PATCH`
  and `DELETE` under `/api/` that the mount registers, never as a `use`: in Hono 4.13.13 an
  `app.use` reaches every matching route registered after it, and a sub-app's middleware is copied into the
  parent as a catch-all that reaches every later route too, so either would refuse the dashboard's
  `/api/backup/*` and `/api/box/*` (the plan's M7 probes). A new write route on those mounts is
  refused by construction; only an open one is named. The gate answers
  507 `storage.disk_full` itself, before the route authenticates, and logs
  `storage.disk_full_stop_refused` with the route.
- Open on the till mount (`TILL_OPEN_WHILE_DISK_FULL`, `apps/server/src/till-api.ts`): sign-in,
  sign-out and the session's language, because a refused sign-out keeps someone signed in on a
  shared till and a refused sign-in keeps the next shift out; the four sale routes, refused inside instead (below); POSTs that save nothing
  of their own — the three checks for dishes whose kitchen station is closed or switched off
  (`/api/dead-ends/*`), four previews. A refused send-preview would turn into the till's
  generic table error and the round would never be sent, so the kitchen send itself is what is
  refused. Open on the device mount (`DEVICE_OPEN_WHILE_DISK_FULL`, `device-api.ts`): the device's
  own joining, zones, equipment, active profile and battery. The schedule mount opens nothing. Each
  open route still fails by itself, `storage.disk_full`, if its own save does not fit. Opening or
  closing a kitchen station for the day (`station-today-api.ts`, mounted inside `mountTillApi`) is
  refused.
- The four sale routes — `POST /api/sales`, `POST /api/pay`, `POST /api/working-orders/:id/collect`
  and `POST /api/working-orders/:id/payments` — refuse a new sale inside their first transaction,
  after their replay checks, so a resend of a sale or payment already recorded is still answered
  with what was recorded (`till-sale.ts`'s `runPayWorkingOrder` and `runCollectOrder`,
  `bill-payments.ts`'s `beginBillPayment`). On `POST /api/pay`, Pay again on a card already charged
  files the sale without asking the reader.
- A card-reader payment checks the stop three times: the free-space read before its first
  transaction; inside it, refused when that read said full or a refusal has been noted since; and
  after it commits, just before the reader is asked, refused when a refusal has been noted, undoing
  the first transaction's marks (`payIntegrated` in `till-sale.ts`; `takeReaderBillPayment` in
  `bill-payments.ts`). Writes take turns in the write queue, so a payment that read "not full" can
  wait behind another till's write that then fails.
- A card charged on a connected reader whose sale then fails for a full disk answers
  `507 sale.charged_not_recorded { workingOrderId, reason: "disk_full" }`, so the till can say not
  to charge again (`afterCardCharged`, `bill-payments.ts`). Only the till's two card routes ask for
  it (`sayCardChargedNotRecorded`, set in `till-api.ts`'s `POST /api/pay` and
  `bill-payments-api.ts`); every other caller, the dashboard's stuck-payment resolve route among
  them, still answers `storage.disk_full`. On those two routes the same 507 answers a card charged
  while the box's clock comes to read before 28 October 2024, with `reason: "clock_unusable"`
  (`apps/server/src/clock-behind-stop.charged.test.ts`). The same answer covers a charge whose capture the
  provider could not save: SumUp's and Stripe's `collect` throw `ChargeNotSavedError`
  (`packages/payments/src/charge-not-saved.ts`) when the processor reported the card charged and
  that save failed for a full disk, and the two routes translate only that error
  (`collectFailure`, `bill-payments.ts`). Its cause is the full disk, so every other caller still
  answers `storage.disk_full`. The provider's row stays `attempting` for a later pass to record the
  confirmed amount once space is available. A full disk on any other save inside `collect` still answers `storage.disk_full`; for the
  attempt's own first row, `card-charged-not-recorded.test.ts` pins it.
- Not gated: every route outside those three mounts, among them every dashboard route (the Box
  status page's free-space deletion, `POST /api/box/free-space`, is one, and is how a manager frees
  the disk), the print
  agent's routes (`print-api.ts`), the provider webhook and node enrolment; and the background
  duties. Their writes that do not fit fail by themselves and note the stop.

**The clock refusal beside it.** A sale under a clock reading before 28-10-2024 is refused
`clock.unusable { clockAt, offsetMinutes }`, thrown by the Veri\*Factu module through the fiscal
seat's `FiscalBackend.assertRecordableAt` (`packages/fiscal/src/backend.ts`). The server calls it at
the issue reading, `issueMoment` (`apps/server/src/issue-moment.ts`), whose clock every
`recordSale` call in `apps/server/src`, outside its tests and `src/testing/`, takes; before the
reader for a new sale (`payIntegrated`); and on every bill payment, cash included
(`beginBillPayment`). The function `refuseUntilRecordable` (`packages/fiscal-verifactu/src/clock-behind.ts`)
checks this rule, and the seat's
`refuseUntilRecordable` calls it, so each route that calls the seat, refunds and the dashboard's resolutions among them, refuses `clock.unusable` under such a
clock; the refund loops' check at the start of each pass (`refundsPaused`) and `clockStopsRefund`
(`apps/server/src/bill-refunds.ts`) ask `assertRecordableAt`, so under such a clock a pass asks the
provider nothing and an outcome the provider answers is not written
(`apps/server/src/tender-refund-recovery.test.ts`, "refund recovery under a clock before
28-10-2024"); and the chain's append (`attemptAppend`, `packages/fiscal-verifactu/src/chain.ts`) refuses
any record dated before 28-10-2024 (`chain.earlier-time.test.ts`). Run 2026-10-23 on a 2001 clock, on
`provisionBillVenue`'s venue: a tender refund, a bill payment's refund and a bill card payment each
answered `409 clock.unusable`, and neither refund reached the provider.

**Weaker than the rule.**

- Of the engine's refusals, only result code 13 notes the stop (`asDiskFull`,
  `packages/store/src/disk-full.ts`, called from `Connections.refusal`); one reported as 14, 4874 or
  `ENOSPC` leaves it off.
- SumUp saves the checkout's `client_transaction_id` after the checkout reaches the reader (T1.5,
  `packages/payments-sumup/src/provider.ts`); a full disk there answers `storage.disk_full` although
  the reader may still take the card. No test pins that answer. The on-device Stripe adapter and the simulator save a charge with no `ChargeNotSavedError`,
  so a full disk on that save answers `storage.disk_full` too.
- `apps/server/src/boot.disk-full-wiring.test.ts` checks the arguments boot hands the state,
  `watchForDiskFull` and the mounts, not a real full disk on a box.
- The window cases in `till-pay.disk-full.test.ts`, `bill-payments.refuse-before-reader.test.ts`
  and `till-sales.disk-full.test.ts` drive the stop by hand — a queued body that calls
  `noteRefused()`, or a scripted state whose `noted()` turns true on a given call — not by a second
  till whose save fails.
- The sweeps in `till-api.disk-full-gate.test.ts`, `device-api.test.ts` and `schedule-api.test.ts`
  send every write route of a mount built with test deps, so a route registered only in a
  configuration they do not build is never sent by them. They also pick
  routes by the gate's own verbs and `/api/` filter, so a route the gate's selection misses is
  missed by the sweeps too.
- A resend of a write the gate refuses — a write route of the three mounts that their open lists do
  not name — is refused like a new one (the plan's decision 26). Since #1949 that
  includes a counter Send pressed again after a lost reply: while the stop holds it is answered
  `storage.disk_full` and the till says the order was not saved, even when the first Send placed it.
- The gate refuses by verb, so a write inside a `GET` still runs, as with the read-only gate
  (`read-only-gate.ts`).
- The free-space reading counts bytes (`bavail` times `frsize`, `free-bytes.ts`), not inodes. A
  full-disk refusal on a disk with bytes free but no inodes left is noted, then cleared by the next
  free-space reading; the write that took it goes on, and fails by itself only if its own save
  cannot be written.
  Reasoned from the code, not run.

### A read on a full disk must not fail on its own housekeeping write

Since A798-B slice 6, reads that used to answer 507 `storage.disk_full` on a full disk once a
last-seen stamp was due now answer: the equipment read (`GET /api/device/equipment`, which carries
the till's staff notices, and answers with a change waiting too), and — when the route's own work
writes nothing and no change waits — `GET /api/till`, the other device-checked reads and every
non-passive session-checked read. Each had failed on a write it makes for itself, not on the work
it was asked for. The measurements are the slice plan's M2, M6 and M10
([plan](../superpowers/plans/2026-10-22-a798-6-device-strip.md#measured-for-this-plan)), taken on
a small real filesystem; the cases that now pin them are in
`apps/server/src/start-full-disk.e2e.test.ts`.

Since A798-B slice 7, four dashboard routes answer on a full disk too, with a change waiting or a
last-seen stamp due: the Box status read (`GET /api/box/health`), free-space deletion
(`POST /api/box/free-space`), both in `apps/server/src/box-health-api.ts`, and the bell's two alert
reads (`GET /management-api/alerts` and `GET /management-api/alerts/handled`,
`apps/server/src/alerts-api.ts`). The Box status page is how a manager frees the disk, and the bell
is how a manager learns it is full, so neither can be refused by its own housekeeping write. They
are described below under "The dashboard's full-disk reads".

Since A798-B slice 10, the managers' email check reads the venue's name, the managers' addresses
and the email settings in one `withWriteLock` turn with no drain (`readBoxEmailContext`,
`apps/server/src/box-alert-email.ts`), so the full-disk email can be prepared on a full disk. The
case is "the managers' email reads its context on a full disk with a change waiting" in
`apps/server/src/start-full-disk.e2e.test.ts`.

Since A1167 slice 1, a backup run reads the installation start in one `withWriteLock` turn with no
drain (`createBackupRoomHooks`, `apps/server/src/backup-deletion-alert.ts`), at most once a run and
only when free space is under the aim; a box whose fiscal seat has no `installationStartedAt` takes
no turn at all. Its case, "reads with a
change waiting in the change list and leaves it waiting" in
`apps/server/src/backup-deletion-alert.test.ts`, uses a waiting change, not a full disk.

Since A980 S2a1, the staff personal-data downloads (`GET /management-api/me/personal-data/export`
and, for an admin, `GET /management-api/staff/:id/personal-data/export`, both in
`apps/server/src/personal-data-export-api.ts`) read in two `withWriteLock` turns with no drain —
every other part, and the venue's name and privacy page for the README (the page since A980 S1b),
in the first, the caller checked again in the second after the files are built — and resolve the
session with `touch: false`, so they answer on a full disk with a change waiting. Since S2c, the
actions part (`apps/server/src/personal-data-actions.ts`) reads in `withWriteLock` turns of its own
between the two, while the files are built, also with no drain. The cases are "a person's own
personal-data download answers on a full disk with a change waiting", "an admin's personal-data
download of another person answers on a full disk with a change waiting, and writes nothing" and
"an admin's personal-data download of a person with a drawer opening looks its sale number up on a
full disk", all in `apps/server/src/start-full-disk.e2e.test.ts`. This is a stated exception to
one `withTransaction` per route.

Since A980 S3, an admin's invoice-customer search and download
(`GET /management-api/invoice-customers/personal-data` and its `/export`, in
`apps/server/src/invoice-customer-data-api.ts`) read in `withWriteLock` turns with no drain — the
search in one; the download in a first turn, which also reads the venue's name and privacy page for
the README (the page since A980 S1b), one turn per invoice and a last turn that checks the caller
again, with a turn of the event loop between them — and resolve the session with `touch:
false`, so they answer on a full disk with a change waiting. The case is "an admin's
invoice-customer search and download answer on a full disk with a change waiting, and write
nothing" in `apps/server/src/start-full-disk.e2e.test.ts`. This is a stated exception to one
`withTransaction` per route.

Since A980 S1b, `GET /management-api/google/config` reads the venue's privacy page through
`withTransaction`, so on a full disk with a change waiting it should answer 507, through the
change-log drain measured below (M2 under "What refused them", and M1 under "The dashboard's
full-disk reads", where a passive read answered 507 that way) and the error boundary's full-disk
status; this route was read, not run. The sign-in page, and the pages an email's link opens, then
show no privacy link, and the sign-in page offers no working Google sign-in. This is accepted: the
page's locales read and password sign-in already go through `withTransaction` there (the S1b plan's
decision 3).

Since A1127 slice 3, the full-disk bar's read (`GET /management-api/disk-stop`,
`apps/server/src/disk-stop-api.ts`) resolves the session with `touch: false` and reads in one
`withWriteLock` turn with no drain. The case is "the disk-stop read answers on a full disk with a
change waiting, for a cashier and a manager" in `apps/server/src/start-full-disk.e2e.test.ts`.

Since A1436, `authenticateAgent` (`packages/printing/src/agent.ts`) gives way the same way: when
the stamp's `withTransaction` is refused `storage.disk_full`, the row is read again outside any
turn, a row now gone or holding another token hash is refused, and the request goes on unstamped.
Cases: the "a print agent with a stamp due" group in `apps/server/src/start-full-disk.e2e.test.ts`
on a real full filesystem, whose revoked and re-keyed steps are refused before any stamp is
attempted, and "when the sighting write is refused" in `packages/printing/src/agent.test.ts`,
through a stand-in database, which is what reaches the re-check. The route's own work still needs
room: measured 2026-11-08, a `POST /print-api/agent/jobs` poll carrying a new or changed host name
answers 507 `storage.disk_full`, and no case asserts that.

**What refused them.**

- **The last-seen stamp.** A device-checked request writes the device's `last_seen_at` when a
  minute has passed since the last one (`sightingDue`, `packages/identity/src/device-token.ts`). On a
  full disk with a stamp due, the equipment read answered 507, and again on the next read (M6);
  `GET /api/till`, a session-checked read (`GET /api/working-orders`) and PIN sign-in all answered
  507 (M10). With no stamp due, the first two answered 200. Passive session checks skip the stamp,
  and were never affected by it.
- **The change-log drain.** `withTransaction` (`packages/db/src/tenancy.ts`) ends every body with
  `drainChangeLog`, which deletes the waiting `change_log` rows. When a change is waiting — a
  write made outside `withTransaction` leaves one, as the deployment-mode, singleton-role and
  node-membership writes do under a bare `withWriteLock` — a read-only `withTransaction` is refused
  `storage.disk_full` on a full disk. A write-lock turn holding the same read, with no drain,
  answers (M2).
- **A notice source that writes.** Inside one turn, a source that inserts anything takes the
  whole read down on a full disk, even when its savepoint is rolled back; in a turn of its own it
  takes down only itself (M2).

**The two changes.**

- **The stamp gives way to a full disk.** In `signInWithToken`
  (`packages/identity/src/device-token.ts`), which `readDeviceProof` (`device-session.ts`) and
  `authenticateAgent` share since A1439, when the stamp's `withTransaction` is refused
  `storage.disk_full`, the row is read again outside any turn under the same rule — a row now gone, or holding another token hash, is a miss — and the
  request goes on unstamped. In `requireSession` (`apps/server/src/till-session.ts`), when its own
  transaction (the stamp, or the change-log drain at its end; it writes nothing else) is refused
  `storage.disk_full`, the same checks run again outside any transaction with no stamp: the session
  lookup, the device's `active`, `authorize` and the profile's action. Every other error is thrown
  as before. Never the route's own work: a refusal from the route's transaction is not caught.
  Cases: "still signs in, unstamped, when the disk is full" and "refuses on a full disk when a new
  token is committed before the unstamped re-check" in `packages/identity/src/device-token.test.ts`,
  "a stamp refused for a full disk still authenticates, and saves nothing" and its siblings in
  `apps/server/src/device-session.test.ts`, and the cases from "a stamp refused for a full disk
  still answers the session" to "with room, a stamp due is saved" in
  `apps/server/src/till-api.test.ts`, through a stand-in database that refuses the stamp.
- **The equipment read reads in turns.** Its own reads open no `withTransaction` (the device
  check before them can, to stamp the last-seen time: `requireDevice`,
  `apps/server/src/device-session.ts`): the equipment is read in one `withWriteLock` turn (`device-api.ts`), and each notice source in a turn
  of its own (`readStaffNoticesInTurns`, `apps/server/src/staff-notices.ts`), with no drain; a
  source whose turn changes a row (`total_changes()` moved) is failed and rolled back. This is a
  stated exception to one `withTransaction` per route. Cost: one lock turn for the equipment and
  one per source on every read.

The real-disk cases: "the equipment read answers on a full disk with a stamp due" (200 twice,
stamp unchanged; after freeing the disk, 200 and the stamp moves); "the till's reads answer on a
full disk with a stamp due, and PIN sign-in still refuses" (`GET /api/till` and
`GET /api/working-orders` 200, stamp unchanged; PIN sign-in 507 with no session written); "the
notice reader answers on a full disk with a change waiting, and a source that writes fails alone";
and "the equipment read answers with the red notice on a full disk with a change waiting". They run
on macOS through `hdiutil` and in CI on a tmpfs, and skip on a Linux machine without
`WAITRON_FULL_DISK_ROOT` (see [testing-guide.md](testing-guide.md#the-full-disk-start-tests-run-on-a-small-filesystem)).

**The dashboard's full-disk reads (A798-B slice 7).** Measured for the slice
([plan](../superpowers/plans/2026-10-22-a798-7-box-status-page.md#measured-for-this-plan)), on the
small real filesystem: the existing `GET /api/box/status` answered `507 storage.disk_full` on a
full disk when the read was not passive (the session's last-seen write) and, with one row waiting
in `change_log`, when it was passive too (the drain at the end of `withTransaction`) (M1); and a
manager's session checked with `touch: false` outside any transaction, or inside `withWriteLock`,
answered `ok` there while the same check inside `withTransaction` was refused (M2). So:

- **The session check falls back once.** Each route checks the session in the usual transaction
  and, only when that is refused `storage.disk_full` (`diskFullIn`), runs the same lookup, status
  and permission checks again with no stamp: `authorizeSystemManager` in `box-health-api.ts`,
  outside any transaction, and the list reads in `alerts-api.ts`, inside one `withWriteLock` turn
  that also holds the read. Every other error is thrown as before, so an ended, expired or
  suspended session is refused on a full disk too, the Box status routes still refuse a person
  without `system.manage`, and the alert reads still show nothing to a person holding no alert
  permission.
- **The Box status read opens no `withTransaction`.** Its rows are read in a `withWriteLock` turn
  (`apps/server/src/box-health.ts`) and the staff notices through `readStaffNoticesInTurns`, as the
  equipment read does above. The fiscal outbox is read in a `withWriteLock` turn of its own, and a
  read there that changes a row is refused. Its failure is the outbox's alone: the answer carries
  `outbox: null` and `fiscal-outbox` in `noticesUnavailable`, and the failure is logged once per
  spell, as a notice source's is.
- **Free-space deletion writes nothing to the database.** It deletes files (below), then takes a
  fresh free-space reading so a full-disk stop can lift at once. Dashboard routes are not behind
  the till's full-disk gate (above, "Not gated").

Cases: "is left alone on a full disk, read or deletion, passive or not" and "answers the box's real
health read, passive or not, and leaves the change waiting" in
`apps/server/src/box-health-api.test.ts`; the "on a full disk" and "answered by the full-disk retry
alone" groups in `apps/server/src/alerts-api.full-disk.test.ts`, each through a stand-in database
that refuses the stamp or the drain; and, on the real small disk in
`apps/server/src/start-full-disk.e2e.test.ts`, "the box health read answers on a full disk with a
change waiting, passive and not", "a manager's ordinary alert read answers on a full disk with a
change waiting", "free-space deletion frees a rotated log on a full disk, and the stop lifts" and
"a supervisor is refused on a full disk". The fallback's own refusals (a supervisor, an ended,
expired or suspended session) are pinned by the "on a full disk" half of the `describe.each` in
`box-health-api.test.ts`, through a stand-in that refuses every write turn. On the real disk a
supervisor is refused before the fallback. Current runs use `WAITRON_REQUIRE_TEST_TOOLS=1` (env2, 2026-11-12); the following measurement keeps its original command. Measured 2026-10-22 on macOS with the harness's `hdiutil`
image: with `box-health-api.ts`'s fallback `return (await check(db, false)).authorizedBy;` replaced
by `throw error;`, `WAITRON_REQUIRE_FULL_DISK=1 pnpm exec vitest run
src/start-full-disk.e2e.test.ts -t 'a supervisor is refused on a full disk'` in `apps/server` still
printed `1 passed`, while the same run with `-t 'the box health read answers on a full disk'`
failed `expected 507 to be 200`. The refusal seems to come at commit, after the permission check
has already thrown (inferred, not isolated).

**Still refused.**

- Every other route's own `withTransaction`, read-only or not, while a change waits: its drain is
  refused. M10 measured it with no stamp due and one waiting change: `GET /api/till`, the
  session-checked read and PIN sign-in each answered 507, before and after the stamp change (which
  step refused was not isolated). That was the plan's prototype. On the shipped code,
  a real-disk probe on macOS (`hdiutil`) with one waiting change and no stamp due answered 507 for
  both `GET /api/till` and `GET /api/working-orders`. On the second, `requireSession` caught its
  own drain's refusal and its re-check passed, and the 507 came from the route's own
  `withTransaction` (`listHeldOrders`, `apps/server/src/working-order.ts`). `GET /api/till` takes
  no session check and opens its own `withTransaction` around `readTillSetup` (`till-api.ts`), the
  likely source of its 507 — read, not isolated. The control, with no waiting change, answered 200
  for both.
- PIN sign-in, from its own session write: a refused sign-in writes no session.
- While the disk is full, no device's last-seen time moves, so anything that reads it as a sign of
  life sees the device go quiet.
- A full disk the engine reports as anything but result code 13 is not `storage.disk_full`
  (`diskFullIn`, `packages/shared/src/engine-failure.ts`), so none of these fallbacks catches it.

#### Backup staging is touched only inside the staging turn

The turn is `apps/server/src/backup-staging-turn.ts`. A backup run holds the turn from its first
step to the end of its own clean-up (`runBackup`, taken by the sweep's `tick` in `backup-sweep.ts`); a free-space deletion takes it through `ifNoBackup`,
which answers `{ ran: false }` at once, and the deletion skips staging and says
`backupRunning: true`, while a run holds the turn or waits for it — a deletion never waits for a
run. A page's survey takes no turn: it measures staging best-effort and leaves it out while a run
holds the turn, so a refresh can never keep a press out. Why: deleting a file a process holds open
frees nothing until the file is closed — on the small disk, an unlinked 1 MiB file held open for
reading left free space at `0` until `close`, then `1048576` (the slice plan's M3) — so deleting a
dump a run reads frees nothing until the run closes it. It can also fail the run: `runOnce`
(`backup-sweep.ts`) archives the dump to a path in staging and then reads it back by that path to
pack the encrypted archive (read, not run). The start's sweeps (`freeSpaceAtStart` and boot's `emptyScratch`) take no
turn: they run while no backup supervisor is running in this process, before boot starts one or,
for the forced clean-up after a failed start (`node-entry.ts`), after the failed boot's unwind has
stopped it — stopping the supervisor aborts a run under way and waits for it to settle. Cases:
`apps/server/src/backup-staging-turn.test.ts`, and the turn shared with the backups in
`free-space-now.test.ts`, `low-space-backups.test.ts` and `boot.box-health.test.ts`. Guard: `scripts/backup-staging-touchers.test.ts`,
which allows `start-space.ts`, `backup-supervisor.ts`, `free-space-now.ts` and the layout module to name
`BACKUP_STAGING_DIR` or `"scratch/backup"`. The start sweeps through `SCRATCH_DIR`, which this
guard does not see.
A run's deletions of old backups to make room (`makeRoom`, `apps/server/src/backup-room.ts`) are
steps of `runOnce`, so they happen inside that run's own turn (A1167 slice 1). The free-space
watch's deletions of old backups (`lowSpaceBackupDeletion`, A1167 slice 2) take the turn through
`ifNoBackup`, so no run starts while they delete and they never wait for one.
`apps/server/scripts/cloud-backup-fixture.ts`, a development fixture, calls `runOnce` outside any
turn on its own scratch root; it is outside the guard's `apps/*/src` scan.

**What Box status's Free deletes.** Only what the box can make again: in
`<stateDir>/scratch/backup`, a staged dump (`STAGED_DUMP`, also its `.partial`) and a real folder
whose name starts `backup-encrypt-`; in `<logDir>`, rotated logs `waitron.log.<n>` with `n ≥ 2`,
so the current log and the newest rotated one stay; in `<logDir>/crash-reports`, a
`holder-frozen-*.json` older than seven days (`CRASH_REPORT_KEEP_MS`). Never the box's spare file
(see "The box's spare file"). The running deletion never touches other scratch working folders: only a start empties scratch.
It also skips symbolic links: a folder or an entry that is a link is skipped, because `rm` would remove only
the link and its size is not space freed. It also skips a configured backup folder: a `backup-encrypt-`
folder that is a `local-fs` backup destination's folder, or holds one, is skipped. The destinations
are read from the backup supervisor (`current()`) at every survey and every press, and compared both
as written and by real path (`realpath` of the deepest folder that exists), because a destination,
or the state folder, can be reached through a link. The path `lstat` judges is the path `rm` removes, and the
log folder is passed through `resolve()` first, which drops a trailing separator: a trailing
separator makes `lstat` describe a link's target, and `rm` of `link/` deleted the target's
files (the slice plan's M4). The staging folder is `join(stateDir, BACKUP_STAGING_DIR)`, which never
ends in a separator. The page's figure is the same set
summed without deleting (`surveyLeftovers`); a press runs `deleteLeftovers` through
`createSpaceFreer`, one at a time, and empties the disk-usage walk's cache afterwards
(`ttl-cache.ts`'s `clear()`), so the next read walks again. All in
`apps/server/src/free-space-now.ts`; the refusing cases are under "what the deletion must never
delete" in `free-space-now.test.ts`.

**Weaker than the rule.**

- The refusing cases name the files they plant (the venue's files, the state folder's, look-alike
  names, links, configured backup folders), not every file a box could hold.
- Free knows only the destinations the backup supervisor holds when it runs. While the box cannot
  read its backup settings, or after a settings reload could not open the venue database, it holds
  none (`backup-supervisor.ts`, `reload`; `backup-supervisor.test.ts`, "keeps archives off and
  reports the code when the settings could not be loaded", expects `destinations: []`), so a
  destination inside a `backup-encrypt-` folder is then deleted. Backup configuration and dashboard
  saves now refuse local destinations under scratch; startup also refuses venue and log paths there.
- The staging turn is in-process only. Another process writing backup staging is not kept out by
  it; the only other product writer found is the start, which a held venue folder stops (A978).
  Found by `grep -rn "BACKUP_STAGING_DIR\|stagingDir"` over `apps` and `packages`, not run.
- The guard reads text: a staging path built another way escapes it (`backup-sweep.ts` receives
  the folder as `stagingDir` and names neither), and it never checks that a listed file takes the
  turn. The sweep's `stagingTurn` is optional; boot passes it.
- `start-space.ts` still builds the log folder's paths without the `resolve()` that
  `free-space-now.ts` gained, so a log folder configured as a link with a trailing separator could
  let the start's clean-up reach the link's target. Read, not run.

### A full disk is not one error code

Slice 1 knows a full disk by result code 13, "database or disk is full". At start that is often
not what arrives: the disk fills while the start is opening files, and the engine and the system
then report the failure in other ways. Measured 2026-10-21 for A798-B slice 2 on macOS 26.6.2 and on
Linux in Docker (engine and filesystem probes only), Node v26.11.1
([plan, "Measured for this plan"](../superpowers/plans/2026-10-21-a798-2-full-disk-at-start.md#measured-for-this-plan),
which names each probe and how it ran):

- **13**, `database or disk is full`, on Linux tmpfs and ext4 at `begin immediate` on the existing
  `recovery.lock` and `venue.lock` (F2, F5, F11).
- **14**, `unable to open database file`, on HFS+ at the same two locks, at the database's open and
  at a plain read (F2, F5, F11).
- **4874**, `disk I/O error` (SQLite's `SQLITE_IOERR_SHMSIZE`, primary code 10): when the database
  is opened with a few KiB left, on HFS+, tmpfs and ext4 (F6, F11, F14); at the open on a full APFS
  disk that still reported about 1.2 MB free (F5); and at a read on a full tmpfs or ext4 (F5).
- **`ENOSPC`**, from the system rather than the engine: writing the venue lock's holder file with
  8 KiB left on HFS+ (F14), writing `recovery.json.tmp` (F2), and on APFS the rename onto
  `recovery.json` (F2).
- **APFS refused writes while reporting 1,228,800 bytes free** (F1), so "free space is zero" is not
  the test either.
- **14 also comes with plenty of room**: opening `recovery.lock` in a missing state folder, or in a
  folder this user cannot write that holds no `recovery.lock` yet (F12, macOS and Linux tmpfs with
  GBs free). The same unwritable folder already holding the lock gave 1544 (`attempt to write a
  readonly database`) and `EACCES`.

Which one arrives depends on the filesystem and on the step: F11 shows that on HFS+, with 4 to 16 KiB
free, the first-setup inspection's read-only open fails with 4874 and then the count and the venue
lock fail with 14.

**How the start names one.** `fullDiskFailure(error, freeBytes)` (`apps/server/src/boot-failure.ts`)
holds when `diskFullIn` does (13, or `storage.disk_full` already in the cause chain), whatever the
free space. Otherwise it holds only when the lower of the state and venue folders' free space is
under `FULL_DISK_BYTES`, 16 MiB, and the cause chain carries an engine result code whose primary
code (`errcode & 0xff`) is 10 or 14, or an `ENOSPC`. `classifyStartFailure` uses it to turn
`provisioning.database_unreachable` or `unknown` into `storage.disk_full`; a known `AppError` keeps
its own code. The start's write-back of its unchanged count uses it to decide whether to serve the
recovery page at once (`countWritable`, `apps/server/src/node-entry.ts`). The repair page's recover,
summary and start-again routes and its inspection read use it too (`diskFullOr`, and the inspection's own catch, in `apps/server/src/setup-first-fiscal-api.ts`). Why 16 MiB: every
full-disk failure measured happened with at most 48 KiB free on HFS+, tmpfs and ext4 (F6, F11, F14)
and with about 1.2 MB reported free on APFS (F1, F2, F5), and a missing folder raises 14 with room
to spare, so the clean-up floor of 256 MiB cannot be the test.

**Accepted risk** (the plan's decision 6): a missing or unmounted venue folder, an unwritable folder
(both 14), or a failing disk (the I/O family) on a disk that ALSO has under 16 MiB free is reported
as a full disk. Freeing space does not fix it, and the next start after space is freed reports it by
its own code.

`ENOSPC` is deliberately not in `diskFullIn` (`@waitron/shared`): that would change what every
route answers. `fullDiskFailure` names it a full disk at start, and on the repair page's recover,
summary and start-again routes and its inspection read (A1127, `diskFullOr` and the inspection's own catch in
`apps/server/src/setup-first-fiscal-api.ts`);
every other route behind `createErrorBoundary` whose failure is the system's `ENOSPC` still answers
`server.internal` (backlog).

Guards: the `fullDiskFailure`, `classifyStartFailure` and `startFailureCode` cases in
`apps/server/src/boot-failure.test.ts`, on stubbed errors and free space; and the refused-open rows
of `apps/server/src/start-full-disk.e2e.test.ts`, which on HFS+ failed with 14 at 8 KiB left and
4874 at 16 KiB. No real-disk case drives the `ENOSPC` branch: F14's `ENOSPC` at 8 KiB did not
repeat there.

## A refusal under result code 1811 is identified by its words

SQLite reports a delete refused by an `ON DELETE RESTRICT` key and a trigger's `RAISE(ABORT)` under
the same result code, 1811; only the message separates them. Measured 2026-09-27 on `node:sqlite`
(Node v26.7.0): a restricted delete reports 1811 with `FOREIGN KEY constraint failed`, and an insert
naming no parent reports the same words under 787 (both driven in
`packages/db/src/constraint-target.db.test.ts`). So `restrictRefused` checks the code and the
words on one layer, and it would also accept a trigger that raised exactly those words (none does
today).

The former canvas store (`canvas-store.ts`) and the profile store
(`packages/layouts/src/device-profile-store.ts`) had asked for 1811 alone. They gave the right answer only because one trigger sat on the device-profile path,
`device_profile_form_factor_locked`, whose meaning matched `device_profile.in_use`. That store now
matches it by its own words (`FORM_FACTOR_REFUSAL`, `packages/db/src/trigger-refusals.ts`).

Cost: the two layouts stores asked for the code alone, so a second refusing trigger on either path
would have been reported as `canvas.in_use` or `device_profile.in_use`.

2026-10-16: A182 part 2 retires the canvas store and its foreign key. The remaining profile store
keeps the named form-factor trigger refusal and incoming RESTRICT refusal; it rethrows other
foreign-key errors without attributing them to a canvas.

2026-11-14: the watcher cleared two exceptions, stated at `bill-request.ts` and
`dish-not-sent-alert.ts`, to retain their broad 1811 catches for statement-only recovery.
`RAISE(ROLLBACK)` still fails the payment (`till-api.unroutable-dish.test.ts`). Both read
`refusalCode` explicitly; `isRefusal` itself declines 1811, including mixed lists.

## One process per venue folder

**The rule.** Opening a venue folder (`openVenueStore`, and so `openVenueDatabase`) holds
`venue.lock` in it for as long as any open in the process is using the folder. A second PROCESS is
refused at once, before either database file is opened: `@waitron/store` (`lockVenueDirectory`,
`openVenueStore`) throws `VenueInUseError`, and `@waitron/db` (`openVenueDatabase`,
`lockVenueDatabase`) turns that into `AppError("provisioning.database_in_use", { database })`, the
code every caller outside those two packages sees. Opens inside one process share the hold, and the
last close gives it up. A tool documented to run beside
the server opens with `exclusive: false` and takes no lock. A command that changes the folder's files
(the cold restore, rejoin's wipe, the container start's clearing of set-aside folders) takes
`lockVenueDatabase` before its first change. The restart reset of in-flight AEAT submissions
(`apps/server/src/restart-reset.ts`) relies on one server process per folder.

**Verification-copy exception (2026-10-22, A1004).** `withVerificationVenueCopy` creates a fresh
scratch child and limits the watchdog exception to opens of that exact canonical directory in
its active asynchronous callback. Those opens still take `venue.lock`. An ordinary caller sharing
the directory starts monitoring before receiving its share; monitoring remains until the last
share closes. The callback must close its handles before returning, when the helper removes the
copy. See [backup verification](#backup-data-verification-has-a-separate-authority-boundary) for
the caller's process deadline.

**Litestream is a second process on `venue.db`, and it takes no lock.** While a primary streams its
copy to the owner's bucket, the server runs Litestream as its own child process
(`packages/stream/src/supervisor.ts`), and Litestream reads and writes `venue.db` without
`venue.lock`; it adds `_litestream_seq` and `_litestream_lock` tables inside the file and a
`.venue.db-litestream/` folder beside it (the last section of this file). It is only
ever started by the server that holds the lock, and the server's shutdown awaits its stop before
closing the store, closing the store even if that stop fails (`apps/server/src/boot.ts`).

**The mechanism: a SQLite transaction on an empty file, not a lock file.** `venue.lock` is opened
with `node:sqlite`, `pragma busy_timeout = 0`, and `begin immediate` is left open. It is the same
mechanism the migrator uses for `migrations.lock` (`packages/store/src/migration-lock.ts`).
`packages/migrations/src/apply.ts` records why an exclusively created file would not do: a crash
would leave it behind and refuse every later boot.

**Measured 2026-09-24, `node:sqlite`, Node v26.7.0, macOS 26.6.2 on arm64**, by a throwaway script
outside the repository. Each child process opened `venue.lock` with a zero busy timeout. What it
printed:

- While one process held `begin immediate` on the file, another process's `begin immediate` was
  refused `errcode=5 message="database is locked"`, in about 1.1 ms measured inside the child. A
  third connection's plain read of the file (`select count(*) from sqlite_master`) answered
  `{"n":0}`, not blocked. Control, same file with no holder: `acquired`.
- A second connection in the SAME process was refused the same way: `errcode=5 "database is
  locked"`. That is why the lock is counted per process rather than taken per open: the server opens
  its own folder more than once at a time (the backup supervisor's reload beside the long-lived
  store), and so do the restore and rejoin, whose migrate opens inside their hold.
- While held, the folder held `venue.lock (0B), venue.lock-journal (512B)`. The holder was killed
  with `SIGKILL`; both files were still there, and a new acquirer printed `acquired` at once. After
  that acquirer closed cleanly, only `venue.lock (0B)` remained.
- A holder that closed its connection with the transaction still open released it: before the close
  another process was refused `errcode=5`, after it `acquired`.
- **Never unlink `venue.lock`.** With a holder alive, unlinking `venue.lock` alone, or it and its
  journal, and then trying from another process printed `acquired` both times: the new file is a
  different lock, taken beside the holder. `apps/server/src/db-wipe.ts` records the same for
  `migrations.lock`.
- A `venue.lock` that is a DIRECTORY is refused by the constructor with errcode 14, `unable to open
  database file`, which the lock passes on as it came rather than reporting it as in use.

**That is macOS, and the box runs Linux.** The store suite's "does not stay locked after the holder
is killed" case (`packages/store/src/venue-lock.test.ts`) runs in CI on `ubuntu-latest`; that run is
the Linux reading, not this paragraph.

**Why the migrator's lock cannot serve.** It is held only while migrations run and then released, and
it WAITS (up to two minutes, `LOCK_WAIT_MS`) for another migrator, where a second server has to be
refused at once. Held for the life of the process, it would make that process's own later migrate
wait on itself, because a second connection in one process is refused (above). So the two files
nest: `applyMigrations` takes `migrations.lock`, then opens the store, which takes (or shares)
`venue.lock`.

**And why the migrator's lock is still needed beside it.** Measured 2026-09-24, same machine: two
processes each running only `applyMigrations` over every manifest set, started together on one fresh
folder, ten races, the two start-to-end windows overlapping in every race. With the lock as shipped,
all twenty runs printed `ok`, and the folder afterwards held 122 tables and 29 journal rows across 13
journal tables — the same as one migrator run alone. With the migrator's `begin immediate` removed
(a temporary edit, reverted), one process of every pair was refused
`provisioning.database_in_use`. So `migrations.lock`, taken first, is what makes the second migrator
WAIT for the first instead of being refused by the first's open. It does not help when the first
process keeps the folder open after migrating, as boot does with its long-lived store: in a race of
two processes that each migrated and then opened the folder again, one of the pair was refused in 9
of 20 races, which for two servers is the point. Guard: the "two real migrating
processes" case in `packages/migrations/src/apply.concurrency.test.ts`, whose two child hosts run the
real `applyMigrations`; with the migrator's `begin immediate` removed it fails with one host refused
`provisioning.database_in_use`. The file's older peer case holds `migrations.lock` alone and never
opens the store, so it could not see this.

**Who holds it: the holder file.** The first take of a folder in a process writes
`venue.holder.json` beside `venue.lock`, in the same synchronous step as the lock
(`packages/store/src/venue-lock.ts` → `beginHolding` in `venue-liveness.ts`). It names the holder's
`kind` (`server`, `restore`, `rejoin`, `provisioning`, or `script` for anything that did not name
itself), `pid`, `host`, `lockedAt` and `heartbeatAt`. A main-thread timer rewrites the heartbeat
every 5 s, and the last release removes the file before it lets the lock go. A program names itself
with `setVenueHolderIdentity` (`packages/db/src/venue-holder-identity.ts`), which also gives its
watchdog the report folder, the log file and the version. These do: the server (`apps/server/src/bin.ts`
and `node-entry.ts`), restore and rejoin (`bin-restore.ts`, `bin-rejoin.ts`, through
`apps/server/src/holder-identity.ts`), and the provisioning command (`packages/provisioning/src/bin.ts`).
The development and demo scripts under `apps/server/scripts` name nothing and report `script`, and
nothing checks that a new entry point names itself. `waitron-break-glass` and `waitron-credentials`
open the folder with `exclusive: false`, so they take no lock and write no holder file. A holder that
dies leaves its file behind; the next holder overwrites it.

**Every start empties scratch under the venue lock; the holder note decides only when taking
that lock fails for another reason.** `freeSpaceAtStart` in the box's entry and `emptyScratch` in
`bootServer` delete every entry in `<state>/scratch/`, keeping the root. Backup staging is
`scratch/backup`; restore staging is `scratch/restore`. Stream restores, staged-restore entries,
setup holdings copies and node copies also live below scratch, except a spare's first copy and an
admitted mirror's selected handover backup, which wait in `<state>/pair-copy/` across the restart
that places them (`spare-copy.ts`, `handover-copy-from-backup.ts`). The root is never followed when
it is a symbolic link. Both sweeps run before this process starts its backup supervisor.
The staged-recovery
folder is where the setup wizard's recovery step (`stage` in `createSetupRecoveryPreparation`,
`apps/server/src/recovery-preparation.ts`) keeps the uploaded backup it is checking as a decrypted
venue database, with a working copy of it, one backup at a time: staging another deletes the one it
replaces once nothing reads it. The others are a restore's or a backup check's own, removed when it
ends. Every process that makes one holds the venue folder from before it makes it until it is done
with it, so a start that holds the folder finds only what a killed run left: the server, whose store
takes the lock in `bootServer` (`apps/server/src/boot.ts`), where the long-lived `openVenueDatabase`
comes before the only call of `createSetupRecoveryPreparation`; the restore command, from resolving
its target to its exit (`resolveRestoreTarget`, `apps/server/src/restore-command.ts`); and a staged
restore, from just after its start-again check until it returns (`runStagedRestore`,
`apps/server/src/restore-request.ts`), which the box's entry runs before it takes its own hold. On a
box, only the server runs a backup (`BackupSupervisor`, started in
`apps/server/src/boot.ts` after its store has taken the lock), so while a backup is writing
staging, the start is refused. With no venue folder it deletes without the lock, because taking it
creates the folder. Each maker above creates the venue folder before its first working folder, so
the start lists scratch entries first and deletes them only if the venue folder is still missing
after the listing; the case "keeps the working folder of a restore that makes the venue folder after
the start found none" in `apps/server/src/start-space.test.ts` holds that order.
Measured 2026-10-21, Node v26.11.1, macOS, on the 32 MiB HFS+ image `apps/server/src/testing/full-disk.ts`
makes, with a second process holding `venue.lock` by `begin immediate`: `lockVenueDatabase` was
refused `provisioning.database_in_use` with 0, 4 KiB and 16 KiB left. The control, with no other
holder: 0 left failed with `ENOSPC` opening `venue.holder.json.partial` (one earlier run:
`unable to open database file`, errcode 14); 4 KiB left failed in one run and took the lock in a
review rerun; 16 KiB left took the lock. On that image, then, a full disk did not cost a running
server its staging, as the heartbeat-only check did (the slice 2
plan's decision 5). Any failure other than that refusal falls back to the heartbeat: the copies stay
while the holder file is fresh. There the old limits stand: on a full HFS+ filesystem the heartbeat
rewrite failed with `ENOSPC` and the file kept its earlier `heartbeatAt` (F13 in the
[slice 2 plan](../superpowers/plans/2026-10-21-a798-2-full-disk-at-start.md#measured-for-this-plan)),
and a holder that died less than 30 s before keeps them until a later start. Guards: the
lock cases in `apps/server/src/start-space.test.ts` and `node-entry.full-disk.test.ts`.

**Two limits, on purpose.** A start refused `provisioning.database_in_use`
(`apps/server/src/node-entry.ts`) reads the file with `readVenueHolder` and `/health` with
`readVenueHolderAsync`, one parser behind both, and both call the
heartbeat stale at 30 s (`VENUE_HOLDER_STALE_MS`). A stale, missing or unreadable file makes the
refusal count toward the recovery page, as `provisioning.database_holder_stalled`; a fresh one puts
the count back. The holder's own watchdog kills it only after 120 s without a main-thread tick
(`WATCHDOG_KILL_MS`). The gap is for synchronous work that stops the timers without anything being
stuck: `VACUUM INTO` of a 2.3 GB database took 2412 ms and `wal_checkpoint(truncate)` 32 ms (Node
v26.7.0, macOS, NVMe). A box on slower storage could come near 30 s, and killing a backup in the
middle every cycle is worse than a stuck holder living 90 s longer.

**The watchdog, and how the stack is read.** One `worker_threads` worker per process watches a
tick the main thread stamps every second. After 120 s without one it connects to the main thread
through the inspector (`Session.connectToMainThread`, `Debugger.pause`), waits up to 2 s for the
paused frames, writes one line to standard error (and to the log file it was given), writes a JSON
report file to the directory it was given, and sends the process `SIGKILL`, which releases the lock
like any other death. Experiments, 2026-09-24, Node v26.7.0, macOS, against a deliberately frozen
process:

- The inspector route printed the frozen function for a `while (true) {}` and for an
  `Atomics.wait`. For a long synchronous `node:sqlite` statement and a blocking read of a FIFO it
  got no paused frames in 2 s, and the process was killed without a stack.
- `process.report.getReport()` called in the worker reported the WORKER's own stack, and included
  31 environment variables although the main thread had set `excludeEnv`.
- `reportOnSignal` with the worker sending `SIGUSR2` to its own process wrote no report within 2 s
  while the main thread spun.
- A worker's `console.error` is relayed through the main thread, so it never printed while that
  thread was frozen; the worker writes to file descriptor 2 directly.
- Control: a main thread awaiting a 4 s timer was not killed.

The report file holds exactly `code`, `stack`, `kind`, `pid`, `host`, `lockedAt`, `lastTickAt`,
`killedAt` and `version`: no environment, no command line, no venue data. The programs that
name themselves put these files in `<logDir>/crash-reports`, where `<logDir>` is `WAITRON_LOG_DIR`,
else `logs` under the state directory, an empty value counting as unset (`resolveLogDir`); on a box
that is the `logs` volume. The provisioning command has no state-directory default, so with neither
variable set it writes no file, and neither does a program that did not name itself: both write the
line to their own error output only. The recovery page reads only `waitron.log`.

**`recovery.json` has a lock of its own.** Every change to the recovery count (the count before a
boot, the start's write-back of an unchanged count below the free-space floor, the classified failure, a refused start's undo, the stayed-up clear, the recovery page's
retry, the append-only check's refusal while trading) is one read and one write while holding `recovery.lock` in the state folder
(`apps/server/src/recovery-lock.ts`). It is the same `begin immediate` technique, but it polls
instead of setting a busy timeout, because the engine's busy wait stops the whole thread: a second
connection in one process with `busy_timeout = 1500` blocked for 4093 ms with a 50 ms timer firing 0
times. Never unlink `recovery.lock` either. Guard: `apps/server/src/recovery-race.test.ts`. Each
of its races but the undo-after-clear one runs real child processes twice: with the lock, where no write is lost, and with the
lock held around the write alone, where the test requires that a write IS lost — another start's
counted failure in the counting races, the running server's clear in the clear-versus-undo race.
That second run is what shows each schedule races at all. The lock around the write stays in it because two writers
without one clash on `recovery.json.tmp` and crash, which is not the failure being tested.

The lock orders the writes; it does not decide what a refused start's undo takes off. For that,
`recovery.json` carries `clears`, how many times the count has been cleared, and every clear (the
stayed-up clear and the recovery page's retry) moves it on by one. An undo whose own count was made
before the latest clear takes nothing off, because the clear already removed it; without that, a
start refused after a clear took off the failure a later start had counted
(`apps/server/src/recovery-state.ts`, `withoutAttempt`). The undo-after-clear race in the same file runs that
schedule once, with the lock, in separate processes; against the code before `clears` existed it
ended with a count of 0 where 1 is right.

**What the guard does not see.** `packages/store/src/venue-lock.test.ts` proves the lock itself. It
does not prove that every caller that should take the lock does: a new caller passing `exclusive:
false` wrongly, or a new command that changes the folder's files without `lockVenueDatabase`, is seen
by nothing.

Every change to `recovery.json` goes through `updateRecoveryState` under `recovery.lock`. Its guard,
`apps/server/src/recovery-race.test.ts`, is weaker than its name in the same way: it proves the
lock, not that every writer of the file takes it.

**Every caller, and what it does** (from `grep -rln "openVenueStore\|openVenueDatabase"` over `apps`,
`packages`, `scripts` and `bench`, non-test files, 2026-09-25):

| Caller | Runs | Decision |
| --- | --- | --- |
| `apps/server/src/boot.ts` | the server | locks up to six times in turn: placing a spare's first copy (`placeFirstCopy`, `apps/server/src/spare-copy-placement.ts`, with a node identity and a first copy waiting), placing a handover's accepted copy (`placeAcceptedCopyForStart`, `apps/server/src/handover-place-copy.ts`, with a node identity and an existing `node.db`), the stamp probe, the pre-migration trigger read (`missingBeforeMigration`, `apps/server/src/append-only-watch.ts`), the migrate, and the long-lived store, which holds it until the server closes or its start fails. Between them the folder is briefly free, unless the container entry (`node-entry.ts`) started the server: its hold covers those gaps |
| `apps/server/src/backup-supervisor.ts` (`reload`) | inside the server | shares the server's hold |
| `apps/server/src/node-entry.ts` (`clearReplacedDatabases`, `assertNotAhead`) and the staged restore and staged reset it runs | the container entrypoint, the same process as the server | the staged restore, then the staged reset, each locks on its own and releases before `runEntry` takes `lockVenueDatabase`; the staged restore takes `lockRestoreTarget` just after its start-again check, before it makes a working folder or changes anything, and its placement (`writeValidated`) shares that hold. `runEntry` then takes `lockVenueDatabase` and holds it from clearing set-aside folders (`clearReplacedDatabases`) through the ahead check until `startServer` settles or an earlier step throws (on a box that waits for its peers, `startServer` returns as soon as the waiting start is listening, before the wait ends, and the open store holds the folder for the rest of the start). The ahead check's opens and the server's opens during its start share that hold |
| `apps/server/src/upgrade-checks.ts` and the shared `upgrade-schema-check.ts` | one contained candidate check per process; not wired to an installed upgrade command yet | after the read-only first-setup checks, holds `lockVenueDatabase` across the ahead/deployment checks, migrations and data readers; every temporary database open shares it and closes before the outer hold is released. The shared ahead helper is also the ordinary entry's preflight |
| `apps/server/src/restore.ts` (`writeValidated`) | `waitron-restore` (server stopped) and the staged restore | takes the lock before its first change and holds it to the end; its migrate and hook open share it. Refused while another process holds the folder |
| `apps/server/src/restore-stream.ts` (`refuseIfArchiveSourceLive`, and `readRestoredCopy` inside `prepareStreamRestore`) | `waitron-restore`, before `writeValidated`; and the setup-mode server before it stages a restore (`boot.ts`): `refuseIfArchiveSourceLive` for `/setup-api/restore` and `/setup-api/cloud-recovery/restore`, `prepareStreamRestore` for `/setup-api/restore-bucket` | each opens validation's private archive database or the prepared download (`stream-restore-XXXXXX`), never the destination venue folder; archive validation owns and disposes its private directory. In `waitron-restore` these run under the restore command's own hold on the destination venue folder (`restore-command.ts`, `resolveRestoreTarget`), taken after the start-again check and before the first-setup check and kept until the command exits, so a server holding the folder refuses the command before it downloads or decrypts anything, and `writeValidated`'s take shares that hold |
| `apps/server/src/reset-request.ts` (`runStagedReset`) | the container entrypoint, when the setup wizard has staged a reset, before the server starts | takes `lockVenueDatabase` before its first check and holds it through the wipe; its `openVenueDatabase` for the check shares that hold, and it releases before `runEntry` locks again |
| `apps/server/src/rejoin-command.ts` | `waitron-rejoin` (server stopped) | takes the lock before its first read and holds it through the wipe and re-migrate. Refused while another process holds the folder |
| `packages/migrations/src/apply.ts` | boot, restore, rejoin, dev scripts | locks (default), inside its own `migrations.lock` |
| `packages/provisioning/src/bin.ts` (`waitron-provision venue`) | once per venue | locks; refused while another process holds the folder, printed as `provisioning.database_in_use {"database":…}` |
| `apps/server/scripts/dev-setup.ts`, `dev-onboard` through `applyMigrations` | before a dev server starts | locks; refused while another process, such as a dev server, holds the same folder |
| the dev server, `tsx watch` (`apps/server/scripts/dev-server.mjs`) | development | locks, as the server does. A restart waits for the old process's `exit` event before starting the new one: `killProcess` in `tsx@4.23.13`'s `dist/cli.mjs`, read, not run |
| `apps/server/src/break-glass-command.ts` | beside the server (`deploy/README.md`) | `exclusive: false` |
| `packages/credentials/src/bin.ts` | beside the server (`apps/server/README.md`: credentials are read fresh every pass, no restart) | `exclusive: false` |
| `apps/server/scripts/cloud-backup-fixture.ts` `capture` | the Cloud repository's local-backups runner (`test-local-backups.mjs` in its scripts folder), while the fixture server on the same folder is still running (it stops the servers only after every capture: read, not run) | `exclusive: false` |
| `apps/server/scripts/cloud-backup-fixture.ts` `restore` | the same runner, on a fresh folder with no server (read, not run) | locks (default), through `writeValidated`, then its own open |
| `apps/server/scripts/cloud-capture-client-fixture.ts` (`schedule`), `cloud-recovery-client-fixture.ts` (`restore`, `prepareReplacement`, `statusReplacement`) | Cloud's integration runners, on a folder under the system's temporary directory; whether a server holds the same folder at that moment was not checked | locks (default); the recovery fixture's `restore` also locks through `runStagedRestore` first |
| `apps/server/scripts/cloud-integration-fixture.ts` | Cloud's runners start it as the server; a restart waits for the old process to exit before relaunching on the same folder (`stop` awaits the child's `exit` before `launch`: Cloud's runner scripts, read, not run) | locks (default); its first open runs before `startServer` in the same process |
| `apps/server/src/fiscal-readiness-runner.ts` | its own directory | locks; no contention |
| `apps/server/scripts/testing/venue.ts`, `useVenueDb` | their own temporary directories | locks; no contention |

**First-setup entry, 2026-10-16:** `apps/server/src/first-setup-entry.ts` inspects an existing claim
through a read-only SQLite connection before the ordinary entry path. Its admission callback holds
the venue lock and rereads setup/database admission before normal boot; since A1042 (2026-10-25)
there is no first-setup workspace, so no second lock and no selection to reread. An ordinary
unclaimed box keeps the locking path in the table above. `first-setup-resolution.boot.test.ts`
removes the database after discovery and checks that the callback refuses without creating a
database ("rechecks the unfinished database after taking the startup locks"). The same suite checks direct, supervised and already-recovery entry.

**First-setup durable replay, 2026-10-16:** on Node v26.11.1, the new
`first-setup-resolution.durability.test.ts` left an applied record visible after injecting a
directory-sync failure; retry returned it without another sync. The renamed-backlink and final
selection cases in `first-setup-workspace.test.ts` reproduced the same early success (dated
pointer, 2026-10-25: those cases went with first-setup workspaces in A1042; that file now holds
only the refusal of an earlier layout). Replays now
sync the existing record or witness directory before returning. The resolution suite also injects
write, file-sync, rename and directory-sync failures into original chunks, manifests and both
action phases, then resumes through a new store and compares retained bytes. These are filesystem
fault injections, not physical power-loss measurements. (Dated pointer, 2026-11-08: that store and
its durability suite were removed by A1379.)

**First-setup password recovery audit:** removed on 2026-11-08 by A1379, with the resolution record store it described.

`deploy/waitron.sh` reads the stamp from `venue.db` with its own read-only `node:sqlite` connection,
not through the store, so it takes no lock and is never refused.

### A failed start undoes what it started, and gives the folder back

The cost: a start that failed after boot's long-lived open left the venue store open, and with it
the folder's `venue.lock`, held by a process that would never serve. Reproduced (lane A's A39,
2026-09-26) for an unreadable pending-adoption file, an empty fiscal slot, and an unreadable
certificate on an adoption-pending start and on a trading start. The review of that fix then found
the tunnel and the listeners still running after a failed start. So each step `bootServer`
(`apps/server/src/boot.ts`) starts pushes its stop onto `undoOnFailure`, and `startServer` runs
them newest first when the body throws, then re-throws. Two deletions, run 2026-09-26 against
`apps/server/src/boot.failed-start.test.ts`: without the tunnel's undo, the fake relay still
counted one connection open after the start had failed (`expected 1 to be +0`); without the trading
listener's undo, binding its port afterwards failed with `EADDRINUSE`.

What that suite does not see, each run the same day: with `.reverse()` dropped, so the store closes
FIRST, all eleven cases still pass, while the background loop's card sweep logged
`resolve_pending.failed` with `database is not open`; removing
`await loop` or `liveEvents.close()` from the undos still passes; and the setup, adoption-pending
and throwing-undo cases close a listener that has not bound yet — its close reports
`ERR_SERVER_NOT_RUNNING`, which the unwind drops — so only the trading and tunnel cases close a
bound one.

7 November 2026: A951-S removes the old TCP relay and its failed-start connection case.
The tunnel deletion controls above describe the historical client. Current listener and
change-feed cleanup remain covered by `boot.failed-start.test.ts`.

On 2026-10-03, W3 added failed-start cases for a rejecting cloud worker and a throwing change-feed
unsubscribe. Against the changed suite, removing `.reverse()` timed out in the trading and cloud
cases, and removing `liveEvents.close()` failed its assertion. Removing `await loop` still passed
all 15 cases. The 2026-09-26 deletion results above describe the suite as it stood then.

On 2026-10-17, A764's independent card loop exposed an early close in the secondary boot and
promotion tests. A real `node:http` listener on Node v26.11.1, closed immediately after
`listen(0, "127.0.0.1")`, reported `ERR_SERVER_NOT_RUNNING` and remained stopped after an event-loop
turn. `closeListener` now accepts that result; its real-listener regression failed before the
change, and its other-error checks remain. Boot retains an actual bind failure and reports it
from shutdown; the existing address-in-use and unknown-host shutdown checks remain unchanged.
The pending-card failed-start test also holds the loop
after abort: removing its specific `await pendingCardLoop` now fails. This does not establish that
the suite catches a missing wait for every other duty.

The landing listener, started last, is the one step not on the list.

On 2026-10-22, A696's `boot.failed-start.test.ts` case “aborts and awaits a started cloud
worker when snapshot initialization throws” failed with an un-aborted worker signal. Cloud
undos were registered only after all three initializers returned. Each now registers its own
abort-and-wait immediately; restoring the earlier registration block in an installed disposable
checkout reproduces that assertion failure. The complete failed-start file passes 31 cases.
This receipt covers that initializer boundary, not every possible duty failure.

**What the guard does not see.** `apps/server/src/boot.failed-start.test.ts` is weaker than its
name — it covers only the duties it names, so a new one that forgets is seen by nothing. Removing
`await loop` still passes, so not every stop is proven to finish before the store closes.

## A box that joined another holds that venue's authority as its own, and both resets remove it

**The rule.** When a spare joins a main box, `adoptFromPrimary` (`apps/server/src/adopt.ts`)
first writes `tls/joined.json` (`TLS_JOINED_FILE`, `packages/store/src/state-layout.ts`), holding
the main box's node id, before `stampDeployment` and before the main box's key ring replaces
`secrets.env`. It then installs the main box's certificate authority, and a leaf that authority
signs for this box's names, as this box's own `tls/ca.*` and combined `tls/server.pem`
(`installVenueAuthority`, `apps/server/src/box-tls-install.ts`): working files (each
`<name>.tmp`, `stagedPath`), then a durable `tls/install.json` (`TLS_INSTALL_FILE`) naming them,
then the renames, then the list is removed. `adoptFromPrimary` refuses a bundle whose authority
certificate's key is not the one it carries (`mirror.bundle_fetch_failed`) before it writes
anything, and `installVenueAuthority` refuses such a pair through the same check
(`assertAuthorityKeyMatches`). A leaf reissue
(`reissueBoxLeaf`, `apps/server/src/box-secrets.ts`) replaces the certificate-first `server.pem`
with one flushed rename, through `writeFileDurable`. `finishTlsInstall` finishes a listed install and deletes every other working file of the set
and of the list, before `tls/` is first read: in `node-entry.ts` (the image's entry point) and in
`first-setup-launch.ts` (what `bin.ts` runs); a test or script that calls `startServer` directly
does not run it. No box keeps a second authority beside its own.

Both resets of a box holding `tls/joined.json` empty `tls/`, remove its certificate-repair flow
and remove `secrets.env`, the marker
last, so a reset cut short runs again: the staged reset (`apps/server/src/reset-request.ts`, which
removes them before the operation record it re-runs from) and `waitron.sh reset`. `tls/` and `secrets.env` hold
the other venue's secrets: the authority every one of its tills trusts, and the key ring that opens
its sealed credentials. A box with an empty `tls/` and no `secrets.env` mints a fresh set at its
next setup start (`ensureBoxSecrets`). A box that never joined keeps its `tls/` under both resets. A spare
later promoted keeps the marker, so a plain reset of it also empties `tls/`, and its devices must
trust it again. While a staged reset that will empty `tls/` is pending (`stagedResetEmptiesTls`),
the image's start (`runEntry`) skips its connection check, which would otherwise send a
part-emptied `tls/` to connection repair before the reset re-runs; with no such reset pending, the
same `tls/` still goes to repair.

**Every start checks its leaf.** `ensureLeaf` (`apps/server/src/box-secrets.ts`) reissues the
leaf when it lacks one of the box's names or a current address, does not verify under
`tls/ca.crt`, or does not match the private key in `tls/server.pem`, and otherwise leaves it byte for
byte. A start that refuses, and a box another box has fenced, leave `tls/` as it was; a failed
reissue logs `tls.leaf_reissue_failed` and the start carries on, because a wrong name is no
reason to stop selling.

**Guards.** `apps/server/src/box-tls-install.test.ts` (every crash point of the install),
`box-secrets.test.ts` (one flushed leaf replacement and its failure cases),
`reset-request.test.ts` and `scripts/waitron-sh.test.mjs` (the joined and never-joined resets and
the marker-last order; `reset-request.test.ts` also starts the real entry after a reset cut short
in `tls/`), `connection-bootstrap.entry.test.ts` (both entries finish a cut-short install before
their connection check), `box-leaf-names.test.ts`, the start-up reissue cases in `boot.test.ts` and
`boot.mirror.test.ts`, and the refused-restore and fenced cases in
`boot.restore.test.ts` and `boot.reconcile.test.ts`. Weaker than the rule: nothing checks that a
NEW entry point which reads `tls/` calls `finishTlsInstall` first.

## A venue's changes stream to one place: the spare's store or the owner's bucket

**The rule.** A main box with a spare streams `venue.db` to the spare's store and never to the
owner's bucket, so the two are never configured together. Saving bucket settings is refused with
`backup.spare_stream_active` while `node.db` holds a pair link (`refuseWhilePaired`,
`apps/server/src/stream-api.ts:159-163`), and a join is refused with `mirror.bucket_stream_active`
while bucket settings are stored (`refuseWhileBucketStream`, `apps/server/src/mirror-bundle-api.ts:341-348`).
Each check is repeated under `node.db`'s write lock, where the other side writes
(`stream-api.ts:253-254`, `mirror-bundle-api.ts:190-200`), so of two requests at once one sees the
other. The stream host reads the pair link first and the bucket settings only when there is no
streaming link (`apps/server/src/stream-host.ts:286-289`). Passing the spare's copy on to the
bucket is not built (the 3b plan's "copy-up", slice 5e).

**The pair link.** `node_pair_link` (`packages/node-db/src/schema/node-pair-link.ts`) is one row per
box, keyed by its own node id, so a box has at most one spare; a join is refused with
`mirror.spare_already_joined` while the link is `streaming` to a spare the held chart does not list
as evicted or cleared (`mirror-bundle-api.ts:192-197`); any other link is replaced. The main box's
row has role `streams` and moves `pending` → `streaming` when it writes the spare's `nodes` row,
which happens when the spare's store first answers it, not when the bundle is handed out
(`recordSpare`, `apps/server/src/spare-join.ts:157-186`; decision D6 in [the 3b plan](../superpowers/plans/2026-11-04-a947-3b-spare-hosts-store.md)). The spare's row
has role `serves` and moves `awaiting_copy` → `copied` (`apps/server/src/adopt.ts:260`,
`finish-adoption.ts:75`). The table's check refuses any other role and state pair. The store's
secret key is sealed under the key ring, bound to both boxes' ids
(`packages/credentials/src/node-pair-link.ts`), which is why the key ring is not rotated while a
link exists (see the write-path entry above, decision D7).

**The store and its folders.** Only a box whose link `serves` runs the store, versitygw on
loopback, behind a TLS listener on `WAITRON_SPARE_STORE_PORT` (7443 by default) that admits only a
client certificate under the venue authority naming the paired main box (`startServedStore`,
`apps/server/src/boot.ts`; `apps/server/src/spare-pipe.ts:60-92`). The store keeps its
data in `<state>/pair-store/` (`apps/server/src/spare-store.ts:74`). The spare's first copy is
restored from that store into `<state>/pair-copy/`, outside `scratch/` because it must survive the
restart that puts it in place of `venue.db` (`apps/server/src/spare-copy.ts`,
`spare-copy-placement.ts`). An admitted mirror's selected handover backup also waits there across
its placing restart; `ready.json` names only staged input and `placed.json` keeps the archive's source id until activation, while preview and
declaration check the live copy after migration. That placement keeps the mirror's own `node.db`
and secrets (`handover-copy-from-backup.ts`, `handover-copy-selection.ts`). Both folders are named in `packages/store/src/state-layout.ts` and
deleted by a plain reset.

**Guards.** `apps/server/src/stream-api.route.test.ts` (`backup.spare_stream_active`),
`apps/server/src/mirror-bundle-api.test.ts` (`mirror.bucket_stream_active`),
`apps/server/src/spare-join.test.ts` (the row and link states), the two-box test
`apps/server/src/spare-join.e2e.test.ts` (a join refused while the main box copies to a bucket,
then joined, copied and kept to loopback), and `scripts/state-layout.test.ts`. Weaker than the
rule: nothing checks that a new writer of bucket settings or of a pair link makes the other's check.

## The box's spare file

**The rule.** The box keeps `<state>/spare-space` (`SPARE_SPACE_FILE`, `@waitron/provisioning`;
`SPARE_SPACE_BYTES`, 8 MiB of random bytes, `apps/server/src/spare-space.ts`) so that, on a nearly full
disk, it still has the room to start and take the venue lock. Within the server, one path deletes
it, through `releaseSpare`:

- **The start** (`releaseSpareToStart`, `apps/server/src/node-entry.ts`), before first-setup
  resolution, whose inspection opens the database: when the lower free space of the configured
  state and venue folders is under 8 MiB, or under `FULL_DISK_BYTES` (16 MiB) when the recovery
  state's last error was `storage.disk_full`. A start at the recovery level still releases, then
  serves the recovery page.

**Old backups go before the spare.** Just before the start's release, `runEntry` calls
`deleteOldBackupsAtStart` (`apps/server/src/start-backup-room.ts`). It does anything only under `FULL_DISK_BYTES` (16 MiB) free on the venue
folder's disk, the one its deletions free, and only with a backup room note that passes every check ([The backup room note](#the-backup-room-note)). It
deletes old backups toward the start's floor (256 MiB) when the deletable ones reach it, otherwise
toward the spare plus 16 MiB (24 MiB), and deletes nothing when even that is out of reach. The
release then reads free space again, so a step that brought the venue folder's disk to the spare
plus 16 MiB releases nothing, unless the state folder is on another disk that is itself under
16 MiB free.

`waitron.sh reset` deletes the spare too. The spare is never venue data: never backed up, exported or streamed.

**The release marker.** A release that deleted bytes writes `<state>/spare-space.released`
(`SPARE_SPACE_RELEASED_FILE`) straight after the unlink, inside `releaseSpare`, so the start's release
leaves it. While it exists the till stop holds, across restarts (owner, A1127 Q3 A):
`noteFullAtStart` notes the stop when `spareReleased` answers true, and `full()` keeps it while the
marker exists, whatever the free space ([A full disk stops the till's writes](#a-full-disk-stops-the-tills-writes)).
`spareReleased` answers true for a marker it cannot read (`storage.spare_marker_unread`, at start, at
each free-space watch reading and Free press, and at each `full()` call that, while the stop holds, reads 16 MiB or more free). The marker is deleted only by a top-up that leaves the spare
whole, or, with room, when a link or folder stands at the spare's path, which the box can never
write through and an operator with no terminal could never remove.

Two windows release the spare and leave no marker, and the stop then rests on free space alone
(noted at start only under 16 MiB, lifted at 16 MiB, not held across a restart): a power cut between
the unlink and the marker's write, and a marker that cannot be created (`storage.spare_marker_write_failed`;
also logged when it was created but not made durable). Writing the marker before the unlink would
need room on the disk it exists to relieve, and whether an empty file can be created on a disk that
refuses data blocks is not measured.

**Who writes it back.** Three writers, each only with the spare plus 16 MiB (24 MiB) free:

- a start (`topUpSpare` in `runEntry`), always;
- the running box's free-space watch (`apps/server/src/free-space-watch.ts`), once a minute, and
- Box status's **Free** button (`createSpaceFreer`, `apps/server/src/free-space-now.ts`), before
  its free-space reading.

The last two share one `restoreSpare` closure that `boot.ts` builds from `spareRestorer`; it writes
only while the marker exists, and a call while one is under way answers that one's promise, so the
two cannot both write. Without the marker check every booted test server with room would append
8 MiB to its state folder at the watch's first reading. Cost: a spare missing with no marker (the
two windows above, the interleave below, or a first start without 24 MiB) waits for the next start
with room. After its old-backup step, the watch writes the spare back, then reads free space once, so
the stop can lift in the same reading.

**A second start beside a running server can release that server's spare (accepted).** The start's
release runs before any venue lock, unlike the staging clean-up beside it. Such a start deletes the
running box's spare and writes the marker; the running server is not stopped by it (its `full()`
reads the marker only while a stop is noted) and its watch writes the spare back once 24 MiB is
free. Interleaved with that server's own write-back, it can leave the spare gone and no marker.
Skipping the release while `readVenueHolder` shows a fresh holder was not taken: a holder that dies
leaves its file and reads fresh for 30 s (`VENUE_HOLDER_STALE_MS`), so a start within 30 s of a
server that died on a full disk would serve the full-disk page instead of booting.

**The bucket stream does not use the spare's room** (measured once each on HFS+, idle box: 16 KiB
below the control's free space, local stream files at most 451,603 bytes, no refusal; scripts and
output in `~/waitron-campaign/a1127-measure/full-boot/stream/README.txt`). Not measured: a box that
never streamed, and a large venue database, whose start makes a fresh full copy.

**The guard.** `scripts/spare-space.test.ts`, weaker than its name: it reads text. It reads only
non-test `.ts` files under `apps/<app>/src` and `packages/<package>/src`, so test files and nothing
under `scripts/` or `deploy/` (`waitron.sh reset` among them) are seen. It looks for
`SPARE_SPACE_FILE`, `SPARE_SPACE_RELEASED_FILE`, the two names as literals in any quotes, and the
release, top-up and write-back function names (`restoreSpare` included), and requires each allowed
file to still name its entry. A path built another way, or a function reached under another name,
escapes it; and `spareReleased` is not guarded at all (it changes nothing).

**Why 8 MiB.** Measured on a 32 MiB HFS+ image (scripts and output kept outside the repo, under
`~/waitron-campaign/a1127-measure/`): one lock needed 8 KiB, the emptying 16 KiB, the whole
Start-again flow 64 KiB; a 16 KiB spare released on a full disk was enough for the emptying and a
4 KiB one was not. 8 MiB stays under `FULL_DISK_BYTES`, so a disk whose spare was just released still
reads as full to `fullDiskFailure`. Random bytes written out, never `truncate`: on a 32 MiB APFS image
a file truncated to 4 MiB took 4096 bytes. ext4 and copy-on-write filesystems are not measured (the
backlog holds that). (2026-11-04, A1131bc slice 4: the emptying is deleted; the size still covers
the start's lock.)

**Why no lock is taken to delete or write it.** It is in neither a venue folder nor
`<state>/scratch/backup`, and a lock taken to delete it would need the room it exists to give. A
release is an `unlink` that treats `ENOENT` as done; a top-up appends only while the file is short of
the cap and opens with `O_NOFOLLOW`, leaving anything that is not a regular file alone
(`storage.spare_unusable`). The lock rule itself is unchanged: the start still takes the venue lock; the
spare only gives it room to.

**Which walks see it.** None of the walks the design names, since A1131bc slice 4 deleted the
originals walk: Start again's deletion list and its leftovers survey read named entries
only, as do the setup inspection's fingerprints. The design
(`docs/superpowers/specs/2026-10-28-a1127-full-disk-spare-file-design.md`, "Which walks see it") has
the line references and says which were read rather than run.

## A by-id read still needs its own `eq(table.tenantId, cfg.tenantId)` — one-tenant-per-database is NOT the query's isolation boundary

> **Superseded 2026-09-14.** There is no tenant column to compare against any more: the taxpayer is
> the one row in `tenants` (`id = 1`), and nothing filters by a tenant. Built in #378. The rest of
> this section is kept as the record of why the rule existed; the probe it describes cannot be
> written any more, because a second taxpayer row cannot be inserted. What survives it is the habit,
> not the clause: only the seat that RAN a probe found the defect four reading passes had cleared.

Since RLS was dropped (#255) `withTenant` no longer isolates SELECTs, so every read scopes to the
tenant itself — a by-id read as much as a list read, never trusting a globally-unique UUID or the
deployment invariant. Cost: `getHeldOrder`/`abandonHeldOrder` keyed on the `working_orders.id` UUID
alone, so tenant A could read AND abandon tenant B's order in a multi-tenant DB (till reroute S3, #259). The
per-task review and four quality lenses all reasoned it "safe under one-tenant-per-db"; only the
run-it seat, which RAN a two-tenant probe, caught it — reading missed it,
running caught it (§1, §4).

## There is no tenant column

**There is no tenant column. The taxpayer is the one row in `tenants` (id = 1, singleton check); a
query that wants "this tenant's rows" reads the table.** (2026-09-14, #378.) Guard:
`scripts/no-tenant-column.test.ts`, weaker than its name in ways its own header states, among
them — it matches the column's SPELLINGS, so a column reintroduced under an unrelated name passes,
and it does not read test files.

## No backwards-compatibility or data-migration code until Waitron is in production

No real venue is live, so any installation may be reset at any time instead of carrying its data
forward (owner, 2026-10-03). A backfill for an empty database is code to
maintain that buys nothing — and the first draft of the settlement design carried one that could only
ever GUESS which tender a tip belonged to, which is worse than discarding. This rule expires the day a
real venue is live; add its replacement in the same change.

## An empty value is a valid value

A path variable that is unset OR empty falls back to
its default through `isUnset` (`apps/server/src/env-value.ts`) and never through `resolve("")`,
which is the process's working directory. `apps/server/src/config.ts` states it at `stateDir`,
`venueDir` and `logDir`. The refusal shape is the other half, for a reader with no default to fall
back to: `resolveVenueDir` (`packages/provisioning/src/cli.ts`) takes `--venue-dir`, then
`WAITRON_VENUE_DIR`, then a prompt, and throws `provisioning.venue_dir_missing` when all three give
nothing — because every path the store builds is `join(directory, …)`, so an empty directory is the
RELATIVE `venue.db` rather than no directory at all.

An env or prompt value set to `""` falls back to its default exactly as an unset one does (in
`apps/server`, through `isUnset` in `apps/server/src/env-value.ts`; the log folder through
`resolveLogDir` in `packages/db/src/venue-holder-identity.ts`), and a reader with no default refuses
`""` explicitly, as `resolveVenueDir` does with `provisioning.venue_dir_missing`.

**Migrations**

## A schema change rebuilds the set's one starting migration

Change the TypeScript schema and write hand-written SQL only in `<package>/triggers/<set>.sql`.
Run `pnpm --filter @waitron/server migration-baseline rebuild --set <name>`. This replaces the
starting migration and resets every venue; backups and exports from before it cannot be restored
or imported. Work beside A1308 changes a schema the same way (the slice rules' §8).

On a rebase conflict in a set's `drizzle/` files or `scripts/migration-baseline-epoch.json`, take
main's side with `git checkout --ours -- <those paths>` during the rebase, keep your schema and
trigger source, and rerun the rebuild command. Stage the generated paths with `git add -A` and
continue the rebase. Never merge generated text by hand.

`scripts/starting-migrations.test.ts` runs `rebuild-check` for every set. A hand edit or a
drizzle-kit upgrade that changes generated text fails that check and needs a rebuild and reset.
Verify by RUNNING `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
`scripts/behavioural-triggers.test.ts`, `scripts/starting-migrations.test.ts` and
`packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
Paid for on #165.

**Since A760 (November 2026)** every set starts from one `0000_baseline.sql`; what follows is the
account of the old history. (2026-11-07, A1422) The old migration files it names were deleted with
the frozen history; read one with `git show f519799de0:scripts/fixtures/a760-history/<set>/<file>`.

The justification this used to carry — "works because the snapshot chain deliberately lags the DB,
custom migrations being snapshot-less" — is half right. The hand-written `--custom` migrations in
the old history (`core/0001_behavioural_triggers.sql`,
`core/0004_variant_one_level.sql`,
`core/0015_settled_order_freeze_new_columns.sql`,
`core/0019_settled_order_freeze_visit_id.sql`,
`core/0020_visit_clears_table_status.sql`,
`core/0024_bill_payment_triggers.sql`,
`core/0027_line_vat_class_triggers.sql`,
`core/0033_line_served_exception.sql`,
`core/0038_main_bill_release.sql` (two triggers on `working_orders` that clear
`parties.main_bill_id`),
`core/0137_floor_retire_drop_table_triggers.sql` and
`core/0139_floor_retire_recreate_table_triggers.sql` (drop and restore
`parties_clear_table_status` around the `dining_tables` rebuild),
`core/0042_placed_bill_moves.sql` (a presented bill changing party),
`core/0043_drop_triggers_before_rebuild.sql` and
`core/0045_recreate_triggers_after_rebuild.sql` (the three triggers around `0044`'s
rebuild of `dining_tables`, `parties` and `service_commands`),
`core/0047_product_ordering_check.sql`,
`core/0050_line_list_price_frozen.sql` (re-creates
`working_order_lines_require_open_parent_update` with `list_unit_price_gross` in both
unchanged-column lists),
`core/0053_line_sent_after_close.sql` (re-creates
`working_order_lines_require_open_parent_update` with an exception for a line's first sent stamp),
`core/0056_placed_order_handover.sql` (re-creates
`working_orders_enforce_transition` with an exception for a sent, unpaid order's handover stamp),
`core/0059_drop_product_triggers_before_rebuild.sql` and
`core/0061_recreate_product_triggers.sql` (the triggers on `products` around
`0060`'s rebuild),
`core/0064_line_locale_triggers_text_only.sql` (re-creates the two locale update
triggers on `working_order_lines` to fire only when an update changes the name map each checks or
moves the line),
`core/0066_line_make_at_station_trigger.sql` (re-creates
`working_order_lines_require_open_parent_update` with `make_at_station_id` in each of its three
unchanged-column lists),
`core/0072_device_binding_watcher_sql.sql` (re-creates the two device binding
triggers so a kitchen display binds a station or a watcher; dropped by `0119`),
`core/0080_money_records_drop_triggers.sql` and
`core/0082_money_records_recreate_triggers.sql` (the triggers around `0081`'s rebuild
of `sales`, `bill_payments`, `bill_payment_refunds` and `unpaid_departures`),
`core/0083_working_orders_drop_triggers.sql` and
`core/0086_working_orders_recreate_triggers.sql` (the triggers around `0085`'s
rebuild of `working_orders`),
`core/0089_devices_drop_triggers.sql` and
`core/0091_devices_recreate_triggers.sql` (the triggers around `0090`'s rebuild of
`devices`),
`core/0119_drop_device_binding_triggers.sql` (drops the device binding trigger),
`core/0122_devices_drop_form_factor_trigger.sql` and
`core/0124_devices_recreate_form_factor_trigger.sql` (the trigger around `0123`'s
rebuild of `devices`),
`core/0128_delivery_table_release.sql` (re-creates
`working_orders_enforce_transition` with `delivery_table_label` in the presented-bill and handover
unchanged-column lists, and an exception letting an order past `open` drop its delivery table and
keep its name),
`core/0201_retire_main_bill_triggers.sql` (drops `0038`'s two triggers before
`0202`'s rebuild of `parties`),
`media/0001_image_references.sql`,
`media/0002_section_image_references.sql`,
`media/0003_published_image_references.sql`,
`media/0004_drop_category_image_triggers.sql`,
`media/0006_recreate_section_image_triggers.sql`,
`media/0007_recreate_product_image_triggers.sql`,
`media/0008_queued_edition_image_references.sql`,
`media/0009_include_folder_image_references.sql`,
`catalogue/0013_drop_category_image_triggers.sql`,
`catalogue/0018_sections_owned_prepare.sql` and
`catalogue/0021_sections_owned_restore.sql`) each carry their own
`meta/000N_snapshot.json`, so they are not snapshot-less; but on 2026-09-26 (2026-09-27 for
`0024_bill_payment_triggers.sql`, 2026-09-28 for `0027_line_vat_class_triggers.sql`,
`0033_line_served_exception.sql` and `0038_main_bill_release.sql`, 2026-09-29 for
`0042_placed_bill_moves.sql`, `0043_drop_triggers_before_rebuild.sql` and
`0045_recreate_triggers_after_rebuild.sql`, 2026-09-30 for `0050_line_list_price_frozen.sql`, and
2026-10-01 for `0053_line_sent_after_close.sql` and `0056_placed_order_handover.sql`, and
2026-10-02 for core `0047_product_ordering_check.sql`,
`0059_drop_product_triggers_before_rebuild.sql`, `0061_recreate_product_triggers.sql` and
`0064_line_locale_triggers_text_only.sql`, media `0004_drop_category_image_triggers.sql`,
`0006_recreate_section_image_triggers.sql` and `0007_recreate_product_image_triggers.sql`, and
catalogue `0013_drop_category_image_triggers.sql`, `0018_sections_owned_prepare.sql` and
`0021_sections_owned_restore.sql`, and 2026-10-04 for core `0066`, `0072`, `0080`, `0082`, `0083`,
`0086`, `0089` and `0091`, and 2026-10-07 for media `0008_queued_edition_image_references.sql` and
`0009_include_folder_image_references.sql`, and 2026-10-09 for core `0119`, `0122` and `0124`, and
2026-10-10 for core `0128`, and 2026-10-11 for core `0137` and `0139`, and 2026-10-31 for core
`0201`)
each of those files equalled the one before it once `id` and
`prevId` were removed and keys sorted, except that `0042`'s `_meta.columns` no longer carried
`0041`'s column rename, so the snapshot chain records none of the hand-written SQL, which is why regenerating from the TypeScript
does not reproduce it.

Three generated migrations also carry hand-written SQL:
`media/0005_photo_name_only.sql`, `core/0036_party_rename.sql` and
`core/0194_sale_receipt_guest_count.sql`. In `0194` only the copy line's `SELECT` is
hand-written: drizzle's rebuild for the `guests` → `guest_count` rename selects the NEW column name
from the old table and fails with `no such column` on every database, a fresh one included (the
earlier migrations create the table with `guests` before `0194` runs), so a regeneration
must paste `"sale_id", "guests", "created_at"` back.
In `0036` the whole file is hand-written: its header says drizzle-kit's generated SQL for the rename
rebuilt every table the rename touches and failed on a fresh database, so a regeneration must paste
the file back rather than keep drizzle's. In `0005`, Drizzle generated its rebuild of `media_images`;
the drop of media's eleven reference triggers and the copy of `media_image_data` aside before it,
and the restore of the bytes and the re-creation of the triggers after it, are hand-written, so a
regeneration must paste both parts back around the regenerated rebuild. Drizzle's rebuild on its
own empties `media_image_data` through that table's cascading key (with the triggers handled and no
copy, the upgrade test found it empty; recorded in the commit "Photos keep only a name: drop alt
text and labels from the image table"), so the copy aside and the copy back sit in the same file as
the rebuild and no migration step ends with the bytes gone.

## A constraint that lives only in hand-written migration SQL is one regeneration away from gone

**A constraint that lives only in hand-written migration SQL is one regeneration away from gone,
and nothing else in the tree notices.** Declare every foreign key and every unique index in the
TypeScript schema, so `drizzle-kit generate` carries it; where one genuinely cannot be declared,
say at the column what it cost and where the refusal moved to. Cost: regenerating the thirteen
sets for the storage switch dropped 33 foreign keys and 13 unique indexes, so an insert naming a
`device_profile_id` that exists nowhere was accepted and stored the dangling id; the first thing
that would have failed was a route test several step groups later.

**What the guard does not see.** `scripts/schema-constraints.test.ts` is weaker than its name in
ways its header states — it reads the schema the migrations BUILD rather than trying an offending
insert, so it cannot tell a key SQLite records from a key SQLite enforces, and it matches a unique
index by NAME, so an index whose columns changed under a kept name passes.

## A migration set needs only its newest snapshot

`drizzle-kit generate` gave the same result with only a set's newest `meta/NNNN_snapshot.json` as with all of them.
Experiment on 2026-11-09, `packages/db` at main 8d38a3bbfe, four snapshots: with the three older ones
deleted and the schema unchanged it printed "No schema changes, nothing to migrate"; with one column
added, the generated SQL was byte-identical with and without them. Control: with all four deleted it
wrote a new migration of 192 `CREATE TABLE`s. An earlier run, in a clone of main 6084db1b7e, also
checked `workforce-es` and passed the schema guards and `inmutabilidad` with the older snapshots gone.
The non-test code that opens one by number (`packages/provisioning/src/first-setup-empty-database.ts:54`)
and the test helper `packages/sync-enrolment/src/testing/migration-sets.ts:44` open the journal's last
entry only.

## Editing a shipped migration file, even a comment, needs a venue reset

2026-11-09: `scripts/starting-migrations.test.ts` replaces migrations-match-schema. The historical
receipts below refer to the guard available when those experiments ran.

Drizzle records a hash of each migration file's whole text in the database's journal table, and
`assertNotAhead` (`packages/provisioning/src/schema-ahead.ts`) refuses the start with
`provisioning.database_ahead` when the journal records a hash the image does not ship.
`packages/migrations/src/journal-hashes.test.ts` pins how drizzle computes the hash. Measured
2026-10-02 with drizzle's own `readMigrationFiles` (`drizzle-orm@0.45.3`): editing only comment
lines in core's `0001_behavioural_triggers.sql` and media's `0001_image_references.sql` (then in
each package's `drizzle/` folder; frozen at A760 and deleted with that frozen history in A1422) changed
exactly those two files' hashes, index 1 of 68 and index 1
of 8. So such an edit ships only with a reset of every venue already migrated,
said in the pull request's first line. Cost: #1036 had to restore both files byte for byte; the
owner then chose to edit them and reset the venues.

The unit case "reports an EDITED migration, whose hash changed although the count did not"
(`packages/provisioning/src/schema-ahead.test.ts`) covers the comparison on plain strings. The
review of the 2026-10-02 edit also ran it against real databases: one migrated with the files as
they shipped was refused with `provisioning.database_ahead` by `assertNotAhead` against the edited
files (`findAheadSets` listed the core and media sets; the refusal names only the first, core), and
one migrated with the edited files was accepted. A rebuild from the bucket runs the same check
(`apps/server/src/restore-stream.ts` calls `assertNotAhead`), so a copy streamed before the edit
carries the old hashes too, and so does an archive taken before it: a cold restore runs no ahead
check of its own, and the start after it does (`apps/server/src/node-entry.ts`). Nothing guards
against such an edit: the 2026-10-02 one passed the old guard
(`git show dd329e28eb:scripts/migrations-match-schema.test.ts`),
`scripts/migration-upgrade.test.ts`, `scripts/schema-constraints.test.ts`,
`scripts/behavioural-triggers.test.ts`, `scripts/append-only-triggers.test.ts` and
`packages/migrations`'s suite.

## Drizzle picks what to apply from `max(created_at)` alone

Never from a position in the journal file, so an entry whose `when` sits AT OR BELOW one the database
already recorded never runs, and DRIZZLE raises nothing — it applies part of a set and returns
cleanly. The dialect that runs is `sqlite-core`: in `drizzle-orm@0.45.3/sqlite-core/dialect.js`,
`SQLiteSyncDialect.migrate` takes the watermark with
`SELECT id, hash, created_at FROM <table> ORDER BY created_at DESC LIMIT 1` at lines 653-655 and
applies a migration only when
`!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis` at line 660, so an EQUAL
value is skipped too; `SQLiteAsyncDialect.migrate` carries the same two statements at 690-692 and
696. Those line numbers are copied from `scripts/journal-monotonic.test.ts` rather than re-derived,
which is also where they are kept current.

**Waitron no longer exits 0 on that**: `applyMigrations` counts the journal afterwards and throws
`migrations.incomplete` (next entry). The two error registries — `packages/migrations/src/errors.ts`
and `packages/provisioning/src/errors.ts` — point at `CLAUDE.md` §3, and so here, instead of
repeating the citation. That is where the pointer stops: the citation is still restated under
`packages/`, `scripts/`, `apps/` and `docs/` — `git ls-files | xargs grep -ln 'dialect.js'` finds
every copy — and nothing enforces the pointer, so a drizzle bump starts with that grep and fixes
each one by hand.

**The core journal's contradictory shape went with the history that had it.** A database at core
release point 2 and one at release point 3 both carried entry 1's `when` as their watermark, because
entry 2's RECORDED value sat below it: point 2 needed entry 2's `when` ABOVE that watermark or `0002`
was skipped, while point 3 needed it AT OR BELOW or `0002` re-applied — contradictory for any single
value, so a database at core release points 1–6 could not reach HEAD at all. Found only while
investigating the 2026-09-10 bricked box. The flip regenerated the sets, so neither that history nor
a database carrying it exists, and `KNOWN_NON_MONOTONIC` in the guard is EMPTY on purpose — empty
being the strong state rather than an unfinished one.

Guard: `scripts/journal-monotonic.test.ts`, and what it can prove today is worth knowing. A ONE-entry
journal cannot be out of order, so a per-set case over one such set is true by construction and is not
evidence that any `when` in the tree is right. The sets that carry more than one entry are the ones
whose case compares something — seven of fourteen when counted on 2026-10-03 (`db`, `catalogue`,
`venue-service`, `media`, `identity`, `adjustments` and `payments`); count again rather than trusting
that list. `outOfOrder` itself is pinned by a synthetic negative control, plus the anti-vacuity anchor
that every journal is on disk.

## A migration file's last statement takes no trailing `--> statement-breakpoint`

Drizzle's migrator splits each file on `--> statement-breakpoint` and keeps every piece, empty ones
included (`drizzle-orm` 0.45.3, `migrator.js`, the `query.split(...)` in `readMigrationFiles`), and
this engine refuses an empty statement: measured 2026-10-03 on `node:sqlite`, Node v26.7.0,
`prepare("").run()` and `prepare("\n").run()` each threw `statement has been finalized`, while
`prepare("create table t(a)\n").run()` ran. So a hand-written migration whose last statement ends in a
breakpoint fails with that message, which names nothing in the file (2026-10-01).

## A generated table rebuild can copy a new column out of the old table

For a new `not null` column with a CHECK, a single drizzle-kit generation wrote a rebuild whose
`INSERT … SELECT` copied the new column out of the old table, which does not have it, and every
migrate failed with `no such column` (2026-09-27). #750 (commit 4a4ca65c9,
`service_settings.kitchen_ticket_grouping`) split it into two generations: `0005` adds the column
and `0006` rebuilds `service_settings` to add the CHECK. #721 hit the same rebuild copy with a
nullable column: "drizzle's single-step rebuild copied bill_payment_id FROM the old table". Read
generated SQL before trusting it.

The mechanism, read in `drizzle-kit` 0.31.11's `bin.cjs` on 2026-10-04: `SQLiteRecreateTableConvertor`
(around line 25195) builds its `INSERT INTO __new_x (…) SELECT … FROM x` from the column list of the
table in the NEW snapshot, so a column the same generation adds is selected from a table that lacks
it. `sqliteCombineStatements` (around line 27546) turns a generation into a rebuild when it changes a
column's type, default or nullability, drops or changes a foreign key, adds a foreign key to a
column that is not new, changes a primary key, or adds or drops a unique or CHECK constraint, among
others; in the generations A238 wrote, an added column with none of those beside it came out as
`ALTER TABLE … ADD` (core `0077`, `0084`, `0087`). A238 paid for it a
third time on 2026-10-03: its `incidents` generation that added `source` and `device_id` with their
CHECKs wrote `SELECT … "source" … FROM incidents` and the core suite failed with
`no such column: "source" - should this be a string literal in single-quotes?` (A238);
core `0077` now adds the two columns and `0078` adds the CHECKs while it drops `till_id`. The engine
half re-measured 2026-10-04 on `node:sqlite`, Node v26.7.0 (SQLite 3.53.4): an
`INSERT INTO __new_incidents (…, "source") SELECT …, "source" FROM incidents` on an EMPTY
`incidents` without that column threw that same message, and the control naming only the columns
`incidents` has ran.

## A generated table rebuild writes an expression index as a quoted column name

`drizzle-kit` 0.31.11 re-creates a rebuilt table's indexes through `prepareSQLiteRecreateTable`
(`bin.cjs`, around line 27400), which passes no `internal` record of which index columns are
expressions, and `CreateSqliteIndexConvertor` (around line 25084) wraps every column it is not told
is an expression in backticks. So an index over an expression, such as `incidents_open_dedup`'s
`case when "device_id" is null then '' else "device_id" end`, comes back as a quoted column name;
the plain create-index path passes `internal` and writes the expression as it is. A238's `incidents`
rebuild wrote ``(`source`,`case when "device_id" is null then '' else "device_id" end`,…)`` and the
migrate failed with `no such column: case when "device_id" …` (A238, 2026-10-03).
Re-measured 2026-10-04 on `node:sqlite`, Node v26.7.0 (SQLite 3.53.4): `CREATE INDEX` over the same
expression written against `till_id`, ``case when "till_id" is null then '' else "till_id" end`` in
backticks, threw `no such column: case when "till_id" is null then '' else "till_id"
end` on a scratch table, and the same expression unquoted was accepted. What A238 did: the index
leaves the schema for the generations that rebuild `incidents` (core `0077` drops it, `0078`
rebuilds the table) and comes back alone in `0079_incident_origin_dedup.sql`, written correctly; a
note at the index in `packages/db/src/schema/incidents.ts` says so. Any later change that rebuilds a
table with an expression index keeps the index out of the schema in every generation that rebuilds
the table and adds it back in a later generation. A wrong index fails the migrate loudly,
so nothing silent is at stake, only a round trip.

## A drizzle table rebuild is rehearsed on `node:sqlite`, never the `sqlite3` CLI

drizzle-kit's rebuild writes the new table's CHECKs naming `"__new_<table>"` and then renames the
table. The app's engine rewrites those names; macOS's `sqlite3` command line does not, and refuses
the rename. Run 2026-11-01 on this Mac, on a two-column reproduction of that shape: `sqlite3` 3.51.0
printed `error in table t after rename: no such column: __new_t.a` and exited 1, while Node
v26.11.1's `node:sqlite` (SQLite 3.54.0) ran the same statements and stored the CHECK as
`"t".a > 0 OR "t".a = -1`. So a rehearsal on the command line fails a migration the app runs; run
it on `node:sqlite`.

## From go-live, a rebuild drops and recreates every trigger whose body reads the table

drizzle-kit makes some column changes, nullability among them, by rebuilding the table: create
`__new_<table>`, copy the rows, drop the old table, rename the new one. The rename re-checks every
trigger in the database, and a trigger on ANOTHER table whose body reads the rebuilt one is refused
while the table is gone. So from go-live, a migration that rebuilds a table first drops every
trigger on another table whose body reads it. After the rename it creates again each of those it
still needs, and the table's own triggers, which the `DROP TABLE` removes; each is rewritten
wherever the rebuild changed a column it reads. It names one of the table's own triggers in a
`DROP TRIGGER` only when that trigger is meant to go, so the guard below still sees one that is not
recreated. Before go-live it does not arise, because a schema change rebuilds the set's starting
migration instead. SQLite's own procedure for changing a table
(<https://sqlite.org/lang_altertable.html>, section 8) recreates the table's own triggers — "Use
CREATE INDEX, CREATE TRIGGER, and CREATE VIEW to reconstruct indexes, triggers, and views associated
with table X", which it lists with `SELECT type, sql FROM sqlite_schema WHERE tbl_name='X'` — and
drops and recreates views that refer to X "in a way that is affected by the schema change". The
page says nothing about triggers on other tables; dropping those before the rebuild is this rule's
own step, measured below. A view that reads X blocks the rename the same way, even one the change
does not affect (measured 2026-11-10 on SQLite 3.54.1); the repository has no views today.

Run 2026-11-10 (A986) on `node:sqlite` (Node v26.13.0, SQLite 3.54.1) against today's core
starting migration, `packages/db/drizzle/0000_baseline.sql`, with a drizzle-shaped rebuild inside
`BEGIN`: the plain rebuild of `products` was refused with
`error in trigger products_media_image_fk_parent_delete: no such table: main.products`. Dropping the
reading triggers first and recreating them after the rename rebuilt each of the 13 core tables a
trigger on another table reads (`products`, `sales`, `tenders`, `sale_settlements`,
`working_orders`, `locations`, `devices`, `media_images`, `sections`, `section_members`,
`menu_publications`, `menu_scheduled_publications`, `menu_version_images`); every recreated trigger
was byte-identical to the original and `pragma integrity_check` answered `ok`. A1308 slice 5h removed `locations` on 2026-11-14; the list above records the 2026-11-10 experiment. Two other repairs
were tried and rejected. SQLite's `legacy_alter_table=ON`, which skips that re-check, rebuilt
`devices` but refused `products`, whose CHECKs name its own columns: drizzle writes those CHECKs
against `__new_<table>` and relies on the normal rename to correct them
(`error in table products after rename: no such column: __new_products.parent_id`). Having the
migrator drop and recreate the triggers around every migration was not built: it would bring back a
trigger a migration meant to remove, and recreate one unchanged after the migration changed the
columns it reads. The probe scripts were kept outside the repository.

**Guard: `scripts/migration-upgrade.test.ts`, weaker than the rule.** The test migrates a database
one step at a time (the walk), and a rebuild that leaves a reading trigger in place fails it
(measured 2026-11-07 for A1422, in
[ci-and-gates.md](ci-and-gates.md#a-migration-can-fail-on-a-database-that-already-carries-earlier-migrations-and-what-boot-installed-after-them)).
A step that loses a trigger on a table it kept fails as well, unless the step's own SQL names that
trigger in a `DROP TRIGGER` (`scripts/migration-upgrade.test.ts:265-310`). So a migration that
drops a reading trigger and forgets to create it again passes the walk: in review on 2026-11-10 a
temporary walk case that did exactly that passed. Review is what catches it, by checking that every
trigger a rebuild drops is created again after the rename, in a form valid for the new columns, or
is meant to go.

## `applyMigrations` refuses to report success on a short set

It compares the journal rows a set recorded against the entries the image ships and throws
`migrations.incomplete` when fewer applied, so a boot against an old release point fails loudly
instead of serving a half-migrated schema. Cost: a database at the core set's entry 1 reached HEAD
with 10 of 15 applied and no error, and the wrong schema surfaced later as an unclassified driver
failure. Pointer: `packages/migrations/src/apply-complete.test.ts`.

**The sale path and failover**

## Nothing external may block a sale, though a start must have its time confirmed first, and a till needs the venue's primary

**Nothing EXTERNAL may block a sale, though a start must have its time confirmed first — and a till
needs the venue's PRIMARY.** AEAT, the card network and the internet are never on the sale path of
whichever node is primary, except that, on a box that files records, a start the internet cannot
confirm waits for two devices or a person to confirm its time before its first payment (owner,
2026-11-10; [below](#every-start-confirms-the-boxs-time-before-it-trades)): records chain locally
and the outbox drains later; a card falls back to 4G, a standalone terminal or cash. Fiscal submission
is an outbox, never inline.

A definite invoice-identity conflict already retained in the local database is a separate stop on
new issuance and new money. Its preflight reads local rows; it does not wait for an external filing
request. The owner-approved [administrator procedure](../operations/hour-recovery.md#switch-a-running-box-after-an-invoice-identity-conflict)
uses the current recovery key, the same minute/second-clock/history admission as restore, and an
explicit switch through the existing activation writer. It starts new series and a chain without
changing issued records or closing the original rejected case. Automatic switching is excluded.
The local conflict, pre-capture and captured-payment paths run in the conflict issuance/recovery
suites named in that procedure.

What a till DOES need is the one node accepting sales. INTENDED: the on-site box when the internet
is down, a promoted cloud when the box is dead (which needs the internet), box-down AND
internet-down together being no failover — the MVP's accepted case. TODAY there is none of it: a
venue has ONE node and no failover at all until slice 3 (2026-09-19,
[Replication, membership & failover — residuals](../backlog/replication-cloud.md#replication-membership--failover--residuals-afterwards)). The till follows the primary and never chooses
(till reroute, #244 to #265); only the primary sells.

**Provisioning and boot**

## A restore names a fresh minute; the working-time chain continues

Authenticate with the recovery key matching the selected backup and confirm that the former
seller is stopped and no parallel recovery is underway. No installation code is typed
(`packages/fiscal-verifactu/src/setup/recovery-hour.browser.test.ts`, "has no installation-code
field"). The module names the new series from the box's clock, five symbols for the UTC minute,
after a second clock on another machine agrees within 30 seconds
(`packages/fiscal-verifactu/src/hour-clock.test.ts`, "a name needs a second clock within 30
seconds of the box"). A minute a name in the history it can read already holds is not taken: a
restore's first choice is then refused with how long until the next free minute is taken and when
to check again (`packages/fiscal-verifactu/src/minute-selection-unknown-name.test.ts`, "D1: a name at
the settle target in the surviving database"; `packages/fiscal-verifactu/src/hour-selection.test.ts`,
"a $base.action refused for a minute in use says when the name will be taken and when to check
again"), and the restore page waits that out with one countdown and checks again by itself
(`packages/fiscal-verifactu/src/setup/recovery-hour.browser.test.ts`, "a minute in use shows one
countdown, checks again quietly and keeps saying why"; owner, 2026-10-30, A1207); one that already recorded a wait moves to the next free
minute when that starts within 150 seconds, and is otherwise refused with that time (`packages/fiscal-verifactu/src/hour-selection.test.ts`, "a restore's recorded wait meeting
%s, in use, at %s waits for the next free minute"; a refusal past 150 seconds is tested for a promotion and for a restore's first choice, D1 above, but not after a recorded wait: the same file's "waits for a next minute exactly 150 000 ms ahead and refuses one 150 001 ms ahead"). A later name, the backup's newest record and its creation
time do not refuse or move the minute (the same file's "selected although a later name is
known" cases; `apps/server/src/hour-recovery-host.test.ts`, "selects at the ordinary wait although
the backup's newest record is later"; owner, 2026-10-29, A1207). The minute is
taken 90 to 150 seconds after the clock check (`packages/fiscal-verifactu/src/hour-selection.test.ts`, "restore
waits until a minute start 90 to 150 seconds after its check"). It retains recovered invoices
and counters, retires recovered active series and activates the fresh complete series set. The
public production preparation API does not fall back to signed paper, Cloud receipts or random
emergency identities from environment files. Follow
[recovering a box](../operations/hour-recovery.md).

The one allocation outside the clock rule is the preproduction throwaway
(`packages/fiscal-verifactu/src/hour-throwaway-allocation.ts`). Demo and Preparation setups take
it, as does a Live setup through the setup page on a development box (`throwawayMarker`,
`apps/server/src/setup-api.ts`), and so does the readiness sample
(`packages/provisioning/src/fiscal-readiness-runner.ts`). It names from the box's clock with no
second clock and no history check, and is refused outside preproduction
(`packages/fiscal-verifactu/src/hour-throwaway-allocation.test.ts`).

`packages/fiscal-verifactu/src/minute-selection-unknown-name.test.ts` is weaker than its name: it
has restore cases (refused at a minute in use, and selected beside later names) and one promotion,
no setup case, and a reference clock more
than 15 seconds wrong can still repeat a name (its ±45.5 s control).

Cold restore checks the key saved in the selected backup; live takeover checks the live
verifier. Keep older named paper keys while their backups remain. The archive password is
separate. Name selection does not discover names made after the backup or by a box this one
never saw, and does not stop a returning old seller. Archive and bucket input remain mutually
exclusive.

The working-time chain continues from the backup's head. Its surviving-fork refusal is checked
by `packages/workforce/src/restore-continuation.test.ts`; minute naming does not transfer
working-time rows between nodes.

### Historical signed-allocation restore qualification

The following records the 14 October implementation. A679's hour policy supersedes its naming
authority and operation-input instructions; preserve these receipts as historical results.

When you restore a filing node from an archive or the bucket, supply its recovery operation and
node recovery key. The operation carries an outside signed allocation and its matching approval.
The fiscal hook activates that identity and its complete series set in the local transaction.
The box no longer draws an installation number from a clock or backup counter. The restore
command refuses combined archive and bucket inputs before either restore runs. The input procedure is in
[paper-custodian.md](paper-custodian.md#supply-a-recovery-operation-to-the-host).

Cold restore checks the node key saved in the selected backup. An older backup can accept a
replaced key and refuse its replacement, so keep the older paper until no older backup remains
(owner, 2026-10-13). Live takeover checks the live database's verifier. The archive encryption
key remains a separate credential.

Qualification, 2026-10-14: `restore-command.archive.test.ts` and
`restore-command.archive-target.test.ts` passed 36 cases with the supplied P000042 identity and
retained fiscal and working-time history. The first FULL review's missing-operation probe
refused `sif.allocation_invalid` with `reauthentication_required` and unchanged rows. The second
review removed that refusal and the fiscal cases failed four checks. These runs replace the
clock-floor receipt from #248; they do not establish outside register continuity or fencing.
The existing mixed-source argument case also passed: exit 2, no restore called and no store calls.

The working-time chain continues from the backup's head. A survivor's forked row is refused by
`time_entries_chain_position_uq`, reported by this engine as
`UNIQUE constraint failed: time_entries.node_id, …`, errcode 2067. It names the columns rather
than the index. Guard: `packages/workforce/src/restore-continuation.test.ts`. Nothing carries
working-time rows between nodes today.

## On a node that files, every start puts each sale left "being sent" back to waiting

**On a node that files, every start puts each sale left "being sent" back to waiting before its
first filing pass** (`resetInFlightClaims`, `packages/fiscal-verifactu/src/drain.ts`, run by
`resetBeforeFirstDrain`, `apps/server/src/restart-reset.ts`) — safe only while no second process
files from the database: the server opens the folder exclusively (`provisioning.database_in_use`),
and the tools that open it with `exclusive: false` file nothing.

Guards: `apps/server/src/restart-reset.test.ts`, which holds that the reset runs before the first
pass, and the case in `apps/server/src/boot.test.ts` that returns a previous run's in-flight claim
to `pendiente` on a start's first pass — weaker than the rule, because nothing checks that a tool
opening the folder with `exclusive: false` never files.

## The box's clock and fiscal records

_Removed 2026-11-12 by A1420 PRs 5 and 6:_ the stop while the box's clock read behind the latest
fiscal record, and the confirmation that lifted it. See the
[A1420 plan](../superpowers/plans/2026-11-09-a1420-start-clock-corrects-itself.md) and the
[A1506 plan](../superpowers/plans/2026-11-12-a1506-clock-rules.md).

### Every start confirms the box's time before it trades

Built by A1420 PR 1a ([plan](../superpowers/plans/2026-11-09-a1420-start-clock-corrects-itself.md)).
A box's clock dates every invoice, and a misdated invoice cannot be repaired by editing it. The owner's rule (2026-11-10): "we rely on NTP only, we don't bother about AEAT … If we
are not on the internet then we either wait for two devices … Or we stop and ask a user to confirm
that our current date+time is correct (or we ask them to correct it)". Asked whether orders wait
too: "Orders still go".

**Why a box can be online and still not synchronised** (plan R4, read, not run). Waitron installs
no time service: `waitron.sh install` only asks for one (`enable_time_sync`) and carries on when
that fails. The host service may be missing too (`install_box_service` carries on), and then the
client answers every request `available: false`. Every boot starts unsynchronised, and after a
power cut the router usually comes back after the box. A network that lets only web traffic out
blocks the time protocol (UDP port 123), so such a box never synchronises.

**The start check** (`apps/server/src/start-clock-check.ts`). Each server process holds one state
in memory: `waiting`, `by_devices`, `by_person` or `by_internet`. Before the trading listener
opens, `bootServer` looks once at the host's time service through the shared one-minute reading
(`apps/server/src/clock-service-reading.ts`; the host's status waits at most 2 seconds). A
synchronised answer confirms `by_internet` and logs `clock_start.confirmed` with source
`internet`. Anything else leaves it `waiting` and logs `clock_start.waiting`: not synchronised, a
host that throws, or a host that answers `available: false`, which the state keeps as
`hostAnswers: false` (plan D12). AEAT is not asked. The look runs whatever the box's role.

How it moves (plan D3):

- **`by_internet` is final** for the process: nothing moves it.
- **The time service.** Until the start is `by_internet`, each clock-watch look (every 15 seconds,
  `CLOCK_WATCH_MS`, on every node) reads the time service through the same shared reading, so the
  host program, which systemd starts once per request, runs at most once a minute. A synchronised
  answer confirms `by_internet`, from `waiting`, `by_devices` or `by_person`.
- **Two devices.** While waiting, each look also offers the stored device readings: two or more
  devices at different network addresses, each within 5 seconds (`START_CLOCK_MARGIN_MS`) of the
  box and of each other, confirm `by_devices` and log `clock_start.confirmed` with source
  `devices` and their ids. They set nothing. A till or handheld sends its clock with each
  equipment read, every 15 seconds while it shows the PIN screen or someone is signed in on it, and
  the store keeps a reading for five minutes (plan R11). Tablets at the PIN screen count: two
  switched on and connected confirm the box's time with nobody signed in (PR 1c).
- **A person on a till** (below) confirms `by_person`.
- **Back to waiting.** A clock set that moved the clock by more than a second but could not be
  verified (the host gave no successful answer, or the clock did not land within 2 seconds of the target) sends a start that is
  `by_devices` or `by_person` back to `waiting` and logs `clock_start.step_unverified`, whatever the
  set's reason. The watch's device check runs in the correction's turn, so it never confirms while a
  set is in flight.

A confirmation that sets nothing writes a log line and no row. Each confirmation keeps the chain
heads it was made at, read through the seat's optional `recordHeads?(tx)` (`packages/fiscal/src/backend.ts`).

**The gate** (`apps/server/src/start-clock-gate.ts`, plan D4 and R6). Boot wraps the one fiscal
seat. The gate holds on a box that files records while the start waits, and also while a clock set
is with the host, whatever the start's status. While the gate holds, its `refuseUntilRecordable` throws `clock.unconfirmed` (409, no
params), so every route that calls it refuses before any card reader, refund send or drawer job;
and its four writers (`recordSale`, `recordVoid`, `recordCorrection`, `recordSubstitution`) throw
the same, so no path through the seat writes a record. Both wrappers are needed: the plan's R6 run
showed that wrapping the writers alone charged a card and then answered `507`. A card already
charged when a writer refuses is answered `507 sale.charged_not_recorded` with reason
`clock_unconfirmed`. While the gate holds (`clockUnconfirmed`), the two refund recovery loops leave
pending refunds alone, a card refund on the till or the dashboard whose provider wait ends once the
gate holds is left pending by `clockStopsRefund` (boot hands `clockUnconfirmed` to both route
mounts, which `boot.start-clock-gate.test.ts` checks; the refund-wait rows in
`clock-unconfirmed-gate.test.ts` pass it themselves), and the bill payments loop leaves a card payment charged before the start
pending and raises no `payment.bill_settle_failed` for it, also when the gate starts holding
partway through a pass; it records it at its first pass once the gate opens (`bill-payments-loop.test.ts`). While paused, `recoverTenderRefunds` still runs
`sweepInvoiceCorrections` (`apps/server/src/invoice-correction-alerts.ts`) with `fileSettled: false`,
which files nothing, raises `invoice_correction.unfinished` and touches no refund row; an unpaused
pass also tries to file every open correction whose money is all back (`fileCorrectionAutomatically`),
raising `invoice_correction.filing_refused` when refused. The gate holds while the box files records (`filesRecords()`) and the start
is `waiting` or a clock set is with the host, each asked at each call, so a box that starts filing while it waits is gated from
that call. Orders still reach the kitchen (the owner's "Orders still go"): sending one is not among
the wrapped calls (read, not run). The administrator's record remedies call the chain directly, so their route asks the gate before
any remedy runs (`packages/fiscal-verifactu/src/record-remedy-routes.ts`, `requireClockConfirmed`;
`boot.start-clock-gate.test.ts` sends one through boot); production enables only the correction record.

**"Check the time" on a till while the start waits** (`apps/server/src/till-box-clock-api.ts`,
`apps/server/src/clock-start-up.ts`). While the start is `waiting` on a box that files records,
staff signed in on a till see `clock.unconfirmed`, "Payments wait: the server is waiting for
devices to connect and agree with its time (… of 2 so far)", with “Check the time”, whatever the
start-up window says. The PIN screen shows the same line, without the action. The count shows at most 1, since two confirm at the next look. While
the start waits, the challenge needs no stop and does not ask the start-up window; it
answers `keepOffered: true` unless the clock reads before 28-10-2024. The
till's profile and the person are still checked. The confirm then takes one of three paths:

- `keep: true` ("The server") confirms the box's time as it stands, whatever the
  till reads: no host call, no row, state `by_person`, one `clock_start.confirmed` line with
  source `staff` or `admin`. While the clock reads before 28-10-2024 it is refused
  `clock.set_refused` with reason `stopped`, writing nothing;
- a till within a minute confirms the same way ("Yes"). On a clock reading before 28-10-2024 a
  "Yes" is refused, leaving the start waiting: the till then reads before that date too, so the
  confirm refuses it `target_invalid` (run, in `till-box-clock-api.test.ts`);
- a till further out ("This device") sets the clock through the host with reason `start`, which
  writes the row every set writes and raises `clock.corrected` with its email, then, when the set is
  verified, confirms `by_person`; if the chain heads cannot be read then, the start stays
  waiting and `clock_start.mark_failed` is logged.

Once the start is `by_devices` or `by_person`, the challenge is refused `not_stopped` unless the
clock reads before 28-10-2024, and staff are admitted whatever the start-up window says until the
start is `by_internet`. `keep: true` is refused `stopped` while the clock reads before 28-10-2024,
and `not_stopped` once the start is `by_internet`.
A box whose host service does not answer waits at every start and cannot be set through it, so
devices or a person confirm its time as it stands (plan D12).

Guards: `apps/server/src/start-clock-check.test.ts`, `apps/server/src/start-clock-gate.test.ts`,
`apps/server/src/clock-unconfirmed-gate.test.ts`, `apps/server/src/boot.start-clock-gate.test.ts`,
`apps/server/src/clock-watch.start-up.test.ts` and `apps/server/src/till-box-clock-api.test.ts`,
weaker than the rule: `clock-unconfirmed-gate.test.ts` calls the seat's four writers and sends the
money routes it lists through a seat wrapped as boot wraps it, and `boot.start-clock-gate.test.ts`
sends one cash sale and one correction-record request through boot itself; a new money route is
covered only once that file lists it.

### The box sets its own clock

Built by A798-B slice 9b ([plan](../superpowers/plans/2026-10-24-a798-9b-box-sets-its-clock.md)).
The app's container cannot set the clock, so a small root program on the box's own system, outside
the container — the **host service** — sets it when the server asks. The box sets its clock
inside a stop it already has (before 28-10-2024, `clock.unusable`), and, from a till's time, while a start waits for its time to be
confirmed ([below](#every-start-confirms-the-boxs-time-before-it-trades)), and from the setup,
restore and handover pages' clock step. It opens no stop of its own.

_2026-11-12, B3:_ the installed recipe also forwards `tag.write` (up to 4096 characters) and
`network.read` (up to 700) to their installed adapters. An absent adapter keeps `unknown_request`
for a line within the shell's existing limit. The clock wire described below keeps its syntax
and 700-character limit. See the [host-read cut](../superpowers/plans/2026-11-12-b3-19-network-status.md).

**The host service** (`deploy/box/`). `waitron-box.socket` listens on `/run/waitron-box/box.sock`
(`Accept=yes`, owner `root`, group `waitron-box`, mode `0660`, at most four connections at once) and
starts one `waitron-box@.service` per connection. That runs `waitron-box.sh` as root, its error
output to the journal, ended after 15 seconds (`RuntimeMaxSec=15`). One request line goes in (at
most 700 characters, read within 5 seconds, or the answer is `request_invalid`) and one JSON line
comes out:

- `clock.status` answers `{"ok":true,"service":…,"unit":…,"synchronised":…,"lastSyncAt":…,"nowMs":…}`.
  `service` is `off` when time synchronisation is switched off, `stopped` when it is on but no time
  service listed in systemd's `ntp-units.d` folders is running, and `on` otherwise; `lastSyncAt` is
  when `/run/systemd/timesync/synchronized` was last touched.
- `clock.set <epochMs> <requester>` is refused (`{"ok":false,"reason":…}`) `target_invalid` (not
  13 digits with no leading zero, or before 2024-10-28, or from 2100 on), `requester_invalid` (not
  one line of printable ASCII from `{` to `}`, at most 512 bytes), `synchronised` (the system says
  its clock is synchronised) or `busy` (another set holds the lock). Otherwise it writes one
  `logger -t waitron-box` line naming the target and the requester; stops each running listed time
  service with `systemctl stop`, which changes nothing on disk, where `timedatectl set-ntp false`
  would disable it; runs `timedatectl set-time` (which sets the battery clock too) to the target
  plus the time since the request arrived; moves timesyncd's saved clock file to the new time when
  there is one; and starts the services again — also from a `trap` on any exit, and, after a kill,
  from the unit's `ExecStopPost=`. It answers `{"ok":true,"beforeMs":…,"afterMs":…}`, or `set_failed`.
  Any other line answers `unknown_request`.

The requester is JSON the server reports about itself: the host only logs it, never runs it, and
does not check it. The server alone decides whether a set is allowed. `waitron.sh install` installs
the service (`install_box_service`, [deploy README](../../deploy/README.md#setting-up-a-box)), and
the app mounts the socket's folder only once `.env` names it (`WAITRON_BOX_SOCKET_DIR`,
`deploy/compose.yml`).

**The server's client** (`apps/server/src/box-host-client.ts`). `clockStatus()` waits 2 seconds and
`setClock()` 20, longer than the host's own 15-second limit. Every failure is an answer, never a
throw: `missing` (no connection was made), `lost` (the connection broke, or closed with no answer,
after the request was sent, so the clock may have moved), `refused`, `timeout` or `malformed`.
Time health and the `clock.sync_off` warning (`apps/server/src/clock-sync-alert.ts`: `off`,
`stopped`, `unsynchronised`, and `unreachable` in production only) read the status through one
60-second cache, which a set clears.
The same file's `boxHostRequests()` asks B3's seven host requests and answers the same way, with
two more answers, `unsupported` (the host does not take that request) and `invalid` (nothing sent),
and one difference: a whole reply line that arrived before the connection broke is read as the
reply, not `lost`; the routes in `apps/server/src/box-host-api.ts` call it for every request but `tag.write`, behind `system.manage` ([B3 PR 9's plan](../superpowers/plans/2026-11-06-b3-9-host-routes.md)). Both
clients read an empty socket path as the default, `/run/waitron-box/box.sock`.

**Who may set it** (`apps/server/src/clock-correction.ts`, one correction per server, built in
`boot.ts`; setup mode builds its own, in the last item):

- an administrator, from their own device, while the clock reads before 28-10-2024:
  `POST /api/box/clock-set` (`apps/server/src/box-health-api.ts`, `system.box_admin`), after
  `POST /api/box/clock-challenge`;
- on a till, `POST /api/box-clock/challenge` and `POST /api/box-clock/confirm`
  (`apps/server/src/till-box-clock-api.ts`): any staff member the till's profile admits, while
  the start has not been confirmed by the internet (during a stop, or while the start waits) or
  during the start-up window (below), or an administrator signed in on the till or named with their
  PIN, while the start waits or the clock reads before 28-10-2024;
- the person on the first-setup, restore or handover page, from their own device, when the clocks
  differ and they choose **This device** (A1482,
  [plan](../superpowers/plans/2026-11-12-a1482-this-device-in-setup.md)). The page sends
  `clock-challenge` then `set-clock` through the preparation path it already uses for
  `compare-clocks`, so each page's own authority admits it: the setup owner's pass on first setup,
  the recovery key or kit on restore, a `node.manage` sign-in on handover
  (`packages/fiscal-verifactu/src/initial-hour-setup.ts`, `hosted-hour-recovery.ts`). The module
  (`packages/fiscal-verifactu/src/hour-setup-clock.ts`) refuses `same_machine` for a page on the
  box itself, and `later` when the device's time is earlier than when the hour already chosen for
  the page's event was issued (`chosenHourIssuedAtMs`), before the host is asked; it sends `AGREEMENT_MS` (30 seconds) as
  the set's `agreesWithinMs`, so a device within 30 seconds answers `agrees`, not a minute. The set
  is at reason `start`. On handover it is boot's own correction, source `admin`, and only while the
  spare is still a mirror: the older promote preparation route reaches the same seat on any box, and
  on a box that is now primary it answers `not_mirror` (`apps/server/src/node-operation-preparation.ts`);
  on a mirror that route answers only a request from the box itself
  (`apps/server/src/read-only-exemptions.ts`), so it reaches `same_machine`. On first setup and
  restore there is no venue database, so setup mode builds a second correction
  (`createSetupClockSet`, `apps/server/src/setup-clock-set.ts`), source `setup`, naming the
  administrator on first setup and nobody on restore, whose step goes into the note
  `<state>/setup-clock-step.json` (`reset: "deleted"`), one entry per step. At the first full start
  that is neither a mirror nor fenced, `raiseSetupClockSteps` makes each entry a `clock.corrected`
  alert under its id, each later one marking the earlier handled as on a running box, hands each to
  the email duty, then deletes the note; an id already present is not inserted again. A step whose
  box never fully starts before a reset, or one made before an environment-mismatch Move sets the
  note aside with the other `reset: "deleted"` entries
  (`packages/provisioning/src/environment-recovery-move.ts`), is never alerted or emailed: the host's
  journal line and Waitron's `clock_correction.stepped` log line are its only record. Start again
  keeps the note, so a step from an abandoned attempt is alerted at the next attempt's first full
  start, naming the administrator of the attempt that made it. An entry that could
  not be written stays in the process, under one id across retries: the next **This device** press
  writes it before setting anything, and every finish that restarts into the full start (the first
  setup's activation, `apps/server/src/first-fiscal-activation.ts`, and each setup operation,
  `runOperation` in `apps/server/src/setup-api.ts`) writes it first and is refused while it cannot.
  Start again and the adopt reset restart without writing it, so it is lost there, as it is when
  the process ends first.

Never from devices alone, never while the host says the clock is synchronised, and never when the
host service does not answer. A person's set hands the correction no witnesses: what set the clock
is that person's device, stored as their reading; a setup or restore set stores no reading, only
the before and after times in the note, and a restore set names nobody.

**The order** (`setInTurn`). Every set, and every confirmation of the start (the watch's two
devices, a till's keep or agreeing check), runs in the correction's one-at-a-time **turn**. The turn is always taken around a whole transaction, never inside one:
`withTransaction` holds the write lock (`packages/db/src/tenancy.ts`), and a set holding the turn
waits for that lock, so a caller waiting for the turn inside a transaction would never finish.
Inside the turn, each refusal asking nothing further:

1. `pending_step` while an earlier step's row is still waiting to be written;
2. `stale` (below), then `target_invalid` (the target before 2024-10-28 or from 2100 on);
3. `not_stopped`: at reason `start` once the start is confirmed by the internet, and at reason
   `unusable` unless the clock still reads before 28-10-2024; then, for a staff member, the till's
   admission and the window (`not_admitted`, `not_start_up`); until the start is confirmed by the
   internet, a staff member is asked only the till's admission
   ([above](#every-start-confirms-the-boxs-time-before-it-trades));
4. the host's status: `host_unavailable`, then `synchronised`;
5. `agrees` when the device is within a minute (or the caller's `agreesWithinMs`), so confirming
   is the way;
6. step 3 again, because the stop can end while the host's status is awaited; then `stale` again;
7. the set: read the wall and boot-time clocks, raise the step counter, ask the host, read both
   again. It is verified when the host answered and the wall clock is within 2 000 ms of the target
   plus the boot-time clock's elapsed time;
8. every anchor's `reanchor`, refused or not; then, when the set verified or the clock moved by more
   than a second, the witness store is emptied and the step recorded (below).

A set the host refused, timed out on or lost (a client that throws instead of answering is treated
as `lost` and logged `clock_correction.set_threw`), with the clock moved by a second or less, answers
`refused` (`host_unavailable` when there was no socket). A clock that moved without verifying —
landed off the target, or never confirmed by the host — answers `unverified`.

**The step counter and `stale`.** The correction counts every `clock.set` it sends, whatever the
answer (`steps()`). A caller notes the count, and the box's wall and steady clocks where it measured
its offset (`stepsSeen`, `measuredAt`). The set is `stale` when the count has moved since, or the
wall clock has moved against the steady clock by more than 1 000 ms (a step by the time service or
by hand): an offset is valid only while the clock has not stepped since it was measured.

**A step's row and alert** (`confirmClockStep`, `packages/fiscal-verifactu/src/clock-step.ts`). A
verified step writes one `clock_confirmations` row: `box_clock_at` the reading before,
`confirmed_at` the reading after (the time the cover takes as adopted), `step_ms` the measured step
rounded, `source` `admin` or `staff`, `person_id` the person, `reason` `unusable` or `start`, and in
`proof` what set the clock (the person's reading, with `device` naming the till when there was one)
plus `step: { beforeAt, afterAt, stepMs, targetAt }`. Every verified step, and every unverified one that moved the clock by more than a second,
records `clock.corrected` (a warning, `system.manage`): who, which till, both readings with their
offsets, the step, and whether it verified; recording it first marks any open `clock.corrected`
handled. An unverified step writes no row and lifts nothing. The managers' email duty queues one
`outgoing_mail` row per manager for each `clock.corrected`, even after a later step has marked it
handled (`remember`, `apps/server/src/box-alert-email.ts`; the `box_alert` owner,
`apps/server/src/box-alert-mail.ts`). Limits: a restart in the minute before it is queued loses the
email of an alert already handled; once it is handled, an address the mail server refuses outright
is not tried again; and a send cut off after the email was handed over is never tried again
(3a-ii's rule).

**A step whose row cannot be written** (a full disk, or an anchor whose `reanchor` failed) is kept in
memory, and every later set answers `pending_step` until the clock watch's next look, every 15
seconds, writes it (`writePending()`, `apps/server/src/clock-watch.ts`). A restart before then loses
the row and its alert;
the step then shows only in the box's logs: the host's journal line and Waitron's own
`clock_correction.row_pending`.

**Backups across a step** (Tasks 14 and 14a). A backup's age is the stamp in its name, so after a
step forward every archive taken under the slow clock looks old, and after a step back the archives
taken under the fast clock never age. So while the latest step the box made is younger than the
backup retention in days (`latestClockStep`: the latest `clock.corrected` with a non-zero `stepMs`,
verified or not), an archive stamped before the step's after reading, or more than a minute ahead of
the clock, is **held** (`clockStepHold`, `apps/server/src/backup-sweep.ts`). `pruneBackend` keeps
the `retain` newest held archives and deletes the other held ones, and applies both caps to the rest
as before, so a destination holds at most twice `retain`; making room offers held archives last
([above](#a-backup-run-makes-room-for-itself-or-is-refused-before-it-copies)). A step dated more than
a minute ahead of the clock holds nothing, and a step that cannot be read deletes nothing. With no
hold, an archive stamped more than a minute ahead still ranks after every other when pruning by
count. **Limit:** only steps the box made are recorded, so a step by the time service, or by hand on
the host, holds nothing. A backup run or a making-room pass that reads the step from just before the box asks
the host to set its clock until the host's answer is judged deletes nothing; one that read it
earlier judges ages by the clock as it read it then. After that, a step the box made holds as a recorded
one, including while its row and alert wait to be written (`unwrittenStep`, `latestClockStepFor` in
`apps/server/src/clock-correction.ts`). The
stream's generations need no hold: they are aged by the bucket's own clock (the table below).

**The working-time record across a step back** (Tasks 15a and 15b). Every clock action is still
written as before, with the time the clock read; only how a person's state is worked out changed.
`readLatestLiveEntry` (`packages/workforce/src/record-reads.ts`) takes, in each chain (one per
node), the person's latest direct entry by its position (`sequence_no`), since within one chain a
later position is a later write whatever the clock said; across nodes, the latest of those
by time (`compareEvents`); and an approved missing-entry correction dated after that entry decides
instead, unless a clock action was written after the correction in the correction's own
chain (for the clock-in read, a clock-in). The clocking routes (`currentState`, `packages/workforce/src/clocking.ts`), the till's
state (`apps/server/src/till-clock-state.ts`) and the attendance reconcile's clock-in
(`apps/server/src/attendance-discovery.ts`) all read it, so after a step back a person can clock out
and in again and the till agrees. While the clock only moves forward and no correction is dated
ahead of it, it answers what the old read did. Each node's chain holds every one of a person's
entries on that node. Still open (A1268 part 2): the hours
read, the end-of-day pass and the correction check order by time.
Guards: `packages/workforce/src/clocking-step.test.ts`, `apps/server/src/till-clock-step.test.ts`.

**The start-up window** (`apps/server/src/clock-start-up.ts`). The owner's rule (2026-10-31): when
the box cannot check the time on the internet at a start, a till proposes the likely time and a
person confirms it. A server process that is the primary when it starts opens a window as boot
creates it; on any other node it starts closed. It closes for good the first time any reader of the
stop finds none holding — the watch's look, the tills' notice read, or a till route. It has no time
limit, and a reading before 28-10-2024 keeps it open.

- **The till's offer.** While the window is open and the clock reads before 28-10-2024, the box
  sends the tills `clock.check_time` from a source of its own (`clockCheckNoticeSource`, owner
  `box-clock`, `apps/server/src/box-staff-notices.ts`); the till's clock line then offers “Check
  the time”. While the start check waits on a box that files records, the same source sends
  `clock.unconfirmed` instead, whatever the window says
  ([above](#every-start-confirms-the-boxs-time-before-it-trades)).
- **The till's check.** Both routes are refused `same_machine` from the box itself outside
  development, `device_profile.not_admitted` when the till's profile does not admit the person
  (checked again inside the write), and `not_stopped` with no stop; for a staff member also
  `not_start_up` once the window has closed. Until the start check is confirmed by the internet, a
  staff member is not refused it, and while it waits no stop is needed
  ([above](#every-start-confirms-the-boxs-time-before-it-trades)). The confirm carries the till's own clock, never a typed time, and the box takes its
  time at the round trip's midpoint. A till within a minute, uncertainty included, confirms a
  waiting start with no step and is otherwise refused `not_stopped`, and `stale` when the clock
  stepped while it waited; a till that differs sets the clock through the correction. An administrator is checked
  as the drawer route checks its override and is not bounded by the window.

Limits, stated, not fixed: a node promoted while running has no window until it restarts; while
every read of the stop fails, the window stays as it was.

**The `staff` source and its one migration** (Task 8-0). (2026-11-07, A1422: the two old
migration files named here were deleted with the frozen history; read one with
`git show f519799de0:scripts/fixtures/a760-history/<set>/<file>`.) A staff member's confirmation or step is
`source = 'staff'` with their `person_id`, and the till is under `proof.device` (fiscal code never
names a till, `scripts/no-till-as-issuer.test.ts`).
`fiscal-verifactu/0012_clock_confirmations_staff.sql` adds `staff` to
`clock_confirmations_source_ck` and makes `clock_confirmations_person_ck` read "a person exactly
when the source is `admin` or `staff`". A CHECK change makes drizzle-kit rebuild the table (copy
into `__new_clock_confirmations`, drop, rename). Nothing references the table and no trigger body
in any set names it, so the drop deletes nothing else and is refused by nothing; its own append-only
triggers go with it and `applyMigrations` puts them back after the set (`installAppendOnlyTriggers`,
`packages/migrations/src/apply.ts`). Boot counts only triggers missing before the migration
(`missingBeforeMigration`, `apps/server/src/boot.ts`), so the rebuild raises no
`append_only.triggers_restored`.
Task 15a's read adds one index, `workforce/0011_person_chain_index.sql`.

**Measured** (Tasks 1 and 4, on GitHub `ubuntu-24.04` runners with systemd 255 and chrony as the
time service; every printed line is in the plan's "Measured for 9b" table):

- `set-time` was refused while chrony ran ("Automatic time synchronization is enabled") and accepted
  once it was stopped: after `@<seconds>.250` the wall clock was 0.007 s from the target,
  `/proc/uptime` and the boot id were unchanged, so was the unit's enablement, and the battery clock
  moved 121 s; starting chrony again brought the clock back to network time (M2–M4,
  [run 41173702824](https://github.com/clintongormley/waitron/actions/runs/41173702824)).
- systemd refused to start a socket whose `SocketGroup=10001` names no host group
  (`Failed to resolve group 10001: No such process`, `status=216/GROUP`) and started it once a
  group `waitron-box` of gid 10001 existed; a container running as uid and gid 10001 with no added
  capability then read the status, set the host's clock and saw the host's boot id
  (M5, M5b, [run 41172990866](https://github.com/clintongormley/waitron/actions/runs/41172990866),
  [run 41173702824](https://github.com/clintongormley/waitron/actions/runs/41173702824)).
  `systemd-analyze verify` accepted the numeric group, so it is no evidence (M9). Without the bind
  the client answered `unavailable ENOENT` in 2 ms (M6).
- The shipped files: the handler answered an unprivileged container, landed 22 ms from the target
  and started chrony again; a backward set moved a timesyncd clock file made for the run to the new
  time; an instance killed at its 15-second limit had chrony started again by `ExecStopPost=`,
  leaving no marker (M5′, M8′, M10′,
  [run 41175687596](https://github.com/clintongormley/waitron/actions/runs/41175687596),
  [run 41176674962](https://github.com/clintongormley/waitron/actions/runs/41176674962)).

Not measured: what timesyncd does with its clock file at the next boot (the runners run chrony), and
Docker Desktop (M7).

Guards: `apps/server/src/clock-correction.test.ts`, `clock-watch.start-up.test.ts`,
`clock-start-up.test.ts`, `clock-set.route.test.ts`, `till-box-clock-api.test.ts` and
`boot.clock-correction.test.ts` beside them; `packages/fiscal-verifactu/src/clock-step.test.ts`;
`apps/server/src/backup-sweep.test.ts`, `backup-room.test.ts`, `low-space-backups.test.ts`; and
`scripts/waitron-box-sh.test.mjs` — weaker than the rule: the handler's suite runs it against stub
`timedatectl`, `systemctl` and the rest, never systemd; the route suites cover the routes they name.
Nothing checks that a new caller takes the turn outside its transaction, or that a new job comparing
a stored time with the clock is in the table below.
The page's **This device** (A1482): `apps/server/src/setup-clock-set.test.ts`, weaker than its name:
a stub host, and it calls `raiseSetupClockSteps` directly rather than through a start; "boot raises
and emails each clock step the setup page noted, then deletes the note" in
`apps/server/src/boot.box-emails.test.ts`, which goes through a start;
`packages/fiscal-verifactu/src/clock-step.setup-source.test.ts`, that the regime's step refuses a
`setup` source whatever person it names, and nothing else; and "a clock step made while the
handover page is open" in `apps/server/src/handover-activation.test.ts`, which writes the alert with
`recordCorrected` rather than through the page's set, at `filing_assumed` and `emergency_declared`
only, and checks it stays open through activation and its restart and that the box, then primary,
queues its email; and the two "while a clock step's note cannot be written" cases in
`apps/server/src/boot.setup-routes.test.ts`, which refuse one restore and one live provision sent
without the setup owner's pass, then on the next try write the note (the provision then
restarts; the restore goes on to refuse the copy for its own reason), not an adopt or the other
restores; and "refuses activation while the This device clock-step note cannot be written, then activates once it can" in
`apps/server/src/first-fiscal-interruption.test.ts`, which sends the first setup's activation with
the setup owner's pass and a stand-in note writer that fails once, and checks that the refused try
provisions nothing and asks for no restart and that the next try activates.

#### Jobs that compare a stored time with the clock, across a step of days

**2026-11-08, A1113:** the mirror-viewer keepalive in the historical audit below is removed.
Trading boot retains only revocation of an already-issued viewer session.

A798-B slice 9b, Task 15. One row per job that compares a stored time with the wall clock. "+400"
is a step 400 days forward (stored times now look 400 days old), "−400" one 400 days back (stored
times sit 400 days ahead). A step the box makes moves its clock towards the right time; a time
stored while the clock was wrong is what the step exposes. Rows marked "test" name the tests
behind them. Every other row was read at `a3ef1ff3a` or by Task 15's two reviews, and not run,
except five the reviews ran in a scratch test: the backup schedule, the PIN throttle and the three
in-memory limiters. The rows come from the
audit's two greps (calls of `Date.now()`, `new Date()` and `now().getTime()`, and files holding
timers, outside tests; both in Task 15's commit message) and from those reviews. The greps do not
find `nowIso()` cutoffs, comparisons made in SQL, or `Date.now` handed on as a value, so a job of
those shapes may still be missing. Short in-memory timers (backoffs, request durations) are left
out.

| Job | +400 | −400 | Decision |
| --- | --- | --- | --- |
| Dashboard sessions (`packages/identity/src/management-session.ts:79`) | expired, as before | expired once last seen more than the 30-minute idle timeout ahead; a smaller step ends none | fixed (test: `management-session.test.ts`, "a last-seen time ahead of the clock") |
| A mirror's viewer session (`apps/server/src/mirror-session.ts`, the keepalive) | re-stamped, as before | the keepalive re-stamps a last-seen time ahead of the clock, so the viewer is not refused | fixed (tests: `mirror-session.test.ts`, "refreshes a STALE session" for +400 and "left hours ahead by a backward clock step" for −400) |
| Passkey challenges (`packages/identity/src/passkey.ts:113`) | expired | expired when stamped more than a minute ahead | fixed (test: `passkey.test.ts`, "stamped more than a minute ahead") |
| Stream generations (`packages/stream/src/supervisor.ts`, `#pruneDaily`) | no effect: generations are aged by the bucket's own times against the bucket's clock, and the prune runs once a day by the steady clock | no effect, for the same reason | fixed (test: `supervisor.test.ts`, "ages old generations by the bucket's clock", both directions; nothing is pruned while the bucket's clock cannot be read, and a read that failed at opening is tried again at the daily prune). Before the fix the bucket's times were compared with the box's clock, so a box clock wrongly a week ahead deleted every old generation, with or without a step |
| Backup archives (`apps/server/src/backup-sweep.ts`, `pruneBackend`; making room) | without a hold, every archive past `retainDays` deleted | archives stamped ahead rank last | fixed in Tasks 14 and 14a for steps the box makes (tests in `backup-sweep.test.ts`, `backup-room.test.ts`, `low-space-backups.test.ts`); a step by the time service or by hand holds nothing — accepted: only steps the box makes are recorded |
| Cached time health (`apps/server/src/ttl-cache.ts`) | entry stale, recomputed | an entry from the clock's future would be served for days | fixed in Task 6 (test: `ttl-cache.test.ts`) |
| Attendance day close (`runAttendanceLoop`, `packages/workforce/src/end-of-day.ts`) | a clock wrongly 400 days ahead closes a running shift at its last order with an automatic clock-out; after the step back a clock-out is refused `attendance.no_open_entry` and a clock-in is written; nothing deleted, chain intact | closes nothing and raises no question; after the step forward the worker's clock-out and clock-in are written; nothing deleted, chain intact | accepted (test: `attendance-loop.test.ts`, "a running shift across a clock days off"): the wrong close comes from the clock being wrong before any step, which 9b does not cause; a manager corrects the record as for any wrong automatic clock-out |
| AEAT filing wait gate and record retries (`packages/fiscal-verifactu/src/drain.ts`: `readGate`, `retryDue`, `claimStale`, `dueProbes`) | everything due at once | gate and retries sit 400 days ahead: nothing is filed until 1 000 records are due, and a chain behind a retry stored ahead sends nothing even then | fixed: a retry, claim or probe time further ahead than its own limit is due; a gate further ahead than its wait waits one wait from now (test: `packages/fiscal-verifactu/src/drain.clock-step.test.ts`) |
| Outgoing mail (`apps/server/src/mail-sender.ts`) | a waiting row past its lifetime expires unsent | a retry stamped further ahead than its kind’s longest wait is due at once; a claim stamped more than its lease ahead lapses | tests: `mail-sender.test.ts`, “handles a backward clock step”; a backward step leaves `not_after` further away, accepted because account links and codes are issued at claim with their own lifetime |
| Account-action links (`packages/identity/src/account-action.ts`: `inspectAccountAction`, `completeAccountAction`, `confirmEmailChangeByCode`) | every outstanding link refused | a password-reset, invitation or email-change link stays usable for 400 days plus its limit | fixed: a link whose expiry lies further ahead than its purpose's lifetime is refused `account_action.invalid`, and the next issue deletes it as it deletes an expired one (test: `account-action.test.ts`, "an account action issued before a backward clock step") |
| Join requests (`apps/server/src/join-requests.ts`: `sweepLapsed`, `returningOf`) | every pending request deleted; devices ask again | a request stays approvable for 400 days plus 15 minutes | fixed for −400: a request made further ahead than its 15 minutes has lapsed, swept as an old one is, and is no returning device's request (tests: `join-requests.test.ts`, "a request stamped ahead of the clock" and "is not a returning device's request once it lies further ahead"). Accepted: a device request stamped less than 15 minutes ahead survives the window reopening, since it is not earlier than the new opening (Task 15c-3's review, M3, run); it still needs its number matched and lapses within 15 minutes. +400 accepted: the device asks again |
| Google sign-in state, authenticator enrolment (`packages/identity/src/google-oidc.ts`, `claimGoogleState`; `profile.ts`, `finishOwnTotpEnrollment`) | refused | usable for 400 days plus 10 minutes | fixed: an expiry further ahead than its 10 minutes is refused (`google.invalid`, `totp.invalid`), and the next Google sign-in or link to begin sweeps such a state (tests: `google-oidc.test.ts`, "stored before a backward clock step"; `profile.test.ts`, "begun before a backward clock step") |
| Card-refund resend window (`apps/server/src/bill-refunds.ts`, `resumeCardRefund`) | never resent; waits for a manager | resent under the same key past the provider's window | fixed: a first send stamped ahead of now at all is of unknown age and is not resent, as the tender-refund path already did (`tender-refund-sends.ts`); the refund waits for a manager (tests: `bill-refunds.card.test.ts`, "stamped 25 hours ahead" and "stamped a minute ahead") |
| Pairing window (`apps/server/src/pairing-mode.ts`, `prune`, in memory) | shuts | stays open for 400 days plus 3 minutes | fixed: a hold further ahead than its 3 minutes has lapsed, so a backward step longer than the time since the hold was opened or last renewed ends it (the control: a step back of exactly that time keeps it) (test: `pairing-mode.test.ts`, "shuts when the clock steps back") |
| Payments reconcile scheduler (`packages/payments/src/reconciliation-schedule/derive.ts`: `retryDue`, `claimLapsed`; `store.ts`: `claimRow`, `reclaimStale`; `run.ts`: `longestWait`) | runs due at once | a stuck run is not reclaimed and a failed one not retried for 400 days | fixed for −400: a retry time further ahead than the duty's longest wait (the last backoff before a park, a parked day's retry, or the longest re-sweep the duty declares as `longestResweepMs`) is due, and a run started further ahead than its hour is reclaimed; a re-sweep a duty asks for later than its longest wait is enqueued at that limit, so it cannot read as stamped ahead (tests: `derive.test.ts`, `store.test.ts`, `run.test.ts`, "…stamped ahead of the clock"; `resweep.test.ts`, "…later than the duty declares…"; `reconcile-duty.test.ts` pins the declaration) |
| Cloud snapshots (`apps/server/src/cloud-snapshot-worker.ts`: `isDue`, `pendingExpired`) | due at once; a pending capture over a day old is abandoned and its local file deleted | no snapshot for 400 days | fixed for −400: a deadline further ahead than 49 hours is due (a day start moved up to 23:59 later across the night the clocks go back put a deadline 48.73 hours ahead with no step; the longest found), and a capture made more than a day ahead is abandoned as an old one is (tests: `cloud-snapshot-worker.test.ts`, "a backward clock step"); +400 accepted: only an unpublished local capture goes |
| Content suggestion jobs (`apps/server/src/content-suggestion-runner.ts`, `step`) | the job ends expired | the job lives 400 days, refusing every new run | fixed: a job made more than its 24 hours ahead ends expired (test: `content-suggestion-runner.test.ts`, "made more than 24 hours ahead of the clock") |
| Pay-period close (`packages/workforce/src/pay-period-close.ts:110`) | a period not yet ended could be closed, append-only | a due period refused `pay_period.not_due` | accepted with a backlog line: no production caller on this tree (only `apps/server/test/attendance-export-fixture.ts:77`) |
| Certificate reminders (`packages/fiscal-verifactu/src/certificate-dates.ts:46`, `certificate-reminders.ts:107`) | the stage jumps ahead; an expired email may go | warnings stop until the date catches up; a failed send waits 400 days | accepted: a reminder, compared with the certificate's own dates, which a clock set right reads correctly |
| Crash reports kept (`apps/server/src/free-space-now.ts:218`, `start-space.ts:151`) | deleted the next time space is freed | kept 400 days longer | accepted: diagnostic files only |
| Staged recovery copy (`apps/server/src/recovery-preparation.ts:436`) | the staging copy is dropped | an hour's timer still drops it | accepted: the original backup is untouched |
| Device last seen (`recordSighting` in `device-session.ts`, `station-outputs-down.ts:219`, `alert-sources.ts:400`; the stamps' `sightingDue` in `till-session.ts` and `packages/identity/src/device-token.ts`, and the print agent's `last_seen_at` in `packages/printing/src/agent.ts`) | devices may read dark until they next call | stamps not refreshed; dark devices not flagged for 400 days | accepted with a backlog line |
| Cloud grants and lease (`cloud-backup.ts:137`, `cloud-backup-upload.ts:29`, `cloud-recovery.ts:121`, `cloud-installation.ts:215`) | refused; a new one is asked for | judged live locally; the Cloud enforces its own expiry | accepted: the times are the Cloud's |
| Backup schedule (`apps/server/src/backup-sweep.ts`, `runBackupSweep`; `backup-schedule.ts`, `longestFireAheadMs`) | fires within an hour | the next fire was worked out before the step and is not worked out again while it waits, so no scheduled backup is taken for 400 days, until a restart or a settings save | fixed: a fire further ahead than the schedule ever puts one (one interval, or the longest gap between allowed days plus 25 hours) is worked out again within the hour, when the clock also reads earlier than when that fire was worked out, so a fire past the bound with no step (a zone whose clocks change by two hours) is slept toward, not worked out again at every turn (tests: `backup-sweep.test.ts`, "a step back of the box's clock during the wait"; `backup-schedule.test.ts`, "longestFireAheadMs", which walks every fire across both changes of the clocks) |
| Backup "overdue" alert (`apps/server/src/backup-status.ts`, `freshness`) | reads overdue at once | a local folder's archive stamped before the step stays the newest, with a negative age, so `backup.destination_overdue` stays silent for 400 days whether or not backups are taken | fixed: an archive further ahead than the overdue limit is passed over and the destination is judged by its newest archive that is not; if every archive is that far ahead it reads overdue. A bucket's times are the bucket's clock (tests: `backup-status.test.ts`, "an archive stamped ahead of the clock") |
| Invoice deliveries (`apps/server/src/invoice-delivery.ts`: `deliveryDue`, `claimLapsed`, `latestNextAttempt`, used by the claim, the claim expiry, the email worker, the page printer's pick and the receipt printer's pick in `packages/printing/src/runtime.ts`) | retried at once; a stuck claim lapses | a retry waits 400 days; a claim stamped ahead never lapses until a restart | fixed: a next attempt further ahead than the longest retry wait (10 minutes) is due, and a claim taken further ahead than its 60-second lease has lapsed (tests: `invoice-delivery.test.ts`, "times stamped ahead of the clock", the two worker-pass cases and "hands the receipt agent a queued copy"; `invoice-page-print.test.ts`, "400 days ahead"; `runtime.invoice.test.ts`, "queued further ahead than the bound"). The office printer's "unclaimed" alert (`alert-sources.ts`, `undeliveredInvoice`) reports a queued A4 copy stamped further ahead than that wait at once, dated now, since when it became due is unknown (test: `alert-sources.invoice-delivery.test.ts`, "further ahead than the longest retry wait") |
| Print-job lease (`packages/printing/src/runtime.ts`, `dueNow`, used by the pull's claim and by ending an unpaired printer's jobs) | a job mid-print is claimed again | a job left printing is not claimed again for 400 days: a ticket that never prints | fixed for −400: a claim stamped further ahead than the lease has lapsed, and the job is claimed again (tests: `runtime.active.test.ts`, "a print job's claim stamped ahead of the clock") |
| PIN and password throttles (`packages/identity/src/pin-throttle.ts`, `packages/provisioning/src/password-throttle.ts`, in memory) | waits end | a person in a wait is refused at that slot, or that address, for 400 days, until a restart | fixed: an entry last touched further ahead than the longest wait (60 seconds) is forgotten, and the idle sweeps pass over an entry stamped ahead rather than stopping at it (tests: `pin-throttle.test.ts`, `password-throttle.test.ts`, "across a backward clock step") |
| Device-join limiter (`apps/server/src/enrol-rate-limit.ts`, in memory) | the window reopens | once 30 joins are counted every device join is refused `device.join_rate_limited` for 400 days, until the clock passes the window's start again or a restart | fixed: a window that started ahead of the clock reopens (test: `enrol-rate-limit.test.ts`, "across a backward clock step") |
| Account-action limiter (`apps/server/src/account-rate-limit.ts`, in memory) | the window reopens | once its count is reached, account actions are refused `account_action.rate_limited` for 400 days, or until a restart | fixed: a window that started ahead of the clock reopens (test: `account-rate-limit.test.ts`, "across a backward clock step") |
| Password-reset and invitation cooldown (`apps/server/src/account-rate-limit.ts`, in memory) | ends | that email's reset or invitation is blocked for 400 days, until a restart | fixed: a wait ending further ahead than its minute has passed (test: `account-rate-limit.test.ts`, "across a backward clock step") |
| Attendance reminder emails (`attendance_question` owner in `apps/server/src/attendance-email.ts`, on the shared mail sender) | retried at once; a stuck claim ends unknown | a refused reminder waits 400 days; a claim stamped ahead stays sending | a retry time further ahead than its 15-minute wait is due; a claim stamped further ahead than the sender's lease ends unknown (tests: `mail-sender.test.ts` backward-step cases; `attendance-email.test.ts`, "sends a retry stamped more than its fifteen-minute delay ahead") |
| Office printers' test pages (`apps/server/src/page-test-pages.ts`, `settle`, in memory) | each ends at its limit | a page left printing keeps its printer out of the A4 pick, a waiting one is never failed, and a finished outcome is kept, for 400 days or until a restart | fixed: a request, claim or finish stamped further ahead than its own limit (five minutes, the 60-second lease, ten minutes) is past it (test: `page-test-page.test.ts`, "a test page's time limits after a step back of the clock"). Left: `forgetLapsed` in `page-print-api.ts` keeps such a claim's record in memory until the clock catches up; the database's claim, which decides, has lapsed |
| Printer address probes (`apps/server/src/printer-probes.ts`, in memory) | each ends | a probe stays listed, and with eight listed a new one is refused `printer.probe_busy`, for 400 days or until a restart | fixed: a probe ending further ahead than its 30 seconds is dropped (test: `printer-probes.test.ts`, "ending further ahead than its 30 seconds") |
| The print agent's Bluetooth recheck, paired-device reuse and server certificate refetch (`apps/print-agent/src/linux-devices.ts`, `server-ca.ts`, in memory), its loop's next discovery scan and typed-address check, network reset, address-check expiry and giving up an unsent page report (`packages/print-agent/src/agent.ts`, on `host.now`), plus the network sweep (`apps/print-agent/src/sweep.ts`) | due at once; the sweep stops dialling | not rechecked, a pairing reused, not refetched, no discovery scan, no network reset, an address check kept, a typed check delayed, an unsent page report never given up and a sweep kept dialling, for the step's length | fixed: a time further ahead than its own interval or limit is due (the recheck's 30 seconds, the refetch's interval, one polling interval, the reset's five minutes, the check's own length, two leases), a paired listing started ahead of the clock at all is not reused, and a forget is ordered against listings by a count rather than a time; the discovery window's end, which a pull that fails does not replace, counts as passed once it lies further ahead than it did when it arrived; the network sweep starts no further dial if its deadline lies further ahead than at sweep start (`sweep.test.ts`, "keeps partial hits and stops dialling after backward") (tests: `linux-devices.test.ts`, `server-ca.test.ts` and `agent.test.ts`, "further ahead than", "ahead of the clock" and "once the clock has caught up") |
| The server's printer discovery window and its discovered list (`apps/server/src/print-api.ts`, `openDiscoveryUntil`, `isFresh`; `discovery-listing.ts`, `isListed`, in memory) | the window shuts; reports age out | the window stays open, so every agent keeps running discovery passes, at least a polling interval apart, and a report stamped before the step stays listed, keeping its row and the Pair or Forget it authorises, for 400 days or until a restart | fixed: a window ending further ahead than its three minutes is shut, and a report stamped further ahead than its own limit is not listed or fresh (tests: `print-api.test.ts`, "shuts a discovery window whose end lies further ahead than its length" and "lists a report by the shorter bound while the window lies further ahead than its length"; `page-printers-api.test.ts`, "refuses an entry past the shorter bound when the window lies further ahead than its length"; `discovery-listing.test.ts`). `isFresh`'s own use is covered only through the shared `withinTtl` |
| The server's Bluetooth pair and forget commands (`apps/server/src/printer-bluetooth-commands.ts`, in memory) | each ends at its limit | a pending command, which holds a pair's PIN, keeps going out on every pull, and with eight pending a new one is refused `printer.bluetooth_command_busy`; a result stays shown; the sweep of agents no call names stops; for 400 days or until a restart | fixed: a pending command, a result or the next sweep further ahead than its own limit (120 seconds, 60 seconds, one minute) has ended (tests: `printer-bluetooth-commands.test.ts`, "further ahead than its limit" and "further ahead than its minute") |
| Venue liveness (`packages/store/src/venue-liveness.ts:127`) | none: measured on `process.hrtime` | none | nothing to do |
| The box's TLS certificate (`apps/server/src/self-signed-cert.ts:160`) | — | the box may see its own leaf as not yet valid; its repair route reissues one | accepted with a backlog line (plan Task 15): a leaf issued while the clock was more than a day ahead is refused by devices whose clock is right; read, not run |

## An envío to AEAT carries one taxpayer name

The envío's header (`Cabecera`) is built from its first record's name, and a legal-name change
(owner A494) leaves records under the old and the new name waiting together. So `claimBatch`
(`packages/fiscal-verifactu/src/drain.ts`) claims one name per envío and leaves the rest
`pendiente`, with no incident; before AEAT's wait time has passed it sends nothing a name change
would cut short of a full envío. Which name a record filed across a rename must carry is an open
question for the asesor (Q37(d), S18 in the shortened list of `docs/compliance/asesor-questions.md`). Guard:
`packages/fiscal-verifactu/src/drain.names.test.ts`.

The due count also includes hourly retries and pending rows a brake hold or a name boundary may
leave out. Before the sending wait expires, the assembled batch must fill the cap; a partial batch
rolls its claim transaction back so ordinary and probe attempt stamps remain unchanged. The
`drain.probe.gate.test.ts` cases reproduced early single-record sends from an excluded successor
and a differently named probe at an injected cap of two. The same-name ordinary/probe full-batch
control still sends before the wait. Run them with
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.probe.gate.test.ts`.

## Boot, the contained upgrade data checker and the bucket rebuild carry an ahead-of-image check

**2026-11-12, manual activation:** [checked manual upgrades](../../deploy/README.md#checked-manual-upgrades) now invoke the contained data checker and a separate copy-sale process through the retained host runtime. The 3a note below records the earlier dormant slice.

**2026-11-12 (A950 3a):** the dormant upgrade data checker is a third caller. It shares
`upgrade-schema-check.ts`'s preflight with the ordinary entry, which re-exports it. It checks the
venue before applying packaged migrations. No installed command invokes that library yet;
full host readiness, the mandatory test sale and activation remain later slices. The original
boot/bucket caller receipts below predate this addition.

**2026-11-11 (A1308-fl5b):** staged restores now retry from their retained source and remove
unfinished database files before each marked retry. Neither restore path reads the destination
for committed replay or calls `assertNotAhead`. Boot and bucket preparation retain their checks.
An unreadable staged record stops the box while its saved-hashes attachment remains; once boot
removes the attachment before serving, an unreadable record keeps first start pending without stopping boot.
The recovery page can discard a staged restore with an
administrator password from its selected backup, using separately saved hashes. Boot removes
those hashes after its first-start step returns and before serving, including when that step
allows serving with an alert. After copying began, discard removes both identity files and the
partial data; neither old identity wins, and setup can run again.
The A1415 note immediately below describes the superseded implementation; follow
[interrupted staged restores](emergency-recovery.md#resume-an-interrupted-staged-restore).

**2026-11-08 (A1415):** a started staged restore with saved recovery selection also calls
`assertNotAhead` in `restore-request.ts` before migrating and reading destination recovery state.
The existing resumed-placement check in `restore.ts` remains. The caller inventory below records
the earlier implementation; this repair adds the destination classification described in
[interrupted staged restores](emergency-recovery.md#resume-an-interrupted-staged-restore).

`assertNotAhead` (`@waitron/provisioning`) compares the database's journal hashes against the
image's files and throws `provisioning.database_ahead`; there is no backward migration, so
installing an older ref after a newer one has already migrated the database can fail to boot with
this error. `waitron.sh`'s advice on that failure depends on the box: on one that is not stamped
production, it names `waitron.sh --reset install [ref]`, which wipes the database as
`waitron.sh reset` does and installs again in one run, the clean way back to a working box; on a
production box the script refuses to suggest that (a reset there would destroy the fiscal chain) and
says to install the version that wrote the database instead (#314). Its production callers are boot, in `apps/server/src/node-entry.ts`, and the bucket rebuild's
preparation, `prepareStreamRestore` in `apps/server/src/restore-stream.ts`, which checks the
downloaded copy before anything is placed (2026-09-25, slice 2 Task 9b). Boot's call runs after
`runStagedRestore` — the restore that replaces the venue files — and `runStagedReset`, which removes
them, and BEFORE `startServer`, so it reads a database nothing has migrated yet, because boot owns
the migration now (`apps/server/src/boot.ts`). The ordering, and the one-direction comparison that
lets a virgin venue directory pass it, are stated at `runEntry` in `apps/server/src/node-entry.ts`.
Placing a handover's accepted copy replaces `venue.db` later, in `bootServer`, so on that start
`assertNotAhead` has already run on the old file; the handover's compare refuses a copy ahead of this
image with the same code
(`aheadOfThisImage`, `apps/server/src/handover-compare.ts`).

The GAP, stated so nobody assumes coverage: BOOT and the bucket rebuild are the only migrating paths
carrying the check, and every other path that migrates runs without one. Re-grepped 2026-09-25
(`grep -rn applyMigrations apps packages`, non-test files, leaving out the test helper
`packages/db/src/testing/venue-db.ts`), that grep finds only DIRECT callers besides boot:
`apps/server/src/restore.ts`, `apps/server/src/rejoin-command.ts`,
`apps/server/src/fiscal-readiness-runner.ts`, and eight scripts under `apps/server/scripts` —
`dev-setup.ts`, `dev-onboard.ts`, `cloud-integration-fixture.ts` and the five demo scripts.
`restore.ts` migrates on behalf of its own callers, found with
`git grep -l "restoreFromArtifact\|writeValidated\|runStagedRestore" -- apps ':!*.test.ts'`: the
cold restore from an archive taken from the `waitron-restore` CLI
(`apps/server/src/restore-command.ts`), the staged restore (`runStagedRestore`,
`apps/server/src/restore-request.ts`) run by boot and by
`apps/server/scripts/cloud-recovery-client-fixture.ts`, the bucket rebuild
(`apps/server/src/restore-stream.ts`), and `apps/server/scripts/cloud-backup-fixture.ts` through
`writeValidated`. Of those, only the staged restore at BOOT and the bucket rebuild are checked; an
ahead database reached through the CLI, the two Cloud fixture scripts or any other path above is
still undetected. The `instance` command
headed this list until 2026-09-22 and no longer exists. Cost: without the check, an ahead database
re-migrates CLEANLY — drizzle applies nothing and throws nothing (measured with a control,
2026-09-10) — so the mismatch showed up only as an unclassified driver error in whatever query first
touched the changed schema. Designed and built in #310.

## A configuration route checks the tenant returned by `authorizeManager`, as well as scoping its queries

> **Superseded 2026-09-14.** `authorizeManager` returns `{ authorizedBy, role }` and no tenant, and
> there is no configured tenant to compare it with — one database, one taxpayer. Built in #378. The
> two regression cases named below were deleted with the column. The route then still scoped its
> queries by the deployed location; since A1301 S1 (2026-11-01) it reads the box's one venue
> (`apps/server/src/venue-settings-api.ts`).

The permission check returns the session's tenant; it does not compare it with the configured tenant.
A2's two-tenant route probe returned 200 for the other tenant's manager until the caller compared
them. Regression: the settings routes' test file, "refuses a manager session
belonging to another tenant". Printer routes enforce the same check; their regression is
`apps/server/src/print-api.printer-wiring.test.ts`, "refuses another tenant's manager…".

## `packages/fiscal` guards a different axis from the English-only rule

`packages/fiscal-verifactu` is Spanish by design; `packages/reporting`'s modelo-303 form (Spain's
VAT return) and `packages/workforce-es` are homes for text official only in Spain and for
Spanish-specific terms ([General code is English only](#general-code-is-english-only)). Since 2026-09-07 the
English-only guard (`scripts/english-only.test.ts`) scans comment prose as well as identifiers,
leaving only `«…»` quotes and backtick citations exempt.
`packages/fiscal/src/no-regime-vocabulary.test.ts` enforces a different axis — a domain's vocabulary
rather than a language. Its forbidden set is regime vocabulary in ANY language: English (`chain`,
`hash`, `fingerprint`) and Spanish alike (`huella`, `cadena`, `encadenamiento`, `registro`,
`incidencia`), plus the regime's proper nouns (`verifactu`, `ticketbai`, `sif`, `csv`, `aeat`). What
it refuses inside `packages/fiscal` is naming a regime mechanism at all, however it is spelled. It
strips comments first, so a comment citing AEAT is fine while `export const aeatEndpoint` fails.
Measured 2026-09-12 on a copy of
`packages/fiscal/src`: planting `export const huellaValue = 1;` and `export const cadenaValue = 1;`
each turned the suite red. A PR introducing a regime term in any language into `packages/fiscal`, one that adds a
module's word to the base list instead of the module's own declaration, or one that adds a file to
`scripts/english-only-still-to-clean.ts` or a new home to `isHome` to make a scan pass, is a design question to raise,
not a nit to wave through.

## Default optional input only when it is absent

The modifier contract tests rejected explicit null for availability, required, Boolean defaults,
price and preselection. `value ?? default` initially accepted those nulls, and comparing
`String(vatClass)` accepted an array such as `["general"]`. Defaults now use `undefined` explicitly,
and enum comparison follows a string type check.

That suite went with the old modifier model in Task 13, and the assertion was carried across rather
than dropped with it: `refuses an explicit null where a default is only taken on absence` exists in
both `packages/catalogue/src/extra-contract.test.ts` and
`packages/catalogue/src/option-contract.test.ts`. Neither is a test that merely passes — each was
proven by mutating the code it covers, widening `bool`/`flag`'s `value === undefined` to
`value == null` (and, in the extras file, `minPicks`'s `=== undefined ?` default beside it) and
watching exactly that case go red while the rest of the file stayed green. That extras mutation, of
`bool` and `minPicks` only, was run again on 2026-10-12: that case failed and the other 53 passed.

**Some fields are deliberately outside the rule**, and a reader who takes the rule as universal will
get them wrong. An extras list's `maxPicks` accepts an explicit null, because there null is the VALUE
— it means uncapped — rather than a missing field (`row.maxPicks == null ? null : …`,
`packages/catalogue/src/extra-contract.ts`). That is pinned by its own case, `keeps an explicit null
maxPicks, because there null is the value`. The seat-a-table
route's `guestCount` also accepts an explicit null as a value meaning no count; the absent field means
the same thing (`requireGuestCount`, `apps/server/src/till-api.ts`). Its route case `seats without a
guest count, absent or null` pins both inputs. `PUT /api/parties/:id/guests`'s `guestCount`, and
Split a table's `guestCounts.staying` and `guestCounts.leaving`, take an explicit null as no count while an
absent key is refused (`requireGuestCountOrNull`, `apps/server/src/till-api.ts`): in
`apps/server/src/till-api.parties.test.ts`, `clears the count with null` and `refuses the guest count
%j as a bad field, changing nothing` pin the two halves, and in
`apps/server/src/till-api.table-actions.test.ts`, `leaves both sides unknown when both counts are
null` and `refuses guests %j as a bad %s, changing nothing` do. The payment routes' `guestCount`
(`POST /api/sales`, `/api/pay`, `/api/working-orders/:id/collect`, and
`/api/working-orders/:id/payments` for the payment that completes the bill) keeps an explicit null
as no guests line, while an absent key takes the party's default (`recordReceiptGuests`,
`apps/server/src/receipt-guests.ts`). In `apps/server/src/receipt-guests.routes.test.ts` a pair of
cases on a party's bill pins the two halves on each of the four routes.

An extras item's `maxQuantity` keeps an explicit null as no cap on that item, while an absent field
defaults to one (`parseExtraListInput`, `packages/catalogue/src/extra-contract.ts`); the case
`defaults an absent item maximum to one and preserves an explicit null` pins both. The setup
request's `taxpayerDomicile` reads an explicit null the same as an absent field, as no registered
business address, which a demo sends (`parseVenue`, `apps/server/src/setup-api.ts`); the case
`provisions a demo whose taxpayer domicile is %s, as no address`, run for absent and for null, pins
both. Prepare and Live refuse it absent, null, empty or blank, pinned by
`refuses %s with a taxpayer domicile that is %s before provisioning`. Measured 2026-10-12: widening
`maxQuantity`'s `=== undefined` to `== null` failed the first case (received `1` for the null item),
and replacing `asNullableString` with `asString` for `taxpayerDomicile` failed the null case of the
second, each with the rest of its filtered run green.

These are examples, not a complete list. An extras item's `price`, where null prices the extra
from the product's unit price times its portion (`extraPrice` and `priceForExtraPortion`,
`packages/catalogue/src/extra-contract.ts`), is another.

## A missing unique target now fails at WRITE time, not at migrate time

**"Order new unique targets before their foreign keys" is retired as advice, and what replaces it is
not an ordering rule at all.** Measured 2026-09-22 on `node:sqlite`, Node v26.7.0, with a control: a
table can be created naming a parent that does not exist yet, and the whole set applies clean. The
first INSERT into the child is then refused `foreign key mismatch - "child" referencing "parent"`,
errcode 1, and keeps being refused until a unique index over the parent's referenced columns exists —
the control being the same insert passing the moment that index is created. So the refusal moved from
migrate time to the first write, which is a worse place to find it. A generated set that references a
parent's unique target is checked by WRITING a row, never by watching the migration finish.

## A streamed `venue.db` holds Litestream's own tables and a directory beside it

Litestream adds two tables, `_litestream_seq` and `_litestream_lock`, to the database it
replicates, and keeps its own copies of what it uploaded in `.venue.db-litestream/` beside the file.
A restore of the stream carries the two tables too; a migrated database that nothing has streamed has
neither.

Measured 2026-09-25 on darwin/arm64 with the pinned binaries under `.bin/` (Litestream 0.5.17,
versitygw 1.8.0 started with `--sidecar`), on a scratch database holding one table `t`. Before
streaming, `sqlite3 venue.db "select type, name from sqlite_schema"` printed `table|t` alone and the
folder held `venue.db`, `venue.db-shm` and `venue.db-wal`. After `litestream replicate -once`, the same
query printed `table|t`, `table|_litestream_seq` and `table|_litestream_lock`, and `find` showed
`.venue.db-litestream/ltx/0/0000000000000001-0000000000000001.ltx` beside the file. A
`litestream restore -o restored.db` of that replica listed the same three tables. (The drafter of slice 2's
Task 10, #652, recorded the same result on 2026-09-23.)

So a comparison of two venue databases leaves the two tables out, as the stream loop's
`tableContents` does (`apps/server/src/testing/stream-loop-scenario.ts`), and a check that lists a live or
restored database's tables has to leave them out explicitly. The directory goes with the database it
describes: `wipeVenueDatabases` (`apps/server/src/db-wipe.ts`), `restoreDatabase`
(`apps/server/src/restore.ts`), placing a handover's accepted copy (`swapIn`,
`apps/server/src/handover-place-copy.ts`) and placing a spare's first copy (`placeFirstCopy`,
`apps/server/src/spare-copy-placement.ts`) remove it with `venue.db`, and the stream supervisor removes it before
it starts Litestream on a new generation (`packages/stream/src/supervisor.ts`). What Litestream itself
does with a stale directory beside a replaced `venue.db` was not measured. Nothing finds a new piece
of code that lists tables or empties the folder and forgets either.

### Append-only declarations have two migration inputs

On 2026-10-05, A261-2 added `sale_receipt_headers` with `appendOnly()` but initially omitted it from
both the venue-service exported descriptor and the JSON manifest. The normal push hook refused
`scripts/append-only-migration-sets.test.ts`; after the descriptor fix, CI refused the descriptor/manifest
equality in `packages/composition/src/composition.test.ts`. Add the table to both inputs: the descriptor derives
its list with `appendOnlyTablesIn(...)` over its set's classification, and the manifest carries the same
name. (Since A760 venue-service has no set of its own; its tables, `sale_receipt_headers` among
them, are in core's, whose `CORE_MIGRATIONS` derives its list from `CORE_CLASSIFICATION`.)

After those fixes, `pnpm exec vitest run scripts/append-only-migration-sets.test.ts` passed 15 tests,
`pnpm --filter @waitron/composition exec vitest run src/composition.test.ts` passed 20, and
`pnpm exec vitest run scripts/append-only-triggers.test.ts` passed 48. These runs exercised the
exported-list comparison, the manifest comparison and the declared tables' update/delete refusals;
they did not test every migration caller.

## Department and zone service settings

You choose how orders start separately from when a counter order is paid.
`department_sale_policies.order_start` holds `table` or `counter`;
`floor_zones.order_start` is nullable, with null following the department.
The same zone-first resolution applies to paid-when and collection tickets.
The receipt-print field and its controls are retired.

`resolveZoneContext` and the order-context writers in
`packages/venue-service/src/operations.ts` work out an order's flow as `table_tab` for table
service, otherwise its effective paid-when (`prepay` or `ticket_then_pay`). The order's recorded
`order_service_contexts.service_mode` keeps those three values. Splitting the recorded fact
is [future work](../backlog/service-periods.md#split-an-orders-recorded-service-mode-into-two-facts).

The department editor saves its name, trading name, service settings and transfers. The receipt
editor saves receipt details and whether to print the trading name. The zone editor saves its name
and nullable service overrides in one transaction. Moving a zone changes its department while keeping
those overrides; its inherited values then follow the destination. Real-row preservation checks are in
`packages/venue-service/src/routes.test.ts`; order-flow checks are in
`packages/venue-service/src/operations.test.ts` and
`apps/server/src/till-api.service-periods.test.ts`. The old department and zone style columns
were retired without data conversion; that pre-live change required a venue reset.


## Latest station move follows insertion order

A458's `station queue move attribution` test inserts two moves at 18:12, then sets the second
move's time to 18:11. Ranking by time lost that second move from the receiving card. The reader
now ranks `ticket_item_moves.rowid`; it shows the recorded time without using it to pick the mover.

A split copies the move records in rowid order. The `keeps the latest mover when splitting a dish`
case in `apps/server/src/station-move.test.ts` turns `reverse_unordered_selects` on for the split
and restores it in `finally`. Without the copy's explicit order, the split line loses the latest
mover. Both cases failed before their fixes; deleting either order in a disposable checkout failed
its respective case again. Commands: `pnpm --filter @waitron/server exec vitest run
src/till-api.station-move.test.ts -t attribution` and the same command with
`src/station-move.test.ts -t 'latest mover when splitting'`.


## Local backup and restore pass database files

A database-sized buffer makes Node's file-read limit a restore limit. Pass the closed staging file
instead: bucket CLI, setup staging and boot use `databasePath`; archive CLI and boot use
`restoreFromArtifactFile`. Validation returns one owned database file with `discard`, which callers
await after placement or refusal. The source-liveness check opens that same file. Borrowed bucket
validation leaves disposal to its prepared download or staged request.

Scheduled local capture streams WBA1 framing into WBK1 encryption once and passes the completed
ciphertext file to each destination's `putFile`. Local storage copies inside a private directory,
sets mode 0600, then renames the completed file to its key; `getFile` uses the same copy boundary.
File decryption completes GCM authentication before parsing the archive, because the unverified
plaintext must never reach placement. Metadata reads share limits of 4096 entries, 4096 UTF-8 name
bytes and 16 MiB total; database chunks are 64 KiB and `db.dump` has no metadata size cap.

The real SQLite roundtrip in `apps/server/src/restore-artifact-file.test.ts` captures through the
scheduled sweep, stores and retrieves through the local file backend, then runs default placement,
migrations and hooks and checks rows and secrets. Its CLI and boot cases forbid whole-artifact
reads; a held SQLite lock retains the staged archive for a successful retry. The companion sweep
and collection suites check identical destination ciphertext, failure isolation, modes, cleanup
and growing metadata files. Run `pnpm --filter @waitron/server exec vitest run
src/restore-artifact-file.test.ts src/backup-sweep-file.test.ts src/archive-read-budget.test.ts
src/local-fs-backend.test.ts`.

Sparse 2147487744-byte placement and codec tests check size, offsets and edge bytes. They do not
measure integrity checks or cryptographic throughput over a valid SQLite database that large.
Managed Cloud's 512 MiB and setup upload's 256 MiB limits remain separate from this local file path.


The closed placement source must have one filesystem name (`nlink == 1`), so a surviving hard link
cannot become another path to the placed database. The multiply-linked and missing-source cases
in `restore-file-placement.test.ts` require `restore.unsafe_entry_path` before old-set cleanup.
Setup disposal is asserted after successful staging and a source-liveness refusal through
`boot.setup-routes.test.ts`; deleting `boot.ts`'s discard failed both cases.

Source liveness opens the private validation copy through SQLite. That can change its journal
metadata and create local scratch files, so the placed database is not promised byte-identical to
the archived database. Validation owns and disposes that directory; the encrypted input remains
caller-owned. The review's rollback-journal probe observed changed file bytes after open/close,
while its WAL-mode control observed unchanged bytes.


## Backup data verification has a separate authority boundary

You can check backup data before recovering a trading server. Import the production bundle's
private entry, `/app/backup-verification.js`, instead of starting the server. Use its exported
`BACKUP_VERIFICATION_MODULES` for the real composition and
`currentBackupVerificationTarget()` for the embedded release and migration identity.

```ts
import {
  BACKUP_VERIFICATION_MODULES,
  currentBackupVerificationTarget,
  readBackupVerificationRequest,
  verifyBackupArtifact,
} from "/app/backup-verification.js";

const request = readBackupVerificationRequest(privateRequestJson);
const target = currentBackupVerificationTarget();
const result = await verifyBackupArtifact(request, {
  artifactPath,
  recoveryKey: deliveredArchiveKey,
  scratchRoot,
  modules: BACKUP_VERIFICATION_MODULES,
  migrationsRoot: "/app/drizzle",
  runtime: target.runtime,
  signal,
  now: () => new Date(),
});
```

The controller supplies the private request, the closed ciphertext path, its separately delivered
versioned archive key, an owned private scratch parent and cancellation signal. The verifier
measures the ciphertext it consumes, authenticates the archive, migrates a separate private copy,
and checks every declared owner through query-only handles. A passing result requires its owned
handles to close and scratch to be removed; uncertain cleanup returns `unavailable`.
You can run this entry with worker threads denied. Placement restores the database copy and
state files inside the verification's scratch folder; migrations write that copy. Module checks use
query-only handles. Venue-store opens on the copy take the exclusive venue lock without creating
a holder heartbeat or watchdog thread. Normal server and restore opens
retain monitoring. Keep an independent deadline on the verifier process: its cooperative checks
cannot interrupt a synchronous SQLite statement. Removing a copy or closing its query handle
unsuccessfully returns `unavailable` with `cleanup_uncertain`.

`activation: "not_attempted"` is part of every admitted result; a passing check grants no recovery
allocation or trading authority.

A module declares every owned table, required data check, secret and non-database entry in its
`BackupVerificationContribution`. Its restore effects are data checks or explicitly excluded
activation effects. Absence of a declaration is unsupported. `not_applicable` requires the host's
schema and empty-data checks; it is not a substitute for a missing callback. Use the common
query handle instead of opening a writable connection inside an owner.

The trusted Cloud parent must still validate the complete result against the request, the actual
child and pinned image, its current claim and deadline, and its own cleanup before catalogue
admission. Keep snapshots unavailable until the joint release checks pass. The
[verifier release procedure](../operations/backup-verifier-release.md) records the protocol vectors,
local checks and joint release gates. The current host setup caller uses recovery version 1;
version 2 remains opt-in until Cloud supports the target-bound exchange.


An ordinary archive restore ignores a recognised v1 Cloud cache: its key or file permissions
cannot establish a target-bound approval. A saved v2 operation still requires its complete binding
at staging, restart and placement. Unknown, duplicate-key or unparseable saved protocol state is
refused before mutation rather than guessed to be v1. Preserve that state for diagnosis; this
interface does not provide a reset or erase operation.

## A backup run makes room for itself, or is refused before it copies

A1167 slice 1 (plan `docs/superpowers/plans/2026-10-28-a1167-1-room-before-backup.md`). The code
is `makeRoom` and `foldersOnDisk` in `apps/server/src/backup-room.ts`, called from `runOnce`
(`apps/server/src/backup-sweep.ts`) and `lowSpaceBackupDeletion` (`apps/server/src/low-space-backups.ts`);
the cases are `backup-room.test.ts`, the backup-sweep suites, `low-space-backups.test.ts`,
`free-space-watch.test.ts` and the real-disk file `backup-room.e2e.test.ts`.

**The need.** "The disk" is the one holding the run's working folder (`<state>/scratch/backup`),
where the run reads free space. Before the copy the run needs twice the database file's size (the
working copy and its encrypted file) plus the database file's size once for each local backup
destination on that disk, because each folder copy writes a whole working copy before its rename
and the run copies to every destination at once (`Promise.allSettled`). `foldersOnDisk` judges a
folder by the device of its real path, or of its nearest existing parent when it does not exist
yet. Two destinations that reach one folder are counted twice for the need and listed once for
deletion. A destination whose real path or disk cannot be read is counted and never listed; when
the working folder's disk cannot be read, every local destination is counted, none is listed, and
the run logs `backup.staging_disk_unreadable`.

**The floor and the aim.** The floor is the need plus `START_FREE_SPACE_FLOOR` (256 MiB); the aim
is the need plus `SPACE_LOW_BYTES` (2 GiB), never less than the floor (`spaceFloorBytes` and
`spaceAimBytes` override them; only tests do). Free space at or above the aim, or unreadable, lets
the run through. Otherwise, if free space plus the size of every deletable archive is under the
floor, the run deletes nothing and is refused `backup.staging_space_low` with `neededBytes` (the
floor) and `availableBytes`. If not, it deletes toward the aim when the sum reaches it, else toward
the floor.

**What may be deleted** (A1127 §4's set, `listDeletableArchives`). In each listed folder: plain
files (`lstat`, so a link is never followed or counted) whose archive names carry this node's ID
(`ownArchiveStamp`), never the newest of those in that folder, and only those taken strictly after
the current installation began. The installation start comes from the fiscal seat's optional
`installationStartedAt`
(`packages/fiscal/src/contribution.ts`); the Veri\*Factu module answers the live `registro_sif`
row's `registrado_en` (`packages/fiscal-verifactu/src/slot.ts`), or null when the node has none.
`createBackupRoomHooks` (`apps/server/src/backup-deletion-alert.ts`) reads it inside
`db.withWriteLock` with no change-list drain, because the drain is a write and this read must answer
on a nearly full disk. A run asks for it only when a room step finds free space under the aim, and
at most once, so a run with room takes no write-lock turn to read it. A box whose fiscal module has no such member (the no-regime module), a null
answer, or a read that throws (logged `backup.installation_start_unreadable`) deletes nothing; the
room check still runs. A bucket destination has no folder and is never deleted from.

**After a step of the clock** (A798-B slice 9b, Task 14a), making room uses the hold that backup
pruning uses ([The box sets its own clock](#the-box-sets-its-own-clock)). An archive the hold covers
(`heldByStep`, `apps/server/src/backup-room.ts`) is offered only after every archive it does not
cover, and "never the newest" then means the newest archive the hold does not cover, or the newest
covered one when it covers them all. A step that cannot be read offers nothing (logged
`backup.clock_step_unreadable`). The backup run passes the hold it read for pruning; the free-space
watch reads the step itself and offers nothing while the running backup duty's retention in days is
unknown. The start on a full disk passes no hold, so it still deletes by stamp alone (backlog: "The
start on a full disk deletes backups by stamp alone after a clock step").

**Deleting.** Oldest first (ties by key), held archives last, one at a time. Before each, the file must still be a plain
file and its folder's real path the one it was listed by, or it is skipped. Free space is read again
after each, and deleting stops once that reading reaches the goal or the deleted sizes cover the
shortfall first read. Each deletion logs `backup.archive_deleted` with `destination`, `key`, `bytes`
and the caller's `reason` (`"backup_room"` for a run). An `unlink` that fails other than `ENOENT` logs
`backup.archive_delete_failed` and ends the deleting for that step; the step is then refused when
the last reading is under the floor, as it is after the last deletion. A reading that cannot be
taken lets the run through. A stop (the run's signal) ends the step with the stop itself.

**The second check.** After the copy, the run refuses (deleting nothing) when free space is under
the copy's own size, as before. After encrypting, when at least one local destination is counted
as on the disk, the same room step runs again with the encrypted file's real size once per such
destination.

**The free-space watch** (A1167 slice 2, plan
`docs/superpowers/plans/2026-10-29-a1167-2-watch-deletes-backups.md`). Each reading of the watch
first runs `lowSpaceBackupDeletion` (`apps/server/src/low-space-backups.ts`), before the spare's
write-back and the reading itself. Under `SPACE_LOW_BYTES` (2 GiB) free on the venue folder's disk,
while the backup duty runs (`runningLocalBackends`: `BackupSupervisor.current().enabled`, so not
when backups are off, keyless, on a standby or mirror, or when the supervisor could not open the
venue) with a local folder, it takes the staging turn's `ifNoBackup`. Holding it, it stops if
the watch was stopped meanwhile, reads free space again and stops unless it is still readable and
under 2 GiB, and reads the backup settings again and lists their folders on the disk; a venue
folder whose disk cannot be read is logged `backup.venue_disk_unreadable` and deletes nothing. Then it runs the same room step with
`dir` the venue folder, no need, no floor, the aim `SPACE_OK_BYTES` (2.5 GiB) and `outOfReach:
"aim"`: when old backups cannot reach 2.5 GiB it deletes every one it may (design §2; a backup
run's step instead falls back to the floor, `outOfReach: "floor"`). Once the installation start
is read, which can wait on the write lock, it checks that each listed folder's destination is still
one backups run to, with the same folder setting, and deletes nothing if any is not; a change after
that check is not seen. Each deletion logs
`reason: "space_low"`; the report and alert are the run's. While a backup run holds or waits for
the turn it deletes nothing and logs nothing; the next reading tries again. A step that throws is
logged `backup.low_space_delete_failed` (unless the watch is stopping) and the reading goes on. A
reading under 2 GiB with a local folder on the disk reads the installation start, a write-lock turn
with no drain, once a minute, even when nothing is deletable.

**The report and the alert.** A room step that deleted anything calls `onArchivesDeleted` once on
every way out: success, refusal, a stop or a failed `unlink`, before the refusal is rethrown. Boot
wires it to `recordArchivesDeleted`, which records `backup.archives_deleted` (`count`; `date` and
`lastDate`, the calendar days, in the venue's time zone, on which the oldest and newest of the
deleted backups were taken; and `severalDays`, true when those two days differ, which picks the
several-days words on the bell and in the email; the alert's `detectedAt` is the time of the
report just after the deleting) with the `backup` origin through `recordIncidentOnce`, so while
one is open a later deletion changes nothing. A failure to record is
logged `backup.archives_deleted_alert_failed` and never changes the run's outcome. Core's
`CORE_ALERTS` claims `backup.` for `system.manage` (`packages/db/src/alerts.ts`). The managers' email
duty emails the open alert (it is in `INCIDENT_EMAIL_CODES`, `apps/server/src/box-alert-email.ts`),
and emails a refusal once for each unbroken string of runs, seen at one of its once-a-minute checks, whose in-memory `runStopped` names
`backup.staging_space_low` (`BACKUP_REFUSED_EMAIL_CODE`). A run that passes its room checks clears
`runStopped`, and a run that stops on the same code as the one before keeps that one's
`runStopped.since`, so the duty, which checks once a minute, tells a new string from the same one
by `since` even when it missed the run that cleared it.

**Limits.**

- An archive can free less than its size (a hard link, a sparse file, a file another process holds
  open), so a step can delete what the sum promised and still be refused. A failed `unlink` part way
  can also end in a refusal after deleting, and a stop part way ends the run after deleting. Not
  measured on ext4.
- A backup folder on another disk is never deleted from, and a run can still fill that disk and
  fail `ENOSPC` there without being refused first.
- Archive retention, local space-making and freshness select only names carrying this box's full
  node ID through `ownArchiveStamp` in `apps/server/src/backup-keys.ts`. Other node IDs and
  unrecognised names take no retention slot and are never deleted by these paths. Ordinary
  restore retains the archived node ID, so it continues that identity's retention; use a new
  archive folder when every old copy must be kept.
- An archive stamped while a clock read ahead can look newer than the installation start and so be
  deleted, and stays "the newest" in its folder until a later one exists, so the real latest backup
  can be deleted. A step the box made puts it last and stops it counting as the newest, but only
  while the hold lasts; a clock that runs ahead with no step the box made changes nothing.
- On one box the restore command cannot overlap these deletions: the restore command takes the venue
  folder before it reads an archive and holds it to its exit (`resolveRestoreTarget`,
  `apps/server/src/restore-command.ts`), so it is refused while the server runs and the server
  cannot start under it, and the start's own deletion (`deleteOldBackupsAtStart`) skips while the
  folder is held. A restore reading an archive from a folder another box also backs up to can still
  race that box's deletion (A1127's limit). Not measured.
- The folder check before each deletion narrows, but does not close, the window in which a folder
  swapped for a link is followed.
- A crash between a deletion and recording its alert loses the alert; so does a disk still too full
  for the alert's write (`storage.disk_full`). The deletion's log lines are then the only record.
- The macOS case for one folder reached by two real paths runs only on macOS; a Linux bind mount
  was not built.

**At start.** A start on a full disk deletes old backups too, before it releases the spare file,
trusting the installation start the [backup room note](#the-backup-room-note) holds, because on a
full disk the database may not open: on HFS+ the store's open failed at 0 B and 4 KiB free, and a
read-only open of a cleanly stopped database failed there and worked at 64 KiB.

## One state-folder layout

Backup, restore and setup working copies live below `scratch/`, with `backup/` and `restore/` children.
Cloud snapshots keep their own staging until the one backup service lands (fl2's explicit exception). A start deletes
scratch entries, never the root itself. Each maker holds the venue folder before creating its
working directory; Box status's Free still touches only backup dumps and `backup-encrypt-*`
folders, inside the staging turn. Old crash reports are pruned on every start.

The owner ran fl2's disk comparison on the box (watcher, 2026-11-10 17:58): five copies each
reported `/tmp` 1581, 453, 232, 165, 253 ms and state 1241, 314, 183, 151, 168 ms. Medians were
232 and 183 ms. Both ran under amd64 emulation on arm64; these are not native box timings.

`packages/store/src/state-layout.ts` declares the box's top-level state names and each entry's
plain-reset fate. Only `tls/` and `records/` are kept. On a box that joined another, a plain reset keeps the `tls/`
folder but empties it (see "A box that joined another holds that venue's authority as its own"). The root guard reads definitions as text:
a constant holding a complete distinctive name, or a `join` whose first argument ends in
`stateDir`. It includes the Cloud folder and the layout module’s exported Cloud child paths. On base `9caea7f442`, its first run reported 93 definition sites. Its inline controls
report a spare-file declaration and a TLS join, while accepting comments and format-item literals.

The guard skips tests, declaration files, test fixtures, the print-agent programs and plain-Node
`.mjs` scripts. The fl1 plan records a failed plain-Node import probe on 8 November 2026. Backup archive
entries and handover manifest items keep their own literals because they describe a transfer
format, not the box's current paths. A name assembled from pieces, an array or object entry, a
join from a differently named root, or a shell path escapes this guard. The scanner can mistake
comment-like text in a regular expression or template for a comment and hide a later definition. The fl1 review compared it with TypeScript’s parser over 2,661 files
and found no hidden definition on candidate `bf13077098`. Cloud connection, recovery, replacement and staff files live under `cloud/`, with snapshot state
in `cloud/snapshots/`; legacy setup names remain with the code that reads or refuses them until their slices.
The separate reset case compares the shell command's retained names with the layout's kept entries.

## Start again's records and the set-aside folder

Start again's choice records and set-aside files, under `<state>/records/`, survive a plain
`waitron.sh reset` and are removed only by `reset --all` (A1042, A1098; `deploy/waitron.sh`,
`wipe_box`). Guard: `scripts/start-again-records-writers.test.ts`, weaker than its name — it reads
which files name the choice folder or the set-aside folder as text, so a
path built from pieces escapes it, and it never sees code that empties the whole state folder
without naming the file. A file naming only `RECORDS_DIR` or plain `records` is not seen.

## The backup room note

A1167's start slice (plan `docs/superpowers/plans/2026-10-29-a1167-start-deletes-backups.md`). On a
full disk the start may not be able to open `venue.db` to read when the installation began (the plan's
measurement), so the running server leaves that fact in `<state>/backup-room-note.json`
(`BACKUP_ROOM_NOTE_FILE`, `@waitron/provisioning`) for the start to use.

**What it holds.** The node id, the installation start, `venue.db`'s device number, file number and
birth time (`venueDbIdentity`, `apps/server/src/backup-room-note.ts`), the backup folders on the venue folder's disk, and when it was written. Each folder
is `{ destination, dir, configuredDir }`: `configuredDir` is the path backups are configured to
write to, as given, and `dir` is the real path it led to when the note was written. No secret and
no bucket.

**Who writes it.** Only `BackupSupervisor.reload` (`apps/server/src/backup-supervisor.ts`). Nothing
guards who writes it. Every reload deletes the note first (`:211`); a failure of that deletion is logged
`backup.room_note_delete_failed`, not thrown. The note is written again only at the end of a reload
that started the backup run (`#writeNote`, `:311`), when the installation start reads as a date,
through a temporary file and a rename. A null or failed read, a failed write or a `stop()` landing
meanwhile leaves no note.

**Who deletes it.** Every path that replaces or removes the live `venue.db`, before it does apart
from the reset:

- `wipeVenueDatabases` (`apps/server/src/db-wipe.ts`), and so every wipe;
- `restoreDatabase` and `placeValidated` (`apps/server/src/restore.ts`), the latter before it sets
  the old identity aside; `placeBackupDatabase` reaches `restoreDatabase` with the state folder it is
  given, which for a backup verification is the scratch one;
- Start again: `deleteMarkedAttempt` (`packages/provisioning/src/first-setup-start-again-deletion.ts`),
  and `moveStartAgainUnits` and `resumeStartAgainSetAside`
  (`packages/provisioning/src/first-setup-start-again-set-aside.ts`);
- a rejoin's wipe (`apps/server/src/rejoin-command.ts`), before it removes the rebuild marker;
- promotion (`promoteMirrorRun`, `apps/server/src/boot.ts`): before promoting, where a failed
  deletion refuses the promotion, and again after stopping the backup supervisor and before the
  restart, where a failed deletion is logged and the restart goes ahead;
- placing a handover's accepted copy (`placeAcceptedCopyAtStart`, `apps/server/src/handover-place-copy.ts`);
- placing a spare's first copy (`placeFirstCopy`, `apps/server/src/spare-copy-placement.ts`);
- `waitron.sh reset`, which empties the state folder apart from `tls/` and the Start-again files in
  one removal, taking the note and `venue/` in no set order.

**What the start checks** (`deleteOldBackupsAtStart`, `apps/server/src/start-backup-room.ts`).
Nothing at all at 16 MiB free or more on the venue folder's disk (a full state folder on another
disk is left alone: the step deletes only in folders on the venue folder's disk), or with no note file (so no lock and no env read). Then it
takes the venue lock, or, when that fails other than in use, goes on without it unless the holder
file is fresh. It deletes nothing unless the note is a regular file of at most 64 KiB that parses,
names the box env's node id, and matches `venue.db`'s device number, file number and birth time; no
restore or reset request is waiting; and the recovery key loads. Each note folder is kept only
if its `configuredDir` still leads to the `dir` the note recorded (a link moved while the server
was stopped points backups at another folder), and only if it is on the venue folder's disk now. Each
refusal is logged once `backup.start_room_skipped` with a `reason`, `out_of_reach` among them when
free space plus every deletable backup falls short of 24 MiB. A step still under 24 MiB after its
deleting logs `backup.start_room_short`, whether or not any deletion succeeded; the refusal's
`afterDeleting` tells the two apart. It throws nothing: a failure in the checks or the deleting is
logged `backup.start_room_failed`. Each deletion logs `backup.archive_deleted` with
`reason: "start_room"`.

**The record and the alert.** A step that deleted anything writes
`<state>/backup-room-start-deleted.json` (`BACKUP_ROOM_START_DELETED_FILE`) with `writeFileDurable`:
each deleted archive and the time, for the note's `venue.db`. A record an earlier start left for the
same `venue.db` keeps its entries and the earlier time. A failed write is logged
`backup.start_room_record_failed` and the deletions stand. Boot reads it
(`recordStartDeletions`, `apps/server/src/start-backup-room-record.ts`, at `boot.ts:2238`, before the
backup supervisor's first reload at `:2275`) and records the same `backup.archives_deleted` alert a
backup run raises, then deletes the record. A malformed record, or one for another `venue.db`
(`other_venue_db`), is logged `backup.start_room_record_dropped` and deleted with no alert; an
unreadable record, an unreadable `venue.db` or a failed alert keeps it for the next start.

**The guard.** `scripts/backup-room-note.test.ts`, weaker than its name: it reads text, against two
hand-kept lists. A non-test `.ts` file under `apps/<app>/src` or `packages/<package>/src` that names
`VENUE_FILE`, or `venue.db` after a quote or a `/`, beside one of `rm`, `rename`, `unlink`,
`copyFile`, `cp`, `removeAndSync` or `rmdir`, must be on REPLACES (and call
`deleteBackupRoomNote(`) or on CO_NAMERS with a reason. It does not see a whole-folder `rm` that takes
`venue.db` without naming it, a removal or copy through a function under another name (a wrapper, or
a write such as `writeFile`), a `venue.db` path built from pieces, or shell (`waitron.sh reset`); a
listed file passes on one call, not one per path. The rejoin and promotion deletions are on neither
list, because `boot.ts` and `rejoin-command.ts` do not match: nothing guards promotion's two, and
only the rejoin's wipe, through `db-wipe.ts`, is guarded.

**Deliberate limits.**

- The step deletes without the venue lock on a disk too full to take it, unless a fresh holder
  shows, as the staging clean-up does (`apps/server/src/start-space.ts`).
- A future path that writes a new installation into the same `venue.db` on a primary would pass the
  identity check; only the guard, which reads text, would notice.
- A peer's fence that demotes the box at boot (`boot.ts`, `fenced && axes.singletonRole ===
  "primary"`) is not visible to the step, which checks no role.
- `venue.db`'s device number and birth time are not measured on Linux or in Docker; a mismatch
  skips, which is safe. The in-place-write control in `apps/server/src/backup-room-note.test.ts`, run
  by CI on Linux, is the only receipt that ordinary writes keep them.
- A backup stamped by a clock that ran ahead is one of the run's own limits above.
- A restore that crashes between placing the file and writing its new installation leaves the
  restored file holding the old installation start; the next reload writes a note with it, and a
  backup run reads it the same way.
- A reload whose first note deletion fails leaves the old note; it is trusted only while `venue.db`'s
  identity still matches it.


## Root receipt excerpts moved on 2026-10-23

_2026-10-27, A965: receipt resources now include English without changing Spain's offered receipt languages. The English-resource gap below records the earlier tree._

These passages retain the root instruction receipts moved by A1026. They are excerpts
from `CLAUDE.md` at `0285925d8c0ff55c1e4b86423a0471e78ab6e9b8`, not new measurements.

### General code is English only

Cost: A758-1's starter reasons «Cambio del cliente» were refused only because «cliente» is a declared fiscal word.

### A command name is declared under `waitron.commands`, never `bin`

Nothing builds at install time, so a `bin` under `dist/` is never linked by the install that reads it.

### A change adding third-party code or a binary to the image carries its licence notices, shipped in `/app/third-party/`

Cost: Litestream shipped without its Go modules' notices.

### A housekeeping write on a read path must not take the read down on a full disk

Cost: the equipment read and every non-passive session-checked read answered 507 on a full disk once a stamp was due (A798-B slice 6).

### A read taken while ANOTHER caller's write transaction is open sees committed rows only

Cost: a concurrent read returned rows a rollback then removed.

### A statement this engine refuses backs out ITSELF, not the transaction around it — except a full disk, which sometimes ends the whole transaction

Cost: a full disk read as `cannot rollback`, and a statement after it committed by itself.

### A full disk is not one error code

Cost: a database refused on a nearly full disk was recorded `unknown`.

### Anything that writes or deletes in `<state>/scratch/backup` does it inside the staging turn

Cost: deleting a dump a run reads frees nothing until the run closes it (A798-B slice 7 plan, M3).

### A time stored as text and compared or sorted as text is right only while every writer stores one spelling

Cost: W22 (#1134), a valid shift refused or listed out of order.

### A constraint that lives only in hand-written migration SQL is one regeneration away from gone, and nothing else in the tree notices

Cost: a regeneration dropped 33 foreign keys and 13 unique indexes.

### A drizzle table rebuild on this engine runs with foreign keys ON, so its `DROP TABLE` silently deletes every cascading child's rows, and fails on a `no action` or `restrict` child holding rows

Cost: rebuilds emptied `product_categories` and three menu tables while reporting success.

### A drizzle-kit 0.31.10–0.31.11 generation that rebuilds a table must not also add a column to it

Cost: paid three times.

### Editing a shipped migration file — even only its comments — makes every venue it already migrated refuse to start

Cost: #1036 restored two edited files byte for byte.

### One database per environment

`invoice_series.next_number` carries across and pre-production sales would leave a permanent hole in the production series — which is what Veri\*Factu detects.

### While the box's clock reads more than a minute earlier than the latest fiscal record, no record is written and no route takes or gives back new money

Cost: before the route checks, a probe charged a card on a clock a day behind (A798-B slice 8 plan, E10).


## Root detail moved on 2026-10-26

These excerpts retain the supporting detail and full guard limits from `CLAUDE.md` at
`fa3e76787188a08a8367477202cb03e5840d1b7d` before A1114 shortened the root entries.
They are source excerpts, not new experiments or changes to the rules.

### Error codes name the DOMAIN CONCEPT, never the throwing package

**Error codes name the DOMAIN CONCEPT, never the throwing package** — `series.not_found`, not
`db.series_not_found`. **Before a venue is live, a code may be renamed or deleted freely; once one
is live, either is a migration** (owner decision 2026-09-26). Either way it is one change in which
every copy in the tree moves or goes; once live, stored copies are rewritten too and a reader
outside this repository accepts both names until both sides are deployed. Stored copies and prefix
matchers, which a grep for the code cannot find, are listed in
[conventions-data.md](conventions-data.md).
`server.*` is reserved for facts about the process itself. Every file that throws a code imports its registry.

### General code is English only

**General code is English only** (owner, 2026-09-07 and 2026-10-19): no Spanish, Catalan or other
non-English text in any general package or app — not in a literal, comment, identifier, file name,
seed or starter content, or test. It belongs only in `packages/fiscal-verifactu`, AEAT's
wire-protocol names, translation files (such as a module's `dashboard/strings.ts`, an app's
`apps/<app>/src/i18n/`, and the guides under `apps/server/src/guide/<language>/`), and the
packages written for Spain (`country-es`, `workforce-es`, `reporting`'s modelo 303), which hold
text official only in Spain, Spanish-specific terms, and Spain-only printed text in Spain's
official languages (owner, 2026-10-20, A913). Every country pack must also provide English, and
demo data belongs in its country's pack — neither is true yet (A965, A971, A972); a receipt in
Spain prints in the venue's receipt language, never English; A963 and A965 fix what does not yet.
_2026-11-04 (A971): the historical paragraph above predates the holiday and holiday-area English
display fields in `country-es`. Their official names remain the annual-rule keys; the calendar
and readiness screens select the display text by language. See `packages/country-es/src/holidays.test.ts`
and `packages/venue-service/src/opening-hours-calendar.test.ts` for the data and read checks._

Starter content (module seeds, core setup) is English in code and translated at setup; its words
in other languages go in the writing package's `src/starter-content.ts`, which the guard skips by
exact path (owner, 2026-10-20, A918); a test of a non-English screen reads its expected text from
the strings file. A Spanish domain term
has one declaring home, its module's vocabulary; a fiscal term never goes in the base list. Guard:
`scripts/english-only.test.ts`, weaker than its name — it refuses only listed words and accented
letters, reads tracked files only, does not read line by line the files on its still-to-clean list,
and holds each kept file only to its number of findings, so review greps the diff. Detail:
[conventions-data.md](conventions-data.md).

### Multi-table writes share ONE transaction, and `withTransaction` IS that transaction.

**Multi-table writes share ONE transaction, and `withTransaction` IS that transaction.**
Write-path functions take a `tx: Transaction` and never open their own; a route handler opens
exactly one `withTransaction` per request. This is a convention, not a compiler guarantee. A
secret check should be the exception: it takes the `Database` and derives its key with no
transaction open (identity's `checkPin`, `checkManagerPassword`,
`checkOwnPassword`), and a new route that forgets the early check, or forgets to take turns
(`inTurn`, `apps/server/src/attempt-turns.ts`), derives
under the lock or once per attempt in a burst, unnoticed. **Splitting one logical change across
transactions is a commented decision, never a default.** **Queries on one transaction are awaited
in turn, never `Promise.all`.** No guard enforces it.

### A housekeeping write on a read path must not take the read down on a full disk.

**A housekeeping write on a read path must not take the read down on a full disk.** The last-seen
stamp gives way to a full disk (`readDeviceProof`, `requireSession`, `authenticateAgent`, and the session checks of the
Box status routes in `box-health-api.ts` and the bell's reads in `alerts-api.ts`); a read that
must answer while a change waits reads in `withWriteLock` turns with no drain, as the equipment
and Box status reads do, and the bell's reads after a full-disk refusal — a stated exception to
one `withTransaction` per route. Guard: the full-disk cases in
`apps/server/src/start-full-disk.e2e.test.ts`, weaker than the rule — they cover the routes they
name. Receipt:
[conventions-data.md](conventions-data.md#a-read-on-a-full-disk-must-not-fail-on-its-own-housekeeping-write).

### A statement this engine refuses backs out ITSELF, not the transaction around it — except a full disk, which sometimes ends the whole transaction

**A statement this engine refuses backs out ITSELF, not the transaction around it — except a full
disk, which sometimes ends the whole transaction** (as `RAISE(ROLLBACK)`, `INSERT OR ROLLBACK` and
`ON CONFLICT ROLLBACK` always do), **and a `RAISE(FAIL)`, `INSERT OR FAIL` or `ON CONFLICT FAIL`,
which keep the rows their statement wrote before it** (no product code uses any of the six). So,
apart from those exceptions, catching a refusal and carrying on in the same `tx` is safe. A full
disk answers `storage.disk_full`, and after one that ended the transaction the store refuses every
later statement in that body — inside the write queue; a transaction opened outside it in between
defeats this. **A TEST still catches such a refusal OUTSIDE the transaction**, around the whole
`withTransaction`, and no guard enforces that. Guard: `packages/store/src/disk-full.test.ts` and
`write-queue.test.ts`, weaker than their names — a page limit, not a real disk, and both at-commit
cases are a stand-in. Receipt:
[conventions-data.md](conventions-data.md#a-refused-statement-does-not-abort-the-transaction-here-and-all-a-savepoint-still-buys-is-confinement-of-a-losing-attempts-own-writes).

### A refusal under result code 1811 is identified by its words, never by `isRefusal` alone.

**A refusal under result code 1811 is identified by its words, never by `isRefusal` alone.** An
`ON DELETE RESTRICT` key and every trigger's `RAISE(ABORT)` share the code; `restrictRefused` and `triggerRaised` (`packages/db/src/constraint-target.ts`) read the message
too. Nothing guards it.

### A full disk is not one error code

**A full disk is not one error code**: measured 13, 14, 4874 and the system's `ENOSPC`, by
filesystem and by step, and 14 also comes from a missing folder; the start names one with
`fullDiskFailure` (`apps/server/src/boot-failure.ts`) — 13 always, the others only under 16 MiB
free. Guard: its cases in `apps/server/src/boot-failure.test.ts`, weaker than the rule — stubbed
errors, and no real-disk case reaches `ENOSPC`. Receipt:
[conventions-data.md](conventions-data.md#a-full-disk-is-not-one-error-code).

### One process owns a venue folder at a time.

**One process owns a venue folder at a time.** `openVenueStore` holds `venue.lock` and refuses a
second PROCESS (`provisioning.database_in_use`); opens inside one process share the hold. A tool
documented to run beside the server passes `exclusive: false`; a command that changes the
folder's files takes `lockVenueDatabase` before its first change. Never unlink `venue.lock` or
`recovery.lock`; every change to `recovery.json` goes through `updateRecoveryState`. Guards:
`packages/store/src/venue-lock.test.ts` and `apps/server/src/recovery-race.test.ts`, weaker than
their names — each proves the lock, not that every caller takes it. The Litestream child, the
holder file and the watchdog are in [conventions-data.md](conventions-data.md).

### A duty `bootServer` starts pushes its stop onto `undoOnFailure` as soon as it exists, before the next step that can throw

**A duty `bootServer` starts pushes its stop onto `undoOnFailure` as soon as it exists, before
the next step that can throw** (`apps/server/src/boot.ts`), or a failed start leaves it running on
a store the unwind has just closed. The landing listener, started last, is the one step not on the
list. Guard: `apps/server/src/boot.failed-start.test.ts`, weaker
than its name — it covers only the duties it names.

### `packages/db/src/schema/columns.ts` is the only file that names the engine's column and table types.

**`packages/db/src/schema/columns.ts` is the only file that names the engine's column and table
types.** A table declares `id`, `money`, `label`, `table` and the rest from there, never `text()`
or `integer()` straight from `drizzle-orm/sqlite-core`. One scoped exception: `text` in
`packages/fiscal-verifactu/src/schema/registros.ts`. Guard: `scripts/column-vocabulary.test.ts`,
weaker than its name — it reads the import line as text and forbids only the builders the
vocabulary itself imports, so `blob` passes anywhere.

### A money column holds a count of whole cents, and the conversion happens AT THE ROW

**A money column holds a count of whole cents, and the conversion happens AT THE ROW**
(`packages/shared/src/cents.ts`: `decimalToCents` in, `centsToDecimal` out, `rawCentsToDecimal`
for a raw-SQL read, which casts `cast(x as text)`). Above the row every amount stays the exact `Decimal`; a money
total summed out of JSON is summed in JavaScript at the money scale. **Nothing guards the boundary
itself, and there is no LOUD form of getting it wrong**. Guards, both narrower than their names:
`packages/db/src/schema/columns.test.ts` and `packages/shared/src/conventions.test.ts`.

### A quantity column counts whole thousandths and a rate column whole basis points; neither is the money scale

**A quantity column counts whole thousandths and a rate column whole basis points; neither is the
money scale** (`packages/shared/src/scales.ts`, beside `cents.ts`). A blanket "every numeric
becomes cents" does not EMPTY a quantity, it misreads one. The converters hold the bound, because
an integer column does not; the raw quantity reader reads totals, so like the money one it bounds
only at what a number counts exactly. A rate's CHECK constraint is written
against 10000. Guard: the shared schema-conformance suite,
`packages/db/src/testing/schema-conformance.ts`, which a migration set opts into — a set with none
is unguarded.

### A new table is classified `ledger`, `state` or `local` in the `<MODULE>_CLASSIFICATION` list of the package holding its migration set, and a table that must never be corrected is declared with `appendOnly()` instead of `classify()`

**A new table is classified `ledger`, `state` or `local` in the `<MODULE>_CLASSIFICATION` list of
the package holding its migration set (`packages/db/src/classification.ts` for core's), and a table that must never be corrected is declared with `appendOnly()` instead of
`classify()`** — `applyMigrations` turns those declarations into a `RAISE(ABORT)` trigger pair,
but only from a `migrationOptionsFor(...)` result; a plain options array gets none of those
triggers, silently. **The CLASS is not the trigger set.** A trigger cannot refuse `DROP TABLE`.
A release that marks an EXISTING table `appendOnly()` says so in its PR description: a box's
first start on it can raise `append_only.triggers_restored`.
Guards: `scripts/classification-complete.test.ts`, `scripts/append-only-triggers.test.ts` and
`scripts/apply-migrations-callers.test.ts`, the last weaker than its name — it checks the call's
shape, not the sets handed to it.

### A streamed `venue.db` holds two tables no migration created, and its folder a directory no store opened

**A streamed `venue.db` holds two tables no migration created, and its folder a directory no
store opened** (Litestream's `_litestream_seq`, `_litestream_lock` and `.venue.db-litestream/`).
Code that lists a live or restored database's tables, or that empties, copies or restores the
venue folder, must expect them; no guard finds a new site that does not.

### Anything that works as a live login is stored as a hash, because a primary streams the whole database to the owner's bucket once one is set up

**Anything that works as a live login is stored as a hash, because a primary streams the whole
database to the owner's bucket once one is set up** (`hashSessionToken`, `@waitron/identity`).
Guards, weaker than the rule: the "what a copy of the database holds" cases in
`apps/server/src/me-api.test.ts` and `apps/server/src/till-api.test.ts` present the row's id
alone, and only the dashboard's stored hash (`packages/identity/src/management-session.test.ts`)
and a device token's (`packages/identity/src/device-token.test.ts`, at the function, not through a
route) are tried as a token; a new login table is seen by nothing.

### A migration set depends on another when its SQL `REFERENCES` one of that set's tables, puts a `CREATE TRIGGER … ON` one of them, names one inside a trigger's body, or writes one at top level — and the `requires` of the module owning the set must name it.

**A migration set depends on another when its SQL `REFERENCES` one of that set's tables, puts a
`CREATE TRIGGER … ON` one of them, names one inside a trigger's body, or writes one at top level —
and the `requires` of the module owning the set must name it.** A module whose tables live in
another module's set has no SQL of its own, and the guard compares its `requires` with nothing. The engine will not catch a
missing body target. Guard: `scripts/module-graph-honesty.test.ts`, weaker than its name — it
reads SQL as TEXT and recognizes a fixed set of statement shapes.

### A constraint that lives only in hand-written migration SQL is one regeneration away from gone, and nothing else in the tree notices.

**A constraint that lives only in hand-written migration SQL is one regeneration away from gone,
and nothing else in the tree notices.** Declare every foreign key and every unique index in the
TypeScript schema; where one genuinely cannot be declared, say at the column what it cost and
where the refusal moved to. Guard: `scripts/schema-constraints.test.ts`, weaker than its name — it
reads the built schema rather than trying an offending insert, and matches a unique index by NAME.

### Drizzle picks what to apply from `max(created_at)` alone

**Drizzle picks what to apply from `max(created_at)` alone**, never from a position in the journal,
so an entry at or below a recorded watermark never runs and drizzle raises nothing. Guard:
`scripts/journal-monotonic.test.ts`, which bites only on a set with more than one entry. A drizzle
bump starts with `grep -rn 'dialect.js'`.

**2026-11-12 update:** the historical boot/bucket-only statement below now has the A950
upgrade data checker as a third caller; see the current ahead-of-image section above.
The current [manual Restore/Keep path](../../deploy/README.md#checked-manual-upgrades) also
supersedes the earlier one-way-door description below.

### The box's BOOT path and the bucket rebuild carry an ahead-of-image check; no other migrating path does, and `waitron.sh install <ref>` is a one-way door.

**The box's BOOT path and the bucket rebuild carry an ahead-of-image check; no other migrating
path does, and `waitron.sh install <ref>` is a one-way door.** `assertNotAhead` throws
`provisioning.database_ahead`. Every other migrating path runs
without the check; the full list is in [conventions-data.md](conventions-data.md).

### `registros_facturacion` is immutable

2026-11-14: the current trigger rule above also includes existing optional-module tables; the following root excerpt records the earlier table-selection limit.

**`registros_facturacion` is immutable**: it is declared `appendOnly()`
(`packages/fiscal-verifactu/src/classification.ts`, beside the two filing-case tables), so `applyMigrations` puts a `RAISE(ABORT)`
trigger on its updates and its deletes. Do not work around them; a value written wrong there stays
wrong. That trigger pair is the WHOLE of the enforcement — the engine has no permissions, and a
`DROP TABLE` is refused by nothing at all. A start (after migrating, which puts back a dropped
trigger whose table is still there) and a 10 s check while trading refuse to trade on a missing
or changed trigger (`apps/server/src/append-only-watch.ts`) — weaker than its name: stored text
only, and only the tables the start migrated.

### Never put our own metadata into a hash.

**Never put our own metadata into a hash.** `entorno` is ours, not AEAT's; a test pins that two
records differing only in it hash identically. In `computeHuella` it would make every chain
unverifiable under the other environment.

### Restore and promotion start a new chain under a new installation name.

**Restore and promotion start a new chain under a new installation name.** A working box keeps its
identity and chain; there is no operator chain-reset path. A setup, restore or promotion names
its installation from the box's clock — five symbols for the UTC minute — only after a check
against a clock on another machine (within 30 seconds, no confirmation). The minute is not taken
when a name in the history the box reads already holds it: the module's own record of the names it
has chosen, earlier abandoned attempts of the same setup, a restored or surviving database and a
backup's record of names. A later name or a later record is never a reason to refuse or to pick a
later minute, except the one named below (owner, 2026-10-29 ~10:52, A1207: "If later invoices exist then they are wrong, we
should flag them up to be dealt with (how?) but it doesn't stop us from issuing the correct series
based on the current minute, just as long as that minute series doesn't exist in the database
already."). The one later name that still refuses is the attempt's own pick when the box's clock
has gone back behind it (`packages/fiscal-verifactu/src/hour-selection.test.ts`, "a backward clock refuses existing material and retains its spent hour"). Receipts in `packages/fiscal-verifactu/src/hour-selection.test.ts`: "$action selects as
with an empty history beside $later", "waits for the next minute when the current one is known" and
"a restore's recorded wait meeting %s, in use, at %s waits for the next free minute"; in
`packages/fiscal-verifactu/src/minute-selection-unknown-name.test.ts`, "selected although a later
name is known"; on the server, `apps/server/src/hour-promotion.test.ts` "a promotion takes its
current minute although a later installation name is recorded",
`apps/server/src/hour-recovery-host.test.ts` "selects at the ordinary wait although the backup's
newest record is later" and `apps/server/src/hour-recovery-placement-3.test.ts`
"places an older selected hour over a newer surviving %s destination"; a new setup attempt is
compared with abandoned ones by exact name only (`apps/server/src/first-setup-retired-assignments.test.ts`,
"an attempt after an abandoned one may take a minute earlier than the abandoned attempt's name" and "an abandoned
attempt that chose the same minute still refuses the new one"). The module's choice refuses a minute
in use with the reason `minute_in_use`; the setup and restore pages wait it out with one countdown
and check again by themselves (`packages/fiscal-verifactu/src/setup/clock-wait.browser.test.ts`, "a
taken minute shows one countdown and checks again quietly"), while an attempt whose own pick has
turned up in use is still refused, with no time (`packages/fiscal-verifactu/src/hour-selection.test.ts`,
"a pick is refused when a record naming its own minute appears after it"), and the pages and the
setup app call that a fault in Waitron (A1385: `packages/fiscal-verifactu/src/setup/clock-wait.ts`,
`clockWaitStrings` `inUse`; `apps/setup/src/setup-app.test.ts`, "shows a stored series pick found
taken at activation as a fault in Waitron, without a retry, in both languages"); the setup's comparison with abandoned attempts refuses an identical name as `setup.attempt_conflict` (the second case above). The name is
refused once more when it is written: activation refuses `installation_used` and `series_collision`
against the database being written (`packages/fiscal-verifactu/src/allocation.ts`,
`validateForActivation`; `packages/fiscal-verifactu/src/hour-standby-activation.test.ts`, "also
refuses reuse after the original SIF and every original series are retired").

What this accepts. A restore of a backup whose invoices are dated after the box's time completes
(`apps/server/src/hour-recovery-host.test.ts`, "a restore below the backup's newest invoice names
its minute, and the sale after it is taken, dated by the box's clock"; the case runs the restore's
hooks, not the restore route and the restart after it). A later name held only in a database a restore replaces
is not in the database the restore places (the placement case above reads only that database's series). A box and the machine
confirming its clock, both behind by the same amount, can name a minute in the past (`packages/fiscal-verifactu/src/minute-selection-unknown-name.test.ts`, "W: the box and another
device wrong together, behind the true time"); only that exact minute being in use refuses
it. No alert names a later installation name with no invoices under it, or the series names (A1207
plan, review experiment #7, a promotion only). A setup or restore waits
90 to 150 seconds first (`packages/fiscal-verifactu/src/hour-selection.test.ts`, "restore waits
until a minute start 90 to 150 seconds after its check"); a promotion does not
(`packages/fiscal-verifactu/src/hour-selection.ts`, `settles` is setup and restore only).

Start again keeps no record of the names it deletes (owner, 2026-10-29, A1206: "I think we must
remove this concept of storing the used series name on disk. It introduces too many
complications. We use the current minute, with confirmed clock times, and the latest invoice
numbers if we have any."). This retired A1042's start-again note (`first-setup-start-again.json`)
and every floor built on it (A1098's Move floor, A1099's damaged-name-record floor, A1131's
counting of a held setup database's names). A leftover note file is ignored (the "leftover
start-again note file" cases in `apps/server/src/first-setup-start-again.test.ts`,
`hour-promotion.test.ts` and `hour-recovery-host.test.ts`), and a plain `waitron.sh reset` deletes
it (`scripts/waitron-sh.test.mjs`, "the reset's state clean-up keeps tls/ …"). What keeps a later setup or restore from repeating a forgotten name
is the clock check plus the wait: a name is written only once the box's clock reaches its minute,
and the next setup or restore targets a minute more than 90 seconds after its own clock reading, so
two attempts whose boxes are each within 30 seconds of the true time cannot share a name
(`packages/fiscal-verifactu/src/hour-selection.test.ts`, "a $action that has forgotten an earlier
attempt's name still names a later minute when each clock was within 30 seconds"). The accepted
limit: if a box and the machine that confirms its clock are both wrong by the same amount, the check
passes, and that setup can repeat an earlier attempt's name once its clock is more than about 90
seconds behind the earlier attempt's. A promotion has
no wait, so it relies on coming long enough after a Start again (up to 120 seconds with each box
30 seconds off); that is reasoning about how long joining as a standby takes, not measured.

The one exception to the second clock and the history check is the preproduction throwaway, which names with no second clock and no history check
and is refused outside preproduction. Guards: `packages/fiscal-verifactu/src/hour-selection.test.ts`,
`packages/fiscal-verifactu/src/hour-clock.test.ts` and
`packages/fiscal-verifactu/src/minute-selection-unknown-name.test.ts`, the last weaker than its
name. One restore takes one source, never both. The working-time chain continues from the
backup's head. Guard: `packages/workforce/src/restore-continuation.test.ts`. Who takes the
throwaway, what the last guard misses, and the restore's key and source rules:
[conventions-data.md](conventions-data.md).

### On a node that files, every start puts each sale left "being sent" back to waiting before its first filing pass

**On a node that files, every start puts each sale left "being sent" back to waiting before its
first filing pass** (`resetInFlightClaims`, `packages/fiscal-verifactu/src/drain.ts`) — safe only
while no second process files from the database: the server opens the folder exclusively, and the
tools that open it with `exclusive: false` file nothing. Guards: `apps/server/src/restart-reset.test.ts`
and a case in `apps/server/src/boot.test.ts`, weaker than the rule — nothing checks that a
non-exclusive tool never files. Detail: [conventions-data.md](conventions-data.md).


## The node owns fiscal identity

A1154 retires the old operator command and chain-reset action. Setup seeds a new venue; a retry
keeps its existing seeds. Recovery restores a replacement box, or promotes an admitted spare.
Two devices use the same node identity and invoice series. The cross-device chain test also checks
that adding a device leaves the node's series rows unchanged.

`scripts/no-till-as-issuer.test.ts` scans text files for retired spellings and uses the TypeScript
parser for identifiers in fiscal workspace packages, including tests and newly added fiscal packages.
It inspects fiscal tables in a database built by the current migrations, including node ownership
keys on series, SIF identities and chain heads. Device origins on recorded sales remain valid.
Historical specs, plans, named compliance/research records and immutable migration directories are
excluded from the text check. The scanner lists specific old-setting negative-test files; those
files may mention those settings, but they still cannot contain a retired command spelling.
Examples in the scanner tests assemble the retired spellings from fragments; neither scanner file
has a whole-file exception.

The scan cannot recognize the same concept under a different word or in an explanation that uses
none of its exact spellings. It ignores dependencies, build output and symlinks, and only reads its
listed text extensions. The schema check covers the fiscal modules' classified tables and the
core node, sale and series tables, not every possible future ownership relationship.

The text rules recognize their literal spellings, not every variant: the action is lowercase and
hyphenated, its inflections and unhyphenated spelling are not checked, and an underscore is not
the retired command's separator. Text extensions are case-sensitive. The fiscal parser checks
ordinary and private identifiers; quoted property keys remain string literals and are not
identifier checks. These limits also apply to source comments and prose that use different words.
In JavaScript and TypeScript files the text rules also read the decoded value of every string and
template piece, so a spelling such a value holds is refused however its characters are escaped.
Everything else, including comments, regular expressions and identifiers in those files, is read as
raw text: a spelling straight after `\b`, `\f`, `\n`, `\r`, `\t`, `\v` or `\0` is refused, but one
with an escaped character inside it (`re\u002dregister` in JSON) or after another escape ending in a
letter or digit (`\a`, `\e`, `\x1b`) is missed.

On 1 November, A696's pre-push guard found an obsolete location setting and a fiscal test fixture
still named for a till. Removing the unused setting and renaming the fixture preserves its
assertions; focused guard40, server30 and fiscal30 cases pass. A further text search found another
obsolete setting immediately after an escaped newline inside a template literal. The guard, which
then read raw text only, missed it; it now also reads decoded string and template values. The
fixture itself now uses only the supported node identity. The full first hook failed one of 10,091
cases; its earlier format/lint passes do not qualify the blocked push. Logs: Lane E
`receipts/a696-resume-20261101/`.


## Root receipts moved on 2026-10-31

These excerpts retain the root instruction receipts from `CLAUDE.md` at
`a8ce834d69f298f7e062aaf1cd8b587e62be0171`. They are not new measurements.

### Personal log field names

- **A detail or log field holding a person's name, email or tax number uses a name on
  `PERSONAL_LOG_KEYS` or a path on `PERSONAL_LOG_PATHS` (`apps/server/src/log-personal-data.ts`),
  which the server's logger masks in every line it writes; the answer keeps it. Name it for whose
  it is (`guestName`, `customerTaxId`), never a bare `name` or `taxId` (the listed bare `taxId` is
  the venue's own): the list is flat across every code.** Cost: staff names and emails reached the
  sign-in-free recovery page. Guard:
  `scripts/personal-log-params.test.ts`, weaker than its name: reads text, judges keys by a word
  list and a named type only by its name, sees no spread at a throw site or in a log call, no free
  text and not the watchdog's own line. Limits: [conventions-ui.md](conventions-ui.md#the-unauthenticated-recovery-page-curated-title-and-action-the-failed-starts-report-and-the-logs-last-lines).

### Configuration preview field guard

- **A configuration bundle value that is not a setup field stays out of `venue`'s own keys** (the
  privacy contact and content languages travel as top-level fields); the setup app copies the preview's
  `venue` by `country`, `TAXPAYER_FIELDS` and `CLAIM_VENUE_FIELDS`. Cost: from #1752 to A980 S1a2
  no production box could be set up from an export. Guards:
  `apps/server/src/first-fiscal-setup.e2e.test.ts` and `apps/setup/src/setup-app-first-fiscal.test.ts`,
  weaker than the rule: one export shape.
  [Detail](conventions-data.md#a-configuration-bundle-value-that-is-not-a-setup-field-stays-out-of-the-venues-own-keys).

### Spare file release and recovery

_2026-11-04, A1131bc slice 4: the discarded recovery's emptying, the repair page's release and the originals walk are deleted; the root rule now names the start alone._

- **Within the server, only the start (on a nearly full disk, before first-setup resolution), its
  emptying of a discarded recovery and the repair page's Start-again flow delete
  `<state>/spare-space` (`waitron.sh reset` deletes it too); a release writes
  `spare-space.released` (exceptions in the topic file), which holds the till stop, across restarts,
  until a start with room, the free-space watch or Box status's Free button has written the spare
  back whole. It is never venue data, and a recovery's originals walk leaves both out.** Cost if
  not: on a full disk the venue locks cannot be taken, so a recovery's copy could never be freed, and
  a full disk with nothing else to free would serve only the full-disk page (A1127). Guard:
  `scripts/spare-space.test.ts`, weaker than its name: reads text.
  [Detail](conventions-data.md#the-boxs-spare-file).

### Backup room note deletion

- **Every server path that replaces or removes the live `venue.db` deletes
  `<state>/backup-room-note.json` first; `waitron.sh reset` removes both together.** Cost if not: a full-disk start could trust an old installation start and delete backups
  from before a restore or Start again, which can hold sales the live database lacks. Guard:
  `scripts/backup-room-note.test.ts`, weaker than its name: reads text, two hand-kept lists.
  [Detail](conventions-data.md#the-backup-room-note).

### Start again records retention

- **Start again's choice records and set-aside files, under `<state>/records/`, are removed only by
  `waitron.sh reset --all`** (A1042, A1098). Cost if not: the box forgets a Keep or Move choice,
  or deletes files a Move set aside. Guard: `scripts/start-again-records-writers.test.ts`, weaker
  than its name: reads text, never what a listed file does.
  [Detail](conventions-data.md#start-agains-records-and-the-set-aside-folder).

### Fiscal ownership guard limits

- **The node owns the fiscal identity, chain and invoice series; a till is a cash register.**
  Guard: `scripts/no-till-as-issuer.test.ts`, weaker than its name: reads text; misses the same idea
  under another word (terminal, device, caja) and in prose. Limits: [conventions-data.md](conventions-data.md#the-node-owns-fiscal-identity).


## Saved-zone validity uses the stored spelling

A696's 1 November whole-branch review found that the input classifier trimmed a saved zone before
admitting it. Other readers passed the raw column to Intl. A saved `" Europe/Madrid"` or
`"Europe/Madrid "` therefore admitted ordinary boot duties but was ineligible for repair.
The real boot/context/confirmation command first failed six new cases; the direct fiscal caller
resolved instead of refusing two cases. Provisioning reuse reached `business_day.clock_invalid`
instead of its zone preflight refusal. These experiments reproduce the boundary mismatch without
asserting that every raw reader was exercised.

`classifyTimeZone` continues normalizing new input, including the original padded-input case.
`classifySavedTimeZone` asks the runtime about the stored spelling. Raw context, fiscal clocks,
provisioning reuse, completed recovery packs and recovery comparison consume the latter; request,
candidate and country-list inputs retain normalization. Missing blanks, runtime-supported aliases
and unexpected runtime failures retain their separate outcomes. Repair stores an explicitly chosen
canonical name; old raw rows are not silently rewritten. The focused shared, boot, repair,
provisioning and recovery tests retain legitimate controls as well as the padded refusals.

The admission check is not a universal audit of every timezone consumer or boot duty. The boot
suite names the duties it observes. Raw readers beyond these exercised paths remain outside that
receipt. Commands, red/green logs and full review are in Lane E `receipts/a696-resume-20261101/`.


## A replacement cannot wait on the record that waits for it

When admitting a replacement record, trace both directions of the filing dependencies. W41s-8's
1b980095 review reproduced this order: original invoice, unsent cancellation, correction. Selecting
the current invoice version made the cancellation wait for the correction's answer; preserving
queue order made the correction wait behind that cancellation. Repeated passes sent nothing.

The correction action now refuses while an existing cancellation is waiting, completed, failed or
unknown. An ordinary cancellation already set aside by the drainer can be corrected and explicitly
released afterwards. The refusal and that later accepting path run together in
`apps/server/src/fiscal-remedy.staff-refund.test.ts`, including preservation of the actual cash
refund. Those cases cover this action's admission boundary, not every future queue dependency.

## Root receipts moved on 2026-11-02

These excerpts retain the root instruction receipts from `CLAUDE.md` at
`1d03a7c42142478f6ecabc834f08ffd58bd04d07`. They are not new measurements.

### English-only code and its exceptions

- **General code is English only** (owner, 2026-09-07 and 2026-10-19), including literals, comments,
  identifiers, file names, seeds, starter content and tests. Exceptions: `packages/fiscal-verifactu`,
  AEAT wire names, translation files/guides and Spain-specific packages (`country-es`, `workforce-es`,
  reporting's modelo 303) for official Spain-only text/terms (owner, 2026-10-20, A913).
  Country packs also provide English and own demo data; Spain receipts use the venue's receipt language,
  never English. Starter content (module seeds, core setup) is English in code and translated at
  setup; its words in other languages go in the writing package's `src/starter-content.ts`, which
  the guard skips by exact path (owner, 2026-10-20, A918); non-English screen tests read expected
  strings. Domain terms have one declaring module vocabulary; fiscal terms
  never enter the base.
  Guard: `scripts/english-only.test.ts`, weaker than its name: listed words and packages only, no apps;
  review greps the diff. Standing gaps and details: [conventions-data.md](conventions-data.md).

### Configuration bundle keys outside venue

- **A configuration bundle value that is not a setup field stays out of `venue`'s own keys** (the
  privacy contact and content languages travel as top-level fields); the setup app copies the preview's
  `venue` by `country`, `TAXPAYER_FIELDS` and `CLAIM_VENUE_FIELDS`. Cost: from #1752 to A980 S1a2
  no production box could be set up from an export. Guards:
  `apps/server/src/first-fiscal-setup.e2e.test.ts` and `apps/setup/src/setup-app-first-fiscal.test.ts`,
  weaker than the rule: one export shape.
  [Limits](conventions-data.md#root-receipts-moved-on-2026-10-31).

### SQL built by string concatenation

- **Never build SQL by string concatenation — except where the engine takes no bound value**: an
  identifier, and the body of a generated trigger. For those, either escape
  (`quoteIdent`/`quoteLiteral`) or validate and throw.
  Neither is not acceptable; "the callers only pass safe values" is the §1 defect class.

### Two-database lock and save order

- **Across `venue.db` and `node.db`, take `node.db`'s write lock outside `venue.db`'s; save
  `venue.db` first and `node.db` after, so a re-run repairs `node.db` (a signing key is the stated
  exception); write `node.db` through `withNodeTransaction`, since `withTransaction` refuses the node
  handle at compile time.** The two files have independent write queues. Nothing guards the first
  two. [Rules and sites](conventions-data.md#a-local-row-belongs-to-one-node-so-no-foreign-key-may-join-a-local-table-to-a-ledgerstate-one).

### Spare file deletion and release

_2026-11-04, A1131bc slice 4: the discarded recovery's emptying, the repair page's release and the originals walk are deleted; the root rule now names the start alone._

- **Within the server, only the start (on a nearly full disk, before first-setup resolution), its
  emptying of a discarded recovery and the repair page's Start-again flow delete
  `<state>/spare-space` (`waitron.sh reset` deletes it too); a release writes
  `spare-space.released` (exceptions in the topic file), which holds the till stop, across restarts,
  until a start with room, the free-space watch or Box status's Free button has written the spare
  back whole. It is never venue data, and a recovery's originals walk leaves both out.**
  Guard: `scripts/spare-space.test.ts`, weaker than its name: reads text.
  [Cost and detail](conventions-data.md#the-boxs-spare-file).

### Rebuild rehearsal on node:sqlite

- **Rehearse a drizzle table rebuild on `node:sqlite`, never the `sqlite3` command line**: macOS's
  `sqlite3` 3.51.0 refuses the rename the app's SQLite 3.54.0 runs (`no such column: __new_…`), so
  the rehearsal fails a sound migration. Nothing guards it.
  [Receipt](conventions-data.md#a-drizzle-table-rebuild-is-rehearsed-on-nodesqlite-never-the-sqlite3-cli).

### No external dependency on the sale path, and the planned failover

- **Nothing EXTERNAL may block a sale — and a till needs the venue's PRIMARY.** AEAT, the card network
  and the internet are never on the sale path of whichever node is primary: records chain locally and
  the outbox drains later; a card falls back to 4G, a standalone terminal or cash. The till follows
  the primary and never chooses; only the primary sells. Fiscal submission is an outbox, never
  inline. TODAY a venue has ONE node and no failover at all; the intended failover is in
  `docs/backlog.md` → _Replication, membership & failover — residuals_. Detail:
  [conventions-data.md](conventions-data.md).



## First-setup admission reads SQLite facts without a database-sized snapshot

Use `inspectFirstSetupDatabase` for admission. It checks the regular file through a no-follow,
nonblocking open, then reads the tenant and venue rows through SQLite. The resumable record reader
checks the matching ownership pair; the start repeats admission while holding the venue lock.
Recovery inspection still fingerprints artifacts and captures exact originals under its separate
128 MiB snapshot budget. That budget must not decide whether an existing database is readable.

Measured on 5 November 2026 with `pnpm --filter @waitron/server exec vitest run
src/first-setup-growth.test.ts`: real HTTPS first setup completed, its records remained complete,
and a 3,715,072-byte database restarted in trading mode. Inserting 124 synthetic 1 MiB image blobs
into the existing image table grew it to 134,590,464 bytes; SQLite's quick check returned `ok`.
Before the fix, the next start served setup status (HTTP 200) where trading mode has no setup
endpoint (HTTP 404). After the fix, two large-file restarts reach trading mode and health answers
200. A further small-file restart and both large-file restarts forbid file-handle `readFile` and
`createReadStream` calls on the database and its WAL. The test substitutes certificate validation/sealing,
AEAT clock/readiness responses and submission, and suppresses the publication's process stop;
setup, files, SQLite, entry routing and trading boot remain real.

A separate four-photo probe ran real `prepareImage` and `uploadImage` writes. Four independent
1600×1600 random-noise PNGs produced 7,018,348 stored WebP bytes, growing the checkpointed database
from 3,715,072 to 10,735,616 bytes. That measures 7,020,544 bytes of database growth for those four
high-detail test photos, not a venue's average photo size or days to failure. The executable probe
and output stay in Lane F's local A1334 receipts. The committed growth test uses synthetic blobs
to cross the size boundary quickly; it does not measure photo preparation throughput.

Run `pnpm --filter @waitron/provisioning exec vitest run
src/first-setup-resolution-inspection.test.ts` for damaged/missing/symlink refusal checks, inspection
fingerprints and snapshot limits. A large valid database is classified from its SQLite rows even
when its exact recovery snapshot is over budget. Remaining whole-file recovery reads are tracked
in [the setup backlog](../backlog/setup.md#recovery-operations-still-buffer-whole-database-files).

## An open FileHandle ends the process when it is collected

On Node v26.13.0, a real listener answering with `Readable.toWeb(handle.createReadStream())`, with
the client gone before the answer was written and `--expose-gc` forcing a collection, exited 1 with
`A FileHandle object was closed during garbage collection` and `code: 'ERR_INVALID_STATE'`. With a
close on the request's abort it printed `survived` and exited 0; so did a download read to its end.
The file was 2 MB. A 2 KB file exited 0 unfixed too: with nobody reading, `Readable.toWeb` still read
a 60,000-byte file to its end and closed it, and left a 70,000-byte one open, so a test with a tiny
file cannot show this.

The cause is `writeFromReadableStream` in `@hono/node-server` 2.1.5: `else if (writable.destroyed)
return;`. Run with `handover-compare.test.ts`'s two "while the spare waits on a setting" cases, whose
last wait ends the moment M1 sees a second download, so the teardown drops a request M1 is still
answering. At the suite's own 50 ms polling, one of seven runs left a handle open. At a 1 ms polling,
in a scratch copy, all 7 runs before the fix left one open or, under forced collection, raised the
error, and none of 8 after did.

`c.req.raw.signal` reports a connection lost before it is first read, not only after: a route that
first read it after the client left saw `aborted: true`, on 2.1.5 (the listener keeps the reason and
applies it to a controller made later). A finished answer left it `aborted: false`.

A close that fails has its own trap. Closing the descriptor under a handle makes `handle.close()`
reject `EBADF`, and a stream made with `autoClose: false` stays tied to the handle after its read, so
it receives that as an `error` event, and with no listener that exited 1 even though the rejection
was caught. `openIfMatching` keeps a listener on its digest stream for this.

## A till request's person is checked where the sign-in is read

Every request through the till's API client (`TillApi`) but the sign-in names the tab's
signed-in person in the `x-waitron-person` header (`PERSON_HEADER`, `packages/shared/src/person-header.ts`); after a
sign-out a tab keeps naming its last person until the next sign-in or a move to another server. The server compares it with the
person of the device's open session in one function, `personRefusal` in
`apps/server/src/till-session.ts`, called from `requireSession`, from `signedInPersonOn` and from
the sign-out handler (`DELETE /api/session` in `apps/server/src/till-api.ts`). A request naming
nobody or anyone else is refused `session.person_not_signed_in`, except where `signedInPersonOn`'s
caller answers it as for nobody signed in (`GET /api/device/me`, and kitchen-screen requests from a
kitchen display, `apps/server/src/device-api.ts`). A route that read the session's person any other
way would act as that person whatever the header says. What the till does
with the refusal: `docs/backlog/till.md`, "One editor per bill".

The guard, `apps/server/src/till-api.session-person.test.ts`, is weaker than its name. Its walk
sends every route the till, device and schedule mount functions add with Ben's session naming Anna,
naming nobody and naming Ben, and with the device's cookie alone. An answer naming Anna or nobody
must be the refusal or the device-cookie-alone answer, compared by status and error code, never
body, so
`GET /api/device/me`'s narrowing has its own cases in `device-api.test.ts`. A route not in its
`BODIES` gets `"{}"`, so the walk sees nothing past that route's refusal of that body. Its second
case reads `apps/server/src` as text, skipping test files and `src/testing/`, and holds that only
`till-session.ts` and the sign-out handler name `readSessionToken` or `SESSION_COOKIE`; a cookie
name spelt out as a string is missed.

## Root receipts moved on 2026-11-06

These excerpts retain the root instruction receipts from `CLAUDE.md` at
`59be31e3b72b2db0bc5e26f47a1ef305ea052d4c`. They are not new measurements, except that on
2026-11-12 (A1420 PR 5) the clock entry's first rule was replaced by the one that took its place in `CLAUDE.md`.

### Who may confirm or set the clock

- **A record's time is never compared with the latest record's: the start confirms the time, and
  once it is confirmed the box records with its clock however far a later sync moves it** (owner,
  2026-11-10: "if we successfully sync the clock using ntp then we continue to sell, it doesn't
  matter how much the clock changes"); a time a person confirms or sets from their own device is
  never compared with the latest record (owner, 2026-11-11 14:34: "if somebody has confirmed the
  time on their device, then we trust that time and move forward"). After replay, call the seat's
  `refuseUntilRecordable` (by then: waiting, or before 28-10-2024) before reader/refund/drawer
  work; pause both refund recovery loops while waiting. Recheck card-refund send/outcome in their
  dating transaction after provider waits, against the same check. Still store money already
  moved. Guards:
  `packages/fiscal-verifactu/src/chain.earlier-time.test.ts` and
  `apps/server/src/clock-unconfirmed-gate.test.ts`, weaker than the rule: the chain case covers sales
  only, and the gate covers the money routes `clock-unconfirmed-gate.test.ts` lists. **The box's internet time service keeps its clock; Waitron sets it only through the host
  service, from a till's time (a staff member's while the start waits for its time, or during a stop
  until the internet confirms that start or during start-up; a Box administration holder's while the
  start waits or the clock reads before 28-10-2024), a Box administration holder's own device, the
  device showing the clock step of the setup page (under its owner's pass), the restore page (under
  its recovery key or kit) or the handover page (signed in as a `node.manage` holder), when that
  person chooses **This device** (owner, 2026-11-10: "yes"; 2026-11-12: "add \"This device\" to
  #2693 now") — never from devices alone
  and never while it keeps time over the internet — and every step it verifies, or sees move the
  clock by over a second, is alerted and emailed (a step made before the venue exists, at its first
  full start that is neither a mirror nor fenced, unless the topic file's losses apply)** (owner,
  2026-11-10: "we rely on NTP only, we don't bother about AEAT"). **Waitron never reads AEAT's time
  except to warn of drift from its filing replies and, until A1420 PR 4 lands, in the series check
  at setup, restore and promotion (`hour-clock-internet.ts`)** (owner, 2026-11-11 14:34: "Instead
  we rely on NTP"). Guards:
  `apps/server/src/clock-correction.test.ts`, `apps/server/src/clock-set.route.test.ts`,
  `apps/server/src/till-box-clock-api.test.ts`, `scripts/waitron-box-sh.test.mjs`,
  `apps/server/src/setup-clock-set.test.ts`, `apps/server/src/boot.box-emails.test.ts`, weaker than
  the rule: the handler's suite runs stubs, not systemd; the route suites cover the named routes only.
  [Detail](conventions-data.md#the-box-sets-its-own-clock).

### An installation name's minute: waits, refusals and repeats

- **Restore and promotion start a new chain under a new installation name.**
  Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock
  agrees within 30 seconds (no confirmation); a device that has just set the box's clock from that
  page is that machine (A1482 plan, cleared by the watcher 2026-11-12 18:33; not owner-approved); a
  minute whose name is already in a history the box
  reads is not taken (the box waits for the next free one if it starts within 150 seconds, and
  otherwise refuses with when it can; the setup and restore pages count that down and check again by
  themselves; owner, 2026-10-30, A1207), and no other name or record
  refuses or moves it (owner, 2026-10-29, A1207), except that an attempt whose own pick is ahead of
  the box's clock is refused until the clock reaches it. Start again keeps no record of the names
  it deletes (owner, 2026-10-29, A1206): a box and the machine confirming its clock, wrong by the
  same amount, can repeat a name. Setup/restore wait 90–150 seconds; promotion does not.
  [Detail](conventions-data.md). Only preproduction throwaway skips
  second-clock/history checks; refuse it outside preproduction. Restore takes one source;
  working-time chain continues from its head. Guards: hour-selection/hour-clock/minute-selection-
  unknown-name suites (the last weaker than its name) and
  `packages/workforce/src/restore-continuation.test.ts`.


## A module's settings are one document in the shared settings table

The venue's name and five address fields live in core's non-transferring `settings.venue`
document. Read them through `readVenue`; write them through `createVenueSettings` at setup or
`saveVenueFields` inside the caller's transaction. `readVenueClockAndPlace` joins the document
into its clock query. The fields still travel in a configuration bundle's `venue` object.

**2026-11-10, A1308 slice 5b:** configuration format 13 keeps those venue keys while refusing
older exports after the core reset.

**2026-11-10, A1308 slice 5c:** receipt languages, content languages and holiday area share this document. Format 16 carries `contentLanguages` and `holidayArea` at the bundle’s top level; receipt languages remain in `venue.invoiceLocales`.

**2026-11-11, A1308 slice 5d:** fiscal territory and the temporary operation description also live in
`settings.venue`; vb6 removes the description. Read the saved time zone verbatim from
`settings.business_day`, including an invalid or empty string so the zone repair can see it.
Its revision is the clock revision: setup starts at 1, and a time-zone edit, dated-start edit or
repair saves that document through `saveSettings`. New input is checked by those writers.
`readVenueClockAndPlace` reads both documents and the dated starts in one statement. Day-start
rows reject updates; a daily close covering the preceding business day also prevents deletion.
The editor retains the time-dependent history check that the database cannot make without a zone.

Declare a document with `defineSettingsDocument`, read it with `readSettings`, and save it through
`saveSettings`, the only writer (`packages/db/src/settings.ts`). The checker returns the normalised
value that is stored. A save names the revision you read; map `settings.out_of_date` to HTTP 409.
Map `settings.invalid` to HTTP 500 when reading a stored document: the box holds data its code
refuses. See the fixed interfaces in
[the settings plan](../superpowers/plans/2026-11-08-a1308-1b-settings-table.md#interfaces-fixed-by-this-slice).

Before go-live, a read refuses a stored version other than the definition's. The first shape change
after go-live adds one tested upgrade per version, applied on read and saved on the next save,
never in a migration, plus the backup measurement in tables-venuebox §8.3
([design U2](../superpowers/specs/2026-11-02-rationalisation/README.md)).
The live type is `settings.<module>`: declare the document in the module's `settings` seat and make
the dashboard query depend on that string. Every settings save records `settings.saved` with the document key, saver and new revision, never
a document value. Configuration import uses the same writer with no saver and revision 1; clearing
an omitted document creates no save entry.

Configuration copies carry each saved document whose definition has `transfers: true` as
`settings.<module>: { version, doc }`. Import checks every document before writing, then replaces
only the transferring modules' rows, at revision 1 with no saver. An omitted document clears its
row and reads as defaults; other modules' rows stay. Before go-live another document version is
refused, never converted. Keep row ids out of copied documents: this path does not rewrite JSON
references (design R4).

Keep row ids out of documents, except the short lists owned by one row allowed by design R4.
A per-module database rule is a pair of triggers in `packages/db/triggers/core.sql`, named
`settings_<module>_<rule>_insert` and `_update`: `before insert` and `before update of doc on settings`,
with `when new.module = '<module>'`, raising the domain code through `raise(abort, '<code>')`.
Match that refusal with `triggerRaised`. A rule is never a CHECK, which would require rebuilding
the shared table. The per-module cases in `packages/db/src/settings.test.ts` exercise both writes
and a different module's accepting control.

`scripts/settings-not-migrated.test.ts` scans migration and trigger SQL for writes; it does not see
TypeScript run during migration or start. The pinned-CHECK case in `packages/db/src/settings.test.ts`
reads the built table's text and checks the four shared constraints, not what each enforces.
Nothing checks that documents hold no row ids or that a module declares its document in its seat.

## Root receipts moved on 2026-11-09

These supporting fragments are from `CLAUDE.md` at
`c7ca274eeb1426f64a825164ee3411630545efcd`. The headings identify their unchanged root entries.

### Till person-header guard

> , statuses rather than bodies, and a text check for the
> cookie.

### Module migration-set guard

> , never whether a module can be switched off.

### Schema constraint guard

> , never offending writes; matches unique indexes by name.


## `activity_log` is for people to read, and one function writes it

The owner's 4 November 2026 decision ([design R2](../superpowers/specs/2026-11-02-rationalisation/README.md))
keeps product decisions out of the activity log. A screen may join other tables to entries for
display. It must not use history to allow or refuse an action, count towards a limit or choose the
next action. Nothing guards the readers' callers; review holds this rule.

Write through `recordActivity(tx, entry)` in the caller's transaction. Declare the kind, its data
shape and its subject kind in `packages/db/src/activity-kinds.ts`. `person_id` means the person
who acted; a person acted upon is the subject. The readers resolve actor and subject names from
`persons` when they read, so anonymising the person changes the displayed name.

The registry's rules apply to every kind:

- Data contains no person's name, email, telephone or tax number, and no guest health details.
  People appear as ids in the actor or subject, or in declared `personFields` (built with dv17).
  A980 cannot erase a name copied into an append-only row. The taxpayer's legal name is the sole
  exception, reserved for vb2: the taxpayer is not a `persons` row and fiscal records already keep
  that name.
- Older rows must still satisfy a kind's data shape. Add an optional field or a new kind.
- Ids inside data have no database key and may name a row that has gone. Nothing decides from them.
- State any additional privacy rule beside the kind, such as keeping an allergy answer's count only.

Data keys use camelCase. These rules override the appendices' `authorized_by` / `print_job_id`
spellings and tables-devices' suggestion to copy people's names: A980 anonymises `persons`, while
activity rows cannot change. Labels of things, such as menus and roles, may still be copied.

The writer fixes the subject kind. With a literal kind and data object, TypeScript checks the
declared fields; variables, spreads and union kinds can bypass that check, so review still checks
what each caller records. There is no CHECK listing kinds, subjects or data shapes. For an unfinished first
setup, core lists `activity_log` in `startAgainDeletable`, so import history cannot block Start
again; invoice and accepted-record refusals still apply. Actor and device keys refuse deletion of their referenced rows.
The source guard `scripts/write-path-tables.test.ts` restricts writes to the writer's file; it reads
text, judges files rather than call chains, and misses the spellings and paths its header lists.
It does not validate runtime data or guard reads. See
[the approved interfaces and decisions](../superpowers/plans/2026-11-08-a1308-2-activity-log.md#interfaces-fixed-by-this-slice).

## Root receipts moved on 2026-11-10

These supporting fragments are from `CLAUDE.md` at
`9ca4c3cf28787d47bba1f62f1522f49f074cf353`. The headings identify their unchanged root entries.

### A module's configuration is one document in the shared settings table

> Guards: `scripts/settings-not-migrated.test.ts` (weaker than the rule:
> reads SQL text, not TypeScript run at migration or start) and the pinned-CHECK case in
> `packages/db/src/settings.test.ts` (reads the built table's text, not what each check does).

The full limits are in
[A module's settings are one document in the shared settings table](#a-modules-settings-are-one-document-in-the-shared-settings-table).

### A column of a transferred table that holds another row's id

> A short id list kept as JSON (design R4) declares
> `jsonReferences`: export prunes it, import rewrites it, and deletion clears it with
> `removeIdFromJson`.

How each path treats the list is in
[the transferred-table section](#a-column-of-a-transferred-table-that-holds-another-rows-id-is-a-foreign-key-a-declared-references-entry-or-left-out-of-the-export).

## Root receipts moved on 2026-11-11

These excerpts are from `CLAUDE.md` at `62a38292d2cd628ec2bae8eff3fa6bfba47e95bb`; they are not new
measurements. Each heading names a root entry that still names its guard and says the guard is
weaker than its name or the rule; the excerpt is the original sentence, which says what the guard
does not see.

### General code is English only

> Guard: `scripts/english-only.test.ts`, weaker than its name: listed words and accented letters
> only, and files on its still-to-clean list not line by line; review greps the diff.

### A change adding third-party code or a binary to the image carries its licence notices, shipped in `/app/third-party/`

> Guard: the third-party blocks in `scripts/deploy-image-env.test.ts`, weaker than their name — they
> read text, and a new binary or system package is seen by none of them.

### State-folder names live in `packages/store/src/state-layout.ts`, except Cloud and legacy setup names awaiting their layout slices; a plain reset keeps exactly its `kept` entries

_2026-11-11, A1308 fl4: Cloud names now live in the layout. See [One state-folder layout](#one-state-folder-layout) and the current root rule; this excerpt retains the earlier wording._

> Guard: `scripts/state-layout.test.ts`, weaker than its name: reads text, and sees only a constant
> or a join from the state folder.

### A state file is replaced through `writeFileDurable`; the guard names existing exceptions, without checking whether they flush, and the venue-holder heartbeat stays unflushed on purpose

> Guard: `scripts/durable-writes.test.ts`, weaker than its name: it reads text, finds only three
> rename spellings in files importing fs, and never proves a listed writer flushes.

### Anything that writes or deletes in `<state>/backup-staging` does it inside the staging turn

> Guard: `scripts/backup-staging-touchers.test.ts`, weaker than its name — it reads text and never
> checks that a file takes the turn; the turn is in-process only.

### A `local` row belongs to one node, so no foreign key may join a `local` table to a `ledger`/`state` one, in either direction

> Guard: `scripts/two-file-foreign-keys.test.ts`, weaker than its name — it reads drizzle's
> generated snapshots, not hand-written SQL.

### Store anything that works as a live login as a hash

> Guards: database-copy cases in `apps/server/src/me-api.test.ts`,
> `apps/server/src/till-api.test.ts` and the stored-hash cases in
> `packages/identity/src/management-session.test.ts` and
> `packages/identity/src/device-token.test.ts`, weaker than the rule: limited credentials, only the
> dashboard and device hashes tried as a token; new login tables unguarded.

### `requireManagementChangeFromOwnPage` checks the page of a change carrying the dashboard's cookie, ahead of every main-app route after the request-id middleware and every waiting-app write route; register none ahead of it

> Guards: sweeps in `apps/server/src/boot.management-origin.test.ts` and
> `apps/server/src/waiting-start.test.ts`, weaker than their names: one attack, own app's routes as
> mounted; recovery, first-setup, landing, node-entry apps unseen.

### A column of a transferred table that holds another row's id is a foreign key, a declared `references` entry or left out of the export

> Guard: `scripts/id-columns-are-references.test.ts`, weaker than its name — it knows an id column
> only by a name ending `_id` or `_ids`, and a JSON column only by a `json_valid` CHECK naming it.

### A box holding a `node_handover_restriction` row starts restricted, before every worker; a background duty is stopped through `apps/server/src/background-duties.ts`, or is a job on the runner whose mark in `apps/server/src/job-catalogue.ts` says it stops at a stepdown or why it keeps running

> Guards: `apps/server/src/boot.restricted-quiet.test.ts` and
> `apps/server/src/handover-stepdown.test.ts`'s "every closer is either atStepdown or carries a
> reason" and `apps/server/src/job-catalogue.test.ts`, weaker than their names: one five-second
> watch of named services, and a field's presence, not what the duty does; none sees a duty boot
> starts but leaves out of the table.

## Root receipts moved on 2026-11-14

These excerpts are from `CLAUDE.md` at `6504819171ef04d2f95b81e19f4eb8eba028d33e`; they are not
new measurements. Each heading names the root entry the excerpt was cut from; the entry keeps its
rule, guard and pointer.

### Every start of a box that files records writes no fiscal record and moves no money until its time is confirmed

> (owner, 2026-11-10: "we rely on NTP only, we don't bother about AEAT … If we are not on the
> internet then we either wait for two devices … Or we stop and ask a user to confirm that our
> current date+time is correct (or we ask them to correct it)"; "Orders still go").

> weaker than the rule: the seat's four writers and the money routes
> `clock-unconfirmed-gate.test.ts` lists, on a seat wrapped as boot wraps it, and one cash sale
> through boot; the record remedies, off in production, are outside it.

_2026-11-14 (Q37-FIX): production now enables the correction record, for rejected records only; its route asks the start's
gate, and `boot.start-clock-gate.test.ts` sends one correction-record request through boot._

## Bound peer requests before parsing them

When you add a box-to-box or handover request route, set a finite incoming byte budget before its
handler parses the body. Use `peerBodyLimit` in `apps/server/src/peer-route-limits.ts` for new
routes. Backup settings retain their existing `bodyLimit` and `spare.settings_invalid` response;
emergency backup uploads retain `readUpload`'s larger budget. In `promote-api.ts`, keep the
mirror's local-only promotion refusal ahead of body reading.

Add the route to `apps/server/test/peer-route-inventory.ts`, and add a new mount function to
`mounted()` in `apps/server/src/peer-route-limits.test.ts`. Use a `null` budget only for a route
that reads no body, is local-only, or uses the existing upload reader. Run
`pnpm --filter @waitron/server exec vitest run src/peer-route-limits.test.ts` for the mounted
limits and `pnpm exec vitest run scripts/peer-route-inventory.test.ts` for registration coverage.
The source guard is weaker than its name: it sees literal `app.get` and `app.post` registrations
in server source, in the listed namespaces only. Other method calls, router variable names,
template-literal or computed paths and new namespaces are outside it. Within the mounts it
names, the mounted test checks every registered method and path against the shared inventory.
