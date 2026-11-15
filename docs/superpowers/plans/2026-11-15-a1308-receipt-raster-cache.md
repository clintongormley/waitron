# A1308: remove the persisted department receipt raster cache

Base `3ea253fc7f`; needs vb5 (#3353, `6d29e7319d9d63f6483a0628daee1570e675d08f`), already landed.
Codex drafted this plan; Claude reviewed it on 15 November. **Build waits for watcher clearance**
of conversion inside the existing print transaction, including the unmeasured rendition cost.
Neither that review nor watcher clearance is owner approval of this plan. Follow [slice rules](2026-11-08-a1308-slice-rules.md).

**Ask**, verbatim, Lane H `questions.md`, WATCHER 2026-11-15 13:48:
> Timing (owner's 13:42 assignment): median 16.9 ms on the test box, under the plan's ~20 ms line. Per the plan (vb5 plan :112), the next PR after vb5, before vb6, drops receipt_logo_rasters and converts at print time. Note in it the 155 ms first conversion after a start (once per process), and that the sample is the Waitron wordmark, not every logo.

**Finish line:** receipts, reprints, PDFs and emails draw the current department image/framing without
`departments.receipt_logo_rasters`; image edits stop rewriting departments; document/drawer rules hold.
Source: design [README](../specs/2026-11-02-rationalisation/README.md) R6 and [tables-venuebox](../specs/2026-11-02-rationalisation/tables-venuebox.md) §8.4.
Timing: lane `receipts/a1308-vb5/{box-timing.json,box-timing-source.ts}`, test-box image `1129ca229bf6`,
Node v26.13.0 x64: warmed median 16.885634 ms; first conversion 155.130972 ms in the sampled process.
One Waitron wordmark, 80 mm, 504×119 dots; decode+dither only. SQL and `renderRendition` are unmeasured.
The owner assigned this test box; its equivalence to the appendix's reference micro PC is unverified.
The PR must state these numbers and limits; neither every logo nor every process was measured.

**Smallest route recommended by Claude; watcher decision pending:**
- At `apps/server/src/receipt-venue-logo.ts:37`, keep theme fallback unchanged. For a readable explicit
  department logo, use `readCurrentImage(tx, name)` → `renderRendition(bytes, "display", framing)` →
  exported `drawLogo(bytes, paperWidth)` from `receipt-logo.ts`; no print-path memory cache.
  Capture department/image/source in the existing transaction. Missing source returns no logo;
  catch every conversion/read error, report the existing diagnostic, and print the rest without theme substitution.
- Paper callers (`receipt-print.ts:167–257`) and A4 (`invoice-document.ts:132–143`) already use that
  resolver. No pre-read, request-local preparation, A4 source descriptor, new retry/refusal protocol,
  delivery-switch split or moved fiscal write. Update media `logo.ts` and server `receipt-logo.ts`
  comments to distinguish full-upload preparation from this print-time conversion; comments state invariants, not history.
**Removal and direct consumers:**
1. Remove only the raster column in `packages/db/src/schema/venue-service/service.ts`. In venue-service
   `src/{department-receipts.ts,service.ts}` and module `src/module.ts`, retire `readDepartmentLogoRasters`,
   raster save arguments, SQL picture projection/decoder and `PrintedDepartmentReceipt.logo`.
   Keep bounded trim, retained reads, logo FK, unreadable flag, diagnostics and shared/theme raster types.
2. Server `src/department-receipt-api.ts`: drop `kept`/cache writes; retain permission, missing-image,
   id/revision and invalid-image checks, with save-time decode outside transactions. `receipt-presentation.ts`
   reads trim without dots. `receipt-preview-api.ts:307–389` drops saved-raster reuse and draws through
   existing `drawLibraryLogo` after its snapshot; retain preview's bounded cache and unreadable/theme rule.
3. Media `src/image-edits.ts`: remove department writes and narrow the both-pictures requirement to themes;
   department `receipt_updated_at` no longer moves on pixel edits. Keep usages/deletion refusals and theme redraws.
   `routes.ts`/server `boot.ts` keep theme preparation. Drop db `src/testing/seed.ts`'s fourth argument;
   port only fourth-argument callers/column references found by `rg`, using real image bytes where dots matter.
   Update `scripts/a1308/vb5-department-receipt-fixtures.mjs`/`.test.mjs` and Madrid's baseline-test fold.
**Test ownership and assertions changing by design (§8.4); TDD before implementation:**
- Venue-service `src/department-receipts.test.ts`: bounded/untrusted trim, retained departments and diagnostics;
  db `src/testing/seed.test.ts`: key/text/time. Retire persisted-picture/readDepartmentLogoRasters assertions only.
- Server `src/receipt-logo.test.ts`: direct 58 mm drawing equals the old height-limited wide-raster reuse.
  `src/{receipt-print,invoice-document}.test.ts`: real-image dots, next print after replacement/framing,
  explicit missing/corrupt image and a non-AppError conversion failure print no logo without blocking the document.
  Port synthetic-dot assertions at receipt-print:2669–2723 and :3930, invoice-document:636–652 to real bytes;
  corrupt-cache controls become corrupt-source controls. Keep original/duplicate, issuer, QR, drawer and text assertions.
- Server `src/{department-receipt-settings-api,management-api.accounts-and-receipt-config}.test.ts`: save refusals/id-revision checks;
  media `src/{image-edits,department-logo-uses,backup-verification}.test.ts`: edits/usages; stored-cache assertions retire;
  server owns next-print dots. Keep theme assertions. Run changed fixture files, preview/draft and delivery/reprint suites.
- Server `src/{configuration-transfer,configuration-import,configuration-import.previous-export}.test.ts` and provisioning
  `src/configuration-transfer.boundaries.test.ts`: cache-free export/import and outdated format. Run fiscal write-path.e2e/inmutabilidad and server till-api.sell-published/till till-app-menu-refresh unedited.

**Schema and verification:** rebuild core; PR first line: “Every venue is reset: core; backups and exports from before this cannot be restored or imported.”
Raise provisioning `src/configuration-transfer.ts`'s format from main's value (39 here) by one.
Before/after protection lists: six venue builds lose `departments.columns[receipt_logo_rasters]` and change
`departments.columnOrder`; two change-feed builds change `waitron_change_departments_update.when`. Nothing else; run rebuild guards (rules §§2–5).
PR: `Sale-path read changed:` disclose print-time conversion inside the transaction, the measured sample and unmeasured rendition cost;
the no-logo bench fixture cannot measure this cost. Keep the normal periodic bench schedule. Leave money/hashes, vb6, theme rasters and drawer jobs out.
Delete the completed cache-drop backlog paragraph; retain provenance in architecture decisions; add dated pointers from vb5/§8.4 and update current cache prose in `docs/developers/conventions-data.md`.
**Estimate:** production +60/−150; tests/support +250/−200, generated files/pure deletions reported separately. Stop at the runbook's growth threshold.
