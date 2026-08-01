# The local server as SIF: active-active chaining and human-driven failover

**Date:** 2026-08-01
**Status:** approved design, not yet implemented
**Decides:** which node is the SIF, how a venue keeps selling when a server dies, and which
jobs run on one server versus both.

Regulatory facts live in [`docs/compliance/verifactu-findings.md`](../../compliance/verifactu-findings.md)
and [`docs/compliance/asesor-questions.md`](../../compliance/asesor-questions.md). This document
states the architectural consequences and cites, in §12, the primary AEAT sources each fiscal claim
rests on. Where the two disagree, the findings document wins.

---

## 1. Why this spec exists

[`2026-07-18-pos-architecture-design.md`](2026-07-18-pos-architecture-design.md) §6 chose **each
till is its own SIF** — per-till independent hash chains — and recorded, as a fallback "if Q1
resolves against us", that **the local server becomes the SIF** (one chain per venue, tills as UI
clients). This spec **promotes that fallback to the primary model** and works out what the fallback
note deferred: active-active operation, failover, and the division of labour between two servers.

The move is not defensive. Making the server the SIF **dissolves the two unresolved legal questions
the per-till model was balanced on**, and the architecture design itself notes those two questions
pull against each other (§6, "Q1 and Q2 pull in opposite directions"):

- **Q1 — is a fast-syncing till an independent SIF?** Per-till offline selling is lawful only if
  each till qualifies as a decentralised system *not* controlled in real time by anything central.
  AEAT's wording is hedged and the question is open with the asesor.
- **Q2 — may a node other than the originating SIF transmit its records?** The per-till design has
  the server relay each till's filings.

To win Q1 you argue the tills are *independent*; to win Q2 you argue the till and server are *one
integrated system*. The per-till design bets on both opposite arguments landing.

**Server-as-SIF needs neither.** If the server is the SIF and tills are screens asking it for the
next chain position, Q1 is moot (a till is not a SIF, so nobody must argue it is; server + tills are
plainly one real-time integrated system → one SIF, one chain) and Q2 is moot (the SIF files its own
records). As it happens Q2 is separately **closed favourably** on primary source anyway — see §6 and
§12 — so the relay pattern is available regardless; but the point is that server-as-SIF does not
depend on that ruling.

Two further gains fall out:

- It **removes the "local store durability" weakness** the architecture design frets about (§5):
  legally-required unsubmitted records stop living in each tablet's browser IndexedDB and live on
  the server instead.
- It **collapses the `número de instalación` lifecycle** (reimage / hardware-swap / relocation, one
  per till) down to one identity per server.

The cost is that the server becomes required to sell. §2 states how that is bounded; §3–§9 make it
survivable.

---

## 2. The local server is the SIF; tills are clients

**Decision.** The unit AEAT holds responsible for issuing invoices — the SIF — is the **local
server**, not the till. A till is a UI client that must reach a server to complete a sale, because
producing the chained, hashed fiscal record *is* part of the sale.

### The availability cut

Three reachability requirements, deliberately not equal:

| Reach… | Requirement | If unreachable |
| --- | --- | --- |
| the **SIF (a server)** | **hard** — no sale without it | the till cannot ring up a sale |
| the **card acquirer** | **soft** | fall back to 4G, a stand-alone terminal, or cash |
| **AEAT** | **not on the sale path** | records chain locally; the outbox drains later |

This is consistent with the architecture design's existing rule (§6): *"chaining is local and
synchronous; submission is asynchronous."* Server-as-SIF only relocates "local" from *the till* to
*the server*.

### An invariant has to be rewritten, not quietly broken

`CLAUDE.md` §5 currently states, flatly: *"Nothing may block a sale… A till that cannot sell is a
shop that cannot trade."* Under this design a server genuinely can block every till it serves. That
line must be **rewritten** to the true statement — *nothing **external** (AEAT, the card network,
the internet) blocks a sale; the on-site, replicated SIF must be reachable* — in the same change
that implements this design. §3–§9 exist to make "the SIF is reachable" hold through a server death.

---

## 3. Active-active: two servers, two SIFs, one venue

**Decision.** A venue runs **two servers, each its own SIF** — its own hash chain, its own invoice
series, its own `número de instalación`. Both accept sales all the time (active-active); tills are
*pinned* to a home server and fail over to the other. This is AEAT's "SIF virtuales" case: several
independent SIFs under one taxpayer, each with a distinct never-reused installation number
(FAQ §4 — §12).

### New chain on takeover, never resume the dead one's

When a standby takes over, it continues on **its own** chain under **its own** SIF identity — it does
**not** resume the dead server's chain. Chains cannot be merged or migrated, so there is nothing to
resume; and this choice is what makes the rest safe.

**Consequence — split-brain is non-catastrophic.** Under a *shared* chain, two servers writing the
same chain concurrently would **fork** it — unrecoverable, because records are immutable and a reused
number is rejected (AEAT error 3000, §12). Under new-chain-per-SIF, a botched fence produces two
*valid, separate* chains running concurrently — untidy, needs reconciling, but not corrupt. AEAT
explicitly permits one taxpayer to run several SIFs.

**One condition makes that true, and it is a real trap: series isolation.** AEAT identifies a record
by the triple `(NIF, NumSerieFactura, FechaExpedicionFactura)` — **not** by installation number
(§12). So if both servers issue "series A, number 1005" on the same day, that is a duplicate
(error 3000) even though the chains are separate. **Each server must issue under its own series**,
never a shared one. (This differs from the disaster-*restore* flow in
[`2026-07-31-cloud-storage-model-design.md`](2026-07-31-cloud-storage-model-design.md) §5, where the
old server is confirmed dead and numbering safely resumes above a high-water mark on the same series
— there is no concurrency there. Failover has possible concurrency, so it needs genuine series
separation.)

### Asynchronous replication is sufficient for chain correctness

Because a standby never resumes the primary's chain, it **cannot** fork it or reuse a number — those
failures are structurally impossible across two SIF identities. Therefore replication between the
servers can be **asynchronous**; nothing about fiscal correctness requires synchronous replication.
Replication lag costs only a **durability tail**: records a dead server chained but had not yet
replicated. Those are not lost to the chain (they are that server's own records, filed by it if it
returns); but if a server is physically destroyed with, say, thirty seconds of un-replicated sales
on it, those thirty seconds are gone. That is a tuning knob (replication interval), not a correctness
question.

---

## 4. The database: partitioned ownership, fully cross-replicated

**Decision.** "Each database is a complete copy of the other" is achieved by **partitioned ownership
with full cross-replication**, **not** by symmetric multi-master.

The dangerous version of active-active is symmetric multi-master: both servers accept writes to *the
same rows*, and a conflict-resolution rule (usually last-write-wins) picks a winner on divergence.
That is a landmine here — LWW on an append-only, hash-chained fiscal ledger means silently
discarding a filed record. Conflict resolution must never come near the chain.

It never needs to. Because server A is one SIF and server B is another, **their write-sets are
disjoint**: A only ever writes A's chain, A's series, A's tills' orders; B only ever writes B's. The
correct shape is therefore:

> **Each server is the sole writer of its own half and mirrors the other's half read-only.** Both
> databases hold the union — a complete copy — but *every row has exactly one writer.* There is no
> conflict to resolve, so resolution logic is structurally unreachable from the chain.

**What must stay single-writer *globally*** (active-active must not extend to these):

- **Config / catalogue** — one editing point, flows *down* (architecture design §5). Replicated to
  both, read-only on the receiving side.
- **The installation-number counter** (`contadores_instalacion`, cloud-storage §6a) — "exactly one
  writer per NIF". Both servers minting installation numbers would collide. Handled by the cloud
  allocator; §8 pre-allocates from it.

**Mechanism.** Postgres logical replication with origin filtering (to stop A→B→A echo loops), or two
one-way logical-replication streams, or `pglogical`. This is **not turnkey** — DDL is not
auto-replicated, it needs monitoring, and the whole thing rests on the disjoint-write assumption
holding. Treat it as "prototype and prove against the real migrations," in the spirit the rest of
the fiscal work is held to; do not assume the config works from reading.

**Note.** Plain one-way streaming replication *also* yields "a complete copy" (a warm standby holds
everything the primary has, minus the lag tail). What true active-active adds on top is
**zero-downtime, no-promotion selling and partition tolerance**: a LAN split does not need a human to
adjudicate, because both servers keep selling on their own valid chains. If a venue does not want the
operational weight of bidirectional replication, a **warm complete-copy standby with instant
promotion** is a valid, simpler point on the same spectrum — reserving true active-active for larger
multi-till venues. The rest of this spec assumes active-active; the failover mechanics in §8 work
either way.

---

## 5. The till writes through

**Decision.** Building an order **writes through to the server on every change** (thin till), rather
than the till holding the tab locally and syncing in batches (fat till).

Because a live standby replicates the whole database including the open-orders table, **open tabs
survive a failover** — they are rows copied across like everything else. What is at risk narrows to
two things:

1. **The replication-lag tail** — the last few seconds of edits before a server died. Replication
   ships *committed transactions* in order, so an order is never *torn*; it is present in a
   clean, slightly-earlier form (perhaps missing the line added two seconds before the crash). Open
   orders are not fiscal records, so this window can be tightened independently of the (async)
   chain replication if the UX warrants.
2. **State that never reached the server** — which exists only under a *fat* till. Write-through
   removes it: there is nothing local-only to lose, so only (1) applies.

Server-as-SIF makes write-through nearly free on the availability axis — a till already cannot
*complete* a sale without the server, so leaning on the server to *build* the tab costs nothing
extra, and it collapses failover loss to the couple-of-seconds lag tail. The only thing given up is
adding items to a tab during a *total* server outage, when the sale could not be completed anyway.

---

## 6. Chaining and submitting are different jobs

**Decision.** Separate two jobs with very different needs:

- **Chaining (selling)** — producing the record, computing the *huella*, appending to a chain. In
  Veri\*Factu mode this needs **no secret at all**: the *huella* is a plain hash, not a signature
  (the mode is exempt from record-signing — §12). A server can be a full SIF, chaining at speed,
  holding no fiscal certificate. → **active-active** (§3).
- **Submitting (transmitting to AEAT)** — needs the taxpayer certificate and drains outboxes. →
  a **single, configured, relocatable submitter** that transmits every chain's records.

The two failovers have opposite urgency. Chaining failover blocks *selling* and is what active-active
erases. Submitter failover is **low-stakes**: there is no filing deadline (§12), so if the submitter
node dies, its role simply moves and the backlog drains minutes later; nobody is waiting at a till.

### Why the submitter is single

- **One AEAT flow-control clock per taxpayer.** The control is a minimum wait between envíos —
  initially **60 seconds**, updated by AEAT via `TiempoEsperaEnvio` in each response — with **up to
  1,000 records per envío, per obligado tributario** (§12). Two independent submitters under one NIF
  would race that budget and risk sending before the wait elapses. A single submitter holds one
  clock and paces cleanly.
- **One key ring.** Only the submitter needs the fiscal certificate, so it lives on one box, not on
  every selling box. (This confines the *fiscal* certificate; **payment** credentials still follow
  selling — any box taking cards needs its processor API key.)
- **One envío batches every chain.** `SistemaInformatico` is a **per-record** field, and the
  submission header carries one `ObligadoEmision` (the NIF) — so one envío = one taxpayer, up to
  1,000 records, **each self-identifying its own SIF** (§12). The single submitter packs *both*
  chains' records into one envío and pays the 60-second throttle **once** for the venue, not once
  per chain.

### The regulatory footing (all closed on primary source — §12)

- **Relayed / delegated submission is permitted.** AEAT's developer FAQ §5 describes exactly the
  "TPV generates the record, central backoffice transmits it" pattern and calls it valid — "ese
  backoffice haría de instrumento para la remisión del fichero sin más." The relay must be
  byte-identical, the link automatic and unavoidable, no record may be left un-transmitted, and each
  record must carry the **generating** node's `IdSistemaInformatico`/`NumeroInstalacion`, never the
  relay's. This is naturally satisfied: the identity is baked into the record and its *huella* at
  chain time; the submitter is pure transport.
- **Corrections may come from a different SIF.** FAQ §17 (casos 2.b/2.d): a subsanación or anulación
  record may be generated and submitted "desde un SIF distinto al que expidió la factura original."
  So a surviving server may issue corrections against a dead server's invoices.
- **The no-orphans condition makes draining mandatory.** FAQ §5: "no pueden quedar RF generados sin
  remitir a la AEAT." The submitter must therefore sweep every chain's backlog, including a dead
  server's un-submitted tail.

---

## 7. The two roles: primary and secondary

Consolidating §3–§6:

- **Primary** — carries the singleton roles (config/catalogue writes, AEAT filing, payment reconcile
  — §10) **and** sells/chains like any server.
- **Secondary** — sells/chains, **and** can be **promoted** to primary to take over the singleton
  roles.

Promotion is **human-driven** (§8) and sales continue throughout. The taxonomy:

| Job | Ownership | On the sale path? | Blocks hot failover of selling? |
| --- | --- | --- | --- |
| Sell / chain / issue invoice | **Active-active**, partitioned by server | Yes | No |
| Resolve own pending card payment (`resolvePending`) | **Active-active**, partitioned by initiator | Yes | No |
| Config / catalogue / user writes | **Primary only** | No | No (pausable) |
| AEAT filing (one NIF) | **Primary only** | No | No (pausable) |
| Payment reconcile (one merchant account) | **Primary only** | No | No (pausable) |

The unifying rule: **one external account → one owner.** Both the AEAT NIF (one submitter) and the
processor merchant account (one reconciler, §10) are integrity singletons and live on the primary.
Everything on the sale path is active-active.

---

## 8. Failover: throwing the switch

**The authority for "who is primary" cannot live on the primary** — it is dead, so it cannot
reconfigure tills, push config, or demote itself. The decision must live where it is reachable during
the outage:

- **On the standby** — a *promoted / not-promoted* flag it holds about its own status.
- **On each till** — a static, ordered **failover list**: `[local primary → local standby → cloud
  mirror]`, baked in ahead of time. Client-side, so it works with no internet and with the primary
  dead.

### The switch is two deliberate human acts

1. **Fence the old primary** — power it off / disconnect it.
2. **Promote the standby** — an authenticated operator action performed *on the standby*, flipping
   its flag to "I am primary, accepting sales."

Everything else follows automatically:

- **Tills auto-follow.** A till that loses its primary walks its failover list and knocks on the
  standby. An **un-promoted standby refuses sales**, so a till cannot start trading against it just
  because the primary blipped — it latches on only *after* a human promotes it. The promoted-flag
  doubles as the accidental-failover guard. No per-device reconfiguration.
- **The recovered old primary self-demotes.** On boot it checks the coordination record (asks the
  standby / reads the cloud pointer) **before accepting any sale**, sees a newer primary, and comes
  up demoted. Self-demotion beats trusting an operator to have scrubbed it from every till.

**Fencing is best-effort**, because new-chain-per-SIF (§3) makes a missed fence recoverable (two
valid concurrent SIFs, given series isolation) rather than catastrophic. A cloud "who's primary"
pointer may help redirect tills when the internet is up, but it **cannot be the primary coordinator**
— the local-failover case is often *why* the internet is down — so the standby-held flag plus the
till-side list are the mechanism, with the cloud pointer only an aid.

### Pre-allocate the standby's identity

A promotion mints a fresh SIF (new installation number). For subscribers those numbers come from the
**cloud allocator** (cloud-storage §6a), which a *local* standby cannot reach during an internet
outage — the exact case it exists for. So **reserve the standby's installation number ahead of
time**, while the link is up, so throwing the switch never needs connectivity. AEAT recommends a
timestamp or a sequential autonumber for the value (FAQ §4 — §12), either of which reserves cleanly.

### What a failover costs

Open tabs survive bar the replication-lag tail (§5). The dead server's un-submitted record tail is
drained by the (relocated) submitter (§6). No sale in flight is lost to the chain; a card payment
mid-resolution is handled by `resolvePending` on the surviving server (§10).

---

## 9. The cloud mirror

**Decision.** A venue may also run a **dedicated, single-tenant cloud mirror** — a live replica of
its local server, *in the cloud*, owned by that one client. It is **active-passive**: promoted only
when *both* local servers are gone (a genuine disaster), and it sits last on the till failover list.

This is a **different node type** from the shared cloud service in
[`2026-07-31-cloud-storage-model-design.md`](2026-07-31-cloud-storage-model-design.md):

- That spec's core objection to per-tenant cloud databases (§2) is **version skew in a shared
  schema** — many tenants on many software versions with no telemetry. A **single-tenant** mirror has
  no such skew: one client's software, code and schema deployed together, exactly like their local
  box. So §2's reasoning does **not** apply to this node.
- It does diverge from cloud-storage §9/§10 (one shared RLS database; per-tenant cloud databases
  rejected) — but those decided the **passive sync-root** role; an **active failover SIF** is a node
  type that spec never contemplated. This is new scope, not a reversal. A subscriber can have both:
  the shared sync-root for archive/reporting *and* a dedicated mirror for failover.

### The key ring, and why the cloud mirror is active-passive

Cloud-storage §3/§6 make "the cloud never holds the key ring" a hard invariant — a cloud compromise
must never expose an *unsealed* fiscal certificate. A cloud SIF that **files** must unseal that
certificate, so the key ring would reach the cloud. There is no clean way around it: the cloud-SIF's
own records must be filed by *something* holding the key ring, and the alternative (an on-prem node
files the cloud-SIF's records) reopens the very delegated-submission question server-as-SIF closed.

So the mirror is **active-passive** to keep the invariant true in normal operation:

- In steady state, both local servers are alive and the cloud mirror **chains nothing** (it is a
  passive replica) — so it needs no secret.
- Only on promotion — when both local boxes are dead — does the operator inject the key ring so the
  mirror can file. **Rotate the fiscal certificate after failback**, treating a certificate that
  spent time in the cloud as burned. This bounds exposure to a genuine disaster window, one tenant,
  rather than "always". (Scrubbing the key ring after failback shrinks the *window*; it does not undo
  a compromise *during* it — hence rotation.)

For the **local** pair there is no such tension: both boxes hold the key ring on-premises anyway, so
the single submitter (§6) and cross-SIF draining run with the on-prem key ring.

### Open regulatory edge

Cloud-storage §8a already flags that Spanish law constrains *where* the cloud may run (records
conserved outside Spain trigger a prior-notification duty on the client; outside the EU is more
restricted). That analysis leaned on "the archive is *not* a SIF." A cloud mirror that becomes a SIF
**issuing invoices** from a cloud location is a stronger version of that question — operating the
invoicing system abroad, not merely conserving records. This is an **asesor question**, in the same
bucket as §8a's open items. See §13.

---

## 10. Payments: what runs on one server, what runs on both

"Polling for card transactions" is **two jobs** with opposite ownership answers.

### `resolvePending` — active-active, partitioned by initiator

Resolving a card-present tender whose immediate poll timed out (left `attempting`, "did it capture?")
asks the processor about **one specific payment, by its ID**, that this server initiated. Under
partitioned writes a server can only *write* the resolution to its own payment row, so each server
sweeps **its own** pending captures. The processor call is a per-payment status read (idempotent),
authenticated by the shared tenant API key; two servers reading different payment IDs never collide.
This is **on the sale path** and runs per-server, so a secondary confirms-and-completes its own sales
without the primary.

### `reconcile` — single-owner primary role

Reconciling the processor's **account-wide settlement report** for a window (matching against local
rows, flagging orphans / unmatched / drift — `packages/payments/src/reconcile.ts`) is a stateful,
write-producing integrity process bound to a **single merchant account**. Two reconcilers on one
account would both detect the same drift and write **duplicate incidents**, and could **race on
actions**. Even though the complete-copy replication gives *either* server enough data to reconcile,
there must be exactly one writer of reconcile state per account — the same "one external account, one
owner" rule as the AEAT submitter. So reconcile is a **primary** role.

It does **not** block hot failover, because it is a **pausable background integrity sweep, off the
sale path, with no deadline**: card-present resolves via `resolvePending`, card-not-present is
*backstopped* by reconcile, not gated on it (cloud-storage §3). If the primary dies, reconcile pauses
until promotion, then the new primary re-pulls the missed windows.

*(An alternative — give each server its own processor sub-account so payments partition at the
processor, making reconcile active-active — is **rejected**: two payout streams and two onboardings
per venue is real weight bought to hot-failover a job that does not need it.)*

### Confirmation before completion — the settlement gate

The fiscal record chains only when **all tenders settle** (architecture design §6: "a card declined
mid-tender leaves the order open, with nothing chained"). So confirmation genuinely precedes
completion — there is no chained invoice for a payment that did not land. The load-bearing point is
**who confirms**: the **card processor / terminal**, reached **directly by the selling server** — not
the primary, not AEAT.

- **Terminal answers in time (normal case):** result returns in seconds through the till's own call
  → tender settles → record chains → sale completes at the counter. Entirely on the selling server.
- **Terminal times out (`attempting`):** the tender is *not* settled, so nothing chains yet; the sale
  waits for `resolvePending` to confirm. This is inherent to card payments on **any** topology, not a
  failover artifact, and `resolvePending` runs per-server. The counter move is the ordinary one —
  retry the card, switch tender, or take cash; the *fiscal* receipt for that sale is deferred until
  the capture resolves.

Active-active does not skip confirmation — the settlement gate stands. It ensures both confirmation
paths (synchronous terminal answer, async `resolvePending`) run independently on each server, so
neither depends on the other.

**Implementation note.** Verify the ownership wiring against the actual `packages/payments` code
(`reconcile.ts`, `store.ts`'s `resolvePending`) rather than this prose — the memory records those
Stripe adapters had real-role tenancy defects fixed only recently, so "who may write what" must be
checked against the code.

---

## 11. What this supersedes and interacts with

- **Promotes** [`2026-07-18-pos-architecture-design.md`](2026-07-18-pos-architecture-design.md) §6's
  "Fallback if Q1 resolves against us: the local server is the SIF" from a hedge to **the** model.
  Add a dated pointer there to this spec; leave its text as written (per `CLAUDE.md` §6).
- **Rewrites** `CLAUDE.md` §5's "nothing may block a sale" invariant to the true statement — nothing
  *external* blocks a sale; the on-site, replicated SIF must be reachable — in the change that
  implements this (§2).
- **Adds a node type** to
  [`2026-07-31-cloud-storage-model-design.md`](2026-07-31-cloud-storage-model-design.md): the
  dedicated single-tenant failover mirror (§9), distinct from that spec's shared sync-root. It does
  not reinstate the "till → cloud" topology that spec removed.
- **Depends on** cloud-storage §6a's installation-number allocator (§8's pre-allocation) and its
  restore promise (§5's disaster path is the both-local-dead case §9 covers with the mirror).
- **Changes the standing list in** [`docs/compliance/asesor-questions.md`](../../compliance/asesor-questions.md).
  This design makes **Q1** ("is a fast-syncing till an independent SIF?") moot — the server is the
  SIF, so the till need not be one — and leaves the already-closed **Q2** (relayed submission)
  non-load-bearing (§1). It also **reshapes Q5(a)** ("one invoice series per till"): under
  server-as-SIF a series belongs to the *server*-SIF, and §3 adds a hard new constraint — the two
  concurrent SIFs must issue under **disjoint series**, or their records collide on the identity
  triple (error 3000). The backlog's advisor-gap section already says to re-read that list against
  the current architecture before engaging anyone; this design is another reason to. Do **not** edit
  `asesor-questions.md` until this design lands (`/land-branch` owns the backlog/question updates).

---

## 12. Sourced fiscal findings (receipts)

Primary AEAT documents, verified during this design. The web-service and validations PDFs resist
normal fetching and were extracted locally with `pdftotext -layout`.

| Claim | Source | What it says |
| --- | --- | --- |
| `SistemaInformatico` is **per-record**, not per-header | AEAT XSD `SuministroInformacion.xsd` | `SistemaInformatico` is declared inside `RegistroFacturacionAltaType`; the `Cabecera` holds only `ObligadoEmision`, `Representante`, `RemisionVoluntaria`, `RemisionRequerimiento`. So one envío = one NIF, up to 1,000 records each self-identifying its SIF. |
| Flow control: 60 s / 1,000-per-envío, per obligado | `Veri-Factu_Descripcion_SWeb.pdf` v1.0.3 §6.4.4.1 (Orden art. 16.2) | "…tiempo de espera entre envíos, el cual tomará inicialmente el valor de 60 segundos"; next envío after `t` seconds or 1,000 accumulated records, whichever first; "El número máximo de registros por envío es de 1.000." |
| **No** rule constrains one-SIF-per-envío | `Validaciones_Errores_Veri-Factu.pdf` v1.2.2 §3.1.5 + AEAT `errores.properties` | The complete `SistemaInformatico` business-validation list is per-record field checks only; every `SistemaInformatico` error code (1176/1177/1179/1220/1223/1242…) is per-field/per-record. No cross-record or per-envío uniformity rule, none tying `SistemaInformatico` to the certificate or `ObligadoEmision`. |
| Relayed / delegated submission **permitted** | AEAT developer FAQ v1.3 (4 Dec 2025) §5 | The "TPV generates, central backoffice transmits" architecture is valid; "ese backoffice haría de instrumento para la remisión del fichero sin más." Conditions: byte-identical, automatic/unavoidable link, no RF left un-transmitted, record carries the generating SIF's identity. |
| Corrections from a **different** SIF permitted | FAQ v1.3 §17, casos 2.b/2.d | "…un RF de alta de subsanación como un RF de anulación se podrían generar y conservar o remitir a la AEAT desde un SIF distinto al que expidió la factura original." |
| Multiple **"SIF virtuales"** per taxpayer, each own installation number | FAQ v1.3 §4 | Distinct facturaciones "del mismo OEF pero de distintos centros de facturación independientes… se consideran SIF independientes, como si fueran 'SIF virtuales'"; each needs a `nº de instalación propio y distinto`, never reused; recommended value a timestamp or sequential autonumber. |
| Record identity triple; duplicate → error 3000 | `Veri-Factu_Descripcion_SWeb.pdf` (IDFactura); FAQ §6 | Identity is `NIF + NumSerieFactura + FechaExpedicionFactura`; a repeat is "Registro de facturación duplicado" (3000); numbering may never be reused, "aunque sean facturas expedidas 'de prueba'." |
| Billing must not be interrupted by a chaining-check failure | FAQ v1.3 §15 | A chaining-check anomaly is logged (NO VERI\*FACTU) but "será preciso generar el siguiente RF, ya que la facturación por este motivo NUNCA debe interrumpirse." |
| No submission deadline (but hourly-retry duties on incident) | findings §2 / RD 1007/2023 art. 8.1 | The duty is qualitative ("instantánea"); no numeric window; a late backlog submits cleanly. |
| Veri\*Factu exempt from record-signing (huella suffices) | findings / RD 1007/2023 art. 16.3 | Chaining needs only the hash, not a qualified-certificate signature — so a chaining-only server needs no secret. (NO VERI\*FACTU is different — see §13.) |

---

## 13. Open questions

- **Where may an *active* cloud SIF run?** (§9.) Cloud-storage §8a constrains hosting location for
  *conserving* records; a cloud mirror that **issues** invoices from abroad is a stronger case
  (operating the SIF outside Spain/EU, arts. 22.2 / 19.4 of RD 1619/2012). Asesor question, before
  the mirror is built. Everything else on the AEAT side is closed on primary source (§12).
- **Warm-standby vs true active-active per venue** (§4). The deli may not need bidirectional
  replication; a warm complete-copy standby with instant promotion is a valid simpler point. Decide
  per deployment; the failover mechanics (§8) work either way.
- **NO VERI\*FACTU mode changes the certificate story** (§6). That mode requires a qualified-cert
  *signature at chain time*, so the "only the submitter holds a secret" split collapses — a chaining
  server would need the signing certificate. Non-Veri\*Factu is deferred, but the submitter role and
  the mode flag are coupled; note it before that mode is built.
- **Counter UX for the timed-out card case** (§10) — retry / alternative tender / wait — belongs to
  the till UI spec, not this one.

---

## 14. Out of scope

Each gets its own spec once this is approved: the sync/replication protocol between the two servers
and the cloud mirror; the promotion/fencing tooling and the till-side failover list; the submitter
role's placement and cert resolution; the counter UX above. This document decides the **topology and
the division of labour** only.
