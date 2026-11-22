# A980. Download drawer and payment actions

Staff can find their own cash movements, drawer closes, bill payment roles, receipt reprints
and payment-hold decisions in the existing ZIP. The administrator's copy for that person uses
the same readers. Scope comes from Lane F's A980-DOWNLOAD-DRAWER-PAYMENTS queue entry (watcher,
22 November 2026 at 09:02) and the [data protection design](../specs/2026-10-22-a980-data-protection-design.md)
§2.1 row s12. Codex wrote this plan.

## Core actions

- Extend `apps/server/src/personal-data-actions.ts` with optional nonempty `drawerEntries`,
  `billPayments` and `receiptReprints` arrays and matching counts in `actions.json`. Keep its
  existing entries and bounded `withWriteLock` reads after the snapshot. Filter each new read in
  SQL by the subject, in time and id order. Reuse the chunked sale-number lookup for reprints and
  the bill payment lookup for the invoice number where one exists.
- For `drawer_entries.person_id` include cash in, cash out, count, recount and finish, with kind,
  time and the signed recorded amount in decimal money. Finish records the amount taken to bank.
  Cash/card payment and cash refund ledger rows stay out. For `bill_payments.requested_by` and
  `attested_by`, include method, amount, tip, state, request time, invoice number if filed and the
  subject's roles. Return both roles in one row when the same person did both. Include the recorded
  outcome time for an attester. For `receipt_reprints.person_id`, include request time and invoice
  number. Omit person IDs, free text, drawer facts, card and provider data.
- Start with failing real-database cases in `personal-data-actions.test.ts` covering the exact new
  entries, a colleague's entries, a payment with both roles and one still awaiting an invoice, and
  a person with only new actions. Keep the existing bounded-read and privacy checks. Reclassify
  exactly those four actor columns in `personal-data-actions.coverage.test.ts`. Record added keys
  and read turns in the PR's Changed test checks.

## Payment holds and ZIP wording

- Export `PAYMENTS_PERSONAL_DATA` in `packages/payments/src/{personal-data,index}.ts` and register it
  in `packages/composition/src/modules.ts`. Follow the adjustments contribution. Read only decisions
  where `hold_decided_by` equals the subject during prepare, then write `payment-holds.json` only for
  a nonempty result. Include order number, decision and decision time. Omit notes and provider
  details. Start with a failing `packages/payments/src/personal-data.test.ts` case with two deciders
  and an undecided hold. Add a payments actor-column inventory in `personal-data.coverage.test.ts`
  using the schema exports already checked by `schema-ownership.test.ts`. Update the existing
  composition seat checks in `composition.test.ts`.
- Update the English and Spanish staff guides and ZIP README words, with focused
  `apps/server/src/personal-data-readme.test.ts` checks for both languages. Run the core actions,
  payments export, composition and README files, plus the existing own, staff and boot export
  cases. Keep permission checks and existing assertions on old entries. Remove the delivered
  columns from `docs/backlog/data-protection.md` and retain its remaining work.

Expected diff is about 185 production lines, 320 test/support lines and 75 guide and plan lines.
Menu and booking actions, `sales.operator_id`, other payment actors and database changes stay out.
