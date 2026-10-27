# A739: owner-directed payment and receipt flow

**Native SVG design artwork, amended 2026-10-27.** Read the
[current revision](../../../superpowers/specs/2026-10-22-a739-owner-payment-and-receipt-flow.md)
with these boards. The owner's ~11:55 **no cash slips** answer supersedes cash-yes and the
cash-checkbox proposal. EUR10 cash on EUR30 leaves EUR20 and prints no slip. Only card has
**Print card slip**. The ~09:05 final-document flow and timing A remain answered; the older
A/B boards and post-payment slip row remain historical. No product rebuild precedes full
revision agreement.

Every board contains all four scenarios, with three screen snapshots per scenario:

1. Counter EUR30: pre-card checkbox, confirmed payment, Receipt selected with separate
   Print and Email, and expanded Full invoice with complete example identity fields.
2. Three EUR10 card payers at a table: EUR20/EUR10/EUR0 historical balances, remaining amount and
   next-tender screen, then the final whole-bill document question. None reveals no fields
   and does not cancel a requested card slip. The table stays open.
3. EUR30 bill, EUR10 paid, remove EUR20 unpaid: successful edit opens a fresh EUR10 document
   question, owned by the edit. No new payment. A Receipt-selected continuation shows delivery.
4. Later receipt-to-full-invoice request: existing receipt copy remains distinct from the
   unavailable fiscal substitution action. No new charge, drawer action or deferred F2 issuance.

The Full invoice selection and its delivery are a **target preview with the A556 fiscal
dependency**, not working public F1/F3. The source register in the revision distinguishes
existing core writer code from missing public orchestration. No prepayment identity entry is
promised. Details are illustrative, not verified customer or tax data. The four main journeys
are unchanged. The checked card box in the counter journey illustrates a request on a known
no-paper reader, not its initial value.

The lower panel folds in the owner's 2026-10-26 ~07:00 answer: for a reader supplying its own slip,
the native checkbox starts **off**; ticking requests its slip. An effective control requires proved
adapter and hardware behaviour. The real SumUp/Stripe adapter probes did not forward the
requested print choice; physical paper remains unverified. The panel therefore shows the native
checkbox **unticked and disabled**, as a target awaiting proof. It promises no suppression of paper.
Known no-paper readers retain the initially off Waitron checkbox; unknown capability stays
unavailable. No extra Waitron slip is proposed for own-paper or unknown readers.

That capability fallback is a **new, unapproved owner subquestion**, not a reinterpretation of the
YES. The amendment recommends explained unavailable native control and qualification before enabling
it; alternatives hold all A739 or name another change. **Durable Document choice pending with no
deadline or zone fallback** and **complete revision approval** remain separate unapproved questions.
The pending-choice alternatives require an answer before leaving or apply zone policy after five
minutes. The amendment's Marta/Daniel example describes future recovery through a closed bill,
without another charge or issuance. The boards do not claim that durable recovery exists today.

| Language | Theme | Width | Native artwork           | Same-name PNG target     |
| -------- | ----- | ----- | ------------------------ | ------------------------ |
| English  | Light | 390   | [SVG](en-light-390.svg)  | [PNG](en-light-390.png)  |
| English  | Dark  | 390   | [SVG](en-dark-390.svg)   | [PNG](en-dark-390.png)   |
| Spanish  | Light | 390   | [SVG](es-light-390.svg)  | [PNG](es-light-390.png)  |
| Spanish  | Dark  | 390   | [SVG](es-dark-390.svg)   | [PNG](es-dark-390.png)   |
| English  | Light | 1280  | [SVG](en-light-1280.svg) | [PNG](en-light-1280.png) |
| English  | Dark  | 1280  | [SVG](en-dark-1280.svg)  | [PNG](en-dark-1280.png)  |
| Spanish  | Light | 1280  | [SVG](es-light-1280.svg) | [PNG](es-light-1280.png) |
| Spanish  | Dark  | 1280  | [SVG](es-dark-1280.svg)  | [PNG](es-dark-1280.png)  |

**PNG previews were regenerated from all eight amended SVGs and inspected in real Chromium,
2026-10-27.** The changed reader panels were checked in both languages/themes at 390 and
1280 px. The four main journey drawings remain byte-for-byte unchanged. Phone artwork is a long
board of consecutive screens; desktop uses three columns. These are static design views.

Artwork uses native text, rectangles and paths, without embedded images, scripts or external
assets. Snapshot literals match `packages/ui-core/src/tokens/colors.css`, reached through
`packages/ui/src/tokens/index.ts`; spacing/radius/type/tap sizes follow `structure.css`:
4/8/12/16/24/32 spacing, 4/8/16 radii, 12/14/18/22 type, 44 minimum targets and 56 fields.
Buttons and choice rows are at least 44 px high. Error drawing is the Receipt email form
**after an invalid attempt**: inline email error, one bottom correction message, retained input
and quiet disabled Email while invalid. Print is a separate valid command. Full-invoice Save
is quiet while unchanged; delivery is disabled for the fiscal dependency.

These are static design snapshots. They provide no claim of running UI, accessibility tests,
physical printing, fiscal approval or legal verification. Future implementation must exercise
transitions, concurrent/lost responses, mutable equipment versus fixed accepted commands,
original/copy history and separate Print/Email behavior.
