# A1558 PR 10: the replaced main box becomes a spare — plan (revision 5.1, cleared)

> Lane B, 21 November 2026. **Cleared by the watcher at 12:22** (lane B's `questions.md`, "WATCHER 2026-11-21 12:22"), with two conditions folded in as revision 5.1. **Build order: after the join-environment PR (landed as #3955, `712e06e354`) and PR 9.** Code facts were **read** on main at `1390e4b373`, not run; the two commits since revision 4's `ae87c0dcf9` touched only box upgrades and `deploy/waitron.sh`, whose reset pointers are updated below. The only commands run were `git`, `grep`, `sed`, `awk`, and (for revision 4) one `node` import of `packages/store/src/state-layout.ts`. The owner's first choice ("Yes: a, b and c") is in lane B's `questions.md`, "WATCHER 2026-11-21 10:18"; the owner's answers to this plan's four questions are under "WATCHER 2026-11-21 11:41" (PR 10 part) and "WATCHER 2026-11-21 11:46"; the environment answer ("yes") is at 12:05. The watcher kept PR 10 in lane B and accepted its shape: the old box asks the main box (signed), the order is a new kind of handover event row with no new table, and the databases are set aside rather than deleted when records would be lost. **Full review path; the owner lands it.** Revisions 2 to 5.1 are explained in the last section.

## What a person can do when this lands

- **PR 10a: the two buttons.** On the new main box, **System → Servers**, the old box's row menu offers:
  - **Reset and add as spare**, once this box holds the old box's whole return. Its dialog says, in the owner's words: "The records recovered from the old main server will exist only on the new main server until the next backup is made." After an emergency switch it adds a second line (see "The dialogs").
  - **Reset anyway and turn into a spare**, while the return is not complete. It asks for an administrator sign-in in place, warns that invoice records the old box has not returned are set aside on that box and no longer used, needs a tick, and marks the handover **Will not return** in the same step.
  - In both cases the old box resets itself the next time it checks in with the main box. While it is on and connected, it checks every 30 seconds. It comes back as a fresh box showing setup's first page, and the main box removes it from the venue: its row then reads **Removed** and offers **Clear from list**, as after any removal.
  - **If the old box holds invoice records of some other server that the main box lacks** (see "Other servers' records"), it sets its databases aside instead of deleting them, even after **Reset and add as spare**, the activity entry for the reset says so, and the main box raises an alert saying what happened and that nothing was deleted.
- **Then the person adds it as a spare through PR 9's approval** (owner's answer 1, "yes"). On the reset box's first page they choose **Join or recover**, enter the main box's address and press **Join**. The reset box contacts the main box directly. The main box's **Servers** page lists "A box at <address> is asking to join" with **Check**. Both screens show a 6-digit code; the main box shows three codes and the person taps the one the reset box shows. Nothing is typed into the reset box. A rejoin with nobody involved is revisited after the next two-box rehearsal; it is not planned here.
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

**The order on the main box.** No new table: the order is a new kind of handover event row in `node.db` (`reset_ordered`, detail `{targetNodeId, orderId, acceptLoss}`), plus activity entries in `venue.db`.

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
- The answer's signature must verify against that box's pinned key, **its signer must be that box, its `nonce` must equal the one sent**, and the order must name this box. These are the checks `sendBatches` makes on a receipt (`return-records.ts:158-170`).
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
   - If that removal is refused, the row says "Reset" and keeps **Remove**.
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

- **The old box's page** shows a new line: "The main box asked this box to reset. It restarts shortly as a new box." Spanish, with the restricted page's own word for box (`i18n/restricted-page.ts:30-46`): "El equipo principal ha pedido restablecer este equipo. En breve se reinicia como un equipo nuevo."
- **The old box's page when its set-aside was refused at the start** (the watcher's condition (b)): it says what happened and gives a step the person can take themselves, with no "contact support" (CLAUDE.md §3's refusal rule). Lane B's wording, for the owner to see in the PR:
  - English: "This box was asked to reset, but it could not set its records aside, so it did not reset. Nothing on it was changed or deleted. The venue runs on the main box and no longer needs this one, so you can switch it off."
  - Spanish: "Se pidió a este equipo que se restableciera, pero no ha podido apartar sus registros, así que no se ha restablecido. No se ha cambiado ni borrado nada en él. El local funciona con el equipo principal y ya no necesita este, así que puedes apagarlo."
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
