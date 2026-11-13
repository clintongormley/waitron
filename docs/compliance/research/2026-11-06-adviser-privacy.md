# Privacy adviser questions: what free primary sources already settle

> Storage note, 2026-11-13: [fk6](../../superpowers/plans/2026-11-08-a1308-fk6-parties-and-person-keys.md) moves the answer, actor and time onto `parties` and records an answer and guest count in `activity_log`. The schema descriptions below record the earlier storage.

**Research pass, 6 November 2026.** Covers Q48 (privacy part), Q54 to Q59, Q62 and L3 from the
[batch of 5 November](../2026-11-05-consultas-para-asesores.md). Nothing here has been sent to anyone, and
nothing in the repository was changed. This is research, not legal advice.

**Words used.** The **controller** decides why and how personal data is used; the **processor**
handles it on the controller's behalf. **Blocking** (*bloqueo*, LOPDGDD art. 32) means setting data
aside so nobody can use or even view it, except to hand it to courts or authorities, and destroying
it when the time limit for claims ends. A **DPIA** is the formal impact assessment of GDPR art. 35.
A **DPO** is a data protection officer. The **AEPD** is the Spanish data-protection authority. The
**EDPB** is the board of EU data-protection authorities; the **CJEU** is the EU's top court. The
**Gabinete Jurídico** is the AEPD's legal office, which publishes reports. The **bucket** is the
online storage the box copies its database to.

**How to read the labels.** DROP: the question no longer makes sense. ANSWERED: primary sources
settle it. NARROWED: we have a likely answer and a professional only says yes or no. KEEP: only a
professional can answer. VENUE: a fact only the owner knows, not a paid question.

## The short version

Nine questions break into 43 points. Only **one** needs a professional's judgement: whether a
restaurant may keep health notes for years in case of a claim (Q48-2). Seventeen are confirmations of
an answer we now propose. Nineteen are answered, three should be dropped and three are facts for the
owner. At the brief's rate of about an hour a question that is nine hours; a single sitting of two or
three hours on the list in [What to send](#what-to-send) should do it. That figure is my estimate.

Six findings matter more than the rest.

1. **The AEPD has already answered Q56's main question, and its answer changes other work.** Its
   Gabinete Jurídico says that where a law requires the data to be kept, neither erasure nor blocking
   applies. But it also says the opposite for true erasure: real erasure means blocking first, not
   deleting. So S9 (erase a booking guest) and S11 (clear a former employee's email), which simply
   clear a field, do not match the AEPD's published position. Failing to block where it is required
   is listed as a very serious infringement.
2. **Q62's first half is not a question a venue's adviser can answer, and the AEPD has already said
   what it expects.** Its guide for small businesses of November 2025 contains a case with Q62's
   exact facts: an unencrypted backup held by an outside service. It calls encrypting backups «una
   medida fundamental». No law makes encryption mandatory, so this is the owner's product decision,
   not a legal question. Four facts behind A1324 should be looked at again (see [Q62](#q62)).
3. **Q57's relay is being retired.** A951 removes the relay the question describes. Its replacement
   passes staff traffic through Cloud unread but ends customer traffic at Cloud, where Cloud can read
   it. Cloud's unsigned draft contract already covers remote transport as a processor service, so an
   art. 28 contract is planned either way.
4. **Today's masked logs are not anonymous**, so Q57's "if we mask them, do they stop being personal
   data?" gets a no on the facts. And the CJEU says the venue must name Waitron as a recipient in its
   notice even if the reports are anonymous from Waitron's side.
5. **Q54 describes the product wrongly in two ways.** The till does not wait for the guest to mention
   an allergy: it makes staff answer «Any allergies at this table?» before the first send. And the
   "who" field is not "usually without a name": the kitchen guide calls it the guest's name and uses
   "Alex" as its example.
6. **The AEPD's free channel will not take these questions.** Its rules say so in terms
   ([The AEPD's free channel](#the-aepds-free-channel)).

## All sub-questions at a glance

| Ref | Sub-question | Outcome | One-line answer |
| --- | --- | --- | --- |
| Q48-1 | Basis for using allergy notes during the meal | NARROWED | Art. 6(1)(b) contract plus art. 9(2)(a) explicit consent; no law requires recording them |
| Q48-2 | Basis for keeping them afterwards as evidence | KEEP | Only art. 9(2)(f) legal claims fits; how far it stretches before any claim exists is a judgement |
| Q48-3 | One common six-year schedule | ANSWERED | No: the AEPD requires a period per processing activity and rejected a broad schedule as excessive |
| Q48-4 | What to remove early; minimum identity | NARROWED | Proposal in the Q48 section: cut names, phones and raw print bytes early |
| Q48-5 | Delete as soon as no duty remains? | ANSWERED | No: erasure means blocking first, then destruction |
| Q48-6 | Is a delay of up to 35 days in backups acceptable? | NARROWED | Probably yes with a replay list; no fixed number exists, and the real figures are 7 and 30 days |
| Q48-7 | Access, keys, versions and replicas of backups | NARROWED | Proposal in the Q48 section; "inaccessible" is not true of the bucket today |
| Q48-8 | Copies already given to others | ANSWERED | Tell each recipient unless impossible or disproportionate (art. 19) |
| Q48-9 | Data in an unchangeable original | ANSWERED | Allergy tables can be changed; elsewhere "technically impossible" is no defence |
| Q54-1 | Are the notes health data of an identifiable person? | ANSWERED | Yes, and more plainly than the question assumes |
| Q54-2 | May the venue use Facilita? | ANSWERED | Not for allergy notes: the AEPD's page excludes health data |
| Q54-3 | What assessment does the venue need? | NARROWED | A written risk analysis and a reasoned decision that no DPIA is needed |
| Q54-4 | Must it keep a record of processing? | ANSWERED | Yes |
| Q54-5 | Must it appoint a DPO? | ANSWERED | No, for a single restaurant |
| Q55-1 | Keep a former employee's email one year? | NARROWED | Yes on legitimate interest, then block rather than clear |
| Q55-2 | Delete sign-in details at deactivation? | ANSWERED | No objection possible: nothing requires keeping them, and it is built |
| Q55-3 | Must deleted sign-in details be blocked first? | NARROWED | Proposed no; new point this research found |
| Q56-1 | Blocking when erasure is refused under a legal duty? | ANSWERED | No, in the AEPD's own words |
| Q56-2 | What views must be restricted? | NARROWED | No fixed list; off everyday screens, purpose-limited |
| Q56-3 | Access for the worker and representatives | ANSWERED | Unaffected, since blocking does not apply |
| Q56-4 | May the invoice's destination email be erased? | NARROWED | Yes on request unless delivery is in dispute; keep date and outcome |
| Q57-1 | Waitron's role for bug reports | NARROWED | Controller when fixing the product for everyone; processor only for one venue's own support |
| Q57-2 | When do reports stop being personal data? | ANSWERED | Only if Waitron cannot link them back; today's reports fail that test |
| Q57-3 | What must the venue's notice say? | ANSWERED | Name Waitron as a recipient, whatever Waitron can see |
| Q57-4 | Does the relay as described need an art. 28 contract? | DROP | That relay is being retired |
| Q57-5 | Roles in the relay's replacement | NARROWED | Processor for transport; own-purpose controller for its security records |
| Q58-1 | Is the staff action record a control measure? | NARROWED | Yes, under ET art. 20.3; no consent needed |
| Q58-2 | Does the venue have worker representatives? | VENUE | Under six staff there are none |
| Q58-3 | If it does, must they be able to report first? | NARROWED | Treat it as covered: give them the chance, up to 15 days, non-binding |
| Q58-4 | Does art. 87.3 reach a shared till? | NARROWED | Treat it as covered: a one-page use rule costs nothing |
| Q58-5 | Is the staff notice enough? | NARROWED | Yes, if given first and complete; two items are missing today |
| Q59-1 | Plain ticket with no customer data | ANSWERED | No notice and no line needed |
| Q59-2 | Short notice when taking details, sign or link for the rest | NARROWED | Yes, shown before the details are taken |
| Q59-3 | Must a line appear on the invoice or PDF? | ANSWERED | No; permitted, not required |
| Q59-4 | Invoice to a company | ANSWERED | No notice for the company's own data |
| Q59-5 | The short text | NARROWED | Text proposed in the Q59 section |
| Q62-1 | Is encryption legally mandatory? | ANSWERED | No fixed rule; judged case by case, with the proof on the controller |
| Q62-2 | Is relying on the provider's encryption adequate? | DROP | Not a paid question: see the Q62 section |
| Q62-3 | Would the people affected have to be told? | ANSWERED | That turns on high risk, not on the exception; the exception would not help in the likely cases |
| Q62-4 | The venue's provider, region and settings | VENUE | Facts the venue must check |
| L3-1 | Does anything at this venue require biometrics? | VENUE | No law does; only a collective agreement or a client could raise it |
| L3-2 | Could biometrics be justified at all? | ANSWERED | On the AEPD's 2023 reading, no: Spanish law has no basis for it |
| L3-3 | Scope of a DPIA if biometrics were ever wanted | DROP | Hypothetical, and a DPIA would not cure the missing basis |

## What to send

**Keep one open question.**

- Q48-2: may a restaurant keep allergy notes after the meal, blocked, for the time limit on a claim,
  relying on art. 9(2)(f) before any claim exists? If yes, for how long: one, three or five years?

**Ask for a yes or no on these, in the order given.** Each is our proposed answer.

1. Q48-1: allergy notes rest on art. 6(1)(b) and art. 9(2)(a); a guest's spoken request, noted at the
   table after a short explanation, is explicit consent.
2. Q48-4: the early-removal table below is right.
3. Q48-6 and Q48-7: backup delay of up to 30 days is acceptable with a replay list, with the conditions
   below.
4. Q54-3: a single restaurant needs a written risk analysis and no DPIA.
5. Q55-1 and Q55-3: one year on legitimate interest, then blocked; sign-in details are deleted without
   blocking.
6. Q56-2 and Q56-4: restricted screens as proposed; the destination email is erased on request.
7. Q57-1 and Q57-5: Waitron's roles as proposed. D101's lawyer question 4 already reuses Q57, so
   ask once.
8. Q58-1, Q58-3 to Q58-5: the action record is a control measure; representatives get a chance to
   report; a one-page use rule covers art. 87.3; a complete staff notice given first is enough.
9. Q59-2 and Q59-5: the procedure and the short text.

**Drop from the batch:** Q48-3, Q48-5, Q48-8, Q48-9, Q54-1, Q54-2, Q54-4, Q54-5, Q55-2, Q56-1, Q56-3,
Q57-2 to Q57-4, Q59-1, Q59-3, Q59-4, Q62 entirely, and L3 entirely.

**Correct before sending anything** (the Spanish text in the batch):

- Q54 and Q48 say the allergy is noted when the guest mentions it, usually without a name. Say instead
  that staff must answer for every table and that the field often holds a name.
- Q57 describes the relay A951 is retiring.
- L3 says «PIN o tarjeta». I found a PIN and no staff card for clocking in.
- Q48 calls the backups «inaccesibles» and proposes 35 days. See Q48-6 and Q48-7.

## The AEPD's free channel

**No. None of these can go there, and the owner should not plan on it.**

- The AEPD's citizen service refuses them outright. Instrucción 1/2021 says that service «no
  atenderá las formuladas individualmente por responsables o encargados del tratamiento ni por
  abogados ni consultores» [S24]. The same rule says questions must concern the rights of the
  person asking. Waitron's owner would be asking as a business.
- The Instrucción also says «la AEPD no desarrollará funciones consultivas individualizadas
  destinadas a responsables y encargados del tratamiento» [S24].
- **Two sources seem to disagree, and the dates explain it.** The AEPD's INFORMA_RGPD page still
  offers controllers a question channel [S25]. That page was last modified on 17 May 2021; the
  Instrucción is of 2 November 2021 and is published law. The page may be out of date, or the channel
  may survive for live processing. Even on its own terms it refuses questions put «desde un punto de
  vista hipotético» and «Validación de documentos elaborados» by the business. Waitron has no live
  venue, so its questions are hypothetical and its templates would be refused as validation. I did not
  test the channel, because this pass contacts nobody.
- **One narrow route exists.** The Gabinete Jurídico may exceptionally report on a question of
  general scope from a business with no duty to appoint a DPO, if it justifies why it cannot appoint
  one voluntarily and encloses a reasoned report, with preference for bodies representing a sector
  [S24]. A hospitality trade body could plausibly raise Q48-2. That is an idea for later, not a quick
  or certain route.
- Prior consultation under art. 36 applies only after a DPIA leaves high risk unresolved, so it does
  not apply here.

The AEPD's free **tools** do apply: Evalúa Riesgo RGPD for the risk analysis [S23], and Comunica-Brecha
RGPD for breaches [S22].

## Q48: allergies and retention {#q48}

### What is really built

- `party_allergy.answer` is `none` or `allergies`; a guest row holds `who` (up to 40 characters),
  allergens and a note of up to 2,000 characters (`packages/venue-service/src/schema/party-allergy.ts`).
- The till makes staff answer before the first send: «Before you first send a table's dishes, answer
  **Any allergies at this table?**» (`apps/server/src/guide/en/products.md`). So the venue asks every
  table. It does not only record what a guest volunteers.
- The kitchen guide says «An assigned dish carries the guest's name» and uses "Alex" as its example
  (`apps/server/src/guide/en/kitchen-service.md`). The field's label is "Who". The owner chose no hint
  steering staff away from names (A980 O6).
- `seatBooking` links the party's tab to the booking (`packages/bookings/src/bookings.ts`).
- `party_allergy`, `party_allergy_guests`, `ticket_item_allergies` and `kitchen_notices` are all
  classified `state`, not append-only (`packages/venue-service/src/classification.ts`). They can be
  changed or deleted. So can `print_jobs`, which holds the kitchen ticket's raw bytes, allergy block
  included, though nothing deletes them today.
  **2026-11-13 update:** A1308 fk8 folds the ticket snapshot into `ticket_items`
  (`allergy_frozen`, `allergy_original`, `allergy_current`), classified `ledger` without append-only
  protection in [core's classification](../../../packages/db/src/classification.ts). The current
  copy can still be updated, and deleting its order line deletes the ticket.
  [Implementation plan](../../superpowers/plans/2026-11-08-a1308-fk8-kitchen-tickets.md).
- The bucket keeps 168 hours of history (`packages/stream/src/litestream.ts`). Scheduled backups keep
  the newest 7 and nothing older than 30 days by default, and a venue can change that
  (`apps/server/src/backup-config.ts`). Turning the copy off leaves what is stored.

### Q48-1. Basis for using the notes during the meal: NARROWED

**Proposed answer: art. 6(1)(b) (the contract for a safe meal) plus art. 9(2)(a) (explicit consent).**

A health-data use needs both an art. 9 exception and an art. 6 basis: CJEU C-667/21 says such
processing «solo será lícito si se cumple al menos una de las condiciones» of art. 6(1) [S10]. That
ruling concerns the art. 9(2)(h) exception; the reasoning at para. 74 is general.

Why the other art. 9 exceptions do not fit:

| Exception | Why not |
| --- | --- |
| (b) labour law | Guests are not staff |
| (c) vital interests | Only when the person «no esté capacitado, física o jurídicamente, para dar su consentimiento» |
| (e) made public | Telling a waiter does not make data «manifiestamente públicos» |
| (g), (h), (i) | Need a law; in Spain LOPDGDD art. 9.2 requires «una norma con rango de ley». I found none for a restaurant |

**No law requires the record.** Regulation 1169/2011 art. 44 and RD 126/2015 art. 4 require the venue
to tell customers which allergens a dish contains [S12, S13]. They say nothing about recording who is
allergic. So art. 6(1)(c) legal obligation is not available, and the design's table should not imply
it.

**Consent is possible for health data.** LOPDGDD art. 9.1 removes consent as a basis only for
ideology, union membership, religion, sexual orientation, beliefs and racial or ethnic origin, not
health [S2]. The AEPD's 2016 report on school canteens, under the old law, called allergy data
specially protected and rested on the family providing it and consenting [S14].

**Spoken consent is allowed but hard to prove.** EDPB 05/2020 para. 94: "In theory, the use of oral
statements can also be sufficiently express to obtain valid explicit consent, however, it may be
difficult to prove for the controller that all conditions for valid explicit consent were met" [S30].
The till records who entered the answer (`changed_by`) but nothing about the guest agreeing.

**Gaps this leaves for the product, which need no adviser:**

- The booking script covers guests who book. A walk-in who is asked at the table gets no notice at
  all. Art. 13 applies at that moment. A line on the menu or allergen sheet would cover it.
- A guest speaking for a companion or a child is not that person's consent. The specialist should
  say what to do; a parent for a child is the common case.

### Q48-2. Basis for keeping the notes as evidence: KEEP

Consent cannot carry this: it can be withdrawn, and "in case you sue us" is a different purpose. No
law requires it. That leaves art. 9(2)(f), processing «necesario para la formulación, el ejercicio o
la defensa de reclamaciones», with art. 6(1)(f) legitimate interests.

Research cannot settle whether that exception covers keeping every guest's health note for years when
no claim exists. Nothing I found addresses it for allergies. It is also a weighing of a real risk
(a serious reaction, a claim) against keeping sensitive data on people who will never claim. That is
why this is the one paid question.

**What the sources do give, to narrow it:**

- **The form.** If the note's purpose ended when the meal did, the AEPD's structure says the data
  should be blocked, not left live on staff screens. Blocked data may be used only for the
  liabilities art. 32 names, and access limited «a personas con la responsabilidad de contestar las
  distintas reclamaciones» [S5]. This meets the owner's aim (evidence survives) without keeping
  health notes visible for years. The specialist must say whether a food-safety claim counts: art.
  32.2 speaks of liabilities «derivadas del tratamiento», meaning from the data processing. The AEPD's
  report also quotes its older view that the period follows the time limits on actions from the
  underlying legal relationship [S5]. These two readings describe different things, and the answer
  decides whether blocking works here.
- **The time limits.** A contract claim has five years (Código Civil art. 1964.2, which the AEPD calls
  the starting point for personal obligations [S5, S35]). A claim in negligence has one year from
  when the person knew (art. 1968.2 [S35]). A claim for a defective product has three years
  (TRLGDCU art. 143 [S37]). So six years is longer than each of them.
- **Six years comes from Código de Comercio art. 30**, which covers «libros, correspondencia,
  documentación y justificantes concernientes a su negocio» [S36]. The AEPD's report cites it only as
  a separate duty, saying «sin perjuicio» of the limitation periods. Whether a seat-level allergy note
  is such a document is doubtful, and is a point for the fiscal adviser.

### Q48-3. One common six-year schedule: ANSWERED

**No, not as a single number across categories.** Informe 0148/2019 reviewed exactly this kind of
document, a company's guide to retention periods. It told the company to examine each processing
activity in its record, «determinando para cada uno de los supuestos planteados» «el plazo concreto
durante el cual los datos deberán conservarse», and said its proposed blocking periods «exceden en
mucho de las exigencias derivadas de la normativa aplicable» [S5]. It also cites a €50,000 fine for
keeping data 16 years after the last business (PS/00076/2020).

The owner's lean can survive as an engineering default: one *mechanism*, with a period set per
category. It cannot survive as one legal *period*. The periods for tax, labour and allergy data
really do differ.

### Q48-4. What to remove early and what identity must stay: NARROWED

**Proposed answer**, for confirmation:

| Data | Proposal | Why |
| --- | --- | --- |
| Raw print bytes (`print_jobs.payload`) | Delete soon after printing | Transport only; a copy of what is stored elsewhere |
| Booking phone | Delete when the booking ends | No remaining purpose |
| `who` holding a name, after the meal | Reduce to the seat | The evidence needs the seat and the allergen, not the person, unless Q48-2 says otherwise |
| Link from the allergy note to a booking name | Cut with the above | Otherwise the seat description still identifies the guest |
| Staff member who took the note | Keep with the evidence | It shows who was told |
| Staff name on time and fiscal records | Keep | The duty requires it; no one else's data needed |

This rests on GDPR art. 5(1)(c) and (e) and is our proposal, not an AEPD statement.

### Q48-5. Delete as soon as nothing remains? ANSWERED

**No. On the AEPD's published position, erasure means blocking first.** The proposal to suppress data
when no duty remains, with immediate removal possible, is incomplete.

- «El bloqueo excluye el borrado material de los datos» [S5].
- The duty applies both to rights requests and «en los supuestos en los que deba procederse de oficio
  a la supresión» [S5], so timed clean-up is covered as well as requests.
- «el procedimiento de supresión debe contemplar el período de bloqueo» [S6].
- A recent AEPD decision of 2026 repeats that erasure «debe llevarse a cabo mediante el bloqueo» [S8].
- Not blocking where required is a very serious infringement: LOPDGDD art. 72.1.n, quoted at [S5].

**How long.** Where there is no other period, or it is under a year: «se tendrán en cuenta los plazos
de prescripción de las infracciones a la LOPDGDD, que en el caso de las muy graves es de tres años»
[S6]. The guide cites art. 78 there, which is about sanctions; art. 72.1 is the provision that gives
three years for infringements.

**If the system cannot block**, art. 32.4 allows «un copiado seguro de la información» with proof of
authenticity, the date and no tampering [S2]. That suits Waitron: move the erased values out of the
database into a sealed, dated file, delete them from the live tables, and destroy the file at the end
of the period.

**Exceptions.** Art. 32.5 lets the AEPD set exceptions for high risk or disproportionate cost. I found
none actually set. The law's own exceptions exist, such as video images under LOPDGDD art. 22.3, per
a search summary of PS/00267/2021 that I did not read.

**What it changes:** S9, S11 and A664's removal "within the next daily sweep" need a blocking step,
and the A664 design's blocking question is answered in general terms. A blocked person can still get
their own data: «no implica que no se puedan poner a disposición del afectado» [S7, S8].

### Q48-6. A delay of up to 35 days in backups: NARROWED

**Proposed answer: acceptable, provided a replay list exists and the delay is the real one.** The
EDPB's 2026 report on erasure says "it might not always be advisable to modify or delete information
from back-ups", but in that case organisations "should have appropriate procedures to keep track of
erasure requests and comply with them on restored systems" [S28]. It adds that half the authorities
raised concerns, and that the EDPB "may consider" more guidance on "without undue delay" here. So no
safe number exists. The report mentions "one month" as an example of practice, without approving it.
I found no AEPD statement on the point.

**Two corrections to the question.** The 35 days is a design choice, and the actual defaults are 7 days
for the bucket and 30 for scheduled backups. A venue can raise the second figure, and objects stay
behind when the copy is turned off.

### Q48-7. Access, keys, versions and replicas: NARROWED

**The word «inaccesibles» is not true today.** Anyone with the bucket's credentials or a recovery pack
can read the copy. Blocked data has to be kept from routine access, so this matters.

**Proposed conditions**, for confirmation:

- The list of erasures is kept outside the database it describes, or a restore of an old copy loses
  it. The restore applies it before the box opens.
- Bucket keys are held by one named person.
- If the venue turns on storage versioning, old versions need their own expiry. Waitron does not
  check this (a VENUE fact).
- Any copy left behind after turning the service off is deleted at the provider, as the guide says.

### Q48-8. Copies already given to others: ANSWERED

Art. 19 requires the controller to tell each recipient of an erasure «salvo que sea imposible o exija
un esfuerzo desproporcionado», and to tell the person who the recipients are if asked [S1]. It applies
to erasure under art. 17(1), so not to data kept under a legal duty, such as what AEAT holds.

### Q48-9. Data in an unchangeable original: ANSWERED

**The question's premise does not hold for allergies**: the allergy tables can be changed. Only the
fiscal and audit rows are unchangeable, and those are kept under a legal duty (Q56-1), so erasure does
not arise for the data the law requires.

**For anything else in an unchangeable row, the answer is firm.** The EDPB's final blockchain
guidelines of July 2026: "technical impossibility cannot be invoked to justify non-compliance with
GDPR requirements" [S31]. They concern blockchains, but the reasoning fits any tamper-evident chain, and
their footnote rests on data protection by design. Treatment: do not put free text into unchangeable
rows. Escalation: A664's G5, the owner's separate decision.

**I did not audit every append-only table.** One candidate to check: the name typed for a table, which
prints on receipts and invoices and which the guide says stays in the database.

## Q54: the assessment a restaurant needs {#q54}

### Q54-1. Health data of an identifiable person: ANSWERED

**Yes.** The owner's proposed classification is right, and the "potentially" can go.

- Recital 35 covers data that give «información sobre su estado de salud física o mental pasado,
  presente o futuro» [S1].
- The CJEU reads the term widely, covering «todos los aspectos, tanto físicos como psíquicos, de la
  salud de una persona» (Lindqvist, para. 50), and held a mention of an injured foot to be health
  data [S9a]. It is enough that data «puedan revelar, mediante un ejercicio intelectual de relación o
  deducción, información sobre el estado de salud» (C-21/23, para. 83) [S9b].
- The AEPD treated food allergies as health data in its 2016 report [S14].

**Identifiable.** With the seat linked to a booking, and `who` often a name, the venue can identify
the guest. In C-413/23 P the court said the party holding the extra information keeps personal data
«a pesar de la seudonimización» (para. 76) [S11]. A walk-in with no name, no invoice and no card leaves
less to link, but the product cannot tell those cases apart, so treat them all alike.

### Q54-2. Facilita: ANSWERED

**Not for allergy notes.** The AEPD's page, re-read today: «Facilita RGPD no podrá utilizarse para
tratamientos que impliquen un alto riesgo para los derechos y libertades de las personas, como datos
de salud o tratamientos masivos de datos, entre otros» [S21]. It is for «datos personales de escaso
riesgo, como por ejemplo, datos personales de clientes, proveedores o recursos humanos». The tool
itself, after three screens, says whether the business fits or «si debe realizar un análisis de
riesgos» [S21].

**VENUE step:** a venue that does not use the allergy feature might fit. Running the tool takes
minutes and says so. I did not run it.

### Q54-3. What assessment: NARROWED

**Proposed answer: a written risk analysis, plus a short reasoned decision that no DPIA is needed.**

- The AEPD's list says a DPIA is needed «en la mayoría de los casos» meeting «dos o más criterios»
  [S19]. A single restaurant meets criterion 4 (special categories). It does not meet 7 (large scale)
  or 5 and 6 (biometric, genetic). Criterion 3 (systematic monitoring) is arguable for the staff action
  record. Criterion 9 does not list employees, though WP248 does [S20].
- The AEPD's list of exempt processing covers staff management in small businesses, «pero nunca
  relativos a los datos de los clientes» [S18]. So the exemption does not reach allergy notes.
- That same list says a decision not to do one «ha de estar suficientemente fundamentada» [S18]. So
  the venue writes it down.
- Art. 35(3)(b) requires a DPIA for large-scale special categories; recital 91 says one doctor or
  lawyer is not large scale [S1].
- The free tool for the analysis is Evalúa Riesgo RGPD [S23]. The AEPD says its result is a minimum
  that the controller must adjust.

A chain, a hospital caterer or a venue serving mainly children would differ. Waitron could ship a
filled-in template analysis for the common case.

### Q54-4. Record of processing: ANSWERED

**Yes.** Art. 30(5)'s three exceptions are alternatives, and staff and invoice processing is not
occasional. The AEPD says directly of every employer: «El registro de jornada debe estar incluido en
el Registro de las Actividades del Tratamiento (art. 30 RGPD)» [S6]. The guide could stop saying "ask
your adviser" here. A pending EU change is noted under [Law in motion](#law-in-motion).

### Q54-5. DPO: ANSWERED

**No, for a single restaurant.** Art. 37(1)(c) needs core activities consisting of large-scale special
categories. WP243 says core activities are the key operations needed for the business's objectives,
and that support functions are auxiliary even when essential [S17]. A hospital's core includes health
data because it could not treat patients without it. A restaurant can serve without allergy notes.
WP243's examples of large scale include a hospital in normal activity and of not large scale one
doctor [S17]. LOPDGDD art. 34.1, in its whole list from a) to o), names no restaurants [S2]. A voluntary DPO is
allowed and must be notified to the AEPD within ten days (art. 34.3).

## Q55: a former employee's details {#q55}

### Q55-1. Keep her email for a year: NARROWED

**Proposed answer: yes on documented legitimate interest; at the year's end block it rather than clear
it.**

The AEPD's labour guide, updated December 2025, is direct: «A la finalización de la relación laboral
debe procederse al bloqueo de los datos (art. 32 de la LOPDGDD). No obstante, el tratamiento de datos
tras la extinción del contrato podría ser admisible si existe otra base jurídica, como sucederá si el
empleador demuestra un interés legítimo» [S6].

So:

- The basis is art. 6(1)(f), not contract. The venue needs a short written balance: the one-year
  claim period in ET art. 59.1, the need to send documents, and no other use.
- The working-time duty does not itself need the email. ET art. 34.9 keeps the record available to
  her; she can ask.
- At the year's end the email is being erased, so Q48-5 applies: block it, by art. 32.4 copy if need
  be, for the period the AEPD names. **S11 as designed clears it outright.** This is the one yes or no
  that changes the build. If the specialist says an email address carries no liability worth
  blocking, S11 stands.

### Q55-2. Delete sign-in details at deactivation: ANSWERED

**No objection is available.** Nothing requires keeping a former employee's PIN hash, password hash,
passkeys or recovery codes, and art. 5(1)(c), (e) and (f) and art. 32 all point towards deleting them.
It is built (`deleteSignInRows`, `packages/identity/src/staff.ts`, #2032). Who did what stays on
the records, so no evidence is lost. Ended session rows stay, and A664 covers those.

### Q55-3. Must deleted sign-in details be blocked first? NARROWED

This is a new point. The AEPD's reading of art. 32 covers any erasure, and credentials are data about
her. Read literally, Waitron should block them first, which is a poor security outcome. **Proposed
answer: no blocking.** They prove nothing about the processing, and art. 32.5 recognises that keeping
some data, even blocked, can itself be the risk. I found no AEPD exception actually set, so a one-word
confirmation is worth having.

## Q56: blocking and proof of sending {#q56}

### Q56-1. Blocking when erasure is refused under a legal duty: ANSWERED

**No. The AEPD said so in terms.** Informe 0148/2019: «en los supuestos en los que la conservación de
los datos viene impuesta por la ley especial, no procede el derecho de supresión conforme al artículo
17.3.b) del RGPD anteriormente citado, ni, por ende, el bloqueo de los mismos, sin perjuicio de la
obligación del responsable de respetar los principios recogidos en el artículo 5 del RGPD» [S5].

It quotes its earlier Informe 1/2019: because blocking is owed when erasure proceeds, and here it does
not, «el bloqueo no puede ser considerado base jurídica suficiente para el mantenimiento de los datos
por el responsable» [S5]. The labour guide agrees: «En virtud del art. 17.3.b) del RGPD, en estos
supuestos no procederá atender el derecho de supresión» [S6].

**The sequence is therefore:** use; then keep under the legal duty, unblocked but purpose-limited;
when the duty ends, block; when the limit ends, destroy. Informe 0148/2019 reviewed a company's retention guide, human-resources records included; the
1/2019 passage concerns money-laundering records. The reasoning is general, and the labour guide
applies it to staff records.

### Q56-2. What views must be restricted: NARROWED

**Proposed answer: no mandatory list; keep the records out of everyday staff screens and use them only
for their legal purpose.** The duty comes from art. 5, not from blocking. The AEPD adds that a
controller may adopt blocking-style measures «siempre que, ciertamente, dichas medidas no impidan los
tratamientos» the law requires [S5]. For working time: «El registro no puede ser de acceso público» and
«Los datos del registro no pueden ser utilizados con finalidades distintas al control de la jornada de
trabajo» [S6]. For a former employee, that means no appearance in rotas or staff lists, with an admin
reaching the record on request. This is mainly a product decision.

### Q56-3. Access for the worker and her representatives: ANSWERED

**Untouched, because blocking does not apply.** The conflict the question saw was between ET art. 34.9
and LOPDGDD art. 32.2, and the second never applies during the four years. The AEPD: representatives'
access «incluirá los datos personales necesarios para que puedan cumplir su labor de comprobar la
adecuación de los registros». It quotes the Ministry: «Esta obligación está establecida directa y
expresamente en la Ley por lo que no puede ser condicionada en ningún caso» [S6].

After the four years, when the record is blocked, the worker can still get her own copy [S7, S8].

### Q56-4. The email an invoice went to: NARROWED

**Proposed answer: erase the address on request once delivered, unless delivery is in dispute; keep
the date, the outcome and who sent it.** RD 1619/2012 art. 19 requires keeping invoice copies [S3].
Nothing I read requires keeping the address they were sent to. Art. 17(3)(e) keeps it available if a
dispute is open. The usual blocking applies to the erased address (Q48-5).

**Two points for the fiscal adviser, not the privacy one:** RD 1619/2012 art. 9.2 makes an electronic
invoice conditional on the recipient's consent, so the venue may want evidence of that consent. The
article was amended by RD 238/2026, in force since 20 April 2026 [S3]. That is about consent, not the
address.

## Q57: bug reports and remote access {#q57}

### What is really built

- **Nothing is sent to Waitron today.** A982's report stays on the box, and its plan rules out any
  Cloud call (`docs/superpowers/plans/2026-10-22-a982-one-touch-problem-reports.md`). A1047 (send to
  Cloud) and A1048 (opt-in automatic reports) are unbuilt.
- The log mask is partial and key-based. `marta.soler@example.test` becomes `m***r@e***e.test`.
  Names of things stay: «a floor-plan table named "García"», a device "Marta's phone". Text inside a
  message is not masked (`apps/server/src/log-personal-data.ts`; the A980 S10 decision).
- Some lines carry a person's id, such as `{ purpose, personId }` on `account_email.send_failed`.
- A report's version and installation details identify the venue, and for a sole trader that is a
  person.
- `packages/tunnel` is the TCP relay. Plan task T12 is titled "retire the appliance TCP relay
  entrance" (`docs/superpowers/plans/2026-10-22-a951-connection.md`).

### Q57-1. Waitron's role for bug reports: NARROWED

**Proposed answer: Waitron is a controller when it uses reports to improve its product for every
customer, and a processor only when it diagnoses one venue's problem on that venue's instruction.** The
same report can be both, so choose one and write it down.

EDPB 07/2020 para. 81 says acting on someone's behalf "also means that the processor may not carry out
processing for its own purpose(s)" [S29]. Its MarketinZ example turns a processor into a controller for
adding a purpose of its own. Para. 82: the same entity can be controller for some processing and
processor for other. A consultant who touches data only incidentally while fixing a bug is neither,
but only because the access is "purely incidental" [S29]. A report deliberately sent is not incidental.

**Consequence:** as a controller, Waitron receives a disclosure, so the venue needs a basis for sending
it, and Waitron needs its own notice. The simplest answer is the design that avoids the question: send
data that is anonymous for Waitron (Q57-2), and treat anything typed by staff as support.

### Q57-2. When reports stop being personal data: ANSWERED

**The test is whether Waitron could reasonably link them back. On today's facts, it could.**

C-413/23 P para. 77: measures may mean data is not personal for a recipient, but this presupposes
that the recipient cannot circumvent them, and that they «deben poder impedir efectivamente» it
attributing the data to the person by other means, such as cross-checking [S11]. Para. 82: a means is
not reasonably likely if identification is prohibited by law or practically impossible [S11]. The case
is about EU institutions under Regulation 2018/1725, whose definitions match the GDPR's. The EDPB's
draft guidelines on pseudonymisation (2025) and anonymisation (July 2026) are consultation texts, not
final [S32, S33].

**Conditions the report would have to meet**, drawn from that test:

| Condition | Today |
| --- | --- |
| No free text | Met for automatic reports (O9), not for a manager's report |
| No direct identifiers | Not met: the partial mask leaves first and last letters and the email's ending |
| No stable person ids | Not met |
| Names of things removed | Not met: "García", "Marta's phone" |
| Text inside messages removed or fixed by code | Not met; the backlog already says so (A1048) |
| Waitron holds nothing to link them with | **Not met for a venue Cloud hosts**: Waitron holds that venue's database, so a person id leads straight to a name |

So treat reports as personal data unless and until these are met. The public GitHub issue, which
carries only stack, version and error code, is the part most likely to qualify, provided the stack
carries no values.

### Q57-3. What the venue's notice must say: ANSWERED

**Name Waitron as a recipient.** C-413/23 P para. 112: the duty to inform applied before the transfer
«con independencia de si tenían o no carácter de datos personales, desde el punto de vista de
Deloitte» [S11]. Para. 111: identifiability is judged «en el momento de la recogida de los datos y
desde el punto de vista del responsable del tratamiento» [S11]. The venue can identify its own staff,
so even a perfectly anonymous report leaves the venue with this duty. GDPR art. 13(1)(e) requires
recipients or categories of recipients. The guide's full-notice checklist should gain a line once
A1047 is built.

### Q57-4. The relay as described: DROP

The question asks about a relay carrying encrypted panel traffic. A951 retires it. Two things make the
question unnecessary even so:

- Cloud's draft contract already lists "remote transport" as a service purpose, and its register has
  `venue-remote-transport` as "Proposed processor, subject to Q57"
  (`waitron-cloud/docs/cloud-processing-annexes.md`, `cloud-data-processing-register.md`). These drafts are
  unsigned. Remote access needs a Cloud account, so a contract will exist regardless, and adding
  transport to it costs nothing.
- EDPB 07/2020's hosting example makes the art. 28 contract the safe side: a host storing "encrypted
  data" that it does not look into is still "a processor" and "a data processing agreement according
  to Article 28 must be concluded" [S29]. Its telecoms example points the other way for pure transit: a
  provider whose "sole purpose and role" is transmission is not controller of the content [S29]. That
  example says nothing on whether such a provider is a processor, so the two do not actually conflict.

### Q57-5. Roles in the replacement: NARROWED

The A951 design separates two paths (`docs/superpowers/specs/2026-10-22-a951-box-public-access-design.md`):

- **Staff:** TLS passes through Cloud and ends at the box. Cloud «cannot inspect staff HTTP content»
  but «still sees hostname, IP and connection metadata».
- **Customers:** TLS ends at Cloud, which «can see public request and response plaintext in memory
  for filtering, including booking contact details and order details».

**Proposed answer:** processor for both paths' content. Controller of its own security and traffic
records, following the EDPB's telecoms example ("traffic and billing data") [S29]. The customer path
is plainly processing, with no room to argue it is mere transit. The A951 design leaves the metadata's
retention to A980 and D101. **Tell lane D**: Cloud's documents point at Q57 for this, so if Q57 changes,
D101's lawyer question 4 must change with it.

## Q58: recording staff actions at the till {#q58}

**What is built.** Who rang a sale, who authorised a void, refund or drawer opening; `order_amendments`
records changes; `time_entries.captured_by_device_id` records the clock-in device. Most of this cannot
be changed. No location, video or sound.

### Q58-1. Is it a control measure? NARROWED

**Proposed answer: yes, under ET art. 20.3, with no consent needed.** It answers "who did this",
which is checking that duties are met. The AEPD: «El consentimiento de la persona trabajadora no es
necesario», and the rules on proportion, information and limited use «se extienden también a cualquier
otro medio de control que suponga tratamiento de datos personales» [S6]. So the choice in the question
is not either/or: art. 20.3 is the employer's power, and art. 64.5(f) is the representatives' right
when such a system is brought in. Both can apply. The AEPD does not mention tills, hence a confirmation.

### Q58-2. Are there representatives? VENUE

ET art. 62.1: delegates for over ten and under fifty staff; for six to ten only if the staff so decide
by majority [S4]. Below six there are none, and arts. 64.5 and 87.3's participation have nobody to
apply to. Most venues in Waitron's market may fall here. Ask the owner.

### Q58-3. If there are representatives: NARROWED

**Proposed answer: treat it as covered.** Art. 64.5(f) gives a right to report «con carácter previo»
on «La implantación y revisión de sistemas de organización y control del trabajo» [S4]. Art. 62.2 gives
delegates the same powers. Art. 64.6 sets a maximum of fifteen days. The text gives a right to report, not
a veto. Asking costs a note and two weeks; not asking risks a dispute. Whether a till's log is such a
"system" is a question of labour case law, which I did not research.

### Q58-4. Does art. 87.3 reach a shared till? NARROWED

**Proposed answer: treat it as covered; a one-page rule is cheaper than the question.** The article
covers «los dispositivos digitales puestos a su disposición por su empleador» and requires «criterios
de utilización» in whose drafting «deberán participar los representantes de los trabajadores», and
staff must be told of them [S2]. A shared till is literally such a device, though the article's concern
is privacy in private use, which a till hardly has. A short rule (work use only; what is recorded; who
can see it) satisfies it. The owner could ship that as a guide template.

### Q58-5. Is the staff notice enough? NARROWED

**Proposed answer: yes, if given before the system is used and complete.** The AEPD says the employer
«Debe informar a las personas trabajadoras sobre la finalidad del tratamiento de datos, y por tanto
sobre la existencia y propósito de la medida de control» [S6]. The special prior-notice wording of the
LOPDGDD appears for cameras (art. 89.1) and location tracking (art. 90.2), not for ordinary records.

**Template gap, fixable now.** The guide's staff notice names sales, voids, refunds and the drawer. It
does not name order changes or the device used to clock in, both of which Q58 says are recorded.

## Q59: a privacy line on receipts and invoices {#q59}

**What is built.** The email with a full invoice carries the notice (S1b2). The footer, up to 200
characters per language and per department, prints on receipts and, per the guide, on the A4 and PDF
invoice. The PDF is rendered from the same `ReceiptDocumentInput`, which I read but did not run. **The
design's §4.1.1 statement that the PDF has no footer is out of date.**

### Q59-1. Ticket with no customer data: ANSWERED

**No notice and no line.** Art. 13(1) applies when data «se obtengan». A ticket that collects nothing
starts no duty.

Two things sit beside the ticket and are not caught by that answer. A card payment leaves the card
scheme, last four digits and references in the box, and a table name, often a surname, prints on
receipts. Neither needs a line on the ticket, but both belong in the full notice, and a sign at the
till covers them.

Keep to what is needed. The AEPD fined a restaurant €2,000, reduced to €1,600 on voluntary payment,
for making a customer give her phone number to get an invoice, under art. 5.1(c), data minimisation
(PS/00632/2021) [S16]. That resolution answered 503 in October and was retrieved today.

### Q59-2. Short notice, then sign or link: NARROWED

**Proposed answer: enough, if staff show or say the short notice before taking the details, and the
full notice is a sign or link they can reach at once.**

- LOPDGDD art. 11 allows «la información básica» plus «una dirección electrónica u otro medio» [S2].
- The AEPD's guide places the first layer «en el mismo momento y en el mismo medio en que se recojan
  los datos», and allows the second as information «en carteles, paneles, trípticos» of which a copy
  can be asked for [S15].
- WP260 para. 38 says the layered approach works in person [S34].
- Informe 0029/2011 accepted a sign, under the old law [S26].

Note the AEPD's duty-to-inform guide predates May 2018 and carries an "EN REVISIÓN" watermark, as the
biometrics guide does. The email reaches the customer afterwards, so it cannot be the first layer; the
guide already says this.

### Q59-3. Must a line appear on the invoice or PDF? ANSWERED

**No, if the information was given when the details were taken.** Art. 13(4) lifts the duty where the
person already has the information. RD 1619/2012 arts. 6.1 and 7.1 allow «cualesquiera otras
menciones» [S3], and no text I read requires one. A vendor's claim that one is required cites no
provision (design §4.1.1). It is a convenience, and the owner's own doubt was right.

### Q59-4. Invoice to a company: ANSWERED

**No notice for the company's own data.** Recital 14 excludes «datos personales relativos a personas
jurídicas» [S1]. A named contact at the company is a person, and a sole trader always is.

### Q59-5. The short text: NARROWED

**Proposed text**, already in the guide and within the footer's 200 characters once filled in:

> **Protección de datos.** *[Razón social]* usa tu nombre, NIF y domicilio para emitir tu factura.
> Derechos y más información: *[dirección de la página]*.

The adviser says yes or corrects the wording. The first-layer law asks for identity, purpose and rights
(LOPDGDD art. 11.2), which this has.

## Q62: the continuous copy {#q62}

### Is this really a question for this venue?

**Mostly not.** It mixes a settled legal point, a product decision and a future risk judgement.

- A venue cannot encrypt the copy, and Waitron decides that. A venue's adviser can say nothing that
  changes it.
- Art. 32 has no general answer. The CJEU: appropriateness is assessed «en cada caso concreto» and the
  controller bears the burden of proof (C-340/21) [S9c]. A specialist cannot rule without knowing the
  provider, the keys and the venue.
- The AEPD has already said what it expects from small businesses, in a guide published on 18 November
  2025 [S27, S27a]. So the honest position is not "unknown"; it is "known, and A1324 departs from it".

### Q62-1. Is encryption legally mandatory? ANSWERED

**No fixed rule.** Art. 32(1)(a) lists encryption "en su caso". In PS/00084/2022 the AEPD accepted that
art. 32 «no establece medidas de seguridad concretas y estáticas», and that it is for the controller
to decide [S17a]. It still fined €55,000 under art. 32, and €90,000 under art. 5.1(f), over an
unencrypted stolen USB stick, calling protection «una medida básica, accesible y de implantación
sencilla». A leak alone does not prove inadequate measures (C-340/21) [S9c].

### Q62-2. Is relying on the provider's encryption adequate? DROP

Drop it as a paid question. What follows is the answer as far as one exists.

The AEPD's Guide, case D, is Q62's facts: «Tiene una copia de seguridad almacenada en servicios de
terceros que no se encuentra cifrada» [S27]. It says:

- «Cuando se contrata un servicio en la nube, hay que asegurarse que el proveedor mantiene los datos
  almacenados cifrados».
- «Implementar un cifrado previo de los archivos y utilizar plataformas con cifrado de extremo a
  extremo garantizaría que solo las partes autorizadas accedan a la información».
- Backups «deben protegerse con el mismo nivel de seguridad que los datos originales tanto si se
  almacenan localmente como en la nube».
- «El cifrado de las copias de seguridad es una medida fundamental».
- Use two-step sign-in, «monitorear la actividad en la nube», and restrict access.

A guide is not law, and a venue with good reasons may differ, but the venue would have to prove those
reasons (C-340/21), for a design it cannot change. Provider encryption alone is the weaker of the
guide's options, and A980 O8 means nobody checks even that.

**Four facts for the owner to weigh on A1324.** It is the owner's decision, and these do not make it
wrong, but each premise deserves a second look.

1. **"Litestream 0.5.17 has no encryption" is only half right.** Litestream's current documentation:
   "Age client-side encryption is unsupported in v0.5.x", and client-side encryption "is expected to be
   re-implemented directly in LTX". But "Server-side encryption remains available for S3 replicas",
   through customer-supplied keys (SSE-C) and SSE-KMS [S38]. With a customer-supplied key, holding the
   bucket login alone should not read the objects, which is the case A1324 says encryption would help.
   I read this in the documentation and did not test it on the 0.5.17 binary. Amazon reportedly turned
   SSE-C off by default on new buckets from April 2026 (search summary only), and other providers
   differ.
2. **The box already holds a key beside the bucket secret.** The recovery key encrypts scheduled
   backups, and the box keeps it. So a key sitting on the box has not stopped encryption elsewhere in
   the product.
3. **Not every provider encrypts by default.** Amazon S3 has since January 2023 [S39] and Cloudflare R2
   does [S40], but Backblaze B2's encryption is a bucket setting to enable [S41]. The AEPD says to make
   sure. O8 chose not to check, and the guide tells venues only to ask where data is kept.
4. **A1324's point that the disk is not encrypted either is due to change.** B3 plans an encrypted disk. Once it lands,
   the bucket copy is less protected than the original, which runs against the AEPD's "same level"
   wording.

**Cheaper measures that need no key at all,** for the guide: a bucket login that reaches only that
bucket, two-step sign-in on the provider account, and leaving public access blocked, which is Amazon's
default for new buckets [S42]. These address the two cases A1324 names. The AEPD lists both restricted
access and two-step sign-in.

### Q62-3. Would the people affected have to be told? ANSWERED

**The question has the logic backwards.** The duty to tell comes from art. 34(1): a breach likely to
cause high risk. Art. 34(3)(a) only lifts it. So a missing exception creates no duty. Three steps:

1. **Always:** record the breach (art. 33(5)), and notify the AEPD within 72 hours unless risk is
   unlikely (art. 33(1)).
2. **Is high risk likely?** Decide on the day, with Comunica-Brecha [S22]. For a full copy holding
   health notes, tax numbers and pay, the answer will usually be yes: the EDPB says breaches "involving
   health data, identity documents, or financial data" can cause harm on their own [S43].
3. **If so, does art. 34(3)(a) help?** It depends on the path, and that explains why the sources seem to
   conflict:

| How the copy leaked | Is the data readable to the intruder? | Exception (a)? |
| --- | --- | --- |
| Stolen bucket login | Yes: the provider decrypts for valid credentials [S39] | No |
| Bucket made public | Yes, for provider-managed keys: Amazon "decrypts it for you when you access it" [S39] | No |
| Provider's disks stolen | No, if the provider's encryption held and its keys did not leak | Possibly |
| Copy encrypted under a key the box holds (not today), bucket login stolen, box safe | No | Possibly |

EDPB 9/2022 para. 76: data are unintelligible only if "the key was not compromised" [S43]. The AEPD's
breach guide says the same [S44]. Art. 34(3)(b) and (c) remain open in any case. The guide's breach
section already says all this correctly.

### Q62-4. VENUE

Which provider and region, whether encryption is on, whether the login is limited, and whether two-step
sign-in is on. These go in the venue's own risk analysis (Q54-3).

## L3: clocking in without biometrics {#l3}

**What is built.** A person signs in on the till with a PIN and then presses Clock in. I found no staff
card for clocking in (searched `apps/till`, `packages/workforce`, `packages/identity`). The word
"fingerprint" in `packages/workforce/src/schema/attendance.ts` is a sync marker beside a cursor, not
a biometric.
Passkeys on the dashboard use `userVerification: "required"`, so a person's own phone may use a
fingerprint locally. Waitron never receives it, and passkeys are not on the till's sign-in.

### L3-1. Does anything at this venue require more? VENUE

No law does. The AEPD: «El derecho a la protección de datos no limita las opciones de una empresa en
relación con el sistema de registro horario, aunque es recomendable que se adopte el sistema menos
invasivo posible» [S6]. The planned digital working-time rule has not reached the BOE, according to
secondary sources from October 2026, and those say nothing of biometrics. Only a clause in the
collective agreement or a client's requirement could raise the question.

### L3-2. Could biometrics be justified at all? ANSWERED

**On the AEPD's published reading, not today.**

- Art. 9(2)(b) needs a law that specifically allows it. The AEPD: the controller «debe contar con una
  norma con rango de ley que concrete la posibilidad de utilizar datos biométricos para dicha
  finalidad, que no se encuentra en la actual normativa legal española» [S45].
- «el consentimiento no puede levantar la prohibición del tratamiento» for clocking in, because of the
  imbalance between employer and employee [S45].
- It is always high risk, and the controller must show why cards, codes and the like will not do [S45].

**Two sources seem to contradict.** The labour guide, updated December 2025, still has a biometrics
passage that cites ET art. 20.3 and recommends verification systems [S6]. The 2023 biometrics guide
says expressly «Esto obliga a reconsiderar la interpretación realizada por esta AEPD» in that chapter
[S45]. The two are about different stages, and the later-dated document does not repeat the 2023
reasoning. Both agree on high risk and on a DPIA. The 2023 guide also bears an "EN REVISIÓN"
watermark, whose meaning the AEPD does not explain in the document. The safe course is the same under
either: no biometrics. Older press reports of fines exist; I did not read those resolutions.

### L3-3. Scope of a DPIA: DROP

Hypothetical, as Waitron does not propose biometrics. For the record: criteria 4, 5 and 10 of the AEPD's
list are met, so a DPIA is required before starting, including the three-part test of suitability,
necessity and proportion, with art. 36 consultation if high risk remains [S45]. And it would not solve
the real problem: «una gestión del riesgo para los derechos y libertades no resuelve la inexistencia de
una circunstancia de levantamiento de la prohibición» [S45].

## Law in motion {#law-in-motion}

None of this is law today, and the GDPR applies unchanged.

| Item | Status | Touches | Evidence |
| --- | --- | --- | --- |
| Digital Omnibus (GDPR changes) | Council agreed a negotiating position on 21 October 2026; Parliament has not; talks not begun. Secondary sources report a 96-hour breach deadline and a high-risk threshold for notifying the authority, and that the Council kept the current definition of personal data | Q62-3, Q57-2 | Council press release page found by search; it refused direct download (403). Treat the detail as unverified |
| Record of processing exemption (May 2025 proposal, under 750 staff) | Proposal; status not established | Q54-4 | Secondary only. As reported it keeps an exception for high-risk processing, which allergy notes may be |
| EDPB anonymisation guidelines 02/2026 | Adopted for consultation 7 July 2026 | Q57-2 | Downloaded [S33] |
| EDPB pseudonymisation guidelines 01/2025 | Consultation version; final not found | Q57-2 | Downloaded [S32] |
| Mandatory digital working-time record | Not in the BOE per secondary sources | L3 | Secondary only |

## What the owner can do without any adviser

1. Correct the Spanish batch ([list above](#what-to-send)).
2. Decide whether A1324 stands, with the four facts above in view.
3. Add a blocking step to S9, S11 and A664's removal, or hold them for the Q55-1 answer.
4. Guide changes: state that the record of processing is required; add a walk-in allergy notice; add
   order changes and the clock-in device to the staff notice; add a bucket-login and two-step note to
   the backups advice; add Waitron as a recipient once A1047 is built.
5. Tell lane D about Q57-4 and Q57-5, since Cloud's register and D101 question 4 rely on Q57.
6. Correct design §4.1.1 (PDF footer) and the A664 wording on "inaccessible" copies at their next edit.

## What could not be verified

- **Council press release** on the Digital Omnibus: 403 by curl and by the fetch tool. Status comes from
  search summaries.
- **Facilita and INFORMA_RGPD were not used**: reading their pages only, as this pass contacts nobody.
- **Negative findings are limited to my searches**: no AEPD text on adult diners' allergies, on a
  delay in backups, or an exception actually set under art. 32.5. Absence here is not proof.
- **The AEPD's 2016 canteen report** applies the repealed law. **Informe 0029/2011** likewise.
- **C-667/21** concerns art. 9(2)(h), and **C-413/23 P** concerns Regulation 2018/1725. I apply both by
  analogy.
- **Litestream SSE support** is from its documentation for the current 0.5.x line, not a test on 0.5.17.
  The AWS SSE-C change is from a search summary.
- **PS/00267/2021** and recent biometrics fines were seen only in search summaries.
- **The "EN REVISIÓN" watermark** on the biometrics and duty-to-inform guides: I do not know what the AEPD
  has under review.
- **I did not audit every append-only table** for free text (Q48-9), and did not run the PDF to see the
  footer (Q59).
- **Labour case law** on ET art. 64.5(f) was not researched.
- **Spanish legal texts** are BOE consolidated versions, which the BOE says have no legal value. GDPR
  articles are from the EU's consolidated Spanish text, which the EU also says has no legal effect, and
  recitals from the BOE's copy of the Official Journal text. The EDPB 07/2020 quotes are English; no
  official Spanish version was checked.
- **My proposed answers are research, not advice.** Every NARROWED row is a proposal until a professional
  says yes.

## Sources

All retrieved on 2026-11-06. Downloads were kept outside the repository; a hash is the first 12
characters of the raw file's SHA-256, so a later check can tell if a page has changed.

| ID | Source | URL | SHA-256 (12) |
| --- | --- | --- | --- |
| S1 | GDPR, Spanish: EU consolidated text (articles; includes corrigenda) and the BOE's copy of the Official Journal text (recitals) | [publications.europa.eu](https://publications.europa.eu/resource/celex/02016R0679-20160504) · [www.boe.es](https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807) | `a23521b339f2` |
| S2 | LOPDGDD, Ley Orgánica 3/2018, consolidated | [www.boe.es](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673) | `b5826f45a1f9` |
| S3 | RD 1619/2012, invoicing regulation, consolidated | [www.boe.es](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696) | `0dfe3d2f90f7` |
| S4 | Estatuto de los Trabajadores, consolidated | [www.boe.es](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430) | `18c617fd063e` |
| S5 | AEPD Gabinete Jurídico, Informe 0148/2019, retention guide | [www.aepd.es](https://www.aepd.es/documento/2019-0148.pdf) | `aa1af6a87f10` |
| S6 | AEPD, La protección de datos en las relaciones laborales, updated December 2025 | [www.aepd.es](https://www.aepd.es/guias/la-proteccion-de-datos-en-las-relaciones-laborales.pdf) | `c1739f008b18` |
| S7 | AEPD, reposition appeal on TD/00129/2021 | [www.aepd.es](https://www.aepd.es/documento/reposicion-td-00129-2021.pdf) | `e21ae043383c` |
| S8 | AEPD, PD/00073/2026, rights procedure | [www.aepd.es](https://www.aepd.es/documento/pd-00073-2026.pdf) | `edaf8329e295` |
| S9a | CJEU C-101/01 Lindqvist | [publications.europa.eu](https://publications.europa.eu/resource/celex/62001CJ0101) | `35d2c426a527` |
| S9b | CJEU C-21/23 Lindenapotheke | [publications.europa.eu](https://publications.europa.eu/resource/celex/62023CJ0021) | `6a19ddecb773` |
| S9c | CJEU C-340/21 Natsionalna agentsia za prihodite | [publications.europa.eu](https://publications.europa.eu/resource/celex/62021CJ0340) | `64ecd64ed503` |
| S10 | CJEU C-667/21 ZQ v Medizinischer Dienst | [publications.europa.eu](https://publications.europa.eu/resource/celex/62021CJ0667) | `7a5d631ee865` |
| S11 | CJEU C-413/23 P EDPS v SRB, 4 September 2025 | [publications.europa.eu](https://publications.europa.eu/resource/celex/62023CJ0413) | `f8f0b271fa4a` |
| S12 | Regulation (EU) 1169/2011, food information | [publications.europa.eu](https://publications.europa.eu/resource/celex/32011R1169) | `52fd07339e05` |
| S13 | RD 126/2015, non-prepacked food information, consolidated | [www.boe.es](https://www.boe.es/buscar/act.php?id=BOE-A-2015-2293) | `54b39fd245c4` |
| S14 | AEPD Gabinete Jurídico, report 2016-0059, school canteens (old law) | [www.aepd.es](https://www.aepd.es/documento/2016-0059.pdf) | `f814f8ff8d4e` |
| S15 | AEPD, Guía para el cumplimiento del deber de informar ("EN REVISIÓN") | [www.aepd.es](https://www.aepd.es/guias/guia-modelo-clausula-informativa.pdf) | `f4ac5c342f8d` |
| S16 | AEPD, PS/00632/2021, restaurant and phone number | [www.aepd.es](https://www.aepd.es/documento/ps-00632-2021.pdf) | `d0b78b7d9f0b` |
| S17 | Article 29 Working Party, WP243 rev.01 on DPOs, Spanish | [www.aepd.es](https://www.aepd.es/documento/wp243rev01-es.pdf) | `0bd1630ece92` |
| S17a | AEPD, PS/00084/2022, unencrypted USB | [www.aepd.es](https://www.aepd.es/documento/ps-00084-2022.pdf) | `6ea151847f77` |
| S18 | AEPD, list of processing needing no DPIA (art. 35.5) | [www.aepd.es](https://www.aepd.es/documento/listasdpia-35.5l.pdf) | `3590d77a8c64` |
| S19 | AEPD, list of processing needing a DPIA (art. 35.4) | [www.aepd.es](https://www.aepd.es/documento/listas-dpia-es-35-4.pdf) | `06d0386e20f2` |
| S20 | Article 29 Working Party, WP248 rev.01 on DPIAs, Spanish | [www.aepd.es](https://www.aepd.es/documento/wp248rev01-es.pdf) | `ea4722726fd9` |
| S21 | AEPD, Facilita RGPD page | [www.aepd.es](https://www.aepd.es/guias-y-herramientas/herramientas/facilita-rgpd) | `705bd2c30777` |
| S22 | AEPD, Comunica-Brecha RGPD page | [www.aepd.es](https://www.aepd.es/guias-y-herramientas/herramientas/comunica-brecha-rgpd) | `c8ca798903a8` |
| S23 | AEPD, Evalúa Riesgo RGPD page | [www.aepd.es](https://www.aepd.es/guias-y-herramientas/herramientas/evalua-riesgo-rgpd) | `dd6c12967f95` |
| S24 | AEPD Instrucción 1/2021 on its advisory function, consolidated | [www.boe.es](https://www.boe.es/buscar/pdf/2021/BOE-A-2021-18134-consolidado.pdf) | `ef6a2fd3d996` |
| S25 | AEPD, INFORMA_RGPD page | [www.aepd.es](https://www.aepd.es/derechos-y-deberes/cumple-tus-deberes/directrices-de-aplicacion/pymes/informa-rgpd) | `68474051248e` |
| S26 | AEPD Gabinete Jurídico, Informe 0029/2011 (old law) | [www.aepd.es](https://www.aepd.es/documento/2011-0029.pdf) | `af13281b90a9` |
| S27 | AEPD, Guía de cifrado para autónomos y pymes, November 2025 | [www.aepd.es](https://www.aepd.es/guias/guia-cifrado-autonomos-pymes.pdf) | `b0e3fb688af4` |
| S27a | AEPD press note on that guide, 18 November 2025 | [www.aepd.es](https://www.aepd.es/prensa-y-comunicacion/notas-de-prensa/la-agencia-publica-guia-ayudar-a-autonomos-y-pymes) | `ab66f85198a7` |
| S28 | EDPB, Coordinated Enforcement report on the right to erasure, 2026 | [www.edpb.europa.eu](https://www.edpb.europa.eu/system/files/2026-02/edpb_cef-report_2025_right-to-erasure_en.pdf) | `5227b3e2a1d9` |
| S29 | EDPB Guidelines 07/2020, controller and processor, v2.1 | [www.edpb.europa.eu](https://www.edpb.europa.eu/system/files/2023-10/edpb_guidelines_202007_controllerprocessor_final_en.pdf) | `f47d0428ebfa` |
| S30 | EDPB Guidelines 05/2020, consent | [www.edpb.europa.eu](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf) | `d45afa0c7f06` |
| S31 | EDPB Guidelines 02/2025, blockchain, final v2.0, 7 July 2026 | [www.edpb.europa.eu](https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_202502_blockchain_v2_en.pdf) | `e90cc80ef9ba` |
| S32 | EDPB Guidelines 01/2025, pseudonymisation, consultation version | [www.edpb.europa.eu](https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf) | `db1b9931b340` |
| S33 | EDPB Guidelines 02/2026, anonymisation, consultation version | [www.edpb.europa.eu](https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_202602_anonymisation_v1_en_0.pdf) | `75c68c5551e5` |
| S34 | Article 29 Working Party, WP260 rev.01 on transparency | [ec.europa.eu](https://ec.europa.eu/newsroom/article29/redirection/document/51025) | `e026fbc21b2c` |
| S35 | Código Civil, consolidated | [www.boe.es](https://www.boe.es/buscar/act.php?id=BOE-A-1889-4763) | `12c4b39c1d56` |
| S36 | Código de Comercio, consolidated | [www.boe.es](https://www.boe.es/buscar/act.php?id=BOE-A-1885-6627) | `92e2ae946449` |
| S37 | TRLGDCU, consumer law, consolidated | [www.boe.es](https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555) | `04b15d5f4e19` |
| S38 | Litestream configuration reference; v0.5.17 release record | [litestream.io](https://litestream.io/reference/config/) · [api.github.com](https://api.github.com/repos/benbjohnson/litestream/releases/tags/v0.5.17) | `d67811360c96` |
| S39 | Amazon S3 default encryption FAQ and server-side encryption page | [docs.aws.amazon.com](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-encryption-faq.html) · [docs.aws.amazon.com](https://docs.aws.amazon.com/AmazonS3/latest/userguide/serv-side-encryption.html) | `82cf66371295` |
| S40 | Cloudflare R2 data security | [developers.cloudflare.com](https://developers.cloudflare.com/r2/reference/data-security/) | `40cdb082ad86` |
| S41 | Backblaze B2 server-side encryption | [www.backblaze.com](https://www.backblaze.com/docs/cloud-storage-server-side-encryption) | `0b46923e584a` |
| S42 | Amazon S3 Block Public Access | [docs.aws.amazon.com](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html) | `155175220c6e` |
| S43 | EDPB Guidelines 9/2022, breach notification, v2.0 | [www.edpb.europa.eu](https://www.edpb.europa.eu/system/files/2023-04/edpb_guidelines_202209_personal_data_breach_notification_v2.0_en.pdf) | `063f63d2b78a` |
| S44 | AEPD, Guía para la notificación de brechas, June 2021 | [www.aepd.es](https://www.aepd.es/guias/guia-brechas-seguridad.pdf) | `d79b0335b490` |
| S45 | AEPD, Guía sobre tratamientos de control de presencia mediante sistemas biométricos, November 2023 ("EN REVISIÓN") | [www.aepd.es](https://www.aepd.es/guias/guia-control-presencia-biometrico.pdf) | `bc549fe95eea` |

**Search results only, not downloaded or not read in full:** Council of the EU press release of
21 October 2026 (403); AEPD PS/00267/2021; press reports of fines for fingerprint clocking; secondary
sources on the digital working-time decree and on the May 2025 art. 30(5) proposal; the AWS notice on
SSE-C defaults.

**Repository and Cloud documents read:** `docs/compliance/2026-11-05-consultas-para-asesores.md`,
`docs/compliance/asesor-questions.md`, `docs/compliance/asesor-laboral-questions.md`,
`docs/superpowers/specs/2026-10-22-a980-data-protection-design.md`,
`docs/compliance/research/2026-10-16-a664-retention.md`, `apps/server/src/guide/en/data-protection.md`,
`docs/backlog/data-protection.md`, `docs/backlog/alerts.md`, `docs/backlog/replication-cloud.md`,
`docs/superpowers/specs/2026-10-22-a951-box-public-access-design.md`, the A982 and A951 plans, and
`waitron-cloud/docs/cloud-processing-annexes.md` and `cloud-data-processing-register.md`, with the code
files named above. Repository state read: `main` at about `b18125ece`.
