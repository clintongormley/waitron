# A993 — a change of producer opens a new fiscal installation by itself: build plan

**Status: plan, revised 2026-11-11 for a fresh review; for the watcher and the owner. Fiscal: the
owner lands every slice.** Written on `main` at `53bb877a5e`. Every `file:line` below was read on
that commit; nothing was run except the `git grep` commands quoted. Design:
[A940 §5.6](../specs/2026-10-21-a940-declaracion-responsable-design.md#56-when-the-systems-identity-changes-a-new-installation-by-itself-a993)
("slice 1b" in its §10). Question 0 asks whether to build it now.

Terms. **Producer**: the person or company that makes the software and signs its declaration; every
Veri\*Factu record names its tax number. **Installation**: one copy of the software at one taxpayer,
named by a five-symbol code for the UTC minute it was opened (A947), with its own chain of records
and invoice series (`A-0CNNW/1`, `/2`, …). **Chain head**: the pointer to the latest record.
**Marker**: a small file in the box's state folder, written by the upgrade, naming the release it is
installing, that release's producer and the installation being closed.

## What it delivers

**Smallest usable result (slices 1a, 1b and 2).** The owner can publish a release naming a new
producer (a future Waitron company instead of himself). Upgrading a production box to it then closes
the box's chain and opens a new installation and new series starting at 1, with nobody signed in,
provided the box can read the internet's clock. If it cannot, the upgrade does not replace the old
release, which keeps selling. Records already made keep the old producer and are sent unchanged.

**Slice 3** adds the approved fallback: a box already running the new release with the change unmade
shows a page instead of trading, which accepts a phone's or a till's clock and counts down every wait.

**Still unavailable afterwards:** changing the two-character software code, changing compliance mode
or fiscal module (stays a refused start, `boot.ts:2091-2098`), and a producer change inside an
automatic (A950) upgrade (question 5).

## Authority

- **Design approved**, owner 2026-10-22 about 02:45 (second revision, question 1); **way A chosen**
  about 02:55 (question 2): "the upgrade changes only while it can read the internet's clock, and
  otherwise the old release keeps selling …; in the stuck case the page also accepts a phone's or a
  till's clock under A947's clock rule". Countdown, about 03:12: "But explain that on the screen and
  provide a countdown for the user to see". Recorded in design §11 and §5.6, "The stuck page".
- **Owner 2026-11-06 about 18:13** (`~/waitron-campaign/questions.md`, "A940 Task 8: the owner says
  yes to question 1, both parts"; recorded in the [A940 slice 1 plan](2026-10-22-a940-1-software-identity.md),
  "What A993 inherits"): "(1) A change of producer stays blocked in production until A993 exists.
  (2) Once A993 exists, a start opens a new installation for a producer difference only when the
  upgrade's own marker names that same new producer; otherwise it keeps refusing."
- **Owner 2026-11-08**, lane L `RUNNER.md`: "Build the shortest safe path to that outcome. Add a
  check, record, flow or migration only when it directly delivers the outcome or prevents a named
  failure"; "Write no code or test for an event that cannot really happen at a venue."
- **Owner 2026-11-09 16:45** (Authority section of the [A802 slice 3 plan](2026-11-10-a802-correction-history.md)):
  "each slice about 1,000 written lines including tests …; tests at most about twice the code."
- **Order**, owner 2026-11-10 22:05 (`~/waitron-campaign-l/questions.md`, "OWNER 2026-11-10 22:05"):
  "**A1481 before A993** → A993".
- Standing rules: no venue is live, so any installation may be reset and no compatibility code is
  written (CLAUDE.md §3); the placeholder producer values may be replaced once before any production
  start (CLAUDE.md §5).

## What it leaves out or narrows, and why

Each departs from the approved design and needs the owner's word (questions 1–3).

- **No new column.** A chain's producer is read from its latest record, as Task 8 does
  (`producer-change.ts:26-33`); every record stores its own software block. No migration, so nothing
  collides with A1308's planned rename of `registro_sif` and removal of `cadenas`
  (`specs/2026-11-02-rationalisation/tables-fiscal.md:240-262`, `README.md:301`).
- **Producer only.** The mode cannot differ today. The taxpayer's tax number has no product writer:
  `git grep -n "update(tenants)" -- apps packages` finds only `taxpayer-name.ts:14` (legal name) and
  `privacy-contact.ts:50` (privacy fields) outside test fixtures. The code is the constant `"W1"`
  (`software.ts:1`).
- **No record-time guard.** It would sit in chaining, which is protected core. The start's refusal
  already stops a sale on a changed producer (`boot.producer-change.test.ts:175`), and the producer is
  a setting read once at start.
- **No carried clock reading** (design way A, step 3). The change always happens at the new release's
  start, never inside the upgrade; the upgrade only checks first (question 3).
- **No frozen-database test until go-live.** The upgrade's check reads the old release's database with
  the new release's code (design §5.6 step 1, §12). Before go-live every box can be reset, so the check
  fails closed on anything it cannot read (slice 2) instead. From go-live, when releases may change
  those tables' shape, a test against the previous release's frozen database (A799's) is required.
- **No dashboard notice.** One activity-log line, written in the activation's own transaction
  (`recordActivity`, a kind in `packages/db/src/activity-kinds.ts`).
- **No restart-at-boot step.** A cut during any upgrade's restart is A950's: its PR2 adds a host
  recovery service ([A950 plan](2026-11-09-a950-shorter-upgrades.md)).
- **Preproduction unchanged** (question 2): Task 8's "trades on, the new producer on the same chain".
- **In slice 1b alone a hand-written marker is accepted**, until slice 2 writes it. A narrow
  departure from "the upgrade's own marker": the file must name the exact running build and the live
  installation, so it cannot outlive one deliberate upgrade.
- **Open departure, docs only:** design §5.6 asks for asesor Q53(d)(2) to be widened to cover
  cancellations and corrections of old invoices made on the new chain;
  `docs/compliance/asesor-questions.md:2037-2040` lacks it. Slice 1a adds the design's wording there.
  The release-notes line belongs to A940 slice 2's release runbook, not yet built.

The stuck page with its phone-or-till clock and countdown **is in slice 3**. Until it lands, the stuck
case retries the internet in-process (slice 1b) with no page; it must land before the first venue.

## Slices

Every slice: test first, watched failing; `pnpm --filter @waitron/fiscal-verifactu exec vitest run
--project node src/write-path.e2e.test.ts src/inmutabilidad.test.ts` passes **unedited**; no change to
`computeHuella`, `chain.ts`, `recordSale`, the alta builders or `registros_facturacion`'s triggers; the
activation's writes (`allocation.ts:435-478`) are called, never edited. If a slice needs any of those
changed, it stops and asks the owner. FULL review path. No schema change; if question 1 is answered
"store it", the column goes in through `migration-baseline rebuild` on the fiscal-verifactu set and
that slice also runs `scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts
scripts/two-file-foreign-keys.test.ts scripts/starting-migrations.test.ts`.

### Slice 1a — the fiscal module can open an identity-change installation (not yet called)

**Result:** main unchanged in behaviour; `fiscal-verifactu` exports one entry that opens the new
installation in one transaction, and nothing else can reach it.

**Files.**
- New `identity-change.ts`: compares the head record's producer with the running one; takes clock
  readings through `createSetupHourClock` (`hour-setup-clock.ts:43`), which supplies the release floor
  (`readHourRelease`; `compareHourClocks` refuses without one, `hour-clock.ts:126-129`, so an
  unstamped build never changes); reads the history (`readHourHistory`, `hour-history-reader.ts:200`)
  plus names reserved by unfinished setups and restores (`publicHourSelectionHistory`,
  `hour-selection.ts:193`, as `:396-412` does); picks the minute; activates; writes the activity line.
- `hour-selection.ts`: move the minute rule (`:437-449`) into an exported pure function both use.
- `allocation-envelope.ts`: a third mode, `identity-change`, with its own approval
  `{ version: 1, kind: "identity-change", eventId, sourceId: <old SIF row id>, targetNodeId,
  operatorId, release: <build version> }`. `validateEnvelope` dispatches on it before the person
  statements (`:389-415`: old machine offline or absent, no parallel recovery, re-authentication);
  that mode accepts only this approval and the identity-change authority, and every other mode
  refuses both.
- `allocation.ts` (an exported entry beside `activateAllocation`, `:129`), `allocation-operator.ts` and
  `packages/module/src/operation-authority.ts:36-42` (operator `{ kind: "identity-change", nodeId,
  eventId }`, shown as "identity change at release ‹version›"). The authority is a token kept in a
  private `WeakSet` in `identity-change.ts` (as `hour-clock.ts:38`), bound to the node, the old SIF row
  id and the release version, and deleted after one use: the design's binding, adopted. The person
  action lists (`allocation.ts:169-171`, `allocation-envelope.ts:289`, `hour-selection.ts:276`) are not
  extended.
- `docs/compliance/asesor-questions.md`: Q53(d)(2) widened with the design's wording.

**Tests first** (`identity-change.test.ts`, `useVenueDb`, fake clocks):
1. Head names producer A, running B, clocks agree → a new live SIF row with a five-symbol name, empty
   head, old series retired, new `A-<name>` series, one activity line. Fails if the change is removed.
2. Same producer → refused, nothing written. Proof by deletion of the difference check.
3. Box 30 001 ms from the internet → `clock_disagreement`, nothing written; 30 000 ms → changes.
4. The new entry called with an authority minted by the exported `withOperationAuthority`
   (`operation-authority.ts:51`) → refused. Deleting the `WeakSet` check makes it fail.
5. A used token, or one bound to another SIF row or version → refused.
6. An identity-change approval under `recovery` or `initial-setup`, and a recovery approval under
   `identity-change` → refused.
7. A name reserved by an unfinished restore in the preparation state is not taken.

**Guard runs:** the fiscal gates above, `hour-selection.test.ts` and
`minute-selection-unknown-name.test.ts` unedited, `scripts/errors-reachable.test.ts`,
`scripts/write-path-tables.test.ts`. **Size:** about 330 production / 600 tests.

### Slice 1b — a production start makes the change when a matching marker is present

**Result:** a production box whose chain was made under another producer, holding a marker that names
its own running build, its own producer and its live installation, opens the new installation at
start and trades. Without such a marker it refuses `sif.producer_changed` as today.

**Files.**
- `apps/server/src/boot.ts:2101-2104`: the refusal check stays on `!fencedOrMirror`; the change runs
  only when `acceptingSales` (`:2047`). When the internet or clocks do not allow it yet, the start
  waits in-process, retrying every 15 seconds and logging `sif.identity_change_pending` with its
  reason. It never exits, so the three-failure recovery page (`RECOVERY_AT = 3`,
  `recovery-state.ts:42`; served by `node-entry.ts:560-585` until a person presses Retry) is not
  reached. Rule 3's wait (at most 150 seconds) runs the same way.
- Marker (`identity-change.json` in `packages/store/src/state-layout.ts`, deleted on reset): honoured
  only when its build version, producer and old installation all match; deleted only by a start of
  the build it names that finds no difference left (after the change, or after a crash between the
  commit and the delete). A start of any other build leaves it alone, so restarting the old release
  never discards a pending upgrade's marker.
- `packages/fiscal/src/backend.ts:605` and both backends: the check takes the marker.
- CLAUDE.md §5's producer line (`:941`) becomes: a production start opens a new installation for a
  different producer only with the upgrade's marker naming its build; otherwise it refuses
  `sif.producer_changed`; do not change the tax number on a published image until A993's slice 3 has
  landed. The publish job's `WAITRON_PRODUCER_CHANGE_ALLOWED` refusal stays as the deliberate act.
  The new-chain line (`:949`) gains the identity change. `docs/backlog/fiscal.md` updated.

**Tests first** (new cases in `boot.producer-change.test.ts`, above the mirror case, which stays last,
`:197-198`; the three existing cases unedited):
1. Matching marker → trades; the first sale's record has `PrimerRegistro` S and the new name; the
   node's recovery-key verifier (`readRecoveryKeyVerifier`, `@waitron/node-db`) is unchanged.
2. Marker naming another producer, another build or another installation → `sif.producer_changed`,
   no SIF row added. Proof by deletion of each comparison.
3. Internet unavailable → the start is still waiting after two retries and the failure count is
   unchanged; the internet returns → it changes and trades.
4. A start of a different build with a marker present leaves the marker in place.

**Guard runs:** `scripts/module-seams.test.ts`, `scripts/state-layout.test.ts`,
`apps/server/src/boot.failed-start.test.ts`, the fiscal gates. **Size:** about 160 production / 320 tests.

### Slice 2 — the upgrade checks first, as a step in A950's attempt

**Result:** an upgrade of a production box to a producer-changing release writes the marker and lets
the new release start only when the internet's clock agrees; otherwise the old release keeps selling
and the upgrade reports one of the design's three reasons.

**Where it goes.** A950's approved plan rewrites `waitron.sh install` (its PR2 and PR8), keeps the old
and new image ids, and puts the old images and files back when an attempt fails ("Copy/recovery").
Today's `cmd_install` changes the box before any check could run: `refresh_self`, `fetch_box_files`,
AppArmor and the box service, then `select_image`, which pulls `:main` (moving its tag) or writes
`.env`'s image lines for a branch (`waitron.sh:765-783`, `select_image` at `:401-442`), so after a refusal the next
`docker compose up` of any kind would start the new release. So slice 2 is **a step inside A950's
attempt**, after the candidate image is resolved and before the old release stops, relying on A950's
restore when it refuses. It is built after A950 PR2; the order is for the watcher to settle with
lane F.

**Files.** `apps/server/src/server-command.ts` gains `prepare-identity-change` beside `check-producer`
(`:9`), run with the candidate image and `--entrypoint node` (as `waitron.sh:676` does). It opens the
venue database read-only beside the running server (`exclusive: false`, CLAUDE.md §3). On a mirror or
fenced box (node mode from `node.db`, fence from the held membership, as boot reads them) it exits 0
and writes nothing: a spare that was once the main box holds its own old chain (A940 plan, "The fifth
point"). It clears a marker naming another build, compares, and on a difference writes the marker,
reads the internet clock and waits for the allowed minute while the old release sells. Exits: 0
proceed; 3 not now (no internet, clocks apart, minute in use); 4 cannot read (any read error or
unknown table shape) — A950's attempt treats 3 and 4 as a failed check and never starts the new
release.

**Tests first:** no difference → exit 0, no marker; difference with agreeing internet → marker names
the candidate's build, producer and the live installation; no internet → exit 3, marker written; a
missing column or table → exit 4; mirror or fenced → exit 0, no marker; no venue database (a box not
set up) → exit 0; preproduction → exit 0, no marker. In A950's host tests: exit 3 or 4 → the new
release is not started and the old images are restored. A `--reset` install wipes the box first, so
there is no chain and the step exits 0 (one case).

**Guard runs:** `scripts/waitron-sh.test.mjs`, A950's host unit tests, `scripts/spawn-timeout-budget.test.ts`.
**Size:** about 200 production / 350 tests.

### Slice 3 — the stuck page: the internet, or a phone's or a till's clock, with countdowns

**Result:** slice 1b's in-process wait gets a page. It keeps retrying the internet every 15 seconds,
and accepts a reading from a phone or a till on the venue's network (never the box's own screen) after
a sign-in (question 4), with the design's words and states (§5.6 table) and a live countdown.

**First step:** on a real till, check its browser can open the box's address while the box is not
trading (design §12); if not, "or a till" leaves the words.

**Files.** Reuse the waiting start (`waiting-start.ts:98`, `startWaiting`, used at `boot.ts:1875`),
which already serves a page instead of trading, rechecks every 15 seconds (`:20`) and signs a person in
over HTTPS (`carry-on.ts`). Browser readings go through `createSetupHourClock`'s browser samples;
`request-from-box.ts:63` excludes the box's own screen; words reuse A947's
(`packages/fiscal-verifactu/src/setup/wait-countdown.ts`). CLAUDE.md §5's "until slice 3" clause goes.

**Tests first:** a reading from the box's own address is ignored; a device 31 seconds off is refused
with no SIF change; an agreeing signed-in reading makes the change and the start trades; a rule-3 wait
answers the remaining milliseconds. The page is looked at in both themes and at phone width
(CLAUDE.md §4). **Size:** about 450 production / 550 tests.

## Open questions (each with a recommended answer)

0. **Build it now?** With no new column, the design's reason to land before go-live ("so every
   production chain stores its identity from its first record", end of §5.6) is already met: every
   record names its producer. Design §10 has A940 slices 2–6 not depend on it. *Example:* the first
   venue goes live in the spring under the owner as producer; Waitron S.L. is formed a year later.
   Under A, A993 is built now and its upgrade step is kept working through A950's and A1308's changes
   for a year. Under B, it is built when the company's release is scheduled; until then a box given
   another tax number refuses `sif.producer_changed`, CLAUDE.md §5 forbids the change, and the publish
   job refuses it without `WAITRON_PRODUCER_CHANGE_ALLOWED`. Under C, slices 1a and 1b only now.
   **A**: as ordered on 2026-11-10. **B**: build when a producer change is scheduled. **C**: the
   fiscal core now, the upgrade step after A950. **Recommended: B**, with slice 1a's asesor wording
   done now as a docs change: nothing is lost by waiting, and slice 2 lands on an upgrade path A950 is
   still writing. If the owner wants it before go-live anyway, C.
1. **Scope to the producer, with no new column?** No mode, no code or taxpayer check, no record-time
   guard, an activity line instead of a notice. *Example:* Bar Lucía's box sold `A-0CNNW/1…1234` under
   the owner; release 1.4.0 names Waitron S.L.; the box opens `0JMV7` and sells `A-0JMV7/1`, with or
   without a column. The only difference: a chain opened and upgraded before its first sale takes the
   new producer on its first record, a consistent installation either way. **Recommended: yes.**
2. **Production only?** *Example:* a dev stack switching `WAITRON_PRODUCER_TAX_ID` keeps trading on its
   chain instead of using up a new minute name at every switch. **Recommended: yes.**
3. **Make the change always at the new release's start, never inside the upgrade?** The upgrade only
   checks first; the design's carried clock reading goes. *Example:* the check reads the internet at
   10:15:02 and passes; the new release starts at 10:15:40, reads it again and opens `0JMV7`. If the
   fibre dropped at 10:15:20, the box waits on slice 3's page until it returns or a manager uses a
   phone. **Recommended: yes.**
4. **Must a manager sign in before a phone's or till's clock counts on the stuck page?** Open since
   design §12; no answer in the questions files. *Example:* without it, any phone on the venue's Wi-Fi
   supplies the clock the new installation is named by. **Recommended: yes**, the waiting start's
   existing sign-in.
5. **A producer change inside A950.** A950's readiness makes a test sale on a copy and never reaches
   AEAT ("Checks/trial"), and its PR8 may run those checks on manual installs too, so a copy needing
   the change can neither change nor sell. **Recommended:** the copy's test sale skips only the
   identity change (the copy is discarded and its name never used), and the live start then makes it;
   to be settled with lane F, whose plan gains a line either way.

## Risks to which chain a record joins

| Risk | Guard |
| --- | --- |
| A sale joins the old chain under the new producer | Task 8's refusal stays wherever the change is not made; `boot.producer-change.test.ts:175` unedited |
| A stray setting or an old marker opens an installation | Production, a difference, and a marker naming this build, this producer and the live installation; proofs by deletion (1b, test 2) |
| A route or another caller opens one | Private one-use token bound to node, old row and version; mode refused elsewhere (1a, tests 4–6) |
| A name taken from a wrong clock or already reserved | A second clock within 30 seconds and a release floor always; unfinished reservations read (1a, tests 3, 7) |
| A half-made change | One transaction through the unchanged activation; the marker outlives a crash and is deleted only once no difference is left |
| A spare opens an installation | `acceptingSales` at start; prepare exits 0 on a mirror or fenced box |
| The check misreads the old database | Fails closed (exit 4); the frozen-database test from go-live |
| Two venues of one taxpayer take the same minute | A947's disclosed limit; one main box at a time |

## Found no longer true in the design (October line numbers)

- Activation actions are `setup`, `restore`, `promote`, `conflict-switch`; no `re-register`
  (`allocation-envelope.ts:289`, `allocation.ts:169-171`). Admission uses the five-symbol minute form
  (`:451`).
- Activation writes are `allocation.ts:435-478`; `assertNotAhead` is `node-entry.ts:258`, called at
  `:666`; the drain's grouping is `drain.ts:645`.
- The producer check runs on every node neither fenced nor a mirror (`boot.ts:2101`), not behind
  `singletonPass` (now `boot.ts:3726`).
- The recovery-key verifier lives in `node.db` (`readRecoveryKeyVerifier`), not `packages/db`.
- `waitron.sh install` has no separate stop or migrate step: it pulls, then `docker compose up`
  recreates the container and the new server migrates as it starts (`waitron.sh:783-791`).
- A page served instead of trading now exists (A1018's waiting start); A950 has an approved plan with
  its own recovery service and rewrites the install path.
- A1308 plans to rename `registro_sif` and remove `cadenas`, where the design adds columns.

## Review answers

- Finding 1 quotes the owner as "A993: keep as planned, after A1481"; the line under that heading
  reads "**A1481 before A993** → A993", which is what Authority now quotes.
- Finding 2 offered two fixes; the plan retries in-process, because A950 removes the Compose restart
  policies (its "Copy/recovery"), so a fix relying on Docker's restarts would not last.
- Finding 5 offered three fixes; the plan places the step inside A950's attempt, whose restore already
  puts the old images and files back, rather than adding a second restore to today's script.
- Finding 7, question 5: my first draft's "install by hand" escape is replaced, since A950's PR8 may run
  readiness on manual installs; read from its plan, not checked against its code, which is not built.
