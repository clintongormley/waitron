# A1301 S18 — Contract and type cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Parent plan:** [`2026-11-01-a1301-remove-location.md`](2026-11-01-a1301-remove-location.md). Its
"Rules every slice follows" apply to every task here unchanged: the fiscal pair, the guard groups,
the shared done-check (the design's grep, `P` and `PATHS`), "Calls into another slice's file",
"Exported functions behind a module contract keep their `cfg`" (S18 is the slice that removes
them), "Cross-location tests are deleted, not rewritten", and "deletes a test case by its title,
never by its line number". **Design:** [`2026-11-01-a1301-remove-location-design.md`](../specs/2026-11-01-a1301-remove-location-design.md)
§6, S18's row. **Venue id:** [`2026-11-04-a1301-venue-id-design.md`](../specs/2026-11-04-a1301-venue-id-design.md),
awaiting the owner's approval.

**Plan head:** main `6d2147332b` (2026-11-03). Every `file:line` here was read there. Main moved
to `6a52e7189c` while this was written; `git diff --stat 6d2147332b 6a52e7189c` lists only
`docs/superpowers/plans/2026-10-22-a940-1-software-identity.md`. Every implementer re-reads the
lines at their own head before editing.

**Departures from design §6's S18 row** (also recorded in the parent plan's amendment):
- S18 is split into six sub-slices, and five of them are owner-landed (all but S18c). The row
  said "lane".
- S18e adds a migration, the venue-id design's `cloud_venue` table.
- S19 and the schema plan now wait for more of S18 (see "Owner choice 1: the schedule").

## Goal

No function, type or contract in the code takes, passes or stores a location id. The exception is
the lines that fill or filter a `location_id` column, which the schema slices (S20–S28) remove with
the columns. When S18 is done, the design's grep prints only four kinds of line: those, schema
identifiers, product text that S19 rewrites, and words that are not about Waitron's location. No
column is removed. No migration is added except S18e's.

## What was measured at the plan head

```zsh
P='(^|[^A-Za-z])[Ll]ocations?([^A-Za-z]|$)|[Ll]ocation(Id|_id|Name|[A-Z_])|[a-z]Location'
PATHS=('apps/**' 'packages/**' 'scripts/**' ':!*.test.ts' ':!*.test.mjs' ':!**/drizzle/**' ':!*.md')
git grep -n -E "$P" -- "${PATHS[@]}" | wc -l                                  # 4714
git grep -n -E "$P" -- "${PATHS[@]}" | /usr/bin/grep -v -i allocation | wc -l # 4021, in 294 files
git grep -n -P '\b_cfg\b|\b_locationId\b' -- apps packages | wc -l           # 113
```

The `allocation` filter drops lines that match only inside that word. To check it lost nothing,
each line was re-tested with the word blanked out. The count stayed at 4,021, so no line with a
real match was dropped.

The 113 are split as follows: 73 in `packages/venue-service`, 33 in `apps/server` (10 of them in
test files), 4 in `packages/bookings` and 3 in `packages/staffing`.

The 4,021 lines were sorted by path and pattern. The lines that sorting could not place were then
read one by one (lane B's research pass, 2026-11-04). Counts:

| Kind | Lines | Owner |
| --- | --- | --- |
| Frozen captures: `packages/country-es/test-fixtures/demo/*` (2,487) and `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json` (13) | 2,500 | none (read by digest; never regenerated) |
| Schema: table and column identifiers, `location_id` in SQL, index names, live-query table lists, lines that only fill or filter a `location_id` column (most through `venueLocationId`) | 749 | S20–S28 |
| Code plumbing that hands out the venue id towards backups, Cloud, the mirror bundle, provisioning or `trading.env` | 104 | S18d–S18f |
| Other code plumbing: scopes, ignored parameters, `LocationId`, location-named readers and fields | 341 | S18a–S18c, S18f |
| Product text and comments | 77 | S19 |
| Not Waitron's location: `window.location`, an HTTP `Location` header, an S3 bucket location, the till's table "relocation", `aria-current="location"`, file paths, debugger frames | 208 | none |
| `scripts/a1301-seed-codemod.mjs` | 41 | S28 |
| A fake answer for the retired `/management-api/location-settings` route (`apps/dashboard/src/testing/department-receipt-app-fixture.ts:114`) | 1 | whichever slice retires `dashboard-app.receipt-tab.test.ts`'s check that the route is never called |

These counts are a guide. The last task (S18f-4) reads every line that is left.

Other counts used below:

| What | Count | Command |
| --- | --- | --- |
| Module contract lines `cfg: { locationId: LocationId }` | 82 in `packages/module/src/module.ts` | `grep -c 'cfg: { locationId: LocationId }' packages/module/src/module.ts` |
| Venue-service parameters typed `VenueScope` or `{ locationId }` (outside tests) | 211 in 38 files. Another 6 are typed `DepartmentReceiptScope`, which keeps its other fields and is not removed | `git grep -n -P '^\s*_?cfg\??: (VenueScope\|\{ locationId)' -- 'packages/venue-service/src/*.ts' ':!*.test.ts'` |
| `ctx.cfg` handed on by module routes | 82 (`venue-service` 74, `staffing` 7, `media` 1, which reads `contentDefaultLanguage`) | `git grep -n -P 'ctx\.cfg\b' -- packages apps ':!*.test.ts'` |
| `VENUE_SERVICE.<member>(` call lines | 287 outside tests, 354 in tests | `git grep -n -E 'VENUE_SERVICE\.[a-zA-Z]+\(' -- apps packages ':!*.test.ts'` (and `-- '*.test.ts'`) |
| `configureZone(` in tests | 110 lines in 32 files, of which 109 call the server function. The other, `packages/venue-service/src/dashboard/client.test.ts:235`, is the dashboard client's method, which takes no scope. The parent plan's 107 was counted at an earlier head | `git grep -n 'configureZone(' -- '*.test.ts'` |
| `createStation(` / `createCourse(` in tests (`apps/server/src/kitchen.ts:84,299`, both `_cfg`) | 473 / 246 | `git grep -n -P '\bcreateStation\(' -- '*.test.ts'` |
| Comments `// eslint-disable-next-line … -- callers still pass it; A1301 S18 removes it` | 21: 17 in `packages/venue-service/src`, 4 in `apps/server` (`kitchen.ts:133,326`, `working-order.ts:5237`, `testing/session-device.ts:38`) | `git grep -n 'A1301 S18 removes it' -- apps packages` |
| Test lines reading `cfg.locationId` | 1,046 in 270 files | `git grep -n -P '\bcfg\.locationId\b' -- '*.test.ts'` |
| Files importing the `locationId` brand (one-line imports only) | 301 test files; 40 others | `git grep -l -P 'locationId as brandLocationId\|import \{[^}]*\blocationId\b[^}]*\} from "@waitron/shared"' -- '*.test.ts'` (and `-- apps packages scripts ':!*.test.ts'`) |
| Scope-blind tests marked `// A1301: deleted with cfg in S18` | 24 (table below) | `git grep -n 'deleted with cfg in S18' -- apps packages` |

## What the brief's lists turned out to be at the plan head

Items that are **already gone**, or not S18's:

- **`claimPrintJobs`' `ctx.locationId`** is gone. `ctx` holds `visibleKeys`, `printerId`,
  `invoiceReceiptsAt` and `invoiceReceiptsAheadAt` (`packages/printing/src/runtime.ts:69-80`), and
  `invoice-print.ts:66-70` passes none of them a location. `git log -G'locationId' --
  packages/printing/src/runtime.ts` names #2396 (S10) as the last commit to change such a line.
- **`readChoiceChangeableOrder`'s unused select** is gone. It selects `status`, `revision` and
  `invoiceType` (`apps/server/src/working-order.ts:4501-4506`). `git log -G'locationId:
  workingOrders.locationId' -- apps/server/src/working-order.ts` names #2411 (S11) and #2397 (S13).
- **`saveHolidayArea`'s second read is not S18's.** It is `venueLocationId(tx)` filling
  `holiday_geographies.location_id` in `createGeography` (`packages/venue-service/src/holidays.ts:121-133`),
  so it goes with that column in the schema slices. Only its `_cfg` (`:296`) is S18a's.
- **"`ReceiptText.locationId`"** is `DepartmentReceiptScope.locationId`
  (`packages/shared/src/receipt-text.ts:125-126`). `ReceiptText` (`:2`) is a text map and holds
  no location. **"`ApplyResult.locationId`"** is `VenueResult.locationId`
  (`packages/provisioning/src/venue-apply.ts:60-61`); `git grep -n -w ApplyResult -- apps packages
  scripts` prints nothing.
- **The attendance recorder's `locationId?`** is still there (`apps/server/src/attendance-capture.ts:19`).
  So are its two feeders in S2's files (`bill-payments.ts:1156,1166-1182`; `till-sale.ts:130-137`).
  The recorder never reads it: `recordAttendanceFact` writes `venueLocationId(tx)`
  (`attendance-capture.ts:102-110`).
- **The backlog's "the node and storage ids remain for S18 and the schema slices (S16, #2402)".**
  The node's location id is S18f's. The storage ids (the `location_id` columns) belong to the
  schema slices. #2402's body also left "Country-pack `identity.locationName` … for S19". It is an
  identifier, not text, so S18c-3 renames it.

Items **moved between the groups**, and why:

- **`TradingConfig.locationId` waits for nothing,** but it lands with the owner. `writeTradingEnv`
  never writes it (`apps/server/src/trading-config.ts:31-42`). Its feeders are adoption
  (`adopt.ts:204`), first setup (`setup-api.ts:954`, `first-fiscal-activation.ts:290`), promotion
  (`boot.ts:3369`) and a Cloud fixture (`apps/server/scripts/cloud-integration-fixture.ts:106`),
  all on paths that write an invoicing-system identity: rule (c). It goes in S18d.
- **`ProvisionedNode.locationId` and four other fields reach the outward users.** The other four
  are `AdoptResult.locationId`, `VenueResult.locationId`, the mirror bundle's id and backup
  verification's `source.locationId`. Each is internal, but its value reaches
  `loadBackupConfig(env, venueId)`. That happens through `backup-data-placement.ts:70` (a restored
  node) and `backup-verification-secrets.ts:60,93`. `loadBackupConfig`'s `venueId` names the
  archive folder in `WAITRON_BACKUP_DESTINATIONS` (`backup-config.ts:164-165`, `:276`), which the
  design replaces. They go in S18f. When S18f can land is owner choice 1.
- **The boot's exactly-one-venue check needs no design.** `assertSingleOperationalVenue`
  (`packages/provisioning/src/tenant-guard.ts:29-36`) is called only from `boot.ts:1746`. It goes
  in S18c; `readNodeLocation` stays for S18f.
- **`backup-recovery-pack-api.ts:284-286,467-469`** reads the venue's name and time zone by
  `deps.node.locationId`. That is a by-id read and needs no design, so S18c moves it onto
  `readVenue` and `readVenueClock`, which removes one reader of `ProvisionedNode.locationId`.

## Sub-slices

Each is its own branch and PR, leaves main green, and works on its own.

| Id | Title | Depends on | Lands | Review | Tasks | Branch |
| --- | --- | --- | --- | --- | --- | --- |
| **S18a** | The module contract's location scope | S2–S17 (landed) | **owner** (a)† | FULL (cross-package contract) | 7 | `refactor/a1301-s18a-venue-service-scope` |
| **S18b** | The server's own ignored parameters | S2–S17; independent of S18a (see below) | **owner** (a)† | LIGHT | 2 | `refactor/a1301-s18b-server-ignored-params` |
| **S18c** | Location-named readers and fields | S2–S17 | lane | FULL (cross-package exports) | 3 | `refactor/a1301-s18c-location-readers` |
| **S18d** | Two unread fields on owner paths | S2–S17 | **owner** (a, c)† | FULL | 2 | `refactor/a1301-s18d-owner-path-fields` |
| **S18e** | The venue's Cloud id (Waitron side) | **the venue-id design's approval**; the Cloud lanes' change | **owner** (c) | FULL (migration, contract with Cloud) | planned after approval (about 4) | `refactor/a1301-s18e-venue-cloud-id` |
| **S18f** | The node's location id and the `LocationId` type | S18a–S18d; and S18e unless the owner picks the cheaper schedule (owner choice 1) | **owner** (c) | FULL | 4 (S18f-1 re-sized before dispatch) | `refactor/a1301-s18f-node-location-id` |

† The owner may give a standing ruling that an argument-only edit in an invoice-path file is
lane-landed, when the codemod report shows the argument is unread and the fiscal pair is unedited.
If so, S18a, S18b and S18d-2 move to lane together. (S18d-1 stays with the owner under rule c.)

S18a–S18d can be built now, in parallel. Overlap is a rebase, never a wait (owner's coordination
rule, 2026-11-01). Where two codemod sub-slices share a file, whoever lands second runs their
codemod again on a fresh branch from main rather than resolving the conflict by hand.

**S18a and S18b are independent.** S18b's codemod run takes its seeds only from parameters
declared in `apps/server/` (`--within apps/server/`). It never removes a parameter of a function
whose contextual signature is a module-contract member (rule 4's guard). So it cannot touch the
contract or its implementations, even though the server's program loads venue-service and
bookings source through their package exports (`packages/venue-service/package.json`: `"." :
"./src/index.ts"`). Two `apps/server` parameters match both runs' seed rules:
`apps/server/src/testing/session-device.ts:39` and `invoice-email-contact.test.ts:107`, both
`_cfg: { locationId }`. No S18a task's `--only` list names their files, and neither has a
reference for S18a's cascade to follow. So S18b removes them, together with `session-device.ts:67`,
which only hands its `cfg` on to `:39`. If S18a lands first, S18a-7's first grep prints
`session-device.ts:39,67`; those lines are S18b's.

**Open pull request:** #2442 (lane A, `feat/a1018-s4-final-copy`, head `f8b36a6086`). Its files
(`gh pr view 2442 --json files`) include `apps/server/src/boot.ts` and
`packages/module/src/module.ts`. In `module.ts` it adds a `handover?` member to `WaitronModule` at
about `:1705`, outside the venue-service contract. It also touches `packages/module/src/index.ts`,
`apps/server/src/errors.ts` and `apps/dashboard/src/i18n/codes.ts`. It adds
`apps/server/src/handover-minute-history.test.ts`, which builds a `ProvisionedNode` with
`locationId`; S18f-1 handles it if #2442 lands first. It touches neither `adopt.ts` nor
`mirror-bundle*.ts`.

### Who lands each, by the owner's rules (a)–(d)

Classified by file under rule (a), as the parent plan's amendment 1 does (the coordinator's
decision for this plan):

- **S18a: owner (a).** Its codemod edits invoice-path files: `bill-payments.ts`, `till-sale.ts`,
  `working-order.ts`, `receipt-guests.ts` (`recordSaleReceiptFacts`, `:29-36`),
  `invoice-email-contact.ts` and `sale-operation-description.ts`. It only deletes an argument no
  callee reads (S18a-1 Step 3 shows this), so no input to an invoice record moves (rule b), and
  the fiscal pair runs unedited.
- **S18b: owner (a).** It edits `invoice-document.ts:133` (`readReceiptOrder`'s argument) and
  `working-order.ts:5237-5238` (`listHeldOrders`).
- **S18c: lane.** Invoice delivery is not an invoice record (design §6, S10's reasoning). The
  reporting clock's only production caller is the demo seed's special-day year
  (`apps/server/scripts/demo-seed/seed.ts:145`).
- **S18d: owner.** It touches adoption and first setup (rule c), and two files that store an
  invoice record, `bill-payments.ts` and `till-sale.ts` (rule a; parent plan, amendment 1).
- **S18e: owner** (c): see the venue-id design, "Who lands it".
- **S18f: owner** (c). It touches:
  - provisioning (`venue-apply.ts`);
  - adoption (`mirror-bundle*.ts`);
  - restore and promotion (`restore.ts`, `promote.ts`);
  - the standby's reserved identity (`reserved-identity.ts`);
  - fiscal-verifactu's standby code.

## Owner choices this plan needs

1. **The schedule.**
   - *Default schedule:* S18f waits for S18e. Then S19 and the whole schema plan (which follows S18)
     wait for the venue-id design's approval and build.
   - *Cheaper schedule:* S18f lands after S18a–S18d. The outward users read the interim
     `venueLocationId(tx)`: boot reads it once and hands it to the stream, backup, recovery-pack and
     Cloud users. The backup checks of an archive read the archive's own single `locations` row, as
     `readArtifactNode` does today (`apps/server/src/restore.ts:866-882`). Only S28, which deletes
     `venueLocationId` and drops `locations`, then waits for S18e. S18e rewrites those same
     outward lines in either schedule.
   - **Recommended: the cheaper schedule.** It unblocks S19 and S20–S27 now, and adds only a few
     interim `venueLocationId` reads that S18e or S28 removes.
   - S18f's tasks below are written for either schedule.
2. **The standing ruling on argument-only edits** in the "†" note above. Recommended: grant it.
   An argument no callee reads cannot change a record, and the fiscal pair plus the codemod report
   show this on every PR.

### Scope-blind tests (`// A1301: deleted with cfg in S18`)

Each is deleted, by title, in the task that removes the scope it exercises. Once that scope is
gone it would prove nothing.

| File | Title | Task |
| --- | --- | --- |
| `packages/bookings/src/floor.test.ts` | "annotates the venue's booking whatever location the scope names" | S18a-2 |
| `packages/bookings/src/table-removal.test.ts` | describe "BOOKINGS_TABLE_REMOVAL whatever location the scope names" (its one case) | S18a-2 |
| `packages/venue-service/src/seasons.test.ts` | "reads the venue's seasons whatever location the scope names" | S18a-3 |
| `packages/venue-service/src/special-days.test.ts` | "stores a special day on the venue's row whatever location the scope names" | S18a-3 |
| `packages/venue-service/src/kitchen-notices.test.ts` | describe "listStationsNotices and the scope" (its one case) | S18a-4 |
| `packages/venue-service/src/routing-store.test.ts` | "routingModel lists the venue's zones whatever location the scope names" | S18a-4 |
| `packages/venue-service/src/department-receipts.test.ts` | "returns the venue's default department whatever location the scope names" | S18a-5 |
| `packages/venue-service/src/operations.test.ts` | "lists the venue's departments whatever location the scope names"; "creates a department on the venue's row whatever location the scope names" | S18a-5 |
| `packages/adjustments/src/routes.test.ts` | "reads the venue's clock whatever location the module names" | S18a-6 |
| `apps/server/src/kitchen.test.ts` | "creates, lists and edits the venue's stations whatever location the scope names"; "creates, lists and edits the venue's courses whatever location the scope names" | S18b-1 |
| `apps/server/src/tables.test.ts` | "listZones lists the venue's active zones whatever location the scope names" | S18b-1 |
| `apps/server/src/join-requests.test.ts` | "stamps the venue on a request, the device and agents it becomes, whatever location the scope names" | S18f-2 |
| `packages/adjustments/src/provisioning.test.ts` | "names the starters from the venue whatever location the node names" | S18f-1 |
| `packages/fiscal-verifactu/src/allocated-standby.test.ts` | "reserves a standby allocation without location scope" | S18f-1 |
| `packages/fiscal-verifactu/src/allocation-operation.test.ts` | "reads committed allocation references without location scope" | S18f-1 |
| `packages/fiscal-verifactu/src/allocation.test.ts` | "validates and replays an allocation without location scope"; "replays a committed allocation without location scope" | S18f-1 |
| `packages/fiscal-verifactu/src/cloud-preparation.test.ts` | "reports a committed Cloud allocation without location scope" | S18f-1 |
| `packages/fiscal-verifactu/src/completed-recovery-document.test.ts` | "names the venue without reading the supplied location scope" | S18f-1 |
| `packages/fiscal-verifactu/src/dormant-allocation.test.ts` | "establishes a dormant allocation without target location scope" | S18f-1 |
| `packages/fiscal-verifactu/src/hour-dormant-standby.test.ts` | "reserves and establishes dormant state without reading the supplied location scope" | S18f-1 |
| `packages/fiscal-verifactu/src/standby-allocation.test.ts` | "validates a standby allocation without source location scope" | S18f-1 |

Each task deletes its cases **before** running a codemod, so the codemod never turns them into
tests that prove nothing. Each PR names every case it deletes.

## The codemod (written in S18a-1, reused by S18a, S18b and S18f)

**Where it lives.** At `~/waitron-campaign-b/a1301-s18/s18-drop-param.mjs`, lane B's campaign
folder (lane B builds S18). It is never committed, so:
- it needs no test or root coverage (CLAUDE.md §2);
- nothing is left for S28 to delete;
- each PR body gives its `shasum -a 256`, the exact command run and its report.

**How it works.**
- It loads `typescript` from the worktree:
  `createRequire(join(process.cwd(), "package.json"))("typescript")`, the version 6 API the root
  resolves.
- It splices text by node positions, never reprinting the tree, as
  `scripts/a1301-seed-codemod.mjs` does. Then `pnpm exec prettier --write` tidies the touched
  files.
- It builds **one program over the union of the roots** of the tsconfigs given (`apps/*/tsconfig.json`,
  `packages/*/tsconfig.json`; each includes its tests, e.g. `apps/server/tsconfig.json` includes
  `src`, `test` and `scripts`). It uses `tsconfig.base.json`'s compiler options. Check free memory
  first (`memory_pressure | grep free`).
- It **resolves everything on the unchanged tree first**, then applies every edit at once. That
  ordering is what catches an untyped fake: once a middle parameter has gone, an untyped
  `(tx, cfg, at) =>` would quietly take the next argument in its place.

**Rules, each selectable by a flag:**

1. **Seeds.**
   - `--scope-params` seeds every parameter whose declared type resolves to an object type whose
     only property is `locationId`. That covers `VenueScope`, `{ locationId: LocationId }`,
     `Pick<TradingContext, "locationId">`, staffing's `Cfg`/`ScopeCfg`, and a parameter named
     `venue` such as `setup-opening-hours.ts:12`.
   - `--named _cfg,_locationId` seeds parameters with those names, whatever their type (S18b).
   - `--only <path or glob>[,…]` keeps only seeds declared in those files. A contract member
     (`module.ts`) is seeded when an implementation in those files is.
   - `--within <dir>` drops seeds declared outside that directory (S18b: `apps/server/`).
   - A seed becomes a **target** only when its body hands it on and does nothing else with it.
     "Hands it on" means it appears only as an argument at a removed position, or inside a removed
     argument expression. A seed that is read in any other way is reported and left.
   - A contract member is a target only when every implementation's parameter at that position is
     one too; otherwise the member and its implementations are all reported and left.
   - Because seeds are dropped like this, **any subset of seeds leaves a tree that compiles**, and
     a seed left behind is picked up by a later run.
2. **Cascade and leftovers, run together until nothing changes.**
   - *Cascade:* any other parameter that has at least one reference, and whose every reference is
     a removed argument or sits inside one, becomes a target. Without the "at least one", an
     unreferenced parameter would pass with nothing to check, and every `_cfg` in the program
     would go. A non-last parameter of a function expression whose contextual
     signature is not a target is reported and left. Removing it would shift the arguments a
     caller passes through that signature.
   - *Leftovers:* delete a declaration whose every reference was removed, or sits inside a removed
     argument, when it is one of:
     - a variable or destructuring declaration (such as `table-removal.ts:82`
       `const { locationId } = cfg`) whose initializer is an object literal, an identifier, a
       property access, a function expression, or a possibly awaited call to `venueLocationId`,
       `locationId` or `brandLocationId`;
     - an import specifier.
   - Each deletion can free a parameter. So `rota.ts:42` (`const scope = …`), `paint.ts:33`
     (`const venueScope = (cfg) => …`) and `table-removal.ts:82` stop holding their parameter, and
     the next round removes it.
3. **Calls.** At every call whose resolved signature's declaration is a target's function, method
   or interface member, delete the argument at that position. Calls through a member of
   `VenueServiceContribution` resolve to `module.ts`; the implementation's own parameter is removed
   by rule 4.
4. **Implementations and fakes.** Delete the parameter at that position in every function or
   arrow expression whose contextual signature is a target member: object literals typed by the
   contract, `satisfies`, assigned properties. **Guard:** with `--within`, a function whose
   contextual signature is a module-contract member is never edited, whatever its file. This keeps
   S18b's run off `TableRemoval` fakes such as `apps/server/src/floor-today-store.test.ts:856`
   (`refuse: (_tx, _cfg, tableIds)`), which S18a-2 handles.
5. **`--drop-property <path>`** deletes a property from every object literal whose contextual type
   is that property's owner, and from its declaration.
   - The path is `Type.prop` for a property declared on a named type
     (`DepartmentReceiptScope.locationId`).
   - It is `Type.member.prop` for a property of an inline object type held by a member: in
     `ModuleRouteContext.cfg.locationId`, `locationId` is a property of the `{ … }` type of
     `ModuleRouteContext`'s `cfg` member (`module.ts:93-98`).
6. **Stale comments.** A comment
   `// eslint-disable-next-line @typescript-eslint/no-unused-vars -- callers still pass it; A1301 S18 removes it`
   sits directly above 21 of the ignored parameters. Delete it together with the parameter below
   it, or it ends up above the wrong line.
7. **Report** (to stdout, and saved as `~/waitron-campaign-b/a1301-s18/s18<letter>-codemod-report.txt`).
   It lists:
   - the targets found (`file:line name#index`) and the edits per file;
   - every site it could not resolve: calls through `any`, spread arguments, `.apply` or `.call`,
     and a target passed as a value where the receiving signature is not a target at the same
     position;
   - the seeds rule 1 left.

   A value pass into a target at the same position is accepted, not reported. Examples are the
   shorthand properties of `VENUE_SERVICE = { … }` (`packages/venue-service/src/service.ts:140`
   onwards), each a function handed to the contract member of the same name. Each site the report
   lists is edited by hand and listed in the PR.

`--dry-run` writes nothing. It prints the report, plus the **connected groups**: targets that
reach each other through calls or the cascade. The groups are for sizing tasks only: rule 1 makes
any subset safe to run.

---

## S18a — The module contract's location scope

**Goal.**
- `cfg: { locationId }` leaves:
  - every member of `VenueServiceContribution` (`packages/module/src/module.ts:749-1553`);
  - `FloorAnnotator.annotate` (`:131-138`);
  - the `TableRemoval` hooks (`:156-180`).
- `VenueScope` (`packages/venue-service/src/operations.ts:64-65`) is deleted.
- `DepartmentReceiptScope` loses `locationId` (`packages/shared/src/receipt-text.ts:125-126`).
- `ModuleRouteContext.cfg` loses `locationId` (`module.ts:93-94`; filled at `boot.ts:2675`).
- Every implementation, fake and caller follows, including the module routes' `ctx.cfg` arguments.
- The `venueLocationId` lines that only build a scope follow too: `invoice-email-contact.ts:12`,
  `business-day-start.ts:161,223`, `device.ts:326` and `station-outputs-down.ts:132`. That removes
  amendment 9's first use.

- **Depends on:** S2–S17 (all landed). **Lands: owner** (a), above. **Review:** FULL, a
  cross-package contract (the module contract; `@waitron/shared`'s `DepartmentReceiptScope`).
- **Typecheck:** `pnpm --filter "...@waitron/module" --filter "...@waitron/venue-service" typecheck`.
  This selects every package depending on either one, them included. Read the list of selected
  packages it prints: a scoped run that selects nothing reports success (CLAUDE.md §2). The list
  must include `@waitron/module`, `@waitron/venue-service`, `@waitron/staffing`,
  `@waitron/bookings`, `@waitron/adjustments`, `@waitron/media`, `@waitron/composition` and
  `@waitron/server`.
- **Guards:** the code guards (parent plan), `packages/composition/src/composition.test.ts`, and the
  fiscal pair in every task from S18a-2 on (the codemod edits invoice-path files).
- **Families.** S18a-3 to S18a-5 each seed one family of venue-service files. S18a-1's dry run
  checks the split: if a family's targets total more than about 120 call-site edits, or its run
  leaves more than a handful of seeds behind, the watcher splits or merges the family tasks before
  dispatch. Every task should stay well under 100 tool calls.
  - *Calendar* (S18a-3), 86 parameters: `business-day-schedule`, `day-resolver`, `holidays`,
    `hours`, `keep-open`, `menu-timetable`, `named-days`, `opening-hours-calendar`,
    `period-delete`, `planned-service-guides`, `release-reminders`, `routing-periods`,
    `season-weeks`, `seasons`, `special-days`, `starter-language`, `zone-closed-times`,
    `zone-closure-hours` and `floor-layout-due`. Staffing's `month.ts`, `paint.ts` and `rota.ts`
    go with it.
  - *Kitchen and routing* (S18a-4), 52: `kitchen-screens`, `kitchen-notices`, `routing-store`,
    `station-times`, `station-service-times`, `station-delete-settings`, `course-delete-settings`,
    `late-send`, `service-steps`, `table-clearing`, `device-zone-selection` and `profile-access`.
  - *Departments, zones and floor* (S18a-5), 72: `operations`, `department-transfers`,
    `department-receipts`, `floor-plan-set-store`, `service-delete` and `service-delete-settings`.
    It also runs every seed left over from the earlier families.
  - All files are under `packages/venue-service/src/`; the counts are at the plan head and sum to
    210. The 211th parameter, `testing/zone-menus.ts:13` (`cfg: VenueScope`), is read at `:28` to
    filter a column, so rule 1 leaves it. S18a-6 Step 2 retypes it before deleting `VenueScope`.

### Task S18a-1: Write the codemod and dry-run it

**Files:** `~/waitron-campaign-b/a1301-s18/s18-drop-param.mjs` (new, outside the repository). No
repository change.

- [ ] **Step 1: Write the codemod** to the rules above.
- [ ] **Step 2: Dry-run it** with `--scope-params` over every `apps/*` and `packages/*` tsconfig.
  Its targets must include:
  - the 82 `module.ts` lines;
  - the 211 venue-service parameters measured above, less the seeds rule 1 reports as read;
  - the floor annotator's and table-removal hooks' implementations in `packages/bookings/src/floor.ts:26`
    and `table-removal.ts:9,33,62`.

  If they do not, fix the codemod, never the expectation. Then dry-run `--named _cfg,_locationId
  --within apps/server/`. Its targets must not include a single parameter under
  `packages/`, nor any `refuse`/`release`/`annotate` fake.
- [ ] **Step 3: Show that no callee reads a scope.** This grep is the evidence for the PR's
  argument-only note:
  `git grep -n -P '\b(cfg|scope|_cfg)\.locationId\b' -- 'packages/venue-service/src/*.ts' 'packages/staffing/src/*.ts' 'packages/bookings/src/*.ts' ':!*.test.ts'`.
  At the plan head it prints five lines.
  - Three only rebuild a scope that is handed straight on to venue-service:
    `packages/staffing/src/month.ts:18`, `paint.ts:33` and `rota.ts:42`.
  - Two fill or filter a column in a test helper: `packages/bookings/src/testing/fake-core.ts:76`
    and `packages/venue-service/src/testing/zone-menus.ts:28`. They are left for the schema
    slices.
- [ ] **Step 4:** Save both reports, with the connected groups and the per-family edit counts, as
  `~/waitron-campaign-b/a1301-s18/s18a-dry-run.txt`. Tell the watcher whether the family split
  above holds.

### Task S18a-2: The floor annotator and table removal

**Files:** `packages/module/src/module.ts` (`FloorAnnotator`, `TableRemoval`); `packages/bookings/src/floor.ts:26`,
`table-removal.ts:9,33,62`; `apps/server/src/table-removal.ts` (`:51,59,74,82,93,138,149,152`) and
its callers; `apps/server/src/working-order.ts:8995` (`annCfg`); the test fakes
(`floor-today-store.test.ts:856,2123`, `management-api.test.ts:192`, `table-removal.test.ts:729,733`
at the plan head); `apps/server/src/floor-plan.test.ts:443-448`.

- [ ] **Step 1:** Delete the two bookings scope-blind cases (table above) by title.
- [ ] **Step 2:** Run
  `node ~/waitron-campaign-b/a1301-s18/s18-drop-param.mjs --scope-params --only packages/module/src/module.ts#FloorAnnotator.annotate,TableRemoval.deleteRefusals,TableRemoval.refuse,TableRemoval.release <tsconfigs…>`.
  Rules 2 and 6 together remove `table-removal.ts`'s `const { locationId } = cfg` (`:82`), then its
  `cfg` parameters (`:51,74,138`, `Pick<TradingContext, "locationId">`), then the arguments its
  callers pass. Prettier, then typecheck.
- [ ] **Step 3:** `floor-plan.test.ts:443-448`
  (`expect(refuse).toHaveBeenCalledWith(expect.anything(), { locationId: v.cfg.locationId }, [live], NOW)`)
  becomes `toHaveBeenCalledWith(expect.anything(), [live], NOW)`. `toHaveBeenCalledWith` takes
  untyped arguments, so the typecheck does not catch it. The PR names it as a changed assertion:
  the hook no longer receives a scope.
- [ ] **Step 4:** Run:
  - `pnpm --filter @waitron/bookings test`;
  - `pnpm --filter @waitron/server exec vitest run src/table-removal.test.ts src/floor-today-store.test.ts src/management-api.test.ts src/floor-plan.test.ts src/floor-delete.bookings.test.ts`;
  - the fiscal pair and the code guards.

  Read each command's `Tests` count.
- [ ] **Step 5: Done-check.**
  ```zsh
  P='(^|[^A-Za-z])[Ll]ocations?([^A-Za-z]|$)|[Ll]ocation(Id|_id|Name|[A-Z_])|[a-z]Location'
  git grep -n -E "$P" -- packages/bookings/src/floor.ts packages/bookings/src/table-removal.ts apps/server/src/table-removal.ts   # prints nothing
  awk 'NR>=131 && NR<=180 && /locationId/' packages/module/src/module.ts   # prints nothing (check the two interfaces' range at your head)
  ```
- [ ] **Step 6:** Commit (`git commit -s`), naming the two deleted cases and the changed assertion.

### Tasks S18a-3, S18a-4, S18a-5: One venue-service family each

The same steps, with the family's files and scope-blind cases (tables above). The **crossings into
S2's files** are argument only, and each is named in the PR: `sale-operation-description.ts`,
`invoice-email-contact.ts`, `till-sale.ts`, `bill-payments.ts`, `working-order.ts`,
`receipt-guests.ts`, and `apps/server/scripts/demo-seed/seed.ts`, `seed-catalogue.ts:150` and
`seed-floor.ts:164`.

- [ ] **Step 1:** Delete the family's scope-blind cases by title.
- [ ] **Step 2:** Run
  `node ~/waitron-campaign-b/a1301-s18/s18-drop-param.mjs --scope-params --only '<family files>' <tsconfigs…>`.
  S18a-5 adds every seed the earlier runs left (from their reports).
- [ ] **Step 3:** Hand-edit the report's list. **Do not** touch the scopes spread into a
  `DepartmentReceiptScope` member. They are `{ ...cfg, receiptLanguages: [] }` at
  `sale-operation-description.ts:38` and `invoice-email-contact.ts:20-23`, and
  `{ ...cfg, receiptLanguages: … }` at `department-receipt-draft.ts:35`. That type still requires
  `locationId` until S18a-6; the plan reviewer's `tsc6` probe gave TS2345 when the field was taken out early. So
  `sale-operation-description.ts`'s `locationId` field (`:10`), `invoice-email-contact.ts:12`'s
  `cfg` and `department-receipt-draft.ts:22`'s `cfg` parameter all stay until S18a-6. Rule 1
  reports the last as read, by the spread.
- [ ] **Step 4:** Prettier, then the typecheck above. If you pass about 150 tool calls with the
  typecheck still red, stop at a cleanly red point, commit, and hand over the error list (global
  handover rule).
- [ ] **Step 5:** Run the family's venue-service suites
  (`pnpm --filter @waitron/venue-service exec vitest run <the family's test files>`). S18a-3 also
  runs `pnpm --filter @waitron/staffing test`. Also run the `apps/server` suites of each server
  file the report lists as edited, the fiscal pair and the code guards. Check free memory first.
  Read every `Tests` count. CI runs the full package suites.
- [ ] **Step 6:** Commit, listing the deleted cases and every invoice-path file touched.

### Task S18a-6: Types left behind, the routes' context, the spreads

**Files:**
- `packages/venue-service/src/operations.ts:46,64-65` (`VenueScope`, `LocationId` import);
- `packages/module/src/module.ts:22,93-94`. The `DepartmentReceiptScope` import at `:17` stays:
  six members still take that scope;
- `packages/shared/src/receipt-text.ts:1,125-126`;
- `apps/server/src/boot.ts:2675`;
- `sale-operation-description.ts:2,10,38`, `invoice-email-contact.ts:2,12,20-23`,
  `department-receipt-draft.ts:22,35` and its callers;
- every `ModuleRouteContext` literal in tests (`packages/module/src/module.test.ts:43` and others
  the codemod reports);
- `packages/adjustments/src/routes.test.ts`.

- [ ] **Step 1:** Delete adjustments' "reads the venue's clock whatever location the module names"
  by title, before the next step rewrites its context.
- [ ] **Step 2:** Retype `packages/venue-service/src/testing/zone-menus.ts:13` from `VenueScope` to
  `{ locationId: LocationId }`, and replace its `VenueScope` import (`:7`) with `LocationId`'s. It
  reads `cfg.locationId` at `:28` to filter a column, so the schema slices remove it. Then delete
  `VenueScope` and every import of it that is left.
- [ ] **Step 3:** Run the codemod with
  `--drop-property DepartmentReceiptScope.locationId --drop-property ModuleRouteContext.cfg.locationId`.
  Delete `boot.ts:2675`.
- [ ] **Step 4:** Now that `DepartmentReceiptScope` has no `locationId`, fix the three spreads.
  - `invoice-email-contact.ts`: the scope becomes `{ receiptLanguages: [] }`, and the `cfg`
    construction at `:12` goes, with its imports.
  - `sale-operation-description.ts`: the `cfg` type loses `locationId` (`:10`) and its import
    (`:2`).
  - `department-receipt-draft.ts`: the scope becomes `{ receiptLanguages: … }`. Then run the
    codemod with `--scope-params --only apps/server/src/department-receipt-draft.ts` to drop the
    now-unused `cfg` (`:22`) and its callers' arguments.

  Leave `invoice-document.ts:101-107`, `receipt-presentation.ts:27-33` and `receipt-print.ts:205-211`
  as they are. They spread a whole `TradingContext` into the scope, and a spread is never checked
  for extra properties. They are S2's, on the invoice path.
- [ ] **Step 5:** Remove the `LocationId` import from `module.ts` if nothing in it uses it any more
  (`ProvisionedNode` lives in `provisioning.ts`). Reword or delete the comment at `module.ts:61`
  ("of the location") under the parent plan's comment rule.
- [ ] **Step 6:** Typecheck (filter above), prettier. Run `pnpm --filter @waitron/adjustments test`,
  the suites of the files changed, the fiscal pair and the code guards. Commit.

### Task S18a-7: Done-check and backlog

- [ ] **Step 1: Done-check.**
  ```zsh
  P='(^|[^A-Za-z])[Ll]ocations?([^A-Za-z]|$)|[Ll]ocation(Id|_id|Name|[A-Z_])|[a-z]Location'
  git grep -n -P 'VenueScope|cfg: \{ locationId|type (Scope)?Cfg = \{ locationId' -- apps packages ':!*.test.ts'
  git grep -n -P '\b_cfg\b|\b_locationId\b' -- packages/venue-service packages/staffing packages/bookings packages/module   # prints nothing
  git grep -n 'A1301 S18 removes it' -- packages   # prints nothing
  FILES=(packages/module/src/module.ts packages/shared/src/receipt-text.ts 'packages/venue-service/src/*.ts' packages/staffing/src/month.ts packages/staffing/src/paint.ts packages/staffing/src/rota.ts apps/server/src/zone-access.ts apps/server/src/receipt-guests.ts apps/server/src/department-receipt-draft.ts apps/server/src/sale-operation-description.ts apps/server/src/device-api.ts apps/server/src/setup-opening-hours.ts apps/server/src/invoice-email-contact.ts apps/server/src/station-move.ts apps/server/src/station-outputs-down.ts)
  git grep -n -E "$P" -- "${FILES[@]}" ':!*.test.ts'
  ```
  - **The first grep may still print three things.**
    - `packages/venue-service/src/testing/zone-menus.ts:13`, retyped in S18a-6 Step 2, which stays
      for the schema slices.
    - `apps/server/src/testing/session-device.ts:39,67`, if S18b has not landed: those lines are
      S18b's.
    - A test helper's returned `cfg: { locationId }` property
    (`packages/staffing/test/seed.ts:40` at the plan head). An unread property is not a type
    error, so the codemod cannot see it. Delete each one that no test reads any more (search the
    helper's callers for `.cfg`). One that is still read seeds a column, and stays. The same
    pattern in test files (50 lines at the plan head, mostly local helper types) is handled the
    same way.
  - **The fourth grep may still print** lines that fill or filter a `location_id` column, such as
    `locationId: await venueLocationId(tx)` in an insert, or `eq(x.locationId, …)` on a drizzle
    table. Examples: `operations.ts:187,408,469,1099,1406`, `routing-store.ts:338`,
    `seasons.ts:61,183`, `special-days.ts:1018,1042,1047`, `provisioning.ts:55,97,103,111`,
    `holidays.ts:125`. It may also print the `venueLocationId` imports those lines need, and
    comments S19 rewrites. Anything else is unfinished.
- [ ] **Step 2:** In `docs/backlog/architecture.md`, in A1301's "**S18:**" bullet, delete the
  sentences this sub-slice finished:
  - venue-service's `_cfg`;
  - staffing's scopes;
  - the station-screens scope;
  - `receipt-print.ts`'s `cfg` for `readPrintedDepartmentReceipt`;
  - the floor annotator's `cfg`;
  - the `VENUE_SERVICE.stationStates` scopes;
  - `receipt-guests.ts`'s `cfg`.

  Keep the rest.
- [ ] **Step 3:** Run the fiscal pair, the code guards, `pnpm format:check`. Commit, then
  `/finish-branch`.

---

## S18b — The server's own ignored parameters

**Goal.** The `_cfg`/`_locationId` parameters declared in `apps/server` go, with their callers'
arguments, all except those whose contextual signature is a module-contract member:
- `dead-ends.ts:26`;
- `find-bill-transactions.ts:183`;
- `floor-plan.ts:74`;
- `floor-revision.ts:65,140`;
- `floor-today-table.ts:27,57`;
- `kitchen-allergy.ts:87`;
- `kitchen-print.ts:403`;
- `kitchen.ts:61,86,134,266,286,301,327`;
- `receipt-order.ts:21`;
- `tables.ts:29,64,82`;
- `watch-zones.ts:57`;
- `working-order.ts:5238`.

The test helpers go too:
- `till-api.fiscal-sale-paths.test.ts:290` (`fakePool`);
- `till-api.receipt.test.ts:488` (`ringSale`);
- `till-sale-integrated.db.test.ts:263` (`integratedDeps`);
- `invoice-page-print.test.ts:170` (`pull`);
- `invoice-email-contact.test.ts:107` (`read`);
- `testing/session-device.ts:39`.

These are the server's own functions. Each takes a whole `TradingContext` it no longer reads. The
`TableRemoval` fakes are S18a-2's (rule 4's guard).

- **Depends on:** S2–S17; independent of S18a (above). **Lands: owner** (a), above.
  **Review:** LIGHT: every function is internal to `apps/server`, and none is behind a contract.
- **Size:** 473 `createStation(` and 246 `createCourse(` test call lines (both in `kitchen.ts`).
  Behind them come `listStations` (91), `listCourses` (30), `listZones` (24), `listHeldOrders`
  (23), `readReceiptOrder` (22) and `todayOf` (19). Each count is `git grep -n -P '\b<name>\('`,
  minus the definition.

### Task S18b-1: Run the codemod over the server

- [ ] **Step 1:** Delete the three scope-blind cases in `kitchen.test.ts` and `tables.test.ts` (table
  above) by title.
- [ ] **Step 2:** Run
  `node ~/waitron-campaign-b/a1301-s18/s18-drop-param.mjs --named _cfg,_locationId --within apps/server/ <tsconfigs…>`.
  Check the report:
  - **No target may be under `packages/`.** If one is, the guard failed: stop and fix the codemod.
  - The cascade may also remove a caller's `cfg` that only fed one of these.
  - Hand-edit what the report lists.

  `invoice-document.ts:133` (`readReceiptOrder`'s argument) is in S2's file: an argument-only
  edit, named in the PR.
- [ ] **Step 3:** Prettier, then `pnpm --filter @waitron/server typecheck`. Check free memory
  first, then run:
  - the focused suites of the twelve production files and the five test helpers' test files;
  - the fiscal pair.

  Read each `Tests` count.
- [ ] **Step 4:** Commit, naming the deleted cases.

### Task S18b-2: Done-check and backlog

- [ ] **Step 1:** Run these greps:
  ```zsh
  git grep -n -P '\b_cfg\b|\b_locationId\b' -- apps   # prints nothing, except contract fakes S18a-2 has not yet removed
  git grep -n 'A1301 S18 removes it' -- apps          # prints nothing
  ```
- [ ] **Step 2:** In the backlog's "**S18:**" bullet, delete "the unread `_cfg` in `kitchen.ts`,
  `dead-ends.ts` and `kitchen-allergy.ts`".
- [ ] **Step 3:** `pnpm format:check`, the code guards. Commit, `/finish-branch`.

---

## S18c — Location-named readers and fields

**Goal.** Readers that take or name a location id are removed, or read the venue with no id. Fields
nothing reads are deleted.

- **Depends on:** S2–S17. **Lands:** lane. **Review:** FULL. It removes exports other packages use:
  `@waitron/reporting`'s `readLocationClock`, `readLocationClockAndPlace` and `LocationPlace`;
  `@waitron/provisioning`'s `assertSingleOperationalVenue` signature; `@waitron/country`'s
  `locationName`. It also changes a `@waitron/shared` error's detail type, and the start-up
  refusal `provisioning.second_venue`.
- **Guards:** the code guards plus `scripts/alert-codes.test.ts` (an error detail changes) and the
  fiscal pair (Task S18c-1 touches the demo seed, S2's file).

### Task S18c-1: The reporting clock, the demo seed's reads, the box email and the recovery pack

**Files:**
- `packages/reporting/src/business-day.ts:163-211` and `index.ts:5,6,14`;
- `apps/server/scripts/demo-seed/seed.ts:10,144-145`;
- `apps/server/scripts/demo-seed/data-set.ts:161-177` (`readDemoSeedSelection`) and its callers
  `apps/server/src/demo-seed.ts:20`, `apps/server/scripts/dev-setup.ts:250` and
  `apps/server/scripts/demo-seed/seed.regional.test.ts` (7 calls);
- `apps/server/src/box-alert-email.ts:214-229` and `boot.ts:2923`;
- `apps/server/src/backup-recovery-pack-api.ts:284-286,467-469`.

Tests:
- `packages/reporting/src/business-day.test.ts` and `business-day-history.test.ts:33,45`;
- `apps/server/src/business-day-history.test.ts:146,314`, `business-day-persistence.test.ts:137`
  and `business-day-start.test.ts:956`;
- `packages/venue-service/src/period-delete.test.ts:619,660`, `seasons.test.ts:307`,
  `station-service-times.test.ts:743` and `zone-closure-hours.test.ts:332`.

- [ ] **Step 1:** In `business-day.test.ts`, describe "readLocationClock":
  - For each of "reads a location's zone and its cutover as HH:MM" and "reads the clock beside
    the location's province and city", find the assertion that pins the same behaviour on
    `readVenueClock` or `readVenueClockAndPlace` in `packages/db/src/venue.test.ts` (around
    `:90-91`). Where one exists, delete the case. Where none does, move the case onto
    `readVenueClock` with its assertion unchanged.
  - Delete "throws a plain Error for a location the database does not hold" and "readVenueClock
    reads what readLocationClock reads for the one location": both exist only for the id.
  - Name each in the PR.
- [ ] **Step 2:** Every other test caller moves to `readVenueClock(tx)` from `@waitron/db`. S1
  pinned that it reads what `readLocationClock` read for the one row, in the case Step 1 deletes.
  Then delete `readLocationClock`, `readLocationClockAndPlace` and `LocationPlace`, and their
  exports.
- [ ] **Step 3:** `demo-seed/seed.ts:145` reads `readVenueClock(tx)`. `readDemoSeedSelection(db)`
  reads the tenant's country and `readVenue`'s province with no id, and its three callers drop the
  argument. Leave the `locationId` that `seed.ts`, `seed-catalogue.ts` and `seed-floor.ts` still
  use to filter or fill columns: it is the schema slices'.
- [ ] **Step 4:** `readBoxEmailContext` reads `readVenue(db).name`, so its `locationId` dependency
  (`box-alert-email.ts:219`) and `boot.ts:2923` go. `backup-recovery-pack-api.ts`'s two reads use
  `readVenue` and `readVenueClock`.
- [ ] **Step 5:** Typecheck `@waitron/reporting`, `@waitron/venue-service` and `@waitron/server`.
  Run the touched suites, `seed.regional.test.ts`, the fiscal pair and the code guards. Commit.

### Task S18c-2: Unread fields and the start-up check

**Files:**
- `apps/server/src/invoice-delivery-status.ts:81,179-188` and `invoice-delivery-status.test.ts:283,1043`;
- `apps/server/src/invoice-customer-data-api.ts:29-30`, `boot.ts:2710` and
  `boot.node-configuration.test.ts:378`;
- `packages/shared/src/errors.ts:30`;
- `packages/provisioning/src/tenant-guard.ts:29-36`, `tenant-guard.test.ts:41-52` and `boot.ts:1746`;
- `boot.ts:2069` and `apps/server/src/venue-zone-context.ts:31`.

- [ ] **Step 1:** `InvoiceDeliverySale` becomes `{ id: string }`, and the `venueLocationId` read at
  `:179-181` goes. In the test:
  - the offer helper (`:283`) filters page printers by `active` alone;
  - the assertion in "asks its caller for printers only for full invoices" (`:1043`) expects
    `[{ id: saleId }]`. That changed assertion names this plan.
- [ ] **Step 2:** `InvoiceCustomerDataDeps.nodeId` goes, with `boot.ts:2710` and the assertion
  `expect(observed.customers?.nodeId)…` (`boot.node-configuration.test.ts:378`). The PR names that
  assertion: what it checked is no longer handed over.
- [ ] **Step 3:** `"venue.time_zone_target_invalid": { reason: "node" | "mismatch" }`.
  `git grep -n 'reason: "location"' -- apps packages` printed nothing at the plan head. Run
  `scripts/errors-reachable.test.ts` and `scripts/alert-codes.test.ts`.
- [ ] **Step 4:** `assertSingleOperationalVenue(presentVenueIds)` refuses unless there is exactly
  one row. `boot.ts:1746` drops its second argument (`readNodeLocation` stays for S18f).
  In `tenant-guard.test.ts`:
  - "accepts exactly the configured venue at trading boot" becomes "accepts one venue row";
  - in the `it.each` "refuses a trading boot whose venue rows are %j", the row `[["venue-b"]]`
    (one row, not the configured one) is deleted and named. `[]` and two rows stay.

  Boot cannot reach that deleted state. It calls the guard only after `readNodeLocation` returned
  a row, and that read inner-joins the node to `locations` (`node-config.ts:46-50`). With exactly
  one `locations` row, a row returned by that join can only name that one row.
- [ ] **Step 5:** `boot.ts:2069`'s scope is `{ nodeId }` (`IssueScope`, `packages/fiscal/src/issue-clock.ts:6`),
  and the comment at `venue-zone-context.ts:31` goes.
- [ ] **Step 6:** Typecheck `@waitron/shared`, `@waitron/provisioning` and `@waitron/server`. Run the
  touched suites, the code guards and `scripts/alert-codes.test.ts`. Commit.

### Task S18c-3: The country packs' `locationName`, the done-check, the backlog

**Files:**
- `packages/country/src/country.ts:26,124` and `demo.ts:200`;
- `packages/country-es/src/spain.ts:274,276,278,342`, `demo/developer-presets.ts:5,15,24,45` and
  `demo-testing.ts:4,54`;
- `apps/server/scripts/dev-setup.ts:219`;
- `apps/server/src/setup-api.ts:590` (S16's file, landed: argument only);
- `apps/setup/src/screens/venue-screen.ts:456`;
- `apps/server/scripts/demo-seed/testing/provision-venue.ts:15,31,74`;
- the test files that name the field (`git grep -l -w locationName -- '*.test.ts'`), except the two
  below.

- [ ] **Step 1:** Rename the field `locationName` to `venueName`, as an identifier only: no value
  changes. Rename other demo-helper identifiers that the done-check prints the same way (such as
  `catalanLocation`, `packages/country-es/src/demo-testing.ts:36,83`).
- [ ] **Step 2:** Typecheck `@waitron/country`, `@waitron/country-es`, `@waitron/server` and
  `@waitron/setup`. `@waitron/setup` is a browser package: typecheck only, unless a setup-app test
  names the field; then check free memory before running it.
- [ ] **Step 3: Done-check.**
  ```zsh
  P='(^|[^A-Za-z])[Ll]ocations?([^A-Za-z]|$)|[Ll]ocation(Id|_id|Name|[A-Z_])|[a-z]Location'
  git grep -n -w locationName -- apps packages scripts ':!packages/country-es/test-fixtures/**' ':!apps/server/src/logger.test.ts' ':!packages/workforce/src/attendance-reads.test.ts'   # prints nothing
  git grep -n -E "$P" -- <this sub-slice's files>   # only column fills and filters, schema identifiers and S19's text
  ```
  The two files left out keep the old name on purpose:
  - `apps/server/src/logger.test.ts:145,405` uses `locationName` as an arbitrary key on neither
    personal-data list (the case at `:404-406` is titled "leaves a key on neither list as it is").
    It is not this field.
  - `packages/workforce/src/attendance-reads.test.ts:160` asserts
    `expect(prompt).not.toHaveProperty("locationName")`. Renaming it would make it check a
    different key, and stop it proving the old one stays gone.

  The frozen capture keeps its keys.
- [ ] **Step 4:** Backlog, in the "**S18:**" bullet:
  - Delete "`saveHolidayArea` reads the venue row twice … S18 can drop the second read", and move
    it to the schema slices' bullet: it goes with `holiday_geographies.location_id`.
  - Delete "`InvoiceCustomerDataDeps.nodeId` … remains for S18".
  - In "the node and storage ids remain for S18 and the schema slices (S16, #2402)", leave only
    the node's id, now S18f's.

  Then `pnpm format:check`, commit, `/finish-branch`.

---

## S18d — Two unread fields on owner paths

**Goal.** `TradingConfig.locationId` (`apps/server/src/trading-config.ts:20`) and the attendance
recorder's `locationId?` (`attendance-capture.ts:19`) go. Nothing reads either one.

- **Depends on:** S2–S17. **Lands: owner.** Task 1 touches adoption and first setup (rule c).
  Task 2 touches `bill-payments.ts` and `till-sale.ts`, which store an invoice record (rule a,
  parent plan amendment 1). **Review:** FULL.
- **Guards:**
  - the fiscal pair, in both tasks;
  - the code guards;
  - `apps/server/src/first-fiscal-setup.e2e.test.ts` (Task 1);
  - the adoption suites `adopt.test.ts` and `finish-adoption.test.ts` (Task 1).

### Task S18d-1: `TradingConfig.locationId`

**Files:**
- `trading-config.ts:20`;
- `adopt.ts:203-209`;
- `setup-api.ts:952-958`;
- `first-fiscal-activation.ts:287-293`;
- `boot.ts:3366-3372`;
- `apps/server/scripts/cloud-integration-fixture.ts:104-110`;
- `trading-config.test.ts:19`, `adopt.test.ts:199-203` and `setup-api.test.ts:547-552`.

- [ ] **Step 1:** Delete the field and every `locationId:` passed into it. `adopt.ts`'s
  `designated.locationId` keeps its other readers (the mirror bundle, S18f).
- [ ] **Step 2:** Two assertions change. The PR names both: the field no longer exists.
  - In `adopt.test.ts`, the `toMatchObject` at `:199-203` loses `locationId: DESIGNATED.locationId`.
  - In `setup-api.test.ts`, the whole-shape `toEqual` on the first `persistTrading` call
    (`:547-552`, `{ nodeId, locationId: LOCATION_ID, environment, onboardingIntent }`) loses the
    `locationId` key. Being whole-shape, it then also proves the key is not passed.

  `trading-config.test.ts`'s check that no `WAITRON_*LOCATION*` line is written stays as it is.
- [ ] **Step 3:** Typecheck `@waitron/server`. Then run:
  - `trading-config.test.ts`, `adopt.test.ts`, `finish-adoption.test.ts` and `setup-api.test.ts`;
  - the other suites that call `persistTrading` (`git grep -l persistTrading -- 'apps/server/src/*.test.ts'`);
  - `first-fiscal-setup.e2e.test.ts`;
  - the fiscal pair and the code guards.

  Commit.
- [ ] **Step 4: Cloud follow-up.** Add a line to `~/waitron-campaign/a1301/cloud-followup.md`.
  Cloud's two `writeTradingEnv` callers stop passing `locationId` when their pin moves past this
  PR: `deploy/test-cloud/test-fixtures/snapshot-archive.mjs:19` and
  `snapshot-authorised-archive.test.ts:35`.

### Task S18d-2: The attendance recorder

**Files:** `attendance-capture.ts:15-21`; `bill-payments.ts:1146-1186`; `till-sale.ts:120-142`.

- [ ] **Step 1:** `AttendanceRecorder`'s fact loses `locationId?`, and
  `captureBillPaymentAttendance`'s `requested` becomes `{ at: string }`.
  - Two order reads selected only the order's location: `bill-payments.ts:1171-1176` and
    `captureWholePayment`'s (`till-sale.ts:129-132`). Both go.
  - Before deleting them, show that neither could have refused anything. Each `order!`
    dereference would have thrown on a missing order. So check two things, and cite where each is
    true:
    - that `bill_payments.working_order_id` references `working_orders` with a foreign key. Its
      column is declared at `packages/db/src/schema/bill-payments.ts:42`, with no `.references`
      on that line; look for a foreign key elsewhere in the file.
    - that the sale's order references `working_orders` with a foreign key.
  - If either check fails, keep that read as an existence check, selecting `id` only, and say so
    in the PR.
- [ ] **Step 2:** Typecheck. Run:
  - the suites that assert these facts
    (`git grep -l -E '"(bill-payment|whole-payment)"' -- 'apps/server/src/*.test.ts'`: 12 files
    at the plan head, among them `attendance-bill-payments` and `attendance-whole-payments`);
  - the fiscal pair and the code guards.

  Commit.
- [ ] **Step 3:** Backlog: delete "The attendance recorder keeps an unread optional `locationId`
  for S18 (S13, #2397)". `pnpm format:check`, `/finish-branch`.

---

## S18e — The venue's Cloud id (Waitron side): waits for the venue-id design's approval

**2026-11-05:** the owner approved the design on 2026-11-04. S18e is now held by A1308, because
it adds a table.

**Not built before the owner approves [the design](../specs/2026-11-04-a1301-venue-id-design.md).**
Its tasks are written then, against the head of that day, with the owner's answers to the design's
seven questions. The outline below follows the design's defaults:

1. Establish, with a test from a real first setup, what the fiscal recovery-pack check compares
   (design, question 6), and apply the owner's answer.
2. The pairing changes:
   - the `cloud_venue` table: one additive migration, classified `state`, kept out of
     `CORE_CONFIGURATION_TRANSFER`, with the schema guards;
   - its writer at pairing, and `waitron-cloud-pair-v2`;
   - the pairing file check against the stored id;
   - a version-1 pairing file reads as "not connected" (design, "A test box paired today");
   - the replacement bytes without `localVenueId`.
3. Backups in the owner's place:
   - the stream and archive folders become the owner's prefix itself;
   - the pointer's same-writer id;
   - `loadBackupConfig` loses `venueId`, and S18f's interim `readCopyNodeAndVenue`
     (`apps/server/src/restore.ts`) stops reading the copy's venue row;
   - the recovery kit, the archive pack, the restore and rebuild reads, and the backup screen.
4. Boot stops handing out the location id. Under the default schedule that means
   `tradingContext.locationId`; under the cheaper one, S18f's interim `venueLocationId` reads.
   The lines are `boot.ts:2786,3160,3170,3179,3234,3254,3271` at the plan head, and the two Cloud
   fixtures (`cloud-integration-fixture.ts:134-161`, `cloud-recovery-client-fixture.ts:152-173`).

The Cloud lanes' change lands with it (design, "What Cloud must change").

---

## S18f — The node's location id and the `LocationId` type

**Goal.** No location id is held by any of these:
- `ProvisionedNode`, `AdoptResult` and `VenueResult`;
- the mirror bundle;
- backup verification;
- `NodeConfig` and `TradingContext`.

`readNodeLocation` is gone. So are `LocationId` and the `locationId` brand
(`packages/shared/src/ids.ts:11,52`); the brand stayed (2026-11-05 note under Task S18f-3). Line numbers below are the plan head's. Each task re-reads
them first: S18e, if it lands first, moves `boot.ts`.

- **Depends on:** S18a–S18d. Under the default schedule also S18e: until it lands,
  `backup-data-placement.ts:70` and `backup-verification-secrets.ts:93` hand the location id to
  `loadBackupConfig`. Under the cheaper schedule (owner choice 1), those two read the archive's own
  single `locations` row instead, as `readArtifactNode` does today (`restore.ts:866-882`). Boot's
  outward users then read `venueLocationId(db)` once, in place of `tradingContext.locationId`. Both
  are interim, removed by S18e or S28.
- **Lands: owner** (c), above. **Review:** FULL.
- **Guards:**
  - the fiscal pair, in every task;
  - the code guards;
  - `first-fiscal-setup.e2e.test.ts`;
  - the mirror, adoption, restore, promotion and backup-verification suites the tasks name;
  - `packages/composition/src/composition.test.ts`.

### Task S18f-1: `ProvisionedNode` and the identity it is built from

**Re-sized 2026-11-05 (lane B), from a dry run at main `48681368d0`.** The owner chose the cheaper
schedule (2026-11-04 ~06:05), so S18f does not wait for S18e. The run
`--drop-property ProvisionedNode.locationId --drop-property AdoptResult.locationId
--drop-property VenueResult.locationId --dry-run` edits 47 files itself and reports 273 reads of
the dropped property (71 files, nearly all tests) and 150 object literals with no contextual type
(126 files). The task is built as four, in this order, so that every commit before S18f-1c
compiles:

- **S18f-1a:** tests and test helpers in `packages/`, `apps/server/scripts/`, and the three
  largest server suites (`configuration-transfer.test.ts`, `provision.test.ts`,
  `management-api.test.ts`) stop reading `locationId` off a `ProvisionedNode`, `AdoptResult` or
  `VenueResult`. Each read becomes an independent read of the same id, normally
  `await venueLocationId(db)` on the database that venue was set up in. The property still exists,
  so nothing else changes and every suite passes as before.
- **S18f-1b:** the same, for the rest of `apps/server`'s tests and helpers.
- **S18f-1c:** Steps 1–4 below: delete the scope-blind cases, run the codemod, make the production
  edits and Step 3's backup-verification change. Under the cheaper schedule,
  `backup-data-placement.ts` and `backup-verification-secrets.ts` hand `loadBackupConfig` the id of
  the copy's own single `locations` row, read from the copy as `readArtifactNode` does today
  (`restore.ts`), each with a one-line note that S18e or S28 removes it.
- **S18f-1d:** the reported literals with no contextual type. Delete the `locationId` key where
  nothing reads it afterwards (typecheck plus the file's suite decide); keep it where the value is
  read, for example to fill a `location_id` column.

**To be re-sized before dispatch.** It is the largest task here: production files in five
packages, the test helpers below, and about 125 test literals. Once S18a–S18d have landed, the
watcher splits it, if its dry run says so, into production edits and test-literal edits.

**Files:**
- `packages/module/src/provisioning.ts:2,9` and `packages/module/src/backup-verification.ts:36`;
- `packages/db/src/backup-evidence.ts:249-275` and `backup-evidence.test.ts:289`;
- `packages/composition/src/core-backup-verification.ts:26-29`;
- `apps/server/src/backup-verification-secrets.ts:60`;
- `packages/provisioning/src/venue-plan.ts:12-15` (`AdoptResult`),
  `venue-apply.ts:23,60-61,377,465,504` and `recover-provisioned-venue.ts:43,58,80`;
- `apps/server/src/mirror-bundle.ts:4,140,182,217`, `mirror-bundle-fetch.ts:51`, `adopt.ts`,
  `promote.ts:36,258`, `reserved-identity.ts:21,79-88`, `restore.ts:23,856-882`,
  `demo-seed.ts:20-25` and `boot.ts:2648,2669,3327`;
- `packages/fiscal-verifactu/src/allocated-standby.ts:207` and `hour-dormant-standby.ts:270`.

Test helpers:
- `apps/server/src/testing/allocated-contract.ts:97`, `allocated-provision.ts:29`,
  `backup-verification-fixture.ts:50`, `dormant-contract.ts:22,31`, `staged-hour-crash.ts:86`,
  `staged-hour-restore.ts:90`, `stream-loop-scenario.ts:342,469` and
  `stream-pause-scenario.ts:386`;
- `apps/server/test/hour-recovery-host.ts:110`;
- `packages/fiscal-verifactu/test/live-conflict-fixture.ts:18`;
- `packages/provisioning/test/allocated-venue.ts:61`;
- if #2442 has landed, `apps/server/src/handover-minute-history.test.ts`.

- [ ] **Step 1:** Delete the ten scope-blind cases this task owns by title: the nine
  fiscal-verifactu cases, and adjustments' `provisioning.test.ts` case (table above).
- [ ] **Step 2:** Run the codemod with `--drop-property ProvisionedNode.locationId
  --drop-property AdoptResult.locationId --drop-property VenueResult.locationId`. At the plan head,
  125 test lines carry both `nodeId:` and `locationId:`. Hand-edit the report's leftovers.
- [ ] **Step 3:** Backup verification's `source` becomes `{ nodeId, environment, createdAt }`.
  - `verifyCoreBackupData` checks that the node row exists and that exactly one `locations` row
    exists, with no id comparison. Its `locations` and `nodes.location_id` reads stay until the
    schema slices; say so at the site.
  - In `backup-evidence.test.ts`, the `it.each(["nodeId", "locationId"])("source identity %s
    disagreement refuses")` loses its `"locationId"` row, named in the PR.
  - Add two cases, a copy with no venue row and a copy with two, both refused. The two-row case is
    a behaviour change, named in the PR: the old check accepted it whenever the node's row named
    one of the two. Such a copy cannot start: boot refuses it `provisioning.second_venue`.
  - The mirror bundle's `designated` becomes `{ nodeId }`, and `mirror-bundle-fetch.ts:51` checks
    `nodeId` alone. Before go-live a primary and its standby run the same software (CLAUDE.md §3,
    last rule).
- [ ] **Step 4:** Typecheck every package depending on `@waitron/module` or `@waitron/provisioning`
  (read the selected list). Then run:
  - the mirror-bundle, adopt, reserved-identity, restore, promote and backup-verification suites;
  - `packages/db`'s `backup-evidence.test.ts`;
  - the fiscal-verifactu allocation and standby suites;
  - the fiscal pair and the code guards.

  Commit, naming the deleted cases.

### Task S18f-2: `NodeConfig`, `TradingContext` and `readNodeLocation`

**Files:**
- `apps/server/src/node-config.ts:3-5,12-14,42-52`;
- `boot.ts:391,1742-1746`, and every remaining `tradingContext.locationId`;
- `apps/server/src/receipt-print.ts:180,329,352` and `receipt-presentation.ts:12`
  (`Pick<TradingContext, "locationId" | …>`, S2's files: type only);
- `apps/server/scripts/dev-setup.ts:285` and `demo-seed/seed-floor.ts:36-39`;
- `node-config.location.test.ts`, `boot.node-configuration.test.ts:374`,
  `boot.setup-routes.test.ts:577` and `join-requests.test.ts`;
- the typed `TradingContext` and `NodeConfig` literals in tests: 60 lines at the plan head, from
  `git grep -n -P ':\s*(TradingContext|NodeConfig|DeviceRequestConfig|OriginConfig)\s*=|satisfies (TradingContext|NodeConfig)|as (TradingContext|NodeConfig)\b'`
  over tests and helpers.

- [ ] **Step 1:** Delete join-requests' scope-blind case by title. Delete the `readNodeLocation`
  cases in `node-config.location.test.ts` by title. If nothing else is left in the file, delete
  the file.
- [ ] **Step 2:** Boot keeps the check that `WAITRON_NODE_ID` names a node in the database. Read
  `nodes` by id, and throw `server.node_config_invalid { key: "WAITRON_NODE_ID" }` when it is
  missing, as `:1743-1744` does today.
  - If no boot suite already starts with a node id the database does not hold, add that case. It
    passes before the change and must pass after.
  - As a control, delete the new check for a moment and watch the case fail.
- [ ] **Step 3:** `NodeConfig` becomes `NodeIdentityConfig`: drop the interface, or keep the name
  as an alias if that reads better at its call sites.
  - Tests still seed `location_id` columns from `cfg.locationId` (1,046 lines at the plan head).
    So the server's test helpers return `TradingContext & { readonly locationId: string }`, under
    one named type in `apps/server/src/testing/`. A one-line comment at the type says: "the venue
    row's id, for filling `location_id` columns until the schema slices".
    (2026-11-05: the type is `WithVenueRowId`, in `apps/server/src/testing/venue-row-id.ts`.)
  - That type is an **exception** to the parent plan's global constraint "No new `location_id`,
    `locationId`, … fixture". It renames what tests already read, and adds no new use. The PR
    states this. If the owner refuses the exception, the helpers return the id from
    `venueLocationId(db)` instead, and the 1,046 reads are edited.
  - The type is carried to the schema plan for deletion with `venueLocationId` (S28).
  - Typed literals in tests take that type, or lose the property where nothing reads it.
- [ ] **Step 4:** `boot.node-configuration.test.ts:374` expects `observed.cfg` to match
  `{ nodeId: NODE }`. That changed assertion names this plan.
- [ ] **Step 5:** Typecheck `@waitron/server`. Run:
  - boot's node-configuration and setup-routes suites;
  - `join-requests.test.ts`;
  - the receipt-print and receipt-presentation suites;
  - the fiscal pair and the code guards.

  Commit.

### Task S18f-3: `LocationId` and the `locationId` brand

- [ ] **Step 1:** Measure:
  `git grep -l -P '\bLocationId\b|brandLocationId|locationId as brandLocationId|import \{[^}]*\blocationId\b[^}]*\} from "@waitron/shared"' -- apps packages scripts`.
  At the plan head that is 40 files outside tests and 301 test files. S18a–S18f-2 will have
  emptied many of them.
- [ ] **Step 2:** Add a codemod rule, `--unwrap-brand`, and run it. It replaces a call that
  resolves to `@waitron/shared`'s `locationId` with its argument (`brandLocationId(x)` → `x`), and
  drops imports left unused.
  Then retype `packages/db/src/testing/seed.ts:58,71,88` as `string`: `seedNode`'s location, and
  `seedKitchenStation`'s and `seedDevice`'s `locationId`. Retype
  `packages/venue-service/src/testing/zone-menus.ts:13`'s `{ locationId: LocationId }` (from
  S18a-6) the same way. The schema slices delete those
  parameters (parent plan, "Carried to the schema plan").
- [ ] **Step 3:** Delete `LocationId` and `locationId` from `packages/shared/src/ids.ts:11,52` and
  `index.ts:11,24`. `scripts/a1301-seed-codemod.mjs:35` names `"LocationId"` and `"locationId"`
  only as strings, so it compiles unchanged; S28 deletes it.
- [ ] **Step 4:** `pnpm -r typecheck` (every package, since the brand was everywhere). Run the
  focused suites of the files changed outside tests, the fiscal pair and the code guards. Commit.

**Note, 2026-11-05.** Step 3 was not done: the fiscal pair's
`packages/fiscal-verifactu/src/write-path.e2e.test.ts` imports the brand (`:32`) and calls it
(`:555`), and that file is never edited. So `LocationId` and `locationId` stay in
`packages/shared/src/ids.ts` with a one-line note (owner asked; the default was to keep them).
Step 2's retype to `string` also covered `apps/server/src/testing/venue-row-id.ts`
(`WithVenueRowId`).

### Task S18f-4: The whole-tree done-check, the backlog, the parent plan

- [ ] **Step 1:** Run the done-check:
  ```zsh
  P='(^|[^A-Za-z])[Ll]ocations?([^A-Za-z]|$)|[Ll]ocation(Id|_id|Name|[A-Z_])|[a-z]Location'
  PATHS=('apps/**' 'packages/**' 'scripts/**' ':!*.test.ts' ':!*.test.mjs' ':!**/drizzle/**' ':!*.md')
  git grep -n -E "$P" -- "${PATHS[@]}" ':!packages/country-es/test-fixtures/**' ':!scripts/a1301-seed-codemod.mjs'
  git grep -n -P '\b_cfg\b|\b_locationId\b' -- apps packages   # prints nothing
  git grep -n 'A1301 S18 removes it' -- apps packages          # prints nothing
  ```
  Read every line the first grep prints. Each must be one of these:
  1. a schema identifier, or a line that fills or filters a `location_id` column, including
     `venueLocationId` (with the cheaper schedule's interim outward reads) and the test helpers'
     `locationId` from S18f-2;
  2. product text or a comment (S19);
  3. a word that is not Waitron's location (the table under "What was measured");
  4. `department-receipt-app-fixture.ts:114`.

  Anything else is unfinished: finish it in this task, or stop and report it.
- [ ] **Step 2:** In `docs/backlog/architecture.md`, delete A1301's "**S18:**" bullet and update
  "Still open". Add these to the schema slices' bullet:
  - the test-helper type from S18f-2;
  - `verifyCoreBackupData`'s reads of `locations` and `nodes.location_id`;
  - `saveHolidayArea`'s second read, if S18c has not moved it already;
  - under the cheaper schedule, the interim outward reads, which S18e or S28 removes.
- [ ] **Step 3:** In the parent plan's "Notes for S18", add a dated line saying S18 is done, with
  its PRs.
- [ ] **Step 4:** `pnpm format:check`, commit, `/finish-branch`.

---

## Consequences

- **What waits for the venue-id design** depends on owner choice 1:
  - *Default schedule:* S19 and the whole schema plan wait for it. The parent plan has S19 after
    S18, and S20–S28 after S18 (`S23 | … | S18, F1–F5`).
  - *Cheaper schedule:* only S18e and S28 wait for it.
  - Either way, if the owner wants S19 sooner, it could follow S18a–S18d. It would leave alone the
    backup screen's folder wording, which S18e rewrites.
- **Carried to the schema plan:**
  - the S18f-2 test-helper type;
  - `verifyCoreBackupData`'s `locations` and `nodes.location_id` reads (S18f-1);
  - `saveHolidayArea`'s second read;
  - the `fake-core.ts:76` and `zone-menus.ts:28` column lines (S18a-1 Step 3);
  - under the cheaper schedule, the interim outward reads, if S18e has not landed by S28.
- **Carried to Cloud** (`~/waitron-campaign/a1301/cloud-followup.md`): S18d-1's `writeTradingEnv`
  callers, and everything the venue-id design lists.
