# A1308 fiscal 11: the dead `WAITRON_FISCAL_*` environment variables go — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First prove, by running production's own setup and restore paths, that nothing in
production reads the eight `WAITRON_FISCAL_*` names (environment.md E4); then remove them: the
historical protocol's test-only dispatcher takes a typed options object instead of an environment, and
the historical first-setup contribution's `configure`, which production already replaces, moves out
of the contribution into a function the historical tests call with those options.
No product behaviour changes.

**Architecture:** The names are read in three files: `allocation-configuration.ts` (a dispatcher whose
header says "Historical protocol tests retain this dispatcher; production composition uses
hour-configuration", imported only by tests: `git grep -l allocation-configuration -- apps packages scripts`
lists 14 test files at `9c66ef0356`, 13 after fi8 deletes `declared-paper-standby.test.ts`),
`initial-setup.ts:368-385` (the historical `configure`) and `initial-cloud-setup.ts:183-200`
(`configuredCloudTrust`, called from those two). Production's contribution, `FISCAL_INITIAL_SETUP` in
`hour-configuration.ts:90-102` (wired at `provisioning.ts:11`), spreads the historical one and replaces
its `configure` with one that returns `createHourInitialSetup(host, historical)`, whose own
`configure` is `undefined` and whose `resolutionEvidence` is empty (`initial-hour-setup.ts:110-116`).
The historical `configure` is still reached by tests: `apps/server/test/historical-first-fiscal.ts`
swaps the historical contribution (exported under the same name, `FISCAL_INITIAL_SETUP`, from
`initial-setup.ts`) into the module list for `first-fiscal-cloud.route.test.ts`,
`first-fiscal-delivery.test.ts` and `first-fiscal-evidence.test.ts`. The names become fields of an
options object that tests pass directly.

**Tech stack:** TypeScript, Vitest.

**Spec:** [environment.md](../specs/2026-11-02-rationalisation/environment.md) §1 E4 (handed to the
fiscal area by [env8](2026-11-08-a1308-env8-fiscal-leftovers.md), which takes the two other fiscal-path
leftovers), the mapping rows
for the eight names and `WAITRON_RECOVERY_PUBLIC_DIR`/`WAITRON_RECOVERY_INCIDENT_DIR` (`:352-359`,
`:383-384`), §4 "Deleting the `WAITRON_FISCAL_*` readers deletes no data", §5 measure 4; README §7
("The dead `WAITRON_FISCAL_*` set goes (its own fiscal PR, after a run proves production ignores
it)"); rules [2026-11-08-a1308-slice-rules.md](2026-11-08-a1308-slice-rules.md).

**Base:** `main` after fi10. Line numbers read at `9c66ef0356`.

**Owner lands:** yes (environment.md: "Its own fiscal pull request, landed by the owner, after
measure 4").

**Pull request's first line:** "No venue reset: no migration changes." (Rules §2 asks for the reset
line only when a starting migration changes; this pull request changes none.)

## Global Constraints

- Rules §1–§9 apply.
- **Measurement first** (Task 1). Its failing result stops the pull request before any deletion.
- `WAITRON_FISCAL_TEST_SUBMISSIONS` stays (environment.md E1, `:136`); it is not one of the eight.
- No historical protocol test loses an assertion: each passes the same inputs as an options object.
- Historical runbooks are not rewritten (CLAUDE.md §6); each gets a dated pointer line.

## Review Focus

1. **The probe proves what it claims.** A run "with the variable set" proves nothing unless the
   variable reached the place that would read it, and the reader would have reacted. Task 1 checks
   three things: in each of the four runs, where the value got to (the process, and each module
   operation host the run builds); the historical reader refuses the same missing file; and, in a
   throwaway worktree with the old reader wired back into production's first setup, the same run
   changes.
2. **A ninth reader.** `git grep -n "WAITRON_FISCAL_" -- apps packages scripts deploy` on the branch
   prints only `WAITRON_FISCAL_TEST_SUBMISSIONS`.

---

## What it builds

- **The run** (Task 1), its result pasted into the pull request.
- `HistoricalAllocationPaths` in `allocation-configuration.ts`:

  ```ts
  export interface HistoricalAllocationPaths {
    custodianFile?: string;             // was WAITRON_FISCAL_CUSTODIAN_FILE
    custodianFingerprint?: string;      // WAITRON_FISCAL_CUSTODIAN_FINGERPRINT
    confirmationFile?: string;          // WAITRON_FISCAL_CONFIRMATION_FILE
    emergencyDirectory?: string;        // WAITRON_FISCAL_EMERGENCY_DIRECTORY
    paperHistoryFile?: string;          // WAITRON_FISCAL_PAPER_HISTORY_FILE
    cloudTrustFile?: string;            // WAITRON_FISCAL_CLOUD_TRUST_FILE
    cloudFingerprint?: string;          // WAITRON_FISCAL_CLOUD_FINGERPRINT
    cloudReceiptDirectory?: string;     // WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY
  }
  ```

  `configuredOperations(paths, host?)` and every function in the file that took
  `environment: Readonly<Record<string, string | undefined>>` take `paths` instead, reading the same
  values; an empty string is unset, as `isUnset` treats an environment value
  (`apps/server/src/env-value.ts`; CLAUDE.md §3 "An empty value is a valid value").
- `configuredCloudTrust(paths: Pick<HistoricalAllocationPaths, "cloudTrustFile" | "cloudFingerprint">)`
  (`initial-cloud-setup.ts:183`).
- `initial-setup.ts`: the historical contribution's `configure` (`:368-385`) leaves the contribution
  and becomes `export function configureHistoricalInitialSetup(host: ModuleOperationHost, paths: HistoricalAllocationPaths): InitialSetupContribution`,
  reading the six path fields where it read the environment. Production never called the old one
  (production's `configure` replaces it, above); `historicalFirstFiscalDocuments(modules, paths = {})`
  (`apps/server/test/historical-first-fiscal.ts`) sets `configure: (host) => configureHistoricalInitialSetup(host, paths)`
  on the contribution it swaps in, so its three callers keep their path.
- `apps/server/src/testing/allocation-input.ts` returns `HistoricalAllocationPaths` fields for the
  three fiscal names (its `WAITRON_RECOVERY_OPERATION_FILE` is a different, live name and stays);
  `apps/server/src/testing/stream-loop-scenario.ts:487-489` reads the fields.
- Docs: a dated pointer line under the header of `docs/developers/offline-fiscal-restore.md`,
  `emergency-recovery.md` and `paper-custodian.md` (each already marked "Historical protocol,
  superseded 2026-10-19"): "2026-11-xx (A1308 fiscal 11): the `WAITRON_FISCAL_*` and
  `WAITRON_RECOVERY_PUBLIC_DIR`/`_INCIDENT_DIR` variables below no longer exist; the historical
  protocol's tests pass these paths as options." If batch 3's list of environment variables has
  landed, the eight names leave it.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Deleting the historical protocol itself | Not planned: built, sound and tested (R5); environment.md removes only the readers |
| `WAITRON_FISCAL_TEST_SUBMISSIONS` | Stays (E1) |
| The other environment variables | Batch 3, the environment slices |

## Files

**Modify:** `packages/fiscal-verifactu/src/allocation-configuration.ts`, `initial-setup.ts:368-385`,
`initial-cloud-setup.ts:183-200`, `apps/server/test/historical-first-fiscal.ts`, the test files
importing `allocation-configuration` (`apps/server/scripts/restore-allocation.test.ts`,
`apps/server/src/boot.promote.test.ts`, `promote-endpoint-e2e.test.ts`,
`provision-allocation-input.test.ts`, `packages/composition/src/allocation-configuration.test.ts`, and
eight in `packages/fiscal-verifactu/src` once fi8 has deleted `declared-paper-standby.test.ts`),
`apps/server/src/testing/allocation-input.ts`, `stream-loop-scenario.ts`, `allocated-provision.ts`,
the three docs above, and the files below.

**Every file naming the names, and how it changes.** Search, run at `9c66ef0356`:

```bash
git grep -c "WAITRON_FISCAL_\(CUSTODIAN_FILE\|CUSTODIAN_FINGERPRINT\|CONFIRMATION_FILE\|EMERGENCY_DIRECTORY\|PAPER_HISTORY_FILE\|CLOUD_TRUST_FILE\|CLOUD_FINGERPRINT\|CLOUD_RECEIPT_DIRECTORY\)\|WAITRON_RECOVERY_PUBLIC_DIR\|WAITRON_RECOVERY_INCIDENT_DIR" -- apps packages scripts deploy
```

It prints 24 files. The three product files and `allocation-configuration.test.ts`,
`restore-allocation.test.ts`, `provision-allocation-input.test.ts`, `retired-fiscal-operation-entry.test.ts`,
`composition/src/allocation-configuration.test.ts`, `cloud-preparation.test.ts`,
`declared-paper-preparation.test.ts`, `emergency-attempts.test.ts`, `emergency-preparation.test.ts`,
`initial-cloud-setup.test.ts`, `initial-setup.test.ts` and the two testing helpers pass the same
values as `HistoricalAllocationPaths` (Task 2). `declared-paper-standby.test.ts` is gone with fi8. The
other seven, which the plan's first version missed, each feed the names to production to show they
are ignored; with no reader left, the feeding goes and the assertion stays:

| File | What it does with the names | After this plan |
| --- | --- | --- |
| `apps/server/src/boot.test.ts:1556-1558`, `:1744-1746`, `:1884-1886` | forwards `process.env`'s three values (stubbed by `initialSetupInput`, `testing/allocated-provision.ts:44-45`) into `startServer`'s environment | the nine lines go; `initialSetupInput` stops stubbing the three names (it still stubs `WAITRON_RECOVERY_OPERATION_FILE`) |
| `apps/server/src/first-fiscal-cloud.route.test.ts:47-55` | hands the three Cloud names to the historical contribution through the host's environment | passes them as `historicalFirstFiscalDocuments(ALL_MODULES, { cloudTrustFile, cloudFingerprint, cloudReceiptDirectory })` and an empty host environment |
| `apps/server/src/first-fiscal-launch.test.ts:36-42`, `:131-138`, `:283-288` | its module mock's `resolutionEvidence` reads two names from the host environment; the fixture writes evidence files to `process.env`'s paths and then stubs all three names as `"wrong-ambient-value"` | the mock reads the fixture's own two paths (the fixture chooses them in its temporary folder); the `"wrong-ambient-value"` stubs go. Its name's "despite conflicting process.env" half has nothing left to conflict with: "Assertions that change, by design" |
| `apps/server/src/hour-restore-retired-inputs.test.ts:84-86`, `:105`, `:192-193` | stubs the Cloud, confirmation and custodian names before restoring through the hour path | the stubs go; the retired files the test writes and the refusals it asserts stay |
| `apps/server/src/retired-first-setup-routes.test.ts:35-41` | gives production's module list a host environment holding the three Cloud names ("with a configured Cloud issuer") | an empty host environment; the refusal it asserts stays. The "configured Cloud issuer" condition no longer exists: "Assertions that change, by design" |
| `packages/fiscal-verifactu/src/hour-configuration.test.ts:106-118` | stubs four names, ambient and as the host's environment, to show production's hour preparation ignores them | both become `{}`; the refusal it asserts stays |
| `packages/provisioning/src/first-setup-runtime.test.ts:356` | a host environment holding `WAITRON_FISCAL_CONFIRMATION_FILE` to show no ambient fallback | `environment: {}`; the assertions stay |

## Assertions that change, by design

Design: environment.md §1 E4 and README §7 ("The dead `WAITRON_FISCAL_*` set goes").

| Test | What goes |
| --- | --- |
| `first-fiscal-launch.test.ts:159-161`, "%s launch binds its passed/file-merged module evidence and activates owned hour setup despite conflicting process.env" | the "despite conflicting process.env" condition (the stubs); the name drops those words. Every `expect` stays |
| `retired-first-setup-routes.test.ts:18-20`, "the owned HTTP setup route refuses retired %s selection with a configured Cloud issuer" | the "with a configured Cloud issuer" condition; the name drops those words. Every `expect` stays |

## Size

| Counted (hand-written) | Lines, estimated |
| --- | --- |
| Code: options type and reads 50, cloud trust 10, `configureHistoricalInitialSetup` 15 | ~75 |
| Tests: call sites passing options 120, the run's control case 30, `historical-first-fiscal.ts` 8, the seven files above 45 | ~205 |
| Docs: three pointer lines | ~6 |
| **Total** | **~285** |

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/allocation-configuration.test.ts src/initial-setup.test.ts src/initial-cloud-setup.test.ts src/cloud-preparation.test.ts src/declared-paper-preparation.test.ts src/emergency-attempts.test.ts src/emergency-preparation.test.ts src/declared-paper-consumers.test.ts src/hour-configuration.test.ts
pnpm --filter @waitron/composition exec vitest run src/allocation-configuration.test.ts
pnpm --filter @waitron/provisioning exec vitest run src/first-setup-runtime.test.ts
pnpm --filter @waitron/server exec vitest run scripts/restore-allocation.test.ts src/boot.promote.test.ts src/promote-endpoint-e2e.test.ts src/provision-allocation-input.test.ts src/retired-fiscal-operation-entry.test.ts src/first-fiscal-setup.e2e.test.ts src/restore-fiscal-e2e.test.ts src/boot.test.ts src/first-fiscal-cloud.route.test.ts src/first-fiscal-delivery.test.ts src/first-fiscal-evidence.test.ts src/first-fiscal-launch.test.ts src/hour-restore-retired-inputs.test.ts src/retired-first-setup-routes.test.ts
pnpm exec vitest run scripts/deploy-image-env.test.ts
git grep -n "WAITRON_FISCAL_\|WAITRON_RECOVERY_PUBLIC_DIR\|WAITRON_RECOVERY_INCIDENT_DIR" -- apps packages scripts deploy ':!docs/**' | grep -v WAITRON_FISCAL_TEST_SUBMISSIONS
```

The grep prints nothing.

## Expected protection-list difference

None: no schema changes. `pnpm protection-list compare` against the base prints `EQUAL`.

## Stop points (beyond rules §5)

1. **The run shows production reads a name** (environment.md §5 measure 4, rules §5.4): first setup
   or restore behaves differently with the variables set. Then the deletion needs a replacement path
   first; nothing is deleted, and the watcher takes it to the owner.
2. The probe shows the variables never reached the process in one of the four runs, or the
   first-setup host's environment in the first-setup run, or the throwaway control (Task 1 Step 3)
   shows no change with the old reader wired back in: the run proved nothing. Fix the probe, not the
   conclusion.
3. A historical protocol test can only pass with a changed assertion.

## Needs

fi10 (order only; no dependency in code).

**Landed by: owner.**

---

### Task 1: the run (environment.md §5 measure 4)

The failing case would print a changed result with the variables set; the probe and the control make
sure a passing result is not the same output for the wrong reason.

- [ ] **Step 1: The control.** In `allocation-configuration.test.ts`, add (it stays):
  "the historical dispatcher refuses a custodian file that does not exist": with
  `WAITRON_FISCAL_CUSTODIAN_FILE: "/nonexistent/custodian.json"` (still the environment form at this
  step), preparing a setup operation throws the refusal the file reader gives today (read it from
  `allocation-paper-source.ts`; assert its error code). Run it: PASS. This is the reader reacting.
- [ ] **Step 2: The probe** (in a throwaway worktree of the base, `git worktree add --detach`, never
  committed): add one log line at each place a module operation host is built, printing the site and
  whether `WAITRON_FISCAL_CUSTODIAN_FILE` is set in that host's environment and in `process.env`:
  `apps/server/src/boot.ts:1098-1101` (the first-setup host, `environment: env`), `:2734` (the trading
  host), `first-setup-entry.ts:214` and `:250`, `node-operation-preparation.ts:143`, and
  `recovery-preparation.ts:235` (`createModuleOperationHost({}, …)`, an empty environment). Run each of
  Step 4's four files with `WAITRON_FISCAL_CUSTODIAN_FILE=/nonexistent/custodian.json` and read the
  lines (unset `AI_AGENT` and `CLAUDECODE` first: under an agent Vitest hides a passing test's console
  output, CLAUDE.md §4). **Passing:** every run prints the value as set in `process.env` at least
  once, and the first-setup run prints it set in the first-setup host. A host built from `{}` printing
  "unset" is not a failure: it is a second reason a restore cannot read the names, and the pull
  request quotes the line. **Failing** (stop 2): a run never prints a line (it built no host, so it
  measures nothing), or never sees the value in `process.env`.
- [ ] **Step 3: The control that the run can see a reader** (same throwaway worktree): wire the old
  reader back into production's first setup. In `initial-hour-setup.ts:116`, make
  `resolutionEvidence` return the files and directories the historical `configure` lists
  (`initial-setup.ts:369-384`: the four file names and two directory names, read from
  `host.environment`). Run `src/first-fiscal-setup.e2e.test.ts` plain and with the eight names set
  as in Step 4. **Passing:** the two runs differ (a failure naming a missing evidence file, or a
  different `Tests` count); this is what Step 4 would print if production read a name. **Failing**
  (stop 2): they are the same. The restore and hour-recovery runs get no such control: their host is
  built from `{}` (`recovery-preparation.ts:235`), so a reader wired into it could not see the names
  either, and Step 2's `process.env` line is their check. Remove the throwaway worktree after
  (`git worktree remove`).
- [ ] **Step 4: The runs.** On the branch base, run twice, recording the `Tests` count and every
  failure: once plain, once with all eight names set to missing paths
  (`WAITRON_FISCAL_CUSTODIAN_FILE=/nonexistent/custodian.json`, `…_CONFIRMATION_FILE=/nonexistent/c.json`,
  `…_CUSTODIAN_FINGERPRINT=$(printf 'a%.0s' {1..64})`, `…_EMERGENCY_DIRECTORY=/nonexistent/e`,
  `…_PAPER_HISTORY_FILE=/nonexistent/h.json`, `…_CLOUD_TRUST_FILE=/nonexistent/t.json`,
  `…_CLOUD_FINGERPRINT=$(printf 'b%.0s' {1..64})`, `…_CLOUD_RECEIPT_DIRECTORY=/nonexistent/r`):
  `pnpm --filter @waitron/server exec vitest run src/first-fiscal-setup.e2e.test.ts src/first-fiscal-hour-import.e2e.test.ts src/restore-fiscal-e2e.test.ts src/hour-recovery-host.test.ts`.
  **Passing:** both runs pass with the same counts. **Failing:** any difference (stop 1).
- [ ] **Step 5:** Paste Steps 1–4's commands and outputs into the pull request.

### Task 2: options instead of the environment

- [ ] **Step 1:** Change the control and every test call site to pass `HistoricalAllocationPaths`
  (field per the table above). Run them: FAIL (the functions still take an environment).
- [ ] **Step 2:** Implement the options type and reads; move `initial-setup.ts`'s `configure` into
  `configureHistoricalInitialSetup`; change `configuredCloudTrust` and
  `historicalFirstFiscalDocuments`. Update the testing helpers and the seven files in Files.
- [ ] **Step 3:** Run the Finish line. PASS. Commit: "The historical fiscal protocol takes its paths
  as options, not environment variables (A1308 fiscal 11)".

### Task 3: documents, finish

- [ ] **Step 1:** The three pointer lines. In `docs/backlog/fiscal.md`, "Retire the historical
  allocation formats from `fiscal-verifactu`" (`:1371` at `9c66ef0356`, the entry environment.md
  E4 cites) names the three Cloud variables as read by these files: delete that sentence (they are
  options now); the rest of the entry, retiring the formats themselves, stays open.
- [ ] **Step 2:** Protection list: `EQUAL`.
- [ ] **Step 3:** Commit; `/finish-branch` (light path would apply, but it is fiscal code the owner
  lands: run the full wave).
