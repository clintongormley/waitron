# A1511 accountant export build plan

**Status:** Sol-authored approach, awaiting Claude review and watcher clearance before implementation. The owner chose the generic workbook, not this design: [recorded decision](../specs/2026-11-11-a1511-accountant-export-proposal.md#owner-decision-2026-11-11), main `002434b43cb6c4dd76c0f6bd29d3f326e1c47e25`.

**Finish line:** With `report.export`, you download one XLSX for inclusive From/To dates, containing exactly two sheets: issued invoices and recorded purchases. Deliver individual tickets; leave daily grouping for a later accountant discussion.

## Recorded-data contract

Read core commercial tables only, across all venue nodes, irrespective of payment/settlement. Invoice selection compares `date(issued_at, printf('%+d minutes', issued_offset_minutes))` against both inclusive boundaries, following the date expression in `packages/reporting/src/vat-return.ts:35`, without its `activeSalesClause` policy. Reuse `requireRange`; pass purchases `from` and next-calendar-day `to` because `listPurchaseInvoices` uses an exclusive upper bound (`packages/purchasing/src/operations.ts:254`).

Use `sales`' stored VAT breakdown, operation date and counterparty fields (`packages/db/src/schema/sales.ts:84`); leave absent facts blank. Include invoice/node identity, formatted number, issue/operation dates, recorded customer identifiers/name/address and type (simplified/full/corrective). Corrections retain signed bases, tax and total plus original id/number, even outside the period (`packages/core/src/record-correction.ts:324`). Exclude rows referenced as `sale_substitutions.substitution_sale_id`, retaining original tickets (`sales.ts:330`). Keep issued invoices with recorded void status/timestamp (`sale-voids.ts:18`), including later voids; never suppress or silently net them.

Purchases retain supplier identity/number, issue/receipt dates, entered gross, regime, deductible percentage and ordinary/capital VAT classification. The existing reader converts cents and basis points (`operations.ts:89–110`). Flag negative gross and gross unequal to the exact sum of bases plus tax independently; preserve positive VAT lines and infer no credit VAT (`purchasing-api.ts:81`, `operations.ts:121`).

Emit one row per stored VAT group/line, repeating identity but gross total only on the first row per invoice. Use shared Decimal/money helpers; never rederive VAT. Counterparty text, identifiers and dates are explicit literal string cells, including formula-looking text; amounts are numeric cells formatted to two decimals.

## Slice 1: complete authorised download, within 3 hours to open PR

Create `apps/server/src/accountant-export.ts`: period reader plus workbook renderer, reusing `formatInvoiceNumber` and `listPurchaseInvoices`. Create `apps/server/src/i18n/accountant-export.ts` for venue-language headings and visible caveats within both sheets. Add POST `/management-api/reports/accountant-export?from=&to=` in `apps/server/src/report-api.ts`, following its attachment, permission and activity conventions. Authorise and read sequentially in one transaction; record `accountant_export.downloaded` through `recordActivity`, declared in `packages/db/src/activity-kinds.ts`, with dates/counts only. Encode after releasing the transaction; return XLSX MIME, dated filename, no-store and nosniff.

Use `exceljs`; qualify and pin its version in `apps/server/package.json` and `pnpm-lock.yaml` during this slice. Run the server bundle build and inspect generated `dist/server.js.NOTICES.txt` for it and bundled dependencies; existing Docker copying ships these under `/app/third-party/`. Add exact-version fallbacks under `deploy/third-party/npm-fallback/` only if required. Do not invent an encoder.

Create `apps/server/src/accountant-export.test.ts`: real `useVenueDb` selection assertions for offset boundary crossings, inclusive purchase receipts, mixed VAT, signed corrections, F3 and voids; decoded workbook assertions for totals once, purchase flags/scales, literal cells and two header-only sheets for an empty period. Create `apps/server/src/report-api.accountant-export.test.ts` for authentication/permission refusal, invalid ranges, POST-only attachment and activity failure, without repeating arithmetic.

## Slice 2: dashboard download, within 3 hours to open PR

Modify `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/screens/dashboard-sales-screen.ts`, `apps/dashboard/src/i18n/strings.ts` and `apps/dashboard/src/help-guide.ts`. Reuse `canExport`, date controls and Blob download; explain calendar-date selection beside the action, independently of business-day reports. Keep download refusal separate from report-load errors.

Add EN/ES `apps/server/src/guide/{en,es}/accountant-export.md` with shared section ids; register in `apps/server/src/guide-catalogue.ts`. Explain mutable/deletable purchases, repeat-download changes, negative/unreconciled flags and accountant handling of voids. Claim neither complete books, immutable purchase history, named-program import support before a real accountant trial, nor AEAT qualification.

Extend `apps/dashboard/src/api/client-routes.test.ts`, `apps/dashboard/src/screens/dashboard-sales-screen.test.ts` and `apps/dashboard/src/screens/dashboard-sales-screen.a11y.test.ts` for request/download, permission visibility, chosen dates, retry and accessibility. Run existing `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`; visually inspect both themes and phone width.

For each slice, observe focused failing tests before implementing. Run slice 1 with `pnpm --filter @waitron/server exec vitest run src/accountant-export.test.ts src/report-api.accountant-export.test.ts`; slice 2 runs the three named dashboard files through `pnpm --filter @waitron/dashboard exec vitest run`. Use finish-branch, the normal push hook and current-head CI. Estimated added/removed lines: slice 1 production +280/−0, tests +230/−0, dependency lock/notices/wording +850/−0; slice 2 production +120/−0, tests +120/−0, wording/guides +50/−0. No new test support. No tables, ledger, persisted export, protocol, fiscal writes/golden-test changes, new void/replacement operations, sync, native/journal adapters or cash/card ledgers.
