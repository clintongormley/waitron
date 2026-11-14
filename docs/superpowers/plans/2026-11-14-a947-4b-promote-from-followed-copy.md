# A947 slice 4b — a switch starts from the spare's followed copy: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** draft for the watcher, 2026-11-14 (lane A). No owner approval of this plan is claimed.
The design it implements was approved by the owner on 2026-10-21 (the design's own header); the
A1018 amendment at its top was approved through the A1018 design (owner, 24 October) and its build
plan's two answers (owner, 2 November). Queued by the watcher on 2026-11-14 15:47
(`~/waitron-campaign/questions.md`, "next: A947-4b").

**Goal:** when the main box dies, the emergency switch on the spare promotes the copy the spare has
been following up to the moment the main box stopped, not the copy taken when the spare joined.

**Architecture:** since A947 3c (#3197) a joined spare follows the main box's stream into a scratch
copy (`SPARE_FOLLOW_DIR`), while its live `venue.db` stays the copy placed at joining, and the
emergency switch (A1018 Slices 7–8: preview, declaration, preparation, activation,
`promoteMirrorToPrimary`, restart, the in-flight reset) checks and promotes that live copy. 4b adds
one step in front of it: stop following, check the followed copy, stage it the way a selected backup
is staged today (`stageBackupAsCopy`, `handover-copy-from-backup.ts`), and restart, so the start's
existing `placeFirstCopy` puts it in place. Everything after that is the existing switch, acting on
the newer copy. The copy marker gains a second source, `followed-copy`.

**Tech stack:** TypeScript, Hono routes in `apps/server`, Lit in `apps/setup`, `node:sqlite`,
Litestream 0.5.18 follow mode (`@waitron/stream`), Vitest.

**Spec:** [`docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md`](../specs/2026-10-21-a947-two-box-failover-design.md):
the A1018 block at the top, §6.3 steps 1–3, §7.1's last paragraph, §11's 4b line. Read with
[`2026-11-14-a947-3c-spare-follows.md`](2026-11-14-a947-3c-spare-follows.md) (what the follower is)
and [`docs/research/2026-11-14-a947-follow-mode.md`](../../research/2026-11-14-a947-follow-mode.md)
(what stopping and restarting it was measured to do).

**Fiscal.** It changes which database becomes the filing node's database at a switch. The full
review wave with two Codex angles; the OWNER lands it. Golden huella
(`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and `inmutabilidad` run unedited. No change
to `computeHuella`, the chain, series allocation, `registros_facturacion`, the alta builders,
`registerSif`, `restoreFiscal` or `promoteMirrorToPrimary`.

## What the design's 4b line asks, and where each part stands

| §11 4b asks | Today | 4b does |
| --- | --- | --- |
| Stop following | 3c's follower never stops for a switch | Task 1–2: stop it, check its output, stage it |
| Verify (integrity, chain) | `checkEmergencyCopy` checks the LIVE copy (`handover-emergency-check.ts:17-55`) | Same checks run on the followed output before staging, and again on the placed copy by the existing preview |
| Check the person | Emergency preview/declare/activate sign in against the live copy (`handover-emergency-api.ts:200-245`) | Unchanged; after placement the live copy IS the followed copy, so a person enrolled after joining can sign in |
| `promoteMirrorToPrimary`, 4a's minute name, W41s's activation, the stored-key check | Built (A1018 Slices 7–8, `handover-activation.ts`; 3a's stored key in `promote.ts`) | Nothing |
| Restart, the in-flight reset | Built (`restart-reset.ts`, `resetInFlightClaims`) | Task 4 proves it on inherited records |
| Spare re-files an inherited record against the drain's real duplicate handling (§7.1) | No test on a promoted spare | Task 4 |
| A764's collection (the A1018 block's last bullet) | Built as A1018's own "Slice 4b" (`handover-collection.ts`; backlog `replication-cloud.md` "Built so far") — a different slice with the same number | Nothing |
| The in-memory passkey challenge (the A1018 block) | The emergency routes take a password and code only (`Declaration.actor.method`) | **Not here** — Decision D2 moves it to 4c with the screens that ask for a passkey |
| Box status: "Switching still uses the copy taken when this spare joined." | 3c's wording | Task 3 rewords it |

## Decisions (each open to the watcher; D1 and D2 are put as questions)

- **D1 — the take step asks for no sign-in.** §6.3 step 1 orders it "stops following, applies, …
  verifies. Only now does it check the manager's sign-in, against the person rows … of the copy it
  has just stopped writing." Signing in first would check the person against the joining copy,
  which can be months old: a manager enrolled since then could not start the switch. So
  `POST /api/node/handover/emergency/followed` takes no credentials and is admitted only when all
  of these hold: own-origin HTTPS (`requireNodeOperationHttps`), this box is a joined mirror whose
  held chart names a serving main box (`mirrorSource`), that main box is silent (`sourceSilent(…,
  false)`, the same check the backup route uses), no handover operation is open, and no selected
  backup is staged or placed. Its only effect is to replace the spare's own copy of the same venue
  with a newer checked one and restart. It is idempotent: when the follower's position (generation
  and applied TXID) equals the placed copy's, it answers `{ restarting: false }` and does nothing,
  so a repeated call costs nothing. Cost: anyone on the venue's network can make a spare whose main
  box is silent restart once per follower advance — which, with the main box silent, is once. The
  alternative (sign in first, against the joining copy) is the question.
- **D2 — the passkey challenge moves to 4c.** The A1018 block keeps "the in-memory passkey
  challenge" in 4b, but no screen sends a passkey to the emergency routes today, and 4c builds the
  switch's proof "a passkey or a password and, when enrolled, a code, on a till as on the dashboard".
  A server route with no caller would be built and reviewed twice. Recommended: 4c owns it.
- **D3 — a refused check restarts the box.** Stopping the follower ends it for this process
  (`startSpareFollow`'s `stop()` is final). When the followed output fails a check after stopping,
  the route answers the refusal and restarts the process, so the follower starts again from the
  store — the design's own fallback ("if it cannot resume, a refused check restarts the follower
  from the store instead", §6.3 step 1).
- **D4 — a spare that is not following switches with the copy it holds.** When the follower has no
  applied position in the state `following` (it never caught up, or the store is unreadable), the
  route answers `{ restarting: false, taken: false }` and the page goes on to the existing preview,
  showing one line: the copy is the one this spare already holds, with its latest dated activity
  (the preview already returns `lastChangeAtMs`). The declaration's "missing tail accepted"
  statement already covers what that copy lacks.
- **D5 — `sourceId` of a followed copy** is `sha256Hex("<generation>:<appliedTXID>")`, so the
  existing `isSha256Hex` check on `expectedCopy.sourceId` covers both sources and the idempotency
  check compares one value.
- **D6 — one pull request**, four tasks. Estimate: production about +260/−20 (server about 190,
  setup page and client about 50, strings and guides about 20); tests about +550. Report growth past
  1,000 changed code and test lines before going on.

## Global constraints

- English-only code; Spanish only in the setup and dashboard translation files and `guide/es`.
- Refusal codes already registered are reused; any new one is registered in `apps/server/src/errors.ts`
  and run through `scripts/errors-reachable.test.ts` and `scripts/alert-codes.test.ts`.
- `<state>/scratch` and `<state>/pair-copy` writes follow CLAUDE.md §3 (scratch made only while
  holding the venue folder; the backup room note is deleted before any path replaces live
  `venue.db` — `placeFirstCopy` already does it).
- A state-file marker is written with `writeFileDurable`; the marker is removed durably before the
  file it vouches for is replaced (the rule in `handover-copy-selection.ts:28`).
- Product text as short as the meaning allows (owner, 2026-10-09).

## Review focus

1. **The followed copy is behind the joining copy's own chart** (the main box renamed or promoted
   since): `checkCopy` and the chart checks refuse with `handover.copy_predates_destination` —
   Task 1 test.
2. **The follower is mid-rebuild when the route runs** (state `rebuilding`, after a restart):
   nothing is staged, D4's answer — Task 2 test.
3. **Two pages press at once**: the route runs inside `inTurn(deps.node, "handover-emergency", …)`
   like its siblings; the second call finds the staged marker and answers `{ restarting: true }`
   without stopping anything twice — Task 2 test.
4. **The main box answers again between the take and the declaration**: the existing preview's
   `sourceSilent` refuses with `handover.source_still_answering` on the placed copy — covered by
   the existing preview tests; Task 2 asserts the take route refuses the same way before stopping
   the follower (follower still running afterwards).
5. **An `enviando` record inherited from the dead box** is reset by the promoted spare's first
   filing start and settled by AEAT's duplicate answer, not filed as a new invoice — Task 4.

---

### Task 1: stage the followed copy

**Files:**
- Modify: `apps/server/src/handover-copy-selection.ts` (the marker's source union)
- Modify: `apps/server/src/handover-copy-from-backup.ts` (extract the shared check-and-stage half)
- Create: `apps/server/src/handover-copy-from-follow.ts`
- Modify: `apps/server/src/handover-emergency-check.ts:11-14` (type only)
- Test: `apps/server/src/handover-copy-from-follow.test.ts`; existing
  `apps/server/src/handover-copy-from-backup.test.ts` must pass unedited

**Interfaces:**
- Produces: `type SelectedCopy = { source: "selected-backup" | "followed-copy"; sourceId: string }`;
  `readSource` accepts either source.
- Produces: `stageCheckedCopy(deps, path: string, selection: SelectedCopy): Promise<void>` —
  everything `stageBackupAsCopy` does after `validateArtifactFile` (integrity, `checkCopy`, chart
  checks, `checkHandoverCopy`, copy into `PAIR_COPY_DIR`, durable `ready.json`); `stageBackupAsCopy`
  calls it.
- Produces: `followedCopyId(position: { generation: string; appliedTXID: string }): string` (D5) and
  `stageFollowedAsCopy(deps: Parameters<typeof stageCheckedCopy>[0], followed: { path: string;
  position: { generation: string; appliedTXID: string } }): Promise<SelectedCopy>`. It copies the
  stopped follower's `venue.db` into a fresh `mkdtemp` folder under `<state>/scratch` first (the
  checks open the file; the follower's own folder is not touched), stages from there, and removes
  the scratch folder in `finally`.

- [ ] **Step 1: failing tests** in `handover-copy-from-follow.test.ts`, on a real venue database
  built the way `handover-copy-from-backup.test.ts` builds its archive's database (reuse its setup;
  do not add a new fixture helper if one there fits):
  - "stages a checked followed copy under its position's id": `ready.json` reads
    `{ source: "followed-copy", sourceId: followedCopyId({generation, appliedTXID}) }` and
    `pair-copy/venue.db` is byte-identical to the input.
  - "refuses a damaged followed copy and stages nothing": overwrite page 2 of the input, expect
    `handover.copy_damaged`, and `pair-copy/ready.json` absent.
  - "refuses a followed copy whose chart does not admit this spare": expect
    `handover.copy_predates_destination`, nothing staged.
  - "leaves the follower's own file untouched": its bytes and mtime unchanged after a pass and after
    a refusal.
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/handover-copy-from-follow.test.ts` — FAIL (module missing).
- [ ] **Step 3:** extract `stageCheckedCopy`, widen `SelectedCopy`, add `handover-copy-from-follow.ts`.
- [ ] **Step 4:** run the new file and `src/handover-copy-from-backup.test.ts src/spare-copy-placement.test.ts src/handover-emergency-check.test.ts` — PASS, backup tests unedited.
- [ ] **Step 5:** add to `spare-copy-placement.test.ts` one case: "places a staged followed copy on a
  mirror and keeps its marker until activation" (the same shape as its selected-backup case). Run, commit.

### Task 2: the take route, and the emergency switch accepting a followed copy

**Files:**
- Modify: `apps/server/src/handover-emergency-api.ts` (new route; `parse` accepts
  `expectedCopy.source === "followed-copy"` with a sha256 `sourceId`; new deps)
- Modify: `apps/server/src/boot.ts:~4121` (pass the follower to the emergency API)
- Modify: `apps/server/src/read-only-exemptions.ts` (list the route, with its admission in the
  same style as `/emergency/backup`)
- Modify: `apps/server/src/boot.mirror-surface.test.ts:~306` (the pinned surface gains the route;
  a whole-shape pin gaining a key, named in the PR)
- Test: `apps/server/src/handover-emergency-followed.test.ts`

**Interfaces:**
- Consumes: Task 1's `stageFollowedAsCopy`, `followedCopyId`, `readSelectedCopy`, `readStagedCopy`.
- Produces on the API's `Deps`: `follow?: { progress(): FollowProgress | null; stop(): Promise<void>;
  path: string }` (boot passes `spareFollow` and `join(stateDir, SPARE_FOLLOW_DIR, VENUE_FILE)`)
  and `restart(): void` (boot's `restart`; today it travels only inside `backup`).
- Produces: `POST /api/node/handover/emergency/followed`, no body required, answering
  `{ restarting: boolean; taken: boolean }`. Order, each refusing before the next:
  `requireNodeOperationHttps`; `mirrorSource()`; no open handover operation
  (`handover.controlled_unresolved`); no staged or placed selected backup (answer
  `{ restarting: false, taken: false }`); `sourceSilent(sourceNodeId, false)`; a staged
  `followed-copy` marker → `{ restarting: true, taken: true }` without stopping again; read
  `follow.progress()` — not `following` or no `appliedTXID`: a placed `followed-copy` marker →
  `{ restarting: false, taken: true }` (the follower is rebuilding after the take's own restart),
  none → `{ restarting: false, taken: false }`; its id equals the placed marker's `sourceId` →
  `{ restarting: false, taken: true }`; otherwise
  `follow.stop()`, `stageFollowedAsCopy`, answer `{ restarting: true, taken: true }` and restart on
  the next tick. A check refusing after `stop()` answers its code and restarts too (D3).
  Status codes for any new refusal go in the file's `STATUS` table.

- [ ] **Step 1: failing tests**, using the existing emergency API test setup
  (`handover-emergency-declare.test.ts` / `handover-two-boxes.test.ts` helpers; a fake `follow`
  object recording calls):
  - "stops following, stages the followed copy and restarts": `stop` called once, `ready.json`
    source `followed-copy`, `restart` called once after the answer.
  - "answers taken without restarting when the placed copy is already at the follower's position".
  - "a second press while the first is staged answers restarting and stops nothing" (Review focus 3).
  - "a follower that is rebuilding stages nothing" (Review focus 2) → `{ restarting: false, taken: false }`, `stop` not called.
  - "after the take's own restart, a rebuilding follower still answers taken" → placed
    `followed-copy` marker, progress `rebuilding` → `{ restarting: false, taken: true }`.
  - "refuses while the main box answers, and keeps following" (Review focus 4):
    `handover.source_still_answering`, `stop` not called.
  - "refuses while a handover operation is open" → `handover.controlled_unresolved`.
  - "a damaged followed copy is refused and the box restarts" (D3): `handover.copy_damaged`,
    `restart` called, nothing staged.
  - "after placement, preview reports the followed copy and declare accepts it": restart simulated by
    calling `placeFirstCopy` and remounting; preview's `copy.source` is `followed-copy` with the
    staged `sourceId`; declare with that `expectedCopy` records it in the declaration's `lastCopy`.
- [ ] **Step 2:** run the new file — FAIL.
- [ ] **Step 3:** implement the route and the `parse` change; wire boot.
- [ ] **Step 4:** run the new file, `src/handover-emergency-declare.test.ts src/handover-emergency-check.test.ts src/read-only-exemptions.test.ts src/boot.mirror-surface.test.ts` — PASS.
- [ ] **Step 5:** commit.

### Task 3: the setup page takes the followed copy first; the wording

**Files:**
- Modify: `apps/setup/src/api/client.ts` (`takeFollowedCopy(): Promise<{ restarting: boolean; taken: boolean }>`;
  `EmergencyHandoverPreview["copy"]` gains the `followed-copy` source)
- Modify: `apps/setup/src/screens/handover-screen.ts` (the emergency branch)
- Modify: `apps/setup/src/i18n/strings/handover.ts` (EN and ES)
- Modify: `apps/dashboard/src/i18n/strings.ts:4025` and `:8246`;
  `apps/server/src/guide/en/box-status.md:55`, `apps/server/src/guide/es/box-status.md:62`
- Test: `apps/setup/src/screens/handover-screen.emergency.test.ts`,
  `apps/dashboard/src/screens/box-status-rows.test.ts:627`,
  `apps/dashboard/src/screens/box-status-screen.test.ts:191`

**Interfaces:** consumes Task 2's route and answer.

- [ ] **Step 1: failing tests** in `handover-screen.emergency.test.ts`:
  - "Check this copy first takes the followed copy, waits for the restart, then shows it": the
    stub answers `{ restarting: true, taken: true }`, the page shows the existing restarting line,
    re-previews until `copy.source === "followed-copy"` (the `#waitForBackup` pattern), then shows
    the copy as "Latest copy followed from the main box".
  - "a spare that is not following shows the copy it holds": `{ restarting: false, taken: false }`
    → preview proceeds and the page shows "This spare was not following the main box. The switch
    uses the copy it holds." beside the existing date line.
  - "a saved declaration is resumed without taking a copy again" (no `takeFollowedCopy` call when
    preview already returns an operation).
  - Spanish: the two new strings render in `es`.
  - The dashboard's two pinned lines change to the new `box_status.spare.switch_copy`:
    "Switching uses the latest copy this spare has followed." (ES: "El cambio usa la última copia
    que ha seguido este servidor de reserva."). The guides say the same in one sentence each. This
    is a changed test check the item's spec changes: list it in the PR's "Changed test checks".
- [ ] **Step 2:** run `pnpm --filter @waitron/setup exec vitest run src/screens/handover-screen.emergency.test.ts` and the two dashboard files — FAIL.
- [ ] **Step 3:** implement. The take call runs once, when the person presses Check this copy and
  no operation is saved; a restart reuses the existing `restarting` state and polling.
- [ ] **Step 4:** run the three files and `handover-screen.a11y.test.ts` — PASS. Open the page in
  both themes and at phone width with the stubbed API (the `run` skill or the screen's dev page) and
  look.
- [ ] **Step 5:** commit.

### Task 4: the promoted spare files what it inherited

**Files:**
- Modify: `apps/server/src/handover-two-boxes.test.ts` (one new `describe`), using
  `testing/two-box-takeover.ts`'s `placeCopy`, `takeoverRoutes`, `saleOn`
- Modify: `apps/server/src/stream-loop.e2e.test.ts` / `testing/stream-loop-spare.ts` (one step)

**Interfaces:** consumes Tasks 1–2; the drain's AEAT stand-in from
`packages/fiscal-verifactu/src/drain.test.ts:779-950` (reuse its transport fake through the
package's `testing` exports if they export it; if not, the smallest local fake the server suite
already has for a 3000 reply — search `apps/server/src` for `CodigoErrorRegistro` first).

- [ ] **Step 1: failing tests**, on two separate databases as the existing emergency case does,
  with the spare's copy taken AFTER a sale on the main box that the joining copy does not hold:
  - "the switch promotes the sale made after joining": after the emergency takeover from a
    followed copy, the sale's record is in the promoted spare's database under the old box's
    `node_id` and `sif_id`, and `fiscalRowsOf(old)` equals the main box's own.
  - "an inherited record the main box had filed is settled as filed, not filed again" (§7.1):
    the record is `enviando` in the copy; the promoted spare's first filing start
    (`resetBeforeFirstDrain` with the real `resetInFlightClaims`) returns it to `pendiente`; the
    drain sends it, the stand-in answers error 3000 with a duplicate whose fingerprint matches;
    the row ends `aceptado`, no new invoice number is used, no `fiscal.huella_divergente`.
  - "an inherited record AEAT holds as annulled opens a filing case" (§7.1): the same with the
    duplicate `Anulada` → the row is refused with 3000 and a filing case with cause
    `fiscal.duplicado_anulado` is open on the spare.
  - Control, recorded in one sentence in the PR: make the stand-in accept the resend as new (no
    3000) and show the first case's assertion that no second acceptance is recorded fails.
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/handover-two-boxes.test.ts` — FAIL on the new cases.
- [ ] **Step 3:** the code under test exists; a failure here that is not the missing take step is a
  defect to report in questions.md before fixing (it is in the fiscal core's neighbourhood: H2).
- [ ] **Step 4:** stream loop: after 3c's post-join change reaches the follower, stop the follower,
  call `stageFollowedAsCopy` on its real output, `placeFirstCopy` into a scratch venue folder, open
  it, and see the post-join change. Run it with the pinned binaries:
  `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`, then
  `env -u AI_AGENT -u CLAUDECODE WAITRON_REQUIRE_TEST_TOOLS=1 pnpm --filter @waitron/server exec vitest run src/stream-loop.e2e.test.ts --reporter=default`
  — 1 passed, no skip; report its time against the 4-minute job budget.
- [ ] **Step 5:** golden and inmutabilidad unedited:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts inmutabilidad` — PASS. Commit.

### Close

- `docs/backlog.md` and `docs/backlog/replication-cloud.md`: the A947 lines saying switching from
  the followed copy remains 4b now say a switch takes the followed copy; D2's passkey line moves
  under 4c's. The design's §11 4b line gets a dated pointer to this plan (historical text kept).
- PR description: Changed test checks (Task 3's pinned wording, Task 2's surface pin); the D1–D4
  decisions and who cleared them; "FISCAL — the owner lands it".
