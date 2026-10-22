# A739: owner-directed payment and receipt flow

**Native SVG design artwork, 2026-10-22.** Read the
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
promised. Details are illustrative, not verified customer or tax data. Card is shown checked
in the counter journey on a known no-paper reader; an unchecked initial value is a builder
proposal. The lower panel proposes the reader-paper display, preserving the already-answered
no-duplicate policy: known own-paper shows **Reader supplies its slip**, with no effective
Waitron checkbox; known no-paper keeps the pre-card checkbox; unknown capability explains
that Waitron slip printing is unavailable. The app neither controls nor suppresses native paper.

The revision's **one next question** asks whether that display fits the new checkbox requirement,
with a **yes** recommendation. For EUR10 card on EUR30, own-paper means no extra Waitron slip;
known no-paper lets you tick the checkbox before Card to request a non-fiscal slip showing
EUR10 received and EUR20 left once payment succeeds.
The pending-choice/no-timer/no-zone-fallback policy and complete revision agreement are later,
separately unapproved topics, not bundled into this question.

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

**PNG previews await parent regeneration and visual QA after this ~11:55 SVG revision.** The
existing PNGs have not been regenerated for this SVG revision; use the SVGs for this decision.
The table retains their same-name render targets. Phone artwork is
a long board of consecutive screens at 390 px; desktop uses three columns at 1280 px.

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
