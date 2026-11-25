# Server coverage for giving money back and paying for items

Ship one payment test PR after #4305, then run full CI on main. The watcher asked for tests of the 78 uncovered statement starts from #4257 and #4238 at 06:53 on 25 November in Lane F `questions.md`. Claude reviewed the plan. The watcher cleared it at 07:30 with eight amendments, estimating 450–600 test lines. The changes use existing routes, venue setup and payment fixtures, with zero production lines planned.

| Source | Observable check |
| --- | --- |
| `give-back-plan.ts`, `give-back-api.test.ts` | An invalid way or list names its field. A pending way answers its own reason while another way works. An amount beyond the usable payments is refused. Once the final invoice holds no money, the advance preview allows a plain refund. |
| `give-back-press.ts`, `give-back.test.ts` | Invalid write fields move no money. A pending refund leaves an extra-only request to send later. A declined extra leaves the correction unstarted. |
| `give-back-reader.ts`, `give-back.test.ts` | A first-part refusal writes and sends nothing. An emptied reader card leaves a completed refund and an open correction with no leg. A refusal during automatic filing leaves the recorded leg complete and the correction open. |
| `give-back.ts`, `give-back.test.ts` | A missing required note stops the reader before it gives money back. A holder of `sale.refund` records their own approval and a resend needs that right. Cash comes from the first payment when it holds enough. Inserting a missing part or changing the correction amount on a resend is refused. |
| `bill-payments-api.ts`, `bill-payments-api.test.ts` | Refusals name the invalid pick or field and preserve the source bill. Use the dish-extra fixture in `give-back.test.ts` for a preview of just the extra. |
| `pay-for-items.ts`, `bill-payments.ts`, `pay-for-items.card.test.ts` | Reversing two picks on a resend returns the same bill without charging again. If issuance is blocked after capture, the response identifies the charge and no invoice appears. A partially refunded provider reply also leaves issuance pending. |
| `bill-overpaid.ts`, `bill-overpaid.test.ts` | Keep as tip refuses a used submission ID and pending reader money on an overpaid open bill. The stored moves spend from the newest usable payments first. The branch review dropped two sent-bill cases that had no excess to keep. |
| `tender-refund-sends.ts`, `pay-for-items.card.test.ts` | A completed reader refund remains complete while an advance correction holds the invoice. Closing the correction issues the invoice once. |

Trace the unbound and missing filed line cases without creating new stored rows by hand. Trace guards already covered at their callers, and list the remaining defensive paths and unexpected error rethrows in the PR. Keep the production guards in place.

Run every changed test file. Use a disposable checkout to break the protections and confirm the outcome assertions catch the breaks. Run the existing fiscal hash and immutability suites unchanged. Replay the saved Server coverage at `54a675dae2` before and after on that same source tree. After #4305's extra coverage, the replay starts at 61,047 of 62,288 statements, four statements above the minimum. Report this comparison separately from the full manual run on main after finish-branch and land-branch.
