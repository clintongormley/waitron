# A980. Download drawer and payment actions

Staff can find their own cash movements, drawer closes, bill payment roles, receipt reprints
and payment-hold decisions in the existing ZIP. The administrator's copy for that person uses
the same readers. Scope comes from Lane F's A980-DOWNLOAD-DRAWER-PAYMENTS queue entry (watcher,
22 November 2026 at 09:02) and the [data protection design](../specs/2026-10-22-a980-data-protection-design.md)
§2.1 row s12. Codex wrote the plan. Claude reviewed the first draft.

## Core actions

- Extend `apps/server/src/personal-data-actions.ts` with `drawerEntries`, `billPayments` and
  `receiptReprints` arrays and counts, present whenever `actions.json` is present. Filter each
  new read by the subject and sort by time and ID. Reuse the chunked sale lookup for reprints
  and bill payment lookup for invoices. Take one additional `withWriteLock` turn per table
  after the snapshot. The first pass is five fixed turns plus the two chunked lookup counts.
  Allow one scan per table. For scale, assume 30 payments per shift, 250 shifts per year and
  five years, or 37,500 payments per waiter. Time the reads on representative synthetic rows
  during the build and take a long hold back to the watcher.
- For `drawer_entries.person_id` include cash in, cash out, count, recount and finish, with
  kind, time and the signed recorded amount in decimal money. Finish records the amount taken
  to bank. The payment and refund rows repeat the requesters already covered in the bill
  payment and refund sections. State that reason at the filter and in the column inventory.
- For `bill_payments.requested_by` and `attested_by`, include method, applied amount, tip, state,
  request time, invoice number if filed and the subject's roles on one row. For the attester
  include `received_at` or `failed_at` as the attestation time. A later decline keeps the
  original receipt time. For `receipt_reprints.person_id`, include request time and invoice
  number. Exclude person identifiers, typed notes, drawer facts, card and provider data.
- Start with failing real-database cases in `personal-data-actions.test.ts` for the exact new
  entries, colleague exclusion, a payment with both roles, a payment without an invoice and
  someone with only new actions. Seed distinct cash reasons and attestation notes for the
  privacy check. Keep the exact read-count checks with the new formula. In
  `personal-data-actions.coverage.test.ts`, move the four named actor columns from pending
  to read and give each of the three new source tables its own included and excluded fields.
  Extend the shape checks in the actions, own-export and adjustments example tests and record
  all changed assertions in the PR.

## Payment holds and ZIP wording

- Follow adjustments. Export `PAYMENTS_PERSONAL_DATA` in `packages/payments/src/{personal-data,index}.ts`
  and add it to the payments entry in `packages/composition/src/modules.ts`. Read the subject's
  `hold_decided_by` rows during prepare. Write `payment-holds.json` for a nonempty result when
  the module is enabled. Include order number, decision and decision time.
- Start with `packages/payments/src/personal-data.test.ts` covering two deciders, an undecided
  hold and note and identifier exclusion. Inventory all payments actor columns and every
  field in `payments` in `personal-data.coverage.test.ts`, using the exports checked by
  `schema-ownership.test.ts`. Update the seat checks in `composition.test.ts`.
- Update the English and Spanish staff and data-protection guides and ZIP README copy.
  Run the changed test files, the existing staff and boot export cases and the full-disk
  cases named in the data conventions. Remove the delivered columns from
  `docs/backlog/data-protection.md` and keep the remaining work.

Expect about 185 production lines, 350 test/support lines and 85 guide and plan lines.
Menu and booking actions, `sales.operator_id`, other payment actors and schema changes stay out.
