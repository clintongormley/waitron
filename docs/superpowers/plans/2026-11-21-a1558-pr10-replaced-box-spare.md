# A1558 PR 10: the replaced main box becomes a spare — plan (revision 5.1, cleared)

> 2026-11-23: PR 10b part B (branch `feat/service-a1558-pr10b-b`) built Wipe and remove before the return completes and the download's tabs since the copy, from lane B's `a1558-pr10b-b-plan.md` revision 9, which replaced this plan's part B where they differ.

> Lane B, 21 November 2026. **Cleared by the watcher at 12:22** (lane B's `questions.md`, "WATCHER 2026-11-21 12:22"), with two conditions folded in as revision 5.1. **Build order: after the join-environment PR (landed as #3955, `712e06e354`) and PR 9.** Code facts were **read** on main at `1390e4b373`, not run; the two commits since revision 4's `ae87c0dcf9` touched only box upgrades and `deploy/waitron.sh`, whose reset pointers are updated below. The only commands run were `git`, `grep`, `sed`, `awk`, and (for revision 4) one `node` import of `packages/store/src/state-layout.ts`. The owner's first choice ("Yes: a, b and c") is in lane B's `questions.md`, "WATCHER 2026-11-21 10:18"; the owner's answers to this plan's four questions are under "WATCHER 2026-11-21 11:41" (PR 10 part) and "WATCHER 2026-11-21 11:46"; the environment answer ("yes") is at 12:05. The watcher kept PR 10 in lane B and accepted its shape: the old box asks the main box (signed), the order is a new kind of handover event row with no new table, and the databases are set aside rather than deleted when records would be lost. **Full review path; the owner lands it.** Revisions 2 to 5.1 are explained in the last section.

## What a person can do when this lands

- **PR 10a: the two buttons.** On the new main box, **System → Servers**, the old box's row menu offers:
  - **Reset and add as spare**, once this box holds the old box's whole return. Its dialog says, in the owner's words: "The records recovered from the old main server will exist only on the new main server until the next backup is made." After an emergency switch it adds a second line (see "The dialogs").
  - **Reset anyway and turn into a spare**, while the return is not complete. It asks for an administrator sign-in in place, warns that invoice records the old box has not returned are set aside on that box and no longer used, needs a tick, and marks the handover **Will not return** in the same step.
  - In both cases the old box resets itself the next time it checks in with the main box. While it is on and connected, it checks every 30 seconds. It comes back as a fresh box showing setup's first page, and the main box removes it from the venue: its row then reads **Removed** and offers **Clear from list**, as after any removal.
  - **If the old box holds invoice records of some other server that the main box lacks** (see "Other servers' records"), it sets its databases aside instead of deleting them, even after **Reset and add as spare**, the activity entry for the reset says so, and the main box raises an alert saying what happened and that nothing was deleted.
- **Then the person adds it as a spare through PR 9's approval** (owner's answer 1, "yes"). On the reset box's first page they choose **Join or recover**, enter the main box's address and press **Join**. The reset box contacts the main box directly. The main box's **Servers** page lists "A box at <address> is asking to join" with **Check**. Both screens show a 6-digit code; the main box shows three codes and the person taps the one the reset box shows (2026-11-23, SETUP-FIRST-PAGE-PLAIN part 4: now both screens show one code and ask Yes or No; the person chooses Join on the reset box and Add as spare on the main box). Nothing is typed into the reset box. A rejoin with nobody involved is revisited after the next two-box rehearsal; it is not planned here.
- **A box that can never reach the main box again** is removed with **Remove** and the reset statement, as today (owner's answer 4, "y"). No reset order is left waiting for it: once it is removed, the main box refuses its questions as no longer a member. Whoever finds that box resets it; today that is the terminal command (see "Left unclear by the answers").
- Today the only way to reset any replaced box is a terminal command, which the operator does not have.
- **PR 10c (outline only).** For the case where the return is complete, the main box tells the old box to reset by itself, with no button. It is a later small PR, landed after the next two-box rehearsal.

**Order and dependencies.**

- **PR 9 first.** PR 10's guide words and its two-box tests' join step use PR 9's code comparison. If PR 9 slips, Tasks 1 to 11 can start; Tasks 12 to 14 and 18 wait for it.
- **The join-environment PR first** (owner "yes" at 12:05; **landed as #3955, `712e06e354`**): a joining box whose `WAITRON_ENV` is unset takes the main box's environment from the join bundle. PR 10 relies on it for a reset box to join a production venue, and carries nothing of its own for the environment. PR 10's branch starts from a main that holds it.

## What is true today (read, with pointers)

1. **A replaced box runs only the return.**
   - A box holding a `node_handover_restriction` row starts restricted (`apps/server/src/boot.ts:2225-2227`), as does a box found superseded at start (`:2348-2356`).
   - The restricted start mounts only the restricted page, peer status, membership, handover status and handover source (`boot.ts:2141-2196`), and runs only the return sender (`restricted-start.ts:44-59`). In particular it serves no recovery page, so no environment Move can be chosen while it runs.
   - It sells nothing, files nothing, and writes no venue data (`restricted-start.ts:37-43`).
2. **How its records return.**
   - The fiscal module (`fiscal-verifactu`) is the only module with a return seat: its handover contribution fills `returnRecords` (`packages/fiscal-verifactu/src/handover-summary.ts:129-133`, composed at `packages/composition/src/modules.ts:325`; the contract is `packages/module/src/handover.ts:19-38`). The payments module's contribution, at `modules.ts:285`, only summarises (`packages/payments/src/handover-summary.ts:85-87`).
   - Its batches hold every invoice record **carrying this box's own id**, plus their sales, payments, refunds, filings with AEAT (the Spanish tax agency) and chain heads (`packages/fiscal-verifactu/src/handover-return.ts:50-125`; the record read is `where node_id = ${sourceNodeId}` at `:72-73`). Records of any other box it holds are not sent. The only orders the batches carry are those behind a card refund still pending (`:67-71`).
   - Each batch is signed and sent to the box the old box's chart names as main. While that chart still names the old box itself as main, the batches go to the box its restriction names (`apps/server/src/return-records.ts:104-109`).
   - Each answer is a signed receipt. Its `accounted: true` means that every row in the batch is now held, identical, on the main box (`handover-return.ts:523-546`, `return-records-api.ts:122-135`). The sender checks the receipt's signer is the target and its `nonce` is the one sent (`return-records.ts:158-170`).
   - The sender runs every 30 seconds until it confirms (`return-records.ts:201-240`); nothing stops two passes running at once if a second caller starts one.
3. **"Every record is back" on each side.**
   - **On the old box:** the pass ends `confirmed` only when every receipt is signed by the target box and matches the batch and the venue (`return-records.ts:155-177`). The box then writes a `return_confirmed` event in its `node.db` (`:79-89`), and the duty stops (`:234`).
   - **On the main box:** `handover_return_batches` completes that inventory (`return-completion.ts:72-119`), and the operation moves to `return_complete` (`return-records-api.ts:106-114`).
   - These are one fact seen from two sides, so no new "complete" message is needed. It covers only the old box's own chain.
4. **What the confirmation does not cover.**
   - Sale lines, orders, stock, printing, drawer openings and working-time entries do not return, and neither do local backups. (Working-time entries change with PR 11, which the owner approved at 11:46.)
   - After a planned handover (`scenario` `controlled`), the final copy carried all of these.
   - After an emergency switch (`scenario` `emergency`), anything the old box wrote after the spare's last copy is lost when the box is reset. The second line of the dialog says so.
   - **After the reset, the returned invoice records may exist only in the main box's `venue.db`.** Right after an emergency switch the venue often has no spare, and the old box resends on every start precisely because a main box restored from an earlier copy would lack them (`return-records.ts:72`). The dialog's first line says so.
   - **Another box's records.** A box can hold invoice records of an earlier box: those that box returned to it, or those in the copy it started from. Its return does not send them (item 2), so its "every record is back" says nothing about them.
   - The handover's scenario is stored in `venue.db`'s `handover_activations` row (`packages/db/src/schema/handover/activations.ts:14-17`), the same rows the completion reads (`return-completion.ts:72-83`).
5. **Will not return.**
   - The route is `POST /management-api/servers/:nodeId/return-abandoned`, with `node.manage` and a fresh sign-in (`membership-removal-api.ts:59-67,110-120`).
   - It writes one activity entry, then closes the operation (`return-abandoned.ts:34-59`).
6. **Removal of the old box** is refused while its return is outstanding (`membership-removal.ts:82`) and needs a completed return or the reset statement (`:83-85`). It is also refused while any open handover names the box (`:89`; `openFacts` sets that for any open operation naming it, `:169-174`), and a takeover waiting for its return is open (`return_pending` is not in `CLOSED`, `packages/handover/src/states.ts:64-69`). A removed box stays on the page as **Removed** with **Clear from list** (`apps/dashboard/src/screens/servers-screen.ts:641-646`).
7. **Resetting today.** No route on any box resets one, and the host service answers only tag, network and clock requests (`deploy/box/waitron-box.sh:288-318`). The two ways are both terminal commands:
   - `waitron.sh reset --force-production` stops the box, removes six Docker volumes, and deletes every state entry except `tls/` and `records/` (`deploy/waitron.sh:1376-1399`, `wipe_box`; the volume list is at `:1385`).
   - The `waitron-rejoin` command does not check the return (`rejoin.ts:31-38`).
8. **Joining today, and after PR 9 and the join-environment PR.**
   - Joining mints a new node id (`adopt.ts:159`).
   - Today the joining box sends the main box's administrator email, password and code (`mirror-bundle-api.ts:274-288`). PR 9 replaces that, by the owner's choice at 11:41, with the box-to-box request and the 6-digit code comparison described above. PR 10 relies on nothing the password path does.
   - PR 9 keeps the refusals: a spare already streaming (`mirror-bundle-api.ts:197-203`), clocks 10 minutes or more apart (`:327-332`), a bucket stream on (`:346-354`), or the recovery key missing (`:335-338`). So a reset box cannot join while the venue already has a streaming spare.
   - On `1390e4b373` a fresh or reset box with no `trading.env` read as preproduction (`packages/db/src/deployment.ts:21`) and a production join was refused `mirror.environment_mismatch` (`adopt.ts:183`). The join-environment PR (#3955, `712e06e354`) fixed that for every fresh box, so PR 10 needs nothing of its own.
9. **The set-aside lives on the same filesystem as what it moves.** The image sets only `WAITRON_STATE_DIR` (`deploy/Dockerfile:320`), the venue folder defaults to `<state>/venue` (`packages/store/src/state-layout.ts:319-325`), and the whole state folder is one volume (`deploy/compose.yml:42`). A cross-filesystem refusal (`EXDEV`, `packages/provisioning/src/first-setup-start-again-set-aside.ts:232-240`) can therefore happen only on a hand-built layout.

**So, plainly:** the reset needs one press by an administrator on the main box. The rejoin needs the person at both screens for PR 9's code comparison.

## Design of PR 10a

**Who talks to whom.** The old box asks; the main box answers. This still works when the main box cannot reach the old box, and when the old box is switched on later.

- **The route.** `POST /api/node/reset-order` on the main box's full start, beside `mountReturnRecordsApi` (`boot.ts:3490`), with a peer body limit.
- **The request** is signed `reset-query` with the old box's node key: `{venue, sourceNodeId, destinationNodeId, nonce, holdings, ack?}`. It is sent with `postToBox` (`boot-peer-check.ts:387`) under the venue's certificate authority. `holdings` is described under "Other servers' records".
- **The main box's checks.** The signer must be a chart member standing `sell-only`, verified with its pinned key, and the venue must match. Otherwise the route refuses with `handover.reset_query_refused` and a `reason`. A removed box stands `evicted`, so it is refused here: that is what leaves no order waiting for it (answer 4).
- **The answer** is signed `reset-order`: `{nonce, sourceNodeId, order: {orderId, acceptLoss} | null, lacking}`.

**The order on the main box.** No new table: the order is a new kind of handover event row in `node.db` (`reset_ordered`, detail `{targetNodeId, orderId, acceptLoss, personId}`; `personId`, the person who ordered it, was added in the build so the acknowledgement never reads `activity_log`), plus activity entries in `venue.db`.

- **The route.** `POST /management-api/servers/:nodeId/reset` with `{acceptLoss: boolean}`. It needs `node.manage` and a fresh sign-in, as Will not return does (`membership-removal-api.ts:59-67`).
- **Refusals** (all new codes except the last two):
  - `membership.node_not_replaced`: the target is not `sell-only`.
  - `handover.reset_loss_unaccepted`: there is no completed return, and the person did not accept the loss.
  - `handover.operation_in_progress`: only when an open handover names that box **and** its return is not the thing outstanding (`inOpenOperation && !returnOutstanding`, from `openFacts`), checked before the abandon step. A takeover waiting for this box's return is exactly the loss case, and the abandon step closes it, so the removal that follows is not refused at `membership-removal.ts:89`.
  - `management.request_invalid`: the body is malformed.
- **The order's id.** `orderId` is derived from the takeover's operation id and `acceptLoss`, never drawn at random, so there are at most two orders per takeover. The takeover is the open one, or the latest activation from that box once it is closed.
- **Two commits, in the house order.** `node.db`'s lock is taken outside; `venue.db` commits first and `node.db` after, so a retry repairs `node.db`.
  - **In `venue.db`:** the `handover.reset_ordered` activity entry, plus `handover.return_abandoned` in the loss case while the return is outstanding. Their ids are derived from `orderId`, and `recordActivity` drops a second insert of the same id (`packages/db/src/activity-log.ts:45-47`), so a retry after a commit that stopped there writes no second entry.
  - **Then in `node.db`:** in the loss case with the return outstanding only, the operation moves to `return_abandoned`. A completed return is already closed (`states.ts:59,64-69`). The `reset_ordered` event is appended only if none exists for that `orderId`.
  - **`abandonReturn`** (`return-abandoned.ts:38`) opens its own `node.db` transaction today. It is split so that its steps take the caller's transactions; Will not return keeps a wrapper.
- **Pressing again** returns the existing order. **Which order is answered:** event rows are insert-only (`packages/node-db/src/schema/node-handover.ts:69-80`), so nothing is overwritten. The peer route answers the takeover's `acceptLoss: true` order when one exists, and otherwise its `acceptLoss: false` order, whichever was written first. So a loss order replaces one without, and never the reverse.
- **An order whose box never acknowledges** stays on the main box and is answered whenever that box asks, until the person removes the box. **Remove** with the statement stays available on that row, and once it is used the box is refused as no longer a member, so no order waits for it.
- **If the main box is itself replaced while an order waits,** the order stays in the replaced main box's `node.db` and the old box keeps asking that box, so it does not reset. That fails safe; the guide says to remove the old box from the new main box and reset it from a terminal (Task 18 writes that sentence from the code).
- **The listing** gains `reset: null | "ordered"`, `canReset`, and `returnScenario: "controlled" | "emergency" | null`. The scenario is read from `handover_activations` for that source box: the activation whose return completed, or the latest by `activatedAt` when none has.

**Other servers' records** (third read, finding 1). Chosen: **compare, and set aside on any gap.** Rejected: making the return carry other boxes' chains. That changes what the main box accepts from a source (`receive` and `inspect` are bound to the sender's id, `packages/module/src/handover.ts:22-35`), what the completion counts, and the clash rules, all on the fiscal path; the comparison adds two small read seats and changes no write.

- **The seat.** The module handover contract gains two optional reads beside `returnRecords`: `holdings(query)`, on the old box, and `lacking(query, holdings)`, on the main box. The fiscal module fills them: `holdings` lists, for every chain in its `registros_facturacion` (every box id and installation, as `summariseChains` already groups them, `handover-summary.ts:60-66`), the record count, the last sequence number and that record's hash. `lacking` names each listed chain for which the main box does not hold a record at that sequence with that hash, or holds fewer records of that chain up to it.
- **The request carries** `holdings` for every module that fills the seat; **the answer carries** `lacking` per module, inside the signed answer and bound to its `nonce`.
- **The old box decides.** An order with nothing lacking proceeds as ordered. An order without `acceptLoss` but with anything lacking proceeds as a **set-aside reset**: the databases are moved, not deleted, exactly as in the loss case. The acknowledgement then carries `setAside: true` and the lacking chains, and the main box's `handover.reset_acknowledged` activity entry names them.
- **The alert** (the watcher's condition (a), 12:22). In the same transaction as that activity entry, the main box records the incident `chain.set_aside_on_reset` through `recordIncidentOnce` (`packages/core/src/incidents.ts:124`), once per order. Its area claim is the existing `chain.` claim (`packages/db/src/alerts.ts:7`: area `fiscal`, seen by `fiscal.view` holders), and `scripts/alert-codes.test.ts` gains `apps/server/src/reset-order-api.ts` in its list of files that record incidents. Its words, in `apps/dashboard/src/i18n/alert-messages.ts` (lane B's, for the owner to see in the PR):
  - English: "When the old main server reset, it held invoice records of other servers that this server does not have. Nothing was deleted: the old server set them aside and keeps them, but they are no longer used. Keep that server rather than throwing it away."
  - Spanish: "Al restablecerse, el servidor principal anterior tenía registros de facturación de otros servidores que este servidor no tiene. No se ha borrado nada: el servidor anterior los ha apartado y los conserva, pero ya no se usan. Conserva ese servidor en lugar de deshacerte de él."

- **The dialog line stays true:** the records the main box recovered are untouched by any of this; the old box's extra records are set aside on it, not deleted.

**The old box's checks, in one place.** A new helper, `replacedResetCheck`, runs only on the old box, before anything is saved:

- It picks the main box exactly as `sendBatches` does. The target selection moves out of `return-records.ts` (`:104-109`) into the helper, and the return uses it too.
- The answer's signature must verify against the key the return trusts for that box (`peerKeyOf`: a pinned key, or one a trusted held chart vouches for), **its signer must be that box, its `nonce` must equal the one sent**, and the order must name this box. These are the checks `sendBatches` makes on a receipt (`return-records.ts:158-170`); both now share `checkedPeerAnswer` in `main-box-answer.ts`.
- This box must hold its restriction row, and either its chart fences it (`isFencedStanding`, `packages/membership/src/fence.ts:20-24`) or its chart still names itself main while its restriction names the target.
- Without `acceptLoss`, a `return_confirmed` event must exist for the inventory read now.
- It decides `setAside`: true for a loss order, or when anything is lacking.

**The old box acts.** A new `startResetOrderDuty` asks every 30 seconds for as long as the box is restricted, and keeps asking after the return duty stops. It is registered through `restrictedBackgroundDuties` (`background-duties.ts:175-182`), which takes it as a second stopper, with `atStepdown: true` like the return sender. `handover-stepdown.test.ts:327` checks only the full start's duties, so Task 9 adds a case for the restricted ones.

1. **With `acceptLoss`, one more return pass runs first,** so a return that now succeeds loses nothing. It runs **through the return duty**, which gains `passNow()`: one pass, queued behind any pass already in flight, so two passes never send batches at once. After the duty has stopped (confirmed), `passNow()` runs a single pass by itself.
2. **When `setAside` is true, it tests that the set-aside's renames work** before anything is saved: a new `probeEnvironmentMove(roots)` runs the Move's prepare step (`prepareSetAside`, `first-setup-start-again-set-aside.ts:164-243`) on a throwaway name and removes the folders it made. If that is refused, the box saves nothing, does not reset, and logs `replaced-reset.set_aside_unavailable` once per cause; the row stays at "Reset asked" (item 9: only a hand-built layout reaches this, so no row text or listing field is added for it).
3. **When the checks pass,** it saves `replaced-reset.json` with the phase `wiping` and `setAside`.
   - The file is written through `writeFileDurable`.
   - It is a `state-layout.ts` entry with `backup: { exclude: "Local reset in progress." }` and `reset: "deleted"`, so it never enters a backup or a copy.
   - Nothing else is prepared now: the inventory of what to move or delete is taken at the start, when no server is running and nothing new can appear (third read, finding 5).
4. **Only then** does it send the acknowledgement (`ack: orderId`, plus `setAside` and the lacking chains), retrying every 10 seconds for up to 2 minutes. The wipe will destroy its key, so the acknowledgement cannot be sent later.
   - The main box appends `reset_acknowledged`, then removes the box through `removeStandby` (`membership-removal.ts:292`) with `resetStatement: true`, as the person who ordered it.
   - If that removal is refused, the row keeps "Reset asked" and **Remove**, whose line already tells the person to remove the row (Task 16 review).
5. **It asks for a restart** (`signalRestart`, `boot.ts:1513`), whether or not the acknowledgement arrived.

**The wipe at start.**

- **Where it runs.** `finishReplacedReset` runs in `node-entry.ts` **after** `freeSpaceAtStart`, `deleteOldBackupsAtStart` and the spare-space release (`releaseSpareToStart`, `:380-401`), and **before** first-setup admission (`:403-425`), connection repair (`:446-452`), the recovery-level page (`:655`) and the attempt counter (`:715`).
  - Each of the later steps reads state the wipe is changing. Admission, for example, could otherwise send a box with no `trading.env` but a live `venue.db` to first setup or Start again.
  - Running after the spare-space release means a nearly full disk has had its spare given back before the wipe creates any folder (third read, finding 4). The earlier steps only sweep scratch, crash reports, rotated logs and old backups (`start-space.ts:57-95`), all of which the wipe would remove anyway.
- **The environment Move's resume is skipped while the marker is present.** The start's resume (`node-entry.ts:348-369`, `resumeEnvironmentRecovery`) clears the recovery state when it finishes a Move (`recovery-environment.ts:99-112`). With the marker present any Move record is PR 10's own (item 1: a restricted start serves no recovery page, and the start that ran it had already finished any earlier Move at `:350`), so PR 10's wipe finishes it instead and never touches `recovery.json`.
- **How it runs.** It holds the venue lock and checks nothing, because the checks ran before `wiping` was saved. A start that stops partway finishes the job the next time.
- **What it removes or moves: one list for both cases.** The list is the environment Move's own inventory (`packages/provisioning/src/environment-recovery-move.ts:111-125`, exported for this): both databases with their `-wal`, `-shm` and `-journal` files and the Litestream folder (`:66-80`), the first-setup working files, and every state entry a plain reset deletes (`reset: "deleted"`) except the Move's keep set (`:54-65`). That includes `trading.env`, `secrets.env`, `backup.env`, `handover/`, `pair-store/`, `pair-copy/`, `stream/`, `cloud/`, `flows/`, `module-records/` and `setup-clock-step.json`. PR 10 adds `replaced-reset.json` to the keep set; without that, the Move would carry the marker away.
- **Without set-aside (deleting).**
  1. The backup room note and the selected handover copy, as `wipeVenueDatabases` does first (`db-wipe.ts:21-23`).
  2. Every piece of the list, in the list's order, except `scratch/`, which every start empties once it holds the venue folder (`emptyScratch`), so `scripts/backup-staging-touchers.test.ts` needs no new exception. `wipeVenueDatabases` is not used: it removes only `-wal` and `-shm` (`state-layout.ts:27`, `db-wipe.ts:24-27`) and would leave a `-journal` file.
  3. `tls/` by the joined-box rule: on a box that joined another, its contents, then `tls/joined.json` last, then the folder if empty and not a link. That rule is moved out of `runStagedReset` (`reset-request.ts:157-171`) into a helper both use.
  4. The contents of the mounted `backups` folder (`deploy/compose.yml:44`).
- **With set-aside (owner's answer 2, "yes": set aside, not deleted).** The same list is moved, by A1501's Move, into one numbered `records/` set-aside folder:
  - With no Move record yet, the wipe calls `beginEnvironmentMove` under its venue lock (its contract, `environment-recovery-move.ts:155`): it takes the inventory now, runs the rename test, writes the Move record and moves. With a Move record already written, it releases its lock and calls `resumeEnvironmentMove`, which takes the recorded lock itself (`:201-224`). Either way it then calls `finishEnvironmentMove` (`:227-229`) directly.
  - The Move deletes the backup room note first, moves the side files with the databases (committed rows can sit in the `-wal` file, `state-layout.ts:26`), and takes `secrets.env` with them, which holds the key ring that opens the moved databases' sealed rows.
  - **If the rename test is refused at the start** (no Move record yet, so nothing has moved), the wipe rewrites the marker to the phase `set_aside_refused`, logs `replaced-reset.set_aside_unavailable`, and the start carries on as a restricted box. A later start finding that phase wipes nothing. The duty's own test makes this rare (third read, finding 3). If the acknowledgement had arrived, the main box has removed this box, so it is then refused as no longer a member, and only the terminal reset remains (accepted by the watcher at 12:22 as a stated limit). **The restricted page says so plainly** while the marker reads `set_aside_refused` (see "Pages"); a restore or a plain reset removes the marker as before.
  - Then the `backups` folder's contents, as in step 4 above. The set-aside databases are newer than any backup.
  - `records/` is kept by a plain reset and excluded from backups (`state-layout.ts:276-281`). Getting anything back from it still needs a terminal.
- **When it keeps failing.** It throws before the attempt counter, so the box restarts into another try and never reaches the recovery page or its **Restore**. That also means the person sees no page while it fails: Task 8 measures what the box's address shows then and says so in the PR. Even so, every restore path removes the marker as its first durable step under the venue lock, because a restore replaces both databases anyway (Task 11).
- **What it never touches:** `venue/` itself and its lock files, `recovery.lock`, `recovery.json` (this start's attempt counter, `node-entry.ts:715`), `logs/` (this start's page log, `:716`), `spare-space` and `spare-space.released` (only a start on a nearly full disk deletes those, CLAUDE.md §3), `records/` apart from the new set-aside folder, and every volume except `backups`: `logs`, `tunnel_control`, and those the app container does not mount (`mailpit`, `print_agent`, `tunnel_keys`; `compose.yml:42-45`, `waitron.sh:1385`).
- **What it writes:** nothing but the set-aside folder. **The marker goes last.**

**The dialogs** (dashboard, `apps/dashboard/src/i18n/strings.ts`). Each line is its own string, so PR 11 changes one value.

- **Reset and add as spare.** First line, always, in the owner's words:
  - English: "The records recovered from the old main server will exist only on the new main server until the next backup is made."
  - Spanish: "Los registros recuperados del servidor principal anterior solo estarán en el nuevo servidor principal hasta que se haga la próxima copia de seguridad."
- Second line, **only when `returnScenario` is `emergency`** (the watcher's wording, owner "ok"):
  - English: "This was an emergency switch: orders, working hours and other activity the old main server recorded after the spare's last copy are not recovered and will be lost."
  - Spanish: "Fue un traspaso de emergencia: los pedidos, las horas trabajadas y el resto de la actividad que el servidor principal anterior registró después de la última copia del servidor de reserva no se recuperan y se perderán."
  - **Once PR 11 lands, "working hours" is dropped** from both: "This was an emergency switch: orders and other activity …" and "Fue un traspaso de emergencia: los pedidos y el resto de la actividad …". PR 11 makes that change; PR 10's guide sentence says the same and changes with it.
  - The Spanish follows the dashboard's and the guide's own words: "servidor principal", "servidor de reserva", "traspaso de emergencia" (`guide/es/servers.md:250`), "horas trabajadas" (`strings.ts:4728`).
- **Reset anyway and turn into a spare.** The sign-in in place, a required tick, and this warning (lane B's wording, for the owner to see in the PR):
  - English: "Invoice records the old main server has not returned are set aside on it and will no longer be used."
  - Spanish: "Los registros de facturación que el servidor principal anterior no ha devuelto se apartan en él y dejarán de usarse."
  - Plus the same emergency line when `returnScenario` is `emergency`.

**Pages.**

- **The old box's page** shows a new line: "The main box asked this box to reset. It restarts shortly as a new box." Spanish, with the restricted page's own word for box (`i18n/restricted-page.ts:30-46`): "El servidor principal ha pedido restablecer este servidor. En breve se reinicia como un servidor nuevo."
- **The old box's page when its set-aside was refused at the start** (the watcher's condition (b)): it says what happened and gives a step the person can take themselves, with no "contact support" (CLAUDE.md §3's refusal rule). Lane B's wording, for the owner to see in the PR:
  - English: "This box was asked to reset, but it could not set its records aside, so it did not reset. Nothing on it was changed or deleted. The venue runs on the main box and no longer needs this one, so you can switch it off."
  - Spanish: "Se pidió a este servidor que se restableciera, pero no ha podido apartar sus registros, así que no se ha restablecido. No se ha cambiado ni borrado nada en él. El local funciona con el servidor principal y ya no necesita este, así que puedes apagarlo."
  - Switching it off is the only step this page can offer. A reset from the old box's own page is the open question in "Left unclear by the answers", item 1.
- **The Servers row:**
  - after an order: "Reset asked. The old box resets itself when it is on and can reach this box. It may already have reset; if so, remove this row."
  - after the reset: the row reads **Removed** with **Clear from list**, and an activity entry records the reset (naming any other servers' chains set aside).

## PR 10a tasks (full review path: fiscal records, auth, cross-box contract; the owner lands it)

Each task names its failing test first, and each ends with focused tests and `format:check`. Each is sized for one implementer in well under 100 tool calls; an implementer past about 150 calls stops at a passing point, commits and hands over.

1. **The order route.**
   - Failing test: a new `reset-order.test.ts`, covering:
     - each refusal, `handover.operation_in_progress` included, refused for an open handover that is not waiting for this box's return;
     - **a loss order on a takeover waiting for this box's return succeeds**: the operation reads `return_abandoned` and the box is then removable;
     - the two commits: a failure injected after the `venue.db` commit leaves the operation as it was, and a retry with the same `orderId` adds no second activity entry or event;
     - a loss order replacing one without, a no-loss press after a loss order returning the loss order, and the peer-side reader picking the loss order from the two insert-only rows.
   - Files: `reset-order.ts`, `return-abandoned.ts`, `membership-removal-api.ts`, `errors.ts`, `packages/db/src/activity-kinds.ts`.
2. **The listing fields.**
   - Failing test: in the listing's suite, `reset` and `canReset` for each standing; `returnScenario` for a controlled handover, an emergency switch, two activations from one box, and none.
   - Files: `membership-removal.ts` (`listServers`, `:177-213`), `apps/dashboard/src/api/client.ts`.
3. **Other servers' records: the two seats.**
   - Failing test: in `packages/fiscal-verifactu`, a new `handover-holdings.test.ts`: `holdings` lists every chain on a database holding two boxes' records; `lacking` names a chain the other database lacks, one it holds fewer records of, and one whose record at that sequence has another hash, and names nothing for an identical or longer chain.
   - Files: `packages/module/src/handover.ts` (the two optional seats), `packages/fiscal-verifactu/src/handover-holdings.ts`, `handover-summary.ts` (wiring into `VERIFACTU_HANDOVER`). Run `packages/composition/src/composition.test.ts` and `scripts/module-seams.test.ts`.
4. **The peer route.**
   - Failing test: a new `reset-order-api.test.ts`, covering a bad signature, a signer that is not `sell-only`, a removed (`evicted`) signer, the wrong venue, answers with and without an order, the answer carrying the sent `nonce` and the `lacking` list from Task 3's seat, an acknowledgement removing the box (with `setAside` and lacking chains named in its activity entry), an acknowledgement with `setAside` and lacking chains recording one `chain.set_aside_on_reset` incident (and a repeated acknowledgement recording no second one), an acknowledgement with nothing lacking recording none, and an acknowledgement whose removal is refused.
   - Files: `reset-order-api.ts`, `boot.ts`, `packages/db/src/activity-kinds.ts`, `apps/dashboard/src/i18n/alert-messages.ts` (English and Spanish), `scripts/alert-codes.test.ts` (the file list). Run `scripts/alert-codes.test.ts`.
5. **The shared check.**
   - Failing test: a new `replaced-reset-check.test.ts`, covering a fenced chart, a chart naming itself main with a restriction, an unconfirmed inventory, a bad signature, **an answer signed by a box other than the target, an answer whose `nonce` differs**, and `setAside` decided true for a loss order and for a no-loss order with a lacking chain.
   - Files: `replaced-reset-check.ts`, `return-records.ts`; `return-records.test.ts` runs unedited.
6. **The wipe without set-aside, and its stops.**
   - Failing test: `replaced-reset.test.ts`. It checks that:
     - the wipe removes exactly the shared list, **a `-journal` file for each database included**, and leaves every entry on the never-touch list (the claim covers the state folder and the `backups` folder only);
     - a stop after each step finishes at the next start;
     - the marker goes last.
   - Files: `replaced-reset.ts`, `environment-recovery-move.ts` (exporting the inventory and adding the marker to the keep set), `reset-request.ts` (the joined-`tls/` helper; `reset-request.test.ts` runs unedited), `packages/store/src/state-layout.ts`. Run `scripts/state-layout.test.ts`, `durable-writes.test.ts` and `backup-room-note.test.ts`.
7. **The wipe with set-aside.**
   - Failing test, in `replaced-reset.test.ts`: both databases with their `-wal`, `-shm` and `-journal` files, `secrets.env` and the rest of the list arrive in one numbered set-aside folder, while `replaced-reset.json` stays; a stop after the Move record is finished through `resumeEnvironmentMove` and `finishEnvironmentMove` with `recovery.json` unchanged (byte for byte); a refused rename test with no Move record rewrites the marker to `set_aside_refused`, moves nothing and lets the start carry on, and a later start with that phase wipes nothing; `probeEnvironmentMove` leaves no folder behind, refused or not.
   - Files: `environment-recovery-move.ts` (`probeEnvironmentMove`), `replaced-reset.ts`. The environment-mismatch Move's own tests (`environment-recovery-move.test.ts`, `recovery-environment` suites) run unedited. Run `start-again-records-writers.test.ts`, which needs no new entry because PR 10 names no set-aside path itself.
8. **The wipe's place in the start.**
   - Failing test, in `node-entry`'s suite: with the marker present, the environment Move's resume is not called; the wipe runs after `freeSpaceAtStart`, `deleteOldBackupsAtStart` and the spare release, and before first-setup admission, connection repair, the recovery-level page and the attempt counter; repeated failures never reach Restore. Plus **a small-real-filesystem case** (`hdiutil` on macOS, `WAITRON_FULL_DISK_ROOT` on Linux, CLAUDE.md §4): a nearly full disk holding the spare file and a set-aside marker finishes the Move at the first start.
   - Files: `node-entry.ts`, `replaced-reset.ts`. Run `spare-space.test.ts` and `backup-staging-touchers.test.ts`. Measure what the box's address shows while the wipe keeps failing, for the PR.
9. **The duty.**
   - Failing test: `reset-order-duty.test.ts`, against a stand-in main box. It checks that:
     - the acknowledgement is sent only after the durable `wiping` file exists;
     - it is retried for 2 minutes, then the box restarts anyway;
     - the acknowledgement carries `setAside` and the lacking chains when there are any.
   - Plus a case that `restrictedBackgroundDuties` stops both duties, each marked `atStepdown`.
   - Files: `reset-order-duty.ts`, `background-duties.ts`, `restricted-start.ts`, `boot.ts`. Run `handover-stepdown.test.ts`.
10. **The duty's set-aside steps.**
    - Failing test, in `reset-order-duty.test.ts` and `return-records.test.ts`: a loss order runs one more return pass **through `passNow()`**, and a `passNow()` called while the duty's own pass is in flight starts only after it ends (the stand-in main box never sees two batch sends overlap); `passNow()` after the duty has confirmed runs one pass; a refused rename test saves no marker, sends no acknowledgement and logs once.
    - Files: `return-records.ts` (`passNow`), `reset-order-duty.ts`.
11. **Restores remove the marker.**
    - Failing test: `runStagedRestore` and `clearRestorePlacement` (`restore-request.ts:413,709`) and the `waitron-rejoin` command's wipe (`rejoin-command.ts:137`) each remove `replaced-reset.json` before their first write; a plain staged reset (`reset-request.ts:151`) removes it as a `reset: "deleted"` entry.
    - Files: `restore-request.ts`, `rejoin-command.ts`, and their test files only. These are every non-test caller of `wipeVenueDatabases` and `runStagedRestore` on `1390e4b373`; any other restore path found is named in the PR and left to review.
12. **Two-box test: a confirmed return** (`handover-two-boxes.test.ts`). Waits for PR 9.
    - An emergency switch, the return, **Reset and add as spare**, then the old box starts on setup's first page and joins a production venue through PR 9's code comparison.
13. **Two-box test: Reset anyway.** Waits for PR 9.
    - A record clash, then **Reset anyway**: the operation reads `return_abandoned`, and the databases are in the set-aside folder.
14. **Two-box test: an order, then Remove.**
    - An order, then **Remove** with the statement: the old box's next question is refused and it does not reset.
15. **The dialogs.**
    - Failing tests: `servers-screen.return.test.ts` and `servers-screen.a11y.test.ts`: the first line always; the emergency line only for `emergency`; the loss dialog's warning, tick and sign-in.
    - The work: the two items in the `actions` column, pinned to the end, beside today's `abandon`, `remove` and `clear` (`servers-screen.ts:641-646`); the Forms rules; the sign-in in place through `widgets/fresh-sign-in.ts`.
    - Files: `servers-screen.ts`, `i18n/strings.ts`, `i18n/codes.ts`, English and Spanish.
16. **The row lines.**
    - Failing test, in `servers-screen.return.test.ts`: a row with `reset: "ordered"` shows "Reset asked …" in English and in Spanish, and keeps **Remove**; a removed row after a reset shows **Removed** with **Clear from list**.
    - Files: `servers-screen.ts`, `i18n/strings.ts`. Look at the screen in both themes and at phone width.
17. **The old box's page lines.**
    - Failing test, in the restricted page's suite: while the box has a reset order it shows "The main box asked this box to reset …"; with a `set_aside_refused` marker it shows the refused-set-aside text above, in English and in Spanish, and neither text names anyone to contact.
    - Files: `apps/server/src/i18n/restricted-page.ts`, the restricted page's renderer, `replaced-reset.ts` (a reader for the marker's phase). The page is a rendered string, so write it to a file and open it in the workspace's Playwright Chromium, in both themes and at phone width (CLAUDE.md §4).
18. **Words and docs.** Waits for PR 9.
    - `servers.md` in English and Spanish: `#old-box-returns`, `#handed-over`, and `#remove-a-spare`'s "reset it". They describe the reset, the emergency-switch loss, the rejoin through PR 9's code comparison, and one sentence for a main box replaced while an order waits, written from the code that picks which box the old box asks.
    - `docs/operations/operator-procedures.md:15` and `apps/server/README.md:261`, which keep the command for a box that never reaches the main box.
    - A1342's reset sentence in `docs/backlog/replication-cloud.md:407`.
    - A new entry in that file's `## Decisions and deliberate limits` (`:665`): a set-aside refused at the start after the main box got the acknowledgement leaves the box on its restricted page, removed from the venue, and only the terminal reset recovers it (the watcher, 2026-11-21 12:22).

## PR 10c, in outline

- **Dropped: revision 3's 10b.** The owner chose a rejoin through PR 9's approval (answer 1), which needs no PR of its own. A rejoin with nobody involved is revisited after the rehearsal.
- **10c.** The peer route answers an order by itself once the main box holds a completed return and has no spare streaming. It must also wait until a later copy, from a spare or a bucket, holds the returned records, because nobody reads the dialog's first line on this path. The button stays for the loss case. Landed after the next two-box rehearsal.

## Size and risks

**Size, estimated.**

| PR | Files | Production code | Tests | Strings and docs |
| --- | --- | --- | --- | --- |
| 10a | about 45 | about 910 lines | about 1,600 to 2,000 lines | about 280 lines |
| 10c | about 6 | about 100 lines | about 200 lines | |

Eighteen tasks in 10a. Revision 5.1's alert and refused-set-aside page add about 40 production lines, 100 test lines and 30 lines of strings and docs. Against revision 4 (about 850 production lines): dropping `setup-environment.json` and the "cannot set aside" path takes off about 90; the two holdings seats and their plumbing, `passNow()`, the rename probe and the start's refused-probe path add about 110. Nothing is generated: no table and no migration. One new state file (`replaced-reset.json`).

**Risk triggers.**

- **Fiscal records.** A reset with loss takes unreturned invoice records out of use (they are set aside, not deleted), and a reset without loss removes the second copy of returned ones. Other servers' records the main box lacks are set aside, never deleted.
- **Auth.** A new peer route, and an administrator action that removes a box.
- **Cross-box and cross-package contracts.** Two new signed message kinds, `reset-query` (which also carries the acknowledgement) and `reset-order`, and two new optional seats on the module handover contract.

**Protection in the loss case beyond the warning:** a fresh administrator sign-in with `node.manage`; one more return attempt; the order waits until the box can reach the main box; the activity entries; and the databases are set aside rather than deleted.

**Known limits, stated rather than fixed.**

- Set-aside folders accumulate: each set-aside reset keeps one full copy of both databases in `records/`, and nothing reports their size or removes them short of `waitron.sh reset --all`.
- A refused rename test at the start, after the acknowledgement arrived, leaves a removed box on its restricted page; only the terminal reset recovers it. The watcher accepted this at 12:22; the page says plainly what happened (Task 17), and Task 18 records it under the backlog's "Decisions and deliberate limits".
- While the wipe keeps failing the box shows no page (Task 8 measures what it shows).

## Left unclear by the answers

1. **"Whoever finds the box resets it from its own setup page"** (answer 4). A replaced box that was removed while unreachable still holds its restriction row, so when it is switched on it shows the restricted page, not setup's first page, and the only reset is the terminal command. This plan keeps that, and the docs keep the command. If the owner meant a reset button on the old box's own page, that is new work with its own sign-in question (whose sign-in, on a box whose venue data is about to go); recommended: ask after the rehearsal.
2. **The loss dialog.** The owner gave the confirmed-return dialog's words. The loss dialog's warning above is lane B's, and showing the emergency line there too is lane B's choice; both are for the owner to see in the PR.
3. **Other servers' records set aside after "Reset and add as spare".** Settled by the watcher at 12:22: an alert as well as the activity entry (see "The alert"). The alert's wording and the refused-set-aside page's wording are lane B's, for the owner to see in the PR.

## Read findings and answers

**Revision 5.1.** The watcher cleared revision 5 at 12:22 with two conditions, both folded in. (a) Setting aside another server's records that the main box lacks raises the alert `chain.set_aside_on_reset`, with its area claim and English and Spanish words, tested in Task 4. (b) A set-aside refused at the start after the acknowledgement is a stated limit: the marker now keeps a `set_aside_refused` phase instead of being deleted, so the restricted page can say what happened and offer switching the box off (new Task 17), and Task 18 records the limit in the backlog. The join-environment PR has landed (#3955). Eighteen tasks.

**Revision 5.** It applies the third read (below) and two simplifications. The "cannot set aside" path is gone (request field, listing field, row text and tests): the image's venue folder sits inside the state folder on one volume (`state-layout.ts:319-325`, `compose.yml:42`), so a cross-filesystem refusal needs a hand-built layout, and a logged refusal with the row left at "Reset asked" is enough. The environment question is settled by the owner (12:05): the join-environment PR makes every fresh box take the main box's environment from the join bundle, so `setup-environment.json` and revision 4's Task 9 are gone and PR 10 depends on that PR. Tasks are split where an implementer would have run past 100 calls, giving seventeen.

### Third read

1. **A no-loss reset could destroy the only copy of another box's records.** Accepted, checked at `handover-return.ts:72-73` (the return reads only the sender's own chain) and `return-records.ts:72`. The request now carries every chain the old box holds, the main box answers which it lacks, and any gap turns the reset into a set-aside reset ("Other servers' records"). Comparing was chosen over making the return carry those chains, because the comparison changes no fiscal write. Tasks 3, 4, 5 and 9.
2. **"Reset anyway" was refused every time.** Accepted, checked at `membership-removal.ts:89,169-174` and `states.ts:64-69`. The refusal now applies only when an open handover names the box and its return is not what is outstanding; Task 1 adds a loss order on a takeover waiting for its return.
3. **A power cut between the marker and the Move record.** Accepted. The duty runs the rename test before it writes the marker, and at the start a refused rename test with no Move record deletes the marker and carries on restricted. Tasks 7 and 10.
4. **The wipe ran before the spare-space release.** Accepted, checked at `node-entry.ts:350,380-401`. The wipe now runs after the release, and Task 8 adds a small-real-filesystem case.
5. **A Move prepared while the server ran, and its resume touching `recovery.json`.** Accepted, checked at `environment-recovery-move.ts:111-125,156-170` (the inventory is fixed when the record is written) and `recovery-environment.ts:99-112`. The duty only probes; the start takes the inventory, skips the environment resume while the marker is present, and calls `finishEnvironmentMove` directly. Task 7 checks that `recovery.json` is unchanged.
6. **The loss case's extra return pass overlapped the return sender.** Accepted, checked at `return-records.ts:201-240`. The extra pass now runs through the return duty's new `passNow()`, queued behind its own pass. Task 10.
7. **The order answer's checks.** Accepted: the signer must be the target and the `nonce` the one sent, as at `return-records.ts:158-170`. Task 5.
8. **`wipeVenueDatabases` leaves `-journal`.** Accepted, checked at `state-layout.ts:27` and `db-wipe.ts:24-27`. The no-loss case deletes the Move's own list instead, which names `-journal`; Task 6 tests it.
9. **Task gaps.** Accepted. Task 16 (the row lines) names its failing test; Task 11 (the restores) names its files, from the non-test callers of `wipeVenueDatabases` and `runStagedRestore`; `cannotSetAside` is gone; which order is answered from the insert-only rows is stated and tested (Task 1); revision 4's Tasks 5 and 10 are split into Tasks 6 to 8 and 12 to 14.
10. **Replacing the main box again while an order waits.** Accepted: one sentence in the guide (Task 18), and the design says it fails safe.

### Revision 4

It folded in the owner's four answers and the watcher's acceptance of the shape. The rejoin follows PR 9's 11:41 design: the reset box contacts the main box directly and both screens compare a 6-digit code, so revision 3's 10b (a key-proof rejoin or an **Add as spare** click) and every mention of a typed password or a link round trip are gone. In the loss case the databases are set aside through A1501's environment Move (`environment-recovery-move.ts`), which already moves both databases with all their side files, the key ring and everything else a plain reset deletes; it replaced revision 3's hand-assembled move and gives the no-loss wipe the same list. The confirmed-return dialog carries the owner's first line and, only after an emergency switch, the second line, in English and Spanish, with the listing gaining `returnScenario` to choose it. A box that can never reach the main box is left to **Remove**, and a test shows that a removal ends a waiting order.

**Pointers corrected on `ae87c0dcf9`:**

- `modules.ts:285` is the payments module's summary-only contribution, not a return seat; the fiscal seat is at `:325` and `handover-summary.ts:129-133`.
- `fence.ts` is `packages/membership/src/fence.ts`.
- `node-entry.ts:348-369` is the environment Move's resume, not a "state-folder move"; the attempt counter is at `:715`.
- `handover-stepdown.test.ts:327` checks the full start's duties only, not `restrictedBackgroundDuties`, so revision 3's "which the test requires" was wrong; the duty task adds the case.
- A removed box keeps a **Removed** row with **Clear from list** (`servers-screen.ts:641-646`); revision 3's "the main box removes its row" was wrong.
- Removal is also refused while a return is outstanding (`membership-removal.ts:82`), which is why the loss order abandons the return before the removal.
- Smaller line shifts: `return-records.ts:104-109`, `return-abandoned.ts:34-59`, `db-wipe.ts:8-30`, `adopt.ts:159`, `trading-config.ts:29-40`, and the join refusals in `mirror-bundle-api.ts`. On `1390e4b373`, `waitron.sh`'s reset is `wipe_box` at `:1376-1399` with its volume list at `:1385`.

### First read

1. **The acknowledgement came before the checks.** Accepted, checked at `return-records.ts:104-109` and `fence.ts:20-24`. There is one check (`replacedResetCheck`), which picks the main box as `sendBatches` does and accepts the case where the chart names the box itself while its restriction names the target. It runs before `wiping` is saved durably, and the acknowledgement follows. The start does not check, so it cannot discard the reset after the box is removed.
2. **A reset box cannot join a production venue.** Accepted then; settled in revision 5 by the join-environment PR.
3. **The locks and the volumes.** Accepted, checked at `db-wipe.ts:8-30`, `compose.yml:42-45` and `waitron.sh:1385`. The locks and the reset's own file are kept, and the surviving volumes are named. The wipe's claim is narrowed to the state folder and the `backups` folder.
4. **Backup exclusion and durable writes.** Accepted: the marker is excluded from backups and written through `writeFileDurable`.
5. **The write order.** Accepted, checked at `return-abandoned.ts:38`: the order takes `node.db`'s lock outside and writes `venue.db` first. `abandonReturn` is split so that abandoning and ordering commit together.
6. **The second copy.** Accepted, checked at `return-records.ts:72`. The dialog's first line tells the person, and 10c must wait for a later copy. The loss case sets the databases aside (`state-layout.ts:276-281`).
7. **Task size and the stepdown rule.** Accepted: the dialog and the row lines are separate tasks. The duty carries `atStepdown: true`.
8. **The wipe ran after the start clock wait.** Accepted, and changed. That loop (`node-entry.ts:763-855`) waits only for a staged restore. The wipe runs before it, and Task 8 tests that order.
9. **10b in detail.** Accepted then; dropped in revision 4 by the owner's answer 1.

### Second read

1. **The wipe's "everything except" list was wrong.** Accepted. The wipe uses an explicit list, the environment Move's own, and names what it never touches. Task 6 tests both lists.
2. **A started wipe was not always finished.** Accepted. Checked: admission at `node-entry.ts:403-425`, connection repair at `:446-452`, the recovery level at `:655`, all before `:763`. The wipe runs before all of them; it throws before the attempt counter, so it never reaches Restore, and Task 11 makes every restore path remove the marker first. Cost, stated: the person sees no page while a wipe keeps failing.
3. **A lost acknowledgement.** Accepted. The box retries it for 2 minutes before restarting; the row says "It may already have reset"; an unanswered order stays and is answered whenever the box asks, until the box is removed; a refused removal keeps **Remove** on the row (`membership-removal.ts:81-89`).
4. **The loss-case move missed the side files.** Accepted. The Move lists `-wal`, `-shm` and `-journal` for both databases (`environment-recovery-move.ts:66-80`) and deletes the backup room note first (`:133`).
5. **`setup-environment.json` made the whole setup start production.** Accepted then; the file is gone in revision 5.
6. **The write order.** Accepted: two commits, stated; `orderId` derived so a retry is a no-op (`activity-log.ts:45-47`); `return_abandoned` only in the loss case (`states.ts:59,64-69`).
7. **Question 3.** Answered by the owner at 11:46: the two dialog lines above.


## Revision 6: the download of unreturned records, and the bucket check (cleared 2026-11-22 11:09)

> **Cleared by the watcher at 11:09** (lane B's `questions.md`, "WATCHER 2026-11-22 11:09"), after a fresh read on the reviewer account, with all nine calls answered as recommended and four changes, which override the draft below where they differ. The owner's own words (2026-11-21 15:02): "what we should have for both is a download from the old box of the records, which can go to the accountant instead of being lost or left on the box". The draft's Option 1 (the old box makes the file; the person takes it from the old box's row on the main box's Servers page) is a download from the old box. No claim that the owner approved the route.

**The watcher's four changes:**

1. **The dialog's count comes from what the old box already sends** every 30 seconds (each run's count, last number and fingerprint). The main box keeps the latest per box. The separate count request, the seat's count-only mode and its "count matches rows" test are dropped; the only new box-to-box call is the file, on Download.
2. **The bucket check is a one-off measurement**, run with a control each way, written into the PR and the A1323 item, not a permanent CI test (Task 24 becomes the measurement).
3. **Task 21:** the bad-signature case is dropped (`packages/handover/src/envelope.test.ts` covers it); wrong sender, venue, destination, repeated one-time number and "busy" stay.
4. **10a also closes the API:** `POST /management-api/servers/:nodeId/reset` refuses `acceptLoss: true` in 10a, so Reset anyway cannot ship without its download by any route.

**Split.** PR 10a = Tasks 1-18 and the bucket measurement (Task 24), without the Reset anyway menu item, and with the route refusing `acceptLoss: true`. PR 10b = Tasks 19-23 plus Reset anyway (and Task 13's two-box Reset anyway test), landed straight after. If 10b runs past its slice, cut at Task 23 (the dialog block) and say so. Calls 4 and 8: the dialog and the alert say that after the reset the file can no longer be made; revocation of a removed spare's bucket keys goes with A1323, PR 10 carries only the measurement.

## Revision 6 draft (as sent to the watcher), the download of unreturned records, and the bucket check

> Lane B, 22 November 2026. A sized change to fold into the cleared plan
> `docs/superpowers/plans/2026-11-21-a1558-pr10-replaced-box-spare.md` (revision 5.1) before it is built.
> Every code claim below was **read, not run**, on `feat/a1558-replaced-box-spare` at main
> `27cacb7990`. The only commands run were `git log -1`, `grep`, `sed`, `awk`, `cat` and `wc`.
> Line numbers are on that commit.
>
> It answers two requests. First, the owner's (21 November 15:02): "what we should have for both is
> a download from the old box of the records, which can go to the accountant instead of being lost
> or left on the box", with the watcher's brief: a download of exactly the records the old box could
> not return, readable by an accountant, offered before **Reset anyway** and as part of it, named by
> every alert, with no new upload path and no automatic sending. Second, the watcher's check (14:58):
> can a removed spare still reach the venue's backup storage with the keys it holds, and if so, what
> should removing it revoke?

### Words used here

- **Old box**: the main box that was replaced. It now shows only its "restricted page" and sends
  back its invoice records.
- **Main box**: the box that runs the venue now.
- **Chain**: the invoice records one box writes, in order. Each record carries a fingerprint (its
  `huella`) that includes the fingerprint of the record before it.
- **Unreturned records**: invoice records the old box holds that the main box does not.
- **CSV file**: a plain-text table that Excel, LibreOffice and accounting software open.
- **Signed message**: a message carrying a signature made with the sending box's own key. The
  receiving box checks it against the key it already knows for that box.
- **Set-aside folder**: the numbered folder under `records/` where PR 10 moves the old box's
  databases instead of deleting them.
- **Bucket**: the online storage the venue's backups go to. **Access keys** are the username and
  password for it. The **recovery key** unlocks the backups stored in it.

### What the code does today

#### The old box's page has no sign-in, and nobody can sign in on a restricted box

- The restricted page answers GET requests for the till's and the dashboard's addresses with a page
  built from this box's own data. It checks no session (`apps/server/src/restricted-page.ts:221-244`).
- A restricted start mounts only five sets of routes: the restricted page, peer status, membership,
  handover status and the handover source (`apps/server/src/boot.ts:2192-2227`). On top of those it
  adds the node API and refuses money and drawer writes. It leaves every other route unanswered
  (`apps/server/src/restricted-start.ts:37-60`).
- The management API, which holds the sign-in routes, is mounted only by the zone-repair start
  (`boot.ts:2714`) and the full start (`boot.ts:3380`), and never by `restrictedStart`. So **nobody
  can sign in on a restricted box today.**
- Adding a sign-in there would clash with a guarded rule. A password sign-in ends by writing a
  session row (`packages/identity/src/manager-login.ts:152`, `management-session.ts:52`) to
  `dashboard_sessions`, which is in `venue.db` (`packages/db/src/classification.ts:356-360`). But
  `apps/server/src/boot.restricted-quiet.test.ts:296-300` checks that a restricted start "writes
  nothing to venue.db". A recovery code also writes, when it is used up (`manager-login.ts:137-141`).

#### The accountant export is a spreadsheet workbook. A CSV for the accountant already exists elsewhere

- The accountant export is an `.xlsx` workbook with three sheets: issued invoices, recorded
  purchases, and other card machines (`apps/server/src/accountant-export.ts:184-280`, rendered by
  `xlsx-workbook.ts`). Its route is `POST /management-api/reports/accountant-export`, guarded by
  `report.export` (`report-api.ts:82,481-504`). Each download writes an activity entry
  (`:491-496`).
- The invoice sheet has one line for each VAT rate on an invoice, with the total on the first line
  (`accountant-export.ts:192-225`). Its columns (`i18n/accountant-export.ts:48-67`, Spanish at
  `:136-155`, plus the two extra headings at `:43-44` and `:131-132`) are: invoice id, node id,
  invoice number, type, issue date, customer, customer tax number, identifier type, identifier
  country, customer country, customer address, VAT rate, base, VAT, total, original invoice id,
  original invoice number, voided at, notes, sale date, and payment on account.
- It reads the `sales` table, not the invoice records (`accountant-export.ts:319-352`). It also
  **leaves out substitution (F3) sales** (`:351`, `isNull(saleSubstitutions.id)`).
- An accountant CSV already exists: the deferred-payments file, `text/csv`, from
  `POST /management-api/reports/deferred-payment-export`, guarded by the same `report.export`
  (`report-api.ts:452-476`, rendered at `deferred-payment-export.ts:137-178`). Its cell helper
  quotes every cell. It puts an apostrophe in front of text that starts like a spreadsheet formula
  (`attendance-export-csv.ts:3-10`). Amounts use a comma in Spanish (`deferred-payment-export.ts:18-21`).
  No CSV of the invoice-sheet fields exists.
- `report.export` is held by managers by default (`packages/identity/src/permissions.ts:25`).
  `node.manage`, which the Servers dialogs need, has no default holders (`:29`). An administrator
  holds every permission (`packages/identity/src/authority.ts:42-45`).

#### What the old box can know about "exactly the records it could not return"

- **On its own, only "all or nothing".** The return writes `return_confirmed` only when every
  batch's receipt says `accounted: true` for the current inventory (`return-records.ts:69-89,163-177`).
  A refusal ends the pass, and nothing keeps a list of the rows the main box accepted
  (`:152,177`). So the old box alone can say "everything is back" or "not everything is back",
  never which records.
- **With the main box's help, exactly.** Each box numbers its own records without gaps. The next
  number is the head's plus one (`packages/fiscal-verifactu/src/chain.ts:173`), and the number is
  unique per box (`schema/registros.ts:124`, `registros_tenant_node_secuencia_uq`). Each record
  stores its own fingerprint and the previous one's (`schema/registros.ts:100,108`). So suppose the
  main box holds a box's records up to number `s`, with no gap and with the same fingerprint at `s`.
  Then it holds the same history up to `s`, and the unreturned records of that box are those after
  `s`.
  - The plan's Task 3 seats already compare chains this way. `holdings` lists, for each chain, the
    count, the last number and that record's fingerprint, grouped as `summariseChains` groups them
    (`handover-summary.ts:60-79`). `lacking` names each chain the main box does not fully hold
    (plan, "Other servers' records").
  - The plan's `holdings` covers **every** chain the old box holds, its own included. So after
    **Reset anyway**, the old box's own chain is "lacking" too. This matters for the alert (question 6).
- **Every record has a sale.** `sale_id` is never empty (`schema/registros.ts:52-56`), so the
  invoice fields the accountant export uses can be read for every unreturned record. The returned
  batches already read those sales, on the restricted box, straight from the database and never
  inside a write transaction (`handover-return.ts:55-125`, called at `return-records.ts:61-66`).

#### Personal data

Invoice records and their sales carry customers' names, tax numbers and addresses
(`accountant-export.ts:327-332`). So the file must only ever go to a signed-in person who holds the
right permission, and it must never be written to a log.

### Revision 6: the download of unreturned records, and the bucket check

#### What a person can do when it lands

**On the main box, System → Servers, the old box's row.** Both of PR 10's dialogs, **Reset and add as
spare** and **Reset anyway and turn into a spare**, gain a block at the top. When the dialog opens,
the main box asks the old box how many records it holds that the main box lacks. The block then
shows one of these:

| State | English | Spanish |
| --- | --- | --- |
| Records found | "The old main server holds {count} invoice records that this server does not have." | "El servidor principal anterior tiene {count} registros de facturación que este servidor no tiene." |
| (follows it) | "Download them for your accountant before you reset it. Once it has reset, they can no longer be downloaded." | "Descárgalos para tu gestor antes de restablecerlo. Una vez restablecido, ya no se podrán descargar." |
| Button | "Download for accountant (CSV)" | "Descargar para tu gestor (CSV)" |
| Some chains could not be matched | "Some servers' records could not be matched with this server's copy, so the file lists all of their records; this server may already have some of them." | "Algunos registros no se han podido cotejar con la copia de este servidor, así que el archivo incluye todos los de esos servidores; puede que este servidor ya tenga algunos." |
| None (shown in Reset anyway only) | "The old main server holds no invoice records that this server does not have." | "El servidor principal anterior no tiene ningún registro de facturación que este servidor no tenga." |
| Old box out of reach | "This server cannot reach the old main server just now, so it cannot list or download the invoice records the old server holds. Switch the old server on and connect it to the venue's network, then open this again." | "Ahora este servidor no puede comunicarse con el servidor principal anterior, así que no puede ver ni descargar los registros de facturación que tiene. Enciende el servidor anterior y conéctalo a la red del local, y vuelve a abrir esto." |
| No `report.export` | "Downloading these records needs the right to export reports for the accountant, which your account does not have. Sign in with an account that has it to download them." | "Para descargar estos registros hace falta el permiso de exportar informes para el gestor, que tu cuenta no tiene. Inicia sesión con una cuenta que lo tenga para descargarlos." |

The button follows the sales screen's accountant button, "Download for accountant (XLSX)" /
"Descargar para tu gestor (XLSX)" (`apps/dashboard/src/i18n/strings.ts:3147,7909`). The button stays
quiet while the count loads. A failed download shows its message on its own line at the bottom,
above the buttons (Forms rules).

**The Reset anyway tick** changes its words to match the block:

- Records found: "I have downloaded the records for my accountant, or I accept that they stay set
  aside on the old server and are no longer used." / "He descargado los registros para mi gestor, o
  acepto que se queden apartados en el servidor anterior y dejen de usarse."
- Old box out of reach: "I accept that the old server's records cannot be downloaded before it
  resets, and that they stay set aside on it and are no longer used." / "Acepto que los registros
  del servidor anterior no se puedan descargar antes de que se restablezca, y que se queden
  apartados en él y dejen de usarse."

**The file.** It is named `unreturned-invoice-records-<old box id>-<date>.csv` and written in the
venue's language, as the accountant export is (`report-api.ts:500`). It has one line for each
unreturned invoice record and each VAT rate on it, the same layout as the workbook's invoice sheet.
The first seven columns are new and describe the record:

| English | Spanish |
| --- | --- |
| Chain node id | Id. de nodo de la cadena |
| Installation number | Número de instalación |
| Record number in chain | Número de registro en la cadena |
| Record type (Issue / Cancellation) | Tipo de registro (Alta / Anulación) |
| Record created at (UTC) | Registro generado el (UTC) |
| Sent to AEAT (Waiting / Being sent / Accepted / Accepted with errors / Refused / Stopped / Held) | Envío a la AEAT (Pendiente / Enviándose / Aceptado / Aceptado con errores / Rechazado / Detenido / Retenido) |
| Whole chain listed (Yes when the main box's copy could not be matched) | Cadena completa (Sí cuando no se ha podido cotejar la copia del servidor principal) |

2026-11-23 pointer: PR #4152 shows every time in the old box's download with its offset from UTC, in the venue's local time except the Working hours tab's clock-event time, which keeps the offset recorded with it; the headings no longer say UTC (the owner's choice, 2026-11-23).

The rest are the workbook's invoice columns and words, unchanged. Unlike the workbook, the file
**includes** a record whose sale is a substitution (F3), because that record is unreturned too.
The seven filing states are the module's own (`packages/fiscal-verifactu/src/filing-states.ts:5-13`).

**On the old box's own page** (restricted page words, which call a box "servidor"):

- "This box holds {count} invoice records that the main box does not have." / "Este servidor tiene
  {count} registros de facturación que el servidor principal no tiene."
- "To keep them for your accountant, download them on the main box: System → Servers, this box's
  row, Download for accountant. Do this before this box is reset." / "Para guardarlos para tu
  gestor, descárgalos en el servidor principal: Sistema → Servidores, la fila de este servidor,
  Descargar para tu gestor. Hazlo antes de que se restablezca este servidor."
- Before its first answer from the main box: "This box has not yet compared its invoice records with
  the main box's." / "Este servidor aún no ha comparado sus registros de facturación con los del
  servidor principal."

The page already links to the main box (`restricted-page.ts:208`). The row item "Download for
accountant" opens the same block in a small dialog of its own, so the old box's page can point
somewhere that is not a reset.

**The alert `chain.set_aside_on_reset`** (Task 4) keeps one message and gains two endings. The
dashboard picks an ending by whichever of its true/false values is true
(`packages/dashboard-kit/src/alert-messages.ts:18-20`). The message drops "of other servers"
(question 6):

- English: "When the old main server reset, it held invoice records that this server does not have.
  Nothing was deleted: the old server set them aside and keeps them, but they are no longer used.
  Keep that server rather than throwing it away."
  - `downloaded`: " A list of them for your accountant was downloaded from System → Servers before
    the reset."
  - `notDownloaded`: " Nobody downloaded the list of them for your accountant before the reset, and
    it can no longer be downloaded."
- Spanish: "Al restablecerse, el servidor principal anterior tenía registros de facturación que este
  servidor no tiene. No se ha borrado nada: el servidor anterior los ha apartado y los conserva, pero
  ya no se usan. Conserva ese servidor en lugar de deshacerte de él."
  - `downloaded`: " Antes del restablecimiento se descargó desde Sistema → Servidores una lista de
    ellos para tu gestor."
  - `notDownloaded`: " Nadie descargó la lista para tu gestor antes del restablecimiento, y ya no se
    puede descargar."

**New error codes**, with English and Spanish words in `apps/dashboard/src/i18n/codes.ts`:

- `handover.unreturned_unreachable` uses the "Old box out of reach" words above.
- `handover.unreturned_answer_invalid`: "The old main server's answer could not be verified as
  coming from it, so nothing was downloaded. Try again in a minute." / "No se ha podido comprobar
  que la respuesta venga del servidor principal anterior, así que no se ha descargado nada. Vuelve
  a intentarlo en un minuto."
- `handover.unreturned_busy`: "The old main server is already preparing a download. Try again in a
  minute." / "El servidor principal anterior ya está preparando una descarga. Vuelve a intentarlo en
  un minuto."

#### Design options: where the download is served, and who may take it

**Option 1 (recommended): the main box fetches the file from the old box when a person presses
Download.**

- The person signs in to the main box's dashboard as they do now.
- The main box sends the old box a signed request over the box-to-box channel. That channel already
  runs in this direction: the main box fetches the old box's final copy and posts its acceptance to
  routes the restricted start serves (`handover-destination-duty.ts:400-433,517-544`;
  `boot.ts:2214-2226`). The request carries the main box's own `holdings`.
- The old box works out the unreturned records from those holdings and builds the CSV from its own
  database, reading only. It answers with the file and a signed digest, a short fingerprint of the
  file's bytes that proves the file came from that box unchanged.
- The main box checks the signature and the digest, then streams the file to the person without
  storing it. It records an activity entry and a `node.db` event saying who downloaded it and when.
- **Who:** `report.export`, the accountant export's own permission (`report-api.ts:486-489`). The
  count alone needs only `node.manage`, the dialog's permission, because a count shows no personal
  data.
- **What it gets right:**
  - It uses the venue's current accounts and every sign-in method: password, passkey and Google.
  - It writes nothing to the old box's `venue.db`, so `boot.restricted-quiet.test.ts` stays as it is.
  - It keeps the record of who downloaded on the main box, in the usual activity log.
  - It lets the dialog know whether anyone downloaded, which the alert needs. The alert reads a
    `node.db` event, never the activity log, because no product decision may read the activity log
    (CLAUDE.md §3).
  - The new route on the old box only reads.
- **Cost:**
  - About 600 to 680 production lines. That includes a new signed message kind and a new route on
    the old box.
  - The main box must be able to reach the old box. The plan's reset works without that, because
    the old box does the asking. When the main box cannot reach the old box, the dialog says so and
    the tick says the records cannot be downloaded first.
  - The old box's page points to the main box instead of offering the download itself. That is a
    narrower reading of the watcher's "its page offers a download" (question 2).
  - The records cross from the old box to the main box. They pass through and are never kept
    (question 1).

**Option 2: a sign-in on the old box's restricted page.**

- A form on the old box's page takes an email, a password and an authenticator code. It checks them
  against the old box's own copy of the venue's accounts, reading only. If the person holds
  `report.export`, the same request answers with the CSV. No session is stored.
- **What it gets right:** the old box's own page offers the download, word for word as the watcher
  asked. It works while the main box is down or cannot reach the old box.
- **Cost:**
  - It adds a new sign-in on an unattended box, which counts as an authentication risk. It needs a
    read-only password check in `packages/identity`, because today's `loginManager` writes a
    session row (`manager-login.ts:152`). It also needs its own limit on repeated wrong attempts.
  - It checks people against an **out-of-date copy of the accounts**. Someone removed, suspended or
    given a new password on the main box since the handover would still be judged by their old
    details.
  - It supports passwords only. Passkeys and Google sign-in need a challenge row in `venue.db` and
    the old box's own address. Recovery codes write when they are used up.
  - The main box never learns whether a download was taken, so the alert cannot say.
  - The same login refusal rules apply: one sentence, `password.invalid`, after the same hashing
    work (CLAUDE.md §3, `manager-login.ts:95-152`).
  - It is about the same size as Option 1, at roughly 550 to 620 production lines, but more of it
    is sign-in code.

**Option 3: the main box hands the browser a short-lived signed ticket, and the browser fetches the
file from the old box itself.** Rejected unless it is measured. The browser would have to trust the
old box's certificate for a background request. The guide tells people to "accept your browser's
warning once" for a box's address (`apps/server/src/guide/en/servers.md:35`), and a background
request cannot accept a warning. The ticket would also be a bearer secret in the browser, meaning
whoever holds it can use it.

**After the old box has reset.** The file can no longer be made under any option. A deleting reset
has removed the records, and only after the main box held every one of them. A set-aside reset
keeps them only in the set-aside folder, where nothing reads them without a terminal
(`state-layout.ts:276-281`, plan item 9). Two choices:

- **(a) Recommended:** say so. The dialog says it before the reset, and the alert ending says
  whether anyone downloaded the file.
- **(b)** Also write the CSV into the set-aside folder during a set-aside reset. That is about 25
  production lines. But it is a file left on the box, which the owner said was not the goal, and it
  still needs a terminal to reach.

#### "Exactly" the unreturned records: the rule

For each chain (a box id and an installation) on the old box, the main box's `holdings` give its
count, last number `s` and fingerprint `h` for that chain. The old box then decides:

1. If the main box lists the chain, the old box's record number `s` has fingerprint `h`, and the old
   box's count of that chain up to `s` equals the main box's count, the unreturned records are the
   old box's records of that chain numbered after `s`.
2. Otherwise (the main box lacks the chain, the fingerprint differs, or the counts differ), every
   record of that chain on the old box is listed. Those lines carry **Whole chain listed: Yes**, and
   the dialog shows its "could not be matched" line.

In the usual case the main box started from the spare's copy, so it holds an unbroken run of the old
box's chain, and case 1 gives exactly the records written after that copy. Case 2 lists more than
the missing records and says so. It never lists fewer.

#### Tasks to add (numbered after the plan's 18)

Each task starts with its failing test and ends with its focused tests and `format:check`. Each is
sized for one implementer in well under 100 tool calls.

19. **The fiscal seat for unreturned records.**
    - Failing test: a new `packages/fiscal-verifactu/src/handover-unreturned.test.ts`. On a
      database holding two boxes' chains, it checks:
      - the main box holds the own chain up to 6 with the same fingerprint: records 7 to 10 are
        listed;
      - the main box lacks the other box's chain: all of it is listed, marked whole;
      - the fingerprint at `s` differs: the chain is listed whole;
      - the main box's count up to `s` is short (a gap): the chain is listed whole;
      - the chains are identical: nothing is listed;
      - the count mode returns the same numbers as the rows mode.
    - The work:
      - A third optional seat beside Task 3's two, `unreturned(query, mainHoldings)`. It returns
        each chain's count and whole flag, and the rows: sale id, chain, number, record type,
        created at and filing state, all in English names on the contract.
      - Task 3's `lacking` entries also carry the main box's `{count, lastSequence, lastHash}`, so
        the old box's page can count without a second request.
    - Files: `packages/module/src/handover.ts`, `packages/fiscal-verifactu/src/handover-unreturned.ts`
      (new), `handover-holdings.ts` and `handover-summary.ts` (wiring). Run
      `packages/composition/src/composition.test.ts` and `scripts/module-seams.test.ts`.
    - About 90 production and 200 test lines.
20. **The CSV.**
    - Failing test: a new `apps/server/src/unreturned-records-csv.test.ts`. It checks:
      - the headings in English and Spanish;
      - one line per VAT rate, with the total on the first;
      - a customer name starting with `=` gets an apostrophe in front;
      - an F2 invoice with no customer;
      - a cancellation record;
      - a part payment's "payment on account" cell;
      - **a record whose sale is a substitution (F3) is listed**;
      - 1,000 sale ids are read in chunks below `SQL_VARIABLE_LIMIT`, as the workbook's own read is
        (`accountant-export.ts:170-182`).
    - The work: move the invoice read of `listAccountantExport` (`:319-381`) into a helper that
      takes either the date range or a list of sale ids. Only the range form keeps the F3 filter.
      The accountant export's own tests run unedited. Write `renderUnreturnedRecordsCsv` with
      `csvCell` and `amountCell`.
    - Files: `accountant-export.ts`, `unreturned-records-csv.ts` (new),
      `i18n/unreturned-records.ts` (new: the seven columns and the record-type and filing-state
      words, in English and Spanish).
    - About 100 production, 180 test and 50 string lines.
21. **The old box's route.**
    - Failing test: a new `apps/server/src/unreturned-records-api.test.ts`. It covers:
      - a bad signature;
      - a signer that is not the box this box treats as main;
      - the wrong venue;
      - the wrong destination;
      - a repeated `nonce`;
      - a count answer that is signed and matches Task 19's seat;
      - a file answer whose signed digest matches the bytes;
      - a second file request while one is running, refused `handover.unreturned_busy`;
      - a log line that holds counts only.
    - Plus `boot.restricted-quiet.test.ts`: the quiet case sends one count request and one file
      request before `venue.db`'s hash is taken, and the hash must be unchanged.
    - The work: `POST /api/node/unreturned-records`, mounted only on the restricted start, with a
      peer body limit. It reads straight from the database, never inside `withTransaction`. It uses
      Task 5's choice of main box (moved out of `return-records.ts:104-109`).
    - Files: `unreturned-records-api.ts` (new), `boot.ts` (`restrictedStart`'s routes),
      `replaced-reset-check.ts`, `errors.ts`.
    - About 110 production and 220 test lines.
22. **The main box's route.**
    - Failing test: a new `apps/server/src/unreturned-records-route.test.ts`, against a stand-in old
      box. It covers:
      - a count with `node.manage`;
      - a file with `report.export`, streamed as `text/csv; charset=utf-8` with `no-store` and
        `nosniff` (as at `report-api.ts:472-476`);
      - the `handover.unreturned_records_downloaded` activity entry and the `unreturned_downloaded`
        `node.db` event for the takeover's operation;
      - `authorization.not_permitted` without `report.export`;
      - `membership.node_not_replaced` for a box that is not `sell-only`;
      - `handover.unreturned_unreachable`;
      - a forged digest refused `handover.unreturned_answer_invalid`, with nothing streamed.
    - The work: `GET` (count) and `POST` (file) `/management-api/servers/:nodeId/unreturned-records`.
      The request is signed with the main box's key and carries its `holdings`. The file is fetched
      with `boxDownload` (`mirror-bundle-fetch.ts`, as `handover-destination-duty.ts:44` does).
    - Files: `unreturned-records-route.ts` (new), `boot.ts` (full start),
      `packages/db/src/activity-kinds.ts`, `errors.ts`, `apps/dashboard/src/i18n/codes.ts`.
      Run `scripts/errors-reachable.test.ts`.
    - About 130 production, 240 test and 20 string lines.
23. **The dashboard block.**
    - Failing tests: a new `apps/dashboard/src/widgets/unreturned-records-block.test.ts` and
      `.a11y.test.ts`, in both themes. They cover:
      - loading, found, none, out of reach, and no `report.export`;
      - the button quiet while loading;
      - a failure message on its own bottom line;
      - the "could not be matched" line;
      - the downloaded file's name.
    - Plus, in `servers-screen.return.test.ts`: the row item opens the block, and the tick's words
      follow the block's state.
    - Files: `widgets/unreturned-records-block.ts` (new), `screens/servers-screen.ts`,
      `api/client.ts`, `i18n/strings.ts`.
    - About 130 production, 220 test and 40 string lines.
24. **The bucket measurement** (see "The bucket check" below). Test only.

#### What changes in existing tasks

- **Task 3:** `lacking` entries carry the main box's count, last number and fingerprint (Task 19
  builds it, Task 3's test gains a case). About 15 production and 30 test lines.
- **Task 4:**
  - The alert fires on any lacking chain, the old box's own included (question 6). It uses the
    message and endings above. It chooses `downloaded` or `notDownloaded` by reading the
    `unreturned_downloaded` event in `node.db`, never the activity log.
  - The `handover.reset_acknowledged` entry gains `downloaded: true|false`.
  - New cases: an acknowledgement after a download raises the alert with `downloaded`, and one
    without a download raises it with `notDownloaded`.
  - Run `scripts/alert-codes.test.ts`.
  - About 20 production, 40 test and 10 string lines.
- **Task 9:** the duty keeps the latest verified answer from the main box in memory, so the page can
  count. About 10 production and 20 test lines.
- **Task 13** (two-box Reset anyway): before the reset, download through the main box. The CSV must
  list exactly the records after the spare's last copy. About 40 test lines.
- **Task 15:** both dialogs carry Task 23's block, and the Reset anyway tick takes its two new
  wordings. About 20 production, 40 test and 10 string lines.
- **Task 17:** the three page lines above, from Task 9's in-memory answer. The page is still a
  rendered string, checked in Chromium in both themes and at phone width. About 30 production, 50
  test and 10 string lines.
- **Task 18:** `servers.md`, English and Spanish, `#old-box-returns`: what the download holds, that
  it needs `report.export`, and that it must be taken before the reset. About 30 lines of docs.

#### Size

| Part | Files | Production | Tests | Strings and docs |
| --- | --- | --- | --- | --- |
| Tasks 19 to 23 | 5 new production, 7 new test, about 10 changed | about 560 lines | about 1,060 lines | about 110 lines |
| Changes to Tasks 3, 4, 9, 13, 15, 17, 18 | already in the plan's count | about 95 lines | about 220 lines | about 60 lines |
| Task 24 (bucket) | 1 new test, 3 changed (harness, `ci.yml`, its guard) | 0 | about 200 lines | |
| **Revision 6 in all** | **about 26 files touched, about 15 beyond the plan's 45** | **about 655 lines** | **about 1,480 lines** | **about 170 lines** |

Nothing is generated: no table, no migration, no new state file. The new `node.db` event kind is
free text (`packages/node-db/src/schema/node-handover.ts:75`). With revision 6, PR 10a grows from
about 910 to about 1,565 production lines. That is why question 7 proposes splitting it.

#### What PR 11 (working hours) will reuse

- The old box's route and the main box's route. Both carry a `module` field from the start, so
  PR 11 adds no new message kind.
- The dashboard block: one line and one button per module.
- The CSV cell helpers, the `unreturned_downloaded` event, and the alert endings, chosen the same
  way.
- PR 11 adds its own sibling seat in the workforce module, and its own file. It reuses the working
  hours export's columns and `attendance-export-csv.ts`'s cell rules.

#### The bucket check

**What a spare holds today** (read, not run):

- **The venue's live copy to a bucket ("bucket stream") and a spare cannot exist together.** A join
  is refused while bucket-stream keys are saved (`apps/server/src/mirror-bundle-api.ts:236,262-268`,
  `mirror.bucket_stream_active`). Saving bucket-stream settings is refused while a pair link exists
  (`stream-api.ts:170-174,265-270`). So a spare never needs the bucket-stream keys.
- **Scheduled backups to a bucket ("archive") are not refused while a spare exists.** Their access
  keys are a sealed row in `venue.db`'s `venue_credentials`, purpose `backup.archive`
  (`archive-settings.ts:37,285-303,408-409`). A grep for `readPairLink` found no check in the
  archive path; it appears only in the stream path and the spare's own files.
- **The spare gets a copy of that row and the key that opens it.**
  - `venue_credentials` is sealed under the box's key ring, "which a spare receives from the main
    box when it joins, so both open the main box's rows" (`packages/db/src/classification.ts:258-259,375`).
  - The handover list puts the table "inside the copy" (`packages/handover/src/manifest.ts:158-163`).
  - The join bundle carries the whole ring (`mirror-bundle.ts:80-83`). It also carries the main
    box's `backup.env`, which holds `WAITRON_BACKUP_RECOVERY_KEY`, the key that unlocks the backups
    (`mirror-bundle.ts:84-85,171,255`; written by `adopt.ts:106,236`).
- **Removal revokes none of it.** `removeStandby` marks the box removed in a new chart, writes the
  activity entry, and deletes the main box's own pair link (`membership-removal.ts:285-309,376-384`).
  The only code that deletes the archive keys is the Backups page's save without keys
  (`archive-settings.ts:408`). Nothing on either box rotates the recovery key or the ring at
  removal.
- **A removed spare does not send backups by itself.** The backup job runs only while the box is
  primary (`boot.ts:3731`). So the exposure is keys sitting on a box that is no longer a member,
  not backups it writes.
- **PR 10 adds a second case.** A set-aside reset moves `venue.db`, `secrets.env` (the ring) and
  `backup.env` into the set-aside folder (plan, "What it removes or moves"). The old box then keeps
  the same keys after its reset. A deleting reset removes them.

**Expected from reading:** a removed spare can still list and read the backups bucket with the
archive keys in its copy, and can unlock the backups with its recovery key. This is an expectation;
Task 24 measures it.

**Task 24: the measurement.**

- **Where:** a new `apps/server/src/removed-spare-bucket.e2e.test.ts`, built on the existing
  two-box join scenario (`apps/server/src/testing/spare-join-scenario.ts`, used by
  `spare-join.e2e.test.ts`). It uses real pinned Litestream and versitygw, the S3 test server from
  `scripts/setup-s3-test-server.mjs`. The file is added to CI's `test-server-stream` job list
  (`.github/workflows/ci.yml:1464-1479`) and to the matching `--exclude` list (`:1299-1314`). Run
  `scripts/ci-workflow.test.mjs`. As in `spare-join.e2e.test.ts:25-36`, it skips locally without
  the binaries and fails in CI.
- **Steps:**
  1. Start versitygw with an archive bucket. Save archive settings on the main box with keys that
     can list that bucket, and put one object in it.
  2. Join the spare and wait until its copy holds the `backup.archive` row.
  3. Remove the spare through the real route.
  4. From the spare's state folder only: load its ring from `secrets.env`, open its `venue.db`
     read-only, call `readArchiveSettings`, and list the bucket with `createS3ObjectStore`.
  5. Compare the fingerprint of the spare's recovery key with the main box's (`keyFingerprint`),
     never the key itself.
  6. Case B: run Task 7's set-aside on the spare's folder, then repeat step 4 from the set-aside
     folder.
- **Controls, so the probe can show either answer:**
  - The main box's own keys list the bucket. This proves the bucket is reachable and the probe can
    succeed.
  - The spare's keys with one character of the secret changed are refused by versitygw. This proves
    the probe can show a refusal.
  - Both controls must pass for the measurement to count.
- **What it prints:**
  - The test asserts what it measures and says so in its name. It ends in a single line, either
    `removed spare: archive keys LISTED the bucket (<n> objects); recovery key fingerprint matches
    the main box's` or `removed spare: archive keys REFUSED (<S3 error name>)`.
  - It prints only lengths and fingerprints of keys, never a key (global rule on secrets).
  - It is written as a characterisation test, one that pins today's behaviour: its assertion pins
    the measured answer. If it finds LISTED, the revocation item below flips it to REFUSED. If it
    finds REFUSED, the expectation above was wrong, and the PR says so.
- About 200 test lines, no production change. It is independent of Tasks 1 to 23 and can be built
  first.

**What removing a spare would need to revoke if the measurement shows LISTED** (design only, sized):

1. **The archive access keys.** Waitron holds only the keys the owner typed in. It cannot make new
   ones at the storage provider, so this is a step only the owner can take. When a spare is removed
   (`removeStandby`, including PR 10's removal on acknowledgement) while a `backup.archive` key is
   saved, the main box raises an owner alert in the same transaction. The alert says the removed
   server still holds the storage keys. It asks the owner to make new access keys at the storage
   provider, enter them on the Backups page and delete the old ones there. It closes by itself once
   the saved key's revision changes after the removal (`readCredentialMeta`, `archive-settings.ts:325`).
2. **The recovery key.** The same alert asks for a new recovery key through the existing Backups
   rotation (`backup-api.ts:587-618`) and a new recovery pack. That part closes once
   `WAITRON_BACKUP_KEY_ROTATED_AT` is later than the removal.
3. **The ring and the pair store need nothing.** Once 1 and 2 are done, the sealed keys in the old
   copy are dead. The pair link to the spare's own store is already deleted (`membership-removal.ts:376-384`).
4. **A1323 changes this.** When it lands, the pack will no longer carry the storage password and
   backups will come out only through the owner's Cloud sign-in. Point 1 then becomes a Cloud-side
   revocation of the removed box, and should be designed there.

Size: about 90 production, 180 test and 30 string lines, about 8 files. **Recommended as its own
backlog item, bundled with A1323 in `docs/backlog/replication-cloud.md`, not in PR 10.** The fix is in
backup settings and the Cloud, not in the reset, and A1323 changes which keys exist. PR 10 carries
Task 24 and states its result in the PR.

#### Questions, each with a recommended answer

1. **(Watcher)** Does Option 1 fit "no new upload path and no automatic sending"? With it, the main
   box fetches the file from the old box only when a person presses Download, and passes it
   straight to that person without keeping it. *Recommended: yes. Nothing is stored, nothing is
   sent unasked, and the records already travel this path in the return.*
2. **(Owner)** Should the download be taken on the main box's Servers page, with the old box's page
   pointing there (Option 1)? The alternative is the old box's own page offering it behind a
   sign-in that checks an out-of-date copy of the accounts, with passwords only (Option 2).
   *Recommended: Option 1.*
3. **(Owner)** Should the file need `report.export`, the accountant export's permission, with the
   count shown to anyone who can open the dialog? *Recommended: yes.*
4. **(Owner)** After the reset the file can no longer be made. Is (a) saying so in the dialog and
   the alert enough, or should (b) the file also be written into the set-aside folder?
   *Recommended: (a). (b) leaves a file on the box that only a terminal can reach.*
5. **(Watcher)** For Reset anyway, is one tick covering "downloaded, or accept" enough, rather than
   blocking the button until a download is made? *Recommended: one tick. A download can fail, and
   the person must still be able to reset.*
6. **(Watcher)** As Task 4 is written, `chain.set_aside_on_reset` also fires after Reset anyway,
   because the old box's own chain is then lacking. Should it keep firing then, with "invoice
   records" in place of "invoice records of other servers"? *Recommended: yes. The managers who see
   it are often not the person who pressed Reset anyway, and the accountant needs to know either
   way.*
7. **(Watcher)** Should PR 10 be split? PR 10a would be Tasks 1 to 18 and 24, without the Reset
   anyway item in the row menu. PR 10b would be Tasks 19 to 23, the Reset anyway item, and the
   Task 4, 13, 15 and 17 changes, landed straight after. *Recommended: yes. Otherwise one fiscal PR
   reaches about 1,565 production lines. Reset anyway never ships without its download.*
8. **(Watcher, then owner)** Should the removed-spare revocation be its own item bundled with A1323,
   with PR 10 carrying only the measurement? *Recommended: yes. If the measurement shows LISTED,
   the owner alert in point 1 is the first part of that item.*
9. **(Owner)** For a `node.manage` holder without `report.export`: is an explanation plus "sign in
   with an account that has it" acceptable? A different person signing in inside the dialog would
   need a widget the dashboard does not have today. `widgets/fresh-sign-in.ts` re-checks only the
   person already signed in (`:27-33`). *Recommended: yes. Such a person is rare, because
   `node.manage` has no default holders and an administrator holds everything.*

## As built, after the finish review (2026-11-22)

The branch's review wave changed four things this plan describes. The set-aside alert is raised
from `apps/server/src/reset-alert.ts`, not the route file, and its words now say the old box was
told to set its databases aside and that its local backups are removed. Reset is offered, and an
order accepted, only for the old main server whose key this box pinned when it joined
(`handover.reset_not_previous_main` otherwise). The old box's page shows its reset line only once
the box has saved its reset marker, so a box whose set-aside test was refused no longer says it
restarts shortly. The main box works out which chains it lacks only
while an order stands.

**After the owner's approval of 22 November, 22:08.** The two actions are **Wipe and remove** and
**Remove from venue**. A confirmed wipe removes the box and clears it from the list in one signed
list update; only when the list of cleared boxes is full does it keep a **Removed** row. The wipe
dialog has a one-line explanation; after an emergency switch, a line pointing to the old box's
address to download its data first (the download itself is PR 10b's); and a CAUTION line chosen by
the listing's `recoveredRecordsBackup`, which compares when a destination's newest backup started
with when the return completed. The "will be lost" emergency paragraph and the machine number are
gone.

**Since PR 10b's first part (23 November 2026).** The dialog's download line now shows on every
Wipe and remove, after a planned handover as well as after an emergency switch. A comparison of the
old box's latest chain summary with the main box's records, which showed the line after a planned
handover only when it found something, was built and then dropped on the watcher's decision of 23
November 14:25: a wrong answer from it would hide the pointer exactly when records could be lost.
The download lives on the old box's own page, not on the main
box's Servers row: an administrator or a **Manage boxes** holder signs in there with the old box's
copy of the accounts. Revision 6 above is superseded on those points; PR 10b's own plans
(revisions 7 and 8) were kept in the campaign's working folder, not here.
