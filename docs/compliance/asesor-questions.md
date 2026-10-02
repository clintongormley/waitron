# Questions for the asesor

Companion to [verifactu-findings.md](verifactu-findings.md), which records what is already
settled. **Do not ask about anything in that document** — it is sourced from AEAT and BOE
primary texts. These are the items that research could not resolve.

Each question has English context (for us) and a Spanish formulation (to hand over).

Question numbers are **stable identifiers**, not reading order — sections are ordered by
priority. Q9 is referenced from other documents; do not renumber it.

On **2026-10-01** (lane B item B17): the owner decided **Q28** without the asesor — the full
simplified invoice is issued when the table leaves, and a later payment is recorded against it —
and leaving without paying is now built on that decision. Q28 stays open for the asesor to confirm. The standalone copy's section 1.8 (Q28) has not been updated for this.

On **2026-10-02** (lane C item C126, built in lane B): **Q32 added** — the owner decided, without
the asesor, that cancelling an order whose ticket was already issued credits it in full with an R5
corrective invoice; Q32 asks whether that, or an annulment, is right.

Later on **2026-09-30** (C90, owner decision that day): Q29's notes and parts (a), (c) and (e) now
describe the new receipt. It prints each dish at its full price with each comp or discount on a line
of its own beneath it, and a discount on the whole bill on a line of its own; the filed record is
unchanged. The standalone copy's section 1.9 (Q29) has not been updated for this.

Last revised **2026-09-30**, checked against the backlog, the owner's decisions and `main` at
`34fb2b487`:

- **Q27** describes what the server now does: paying a bill in parts landed on the server (#721);
  the till does not use it yet. Part (d) added, about the daily close.
- **Q29** describes what the till now does: comps and discounts landed (#916). The receipt prints
  the old price beside the new one. Part (e) added, for a discount that splits one dish into two
  lines at different prices.
- **Q31 added:** whether a corrective invoice should be by differences (what the software files
  today) or by substitution. The owner raised this on 2026-09-29.
- **Q5(a)** gains a banner: the owner shelved two servers selling at once on 2026-09-05. One server
  sells at a time, and a restored server starts a new chain under new series.
- **Q19(d)/(e)** say what the software already prints.
- **Q21** notes that a bill request is now recorded but prints nothing.
- **Q25** re-checked: still no route voids an invoice.
- *Notes for the conversation* now open with which questions to send first. The old note calling
  Q16 the live question is marked out of date.
- The standalone copy for the advisor, written 2026-09-23 and kept outside the repository (an
  English and a Spanish Word file), was updated the same day with these changes. Its section numbers
  are not the Q numbers here; every section names its Q number. The new sections are 1.7 to 1.9
  (Q27 to Q29), 2.2 (Q26), 3.3 (Q31), 3.4 (Q25) and 4.6 (Q30). Sections 1.1, 1.4, 3.1 and 4.3
  changed, and 4.3 now carries Q5(d) and Q5(e).

Before that, **2026-09-29**: Q5(c) answered on primary source. RD 1619/2012 art. 7.1.a) requires
separate series for simplified and full invoices issued in the same calendar year. Q5(d) added to
confirm the scope (F3, and simplified rectificativas); Q17(b) points to it. Before that,
**2026-09-27** — Q30 added for certificate permissions when consulting AEAT records. Earlier that day, Q26 reworded again: the owner narrowed the 2026-09-26 rule, and
each line now keeps its VAT class while the invoice takes the rate in force on the day it is issued;
the question stays open. Earlier on 2026-09-27, Q26 reworded: the owner reversed the rule it asks
about on 2026-09-26, and each line kept the VAT rate in the published menu it was sold from. Before
that, **2026-09-26** — Q29 (how a discount or comp appears on a simplified invoice) added. Earlier the same day, Q27 (money taken against a bill before its invoice exists, then a split) and Q28 (a table leaves without paying: is the invoice still owed?) added beside Q21 and Q15, from the service design's §14. Earlier the same day, Q26 updated: the rule it asks about is now built, and the question
stays open. Before that, **2026-09-25** — Q26 (a VAT change while an order is open: we apply the rate in force
when the invoice is issued — is that right?) added beside Q25, and later the same day reworded from
"at payment" to "when the invoice is issued", naming the invoice-first case. Before that, **2026-09-24** — Q25 (a void made on a later day: which VAT period the annulment lands
in) added beside the filing questions. Before that, **2026-09-23** — Q21 (when a table's invoice
is issued: pre-bill first, or the invoice when the bill is presented) added beside Q14; Q22 (printing the ticket only on request, or never) and
Q23 (backup copies held abroad or by us) added; the preparation-environment question numbered Q24.
The same day, the open questions were rewritten as a standalone document for the advisor, in English
and Spanish (kept outside the repository). Before that, **2026-09-13** — Q20 (zero-rate products shown as **No tax**) added. Q17 (F3 *canje*)
and Q18 (*modelo 303* IVA soportado) were added on 2026-08-26; Q16 was sharpened then. Prior
substantive pass **2026-08-01**.

> **2026-09-09:** Added the separate preparation-environment question below for
> node onboarding. This does not
> reopen the settled treatment of training invoices issued by an operational live SIF.

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
> **① Server-as-SIF** (`../superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md`, #33).
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
> **② Cloud storage** ([`../superpowers/specs/2026-07-31-cloud-storage-model-design.md`](https://github.com/waitron-io/waitron-cloud/blob/main/docs/reference/2026-07-31-cloud-storage-model-design.md), #19).
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
>   (`../superpowers/specs/2026-08-15-distribution-and-client-topology-design.md`, #86)
>   makes cloud-hosted a first-class **planned** mode, so Q16 is no longer the hypothetical
>   "only if a topology is offered" it was written as — it **gates a mode already on the roadmap**.
>   Draw the line at production: the cloud **trial** on-ramp (preproduction, shared demo tenant, no
>   real fiscal records) needs no answer; only **production-cloud-primary** does. Banner added at Q16.
> - **Not for this list — now homed elsewhere.** The *laboral* questions (the convenio overtime rule,
>   D3 payroll, the *retención* on card-collected tips redistributed through a tronco per V3095-17) are
>   for a *graduado social / asesor laboral*, not the fiscal asesor. They now live in their own
>   [asesor-laboral-questions.md](asesor-laboral-questions.md); the tip one (L6) cross-references
>   §11 findings because its IS/booking half is fiscal and its nómina/retención half is labour.

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
> `../superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md`
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

> **(c) answered on primary source, 2026-09-29 — the 2026-07-31 reading was incomplete.** It read
> only art. 6.1.a)'s mandatory list. The last paragraph of art. 7.1.a) (BOE consolidated text,
> `buscar/act.php?id=BOE-A-2012-14696`, read 2026-09-29) says:
> *«Cuando el empresario o profesional expida facturas conforme a este artículo y al artículo 6 para
> la documentación de las operaciones efectuadas en un mismo año natural, será obligatoria la
> expedición mediante series separadas de unas y otras.»* So a taxpayer that issues both simplified
> and full invoices in one calendar year must keep them in separate series. Waitron's sale and
> substitution paths accept only a `standard` series (`packages/core/src/record-sale.ts`,
> `packages/core/src/record-substitution.ts`), so an F1 or an F3 would share the F2 tickets' series.
> Today every sale files as a simplified invoice (`counterparty: null` in `record-sale.ts`) and no
> route calls `recordSubstitution`, so no full invoice has shared the series yet. Build item:
> [backlog A1e](../backlog.md). Do not re-ask (c) as written; ask (d).

> **(a) reshaped by server-as-SIF, 2026-08-01 (#33).** The subject of (a) has changed: under
> `../superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md`
> a series belongs to the **server**-SIF, not the till, so "one series per till" is no longer the
> shape to ask about. What replaces it is a **hard architectural constraint, not an open question**: a
> venue runs **two** concurrent SIFs (active-active), and AEAT identifies a record by the triple
> `(NIF, NumSerieFactura, FechaExpedicionFactura)` — **not** by installation number — so the two
> servers **must issue under disjoint series**, or a same-day collision on that triple is a duplicate
> (AEAT error 3000). The Spanish below is now best framed as *"¿una serie por SIF-servidor, y qué
> exige que dos SIF concurrentes usen series disjuntas?"* rather than *"una serie por TPV"*. (The
> disaster-*restore* flow is different — the dead server is confirmed dead and numbering resumes above
> a high-water mark on the same series, no concurrency; see cloud-storage §5.)

> **The 2026-08-01 banner is out of date, 2026-09-30.** Two servers selling at once is off the table:
> the owner shelved it on 2026-09-05 and chose a warm standby that a person promotes. Only the
> primary sells (`CLAUDE.md` §5). Today a venue has one server and no failover at all. What does
> happen today is a restore, from a backup file or from the owner's bucket copy. Restoring a server
> that was filing gives it a new installation number, retires its invoice series and opens new ones
> (`runRestoreHooks` in `apps/server/src/restore.ts`; #248). So the Spanish **(e)** below replaces
> (a). It asks about one series per server-SIF, with the old series closed and new ones opened each
> time a restored server starts a new chain: is that allowed, and does it need a documented reason? The note
> above about numbering resuming on the same series after a restore describes the older cloud-storage
> design, not what the software does.

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
>
> **(d)** *(añadida el 29-09-2026)* Según el último párrafo del artículo 7.1.a) del RD 1619/2012,
> si en un mismo año natural se expiden facturas simplificadas y facturas completas, deben
> expedirse en series separadas. Por ello vamos a usar una serie para los tickets (F2) y otra para
> las facturas completas (F1), además de la serie de rectificativas. ¿Es correcta esta lectura? En
> particular:
>
> - (i) ¿La factura de canje (F3) debe ir en la serie de las facturas completas, o necesita una serie
>   propia?
> - (ii) ¿Las rectificativas de facturas simplificadas (R5) deben ir en una serie distinta de las
>   rectificativas de facturas completas (R1–R4), o pueden compartir una única serie de
>   rectificativas?
>
> **(e)** *(añadida el 30-09-2026; sustituye a la (a))* En cada local factura un único servidor, que
> es el SIF, con su propio número de instalación y sus propias series. Si ese servidor se pierde y se
> restaura desde una copia de seguridad, el servidor restaurado recibe un número de instalación
> nuevo y empieza una cadena nueva. Además, cerramos sus series y abrimos otras nuevas. ¿Es
> admisible abrir series nuevas por este motivo? ¿Debe documentarse la razón en algún sitio?

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

### Q21. When a table asks for the bill — pre-bill first, or the invoice straight away? (added 2026-09-23)

**Why it matters.** Today the table screen has no "print the bill" action: charging the table takes
the payment, issues the invoice and prints the ticket in one step, so nothing is printed before
payment. *2026-09-30:* staff can now mark that a table has asked for the bill (#908). That mark
only shows on the floor plan and prints nothing. The counter already offers both orders of events per venue (invoice issued when the order is
confirmed, or a pre-bill then the invoice at payment), and the
[service design](../superpowers/specs/2026-09-20-service-ordering-and-billing-design.md) leaves the
timing for tables to be settled with the advisor. The two routes trade against each other:

- **Pre-bill, invoice at payment.** The order stays editable until payment, so a late dessert, a
  disputed item or an accepted shortfall is fixed before the invoice exists (a shortfall agreed before
  issue is a *descuento*, [verifactu-findings.md §12](verifactu-findings.md)). The cost is Q14: if the
  *precuenta* is a preparatory document, it must be preserved and its changes logged.
- **Invoice when the bill is presented.** Q14 does not arise, but every later change needs a
  rectificativa or a second invoice. Art. 11.1 says the invoice is issued *«en el momento de
  realizarse la operación»*, and whether that is when the meal is served or when it is paid is the
  point we cannot settle from the text.

Ask it beside Q14: the answer to one decides how much the other matters.

> **(a)** Cuando una mesa pide la cuenta, ¿podemos entregar una precuenta, sin validez de factura, y
> expedir la factura simplificada sólo en el momento del cobro? ¿O debe expedirse la factura al
> presentar la cuenta, por entenderse ya realizada la prestación del servicio (artículo 11.1 del RD
> 1619/2012, «en el momento de realizarse la operación»)?
>
> **(b)** Si cabe la precuenta, ¿qué ocurre si entre la precuenta y el cobro la mesa pide algo más o
> discute alguna partida? ¿Basta con modificar el pedido y dejar anotado el cambio en el sistema?
>
> **(c)** A la inversa, si expedimos la factura al presentar la cuenta y el cliente finalmente paga
> menos, o consume algo más, ¿procede siempre una factura rectificativa o una nueva factura?

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

### Q27. Money taken against a bill before its invoice exists, then a split (added 2026-09-26)

**Why it matters.** The owner decided on 2026-09-26 that a table's bill is invoiced when it is
fully paid, and that paying must be flexible
([service design §6](../superpowers/specs/2026-09-20-service-ordering-and-billing-design.md#6-take-contributions-without-consuming-somebody-elses-tip),
decision 3). The case that needs an answer:

- A table's bill is €120. One guest hands over €50 "towards the bill". No invoice exists yet.
- A second guest then asks for their own invoice for two items (€30). Staff move those two lines
  to a separate bill, take €30, and issue and print that bill's simplified invoice.
- The table returns to the original bill (now €90, with €50 already received) and pays the other
  €40. Only then is the original bill's simplified invoice issued, for €90.

So money is held for a while against consumption that has no invoice yet, and the lines that
invoice covers change after money was received. It also touches Q21 (pre-bill or invoice when the
bill is asked for) and Q14 (whether a *precuenta* is a *prefactura*).

**What the software does, 2026-09-30.** The server side of this has landed (#721, 2026-09-27;
[bill payments design](../superpowers/specs/2026-09-26-bill-payments-design.md)). The till does not
use it yet (service plan Task 15), so at the till every bill is still paid in one go, at the moment
its invoice is issued. On the server:

- a bill can take several payments, and no invoice exists until the payments cover the total;
- the invoice is issued in the same database transaction as whatever makes the bill fully paid. That
  can be a payment, or a change that lowers the total to what has already been received: lines moved
  or split away, a line removed, a quantity reduced, a comp or a discount;
- lines can be moved off a bill that has received money only if the bill's total stays at or above
  what it has received. Otherwise the move is refused, and staff move fewer lines or refund first
  (design §4.3);
- the daily cash-up counts each payment and refund on the day the money moves, separately from
  invoiced sales, and does not count it again when the invoice is issued (owner decision 2026-09-26,
  design §9a).

What waits for this answer: printing the invoice before anyone pays, and correcting it if the table
then splits (design §10).

The owner also wants the option of printing the invoice at the START, before anyone pays. If the
table then splits, the original has to be corrected. We would build that only after this answer.

> **(a)** En un restaurante que expide facturas simplificadas, ¿puede el establecimiento recibir
> uno o varios pagos parciales de los comensales a cuenta de la cuenta de la mesa, y expedir la
> factura simplificada sólo cuando la cuenta queda totalmente pagada? ¿Existe algún plazo máximo
> entre el primer cobro y la expedición?
>
> **(b)** Si, después de un pago parcial a cuenta, un comensal pide su propia factura por algunas de
> las consumiciones, ¿es correcto separar esas consumiciones, expedir para ellas una factura
> simplificada independiente, y expedir después la factura de la cuenta original sólo por las
> consumiciones restantes (con el pago parcial anterior aplicado a esa cuenta)?
>
> **(c)** Si, en cambio, la factura simplificada de toda la mesa se expide y se entrega ANTES de
> cobrar, y después los comensales piden facturas separadas, ¿procede una factura rectificativa de
> la original y la expedición de nuevas facturas por cada parte? ¿Hay un procedimiento más sencillo
> admitido en hostelería?
>
> **(d)** *(añadida el 30-09-2026)* Nuestro cierre diario de caja (un documento interno, no una
> declaración) recoge cada cobro a cuenta el día en que se recibe, separado de las ventas facturadas,
> y no lo vuelve a contar cuando después se expide la factura. Si la factura se expide otro día, el
> cobro y la venta facturada quedan en días distintos. ¿Hay algún inconveniente?

---

### Q28. A table leaves without paying — is the invoice still owed? (added 2026-09-26)

**Why it matters.** The service design lets staff record an *unpaid departure*: the guests left,
the table is released, and the unpaid amount and the staff member who recorded it are kept
([service design §8](../superpowers/specs/2026-09-20-service-ordering-and-billing-design.md#8-finish-the-visit-without-hiding-outstanding-bills)).
In a venue that invoices at payment, no invoice exists at that moment although the food was
served. Q15 (closed) covers a shortfall the venue ACCEPTS as payment in full, which is a discount;
this is the case where nothing is accepted and the debt stands.

The software can either issue the simplified invoice anyway, for the full amount, and record it as
unpaid; or issue nothing and keep the debt only in its own records until it is collected. We
assume the first is the safe reading, and we will not build unpaid departure until this is
answered. *(2026-10-01: built on the owner's decision without the asesor — see below.)*

> **(a)** Cuando un cliente abandona el restaurante sin pagar lo consumido, ¿debe el establecimiento
> expedir igualmente la factura simplificada por el importe total de lo servido, aunque no se haya
> cobrado, y registrarla en el sistema de facturación?
>
> **(b)** Si se cobra más tarde (en todo o en parte), ¿basta con registrar el cobro contra esa
> factura? Si no se cobra nunca, ¿el único cauce para recuperar el IVA es la modificación de la base
> imponible por créditos incobrables (artículo 80.Cuatro de la Ley del IVA)?

**Owner decided without the asesor, 2026-10-01: yes to (a), and to the first half of (b).** When a table leaves without paying, the
simplified invoice is issued for the full amount at that moment and filed like any other sale, and
a later payment is recorded against that invoice. Nothing is held back from the fiscal chain until
the money is collected. Recovering the VAT on a debt never collected (art. 80.Cuatro) is the
venue's own business and is not built. *(2026-10-02, C126: cancelling such a bill, by a person
holding `sale.rectify`, now credits its whole invoice, VAT included, with a corrective invoice,
unless the cancel is refused (see Q32), and leaves the departure as recorded — see Q32, part (c).)* The basis, quoted from the BOE
consolidated texts fetched 2026-10-01:

- Ley 37/1992 (IVA), art. 75.Uno.2.º — the tax falls due «En las prestaciones de servicios, cuando
  se presten, ejecuten o efectúen las operaciones gravadas»
  (<https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740>, last updated there 30/09/2026).
- RD 1619/2012, art. 2.1 — an invoice must be issued «por las entregas de bienes y prestaciones de
  servicios que realicen en el desarrollo de su actividad»; art. 11.1 — «Las facturas deberán ser
  expedidas en el momento de realizarse la operación»
  (<https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696>, last updated there 31/03/2026).

Built on this decision (service plan Task 17, lane B item B17): **Record unpaid departure** on the
till issues an invoice for the full amount for each unpaid bill not yet invoiced (a bill already
invoiced keeps its invoice), files it, records what each invoice still owes, when it owes anything,
with the reason, who recorded it and who authorised it (an invoice owing nothing is settled
instead), and closes the table. Collecting the debt later in full uses
the existing collect route; collecting PART of it is not built, because `settleSale`
(`packages/core/src/settle-sale.ts`) refuses a second settlement of one invoice and a settlement
whose payments do not add up to the amount due. The question stays open: if the asesor
answers otherwise, this is what changes.

---

### Q29. How a discount or comp appears on a simplified invoice (added 2026-09-26)

**Why it matters.** Q15 (closed) settled that a reduction agreed before the invoice is issued is a
*descuento* and stays out of the taxable base. It did not settle how the reduction is SHOWN. The
owner decided on 2026-09-26
([service design §7](../superpowers/specs/2026-09-20-service-ordering-and-billing-design.md#7-resolve-complaints-without-erasing-what-happened))
that:

- a discount lowers the line's own price, so the invoice shows the reduced price and no separate
  discount line;
- a whole-bill discount is shared across the lines in proportion, so each VAT rate's taxable amount
  drops by its lines' share;
- a comp (an item given free) appears as its own line at €0.00, beside its original price;
- an item sold by weight takes a discount by lowering its per-kilo price to a whole cent, so on a
  heavy item the discount actually applied can differ from the one agreed by a few cents (up to
  1 cent up to 3 kg, 2 cents up to 5 kg, 5 cents at 10 kg). A whole-bill discount can miss in the
  same way when the bill's other items cannot absorb the difference (for example, when the only
  other item is one given free). The invoice shows what was actually charged, and staff see it
  before confirming.

_2026-09-30, C90: the receipt now prints the dish at its full price with the comp or discount on a
line of its own beneath it._

**What the software does, 2026-09-30.** This is now built (service plan Task 11, #916). Staff can
comp or discount only a bill whose invoice has not been issued yet (an open bill of a table). The
filed record carries only the reduced price. The printed ticket, and the ticket the till shows
once the invoice is issued, use the usual layout (owner decision 2026-09-30): each dish at its full
price, then, after its extras, a line of its own for each comp or discount made on it, naming it and
the amount taken off. A comped burger prints at `12,00 €` with `Invitación -12,00 €` beneath it, and a bottle
with 10% off at `30,00 €` with `Descuento 10% -3,00 €`. A discount on the whole bill prints once,
on its own line after the goods and before the VAT breakdown. So the ticket shows each discount as
a line of its own, while the filed record has no lines at all: only totals and the VAT breakdown,
worked out from the reduced prices. When the bill's adjustment records no longer add up to what its
lines show (part of a discounted line cancelled afterwards, for one), each dish instead gets one
line for what it lost, and a discount on the whole bill is not shown on its own. One more case the
list above does not cover: a discount on a dish sold by the piece can split its line in two,
because every unit price must be a whole cent. Three croquetas at €3.33, less €1.00, are recorded
by the software as 2 × €3.00 and 1 × €2.99 (the filed totals are worked out from those); the ticket
shows both lines at €3.33 a unit (`6,66 €` and `3,33 €`, the second possibly after other dishes)
with `Descuento -1,00 €` beneath the first.

> **(a)** En una factura simplificada, ¿es correcto que, para un descuento concedido antes de la
> expedición, el ticket muestre la línea afectada a su precio habitual y, debajo, una línea propia
> con el descuento (por ejemplo «Descuento 10% -3,00 €»), mientras que los importes del registro
> de facturación, que no recoge líneas, se calculan con el precio ya reducido? *(30-09-2026: un
> descuento sobre el total de la cuenta figura en el ticket una sola vez, en su propia línea, antes
> del desglose del IVA.)*
>
> **(b)** Cuando el descuento se aplica al total de la cuenta, ¿es correcto repartirlo entre las
> líneas en proporción a su importe, de modo que la base imponible de cada tipo de IVA se reduzca en
> la parte correspondiente?
>
> **(c)** Una consumición invitada por el establecimiento, ¿puede figurar en el ticket a su precio
> habitual con una línea propia debajo que lo descuenta entero (por ejemplo «Invitación -12,00 €»),
> mientras que los importes del registro de facturación, que no recoge líneas, se calculan con su
> precio reducido, cero? ¿O debe omitirse del ticket? ¿Tiene alguna consecuencia en el IVA (por
> ejemplo, como autoconsumo) que el establecimiento entregue esa consumición sin contraprestación?
>
> **(d)** En productos vendidos al peso, si el descuento acordado se aplica redondeando el precio por
> kilo al céntimo, de modo que el importe descontado puede diferir en algunos céntimos del acordado
> (hasta 2 céntimos en una pieza de 3 a 5 kg, 5 céntimos en una de 10 kg) — también en un descuento
> sobre el total de la cuenta, cuando las demás líneas no pueden absorber esa diferencia —, ¿basta
> con que la factura refleje el importe efectivamente cobrado, que el personal confirma antes de
> aplicarlo?
>
> **(e)** *(añadida el 30-09-2026)* Los precios unitarios van siempre en céntimos enteros. Por eso un
> descuento sobre un producto vendido por unidades puede dividir su línea en dos, con precios
> unitarios distintos. Por ejemplo, 3 croquetas a 3,33 € con 1,00 € de descuento quedan en el
> sistema como 2 × 3,00 € y 1 × 2,99 € (los importes del registro de facturación se calculan a
> partir de ellas); el ticket muestra ambas líneas a 3,33 € la unidad, con «Descuento -1,00 €»
> debajo de la primera. ¿Es correcto que un mismo producto figure así en dos líneas con precios
> distintos?

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

### Q30. Which certificate permissions cover issuer and recipient consultations? (added 2026-09-27)

**Why it matters.** The default local-server SIF submits with the client's own certificate; Q16
covers the separate question of certificate custody in a future hosted SIF. AEAT's
[service description](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf)
describes consultations as issuer (`ObligadoEmision`) and recipient (`Destinatario`), with optional
filters. That describes the request, not the authority granted to a particular certificate or
representative. Before relying on either consultation mode for a client, confirm the required
mandate and what proof to retain. An authorized preproduction query must separately check the
service's actual response; the asesor's opinion cannot establish that behavior.

> Nuestro SIF local utiliza el certificado cualificado del propio cliente para acceder a los
> servicios de la AEAT. La documentación del servicio permite consultar registros como emisor
> (`ObligadoEmision`) y como destinatario (`Destinatario`). En una modalidad futura podría actuar
> un representante o colaborador social con su propio certificado.
>
> **¿Qué autorización, representación o apoderamiento se necesita en cada caso para consultar los
> registros del cliente como emisor o destinatario, y qué justificantes debemos conservar?**
> ¿Cubre la autorización para remitir registros también estas consultas, o requiere un alcance
> distinto? ¿Existen límites para una consulta sin filtro de contraparte?

**Route.** Ask the asesor about the mandate and retained evidence. Ask AEAT's technical channel
about any unresolved service-permission detail, then verify it with an authorized preproduction
certificate. Do not treat a successful test as proof of a broader legal mandate.

---

### Q19. Several guests, one table — separate facturas, or one factura with *duplicados*? (added 2026-09-12)

> **Bounded search 2026-09-12 found nothing on point.** A full-text search of PETETE for `comensales`
> in DESCRIPCION-HECHOS returns **zero** documents across the whole 1997–2026 corpus (positive control:
> `restaurante` in the same field returns 3 pages). The nearest doctrine is **1693-02**, which gives the
> *destinatario* test but is a consulta **general** on the **repealed** RD 2402/1985 — see
> [verifactu-findings.md §15.2](verifactu-findings.md). This is genuinely unaddressed; do not treat the
> *comunidad de vecinos* answer as settling a restaurant table.

**Why it matters.** It decides what the till prints when a table splits, and the two candidate designs
are very different amounts of work. RD 1619/2012 **art. 14.1** allows only one original per invoice, and
**art. 14.2.a)** permits *duplicados* only where *«en una misma entrega de bienes o prestación de
servicios concurriesen varios destinatarios»*, each copy then having to carry *«la porción de base
imponible y de cuota repercutida a cada uno de ellos»* and the word *«duplicado»* (art. 14.4).

Two readings, and we need to know which is right before building:

- **(A) Each guest's consumption is its own operation** → N independent facturas simplificadas, one per
  guest. This is what the software already does (`splitBill`), and it needs no duplicados at all.
- **(B) The table is one operation with several *destinatarios*** → one original plus *duplicados*
  under art. 14.2.a). Note the friction: a factura simplificada is not otherwise required to show the
  **cuota** (art. 7.1.f), yet 14.2.a) demands a per-person base **and cuota** split — so this route
  forces figures onto a simplified ticket that art. 7 does not contemplate.

Note also that in (B) the guests are anonymous: a factura simplificada identifies no recipient at all,
so there is nothing on the document that says who each *duplicado* belongs to.

**What the software already prints, for (d) and (e), 2026-09-30.** Both were built in #324
(2026-09-12):

- **(d)** The till's Reprint prints the word **DUPLICADO** on the ticket (`reprintSale`,
  `apps/server/src/till-sale.ts`). In a venue that does not print automatically (Q22), the till
  first offers a Print receipt button, which prints the ticket as an original. The till hides that
  button once one print has been queued (`#onPrintReceipt`, `apps/till/src/till-app.ts`); the server
  does not refuse a second original. A person with `print.resend` can resend a job from the
  dashboard's Printers screen once its automatic delivery has ended, whether it failed or
  succeeded (`canResendPrintJob`, `packages/printing/src/outbox.ts`). A resend sends the same bytes
  again, so an original that failed to print comes out as an original. That is the case (d) asks
  the advisor to confirm. Resending a print that succeeded also prints another original.
- **(e)** Staff can print a slip for each card payment on its own: *JUSTIFICANTE DE PAGO — Este
  documento no es una factura*, with no invoice number, series or QR code
  (`apps/server/src/payment-slip.ts`).

> **(a)** En un establecimiento de hostelería que expide **facturas simplificadas**, cuando varios
> clientes comparten mesa y desean cada uno su propio justificante, ¿es conforme a derecho expedir una
> **factura simplificada independiente por cada cliente**, documentando cada una los consumos que se le
> imputan, considerando a cada cliente destinatario de su propia operación? ¿O debe entenderse que
> existe una sola operación con varios destinatarios?
>
> **(b)** Si se entiende que hay una sola operación con varios destinatarios, ¿es el cauce del artículo
> 14.2.a) del RD 1619/2012 (original más ejemplares duplicados, con la porción de base imponible y de
> cuota repercutida de cada uno y la mención «duplicado») aplicable a una **factura simplificada**, que
> conforme al artículo 7.1.f) no está obligada a consignar la cuota ni identifica al destinatario?
>
> **(c)** ¿Qué criterio debe seguir el establecimiento para determinar el **destinatario** cuando no
> hay contrato expreso — el criterio de 1693-02 («quienes están obligados frente al sujeto pasivo a
> efectuar el pago»), de modo que el reparto acordado entre los comensales determina la pluralidad de
> destinatarios? ¿Basta la petición del cliente?
>
> **(d)** Cuando se **reimprime** una factura simplificada ya expedida (por pérdida del original, o
> porque la impresión inicial falló), ¿debe llevar el ejemplar la mención **«duplicado»** del artículo
> 14.4? ¿Y si la impresión original **nunca llegó a entregarse** al cliente — sigue siendo un duplicado,
> o es el original?
>
> **(e)** ¿Es admisible entregar, además de la factura simplificada, un **justificante de pago con
> tarjeta** separado y sin valor fiscal (sin número de factura, sin serie y sin código QR), uno por cada
> pago recibido? ¿Existe algún requisito formal que evite que se confunda con una factura?

### Q22. Printing the ticket only on request, or never (added 2026-09-23)

**Why it matters.** Each venue sets `receipt_print_mode` (`packages/db/src/schema/tenants.ts`):
`auto` prints after every sale, `on_request` and `never` do not. In every mode the invoice is issued
and filed, and the reprint route has no mode gate, so a customer who asks can always be handed paper.
RD 1619/2012 art. 1 obliges the business to *«expedir y entregar»*, and
[verifactu-findings.md §9](verifactu-findings.md) reads art. 18 as making delivery to a consumer
immediate, not on request. §15.6 flagged the tension for the advisor; this is that question.

> Cada local elige cómo se imprime el ticket: automáticamente tras cada venta, sólo cuando el cliente
> lo pide, o nunca. En todos los casos la factura simplificada se expide y se remite, y siempre puede
> imprimirse si el cliente la pide. El artículo 1 del RD 1619/2012 obliga a «expedir y entregar» la
> factura.
>
> **(a)** ¿Cumple la obligación de entrega un local que imprime la factura simplificada sólo cuando el
> cliente la solicita?
>
> **(b)** ¿Y un local que nunca la imprime automáticamente? Si no cumple, ¿debería el programa dejar
> de ofrecer estas opciones?

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
> [cloud-storage design](https://github.com/waitron-io/waitron-cloud/blob/main/docs/reference/2026-07-31-cloud-storage-model-design.md) (#19) abolishes
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
> infraestructura que nosotros operamos"*). Under the [cloud-storage default](https://github.com/waitron-io/waitron-cloud/blob/main/docs/reference/2026-07-31-cloud-storage-model-design.md)
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

> **Closed 2026-09-05 by an owner decision, not an answer: cloud instances are hosted in Spain.** The
> premise — a SIF operating from abroad — does not arise, for a cloud-only primary or for a promoted
> cloud standby. Do not send this question. The Q11/Q12 custody remnant folded in here dies with it
> (the certificate stays in Spain either way). Text below left as written.

> **Sharpened 2026-08-26 (#86).** The distribution & client-topology design makes cloud-hosted a
> first-class **planned** mode, not the disaster-edge this question was written against — so the
> "only if a cloud-primary or standalone topology is offered" framing below now **understates** it:
> the mode is on the roadmap and gated on this answer. Draw the line at production, though — the cloud
> **trial** on-ramp (preproduction, shared demo tenant, no real invoices) needs no answer here; only
> **production-cloud-primary**, which issues real invoices from a cloud we operate, does. Left as
> written below per `CLAUDE.md` §6.

**Why it matters.** [cloud-storage §8a](https://github.com/waitron-io/waitron-cloud/blob/main/docs/reference/2026-07-31-cloud-storage-model-design.md)
constrains where the cloud may **conserve** records: records kept outside Spain trigger a
prior-notification duty on the client (ROF art. 22.2), and outside the EU is more restricted
(art. 19.4). That analysis leaned on *"the archive is not a SIF."* The
server-as-SIF design §13
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
  a specific one, is unconfirmed. That refusal is no longer specific to the F3: since
  2026-09-12 it governs EVERY record that names a recipient, the F1 full invoice included, because
  both paths build the recipient block through the same function
  (`buildDestinatarios`, `packages/fiscal-verifactu/src/backend.ts`);
- **(b)** whether an F3 must use a **dedicated series** distinct from ordinary/simplified invoices, or
  may share one, is unsourced — we reuse the `standard` series today;
  *2026-09-29:* on our reading an F3 is a full invoice, so art. 7.1.a) keeps it out of the F2
  tickets' series (see Q5's (c) note). Where it goes instead is asked as Q5(d)(i);
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
uploader (#91/#98, design).
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

### Q20. Products shown as **No tax (0%)** — zero-rated `S1` or non-subject `N1`/`N2`? (added 2026-09-13)

**Why it matters.** The Products screen exposes the catalogue's existing zero-rate VAT class as
**No tax (0%)**. Pricing puts the whole gross amount in the base and records zero VAT. The current
Veri*Factu backend files that line with `TipoImpositivo: 0.00`, `CuotaRepercutida: 0.00` and
`CalificacionOperacion: S1` (taxable, non-exempt). It does not classify the operation as non-subject.

AEAT's record description says a non-subject operation must include its amount and the cause of
non-subjection. The current schema distinguishes `N1` (Articles 7, 14 or other causes) from `N2`
(place-of-supply rules). We need the asesor to confirm whether the venue has a real product case for
the existing zero-rated `S1` treatment, and to identify any intended “No tax” case that actually
belongs in `N1` or `N2` instead.

> En la ficha de producto mostramos la clase de IVA existente de tipo cero como **«Sin impuestos
> (0 %)»**. El cálculo considera todo el importe como base y cero como cuota. En el registro
> Veri*Factu enviamos `TipoImpositivo: 0.00`, `CuotaRepercutida: 0.00` y
> `CalificacionOperacion: S1` (operación sujeta y no exenta); no la marcamos como no sujeta.
>
> **(a)** Para los productos reales de este restaurante o delicatessen que se quieran configurar de
> esta forma, ¿es correcta la calificación **S1 con tipo 0 %**? ¿Qué supuestos concretos de su
> actividad pueden usarla?
>
> **(b)** Si alguno de esos supuestos es en realidad una operación **no sujeta**, ¿debemos exigir la
> causa **N1** (artículos 7, 14 u otros) o **N2** (reglas de localización) en lugar de permitir la
> clase de tipo cero?
>
> **(c)** ¿Recomienda mostrar la etiqueta **«IVA 0 %»** en vez de **«Sin impuestos»** para evitar que
> el personal confunda una operación sujeta a tipo cero con una operación no sujeta?

Primary-source boundary checked 2026-09-13:
[AEAT, contenido del registro de facturación de alta](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/cuestiones-generales/contenido-registro-facturacion-alta_.html)
requires the cause for a non-subject operation; the committed AEAT
`SuministroInformacion.xsd` defines the separate `N1` and `N2` values. Neither source determines the
correct treatment for the venue's particular product.

---

### Q26. A VAT change while an order is still open — the invoice takes the rate in force on the day it is issued; is that right? (added 2026-09-25; reworded 2026-09-27, twice)

**Why it matters.** An order can stay open for hours: a table's tab, or an order held for
collection. The owner decided on 2026-09-27 how the two things that can change are treated.

- **Which VAT class a product belongs to** (general, reduced, super-reduced, zero) is part of the
  published menu. A line records the class of the menu version it was sold from when its price is
  fixed, so a class change reaches the till on the day a menu is published.
- **The percentage of each class** is a dated table in the software: each class has its rates, each
  from a calendar date. A legal change is installed ahead of time as a new dated entry and changes
  nothing before its date. The invoice looks the percentage up for **the day it is issued**, in the
  venue's local time. The customer pays the same gross price either way, so only the VAT split is
  affected.

Since 2026-09-27 this is how the product works (`vatRateOn`, `packages/catalogue/src/vat-rates.ts`;
the issuing paths in `apps/server/src/till-sale.ts`, `bill-payments.ts` and `working-order.ts`).
The invoice is issued at payment on every path except orders invoiced when they are placed and paid
on collection, where it is issued at placing, so there the placing day's rate applies. Two
different events are affected:

- **A legal rate change effective from a given date**, for example 1 January. **The edge case: an
  order open across the change pays the new rate on every line.** A New Year's Eve table opened
  before midnight and paid after it is invoiced entirely at the new rate, including what was served
  before midnight, because the invoice is issued after midnight.
- **A set-up error corrected mid-service**, for example a drink configured in the 10% class that
  should always have been in the 21% class. Once the product is corrected and the menu published
  again, new lines record the 21% class. Lines already in open orders keep the class they recorded,
  and so do invoices already issued. Correcting an issued invoice would take a corrective invoice
  (*factura rectificativa*), which the product cannot issue today.

A wrong rate on a filed invoice can only be corrected by a further record, so we want the rule
confirmed before production, not after.

> En nuestro TPV, el precio (IVA incluido) de cada línea de un pedido abierto (una mesa, o un pedido
> pendiente de recoger) queda fijado cuando se añade, y en ese mismo momento queda fijada su
> categoría de IVA (general, reducido, superreducido o exento): la que figura en la carta publicada
> desde la que se vendió. El porcentaje de cada categoría no se guarda en la línea: el programa lleva
> una tabla de tipos con la fecha de entrada en vigor de cada uno, y la factura simplificada aplica
> el tipo vigente el día en que se emite, en hora local. Normalmente la emisión coincide con el cobro;
> en los pedidos que se facturan al hacerlos y se cobran al recoger, la emisión es anterior al cobro
> y se aplica el tipo vigente ese día.
>
> **(a)** Si entra en vigor un cambio legal de tipo (por ejemplo, el 1 de enero a las 00:00), una
> mesa abierta antes y cobrada después se factura entera al nuevo tipo, también lo consumido antes
> de medianoche, porque la factura se emite después. ¿Es correcto, o debe aplicarse a cada
> consumición el tipo vigente cuando se sirvió?
>
> **(b)** Si se descubre una configuración errónea (por ejemplo, una bebida dada de alta en la
> categoría del 10 % que debía estar en la del 21 %) y se corrige publicando una nueva carta, las
> líneas ya añadidas a pedidos abiertos se facturan en la categoría con la que se añadieron (10 %).
> ¿Es correcto, corrigiéndolo después con una factura rectificativa, o deben facturarse con la
> categoría corregida?
>
> **(c)** ¿Cambia algo si el cobro se hace días después (por ejemplo, un pedido de grupo facturado
> más tarde)? ¿Y si la factura se emite al hacer el pedido y se cobra después, con un cambio de tipo
> entre ambos momentos?

This records a question; no enquiry has been sent.

---

### Q25. A void made on a later day — which VAT period does the annulment land in? (added 2026-09-24)

**Why it matters.** The fiscal core voids a sale by filing an RF de anulación of the original
invoice, and it checks nothing about the sale's date (`recordVoid`,
`packages/core/src/record-void.ts`). No till screen or server route calls it yet (on 2026-09-24,
`git grep recordVoid` outside `packages/payments` and the fiscal packages found only tests; on
2026-09-30, `git grep -l "recordVoid" -- apps ':!*.test.ts'` found nothing), so the
product has not yet decided when a void is allowed — which part (b) below would settle. The
quarterly *modelo 303* figure (`packages/reporting/src/vat-return.ts`) leaves a voided sale out of
the period it was ISSUED in, whenever the void happened. Until 2026-09-24 the daily reports did the
same, so a void on 5 August of a 4 August sale changed 4 August's recomputed VAT after that day's
frozen close (*cierre Z*) had been taken (found by #601's review). The owner decided on 2026-09-24
that the daily reports count a void on the day it is made, and they now do, so a later void no
longer changes a closed day's re-derived figures. The
*modelo 303* keeps its current behaviour until this question is answered.

[verifactu-findings.md](verifactu-findings.md) §7 already settles that anulación is only for an
invoice that should never have existed, and that a real sale is corrected with a factura
rectificativa. Do not ask that. What it does not settle is the period, and whether elapsed time
changes which mechanism applies.

> Nuestro TPV podrá anular un ticket ya emitido (con el permiso correspondiente), y lo remitirá a
> la AEAT como registro de facturación de anulación de la factura original. Entendemos, por las
> preguntas frecuentes de la AEAT para desarrolladores, que la anulación solo procede cuando la
> factura no debió expedirse, y que en los demás casos procede una factura rectificativa.
>
> **(a)** Si la anulación se registra en un día, o en un trimestre, posterior al de la factura
> anulada, ¿en qué periodo debe reflejarse en el modelo 303: en el de la factura original, como si
> no se hubiera expedido, o en el periodo en que se registra la anulación? Si el periodo de la
> factura original ya se declaró, ¿cómo se regulariza?
>
> **(b)** ¿Hay algún plazo o circunstancia (por ejemplo, que ese periodo ya se haya declarado) a
> partir del cual un ticket emitido por error ya no pueda anularse y deba corregirse con una factura
> rectificativa? Nos serviría para limitar en el TPV cuándo se permite anular.
>
> **(c)** Nuestro cierre diario (cierre Z) es un documento interno de control de caja, no una
> declaración, y reflejará la anulación el día en que se hace. ¿Hay algún inconveniente en que ese
> documento interno la sitúe en un día distinto del que corresponda a efectos del IVA?

This records a question; no enquiry has been sent.

---

### Q31. Correcting an issued ticket — by differences, or by substitution? (added 2026-09-30)

**Why it matters.** The fiscal core can file a corrective invoice (R5) against a simplified invoice
(`recordCorrection`, `packages/core/src/record-correction.ts`). The Veri\*Factu backend files it
*by differences*: `TipoRectificativa: "I"` in `packages/fiscal-verifactu/src/backend.ts`, so the
record carries only the amount that changes. No till screen or server route calls it yet. Its only
callers under `apps/` are three demo scripts in `apps/server/scripts/`, plus tests. *(2026-10-02,
C126: the till's cancel route now calls it, crediting an issued ticket in full when its order is
cancelled — see Q32.)* Since
2026-09-30 (#922), a correction that would take the invoice's total below zero, counting earlier
corrections, is refused (`sale.correction_exceeds_total`).

On 2026-09-29 the owner asked whether a correction should instead cancel the original and issue a
new invoice for the right amount: a corrective invoice *by substitution*, `TipoRectificativa` "S".
That is not decided, and it should be settled before the correction screen is designed
([backlog](../backlog.md), the **Left open** note in the *Menus M7v landed* entry). Two things are
already settled and not asked here. A void (*anulación*) is only for an invoice that should never
have existed ([verifactu-findings.md](verifactu-findings.md) §7; Q25 asks about its VAT period).
And tickets and full invoices need separate series (Q5).

> Nuestro TPV podrá corregir un ticket ya emitido (factura simplificada) mediante una factura
> rectificativa (R5). Hoy la rectificativa se emite por diferencias: sólo recoge el importe que
> cambia, en negativo si es una devolución. No se admite una rectificativa que deje el importe de la
> factura original por debajo de cero.
>
> **(a)** ¿Es preferible, o en algún caso obligatorio, emitir la rectificativa por sustitución, es
> decir, que sustituya a la factura original y recoja el importe correcto completo, en lugar de por
> diferencias? ¿Hay algún criterio para elegir entre las dos en hostelería?
>
> **(b)** Si se corrige varias veces la misma factura, ¿puede emitirse una rectificativa por
> diferencias sobre cada corrección anterior? ¿O conviene, a partir de la segunda, una rectificativa
> por sustitución que recoja el importe final?

This records a question; no enquiry has been sent.

---

### Q32. Cancelling an order whose ticket was already issued — a corrective invoice, or an annulment? (added 2026-10-02)

**Why it matters.** In a zone that invoices first, the simplified invoice is issued when the order
is placed, before anyone pays. If the order is then cancelled, the invoice must not be left standing
with nothing to collect it. On 2026-10-02 (lane C item C126, built in lane B) the owner decided,
without the asesor, that the cancel issues a corrective invoice for the whole amount in the same
step: an R5, *por diferencias*, through `recordCorrection`
(`packages/core/src/record-correction.ts`), the only kind the Veri\*Factu backend files
(`TipoRectificativa: "I"`, `packages/fiscal-verifactu/src/backend.ts`).
The original invoice is then settled at nothing owed. The same cancel reaches a bill recorded as
*left without paying* (Q28). The credit note's VAT breakdown is the original's, negated.

The sources, fetched raw on 2026-10-02:

- Ley 37/1992 (IVA), art. 80.Dos: «Cuando por resolución firme, judicial o administrativa o con
  arreglo a Derecho o a los usos de comercio queden sin efecto total o parcialmente las operaciones
  gravadas o se altere el precio después del momento en que la operación se haya efectuado, la base
  imponible se modificará en la cuantía correspondiente.»
  (<https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740>)
- RD 1619/2012, art. 15.2: a corrective invoice is due when «se hubieran producido las
  circunstancias que, según lo dispuesto en el artículo 80 de la Ley del Impuesto, dan lugar a la
  modificación de la base imponible» (<https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696>).
- AEAT, *FAQs-Desarrolladores* v1.3 (4 December 2025), §17, p.35: «Si se considera que "toda la
  factura" en sí misma está mal o no debería haberse emitido, siempre que para solucionarlo no deba
  emplearse algún procedimiento (de rectificativa u otro) previsto en el ROF, se podrá "anular"
  generando para ello un RF de anulación», and «La anulación no es, por lo tanto, un concepto
  jurídico […] cuando se llega a emitir con el SIF una factura por un servicio o una entrega que no
  existen y que, por tanto, no se han realizado.»

[verifactu-findings.md](verifactu-findings.md) §7 already settles that an annulment (*RF de
anulación*) is for when the "invoice should never have existed", and that «todas las facturas
emitidas, en la medida en que respondan a operaciones realmente efectuadas (como es el caso
habitual) no pueden anularse». Its §9 and §15.4 already settle that an invoice is issued AND
delivered — RD 1619/2012 art. 1, «expedir y entregar, en su caso» — and that art. 18 means
"transmission immediately on issuance to a non-business recipient". Do not ask those. Q31 asks
whether a correction should be filed by differences or by substitution; the cancel files by
differences, so Q31's answer bears on it too.

What those leave open: whether an order cancelled before it was served is an operation that
"quedó sin efecto" (a corrective invoice) or one that never took place (an annulment); and how the
duty to deliver applies to a corrective invoice issued when an order is cancelled, including when
the customer has already left.

> Nuestro TPV puede expedir la factura simplificada al registrar el pedido, antes del cobro. Si
> después se cancela el pedido, hoy emitimos en el mismo momento una factura rectificativa (R5) por
> diferencias por el importe total, y damos la factura original por saldada sin cobro.
>
> **(a)** Entendemos, por las preguntas frecuentes de la AEAT para desarrolladores, que una factura
> que responde a una operación realmente efectuada no puede anularse. Si el pedido se cancela antes
> de que se sirva lo pedido, ¿procede igualmente una rectificativa R5 por el total, o un registro de
> anulación de la factura original, por no haberse llegado a realizar la operación?
>
> **(b)** Entendemos que la factura debe expedirse y entregarse, en su caso (art. 1 del RD
> 1619/2012), y remitirse en el momento de su expedición (art. 18). ¿Debe entregarse al cliente (impresa o de otro modo), en el momento de la cancelación,
> la rectificativa emitida al cancelar el pedido? ¿Y si el cliente ya no está en el local, por
> ejemplo porque se marchó sin pagar?
>
> **(c)** Si el cliente se marchó sin pagar (pregunta Q28) y después se cancela esa cuenta, ¿es
> correcto emitir la rectificativa, o la deuda debe seguir registrada como impagada?

This records a question; no enquiry has been sent.

---

### Q23. Backup copies of the records held outside Spain, or by us (added 2026-09-23)

**Why it matters.** The
SQLite slice 2 design (finished in #652)
streams each venue's database, fiscal records included, to an S3-compatible bucket **the owner
supplies**, with any provider, so the copy may sit outside Spain; a dead box is rebuilt from it under a
fresh chain. Waitron Cloud's own bucket plugs into the same setting later; the owner decision that
closed Q16 places cloud instances in Spain, and the Spanish text below assumes the bucket follows. This revives two of the three ROF questions in
[cloud-storage §8a](https://github.com/waitron-io/waitron-cloud/blob/main/docs/reference/2026-07-31-cloud-storage-model-design.md) for a shape that
spec did not have: the owner's own bucket abroad, and our bucket as holder.

> Estamos desarrollando una copia continua de la base de datos de cada local, registros de
> facturación incluidos, a un almacenamiento en la nube que contrata el propio titular del local con
> el proveedor que elija, y que puede estar fuera de España. Si se pierde el servidor del local, se
> reconstruye uno nuevo a partir de esa copia, que inicia una nueva cadena. Más adelante podríamos
> ofrecer nosotros ese almacenamiento, alojado en España.
>
> **(a)** Si la copia se conserva fuera de España, ¿debe el local comunicarlo previamente a la AEAT
> conforme al artículo 22.2 del RD 1619/2012? ¿Influye que esté dentro o fuera de la Unión Europea?
>
> **(b)** Si somos nosotros quienes conservamos la copia por cuenta del local, ¿actuamos como tercero
> que conserva la documentación por cuenta del obligado, y nos supone alguna obligación, como la de
> facilitar a la AEAT el acceso en línea a los registros?

---

### Q24. Separate preparation environment (added 2026-09-09; numbered 2026-09-23)

You configure your actual restaurant in a separate preproduction database, practise only simulated
transactions and test payments, then export configuration into a fresh production database. Sales,
fiscal chains/counters and credentials do not transfer. Default preparation sends nothing to AEAT;
a deliberate functional check uses its external test service. The live system has no switch that
suppresses filing for training.

**Known boundary:** AEAT's developer FAQ v1.3, §11 pp.21–23, discusses systems invoicing
“en real” and treats their training invoices as real, followed by cancellation and retained history.
This is already recorded in `verifactu-findings.md`. The test portal separately states that its
submissions have no tax consequences. Neither statement alone answers the distribution and
operating constraints for the proposed preparation product.

**Question to resolve before releasing this mode:** What technical separation, output marking,
retention duties and product/declaration wording are required to distribute and use this separate
configuration-and-simulation environment, with no actual sales, alongside the live SIF?

**Para el asesor:** Queremos ofrecer un entorno separado de preparación, con su propia base de
datos, para configurar el restaurante y simular operaciones sin entregas de bienes ni prestaciones
reales, usando pagos de prueba. Solo se exportaría la configuración a una nueva base de producción;
no se trasladarían ventas, registros de facturación ni numeraciones. ¿Qué separación técnica,
identificación de los documentos simulados, obligaciones de conservación y descripción en el
producto y su declaración responsable exige esta modalidad? No proponemos desactivar la remisión
en el SIF que factura en real.

Sources checked 2026-09-09:
[AEAT developer FAQ, §11](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf#page=22)
and [external test portal](https://preportal.aeat.es/PRE-Exteriores/Inicio/Inicio.html).
This records a question; no enquiry has been sent.

## Notes for the conversation

- **Send first, 2026-09-30: Q27, Q28 and Q29** (the backlog's "send now"). They are about table
  service, which is being built now. A table that leaves without paying (service plan Task 17) is
  built on the owner's decision without the asesor (2026-10-01: issue the full simplified invoice
  when the table leaves; see Q28). Q29 and most of Q27 describe features that are already built,
  so an answer against them may mean changing shipped behaviour. **Q31** should be answered before the correction screen is designed.
- **Nothing here blocks the build any more.** As of 2026-07-27 this document is a list of things
  worth confirming, not things worth waiting for. If an asesor engagement slips, build anyway.
  *(2026-09-30: one exception above. Task 17 waits on Q28 by the owner's choice. 2026-10-01: no
  longer — the owner decided Q28 without the asesor, and Task 17 is built on that decision.)*
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
- *(2026-09-30: out of date. Q16 was closed on 2026-09-05 by an owner decision, not an answer:
  cloud instances are hosted in Spain. See its banner. Do not send it.)* **Q16 is the live
  architecture question**, and only if a cloud-primary or standalone topology is on
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
- **Q20 asks about the product label No tax (0%).** The implementation deliberately reuses the
  existing zero-rate `S1` treatment. Confirm which real venue products, if any, fit that treatment and
  whether the operator-facing label risks being confused with a non-subject `N1`/`N2` operation.
- **Do not open with "can I use multiple series".** It is settled, it is boring, and it
  invites a confident answer to a question we did not need to ask. The series is not the
  mechanism — the SIF is.
- **Push for the reasoning, not just the verdict.** Where the answer rests on FAQ
  interpretation rather than regulation, we need to know that, because it changes how much
  weight the design can put on it.
- **Ask what they would put in writing.** A view they will not commit to in an email is a
  view we should not build an architecture on.
