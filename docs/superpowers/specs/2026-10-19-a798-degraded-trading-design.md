# A798 — Degraded but trading: what the box does, and tells staff, when a part fails

Status: **design proposal; three owner questions open (§9). Nothing is built; the build is planned
as its own item once the questions are answered.**

Backlog entry: `docs/backlog.md`, "A798" under _The box: backups, upgrades and recovery_. Pictures:
[`docs/backlog/mockups/a798-degraded-trading/`](../../backlog/mockups/a798-degraded-trading/README.md),
drawn in HTML with the apps' colour and spacing tokens, not screenshots; each is labelled "today" or
"proposed". The generator is kept outside the repository.

File references are to `main` at `ad57a6bb9`. **(read)** marks a conclusion from reading code, not
from running it. Part of the reading was done by search helpers; every citation this design leans
on was re-read before being written here, and one helper reading was wrong and is not used (§11).
The experiments that were run are in §12, each with what the failing case would have printed.

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

---

## 1. Summary

The rule this design serves is the owner's: **losing a little data is accepted; being unable to
trade is not.** Next to it sits the fiscal rule that never moves: **a box that cannot write a sale's
record must refuse the sale rather than sell unrecorded** (CLAUDE.md §5). An unrecorded sale is not
"trading".

Today most parts fail well. The bucket stream, the outbox, printers and the card provider are all
kept off the sale path by design, and a sale never waits on any of them. What is missing is the
telling:

- **Staff see almost nothing.** No server alert reaches a till or a handheld (§2.8). The law asks
  for a standing on-screen count of records not yet sent to AEAT during an outage; it is not built
  (§2.2).
- **Two failures do stop sales, and both are reported as something else.** A full disk refuses every
  sale with "try again", which can never work (§2.6). A clock set before 28 October 2024 refuses
  every sale with a message about the venue's billing data (§2.5). Neither raises any alert.
- **A full disk also hides its own cause** and, in one shape of code, would commit half a
  transaction. Both were measured (§2.6, §12).

The proposal (§4):
1. A **strip** on every device that sells: blue for the unsent count the law asks for, amber for a
   problem staff must work around, red when sales cannot be recorded (picture 2).
2. A **Box status page** in the dashboard showing every part at once, with the actions an operator
   can take without a terminal (picture 4), and the new alerts in the bell (picture 3).
3. **Disk:** a free-space watch, a reserve of space the box can release by itself, a "free space"
   action, a clear refusal when the disk is full, and a store fix so a full disk is reported as
   itself and can never commit half a transaction (pictures 1 and 5).
4. **Clock:** checks the box can run with no terminal, a named refusal when the clock is unusable,
   and (question 3) whether the box may correct its own time from a trusted source.
5. The **recovery page** keeps its one job, a box that will not start, and gains a full-disk code
   with a safe action (picture 5). Everything for a box that is still trading lives in the
   dashboard instead.

No per-module "can a till sell without this" field is needed (§5), and the build needs no migration
(§7).

---

## 2. Today, part by part

### 2.1 The bucket stream

- **It never blocks a sale on the bucket.** Boot starts it "without waiting for the bucket, so a
  bucket that never answers cannot hold boot or a sale" (`apps/server/src/boot.ts:2015-2016`), and
  the supervisor schedules its work and returns (`packages/stream/src/supervisor.ts:242-243`).
- **A sale can wait briefly** while the box folds the database's side file back in, which it does
  when the side file reaches 256 MiB (`DEFAULT_WAL_LIMIT_BYTES`, `supervisor.ts:163-167`). The
  fold-back joins the same one-at-a-time queue as every sale (`packages/store/src/write-queue.ts:74-76`)
  and runs synchronously (`packages/store/src/index.ts:253-267`). How long that takes at 256 MiB has
  not been measured; the end-to-end test asserts sales stay under a one-second bound with a 16 MiB
  limit (`apps/server/src/testing/stream-pause-scenario.ts:82`, `:126`).
- **`/health` reports the stream but never fails on it** (`apps/server/src/health.ts:43-45`).
- **The manager sees** six `backup.*` alerts in the dashboard bell: stopped, refused, unusable
  settings, behind by 15 minutes or more, paused, bucket unusable (`apps/server/src/alert-sources.ts:64-132`),
  each an error linking to the Backups page, with wording that ends "Sales continue"
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
  only a local `incidencia` flag (`drain.ts:978-993`).
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
- **A kitchen printer that is down** leaves the order in place. The table screen of the order whose
  ticket did not print shows "Problema de impresión · Un ticket de cocina no se ha impreso: {stations}"
  with Reprint once the ticket has waited two minutes (`apps/server/src/print-job-trouble.ts:7-8`;
  `apps/till/src/i18n/strings.ts:985`, `:2535`; `apps/till/src/screens/till-table-order-screen.ts:3062-3086`).
  A kitchen screen keeps showing the tickets with "Printer {name} has printed nothing since…"
  (`strings.ts:598-599`). **Other waiters see nothing** and keep sending to the same printer
  (read). The manager sees `station.printer_down` and `printer.jobs_waiting`
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
  (`apps/server/src/till-sale.ts:1306-1324`, `:1536-1552`). If that second step fails, the charge
  stands and a later Pay files the sale without charging again (`till-sale.ts:1149-1164`).
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
  "confident" and "anchored" (`apps/server/src/till-backend.ts:14-26`). The till-side trusted clock
  that would warn on a stale or jumped clock (`packages/fiscal/src/clock.ts`) has no production
  caller (read; grep of `packages` and `apps` outside tests), so `clock.degraded` and
  `clock.jump_detected` are never raised.
- **One reading stamps everything.** A sale's invoice date and its record's generation time both come
  from one clock reading (`packages/core/src/record-sale.ts:273-275`, `:315`;
  `packages/fiscal-verifactu/src/backend.ts:222`, `:234-235`). Nothing compares a record's time with
  the previous record's (`packages/fiscal-verifactu/src/chain.ts:153-160` reads only the previous
  record's identity and fingerprint).
- **A clock before 28 October 2024 refuses every sale.** The fiscal library refuses an invoice dated
  before that day (`node_modules/.pnpm/@waitron+verifactu@0.2.1/…/dist/validate.js:610-611`); the
  chain turns that into `fiscal.record_invalid` (`chain.ts:187-197`). Measured with a control (§12,
  experiment 3). The till treats `fiscal.record_invalid` as a permanent refusal
  (`apps/till/src/till-app.ts:450-453`) and says "Esta venta no se puede registrar en Hacienda. … hay
  que corregir los datos de facturación del local, así que avisa a quien configuró esta caja"
  (`strings.ts:2796`) — wrong advice for a clock (picture 6). A clock in the future is not caught,
  because the library's "not in the future" checks are judged against the record's own time
  (`chain.ts:187-189`).
- **What checks the clock today.** After each send, the box compares its clock with AEAT's reply and
  raises `fiscal.clock_drift` as a warning past 60 seconds (`apps/server/src/time-health.ts:89-91`,
  `:102-119`; wired at `boot.ts:1382`, `:2405`); it says "you can continue selling"
  (`alert-messages.ts:26-28`). This only runs when something is sent, so with no internet it never
  fires (read). A `timedatectl` probe exists (`time-health.ts:34-43`), reporting "unavailable" where
  the command is absent; its only reader is `GET /api/box/status`, which nothing calls (read).
  Nothing in `deploy/` sets up time synchronisation (read: grep of `deploy/` for NTP, chrony,
  timesyncd, timedatectl).
- **The backlog already holds** "A box that mints its certificate before NTP sync persists a wrong
  validity window" (`docs/backlog.md:5076-5077`). That is the box's own HTTPS certificate, not
  AEAT's (`apps/server/src/self-signed-cert.ts:144-148`).

### 2.6 The disk

- **No check watches free space.** The only free-space reads are the backup sweep's, which refuses a
  backup with `backup.staging_space_low` (`apps/server/src/backup-sweep.ts:101-111`), and a restore's
  (`apps/server/src/archive-download.ts:63-65`). The bucket stream pauses itself before its side file
  passes 256 MiB, "to protect its disk" (§2.1). Nothing else, and no alert or `/health` field
  (read: grep for `statfs`, `ENOSPC`, `SQLITE_FULL`, "disk is full").
- **The sale and its record are one transaction**, so a write that fails writes neither
  (`record-sale.ts:161-162`; `till-sale.ts:902-904`). That is the fiscal rule holding by
  construction.
- **What a full disk does to a transaction — measured (§12, experiments 1 and 2).** On this engine
  (`node:sqlite`, Node v26.11.1), a full disk ends the whole open transaction, not just the
  statement. Through the box's own write queue:
  - a body that lets the error escape: the caller is told **"cannot rollback - no transaction is
    active"**, because the queue's rollback (`write-queue.ts:60-62`) runs after the engine has
    already rolled back and its error replaces the real one;
  - a body that catches the error and carries on: the statements after the catch ran **outside any
    transaction and stayed written**, while the rest was rolled back.

  The control (a unique-key refusal caught the same way) kept the transaction open and committed
  both rows, as CLAUDE.md §3 describes. So CLAUDE.md's "a statement this engine refuses backs out
  ITSELF, not the transaction around it" is true for refusals and **not for a full disk**. The fiscal
  chain's own retry rethrows anything but a unique-key clash (`chain.ts:286-292`), so a sale's
  record cannot be half-written that way (read); whether any other write path catches broadly and
  carries on was not audited — §4.6 makes the question moot.
- **What staff see.** The error reaches the route's error boundary as an unknown error and becomes
  `server.internal`, a 500 (`packages/server-kit/src/error-boundary.ts:39-40`), logged with error code
  "unknown". The till falls back to "No se pudo completar la venta, inténtalo de nuevo"
  (`till-app.ts:5117-5123`, `:763-771`; `strings.ts:2793`). Every retry fails the same way (picture 1).
- **A card already charged** before a full disk keeps its charge, and the sale is filed by a later
  Pay once a write succeeds (§2.4).
- **At start.** A full disk at start is classified "unknown" (`apps/server/src/boot-failure.ts:29-36`
  knows only "cannot open" and "missing table"), so after three failed starts the recovery page shows
  its generic text, "Waitron no ha podido arrancar. Pide a quien instaló este equipo que lo revise."
  (`apps/server/src/recovery-surface.ts:417-425`).
- **What can fill the disk** (read): the database itself, images included (stored in it,
  `packages/media/src/images.ts:333`); the side file, up to 256 MiB while the stream is healthy;
  backup staging, removed after each run (`backup-sweep.ts:215-218`); a local backup folder if one is
  configured (`apps/server/src/backup-config.ts:175-176`); `waitron.log`, rotated at 10 MB × 5
  (`apps/server/src/config.ts:141-142`); one crash report per frozen database holder, never cleaned
  up (`packages/store/src/venue-liveness.ts:182-187`); and, outside the container's reach, Docker's
  own images and logs (`deploy/compose.yml:69-73` caps the logs).

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
  two standing lines that are precedents for a strip — the demo/prepare mode indicator
  (`till-app.ts:13269-13274`) and the waiting-for-promotion banner (`:13401-13405`).
- **The manager** sees the bell, which polls every 60 seconds
  (`apps/dashboard/src/api/live-queries.ts:592-599`) and shows each alert as one sentence, then
  severity · area · time, then a Go-to button (`apps/dashboard/src/widgets/alerts-bell.ts:139-169`).
  No alert is emailed; the one email about box health is the AEAT certificate reminder
  (`apps/server/src/certificate-reminder-worker.ts:76-77`).
- **There is no page showing the whole box.** `GET /api/box/status` already gathers clock, HTTPS
  certificate, chain height, backups, stream and duties, behind `system.manage`
  (`apps/server/src/box-status.ts:23-35`, `:110-139`), but nothing calls it (read).
- **The recovery page is never served while the box trades.** The start decides once, before the
  server opens anything (`apps/server/src/node-entry.ts:411-439`); its only action is "Reintentar un
  arranque normal" (`recovery-surface.ts:524-531`), and its own comment says "there is no
  degraded-but-trading mode" (`:500-504`).

---

## 3. The fiscal line that never moves

A box that cannot write a sale's record locally refuses the sale. Nothing in this design softens
that, and nothing in it lets a sale be taken "now" and recorded "later". Losing a little data is
accepted; an unrecorded sale is not trading, it is a hole in the series.

Which failures cross the line, and what the device shows:

| Failure | Crosses the line? | Why | What the device shows (proposed) |
| --- | --- | --- | --- |
| Disk full | **Yes** | The sale's transaction cannot be written (§2.6) | Red strip "No se pueden registrar ventas: el equipo no tiene espacio · Avisa al encargado"; the sale's own line "Venta no registrada: el equipo no tiene espacio en disco. Reintentar no servirá hasta que se libere espacio." (picture 1) |
| Clock before 28-10-2024 | **Yes** | The fiscal library refuses the record (§2.5) | Red strip "No se pueden registrar ventas · hora incorrecta"; "Venta no registrada: la hora del equipo es incorrecta (marca 01/01/2001). Avisa al encargado." (picture 6) — unless question 3 lets the box correct its own time |
| Append-only protection changed | **Yes, deliberately** | The box stops itself (`apps/server/src/append-only-watch.ts:66-74`) | Recovery page, as today |
| Database cannot be opened or migrated | **Yes** | The server does not start | Recovery page, as today, plus a disk-full code (§4.7) |
| AEAT unreachable, certificate missing or expired | No | Records chain locally and wait | Blue strip with the unsent count (§4.2) |
| Bucket stream stopped or behind | No | The copy is outside the sale | Nothing for staff; the manager's bell |
| Printer down | No | Printing is a queue | Amber strip (question 2) |
| Card reader or provider down | No | Cash and "Otro datáfono" remain | The payment's own message, as today |
| Clock wrong but after 28-10-2024 | No | Records are written with the wrong time | Nothing for staff; the manager's bell (§4.5) |

When a card was already charged and the record then fails (a full disk between the two steps of
§2.4), the money is taken and the sale is not yet recorded. The proposal keeps today's recovery —
the next Pay files it without charging again — and makes the till say so: "Cobrado con tarjeta,
pero la venta no se ha registrado: el equipo no tiene espacio. No vuelvas a cobrar; se registrará
al pulsar Cobrar cuando haya espacio." (EN: "Card charged, but the sale is not recorded: the box is
out of space. Do not charge again; it is recorded when you press Pay once there is space.") This
needs the server's refusal to say a charge stands, which it does not today (read).

---

## 4. The proposal

### 4.1 Two places for an operator, not one

The item asks what "the operator does on the LAN recovery page". **That does not fit a box that is
still trading.** The recovery page exists only when the server will not start, it has no login, and
anyone on the venue's network can open it (`node-entry.ts:411-439`; CLAUDE.md §3). A running box
already has a logged-in home for operator actions: the dashboard. So:

- **(a) The box is trading with a part failing** → the operator acts in the **dashboard**: the bell
  (picture 3) points at a new **Box status page** (picture 4), which shows every part and links to
  the page that already fixes each one. People with `system.manage` see it, the permission behind
  the email server and backup settings.
- **(b) The box will not start** → the **recovery page**, as today, gains a full-disk code and one
  safe action (§4.7). It stays the one place that works with no server.

The operator never needs a terminal in either case (owner, 2026-09-10, memory
`box-operator-has-no-terminal`).

### 4.2 The strip on every device that sells (picture 2)

One line under the top bar of every signed-in till and handheld. Kitchen screens keep their own
printer line (§2.3) and get no strip: they do not sell.

- **It shows the most serious notice**, red over amber over blue, and "+1", "+2"… when more are
  waiting; tapping the strip opens the list. It never covers the order, has no close button, and
  goes when the problem goes. It is never a dialog: staff go straight to work (owner, 2026-10-12,
  memory `till-staff-straight-to-work`).
- **How it reaches the device.** Every signed-in till already asks `/api/menu-state` every 15 seconds
  (`apps/till/src/state/menu-state-poll.ts:4`; route `apps/server/src/till-api.ts:1491`). The answer
  gains a `notices` list the box works out on each ask. No new connection, and a device that cannot
  reach the box already shows its own "unreachable" line (§2.7).
- **The notices** (Spanish as shown; English for the English till):

| Tone | When | Spanish | English |
| --- | --- | --- | --- |
| Red | A sale cannot be written because the disk is full | No se pueden registrar ventas: el equipo no tiene espacio · Avisa al encargado | Sales can't be recorded: the box is out of space · Tell a manager |
| Red | The clock is unusable (§4.5) | No se pueden registrar ventas: la hora del equipo es incorrecta · Avisa al encargado | Sales can't be recorded: the box's clock is wrong · Tell a manager |
| Amber | The disk reserve is in use (§4.6) | Queda poco espacio en el equipo · Avisa al encargado | The box is nearly out of space · Tell a manager |
| Amber | A printer is down (question 2) | Impresora Cocina sin conexión desde 21:14 | Kitchen printer offline since 21:14 |
| Blue | A record is waiting after a failed send | 12 ventas sin enviar a Hacienda · Se reintenta cada hora | 12 sales not yet sent to the tax agency · Retried every hour |

- **The unsent count** appears from the first failed send attempt (or a send skipped for a missing
  certificate) until no record waits. It counts every record not yet accepted — voids and
  corrections too, though the strip says "ventas", the word staff use. It does not appear on a demo
  or prepare box, which never sends (`apps/server/src/onboarding-policy.ts:12-13`), nor while records
  merely wait the minute AEAT asks between sends (`drain.ts:35`), which is not an outage.

### 4.3 The dashboard: the bell, the Box status page, and email

- **New alerts in the bell** (picture 3), in a new area "Equipo" (EN "Box"), with the same shape as
  today's: sentence, severity · area · time, Go-to. New codes, each with English and Spanish wording
  as the house rule requires (CLAUDE.md §3):
  - `storage.space_low` (warning): "Al equipo le quedan {free} de espacio en disco. Las ventas
    continúan. Libera espacio en Estado del equipo." / "The box has {free} of disk space left. Sales
    continue. Free space on the Box status page."
  - `storage.reserve_in_use` (error): "El equipo se ha quedado sin espacio en disco y está usando su
    reserva. Las ventas continúan, pero libera espacio ya." / "The box ran out of disk space and is
    using its reserve. Sales continue, but free space now."
  - `storage.disk_full` (error): "El equipo no tiene espacio en disco: no se pueden registrar
    ventas." / "The box is out of disk space: sales cannot be recorded."
  - `clock.unusable` (error) and `clock.disagrees` (warning), §4.5.
  - `reader.offline` (warning): "{reader} está sin conexión." / "{reader} is offline." — the check
    already gets this answer and ignores it (§2.4).
- **The Box status page** (picture 4), under Ajustes, one row per part: Ventas, Hacienda, Copia en
  el bucket, Impresoras, Lectores de tarjeta, Reloj, Espacio en disco. Each row has a dot, one line
  of state, one line of detail, and one action. It reads the existing `GET /api/box/status` plus the
  printer, reader and disk checks. Two actions are new:
  - **Reintentar ahora** sends the waiting records at once instead of at the next scheduled try.
  - **Liberar espacio** deletes only what the box can make again (§4.6) and says how much it freed.
- **Email.** The red conditions — disk full, reserve in use, clock unusable — email everyone with
  `system.manage` and an email address, once per episode. This follows the owner's A795 answer of
  2026-10-18 (Q3 "A": email the managers as the AEAT certificate nears expiry), the first and only
  box-health email so far. "Once per episode" is held in memory: a restart during an episode may
  send one more, which keeps the build free of a new table (§7).

### 4.4 Part by part: the bucket stream, the outbox, printers, card readers

- **Bucket stream.** No change for staff: they cannot act on it and sales continue. The Box status
  row shows its lag and links to Backups. No email: the owner's posture accepts losing the un-copied
  tail (memory `cold-recovery-no-hot-failover-posture`, 2026-08-29), and the six alerts already exist.
- **Outbox.** The blue strip (§4.2) is the legal duty. The Box status row shows the unsent count,
  the last accepted record and **Reintentar ahora**. The dashboard's own thresholds (4 h, 24 h) stay.
- **Printers** — question 2. Today's per-table banner stays either way.
- **Card readers.** No new staff notice: the payment form already says when the reader does not
  answer, and "Otro datáfono" and cash are the ways on (A796). The manager gets `reader.offline`.

### 4.5 The clock

- **Detect, with no terminal and no internet.** Three checks, each cheap:
  1. **The record before.** A clock earlier than the chain's last record by more than a minute is
     wrong for certain.
  2. **The devices.** Every till request carries the device's own time (phones and tablets set
     their clocks from the network). When the devices that spoke in the last few minutes agree with
     each other and the box differs from them by more than a minute, the box is wrong.
  3. **AEAT**, as today, whenever something is sent; and `timedatectl` where the box image provides
     it.
- **Unusable** means a time the fiscal library refuses (before 28-10-2024): no record can be
  written, so sales stop. Then the red strip, the named refusal and `clock.unusable` with an email —
  unless question 3 lets the box correct its time.
- **Wrong** means any of the three checks finds the box more than a minute out, the accuracy the
  Orden asks for, art. 7.f (memory `verifactu-submission-delay-tolerance`, researched 2026-07-18).
  Records can still be written, so sales continue; `clock.disagrees` goes to the manager only, and
  question 3 decides whether the box also corrects its time.
- **What the box does about it** is question 3.
- **The box image (B3)** should run time synchronisation; that belongs to the image, not this design.

### 4.6 The disk

1. **Report a full disk as itself, and never commit half a transaction** (store). When a statement
   fails and the engine has already ended the transaction (`DatabaseSync.isTransaction` is false),
   the write queue rethrows the original error instead of issuing its own rollback, and refuses any
   further statement in that body. This removes both measured behaviours of §2.6 for every write
   path at once, so no audit of catch blocks is needed. The engine's code 13 becomes the domain error
   `storage.disk_full` at the error boundary and at start (`boot-failure.ts`).
2. **A free-space watch** every minute on the venue folder's disk (`apps/server/src/free-bytes.ts`
   already reads it): `storage.space_low` below 2 GiB free.
3. **A reserve** — question 1. A file of 1 GiB kept in the state folder, which the box deletes to
   buy time.
4. **Liberar espacio** deletes only what can be made again: backup staging leftovers, crash reports
   older than a week, rotated log files except the newest, and the side file folded back
   (`checkpointTruncate`). It never touches a backup the owner configured, the database's rows, or
   anything fiscal. If that is not enough, the page says so: the box needs a bigger disk, which is
   the installer's job.
5. **The till's refusal** for `storage.disk_full` is the one in §3, not "try again".

### 4.7 The recovery page (picture 5)

Only for a box that will not start. Two additions:
- **A code of its own**, `storage.disk_full`, with fixed text in both languages chosen by the code,
  as the house rule requires (CLAUDE.md §3): "El disco del equipo está lleno, así que Waitron no
  puede registrar nada." and, as the action, "Pulsa «Liberar espacio y arrancar»: el equipo usa el
  espacio que guarda de reserva, borra solo lo que puede volver a crear (restos de copias, informes
  de fallo) y arranca. Si no basta, pide a quien instaló este equipo un disco mayor. Tus ventas no se
  tocan." The page also shows the free space, read with `statfs` like the rest of the page's facts.
- **One new button**, "Liberar espacio y arrancar". The page has no login, so the button may do only
  what is harmless whoever presses it: release the reserve and delete the leftovers of §4.6 item 4
  that need no database (staging, crash reports, old logs), then retry the start. It never suggests
  wiping, in line with the page's standing rule (`recovery-surface.ts:230-232`, owner 2026-09-10).

---

## 5. The module-contract question

The deleted node-containers design (`git show ceecfdc1e^:docs/superpowers/specs/2026-09-08-node-containers-design.md`,
§9.1) handed this item "a degraded-but-trading mode and the module-contract field it needs": a fact
each module declares, whether a till can sell without it. Its reason was a "safe mode" that switched
off every toggleable module, which would turn off identity, credentials and payments and could not
sell.

**This design does not need the field, and leaves it out.** From today's code:

- **The failures here are of parts, not modules.** The bucket stream, the outbox, printers, card
  readers, the clock and the disk are each owned by one place that already reports through alerts
  (`apps/server/src/alert-sources.ts`; `packages/fiscal-verifactu/src/submission-alerts.ts`;
  `packages/module/src/alerts.ts:35-42`). Which of them stops a sale is a fixed list (§3), not
  something a module can change.
- **A module never fails while the box trades in a way a flag could isolate.** Modules have no start
  or stop hook; their only runtime hook is `routes.mount`, called once at start in a plain loop
  (`boot.ts:1898`; `packages/module/src/module.ts:88-90`, `:1462-1518` lists every field and none is
  about health). A throw there fails the whole start, deliberately (`boot.ts:767-770`: "A host that
  boots half-configured and retries in the background is a host whose operator believes it is
  working.").
- **Modules are compiled in.** `ALL_MODULES` is a static list (`packages/composition/src/modules.ts:106`),
  so a bad module arrives with a bad image, and the fix is the image, not a mode.
- **The tiers still do not answer the question**, as the old design said: `identity`, `credentials`
  and `payments` are `toggleable` (`modules.ts:153-155`, `:198-200`, `:226-228`).

**What replaces it:** §3's table, owned by this design, and one server-side function that decides
whether a sale can be recorded now (disk, clock), which feeds the red strip. If modules ever become
installable while a box runs, "start without the module that just failed" becomes worth building,
and that is when the field earns its place (§10).

---

## 6. Defaults taken from earlier owner decisions

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
5. **Product text as short as the meaning allows** (owner 2026-10-09, memory `concise-product-text`):
   hence "12 ventas sin enviar a Hacienda" rather than a sentence about the law.
6. **Every device that sells gets the strip**, tills and handhelds alike: "any paired device can do
   everything" (owner 2026-10-03, memory `any-device-does-everything`).
7. **Email the managers for the red conditions**, as for the AEAT certificate (owner 2026-10-18,
   A795 Q3 "A", recorded in `~/waitron-campaign-shared/watcher-handoff.md`, 13:06 entry).
8. **The unsent count on screen** follows the law, not a preference: Orden HAC/1177/2024 art. 16.4,
   as read in `docs/compliance/verifactu-findings.md:345-360`.
9. **The typed card is "Otro datáfono"**, an explicit choice (owner, A796 Revision 4, §8 default 3).

---

## 7. Storage and migration

**No migration.** Everything new is either worked out when asked or held outside the database:

- Notices, the Box status rows and the new alerts are computed on each read, like today's ongoing
  alerts (`packages/module/src/alerts.ts:6-7`).
- The reserve is a file in the state folder, not a row.
- "Once per episode" for emails is held in memory (§4.3). Making it survive a restart would need a
  table like the certificate reminders' (`packages/fiscal-verifactu/src/schema/certificate-reminders.ts`),
  and so a migration; this design does not ask for that.
- The clock's device comparison is kept in memory, like AEAT's comparison today
  (`time-health.ts:48-58`).

If the owner's answers change any of this, the plan says so before building.

---

## 8. Build slices

Smallest first; each names the risk triggers it touches (CLAUDE.md's review-weight rule).

1. **The store reports a full disk as itself and stops after an ended transaction**
   (`packages/store/src/write-queue.ts`, the adapter's nested transactions, `boot-failure.ts`, the
   error boundary). Tests: a small database at its page limit, through the real write queue, both
   shapes of §2.6, plus the unique-key control. Updates CLAUDE.md §3's refusal rule to name the
   exception. _Risk: concurrency, cross-package contract, fiscal invariants (the sale path)._
2. **The till names the two red refusals** (`storage.disk_full`; `fiscal.record_invalid` caused by
   the minimum date), and says when a card was charged first. _Risk: fiscal invariants (the settle
   handlers), cross-package contract (a refusal's params)._
3. **Free-space watch, reserve, `storage.*` alerts and the recovery page's code and button.**
   _Risk: auth (an unauthenticated action), concurrency (a duty that deletes files)._
4. **The strip**: notices in the `/api/menu-state` answer and the strip in the till, starting with
   the red notices and the unsent count. _Risk: cross-package contract (till ↔ box), fiscal
   invariants (reads the outbox)._
5. **Box status page** and **Reintentar ahora** / **Liberar espacio**. _Risk: auth (`system.manage`),
   fiscal invariants (nudging the drain)._
6. **Clock checks** (record before, devices, `clock.*` alerts), then question 3's answer. _Risk:
   fiscal invariants (record timestamps)._
7. **Emails for the red conditions.** _Risk: none listed._
8. **Printer notice** (question 2) and `reader.offline`. _Risk: none listed._

---

## 9. Questions for the owner

Three, one at a time. Each has a recommendation; the pictures are in the mock-ups folder.

### Question 1 of 3 — When the disk fills, should the box free its reserve space by itself?

_Example._ Friday 22:10, Bar Santet. The box's disk has been filling for weeks with photos and
backups nobody cleared, and it runs out mid-service. Without a reserve, the next sale is refused and
every till turns red until someone frees space (picture 1). With a reserve, the box keeps 1 GB
spare that nothing else may use.

- **(a) Recommended: yes, by itself.** When free space runs out, the box deletes the reserve at once,
  sales carry on, the tills show "Queda poco espacio en el equipo · Avisa al encargado", and the
  managers get an email. Service is not interrupted; someone frees space before the reserve runs
  out too (picture 2 shows the tones; picture 4 the page).
- (b) Keep a reserve, but release it only when a manager presses a button on the Box status page or
  the recovery page. Sales stop until someone does.
- (c) No reserve: only the early warning at 2 GB left and the email.

Why (a): the owner's rule is that being unable to trade is not accepted; (a) is the only option in
which a Friday night is never stopped by a full disk.

### Question 2 of 3 — Who is told when a printer goes down?

_Example._ 21:14, the Cocina printer's cable is knocked out. Ana sends Mesa 4's starters; two
minutes later her table screen shows "Un ticket de cocina no se ha impreso: Cocina". Marc, at the
same moment, sees nothing and sends Mesa 7's mains to the same dead printer (picture 7).

- **(a) Recommended: every device.** While a kitchen or bar station's printer is down, every till
  and handheld shows the amber strip "Impresora Cocina sin conexión desde 21:14". A receipt printer
  that is down shows only on the devices whose receipts go to it. Today's table banner stays.
- (b) Only the device whose ticket did not print, as today.
- (c) Every device, but only once a printer has been down for five minutes, to ignore short
  hiccups.

Why (a): the person who can fix the cable is rarely the one whose ticket failed, and every waiter
sending food needs to know to walk to the kitchen.

### Question 3 of 3 — When the box's clock is wrong, may it correct its own time?

_Example._ After a power cut, the box starts with its clock on 1 January 2001 and the internet is
down. Today every sale is refused with a message about billing data (picture 6, left).

- **(a) Recommended: yes, from a trusted source.** The box takes the time from AEAT's last answer or,
  with no internet, from the devices' clocks when they agree with each other, and stamps sales with
  that. Sales continue; the managers get an email; the Box status page shows "Reloj: corregido
  (2 h 14 min de diferencia)" until the box's own clock is fixed.
- (b) No. A clock the fiscal library refuses (before 28-10-2024) stops sales with the clear message
  of picture 6 (right) until someone fixes it, and the managers get an email. Any other wrong clock
  keeps selling with its wrong time and a warning to the manager.

Why (a): the time a phone gets from the mobile network is far closer to right than a clock that
says 2001, so the corrected time is the more accurate record, and the venue keeps trading. A
corrected time is never earlier than the last record. The till-side trusted clock built earlier
(`packages/fiscal/src/clock.ts`, sources "upstream" and "authority") shows this was the intended
direction. If the owner would rather have the gestor or asesor confirm it first, (b) is the safe
interim answer.

---

## 10. What this design does not cover

- **Failover.** A dead box or a cut network to it is not "degraded but trading": no node sells.
  Promotion to a standby is the replication work (`docs/backlog.md` → _Replication, membership &
  failover — residuals_).
- **Starting without a module that fails at mount**, and the module-contract field it would need
  (§5): only worth building once modules can be installed on a running box.
- **Restore, reset or image rollback from the recovery page** — separate backlog entries
  ("Resetting a box without a terminal", "Automatic upgrades that can be undone until the first
  order").
- **Time synchronisation in the box image** and the HTTPS certificate minted before the clock is set
  (B3; `docs/backlog.md:5076-5077`).
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
   (`@waitron/verifactu/dist/xml/serialize.js:365`). (read)
2. **CLAUDE.md §3's refusal rule is wider than the engine** for a full disk (§2.6, measured).
   Slice 1 corrects it; it is noted here so a session before then does not lean on it.
3. **A drawer kick for a USB or Bluetooth printer that is not connected stays queued with no
   expiry**, so the drawer could open whenever that printer reappears (read:
   `packages/printing/src/runtime.ts:80-83`, `:102`; no age limit found).
4. **SumUp treats any HTTP status of 400 or above, 5xx included, as a definite decline**
   (`packages/payments-sumup/src/sumup-client.ts:172`). (read; not tried)
5. **Corrected reading:** a search helper reported that deleted images keep their bytes. They do
   not: `media_image_data` rows go with their image (`packages/media/src/schema/images.ts:40-44`,
   `onDelete("cascade")`). Not used above.

---

## 12. Experiments run for this design

All in a scratch folder outside the repository (`mktemp -d`); nothing was committed.

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
