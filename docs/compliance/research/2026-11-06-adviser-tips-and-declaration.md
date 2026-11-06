# Asesor research, 2026-11-06: tips, a service charge, retention and the software declaration

**What this is.** A research pass over five questions in the batch not yet sent to the advisers:
Q13(d), Q49, Q50, Q48 (the fiscal part) and Q53. The aim is to answer from free primary sources
whatever does not need a professional, and to turn the rest into a yes or no. The question wording
used is [2026-11-05-consultas-para-asesores.md](../2026-11-05-consultas-para-asesores.md); the
background is [asesor-questions.md](../asesor-questions.md).

**How it was checked.** Every source below was downloaded on 2026-11-06 unless its line says
otherwise. Every Spanish or Catalan quotation (in «») was checked word for word, by script, against
the downloaded text, after turning HTML into plain text and collapsing whitespace. The exceptions
are marked "(2026-10-18)": those are quotations this pass relies on from
[2026-10-18-a793-tips.md](2026-10-18-a793-tips.md) and could not re-fetch, because EUR-Lex answered
every download with an empty holding page. "Our reading" marks an inference no source states.
Result of the check: 125 quotations, 122 matched. Two of the other three are «Sin propina», a button
label we propose and not a source; the third is the TSJ Madrid phrase, known only through a blog. The
script also refused two invented control sentences, as it should.

**What this builds on, and does not redo.**
[2026-10-18-a793-tips.md](2026-10-18-a793-tips.md) (tips, withholding, Social Security, sharing),
[2026-10-16-a664-retention.md](2026-10-16-a664-retention.md) (the retention clocks, keys F01 to F40),
[2026-10-27-a1157-faq.md](2026-10-27-a1157-faq.md) and the three 2026-10-09 files.

## Terms used below

| Term | Meaning |
| --- | --- |
| DGT, PETETE | Spain's tax rulings office, and its public database of rulings |
| Binding ruling | A DGT answer issued with binding effect; its number starts with V |
| VAT base | The amount VAT is worked out on (base imponible) |
| PGC | The Spanish general accounting plan (RD 1514/2007) |
| ICAC | Spain's accounting standards institute |
| Corporate tax | Impuesto sobre Sociedades |
| AEAT | The Spanish tax agency |
| Declaration | The producer's signed statement that a software version meets the rules (declaración responsable) |
| SIF | An invoicing system under RD 1007/2023 |
| Record | A billing record sent to AEAT (registro de facturación) |
| Producer | Whoever makes the invoicing software |
| TRLGDCU | Spain's national consumer protection code |
| Codi de consum | Catalonia's consumer code (Llei 22/2010) |
| Agència | Agència Catalana del Consum, Catalonia's consumer authority |

## Outcomes at a glance

| Sub-question | Outcome | Answer in one line |
| --- | --- | --- |
| Q13(d)1. Suggested percentages the guest can refuse: still outside the VAT base? | NARROWED | Yes, if no amount is pre-selected and the guest can pick zero or any other figure |
| Q13(d)2. How may a suggestion be shown? | ANSWERED | Opt-in only (TRLGDCU art. 60 bis), and no ticket wording that implies a duty (the Agència) |
| Q13(d)3. A service amount added by default, removable on request | DROP | Nobody proposes it; the guest could reclaim it; if ever charged, treat it as part of the VAT base |
| Q49a. Card tips passed to staff: debt, or income and expense? | NARROWED | Debt: amounts received for third parties are not income (PGC valuation rule 14.ª.1) |
| Q49b. Corporate tax on a share the restaurant keeps | ANSWERED | It goes into the corporate-tax base (V1808-22). The design offers no such share |
| Q49c. VAT on a share the restaurant keeps | ANSWERED | Outside VAT while voluntary (2174-03, V1895-24, V5110-26) |
| Q49d. Which ledger account | VENUE | The venue's accountant picks it |
| Q50a. A compulsory fixed or percentage charge in Catalonia | NARROWED | No, in practice: the general rules and the Agència point against it, though the two specific bans are repealed |
| Q50b. Which rules apply to these premises | ANSWERED | National and Catalan consumer law. No restaurant-specific decree is in force in Catalonia |
| Q50c. How to announce it | ANSWERED | Final price shown first; a different price by area is allowed if each price is shown |
| Q50d. How to separate it from a tip | ANSWERED | A tip is fully voluntary; no ticket wording may suggest otherwise |
| Q50e. Information and acceptance before charging | ANSWERED | Express opt-in before the contract; the restaurant must prove it |
| Q48a. Which documents | NARROWED | List below, adding three the question omits |
| Q48b. When each clock starts | ANSWERED | Table below; six years from the last book entry usually outlasts the tax clocks |
| Q48c. What extends a period | ANSWERED | List below; which ones apply is a venue fact |
| Q48d. Records AEAT accepted, and its answers | ANSWERED | No legal duty to keep the records; AEAT says it holds them. Keeping them is a choice |
| Q48e. Pending or rejected records and open incidents | NARROWED | Keep them until they are settled, then for the common schedule |
| Q48f. Is the proposed archive's content enough? | NARROWED | It meets arts. 19 to 21 as far as the text goes, if it keeps original format and verification data |
| Q48g. Does "acceso en línea" fit a box at the venue? | KEEP | The regulation says online; no source says what satisfies that for a small venue's own server |
| Q48h. Custody after closure or death | ANSWERED | Heirs if an individual, liquidators if a company; the books go to the Registro Mercantil at the end |
| Q48i. Payment provider contracts | VENUE | The owner must fetch them |
| Q48j. Books, deductions, adjustments, interruptions at this venue | VENUE | Facts for the gestoría |
| Q53a. Is item d) sufficient and correct? | NARROWED | Yes, after five edits listed below |
| Q53b. Responsibility for third-party components | ANSWERED | The producer lists them and answers for open-source code it uses |
| Q53c. Does cloud hosting change the declaration? | ANSWERED | No; AEAT lists on-site, remote and cloud as equal; each taxpayer's system stays separate |
| Q53d. e) = S and g) | ANSWERED | e) = S if records can never be left unsent by choice. g) is not omitted: it carries AEAT's sentence |
| Q53e. f) = N | NARROWED | Yes, while each hosted venue is its own installation |
| Q53f. A future non-Veri\*Factu mode | ANSWERED | e) = N, g) names the signature types, and the choice may not change dynamically |
| Q53g. Keep the two characters under a new NIF? | ANSWERED | Yes; the code only has to be unique within one producer |
| Q53h. New installation and chain on a change of producer | NARROWED | Yes; a change of producer reads as a different system |
| Q53i. What each restaurant must do or tell anyone | NARROWED | Nothing to AEAT; a new declaration; keep the old one |
| Q53j. Can the new system correct old records? | ANSWERED | Yes in principle; AEAT says so in its developer FAQ §17 |
| Q53k. Moving between on-site and cloud | NARROWED | Same code, new installation number, no change to the declaration if d) covers both |

Count: 33 sub-questions. 17 answered, 11 narrowed, 1 dropped, 1 kept for a professional, 3 venue
facts.

## Things that change the batch as a whole

**1. The first venue is in Barcelona.** The local copy of the venue's Square data gives locality
Barcelona. So Q50 can name Catalonia, and the rules below are Catalan. The owner
should confirm the fiscal territory is common territory (Catalonia is). The venue's legal name stays
out of this file, as the action plan keeps it out of the repository.

**2. The tips design is parked, and says no more questions until it is rethought.** The design file
[2026-10-18-a793-tips-design.md](../../superpowers/specs/2026-10-18-a793-tips-design.md) records the
owner's answer of 2026-10-18 and adds «no further question is asked until it has happened». The backlog
entry A793 says the same, while
[backlog.md](../../backlog.md) line 2666 and [backlog/fiscal.md](../../backlog/fiscal.md) line 1343
put Q13(d) and Q49 in the next batch. Both can be true only if the owner chooses. With this research
the brainstorm does not need either answer first, so the cheapest course is to hold Q13(d)1 and Q49a
as a single yes-or-no line and pay for neither until A793 is revived.

**3. Q50 and Q13(d)3 ask about something nobody proposes.** The architecture design says «Never add a
*mandatory* service charge», and the Q50 text itself opens with «La propuesta actual no añade un cargo
por servicio». Recommended: take Q50 off the €300 list. If the owner ever wants a charge, the
Agència says on its business page «Us assessorem per garantir l’exercici dels drets i el compliment de
les obligacions», so it can be asked directly. Whether that advice is free was not established.

**4. The Veri\*Factu dates are unchanged in law.** [RD 1007/2023's consolidated text](https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840)
(last update 03/12/2025, read 2026-11-06) still says «antes del 1 de enero de 2027» and «antes del 1
de julio de 2027». To catch a change not yet consolidated, the BOE's daily summaries from
1 October to 6 November 2026 were searched through its open-data service: 32 days returned, 5 returned
"not found" (the Sundays, by our reading; not checked one by one). Control: the search does find Orden
HAC/1028/2026 on 5 October. Nothing touches RD 1007/2023. The postponement to 2028 remains press
reporting only.

---

# Q13(d). Suggested tips and a default service amount

**Does it still make sense?** Partly. Tips already exist in the code, switched off on a real box by
`WAITRON_TILL_TIPS`, and today's till offers no percentages. The first design shows none until this
is answered. A default service amount is proposed by nobody.

## Q13(d)1. Suggested percentages the guest can refuse — NARROWED

**Proposed answer for a yes or no:** a tip stays outside the VAT base when suggested amounts are
offered, provided nothing is pre-selected, the guest can choose nothing or type another amount, and
the sum is not on the invoice.

**What the sources say.** No ruling found covers a suggested tip. All 82 DGT rulings containing a
word beginning "propina" (11 general, 71 binding) were downloaded and searched by word; those with
more than a passing mention were read. As a second check, the 15 rulings containing a form of
"sugerido" were downloaded; in each the word was read in context, and each uses it in an unrelated
sense (a suggested invoicing method, suggested repairers and the like). Weaker than it looks: a
ruling putting the same idea in other words would not show. Searches for "donativo orientativo",
"donativo recomendado" and "tarifa recomendada voluntaria" returned PETETE's "no results" message,
the same one a nonsense control word returns. Those searches need every word present, so they prove
less than the "sugerido" search does.

The test the rulings do state, in V1895-24 (binding, 21/08/2024), V5110-26 (binding, 03/07/2026) and
V2182-23 (binding, 25/07/2023), each quoting V2604-10:

> «no serán contraprestación de ninguna operación sujeta al Impuesto en la medida en que no se haya
> establecido una cuantía fija para las mismas y quede por tanto su importe a la libre determinación
> de cada peregrino»

They are not payment for anything taxable, in so far as no fixed amount is set and each giver decides
the amount freely.

**New: the closest ruling on a pre-set amount, V3298-20** (binding, 06/11/2020), an electricity
retailer whose customers could donate a fixed €50 or €100 for a discount. The DGT separated the two
cases. Free donations from non-customers:

> «parece deducirse que su importe es libre, a voluntad del aportante»

are outside VAT. Customers' donations are not, because of two things together:

> «el pago del donativo se ha preestablecido en una cuantía fija y parece que en virtud de dicho pago
> la consultante adquiere la obligación»

So a pre-set amount mattered because it was fixed and bought something. Our reading: a list of
percentages the guest may ignore is neither fixed nor exchanged for anything, since the meal is owed
whatever the guest tips.

**V1655-14** (binding, 30/06/2014), a tour guide with no set price who takes what the tourist chooses
to pay, is often cited in this area. It says only that the guide may be a business for VAT and
declines the rest, so it decides nothing here.

## Q13(d)2. How a suggestion may be shown — ANSWERED

This is consumer law, not tax, and the question did not ask it. It is what actually limits the
design, and neither the first design nor the 2026-10-18 research names the first source below.

[TRLGDCU art. 60 bis](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555#a60bis) (consolidated
text, last update 04/11/2026):

> «el empresario deberá obtener su consentimiento expreso para todo pago adicional a la remuneración
> acordada para la obligación contractual principal del empresario. Estos suplementos opcionales se
> comunicarán de una manera clara y comprensible y su aceptación por el consumidor y usuario se
> realizará sobre una base de opción de inclusión.»

> «Si el empresario no ha obtenido el consentimiento expreso del consumidor y usuario, pero lo ha
> deducido utilizando opciones por defecto que éste debe rechazar para evitar el pago adicional, el
> consumidor y usuario tendrá derecho al reembolso de dicho pago.»

> «Corresponde al empresario probar el cumplimiento de las obligaciones a que este artículo se
> refiere.»

The business must get express consent for any extra payment, on an opt-in basis. If it relied on a
default the customer had to refuse, the customer can have the money back, and the business must prove
it complied.

The [Agència's page on bars and restaurants](https://consum.gencat.cat/ca/els-meus-drets/bars-i-restaurants/)
(updated 20/02/2026):

> «Les propines són totalment voluntàries. Per tant, els establiments s’han d’abstenir d’incloure en
> el tiquets de caixa missatges que puguin fer creure als consumidors que hi estan obligats. La
> inclusió de propina obligatòria es considera una pràctica abusiva que podeu denunciar»

Tips are entirely voluntary, so businesses must keep off till tickets any message that could make
customers think they must pay one; including a compulsory tip is an abusive practice.

**The rule for the design, our reading:** the till may offer choices, with «Sin propina» as prominent
as the others and none pre-selected. Suggested amounts printed on a pre-bill or ticket carry the
risk the Agència names, so they need the word voluntary, or should stay off paper.

## Q13(d)3. A service amount added by default — DROP

No design proposes it. It would also fail in three separate ways:

- **Consumer law:** art. 60 bis above gives the guest a refund, which is exactly this case.
- **Consumer law again:** art. 66 quáter says no payment can be claimed for a service not asked for,
  and the Agència says restaurants may not charge «serveis no sol·licitats expressament pel client».
- **VAT:** 2174-03 keeps a tip out only where it is paid «con carácter voluntario y unilateral» and
  is not «exigibles por la prestación de tales servicios». An amount the restaurant bills unless told
  otherwise is not unilateral. C-404/99 paragraphs 42 and 43 put a compulsory service charge in the
  base (2026-10-18). No ruling covers one that can be removed; our reading is that it is in the
  base until removed.

If the owner revives this, the answer to put to an adviser is "treat as part of the base and the
invoice".

**Suggested Spanish, replacing the paragraph:**

> Proponemos ofrecer porcentajes de propina sin ninguna opción preseleccionada, con «Sin propina» y
> un importe libre, manteniendo la propina fuera del importe facturado. Entendemos que sigue fuera de
> la base imponible (V2604-10, V5110-26). ¿Es correcto?

---

# Q49. How card tips are booked

**Does it still make sense?** (a) yes, as a yes or no. (b) and (c) ask about something the design
excludes: «The house keeping tips is not offered». They are recorded here so nobody asks again.

## Q49a. Debt, or income and expense — NARROWED

**Proposed answer for a yes or no:** card tips passed to staff are not income. They are booked as a
debt to staff from the day collected, and paying them out through payroll clears that debt. There is
no income and no expense, and the tip does not count towards turnover.

**This closes most of the gap the 2026-10-18 research left open.** That research found no accounting
source. There is one, and it is the accounting plan itself.

[PGC, valuation rule 14.ª, section 1](https://www.boe.es/buscar/act.php?id=BOE-A-2007-19884):

> «No formarán parte de los ingresos los impuestos que gravan las operaciones de entrega de bienes y
> prestación de servicios que la empresa debe repercutir a terceros como el impuesto sobre el valor
> añadido y los impuestos especiales, así como las cantidades recibidas por cuenta de terceros.»

The [plan for small businesses](https://www.boe.es/buscar/act.php?id=BOE-A-2007-19966) has the same
rule. The [ICAC's 2021 revenue resolution](https://www.boe.es/buscar/act.php?id=BOE-A-2021-2155),
art. 12.1, repeats it:

> «excluyendo las cantidades recibidas por cuenta de terceros»

Whether a tip is received "for a third party" is the one remaining point, and the sources all say so:

- **2174-03** (general, 2003): «la entidad recibe las propinas como mero intermediario entre sus
  clientes y sus camareros». It concludes that tips are not taxable income and sharing them out is no
  deductible expense. It applied the old corporate tax law; today's art. 10.3 of
  [Ley 27/2014](https://www.boe.es/buscar/act.php?id=BOE-A-2014-12328) still starts from the
  accounting result, so the reasoning holds (our reading).
- **TSJ Madrid, 31/05/2023**, read only through a blog (2026-10-18): the business «es mera tenedora».
- **V3095-17** (casino) puts tips into corporate tax only «en la medida en que» they are accounting
  income. It does not conflict: it turns on the casinos' own accounting plan and tips pool.

**The caveat for the adviser:** this holds only if staff, not the business, are entitled to the tips.
A contract paying wages out of the tips pool would change it (V3095-17's facts).

**ICAC:** the ICAC site's own search for "propinas" says «No hay resultados», and returns results for
a control phrase. That search may not read the bulletin PDFs. The two ICAC rulings the 2021 resolution
names on operations for third parties (BOICAC 19 and 81) were not read.

**Audiencia Nacional 2001, cited by Garrigues:** still not read. The court database refused every
automated search (see the end of this file).

**Income tax is separate and already settled:** the employer withholds when paying the tip out, with
the rest of the pay (1866-03, RIRPF art. 76.1.3.º; the 2026-10-18 research §3). Treating the tip as a
debt does not change that.

## Q49b. Corporate tax on a share kept by the restaurant — ANSWERED

Yes, it is taxable income. V1808-22 (binding, 29/07/2022):

> «los ingresos derivados de las “propinas” obtenidas por la consultante deberán integrarse en la base
> imponible del Impuesto sobre Sociedades»

## Q49c. VAT on a share kept by the restaurant — ANSWERED

It stays outside VAT while voluntary. V1895-24 and V5110-26 both concern someone who supplies the
service and keeps the tip personally. V1895-24:

> «las propinas que de manera voluntaria y unilateral satisfagan los clientes a la consultante que son
> ingresados directamente en su cuenta corriente no formarán parte de la base imponible del Impuesto
> sobre el Valor Añadido»

**Not a tax point, but it decides the design:** the labour side points against keeping any. TSJ Madrid
(through a blog) calls the staff the money's recipients. Deducting the card fee from tips is a
small version of the same thing, and no source addresses it. That belongs with L6, not here.

## Q49d. Which account — VENUE

The accounting plan defines account 465 for pay «contabilizan en el subgrupo 64», which a pass-through
tip is not, so 465 may not be the right home (our reading). The accountant chooses.

**Suggested Spanish, replacing the paragraph:**

> Las propinas de tarjeta entran en la cuenta del restaurante y se abonan al personal por nómina.
> Según la NRV 14.ª.1 del PGC («cantidades recibidas por cuenta de terceros») y la consulta 2174-03,
> proponemos registrarlas como deuda con el personal, sin ingreso ni gasto. ¿Es correcto y qué cuenta
> usan?

---

# Q50. A fixed service charge

**Does it still make sense?** Only as a "just in case": nothing proposes a charge. Recommended: remove
it from the paid list (see the top of this file). It no longer needs a specialist to read regional
law: the region is known, and the law is below.

## Q50b. Which rules apply to these premises — ANSWERED

**A trap worth recording: both restaurant-specific bans are repealed**, yet they are still quoted
around the web and the words live on in guidance.

| Rule | What it said | Status |
| --- | --- | --- |
| National order of 17/03/1965, arts. 10.6 and 31 | «Ningún restaurante podrá percibir cantidad alguna por los conceptos de «cubierto» o «carta» o cualquier otro similar»; «Todos los precios serán globales, por lo que se entenderán comprendidos en ellos el importe del servicio, el porcentaje destinado al personal» | [Repealed](https://www.boe.es/buscar/doc.php?id=BOE-A-1965-6262): the BOE's entry shows «Fecha de derogación: 05/02/2010», by RD 39/2010 |
| Catalan Decret 317/1994, arts. 15.2, 15.3 and 16.1 | «No se podrán cobrar conceptos tales como reserva, cubiertos, mesa o similares»; «no pueden cobrarse otros servicios o conceptos no solicitados por él» | Repealed whole by [Decret 321/2011](https://portaldogc.gencat.cat/utilsEADOP/AppJava/PdfProviderServlet?versionId=1178959&type=01), DOGC 5864, 21/04/2011. The [Portal Jurídic entry](https://portaljuridic.gencat.cat/eli/es-ct/d/1994/11/04/317) marks it «not in force» |

Decret 317/1994's wording was read in a reproduction of the Aranzadi text
([copy](https://sid-inico.usal.es/idocs/F3/LYN10507/3-10507.pdf)), not the DOGC. Its repeal was read
in the DOGC itself. RD 39/2010 itself was not read; only the BOE's note on the 1965 order.

Catalonia has since stopped regulating restaurants as tourism. The preamble of
[Decret 75/2020](https://portaljuridic.gencat.cat/eli/es-ct/d/2020/08/04/75) speaks of reversing
unnecessary tourism rules for activities that

> «no requereixen una regulació en aquest àmbit. Parlem, a tall d'exemple, dels establiments de
> restauració»

**So what applies today:**

- **National:** TRLGDCU arts. 20.1.c, 60.2.c and 89.5 (quoted in the 2026-10-18 research §2, and
  re-matched today against the 04/11/2026 text), plus art. 60 bis and art. 66 quáter.
- **Catalan:** Codi de consum art. 126-6:

  > «Las personas consumidoras tienen derecho a recibir información suficiente y fácilmente accesible
  > sobre los precios, tarifas, condiciones de venta y conceptos que incrementen el precio, antes de
  > adquirir el bien o contratar el servicio»

  Art. 331-5 a) makes it an offence to «realizar prácticas abusivas dirigidas a las personas
  consumidoras».
- **Catalan:** [Llei 18/2017 de comerç](https://www.boe.es/buscar/act.php?id=BOE-A-2017-11320),
  art. 8.5, the final price of services offered:

  > «debe ser exhibido de forma clara e inequívoca, y debe incluir los impuestos, gastos de transporte,
  > incrementos derivados de los regímenes de financiación y otros recargos que le sean de aplicación»

  Art. 1.3 makes the law only «de aplicación supletoria» where specific rules exist. It names no
  restaurant rule; applying it here is our reading.

## Q50a. A compulsory fixed or percentage charge — NARROWED

**Proposed answer for a yes or no:** no. A compulsory "servicio" added on top of menu prices is
exposed under art. 89.5 and the full-price rules, and the Agència treats it as unlawful in practice.
The way to earn the same money is to put it in the menu prices.

The Agència's page, again:

> «No poden cobrar conceptes com ara coberts o taula, ni tampoc serveis no sol·licitats expressament
> pel client.»

**How firm this is.** After the two repeals, no in-force text found says "servicio" in terms. The
conclusion rests on general rules plus guidance that names no provision for that sentence. No court
ruling or sanction on a restaurant service charge was found, and the court database could not be
searched. The Agència's words echo the repealed decree's, which is why a specialist could still
argue the point; no source says the guidance rests on it.

**This corrects the 2026-10-18 research a little.** Andalucía's note, quoted there and in Q50, names no
regulation. Nothing here shows what it rests on, so it should not be quoted to the adviser as if it
were Catalan, or a rule.

## Q50c. How it would have to be announced — ANSWERED

The same rules apply to any different price. The Agència:

> «caldrà indicar el preu complet per a cada cas, com ara el preu cobrat a la barra, el preu cobrat a
> les taules i el preu cobrat a la terrassa»

The full price for each case must be shown. So a higher table or terrace price is lawful if shown as
a full price, and that is the lawful version of a service charge. The menu must be available at
least in Catalan: see [regional-language-rules.md](../regional-language-rules.md).

## Q50d. How to separate it from a voluntary tip — ANSWERED

A tip is entirely voluntary and no ticket may suggest otherwise (quoted under Q13(d)2).

## Q50e. Information and acceptance before charging — ANSWERED

Art. 60 bis: express consent, on an opt-in basis, before the customer is bound, and the business
carries the proof. Codi de consum art. 126-6 requires the price information before contracting.

**VAT if it were ever charged:** in the base (C-404/99, 2026-10-18).

---

# Q48 (fiscal part). Retention and evidence

**Does it still make sense?** Yes, and it is the largest item here, but most of it is reading rather
than judgement. The design ([A664](../../superpowers/specs/2026-10-16-a664-data-retention-design.md))
is unbuilt and waits for the advisers. The retention register already gathered the clocks (F01 to
F40); this pass adds what it missed and applies them to a company.

## Q48a. Which documents — NARROWED

**Proposed answer for a yes or no:** the list below is complete for a restaurant company in the
common tax regime.

| Document | Rule | Source |
| --- | --- | --- |
| Copies of invoices issued, simplified ones included | «Las copias o matrices de las facturas expedidas conforme al artículo 2.1 y 2» | [RD 1619/2012 art. 19.1.b](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696#a19), read with arts. 2 and 4 |
| Invoices received | «Las facturas recibidas.» | same, art. 19.1.a |
| Books and business papers | «los libros, correspondencia, documentación y justificantes concernientes a su negocio» | [Código de Comercio art. 30.1](https://www.boe.es/buscar/act.php?id=BOE-A-1885-6627#art30) |
| Any evidence for tax | «conservar las facturas, documentos y justificantes que tengan relación con sus obligaciones tributarias» | [LGT art. 29.2.e](https://www.boe.es/buscar/act.php?id=BOE-A-2003-23186) |
| Payments and refunds | Business papers under art. 30.1; no specific list found | our reading |

**Three items the question does not name:**

1. **Each past software declaration.** AEAT's FAQ: «los usuarios de estos Sistemas cuando los
   sustituyan o actualicen las versiones, deben conservar los certificados de los sistemas que se
   sustituyan o actualicen». So the restaurant keeps every version's declaration, not only Waitron.
2. **Proof of payment for sales of €1,000 or more.** [Ley 7/2012 art. 7.Uno.4](https://www.boe.es/buscar/act.php?id=BOE-A-2012-13416):
   «deberán conservar los justificantes del pago, durante el plazo de cinco años desde la fecha del
   mismo». A banquet is the likely case.
3. **Pro formas and drafts that never became invoices.** Developer FAQ §6: «resulta obligado conservar
   los registros de facturas proformas emitidos». Whether a pre-bill counts is already open as S2.

## Q48b. When each clock starts — ANSWERED

| Item | Period | Starts | Source |
| --- | --- | --- | --- |
| Tax evidence | 4 years | The day after the filing deadline of the return concerned | LGT arts. 66 and 67.1 (F03, F04); RD 1619/2012 art. 19.1 takes «el plazo previsto en la Ley 58/2003» |
| Books and business papers | 6 years | «a partir del último asiento realizado en los libros» | Código de Comercio art. 30.1 (F01) |
| Proof of payment of €1,000 or more | 5 years | The date of payment | Ley 7/2012 art. 7.Uno.4 |
| Personal claims | 5 years | When the claim could be brought | Civil Code arts. 1964.2 and 1969 (F38, F39) |

**Worked example, our arithmetic, for a company with a calendar year 2026.** The corporate tax return
is due within «los 25 días naturales siguientes a los 6 meses posteriores a la conclusión del período
impositivo» (Ley 27/2014 art. 124.1), so 25 July 2027, and the four years end around 26 July 2031. The
last entry of the 2026 books is about 31 December 2026, so six years end about 31 December 2032. In the
ordinary case six years from the last entry outlasts the tax clock. The proposal's six years per annual
set therefore looks right as a floor, and the question's care not to presume one period from each sale
is correct: the clock runs from the book's last entry, not the sale.

## Q48c. What extends a period — ANSWERED

| Event | Effect | Source |
| --- | --- | --- |
| Tax loss carried forward, or a deduction pending | AEAT can check them for 10 years; afterwards the company must show the return and the accounts | LGT art. 66 bis.2 and 3; [Ley 27/2014 art. 26.5](https://www.boe.es/buscar/act.php?id=BOE-A-2014-12328): «prescribirá a los 10 años» |
| Input VAT subject to adjustment (equipment, premises) | «durante el período de regularización correspondiente a dichas cuotas y los cuatro años siguientes» | [LIVA art. 165.Uno](https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740) (primary text behind F17). The adjustment runs 4 years after purchase, 9 for land and buildings (arts. 107.Uno and 107.Tres) |
| Audit, appeal or anything else that interrupts | The tax period restarts | LGT art. 68 (F05) |
| Data from a closed year affecting an open one | Still has to be justified | LGT art. 70.3 (F09) |
| A claim, or a debt acknowledged | Interrupts the civil period | Civil Code art. 1973 (F40) |

Example for a kitchen bought in 2026: adjustment to 2030 plus four years is 2034, later than the
six-year floor for that one invoice. For a lease fit-out treated as a building, 2035 plus four is
2039. Which of these exist at this venue is Q48j.

## Q48d. Records AEAT accepted, and its answers — ANSWERED

There is no duty to keep accepted records. AEAT's
[conservation FAQ](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/caracteristicas-requisitos-sif-conservacion-accesibilidad-legibilidad.html):

> «los SIF VERI*FACTU (y los OEF que los utilicen) no están obligados a conservar los RF generados, ya
> que se han remitido a la Agencia Tributaria y, por tanto, obran en poder de esta»

Developer FAQ §13 agrees, and adds a reason to keep them: «por razones de funcionalidad del sistema
(no por obligación reglamentaria), parece lógico que dichos sistemas también conserven esos mismos
registros». The same section adds that the invoices must be kept «en la medida en que el Registro no
contiene la totalidad del detalle de las facturas». So the record never replaces the invoice copy.

**Two answers on that FAQ page look opposed, and describe different paths.** The first says «el SIF debe
ofrecer un procedimiento de descarga, volcado y archivo seguro». The second says VERI\*FACTU systems need
not «guardar los RF que generan ni a ofrecer su exportación». The second is the specific one, and
matches Orden HAC/1177/2024 art. 3, which disapplies its arts. 8 and 9 «en tanto actúen como
«VERI*FACTU»». Keeping an export is therefore voluntary, and nothing forbids it.

## Q48e. Pending or rejected records and open incidents — NARROWED

**Proposed answer for a yes or no:** the reason for the exemption in Q48d, that AEAT holds the record,
fails for these, so keep each one, with its answer, until it is settled, and then for the common
schedule.

Sources: the exemption is worded «ya que se han remitido». Developer FAQ §17 says a rejected record
«no figuraría jamás en los sistemas de la AEAT (aunque constaría un rechazo)». Developer FAQ §5 says
«no pueden quedar RF generados sin remitir a la AEAT». No source sets a period; this is our reading.
This overlaps Q47, Q51, Q52 and Q60, which should be answered together.

## Q48f. Is the archive's content enough? — NARROWED

**Proposed answer for a yes or no:** the proposed archive (complete originals, their links and chain
limits, version data, a reader independent of the sales server) meets the content rules. Against
[RD 1619/2012](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696):

| Requirement | Text |
| --- | --- |
| Original content, in order | «con su contenido original, ordenadamente» (art. 19.2) |
| Authentic, whole, legible, and reachable | «la autenticidad de su origen, la integridad de su contenido y su legibilidad» (art. 20.1) |
| Original format with verification data | «su legibilidad en el formato original en el que se hayan recibido o remitido, así como, en su caso, la de los datos asociados y mecanismos de verificación» (art. 21.1) |
| Full access means | «su visualización, búsqueda selectiva, copia o descarga en línea e impresión» (art. 21.2) |
| A third party may hold it | The business stays responsible (art. 19.3) |

So the reader needs selective search, copying and printing, and the checklist should test those by
name. It must also hold the invoice lines, since the record does not (Q48d).

## Q48g. "Acceso en línea" from a box at the venue — KEEP

> **Later on 6 November 2026:** sources were found after all, and this is now a confirmation (T4). See
> [the online access report](2026-11-06-adviser-online-access.md).

Art. 21.2 asks for means «que garanticen un acceso en línea a los datos así como su carga remota y
utilización por parte de la Administración tributaria ante cualquier solicitud de esta y sin demora
injustificada». Art. 23 repeats it, «independiente del lugar en el que se conserven los documentos».
A small venue's server has no public address. The 2026-10-09 research reached the same text and no
answer. No source says whether handing over the archive on request, or letting an inspector reach it
through a staffed device, satisfies this. Research cannot settle a matter of what AEAT accepts in
practice, so this is worth one paid question:

> Si la copia electrónica se conserva en el servidor local del restaurante, sin dirección pública, con
> descarga a petición, ¿cumple el «acceso en línea» y la «carga remota» de los arts. 21.2 y 23 del
> RD 1619/2012, o hace falta un acceso remoto permanente?

## Q48h. Custody after closure or death — ANSWERED

Código de Comercio art. 30.2:

> «El cese del empresario en el ejercicio de sus actividades no le exime del deber a que se refiere el
> párrafo anterior y si hubiese fallecido recaerá sobre sus herederos. En caso de disolución de
> sociedades, serán sus liquidadores los obligados a cumplir lo prevenido en dicho párrafo.»

[Ley de Sociedades de Capital art. 396.3](https://www.boe.es/buscar/act.php?id=BOE-A-2010-10544):
«Los liquidadores depositarán en el Registro Mercantil los libros y documentos de la sociedad
extinguida.»

**For the first venue,** the taxpayer is a company, so the death of its owner does not end the duty:
the company still holds it. Heirs matter only for a sole trader. How a successor reaches an encrypted
archive is a product decision, not a legal question. No source says how far art. 396.3 reaches an
electronic archive.

## Q48i and Q48j — VENUE

The acquiring contracts; whether the venue is in common territory; which books it keeps and their last
entry; any tax losses, deductions, adjusted investments, notified interruptions or claims.

**Suggested Spanish, replacing the first paragraph:**

> Proponemos seis años desde el último asiento de cada ejercicio como suelo común (art. 30 CCom),
> ampliado cuando proceda por los arts. 66 bis y 70 LGT, 26.5 LIS y 165.Uno LIVA, y cinco años para
> justificantes de pagos desde 1.000 euros. Conservaríamos además facturas, justificantes, las
> declaraciones responsables de cada versión, y los registros pendientes o rechazados hasta
> resolverlos. Los registros aceptados se conservan por funcionalidad, no por obligación. ¿Es
> correcto y falta algo?

---

# Q53. The declaration and a change of producer

**Does it still make sense?** Yes. A940's item d) waits on it. But the wording has drifted: the
heading says "cambio de productor", and the text sent now mixes in cloud moves. Sub-questions:

## Q53a. Is item d) sufficient and correct? — NARROWED

**Proposed answer for a yes or no:** the draft is sufficient after these five edits. AEAT's own
[worked example](https://sede.agenciatributaria.gob.es/static_files/Sede/Tema/IVA/Verifactu/EjemplosDeclaracionResponsable(V0.5.1).pdf)
describes its product in the same style and length.

1. **Remove «Se prevé un servidor de reserva».** Art. 15.1 d) asks for the components «de que consta»
   the system, for one version. Waitron has no failover today (CLAUDE.md §5). Each version gets its
   own declaration, so the sentence arrives with the release that has the feature. A940's English
   draft says «Opcionalmente» here, which has the same problem.
2. **Make the third-party list a present fact.** «Se identificarán» is a promise. The October draft
   had «de los que nos hacemos responsables», which matches Q53b; restore it.
3. **Say how the library is used.** `@waitron/verifactu` has its own repository and releases, which is
   case b) of developer FAQ §5. Then the main declaration must say the system invokes it
   «indefectiblemente», «con mención expresa a la versión concreta usada», and «cómo lo hace, cuándo y
   para qué». The draft gives version and declaration only.
4. **Cover the print agent properly.** Developer FAQ §5 exempts only components irrelevant to the rules,
   and lists among the relevant ones «la impresión de facturas» and «la generación del QR». So the
   agent is not outside. If it is released with the server, case c) applies and the declaration should
   explain «la integración con los CF y su uso indefectible». Whether its release cycle is tied is a
   fact to check: `apps/print-agent` shows version 0.0.0 and the image is published separately.
5. **Say what the terminals do.** «que no generan dichos registros» is fine, but art. 13.4 of the
   Regulation asks for «tipología, composición y funcionalidades», and the terminals request and show
   invoices. One sentence does it.

**Hardware, settled.** The draft's «Waitron no suministra hardware» is right. AEAT's FAQ: «No, el
hardware genérico –ordenador– sobre el que se instala un software informático de facturación no hay que
certificarlo.» It counts only if sold as a whole or if it plays a relevant part in a requirement.
This matters later if a box is ever sold with Waitron preinstalled: then it is part of a «todo» that is
«ofrece (comercializa)», and hardware belongs in d).

## Q53b. Third-party components — ANSWERED

AEAT's [declaration FAQ](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/certificacion-sistemas-informaticos-declaracion-responsable.html):

> «La empresa que efectúe la programación del código o integre partes de otro software, ya sea o no de
> código abierto, debe realizar la declaración responsable, incorporar los datos obligatorios e indicar
> qué componentes utiliza. En el caso de que utilice código abierto, se hará responsable del
> funcionamiento del mismo, incluyendo los sistemas de seguridad exigidos para preservar la integridad,
> conservación, accesibilidad, legibilidad, trazabilidad e inalterabilidad de los registros.»

The producer lists the components and answers for them. Node.js, SQLite, Litestream, Linux and Docker
have no declaration of their own to rely on. Their exemption from certifying separately does not move
responsibility away. Whether all of them must be named, or only those that touch the requirements, is
not stated; naming them is the safe side.

## Q53c. Cloud hosting — ANSWERED

For the declaration, no difference. AEAT's FAQ on alternatives: a SIF «Podría estar instalado en las
dependencias de quien expida las facturas ( on-premise ), en remoto, o bien en la nube ( cloud )». The
conservation FAQ's Note 1: «Los RF generados pueden almacenarse remotamente, incluso “en la nube”».
AEAT's example simply says where the product is meant to run.

**What this does not settle.** Whether Waitron running the server makes it a third party issuing
invoices for the venue. That question is not in Q53 and belongs with the hosting design.

## Q53d. e) = S, and item g) — ANSWERED, with a correction

**e) = S is right** on one condition. AEAT's FAQ: S where the system

> «no permite la posibilidad de no remitir automáticamente todos los registros de facturación a la AEAT»

and N for everything else, «independientemente de si luego el usuario lo llegara a utilizar como
sistema VERI*FACTU o no».

From the code (read, not run): `SOFTWARE_IDENTITY.onlyVerifactu` is `"S"`
(`packages/fiscal-verifactu/src/software-identity.ts`). The fiscal module comes from the venue's
territory (`packages/provisioning/src/venue-fiscal.ts`), not from a setting the operator flips each
day. `WAITRON_FISCAL_TEST_SUBMISSIONS` only enables test filing. The hold in Q47 happens only while an
earlier record is unsettled or after repeated refusals, not by anyone's choice. **Before signing,** the release should be checked for any route that
lets a production Spanish installation run without filing, including `fiscal-none`, which ships in the
same build.

**Correction: g) is not omitted.** The question says «sin apartado g) aplicable». Art. 15.1 requires
the items «en el mismo orden en que se indica», and AEAT's example keeps 1.g) with a sentence:

> «Dado que se trata de un producto de facturación que solo puede ser utilizado exclusivamente en la
> modalidad de «VERI*FACTU», no se realiza una firma electrónica expresa de los registros de
> facturación generados»

Copy that wording.

## Q53e. f) = N — NARROWED

**Proposed answer for a yes or no:** N is right while every installation serves one taxpayer, on-site
or hosted, as a separate installation with its own database and certificate.

Art. 15.1 f) asks whether the system «permite ser usado por varios obligados tributarios». Orden
art. 2 and the FAQ treat that as one system holding several taxpayers' billing, kept apart «como si
fuera un SIF «propio» e independiente». AEAT's example answers S because «Este software permite
gestionar de forma independiente varias facturaciones dentro de él». Waitron has no such feature.

The doubt is hosted venues. Developer FAQ §3 and §4 speak of SaaS systems offered to many users. If
Waitron Cloud ever ran several taxpayers inside one installation, f) would become S. The design keeps
one tenant per database, so N stands (from the repository's decisions, not tested).

## Q53f. A future non-Veri\*Factu mode — ANSWERED

- **e) becomes N**, and the records' `TipoUsoPosibleSoloVerifactu` with it (FAQ above).
- **g) lists the signature types** (art. 15.1 g).
- **The choice cannot flip.** Developer FAQ §3: «NO debe resultar posible una utilización dinámica del
  SIF. Entendemos por dinámica que se pueda cambiar en cada sesión, en cada arranque diario o en cada
  factura emitida».
- **Once a taxpayer is in Veri\*Factu it stays to the year's end.** AEAT: «deberá permanecer al menos
  hasta finalizar el año natural».
- **AEAT's name for such a product is "dual"**: «"duales" (que permiten ser usados, a elección, como
  VERI*FACTU y como sistema de emisión de facturas no verificables)».
- A system that only runs non-verifiable cannot exist: «No puede existir un SIF que únicamente funcione
  como sistema de emisión de facturas no verificables».

## Q53g. Keep the two characters under a new NIF — ANSWERED

Yes. Art. 15.1 b) forbids a clash only with «otro sistema informático distinto que pueda producir dicha
persona o entidad». AEAT's FAQ gives this exact case: two producers «podría también establecer el
código “S1”». Developer FAQ §4 confirms the code is unique only together with «la identificación de
su fabricante».

## Q53h. New installation and new chain — NARROWED

**Proposed answer for a yes or no:** yes. A change of producer makes a different system, so a new
installation number and chain follow, and records already sent stay as they are.

Developer FAQ §4: a system is identified by «Id.OEF (NIF) + Id.SIF (*) + NºInstalación(**)»; a version
change does not make a new system, «cosa que sí ocurre con los otros 3 campos»; and the producer's
identity counts «como si formara parte de él». AEAT's FAQ: «Un SIF tiene una única cadena de RF».
No source speaks of a change of producer, so this is our reading.

## Q53i. Declaration and communication — NARROWED

**Proposed answer for a yes or no:** the new producer signs a declaration for its first version, each
restaurant keeps the old declaration, and nothing goes to AEAT.

Sources: art. 13.1 of the Regulation puts the declaration on the producer. AEAT's FAQ: «no se prevé
ningún registro previo del producto SIF por parte de nadie (ni productor, ni comercializador, ni
usuario)». On Veri\*Factu use and modelo 036, AEAT answers «No». The restaurant's duty to keep the old
declaration is under Q48a. No source addresses the change itself.

## Q53j. Cancelling and correcting across systems — ANSWERED

Yes, in principle. Developer FAQ §17:

> «en principio, tanto un RF de alta de subsanación como un RF de anulación se podrían generar y
> conservar o remitir a la AEAT desde un SIF distinto al que expidió la factura original (aunque
> probablemente, lo más habitual es que todo se haga en el mismo SIF)»

That section's case 2.b) expressly includes a rejected record, corrected with `Subsanacion` = "S" and
`RechazoPrevio` = "X". A corrective invoice is a new invoice and belongs to whichever system issues
it. One limit from §10: a producer answers for records of invoices issued by the system it certified,
so a correction of an old invoice is the new system's record about the old system's invoice.

## Q53k. Moving between on-site and cloud — NARROWED

**Proposed answer for a yes or no:** same two characters, because the code names the product, not the
place («por cada fabricante a su producto SIF»). New installation number, as for any reinstall
(developer FAQ §4: «debe llevar otro nº de instalación diferente»). No change to the declaration,
provided d) already says the server runs on-site or in the cloud.

If a hosted build were ever sold as a different product, it would need its own code.

## Side finding: the tax number and publication

Art. 15.1 h) to j) put the producer's name, NIF and postal address in the declaration. Art. 13.2 of the
Regulation requires it «de modo visible en el propio sistema informático» and «para el cliente y el
comercializador en el momento de la adquisición del producto». The owner chose on 2026-11-02 to keep
his number out of everything public. These fit: AEAT only recommends that declarations be «accesibles
públicamente», and allows delivery «en formato papel o electrónico». But the A940 design's plan to
attach each declaration to a public GitHub Release would publish it, so that step needs the same
decision as Task 8.

**Suggested Spanish, replacing the two question paragraphs on e), f) and the producer:**

> Proponemos e) = S, conservando el apartado g) con la frase del ejemplo de la AEAT, y f) = N porque
> cada instalación, local o alojada, atiende a un solo obligado. Si cambia el productor, entendemos
> que es otro sistema: nueva instalación y cadena, mismo código de dos caracteres, nueva declaración
> y ninguna comunicación a la AEAT; las anulaciones y subsanaciones de facturas anteriores podrían
> hacerse desde el nuevo sistema (FAQ desarrolladores §17). ¿Algo de esto es incorrecto?

---

# Venue facts for the owner or gestoría, not paid questions

- Confirm the venue is in common territory (Barcelona, per the Square data).
- The acquiring contracts with the card providers (Q48i).
- Books kept and their last entry; any tax losses, pending deductions, purchases under VAT adjustment,
  open audits or claims (Q48j).
- Which ledger account takes tips (Q49d).
- Whether the print agent ships in step with the server (Q53a, edit 4). This one is ours to check.

# What was retrieved and what was not

**Retrieved 2026-11-06 and read:** BOE consolidated texts (TRLGDCU, last update 04/11/2026; Codi de
consum, 29/01/2025; Llei 18/2017, 31/12/2025; PGC; PGC for small businesses; ICAC resolution,
13/02/2021; Ley 27/2014; LGT, 21/12/2024; Código de Comercio; RD 1619/2012, 31/03/2026; LIVA; Ley
7/2012; Ley de Sociedades de Capital; RD 1007/2023, 03/12/2025; Orden HAC/1177/2024, 28/10/2024); the
BOE's page and PDF of the 1965 order; DOGC 5864 (Decret 321/2011); Portal Jurídic's metadata for Decret
317/1994 and its text of Decret 75/2020; the Agència's two pages; 16 AEAT pages; AEAT's developer
FAQ (byte-identical to `docs/compliance/sources/`, v1.3 of 4 December 2025); AEAT's declaration
examples, v0.5.1; 82 PETETE rulings on tips, 15 on "sugerid-", and 17 on donations and pilgrims.

**TRLGDCU changed on 04/11/2026.** Its consolidated text moved after the 2026-10-18 research, on the
repeal of RD-ley 4/2026. Arts. 20, 60, 60 bis, 66 quáter and 89.5 as quoted here and there match today's
text.

**Could not be retrieved or checked:**

- **EUR-Lex:** every download of C-404/99, C-16/93 and Directive 2011/83 returned an empty holding page.
  C-404/99 rests on the 2026-10-18 quotes. Tolsma's paragraph 14 was read only as quoted by DGT rulings.
- **CENDOJ, the courts' database:** the search answered «La búsqueda no es válida!» or error 500. So the
  Audiencia Nacional 2001 ruling, any ruling on restaurant service charges, and the original texts of
  TS 635/2021 and TSJ Madrid 2023 remain unread.
- **TEAC's database:** not tried in this pass.
- **Decret 317/1994's DOGC text:** read only in a reproduction, «Disposición Vigente a 29/1/2007». Its
  repeal is first-hand.
- **RD 39/2010:** only the BOE's note on the 1965 order was read, not the decree.
- **ICAC's bulletins:** the site search found nothing for "propinas", but may not read PDFs. BOICAC 19
  and 81 were not read.
- **Legal force of AEAT's FAQs:** they are AEAT's reading, not law. Developer FAQ §17's «en principio»
  is AEAT's own hedge.
- **Other regions:** only Catalonia was read for Q50. A second venue elsewhere needs its own check.
- **The Agència's advice to businesses:** whether it is free, and whether it answers in writing, was
  not established.

**Code claims** in Q53d were read, not run.
