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

On 13 November T17 was added for the tax adviser, a second point of judgement. The figures above
were counted and estimated before it.

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

### The questions that need judgement

- **T2. Proving the real date.** When the box and its evidence cannot show the real time of a sale, what
  is enough to fix its date? The box usually can show it: the boot-time clock gives the size of the
  error within one run, and a card payment carries the provider's time. The hard case is a clock wrong
  across a restart with no internet, on a sale paid in cash. May the restaurant keep the stamped date
  if nothing shows it is wrong?
- **T17. One price for a takeaway or delivery set menu.** Added 13 November 2026; it extends S10 in
  the [question register](asesor-questions.md). Our reading, for you to confirm first: eaten at the
  venue and served by its staff, a set menu is one restaurant service at 10%, drinks included (LIVA
  91.Uno.2.2.º). Taken away or delivered, it is a supply of goods, and each part takes its own rate:
  food 10%, a sugared cola 21% (LIVA 91.Uno.1.1.º; DGT V2949-16). The same cola is 10% at the table
  and 21% to take away. [Sources](research/2026-11-13-takeaway-food-and-drink-vat.md).

  Example: a takeaway menu costs €12.00 with VAT, a burger and a sugared cola. Sold alone, the burger
  is €9.50 and the cola €3.00. Shared by those prices, the burger takes €9.12 (€8.29 + €0.83 VAT at
  10%) and the cola €2.88 (€2.38 + €0.50 VAT at 21%).
  - May the venue choose the share each part takes, and on what basis? Is each part's own price when
    sold alone acceptable?
  - How exact must the share be? The owner reads the rules as not requiring an exact split. That is
    the owner's reading, not something a source we found says.
  - If the guest leaves the cola out and still pays €12.00, does the cola still take a share, or is the
    whole €12.00 food at 10% (€10.91 + €1.09 VAT)?

### Confirmations: clocks

**The situation.** Waitron dates each invoice and its record from the box's clock, and that clock can be
wrong, for example after a power cut. These items cover what follows once that is found out. How it
is found out is explained under
[how a wrong clock is known](#how-a-wrong-clock-is-known-and-what-a-late-filing-is).

- **T1.** When a wrong clock misdates tickets and the customer is unknown, the restaurant makes the
  corrective invoice, keeps it and files its record. It reaches a customer only where the restaurant
  knows who they are, and tickets are not cancelled and reissued. No source covers this.
- **T5. A record timed earlier than the one before.** If the clock ran ahead and is then corrected, the
  next record carries a time earlier than the previous one. We think this is allowed when the new time
  is the exact one. Article 7.e of Orden HAC/1177/2024 requires «la fecha y hora exactas», and article 3
  switches off article 7.i.2.º, the one rule against it, for Veri\*Factu systems. AEAT's FAQ says only that
  these fields «deberían ser coherentes con el orden temporal de generación de los RF». The chain follows
  the order the records were made in, and the record has no field for marking the step, so nothing is
  marked.
- **T6. Only the hour is wrong.** Take a ticket stamped 21:10 for a sale at 20:50 the same day. An invoice
  must show its date, not its time (RD 1619/2012 articles 6.1.b and 7.1.b), and the developer FAQ says
  «La hora de expedición e impresión material de la factura no forma parte del RF». So we think no
  corrective is needed, and the restaurant only keeps a note of the incident. One source points the
  other way: developer FAQ §17 case 2.b says an error in an internal field needs a correcting record.
  That record carries its own time, though, so it could not put the original time back.
- **T7. The date is wrong.** Take a sale on 14 November stamped 15 November.
  - The remedy is a corrective invoice in its own series, as soon as the error is known and within four
    years (article 15.3). The DGT says «será necesaria la expedición de una factura rectificativa» (V1665-22,
    V0902-22, V1924-23, V2611-24). None of these rulings mentions a Veri\*Factu record, so applying them
    to a filed record is our reading.
  - It is an R4 on a full invoice and an R5 on a simplified one. It states the real date of the sale and
    changes no VAT, because the amount has not changed (V0305-24).
  - One corrective may cover many invoices, if it identifies them all (article 15.4).
  - VAT follows the real date of the sale (LIVA article 75.Uno.2.º). If the corrective moves a sale into
    a period whose return is already filed, that return is fixed with a complementary return (LGT article
    122), with a late surcharge starting at 1% (article 27.2), and the later return is corrected.
  - This applies when the real date can be shown. T2 covers the case where it cannot.
- **T8. Telling AEAT.** We think there is no duty or channel to report a clock incident. A text search of
  the Reglamento, the Orden, both FAQs, the validation document and the service description found none.
  The corrective record reaches AEAT anyway. Article 16.4 asks for justification only of incidents that
  stop records being sent, and only if AEAT asks. This rests on finding nothing, so it needs your yes.

### Confirmations: tips (hold, see decision 3)

**The situation.** Waitron can offer a tip when a guest pays, and it keeps tips off the invoice. The card
provider pays the tip to the restaurant with the rest of the bill, and the restaurant passes it to staff.

- **T9. Suggested tip percentages and VAT.** At payment the guest sees choices such as no tip, 5%, 10%,
  15% or another amount. We think the tip stays outside VAT if nothing is pre-selected, the guest can
  choose zero or any amount, and the tip is not on the invoice. No ruling covers a suggested tip. The
  test in V1895-24, V5110-26 and V2182-23 is that «no se haya establecido una cuantía fija» and the amount
  is left «a la libre determinación» of the giver. V3298-20 taxed a donation of a fixed €50 or €100 because
  it was fixed and bought a discount. A list the guest can ignore does neither, since the meal is owed
  whatever the guest tips. That last step is our reading.
- **T10. How card tips are booked.** We think card tips passed to staff are not the restaurant's income.
  They are a debt to staff from the day they are collected, and paying them through payroll clears the
  debt, so there is no income or expense and they do not count towards turnover. The accounting plan
  excludes «las cantidades recibidas por cuenta de terceros» from income (PGC valuation rule 14.ª), and
  ruling 2174-03 calls the business a «mero intermediario». This holds only if staff, not the business,
  are entitled to the tips. A contract paying wages out of the tips would change it.

### Confirmations: records and the declaration

**Keeping records.** Waitron sends a record of every invoice to AEAT as it is made (Veri\*Factu). AEAT
says the restaurant need not keep records it has received, because AEAT holds them. The restaurant must
still keep its invoice copies and other documents. Our proposal is one schedule for all of them, with
six years as the starting point, so nobody has to work out a period for each document.

**The declaration.** The maker of billing software, called the producer, must sign a statement for each
version saying it meets the rules (declaración responsable, Orden HAC/1177/2024 article 15). It answers
a fixed list of items, a) to g), and each restaurant keeps a copy. Item d) describes what the system
consists of, and item f) says whether one installation can serve several taxpayers. Waitron's producer
is a private individual today, and the statement has not been signed yet.

- **T4.** The words «acceso en línea» do not need the data on the internet. RD 1619/2012 articles 21.2
  and 23 are met by a copy on the venue's own box if, when the tax office asks during a check, it can without
  unjustified delay see every invoice, search it, copy or download it and print it. No permanent
  connection or public address is needed. Orden EHA/962/2007 article 5.3 covers «un sistema de
  almacenamiento local» and calls full access «una consulta en línea a los datos». DGT 0289-04 wants a
  network link only «en caso necesario», for a remote database. If AEAT asks from its own office, a copy
  of the period on a USB drive or by temporary download link is enough.
- **T11. What a restaurant must keep.** For a restaurant company in the common tax regime, we think
  this list is complete. Is anything missing?
  - Copies of invoices issued, simplified tickets included (RD 1619/2012 article 19.1.b).
  - Invoices received (article 19.1.a).
  - Books, correspondence and business papers (Código de Comercio article 30.1).
  - Any other evidence for its taxes (LGT article 29.2.e).
  - Records of payments and refunds, as business papers. No specific list was found, so this is our
    reading.
  - The software declaration of every version used, because AEAT's FAQ says users «deben conservar los
    certificados de los sistemas que se sustituyan o actualicen».
  - Proof of payment for sales of €1,000 or more, kept five years from the payment (Ley 7/2012 article
    7.Uno.4). A banquet is the likely case.
  - Pro formas and drafts that never became invoices (developer FAQ §6). Whether a pre-bill counts as
    one is a separate point, S2 in the [question register](asesor-questions.md).
- **T12. Records AEAT does not hold.** The reason for not keeping a record is that it has been sent.
  That fails for a record still waiting to go or one AEAT refused, which, in the words of the developer
  FAQ, «no figuraría jamás en los sistemas de la AEAT (aunque constaría un rechazo)». So we keep each of
  these with AEAT's reply until it is settled, then on the common schedule. No source sets a period,
  so this is our reading.
- **T13. The long-term archive.** Older data is to move out of the sales database into an archive,
  proposed under A664 and not built. It would hold the complete originals, their links and the limits of
  each chain, version data, and a reader that works without the sales server. We think that meets
  RD 1619/2012 articles 19 to 21, if it offers selective search, copying, printing and the invoice lines.
- **T14. The description for item d).** We think this draft is enough once the five changes below are
  made:

  > Waitron es un programa de punto de venta para restaurantes y bares. El servidor se ejecuta en un
  > equipo compatible con Linux y Docker, en el establecimiento o en la nube. Las cajas, comanderos,
  > pantallas de cocina y el panel de gestión se conectan mediante navegador. Se prevé un servidor de
  > reserva que pueda sustituir al principal.
  >
  > Waitron no suministra hardware. El software comprende el servidor que genera, encadena, conserva y
  > remite los registros de facturación; la biblioteca de facturación Veri\*Factu, con su versión y
  > declaración responsable; las aplicaciones de los terminales, que no generan dichos registros; y el
  > agente de impresión. Se identificarán también los componentes de terceros, entre ellos Node.js,
  > SQLite, Litestream, Linux y Docker. Cada instalación factura para un solo obligado tributario; la
  > versión española declarada funcionará exclusivamente como VERI\*FACTU.

  1. Remove «Se prevé un servidor de reserva». The item describes what this version consists of, and
     Waitron has no failover today.
  2. Change «Se identificarán» to a present fact, naming the third-party parts and saying the producer
     answers for them.
  3. Say how the library is used. `@waitron/verifactu` has its own repository and releases, so the
     declaration must say the system always calls it, which version, and how, when and what for.
  4. Describe the print agent and how it works with the rest, because the developer FAQ counts invoice
     printing and the QR code as relevant.
  5. Add a sentence on what the terminals do: they ask for invoices and show them.
- **T15. Item f): several taxpayers in one installation.** We answer N. Each venue has its own
  installation, database and certificate, on-site or hosted in Waitron Cloud. If Cloud ever ran several
  taxpayers inside one installation, the answer would become S.
- **T16. If the producer changes, or a venue moves.** No source covers a change of producer, so this is
  our reading. If the producer stops being an individual and becomes a company:
  - Each restaurant's system counts as a new one, with a new installation number and a new invoice chain.
  - Records already sent stay as they are.
  - The company signs a declaration for its first version, and each restaurant keeps the old one.
  - Nothing goes to AEAT, because no registration of a system exists.

  If a venue moves between its own box and Waitron Cloud, with the same producer, it keeps the same
  two-character software code and gets a new installation number. The declaration does not change, as
  long as item d) says the server runs on-site or in the cloud.

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
  on that month's payroll or into rest within four months. At year end, ordinary hours above 1,783 that
  were not already counted as overtime become overtime, so no hour is counted twice. The ET defines
  overtime against the maximum ordinary working day (arts. 34 and 35.1), not the calendar: is counting
  against the published calendar right when hours are spread unevenly across the year?

### Confirmations

**The situation.** Waitron records when each person starts and finishes, their breaks, rotas, absences
and tips. The gestoría calculates payroll and contributions and makes the filings, and Waitron only
hands it the figures. Each server keeps its own tamper-evident chain of working-time records.

- **L3. When a server is replaced.** A person's record then sits in two chains. We propose one export
  covering both, showing each person's days with no gap or change of identity, and we think that is
  enough to prove the hours. Staff need not be told which server held which period. No text in force
  mentions these chains. The tests are that the record is daily, per person and reliable.
- **L4. Tips on the payslip.** Waitron gives one tip amount per person per month. The gestoría shows it as
  its own payslip line and it travels in the payroll file. The daily shares stay in Waitron as evidence.
- **L5. Who withholds on a tip.** Everything turns on who pays the worker. No ruling read addresses cash
  directly, so these follow from LIRPF article 99.2, RIRPF article 76.1 and ruling 2174-03:

  | How the tip reaches the worker | Who pays | Proposed treatment |
  | --- | --- | --- |
  | Cash handed straight to the waiter and kept | The guest | No employer withholding or reporting. The waiter declares it |
  | Cash in the till, shared out at the close | The employer | Through payroll with withholding. The withholding comes out of other pay |
  | A jar staff run themselves, with the business taking no part | The guests, then each other | As the first row, if the business truly stays out |

- **L6. Sharing tips when nothing has been agreed.** The Catalan agreement has no word on tips. We think
  card tips go to everyone who took part in the service, room and kitchen, temporary staff included, in
  equal shares. May a share follow hours worked instead, where the business has no staff representatives?
  The authorities are TSJ Madrid (31/05/2023), TSJ País Vasco (18/07/2017) and TS 635/2021. None binds in
  Catalonia, and no TSJ Catalonia ruling was found.
- **L7. What Waitron gives the gestoría.** One row per person, per period, per pay item, with a code the
  gestoría maps, because no common import layout exists. Is anything missing or unwanted?
  - **Each month:** the person's tax or Social Security number or the gestoría's employee code; pay month;
    ordinary hours; overtime, split paid or rested and ordinary or emergency; complementary hours, split
    agreed or voluntary; night hours; public holidays worked; absences by kind and date; tips to pay
    through payroll; and the person's month summary.
  - **Extra for contributions:** the emergency and complementary splits above, which have different rates
    and codes, and holiday days unused at the end of a contract.
  - **At a final settlement:** the file runs twice, because a proposed settlement goes with the notice
    (ET article 49.2) and the hours are final only on the last day. It adds hours up to the last day,
    overtime and holidays owed as rest, holiday taken this year, tips not yet paid, and the notice date.
    The gestoría works out holiday pay, bonus shares and any end-of-contract payment.
- **L8. What is kept, and for how long.** No period was found for absences or rotas. We propose that an
  absence that changed pay is kept with payroll and any other follows rotas, and that rotas are kept only
  as evidence in a claim, because the inspectorate says a general schedule does not prove the time record.
  The employer's copy keeps the name and tax or Social Security number, and the representatives' copy
  the name. Nothing is released while a claim or inspection is open.

## For the privacy specialist

### The question that needs judgement

- **P1. May a restaurant keep allergy notes after the meal as evidence?** If so, blocked, relying on GDPR
  article 9(2)(f) before any claim exists? For how long: one, three or five years? Does a food safety
  claim count as a liability under LOPDGDD article 32.2? Staff must answer an allergy question for
  every table before the first send, and the "who" field often holds a guest's name.

### Confirmations

**The situation.** The till asks an allergy question for every table before the first order is sent, and
keeps the answer with a "who" field. It also records which staff member made each sale, void, refund and
drawer opening, and most of that cannot be changed. Guests' details are held for a booking, or when
someone asks for a full invoice. No law requires a restaurant to record who is allergic: the food rules require it to
tell customers which allergens a dish contains.

- **P2. The basis for allergy notes during the meal.** We propose GDPR article 6(1)(b), the contract for a
  safe meal, with article 9(2)(a), explicit consent. A guest's spoken request, noted after a short
  explanation, is explicit consent. The EDPB allows spoken consent but warns it «may be difficult to
  prove», and the till records who entered the answer, not that the guest agreed. A guest speaking for a
  companion or a child is not that person's consent, so what should staff do then?
- **P3. What to remove early.** On our reading of GDPR article 5(1)(c) and (e), not an AEPD statement:

  | Data | Proposal | Why |
  | --- | --- | --- |
  | Raw print data | Delete soon after printing | Only a copy of what is stored elsewhere |
  | Booking phone | Delete when the booking ends | No purpose remains |
  | Guest's name in the "who" field, after the meal | Reduce to the seat | Evidence needs the seat and allergen, unless P1 says otherwise |
  | Link from the allergy note to a booking name | Cut with the above | Otherwise the seat still identifies the guest |
  | Staff member who took the note | Keep | It shows who was told |
  | Staff name on time and fiscal records | Keep | The duty requires it |

- **P4. Deleted data that stays in backups.** A person's data removed from the live database stays in
  backups until they expire. We think a delay of up to 30 days is acceptable if a list of erasures is kept
  outside the database and replayed before a restored copy opens, and bucket keys are held by one named
  person. The EDPB's 2026 report asks for that kind of list and sets no safe number, and half the
  authorities raised concerns. Today's defaults are 7 days for the bucket and 30 for scheduled backups.
  The copies are not inaccessible: anyone with the bucket's login or a recovery pack can read them.
- **P5. What assessment a single restaurant needs.** We think a written risk analysis, plus a short
  reasoned note on why no DPIA is needed (a DPIA is a formal impact assessment). The AEPD's list asks for
  one in most cases that meet two or more criteria. One restaurant clearly meets one, health data. A
  second, systematic monitoring, is arguable for the record of staff actions in P9. The AEPD's exemption for
  small businesses' staff records stops at customer data, «pero nunca relativos a los datos de los
  clientes», and a decision not to do one «ha de estar suficientemente fundamentada».
- **P6. A former employee's details.** Their email is kept one year after they leave, on legitimate
  interest with a short written balance, to cover the one-year claim period and sending documents. It is
  then blocked (set aside) rather than cleared. Their PIN, password and passkeys are deleted when they
  leave, without blocking: they prove nothing, and keeping them is itself a risk. The AEPD's reading covers
  any erasure and we found no exception, so please confirm that.
- **P7. Data the law requires us to keep.** No blocking applies while a legal duty runs (Informe 0148/2019).
  So a former employee's time record stays available to them and their representatives, comes off
  everyday screens such as rotas and staff lists, and is used only for that purpose. The email address an
  invoice went to is erased on request once delivered, unless delivery is in dispute. The date, outcome
  and sender stay. Nothing read requires keeping the address, and RD 1619/2012 requires only the invoice
  copy.
- **P8. Waitron's own role.** For bug reports, Waitron is a controller when it uses them to improve the
  product for every customer, and a processor when it diagnoses one venue's problem on that venue's
  instruction. The same report can be both, so one must be chosen and written down. A951 replaces the
  remote-access relay. Staff connections pass through Cloud encrypted, while Cloud can read customers'
  public requests in memory. Waitron is a processor for both and a controller for its own security and
  traffic records. Cloud's lawyer question D101 reuses this, so we want to ask it once.
- **P9. Recording what staff do at the till.** Recording who voided, refunded or opened the drawer is a
  control measure under ET article 20.3, so it needs no consent. If there are staff representatives, they
  get to report first (ET article 64.5.f, up to fifteen days), which is a right to report and not a veto. A
  shared till is a device under LOPDGDD article 87.3, so a one-page rule covers it: work use only, what is
  recorded, who can see it. A complete staff notice given before the system is used is enough, because
  the stricter notice wording applies to cameras and location tracking. Whether a till's log counts as a
  "system" under article 64.5.f is a labour law point we did not research.
- **P10. Collecting a customer's details for an invoice.** Staff show or say a short notice before taking
  the details, and the full notice is a sign or a link they can reach at once (LOPDGDD article 11). The
  email comes too late to be the first notice. Is this wording right?

  > **Protección de datos.** *[Razón social]* usa tu nombre, NIF y domicilio para emitir tu factura.
  > Derechos y más información: *[dirección de la página]*.

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

**2026-11-08:** the findings below record the 6 November reading. A1406-1 supplies the
[first venue's configuration procedure](../operations/first-venue-work-time.md) and neutral PDF
headings. Paid continuous breaks, yearly limits and split shifts remain A1406-2. See the
[backlog](../backlog.md) for the current state of the other findings.

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
