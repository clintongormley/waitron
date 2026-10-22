# A947 slice 4a — five-symbol minute names and the clock rule: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"` (medium effort). An implementer past about 150 tool calls with its
> task unfinished stops at a passing (or cleanly red) point, commits, and returns a handover —
> done, left, files, each check's state.

**Goal:** every installation code a box takes — setup, switch, hand-over, restore, re-registration
— is five symbols for the UTC minute; a name is taken only after a clock check against a clock on
another machine (box within 30 seconds, ahead or behind, no confirmation); a setup or restore
takes its name 90 to 150 seconds after the check; the "last hour" question, the recovery sheet's
installation code and the restore form's code field go; the setup and restore pages explain every
wait with a countdown.

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
   the restarted box neither takes the name early nor starts a new 90 s. Pinned in Task 6
   ("a restart keeps the recorded target").
4. **The no-second-clock page left open when the internet comes back** — expected: within 15
   seconds it carries on by itself, without another press. Pinned in Tasks 10 and 11.
5. **A clock exactly 30 s off, and a known later minute exactly 150 s ahead** — expected: both
   pass (inclusive bounds), 1 ms more refuses. Pinned in Tasks 4 and 6.

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
| `hour-selection.ts:438-533` — the chosen installation code (`identity: encodeHourIdentity(now)`, `:528`) | minute code, rules 1–5, the setup/restore wait | Task 6's rule tests; Task 8's `minute-selection-unknown-name.test.ts` |
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
  `hour-throwaway-allocation.ts:34`, `reported-hour-codes.ts:2,13` (deleted in Task 9),
  `recovery-document.ts:65` (field deleted in Task 9), `setup/first-hour.ts:302`,
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
  MINUTE_MS` (the hour-boundary uses of `HOUR_MS` stay until Task 4 and Task 6 delete them — keep a
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
  waited, selected, which reason) is not changed here — the ones the design changes are Tasks 4, 6
  and 9's, listed under "Changed test checks". A test whose only purpose was "four symbols" is
  rewritten to five, not deleted.
- [ ] **Step 3: Run the node project again** — a full PASS: nothing in Tasks 1–2 changes
  behaviour, so the confirmation and hour-wait cases Tasks 4 and 6 later rewrite still pass here.
  Then the browser project for the two screens' regex: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser
  src/setup/first-hour.browser.test.ts src/setup/recovery-hour.browser.test.ts` — PASS.
- [ ] **Step 4: The fiscal gates, unedited:** the Global constraints command — `Tests 20 passed`.
- [ ] **Step 5: Commit** — `test(fiscal): minute codes in fiscal-verifactu's tests`.

## Task 3: The other packages' tests and harnesses use minute codes

**Files:** `apps/server/src/testing/backup-verification-fixture.ts:123,126,313`,
`apps/server/src/testing/staged-hour-crash.ts`, `staged-hour-restore.ts`,
`apps/server/test/hour-recovery-host.ts`, `owned-hour-setup.ts`, `hour-recovery-delivery.ts`,
`hour-first-fiscal.ts`; failing tests in `apps/server` (37 files match the literal grep on the
base), `packages/provisioning` (13), `packages/composition/src/allocation-configuration.test.ts`,
`apps/setup/src/**` (4).

- [ ] **Step 1: Run each package's hour suites and list failures:** `pnpm --filter @waitron/server
  exec vitest run hour first-fiscal backup-verification recovery first-setup`, `pnpm --filter
  @waitron/provisioning exec vitest run`, `pnpm --filter @waitron/composition exec vitest run
  src/allocation-configuration.test.ts`, `pnpm --filter @waitron/setup exec vitest run
  src/screens/initial-setup-hour.test.ts src/screens/recovery-hour.test.ts` — expected: failures on
  four-symbol literals only. (A name-filtered run proves only the files it loads — CLAUDE.md §2;
  CI runs the rest.)
- [ ] **Step 2: Recompute each literal** as in Task 2, Step 2; `backup-verification-fixture.ts:313`
  keeps its "4 hours before" instant and encodes it as a minute.
- [ ] **Step 3: Re-run Step 1's commands** — PASS.
- [ ] **Step 4: Commit** — `test: minute codes in the server, provisioning and setup tests`.

## Task 4: The clock rule — a second clock always, 30 seconds either way, no confirmation

**Files:**
- Modify: `packages/fiscal-verifactu/src/hour-clock.ts:25-33,111-159`;
  `hour-setup-clock.ts:80-148` (the `compare` signature; `read` loses `confirmationId`);
  `hosted-hour-recovery.ts:34,53,105,114-123,142` (the `confirm-clock` branch and `confirmed` map
  go); `hour-preparation.ts:185-206` (`confirmClock` goes); `initial-hour-setup.ts:83-111,221-226`
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
read(key: string): { clock: HourClockDecision };
```

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

`addressIsBox`: strips a `::ffff:` prefix and an IPv6 zone (`%eth0`); true for `undefined`, any
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
  `127.0.0.1`) answers `secondClock: false` with the browser `same_machine`. A test cannot connect
  from a non-local address, so the "another device" control is the route's `requestFromBox`
  dependency injected as `() => false`, answering `secondClock: true` for the same body.
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

## Task 6: The selection's minute rules, and the setup and restore wait

**Files:**
- Modify: `packages/fiscal-verifactu/src/hour-selection.ts` — remove `Answer` and `answer`
  (`:31,35,47,141,241,281,303-307,377-382,395`), the hour wait (`:492-523`, target `:498`), the
  `% HOUR_MS` check on a saved wait (`:165-173` becomes `% MINUTE_MS`, and its `answer === "no"`
  term goes); replace `:464-471` with rules 1–4; `hour-recovery-preparation.ts` and
  `hour-preparation.ts` (`select` loses `answer`); `hosted-hour-recovery.ts:78-87` (proposal
  `["action", "installationCodes"]` — the code goes in Task 9); `initial-hour-setup.ts:158-196`
  (the terminal's question at `:178-191` goes) and `:229-246` (`candidates` takes `{}`)
- Test: `hour-selection.test.ts`, `hour-recovery-preparation.test.ts`, `hour-preparation.test.ts`,
  `hosted-hour-recovery.test.ts`, `initial-hour-setup.test.ts`, `hour-resumption.test.ts`,
  `apps/server/src/hour-promotion.test.ts`, `packages/provisioning/src/cli-same-hour-entry.test.ts`

**Interfaces — produces:** `select(request: { binding; authority; reportedIdentities? })` returns
`{ status: "selected", identity, issuedAt, … }`, `{ status: "preview", … }` or `{ status:
"waiting", targetMs: number, remainingMs: number }` (never `null` any more — `requiresClockConfirmation`
goes); refusals as in Global constraints.

The rules, computed after `canSelectHour` passes, with `now` the box reading
(`hour-selection.ts:438`):

```
earliestMs = max(
  greatestSpentMinute === null ? -Infinity : EPOCH_MS + (greatestSpentMinute + 1) * MINUTE_MS,
  recordedTimeFloorMs ?? -Infinity,
  action is "setup" or "restore" ? settleTarget : -Infinity)   // settleTarget fixed in the saved wait
settleTarget = (Math.floor((now_at_first_select + 90_000) / MINUTE_MS) + 1) * MINUTE_MS
if earliestMs - now > 150_000 and earliestMs !== settleTarget → refuse minute_not_later,
   allowedFromMs = earliestMs
if now < earliestMs → persist (once) a wait { targetMs: ceil(earliestMs to a minute start) } and
   return waiting with remainingMs from the monotonic timer (as today, :502-515)
else take encodeMinuteIdentity(now), persist the intent, then return it (rule 5, unchanged order)
```

`settleTarget` is computed once, from the box reading at the select that first records the wait,
and stored as the wait's `targetMs`; a later select for the same event reuses it (today's
`sameEvent.find(kind === "wait")`, `:425`). The setup/restore wait is never refused by the
150-second bound (it is at most 150 s by construction); only a history- or floor-driven minute
beyond 150 s is.

- [ ] **Step 1: Write the failing tests** in `hour-selection.test.ts` (a fake monotonic and box
  clock; history rows built as `hour-history-reader.ts:107-133` emits them):
  - **promote**, history holds the current minute `0D00B` (19:55:10Z), box `2026-10-23T19:55:50Z`
    → `waiting`, `targetMs` = `19:56:00Z`, `remainingMs` = 10 000; at `19:56:00Z` → selected
    `0D00C`; a third promote knowing `0D00C`, box `19:56:30Z` → waits to `19:57:00Z` (two names in
    one minute, and a third);
  - **promote**, history's latest minute begins exactly 150 000 ms ahead → waiting; 150 001 ahead →
    refused `minute_not_later` with `allowedFromMs` equal to that minute's start (the refusal names
    its time);
  - **re-register**, no later history → selected at once (no settle wait for re-register or
    promote);
  - **restore**, history knows only `0CNNW`, box `2026-10-24T09:00:04Z` → waiting, `targetMs`
    `09:02:00Z` (116 s); at `09:01:59.999Z` → still waiting; at `09:02:00Z` → selected `0D0RY`
    (mock-up 8's numbers);
  - **setup**, box `09:00:00Z` → target `09:02:00Z` (120 s); box `09:00:30Z` → target `09:03:00Z`
    (150 s, the top of the range); box `09:00:29.999Z` → `09:02:00Z` (90.001 s, the bottom). Assert
    all three, and that for 600 box readings spread over a minute every target − box lies in
    `(90_000, 150_000]`;
  - **a restart keeps the recorded target**: a second selection object (fresh `timers` map, the
    same stored state) at `09:01:00Z` answers waiting with the stored `targetMs`, not a new 90 s;
  - **the durable record before activation**: the state store's `replace` has been called with the
    intent before `select` resolves `selected` (rule 5);
  - a saved wait whose `targetMs` is not a minute start is `history_invalid`.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project node src/hour-selection.test.ts` — expected: the new cases fail (today a promote in a
  spent hour is `hour_not_later`, and restores wait for the next UTC hour).
- [ ] **Step 3: Implement** the rules above; delete the `answer` plumbing everywhere it is listed.
- [ ] **Step 4: Mutation by hand**: `150_000` → `149_999` (the exactly-150 s case fails),
  `90_000` → `89_000` (the setup bottom-of-range case fails), `+ 1` removed from `settleTarget`
  (the `0D0RY` case fails); restore each; record in the commit body.
- [ ] **Step 5: Run every test file in Files** — PASS (their `answer`/`yes`/`unknown` cases are
  rewritten per "Changed test checks"); typecheck exits 0.
- [ ] **Step 6: Commit** — `fiscal: minute rules 1–5 and the 90-to-150-second wait at setup and
  restore`.

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
the unseen name is `0CZZW` (the spare's switch, 23 Oct 19:40:50Z); the restore really happens on
24 Oct 09:00Z; the running release was committed 15 Oct. It calls
`createHourRecoveryPreparation(...).select` (`hour-recovery-preparation.ts:142-150`) with the
history in `readHourHistory`'s shape, clock decisions from `createSetupHourClock(...).compare`
with injected `wall`, `monotonic` and `internet` (so the `onBox` path is the real one), and an
in-memory state store (`~/waitron-campaign/a947r2-probes/zz-a947r2-old-backup-probe.test.ts:90-104`
shows one).

- [ ] **Step 1: Write the cases**, each asserting the outcome (not printing it):

| Case | Box | Other clocks (source) | Expected |
| --- | --- | --- | --- |
| A | 16 Oct 10:00 | browser the same | refused `minute_not_later`, `allowedFromMs` 16 Oct 11:41Z (`0CNNX`'s start) |
| A2 | 20 Oct 10:00, release 21 Oct | browser the same | refused `clock_unconfirmed` |
| B2 | 20 Oct 10:00 | browser 24 Oct 09:00 | refused `clock_disagreement`; and no proposal confirms it (`confirm-clock` refused) |
| S | as B2, with `reportedIdentities: ["0CNNW"]` (until Task 9) | browser 24 Oct 09:00 | refused `clock_disagreement` |
| B4a | 20 Oct 10:00 | browser 20 Oct 10:00, `{ onBox: true }` (loopback) | refused `second_clock_missing` |
| B4b | as B4a for a request from the box's own LAN address: the module sees only `onBox: true`; that `192.168.10.20` and `::ffff:192.168.10.20` give `onBox: true` is Task 5's `addressIsBox` case | | refused `second_clock_missing` |
| D1 | as B2 with `reportedIdentities: ["0CZZW"]` (until Task 9) | | refused (`clock_disagreement`) |
| D2 | as B2, the old database still on the disk (its history in `survivingHistory`) | | refused |
| D4 | 20 Oct 10:00 | internet 24 Oct 09:00, no browser | refused `clock_disagreement` |
| F1 | 23 Oct 21:10 (true 19:10) — a promote | browser 19:10 | refused `clock_disagreement` |
| Same minute | 23 Oct 19:40:55 | browser the same | waiting (125 s), then selected `0CZZZ` (19:43Z), greater than `0CZZW` |
| ±45 s | every phase 0–59.5 s in half seconds, gaps 0–10 s: unseen name by a box 45 s fast at `tN`; this box 45 s slow at `tN + gap`; browser 15 s slow | | after the wait, selected code > the unseen code, for every combination |
| ±45.5 s control | phase 14.5 s, gap 0, errors 45.5 s and a browser 15.5 s slow | | selected code EQUALS the unseen code — the disclosed limit, the sweep's first repeat (`restore-wait-sweep.output.txt`) |
| E1 | 24 Oct 09:00 | browser the same | waiting (120 s), then selected `0D0RY` (09:02Z), later than `0CZZW` |
| E2 | as E1 with `reportedIdentities: ["0CZZW"]` (until Task 9) | | selected, later than `0CZZW` |

The ±45 s rows use the real selection, not the sweep's arithmetic: they are the sweep's claim
re-measured on the code. (The checked box reading is 45 s slow and the browser 15 s slow, so the
clock check passes at 30 s — the 15-second allowance.)

- [ ] **Step 2: Run it** — `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/fiscal-verifactu
  exec vitest run --project node src/minute-selection-unknown-name.test.ts` — expected: PASS (the
  rules exist after Tasks 4–7). If any row fails, STOP: the design's proof does not hold, and the
  code stays on the sheet — report the row.
- [ ] **Step 3: The proof by deletion**: delete the `disagreement` term from `canSelectHour`
  (Task 4) and re-run — B2, S, D4 and F1 must fail by SELECTING (B2 selects a code earlier than
  `0CZZW`); restore; then delete the settle wait (`settleTarget` term) — the same-minute and ±45 s
  rows must fail by selecting `0CZZW`; restore. Paste both runs' failing lines in the commit body.
- [ ] **Step 4: Commit** — `test(fiscal): a restore from an old backup never reuses an unseen
  name`.

## Task 9: The recovery sheet and the restore drop the installation code

Only after Task 8 is committed green.

**Files:**
- Delete: `packages/fiscal-verifactu/src/reported-hour-codes.ts`, `reported-hour-codes.test.ts`
- Modify: `recovery-document.ts:5-14,51,62-66` (no `installationCodes`);
  `recovery-pdf-content.ts:22,121` (no «Código de instalación» row);
  `completed-recovery-document.ts:51`; `initial-hour-setup.ts:127,292-294`;
  `hosted-hour-recovery.ts:1,79,86` (proposal `{ action: "select" }` exactly);
  `hour-selection.ts:1,37,48,134-139,189-201,242,288-291,383-386,396,447` (`reportedIdentities`
  and `reportedHistory` go); harnesses `apps/server/src/testing/staged-hour-crash.ts:205,234,281`,
  `staged-hour-restore.ts:195,223`, `apps/server/test/hour-recovery-host.ts:299,409`,
  `owned-hour-setup.ts:96`, `hour-recovery-delivery.ts:18`;
  `packages/provisioning/src/first-setup-command-document.test.ts`,
  `first-setup-command.test.ts`, `first-setup-recovery-delivery.test.ts`,
  `packages/composition/src/allocation-configuration.test.ts`
- Modify the proof: `minute-selection-unknown-name.test.ts` — S becomes B2 (nothing can type a
  code any more) and is deleted as a duplicate; D1 and E2 are deleted (the field they exercised is
  gone); the commit body says so.
- Test: `recovery-document.test.ts`, `recovery-pdf*.test.ts`, `hosted-hour-recovery.test.ts`,
  `initial-hour-setup.test.ts`

- [ ] **Step 1: Write the failing tests:** `parseRecoveryDocumentPublic` refuses a document that
  still carries `installationCodes` (`exact` keys) and accepts one without; the rendered PDF's text
  (`recovery-pdf-content` lines) contains neither `Installation code` nor `Código de instalación`
  in EN and ES; `recovery(op, { action: "select", installationCodes: ["0CZZW"] }, client)` is
  refused `event_mismatch` and `{ action: "select" }` selects.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project node src/recovery-document.test.ts src/hosted-hour-recovery.test.ts` — expected: the
  document with codes is accepted; the bare select is refused.
- [ ] **Step 3: Implement**; `git grep -n -E "installationCodes|reportedHourCodes|reportedIdentities|installation_codes_invalid"
  -- apps packages ':!docs'` prints nothing. The screens import `reportedHourCodes`, so this task
  also removes the restore screen's code field and its plumbing
  (`setup/recovery-hour.ts:9,18,25,120,181-186,192,220,293,337-339,371-373,394,426-437`) and the
  setup screen's sheet code (`setup/first-hour.ts:355`), with their browser cases ("sends no
  installation code": the `select` proposal is exactly `{ action: "select" }`; "has no
  installation-code field": no element named `recovery-installation-codes`). Task 11 does the
  restore page's waits.
- [ ] **Step 4: Run Step 2's command, Task 8's test, and the provisioning and composition suites**
  — PASS; the fiscal gates — `Tests 20 passed`.
- [ ] **Step 5: Commit** — `fiscal: the recovery sheet keeps the key only; a restore asks for no
  code`.

## Task 10: The setup page explains its waits, with a countdown

**Files:**
- Modify: `packages/fiscal-verifactu/src/setup/first-hour.ts` — the question `:444,488`, its
  radios `:557-559`, `answer` in the draft and `:151,214,283`; the confirm control and its
  `confirmed` draft field (`:207-219,277-279,583-590`); the boundary and confirmation texts
  `:460`; the wait view `:110-131,600-605`
- Test: `setup/first-hour.browser.test.ts`, `setup/first-hour.a11y.browser.test.ts`,
  `setup/first-hour-reissue.browser.test.ts`

**Interfaces — consumes:** the comparison's `clock.secondClock`, `clock.disagreement`, the
browser's unavailable reason `same_machine` (Task 4); `candidates({})` answers `waiting` with a
numeric `remainingMs` (Task 6).

Behaviour (spec §6.5, "Every wait explains itself"):
- The page still compares clocks on load to show the readings. Its action («Crear las series» /
  "Make the series") is enabled once the form's own fields are complete, whatever the clock; a
  press runs a fresh `clock-challenge` + `compare-clocks` (browser `Date.now()`), then
  `candidates({})`.
- **Waiting** (`status: "waiting"`): the why, the what-to-do and «Sigue en m:ss» / "Continues in
  m:ss" (`data-test="remaining"`, `role="timer"`), counted from the server's `remainingMs` on
  `performance.now()` every 250 ms (today's mechanism, `:118-131`). At zero, it runs the fresh
  comparison and `candidates({})` again by itself: `selected` → the series; `waiting` → a new
  countdown; a refusal → its explanation. It never imports a name without the server's
  `selected`.
- **No second clock** (`secondClock` false): the why, plus the "on the box itself" sentence only
  when the browser's unavailable reason is `same_machine`; the what-to-do; «Sigue sola en cuanto el
  equipo tenga internet.» / "It carries on by itself once the box reaches the internet."; no
  countdown. Every 15 000 ms it compares again and, once `canSelect`, continues to
  `candidates({})` by itself.
- **Clock refusal** (`disagreement`, or a `clock_disagreement` refusal): the spec's refusal text,
  both readings, «Comprobar otra vez» / "Check again"; no countdown, no automatic retry.
- **`minute_not_later`**: «Todavía no se puede crear las series: ya se usó un minuto posterior a
  la hora de este equipo. Podrás seguir a partir de las {time}.» / "The series cannot be made yet:
  a later minute is already in use. You can carry on from {time}." with `allowedFromMs` in the
  venue's zone; no countdown (rule 4 is a refusal).
- Strings in the component's existing `t` objects (EN beside ES, as `:444/:488`), verbatim from the
  spec's table.

- [ ] **Step 1: Write the failing browser tests** (mount and API stub as the file's `mount` helper
  does; each test calls `vi.useRealTimers()` in a `finally`):
  - "explains a waiting setup with a countdown that goes back to the server at zero": BEFORE the
    press, `vi.useFakeTimers({ toFake: ["setInterval",
    "clearInterval", "performance"] })` — not `setTimeout` and not `requestAnimationFrame`, so
    `userEvent` and `vi.waitFor` keep working (CLAUDE.md §4, fake-timers trap); stub `candidates`
    to answer `{ status: "waiting", targetMs, remainingMs: 84_000 }` first and `{ status:
    "selected", … }` second; press; expect the why text and `1:24`; `vi.advanceTimersByTime(1_000)`;
    `await el.updateComplete`; expect `1:23` (the control that the faked clock drives the count —
    with real `performance` it would still read `1:24`); advance `83_000`; `await vi.waitFor(() =>
    expect(calls.filter(c => c.action === "candidates")).toHaveLength(2))`; expect a second
    `clock-challenge` and `compare-clocks` between the two `candidates`; expect the selected series.
  - "a countdown reaching zero imports nothing the server did not select": second answer `waiting`
    again with `remainingMs: 30_000` → a new countdown `0:30`; `input` never called.
  - "with no second clock it explains itself and carries on when the internet arrives": compare
    answers `secondClock: false` with browser `same_machine`; expect the why, the box sentence, the
    what-to-do, no `[data-test=remaining]`; then make compare answer `secondClock: true`, advance
    `15_000`, expect `candidates` called once without another press.
  - "a phone with no second clock does not say it is the box": browser unavailable `challenge` →
    the box sentence is absent.
  - "a clock refusal shows both readings and no countdown, and waits for Check again".
  - "a later minute in use names its time and does not count down".
  - a11y: each of the four states, both themes (the file's existing axe helper).
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project browser src/setup/first-hour.browser.test.ts src/setup/first-hour.a11y.browser.test.ts`
  — expected: the why text is not found.
- [ ] **Step 3: Implement**; **Step 4: re-run** (and `first-hour-reissue.browser.test.ts`) — PASS.
- [ ] **Step 5: Commit** — `setup: the setup page explains every clock wait, with a countdown`.

## Task 11: The restore page explains its waits, with a countdown

**Files:**
- Modify: `packages/fiscal-verifactu/src/setup/recovery-hour.ts` (line numbers as on the base;
  Task 9 has removed the code field) — the question
  (`:19,121,233,342,376-377,467-475`), the confirm path (`:237-238,288-289,498-524`), the boundary
  text (`:366`), the `hour_not_later` handling (`:319`), the wait line (`:526`)
- Test: `setup/recovery-hour.browser.test.ts`, `setup/recovery-hour.a11y.browser.test.ts`,
  `apps/setup/src/screens/recovery-hour.test.ts`

Behaviour: Task 10's four states and texts, on the restore page; the other declarations (old box
gone, sole recovery, the printed key) stay required before the action is enabled.

- [ ] **Step 1: Write the failing tests** — Task 10's six behaviour cases and the a11y states, on
  `vf-recovery-hour`.
- [ ] **Step 2: Run, expect failure:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  --project browser src/setup/recovery-hour.browser.test.ts src/setup/recovery-hour.a11y.browser.test.ts`
  — expected: no why text is found.
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
  counter" becomes: "every allocation names its installation from the box's clock — five symbols
  for the UTC minute — only after a check against a clock on another machine (within 30 seconds,
  no confirmation) and strictly later than every name in the history it can read; a setup or
  restore waits 90 to 150 seconds first. Guard: `minute-selection-unknown-name.test.ts`, weaker
  than its name — it covers the cases it lists, not a reference clock more than 15 seconds wrong."
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
- [ ] **Step 2: Shoot**, light and dark, at 1280 px and 390 px wide, into
  `~/waitron-campaign/a947-4a-shots/`: each page waiting with its countdown (the box's wall clock
  left alone; the wait appears on every setup), with no second clock (open the page at
  `https://127.0.0.1…` or `localhost` so the request comes from the box, with the internet clock
  blocked — `WAITRON_*` clock origin unset or unreachable), and refused for a clock more than 30
  seconds off (Playwright's `page.clock.setFixedTime` 5 minutes ahead in the browser). 2 pages × 3
  states × 2 themes × 2 widths = 24 shots, named `<page>-<state>-<theme>-<width>.png`.
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
| `minute-selection-unknown-name.test.ts` S, D1, E2 (Task 8, sheet-code cases) | removed in Task 9 — the field they exercised is gone; S's clock case is B2 | §6.7 "only if that test passes, in the same pull request" |

## Mutation

`packages/fiscal-verifactu` has no Stryker config: `git ls-files | grep stryker` on the base lists
`packages/db`, `packages/fiscal`, `packages/shared`, `packages/ui-core` and `packages/ui` only, and
CLAUDE.md §2's "`fiscal`" is `packages/fiscal`, whose `mutate` list is `src/clock.ts` and
`src/backend.ts` (`packages/fiscal/stryker.config.json:7`), neither touched. So no new file falls
under a `mutate` list and no mutation floor bites this slice. The obvious mutants are killed
anyway, and the kill is shown by hand in Tasks 4, 6 and 8: the 30 000 / 30 001 pair, the
150 000 / 150 001 pair, the 90-second bottom (`09:00:29.999Z` → 90.001 s) and top (`09:00:30Z` →
150 s) of the settle wait, the `+ 1` minute, and the deletion of the disagreement and settle terms.
Whether `fiscal-verifactu` should gain a Stryker config is a backlog question (Driver steps).

## The countdown, in one place

Driven by the server: the select answers `remainingMs`, computed from the process's monotonic
timer and the stored target (`hour-selection.ts:502-515`, kept). The page counts it down on
`performance.now()` every 250 ms (`first-hour.ts:118-131`, reused by both pages). At zero the page
runs a fresh clock comparison and asks again; the server takes the name only if that comparison
passes and the box's clock has reached the target, else answers a new `remainingMs` or a refusal.
Tested with `vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] })` set
before the press and restored in a `finally` — `setTimeout` and `requestAnimationFrame` stay real
so `userEvent`, Lit's updates and `vi.waitFor` do not stall (CLAUDE.md §4); each test's first
advance is its own control that the faked clock drives the count.

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
- **Decisions to record** in the spec's §6.5 or the fiscal area's "Decisions and deliberate
  limits": the browser counts as the box by its source address on any interface, Docker bridges
  included; the 15-second re-check with no second clock; the settle target taken from the box
  reading at the first select (never earlier than the checked reading); the command-line setup
  prints the time instead of counting down; file names and the stored `"hour"` label kept for now.
- **Review:** full path. The Codex run-it seat twice; the second told to set this plan aside and
  test what it does not name.
- **Owner:** the owner lands it; tell the owner the PR is ready, with its CI result on the current
  head.
