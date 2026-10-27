# A948: the meal's operation date and business-invoice delivery

Researched on 27 October 2026. A948's switch has landed; this note addresses its two separate
follow-ups. The operation-date rule below is a proposal for the owner, not an approved change
or an adviser answer. The B2B timing conclusion comes from the current BOE texts and AEAT's
7 October notice. B2B means an invoice from one business to another.

## Proposed rule: record the day the meal ends

Use the venue's calendar date on which the meal's service finishes as an F1's operation date.
Keep the actual invoice issue date separately. Print the operation date when the two differ.
Do not substitute the bill's opening day, the reporting business day or a later payment day.

This treats a restaurant meal as one completed service. That is our proposed application of
the general service rule, supported by the cleaning-service analogy below; neither source
expressly decides when a restaurant meal finishes. S4 remains with the adviser.

| What happened, in the venue's local time                                     | Proposed operation date | Issue date                                         |
| ---------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------- |
| Bill opened 27 October at 23:30; meal ends and F1 issues 28 October at 00:40 | 28 October              | 28 October; no separate operation-date row         |
| Meal ends 27 October at 23:50; F1 issues 28 October at 00:10                 | 27 October              | 28 October; show both dates                        |
| Meal ends and unpaid F1 issues 27 October; the guest pays on 30 October      | 27 October              | 27 October; collection keeps that invoice          |
| Meal ends and F1 issues 28 October at 00:40; staff close the table at 01:10  | 28 October              | 28 October; closing the table changes neither date |

**Recommended way to record the fact:** staff confirm the meal's completion date before its
first F1 issuance, initially offered the current venue date. They can select an earlier date
when the meal finished before midnight. Retain that accepted date through a card-provider
wait, lost answer and restart. A later automatic issuance must use the retained fact, not the
recovery clock. A change that resumes service before issuance must invalidate the earlier
completion confirmation. The exact interaction and storage are implementation design work
after approval; no new mandatory screen or database migration is specified here.

Payment before service finishes is an advance-payment question under S3, not a completed-meal
case. Paying, delivering the last dish and pressing Finish table are not automatically evidence
that the whole service has ended. Do not defer an otherwise due invoice until table closure.
Previously issued invoices and copies retain their saved dates; this proposal changes future
issuance only. A696's venue-clock work and A739's payment work remain separate dependencies for
any affected implementation paths.

The alternatives are to keep the provisional opening-day rule, or always use the issue day.
The first loses the first example's service day; the second loses it in the delayed-issuance
example. Neither is the recommendation.

**One owner decision:** approve this completed-meal rule and the confirmation approach, while
keeping S4 for the adviser, or retain the opening-day rule pending the adviser's answer?
Recommended: approve. Implementation waits for that answer and a reviewed implementation design.

## Sources for the date proposal

Short Spanish excerpts precede their English reading. BOE excerpts were checked against the
pages fetched on 27 October. The DGT conclusion has the more limited verification described
in its row; do not describe it as a restaurant-specific ruling.

| Source and provenance                                                                                                                                                                                                 | Source's words                                                                | Reading and limit                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LIVA, article 75.Uno.2º](https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740#a75), consolidation updated 7 October 2026                                                                                            | «cuando se presten, ejecuten o efectúen las operaciones gravadas»             | VAT on a service arises when it is performed. This does not define restaurant completion. Article 75.Dos separately addresses advance payments.                                                                                                                                                                        |
| [Invoice regulation, article 6.1.i](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696#a6), consolidation updated 31 March 2026                                                                                    | «siempre que se trate de una fecha distinta a la de expedición de la factura» | The operation date is required separately when it differs from the issue date. Article 11 governs issuance deadlines; choosing a date does not authorise late issuance.                                                                                                                                                |
| [DGT V1476-13, 26 April 2013](https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=V1476-13), retained quotation in [the 9 October research, §1.11](2026-10-09-invoice-timing.md#111-a-meal-past-midnight) | «al finalizar la referida prestación»                                         | The retained ruling dates a sewer-cleaning service lasting several days at completion. Applying that to a meal is an analogy. Today's official search result confirms the facts and ruling number; its document endpoint returned HTTP 401, so the conclusion's original text was not independently revalidated today. |

## What Waitron currently records

Source reading at `8718f45e0f3fde0c218b3d92cdab8535e8deb500`, not a runtime qualification:

- [`recordSale`](../../../packages/core/src/record-sale.ts) reads a linked bill's `openedAt`
  and location zone to save `sales.operationDate` for F1. Without a bill it derives the date
  from the issuance reading. F2 stores null. The backend call does not pass `operationDate`.
- [`issueWhenFullyPaid`](../../../apps/server/src/bill-payments.ts) can issue before the bill's
  settled-state update. [`finishPartyService`](../../../apps/server/src/finish-party-service.ts)
  is a separate command. Using table Finish as the first capture would miss earlier issuance.
- [`readReceiptIssuer`](../../../apps/server/src/receipt-issuer.ts),
  [`invoice-document`](../../../apps/server/src/invoice-document.ts) and
  [`transaction-receipt`](../../../apps/server/src/transaction-receipt.ts) project the saved
  operation date when it differs from the saved issue day. Copies must keep those facts.

The implementation design must trace all `recordSale` callers, recovery and rendering consumers
before changing the field's meaning, and preserve existing behavioural assertions. No product
code, test check, fiscal writer, hash, chain, number allocation or historical record changes in
this research publication.

## B2B delivery: the rules exist, their mandatory application is later

On **27 October 2026**, RD 238/2026 and its public-solution order are in force, but the general
structured B2B invoice obligation is not yet applicable. The relevant dates are **6 October
2027** for an issuer whose previous calendar year's volume of operations exceeded EUR8 million,
and **6 October 2028** for the rest. AEAT states these dates expressly; this is no longer only
the date calculation in the 9 October research.

| Source and provenance                                                                                                                                  | Source's words                                                                                                     | Reading                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RD 238/2026, final provision four](https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295#df-4), original text published 31 March 2026                  | «la aplicación efectiva de este real decreto quedará diferida»; «Doce meses después»; «Veinticuatro meses después» | Effective application waits 12 or 24 months from the order's entry into force.                                                                                                                                                          |
| [Order HAC/1028/2026, sole final provision](https://www.boe.es/buscar/doc.php?id=BOE-A-2026-20587), published 5 October 2026                           | «entrará en vigor el día siguiente al de su publicación»                                                           | The order entered into force on 6 October 2026, starting those periods.                                                                                                                                                                 |
| [AEAT's 7 October 2026 notice](https://sede.agenciatributaria.gob.es/Sede/todas-noticias/2026/octubre/7/solucion-publica-facturacion-electronica.html) | Dates stated by the agency; see its three dated bullets                                                            | AEAT confirms the two issuance dates above, and a later 2029 reporting date for individuals and income-attribution entities.                                                                                                            |
| [RD 238/2026, articles 3, 4 and 7](https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295#a3)                                                            | «mensaje informático de carácter estructurado»                                                                     | Full invoices to the specified Spanish business recipients fall within scope; ordinary simplified invoices are excepted, qualified simplified invoices are not. A PDF alone does not satisfy the future structured-message requirement. |
| [Invoice regulation, articles 8 and 9.2](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696#a9)                                                     | «su destinatario haya dado su consentimiento»                                                                      | Ordinary electronic delivery still needs recipient consent outside mandatory cases; paper remains available under article 8.                                                                                                            |

**Go-live consequence, our reading:** for ordinary private-business customers before the
applicable date, provide the required full invoice on paper or by an agreed electronic delivery,
with the required invoice content, preservation, authenticity, integrity and legibility. A
structured B2B connector is not a prerequisite imposed by this deferred mandate for such a
go-live. This does not qualify Waitron's existing PDF, email, paper or retention implementation.
Their outstanding checks remain outstanding. Public-administration invoicing is a separate scope.

Replace the vague “settle applicable B2B delivery” follow-up with those current delivery checks
and a separate future structured-B2B integration item. Before that implementation, establish the
issuer's threshold and the applicable recipient/operation scope, then design structured exchange,
public-solution copies and required state/payment reporting. This research does not build or
qualify that integration, select a provider or change the owner's already-landed F1 switch.
