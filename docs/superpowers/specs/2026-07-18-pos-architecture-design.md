# Source-Available Restaurant POS — Architecture Design

**Date:** 2026-07-18
**Status:** Approved in brainstorming; supersedes `docs/plans/2026-02-28-architecture-design.md`

This document records the architectural decisions for a new project. It is not an
incremental revision of waitron — see [§11 Disposition of waitron](#11-disposition-of-waitron).

**Regulatory facts live elsewhere.** [`docs/compliance/verifactu-findings.md`](../../compliance/verifactu-findings.md)
is the authoritative record of what is settled, sourced from AEAT and BOE primary texts;
[`docs/compliance/asesor-questions.md`](../../compliance/asesor-questions.md) holds the
unresolved items. This document states only the *architectural consequences* and does not
restate the regulation — where the two disagree, the findings document wins.

---

## 1. What we are building

A source-available POS and restaurant management system, intended to replace Square, released
so it can benefit restaurants generally.

**First deployment:** a new deli in Barcelona, not yet open. Because it is greenfield, it is
a launch rather than a cutover — no parallel running, no staff relearning an existing flow,
and low initial volume. The fiscal and payment paths get exercised with real money and a
contained blast radius.

**Second deployment:** the existing restaurant (bar, kitchen, tables, currently on Square),
migrated once the deli has run clean.

**Deployment modes:** must run both as a standalone self-hosted system and as a multi-tenant
cloud service, from the same codebase.

### Framing that constrains everything

We are building a POS. **We are not building a payment processor.** Card data is handled by
a certified terminal (semi-integrated / P2PE) and never touches our software. Becoming an
acquirer is explicitly out of scope.

---

## 2. Scope and phasing

The venue needs counter service, weighed items, table service with open tabs, and a kitchen
display. That is a full-featured POS and too much for one cycle. Phasing:

| # | Sub-project | Phase |
| --- | --- | --- |
| 1 | **Design system** — token layer + primitives, themeable throughout | Deli — **first** |
| 2 | Sales spine — immutable hash-chained sales, tamper-evident log, per-tenant series, catalogue, tenant model | Deli |
| 3 | Fiscal layer — standalone Verifactu library + `FiscalBackend` adapter | Deli |
| 4 | Payment layer — `PaymentProvider` interface + Stripe Terminal adapter + offline store-and-forward | Deli |
| 5 | Identity — users, roles, permissions, invitations | Deli |
| 6 | Locations — venue/location model, till registration (SIF identity + never-reused nº de instalación) and series assignment | Deli (minimal) |
| 7 | Counter POS UI — offline-first till, weighed items, tender, ticket printing | Deli |
| 8 | Reporting — daily close (Z-report), VAT summary, sales analytics | Deli (core subset) |
| 9 | Deployment — standalone single process + multi-tenant cloud | Deli (thin) |
| 10 | Tabs, preAuth/incremental auth, split checks and tender | Restaurant |
| 11 | Table layout / floor plan | Restaurant |
| 12 | KDS, bar/kitchen routing | Restaurant |
| 13 | Tips — attribution + payroll export | Restaurant |
| 14 | Bookings | Restaurant |
| 15 | Online ordering / click-and-collect | Later |
| 16 | **Workforce** — time & attendance (*registro de jornada*), shift scheduling, payroll handling | Deli — **time-record at launch**; scheduling + payroll follow |
| 17 | Accounting export — sales/VAT (and later payroll) data to the asesor's package | Deli (core subset) |
| 18 | **Menu, recipes & allergens** — recipe/BOM model, dietary flags, allergen declaration | Deli — **allergens at launch** |
| 19 | Opening hours & channel sync — hours model + Google Business Profile / Maps (and other channels) | Deli (small) |
| 20 | Procurement & inventory — suppliers, purchase orders, goods-in, stock, 3-way reconciliation, reorder | Deli (core); AI forecast later |

Sub-projects 2 and 3 are joined at the hip — the chain *is* the sales table — and get specced
together, immediately after the design system.

**Workforce and accounting export (added 2026-07-22).** The deli employs staff from opening day,
so the *registro de jornada* (mandatory working-time record, ET art. 34.9) is a **launch-day legal
obligation**, not a Restaurant-phase nicety — sub-project 16's time-and-attendance piece ships with
the deli; shift scheduling and payroll follow. Salary handling is most likely an **integration /
export** to the asesor's package, not an in-house payroll engine (Seguridad Social cotización, IRPF
retenciones and nóminas are normally run by a graduado social); sub-project 17 (accounting export)
extends Reporting (#8). **Labour, payroll and social-security compliance is the domain of an *asesor
laboral / graduado social*, distinct from the fiscal-SIF asesor** — those questions do NOT belong in
`docs/compliance/asesor-questions.md`, which is Verifactu-scoped. Of the other requested features,
reservations map to #14 (Bookings), table management to #11 (floor plan) + #10 (tabs), online
ordering to #15, and table-side QR ordering is a customer-facing sibling of #15 (every QR order
still flows through the fiscal chain, #3).

**Menu, opening hours, procurement (added 2026-07-22).** Three further areas. **#18** extends the
catalogue with a recipe/BOM model (menu item → ingredients), dietary flags (vegetarian/vegan), and
**allergen declaration — a launch legal obligation**: EU Reg. 1169/2011 (Food Information to
Consumers) + Spain RD 126/2015 require the 14 major allergens for non-prepacked or served food,
which a deli sells. That introduces a **third advisor domain — food safety / APPCC-HACCP**, distinct from the
fiscal and laboral advisors. The **recipe/BOM is the linchpin**: it drives allergen derivation *and*
converts sales → ingredient consumption → purchasing quantities. **#19** is an opening-hours model
synced to Google Business Profile / Maps and other channels (an integration, like the accounting
export). **#20** is procurement + inventory (suppliers, purchase orders, goods-in, stock, 3-way
PO↔goods-in↔invoice reconciliation, par-level reorder); the **AI demand-forecast reorder is
deferred** until there is sales history to learn from — build the deterministic system first.
Received supplier invoices (IVA soportado) feed the accounting export (#17), not the Verifactu SIF
(issued invoices only).

### Sequencing notes

**The design system comes first, not last.** "Themeable throughout" is a foundation, not a
finish. Building screens and retrofitting a token layer afterwards means touching every view
again. Same reasoning applies here as in the Home Assistant panel playbook: token layer and
primitives up front, under test, then build views on top.

**Reporting is not deferrable in full.** A daily close is operationally mandatory — staff
cannot cash up without it — and VAT summaries fall out of the fiscal records anyway. Richer
analytics can wait; the Z-report cannot.

**Identity is required at launch** because roles gate refunds, voids, discounts and rectificative
records. Those are exactly the operations that need supervisor authority on day one.

**Timeline:** the deli opens roughly October 2026 – January 2027, and it trades as a
**sociedad**, so its Verifactu obligation begins **1 January 2027** — the earlier of the two
deadlines. This is aggressive for a solo build and is only feasible with tabs, table layout,
KDS, bookings and online ordering held firmly out of the deli launch.

---

## 3. Regulatory context (verified 2026-07-18)

### Deadlines

| Obligated party | Deadline |
| --- | --- |
| Contribuyentes del Impuesto sobre Sociedades | 1 January 2027 |
| All others (autónomos/IRPF, non-residents with EP) | 1 July 2027 |

Set by RD-ley 15/2025 (BOE 3 Dec 2025), amending RD 1007/2023. Earlier 2026 dates from
RD 254/2025 are superseded. 2026 is a voluntary testing period.

**The obligation on software producers hit 29 July 2025 and was not extended.** The 2027
dates are our users' deadline; the distribution-side obligation is already live.

### Scope

- Applies to facturas simplificadas (tickets) of **any amount**. No de minimis threshold.
  Do not confuse with the €3,000 ceiling in the Reglamento de Facturación, which governs
  when a simplified invoice may be issued at all.
- Barcelona/Catalonia is *territorio común* → Verifactu, not TicketBAI. TicketBAI covers the
  three Basque diputaciones plus Navarra. Territoriality applies per establishment.

### Penalties (LGT art. 201 bis)

| Conduct | Sanction |
| --- | --- |
| Fabricación / comercialización of non-compliant software | 150.000 €/ejercicio, plus 1.000 € per uncertified system sold |
| Mere **tenencia** of non-conforming software | 50.000 €/ejercicio |

There is **no delay-specific tipo** — late submission is not itself a sanctioned conduct. See
§3 of the findings document; enforcement of an art. 16.4 retry breach is unresolved.

### Veri*Factu mode is the cheaper build, in both directions

Real-time submission authenticates via client certificate over mTLS. In this mode:

- **XAdES is exempt** (RD 1007/2023 art. 16.3). Qualified-certificate key management on every
  offline till is materially harder than the Verifactu path.
- **The registro de eventos is not required** — it is obligatory only for *no verificable*
  systems. (We may keep an event log anyway as engineering practice, but it is not a
  regulatory deliverable here.)

**Non-Veri\*Factu is therefore the more expensive build, not the fallback.** If
[asesor Q3](../../compliance/asesor-questions.md) resolves unfavourably for poorly-connected
users, pushing them out of Veri\*Factu mode costs real work — worth effort to avoid.

#### Decision: non-Veri\*Factu mode is deferred until a user needs it

We build Veri\*Factu mode only. No XAdES signing, no registro de eventos, no
requerimiento-response path. This is a substantial saving — the event log is a build in its own
right, and qualified-certificate key management on every offline till is worse — and nothing in
our own deployments needs it.

What must remain true so this stays a deferral rather than a dead end:

- **Record construction and chaining are mode-independent.** Both modes require the same huella
  and the same chain; they differ only in signing, transmission and the event log. Keep those
  concerns behind separate seams so a later `no verificable` adapter reuses the chain code
  rather than forking it.
- **Mode is a per-SIF property in the data model from the start**, even though only one value
  is ever set. Retrofitting a mode column onto till registration is trivial; retrofitting the
  *concept* into code that assumes continuous transmission is not.

Consequently **asesor Q3 and Q4 stop gating anything we are building** — they matter only for
future users with no usable connectivity. Still worth asking if the asesor is in the room; no
longer worth waiting on.

Mode is chosen **per SIF**, so per till, but may not be mixed *within* one SIF. Election into
Veri\*Factu carries a **lock-in to the end of the natural year**; whether that binds per
taxpayer or per SIF is open (asesor Q4).

**This is also why the project can stay in TypeScript** — exemption from XAdES removes the
hardest cryptographic component from the build.

### Declaración responsable and published source

AEAT guidance (FAQ updated 26 March 2026) explicitly addresses this: whoever programs the
code or integrates components, *"ya sea o no de código abierto"*, must make the declaration.
Being publicly readable changes nothing about liability. There is no homologación or prior
registration.

**There is nothing to register.** AEAT operates no homologación, no approval process and no
registry of SIFs. The declaración responsable is self-published: you assert compliance, keep
it available, and bear the consequences if it is wrong. The question is therefore about
liability, not administration.

#### Why the project must not declare on behalf of downstream deployments

It is tempting to have the project issue one declaration covering everyone, since it would
make onboarding trivial. It should not, for four reasons:

1. **A declaration covers a system, not source code.** SIF obligations include conservation,
   inalterability and accessibility of records — properties of a *deployment*. Code running
   on a box where the operator can edit the database directly is a non-compliant SIF built
   from compliant code. We could not observe or control that.
2. **The `SistemaInformatico` block names a producer NIF.** A project-wide declaration would
   put our company, by name, into the fiscal records of every installation we have never seen.
3. **The exposure is grossly asymmetric.** Penalties for producing or marketing non-compliant
   software reach €50,000, carried for an unbounded number of third-party installations, in
   exchange for onboarding convenience.
4. **Forks break it silently.** Declarations are version-scoped and must be visible in-product
   per version. Someone who patches one line and rebuilds is outside our declaration, with
   nothing in their install telling them so.

#### Position

- **Declare for our own installation.** Mandatory regardless, and unaffected by the
  published-source question: our company, our NIF, our deployment.
- **Distribute a compliance kit, not a declaration** — a template declaración responsable with
  the blanks marked, a component and version manifest, AEAT conformance test results, and
  documentation of exactly what a deployer must supply. This removes most onboarding pain
  (the hard part is not knowing what the form needs) without assuming others' liability.
- **Follow `josemmo/Verifactu-PHP`'s framing** — *a library is a tool for building SIFs, not a
  SIF*. The deploying business signs for its own installation, as de facto self-developer,
  consistent with AEAT's own guidance that software developed by a company for itself is
  certified by that company.
- **Keep a certified distribution as a later commercial option.** Once reproducible signed
  artifacts and legal advice exist, an entity we control can offer a declared, supported build
  for customers who would rather buy assurance than sign for it. A conventional open-core
  split that converts this liability into a revenue model.

#### The defensible middle, if we ever want it

A declaration can coherently be scoped to **specific immutable release artifacts** — "this
covers the container image at digest `sha256:…` as published by us". Anyone running that exact
digest runs exactly what was declared, and a rebuild is unambiguously outside it. This is the
strongest form of a project-wide declaration, but it is untested against AEAT doctrine and
still does not reach the deployment-integrity problem in (1) above.

This matches where the OCA/Odoo community landed after debating the same question. It is
community consensus, not published doctrine — a consulta vinculante is the only route to
certainty, and is worth its cost against a €50,000 exposure.

> Nothing in this section is legal advice. It needs an asesor, and probably a lawyer rather
> than a gestor.

---

## 4. Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript throughout | One language; Veri\*Factu mode removes the XAdES barrier |
| Till + dashboard | Vite + Lit, PWA | Small runtime, standards-based, strong offline/PWA fit, existing fluency |
| Server | Hono | Thin server; fast builds; good TS inference; portable |
| ORM | Drizzle | `pg-core` only — one dialect in both deployment modes |
| DB (cloud) | Postgres | ACID, constraints, exact numerics, RLS as tenant backstop |
| DB (standalone) | PGlite (embedded WASM Postgres) | Single process, no compose file — and genuine Postgres, so schema, queries and immutability guarantees are the ones the cloud runs |
| Tests | Vitest + PGlite, plus Testcontainers Postgres for lock contention | No container needed for the bulk of the suite; PGlite provably cannot test `FOR UPDATE` contention, so chain-append concurrency needs a real server |
| Payments | Stripe Terminal (first adapter) | JS SDK works with internet-connected readers; fits the PWA |

### Explicitly rejected

- **Next.js** — its value is server rendering and RSC, precisely what an offline-first till
  cannot use. Building a local-first app in it means fighting the framework throughout.
- **NestJS** — its DI and decorator machinery was the source of the build slowness in
  waitron (`fix: resolve API webpack build hanging indefinitely`). The server here is thin.
- **PHP or Python for the fiscal layer** — PHP's ecosystem is more mature, but a PHP sidecar
  means a permanent second runtime in every deployment, which damages the self-hosted story.
  Python's Verifactu ecosystem is no better than TypeScript's.
- **CRDT sync engines (ElectricSQL, PowerSync)** — they solve conflict resolution we must
  not have. See §5.

### Fiscal library approach

No TS/JS library is a defensible black-box foundation. `inoguerols/verifactu` (MIT) is the
only one covering the full surface and validates against the official AEAT test vector, but
it is weeks old, single-author, and its first external contribution was a fix for a broken
SOAP namespace parser. `doscientos-es/verifactu` digests raw UTF-8 while declaring a C14N
algorithm URI — the classic way XAdES fails third-party verification.

**Approach:** own the fiscal layer. Use `inoguerols/verifactu` as reference, wire
`borjamrd/verifactu-conformance` (official AEAT test vectors as JSON fixtures) into CI from
the first commit, and validate end-to-end against AEAT preproduction early. Budget real
engineering time for the submission client.

> **Corrected 2026-07-21 (Task 18 endgame, matching
> [`2026-07-19-sales-spine-and-fiscal-layer-design.md`](2026-07-19-sales-spine-and-fiscal-layer-design.md)
> §10's identical correction).** This paragraph said `borjamrd/verifactu-conformance` would be
> wired "into CI from the first commit". It was not: `PROVENANCE.md` names it under "References
> consulted", but no dependency on it exists (`package.json`) and no test file loads vectors from
> it. What IS wired into CI, from the first commit, is `packages/verifactu/src/conformance.test.ts`:
> three normative AEAT worked examples, hand-transcribed from the published technical
> documentation (`packages/verifactu/test/vectors.ts`), each checked against both the canonical
> cadena string and the resulting huella. Wiring up `borjamrd/verifactu-conformance` itself
> remains a tracked follow-up, not something already shipped. The original text is not deleted —
> the approach (own the fiscal layer, validate early) was sound; only the "wired from the first
> commit" claim about this one dependency was wrong.

### Single dialect — how the dual-database risk was removed

> **Superseded 2026-07-20.** This subsection previously read: *"The fiscal test suite runs against
> both SQLite and Postgres in CI from the first commit."* There is no SQLite path any more, so
> there is no dual suite to run. The decision, the empirical research behind it and the three
> fiscal findings that forced it are recorded in
> [`2026-07-19-sales-spine-and-fiscal-layer-design.md`](2026-07-19-sales-spine-and-fiscal-layer-design.md)
> §3, "The standalone database is PGlite, not SQLite". The original text is not deleted, because
> the reasoning that chose SQLite was sound on the information available at the time and knowing
> *which* assumption broke is worth more than a document that reads as though it were always right.

The risk this subsection existed to manage — dialect divergence discovered late, in the code that
chains sales records — was **removed rather than mitigated**. There is one dialect: `pg-core` is
the only Drizzle builder in the repo, PGlite runs a real PostgreSQL engine in the standalone
deployment, and the same schema and the same queries run in both modes because they are the same
database.

The assumption that broke was that "identical schema and identical queries" across SQLite and
Postgres was achievable with Drizzle. It is not — Drizzle ships separate `pg-core` and
`sqlite-core` builders with no shared supertype, and the maintainers declined to add one. Three
further findings bear on *fiscal* correctness specifically, and the third is decisive: SQLite has
no privilege system, so any writer may `DROP TRIGGER`. That reduces immutability to "the
application does not misbehave", which is the thing a database-enforced guarantee was supposed to
replace.

What survives from the original reasoning, unchanged:

- **RLS exists only in the cloud path.** The standalone deployment is single-tenant, so there is no
  cross-tenant isolation to back up and `withTenant` collapses to a no-op there.
- **The fiscal suite still runs against more than one target**, but the split is PGlite versus a
  real Postgres server rather than two dialects. PGlite serialises every query onto one backend, so
  `SELECT … FOR UPDATE` parses and runs but never blocks — a contention test on PGlite is a **false
  pass**, not a weak one, and chain-append concurrency is therefore tested against Postgres via
  Testcontainers.

---

## 5. Architecture: a sync tree

Every node has a local store, an outbox, and optionally an upstream. A till is a leaf. A
server is an interior node. The cloud, when present, is the root. A local server syncing to
the cloud uses **the same protocol** a till uses to sync to it.

| Deployment | Topology |
| --- | --- |
| Cloud SaaS, no local hardware | till → cloud |
| Venue with local server + remote analytics | till → local server → cloud |
| Fully self-hosted, no cloud | till → local server |
| Single-till micro venue | till → local server on the same box |

One sync implementation, tested once.

### Directional asymmetry

**Sales flow up and never conflict.** Each till owns its own invoice series and is the
single writer for that chain. Merging is concatenation — no conflict resolution, no CRDTs.

**Catalogue structure flows down.** Single editing point, propagates outward. Conflicts
resolved by "upstream wins" — and in practice never arise, because structure has exactly one
writer (see §7).

Getting this asymmetry right is what keeps the sync layer comprehensible. The hard general
case — bidirectional edits to the same records — never arises.

### Remote analytics

The local server already syncs upward over an **outbound** connection, so a remote owner
reads the cloud. No inbound exposure, no port forwarding, no static IP, no firewall
configuration. For the fully self-hosted case with no cloud, point users at Tailscale or a
Cloudflare tunnel — an opt-in for those who explicitly chose no cloud.

### Local store durability

The known weakness of the PWA choice. Browsers can evict IndexedDB under storage pressure;
iOS is historically more aggressive; "clear browsing data" is one tap. For unsubmitted
fiscal records this is loss of legally required data.

Mitigations, in order of effect:

1. **A local server whenever there is more than one till** — sales reach durable storage over
   the LAN within seconds, making browser storage a brief buffer rather than a system of
   record. This makes the local server the *recommended* deployment shape, not the exotic one.
2. Install as a PWA and call `navigator.storage.persist()`.
3. Dedicated till devices in kiosk mode, not staff personal phones.

Keep in proportion: Square holds offline transactions on-device too. Every POS has this
exposure.

---

## 6. Fiscal design

### Working orders and fiscal records are different things

An open order is mutable — add a line, void it, change quantities, abandon it. A fiscal
record is immutable, hash-chained, and comes into existence exactly once, at tender
completion. **Two tables, one transition between them.** Conflating them means chaining
drafts and rectifying records that were never real sales.

### One chain per till

> **Corrected 2026-07-21 (Task 18).** This heading previously read "One chain per till — and one
> series per till", contradicting its own body two paragraphs below ("a till may own several
> series (rectificativas) but has exactly one chain") and
> [findings §1](../../compliance/verifactu-findings.md). Series is a numbering concern, not a
> chain boundary; the heading is corrected to state only the claim the section actually supports.

This is what makes offline and Verifactu compatible. A shared chain would require asking the
server for the next position before completing any sale, which breaks the moment the network
does. Each till maintains an independent chain locally, at full speed, offline indefinitely.

**The chain is keyed by (SIF; NIF), not by series** — verified against Orden HAC/1177/2024
art. 7.c) and AEAT's trazabilidad FAQ, which addresses the multi-till case explicitly. Per-till
chains are lawful **because each till is its own SIF**, not because it has its own series.
Series is a numbering concern; the chain is a device concern. A till may own several series
(rectificativas) but has exactly one chain, and alta and anulación records interleave in it in
generation order.

See [verifactu-findings.md §1](../../compliance/verifactu-findings.md) for the data-model
consequences — chain ordering is unrelated to invoice numbering, chains cannot be merged or
migrated, multi-tenant partitioning must include the NIF, and each till needs a never-reused
número de instalación.

> **Open question — the SIF boundary.** Per-till chains hold only where each till genuinely
> qualifies as an independent SIF. AEAT contrasts real-time centrally-controlled modules (one
> SIF, one chain) against decentralised modules uploading monthly (separate SIFs); we sit
> between them, and AEAT's wording is hedged. If it resolves against us, the offline design
> changes shape substantially. See [asesor-questions.md Q1](../../compliance/asesor-questions.md).

#### Fallback if Q1 resolves against us: the local server is the SIF

This is shape-changing, not project-ending, and the fallback is worth recording now because it
influences deployment guidance today.

If tills cannot be independent SIFs, the **local server becomes the SIF** — one chain per
venue, tills as UI clients requesting chain positions over the LAN. Consequences:

- Selling survives an **internet** outage, which is the common case, since the SIF is on-site.
- Selling does **not** survive a **LAN** outage or a till losing contact with the server.
- Cloud-direct deployments with no local server lose offline operation entirely, and would
  need a local node introduced.

This is a further argument for the local server being the recommended deployment shape (§5)
rather than the exotic one: it is already the answer to local-store durability, and it is also
the hedge against Q1. A venue that has one needs no architectural change if Q1 goes badly —
only a change in which node owns the chain.

### Values are snapshotted, never referenced

A sale records price, VAT rate and description **as at the moment of sale**, embedded in the
record. A fiscal record pointing at a mutable catalogue row would mean a later price change
silently altering the meaning of a signed, chained, submitted record — exactly the
tamper-evidence the regulation exists to prevent.

Pleasant side effect: **a till running a stale catalogue is not a correctness problem.** The
catalogue needs to be *fresh*, not *synchronised* — a much weaker requirement to meet offline.

### Corrections are rectificative records

Once chained and submitted, records are never edited. "Void the last sale" creates a new
record referencing the old one. This must be in the UI from the start — staff will ask for it
on day one and it cannot be bolted on later.

### Tender ordering and failure modes

**The fiscal record is created when all tenders settle**, not when payment begins and not per
payment. Split tender means several payments against one invoice, so the record cannot be
per-payment. A card declined mid-tender leaves the order open and retryable, with nothing
chained — the alternative would chain records for sales that never happened, correctable only
by rectificative records.

**Chaining is local and synchronous; submission is asynchronous and retryable.** The chain
does not depend on submission succeeding. An AEAT outage, an expired certificate, or a
network failure must never block selling — records chain locally and the outbox drains later.
This separation is what keeps a regulatory dependency off the critical path of taking money.

### Submission and certificate placement

**The till never submits to AEAT.** That would put the fiscal certificate on a tablet sitting
on a counter. Records chain locally, flow up, and **the nearest node holding the certificate
submits** — the cloud for cloud tenants, the local server otherwise. A local server keeps
submitting even while a till is offline.

This is a security win and an availability win at once.

Submission respects AEAT's `TiempoEsperaEnvio` throttling and delivers **in chain order per
till** — chronological generation order within each SIF, which is not the same as invoice
number order.

**There is no submission deadline.** Verified: RD 1007/2023 art. 8.1 states the duty
qualitatively ("instantánea"), no numeric window exists anywhere in the regime, and nothing in
AEAT's validation layer rejects a late record. A week-old backlog submits cleanly.

But "no deadline" is not "no duties". Orden art. 16.4 requires, throughout any incident:
retry **at least hourly**, chronological ordering on recovery, `Incidencia="S"` on affected
messages, and **a persistent on-screen count of unsent records** — a UI requirement not yet
reflected elsewhere in this design. See
[verifactu-findings.md §2](../../compliance/verifactu-findings.md).

> **Open question — delegated submission.** This design has a node other than the till submit
> the till's records. AEAT rejects end-of-day "volcado" of a disconnected system's records into
> a connected one; whether that prohibition reaches a prompt relay on behalf of the till-SIF is
> unresolved. If the SIF must transmit for itself, certificates land on every till and this
> section's security argument collapses. See
> [asesor-questions.md Q2](../../compliance/asesor-questions.md).

#### Q1 and Q2 pull in opposite directions

Worth stating explicitly, because it shapes how the asesor conversation should go. Justifying
per-till chains (Q1) requires arguing each till is a **decentralised, autonomously-operating
system not controlled in real time** by anything central. Justifying delegated submission (Q2)
requires arguing the till and its upstream are **one integrated system**. We are relying on the
favourable answer to both at once, and granting Q1 on independence grounds makes Q2 harder —
independent systems whose records are transmitted by a connected one is the exact shape of the
rejected FAQ.

The distinguishing feature we can defend is **latency and intent**: art. 8.1 requires
transmission *"continuada […] instantánea"*, our relay operates in seconds, and the rejected
case defers by design to end-of-day. That argument is strong for a normally-connected till and
weak for a deliberately-offline one (Q3) — plan on those users needing non-Veri\*Factu mode.

#### Mitigation: the submitter is an interface, not a location

**The AEAT submission client must not assume it runs on the server.** It sits behind an
interface and can be hosted on either a till or an upstream node, with certificate material
resolved from wherever it is deployed. If Q2 resolves against us, moving submission onto tills
becomes a provisioning and configuration change — certificate distribution, key storage,
per-till outbound access — rather than a redesign of the sync layer.

This costs almost nothing to build in now and converts a blocking architectural question into
a deployment decision.

A second unresolved item touches the same code path:

> **Open question — deliberate offline operation.** Users with no usable connectivity would
> sync once daily. Outages are tolerated indefinitely with hourly retries, but offline-by-design
> is not an outage, and AEAT's prohibition on deferred remission may push these users into
> non-Verifactu mode — a substantially more expensive build (qualified certificates on every
> till, plus an event log). See [asesor-questions.md Q3](../../compliance/asesor-questions.md).

---

## 7. Catalogue design

Split in two, because the halves want opposite treatments:

**Structure** — items, prices, VAT rates, modifiers, categories, translations. Changes
rarely, edited by a manager at a desk, single authoritative source, flows down, read-only at
the till.

**Availability** — "out of the sea bass", "no more croissants". Changes constantly, edited by
staff mid-service, **must work with the internet down**. Locally owned; flows *up* as status
rather than down as config.

Most POS systems conflate these and end up making price edits dangerously local or
availability uselessly remote.

**Offline editing rule:** with the internet down, staff may edit availability only. Prices,
VAT rates, new items and translations require reaching the root. Catalogue structure
therefore has exactly one writer, so downward sync needs no merge logic anywhere. This
matches how venues behave — nobody reprices a menu during a service outage.

### Sync mechanics

Monotonic version counter per scope. Each till stores its version; on reconnect it requests
the delta since that version and applies it atomically. Push over SSE when connected for
immediacy, pull on reconnect for reconciliation. Idempotent and resumable — a till off for a
week catches up in one request.

- **Scope catalogues per location.** Deli and restaurant have completely different menus under
  one tenant. Hierarchy: tenant → location → till.
- **Never apply a catalogue update into an open order.** Snapshot at line-add time; let the
  update land for the next sale.
- Per-locale content lives in the catalogue, edited centrally, synced down with structure.

---

## 8. Repository shape

```text
apps/till           Lit PWA — offline-first, owns local state
apps/dashboard      Lit — management, catalogue, reporting
apps/server         Hono — sync intake, AEAT submission, reporting, auth
packages/ui         Design system: token layer + primitives
packages/core       Domain: sales, catalogue, chain construction
packages/verifactu  STANDALONE — publishable Verifactu library, zero project deps
packages/fiscal     FiscalBackend interface + adapter wrapping packages/verifactu
packages/payments   PaymentProvider interface + stripe-terminal adapter
packages/db         Drizzle schema, pg-core only — one dialect in both deployment modes
packages/shared     Types shared across all of it
```

### `packages/verifactu` is a standalone library

Published to npm for anyone needing Verifactu in TypeScript — an ecosystem that currently has
no mature option (§4). Non-negotiable constraints:

- **Zero dependencies on any other package in this repo.** Enforced by lint rule, not
  discipline. If it imports `packages/core`, it is no longer a library.
- **Knows nothing about our domain** — no sales tables, no tills, no tenants. Its surface is
  build record → chain → submit → query, over plain data structures.
- **Owns its own conformance suite** against the official AEAT vectors
  (`borjamrd/verifactu-conformance`), runnable independently.
- Carries the `josemmo`-style disclaimer: a tool for building SIFs, not a SIF (§3).

It lives in this monorepo initially for iteration speed, and extracts to its own repository at
first public release. The lint boundary is what makes that extraction a move rather than a
refactor.

### Theming

The frontend is themeable throughout, using the token + primitive convention:

- A `--<prefix>-*` **token layer** — colour tokens, structural tokens (spacing, radius,
  typography) — applied at the app host, overridable per deployment.
- Thin **primitives** wrapping the underlying elements: one button, field, toggle, card,
  dialog, used everywhere.
- **No hardcoded chrome** — no hex values, spacing, radii or font sizes in view code.

This matters more here than in a typical app: a POS with published source will be deployed by
restaurants that want their own branding, and white-labelling is a plausible commercial
offering later. Retrofitting a token layer across a built-out POS is the expensive path, which
is why it is sub-project 1.

### Pluggable interfaces

Both are load-bearing and built early, never a hardcoded Spanish path:

- **`FiscalBackend`** — record sale → chain → submit → void/rectify. Verifactu adapter first;
  TicketBAI, Italy, Portugal slot in later without touching core sales logic.
- **`PaymentProvider`** — `authorize`, `capture`, `void`, `refund`, `partialRefund`,
  `preAuth`, `incrementalAuth`, `tipAdjust`, split tender, offline store-and-forward,
  reconciliation hooks. Stripe Terminal first; Adyen when restaurant volume justifies
  interchange++; SumUp as a third.

**Multi-tenancy is in from the start**, because Verifactu numbering and chaining are
per-issuer: each tenant has its own NIF, series, certificate and independent chain. Building
single-tenant would bake in one global chain and force exactly the retrofit this design
avoids.

---

## 9. Non-code critical path

**Start these now, in parallel with the build.** They are bureaucratic latency that cannot be
compressed by writing code faster.

- Obtain the digital certificate for AEAT submission.
- Get AEAT preproduction sandbox access working end to end. **Note that production numbering
  can never be reused, even for test invoices** — testing against a production NIF is
  irreversible, so preproduction access is a prerequisite for integration work, not a nicety.
- **Book the asesor conversation.** Questions, with Spanish formulations, are in
  [`asesor-questions.md`](../../compliance/asesor-questions.md). Lead with Q1 and Q2; if they
  cannot engage with those, they are the wrong adviser. Ask up front whether they have
  advised on or certified a SIF.
- **File a consulta vinculante with the DGT for Q1 and Q2.** Free, binding, and 3–6 months —
  which means filing early and building on the provisional answer is the only workable
  sequence. Also worth trying AEAT's Verifactu developer channel: faster, non-binding, and
  more likely to engage with encadenamiento scoping directly.
- Confirm the tip withholding model with the asesor (direct-to-employee vs pooled *bote*).
- Resolve the declaración responsable position for distribution (§3).

---

## 10. Tipping (restaurant phase, but model it early)

Two requirements land in the data model and should not be retrofitted:

1. **The tip is a separate, non-taxable line**, never folded into the taxable base. The
   Verifactu record shows the sale at its true base + IVA; the tip rides on the
   payment/settlement side only. Keep **invoice total** and **amount charged to card** as
   distinct fields.
2. **Track card tips per employee or pool per pay period** to produce a payroll export. The
   POS is not a tax filer — it generates the data the operator uses to file. Verifactu
   reports sales, not tips.
3. **The distribution model is configurable per tenant** — direct-to-employee or pooled
   *bote*. This is not a preference: the two have different withholding treatment. Pooling is
   squarely in IRPF retención + Social Security cotización territory, while pure
   pass-through to the employee who earned it may qualify as *mediación de pago* and fall
   outside withholding, with Tribunal Supremo support. Because the choice changes the payroll
   export, the attribution model must be in the data from the start even though the export
   itself is a restaurant-phase deliverable.

Never add a *mandatory* service charge — it would flip into taxable turnover. Tip prompts
must always be declinable. Do not build EU consumer-card surcharging; it is banned.

---

## 11. Disposition of waitron

The stack decisions collapse the harvest. Nearly everything reusable was framework-bound:
auth guards and modules, menu controllers, the KDS gateway, all frontend pages. What survives
is the WebAuthn/TOTP *logic*, the Drizzle schema patterns, and the per-locale JSONB menu
model — a few hundred lines plus design knowledge.

**waitron is a reference to read, not a foundation to build on.** New repository.

Two things from it are worth carrying forward as design, not code:

- The `PLATFORM_MODE=self-hosted | saas` dual-mode concept.
- The per-locale JSONB menu content model.

Also worth remembering as a warning: waitron's tenant middleware was a no-op never wired into
`AppModule`, its `withTenantScope()` helper had zero callers, and its 2,722-line e2e suite
never ran in CI (jest `rootDir: src` matched only a Hello World test). The design document
described a system considerably more complete than the code implemented.

---

## 12. Non-goals

- Do not build a payment processor or acquirer.
- Do not let card data pass through the app — always terminal-handled.
- Do not add mandatory service charges.
- Do not make the POS a tax-filing entity.
- Do not treat hash-chaining as a later feature.
- Do not build EU consumer-card surcharging.
- Do not use a generic CRDT replication engine for sales.

---

## 13. Decisions settled

Unresolved **regulatory** questions are not listed here. They live in
[`asesor-questions.md`](../../compliance/asesor-questions.md) as Q1–Q9, with context, Spanish
formulations and routing. Their architectural consequences are stated where they bite: the Q1
fallback and the Q2 mitigation are in §6, next to the design they affect.

Two of them block: **Q1** (is a fast-syncing till an independent SIF) and **Q2** (may a node
other than the till transmit its records). **Q9** — who signs the declaración responsable for
published-source software — blocks public release rather than the build.

Decisions closed during design:

| Question | Resolution |
| --- | --- |
| Sociedad or autónomo for the deli? | **Sociedad** → Verifactu obligation begins **1 January 2027** |
| Tip distribution model | Support **both**, configurable per tenant — the two have different withholding treatment |
| Project name and repository | Reuse the existing `waitron` repository; fresh start, old code on `archive/v1` |
| Is one invoice series per till valid? | **Wrongly posed.** The chain is keyed by (SIF; NIF); series is not a chain boundary. Superseded by Q1 and Q5 |
| How long may AEAT submission be delayed? | **No numeric window exists.** The duties are hourly retry, chronological recovery ordering, `Incidencia="S"`, and a persistent on-screen unsent-record count |
| Do we build non-Veri\*Factu mode? | **Deferred until a user needs it.** No XAdES, no registro de eventos, no requerimiento path. Chain code stays mode-independent and mode is a per-SIF field from the start, so it remains a deferral. Demotes Q3 and Q4 |

---

## Appendix: glossary

| Term | Meaning |
| --- | --- |
| **SIF** | *Sistema Informático de Facturación* — the regulated entity in RD 1007/2023: a deployed system that issues invoices. Our POS running at a venue is a SIF; the project on GitHub is not. A SIF must chain records, guarantee their integrity and inalterability, keep a tamper-evident event log, emit the QR and Veri\*Factu legend, identify itself via the `SistemaInformatico` block, and carry a declaración responsable. |
| **Factura simplificada** | A simplified invoice — legally what a "receipt" or "ticket" is. Covered by Verifactu at any amount; there is no "just a receipt" escape. |
| **Rectificativa** | A corrective record. Chained records are never edited; a correction is a new record referencing the original. |
| **Declaración responsable** | The producer's self-declaration that a SIF complies. Self-published, not registered or approved. See §3. |
| **`SistemaInformatico`** | The block in every record identifying the software: producer name and NIF, program ID, 2-character system ID, version, installation number. Per-installation configuration, not source constants. |
| **Veri\*Factu mode** | Real-time submission of each record to AEAT, authenticated by client certificate over mTLS. The alternative (non-Veri\*Factu) requires qualified XAdES signatures instead. We use Veri\*Factu mode. |
| **TicketBAI** | The equivalent regime in the three Basque diputaciones, plus Navarra's separate one. Not applicable in Barcelona; a future `FiscalBackend` adapter. |
