# A275: invoice now, receive a transfer later

These are proposed design illustrations with synthetic names, accounts and invoices. They are not
screenshots of implemented behavior. They show the recommended partial-transfer scope; the owner
has not approved it. The F1 example needs A231's separate public-enablement gates.

Start with **05-partial-choice-en-light-390.png** on your phone. It shows question 1: record
€2,000 and then €3,000 against the same €5,000 invoice, and reverse a mistaken recording without
erasing the invoice. The smaller alternative accepts one complete-balance payment only.

| Picture             | What to look at                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-issue`          | Issue the invoice and agree transfer terms. No payment is recorded. Finish table remains a separate service action.                                                                                                     |
| `02-awaiting`       | Find the unpaid F1/F2, its contact and the amount still owed in Orders. F2 contact is operational; the fiscal invoice stays anonymous.                                                                                  |
| `03-received`       | A manager records €2,000 already received after checking the bank, retaining the bank date and the recording date. €3,000 remains due.                                                                                  |
| `04-close`          | Invoicing and tax belong to the meal day in this proposal; a later transfer changes money received and debt, with no new invoice or drawer movement. This whole-payment example is compatible with either scope choice. |
| `05-partial-choice` | Two receipt entries and an explicit recording reversal, as proposed for question 1. A reversal sends no money back.                                                                                                     |

Each picture has English (`en`) and Spanish (`es`), light/dark, and 390/1280 logical-pixel versions.
The PNGs use twice that resolution so you can zoom. Required fields, all detail columns, access
refusals and complete native form controls are condensed in these illustrations. The written
design defines them; runtime accessibility and physical invoice output remain future checks.

The owner's copy is in `~/My Drive/Waitron mockups/2026-10-20 A275 transfer invoices/`, with
`question.txt`. Only the first policy question is being asked. The remaining choices and full-design
approval follow one at a time; no implementation is authorised by this publication.

[Read the proposed design](../../../superpowers/specs/2026-10-20-a275-invoice-now-transfer-later-design.md).
