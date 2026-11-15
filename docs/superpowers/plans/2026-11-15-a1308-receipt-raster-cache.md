# A1308: remove the persisted department receipt raster cache

Draft at `3ea253fc7f`; depends on vb5 (#3353, `6d29e7319d9d63f6483a0628daee1570e675d08f`).
**Not ready to build:** the paper-print preparation boundary below remains unresolved.
Watcher-directed under the owner's A1308 request; this unwritten plan had no owner approval.
Driver: arrange Claude review and watcher clearance under Lane H `RUNNER.md` §0; follow [slice rules](2026-11-08-a1308-slice-rules.md).

**Actual ask**, verbatim, `~/waitron-campaign-h/questions.md`, WATCHER 2026-11-15 13:48:
> Timing (owner's 13:42 assignment): median 16.9 ms on the test box, under the plan's ~20 ms line. Per the plan (vb5 plan :112), the next PR after vb5, before vb6, drops receipt_logo_rasters and converts at print time. Note in it the 155 ms first conversion after a start (once per process), and that the sample is the Waitron wordmark, not every logo.

**Finish line:** receipts, reprints, PDFs and emails draw the current department image/framing without `receipt_logo_rasters`; document/drawer rules hold.
Authority: design [README](../specs/2026-11-02-rationalisation/README.md) R6 and [tables-venuebox](../specs/2026-11-02-rationalisation/tables-venuebox.md) §8.4.
Receipt: lane `receipts/a1308-vb5/{box-timing.json,box-timing-source.ts}`, image `1129ca229bf6`, Node v26.13.0 x64:
warmed median 16.885634 ms; first conversion 155.130972 ms in the sampled process, after a start.
One Waitron wordmark, 80 mm, 504×119 dots; decode+dither only, excluding SQL/rendition work. No generalisation to every process/logo; no new box work.

**Existing seams and the unresolved dependency** (`apps/server/src/` paths below):
- Reuse `receipt-logo.ts`, media's `readCurrentImage`/`renderRendition`, and preview's snapshot/render
  pattern (`receipt-preview-api.ts:306–408`); keep sharp outside transactions and its bounded cache intact.
- `receipt-presentation.ts` needs names/URLs: remove raster reads; keep language bounds, address consent, unreadable settings and theme-name fallback.
- `invoice-document.ts:132–143` reads dots inside transactions; later rendering lives in `page-print-api.ts`,
  `invoice-email-worker.ts`, `orders-api.ts`/`orders-invoice-pdf.ts` and `invoice-customer-data.ts`: captured source → later render is the candidate A4 seam.
- Paper differs: `receipt-print.ts:159–235` builds bytes before enqueuing in that same transaction.
  Callers are `till-sale.ts:959`, `transaction-receipt-api.ts`, `orders-reprint.ts`/`orders-api.ts`,
  `invoice-delivery-actions.ts` via till/transaction/orders routes, and `print-api.ts` via `boot.ts`.
  `invoice-corrections.ts:397–408` also enqueues inside the corrective filing transaction.
- **Unresolved:** settle request-local preparation before paper-print transactions, including concurrent
  department/image edits. Preview supplies a pattern, not a shared paper seam. No silent logo omission,
  stale dots, new refusal/retry protocol, split delivery switch or moved fiscal write is cleared here.

**Settled removal work, after that boundary is cleared:**
1. Remove only the column in `packages/db/src/schema/venue-service/service.ts`; in
   `packages/venue-service/src/{department-receipts.ts,service.ts}` and `packages/module/src/module.ts`
   retire `readDepartmentLogoRasters`, raster arguments/projection/decoder. Keep bounded trim, logo FK,
   retained departments, diagnostics and shared/theme raster types; revise `PrintedDepartmentReceipt` consistently.
2. `apps/server/src/department-receipt-api.ts`: remove cache reuse/storage; keep permission, missing-image, id/revision and invalid-image checks; decode outside transactions.
   `packages/media/src/image-edits.ts`: stop department raster writes; keep usages/deletion refusals/theme redraws; media `routes.ts` and server `boot.ts` keep theme preparation.
3. Drop `packages/db/src/testing/seed.ts`'s fourth argument; port every caller from
   `rg -l 'seedDepartmentReceipt|receiptLogoRasters|receipt_logo_rasters|readDepartmentLogoRasters' apps packages scripts`;
   use real image bytes. Port `scripts/a1308/vb5-department-receipt-fixtures.mjs`/`.test.mjs` emitted calls
   and `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`'s fold, without editing old captures.

**Tests and assertion changes by design** (TDD during implementation; keep source tests and other assertions):
- Venue-service `src/department-receipts.test.ts` owns bounded/untrusted trim (keep the <65,536-byte assertion);
  db `src/testing/seed.test.ts` owns key/text/time writes. Remove only persisted-picture/API assertions.
- Server `src/{receipt-logo,receipt-print,invoice-document,receipt-presentation}.test.ts` own dots,
  latest framing, missing/undecodable explicit logo → no logo and no theme substitution; keep original,
  duplicate, issuer, QR and drawer assertions. Replace synthetic cache corruption with corrupt source bytes.
- Server `src/{department-receipt-settings-api,management-api.accounts-and-receipt-config}.test.ts` own save refusals/races; replace cache checks with image-choice/validation checks.
- Media `src/{image-edits,department-logo-uses,backup-verification}.test.ts` own edits/usages; cache-refresh checks become next-print dots in server tests; theme assertions stay.
- Server `src/{configuration-transfer,configuration-import,configuration-import.previous-export}.test.ts`
  and provisioning `src/configuration-transfer.boundaries.test.ts` own export/import/version refusal.
  Run whole changed fixture files, preview/draft and delivery/reprint suites; keep fiscal/menu gates unedited,
  including sale-operation-description suites and fiscal immutability. New boundary tests await its decision.

**Schema, receipts and scope:** rebuild core with `pnpm --filter @waitron/server migration-baseline rebuild --set core`;
PR first line: “Every venue is reset: core; backups and exports from before this cannot be restored or imported.”
Raise `packages/provisioning/src/configuration-transfer.ts`'s format from main's value (39 here) by one.
Expected protection-list difference: six venue builds lose `departments.columns[receipt_logo_rasters]`
and change `departments.columnOrder`; two change-feed builds change `waitron_change_departments_update.when`.
No other protection loss. Run list before/after and compare plus schema rebuild guards (rules §§2–5).
PR disclosure: `Sale-path read changed: sale/payment and receipt reads through readReceiptPresentation no longer project department raster JSON.`
Follow the three-landed-read-slices bench schedule. Leave money, hashes, menu decisions, vb6, theme stored rasters and drawer jobs outside this change.
Delete the cache-drop backlog paragraph; keep provenance in `docs/backlog/architecture.md`'s decisions; add dated pointers here from historical vb5 and tables-venuebox §8.4.
**Provisional size:** ~200 production / ~450 test-support lines for removal/ports, excluding generated/pure deletions. Paper preparation is unsized: return it to Claude/the watcher before build.
