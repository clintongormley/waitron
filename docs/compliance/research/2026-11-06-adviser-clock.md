# Adviser research, 2026-11-06: the time on fiscal records (Q51, Q52, Q60, Q61)

Researched on 6 November 2026. Every Spanish quotation below was matched word for word, by script,
against text downloaded that day with `curl` (PDFs through `pdftotext`). Nothing here has been run
against AEAT, nothing was sent to anyone, and nothing in the repository changed. The code was read,
not run. This is research for the owner, not professional advice.

Terms used throughout:

- **Record:** a Veri\*Factu invoicing record (registro de facturación).
- **Generation time:** the record's `FechaHoraHusoGenRegistro`, the moment the record was made.
- **Issue date:** the date printed on the invoice, `FechaExpedicionFactura`.
- **Corrective invoice:** a factura rectificativa. R4 and R5 are its record types.
- **VAT falling due:** devengo, the moment the VAT legally arises.
- **DGT:** the tax ministry's rulings directorate. A numbered V-ruling is a binding answer.
- **AEAT developer FAQ:** `FAQs-Desarrolladores.pdf`, version 1.3.

## The short version

1. **The one-minute rule does not apply to Waitron as a Veri\*Factu system.** Article 3 of Orden
   HAC/1177/2024 switches off articles 7.f, 7.h, 7.i and 7.j, and AEAT's FAQ says so in plain words
   twice. The A798 design already read article 3 this way for article 7.f, but Q51 still asks the
   adviser about the minute. Article 7.i is the new part: it is the one rule that names a step back,
   and it is off too. The minute in the product is the owner's own threshold.
2. **The stop on payments is the owner's choice, not a legal duty.** No source requires it. AEAT's
   nearest statements lean the other way, though they describe other situations. The DGT was asked
   about a very similar stop this year and declined to judge it (V5067-26).
3. **A wrong issue date does need a corrective invoice.** The DGT has said so four times, once to a
   billing-software company asking about exactly this: a date later than the real one (V1665-22).
   So "keep the list and change nothing" is not enough when the wrong clock changed the date. This
   is the biggest change to the current position.
4. **A wrong time on the right date looks like no problem at all.** The hour is not an invoice item,
   and a correcting record could not restore it anyway. This needs a yes or no from a professional.
5. **The VAT period follows the day the VAT fell due, not the date on the invoice.** Waitron's own
   VAT return report sorts sales by issue date, so a misdated sale lands in the wrong period there.
6. **By AEAT's published rules, an issue date ahead of AEAT's is refused, not just flagged.** Error
   1112 is on the rejection list. After three such refusals in a row Waitron's sender holds the rest
   of the chain (read, not run). This is the likely outcome of the Q60 situation, and Q60 only
   mentions rejection in passing. No test has seen it.

All four questions can become **one question of eight points** (draft at the end). Three points need
real professional judgement; the rest should be a yes or a correction. At the brief's rates that is
about €300 instead of about €1,200 (an estimate, not a quote).

## Outcomes at a glance

| Sub-question | Outcome | Answer in a line |
| --- | --- | --- |
| 51.0 Must payments stop? | ANSWERED | No. Owner's choice; the DGT declined to judge a similar stop. |
| 51.1 May a record's time be earlier than the last? | NARROWED | Yes, when the new time is the exact one. |
| 51.2 Does AEAT accept it? | NARROWED | Nothing published refuses it. A free test settles it. |
| 51.3 Must it be marked? | ANSWERED | No field exists for it. |
| 51.4 If not allowed, then what? | DROP | Falls with 51.1. Stamping the old time is ruled out either way. |
| 51.5 Do seconds or a minute differ? | ANSWERED | No. The minute does not apply to Veri\*Factu. |
| 52.1a Only the time wrong: is a file enough? | NARROWED | Yes. |
| 52.1b Date wrong: is a file enough? | ANSWERED | No. Corrective invoice (60.1). |
| 52.2 Correcting record for the date? | ANSWERED | Not available. |
| 52.3 Cancel and reissue? | NARROWED | Not normally. Possible opening for an undelivered ticket. |
| 52.4, 60.7, 61.4 Tell AEAT? | NARROWED | No duty or channel found. |
| 52.5 Evidence and period | NARROWED | Keep with the invoices. Folds into Q48. |
| 52.6 Does sent or accepted matter? | ANSWERED | No, except a rejected record (60.8). |
| 60.1 Remedy for a wrong date | ANSWERED | Corrective invoice, R4 or R5, no VAT change (V1665-22). |
| 60.2 Simplified invoices too? | ANSWERED | Yes. |
| 60.3a One corrective for many invoices? | ANSWERED | Yes, up to 1,000 per record. |
| 60.3b Delivery to unknown customers | KEEP | No source. |
| 60.4 Same day, hour wrong | NARROWED | Nothing needed. |
| 60.5a What decides the VAT period? | ANSWERED | When the VAT falls due, not the invoice date. |
| 60.5b A return already filed wrongly | NARROWED | Complementary return, for the gestoría. |
| 60.6 Clock running behind | ANSWERED | Same remedy. Waitron does not list these yet. |
| 60.8 Records AEAT rejected | NARROWED | Resend when the date arrives, then correct. Untested. |
| 60.9 Real time unknown | KEEP | A question of proof. |
| 61.1 May the time come from a till? | ANSWERED | Yes as a source (art. 7.e). |
| 61.2 Is a crafted request a compliance risk? | KEEP | The real legal question. Goes with Q53. |
| 61.3 Extra evidence | NARROWED | None required. |
| 61.5 Earlier invoices | DROP | Same as Q60. |
| 61.6 Every start without internet | DROP | Hypothetical until the owner decides slice 9c. |
| Payment rhythm, who files the return, business customers | VENUE | Owner or gestoría. |

## Does each question still make sense?

Compared with `main` at `b18125eceb`, reading the code, `docs/developers/conventions-data.md`, the
A798 design and `docs/backlog/box.md`.

| Question | Sentence checked | Result |
| --- | --- | --- |
| Q51 | The stop at more than a minute behind | Built (`clock-behind.ts`). But Q51 never says the stop is a product choice, and it asks about a minute that does not apply. |
| Q51 | One step back, later records held to a minute | Matches `conventions-data.md`. |
| Q51 | Two devices count only outside a stop found at start-up | Matches `clock-watch.ts`, line 417. |
| Q52 | A later check can prove the accepted time wrong | Built (`noteClockProvedWrong`). |
| Q52 | "Identificar el intervalo afectado" | **Overstated.** The backlog says sales made after the disproof appear in no alert. |
| Q60 | Only sales dated later than the real time are listed | Matches. Listing the other direction is slice 9c, not built. |
| Q60 | The list says nothing about sending | **Gap.** Most of these records are refused when sent. See 60.8. |
| Q61 | "En cualquier momento, desde el dispositivo propio de un administrador" | **Too wide.** The box sets its clock only inside a stop it already has. The Spanish drops that limit. It also omits an administrator confirming on a till. |
| Q61 | "Si la comprobación se extendiese a cada arranque" | **Hypothetical.** `docs/backlog.md` still lists whether to do slice 9c as a design decision for the owner. |
| All | "Built and parked for the owner as #2331" (`asesor-questions.md`, `backlog/box.md`) | **Stale.** Commit `d4cb662803` (#2331) is on `main`, dated 2026-11-01. |

Waitron's declared version is Veri\*Factu only (the batch's Q53 text says so), which is what makes
the article 3 reading apply. If a non-Veri\*Factu module is ever built, articles 7.f, 7.i and 7.j
apply to it, and these answers must be looked at again.

## Q51: a chain whose time steps back

### 51.0 Must the box stop taking payments? ANSWERED: no

Article 3 of the Orden removes the check that would have caught this:

> «cumplen por diseño ciertos requisitos y características que recogen el resto de secciones del capítulo II de esta orden y, en tanto actúen como «VERI*FACTU», no les serán de aplicación los artículos 6.b), 6.c), 6.d), 6.e), 6.f), 7.f), 7.h), 7.i), 7.j), 8 y 9 de esta orden»

In English: Veri\*Factu systems are presumed compliant by design, and articles 6.b to 6.f, 7.f, 7.h,
7.i, 7.j, 8 and 9 do not apply to them.
[Orden HAC/1177/2024, art. 3](https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138#a3), retrieved
2026-11-06.

AEAT confirms it for the person using the system:

> «los obligados tributarios (OT) usuarios de los sistemas de emisión de facturas no verificables también son responsables de garantizar la precisión de la hora de fechado con un margen máximo de error de un minuto, cosa que no aplica a los OT de los SIF VERI*FACTU»

> «No estarán obligados a asegurar que, en todo momento, el reloj empleado por el SIF para datar los registros de facturación y de evento tiene la hora exacta (con un margen de error de un minuto).»

In English: the one-minute duty falls on users of non-verifiable systems and does not apply to
Veri\*Factu users. [Traceability FAQ](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/caracteristicas-requisitos-sif-trazabilidad.html)
and [Veri\*Factu FAQ](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/sistemas-verifactu.html),
both updated 21 October 2026, retrieved 2026-11-06.

**Signals against stopping, each on a different path:**

- Developer FAQ §15, on a failed fingerprint check in a non-verifiable system: «Pero será preciso
  generar el siguiente RF, ya que la facturación por este motivo NUNCA debe interrumpirse.» In
  English: the next record must still be made, because invoicing must never stop for this. This is
  about a fingerprint error, not a clock.
- Veri\*Factu FAQ, on failures to send: «NO suponen en ningún caso que deba interrumpirse la
  facturación de la empresa». This is about sending, not a clock.
- [Invoicing regulation, art. 11.1](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696#a11):
  «Las facturas deberán ser expedidas en el momento de realizarse la operación.» A stop delays that.

**DGT ruling V5067-26 (24 June 2026) asked about nearly the same thing.** A billing-software
producer asked whether «el bloqueo preventivo del servicio de emisión de registros de facturación
cuando no exista una referencia temporal fiable» complies with article 7.f. The DGT did not say yes
or no:

> «No siendo competente este Centro Directivo para analizar las características técnicas, tecnológicas o informáticas del sistema de facturación en particular»

In English: the DGT is not competent to analyse a system's technical characteristics; checking them
falls to AEAT's management and inspection bodies.
[V5067-26](https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=V5067-26), retrieved
2026-11-06.

So the stop is neither required nor approved. It is an **owner decision**. It also shows that a
binding DGT query is the wrong route for how a mechanism works.

### 51.1 May a record's time be earlier than the previous record's? NARROWED: yes, when the new time is the exact one

What binds a Veri\*Factu system:

- Art. 7.e, still in force for it: «El sistema informático deberá incorporar a los registros de
  facturación la fecha y hora exactas del momento en que son generados». The record must carry the
  exact time it was made.
- [Reglamento (RD 1007/2023), art. 8.2.b](https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840#a8):
  «Todos los datos registrados deberán encontrarse correctamente fechados, indicando el momento en
  que se efectúa el registro.» Article 16.2 presumes Veri\*Factu systems meet article 8 by design.
- The FAQ's softer line, for all systems: «dichos campos deberían ser coherentes con el orden
  temporal de generación de los RF». The time fields should match the order records were made.
  Note «deberían»: should, not must. The duty to detect a mismatch falls only on non-verifiable
  systems.

The one rule that names this case, art. 7.i.2.º, is switched off by article 3. The developer FAQ's
«Lo que no se admite en dicho apartado es que el RF que se está generando tenga fecha y hora
(sistema) más de un minuto anterior al RF anteriormente generado» explains that same switched-off
rule. See the table of apparent contradictions below.

**Proposed answer for a yes or no:** after a real correction, the new record's time is the exact one
and the earlier record's was wrong. Article 7.e then requires the exact time, and no rule in force
for Veri\*Factu forbids the step back.

**The chain order itself is settled.** It follows the order records were made, whatever their
stamps say: «en el mismo orden secuencial en el que hayan sido generados» (traceability FAQ). Waitron
sends each chain in that order (`drain.ts` orders by `secuencia` within a chain; read, not run).

### 51.2 Does AEAT accept it? NARROWED: nothing published refuses it; a free test settles it

AEAT's validation document (v1.2.2) has one check on this field, against AEAT's own clock:

> «Se validará que la FechaHoraHusoGenRegistro sea menor o igual que la fecha del sistema de la AEAT, admitiéndose un margen de error.»

The published [error list](https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/errores.properties)
has no code comparing a record's time with the previous record's. The previous-record block carries
no time at all, only NIF, number, issue date and fingerprint. The list is not silent on chains (it
has 1180, 1269, 2002, 2003 and 2008), so this absence means something. Its limit: art. 16.3 says
acceptance «ni impide posteriores validaciones por parte de la Agencia Estatal de Administración
Tributaria». Later checks remain possible.
[Validation document](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf),
retrieved 2026-11-06; its bytes match the 27 October copy in the library's source archive.

**Free experiment, needing the owner's approval:** one run of the library's preproduction workflow,
as A985 did.

1. Send record A stamped with the current time.
2. Send record B, chained to A, stamped three minutes before A. That is over the minute, and still
   inside the 240 seconds seen on a late record, so code 2004 cannot be mistaken for an ordering
   refusal.
3. Send record C, chained to B, stamped with the current time, as the control.

If AEAT polices the order, B prints an error code that C does not. If it does not, both print
`Correcto`. A gap of days cannot be tried this way without also tripping the upper bound on A.
Preproduction is not production, so this shows only what preproduction does.

### 51.3 Must it be marked somewhere? ANSWERED: no field exists

The record's fields in AEAT's schema (`SuministroInformacion.xsd`, alta and anulación) include
nothing for this. The only incident flag, `Incidencia`, sits in the message header and is defined by
art. 16.4 for a technical incident preventing sending: «alguna incidencia técnica impida la remisión
voluntaria». A clock step does not stop records being sent. The event log of article 9 does not
apply to a Veri\*Factu-only system (art. 3, developer FAQ §15 note 1). Waitron's
`clock_confirmations` table is voluntary evidence.

### 51.4 If it is not allowed, what then? DROP, once 51.1 is confirmed

Two points survive whichever way 51.1 goes:

- **Stamping new records with the last record's time is ruled out.** It would write a time known to
  be false, against art. 7.e.
- **Waiting for real time to catch up** is not required by any source, and art. 11.1 argues against
  it.

### 51.5 Does a gap of seconds or a minute change the answer? ANSWERED: no

The minute exists only in articles 7.f and 7.i.2.º, both switched off. The 240 seconds seen in
AEAT's replies is a tolerance on sending. It is not a rule about the order of records. The
validation document does not print that number.

## Q52: a confirmed time that later proves wrong

### 52.1 Is keeping the file enough? Split in two

**(a) Only the time is wrong; the issue date is right. NARROWED: yes.**

- The hour is not an invoice item. Articles 6.1.b and 7.1.b of the
  [invoicing regulation](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696#a6) ask only for
  «La fecha de su expedición». The developer FAQ §15 adds: «La hora de expedición e impresión
  material de la factura no forma parte del RF».
- AEAT exempts the ahead-of-AEAT case from correction: «Se excepciona este error de la necesidad de
  ser subsanado.» (validation document §4.3.1). Its wording covers only a time later than AEAT's.
- One source points the other way. Developer FAQ §17 case 2.b says an error in an internal record
  field needs a correcting record. But a correcting record carries its own generation time (art.
  10.1.p: the moment that record is made), so it cannot restore the original time. It would replace
  a slightly wrong time with a later wrong one. This last step is our reasoning, not a source.

**(b) The issue date is wrong. ANSWERED: no, a corrective invoice is needed.** See 60.1.

### 52.2 Is a correcting record (subsanación) available? ANSWERED for the date

Not for the issue date, for two reasons:

- «Solo podrá llevarse a cabo una subsanación cuando no se trate de una causa que exija la emisión de
  una factura rectificativa» (validation document §4.3.1).
- It must carry «el mismo identificador de factura», and the issue date is part of that identifier:
  «<NIF> + <NumSerieFactura> + <FechaExpedicionFactura>»
  ([service description](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf)).

### 52.3 Cancel and reissue? NARROWED: not as the normal route

Developer FAQ §17: «Con carácter general, todas las facturas emitidas, en la medida en que respondan a
operaciones realmente efectuadas (como es el caso habitual) no pueden anularse.» A real sale cannot
normally be cancelled. There is one opening: a ticket the customer never received «favorecería la
consideración» of cancelling it. Waitron venues may print only on request, so this can arise. See
point 3 of the draft.

### 52.4 Tell AEAT? NARROWED: no duty and no channel found

A search for clock terms across the Reglamento, the Orden, both FAQs, the validation document and
the service description found no notice of a clock incident. The corrective record itself reaches AEAT. Art. 16.4 asks for
justification only of sending incidents, and only «si así se lo requiere la Agencia Estatal de
Administración Tributaria». This is an absence, so it needs a professional's nod. An AEAT telephone
call could also cover it.

### 52.5 What evidence, and for how long? NARROWED: fold into Q48

No source names clock evidence. It supports invoices, so it should be kept with them for the
general period ([invoicing regulation, art. 19.1](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696#a19)).
Q48 already asks this question for the whole archive.

### 52.6 Does the record's state change the answer? ANSWERED: no

- **Not yet sent:** a generated record is never edited: «no debe ser modificado nunca por nadie»
  (integrity FAQ). It is sent unchanged, in order.
- **Accepted:** «ese RF quedaría para siempre con esos errores en la AEAT»; the error is treated as
  solved once the corrective arrives (developer FAQ §17).
- **Accepted with error 2004:** the same, and the time alone needs no correction. The exemption's
  wording names only a time ahead of AEAT's. Waitron already treats 2004 this way
  (`filing-cases.ts`), and that file states the limit.
- **Rejected:** see 60.8.

## Q60: sales dated by a clock running ahead

### 60.1 What is the remedy when the date is wrong? ANSWERED: a corrective invoice

**[V1665-22](https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=V1665-22)** (11 July
2022) was asked by a billing-software developer about exactly this case, «una fecha posterior a la
real de emisión». The answer:

> «en caso de que se haya consignado de manera incorrecta la fecha de expedición de la factura, será necesaria la expedición de una factura rectificativa que deberá constar en serie específica de factura»

In English: an incorrect issue date requires a corrective invoice in its own series. The same answer
appears in [V0902-22](https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=V0902-22),
[V1924-23](https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=V1924-23) and
[V2611-24](https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=V2611-24). All were
retrieved 2026-11-06. None of the four mentions a Veri\*Factu record or RD 1007/2023 (searched by
text), so applying them to a filed record is our reading.

- It must be done «tan pronto como el obligado a expedirla tenga constancia» of the cause and within
  four years (art. 15.3).
- Failing to rectify is an offence under the [General Tax Law, art. 201](https://www.boe.es/buscar/act.php?id=BOE-A-2003-23186#a201).
  Art. 201.2.a names rectification and sets a penalty of «uno por ciento del importe del conjunto de
  las operaciones», which is 1% of the sales affected.
- The DGT also accepts two documents, a negative invoice and a corrective
  ([V0706-19](https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=V0706-19), quoted in
  all four), but the single corrective is the regulation's normal form.

**Which record type:**

- Full invoice: R4, «Cuando se haya consignado erróneamente algún dato no monetario de la factura».
- Simplified invoice: R5, «cualquiera que sea el motivo» (taxpayer
  [procedures FAQ](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/procedimientos-facturacion.html)).
- The operation date to state is that of the original: «La fecha de realización de la operación
  correspondiente a la factura original que se está rectificando.»

**No VAT is rectified**, since the amount is unchanged. [V0305-24](https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=V0305-24),
answering a software maker, says that outside article 89's cases «no procederá la rectificación de la
repercusión del Impuesto sobre el Valor Añadido», whether or not a corrective invoice is needed.

### 60.2 Does this reach simplified invoices? ANSWERED: yes

Article 15.1 covers «los artículos 6 ó 7», and V0305-24 lists the date in article 7.1 among the
required items. No ruling involves a restaurant ticket specifically.

### 60.3 Can one corrective cover a whole incident, and must a stranger receive it? Two outcomes

- **One document for many invoices: ANSWERED, yes.** Art. 15.4: «Se podrá efectuar la rectificación de
  varias facturas en un único documento de rectificación, siempre que se identifiquen todas las
  facturas rectificadas.» The record allows 1,000 rectified invoices per corrective
  (`maxOccurs="1000"`).
- **Delivery to a customer nobody can identify: KEEP.** No source covers it. Research cannot answer
  whether keeping the document and filing its record is enough. Art. 15.4 also lets AEAT's
  Departamento de Gestión Tributaria authorise «otros procedimientos de rectificación» on request,
  which is a free route if the answer is awkward.

### 60.4 Same day, only the hour wrong: NARROWED, nothing needed

As 52.1(a). This matters because most clock errors are minutes or hours and leave the date alone.

### 60.5 The VAT period: split

**(a) What decides the period? ANSWERED: when the VAT falls due, not the invoice's date.** [VAT Law,
art. 75.Uno.2.º](https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740#a75) makes VAT on a service
fall due «cuando se presten, ejecuten o efectúen las operaciones gravadas». AEAT's SII FAQ 3.12, a
different reporting path that the developer FAQ says can be applied in general on correction
matters, asks for «El ejercicio y período de devengo de la operación»
([SII FAQ, 30 December 2025](https://sede.agenciatributaria.gob.es/static_files/Sede/Procedimiento_ayuda/G417/FicherosSuministros/V_1_1/FaqGral/FAQs_SII_30_12_2025.pdf)).
So a sale at 23:30 on 30 September belongs to the third quarter even if its ticket says 1 October.
Exactly when a meal ends remains the separate question S4.

**(b) A return already filed in the wrong period. NARROWED, for the gestoría.** The general tool is a
complementary return ([General Tax Law, art. 122](https://www.boe.es/buscar/act.php?id=BOE-A-2003-23186#a122))
with a late surcharge starting at «1 por ciento» (art. 27.2), plus correcting the later return. This
falls only on a quarter's edge, for a small sum. It is a yes-or-no for the gestoría, not a software
question.

### 60.6 A clock running behind: ANSWERED, same remedy

V0902-22 and V1924-23 cover any incorrect date, in either direction. **Waitron does not yet list
these** (slice 9c), so the owner would not be told. A later date is rejected by AEAT only when it is
ahead of AEAT's date; an earlier one passes (only the 28-10-2024 floor applies).

### 60.7 Tell AEAT? NARROWED

As 52.4.

### 60.8 Records AEAT rejected: NARROWED, plus a free test

The Q60 scenario probably ends here when the stamped date is ahead of today. The validation document says «La FechaExpedicionFactura no podrá
ser superior a la fecha actual», and code 1112 is on the list of rejections. So a sale stamped
tomorrow is refused when sent today, rather than accepted with a warning. Developer FAQ §17 says such
a record «no figuraría jamás en los sistemas de la AEAT». The corrective would then point at an
invoice AEAT does not hold.

Waitron's side (read, not run): a rejection opens a filing case, and after
`SAME_CODE_REFUSAL_LIMIT` (three) identical refusals later records on the chain are held
(`drain.ts`). A clock a day ahead could therefore stop the filing of later, correctly dated records.

**Corrected the same day:** developer FAQ §17, case 2.a, covers this directly, so the corrective goes at once and the original needs nothing more. The text below is the first proposal, kept as written.

**Proposed answer for a yes or no:** once the real date reaches the stamped date, send the original
unchanged, then issue the corrective. A preproduction test can show whether AEAT takes the resend.

### 60.9 The real time is unknown: KEEP

Q60 says so itself. Knowing which day a sale really fell on is a question of proof. Waitron can offer
the card provider's time and the elapsed-time calculation. Only a professional can say what would
satisfy an inspector.

## Q61: correcting the box's clock from a till

### 61.1 May a system take its time from a till or an administrator's device? ANSWERED for the source

Art. 7.e, still in force: «Si el sistema informático no cuenta con la capacidad de proporcionar esos
datos por sus propios medios, podrá tomarlos de otros sistemas que incorporen reloj.» In English: a
system unable to supply the time itself may take it from other systems with a clock. No rule says
how, or who confirms it, and a Veri\*Factu user has no one-minute duty (51.0).

### 61.2 Does the risk of a crafted request make the system non-compliant? KEEP

This is the real legal risk in Q61, and it is narrow. During a stop found at start-up, any signed-in
staff member could send a false time, which then dates invoices.

- The Reglamento, art. 8.2.b: «Cualquier funcionalidad o mecanismo que permita alterar u ocultar el
  rastro de las operaciones supone un incumplimiento de este requisito.»
- The General Tax Law, art. 201 bis.1, makes it an offence to produce a system that lets someone
  «alterar transacciones ya registradas incumpliendo la normativa aplicable», with a fixed fine of
  «150.000 euros» per year and per system type (art. 201 bis.4). The issue of invoices with
  «datos falsos o falseados» is a very serious offence for the user (art. 201.3).
- Points the other way: past records are untouched, the person is named, and the owner is alerted.
  [V0850-25](https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=V0850-25) treats changes
  as acceptable «siempre y cuando quede el debido registro y trazabilidad de estos», though it speaks
  of changing records, not a clock.
- Ordinary computers let their administrators change the clock too, so a rule forbidding it entirely
  would be surprising. That is our reasoning, not a source.

The DGT will not judge a mechanism (V5067-26), so this goes to the adviser, ideally with Q53 because
the producer's declaration is what is at stake.

### 61.3 What extra evidence? NARROWED: none required

No source requires any record of a clock correction. Even for non-verifiable systems the list in
art. 9.1 has no clock event. What Waitron keeps is voluntary and useful as proof of good faith. The
details about a full disk and a lost alert are therefore not worth paying to ask about: **DROP** them
from the wording.

### 61.4 Tell AEAT? NARROWED

As 52.4.

### 61.5 Earlier invoices: DROP as a separate point

It is Q60 and Q52 again.

### 61.6 Every start without internet: DROP for now

No rule found depends on how often the check happens, and the owner has not decided slice 9c. Ask
only if it is built and the answer to 61.2 turns on it.

## Sources that seem to disagree

| Sources | What they seem to say | The paths they describe |
| --- | --- | --- |
| Developer FAQ §15 («no se admite») and Orden art. 3 | A step back of over a minute is refused, or the rule does not apply | §15 explains art. 7.i.2.º. Art. 3 switches that article off for Veri\*Factu. Its own closing line ties the check to «la modalidad "NO VERI*FACTU"», though the question that opens §15 came from a Veri\*Factu developer. |
| Art. 7.e («exactas») and the FAQ («No estarán obligados») | The time must be exact, or need not be | 7.e binds the system to stamp the time it has. The FAQ removes the user's duty to guarantee accuracy within a minute. |
| Traceability FAQ («deberían ser coherentes») and art. 3 | Order matters, or the check is off | Times should match order, for all systems. Only non-verifiable ones must detect a mismatch. |
| DGT rulings (corrective invoice) and AEAT FAQ, SII FAQ 2.6 and 2.11 (cancel and re-enter under a different date) | Two remedies for a wrong issue date | The rulings govern the invoice. The AEAT answers govern the record, and their example is «operación inexistente». For a real sale the corrective is the safer reading, and the developer FAQ §17 agrees. The adviser should confirm. |
| Validation document (upper bound only) and observed 2004 on late records | The check is one-sided, or both | Known since 12 October: see `verifactu-findings.md`. |

## How these overlap

- **Q52 is a case of Q60.** Both ask what to do about records dated by a wrong clock.
- **Q61's third question is Q60 again.**
- **Q51's list of who may confirm the time is Q61's first question.**
- **Q52's evidence question belongs in Q48.**

The only distinct matters are: is a step back acceptable (Q51), what is the remedy for a wrong date
(Q52 and Q60), and is the clock-setting function safe (Q61).

## Free routes instead of a paid adviser

| Point | Route |
| --- | --- |
| 51.2, 60.8 | AEAT's preproduction service, one library workflow run, with the owner's approval (precedent: A985). |
| 52.4, 60.7, 61.4 | AEAT's general tax information line, which V0305-24 gives as 901-33-55-33. It gives information only and binds nobody. The number comes from a 2024 ruling and was not checked further. |
| 60.3 delivery | Departamento de Gestión Tributaria, art. 15.4 authorisation; or a DGT query, since it is invoicing law rather than a mechanism. Slow (the repo's notes say 6 to 12 months). |
| 61.2 | Not the DGT: V5067-26 shows it will decline. |

`who-to-ask.md` remains right that AEAT offers developers no interactive channel. It lists
`verifactu@correo.aeat.es` as not to be used; a web search today repeated that address on a
third-party page, and it was not used.

**Facts only the owner or gestoría know (VENUE, not paid questions):**

- Whether the venue files VAT quarterly or monthly (RIVA art. 71.3).
- Who prepares the return, and from which figures.
- Whether any tickets in an incident went to identified businesses.

## Consequences for the product (for the owner, not decided here)

1. **Decide whether the stop stays.** The law does not require it. The owner's earlier rule D8 was
   that a clock out of tolerance warns and never refuses a sale, reversed for this one case on
   2026-10-19. Whatever is chosen, tell the adviser it is a choice.
2. **The backlog entry "Correct the sales dated wrongly once the tax adviser answers Q60" can be
   designed now.** Note that `recordCorrection` supports only F2 to R5 and its comment says rectifying
   an F1 is an R1 (`packages/fiscal-verifactu/src/errors.ts`). AEAT's FAQ gives R4 for a non-monetary
   error, so a date correction on a full invoice is not covered today.
3. **The VAT return report sorts by issue date** (`computeVatReturn`, `packages/reporting/src/vat-return.ts`:
   «The output side buckets by the filed *fecha de expedición*» in its comment). A misdated sale near a
   quarter's edge lands in the wrong period there.
4. **A rejected future-dated record can hold later records.** See 60.8.
5. **The alert text** "They stay as recorded; ask your tax adviser" should wait for the adviser's
   answer, then say what happens next when the date itself is wrong.
6. **A wrong clock across a VAT rate change** would pick the wrong rate, which is a different and
   larger correction (art. 15.2). Not studied here.

**Repository documents to correct later:**

- `verifactu-findings.md` §4 lists the one-minute accuracy under "hard requirements" without article 3.
  The A798 design already has the right reading.
- `verifactu-faq-notes.md` §17 presents art. 7.i as a check every record needs, without article 3.
- `who-to-ask.md` says a developer's standing to ask the DGT is unresolved. V1665-22, V0305-24 and
  V5067-26 were each answered to a software producer, «con efectos vinculantes». That goes most of
  the way, though no ruling discusses standing itself.
- `asesor-questions.md` and `backlog/box.md` call #2331 parked.

## What was retrieved and what was not

**Retrieved 2026-11-06 with `curl`:**

| Source | Version |
| --- | --- |
| [Orden HAC/1177/2024](https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138) | consolidated, last update published 28/10/2024 |
| [RD 1007/2023](https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840) | consolidated, 03/12/2025 |
| [RD 1619/2012](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696) | consolidated, 31/03/2026 |
| [Ley 37/1992](https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740) | consolidated, 07/10/2026 |
| [RD 1624/1992](https://www.boe.es/buscar/act.php?id=BOE-A-1992-28925) | consolidated, 28/02/2026 |
| [Ley 58/2003](https://www.boe.es/buscar/act.php?id=BOE-A-2003-23186) | consolidated, 21/12/2024 |
| [AEAT taxpayer FAQ](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes.html), the 18 pages the library's source watch names | updated 21 October 2026 |
| [Developer FAQ](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf) | v1.3; bytes identical to `docs/compliance/sources/` |
| Validation document, service description, hash and QR documents, error list | v1.2.2 for validation; bytes identical to the library's 27 October archive |
| SII FAQ | 30 December 2025 |
| PETETE rulings read for the parts cited | V0305-24, V0850-25, V0902-22, V1102-24, V1665-22, V1924-23, V2611-24, V5067-26 |
| PETETE rulings fetched, not read | V0706-19 (known here through the passage the others quote), V0169-26 |

**PETETE method.** The search and document endpoints, called with the page's own parameters. Control:
a known ruling, V2891-18, was found before any "no results" was trusted. PETETE states it is updated
to 30/09/2026, so later rulings are not visible. Searches on `reloj factura` and on the wording of
a wrong issue date found the rulings above. No ruling was found on a Veri\*Factu record's time.

**Not retrieved or not established:**

- What AEAT does with a step-back record. Not tested.
- AEAT's INFORMA database: the address tried returned 404.
- The official gazette text. These are the BOE's consolidated texts, which the BOE says have no
  legal value.
- The exact wording that defines `Incidencia` in the Orden's annex: the annex text extracted from
  the BOE page did not show it, so 51.3 rests on art. 16.4, the FAQ and the schema.
- The exact change in AEAT's FAQ pages since 27 October: the live pages carry the same "21 October"
  date, but this research did not compare their text with the archive.
- Nothing in this report was tested on a real box, and no code was run.

## Draft: one question in place of four

For `2026-11-05-consultas-para-asesores.md`, if the owner agrees. Replaces [Q51], [Q52], [Q60] and
[Q61]. It assumes the owner has decided about the stop.

> ### Reloj equivocado: confirmación de nuestra lectura [Q51, Q52, Q60, Q61]
>
> Waitron funcionará solo como VERI\*FACTU. Entendemos que, por el artículo 3 de la Orden HAC/1177/2024, no le aplican los artículos 7.f), 7.h), 7.i) y 7.j), y que parar la facturación ante una duda sobre la hora es una decisión nuestra, no una obligación. Confirme o corrija cada punto:
>
> 1. Un registro puede llevar una hora de generación anterior a la del registro que le precede cuando la nueva hora es la exacta y la anterior era errónea. La cadena sigue el orden real de generación y no hay que indicarlo en el registro.
> 2. Si el reloj solo erró la hora y la fecha de expedición es correcta, basta conservar la constancia del incidente, sin rectificativa ni subsanación.
> 3. Si la fecha de expedición es errónea, procede factura rectificativa según las consultas V1665-22 y V0902-22: R4 en completas y R5 en simplificadas, con la fecha de operación real y sin rectificar cuotas. ¿Puede una sola rectificativa cubrir un incidente? ¿Debe entregarse a clientes no identificados, o basta con conservarla y remitir su registro? ¿Cabe anular y expedir de nuevo un tique que el cliente no llegó a recibir?
> 4. El periodo de IVA lo fija el devengo, no la fecha de la factura. Si una autoliquidación ya presentada quedó mal, se corrige con complementaria y rectificación de la posterior.
> 5. Si la AEAT rechazó el registro por fecha de expedición futura (error 1112), proponemos remitirlo sin cambios cuando llegue esa fecha y después rectificar. ¿Es correcto?
> 6. Cuando no se conoce la hora real de una venta, ¿qué pruebas bastan para fijar su fecha (hora del proveedor de cobro, tiempo transcurrido medido por el equipo)?
> 7. No existe obligación ni vía para comunicar el incidente a la AEAT: bastan la rectificativa y la constancia, conservada con las facturas (plazo: Q48).
> 8. El artículo 7.e) permite tomar la hora de otros sistemas con reloj. Durante una parada, el servidor corrige su reloj desde la hora de la AEAT, desde una caja cuya hora confirma un empleado con sesión iniciada o desde el dispositivo de un administrador, dejando constancia de quién lo hizo y avisando al titular. Un empleado podría enviar una hora falsa mediante una petición manipulada. ¿Compromete esto el artículo 29.2.j) de la LGT, el artículo 8.2.b) del Reglamento o nuestra declaración responsable? ¿Qué limitación recomendaría?

Points 3 (delivery), 6 and 8 need real judgement. The others should be a yes or a correction.
