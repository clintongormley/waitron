# A1297 — every server CI shard back under about 4½ minutes: plan

Status: plan. Item: lane B queue A1297 (backlog entry A1252's follow-up,
[ci.md](../../backlog/ci.md#a1252-remaining-server-job-time-after-the-held-setup-split)).
Branch `perf/a1297-server-shard-time`.

**Goal.** Every ordinary `test-server (N)` job on a full main run finishes in 270 seconds or less,
whole job. No assertion, deadline or check is removed or weakened. CLAUDE.md §2: "Fix the cause,
never cut a check."

## What was measured (2026-11-02)

- Main runs 41523865502, 41510401054, 41502939001, 41492998599: slowest server jobs 311–324 s. The
  runners come in two speeds; the slower group takes about 1.5× as long per file. Outside the test
  step a job spends 39 s at the median (Chromium install 9, Node 8, install 4, checkout 3, pnpm 2,
  upload 2). The test step is about the sum of its files' times divided by 4 workers, plus 10 s.
- So the slowest job needs 41–54 s off. Modelled on the slower runners with the real packing
  function: a refreshed duration table alone brings the slowest test step from 271 s to about 260 s.
- Local profiling of 64 of the slowest files (the `first-setup-*` family, `setup-first-backup-api*`,
  `hour-recovery-placement-*` and others; 1,194 tests, 3,458 s locally):
  - 23% of their time is waiting on the recovery-key check: `operation-authentication.ts:64` calls
    `verifySecretAsync` (`packages/identity/src/secret-hash.ts:50`), a real 20–25 ms key derivation,
    about 50 times per test, always the same password against the same stored hash. 764 of the
    805 s is in files that load `apps/server/test/hour-recovery-host.ts`. A file-scoped memo cut
    `first-setup-backup-reopen` from 97–99 s to 66 s and `setup-first-backup-api` from 86 s to 42 s,
    all 77 tests passing, two side-by-side repeats.
  - `heldSetup` (`apps/server/test/held-setup-database.ts:85-87`) migrates a fresh database in every
    test: about 850 ms against about 1 ms to copy a migrated template; 8 files, about 116 tests.
  - The backup files the test helpers build (`archiveHost`, the cloud fixture, `repairFixture`,
    `selectedRepair`, `heldSetup` at `held-setup-database.ts:258`) each draw a new random salt, so the
    existing derived-key cache always misses: 260 s of hardened key-derivation CPU locally.
  - No real sleeps: the suites already fake the clock past the hour wait.
- The headless shell is all the server's five Chromium suites launch (`headless: true`, no channel);
  installing only it (`playwright install chromium --only-shell`) skips the full-Chrome download,
  3–8 s per shard. Locally, all five suites pass with only the shell installed, and an empty browsers
  folder fails with "Executable doesn't exist … chromium_headless_shell-1248".

## Tasks

Each task is one implementer dispatch, test-first where it adds code, and ends with the focused
files it touched passing. Run focused files with
`pnpm --filter @waitron/server exec vitest run <file>`. Check free memory
(`memory_pressure | grep free`) before running several suites at once.

### Task 1 — Remember each recovery-key check within a test file

In `apps/server/test/hour-recovery-host.ts`, beside its existing `vi.mock` calls, mock
`verifySecretAsync` (find the exact module specifier `operation-authentication.ts` imports it
through) with a wrapper that calls the real function once per distinct `(secret, stored hash)` pair
and returns the remembered result after that, yielding once with `setImmediate` before returning a
remembered answer so concurrent steps still interleave. Keep the memo in module scope of that file,
so it lasts one test file and never reaches suites that do not load the host.

- Before writing it, grep every file that imports `hour-recovery-host.ts` (directly or through
  another fixture) for anything that counts or times key derivations — `src/testing/watched-scrypt.ts`
  and anything asserting a number of derivations or a timing — and report each. If one would change,
  stop and report rather than adjust its assertion.
- A remembered answer is exact: the same secret against the same stored hash gives the same answer.
  A wrong secret still reaches the real function the first time and is refused.
- `operation-authentication.ts` imports `verifySecretAsync` from `@waitron/identity`, so the mock
  also serves `break-glass.ts`, `recovery-pack.ts`, `setup-api.ts`, `join-requests.ts` and
  `device-session.ts` in those files; remembered answers are exact, so their behaviour is unchanged.
  The mock takes effect only for modules loaded after the host: confirm each file using the host
  loads it before any `apps/server` module that imports `@waitron/identity`.
- Test (in `apps/server/src/hour-recovery-host.test.ts`, where the host's own tests live): a repeated check of a correct secret
  calls the real derivation once; a wrong secret is refused, and refused again on repeat; a second
  stored hash for the same secret is checked for real. Show it fails before the wrapper exists.
- Then run, before and after, `first-setup-backup-reopen.test.ts`, `setup-first-backup-api.test.ts`,
  `first-setup-start-again-backup-discard.test.ts` and `first-setup-backup-resume-publication.test.ts`
  and record their times and test counts (counts must not change).

### Task 2 — One migrated template database per file in `heldSetup`

In `apps/server/test/held-setup-database.ts`, migrate `TEST_MIGRATIONS` once per test file into a
template folder (lazily, on first use), then for each test copy the template's `venue.db` and
`node.db` into the test's own venue folder before `openVenueDatabase`, instead of migrating there.

- Check first what else lives in a migrated folder (WAL/SHM files, Litestream state, a lock file) and
  copy only closed, checkpointed database files; close the template's handle before copying. Each
  test must still get its own independent copy.
- Confirm no test in the eight files that use `heldSetup` asserts on migration side effects that
  happen during migration (for example `append_only.triggers_restored`, migration timestamps or
  journal rows written at migrate time). Report any; if one exists, stop and report.
- Ten files use `heldSetup`, including `held-setup-database.test.ts` and
  `start-again-full-disk.e2e.test.ts`. The second fills a small real filesystem on purpose and runs in
  the separate stream job; a copied, checkpointed `venue.db` can differ in size from one migrated in
  place, so run it before and after (macOS makes the filesystem with `hdiutil`, CLAUDE.md §4) and
  report if its fill point or outcome changes.
- The template lives outside each test's own folder: the host's `afterEach`
  (`hour-recovery-host.ts:221`) deletes that folder.
- Run all ten `heldSetup` files before and after; record times and test counts (unchanged).

### Task 3 — One salt per file for the backup files the test helpers build

The helpers named above build encrypted backups through `encryptArtifact`
(`packages/provisioning/src/artifact-cipher.ts`), which draws a random salt, so the derived-key cache
never hits. Give the helpers a way to build the same file with a salt chosen once per test file:

- `frameUnderKey` takes a derived key, not a salt, so add a function that takes a salt (and derives
  through the existing cache), beside `encryptArtifact`; the IV stays random, so two files built with
  the same salt still differ byte for byte. `apps/server/src/artifact-cipher.ts` re-exports a fixed
  list and needs the new name added if the helpers import through it.
- Keep product callers unchanged and still drawing a random salt; add a test in `packages/provisioning`
  that the framing with a given salt produces a file the existing decrypt path opens, and that the
  product entry point still draws a different salt each call. Coverage for `packages/provisioning`
  stays at its bar.
- Change only the test helpers to use it. Product code keeps its random salt.
- Run before and after `first-setup-backup-reopen.test.ts`, `setup-first-backup-api.test.ts` and
  one file each that uses the cloud fixture, `repairFixture` and `selectedRepair`; record times and
  counts.

### Task 4 — Install only the headless shell for the server's shards

In `.github/workflows/ci.yml` at the server shard's install step (`playwright install chromium`,
around line 1137, inside its retry wrapper), install with `--only-shell`. Change nothing else in that
step's retry or timeout. Add a case to `scripts/ci-workflow.test.mjs` pinning the server's
`--only-shell` install; prove it by deletion. Update the sentence in
`docs/developers/ci-and-gates.md` that describes the server job's setup, if one does.

### Task 5 — Refresh the duration table from this branch's own CI run

Done by the lead after the pull request's first full CI run (tasks 1–4 and 6 change file times, so
the table must be measured after them). One run gives each file a single reading from whichever
runner speed its shard landed on (up to 1.5× apart), so take three: the pull request's run plus two
re-runs of its `test-server (N)` jobs, made for measurement only and said so in the pull request.
Download every `test-server (N)` job's log from the three, run `node scripts/test-durations.mjs apps/server/test-durations.json
<logs…>`, commit, push. Then read the slowest server job on the run that follows. If it is still over
270 s, compute with the packing function whether 21 or 22 shards bring it under (the shard count is
pinned in `scripts/ci-workflow.test.mjs` "pin each sharded package's shard count", and the matrix
list and `--shard …/20` change together; `docs/developers/ci-and-gates.md` names the count in its
server-shard section) and make that change as a further commit, with the
measurement in the pull request; otherwise leave the count at 20.

2026-11-03: done differently. No run was taken on the refreshed table at twenty shards; the
packing model over run 41551662181's three attempts put twenty at 286–298 s, twenty-two at
265–277 s, twenty-three at 257–269 s and twenty-four at 248–260 s, so the count went to
twenty-four, the first with ten seconds' room under 270. PR run 41556523522 then took 143–244 s
per ordinary server job.

### Task 6 — Split `first-fiscal-hour.e2e.test.ts`

The longest single file bounds its shard whatever the packing: 194 s in the table, 211 s on one
slower runner (run 41502939001), which with the test step's 10 s and the job's 39–51 s outside it
leaves no margin under 270 s. It starts 21 child servers through `tsx` (2.3–2.5 s each locally).
Split it into two (or three) files of roughly equal time along its existing `describe` groups, moving
shared setup into a helper under `apps/server/test/` (or `src/testing/` if it must be covered), with
every case kept unchanged. Record before and after: case counts per file (sum unchanged) and times.
Then do the same check for `kitchen-allergy.restart.test.ts` (141 s): split only if its slower-runner
time plus 61 s exceeds 270 s.

## Done when

Two consecutive full main runs after landing have every ordinary server shard at or under 270 s, or a
WATCHER-NEEDED entry names the one suite that cannot get there and why (the queue item's own
definition). Landing does not wait for those two main runs; the lead records them in the backlog.

## Not in this plan

- The `zone-process-matrix.*` files (they run other test files in nested Vitest runs; child
  processes are most of their time) — needs its own investigation.
- Starting child servers from a prebuilt bundle instead of `tsx` (2.3–2.5 s per start; bundling
  `bin.ts` failed on an earlier try) — not measured.
- A shared migrated template for every `useVenueDb` suite (about 0.85 s per file across several
  hundred suites) — wider than the setup family.
