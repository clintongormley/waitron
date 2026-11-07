# A1384: words on setup's refusals

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

> 2026-11-06: the fresh-context review is folded in; see "Review fold" at the end.

**Goal:** Every refusal the backlog bundle A1384 names says what happened and what each choice
does, in English and Spanish, without sending the person to somebody else (root `CLAUDE.md` §3,
first rule; `docs/developers/conventions-ui.md#refusals-name-a-self-service-next-step`). Six
entries, one pull request.

**Architecture:** Mostly words. Three server changes carry facts the setup page cannot see today:
Start again's `setup.not_ready` gains a log-safe `cause`; a newer configuration export gets its own
code, `setup.configuration_newer`; Start again over plain HTTP gets its own code,
`setup.connection_insecure`. The setup app words each. The rest is string changes, one
mode-screen change, one new test that records an answer, and the backlog deletions.

**Tech stack:** TypeScript, Lit (setup and till apps, Vitest browser mode in real Chromium), Hono
(server), Vitest 4.1.12.

**Spec:** the bundle text, `docs/backlog/setup.md` → "Bundle A1384: Words on setup's refusals"
(line 665 on `59be31e3b7`) and the detail sections it links (lines 293-310, 333-340, 357-376,
547-559).

**Branch:** `fix/a1384-setup-refusal-words`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-fix-a1384-setup-refusal-words`, off main
`59be31e3b7`. The executing session keeps the ledger
`docs/handoffs/2026-11-06-a1384-setup-refusal-words.md`.

## Global Constraints

- No table, no column, no migration, no schema change (the A1308 hold). If a step turns out to
  need one, stop that step and report.
- Nothing here touches invoices, the hash chain, invoice series or AEAT filing. Task 9 does edit
  fiscal package code: it renames the throwaway seat's request field in
  `packages/fiscal-verifactu/src/hour-throwaway-allocation.ts` and `throwaway-allocation.ts`, and
  nothing else there. Task 8 words that package's refusal and Task 10 runs the recovery pack on a
  throwaway venue; neither edits it. If any other step finds it must change fiscal code, stop and
  report.
- An existing assertion changed to expect a different error code is a behaviour change: every
  such test is named in its task, and the PR description lists them under "Tests changed because
  the behaviour changed".
- Every new user-visible sentence is listed in "Words for the owner's OK" below and goes into the
  PR description under that heading. The PR is built with them; it does not land until the owner
  has OK'd them.
- English only in code, comments, identifiers and tests (CLAUDE.md §3).
- Error params are log-safe enums: never a path, a name, an email or a tax number.
- Comments only for an invariant or a non-obvious why. No history.
- Every commit `git commit -s`, message in plain English.
- Each implementer runs `pnpm format:check` and the typecheck of every package it touched
  (`pnpm --filter <pkg> typecheck`) before committing, plus the focused tests its task names. CI owns
  the package suites.
- The setup and till tests run in real headless Chromium: check `memory_pressure | grep free`
  first and scale to what is free.
- Read a Vitest run's `Tests` count, never only its exit status.

## Overlap with open work

Open PR #2521 (`feat/a1379-setup-start-again`, A1379 pull request 1) shares these files with this
plan (`gh pr diff 2521 --name-only`, 2026-11-06):

- `apps/setup/src/setup-app.ts` (Tasks 3, 4)
- `apps/setup/src/setup-app-wipe.test.ts` (Tasks 3, 4)
- `apps/setup/src/setup-app-recover.test.ts`, `apps/setup/src/setup-app-resolution.test.ts`
  (possibly Task 3, if a case there pins `wipeUnavailable`)
- `apps/server/src/guide/en/backup-recovery.md`, `apps/server/src/guide/es/backup-recovery.md`
  (Task 5)
- `docs/backlog.md`, `docs/backlog/setup.md` (Task 12)

Whichever lands second rebases. Overlap is not a reason to wait. A1379's pull request 2 (planned,
not open) removes the `trading-settings` cause, `tradingSavedPassword` and the inspection's
`password` field (its plan, Tasks P2-2, P2-10, P2-13); Task 3 here adds causes beside
`trading-settings` in the same union, so that rebase is a union merge, not a conflict of meaning.

## What the code says, with receipts

All line numbers are on `59be31e3b7`.

### Entry 1: the Start again summary's `setup.not_ready` carries no cause

**Where the page words it.** `wipeRefusal` (`apps/setup/src/start-again-wipe.ts:74-81`) turns
`setup.not_ready` and `setup.owner_required` into `"unavailable"`; the first-owner screen draws
`initialOwnerStrings[lang].wipeUnavailable` for it (`apps/setup/src/setup-app.ts:2219-2226`,
drawn at `:2332-2335`), EN `apps/setup/src/screens/initial-owner-strings.ts:38-39`, ES `:99-100`.
The same words are drawn when the page itself does not offer Start again (`!offered`,
`setup-app.ts:2333`); `setup-app-wipe.test.ts:294-304` pins that path. The page can also throw
`setup.not_ready` itself (`#firstResolutionSnapshot`, `setup-app.ts:1262-1275`, when the password is
not `checkable` or the revision or owner generation is null), but not on the Start again path: the
inspection sets `password: "uncheckable"` exactly when it sets `revision` null
(`packages/provisioning/src/first-setup-resolution-inspection.ts:366-368`), and Start again is
offered only with a revision and owner generation (`wipeOffered`, `setup-app.ts:235-239`, checked on
the same inspection at `:1298` before the snapshot is built at `:1299`). It gets no new words.

**The existing pattern for carrying a cause.** `setup.start_again_refused` carries
`{ cause: "setup-finished" | "kept-records" | "trading-settings" }`
(`apps/server/src/errors.ts:1211`, thrown by `refused`, `first-setup-resolution.ts:49-58`); the
page reads it in `startAgainRefusalCause` (`apps/setup/src/first-setup-session.ts:63-79`) and words
each cause (`setup-app.ts:2219-2226`).

**Every `setup.not_ready` the summary and Start again can answer.** The routes are
`setup-first-fiscal-api.ts:840-872` (summary) and `:873-` (Start again); the work is
`assessStartAgain`, `apps/server/src/first-setup-resolution.ts:235-312`. Repair-page production
wiring passes `modules: ALL_MODULES` (`apps/server/src/first-setup-entry.ts:252-256`, read).

| Site | What it means | Can a person act on it? | Cause in this plan |
| --- | --- | --- | --- |
| `first-setup-resolution.ts:243` `readForRepair() === null` | the claim marker is gone. Not reachable on this path: without the marker and with `first-setup.json` present, the read refuses `setup.attempt_invalid` (`packages/provisioning/src/first-setup-state.ts:472-477`), and deleting the marker changes the inspection, so `:241` answers `setup.attempt_conflict` first | no | none: worded as a fault |
| `:250` database label `unreadable` | the inspection could not open `venue.db` as a regular file: the venue folder is not a plain folder, `venue.db` is not a regular file, or opening it failed (`first-setup-resolution-inspection.ts:84-85`, `artifact` at `:41-60`, called with no size limit at `:127`) | no step on the page | `unreadable` |
| `:84` held setup whose database shows no records | activation went past its start, yet the database holds nothing | no | `may-have-filed` |
| `:275` not provably unused | `firstSetupUnusedAssignment` (`apps/server/src/first-setup-unused-assignment.ts:10-80`) could not prove the attempt used nothing: a step past the checks, an unexpected file, or a module version that differs from the installed one | no; A1161 asks the owner whether some of these should still block | `may-have-filed` |
| `:277` evidence configured outside the folders | public fiscal evidence the box keeps outside its folders | no | `may-have-filed` |
| `:290` a setup database that should be unused reads whole and is not empty | data an unused setup should not hold | no | `unexpected` |
| `:295` held database with no rows | same as `:84`, found by reading | no | `may-have-filed` |
| `:295` damaged label, but the read succeeded | the inspection could not read it; the later read could | no | `unreadable` |
| `first-setup-database-holdings.ts:92, :99` the scratch copy failed with `ENOSPC` | no room for the copy | yes: free space, restart | answer `storage.disk_full`; the route turns it into the repair page's existing full-disk answer (`diskFullOr`, `setup-first-fiscal-api.ts:639-642`, words `shell.first_setup.disk_full`, `setup-app.ts:262-268`) |
| `first-setup-database-holdings.ts:36-38` and its other sites `:76, :88, :92, :95, :99, :101, :113, :119, :127, :151` | the box could not read or copy the setup database | no | `unreadable` (in the `notReady` helper) |
| `packages/provisioning/src/first-setup-resolution-inspection.ts:157` (first half) and `:192`, inside `captureFirstSetupOriginals` (called at `first-setup-resolution.ts:259`) | a listed path is not a plain file; the documents folder is not a plain folder | no | `unexpected` |
| `first-setup-resolution-inspection.ts:157` (second half), `:159`, `:194` | a listed file over 128 MiB (for example `venue.db-wal`); over 1,024 documents | no | `too-large` |
| `packages/provisioning/src/first-setup-start-again-deletion.ts:473, :498, :505-512, :514` (`check failed`, `node.db unreadable`) | I/O failure checking a file | no | `unreadable` |
| `first-setup-start-again-deletion.ts:492` refused artifact; `:497` unexpected layout; `:503` `node.db-wal` holds pages; `:518` node.db holds another node's row or a table | files or rows the box does not expect | no | `unexpected` |
| `first-setup-resolution.ts:227` deletion list over its 1 MiB limit (Start again only) | too many files to list | no | `too-large` |
| `first-setup-resolution.ts:224` marker build failed (`setup.start_again_incomplete` mapped) (Start again only) | hashing a listed file failed (`check failed`, `first-setup-start-again-deletion.ts:119-122, :324-327`). Its other reason, `layout unexpected`, needs the folders to change after the check at `:281`, inside the same venue exclusion and turn (`first-setup-resolution.ts:327-328`): read, not run | no | `unreadable` |
| `first-setup-resolution.ts:120, :287` `modules === undefined` | production always passes modules (`first-setup-entry.ts:252-256`) | only a Waitron fault can produce it | none: worded as a fault |
| `first-setup-resolution.ts:257, :272, :274` | a Start again request the page never sends (the page always sends the confirmation, `start-again-wipe.ts:53-61`; `register` is sent only by the command line) | only a Waitron fault, from the page | none: worded as a fault |

`assertStartAgainAllowedOnDisk` has one caller (`first-setup-resolution.ts:281`); the recovery
page's Keep or Move form does not use it, so adding a cause there changes nothing on that form
(`grep -rn assertStartAgainAllowedOnDisk apps packages`, 2026-11-06).

**Decision.** `setup.not_ready`'s params become `{ cause?: "may-have-filed" | "unexpected" |
"too-large" | "unreadable" }` (`packages/provisioning/src/errors.ts:21`; the only declaration, by
grep). Optional, so every other `setup.not_ready` in the tree is unchanged. The brief allowed either a
cause on `setup.not_ready` or a new `setup.start_again_refused` cause; `setup.not_ready` keeps every
log line and status (503) exactly as today and changes no other caller. A server-answered
`setup.not_ready` with no cause is worded as a fault in Waitron. A copy that fails for lack of space
answers the existing `storage.disk_full`, so the page shows the owner's approved full-disk words,
which say to restart first.

None of the four causes has a self-service way out on the page. `may-have-filed` does not offer
reinstalling, because a setup that may have reached AEAT must not be wiped by advice (that is
A1161's owner decision, kept open). `unexpected`, `too-large` and `unreadable` end with the owner's
approved reinstall sentence (A1127, 2026-10-28 08:25; `shell.first_setup.disk_full`,
`apps/setup/src/i18n/strings/shell.ts:12-13`), which is a step the person can take, with its cost.
A1159 (`docs/backlog/self-service-refusals.md#a1159-…`) stays open for the missing workflow.

### Entry 2: a box on an older configuration format blames the export

`parseConfigurationBundle` (`packages/provisioning/src/configuration-transfer.ts:464-471`): a
format version above 10 answers `setup.request_invalid { field: "version" }`; any other version
answers `setup.configuration_outdated`. `validateConfigurationBundle` (`:571-586`): a module the box
does not run answers `{ field: "modules" }`; any module whose schema version differs, in either
direction, answers `{ field: "module:<name>" }`. The target versions are each module's applied
schema version, read off the box's own database (`schemaVersionsByModule`,
`apps/server/src/backup-manifest.ts:19-31`, called with the box's store at
`apps/server/src/boot.ts:1517-1521`).

The setup page words `version`, `modules` and `module:*` alike as
`shell.configuration.incompatible_version` (`apps/setup/src/setup-app.ts:464-475`; EN
`apps/setup/src/i18n/strings/shell.ts:142-143`, ES `:307-308`), "Export it again from a box running
the current version". So the refusal does not say which side is newer; the format-version case does
on the wire, but the page drops it. Pinned by `apps/setup/src/setup-app.test.ts:3165-3205` (all
three fields, one sentence), `apps/server/src/configuration-import.test.ts:225-249`,
`packages/provisioning/src/configuration-transfer.boundaries.test.ts:53, :237`.

**Decision.** A new code, `setup.configuration_newer` (params `{}`), for the format version above 10
and for an export module version above the box's. An export module version below the box's answers
the existing `setup.configuration_outdated`, whose words already say the export is older. A module
the export lacks answers `setup.request_invalid { field: "module:<name>" }`: since bd8a22a445 an
export lists only the modules switched on at its box, so a missing one means the two boxes run
different modules, and exporting again would give the same file. That, a module the box does not run
(`modules`) and a module the box runs with no transfer contribution
(`configuration-transfer.ts:171-172`) keep `setup.request_invalid` and the key
`shell.configuration.incompatible_version`, whose words change so they blame neither side; neither
is a version direction. Wording follows the
existing "newer software" refusals (`shell.bucket.newer_software`, `shell.cloud.newer_software`,
`shell.ts:101-102, :129-130`).

2026-11-07, after the rebase onto A760 part 3 (eed41cc3c0): a module version that differs in either
direction answers `setup.configuration_other_version` («made by a different version of Waitron»),
since a migration squash resets the counts; `setup.configuration_newer` is the format version's
alone, and `incompatible_version`'s words now also name another version.

**Existing tests whose expected code flips** (a behaviour change; the PR names each):

- `packages/provisioning/src/configuration-transfer.boundaries.test.ts:53` (`{ version: 11 }`):
  `setup.request_invalid { field: "version" }` → `setup.configuration_newer`.
- same file `:238` (export `synthetic-transfer: 2`, box 1): `module:synthetic-transfer` →
  `setup.configuration_newer`; the row moves out of the `field` table into its own case.
- same file `:275-283` (export 99, box 1, "checks an import's module version before replacing its
  existing rows"): → `setup.configuration_newer`; the "rows kept" assertion stays.
- `apps/server/src/configuration-import.test.ts:241` ("future version"): → `setup.configuration_newer`.
- same file `:940` (venue-service older than the box): → `{ code: "setup.configuration_outdated", params: {} }`.
- same file `:965` (core older than the box): → `{ code: "setup.configuration_outdated", params: {} }`.
- `apps/setup/src/setup-app.test.ts:3165-3205`: the sentence changes (M2 words) and `"version"`
  leaves its loop.

### Entry 3: other full-disk words

From the owner's A1127 answers (2026-10-28, `~/waitron-campaign/questions.md:830-844`, quoted in
`docs/superpowers/specs/2026-10-28-a1127-full-boot-and-old-backups-design.md:295-302`): Q4 kept the
till strip's «Tell a manager» as a stated exception (`apps/till/src/i18n/staff-notices.ts:8-11`);
"both pages use the LONGER [reinstall sentence]".

1. **Till refusals outside the strip.** `storage.disk_full` (`apps/till/src/i18n/codes.ts:775-777`),
   `sale.disk_full`, `sale.disk_full_manual_card`, `sale.charged_disk_full`
   (`apps/till/src/i18n/strings.ts:1450-1455`, ES `:3332-3337`) all end «Tell a manager». The till
   has no manager sign-in and no way to Box status (`grep system.manage apps/till/src` finds
   nothing; `CapabilityFlag`, `apps/till/src/layout.ts:39-53`). Q4's reason, "a waiter at a stopped
   till has no step of their own", is the same for these. **Decision:** the PR keeps the words and
   states the exception at their site and in `conventions-ui.md`; the owner question offers the
   alternative of dropping «Tell a manager» from them.
2. **Recovery page Start-again form, `diskFull` and `forgotten`** (`apps/server/src/recovery-start-again.ts:81-82, :92-93`, ES `:122-123, :134-135`)
   end with the short reinstall sentence. **Decision:** both take the longer sentence, keeping
   "these files" because this form is about the files it found. The words must pass
   `apps/server/src/recovery-surface.test.ts:1320-1350` (no "delet", "remov", "wipe", "erase",
   "reset" in EN; no "borra", "elimina", "quit", "suprim"… in ES, `:198`).
3. **Managers' full-disk email** (`apps/server/src/i18n/box-emails.ts:13-21`) ends "ask whoever
   installed the box to free more space or fit a bigger disk". Box status can only Free
   (`apps/dashboard/src/screens/box-status-screen.ts:417-443`); its guide says "This page cannot
   remove other files or move your data to a larger disk." (`apps/server/src/guide/en/box-status.md:147`).
   **Decision:** the last sentence takes the full-disk page's approved words for what is left
   (`apps/server/src/i18n/recovery-page.ts:208`), with no referral.

### Entry 4: Start again over plain HTTP

`assertHttps` (`apps/server/src/setup-first-fiscal-api.ts:835-839`) answers
`setup.owner_required` on the summary (`:844`) and Start again (`:878`). The same code also means
"not sent from this origin" (`assertFirstFiscalRequest`, `:99-100`). The page draws
`wipeUnavailable` for it (`start-again-wipe.ts:74-81`), beside the "Set up secure connection" link
(`setup-app.ts:2418-2427`). Pinned by `apps/setup/src/setup-app-wipe.test.ts:135-144, :249-254` and
`apps/setup/src/start-again-wipe.test.ts:230`.

**Decision.** `assertHttps` throws a new `setup.connection_insecure` (params `{}`, HTTP 403),
modelled on `recovery.pack_connection_insecure` (`apps/server/src/errors.ts:1374-1375`). The two
other plain-HTTP refusals in that file (Continue's `:697`, publication and finish `:731, :762`) keep
`setup.owner_required`: A1379 pull request 2 removes those routes.

### Entry 5: `server_fields.operation_description`

The setup wizard no longer sends the value; `parseVenue` fills the filing module's default
(`apps/server/src/setup-api.ts:502-507`, since #2441, `98ac0f4de8`). The words still ask the person
to shorten it and remove hidden characters (EN `apps/setup/src/i18n/strings/start.ts:128-129`, ES
`:258-259`), used by `SERVER_FIELDS.operationDescription` (`apps/setup/src/server-fields.ts:49-54`).
`scripts/setup-wizard-fiscal-fields.test.ts:9-20` requires the entry to exist and say something.
`apps/setup/src/screens/venue-screen.test.ts:1052-1080` checks the sentence is drawn above Next
with Next enabled, by key. **Decision:** reword as a fault in Waitron; the field stays mapped.

### Entry 6: loose ends left by A680

**(a) `sif.throwaway_allocation_refused` has no words, and a production box offers Demo and
Preparation.**

- Raised by the wired seat, `packages/fiscal-verifactu/src/hour-throwaway-allocation.ts:24-30`
  (wired at `packages/fiscal-verifactu/src/provisioning.ts:13`), params `{ environment }`, when an
  environment it is given is not `preproduction`. `POST /setup-api/provision` passes
  `[hostEnvironment, requestEnvironment]` (`apps/server/src/setup-api.ts:595-596, :636-645`;
  `apps/server/src/provision.ts:133-138`), so Demo or Preparation on a `WAITRON_ENV=production`
  box is refused before anything is written. It is not in `PROVISION_STATUS`, so it answers 400
  (`setup-api.ts:246-281`), pinned by `apps/server/src/setup-api.throwaway.test.ts:169-195` and
  `apps/server/src/boot.setup-routes.test.ts:738`.
- The setup app has no entry for it (`grep -rn "sif\.\|throwaway" apps/setup/src` finds none);
  `#mapProvisionError` falls to its default (`apps/setup/src/setup-app.ts:1624-1626`),
  `shell.provision.failed` (EN `shell.ts:57-58`, ES `:219-220`): "Provisioning failed. Check that
  the server is on…", with a Retry that can only fail again.
- The mode screen already knows the environment: `GET /setup-api/status` answers `environment`
  (`setup-api.ts:758`), the app keeps it (`setup-app.ts:793, :833`) and passes it to
  `setup-mode-screen` (`:2525, :2602`), which uses it only for the production warning
  (`apps/setup/src/screens/mode-screen.ts:169-175`) and always draws all four choices (`:180-212`).
  `WAITRON_ENV=dev` reads as `preproduction` (`packages/db/src/deployment.ts:20-24`), so a dev box
  keeps Demo.
- The B3 design already decided it: "A box started in production: only «En vivo» and «Ya tengo un
  restaurante» … Demo and Prepare are not drawn. The refusal `sif.throwaway_allocation_refused` gets
  its own words for a request that reaches it anyway."
  (`docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md:1141-1146`). B3's own Task 8.1
  (`docs/superpowers/plans/2026-10-26-b3-usb-installer.md:240-246`, not built) adds the installer
  marker's rules on top; this plan does only the production half.

**Decision.** The mode screen does not draw Demo or Prepare your restaurant when `environment` is
`production`; the refusal gets its own words, with Reload in place of Retry.

**(b) "Anyone who reaches the wizard first can set up Demo or Preparation."** The owner has
decided this: "The owner explicitly dropped the setup code on 2026-10-26 ~12:15 … The accepted cost
is that another person on the LAN can view the allowed configuration and claim an unconfigured box
first. W60's production-mode restriction (§12.1) is independent and stays."
(`2026-10-21-b3-usb-installer-design.md:1369-1377`; also `docs/backlog.md:1820`). Live's claim
(`packages/provisioning/src/first-setup-owner.ts:373-418`) proves the claiming tab, not ownership of
the box. **Decision:** no code change; the entry is deleted and the decision is written into
`docs/backlog/setup.md`'s "Decisions and deliberate limits" so it is not asked again.

**(c) `taxpayerNif` in `ThrowawayAllocation.prepare`.** Defined at
`packages/module/src/provisioning.ts:74-92` (`:80`). Implemented by
`packages/fiscal-verifactu/src/hour-throwaway-allocation.ts:23, :51` and the unwired
`packages/fiscal-verifactu/src/throwaway-allocation.ts:40, :62`; called only from
`packages/provisioning/src/throwaway-allocation.ts:37-43` (`taxpayerNif: taxpayer.taxId`). Lane E's
A679 has landed (#1752, `4e318802f6`), so nothing outside this repository is waiting on the shape.
`@waitron/module`, `@waitron/provisioning` and `@waitron/fiscal-verifactu` are private packages;
the published `@waitron/verifactu` (`~/workspace/repos/verifactu`) has no `taxpayerNif` and no
`throwawayAllocation` (research agent's grep, 2026-11-06). **Decision:** the rename is wholly
inside this repository, so the PR renames the REQUEST field to `taxId`. The ALLOCATION's own
`taxpayerNif` field is not touched: it is the fiscal allocation file's format, used across
`packages/fiscal-verifactu` and by Waitron Cloud's registry (`CHECK(allocation->>'taxpayerNif' …)`
in its migration 038, per the research agent).

**(d) Whether a throwaway venue can get an offline recovery pack.** There are two pack routes.
The JSON pack, `POST /api/box/recovery-pack` (`apps/server/src/recovery-pack-api.ts:28`), checks an
operator-supplied paper block's recipient venue (`packages/fiscal-verifactu/src/recovery-pack.ts:34-41`,
`paper-evidence.ts:279-288`); a throwaway venue's hour allocation has no paper block, and no
dashboard screen calls that route since #1752 (research agent, read). The pack people download is
the PDF, `POST /api/backup/recovery-pack` (`apps/server/src/backup-recovery-pack-api.ts:371`), whose
fiscal page refuses only for the reasons in `recoveryScope`
(`packages/fiscal-verifactu/src/completed-recovery-document.ts:17-60`), none of them about a
throwaway allocation (read, not run). **Decision:** Task 10 runs the PDF route on a venue set up
with a throwaway allocation and records what it answers.

### Review weight

The rename in (c) changes a cross-package contract (`@waitron/module`'s seat), and the new error
codes are a contract between server and setup app: a risk trigger, so the FULL `/finish-branch`
wave, with the Codex run-it seat as two reviews side by side.

## Owner questions

Each has a recommended default; the PR is built with the default.

**Answered 2026-11-06:** the owner accepted all five recommended answers.

- Q1: the «Tell a manager» exception covers the till's other full-disk refusals; stated in root
  `CLAUDE.md`, `conventions-ui.md` and at both till sites.
- Q2: accepted as built.
- Q3: accepted as built.
- Q4: moot; Task 10 found the pack is made.
- Q5: accepted; the rename stands.

1. **The till's full-disk refusals outside the strip** (`storage.disk_full`, `sale.disk_full`,
   `sale.disk_full_manual_card`, `sale.charged_disk_full`). They all end «Tell a manager», which
   your 28 October answer allowed for the strip only. **Recommended: the same exception covers them**,
   for your reason ("a waiter at a stopped till has no step of their own"); the words stay and the
   exception is written at their site. Alternative: drop «Tell a manager» from them, since the strip
   above already says it: "Not saved: the box is out of disk space." **Meanwhile:** the till is
   untouched; the answer is written in (site comment and `conventions-ui.md`, or the shorter words)
   before the PR lands.
2. **Four Start again refusals have no way out but Reconnect** (Task 3): "cannot show that this
   setup sent nothing to AEAT", "finds files or data it does not expect", "holds more than Start
   again can check", "cannot read some of this setup's files". **Recommended:** the last three end
   with your approved reinstall sentence;
   the first does not, because reinstalling a setup that may have reached AEAT is a fiscal decision
   (A1161 stays open for it). **Meanwhile:** built that way.
3. **The managers' full-disk email's last sentence.** **Recommended:** the full-disk page's approved
   words for what is left (Waitron cannot free more by itself, and what fills the rest of the disk),
   in place of "ask whoever installed the box". Alternative: also name the step, "or set up a box
   with a bigger disk and recover a backup on it" (not checked end to end). **Meanwhile:** the
   recommended words.
4. **A throwaway venue's recovery pack** (Task 10 records the answer). If the PDF pack is made,
   nothing changes. If it is refused, **recommended:** a practice venue needs no pack, so the
   refusal stands with the words the dashboard already draws for it; the PR description shows them.
5. **The throwaway seat's `taxpayerNif`** (the backlog called this your call). Lane E's A679 has
   landed and nothing outside this repository uses the field, so **recommended: rename it to
   `taxId`** in the contract. The allocation file's own `taxpayerNif` stays. **Meanwhile:** the PR is
   built with the rename (Task 9); if you say keep, Task 9's commit is reverted.

## Words for the owner's OK

| Where | Key | Old (EN / ES) | New (EN / ES) |
| --- | --- | --- | --- |
| Repair page, Start again refused, `may-have-filed` | `wipeMayHaveFiled` (new) | `wipeUnavailable`: "This box cannot confirm that deleting this setup is safe, so it is not offered. Reconnect keeps everything as it is." / «Este equipo no puede confirmar que borrar esta configuración sea seguro, así que no se ofrece. Reconectar lo deja todo como está.» | "This box cannot show that this setup sent nothing to AEAT, so deleting it is not offered. Reconnect keeps everything as it is." / «Este equipo no puede demostrar que esta configuración no haya enviado nada a la AEAT, así que no se ofrece borrarla. Reconectar lo deja todo como está.» |
| same, `unexpected` | `wipeUnexpected` (new) | as above | "This box finds files or data it does not expect, so deleting this setup is not offered. Reconnect keeps everything as it is. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards." / «Este equipo encuentra archivos o datos que no espera, así que no se ofrece borrar esta configuración. Reconectar lo deja todo como está. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.» |
| same, `too-large` | `wipeTooLarge` (new) | as above | "This setup holds more than Start again can check, so deleting it is not offered. Reconnect keeps everything as it is. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards." / «Esta configuración guarda más de lo que Empezar de nuevo puede comprobar, así que no se ofrece borrarla. Reconectar lo deja todo como está. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.» |
| same, `unreadable` | `wipeUnreadable` (new) | as above | "This box cannot read some of this setup's files, so deleting it is not offered. Reconnect keeps everything as it is. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards." / «Este equipo no puede leer algunos archivos de esta configuración, así que no se ofrece borrarla. Reconectar lo deja todo como está. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.» |
| same, no cause (a fault) | `wipeFault` (new) | as above | "Deleting this setup is not offered because of a fault in Waitron. Reconnect keeps everything as it is." / «No se ofrece borrar esta configuración por un fallo de Waitron. Reconectar lo deja todo como está.» |
| same, plain HTTP | `wipeInsecure` (new) | as above | "Deleting this setup needs the box's secure connection. Set it up, then open this page over it." / «Para borrar esta configuración hace falta la conexión segura del equipo. Configúrala y abre esta página con ella.» |
| Setup, loading a configuration export made by newer software | `shell.configuration.newer` (new) | `shell.configuration.incompatible_version`: "This export is not compatible with this Waitron version. Export it again from a box running the current version, then load the new export." / «Esta exportación no es compatible con esta versión de Waitron. Vuelve a exportar desde un equipo con la versión actual y carga la nueva exportación.» | "This export was made by newer Waitron software than this box has. Update this box, then load the export again." / «Esta exportación la hizo una versión de Waitron más nueva que la de este equipo. Actualiza este equipo y vuelve a cargar la exportación.» |
| Setup, an export naming a part of Waitron this box does not run | `shell.configuration.incompatible_version` | "This export is not compatible with this Waitron version. Export it again from a box running the current version, then load the new export." / «Esta exportación no es compatible con esta versión de Waitron. Vuelve a exportar desde un equipo con la versión actual y carga la nueva exportación.» | "This export and this box do not use the same parts of Waitron, so the export cannot be loaded here." / «Esta exportación y este equipo no usan las mismas partes de Waitron, así que la exportación no se puede cargar aquí.» |
| Setup, an export whose module is older than the box's | `shell.configuration.outdated` (unchanged words, now also used here) | `incompatible_version`, as above | "This configuration export is from an older format. Export it again from a current box." / «Esta exportación de configuración usa un formato anterior. Vuelve a exportarla desde un equipo actualizado.» |
| Setup venue form, operation description refused | `server_fields.operation_description` | "Keep this to 500 characters or fewer, and remove any hidden characters — typing it out instead of pasting it usually clears them." / «Usa 500 caracteres como máximo y quita los caracteres ocultos; suele bastar con escribirlo en lugar de pegarlo.» | "Waitron filled in a hidden venue detail wrongly. This is a fault in Waitron, not in what you entered." / «Waitron ha rellenado mal un dato oculto del local. Es un fallo de Waitron, no de lo que has introducido.» |
| Setup, Demo or Preparation refused on a production box | `shell.provision.throwaway_refused` (new) | `shell.provision.failed`: "Provisioning failed. Check that the server is on and your device is connected to its network, then try again. If you see a certificate warning, use the certificate help below." / «La configuración ha fallado. …» | "This server is stamped for production, so it does not offer Demo or Prepare your restaurant. Reload to choose another option." / «Este servidor está marcado para producción, así que no ofrece Demostración ni Prepara tu restaurante. Recarga para elegir otra opción.» |
| Setup mode screen on a production box | (no new words) | Demo, Prepare your restaurant, Live, Already have a restaurant? | Live and Already have a restaurant? only |
| Recovery page Start-again form, full disk | `diskFull` (`recovery-start-again.ts`) | "…If that is not enough, the choice cannot be saved on this box; if you reinstall Waitron, the box starts fresh, but everything on it is lost, these files included." / «…si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que hay en él, también estos archivos.» | "…If that is not enough, the choice cannot be saved on this box; if you reinstall Waitron, the box starts fresh, but everything on it is lost, these files included, unless a backup is restored afterwards." / «…si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, también estos archivos, salvo que después se restaure una copia de seguridad.» (the sentences before it unchanged) |
| same form, password forgotten | `forgotten` | "If the password is forgotten, this page cannot go further. If you reinstall Waitron, the box starts fresh, but everything on it is lost, these files included." / «Si se ha olvidado la contraseña, esta página no puede seguir. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que hay en él, también estos archivos.» | "If the password is forgotten, this page cannot go further. If you reinstall Waitron, the box starts fresh, but everything on it is lost, these files included, unless a backup is restored afterwards." / «Si se ha olvidado la contraseña, esta página no puede seguir. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, también estos archivos, salvo que después se restaure una copia de seguridad.» |
| Managers' full-disk email, last sentence | `BOX_EMAILS["storage.disk_full"].text` | "If that is not enough, ask whoever installed the box to free more space or fit a bigger disk." / «Si no basta, pide a quien instaló el equipo que libere más espacio o ponga un disco mayor.» | "If that is not enough, Waitron cannot free more space by itself: the rest of the disk holds the venue's data, the backups kept on this box and files that are not Waitron's." / «Si no basta, Waitron no puede liberar más espacio por sí solo: el resto del disco guarda los datos del local, las copias de seguridad que se guardan en este equipo y archivos que no son de Waitron.» |
| Till full-disk refusals | (unchanged) | «Tell a manager» endings | unchanged until the owner answers Owner question 1 |

2026-11-07, after the rebase onto A760 part 3 (eed41cc3c0), for the three configuration-export rows
above: a module version that differs in either direction answers `setup.configuration_other_version`
with `shell.configuration.other_version` ("This export was made by a different version of Waitron,
so this box cannot load it. …"), since a migration squash resets the counts;
`shell.configuration.newer` answers the format version alone, and `incompatible_version`'s words now
also name another version (the words are in `apps/setup/src/i18n/strings/shell.ts`).

## File structure

- `packages/provisioning/src/errors.ts`: `setup.not_ready` gains `cause?`; new
  `setup.configuration_newer`.
- `packages/provisioning/src/first-setup-start-again-deletion.ts`: causes on its `setup.not_ready`.
- `packages/provisioning/src/configuration-transfer.ts`: newer and older exports answered by
  direction.
- `apps/server/src/first-setup-resolution.ts`, `apps/server/src/first-setup-database-holdings.ts`:
  causes; a copy that fails for lack of space answers `storage.disk_full`.
- `apps/server/src/setup-first-fiscal-api.ts`, `apps/server/src/errors.ts`:
  `setup.connection_insecure`.
- `apps/server/src/setup-api.ts`: `setup.configuration_newer` → 400.
- `apps/setup/src/start-again-wipe.ts`, `apps/setup/src/api/first-setup-types.ts`,
  `apps/setup/src/setup-app.ts`, `apps/setup/src/screens/initial-owner-strings.ts`,
  `apps/setup/src/i18n/strings/shell.ts`, `apps/setup/src/i18n/strings/start.ts`,
  `apps/setup/src/screens/mode-screen.ts`: words and the mode screen.
- `packages/module/src/provisioning.ts`, `packages/provisioning/src/throwaway-allocation.ts`,
  `packages/fiscal-verifactu/src/hour-throwaway-allocation.ts`,
  `packages/fiscal-verifactu/src/throwaway-allocation.ts`: the seat's request field.
- `apps/server/src/recovery-start-again.ts`, `apps/server/src/i18n/box-emails.ts`,
  `apps/till/src/i18n/codes.ts`, `apps/till/src/i18n/strings.ts`: full-disk words and site notes.
- `apps/server/src/guide/{en,es}/backup-recovery.md`, `docs/developers/conventions-ui.md`,
  `docs/backlog.md`, `docs/backlog/setup.md`.

## Tasks

### Task 1: Start again's disk checks name a cause (provisioning)

**Files:** `packages/provisioning/src/errors.ts:21`,
`packages/provisioning/src/first-setup-start-again-deletion.ts:462-521`,
`packages/provisioning/src/first-setup-resolution-inspection.ts:141-200`
(`captureFirstSetupOriginals`); tests
`packages/provisioning/src/first-setup-start-again-deletion.test.ts`,
`packages/provisioning/src/first-setup-resolution-inspection.test.ts` (or wherever
`grep -rln captureFirstSetupOriginals packages/provisioning/src --include='*.test.ts'` points).

- [ ] **Step 1: failing tests.** In `first-setup-start-again-deletion.test.ts`, make its
  `refusal(...)` helper also return the error's `params`, then change the existing expectations:
  the `EACCES` case (`:70-81`) expects `params: { cause: "unreadable" }`; "with held, the disk check
  accepts the setup's modules.json; without it, refuses" (`:91-98`) expects
  `params: { cause: "unexpected" }`. Add one case per remaining site, each asserting `code`,
  `params` and the unchanged `reason`: a `node.db-wal` holding pages → `unexpected`; a `node.db`
  that is not a database → `unreadable`; a `node.db` holding another node's row → `unexpected`; an
  unexpected file in the venue folder (`layout unexpected`) → `unexpected`.
  For `captureFirstSetupOriginals`, one case each asserting `{ code: "setup.not_ready", params }`:
  a listed path that is a folder (`state/setup-operation.json` made a directory) → `unexpected`; a
  `first-fiscal-documents` that is a file → `unexpected`; a `venue.db-wal` over the limit →
  `too-large` (pass a smaller `limit` through a test seam only if one exists; otherwise write a
  sparse file with `truncate` to just over 128 MiB, which uses no disk); 1,025 files in
  `first-fiscal-documents` → `too-large`.
- [ ] **Step 2:** run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-deletion.test.ts`;
  the new and changed cases fail on `params`.
- [ ] **Step 3: change.** `errors.ts`: `"setup.not_ready": { cause?: "may-have-filed" | "unexpected" | "too-large" | "unreadable" };`
  with a one-line doc comment saying the cause is a log-safe name the setup page words. In
  `assertStartAgainAllowedOnDisk`, `notReady(reason, cause)`: `check failed` (`:473, :498`),
  `node.db unreadable` and the `-wal` check failure (`:505-514`) → `unreadable`; refused artifact
  (`:492`), `layout unexpected` (`:497`), `node.db-wal holds pages` (`:503`) and `nodeRefusal`
  (`:518`) → `unexpected`. In `captureFirstSetupOriginals`, split `:157`'s condition: not a file →
  `unexpected`, over the limit → `too-large`; `:159` → `too-large`; `:192` → `unexpected`; `:194` →
  `too-large`. `writeStartAgainMarker`'s size refusal (`:374`) stays cause-less (it is
  checked after `markerFor`'s own check, `apps/server/src/first-setup-resolution.ts:227`, so only a
  fault reaches it).
- [ ] **Step 4:** the same command passes; read the `Tests` count. Run
  `pnpm --filter @waitron/provisioning typecheck` and `pnpm format:check`. Commit:
  "Start again's disk checks say which kind of problem stopped them".

### Task 2: the server's Start again names a cause

**Files:** `apps/server/src/first-setup-resolution.ts`, `apps/server/src/first-setup-database-holdings.ts`;
tests `apps/server/src/first-setup-start-again.test.ts`,
`apps/server/src/first-setup-start-again-held*.test.ts`,
`apps/server/src/first-setup-database-holdings.test.ts`,
`apps/server/src/first-setup-database-holdings-damage.test.ts`.

- [ ] **Step 1: failing tests.** One assertion of `params` per site, written explicitly. The held
  fixture's `notReady = { code: "setup.not_ready" }` (`apps/server/test/start-again-held-fixture.ts:155`)
  is used as a partial match, so a test that passes it proves nothing about the cause: assert
  `expect(error.params).toEqual({ cause })` beside it, or add a `notReadyBecause(cause)` helper in
  that fixture that matches `{ code, params: { cause } }`.
  - `:250` (`venue.db` a directory) → `unreadable`.
  - `:84` and the `rows === 0` half of `:295` (held setups; find the existing cases with
    `grep -rn "notReady" apps/server/src/first-setup-start-again-held*.test.ts`, add one where a
    site has none) → `may-have-filed`. The damaged-label half of `:295` → `unreadable`.
  - `:275`: `first-setup-start-again.test.ts:801` ("with the database present and empty, a %s
    public fiscal record refuses…") → `may-have-filed`; `:277` (an `outside-` artifact) →
    `may-have-filed`.
  - `:290` (an unused setup's database with a row) → `unexpected`.
  - `first-setup-start-again.test.ts:399-420` (damaged `node.db`) → `unreadable`.
  - `:227` (`markerLimit: 1`, the existing test seam at `first-setup-resolution.ts:188-189`) →
    `too-large`.
  - Database holdings: every `setup.not_ready` expectation from `readSetupDatabase` gains
    `params: { cause: "unreadable" }`; new case "a copy that fails with ENOSPC answers
    storage.disk_full": make the copy fail with `ENOSPC` (the module's copy seam if one exists, or
    the small real filesystem the full-disk tests use, `docs/developers/testing-guide.md`), expect
    `{ code: "storage.disk_full" }`.
  - `:243` gets no test and no cause: it is not reachable on this path (see Entry 1).
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again.test.ts src/first-setup-start-again-held.test.ts src/first-setup-database-holdings.test.ts src/first-setup-database-holdings-damage.test.ts`;
  the changed cases fail.
- [ ] **Step 3: change.** In `first-setup-resolution.ts`, `unavailable(cause?)`, following the
  Entry 1 table; split `:295`'s condition in two. `:120, :243, :257, :272, :274, :287` stay
  cause-less. In `first-setup-database-holdings.ts`, the `notReady` helper passes
  `{ cause: "unreadable" }`; the two copy failures (`:92`, `:99`) first throw
  `new AppError("storage.disk_full", {})` when the error's `code` is `ENOSPC`. Log reasons unchanged.
- [ ] **Step 4:** find every other test pinning these answers:
  `grep -rln "setup.not_ready" apps/server/src apps/server/test --include='*.test.ts' --include='*fixture*.ts'`,
  and run the Start again ones among them:
  `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again src/first-setup-resolution src/setup-first-fiscal.route.test.ts src/first-setup-unused-pdf.test.ts src/first-setup-retired-assignments.test.ts`.
  An expectation written with `toEqual` on a site this task gave a cause gains the cause; one written
  with `toMatchObject` passes unchanged. Do not weaken any assertion.
- [ ] **Step 5:** `pnpm --filter @waitron/server typecheck`, `pnpm format:check`. Commit: "Start
  again's refusal says why: may have reached AEAT, unexpected files, too much to check, or files it
  cannot read".

### Task 3: the repair page words each cause

**Files:** `apps/setup/src/api/first-setup-types.ts:105-106`, `apps/setup/src/start-again-wipe.ts:69-81`,
`apps/setup/src/setup-app.ts:1102, :1304-1313, :2217-2226`,
`apps/setup/src/screens/initial-owner-strings.ts`; tests `apps/setup/src/start-again-wipe.test.ts`,
`apps/setup/src/setup-app-wipe.test.ts`.

- [ ] **Step 1: failing tests.**
  - `start-again-wipe.test.ts` table (`:229-230`): add rows `setup.not_ready` with
    `params: { cause: "may-have-filed" }` → `"may-have-filed"`, `unexpected` → `"unexpected"`,
    `too-large` → `"too-large"`,
    `unreadable` → `"unreadable"`; `{ code: "setup.not_ready", params: {}, status: 503 }` →
    `"fault"`; `{ code: "setup.not_ready", params: { cause: "something-new" }, status: 503 }` →
    `"fault"`; `{ code: "setup.not_ready" }` (no `status`: the page's own, unreachable on this path) →
    `"unavailable"`.
  - `setup-app-wipe.test.ts` refusals table (`:240-260`): the `setup.not_ready` row (status 409,
    `params: {}`) now expects `wipeFault`; add one row per cause expecting `wipeMayHaveFiled`,
    `wipeUnexpected`, `wipeTooLarge`, `wipeUnreadable`. The table runs in EN and ES already (`:263`). Also
    `:333-335` ("a send refused setup.not_ready…") expects `wipeFault`.
  - New case in `apps/setup/src/i18n/strings.test.ts` or beside the table: each new key exists in
    EN and ES and the two differ.
- [ ] **Step 2:** check `memory_pressure | grep free`, then run
  `pnpm --filter @waitron/setup exec vitest run src/start-again-wipe.test.ts src/setup-app-wipe.test.ts`;
  the new rows fail.
- [ ] **Step 3: change.**
  - `wipeRefusal` returns `StartAgainRefusalCause | "may-have-filed" | "unexpected" | "too-large" |
    "unreadable" | "fault" | "unavailable" | undefined`: a `setup.not_ready` with a numeric
    `status` (the server answered, `apps/setup/src/api/client.ts:240-250`) and a known
    `params.cause` gives that cause; with a `status` and no known cause, `"fault"`; with no
    `status`, `"unavailable"`. `setup.owner_required` keeps `"unavailable"` until Task 4.
  - `#renderFirstOwner` maps each new kind to its key; add the keys to `initial-owner-strings.ts`
    EN and ES with the exact sentences in "Words for the owner's OK". `wipeUnavailable` stays for the
    page-level "not offered"; the page's own `setup.not_ready` keeps it too and gets no new words,
    because it cannot be reached on this path (Entry 1).
- [ ] **Step 4:** the same command passes, `Tests` count read; also run
  `pnpm --filter @waitron/setup exec vitest run src/setup-app-held-refusals.test.ts src/setup-app-recover.test.ts src/setup-app-resolution.test.ts src/setup-app-resolution.a11y.test.ts`
  (they pin `wipeUnavailable` for page-level cases, which must still pass unchanged).
  `pnpm --filter @waitron/setup typecheck`, `pnpm format:check`. Commit: "The repair page says why
  Start again is not offered".

### Task 4: Start again over plain HTTP says a secure connection is needed

**Files:** `apps/server/src/errors.ts` (beside `recovery.pack_connection_insecure`, `:1374-1375`),
`apps/server/src/setup-first-fiscal-api.ts:28-41, :835-839`, `apps/setup/src/start-again-wipe.ts`,
`apps/setup/src/setup-app.ts`, `initial-owner-strings.ts`; tests
`apps/server/src/first-setup-start-again.test.ts:503-514, :541-560`,
`apps/setup/src/setup-app-wipe.test.ts:135-144, :249-254`, `apps/setup/src/start-again-wipe.test.ts:230`.

- [ ] **Step 1: failing tests.** The two server cases expect
  `{ error: { code: "setup.connection_insecure", params: {} } }` and status 403. The setup table row
  "the box answers setup.owner_required" becomes "the box answers setup.connection_insecure",
  expecting `wipeInsecure`, and asserts the `secure-connection` link is still drawn. `:135-144`
  keeps its `setup.owner_required` answer and still asserts the owner-tab words never show (it now
  draws `wipeUnavailable`). `start-again-wipe.test.ts` gains `setup.connection_insecure` →
  `"insecure"`.
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again.test.ts`
  and `pnpm --filter @waitron/setup exec vitest run src/setup-app-wipe.test.ts src/start-again-wipe.test.ts`; red.
- [ ] **Step 3: change.** Register `"setup.connection_insecure": Record<string, never>` with a
  one-line doc comment ("Start again was asked for over a connection that is not encrypted.");
  `assertHttps` throws it; the boundary maps it to 403. `wipeRefusal` maps it to `"insecure"`; the
  page draws `wipeInsecure`. Leave `:697, :731, :762` as they are (A1379 PR 2 removes those routes).
- [ ] **Step 4:** both commands green; `pnpm exec vitest run scripts/errors-reachable.test.ts`;
  typecheck both packages; `pnpm format:check`. Commit: "Start again over plain HTTP says it needs
  the secure connection".

### Task 5: the guide says what the repair page now says

**Files:** `apps/server/src/guide/en/backup-recovery.md:26-32`, `apps/server/src/guide/es/backup-recovery.md:30-37`.

- [ ] **Step 1:** in the EN paragraph, "If the box cannot confirm that deleting the setup is safe,
  the page says so and offers neither." becomes "If the box cannot confirm that deleting the setup
  is safe, the page says why and offers neither. Over a plain connection neither works: set up the
  secure connection first." ES: «Si el equipo no puede confirmar que borrar la configuración sea
  seguro, la página dice por qué y no ofrece ninguna. Con una conexión sin cifrar no funciona
  ninguna: configura antes la conexión segura.» Leave the next sentence for A1379 (PR #2521 rewrites
  it).
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`. Commit: "Guide: the repair page says why Start
  again is not offered".

### Task 6: a newer configuration export is worded on its own

**Files:** `packages/provisioning/src/errors.ts`, `packages/provisioning/src/configuration-transfer.ts:464-471, :571-586`,
`apps/server/src/setup-api.ts:251`, `apps/setup/src/setup-app.ts:464-475`,
`apps/setup/src/i18n/strings/shell.ts`; tests
`packages/provisioning/src/configuration-transfer.boundaries.test.ts:53, :237`,
`apps/server/src/configuration-import.test.ts:225-249`, `apps/setup/src/setup-app.test.ts:3165-3233`.

- [ ] **Step 1: failing tests.**
  - Change the six existing expectations listed under "Existing tests whose expected code flips"
    (Entry 2), each to the code named there; these are behaviour changes and go in the PR
    description's "Tests changed because the behaviour changed".
  - `configuration-transfer.boundaries.test.ts`, new case: "refuses an export that lacks a module
    the box runs as a module mismatch, not an older export" (`modules: {}`, box 1), answering
    `setup.request_invalid { field: "module:synthetic-transfer" }`. `boot.setup-routes.test.ts`
    exports through the real route from a Spanish box with `bookings` switched off and expects
    staging to answer `module:bookings`.
  - `setup-app.test.ts`: new `it.each` over en-GB and es-ES, "explains an export from newer
    software", rejecting `stageConfiguration` with `{ code: "setup.configuration_newer", params: {},
    status: 400 }` and expecting the new sentence on `live-source`, no draft import, no preview
    (copy `:3207-3232`). The existing "incompatible" case drops `"version"` from its loop (the server
    no longer sends it), keeps `module:core` and `modules`, and expects the reworded
    `incompatible_version` sentence in EN and ES.
- [ ] **Step 2:** run `pnpm --filter @waitron/provisioning exec vitest run src/configuration-transfer.boundaries.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/configuration-import.test.ts src/configuration-import.previous-export.test.ts`,
  `pnpm --filter @waitron/setup exec vitest run src/setup-app.test.ts -t "configuration"`; red.
- [ ] **Step 3: change.** Register `"setup.configuration_newer": Record<string, never>`.
  `parseConfigurationBundle`: `version > 10` throws it. `validateConfigurationBundle`: for each
  module, `target === undefined || exported === undefined` throws `setup.request_invalid { field:
  "module:<name>" }`; `exported > target` throws `setup.configuration_newer`; `exported < target`
  throws `setup.configuration_outdated`. `setup-api.ts`'s status map gains
  `"setup.configuration_newer": 400`. `describeConfigurationRefusal` maps it to
  `shell.configuration.newer`; drop `params.field === "version"` there. Add the EN and ES strings
  and reword `shell.configuration.incompatible_version` (words table).
  _2026-11-07: superseded for module versions; both directions throw
  `setup.configuration_other_version` (see the dated note under the Decision)._
- [ ] **Step 4:** the three commands green. Also run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-command-deployment`
  (the command line validates the same bundle, `first-setup-command-deployment.ts:97`) and
  `pnpm exec vitest run scripts/errors-reachable.test.ts`. Typecheck provisioning, server and setup;
  `pnpm format:check`. Commit: "A configuration export from newer software says the box needs
  updating".

### Task 7: the operation description refusal names a fault in Waitron

**Files:** `apps/setup/src/i18n/strings/start.ts:128-129, :258-259`; test
`apps/setup/src/screens/venue-screen.test.ts:1052-1080`.

- [ ] **Step 1: failing test.** New case beside `:1052`: "the operation description refusal names
  a fault in Waitron in both languages": for en-GB and es-ES, `t("server_fields.operation_description")`
  contains "fault in Waitron" / «fallo de Waitron» and does not contain "500".
- [ ] **Step 2:** `pnpm --filter @waitron/setup exec vitest run src/screens/venue-screen.test.ts`; red.
- [ ] **Step 3:** replace both strings with the sentences in the words table.
- [ ] **Step 4:** green; `pnpm exec vitest run scripts/setup-wizard-fiscal-fields.test.ts scripts/english-only.test.ts`.
  Commit: "The operation description refusal says it is a fault in Waitron".

### Task 8: a production box offers no Demo or Preparation, and the refusal has words

**Files:** `apps/setup/src/screens/mode-screen.ts:180-212`, `apps/setup/src/setup-app.ts:1556-1627`,
`apps/setup/src/i18n/strings/shell.ts`; tests `apps/setup/src/screens/mode-screen.test.ts`,
`apps/setup/src/setup-app.test.ts`.

- [ ] **Step 1: failing tests.**
  - `mode-screen.test.ts`: "a production box draws Live and Already have a restaurant only":
    `environment: "production"` → no `[data-test=choose-demo]`, no `[data-test=choose-prepare]`,
    `choose-live` and `choose-existing` present, production warning present. Control: with
    `environment: "preproduction"` and with `environment` unset, all four are drawn.
  - `setup-app.test.ts`: "Demo refused sif.throwaway_allocation_refused says the box is for
    production and offers Reload, not Retry", in en-GB and es-ES: stub `provision` to reject
    `{ code: "sif.throwaway_allocation_refused", params: { environment: "production" }, status: 400 }`,
    expect the new sentence, `[data-test=reload]` present and `[data-test=retry]` absent (find the
    provisioning-screen helpers used near `setup-app.test.ts:3140`).
- [ ] **Step 2:** check free memory; `pnpm --filter @waitron/setup exec vitest run src/screens/mode-screen.test.ts`
  and `… src/setup-app.test.ts -t "throwaway|production"`; red.
- [ ] **Step 3:** the mode screen skips the two rows when `environment === "production"`.
  `#mapProvisionError` gains a case: message `shell.provision.throwaway_refused`,
  `provisionCanRetry = false`, `provisionReloadLabel = say("shell.reload")` (as
  `deployment.already_stamped`, `:1614-1618`). Add the EN and ES strings.
- [ ] **Step 4:** green; also `pnpm --filter @waitron/setup exec vitest run src/screens/mode-screen.a11y.test.ts`. Typecheck setup; `pnpm format:check`. Commit: "A production box offers no Demo or
  Preparation, and says why if asked anyway".

### Task 9: the throwaway seat takes `taxId`, not `taxpayerNif`

**Files:** `packages/module/src/provisioning.ts:80`, `packages/provisioning/src/throwaway-allocation.ts:39`,
`packages/fiscal-verifactu/src/hour-throwaway-allocation.ts:23, :51`,
`packages/fiscal-verifactu/src/throwaway-allocation.ts:40, :62`; tests
`packages/fiscal-verifactu/src/hour-throwaway-allocation.test.ts:35`,
`packages/fiscal-verifactu/src/throwaway-allocation.test.ts:54, 83, 159, 209, 243, 274`.

- [x] **Step 1:** rename the request field in the interface first, then run
  `pnpm --filter @waitron/fiscal-verifactu typecheck` and `pnpm --filter @waitron/provisioning typecheck`:
  every caller and implementation fails to compile (this is the failing check; a rename has no
  behaviour to test).
- [x] **Step 2:** rename at each site. Inside the seats, the allocation keeps its own field:
  `taxpayerNif: taxId`. Do NOT rename `allocation.taxpayerNif`, `fiscal_allocations.taxpayer_nif`
  or anything else: `grep -rn "taxpayerNif" packages/module packages/provisioning/src/throwaway-allocation.ts`
  prints nothing afterwards, and `git diff --stat` shows only the files above and their tests.
- [x] **Step 3:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/hour-throwaway-allocation.test.ts src/throwaway-allocation.test.ts`,
  `pnpm --filter @waitron/provisioning exec vitest run src/throwaway-allocation.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/provision-throwaway.test.ts src/setup-api.throwaway.test.ts`
  (same `Tests` counts as before the rename); typecheck module, provisioning, fiscal-verifactu and
  server; `pnpm exec vitest run scripts/english-only.test.ts scripts/module-seams.test.ts`. Commit:
  "The throwaway allocation seat takes a tax id, in the contract's own words".

### Task 10: run the recovery pack on a throwaway venue and record the answer

**Files:** new `apps/server/src/provision-throwaway.recovery-pack.test.ts`; read
`apps/server/src/provision-throwaway.test.ts:30-113` (setting up a venue with a throwaway
allocation through `provision(...)`) and `apps/server/src/backup-recovery-pack-api.make.test.ts:88-110, :382-400`
(mounting and calling `POST /api/backup/recovery-pack`).

- [x] **Step 1:** before writing the test, state in the commit message what each outcome would
  print: a made pack answers 200 `application/pdf`; a refusal answers 4xx with a code.
- [x] **Step 2:** write one case: set up a venue with `initialAllocation: throwaway("preproduction")`
  as `provision-throwaway.test.ts:87-113` does, then make the PDF pack through the route as the make
  test does. Run it once with `expect(response.status).toBe(200)`.
  `pnpm --filter @waitron/server exec vitest run src/provision-throwaway.recovery-pack.test.ts`.
- [x] **Step 3:** if it passes, assert as the make test does that the PDF reads back
  (`readRecoveryPackPdf`), and add a control in the other direction that must fail for a reason
  you name in the case (so the pass is not vacuous). If it is refused, assert
  the exact `{ error: { code, params } }`, name the case after it, and report the code and the words
  the dashboard draws for it (`apps/dashboard/src/i18n/codes.ts`) for Owner question 4.
- [x] **Step 4:** if setting up the venue needs fixture work beyond these two files, stop at about
  60 tool calls and report what blocked it. Commit: "Test: what a throwaway venue's recovery pack
  answers".

**Answer (run 2026-11-06, `apps/server/src/provision-throwaway.recovery-pack.test.ts`):** the PDF
pack is made, fiscal page included. A venue set up through `provisionVenue` with
`initialAllocation: throwaway("preproduction")` answers 200 `application/pdf`, key header
`replaced`, a server-key part `included` carrying the key, and a key file scoped to the venue's tax
id in preproduction. A refused fiscal page would not have shown as a 4xx: the route still answers
200 and marks only the server-key part `failed` (header `failed`), which the test's control
produces with an unreadable preparation-state file. Owner question 4: nothing changes.

### Task 11: full-disk words outside the till strip

**Files:** `apps/server/src/recovery-start-again.ts:81-82, :92-93, :122-123, :134-135`,
`apps/server/src/i18n/box-emails.ts:13-21`; tests
`apps/server/src/recovery-start-again.test.ts:250-277`, `apps/server/src/box-alert-email.test.ts:70-85`.

- [ ] **Step 1: failing tests.**
  - `recovery-start-again.test.ts`: "the full-disk and forgotten-password words end with the
    restore-a-backup clause, in both languages": `START_AGAIN_PAGE_TEXT["en-GB"].diskFull` and
    `.forgotten` end with "unless a backup is restored afterwards."; ES with «salvo que después se
    restaure una copia de seguridad.».
  - `box-alert-email.test.ts`: "the full-disk email sends nobody elsewhere", copying the clock case
    at `:70-85`: EN text `not.toMatch(/install|support/i)`, ES `not.toMatch(/instal|soporte/i)`,
    and both still name "Settings → Box status" / «Ajustes → Estado del equipo».
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/recovery-start-again.test.ts src/box-alert-email.test.ts`; red.
- [ ] **Step 3:** the four strings and the email's last sentence as in the words table. The till,
  `conventions-ui.md` and root `CLAUDE.md` are not touched in this task: they wait for the owner's
  answer to Owner question 1. When it comes, before landing: if the exception is extended, a
  one-line comment at `apps/till/src/i18n/codes.ts:775` and above the `sale.disk_full` group in
  `apps/till/src/i18n/strings.ts:1450` saying their «Tell a manager» is the owner's strip exception
  (A1127 Q4), and `conventions-ui.md:25-26` says the same; if not, the shorter words, with
  `apps/till/src/i18n/codes.test.ts:790-814` and the guides' quotes
  (`apps/server/src/guide/{en,es}/kitchen-service.md`) following.
- [ ] **Step 4:** green; also `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts src/start-full-disk.e2e.test.ts -t "Start again|start again|diskFull"`
  (the never-delete word list and the full-disk page check). `pnpm format:check`.
  Commit: "Full-disk words outside the till strip send nobody elsewhere".

### Task 12: backlog, decisions and the PR's words

- [ ] **Step 1:** delete from `docs/backlog/setup.md`: the bundle section "Bundle A1384: Words on
  setup's refusals" (`:665-690`), and the detail sections it links: "Loose ends left by A680
  (#1718)." (`:293-310`), "A box on an older configuration format blames the export…" (`:333-340`),
  "Other full-disk words still send the person elsewhere…" (`:357-376`), "The Start again summary's
  `setup.not_ready` carries no cause." (`:547-552`), "Start again over plain HTTP says only that
  deleting is not safe" (`:554-559`). Delete both index lines in `docs/backlog.md` (`:109` and
  `:439`). If Owner question 4's answer leaves something open, it joins an existing setup bundle,
  not a new entry.
- [ ] **Step 2:** add to `docs/backlog/setup.md`'s "Decisions and deliberate limits": "**Demo and
  Preparation need no proof of who owns the box.** Whoever reaches an unconfigured box's setup page
  first can set up either; the owner accepted this when dropping the setup code (2026-10-26, B3
  design §12.5). A production box offers neither (§12.1; A1384)."
- [ ] **Step 3:** `grep -rn "a1384\|A1384\|loose-ends-left-by-a680\|other-full-disk-words" docs apps scripts`
  prints only this plan and the handoff. `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
  Commit: "Backlog: A1384 is done".
- [ ] **Step 4:** the PR description carries "Words for the owner's OK" (the table above, with any
  change review made), the four owner questions with their defaults, and Task 10's recorded answer.

## Claims in this plan that were read, not run

- Which Start again sites each cause covers, and what each means (the Entry 1 table): read from
  the code; Tasks 1-2 run the reachable ones.
- That the cause-less sites (`first-setup-resolution.ts:120, :257, :272, :274, :287`) are reached
  only through a fault in Waitron: read from the wiring and the page's request builder.
- That a throwaway venue's PDF recovery pack is not refused for being throwaway: run by Task 10; the
  pack is made with its fiscal page.
- That nothing outside this repository uses the seat's `taxpayerNif` request field: a research
  agent's grep of the repositories under `~/workspace/repos` and the campaign folders.
- That "Update this box" names a step the person can take: it repeats the existing
  `shell.bucket.newer_software` and `shell.cloud.newer_software` refusals, not checked further.
- That the recovery page's "Retry a normal boot" frees old logs and crash reports whenever its
  `diskFull` words show: read (`FULL_DISK_BYTES` 16 MiB is below `START_FREE_SPACE_FLOOR` 256 MiB,
  `apps/server/src/boot-failure.ts:47`, `apps/server/src/start-space.ts:11`); those sentences are
  unchanged here.
- That the copy in `readSetupDatabase` reports a full disk as `ENOSPC` (it copies into the system
  temporary folder, `first-setup-database-holdings.ts:91`, which may be on another disk than the
  venue folder): read; Task 2 runs it.
- That `:224`'s `layout unexpected` reason cannot occur after the check at `:281`: read.
- That an export's module version above the box's applied version means newer software: the box's
  database is read as it is, not checked against what its software ships.
- That the till's full-disk refusals show while the strip is up: not established; Owner question 1's
  recommendation does not depend on it.

## After the tasks

`/finish-branch` with the worktree path and this plan, full wave (see "Review weight"). Rebase on
main first; if #2521 has landed, resolve `setup-app.ts`, the two wipe tests and the guide paragraph
by keeping both changes.


## Review fold (2026-11-06)

The fresh-context plan review's findings, each checked against the code before the plan changed:

- **I1:** `captureFirstSetupOriginals` refuses `setup.not_ready` at
  `first-setup-resolution-inspection.ts:157, :159, :192, :194` (read). Added to the Entry 1 table and
  Task 1, with a new `too-large` cause.
- **I2:** confirmed (`first-setup-state.ts:472-477`; the inspection id covers the marker). `:243`
  stays cause-less; Task 3's `attempt_conflict` page change is gone (also settles M8).
- **M1:** the six flipping expectations are listed under Entry 2 and named as behaviour changes.
- **M2:** `incompatible_version` reworded to blame neither side.
- **M3:** `:227` and the oversize sites take `too-large`; `:290` takes `unexpected` (old
  `other-files`, reworded to "files or data it does not expect"); an `ENOSPC` copy answers
  `storage.disk_full`, the approved full-disk words.
- **M4:** both Spanish sentences corrected.
- **M5:** the fiscal-code sentence now names Task 9's edits; the rename is Owner question 5.
- **M6:** Task 11 leaves the till, `conventions-ui.md` and `CLAUDE.md` until the owner answers.
- **M7:** `schemaVersionsByModule` reads the applied version (`backup-manifest.ts:19-31`);
  `setup-app-wipe.test.ts:294-304` pins the not-offered path; the page's own `setup.not_ready` is
  unreachable on this path and gets no new words.
- **M9:** Task 2 asserts `params` explicitly per site, including `:84`, `:250`, `:275`, `:295`.
- **After bd8a22a445:** a module missing from the export answers the module-mismatch refusal, not
  `setup.configuration_outdated`; the export lists only switched-on modules, so "export it again"
  was false there (Entry 2, Task 6).
