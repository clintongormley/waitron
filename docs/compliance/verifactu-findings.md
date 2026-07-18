# Verifactu — verified findings

Research date: **2026-07-18**. Sources are AEAT and BOE primary texts unless noted.
Companion document: [asesor-questions.md](asesor-questions.md) — the unresolved items.

Everything here was checked against primary sources and adversarially verified. Where a
claim did not survive verification, or was not checked at all, it says so. **Do not treat
the unverified items as settled.**

---

## 1. The hash chain is scoped per (SIF; NIF) — not per series

This is the single most important correction to the original design assumption.

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

First record from a fresh installation carries `PrimerRegistro="S"`. AEAT returns a
non-rejecting warning if that is claimed when records already exist for that SIF+NIF —
useful as a signal that a till has been accidentally re-provisioned.

### Required runtime check

Orden art. 7.i obliges the system, **before generating each new record**, to verify that the
stored predecessor huella matches the record before it. This belongs in the write path of
every sale, not in a periodic audit.

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

### 5.1 "The till never submits to AEAT" vs the volcado prohibition

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

## Sources

| Source | Type |
| --- | --- |
| BOE-A-2023-24840 — RD 1007/2023 (RRSIF), arts. 8, 12, 14, 15, 16 | primary |
| BOE-A-2024-22138 — Orden HAC/1177/2024, arts. 2, 7, 13, 16 | primary |
| AEAT sede FAQs — sistemas-verifactu, trazabilidad, capacidad-remisión, huella-hash | primary |
| AEAT `FAQs-Desarrolladores.pdf` v1.3 (4 Dec 2025) | primary |
| AEAT `Validaciones_Errores_Veri-Factu.pdf` v1.2.2 (changelog to 08/04/2026) | primary |
| AEAT `Veri-Factu_Descripcion_SWeb.pdf` v1.0.3 | primary |
| LGT art. 201 bis (introduced by Ley 11/2021) | primary |

AEAT sede FAQ pages stamped *"Actualizadas a 5 de diciembre de 2025"*. Several AEAT PDFs
could not be read by normal fetching (FlateDecode/font encoding) and were extracted locally —
findings resting on those are text-verified rather than model-summarised.
