# A1189: remove the Waitron side of Cloud's fiscal allocation registry — implementation plan

**Status:** plan, written 2026-10-29. Nothing below has been implemented.

**Owner's words (2026-10-29):** "We no longer have the reservations because we use the time-based
codes instead" — "the registry can be removed."

**Worktree:** `/Users/clintongormley/workspace/worktrees/waitron-refactor-a1189-remove-fiscal-allocation-registry`,
branch `refactor/a1189-remove-fiscal-allocation-registry`, based on `b39e13526`.

**How it runs:** inline, by the lead session, task by task. The branch touches first-fiscal-setup
documentation and a recovery test file, so `/finish-branch` runs the FULL wave (both Codex run-it
reviews) and the pull request waits for the OWNER to land it.

**Cloud's half** has its own design
(`waitron-io/waitron-cloud`, `docs/superpowers/specs/2026-10-29-remove-fiscal-registry-design.md`,
read through `gh api` on 2026-10-29). It removes the account routes, the portal journey and the
`fiscal-allocation` package, keeps migration 038 byte-for-byte, and must not land before this
Waitron change has landed.

## What the registry was, on Waitron's side

Cloud's registry handed out installation names in advance ("reservations") and signed a receipt
when one was used up. Waitron had two pieces that dealt with it:

1. **The server's client and report adapter** — `apps/server/src/cloud-fiscal-allocation-client.ts`
   (an HTTP client for Cloud's `/api/account/fiscal-allocations/status` and
   `/api/installations/fiscal-allocations/report`) and `apps/server/src/cloud-fiscal-allocation.ts`
   (signs a report and keeps a file journal of what was sent). Added by #1725 (`8c2351f74`).
2. **The fiscal package's reader for Cloud's signed receipts** — `packages/fiscal-verifactu/src/cloud-evidence.ts`,
   `cloud-preparation.ts`, `initial-cloud-setup.ts`, the fixtures `test/cloud-fixture.ts` and
   `test/cloud-allocation-receipt.json`, and Cloud branches inside shared files. Since A679
   (#1752) these are "historical": production composition uses `hour-configuration.ts`, which never
   dispatches to them (`packages/fiscal-verifactu/src/allocation-configuration.ts:1`, "Historical
   protocol tests retain this dispatcher; production composition uses hour-configuration").

## What goes and what stays

**Goes (this plan):** piece 1 in full, its two test files, its three entries in the server's shard
timing table, the developer guide `docs/developers/cloud-fiscal-allocation.md`, and every live
document sentence that describes piece 1 as current or pending work.

**Nothing in piece 1 runs today.** Receipts, both run on `b39e13526`:

- `git grep -n "cloud-fiscal-allocation\|reconcileCloudFiscalAllocation\|signCloudFiscalReport\|createCloudFiscalAllocationClient\|FiscalAllocationTransport\|FiscalAllocationReport" -- . ':!docs'`
  lists only the two modules, `cloud-fiscal-allocation-client.test.ts`,
  `cloud-fiscal-reconciliation.test.ts` and `apps/server/test-durations.json:267-269`.
- `git log -S"cloud-fiscal-allocation" --oneline -- apps/server/src/boot.ts apps/server/src/node-entry.ts apps/server/src/bin.ts`
  prints nothing: no start path ever imported them.

So no route, start step, setting, screen, guide page, alert or log event disappears, and no
first-fiscal-setup, recovery or reconciliation flow changes. The error codes the two modules
throw (`cloud.request_invalid`, `cloud.unavailable`, `cloud.busy`, `cloud.state_invalid`,
`cloud.binding_conflict`, `cloud.not_configured`) are all still thrown elsewhere — for example
`apps/server/src/cloud-client.ts:315` (`cloud.busy`), `:352` (`cloud.binding_conflict`), `:218`
(`cloud.state_invalid`), `:367` (`cloud.not_configured`) and `apps/server/src/cloud-api.ts:107`
(`cloud.request_invalid`) — so `scripts/errors-reachable.test.ts` stays green and
`apps/server/src/errors.ts:70-77` is untouched. `loadCloudOrigin` stays: `apps/server/src/boot.ts:935`
uses it.

**Stays, unchanged:**

- **Piece 2, the fiscal package's historical Cloud-receipt reader.** Removing it is not possible
  without changing the fiscal core, so it is owner question 1, not part of this plan:
  - `validateAllocationEnvelope` has a Cloud branch (`packages/fiscal-verifactu/src/allocation-envelope.ts:495-505`,
    importing `cloud-evidence.ts` at `:25`). That function is the activation check:
    `activateAllocation` calls it at `packages/fiscal-verifactu/src/allocation.ts:84`, and the live
    minute-code path reaches it through `hour-preparation.ts:11` → `createAllocationPreparation`.
  - The live first-setup "start again" floor accepts a `cloud-initial-confirmation` as evidence
    that names no minute (`packages/fiscal-verifactu/src/initial-hour-setup.ts:17,130-132`).
  - Production `FISCAL_INITIAL_SETUP` spreads the historical contribution
    (`packages/fiscal-verifactu/src/hour-configuration.ts:9,81,92`), whose `committed`,
    `assignmentKeys` and `readInput` carry Cloud branches (`initial-setup.ts:153,279,400,471,604`).
  - Tests whose remaining assertions would change: `packages/fiscal-verifactu/src/hour-configuration.test.ts`
    (uses `createCloudAllocationFilePreparation`), `apps/server/src/retired-first-setup-routes.test.ts`
    (refuses retired Cloud selection "with a configured Cloud issuer"),
    `packages/fiscal-verifactu/src/backup-verification-history.test.ts` (reads `ReceiptTrust`).
- **The fiscal package's own allocation records.** The table `fiscal_allocations`
  (`packages/fiscal-verifactu/src/schema/allocations.ts:16`) and the type `FiscalAllocation` are
  the box's local record of an activated installation name, read on the live path
  (`hour-history-reader.ts:230-244`, `hour-recovery-state.ts:80`, `restore-committed.ts:15`). The
  local table `fiscal_reservations` (`schema/reservations.ts:5`) is the dormant-standby record,
  also read on the live path (`hour-history-reader.ts`, `allocation.ts:96-101`). Neither is
  Cloud's registry.
- **The database.** Piece 1 kept its state in a file journal (`cloud-fiscal-allocation.ts:136-163`),
  never in a table. No migration is needed and none is written; no shipped migration is touched.
- **The fiscal core:** `computeHuella`, the chain, invoice-number allocation,
  `registros_facturacion`, `recordSale`/`recordCorrection`/`recordSubstitution`, `registerSif`,
  `restoreFiscal`, activation. Nothing under `packages/fiscal-verifactu/` or `packages/core/`
  changes. `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `inmutabilidad.test.ts`
  must pass unedited.
- **`apps/server/src/cloud-fiscal-allocation.test.ts`'s cases.** Despite its name, this file never
  imports either module (its imports are lines 1-27). Its cases test the live minute-code restore:
  a wrong node key is refused even with a valid Cloud receipt, a sale after recovery makes no
  network call ("completes a real sale after current-hour recovery without calling fetch…"),
  the spent minute is refused, an interrupted restore replays, and offline restore contacts no
  outside allocator ("restores offline through current hour authority…", `fetch` called 0 times).
  The file is RENAMED, byte for byte, to `apps/server/src/hour-restore-retired-inputs.test.ts` so
  the `cloud-fiscal-allocation*` name goes with the modules. No line inside it changes.

## The `git grep -l -i "fiscal-allocation\|fiscalAllocation\|FiscalAllocation\|allocation registry"` list, classified

114 files on `b39e13526`: 91 outside `docs/`, 23 in `docs/`.

**Piece 1, removed (5):** `apps/server/src/cloud-fiscal-allocation.ts`,
`cloud-fiscal-allocation-client.ts`, `cloud-fiscal-allocation-client.test.ts`,
`cloud-fiscal-reconciliation.test.ts`, three keys in `apps/server/test-durations.json:267-269`.

**Renamed, contents unchanged (1):** `apps/server/src/cloud-fiscal-allocation.test.ts` (matches
only through `fiscalAllocations`, the local table, at `:19,298`).

**Piece 2, historical Cloud-receipt reader, stays (12):** `apps/server/src/first-fiscal-cloud.route.test.ts`
(matches the receipt signing domain `waitron.fiscal-allocation-receipt` at `:119`);
`packages/fiscal-verifactu/src/` `allocation-envelope.ts`, `backup-verification-history.test.ts`,
`cloud-evidence.ts`, `cloud-evidence.test.ts`, `cloud-preparation.ts`, `cloud-preparation.test.ts`,
`index.ts` (exports both kinds), `initial-cloud-setup.test.ts`, `initial-setup.ts`;
`packages/fiscal-verifactu/test/cloud-allocation-receipt.json`, `test/cloud-fixture.ts`.
Piece 2 also reaches files the grep does not list: `allocation-configuration.ts`,
`backup-verification-trust.ts`, `initial-hour-setup.ts`, `hour-configuration.test.ts`,
`apps/server/src/retired-first-setup-routes.test.ts`.

**The fiscal package's own allocation concept, stays (73).** Every match is the `fiscal_allocations`
table, the `FiscalAllocation`/`fiscalAllocations` identifiers, or the historical dispatcher:

- `apps/server` (28): `scripts/restore-allocation.test.ts`; `src/allocated-standby-host.test.ts`,
  `first-fiscal-declared-publication.test.ts`, `first-fiscal-hour-finish.test.ts`,
  `first-fiscal-hour-readiness.test.ts`, `first-fiscal-interruption.test.ts`,
  `first-fiscal-launch.test.ts`, `first-setup-finish.route.test.ts`,
  `first-setup-recovery-delivery.test.ts`, `fiscal-readiness-allocation.test.ts`,
  `hour-promotion.test.ts`, `hour-recovery-host.test.ts`, `hour-recovery-placement-1/2/3.test.ts`,
  `mirror-bundle-api.test.ts`, `provision-allocation-input.test.ts`,
  `recovery-collection.fiscal.test.ts`, `recovery-module-operation.fiscal.test.ts`,
  `recovery-paper-source.fiscal.test.ts`, `reserved-identity.test.ts`,
  `restore-emergency-crash.e2e.test.ts`, `restore-fiscal-e2e.test.ts`,
  `retired-fiscal-operation-entry.test.ts`, `standby-public-operation.fiscal.test.ts`;
  `src/testing/backup-verification-fixture.ts`, `staged-hour-crash.ts`, `staged-hour-restore.ts`.
- `packages/composition/src/allocation-configuration.test.ts` and
  `packages/provisioning/src/venue-operation-preparation.fiscal.test.ts`, `venue-operation.fiscal.test.ts` (3).
- `packages/fiscal-verifactu` (42): `allocated-lifecycle`, `allocated-standby`,
  `allocation-collection`, `allocation-operation`, `allocation-paper-source`,
  `allocation-preparation`, `allocation`, `backup-verification`, `completed-recovery-document`,
  `declared-paper-consumers`, `declared-paper-preparation`, `declared-paper-standby`,
  `default-lifecycle`, `dormant-takeover`, `emergency-attempts`, `emergency-preparation`,
  `hour-activation`, `hour-dormant-standby`, `hour-history-reader`, `hour-preparation`,
  `hour-recovery-preparation`, `hour-recovery-state`, `hour-setup-defaults`,
  `hour-standby-activation`, `hour-surviving-history`, `hour-throwaway-allocation`, `index`,
  `initial-setup`, `provisioning`, `restore-committed`, `standby-allocation` (`.test.ts` files);
  sources `allocation-operation.ts`, `allocation.ts`, `declared-paper-evidence.ts`,
  `emergency-preparation.ts`, `hour-history-reader.ts`, `hour-recovery-state.ts`,
  `restore-committed.ts`, `schema/allocations.ts`, `schema/index.ts`, `standby-allocation.ts`;
  `test/later-installation.ts`.

**Docs (23):** changed in Task 2 — `docs/developers/cloud-fiscal-allocation.md` (deleted),
`docs/developers/paper-custodian.md`, `docs/backlog.md`, `docs/backlog/fiscal.md`,
`docs/backlog/self-service-refusals.md`, and a one-line pointer in the registry plan. Unchanged —
`docs/backlog/ci.md:361` (names `scripts/fiscal-allocation-migration.test.ts`, the local table's
upgrade guard); `docs/operations/a1154-changed-checks.md`, `a679-changed-checks.md`,
`a679-development-checkpoints.md`, `a760-migration-squash-inventory.md`,
`planning-procedure-audit.md` (dated receipts); and the other eleven plans and specs under
`docs/superpowers/` (historical records).

**Guards and lists.** No guard under `scripts/`, no workflow under `.github/`, no ESLint zone, no
Vitest config and no Stryker config names piece 1 (`git grep -n -i "cloud-fiscal\|fiscal-allocation\|fiscalAllocation" -- scripts .github eslint.config.js 'apps/server/vitest*.ts' package.json apps/server/package.json`
returned only the file name `scripts/fiscal-allocation-migration.test.ts`, which is about the local
table). The only list that names it is `apps/server/test-durations.json`.
`scripts/vitest-duration-sequencer.test.mjs:224-241` checks that every server test file is packed
into exactly one shard; a stale key does not fail it, but the keys are removed or renamed anyway.

## Live documents that describe piece 1 as current

- `docs/developers/cloud-fiscal-allocation.md` — the whole guide (its "Report later" section and
  its qualification command name the two modules). Deleted, as the backlog entry says. Its first
  sections describe piece 2's environment settings, already labelled historical by its own banner.
  Inbound links: `docs/developers/paper-custodian.md:435`, `docs/backlog/fiscal.md:419,427`.
- `docs/developers/paper-custodian.md:434-435` — the one sentence pointing a Cloud packet to that
  guide. Nothing else in the file exists only for the registry: `:523` ("Bucket and Cloud
  restores") is Cloud backup restore, which stays.
- `docs/backlog.md:381-383` — "Cloud fiscal reporting has no running host caller yet", and its
  detail `docs/backlog/fiscal.md:1074-1080`.
- `docs/backlog/fiscal.md:416-428` — the W41s paragraph's "Cloud allocation production
  enablement…" sentences and the "2026-10-15 implementation boundary" paragraph (report APIs).
- `docs/backlog/self-service-refusals.md:660` — the `cloud.busy` row's last two sentences, which
  cite `cloud-fiscal-allocation.ts:197`.
- `docs/backlog.md:179-191` — A1189 itself.

Checked and left alone because they stay true while piece 2 stays:
`docs/operations/hour-recovery.md:121` and `docs/developers/conventions-data.md:3787` ("Cloud
allocation receipts … are historical formats"). Neither `CLAUDE.md`, `README.md`, nor any guide
under `apps/server/src/guide/` mentions the registry. The legal track still proposes a Cloud
registry (`docs/compliance/asesor-questions.md:83,1214-1220`, `docs/compliance/action-plan.md:8`);
that is owner question 2, and this plan does not touch it.

## Owner questions

1. **The fiscal package's historical Cloud-receipt reader (piece 2).** It cannot be removed without
   changing the activation check (`allocation-envelope.ts:495-505`, reached from
   `allocation.ts:84` on the live minute-code path), what the start-again floor accepts
   (`initial-hour-setup.ts:130-132`), and three tests' remaining assertions. Under this item's
   rules that is a STOP, so this plan leaves it exactly as it is — matching A679's earlier choice to
   "retain historical source only where required for unchanged tests"
   (`docs/superpowers/plans/2026-10-16-a679-hour-code-implementation.md:353`). Task 2 adds a short
   backlog entry for retiring it, together with the other historical formats (signed paper,
   emergency names), as its own owner-landed fiscal change. Do you want that entry, or should the
   historical reader stay indefinitely?
2. **The adviser questions.** Q5(f) in `docs/compliance/asesor-questions.md:1214-1220` and
   `docs/compliance/action-plan.md:8` still propose "a cloud registry for customers who subscribe".
   No enquiry has been sent. Should a dated one-line pointer go under Q5(f) saying the registry
   was dropped on 2026-10-29? Default if unanswered: leave the legal track alone.

No schema question arises: Waitron has no registry tables (see "Stays").

## Task 0: start the ledger

- [ ] Create `docs/handoffs/2026-10-29-a1189-remove-fiscal-allocation-registry.md` (the folder is
  gitignored, CLAUDE.md §6) with `Status: in progress`, the worktree and branch, and "next: Task 1".
  Update it at the end of every task.

## Task 1: delete the server's registry client and adapter

**Files:** delete `apps/server/src/cloud-fiscal-allocation.ts`,
`apps/server/src/cloud-fiscal-allocation-client.ts`,
`apps/server/src/cloud-fiscal-allocation-client.test.ts`,
`apps/server/src/cloud-fiscal-reconciliation.test.ts`; rename
`apps/server/src/cloud-fiscal-allocation.test.ts` → `apps/server/src/hour-restore-retired-inputs.test.ts`;
edit `apps/server/test-durations.json`.

**Why no new failing test.** No production path calls these modules (receipts above), so any
behaviour test would print the same before and after the deletion — CLAUDE.md §1 calls that a
measurement that measures nothing. The proof is instead: the type checker names every importer,
and the live behaviour around the old call sites keeps passing unedited.

- [ ] Baseline. Run
  `pnpm --filter @waitron/server exec vitest run src/cloud-fiscal-allocation.test.ts` and write
  the `Tests` count into the ledger (expected: every case passes; record the number, do not assume it).
- [ ] Record the consumer list:
  `git grep -n "cloud-fiscal-allocation\|reconcileCloudFiscalAllocation\|signCloudFiscalReport\|createCloudFiscalAllocationClient\|FiscalAllocationTransport\|FiscalAllocationReport" -- . ':!docs' ':!*.md'`.
  Expected: only the four files above and `apps/server/test-durations.json`.
- [ ] Control (RED). `git rm apps/server/src/cloud-fiscal-allocation.ts apps/server/src/cloud-fiscal-allocation-client.ts`,
  then `pnpm --filter @waitron/server typecheck`. Expected: it FAILS, and every error is in
  `cloud-fiscal-allocation-client.test.ts` or `cloud-fiscal-reconciliation.test.ts` (the server's
  `tsconfig.json` includes `src`, `test` and `scripts`). An error in any other file means a caller
  this plan missed: stop and re-plan.
- [ ] `git rm apps/server/src/cloud-fiscal-allocation-client.test.ts apps/server/src/cloud-fiscal-reconciliation.test.ts`.
  These test only the removed modules (every case calls `createCloudFiscalAllocationClient`,
  `signCloudFiscalReport` or `reconcileCloudFiscalAllocation`).
- [ ] `git mv apps/server/src/cloud-fiscal-allocation.test.ts apps/server/src/hour-restore-retired-inputs.test.ts`.
  Do not change a byte inside it.
- [ ] In `apps/server/test-durations.json` delete the keys `"src/cloud-fiscal-allocation-client.test.ts"`
  and `"src/cloud-fiscal-reconciliation.test.ts"`, and move `"src/cloud-fiscal-allocation.test.ts": 29.4`
  to `"src/hour-restore-retired-inputs.test.ts": 29.4` in sorted position (after the
  `"src/hour-recovery…"` keys), keeping the file valid JSON.
- [ ] GREEN. Run, checking each exit status separately:
  - `pnpm --filter @waitron/server typecheck` — passes.
  - `pnpm --filter @waitron/server exec vitest run src/hour-restore-retired-inputs.test.ts` — the
    same `Tests` count as the baseline, all passing.
  - `pnpm --filter @waitron/server exec vitest run src/first-fiscal-cloud.route.test.ts src/retired-first-setup-routes.test.ts src/cloud-client.test.ts src/cloud-api.test.ts`
    — piece 2's server-side cases and the shared Cloud client still pass unedited.
  - From the repository root: `pnpm exec vitest run scripts/vitest-duration-sequencer.test.mjs scripts/errors-reachable.test.ts`
    — passes (read the `Tests` count).
  - `git diff -M --stat HEAD` shows the rename at 100% similarity.
  - The consumer grep from step 2 now prints nothing.
- [ ] `pnpm --filter @waitron/server exec eslint src/hour-restore-retired-inputs.test.ts` and
  `pnpm exec prettier --check apps/server/test-durations.json`.
- [ ] Commit with `git commit -s`. Message, plain English, for example: "Remove the server's
  unused client and report journal for Cloud's fiscal allocation registry (A1189)". Body: the
  owner's words; that no start path ever imported the modules (the `git log -S` command, verbatim);
  that the restore test file was renamed without changes because its cases test the live
  minute-code restore.

## Task 2: retire the documents that describe the registry as live

**Files:** `docs/developers/cloud-fiscal-allocation.md` (delete),
`docs/developers/paper-custodian.md`, `docs/backlog.md`, `docs/backlog/fiscal.md`,
`docs/backlog/self-service-refusals.md`,
`docs/superpowers/plans/2026-10-12-cloud-fiscal-allocation-registry.md` (one line).

Prefer deleting to rewording (CLAUDE.md §1); every new sentence is a claim and needs its receipt.

- [ ] `git rm docs/developers/cloud-fiscal-allocation.md`.
- [ ] `docs/developers/paper-custodian.md:434-435`: delete the sentence "For a consumed Cloud
  packet, use the separately configured [Cloud allocation adapter](cloud-fiscal-allocation.md);
  the paper command above does not assemble it." Nothing else in the file changes.
- [ ] `docs/backlog.md:381-383`: delete the entry "Cloud fiscal reporting has no running host
  caller yet." `docs/backlog/fiscal.md:1074-1080`: delete its detail section. Check nothing else
  links the anchor: `git grep -n "cloud-fiscal-reporting-has-no-running-host-caller-yet"` prints nothing afterwards.
- [ ] `docs/backlog/fiscal.md:416-428`: delete from "Cloud allocation production enablement" to
  "Paper allocation does not require a subscription." and the whole "**2026-10-15 implementation
  boundary:**" paragraph. In their place add one line:
  "**2026-10-29 (owner):** the Cloud allocation registry is dropped — "We no longer have the
  reservations because we use the time-based codes instead." Waitron's client and report journal
  were removed by A1189." Keep the rest of the W41s paragraph.
- [ ] `docs/backlog/self-service-refusals.md:660`: in the `cloud.busy` row's last cell delete
  "The durable lock in `cloud-fiscal-allocation.ts:197` has no caller established by this audit;
  do not turn that isolated function into a user-visible defect by assumption." Keep "Temporary
  local concurrency on these callers."
- [ ] `docs/backlog.md:179-191`: replace A1189 with what is left open:
  - "**A1189 (Cloud half). Cloud's registry removal can land now that Waitron's has.** Waitron
    no longer has a client for it. Cloud's own [removal design](…same link…) keeps migration 038
    and its stored records pending a separate owner decision."
  - If the owner answers question 1 "yes" (or has not answered): a new short entry, area fiscal,
    "**Retire the historical allocation formats from `fiscal-verifactu`.** Signed paper, Cloud
    receipts and emergency names are still read by historical code: the activation check
    (`allocation-envelope.ts`), the start-again floor (`initial-hour-setup.ts`) and the historical
    setup contribution (`initial-setup.ts`). Removing them changes activation and three tests'
    assertions, so it is its own fiscal change for the owner to land. Left by A1189."
- [ ] `docs/superpowers/plans/2026-10-12-cloud-fiscal-allocation-registry.md:298`: append to the
  existing 2026-10-29 note: " Waitron's client and report journal were removed by A1189." Nothing
  else in that historical plan changes.
- [ ] Check links: `git grep -n "cloud-fiscal-allocation\.md\|cloud-fiscal-allocation\.ts\|cloud-fiscal-allocation-client\|cloud-fiscal-reconciliation" -- docs ':!docs/superpowers' ':!docs/operations'`
  prints nothing. Matches under `docs/superpowers/` and `docs/operations/` are dated history and stay.
- [ ] `docs/` is ignored by prettier (`pnpm exec prettier --file-info docs/backlog.md` prints
  `"ignored": true`), so no format check applies there.
- [ ] Commit with `git commit -s`, plain English: "Retire the documents that describe Cloud's
  fiscal allocation registry as live (A1189)".

## Task 3: final checks, then finish the branch

- [ ] The fiscal package and core are untouched:
  `git diff --stat origin/main... -- packages/` prints nothing.
- [ ] The fiscal-core identifiers appear in no changed line:
  `git diff -M origin/main... -- . ':!docs' ':!*.md' | /usr/bin/grep -E '^[+-].*(registerSif|restoreFiscal|activate\(|computeHuella|registros_facturacion|recordSale)'`
  prints nothing. (The renamed test file contains `recordSale` at its line 13 and 311; with rename
  detection on, a 100% rename contributes no `+`/`-` lines. If the command prints those lines,
  rename detection is off: rerun with `-M` explicitly and confirm the similarity is 100%.)
- [ ] The two fiscal gate suites pass unedited:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  (read the `Tests` count), and `git diff --stat origin/main... -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`
  prints nothing.
- [ ] No test file other than the four deleted ones and the one rename changed:
  `git diff -M --name-status origin/main... -- '*.test.ts' '*.test.mjs'` lists exactly two `D`
  lines and one `R100` line.
- [ ] Coverage: `apps/server` loses about 370 lines of tested source. Coverage is CI's job
  (CLAUDE.md §2); after the push, read the `apps/server` coverage merge job on the current head.
  Run `pnpm --filter @waitron/server test:coverage` locally only if that job fails.
- [ ] Update the ledger to "Tasks 1-3 done; next: `/finish-branch`".
- [ ] Tell the owner the branch is ready for `finish-branch`, then run
  `/finish-branch /Users/clintongormley/workspace/worktrees/waitron-refactor-a1189-remove-fiscal-allocation-registry`
  with the note "A1189; plan docs/superpowers/plans/2026-10-29-a1189-remove-fiscal-allocation-registry.md;
  touches first fiscal setup documentation and a fiscal restore test file — full wave, the owner
  lands the PR". The pull request description states the owner questions above and that no
  migration and no fiscal-package file changed.
- [ ] After the PR exists, set the ledger to `Status: done` only once the owner has landed it.
