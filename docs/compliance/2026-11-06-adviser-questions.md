# Adviser questions: the curated list

6 November 2026. **This English text is the base version.** It replaces the Spanish
[batch of 5 November](2026-11-05-consultas-para-asesores.md), which must not be sent. Once the owner
approves this list, the Spanish is rebuilt from it. Nothing has been sent to anyone.

The method was the one used for the shortened list of 9 October. Each of the 25 questions was split
into its separate points, checked against what is built and decided today, then researched in free
primary sources. Every Spanish quotation was checked by script against the downloaded text. The
reports and their sources: [clock](research/2026-11-06-adviser-clock.md),
[tips and declaration](research/2026-11-06-adviser-tips-and-declaration.md),
[labour](research/2026-11-06-adviser-labour.md), [privacy](research/2026-11-06-adviser-privacy.md),
[online access](research/2026-11-06-adviser-online-access.md).

This is research, not legal advice. The limits are at the end.

## The result

| Adviser | Questions in the batch | Real judgement left | Hours (our estimate) |
| --- | --- | --- | --- |
| Tax and accounting | 8 | 1 point, plus confirmations | 1 to 2 |
| Labour or gestoría | 7 | 2 points, plus confirmations | 1 to 2 |
| Privacy specialist | 9 | 1 point, plus confirmations | 2 to 3 |
| Consumer law | 1 | None: removed | 0 |

So about 4 to 7 hours rather than about 25. At the tax adviser's €300 an hour that is €1,200 to
€2,100 rather than about €7,500. The hours are our estimate, and the other two advisers' rates are
unknown.

A **confirmation** below gives our answer and asks only for a yes or a correction.

## The owner's decisions

**1. A1324: the bucket copy needs a second look.** The owner accepted it on 6 November on advice that
was partly wrong. Litestream 0.5.17 does accept a customer-supplied key: its source has
`sse-customer-key` and `sse-customer-key-path`. Nobody has run this. The storage provider encrypts
with that key on each request, so a stolen bucket login alone should not read the copy. There are
catches. Since April 2026
[Amazon blocks these keys on new buckets by default](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-s3-c-encryption-setting-faq.html),
so setup would have to unblock them, and other providers differ. Also, the AEPD's guide for small
businesses (November 2025) has a case with these facts and calls encrypting backups «una medida
fundamental». It says backups need «el mismo nivel de seguridad que los datos originales». B3 will
encrypt the box's disk, which would leave the bucket copy as the weaker one. **Tested on real Amazon S3 on 6 November:** the
bucket login alone was refused, a wrong key was refused, and the right key restored every row
([receipt](../receipts/a1324/README.md)). The local test server ignores these keys, so only Amazon
could show this. It was one short run on Amazon only, not through Waitron's own code. The proposal is
to derive the key from the recovery key the box already keeps, so there is no new secret to hold, and
where a provider refuses, the box says so. The owner approved building it (A1404).

**2. The stop on payments stays (owner, 2026-11-06).** The law does not require it: article 3 of Orden
HAC/1177/2024 switches off the one-minute rule for Veri\*Factu systems, and AEAT's FAQ says so. The
owner keeps it, because a wrong clock means corrective invoices. The clock must be right before
payments restart, which is how it is built: a confirmation counts only if it agrees with the box's
clock to within a minute. The advisers are told this is a choice.

**2b. What the box does when its clock is wrong (owner, 2026-11-06).**

- Setting the clock from an accepted source counts as confirming it, so trading carries on. Records dated
  in the future beyond the margin are flagged for correction, and only a wrong date needs one.
- AEAT refusing the latest record as too far in the future stops trading until the clock is reset.
- Any accepted source showing the clock outside the margin stops trading until it is corrected.
- A start with no internet, and a latest record in the future beyond the margin, needs the time
  confirmed before trading.

Being unable to reach AEAT never stops trading. The margin is one minute. A box whose time service says it is in
sync raises an alert rather than stopping when AEAT disagrees.

**3. Tips are held (owner, 2026-11-06).** T9 and T10 below stay out of what is sent until A793 is
revived.

**4. The producer's tax number is public, and stays out of the repository (owner, 2026-11-06).** It
reaches the release as a repository secret. This refines the owner's answer of 4 November, which
named a repository variable. An earlier draft of this list called this an open conflict: the research
had read a rule the owner withdrew on 4 November.

**5. Deleting a person's data blocks it first (owner, 2026-11-06, A1405).** The AEPD's legal office (report 0148/2019) says
real erasure means setting the data aside first, then destroying it. A980's S9 (erasing a booking guest) and S11 (clearing a former employee's
email) just clear the field, and A664's removal has the same gap. The owner chose real blocking inside the
database, which waits for A760.

**6. A corrective reaches the customer only if we know who they are (owner, 2026-11-06).** Most
customers are unknown, so all the restaurant can do is correct what it filed. T1 asks the adviser to
confirm this.

**7. Cloud gives the tax office a way in; other venues need their own (owner, 2026-11-06).** Waitron
Cloud is to let customers give AEAT access through Waitron's servers. That does not help a venue
without Cloud. See [how a venue gives the tax office access](#how-a-venue-gives-the-tax-office-access).

## For the tax and accounting adviser

### The question that needs judgement

- **T2. Proving the real date.** When the box and its evidence cannot show the real time of a sale, what
  is enough to fix its date? The box usually can show it: the boot-time clock gives the size of the
  error within one run, and a card payment carries the provider's time. The hard case is a clock wrong
  across a restart with no internet, on a sale paid in cash. May the restaurant keep the stamped date
  if nothing shows it is wrong?

### Confirmations: clocks

- **T1.** When a wrong clock misdates tickets and the customer is unknown, the restaurant makes the
  corrective invoice, keeps it and files its record. It reaches a customer only where the restaurant
  knows who they are, and tickets are not cancelled and reissued. No source covers this.
- **T5.** A record may carry a time earlier than the previous record's when the new time is the exact
  one. The chain follows the order the records were made in, and nothing is marked.
- **T6.** If only the hour was wrong and the date is right, keeping a record of the incident is enough.
- **T7.** If the date is wrong, the remedy is a corrective invoice: R4 for a full invoice, R5 for a
  simplified one, with the real operation date and no VAT change (V1665-22, V0902-22). One corrective
  may cover many invoices. The VAT period follows the day VAT fell due, and a return already filed
  wrongly is fixed with a complementary return.
- **T8.** There is no duty or channel to tell AEAT.

### Confirmations: tips (hold, see decision 3)

- **T9.** Suggested tip percentages stay outside VAT if nothing is pre-selected and the guest can choose
  zero or any amount.
- **T10.** Card tips are booked as money owed to staff, not as income.

### Confirmations: records and the declaration

- **T4.** The words «acceso en línea» do not need the data on the internet. RD 1619/2012 articles 21.2
  and 23 are met by a copy on the venue's own box if, when the tax office asks during a check, it can without
  unjustified delay see every invoice, search it, copy or download it and print it. No permanent
  connection or public address is needed. Orden EHA/962/2007 article 5.3 covers «un sistema de
  almacenamiento local» and calls full access «una consulta en línea a los datos». DGT 0289-04 wants a
  network link only «en caso necesario», for a remote database. If AEAT asks from its own office, a copy
  of the period on a USB drive or by temporary download link is enough.
- **T11.** The document list in the research is complete. It adds each past software declaration,
  proof of payment for €1,000 or more kept five years, and pro formas.
- **T12.** Records still pending or refused are kept until settled, then on the common schedule.
- **T13.** The proposed archive meets the content rules, if it offers selective search, copying,
  printing and the invoice lines.
- **T14.** Our description for item d) of the declaration is sufficient after the five edits in the
  research. In short: remove the backup server sentence, list third-party parts as a present fact, say
  how the library is used, cover the print agent, and say what the terminals do.
- **T15.** Answer f), whether one installation serves several taxpayers, stays N while each hosted
  venue is its own installation.
- **T16.** If the producer becomes a company: new installation and new chain; nothing to tell AEAT; a
  new declaration; each restaurant keeps the old one. Moving between on-site and cloud keeps the same
  code with a new installation number.

## For the labour adviser or gestoría

The venue is in Barcelona. Its agreement is the interprovincial one for Barcelona, Girona and
Tarragona, 2025 to 2028 (DOGC 9630, code 79000275011992). If the venue's activity is described wrongly
here, the owner should say so.

### Questions that need judgement

- **L1. Do card tips paid through payroll attract social security contributions?** Our proposed answer
  is yes, reported under code 0001. No ruling or TGSS statement covers a restaurant. STS 692/2021 put
  casino tips in the base but said hospitality tips differ. The TGSS table has no code for tips and no
  way to report one as excluded. Please say so in writing.
- **L2. How is overtime counted under a yearly total?** The agreement sets 1,783 hours a year. Proposed:
  overtime is what exceeds the person's published calendar for that day or the nine-hour limit. It goes
  on that month's payroll or into rest within four months, and 1,783 is checked at year end as a
  backstop.

### Confirmations

- **L3.** When a server is replaced, one joined time record with separate integrity chains per server
  is enough, provided each person's day is reliably shown.
- **L4.** One monthly tip amount per person, on its own payslip line.
- **L5.** Cash handed straight to a waiter: no employer withholding, and the waiter declares it. Cash
  shared at the close: through payroll with withholding. A pot staff run themselves: like cash handed
  straight, if the business stays out of it.
- **L6.** With no agreement or custom, tips are shared among everyone who took part, kitchen and
  temporary staff included.
- **L7.** The proposed payroll fields (one row per person per pay item), final settlement data and
  extra contribution data in the research are right.
- **L8.** Absences that changed pay are kept with payroll, and the rest as rotas. Rotas are kept only as
  evidence. The employer's copy keeps name and tax or Social Security number.

## For the privacy specialist

### The question that needs judgement

- **P1. May a restaurant keep allergy notes after the meal as evidence?** If so, blocked, relying on GDPR
  article 9(2)(f) before any claim exists? For how long: one, three or five years? Does a food safety
  claim count as a liability under LOPDGDD article 32.2? Staff must answer an allergy question for
  every table before the first send, and the "who" field often holds a guest's name.

### Confirmations

- **P2.** Allergy notes during the meal rest on GDPR articles 6(1)(b) and 9(2)(a). A guest's spoken
  request, noted after a short explanation, is explicit consent.
- **P3.** The table of what to remove early is right. In short: print data soon after printing, the
  booking phone when the booking ends, and a guest's name reduced to the seat after the meal.
- **P4.** A backup delay of up to 30 days is acceptable with a list of erasures kept outside the
  database and replayed before a restore opens. Bucket keys are held by one named person. Today's
  defaults are 7 days for the bucket and 30 for scheduled backups, and the copies are not inaccessible.
- **P5.** A single restaurant needs a written risk analysis and a reasoned note on why no DPIA is
  needed (a DPIA is a formal impact assessment).
- **P6.** A former employee's email is kept one year on legitimate interest, then blocked. Sign-in details
  are deleted without blocking.
- **P7.** Where the law requires data to be kept, it comes off everyday screens and stays for that
  purpose only. The email an invoice went to is erased on request unless the invoice is disputed.
- **P8.** Waitron is a controller for fixing its own product and a processor for one venue's support. In
  the replacement for the remote-access relay it is a processor for transport and a controller for its
  own security records. Cloud's D101 lawyer question reuses this, so ask once.
- **P9.** Recording which employee voids, refunds or opens the drawer is a control measure under ET
  article 20.3 and needs no consent. Staff representatives, where they exist, get to report first. A
  one-page use rule covers the shared till under LOPDGDD article 87.3. A complete staff notice given
  first is enough.
- **P10.** The procedure and short text for collecting a customer's details on an invoice are right.

## How a venue gives the tax office access

**The law asks for the tax office to reach the documents when it asks, not for them to be on the
internet** ([research](research/2026-11-06-adviser-online-access.md)). T4 asks the adviser to confirm
this.

| Route | Suits | How | Watch for |
| --- | --- | --- | --- |
| Waitron Cloud | Cloud customers | AEAT reaches the data through Waitron's servers. Not built | If Cloud keeps a copy, Waitron is a third party, and the venue stays responsible |
| At the venue | Every venue; the default | A read-only sign-in on the box's own network: see, search, copy, print | Someone in charge must be able to open it |
| A copy of the period | Every venue, for a written request | Export the period in its original formats, on a USB drive or by download | Rests on T4 |
| A temporary link | A venue with its own storage account | Put the export there and share a link during the check | Use a Spanish region. The provider becomes a data processor |
| A third party keeps it | A venue whose gestoría offers this | Regular exports to the gestoría | The venue stays responsible |
| Paper | Rarely | Allowed by article 20.1, and the online rules then do not apply | Thermal paper fades, and emailed invoices stay electronic |

**Waitron cannot do the default routes yet.** The dashboard has no invoice list, the till's lookup finds
only full invoices with a named customer, up to 20, and nothing exports a period's invoices. Found by
reading the code. The proposal is one read-only page for the tax office and one period export, on the
box (A1411). Cloud can then show the same page, so a venue without Cloud gets the same capability.

## How a wrong clock is known, and what a late filing is

**A late filing is not a wrong clock.** A record's time is when it was made, and sending it after an
outage does not change that. AEAT's FAQ says the sending deadline extends through an outage, with
«no hay establecido un plazo máximo fijo», and that invoicing must carry on. The send carries
Incidencia = S, which Waitron sets. In AEAT's test service, records sent over five minutes late came
back accepted with warning 2004, and one sent six minutes late with Incidencia = S came back `Correcto`.
Warning 2004 needs no correction, and Waitron treats it that way. Production has not been tested.

**So AEAT's replies cannot show a wrong clock.** Warning 2004 looks the same for a late record and a
clock running ahead, and AEAT never sees a record made by a clock running behind as anything but late.
The only hard refusal is 1112, an issue date later than AEAT's date.

**How Waitron can know instead:**

| Signal | Built? | What it shows |
| --- | --- | --- |
| The box reads behind the newest record | Yes, this is the stop | The clock is behind, or an earlier record was ahead |
| AEAT's time, from its public QR page and from each reply | The page is read only during a stop or a check. Each filing reply gives a reading that shows only as a warning. Acting on it in normal trading is slice 9c | Whether the clock is right now |
| Tills' own clocks | Yes | Whether they agree with the box |
| The box's boot-time clock, which clock changes do not move | Used to work out when a stop began. Watching every change is slice 9c | The exact size of a change, within one run |

**What this means for the real time of a sale.** It is often knowable. Within one run, the boot-time
clock gives the error, so the real time is the stamped time less that error. Online sales would also
have AEAT's own receipt time within seconds of the sale, but Waitron does not keep it yet. A card
payment has the provider's time. It is really unknown only when the clock was wrong across a restart,
with no internet, on a cash sale (T2). The date is all that matters for tax, so only an error crossing
midnight needs a remedy.

## Answered by research: no need to ask

| Point | Answer | Source |
| --- | --- | --- |
| Tell people if the bucket copy leaks? (Q62) | That turns on high risk. Article 34(3)(a) only lifts the duty | GDPR art. 34 |
| Is encryption mandatory? (Q62) | No fixed rule, and the controller must prove its choice | GDPR art. 32; CJEU C-340/21 |
| Which documents, and from when | Six years from the last entry usually outlasts the four-year tax clock | Código de Comercio art. 30; LGT |
| What extends a period | Tax losses and deductions (10 years), VAT adjustment periods, disputes | Research |
| After closure or death | Heirs or liquidators hold the duty | Research |
| A share of tips kept by the restaurant | Taxable income, outside VAT while voluntary. The design keeps none | V1808-22, V5110-26 |
| Time record rules today | Start and end per person per day, kept four years, open to staff, representatives and the inspectorate. No remote access duty | ET arts. 34.9, 12.4.c, 35.5 |
| Is the digital time record decree law? | **No.** Not in the BOE up to 6 November 2026. Recheck on the day of sending | BOE scan |
| A record refused for a future date | Send the corrective at once, naming the refused invoice. The error then counts as solved. AEAT's test service took a credit note naming a refused invoice as `Correcto` ([run 37286368370](https://github.com/waitron-io/verifactu/actions/runs/37286368370), an R1, refused for another reason) | Developer FAQ §17, case 2.a |
| Agreement limits for Barcelona | 1,783 hours a year, two days' weekly rest, 20 paid minutes over five hours, nights 22:00 to 06:00 at +25%, no split-shift pay | DOGC 9630 |
| Overtime for part-timers | None outside emergencies. Extra hours are complementary hours, up to 50% | ET art. 12 |
| Final settlement | A proposed settlement goes with the notice | ET art. 49.2 |
| How long labour papers are kept | Time record 4, contribution papers 4, payslips 5. Six years covers them | Research |
| Hospitality contribution rates | None in the 2026 order | Orden PJC/297/2026 |
| A ticket with no customer data | No privacy line needed. One on an invoice is optional | GDPR art. 13 |
| Must a restaurant have a record of processing? | Yes. A DPO for one restaurant? No. Facilita for allergy notes? No | GDPR arts. 30, 37; AEPD |
| Biometric clock-in | Not justified on the AEPD's 2023 reading, and no law requires it | AEPD guide |

## Removed

- **A false time from a crafted request (T3).** The owner removed it on 6 November.
- **The consumer law question (Q50).** Nobody proposes a service charge, and the design forbids a
  mandatory one. If that changes: both specific bans are repealed, general consumer law still applies,
  and a charge would need express opt-in, which the restaurant must prove.
- **A default service amount (Q13(d)).** Nobody proposes it.
- **Q62 as a paid question.** A venue cannot change the design, so it is the owner's decision (1 above).
- **The biometrics assessment (L3).** Hypothetical.
- **The relay question (Q57).** A951 retires the relay. Its replacement is in P8.
- **The digital decree's calendar and format (L1).** Nothing is in force. The draft is kept as a watch
  list.
- **"Holiday still owed" (L5).** Not built. Waitron holds holiday taken.
- **Every start without internet (Q61).** Hypothetical until slice 9c is decided.

## Facts only the owner or gestoría know

These cost nothing, and the gestoría the venue already pays can answer most of them.

- Whether VAT is filed quarterly or monthly, who prepares the return, and which ledger account takes
  tips.
- Whether any misdated tickets went to identified businesses.
- Whether the venue has staff representatives, and whether the way time is recorded is written down.
- The establishment's pay group, A to E.
- Whether overtime is paid or rested at this workplace.
- The payroll program and its import template.
- Any existing custom for sharing tips. Changing one needs a formal procedure.
- Whether the venue has fixed-discontinuous staff and a tourism link, for the €262 a month bonus.
- The payment providers' contracts, and the storage provider, region and settings.
- Whether the venue has any reason to want biometrics.

## Free routes

- **AEAT's preproduction service** can show what happens to a record dated earlier than the previous
  one. It needs one run with the owner's approval, and it would settle
  part of T5 before paying anyone.
- **AEAT's general information line** can be asked about T8's "no duty to tell AEAT". It binds nobody.
- **The AEPD's free channel will not help.** Instrucción 1/2021 says it takes no questions from
  controllers, lawyers or consultants.
- **The DGT** answers software producers with binding effect, but it declines to judge a mechanism, so
  it suits T1 and the meaning of «acceso en línea» in T4. It is slow.

## Problems found in Waitron

Found by reading code and text, not by running it. None is fixed yet. They are in the backlog as
A1406, A1407 and A1408.

- **Barcelona time rules are wrong in the built defaults:** `convenio_config` has 36 hours' weekly rest
  rather than two days, and the paid break at six hours rather than five. It has no yearly-hours limit
  or split-shift rule.
- **A part-timer's extra hours show as overtime**, which is the wrong legal label.
- **A wrongly dated invoice needs R4 on a full invoice**, but `recordCorrection` handles only F2 to R5.
- **The VAT return sorts by issue date** (`computeVatReturn`), so a misdated sale lands in the wrong
  period in that report.
- **Three identical refusals hold the rest of a chain**, so a clock a day ahead could stop later filings.
- **Clocks running behind are not listed** for the owner, though they need the same remedy.
- **AEAT's receipt time is read but not kept.** Stored with each record, it would prove the real time
  of most sales. It needs a column, so it waits for A760.
- **Allergy wording is out of date:** the privacy guide and questions describe an allergy noted when
  mentioned. The till asks every table.
- **Masked logs are not anonymous**, and the venue's notice must name Waitron as a recipient once bug
  reports are built.
- **The privacy guide misses:** order changes and the clock-in device in the staff notice, a walk-in
  allergy notice, and the bucket login and two-step sign-in advice.
- **Older compliance notes need correcting:** `verifactu-findings.md` §4 and `verifactu-faq-notes.md`
  §17 leave out article 3, and two places call #2331 parked.

## Limits of this research

- The BOE texts read are the consolidated versions, which have no legal value of their own.
- Some court rulings were read through summaries or publishers' copies, not the courts' own database.
  STS 692/2021, the main new labour source, came from a publisher's copy. EUR-Lex downloads failed, so
  CJEU rulings rest on quotations already held or on other copies. Each report lists these.
- A "no rule found" means none in the sources read.
- AEAT's real behaviour on T5 is untested, and an R4 or R5 naming a refused invoice has not been tried. Error 1112 is known only from the published rules.
- Rulings after 30 September 2026 were not in the DGT database searched.
- The press reports a possible digital time record decree before the 29 November election, and a
  Veri\*Factu move to 2028. Neither is in the BOE. Recheck both on the day of sending.
- Assuming the venue in the local Square data is the first venue, it is in Barcelona.
