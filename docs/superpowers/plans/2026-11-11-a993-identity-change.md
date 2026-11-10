# A993 — a change of producer opens a new fiscal installation by itself: build plan

**Status: plan, for the watcher and the owner. Fiscal: the owner lands every slice.** Written on
`main` at `53bb877a5e`. Every `file:line` below was read on that commit; nothing was run except
the `git grep` commands quoted. Design: [A940 §5.6](../specs/2026-10-21-a940-declaracion-responsable-design.md#56-when-the-systems-identity-changes-a-new-installation-by-itself-a993)
("slice 1b" in its §10).

Terms used here. **Producer**: the person or company that makes the software and signs its
declaration; every Veri\*Factu record names its tax number. **Installation**: one copy of the
software at one taxpayer, named by a five-symbol code for the UTC minute it was opened (A947); each
has its own chain of records and its own invoice series (`A-0CNNW/1`, `/2`, …). **Chain head**: the
pointer to the latest record, from which the next record's hash continues. **Marker**: a small file
the upgrade writes in the box's state folder, naming the producer it is installing.

## What it delivers

**Smallest usable result (slices 1 and 2).** The owner can publish a release that names a new
producer (for example a future Waitron company instead of himself). Running `waitron.sh install` on
a production box then closes the box's chain and opens a new installation and new series starting
at 1, with nobody signed in, provided the box can read the internet's clock at that moment. If it
cannot, the old release is never stopped and keeps selling, and the upgrade says why. Records already
made keep the old producer and are still sent unchanged.

**Slice 3** adds the approved fallback: a box that is already running the new release without the
change made (a power cut in the seconds between the check and the change, or a release started by
hand) shows a page instead of trading, which accepts a phone's or a till's clock and counts down
every wait.

**Still unavailable afterwards:** changing the two-character software code, changing compliance
mode or fiscal module (stays a refused start, as `makeFiscalBackend` does today, `boot.ts:2091-2098`),
and any automatic (A950) upgrade across a producer change (question 5).

## Authority

- **Design approved**, owner 2026-10-22 about 02:45 (second revision, question 1), and **way A
  chosen** about 02:55 (question 2): "the upgrade changes only while it can read the internet's
  clock, and otherwise the old release keeps selling …; in the stuck case the page also accepts a
  phone's or a till's clock under A947's clock rule". Countdown: about 03:12, "But explain that on the
  screen and provide a countdown for the user to see". Recorded in design §11 and §5.6, "The stuck page".
- **Owner 2026-11-06 about 18:13**, relayed in `~/waitron-campaign/questions.md` ("A940 Task 8: the
  owner says yes to question 1, both parts"); recorded in the
  [A940 slice 1 plan](2026-10-22-a940-1-software-identity.md), "What A993 inherits": "(1) A change of
  producer stays blocked in production until A993 exists. (2) Once A993 exists, a start opens a new
  installation for a producer difference only when the upgrade's own marker names that same new
  producer; otherwise it keeps refusing."
- **Owner 2026-11-08**, lane L `RUNNER.md` ("Deliver the asked-for result", "Real events only"):
  "Build the shortest safe path to that outcome. Add a check, record, flow or migration only when it
  directly delivers the outcome or prevents a named failure"; "Write no code or test for an event
  that cannot really happen at a venue."
- **Owner 2026-11-09 16:45**, recorded in the Authority section of the
  [A802 slice 3 plan](2026-11-10-a802-correction-history.md): "each slice about 1,000 written lines
  including tests …; tests at most about twice the code."
- **Order**, owner 2026-11-10 22:05 (`~/waitron-campaign-l/questions.md`): "A1481 before A993 → A993".
- Standing rules: no venue is live, so any installation may be reset and no compatibility code is
  written (CLAUDE.md §3); the producer's placeholder values may be replaced once before any
  production start (CLAUDE.md §5).

## What it leaves out, and why

Each of these is in the approved design; leaving it out needs the owner's word, asked in question 1
or 3 below.

- **No new column.** The producer a chain was made under is read from its latest record, as Task 8
  already does (`packages/fiscal-verifactu/src/producer-change.ts:26-33`); every record stores its
  own software block (`registros_facturacion.sistema_informatico`). No migration, so nothing collides
  with A1308's planned rename of `registro_sif` and removal of `cadenas`
  (`docs/superpowers/specs/2026-11-02-rationalisation/tables-fiscal.md:240-262`, `README.md:301`).
- **Producer only.** The compliance mode cannot differ today (one mode; a module move already
  refuses). The taxpayer's tax number has no product writer: `git grep -n "update(tenants)" -- apps
  packages` finds only `taxpayer-name.ts:14` (legal name) and `privacy-contact.ts:50` (privacy
  fields) outside test fixtures. The two-character code is the constant `"W1"` (`software.ts:1`)
  and no release plans to change it.
- **No record-time guard.** The design's guard sits in chaining, which is protected core. The
  start's refusal already stops a sale on a changed producer, proven by
  `apps/server/src/boot.producer-change.test.ts:175`; the producer cannot change inside a running
  process, because it is a setting read at start.
- **No carried clock reading** (design §5.6 way A, step 3). The upgrade checks the internet's clock
  while the old release sells; the new release's start then takes its own reading seconds later. If
  the internet drops in that gap, the box falls to slice 3's page. This removes the open §12 problem
  of carrying a monotonic reading between two processes.
- **No dashboard notice.** One activity-log line, "new fiscal installation 0CNNW → 0JMV7, new
  producer", tells managers what happened (`recordActivity`, a kind declared in
  `packages/db/src/activity-kinds.ts`).
- **No "put the old release back".** Under slice 2 the old container is never stopped when the check
  refuses, so there is nothing to restore. (The script does not stop it separately today: it pulls,
  then `docker compose up -d` recreates the container, `deploy/waitron.sh:783-791`.)
- **No restart-at-boot step.** A cut during any upgrade's restart is not A993's, and the approved
  A950 plan adds a host recovery service for it
  ([A950 plan](2026-11-09-a950-shorter-upgrades.md), PR2, `waitron-upgrade-recovery.service`).
- **Preproduction unchanged** (question 2): Task 8's "trades on, the new producer on the same chain"
  stays.

The stuck page with its phone-or-till clock and countdown **is in slice 3**, not left out. It can
land after slices 1 and 2 because no production venue exists; it must land before the first one
does. Until then the stuck case shows the ordinary recovery page and retries at each restart. That
sequencing is in the owner's approved scope; slice 3 itself waits for question 4.

## Slices

Every slice: test first, watched failing; `pnpm --filter @waitron/fiscal-verifactu exec vitest run
--project node src/write-path.e2e.test.ts src/inmutabilidad.test.ts` passes **unedited**; no change
to `computeHuella`, `chain.ts`, `recordSale`, the alta builders or `registros_facturacion`'s
triggers; the activation's writes (`allocation.ts:435-478`) are called, never edited. If a slice finds
it must change any of those, it stops and asks the owner. FULL review path (fiscal risk trigger).

### Slice 1 — a production start makes the change when the marker names the running producer

**Result:** with a marker in place, a production box whose chain was made under another producer
opens a new installation at start, if the internet's clock agrees with the box's within 30 seconds,
and trades. Without one, or with one naming another producer, it refuses `sif.producer_changed`
exactly as today. The marker is written by hand or by a test until slice 2.

**Files.**
- New `packages/fiscal-verifactu/src/identity-change.ts`: compares the head record's producer with
  the running one; reads the box's and the internet's clocks (`observeInternetHourClock`,
  `hour-clock-internet.ts:40`; at most 5 seconds, `:67`) and judges them with `compareHourClocks`
  and `canSelectHour` (`hour-clock.ts:63,144`); reads the name history (`readHourHistory`,
  `hour-history-reader.ts:200`); picks the minute; then activates in one transaction. The operator
  is a new `{ kind: "identity-change", nodeId, eventId }`, and the authority is a token kept in a
  module-private `WeakSet`, so only this file can make one (the pattern of `hour-clock.ts:38`).
- `hour-selection.ts`: move the minute rule (`:437-449`: current minute, skip used minutes, refuse
  past 150 seconds) into an exported pure function both callers use. Behaviour unchanged.
- `allocation.ts` (an exported entry beside `activateAllocation`, `:129`), `allocation-envelope.ts`
  (an `identity-change` authority branch beside the hour branch at `:430`), `allocation-operator.ts` and
  `packages/module/src/operation-authority.ts:36-42` (the new operator kind). The person-only action
  lists (`allocation.ts:171`, `allocation-envelope.ts:289`, `hour-selection.ts`'s `authorize`) are not
  extended, so no route can ask for an identity change.
- `producer-change.ts` and `backend.ts` (both packages; `packages/fiscal/src/backend.ts:605`): the
  check takes the marker's producer and either passes, refuses, or makes the change.
- `apps/server/src/boot.ts:2101-2104` (same gate, `!fencedOrMirror`): read the marker, pass it,
  delete it after the change or when there is no difference. Rule 3's wait (at most 150 seconds)
  runs here, before trading. A failed clock check refuses with a new code,
  `sif.identity_change_pending`, with its reason (`second_clock_missing`, `clock_disagreement`,
  `minute_in_use` and the time it is allowed from), worded in `apps/server/src/i18n/recovery-page.ts`.
- `packages/store/src/state-layout.ts`: `identity-change.json`, deleted on reset.
- CLAUDE.md §5 (the producer line at `:941` and the new-chain line at `:949`), its topic file,
  `docs/backlog/fiscal.md`.

**Tests written first** (`identity-change.test.ts`, `useVenueDb`, fake clocks; plus new cases in
`boot.producer-change.test.ts`, whose three existing cases stay unedited):
1. Head names producer A, running B, marker names B, clocks agree → the live SIF row is new with a
   five-symbol name, the head is empty, the old series are retired, new `A-<name>` series exist.
   Fails if the change is removed.
2. Marker names C, or no marker → `sif.producer_changed` and the SIF row count is unchanged. Proof
   by deletion: delete the marker comparison and this fails.
3. Same producer, step called directly → refused, nothing written. Proof by deletion of the
   difference check.
4. Box 30 001 ms from the internet → `clock_disagreement`, nothing written; 30 000 ms → changes.
5. `identity-change` offered through `withHourAdmission` or `activateAuthenticatedAllocation` →
   `reauthentication_required`. Proof by deletion of the token check.
6. Boot: marker case trades; the first sale's record has `PrimerRegistro` S and the new name; the
   node's recovery-key verifier (`readRecoveryKeyVerifier`, `@waitron/node-db`) is unchanged; a
   mirror with a marker still opens nothing (`:199` stays).

**Guard runs:** `scripts/module-seams.test.ts`, `scripts/errors-reachable.test.ts`,
`scripts/state-layout.test.ts`, `scripts/write-path-tables.test.ts`, `apps/server/src/recovery-surface.test.ts`,
`hour-selection.test.ts` and `minute-selection-unknown-name.test.ts` unedited, the fiscal gates above.
No schema change, so the schema guards do not apply; if question 1 is answered "store it", the
column goes in through `migration-baseline rebuild` on the fiscal-verifactu set, and the slice also
runs `scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts
scripts/two-file-foreign-keys.test.ts scripts/starting-migrations.test.ts`.

**Size:** about 400 production / 650 tests.

### Slice 2 — the upgrade checks first, writes the marker, and never stops a release it cannot replace

**Result:** `waitron.sh install` on a production box changes producer by itself when the internet is
up, and otherwise leaves the old release selling and prints one of the design's three report lines
(no internet; clock off by N seconds; a later minute already used, allowed from HH:MM).

**Files.** `apps/server/src/server-command.ts` gains `prepare-identity-change` beside
`check-producer` (`:9`): opens the venue database read-only beside the running server
(`exclusive: false`, CLAUDE.md §3), compares, and on a difference writes the marker, reads the
internet clock, and waits for the allowed minute (at most 150 seconds) while the old release sells;
exit 0 when the start may proceed, 3 when it must not. `deploy/waitron.sh` `cmd_install`
(`:765-793`): after `select_image` has the new image and before `docker compose up`, run it through
`docker compose run --rm --no-deps -T --entrypoint node app /app/server.js prepare-identity-change`
(the entrypoint override `is_production` already uses, `:652-653`), under an outer `timeout`; on
exit 3, print the reason and stop without `up`. `deploy/README.md`: one main box at a time, in
different minutes.

**Tests first:** the command's cases (no difference → no marker, exit 0; difference with agreeing
internet → marker names the image's producer, exit 0; no internet → exit 3, report line, marker
written so a later hand start can finish under slice 3). `scripts/waitron-sh.test.mjs`: on exit 3 the
docker stub's log has no `up`; on exit 0 it has one. Fails if the guard is removed. First step on a
real box (read, not run so far): confirm a container that is never stopped keeps running its old
image after `pull` moves the `:main` tag.

**Guard runs:** `scripts/waitron-sh.test.mjs`, `scripts/deploy-image-env.test.ts`,
`scripts/spawn-timeout-budget.test.ts`. **Size:** about 180 production / 320 tests.

### Slice 3 — the stuck page: the internet, or a phone's or a till's clock, with countdowns

**Result:** a box running the new release with the change unmade shows a page instead of trading.
It retries the internet every 15 seconds, and accepts a reading from a phone or a till on the
venue's network (never the box's own screen) after a sign-in (question 4). It shows the design's
words and states (§5.6 table) with a live countdown for rule 3's wait, then trades.

**First step:** on a real till, check its browser can open the box's address while the box is not
trading (design §12); if not, "or a till" leaves the words.

**Files.** Reuse the waiting start (`apps/server/src/waiting-start.ts:98`, `startWaiting`, used at
`boot.ts:1875`), which already serves a page in place of trading, rechecks every 15 seconds
(`:20`) and signs a person in over HTTPS (`carry-on.ts`, `loginManager`). Generalise its words and
recheck rather than writing a second server. `request-from-box.ts:63` (`requestFromBox`) excludes the
box's own screen. Words reuse A947's (`packages/fiscal-verifactu/src/setup/wait-countdown.ts`).

**Tests first:** a reading from the box's own address is ignored; a device 31 seconds off is refused
with no SIF change; an agreeing signed-in reading makes the change and the start trades; a rule-3
wait answers the remaining milliseconds and the page counts them down. The page is opened and looked
at in both themes and at phone width (CLAUDE.md §4). **Size:** about 450 production / 550 tests.

## Open questions (each has a recommended default)

1. **Scope to the producer, and only what that needs?** No new column (read the latest record), no
   mode, no code or taxpayer check, no record-time guard, an activity line instead of a dashboard
   notice. *Example:* Bar Lucía's box made sales `A-0CNNW/1…1234` under the owner; release 1.4.0
   names Waitron S.L.; the box opens `0JMV7` and sells `A-0JMV7/1`. With or without a column the
   outcome is the same; without one there is no migration. The one difference: a chain opened and
   upgraded before its first sale would take the new producer on its first record, which is a
   consistent installation either way. **Recommended: yes.**
2. **Production only?** *Example:* a dev stack switching `WAITRON_PRODUCER_TAX_ID` keeps trading on
   its chain rather than burning a new minute name at every switch. **Recommended: yes**, as the
   owner settled for preproduction before A993.
3. **Drop the carried clock reading?** *Example:* the upgrade reads the internet at 10:15:02 and
   passes; the new release starts at 10:15:40 and reads it again. If the fibre dropped at 10:15:20,
   the box shows slice 3's page until the fibre returns or a manager uses a phone. **Recommended:
   yes**: the gap is the container restart, and the carried reading needs cross-process clock code.
4. **Must a manager sign in before a phone's or till's clock counts on the stuck page?** Still open
   from design §12; no answer found in the questions files. *Example:* without it, any phone on the
   venue's Wi-Fi supplies the clock the new installation is named by. **Recommended: yes**, the
   waiting start's existing sign-in (email, password, authenticator code).
5. **A950 and a producer change.** A950's readiness makes a test sale on a copy and never reaches
   AEAT (its plan, "Checks/trial"), so a copy of a box needing the change can neither change nor sell.
   **Recommended:** a release that changes the producer is installed by hand with `waitron.sh
   install`; A950's attempt treats a needed change as "not ready" and leaves the old release running.
   One line in A950's plan, which Lane F is building now.

## Risks to which chain a record joins

| Risk | Guard |
| --- | --- |
| A sale joins the old chain under the new producer | Task 8's refusal stays for every case where the change is not made; `boot.producer-change.test.ts:175` unedited |
| A stray setting opens a new installation (name burned, series restart) | Production, a difference, and a marker naming the running producer, all required; proof by deletion (slice 1, tests 2 and 3) |
| A name taken from a wrong clock | A second clock is always required, within 30 seconds; no throwaway path (`hour-throwaway-allocation.ts:26-30` stays preproduction-only) |
| A half-made change | One transaction through the unchanged activation; a crash after commit leaves no difference, so the next start deletes the marker |
| A spare opens an installation | The `!fencedOrMirror` gate; the mirror case stays |
| Two venues of one taxpayer take the same minute | A947's disclosed limit; slice 2's runbook line |
| A950 rolls back after the change | Question 5 keeps producer changes out of automatic attempts |

## Found no longer true in the design (October line numbers)

- Activation actions are `setup`, `restore`, `promote`, `conflict-switch`; there is no
  `re-register` (`allocation-envelope.ts:289`, `allocation.ts:171`). Admission now uses the
  five-symbol minute form (`:451`), not the hour form.
- Activation writes are `allocation.ts:435-478`; `assertNotAhead` is `node-entry.ts:258`, called at
  `:666`; the drain's grouping is `drain.ts:645`.
- The producer check runs on every node neither fenced nor a mirror (`boot.ts:2101`), not behind
  `singletonPass` (now `boot.ts:3726`).
- The recovery-key verifier lives in `node.db` (`readRecoveryKeyVerifier`, `@waitron/node-db`), not
  `readBreakGlassVerifier` in `packages/db`.
- `waitron.sh install` has no separate stop or migrate step: it pulls, then `docker compose up`
  recreates the container, and the new server migrates as it starts (`waitron.sh:783-791`).
- A page served instead of trading now exists (A1018's waiting start), and A950 has an approved plan
  with its own recovery service, where the design called A950 "not yet designed".
- A1308 plans to rename `registro_sif` and remove `cadenas`, where the design adds columns.
