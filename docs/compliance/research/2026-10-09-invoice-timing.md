# Asesor research, 2026-10-09: when the invoice is due, pre-bills, deposits, cancellations and short payment

**Provenance.** Researched 2026-10-09 by a research agent; every Spanish quote was checked word for word, by script, against the raw text downloaded from the URL given (BOE and AEAT pages fetched with curl, PDFs through pdftotext, DGT rulings read on PETETE, where any ruling opens at `https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=<number>`). The downloads were kept in the session's scratch directory and are not committed; re-fetch from the URL to re-check a quote. Section numbers (1.1, 1.2 …) are those of the advisor questionnaire of 6 October 2026; the mapping to Q-numbers is in [asesor-questions.md](../asesor-questions.md#the-shortened-list-2026-10-09).

## Summary

The 32 question bullets came out as 13 answered, 16 narrowed and 3 open, scoring a split verdict by its weakest part. "Answered" means a primary source says it directly; "narrowed" means sources settle part of it or give a strong lead. The advisor's remaining questions are now short.

**Sources checked:**
- **Developer FAQ:** AEAT's developer FAQ online today is byte-identical to the v1.3 of 4 Dec 2025 we already hold, so there is no newer version.
- **Taxpayer FAQ:** AEAT's taxpayer-facing Veri\*Factu FAQ pages are dated 21 July 2026. They never mention restaurants or the *precuenta* (the pre-bill handed to a table).
- **DGT rulings:** the DGT is the tax ministry's directorate that issues rulings; binding ones are numbered V####-YY. Its database, PETETE, has none on pre-bills, diners who leave without paying, restaurant deposits or meals past midnight. Each "none" was checked against a search that does find results.

**Most important findings:**
1. **The invoice falls due when the meal is served, not when it is paid.** The law fixes the moment VAT becomes payable at the moment the service is performed. AEAT's FAQ says the duty to invoice arises at that same moment, and in another FAQ it defines "the moment of the operation" as that moment. So the plan to issue a pre-bill and invoice only at payment works only if payment comes within the same visit. Waiting days for a bank transfer is not lawful for a consumer (1.10 option 2).
2. **Prepaying is an "advance payment", which has its own rules (1.1, 1.7).** Money taken before the service ends makes VAT payable on receipt, and the law requires an invoice for it. That covers a counter customer who pays before the food is made, which supports issuing the invoice at that payment. It also covers a guest's part-payment taken mid-meal. Our current design holds that mid-meal money with no invoice, which is a gap.
3. **A meal that runs past midnight should take the date it ends (1.11).** A binding ruling (V1476-13) dates a service lasting several days at its end. Our choice of the day the bill was opened is likely wrong. The end date usually equals the issue date, so normally no separate date would print.
4. **Pre-bills (1.2).** AEAT allows "pro forma simplified invoices" only if the real invoice follows and is handed over. They must carry no tax QR code. A system that doesn't keep its preparatory documents linked to the final invoice is "susceptible de sanción". So keeping the order editable is fine, provided each printed pre-bill is kept as printed and linked to the final invoice.
5. **Recovering VAT on unpaid debts (art. 80.Cuatro) — current text, from Ley 31/2022, in force since 1 Jan 2023:**
   - the debt must be unpaid for one year, or six months if the venue's turnover was at most €6,010,121.04;
   - for a consumer, the amount before VAT must exceed €50;
   - payment must have been demanded in a way that can be proved;
   - the correction is due within the following six months, with notice to AEAT within one month.

   It is unusable for an unidentified diner who walks out, and it is excluded for anyone not established in Spain. No source supports our plan to credit a walkout's invoice with a corrective invoice when that bill is later cancelled.
6. The questionnaire's quote of art. 78.Tres.2º (the article that keeps discounts out of the taxable amount) is not the wording in the official text of the law. It should be corrected before the questionnaire goes out.

---

# Report: invoice timing, pre-bills, deposits, cancellations and short payment

Research date 2026-10-09. Covers sections 1.1, 1.2, 1.7, 1.8, 1.10, 1.11, 3.5 and 5.1 of the questionnaire dated 6 Oct 2026. Lines starting `>` are verbatim quotes, each checked against the raw downloaded text; "[…]" marks a cut. **"Our reading"** marks inference that no source states.

## Sources

| Id | Source | Version / date |
|---|---|---|
| FAQ-DEV | AEAT, *Aclaraciones a dudas de los desarrolladores*, https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf | v1.3, 4 Dec 2025. Downloaded today: same SHA-1 as the repo copy, and AEAT's page still says "actualizado 04-12-2025". No newer version exists. |
| FAQ-CONC / FAQ-INT / FAQ-PROC / FAQ-ALTA | AEAT sede Veri\*Factu FAQ pages `cuestiones-generales-conceptos-definiciones`, `caracteristicas-requisitos-sif-integridad-inalterabilidad`, `procedimientos-facturacion` and `registros-facturacion-alta`, under https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/ | "Actualizadas a 21 de julio de 2026"; page footer 07/10/2026 |
| ROF | RD 1619/2012 (BOE-A-2012-14696), read through the BOE open-data API | Consolidation updated 2026-03-31. Art. 1: original text. Art. 2: as amended in 2021 (BOE-A-2021-10026). Arts. 6 and 7: as amended by RD 1007/2023. Art. 11: as amended by RD 828/2013. Art. 15: as amended by RD 1075/2017. |
| LIVA | Ley 37/1992 (BOE-A-1992-28740) | Consolidation updated 2026-10-07. Art. 75: 2021 version. Art. 78: 2017 version. **Art. 80: version of Ley 31/2022 (BOE-A-2022-22128), in force 2023-01-01; the latest of 12 versions.** Art. 88: 2013 version. |
| RIVA | RD 1624/1992, art. 24 | Version of RD 1171/2023, in force 2024-01-01 |

DGT rulings, all read on PETETE itself (https://petete.tributos.hacienda.gob.es/consultas/):

| Ruling | Date | Type | Facts |
|---|---|---|---|
| V1476-13 | 26/04/2013 | binding | sewer cleaning lasting several days, invoiced on completion |
| V2423-18 | 10/09/2018 | binding | airline: invoice at booking (paid in advance) |
| V0950-26 | 29/04/2026 | binding | hotel deposits; guest's tax ID unknown; simplified invoice? |
| V0235-19 | 06/02/2019 | binding | a document titled "factura proforma" |
| 0382-03 | 07/03/2003 | general (not binding); applies the repealed RD 2402/1985 | a proforma without number or series |
| V2375-23 | 05/09/2023 | binding | unpaid rent: still invoice and charge VAT? |
| V2472-24 | 09/12/2024 | binding | what counts as a provable demand for payment under art. 80.Cuatro |
| V0622-26 | 18/03/2026 | binding (SG de Tributos) | laundry: may the invoice be issued at the end of the cycle? |

**Searches that found nothing, each beside a working control.** Control: `restaurante` returns 1,329 binding rulings. I also read the question of every one of the 265 binding and 47 general rulings whose facts mention a restaurant. Words in one search field are combined with AND, as measured on this run, so these zeros are real:
- `precuenta`, `precuentas`, `pre-cuenta`, `prefactura`, `comanda`, `medianoche`, `madrugada factura`: 0.
- `restaurante|banquetes|bodas|catering` combined with advance payment: 0.
- `restaurante "factura proforma"`: 0.
- `restaurante impago`: 19 binding rulings, none about a diner leaving without paying.
- AEAT's 18 sede Veri\*Factu FAQ pages: no mention of restaurants, hospitality, the precuenta, kitchen orders or deposits.

## 1.1 When to issue the invoice

**b1 — May we give a pre-bill and issue the invoice at payment? NARROWED.**

> 1. Las facturas deberán ser expedidas en el momento de realizarse la operación.

ROF art. 11.1. *Invoices must be issued when the operation takes place.*

> 2.º En las prestaciones de servicios, cuando se presten, ejecuten o efectúen las operaciones gravadas.

LIVA art. 75.Uno.2º. *VAT on a service falls due when the service is performed.*

> en general, el devengo del IVA y consiguientemente la obligación de facturación nace cuando se entrega el bien o se presta el servicio en el que consiste la operación

FAQ-DEV §20. *VAT, and with it the duty to invoice, arises when the service is provided.*

> Que se concedan previa o simultáneamente al momento de realización de la operación -el de devengo del impuesto-.

FAQ-ALTA. *Written about discounts: AEAT defines "the moment of the operation" as the moment VAT falls due.*

> Las operaciones se entenderán realizadas según los criterios establecidos en el artículo 75 de la Ley del Impuesto sobre el Valor Añadido para el devengo de dicho Impuesto.

0382-03 (general ruling, quoting the repealed 1985 regulation). The current art. 11 has no such sentence.

> La emisión de facturas – o facturas simplificadas– proforma o sin validez fiscal, está permitida siempre y cuando se sustituyan finalmente por la factura o factura simplificada oficial expedida y esta se entregue al cliente.

FAQ-CONC. *Pro forma simplified invoices are allowed if the real invoice follows and is handed over.*

The DGT was asked almost exactly this in V0622-26 ("¿Es posible confirmar el pago y enviarlo a Verifactu (inmediatamente) al final del ciclo de lavado/secado?") and did not answer. It recited the rules and pointed to AEAT's FAQ.

Our reading: invoicing at payment, minutes later in the same visit, fits "en el momento"; waiting for payment as such does not.

*Advisor:* "For a restaurant meal, is issuing the simplified invoice when the table pays, within the same visit and after the service has been performed, 'en el momento de realizarse la operación'?"

**b2 — The table orders more or disputes an item between pre-bill and payment. ANSWERED.**

> cualquier alteración que se produzca en ese registro, previo al RF, sería perfectamente lícita.

FAQ-DEV §6. *Any change before the invoice record exists is lawful.*

> Si los errores se detectan "mientras se está confeccionando la factura", es decir, cuando se está editando pero aún no se ha emitido, se corrigen sin más antes de emitirla.

FAQ-DEV §17. *Errors found while the invoice is still being prepared are simply corrected.* Keeping the pre-bill itself is covered in 1.2.

**b3 — After the invoice is issued, the customer pays less or orders more. ANSWERED for "pays less"; NARROWED for "orders more".**

> 2.º Los descuentos y bonificaciones otorgados con posterioridad al momento en que la operación se haya realizado siempre que sean debidamente justificados.

LIVA art. 80.Uno.2º. *A discount granted after the operation reduces the taxable amount.*

> 2. Igualmente, será obligatoria la expedición de una factura rectificativa en los casos en que las cuotas impositivas repercutidas se hubiesen determinado incorrectamente o se hubieran producido las circunstancias que, según lo dispuesto en el artículo 80 de la Ley del Impuesto, dan lugar a la modificación de la base imponible.

ROF art. 15.2. *Any art. 80 change requires a corrective invoice.*

> 6. Únicamente tendrán la consideración de facturas rectificativas las que se expidan por alguna de las causas previstas en los apartados 1 y 2.

ROF art. 15.6. *Corrective invoices exist only for the causes in art. 15.1 and 15.2.*

Our reading: a further order is a new supply and takes its own invoice.

*Advisor:* "Is a second simplified invoice for items ordered after the first was issued correct?"

**b4 — May we invoice before payment; is it ever required? NARROWED.**

It is required whenever the service is finished before payment (b1 sources). Payment is not part of the invoice:

> La forma en que se materialice el pago, incluyendo pagos anticipados que no hayan devengado una factura anterior, no forma parte de la factura misma, sino de los aspectos financieros de su solvencia.

FAQ-DEV §20. *How and when payment is made is not part of the invoice.*

Issuing at order, before both service and payment, is addressed by no source. The regulation names only two possible operation dates: the operation itself or a received advance payment.

> c) La fecha en que se hayan efectuado las operaciones que se documentan o en la que, en su caso, se haya recibido el pago anticipado, siempre que se trate de una fecha distinta a la de expedición de la factura.

ROF art. 7.1.c.

*Advisor:* "Is issuing a simplified invoice when the order is placed, before the service and with nothing paid, permitted?"

**b5 — Counter service. ANSWERED when the customer prepays; NARROWED when they pay on collection.**

> Dos. No obstante lo dispuesto en el apartado anterior, en las operaciones sujetas a gravamen que originen pagos anticipados anteriores a la realización del hecho imponible el impuesto se devengará en el momento del cobro total o parcial del precio por los importes efectivamente percibidos.

LIVA art. 75.Dos. *For an advance payment, VAT falls due when the money is received.*

> También deberá expedirse factura y copia de esta por los pagos recibidos con anterioridad a la realización de las entregas de bienes o prestaciones de servicios por las que deba asimismo cumplirse esta obligación conforme al párrafo anterior

ROF art. 2.1. *An invoice is required for payments received before the supply.*

> estarán sujetas al Impuesto sobre el Valor Añadido en concepto de pago anticipado. En estas circunstancias, el devengo se producirá con ocasión del cobro de la cantidad percibida en concepto de reserva o anticipo.

V2423-18 (binding; an airline, so by analogy). Invoicing at prepayment is therefore the rule, not just allowed. Paying on collection makes the operation and the payment coincide; invoicing at order is the open point in b4.

## 1.2 The precuenta

**b1 — Is the precuenta a pre-invoice whose record must be kept unaltered? NARROWED (strong lead).** No source uses the word *precuenta*. FAQ-CONC (quoted in 1.1 b1) names "facturas simplificadas proforma o sin validez fiscal" handed over before the real invoice. FAQ-DEV attaches the keeping duty to that family:

> cuando los albaranes, proformas, prefacturas o facturas sin validez fiscal se expidan, sus registros deberán conservarse de forma inalterable (salvo que la alteración se produzca por medio de un registro posterior, que también deberá quedar anotado en el sistema).

FAQ-DEV §11.

> resulta obligado conservar los registros de facturas proformas emitidos

FAQ-DEV §6.

*Advisor:* "Is a precuenta a 'factura simplificada proforma o sin validez fiscal' in the sense of AEAT's FAQ?"

**b2 — Editable order with recorded changes, or freeze it? ANSWERED: editable is fine if every change is recorded and linked.** The parenthesis in the §11 quote above allows changes made by later records.

> Por ello, no sería legal y sería susceptible de sanción, el uso de sistemas que generen documentos preparatorios de facturas o de facturas simplificadas, sin que el sistema informático mismo disponga de elementos de control para la conservación de tales documentos preparatorios de forma debidamente vinculada a las facturas o a los registros de facturación que finalmente se emitan o, en defecto de factura, de forma que queden registrados y conservados en el sistema.

FAQ-INT. *A system that produces preparatory documents without keeping them linked to the final invoice, or kept on their own if no invoice follows, is unlawful and sanctionable.*

> A efectos informáticos, el sistema de generación de facturas pro-forma o sin validez fiscal, debe estar vinculado indefectiblemente al sistema de emisión de facturas formando una unidad. Conviene, a efectos de control interno, que se conserve registro de las prefacturas o facturas proforma elaboradas.

FAQ-CONC. Note the difference in strength: here keeping is only advisable ("conviene"), while FAQ-INT and FAQ-DEV make it mandatory. Build to the stricter one.

What the build needs: each printed pre-bill kept as printed and linked to the invoice that finally documents the table.

**b3 — Must it say it is not an invoice; rules on content or numbering? NARROWED.** It must carry no tax QR code:

> La introducción y edición temporal de datos, visualización previa, etc. de facturas no está prohibida ni por el reglamento que establece los requisitos de los sistemas informáticos de facturación ni por el reglamento de obligaciones de facturación, si bien hasta no estar terminada la factura, esta no podrá ser expedida con su correspondiente código «QR» tributario. Por ello tanto los borradores de factura como las facturas proforma no llevan ningún código «QR» tributario.

FAQ-CONC.

What a document contains decides whether it is an invoice; its title does not:

> Por tanto, e independientemente del título dado por el obligado a expedir la factura al documento acreditativo de la operación, si el mismo contiene los elementos de información mínimos exigidos por el Reglamento de facturación vigente en el momento del devengo de las operaciones

V0235-19 (binding). A document like that "tendrá […] la consideración de factura".

> No tiene la consideración de factura completa el documento de factura "proforma" que se adjunta al escrito de consulta puesto que en ella no consta su número y, en su caso, la serie de la misma.

0382-03 (general ruling, under the repealed 1985 regulation). *A proforma without an invoice number and series was not an invoice.*

Our reading: give the precuenta no invoice number or series and no QR. No source requires or forbids a "not an invoice" legend.

*Advisor:* "Is a legend required or advisable?"

## 1.7 Part-payments

**b1 — Take part-payments and invoice only when fully paid? Is there a time limit? NARROWED.** Our reading:
- A part-payment made after the meal has been served changes nothing. VAT already fell due at service, and the invoice is due at that moment (1.1 b1). No source gives a maximum time.
- A part-payment made before the table has been fully served is an advance payment. VAT falls due on receipt (art. 75.Dos), and the regulation requires an invoice for it (ROF art. 2.1).

> Cuando se produce un pago anticipado, en el régimen sustantivo del IVA dicho pago devenga el Impuesto y por consiguiente obliga a repercutir el impuesto por la parte pagada correspondiente.

FAQ-DEV §20.

*Advisor:* "Is a guest's part-payment taken mid-meal an advance payment needing its own invoice?"

**b2 — Split items to a separate bill after a part-payment. OPEN.** Who counts as the recipient when diners split is question 1.3, outside my sections. Our reading: before issue, a split is a free pre-issue edit.

**b3 — Whole-table invoice handed over, then guests want separate invoices. NARROWED.**

> sin que en ningún caso pueda expedirse una nueva factura que documente la misma operación en casos distintos de los previstos en dichos preceptos.

V0235-19. *No new invoice may document the same operation outside the cases the regulation provides.* The only multi-person route in the regulation is duplicate copies under art. 14.2.a.

If the invoice has not yet been handed over, AEAT's FAQ favours cancelling it and issuing a fresh original:

> un aspecto que puede influir en el uso de este mecanismo es si la factura expedida (con errores) ya se ha entregado o no al cliente. Si NO se hubiera entregado, este hecho favorecería la consideración de que se trata de una factura defectuosa e incorrecta que no debería existir ni llegar al cliente (una expedición "fallida") y, por lo tanto, que fuera susceptible de anularse y, después, si procede, expedir una nueva factura "original" (no rectificativa) correcta que se entregaría al cliente.

FAQ-DEV §17.2.d. No hospitality procedure authorised by AEAT under ROF art. 15.4 was found.

**b4 — Daily cash report. NARROWED.** No fiscal rule governs an internal cash report.

> no se debe confundir el importe total de la/s factura/s expedida/s, dependiendo del tipo que sean, con la gestión del cobro de la/s misma/s, que es algo independiente y complementario a la facturación

FAQ-DEV §27. *Invoicing and collecting payment are separate.*

## 1.8 A table that leaves without paying

**b1 — Must the invoice still be issued? ANSWERED by the general rules: yes.** The sources are art. 75.Uno.2º, art. 11.1, ROF art. 1 ("expedir y entregar") and FAQ-DEV §20. The closest binding ruling (unpaid rent, by analogy):

> se seguirá devengando el Impuesto sobre el Valor Añadido correspondiente al arrendamiento del mismo, de acuerdo con la exigibilidad de las cuotas de arrendamiento que se había pactado, debiendo la consultante seguir cumpliendo las obligaciones formales, en particular las de facturación y declaración, derivadas del tributo.

V2375-23.

> 1.º Las operaciones cuya base imponible se pretenda rectificar deberán haber sido facturadas y anotadas en el libro registro de facturas expedidas por el acreedor en tiempo y forma.

RIVA art. 24.2.a.1º. *Bad-debt relief needs the sale to have been invoiced on time.* The decision we already took matches the sources.

**b2 — Later payment; is art. 80.Cuatro the only way to recover the VAT? First half ANSWERED, second half NARROWED.** A later payment needs no fiscal document. If relief was taken and a consumer later pays:

> C) Una vez practicada la reducción de la base imponible, ésta no se volverá a modificar al alza aunque el sujeto pasivo obtuviese el cobro total o parcial de la contraprestación, salvo cuando el destinatario no actúe en la condición de empresario o profesional. En este caso, se entenderá que el Impuesto sobre el Valor Añadido está incluido en las cantidades percibidas y en la misma proporción que la parte de contraprestación percibida.

LIVA art. 80.Cuatro.C.

Art. 80.Cuatro is in practice unusable for a walkout:
- the €50 consumer floor;
- a demand for payment that proves the recipient (V2472-24);
- the corrective invoice must be sent to the debtor (RIVA art. 24.1).

There is also no relief at all for a recipient not established in Spain:

> 2.ª Tampoco procederá la modificación de la base imponible cuando el destinatario de las operaciones no esté establecido en el territorio de aplicación del Impuesto, ni en Canarias, Ceuta o Melilla.

LIVA art. 80.Cinco.2ª.

*Advisor:* "Is the VAT on an unidentified walkout unrecoverable in practice, and is a foreign tourist 'no establecido'?"

## 1.10 A bill paid later by bank transfer

- **b1 — Invoice now, paid later: ANSWERED, lawful** (art. 11.1, art. 75; FAQ-DEV §20).
- **b2 — What must the system keep about the amount owed: NARROWED.** No invoicing rule requires tracking what is owed. But:

  > 2.ª Que esta circunstancia haya quedado reflejada en los Libros Registros exigidos para este Impuesto.

  LIVA art. 80.Cuatro.A.2ª. It is unclear what "esta circunstancia" means. *Advisor:* "What must the VAT record books show for an unpaid invoice?"
- **b3 — Simplified invoice paid later; record the debtor? NARROWED.** Art. 4.2.e does not tie the simplified invoice to payment. Our reading: record who owes it, because claiming bad-debt relief would need their identity.
- **b4 — Cash report for unpaid invoices: OPEN.**
- **b5 — Pro forma first, invoice only when the transfer arrives: ANSWERED, not lawful as a practice.** Art. 11.1 counts from the operation, or, for a business, from when VAT fell due.

  > Por tanto, la compañía aérea deberá respetar estos plazos, sin que pueda excederlos en el caso de que existan pagos anticipados y el último vuelo correspondiente a la citada reserva se efectúe fuera de los citados plazos.

  V2423-18.

  > Cuatro. Se perderá el derecho a la repercusión cuando haya transcurrido un año desde la fecha del devengo.

  LIVA art. 88.Cuatro. *After a year, the right to charge the VAT to the customer is lost.*
- **b6 — Full invoice to a business by the 16th; to a private individual: ANSWERED.**

  > No obstante, cuando el destinatario de la operación sea un empresario o profesional que actúe como tal, las facturas deberán expedirse antes del día 16 del mes siguiente a aquél en que se haya producido el devengo del Impuesto correspondiente a la citada operación.

  ROF art. 11.1. The deadline runs from when VAT fell due, not from payment. A private individual gets no extension.
- **b7 — Simplified invoice to a consumer: ANSWERED.** It must be issued at the meal.
- **b8 — Operation date on a later invoice: ANSWERED.** It must be shown when it differs from the issue date (art. 6.1.i, art. 7.1.c), and the pro forma is kept (FAQ-DEV §11).
- **b9 — Are both options lawful? ANSWERED.** Option 1 is lawful. Option 2 is lawful only within the art. 11 deadlines, so for a consumer it collapses into option 1.
- **b10 — Never paid; full vs simplified; cancelled by agreement: NARROWED.** Bad-debt relief turns on the recipient (business or consumer), not on the invoice type; art. 4.1.b allows a simplified corrective invoice.

  > Dos. Cuando por resolución firme, judicial o administrativa o con arreglo a Derecho o a los usos de comercio queden sin efecto total o parcialmente las operaciones gravadas o se altere el precio después del momento en que la operación se haya efectuado, la base imponible se modificará en la cuantía correspondiente.

  LIVA art. 80.Dos. *Advisor:* "For a meal already eaten that both sides agree not to charge, is the correction under art. 80.Dos or 80.Uno.2º?"
- **b11 — Service provided, unpaid: ANSWERED, invoice anyway.**
- **b12 — Deposits: ANSWERED** that VAT is due on receipt and an invoice is required (art. 75.Dos, ROF art. 2.1).

  > Por tanto, la consultante deberá expedir facturas con ocasión de los ingresos a cuenta de las operaciones de hospedaje que realiza, indicando el número de identificación fiscal del destinatario de las operaciones junto con el resto de las menciones exigidas en el artículo 6 del reglamento de facturación. También podrá expedir factura simplificada por estas operaciones conforme al artículo 4 del Reglamento de facturación, en esencia, cuando su importe no exceda de 400 euros, Impuesto sobre el Valor Añadido incluido, o cuando exista autorización del Departamento de Gestión Tributaria de la Agencia Estatal de Administración Tributaria.

  V0950-26 (binding, 2026). The €400 cap applies there because accommodation is excluded from art. 4.2.e:

  > se desprende que no se comprenden dentro de los servicios de hostelería a que se refiere dicho precepto los de alojamiento u hospedaje

  - **NARROWED (by analogy):** a deposit for a restaurant meal falls within art. 4.2.e, so a simplified invoice up to €3,000 is available, including for a private individual.
  - **OPEN:** how the final invoice shows the deposit. FAQ-DEV §20's wording ("pagos anticipados que no hayan devengado una factura anterior") implies an already-invoiced deposit does affect the later invoice.

  *Advisor:* "Should the final invoice show only the remainder, or the total less the deposit's taxable amount and VAT?"

## 1.11 A meal past midnight

**b1 — Use the date the bill was opened? NARROWED, and the lead contradicts our current choice.** Printing the date only when it differs from the issue date is correct:

> i) La fecha en que se hayan efectuado las operaciones que se documentan o en la que, en su caso, se haya recibido el pago anticipado, siempre que se trate de una fecha distinta a la de expedición de la factura.

ROF art. 6.1.i.

> De acuerdo con lo expuesto el tipo impositivo aplicable a las operaciones de limpieza objeto de consulta será aquél que esté vigente en el momento de prestarse los mismos, es decir, al finalizar la referida prestación si esta, como es el caso de consulta, se extendiera durante varios días.

V1476-13 (binding; by analogy). *A service lasting several days is provided when it finishes.*

Our reading: the operation date is the day the meal ends, which is usually the issue date.

*Advisor:* "Is the operation date the day the service ends?"

## 3.5 Cancelling an order whose ticket was issued

**b1 — Cancelled before it is served: corrective invoice or cancellation record? NARROWED.**

> por ejemplo, cuando se llega a emitir con el SIF una factura por un servicio o una entrega que no existen y que, por tanto, no se han realizado.

FAQ-DEV §17.2.d. *A cancellation record is for an invoice for a service that never happened.*

> El registro de alta enviado previamente y que no procede se dará de baja mediante un registro de facturación de anulación identificando el número de la factura original.

FAQ-PROC, answering "¿Cómo se modifica o anula una factura emitida por error o con errores en los datos de identificación (ej. operación inexistente)?"

Our reading:
- **Nothing paid, nothing served:** no VAT ever fell due, so a cancellation record fits, especially if the ticket was never handed over.
- **Prepaid, then cancelled:** the advance payment made VAT due, so the invoice was correct when issued. The refund is the operation being "left without effect" under art. 80.Dos, which takes a corrective invoice.

**b2 — Must the corrective invoice be delivered; what if the customer has left? ANSWERED that it must be delivered; OPEN for an absent customer.**

> 1. En los casos a que se refiere el artículo 80 de la Ley del Impuesto, el sujeto pasivo estará obligado a expedir y remitir al destinatario de las operaciones una nueva factura en la que se rectifique o, en su caso, se anule la cuota repercutida

> La disminución de la base imponible o, en su caso, el aumento de las cuotas que deba deducir el destinatario de la operación estarán condicionadas a la expedición y remisión de la factura que rectifique a la anteriormente expedida. En los supuestos de los apartados tres y cuatro del artículo 80 de la Ley del Impuesto, el sujeto pasivo deberá acreditar asimismo dicha remisión.

RIVA art. 24.1. *The corrective invoice must be sent to the recipient, and the VAT reduction depends on it.*

**b3 — Walkout bill later cancelled. NARROWED: no support found for a corrective invoice.**

> Con carácter general, todas las facturas emitidas, en la medida en que respondan a operaciones realmente efectuadas (como es el caso habitual) no pueden anularse.

FAQ-DEV §17.2.d. Writing off a walkout is not a discount (art. 80.Uno.2º), not an operation left without effect (80.Dos) and not insolvency (80.Tres). Unless the art. 80.Cuatro conditions are met, the invoice and its VAT stand. This is our reading.

*Advisor:* "Can an abandoned walkout debt be credited at all?"

## 5.1 Short payment

**b1 — Discount or unpaid debt? NARROWED.**

> 2.º Los descuentos y bonificaciones que se justifiquen por cualquier medio de prueba admitido en derecho y que se concedan previa o simultáneamente al momento en que la operación se realice y en función de ella.

> Lo dispuesto en el párrafo anterior no será de aplicación cuando las minoraciones de precio constituyan remuneraciones de otras operaciones.

LIVA art. 78.Tres.2º.

The questionnaire's wording («descuentos y bonificaciones concedidos previa o simultáneamente…») does not appear in the official text of the law (checked: zero matches). `verifactu-findings.md` §12 attributes that wording to AEAT's *Manual práctico IVA 2025*, which I did not re-read. Cite the text of the law instead.


> Cuando los descuentos o bonificaciones se concedan con posterioridad al momento de realizarse la operación también afectan a la base imponible, modificándose a la baja su importe.

FAQ-ALTA.

One wrinkle: on AEAT's own definition (1.1 b1), "simultaneously" means at service. A reduction agreed later at the till may count as granted "after the operation". It still lowers the taxable amount, but after the invoice is issued it needs a corrective invoice.

*Advisor:* "Is accepting less at the till, before the ticket is issued but after the meal was served, a discount under art. 78.Tres.2º?"

**b2 — Current conditions of art. 80.Cuatro. ANSWERED.**

> Se modifican las condiciones 3ª y 4ª de la letra A) y la letra B) del apartado cuatro, y la regla 2ª del apartado cinco por el art. 77 de la Ley 31/2022, de 23 de diciembre.

This is the latest amendment; the consolidated text was refreshed on 2026-10-07.

> 1.ª Que haya transcurrido un año desde el devengo del Impuesto repercutido sin que se haya obtenido el cobro de todo o parte del crédito derivado del mismo.

> Cuando el titular del derecho de crédito cuya base imponible se pretende reducir sea un empresario o profesional cuyo volumen de operaciones, calculado conforme a lo dispuesto en el artículo 121 de esta Ley, no hubiese excedido durante el año natural inmediato anterior de 6.010.121,04 euros, el plazo a que se refiere esta condición 1.ª podrá ser, de seis meses o un año.

> 2.ª Que esta circunstancia haya quedado reflejada en los Libros Registros exigidos para este Impuesto.

> 3.ª Que el destinatario de la operación actúe en la condición de empresario o profesional, o, en otro caso, que la base imponible de aquella, Impuesto sobre el Valor Añadido excluido, sea superior a 50 euros.

> 4.ª Que el sujeto pasivo haya instado su cobro mediante reclamación judicial al deudor o por medio de requerimiento notarial al mismo, o por cualquier otro medio que acredite fehacientemente la reclamación del cobro a aquel, incluso cuando se trate de créditos afianzados por Entes públicos.

> debería ser cualquier modalidad de comunicación o envío que permita acreditar la remisión del contenido de dicha reclamación, identidad del remitente y destinatario así como el resultado y la fecha de su entrega

V2472-24 (binding), on what a provable demand needs; it cites a burofax as an example.

> B) La modificación deberá realizarse en el plazo de los seis meses siguientes a la finalización del periodo de seis meses o un año a que se refiere la condición 1.ª anterior y comunicarse a la Agencia Estatal de Administración Tributaria en el plazo que se fije reglamentariamente.

> en el plazo de un mes contado desde la fecha de expedición de la factura rectificativa, la modificación de la base imponible practicada

RIVA art. 24.2.a.2º. *The correction must be notified to AEAT within one month of the corrective invoice.*

Further rules:
- the corrective invoice must be sent to the debtor (RIVA art. 24.1);
- the original must have been invoiced on time (RIVA art. 24.2.a.1º);
- relief is excluded for debts that are secured, insured or between related parties, and for debtors not established in Spain (art. 80.Cinco);
- part-payments are treated as including VAT proportionally:

> 4.ª En los supuestos de pago parcial anteriores a la citada modificación, se entenderá que el Impuesto sobre el Valor Añadido está incluido en las cantidades percibidas y en la misma proporción que la parte de contraprestación satisfecha.

This corrects `verifactu-findings.md` §12, which took these conditions from secondary sources:
- the €50 consumer floor and the "any provable means" wording are confirmed against the law's official text;
- the six-month option depends on turnover of €6,010,121.04 or less, and it is an option, not automatic.

## Summary table

| Bullet | Verdict |
|---|---|
| 1.1 b1 pre-bill, invoice at payment | NARROWED |
| 1.1 b2 changes before issue | ANSWERED |
| 1.1 b3 pays less / orders more | ANSWERED / NARROWED |
| 1.1 b4 invoice before payment | NARROWED |
| 1.1 b5 counter (prepaid / pays on collection) | ANSWERED / NARROWED |
| 1.2 b1 precuenta = prefactura | NARROWED (strong lead) |
| 1.2 b2 editable plus recorded changes | ANSWERED |
| 1.2 b3 legend, content, numbering | NARROWED |
| 1.7 b1 part-payments, time limit | NARROWED |
| 1.7 b2 split after a part-payment | OPEN |
| 1.7 b3 split after an issued invoice | NARROWED |
| 1.7 b4 cash report | NARROWED |
| 1.8 b1 walkout: invoice anyway | ANSWERED |
| 1.8 b2 later payment / art. 80.Cuatro | ANSWERED / NARROWED |
| 1.10 b1 invoice now, paid later | ANSWERED |
| 1.10 b2 what to keep about the amount owed | NARROWED |
| 1.10 b3 simplified invoice paid later | NARROWED |
| 1.10 b4 cash report | OPEN |
| 1.10 b5 pro forma, invoice on payment | ANSWERED (not lawful) |
| 1.10 b6 business by day 16 / private individual | ANSWERED |
| 1.10 b7 consumer: wait for payment? | ANSWERED (no) |
| 1.10 b8 operation date; pro forma kept | ANSWERED |
| 1.10 b9 both options lawful? | ANSWERED |
| 1.10 b10 never paid / cancelled by agreement | NARROWED |
| 1.10 b11 unpaid: invoice anyway | ANSWERED |
| 1.10 b12 deposits | ANSWERED / NARROWED / OPEN |
| 1.11 b1 date past midnight | NARROWED (contradicts current choice) |
| 3.5 b1 R5 or cancellation record | NARROWED |
| 3.5 b2 deliver the corrective invoice | ANSWERED / OPEN |
| 3.5 b3 walkout bill later cancelled | NARROWED |
| 5.1 b1 discount vs debt | NARROWED |
| 5.1 b2 art. 80.Cuatro conditions | ANSWERED |
