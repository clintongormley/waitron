# A1635 · Pick part of a paid dish row

Staff can choose how many of an identical dish to refund when its portions share one paid
receipt line. This follows the [Refund design](../specs/2026-11-26-till-handheld-redesign-design.md)
§§7.12–7.13, panel `bg` 2, and the watcher's 28 November 02:34 note. Start after A1635's shared row
and stepper land. Use today's receipt entry while Lane O's replacement is in flight.

- [ ] **Read the portions.** In `give-back-read.ts`, let `readGiveBack` reuse the filing and
  pairs already read by `cancelsAndFreeByLine` in `cancelled-lines.ts`. Map original line IDs
  to the corrective's target as that helper does. Use the cents from `portionShares` in
  `cancellation-refund-value.ts` and the existing cancel order, last portion first. The
  initial portion sometimes holds a remainder cent and is picked last. Return the shares as
  an optional ordered list on `GiveBackLine` in the server and till types. The existing picker
  still serves measured and unlinked lines, unavailable and given-free dishes, all cancellation
  rows, and divided set menus. Priced extras keep their existing separate selection.
- [ ] **Use the remaining amount already read.** Offer the count only where
  `readCorrectableNow` supplied a real remaining amount for that row and it equals the sum of
  its shares. This read already deducts filed corrections from the target, including a
  replacement. A correction only identifies the filed row, so a row with a prior corrective
  gets its current editable amount up to what is left. An amount refund can reduce several rows.
  Only rows whose balance was reduced switch to amount-only, including where a tiny refund
  leaves other rows whole. The watcher cleared reusing this read at 02:55 and confirmed the
  per-row rule at 03:01. The PR names that the picker reads the same amount the refund write
  checks. It adds no query of corrective records.
- [ ] **Pick within one filed row.** In `give-back-lines.ts` and `give-back-dialog.ts`, selecting
  a count sets the editable amount to the sum of those shares, even if the amount had been
  typed. Later edits work as today. The request sends the existing filed line ID once. Keep the
  count in `give-back-draft.ts` so it restores with the amount and selection. Offer the stepper
  with one selected row. While a partial count is picked, disable the other rows and explain
  that choosing all portions or clearing the row brings other rows back. Whole-row selection
  still works across rows. This avoids asking the current allocator, which receives one total,
  to guess what should come from each row. Keep the existing filled cancellation selection,
  amount and `fromCancel` handoff, including its recorded `cancelled.quantity`.
- [ ] **Verify.** `give-back.test.ts` checks the linked portions of a paid sale, a remainder
  cent, and a prior corrective on the same row. `give-back-dialog.test.ts` checks the count,
  edited amount, one-ID request, other rows and the filled cancellation. The unsaved suite
  checks restoring the count. Add English and Spanish strings and update both guides and the
  backlog. Run unedited fiscal hash and immutability tests. Compare the 390 px till pictures
  in both languages and themes against `bg` 2, showing the partial mark and the explanation
  beside disabled rows. Lane P reads them and the owner lands.

**Size:** about 180 production lines and 130 test lines. The receipt, request, filing, and
refund writes stay as built. The approval, destination and result layouts are later slices.
