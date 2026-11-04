> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Background jobs — a rationalised design

Cites read against `main` at `e0da0ad18a` (4 November 2026). Every claim about current code cites `file:line` or names the grep
that was run. Everything is read, not run, unless a sentence names a test. "Pass" means one run of a job; "wake" means cutting a job's sleep short because something
already knows there is work.

## 1. The target picture

**Today** the server runs about twenty background duties, built at least four different ways:

- a `while (!signal.aborted) { pass; sleep }` loop over `realSleep` (`attendance-loop.ts:56-72`,
  `invoice-email-worker.ts:25-44`, `certificate-reminder-worker.ts:29-40`, `attendance-email-worker.ts:37-47`,
  `tender-refund-recovery.ts:130-150`, `backup-supervisor.ts:328`, `fiscal-reconciliation.ts:25-39`);
- the same loop over `delay` from `node:timers/promises` (`cloud-worker.ts:11-20`, `cloud-snapshot-loop.ts:8-23`,
  `content-suggestion-runner.ts:191-197`);
- a self-re-arming `unrefTimer` (`box-alert-email.ts:444-448`, `free-space-watch.ts:92-120`,
  `clock-watch.ts:442-446`, `append-only-watch.ts:93-109`, `menu-activation.ts:59`);
- `runLoop` (`loop.ts:54-92`), used twice: for the fiscal-and-Stripe pass (`boot.ts:3533`) and for the card loop
  (`pending-card-recovery.ts:19`). Plus a raw `setTimeout` (`demo-printer.ts:220`) and a raw `setInterval` (`tls.ts:41`).

Each loop has its own idea of when to back off, whether it checks the box's role, and how it reports. Only two
duties feed `/health` (`DUTY_BUDGET_MS`, `health.ts:25-28`). Most of the others only log on failure. Six
duties check "am I the primary?" once at start and never again: the two working-time loops (`boot.ts:2362`),
card refund recovery (`boot.ts:3636`), the tunnel (`boot.ts:3302`), backups (`backup-supervisor.ts:260-264`,
checked only on `reload`) and the bucket copy (`stream-host.ts:136-139`, checked only on `start`). A local
second box is promoted in-process with no restart (`promote.ts:124-129`, `refreshDeploymentHolders` at 176), so
it gets some duties at once and the others only after a restart. They stop one at a time in sequence
(`close-all.ts:5-15`). The 26 closers, and the seven stop signals sent before them, are listed in one
place, `backgroundDuties` (`background-duties.ts:86-224`), and stopped by `stopBackgroundDuties`
(`background-duties.ts:230-245`, wired at `boot.ts:3765`). Fiscal reconciliation's closer exists only when the
fiscal module offers that pass (`background-duties.ts:152-160`). All of it runs inside an 8-second shutdown deadline
(`run-server.ts:31`). Closers counted by `awk 'NR>=87 && NR<=208' apps/server/src/background-duties.ts | grep -c 'name: "'`: 26.

**A1018 adds a second way to stop: the stepdown** (from #2420, #2436 and #2417; read, not run). A box that hands over to another box, or learns it has been superseded, steps
down in-process (`stepDown`, `handover-stepdown.ts:68-101`). It closes the request gate to everything except
health, node status, peer status and handover reads (`handover-stepdown.ts:19-26`). It sends all seven stop signals and runs
the six closers marked `atStepdown` at once: certificate diagnosis, fiscal reconciliation, menu activation, box alert emails, the
demo printer and the clock watch (`handover-stepdown.ts:171-191`; the marks are at
`background-duties.ts:113, 158, 161, 174, 200, 201`). Every other closer carries a written `reason` for waiting until
the close (`background-duties.ts:81-84, 88-207`). It writes a `node_handover_restriction` row before it answers,
except for a supersession learnt from a chart that names no successor, which writes none
(`apps/server/src/handover-stepdown.ts:89-98, 116-119`). Then it waits up to 180 seconds for requests already admitted
(`HANDOVER_ADMITTED_WORK_LIMIT_MS`, `handover-stepdown.ts:17, 193-196`), runs the normal close within the
8-second shutdown deadline, and restarts the process (`handover-stepdown.ts:197-218`). So backups, the bucket
copy and the tunnel are not stopped at the signal: they keep running until that close. Two new start modes
start none of the full start's duties; each still starts the `waitron.local` responder (`boot.ts:1793, 1881`):

- a box holding a restriction row starts **restricted**, before every worker, with `/health` reporting that it
  takes no sales (`boot.ts:1767-1818`; `health.ts:48-49, 150`);
- a box whose start-up peer check finds no joined box answering starts **waiting** (`boot.ts:1821-1838`;
  `waiting-start.ts:84-88`). It asks again every 15 seconds on a self-re-arming `setTimeout` (`WAIT_RECHECK_MS`,
  `waiting-start.ts:19, 186-207`) until a peer answers or an administrator carries on. Its code says that
  re-ask is the only thing it runs in the background (`waiting-start.ts:173-175`).

**The clean version** has **one job runner** in the server. Every recurring server duty is declared to it as a
small record: its name, when it applies (re-checked on every pass), its pass function, which data changes wake
it, its shortest and longest sleep, its back-off after a failure, and its health budget. The runner owns
everything those loops each wrote by hand. It gives every job its own loop, so a slow call to the tax agency
cannot hold up an invoice email. It re-checks the role before every pass, wraps every pass so a throw never
ends the job, and backs off on failure. It wakes a job when the in-process change feed reports a change
the job cares about. It records every job's state for `/health`, and it raises one alert while any job keeps
failing. It also starts and stops everything together: jobs stop in parallel first, then the long-running
services, and the bucket copy stops last because it writes `venue.db`. The parts already exist: `runLoop`'s
contained pass and floor/ceiling sleep (`loop.ts:13-22, 54-92`), `createLoopWaker`'s wake
(`loop-wake.ts:11-56`), `attempt`'s never-rethrow wrapper (`pass.ts:165-194`), `recordPass` and budgets
(`health.ts:81-143`), and the change feed, which already wakes one job (`menu-activation.ts:12-84`).

**Jobs stay in the web server's one program, and the bench decides what moves out** (owner, 2026-11-04). The
reasons:

- **A second process can freeze the server.** `node:sqlite` calls are synchronous, and the store waits out a
  locked database with `busy_timeout` (`packages/store/src/index.ts:180`), so waiting for a lock another process
  holds stops this process's only thread. Test, 4 November 2026 (a stand-in script on `node:sqlite`, Node 26.13):
  another process held the write lock for 3 s and froze this process's timer for 3,003 ms, against 51 ms in the
  control. Inside one process a job waits its turn in an asynchronous queue (`createWriteQueue`,
  `packages/store/src/write-queue.ts`), so waiting for the lock does not stop the thread.
- **The change feed stops at the process's edge.** A write made by another process does not reach this process's
  listeners (`packages/db/src/change-log.ts:5-12`), so a job moved out could not be woken by a change, and what it
  wrote would not reach open screens.
- **One process owns a venue folder at a time** (CLAUDE.md §3).

**Heavy read-only work and the backup copy can use a worker thread; writes stay on the main thread** (owner,
2026-11-04). A worker thread lives inside the same program, with its own database connection, so none of the
reasons above apply to it. Test, 4 November 2026 (stand-in scripts, `node:sqlite` on Node 26.13, a 190 MB database of
4 million rows in write-ahead mode, a small sale write every 20 ms). Longest gap in the main thread's timer:

| Work | On the main thread | On a worker thread |
| --- | --- | --- |
| Heavy read | 1,353 ms | 21 ms |
| `VACUUM INTO` (how the backup copy is taken) | 385 ms | 21 ms |
| Big write | 264 ms | 255 ms |

A big write gains nothing from a worker: the sale write on the main thread still waited 255 ms for the lock. Not
yet tried through the real store, or on the reference micro PC. Today the backup copy runs on the main thread:
`archiveTo` is one synchronous statement (`packages/store/src/archive.ts:24-34`). Measure 9 decides what actually moves.

**What A1018 asks of the runner** (read, not run). Each job's
record also says whether it stops at a stepdown or, if not, why it may keep running until the close. That is
the `atStepdown` mark or the `reason` each closer already carries (`background-duties.ts:8-13`); the guard
"every closer is either atStepdown or carries a reason" in `handover-stepdown.test.ts` would move to the job
records. The runner gives a stepdown two stages: signal (every job's stop signal plus the `atStepdown` stops,
`handover-stepdown.ts:171-191`), then the ordinary stop once admitted requests have settled
(`handover-stepdown.ts:193-203`). It starts no job at all on a box that holds a restriction row, which today is
done by returning the restricted start before any duty is built (`boot.ts:1816-1817`). The waiting start's
15-second re-ask and the start-up peer check run before the full start builds any duty (`boot.ts:1821-1838`),
so they stay outside the runner, like the folder heartbeat.

**Waking replaces most polling.** The change feed is in-process and generic. Every table a module classifies
gets triggers that write a change row inside the writing transaction. `withTransaction` delivers those rows
after the commit (`tenancy.ts:30-42`; `change-feed.ts:103-133`; `packages/db/src/classification.ts:281-289` excludes only
`change_log`, `node_sealed_state` and `recovery_packs` from core). So `sales`, `invoice_deliveries`,
`print_jobs`, `payments`, `payment_refunds` and the attendance tables already produce wake signals today; the
background jobs just do not listen. The fiscal outbox wakes on a new `sales` row. Its own flow-control gate
(`drain.ts:220-255`, `envio_flujo.proximo_envio_en` today, `verifactu_sending_state` in the target) still decides whether to send, so a wake can never
break AEAT's wait-between-sends rule. A long fallback poll (the existing 1-hour ceiling) stays as the safety
net, because a write made by another process does not reach this process's listeners (`change-log.ts:5-12`).

**One mail sender, one queue.** Today mail leaves the box five ways in the background: invoice emails,
missing-times emails, certificate reminders, box alert emails and the password-reset send. A person's request
also sends two kinds directly and waits for the result: invitations (`management-api.ts:1147, 1169, 1253, 1274`,
whose answer tells the screen `invitationSent`) and email-change messages (`me-api.ts:174-176`). They use two separate SMTP builders
(`invoice-email.ts:85`, `smtp-send.ts:43`). In the target there is one `mail.send` job, one transport and one
place that decides real SMTP versus the practice inbox. That place keeps today's two rules: `resolveEmailDelivery` for account and notice mail, and
`resolveInvoiceEmailDelivery`, which sends invoice mail to the practice inbox on a Demo or development box even when SMTP is set
(`email-delivery.ts:16-41, 43-52`).

`outgoing_mail` is the only queue and `mail.send` drains it alone. `invoice_deliveries` is a record only (owner,
2026-11-04): it says which invoice went where and how that ended, and the on-screen status reads it. An emailed
invoice is an `outgoing_mail` row and an A4 print is a `print_jobs` row. The columns are drafted in §2. Whether the two request-bound sends join the
queue is open (§6, question 1).

- **The rules a queued mail keeps.** A producer writes its row in the same transaction as the thing that caused
  it. The sender's claim commits before SMTP starts, and it calls the kind's own code in that transaction to word the mail and check that it
  is still wanted, as the missing-times sender does today (`attendance-email-worker.ts:66-110`). A `rejected`
  mail is tried again with back-off. A mail whose outcome is `unknown`, or whose claim a crash left behind, is
  never sent again automatically. All three of today's senders already stop there (`attendance-mail.ts:62-77`,
  `invoice-delivery.ts:260-273`, `fiscal-verifactu/src/certificate-reminders.ts:54-56`).
- **Every queued mail has a "don't send after" time** (owner, 2026-11-04), the `not_after` column. At claim, a
  row past its time becomes `expired` and is never sent. This answers the restored backup: the queue comes back
  as it stood when the backup was taken, and a password reset or alert from then is past its time. A row still
  inside its time can go out a second time; for a notice that is harmless, and a restored reset goes out with a new link. Measure 11 tests it.
- **The password reset is still answered before any lookup.** The route answers 202 first and does the lookup
  afterwards, so a known address answers as fast as an unknown one (`management-api.ts:949-966`). That order stays.
  The background step after the answer writes the row for a known account. So for this one mail the row is not in
  a transaction with its cause, because the cause is a request with no transaction; a crash in that moment loses
  the request and the person asks again. The row holds no link: the sender makes the link when it sends, so a
  live login is only ever stored as a hash (CLAUDE.md §3). The unknown-address path keeps a write of its own
  (`writeAndRemoveDecoyAction`, `packages/identity/src/account-action.ts:362-364, 382`), so that its commit still looks like a known address's
  commit; it has to be rewritten to match the new statements.
- **The full-disk mail is the one mail that cannot be queued.** A full disk refuses the insert, and the claim
  that must commit before SMTP. So when R7 sees the disk full it sends that mail directly through the same
  transport and writes nothing, which is how every box alert goes today (`box-alert-email.ts:373-379`). A restart
  can still lose that one mail. Reasoned, not run: measure 12.

**One backup service with several backends** (owner, 2026-11-04). Today there are two services. Scheduled backups
build one archive and write it to every `StorageBackend` the venue set up, which today means `LocalFsBackend` and
`S3Backend` (`storage-backend.ts:37-56`, `backup-backends.ts:7-23`, `backup-sweep.ts:273-296`). Cloud snapshots go
round that interface. They have their own loop, worker and staging folder (`cloud-snapshot-loop.ts`,
`cloud-snapshot-worker.ts`, `cloud-snapshot-archive.ts:29`), read the whole archive into memory
(`cloud-snapshot-archive.ts:43-46`), and yet build the same archive: `buildManifest`, `collectStateParts`,
`assembleArchiveEntries`, then encryption, as the sweep does (`backup-sweep.ts:195, 216, 265, 273`).

In the target `backups.scheduled` (R12) is the only backup service, and `cloud.snapshots` stops being a job of its
own. Each run makes one archive and stores it on every backend through `StorageBackend`:

- **a local drive**, as today;
- **your own S3**, as today. It stays offered: its setup is too complex for most restaurants, so offering it
  does no harm (owner, 2026-11-04);
- **Waitron Cloud, the main target.** How Cloud stores things is hidden from the person using it: no bucket,
  region or storage keys on screen. Its backend may reuse the S3 code underneath, as the upload already does
  (`cloud-backup-upload.ts:6`). It stays off real venues until Cloud's service is ready: the code refuses
  anything but a test connection (`cloud-snapshot-worker.ts:179`, `cloud-client.ts:357-360`), and Cloud's own
  backlog says snapshots "remain unavailable in the delivered deployment" (`waitron-cloud/docs/backlog.md:398`);
- **others later**, such as Google Drive.

Waitron Cloud differs from the other backends in three ways, and the service has to handle each:

| Difference | Local drive and own S3 | Waitron Cloud | What the service does about it |
| --- | --- | --- | --- |
| **The key** | The box's backup key (`deps.recoveryKey`, `backup-sweep.ts:276`) | A key Cloud issues with each upload (`grant.recoveryKey`, `cloud-backup.ts:20`) | The sweep encrypts once for all destinations today (`backup-sweep.ts:273-278`). It has to encrypt once per key, reusing the one staged copy. A1323's master key has to meet Cloud's plan to recover "without a saved owner key". |
| **Temporary upload permission** | Saved settings, with the bucket's secret sealed | Each upload asks Cloud for permission and receives storage keys that expire, then publishes the finished upload (`reserveCapture`, `publishCapture`, `CloudCaptureGrant`, `cloud-backup.ts:13-23`) | Cloud's backend does reserve, upload and publish inside `putFile`. The finishing of a capture cut off between upload and publish (`cloud-snapshot-worker.ts:222-236`) moves into that backend. |
| **Who deletes old copies** | The box, after each upload (`pruneBackend`, `backup-sweep.ts:296`) | Cloud: daily for 30 days, monthly for 12 months, longer paid (`waitron-cloud/docs/backlog/decisions-in-progress.md:15`). The box only labels each capture daily or monthly (`cloud-snapshot-worker.ts:271`) | A backend says whether the box prunes it, and Cloud's says no. `StorageBackend` also requires `list`, `get`, `getFile`, `delete` and `deleteMany` (`storage-backend.ts:38-55`), and the upload grant gives none of them, so that part of the interface becomes optional or Cloud's status comes by its own read. Left to the builder. |

Two limits stay. Cloud itself refuses anything over 512 MB (`waitron-cloud/packages/backups/src/catalogue.ts:223`,
`waitron-cloud/packages/backups/src/object-transfer.ts:9`), so moving onto the sweep ends the read into the box's memory but not that ceiling; measure 13
compares it with a year's archive. And R14's near-live copy is a separate thing: "Restore from my bucket" and the recovery pack
rest on it, so it stays. The box's side of Cloud's own continuous copy was not traced: a search of `apps/server/src` and `packages/stream` finds only the
service name `continuous_backup`. Waitron must still work entirely on-premises with no Cloud (owner, 2026-10-23).

**Browsers hold one live connection per open device** (the dashboard already does: `live-connection.ts`).
Re-reads on a timer happen only while that connection is down. Tills and kitchen displays get the same kind of
event stream, generalised from the one they already open for department transfers
(`department-transfer-api.ts:113-178`). The server starts publishing the in-memory states nothing publishes
today (see J7 below). The till's connection is built after the runner (owner, 2026-11-04), with two additions:

- **A till at a one-box venue stops checking for other boxes while connected. With more than one box, checking
  stays exactly as it is today.** A till can tell which it is from the list of boxes it holds (`setServers`,
  `server-router.ts:96`, fed at `till-app.ts:4372`). Stopping everywhere would lose something: on every check, a
  till hands the newest chart of boxes it holds to a box that is behind (`#handChart`,
  `server-router.ts:190, 202-226`), and a box can learn from that chart that it has been superseded. Read, not run.
- **About 30 seconds with no keepalive counts as down.** The server sends a keepalive every 15 seconds
  (`live-api.ts:136`, `department-transfer-api.ts:140`). The browser's own connection cannot be relied on to
  notice a dead box, by the second test below. The dashboard's `LiveConnection` has no such rule (grep finds no
  keepalive check in `packages/dashboard-kit/src/live-connection.ts`), and it needs the same one if its timers
  are to stop while it is connected.

Two tests behind this, 4 November 2026, on stand-ins:

1. **An open stream does not hold up a handover.** A copy of the gate's counting (`handover-gate.ts`) with real
   hono `streamSSE`: an open stream counted 0, and the control, a slow handler, counted 1. So a stream never
   holds the stepdown's 180-second wait, and it stays open through a stepdown until `liveEvents` closes. More
   streams on tills do not lengthen a stepdown.
2. **A silent box looks alive to the browser.** Chromium through Playwright, `EventSource` against a server that
   goes silent with its socket open: `readyState` was still 1 with no error after 45 s. Control, socket destroyed:
   error at once. Silence is what a till should see at a power cut, since no closing packet is sent, but a power
   cut itself was not run (measure 14).

## 2. Target list

### Server: the runner and its jobs

| #   | Target                                             | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Why it must exist                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0  | **Job runner** (new, built from `runLoop`, `createLoopWaker`, `attempt`, `recordPass`) | Runs every job below: re-checks when each job applies before every pass, contains throws, backs off, wakes jobs on change-feed types, records health, raises one `job.failing` alert per job that keeps failing, and stops jobs in parallel and services in order. Two kinds: a **job** (pass → next due time) and a **service** (start/stop/reload, reports status). | One start/stop/report path instead of about twenty. It also fixes the role checked only at start (J4), the log-only failures, and the stop that runs one closer at a time.                                                                                                                                                          |
| R1  | `fiscal.drain` (the fiscal outbox), with the restart reset as its first-pass step | Sends chained records to AEAT. Wakes on a `sales` change and on the manager's "retry now"; ceiling 1 h. | AEAT's hourly retry rule (`drain.ts:68`) and the outbox rule (CLAUDE.md §5). The restart reset is required before the first pass (`restart-reset.ts:14-46`). |
| R2  | `payments.reconcile`                               | Once a day, compares each card provider's settlement with local payments: Stripe today, SumUp planned (A949). `packages/scheduler`, which serves nothing else, folds into `packages/payments`, keeping `runDue` (`run.ts:69`), and its `scheduled_runs` rows become `reconciliation_runs` (owner, 2026-11-04). Each provider keeps one stable key on those rows, `payments.reconcile.stripe` today. | Money that never settled is otherwise invisible. The ledger's per-day retry and parking need durable rows; the key must not change (`duty.ts`, "changing it orphans that duty's history").                                                                                                                     |
| R3  | `card.follow_up`                                   | One job with five steps: the provider outcome sweep, recovery of paid-but-unrecorded sales, release of stale "payment in progress" marks, pending bill payment and refund settlement, and refund recovery on finished sales. Both refund steps read the one `refunds` table, and a card payment's resolution and hold are columns of `payments` (owner, 2026-11-04). Each step says which roles it runs on: the sweep and the release on every trading box (`boot.ts:548-550`), the rest only on the primary. Each box's sweep resolves only the payments it owns, plus rows naming no box while it is the singleton primary (`sweepOwners`, `boot.ts:540-546`), read on every pass (`boot.ts:553-555`); the step keeps that. Wakes on `payments`, `payment_refunds` and `refunds` changes; next due is the earliest any step reports; fallback 60 s. | A card charged with no recorded sale, or a refund nobody followed up, is money wrong at the till.                                                                                                                                                                                                                                          |
| R4  | `attendance.end_of_day`                            | Processes finished working days. Next due is the earliest due work row or the next end of day; wakes on changes to `attendance_day_work`.                                                                                                                                                                                                                                                                                                                                                                                                                     | Spain's working-time record is a legal duty from launch day (auto-memory: workforce scope).                                                                                                                                                                                                                                       |
| R5  | `mail.send`                                        | Drains `outgoing_mail`, the only mail queue, with one transport, one practice-inbox router and one retry policy. Wakes on inserts. Never sends a row past its `not_after`. Told to stop at a stepdown's signal; a send already under way finishes, because SMTP may already have accepted it (`invoice-email-worker.ts:40`). | Every queued email the box sends goes through it.                                                                                                                                                                                                                                                                                  |
| R6  | `fiscal.certificate_reminders`                     | Decides when a certificate crosses a reminder threshold and queues mail (`outgoing_mail`, keyed to the certificate, the threshold and the person, so a mail is never queued twice). Next due is the next threshold.                                                                                                                                                                                                                                                                                                                                         | An expired certificate stops filing silently.                                                                                                                                                                                                                                                                         |
| R7  | `box.alert_mail`                                   | Each minute, reads disk, space, incidents and module notices and queues mail for each new episode. Each mail is keyed to its episode, by its incident id or its notice, so it is queued once. The full-disk mail alone is sent directly (§1).                                                                                                                                                                                                                                                                                                                                                                         | Managers need to hear about a full disk or a stopped backup when nobody is looking at the dashboard.                                                                                                                                                                                                                                       |
| R8  | `menu.activation`                                  | Unchanged behaviour (due time plus wake on a schedule change), moved onto the runner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A scheduled menu must go live on time.                                                                                                                                                                                                                                                                       |
| R9  | `fiscal.tamper_watch`                              | Every 10 s, checks that the append-only triggers are present and unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | CLAUDE.md §5 (the immutability of `verifactu_records`, today `registros_facturacion`). Removing a trigger writes no change row, so this watch has to poll.                                                                                                                                                                                                   |
| R10 | `clock.watch`                                      | Every 15 s.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | CLAUDE.md §5 clock-stop rules.                                                                                                                                                                                                                                                                                         |
| R11 | `storage.free_space`                               | Every minute: low-space state, low-space backup deletion, writing back the spare file, lifting the full-disk stop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Nothing else lifts the full-disk stop (`disk-full-state.ts:45-57`).                                                                                                                                                                                                                                                             |
| R12 | `backups.scheduled`                                | The one backup service (§1). Each run makes one archive and stores it on every backend: local drive, own S3, Waitron Cloud, others later. Next due is the next scheduled time; a settings save wakes it; primary checked on every pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Backups must leave the box (backlog goal).                                                                                                                                                                                                                                                                                  |
| R13 | `backups.sealed_state`                             | Wakes on each `node.db` commit; overlapping requests already collapse into one follow-up (`sealed-state.ts:186-195`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | It is what carries the box's own secrets with every copy of the database.                                                                                                                                                                                                                                                                      |
| R14 | `stream` (service), with its Litestream child process | The bucket copy. The runner starts it and stops it when the role or the settings change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Near-live copy for rebuilding a lost box (cold-recovery stance).                                                                                                                                                                                                                                                       |
| R15 | `cloud.connection`                                 | Every 60 s, only while Cloud is set up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Keeps the registration lease alive.                                                                                                                                                                                                                                                                                       |
| R16 | `housekeeping`                                     | The one daily tidy-up job (owner, 2026-11-04). It deletes what is listed below, in short batches, on the primary. Told to stop at a stepdown's signal. | Each prune the table reviews approved needs one owner; without this job nothing runs them. |
| R17 | `cloud.suggestions`                                | Unchanged (5 s while a job runs, 60 s idle, a manager's start wakes it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | A built feature.                                                                                                                                                                                                                                                                                                                       |
| R18 | `demo.printer`                                     | Demo and Prepare boxes only. Wakes on `print_jobs` instead of a 500 ms poll.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Practice without hardware.                                                                                                                                                                                                                                                                                                                                                                                 |
| R19 | `tunnel` (service), until A951 replaces it         | Only on the primary with a relay set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Its retirement is already planned (`docs/backlog.md:6032-6034`, "`@waitron/tunnel`'s retirement").                                                                                                                                                                                                                                      |
| R20 | `fiscal.reconciliation`                            | New with W41s-10a (#2449). Looks up at AEAT what it holds for each month that has filed records and compares it with this box's own (`reconcile-sweep.ts:24-70`). Only when the fiscal module offers the pass (`createReconciliation`, `packages/fiscal/src/contribution.ts:187`). Primary and filing-enabled, read on every pass (`boot.ts:3525`); next due comes from the pass, at most 60 s ahead (`boot.ts:3527`); stops at a stepdown's signal (`background-duties.ts:158`). | The box's own check that AEAT holds what it filed. It stays apart from R1 and from sales (`contribution.ts:186`). |

**R16 `housekeeping`: what the daily tidy-up deletes.** Each step works in short batches, one transaction each, so
a sale never waits long for the write lock. Its writes stay on the main thread (§1). Measure 10 sets the batch size.

| Step | Deletes | Decided in |
| --- | --- | --- |
| Sign-in challenges | Expired `sign_in_challenges` rows | README U10; `tables-people.md` |
| Dashboard sessions | `dashboard_sessions` rows that ended, or idle past `IDLE_TIMEOUT_MS` (30 minutes); the sign-in and sign-out are in `activity_log`. The mirror viewer's session row is left alone: its keepalive only updates that row, so a deleted row is not recreated until the next start | `tables-people.md` §1 |
| Replaced photo data | `media_blobs` rows that no photo names any more | `tables-menu.md`; README U10 |
| Service commands | `service_commands` records a day after their party or bill closes. **Not switched on until the latest possible till retry is confirmed**, because a record is needed while a retry can still arrive | `tables-ordersales.md` D7 |

Everything else stays out of this job until A980's specialists agree a period (README U10): ended `till_sessions`,
`staff_activity` and print job payloads. `outgoing_mail` is not pruned either: a finished row is what stops the same
mail being queued twice (§6, question 3).

### Draft: the `outgoing_mail` table

No appendix had a column design for this table, so this is a draft, and the tables list needs to give it a home. Core
set (U4; a service every module uses, the stated reason CLAUDE.md §3 asks for). `state`, not append-only: it is an
outbox, as `invoice_deliveries` is classified today (`packages/db/src/classification.ts:172-176`). A change source,
which is what wakes R5.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | id | Primary key |
| `kind` | enum | `invoice`, `attendance_question`, `certificate_reminder`, `box_alert`, `account_action`. Each kind has one owner, which words the mail and receives the outcome |
| `dedupe_key` | text | Not null, unique. What makes "never queued twice" hold: `attendance:<question>`, `certificate:<install>:<stage>:<person>`, `alert:<episode>:<person>`, `invoice:<delivery>`, `account:<action request>` |
| `subject_id` | id | Null. The row the mail is about: the invoice delivery, question, certificate or incident. A plain id, not a foreign key, because core cannot key into a switchable set (U1) |
| `person_id` | id | Null, FK → `persons`. Who it goes to. Null only for an invoice, which goes to the customer's address |
| `recipient` | text | Null. The address. Written at claim, as `attendance_mail` does, so a queued row holds no address until it is being sent, except an invoice's, which the customer gave for this one mail |
| `params` | JSON | Not null, default `{}`. What the wording needs and cannot read from the subject when sending. Never a row id (R4), a secret or a link |
| `status` | enum | Not null, default `pending`: `pending`, `sending`, `sent`, `rejected`, `unknown`, `expired`, `cancelled` |
| `attempts` | count | Not null, default 0 |
| `next_attempt_at` | ts | Not null |
| `not_after` | ts | Not null, CHECK after `queued_at`. The "don't send after" time |
| `claim_token`, `claimed_at` | id, ts | Both null or both set |
| `failure_code` | text | Null. A fixed code, never a provider's words, which can echo credentials (`management-api.ts:198-199`) |
| `queued_at` | ts | Not null |
| `finished_at` | ts | Null |

**Indexes:** `outgoing_mail_key_uq` unique on `dedupe_key`; `outgoing_mail_due_idx` on `(status, next_attempt_at, id)`.

**Where today's protections go (R9):**

| Today | In `outgoing_mail` |
| --- | --- |
| `attendance_mail_question_uq`, `fiscal_certificate_reminders_uq` | `outgoing_mail_key_uq` |
| `attendance_mail_due_idx` | `outgoing_mail_due_idx` |
| `attendance_mail_status_ck`, `fiscal_certificate_reminders_status_ck` | A status CHECK over the one list |
| `fiscal_certificate_reminders_stage_ck` | The stage is checked by the reminder code that builds the key. A stage can no longer be refused by the database: **dropped, with this reason** |
| `attendance_mail_outcome_ck` | Gone with the column: `status` already holds the outcome |
| `attendance_mail_claim_ck` | The same CHECK on `claim_token` and `claimed_at` |
| `attendance_mail_sending_ck` | The same CHECK: `sending` needs a claim and a `recipient` |
| Foreign keys to `attendance_questions` and `fiscal_certificate_installs` | **Dropped** (U1: core cannot key into those sets). The kind's own code reads the subject at claim; a missing subject makes the row `cancelled` |

**Rules each kind needs from the queue** (read, not run):

- A failed mail is tried again the next day, and a mail whose outcome is unknown is never re-sent. That is today's rule for certificate reminders (`packages/fiscal-verifactu/src/certificate-reminders.ts:54-56`).
- A reminder cancelled before it was sent must be able to reopen, and the working-time code must be able to ask whether a mail was attempted (`packages/workforce/src/end-of-day.ts:85-111`, `:215-225`). So a kind reads and changes its own row through the queue's code.
- `dedupe_key` for a certificate is a text value, not a foreign key, so it does not break the rule that a `local` row may not be keyed to a venue row. What a `local` certificate's reminder row means once it sits in the copy a second box takes is **not established**.

**Proposed "don't send after" times.** The owner decided every queued mail has one; these values are proposals (§6, question 2).

| Kind | Proposed time |
| --- | --- |
| `account_action` | 30 minutes, the reset link's own life (`packages/identity/src/account-action.ts:28`) |
| `box_alert` | 24 hours; the alert stays in the dashboard's bell |
| `certificate_reminder`, `attendance_question` | 7 days |
| `invoice` | 7 days; the record then shows it was not sent, and a person can send it again |

### Server: kept outside the runner, with the reason

- **Change feed** (`subscribeToChanges`): the runner's wake source as well as the screens'.
- **Live event streams**: one shared stream implementation, mounted for management sessions (as now) and for
  device sessions (new, see J7). `/api/department-transfers/events` becomes one set of interests on it.
- **The `waitron.local` responder (mDNS)**: one responder. Two inventory entries describe it. It answers
  questions; it does not run on a timer.
- **Certificate file watch** (`tls.ts`): it belongs to each HTTPS listener, in every start mode, and it is a
  cheap file check (`stat`).
- **Venue folder heartbeat** and **frozen-process watchdog** (`packages/store`): they run in every start mode,
  before a runner exists. The watchdog has to live off the main thread to see the main thread freeze
  (`venue-liveness.ts:126-133`), so it cannot be a runner job.
- **Full-disk listener**: an event handler, not a job.
- **One-shot timers tied to a request or a state**: backup-repair session expiry, staged recovery copy expiry,
  log verbosity reset, start stayed-up timer, shutdown deadline, a card refund send that outlives its request,
  and the certificate check helper process. Each is armed by one event and fires once, so a recurring runner
  adds nothing. The password-reset background step stays, and now *queues* a mail (R5).

### Print agent (separate container)

Job pull, which becomes a **long poll** if measurement 7 shows a real saving (owner, 2026-11-04); printer discovery; Bluetooth availability check;
Bluetooth command worker; A4 job claims, which now arrive through `print_jobs`; server certificate pinning. All kept.

### Box host

Docker restart policy; the server container's health check (`waitron.sh:660-690` waits on it at install and
update); the print agent container's health check (image-smoke reads it, `image-smoke.yml:322`); Mailpit
(preproduction boxes only, see the mapping); the box clock service; host time sync.

### CI

CodeQL, nightly image smoke, Stripe sandbox, mutation testing — all kept (J8: none is clearly redundant).

### Browsers

- **One live connection per open device**:
  - the dashboard's `LiveConnection`, kept, gaining the rule that about 30 seconds of silence counts as down;
  - a new till/kitchen-display connection, which takes over the menu, equipment, floor, kitchen and pass,
    department-transfer, clock-in, payment and receipt status, and product-image re-reads;
  - the check for other boxes stops while connected at a one-box venue, and stays as it is with more than one box (§1).
- **Kept as they are**: draft autosave; battery report; idle sign-out and wake lock; join approval wait (no
  session exists yet); pairing-hold renewals (a lease, not a poll); session expiry timer; log viewer
  (log lines are not data changes); new-version detector; setup page watches (setup mode has no stream);
  demo screens.

## 3. Mapping

One row per inventory entry: 87 rows, counted with `awk '/^## 3. Mapping/{m=1;next} /^## 4/{m=0} m && /^\| /'` over this
file, less the header and rule rows. The entries were found by counting `setInterval(`, `setTimeout(`, `unrefTimer(`,
`runLoop({`, `while (!…signal.aborted)` and `setImmediate(` in non-test source under `apps/*/src` and `packages/*/src`,
leaving out test files, `**/testing/**` and `test-*` helpers. Comparing that count file by file between `68732329c1` and
`e0da0ad18a` finds one changed file, `fiscal-reconciliation.ts`. That count does not read `scripts/` or `deploy/`.

| Current                                                  | Fate                                                                                                                   | Why                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main background loop (fiscal and Stripe pass)            | replace with R0 job runner                                                                                             | Its loop, wake, wrapper and health recording become the runner. Drain and reconcile become two separate jobs, so a slow reconcile day no longer delays the drain (today they run in sequence in one pass, `pass.ts:79-141`; since #2420 the reconcile is skipped once the loop's stop signal is set, `pass.ts:114`).                                                                                                                                                          |
| Fiscal restart reset                                     | merge into R1 `fiscal.drain` (first-pass step)                                                                         | It is already a wrapper around the drain (`restart-reset.ts:14-46`); it stays one.                                                                                                                                                                                                                                                                    |
| Fiscal filing to AEAT (the fiscal outbox) | keep as R1, add a wake on `sales` | A new sale waits up to 1 h today (`loop.ts:19`; the only `.wake()` callers are the retry route and the translation runner: `fiscal-verifactu/src/routes.ts:42` and `content-suggestions-api.ts:110`). The drain's own gate still governs sending (`drain.ts:255`). |
| Fiscal reconciliation (W41s-10a, #2449) | keep as R20 on the runner | A loop of its own today (`fiscal-reconciliation.ts:25-39`), started at `boot.ts:3520-3530`, reading primary and filing-enabled on every pass. It already stops at a stepdown's signal (`background-duties.ts:158`). |
| Stripe payment reconciliation | keep as R2 `payments.reconcile`; `packages/scheduler` folds into `packages/payments`; `scheduled_runs` becomes `reconciliation_runs` | Period ledger with retry and parking, and reconciliation is its only user (grep `runDue(`: only `boot.ts:3548`). SumUp is the planned second provider (A949). |
| End-of-day working-time processing                       | keep as R4; due time and wake replace the 30 s poll; role checked on every pass                                        | Each idle pass opens `withTransaction` (`attendance-loop.ts:24`), which takes the write lock (`tenancy.ts:35`), every 30 s. It is started only if the box is primary at start (`boot.ts:2362`).                                                                                                                                                                                   |
| Missing-times emails to staff                            | merge into R5 `mail.send`; `attendance_mail` folds into `outgoing_mail`                                                | `attendance_mail` is an outbox with a claim, status and next attempt (`attendance.ts:207-236`), the same shape as the others.                                                                                                                                                                                                                                                   |
| AEAT certificate expiry reminder emails | split: deciding → R6; sending → R5; `fiscal_certificate_reminders` folds into `outgoing_mail` | That table is an outbox keyed by install, stage and person (`schema/certificate-reminders.ts:9-31`). A claim left "claimed" or "unknown" is never re-sent today (`fiscal-verifactu/src/certificate-reminders.ts:54-56`). |
| Invoice email sender | merge into R5 `mail.send`; `invoice_deliveries` becomes a record only | It polls every 0.5 s even with nothing queued (`invoice-email-worker.ts:42`). An emailed invoice becomes an `outgoing_mail` row, and that insert wakes the sender. |
| Demo printer | keep as R18; wake on `print_jobs` replaces the 500 ms poll | Practice boxes only (`demo-printer.ts:46-53`). `print_jobs` is a change source (`packages/db/src/classification.ts:171, 288`). |
| Fiscal tamper watch (append-only triggers)               | keep as R9 on the runner                                                                                               | Fiscal invariant; nothing reports a trigger being dropped, so it has to poll.                                                                                                                                                                                                                                                                                                         |
| Scheduled menu go-live                                   | keep as R8 on the runner                                                                                               | Already wakes on change (`menu-activation.ts:12-84`). A failure now retries on the runner's back-off instead of waiting the full hour (`menu-activation.ts:50-53`).                                                                                                                                                                                                   |
| Card payment check loop (container)                      | replace with R3 `card.follow_up`                                                                                       | Four steps nested as wrappers, now built by `pendingCardPass` (`boot.ts:604-641`) and started at `boot.ts:3583-3632`, and not tracked by `/health` (`boot.ts:548-555`). Since #2420 no later step starts once the stop signal is set (`boot.ts:599-601`).                                                                                                                                                                                                                                                              |
| Card outcome sweep                                       | merge into R3 (step; every trading box)                                                                                | It must run on a sell-only second box too (`boot.ts:548-550`).                                                                                                                                                                                                                                                                                                 |
| Automatic recovery of paid but unfiled card sales        | merge into R3 (step; primary)                                                                                          | Same loop today.                                                                                                                                                                                                                                                                                                                                           |
| Release of stale 'payment in progress' marks             | merge into R3 (step; every trading box)                                                                                | Same loop today, with no role check (`boot.ts:671-688`).                                                                                                                                                                                                                                                                                                                   |
| Pending bill payment and refund settlement               | merge into R3 (step; primary)                                                                                          | Same loop today.                                                                                                                                                                                                                                                                                                                                           |
| Card refund recovery (refunds on finished sales) | merge into R3 (step; primary, checked every pass) | It is the same kind of work as bill refund settlement (ask the provider, record the outcome), and both read the one `refunds` table in the target, but it is started only if the box is primary at start (`boot.ts:3636`). |
| Local network name answer (waitron.local)                | keep (one responder; same as the next row)                                                                             | Tills find the box by name.                                                                                                                                                                                                                                                                                                                                |
| Waitron Cloud connection refresh                         | keep as R15 on the runner                                                                                              | Lease renewal.                                                                                                                                                                                                                                                                                                                                             |
| Daily encrypted snapshot to Waitron Cloud | merge into R12 as the Waitron Cloud backend; no job of its own | The same archive as a scheduled backup; only the key, the upload and who deletes old copies differ (§1). Real venues stay refused (`cloud-snapshot-worker.ts:179`; `cloud-client.ts:357-360`) until Cloud's service is ready. |
| Menu translation suggestions from Waitron Cloud          | keep as R17 on the runner                                                                                              | A built feature; already has a wake.                                                                                                                                                                                                                                                                                                                       |
| AEAT certificate check helper process                    | keep (one-shot, request-driven)                                                                                        | Keeps the certificate's secret out of the main process.                                                                                                                                                                                                                                                                                                       |
| Live updates to screens (change feed)                    | keep; it also becomes the runner's wake source                                                                         | Already generic and in-process (`tenancy.ts:30-42`).                                                                                                                                                                                                                                                                                                       |
| Venue folder heartbeat                                   | keep (outside the runner)                                                                                              | Runs in every start mode, below the runner.                                                                                                                                                                                                                                                                                                                |
| Frozen-process watchdog                                  | keep (outside the runner)                                                                                              | It must run off the main thread to see the main thread freeze.                                                                                                                                                                                                                                                                                                   |
| Full-disk listener                                       | keep                                                                                                                   | An event handler, not a job.                                                                                                                                                                                                                                                                                                                               |
| Backup repair session expiry (setup)                     | keep (one-shot timer)                                                                                                  | Setup mode; armed by use.                                                                                                                                                                                                                                                                                                                                 |
| Staged recovery copy expiry (setup)                      | keep (one-shot timer)                                                                                                  | Deletes a large decrypted copy.                                                                                                                                                                                                                                                                                                                         |
| waitron.local name responder (mDNS) | keep (same responder as "Local network name answer") | One `startMdnsResponder`, started in five modes: first setup (`boot.ts:1658`), pending adoption (`boot.ts:1720`), the restricted start (`boot.ts:1793`), the waiting start (`boot.ts:1881`) and the full start (`boot.ts:3658`). |
| Certificate file watch                                   | keep                                                                                                                   | Per listener, every mode; cheap.                                                                                                                                                                                                                                                                                                                          |
| Finish a pending adoption | keep (U5) | The adoption latch: finishing refuses `mirror.venue_not_copied` while the spare holds no venue row (`reserved-identity.ts:68-69`, explained at `finish-adoption.ts:28-33`); it closes in A947 slice 3b. |
| Password reset email after the answer | replace with: queue an `outgoing_mail` row after the answer (R5); the link is made when the mail is sent | Today a crash between the answer and the send loses the mail silently (`management-api.ts:949-966`). The answer still comes before any lookup (§1). Making the token at send time keeps the "store a live login only as a hash" rule. |
| Scheduled backups | keep as R12, now the one backup service; primary checked on every pass | Primary is checked only on `reload` today (`backup-supervisor.ts:260-264`). |
| Sealed node state refresh                                | keep as R13 (woken by node.db commits)                                                                                 | Already event-driven; the runner adds health reporting and an alert.                                                                                                                                                                                                                                                                                                         |
| Live copy to the owner's bucket                          | keep as R14 service; the runner starts and stops it on role changes                                                    | Primary is checked only on `start` (`stream-host.ts:136-139`).                                                                                                                                                                                                                                                                                                 |
| Litestream child process                                 | keep, under R14                                                                                                        | It does the shipping.                                                                                                                                                                                                                                                                                                                         |
| Free-space watch                                         | keep as R11                                                                                                            | No event reports disk usage.                                                                                                                                                                                                                                                                                                                               |
| Managers' box alert emails | split: deciding → R7 (queues mail with a key per episode; the full-disk mail alone goes directly); sending → R5 | Episodes live in memory, so a restart loses a mail (`box-alert-email.ts:251-256`). |
| Clock watch                                              | keep as R10                                                                                                            | Time passing is not an event.                                                                                                                                                                                                                                                                                                                                 |
| Outbound tunnel to the relay                             | keep as R19 until A951 lands, then delete                                                                              | Off on a standard box (no relay set; the inventory's grep of `deploy/`); retirement already planned.                                                                                                                                                                                                                                                    |
| Live update streams to open screens                      | merge: one stream implementation, mounted for management and device sessions                                           | Two copies of the same loop today (`live-api.ts:95-175`, `department-transfer-api.ts:113-158`).                                                                                                                                                                                                                                                              |
| Log verbosity reset                                      | keep (one-shot timer)                                                                                                  | Never leave debug logging on.                                                                                                                                                                                                                                                                                                                       |
| Card refund send that outlives its request               | keep (one-shot; R3 picks up what it leaves)                                                                            | The screen gets its answer within 10 s (`tender-refund-sends.ts:450-454`).                                                                                                                                                                                                                                                                                        |
| Start stayed-up timer                                    | keep (one-shot)                                                                                                        | Resets the failed-start counter.                                                                                                                                                                                                                                                                                                                         |
| Shutdown deadline | keep; the runner's parallel stop makes it easier to meet | `closeAll` runs 26 closers one after another (`close-all.ts:5-15`). |
| Start-up peer check (A1018 slice 3, #2436) | keep (one-shot, before the runner)                                                       | Runs once at start on a box that is not a mirror, before any duty is built (`boot.ts:1821-1835`); each ask is bounded by a 5-second timer (`start-peer-check.ts:34`, `boot-peer-check.ts:81, 91-94`). |
| Waiting start's re-ask (A1018 slice 3, #2436) | keep (outside the runner)                                                            | Every 15 s while the box waits for a peer (`waiting-start.ts:19, 186-207`). It runs in its own start mode, before the full start builds any duty, as the folder heartbeat runs below the runner. |
| Stepdown close and restart (A1018, #2420) | merge into R0 (the runner's stop at a stepdown)                                         | One-shot after the stepdown's answer: waits up to 180 s for admitted requests on the gate's timer (`handover-gate.ts:48-66`, `handover-stepdown.ts:17, 193-196`), closes within the 8-second deadline, then restarts (`handover-stepdown.ts:197-218`). Its stop of duties is the runner's job. |
| Print agent job poll loop | keep; becomes a long poll if measurement 7 shows a real saving | The only way jobs reach printers, at a 2 s poll (`packages/print-agent/src/agent.ts:28`). Each pull also checks the agent's secret hash (`printing/src/agent.ts:45`). |
| Print agent printer discovery pass                       | keep                                                                                                                   | Only while a discovery window is open.                                                                                                                                                                                                                                                                                                                     |
| Print agent Bluetooth availability check                 | keep                                                                                                                   | Needed before approval, when no pull exists.                                                                                                                                                                                                                                                                                                                |
| Print agent Bluetooth command worker                     | keep                                                                                                                   | Keeps a slow pairing from holding up printing.                                                                                                                                                                                                                                                                                                                      |
| Print agent office (A4) printer job claims | keep; the jobs now arrive through `print_jobs` | The claim renewal is what makes a lost agent's job safe. `invoice_deliveries` no longer holds the claim, so the print agent's protocol changes. |
| Print agent server certificate pinning                   | keep                                                                                                                   | Lets the agent trust the box's self-signed address.                                                                                                                                                                                                                                                                                                  |
| Containers kept running and restarted by Docker          | keep                                                                                                                   | What brings a box back after a power cut.                                                                                                                                                                                                                                                                                                                  |
| Server container health check                            | keep                                                                                                                   | Install and update wait on it (`waitron.sh:660-690, 749, 827`).                                                                                                                                                                                                                                                                                                  |
| Print agent container health check                       | keep                                                                                                                   | image-smoke asserts it (`image-smoke.yml:322`).                                                                                                                                                                                                                                                                                                         |
| Practice email inbox (Mailpit)                           | keep on preproduction; not started on production (compose profile chosen by `waitron.sh`)                              | Demo and Prepare require preproduction (`config.ts:373-376`), so a production box never sends to it.                                                                                                                                                                                                                                                       |
| Box clock service (host helper)                          | keep                                                                                                                   | The only way to set the clock from a container.                                                                                                                                                                                                                                                                                                       |
| Host internet time synchronisation                       | keep                                                                                                                   | Outside Waitron; keeps the clock right.                                                                                                                                                                                                                                                                                                                   |
| Nightly CodeQL security scan                             | keep                                                                                                                   | J8: not redundant.                                                                                                                                                                                                                                                                                                                                  |
| Nightly box image build and smoke test                   | keep                                                                                                                   | J8: catches drift that pull-request CI cannot see.                                                                                                                                                                                                                                                                                                       |
| Nightly Stripe sandbox test                              | keep                                                                                                                   | J8: catches provider drift.                                                                                                                                                                                                                                                                                                                             |
| Nightly mutation testing                                 | keep                                                                                                                   | J8: CLAUDE.md §2 mutation floors.                                                                                                                                                                                                                                                                                                                         |
| Till follow-the-primary probe | merge into the till live connection: stops while connected at a one-box venue; with more than one box it stays as it is | One box per venue today (CLAUDE.md §5): 12 reads a minute per till with nothing to switch to. With more than one box it also hands a box that is behind the newest chart (§1). |
| Till menu, equipment and zone poll                       | replace with the till live connection (re-reads only while it is down)                                                 | Each zone read takes a write-lock turn (`till-app.ts:2918`).                                                                                                                                                                                                                                                                                                 |
| Till floor and table re-reads                            | replace with the till live connection                                                                                  | Floor tables are change sources (venue-service classifies every table: `venue-service/src/classification.ts:61-62`).                                                                                                                                                                                                                                        |
| Kitchen and pass screen refresh                          | replace with the device-session live connection                                                                        | Kitchen displays have no person signed in, so they need the device-session mount.                                                                                                                                                                                                                                                                              |
| Till department transfer watch                           | merge into the till live connection                                                                                    | It already is a live stream; it becomes one set of interests on the shared one.                                                                                                                                                                                                                                                                         |
| Till clock-in status poll                                | replace with the till live connection                                                                                  | Workforce tables are change sources (`workforce/src/classification.ts:44`).                                                                                                                                                                                                                                                                                  |
| Till payment and receipt status re-reads                 | replace with the live connections (till and dashboard)                                                                 | `payments` and `invoice_deliveries` are change sources.                                                                                                                                                                                                                                                                                                    |
| Till order draft autosave and list retries               | keep                                                                                                                   | Started by a person's edit; not polling.                                                                                                                                                                                                                                                                                                                         |
| Device battery report                                    | keep                                                                                                                   | Device to server; every 5 min.                                                                                                                                                                                                                                                                                                                             |
| Till idle sign-out and screen kept awake                 | keep                                                                                                                   | Local timers.                                                                                                                                                                                                                                                                                                                                              |
| Till join approval wait                                  | keep                                                                                                                   | No session exists yet to hold a stream on.                                                                                                                                                                                                                                                                                                                 |
| Dashboard live updates                                   | keep (the model for the till's connection)                                                                             | Already one stream per dashboard.                                                                                                                                                                                                                                                                                                                         |
| Dashboard background re-reads | change: re-read on a timer only while the live connection is down, once the server publishes the in-memory states; about 30 s of silence counts as down | The re-read timers run whether or not the stream is up (`live-data.ts:80-86`). The synthetic types are accepted but never published (`live-resources.ts:17-21`; grep `.publish(` finds only `live-api.ts:44`). |
| Prep stations coverage re-read | keep | A 60 s timer that runs only when the dashboard has no live data (`packages/venue-service/src/dashboard/prep-stations-screen.ts:395-397`). |
| Dashboard printer and device pairing helpers             | keep the 60 s renewals; replace the 2 s scan reads with live events                                                    | Renewing is a lease; the discovery results need a `printer_discovery` publisher.                                                                                                                                                                                                                                                                               |
| Dashboard session expiry timer                           | keep                                                                                                                   | One timer.                                                                                                                                                                                                                                                                                                                                                 |
| Dashboard log viewer poll                                | keep                                                                                                                   | Log lines are not data changes; only while the screen is open.                                                                                                                                                                                                                                                                                                          |
| Product image refresh                                    | replace with the live connections (media change source)                                                                | `MEDIA_CHANGE_SOURCES` exists (`media/src/module.ts:37`).                                                                                                                                                                                                                                                                                                   |
| New-version detector                                     | keep                                                                                                                   | Not a timer.                                                                                                                                                                                                                                                                                                                                               |
| Setup page lease and progress watches                    | keep                                                                                                                   | Setup mode has no live stream.                                                                                                                                                                                                                                                                                                                             |
| Demo printer and demo card reader screens                | keep                                                                                                                   | Demo only; J8 says leave them unless clearly redundant.                                                                                                                                                                                                                                                                                                       |
| Worktree dev stack (wa-wt)                               | keep                                                                                                                   | Development only.                                                                                                                                                                                                                                                                                                                                          |

## 4. How each worry is answered

**Performance.** The box's single write lock is the bottleneck: every `withTransaction` takes it
(`tenancy.ts:35`). Today several background duties take a lock turn even when they have nothing to do:

- the working-time pass every 30 s (`attendance-loop.ts:24`);
- the clock watch reads under `withWriteLock` every 15 s (`boot.ts:2968`);
- each open dashboard stream re-checks its session inside `withTransaction` on every wake, including the
  15-second keepalive (`live-api.ts:98-103, 136`);
- each till menu-state read takes a turn (`till-app.ts:2918`).

The design reduces these lock turns:

- Due times and wakes replace idle polls: working time, invoice email (0.5 s), demo printer (0.5 s), card
  follow-up.
- Pushed changes replace the till re-reads (menu, floor, kitchen, clock-in, payments, images; every 5–15 s
  per device).
- The session check on a stream wake must become a read that takes no write lock, or a check cached for the
  keepalive period. Otherwise adding a stream for every till makes the lock pressure worse. This is a
  required part of J7, not an optional extra.
- One job per loop means the fiscal drain no longer waits behind a slow reconcile day.
- If measurement 7 shows a real saving, the print agent's long poll replaces a pull, with a secret-hash check, every 2 s.
- Heavy read-only work and the backup copy can leave the main thread (§1): in the stand-in test the longest
  gap in its timer fell from 1,353 ms to 21 ms for a heavy read, and from 385 ms to 21 ms for `VACUUM INTO`.
- `housekeeping` deletes in short batches, so a day's tidy-up does not hold the lock in one long write.

**Data loss.**

- Mail that today lives only in memory or in a fire-and-forget promise becomes a row: box alert episodes
  (`box-alert-email.ts:251-256`), written in the job's own transaction, and the password-reset send
  (`management-api.ts:949-966`), written just after the answer (§1). The full-disk mail is the exception.
- A queued mail cannot go out long after its moment, even from a restored backup: its `not_after` time expires it.
- Duties started only if the box was primary at start (refund recovery, working-time processing, backups, the
  bucket copy) start on promotion, without waiting for a restart that might never come.
- Every job reports to `/health` and raises a `job.failing` alert when it keeps failing. Today a stuck
  working-time pass, invoice sender or menu activation only logs.
- A parallel stop, with the bucket copy stopped last, makes the 8-second deadline less likely to cut off the
  Litestream stop. The deadline exits the process (`run-server.ts:66-75`).
- The `/health` 503 rule does not change: only the duties with a legal or money clock (drain, reconcile) can
  make it fail. All other jobs report their state there but never fail it, because a 503 caused by an outside
  outage would stall an install or an update (`health.ts:44-45`).

**Migrations and upgrades.** The runner is code only, so no stored data changes with it. Three schema changes
come with this area: the new `outgoing_mail` table, which replaces `attendance_mail` and
`fiscal_certificate_reminders`; `invoice_deliveries` losing its queue columns; and `scheduled_runs` becoming
`reconciliation_runs` in the payments set. Before go-live a box may be reset (CLAUDE.md §3, "No backwards-compatibility … until Waitron is in production"), so no
carry-over code is needed. Job names become stable
identifiers and never change, and so does each provider's key on `reconciliation_runs`, such as `payments.reconcile.stripe`. Fewer
start/stop blocks (today 26 closers in a hand-kept order, `background-duties.ts:87-208`) leaves fewer places for an
upgrade to break the shutdown order. The tunables the environment-variable part retires (`WAITRON_MAX_TICK_MS`
and the scheduler settings) become the runner's per-job constants.

## 5. Measure or test before building

1. **Count write-lock turns per minute by caller** on an idle primary and during a simulated service (10 tills,
   2 dashboards). Do it by putting a counter around `withWriteLock` in a throwaway worktree.
   - If background and polling turns together are under about 1% of lock time, the till live connection (J7)
     can wait behind the server runner.
   - If they are large, J7 and the cheaper session check on stream wakes go first.
2. **Does every path that writes a fiscal record also insert or change a `sales` row in the same
   transaction?** Test it: a sale, a refund or correction invoice, and a cancellation. For each, assert that
   the change feed delivered a `sales` change.
   - If any path does not, add an explicit "record written" notice from the fiscal backend after commit,
     rather than adding change-feed triggers to `verifactu_records`. How the tamper watch would treat an
     extra trigger on that table is not established.
3. **Wake-on-sale against AEAT flow control.** Run against the fake AEAT and send 200 sales in a minute.
   Expect at most one send per `TiempoEsperaEnvio`, plus any full batch that the rule at `drain.ts:220-224`
   allows. More sends than that means the wake must be throttled.
4. **Shutdown timing.** Measure `stopWork` today (sequential) with a running Litestream.
   - If it already finishes well under 8 s, the parallel stop is a tidy-up, not a fix.
   - If it is near 8 s, the parallel stop is needed first.
5. **How often `node.db` commits** during service, since each commit triggers a full re-seal (R13). If it is
   more than about once a minute, add a minimum gap between re-seals.
6. **Per-stream cost on the box** with 20 open event streams: memory, CPU and session-check cost. This decides
   whether kitchen displays and handhelds all get streams, or only tills.
7. **Print agent long poll.** Measure ticket latency and the agent's request count against the 2 s poll. The
   agent's 3 s request limit (`packages/print-agent/src/client.ts:174`) must be raised for a held request. If it shows no real saving, keep the poll.
8. **A promotion test.** Promote a local secondary in-process and assert that every primary-only job runs
   without a restart. This is the J4 test, and nothing covers it today.
9. **What moves off the main thread.** On the reference micro PC, through the real store, record each job's
   longest hold on the main thread at a year's data. Include the backup copy and the heavy reads, and check that a worker's
   own connection fits the venue lock and a running Litestream. A hold the bench shows sales or screens feeling moves to a
   worker thread if it only reads; a write is split into shorter transactions instead. If a worker's connection does not fit, the copy stays on the main thread.
10. **Housekeeping's batch size.** Run each step at a year's data with sales going on. Failing result: a sale write's
    longest wait grows against the same run with the job off; then the batch shrinks.
11. **A restored queue.** Restore a backup holding a pending password reset and a pending alert, with the clock
    past their `not_after`, and assert neither goes out. Control: a row still inside its time does go out.
12. **The full-disk mail.** On a small real filesystem, fill the disk and assert that the mail goes out while the
    insert is refused. Control: the low-space mail, on a disk with room, is queued.
13. **A year's archive against Cloud's ceiling.** Take the bench's year-of-trading archive and compare it with Cloud's
    512 MB limit. If it is over, a real venue cannot use Cloud as its main target until that limit moves.
14. **A real power cut.** With a till connected, cut a box's power. Assert the till counts it as down within about 30
    seconds and its timed re-reads start. Then, at a venue with two boxes, assert a behind box still receives the newest
    chart from a till on a live connection.

## 6. Decisions for the owner

Everything the owner was asked here is settled (2026-11-04) and stated above. These questions are still open:

1. **Invitations and email-change messages.** Do they join the queue? Today a person's request sends them directly
   and waits (§1), and the invitation's result goes back to the screen as `invitationSent`. Queued, they would survive
   a restart, but the screen could then only say "queued". This file leaves them sending directly through the one
   transport. U4 says "every notification email", so it needs an answer.
2. **The "don't send after" times.** The values in §2 are proposals.
3. **How long a finished `outgoing_mail` row stays.** A finished row is what stops the same mail being queued twice,
   and it names a person, so its length of stay falls under A980 (U10). Until then nothing deletes it.
4. **Cloud's backup schedule.** Cloud promises daily copies today (`cloud-snapshot-worker.ts:211-216`), while the one service has one
   schedule, which the venue sets. Does Cloud follow the venue's schedule, or does each backend keep its own?
5. **"Add a mirror node" in the setup wizard.** README U5 keeps the adoption finisher and the offer, and the finisher refuses
   `mirror.venue_not_copied` (`reserved-identity.ts:68-69`) until A947 slice 3b brings the main box's data to the
   spare. Whether the wizard should offer the option before then is still open at `docs/backlog.md:706-709`.

**To confirm before `housekeeping`'s service-command step is switched on:** how late a till can retry a command.

**Where the proposed rules break:**

- **J1** does not cover the watchdog (it must run off the main thread), the folder heartbeat (every start
  mode), event listeners or one-shot timers.
- **J2:** the Docker health checks stay, because install and update (server) and CI (print agent) act on
  them. Most jobs report to `/health` without making it fail.
- **J3:** the tamper watch, free-space watch, clock watch and Cloud polls have no event to wake them, so they
  keep polling.
- **J5:** Mailpit does nothing on production (Demo and Prepare are refused there, `config.ts:373-376`), so it
  is not started there. Cloud backups are off on real venues until Cloud's service is ready, and they are a backend
  of R12, not a job. The tunnel already has an approved replacement.
- **J6:** one queue holds, with one exception: the full-disk mail cannot be written to a full disk (§1). Question 1
  above may add two more.
- **J7:** tills have no general stream today; only the department-transfer one exists. The synthetic live
  types (`pairing`, `printer_discovery`, `email_inbox`, `backup_status`, `google_config`) are accepted as
  interests but nothing on the server publishes them, which is why those dashboard reads poll every 5–10 s.

**Not established:**

- whether a scheduled backup can begin, or the bucket copy can ship, in the window between a stepdown's answer
  and its close (up to 180 s plus the 8-second close, `handover-stepdown.ts:193-218`). The stepdown stops
  neither at its signal and ends in a restart, into the restricted start whenever it wrote a restriction row (§1).
- how the box's side of Cloud's continuous copy works (§1).
