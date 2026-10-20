# A798 — Degraded but trading: what the box does, and tells staff, when a part fails

Status: **design revision 6; all four questions answered (question 4: (a), 2026-10-20); the build is
planned as its own item, A798-B, in the slices of §8. Nothing is built.**

Revision 6, 2026-10-20: the owner's answer to question 4 recorded — (a), as §4.8 b already described.

Revision 5, 2026-10-20: the owner's answer to question 3 applied — (b), stop taking payments while
the box's clock reads earlier than its last recorded sale. For that case only, this reverses the
earlier rules that a wrong clock warns and never stops a sale (D8) and that staff see no clock notice
(A364); the reversal is recorded in §6. Every till and handheld shows a red strip; every action
that takes or gives back money, or would write a fiscal record, is refused, while orders and the
kitchen carry on; the managers get an alert and an email; the stop clears when the clock no longer
reads earlier than the latest record time in the database (§4.8; pictures 8 and 9). Whether a
manager may restart payments when the box has fresh proof its clock is right is question 4, open,
with a recommended answer (§9). The other choices the owner's answer did not settle are defaults,
listed in §6 under "Decisions revision 5 makes", each open to the owner's override. The review round
(`~/waitron-campaign-b/a798-review/rev5-review.md`) added the one named check on every money route,
the order edits that would file an invoice, the comparison across every chain in the database, the
proof and the 24-hour cap for a restart, and an append-only table to record restarts.

Revision 4, 2026-10-19: the owner's answer to question 2 applied — (a), every device at two minutes.
Once one of a printer's tickets has waited two minutes, every till and handheld shows the amber strip
naming it; a receipt printer only on the devices whose receipts go to it; the sending device's table
banner stays as today (§4.2, §4.4).

Revision 3, 2026-10-19: the owner's answer to question 1 applied — no reserved space; a warning at
2 GB. The box keeps no spare on its disk; at 2 GB free every till and handheld shows the amber strip,
the Box status page and the bell show the warning, and the managers get an email (§4.2, §4.3, §4.6).
A disk that does fill is refused at once, with nothing to soften it.

Revision 2, 2026-10-19: a fresh review and a claim check came back, and the runner made four calls
(`~/waitron-campaign-b/a798-review/round2-decisions.md`). The box no longer corrects its own clock:
question 3 is now about a clock the box can see is behind its last record. A full disk at start was
measured never to reach the recovery page, so the start itself frees space first (§4.7). The staff
notices need a module seat after all (§5). The choices that were hidden in revision 1 are now
defaults (§6). Every other finding is fixed in place.

Backlog entry: `docs/backlog.md`, "A798" under _The box: backups, upgrades and recovery_. Pictures:
[`docs/backlog/mockups/a798-degraded-trading/`](../../backlog/mockups/a798-degraded-trading/README.md),
drawn in HTML with the apps' colour and spacing tokens, not screenshots; each is labelled "today" or
"proposed". The generator is kept outside the repository.

File references are to `main` at `ad57a6bb9`, except those revision 5 added or touched (§4.8, the
two checks before a card reader wherever they are cited — `till-sale.ts:1236-1237` and
`bill-payments.ts:1078` — and experiment 6 of §12), which are to `main` at `be39179b0`. **(read)** marks a conclusion from reading code, not
from running it. Part of the reading was done by search helpers; every citation this design leans
on was re-read. Results measured by the round-2 claim check, and not re-run here, say so. The
experiments run for this design are in §12, each with what the failing case would have printed. All
measurements were on macOS (HFS+ disk images, `node:sqlite` on Node v26.11.1); nothing was measured
on Linux's filesystems, which a real box uses.

**Words used throughout.**
- The **box** is the venue's server. A **device** is anything signed in to the till app: a counter
  **till**, a waiter's **handheld**, or a kitchen screen. A device **that sells** is a till or a
  handheld.
- A sale's **record** is its entry in the fiscal chain (Spanish _registro_), written in the same
  database transaction as the sale. The **chain** links each record to the one before it. The
  **outbox** is the list of records waiting to be sent to AEAT, the Spanish tax agency.
- The **bucket stream** is Litestream copying the database to the owner's storage bucket every few
  seconds, separate from the scheduled **backups**.
- The **recovery page** is the plain web page the box serves, with no login, when its server will
  not start. The **dashboard** is the manager's app, behind a login.
- A **strip** is a one-line notice under a device's top bar (proposed, §4.2).
- A **seat** is a field on a module's description that the server reads to let the module take part
  in something, such as the bell's alerts (`packages/module/src/module.ts:1462-1518`).

---

## 1. Summary

The rule this design serves is the owner's: **losing a little data is accepted; being unable to
trade is not.** Next to it sits the fiscal rule that never moves: **a box that cannot write a sale's
record must refuse the sale rather than sell unrecorded** (CLAUDE.md §5). An unrecorded sale is not
"trading".

Today most parts fail well. The bucket stream, the outbox, printers and the card provider are all
kept off the sale path by design, and a sale never waits on any of them. What is missing is the
telling:

- **Staff see almost nothing.** No server alert reaches a till or a handheld (§2.8). The house's
  reading of the law asks for a standing on-screen count of records not yet sent to AEAT during an
  outage; it is not built (§2.2).
- **A full disk stops everything that saves**, sales, orders, kitchen sends and clock-ins alike, and
  says "try again", which can never work. At start it is worse: the box restarts forever and never
  shows its recovery page (§2.6).
- **A clock set before 28 October 2024 refuses every sale** with a message about the venue's billing
  data. A clock behind the last record, or years ahead, sells without a word (§2.5).
- **A full disk hides its own cause** and, in one shape of code, would commit half a transaction.
  Both were measured (§2.6, §12).

The proposal (§4):
1. A **strip** on every device that sells: blue for the unsent count, amber for a problem staff must
   work around, red when nothing can be saved (picture 2). It reaches devices on the poll every
   signed-in device already runs, and modules supply their own notices through a new seat (§5).
2. A **Box status page** in the dashboard, under Ajustes beside Diagnóstico, showing every part at
   once with the actions an operator can take without a terminal (picture 4), and the new alerts in
   the bell (picture 3).
3. **Disk:** a free-space watch that warns at 2 GB left — the amber strip on every device that
   sells, the bell, the Box status page and an email to the managers (the owner's answer to question
   1; picture 2) — a refusal before any card is charged, a store fix so a full disk is reported as
   itself and can never commit half a transaction, and a start that frees space before it does
   anything else (pictures 1 and 5). The box keeps no spare space: once the disk is full, every save
   is refused at once until someone frees space.
4. **Clock:** a named refusal for a clock the fiscal rules cannot accept (picture 6), and — the
   owner's answer to question 3 — a stop on taking payment while the box's clock reads earlier than
   its last recorded sale, noticed with no internet (§4.8; pictures 8 and 9). Orders and the kitchen
   carry on. A manager may restart payments only with fresh proof that the clock is right — the
   owner chose (a) for question 4, 2026-10-20 (§4.8 b).
5. Everything for a box that is still trading lives in the dashboard. The recovery page keeps its one
   job, a box that will not start.

The per-module "can a till sell without this" field the old design asked for is still not needed
(§5). The build needs one migration, in the Veri*Factu module's own set (§7).

---

## 2. Today, part by part

### 2.1 The bucket stream

- **It never blocks a sale on the bucket.** Boot starts it "without waiting for the bucket, so a
  bucket that never answers cannot hold boot or a sale" (`apps/server/src/boot.ts:2015-2016`), and
  the supervisor schedules its work and returns (`packages/stream/src/supervisor.ts:242-243`).
- **A sale can wait briefly** while the box folds the database's side file back in, which it does
  when the side file reaches 256 MiB (`DEFAULT_WAL_LIMIT_BYTES`, `supervisor.ts:163-167`). The
  fold-back joins the same one-at-a-time queue as every sale (`packages/store/src/write-queue.ts:74-76`)
  and runs synchronously (`packages/store/src/index.ts:253-256`). How long that takes at 256 MiB has
  not been measured; the end-to-end test asserts sales stay under a one-second bound with a 16 MiB
  limit (`apps/server/src/testing/stream-pause-scenario.ts:82`, `:126`).
- **`/health` reports the stream but never fails on it** (`apps/server/src/health.ts:43-45`).
- **The manager sees** six `backup.*` alerts in the dashboard bell: stopped, refused, unusable
  settings, behind by 15 minutes or more, paused, bucket unusable (`apps/server/src/alert-sources.ts:64-132`),
  each linking to the Backups page. Three of them, behind, paused and stopped, say "Sales continue"
  (`apps/dashboard/src/i18n/alert-messages.ts:82-105`). The Backups page shows the stream's state and
  lag (`apps/dashboard/src/screens/stream-settings-panel.ts:714-748`).
- **Staff see nothing**: the till never reads alerts (§2.8).
- **The operator can** test, change or turn off the bucket settings on the Backups page
  (`apps/server/src/stream-api.ts:219,232,260`). There is no "restart the stream" action; an exited
  Litestream is restarted by the box with a back-off (`supervisor.ts:133-135`).

### 2.2 The AEAT outbox

- **It never blocks a sale.** The sale path never contacts AEAT
  (`packages/fiscal-verifactu/src/slot.ts:20-27`); a sale inserts its record and an `envios` row
  marked waiting, in the sale's own transaction (`packages/fiscal-verifactu/src/backend.ts:198-201`,
  `:251-252`). Nothing reads the outbox on the sale path, and there is no limit on how many records
  may wait (read).
- **It retries** from one minute, doubling, capped at one hour (`drain.ts:65-80`, "a batch that keeps
  failing retries hourly, as art. 16.4 requires"). A network failure backs the batch off and raises
  only a local `incidencia` flag (`drain.ts:978-993`). Separately, it honours AEAT's own wait between
  sends (`drain.ts:182-183`, `:214-218`), using one minute only until AEAT has given a wait of its own
  (`drain.ts:35`, `:221`, `:302-305`), and it holds a chain after repeated refusals of the same kind
  (`drain.ts:62`, `:723`).
- **The manager sees** `fiscal.submission_delayed` once the oldest unsent record is 4 hours old, as a
  warning, and as an error at 24 hours (`packages/fiscal-verifactu/src/submission-alerts.ts:12-13`,
  `:35-45`), plus alerts for stopped submissions, open filing cases, repeated refusals and a missing
  certificate (`submission-alerts.ts:48-151`; `alert-sources.ts:308-326`). There is no screen for the
  outbox itself; the certificate card shows when AEAT last accepted a record
  (`packages/fiscal-verifactu/src/certificate-card.ts:98`).
- **Staff see nothing.** A search of `apps/till/src` finds no outbox wording (read).
- **What the law asks for and is missing.** The house's own reading of Orden HAC/1177/2024 art. 16.4
  (`docs/compliance/verifactu-findings.md:345-360`) lists, during an outage, "persistent on-screen
  count of unsent records, _'mientras quede alguno de estos por remitir'_", and the same file lists it
  as not yet built (`:533-534`). Invoicing must not stop during the outage (`:350-351`).
- **The certificate.** A missing one makes the drain skip and raises `fiscal.awaiting_certificate`
  (`apps/server/src/pass.ts:49`, `:192-199`). An expired one raises `fiscal.certificate_expired`
  (`packages/fiscal-verifactu/src/certificate-alerts.ts:22-45`); sends then fail like a network
  failure (read: `aeat-transport.ts:39-70` checks the certificate's fields, not its dates). Selling
  continues in every case.

### 2.3 Printers and the cash drawer

- **A printer never delays a sale.** Printing is "one read and one insert, with no socket and no wait
  on hardware" (`packages/printing/src/outbox.ts:11-13`); a print agent fetches jobs every 2 seconds
  (`packages/print-agent/src/agent.ts:26-28`). A document is tried up to five times
  (`packages/printing/src/runtime.ts:8`, `:58-60`).
- **A kitchen printer that is down** leaves the order in place. A ticket counts as "in trouble" once
  it has waited two minutes without printing (`apps/server/src/print-job-trouble.ts:7-8`). Then the
  table screen of that ticket's order shows "Problema de impresión · Un ticket de cocina no se ha
  impreso: {stations}" with Reprint (`apps/till/src/i18n/strings.ts:985`, `:2535`;
  `apps/till/src/screens/till-table-order-screen.ts:3062-3086`), and a kitchen screen keeps showing
  the tickets with "Printer {name} has printed nothing since…" (`strings.ts:598-599`). **Other waiters
  see nothing** and keep sending to the same printer (read). The manager sees `printer.jobs_waiting`
  and, while the station is open or has dishes waiting, `station.printer_down`
  (`alert-sources.ts:396-398`, `:671-676`).
- **A receipt printer that is down**: the waiter is told only for a full invoice (F1)
  (`apps/till/src/screens/till-ticket-view.ts:855`); a simplified receipt (F2) gives no feedback
  (read). A thermal printer that is out of paper but still accepts bytes is recorded as printed
  (read: `packages/print-agent/src/transport.ts:59-65` gets no status back).
- **A drawer kick** is sent once and never retried or resent (`packages/db/src/schema/print-jobs.ts:51-52`,
  `:63`), and raises no alert (`alert-sources.ts:342`).

### 2.4 Card readers

- **The card network is off the sale path in one direction only.** A card is charged before the
  sale's transaction opens, and the sale and its record are written afterwards
  (`apps/server/src/till-sale.ts:1306-1324`, `:1536-1552`). Before the reader is asked, the box
  already refuses a sale it could never file (`till-sale.ts:1236-1237`: "Before the reader is asked:
  P3 could never file this sale"). A card payment on a bill takes a second path with its own check
  before the reader, `beginBillPayment`, which runs the same two calls
  (`apps/server/src/bill-payments.ts:1078`); the card is collected (`:1358`) and the sale is
  filed afterwards, when that payment completes the bill (`completeBillPayment` →
  `issueWhenFullyPaid` → `recordSale`, `:1237-1262`, `:706`). Neither check looks at the date or the
  disk (read: `apps/server/src/invoice-selection.ts:87-140`).
- **If the second step fails after a charge**, a later Pay files the sale without charging again —
  but only when the charge was saved as captured (`till-sale.ts:1149-1153`). SumUp saves the attempt
  first and the capture after the charge, in a separate write (`packages/payments-sumup/src/provider.ts:173-185`,
  `:222-233`); if that write also fails, the payment stays "attempting" and the order locked until
  the pending-payment check resolves it (read).
- **When the reader or the internet does not answer**, the till says "El lector de tarjetas no ha
  respondido" (`apps/till/src/widgets/tender-pay.ts:1124-1127`; `strings.ts:2233`). If the outcome is
  uncertain the order stays locked and cash on it is refused until the result is known
  (`till-sale.ts:672-673`; `strings.ts:1248`), which on SumUp can last 15 minutes
  (`packages/payments-sumup/src/provider.ts:46`).
- **The fallbacks CLAUDE.md §5 names** are a standalone terminal (a card typed on a machine Waitron
  does not talk to) and cash. Today the typed card is reached only on a device with no reader
  (`apps/till/src/widgets/tender-pay.ts:592-594`). The decided handheld payment design makes it an
  explicit choice, "Otro datáfono" (A796 Revision 4, §8 default 3); that build is A796-B.
- **The manager sees** `reader.battery_low` and `reader.status_unavailable`; a reader that reports
  itself offline raises nothing, because the check reads only the battery
  (`alert-sources.ts:755-770`). The Payments page shows Online / Offline per reader
  (`apps/dashboard/src/screens/payments-screen.ts:666`). The till has no reader liveness at all
  (`apps/till/src/widgets/reader-picker.ts:8-11`).

### 2.5 The clock

- **The box trusts its own wall clock completely.** `systemClock` reports every reading as
  "confident" and "anchored" (`apps/server/src/till-backend.ts:14-26`; used at `boot.ts:1561`). The
  trusted clock in `packages/fiscal/src/clock.ts` is the other direction — a device anchoring its own
  time to a trusted source such as the box — and has no production caller (read), so `clock.degraded`
  and `clock.jump_detected` are never raised.
- **One reading stamps everything.** A sale's invoice date and its record's generation time come from
  one clock reading (`packages/core/src/record-sale.ts:273-275`, `:315`;
  `packages/fiscal-verifactu/src/backend.ts:222`, `:234-235`), and so do payments, working-time
  records, the business day and session expiry (read; e.g. `apps/server/src/till-clock-api.ts:93`, `:113`).
  Nothing compares a record's time with the previous record's (`packages/fiscal-verifactu/src/chain.ts:153-160`
  reads only the previous record's identity and fingerprint).
- **A clock before 28 October 2024 refuses every sale.** The fiscal library refuses an invoice dated
  before that day (`node_modules/.pnpm/@waitron+verifactu@0.2.1/…/dist/validate.js:610-611`); the
  chain turns that into `fiscal.record_invalid` (`chain.ts:187-197`). Measured with a control (§12,
  experiment 3). The till treats `fiscal.record_invalid` as a permanent refusal
  (`apps/till/src/till-app.ts:450-453`) and says "Esta venta no se puede registrar en Hacienda. … hay
  que corregir los datos de facturación del local, así que avisa a quien configuró esta caja. Si ya
  has cobrado con tarjeta en el datáfono, devuelve el importe ahí." (`strings.ts:2796`) — wrong advice
  for a clock (picture 6). With a connected reader the card is charged before that refusal, on both
  card paths, because neither check before the reader looks at the date (§2.4; read).
- **Any other wrong clock sells.** The round-2 claim check measured a sale stamped 2025 accepted
  after one stamped 2026, and a clock set to 2031 selling; the library's "not in the future" checks
  are judged against the record's own time, so they cannot fire (`chain.ts:187-189`).
- **What checks the clock today.** After each send, the box compares its clock with AEAT's reply and
  raises `fiscal.clock_drift` as a warning past 60 seconds (`apps/server/src/time-health.ts:89-91`,
  `:102-119`; wired at `boot.ts:1382`, `:2405`), saying "you can continue selling"
  (`alert-messages.ts:26-28`). It runs only when something is sent, so with no internet it never
  fires (read). A `timedatectl` probe exists (`time-health.ts:34-43`); its only reader is
  `GET /api/box/status`, which nothing calls (read). Nothing in `deploy/` sets up time
  synchronisation (read: grep for NTP, chrony, timesyncd, timedatectl).
- **The owner decided this before.** D8 (owner, 2026-10-03): "A clock out of tolerance warns, and
  never refuses a sale", with a tolerance of one minute
  (`docs/superpowers/specs/2026-10-03-fiscal-chain-divergence-design.md:753-756`). The same design
  reads Orden art. 3 as switching off the art. 7.f clock duty in Veri*Factu mode (`:364-367`), so the
  minute is the owner's product threshold, borrowed from art. 7.f, not a legal duty in this mode.
  A364 (owner, 2026-10-07) then removed the till's clock notices: "Measured drift remains an
  administrator alert; the till does not poll for it" (`:370-371`). **Revision 5 reverses both for
  one case, a clock that reads earlier than the last recorded sale** (the owner's answer to question
  3; §4.8, §6).
- **Other parts lean on the clock too.** A679's approved series naming works out names from the
  hour, and a future clock "can select a future hour and misdate subsequent work"
  (`docs/superpowers/specs/2026-10-16-a679-hour-coded-series-design.md:74`, `:83`). A box at 2001
  cannot check AEAT's certificate, and A679 forbids switching that check off to get the time (`:108`).

### 2.6 The disk

- **No check watches free space.** The only free-space reads are the backup sweep's, which refuses a
  backup with `backup.staging_space_low` (`apps/server/src/backup-sweep.ts:101-111`), and a restore's
  (`apps/server/src/archive-download.ts:63-65`). The bucket stream pauses itself before its side file
  passes 256 MiB, "to protect its disk" (§2.1). Nothing else, and no alert or `/health` field
  (read: grep for `statfs`, `ENOSPC`, `SQLITE_FULL`, "disk is full").
- **Free space reaching zero is not the moment writes fail.** The round-2 claim check measured, with
  the side file at its largest, 130 more sales committing after the disk read full; once the side
  file was folded back, the first sale failed. Sales reuse room the side file already holds, so the
  watch below is the early warning, and folding the side file back on a full disk can itself need
  space (a fold-back copies pages into the database file).
- **A full disk stops every write, not only sales.** Orders, kitchen sends, clock-ins and kitchen
  screen bumps all write; each fails the same way (read: every route writes through
  `withTransaction`, `packages/db/src/tenancy.ts:30-39`).
- **The sale and its record are one transaction**, so a write that fails writes neither
  (`record-sale.ts:161-162`; `till-sale.ts:902-904`). That is the fiscal rule holding by
  construction.
- **What a full disk does to a transaction — measured (§12, experiments 1, 2 and 4).** On this
  engine a full disk ends the whole open transaction, not just the statement. Through the box's own
  write queue:
  - a body that lets the error escape: the caller is told **"cannot rollback - no transaction is
    active"**, because the queue's rollback (`write-queue.ts:60-62`) runs after the engine has
    already rolled back and its error replaces the real one;
  - a body that catches the error and carries on: the statements after the catch ran **outside any
    transaction and stayed written**, while the rest was rolled back;
  - inside a nested transaction, as the fiscal chain opens one (`chain.ts:288`): the inner caller is
    told **"no such savepoint: wt_sp_1"** and the outer one "cannot rollback"; the adapter's undo
    (`packages/store/src/node-sqlite-adapter.ts:158-163`) hides the real error too. No rows were kept.

  Refusals behave differently (§12, experiment 5): a unique key, NOT NULL, CHECK, an immediate
  foreign key, `RAISE(ABORT)`, `RAISE(FAIL)` and "no such table" keep the transaction open;
  `RAISE(ROLLBACK)`, `INSERT OR ROLLBACK` and `ON CONFLICT ROLLBACK` end it, as a full disk does. The
  schema and the code use none of those three forms (read: grep, one comment in
  `apps/server/src/bill-request.ts:83`). So CLAUDE.md's "a statement this engine refuses backs out
  ITSELF, not the transaction around it" holds for every refusal the product can meet, and **not for
  a full disk**. The fiscal chain's own retry rethrows anything but a unique-key clash
  (`chain.ts:286-292`), so a record cannot be half-written that way (read); whether any other write
  path catches broadly and carries on was not audited — §4.6 makes the question moot.
- **What staff see.** The error reaches the route's error boundary as an unknown error and becomes
  `server.internal`, a 500 (`packages/server-kit/src/error-boundary.ts:39-40`), logged with error code
  "unknown". The till falls back to "No se pudo completar la venta, inténtalo de nuevo"
  (`till-app.ts:5117-5123`, `:763-771`; `strings.ts:2793`). Every retry fails the same way (picture 1).
- **At start, the recovery page is never reached.** Measured by the round-2 claim check: each start
  counts itself before anything else (`apps/server/src/node-entry.ts:442-447`), and on a full disk
  that count cannot be written, so it stayed at one, the box restarted over and over, and the page
  — which needs three counted failures (`apps/server/src/recovery-state.ts:40-43`) — never appeared.
  Opening the database on that disk failed with code 14, which the start would have reported as
  `provisioning.database_unreachable` (`apps/server/src/boot-failure.ts:12`, `:33`), not as a full
  disk. Staff see the till's "unreachable" line (§2.7).
- **What fills the disk** (read unless marked): the database itself, images included, stored in it
  (`packages/media/src/images.ts:333`); a local backup folder, if configured
  (`apps/server/src/backup-config.ts:175-176`); old Docker images left by upgrades, which nothing in
  `deploy/waitron.sh` deletes (grep for `prune`, `rmi`: no match) and which the container cannot see;
  Litestream's own folder beside the database (`docs/developers/conventions-data.md:2953-2958`), which
  may grow while the bucket is unreachable (**unverified**). Smaller: the side file, up to 256 MiB;
  `waitron.log`, rotated at 10 MB × 5 (`apps/server/src/config.ts:141-142`); one crash report per
  frozen database holder, never cleaned up (`packages/store/src/venue-liveness.ts:182-187`). Backup
  staging is deleted after every run (`backup-sweep.ts:215-218`), so it is not a filler unless a run
  is cut off. The Docker volumes live on the same disk as Docker's images (read: the named volumes `state`, `logs` and `backups`,
  `deploy/compose.yml:174-177`).

### 2.7 Other parts that can fail while selling continues

| Part | What happens today | Who is told |
| --- | --- | --- |
| Waitron Cloud (refresh, snapshots, remote-access tunnel) | Retries with back-off; the box sells on (`apps/server/src/cloud-worker.ts:12-23`, `packages/tunnel/src/client.ts:177-195`) | Log lines only; the Cloud services page shows state (`cloud-services-screen.ts:176-187`) |
| Email (SMTP) | Invoice emails record a failed or unknown delivery (`invoice-email-worker.ts:101-106`) | `invoice_delivery.*` alerts; other emails log only |
| Dashboard live stream | Reconnects with back-off to 30 s (`packages/dashboard-kit/src/live-connection.ts:62-91`) | No indicator |
| A module failing at mount | The whole start fails, by design (`boot.ts:767-790`, `:1898`); three failures put the box on the recovery page | Recovery page |
| The box itself, or the network to it | The till shows "unreachable · Check again" on its lock screen and a waiting banner in the shell (`apps/till/src/screens/till-lock-screen.ts:339-362`; `till-app.ts:13401-13405`) | Not "degraded but trading": no node sells (CLAUDE.md §5) |
| Translations (Cloud) | A failed job closes as failed and the loop retries (`content-suggestion-runner.ts:166`, `:184-206`) | `content.suggestions_ready_partly` |

### 2.8 Across all parts: who sees what today

- **Staff on a till or handheld see no alert of any kind.** The till never calls the alerts route and
  has no event stream (read: grep of `apps/till/src`). What it does show: an action's own error line
  (`till-app.ts:13275`), a per-table printing problem (§2.3), refresh notices for kitchen lists, and
  three standing lines that are precedents for a strip — the update-available bar, a `wt-banner`
  (`till-app.ts:13259-13266`), the demo/prepare mode indicator (`:13269-13274`) and the
  waiting-for-promotion banner (`:13401-13405`).
- **What the till already asks the box for, and how often.** Every signed-in device reads its
  equipment every 15 seconds (`GET /api/device/equipment`; `apps/till/src/state/equipment-poll.ts:4`,
  started at `till-app.ts:4012`). The menu check (`/api/menu-state`, also every 15 seconds) runs only
  for the zones on screen, and not at all on a till with no counter zone and no table open
  (`till-app.ts:2250-2259`).
- **The manager** sees the bell, which polls every 60 seconds
  (`apps/dashboard/src/api/live-queries.ts:592-599`) and shows each alert as one sentence, then
  severity · area · time, then a Go-to button (`apps/dashboard/src/widgets/alerts-bell.ts:139-169`).
  No alert is emailed; the one email about box health is the AEAT certificate reminder
  (`apps/server/src/certificate-reminder-worker.ts:76-77`).
- **There is no page showing the whole box.** `GET /api/box/status` already gathers clock, HTTPS
  certificate, chain height, backups, stream and duties, behind `system.manage`
  (`apps/server/src/box-status.ts:23-35`, `:110-139`), but nothing calls it (read). The nearest page
  is Diagnóstico, a live tail of the server's log for managers
  (`apps/dashboard/src/screens/diagnostics-screen.ts:9`; listed under Ajustes,
  `apps/dashboard/src/dashboard-app.ts:288`).
- **The recovery page is never served while the box trades.** The start decides once, before the
  server opens anything (`node-entry.ts:411-439`); its only action is "Reintentar un arranque normal"
  (`apps/server/src/recovery-surface.ts:524-531`), and its own comment says "there is no
  degraded-but-trading mode" (`:500-504`).

---

## 3. The fiscal line that never moves

A box that cannot write a sale's record locally refuses the sale. Nothing in this design softens
that, and nothing in it lets a sale be taken "now" and recorded "later". Losing a little data is
accepted; an unrecorded sale is not trading, it is a hole in the series.

Which failures cross the line, and what the device shows:

| Failure | Crosses the line? | Why | What the device shows (proposed) |
| --- | --- | --- | --- |
| Disk full | **Yes**, and stops every other write too | No transaction can be written (§2.6) | Red strip "No se puede guardar nada: el equipo no tiene espacio · Avisa al encargado"; for a sale, "Venta no registrada: el equipo no tiene espacio en disco. No cobres hasta que se resuelva; avisa al encargado." (picture 1) |
| Clock before 28-10-2024 | **Yes** | The fiscal library refuses the record (§2.5) | Red strip "No se pueden registrar ventas: la hora del equipo es incorrecta · Avisa al encargado"; "Venta no registrada: la hora del equipo es incorrecta (marca 01/01/2001). Avisa al encargado. Si ya has cobrado con tarjeta en el datáfono, devuelve el importe ahí." (picture 6) |
| Append-only protection changed | **Yes, deliberately** | The box stops itself (`apps/server/src/append-only-watch.ts:66-74`) | Recovery page, as today |
| Database cannot be opened or migrated | **Yes** | The server does not start | Recovery page, as today; a full disk at start as §4.7 |
| AEAT unreachable, certificate missing or expired | No | Records chain locally and wait | Blue strip with the unsent count (§4.2) |
| Bucket stream stopped or behind | No | The copy is outside the sale | Nothing for staff; the manager's bell |
| Printer down | No | Printing is a queue | Amber strip on every device at two minutes (question 2) |
| Card reader or provider down | No | Cash and "Otro datáfono" remain | The payment's own message, as today |
| Clock earlier than the last recorded sale by more than a minute | **Payments stop, by the owner's choice** (question 3) | The record could be written, but with a time earlier than the one before it | Red strip "No se puede cobrar: la hora del equipo es anterior a la última venta · Avisa al encargado"; every action that takes or gives back money, or would write a record, refused with `clock.behind_chain`; orders and the kitchen carry on (§4.8, picture 8) |
| Clock otherwise wrong, but after 28-10-2024 | No | Records are written with the wrong time | Nothing for staff (A364); the manager's bell |

**No card is charged while the line is crossed.** When the disk is full or the clock is before
28-10-2024, the box refuses at both checks before the reader: `till-sale.ts:1236-1237` for a sale,
and `beginBillPayment` (`bill-payments.ts:1078`) for a card payment on a bill. When the clock reads
earlier than the last recorded sale, the named check `refuseWhileClockBehind` refuses at the top of
every route that takes or gives back money, before any branch and so before any reader on every path
(§4.8 e). So a connected reader is never charged
for a sale that cannot be recorded; today it is, for a clock before 28-10-2024 (§2.5, §11). A card taken on another machine can still have
been charged, which is why the clock refusal keeps today's card advice. Two gaps are left. One is a
clock that goes behind the last recorded sale between the charge and the record, covered in §4.8 e.
The other is a disk that fills between the charge and the record: then the till says "Cobrado con tarjeta, pero la venta
no se ha registrado: el equipo no tiene espacio. No vuelvas a cobrar; avisa al encargado." (EN: "Card
charged, but the sale is not recorded: the box is out of space. Do not charge again; tell a
manager."). That wording fits only a connected reader. Whether a later Pay can file the sale without
charging again depends on the capture having been saved (§2.4); if it was not, a manager settles it
from the stuck-payments screen once there is space.

---

## 4. The proposal

### 4.1 Two places for an operator, not one

The item asks what "the operator does on the LAN recovery page". **That does not fit a box that is
still trading.** The recovery page exists only when the server will not start, it has no login, and
anyone on the venue's network can open it (`node-entry.ts:411-439`; CLAUDE.md §3). A running box
already has a logged-in home for operator actions, the dashboard. So (§6, defaults 10 and 11):

- **(a) The box is trading with a part failing** → the operator acts in the **dashboard**: the bell
  (picture 3) points at a new **Box status page** (picture 4), which shows every part and links to
  the page that already fixes each one.
- **(b) The box will not start** → the start frees space first, and the **recovery page** gains a
  full-disk code (§4.7). It stays the one place that works with no server.

The operator never needs a terminal in either case (owner, 2026-09-10, memory
`box-operator-has-no-terminal`).

### 4.2 The strip on every device that sells (picture 2)

One line under the top bar of every signed-in till and handheld; on a phone it wraps when the words
need it. Kitchen screens keep their own printer line (§2.3) and get no strip: they do not sell.

- **It shows the most serious notice**, red over amber over blue, and "+1", "+2"… when more are
  waiting; tapping the strip opens the list. It never covers the order, has no close button, and goes
  when the problem goes. It is never a dialog: staff go straight to work (§6, default 4).
- **How it reaches the device.** The equipment read that every signed-in device already makes every
  15 seconds (§2.8) gains a `notices` list the box works out on each ask. No new connection; the menu
  check is not used, because a till with no counter zone never makes it. A device that cannot reach
  the box already shows its own "unreachable" line (§2.7).
- **Where the notices come from.** The core supplies the disk and printer notices: printing is not a
  module (`packages/composition/src/modules.ts:106` lists none), and the printer alerts are the
  server's own (`apps/server/src/boot.ts:2059`; `alert-sources.ts:395`, `:673`). The Veri*Factu
  module supplies the unsent count, the clock-before-28-10-2024 notice and the clock-behind-the-last-
  sale notice through the new seat (§5).
- **The notices** — one wording each, used in every picture (Spanish as shown; English for the
  English till):

| Tone | When | Spanish | English |
| --- | --- | --- | --- |
| Red | A write fails because the disk is full | No se puede guardar nada: el equipo no tiene espacio · Avisa al encargado | Nothing can be saved: the box is out of space · Tell a manager |
| Red | The clock is before 28-10-2024 | No se pueden registrar ventas: la hora del equipo es incorrecta · Avisa al encargado | Sales can't be recorded: the box's clock is wrong · Tell a manager |
| Red | The clock reads more than a minute earlier than the last recorded sale (§4.8) | No se puede cobrar: la hora del equipo es anterior a la última venta · Avisa al encargado | Payments stopped: the box's clock reads earlier than its last sale · Tell a manager |
| Amber | Less than 2 GB free on the box's disk (§4.6) | Queda poco espacio en el equipo · Avisa al encargado | The box is nearly out of space · Tell a manager |
| Amber | One of a printer's tickets has waited two minutes (question 2) | Impresora Cocina no imprime · desde 21:16 | Kitchen printer not printing · since 21:16 |
| Blue | A record is waiting after a failed send | 12 ventas sin enviar a Hacienda · Se reintenta solo | 12 sales not yet sent to the tax agency · Retried automatically |

- **The unsent count** appears from the first failed send attempt (or a send skipped for a missing
  certificate) until no record waits. It counts every record not yet accepted, voids and corrections
  too, though the strip says "ventas", the word staff use. It does not appear on a demo or prepare
  box, which never sends (`apps/server/src/onboarding-policy.ts:12-13`), nor while records merely wait
  out AEAT's own wait between sends (§2.2), which is not an outage. It says "Se reintenta solo" rather
  than "every hour", because the retries start at one minute and double (§2.2).
- **A clock that is wrong but usable puts nothing on the strip**, following A364 (§6, default 12) —
  except one that reads earlier than the last recorded sale, which is red (§4.8).
- **Two reds at once**: the disk's shows first, since nothing at all can be saved; the clock's waits
  behind "+1". A clock before 28-10-2024 shows its own notice rather than the behind-the-last-sale
  one, since it is the cause staff would have to report.

### 4.3 The dashboard: the bell, the Box status page, and email

- **New alerts in the bell** (picture 3), in a new area "Equipo" (EN "Box"), with the same shape as
  today's: sentence, severity · area · time, Go-to. New codes, each with English and Spanish wording
  as the house rule requires (CLAUDE.md §3):
  - `storage.space_low` (warning, emailed): "Al equipo le quedan {free} de espacio en disco. Todo
    sigue funcionando, pero si se llena no se podrá guardar nada. Mira qué ocupa espacio en Estado
    del equipo." / "The box has {free} of disk space left. Everything still works, but if it fills
    up nothing can be saved. See what is using it on the Box status page."
  - `storage.disk_full` (error): "El equipo no tiene espacio en disco: no se puede guardar nada." /
    "The box is out of disk space: nothing can be saved."
  - `clock.unusable` (error: the date is before 28-10-2024), `clock.behind_chain` (error, emailed:
    the clock reads earlier than the last record, and payments have stopped; wording in §4.8 c) and
    `clock.disagrees` (warning: two or more devices disagree with the box), §4.5. They sit beside
    today's `fiscal.clock_drift`, which the bell leaves out while `clock.behind_chain` is open (§4.8 c).
  - `clock.behind_chain_restarted` (warning) and `clock.behind_chain_disproved` (error), recorded
    alerts in the same area as the stop: a manager restarted payments, and a clock a restart
    accepted later proved wrong (§4.8 b, c).
  - `reader.offline` (warning): "{reader} está sin conexión." / "{reader} is offline." — the check
    already gets this answer and ignores it (§2.4).
- **The Box status page** (picture 4), under Ajustes beside Diagnóstico, for people with
  `system.manage`. Diagnóstico stays the log tail for diagnosing; this page answers "is the box
  well?" and so is its own page rather than a section of the log screen. One row per part: Ventas,
  Hacienda, Copia en el bucket, Impresoras, Lectores de tarjeta, Reloj, Espacio en disco. Each row
  has a dot (green fine; amber needs attention and everything still works; red nothing can be
  saved), a line of state, a line of detail and one action. It reads the existing
  `GET /api/box/status` plus the printer, reader and disk checks, and the module seat of §5. Its
  automatic reads are passive, so an open page does not keep a session signed in (CLAUDE.md §3,
  "Automatic dashboard reads are passive session activity"). Two actions are new:
  - **Reintentar ahora** clears the network back-off of the waiting records so the next pass sends
    them. It does not skip AEAT's own wait between sends or release a chain held after repeated
    refusals (§2.2). It is the Veri*Factu module's own route.
  - **Liberar** deletes only what the box can make again (§4.6) and says how much it can free before
    it does. Below the rows the page names what really fills the disk and who can clear it.
- **Email.** The red conditions (disk full, clock before 28-10-2024), the 2 GB disk warning, and a
  clock behind the chain email everyone with `system.manage` and an email address, once per episode
  (§6, default 7). "Once per episode" is held in memory: a restart during an episode may send one more,
  which keeps the build free of a new table (§7).

### 4.4 Part by part: the bucket stream, the outbox, printers, card readers

- **Bucket stream.** No change for staff: they cannot act on it and sales continue. The Box status
  row shows its lag and links to Copias de seguridad. No email: the owner's posture accepts losing the
  un-copied tail (memory `cold-recovery-no-hot-failover-posture`, 2026-08-29), and the six alerts
  already exist.
- **Outbox.** The blue strip (§4.2) answers the house's reading of art. 16.4. The Box status row
  shows the unsent count, the last accepted record and **Reintentar ahora**. The dashboard's own
  thresholds (4 h, 24 h) stay.
- **Printers** — the owner's answer to question 2. Once one of a printer's tickets has waited two
  minutes, every till and handheld shows the amber strip naming the printer (§4.2); a receipt printer
  shows only on the devices whose receipts go to it. The sending device's per-table banner stays as
  today.
- **Card readers.** No new staff notice: the payment form already says when the reader does not
  answer, and "Otro datáfono" and cash are the ways on (A796). The manager gets `reader.offline`.

### 4.5 The clock

The box does **not** correct its own time. It cannot do so honestly: a box at 2001 cannot check
AEAT's certificate and so gets no time from AEAT (A679 forbids switching that check off, §2.5); a
saved AEAT time cannot be carried forward, because a counter that only goes forward restarts when the
box does; one device "agrees with itself", and a phone set by hand would set invoice dates; and
stamping only sales would leave payments, working time, the business day and session expiry on the
wrong clock. Nor can the server set the system clock: on Docker Desktop, a container's default
capability set leaves out the clock-setting capability (measured; not measured on a box's Linux
Docker), `deploy/compose.yml` adds none (read: no `cap_add` or `privileged`),
and experiment 6 (§12) printed that ceiling without it on Docker Desktop (§4.8 b).

What the box does instead:
1. **Before 28-10-2024 is a red stop**, as before question 3 was answered: the red strip, the named refusal
   with today's card advice kept, `clock.unusable` and an email (picture 6). The Veri*Factu module
   supplies it, since the date is its rule.
2. **Detect a clock behind the chain, with no internet.** When the box's clock is earlier than the
   last record's time by more than a minute, one of two clocks was wrong: this one, or the one that
   stamped the last record. A clock that ran ahead and was then put right looks exactly the same. The
   Veri*Factu module, which owns the chain, runs this check. It does not notice a clock that is ahead.
   The one-minute margin stays: it is D8's tolerance and the margin today's comparison with AEAT
   uses (`apps/server/src/time-health.ts:91`), and it lets the small backward steps a time sync
   makes pass without stopping a venue. Within it, a record may carry a time up to a minute earlier
   than the one before, as D8 already accepts a minute's error.
3. **Use devices only as witnesses.** Requests from a till would carry the device's own time (none
   does today). When at least two devices that spoke in the last five minutes agree with each other and
   the box differs from both by more than a minute, the box raises `clock.disagrees` for the manager.
   A device is never the source of a record's time, only evidence, as in D7's "every selling device is
   a witness" (owner, 2026-10-03; `2026-10-03-fiscal-chain-divergence-design.md:350-357`). A device's
   clock is only as good as its own source; a tablet on wifi alone has no mobile network to set it.
4. **AEAT**, as today, whenever something is sent; and `timedatectl` where the box image provides it.
5. **A clock behind the chain stops payments** — the owner's answer to question 3, reversing D8 and
   A364 for this case only (§4.8, §6). Any other wrong clock still follows D8 and A364: it keeps
   selling, the manager is warned, staff see nothing.
6. **The box image (B3)** should keep its clock synchronised, and keep time through a power cut; that
   belongs to the image and the hardware, not this design, and is one of B3's image constraints
   (`docs/backlog/box.md`, "Box image constraints (B3)"). Since revision 5 a box that loses its time
   stops taking payment until the clock is set, which raises the stakes of that constraint.

### 4.6 The disk

1. **Report a full disk as itself, and never commit half a transaction** (store). When a statement
   fails and the engine has already ended the transaction (`DatabaseSync.isTransaction` is false),
   the write queue and the adapter's nested-transaction undo rethrow the original error instead of
   issuing their own rollback, and refuse any further statement in that body. This removes all three
   measured behaviours of §2.6 for every write path at once, so no audit of catch blocks is needed.
   The engine's code 13 becomes the domain error `storage.disk_full` on every route and at start.
2. **One message for any write**, and the sale's own (§3). Any refused save shows "No se ha guardado:
   el equipo no tiene espacio en disco. Avisa al encargado." (EN "Not saved: the box is out of disk
   space. Tell a manager."), and the red strip "No se puede guardar nada".
3. **Refuse before the reader.** While the disk is red, both checks before the reader refuse —
   `till-sale.ts:1236-1237` for a sale and `beginBillPayment` (`bill-payments.ts:1078`) for a card
   payment on a bill — so no connected card is charged (§3). The same applies to a clock before
   28-10-2024.
4. **A free-space watch** every minute on the venue folder's disk (`apps/server/src/free-bytes.ts`
   already reads it): below 2 GiB free it raises `storage.space_low`, puts the amber strip on every
   device that sells, shows the Box status row amber and emails the managers (the owner's answer to
   question 1). Because sales can carry on past "0 free" on room the side file already holds (§2.6),
   this watch, not the first failed write, is what warns in time. The build picks how far above
   2 GiB free space must climb before the warning clears, so a disk hovering at the line does not
   email again and again.
5. **No reserve** (the owner's answer to question 1). The box keeps no spare space on its disk, so
   nothing softens a disk that does fill: the first save that fails turns every device red, every
   sale, order, kitchen send and clock-in is refused with the honest message of item 2, and a start
   on that disk goes as §4.7. Trading comes back only when someone frees space.
6. **Liberar** deletes only what can be made again: crash reports older than a week, rotated log
   files except the newest (at most about 40 MB), and backup staging leftovers from a run that was cut
   off (none after a normal run). That is usually a few MB to about 45 MB; more after a backup run
   that was cut off, whose leftovers are as large as the database: a plaintext dump of the whole
   database and its encrypted copy (`apps/server/src/backup-sweep.ts:149-170`, under
   `<state>/backup-staging`, `backup-supervisor.ts:247`), deleted only by the run itself
   (`backup-sweep.ts:215-218`). Liberar deletes that dump first. The button shows the figure before
   it runs. It does not fold the side file back, because on a full disk that can need space (§2.6). It
   never touches a backup the owner configured, the database's rows, or anything fiscal. The page
   names the real fillers with sizes where the box can measure them: the database, backups kept on
   this box, and "fuera de Waitron" for the rest of the disk, which on a box is mostly old Docker
   images. Deleting old images after an upgrade is a follow-up for `deploy/waitron.sh` (slice 10).

### 4.7 A full disk at start (picture 5)

Today a full disk stops the start before it can count itself, so the box restarts forever and the
page never appears (§2.6). The redesign:

1. **The very first step of every start checks free space**, before the failure count is written and
   before anything opens the database. Below 256 MiB free, it deletes the leftovers of §4.6 item 6
   that need no database (crash reports older than a week, rotated logs, backup staging). There is
   no reserve to release (§4.6 item 5). If the start then works, there is no page and nothing for the
   operator to do.
2. **If the count still cannot be written**, the start serves the recovery page at once, with the code
   `storage.disk_full`, instead of exiting and restarting forever. The page reads the free space as a
   new fact (with `freeBytes`; nothing on the page reads it today).
3. **The page's text**, fixed and chosen by the code as the house rule requires (CLAUDE.md §3): "El
   disco del equipo está lleno, así que Waitron no puede guardar nada." and "El equipo ha borrado lo
   que podía volver a crear, y no ha bastado. Pide a quien instaló este equipo que libere espacio
   (copias antiguas, versiones anteriores de Waitron) o ponga un disco mayor. Tus ventas no se
   tocan." Its one button stays "Reintentar un arranque normal".
   It never suggests wiping (`recovery-surface.ts:230-232`, owner 2026-09-10).
4. **A database that cannot be opened because the disk is full** is classified `storage.disk_full`
   rather than `provisioning.database_unreachable`, by checking free space when the open fails.

This needs a test on a real full disk image, not only a page limit: the measurements in §2.6 show
that where the disk fills decides what fails.

The first revision gave the page a "Liberar espacio y arrancar" button. It is gone: the start now does
that by itself, so the page needs no new action anyone on the network could press.

### 4.8 A clock behind the last sale: payments stop (question 3; pictures 8 and 9)

The owner's answer (2026-10-19): "STOP SELLING until the clock is fixed — every till red while the
box's clock reads earlier than its last recorded sale." Read here as: while the box's clock reads
more than a minute earlier (§4.5 item 2) than the latest record time in this database, **every
action that takes or gives back money, or would write a fiscal record, is refused**; everything else
carries on. The "latest record time" is the latest generation time (`fecha_hora_huso_gen_registro`,
`packages/fiscal-verifactu/src/schema/registros.ts:93`) of any fiscal record the database holds, in
any of its chains, whatever the record's kind — a sale or a credit (factura rectificativa) — since
every kind is stamped by the same clock (§2.5).

Two examples run through this section:
- **The clock is wrong.** On Sunday 18 October 2026 the last sale is recorded at 23:40. On Monday
  morning, after a power cut, the box starts with its clock at 14 March 2025 09:12.
- **The clock is right; the last sale's time was not.** On Sunday night the box's clock was a day
  ahead, so the last sale was stamped Monday 19 October 23:40. On Monday morning the clock is put
  right and reads Monday 09:12 — fourteen and a half hours before that stamp. Waiting for real time
  to pass it would stop the venue until 23:40 that night. What a manager may do here is question 4
  (§9); the owner chose (a), 2026-10-20 (part b).

**This is an internal check.** It compares the box's own clock with records in its own database,
with no network involved, so it does not break CLAUDE.md §5's "nothing EXTERNAL may block a sale".
What can depend on the outside is getting out of it: in the first example, until someone sets the
clock (part b).

#### a. What staff see on each till and handheld

- **The red strip** on every signed-in till and handheld, from the next equipment read (every 15
  seconds, §4.2): "No se puede cobrar: la hora del equipo es anterior a la última venta · Avisa al
  encargado" (EN "Payments stopped: the box's clock reads earlier than its last sale · Tell a
  manager"). Kitchen screens get no strip and keep working (§4.2).
- **A payment press is refused** with a new code, `clock.behind_chain`, carrying the two times
  (`clockAt`, `lastRecordAt`), before any card reader is asked (part e). The till shows:
  "Venta no registrada: la hora del equipo (14/03/2025 09:12) es anterior a la última venta
  (18/10/2026 23:40). El pedido sigue abierto; avisa al encargado. Si ya has cobrado en otro
  datáfono, no vuelvas a cobrar: regístralo cuando se arregle."
  (EN "Sale not recorded: the box's clock (14/03/2025 09:12) reads earlier than the last sale
  (18/10/2026 23:40). The order stays open; tell a manager. If you already charged on another card
  machine, don't charge again: record it once this is fixed.")
  The till shows these words rather than `sale.error`'s "inténtalo de nuevo", which would be wrong
  until the clock is fixed. Unlike the clock-before-28-10-2024 refusal, it does not tell staff to
  refund a card taken on another machine: this stop is expected to end, and the payment can then be
  recorded with "Otro datáfono" without charging again.
- **A card that was being charged when the stop began** (part e): "Cobrado con tarjeta, pero la venta
  no se ha registrado: la hora del equipo es anterior a la última venta. No vuelvas a cobrar. Cuando
  se arregle, pulsa Cobrar: se registra sin cobrar otra vez." (EN "Card charged, but the sale is not
  recorded: the box's clock reads earlier than its last sale. Don't charge again. Once it is fixed,
  press Pay: it is recorded without charging again.")
- **Any other refused action** — a refund, a guest leaving without paying, a credit, or an order
  edit that would complete a part-paid bill and so file its invoice (part e) — shows the same code
  with "No se puede registrar: la hora del equipo es anterior a la última venta. Avisa al
  encargado." (EN "Can't be recorded: the box's clock reads earlier than its last sale. Tell a
  manager.")
- **The payment buttons keep their look.** The box's refusal is the guard and the strip says why;
  a device learns of the stop only on its 15-second read, so buttons drawn quiet from that read
  would lag the box anyway (§6, revision 5 decision 9).
- **The code.** It names the domain concept, the clock, beside its siblings `clock.degraded` and
  `clock.jump_detected` (`packages/fiscal/src/errors.ts:9`, `:12`) and this design's `clock.unusable`
  and `clock.disagrees`. It is new: a search of `packages`, `apps` and `scripts` finds no
  `behind_chain` anywhere. It is one code for the refusal and the alert, as `storage.disk_full` is
  (§4.6). The Veri*Factu module throws it, so it is declared in that module's error registry.

#### b. Who can fix it, and how

What cannot set the clock, each with its source:
- **The box's own server.** On Docker Desktop, a container's default capability set leaves out the
  clock-setting capability (`cap_sys_time`; measured there, not on a box's Linux Docker), and `deploy/compose.yml` adds none (read: no `cap_add`, `privileged` or `user:`).
  Experiment 6 (§12) printed a default container's bounding set — the ceiling on what any process in
  it can ever hold — without that capability, and with it once `--cap-add SYS_TIME` was given. The
  image's own file capability (`setcap cap_net_bind_service`, `deploy/Dockerfile:168`) cannot add one
  the bounding set lacks.
- **AEAT.** Its time is compared, never used to set the clock (§4.5); at 2001 the box cannot even
  check AEAT's certificate (§2.5).
- **A device.** A device's clock never becomes a record's time (§4.5 item 3; D7's precedent).
- **The dashboard.** It gets no "set the box's clock" action. A clock that anyone holding a dashboard
  permission can set from a page is a way to give sales whatever date they choose; and it would need
  a helper on the host holding the clock-setting capability, which nothing has today. (This
  design's reasoning, not a legal reading.)
- **The recovery page.** It is served only when the box will not start (§2.8), and has no login
  (§4.1). A box that is trading never shows it.

What does fix it:
1. **When the clock is wrong (first example), the operating system's clock is set.**
   - **Connect the box to the internet.** Where the box's operating system keeps its clock in step
     with internet time, that corrects it, and the stop clears by itself on the next check (part d).
     Nothing in `deploy/` turns that on today (§2.5); whether a hand-built Debian box has it on by
     default was not checked. So the build adds it to `deploy/waitron.sh install`, which is already
     run with `sudo` on the host (`deploy/waitron.sh:3-9`, `as_root` at `:48`): it switches on the
     host's time synchronisation where the system provides it, and prints a line when it does not
     (§8, slice 10). B3's image makes it standing.
   - **With no internet, or a box that does not synchronise,** whoever installed the box sets its
     clock from the operating system: they have a terminal, the operator does not (default 2). The
     Box status page and the email say so plainly (picture 9).
   - **A box whose clock is wrong after every power cut** needs hardware that keeps time without
     power; that is added to B3's constraints (`docs/backlog/box.md`).
2. **When the clock is right and the last sale's time was not (second example)**, nothing done to
   the clock can clear the stop. **The owner chose (a) for question 4, 2026-10-20** (§9): a manager
   may restart payments, but only with fresh proof that the box's clock is right:
   - **Proof, gathered after the stop began.** Either AEAT's time within a minute of the box's, or at
     least two devices that reported in the last five minutes, each within a minute of the box's
     clock. Any evidence the other way — AEAT, or two devices agreeing with each other — and the
     restart is not offered. **With no proof, there is no restart**: the stop holds until the clock
     is fixed or real time passes the last record, as the owner's answer says.
   - **Where AEAT's time comes from during a stop.** Today the box compares its clock with AEAT's
     only when it sends records (`apps/server/src/time-health.ts:48-100`, fed from
     `packages/fiscal-verifactu/src/aeat-transport.ts:151-166`, which reads the submission reply's
     `TimestampPresentacion`). Records waiting in the outbox are still sent during a stop, since
     sending writes no record, so a box with unsent records gets a fresh comparison on the next
     send. With an empty outbox, the box would make a read-only query instead: the library's
     `consultar` (`@waitron/verifactu` 0.2.1, `dist/client.d.ts:18`), which writes nothing. **Its
     reply carries no current time**: AEAT's own schema, shipped with the library, gives the reply
     a header, the period, the paging flag, the result, the records and the next-page key, and no
     current time (`schemas/RespuestaConsultaLR.xsd:12-20`, `:56-72`; read); its only times belong to
     the records it lists. The time would have to come from the HTTP reply's `Date` header, and the
     library returns only the parsed body, so the box would capture the header in the `fetch`
     function it hands the library (`ClientOptions.fetch`, `dist/client.d.ts:3-15`). Measured 2026-10-20 with `curl -D -` and no certificate: AEAT's public QR page
     (`prewww2.aeat.es/…/ValidarQR`) answered `200` with a `date:` header matching this machine's
     clock to the second; the SOAP endpoint (`prewww1.aeat.es/…/VerifactuSOAP`) answered a `302`
     with no `date:` header. Whether a certificate-authenticated query's reply carries one was not
     measured (no certificate here; §12, experiment 7). The build measures it in pre-production first; if it does not,
     AEAT can give proof only when records are waiting, and devices are the only other proof.
     A box whose clock is far behind may also fail AEAT's certificate check, and then gets no AEAT
     proof at all — the right outcome, since its clock is probably the wrong one.
   - **How far back it can reach: 24 hours.** The ways a right clock ends up behind a record stamped
     ahead are a time-zone or summer-time slip (hours) or a date typed a day wrong; a day covers
     both. A gap larger than that is far more likely a clock that is wrong now — a clock reset by a
     power cut goes back months or years — and the owner's "until the clock is fixed" governs. The
     cap also bounds the one backward step a restart puts in the chain to a day.
   - **Who:** anyone holding `system.manage` — managers and admins
     (`packages/identity/src/permissions.ts:56-76`) — the permission the Box status page already
     needs (§4.3) and that the Veri*Factu module's dashboard already uses
     (`packages/fiscal-verifactu/src/dashboard/index.ts:15`). No new permission.
   - **Where:** the dashboard only, on the Box status page's Reloj row, button "Reanudar los cobros".
     Not on a till with a manager's PIN: the decision needs both times and the proof read with care.
   - **What it does:** records who restarted payments, when (on the box's clock), both times, the
     record it names and the proof shown; then lifts the stop while that record is still the latest
     and the box stays no further behind it than the restart accepted. The next records carry the
     box's clock, earlier than the named record's. When real time passes the named record, the
     check passes on its own and the restart has nothing left to do. If the clock steps further
     back, payments stop again.
   - **What it never changes:** no stored record, its time, its fingerprint or its link to the
     record before; the chain; the box's clock; the invoice numbers. The fiscal records stay
     append-only (CLAUDE.md §5).
   - **If the clock it accepted later proves wrong.** After a restart, the box keeps checking: the
     next comparison with AEAT (on the next send), and a clock that jumps forward by more than a
     minute beyond the time that passed (wall clock against the server process's own steady clock,
     so only while the server keeps running). Either raises a new recorded alert,
     `clock.behind_chain_disproved` (error): "Las ventas registradas entre {from} y {to} se fecharon
     con un reloj que resultó estar mal. Quedan como se registraron; consúltalo con tu asesor." (EN
     "Sales recorded between {from} and {to} were dated by a clock that proved wrong. They stay as
     recorded; ask your tax adviser.") Nothing is rewritten: the records, the chain and the clock
     stay as they are, and the alert is the whole of the response. Whether AEAT wants anything done
     about such records is a question for the asesor (§10).
   - **Where it is kept: a new append-only table** in the Veri*Factu module's own migration set,
     `clock_stop_restarts`, declared with `appendOnly()` in class `ledger`, like
     `registros_facturacion` (`packages/fiscal-verifactu/src/classification.ts:6`), so `applyMigrations` puts a
     `RAISE(ABORT)` trigger on updates and deletes (CLAUDE.md §3), travelling in both the module's
     migration descriptor and `packages/migrations/migrations.manifest.json`. One row per restart:
     the node, the person, the time on the box's clock, the box's reading and the named record's
     time, the record's id, and the proof. A unique index on the record's id means **a second
     restart of the same record is answered with the first** ("Ya reanudado por {person} a las
     {time}") rather than adding a row; if the clock has stepped further back since that restart,
     payments stay stopped and the page says to get the clock checked, since a clock that keeps
     moving back is not one to trust. **The stop reads only this table** — one lookup by the
     named record's id — never the bell's incidents, so marking an alert handled changes nothing.
     The `incidents` table was the revision-5 draft's choice; it is dropped, because its rows can be
     marked handled and the core's reads skip handled rows (`packages/core/src/incidents.ts:82`,
     `:109`), and nothing in the database stops a row being rewritten
     (`packages/db/src/schema/incidents.ts:14-16`). The table joins the build's one migration (§7).
   - **The dialog** (picture 9) states only what the box knows: "¿Reanudar los cobros?", then the
     box's clock, the last sale's time, and the proof ("Hacienda: coincide (comprobado 09:13)";
     "Dispositivos: 2 marcan 19/10/2026 09:14"); then "Si reanudas, las ventas siguientes
     llevarán la hora del equipo, anterior a la de la última venta. No se cambia ninguna venta
     registrada. Queda anotado que lo has hecho tú." Buttons "Cancelar" and "Reanudar los cobros".
     (EN "Restart payments?" … "If you restart, the next sales carry the box's clock, earlier than
     the last sale's. No recorded sale is changed. It is noted that you did it.")
   - **A question for the asesor, not the owner:** whether AEAT accepts a chain in which one record's
     generation time is earlier than the one before. Revision 4 already called this unknown (§9,
     question 3); a restart is the one path that writes such a record.

#### c. What the managers' alert and email say

- **The alert, `clock.behind_chain`**: error; area "Equipo" (Box) like the other new box alerts
  (§4.3); seen by holders of `system.manage`, the people who can act on it. It is an ongoing alert,
  worked out on each read like `fiscal.clock_drift` (`apps/server/src/time-health.ts:102`), not a
  recorded incident, so CLAUDE.md's area-claim rule for recorded incident codes does not bite; its
  English and Spanish go in `apps/dashboard/src/i18n/alert-messages.ts`, like every alert's:
  - "La hora del equipo ({clockAt}) es anterior a la última venta ({lastRecordAt}), así que no se
    puede cobrar. Los pedidos y la cocina siguen funcionando. Resuélvelo en Estado del equipo."
  - "The box's clock ({clockAt}) reads earlier than its last sale ({lastRecordAt}), so no payment can
    be taken. Orders and the kitchen still work. Sort it out on the Box status page."
  - Go-to: Estado del equipo.
- **`fiscal.clock_drift` is left out of the bell while this alert is open.** Its words end "you can
  continue selling" / "puedes seguir vendiendo" (`alert-messages.ts:28-31`), which would be false.
  The precedent is `backup.stream_behind`, left out when another alert already explains it
  (CLAUDE.md §5).
- **Two recorded alerts, in the same area as the stop.** `clock.behind_chain_restarted` (warning) when
  a manager restarts payments, and `clock.behind_chain_disproved` (error, part b). Core claims the
  `clock.` prefix for the fiscal area (`packages/db/src/alerts.ts:4-9`), so the Veri*Factu module
  claims the longer prefix `clock.behind_chain` for "Equipo" with `system.manage`; the bell picks the
  longest matching claim (`apps/server/src/alerts.ts:37-46`), so all three of the stop's alerts show
  in one place to the same people. Each needs English and Spanish wording, and the file that
  records them joins the guard's hand-kept list (`scripts/alert-codes.test.ts`, weaker than its
  name: it reads text in listed files). Both codes are new.
  - Restarted: "{person} reanudó los cobros con la hora del equipo ({clockAt}), anterior a la última
    venta ({lastRecordAt}). Prueba: {proof}." / "{person} restarted payments on the box's clock
    ({clockAt}), earlier than the last sale ({lastRecordAt}). Proof: {proof}."
  - The bell is a notice, not the record: the table is (part b).
- **The email**, to everyone with `system.manage` and an email address, once per stop (§4.3):
  - Subject: "No se puede cobrar en {venue}: la hora del equipo es anterior a la última venta" /
    "Payments stopped at {venue}: the box's clock reads earlier than its last sale".
  - Body: "La hora del equipo ({clockAt}) es anterior a la última venta registrada ({lastRecordAt}).
    Desde entonces ningún dispositivo puede cobrar. Se pueden seguir tomando pedidos y enviándolos a
    cocina. Qué hacer: • Si la hora del equipo está mal (lo normal tras un corte de luz): conecta el
    equipo a internet para que la corrija, o llama a quien lo instaló. • Si crees que la hora del
    equipo es correcta: mira Estado del equipo, que dirá si se pueden reanudar los cobros. [Abrir
    Estado del equipo]"
  - EN: "The box's clock ({clockAt}) reads earlier than its last recorded sale ({lastRecordAt}). Since
    then no device can take payment. Orders can still be taken and sent to the kitchen. What to do:
    • If the box's clock is wrong (usual after a power cut): connect the box to the internet so it
    corrects itself, or call whoever installed it. • If you think the box's clock is right: look at
    the Box status page, which says whether payments can be restarted. [Open the Box status page]"
  - With no internet the email cannot leave the box. The one-minute watch (part d) tries again each
    minute until the stop's one email is accepted by the mail server. The bell, served on the
    venue's own network, is what a manager on site sees first.

#### d. How the box decides the clock is fixed

- **What it compares.** The box's clock reading — the same one that would stamp the next record
  (`systemClock`, `apps/server/src/till-backend.ts:14`) — with the latest record time in this
  database: the largest `fecha_hora_huso_gen_registro` in `registros_facturacion`, across every
  chain the database holds. More than a minute earlier is stopped. The build adds an index on that
  column (slice 8), so the read is one index lookup.
- **Why every chain, not only the one this box is writing.** A restored box, or one whose filing
  identity was registered again, starts a new chain with no records: activating the new filing
  identity empties this node's chain (`packages/fiscal-verifactu/src/allocation.ts:399-405`), while
  the database still holds the old chain's sales (`apps/server/src/restore-fiscal-e2e.test.ts:410-413`
  reads the old record after a restore). Restored or new hardware
  is one of the likeliest times for a clock to be behind, and the owner's words were "its last
  recorded sale", not "this chain's".
- **A database with no fiscal records at all** — a new box before its first sale — has nothing to
  compare, so this check never stops it. The clock-before-28-10-2024 stop (§4.5 item 1) still
  applies, and it is the one that catches a new box whose clock has reset to its factory date.
- **When it checks.** On every notice read (each signed-in device every 15 seconds, §4.2); in the
  named check at the top of every money route, before any branch and so before any card reader is
  asked on every path (part e); inside the chain's append, the one place
  every record kind passes through (`packages/fiscal-verifactu/src/chain.ts:178-180`), so no route can
  write a record past the stop, whoever calls it; and on a one-minute watch that raises the alert
  and sends the email. Every input is on the box, so it works with no internet; it survives a
  restart because the records are stored, not remembered.
- **What clears it.** Either (1) the clock no longer reads more than a minute earlier than the latest
  record time — because it was set right, or because real time caught up with a record stamped
  ahead; or (2) a restart names the record that holds the latest time and the box is no further
  behind it than the restart accepted (part b; question 4). The strip goes on each device's next
  read, the alert on the bell's next read.
- **What does not clear it.** Devices and AEAT are proof for a restart, never a reason to lift the
  stop by themselves.
- **The 28-10-2024 rule is checked first.** While it holds, its own notice shows and no restart is
  offered, because the tax rules refuse the record whatever a manager says.

#### e. What happens to orders already open

The rule, once more: **every action that takes or gives back money, or would write a fiscal record,
is refused; everything else carries on.** Two mechanisms carry it:

- **One named check, `refuseWhileClockBehind`, at the top of every route that takes or gives back
  money**, before any card reader is asked. It is named in the house's `refuse…` style
  (`refusePaidLines`, `refuseBillHoldingMoney`, `apps/server/src/bill-payments.ts:407`, `:457`) and
  reaches the Veri*Factu module through the fiscal seat (§5). The routes, from a search of the
  server's `app.post`/`put` routes for payments, refunds, collections, settlements and sales (read):
  - `POST /api/sales` (`apps/server/src/till-api.ts:1689`) — a sale paid in cash or by a card typed
    on another machine;
  - `POST /api/pay` (`till-api.ts:1731`) → `payWorkingOrderIntegrated` (`till-sale.ts:157`) →
    `payIntegrated` (`apps/server/src/till-sale.ts:1105`): the check goes at the top of
    `payIntegrated`, **before any branch**. Placed any lower it misses a path: the branch for an
    order whose invoice was already filed returns at `:1204` and asks the reader at `:1325` without
    meeting the check at `:1236-1237`; and a counter card sale with no saved order before it skips
    the whole `if (locked !== undefined)` block (`:1151`), so a check placed inside it is never
    met. At the top it also refuses the recovery branches (`:1163-1172`), which file a card already
    captured; that loses nothing, because their record would be refused by the chain's check
    anyway, and once the clock is fixed Pay files them without charging again. The same
    `payIntegrated` serves the dashboard's stuck-payment resolve (`payments-api.ts:1080`) and the
    background card-recovery pass (`pending-card-recovery.ts:72`), both through
    `payWorkingOrderIntegratedOrchestration` (`till-sale.ts:1076`); that pass repeats
    (`runPendingCardLoop`, `pending-card-recovery.ts:12-15`), so it files those payments on its
    first pass after the clock is fixed;
  - `POST /api/working-orders/:id/collect` (`till-api.ts:2595`) → `collectOrder`
    (`till-sale.ts:148`, documented at `:2035`: "files NO second fiscal record");
  - `POST /api/working-orders/:id/payments` (`apps/server/src/bill-payments-api.ts:227`) →
    `beginBillPayment` (`bill-payments.ts:1037`, ahead of its own check at `:1078`);
  - `POST /api/working-orders/:id/payments/:paymentId/refunds` (`bill-payments-api.ts:281`);
  - `POST /api/transactions/:saleId/refunds` and its retry (`apps/server/src/tender-refund-api.ts:154`,
    `:240`) → `refundSettledTender` (`apps/server/src/tender-refunds.ts:136`), which writes no
    fiscal record;
  - `POST /api/parties/:id/unpaid-departure` (`apps/server/src/unpaid-departure-api.ts:52`);
  - the dashboard's payment resolutions (`apps/server/src/payments-api.ts`): stuck payments
    (`:1014`), bill payments (`:1164`, `:1231`), held payments (`:1309`), bill refunds (`:1378`,
    `:1401`) and tender refunds (`:1453`, `:1475`). They record what happened to money already
    moved; refusing them only delays the bookkeeping until the clock is fixed, and keeps every
    money date on the right clock.

  Two ways money moves without a till route, each with its decision:
  - **The Stripe webhook keeps running.** `POST /webhooks/stripe` (`apps/server/src/webhook.ts:122`)
    records a hosted card payment the provider has already taken and writes no sale
    (`webhook.ts:56-59`): it takes no new money, and refusing it would leave the box's record behind
    money already taken.
  - **The tender-refund recovery loop is paused during the stop.** It sends a refund whose first
    send never happened (`apps/server/src/tender-refund-recovery.ts:73` → `resumeTenderRefund`), so
    it gives money back through no route at all; its record would be dated by the wrong clock. It
    resumes on its next pass once the clock is fixed.
- **The chain's own check** inside the append, which catches only paths that write a record — the
  backstop for any route the list above misses, and the guard for order edits (below). It does not
  catch a path that moves money without writing a record; that is what the named check is for.

| Action | During the stop | Why |
| --- | --- | --- |
| Open a table, add or change dishes, move or join tables | Works, unless the edit completes a part-paid bill (below) | Writes no fiscal record |
| Send to the kitchen; kitchen tickets and screens | Works, with the same exception; times print on the box's clock | Placing an order writes no record: `placeOrder` (`apps/server/src/working-order.ts:6400-6444`) never reaches `recordSale` |
| **An order edit that would complete a part-paid bill**, so file its invoice | **Refused**, `clock.behind_chain`, the whole edit including any kitchen send in it | Below |
| Print the bill a guest checks before paying | Works; its time is the box's clock | It is not an invoice and calls none of the record writers |
| Take payment of any kind — cash, the connected reader, "Otro datáfono", a part payment on a bill | Refused, before any reader is asked | The named check |
| Collect an order whose invoice was already filed | Refused | It writes no new record, but the payment is dated by the same clock and would land in the wrong business day |
| Give money back: a refund on a sale or on a bill | Refused | The named check. A guest charged twice waits for the refund until the clock is fixed, or is refunded on the card machine itself and a manager records it afterwards |
| Parts of a bill already paid | Stay paid; the bill stays open | Nothing is undone |
| A card already being charged when the stop begins | The charge completes; the record is refused; the order stays locked against a second charge | On a sale, the order stays locked (`order.payment_in_flight`, `till-sale.ts:1207-1215`) and pressing Pay once fixed files the sale without charging again: a captured payment with no sale takes the recovery path (`till-sale.ts:1163-1172`), which the named check leaves open, and its record passes the chain's check once the clock is fixed. On a bill, the box's pending-payment pass retries the completion each time and files it by itself once fixed, raising `payment.bill_settle_failed` meanwhile (`apps/server/src/bill-payments-loop.ts:153-195`, `:199-220`) |
| A guest leaves without paying | Refused | It files an invoice with no payment (`issueUnpaidInvoice`, `working-order.ts:6484`, called at `apps/server/src/unpaid-departure.ts:128`) |
| Credit an invoice | Refused | It writes a record (`recordCorrection`, `apps/server/src/cancel-credit.ts:64`) |
| Clock in, clock out | Works; the event time is the box's clock | Not a sale, and the working-time record is a legal duty of its own. Its recorded time already cannot run backwards (clamped, `packages/workforce/src/chain.ts:119-122`); a supervisor corrects the event times afterwards with `workforce.correct` (`packages/workforce/src/permissions.ts:2`) |
| Reprint a receipt, open the drawer by hand | As today | Writes no record and moves no money |

**Order edits that would file the invoice.** On a bill that already holds payments, several edits
file its invoice in the same transaction the moment the bill becomes fully paid, through
`issueIfFullyPaid` (`apps/server/src/bill-payments.ts:795`). Nine routes do it (read: every caller
of `issueIfFullyPaid` under `apps/server/src`):
- `PUT /api/parties/:id/drafts` — saving a draft (`apps/server/src/till-api.ts:3452`, call at `:3477`);
- `POST /api/parties/:id/drafts/:did/split` (`:3490`, call at `:3512`);
- `POST /api/parties/:id/drafts/:did/submit` — the send to the kitchen (`:3616`, call at `:3635`);
- `PUT /api/working-orders/:id/lines/:lineNo` — a line edit (`:3845`, call at `:3871`);
- `POST /api/bills/:id/split` (`:3963`, call at `:3979`);
- `PUT /api/working-orders/:id` — a held order's edit (`:1871`, through `updateHeldOrder`,
  `apps/server/src/working-order.ts:6288`);
- `POST /api/parties/:id/lines/:lineId/cancel-item` (`apps/server/src/line-cancel-api.ts:151`, call at
  `:218`);
- `POST /api/parties/:id/drafts/:did/discard` (`apps/server/src/adjustments-api.ts:129`, call at
  `:179`);
- `POST /api/working-orders/:id/adjustments` — adjustments and discounts (`adjustments-api.ts:196`,
  call at `:225`).

The review that asked for this list named seven; the search found these nine. During the stop,
**such an edit is refused as a whole** with `clock.behind_chain`, by the chain's own check, kitchen
send included; the same edit on a bill with no payments works as normal. The alternative — letting
the edit through and filing the invoice later — would change *when* an invoice is issued, which
the tax rules and the asesor decide, not this design, and nothing today files a fully paid bill's
invoice later (the pending-payment pass covers only card payments still pending). So the
conservative default refuses, and staff see "No se puede registrar…" (part a).

Why this default as a whole: it is the narrowest reading of "stop selling" that still stops every
money movement and every record, so no money changes hands on a clock the owner has said not to
trust, and the fiscal chain never runs backwards without a manager's name and proof on it. Tables
mid-meal keep being served and the kitchen keeps cooking what was ordered; the stop costs the venue
its takings for its duration, not its service.

---

## 5. The module seat this needs, and the field it does not

**A seat is needed.** The notices and the Box status rows are not all the core's to give:

- The unsent count, **Reintentar ahora**, the clock-behind-the-chain check with its stop, refusal and
  a manager's restart (§4.8), and the 28-10-2024 rule all belong to the Veri*Factu module. The
  two checks before a card reader reach the stop through the fiscal seat, as they already pass the
  backend to `selectOrderInvoice` (`apps/server/src/till-sale.ts:1236-1237`). A generic route
  cannot name its outbox (`envios`) or its chain; CLAUDE.md §3 keeps the composition list the only place that names every module, and generic code
  reaches the regime through its seats.
- The bell already works this way: the Veri*Factu module supplies its submission alerts through the
  `alerts` seat (`packages/module/src/module.ts:1511`; `packages/fiscal-verifactu/src/alerts.ts:9`).

So the build adds a seat (a cross-package change to `packages/module`, `packages/composition` and the
server). Two shapes, the plan to choose:
- **an audience on the alerts seat**: an `AlertSource` may say that some of its alerts are also shown
  to staff, with a staff code the till words in its own language files; or
- **a `staffNotices` seat** beside `alerts`, returning notices (code, tone, parameters) on each ask,
  plus a row for the Box status page.

The second keeps the manager's sentences and the staff's one-liners apart, and is this design's
preference.

**The field the old design asked for is still not needed.** The deleted node-containers design
(`git show ceecfdc1e^:docs/superpowers/specs/2026-09-08-node-containers-design.md`, §9.1) handed this
item "a degraded-but-trading mode and the module-contract field it needs": a fact each module
declares, whether a till can sell without it, so a "safe mode" could switch off the modules a till
can do without. Revision 1 gave a false reason for leaving it out — that a module has no runtime
hooks. It does: seats are used while the box runs, for example the alert sources on every bell read
(`apps/server/src/alerts.ts:120`) and the fiscal seat on every sale (its backend is made at start,
`apps/server/src/boot.ts:1526`, and `recordSale` calls it, `packages/core/src/record-sale.ts:368`),
and the alert registry already isolates a failing module's check —
it reads each source in its own savepoint and turns a failure into `alert.source_unavailable`
(`apps/server/src/alerts.ts:120-144`). The corrected reasons:

- **Isolation already happens per check, not per module.** A module's alert check that fails does not
  take the bell down, and a printer, reader or outbox that fails does not take the sale down. None of
  that needs a per-module flag.
- **Whether a sale can go ahead is decided by concrete conditions**, a full disk, a clock the
  fiscal rules refuse, and a clock that reads earlier than the last recorded sale (§3, §4.8), each
  answered by the part that knows: the core for the disk, the fiscal seat for the clock. A per-module "can sell without me" flag would not tell the box either of those.
- **A module that fails at start fails the whole start**, deliberately (`boot.ts:767-770`: "A host that
  boots half-configured and retries in the background is a host whose operator believes it is
  working."), and modules are compiled in (`packages/composition/src/modules.ts:106`), so a bad module
  arrives with a bad image and the fix is the image.
- **The tiers still do not answer it**: `identity`, `credentials` and `payments` are `toggleable`
  (`modules.ts:153-155`, `:198-200`, `:226-228`).

If modules ever become installable on a running box, "start without the module that just failed"
becomes worth building, and that is when the field earns its place (§10).

---

## 6. Defaults

Each is a default, not a question; the owner may overrule any.

1. **Keep selling whenever the record can be written** — except while the box's clock reads earlier
   than its last recorded sale, which stops payments by the owner's choice (§4.8). "Data loss is the
   accepted price … being stuck offline is not" (memory `cold-recovery-no-hot-failover-posture`,
   owner 2026-08-29); "Nothing EXTERNAL may block a sale" (CLAUDE.md §5).
2. **The operator has no terminal; every box-side problem is actionable on a page.** Owner
   2026-09-10 and 2026-09-26 (memory `box-operator-has-no-terminal`; `conventions-ui.md:981-1012`).
3. **The recovery page never suggests wiping anything** (`recovery-surface.ts:230-232`, owner
   2026-09-10).
4. **Staff go straight to work**: notices are a strip, never a dialog or a step (owner 2026-10-12,
   memory `till-staff-straight-to-work`).
5. **Product text as short as the meaning allows** (owner 2026-10-09, memory `concise-product-text`).
6. **Every device that sells gets the strip**, tills and handhelds alike: "any paired device can do
   everything" (owner 2026-10-03, memory `any-device-does-everything`).
7. **Email the managers for the red conditions**, as for the AEAT certificate (owner 2026-10-18,
   A795 Q3 "A", recorded in `~/waitron-campaign-shared/watcher-handoff.md`, 13:06 entry). The 2 GB
   disk warning is emailed too, by the owner's answer to question 1.
8. **The unsent count on screen**, from the house's reading of Orden HAC/1177/2024 art. 16.4
   (`docs/compliance/verifactu-findings.md:345-360`).
9. **The typed card is "Otro datáfono"**, an explicit choice (owner, A796 Revision 4, §8 default 3).
10. **A running box's operator actions live in the dashboard, not on the LAN recovery page** (§4.1).
    The recovery page has no login; the dashboard does, and a box that is trading has one.
11. **The recovery page gains no new action.** Freeing space happens at the start by itself (§4.7),
    so nothing new can be pressed by anyone on the venue's network. Who may press a reset there is a
    separate, open backlog question ("Resetting a box without a terminal": "who may press it (the
    owner only?)").
12. **A clock that is wrong but usable warns the manager and refuses nothing** — D8 (owner,
    2026-10-03) and A364 (owner, 2026-10-07: "Measured drift remains an administrator alert; the till
    does not poll for it"), both in `2026-10-03-fiscal-chain-divergence-design.md:364-371`, `:753-756`
    — **except a clock that reads earlier than the last recorded sale**, which stops payments and
    shows staff a red strip (the reversal below).
13. **The box never corrects its own time** (§4.5).
14. **Devices are witnesses, never a source of time** — the precedent of D7 (owner, 2026-10-03).
15. **The Box status page sits under Ajustes beside Diagnóstico**, its own page (§4.3).
16. **The start's clean-up threshold**: the start deletes its leftovers below 256 MiB free (§4.7). A
    guess for a box with a disk of tens of gigabytes; the build may change it with a measurement.
    The 2 GB warning is the owner's (question 1), not a default.

### The reversal of D8 and A364, for one case (owner, 2026-10-19)

The owner's answer to question 3, verbatim: "(b) STOP SELLING until the clock is fixed — every till
red while the box's clock reads earlier than its last recorded sale. This REVERSES the earlier clock
rule for this case only (a clock behind the last sale); record the reversal in the design's
decisions section and in any CLAUDE.md / backlog text that states the old rule."

- **D8** ("A clock out of tolerance warns, and never refuses a sale", owner 2026-10-03) no longer
  holds for a clock that reads more than a minute earlier than the last recorded sale: that clock
  stops every action that takes or gives back money, or would write a fiscal record (§4.8).
- **A364** ("Measured drift remains an administrator alert; the till does not poll for it", owner
  2026-10-07) no longer holds for the same case: staff see a red strip, on the equipment read every
  device already makes.
- **Both still hold for every other wrong clock** — ahead, or behind real time but not behind the
  last sale — which sells, warns the manager, and shows staff nothing.
- Where the old rules are stated as current, a dated pointer to this revision is added:
  `2026-10-03-fiscal-chain-divergence-design.md` (D8, and the A364 note under P7), the plans
  `2026-10-03-fiscal-chain-divergence.md` and `2026-10-04-fiscal-prevention-and-offline-recovery.md`,
  the design `2026-10-04-fiscal-prevention-and-offline-recovery-design.md` (its D8 row), and
  `docs/compliance/verifactu-findings.md` ("Do not block invoicing on clock drift"). CLAUDE.md does
  not state either rule (searched).

### Decisions revision 5 makes

The owner's answer did not settle these; each is a default the owner may override. Decision 7 was
asked as question 4 (§9), because it departs from "until the clock is fixed"; the owner chose (a),
2026-10-20.

1. **"Last recorded sale" means the latest record time in this database**, across every chain it
   holds, of any kind (§4.8 d) — so a restored box, whose new chain starts empty, still compares with
   the old chain's sales. A database with no records is never stopped by this check; the
   before-28-10-2024 stop still applies to it.
2. **The one-minute margin stays** (§4.5 item 2): D8's tolerance and the AEAT comparison's margin; it
   ignores the small backward steps a time sync makes.
3. **What stops: every action that takes or gives back money, or would write a fiscal record;
   everything else carries on** (§4.8 e) — orders, the kitchen, printing a bill and clocking in — so
   tables mid-meal keep being served.
4. **One named check, `refuseWhileClockBehind`, at the top of every money route**, before any reader
   is asked, with the chain's own check as the backstop for paths that write a record (§4.8 e).
5. **Collecting an invoice already filed, refunds, and the dashboard's payment resolutions are
   refused too**, though they write no new record: their money would be dated by the wrong clock.
   A guest charged twice waits, or is refunded on the card machine and recorded afterwards. The
   tender-refund recovery loop is paused for the same reason; the Stripe webhook keeps recording
   hosted payments already taken, since it takes no new money.
6. **An order edit that would complete a part-paid bill, and so file its invoice, is refused as a
   whole**, kitchen send included (§4.8 e); filing it later would change when an invoice is issued,
   which is the tax rules' and the asesor's ground.
7. **A manager may restart payments only with fresh proof the clock is right** — AEAT's time, or two
   devices, within a minute of the box, gathered after the stop began — and only when the box is no
   more than 24 hours behind. No proof, no restart. Holders of `system.manage`, on the dashboard only.
   **The owner chose (a) for question 4, 2026-10-20.**
8. **A card charged before the stop is recorded after it, not refunded**: the record is refused, the
   order stays locked, and Pay files it without a second charge once fixed; on a bill the box files
   it by itself. Likewise staff are told to record a card taken on another machine later.
9. **Payment buttons keep their look**; the box's refusal is the guard and the strip says why.
10. **No "set the clock" action anywhere in Waitron**: a clock a page can set is a way to date sales
    at will. Fixing a wrong clock means the internet (once `waitron.sh install` turns on the host's
    time synchronisation) or whoever installed the box.
11. **Restarts are kept in a new append-only `ledger` table**, one row per restarted record, which
    the stop reads directly — part of the one migration in the Veri*Factu module's set (§7).
12. **The stop's alert is an error in the "Equipo" area for `system.manage`, and the restart and
    "disproved" alerts show beside it**; `fiscal.clock_drift`, whose words say selling continues, is
    left out of the bell while the stop is on.
13. **A restart that later proves wrong raises an alert and changes nothing else** (§4.8 b).
14. **Clock-ins carry on**, with the box's (wrong) time, corrected afterwards by a supervisor: the
    working-time record is a legal duty of its own, and refusing it would breach that duty.
15. **The email is retried each minute until sent once**, so a box with no internet sends it when the
    connection returns.
16. **Only the Veri*Factu module stops**: the check reads its records. A box whose fiscal seat writes
    no records has nothing to compare and is never stopped.

---

## 7. Storage and migration

**One migration, in the Veri*Factu module's own set.** Everything else is either worked out when
asked or held outside the database:

- Notices, the Box status rows and the new alerts are computed on each read, like today's ongoing
  alerts (`packages/module/src/alerts.ts:6-7`).
- "Once per episode" for emails is held in memory (§4.3). Making it survive a restart would need a
  table like the certificate reminders' (`packages/fiscal-verifactu/src/schema/certificate-reminders.ts`),
  and so a migration; this design does not ask for that.
- The clock checks keep their results in memory, like AEAT's comparison today
  (`time-health.ts:48-58`); the stop reads the latest record time, which is already stored, so it
  survives a restart without a new table.
- **The migration** (§4.8 b, d), built in slice 8: an index on
  `registros_facturacion.fecha_hora_huso_gen_registro`, and a new
  table `clock_stop_restarts`, declared with `appendOnly()` in class `ledger` in the Veri*Factu
  module's classification, so `applyMigrations` refuses its updates and deletes; it
  travels in both the module's migration descriptor and `packages/migrations/migrations.manifest.json`
  (CLAUDE.md §3), with a unique index on the restarted record's id. The index makes the latest
  record time one index lookup.

---

## 8. Build slices

Smallest first; each names the risk triggers it touches (CLAUDE.md's review-weight rule).

1. **The store reports a full disk as itself and stops after an ended transaction**
   (`packages/store/src/write-queue.ts`, the adapter's nested undo, `boot-failure.ts`, the error
   boundary). Tests on a database at its page limit through the real write queue, at both failure
   points (inside the body and at commit) and inside a nested transaction, plus the refusal controls
   of §12. Updates CLAUDE.md §3's refusal rule to name the exceptions. _Risk: concurrency,
   cross-package contract, fiscal invariants (the sale path)._
2. **A full disk at start** (§4.7): free space first, serve the page when the count cannot be
   written, classify the open failure. Tested on a real full disk image. _Risk: auth (an
   unauthenticated page), concurrency (the start's ordering)._
3. **The till names the red refusals and refuses before the reader** (`storage.disk_full`;
   `fiscal.record_invalid` caused by the minimum date; both checks before the reader,
   `till-sale.ts:1236-1237` and `beginBillPayment`, `bill-payments.ts:1078`). _Risk: fiscal
   invariants (the settle handlers), cross-package contract (a refusal's parameters)._
4. **The module seat** of §5. _Risk: cross-package contract._
5. **Free-space watch and the `storage.*` alerts.** _Risk: none listed._
6. **The strip**: notices on the equipment read and the strip in the till. _Risk: cross-package
   contract (till ↔ box), fiscal invariants (reads the outbox through the seat)._
7. **Box status page**, **Reintentar ahora** and **Liberar**. _Risk: auth (`system.manage`), fiscal
   invariants (nudging the drain)._
8. **The clock-behind stop** (§4.8 a, d, e): `refuseWhileClockBehind` at the top of every money route
   listed in §4.8 e, the chain check inside the append, the comparison with the latest record time
   across every chain, the build's one migration (§7: the index and the restarts table), the `clock.behind_chain` refusal and its till wording, the red notice, the
   alert and email, and leaving `fiscal.clock_drift` out while it is open. Tests, each with the
   clock a day behind the latest record:
   - a card payment on `POST /api/pay` for an order whose invoice was already filed, refused with
     `clock.behind_chain` **and the provider's `collect` never called** (the case that would reach
     the reader at `till-sale.ts:1325` without the named check);
   - a counter card sale on `POST /api/pay` with no saved order before it, refused with
     `clock.behind_chain` **and the provider's `collect` never called** (the path that skips the
     `if (locked !== undefined)` block);
   - the tender-refund recovery loop sending no refund during the stop, and the Stripe webhook
     still recording a hosted payment;
   - a cash collection of a filed order on `POST /api/working-orders/:id/collect`, refused, with no
     settlement written;
   - a refund on `POST /api/transactions/:saleId/refunds`, refused, with the provider's refund never
     called;
   - a sale on `/api/sales`, a bill payment, an unpaid departure and a credit, each refused;
   - a draft submit that would complete a part-paid bill, refused as a whole, its kitchen send
     included, while the same submit on a bill with no payments goes through;
   - a restored database, whose node's chain is empty and whose older chain holds the latest
     record, stopped; a database with no records not stopped;
   - a card captured before the stop, recorded without a second charge once the clock moves on;
   - orders, kitchen sends and clock-ins accepted; and a control a minute inside the margin that
     sells.
   _Risk: fiscal invariants (every path that writes a record or moves money), cross-package contract
   (the seat and a refusal's parameters), migrations (an index and a new append-only
   table)._
9. **Devices report their clock, `clock.disagrees`, the minimum-date checks, and the restart** (§4.5 item 3, §4.8 b): the device reading; AEAT's time from a read-only
   query's `Date` header, measured in pre-production first; the restart route behind
   `system.manage`, offered only with fresh proof and within 24 hours, writing to the
   `clock_stop_restarts` table slice 8's migration created; the `clock.behind_chain_restarted` and `clock.behind_chain_disproved` alerts; and the
   Reloj row and dialog on the Box status page. Tests: no proof, no restart; contrary proof, no
   restart; a 25-hour gap, no restart; a second restart of the same record answered with the first;
   marking the bell's alert handled leaves payments running. _Risk: fiscal invariants (lifts the
   stop), auth (`system.manage`)._
10. **Emails for the red conditions and the 2 GB disk warning**, `reader.offline`, the printer notice
    (question 2), and in `deploy/waitron.sh`: deleting old Docker images after an upgrade, and
    switching on the host's time synchronisation at install where the system provides it, printing a
    line when it does not (§4.8 b). _Risk: none listed._

---

## 9. Questions for the owner

Four, one at a time. Each has a recommendation; the pictures are in the mock-ups folder. All four are
answered; question 4 was raised by the review round of revision 5.

### Question 1 of 3 — When the disk fills, should the box free its reserve by itself?

Owner's answer (2026-10-19): (c) no spare, just warn. The box keeps no reserved 1 GB on its disk.
When 2 GB are left, every till and handheld shows the amber strip "Queda poco espacio en el equipo ·
Avisa al encargado", the Box status page and the bell show the warning, and the managers get an
email (§4.2, §4.3, §4.6; pictures 2, 3 and 4). A disk that fills anyway stops every save at once,
with the red strip and the honest refusal (picture 1), and a start on a full disk goes as §4.7
(picture 5).

### Question 2 of 3 — When a printer stops printing, who is told, and how soon?

Owner's answer (2026-10-19): (a) every device, at two minutes. From two minutes every till and
handheld shows the amber strip "Impresora Cocina no imprime · desde 21:16"; a receipt printer only on
the devices whose receipts go to it; the sending device's own table banner stays as today (§4.2,
§4.4; picture 7).

_Example._ 21:14, the Cocina printer's cable is knocked out. Ana sends Mesa 4's starters at 21:16. At
21:18, two minutes on, Ana's table screen shows "Un ticket de cocina no se ha impreso: Cocina". Marc, at
the same moment, sees nothing and sends Mesa 7's mains to the same dead printer (picture 7). "Stopped
printing" means what it means today: one of the printer's tickets has waited two minutes.

- **(a) Recommended: every device, at two minutes.** From 21:18 every till and handheld shows the
  amber strip "Impresora Cocina no imprime · desde 21:16". A receipt printer shows only on the devices
  whose receipts go to it. Ana's table banner stays.
- (b) Only the device whose ticket did not print, as today.
- (c) Every device, but only once a ticket has waited five minutes, to ignore short hiccups, at the
  cost of three more minutes of orders going to the dead printer.

Why (a): the person who can fix the cable is rarely the one whose ticket failed, and every waiter
sending food needs to know to walk to the kitchen. Two minutes is already the wait today's banner and
the manager's alert use.

### Question 3 of 3 — When the box's clock is behind its last sale, what should it do?

Owner's answer (2026-10-19): (b) stop selling until the clock is fixed — every till red while the
box's clock reads earlier than its last recorded sale, reversing the earlier clock rule for this case
only. The owner asked the design to say what staff see, who can fix it and how, what the managers'
alert and email say, how the box decides the clock is fixed, and what happens to orders already open:
§4.8 a to e; the reversal is recorded in §6; pictures 8 and 9.

The example below is kept as it was asked. Its days do not match the date: 18 October 2026 is a
Sunday, so "Saturday morning" after "last night's" sale cannot both hold. §4.8 and the pictures use
Sunday night and Monday morning.

_Example._ After a power cut on Saturday morning the box's clock comes back reading 14 March 2025, a
year and a half behind. Last night's last sale was recorded at 23:40 on 18 October 2026, so one of
the two times is wrong; usually it is the clock, but a clock that ran ahead yesterday and has since
been put right looks the same. There is no internet to check it against. Today it sells as if nothing
happened, stamping every sale 14 March 2025, and no one is told.

- (a) **Keep selling, and stamp each sale with the later of the clock and the last sale's time**, so
  times never run backwards (every sale would carry 23:40 on 18 October until the clock is fixed); the
  managers get an alert and an email. If it was yesterday's time that was wrong — a clock that ran
  ahead — every sale would instead carry a time in the future until real time catches up. This
  changes how the fiscal record's time is chosen, so you would land it yourself, and it needs the
  asesor's view first.
- (b) **Stop sales until the clock is fixed** (every till red). This reverses your earlier decision
  that a wrong clock warns and never stops a sale.
- (c) **Recommended: keep selling with the clock's own time, and tell the managers** by alert and
  email at once. Staff see nothing, as you decided for wrong clocks before. This is today's behaviour
  plus the box noticing.

Why (c): it follows your two earlier clock decisions, a wrong clock warns and never stops a sale, and
staff are not shown clock notices. (a) is also wrong — every sale gets the same frozen time — and
changes the fiscal record. Whether records whose times run backwards are acceptable to AEAT is not
known; it becomes a question for the asesor, and if the answer is no, (a) comes back. A clock before
28 October 2024 still stops sales whatever you choose, because the tax rules refuse those dates.


### Question 4 of 4 — When the box's clock is right but the last sale's time was ahead, may a manager restart payments?

Owner's answer (2026-10-20): (a) — a manager may restart payments only with fresh proof that the
box's clock is right, as §4.8 b describes. The build is planned as its own item, A798-B.

_Example._ On Sunday night someone sets the box's clock a day ahead by mistake, so the last sale,
really at 23:40 on Sunday 18 October, is recorded as 23:40 on Monday 19 October. On Monday morning
the clock is put right and reads 09:12. By your answer to question 3, payments stop: the clock
reads earlier than the last recorded sale. But this time the clock is right. Nothing done to it can
clear the stop; it clears by itself only at 23:40 on Monday, after a whole day of service with no
payments (orders and the kitchen still work).

The box cannot tell this from your question-3 example (a clock that fell back to 2025 after a power
cut) by its own clock alone. It can tell them apart with proof gathered after the stop began:
AEAT's time, or the clocks of the tills and handhelds. Devices do not report their clocks today;
the build adds it. AEAT's time is available during a stop only while records are waiting to be sent,
or if a read-only query to AEAT returns the time, which is still to be measured (§4.8 b).

- (a) **Recommended: a manager may restart payments, but only with fresh proof that the box's clock is
  right** — AEAT's time, or at least two devices, each within a minute of the box's clock, gathered
  after the stop began — and only when the box is at most 24 hours behind the last sale. With no
  proof, or any proof the other way, or a bigger gap, there is no restart and the stop holds until
  the clock is fixed or real time passes the last sale. The restart is done on the Box status page
  by someone with `system.manage`, recorded with their name and the proof, and never changes a
  recorded sale, the chain or the box's clock. The first sale after the restart steps the chain back
  by up to 24 hours; later sales carry times earlier than the last sale until real time passes it. If the clock it accepted later proves wrong, the managers get an alert;
  nothing is rewritten.
- (b) **No restart at all.** The stop always holds until the clock is fixed or real time passes the
  last sale — in the example, until 23:40 on Monday.
- (c) **A manager may restart payments on their own judgement, with or without proof.** Rejected by the
  review: in your question-3 example, with no internet and no device reporting, one press would file
  sales dated 2025 after sales dated 2026, which can never be corrected.

Why (a): it keeps "stop until the clock is fixed" wherever the clock might be wrong, and gives a way
out only where the box can show its clock is right, so a venue does not lose a day of takings to a
stamp that was wrong yesterday. The 24-hour cap covers a clock set an hour or a day wrong; a clock
reset by a power cut goes back much further, and stays stopped. Whether AEAT accepts one record
dated earlier than the one before it is a question for the asesor either way.

---

## 10. What this design does not cover

- **Failover.** A dead box or a cut network to it is not "degraded but trading": no node sells.
  Promotion to a standby is the replication work (`docs/backlog.md` → _Replication, membership &
  failover — residuals_).
- **The old design's other recovery items** — starting without a module that fails at start, undoing
  the last module change, and a migration that applied only in part — had no home in the backlog
  (grep for each found none). They are filed by this change as one new backlog entry under _The box:
  backups, upgrades and recovery_, beside A798's: "Recovery actions the 2026-09-08 node-containers
  design handed on". Only undoing the last module change waits for installable modules; a migration
  that applies only in part can happen on any upgrade today.
- **Restore, reset or image rollback from the recovery page** — separate backlog entries
  ("Resetting a box without a terminal", "Automatic upgrades that can be undone until the first
  order").
- **Time synchronisation in the box image, and a clock that keeps time through a power cut** — B3,
  whose image constraints name both (`docs/backlog/box.md`, "Box image constraints (B3)"); this
  design only switches synchronisation on at `waitron.sh install` (§8, slice 10) — and the HTTPS
  certificate minted before the clock is set (`docs/backlog.md`, "A box that mints its certificate
  before NTP sync").
- **Setting the box's clock from a page.** Rejected, not deferred (§4.8 b; §6, revision 5 decision 10).
- **Two questions for the asesor**, to add to `docs/compliance/asesor-questions.md` when the build is
  planned: whether AEAT accepts a chain whose record times run backwards once, as a manager's restart
  allows (§4.8 b, question 4); and whether anything should be done about sales recorded under a
  restart whose clock later proved wrong (`clock.behind_chain_disproved`, §4.8 b).
- **The SumUp 15-minute wait** after an uncertain card (§2.4) is a payments decision.
- **The receipt printer's paid-screen line** is A796's ("No se ha podido imprimir", Revision 4
  default 12) and the counter's is A739's.

---

## 11. Found while reading, outside this design

For the runner to file; none is acted on here.

1. **`Incidencia="S"` is never sent to AEAT.** The house reading of art. 16.4 lists it among the
   duties during an outage (`verifactu-findings.md:359`); the drain raises only a local `incidencia`
   column (`drain.ts:978-993`), and the batch header it builds carries the taxpayer alone
   (`drain.ts:1010-1012`), though the library can send it
   (`@waitron/verifactu/dist/xml/serialize.js:365`). (read; confirmed by the round-2 claim check)
2. **CLAUDE.md §3's refusal rule** ("a statement this engine refuses backs out ITSELF") does not hold
   for a full disk, nor for `RAISE(ROLLBACK)`, `INSERT OR ROLLBACK` and `ON CONFLICT ROLLBACK`, which
   the product does not use (§2.6; §12, experiments 2, 4 and 5). Slice 1 corrects the rule.
3. **A drawer kick for a USB or Bluetooth printer that is not connected stays queued with no
   expiry**, and is claimed when the printer reappears, so the drawer can open long after the sale
   (`packages/printing/src/runtime.ts:80-83`, `:102`; measured by the round-2 claim check).
4. **Today a connected card is charged before a clock before 28-10-2024 refuses the sale**, on both
   card paths: neither check before the reader looks at the date (`till-sale.ts:1236-1237`;
   `bill-payments.ts:1078`; `invoice-selection.ts:87-140`), the card is collected
   (`till-sale.ts:1314`, `bill-payments.ts:1358`), and only then does `recordSale` refuse
   `fiscal.record_invalid`. On a bill this happens when the card payment completes the bill, inside
   `completeBillPayment` (`bill-payments.ts:1237-1262`, `:706`). (read; not run) Slice 3 closes it.
5. **A backup run that is cut off leaves a plaintext copy of the whole database** in
   `<state>/backup-staging` (`backup-sweep.ts:155`: "The whole venue database in plaintext"), with its
   encrypted copy beside it; only the run's own `finally` deletes them (`:215-218`), and nothing sweeps
   the folder at start (read: grep for `backup-staging` and `stagingDir` in `apps/server/src`). The
   backlog tracks the same for an interrupted restore (`docs/backlog.md:5236-5239`) but not for a
   backup. The file is written owner-only (`chmod 0o600`, `:156`). Liberar deletes it (§4.6).
6. **Corrected readings.** Revision 1 said SumUp treats a 5xx answer as a definite decline. It does
   not: a 5xx throws (`packages/payments-sumup/src/sumup-client.ts:120-123`) and the payment stays
   "attempting" (`packages/payments-sumup/src/provider.ts:186-198`); only a 4xx is a decline. A search
   helper also reported that deleted images keep their bytes; they do not (`media_image_data` rows go
   with their image, `packages/media/src/schema/images.ts:40-44`, `onDelete("cascade")`).

---

## 12. Experiments run for this design

All in scratch folders outside the repository (`mktemp -d`); nothing was committed. macOS only.

1. **A full disk inside a transaction, on the engine alone.** A Node script on `node:sqlite`, Node
   v26.11.1, in WAL mode: open `BEGIN IMMEDIATE`, insert a sale row, then fill. Run twice — once with
   `PRAGMA max_page_count`, once on a real 1 MiB disk image (`hdiutil create -size 1m`, mounted, the
   database on it).
   - Printed, both times: `error: 13 database or disk is full`, `isTransaction after error: false`,
     an insert after the error succeeded, `commit: cannot commit - no transaction is active`, and the
     row inserted after the error was the only one kept.
   - The failing case — a full disk that left the transaction open, as a refusal does — would have
     printed `isTransaction after error: true`. Control: a unique-key refusal in the same shape printed
     `isTransaction after error: true` and kept both rows.
2. **The same through the box's write queue** (`createWriteQueue` and `drizzleNodeSqlite` from
   `packages/store/src`, run with the worktree's Vitest from a scratch root). Command:
   `env -u AI_AGENT -u CLAUDECODE node_modules/.bin/vitest run --root <scratch>/vt queue`.
   Printed:
   - `Q1 caller sees: cannot rollback - no transaction is active | errcode 1` and no rows kept;
   - `Q2 caught: database or disk is full`, `Q2 caller sees: cannot rollback - no transaction is
     active`, `Q2 sales: [ 'part 2' ]`;
   - control `Q3 caught: UNIQUE constraint failed: sale.body`, `Q3 sales: [ 'part 1', 'part 2' ]`.
   - `Tests 3 passed (3)`. The failing case for Q2 — the queue holding the transaction together —
     would have printed `Q2 sales: []`.
3. **The fiscal library's minimum date.** `validate` from `@waitron/verifactu` 0.2.1 over one record,
   dated 01-01-2001 and 19-10-2026 with matching `now`. Printed `01-01-2001 minimum-date refusal:
   true | all error codes: FECHA_EXPEDICION_BEFORE_MINIMUM` and `19-10-2026 minimum-date refusal:
   false | all error codes: none`. The 2026 line is the control: had the probe record been invalid
   for some other reason, it would have listed other codes.
4. **A full disk inside a nested transaction** (revision 2), through the same write queue and the
   adapter's nested transaction, as `appendToChain` opens one. Command:
   `env -u AI_AGENT -u CLAUDECODE node_modules/.bin/vitest run --root <scratch>/vt` over a test that
   inserts a sale, then fills inside `db.transaction(...)`. Printed `N nested caller sees: no such
   savepoint: wt_sp_1`, `N outer caller sees: cannot rollback - no transaction is active`,
   `N rows kept: 0 0`, `Tests 1 passed (1)`. Had the adapter kept the real error, the nested line
   would have read `database or disk is full`. This reproduces the round-2 claim check's result.
5. **Which refusals end a transaction** (revision 2). A Node script on `node:sqlite` opening
   `BEGIN IMMEDIATE`, writing one row, then running each refused statement and printing
   `isTransaction`. Printed `transaction still open: true` for NOT NULL (1299), CHECK (275), an
   immediate foreign key (787), `RAISE(ABORT)` (1811), `RAISE(FAIL)` (1811), no such table (1) and a
   default unique clash (2067); and `false` for `RAISE(ROLLBACK)` (1811), `INSERT OR ROLLBACK` (2067)
   and `ON CONFLICT ROLLBACK` (1299). Each `true` line is the control for its neighbours: the same
   code (1811, 2067, 1299) appears on both sides, so the code alone cannot tell them apart.
6. **Whether a container process can gain the clock-setting capability** (revision 5, re-run in its
   review round). Docker 29.3.0 (Docker Desktop's Linux machine on macOS), image
   `node:26.11.1-slim`, printing `CapEff` (what the process holds) and `CapBnd` (the bounding set:
   the ceiling no process in the container can rise above, whatever its user or file capabilities)
   from `/proc/self/status`, and bit 25 of each, `cap_sys_time`. Command shape:
   `docker run --rm <flags> node:26.11.1-slim sh -c 'grep -E "CapEff|CapBnd" /proc/self/status;
   node -e "…bit 25 of each…"'`. Printed:
   - no flags (root, Docker's default set): `CapEff 00000000a80425fb`, `CapBnd 00000000a80425fb`,
     bit 25 `false` in both;
   - `--user 1000:1000`: `CapEff 0000000000000000`, `CapBnd 00000000a80425fb`, bit 25 `false` in both;
   - control, `--cap-add SYS_TIME --user 1000:1000`: `CapEff 0000000000000000` (bit 25 `false`),
     `CapBnd 00000000aa0425fb`, bit 25 **`true`**.
   - What discriminates is the bounding set: without the flag its bit 25 is clear, with it set. An
     unprivileged user's `CapEff` reads 0 either way, so revision 5's first reading of that line
     measured nothing on its own; the review round showed it, and this re-run reproduced it.
   - What this shows: on Docker Desktop, a container of this image started without
     `--cap-add SYS_TIME` cannot hold the clock-setting capability. `deploy/compose.yml` adds no
     capability (read). Not run on a real box's Docker, nor on the Waitron image, whose `node` also
     carries the file capability `cap_net_bind_service` (`deploy/Dockerfile:168`) — which cannot add
     a bit the bounding set lacks. Nothing tried to set the clock: Docker Desktop's machine is shared
     with other sessions.
7. **Whether AEAT's replies carry the current time** (revision 5 review round). `curl -sS -o
   /dev/null -D -` from this Mac, no certificate, 2026-10-20 06:01 UTC. Printed:
   `https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR` → `HTTP/2 200` and
   `date: Tue, 20 Oct 2026 06:01:14 GMT`, the same second as this machine's `date -u`;
   `https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP` → `HTTP/2 302` and
   no `date:` line. The second line shows the probe prints nothing when the header is absent; it
   says nothing about a certificate-authenticated reply. Not measured:
   a certificate-authenticated `consultar` reply, which is the one the box would make (§4.8 b).
