# A938 server shard time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`. Every
> implementer is dispatched as `subagent_type: "implementer"` (medium effort). Steps use checkboxes.
> An implementer that passes about 150 tool calls with its task unfinished stops at a passing (or
> cleanly red) point, commits with `git commit -s`, and returns a handover: done, left, files, each
> check's state.

**Goal:** Every `test-server (N)` CI job finishes in about 4 minutes (today the slowest run 349–454 s
and the median 280–304 s), fixed at the causes: repeated identical key derivations in the tests, and
Vitest's hash split piling heavy files into the same shards. One known exception to "about 4
minutes": the shard holding `apps/server/src/first-fiscal-hour.e2e.test.ts`. That one file took up
to 255 s on CI (its six values in the model folder's `files.txt`), so its shard is modelled at about
260 s (255 × 0.83 with the de-dup, + 48 s setup) at every shard count. Only splitting the file can
lower that, and that waits for A733 (Global constraints).

**Architecture:** Two changes. (1) A test-only cache of the scrypt key derivation (`deriveKey` and
`deriveKeyAsync` in `packages/provisioning/src/scrypt-kdf.ts`, N=2^17), installed for every
`apps/server` test file through `setupFiles`, keyed on every input, so a derivation repeated with
identical inputs in one test file is computed once. It is not only the archive key: `git grep -n
scrypt-kdf -- packages apps` finds three product callers of those two functions, the archive cipher
(`packages/provisioning/src/artifact-cipher.ts`), the archive file cipher
(`apps/server/src/artifact-cipher-file.ts:21,61`) and the recovery bundle
(`apps/server/src/recovery-bundle.ts:34,113`), and all three reach them through that one module
(the last two through the re-export in `apps/server/src/scrypt-kdf.ts`). The
mock was shown to reach the first and the third (Measured receipts, "My own probe"); the file
cipher shares the bundle's import route and was not probed separately. Like `apps/server/src/testing/known-secret-hashes.ts`
it does identical expensive work once per test file. Unlike it, it is not a helper that tests call
for a fixture value: it is a mock that steps into the product's own calls, which is why every input
is in the key and why Review Focus 1–3 exist. (2) A custom Vitest sequencer for `apps/server` that packs test files into
shards by their measured duration (largest first into the lightest shard) from a committed table,
starts the files absent from the table first and then the longest, and raises the shard count from
11 to 16.

**Tech stack:** Vitest 4.1.11 (`test.sequence.sequencer`, `vi.mock` in a setup file), Node
`node:crypto` scrypt, GitHub Actions YAML, root-project guards under `scripts/`.

**Spec:** the A938 queue text (quoted in the Global constraints) and the measurement
`/Users/clintongormley/waitron-campaign-b/a938-measure.md`. The models below are in
`/Users/clintongormley/waitron-campaign-b/a938-model/` (scripts plus their input, `files.txt` =
5,214 per-file results from 66 shard logs, and `old.kv` = run 39169930434's per-file times).

**Path:** FULL (CI scheduling is a gate every server change passes through; a sequencer bug could
silently drop test files). No migration. No product code changes.

## Global constraints

- Plan base `b914505a8` (`origin/main`). Worktree
  `/Users/clintongormley/workspace/worktrees/waitron-feat-a938-server-shard-time`, branch
  `feat/a938-server-shard-time`. Prefix every command with `cd <worktree> &&`.
- Queue text, verbatim: "The slowest test-server shards run 6½–7½ minutes against the ~4-minute bar
  — find why and fix at the cause. … Vitest --shard splits by FILE COUNT, so one heavy file can sink
  a shard — splitting it, or raising the shard count, are both legitimate; the shard-count pins in
  scripts/ci-workflow.test.mjs move with you. Prove it with the same measurement on the PR's own run
  (slowest and median), before and after, in the PR body. Name the new slowest time in the PR so the
  watcher can re-check it (its stall checker flags test groups past 6 minutes). Same-files:
  apps/server test files are changed by other lanes' open branches — split or move only files no
  open branch changes … or rebase over theirs."
- Owner rule (ci-and-gates.md, "Every CI test job should finish in about 4 minutes"): fix at the
  cause; never cut what a test checks; never move coverage or mutation out of CI.
- **No test may get weaker.** The cache returns exactly what the real derivation returns for the
  same inputs, and computes for real on any input it has not seen: a wrong passphrase is derived for
  real and still refused. No global scrypt mock, no lowered cost.
- **Do not split or edit `apps/server/src/first-fiscal-hour.e2e.test.ts`**: lane A733's worktree
  (`waitron-feat-a733-secure-connection-repair`, commits on 2026-10-21) changes it. Checked
  2026-10-21: `gh pr list` shows one open PR, #1921 (A796). `gh pr view 1921 --json files` lists
  `docs/backlog.md`, which Task 5 also edits, and four `apps/server` test files plus
  `apps/server/src/payments-api.ts`, all modified, none added, none changed by this plan. A scan of every local `waitron-feat-*` worktree's diff found A733 on that file,
  A739 on `apps/server/src/invoice-pdf.ts` and A773-2 on
  `apps/server/src/testing/kitchen-table-order.ts`. This plan changes none of those three. The local
  `waitron-feat-a850-backup-verification` worktree (`git diff --name-status $(git merge-base HEAD
  origin/main) HEAD -- 'apps/server/**/*.test.ts'`) adds seven server test files and changes one,
  and its new code calls `encryptArtifact` and `decryptArtifactFile`. When it lands, its new files
  are absent from the duration table: that is the first expected table refresh. Re-run the check
  before pushing (Task 6).
- Never `--no-verify`. Every commit `git commit -s`. Local runs are focused; CI owns the package
  suites. Before any local run of more than one heavy server file, check
  `memory_pressure | grep free` and scale workers to it; set `TESTCONTAINERS_RYUK_DISABLED=true`;
  unset `AI_AGENT` and `CLAUDECODE` when you need to see console output.
- Read a Vitest run's `Tests` count, never just its exit status.
- Keep the ledger `docs/handoffs/2026-10-21-a938-server-shard-time.md` (gitignored) current at the
  end of every task.

## Measured receipts (planning, 2026-10-21)

### Why the jobs are slow (from the measurement file, not re-run)

- Setup is not the cause: over 66 main shard jobs, job time minus the test step was 35–74 s, median 48 s.
- The jobs jumped at A679 (#1752, run 39381991396), which added 61 server test files (1,754 of
  about 10,000 file-seconds on run 39507125783). The slowest job of each main run was already
  241–294 s on the runs from 2026-10-19 12:00Z up to it, and 349–415 s from it on (the measurement
  file's jobs-API listing).
- Heaviest files (median CI seconds over six runs, the measurement file's figures: the lower middle
  of six values): `first-fiscal-hour.e2e` 197 (real entry point
  booted twice per restart test), `hour-recovery-placement-1/2/3` 169/154/149 (121/133/94 repeated
  N=2^17 derivations on identical inputs, from the test helper and the product's preview, validate
  and restore steps each decrypting the same archive), `first-setup-unused-pdf` 151 (one 84 s test
  building three fixtures), `invoice-pdf` 119 (font width measurement, about 4.5× slower under
  coverage).
- A local exact-input scrypt memo, with coverage, cut the hour-recovery files and
  `restore-emergency-crash.e2e` by 45–64% and three boot/e2e files by 17–31%.

### My own probe: a `vi.mock` in a setup file reaches the provisioning package's internal import

Run 2026-10-21 in this worktree (files deleted afterwards). A setup file mocking
`../../../packages/provisioning/src/scrypt-kdf.ts` with a counting exact-input cache, and a test
calling `encryptArtifact(…, "right-pass")` once, `decryptArtifact(…, "right-pass")` twice and
`decryptArtifact(…, "wrong-pass")` once. The failing case (mock not reaching the package's own
`./scrypt-kdf.js` import) would print `calls 0`. It printed
`{"calls":4,"real":2} wrong: recovery.passphrase_invalid`, `1 passed`: four derivations requested,
two computed (right and wrong passphrase once each), the wrong passphrase still refused.

The recovery bundle reaches the mocked module by a second route: `apps/server/src/recovery-bundle.ts`
and `apps/server/src/artifact-cipher-file.ts` import `./scrypt-kdf.js`, which re-exports from
`@waitron/provisioning` (`apps/server/src/scrypt-kdf.ts:1`), whose index re-exports
`./scrypt-kdf.js` (`packages/provisioning/src/index.ts:164`). Run 2026-10-21 in this worktree
(probe file deleted afterwards): a test file with the same `vi.mock` path wrapping both functions in
a counter, calling `encryptBundle` then `decryptBundle`, then `encryptArtifact` then
`decryptArtifact`. The failing case (the bundle route not reaching the mock) would print
`afterBundle` 0. It printed `{"before":0,"afterBundle":2,"after":4}`, `1 passed`. The file cipher's
route was not probed separately.

The cache's type must not name the package's file by a relative path. Run 2026-10-21 in
`apps/server`, `pnpm exec tsc --noEmit -p .` over a temporary file (deleted afterwards): with
`typeof import("../../../../packages/provisioning/src/scrypt-kdf.ts")` it failed with TS6059
("is not under 'rootDir'"); with
`Pick<typeof import("@waitron/provisioning"), "deriveKey" | "deriveKeyAsync" | "SCRYPT_PARAMS">` it
exited 0.

### The replay: Vitest's hash split cannot reach 4 minutes, even with the de-duplication

`python3 -I replay2.py files.txt` (in the model folder). Vitest 4.1.11's split (sha1 of `/`+path,
sorted, cut by count; `replay-verify.py` reproduces every file's shard in all six runs). Job estimate =
0.262 × busiest shard's file-seconds + 48 s setup (calibrated: predicts 362–395 s against a measured
349–410 s). "Random orders" = 300 random orderings of each run's file names (A929's method), worst run's p90.

| N | as measured: est. slowest job, today's names / random p90 | with the scrypt de-dup: today's names / random p90 |
| --- | --- | --- |
| 11 | 395 / 417 s | 371 / 386 s |
| 14 | 333 / 357 s | 329 / 330 s |
| 16 | 298 / 330 s | 298 / 302 s |
| 18 | 303 / 316 s | 303 / 288 s |
| 20 | 269 / 293 s | 258 / 265 s |
| 24 | 259 / 260 s | 259 / 240 s |

Even with the de-dup, the hash split reaches about 240 s only at about 24 shards, and today's names
at 24 still give 259 s, because heavy files fall together by hash. The busiest/mean ratio grows
with N. That is the case the runner named for a duration-aware sequencer.

### The duration-balanced model

`python3 -I balanced.py files.txt old.kv` and `python3 -I firsttable.py files.txt`. Files are packed
largest first into the lightest shard using a table of estimates; each run is then judged on its
OWN times with a table built from the OTHER five runs (leave one out), so the table never sees the
run it is judged on. "Sim" = a 4-worker simulation of the shard (maxWorkers 4), files started
longest first, + 48 s.

First committed table (medians WITHOUT the de-dup) against times WITH the de-dup (the state this
branch ships):

| N | busiest file-s per run | est. slowest job (ratio) | est. slowest job (sim) | median shard job (sim) |
| --- | --- | --- | --- | --- |
| 14 | 722–793 | 237–256 s | 230–260 s | 212–227 s |
| 15 | 675–739 | 225–242 s | 221–260 s | 202–217 s |
| **16** | **622–676** | **211–225 s** | **214–260 s** | **194–208 s** |
| 17 | 596–669 | 204–223 s | 205–260 s | 186–195 s |

The sim's 260 s ceiling at every N is one file: `first-fiscal-hour.e2e` took 255 s on its slowest
run (× 0.83 with the de-dup = 212 s, + 48). No packing can go below the longest single file. That
file stays whole here (A733 is changing it), and is left as a backlog entry.

**A stale table.** `stale.py`: the table taken from run 39169930434 (2026-10-18, before A679), so
137 of today's 872 files (2,541 file-seconds, a quarter of the suite) are absent and packed at the
table's mean. Worst shard job per run (sim):

| N | absent files started by their estimate | absent files started FIRST |
| --- | --- | --- |
| 15 | 297–353 s | 249–267 s |
| 16 | 292–332 s | 230–260 s |

So a file absent from the table is packed at the table's mean and STARTED FIRST in its shard (as
Vitest's own sequencer starts unknown files first). Even a table missing a quarter of the suite
then does better than today's hash split (349–410 s). Staleness makes the split less balanced, but
every file still runs once.

**Why 16, not 15 or 14:** 15 puts the modelled slowest at 242 s, right at the line, and the suite is
growing fast: from run 39169930434 (2026-10-18; 745 files, 6,339 file-seconds, `old.kv`) to run
39507125783 (872 files, 9,957 file-seconds, `files.txt`), the file count grew 17% and the
file-seconds 57%. 16 gives 211–225 s with room for growth. The repository is public
(`gh repo view --json visibility` → `PUBLIC`), so five more standard-runner jobs cost nothing.
Task 6 records each shard's queue time in case the extra jobs wait for runners.

### Why the de-duplication is a test-side cache, not a product change

Deriving the key once per restore would cut repeats in the product's preview, validate and restore
steps. But in the setup flow those steps are reached through separate entry points (preview, then
validate, then restore), so the key would have to be carried between them. On the backup restore
path that is not a small change, so it goes to the backlog. The test-side cache is per test file
(each file's module state is fresh), as `known-secret-hashes.ts`'s maps are. It does not reach child
processes the tests start with `execFile`: those still derive for real.

## Review Focus

1. **A cache key that omits an input.** `maxmem` does not change the derived bytes, but it decides
   whether scrypt throws. If the key left it out, a call that must throw would get an earlier
   call's key. Every one of `passphrase`, `salt`, `N`, `r`, `p`, `keylen` and `maxmem` is in the
   key (Task 1 test).
2. **A caller changes a returned key.** Each call gets its own copy, so a caller that zeroes or
   alters its key cannot change what the next caller receives (Task 1 test).
3. **A failed derivation is cached.** An error thrown (synchronous) or rejected (asynchronous) is
   passed on and never stored, so the next call derives for real (Task 1 test).
4. **A file dropped or run twice by the partition.** Test files would then vanish silently, and so
   would their coverage. The completeness tests (Tasks 2 and 4) check the packing over fixtures and
   over a walk of the tree's `*.test.ts` files. They are weaker than their names: they never run
   Vitest, never see CI's `--exclude` list or the file list Vitest hands `shard()`, and never check
   that the table is fresh. Task 6 counts the `[file-progress] end` lines of the PR's own run once;
   nothing checks it on later runs (a backlog line, Task 5).
5. **Shards that work out different partitions.** Every shard runs the sequencer on its own runner.
   If the result depended on input order or on root-path spelling, two shards could both skip a
   file. The partition is sorted by (estimate descending, path) and paths are made relative to the
   root with `/` separators (Task 2 tests).

---

### Task 1: a test-side cache of the scrypt key derivation

**Files:**
- Create: `apps/server/src/testing/derived-key-cache.ts`
- Create: `apps/server/src/testing/derived-key-cache-setup.ts`
- Create: `apps/server/src/testing/derived-key-cache.test.ts`
- Modify: `apps/server/vitest.config.ts` (`setupFiles`)

**Interfaces:**
- Produces: `cachedKdf(real: KdfModule): KdfModule` where
  `type KdfModule = Pick<typeof import("@waitron/provisioning"), "deriveKey" | "deriveKeyAsync" | "SCRYPT_PARAMS">`.
  Never type it from the package's file by a relative path: that fails `@waitron/server`'s
  typecheck with TS6059 (Measured receipts, "My own probe"). The result spreads `real` and replaces
  `deriveKey` and `deriveKeyAsync` with the same signatures
  (`(passphrase: string, salt: Buffer, params?: ScryptParams)`, defaulting `params` to
  `real.SCRYPT_PARAMS`). `derivedKeyStats(): { requested: number; derived: number }`. The cache Map
  and counters live on `globalThis[Symbol.for("waitron.derivedKeyCache")]`, so the setup file's
  dynamic import and the test's import share them whichever module instance each gets.
- The setup file: `vi.mock("../../../../packages/provisioning/src/scrypt-kdf.ts", async (importOriginal) => (await import("./derived-key-cache.js")).cachedKdf(await importOriginal()))`.
  The path is relative to `apps/server/src/testing/`. The relative path appears only in this
  `vi.mock` string, never in a type.

- [ ] **Step 1: Write the failing tests** in `derived-key-cache.test.ts`. They run through the
  product's own functions (`encryptArtifact`, `decryptArtifact` from `@waitron/provisioning`;
  `deriveKey`, `deriveKeyAsync`, `SCRYPT_PARAMS` from `../scrypt-kdf.js`) and read
  `derivedKeyStats()` as deltas from the start of each test:
  - "derives a repeated archive key once": encrypt with `"right-pass"`, decrypt twice → plaintext
    both times; `derived` delta 1, `requested` delta 3.
  - "still refuses a wrong passphrase, deriving it for real": after the above, decrypting with
    `"wrong-pass"` throws an error whose `code` is `recovery.passphrase_invalid`; `derived` delta 1.
  - "returns exactly what scrypt returns": `deriveKey(p, salt)` twice equals
    `scryptSync(p, salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })` from
    `node:crypto` (and `deriveKeyAsync` the same).
  - "keys each input separately": same passphrase and salt with `{ ...SCRYPT_PARAMS, N: 2 ** 14 }`
    derives anew and differs from the N=2^17 key; same passphrase, different salt derives anew.
  - "a call that must throw still throws after a success": `deriveKey(p, salt, { ...SCRYPT_PARAMS, N: 2 ** 14 })`
    succeeds, then the same call with `maxmem: 1024` throws.
  - "a caller changing its key does not change the next caller's": `deriveKey(...).fill(0)`, then
    the same call returns the non-zero key.
  - "a failed derivation is not stored": `deriveKeyAsync` with `maxmem: 1024` rejects twice and
    `derived` counts both attempts (and `deriveKey` with `maxmem: 1024` throws twice, counted twice).
- [ ] **Step 2: Run, watch it fail**:
  `cd apps/server && pnpm exec vitest run src/testing/derived-key-cache.test.ts`. Expected: fails
  on the import of `./derived-key-cache.js` (or the stats deltas), not on an assertion about the
  product.
- [ ] **Step 3: Implement** `derived-key-cache.ts` and the setup file, and add
  `"src/testing/derived-key-cache-setup.ts"` to `setupFiles` beside
  `src/testing/byte-equality-setup.ts`. Key: `JSON.stringify([passphrase, salt.toString("hex"), N, r, p, keylen, maxmem])`.
  Store a copy of the derived key and return `Buffer.from(stored)`. Store only after success. Count
  `requested` on every call, and `derived` on every call that reaches the real function. One short
  comment in the setup file says what it does and that it is exact-input only; no history.
- [ ] **Step 4: Run it green**, then run the 44 test files known to derive a key in-process: the 41
  listed in `/Users/clintongormley/waitron-campaign-b/a938-model/kdf-files.txt` (paths relative to
  `apps/server`; found by the measurement's call-counting preload), plus three that call the
  recovery bundle's `encryptBundle`/`decryptBundle` directly and are missing from it
  (`git grep -l -E "encryptArtifact|decryptArtifact|encryptBundle|decryptBundle|deriveKey" -- 'apps/server/**/*.test.ts'`,
  2026-10-21: 31 files, all in that list except these three). Check memory headroom first. From
  `apps/server`, run
  `pnpm exec vitest run $(cat /Users/clintongormley/waitron-campaign-b/a938-model/kdf-files.txt) src/recovery-bundle.test.ts src/recovery-bundle-api.test.ts src/recovery-unpack-command.test.ts`;
  zsh splits `$(…)` output on newlines. Expected: every file passes, and the `Tests` count is read
  and recorded. This list is not proven complete: a test can reach a derivation through product
  code that neither the preload's runs nor the grep saw. The setup file is installed for every
  server test file, so CI's full server run is what checks the rest.
- [ ] **Step 5: Measure the effect locally, with coverage, alternating twice**:
  `pnpm exec vitest run --coverage --coverage.thresholds.statements=0 --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 src/hour-recovery-placement-1.test.ts`
  with the setup-file line in, then commented out, then in, then out. Record the four durations and
  the load average in the ledger and in the commit message. The measurement file's memo measured
  83.2 → 30.0 s and 97.1 → 50.0 s. If this cache saves far less, stop and report: the repeats would
  then be outside `deriveKey`, and the model's de-dup factors would not hold.
- [ ] **Step 6: Typecheck, lint and format**, from the worktree root, each to its own exit status:
  `pnpm --filter @waitron/server typecheck`,
  `pnpm exec eslint apps/server/src/testing/derived-key-cache.ts apps/server/src/testing/derived-key-cache-setup.ts apps/server/src/testing/derived-key-cache.test.ts apps/server/vitest.config.ts`
  and `pnpm exec prettier --check` over the same four files. Fix anything they report before the
  commit.
- [ ] **Step 7: Commit**:
  `git add apps/server/src/testing/derived-key-cache.ts apps/server/src/testing/derived-key-cache-setup.ts apps/server/src/testing/derived-key-cache.test.ts apps/server/vitest.config.ts && git commit -s`
  with a plain-English message that states the experiment and its numbers.

### Task 2: the duration sequencer, as a root script with its own tests

**Files:**
- Create: `scripts/vitest-duration-sequencer.mjs`
- Create: `scripts/vitest-duration-sequencer.test.mjs`

**Interfaces:**
- Produces (all named exports, no Vitest import in the module):
  - `defaultEstimate(seconds: Record<string, number>): number`: the mean of the table's values, `1` for an empty table.
  - `relativeTestPath(root: string, moduleId: string): string`: `path.relative(root, moduleId)`
    with separators turned into `/`.
  - `balancedShards(paths: string[], seconds: Record<string, number>, count: number): string[][]`:
    the paths sorted by (estimate descending, then path ascending), each put into the shard with the
    smallest total so far (lowest index on a tie). The estimate is `seconds[path]`, or
    `defaultEstimate(seconds)` for a path not in the table. Within a shard, paths stay in the order
    they were put in.
  - `startOrder(paths: string[], seconds: Record<string, number>): string[]`: paths absent from the
    table first (by path), then known paths by seconds descending, then by path.
  - `durationSequencer(seconds, { write = (line) => process.stdout.write(`${line}\n`) } = {})`:
    returns a class with `constructor(ctx)`, `async shard(specs)` and `async sort(specs)`. `shard`
    reads `ctx.config.root` and `ctx.config.shard.{index,count}`. It maps each spec to
    `relativeTestPath(root, spec.moduleId)` and returns the specs of shard `index` (1-based) from
    `balancedShards`. It also writes one line:
    `[duration-sequencer] shard <index>/<count>: <files> files, <estimated, rounded> estimated s, <k> absent from the table<: names, sorted, comma-separated when k > 0>`.
    `sort` returns the specs in `startOrder`. The class carries `static table = seconds`, so a
    guard can read the table a config wired in without constructing it.

- [ ] **Step 1: Write the failing tests** (`describe` the four functions and the class):
  - `balancedShards(["a","b","c","d","e"], {a:100,b:60,c:50,d:40,e:10}, 2)` →
    `[["a","d"],["b","c","e"]]`.
  - A path absent from the table is packed at the mean: `({a:30,b:10})`, paths `["a","b","x"]`,
    count 2 → `[["a"],["x","b"]]`.
  - An empty table packs by count: paths `p1..p4`, `{}`, count 2 → `[["p1","p3"],["p2","p4"]]`.
  - Completeness: a fixture of 50 paths (45 with varied seconds, 5 absent), for every count 1–20,
    the flattened shards sorted equal the input sorted, and no path appears twice. When count is
    more than the number of paths, the extra shards are empty.
  - Order independence: the same 50 paths reversed and rotated give the identical shards.
  - `startOrder(["k1","u2","k2","u1"], {k1:5,k2:50})` → `["u1","u2","k2","k1"]`; equal seconds
    fall back to path order.
  - `relativeTestPath("/r/apps/server", "/r/apps/server/src/a.test.ts")` → `"src/a.test.ts"`, and
    the same with a trailing `/` on the root.
  - `defaultEstimate({a:30,b:10})` → `20`; `defaultEstimate({})` → `1`.
  - The class: a fake `ctx = { config: { root: "/r", shard: { index, count: 3 } } }` and specs
    `{ moduleId: "/r/src/<n>.test.ts" }`. Over index 1–3 the returned specs (by identity) cover
    every input spec exactly once. `sort` returns `startOrder`'s order. `write` receives exactly
    one line per `shard` call, equal to the expected string for a fixture with one absent file.
  - The default `write`: a class built with no options writes its line to `process.stdout`. Replace
    `process.stdout.write` with a collector inside `try`/`finally` and restore it, as
    `scripts/vitest-file-progress.test.mjs:198` ("uses the real clock, stdout and an unref'd timer
    by default") does, call `shard` once, and assert the one collected chunk is the expected line
    followed by `\n`. Without this case the default function is never called and the file misses the
    98% functions bar.
- [ ] **Step 2: Run, watch it fail**: `pnpm vitest run scripts/vitest-duration-sequencer.test.mjs`
  (root project). Expected: the import fails.
- [ ] **Step 3: Implement** the module. It starts with one short comment saying what it is for: the
  shards are packed by measured duration, because Vitest's own split cuts by file count. Point to
  the ci-and-gates.md section by name.
- [ ] **Step 4: Run green with coverage**:
  `pnpm vitest run --coverage scripts/vitest-duration-sequencer.test.mjs`. Read the per-file row for
  `vitest-duration-sequencer.mjs`: it must hold 98/98/98/95 (the root project's bar). Ignore the
  other rows: they are other files left unrun by this filter.
- [ ] **Step 5: Proof by deletion**: make `balancedShards` drop the last path of the last non-empty
  shard. The completeness test fails, and fails on completeness. Revert. Record the experiment in
  the commit message.
- [ ] **Step 6: Commit** both files, `git commit -s`.

### Task 3: the duration table and the script that builds it

**Files:**
- Create: `scripts/test-durations.mjs`
- Create: `scripts/test-durations.test.mjs`
- Create: `apps/server/test-durations.json`

**Interfaces:**
- Produces: `fileSecondsFromLog(text: string): Map<string, number>`. It reads every line containing
  `[file-progress] end <path>[ [<project>]] <state> <N>s` (any state; the `gh run view --log`
  prefix before `[file-progress]` is ignored). Within one log, a later line for the same path
  replaces an earlier one. `start` and `still running` lines are ignored, and so is an `end` line
  with no seconds: the reporter writes `[file-progress] end <path> <state>` without a time when it
  never saw the file start (`scripts/vitest-file-progress.mjs:54`).
  `medianTable(logs: Map<string, number>[]): Record<string, number>`: per path, the median over the
  logs that hold it (the mean of the middle two for an even count), as `Math.round(x * 10) / 10`,
  keys in sorted order.
  `main(argv: string[], { readFile, writeFile, stderr }): number`: `argv` = `[out.json, log, …]`.
  It writes `JSON.stringify(table, null, 2) + "\n"` and returns 0. With fewer than two arguments it
  writes a usage line to `stderr` and returns 2. The entry block that calls `main` with
  `process.argv.slice(2)` sits inside `/* v8 ignore start */ … /* v8 ignore stop */`, as in
  `scripts/changed-packages.mjs`, and is the only code there.
- Consumed by Task 4: `apps/server/test-durations.json` is a flat object, path → seconds.

- [ ] **Step 1: Write the failing tests**: two log texts in the real shape
  (`test-server (1)\tUNKNOWN STEP\t2026-10-20T12:52:41.3301631Z [file-progress] end src/a.test.ts passed 14.1s`)
  including a `start` line, a `still running` line, an `end` line with no seconds
  (`[file-progress] end src/c.test.ts passed`, which must not appear in the map), a `failed` file, a
  project suffix `src/b.test.ts [unit]`, and a path repeated in one log. Assert the parsed maps; that `medianTable`
  of three logs `{a:1}`, `{a:3}`, `{a:2,b:4}` is `{a:2,b:4}`; that the median of two values is their
  mean, rounded to 0.1; and that `main` writes the expected text, returns 0, and returns 2 with a
  usage line for `[]` and `["out.json"]`.
- [ ] **Step 2: Run, watch it fail**: `pnpm vitest run scripts/test-durations.test.mjs`.
- [ ] **Step 3: Implement**, then check that coverage holds the bar as in Task 2, Step 4.
- [ ] **Step 4: Build the first table** from the six main runs measured
  (39425472781, 39444354037, 39449527877, 39500330558, 39503634628, 39507125783). Put the logs in a
  directory OUTSIDE the worktree:
  ```bash
  dir=$(mktemp -d); for run in 39425472781 39444354037 39449527877 39500330558 39503634628 39507125783; do
    gh api "repos/clintongormley/waitron/actions/runs/$run/jobs?per_page=100&filter=latest" \
      --jq '.jobs[] | select(.name | startswith("test-server (")) | .id' |
    while read -r id; do gh run view --repo clintongormley/waitron --job "$id" --log > "$dir/$run-$id.log"; done
  done
  node scripts/test-durations.mjs apps/server/test-durations.json "$dir"/*.log
  ```
  Expected: 66 log files; the table holds 872 paths, with
  `"src/first-fiscal-hour.e2e.test.ts": 208.1` and `"src/hour-recovery-placement-1.test.ts": 170.6`.
  The model folder's `files.txt` holds the same six runs' lines. Its six values for
  first-fiscal-hour are 139.8, 161.7, 196.8, 219.3, 253.0 and 255.0; for placement-1, 132.8,
  153.9, 169.3, 171.9, 184.5 and 192.8. The measurement file's 196.8 and 169.3 are the lower middle
  values. This plan's rule takes the mean of the middle two, rounded to 0.1 in JavaScript:
  `node -e 'console.log(Math.round((196.8+219.3)/2*10)/10, Math.round((169.3+171.9)/2*10)/10)'`
  prints `208.1 170.6`. If the API no longer serves those logs, use the newest six successful main
  runs that ran `test-server` and say so in the commit message.
- [ ] **Step 5: Format check**: `pnpm exec prettier --check apps/server/test-durations.json`. If it
  reports a difference, change the script's output to match prettier, then rerun Steps 3–5.
- [ ] **Step 6: Commit** the three files, `git commit -s`. Name the six run ids in the message.

### Task 4: wire the sequencer into `apps/server` and move to 16 shards

**Files:**
- Modify: `apps/server/vitest.config.ts`
- Modify: `.github/workflows/ci.yml` (`test-server`: matrix and `--shard=…/11`; the header comment
  at lines 878–888)
- Modify: `scripts/ci-workflow.test.mjs` (the "pin each sharded package's shard count" case: `"@waitron/server": 16`)
- Modify: `scripts/changed-scope.mjs` (`ROOT_SCOPE_CONSUMERS`: add `["scripts/vitest-duration-sequencer.mjs", ["apps/server"]]`)
- Modify: `scripts/changed-packages.test.mjs` (a real-tree case beside the one at line ~750:
  `scripts/vitest-duration-sequencer.mjs` selects `@waitron/server`)
- Modify: `scripts/vitest-duration-sequencer.test.mjs` (the wiring case)

**Interfaces:**
- Consumes: `durationSequencer` (Task 2), `apps/server/test-durations.json` (Task 3).
- The config gains
  `sequence: { sequencer: durationSequencer(JSON.parse(readFileSync(new URL("./test-durations.json", import.meta.url), "utf8"))) }`,
  importing `durationSequencer` from `"../../scripts/vitest-duration-sequencer.mjs"`. This follows
  the precedent of `apps/dashboard/vite.config.ts` importing `../../scripts/npm-bundle-notices.mjs`.

- [ ] **Step 1: Write the failing wiring case** in `scripts/vitest-duration-sequencer.test.mjs`:
  "apps/server's config packs every server test file into exactly one shard". It imports
  `../apps/server/vitest.config.ts` and expects `test.sequence.sequencer.table` to deep-equal the
  parsed `apps/server/test-durations.json`. It walks `apps/server/{src,test,scripts}` for files
  named `*.test.ts`, as paths relative to `apps/server`, keeping only entries whose `isFile()` is
  true (a failing browser test leaves a screenshot DIRECTORY named `*.test.ts`; CLAUDE.md §4,
  "Source scanners select files"). For each count in 2–24,
  `balancedShards(paths, table, count)` flattened and sorted equals the paths sorted, with no
  duplicate. It never constructs the class, so the root run prints no sequencer lines. Task 2's
  class tests already prove that `shard` returns `balancedShards`' bin.
- [ ] **Step 2: Run, watch it fail**: `pnpm vitest run scripts/vitest-duration-sequencer.test.mjs`.
  Expected: fails because `test.sequence` is undefined.
- [ ] **Step 3: Wire the config; move ci.yml to 16** (matrix `[1, …, 16]`, `--shard=${{ matrix.shard }}/16`).
  Rewrite the header comment: "SHARDED SIXTEEN WAYS, packed by measured duration
  (`scripts/vitest-duration-sequencer.mjs`, table `apps/server/test-durations.json`)". The A528/A801
  pointer becomes a pointer to the new A938 section. Pin 16 in `ci-workflow.test.mjs`. Add the
  `ROOT_SCOPE_CONSUMERS` entry and the changed-packages case.
- [ ] **Step 4: Run the guards this touches**, each to a read `Tests` count:
  `pnpm vitest run scripts/vitest-duration-sequencer.test.mjs scripts/ci-workflow.test.mjs scripts/root-scope-consumers.test.mjs scripts/changed-packages.test.mjs scripts/changed-scope.test.mjs scripts/test-durations.test.mjs scripts/coverage-thresholds.test.ts`.
  `root-scope-consumers` must fail if the `ROOT_SCOPE_CONSUMERS` entry is removed. Try that once
  and revert.
- [ ] **Step 5: Proof by deletion**: remove the `sequence` key from the server config. The wiring
  case fails. Revert.
- [ ] **Step 6: Local smoke**: run `cd apps/server && pnpm exec vitest run --shard=1/16 --passWithNoTests src/testing/derived-key-cache.test.ts`.
  Expected: one `[duration-sequencer] shard 1/16:` line and a `Tests` count (0 or 1 files). This
  shows only that the config loads and the sequencer runs. A `vitest list --shard` does NOT apply
  shard selection (ci-and-gates.md, "A file-only Vitest list does not apply shard selection"), so
  do not use it as evidence.
- [ ] **Step 7: Commit**, `git commit -s`.

### Task 5: the rule, the receipt and the backlog

**Files:**
- Modify: `docs/developers/ci-and-gates.md`
- Modify: `CLAUDE.md` (§2)
- Modify: `docs/backlog.md` (area "CI, tests and developer tooling", and "The box: backups, upgrades and recovery")

- [ ] **Step 1: New section** in ci-and-gates.md after "The till's shards: seven…":
  `### The server's shards: sixteen, packed by measured duration`, written in A929's style
  (incident runs, causes with receipts, why this shape, why 16). Use this plan's "Measured
  receipts", stated as experiments, with the run ids and the model folder path. Add the two operator
  facts: a file absent from the table is packed at the table's mean and started first, and how the
  table is refreshed (Task 3, Step 4's commands, with the newest runs), naming the
  `a850-backup-verification` branch's landing as the first expected refresh. Also name its guards
  and say they are weaker than their names: they check the packing over a walk of the tree's
  `*.test.ts` files, never a Vitest run, and never that the table is fresh. End it with a paragraph
  for Task 6's measured numbers. Until then, write a sentence saying the PR's own run is measured in
  the PR description.
- [ ] **Step 2: Retire the stale claims across the whole file and the tree.** Run
  `git grep -n -i -E "eleven|/11([^0-9]|$)|FILE COUNT|BaseSequencer|sha1 of" -- '*.md' '.github' 'scripts' ':!docs/superpowers' ':!docs/handoffs' ':!docs/compliance' ':!docs/operations'`.
  (`\b` is not a word boundary in `git grep -E` here: `/11\b` matched nothing, not even
  `.github/workflows/ci.yml:959`'s `--shard=${{ matrix.shard }}/11`, which this pattern finds.) The
  `/11` part also matches dates and task ranges in `docs/compliance` and `docs/operations`, which
  the pathspecs exclude. Check every
  other hit. At minimum: "three-way and eleven-way" (around line 511) becomes sixteen-way;
  the "Vitest `--shard` splits by FILE COUNT" sentence (around line 520) gains "except
  `apps/server`, packed by duration since A938"; the A528 paragraph's "(Eleven since A801 …)" and
  the A801 section get a dated "(Sixteen, packed by duration, since A938: see …)" pointer;
  the installer-change list around line 1903 gains "sixteen since A938"; the A679 split-check
  paragraph around line 557 gets a one-line pointer saying the server no longer uses
  `BaseSequencer.shard`. Historical text stays as written, with a pointer added.
- [ ] **Step 3: CLAUDE.md §2.** Amend the trap "Vitest `--shard` splits by FILE COUNT …" to add
  "except `apps/server`, whose shards are packed by duration". Add one rule line:
  "**`apps/server`'s shards are packed by a committed duration table
  (`apps/server/test-durations.json`, read by `scripts/vitest-duration-sequencer.mjs`), not by
  Vitest's hash split.** A file missing from the table is packed at the table's mean and started
  first in its shard; refresh the table with `scripts/test-durations.mjs` when a server shard drifts
  past 4 minutes. Cost: A938, the hash split held the slowest shard at 349–454 s. Guard:
  `scripts/vitest-duration-sequencer.test.mjs`, weaker than its name — it checks the packing over a
  walk of the tree's `*.test.ts` files, never a Vitest run, and never that the table is fresh. Receipt:
  [ci-and-gates.md](docs/developers/ci-and-gates.md#the-servers-shards-sixteen-packed-by-measured-duration)."
  (The anchor is GitHub's slug of Step 1's heading; if you change the heading, change the anchor.) Run
  `pnpm vitest run scripts/claude-md-pointers.test.ts` and `pnpm exec prettier --check CLAUDE.md`.
- [ ] **Step 4: Backlog.** No A938 entry exists (`grep -n A938 docs/backlog.md docs/backlog/*.md` →
  nothing, 2026-10-21); confirm. Update the existing "`apps/server/src/invoice-pdf.test.ts` took
  162 s" entry with A938's profile: its time is in `width()` (`apps/server/src/invoice-page.ts:47`);
  `wrap()` measures a growing string once per character; it is about 4.5× slower under coverage;
  caching the advance width per string is the untried fix (median 119 s over six runs). Add
  "Left open by A938" entries in the same style as A801's:
  (a) split `apps/server/src/first-fiscal-hour.e2e.test.ts` (197 s median, 255 s worst, the floor
  under its shard) once A733 has landed, or find why each restart test boots the entry point twice;
  (b) in the box area: the product derives the archive key separately in preview, validate and
  restore (`previewRecoveryArchive`, `validateArtifact`, `restoreFromArtifact`), so deriving it once
  per restore would save CPU on the box; this is a behaviour change on the restore path and needs
  its own tests;
  (c) the server's duration table is refreshed by hand, nothing says when it has gone stale, and the
  other sharded packages (till, dashboard, venue-service, db, provisioning) still use the hash split;
  the first expected refresh is when the `a850-backup-verification` branch lands with its new server
  test files;
  (d) nothing checks, on every CI run, that each server test file ran in exactly one shard: the
  guard checks the packing over a walk of the tree, and Task 6 counts the `[file-progress] end`
  lines of one run. A standing check (for example in `test-server-merge`, comparing the shards'
  `end` lines with the file list) is the open item.
- [ ] **Step 5: Commit**, `git commit -s` (`CLAUDE.md` is format-checked; `docs/` is not:
  `pnpm exec prettier --file-info docs/developers/ci-and-gates.md` prints `"ignored": true`).

### Task 6: measure on the PR's own run, and iterate

- [ ] **Step 1: Re-check same-files**, as in the Global constraints (`gh pr list`, each PR's files,
  and the local `waitron-feat-*` worktrees) for `apps/server/vitest.config.ts`, `.github/workflows/ci.yml`,
  `scripts/ci-workflow.test.mjs`, `scripts/changed-scope.mjs`, `CLAUDE.md`, `docs/backlog.md` and
  `docs/developers/ci-and-gates.md`. Rebase over any that landed. If a branch that adds server test
  files (such as `a850-backup-verification`) landed, rebuild the table (Task 3, Step 4) so its files
  are not absent.
- [ ] **Step 2: Run `/finish-branch`** with this worktree and this plan. It rebases, reviews, opens
  the PR and polls CI. This branch changes `apps/server/vitest.config.ts`, so CI's `changes` job
  should select the server. Confirm it in the run (`changes` outputs `code=true`, `server=true`).
  If it did not, add a one-line code touch in `apps/server` (A929's method) and push again.
- [ ] **Step 3: Read the PR's own run.** Use
  `gh api "repos/clintongormley/waitron/actions/runs/<run>/jobs?per_page=100&filter=latest"` and,
  for every `test-server (N)`, record: the job duration (`completed_at − started_at`), the "Run the
  server shard" step duration, the queue time (`started_at − created_at` of the job), and the
  `[duration-sequencer]` line from its log. Report the slowest, the median and each shard.
  One run is one sample, and runners come in two speeds about 1.5 times apart (ci-and-gates.md,
  "Runners come in two speeds, and the busiest shard is the one that crosses 4 minutes"). So re-run
  the PR's run once (`gh run rerun <run>`, a second attempt), wait for it, and measure the second
  attempt the same way: `filter=latest` reads the newest attempt, and the first stays readable at
  `repos/clintongormley/waitron/actions/runs/<run>/attempts/1/jobs`. Report both attempts.
- [ ] **Step 4: Check every file ran exactly once.** Count the `[file-progress] end` lines across
  the 16 logs; there must be no duplicate path. Compare the set with a recent main run's 11-shard
  set: the only differences should be the test files this branch adds (and any added or removed by
  commits main gained since). Also confirm that `test-server-merge` passed.
- [ ] **Step 5: Before, on the same day.** Take the newest main run that ran `test-server` and
  measure it the same way. The "before" figures are that run plus the six-run table (slowest
  349–410 s, median 280–293 s; branch run 39502248529 454 s; PR #1928's 432 s).
- [ ] **Step 6: If the slowest job is over about 250 s**, read that shard's `[file-progress]` lines.
  First, the known floor: if the shard's last file to end is `src/first-fiscal-hour.e2e.test.ts`
  and the job lasted about that file's own `end` seconds plus setup (job time minus test-step time,
  48 s median), no packing or shard count can lower it (the Goal's exception). Record it and stop
  iterating; the PR names it as the known exception. Otherwise:
  if a file absent from the table or a mis-estimated file is the cause, rebuild the table from this
  run's logs plus the newest main runs (Task 3, Step 4) and push. If the shard holds only a
  well-estimated load above the model, rerun `firsttable.py` at a higher N on the new times, move
  the count and its pin, and push. Measure again; each iteration goes in the PR body.
- [ ] **Step 7: Fill the numbers**: the final paragraph of the ci-and-gates.md section, and the PR
  description below. Commit and push.

## PR description

Title: `Server test shards in about 4 minutes: pack them by measured duration, and derive each repeated test key once (A938)`

Body (plain English; numbers from Task 6):

```markdown
The slowest `test-server` CI job took 349–454 s, against the owner's bar of about 4 minutes.

**Why.** Setup is not the cause (median 48 s of each job). Since A679 (#1752) the server suite
holds about 10,000 file-seconds. Vitest splits files into shards by a hash of their names, so heavy
files land together: main run 39507125783 put five of the six heaviest files in shards 8–11, and on
each of six main runs (39425472781 … 39507125783) the slowest job was one of those four. The heaviest files spend much of
their time deriving the same backup-archive key (scrypt, N=2^17) again and again on identical
inputs: 121, 133 and 94 repeats in the three `hour-recovery-placement` files.

**What changed.**
- Tests derive each distinct scrypt key (backup archive, archive file, recovery bundle) once per
  test file (`apps/server/src/testing/derived-key-cache.ts`, installed for every server test file).
  It mocks the product's own key derivation for the tests; it is keyed on every input and computes
  anything it has not seen, so a wrong passphrase is still derived for real and refused; its tests
  show that. Child processes the tests start still derive for real.
- `apps/server`'s shards are packed by measured duration (`scripts/vitest-duration-sequencer.mjs`,
  table `apps/server/test-durations.json`, built by `scripts/test-durations.mjs` from six main runs'
  logs). A file absent from the table is packed at the table's mean and started first in its shard.
- 11 shards → 16. A replay of Vitest's own split over six runs showed that more shards alone would
  not get there: with the cache, about 24 shards are needed to reach 240 s.

**Measured** (job = `completed_at − started_at` from the jobs API):

| | slowest job | median job |
| --- | --- | --- |
| before: main runs 39425472781 … 39507125783 | 349–410 s | 280–293 s |
| before: main run <id>, same day | <s> | <s> |
| after: this PR's run <id>, attempt 1 | **<s> (shard <k>)** | <s> |
| after: the same run, attempt 2 | <s> (shard <k>) | <s> |

Per shard (after, both attempts): <16 numbers each>. On this run every server test file ended
exactly once across the 16 shard logs (<n> files; compared with main run <id>); nothing checks
that on later runs (backlog). `test-server-merge` passed.

**New slowest time: <s> s (`test-server (<k>)`)**, for the watcher to re-check.

**Known exception:** <if Task 6 Step 6 stopped at the floor: the shard holding
`first-fiscal-hour.e2e.test.ts` took <s> s, that file's own <s> s plus setup; it stays over
4 minutes until the file is split after A733 lands. Otherwise delete this paragraph.>

Left open (backlog): splitting `first-fiscal-hour.e2e.test.ts` once A733 lands; deriving the key
once per restore in the product; refreshing the duration table; a check on every CI run that each
server test file ran in exactly one shard.
```
