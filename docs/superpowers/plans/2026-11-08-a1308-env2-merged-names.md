# A1308 environment, PR 2 of 8: names that mean the same thing are merged — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every pair or family of environment variables that carries one value under two or more
names keeps one name. Test switches leave the production host scripts for four `WAITRON_TEST_*`
names.

**Architecture:** Most of the change is a rename, done by one committed script
(`scripts/a1308/env2-renames.mjs`) whose output is not counted (rules §1). Four merges are not plain
renames and are hand-written: the box's public address (`WAITRON_ADVERTISED_ORIGIN` folds into
`WAITRON_MANAGEMENT_ORIGIN`), the print agent's name (a constant: the host name), one folder
in front of every overridable host path in the two host scripts (`WAITRON_TEST_HOST_ROOT`), and one
parent folder for the full-disk tests' small filesystems (`WAITRON_FULL_DISK_ROOT`).

**Tech Stack:** TypeScript, bash, GitHub Actions YAML, Vitest.

**Spec:** [`environment.md`](../specs/2026-11-02-rationalisation/environment.md) §1 E5 and E7, §2
"Standard and third-party … tests/CI", §3 rows `WAITRON_ADVERTISED_ORIGIN`, `WAITRON_SERVER_URL`,
`WAITRON_SETUP_URL`, `WAITRON_AGENT_NAME`, `WAITRON_SH_*`, `WAITRON_BOX_*` (test overrides),
`LITESTREAM_BIN`, `WAITRON_REQUIRE_*`, `WAITRON_FULL_DISK_DIR*`, `WAITRON_PREPROD_*`. Rules:
[the slice rules](2026-11-08-a1308-slice-rules.md) ("rules §n"). Part overview: [env1](2026-11-08-a1308-env1-tuning-constants.md).

**Base and cites:** as env1. Cites read at `a086eedfb7`.

**Owner lands:** no (rules §6). The renamed `WAITRON_PREPROD_*` names are inputs to a hand-run
AEAT pre-production test (`apps/server/src/aeat.preprod.test.ts:7-10`); renaming a test's input
changes nothing the box sends. The contact address a box puts in its membership chart keeps its
value, because every box today takes the management origin as its advertised origin (the
variable is set nowhere outside tests, environment.md §3). Read, not run.

**No venue reset.**

## Global Constraints

- An empty value counts as unset (`isUnset`, `apps/server/src/env-value.ts:5-7`); the print agent's
  own `value()` keeps its trim-then-empty rule (`apps/print-agent/src/config.ts:19-23`).
- The print agent imports nothing else from this repository (CLAUDE.md §3); its names stay in its own
  `config.ts`.
- Every workflow change keeps its job's `timeout-minutes` and the bounded-setup shapes (CLAUDE.md §2);
  this plan changes only one step's mount commands and its `env:` block.
- Shipped host paths stay byte-for-byte the same when `WAITRON_TEST_HOST_ROOT` is unset: the prefix
  defaults to the empty string.

## Review Focus

1. `WAITRON_TEST_HOST_ROOT` unset must give exactly today's paths; `deploy-image-env.test.ts`
   extracts the shipped paths from the script text (`:786-795`, `:872-873`), and its regexes must
   still find them.
2. A prefix that is set must reach every one of the nine paths it replaces; a path left un-prefixed
   would make the host-script suites write into the real `/etc` of the machine running them.
   Task 3's sandbox cases fail if any path escapes the sandbox (the stubs log every touched path).
3. The print agent on a separate machine sets `WAITRON_PRINT_AGENT_SERVER_URL` in `.env`; compose
   must pass that same name through (`deploy/compose.yml:124`).
4. The command-line first setup refused without `WAITRON_ADVERTISED_ORIGIN`
   (`packages/provisioning/src/first-setup-command-deployment.ts:165-179`); it must now refuse, with
   the same `setup.not_ready`, without `WAITRON_MANAGEMENT_ORIGIN`.
5. In CI, each full-disk test file must still get its own filesystem, so one file's fill never takes
   another's room (`ci.yml:1304-1330`).

---

## What it builds

| Retired | Kept | How |
| --- | --- | --- |
| `WAITRON_ADVERTISED_ORIGIN` | `WAITRON_MANAGEMENT_ORIGIN` | hand (Task 1) |
| `WAITRON_SERVER_URL`, `WAITRON_SETUP_URL` (print agent) | `WAITRON_PRINT_AGENT_SERVER_URL`, `WAITRON_PRINT_AGENT_SETUP_URL` | script |
| `WAITRON_AGENT_NAME` | (none: the host name) | hand (Task 2) |
| `LITESTREAM_BIN` (bench) | `WAITRON_LITESTREAM_BIN` | script |
| `WAITRON_SH_HEALTH_DELAY`, `WAITRON_SH_MAX_HEALTH_TRIES`, `WAITRON_BOX_READ_SECONDS` | `WAITRON_TEST_HEALTH_DELAY`, `WAITRON_TEST_HEALTH_TRIES`, `WAITRON_TEST_READ_SECONDS` | script |
| `WAITRON_SH_SYSTEMD_DIR`, `WAITRON_SH_BOX_LIB_DIR`, `WAITRON_SH_BOX_UNIT_DIR`, `WAITRON_SH_BLUETOOTH_DROPIN`, `WAITRON_BOX_STATE_DIR`, `WAITRON_BOX_NTP_UNITS_DIRS`, `WAITRON_BOX_UPTIME`, `WAITRON_BOX_TIMESYNC_CLOCK`, `WAITRON_BOX_TIMESYNC_SYNCHRONIZED` | `WAITRON_TEST_HOST_ROOT` | hand (Task 3) |
| `WAITRON_REQUIRE_STREAM_BINARIES`, `WAITRON_REQUIRE_FULL_DISK` | `WAITRON_REQUIRE_TEST_TOOLS` | script |
| `WAITRON_FULL_DISK_DIR`, `…_START_AGAIN`, `…_FROM_SPARE`, `…_BACKUP_ROOM`, `…_HANDOVER`, `…_PLACEMENT`, `…_RESTORE` (seven at this base; the design counted four) | `WAITRON_FULL_DISK_ROOT` + fixed folder names | hand (Task 4) |
| `WAITRON_PREPROD_PFX_BASE64`, `_PFX_PASSPHRASE`, `_NIF`, `_NOMBRE` | `WAITRON_CERT_CHECK_PFX_BASE64`, `_PASSPHRASE`, `_NIF`, `_LEGAL_NAME` | script |

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `WAITRON_TENANT_DOMAIN` → `WAITRON_VENUE_DOMAIN` | the venue-and-box area slice (README §5 U9) |
| `WAITRON_SH_REFRESHED` | kept: it is the downloaded script's own marker, not a test switch (environment.md §3) |
| `WAITRON_TEST_CRASH_AT`, `WAITRON_TEST_TRACE_FILES` and the other test inputs environment.md §3 keeps | kept as they are |
| The one list that declares the surviving names | env7 |

## Interfaces

```ts
// apps/server/src/testing/full-disk.ts
export type FullDiskFolder =
  | "start" | "start-again" | "from-spare" | "backup-room" | "handover" | "placement" | "restore";
/** `$WAITRON_FULL_DISK_ROOT/<folder>` when the root is set; else, on macOS, an hdiutil image of
 * `imageMiB`; else `{ ok: false }` with a reason naming WAITRON_FULL_DISK_ROOT and the folder. */
export function openSmallDisk(
  folder: FullDiskFolder | "test-only",
  imageMiB?: number, // default 32, as today
): { ok: true; disk: SmallDisk } | { ok: false; reason: string };
```

The folder each test file uses: `start-full-disk.e2e.test.ts` → `start`,
`start-again-full-disk.e2e.test.ts` → `start-again`, `start-from-spare.e2e.test.ts` → `from-spare`,
`backup-room.e2e.test.ts` → `backup-room`, `handover-refetch-full-disk.e2e.test.ts` → `handover`,
`handover-placement-full-disk.e2e.test.ts` → `placement`, `restore-full-disk.e2e.test.ts` →
`restore`; `testing/full-disk.test.ts` uses `test-only` (it never mounts anything).

Host scripts: `WAITRON_TEST_HOST_ROOT` (default empty) is put in front of each of these, and nothing
else: `deploy/waitron.sh` `BLUETOOTH_DROPIN` (`:246`), `SYSTEMD_RUN_DIR`, `BOX_LIB_DIR`,
`BOX_UNIT_DIR` (`:341-343`); `deploy/box/waitron-box.sh` `STATE_DIR`, each entry of
`NTP_UNITS_DIRS`, `UPTIME_FILE`, `TIMESYNC_CLOCK`, `TIMESYNC_SYNCHRONIZED` (`:13-17`). Example:
`BOX_LIB_DIR="${WAITRON_TEST_HOST_ROOT:-}/usr/local/lib/waitron"`. The two counts:
`tries="${WAITRON_TEST_HEALTH_TRIES:-36}"`, `delay="${WAITRON_TEST_HEALTH_DELAY:-5}"`
(`waitron.sh:661-662`); `READ_SECONDS="${WAITRON_TEST_READ_SECONDS:-5}"` (`waitron-box.sh:18`).

## Files

- Create: `scripts/a1308/env2-renames.mjs` (Task 0).
- Modify by hand: `apps/server/src/config.ts:102-107,484-485,573-575`; `apps/server/src/boot.ts`
  (`config.advertisedOrigin` at `:1291`, `:1629`, `:1644`, `:1843`, `:2004`, `:2554`, `:3536`);
  `apps/server/src/first-setup-publication.ts:68`;
  `packages/provisioning/src/first-setup-command-deployment.ts:165-179`;
  `apps/print-agent/src/config.ts:5-13,86-92`; `deploy/waitron.sh:243-246,339-343,655-662`;
  `deploy/box/waitron-box.sh:13-18`; `apps/server/src/testing/full-disk.ts:16,137-153`; the seven
  full-disk test files' `openSmallDisk` calls and header comments; `.github/workflows/ci.yml:1304-1345`;
  `scripts/ci-workflow.test.mjs:4056-4090`; `scripts/waitron-sh.test.mjs:425-466,478-492,1243`;
  `scripts/waitron-box-sh.test.mjs:60-125,187,195,355`; `scripts/deploy-image-env.test.ts:786-795,870-880`.
- Tests that set `WAITRON_ADVERTISED_ORIGIN` (Task 1 step 4 lists them).
- Docs: `CLAUDE.md` (§4's "Linux needs `WAITRON_FULL_DISK_DIR`" line, and the renamed
  `WAITRON_SH_HEALTH_DELAY` the script rewrites), `docs/developers/testing-guide.md`,
  `docs/developers/ci-and-gates.md`, `docs/developers/cold-restore-surfaces.md:50`,
  `apps/server/README.md`, `deploy/README.md`, `deploy/.env.example`, `bench/sqlite-failover/README.md:69`.

## Size

Counted, hand-written: about 110 lines of code (origin merge 45, agent name 10, host root 25,
full-disk root 30) and about 260 lines of tests and CI (host-script sandboxes 120, full-disk 60,
origin tests 50, CI and its guard 30), plus about 60 lines of docs. Not counted: the rename script's
output (about 120 lines across 40 files) and pure deletions. About 3 hours.

## Finish line

1. `node scripts/a1308/env2-renames.mjs && git diff --exit-code` (the script is idempotent on its
   own output).
2. `git grep -n -E "WAITRON_(ADVERTISED_ORIGIN|SERVER_URL|SETUP_URL|AGENT_NAME|SH_(HEALTH_DELAY|MAX_HEALTH_TRIES|SYSTEMD_DIR|BOX_LIB_DIR|BOX_UNIT_DIR|BLUETOOTH_DROPIN)|BOX_(STATE_DIR|NTP_UNITS_DIRS|UPTIME|TIMESYNC_CLOCK|TIMESYNC_SYNCHRONIZED|READ_SECONDS)|REQUIRE_(STREAM_BINARIES|FULL_DISK)|FULL_DISK_DIR|PREPROD_)\b" -- . ':!docs/superpowers' ':!scripts/a1308'`
   prints nothing, apart from `apps/print-agent/src/config.test.ts`, whose Task 2 case passes
   `WAITRON_AGENT_NAME` on purpose to prove it is ignored (rerun with `':!apps/print-agent/src/config.test.ts'`
   added and it prints nothing); and `git grep -n -w LITESTREAM_BIN -- bench` prints nothing.
3. `pnpm exec vitest run scripts/waitron-sh.test.mjs scripts/waitron-box-sh.test.mjs scripts/deploy-image-env.test.ts scripts/ci-workflow.test.mjs`
   prints a `Tests` count with no failure.
4. `pnpm --filter @waitron/server exec vitest run src/config.test.ts src/testing/full-disk.test.ts src/allowed-origins.test.ts src/start-peer-check.test.ts src/boot.management-origin.test.ts src/adopt.test.ts`,
   `pnpm --filter @waitron/print-agent exec vitest run src/config.test.ts src/dev.test.ts` and
   `pnpm --filter @waitron/provisioning exec vitest run src/cli-first-setup.test.ts src/cli-owned-entry.test.ts src/cli-same-hour-entry.test.ts src/first-setup-command-import.test.ts`
   each print a `Tests` count with no failure.
5. On macOS, `pnpm --filter @waitron/server exec vitest run src/start-full-disk.e2e.test.ts`
   still attaches its own image (unset root) and passes; CI's stream job runs all seven on Linux.

## Expected protection-list difference

EQUAL. Any line is a stop.

## Stop points (beyond rules §5)

1. A host-script case finds a path the sandbox did not create under the root (the script touched the
   real filesystem path): stop, do not widen the stubs.
2. The command-line first setup is reached by a flow that sets the advertised origin but not the
   management origin (`git grep -n WAITRON_ADVERTISED_ORIGIN -- deploy scripts ~/workspace/tools`
   prints a line outside this repository's tests): stop and ask.

---

### Task 0: the rename script

**Files:** Create `scripts/a1308/env2-renames.mjs`.

- [ ] **Step 0:** record the base protection list (rules §3).
- [ ] **Step 1: Write the script.** It walks `git ls-files` except `docs/superpowers/**` and
  `scripts/a1308/**`, and in each text file replaces whole words (`(?<![A-Z0-9_])NAME(?![A-Z0-9_])`)
  by this table, in this order:
  `WAITRON_SERVER_URL→WAITRON_PRINT_AGENT_SERVER_URL`, `WAITRON_SETUP_URL→WAITRON_PRINT_AGENT_SETUP_URL`,
  `WAITRON_SH_HEALTH_DELAY→WAITRON_TEST_HEALTH_DELAY`, `WAITRON_SH_MAX_HEALTH_TRIES→WAITRON_TEST_HEALTH_TRIES`,
  `WAITRON_BOX_READ_SECONDS→WAITRON_TEST_READ_SECONDS`,
  `WAITRON_REQUIRE_STREAM_BINARIES→WAITRON_REQUIRE_TEST_TOOLS`, `WAITRON_REQUIRE_FULL_DISK→WAITRON_REQUIRE_TEST_TOOLS`,
  `WAITRON_PREPROD_PFX_BASE64→WAITRON_CERT_CHECK_PFX_BASE64`, `WAITRON_PREPROD_PFX_PASSPHRASE→WAITRON_CERT_CHECK_PASSPHRASE`,
  `WAITRON_PREPROD_NIF→WAITRON_CERT_CHECK_NIF`, `WAITRON_PREPROD_NOMBRE→WAITRON_CERT_CHECK_LEGAL_NAME`;
  and, in files under `bench/` only, `LITESTREAM_BIN→WAITRON_LITESTREAM_BIN`. The look-behind keeps
  `WAITRON_PRINT_AGENT_SERVER_URL` and `WAITRON_LITESTREAM_BIN` from matching, which makes a second
  run change nothing. It prints the files it changed.
- [ ] **Step 2: Run it** and then `pnpm exec prettier --write` on the changed files that prettier
  does not ignore. One collision to fix by hand afterwards and list in the pull request:
  `deploy/compose.yml:124` becomes `WAITRON_PRINT_AGENT_SERVER_URL: ${WAITRON_PRINT_AGENT_SERVER_URL:-https://127.0.0.1}`,
  which is right; check `:126` reads the same way for the setup address.
- [ ] **Step 3: Commit** the script and its output together:
  `git commit -s -m "Rename duplicate environment names by script (A1308 env2)"`.

### Task 1: the management origin is the one public address

**Files:** `config.ts`, `boot.ts`, `first-setup-publication.ts`,
`packages/provisioning/src/first-setup-command-deployment.ts`, tests.

- [ ] **Step 1: Failing cases.** `config.test.ts`: `"advertises the management origin"` —
  `loadConfig({ …minimal, WAITRON_MANAGEMENT_ORIGIN: "https://box.example:3443" }, …)` has no
  `advertisedOrigin` key (`expect("advertisedOrigin" in cfg).toBe(false)`). In
  `cli-first-setup.test.ts`, the existing refusal case that omits the advertised origin is re-pointed
  to omit `WAITRON_MANAGEMENT_ORIGIN` and still expects `setup.not_ready`; the success fixtures
  (`:540`, `:644`, `:686`) pass the origin as `WAITRON_MANAGEMENT_ORIGIN`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** Delete `advertisedOrigin` from `ServerConfig` and `loadConfig`. In
  `boot.ts` and `first-setup-publication.ts:68` pass `config.managementOrigin` wherever
  `config.advertisedOrigin` was passed; the parameter names of the functions receiving it
  (`adopt.ts:79`, `allowed-origins.ts:6`, `handover-source-start-api.ts:61`,
  `start-peer-check.ts:152`) stay as they are: they name the role, not the variable. In
  `first-setup-command-deployment.ts:167`, read `environment.WAITRON_MANAGEMENT_ORIGIN`; the checks
  after it stay.
- [ ] **Step 4: Re-point the tests.** `git grep -l WAITRON_ADVERTISED_ORIGIN -- '*.test.ts'` lists
  them (9 at `a086eedfb7`; the provisioning tests name it in four of them). A test that sets both names to the same value drops the advertised one; a
  test that sets them to different values to prove the advertised one wins (`config.test.ts`,
  `allowed-origins.test.ts`, `boot.management-origin.test.ts`) tested the retired variable: delete
  that case and name it in the pull request. A case that needs a different contact address for a
  second box sets that box's `WAITRON_MANAGEMENT_ORIGIN`.
- [ ] **Step 5: Run** finish line 4's server and provisioning commands; pass.
- [ ] **Step 6: Docs.** `deploy/compose.yml:26` comment ("advertisedOrigin defaults to it") says the
  origin is also what every till is handed, with no second name; `docs/developers/cold-restore-surfaces.md:50`
  drops the fallback sentence; `apps/server/README.md`'s row goes.
- [ ] **Step 7: Commit:** `git commit -s -m "The management origin is the box's one public address (A1308 env2)"`

### Task 2: the print agent's name is the host name

**Files:** `apps/print-agent/src/config.ts`, `config.test.ts`, `dev.test.ts`.

- [ ] **Step 1: Failing case** `"names the agent after its host"`: `readEnv({}, "kitchen-pi").name === "kitchen-pi"`,
  and `readEnv({ WAITRON_AGENT_NAME: "Bar" }, "kitchen-pi").name === "kitchen-pi"` (the retired name
  is ignored). Delete the assertions that a set `WAITRON_AGENT_NAME` wins (`config.test.ts:89`,
  `:99`, `:108`; `dev.test.ts:80`), naming them in the pull request.
- [ ] **Step 2: Run; the second assertion fails.**
- [ ] **Step 3:** `name: hostname` (`config.ts:88`); `EnvConfig.name` becomes `name: string` with no
  comment about falling back.
- [ ] **Step 4: Run** finish line 4's print-agent command; pass. **Step 5: Commit.**

### Task 3: one host root for the host scripts' test sandboxes

**Files:** `deploy/waitron.sh`, `deploy/box/waitron-box.sh`, the two suites, `deploy-image-env.test.ts`.

- [ ] **Step 1: Change the sandboxes first.** `waitron-sh.test.mjs`'s sandbox (`:425-466`) sets
  `WAITRON_TEST_HOST_ROOT: root` and creates the shipped paths under it
  (`root/etc/systemd/system/bluetooth.service.d/`, `root/run/systemd/system/`,
  `root/usr/local/lib/waitron/`, `root/etc/systemd/system/`); `dropIn` becomes
  `join(root, "etc/systemd/system/bluetooth.service.d/waitron-noautopair.conf")`, and the stub at
  `:280` and the retry case at `:1243` read it from there. `waitron-box-sh.test.mjs`'s sandbox
  (`:100-125`) sets `WAITRON_TEST_HOST_ROOT: dir` and writes `dir/proc/uptime`,
  `dir/var/lib/systemd/timesync/clock`, `dir/run/systemd/timesync/synchronized`,
  `dir/etc/systemd/ntp-units.d/50-chrony.list`, and makes `dir/run/waitron-box-state`; the cases at
  `:187`, `:195`, `:355` and the stub at `:67`, `:82` use those paths (expose them on `sb` as
  `sb.paths.uptime` etc. rather than through env).
- [ ] **Step 2: Run both suites; they fail** (the scripts still read the old names and write to the
  real paths' stand-ins nowhere). Do not run this step as root.
- [ ] **Step 3: Change the scripts** per **Interfaces**, and replace the comments at
  `waitron.sh:243-245`, `:339-340` and `:655-660` with one line each saying the prefix is a test
  folder and empty on a box.
- [ ] **Step 4:** `deploy-image-env.test.ts:786-787` match `WAITRON_TEST_HEALTH_TRIES:-36}` and
  `WAITRON_TEST_HEALTH_DELAY:-5}`; `:794` matches `${WAITRON_TEST_HOST_ROOT:-}/etc/systemd/system/bluetooth.service.d/waitron-noautopair.conf`;
  `:872-873` extract `BOX_LIB_DIR="\$\{WAITRON_TEST_HOST_ROOT:-\}([^"]+)"` and the unit dir likewise;
  `waitron-sh.test.mjs:1536`'s shipped-tries regex reads `WAITRON_TEST_HEALTH_TRIES:-(\d+)`.
- [ ] **Step 5: Run** finish line 3; pass. **Step 6:** CLAUDE.md §4's "Cut the wait
  (`WAITRON_SH_HEALTH_DELAY`)" now reads `WAITRON_TEST_HEALTH_DELAY` (the script did this; check it).
  **Step 7: Commit.**

### Task 4: one root for the full-disk filesystems

**Files:** `apps/server/src/testing/full-disk.ts`, its test, the seven e2e files, `ci.yml`,
`ci-workflow.test.mjs`, `CLAUDE.md`, `testing-guide.md`.

- [ ] **Step 1: Failing cases** in `testing/full-disk.test.ts` (replace the variable-named ones):
  `"a root over a large filesystem is refused, naming the folder"` — `vi.stubEnv("WAITRON_FULL_DISK_ROOT", tmpdir())`,
  `mkdirSync(join(tmpdir(), "test-only"))`, `openSmallDisk("test-only")` is `ok: false` with a
  reason starting `WAITRON_FULL_DISK_ROOT/test-only (`; `"with no root on Linux there is none"` —
  reason `no small filesystem: set WAITRON_FULL_DISK_ROOT to a folder whose test-only folder is a filesystem of 64 MiB or less`.
- [ ] **Step 2: Run; they fail. Step 3: Implement** `openSmallDisk` per **Interfaces**; the `CI` and
  `WAITRON_REQUIRE_TEST_TOOLS` rule at `:16` is unchanged. Each e2e file calls
  `openSmallDisk("<folder>", <its MiB>)` and its header comment names the folder.
- [ ] **Step 4: CI.** In `ci.yml:1304-1330`, mount each tmpfs at `"$RUNNER_TEMP/full-disk/<folder>"`
  (`mkdir -p` then `sudo mount -t tmpfs -o size=<n>m tmpfs …` then `sudo chown …`, same sizes as
  today: start 32m, start-again 32m, from-spare 48m, backup-room 32m, handover 32m, placement 64m,
  restore 32m), and replace the seven `env:` lines (`:1339-1345`) with
  `WAITRON_FULL_DISK_ROOT: ${{ runner.temp }}/full-disk`. `ci-workflow.test.mjs:4056-4090`'s table
  becomes `[folder, size]` pairs checking the mount at `$RUNNER_TEMP/full-disk/${folder}` and one
  `WAITRON_FULL_DISK_ROOT` line in that step's env.
- [ ] **Step 5: Run** finish lines 3–5. **Step 6: Docs.** CLAUDE.md §4 "Linux needs
  `WAITRON_FULL_DISK_DIR`" → "Linux needs `WAITRON_FULL_DISK_ROOT`, a folder holding one small
  filesystem per test file"; `testing-guide.md`'s full-disk section and `ci-and-gates.md` likewise.
  `pnpm exec prettier --check CLAUDE.md`.
- [ ] **Step 7: Protection list** (rules §3): nothing. **Step 8: Commit**, then `/finish-branch`.

## Waitron Cloud

Nothing to change: Cloud's repository uses none of the retired names (grep at `d4451d227`). It sets
`WAITRON_MANAGEMENT_ORIGIN` and `WAITRON_LITESTREAM_BIN`, which stay.
