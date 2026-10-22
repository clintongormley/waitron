# A275: Final transfer closure

**Synthetic proposed design, 2026-10-22. These are drawn illustrations, never runtime screenshots.**
Read the [complete proposed policy](../../../superpowers/specs/2026-10-22-a275-final-transfer-close-design.md)
before approving it. Only full-design approval remains; [question.txt](question.txt) contains the
exact question and recommendation. No implementation plan or build is authorised.

You finish a €220 meal, issue one F2, close the bill as **To be paid by transfer** and release the
table through normal service checks, retaining any clearing requirement. That classification is
final in Waitron. The day's close shows €220 separately from cash and card. Your accountant exports
the invoices and reconciles the bank outside Waitron. There is no debt list, awaiting-transfer
balance, later receipt entry, partial receipt, reversal or receivables module.

Start with [transfer close, English phone](01-transfer-close-en-light-390.png), then
[daily close/export, English phone](02-daily-close-export-en-light-390.png). The first board shows
review and the result after confirmation. The second shows the day's separate transfer line,
unchanged invoice/VAT figures and a condensed export row with invoice metadata, amount and final
classification. It shows no bank-received date, debt columns or bank-reconciled state.
All names and invoice numbers are synthetic. The main example is F2 €220; the F1 €5,000 note is
only a future enabled path. Public F1 and A555/A948 delivery/enablement gates remain.

## All 16 variations

Widths are **logical pixels**, rendered at 2× for readable zoom. The 390-wide boards scroll
vertically; the 1280-wide boards arrange the same policy side by side. Light/dark colours come
from the current shared token palette. Typography is enlarged for design review; these drawings
do not demonstrate shared component rendering, accessibility, focus, validation, actual export
bytes, invoice output or printer qualification. The spec defines the complete export fields and
permission checks; the pictures condense them.

| Board                     | English light                                  | English dark                                  | Spanish light                                  | Spanish dark                                  |
| ------------------------- | ---------------------------------------------- | --------------------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| Transfer close · 390      | [PNG](01-transfer-close-en-light-390.png)      | [PNG](01-transfer-close-en-dark-390.png)      | [PNG](01-transfer-close-es-light-390.png)      | [PNG](01-transfer-close-es-dark-390.png)      |
| Transfer close · 1280     | [PNG](01-transfer-close-en-light-1280.png)     | [PNG](01-transfer-close-en-dark-1280.png)     | [PNG](01-transfer-close-es-light-1280.png)     | [PNG](01-transfer-close-es-dark-1280.png)     |
| Daily close/export · 390  | [PNG](02-daily-close-export-en-light-390.png)  | [PNG](02-daily-close-export-en-dark-390.png)  | [PNG](02-daily-close-export-es-light-390.png)  | [PNG](02-daily-close-export-es-dark-390.png)  |
| Daily close/export · 1280 | [PNG](02-daily-close-export-en-light-1280.png) | [PNG](02-daily-close-export-en-dark-1280.png) | [PNG](02-daily-close-export-es-light-1280.png) | [PNG](02-daily-close-export-es-dark-1280.png) |

## History and review limits

The owner's 2026-10-21 02:40 decision supersedes the
[old partial-receipts pictures](../a275-invoice-now-transfer-later/README.md), including their old
question file. Those 40 PNGs remain unchanged. Old questions 2–5 are withdrawn; old question 1's
receipt models are retired. The new [Spanish adviser draft](../../../superpowers/specs/2026-10-22-a275-final-transfer-close-design.md#7-stored-research-and-attached-adviser-confirmation)
is attached only and has not been sent.

These illustrations establish no runtime behaviour. The source trace is read-only and marked
runtime unverified at its base SHA in the spec.
