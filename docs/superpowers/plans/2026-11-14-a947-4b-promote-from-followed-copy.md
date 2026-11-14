# A947 slice 4b — a switch starts from the spare's followed copy: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** revision 2, 2026-11-14 (lane A), after a fresh-context Claude plan read
(`~/waitron-campaign/receipts/a947-4b-plan-review.md`: 1 Critical, 6 Important, 4 Minor, all taken).
No approval of this plan is claimed. The design it implements: the owner approved its second
revision on 2026-10-22 at about 02:40 (the design's header); the A1018 amendment at its top comes
from the A1018 design (owner, 24 October) and its build plan's two answers (owner, 2 November).
Queued by the campaign watcher on 2026-11-14 15:47 (`~/waitron-campaign/questions.md`, "next:
A947-4b").

**Goal:** when the main box dies, the emergency switch on the spare promotes the copy the spare has
been following up to the moment the main box stopped, not the copy taken when the spare joined.

**Architecture:** since A947 3c (#3197) a joined spare follows the main box's stream into a scratch
copy (`SPARE_FOLLOW_DIR`, `<state>/scratch/spare-follow`), while its live `venue.db` stays the copy
placed at joining; the emergency switch (A1018 Slices 7–8: preview, declaration, preparation,
activation, `promoteMirrorToPrimary`, restart, the in-flight reset) checks and promotes that live
copy. 4b puts the design's §6.3 step 1 in front of it, in the design's order: let the follower apply
what the spare's store holds, stop it, check its output, stage it, check the person's sign-in
against it, and restart, so the start's existing `placeFirstCopy` puts it in place. Nothing replaces
the live copy before the person is known. Everything after that is the existing switch, acting on
the newer copy. The copy marker gains a second source, `followed-copy`.

**Tech stack:** TypeScript, Hono routes in `apps/server`, Lit in `apps/setup`, `node:sqlite`,
Litestream 0.5.18 follow mode (`@waitron/stream`), Vitest.

**Spec:** [`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md`](../specs/2026-10-21-a947-two-box-failover-design.md):
the A1018 block at the top, §6.3 steps 1–3, §7.1's last paragraph, §11's 4b line. Read with
[`2026-11-14-a947-3c-spare-follows.md`](2026-11-14-a947-3c-spare-follows.md) (the follower) and
[`docs/research/2026-11-14-a947-follow-mode.md`](../../research/2026-11-14-a947-follow-mode.md)
(what stopping and restarting it was measured to do, and its header-byte differences).

**Fiscal.** It changes which database becomes the filing node's database at a switch. The full
review wave with two Codex angles; the OWNER lands it. Golden huella
(`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and `inmutabilidad` run unedited. No change
to `computeHuella`, the chain, series allocation, `registros_facturacion`, the alta builders,
`registerSif`, `restoreFiscal` or `promoteMirrorToPrimary`.

## What the design's 4b line asks, and where each part stands

| §11 4b asks | Today | 4b does |
| --- | --- | --- |
| Stop following, apply what the store holds | 3c's follower never stops for a switch | Task 1: wait until applied equals uploaded, stop, require a clean exit, read the applied position from the stopped output |
| Verify (integrity, chain) | `checkEmergencyCopy` checks the LIVE copy (`handover-emergency-check.ts:17-55`) | Task 1: the selected-backup checks run on the followed output before staging; the existing preview checks the placed copy again |
| Check the person | Preview, declare and activate sign in against the live copy (`handover-emergency-api.ts:200-245`) | Task 2: the take signs in against the stopped followed copy before anything is placed; later steps unchanged, now against the placed followed copy |
| `promoteMirrorToPrimary`, 4a's minute name, W41s's activation, the stored-key check | Built (A1018 Slices 7–8, `handover-activation.ts`; 3a's stored key in `promote.ts`) | Nothing |
| The activation writes the spare's dormant filing setup first (`docs/backlog/replication-cloud.md:1065`, "for 4b") | Built (`handover-preparation.ts:155`, 3b-F) | Nothing; the backlog line is updated at Close |
| Restart, the in-flight reset | Built (`restart-reset.ts`, `resetInFlightClaims`) | Task 4 proves it on inherited records |
| Spare re-files an inherited record against the drain's real duplicate handling (§7.1) | `handover-controlled.e2e.test.ts:2001` proves a promoted box files the old box's WAITING record under the old identity; no case covers one the old box already filed | Task 4 |
| A764's collection (the A1018 block's last bullet) | Built as A1018's own "Slice 4b" (`handover-collection.ts`; `replication-cloud.md` "Built so far") — another slice with the same number | Nothing |
| The in-memory passkey challenge (the A1018 block) | The emergency routes take a password and code only | **Not here** — question Q1 |
| Box status: "Switching still uses the copy taken when this spare joined." | 3c's wording | Task 3 rewords it |

## Decisions

- **D1 — the take signs the person in against the followed copy.** §6.3 step 1: "Stops following,
  applies …, runs `PRAGMA integrity_check` and the chain verifier … Only now does it check the
  manager's sign-in, against the person rows … of the copy it has just stopped writing." The take
  route carries the page's sign-in (as `/emergency/backup` does) and checks it, with the real
  sign-in code (`authenticate` in `handover-emergency-api.ts`), against the stopped follower's
  folder opened with `openVenueDatabase(join(stateDir, SPARE_FOLLOW_DIR))` — after the copy has
  been staged, so the sign-in's session row lands only in the follower's discarded output (the next
  start empties `scratch/`, `boot.ts:1317`, and the follower wipes its folder, `spare-follow.ts:142`).
  A manager enrolled after joining can therefore start the switch. A refused sign-in removes the
  staged copy (`clearSelectedCopy`) and restarts, so the follower resumes. Nothing replaces the
  live copy until the start after a successful sign-in.
- **D2 — waiting, not falling back.** While the follower is rebuilding (every start does a full
  restore), unknown, or behind its store, the take answers `catching-up` with the follower's
  progress and the page waits, asking again every 2 seconds. Only when it does not catch up within
  60 seconds of one bounded wait does the page offer **Use the copy this spare holds** with that
  copy's latest dated activity — today's switch, chosen by the person and recorded in the
  declaration as source `mirror-copy`. This is question Q2: the design has no such way out, but
  without one a spare whose store is unreadable could not switch at all.
- **D3 — any failure after the follower stops restarts the box.** `startSpareFollow`'s `stop()` is
  final for the process. A refused check, a refused sign-in, or any other error after stopping
  (a full disk while copying, say) answers its code and restarts in a `finally`, so the follower
  starts again from the store — the design's own fallback (§6.3 step 1: "a refused check restarts
  the follower from the store instead").
- **D4 — `sourceId` of a followed copy** is `sha256Hex("<generation>:<appliedTXID>")`, the TXID read
  from the stopped output's `-txid` file (`follow.ts:87`), so the existing `isSha256Hex` check on
  `expectedCopy.sourceId` covers both sources and a repeated take compares one value.
- **D5 — one pull request**, four tasks. Estimate: production about +330/−25 (server about 250,
  setup page and client about 60, strings and guides about 20); tests about +650. Report growth past
  1,100 changed code and test lines before going on.

## Questions (for the watcher to answer or pass to the owner)

- **Q1 — the passkey challenge moves to 4c?** The A1018 block keeps "the in-memory passkey
  challenge" in 4b. No screen sends a passkey to the emergency routes today; 4c builds the switch's
  proof ("a passkey or a password and, when enrolled, a code, on a till as on the dashboard"), so a
  4b route would have no caller. Why it must still be held in memory in 4c: a challenge row written
  before the take would land in the joining copy, which the take then replaces. Recommended: 4c.
- **Q2 — D2's way out.** Recommended: offer **Use the copy this spare holds** after 60 seconds
  without catching up. The alternative is no way out (a switch waits for the store however long).

## Global constraints

- English-only code; Spanish only in the setup and dashboard translation files and `guide/es`. Each
  file keeps its own Spanish term: the setup strings say «servidor de reserva»
  (`apps/setup/src/i18n/strings/handover.ts:140`), the dashboard says «equipo de reserva»
  (`apps/dashboard/src/i18n/strings.ts:8246`).
- Refusal codes already registered are reused; a new one is registered in `apps/server/src/errors.ts`
  and run through `scripts/errors-reachable.test.ts` and `scripts/alert-codes.test.ts`.
- `<state>/scratch` and `<state>/pair-copy` writes follow CLAUDE.md §3; `placeFirstCopy` already
  deletes the backup room note before replacing the live `venue.db`.
- A marker is written with `writeFileDurable` and removed durably before the file it vouches for
  (`handover-copy-selection.ts:28`).
- Product text as short as the meaning allows (owner, 2026-10-09).

## Review focus

1. **The follower is rebuilding when the person presses** (every start rebuilds): the page waits;
   nothing is stopped or staged — Task 2 test.
2. **The follower's output was written with the older journal header** (bytes 18–19 read 1, not 2;
   bytes 24–27 differ, research note): the staged copy must check, place and open as a WAL
   database — Task 1's input carries those bytes; Task 4's stream-loop step runs the real output
   through `checkEmergencyCopy` and the migrations.
3. **Two pages press at once**: the route runs inside `inTurn(deps.node, "handover-emergency", …)`;
   the second finds the staged marker and answers `restarting` without stopping anything — Task 2.
4. **The main box answers again before the take**: refused with `handover.source_still_answering`
   before the follower is touched — Task 2.
5. **A take refused for a reason that will not pass** (the spare's release is older than the main
   box's, so `checkCopy` refuses, `spare-copy.ts:200`; or a broken chain): the page names the cause
   and offers the held copy — Task 3.

---

### Task 1: stop the follower cleanly and stage its output

**Files:**
- Modify: `apps/server/src/spare-follow.ts` (a stop for the switch)
- Modify: `apps/server/src/handover-copy-selection.ts` (the marker's source union)
- Modify: `apps/server/src/handover-copy-from-backup.ts` (extract the shared check-and-stage half)
- Create: `apps/server/src/handover-copy-from-follow.ts`
- Modify: `apps/server/src/handover-emergency-check.ts:11-14` (type only)
- Test: `apps/server/src/spare-follow.test.ts`, `apps/server/src/handover-copy-from-follow.test.ts`,
  `apps/server/src/spare-copy-placement.test.ts`; `handover-copy-from-backup.test.ts` unedited

**Readers of the widened marker** (each keeps its behaviour for `selected-backup` and is checked for
`followed-copy`): `clearSelectedCopy` callers `restore.ts:617`, `db-wipe.ts:23`,
`handover-place-copy.ts:288`, `handover-activation.ts` (twice); `placeFirstCopy`;
`checkEmergencyCopy`. Anything that must mean "a backup was chosen" tests `source` explicitly.

**Interfaces:**
- Produces in `spare-follow.ts`: `stopForSwitch(options: { catchUpMs: number }): Promise<
  { kind: "stopped"; generation: string; appliedTXID: string; path: string } |
  { kind: "catching-up"; progress: FollowProgress | null }>` on the object `startSpareFollow`
  returns. It waits up to `catchUpMs` for the follower to be `following` with
  `appliedTXID === uploadedTXID`; if it is not, it answers `catching-up` and leaves the follower
  running. Otherwise it stops the follower, requires `exit()` to report exit code 0 (anything else
  throws `handover.copy_damaged`), reads `<out>-txid` for `appliedTXID`, and answers `stopped`.
- Produces: `type SelectedCopy = { source: "selected-backup" | "followed-copy"; sourceId: string }`.
- Produces: `stageCheckedCopy(deps, path: string, selection: SelectedCopy): Promise<void>` — what
  `stageBackupAsCopy` does after `validateArtifactFile` (integrity, `checkCopy`, chart checks,
  `checkHandoverCopy`, one copy into `PAIR_COPY_DIR`, durable `ready.json`); `stageBackupAsCopy`
  calls it.
- Produces in `handover-copy-from-follow.ts`: `followedCopyId(position: { generation: string;
  appliedTXID: string }): string` (D4) and `stageFollowedAsCopy(deps, stopped: { path: string;
  generation: string; appliedTXID: string }): Promise<SelectedCopy>`, which checks the stopped output
  read-only where it lies and copies it once.

- [ ] **Step 1: failing tests.**
  - `spare-follow.test.ts` (fake `follow` as the file's existing cases use): "stopForSwitch waits for
    the store to be applied, then stops and reads the position from the output"; "answers
    catching-up and keeps following while rebuilding"; "answers catching-up when applied stays
    behind uploaded past the wait"; "refuses a follower that exits with a non-zero code".
  - `handover-copy-from-follow.test.ts`, on a real venue database built as
    `handover-copy-from-backup.test.ts` builds its archive's (reuse its setup), with bytes 18 and 19
    of the input set to 1: "stages a checked followed copy under its position's id" (`ready.json`
    reads `{ source: "followed-copy", sourceId: followedCopyId(…) }`, `pair-copy/venue.db`
    byte-identical to the input); "refuses a damaged copy and stages nothing" (page 2 overwritten →
    `handover.copy_damaged`, no `ready.json`); "refuses a copy whose chart does not admit this
    spare" → `handover.copy_predates_destination`.
  - `spare-copy-placement.test.ts`: "places a staged followed copy on a mirror and keeps its marker
    until activation" (the selected-backup case's shape), and the placed file opens with
    `openVenueDatabase` and reads `journal_mode` `wal`.
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/spare-follow.test.ts src/handover-copy-from-follow.test.ts src/spare-copy-placement.test.ts` — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run those three and `src/handover-copy-from-backup.test.ts src/handover-emergency-check.test.ts src/restore.test.ts src/db-wipe.test.ts src/handover-place-copy.test.ts` — PASS, backup tests unedited. Commit.

### Task 2: the take route, and the switch accepting a followed copy

**Files:**
- Modify: `apps/server/src/handover-emergency-api.ts` (new route; `parse` accepts
  `expectedCopy.source === "followed-copy"` with a sha256 `sourceId`; new deps)
- Modify: `apps/server/src/boot.ts:~4121` (pass the follower and `restart`)
- Modify: `apps/server/src/read-only-exemptions.ts` (the route, its admission written like
  `/emergency/backup`'s)
- Modify: `apps/server/src/boot.mirror-surface.test.ts:~306` (the pinned surface gains the route;
  a whole-shape pin gaining a key, named in the PR)
- Test: `apps/server/src/handover-emergency-followed.test.ts`

**Interfaces:**
- Consumes: Task 1's `stopForSwitch`, `stageFollowedAsCopy`, `followedCopyId`, the marker readers.
- Produces on the API's `Deps`: `follow?: { stopForSwitch: …; progress(): FollowProgress | null }`
  (boot passes `spareFollow`) and `restart(): void` (boot's `restart`; today it travels only inside
  `backup`).
- Produces: `POST /api/node/handover/emergency/followed`, body `{ signIn }`, answering
  `{ state: "restarting" | "catching-up" | "taken"; progress?: FollowProgress | null }`. Inside
  `inTurn(deps.node, "handover-emergency", …)`, each refusing before the next:
  1. `requireNodeOperationHttps`; `mirrorSource()`; no open handover operation
     (`handover.controlled_unresolved`); a staged or placed marker whose source is
     `selected-backup` → `taken` (the person chose a backup; nothing to do).
  2. A staged `followed-copy` marker → `restarting`, stopping nothing.
  3. `sourceSilent(sourceNodeId, false)`.
  4. `follow.progress()` names the placed `followed-copy` marker's position (D4) → `taken`.
  5. `stopForSwitch({ catchUpMs: 30_000 })`; `catching-up` → answer it, follower still running.
  6. In a `try`/`finally` that restarts on the next tick whatever happens: `stageFollowedAsCopy`;
     sign in (D1) against the stopped follower's folder — refused: `clearSelectedCopy`, answer the
     refusal; passed: answer `restarting`.
  New refusal codes, if any, go in the file's `STATUS` table.

- [ ] **Step 1: failing tests**, with the existing emergency API test setup
  (`handover-emergency-declare.test.ts`) and a fake `follow` recording calls:
  - "stops following, stages the followed copy, signs in against it and restarts": `stopForSwitch`
    once, `ready.json` source `followed-copy`, `restart` once after the answer.
  - "a person enrolled after joining can take the copy": the person exists only in the followed
    output, not in the live copy.
  - "a refused sign-in leaves nothing staged and restarts".
  - "answers taken without stopping when the placed copy is at the follower's position", and "when
    the follower is rebuilding after the take's own restart".
  - "a second press while the first is staged answers restarting and stops nothing" (Review focus 3).
  - "a rebuilding follower answers catching-up and is not stopped" (Review focus 1).
  - "refuses while the main box answers, before touching the follower" (Review focus 4).
  - "refuses while a handover operation is open"; "does nothing when a backup was chosen".
  - "a damaged followed copy is refused and the box restarts"; "a failure while copying restarts too"
    (D3: a stand-in `stageFollowedAsCopy` that throws a non-`AppError`).
  - "after placement, preview reports the followed copy and declare records it": restart simulated
    by `placeFirstCopy` and remounting; preview's `copy.source` is `followed-copy` with the staged
    `sourceId`; declare with that `expectedCopy` stores it in the declaration's `lastCopy`.
- [ ] **Step 2:** run the new file — FAIL.
- [ ] **Step 3:** implement; wire boot. Not yet run by anyone: whether `openVenueDatabase` opens
  the follower's folder (it holds `venue.db` and its `-txid` file, no `node.db`) and whether the
  real sign-in writes there cleanly. If it refuses, report it in progress.log and open a disposable
  copy of the staged file under `scratch/` instead; do not bend the store's checks.
- [ ] **Step 4:** run the new file, `src/handover-emergency-declare.test.ts src/handover-emergency-check.test.ts src/read-only-exemptions.test.ts src/boot.mirror-surface.test.ts src/spare-follow.test.ts` — PASS. Commit.

### Task 3: the setup page takes the followed copy first; the wording

**Files:**
- Modify: `apps/setup/src/api/client.ts` (`takeFollowedCopy(signIn)`; the preview's copy type gains
  `followed-copy`)
- Modify: `apps/setup/src/screens/handover-screen.ts` (the emergency branch)
- Modify: `apps/setup/src/i18n/strings/handover.ts` (EN and ES)
- Modify: `apps/dashboard/src/i18n/strings.ts:4025` and `:8246`;
  `apps/server/src/guide/en/box-status.md:55`, `apps/server/src/guide/es/box-status.md:62`
- Test: `apps/setup/src/screens/handover-screen.emergency.test.ts`,
  `apps/dashboard/src/screens/box-status-rows.test.ts:627`,
  `apps/dashboard/src/screens/box-status-screen.test.ts:191`

**Interfaces:** consumes Task 2's route and answer.

- [ ] **Step 1: failing tests** in `handover-screen.emergency.test.ts`:
  - "Check this copy first brings the copy up to date, waits for the restart, then shows it": the
    stub answers `restarting`; the page shows the existing restarting line and re-previews until
    `copy.source === "followed-copy"` (the `#waitForBackup` pattern), then labels the copy
    "Latest copy from the main box".
  - "while the spare catches up the page waits and says so": `catching-up` → "Bringing this spare's
    copy up to date…" and another take 2 s later; after 60 s without catching up the page also
    offers **Use the copy this spare holds** (Q2), which goes to today's preview.
  - "a refused take names its cause and offers the copy this spare holds" (Review focus 5): for
    `handover.copy_predates_destination` and `handover.chain_broken`, the existing error wording
    plus the same action.
  - "a saved declaration is resumed without taking a copy again".
  - Spanish: the new strings render in `es`.
  - Dashboard: `box_status.spare.switch_copy` becomes "A switch first brings this spare's copy up
    to date." (ES «Al cambiar, primero se pone al día la copia de este equipo de reserva.»); the
    guides say the same in one sentence each. A changed test check the item's spec changes: list it
    in the PR's "Changed test checks".
- [ ] **Step 2:** run `pnpm --filter @waitron/setup exec vitest run src/screens/handover-screen.emergency.test.ts` and the two dashboard files — FAIL.
- [ ] **Step 3:** implement. The take runs when the person presses Check this copy and no operation
  is saved; a restart reuses the existing `restarting` state and polling.
- [ ] **Step 4:** run them and `src/screens/handover-screen.a11y.test.ts` — PASS. Open the page in
  both themes and at phone width with a stubbed API and look. Commit.

### Task 4: the promoted spare files what it inherited; the real follower's output

**Files:**
- Modify: `apps/server/src/handover-controlled.e2e.test.ts` (its two-box harness reaches the real
  drain and `createFakeAeat`, `:30-34`, `:185-189`; it writes the dormant filing setup at switch-on)
- Modify: `apps/server/src/stream-loop.e2e.test.ts` / `testing/stream-loop-spare.ts` (one step)

**Interfaces:** consumes Tasks 1–2.

- [ ] **Step 1: failing tests** in `handover-controlled.e2e.test.ts`, next to "M2 files M1's waiting
  record under M1's identity" (`:2001`), using its harness:
  - "an inherited record the old box had filed is settled through AEAT's duplicate answer": M1's
    drain files a record so the fake AEAT holds it; the copy M2 takes over from holds that record
    `enviando` (cut before M1 saved the answer); M2's first filing start (`resetBeforeFirstDrain`,
    real `resetInFlightClaims`) returns it to `pendiente`; M2's drain sends it under M1's
    `IdSistemaInformatico` and installation number; the fake answers error 3000; the lookup finds
    the same fingerprint; the row ends `aceptado`; assert the 3000 reply and the lookup were heard
    (the fake records what it is sent) and no new invoice number was used.
  - "an inherited record AEAT holds as annulled opens a filing case": the same after M1 also files
    its annulment; the row is refused with 3000 and a filing case with cause
    `fiscal.duplicado_anulado` is open on M2.
  - Control, in the other direction: the fake holds a different fingerprint under that identity;
    expect `fiscal.huella_divergente`. Record in the PR in one sentence what was changed, which
    assertion failed, and the restored result.
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/handover-controlled.e2e.test.ts` — FAIL on the new cases if the harness lacks a hook; the code under test exists. A failure that shows a defect in filing (not in the harness) goes to questions.md before any fix: it is next to the fiscal core (H2).
- [ ] **Step 3:** the stream loop: after 3c's post-join change reaches the follower, call
  `stopForSwitch` and `stageFollowedAsCopy` on the real output, `placeFirstCopy` into a scratch venue
  folder, run the migrations and `checkEmergencyCopy` on it, and see the post-join change. Run with
  the pinned binaries: `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`,
  then `env -u AI_AGENT -u CLAUDECODE WAITRON_REQUIRE_TEST_TOOLS=1 pnpm --filter @waitron/server exec vitest run src/stream-loop.e2e.test.ts --reporter=default`
  — 1 passed, no skip; report its time against the 4-minute job budget.
- [ ] **Step 4:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts inmutabilidad` — PASS, unedited. Commit.

### Close

- `docs/backlog.md` and `docs/backlog/replication-cloud.md`: the A947 lines saying switching from
  the followed copy remains 4b now say a switch first brings the spare's copy up to date; the
  `replication-cloud.md:1065` "for 4b" dormant-setup line says it is built; Q1's answer recorded
  where 4c's work is listed. The design's §11 4b line gets a dated pointer to this plan.
- PR description: Changed test checks (Task 3's wording, Task 2's surface pin); D1–D3 and Q1–Q2 and
  who answered them; "FISCAL — the owner lands it".
