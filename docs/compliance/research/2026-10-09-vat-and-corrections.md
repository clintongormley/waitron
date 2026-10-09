# Asesor research, 2026-10-09: VAT treatment, discounts, corrections and series

**Provenance.** Researched 2026-10-09 by a research agent; every Spanish quote was checked word for word, by script, against the raw text downloaded from the URL given (BOE and AEAT pages fetched with curl, PDFs through pdftotext, DGT rulings read on PETETE, where any ruling opens at `https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=<number>`). The downloads were kept in the session's scratch directory and are not committed; re-fetch from the URL to re-check a quote. Section numbers (1.1, 1.2 …) are those of the advisor questionnaire of 6 October 2026; the mapping to Q-numbers is in [asesor-questions.md](../asesor-questions.md#the-shortened-list-2026-10-09).

## Summary

Of 29 question bullets: 11 are answered, 17 narrowed and 1 open.

**Findings that change our own conclusions**

- **4.3:** our premise that tickets and their corrective invoices need separate series is wrong. Ruling V2884-16, a binding ruling (V-numbered, issued by the tax ministry's directorate, DGT) asked by a till vendor for restaurants, says correctives of tickets (R5) may stay in the ticket series. Only correctives of full invoices need their own series. Ruling V2885-16, binding, confirms tickets and full invoices need separate series.
- **2.2:** the legal test for which VAT rate applies is the rate when the service was provided (devengo). It is not the invoice or payment date, so our "rate on the issue day" rule is a simplification. No published rule covers a meal that straddles a rate change. RDL 29/2026, in force 8 October 2026, keeps restaurant service at 10%.
- **1.9:** a free item given alongside a paid sale counts as a discount, not as self-supply (autoconsumo, VAT due on giveaways). But where items carry different VAT rates, the price paid must be shared across all of them by market value, the free item included (V0555-17). So setting a free item to €0 is wrong on a deli's mixed-rate bill. An invitation where nothing is paid is self-supply, taxed on cost (V2347-24).
- **2.1:** the only 0% rate in the VAT Law today is for goods donated to non-profits. The 0% rate on basic foods ended on 30 September 2024, and those foods have been at 4% since 2025.
- **5.4:** the substance on tips matches PETETE (the DGT's online database of rulings). But the V3095-17 wording quoted in `verifactu-findings.md` §11 is a legal-database paraphrase, not the ruling's text. The stronger binding VAT ruling is V2182-23 (2023): tips collected electronically by the business and passed on to staff stay outside VAT.

**Smaller findings**

- **3.3 and 3.4:**
  - Choosing between "by differences" and "by substitution" is up to the business.
  - Repeated corrections of the same invoice are allowed.
  - A cancellation record has no time limit; a corrective invoice must be issued within four years.
- **3.1:** a ticket credited with a negative F2 must be replaced by an F1, not an F3 (AEAT taxpayer FAQ, July 2026). For a foreign customer, ruling V2305-24 gives AEAT's preferred order of identity documents.
- **Still unsettled:**
  - Who the recipient is when guests share a table (1.3).
  - Rounding a cash total up to 5 cents (5.2).
  - Which VAT period a late cancellation belongs to (3.4).
  - Whether a cancellation or corrective may come from a different server (5.3, by analogy only).
- **Outside my sections:** RD 238/2026 brought mandatory business-to-business electronic invoicing into the invoicing regulation on 20 April 2026. It covers full invoices to Spanish businesses. I did not read its start dates.

AEAT's developer FAQ v1.3 (4 December 2025) is still the latest: the live file is byte-identical to the copy in the repo.

---

# Full report

**How the evidence was checked**
- Every quote was verified with `research-vat-scripts/verify_quotes.py` against `quotes.txt`. The script strips the HTML or runs pdftotext, collapses whitespace and looks for the exact text.
- PETETE was queried with `research-vat-scripts/petete.py`. Any ruling opens by hand at `https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=<N>`.
- Downloads are in `research-vat/dl/`: `boe/`, `sede/`, `petete/`, plus the AEAT PDFs and the schema file.

**Sources**

| Source | Date or version | Where |
|---|---|---|
| AEAT developer FAQ | v1.3, 4 Dec 2025 (still current) | agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf |
| AEAT validation rules ("Validaciones") | v1.2.2, 08/04/2026 | same folder, Validaciones_Errores_Veri-Factu.pdf |
| AEAT error codes and schema | downloaded 9 Oct 2026 | prewww2.aeat.es/…/tikeV1.0/cont/ws/ (errores.properties, SuministroInformacion.xsd) |
| AEAT taxpayer Veri*Factu FAQ | updated 21/07/2026 | sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/ (pages procedimientos-facturacion, registros-facturacion-alta, registros-facturacion-anulacion, caracteristicas-requisitos-sif-trazabilidad) |
| AEAT VAT rates table 2026 | 26/02/2026 | sede…/static_files/Sede/Tema/IVA/IVA_reperc/Tipos_IVA_2026_26_02_2026.pdf |
| Invoicing regulation (RD 1619/2012) | updated 31/03/2026 | BOE-A-2012-14696 |
| VAT Law (Ley 37/1992) | updated 07/10/2026 | BOE-A-1992-28740 |
| General Tax Law (Ley 58/2003) | as read 9 Oct 2026 | BOE-A-2003-23186 |
| RDL 4/2024 | 26 Jun 2024 | BOE-A-2024-12944 |
| RDL 29/2026 | 6 Oct 2026, in force 08/10/2026 | BOE-A-2026-20823 |

**DGT rulings read in full on PETETE** (number, date, issuing department, status):

| Ruling | Date | Department | Status |
|---|---|---|---|
| 1693-02 | 07/11/2002 | Consumo | general |
| V1002-22 | 05/05/2022 | Consumo | binding |
| V0555-17 | 02/03/2017 | Consumo | binding |
| V2347-24 | 12/11/2024 | Personas Jurídicas | binding |
| V0602-26 | 13/03/2026 | Consumo | binding |
| V1919-18 | 29/06/2018 | Consumo | binding |
| V2162-09 | 28/09/2009 | Consumo | binding |
| 2174-03 | 11/12/2003 | Personas Jurídicas | general |
| V3095-17 | 29/11/2017 | Patrimoniales, Tasas y Precios Públicos | binding |
| V1808-22 | 29/07/2022 | Personas Jurídicas | binding |
| V2182-23 | 25/07/2023 | Consumo | binding |
| V1926-10 | 07/09/2010 | Consumo | binding |
| V0319-26 | 12/02/2026 | Consumo | binding |
| V2305-24 | 05/11/2024 | Consumo | binding |
| V0064-20 | 15/01/2020 | Consumo | binding |
| V0349-18 | 08/02/2018 | Consumo | binding |
| V2543-06 | 19/12/2006 | Consumo | binding |
| V2885-16 | 22/06/2016 | Consumo | binding |
| V2884-16 | 22/06/2016 | Consumo | binding |
| V2645-16 | 14/06/2016 | Consumo | binding |

"Consumo" is the VAT department (SG de Impuestos sobre el Consumo). "Personas Jurídicas" is the corporate-tax department. V2543-06 was decided under the earlier invoicing regulation.

---

## 1.3 Several guests at one table

**Bullet 1. Separate simplified invoice per guest? — NARROWED**
- **No ruling about diners exists.** I searched PETETE in both the general and binding sets:
  - "comensales" in the question field: nothing.
  - "mesa" with "factura": nothing restaurant-related.
  - "duplicado" with "clientes": nothing.
  - Free-text "comensales": three unrelated rulings.
  - Control: "restaurante" does return results, so the searches work.
- **V1002-22 (binding, 2022): the recipient is whoever placed the order.**
  > «el destinatario de los servicios prestados por la Notaría, y quien debe figurar como destinatario en la correspondiente factura, será la persona que le hubiera realizado el encargo, es decir, la comunidad hereditaria, aun cuando sean los herederos los que se beneficien del resultado.»
- **1693-02 (general, 2002): if no contract settles it, the recipient is whoever is legally bound to pay.**
  > «cuando no resulte con claridad de los contratos suscritos, se considerará que las operaciones gravadas se realizan para quienes, con arreglo a derecho, están obligados frente al sujeto pasivo a efectuar el pago de la contraprestación»
- **Our reading, by analogy:** a guest who orders their own dishes is plausibly their recipient.
- **Question for the advisor:** "Applying V1002-22 (whoever placed the order), may each diner who orders their own dishes get a separate simplified invoice?"

**Bullet 2. Do art. 14.2.a duplicates apply to simplified invoices? — NARROWED, leaning no**
- **Invoicing regulation, art. 14.2.a: duplicates for several recipients must show each one's share.**
  > «a) Cuando en una misma entrega de bienes o prestación de servicios concurriesen varios destinatarios. En este caso, deberá consignarse en el original y en cada uno de los duplicados la porción de base imponible y de cuota repercutida a cada uno de ellos.»
- **VAT Law art. 97.Cuatro (quoted in V1002-22): duplicates exist so each co-buyer can deduct its own share of the VAT.**
  > «Tratándose de bienes o servicios adquiridos en común por varias personas, cada uno de los adquirentes podrá efectuar la deducción, en su caso, de la parte proporcional correspondiente, siempre que en el original y en cada uno de los ejemplares duplicados de la factura se consigne, en forma distinta y separada, la porción de base imponible y cuota repercutida a cada uno de los destinatarios.»
- **AEAT validation rules §13: a ticket (F2) or ticket corrective (R5) cannot name recipients at all.**
  > «Si TipoFactura es “F2” o “R5”, la agrupación Destinatarios no puede estar cumplimentada.»
- **Invoicing regulation, art. 7.2: a ticket shows the VAT amount only when a business recipient asks.**
  > «cuando el destinatario de la operación sea un empresario o profesional y así lo exija, el expedidor de la factura simplificada deberá hacer constar, además, los siguientes datos:»
- **Our reading:** co-buyers who want to deduct VAT need full invoices, or simplified invoices that name the customer under art. 7.2 (recorded as F1). No source applies art. 14.2.a to a plain ticket.
- **Question for the advisor:** "Is art. 14.2.a ever the right route for an F2 ticket?"

**Bullet 3. How do we decide the recipient? Is the guest's request enough? — NARROWED**
- The two tests are as above. No source says whether the guest's request is enough.
- **Question for the advisor:** "Is a guest's own request for a separate bill enough evidence that they placed the order?"

## 1.9 Discounts and free items

**Bullet 1. Usual price with a discount line beneath it, net amounts in the record? — ANSWERED**
- **Invoicing regulation, art. 7.1: a ticket may carry any extra wording.**
  > «Sin perjuicio de los datos o requisitos que puedan resultar obligatorios a otros efectos y de la posibilidad de incluir cualesquiera otras menciones, las facturas simplificadas y sus copias contendrán los siguientes datos o requisitos:»
- **Developer FAQ §20: the record's total is net of discounts.**
  > «El Importe Total Factura se calcula por el total de Base Imponible (deducidos los descuentos en factura) más cuota repercutida del Impuesto indirecto (normalmente IVA).»
- **Taxpayer FAQ (alta page): the invoice itself is the usual evidence of a discount.**
  > «Generalmente, el documento que justifica su práctica es la propia factura que documente la operación, sin que sea preciso que tales descuentos y bonificaciones figuren separadamente, si bien debe probarse su existencia»
- **Same page: on full invoices (art. 6.1.f), any discount not built into the unit price must be stated.**
  > «Sin embargo, sí que se exige que en la factura consten todos los datos necesarios para la determinación de la base imponible, haciendo mención expresa, en su caso, de cualquier descuento o rebaja que no esté incluido en el precio unitario, concepto que debe figurar siempre en la factura.»
- **Left open:** the same FAQ says a prompt-payment discount may go "in one of the lines of the VAT breakdown block". That wording is ambiguous.
- **Question for the advisor:** none needed.

**Bullet 2. Sharing a whole-bill discount pro rata? — NARROWED (strong analogy)**
- **VAT Law art. 79.Dos: where one price covers several things, the taxable amount is split by market value.**
  > «Cuando en una misma operación y por precio único se entreguen bienes o se presten servicios de diversa naturaleza, incluso en los supuestos de transmisión de la totalidad o parte de un patrimonio empresarial, la base imponible correspondiente a cada uno de ellos se determinará en proporción al valor de mercado de los bienes entregados o de los servicios prestados.»
- **Our reading:** splitting pro rata by menu price matches this.
- **Question for the advisor:** "Is menu price an acceptable stand-in for market value?"

**Bullet 3. A free item, and whether it is self-supply — NARROWED, with a design consequence**
- **V0555-17 (binding, 2017): a free item given with a paid sale is an in-kind discount, not self-supply.**
  > «Ahora bien, debe tenerse en consideración la posibilidad de acordar descuentos o rebajas en el precio que se traducen en una mayor cantidad de producto entregado o servicio prestado por el mismo precio inicialmente ofertado para una cantidad inferior de los mismos bienes o servicios (campañas del tipo 2 por 1 o 3 por 2, u otras similares de descuentos en especie). En este supuesto, la operación no se realiza a título gratuito, no siendo un supuesto de autoconsumo»
- **Same ruling: across different VAT rates, the price paid is shared by market value, the free item included.**
  > «El tipo impositivo aplicable será el que corresponda a cada una de las distintas categorías de bienes entregados por un precio único, de forma que sobre la contraprestación total se aplicará el tipo impositivo correspondiente en función del valor de mercado de los distintos bienes incluidos en la operación.»
- **Design consequence (our reading):** setting the free item to €0 leaves its VAT rate with no taxable amount.
  - It rarely matters for eat-in restaurant service, which is all at 10%.
  - It does matter at a deli, where items are at 4%, 10% and 21%.
  - Spreading the free item's value across the whole bill, the way a whole-bill discount is spread, would follow this ruling.
- **V2347-24 (binding, 2024): free drinks given to customers with nothing paid are self-supply of services.**
  > «Por consiguiente, la entrega de consumiciones de bebidas que la entidad realiza a los clientes es una prestación de servicios conforme al artículo 11 de la Ley 37/1992, que, al realizarse sin contraprestación (como invitación) estará sujeta al Impuesto sobre el Valor Añadido como autoconsumo de servicios en virtud de lo dispuesto en el artículo 12 de la Ley 37/1992.»
- **VAT Law art. 79.Cuatro: self-supplied services are taxed on their cost.**
  > «Cuatro. En los casos de autoconsumo de servicios, se considerará como base imponible el coste de prestación de los servicios incluida, en su caso, la amortización de los bienes cedidos.»
- **Caveats on V2347-24:**
  - It came from the corporate-tax department, not the VAT department.
  - Read literally, art. 12.3.º covers free services only when given for purposes outside the business:
  > «3.º Las demás prestaciones de servicios efectuadas a título gratuito por el sujeto pasivo no mencionadas en los números anteriores de este artículo, siempre que se realicen para fines ajenos a los de la actividad empresarial o profesional.»
- No source says whether the free item may be left off the ticket.
- **Questions for the advisor:**
  - "On a mixed-rate bill, must a free item take a market-value share of the price paid, rather than €0?"
  - "Is a fully comped table self-supply at cost, and what record should it produce?"

**Bullet 4. Weighed items where the discount misses by a few cents — ANSWERED in principle**
- **V0602-26 (binding, 2026), with the same wording in V1919-18 and V2162-09: round only the final total, to the nearest cent.**
  > «si bien, en todo caso, en los importes totales a pagar o cobrar se deberá redondear por exceso o por defecto al segundo decimal que corresponda al céntimo de euro más próximo.»
- **V0602-26: the number of decimals in a unit price is the business's choice.**
  > «Lo que este precepto no exige es la consignación de un precio unitario con un número determinado de decimales (dos, cuatro, seis…) que queda al criterio del sujeto obligado a expedir la factura.»
- **V0602-26: insignificant rounding differences are accepted.**
  > «las exigencias del artículo 6.1 letra f) relativa a la “descripción de la operación” se estimarán cumplidas siempre que la información aportada a la Administración Tributaria sea lo suficientemente ilustrativa de la operación, aunque existan discrepancias insignificantes en los cálculos aritméticos por efecto de los redondeos.»
- **Question for the advisor:** none needed.

**Bullet 5. One product on two lines at different unit prices — ANSWERED**
- The same rulings apply.
- **Question for the advisor:** none needed.

## 2.1 Products marked "No tax (0%)"

**Bullet 1. Which real cases can use S1 at 0%? — ANSWERED: almost none**
- **VAT Law art. 91.Cuatro: the only 0% rate in the Law.**
  > «Cuatro. Se aplicará el tipo del 0 por ciento a las entregas de bienes realizadas en concepto de donativos a las entidades sin fines lucrativos definidas de acuerdo con lo dispuesto en el artículo 2 de la Ley 49/2002»
- **Control:** "0 por ciento" appears once in the whole consolidated text. "21 por ciento" is found, so the text loaded.
- **AEAT 2026 rates table: its only 0% line is the same item.**
  > «Donativos de determinados bienes a entidades beneficiarias de mecenazgo destinados a sus fines de interés» … «general (alimentos, ciertos artículos médicos, libros, suministro de agua, paneles solares)»
- **RDL 4/2024: the 0% rate on basic foods ended on 30 September 2024.**
  - 0% applied «Con efectos desde el 1 de julio de 2024 y vigencia hasta el 30 de septiembre de 2024».
  - Then «Dos. Con efectos desde el 1 de octubre de 2024 y vigencia hasta el 31 de diciembre de 2024:» … «Se aplicará el tipo del 2 por ciento…».
  - Since 2025 those foods are at 4% (art. 91.Dos.1.1.º).
- **AEAT validation rules §15.1: 0 is accepted with S1, with no date limit.**
  > «Solo se permiten TipoImpositivo = 0; 2; 4; 5; 7,5; 10 y 21 (valores que indican el tanto por ciento).»
- **Our reading:** the one real deli or restaurant case is food donated to a non-profit.
- **Question for the advisor:** "Is there any other 2026 case for S1 at 0%?"

**Bullet 2. Should out-of-scope amounts be recorded as N1 or N2? — NARROWED**
- **AEAT validation rules: what N1 means.**
  > «N1 – Operación no sujeta según los artículos 7, 14 y otros supuestos de no sujeción de la Ley 37/1992, de 28 de diciembre, del IVA.»
- **AEAT validation rules: an N1 or N2 line carries no rate and no VAT amount.**
  > «Si CalificacionOperacion es = “N1/N2” e Impuesto = ”01” (IVA) o no se cumplimenta (considerándose “01” - IVA), no se puede informar ninguno de estos campos:»
- **AEAT itself allows either form for amounts paid on the customer's behalf (suplidos).**
  > «No obstante, en el caso de que se incluyeran como mayor importe en el concepto “Importe total factura” (lo cual, no es obligatorio), deberán consignarse como importe no sujeto al IVA o cantidades a tipo cero (0%).»
- **Question for the advisor:** "Which restaurant amounts are outside the scope of VAT (N1)?"

**Bullet 3. Label it "VAT 0%"? — NARROWED**
- No source addresses the label.
- **Our reading:** "VAT 0%" is the accurate label.

## 2.2 VAT rate change while an order is open

**Bullet 1. A table opened before midnight, paid after a rate change — NARROWED**
- **VAT Law art. 90.Dos: the rate is the one in force when the tax falls due.**
  > «Dos. El tipo impositivo aplicable a cada operación será el vigente en el momento del devengo.»
- **VAT Law art. 75.Uno.2.º: for services, that is when the service is provided.**
  > «2.º En las prestaciones de servicios, cuando se presten, ejecuten o efectúen las operaciones gravadas.»
- **V1926-10 (binding, 2010): the old rate applies to work received before the change, even if paid after it.**
  > «se aplicará el tipo impositivo del 16 por ciento a las certificaciones finales, ya sean totales o parciales, que documenten obras que hayan sido objeto de recepción con anterioridad al 1 de julio de 2010 aun cuando su pago se produzca con posterioridad a dicha fecha.»
- **Same ruling: one contract may be split across two rates without a corrective invoice.**
  > «sin que sea procedente expedir factura rectificativa cuando para una misma obra una parte se grave al 16 por ciento y otra al 18 como consecuencia de la aplicación de los mismos.»
- **V0319-26 (binding, 2026): for continuous supplies, the rate is the one in force when each instalment becomes payable.**
- **No transitional rule was found.** RDL 4/2024 mentions devengo only in social-security provisions.
- **Mid-year changes do happen.** Electricity went from 21% to 10% on 22/03/2026:
  > «(1) Desde el 1.1.2026 hasta 21.03.2026 se aplica el 21%. Desde el 22.03.2026 hasta el 30.06.2026 se aplica el 10%»
- **RDL 29/2026 (from 1 December 2026) rewrites art. 91.Uno.2.2.º but keeps restaurants at 10%.** It only adds short-term furnished rentals.
  > «Dos. Con efectos desde el 1 de diciembre de 2026, se modifica el artículo 91.Uno.2.2.º…»
  - It replaces RDL 26/2026, which Congress revoked on 2 October 2026.
- **Our reading:** "rate on the issue day" is a simplification, not the legal test.
- **Question for the advisor:** "Does a restaurant meal fall due per dish served or when the meal ends? May we use the issue date as a simplification?"

**Bullet 2. A setup error (10% instead of 21%) — NARROWED, with a complication**
- **Developer FAQ §17, case 2.a: this exact example needs a corrective invoice.**
  > «el tipo impositivo, en el que se ha puesto un 10% cuando debería haberse puesto un 21%»
- **V1926-10: a wrong rate needs a corrective invoice at the right rate.**
  > «en el supuesto de que se hubiera expedido una factura en la que se repercuta un tipo impositivo distinto al que corresponda, por una aplicación incorrecta de las reglas de devengo del Impuesto sobre el Valor Añadido, se deberá expedir una factura rectificativa aplicando el tipo correcto»
- **Complication: VAT Law art. 89.Tres.1.º bars charging consumers extra VAT afterwards.** The exception is a legal rate rise, in its month of entry into force and the following month.
  > «1.º Cuando la rectificación no esté motivada por las causas previstas en el artículo 80 de esta Ley, implique un aumento de las cuotas repercutidas y los destinatarios de las operaciones no actúen como empresarios o profesionales, salvo en supuestos de elevación legal de los tipos impositivos, en que la rectificación podrá efectuarse en el mes en que tenga lugar la entrada en vigor de los nuevos tipos impositivos y en el siguiente.»
- **Question for the advisor:** "After a 10%-for-21% setup error on consumer sales, does the venue issue an R5, or only declare the difference itself in a corrected modelo 303?"

**Bullet 3. Payment days later, or invoice first and payment later — NARROWED**
- A later payment changes nothing (V1926-10, as above).
- **V1926-10: an advance payment fixes the rate for that part at the date of payment.** This matters for deposits (1.10).
  > «En el supuesto de que se efectuaran pagos a cuenta anteriores a la realización de las operaciones objeto de consulta, el tipo impositivo aplicable será el vigente en el momento en que tales pagos se realicen efectivamente.»

## 3.1 F3 invoices that replace tickets

**Bullet 1. Which identity-document types (IDType) for a foreign customer? — NARROWED**
- **Technical rules are settled** (validation rules §13 and the error-code list):
  - **Type 02, EU VAT number:** allowed only on F1, F3 and R1–R4, and must be a valid EU VAT number.
    > «Cuando se identifique a través del bloque “IDOtro” y IDType sea “02”, se validará que TipoFactura sea “F1”, “F3”, “R1”, “R2”, “R3” ó “R4”.»

    > «Cuando uno o varios destinatarios se identifiquen a través de la agrupación IDOtro e IDType sea “02”, se validará que el campo identificador se ajuste a la estructura de NIF-IVA de alguno de los Estados Miembros y debe estar identificado.»
  - **Country code:** mandatory for every type except 02.
    > «1111 = El campo CodigoPais es obligatorio cuando IDType es distinto de NIF-IVA (02).»
  - **Country ES:** only with passport (03) or "not registered" (07).
    > «1126 = El valor del CodigoPais solo puede ser ES cuando el IDType sea Pasaporte (03) o No Censado (07). Si IDType es No Censado (07) el CodigoPais debe ser ES (España).»
  - **Type 07:** only for a Spanish individual's tax ID.
    > «1131 = El valor del campo ID ha de ser el NIF de una persona física cuando el campo IDType tiene valor No Censado (07).»
  - Type 07 is also accepted with an error that must be fixed later («error admisible», §4.3.1). **So 07 is never right for a foreigner.**
- **V2305-24 (binding, 2024): AEAT's order of preference among identity documents.** A Spanish ID card or tax ID, then a foreigner's ID card or number (NIE), and failing those a passport or official home-country ID.
  > «deberá atenderse con carácter preferente al señalado en documentos oficiales identificativos de la persona física que se encuentren vigentes, como serían el documento nacional de identidad, el número de identificación fiscal, la tarjeta de identidad de extranjeros o el número de identificación de extranjeros, que es un código para la identificación tributaria de los extranjeros en España y, a falta de los anteriores el que figure en el pasaporte en vigor u otro documento que acredite su identidad, expedida por las autoridades competentes del país de origen o de procedencia.»
- **Invoicing regulation, art. 6.1.d.3.º: the recipient's tax ID is mandatory on any domestic full invoice from a business established in Spain.** No source covers a customer who has none.
  > «3.º Que se trate de operaciones que se entiendan realizadas en el territorio de aplicación del Impuesto y el empresario o profesional obligado a la expedición de la factura haya de considerarse establecido en dicho territorio.»
- **Question for the advisor:** "Can a foreign consumer with no Spanish tax ID get a full invoice identified by passport (03)?"

**Bullet 3. May an F3 replace tickets issued by another of the taxpayer's systems? — NARROWED**
- **The schema links to replaced tickets only by tax ID, number and date.** There is no field for the system that issued them.
  > «Datos de identificación de factura sustituida o rectificada. El NIF se cogerá del NIF indicado en el bloque IDFactura»
- **Taxpayer FAQ (traceability page): cancellations and correction records may cover invoices issued "in that system or another".**
  > «Cuando en un sistema informático de facturación (SIF), de manera justificada, haya que generar un RF de anulación de una factura expedida indebidamente (en ese SIF o en otro) o un RF de alta de subsanación de ciertos errores detectados en alguna factura expedida (en ese SIF o en otro), estos irán encadenados con el anterior registro de facturación generado por el SIF en el que se está haciendo la operación de anulación o subsanación.»
- **V0064-20 (binding, 2020): even an authorised third party may issue the replacement invoices.**
  > «se reconoce la facultad de que los proveedores de los clientes autoricen a la entidad consultante para que ésta emita las facturas de canje de las facturas simplificadas siempre y cuando se cumplan los requisitos previstos en el anterior artículo.»
- No source names F3 and "another system" together. **Our reading, by analogy:** allowed.

**Bullet 4. Mandatory and optional recipient fields — ANSWERED**
- **The recipient block is mandatory on F3.**
  > «1189 = Si TipoFactura es F1 o F3 o R1 o R2 o R3 o R4 el bloque Destinatarios tiene que estar cumplimentado.»

  Developer FAQ §27 says the same: «Siempre debe llevar el destinatario de la misma.»
- **Each recipient:**
  - Name (`NombreRazon`): mandatory.
  - Exactly one of `NIF` or `IDOtro`.
  - Inside `IDOtro`, `IDType` and `ID` are mandatory. `CodigoPais` is optional in the schema (`minOccurs="0"`), but error 1111 requires it except for type 02.
  - Up to 1,000 recipients per invoice.
- **The list of replaced tickets is optional per AEAT's validation rules and taxpayer FAQ:**
  > «Sólo podrá incluirse esta agrupación (no es obligatoria) cuando el campo TipoFactura="F3".»
  > «… se identificarán las facturas simplificadas sustituidas con el número, serie y fecha de expedición. La identificación es opcional.»
  - The developer FAQ §27 instead says it «debe incorporarse». The two AEAT sources differ.
- **New: if a ticket was credited with a negative F2, its replacement is an F1, not an F3.**
  > «IMPORTANTE: En el caso de que se realice un abono de la factura simplificada (mediante el envío de un registro negativo con clave “F2”), la factura emitida en sustitución de esta tendrá que informarse con la clave “F1”.»

## 3.3 Correcting by differences or by substitution

**Bullet 1. Is one method preferable or compulsory? — ANSWERED: free choice**
- **Invoicing regulation, art. 15.5: a ticket corrective may state either the change or the corrected totals.**
  > «Cuando lo que se expida sea una factura simplificada rectificativa, los datos a los que se refiere el artículo 7.1.f) y g) y, en su caso, el 7.2.b), expresarán la rectificación efectuada, bien indicando directamente el importe de la rectificación, bien tal y como quedan tras la rectificación efectuada, señalando igualmente en este caso el importe de dicha rectificación.»
- **Taxpayer FAQ: the business chooses.**
  > «Asimismo, se deberá identificar el tipo de factura rectificativa con las claves "S- por sustitución" o "I- por diferencias" según la forma en que el empresario desee llevar a cabo la rectificación.»
- **Developer FAQ §17: either method is allowed in general.**
  > «Esa rectificación, con carácter general, puede realizarse por medio de la sustitución de la factura inicial por una nueva factura o bien por la modificación de la factura inicial.»
- **Developer FAQ §27: for tickets, either method, and substitution may use one or two invoices.**
  > «La rectificación de la simplificada puede hacerse por diferencias o por sustitución, y en caso de sustitución podría hacerse mediante una o dos facturas.»
- **Every ticket corrective is R5, whatever the reason.**
  > «La rectificación de una factura simplificada se registrará con la clave R5 cualquiera que sea el motivo de la misma.»

**Bullet 2. Several corrections of one invoice — ANSWERED**
- **The taxpayer FAQ works examples of correcting an earlier corrective, by both methods.**
  > «Ejemplo 4: Rectificación de factura rectificativa previa: aumento de base imponible.»
- **Invoicing regulation, art. 15.4: one corrective may cover several invoices.**
  > «Se podrá efectuar la rectificación de varias facturas en un único documento de rectificación, siempre que se identifiquen todas las facturas rectificadas.»
- Nothing requires switching to substitution from the second correction on.

## 3.4 Cancellation on a later day

**Bullet 1. Which modelo 303 period? — NARROWED**
- **Developer FAQ §17, case 2.d: a cancelled invoice has no tax effect at all.**
  > «La consecuencia de ello es que dicha factura no tendrá ningún efecto fiscal ni en libros registros, ni en autoliquidaciones a presentar.»
- **General Tax Law, art. 120.3–4: a corrected self-assessment where the tax's own rules require one.**
  > «Cuando lo establezca la normativa propia del tributo, el obligado tributario deberá presentar una autoliquidación rectificativa»
- **VAT Law art. 89.Cinco, where VAT is corrected downwards:**
  > «Cuando la rectificación determine una minoración de las cuotas inicialmente repercutidas, el sujeto pasivo podrá optar por cualquiera de las dos alternativas siguientes:»

  - **Option (a):** correct the original return through the procedure in General Tax Law art. 120.3.
    > «a) Iniciar ante la Administración Tributaria el procedimiento de rectificación de autoliquidaciones previsto en el artículo 120.3 de la Ley 58/2003…»
  - **Option (b):** correct it in the current return or a later one, within one year.
    > «b) Regularizar la situación tributaria en la declaración-liquidación correspondiente al periodo en que deba efectuarse la rectificación o en las posteriores hasta el plazo de un año…»
- **Not settled:** whether art. 89.Cinco covers a Veri*Factu cancellation, which AEAT calls "un concepto fáctico" (a practical device, not a legal one).
- **Taxpayer FAQ (cancellation page): a cancelled number stays in the series.**
  > «Sí. Desde el punto de vista sustantivo, si las facturas se han emitido, aunque sean erróneas deben mantenerse, con su correspondiente numeración, y sin perjuicio de que se anulen posteriormente y se sustituyan por nuevas facturas correctas.»
- **Question for the advisor:** "After the original period is declared: a corrected return for that period, or the art. 89.Cinco.b option in the current period?"

**Bullet 2. A time limit on cancelling? — ANSWERED in part**
- **Developer FAQ §17: no maximum period for a cancellation record.**
  > «… no existiendo, en principio, un plazo máximo fijado para ello.»
- **Invoicing regulation, art. 15.3: a corrective invoice must be issued within four years.**
  > «siempre que no hubiesen transcurrido cuatro años a partir del momento en que se devengó el Impuesto…»
- **What decides between the two is the facts, not time.** A real sale cannot be cancelled:
  > «Con carácter general, todas las facturas emitidas, en la medida en que respondan a operaciones realmente efectuadas (como es el caso habitual) no pueden anularse.»
- **Whether the customer already received the invoice counts.**
  > «un aspecto que puede influir en el uso de este mecanismo es si la factura expedida (con errores) ya se ha entregado o no al cliente.»

**Bullet 3. Internal daily close on a different day — OPEN.** No source covers internal cash reports.

## 4.3 Invoice series (bullets b–d)

**Bullet b. Separate series for tickets and full invoices, plus correctives? — ANSWERED, with a correction to our premise**
- **Invoicing regulation, art. 7.1.a: tickets and full invoices of the same year need separate series.**
  > «Cuando el empresario o profesional expida facturas conforme a este artículo y al artículo 6 para la documentación de las operaciones efectuadas en un mismo año natural, será obligatoria la expedición mediante series separadas de unas y otras.»
- **V2885-16 (binding, asked by a till vendor) confirms it.**
  > «si la consultante expide en un mismo año natural tanto facturas completas como facturas simplificadas, unas y otras deberán expedirse en series separadas y la numeración dentro de cada serie deberá ser correlativa.»
- **V2884-16 (binding): correctives of full invoices need their own series; ticket correctives may stay in the ticket series.**
  > «la expedición de las facturas rectificativas debe efectuarse obligatoriamente con una serie específica, distinta de aquella que identifica a las facturas completas. Lo anterior será de aplicación con independencia de que la factura rectificativa que corrija una factura completa se expida como factura simplificada, tal y como prevé el artículo 4 del Reglamento de facturación. No obstante lo anterior, las facturas simplificadas rectificativa podrán incluirse dentro de la misma serie con el resto de facturas simplificadas en las que se documenten las operaciones efectuadas en el mismo año natura.»
- **This matches the regulation's wording:**
  - For full invoices, art. 6.1.a makes a corrective series obligatory "en todo caso" (in every case).
  - For tickets, art. 7.1.a lists correctives only among optional reasons for a separate series ("Se podrán…").
- **This corrects** the advisor document's premise and `verifactu-findings.md` §10.1.

**Bullet c. Does F3 need its own series? — NARROWED: no rule requires one**
- **Invoicing regulation, art. 15.6: an F3 is not a corrective invoice.**
  > «No obstante, las facturas que se expidan en sustitución o canje de facturas simplificadas expedidas con anterioridad no tendrán la condición de rectificativas…»
- F3 is not on art. 6.1.a's list of mandatory separate series.
- **AEAT's worked example numbers an F3 in an "F-" series.** That is practice, not a rule.
  > «IDFactura : NumSerieFactura : F-0001 TipoFactura : F3 IDFacturaSustituida : NumSerieFactura : S-0001»
- **Question for the advisor:** yes or no on putting F1 and F3 in one series.

**Bullet d. May R5 and R1–R4 share one series? — NARROWED**
- No source addresses it directly.
- **Our reading:** R1–R4 have full-invoice content and R5 has ticket content, so art. 7.1.a's separation suggests they should not share. V2884-16 lets R5 stay in the ticket series, which avoids the question.
- **Question for the advisor:** "Does art. 7.1.a stop R5 and R1–R4 sharing one corrective series?"

## 5.2 Rounding cash totals to 5 cents — NARROWED
- **No Spanish rule on cash rounding was found.** This was a general web search, not a BOE search.
- **DGT doctrine requires rounding to the nearest cent** (V0602-26 and the two earlier rulings, as under 1.9). So 5-cent rounding is a price change, not permitted rounding.
- **VAT Law art. 78.Tres.2.º: rounding down before the invoice is issued is a discount.**
  > «2.º Los descuentos y bonificaciones que se justifiquen por cualquier medio de prueba admitido en derecho y que se concedan previa o simultáneamente al momento en que la operación se realice y en función de ella.»
- **Rounding up — our reading, under VAT Law art. 78.Uno: the extra cents are part of the price, so they are taxable.**
  > «Uno. La base imponible del impuesto estará constituida por el importe total de la contraprestación de las operaciones sujetas al mismo procedente del destinatario o de terceras personas.»
- **Developer FAQ §20: a "total to pay" may differ from the invoice total only for amounts outside the invoice.** Its examples are disbursements and withholdings; rounding is not among them.
  > «Se trata de cantidades que alteran el "total a pagar" añadiendo o restando cantidades, pero no el "Importe total factura" según lo define el RRSIF»
- **Question for the advisor:** "Must the extra cents from rounding up go into the taxable amount?"

## 5.3 A corrective invoice issued by a different server — NARROWED
- **Developer FAQ §17: cancellations and correction records may come from a different system.**
  > «tanto un RF de alta de subsanación como un RF de anulación se podrían generar y conservar o remitir a la AEAT desde un SIF distinto al que expidió la factura original (aunque probablemente, lo más habitual es que todo se haga en el mismo SIF).»
- The taxpayer FAQ (traceability page) says the same, as quoted under 3.1 bullet 3.
- The corrective's link to the original is by tax ID, number and date only (the same schema type as F3).
- **No source names a corrective invoice from another system.** Our analogy only.

## 5.4 Tips

**Bullet 1. Is a tip outside VAT, including on a card? — ANSWERED**
- **2174-03 (general, 2003): restaurant tips are not consideration, so they are outside the taxable amount.**
  > «Las cantidades que en concepto de propinas satisfagan con carácter voluntario y unilateral los destinatarios de los servicios de restaurante, y que no los sean exigibles por la prestación de tales servicios, no constituirán un crédito efectivo a favor de la sociedad consultante ni tampoco contraprestación de dichos servicios a efectos del Impuesto sobre el Valor Añadido, por lo que no formarán parte de la base imponible de dicho Impuesto correspondiente a los referidos servicios de hostelería que prestará la sociedad consultante.»
- **New: V2182-23 (binding, 2023, VAT department).** Tips paid through the company's app and passed on to drivers are outside VAT.
  > «Dicha aplicación permite a los usuarios dejar voluntariamente una propina a los conductores que prestan materialmente el servicio, que es transferida por la consultante a los mismos.»
  > «En consecuencia con lo anterior, puede concluirse que las propinas que de manera voluntaria y unilateral satisfagan los clientes a los conductores que prestan el servicio de transporte no formarán parte de la base imponible del Impuesto sobre el Valor Añadido, no quedando, por tanto, sujetas al mismo.»

**Bullet 2. Does PETETE match our summary? — ANSWERED: the substance matches, two details are off**
- **V3095-17's exact wording differs from the repo's quote.** The repo's version («…del casino no forman parte de la base imponible del IVA») is not PETETE's text; it failed the verifier, as intended. The real text is:
  > «Por lo tanto, las propinas que de manera voluntaria y unilateral satisfagan los clientes de la consultante a los crupieres trabajadores de la ésta no formarán parte de la base imponible del Impuesto sobre el Valor Añadido.»
- **The rulings conflict on corporate tax.**
  - V3095-17 says tips the company books are corporate-tax income:
    > «en la medida en que las propinas recibidas por la entidad consultante tenga la consideración de ingreso contable, el importe de las mismas deberá integrarse en la base imponible del Impuesto sobre Sociedades del período impositivo correspondiente»
  - 2174-03, decided under the repealed corporate tax law, says they are not:
    > «las cantidades recibidas como propinas no constituyen ingreso fiscal, puesto que la entidad consultante actúa como intermediario en la remuneración a terceros.»
- **V1808-22 is about a website's tip button, not a restaurant.** It holds such payments are outside VAT altogether:
  > «es criterio de este Centro directivo (por todas, contestación vinculante de 18 de enero de 2010, número V0028-10) el de considerar que las mismas no determinarán la realización de operaciones sujetas al impuesto en la medida en que no constituyan la remuneración de entregas de bienes o prestaciones de servicios realizados por la consultante a favor de las personas o entidades que las satisfacen.»
- **The labels in the advisor document are right:** V3095-17 and V1808-22 binding, 2174-03 general. V2182-23 is the better binding VAT authority.
- **Question for the advisor:** "Card tips collected by the company: corporate-tax income (V3095-17) or pass-through (2174-03)?" This is outside VAT.

## Side findings
- **RD 238/2026 (BOE 31/03/2026, in force 20/04/2026) changed the invoicing regulation.**
  - It added art. 8 bis: mandatory electronic invoices between businesses. Tickets are excluded, except those under art. 7.2.
  - It rewrote art. 9, which `verifactu-findings.md` §9 quotes in its old wording.
  - I did not read the start dates.
- **V2645-16 (binding, 2016) is relevant to section 6.** A till that restarts its numbering within a year is acceptable only exceptionally, if each ticket stays unambiguously identifiable. Systematic reuse is "no conforme a Derecho" (not lawful).

## Summary table

| Bullet | Verdict | Finding |
|---|---|---|
| 1.3 b1 | NARROWED | No ruling on diners. V1002-22: whoever placed the order. 1693-02: whoever must pay |
| 1.3 b2 | NARROWED | Duplicates exist so co-buyers can deduct VAT. An F2 cannot name recipients |
| 1.3 b3 | NARROWED | Same two tests. Nothing on the guest's request |
| 1.9 b1 | ANSWERED | Extra ticket lines allowed. Record total is net of discounts |
| 1.9 b2 | NARROWED | VAT Law art. 79.Dos: split by market value |
| 1.9 b3 | NARROWED | Free item with a sale is a discount, shared by market value (V0555-17). Pure invitation is self-supply at cost (V2347-24) |
| 1.9 b4 | ANSWERED | Round totals to the cent. Small gaps accepted (V0602-26) |
| 1.9 b5 | ANSWERED | Same rulings |
| 2.1 b1 | ANSWERED | Only 0%: donations to non-profits. Food 0% ended 30/09/2024 |
| 2.1 b2 | NARROWED | Use N1 for out-of-scope amounts. AEAT allows 0% or N1 for disbursements |
| 2.1 b3 | NARROWED | No source on the label |
| 2.2 b1 | NARROWED | Rate when the service is provided, not the invoice date. No rule for a straddling meal |
| 2.2 b2 | NARROWED | Corrective invoice, but art. 89.Tres.1.º bars charging consumers extra |
| 2.2 b3 | NARROWED | Later payment changes nothing. Advance payment fixes the rate for that part |
| 3.1 b1 | NARROWED | Technical rules settled. V2305-24 order of documents. 07 never for foreigners |
| 3.1 b3 | NARROWED | AEAT allows cross-system cancellations and correction records. Our analogy for F3 |
| 3.1 b4 | ANSWERED | Field rules settled. Negative F2 means the replacement is F1 |
| 3.3 b1 | ANSWERED | Free choice of method |
| 3.3 b2 | ANSWERED | Repeated corrections allowed |
| 3.4 b1 | NARROWED | No tax effect. Corrected return (LGT 120) vs VAT Law 89.Cinco.b |
| 3.4 b2 | ANSWERED (part) | No limit for cancellation, four years for correctives. Facts decide |
| 3.4 b3 | OPEN | No source |
| 4.3 b | ANSWERED | Separate series needed. R5 may share the ticket series (V2884-16) |
| 4.3 c | NARROWED | No rule requires a separate F3 series |
| 4.3 d | NARROWED | No source. Art. 7.1.a suggests R5 and R1–R4 should not share |
| 5.2 | NARROWED | Rounding down is a discount. Rounding up probably taxable |
| 5.3 | NARROWED | Only by analogy |
| 5.4 b1 | ANSWERED | Tips outside VAT, including electronic tips (V2182-23) |
| 5.4 b2 | ANSWERED | Substance matches. Repo's V3095-17 quote is not the ruling's wording. Corporate-tax conflict |
