# A798 — Degraded but trading: what the box does, and tells staff, when a part fails

Status: **design proposal, revision 2; three owner questions open (§9). Nothing is built; the build
is planned as its own item once the questions are answered.**

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

File references are to `main` at `ad57a6bb9`. **(read)** marks a conclusion from reading code, not
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
3. **Disk:** a free-space watch, a reserve the box releases by itself (question 1), a refusal before
   any card is charged, a store fix so a full disk is reported as itself and can never commit half a
   transaction, and a start that frees space before it does anything else (pictures 1 and 5).
4. **Clock:** a named refusal for a clock the fiscal rules cannot accept (picture 6), and checks that
   notice a clock behind the chain with no internet. What the box does then is question 3.
5. Everything for a box that is still trading lives in the dashboard. The recovery page keeps its one
   job, a box that will not start.

The per-module "can a till sell without this" field the old design asked for is still not needed
(§5), and the build needs no migration (§7).

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
  already refuses a sale it could never file (`till-sale.ts:1225-1226`: "Before the reader is asked:
  P3 could never file this sale"). A card payment on a bill takes a second path with its own check
  before the reader, `beginBillPayment`, which runs the same two calls
  (`apps/server/src/bill-payments.ts:1068-1069`); the card is collected (`:1358`) and the sale is
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
  administrator alert; the till does not poll for it" (`:370-371`).
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
| Printer down | No | Printing is a queue | Amber strip (question 2) |
| Card reader or provider down | No | Cash and "Otro datáfono" remain | The payment's own message, as today |
| Clock wrong but after 28-10-2024 | No | Records are written with the wrong time | Nothing for staff (A364); the manager's bell; question 3 for a clock behind the chain |

**No card is charged while the line is crossed.** When the disk or the clock is red, the box refuses
at both checks before the reader: `till-sale.ts:1225-1226` for a sale, and `beginBillPayment`
(`bill-payments.ts:1068-1069`) for a card payment on a bill. So a connected reader is never charged
for a sale that cannot be recorded; today it is, for a clock before 28-10-2024 (§2.5, §11). A card taken on another machine can still have
been charged, which is why the clock refusal keeps today's card advice. The one gap left is a disk
that fills between the charge and the record: then the till says "Cobrado con tarjeta, pero la venta
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
  module supplies the unsent count and the clock-before-28-10-2024 notice through the new seat (§5).
- **The notices** — one wording each, used in every picture (Spanish as shown; English for the
  English till):

| Tone | When | Spanish | English |
| --- | --- | --- | --- |
| Red | A write fails because the disk is full | No se puede guardar nada: el equipo no tiene espacio · Avisa al encargado | Nothing can be saved: the box is out of space · Tell a manager |
| Red | The clock is before 28-10-2024 | No se pueden registrar ventas: la hora del equipo es incorrecta · Avisa al encargado | Sales can't be recorded: the box's clock is wrong · Tell a manager |
| Amber | The disk reserve is in use (§4.6) | Queda poco espacio en el equipo · Avisa al encargado | The box is nearly out of space · Tell a manager |
| Amber | A printer is down (question 2) | Impresora Cocina no imprime · desde 21:16 | Kitchen printer not printing · since 21:16 |
| Blue | A record is waiting after a failed send | 12 ventas sin enviar a Hacienda · Se reintenta solo | 12 sales not yet sent to the tax agency · Retried automatically |

- **The unsent count** appears from the first failed send attempt (or a send skipped for a missing
  certificate) until no record waits. It counts every record not yet accepted, voids and corrections
  too, though the strip says "ventas", the word staff use. It does not appear on a demo or prepare
  box, which never sends (`apps/server/src/onboarding-policy.ts:12-13`), nor while records merely wait
  out AEAT's own wait between sends (§2.2), which is not an outage. It says "Se reintenta solo" rather
  than "every hour", because the retries start at one minute and double (§2.2).
- **A clock that is wrong but usable puts nothing on the strip**, following A364 (§6, default 12).

### 4.3 The dashboard: the bell, the Box status page, and email

- **New alerts in the bell** (picture 3), in a new area "Equipo" (EN "Box"), with the same shape as
  today's: sentence, severity · area · time, Go-to. New codes, each with English and Spanish wording
  as the house rule requires (CLAUDE.md §3):
  - `storage.space_low` (warning): "Al equipo le quedan {free} de espacio en disco. Todo sigue
    funcionando. Mira qué ocupa espacio en Estado del equipo." / "The box has {free} of disk space
    left. Everything still works. See what is using it on the Box status page."
  - `storage.reserve_in_use` (error): "El equipo se ha quedado sin espacio en disco y está usando su
    reserva. Todo sigue funcionando, pero libera espacio ya." / "The box ran out of disk space and is
    using its reserve. Everything still works, but free space now."
  - `storage.disk_full` (error): "El equipo no tiene espacio en disco: no se puede guardar nada." /
    "The box is out of disk space: nothing can be saved."
  - `clock.unusable` (error: the date is before 28-10-2024), `clock.behind_chain` (warning, emailed:
    earlier than the last record) and `clock.disagrees` (warning: two or more devices disagree with the
    box), §4.5. They sit beside today's `fiscal.clock_drift`.
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
- **Email.** The red conditions (disk full, clock before 28-10-2024), the reserve in use, and a clock
  behind the chain email everyone with `system.manage` and an email address, once per episode (§6,
  default 7). "Once per episode" is held in memory: a restart during an episode may send one more,
  which keeps the build free of a new table (§7).

### 4.4 Part by part: the bucket stream, the outbox, printers, card readers

- **Bucket stream.** No change for staff: they cannot act on it and sales continue. The Box status
  row shows its lag and links to Copias de seguridad. No email: the owner's posture accepts losing the
  un-copied tail (memory `cold-recovery-no-hot-failover-posture`, 2026-08-29), and the six alerts
  already exist.
- **Outbox.** The blue strip (§4.2) answers the house's reading of art. 16.4. The Box status row
  shows the unsent count, the last accepted record and **Reintentar ahora**. The dashboard's own
  thresholds (4 h, 24 h) stay.
- **Printers** — question 2. Today's per-table banner stays either way.
- **Card readers.** No new staff notice: the payment form already says when the reader does not
  answer, and "Otro datáfono" and cash are the ways on (A796). The manager gets `reader.offline`.

### 4.5 The clock

The box does **not** correct its own time. It cannot do so honestly: a box at 2001 cannot check
AEAT's certificate and so gets no time from AEAT (A679 forbids switching that check off, §2.5); a
saved AEAT time cannot be carried forward, because a counter that only goes forward restarts when the
box does; one device "agrees with itself", and a phone set by hand would set invoice dates; and
stamping only sales would leave payments, working time, the business day and session expiry on the
wrong clock. The container also runs as the unprivileged user `waitron` (`deploy/Dockerfile:269`) and
cannot set the system clock (read).

What the box does instead:
1. **Before 28-10-2024 is a red stop**, whatever question 3's answer: the red strip, the named refusal
   with today's card advice kept, `clock.unusable` and an email (picture 6). The Veri*Factu module
   supplies it, since the date is its rule.
2. **Detect a clock behind the chain, with no internet.** When the box's clock is earlier than the
   last record's time by more than a minute, one of two clocks was wrong: this one, or the one that
   stamped the last record. A clock that ran ahead and was then put right looks exactly the same. The
   Veri*Factu module, which owns the chain, runs this check. It does not notice a clock that is ahead.
3. **Use devices only as witnesses.** Requests from a till would carry the device's own time (none
   does today). When at least two devices that spoke in the last few minutes agree with each other and
   the box differs from both by more than a minute, the box raises `clock.disagrees` for the manager.
   A device is never the source of a record's time, only evidence, as in D7's "every selling device is
   a witness" (owner, 2026-10-03; `2026-10-03-fiscal-chain-divergence-design.md:350-357`). A device's
   clock is only as good as its own source; a tablet on wifi alone has no mobile network to set it.
4. **AEAT**, as today, whenever something is sent; and `timedatectl` where the box image provides it.
5. **A clock behind the chain** is question 3. Any other wrong clock follows D8 and A364: it keeps
   selling, the manager is warned, staff see nothing.
6. **The box image (B3)** should keep its clock synchronised; that belongs to the image, not this
   design, and is now one of B3's image constraints (`docs/backlog/box.md:356-359`).

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
   `till-sale.ts:1225-1226` for a sale and `beginBillPayment` (`bill-payments.ts:1068-1069`) for a card
   payment on a bill — so no connected card is charged (§3). The same applies to a clock before
   28-10-2024.
4. **A free-space watch** every minute on the venue folder's disk (`apps/server/src/free-bytes.ts`
   already reads it): `storage.space_low` below 2 GiB free. Because sales can carry on past "0 free"
   on room the side file already holds (§2.6), this watch, not the first failed write, is what warns
   in time.
5. **A reserve** — question 1. A 1 GiB file in the state folder, **really written** (a file with
   holes in it reserves nothing). It is released when the watch sees less than 256 MiB free, or at
   once when a write fails with a full disk; then `storage.reserve_in_use` and the amber strip. The
   freed space is not kept for Waitron: anything else writing to the same disk, Docker's images and
   logs included, can take it. The box writes the reserve again once free space is back above 3 GiB.
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
   images. Deleting old images after an upgrade is a follow-up for `deploy/waitron.sh` (slice 9).

### 4.7 A full disk at start (picture 5)

Today a full disk stops the start before it can count itself, so the box restarts forever and the
page never appears (§2.6). The redesign:

1. **The very first step of every start checks free space**, before the failure count is written and
   before anything opens the database. Below 256 MiB free, it releases the reserve if it is still
   there, then deletes the leftovers of §4.6 item 6 that need no database (crash reports older than a
   week, rotated logs, backup staging). If the start then works,
   there is no page and nothing for the operator to do.
2. **If the count still cannot be written**, the start serves the recovery page at once, with the code
   `storage.disk_full`, instead of exiting and restarting forever. The page reads the free space as a
   new fact (with `freeBytes`; nothing on the page reads it today).
3. **The page's text**, fixed and chosen by the code as the house rule requires (CLAUDE.md §3): "El
   disco del equipo está lleno, así que Waitron no puede guardar nada." and "El equipo ya ha usado el
   espacio que guarda de reserva y ha borrado lo que podía volver a crear, y no ha bastado. Pide a
   quien instaló este equipo que libere espacio (copias antiguas, versiones anteriores de Waitron) o
   ponga un disco mayor. Tus ventas no se tocan." Its one button stays "Reintentar un arranque normal".
   It never suggests wiping (`recovery-surface.ts:230-232`, owner 2026-09-10).
4. **A database that cannot be opened because the disk is full** is classified `storage.disk_full`
   rather than `provisioning.database_unreachable`, by checking free space when the open fails.

This needs a test on a real full disk image, not only a page limit: the measurements in §2.6 show
that where the disk fills decides what fails.

The first revision gave the page a "Liberar espacio y arrancar" button. It is gone: the start now does
that by itself, so the page needs no new action anyone on the network could press.

---

## 5. The module seat this needs, and the field it does not

**A seat is needed.** The notices and the Box status rows are not all the core's to give:

- The unsent count, **Reintentar ahora**, the clock-behind-the-chain check and the 28-10-2024 rule all
  belong to the Veri*Factu module. A generic route cannot name its outbox (`envios`) or its chain;
  CLAUDE.md §3 keeps the composition list the only place that names every module, and generic code
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
- **Whether a sale can go ahead is decided by concrete conditions**, a full disk and a clock the
  fiscal rules refuse (§3), each answered by the part that knows: the core for the disk, the fiscal
  seat for the clock. A per-module "can sell without me" flag would not tell the box either of those.
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

1. **Keep selling whenever the record can be written.** "Data loss is the accepted price … being
   stuck offline is not" (memory `cold-recovery-no-hot-failover-posture`, owner 2026-08-29);
   "Nothing EXTERNAL may block a sale" (CLAUDE.md §5).
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
   A795 Q3 "A", recorded in `~/waitron-campaign-shared/watcher-handoff.md`, 13:06 entry).
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
    does not poll for it"), both in `2026-10-03-fiscal-chain-divergence-design.md:364-371`, `:753-756`.
13. **The box never corrects its own time** (§4.5).
14. **Devices are witnesses, never a source of time** — the precedent of D7 (owner, 2026-10-03).
15. **The Box status page sits under Ajustes beside Diagnóstico**, its own page (§4.3).
16. **The disk thresholds**: warn below 2 GiB free, release the reserve below 256 MiB or on a failed
    write, re-create it above 3 GiB. They are guesses for a box with a disk of tens of gigabytes;
    the build may change them with a measurement.

---

## 7. Storage and migration

**No migration.** Everything new is either worked out when asked or held outside the database:

- Notices, the Box status rows and the new alerts are computed on each read, like today's ongoing
  alerts (`packages/module/src/alerts.ts:6-7`).
- The reserve is a file in the state folder, not a row.
- "Once per episode" for emails is held in memory (§4.3). Making it survive a restart would need a
  table like the certificate reminders' (`packages/fiscal-verifactu/src/schema/certificate-reminders.ts`),
  and so a migration; this design does not ask for that.
- The clock checks keep their results in memory, like AEAT's comparison today
  (`time-health.ts:48-58`); the chain check reads the last record, which is already stored.

If the owner's answers change any of this — question 3's option (a) changes how a record's time is
chosen, though not what is stored — the plan says so before building.

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
   `till-sale.ts:1225-1226` and `beginBillPayment`, `bill-payments.ts:1068-1069`). _Risk: fiscal
   invariants (the settle handlers), cross-package contract (a refusal's parameters)._
4. **The module seat** of §5. _Risk: cross-package contract._
5. **Free-space watch, reserve and the `storage.*` alerts.** _Risk: concurrency (a duty that deletes
   files)._
6. **The strip**: notices on the equipment read and the strip in the till. _Risk: cross-package
   contract (till ↔ box), fiscal invariants (reads the outbox through the seat)._
7. **Box status page**, **Reintentar ahora** and **Liberar**. _Risk: auth (`system.manage`), fiscal
   invariants (nudging the drain)._
8. **Clock checks** (minimum date, chain, devices, `clock.*` alerts), then question 3's answer.
   _Risk: fiscal invariants; if question 3 is (a), fiscal core, which the owner lands._
9. **Emails for the red conditions**, `reader.offline`, the printer notice (question 2), and deleting
   old Docker images after an upgrade in `deploy/waitron.sh`. _Risk: none listed._

---

## 9. Questions for the owner

Three, one at a time. Each has a recommendation; the pictures are in the mock-ups folder.

### Question 1 of 3 — When the disk fills, should the box free its reserve by itself?

_Example._ Friday 22:10, Bar Santet. The box's disk has been filling for weeks with photos and
backups nobody cleared, and it runs out mid-service. The box keeps 1 GB spare for exactly this.

- **(a) Recommended: yes, by itself.** When free space runs low, the box deletes its spare 1 GB at
  once. Sales, orders and kitchen sends carry on; every till shows "Queda poco espacio en el equipo ·
  Avisa al encargado"; the managers get an email. That space is not kept for Waitron alone: if
  something else on the box is filling the disk, it can use it up too, so someone still has to free
  space soon.
- (b) Keep the spare, but release it only when a manager presses a button in the dashboard. Until
  someone does, nothing can be saved and every till shows red (picture 1).
- (c) No spare: only the warning at 2 GB left, and the email.

Why (a): the owner's rule is that being unable to trade is not accepted; (a) is the option most
likely to carry a busy night through to closing.

### Question 2 of 3 — When a printer stops printing, who is told, and how soon?

_Example._ 21:14, the Cocina printer's cable is knocked out. Ana sends Mesa 4's starters at 21:16. At
21:18, two minutes on, her table screen shows "Un ticket de cocina no se ha impreso: Cocina". Marc, at
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
- **Time synchronisation in the box image** — B3 (`docs/backlog.md:5039-5041`), whose image
  constraints now name it (`docs/backlog/box.md:356-359`) — and the HTTPS certificate minted before
  the clock is set (`docs/backlog.md:5088-5089`).
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
   card paths: neither check before the reader looks at the date (`till-sale.ts:1225-1226`;
   `bill-payments.ts:1068-1069`; `invoice-selection.ts:87-140`), the card is collected
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
