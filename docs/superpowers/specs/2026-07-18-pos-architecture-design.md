# Open-Source Restaurant POS — Architecture Design

**Date:** 2026-07-18
**Status:** Approved in brainstorming; supersedes `docs/plans/2026-02-28-architecture-design.md`

This document records the architectural decisions for a new project. It is not an
incremental revision of waitron — see [§11 Disposition of waitron](#11-disposition-of-waitron).

---

## 1. What we are building

An open-source POS and restaurant management system, intended to replace Square, released
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
| 6 | Locations — venue/location model, till registration and series assignment | Deli (minimal) |
| 7 | Counter POS UI — offline-first till, weighed items, tender, ticket printing | Deli |
| 8 | Reporting — daily close (Z-report), VAT summary, sales analytics | Deli (core subset) |
| 9 | Deployment — standalone single process + multi-tenant cloud | Deli (thin) |
| 10 | Tabs, preAuth/incremental auth, split checks and tender | Restaurant |
| 11 | Table layout / floor plan | Restaurant |
| 12 | KDS, bar/kitchen routing | Restaurant |
| 13 | Tips — attribution + payroll export | Restaurant |
| 14 | Bookings | Restaurant |
| 15 | Online ordering / click-and-collect | Later |

Sub-projects 2 and 3 are joined at the hip — the chain *is* the sales table — and get specced
together, immediately after the design system.

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
|---|---|
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

### In Veri*Factu mode, XAdES is not required

Real-time submission authenticates via client certificate over mTLS. The qualified
electronic signature is only needed for the non-Veri\*Factu alternative. `josemmo/Verifactu-PHP`,
the most-adopted implementation in any language, ships no signing code at all.

**This is why the project can stay in TypeScript** — it removes the hardest cryptographic
component from the build.

### Declaración responsable and open source

AEAT guidance (FAQ updated 26 March 2026) explicitly addresses this: whoever programs the
code or integrates components, *"ya sea o no de código abierto"*, must make the declaration.
Being open source changes nothing about liability. There is no homologación or prior
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
  open-source question: our company, our NIF, our deployment.
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
|---|---|---|
| Language | TypeScript throughout | One language; Veri\*Factu mode removes the XAdES barrier |
| Till + dashboard | Vite + Lit, PWA | Small runtime, standards-based, strong offline/PWA fit, existing fluency |
| Server | Hono | Thin server; fast builds; good TS inference; portable |
| ORM | Drizzle | Targets both dialects |
| DB (cloud) | Postgres | ACID, constraints, exact numerics, RLS as tenant backstop |
| DB (standalone) | SQLite | Single process, no compose file — lowest barrier to adoption |
| Tests | Vitest + pglite | No container needed for Postgres tests |
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

### Dual database risk

**The fiscal test suite runs against both SQLite and Postgres in CI from the first commit.**
Dialect divergence discovered late, in the code that chains sales records, is the expensive
kind. RLS exists only in the Postgres path — acceptable, because the SQLite path is the
standalone path and is single-tenant, so there is no cross-tenant isolation to back up.

---

## 5. Architecture: a sync tree

Every node has a local store, an outbox, and optionally an upstream. A till is a leaf. A
server is an interior node. The cloud, when present, is the root. A local server syncing to
the cloud uses **the same protocol** a till uses to sync to it.

| Deployment | Topology |
|---|---|
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

### One invoice series per till

This is what makes offline and Verifactu compatible. The chain is strictly ordered per
series; a shared chain would require asking the server for the next position before
completing any sale, which breaks the moment the network does. Each till maintains an
independent chain locally, at full speed, offline indefinitely.

> **Open question — must be confirmed before building on it.** Multiple series per issuer is
> ordinary invoicing practice and series+number is the record identifier, so this is
> probably sound. It is load-bearing enough to verify against the spec and with an asesor.
> If wrong, the offline design changes shape substantially.

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

Submission respects AEAT's `TiempoEsperaEnvio` throttling and delivers in order per series.

> **Open question:** how long a submission may be delayed before it becomes a problem.
> Verifactu's framing is real-time and outages are clearly contemplated, but the tolerance
> needs confirming with an asesor.

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
packages/db         Drizzle schema, both dialects
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

This matters more here than in a typical app: an open-source POS will be deployed by
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
- Get AEAT preproduction sandbox access working end to end.
- Confirm with an asesor: series-per-till validity, submission delay tolerance, and the tip
  withholding model (direct-to-employee vs pooled *bote*).
- Resolve the declaración responsable position for distribution (§3).
- Decide sociedad vs autónomo for the deli — it determines whether the deadline is
  1 Jan or 1 Jul 2027.

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

## 13. Open questions

| # | Question | Blocks |
|---|---|---|
| 1 | Is one invoice series per till valid under Verifactu? | The offline design |
| 2 | How long may AEAT submission be delayed during an outage? | Outbox retry policy |
| 3 | Consulta vinculante on artifact-scoped declaración responsable — does a digest-scoped declaration cover downstream deployments? | Distribution model; public release |
| ~~4~~ | ~~Sociedad or autónomo?~~ **Closed:** sociedad → **1 January 2027** | — |
| ~~5~~ | ~~Tip distribution model?~~ **Closed:** must support both, configurable per tenant | — |
| ~~6~~ | ~~Project name and repository?~~ **Closed:** reuse the existing `waitron` repo, fresh start | — |

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
