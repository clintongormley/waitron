# Asesor research, 2026-10-09: printing, installation numbers, backups, practice environments, conflicts and e-invoicing

**Provenance.** Researched 2026-10-09 by a research agent; every Spanish quote was checked word for word, by script, against the raw text downloaded from the URL given (BOE and AEAT pages fetched with curl, PDFs through pdftotext, DGT rulings read on PETETE, where any ruling opens at `https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=<number>`). The downloads were kept in the session's scratch directory and are not committed; re-fetch from the URL to re-check a quote. Section numbers (1.1, 1.2 …) are those of the advisor questionnaire of 6 October 2026; the mapping to Q-numbers is in [asesor-questions.md](../asesor-questions.md#the-shortened-list-2026-10-09).

## Summary

**Two things changed since our earlier work:**
- **New binding DGT ruling on test environments:** V1042-26 (13 May 2026). A binding ruling is one from the DGT (the tax ministry's rulings office) that the tax administration must follow for those facts.
- **Veri\*Factu delay announced:** a law firm (CMS, 6–7 Oct 2026) reports a further postponement of Veri\*Factu to October 2028. It is not in the official gazette (BOE); the consolidated RD 1007/2023 still says 1 Jan / 1 Jul 2027.
- AEAT's developer FAQ is still version 1.3 (4 Dec 2025). The taxpayer FAQ is stamped 21 July 2026.

**The most useful findings:**
- **1.6, tickets printed only on request or never.** Three binding DGT rulings (V0150-08, V1713-21, V1884-22) say the duty to deliver an invoice cannot be waived, "even if the recipient renounces it". This is a strong lead that "never print" does not comply and "on request" is doubtful. No source covers a restaurant ticket shown on a screen instead of printed.
- **1.5, card slip.** AEAT's FAQ says the Veri\*Factu rules (RRSIF, RD 1007/2023) govern only invoices. DGT V0298-26 says a card terminal's payment receipt is not an invoice. So a separate slip looks fine. No source sets wording for it.
- **4.4, copies held abroad.** Article 22.2 of the invoicing regulation (RD 1619/2012) requires prior notice to AEAT for invoices kept anywhere outside Spain. It draws no EU / non-EU line; that line applies only when a third party keeps the records (art. 19.4).
  - Veri\*Factu mode removes the duty to keep the *invoice records* sent to AEAT. It does not remove the duty to keep *copies of the invoices*, which is the duty art. 22 attaches to.
  - AEAT's own procedure page says "prior authorisation" where the regulation says "notice". Worth flagging.
- **4.5, practice environment.** V1042-26 forbids made-up companies inside a live invoicing system but allows "a test environment before production". Its example is the developer's own environment, so whether it covers a practice environment run by the venue is still open.
- **4.6, lookups at AEAT.** AEAT's standard representation forms (Resolución of 18 Dec 2024) are limited to *sending* records. On their own wording they don't cover lookups.
- **Q44(b), consent.** The consumer law (TRLGDCU art. 63.3) requires the request for consent to say how the invoice will arrive, and that and how consent can be revoked. The owner's interim answer, "staff ask and note it", doesn't show that yet.
- **Q45.** Orden HAC/1028/2026 exists: BOE of 5 Oct 2026, in force 6 Oct 2026. Counting by the Civil Code's date-to-date rule gives **6 Oct 2027** for businesses above €8m and **6 Oct 2028** for everyone else; that counting is our reading, and a law firm (Garrigues) gives the same dates. Simplified invoices are excluded. Full invoices to Spanish businesses are in, and on our reading the restaurant's own turnover decides its date.
- **Section 6.** AEAT documents only the mechanics: the duplicate error 3000, correction and refusal flags, cancellation without an earlier record, and recovering lost records from AEAT. No source addresses restoring an old backup or two real invoices under one number.
- **Correction to the question text.** The "de forma dinámica" warning cited in 6.1 is in developer FAQ §3 (p.8), not §4. It is about switching between regulatory products, not about installation numbers.

**Verdict counts:** 30 entries; none fully ANSWERED as a whole question (reinstall and wipe in 4.2 are answered inside a narrowed entry); 25 NARROWED; 5 OPEN (1.5 bullet 2, 4.1 bullet 2, 6.4, 6.6, Q44(e)).

---

# Full report

## How the evidence was checked

- **Method:** quotes are verbatim, checked against raw downloads (BOE and AEAT pages through `curl`, PDFs through `pdftotext`, DGT rulings read on PETETE itself). A script matched each quote after normalising whitespace.
- **PETETE searches** (PETETE is the DGT's ruling database) were checked against a ruling we already knew, V2891-18, before any "no results" answer was trusted.
- **Verdict labels:**
  - ANSWERED: a primary source says it directly.
  - NARROWED: sources settle part, or give a strong lead.
  - OPEN: nothing found.
- **"Our reading"** marks inference. **"By analogy"** marks a source about a different situation.
- **DGT rulings** are either binding (*vinculante*, numbers starting with V) or general (interpretive only).

## Sources

| Short name | Source | Date / version |
| --- | --- | --- |
| ROF | RD 1619/2012 (invoicing regulation), consolidated, boe.es `BOE-A-2012-14696` | last update published 31/03/2026, in force 20/04/2026 |
| RRSIF | RD 1007/2023 (Veri\*Factu software regulation), `BOE-A-2023-24840` | last update 03/12/2025 |
| OM | Orden HAC/1177/2024 (technical order), `BOE-A-2024-22138` | last update 28/10/2024 |
| LGT | Ley 58/2003 (general tax law), `BOE-A-2003-23186` | last update 21/12/2024 |
| LIVA | Ley 37/1992 (VAT law), `BOE-A-1992-28740` | last update 07/10/2026 |
| TRLGDCU | RDLeg 1/2007 (consumer law), `BOE-A-2007-20555` | last update 28/02/2026 |
| RD 238/2026 | B2B e-invoicing regulation, `BOE-A-2026-7295` | BOE no. 79, 31/03/2026 |
| OM 1028/2026 | Orden HAC/1028/2026, `BOE-A-2026-20587` | BOE no. 247, 05/10/2026 |
| Ley 18/2022 | `BOE-A-2022-15818` (Crea y Crece law) | fetched 2026-10-09 |
| CC | Código Civil (civil code) art. 5, `BOE-A-1889-4763` | fetched 2026-10-09 |
| Res. 18/12/2024 | AEAT model forms for representation in sending records, `BOE-A-2024-27600` | BOE no. 315, 31/12/2024 |
| Dev FAQ | AEAT developer FAQ v1.3, `agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf` | 4 Dec 2025; identical to the pinned copy, still the current version |
| Sede FAQ | AEAT taxpayer FAQ, `sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/*` | "Actualizadas a 21 de julio de 2026" |
| Validaciones | AEAT validations document v1.2.2, pp. 27–28 | 08/04/2026 |
| SWeb | AEAT web-service description v1.0.3, §§4.1, 6.4 | 28/07/2025 |
| errores | AEAT error-code list, `prewww2.aeat.es/.../tikeV1.0/cont/ws/errores.properties` | undated |
| Preportal | AEAT test portal, `preportal.aeat.es` | undated |
| Manual IVA 2026 | AEAT VAT manual, ch. 10, keeping invoices | page updated 30/09/2026 |
| GZ05 | AEAT procedure GZ05, `sede.agenciatributaria.gob.es/Sede/procedimientos/GZ05.shtml` | page updated 03/08/2026 |

**DGT rulings, all read in full on PETETE:**

| Ruling | Date | Type | Office | Note |
| --- | --- | --- | --- | --- |
| V1042-26 | 13/05/2026 | binding | SG de Tributos | |
| V0298-26 | 12/02/2026 | binding | SG de Tributos | |
| V1884-22 | 09/08/2022 | binding | SG Impuestos sobre el Consumo | |
| V1713-21 | 02/06/2021 | binding | same | |
| V0150-08 | 28/01/2008 | binding | same | under the repealed RD 1496/2003 |
| V3220-19 | 22/11/2019 | binding | same | |
| V2891-18 | 08/11/2018 | binding | same | |
| V1660-07 | 27/07/2007 | binding | same | under the repealed RD 1496/2003 |
| V0686-26 | 26/03/2026 | binding | same | |
| V5126-26 | 07/07/2026 | binding | same | |
| V5177-26 | 15/07/2026 | binding | same | |

## 1.4 A reprint of a ticket the customer never received

### 1.4 bullet 1: is the next print the original, or a «duplicado»?

**Verdict: NARROWED.** No source covers a print that failed.

- **ROF art. 14:**
  - «1. Los empresarios y profesionales o sujetos pasivos sólo podrán expedir un original de cada factura.»
  - 14.2: «b) En los supuestos de pérdida del original por cualquier causa.»
  - 14.4: «4. En cada uno de los ejemplares duplicados deberá hacerse constar la expresión «duplicado».»
  - In English: one original per invoice. A duplicate is allowed only for several recipients or for loss of the original, and must say «duplicado».
- **When an invoice counts as issued (Sede FAQ, *conceptos*):** «Cuando una factura sea definitivamente emitida (es decir, en general, cuando se haya incorporado a ella el QR y generado el correspondiente registro de facturación de alta, firmado o remitido a la Sede electrónica de la Agencia Tributaria), ya no podrá ser considerada un borrador».
  - In English: the invoice is issued once its QR and invoice record exist. Printing is not what issues it.
- **The lead (Dev FAQ §17, case 2.d, p.37):** «Si NO se hubiera entregado, este hecho favorecería la consideración de que se trata de una factura defectuosa e incorrecta que no debería existir ni llegar al cliente (una expedición "fallida") y, por lo tanto, que fuera susceptible de anularse y, después, si procede, expedir una nueva factura "original" (no rectificativa) correcta que se entregaría al cliente.»
  - In English: AEAT treats "not yet delivered" as relevant, but it says so about a wrong invoice being cancelled, not a correct one whose paper jammed.
- **Our reading, by analogy:** a first successful print after a failed one is still delivering the single original. Whether a failed print is a "loss of the original" (14.2.b) is unaddressed.
- **What the text does settle:** resending an original that was already delivered creates a second unmarked original, which art. 14.1 and 14.4 rule out.
- **Ask the asesor:** "If the first print failed and the customer never had the ticket, is printing it later the original (14.1) or a duplicado (14.2.b)?"

## 1.5 A separate card payment slip

### 1.5 bullet 1: is a separate slip with no fiscal value acceptable?

**Verdict: NARROWED, lead: yes.**

- **Sede FAQ (*conceptos*):** «los únicos documentos afectados por este reglamento son las FACTURAS, tanto las «completas u ordinarias» como las simplificadas, no afectando a ningún otro tipo de documentos justificativos de entrega de bienes o prestación de servicios.»
  - In English: the Veri\*Factu rules govern invoices only.
- **DGT V0298-26 (binding):** the facts say «El datáfono expide un comprobante del pago, no una factura completa o simplificada.» The answer:
  - «Por tanto, el datáfono, entendido como dispositivo destinado exclusivamente al cobro mediante tarjeta, no será considerado como un Sistema Informático de Facturación siempre y cuando no cumpla los requisitos establecidos en el artículo 1.2 del RSIF y no realice funciones de creación, registro, procesamiento, modificación o conservación de facturas ni genere registros.»
  - It adds: «Por otro lado, en el caso de que el datáfono reúna los requisitos establecidos en el artículo 1.2 del RSIF o bien el datáfono forme parte de un sistema que, sí cumple con los mencionados requisitos, en este caso el datáfono formará parte del ámbito objetivo del RSIF.»
  - In English: a card terminal's receipt is not an invoice, but a terminal that is part of an invoicing system is in scope. Our slip is printed by the invoicing system, so the slip is not an invoice while the system printing it is in scope. That is our reading.
- **Sede FAQ, by analogy (it is about receipts for purchases from private individuals):** «Ello sin perjuicio del cumplimiento de las exigencias genéricas a los sistemas informáticos del art. 29.2.j) de la LGT, por lo que se ha de recomendar que estos justificantes se custodien inalterados».
  - In English: AEAT recommends keeping such non-invoice documents unaltered.
- **Ask the asesor:** "Must slips printed by the invoicing system be kept unaltered and linked to the invoice?"

### 1.5 bullet 2: is any format or wording required?

**Verdict: OPEN.** Nothing found.

- Nearest rule, for pro formas (Sede FAQ): «Por ello tanto los borradores de factura como las facturas proforma no llevan ningún código «QR» tributario.»
- By analogy: leave off the QR and don't call the slip a «factura».

## 1.6 Venues that print the ticket only on request, or never

### 1.6 bullets 1 and 2

**Verdict: NARROWED (both).** Strong lead that "never" does not comply and "on request" is doubtful.

- **The duty to issue and deliver:**
  - ROF art. 1: «Los empresarios o profesionales están obligados a expedir y entregar, en su caso, factura u otros justificantes por las operaciones que realicen en el desarrollo de su actividad empresarial o profesional, así como a conservar copia o matriz de aquellos.»
  - LIVA art. 164.Uno: «3.º) Expedir y entregar factura de todas sus operaciones, ajustada a lo que se determine reglamentariamente.»
  - LGT art. 29.2: «e) La obligación de expedir y entregar facturas o documentos sustitutivos y conservar las facturas, documentos y justificantes que tengan relación con sus obligaciones tributarias.»
  - ROF art. 17: «Los originales de las facturas expedidas conforme a lo dispuesto en los capítulos I y II del título I deberán ser remitidos por los obligados a su expedición o en su nombre a los destinatarios de las operaciones que en ellos se documentan.»
- **The customer cannot waive delivery.** V1884-22: «…obligación que de acuerdo con lo establecido por el artículo 17, apartado 4 de la Ley General Tributaria no puede ser alterada por las partes intervinientes en las operaciones, incluso aunque el destinatario de las mismas renunciara a su recepción.»
  - V1713-21 and V0150-08 say the same.
  - **Caveat:** V0150-08 adds «Lo anterior debe entenderse sin perjuicio de los supuestos en que el propio Reglamento sobre obligaciones de facturación dispone la posibilidad de cumplir la obligación de facturación por otros medios, en particular mediante la expedición de tiques, artículo 4, o de expedir factura, artículo 3.» That refers to the old regime, where tickets were a substitute document. None of the three rulings concerns restaurant tickets.
- **AEAT assumes delivery:**
  - Sede FAQ on pro formas: «…está permitida siempre y cuando se sustituyan finalmente por la factura o factura simplificada oficial expedida y esta se entregue al cliente.»
  - Sede FAQ on remission: «…puesto que los clientes ya se habrán llevado las facturas impresas».
- **Paper versus electronic:**
  - Sede FAQ: «NO es obligatorio imprimir en papel la factura, siempre que se utilicen sistemas de facturación electrónica (ya sea estructurada o no estructurada).»
  - Electronic delivery needs consent. ROF art. 9.2: «2. La expedición, transmisión y recepción de la factura electrónica estará condicionada a que su destinatario haya dado su consentimiento, excepto en los supuestos de factura electrónica obligatoria establecidos en el artículo 8 bis.»
  - TRLGDCU art. 63.3 gives consumers a right to paper, and electronic delivery needs their express prior consent.
- **Possible penalty (our reading):**
  - LGT art. 201.1: «1. Constituye infracción tributaria el incumplimiento de las obligaciones de facturación, entre otras, la de expedición, remisión, rectificación y conservación de facturas, justificantes o documentos sustitutivos.»
  - 201.2.a: «La sanción consistirá en multa pecuniaria proporcional del uno por ciento del importe del conjunto de las operaciones que hayan originado la infracción.»
- **Silent:** no source on showing the ticket on screen or by QR. Searches run on PETETE: `ticket electrónico`, `tique electrónico`, `simplificada email`, `reimpresión`, and others.
- **Ask the asesor:** "Given V1884-22, do 'on request' and 'never' breach the duty to deliver? Would a screen or QR count as delivery? Is the sanction LGT art. 201.2.a?"

## 4.1 Hourly retries during an outage

### 4.1 bullet 1: what is the consequence of a missed retry?

**Verdict: NARROWED.** No source attaches any penalty to it.

- **OM art. 16.4:** «El sistema informático deberá reintentar periódicamente, al menos una vez cada hora, el envío de los registros de facturación pendientes de remitir.»
- **LGT 201 bis:**
  - The user's offence, 201 bis.2: «…la tenencia de los sistemas o programas informáticos o electrónicos que no se ajusten a lo establecido en el artículo 29.2.j) de esta Ley, cuando los mismos no estén debidamente certificados teniendo que estarlo por disposición reglamentaria o cuando se hayan alterado o modificado los dispositivos certificados.» Fine: €50,000 per year.
  - The producer's offence, 201 bis.1.e: «no cumplan con las especificaciones técnicas que garanticen la integridad, conservación, accesibilidad, legibilidad, trazabilidad e inalterabilidad de los registros».
- **Fault is weighed (Sede FAQ, *integridad*):** «…debe tener en cuenta a la hora de sancionar … si ha concurrido en sus comportamientos culpabilidad, incluso a título de mera negligencia, o se ha producido la destrucción o hackeo de los códigos del programa.»
  - Sede FAQ on possessing old software: «En todo caso, previa valoración del comportamiento del obligado y su responsabilidad.»
- **Outages tolerated (Sede FAQ):** «se ampliarían los plazos de remisión hasta la restauración de la caída o el restablecimiento de servicio» and «no hay establecido un plazo máximo fijo para el envío».
- **Our reading:**
  - A certified, unmodified system that misses a retry doesn't fit 201 bis.2 literally.
  - A user who disables the retry could be "alterado o modificado".
  - A product that doesn't retry exposes the producer under 201 bis.1.e.

### 4.1 bullet 2: what justification is accepted, and when will AEAT ask?

**Verdict: OPEN.**

- OM art. 16.4 only says incidents «deberán ser debidamente justificadas por el remitente si así se lo requiere la Agencia Estatal de Administración Tributaria.»
- Lead for an ignored request: LGT art. 203.1 «b) No atender algún requerimiento debidamente notificado.» Base fine €150.

## 4.2 When a new installation number is needed

### 4.2 bullet 1: which events need a new number?

**Verdict: NARROWED.** Reinstall and wipe are ANSWERED; the rest is not addressed directly.

- **Reinstall or wipe: new number (Dev FAQ §4, p.10):** «incluso si se formatea el ordenador donde estaba instalado un SIF y se reinstala el mismo software de nuevo en ese mismo ordenador, el nuevo SIF así constituido debe llevar otro nº de instalación diferente al anterior que tenía».
- **Version update: same number (p.9):** «un cambio en dicha versión (cuando se actualiza, por ejemplo) no significa que el SIF pase a ser otro SIF con Id. distinto».
- **Several shops (p.10):** «cada una de esas facturaciones distintas (sean de distintos OEF o del mismo OEF pero de distintos centros de facturación independientes, como tiendas) debe tener un nº de instalación propio y distinto al resto (pasado, presente o futuro)».
  - Our reading: a server moved to serve another independent venue needs its own number.
- **Hardware replaced, data kept:** no source.
- **Correction:** the «dinámica» warning is in §3, p.8: «NO debe resultar posible una utilización dinámica del SIF. Entendemos por dinámica que se pueda cambiar en cada sesión, en cada arranque diario o en cada factura emitida». It concerns switching between products built for different regulations, not installation numbers.

### 4.2 bullet 2: must AEAT be told when a chain stops?

**Verdict: NARROWED.** No source requires it.

- Sede FAQ: «¿Es necesario comunicar en el modelo 036 que se van a remitir los registros de facturación mediante un SIF modalidad VERI\*FACTU?» Answer: «No.»
- No source creates a registration of the system with AEAT.
- By analogy (Sede FAQ, *objeto*): «Tener un SIF antiguo no adaptado al RRSIF estaría permitido, si y solo si se puede acreditar que con él YA NO se pueden expedir facturas.»
  - In English: a retired system should be provably unable to issue invoices.

## 4.4 Where backup copies of the records are kept

### 4.4 bullet 1: notice under art. 22.2, EU vs non-EU, and VERI\*FACTU mode

**Verdict: NARROWED.**

- **ROF art. 22.2:**
  - «2. Cuando la conservación se efectúe fuera de España, tal obligación únicamente se considerará válidamente cumplida si se realiza mediante el uso de medios electrónicos que garanticen el acceso en línea así como la carga remota y utilización por parte de la Administración tributaria de la documentación o información así conservadas.»
  - «En caso de que los empresarios o profesionales o sujetos pasivos deseen cumplir dicha obligación fuera del citado territorio deberán comunicar con carácter previo esta circunstancia a la Agencia Estatal de Administración Tributaria.»
  - **No EU / non-EU distinction.** The Manual IVA 2026 agrees.
- **EU / non-EU applies only to a third-party keeper (art. 19.4):** «…únicamente cabrá el cumplimiento de esta obligación a través de un tercero previa comunicación a la Agencia Estatal de Administración Tributaria.»
  - **Discrepancy:** AEAT procedure GZ05 says «…sólo podrá realizarse previa autorización del Departamento de Gestión.» The regulation says notice; the procedure page says authorisation (6-month resolution) and still cites the repealed RD 1496/2003.
- **VERI\*FACTU mode does not remove the duty (our reading, from three statements):**
  - Dev FAQ §13: «las obligaciones de conservación de los registros NO aparecen reguladas en la normativa…». Then: «Por lo que se refiere a las Facturas Completas, estas deben conservarse en la» [page break] «medida en que el Registro no contiene la totalidad del detalle de las facturas (por ejemplo las líneas de facturación).»
  - Sede FAQ: «No se debe confundir la conservación de las facturas exigida por el ROF con la conservación de los RF … Ambos (factura y RF) son productos diferentes y están regulados por distinta normativa.»
  - ROF art. 19.1.b: «b) Las copias o matrices de las facturas expedidas conforme al artículo 2.1 y 2.»
  - In English: Veri\*Factu removes the duty to keep invoice records, not the duty to keep invoice copies, and art. 22 attaches to the copies.
- **History:** V1660-07 (2007) construed the repealed regulation, under which a non-EU country needed authorisation.
- **Ask the asesor:**
  - "Is a backup abroad 'conservación fuera de España' when the master copy stays in Spain?"
  - "For a third party outside the EU, is it notice (art. 19.4) or authorisation (GZ05)?"

### 4.4 bullet 2: is Waitron a third-party keeper?

**Verdict: NARROWED.**

- Art. 19.3: «…se podrán cumplir materialmente por un tercero, que actuará en todo caso en nombre y por cuenta del empresario o profesional o sujeto pasivo».
- Art. 21.2: copies kept electronically «deberán ser gestionados y conservados por medios que garanticen un acceso en línea a los datos así como su carga remota y utilización por parte de la Administración tributaria».
- Art. 23: «El cumplimiento de esta obligación será independiente del lugar en el que se conserven los documentos.»
- Our reading: if Waitron's copy is how the venue meets the duty, Waitron is a third party and must give AEAT online access. Hosting in Spain avoids arts. 22.2 and 19.4.

## 4.5 A separate environment for setting up and practising

**Verdict: NARROWED.**

- **V1042-26 (binding, 2026):**
  - «…la eventual introducción de entidades o sociedades ficticias o no reales en un software de facturación operativo en un entorno de producción sería contraria al mencionado artículo…»
  - «Lo dispuesto anteriormente, no obsta para que la introducción de entidades o sociedades ficticias o no reales se pueda realizar en situaciones previas a dicho entorno de producción, por ejemplo, en un entorno de pruebas durante los procesos de elaboración de los programas.»
  - In English: no fake companies inside a live system; a separate test environment before production is fine. Its example is program development.
- **Dev FAQ §11:** «no está aceptado en la normativa que un SIF operativo que factura "en real" … pueda producir "facturas ficticias" o facturas que no son tales.»
- **AEAT's test service has no tax effect (Preportal):** «Las declaraciones presentadas a través de este Portal se guardan en una Base de Datos del entorno de pruebas de la AEAT, sin que en ningún caso tengan trascendencia tributaria.»
- **Silent:** marking of practice documents, how long to keep them, how to describe the environment in the producer's declaration (*declaración responsable*).
- **Ask the asesor:** "Does V1042-26 cover a practice environment run by the venue itself?"

## 4.6 Authority to look up the venue's records at AEAT

### 4.6 bullet 1: what authority is needed as issuer and as recipient?

**Verdict: NARROWED.**

- **SWeb §6.4:** «Se permite consultar tanto los propios registros de facturación que ha presentado el emisor (consulta realizada por el emisor de la factura) como los registros de facturación presentados por nuestro proveedor (consulta realizada por el destinatario de la factura).»
- **SWeb §4.1:** «La remisión a través del servicio web podrá ser efectuada por el obligado tributario, un apoderado suyo a este trámite o un colaborador social, que deberá disponer de un certificado electrónico cualificado reconocido.» Note this sentence is about *sending*.
- **Formal power of attorney** (*apoderamiento*), Sede FAQ: a third party «debe estar apoderado, y dicho apoderamiento debe estar inscrito en el registro de apoderamientos: ya bien sea con un poder general o un poder específico para enviar los registros de VERI\*FACTU.»
- **Silent:** the catalogue of procedures you can grant a specific power for is behind AEAT login, so I could not see whether a separate VERI\*FACTU lookup procedure exists.

### 4.6 bullet 2: does submit authority cover lookups? Any limits?

**Verdict: NARROWED.**

- **Res. 18/12/2024 forms:** «La presente autorización se circunscribe al mencionado envío electrónico, sin que confiera al remisor la condición de representante del otorgante para intervenir en otros actos…»
  - Our reading: on their wording, these forms don't cover lookups.
- **Evidence to keep (Sede FAQ):** «Dicha autorización debe quedar en poder del colaborador social y no debe aportarse a la AEAT, salvo requerimiento.» Ticking "accept the terms" is not accepted as proof of the authorisation.
- **Limits found are technical only:** «filtrando obligatoriamente por el ejercicio y periodo de la factura» and «Las consultas responderán con un máximo de 10.000 registros.»

## Section 6: does any source speak to it?

None of the 49 binding rulings citing RD 1007/2023 deals with these situations.

| Sub | Verdict | What exists |
| --- | --- | --- |
| 6.1 | NARROWED (mechanics only) | Dev FAQ §4 (new number on reinstall). Nothing on restoring from a backup or what evidence to keep. |
| 6.2 | NARROWED | OM 16.4: send in generation order (quoted in 4.1). Dev FAQ §5: «no pueden quedar RF generados sin remitir a la AEAT». Dev FAQ §17: a correction or cancellation record «se podrían generar y conservar o remitir a la AEAT desde un SIF distinto al que expidió la factura original». Nothing on continuing an old chain. |
| 6.3 | NARROWED (mechanics only) | errores: «3000 = Registro de facturación duplicado.» Dev FAQ §6: «…quiere decir que ya hay un RF en la AEAT para ese ID. de factura.» SWeb: the duplicate reply returns the stored record's status. Nothing on two real sales under one number. |
| 6.4 | OPEN (remedy) | Dev FAQ §6: the record's key includes the date (Emisor + SerieYNúmeroFactura + FechaExped.), so AEAT accepts both. Nothing on what to issue afterwards. |
| 6.5 | NARROWED | Dev FAQ §17 2.a: a refused record «no figuraría jamás en los sistemas de la AEAT (aunque constaría un rechazo)». 2.b: «corregir la factura original y generar un RF de alta de subsanación, sin registro previo en la AEAT (ya que el RF "original" fue rechazado y no existe en la AEAT)», flagged `Subsanacion=S`, `RechazoPrevio=X`. On timing: «no existiendo, en principio, un plazo máximo fijado para ello.» |
| 6.6 | OPEN | nothing found |
| 6.7 | NARROWED (strong) | Dev FAQ §17 2.d names test and training invoices as a cancellation case. Sede FAQ: «El registro de alta enviado previamente y que no procede se dará de baja mediante un registro de facturación de anulación identificando el número de la factura original.» |
| 6.8 | NARROWED | Validaciones p.28: cancellation with no earlier record at AEAT, for a record that «…NO existe en la AEAT porque no se remitió en su momento…». Against withholding: Dev FAQ §5. Nothing permits deliberately keeping records back. |
| 6.9 | NARROWED | Sede FAQ: «…en un sistema VERI\*FACTU esta situación sería menos problemática pues los registros los tendría la AEAT y el obligado podría recuperarlos en su integridad.» Recovering lost data is allowed (correcting must not alter, but recovering what was «perdido» or «corrompido» is the opposite case). Force majeure «excluirían la culpabilidad», with the tax base then estimated indirectly. Failing to keep invoices: LGT 201.2.b, 2% fine. |

## Q44 Sending a full invoice by email or on A4

- **(a) A PDF after paper, marked «duplicado»: NARROWED.**
  - Art. 14.2 lists only two duplicate cases.
  - V3220-19: an emailed replacement of a simplified invoice «no tendrá la consideración de duplicado del original de la factura».
  - Nothing covers a second copy of the same invoice in another medium.
- **(b) Staff ask and note consent: NARROWED, with a gap found.**
  - ROF 9.2 sets no form of consent.
  - TRLGDCU 63.3 for consumers: «La solicitud del consentimiento deberá precisar la forma en la que se procederá a recibir la factura electrónica, así como la posibilidad de que el destinatario que haya dado su consentimiento pueda revocarlo y la forma en la que podrá realizarse dicha revocación.»
  - The owner's answer needs those points added. No DGT ruling on the form of consent was found.
- **(c) Keep the record, not the PDF: NARROWED.**
  - Art. 21.1 requires keeping «…su legibilidad en el formato original en el que se hayan recibido o remitido».
  - Dev FAQ §13: full invoices must be kept (quoted in 4.4).
  - Nothing says whether regenerating the PDF from data satisfies "original format".
- **(d) An unsigned PDF to businesses: NARROWED, strong support.**
  - ROF art. 8.4 presumes authenticity for compliant software.
  - V2891-18: an emailed PDF, «con independencia de que no haya sido firmada digitalmente por el emisor de la misma, tendrá la calificación de factura electrónica».
  - Sede FAQ: for a non-structured PDF, the QR «no tendrá especialidades respecto de la que corresponde a la emisión en papel.»
  - Business consent (9.2) still needed until the mandate applies.
- **(e) A retry is still the original: OPEN.**

## Q45 When B2B structured e-invoicing applies

### (a) Exact dates

**Verdict: NARROWED, strong.**

- **The order exists:** «"BOE" núm. 247, de 5 de octubre de 2026». It «entrará en vigor el día siguiente al de su publicación», so it is in force from **6 Oct 2026**.
- **RD 238/2026, final provision 4** counts «desde la entrada en vigor de la orden ministerial»:
  - «a) Doce meses después» for volume of operations above €8m in the previous calendar year.
  - «b) Veinticuatro meses después, para el resto de los empresarios y profesionales.»
- **Counting:** CC 5.1, «se computarán de fecha a fecha». Our reading gives **6 Oct 2027 / 6 Oct 2028**; Garrigues (secondary) gives the same dates.
- **Caveats:**
  - Ley 18/2022 final provision 8 counts from «aprobarse el desarrollo reglamentario».
  - It makes article 12 conditional on «la obtención de la excepción comunitaria a los artículos 218 y 232 de la Directiva 2006/112/CE», an EU authorisation I did not verify.
  - It says «facturación anual» (annual turnover) where the regulation says «volumen de operaciones» (volume of operations).

### (b) Are a restaurant's full invoices to businesses in scope, and whose turnover counts?

**Verdict: NARROWED, strong.**

- ROF art. 8 bis.1 and RD 238/2026 art. 4.1 exclude simplified invoices except qualified ones (art. 7.2).
- Art. 3.1 brings in invoices to businesses based in Spain.
- Art. 7.1: «La factura electrónica deberá sustanciarse en un mensaje informático de carácter estructurado, ajustado al modelo semántico de datos EN16931». A PDF alone is not enough.
- No sector exclusion order for hospitality was found (art. 4.2 allows one).
- **Our reading:** the duty falls on the issuer (art. 3.1), so the restaurant's own turnover sets its date.

## Found for other sections

- **For 4.3 (series):** V0686-26, V5126-26 and V5177-26 answer a hospitality association, on several invoicing systems in one venue or one system across venues: «ninguno de los dos supuestos planteados exige la utilización de distintas series de facturas, si bien podrán ser utilizados potestativamente por los empresarios o profesionales.» In English: separate series are allowed but not required.
- **Veri\*Factu delay:** reported as announced only (CMS, 6–7 Oct 2026). Not in the BOE as of the consolidated RRSIF dated 03/12/2025.

## Summary table

| Bullet | Verdict |
| --- | --- |
| 1.4 b1 failed first print: original or duplicado | NARROWED |
| 1.5 b1 separate card slip acceptable | NARROWED (lead: yes) |
| 1.5 b2 required wording on the slip | OPEN |
| 1.6 b1 print only on request | NARROWED (doubtful) |
| 1.6 b2 never print | NARROWED (lead: does not comply) |
| 4.1 b1 consequence of a missed retry | NARROWED |
| 4.1 b2 justification, when AEAT asks | OPEN |
| 4.2 b1 events needing a new number | NARROWED (reinstall/wipe ANSWERED) |
| 4.2 b2 communication when a chain stops | NARROWED (none required) |
| 4.4 b1 notice for copies abroad; EU/non-EU; VERI\*FACTU | NARROWED |
| 4.4 b2 Waitron as third-party keeper | NARROWED |
| 4.5 practice environment | NARROWED |
| 4.6 b1 authority for lookups | NARROWED |
| 4.6 b2 does submit authority cover lookups; limits | NARROWED |
| 6.1 new number, evidence | NARROWED (mechanics) |
| 6.2 unsent old-installation records | NARROWED |
| 6.3 same number, same date | NARROWED (mechanics) |
| 6.4 same number, another date | OPEN (remedy) |
| 6.5 correcting a refused record | NARROWED |
| 6.6 same sale recorded twice | OPEN |
| 6.7 AEAT holds a sale that never happened | NARROWED (strong) |
| 6.8 records kept back; SinRegistroPrevio | NARROWED |
| 6.9 invoices missing after a restore | NARROWED |
| Q44(a) PDF after paper: duplicado? | NARROWED |
| Q44(b) form of consent | NARROWED (gap found) |
| Q44(c) keep the record or the PDF | NARROWED |
| Q44(d) unsigned PDF | NARROWED (strong) |
| Q44(e) retry still the original | OPEN |
| Q45(a) exact dates | NARROWED (strong): 6 Oct 2027 / 6 Oct 2028 |
| Q45(b) restaurant F1 in scope; whose turnover | NARROWED (strong): in scope; issuer's own |
