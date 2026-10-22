# A947 slice 4a — five-symbol minute names and the clock rule: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"` (medium effort). An implementer past about 150 tool calls with its
> task unfinished stops at a passing (or cleanly red) point, commits, and returns a handover —
> done, left, files, each check's state.

**Goal:** every installation code a box takes — setup, switch, hand-over, restore, re-registration
— is five symbols for the UTC minute; every one of those is taken only after a clock check against a clock on
another machine (box within 30 seconds, ahead or behind, no confirmation); a setup or restore
takes its name 90 to 150 seconds after the check; the "last hour" question, the recovery sheet's
installation code and the restore form's code field go; the setup and restore pages explain every
wait with a countdown. One allocation is outside the clock rule, by name: the test-only
preproduction throwaway (`hour-throwaway-allocation.ts:26-37`, refused outside preproduction at
`:26-30`), which takes the current minute with no clock check and no history; it never names a
real venue's series.

**Revised 2026-10-22** after the fresh plan review
(`~/waitron-campaign/a947-plan4a/plan-review.md`) and the coordinator's rulings
(`~/waitron-campaign/a947-plan4a/rulings.md`): tasks split (3a–3b, 6a–6f, 9a–9b), and new tasks for
the tests' time control (6a, 6d, 6e), the setup password at a wait (6f), the restore's staged
backup (10a) and the measurement before the restore page (10b).

**Architecture:** the change lives in `packages/fiscal-verifactu`'s `hour-*` selection pipeline
(identity → clock comparison → history → selection), plus one fact the server adds — whether the
browser's request came from the box itself — threaded through the module operation contract
(`packages/module`) from three routes in `apps/server`. The setup screens are Lit components in
`packages/fiscal-verifactu/src/setup/`, shown by the setup app and tested in real Chromium.

**Tech stack:** TypeScript (tsc 7 in packages), Vitest 4.1.11 (node project and real-Chromium
browser project in `packages/fiscal-verifactu`; browser mode in `apps/setup`), Lit, Hono on
`@hono/node-server`, `node:sqlite` through `@waitron/db`.

**Spec:** [`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md`](../specs/2026-10-21-a947-two-box-failover-design.md)
— §6.5 (minute names, rules 1–5, the clock check, "Every wait explains itself"), §6.7 (the sheet,
the old-backup cases, the setup and restore floor), §11 slice 4a (the inventory), §13. Approved
by the owner 2026-10-22 ~02:40 (main `e032e2dd0`); amended 2026-10-22 for the owner's ~03:12
direction (this branch's first commit).

**Fiscal. The owner lands it.** Risk trigger: fiscal invariants — the full review path: per-task
reviews, then the full `/finish-branch` wave with the Codex run-it seat run twice (second angle).

## Global constraints

- **Pre-live, no compatibility** (CLAUDE.md §3, "No backwards-compatibility or data-migration code
  until Waitron is in production"): nothing reads or makes a four-symbol code. Development and demo
  boxes holding four-symbol names are reset (`wa-wt reset demo <name>`), not migrated.
- **No migration, and no shipped migration file is touched.** Receipt: the only check on the stored
  installation number is `length(numero_instalacion) between 1 and 30`
  (`packages/fiscal-verifactu/src/schema/sif.ts:37`; generated as
  `drizzle/0006_numerous_roughhouse.sql:50`), and `invoice_series.code` checks only `<> ''`
  (`packages/db/src/schema/series.ts:45`); read on this branch's base `c1d0eca81`. If any task finds
  it must touch a file under any `drizzle/` directory, STOP and report: the PR's first line would
  then have to say it ships only with a venue reset (CLAUDE.md §3), and the owner has not been
  asked for that.
- **Untouched:** `computeHuella` (`@waitron/verifactu`), `Encadenamiento`
  (`packages/fiscal-verifactu/src/chain.ts`), `registerSif`
  (`packages/fiscal-verifactu/src/registro-sif.ts`), `restoreFiscal`
  (`packages/fiscal-verifactu/src/restore.ts`), `activateAllocation` and the activation transaction
  (`packages/fiscal-verifactu/src/allocation.ts:129-460`), and invoice numbering inside a series
  (`recordSale`, `@waitron/core`). Task 14 checks `git diff --stat` on these is empty.
- **The fiscal gates pass UNEDITED:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project node src/write-path.e2e.test.ts src/inmutabilidad.test.ts`. Neither imports the hour
  code (their fixtures use series `A` and installation number `"1"`,
  `packages/fiscal-verifactu/test/fixtures.ts:64,87`); run on the base 2026-10-22: `Test Files 2
  passed (2)`, `Tests 20 passed (20)`. If a task makes either fail, STOP and report the assertion —
  never edit either file.
- **Constants**, from the spec, exactly: epoch `2026-01-01T00:00:00.000Z`; alphabet
  `0123456789ABCDEFGHJKMNPQRSTVWXYZ`; five symbols, most-significant first; `MINUTE_MS = 60_000`;
  `MINUTE_COUNT = 32 ** 5` (last minute begins `2089-10-18T16:31:00.000Z`); clock threshold
  `30_000` ms measured from the box reading to each other usable reading's middle, inclusive (30 000
  passes, 30 001 refuses); same-minute wait bound `150_000` ms (at most 150 000 ahead waits, more
  refuses); setup and restore wait: target = `(Math.floor((checkedBoxMs + 90_000) / 60_000) + 1) *
  60_000` (90 to 150 seconds after the check — the formula the sweep measured,
  `~/waitron-campaign/a947r2-probes/restore-wait-sweep.mjs`, `mR = floor((b0 + wait) / 60) + 1`).
- **Error code:** every refusal stays `sif.allocation_invalid` with a `reason`
  (`packages/fiscal-verifactu/src/errors.ts:66`). Reasons this slice adds: `second_clock_missing`,
  `clock_disagreement`, `minute_not_later` (replaces `hour_not_later`; carries `allowedFromMs` when
  a later time would be allowed). Reasons it retires: `hour_not_later`,
  `installation_codes_invalid`, `clock_confirmation_required`. No new error code, so no new
  registry entry and no alert wording.
- **Product text** is the spec's, verbatim (§6.5 table, "Every wait explains itself"), English and
  Spanish, concise. Spanish is allowed here: `packages/fiscal-verifactu` is the Spain package
  (CLAUDE.md §3).
- **Names in code:** the identity functions are renamed to what they now encode
  (`encodeMinuteIdentity`, `decodeMinuteIdentity`, `isMinuteIdentity`, `isMinuteAllocatedSeries`)
  and `greatestSpentHour` becomes `greatestSpentMinute`. File names (`hour-*.ts`), the stored
  allocation `source: "hour"` and the authority `kind: "hour"` stay: renaming them touches stored
  allocation JSON and dozens of files for no behaviour; a backlog line records the rename for later
  (Driver steps).
- Every commit `git commit -s`. Run focused tests only; CI owns the package suites (CLAUDE.md §2).
  Unset `AI_AGENT` and `CLAUDECODE` when reading a passing test's console (`env -u AI_AGENT -u
  CLAUDECODE`). Read the `Tests` count, never an exit status alone.
- **The stream loop test gains no step in this slice** (design §11's preamble asks each slice to
  add one): it allocates through paper fixtures (`apps/server/src/testing/stream-loop-scenario.ts:470`)
  and slice 4a changes nothing that streams. Recorded as a decision (Driver steps).
- **No test-time setting is reachable from the environment.** The wait is a fiscal safety wait;
  tests control time only through Task 6a's injected clock, which production never sets.
- Browser suites run in real Chromium: check `memory_pressure | grep free` first and run beside
  another session's browser run only when free memory is well above 15%.

## Review focus

1. **A browser request that reaches the box through an address the box holds on a Docker bridge
   or over IPv6** (`::ffff:192.168.10.20`, `fe80::…%eth0`, `172.17.0.1`) — expected: it counts as the
   box itself. Pinned in Task 5's address cases.
2. **A page left open past the server's 30-second clock reading** (`clock_stale`,
   `hour-setup-clock.ts:67`) during the 90–150 s wait — expected: at zero the page compares the
   clocks afresh before asking for the name, never re-sends the old reading. Pinned in Tasks 10 and 11.
3. **A box restarted during the 90–150 s wait** — expected: the persisted wait's target holds, and
   the restarted box neither takes the name early nor starts a new 90 s. Pinned in Task 6b
   ("a restart keeps the recorded target").
4. **The no-second-clock page left open when the internet comes back** — expected: within 15
   seconds it carries on by itself, without another press. Pinned in Tasks 10 and 11.
5. **A clock exactly 30 s off, and a known later minute exactly 150 s ahead** — expected: both
   pass (inclusive bounds), 1 ms more refuses. Pinned in Tasks 4 and 6b.

Also pinned, from the review: a waiting answer never asks the owner's password again (Task 6f); a
recorded wait reused long after it ended starts a new 90 s (Task 6b); two pages open on one setup
or restore keep their own clock readings (Task 4); a reload in the middle of a wait shows the
server's time left, with no new 90 s (Task 10); an offline restore from a backup file keeps its
browser reading inside the 5-second window (Tasks 10a and 10b).

---

## Inventory check against the base

§11's inventory was read at `dad6caf1c`. `git diff --stat dad6caf1c c1d0eca81` over every file it
names (the `hour-*` files, `allocation-envelope.ts`, `backup-verification*.ts`,
`initial-hour-setup.ts`, `recovery-document.ts`, `recovery-pdf-content.ts`,
`completed-recovery-document.ts`, `reported-hour-codes.ts`, `hosted-hour-recovery.ts`, the two setup
screens, the test harnesses, `receipt-document.ts`, `layout.ts`, `docs/operations/`, `CLAUDE.md`,
`recovery-preparation.ts`, `deploy/compose.yml`) printed nothing, and 25 of its lines were re-read
by `sed -n` and match. Additions the inventory did not list, found by `git grep` on the base:

- the screens' own code checks `/^[0-9A-HJKMNP-TV-Z]{4}$/` at `setup/first-hour.ts:302` and
  `setup/recovery-hour.ts:304`;
- `docs/operations/first-live-fiscal-setup.md:4` ("selects a four-character code from a UTC hour")
  and `docs/operations/hour-recovery.md:18-23` ("Select the new hour"; "Yes or an unknown answer
  waits for the next UTC hour");
- the command-line setup's clock review and confirmation prompt, `initial-hour-setup.ts:83-111`;
- the assignment position `decodeHourIdentity(...)` at `initial-hour-setup.ts:331` counts minutes
  after this slice (its namespace string `"hour"` at `:315-318,330` stays — see Global
  constraints);
- the three routes that carry a browser clock sample: `apps/server/src/setup-first-fiscal-api.ts:455`
  (`/setup-api/first-setup/preparation`), `apps/server/src/setup-recovery-preparation-api.ts:113`
  (`/setup-api/recovery/preparation`) and `apps/server/src/promote-api.ts:74`
  (`/management-api/promote/preparation`).

## Where this slice touches invoice-number or series allocation, and what pins it

| Place | What changes | Pinned by |
| --- | --- | --- |
| `hour-selection.ts:438-533` — the chosen installation code (`identity: encodeHourIdentity(now)`, `:528`) | minute code, rules 1–5, the setup/restore wait | Task 6b's rule tests; Task 8's `minute-selection-unknown-name.test.ts` |
| `hour-preparation.ts:38-67` — series `${code}-${identity}` from the selection | the identity is five symbols; nothing else | `hour-preparation.test.ts`, `hour-activation.test.ts` (literals updated in Task 1–2) |
| `allocation-envelope.ts:195-197,427-453` — an hour allocation must equal `encode(issuedAt)` | minute encode | `hour-activation.test.ts`, `hour-standby-activation.test.ts` |
| `initial-hour-setup.ts:45-81` — `readHourSetupInput` re-derives the code from `issuedAt` | minute encode | `initial-hour-setup.test.ts` |
| `hour-throwaway-allocation.ts:34` — a preproduction throwaway name | minute encode | `hour-throwaway-allocation.test.ts` |
| `backup-verification-history.ts:227`, `backup-verification.ts:133` — a backup's allocation re-derived; a non-code row is "unsupported" | minute code | `backup-verification*.test.ts`; `apps/server/src/testing/backup-verification-fixture.ts:123,126,313` |
| `allocation.ts:434-460` — activation writes `registro_sif` and `invoice_series` | **nothing** | unchanged; Task 14's empty diff |
| `recordSale` numbering inside a series | **nothing** | `write-path.e2e.test.ts`, unedited |

---

## Task 1: The five-symbol minute code in `fiscal-verifactu`'s source

**Files:**
- Modify: `packages/fiscal-verifactu/src/hour-identity.ts:3-41` (whole module)
- Modify (renames and constants, every source caller): `hour-clock.ts:37-39`,
  `hour-selection.ts:14-19,70-72,99-101,148-153,464-467,528`, `hour-history.ts:3,11,78,100-101`,
  `hour-history-reader.ts:8,23-26`, `hour-dormant-standby.ts:75-79`,
  `allocation-envelope.ts:10,196,448,532`, `backup-verification-history.ts:227,302,341`,
  `backup-verification.ts:133`, `initial-hour-setup.ts:10,53,64,331`,
  `hour-throwaway-allocation.ts:34`, `reported-hour-codes.ts:2,13` (deleted in Task 9b),
  `recovery-document.ts:65` (field deleted in Task 9a), `setup/first-hour.ts:302`,
  `setup/recovery-hour.ts:304` (`{4}` → `{5}`); `git grep -n -E
  "HourIdentity|HourAllocatedSeries|greatestSpentHour|-0000|\"0000\"" -- packages/fiscal-verifactu/src
  ':!*.test.ts'` lists the rest and must print nothing at the end
- Test: `packages/fiscal-verifactu/src/hour-identity.test.ts`, `hour-history.test.ts`,
  `hour-history-reader.test.ts`

**Interfaces — produces:**
`encodeMinuteIdentity(instantMs: number): string` (throws `RangeError("Invalid minute instant")`
outside `[EPOCH_MS, EPOCH_MS + 32 ** 5 * 60_000)`), `decodeMinuteIdentity(identity: string):
number` (minutes since the epoch), `isMinuteIdentity(value: unknown): value is string` (exactly
five of the alphabet), `isMinuteAllocatedSeries(value, identity, bases): boolean`, and
`HourHistory.greatestSpentMinute: number | null`. The placeholder that checks bases becomes
`-00000` / `"00000"`.

- [ ] **Step 1: Write the failing tests** in `hour-identity.test.ts` (replace the four-symbol
  cases):
  - `encodeMinuteIdentity` of `2026-10-16T11:40:00Z`, `2026-10-23T19:40:50Z`, `2026-10-23T19:55:50Z`,
    `2026-10-23T19:56:00Z`, `2026-10-24T09:02:00Z` equals `0CNNW`, `0CZZW`, `0D00B`, `0D00C`,
    `0D0RY` (the spec's script, §6.5); the epoch is `00000`; `2089-10-18T16:31:00.000Z` is `ZZZZZ`;
    one millisecond before the epoch and `2089-10-18T16:32:00.000Z` throw.
  - `decodeMinuteIdentity("0CZZW")` equals `Math.floor((Date.parse("2026-10-23T19:40:50Z") -
    Date.parse("2026-01-01T00:00:00Z")) / 60_000)`; round trip for 1 000 random instants in range.
  - `isMinuteIdentity`: true for `0CZZW`; false for `06XV` (four), `0CZZWX` (six), `0CZZI`,
    `0CZZL`, `0CZZO`, `0CZZU` (letters outside the alphabet), lower case `0czzw`, a number.
  - `isMinuteAllocatedSeries([{ code: "A-0CZZW", purpose: "standard" }], "0CZZW", [{ code: "A",
    purpose: "standard" }])` is true; with a hyphenated and slashed prefix `"F/2.x-y"` →
    `"F/2.x-y-0CZZW"` true; the retired forms `S000001` and `E` + 26 symbols false; `A-06XV` false.
  - `hour-history.test.ts`: a history whose rows carry `0CNNW` and `0CZZW` yields
    `greatestSpentMinute === decodeMinuteIdentity("0CZZW")`; a row carrying `06XV` is
    `invalid_record`.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project node src/hour-identity.test.ts src/hour-history.test.ts` — expected: failures naming
  `encodeMinuteIdentity is not a function` (import errors count as the failing run).
- [ ] **Step 3: Implement**: the module as in Interfaces (loop to 5 digits, `MINUTE_MS`,
  `MINUTE_COUNT`); rename every source caller; `HOUR_MS`/`END_MS` in `hour-clock.ts:37-39` and
  `hour-selection.ts:70-72` become `MINUTE_MS = 60_000` / `END_MS = EPOCH_MS + 32 ** 5 *
  MINUTE_MS` (the hour-boundary uses of `HOUR_MS` stay until Tasks 4 and 6b delete them — keep a
  local `HOUR_MS` there meanwhile).
- [ ] **Step 4: Run the identity and history tests** (Step 2's command) — PASS, and
  `pnpm --filter @waitron/fiscal-verifactu typecheck` exits 0.
- [ ] **Step 5: Commit** — `fiscal: installation codes are five symbols for the UTC minute`. The
  package's other suites are red until Task 2 (literals); say so in the commit body.

## Task 2: `fiscal-verifactu`'s tests use minute codes

**Files:** every `packages/fiscal-verifactu/src/**/*.test.ts` that fails after Task 1 — start from
`git grep -l -E "\"0[6-9A-D][0-9A-HJKMNP-TV-Z]{2}\"|-0[6-9A-D][0-9A-HJKMNP-TV-Z]{2}[\"/\`]" --
packages/fiscal-verifactu` (33 files on the base, some false hits) — and
`packages/fiscal-verifactu/test/*.ts`.

**Interfaces — consumes:** Task 1's names.

- [ ] **Step 1: Run the node project and list the failures:** `pnpm --filter
  @waitron/fiscal-verifactu exec vitest run --project node` — expected: failures in the hour tests
  only (identity literals, `"0000"` placeholders, `greatestSpentHour`).
- [ ] **Step 2: For each failure, recompute the literal from the instant the test pairs it with**,
  with `node -e 'const E=Date.parse("2026-01-01T00:00:00Z"),A="0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let m=Math.floor((Date.parse(process.argv[1])-E)/60000),s="";for(let i=0;i<5;i++){s=A[m%32]+s;
  m=Math.floor(m/32)}console.log(s)' 2026-10-16T11:40:00Z` (prints `0CNNW`). Change a literal only
  where the code it is compared with is derived from a time; a behavioural assertion (refused,
  waited, selected, which reason) is not changed here — the ones the design changes are Tasks 4, 6b–6f
  and 9a–9b's, listed under "Changed test checks". A test whose only purpose was "four symbols" is
  rewritten to five, not deleted.
- [ ] **Step 3: Run the node project again.** Task 1 DOES change behaviour in one respect: the
  "strictly later" comparison (`hour-selection.ts:464-467`) now counts minutes, so a case that
  expects `hour_not_later` for a later minute inside the same hour now selects, and a next-hour
  wait (target set at `:498`) produces a different code. Those cases are NOT edited here: leave
  them failing, list each (file and test name) in the commit body, and Task 6b owns them. Every
  other case passes. Then the browser project for the two screens' regex: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser
  src/setup/first-hour.browser.test.ts src/setup/recovery-hour.browser.test.ts` — PASS.
- [ ] **Step 4: The fiscal gates, unedited:** the Global constraints command — `Tests 20 passed`.
- [ ] **Step 5: Commit** — `test(fiscal): minute codes in fiscal-verifactu's tests` (cleanly red
  in the listed cases only).

## Task 3a: `apps/server`'s setup tests and harnesses use minute codes

**Files:** `apps/server/src/testing/backup-verification-fixture.ts:123,126,313`,
`apps/server/src/testing/allocated-provision.ts`, `apps/server/test/hour-first-fiscal.ts`,
`owned-hour-setup.ts`; the failing files among `apps/server/src/first-fiscal-*.test.ts`,
`first-setup-*.test.ts`, `setup-first-fiscal*.test.ts`, `fiscal-readiness-first-setup.test.ts`,
`boot*.test.ts`, `provision.test.ts`, `demo-seed.db.test.ts`, `module-operation-host.test.ts`,
`backup-verification*.test.ts`.

- [ ] **Step 1: Run and list failures:** `pnpm --filter @waitron/server exec vitest run first-fiscal
  first-setup setup-first-fiscal fiscal-readiness boot provision demo-seed module-operation-host
  backup-verification` — expected: failures on four-symbol literals, and Task 2's named minute-vs-hour
  cases. (A name-filtered run proves only the files it loads — CLAUDE.md §2; CI runs the rest.)
- [ ] **Step 2: Recompute each literal** as in Task 2, Step 2; `backup-verification-fixture.ts:313`
  keeps its "4 hours before" instant and encodes it as a minute. Behavioural failures are listed in
  the commit body for Tasks 6b–6e, not edited.
- [ ] **Step 3: Re-run Step 1** — PASS except the listed cases. **Step 4: Commit** — `test(server):
  minute codes in the setup tests`.

## Task 3b: the remaining server tests, provisioning, composition and the setup app use minute codes

**Files:** `apps/server/src/testing/staged-hour-crash.ts`, `staged-hour-restore.ts`,
`apps/server/test/hour-recovery-host.ts`, `hour-recovery-delivery.ts`; the failing files among
`apps/server/src/hour-*.test.ts`, `restore-*.test.ts`, `recovery-document-evidence.test.ts`,
`cloud-fiscal-allocation.test.ts`, `till-api.receipt.test.ts`; `packages/provisioning/src/**`
(13 files match the literal grep on the base), `packages/composition/src/allocation-configuration.test.ts`,
`apps/setup/src/**` (4).

- [ ] **Step 1: Run and list failures:** `pnpm --filter @waitron/server exec vitest run hour restore
  recovery-document cloud-fiscal till-api.receipt`, `pnpm --filter @waitron/provisioning exec vitest
  run`, `pnpm --filter @waitron/composition exec vitest run src/allocation-configuration.test.ts`,
  `pnpm --filter @waitron/setup exec vitest run src/screens/initial-setup-hour.test.ts
  src/screens/recovery-hour.test.ts` — expected: literal failures and the named cases.
- [ ] **Step 2–3:** as Task 3a. **Step 4: Commit** — `test: minute codes in the restore,
  provisioning and setup tests`.

## Task 4: The clock rule — a second clock always, 30 seconds either way, no confirmation

**Files:**
- Modify: `packages/fiscal-verifactu/src/hour-clock.ts:25-33,111-159`;
  `hour-setup-clock.ts:80-148` (the `compare` signature; `read` loses `confirmationId`);
  `hosted-hour-recovery.ts:34,53,105,114-123,142` (the `confirm-clock` branch and `confirmed` map
  go); `hour-preparation.ts:200-207` (`confirmClock` goes); `initial-hour-setup.ts:83-111,221-226`
  (`reviewCommandClock` loses its prompt; the `confirm-clock` proposal is refused);
  `hour-selection.ts:26-27,36,427` (`confirmation` goes; `canSelectHour(decision)` takes one
  argument); `errors.ts:66` (`{ reason: string; allowedFromMs?: number }`)
- Test: `hour-clock.test.ts`, `hour-setup-clock.test.ts`, `hosted-hour-recovery.test.ts`,
  `initial-hour-setup.test.ts`

**Interfaces — produces:**

```ts
export interface HourClockDecision {
  readonly usable: readonly { source: HourClockSource; lowerMs: number; upperMs: number }[];
  readonly unavailable: readonly Extract<HourClockObservation, { result: "unavailable" }>[];
  readonly secondClock: boolean;   // a usable browser or internet reading exists
  readonly disagreement: boolean;  // some usable non-box reading's middle is > 30_000 from the box
  readonly releaseBlocked: boolean;
  readonly rangeBlocked: boolean;
}
export function canSelectHour(decision: HourClockDecision): boolean;
// refusal reason when false: clockRefusal(decision): "second_clock_missing" | "clock_disagreement" | "clock_unconfirmed"
export function clockRefusal(decision: HourClockDecision): string;
// hour-setup-clock.ts
compare(key: string, environment: DeploymentEnvironment, browser: SetupBrowserClockSample | null,
        client: { readonly onBox: boolean }): Promise<{ id: string; clock: HourClockDecision }>;
read(key: string, comparisonId: string): { clock: HourClockDecision };
```

**Two pages, two readings.** Today one clock session per operation (`contextKey`) holds one
challenge and one reading, and each `challenge()` or `compare()` clears the other page's
(`hour-setup-clock.ts:39-49,73-79,89`). After this task the session keeps, per `contextKey`, up to
8 challenges keyed by challenge id and up to 8 readings keyed by comparison id (oldest evicted);
`compare` consumes only its own challenge; the select carries the page's own `comparisonId`
(setup: `candidates({ comparisonId })`; restore and promote: `{ action: "select", comparisonId }`)
and `read(key, comparisonId)` uses that reading, still refusing `clock_stale` past 30 s. The
selection's `read(binding)` option becomes `read(binding, comparisonId)` (`hour-selection.ts:272`,
`hosted-hour-recovery.ts:51-60`, `hour-preparation.ts:159-170`).

A browser sample whose `client.onBox` is true is recorded as `{ source: "browser", result:
"unavailable", reason: "same_machine" }` — before any comparison, whatever its reading.
`clockRefusal` order: release or range blocked → `clock_unconfirmed` (today's reason for those,
kept); no second clock → `second_clock_missing`; disagreement → `clock_disagreement`.
`requiresConfirmation`, `boundaryWait`, `confirmHourClock` and the `confirmations` map are deleted.

- [ ] **Step 1: Write the failing tests** (`hour-clock.test.ts`, exact readings, box at `T =
  Date.parse("2026-10-24T09:00:00Z")`):
  - browser at `T + 30_000` → `canSelectHour` true; at `T + 30_001` → false, `clockRefusal` is
    `clock_disagreement`; the same at `T - 30_000` / `T - 30_001` (behind and ahead are alike);
  - a browser reading with 2 500 ms uncertainty whose middle is `T + 29_000` passes (the rule reads
    the middle, not the range's edge — the spec's "the middle of its range");
  - internet `T + 31_000` and browser `T`: refused `clock_disagreement` (every other clock, not any);
  - only the box usable → `secondClock` false, `second_clock_missing`;
  - box `T - 4 days`, browser `T` → `clock_disagreement` (case B2's clock);
  - readings 2 ms apart across 10:00:00 UTC → selectable (the hour-boundary wait is gone);
  - release after the box reading → `clock_unconfirmed`, as today.
  - `hour-setup-clock.test.ts`: `compare(key, env, sample, { onBox: true })` with a perfect browser
    sample and the internet unavailable → `secondClock` false and the browser's unavailable reason
    is `same_machine`; the same sample with `{ onBox: false }` → `secondClock` true (control).
  - "two pages keep their own readings" (`hour-setup-clock.test.ts`): page B (`onBox: false`)
    takes a challenge, page A (`onBox: true`) takes one, B compares, A compares, A takes another
    challenge (its 15-second re-check); `read(key, B's comparison id)` still has `secondClock`
    true, and `read(key, A's)` has it false.
  - `hosted-hour-recovery.test.ts`: a `{ action: "confirm-clock", comparisonId }` proposal is refused
    `event_mismatch`; `initial-hour-setup.test.ts`: the same through `preparation` is refused
    `malformed_allocation`, and the terminal command with only the box's clock prints the why line
    `No series is made without a confirmed time, so none is ever repeated.` and `Connect the box
    to the internet, or set up from a phone or laptop on the venue's network.` and returns
    `{ status: "cancelled" }` without calling `actions.prompt`.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project node src/hour-clock.test.ts src/hour-setup-clock.test.ts src/hosted-hour-recovery.test.ts
  src/initial-hour-setup.test.ts` — expected: the new cases fail (e.g. `expected true to be false`
  at 30 001, because today's threshold is 120 000, `hour-clock.ts:114`).
- [ ] **Step 3: Implement** the Interfaces. Callers that pass `client`: `hosted-hour-recovery.ts`
  and `hour-preparation.ts` take it from their proposal handler's new third argument (Task 5);
  until Task 5 lands, both pass `{ onBox: true }` (fail closed). `resume` paths that compare with
  `browser: null` (`hosted-hour-recovery.ts:143`, `initial-hour-setup.ts:145`) keep doing so: a
  resumed selection with no internet now refuses `second_clock_missing` until a page supplies a
  browser reading — stated in the commit body.
- [ ] **Step 4: Mutation by hand** (no mutation config covers this package — see "Mutation"
  below): change `30_000` to `31_000`, run Step 2's command, see the `T + 30_001` case fail;
  delete the `secondClock` term from `canSelectHour`, see the box-only case fail; restore both.
  Record the two runs in the commit body.
- [ ] **Step 5: Run Step 2's command** — PASS; typecheck exits 0.
- [ ] **Step 6: Commit** — `fiscal: every name needs a second clock within 30 seconds, with no
  confirmation`.

## Task 5: The server tells the module whether the browser is the box itself

**Files:**
- Create: `apps/server/src/request-from-box.ts`, `apps/server/src/request-from-box.test.ts`
- Modify: `packages/module/src/operation-preparation.ts:93-96` (`recovery` gains `client`),
  `packages/module/src/initial-setup.ts:85` (`preparation` gains `client`),
  `packages/provisioning/src/first-setup-preparation.ts:167-178` (`prepare` passes it on),
  `packages/provisioning/src/first-setup-command.ts:33,74` (the terminal passes `{ onBox: true }`),
  `apps/server/src/setup-first-fiscal-api.ts:455-470`,
  `apps/server/src/setup-recovery-preparation-api.ts:113` and `recovery-preparation.ts:206-215`,
  `apps/server/src/promote-api.ts:74` and `node-operation-preparation.ts:164-177`;
  `packages/fiscal-verifactu/src/hosted-hour-recovery.ts:71-126`,
  `initial-hour-setup.ts:197-228` (use it instead of Task 4's `{ onBox: true }`)
- Test: `request-from-box.test.ts`; one case each in `setup-first-fiscal.route.test.ts`,
  `setup-recovery-preparation-api.test.ts` and `hour-promotion.test.ts`

**Interfaces — produces:**

```ts
// apps/server/src/request-from-box.ts
export interface RequestSourceDeps { interfaces?: typeof import("node:os").networkInterfaces }
export function requestFromBox(c: Context, deps?: RequestSourceDeps): boolean;
export function addressIsBox(address: string | undefined, deps?: RequestSourceDeps): boolean;
// packages/module
export interface OperationClient { readonly onBox: boolean }
recovery?(operation: Pick<ModuleOperationInput, "binding" | "authority">, proposal: unknown,
          client: OperationClient): Promise<unknown>;
preparation?(context: InitialSetupContext, proposal: unknown, client: OperationClient): Promise<unknown>;
```

The three routes' deps gain an optional `requestFromBox?: (c: Context) => boolean`, defaulting to
the real function; tests inject it (Task 6a). `addressIsBox`: strips a `::ffff:` prefix and an IPv6 zone (`%eth0`); true for `undefined`, any
`127.0.0.0/8` address, `::1`, and any address on ANY interface `networkInterfaces()` lists —
internal ones and Docker bridges included (not `listBoxIpv4`, `box-reach.ts:75`, which keeps only
the default route's). `requestFromBox` reads `getConnInfo(c).remote.address`
(`@hono/node-server/conninfo`, as `node-enrol-api.ts:48` does). The module seam carries only the
boolean: generic code learns nothing about the fiscal module's proposals.

- [ ] **Step 1: Write the failing tests:** `addressIsBox` with injected interfaces `{ eth0:
  [{ address: "192.168.10.20", family: "IPv4", internal: false }, { address:
  "fe80::1", family: "IPv6", internal: false }], docker0: [{ address: "172.17.0.1", … }], lo: [{
  address: "127.0.0.1", internal: true }] }`: true for `127.0.0.1`, `127.0.1.1`, `::1`,
  `::ffff:127.0.0.1`, `192.168.10.20`, `::ffff:192.168.10.20`, `fe80::1%eth0`, `172.17.0.1`,
  `undefined`; false for `192.168.10.31` and `fe80::2` (a till). Route cases, one per route: a
  `compare-clocks` proposal posted over the test's real TLS socket (which connects from
  `127.0.0.1`) answers `secondClock: false` with the browser `same_machine`. A test on one machine
  connects only from an address that machine holds, so the "another device" control is the
  route's `requestFromBox` dependency injected as `() => false`, answering `secondClock: true` for
  the same body.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/server exec vitest run
  src/request-from-box.test.ts src/setup-first-fiscal.route.test.ts
  src/setup-recovery-preparation-api.test.ts src/hour-promotion.test.ts` — expected: module not
  found, then `expected true to be false` on `secondClock`.
- [ ] **Step 3: Implement**: each of the three routes computes `requestFromBox(c)` once and passes
  `{ onBox }` down; `packages/module`'s two signatures gain the required parameter (a caller that
  forgets it fails typecheck rather than defaulting); the terminal passes `{ onBox: true }`.
- [ ] **Step 4: Run Step 2's command, the module and provisioning suites** (`pnpm --filter
  @waitron/module exec vitest run`, `pnpm --filter @waitron/provisioning exec vitest run`), and the
  seam guard `pnpm exec vitest run scripts/module-seams.test.ts` — PASS; `pnpm -r --filter @waitron/module --filter @waitron/provisioning --filter @waitron/server
  --filter @waitron/fiscal-verifactu typecheck` exits 0.
- [ ] **Step 5: Commit** — `server: a browser on the box itself never counts as the second clock`.

## Task 6a: A time control for tests (before the wait exists)

Every setup and restore will wait 90 to 150 seconds (Task 6b). About 50 test files outside the
fiscal package select a name through real routes or helpers on real time and expect it at once
(`git grep -l -E "allocatedProvision|allocated-provision|staged-hour-crash|staged-hour-restore|owned-hour-setup|hour-recovery-host|hour-first-fiscal|answer: \"(no|yes|unknown)\"" -- 'apps/*' packages/provisioning packages/composition`
printed 51 paths on the base, one of them `apps/server/test-durations.json`: 43 under `apps/server`,
4 provisioning, 3 setup, 1 composition). This task gives them a clock to move.

**Files:**
- Modify: `packages/module/src/operation-preparation.ts:27-40` — `ModuleOperationHost` gains
  `readonly hourClock?: HourTestClock`;
  `packages/fiscal-verifactu/src/hour-preparation.ts:146-170` (`createHostedHourPreparation`
  already takes `monotonicNow`; it now reads `host.hourClock` for `wall` and `monotonic` and hands
  both to `createSetupHourClock`, `hour-setup-clock.ts:33-37`, and to `monotonicNow`);
  `hosted-hour-recovery.ts:33,42` (the same); `apps/server/src/module-operation-host.ts` (an
  `hourClock` option, passed through; production callers never pass it)
- Create: `apps/server/src/testing/hour-test-clock.ts` — `createHourTestClock(startMs: number):
  HourTestClock & { advance(ms: number): void; set(ms: number): void }`
- Every server test reaches the routes from `127.0.0.1`, so after Task 5 every test browser is
  "the box" and its reading is discarded. The three routes' deps take an optional
  `requestFromBox?: (c: Context) => boolean` (Task 5; default the real one), and the helpers below
  pass `() => false` — a test posing as a phone — except in the cases that test the box's own
  screen. Production never passes it (the same `git grep` check as `hourClock`).
- Modify: the helpers `apps/server/src/testing/allocated-provision.ts:117-119`,
  `staged-hour-crash.ts:100-101`, `staged-hour-restore.ts`, `apps/server/test/owned-hour-setup.ts:66-72`,
  `hour-first-fiscal.ts`, `hour-recovery-host.ts` — each takes an optional `clock` and, when it
  gets "waiting", advances it past `targetMs` and asks again
- Test: `apps/server/src/testing/hour-test-clock.test.ts`, `apps/server/src/module-operation-host.test.ts`

**Interfaces — produces:**

```ts
// packages/module
export interface HourTestClock { wall(): number; monotonic(): number }
```

The helpers' loop is part of this task; moving the test files onto the helpers' new parameter is
Tasks 6d and 6e. Production refuses the seam: `bootServer`'s module host is built without
`hourClock`, and nothing reads it from the environment.

- [ ] **Step 1: Write the failing tests:** `createHourTestClock(T)` — `wall()` is `T`, `advance(90_000)`
  moves `wall` and `monotonic` together; a module host built with `hourClock` makes
  `compare-clocks` read the box at that clock's `wall` (assert the decision's box range equals `T`);
  "production builds no test clock": find the production construction of the module host with
  `git grep -n "createModuleOperationHost" -- apps/server/src ':!*.test.ts'` and assert in its test
  that it passes no `hourClock`; and `git grep -n "hourClock" -- apps/server/src ':!*.test.ts'
  ':!apps/server/src/testing'` lists only `module-operation-host.ts`'s option.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/server exec vitest run
  src/testing/hour-test-clock.test.ts src/module-operation-host.test.ts` — module not found.
- [ ] **Step 3: Implement.** **Step 4: re-run** — PASS; `pnpm -r --filter @waitron/module --filter
  @waitron/fiscal-verifactu --filter @waitron/server typecheck` exits 0.
- [ ] **Step 5: Commit** — `test: an injected clock for the setup and restore selection`.

## Task 6b: The selection's minute rules, and the setup and restore wait

**Files:**
- Modify: `packages/fiscal-verifactu/src/hour-selection.ts` — remove `Answer` and `answer`
  (`:31,35,47,141,241,281,303-307,377-382,395`), the hour wait (`:492-523`, target `:498`), the
  `% HOUR_MS` check on a saved wait (`:165-173` becomes `% MINUTE_MS`, and its `answer === "no"`
  term goes); replace `:464-471` with rules 1–4; wait entries keyed by target (below);
  `hour-recovery-preparation.ts` and `hour-preparation.ts` (`select` loses `answer`);
  `hosted-hour-recovery.ts:78-87` (proposal `["action", "comparisonId", "installationCodes"]` —
  the code goes in Task 9a); `initial-hour-setup.ts:229-246` (`candidates` takes
  `{ comparisonId }`)
- Test: `hour-selection.test.ts`, `hour-recovery-preparation.test.ts`, `hour-preparation.test.ts`,
  `hosted-hour-recovery.test.ts`, `hour-resumption.test.ts`, and the cases Task 2 left red

The setup and restore screens send `answer` until Tasks 10 and 11, so their browser suites are
red from here to those tasks; say so in the commit body.

**Interfaces — produces:** `select(request: { binding; authority; comparisonId; reportedIdentities? })`
returns `{ status: "selected", identity, issuedAt, … }`, `{ status: "preview", … }` or `{ status:
"waiting", targetMs: number, remainingMs: number }` (never `null` any more —
`requiresClockConfirmation` goes); refusals as in Global constraints.

The rules, computed after `canSelectHour` passes, with `now` the box reading
(`hour-selection.ts:438`):

```
if a name is already recorded for this event: today's branch stays as it is — the same code,
   refused `minute_not_later` if now < its issuedAt (:465-471, :478-491)
earliestMs = max(
  greatestSpentMinute === null ? -Infinity : EPOCH_MS + (greatestSpentMinute + 1) * MINUTE_MS,
  recordedTimeFloorMs ?? -Infinity,
  action is "setup" or "restore" ? settleTarget : -Infinity)
targetMs = earliestMs rounded UP to a minute start
if targetMs - now > 150_000 and targetMs !== settleTarget → refuse minute_not_later,
   allowedFromMs = targetMs                                  // compare the ROUNDED target
if now < targetMs → persist the wait { targetMs } (once per target) and return waiting,
   remainingMs from the monotonic timer (as today, :502-515)
else take encodeMinuteIdentity(now), persist the intent, then return it (rule 5, unchanged order)
```

`settleTarget = (Math.floor((now + 90_000) / MINUTE_MS) + 1) * MINUTE_MS`, from the box reading at
the select that records the wait, and stored as the wait's `targetMs`.

**A recorded wait expires** (review M1): it is reused only while `now ≤ targetMs + 60_000`. A
select later than that — hours or days after — records a NEW wait from its own check, so a late
select never takes a name without its own 90 seconds. Wait entries are keyed by
`[module, eventId, "wait", targetMs]` (today `entryKey`, `:181-188`, allows one wait per event,
and a second is `history_invalid`, `:175-177`); the current wait is the one with the greatest
`targetMs`, and a new wait's target must be greater than every earlier one's, else
`history_invalid`. A restart inside the 60 seconds keeps the target (review focus 3).

**`preview` during the settle wait** (setup and restore, the page's first look) answers
`{ status: "waiting", targetMs, remainingMs: targetMs - now }` computed without persisting
anything.

- [ ] **Step 1: Write the failing tests** in `hour-selection.test.ts` (Task 6a's clock; history rows
  built as `hour-history-reader.ts:107-133` emits them):
  - **promote**, history holds the current minute `0D00B` (19:55:10Z), box `2026-10-23T19:55:50Z`
    → `waiting`, `targetMs` = `19:56:00Z`, `remainingMs` = 10 000; at `19:56:00Z` → selected
    `0D00C`; a third promote knowing `0D00C`, box `19:56:30Z` → waits to `19:57:00Z` (two names in
    one minute, and a third);
  - **promote**, history's next allowed minute begins exactly 150 000 ms ahead → waiting; 150 001
    ahead → refused `minute_not_later` with `allowedFromMs` equal to that minute's start;
  - **a backup floor mid-minute** (re-register, so no settle wait): box `09:00:10Z`, floor
    `09:02:10.500Z` → rounded target `09:03:00Z`, 170 s ahead → refused `minute_not_later`,
    `allowedFromMs` `09:03:00Z`; floor `09:01:59Z` → target `09:02:00Z`, 110 s → waiting. No answer
    is ever a wait longer than 150 s;
  - **re-register**, no later history → selected at once (no settle wait for re-register or
    promote);
  - **restore**, history knows only `0CNNW`, box `2026-10-24T09:00:04Z` → waiting, `targetMs`
    `09:02:00Z` (116 s); at `09:01:59.999Z` → still waiting; at `09:02:00Z` → selected `0D0RY`;
  - **setup**, box `09:00:00Z` → target `09:02:00Z` (120 s); box `09:00:30Z` → `09:03:00Z` (150 s,
    the top); box `09:00:29.999Z` → `09:02:00Z` (90.001 s, the bottom); and for 600 box readings
    spread over a minute every target − box lies in `(90_000, 150_000]`;
  - **a restart keeps the recorded target**: a second selection object (fresh `timers` map, the
    same stored state) at `09:01:00Z` answers waiting with the stored `targetMs`;
  - **a late select starts a new wait**: wait recorded at `09:00:04Z` (target `09:02:00Z`); a select
    at `10:00:04Z` answers waiting with target `10:02:00Z`, not selected; one at `09:02:59Z`
    (inside the 60 s) selects;
  - **a name already recorded** is returned again with no new wait;
  - **preview during the settle wait** answers waiting and writes nothing (`replace` not called);
  - **the durable record before activation**: `replace` has been called with the intent before
    `select` resolves `selected` (rule 5);
  - a saved wait whose `targetMs` is not a minute start is `history_invalid`; two saved waits with
    the same target are `history_invalid`.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project node src/hour-selection.test.ts` — expected: the new cases fail (today a promote in a
  spent hour is `hour_not_later`, and restores wait for the next UTC hour).
- [ ] **Step 3: Implement** the rules above.
- [ ] **Step 4: Mutation by hand**: `150_000` → `149_999` (the exactly-150 s case fails),
  `90_000` → `89_000` (the bottom-of-range case fails), `+ 1` removed from `settleTarget` (the
  `0D0RY` case fails), `60_000` expiry → `Infinity` (the late-select case fails); restore each;
  record in the commit body.
- [ ] **Step 5: Run every test file in Files** — PASS (their `answer`/`yes`/`unknown` cases are
  rewritten per "Changed test checks"); typecheck exits 0.
- [ ] **Step 6: Commit** — `fiscal: minute rules 1–5 and the 90-to-150-second wait at setup and
  restore`.

## Task 6c: The terminal setup loses the question and explains its wait

**Files:** `packages/fiscal-verifactu/src/initial-hour-setup.ts:158-196` (the question at
`:178-191` goes; a wait prints why and the time); `packages/provisioning/src/first-setup-command.ts`;
tests `initial-hour-setup.test.ts`, `packages/provisioning/src/cli-same-hour-entry.test.ts`,
`cli-first-setup.test.ts`, `cli-owned-entry.test.ts`, `first-setup-command.test.ts`,
`apps/server/src/first-fiscal-launch.test.ts`.

- [ ] **Step 1: Write the failing tests:** the command never calls `actions.prompt` for a question;
  a waiting answer prints `Waiting to confirm the time, so no invoice series is ever repeated.` and
  `Continues at <ISO time>; run the command again then.` and returns `{ status: "waiting" }`; run
  again after the target (Task 6a's clock, in process), it selects. The child-process launch test
  (`first-fiscal-launch.test.ts`, which cannot share an injected clock) asserts the waiting lines
  and exit, and no longer expects a selected name from that process; the continuation is covered
  in process.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project node src/initial-hour-setup.test.ts` and `pnpm --filter @waitron/provisioning exec
  vitest run src/cli-same-hour-entry.test.ts src/first-setup-command.test.ts` — the question is
  still asked.
- [ ] **Step 3: Implement**; **Step 4: re-run, plus** `pnpm --filter @waitron/server exec vitest run
  src/first-fiscal-launch.test.ts` — PASS. **Step 5: Commit** — `setup(cli): no hour question; the
  terminal prints why it waits and until when`.

## Task 6d: `apps/server`'s setup tests run on the injected clock

**Files:** the setup half of Task 6a's list: `apps/server/src/boot.setup-routes.test.ts`,
`boot.test.ts`, `demo-seed.db.test.ts`, `first-fiscal-boot.test.ts`,
`first-fiscal-declared-publication.test.ts`, `first-fiscal-delivery.test.ts`,
`first-fiscal-document.route.test.ts`, `first-fiscal-hour-clock.test.ts`,
`first-fiscal-hour-finish.test.ts`, `first-fiscal-hour-import.e2e.test.ts`,
`first-fiscal-hour-modes.test.ts`, `first-fiscal-hour-readiness.test.ts`,
`first-fiscal-hour.route.test.ts`, `first-fiscal-interruption.test.ts`,
`first-fiscal-setup.e2e.test.ts`, `first-setup-finish.route.test.ts`,
`first-setup-recovery-delivery.test.ts`, `first-setup-retired-assignments.test.ts`,
`first-setup-unused-pdf.test.ts`, `fiscal-readiness-first-setup.test.ts`,
`module-operation-host.test.ts`, `provision.test.ts`, `setup-first-fiscal.route.test.ts`.

- [ ] **Step 1: Run them and list the failures** — `pnpm --filter @waitron/server exec vitest run
  boot first-fiscal first-setup fiscal-readiness demo-seed module-operation-host provision
  setup-first-fiscal` — expected: "synthetic hour was not selected", a `waiting` where `selected`
  was expected, `answer` proposals refused, `hour_not_later` expected.
- [ ] **Step 2: Move each onto the helpers' `clock`**, drop `answer` from proposals, rename an
  expected `hour_not_later` to `minute_not_later` (in `first-fiscal-hour-finish.test.ts` and
  `first-setup-retired-assignments.test.ts`). A test whose point was the "last hour" answer is
  rewritten to the settle wait per "Changed test checks".
- [ ] **Step 3: Re-run** — PASS. **Step 4: Commit** — `test(server): setup tests on the injected clock`.

## Task 6e: The restore, promotion and other packages' tests run on the injected clock

**Files:** `apps/server/src/cloud-fiscal-allocation.test.ts`, `hour-backup-state.test.ts`,
`hour-promotion.test.ts`, `hour-recovery-host.test.ts`, `hour-recovery-placement-1.test.ts`,
`-2`, `-3`, `recovery-document-evidence.test.ts`, `restore-emergency-attempts.test.ts`,
`restore-emergency-crash.e2e.test.ts`, `restore-emergency.test.ts`, `restore-paper-export.test.ts`;
`packages/provisioning/src/cli-first-setup.test.ts`, `cli-owned-entry.test.ts`,
`first-setup-command.test.ts`, `first-setup-runtime.test.ts`;
`apps/setup/src/first-setup-key-guards.test.ts`, `first-setup-session.test.ts`,
`screens/initial-setup-hour.test.ts`; `packages/composition/src/allocation-configuration.test.ts`.

- [ ] **Steps 1–4:** as Task 6d, with `pnpm --filter @waitron/server exec vitest run cloud-fiscal
  hour- recovery-document restore-`, `pnpm --filter @waitron/provisioning exec vitest run`, `pnpm
  --filter @waitron/setup exec vitest run src/first-setup-key-guards.test.ts
  src/first-setup-session.test.ts src/screens/initial-setup-hour.test.ts`, `pnpm --filter
  @waitron/composition exec vitest run`. The `hour_not_later` → `minute_not_later` files here:
  `cloud-fiscal-allocation.test.ts`, `hour-promotion.test.ts`, `hour-recovery-host.test.ts`,
  `hour-recovery-placement-3.test.ts`, `restore-emergency-attempts.test.ts`,
  `restore-emergency-crash.e2e.test.ts`, `packages/provisioning/src/first-setup-runtime.test.ts`.
  Commit — `test: restore, promotion and setup-app tests on the injected clock`.

## Task 6f: A wait does not spend the owner's password

Today each setup `candidates` call spends a one-time password grant: the host's state store calls
`authorizeReplacement` on every write (`packages/provisioning/src/module-preparation-state.ts:124-131`),
which consumes the grant (`first-setup-runtime.ts:231-238`, `first-setup-owner.ts:463-480`), and a
"waiting" answer consumes it explicitly (`first-setup-preparation.ts:205-208`, `pending` is
`status === "waiting"`, `initial-hour-setup.ts:265`); the setup app asks for the password before
every call (`apps/setup/src/screens/initial-setup-screen.ts:151-157`). With automatic retries at
zero and every 15 s, each retry would prompt. After this task only the request that takes the name
spends the grant.

**The restore has no such grant:** every restore request carries the recovery key itself, checked
on its own path (`withRecoveryKeyAuthority`, `apps/server/src/recovery-preparation.ts:125-131`), and
`git grep -n -i -E "consume|nonce|reconfirm"` over `recovery-preparation.ts`,
`operation-authentication.ts`, `setup-recovery-preparation-api.ts` and
`apps/setup/src/screens/recovery-copy.ts` printed nothing on the base. The switch's sign-in is
slice 4c's, which must apply the same rule.

**Files:**
- Modify: `packages/module/src/operation-preparation.ts:36-45` — the state's `replace(next,
  purpose?: "wait" | "intent")` (default `"intent"`: an unmarked write still needs the grant);
  `packages/provisioning/src/module-preparation-state.ts:124-140` — call `authorizeReplacement`
  only for `"intent"`, still `authorize(binding)` for both;
  `packages/provisioning/src/first-setup-preparation.ts:192-209` — a pending answer returns without
  `confirm()`; `packages/fiscal-verifactu/src/hour-selection.ts` (`write` passes `"wait"` for wait
  entries); `apps/setup/src/screens/initial-setup-screen.ts:151-157` and
  `apps/setup/src/first-setup-session.ts` — one password prompt per press; the grant is kept in
  memory (never in storage) and re-sent on the automatic retries; a refused or expired grant
  (5 minutes, `first-setup-owner.ts:450`) prompts again once.
- Test: `packages/provisioning/src/first-setup-preparation.test.ts`,
  `module-preparation-state.test.ts`; `apps/server/src/setup-first-fiscal.route.test.ts` (the real
  route); `apps/setup/src/first-setup-session.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - real route (`setup-first-fiscal.route.test.ts`, Task 6a's clock): one reconfirmation grant;
    `candidates` answers waiting, then waiting again (clock advanced 30 s), then — clock past the
    target — selected; all three with the same grant; a fourth take with that grant is refused
    `setup.owner_required` (it was spent once, by the take);
  - a clock refusal (`clock_disagreement`) leaves the grant unspent: the next `candidates` with the
    same grant succeeds;
  - `module-preparation-state.test.ts`: `replace(v, "wait")` writes without calling
    `authorizeReplacement`; `replace(v)` calls it;
  - `first-setup-session.test.ts`, the real session over the test server: two waiting answers then
    a taken name ask for the password exactly once.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/provisioning exec vitest run
  src/first-setup-preparation.test.ts src/module-preparation-state.test.ts`, `pnpm --filter
  @waitron/server exec vitest run src/setup-first-fiscal.route.test.ts`, `pnpm --filter
  @waitron/setup exec vitest run src/first-setup-session.test.ts` — the second waiting call is
  refused.
- [ ] **Step 3: Implement**; **Step 4: re-run** — PASS. **Step 5: Commit** — `setup: only taking the
  name spends the owner's password`. This touches who may make the box create invoice series: the
  per-task review of this task is security-focused (who can write a wait without the password —
  only the owner session; nothing else changes).

## Task 7: A backup's own newest record and its creation time are floors too

**Files:**
- Modify: `packages/fiscal-verifactu/src/hour-history.ts:16-20,59-108` (a source may carry
  `timeFloorMs`); `hour-history-reader.ts:45-204` (reads the newest `fecha_hora_huso_gen_registro`
  of `registros_facturacion`, read-only, into the venue source's `timeFloorMs`);
  `apps/server/src/recovery-preparation.ts:183-199` (adds a source `{ reference: "backup-created",
  complete: true, records: [], timeFloorMs: Date.parse(selected.createdAt) }` — `selected.createdAt`
  is already in the context key at `:193`)
- Test: `hour-history.test.ts`, `hour-history-reader.test.ts`,
  `apps/server/src/hour-backup-state.test.ts`

**Interfaces — produces:** `HourHistorySource.timeFloorMs?: number`; `projectHourHistory` folds
it into `recordedTimeFloorMs` (max); a non-safe-integer `timeFloorMs` is a
`${reference}:invalid_source` contradiction. The read adds no write: `registros_facturacion` is
append-only and only selected (`scripts/write-path-tables.test.ts` still passes).

- [ ] **Step 1: Write the failing tests:** a venue database (real, `useVenueDb`) with an allocation
  at `2026-10-16T11:40Z` and a registro generated at `2026-10-22T20:15Z` → `readHourHistory`'s
  `timeFloorMs` is `2026-10-22T20:15Z`; a restore whose box and browser agree at
  `2026-10-21T10:00Z` (after the allocation, before the sale) is refused `minute_not_later` with
  `allowedFromMs` `2026-10-22T20:15Z` (the backup refuses it by itself); a backup created
  `2026-10-23T08:00Z` with no later record refuses a clock at `2026-10-23T07:50Z` the same way;
  control: clocks at `2026-10-24T09:00Z` wait and select.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project node src/hour-history.test.ts src/hour-history-reader.test.ts` and `pnpm --filter
  @waitron/server exec vitest run src/hour-backup-state.test.ts` — expected: the refusal cases
  select or wait instead.
- [ ] **Step 3: Implement**; **Step 4: re-run** — PASS; **Step 5: commit** — `fiscal: a backup's
  newest record and creation time are floors for a restore`.

## Task 8: The proof — `minute-selection-unknown-name.test.ts`

The owner's condition (spec §6.7): the code comes off the sheet and the form only once this test
passes, in this pull request. Written down before the first run, as the probe did: a **failing**
case prints `selected` with a code at or below the unseen name; a **passing** one refuses or
selects a later code.

**Files:** Create `packages/fiscal-verifactu/src/minute-selection-unknown-name.test.ts`.

The model (spec §6.7, in minutes): the backup knows `0CNNW` (16 Oct 11:40Z, the main box's setup);
its newest invoice record was generated 22 Oct 22:30Z and the backup was made 22 Oct 23:00Z
(Task 7's floors, stated so no row is refused by them by accident); the unseen name is `0CZZW` (the
spare's switch, 23 Oct 19:40:50Z); the restore really happens on 24 Oct 09:00Z; the running release
was committed 15 Oct. A clock check runs before the history, so a row whose clocks disagree is
refused by the clock whatever its history; a row meant to prove a history floor has clocks that
AGREE (box and another device, `onBox: false`), so only that floor can refuse it. It calls
`createHourRecoveryPreparation(...).select` (`hour-recovery-preparation.ts:142-150`) with the
history in `readHourHistory`'s shape, clock decisions from `createSetupHourClock(...).compare`
with injected `wall`, `monotonic` and `internet` (so the `onBox` path is the real one), and an
in-memory state store (`~/waitron-campaign/a947r2-probes/zz-a947r2-old-backup-probe.test.ts:90-104`
shows one).

- [ ] **Step 1: Write the cases**, each asserting the outcome (not printing it):

| Case | Box | Other clocks (source) | Expected |
| --- | --- | --- | --- |
| A | 16 Oct 10:00 | browser the same | refused `minute_not_later`, `allowedFromMs` 22 Oct 23:00Z (the backup's own floors) |
| A2 | 20 Oct 10:00, release 21 Oct | browser the same | refused `clock_unconfirmed` |
| B2 | 20 Oct 10:00 | browser 24 Oct 09:00 | refused `clock_disagreement`; and no proposal confirms it (`confirm-clock` refused) |
| S | as B2, with `reportedIdentities: ["0CNNW"]` until Task 9a; after it, a proposal still carrying `installationCodes` | browser 24 Oct 09:00 | refused `clock_disagreement`; after 9a, refused `event_mismatch` |
| B4a | 20 Oct 10:00 | browser 20 Oct 10:00, `{ onBox: true }` (loopback) | refused `second_clock_missing` |
| B4b | as B4a for a request from the box's own LAN address: the module sees only `onBox: true`; that `192.168.10.20` and `::ffff:192.168.10.20` give `onBox: true` is Task 5's `addressIsBox` case | | refused `second_clock_missing` |
| D1 | a known later name, without a typed code: `0CZZW` in the surviving database's history; box 23 Oct 19:00 | browser the same (`onBox: false`) | refused `minute_not_later`, `allowedFromMs` 23 Oct 19:41Z |
| D2 | the old database still on the disk (its history in `survivingHistory`, holding `0CNNW` and a record of 23 Oct 18:00Z); box 23 Oct 17:00 | browser the same | refused `minute_not_later` by that database's floor |
| W | box and another device wrong together (both 20 Oct 10:00, `onBox: false`) | | refused `minute_not_later` by the backup's creation time (Task 7), `allowedFromMs` 22 Oct 23:00Z |
| D4 | 20 Oct 10:00 | internet 24 Oct 09:00, no browser | refused `clock_disagreement` |
| F1 | 23 Oct 21:10 (true 19:10) — a promote | browser 19:10 | refused `clock_disagreement` |
| Same minute | 23 Oct 19:40:55 | browser the same | waiting (125 s), then selected `0CZZZ` (19:43Z), greater than `0CZZW` |
| ±45 s | every phase 0–59.5 s in half seconds, gaps 0–10 s: unseen name by a box 45 s fast at `tN`; this box 45 s slow at `tN + gap`; browser 15 s slow | | after the wait, selected code > the unseen code, for every combination |
| ±45.5 s control | phase 14.5 s, gap 0, errors 45.5 s and a browser 15.5 s slow | | selected code EQUALS the unseen code — the disclosed limit, the sweep's first repeat (`restore-wait-sweep.output.txt`) |
| E1 | 24 Oct 09:00 | browser the same | waiting (120 s), then selected `0D0RY` (09:02Z), later than `0CZZW` |
| E2 | as E1, with `0CZZW` in the surviving database's history instead of a typed code | | waiting, then selected `0D0RY`, later than `0CZZW` |

The ±45 s rows use the real selection, not the sweep's arithmetic: they are the sweep's claim
re-measured on the code. (The checked box reading is 45 s slow and the browser 15 s slow, so the
clock check passes at 30 s — the 15-second allowance.)

- [ ] **Step 2: Run it** — `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/fiscal-verifactu
  exec vitest run --project node src/minute-selection-unknown-name.test.ts` — expected: PASS (the
  rules exist after Tasks 4–7). If any row fails, STOP: the design's proof does not hold, and the
  code stays on the sheet — report the row.
- [ ] **Step 2b: Keep the receipt.** Pull requests land by squash, so this commit disappears from
  `main`. Save the run's command, its `Tests` count and this commit's sha in the ledger; the
  driver pastes them into the PR description (Driver steps).
- [ ] **Step 3: The proof by deletion**: delete the `disagreement` term from `canSelectHour`
  (Task 4) and re-run — B2, S, D4 and F1 must fail by SELECTING (B2 selects a code earlier than
  `0CZZW`); restore; then delete the settle wait (`settleTarget` term) — the same-minute and ±45 s
  rows must fail by selecting `0CZZW`; restore. Paste both runs' failing lines in the commit body.
- [ ] **Step 4: Commit** — `test(fiscal): a restore from an old backup never reuses an unseen
  name`.

## Task 9a: The recovery sheet and the restore's selection drop the installation code

Only after Task 8 is committed green.

**Files:**
- Modify: `recovery-document.ts:5-14,51,62-66` (no `installationCodes`);
  `recovery-pdf-content.ts:22,121` (no «Código de instalación» row);
  `completed-recovery-document.ts:51`; `initial-hour-setup.ts:127,292-294`;
  `hosted-hour-recovery.ts:1,79,86` (proposal `{ action: "select", comparisonId }` exactly);
  `hour-selection.ts:1,37,48,134-139,189-201,242,288-291,383-386,396,447` (`reportedIdentities`
  and `reportedHistory` go); `minute-selection-unknown-name.test.ts` row S (now the refused
  proposal)
- Test: `recovery-document.test.ts`, `recovery-pdf*.test.ts`, `hosted-hour-recovery.test.ts`,
  `initial-hour-setup.test.ts`, `minute-selection-unknown-name.test.ts`

`reported-hour-codes.ts` stays until Task 9b: the restore screen still imports it.

- [ ] **Step 1: Write the failing tests:** `parseRecoveryDocumentPublic` refuses a document that
  still carries `installationCodes` (`exact` keys) and accepts one without; the rendered PDF's text
  contains neither `Installation code` nor `Código de instalación` in EN and ES;
  `recovery(op, { action: "select", comparisonId, installationCodes: ["0CZZW"] }, client)` is
  refused `event_mismatch` and `{ action: "select", comparisonId }` selects.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project node src/recovery-document.test.ts src/hosted-hour-recovery.test.ts` — the document
  with codes is accepted; the bare select is refused.
- [ ] **Step 3: Implement. Step 4: re-run, with Task 8's test and the fiscal gates** — PASS,
  `Tests 20 passed` for the gates. **Step 5: Commit** — `fiscal: the recovery sheet keeps the key
  only; a restore's selection takes no code`.

## Task 9b: The screens, harnesses and other packages lose the code

**Files:** delete `packages/fiscal-verifactu/src/reported-hour-codes.ts` and its test; the restore
screen's field and plumbing (`setup/recovery-hour.ts:9,18,25,120,181-186,192,220,293,337-339,
371-373,394,426-437`) and the setup screen's sheet code (`setup/first-hour.ts:355`); harnesses
`apps/server/src/testing/staged-hour-crash.ts:205,234,281`, `staged-hour-restore.ts:195,223`,
`apps/server/test/hour-recovery-host.ts:299,409`, `owned-hour-setup.ts:96`,
`hour-recovery-delivery.ts:18`; `packages/provisioning/src/first-setup-command-document.test.ts`,
`first-setup-command.test.ts`, `first-setup-recovery-delivery.test.ts`;
`packages/composition/src/allocation-configuration.test.ts`.

- [ ] **Step 1: Write the failing browser cases:** "sends no installation code" (the `select`
  proposal is exactly `{ action: "select", comparisonId }`); "has no installation-code field" (no
  element named `recovery-installation-codes`).
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project browser src/setup/recovery-hour.browser.test.ts` — the field is found.
- [ ] **Step 3: Implement**; `git grep -n -E "installationCodes|reportedHourCodes|reportedIdentities|installation_codes_invalid"
  -- apps packages ':!docs'` prints nothing except Task 8's row S.
- [ ] **Step 4: Run Step 2's command, the provisioning and composition suites and `pnpm --filter
  @waitron/server exec vitest run hour-recovery staged`** — PASS. **Step 5: Commit** — `setup:
  no installation code anywhere a restore is made`.

## Task 10: The setup page explains its waits, with a countdown

**Files:**
- Create: `packages/fiscal-verifactu/src/setup/wait-countdown.ts` — the countdown both pages use
  (the restore page has none today, `recovery-hour.ts:526` prints only the target time):
  `createWaitCountdown(host: ReactiveControllerHost, onZero: () => void)` returning `{ start(remainingMs:
  number): void; stop(): void; readonly remainingMs: number | undefined }`, a Lit reactive controller
  ticking on `setInterval(…, 250)` against `performance.now()` (today's mechanism,
  `first-hour.ts:110-131`, moved), and `formatRemaining(ms): string` (`m:ss`, ceiling seconds)
- Modify: `packages/fiscal-verifactu/src/setup/first-hour.ts` — the question `:444,488`, its
  radios `:557-559`, `answer` in the draft and `:151,214,283`; the confirm control and its
  `confirmed` draft field (`:207-219,277-279,583-590`); the boundary and confirmation texts
  `:460`; the wait view `:110-131,600-605`
- Test: `setup/wait-countdown.browser.test.ts`, `setup/first-hour.browser.test.ts`,
  `setup/first-hour.a11y.browser.test.ts`, `setup/first-hour-reissue.browser.test.ts`;
  `apps/setup/src/screens/initial-setup-hour.test.ts` (the real setup screen, for the password)

**Interfaces — consumes:** the comparison's `clock.secondClock`, `clock.disagreement`, the
browser's unavailable reason `same_machine`, and the comparison `id` (Task 4); `candidates({
comparisonId })` answers `waiting` with a numeric `remainingMs` (Task 6b); one password per press
(Task 6f).

Behaviour (spec §6.5, "Every wait explains itself", and its "What to do, by page" table — the
setup page's row):
- The page still compares clocks on load to show the readings. Its action («Crear las series» /
  "Make the series") is enabled once the form's own fields are complete, whatever the clock; a
  press runs a fresh `clock-challenge` + `compare-clocks` (browser `Date.now()`), then
  `candidates({ comparisonId })`.
- **Waiting**: the why, the what-to-do and «Sigue en m:ss» / "Continues in m:ss"
  (`data-test="remaining"`, `role="timer"`). At zero it runs a fresh comparison and
  `candidates({ comparisonId })` again by itself: `selected` → the series; `waiting` → a new
  countdown; a refusal → its explanation. It never imports a name without the server's `selected`.
- **A reload during a wait**: on connect the page asks `preview`, which answers waiting with the
  server's time left (Task 6b); it shows that countdown and starts no new 90 s.
- **No second clock**: the why, plus the "on the box itself" sentence only when the browser's
  unavailable reason is `same_machine`; the setup row's what-to-do and what-ends-it; no countdown.
  A `setInterval` of 15 000 ms compares again and, once a comparison passes, continues to
  `candidates` by itself. The what-to-do names "cancel this setup" only if the page shows a cancel
  control at this step (the `abandon` action, `setup-first-fiscal-api.ts:472`): Step 1 checks
  whether it does; if not, the text names only the internet (design §6.5, "Why the setup page says
  'start again'").
- **Clock refusal**: the spec's refusal sentence, the setup row's what-to-do, both readings, «Comprobar
  otra vez» / "Check again"; no countdown, no automatic retry.
- **`minute_not_later`**: «Todavía no se puede crear las series: ya se usó un minuto posterior a
  la hora de este equipo. Podrás seguir a partir de las {time}.» / "The series cannot be made yet:
  a later minute is already in use. You can carry on from {time}." with `allowedFromMs` in the
  venue's zone; no countdown (rule 4 is a refusal).
- Strings in the component's existing `t` objects (EN beside ES, as `:444/:488`), verbatim from the
  spec's tables.

Timer rules for the tests (CLAUDE.md §4's fake-timer trap, and the review's LOW 4):
`vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] })`, set BEFORE the
press and undone with `vi.useRealTimers()` in a `finally`; `setTimeout` and
`requestAnimationFrame` stay real so `userEvent`, Lit and `vi.waitFor` keep working. An exact
`m:ss` is asserted only after `vi.advanceTimersByTime(n)` and `await el.updateComplete` — never
right after a `vi.waitFor`, which advances faked timers itself on each poll.

- [ ] **Step 0: Prove the fake clock works in browser mode** (nothing in this repo has faked
  `performance` in a browser test; the only use is `toFake: ["Date"]`,
  `first-hour.browser.test.ts:387`): in `wait-countdown.browser.test.ts`, start a countdown of
  84 000, advance 1 000, expect `1:23`. Run it; if it reads `1:24` the fake did not take, and the
  controller takes an injected `now: () => number` instead (tests pass their own) — record which in
  the commit body.
- [ ] **Step 1: Write the failing browser tests** (mount and API stub as the file's `mount` helper
  does):
  - "explains a waiting setup with a countdown that goes back to the server at zero": stub
    `candidates` to answer waiting `remainingMs: 84_000`, then selected; press; expect the why and
    `1:24`; advance 1 000, `updateComplete`, expect `1:23`; advance 83 000; `await vi.waitFor(() =>
    expect(calls.filter(c => c.action === "candidates")).toHaveLength(2))`; a second
    `clock-challenge` and `compare-clocks` came between the two `candidates`; the series shows.
  - "a countdown reaching zero imports nothing the server did not select": second answer waiting
    `30_000` → a new countdown `0:30`; `input` never called.
  - "a reload during a wait shows the server's time left": mount with `preview` answering waiting
    `remainingMs: 61_000` → `1:01` shown before any press, and `candidates` not called.
  - "with no second clock it explains itself and carries on when the internet arrives": compare
    answers `secondClock: false`, browser `same_machine`; expect the why, the box sentence, the
    what-to-do, no `[data-test=remaining]`; compare now answers `secondClock: true`; advance 15 000;
    `candidates` called once without another press.
  - "a phone with no second clock does not say it is the box": browser unavailable `challenge` →
    the box sentence is absent.
  - "a clock refusal shows both readings and no countdown, and waits for Check again".
  - "a later minute in use names its time and does not count down".
  - **The password, through the real setup screen** (review H1; a stubbed `candidates` cannot see
    it): in `apps/setup/src/screens/initial-setup-hour.test.ts`, the real `initial-setup-screen`
    and `FirstSetupSession` over the setup app's browser test server
    (`apps/setup/test/first-setup-browser.ts`), the server double answering waiting, waiting,
    selected: the password dialog opens exactly once. Task 6f's real-route test pins the server
    side.
  - a11y: each of the four states, both themes (the file's existing axe helper).
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project browser src/setup/wait-countdown.browser.test.ts src/setup/first-hour.browser.test.ts
  src/setup/first-hour.a11y.browser.test.ts` and `pnpm --filter @waitron/setup exec vitest run
  src/screens/initial-setup-hour.test.ts` — the why text is not found.
- [ ] **Step 3: Implement**; **Step 4: re-run** (and `first-hour-reissue.browser.test.ts`) — PASS.
- [ ] **Step 5: Commit** — `setup: the setup page explains every clock wait, with a countdown`.

## Task 10a: A restore uploads its backup once; the clock requests carry no file

Today every restore preparation call — clock challenge, comparison, select, and each re-check —
re-sends the whole backup file (`apps/setup/src/screens/recovery-copy.ts:62-76` builds an archive
source with the file every time), and the server unpacks and checks it again each time
(`apps/server/src/recovery-preparation.ts:353-363`, `validateArtifact`) before it compares clocks.
Uploads may be up to 256 MiB (`setup-api.ts:231`). The browser's reading counts only if the
server's challenge-to-comparison gap is at most 5 seconds (`hour-setup-clock.ts:101-104`; the
review's probe: 5 000 ms usable, 5 001 ms not). Offline, a restore from a file has no other second
clock. The 5-second rule does not change.

**Files:**
- Modify: `apps/server/src/setup-recovery-preparation-api.ts:113-175` — a new route
  `POST /setup-api/recovery/stage` (multipart: `request` `{ source: { kind: "archive",
  recoveryKey, environment } }` and `artifact`), which runs `validateArtifact` once and keeps the
  checked copy under the staging directory (`createSetupRecoveryPreparation`'s `stagingDir`,
  `recovery-preparation.ts:347-349`), answering `{ stagedId }`; `/setup-api/recovery/preparation`
  accepts `source: { kind: "staged", stagedId }` as JSON. One staged copy at a time; it is
  discarded when the restore finishes, when it is replaced, on start-again, and after 60 minutes
  unused. `apps/server/src/recovery-preparation.ts:353-363` (the `staged` branch reuses the copy,
  no second validation).
- Modify: `apps/setup/src/api/client.ts` (`stageRecovery(file, key, environment)`),
  `apps/setup/src/screens/recovery-copy.ts:62-76` (stage once when the file is chosen; every
  preparation call sends `{ kind: "staged", stagedId }`).
- Test: `apps/server/src/setup-recovery-preparation-api.test.ts`; create
  `apps/setup/src/screens/recovery-copy.test.ts` (none exists on the base).

The bucket and Cloud sources stay as they are unless Task 10b measures their gap over 5 s; both
have the internet, whose clock counts.

- [ ] **Step 1: Write the failing tests:** a staged archive's `clock-challenge`, `compare-clocks`
  and `select` bodies are JSON under 2 KiB with no artifact; `validateArtifact` runs once for a
  stage and three preparation calls (spy); a `stagedId` from another attempt, or after discard, is
  refused `setup.restore_invalid` (or the sibling code the route already uses for a bad source —
  grep `invalid(` in the file); the setup app stages once and sends `kind: "staged"` thereafter.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/server exec vitest run
  src/setup-recovery-preparation-api.test.ts` and `pnpm --filter @waitron/setup exec vitest run
  src/screens/recovery-copy.test.ts` — no stage route.
- [ ] **Step 3: Implement. Step 4: re-run** — PASS. **Step 5: Commit** — `restore: upload the backup
  once; the clock requests carry no file`.

## Task 10b: Measure the restore's clock gap with a real backup (before Task 11)

A measurement, not a feature. Its scripts live outside the repository, in
`~/waitron-campaign/a947-4a-measure/`.

- [ ] **Step 1: Say first what failing looks like:** on the staged path, a challenge-to-comparison
  gap over 5 000 ms on the server's monotonic clock means the offline restore cannot hold; under
  2 000 ms at the throttled link below means it holds with margin.
- [ ] **Step 2: Get a real backup:** the dev stack's demo venue (`wa-wt demo <worktree-name>`),
  backed up the way the restore page's file input expects (the archive the setup app's restore
  accepts); record its size. Also time one at the 256 MiB limit if a real one that large can be
  made from seeded data; if not, say so.
- [ ] **Step 3: Measure** with the workspace's Playwright Chromium driving the real restore page,
  the link throttled by CDP `Network.emulateNetworkConditions` (20 Mbit/s up and down, 20 ms
  latency, a phone on venue Wi-Fi), the internet clock unreachable, and a temporary uncommitted log
  line printing the gap at `hour-setup-clock.ts:93-94`: five runs on the staged path, and five on
  the old per-call upload (the commit before Task 10a, in a throwaway worktree — CLAUDE.md §4,
  never by swapping files). Print each gap.
- [ ] **Step 4: Decide.** Staged gaps all under 5 000 ms: write the numbers in the ledger for the
  PR description and carry on to Task 11. **Any staged gap over 5 000 ms: STOP.** Do not change
  the 5-second rule and do not build Task 11; report the numbers — the approved offline restore
  then needs the owner's decision.

## Task 11: The restore page explains its waits, with a countdown

**Files:**
- Modify: `packages/fiscal-verifactu/src/setup/recovery-hour.ts` (line numbers as on the base;
  Task 9b has removed the code field) — the question (`:19,121,233,342,376-377,467-475`), the
  confirm path (`:237-238,288-289,498-524`), the boundary text (`:366`), the `hour_not_later`
  handling (`:319`), the wait line (`:526`, replaced by Task 10's `wait-countdown.ts`)
- Test: `setup/recovery-hour.browser.test.ts`, `setup/recovery-hour.a11y.browser.test.ts`,
  `apps/setup/src/screens/recovery-hour.test.ts`

Behaviour: Task 10's states, with the restore row's texts (design §6.5, "What to do, by page":
a device "that has the backup"); the other declarations (old box gone, sole recovery, the printed
key) stay required before the action is enabled. No password is involved (Task 6f).

- [ ] **Step 1: Write the failing tests** — Task 10's behaviour cases except the password one, on
  `vf-recovery-hour`, and the a11y states.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project browser src/setup/recovery-hour.browser.test.ts src/setup/recovery-hour.a11y.browser.test.ts`
  — no why text is found.
- [ ] **Step 3: Implement**; **Step 4: re-run, and `pnpm --filter @waitron/setup exec vitest run
  src/screens/recovery-hour.test.ts src/screens/initial-setup-hour.test.ts`** — PASS.
- [ ] **Step 5: Commit** — `setup: the restore page explains every clock wait, with a countdown`.

## Task 12: Printed numbers with five symbols

**Files:** Test only: `apps/server/src/receipt-document.test.ts` (beside the 58/80 mm date case at
`:1055-1058`), `apps/server/src/qr-matrix.test.ts` (or the file that tests `qrModules`).

- [ ] **Step 1: Write the tests:** a simplified receipt on 58 mm with `invoiceNumber:
  "A-0CZZW/9999"` prints the number and the numeric date on one line; `"A-0CZZW/10000"` prints the
  date on its own right-aligned line and nothing is cut (`labelAmountLines`,
  `packages/printing/src/layout.ts:128-151`); on 80 mm with the longest Spanish date the number
  `"A-0CZZW/9999999999"` fits its line. The QR: `qrModules(buildQrPayload(…))` for `A-06XV/1`
  and `A-0CZZW/1` have the same size — measured 2026-10-22 with `qrcode` at level M and the
  installed `@waitron/verifactu` 0.2.1 (`~/waitron-campaign/a947-plan4a/probes/qr-size.mjs`,
  output beside it): 45 squares (version 7) in preproduction and 49 (version 8) in production for
  `A-` with four or five symbols at every counter tried; the probe's control, a 21-character
  prefix, moved preproduction to 49. Pin those two sizes.
- [ ] **Step 2: Run:** `pnpm --filter @waitron/server exec vitest run src/receipt-document.test.ts
  src/qr-matrix.test.ts` — expected: PASS at once (nothing changes in printing); a test that passes
  first time is a receipt, not TDD — say so in the commit.
- [ ] **Step 3: Commit** — `test(receipts): five-symbol invoice numbers on 58 and 80 mm, and the QR size`.

## Task 13: Runbooks and CLAUDE.md §5

**Files:** `docs/operations/hour-recovery.md:11,18-23,38-40,52`;
`docs/operations/first-live-fiscal-setup.md:4,20,33,42`; `CLAUDE.md:926`. Not
`docs/operations/a679-changed-checks.md` or `a679-development-checkpoints.md`: historical records —
add a dated one-line pointer at the top of each instead (CLAUDE.md §6).

- [ ] **Step 1:** rewrite the runbooks' steps to: no code to type, no "last hour" question; the box
  compares its clock with the page's device and the internet by itself, nobody types a time, the
  box's own screen does not count; a setup or restore waits 90 to 150 seconds with a countdown; the
  three refusals and what each asks for (spec §6.5's table). Every sentence about behaviour points
  at the test that pins it (`minute-selection-unknown-name.test.ts`, `hour-clock.test.ts`).
- [ ] **Step 2:** CLAUDE.md §5's "the box does not mint an installation number from its clock or a
  counter" becomes: "a setup, switch, hand-over, restore or re-registration names its installation
  from the box's clock — five symbols for the UTC minute — only after a check against a clock on
  another machine (within 30 seconds, no confirmation) and strictly later than every name in the
  history it can read; a setup or restore waits 90 to 150 seconds first. The one exception is the
  test-only preproduction throwaway (`hour-throwaway-allocation.ts`), refused outside
  preproduction. Guard: `minute-selection-unknown-name.test.ts`, weaker than its name — it covers
  the cases it lists, not a reference clock more than 15 seconds wrong."
- [ ] **Step 3: Run** `pnpm exec vitest run scripts/claude-md-pointers.test.ts` —
  PASS; `pnpm exec prettier --check CLAUDE.md` — clean (docs/ is ignored by prettier; CLAUDE.md is
  not).
- [ ] **Step 4: Commit** — `docs: runbooks and CLAUDE.md §5 for minute names and the clock rule`.

## Task 14: Guards and the untouched list

- [ ] **Step 1: Run the guards** — `pnpm exec vitest run
  scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/english-only.test.ts
  scripts/module-seams.test.ts scripts/write-path-tables.test.ts scripts/claude-md-pointers.test.ts`
  — PASS. `git grep -n -E "hour_not_later|installation_codes_invalid|clock_confirmation_required|confirm-clock|requiresConfirmation|boundaryWait|last hour|última hora|esta hora UTC"
  -- apps packages ':!*.md'` prints nothing.
- [ ] **Step 2: The untouched list** — `git diff --stat c1d0eca81 -- packages/fiscal-verifactu/src/chain.ts
  packages/fiscal-verifactu/src/registro-sif.ts packages/fiscal-verifactu/src/restore.ts
  packages/fiscal-verifactu/src/allocation.ts packages/fiscal-verifactu/src/write-path.e2e.test.ts
  packages/fiscal-verifactu/src/inmutabilidad.test.ts 'packages/*/drizzle'` prints nothing; the
  fiscal gates command — `Tests 20 passed`.
- [ ] **Step 3: Coverage, locally only for what this slice touched:** `pnpm --filter
  @waitron/fiscal-verifactu test:coverage` and read the per-file table for `hour-*.ts`,
  `minute`-named files and `setup/*.ts` (98/98/98/95; CLAUDE.md §2 — never an ignore comment); CI
  runs the rest.
- [ ] **Step 4: Commit** any guard fix — `chore: guards for slice 4a`.

## Task 15: Visual check (the controller dispatches it)

Opens the real pages; a page asserted as a string proves nothing about how it renders (CLAUDE.md
§4).

- [ ] **Step 1:** start the dev stack from this worktree (`wa-wt onboarding <worktree-name>`;
  `wa-wt reset` first if the slot's venue holds four-symbol names — check `lsof` on the venue
  folder and port 8080 before a reset). Reach the setup page and the restore page in the
  workspace's Playwright Chromium.
- [ ] **Step 2: Which states the real stack can show.** In development `/setup-api` goes through
  Vite's proxy (`apps/setup/vite.config.ts:18-20`), so the server sees `127.0.0.1` for every
  browser and every browser counts as the box: a "clocks differ" state cannot be reached there,
  because the browser's reading is discarded before any comparison. So:
  - **real stack**: "waiting with countdown" (the internet clock reachable — it is the second
    clock) and "no second clock" (the internet clock made unreachable for the run);
  - **component shots** for "refused, clocks differ": the two screens mounted in the
    fiscal-verifactu browser project with the API double answering that state, captured with
    Vitest browser mode's `page.screenshot`, from a harness kept outside the repository
    (`~/waitron-campaign/a947-4a-shots/harness/`, run with `--config` as the review's probes were).
  Light and dark, at 1280 px and 390 px wide: 2 pages × 3 states × 2 themes × 2 widths = 24 shots,
  named `<page>-<state>-<theme>-<width>.png`, into `~/waitron-campaign/a947-4a-shots/`. A
  development box needs the internet to finish a setup for the same reason; say so in the PR.
- [ ] **Step 3: Compare with mock-up 8**
  (`docs/backlog/mockups/a947-two-box-failover/8-waiting-explained.png`): the why, the what-to-do,
  the countdown (or what ends the wait), the readings; nothing clipped at 390 px; contrast in dark.
  LOOK at every shot. Report differences as a list; fix only text or layout the spec fixes.
- [ ] **Step 4: Commit** fixes, if any — `setup: visual fixes from the slice 4a check`.

---

## Changed test checks

Every existing assertion this plan changes, and the design line that changes it. Literal-only
changes from four to five symbols (Tasks 2–3) are not listed one by one: the spec, §11 slice 4a,
"tests that assert a four-symbol code change with them".

| Existing check (file: test) | Becomes | Why (spec) |
| --- | --- | --- |
| `hour-identity.test.ts`: four-symbol encode, decode and `isHourIdentity` length 4 | five symbols, minutes | §6.5 "The shape" |
| `hour-clock.test.ts:46` "includes uncertainty when applying the disagreement threshold" (120 s, range edges) | 30 s, from the box to each reading's middle | §6.5 clock rule 2 |
| `hour-clock.test.ts:67,78` the UTC-hour boundary waits | deleted; a case that 2 ms across an hour is selectable | §6.5 "The hour-boundary wait goes" |
| `hour-clock.test.ts:115,128,139,149,209` confirmation requirements and copied confirmations | no confirmation exists; `second_clock_missing` / `clock_disagreement` | §6.5 "with no confirmation" |
| `hour-setup-clock.test.ts:77,91,214` confirmation bound to a comparison; "manual confirmation never overrides … release floor" | the release floor refuses with no confirmation path at all | §6.5 |
| `hosted-hour-recovery.test.ts:175,198,441,485` (confirmation, yes/unknown answers, reported codes as a floor) | no answer, no confirmation, no code | §6.2 "What the dialog does not ask"; §6.7 |
| `hour-selection.test.ts:250,261,281,452` (bound confirmations; yes/unknown wait for the next hour; the answer cannot be changed; three offered answers) | the minute rules and the settle wait; no answer | §6.5 rules 1–5; §6.7 rule 2 |
| `hour-selection.test.ts:286,302,309` (waits for the next hour) | the same properties for a minute-start target | §6.5 rule 3 |
| `reported-hour-codes.test.ts` (whole file) | deleted with the module | §6.7 "the restore form stops asking for it" |
| `initial-hour-setup.test.ts:356,438,450,462,502,537,550` (terminal confirmation, the question, the hour boundary, resuming without the question) | the terminal prints why and refuses without a second clock; no question | §6.5; §6.2 |
| `initial-hour-setup.test.ts:573` "refuses a delivered sheet whose installation code differs" | the sheet has no code; the check compares the key and scope only | §6.7 |
| `setup/first-hour.browser.test.ts:202` (taxpayer-wide answer), `:243` (fresh displayed-clock acceptance), `:528` (a wait with no numeric countdown) | no answer; no acceptance; a wait always has a countdown, and no-second-clock has none | §6.5 "Every wait explains itself" |
| `setup/first-hour.browser.test.ts:442` "a displayed countdown reaching zero never imports an hour without the server" — asserts `candidates` called once | at zero the page goes back to the server: `candidates` twice, still no import without `selected` | §6.5 "at zero the page checks the clocks again and asks for the name" |
| `setup/recovery-hour.browser.test.ts:164,176,186,225,255,348,398,541,567,598,630,656,672` (the answer group, confirmation, the code field, the hour clash) | removed or rewritten to the four explained states; no code | §6.7; §6.5 |
| `apps/setup/src/screens/recovery-hour.test.ts`, `initial-setup-hour.test.ts` (answers, codes) | no answer, no code | as above |
| `packages/provisioning/src/cli-same-hour-entry.test.ts` (the terminal's same-hour entry) | the terminal's settle wait, printed with its time | §6.7 rule 2 |
| `minute-selection-unknown-name.test.ts` S (Task 8) | after Task 9a: a proposal still carrying `installationCodes` is refused `event_mismatch` | §6.7 "the restore form stops asking for it" |
| `hour_not_later` expected in `apps/server/src/cloud-fiscal-allocation.test.ts`, `first-fiscal-hour-finish.test.ts`, `first-setup-retired-assignments.test.ts`, `hour-promotion.test.ts`, `hour-recovery-host.test.ts`, `hour-recovery-placement-3.test.ts`, `restore-emergency-attempts.test.ts`, `restore-emergency-crash.e2e.test.ts`, `packages/provisioning/src/first-setup-runtime.test.ts` (`git grep -l hour_not_later` outside the fiscal package, on the base) | `minute_not_later` (Tasks 6d–6e) | §6.5 rule 4; Global constraints |
| Every test above that expects a setup or restore to select at once (Task 6a's list of about 50 files) | selects after the settle wait, on the injected clock | §6.7 rule 2 |
| `apps/server/src/first-fiscal-launch.test.ts` (the command run as a child process selects a name) | the child process prints the wait and exits; the continuation is in process | §6.7 rule 2 |
| `packages/provisioning/src/first-setup-preparation.ts:205-208` behaviour: a waiting answer spends the owner's grant (pinned wherever a test expects a second waiting call to be refused) | a wait spends nothing; only the take does | rulings, H1; §6.5 "Nothing to do; keep this page open" |

## Mutation

`packages/fiscal-verifactu` has no Stryker config: `git ls-files | grep stryker` on the base lists
`packages/db`, `packages/fiscal`, `packages/shared`, `packages/ui-core` and `packages/ui` only, and
CLAUDE.md §2's "`fiscal`" is `packages/fiscal`, whose `mutate` list is `src/clock.ts` and
`src/backend.ts` (`packages/fiscal/stryker.config.json:7`), neither touched. So no new file falls
under a `mutate` list and no mutation floor bites this slice. The obvious mutants are killed
anyway, and the kill is shown by hand in Tasks 4, 6b and 8: the 30 000 / 30 001 pair, the
150 000 / 150 001 pair, the 90-second bottom (`09:00:29.999Z` → 90.001 s) and top (`09:00:30Z` →
150 s) of the settle wait, the `+ 1` minute, and the deletion of the disagreement and settle terms.
Whether `fiscal-verifactu` should gain a Stryker config is a backlog question (Driver steps).

## The countdown, in one place

Driven by the server: the select answers `remainingMs`, computed from the process's monotonic
timer and the stored target (`hour-selection.ts:502-515`, kept). The page counts it down on
`performance.now()` every 250 ms, in `setup/wait-countdown.ts` (Task 10 moves today's setup-page
timer, `first-hour.ts:110-131`, there; the restore page has none today and gains it in Task 11).
At zero the page runs a fresh clock comparison and asks again, re-sending the one password grant
it already holds on the setup page (Task 6f); the server takes the name only if that comparison
passes and the box's clock has reached the target, else answers a new `remainingMs` or a refusal.
A reload asks `preview` and resumes the server's countdown. With no second clock, a `setInterval`
of 15 s re-checks. Tested with `vi.useFakeTimers({ toFake: ["setInterval", "clearInterval",
"performance"] })` set before the press and restored in a `finally` — `setTimeout` and
`requestAnimationFrame` stay real so `userEvent`, Lit's updates and `vi.waitFor` do not stall
(CLAUDE.md §4); exact `m:ss` only after `advanceTimersByTime` and `updateComplete`; Task 10's
Step 0 proves the fake takes in browser mode first, with an injected `now` as the fallback.

## Driver steps

- **Backlog:** the A947 entry (`docs/backlog.md:5857`) — slice 4a built and parked for the owner to
  land; next, slice 3a. New short entries: rename the `hour-*` files and the stored `source:
  "hour"` to minute names (a pre-live rename, Global constraints); whether `fiscal-verifactu` gets
  a Stryker config; how a phone carries on a first setup begun on the box's own screen (spec §13,
  B3's).
- **The PR's first lines:** "**Fiscal — the owner lands this.** A947 slice 4a: every installation
  code is five symbols for the UTC minute; a name needs a second clock within 30 seconds; a setup or
  restore waits 90 to 150 seconds, with a countdown; the recovery sheet and the restore form lose
  the installation code. No migration and no shipped migration file is touched. Development and
  demo boxes holding four-symbol names must be reset (`wa-wt reset demo <name>`)." If a task did
  touch a shipped migration, the first line instead says it ships only with a venue reset.
- **The proof's receipt in the PR description** (Task 8, Step 2b): the command, its `Tests`
  count and the commit sha of the run in which rows S, D1 and E2 passed while the typed code still
  existed — squash merging removes that commit from `main`, and CI never runs it.
- **Task 10b's measured gaps** in the PR description.
- **FYI to the owner** (not a question): the clock refusal's approved «…o corrige la que esté mal»
  is replaced by his own 03:12 words (design amendment); the setup page tells a person on the box's
  screen to cancel and start again from a phone, because a phone cannot carry on that setup.
- **Decisions to record** in the spec's §6.5 or the fiscal area's "Decisions and deliberate
  limits": the stream loop test gains no step in 4a (it allocates through paper fixtures); a
  recorded wait expires 60 s after its target; a wait spends no password; the restore stages its
  backup once; a kiosk browser in a container on a Docker bridge would count as another device
  (design §13, for B3); the browser counts as the box by its source address on any interface, Docker bridges
  included; the 15-second re-check with no second clock; the settle target taken from the box
  reading at the first select (never earlier than the checked reading); the command-line setup
  prints the time instead of counting down; file names and the stored `"hour"` label kept for now.
- **Review:** full path. The Codex run-it seat twice; the second told to set this plan aside and
  test what it does not name.
- **Owner:** the owner lands it; tell the owner the PR is ready, with its CI result on the current
  head.
