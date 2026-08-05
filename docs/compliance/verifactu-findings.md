# Verifactu — verified findings

Research date: **2026-07-18**. Sources are AEAT and BOE primary texts unless noted.
Companion documents: [asesor-questions.md](asesor-questions.md) — the unresolved items;
[verifactu-faq-notes.md](verifactu-faq-notes.md) — indexed receipts from AEAT's developer FAQ (v1.3,
4-Dec-2025), with the source PDF pinned in `sources/`.

Everything here was checked against primary sources and adversarially verified. Where a
claim did not survive verification, or was not checked at all, it says so. **Do not treat
the unverified items as settled.**

---

## 1. The hash chain is scoped per (SIF; NIF) — not per series

This is the single most important correction to the original design assumption.

> **Design pointer, 2026-08-01 (#33).** The primary-source finding in this section — one chain per
> SIF, and per-till chains lawful *because each till is its own SIF* — is unchanged. What the
> [server-as-SIF design](../superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md)
> (#33) decides is *which node Waitron treats as the SIF*: the **local server**, not the till. The
> intended topology is therefore one chain per **server**, with a venue running two concurrent
> server-SIFs that must issue under disjoint series (see [asesor-questions.md](asesor-questions.md)'s
> §① banner). That is a design decision layered on this finding, not a correction to it.
>
> **Update, 2026-08-03 (#54).** The rekey has **landed** — the fiscal tables (`registro_sif`,
> `cadenas`, `registros_facturacion`) and `invoice_series` are now keyed by a **`node_id`** column,
> not the `server_id` this note first anticipated: the code names the machine a `node` (in US
> restaurant English "server" means a waiter), and #33's "server" IS this node. So the **per-till
> language below is now stale against the code** — read every "per till" in this section as
> **"per node"**, the node being the SIF. `till_id` survives only as an informational snapshot on
> `registros_facturacion`/`sales`.

**Orden HAC/1177/2024 art. 7.c):**

> Para un determinado obligado tributario, cada sistema informático producirá una única
> cadena de registros de facturación, es decir, todos los registros de facturación de un
> mismo obligado tributario generados por un mismo sistema informático deberán formar parte
> de la misma cadena.

AEAT states chaining runs *"independientemente de la serie o número que tengan las
facturas"*. Series is a data field (art. 7.a) and a hash input (art. 13.1.a) — never a
chain-partitioning criterion. AEAT's own sample XML chains invoice `12345` to predecessor
invoice `44`, which is structurally impossible under per-series chaining.

**Per-till chains are lawful — because each till is its own SIF, not because it has its own
series.** AEAT's trazabilidad FAQ addresses the multi-till case directly:

> si un OT dispone de varios TPV (en uno o diversos centros de venta, o tiendas) que expiden
> o gestionan la expedición de sus propias facturas de forma independiente a las del resto de
> TPV, cada TPV se considera que es un SIF […] así que deberá poseer su propia cadena de RF.
> De esta manera, el OT tendrá tantas cadenas de RF como TPV tenga.

And they need not be interconnected: separate SIFs *"no necesitan estar 'conectados o
comunicados' entre sí"*, and *"cada uno de ellos debe cumplir separadamente dicho RRSIF"*.

### What this means for the data model

- **One chain per till, holding every record type.** Alta and anulación records interleave in
  the same chain in generation order. It is a *record* chain, not an invoice chain.
- **Chain position is unrelated to invoice number.** Ordering is chronological by generation
  within the SIF. Never derive or validate chain order from the invoice counter.
- **The predecessor pointer is an invoice identity, not an index.** `Encadenamiento/
  RegistroAnterior` stores NIF + serie&número + fecha de expedición + first 64 chars of the
  predecessor huella.
- **One till may own N series but exactly one chain.** Series is a numbering concern; the
  chain is a device concern. If a till ever needs a second series (rectificativas are the
  likely case), it still chains into the same single chain.
- **Chains cannot be merged or migrated.** Folding one till's records into another's chain is
  impossible. Consolidating tills means the old chain ends and a new one begins.
- **Multi-tenant partitioning must include the NIF.** A system serving several obligados
  tributarios must behave as independent systems per taxpayer with independent chains
  (Orden art. 2). The key is genuinely the pair, not the till id alone.

### Identity and lifecycle

A SIF is identified by **NIF + IdSIF + NºInstalación**. The installation number
*"no puede repetirse nunca"* — a new one is required even when reinstalling the same
software on the same reformatted machine. Reimage, hardware swap and till relocation all
need deliberate handling.

> **Version is NOT part of the identity — settled on primary source, 2026-07-27.** AEAT
> developer FAQ v1.3 §4, verbatim:
>
> > Un SIF se identifica universalmente por la "concatenación" de tres campos: Id.OEF (NIF) +
> > Id.SIF + NºInstalación. Otro dato importante que caracteriza al SIF es su versión, pero **un
> > cambio en dicha versión (cuando se actualiza, por ejemplo) no significa que el SIF pase a ser
> > otro SIF con Id. distinto**, cosa que sí ocurre con los otros 3 campos mencionados.
>
> **An upgrade does not end the chain.** This matters because two true statements look like they
> collide, and they do not:
>
> | Statement | Sense | True? |
> | --- | --- | --- |
> | "Each version is a distinct product" | **Certification** — a DR per version | Yes |
> | "A component change bumps the CPF's version" (§5) | **Certification** | Yes |
> | "A new version is a new SIF" | **Identity / chaining** | **No** — §4 says so expressly |
>
> So a release needs a new declaración responsable and does *not* need a new installation number
> or a new chain. **Our rule: rotate on re-provisioning, never on upgrade.** mdiago rotates per
> release and thereby ends every till's chain on every release — unnecessary, and irreversible
> since chains cannot be merged. Their hardware answer is sound and we follow it: hardware
> changes alone do not require a new number.

**Recommended installation-number values** (§4) — either is acceptable to AEAT:

- a timestamp of the installation, to at least second precision; or
- a sequential number that never repeats across that OEF's installations: 1, 2, 3… n.

**One product serving several facturaciones needs one installation number each.** §4:

> Si se utiliza un SIF que permite llevar distintas facturaciones […] cada una de esas
> facturaciones distintas (sean de distintos OEF o del mismo OEF pero de distintos centros de
> facturación independientes, como tiendas) debe tener un nº de instalación propio y distinto al
> resto […] porque **se consideran SIF independientes, como si fueran "SIF virtuales"**, dentro
> de un producto SIF más completo que los gestiona y administra.

That is our multi-tenant, multi-site case described exactly, and it confirms the partitioning
already recorded above: the key is genuinely (NIF, installation), and each till or site is a
"SIF virtual" in AEAT's own words.

### `IndicadorMultiplesOT` is computed per user, not per deployment

**Added 2026-07-27**, developer FAQ §4. A field we must set correctly in a SaaS deployment, with
counter-intuitive semantics:

> Este valor deberá calcularse **de forma independiente por cada usuario** del SIF SaaS (no a
> nivel global del SIF SaaS) y se informará con "S" en todos los registros de facturación (y, en
> su caso, de evento) de aquellos usuarios que tengan creadas **más de una facturación** en el
> SIF SaaS, independientemente del estado de dichas facturaciones (alta, baja…) y de si son de
> igual o de distinto OEF. En caso contrario […] se informará con "N".

Three traps in that: it is **per user, not per platform** — a multi-tenant system does not set
"S" globally just because it serves many taxpayers; it counts **facturaciones the user has
created**, including inactive ones (*"independientemente del estado […] alta, baja"*); and it
does not matter whether those facturaciones belong to the same OEF or different ones. A gestoría
user managing several clients gets "S"; a single-site restaurant user on the same platform gets
"N".

### Clock tolerance is enforced at submission, not at generation

**Added 2026-07-27.** Orden art. 7.f requires the system to keep date and time accurate *"con un
margen máximo de error admitido de un minuto"*. That is a requirement on the *system*. What AEAT
actually enforces on the wire is a separate, looser check, from its error table:

> `2004 = El valor del campo FechaHoraHusoGenRegistro debe ser la fecha actual del sistema de la
> AEAT, admitiéndose un margen de error de: …`

The table templates the tolerance rather than printing it. **mdiago reports the value in
production as 240 seconds**, and that exceeding it yields *aceptado con errores* rather than a
rejection — so a drifting clock degrades submission quality without stopping trade.

Two consequences:

- **Do not block invoicing on clock drift.** A till days offline should keep trading. mdiago
  accepts internal drift and does not gate on it; the AEAT check happens later, at submission,
  when the device is by definition back online.
- **The two margins are different things.** One minute is the standard the system must be built
  to; 240 seconds is the tolerance a submission is judged against. Conflating them would lead to
  gating sales on a threshold that is not the one AEAT applies.

> The 240-second figure is **mdiago's observation, not printed in AEAT's published error table**.
> The error code, the field and the mechanism are confirmed from the table; the number is not.
> Verify against a live `aceptado con errores` response before relying on the exact value.

First record from a fresh installation carries `PrimerRegistro="S"`. AEAT returns a
non-rejecting warning if that is claimed when records already exist for that SIF+NIF —
useful as a signal that a till has been accidentally re-provisioned.

### Split till/backoffice architecture is expressly permitted — with conditions

**Added 2026-07-27.** Source: AEAT developer FAQ v1.3 (4 Dec 2025) §5 *"Arquitecturas de los
SIF"*. The PDF resists normal fetching; download and run `pdftotext -layout` locally.

AEAT states the general principle first — *"las arquitecturas «mixtas» […] incluso de fabricantes
distintos, no son contrarias a la normativa y pueden utilizarse"* — then describes two valid
shapes. The second is ours:

> Igualmente sería válida una arquitectura en la que sea la propia TPV la que genere el "Registro
> de alta de factura" directamente, procediendo también a su impresión con el código QR y entrega
> al cliente, y en tiempo real traslade todo ello al backoffice central, para que este último
> sistema proceda a su envío a la sede electrónica. Ese backoffice haría de instrumento para la
> remisión del fichero sin más.

**The relaying node is explicitly "un instrumento para la remisión sin más".** It is not the
point of expedition and does not become the SIF.

The conditions AEAT attaches are binding design constraints, not advice:

- **The link must be unavoidable.** *"Que la conexión entre los sistemas sea indefectible y
  necesaria, es decir que no quede a decisión del usuario sino que se produzca de forma
  automática y necesaria."* No user-triggered sync, no "upload now" button as the only path.
- **No orphans, in either direction.** *"No pueden quedar «huérfanos» ni facturas expedidas ni
  registros de facturación generados"* — and for Veri\*Factu this extends to transmission:
  *"no pueden quedar RF generados sin remitir a la AEAT."*
- **No reprocessing at the centre.** *"No sería acorde a la normativa la producción de los
  registros de facturación por parte de la TPV y un reproceso posterior de los mismos (que los
  altere) desde el servidor Back Office central."* What is transmitted must be byte-identical to
  what was generated and hashed at the till.
- **Immediacy applies to all three processes** — invoice + QR, RF generation, and transmission.
  *"Simultánea (entiéndase inmediata o sin demora apreciable)."*
- **Both ends must handle AEAT's error and warning responses**, including generating subsanación
  and anulación records: *"ambos componentes deberán estar preparados y correctamente integrados
  y coordinados para atender posibles respuestas con error o avisos."*
- **Each component must be certified for the part it performs** — see the CPF/CF rules below.

The orphan condition is the sharpest of these, and the existing orphan-drift work is the right
shape for it: an orphan is a compliance defect, not merely a data-quality one.

### Multi-component SIFs: which components need their own DR

**Added 2026-07-27.** Same source. A SIF may be composed of a **componente principal de
facturación (CPF)** plus one or more **componentes de facturación (CF)** — OM HAC/1177/2024
art. 1.2.b and 1.2.c. AEAT's default is that all of them need certifying:

> Los SIF que estén formados por dos, o más componentes […] deberán contar todos ellos con la
> preceptiva Certificación mediante Declaración Responsable.

With an exception for components that do not touch the regulated functionality:

> No será preciso certificar aquellos componentes que presten funcionalidades que sean
> irrelevantes […] las que no afecten a la generación del RF, a su encadenamiento, a la impresión
> de facturas, a la generación del QR, al envío a sede electrónica, al enlace indefectible entre
> componentes, a la conservación inalterada ni al registro de eventos.

Three cases, and **which one we are in depends on a decision we have not yet made**:

| Case | Situation | DR consequence |
| --- | --- | --- |
| (a) | CF produced by a third party | CF needs its own DR. The CPF's DR must name it, the **exact version used**, and how/when/why it is invoked |
| (b) | CF by the same producer but with an **independent release cycle** — *"productos separados, que pueden dar servicio a múltiples CPF, que incluso podrían comercializarse de forma independiente"* | Same as (a) — its own DR |
| (c) | CF by the same producer with a **linked release cycle** | No separate DR. The CPF's DR must explain the integration and its *uso indefectible*. **A change in the CF is a version change of the CPF** |

**This decides the fate of `packages/verifactu`.** Kept internal with a release cycle tied to the
POS, it is case (c) — no separate DR, and bumping it bumps the product version. **Published as a
reusable source-available library for others to build on, it is case (b) by AEAT's own words, and needs a DR
of its own.** That is not a licensing consequence; it follows from the component being separately
usable.

It also explains mdiago's position exactly: they are case (a)/(b) to their integrators, which is
why they issue a DR per release for the library. Their reasoning was right and is now sourced.

### Required runtime check

Orden art. 7.i obliges the system, **before generating each new record**, to verify that the
stored predecessor huella matches the record before it. This belongs in the write path of
every sale, not in a periodic audit.

### Never-reused installation numbers rely on a global unique index, not on RLS

**Added 2026-07-21, verified in implementation.** *"No puede repetirse nunca"* is a claim about
every installation this software has ever run, across every tenant a multi-tenant deployment
serves — not merely within one tenant's own rows. Row-level security cannot be the control for
that: RLS filters what a role can *see*, and a UNIQUE constraint is enforced against the whole
table regardless of what any one session's policy would let it read.

**Unique constraints are NOT RLS-filtered — a hidden conflicting row still raises 23505.**
`registro_sif_instalacion_uq` (`UNIQUE (nif, id_sistema_informatico, numero_instalacion)`,
`packages/fiscal-verifactu/src/registro-sif.ts`) is therefore deliberately global, carrying no
`tenant_id` in its key and enforcing across every tenant's rows even under
`FORCE ROW LEVEL SECURITY` — verified live: a second tenant sharing the same
(NIF, IdSistemaInformatico, NúmeroInstalación) triple still collides with 23505, even though that
tenant's own session can never `SELECT` the conflicting row. This is the property that actually
makes never-reuse hold, not a convention the application is trusted to keep.

The identical reasoning governs the counter that mints these numbers
(`contadores_instalacion`, same file): it carries no `tenant_id` and no RLS at all, keyed by NIF —
the obligado tributario for this purpose — because a single writer cannot guarantee uniqueness
over rows a policy hides from it. An RLS predicate there would silently let two tenants sharing a
NIF allocate the same number.

### Record identity and duplicates

Records are identified by the triple **IDEmisorFactura + NumSerieFactura +
FechaExpedicionFactura**. AEAT returns error 3000 on duplicates (per-record rejection, not
whole-submission). Numbering may never be reused — *"aunque sean facturas expedidas 'de
prueba'"*. Test invoices burn real numbers.

---

## 2. There is no submission deadline — but there are duties

**No numeric window exists anywhere.** RD 1007/2023 art. 8.1 states the duty qualitatively:
records transmitted *"de forma continuada, segura, correcta, íntegra, automática,
consecutiva, instantánea y fehaciente"*. Art. 16.1 reuses the identical phrase to *define*
Verifactu. A full-text scan of the consolidated Reglamento found no maximum in hours or days.
There is no analogue of SII's 4-day window.

> Vendor pages claiming a "plazo legal de remisión de 24 horas" were checked and rejected.
> No such figure appears in the RD, the Orden, or the technical spec.

**Nothing rejects a late record.** `FechaHoraHusoGenRegistro` is validated only as an *upper*
bound against AEAT clock; future-dated trips error 2004, which is non-rejecting and expressly
exempt from subsanación. `FechaExpedicionFactura` is checked only for not-future and
not-before-28/10/2024. Nothing compares issuance to submission time. A week-old backlog
submits cleanly — architecturally necessary, since hourly-retried backlogs would otherwise
always fail.

### Unplanned outage: tolerated indefinitely, with obligations

AEAT, on power cuts, connection failures, and AEAT's own service being down:

> se ampliarían los plazos de remisión hasta la restauración de la caída […] no hay
> establecido un plazo máximo fijo

and invoicing must not stop: incidents *"NO suponen en ningún caso que deba interrumpirse la
facturación de la empresa."*

But "no deadline" is not "no duties". **Orden HAC/1177/2024 art. 16.4** requires throughout:

| Duty | Detail |
| --- | --- |
| Retry | **at least once every hour** |
| Ordering | chronological generation order on recovery |
| Flag | `Incidencia="S"` on affected messages |
| **User-visible warning** | persistent on-screen count of unsent records, *"mientras quede alguno de estos por remitir"* |
| Justification | to AEAT on demand |

A system offline for a week is compliant **if hourly retries keep firing**. One that sleeps
through the outage breaches art. 16.4 even though it missed no deadline.

### Deliberate daily batch upload is prohibited in Verifactu mode

AEAT was asked precisely this:

> ¿Puede plantearse la posibilidad de que el sistema informático vuelque, al final del día
> los registros de facturación en un sistema conectado para su remisión a la AEAT?
>
> **No**, ese volcado ulterior no es en sentido propio una facturación, puesto que los
> clientes ya se habrán llevado las facturas impresas y, por lo tanto no cabe esa remisión
> "en diferido".

Offline-by-design is **not** an extended outage. The legitimate route for a
permanently-disconnected till is non-Verifactu mode.

> **This FAQ cuts both ways for our design — see [§5](#5-open-risks-in-the-current-design).**

### Penalties do not attach to delay

LGT art. 201 bis targets non-compliant *software*: fabricación/comercialización
150.000 €/ejercicio (plus 1.000 € per uncertified system sold), mere **tenencia**
50.000 €/ejercicio. There is no delay-specific tipo.

Vendor claims that late submission triggers 201 bis cite no paragraph and were rejected as
marketing conflation. **But** enforcement of an art. 16.4 retry breach is genuinely
unresolved — no source addressed it. Do not read this as "delay is free".

---

## 3. Verifactu vs non-Verifactu

Both are *"igualmente válidas"*. The split:

| | Verifactu | No verificable |
| --- | --- | --- |
| Transmission | continuous, immediate | none; on requerimiento (art. 14.2) |
| Hash | required | required |
| **Electronic signature** | **exempt** (art. 16.3) | **required** (art. 12) — XAdES Enveloped / ETSI EN 319 132, qualified certificate |
| **Registro de eventos** | **not required** | **required** |
| Art. 8 integrity duties | presumed by design | must be demonstrated |

AEAT on the event log: *"Este registro de eventos solo es obligatorio en el caso de los
sistemas de emisión de facturas no verificables, no siendo necesario en los casos de SIF
«VERI\*FACTU»"*.

**Non-Verifactu is the more expensive build**, not the cheaper one. Qualified certificate key
management on every offline till is materially harder than the Verifactu path. If the
grey-zone questions resolve favourably, keeping marginal users in Verifactu mode is worth
real effort.

One upside: records sent under requerimiento have all business-validation errors marked
admissible (never rejecting), sole exception being NIF/IdOtro checks — and correcting them
is **prohibited**, since they must be exactly what was stored.

### Mode granularity

Mode is chosen **per SIF**, so per till:

> la opción por una u otra modalidad no es conjunta para el obligado a facturar, que podrá
> tener un SIF en la modalidad VERI\*FACTU y otro en modalidad sistema de emisión de facturas
> no verificables

But mixing **within** one SIF is forbidden — *"Cada uno de esos sistemas no podrá intercalar
operaciones en la otra modalidad."* AEAT discourages mixing across a taxpayer's SIFs: it
produces *"listados incompletos de facturas emitidas"* needing requerimientos to complete.

**Calendar-year lock-in:** once a taxpayer begins remitting under Verifactu they must remain
in that mode at least to the end of the natural year.

---

## 4. Other hard requirements

**Clock accuracy — one minute.** Orden art. 7.f: *"deberá asegurarse de que la fecha y hora
empleadas […] son exactas, con un margen máximo de error admitido de un minuto."* Same value
reused in art. 7.i for chain-ordering checks. On tills that may be offline for a week with no
NTP, drift is a compliance defect and needs deliberate handling.

**Flow control.** Orden art. 16.2 defines a wait `t`, initialised to 60 seconds and updated
by AEAT in each response, plus a per-send record cap. Distinct from the art. 16.4 hourly
retry — the two coexist.

**Timestamp tolerance.** The official spec says only *"admitiéndose un margen de error"*
without a number. The commonly reported 240 s (120 s in some flows) comes from
`errores.properties` and practitioner reports, **not** from the official PDF. Treat as
operationally reliable but do not hard-code an assumption — AEAT appears to serve it
dynamically.

**Compliance dates: 1 Jan 2027** (Impuesto sobre Sociedades obligados), **1 Jul 2027** for
the rest. Moved more than once already (RD 254/2025, RDL 15/2025). A claim asserting 2026
dates was refuted 0-3 during verification. Re-check before planning against them.

---

## 5. Open risks in the current design

> **Two of these four are closed.** §5.1 (Q2) and §5.2 (Q1) were both settled on primary source on
> 2026-07-27 and are retained with dated pointers rather than deleted. Only §5.3 and §5.4 are live.

### 5.1 "The till never submits to AEAT" vs the volcado prohibition

> **CLOSED 2026-07-27 on primary source — pointer added 2026-07-30.** This is Q2, and it is no
> longer an open risk. AEAT's developer FAQ v1.3 §5 *"Arquitecturas de los SIF"* describes this
> architecture and declares it valid: the TPV generates the alta record, prints the QR, hands the
> invoice over, and relays in real time to a backoffice *"para que este último sistema proceda a su
> envío"*, that backoffice acting *"de instrumento para la remisión del fichero sin más"*. The
> closure and its quotations live in
> [asesor-questions.md Q2](asesor-questions.md#q2-may-a-node-other-than-the-till-transmit-the-tills-records-to-aeat).
> The analysis below is retained because knowing
> which reading won, and why, is worth more than a document that reads as though it were always
> right.

The architecture has records chain at the till, flow up, and **the nearest node holding the
certificate submits**. Structurally this resembles the pattern AEAT rejected — records
generated on one system, transmitted by another.

The FAQ cuts both ways:

- **Favourable reading.** AEAT's stated rationale is that the later dump *"no es en sentido
  propio una facturación, puesto que los clientes ya se habrán llevado las facturas
  impresas"*. That reasoning confirms **the till is the SIF** — invoicing happened where the
  customer was served. What is prohibited is treating the *central* system as the point of
  issuance. Relaying transmission on behalf of a till-SIF is a mechanical act, not an act of
  invoicing, and art. 8.1 requires the SIF to have the *capacity* to transmit without
  specifying that it must open the socket itself.
- **Risky reading.** The prohibition is about records reaching AEAT from a system other than
  the one that generated them, with the customer already gone — which is exactly the relay,
  differing only in latency.

**Unresolved. This is a blocking question**, because certificate placement is a load-bearing
security decision in the current design and the answer may force certificates onto tills.

### 5.2 The SIF boundary for a till that syncs in minutes

> **CLOSED 2026-07-27 on primary source — pointer added 2026-07-30.** This is Q1, and it is no
> longer an open risk. The developer FAQ v1.3 answers it twice: **§5** expressly contemplates a till
> that generates locally and *"en tiempo real traslade todo ello al backoffice central"* without
> collapsing the tills into one SIF, and **§4** states that one obligado's *"distintos centros de
> facturación independientes, como tiendas"* each need their own installation number *"porque se
> consideran SIF independientes, como si fueran «SIF virtuales»"*. See
> [asesor-questions.md Q1](asesor-questions.md#q1-is-a-till-that-syncs-to-a-shared-backend-within-minutes-an-independent-sif).
> What remains unsourced is any primary text
> addressing **sync frequency** in isolation; that residual is not enough to reopen the risk, and
> §1 of this document has stated the settled position throughout.
>
> This pointer exists because §5 contradicted §1 for three days and misled a later session into
> treating per-till chains as blocked.

AEAT's ERP-modules FAQ contrasts two cases:

- modules interconnected and controlled in real time by one central ERP → **one SIF, one
  chain**, regardless of series;
- modules generating alta records, huella and QR *"de forma descentralizada y sin enlazar en
  tiempo real"* — their example uploads **monthly** — → separate SIFs.

Waitron sits between them: local generation (favourable) but backend sync in minutes
(unlike the monthly example). AEAT's wording is hedged — *"puede entenderse que son SIF
diferentes"*. **Interpretive, not a bright line.** If it resolves against us, per-till chains
collapse into one chain per issuer and the offline design changes shape substantially.

### 5.3 Intentionally-offline till with failing retries

A Verifactu-mode till kept offline all day, hourly retries firing and failing, syncing at
close. Not the prohibited volcado (no transfer into a different system), not an unplanned
incident either. No source resolved this.

### 5.4 Requirements not yet in the design

- Persistent on-screen unsent-record count (art. 16.4) — a UI requirement, not a background
  detail.
- Hourly retry scheduler surviving app restarts and long offline periods.
- Installation-number minting, storage and reissue-on-reimage lifecycle.
- One-minute clock accuracy on long-offline devices.
- Pre-generation chain verification (art. 7.i) in the sale write path.

---

## 6. What was NOT verified

- **RD 1619/2012 art. 6.1.a itself.** The multiple-series permission and the meaning of
  *"cuando existan razones que lo justifiquen"* were not sourced. The per-till series
  conclusion is inferred from AEAT's per-TPV SIF guidance. Low risk, but not confirmed.
- **Whether rectificativas require their own series.** Believed yes; unverified. Relevant
  because it is the concrete case where one till needs two series and one chain.
- **No consulta vinculante DGT** was located on per-till chains. The per-TPV position rests
  on FAQ authority — interpretive, not binding.
- **TicketBAI / Basque and Navarre regimes** were not examined. Separate regimes; nothing
  here transfers. Out of scope while Barcelona-only.
- **The receipt-legend difference** between modes (Verifactu invoices believed to carry a
  verifiability legend alongside the QR) — asserted from memory, never verified.

---

## 7. Corrections after issuance — there is no "update" (added 2026-07-31)

Sourced from the developer FAQ's §*"RECTIFICACIONES, ANULACIONES, SUBSANACIONES"*. Four paths, and
none of them amends an issued invoice:

| When | Mechanism |
| --- | --- |
| Before issuing, in edit | *«se corrigen sin más antes de emitirla»* — free, no RF |
| After, error covered by the ROF | **Factura rectificativa** — a new invoice, new number, new RF de alta |
| After, internal RF fields only | **RF de alta de subsanación** — *«MUY POCO FRECUENTES»* |
| After, invoice should never have existed | **RF de anulación** — *«MUY POCO FRECUENTES»* |

Two constraints follow, both load-bearing for any invoice-before-payment design:

- **Subsanación cannot change an amount.** It is scoped to fields *«que "no se ven" en la factura
  impresa, es decir, son campos "internos", como ciertas codificaciones tributarias»*.
- **Anulación is unavailable for the ordinary case.** *«todas las facturas emitidas, en la medida en
  que respondan a operaciones realmente efectuadas (como es el caso habitual) no pueden anularse»*.
  A customer who does not pay does not annul the invoice; the supply happened and the debt is a
  receivable.

AEAT reserves *«casos muy excepcionales»* for subsanación and anulación **only**. Rectificativa is
the normal ROF procedure and carries no such warning.

---

## 8. Pre-facturas are lawful, and preserved once issued (added 2026-07-31)

Same document, §11 and the duplicate-RF section. A pre-bill is *«una operación ordinaria en el
contexto de la actividad mercantil»*, and AEAT locates the moment an invoice comes into being after
it: *«tiene que existir un momento en el que, una vez completado internamente el contenido de una
factura, este se valide a los efectos de elaborar un RF […] expedir la correspondiente factura con
su numeración e, inmediatamente, remitir el RF»*.

**Mutating the order before that moment is explicitly lawful** — *«cualquier alteración que se
produzca en ese registro, previo al RF, sería perfectamente lícita»*.

**Issuing the pre-bill attaches a preservation duty:**

> «cuando los albaranes, proformas, prefacturas o facturas sin validez fiscal se expidan, sus
> registros deberán conservarse de forma inalterable (salvo que la alteración se produzca por medio
> de un registro posterior, que también deberá quedar anotado en el sistema)»

reinforced by: *«la conservación de los registros resulta obligatoria, incluso en el caso de que se
utilice una modalidad preparatoria como pre-facturas, proformas, borradores de pruebas, etc. que no
lleguen a integrar una factura completa»*.

This is **not RRSIF**. It is art. 29.2.j) LGT, which AEAT says *«despliega efectos directos desde su
entrada en vigor en octubre de 2021 respecto de cualquier otro sistema informático»*. The
parenthesis is the design: an append-only amendment log satisfies it and the working order may stay
mutable.

**Not verified:** AEAT's list says *albaranes, proformas, prefacturas* and never uses *precuenta*.
Treating a restaurant pre-bill as a member of that family is our reading — see Q14.

**Also here:** AEAT does not accept a live SIF producing fictitious invoices for testing or staff
training. Their sanctioned route is real invoices on a distinguishable series (their example,
`PRU 25 XXXX`), visibly described as tests, each followed by a mandatory RF de anulación. Relevant
before anyone trains staff on a live till.

---

## 9. Issuing and delivering are separate obligations (added 2026-07-31)

RD 1619/2012 (BOE-A-2012-14696):

- **art. 11** — *«Las facturas deberán ser expedidas en el momento de realizarse la operación»*. The
  16th-of-the-following-month deadline applies only where the recipient is a business.
- **art. 2** — the obligation is to *«expedir factura y copia de esta»*.
- **art. 18** — transmission immediately on issuance to a non-business recipient. Handing the
  invoice over is not on request.
- **art. 9** — *«La expedición, transmisión y recepción de la factura electrónica estará
  condicionada a que su destinatario haya dado su consentimiento»*.

The last one constrains delivery design: **electronic delivery cannot be the default**, so emailing
or QR-only cannot replace paper without consent.

---

## 10. Rectificativas need their own series — and F3 canje is not a rectificativa (added 2026-07-31)

### 10.1 A separate series for rectificativas is mandatory. Q5(b) is closed

RD 1619/2012 art. 6.1.a), after permitting optional separate series *«cuando existan razones que lo
justifiquen»*:

> «No obstante, será obligatoria, en todo caso, la expedición en series específicas de las facturas
> siguientes: […] **Las rectificativas.**»

Read twice from the BOE, through the consolidated text (`buscar/act.php`) and the original
(`buscar/doc.php`). **The two renderings list a different number of items** — five and three — which
is consistent with later amendments adding to the list; the item that matters appears in both, and
neither includes facturas simplificadas.

Two consequences:

- **Q5(b) — answered: yes, mandatory.** No longer a prerequisite for the rectificativa cycle.
- **Q5(c) — partly answered.** Simplified invoices are absent from a list introduced by *«en todo
  caso»*, so no separate series is *required* for them. AEAT's own worked examples nonetheless use
  `S-0001` for simplified, `F-0001` for ordinary and `R0001`/`RS-0001` for rectificativas — practice,
  not obligation.
- **Q5(a) — still open.** The article's example is *«cuando el obligado a su expedición cuente con
  varios establecimientos»* — several *establishments*, which is not the same as several tills inside
  one. The per-till series conclusion still rests on AEAT's per-TPV SIF guidance.

### 10.2 F3 — the "make me a proper invoice" case, which we do not model

A customer who received a simplified invoice and then asks for a full one with their tax details
does **not** trigger a rectificativa. The correct document is a **factura de canje, `TipoFactura`
F3**, and AEAT is explicit that it is a different animal:

> «No tiene la consideración de rectificativa (2º párrafo del artículo 15.6 del […] "ROF" […]), por
> lo que no estamos ante un caso de rectificación (no procede rectificar las facturas simplificadas
> canjeadas por el mero hecho de canjearlas con una factura tipo F3). […] Siempre debe llevar el
> destinatario de la misma.»

The rules that fall out of AEAT's worked examples:

- **Do not annul the simplified invoices being exchanged.** The F3 key itself prevents double
  counting — *«el importe total […] de una factura de canje F3 NO se volverá a tener en cuenta a
  efectos tributarios porque ya se declaró a medida que se fueron expidiendo las facturas
  simplificadas a las que canjea»*.
- **One F3 may exchange many simplified invoices** across a period, *«permitido por el ROF […] de
  acuerdo con la consulta vinculante V2543-06»*.
- **The F3's registro must identify what it replaces**, in the `FacturasSustituidas` block.
- AEAT warns separately not to collect the money twice — *«deberá tenerse cuidado de no cobrar dos
  veces el importe, se haga con cargo a los tiques o a la factura de canje»*.

Rectifying a *simplified* invoice, by contrast, is `TipoFactura` **R5** with `TipoRectificativa` `I`
(por diferencias) and a negative `ImporteTotal`, followed by a fresh F3 if the customer had one.

**Where we stand.** `packages/verifactu` already types `F3` and both `FacturasRectificadas` and
`FacturasSustituidas`. Nothing above them uses either: `fiscal-verifactu/src/backend.ts:257` emits
`sale.counterparty === null ? "F2" : "F1"` and no third case, and `sales` has no column referencing
another invoice. A restaurant is asked for a proper invoice routinely, so this is ordinary trade, not
an edge case.

---

## 11. Propinas — outside the base imponible del IVA, off the factura, off the huella (added 2026-08-01)

Confirms what the schema already encodes. Since **#39 (sale settlement)** the tip lives on
`tenders.tip_amount`, documented as the payer's *"affirmed gratuity, non-taxable and on no invoice"*
(`packages/db/src/schema/sales.ts:154`) — #39 took it off the immutable `sales` row, which now
carries only `total`. `record-sale.ts` hands the fiscal backend only that `total`, described there as
the taxable base *"excluding the tip, which is non-taxable and never reaches the fiscal record"*
(`packages/core/src/record-sale.ts:65`); `settleSale` sums the tip into the coverage identity
`sum(amount) = total + sum(tip)` and writes it to `tenders`, never near `computeHuella`'s inputs — a
structural absence, not something a dedicated test asserts. **That assumption holds** on the DGT's own
doctrine. (The `sales.tip_amount` location this section first cited was retired by #39; the fiscal
path — the tip never reaching the huella — is unchanged.)

**Provenance — read this before citing.** PETETE (the DGT consulta database,
`petete.tributos.hacienda.gob.es`) could **not** be reached: every fetch failed TLS chain validation
(*"unable to verify the first certificate"*). DGT consultas are not published in the BOE — PETETE is
their only primary home — so the verbatim below comes from **faithful legal-database reproductions**
(Iberley, loyra.com, fiscal-impuestos.com) cross-checked across the three consultas below, whose text
agrees, **not** from PETETE itself. Treat this as "the DGT's words at one remove", not "read on
PETETE"; confirm on PETETE before relying on exact wording. The *substance* — a voluntary tip is not
*contraprestación*, so it is outside the base imponible — is stated identically by every source and by
two **binding** consultas, so the design question is answered even though the primary database was
unreachable by tool.

**Correction to the citation Q13 carried.** [asesor-questions.md](asesor-questions.md) Q13 (following
the secondary commentary) called this *"DGT consulta vinculante 2174-03"*. **2174-03 is a consulta
GENERAL, not vinculante** — every reproduction labels it *"Consulta general"*, dated 11 December 2003,
and it carries no *"V"* prefix (the marker of the vinculante series). The binding restatements are
**V3095-17** and **V1808-22**. This is §1's "quote the source's own words" landing on a load-bearing
adjective.

The verbatim doctrine, most on-point first:

| Consulta | Type | Facts | Verbatim (IVA) |
| --- | --- | --- | --- |
| **2174-03** (11 dic 2003) | general | restaurant staff tips | *"Las cantidades que en concepto de propinas satisfagan con carácter voluntario y unilateral los destinatarios de los servicios de restaurante, y que no los sean exigibles por la prestación de tales servicios, no constituirán un crédito efectivo a favor de la sociedad consultante ni tampoco contraprestación de dichos servicios a efectos del Impuesto sobre el Valor Añadido, por lo que no formarán parte de la base imponible de dicho Impuesto…"* |
| **V3095-17** (29 nov 2017) | **vinculante** | casino tips collected by the house, distributed via a *tronco de propinas* | *"las propinas que de manera voluntaria y unilateral satisfagan los clientes a los crupieres trabajadores del casino no forman parte de la base imponible del IVA"* |
| **V1808-22** (29 jul 2022) | **vinculante** | voluntary donativos on a website | *"no determinarán la realización de operaciones sujetas al impuesto en la medida en que no constituyan la remuneración de entregas de bienes o prestaciones de servicios"* |

**The test is voluntariedad, not payment method — which answers Q13(b), the card-present case.** The
worry was that a tip charged in a single card capture exceeding the invoice total might be pulled into
the base. It is not: the doctrine rests entirely on the tip not being *contraprestación*, and
**V3095-17 is precisely the "collected by the business" shape** — the house takes the tips into a
*tronco* and redistributes them, exactly the flow a card tip follows through the merchant account —
and still holds them outside the base imponible. None of the three distinguishes cash from card for
IVA. So the tip stays out of the factura's base and out of the huella whether it arrives as cash or on
the same card capture as the bill.

**But the card-present case creates a NON-fiscal duty the cash case does not, and it is worth
flagging.** V3095-17 also holds that once the tip is **collected by the business** it is
*"ingreso contable"* that *"deberá integrarse en la base imponible del IS"*, and for the employees the
amounts from the *tronco* are *"rendimientos del trabajo a efectos del IRPF"* that are *"sujetas a
retención"*. A tip handed directly in cash from customer to waiter is a pass-through the business never
books; a tip that flows through Waitron's card terminal is **business income** that must reach the IS
books and the employee's nómina with withholding. **This does not touch the factura or the huella** —
`tip_amount` staying out of the fiscal record is correct and unchanged — but a card-collected tip is
not "nothing to us" for accounting and payroll. Workforce/accounting concern (integrate-not-build),
not a fiscal-record one, and a product decision rather than a compliance blocker.

**Q13(c) — documenting the tip to the customer — is not squarely answered.** No consulta requires the
tip on the factura, and none prohibits it; the sources are silent on receipt format. What the
base-imponible holding fixes is that **if** shown, the tip must be an amount *outside* the base
imponible (a non-taxable memo), never a taxable line. Left open.

**Net for the code:** the fiscal path is confirmed correct — no change to `computeHuella`, the factura
or the base. The open items are product/accounting, not fiscal: (b)'s card-tip income/payroll duty and
(c)'s receipt format.

---

## 12. Short payment — a descuento reduces the base only if it reaches the bill before issuance (added 2026-08-01)

The counter case (Q15): bill €70, customer is €5 short, staff accept €65 as payment in full. Which of
two treatments applies is decided by primary law, and the boundary is **whether the reduction is
agreed before or after the factura is issued.**

**A reduction agreed at or before the operation is a descuento, and descuentos are outside the base
imponible.** LIVA (Ley 37/1992) art. 78.Tres.2º, verbatim from **AEAT's own Manual práctico de IVA
2025** (read directly on `sede.agenciatributaria.gob.es` — an official AEAT source, unlike the
PETETE-blocked consultas in §11):

> *"Los descuentos y bonificaciones concedidos previa o simultáneamente al momento en que la operación
> se realice y en función de ella y que se justifiquen por cualquier medio de prueba admitido en
> derecho."*

— these *"no se incluirán en la base imponible"*. So when staff accept €65 as payment in full **before
the factura simplificada is generated**, the operation genuinely is €65: base imponible €65, VAT on
€65, one invoice, nothing outstanding. **This confirms the design assumption in Q15** — *"the reduction
has to reach the bill before the invoice is issued"* — on primary/official text.

**Once the factura is issued, correcting it needs a factura rectificativa, and the route forks:**

- **Agreed price reduction (descuento posterior)** — art. 80.Uno.2º LIVA reduces the base for
  descuentos *"concedidos con posterioridad al momento en que la operación se haya realizado"* when
  duly justified, via a rectificativa. This is the natural reading of "we agreed to take €65", and it
  does **not** require the incobrable machinery.
- **Unpaid debt (crédito incobrable)** — art. 80.Cuatro LIVA, whose conditions make recovering the €5
  of VAT practically impossible: a waiting period (**one year**, six months for smaller businesses),
  a *fehaciente* reclamación of the debt, a minimum base imponible when the debtor is a final consumer,
  a rectificativa within a further window, and a communication to AEAT. Ley 31/2022 relaxed these
  (reclamación *"por cualquier medio que acredite fehacientemente la reclamación del cobro"* replacing
  the old requerimiento notarial / reclamación judicial; the final-consumer minimum lowered, reported
  as €50 excl. IVA). **These art. 80.Cuatro figures are from secondary summaries — confirm the current
  thresholds at BOE before relying on them** (the consolidated BOE page truncated before Title V in the
  fetcher, so art. 80 was not read at source here; art. 78.Tres.2º above was, on the AEAT manual).

**The boundary is a legal characterization Q15 turns on, and it is the one genuinely interpretive
part.** Accepting a lower amount *"as payment in full"* at the counter is an **agreed reduction** — a
descuento — not an impago, because the parties settle on a new price rather than leaving €5
outstanding. So even after issuance the correct route is art. 80.Uno.2º (rectificativa reducing the
base), not the art. 80.Cuatro incobrable path. The distinction matters only because the impago reading
would leave VAT due on the uncollected €5; and for €5 nobody issues a rectificativa either way, so the
practical rule is: **apply the reduction before issuing.**

**Q15(c) — cash rounding — is the same shape at higher frequency.** Rounding a cash total down to the
nearest five cents is a descuento concedido simultáneamente (art. 78.Tres.2º): applied before the
factura is issued it reduces the base, so the invoiced and collected amounts coincide with no separate
line required — the base is simply the rounded figure. (Rounding *up* is not a descuento and would add
to the base; the realistic case is rounding down.)

**Net for the code:** the assumption that a short payment of this size is a discount, applied to the
bill before issuance, is correct on primary law. The residual is the characterization boundary above
(interpretive) and the exact art. 80.Cuatro thresholds (confirm at BOE).

---

## 13. A correction may be issued from a different SIF than the original invoice (added 2026-08-02)

**Primary source — AEAT Developer FAQ (`FAQs-Desarrolladores.pdf`, 4 December 2025), on correction
cases 2.b (subsanación) and 2.d (anulación):**

> «tanto un RF de alta de subsanación como un RF de anulación se podrían generar y conservar o remitir
> a la AEAT **desde un SIF distinto al que expidió la factura original** (aunque probablemente, lo más
> habitual es que todo se haga en el mismo SIF).»

AEAT **explicitly permits** a correction record to be produced / stored / transmitted **from a SIF
different** from the one that issued the original. Same-SIF is the usual case, not a requirement.

**Consequence for rectificativas — this closed the open question in `recordCorrection`.** A
*rectificativa* is a self-standing new invoice (RF de alta, `TipoFactura` R1–R5) that references the
original only by **invoice identity** — `FacturasRectificadas` = `(IdEmisorFactura, NumSerieFactura,
FechaExpedicionFactura)`, the same triple AEAT identifies any record by (#33 §12). It does not touch
the original's chain at all, so it is *a fortiori* unconstrained as to which SIF issues it — even more
clearly than the subsanación/anulación the FAQ names.

**Why it is not merely theoretical (server-as-SIF, #33).** A venue runs **more than one SIF** — each
server is its own SIF with its own chain (#33 §3, "two servers, two SIFs, one venue"). So a correction
genuinely *can* land on a different server-SIF than the original (across the two active servers, or
after a failover). The FAQ permits that for the sibling correction records it names; a rectificativa
follows *a fortiori* by the identity-linkage argument (see the provenance caveat below).
`packages/core/src/record-correction.ts` therefore takes the issuing `tillId`/SIF as a caller input
and does **not** require it to match the original's — by design, and correct **on that inference**
(confirm with the asesor before a cross-SIF rectificativa is issued in anger).

**Provenance caveat (§1).** The FAQ names cases 2.b/2.d (subsanación/anulación) explicitly; the
extension to a *rectificativa* rests on the identity-linkage argument above — sound, but an inference,
not a verbatim FAQ sentence about rectificativas. Confirm with the asesor if a cross-SIF rectificativa
is ever issued in anger.

---

## 14. Factura simplificada content — per-item VAT is not required; the ticket needs the date, per-rate base, QR and legend (added 2026-08-05)

**Why this was checked.** Designing the Counter POS ticket (sub-project 7, slice 1) raised a concrete
question: must a simplified ticket show a VAT rate **per line item**? The repo had settled the *series*
rules (§10) and the SIF's technical duties, but never the *content* of a factura simplificada — a
different regulation (RD 1619/2012 art. 7) than the SIF's Orden HAC/1177/2024 art. 7 the repo usually
cites. Answered on primary source (BOE), not memory.

**Bottom line: per-item VAT is NOT required.** The VAT obligation is at the invoice / rate-group level,
never per line. A ticket must show the **tipo(s) impositivo(s) aplicado(s)** and, **only when it mixes
rates**, the **base imponible split per rate**. The **cuota** is not required for an ordinary retail
sale. So a per-rate summary block is exactly right; a rate against every item is surplus.

**RD 1619/2012 art. 7.1 — mandatory content of a factura simplificada** (BOE-A-2012-14696, consolidated,
apartado 5 añadido por RD 1007/2023, en vigor desde 07/12/2023):

> «Sin perjuicio de los datos o requisitos que puedan resultar obligatorios a otros efectos […] las
> facturas simplificadas y sus copias contendrán los siguientes datos o requisitos:
> **a)** Número y, en su caso, serie. […] Cuando el empresario o profesional expida facturas conforme a
> este artículo y al artículo 6 […] en un mismo año natural, será obligatoria la expedición mediante
> series separadas de unas y otras.
> **b)** La fecha de su expedición.
> **c)** La fecha en que se hayan efectuado las operaciones que se documenten o […] el pago anticipado,
> siempre que se trate de una fecha distinta a la de expedición de la factura.
> **d)** Número de Identificación Fiscal, así como el nombre y apellidos, razón o denominación social
> completa del obligado a su expedición.
> **e)** La identificación del tipo de bienes entregados o de servicios prestados.
> **f)** Tipo impositivo aplicado y, opcionalmente, también la expresión «IVA incluido».
> Asimismo, cuando una misma factura comprenda operaciones sujetas a diferentes tipos impositivos […]
> deberá especificarse por separado, además, la parte de base imponible correspondiente a cada una de
> las operaciones.
> **g)** Contraprestación total.
> **h)** En caso de facturas rectificativas, la referencia expresa e inequívoca de la factura rectificada
> […]
> **i)** En los supuestos a que se refieren las letras j) a p) del artículo 6.1 […] deberá hacerse
> constar las menciones referidas en las mismas.»

Key reading of **f)**: the default obligation is the **tipo impositivo** only; «IVA incluido» is
expressly *optional*; and the multi-rate clause demands the **base imponible per rate — not the cuota,
and not per item**.

**When the cuota must appear separately — art. 7.2** (only for a business recipient who asks, to deduct
under art. 97.Uno LIVA; art. 7.3 extends it to a non-business recipient needing it for a tax right —
neither applies to a walk-up cash sale):

> «A efectos de lo dispuesto en el artículo 97.Uno de la Ley del Impuesto, cuando el destinatario de la
> operación sea un empresario o profesional y así lo exija, el expedidor de la factura simplificada
> deberá hacer constar, además, los siguientes datos: a) Número de Identificación Fiscal […] así como el
> domicilio del destinatario […]; b) La cuota tributaria que, en su caso, se repercuta, que deberá
> consignarse por separado.»

**Veri\*Factu additions — QR + legend. Orden HAC/1177/2024 art. 20** (BOE-A-2024-22138):

> «**Artículo 20. Representación gráfica a incluir en la factura.** 1. Una factura, tanto si está impresa
> en soporte papel como si se trata de la imagen de la misma en soporte digital, incluirá los siguientes
> elementos […]: a) Un código «QR», que deberá cumplir con las especificaciones del artículo 21. b) En
> caso de facturas expedidas por «Sistemas de emisión de facturas verificables» o «VERI\*FACTU», según
> los artículos 15 y 16 del Reglamento, la frase «Factura verificable en la sede electrónica de la AEAT»
> o «VERI\*FACTU», que deberá tener un tipo de letra y tamaño bien visibles […].»

**Orden art. 21 — QR spec + content:**

> «1. El código «QR» deberá tener un tamaño entre 30x30 y 40x40 milímetros y seguir las especificaciones
> de la norma ISO/IEC 18004. Para la generación del código «QR» se empleará el nivel M (medio) de
> corrección de errores. […] 2. El contenido del código «QR» será el siguiente: a) «URL» del servicio de
> cotejo o remisión […] b) Información de la factura que formará parte de la «URL»: 1.º NIF del obligado
> a expedir la factura. 2.º Número de serie y número de la factura expedida. 3.º Fecha de expedición de
> la factura. 4.º Importe total de la factura.»

For simplified invoices this is reached via **RD 1619/2012 art. 7.5** (added by RD 1007/2023), which
requires such tickets to include «lo contenido en el apartado 5 del artículo 6» — i.e. the QR (art.
6.5.a) and the legend (art. 6.5.b, «únicamente en aquellos casos en los que el sistema informático
realice la remisión de todos los registros de facturación a la AEAT» = Veri\*Factu mode).

- **QR:** required on **every** invoice (full or simplified, paper or digital image) from an RRSIF
  system — not conditional on Veri\*Factu mode.
- **Legend:** «Factura verificable en la sede electrónica de la AEAT» **o** «VERI\*FACTU» — alternatives;
  either satisfies. Required only in Veri\*Factu mode.

**Designation.** The document need **not** be captioned "factura simplificada" — the law distinguishes
ticket-vs-full-invoice by **separate numbering series** (art. 7.1.a), not a printed label.

**Consequences for the till ticket** (`2026-08-05-counter-pos-walkup-sale-design.md` §7):

- **Required, non-removable:** número+serie, **fecha de expedición**, issuer NIF+name, goods
  identification, tipo(s) + **base imponible per rate**, contraprestación total, QR, VERI\*FACTU legend.
- **Allowed extras (harmless):** the **cuota** per rate, issuer address/phone/email, thank-you message,
  logo, and the operational efectivo/cambio lines. A simplified ticket needs only the issuer NIF+name —
  **no domicilio** (unlike a full factura, art. 6.1.d).
- The first ticket mock **omitted the fecha de expedición** — a real gap (art. 7.1.b, unconditional and
  also encoded in the QR per art. 21.2.b.3º, but it must *also* be printed on the face) — corrected in
  the design.

**Provenance caveat (§1).** art. 7.1, 7.2 and Orden arts. 20–21 were read as clean verbatim text from
the BOE consolidated pages (high confidence). The RD 1007/2023 art. 6.5 / 15 / 16 wording came back
lightly compressed by the fetch layer; its substance is independently corroborated verbatim by Orden
art. 20 and by RD 1619/2012 art. 7.5→6.5, but pin RD 1007/2023 art. 6.5 character-exact with a confirming
fetch before quoting it in a code comment. A first paraphrasing pass on the art. 7 page dropped
qualifiers (the base-imponible multi-rate clause) and mis-stated 7.2 — **only the block-quoted Spanish
above is citable.**

---

## Sources

| Source | Type |
| --- | --- |
| BOE-A-2023-24840 — RD 1007/2023 (RRSIF), arts. 8, 12, 14, 15, 16 | primary |
| BOE-A-2024-22138 — Orden HAC/1177/2024, arts. 2, 7, 13, 16, 20, 21 | primary |
| AEAT sede FAQs — sistemas-verifactu, trazabilidad, capacidad-remisión, huella-hash | primary |
| AEAT `FAQs-Desarrolladores.pdf` v1.3 (4 Dec 2025) | primary |
| AEAT `Validaciones_Errores_Veri-Factu.pdf` v1.2.2 (changelog to 08/04/2026) | primary |
| AEAT `Veri-Factu_Descripcion_SWeb.pdf` v1.0.3 | primary |
| LGT art. 201 bis (introduced by Ley 11/2021) | primary |
| LGT art. 29.2.j) (Ley 58/2003) — quoted in the developer FAQ, §8 above | primary |
| BOE-A-2012-14696 — RD 1619/2012 (ROF), arts. 2, 6.5, 7 (7.1/7.2/7.5), 9, 11, 18 | primary |
| BOE-A-1992-28740 — LIVA (Ley 37/1992), arts. 78.Tres.2º (base imponible), 80.Uno.2º / 80.Cuatro (modificación) | primary — art. 78.Tres.2º via AEAT Manual práctico IVA 2025 (official); art. 80 via secondary summary, NOT read at source (§12) |
| DGT consulta general **2174-03** (11 dic 2003) — propinas de restaurante fuera de la base imponible del IVA | primary (DGT) — read via legal-database reproduction; PETETE unreachable by tool (TLS), §11 |
| DGT consultas vinculantes **V3095-17** (29 nov 2017), **V1808-22** (29 jul 2022) — propinas/donativos fuera de la base imponible; propina cobrada por la empresa = ingreso IS + rendimiento del trabajo | primary (DGT) — read via legal-database reproduction; PETETE unreachable by tool (TLS), §11 |

AEAT sede FAQ pages stamped *"Actualizadas a 5 de diciembre de 2025"*. Several AEAT PDFs
could not be read by normal fetching (FlateDecode/font encoding) and were extracted locally —
findings resting on those are text-verified rather than model-summarised. The DGT consultas in §11
were verified against faithful legal-database reproductions because `petete.tributos.hacienda.gob.es`
failed TLS chain validation on every fetch — the substance is corroborated across four sources and two
binding consultas, but a human should confirm the exact wording on PETETE.
