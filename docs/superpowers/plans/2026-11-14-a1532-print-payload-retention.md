# A1532: release old print-job payloads after one week

**Authority and finish line.** The owner said “a week is fine” on 2026-11-14 at
17:02 (Lane J `queue.md`, A1532). A daily runner job releases old printed bytes while
keeping every row/link; unavailable queue reprints explain how to proceed. The owner
chose the period; this plan still needs Claude's read and the watcher's clearance.

**Policy.** Keep the NOT NULL binary column; use `new Uint8Array(0)`, with no schema
change. Age means `created_at < now − 604800000 ms` (UTC ISO); equality stays.
Clear only nonempty payloads on `done` jobs, failed nonretryable drawer jobs, and
failed documents explicitly ended by `printer.deleted`, `printer.unpaired` or
`print_job.moved`, or exhausted failures whose replacement has printed under
`printJobInTrouble`'s existing resend/sale/kitchen-coverage rules. Preserve queued and
printing jobs, every other failed document, and jobs with a queued/sending/unknown invoice
delivery. Age, a disabled printer and exhausted attempts alone do not mean abandoned.

**Reuse and files.** Add `apps/server/src/print-payload-retention.ts`: use
`withTransaction`, `printJobInTrouble` and `JobDefinition`; clear up to 100 rows per
transaction, rechecking eligibility, releasing the lock and checking cancellation
between batches. Register on the writable primary in `boot.ts`, once at start and every
24 hours through the existing runner/backoff. Mark `printing.payload_retention` as stopping
at stepdown in `job-catalogue.ts`. Preserve all statuses, timestamps and audit/history links.

Add an exported empty-document assertion in `packages/printing/src/outbox.ts` and
`index.ts`, with `print_job.sale_payload_expired` / `print_job.payload_expired` in
`errors.ts`. Apply it before resend insertion (even with supplied replacement bytes),
before both printer paths/sale layout in `apps/server/src/print-job-reprint.ts`, before
reservation changes in `invoice-print.ts`, and before preview in `print-api.ts`.
Keep existing queue reprint availability so an attempted reprint receives the explanation;
keep View, refuse stale requests, and exclude empty practice previews. Reuse existing
request-error display and `apps/dashboard/src/i18n/codes.ts` for English/Spanish wording:
stored bytes were removed after a week; reprint receipts/invoices from **Orders**;
old kitchen tickets/other opaque printouts cannot be reprinted from this job.
Identify sale documents by `saleId`, not `receipt_reprints` (which also links refunds).

**Consumer trace.** Resend, agent claim/transport, reprint layout, queue width, preview and
practice preview read payloads. The sweep's terminal-state rule keeps cleared jobs outside
claim eligibility; do not add a new transport gate. Retained rows preserve receipt history,
invoice delivery, kitchen problems, printer/station alerts, deletion and live-query references.

**Tests, failing first.** Printing's `outbox.test.ts` owns empty resend refusals and a
nonempty byte-for-byte control. New server `print-payload-retention.test.ts` uses
`useVenueDb` for cutoff boundaries, terminal states, preserved undecided failures, repeat
sweeps, batches and unchanged audit/link/problem state. Existing runtime eligibility
assertions remain intact; reuse runner scheduling/backoff tests; test this job's daily interval/registration/stop in
`job-catalogue.test.ts` and `boot.failed-start.test.ts`. `print-job-reprint.test.ts`,
`print-api.test.ts` and invoice-print's existing suite own affected route answers and no new
job/delivery. `orders-reprint.test.ts` owns rebuilding the sale; dashboard's existing
`widgets/print-job-reprint-dialog.test.ts` / `screens/printers-screen.test.ts` own localized
refusal display. Run every changed file, server guide-content and root guide-links guards.

**Measure and scope.** On a disposable copy of the retained 30-day/250-bill/seed-1 bench
at `95e668a747`, record database size, dbstat, freelist and identical backup-capture size
before/after in the PR, including unchanged file size if observed. Baseline: database
1,296,785,408 bytes; print table 782,790,656 (60.364%). No promised savings.
Update `docs/backlog/printers.md`, its `docs/backlog.md` summary, and server guide
`en/printers.md` / `es/printers.md`; retain the week/bytes/rows decision and virtual-printer work.
Estimate: production +180–260/−20–40, tests +220–320/−0–20, test support 0, docs +60/−20.
Omit virtual printing, A664 retention, row deletion, production VACUUM, streamed uploads,
new records/protocols/deadlines/approval systems and fiscal writers.
