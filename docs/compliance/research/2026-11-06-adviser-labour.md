# Labour adviser research, 2026-11-06: time record, collective agreement, payroll, tips, retention

**What this is.** A research pass over the questions for the gestoría or labour adviser in
[2026-11-05-consultas-para-asesores.md](../2026-11-05-consultas-para-asesores.md): L1, L2, L4, L5, L6,
the labour part of Q48, and L7(b). Each question is split into its separate sub-questions, checked
against what is built and decided today, and then against free primary sources. The aim is to send
the adviser only what research cannot settle, and to send it as a yes or no.

**Status.** Research, not legal advice. Nothing here was sent to anyone. Nothing in the repository
was changed. The tips work builds on [2026-10-18-a793-tips.md](2026-10-18-a793-tips.md) and the
retention work on [2026-10-16-a664-retention.md](2026-10-16-a664-retention.md); neither is redone.

**How it was checked.** Every source was downloaded on 2026-11-06 into an empty folder with `curl`
(the source register below gives each URL). Every Spanish quotation in «» was checked word for word,
by script, against the downloaded text with whitespace collapsed; the script also failed, as it
should, on control quotes known not to be in those texts. "Our reading" marks an inference the
sources do not state. Where a source was read only through someone else's copy, it says so.

**A note on the first venue.** It is in Barcelona city, taken from the postal address in the local
Square snapshot of the deli (`local/square/snapshot/locations.json`, not in the repository). That the
deli in `docs/compliance/action-plan.md` is the business in that snapshot is our inference from the
two memory notes that mention it. The action plan keeps the deli's legal name out of the repository,
so this document does too.

## Terms used below

| Term | Meaning |
| --- | --- |
| BOE, DOGC | The Spanish state's official gazette; Catalonia's official gazette |
| ET | Estatuto de los Trabajadores, the Workers' Statute |
| LGSS | The General Social Security Act |
| LISOS | The act on labour and Social Security offences and penalties |
| RIRPF, LIRPF | The Income Tax Regulation and the Income Tax Act |
| RD | Real Decreto, a government decree |
| ITSS | Inspección de Trabajo y Seguridad Social, the labour inspectorate |
| TGSS | Tesorería General de la Seguridad Social, which collects contributions |
| DGT, PETETE | The tax ministry's directorate that answers written questions; its public database of answers |
| TS, TSJ | Tribunal Supremo (Supreme Court); Tribunal Superior de Justicia (a region's High Court) |
| Convenio | A collective agreement between employers and unions |
| ALEH | The state-wide collective agreement for hospitality |
| Base de cotización | The pay on which Social Security contributions are worked out |
| CRA | Conceptos Retributivos Abonados, the monthly list of pay items an employer reports to the TGSS |
| Retención | Income tax the payer withholds from pay |
| Fijo-discontinuo | A permanent contract for work that stops and restarts, usually by season |
| Horas complementarias | Extra hours agreed with a part-time worker. They are not overtime |
| Finiquito | The final settlement at the end of a job |

## Summary

**Outcome per sub-question.** ANSWERED: primary sources settle it. NARROWED: research gives a likely
answer and a professional only confirms it. KEEP: only a professional can answer. VENUE: a fact the
owner or the gestoría knows, free as part of the service. DROP: the question no longer makes sense.

| Ref | Sub-question | Outcome | Answer in a line |
| --- | --- | --- | --- |
| L1.1 | What binds the venue today? | ANSWERED | ET arts. 34.9, 12.4.c and 35.5: start and end per person per day, kept four years, open to staff, their representatives and the inspectorate |
| L1.2 | Must breaks be recorded? | ANSWERED | Not required by law, but advisable: unrecorded breaks may count as work |
| L1.3 | Is the digital decree published? | ANSWERED | No. Not in the BOE up to and including 6 Nov 2026. Still a draft. Recheck on the day the batch is sent |
| L1.4 | Its calendar, data, format and remote access | DROP | Nothing in force to apply. The draft is kept below as a watch list |
| L1.5 | Export format and remote access under today's law | ANSWERED | A printout or a download in a readable, workable format. No remote access duty |
| L1.6 | Who decides how the record is organised? | ANSWERED | Agreement, or the employer after consulting representatives. The Catalan agreement says nothing, so it is the employer's decision |
| L1.6v | Are there representatives, and is that decision written down? | VENUE | The owner knows |
| L1.7 | Joined record with separate integrity chains | NARROWED | Proposed yes: the law asks for nothing about chains, only a reliable record per person per day |
| L2.1 | Which agreement applies? | ANSWERED | The interprovincial agreement for Barcelona, Girona and Tarragona, 2025–2028. It is not provincial |
| L2.2 | Which pay table? | VENUE | Barcelona annex; the column depends on the establishment's group A–E |
| L2.3 | Yearly and daily limits | ANSWERED | 1,783 hours a year 2026–2028; nine ordinary hours a day from the ET |
| L2.4 | Rests | ANSWERED | 12 hours between shifts; two days together a week; 20 paid minutes in a continuous shift over five hours |
| L2.5 | Night work | ANSWERED | 22:00 to 06:00, plus 25% on ordinary salary |
| L2.6 | Split-shift rules | ANSWERED | No extra payment. Each part 3–5 hours, at least 90 minutes between |
| L2.7 | Overtime: money or rest, and the window | ANSWERED | Worth an ordinary hour; each workplace negotiates; failing that, rest within four months |
| L2.7v | Has this workplace agreed money or rest? | VENUE | The owner or gestoría knows |
| L2.8 | The yearly cap | ANSWERED | 80 hours, counting only hours paid; pro rata for short years and part-timers |
| L2.9 | Is day-by-day overtime right under a yearly count? | NARROWED | Proposed: measure against the published calendar, pay monthly, and use 1,783 as a check |
| L2.10 | Overtime for part-time staff | ANSWERED | There is none, outside emergencies. Extra hours are complementary hours, limited to 50% of contracted hours |
| L4.1 | Which payroll program? | VENUE | The gestoría knows |
| L4.2 | Which import format? | VENUE | Ask for their template. No public layout is common to the packages |
| L4.3 | Which fields? | NARROWED | A proposed list below, one row per person per pay item |
| L4.4 | How often? | ANSWERED | Monthly at most. The cut-off day is a VENUE detail |
| L5.1 | What must exist at termination? | ANSWERED | A proposed settlement delivered with the notice, under ET art. 49.2 |
| L5.2 | Which data? | NARROWED | A proposed list below, drawn from the ET and the agreement |
| L5.3 | In what format? | VENUE | Same file as payroll unless the gestoría prefers otherwise |
| L5.4 | "Holiday still owed" as a Waitron figure | DROP | Not built. Waitron holds absences only. Rephrase as "holiday taken" |
| L6.1 | Do shared-out card tips go through payroll with withholding? | ANSWERED | Yes. Already settled by 1866-03 and RIRPF art. 76.1.3.º |
| L6.2 | How to document and import the share-out | NARROWED | One monthly amount per person, on its own payslip line, from A793's statement |
| L6.3 | Do those tips count for contributions? | NARROWED | Proposed yes. New evidence, but no authority on a restaurant. The main question left |
| L6.4 | How are they reported to the TGSS? | NARROWED | If they count: code 0001. The TGSS table has no tips code |
| L6.5 | Cash handed straight to the waiter | NARROWED | Proposed: no employer withholding or reporting; the waiter declares it |
| L6.6 | Cash left in the till, shared at the close | NARROWED | Proposed: yes, through payroll with withholding, because the employer pays it |
| L6.7 | A pot staff run themselves | NARROWED | A new path. Proposed: as L6.5, provided the business stays out of it |
| L6.8 | Sharing rule with no agreement | NARROWED | Proposed: everyone who took part, kitchen and temporary staff included. The agreement is silent |
| L6.8v | Is there an existing custom at the venue? | VENUE | The owner knows. Changing one has a formal procedure |
| Q48.1 | Working-time record | ANSWERED | Four years |
| Q48.2 | Part-time monthly summaries | ANSWERED | At least four years |
| Q48.3 | Payslips | ANSWERED | At least five years |
| Q48.4 | Contribution and registration papers | ANSWERED | At least four years; five where kept with payslips |
| Q48.5 | Absences | NARROWED | Proposed: those that changed pay follow payroll; the rest follow the rota |
| Q48.6 | Rotas and planning | NARROWED | No rule found. Proposed: keep only as evidence |
| Q48.7 | Does six years cover the labour minimums? | ANSWERED | Yes. Every fixed period read here is five years or less |
| Q48.8 | Minimum identity | NARROWED | Proposed: name and tax or Social Security number for the employer's copy; name only for representatives |
| Q48.9 | Corrections | ANSWERED | No rule in force. The draft decree asks for what Waitron already does |
| Q48.10 | Access | ANSWERED | Staff, representatives and inspectorate; a log of who looked is a privacy question |
| Q48.11 | Claims that extend retention | NARROWED | The general periods are below; the venue's own claims are its facts |
| Q48.12 | Who lifts a hold? | VENUE | No rule found. The employer holds the duty, so the owner decides on advice |
| L7b.1 | Hospitality rates or brackets | ANSWERED | None in the 2026 contribution order |
| L7b.2 | Hospitality bonus | VENUE | €262 a month per seasonal worker in Feb, Mar and Nov, only if the venue has such staff and a tourism link |
| L7b.3 | Extra data Waitron must give | NARROWED | Proposed: overtime and complementary hours each split in two, plus dates |

**What changes for the batch.** Seven questions go in; what remains is mostly confirmation. Two
items are real judgement calls that should still be paid for: **L6.3** (contributions on tips) and
**L2.9** (how overtime is measured). **L6.8** and **L6.5–L6.7** can be answered in a line each. Our
estimate, not a quotation: about one to two hours of a labour adviser's time rather than seven.

**Three findings the repository does not yet have.**

1. **The first venue's agreement is identified and its figures differ from the built defaults**
   (§2). Weekly rest is two days, not 36 hours. The paid break starts at five hours, not six.
2. **The Supreme Court has ruled on tips and contributions, for casinos** (§5.3). STS 692/2021 put
   guaranteed casino tip pay in the contribution base, and said casino tips differ from hospitality
   tips. The A793 research did not have this ruling.
3. **The TGSS reporting table has no way to report a tip as outside the contribution base** (§5.4).
   That is a practical fact the A793 research did not have.

---

# Full report

## 1. L1: the working-time record

**Still makes sense?** Partly. Its second half asks about a decree that does not exist yet.

### What binds the venue today (L1.1, ANSWERED)

ET art. 34.9 (consolidated text, last update shown 21/10/2026):

> «La empresa garantizará el registro diario de jornada, que deberá incluir el horario concreto de
> inicio y finalización de la jornada de trabajo de cada persona trabajadora»

> «La empresa conservará los registros a que se refiere este precepto durante cuatro años y
> permanecerán a disposición de las personas trabajadoras, de sus representantes legales y de la
> Inspección de Trabajo y Seguridad Social.»

The employer guarantees a daily record with each person's exact start and end, keeps it four years,
and keeps it available to staff, their representatives and the inspectorate.

Part-time staff add a duty, ET art. 12.4.c: hours are recorded daily and totalled monthly,

> «entregando copia al trabajador, junto con el recibo de salarios, del resumen de todas las horas
> realizadas en cada mes»

with a copy of the month's summary given with the payslip. Failing that,

> «el contrato se presumirá celebrado a jornada completa»

the contract is presumed full-time. Overtime adds ET art. 35.5:

> «la jornada de cada trabajador se registrará día a día y se totalizará en el periodo fijado para el
> abono de las retribuciones»

A breach is a serious offence, LISOS art. 7.5 (it lists «registro de jornada»).

**Product note.** The part-time month summary with the payslip, and the overtime summary, must reach
the worker. Payroll export is deferred, and nothing in the product closes a pay period
([backlog](../../backlog/workforce.md#nothing-in-the-product-closes-a-pay-period)). My Schedule →
Hours lets a person download their own record, which is not the same as a copy with the payslip.
The gestoría may already issue it; see L4.3.

### Breaks (L1.2, ANSWERED)

The inspectorate's Criterio Técnico 101/2019 (read through a Barcelona provincial council copy of the
ministry's document):

> «no se exige expresamente el registro de las interrupciones o pausas»

Recording breaks is not expressly required. But the record should give a true view of working time,
because otherwise

> «podría presumirse que lo es toda aquella que transcurre entre la hora de inicio y finalización de
> la jornada de trabajo registrada»

everything between start and end may be presumed to be work, and the employer would have to show
otherwise. Waitron's proposal to record breaks goes beyond the minimum and is the safer choice.

**Catalan point.** The 20-minute break in a continuous shift counts as work (§2), so subtracting it
from worked time would be wrong.

### The digital decree (L1.3, ANSWERED: not published)

**Plainly: as of 6 November 2026 no decree on the digital time record has been published in the BOE.
It is still a draft.** The text in force is the 2019 rule above.

| Check | What the failing case would show | Result |
| --- | --- | --- |
| Every BOE daily summary, 1 Jan to 6 Nov 2026: 268 issues, 59,681 titles, searched for "registro de jornada", "registro horario", "control horario", "jornada de trabajo", "tiempo de trabajo", "jornadas especiales", "1561/1995", "desconexi" and "Estatuto de los Trabajadores" | A title like the draft's, «en materia de registro de jornada» | Five hits, none the decree: an order on the RED mechanism, RD 607/2026 on artists, a Prado contract notice for a clock system, and two Justice ministry resolutions on court staff hours |
| Controls on that list | A missing known item would mean the list is broken | Found the ALEH amendment (BOE-A-2026-18630) and RD 126/2026 on the minimum wage; 6 Nov itself has 191 titles |
| RD 1561/1995 consolidated text, which the February 2026 draft would amend | A last update after a decree | Last update shown 02/07/2020 |
| Government meeting records (La Moncloa) for 6, 13 and 27 Oct and 3 Nov 2026 | An item approving it | Not there. The only hit is a line about medical trainees on 3 Nov. The page for 20 Oct was not retrieved (404 at the expected address) |

Limits: the BOE search reads titles, so a decree with an unrelated title would escape it. A decree
could be approved any Tuesday. Europa Press, carried by Demócrata on 5 Oct 2026, reported that the
government could still approve it by decree before the 29 November general election. **Recheck the
BOE the day the batch is sent.**

**Where the draft stands.** The Consejo de Estado, in opinion 188/2026 (read through
laboral-social.com's copy; the BOE address tried returned 404), concluded:

> «no procede aprobar el Real Decreto proyectado»

The draft should not be approved. It also said a single digital system should not be imposed on
special working-time sectors, naming «la hostelería al completo» among the examples.

**Correction.** `asesor-laboral-questions.md` dates the opinion 23 March 2026. The text says the
session was on 19 March 2026.

### What the draft would require (L1.4, DROP)

There is nothing in force to apply, so this is not a paid question. It is kept as a watch list.

The text read is the version put out for comment in October 2025, on the ministry's letterhead, from
a CEOE Cantabria copy. The version sent to the Consejo de Estado in February 2026 was reordered; only
the Consejo's description of it was read. The final text may differ.

- **Medium:** art. 2.1, «por medios digitales».
- **Fields, art. 3:** identity; full or part-time and the schedule; start and end to the minute;
  unpaid breaks; on-site or remote; whether hours are ordinary, overtime or complementary, and
  whether overtime is rested or paid and is for emergencies; waiting time; interruptions of the right
  to disconnect; hours under family-care or flexibility measures; daily and monthly totals; who
  changed what.
- **Changes, art. 2.2.b and 4.b:** a change needs the employer and the worker, and must leave a trace,
  «refleje una huella clara e indeleble de los cambios realizados y de su autoría». A disagreement
  is recorded, not resolved. This matches what Waitron built.
- **Inspector access, art. 6.3:** «de manera remota y presencial en los centros de trabajo».
- **Format, art. 6.4:** workable, readable, and compatible with widely used formats.
- **Technical rules** are left to later rules (Oct 2025 art. 5). The February version, per the
  Consejo, delays duties that depend on them until «seis meses desde la entrada en vigor de estas
  últimas», six months after those rules take effect.

**Waitron against that list.** In the record types and period summary read
(`packages/workforce/src/record-types.ts`, `projection.ts`), a search found nothing for on-site or
remote, complementary hours, an emergency flag, waiting time or disconnection. If the decree passes
in this shape, those are the gaps. Waitron need not build them now.

**Corrections to L1's background.** It says the draft is "automatic" and "interoperable". Neither
"automátic" nor "interoperab" appears in the October 2025 draft (a search for "digital" finds it).
All three hits for "interoperabilidad" in the Consejo's opinion are in objectors' comments or reports on them. The claim
of a six-month against one-year dispute over small businesses is from press reports and was not
confirmed.

### Format and remote access today (L1.5, ANSWERED)

Criterio Técnico 101/2019: for an electronic system the inspector may require a printout, or

> «su descarga o su suministro en soporte informático y en formato legible y tratable»

a download in a readable, workable format. Waitron's PDF and CSV fit. No text in force requires
remote access. Summaries of STS 41/2023 and STS 1161/2024 (read through a commentary site, not the
court's database) say the law imposes no particular form of record.

### Who organises it (L1.6, ANSWERED; L1.6v, VENUE)

ET art. 34.9: by collective agreement, company agreement or, failing those, employer's decision after
consulting representatives, «se organizará y documentará este registro de jornada». The Catalan
agreement contains no clause on the time record (word search for "registr", "fichar" and "fichaje":
only unrelated hits). The ALEH 2026 amendment does list misuse of the record as a disciplinary fault:

> «Dos incumplimientos o mala praxis en la utilización de los sistemas de control y registro de
> jornada implantados en la empresa.»

So at this venue it is the employer's decision. Our reading: with no representatives, the consultation
has nobody to reach. **VENUE:** does the deli have representatives, and is the decision written down?

### Joined record across servers (L1.7, NARROWED)

No text in force mentions integrity chains. The tests are that the record is daily, per person, and
reliable (the EU Court's words, as the Criterio Técnico and draft repeat them: objective, reliable,
accessible). Separate chains per server are Waitron's own design, stronger than any duty read.

**Proposed answer for a yes or no:** a single export covering both servers, showing each person's
days without a gap or a change of identity, is enough to prove the hours, and which server held which
period need not be explained to staff. Yes or no?

## 2. L2: the agreement and overtime

**Still makes sense?** Yes, and most of it is answered. The word "provincial" is wrong for this
venue, and "plus de jornada partida" asks about something this agreement does not have.

### Which agreement (L2.1, ANSWERED)

**Convenio colectivo interprovincial del sector de la industria de hostelería y turismo de Cataluña,
code 79000275011992.** Published by Resolución EMT/774/2026, DOGC 9630, 23 March 2026. In force 1
January 2025 to 31 December 2028 (art. 5). A correction in DOGC 9701, 6 July 2026, changes only the
Catalan wording of a disciplinary heading. Art. 3 covers the provinces of Barcelona, Girona and
Tarragona.

A deli fits, even if the shop is the larger business. Art. 2.2.c covers premises that

> «sirvan al público, mediante precio, comidas y/o bebidas, para ser consumidas en el mismo local o
> terraza»

and art. 2.2.e extends that to premises

> «cuya actividad preponderante o no sea la venta al público de comidas y bebidas consumidas en el
> mismo local o terraza»

whether or not selling food and drink for consumption on site is the main activity. Our reading: a
deli that seats customers is covered. The backlog's notes on the venue mention its tables and terrace. If the owner's
gestoría already applies another agreement, that is the point to raise.

The state agreement (ALEH VI, amended in BOE-A-2026-18630) sits above it on some matters. Transitional
provision one has the signatories review the restaurant sector, so a later annex is possible.

### Pay table (L2.2, VENUE)

Annex II.A is Barcelona. Art. 35 sets rises of 4% for 2025, 2026 and 2027 and 3% for 2028. The 2026
monthly table goes by level (I to VI) and establishment group (A to E): level III, which annex
A.2 gives for waiters, cooks and shop assistants, is €1,803.05 in group A, €1,735.87 in B and €1,607.25
in D. Groups are listed by type: for instance fast-food and "restauración moderna" are B,
one-fork restaurants and third and fourth-category bars are D. **The venue's group is a fact the
gestoría already has.** Waitron does not need it: `employments.pay_rate` is entered per person.

### Limits to load into the configuration (L2.3 to L2.6, ANSWERED)

| Rule | The agreement says | Article | Built default in `convenio_config` | Change for Barcelona |
| --- | --- | --- | --- | --- |
| Yearly hours | «La jornada máxima anual será de 1791 horas de trabajo efectivo para el año 2025 y de 1783 horas de trabajo efectivo para los años 2026, 2027 y 2028» | 28.A | No column; 40 h a week | Needs a yearly limit |
| Daily maximum | Silent; ET art. 34.3 says nine | — | 540 minutes | None |
| Between shifts | ET art. 34.3, 12 hours. Art. 28.C allows 10 only «Sólo para las zonas de afluencia turística»: Pyrenees, Costa Daurada, Maresme and Girona province | 28.C | 720 minutes | None for Barcelona city (our reading: the Maresme is a separate county) |
| Weekly rest | «descanso mínimo semanal de 2 (dos) días sin interrupción» | 29 | 2,160 minutes (36 hours) | 2,880 minutes, and consecutive |
| Break, continuous shift | «Se dispondrá de un descanso de 20 minutos que se computarán como jornada de trabajo a todos los efectos en cualquier jornada superior a cinco horas.» | 28.B.a | 360 and 15 minutes | 300 and 20, counted as worked |
| Split shift | «Los turnos tendrán un máximo de 5 horas y un mínimo de 3. El descanso entre turno y turno tendrá una duración mínima de hora y media.» | 28.B.b | No columns | Needs a rule |
| Split-shift extra pay | None. A word search of the agreement finds "partida" only in art. 28, in a job title and inside the word "compartida" | — | `split_shift_premium` null | Leave null |
| Night | 22:00–06:00, «tendrán una retribución específica incrementada en un 25% sobre el salario ordinario» | 42 | Window correct; premium null | 25 |
| Holiday | «treinta y un días naturales de vacaciones» | 30.1 | Not built (A586) | 31 calendar days |
| Holiday worked | The day is taken later and «la empresa deberá abonar un 40% de acuerdo con la tabla salarial» | 32 | Not built | New data |
| Overtime cap | 80 hours | 34 | 80 | None |

"Ordinary salary" for the night premium is defined in art. 35.2: «Se entiende como salario ordinario,
el salario base, más la antigüedad y manutención». The gestoría calculates that; Waitron needs only
the night hours.

`breaks_count_as_worked` in the schema is described as being about split-shift breaks. In this
agreement the 20 minutes in a continuous shift count as work, and the gap in a split shift does not.
One flag cannot say both as described.

**Limit.** The figures are this agreement's. Any better term in a contract stands (art. 8), and a
company agreement could differ. Whether the rule sets ship as "Barcelona city" or per person is
A586's open decision.

### Overtime (L2.7, L2.8, ANSWERED; L2.7v, VENUE)

Art. 34:

> «Su valor será el de la hora ordinaria y en cada centro de trabajo se negociará si se compensa por
> una hora de descanso o por su correspondiente retribución en dinero. En caso de desacuerdo se
> estará a lo dispuesto en la Ley.»

An overtime hour is worth an ordinary hour; each workplace negotiates rest or money; failing agreement
the law applies. The law, ET art. 35.1:

> «En ausencia de pacto al respecto, se entenderá que las horas extraordinarias realizadas deberán ser
> compensadas mediante descanso dentro de los cuatro meses siguientes a su realización.»

So with no agreement, it is rest within four months.

The cap, art. 34:

> «Su número no podrá ser superior a ochenta 80 (ochenta) al año por trabajador/a, siempre que se
> abonen.»

ET art. 35.2 adds that hours rested within four months do not count, and that the cap falls in
proportion for anyone working less than the full year's hours.

Art. 34 also makes some overtime compulsory: repairing damage (outside the cap), and raw materials at
risk, unforeseen needs of the service, unforeseen absences or shift changes (inside the cap).

**VENUE:** has this workplace agreed money or rest? It is a one-line fact.

### How to measure overtime (L2.9, NARROWED)

The question assumes hours beyond each day's ordinary hours. The law counts differently. ET art. 35.1
defines overtime as hours over the maximum ordinary working time, and art. 34.1 sets that as an
average over the year. The agreement sets 1,783 hours a year. So a long Friday is not automatically
overtime if it is on the calendar. Waitron already returns both readings (`projection.ts`), so this is
a choice, not a rebuild.

A summary of the Supreme Court's ruling of 30 May 2023 (a commentary site; the court's page refused
the download) says staff on annual calendars must be paid overtime in the following month and not at
year end. In the summary's words: «Si la empresa ya conoce las horas por el calendario laboral, nada
impide pagarlas en la nómina de ese mes.»

**Proposed answer for a yes or no:** overtime is what exceeds the person's published calendar for
that day or the nine-hour limit. It goes on that month's payroll or into rest within four months.
1,783 hours is checked at year end as a backstop, and hours beyond it not already treated as
overtime are overtime then. This is a judgement call on a yearly count, so it stays a paid question,
but a short one.

### Part-time staff (L2.10, ANSWERED)

ET art. 12.4.c:

> «Los trabajadores a tiempo parcial no podrán realizar horas extraordinarias, salvo en los supuestos
> a los que se refiere el artículo 35.3.»

Part-time staff cannot work overtime except in emergencies. Their extra hours are complementary hours.
Agreement art. 24 allows these to

> «podrá alcanzar el porcentaje máximo del 50% de las horas ordinarias contratadas, siempre y cuando
> dichas horas complementarias se realicen como continuación de la jornada diaria inicialmente
> pactada»

reach 50% of contracted hours, provided they continue that day's shift. Art. 23.4 sets 30% for
part-time fixed-discontinuous staff, with an exception under 25 hours a week.

**Product gap.** The period summary computes overtime for anyone, and a search of it finds no
complementary hours. A part-timer's excess is shown as overtime, which is not a lawful label.

## 3. L4: the payroll export

**Still makes sense?** Yes, but most of it is a fact, not a paid question. **A1188 did not decide a
format:** it is the cloud emergency start, and its design does not mention payroll. The backlog still
says "Ask the gestoría which payroll package and import format it accepts". A793 did decide one
thing: a "Download for the gestoría" CSV of tips, whose figures feed the later export.

**L4.1 and L4.2, VENUE.** Which program and which import? The gestoría the deli already pays answers
this in a sentence. Ask for an empty import template.

**What public documents show.** There is no published common layout. Each package imports per person,
per pay item, usually by a template set up per client:

- Wolters Kluwer's a3 brochure says monthly changes in pay, days worked or absences can be reported
  «a través de Excel». The layout was not found.
- On Sage's community forum, a reply about Sage 200 says a file can load quantity, amount, concepts
  and factors into each employee's incidents through the "control de presencia" menu, and that
  «Este proceso requiere un montaje y diseño previo de la guía de importación». That is a forum reply,
  not documentation.
- Nothing usable was found for Nominasol.

**So:** a plain CSV of one row per person, per period, per pay item, with a code the gestoría maps.
That shape fits both descriptions. Waitron need not wait for the answer to build it. This would
replace the earlier plan of per-package adapters (workforce design §6); that is a proposal for the
owner, not a decision.

**L4.3, NARROWED. Proposed fields**, for a yes or no ("is anything missing, and is anything unwanted?"):

| Field | Why | Waitron today |
| --- | --- | --- |
| Person: tax number or Social Security number, or the gestoría's employee code | Matching | Holds identity; code to add |
| Pay month | Matching | Pay periods exist |
| Ordinary hours | Part-time totals | Yes |
| Overtime, split paid or rested | ET art. 35; agreement art. 34 | Total only |
| Overtime, split ordinary or emergency | Different contribution rates, §7 | Not held |
| Complementary hours, split agreed or voluntary | Separate TGSS codes, §7 | Not held |
| Night hours | Art. 42 | Rota warnings only; not in the period summary |
| Public holidays worked | Art. 32 | Not held |
| Absences by kind and date | Pay and sick pay | Planning rows, four kinds |
| Tips to pay through payroll | A793 | Designed, not built |
| The month summary for the worker | ET arts. 12.4.c and 35.5 | Per-person download exists |

Contract type, level, pay rate and start and end dates are the gestoría's own data; Waitron only needs
to not contradict them.

**L4.4, ANSWERED.** ET art. 29.1: the pay period «no podrá exceder de un mes». Agreement art. 35.1 says
monthly. The day of the month the gestoría needs the file is a VENUE detail. Waitron's own closing
step has no caller yet, so a monthly export depends on that open item.

## 4. L5: the final settlement

**Still makes sense?** Yes, but it is nearly all answerable, and it assumes a figure Waitron does not
hold.

**L5.1, ANSWERED.** ET art. 49.2:

> «deberá acompañar una propuesta del documento de liquidación de las cantidades adeudadas»

The employer must give a proposed settlement with the notice of termination. So the gestoría needs
data **before** the last day's hours are known, then again at the end. The export should run twice.

**L5.4, DROP.** The question offers "las vacaciones pendientes". Waitron does not hold that. `absences`
are planning rows of four kinds, and yearly holiday per person is the unbuilt A586. Waitron can give
holiday taken. Rephrase the sentence before sending.

**L5.2, NARROWED. Proposed list**, for a yes or no:

| Item | Source | Who has the data |
| --- | --- | --- |
| Hours, overtime, night and holiday-work hours to the last day | ET; arts. 32, 34, 42 | Waitron |
| Overtime and holidays owed as rest, not yet taken | ET art. 35; art. 32 | Waitron, once tracked |
| Holiday taken this year | Art. 30.1: 31 calendar days, pro rata | Waitron |
| Holiday pay | Art. 30.5: «el salario promedio correspondiente a los últimos 12 meses anteriores a la fecha de su disfrute» | Gestoría |
| Bonus shares | Art. 43: «Quienes ingresen o cesen en el transcurso del año percibirán las gratificaciones prorrateándose su importe con relación al tiempo trabajado.» Summer runs 1 July to 30 June; Christmas, the calendar year | Gestoría |
| End of a fixed-term contract | Art. 27: «una indemnización de 14 días de salario por año trabajado», above the ET's figure; replacement contracts excluded | Gestoría |
| Long-service award | Art. 37: age 50 and over, ten or more years, most endings | Gestoría |
| Notice given by a resigning worker | Art. 18: 15 days; a month in a business under 11 staff; two months at levels 1 and 2; shortfall deducted | Date from the owner |
| Tips not yet paid | A793 statement. The Madrid ruling calls the business a mere holder of them | Waitron, once built |

Unused holiday paid at the end has its own treatment. LGSS art. 147.1:

> «Las percepciones correspondientes a vacaciones anuales devengadas y no disfrutadas y que sean
> retribuidas a la finalización de la relación laboral serán objeto de liquidación y cotización
> complementaria a la del mes de la extinción del contrato.»

It is settled separately, and reported as code 0006 in the TGSS table. That is the gestoría's job and
needs only the day count.

**L5.3, VENUE.** Our proposal: the same CSV as payroll. The gestoría says if not.

## 5. L6: tips

**Still makes sense?** Yes, but part is already settled, and one path is missing. What the A793
research established is not repeated.

### L6.1 ANSWERED: card tips go through payroll

1866-03 and RIRPF art. 76.1.3.º settle it (A793 research §3). Drop it from the question.

### L6.5 to L6.7: the two sources do not contradict

The A793 research left cash **OPEN**, because 2174-03 seems to say the restaurant withholds on all tips
while art. 76 speaks of amounts the employer pays. Reading both texts in full, **they describe the
same path**. Everything turns on who pays.

- LIRPF art. 99.2 puts the duty on those «que satisfagan o abonen rentas sujetas a este impuesto,
  estarán obligadas a practicar retención e ingreso a cuenta».
- RIRPF art. 76.1 makes them liable «en cuanto satisfagan rentas sometidas a esta obligación».
- 2174-03 recites the old regulation as applying «cuando se satisfagan al personal cantidades
  desembolsadas por terceros en concepto de propina» and answers «en aplicación del precepto
  transcrito». Its facts are that «la entidad recibe las propinas como mero intermediario entre sus
  clientes y sus camareros». So its sentence is about tips the business receives and pays on. It does
  not reach cash that never touches the business.
- 1763-99, a waiter whose tips are «la llamada "propina" que se reparte entre los trabajadores según
  costumbre», restates the same rule and does not say the employer withholds on money it does not
  pay.
- V2236-13 says the recipient must declare tips as employment income (A793 research §3).

No ruling read addresses cash directly, so these stay NARROWED, but the path is clear. PETETE was
re-searched for "propina" and for "propinas". Across the two, nearly all the "propina" results
mention it only through the text of art. 76. V1021-23, new to the repository, is about VAT on a tip
app and does not help. No ruling found addresses cash withholding or Social Security on tips.

| Path | Who pays the worker | Proposed answer |
| --- | --- | --- |
| Cash handed straight to the waiter and kept | The guest | No employer withholding and no reporting. The waiter declares it |
| Cash in the till, shared out at the close | The employer | Withholding and payroll, in art. 76.1.3.º's words |
| A jar staff run themselves, the business taking no part (new) | The guests, then each other | As the first row, if the business truly stays out |

**Effect on A793.** Slice 5 waits on L6(g). The proposed answer allows the design's recommendation
only if cash handed out at the close is recorded on the pay-period statement and goes through payroll
as already paid. The withholding then comes out of other pay. "Until then every tip goes through
payroll" stays the safe default.

### L6.3 NARROWED: contributions

**New ruling, not in the A793 research.** STS 692/2021, 17 May 2021, contentious-administrative
chamber, appeal 5914/2019, read through Normacef's copy (not the court's database). A casino's tip pool
paying guaranteed minimum pay is in the contribution base. Its reasoning rests on casino rules, and it
says expressly that casino tips

> «tienen peculiaridades propias que las distinguen de las propinas que se dan en la hostelería o en
> otro tipo de establecimientos de juego»

have features that distinguish them from hospitality tips. **Two paths, not a conflict:** the casino
employer funds guaranteed pay from the pool, while the restaurant, on the Madrid ruling's view, merely
holds money for staff.

What points each way, for a restaurant:

| Points to counting | Points to not counting |
| --- | --- |
| LGSS art. 147.1: total pay «por razón del trabajo que realice por cuenta ajena» | STS 635/2021 (via a publisher's copy): tips are not salary, except in casinos |
| Art. 147.2: «Únicamente no se computarán en la base de cotización los siguientes conceptos:» Tips are not listed | STS 692/2021: hospitality tips are different |
| The TGSS table has no excluded code to use (§5.4) | The money comes from a third party |
| STS 635/2021 denies only "salary". Art. 147 is wider than salary: our reading | |

**Proposed answer for a yes or no:** card tips paid through payroll count for contributions and are
reported under code 0001, which is the cautious reading. This is the one real judgement call on tips.
An inspection is the only thing that would test it, and we found no ruling or TGSS statement on a
restaurant. Ask the adviser to say so in writing.

### L6.4 NARROWED: reporting

LGSS art. 147.3 requires every pay item to be reported (A793 research §4). The TGSS manual
"Comunicación de conceptos retributivos abonados", updated to 1 July 2026, has Table 84 with 62 codes.
**None mentions tips.** The catch-all is 0001, «RETRIBUCION NO INCLUIDA OTROS APARTADOS», marked as
included in the base and not excluded. Its note 4 says that for a code marked NO under exclusion

> «no se podrá remitir información sobre importes con el correspondiente CÓDIGO como concepto
> retributivo excluido de la base de cotización»

no amounts can be reported as excluded. Our reading: there is no slot for a tip outside the base.
That supports the proposed answer, and it is an administrative table, not a legal ruling.

### L6.2 NARROWED: documenting and importing

Proposed: A793's statement gives one amount per person per month; the gestoría adds it as a separate
line of the payslip, and it travels in the payroll file. Yes or no? Records of the daily shares stay
in Waitron as evidence (§6).

### L6.8 NARROWED: sharing rule

**The premise holds.** The Catalan agreement has no word for tips: a search for "propin" finds nothing
in either language version, nor in ALEH VI or its 2026 amendment. Art. 35.3 keeps the old service
percentage only for businesses already on it at 31 December 2007, «lo mantendrán excepto que haya
acuerdo expreso en sentido contrario». A new deli is outside that (our reading).

Authority, none binding in Catalonia. No TSJ Catalonia ruling was found.

- **TSJ Madrid, 31/05/2023.** Still read only secondhand (Eduardo Rojo's blog, and Economist & Jurist:
  «han de ser repartidas de manera equitativa entre todos los trabajadores de dicho departamento»).
- **TSJ País Vasco, 18/07/2017, appeal 1337/2017**, now with a number, through laboral-social.com's
  summary: «no admite que las propinas entregadas según ese uso social se repartan excluyendo a una
  parte del personal».
- **TS 635/2021:** temporary staff cannot be left out, and ending an existing practice needs the ET
  art. 41 procedure (A793 research §4).

**Proposed answer for a yes or no:** with no agreement, card tips go to everyone who took part in the
service, room and kitchen, temporary staff included, in equal shares. Then one narrow question: may a
share follow hours worked rather than equal heads, when the business has no representatives? The
Madrid wording allows a different rule only by a representatives' agreement, so this is not settled.

**L6.8v, VENUE:** does the deli already share tips some way? If so, changing it needs the formal
procedure.

## 6. Q48, labour part: what to keep

**Still makes sense?** Yes. No enquiry has been sent. Six years stays the discussion figure. Much of
it is a list the law gives. Whether keeping things *longer* than the labour minimum is proportionate
is the privacy adviser's question (Q48 privacy), not this one.

| Ref | Record | Minimum | Source | Outcome |
| --- | --- | --- | --- | --- |
| Q48.1 | Daily time record | Four years | ET art. 34.9 | ANSWERED |
| Q48.2 | Part-time month summaries | «durante un periodo mínimo de cuatro años» | ET art. 12.4.c | ANSWERED |
| Q48.3 | Payslips, kept with contribution papers | «durante un período mínimo de cinco años» | Order of 27 Dec 1994, art. 3 | ANSWERED |
| Q48.4 | Registration, cover and contribution papers | «por un período mínimo de cuatro años» | RD 84/1996 art. 52.1; LISOS art. 21.1 | ANSWERED |

**Two sources, two paths.** LISOS art. 21.1 makes it a minor offence not to keep payslips and
contribution papers «durante cuatro años», while the 1994 order says five. The offence and the keeping
duty are separate rules. **Keep five.** That order's art. 3 names "boletines de cotización", the old
paper form. Whether today's electronic contribution records are the same thing is our reading.

**Q48.5, NARROWED.** Absences. No specific period was found. Proposed: an absence that changed pay
follows the payroll period; the rest follow rotas. Yes or no? Note `absences` are mutable planning
rows, so they are weak evidence.

**Q48.6, NARROWED.** Rotas. No duty to keep them was found in the texts read (that is not proof none
exists). The inspectorate says a general schedule does not prove the record (Criterio Técnico 2.º).
Proposed: keep only as evidence in a claim. Yes or no?

**Q48.7, ANSWERED.** Six years exceeds every fixed labour period read here: 4, 4, 5 and 4. So six years
meets them; whether it is too long is for the privacy adviser.

**Q48.8, NARROWED.** Minimum identity. ET art. 34.9 says only "each worker". The draft asks for
personal data strictly needed. A summary of STS 1161/2024 (BBVA) says giving representatives names,
province and town with each entry meets the test of «pertinentes, mínimos, proporcionados y
necesarios». Draft art. 6.2 would bar ID numbers and addresses from their copy. Waitron's
representatives' default removes contact details and ID numbers, and keeps names, which fits.
Proposed: employer's copy keeps name plus tax or Social Security number; representatives' copy, the
name. Yes or no? This also closes "Advisor review of the working-time export".

**Q48.9, ANSWERED.** Corrections. No rule in force says how. Waitron's approach (a change needs the
worker, a disagreement keeps both) already meets draft arts. 2.2.b and 4.b.

**Q48.10, ANSWERED.** Access. ET art. 34.9 names staff, representatives and the inspectorate. Whether
to log who viewed what is a privacy matter; no labour text read asks for it.

**Q48.11, NARROWED.** Claims. These are the general periods. A pending claim or inspection overrides
them, and which exist is the venue's fact.

| Clock | Period | Source |
| --- | --- | --- |
| Employment-contract claims | One year after the contract ends | ET art. 59.1 |
| Money claims | One year from when they could be brought | ET art. 59.2 |
| Dismissal | 20 working days | ET art. 59.3 |
| Labour offences | Three years | LISOS art. 4.1 |
| Social Security offences | Four years | LISOS art. 4.2 |
| Contribution debts | Four years | LGSS art. 24.1 |
| Interruption of limitation | Claims and acknowledgements restart it | Civil Code art. 1973 (A664 register) |

Proposed: nothing is released while a claim or inspection is open, on top of the shared schedule. Yes
or no?

**Q48.12, VENUE.** No text read says who lifts a hold. The duty sits on the employer, so our proposal
is that the owner decides, on the adviser's advice, and the decision is recorded. It is a process
choice, not a paid legal question.

**Account closure.** No text read ties these periods to an account, and the duties run whether or not
the person still works there. The question's last sentence is a proposal, not a query.

## 7. L7(b): contributions

**Still makes sense?** Yes, but its useful part is the data list, and the first part is answered.

**L7b.1, ANSWERED.** Orden PJC/297/2026, the 2026 contribution order, contains no hospitality-specific
rate or bracket. "Hosteler" appears nowhere in it; as controls, "hogar" appears 6 times and "agrari" 18.
As we understand it, accident cover rates go by activity code, which the gestoría sets and Waitron
does not touch; that tariff was not read.

**L7b.2, VENUE.** There is one hospitality bonus. RDL 1/2023 art. 30 (last update shown 02/09/2026):
businesses in tourism, and in commerce and hospitality

> «siempre que se encuentren vinculados a dicho sector del turismo»

which produce in February, March and November and

> «inicien y/o mantengan en alta durante dichos meses la ocupación de las personas trabajadoras con
> contratos de carácter fijo-discontinuo»

> «podrán aplicar en dichos meses una bonificación en la cotización, en los términos establecidos en
> el artículo 10, de 262 euros/mes»

may take €262 a month. It needs seasonal contracts and a link to tourism. Art. 31's sector bonuses are
for Ceuta and Melilla. Does a Barcelona deli qualify? It first needs fixed-discontinuous staff, which
is a fact the gestoría has. If it has them, whether it is "linked to tourism" is the gestoría's routine
call. Waitron needs to add nothing: the gestoría knows who is on the books in those months.

**L7b.3, NARROWED. Proposed answer:** Waitron gives these, and nothing else is needed.

| Data | Why | Source |
| --- | --- | --- |
| Overtime for emergencies, apart from other overtime | Different rates: «se efectuará aplicando el tipo del 14,00 por ciento» against «se efectuará aplicando el tipo del 28,30 por ciento» | Order art. 5; LGSS art. 149; TGSS codes 0002 and 0003 |
| Complementary hours, agreed apart from voluntary | Separate codes, «HORAS COMPLEMENTARIAS PACTADAS» and «HORAS COMPLEMENTARIAS VOLUNTARIAS» | TGSS 0057, 0058 |
| Holiday days unused at the end | «VACACIONES RETRIBUIDAS Y NO DISFRUTADAS: COTIZACIÓN TRAS FIN CONTRATO» | TGSS 0006 |
| Tips through payroll | §5 | TGSS 0001, if confirmed |

Contracts under 30 days carry a surcharge, «tendrán una cotización adicional de 33,62 euros a cargo del
empresario a la finalización del mismo» (order art. 28), worked out from dates the gestoría has.

**Product gap.** Waitron holds neither split today, so an "emergency" mark on overtime is the one new
field. Draft decree art. 3.f asks for the same thing.

---

## Corrections and follow-ups for the repository

None applied here.

1. `asesor-laboral-questions.md` L1: opinion date is 19 March 2026; L1's "automático" and
   "interoperable" do not describe the draft read.
2. L2 and the consultas wording: "provincial" should be "interprovincial"; "plus de jornada partida"
   does not exist here.
3. `convenio_config` defaults for Barcelona: §2's table. There is no yearly-hours limit and no
   split-shift rule, and `breaks_count_as_worked`'s description does not fit this agreement.
4. A793 research §3: the cash question is narrowed, §5 above. §4: add STS 692/2021 and the TGSS table.
   §2 cites the Catalan agreement 2022–2024; art. 35.3 stands in the 2025–2028 text.
5. L5's wording: "vacaciones pendientes" is not a figure Waitron holds.
6. Part-time excess shown as overtime, §2.
7. The consultas should say the deli's agreement and ask the narrowed questions, not the open ones.

## What could not be verified

- **Whether a decree is approved after 6 Nov.** Recheck the BOE before sending. The 20 Oct government
  meeting record was not retrieved; the BOE search covers it, by title only.
- **The February 2026 draft's text.** Only the Consejo de Estado's description was read, through
  laboral-social.com's copy. The October 2025 draft was read on an employers' body's copy.
- **Court texts.** poderjudicial.es returned a search page, not the ruling, for STS 1161/2024 and the
  30 May 2023 ruling, so both come from a commentary site's summaries. STS 692/2021 is from Normacef's
  copy. TSJ Madrid and País Vasco are secondhand. The casino rulings it cites were not read.
- **No Catalan High Court ruling on tips** was found. That is a failed search, not proof of none.
- **Payroll layouts.** No official a3, Sage or Nominasol import specification was found. Nominasol
  gave nothing usable. The Sage material is a forum reply about Sage 200.
- **Accident-cover rates and art. 10 of RDL 1/2023** were not read. Whether the deli is "linked to
  tourism" is not settled by anything read, and no list of activity codes was found.
- **"No rule found"** for rotas, absences and who lifts a hold means none in the texts read.
- **The six-month against one-year dispute** on small businesses is press only.

## Source register

Retrieved 2026-11-06. BOE consolidated texts show their "last update".

| Source | Address | Status |
| --- | --- | --- |
| Workers' Statute | [BOE-A-2015-11430](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430) | Read; last update 21/10/2026 |
| LISOS | [BOE-A-2000-15060](https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060) | Read; 03/10/2026 |
| LGSS | [BOE-A-2015-11724](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11724) | Read; 21/10/2026 |
| RIRPF | [BOE-A-2007-6820](https://www.boe.es/buscar/act.php?id=BOE-A-2007-6820) | Read; 07/10/2026 |
| LIRPF | [BOE-A-2006-20764](https://www.boe.es/buscar/act.php?id=BOE-A-2006-20764) | Read |
| RD 1561/1995 | [BOE-A-1995-21346](https://www.boe.es/buscar/act.php?id=BOE-A-1995-21346) | Read; 02/07/2020 |
| RD 2064/1995 | [BOE-A-1996-1579](https://www.boe.es/buscar/act.php?id=BOE-A-1996-1579) | Word search; 10/07/2024 |
| RD 84/1996 | [BOE-A-1996-4447](https://www.boe.es/buscar/act.php?id=BOE-A-1996-4447) | Read; 30/07/2026 |
| Order of 27 Dec 1994 | [BOE-A-1995-912](https://www.boe.es/buscar/act.php?id=BOE-A-1995-912) | Read; 11/11/2014 |
| Orden PJC/297/2026 | [BOE-A-2026-7296](https://www.boe.es/buscar/act.php?id=BOE-A-2026-7296) | Read |
| RDL 1/2023 | [BOE-A-2023-625](https://www.boe.es/buscar/act.php?id=BOE-A-2023-625) | Read; 02/09/2026 |
| ALEH VI and amendment | [BOE-A-2023-6344](https://www.boe.es/buscar/doc.php?id=BOE-A-2023-6344), [BOE-A-2026-18630](https://www.boe.es/buscar/doc.php?id=BOE-A-2026-18630) | Word search; amendment passages read |
| BOE daily summaries | `https://www.boe.es/datosabiertos/api/boe/sumario/<yyyymmdd>` | 268 issues, 1 Jan to 6 Nov 2026 |
| Catalan agreement | [DOGC 9630 (Spanish)](https://portaldogc.gencat.cat/utilsEADOP/AppJava/PdfProviderServlet?documentId=1040087&language=es_ES&type=01), [Catalan](https://portaldogc.gencat.cat/utilsEADOP/AppJava/PdfProviderServlet?documentId=1040087&language=ca_ES&type=01) | Read |
| Its correction | [DOGC 9701](https://portaldogc.gencat.cat/utilsEADOP/PDF/9701/2159936.pdf) | Read |
| Criterio Técnico 101/2019 | [Diputació de Barcelona copy](https://cemical.diba.cat/sites/cemical.diba.cat/files/public/adjunts/actualitat/relacionades/criterio_tecnico_registro_jornadaMTMSS_06_2019.pdf) | Read; a copy of the ministry's document |
| Draft decree, Oct 2025 | [CEOE Cantabria copy](https://ceoecantabria.es/wp-content/uploads/2025/10/4.-Registro-de-jornada-laboral.pdf) | Read; a copy |
| Impact report, Oct 2025 | [Ministry](https://expinterweb.mites.gob.es/participa/listado/download/5fd66b30-716b-4d20-b986-da3257649677) | Read in part |
| Consejo de Estado 188/2026 | [laboral-social.com copy](https://www.laboral-social.com/sites/laboral-social.com/files/188_2026.pdf) | Read in part; a copy |
| Government meeting records | `lamoncloa.gob.es/consejodeministros/referencias/Paginas/2026/<date>-referencia-rueda-de-prensa-ministros.aspx` | 6, 13, 27 Oct, 3 Nov read; 20 Oct 404 |
| Press on timing | [Demócrata, Europa Press, 5 Oct 2026](https://www.democrata.es/economia/la-reforma-del-registro-horario-aun-podria-aprobarse-antes-de-las-elecciones-del-29n/), [FichMe, 5 Oct 2026](https://fichme.com/noticias/registro-horario-digital-ultima-hora) | Read; not official |
| TGSS CRA manual | [seg-social.es](https://www.seg-social.es/descarga/es/188863) | Read; updated to 1 July 2026 |
| DGT rulings | `https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=<number>` | 1866-03, 2174-03, 1763-99, V2236-13, V1021-23 read; all "propina" and "propinas" results scanned |
| STS 692/2021 | [Normacef NSJ063859](https://normacef.es/buscaResult/shDocumento.aspx?id=NSJ063859&tkId=7fa929d0-51a3-41fe-9eed-3dd5384e2b2b&op=rtss) | Read; a publisher's copy |
| STS 1161/2024 and 41/2023 | [cuestioneslaborales.es](https://www.cuestioneslaborales.es/jurisprudencia/sts-2024-09-24-registro-jornada-autorizacion-datos/) | Summary only |
| STS 30/05/2023 | [cuestioneslaborales.es](https://www.cuestioneslaborales.es/jurisprudencia/sts-2023-05-30-horas-extraordinarias-abono-calendario/) | Summary only |
| TSJ Madrid 31/05/2023 | [Economist & Jurist](https://www.economistjurist.es/actualidad-juridica/jurisprudencia/las-propinas-recibidas-con-tarjeta-deben-repartirse-entre-todos-los-empleados) | Secondary |
| TSJ País Vasco 18/07/2017 | [laboral-social.com](https://www.laboral-social.com/sector-hosteleria-camareros-no-pueden-dejar-fuera-reparto-propinas-resto-personal-servicio-sala-cocina.html) | Summary only |
| a3 brochure | [Wolters Kluwer](https://assets.contenthub.wolterskluwer.com/api/public/content/40ac6409668f4dea97af7471a80ef0b3) | Word search |
| Sage forum | [communityhub.sage.com](https://communityhub.sage.com/es/sage-200/f/laboral/226136/incorporacion-de-incidencias-masivas) | Read; a forum reply |
| Trade guide to the agreement | [turnozo.com](https://turnozo.com/es/blog/convenio-hosteleria-barcelona-2026) | Used only to find the DOGC address |

**Not retrieved.** HSF Kramer's note (403). poderjudicial.es ruling pages (a search page, not the
ruling). The Consejo de Estado opinion on BOE at the address tried (404). La Moncloa's 20 Oct page
(404). The ministry's participation pages did not list the draft.
