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

> **Pointer (2026-08-29).** This "thirty seconds… a tuning knob" bound holds **only while replication is
> flowing.** Under a network partition an isolated-but-selling node's un-replicated tail is *unbounded* —
> it grows for the whole partition. Not a chain-correctness issue (those are the node's own records on its
> own chain), but it changes what "safe to discard a box" means. See
> [`2026-08-29-promotion-failover-and-node-lifecycle-design.md`](2026-08-29-promotion-failover-and-node-lifecycle-design.md)
> §4 (and §5 for the disposal guard). Text above left as written.

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

**The authority for "who is primary" cannot live on the primary** — a dead primary cannot
reconfigure tills, push config, or demote itself. And the decision is **location-independent**: a
server resolves its role the same way whether it runs locally or in the cloud (§9). Two facts carry
it through an outage:

- **Each server holds a `role` it can answer for** — *primary* (holds the singleton roles) or
  *secondary* (sell-only) — readable by anyone who can reach that server.
- **Each till holds a static, ordered failover list** — e.g. `[primary → secondary → cloud]`, baked
  in ahead of time. Client-side, so it works with the primary dead and the internet down. The
  ordering is topology configuration, not fixed (§9).

### The role being resolved is "primary", and it never blocks selling

The only thing a booting server is unsure of is the **singleton roles** (config-writer, AEAT filer,
reconciler — §7). **Selling is active-active and needs no role**: a server sells on its own reserved
SIF identity and series (below) the moment it boots. So role-resolution runs in the background and
**never blocks trade** — even a server waiting for a human to confirm it as primary can already ring
up sales; only *config changes* and *filing* wait, and neither is on the sale path (filing has no
deadline; the catalogue is a replicated read-only copy every server holds). A venue that powered on
cold can trade all day with **no primary at all**, its outbox growing, and file everything the moment
a human designates one.

### Boot-time role resolution

On boot a server sells immediately (on its reserved identity) and resolves the *primary* role by
reaching its configured peers:

- **A peer is reachable and claims primary** → become **secondary**, automatically. This is the
  self-demotion that makes a recovered old primary defer to the standby that replaced it — no human,
  no fencing step required.
- **A peer is reachable but is not primary** (it is secondary, or also just-booted and undetermined),
  **or** no peer is reachable → **keep selling, but wait for a human to confirm this server as
  primary.** Never claim the singleton roles unattended while another primary-capable peer might be
  contesting them. This is what covers the cold power-cycle, where both boot at once and neither may
  auto-assume primary.

### The invariant, and why a human arbitrates

**At most one primary — one holder of the singleton roles — at any time.** Two servers *selling*
concurrently is always fine (new chain, disjoint series, §3); only the singleton work must be
mutually exclusive.

Role resolution is **continuous, not one-shot at boot.** Every server keeps watching for "is there
another primary?", because a healed **network partition** can reveal two: if a human promoted the
standby believing the old primary dead when it was only partitioned, on reconnect the two must
**detect the conflict and one yields** by a fixed tie-break (e.g. lowest server-id keeps the
singletons; the loser stops filing and config-writing and drops to secondary, still selling). A
one-shot boot check cannot catch a primary that appears later.

A human arbitrates the ambiguous case **by necessity, not laziness**: two nodes cannot safely
auto-elect a leader under a partition — neither holds a majority when they cannot see each other, so
any fully-automatic rule can pick two. Safe *automatic* failover needs a third **witness** to break
ties; the cloud can serve as one when the internet is up, but not in the outage the local pair exists
for, and a dedicated local witness is hardware a deli does not want. Human-as-arbiter is the
deliberate, correct choice, consistent with the manual-switch-as-safety finding. Fencing the old box
becomes optional hygiene rather than a required safety step, because self-demotion plus continuous
conflict-detection already handle a returning primary.

> **Pointer (2026-08-29).** "Fencing… optional hygiene" is **refined into a required promotion step** for
> the hard case (a partition where both boxes stay functional, which self-demotion cannot cross).
> Promotion *physically fences* the old node (power-off *or* demote-to-sell-only, at the box) **and**
> actively evicts it from the serving list — while eviction from *serving* is not eviction from
> *replication* (an evicted/sell-only node stays a source until its tail drains). See
> [`2026-08-29-promotion-failover-and-node-lifecycle-design.md`](2026-08-29-promotion-failover-and-node-lifecycle-design.md)
> §3.5. Text above left as written.

**A botched dual-designation is recoverable, not fatal.** The fiscal side is protected by new-chain +
series isolation + AEAT's `3000` dedup (§3). The one genuinely conflicting shared state is **config**
(two managers editing the menu on two boxes during the window) — versioned, non-fiscal,
merge-resolvable, never the unrecoverable chain. So the worst outcome of the whole scheme is a config
divergence fixed by hand.

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

## 9. The cloud mirror: a server that can hold any role

**Decision.** A venue may run a **dedicated, single-tenant cloud server** — a live replica owned by
one client, exactly like a local server but hosted in the cloud. **Role and location are separate:**
it runs the same boot-time role-resolution as any server (§8), so it can be the tertiary spare, an
active-active secondary, the primary, or — with no local hardware — the venue's **only** server. It
is not fixed as a passive last resort.

Location changes exactly two things:

- **Reachability.** A local server survives an internet outage; a cloud server is reachable only when
  the internet is up. So a topology's resilience depends on *where* its servers sit — at least one
  **local** server keeps the venue selling through an internet outage; a cloud-only venue cannot sell
  when its link is down.
- **Where the fiscal certificate lives.** The certificate sits on whichever server holds the
  **primary** role (it is the submitter — §6). Put the primary in the cloud and the key ring lives in
  the cloud (below).

### Sensible topologies

| Topology | Key ring | Survives internet outage? | Notes |
| --- | --- | --- | --- |
| **Two local + cloud tertiary** | on-prem; cloud only in disaster | yes | **Recommended default.** Best resilience; cloud holds copies, files only if both local boxes die |
| **One local primary + cloud secondary** | on-prem (local primary) | yes (local) | Cloud adds internet-up selling redundancy; it chains its own sales but holds no cert — the local primary files everything (§6) |
| **Cloud primary + local secondary** | in the cloud (standing) | selling yes, filing no | Deliberate posture choice — see below |
| **Cloud standalone** (no local box) | in the cloud (standing) | no — needs internet to sell | For a venue that wants no local hardware and has reliable connectivity |

### The key ring follows the primary

For a **dedicated** cloud server the "cloud never holds the key ring" rule is not absolute — it is a
**posture the operator chooses by where they put the primary**:

- A cloud node that only **chains** (secondary/tertiary) needs **no secret** — the *huella* is a
  plain hash (§6), so it sells on its own chain holding nothing, and the on-prem primary files its
  records (delegated submission, permitted — §6/§12).
- A cloud node that is **primary** or **standalone** is the submitter, so the fiscal certificate
  lives in the cloud **as a standing condition**, not just a disaster window. That is a real
  security-posture change — bounded by the box being **single-tenant** (blast radius one tenant) and
  by **certificate-rotation hygiene**, but it is the operator's informed choice, not a default.

The **recommended default** keeps the cert on-prem: two local servers active-active with a cloud
**tertiary** that is active-passive — promoted only if *both* local boxes die, key ring injected at
promotion, certificate rotated after failback (scrubbing shrinks the exposure *window*; a compromise
*during* it is not undone by scrubbing — hence rotation).

### This scopes cloud-storage §2 — deliberately

[`2026-07-31-cloud-storage-model-design.md`](2026-07-31-cloud-storage-model-design.md) §2 states "the
cloud is a sync root and never a primary store; every venue runs a local server as its system of
record," and removed the "till → cloud, no local hardware" topology. A cloud primary/standalone
crosses that. **But §2's reasoning was version skew in a *shared* multi-tenant store** — many tenants
on one schema at many versions — and that objection does **not** exist for a *dedicated single-tenant*
server, which runs one client's version, code and schema deployed together, exactly like a local box.
So this is not a blind reversal: it **scopes §2 to what its reasoning covers** — the *shared* store
stays sync-root-only; a *dedicated single-tenant* server may originate transactions wherever it runs.
Add the dated pointer to the cloud-storage spec at land time — `CLAUDE.md` §6 keeps historical docs
as written and adds a dated pointer rather than rewriting them. Cloud-primary/standalone stays a
deliberate choice with the posture cost above, not the recommended shape.

### Open regulatory edge — now central, not disaster-only

Cloud-storage §8a constrains *where* the cloud may run: records conserved outside Spain trigger a
prior-notification duty on the client; outside the EU is more restricted (RD 1619/2012 arts. 22.2 /
19.4). That analysis leaned on "the archive is *not* a SIF." A cloud server that **is** the SIF —
*issuing* invoices, not merely conserving records — is a stronger case, and under a cloud-primary or
standalone topology it is the **normal operating state**, not a disaster edge. This is the live
**asesor question** in §13.

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

**A matching subtlety to bank:** a card charge includes the **tip**, but the invoice does not — the
tip is on the sale and the payment, off the factura and off the *huella* (Q13). So reconcile matches
the processor charge against **factura + tip**, not the factura alone, or every tipped card sale
reads as drift.

It does **not** block hot failover, because it is a **pausable background integrity sweep, off the
sale path, with no deadline**: card-present resolves via `resolvePending`, card-not-present is
*backstopped* by reconcile, not gated on it (cloud-storage §3). If the primary dies, reconcile pauses
until promotion, then the new primary re-pulls the missed windows.

*(An alternative — give each server its own processor sub-account so payments partition at the
processor, making reconcile active-active — is **rejected**: two payout streams and two onboardings
per venue is real weight bought to hot-failover a job that does not need it.)*

### Confirmation, completion, and the two factura-timing modes

Whether payment confirmation precedes the fiscal record depends on the till's mode — and **both are
supported**. A note on words first, because they overload: the default receipt every sale produces
**is** the fiscal *factura simplificada* (it carries the QR and generates the chained record). A
**pre-bill** ("la cuenta") is a separate, *non-fiscal* slip a table-service customer may get before
paying. This spec avoids "ticket", which in Spanish means the simplified factura and so *is* fiscal.

- **Factura-at-settlement** (default): the record chains only when **all tenders settle**
  (architecture design §6: "a card declined mid-tender leaves the order open, with nothing chained").
  Confirmation genuinely precedes completion — no chained invoice for a payment that did not land. The
  customer may hold a non-fiscal **pre-bill** until then.
- **Factura-before-payment** (the backlog's "invoice-first mode"): the fiscal invoice is **chained and
  filed *before* payment** — the customer gets a real *factura* and then pays it. Lawful: the invoice
  documents the *operation* (delivery / service), and payment is a separate financial event (FAQ §20;
  §24 for criterio de caja). The cost is failure-handling — an unpaid, short-paid or disputed invoice
  is already filed, so it is corrected with a **rectificativa**, not by leaving an order open. This is
  why the backlog sequences it *after* rectificativas.

Neither mode changes the topology: **chaining is active-active on the selling server in both**, and
both are hot-failover-safe (the record chains without the primary; payment resolves per-server). The
load-bearing point is unchanged — **who confirms a card payment is the processor / terminal, reached
directly by the selling server**, never the primary or AEAT:

- **Terminal answers in time (normal case):** result in seconds through the till's own call → tender
  settles → (factura-at-settlement) the record chains → sale completes at the counter.
- **Terminal times out (`attempting`):** the tender is not settled; `resolvePending` confirms it
  later, per-server — inherent to card payments on any topology. Under factura-at-settlement the
  *fiscal* receipt is deferred until the capture resolves; under factura-before-payment the invoice
  already exists and only the payment settles late.

### A payment lost to a server death — prevention and remediation

The failure the topology must answer: a server takes a card payment, then dies **before** the capture
is recorded in our system; staff, seeing an unpaid sale, take payment **again** on the surviving
server. **Prevention is the primary defence, detection the backstop.**

- **Prevent — reuse the idempotency key.** The `attempting` row is written (with the processor
  idempotency key) *before* the charge, so it replicates. A re-tender reusing that key is
  **de-duplicated by the processor** — no second charge.
- **Prevent — resolve before re-tendering.** Because the `attempting` state replicated, the surviving
  server *knows* an in-flight charge exists for the order and **resolves it first** — captured →
  already paid, do not re-charge; failed → safe to re-charge.
- **Detect — the backstop for the irreducible case.** If the server died in the seconds-wide window
  *before* the `attempt` replicated, the survivor never knew, and the double-charge happens. It is
  caught either when the survivor **adopts and resolves the dead server's pending payments** (if they
  later replicated) or by **`reconcile`** as an *unmatched* charge in the account-wide settlement
  report.
- **Remediate — reported, never auto-refunded.** `reconcile` **reports** the orphan / unmatched charge
  and holds it **pending a human**; it does **not** auto-reverse (orphan-drift gate, #31 — the "send
  our amount back" auto-fix is disqualified). **Open gap:** there is no remediation UI for that human
  step yet — the gate holds customer funds pending an operator who currently has nowhere to action it.
  Named here so it is not mistaken for solved.

Fiscally this is clean: under factura-at-settlement the dead server chained nothing (it never reached
settlement), so there is one invoice (the survivor's) and one duplicate *payment* to refund — no
rectificativa; under factura-before-payment the invoice is already fixed, so a duplicate is likewise
a pure payment refund.

**Implementation note.** Verify the ownership wiring against the actual `packages/payments` code
(`reconcile.ts`, `store.ts`'s `resolvePending`) **and its tests exercised under the non-superuser
deployment role** — the Stripe adapters have a documented history of behaving differently under the
real role than under a superuser test connection, so "who may write what" must be confirmed against
the code and a real-role test, not assumed from this prose.

---

## 11. What this supersedes and interacts with

- **Promotes** [`2026-07-18-pos-architecture-design.md`](2026-07-18-pos-architecture-design.md) §6's
  "Fallback if Q1 resolves against us: the local server is the SIF" from a hedge to **the** model.
  Add a dated pointer there to this spec; leave its text as written (per `CLAUDE.md` §6).
- **Rewrites** `CLAUDE.md` §5's "nothing may block a sale" invariant to the true statement — nothing
  *external* blocks a sale; the on-site, replicated SIF must be reachable — in the change that
  implements this (§2).
- **Scopes** [`2026-07-31-cloud-storage-model-design.md`](2026-07-31-cloud-storage-model-design.md)
  §2 (§9). A **dedicated single-tenant** cloud server may hold any role — including primary or
  standalone — because §2's version-skew reasoning covers only the *shared* store, not a single-tenant
  box deploying one client's code and schema together. This does re-enable a "till → cloud" shape §2
  removed, but on a dedicated server rather than the shared store §2 was reasoning about;
  cloud-primary/standalone puts the key ring in the cloud as a standing posture, not a default. It
  also still **adds** the failover-mirror node type distinct from that spec's shared sync-root. Add the
  dated pointer to that spec at land time.
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
  *conserving* records; a cloud server that **issues** invoices from abroad is a stronger case
  (operating the SIF outside Spain/EU, arts. 22.2 / 19.4 of RD 1619/2012). Under the tertiary default
  it is a disaster-only edge; under a **cloud-primary or standalone** topology it is the *normal*
  operating state, so it must be answered before those topologies are offered. Asesor question.
  Everything else on the AEAT side is closed on primary source (§12).
- **Warm-standby vs true active-active per venue** (§4). The deli may not need bidirectional
  replication; a warm complete-copy standby with instant promotion is a valid simpler point. Decide
  per deployment; the failover mechanics (§8) work either way.
- **NO VERI\*FACTU mode changes the certificate story** (§6). That mode requires a qualified-cert
  *signature at chain time*, so the "only the submitter holds a secret" split collapses — a chaining
  server would need the signing certificate. Non-Veri\*Factu is deferred, but the submitter role and
  the mode flag are coupled; note it before that mode is built.
- **Counter UX for the timed-out card case** (§10) — retry / alternative tender / wait — belongs to
  the till UI spec, not this one.
- **Payment double-charge remediation has no UI** (§10). `reconcile` reports an orphan / unmatched
  charge and holds it pending a human, but there is no built flow for that human to action the refund
  (a pre-existing open product question, not introduced here). The prevention path (idempotency-key
  reuse + resolve-before-re-tender) reduces how often it is reached; it does not close the gap.

---

## 14. Out of scope

Each gets its own spec once this is approved: the sync/replication protocol between the two servers
and the cloud mirror; the promotion/fencing tooling and the till-side failover list; the submitter
role's placement and cert resolution; the counter UX above. This document decides the **topology and
the division of labour** only.

---

**2026-08-03:** the schema gap §14 left open is closed by the node-id rekey
(`2026-08-03-node-id-rekey-design.md`); #33's *server* is the code's `node`. That change introduces
the `nodes` table and re-keys the four fiscal-identity tables (`registro_sif`, `cadenas`,
`registros_facturacion`, `invoice_series`) from `till_id` to `node_id`, so the "SIF is the compute
node, not the till" decision this document made is now the schema's shape. The active-active
sync/replication protocol, promotion/fencing, and the submitter-role split above remain out of scope
and keep their own specs.
