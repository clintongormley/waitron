# A1532: release print-job payloads after one week

**Authority and finish line.** The owner chose “a week is fine” (Lane J queue,
2026-11-14 17:02); the watcher's same-time questions.md note says “The owner chose a week”.
Watcher 17:37 clears R16's existing housekeeping seat, all printouts and 30-day measurement.
Claude read the plan and its fixes; watcher 17:49 cleared build with the test scope below. Old terminal jobs lose
bytes and retain rows/links. Expired print-queue reprints refuse consistently; sale receipts
and invoices can be rebuilt from Orders at any age.

**Policy.** Keep NOT NULL and bind `new Uint8Array(0)`; no schema/migration. In a real
`useVenueDb` test first assert `typeof(payload) = 'blob'` and `length(payload) = 0`.
Age is `created_at < now − 604800000 ms` in UTC ISO; equality stays. Clear nonempty payloads
only for done jobs, failed drawers, and failed documents either marked `printer.deleted`
or exhausted **and** cleared by `NOT printJobInTrouble(now)`'s existing replacement rules.
Do not exempt moved/unpaired jobs. Keep every queued/printing job, retryable failed document,
undecided exhausted failure, and linked queued/sending/unknown invoice delivery.

**Build and reuse.** Create `apps/server/src/housekeeping.ts` with `housekeepingJob`
using jr7's planned deps (`db`, `isPrimary`, `readClock`, `jitterSeed`, `now`, `log`) and only
this payload step. Use `nextFireMs` for 04:00 venue time, no startup sweep; add new `boot.ts` registration for the existing
primary-only, stop-at-stepdown `housekeeping` catalogue seat. Reuse its catalogue, wording,
runner backoff and stop handling. Scan bounded rowid windows forward; recheck eligibility in
each `withTransaction`, retain all other values, and yield a real event-loop turn/check the
signal between batches. Choose the batch by the measurement below, not an invented bound.

In `invoice-print.ts`, export one shared empty-document assertion: apply it before resend
side effects, even with supplied fresh bytes. In `print-job-reprint.ts`, apply it before both
printer paths/layout so expiry beats own-printer-only refusals. In `print-api.ts`, apply it
before preview. No printing-package API or transport-gate change.
Declare `print_job.sale_payload_expired` / `print_job.payload_expired` in server `errors.ts`;
map them to 409 in `print-api.ts`, `till-api.ts` and `orders-api.ts`. Add English/Spanish
wording in dashboard and till `src/i18n/codes.ts`: bytes were removed after a week; rebuild
sale receipts/invoices from Orders. Other printouts cannot be reprinted; the till explicitly
names kitchen tickets, refund receipts, payment slips and reports as examples.
Use `saleId` to distinguish them. Keep existing reprint availability and request-error UI.
Watcher 17:49 withdraws the 17:47 exception: all expired queue reprints refuse and point
sale receipts/invoices to Orders; there is no alternate-printer exception. Consumer trace includes
resend, invoice retry/switch, alternate-printer layout, queue width,
preview and practice preview; the latter already accepts empty bytes, so add no special filter.

**Tests, failing first.** Server `housekeeping.test.ts` owns age boundaries, each terminal
case, preserved retryable/undecided failures (including moved/unpaired), repeat sweeps, cursor
progress over ineligible rows, yielding/stop, daily scheduling and unchanged audit/link/problem
rows. Reuse generic runner/backoff tests; `boot.failed-start.test.ts` checks registration/cleanup.
`invoice-print-api.test.ts` owns refusal with no new job/delivery, once. Add one 409 case
at each print/till/Orders API; the till mount also serves transaction-receipt-api. Add the
expiry-before-own-printer-only case in `print-job-reprint.test.ts` and one preview case.
`orders-reprint.test.ts` retains rebuilding old sales. Dashboard's reprint-dialog/printers-screen
files and till `i18n/codes.test.ts` check localized wording through existing flows. Run changed
files, server guide-content, root guide-links, alert-codes and errors-reachable guards.

**Measure and document.** On disposable copies of the retained 30-day/250-bill/seed-1 bench
at `95e668a747`, fix now at its final `bench-session.json` clock. Apply jr7 Task 1's paired
five-minute sale-wait test here (watcher 17:37 substitutes 30 days): try 500, then 100/25 if
the job increases maximum sale wait by over 50 ms; stop if 25 fails. Record chosen batch,
raw file size, dbstat/freelist and `VACUUM INTO`/identical backup sizes before/after in the PR.
Baseline: database 1,296,785,408 bytes; print table 782,790,656. No promised saving or year claim.
Update backlog printers/index and EN/ES server printers guides; retain virtual-printer work.
Update only print-retention wording in R16 jobs.md and append a dated pointer to historical jr7.
Tell lane E in the PR and append one line to its questions.md so jr7 reuses this seat.
Estimate +180–260/−20–40 production, +300–420/−0–20 tests (outside opinion beyond 1.5×), no test support, +80/−20 docs.
Leave jr7's other steps, A664, row deletion, production VACUUM, new clock gates, streamed uploads,
new records/protocols/deadlines/approval systems and fiscal writers out.
