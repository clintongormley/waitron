# Match the words used for comps and cancellations

Today two English till refusals say “discount”, and the Spanish Adjustment report says «anulado». Staff will see “comp” and «cancelado» in those places. The watcher queued this for A957 and A1011 point 9 under SETTLED-SMALL, citing design D22. [Backlog](../../backlog/till.md#settled-small-small-answers-the-owner-gave-that-are-not-built-yet)

Task 15 stays open for the watcher. Counter's separate **Take the rest** button was removed in #2725, and the ordinary part-paid table and Counter tests both exercise **Pay**. The desktop table code still has a long-label branch for an open bill with payments and a zero total. The Finish table fixture in `apps/till/src/till-app-parties.test.ts` models a zero-total bill holding money, but does not exercise that payment button. Leave the label, payment handling and both Task 15 backlog notes for the watcher's decision. The sent-extras and extras-picker rows also stay queued.

1. In `apps/till/src/i18n/codes.test.ts`, extend the existing bilingual adjustment-refusal case with the first English assertion below and replace its existing `no_reduction` English expectation with the second. Keep the Spanish and fallback checks. Run the tests and see the old wording fail before changing just the two English values in `apps/till/src/i18n/codes.ts`.
   - `adjustment.exceeds_amount` reads “That comp is more than the amount it applies to. Enter a smaller amount”.
   - `adjustment.no_reduction` reads “That takes nothing off. Check whether it is already free, or enter a larger comp”.
2. In `packages/adjustments/src/dashboard/adjustment-report-screen.test.ts`, extend the existing Spanish headings case to check the cancelled total's label and the cancellation column heading against the literal phrases below. Watch the old words fail. In `packages/adjustments/src/dashboard/strings.ts`, use «Valor de carta de lo cancelado» for the figure and «Valor de carta cancelado» for the column. The report already uses these keys in its summary, people table and breakdowns.
3. Run both changed test files. Check the rendered report and Comp refusal on phone and desktop, in both themes and languages. In `apps/server/src/guide/{en,es}/table-service.md`, align the existing reason-picking instruction with the Comp and Descuento labels. Run `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`. Remove the A957 and A1011 wording entries from `docs/backlog.md` and `docs/backlog/till.md`, keeping the other rows. Record the exact changed English assertion in the pull request.

Estimate 4 changed product lines and 8–14 test lines, plus the guide sentence edits and backlog edits.

The watcher cleared the wording plan on 26 November at 08:55. The branch review found that a zero-total bill still needs a way to close after its last payment is refunded. At 09:42 the watcher queued that work as A1602 and cleared this branch to land the four wording changes.
