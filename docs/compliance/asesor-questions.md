# Questions for the asesor

Companion to [verifactu-findings.md](verifactu-findings.md), which records what is already
settled. **Do not ask about anything in that document** — it is sourced from AEAT and BOE
primary texts. These are the items that research could not resolve.

Each question has English context (for us) and a Spanish formulation (to hand over).

Question numbers are **stable identifiers**, not reading order — sections are ordered by
priority. Q9 is referenced from other documents; do not renumber it.

Last revised **2026-08-26** — Q17 (F3 *canje*) and Q18 (*modelo 303* IVA soportado) added, Q16
sharpened; see the 2026-08-26 banner. Prior substantive pass **2026-08-01**.

> **⚠ Read before sending, 2026-08-01.** Two architecture designs and one research pass have moved
> this list since the questions below were written. Read this before paying for any answer.
>
> **Newly closed on primary source (2026-08-01) — do not ask.** **Q13 (propinas)** and the core of
> **Q15 (short payment)** are answered and moved to [verifactu-findings.md](verifactu-findings.md)
> §§11–12. A voluntary tip is not *contraprestación*, so it sits outside the base imponible del IVA
> (off the factura, off the huella) whether paid in cash or on the same card capture that pays the
> bill — the test is *voluntariedad*, not payment method (DGT 2174-03, V3095-17, V1808-22). A short
> payment accepted as payment in full **before the factura is issued** is a *descuento* excluded from
> the base (LIVA art. 78.Tres.2º); once the factura is issued, correcting it needs a rectificativa.
> The residuals are product/interpretive, not fiscal — see the findings. (Caveat recorded there: the
> DGT consultas were read via reproduction because PETETE failed TLS validation; confirm the exact
> wording on PETETE if an asesor engages.)
>
> **① Server-as-SIF** ([`../superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md`](../superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md), #33).
> The unit AEAT holds responsible for issuing invoices — the SIF — is the **local server**, not the
> till. Consequences for this list:
>
> - **Q1 is moot.** A till need not qualify as a SIF, so nobody must argue it is; server + tills are
>   plainly one real-time integrated system → one SIF, one chain.
> - **Q2 is non-load-bearing.** The SIF files its own records. (It is separately CLOSED favourably on
>   primary source anyway, so the relay pattern remains available regardless — the design just no
>   longer *depends* on it.)
> - **Q5(a) is reshaped.** A series now belongs to the **server**-SIF, and a venue runs **two**
>   concurrent SIFs (active-active). They must issue under **DISJOINT series**, or their records
>   collide on the identity triple `(NIF, NumSerieFactura, FechaExpedicionFactura)` → AEAT error 3000
>   — the installation number is **not** part of the triple. See design §3 and Q5's own banner.
> - **New hosting question — Q16.** A cloud server that *issues* invoices operates the **SIF abroad**,
>   a stronger case than merely conserving records. Under a cloud-primary or standalone topology it is
>   the **normal** operating state, not a disaster edge, so it must be answered before those topologies
>   are offered. This absorbs the cloud-custody angle of Q11/Q12 (design §13, §9).
>
> **② Cloud storage** ([`../superpowers/specs/2026-07-31-cloud-storage-model-design.md`](../superpowers/specs/2026-07-31-cloud-storage-model-design.md), #19).
> The cloud is a **sync root, not a system of record**: it never holds the key ring, the fiscal
> certificate stays on the client's own local server (the SIF, per #33) sealed under a key ring only
> they hold, and the local server always submits. So any question premised on Waitron **hosting the
> client's fiscal system** buys an answer to a situation that will not exist in the default
> architecture:
>
> - **Q11 and Q12** are premised on that retired model — see their own banners. Custody by Waitron
>   survives only in the opt-in cloud-primary/standalone topology, where it merges into **Q16**.
> - The replacement questions are about the **ROF** (RD 1619/2012 — conservation of records), **not**
>   the RRSIF. The reasoning (a reasoned reading, not a settled point): the RRSIF governs invoicing
>   *systems*, and an archive issues nothing, so it is **probably** out of RRSIF scope — cloud-storage
>   §8 leaves open what follows if it is not. Either way the ROF governs records once they exist. The
>   three questions are written out in that spec's **§8a**:
>   1. Is Waitron a *tercero* under ROF art. 19.3 while the client's own server remains the system of
>      record — or only in the disaster case, when our archive is briefly the only copy?
>   2. If so, does art. 22.2's prior-notification duty fall on every client whose records we hold
>      outside Spain, and must we prompt them to discharge it?
>   3. Does art. 23's online-access requirement reach us as holder, or only the client as obligado?
> - **Do NOT re-add** the retired *"does the RRSIF reach a backup archive that is not itself a SIF?"*
>   question — the spec answered it itself and it aimed at the wrong regulation (#22).
>
> Individual questions below are left as written, with dated banners, rather than rewritten in place,
> per `CLAUDE.md` §6.

> **⚠ Read before sending, 2026-08-26.** Three fiscal features have landed since the 2026-08-01 pass.
> They add two questions and sharpen one; nothing already closed reopens.
>
> - **Q17 (F3 *canje*) and Q18 (*modelo 303* IVA soportado) added** — see the new *FISCAL FILINGS*
>   section. Both features are **built**, so neither blocks anything; but each carries a point the
>   asesor must confirm **before the first LIVE filing** (a foreign-recipient `IDType` shape and an
>   XSD confirmation for F3; the prorrata base treatment for 303).
> - **Q16 sharpened, not rewritten.** The distribution & client-topology design
>   ([`../superpowers/specs/2026-08-15-distribution-and-client-topology-design.md`](../superpowers/specs/2026-08-15-distribution-and-client-topology-design.md), #86)
>   makes cloud-hosted a first-class **planned** mode, so Q16 is no longer the hypothetical
>   "only if a topology is offered" it was written as — it **gates a mode already on the roadmap**.
>   Draw the line at production: the cloud **trial** on-ramp (preproduction, shared demo tenant, no
>   real fiscal records) needs no answer; only **production-cloud-primary** does. Banner added at Q16.
> - **Not for this list, but noted:** the *laboral* questions (the convenio overtime rule, D3 payroll,
>   the *retención* on card-collected tips redistributed through a tronco per V3095-17) still have **no
>   home document**. They are for a *graduado social / asesor laboral*, not the fiscal asesor — flagged
>   so they are not lost, not because they belong here.

---

## mdiago's replies — 2026-07-27

The maintainer of [`mdiago/VeriFactu`](https://github.com/mdiago/VeriFactu) answered the
simplified Spanish list sent to a fellow implementer (kept out of this repository).

> **Status: a peer's view, backed in part by their in-house tax advisers. Not binding, not
> primary source.** Where a reply conflicts with something verified from AEAT or BOE text, the
> primary source wins and the conflict is recorded at the question.

| Q | Outcome |
| --- | --- |
| Q1 per-till SIF | Corroborated — then **CLOSED on primary source** (developer FAQ §4 + §5) |
| Q2 relayed transmission | Endorsed — then **CLOSED on primary source** (developer FAQ §5) |
| Q3 deliberate offline | **Answered — unfavourably.** Effectively closed |
| Q4 mixed modes | **Answered.** Closed |
| Q7 installation number | Partly answered — and reveals a practice we should *not* copy |
| Q8 clock | **Answered.** Closed — moved to [verifactu-findings.md](verifactu-findings.md) |
| Q9 source-available DR | **Substantially answered**; part (b) narrowed considerably |
| Q10 certificate gap | **Dissolved** — the premise was wrong; overlap two certificates |
| Q11 client key custody | Unanswered directly; answered by routing around it — see Q12 |
| — | New **Q12** on convenio 017, arising from their answer |

**A caveat on weighting their SaaS answer.** Their published product is a *library*, not a
billing system, which at first reading makes their view on hosted deployments advisory rather
than operational. It is more than that — Irene Solutions also runs a hosted REST API sold on
*"sin la complicación de preocuparnos de la gestión de certificados digitales"*, so they are
describing a model they actually operate. But that model is a **submission service behind
someone else's SIF**, not a hosted SIF. Their answer is good evidence for how a transmitter
should be set up, and weak evidence about our shape.

**Outstanding reciprocal obligation.** They could not locate the ERP-modules FAQ that Q1 rests
on and asked for the text. We offered to give back — send it.

---

## Who to ask

**Primary — an asesor fiscal who has implemented a SIF.** Not a generalist gestor. These are
technical questions about the architecture of the invoicing system, and a tax filer will
answer the easy half ("yes, multiple series are fine") while missing the part that matters.
Ask up front whether they have advised on or certified a SIF.

> **Superseded 2026-07-27.** Q1 and Q2 no longer justify a consulta — see their notes. **Q9(a)
> is now the only item worth filing**, and it is a lawyer's question rather than an asesor's.
> The paragraph below is retained because the reasoning about *when* a consulta is worth it
> still applies.

~~**For Q1 and Q2 specifically — consider a consulta vinculante to the DGT.**~~ This is the only
route to a binding answer. Free, but 3–6 months. Both questions are load-bearing enough that
filing early and building on the provisional answer is defensible.

**Also worth trying — AEAT's Verifactu technical channel for developers.** Faster than DGT
and more likely to engage with the encadenamiento scoping directly. Non-binding.

**Q9 is not for the asesor fiscal.** It concerns liability for distributing source-available
software rather than the operation of our own SIF, and carries the largest financial exposure
here. Take it to a lawyer, and file **Q9(a)** as a DGT consulta vinculante — on its own, now
that Q1, Q2 and Q9(b) have all come off the list.

---

## ~~BLOCKING~~ — both CLOSED 2026-07-27

> **Nothing in this document blocks the build, and these two are not merely demoted — they are
> answered by AEAT's own text.** Both fell to a single source: the developer FAQ v1.3, §4
> *"Cómo identificar un SIF"* and §5 *"Arquitecturas de los SIF"*.
>
> Do not ask either. **Do** read the conditions §5 attaches to the split architecture — they are
> binding design constraints, recorded in [verifactu-findings.md](verifactu-findings.md).
>
> Both questions are retained in full, with the pre-source reasoning intact, so that a future
> reader can see what was inferred and what was sourced.

### Q1. Is a till that syncs to a shared backend within minutes an independent SIF?

> **Also moot under the server-as-SIF design, 2026-08-01 (#33).** That design makes the *server* the
> SIF, so whether a *till* qualifies as one no longer arises; the already-closed **Q2** (relayed
> submission) becomes non-load-bearing; and **Q5(a)** (one series per till) is reshaped — a series now
> belongs to the server-SIF, and two concurrent SIFs must issue under disjoint series. See
> [`../superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md`](../superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md)
> §§1, 3, 11. A full re-read of this list against the new architecture is a backlog task.

> 🟢 **CLOSED 2026-07-27 on primary source, same trip as Q2.** The developer FAQ answers the
> sync-frequency worry twice over:
>
> **§5** blesses the exact configuration — a till that generates the RF itself, prints the QR,
> hands over the invoice, *"y en tiempo real traslade todo ello al backoffice central"*. Real-time
> connection to a central server is expressly contemplated and does **not** collapse the tills
> into one SIF. The ERP-modules FAQ we were worried about concerns modules that do *not* generate
> locally; ours do.
>
> **§4** then confirms the partitioning directly: where one product carries several facturaciones
> — different OEFs, or one OEF's *"distintos centros de facturación independientes, como
> tiendas"* — each needs its own installation number *"porque **se consideran SIF
> independientes, como si fueran «SIF virtuales»**"*.
>
> Both are recorded in [verifactu-findings.md](verifactu-findings.md). **Do not ask this.**

The corroboration that preceded the source, retained because it is what justified building on:

> mdiago runs exactly this shape in
> production: chains are keyed per installation number, one per till, and *"todos nuestros
> sistemas envían de forma inmediata en cuanto hay conexión"* — i.e. frequent sync with
> independent per-till chains, which is precisely the configuration Q1 worried about. They state
> AEAT permits it (*"lo cual está admitido por la AEAT"*,
> [discussion #214](https://github.com/mdiago/VeriFactu/discussions/214)) and have never been
> challenged on it.
>
> Combined with the AEAT trazabilidad FAQ already quoted in
> [verifactu-findings.md §1](verifactu-findings.md) — *"cada TPV se considera que es un SIF"* —
> the residual risk is small. What is still missing is any primary source addressing **sync
> frequency** specifically, which is the narrow thing Q1 actually asks. Worth raising if an
> asesor is already engaged; no longer worth blocking on or filing a consulta for.

**Why it matters.** Per-till chains are lawful only if each till is its own SIF. AEAT's
ERP-modules FAQ contrasts real-time centrally-controlled modules (one SIF, one chain) against
decentralised modules uploading *monthly* (separate SIFs). We sit between them, and AEAT's
wording is hedged (*"puede entenderse"*). If this resolves against us, per-till chains
collapse into one chain per issuer, which would require asking a server for the next chain
position before completing any sale — breaking offline operation entirely.

> Un TPV genera localmente y de forma autónoma sus propios registros de facturación de alta,
> su huella y su código QR, sin conexión en tiempo real con ningún sistema central y sin ser
> controlado por él. Puede operar así indefinidamente. Cuando hay red, sincroniza con un
> servidor común (local o en la nube) en cuestión de minutos.
>
> **¿Se considera cada TPV un sistema informático de facturación independiente a efectos del
> artículo 7.c) de la Orden HAC/1177/2024, con su propia cadena de registros de facturación?**
>
> La FAQ de la AEAT sobre módulos de un ERP contrapone módulos interconectados y controlados
> en tiempo real (un solo SIF, un solo encadenamiento) frente a módulos inconexos que remiten
> los registros al ERP una vez al mes (SIF diferentes). Nuestro caso es intermedio: la lógica
> obligatoria es descentralizada, pero la sincronización es frecuente.
>
> ¿Qué factor es determinante — dónde se genera el registro, o con qué frecuencia se
> sincroniza? ¿Existe algún umbral de frecuencia a partir del cual la AEAT consideraría que
> los TPV forman un único SIF?

### Q2. May a node other than the till transmit the till's records to AEAT?

> 🟢 **CLOSED 2026-07-27 on primary source. Do not ask this.** AEAT's developer FAQ v1.3 §5
> *"Arquitecturas de los SIF"* describes our design and declares it valid:
>
> > Alternativamente […] igualmente sería válida una arquitectura en la que sea **la propia TPV
> > la que genere el "Registro de alta de factura" directamente**, procediendo también a su
> > impresión con el código QR y entrega al cliente, y en tiempo real traslade todo ello al
> > backoffice central, **para que este último sistema proceda a su envío a la sede electrónica**
> > en la modalidad VERI\*FACTU. Ese **backoffice haría de instrumento para la remisión del
> > fichero sin más**.
>
> That is Waitron, sentence for sentence. AEAT also states the general principle: *"las
> arquitecturas «mixtas», que son aquellas en las que intervienen varios programas, componentes
> o sistemas, incluso de fabricantes distintos, no son contrarias a la normativa y pueden
> utilizarse."*
>
> **The conditions it attaches are now implementation requirements**, recorded in
> [verifactu-findings.md](verifactu-findings.md). The load-bearing one: the link between till and
> backoffice must be *"indefectible y necesaria […] no quede a decisión del usuario"*, with no
> orphaned invoices or records in either direction.
>
> This was findable all along — [who-to-ask.md](who-to-ask.md) flagged §5 as answering Q2 and
> noted the PDF resists normal fetching. It needed downloading and extracting locally, which
> nobody had done. **Lesson: when a research note says a source resists fetching, that is a task,
> not a footnote.**

The reasoning that demoted it before the source was found, retained because it held up:

> mdiago endorsed the design directly (*"me parece la opción más adecuada"*, on security and
> chain-clarity grounds) but offered no source, and did not engage with the *volcado* FAQ. That
> alone would not be enough. What settles it is four things pointing the same way:
>
> 1. **Proof by existence.** Irene Solutions' hosted REST API *is* a central service transmitting
>    records generated by someone else's SIF, sold as a product, running for years. If relayed
>    transmission were prohibited, that product could not exist.
> 2. **AEAT built a route for it.** Convenio 017 exists precisely so a software company can
>    submit records on behalf of third parties. If a *different legal person* may transmit for
>    you, a different *machine within your own system* plainly may.
> 3. **The rule says "capacidad".** Art. 8.1 requires the SIF to *"tener capacidad de remitir"* —
>    a property of the system, not an instruction about which process opens the socket.
> 4. **Every cloud POS on the market works this way.** A reading that forbids it would make the
>    entire hosted segment non-compliant, which is not a reading AEAT can have intended.
>
> **The volcado prohibition is about *when the record is generated*, not who transmits it.** Its
> stated rationale — *"los clientes ya se habrán llevado las facturas impresas"* — is a complaint
> that nothing was recorded at the point of sale. Our tills record at the point of sale. That is
> the distinction the FAQ is drawing, and we are on the right side of it.
>
> **What actually remains is an implementation requirement, not a question:** the record must
> carry the **generating till's** `IdSistemaInformatico` and `NumeroInstalacion`, never the
> relaying node's. The relay is a transport detail; the SIF identity in the record is not. Get
> that wrong and the objection becomes real, because the records would then genuinely claim to
> have been produced centrally.
>
> Residual timing worries are not Q2 — they are Q3, which is answered.

**Why it matters.** Our design deliberately keeps the fiscal certificate off tills sitting on
counters — records chain at the till, flow upstream, and the nearest node holding the
certificate submits. This resembles the pattern AEAT rejected as *"remisión en diferido"*,
though that FAQ's stated rationale (the customer already left with a printed invoice)
arguably confirms the till is the SIF rather than prohibiting relayed transmission. If the
answer is that the SIF itself must transmit, certificates land on every till and the security
model changes substantially.

> Nuestro diseño mantiene el certificado fiscal fuera de los TPV por seguridad — un TPV es una
> tablet en un mostrador. Los registros se encadenan en el TPV, se transmiten al nodo superior
> (servidor local o nube) y **ese nodo, que custodia el certificado, los remite a la AEAT** en
> nombre del obligado tributario, normalmente en segundos.
>
> **¿Es válida esta remisión delegada, siendo el TPV el SIF que genera el registro pero no
> quien abre la conexión con la AEAT?**
>
> El artículo 8.1 del RD 1007/2023 exige que el SIF "tenga capacidad de remitir" — ¿se cumple
> esa capacidad si la remisión se ejerce a través de un nodo superior del mismo sistema?
>
> Nos preocupa la FAQ de la AEAT que rechaza el "volcado" al final del día de los registros de
> un sistema desconectado a un sistema conectado para su remisión. Entendemos que esa
> prohibición se refiere a tratar el sistema central como el punto de expedición (el
> razonamiento de la AEAT es que "los clientes ya se habrán llevado las facturas impresas"),
> y no a la mera transmisión técnica por cuenta del SIF que sí expidió. **¿Es correcta esa
> lectura?**

---

## DEMOTED — no longer gating

> **Q3 and Q4 below were demoted** when we decided to build Veri\*Factu mode only and defer
> non-Veri\*Factu until a user actually needs it. Both questions only bite for users with no
> usable connectivity, which no current deployment has. Worth asking if the asesor is already
> engaged — not worth waiting on, and not worth a consulta.

## IMPORTANT — affects scope and product shape

### Q3. Is an intentionally-offline till in Verifactu mode compliant?

> **Answered — and the answer is no.** mdiago: *"según el sentido de la norma, el concepto de
> «incidencia» no es compatible con «permanente y conocida de antemano»."*
>
> Short, but it is the reading the wording supports and it matches our own reasoning. Treat as
> settled unless an asesor says otherwise: **a user who knows in advance they have no
> connectivity cannot rely on art. 16.4 and must run non-Veri\*Factu mode.** This strengthens
> rather than weakens the decision to defer non-Veri\*Factu — it just means the deferral has a
> hard edge, and those users cannot be onboarded onto Veri\*Factu as a stopgap.

**Why it matters.** Some users have no usable connectivity and would sync once daily. Art.
16.4 tolerates outages indefinitely provided hourly retries continue, and there is no
deadline — but deliberate offline operation is not an outage. Determines whether these users
can stay in Verifactu mode or must run the substantially more expensive non-Verifactu build.

> Un TPV en modalidad VERI\*FACTU permanece deliberadamente sin conexión durante toda la
> jornada (el usuario no dispone de conectividad fiable), reintentando la remisión cada hora
> sin éxito, marcando `Incidencia="S"` y mostrando el aviso de registros pendientes. Al cierre
> recupera conexión y remite todo en orden cronológico.
>
> **¿Es esto una incidencia técnica amparada por el artículo 16.4 de la Orden HAC/1177/2024, o
> se consideraría de facto la "remisión en diferido" prohibida?**
>
> ¿Cambia la respuesta si la falta de conexión es permanente y conocida de antemano, en lugar
> de sobrevenida? ¿Existe algún criterio sobre incidencias prolongadas o recurrentes?

### Q4. Can one taxpayer run some tills in Verifactu and others in no verificable?

> **Answered — favourably. Close it.** mdiago states the calendar-year lock-in applies **per
> SIF, independently**, not per taxpayer: a new till may be registered in non-verificable mode
> mid-year even where other tills under the same NIF are already sending under Veri\*Factu,
> *"siempre que cada SIF cumpla por sí mismo los requisitos de integridad y trazabilidad."*
>
> They have not seen mixed operation in production — clients run one way or the other — so their
> half of this is doctrine rather than observed practice.
>
> **Upgraded to closed on primary source, 2026-07-27.** Chasing the FAQ text mdiago asked for
> turned up the AEAT answer directly:
>
> > Comercios con múltiples terminales que cada uno es un SIF, ¿pueden comportarse de forma
> > distinta? […] Es lícito disponer de varios SIF, especialmente cuando las necesidades
> > empresariales así lo justifiquen […] **la opción por una u otra modalidad no es conjunta para
> > el obligado a facturar.**
>
> That is AEAT's own text answering the exact question, including the mixed VERI\*FACTU /
> no-verificable terminal pair. **Q4 is settled: the mode election does not contaminate the
> taxpayer's other SIFs.** Do not spend asesor time on it.

**Why it matters.** Mode is per SIF, so per till — but the Verifactu election has a
calendar-year lock-in whose scope (per taxpayer or per SIF) we could not determine. A venue
with one reliable till and one in a dead spot is a realistic configuration.

> La modalidad se elige por SIF, de modo que un obligado tributario puede tener un SIF en
> VERI\*FACTU y otro en modalidad no verificable. Un mismo local podría tener un TPV con buena
> conectividad y otro sin ella.
>
> **¿Es admisible esta configuración mixta dentro de un mismo local y un mismo NIF?**
>
> La AEAT la desaconseja por generar "listados incompletos de facturas emitidas" — ¿supone eso
> algún riesgo real de requerimiento o sanción, o es sólo una molestia administrativa?
>
> Además: la permanencia obligatoria en VERI\*FACTU hasta el fin del año natural, **¿se aplica
> por obligado tributario o por SIF?** Es decir, ¿puede darse de alta un TPV nuevo en
> modalidad no verificable a mitad de año si otros TPV del mismo NIF ya operan en VERI\*FACTU?

### Q5. Series requirements — the part we could not source

> **(b) CLOSED on primary source, 2026-07-31.** RD 1619/2012 art. 6.1.a) makes a specific series
> for rectificativas obligatory *«en todo caso»* — read twice from the BOE. **(c) partly answered**:
> simplified invoices are absent from that mandatory list. **(a) remains open** — the article's
> example is *varios establecimientos*, not several tills in one. See
> [verifactu-findings.md §10.1](verifactu-findings.md). Do not re-ask (b).

> **(a) reshaped by server-as-SIF, 2026-08-01 (#33).** The subject of (a) has changed: under
> [`../superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md`](../superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md)
> a series belongs to the **server**-SIF, not the till, so "one series per till" is no longer the
> shape to ask about. What replaces it is a **hard architectural constraint, not an open question**: a
> venue runs **two** concurrent SIFs (active-active), and AEAT identifies a record by the triple
> `(NIF, NumSerieFactura, FechaExpedicionFactura)` — **not** by installation number — so the two
> servers **must issue under disjoint series**, or a same-day collision on that triple is a duplicate
> (AEAT error 3000). The Spanish below is now best framed as *"¿una serie por SIF-servidor, y qué
> exige que dos SIF concurrentes usen series disjuntas?"* rather than *"una serie por TPV"*. (The
> disaster-*restore* flow is different — the dead server is confirmed dead and numbering resumes above
> a high-water mark on the same series, no concurrency; see cloud-storage §5.)

**Why it matters.** We assume one series per till. Research confirmed the chaining rules but
never verified the underlying series permission in RD 1619/2012 art. 6.1.a. Low risk, but it
is the foundation of the numbering scheme. The rectificativa question is the practical one:
it is the case where a single till needs two series (and, per art. 7.c, still one chain).

> **(a) is superseded — see the 2026-08-01 banner above; do not hand this (a) to an advisor as
> written.** Under server-as-SIF the question is a series per SIF-servidor, with disjoint series
> across the two concurrent SIFs — not "una serie por TPV". Kept verbatim per CLAUDE.md §6.
>
> **(a)** ¿Permite el artículo 6.1.a del RD 1619/2012 que un mismo obligado tributario utilice
> una serie de facturación distinta por cada TPV? ¿Qué exige exactamente "cuando existan
> razones que lo justifiquen" — basta una justificación operativa, debe documentarse, y puede
> la AEAT cuestionarla a posteriori?
>
> **(b)** ¿Deben las facturas rectificativas emitirse obligatoriamente en una serie
> específica, distinta de la de las facturas ordinarias?
>
> **(c)** ¿Y las facturas simplificadas (tickets) frente a las facturas completas — requieren
> series separadas o pueden compartir serie?

---

### Q13. Propinas — outside the VAT base, and off the invoice? (added 2026-07-31)

> 🟢 **CLOSED 2026-08-01 — moved to [verifactu-findings.md §11](verifactu-findings.md). Do not ask
> (a) or (b).** A voluntary tip is not *contraprestación*, so it is outside the base imponible del IVA,
> off the factura and out of the huella — the assumption the schema already encodes. The test is
> *voluntariedad*, **not** payment method, which is what answers (b): **V3095-17** (vinculante) is the
> case where the *house collects the tips into a tronco and redistributes them* — the card-present
> shape — and still holds them outside the IVA base. The card case does, though, create a **non-fiscal**
> duty the cash case does not: a tip collected through the merchant account is *ingreso* for the
> Impuesto sobre Sociedades and *rendimiento del trabajo* (with retención) for the employee. That is a
> workforce/accounting matter, not a fiscal-record one, and a product decision — it does not touch the
> factura or the huella.
>
> **Correction to this question's own citation:** **2174-03 is a consulta GENERAL, not vinculante** —
> the binding restatements are V3095-17 and V1808-22. **(c)** (whether to show the tip on the receipt)
> is the only genuine residual and it is a design choice, not an asesor question: no consulta requires
> it, and if shown it must be an amount *outside* the base imponible. **Provenance caveat:** PETETE
> failed TLS on every fetch, so the DGT consultas were read via faithful legal-database reproductions
> and cross-checked; confirm the exact wording on PETETE if an asesor engages.
>
> **Schema note, 2026-08-02 (#39).** The tip now lives on `tenders.tip_amount` (attributed to the
> payer who left it), not `sales.tip_amount` — #39 took it off the immutable sale row. The fiscal
> path is unchanged: the tip still never reaches `computeHuella`. The current picture is in
> [verifactu-findings.md §11](verifactu-findings.md).

**Why it matters.** The schema already asserts it. `tenders.tip_amount` is documented as the payer's
*"affirmed gratuity, non-taxable and on no invoice"* (the tip moved off the sale in #39), and
`record-sale.ts` hands the fiscal backend only `total`, never the tip, so the tip never reaches
`computeHuella`'s inputs. **None of that was ever put to an
advisor.** The sources are asesor commentary citing **DGT consulta vinculante 2174-03** — the DGT
text itself was not read. If the position is wrong, every invoice we have ever modelled understates
its base imponible, and the tip would have to enter `computeHuella`'s inputs.

The card-present case is the one commentary does not obviously cover: the tip is not a separate
gesture but part of a single card capture that exceeds the invoice total.

> **(a)** ¿Confirma que las propinas voluntarias entregadas por el cliente en un establecimiento de
> hostelería no forman parte de la base imponible del IVA y, por tanto, no deben figurar en la
> factura simplificada?
>
> **(b)** ¿Cambia esa conclusión cuando la propina se cobra junto con el importe de la factura en
> una única operación con tarjeta, de modo que el importe cargado al cliente excede el total
> facturado?
>
> **(c)** ¿Existe alguna obligación de documentar la propina frente al cliente, o basta con el
> justificante de pago de la entidad adquirente? Si la incluimos como bloque informativo separado
> al pie del ticket, ¿hay algún requisito de forma?

---

### Q14. Is a restaurant *precuenta* a *prefactura* for art. 29.2.j LGT? (added 2026-07-31)

> **Still OPEN — bounded search 2026-08-01 found no primary text on point.** A pass over PETETE and
> AEAT material for *"precuenta"* turned up the general prefactura/proforma treatment already in
> [verifactu-findings.md §8](verifactu-findings.md) (a *documento sin validez fiscal* that, once
> *expedido*, carries a preservation duty under art. 29.2.j LGT, amendable via a later logged record)
> but **nothing that names the restaurant *precuenta* specifically**. Whether AEAT's list *albaranes,
> proformas, prefacturas* is exhaustive is the interpretive hinge, and it is unresolved — this is the
> genuinely-still-open one of Q13/Q14/Q15, exactly as anticipated. Keep it for the asesor; do not
> treat the prefactura doctrine as settling the precuenta question.

**Why it matters.** It decides whether printing a bill obliges us to keep an append-only record of
every subsequent change to the order — see [verifactu-findings.md §8](verifactu-findings.md). AEAT's
developer FAQ says preparatory documents *«se expidan»* carry a preservation duty, with alteration
permitted only *«por medio de un registro posterior, que también deberá quedar anotado en el
sistema»*. **Their list reads *albaranes, proformas, prefacturas* and never says *precuenta*** —
treating the restaurant pre-bill as one of that family is our reading, not their word.

Part (b) is the design question: we intend to keep the working order mutable and log amendments,
rather than freezing it.

> **(a)** A efectos del artículo 29.2.j) de la LGT, ¿debe considerarse la "precuenta" que se entrega
> al cliente en un restaurante antes del pago como una prefactura o documento sin validez fiscal,
> con la consiguiente obligación de conservar su registro de forma inalterable?
>
> **(b)** En caso afirmativo, ¿basta con conservar un registro de las modificaciones posteriores,
> anotadas en el propio sistema, manteniendo el pedido modificable — o debe congelarse el estado
> del documento entregado?
>
> **(c)** ¿Debe la precuenta llevar mención expresa de que no tiene validez de factura, y existe
> algún requisito formal sobre su contenido o numeración que evite que se confunda con una factura?

---

### Q15. Short payment — a discount, or a bad debt? (added 2026-07-31)

> 🟢 **Core CLOSED 2026-08-01 on primary law — moved to [verifactu-findings.md §12](verifactu-findings.md).**
> A reduction agreed as payment in full **before the factura is issued** is a *descuento* — LIVA
> art. 78.Tres.2º (*"descuentos y bonificaciones concedidos previa o simultáneamente al momento en que
> la operación se realice"*, verbatim from AEAT's own Manual práctico de IVA) keeps it **out of the
> base imponible**, so the invoice is issued for the amount actually agreed (€65 on a €70 bill), VAT
> on €65. This confirms the design assumption *"the reduction has to reach the bill before the invoice
> is issued"*. **(b)** once the factura is issued, correcting it needs a *factura rectificativa* —
> art. 80.Uno.2º (agreed descuento posterior) or the impractical art. 80.Cuatro incobrable route for a
> genuine impago; for €5 nobody does either. **(c)** cash rounding down is the same *descuento
> simultáneo*, applied before issuance so the invoiced and collected amounts coincide. **Residual:**
> the descuento-vs-impago characterization is interpretive but low-stakes at this size, and the exact
> art. 80.Cuatro thresholds should be confirmed at BOE (findings §12 flags them). Worth a sentence if
> an asesor is engaged; not worth a consulta.

**Why it matters.** It happens at the counter: the bill is €70, the customer is paying cash and is
€5 short, and staff accept €65 as payment in full. The two readings have different consequences and
the till has to record one of them.

- **A discount** — the sale really was €65. Taxable base €65, VAT on €65, one invoice, nothing
  outstanding. The reduction has to reach the bill *before* the invoice is issued.
- **A bad debt** — the sale was €70 and €5 is uncollectible. VAT stays due on €70 unless the base is
  formally modified, which for €5 nobody will ever do.

We assume the first for anything of this size, and want to know where the boundary sits — and
whether the answer changes once the invoice has already been handed over, since then reducing it
requires a factura rectificativa.

Cash rounding is the same shape at higher frequency: if cash totals are rounded to the nearest five
cents, the cash never matches the invoice exactly.

> **(a)** Cuando un cliente no dispone del importe completo y el establecimiento acepta un importe
> inferior como pago total, ¿debe documentarse como un descuento — reduciendo la base imponible y
> emitiendo la factura por el importe efectivamente cobrado — o como un crédito incobrable que
> mantiene la base imponible original?
>
> **(b)** ¿Cambia la respuesta si la factura ya se había expedido y entregado al cliente antes de
> conocerse el importe finalmente cobrado? En ese caso, ¿procede una factura rectificativa por
> diferencias?
>
> **(c)** Si se redondean los importes en efectivo al múltiplo de cinco céntimos más próximo, ¿debe
> el redondeo figurar como una línea o un descuento en la propia factura, de modo que el importe
> facturado y el cobrado coincidan?

---

## USEFUL — reduces uncertainty, not blocking

### Q6. Consequences of breaching the hourly-retry duty

No source addressed enforcement. LGT art. 201 bis has no delay-specific tipo, so it is
unclear whether a breach falls under *tenencia* of non-conforming software, general
obstruction, or is effectively unenforceable.

> El artículo 16.4 de la Orden HAC/1177/2024 obliga a reintentar el envío "al menos una vez
> cada hora" durante una incidencia. El artículo 201 bis de la LGT no contempla un tipo
> específico por retraso en la remisión.
>
> **¿Qué consecuencia tiene incumplir el deber de reintento horario?** ¿Se consideraría que el
> sistema deja de ajustarse al artículo 29.2.j) LGT, con la sanción por tenencia de 50.000 €
> por ejercicio, o queda fuera del régimen sancionador?
>
> Y sobre la justificación exigida en el art. 16.4 ("deberán ser debidamente justificadas por
> el remitente si así se lo requiere la AEAT"): **¿qué nivel de justificación se acepta, y a
> partir de cuánto tiempo de incidencia cabe esperar un requerimiento?**

### Q7. Installation-number lifecycle

> **Partly answered — and it surfaces a practice to avoid.** mdiago: *"cambiamos el número de
> instalación cuando hacemos cambios de software; no tenemos en cuenta los cambios de hardware.
> Mantenemos histórico de todos los datos de cada cadena."*
>
> 🔴 **Do not copy this — now settled on primary source.** Developer FAQ §4: *"un cambio en dicha
> versión (cuando se actualiza, por ejemplo) **no significa que el SIF pase a ser otro SIF con
> Id. distinto**"*. A release therefore needs a new declaración responsable but **not** a new
> installation number and **not** a new chain.
>
> The tempting inference — §5 says a component change bumps the CPF's version, and AEAT calls
> each version *"un producto distinto"*, so surely a release starts a new SIF — conflates two
> senses. *Distinct product* is a **certification** concept (one DR per version); *distinct SIF*
> is an **identity** concept, and §4 rules version out of it explicitly. Rotating per release
> ends every chain on every release for no regulatory reason, irreversibly, since chains cannot
> be merged. Our rule stays: rotate on re-provisioning, **not** on upgrade.
>
> Their hardware answer is more useful — hardware changes do not trigger a new number, which
> matches treating the installation as a logical rather than physical identity. The remaining
> unknowns (reimage, relocation, retirement of a chain) are unaddressed.

The número de instalación must never repeat, including on reinstalling the same software on
the same reformatted machine. We need to know how far that extends before designing
provisioning.

> El nº de instalación no puede repetirse nunca para un mismo obligado. **¿Qué eventos exigen
> un nuevo número?** En concreto: reinstalación del software, reimagen del dispositivo,
> sustitución del hardware conservando los datos, traslado de un TPV a otro local del mismo
> NIF, y actualización de versión del software.
>
> Cuando un TPV se retira o se sustituye, **¿qué ocurre con su cadena de registros? ¿Basta con
> que termine, o hay que comunicar algo a la AEAT?**

### Q8. Clock accuracy on long-offline devices

> **Answered. Closed** — the substance has moved to
> [verifactu-findings.md](verifactu-findings.md). Short version: mdiago accepts internal clock
> drift and does not block invoicing, because the binding constraint at submission time is
> AEAT's own tolerance on `FechaHoraHusoGenRegistro` (error `2004`), which they report as **240
> seconds** — far tighter than art. 7.f's one minute would suggest, but a *submission* check
> rather than a *generation* check.

The original question, retained for the record:

> El artículo 7.f de la Orden exige exactitud de fecha y hora "con un margen máximo de error
> admitido de un minuto". Un TPV puede permanecer días sin conexión y por tanto sin
> sincronización horaria.
>
> **¿Qué se espera de un dispositivo que no puede sincronizar su reloj durante ese tiempo?**
> ¿Es aceptable la deriva del reloj interno, o hay que impedir la facturación si no puede
> garantizarse el margen de un minuto?

### Q10. Is a certificate renewal gap an incidencia, or negligence?

> **Dissolved 2026-07-27 — the premise was wrong.** Retained because the reasoning is still
> worth having if the mitigation ever fails.
>
> FNMT's seal procedure permits *"dos o más certificados del mismo tipo, y para un mismo
> suscriptor"* to be active simultaneously. So a gap is avoidable: apply for the successor
> months early and cut over. Asked how they handle it, mdiago said they renew far in advance and
> swap one for the other, and therefore have never faced the question. **Treat certificate
> overlap as the control, and this stops being a compliance question at all.**

**Why it matters.** An FNMT **sello de entidad cannot be renewed** — *"No existe la renovación
de certificados. Cuando el certificado haya caducado, se deberá solicitar uno nuevo."* Expiry
means a fresh application: a Registro Mercantil certification less than 15 business days old, a
contract signed with a representante certificate, a manual FNMT validation and a payment step.
Weeks, not minutes, and mostly outside our control. Submissions stop meanwhile.

This turns on the same distinction as Q3 — and lands on the wrong side of it. A network outage
is unforeseen; a certificate expiry date is known years in advance. If the answer is that a
renewal gap is not an incidencia, then certificate lifecycle stops being an operational nicety
and becomes a hard compliance control, with implications for how far ahead the scheduler must
warn and whether the system should refuse to trade rather than accumulate unsendable records.

> El certificado cualificado de sello de entidad de la FNMT no admite renovación: al caducar hay
> que solicitar uno nuevo, aportando certificación registral reciente y con validación manual por
> parte de la FNMT. El proceso puede durar semanas. Durante ese tiempo el SIF sigue generando y
> encadenando correctamente sus registros de facturación, pero no puede remitirlos a la AEAT.
>
> **¿Constituye esta situación una incidencia técnica amparada por el artículo 16.4 de la Orden
> HAC/1177/2024?**
>
> Nos preocupa que, a diferencia de un corte de red, la caducidad de un certificado es previsible
> con años de antelación, por lo que podría entenderse como falta de diligencia y no como
> incidencia sobrevenida.
>
> ¿Existe algún criterio sobre la antelación exigible en la sustitución de certificados? Y si la
> AEAT requiere al obligado durante ese periodo, **¿qué justificación se considera suficiente?**

---

## SEPARATE — for a lawyer, not the asesor fiscal

### Q9. Who signs the declaración responsable for source-available software?

**Why it matters.** Blocks public release, not the build — but it has the largest financial
exposure of anything here, and the answer shapes the distribution model. What is already
settled is in [verifactu-findings.md](verifactu-findings.md) and §3 of the architecture design:
AEAT guidance explicitly covers open source (*"ya sea o no de código abierto"*), liability
attaches to whoever programs or integrates the code, and there is no homologación or registry.
Our working position is `josemmo`'s — a library is a tool for building SIFs, not a SIF — with
each deploying business signing for its own installation.

> **Substantially answered 2026-07-27 — our working position is confirmed by the strongest
> available precedent.** mdiago issues a DR per release for the library, and their reasoning is
> exactly ours: *"Nuestra librería no constituye en sí misma un SIF; es un componente diseñado
> únicamente para cumplir la función de VERI\*FACTU."* A SIF must additionally guarantee
> non-modifiability, numbering and sequencing — all outside a library's scope. The position was
> set by their in-house tax advisers, and in the years since **no client, adviser or AEAT
> contact has objected**.
>
> **Correction, same day.** An earlier revision of this note read mdiago's *"la AEAT lo dice
> explícitamente en sus FAQs"* as meaning nobody downstream is ever covered, and concluded that
> part (b) was dead. That over-generalised his point. His claim is about **integrators of a
> library** — which is the only kind of downstream party his product has. Checked against the
> AEAT FAQ, the duty splits four ways:
>
> | Party | Duty |
> | --- | --- |
> | Producer of the SIF | Issues the DR, per version |
> | **Cliente / comercializador** | *"estar a disposición del cliente y del comercializador en el momento de la adquisición del producto"* — **receives** it; issues nothing |
> | Integrator building a SIF around a component | Is the producer of *that* SIF → issues their own |
> | Third party modifying an existing SIF | *"no están cubiertas por la certificación del productor del SIF original […] es necesario que incorporen su propia certificación"* |
>
> The regulation only makes sense this way: art. 13.2 obliges the producer to hand the DR **to
> the client**, which would be pointless if the client had to author one anyway.
>
> **So (b) is strengthened, not killed.** Shipping a complete, ready-to-run SIF makes us the
> producer and the deploying business a client — our DR is the one they receive.
>
> **Decided 2026-07-27, not asked: if the source is ours, the DR stands.** Someone who compiles
> our unmodified source at a given version is running our product; compiling is neither
> *programación* nor *integración* of anything new, so nothing has been produced that our
> declaration does not already cover. **Modification is the boundary**, and that case is already
> answered — a modifier owes their own.
>
> One consequence worth carrying into the design: this makes the DR **version-scoped, not
> digest-scoped**. A declaration naming a source version covers every faithful build of it; a
> declaration naming one container digest would not, which is a worse fit for a source-available
> product people are expected to build. It also puts weight on the version identity in the DR
> actually meaning something — pinned dependencies and a reproducible build, so that "our source
> at vX" is a determinate thing rather than a hopeful one.
>
> On part (a) they are encouraging without settling it: *"quien adapta o integra asume la
> responsabilidad legal"* — liability follows the integrator, which is the answer we wanted. It
> remains their reading rather than a ruling, and (a) still carries the 150.000 € exposure.
>
> **Net: (b) can come out of the consulta; (a) is the whole of the residual risk.** Every
> downstream party (b) was invented to worry about is now accounted for — clients are covered by
> our DR, faithful builders are covered by the decision above, modifiers owe their own. What (a)
> asks is different in kind and unaffected by any of it: whether *publishing* is itself
> *fabricación o comercialización*, so that exposure attaches to us regardless of who deploys.

Two things that position does not settle:

**(a) Does publishing the source itself constitute *fabricación o comercialización*?**
LGT art. 201 bis sanctions the production and marketing of non-compliant software at
150.000 €/ejercicio plus 1.000 € per uncertified system sold. If publishing a source-available
codebase intended for building SIFs falls within *fabricación*, exposure attaches to the
project regardless of who deploys it. The `josemmo` disclaimer is a bet that it does not.

> Publicamos el código fuente de un sistema de punto de venta que, una vez desplegado por un
> tercero, constituye un SIF. Lo publicamos bajo una licencia restrictiva («source-available»,
> no de código abierto): cualquier empresa puede descargarlo, instalarlo y utilizarlo
> gratuitamente para su propio negocio, pero no puede ofrecerlo a terceros como servicio
> alojado («en la nube»). Nosotros no lo desplegamos para esas empresas; cada empresa lo instala y lo
> configura por su cuenta. Con independencia de lo anterior, la licencia nos reserva en
> exclusiva la facultad de ofrecerlo como servicio alojado, y tenemos previsto explotarlo
> comercialmente como servicio en la nube para nuestros propios clientes.
>
> **¿Constituye la mera publicación del código fuente "fabricación o comercialización" de
> sistemas informáticos de facturación a efectos del artículo 201 bis de la LGT?**
>
> ¿Cambia la respuesta el hecho de que nosotros mismos tengamos previsto explotar además ese
> software comercialmente como servicio en la nube?
>
> ¿Cambia la respuesta si además publicamos artefactos ejecutables (imágenes de contenedor)
> listos para desplegar, en lugar de sólo el código fuente?

**(b) Can a declaration be scoped to an immutable artifact?**

> **Largely closed 2026-07-27 — retained for the reasoning, not for the consulta.** The premise
> was that a project-wide declaration needed an immutable anchor in order to reach third parties
> at all. That turned out to be the wrong problem: clients running a complete SIF are covered by
> the producer's DR as a matter of art. 13.2, and a faithful build of our own source is our own
> product. The declaration should therefore be **scoped to a source version**, as every
> commercial producer's already is — a digest would be *narrower* than we need, not safer.
>
> The one thing worth preserving from this line of thinking is the engineering obligation it
> implies: if the DR names a version, that version must be a determinate artifact. Pinned
> dependencies and a reproducible build, so "our source at vX" identifies one thing.

The original framing, for the record: it covers a specific container digest, so anyone running
that exact digest runs exactly what was declared, and a rebuild is unambiguously outside it.
Untested — no AEAT doctrine addresses it.

> Estamos considerando emitir una declaración responsable referida a un artefacto concreto e
> inmutable (una imagen de contenedor identificada por su digest criptográfico), de modo que
> quien ejecute exactamente ese artefacto esté cubierto, y cualquier recompilación o
> modificación quede fuera.
>
> **¿Es admisible una declaración responsable así delimitada, y cubriría a los terceros que
> despliegan ese artefacto sin modificarlo?**
>
> ¿O debe cada obligado tributario emitir necesariamente la suya propia, con independencia de
> que el software sea idéntico al declarado por el fabricante?

**Route.** A DGT consulta vinculante is the only binding answer. **File (a) alone** — (b) is
closed above, and bundling a question we have already answered invites a confident restatement
that muddies the one that matters. Given the exposure, a lawyer rather than a gestor.

### Q11. May the software provider hold the client's qualified certificate?

> **Premise largely retired, 2026-08-01 (#19 / #33). Do not ask as written.** This question assumes
> Waitron **hosts and operates the client's fiscal system** — the Spanish text below says so in as
> many words (*"ese servidor lo operamos nosotros, no el cliente"*). The
> [cloud-storage design](../superpowers/specs/2026-07-31-cloud-storage-model-design.md) (#19) abolishes
> that as the default: the cloud never holds the key ring, the fiscal certificate stays on the
> **client's own local server**, which is the SIF (#33) and always submits. So in the default
> architecture there is no third-party key custody to ask about. Custody by Waitron **re-emerges only
> in the opt-in cloud-primary/standalone topology**, where the key ring follows the primary into the
> cloud (server-SIF §9) — and there it is the **same** problem as the new **Q16** (a cloud server that
> issues invoices operating the SIF abroad). Fold Q11 into Q16 for that topology; do not send it
> against the default. Part (d) — seal vs representante certificate — survives as a small sub-point of
> Q16 if that topology is pursued.

**Why it matters.** Under the architecture recorded in
[getting-to-production.md §3](getting-to-production.md) each client is the obligado and files
under its own certificate — but we host the system, so the client's private key lives on our
infrastructure. We already reduce the exposure by specifying a **sello de entidad** rather than a
director's personal representante certificate: the seal belongs to the company, is generated by
CSR on the machine that uses it, and machine custody is its stated purpose. That still leaves a
third party holding a qualified key belonging to someone else, and no source we found addresses
it.

This is the commercial counterpart of Q2. Q2 asks whether a node other than the till may
transmit *within one taxpayer's system*; this asks whether that node may belong to somebody else.

> **See also Q12**, which is the same problem approached from the other end — mdiago's answer was
> that a hosted provider should sidestep custody entirely by using its own certificate under a
> convenio. Q11 asks whether custody is permissible; Q12 asks whether the alternative is
> mandatory.

To hand over:

> Nuestro cliente (el obligado tributario) dispone de un certificado cualificado de sello de
> entidad a su nombre. Nosotros alojamos y operamos su sistema de facturación: la clave privada
> se genera en el servidor que la utiliza y nunca sale de él, pero ese servidor lo operamos
> nosotros, no el cliente.
>
> **(a)** ¿Es admisible que el proveedor del software custodie la clave privada del certificado
> de sello de entidad de su cliente? ¿Lo permiten las condiciones de uso de la FNMT y el
> Reglamento eIDAS, o exigen que el suscriptor conserve el control exclusivo?
>
> **(b)** ¿Qué debería recoger el contrato entre las partes — mandato, límites de uso, obligación
> de revocación, encargo de tratamiento a efectos del RGPD?
>
> **(c)** A efectos del artículo 16.4 de la Orden HAC/1177/2024 ("deberán ser debidamente
> justificadas por el remitente"), **¿quién es el remitente** cuando el registro lo genera el SIF
> del cliente y la conexión con la AEAT la abre nuestra infraestructura con el certificado del
> cliente?
>
> **(d)** ¿Cambiaría la respuesta si el cliente utilizase un certificado de representante a
> nombre de una persona física (un administrador) en lugar de un sello de entidad?

Part (d) matters because it tests whether our stated reason for preferring the seal is actually
load-bearing or merely tidy.

### Q12. Must a hosting provider use its own certificate under convenio 017?

> **Premise largely retired, 2026-08-01 (#19 / #33). Do not ask as written.** Like Q11, this assumes
> Waitron **hosts** the client's fiscal system (*"la clave privada se genera y permanece en la
> infraestructura que nosotros operamos"*). Under the [cloud-storage default](../superpowers/specs/2026-07-31-cloud-storage-model-design.md)
> (#19) the client's own local server is the SIF and submits under the client's own certificate — the
> convenio-017 "provider submits under its own certificate" model is not in play. It **re-emerges only
> in the opt-in cloud-primary/standalone topology**, which is exactly the new **Q16**. The convenio
> mechanics (its obligations, revocability) remain a real AEAT question **if** that topology is offered
> at scale, and can still be asked directly at `comunicacion.sepri@correo.aeat.es`; but they belong
> under Q16 now, not as a standalone question premised on hosting being the default.

**Why it matters.** [getting-to-production.md §3](getting-to-production.md) records Model A —
each client is the obligado and files under its own certificate, which our software presents.
mdiago's answer points the other way for hosted deployments, and if they are right the
colaboración social work moves from "later, optional" to "before the second hosted client".

Asked about custody of a client's key in a SaaS deployment, they replied that the provider
*"debe formalizar un convenio con la AEAT (código 017) y manejar únicamente su propio
certificado, autorizado para presentar por cuenta de terceros"*
([discussion #154](https://github.com/mdiago/VeriFactu/discussions/154)).

> ⚠️ **The claim is broader than the evidence behind it.** The linked discussion answers a
> narrower question — a developer whose own certificate was rejected when submitting under a
> client's CIF — and the answer there is conditional: *"si queréis enviar facturas en nombre de
> vuestros clientes **utilizando vuestro propio certificado digital**, es necesario formalizar
> un convenio"*. That establishes convenio 017 as the route **for Model B**. It does not
> establish that Model A is unavailable, and it says nothing about a client submitting under its
> own certificate.
>
> Against it stands AEAT's own text, already quoted in §3: submission may use *"cualquiera de
> las vías actuales de identificación admitidas"*, including the obligado's own representation.
> **Model A remains lawful on the primary source.** Treat mdiago's answer as a strong signal
> about what the ecosystem does at scale, not as a prohibition.

What actually needs deciding is where the crossover sits — one hosted client whose own seal we
hold is clearly fine; fifty is clearly Model B.

> Alojamos el sistema de facturación de nuestros clientes. Cada cliente es el obligado
> tributario y dispone de su propio certificado de sello de entidad, cuya clave privada se
> genera y permanece en la infraestructura que nosotros operamos.
>
> **(a)** ¿Es válida esta configuración, o exige la AEAT que en un entorno alojado sea el
> proveedor quien presente con su propio certificado al amparo de un convenio de colaboración
> social (código 017)?
>
> **(b)** Si ambas son válidas, **¿a partir de qué punto deja de ser razonable custodiar
> certificados ajenos** — número de clientes, volumen, o alguna otra circunstancia?
>
> **(c)** ¿Qué obligaciones adicionales asume el proveedor al firmar el convenio 017, y son
> revocables si más adelante quiere volver al modelo anterior?

**Route.** Partly a lawyer question (custody, contract) and partly an AEAT one (convenio
mechanics). The convenio side can be asked directly at `comunicacion.sepri@correo.aeat.es`.

### Q16. Where may an *active* cloud SIF run — issuing invoices from abroad? (added 2026-08-01)

> **Sharpened 2026-08-26 (#86).** The distribution & client-topology design makes cloud-hosted a
> first-class **planned** mode, not the disaster-edge this question was written against — so the
> "only if a cloud-primary or standalone topology is offered" framing below now **understates** it:
> the mode is on the roadmap and gated on this answer. Draw the line at production, though — the cloud
> **trial** on-ramp (preproduction, shared demo tenant, no real invoices) needs no answer here; only
> **production-cloud-primary**, which issues real invoices from a cloud we operate, does. Left as
> written below per `CLAUDE.md` §6.

**Why it matters.** [cloud-storage §8a](../superpowers/specs/2026-07-31-cloud-storage-model-design.md)
constrains where the cloud may **conserve** records: records kept outside Spain trigger a
prior-notification duty on the client (ROF art. 22.2), and outside the EU is more restricted
(art. 19.4). That analysis leaned on *"the archive is not a SIF."* The
[server-as-SIF design](../superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md) §13
raises the stronger case: a cloud server that **issues** invoices *is* the SIF, operating the
invoicing system abroad, not merely holding a copy of its output. Under the tertiary/disaster default
that is an edge; under a **cloud-primary or standalone** topology it is the **normal operating
state**, and it must be answered before those topologies are offered. This is also where the retired
custody question of Q11/Q12 lands: in a cloud-primary topology the key ring follows the primary into
the cloud (server-SIF §9), so the same node both issues invoices and holds the certificate abroad.

To hand over:

> Un servidor alojado en la nube, que nosotros operamos, actúa como el **sistema informático de
> facturación (SIF)** de nuestro cliente (el obligado tributario): genera y encadena los registros de
> facturación, expide las facturas y las remite a la AEAT con el certificado de sello de entidad del
> cliente, cuya clave privada reside en ese mismo servidor. El servidor puede estar ubicado fuera de
> España, o incluso fuera de la Unión Europea.
>
> **(a)** ¿Es admisible que el SIF de un obligado tributario español opere físicamente fuera de
> España? ¿Cambia la respuesta según esté dentro o fuera de la UE?
>
> **(b)** El artículo 22.2 del RD 1619/2012 exige comunicar con carácter previo a la AEAT la
> conservación de la documentación fuera de España, y el artículo 19.4 restringe el cumplimiento
> material por un tercero fuera de la UE. **¿Alcanzan estos deberes a un SIF que *expide* facturas
> desde el extranjero, y no sólo a la conservación de los registros?** ¿Sobre quién recae la
> comunicación previa — el cliente obligado, o nosotros como operadores del servidor?
>
> **(c)** En esa configuración alojada, ¿debe el proveedor presentar con su propio certificado al
> amparo de un convenio de colaboración social (código 017), o puede seguir presentándose con el
> certificado del cliente que reside en el servidor? (Esto absorbe las antiguas Q11 y Q12.)

**Route.** Partly a lawyer question (hosting location, custody) and partly an AEAT one (convenio, SIF
location); the AEAT side can be asked at `comunicacion.sepri@correo.aeat.es`. Only relevant if a
cloud-primary or standalone topology is offered — under the default (client's own local server is the
SIF) it does not arise. Server-SIF §13 records that everything else on the AEAT side is closed on
primary source.

---

## FISCAL FILINGS — built, but confirm before the first live submission (added 2026-08-26)

Both features below are implemented and tested against the committed AEAT schemas; neither blocks the
build. What each needs is an asesor's sign-off on one interpretive point **before a real filing goes
to AEAT** — so they belong here, not in [verifactu-findings.md](verifactu-findings.md), which records
only what is settled on primary source.

### Q17. F3 *canje* — recipient identity, series, and cross-SIF substitution (added 2026-08-26)

**Why it matters.** F3 (*factura expedida en sustitución de facturas simplificadas* — the *canje*)
is built (`recordSubstitution`, #51): when a customer asks for a full invoice for a ticket already
issued, we emit an F3 carrying a `Destinatarios` block with the recipient's identity. The shape was
validated against the committed AEAT schema, but four points rest on interpretation or on an
`IDType`/XSD detail we could not confirm from the schema alone, and each should be settled before the
first real F3 is filed:

- **(a)** the foreign-recipient path (`IDOtro` rather than a Spanish `NIF`) is **refused at the
  backend** today, because which `IDType` values AEAT expects for a non-resident, and when it demands
  a specific one, is unconfirmed;
- **(b)** whether an F3 must use a **dedicated series** distinct from ordinary/simplified invoices, or
  may share one, is unsourced — we reuse the `standard` series today;
- **(c)** whether an F3 may substitute tickets that a **different SIF** of the same taxpayer issued
  (another server/venue) is a sound *inference*, not confirmed;
- **(d)** a positive confirmation of the exact `Destinatarios` structure for `TipoFactura` F3 (which
  fields are mandatory) before the first live filing.

> Emitimos facturas **F3** (facturas expedidas en sustitución de facturas simplificadas — el "canje")
> cuando un cliente solicita factura completa de un ticket ya emitido. El registro incluye el bloque
> `Destinatarios` con la identificación del destinatario.
>
> **(a)** Para un destinatario extranjero sin NIF español, ¿qué valores de `IDType` (02 NIF-IVA,
> 03 pasaporte, 04 documento oficial del país de residencia, 05 certificado de residencia, 06 otro
> documento probatorio, 07 no censado) son admisibles en `IDOtro`, y en qué supuestos exige la AEAT
> uno concreto?
>
> **(b)** ¿Debe la factura F3 emitirse obligatoriamente en una serie específica, distinta de la de las
> facturas simplificadas y ordinarias, o puede compartir serie con las ordinarias?
>
> **(c)** ¿Es admisible expedir una F3 en sustitución de tickets emitidos por **otro SIF** del mismo
> obligado tributario (por ejemplo, un servidor o local distinto), o debe emitirla el mismo SIF que
> expidió los tickets sustituidos?
>
> **(d)** ¿Puede confirmarnos la estructura exacta del bloque `Destinatarios` que el esquema espera
> para el tipo F3 (campos obligatorios y opcionales), a fin de validar nuestra implementación antes de
> la primera remisión real?

### Q18. *Modelo 303* — IVA soportado deducible: prorrata and duplicate-invoice key (added 2026-08-26)

**Why it matters.** We generate the *modelo 303* from issued invoices (IVA repercutido) and captured
received invoices (IVA soportado deducible), and emit the DR303 file for the AEAT "por fichero"
uploader (#91/#98, [design](../superpowers/specs/2026-08-16-purchase-invoices-and-modelo-303-deducible-design.md)).
The output-VAT side is settled on primary source; the input-VAT side rests on two interpretive points
plus the treatment of boxes not yet implemented. **(a) is the pre-filing blocker** — the whole
deducible figure turns on it:

- **(a) Prorrata.** For an operation with a `deducible_proportion` below 100 %, we emit the deducible
  **base in full** and scale only the **cuota** by the proportion. Confirm AEAT expects the base
  unscaled and only the cuota prorated (not the base prorated too).
- **(b) Duplicate-invoice key.** We treat a received invoice as a duplicate on
  `(supplier tax id, supplier invoice number)`, unique **forever**. Should that uniqueness be **per
  calendar year** instead (a supplier may legitimately repeat a number across years)?
- **(c) Boxes not yet built** — confirm the treatment for when we add them: rectificativas de facturas
  **recibidas** (casillas 40/41), regularización de bienes de inversión (43), the prorrata-definitiva
  rule (44), and intra-community / import operations (32–39).

> Generamos el **modelo 303** a partir de las facturas emitidas (IVA repercutido) y de las facturas
> recibidas que capturamos (IVA soportado deducible), y producimos el fichero DR303 para su remisión
> "por fichero".
>
> **(a) Prorrata.** En una operación con proporción de deducción inferior al 100 %, calculamos la
> **base deducible completa** y aplicamos la proporción **sólo a la cuota**. ¿Es correcto que la base
> figure sin prorratear, prorrateándose únicamente la cuota, o espera la AEAT que también la base se
> declare prorrateada?
>
> **(b)** Tratamos como **duplicada** una factura recibida con el mismo `(NIF del proveedor, número de
> factura del proveedor)`, de forma permanente. ¿Debe esa unicidad entenderse **por año natural** — de
> modo que un proveedor pueda repetir número entre ejercicios — o de forma permanente?
>
> **(c)** ¿Puede confirmarnos el tratamiento de las casillas que aún no implementamos, para cuando las
> incorporemos: rectificativas de facturas **recibidas** (40/41), regularización de bienes de
> inversión (43), regla de **prorrata definitiva** (44) y operaciones intracomunitarias e
> importaciones (32–39)?

---

## Notes for the conversation

- **Nothing here blocks the build any more.** As of 2026-07-27 this document is a list of things
  worth confirming, not things worth waiting for. If an asesor engagement slips, build anyway.
- **Q1 and Q2 are now moot / non-load-bearing** under server-as-SIF (#33) — the server is the SIF,
  so a till need not be one (Q1) and the SIF files its own records (Q2). They were demoted on
  inference before; the architecture change retires them outright. Don't lead with them any more.
- **Q3, Q4, Q8, Q9(b), Q10, Q13 and Q15 are answered** — do not ask them. Q4 is settled on AEAT's own
  text; Q13 (propinas) and Q15's core (short payment) are closed on primary source and moved to
  [verifactu-findings.md](verifactu-findings.md) §§11–12. Asking any of these invites a confident
  wrong answer to a question we no longer have.
- **Q9(a) is the standing consulta candidate**, and it is a lawyer's question. RD-ley 15/2025 moved
  the obligation to January 2027, so a 3–6 month consulta fits comfortably — file it rather than
  building on an opinion.
- **Q16 is the live architecture question**, and only if a cloud-primary or standalone topology is on
  the table. It absorbs the retired **Q11/Q12** (certificate custody in a hosted deployment): under
  the default architecture (client's own local server is the SIF) that custody question does not
  arise; it re-emerges only when the SIF runs in a cloud we operate, which is what Q16 asks. **The
  2026-08-26 banner sharpens this:** the distribution design (#86) made cloud-primary a *planned*
  mode, so Q16 now gates the roadmap — though the preproduction cloud *trial* on-ramp does not need
  it.
- **Q17 and Q18 are the two fiscal-filing confirmations** (F3 *canje*; *modelo 303* IVA soportado) —
  both built, neither blocking, but each has one point to settle **before the first live filing**: the
  foreign-recipient `IDType` shape (Q17a) and the prorrata base treatment (Q18a). These are ordinary
  asesor-fiscal territory, unlike the SIF-architecture questions — a filer will answer them readily.
- **Do not open with "can I use multiple series".** It is settled, it is boring, and it
  invites a confident answer to a question we did not need to ask. The series is not the
  mechanism — the SIF is.
- **Push for the reasoning, not just the verdict.** Where the answer rests on FAQ
  interpretation rather than regulation, we need to know that, because it changes how much
  weight the design can put on it.
- **Ask what they would put in writing.** A view they will not commit to in an email is a
  view we should not build an architecture on.
