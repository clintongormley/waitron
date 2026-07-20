# Sales Spine and Fiscal Layer — Design

**Date:** 2026-07-19
**Status:** Draft — brainstorming complete, pending user approval
**Covers:** sub-projects 2 and 3 of
[`2026-07-18-pos-architecture-design.md`](2026-07-18-pos-architecture-design.md) §2, minus the
catalogue.

**Regulatory facts live elsewhere.**
[`docs/compliance/verifactu-findings.md`](../../compliance/verifactu-findings.md) is
authoritative; [`asesor-questions.md`](../../compliance/asesor-questions.md) holds what is
unresolved. This document states architectural consequences only. Where it and the findings
disagree, the findings win.

---

## 1. Scope

### In

| Package | Delivers |
| --- | --- |
| `packages/verifactu` | Standalone library: record construction, huella, chain verification, XML serialisation, a SOAP/mTLS client covering both the submission and consulta operations, response parsing. Zero in-repo dependencies. Owns its AEAT conformance suite and its `PROVENANCE.md`. |
| `packages/db` | Drizzle schema (Postgres only — see the PGlite decision in §3). Generic tables plus composition of module-owned schemas. DB-level immutability triggers plus privilege revocation. |
| `packages/core` | Sale write path: order settlement → number allocation → pre-generation chain verification → chain append, in one transaction. |
| `packages/fiscal` | Generic `FiscalBackend` interface. English throughout. |
| `packages/fiscal-verifactu` | The Verifactu module: its own tables, the adapter, the outbox drainer, reconciliation. |
| `packages/shared` | Shared types. |

### Out

- **Catalogue** — its own spec, before the till UI. Decoupled because §6 snapshots values into
  records, so the sales spine needs a line *shape*, not a catalogue to read from.
- **`apps/*`** — no server, no till UI. The unsent count's data and API are defined here; the
  screen showing it is sub-project 7.
- **Payments** — `tenders` records what settled. The `PaymentProvider` interface is
  sub-project 4.
- **Real AEAT submission** — neither certificate nor preproduction access exists yet (§11).

### Two boundaries held deliberately

These are where this spec could quietly absorb a neighbouring sub-project.

**Sync transport is deferred.** The unsent count needs acks; acks need sync. This spec defines
the *contract* — what flows up, what acks flow down, idempotency keys, per-SIF ordering
guarantees — and implements the state machine behind a transport interface with an in-process
implementation for tests. The wire protocol is sub-project 9. Without this line the spec
becomes the sync tree.

**AEAT is faked, but faithfully.** The submission client is built complete — SOAP envelopes,
flow control, per-send caps, error 3000 duplicates, error 2004 future-dating, per-record
rejection semantics — and tested against a fake modelled on
`Validaciones_Errores_Veri-Factu.pdf`, plus the official conformance vectors.

> **Known limitation, stated plainly.** A fake built from our own reading of the spec validates
> our *interpretation*, not our *correctness*. Mutation testing and the official vectors are a
> partial answer; **differential testing against a mature independent implementation** (§10) is a
> further one, and it is available now rather than being gated on the certificate. Only
> preproduction closes it fully.

**Provenance discipline applies to this whole sub-project.** See
[`docs/compliance/implementation-provenance.md`](../../compliance/implementation-provenance.md).
`packages/verifactu` is implemented from AEAT's published specification. `mdiago/VeriFactu` is
AGPL-3.0 and **its source is not read** — a port would be a derivative work and would infect the
POS through linking. MIT-licensed references may be consulted.

---

## 2. Layering and vocabulary

Spanish vocabulary stops at the module boundary. It is correct inside the library and the
module, because those map 1:1 to AEAT's spec, XML and conformance vectors, and translating
there would only obscure. Everywhere else, English.

| Layer | Package | Vocabulary | Owns |
| --- | --- | --- | --- |
| Library | `packages/verifactu` | Spanish (mirrors AEAT) | No database at all. Pure functions over plain data. |
| Module | `packages/fiscal-verifactu` | Spanish | Its own tables: registros, cadenas, envío state, SIF registration. |
| Generic | `packages/fiscal`, `core`, `db` | English | `FiscalBackend`; tenants, locations, tills, series, orders, sales, tenders. |

**The chain concept never appears in the generic layer.** Chaining is a regime requirement, not
a POS one. A second backend (TicketBAI, Italy, Portugal) brings its own tables and its own
vocabulary, and touches nothing here.

**Only the interface crosses the boundary.** The unsent count is
`FiscalBackend.pendingCount(tillId)`, not the UI reading module tables. Art. 7.i verification
stays entirely inside the module.

**Mechanically enforced.** A guard rejects Spanish identifiers in the generic packages, in the
same spirit as `no-hardcoded-chrome` — automatically, not by review discipline. The existing
`packages/verifactu` zero-dependency lint boundary applies from this package's first commit; it
was written before the package existed and verified to fire against a probe.

### Migration composition

`packages/db` holds the generic schema; each fiscal module ships its own. Migrations must
compose **across packages** — the PGlite decision below removes the second dialect, but not this
problem. Getting it wrong is discovered late, when a module's migration meets a core table it
expected to already exist, so it is designed and tested from the first migration rather than
retrofitted.

---

## 3. Data model

### Identity and tenancy

`tenants` (the obligado tributario: NIF, razón social) → `locations` → `tills`.

Every table carries `tenant_id`. **Row-level `tenant_id` with Postgres RLS** as backstop, using
a forced session variable. Database-per-tenant stays cheap to add later precisely because the
self-hosted build already _is_ one-database-one-tenant.

> **Correction, 2026-07-20.** This section previously justified row-level tenancy as "the only
> option where the SQLite standalone path and the Postgres cloud path run identical schema and
> identical queries". That justification was **overstated** — see the PGlite decision below. The
> conclusion survives on a narrower and actually-true basis: row-level `tenant_id` is the only
> tenancy option that **collapses to a no-op in the single-tenant standalone deployment** rather
> than forking the deployment model. Schema-per-tenant and database-per-tenant both change what a
> standalone install _is_.

### The standalone database is PGlite, not SQLite

**Decided 2026-07-20**, replacing SQLite in architecture §4. Researched empirically, not assumed.

"Identical schema and identical queries" across SQLite and Postgres **is not achievable with
Drizzle**. It ships separate `pg-core` and `sqlite-core` builders with no shared supertype, and
the maintainers locked the request for a dialect-agnostic schema, declining to add one. A survey
of 13 well-known self-hostable applications found **zero** dual-dialect Drizzle projects; the one
production exemplar in our shape pays parallel schema files, parallel migration pipelines, a
dual sync/async transaction API, and `as unknown as` casts at every dialect boundary. Two
independent teams that attempted it abandoned it, both landing on Postgres + PGlite.

Three findings bear directly on **fiscal** correctness, and the third is decisive:

| Finding | Consequence |
| --- | --- |
| `better-sqlite3` transactions are **synchronous**; an async callback resumes after rollback and its writes execute in autocommit | Silent hash-chain corruption with no error at the call site |
| `drizzle-kit` **destroys SQLite triggers** on any table rebuild — verified end to end | Immutability silently lost on a routine migration |
| **SQLite has no privilege system** — any writer may `DROP TRIGGER` | The audit property this design requires cannot hold |

That last one is not a tax, it is the design failing. This section requires immutability to be a
**database** property precisely so it does not depend on application code behaving. On SQLite the
application's own connection can drop the trigger, so the guarantee reduces to "the application
does not misbehave" — which is the thing it was supposed to replace. On Postgres, revoking
`UPDATE`/`DELETE` from a non-owner application role delivers it for real.

**PGlite** (embedded WASM Postgres, bundling a real PostgreSQL engine) satisfies the requirement
architecture §4 chose SQLite for — single process, no compose file — while being genuine
Postgres. It also preserves the property that matters most for multi-year fiscal retention:
**backup is copying one data directory**, which a restaurant operator can execute correctly,
where taking consistent dumps of a Postgres cluster across major-version upgrades is where
well-meaning deployers end up with unrestorable backups.

**Open risk, to be measured before anything is built on it:** PGlite is single-connection and
fully serialises queries. §5 recommends a local server precisely so records reach durable storage
quickly, which makes that node's throughput the venue's ceiling. Plan 2 opens with a benchmark
against the local-server topology, before any schema work, so this is measured rather than
assumed and course-correction stays cheap.

RLS exists only in the multi-tenant cloud path. The standalone path is single-tenant, so there is
no cross-tenant isolation to back up — `withTenant` becomes a no-op there.

`tills` stays regime-neutral. `NúmeroInstalación` and `IdSistemaInformatico` live in a
module-owned SIF registration table keyed by till.

### Till registration and installation numbers

`NºInstalación` *"no puede repetirse nunca"*, including on reinstalling the same software on the
same reformatted machine.

**Upstream mints it.** A till registers once against its upstream node, which allocates a
strictly-increasing counter per (NIF, IdSIF) under a database constraint and returns it with
credentials. Never-reused is a uniqueness guarantee, and uniqueness guarantees belong with a
single writer.

Consequences:

- **Reimage is correct by construction.** A wiped till has no registration, so it must
  re-register, so it cannot reuse. This is the failure mode most likely to occur in a
  self-hosted deployment and the one a manual list would get wrong.
- **A new installation number is a new SIF identity, therefore a new chain.** Chains cannot be
  merged or migrated. The old chain ends; a new one begins.
- **`PrimerRegistro="S"` follows from local state** — the till's own chain being empty. AEAT
  returns a non-rejecting warning if it is claimed when records already exist for that SIF+NIF,
  which is a useful signal that a till was accidentally re-provisioned.
- **A till cannot be provisioned offline.** Accepted: provisioning is an admin action, not a
  mid-service event.

### Series and numbering

`invoice_series` — `(tenant_id, till_id, code, purpose, next_number)`. Allocation is local to
the till; no coordination, no network.

- The counter is **strictly increasing. Gaps are permitted; reuse is not.** A crash between
  allocation and commit burns a number harmlessly.
- **N series per till from day one.** Asesor Q5(b) — whether rectificativas require their own
  series — is unverified, and supporting it now is nearly free. A till may own several series
  but has exactly one chain.
- Numbering may never be reused **even for test invoices**. This constrains testing: fixtures
  and AEAT preproduction only, never a production NIF (§10).

### The three tables

The architecture doc says two — working order, then fiscal record. It is one short. The
Verifactu registro de alta has no concept of a line item: it carries an aggregated VAT breakdown
capped at 12 entries, totals, the chain link and the huella. Lines, tenders, tips and receipt
text appear nowhere in it. And a void or correction creates a *further* record against the same
sale, so the relationship is not 1:1 either.

**`working_orders` + `working_order_lines`** — mutable. `status ∈ open | settled | abandoned`.

**`sales` + `sale_lines` + `tenders`** — immutable.

- Lines are snapshotted values, never catalogue references. A stale catalogue is therefore not a
  correctness problem.
- `total` and `amount_charged` are distinct fields, with `tip_amount` separate and non-taxable
  (architecture §10).
- `locale` and the ordered `invoice_locales` as at issuance (§9).

**Module-owned fiscal tables** (`packages/fiscal-verifactu`, Spanish) — immutable registros
carrying invoice identity, `TipoFactura`, `Desglose`, totals, the four-part `Encadenamiento`
pointer, `PrimerRegistro`, the `SistemaInformatico` snapshot, `FechaHoraHusoGenRegistro`,
`TipoHuella`, `Huella`, and the reference to the record being annulled or rectified.

Real columns, not an opaque payload — so they are indexed and queryable in the module that owns
them.

### Immutability is a database property

Enforced by trigger in **both** dialects, not by ORM discipline. The property under audit must
not depend on application code remembering. In Postgres, also revoke `UPDATE`/`DELETE` from the
application role.

**This forces the outbox to be a sidecar.** Submission state mutates constantly, so it cannot
live on an immutable table. A 1:1 table keyed by record id holds state, attempts,
`next_attempt_at`, incidencia flag, CSV, error code and message, submitted and acked timestamps.

This is the same split that separated sales from fiscal records, applied once more: immutable
fact, mutable delivery state. It also preserves the property wanted from an
outbox-as-projection — **chain order has exactly one source of truth**, and the sidecar never
reorders anything, only records what happened to each row.

### Chain head

A mutable `cadenas` table keyed by (tenant, till) holding the head pointer and huella.
Row-locked during append, with a unique constraint on (tenant, till, sequence) as the backstop
against two concurrent writers claiming a position — a real risk with a PWA that can have
multiple tabs open.

The sequence is ours, not AEAT's: an ordering aid for the outbox, never a substitute for the
four-part predecessor pointer, and never derived from or validated against the invoice counter.

---

## 4. The sale write path

One transaction, when the last tender settles:

1. Lock the chain row for (tenant, till).
2. **Art. 7.i verification** — the pre-generation check the Orden requires, in the write path of
   every sale, not in a periodic audit. AEAT's FAQ defines it precisely: verify that record
   _n−1_'s `Encadenamiento/RegistroAnterior/Huella` matches record _n−2_'s own `Huella`, i.e.
   that the predecessor is itself correctly chained, before chaining _n_ onto it. We also
   recompute _n−1_'s huella from its stored inputs — a strictly stronger check that additionally
   detects tampering with _n−1_'s own content, and free, since hashing is a pure function.

   **Start-of-chain case:** where _n−1_ carries `PrimerRegistro="S"` there is no _n−2_, so the
   link check is vacuously true and only the recomputation applies. Where _n_ is itself the first
   record there is no predecessor at all and neither check runs. Both are normal states, not
   failures — the huella is still computed and stored in every case.
3. Allocate the invoice number from the series.
4. Insert `sales`, `sale_lines`, `tenders`.
5. The module builds the registro de alta via the library, computes the huella, inserts the
   registro, advances the chain head.
6. Insert the submission sidecar row as `pending`.
7. Commit.

The receipt then renders from the sale plus the huella-derived QR. A crash anywhere before
commit burns an invoice number — a permitted gap.

**The fiscal record is created when all tenders settle**, not per payment. Split tender means
several payments against one invoice. A card declined mid-tender leaves the order open and
retryable with nothing chained; the alternative chains records for sales that never happened,
correctable only by rectificativas.

### Nothing stops selling — the list is empty, deliberately

An earlier draft of this design had chain-verification failure halt the till, reasoning that
extending a known-corrupt chain is worse than stopping. **That was wrong.** AEAT's FAQ on
art. 7.i addresses this exact case:

> «será preciso generar el siguiente RF, ya que la facturación por este motivo **NUNCA debe
> interrumpirse**»

AEAT weighed the same trade-off and decided the other way, consistently with its position
everywhere else in the regime — incidents _"NO suponen en ningún caso que deba interrumpirse la
facturación de la empresa"_. Halting a till on a huella mismatch would not be a stricter reading
of the rules; it would be doing the thing the rules tell us not to do.

| Condition | Behaviour |
| --- | --- |
| Chain verification fails | Record the incident, **chain the next record anyway**, surface persistently to staff, alert upstream. |
| Clock confidence degraded | Warn only. |
| AEAT outage, submission failure, expired certificate, offline operation | No effect on selling whatsoever. |

Chaining is local and synchronous; submission is asynchronous and retryable. **No _fiscal_
condition blocks a sale**, and adding one is a design change requiring primary-source
justification rather than a judgement call.

The scope of that claim is deliberate. Ordinary operational failures still stop a sale, and
should: a declined card leaves the order open and retryable, and a database write that fails
rolls the transaction back. Those are the system working. What must never happen is a sale
blocked because of the _fiscal_ layer — a chain error, an AEAT outage, an expired certificate, a
stale clock.

> In non-Veri\*Factu mode a detected chain error must additionally be written to the registro de
> eventos (arts. 7.j, 9.1.d). We build Veri\*Factu mode only, where that log is not required — but
> the incident is still recorded internally and surfaced, because staff and support need it.

### Corrections

Once chained, records are never edited. "Void the last sale" creates a new record referencing
the old one. This must be in the UI from the start — staff will ask for it on day one and it
cannot be bolted on later. Roles gate it (sub-project 5).

Alta and anulación interleave in **one** chain in generation order.

---

## 5. `packages/verifactu` — the library

**Pure and stateless.** The caller passes the stored predecessor in and owns persistence and
ordering. Chosen because chain append must be in the same database transaction as the sale
write, and a library owning state cannot join the host's transaction without dragging Drizzle
and dialect concerns across the boundary. Pure also means the conformance vectors run against it
with zero fixtures, and it is publishable as-is.

**Convention: Spanish nouns, English verbs.** Types mirror AEAT exactly — `RegistroAlta`,
`RegistroAnulacion`, `Encadenamiento`, `DetalleDesglose`, `SistemaInformatico`, `IDFactura` —
because they map 1:1 to the XML and to the spec PDFs, and renaming makes conformance vectors
harder to read against the source. Verbs are English.

```text
buildAltaRecord(input)        → RegistroAlta
buildAnulacionRecord(input)   → RegistroAnulacion
computeHuella(record)         → string
verifyHuella(record, expected)→ boolean          // art. 7.i
validate(record)              → ValidationIssue[] // pre-flight
serializeEnvio(cabecera, records) → string
parseRespuestaSuministro(xml) → RespuestaSuministro
serializeConsulta(cabecera, filtro) → string
parseRespuestaConsulta(xml)   → RespuestaConsulta
createClient({ cert, key, endpoint, fetch })   // both operations
```

`fetch` is injected, so the client is runtime-agnostic and testable against the fake.

**Submission and consulta share one endpoint, portType and binding** —
`ConsultaFactuSistemaFacturacion` is a second operation alongside
`RegFactuSistemaFacturacion`, not a separate service. `soapAction` is `""` on every operation;
dispatch is by message body.

**The two response types must never share a parser or an enum.** This is not tidiness — the
enums genuinely differ:

| | Submission | Consulta |
| --- | --- | --- |
| Values | `Correcto` / `AceptadoConErrores` / `Incorrecto` | `Correcta` / `AceptadaConErrores` / `Anulada` |
| CSV | present (only when the envío is not rejected) | **absent — no CSV element exists** |
| `TiempoEsperaEnvio` | present, mandatory | absent |

Consulta has no `Incorrecta` because **rejected records are never stored** — AEAT: *"ese RF
rechazado no figuraría jamás en los sistemas de la AEAT (aunque constaría un rechazo)"*. It has
`Anulada`, which submission never returns. A shared type would model states that cannot occur on
one side and miss states that can on the other.

`TiempoEsperaEnvio` is typed `\d{0,4}` in the official schema — **up to 9999 seconds**. It must
therefore be held in a type wider than 8 bits. Deriving the storage type from the schema's own
range rather than from an assumed 60-second value is the point.

### Serialisation policy — the huella depends on it

The huella is SHA-256 over a literal string built from the record's field values. AEAT
recomputes from **the literal it received**, so `123.1` and `123.10` are both valid and hash
differently. The single most important rule follows:

> **Serialise once, hash that exact literal.** Never reformat a value between serialising it into
> the XML and feeding it to the hash. Any normalisation must happen before both, not between
> them.

Six points where the specification is genuinely ambiguous. Each is resolved here by policy —
choosing the option that is unambiguously valid under every reading, rather than by copying what
another implementation does:

| # | Ambiguity | Policy |
| --- | --- | --- |
| 1 | Trim semantics — Java strips `≤ U+0020`, JS `.trim()` also strips NBSP and U+FEFF | Strip `[\x00-\x20]` only, matching AEAT's own reference behaviour, **and** reject non-ASCII whitespace in `NumSerieFactura` at input validation so the divergence is unreachable |
| 2 | Zero-decimal amounts — XSD admits `123`, the huella doc says "one or two" decimals | Always emit exactly **2 decimal places** |
| 3 | Leading `+` on amounts — XSD permits it, huella doc is silent | **Never** emit `+`; emit `-` only for genuinely negative amounts |
| 4 | `Z` vs `+00:00` in the timestamp — `xs:dateTime` permits both, no AEAT example uses `Z` | Always `±hh:mm`, **never** `Z` |
| 5 | Fractional seconds — schema permits, no example uses them | **Whole seconds only** |
| 6 | QR encoding — AEAT's reference uses form-urlencoding (space → `+`), JS `encodeURIComponent` uses `%20` | Restrict the `NumSerieFactura` charset so both encodings coincide |

Items 1, 4, 5 and 6 are worth adding to
[`asesor-questions.md`](../../compliance/asesor-questions.md) if certainty is ever needed for
certification. Items 2 and 3 are fully neutralised by the policy above.

**Note the trap in the huella input**: field `Huella` is the **previous** record's hash, taken
from `Encadenamiento/RegistroAnterior/Huella` — not the record's own `Huella`, which is the
output. On the first record of a chain the field is present but empty (`Huella=`), and the huella
is still computed and stored.

**Repository:** stays in the monorepo through this sub-project, extracting at first public
release per architecture §8. The API is at its least stable precisely now, and a cross-repo
split would mean a publish or a git pin for CI on every change. The lint boundary already
enforces the discipline.

---

## 6. `FiscalBackend` — the generic interface

```text
registerSif(tillId, params)      → registration
recordSale(tx, sale)             → FiscalRecordRef
recordVoid(tx, saleId, reason)   → FiscalRecordRef
verifyChainBeforeWrite(tx, tillId)
pendingCount(tillId)             → number
drain(now)                       → DrainResult
reconcile(period)                → ReconcileResult
```

`recordSale` takes a **transaction handle**. This is a deliberate leak: atomicity between the
sale and the chain append is the entire point, and an interface hiding it would let a backend
break it silently.

`sales` additionally carries `fiscal_backend` and `fiscal_state`, written by the module in the
same transaction. Strictly redundant, but it keeps the foreign key pointing module→core rather
than core→module, and means a Z-report needs no cross-boundary join per row.

---

## 7. Outbox, submission and reconciliation

All figures in this section are verified against primary AEAT sources — the official XSDs and
WSDL, `Veri-Factu_Descripcion_SWeb.pdf` v1.0.3, `Validaciones_Errores_Veri-Factu.pdf` v1.2.2,
`FAQs-Desarrolladores.pdf` v1.3, and Orden HAC/1177/2024 Anexo 2.2.

### The drainer

**Batched per obligado tributario, up to 1,000 records per envío**, ordered by chain sequence
within each SIF.

The cap is machine-enforced: `RegistroFactura` carries `maxOccurs="1000"` in the official XSD,
with rejection codes 4113/4114 on breach. Art. 16.2 does not state the number itself — it
delegates to the record design in Anexo 2.2, which is why it is absent from the texts the
findings document cites.

**One envío may carry records from several SIFs, provided they share an obligado tributario.**
Verified: `Cabecera` carries exactly one `ObligadoEmision`; `SistemaInformatico` is a mandatory
*per-record* element; the validations document imposes no cross-record SIF consistency rule; and
AEAT's FAQ answers this boundary directly, mandating separate envíos only for multiple *empresas
usuarias*, not multiple SIFs.

**So the batching key is the tenant, not the till** — several tills ride one submission.

**Flow control is a race, not a fixed delay.** Art. 16.2 sets an initial wait of 60 seconds,
updated by AEAT in every non-fault response. But an envío is sent when `t` has elapsed **or**
1,000 records have accumulated, *"la circunstancia que ocurra primero"*. Under load the drainer
never waits; the 60 seconds only bites when there is almost nothing to send — by which point the
customer left with the receipt long ago.

**Driven entirely by the database** — `next_attempt_at` is persisted, never an in-memory timer.
This is what makes the hourly duty survive restarts and long offline periods, one of the gaps
findings §5.4 flags.

**The regulation sets a ceiling on the retry interval, not a floor.** Art. 16.4 requires retry
*at least* hourly, so exponential backoff capped at 3600s is compliant. Retrying faster is always
compliant; retrying slower never is. `TiempoEsperaEnvio` is a separate, coexisting constraint.

**Submission is never on the selling path.** The receipt is issued locally — record built,
chained, hashed, QR rendered, printed, customer gone — none of which touches AEAT. There is no
submission deadline at all: a week-old backlog submits cleanly.

**The drainer must coalesce.** Submitting one record per envío would cap throughput at one
receipt per flow-control interval, which is untenable for a till. Batching is a correctness
requirement of the design, not an optimisation.

### The CSV must be persisted on receipt, or it is lost forever

AEAT, unambiguously:

> El CSV debe ser almacenado por el SIF en el momento de alta, **no podrá ser recuperado a través
> de consultas posteriores**.

There is no CSV element anywhere in `RespuestaConsultaLR.xsd`. It exists only in the submission
response, and only when the envío was not rejected. **Neither consulta nor resubmission will ever
return it.**

Therefore the CSV is written in the same transaction that records the submission response.
Losing it is unrecoverable, which makes this one of the highest-consequence single lines in the
outbox.

> A trap worth naming: at least one published library reads a `csv` field off the consulta
> response through a shared parser. That field can never populate. It is a symptom of exactly the
> shared-type mistake §5 forbids.

### Idempotency and error 3000

If a connection drops after sending but before the response, whether AEAT received the envío is
unknown. Resubmitting returns **error 3000, duplicate**, because record identity is
`IDEmisorFactura` + `NumSerieFactura` + `FechaExpedicionFactura`. Uncertain in-flight state is
therefore always safe to retry.

**A naive reading of 3000 gets the record's true state exactly backwards**, and this is the
subtlest trap in the whole submission path. The outer response line reads `Incorrecto`. But the
rejection carries a `RegistroDuplicado` block describing the *already-stored* record, whose
`EstadoRegistroDuplicado` may well be `Correcta` or `AceptadaConErrores`. Treating the outer
status as authoritative would mark an accepted record as rejected and halt a healthy chain.

Two routes, and we use both:

| Route | Source | Gives |
| --- | --- | --- |
| A | The 3000 rejection's own `RegistroDuplicado` block | State of the stored record, free, no extra call |
| B | `ConsultaFactuSistemaFacturacion` | **Content**, including `Huella` and `Encadenamiento` |

Route A establishes state. Route B is then called to compare **the stored `Huella` against our
own** — a single-field comparison, not a 30-field diff, since an equal huella means byte-identical
chained content. Matching huella → accepted. Differing huella → halt that chain and alert,
exactly as for a rejection.

Assuming a match would silently swallow the one divergence most worth catching. Since 3000 only
arises after genuine in-flight uncertainty, the extra round-trip costs nothing in normal
operation.

> Of roughly twelve open-source implementations surveyed, **none** responds to a 3000 by querying;
> all rely on Route A alone. Expect little reference code for this path — it is more rigorous than
> the field standard, deliberately.

Note also: after an *anulación*, resending an alta under the same number still returns 3000.
Numbers are permanently burned, which is the same rule that forbids reusing them for test
invoices.

### Rejections halt that chain's queue

Submission is per-record, so a batch can be partly accepted. A genuine rejection leaves an
unresolvable gap in a chronologically-ordered stream, so that chain stops and surfaces rather
than submitting successors over the top.

This should be nearly unreachable: `validate()` runs pre-flight before a record is ever enqueued,
so rejections are caught locally where they are fixable.

### `Incidencia="S"`

Set on any record with a failed attempt, and on any record enqueued while an incident is open.

### Acks flow downstream

The submitting node acks each accepted record back down; the till counts records **not yet
confirmed submitted to AEAT**.

This is a third sync direction — architecture §5 describes sales flowing up and catalogue flowing
down, not acks flowing down. It is small (record id, submitted-at, CSV, state) and reuses the
downward machinery.

**Why true AEAT state rather than local sync backlog:** art. 16.4 requires a count of records
pending remission. A till syncing happily to an upstream node whose certificate expired would
otherwise show zero while nothing reached AEAT — precisely the case the duty exists for.

### Reconciliation

Consulta **is** the reconciliation mechanism. There is no bulk-export or cotejo service: the
*servicio de cotejo* is a per-invoice tool for the invoice *recipient*, and the sede web app
paginates ten at a time with no export. The web service is the more capable surface, so
reconciliation is fully automatable.

A periodic sweep per `PeriodoImputacion`, paging at 10,000 records via `ClavePaginacion`, diffed
against local state. It catches:

1. Records believed pending that AEAT already holds.
2. Records permanently flagged `AceptadaConErrores` that we believe are clean.
3. **Records believed accepted that AEAT has no trace of.**

The third is undetectable without this — the system would believe itself compliant. And because
rejected records are never stored, **absence is unambiguous**: AEAT genuinely does not hold it.

Reconciliation is also the concrete answer to art. 16.4's *"deberán ser debidamente justificadas
por el remitente si así se lo requiere la AEAT"*.

Four mechanics that must be got right, each of which produces a wrong answer if missed:

- **Reconcile on `EstadoRegistro`, not on presence.** `AceptadaConErrores` records *"quedarían
  para siempre con esos errores en la AEAT"*, and `Anulada` records still appear in results.
  Presence alone is not proof of a live, clean record.
- **`PeriodoImputacion` is mandatory and monthly, derived from fecha de operación** with fallback
  to fecha de expedición. Where the two fall in different months, querying the expedition month
  returns `SinDatos` for a record that exists. Query the operation month.
- **Results are ordered by fecha de presentación**, not invoice date — so a sweep running while
  submissions are in flight can page past newly-arriving records.
- **Leave `MostrarNombreRazonEmisor` and `MostrarSistemaInformatico` unset.** Both increase
  response time and neither is needed to diff.

**`RefExterna`** (70 chars) is both a filter and a stored field. We stamp our own record id into
it, which makes retrieval by our identifier possible without reconstructing AEAT's triple.

> **Gap, stated as a gap.** No rate limit is documented for consulta — `TiempoEsperaEnvio` is
> absent from its response schema entirely. That is *absence of documented limits*, not documented
> absence. Since we plan periodic sweeps, budget for discovering one empirically in preproduction.

---

## 8. Time

Art. 7.f requires one-minute accuracy. A till may be offline for days without NTP. Asesor Q8
(is drift tolerable, or must invoicing stop?) is unresolved and stays unresolved, so the design
picks a posture without the answer.

**Monotonic anchor, never block, bias slow.**

- On each contact with a trusted source (upstream node, or an AEAT response), store trusted time
  plus a monotonic reference.
- Derive `FechaHoraHusoGenRegistro` from anchor + monotonic elapsed, **not** from the wall clock.
- Surface a degraded-confidence warning past a threshold. Never stop selling.

**Why.** Crystal drift is seconds per day, so a week offline is plausibly still inside the
one-minute margin. The real risk is a wall-clock *jump* — a timezone fix, a manual correction, an
OS update — which monotonic anchoring removes entirely. Blocking sales over a clock is worse than
the defect and nothing requires it.

**Bias slow deliberately.** `FechaHoraHusoGenRegistro` is validated only as an *upper* bound: a
future-dated record trips error 2004 (non-rejecting), a late one trips nothing. When uncertain,
prefer behind over ahead.

**Implementation nuance to test explicitly:** a PWA reload resets the monotonic reference. The
anchor is persisted alongside the wall-clock reading taken at anchor time, so a reload can detect
a jump rather than silently trusting the new wall clock.

Store UTC plus offset. The huso is fiscally meaningful, not presentational.

---

## 9. Internationalisation

The project must be usable in different countries and translatable throughout. For this spec:

**Fiscal records are never translated.** They are rendered once, at issuance, and frozen. A
record whose text re-renders through a translation table would mean a signed, chained, submitted
record silently changing meaning — the exact tamper-evidence the regulation exists to prevent.

**Line descriptions never reach AEAT.** The registro de alta carries only the aggregated VAT
breakdown plus a single short `DescripcionOperacion`. Bilingual invoicing is therefore purely a
receipt-rendering concern and touches the fiscal record not at all.

- `locations.invoice_locales` — an ordered list of one or two entries. One means monolingual; two
  means both languages on the same invoice, rendered in that order. No separate mode flag. (A
  venue in Barcelona may reasonably want Spanish, Catalan, or both.)
- `sale_lines.descriptions` — a locale→string map snapshotted at line-add time, holding exactly
  the venue's configured locales.
- Reprints and rectificativas inherit the **original** locale list, snapshotted on `sales`. A
  receipt reprinted a year later reads identically to the one the customer took.
- `DescripcionOperacion` is a single configured value per venue.

**UI language and invoice language are different settings.** Staff UI locale is a user or device
preference; invoice locale is a venue fiscal setting. A tourist's receipt does not change because
a staff member reads the app in English.

**AEAT responses are stored verbatim** — Spanish text, code, CSV — because they are evidence of
what the authority actually said. Translation happens only at display, keyed by error code. The
stored copy is never translated.

**Every error crossing a package boundary is a structured code plus typed params, never prose.**
If the sale write path throws `"chain verification failed"`, that string reaches a screen
untranslatable. This is a real constraint on `packages/core` and the module, not a UI concern.

**Nothing formatted is ever stored.** Exact decimals, UTC plus offset. Currency, date and number
formatting are display concerns.

---

## 10. Testing strategy and quality gates

A hollow test in a design system means a button looks wrong. A hollow test here means an
unverifiable chain and a €50,000 exposure. The bar is correspondingly higher.

**Per-test red phase — Global Constraint.** Observe every new test failing *individually* before
writing its implementation. A test that passes before its feature exists is a defect in the test.
Sub-project 1 shipped four such tests; the root cause was verifying red per *file* rather than
per *test*, where "2 of 3 failed" hid the passing one.

**Mutation testing on `packages/verifactu` from the first commit**, gated in CI at **90%** —
above `packages/ui`'s 78.99%, because this is pure functions over plain data: the most
mutation-testable code in the project, with the least excuse for surviving mutants. Mutation
testing is what caught the unguarded event flags that four human-directed reviews missed.

**Official AEAT conformance vectors** (`borjamrd/verifactu-conformance`, MIT) wired into CI from
the first commit — the provenance document rates this the most valuable external asset available.

**Differential testing against `mdiago/VeriFactu` as a black-box oracle.** Generate huellas, QR
payloads and XML from the AGPL binary and compare against ours. Comparing *behaviour* is not
copying *expression*, needs no licence, and an implementation that has survived 59 releases
against a moving specification is a better conformance check than our own reading of the PDF.

This is the strongest available answer to the §1 limitation — that a fake built from our own
reading validates our interpretation rather than our correctness — and unlike preproduction it is
not gated on the certificate.

> **Running is not reading.** Whoever writes the TypeScript does not read the C#. Generating
> comparison vectors by executing the binary is expressly permitted; opening its source is not.

**`PROVENANCE.md` in `packages/verifactu`**, written as the package is built rather than
reconstructed later: which AEAT documents and versions it was implemented from, which
MIT-licensed references were consulted, and that `mdiago/VeriFactu` was used only as a black-box
oracle with its source unread. Contemporaneous evidence costs a paragraph and is far more
convincing than a reconstruction years afterwards.

**Property-based tests on the huella** (fast-check). Concatenation order and field formatting are
precisely where a bug survives every example-based test.

**Teeth checks** — deliberately break it, watch the test fail, restore:

- Corrupt a stored predecessor huella → art. 7.i must detect it, raise the incident, and the
  sale must **still complete**. A test asserting the sale is blocked would enforce the opposite
  of the requirement.
- Alter a desglose → the huella must change.
- `UPDATE`/`DELETE` a fiscal record → must fail, and **as the application role** — privilege
  revocation is the real control, the trigger is the backstop. A test running as the owner would
  pass while proving nothing, since an owner can disable any trigger.
- Decrement or reuse an invoice number → something must scream.
- **Drop the CSV write from the submission-response path** → a test must fail. The CSV is
  unrecoverable once lost (§7), so the test protecting it has to have teeth.

**Regression tests for the four verified traps.** Each of these is a real defect found in
published implementations or a documented AEAT behaviour that contradicts the obvious reading.
They are cheap to test and expensive to discover in production:

| Trap | Test |
| --- | --- |
| 3000 with `EstadoRegistroDuplicado: Correcta` | Must resolve to **accepted**, not rejected, despite the outer `Incorrecto`. |
| Consulta/submission enum divergence | A consulta response carrying `Anulada` must parse; the submission parser must not accept it. Types must not be shared. |
| `TiempoEsperaEnvio` = 9999 | Must round-trip. The schema permits `\d{0,4}`, so any 8-bit storage silently overflows. |
| Batch of 1,001 records | Must be split before sending, never rejected with 4113/4114. |

**Do not hardcode the timestamp margin.** Primary sources say only *"admitiéndose un margen de
error"*; the threshold is deliberately unpublished and breaching it is a warning that never
rejects. The 240-second figure circulating on vendor pages is unverified. Tests must not assert
it.

**Real Postgres from the first commit** — PGlite in tests, never a mocked database. Same
reasoning as the jsdom ban in `packages/ui`: a mock cannot fail the way the real thing fails.

**Two traps that make database tests vacuous, both verified:**

- **PGlite runs as superuser, and superusers bypass RLS — `FORCE ROW LEVEL SECURITY` does not
  override that.** A tenant-isolation suite that does not `set local role app_user` passes green
  while asserting nothing. Every RLS test must assume the application role.
- **PGlite cannot test lock contention at all.** Concurrent queries serialise onto one backend, so
  `FOR UPDATE` parses and runs but never blocks. A hand-rolled contention test appeared to pass
  while both statements had merged into a single transaction — a false pass. The chain-append
  concurrency properties need a real Postgres in a small separate suite.

**Never a production NIF.** Numbering may never be reused, even for test invoices, so integration
testing uses fixtures and AEAT preproduction only. Testing against a production NIF is
irreversible.

---

## 11. Assumptions carried, and what stays open

**Assumed true, per standing instruction — do not reopen:**

- **Q1** — a fast-syncing till is an independent SIF, so chains are per-till. The design isolates
  this: chains are keyed by (SIF, NIF), so if it ever changes, it is a change in *which node owns
  the chain*, not a re-model.
- **Q2** — a node other than the till may transmit the till's records. Mitigated by the submitter
  being an interface, not a location: moving submission onto tills becomes a provisioning change,
  not a redesign.

**Gated on external dependencies:**

- Neither the digital certificate nor AEAT preproduction access exists yet. Real end-to-end
  submission is a follow-up task gated on both, and the sociedad's incorporation gates the
  certificate.
- Preproduction endpoints, for when it is:
  `https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP`, and
  `https://prewww10.aeat.es/...` for a *sello de entidad* certificate. Submission and consulta
  are operations on the same URL.

**Verified during design** (was open, now closed — see §7): the 1,000-record per-envío cap;
multi-SIF batching within one obligado; flow control as a race rather than a fixed wait; consulta
returning full record content including `Huella`; and the CSV being unrecoverable after
submission.

**Residual gaps, carried deliberately:**

- **Whether AEAT enforces an undocumented rate limit on consulta.** None is documented, which is
  not the same as none existing. Since reconciliation sweeps periodically, expect to discover
  this empirically in preproduction.
- **The `PeriodoImputacion` derivation rule** (fecha de operación, falling back to expedición) is
  medium-confidence — read from `Descripcion_SWeb` §6.4 at one remove. It affects lookup
  correctness, so re-check it against the PDF before encoding.
- **`FAQs-Desarrolladores.pdf` pp. 41–52 were not read.** The table of contents shows Canarias
  desglose, criterio de caja, IGIC and simplificada substitution — none touching submission or
  consulta. Inferred from the TOC, not confirmed.

---

## 12. Deferred, with triggers

| Item | Trigger |
| --- | --- |
| Catalogue (structure/availability split, per-location scoping, version-counter sync) | Before the till UI |
| Sync wire protocol | Sub-project 9; the contract is defined here |
| Per-sale invoice-locale override | If on-demand receipt translation is ever wanted |
| Multi-currency and FX | If a deployment needs a second currency; single currency per tenant for now |
| RTL and text-expansion support in `packages/ui` | When a RTL locale is targeted; the design-system doc does not cover it today |
| Widen `no-hardcoded-chrome` to a workspace ESLint rule | When `apps/till` exists |
| Extract `packages/verifactu` to its own repository | First public release |
| Non-Veri\*Factu mode (XAdES, registro de eventos, requerimiento path) | When a user needs it; chain code stays mode-independent and mode is a per-SIF field |
