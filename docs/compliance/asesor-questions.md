# Questions for the asesor

Companion to [verifactu-findings.md](verifactu-findings.md), which records what is already
settled. **Do not ask about anything in that document** — it is sourced from AEAT and BOE
primary texts. These are the items that research could not resolve.

Each question has English context (for us) and a Spanish formulation (to hand over).

Question numbers are **stable identifiers**, not reading order — sections are ordered by
priority. Q9 is referenced from other documents; do not renumber it.

Last revised **2026-07-27**.

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
| Q9 open-source DR | **Substantially answered**; part (b) narrowed considerably |
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

**Q9 is not for the asesor fiscal.** It concerns liability for distributing open-source
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

**Why it matters.** We assume one series per till. Research confirmed the chaining rules but
never verified the underlying series permission in RD 1619/2012 art. 6.1.a. Low risk, but it
is the foundation of the numbering scheme. The rectificativa question is the practical one:
it is the case where a single till needs two series (and, per art. 7.c, still one chain).

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

### Q9. Who signs the declaración responsable for open-source software?

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
> declaration naming one container digest would not, which is a worse fit for an open-source
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
150.000 €/ejercicio plus 1.000 € per uncertified system sold. If publishing an open-source
codebase intended for building SIFs falls within *fabricación*, exposure attaches to the
project regardless of who deploys it. The `josemmo` disclaimer is a bet that it does not.

> Publicamos como código abierto un sistema de punto de venta que, una vez desplegado por un
> tercero, constituye un SIF. Nosotros no lo desplegamos para ese tercero, no lo
> comercializamos y no cobramos por él; cada empresa lo instala y lo configura por su cuenta.
>
> **¿Constituye la mera publicación del código fuente "fabricación o comercialización" de
> sistemas informáticos de facturación a efectos del artículo 201 bis de la LGT?**
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

---

## Notes for the conversation

- **Nothing here blocks the build any more.** As of 2026-07-27 this document is a list of things
  worth confirming, not things worth waiting for. If an asesor engagement slips, build anyway.
- **Lead with Q1 and Q2 anyway** if you get a meeting. They are demoted on inference rather than
  on a source, and an asesor who engages properly with them is one worth keeping; one who waves
  them through has told you something too.
- **Q3, Q4, Q8, Q9(b) and Q10 are answered** — do not ask them. Q4 in particular is settled on
  AEAT's own text; asking invites a confident wrong answer to a question we no longer have.
- **Q9(a) is the only consulta candidate**, and it is a lawyer's question. RD-ley 15/2025 moved
  the obligation to January 2027, so a 3–6 month consulta fits comfortably — file it rather than
  building on an opinion.
- **Q11 and Q12 are the same problem from opposite ends** — ask them together, and expect the
  answer to be about where the crossover sits rather than a clean yes or no.
- **Do not open with "can I use multiple series".** It is settled, it is boring, and it
  invites a confident answer to a question we did not need to ask. The series is not the
  mechanism — the SIF is.
- **Push for the reasoning, not just the verdict.** Where the answer rests on FAQ
  interpretation rather than regulation, we need to know that, because it changes how much
  weight the design can put on it.
- **Ask what they would put in writing.** A view they will not commit to in an email is a
  view we should not build an architecture on.
