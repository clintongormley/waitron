# A1511 accountant export build plan

**Status:** Sol authored the draft; Claude reviewed it; the driver incorporated the findings. Watcher clearance is still required. The owner chose the generic workbook, not this implementation: [recorded decision](../specs/2026-11-11-a1511-accountant-export-proposal.md#owner-decision-2026-11-11), main `002434b43cb6c4dd76c0f6bd29d3f326e1c47e25`.

**Finish line:** A person holding `report.export` downloads one XLSX from Sales & takings for inclusive From/To calendar dates, with exactly two sheets: issued invoices and recorded purchases. Slice 1 delivers the HTTP API and its tests; the normal dashboard action arrives in slice 2.

## Recorded-data contract

Read core commercial tables across all venue nodes, regardless of payment. Compare `date(issued_at, printf('%+d minutes', issued_offset_minutes))` against inclusive boundaries, following `packages/reporting/src/vat-return.ts:35` without its `activeSalesClause`. Reuse `requireRange`; pass purchases next-calendar-day `to` because `listPurchaseInvoices` uses an exclusive upper bound (`packages/purchasing/src/operations.ts:254`).

Export invoice/node identity, formatted number, issue/operation dates, recorded customer identifiers/name/address, stored VAT groups and signed totals. Kind is corrective when `correctsSaleId` exists; otherwise use the counterparty-tax-id full/simplified rule from `transfer-closed-export.ts:85`. Link corrections to original id/number even outside the period. Exclude `sale_substitutions.substitution_sale_id` rows, retaining their original tickets. Include void status and the complete UTC `voidedAt` instant (heading “Voided at (UTC)”), including later voids (`packages/core/src/record-void.ts:91`). Use ISO calendar dates, never spreadsheet date serials.

Purchases retain supplier identity/number, issue/receipt dates, entered gross, regime, deductible percentage and ordinary/capital VAT classification. Reuse the reader's money/rate conversions. Independently flag negative gross and gross unequal to the exact sum of bases plus tax; preserve entered VAT lines and infer no credit VAT.

In both sheets, emit one row per VAT group/line, repeat identity and show gross only once per invoice. Use shared Decimal helpers without rederiving VAT; absent facts stay blank.

## Slice 1: HTTP API and tests, within 3 hours to open PR

Create `apps/server/src/accountant-export.ts` for the period reader and a small XLSX writer limited to these two sheets, literal strings, decimal number cells and a fixed two-decimal style. Reuse existing `fflate` (`download-archive.ts:2`); add no dependency or generic spreadsheet framework. Use inline strings without formula elements; XML-escape values and replace XML-1.0-forbidden characters with U+FFFD. Sheet names are fixed EN/ES literals within 31 characters, without `: \ / ? * [ ]`; write numbers as plain decimals. Create `apps/server/src/i18n/accountant-export.ts` for headings and visible caveats: F3 replacements omitted/original tickets retained; voids flagged rather than netted; purchases editable/deletable; negative/unreconciled purchases need accountant handling.

Add POST `/management-api/reports/accountant-export?from=&to=` in `report-api.ts`, reusing attachment/permission/activity conventions. Authorise, read sequentially and record `accountant_export.downloaded` in one transaction; declare its dates/counts-only shape in `packages/db/src/activity-kinds.ts`. Encode after releasing the transaction; return XLSX MIME, dated filename, no-store and nosniff.

Create `accountant-export.test.ts` beside it: real `useVenueDb` selection cases for offset boundaries, purchase receipts, mixed VAT, corrections, F3 and voids; workbook cases own literal cells, totals once, purchase flags/scales and two header-only empty sheets. `report-api.accountant-export.test.ts` owns auth/permission refusal, invalid range, POST-only attachment and activity failure. One hostile-name fixture covers escaping, forbidden controls, formula-looking text and numeric spelling. Use installed LibreOffice as a one-off independent reader: open/re-save both sheets without repair and check values/types, retaining the fixture checksum/result in the PR; no reader dependency enters CI. Measure selection/write-lock duration and encoding separately on the bench year, comparing the held lock with the existing annual `computeVatReturn` report on the same data. A larger redesign returns to the watcher.

## Slice 2: dashboard download, within 3 hours to open PR

Modify dashboard `src/api/client.ts`, `src/screens/dashboard-sales-screen.ts`, `src/i18n/strings.ts`. Reuse `canExport`, dates and Blob download; explain calendar dates beside the action and keep download refusal separate from load errors. Update server `src/guide/{en,es}/data-protection.md` for this additional customer/address disclosure. The action explains calendar dates and the workbook carries its caveats; add no guide section, help bubble or link.

Extend dashboard `client-routes.test.ts`, `dashboard-sales-screen.test.ts` and its `.a11y.test.ts` for request/download, permissions, chosen dates, retry and accessibility. Run guide-content/guide-links guards; inspect both themes and phone width. Claim neither complete books, immutable purchase history, named-program import support nor AEAT qualification.

Observe focused failing tests before implementation. Run named files through `pnpm --filter @waitron/server exec vitest run` or `pnpm --filter @waitron/dashboard exec vitest run`; then finish-branch, the normal push hook and current-head CI. Estimated added/removed lines: slice 1 production +350/−0, tests +400/−0, wording +60/−0; slice 2 production +120/−0, tests +120/−0, wording/guides +40/−5. No new test support, tables, ledger, protocol, persisted export, fiscal writes/golden-test changes, new void/replacement operations, sync, native adapters or cash/card ledgers.
