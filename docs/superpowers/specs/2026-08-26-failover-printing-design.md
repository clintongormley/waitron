# Failover printing — surviving a local-box death without a cloud tunnel

**Date:** 2026-08-26. **Status:** design (decision-capture; approved section-by-section with the owner).
**Track:** printing + hardware surface (top-tier #4) × distribution/failover (#5/#8). **Runs SUPERVISED.**

This records **how printing survives a failover** — the local box dying and a cloud (or second local)
node taking over — a corner the [printing subsystem design](2026-08-17-printing-subsystem-design.md)
explicitly deferred (§4: *"single-node works now; full multi-node routing lands when replication
does"*). It is **decision-capture, not a build-now slice**: its mechanisms are follow-ons to work that
is either **in flight** (the base printing subsystem, `feat/printing-subsystem` — schema + agent runtime
+ transports committed) or **unbuilt** (the till-side failover list, spec-only; the on-device agent, no
spec yet, [backlog](../../backlog.md) top-tier #8). **It disrupts none of the in-flight branch** (§8).

The originating question: *the snitun/relay tunnel that reaches the box dies with the box, so does
printing depend on it?* No — printing survives failover through the **outbox + pull-agent** model the
printing subsystem already carries, not through the tunnel. This design fills in the failover corner of
that model.

## 1. The one-line answer

Printing survives a box death when a **print agent** running on **something other than the dead box** —
a second local box, or a till — pulls the failed-over node's queued jobs (dialing outbound) and pushes
them to a USB or IP printer it can reach. The tunnel is never involved: it is the path *to* the box, and
failover is precisely the case where we have given up on the box.

## 2. The failure model — what survives what (operator-facing)

There are **two independent failures**, and they are covered by **opposite** mechanisms. This matrix is
not just internal lore — it ships as **operator guidance** on the dashboard's printer surface, so a
venue can see what its current setup survives.

| Printer + agent placement | **Box dies** (internet up) | **Internet down** (box alive) |
| --- | --- | --- |
| USB/IP printer, agent runs **only on the on-prem box** | ✗ agent died with the box | ✓ box is the acting node; all on the LAN |
| USB/IP printer, agent **also on a till or 2nd box** | ✓ surviving agent pulls from the cloud, pushes to the printer | ✓ box is acting node; local agent pulls locally |
| `cloud_poll` printer pointed at the **cloud** (§5) | ✓ polls the cloud, now the acting node | ✗ it lives on the internet |

The middle row — an agent on **something that outlives the box** — is the only single-printer setup that
survives **both** common failures, and it is the chosen default (§3). For a venue with two local boxes
that redundancy is free; for the common **single-box** venue, "something that outlives the box" is a
**till** (§4c).

**The uncovered corner (accepted):** box dead **and** internet down *at the same time* → no acting node
is reachable by anything, so nothing prints until one returns. Rare — box death and ISP death are
independent — and it is the honest limit of "try hard, accept we sometimes can't." Closing it would need
a till holding its own local outbox and selling standalone (a far-future "till as standalone node"), out
of scope here. See §6.

## 3. The chosen mechanism — local print agents on boxes *and* tills

**Owner decision (2026-08-26): the primary failover-printing mechanism is USB/IP printers driven by
local print agents that run on local servers *and* tills.** That placement — an agent on more than one
surviving host — is what delivers the middle row above. `cloud_poll` printers are **supported one day but
low priority** (§5), not the recommended path.

This is the printing subsystem's existing model, extended by the three deltas in §4. Nothing here
invents a new subsystem: the agent runtime (`packages/printing/src/runtime.ts`, a testable pull → push →
report batch) already exists; the deltas change *where an agent may run* and *which printers it may
serve*.

**The connection is outbound-only: the agent polls, the server never pushes.** All three legs — pull
(`GET /print-api/agent/jobs`), push to the printer, report (`POST …/result`) — are initiated by the
agent dialing out. That direction is exactly why a **cloud** server works despite the shop's NAT: the
cloud never has to reach into the LAN (which NAT would block,
[topology §5](2026-08-15-distribution-and-client-topology-design.md)) — it only answers connections the
agent opened, the same outbound-only pattern as the sync pull and the relay tunnel. On failover the
agent simply re-aims its outbound poll at the next node in the list (§4b); nothing has to reconfigure to
*reach* the agent, because nothing ever reached it.

## 4. The three deltas (against the code now on `feat/printing-subsystem`)

### 4a. Un-pin an IP printer from a single serving agent

**Built today:** `printers.agent_id` is a single bare uuid (`printers.ts:59`); the pull claims only
`p.agent_id = ${agentId}` (`runtime.ts:100`), and that `agent_id` predicate is **both** the routing key
**and** the authorization scope (`runtime.ts:129-131`: *"an agent can only report on jobs served by its
OWN printers"*). So an IP printer is bound to one agent; if that agent's box dies, its printers are
stranded even though any other LAN box could reach them.

**Change:** a `network_tcp` printer becomes servable by a **set of eligible agents** — any active agent
at its location — so a surviving agent (till / 2nd box) delivers when the box's agent dies. **USB stays
pinned** to one agent: it is physically wired to one host.

**Concurrency — an existing guard that should extend, but is untested here.** The pull's
`for update of j skip locked` (`runtime.ts:104`) locks the `print_jobs` *row*, so it should hand each job
to exactly one claimer **regardless of which agent claims it** — the guard is on the job row, not the
agent. But that path is **unreachable today** (the `agent_id` filter means two distinct agents never
select overlapping jobs) and therefore **untested**: the existing race test exercises two *instances of
the same agent* (`runtime.race.test.ts`). So 4a **must add a two-*distinct*-agents-one-shared-printer
race test, proven by deletion of the lock** — each job delivered once — beside the existing one. This is
a claim about behaviour under a condition the code has never run; it gets a test, not a paragraph.

**Authorization becomes location-scoped for shared printers**, replacing the agent-identity scope. That
is a real change to the security boundary and is a **security-review item** (the printing subsystem
already mandates a `security-review` pass before merge, [design §7](2026-08-17-printing-subsystem-design.md)).

**Why this is a follow-on, not in-flight work:** pre-production means the schema **drop-recreates with no
migration or backfill** (CLAUDE.md §3), so there is **no cost saving** from forcing an un-pinnable schema
into the nearly-done branch — the usual "build the seam now to avoid a painful migration" argument does
not apply. Land 4a with its consumers (4b/4c), not before them. Open: the eligibility model — an explicit
`printer_agents` join table vs. an implicit "any active agent at the location serves `network_tcp`" rule
(§9).

### 4b. Agents pull from the till's `[local → cloud]` failover list

An agent walks the **same ordered node list the till uses** (`[primary → secondary → cloud]`,
[failover §8](2026-08-01-local-server-sif-and-failover-design.md); the till-side list is itself spec-only
today, [backlog](../../backlog.md) #8) and pulls from the first reachable node.

**This does *not* require the outbox to be replicated across nodes.** On failover the till fires to the
cloud and the cloud **enqueues into its own outbox**; an agent that has also failed over to pull from
that same node consumes the job it created — creation and delivery happen on **one** acting node. The
printing spec deferred *general* multi-node routing (a job enqueued on A, delivered from B) to
replication ([§4:170-173](2026-08-17-printing-subsystem-design.md)); **failover is the narrower
"everyone converges on one acting node" case**, which is why it lands earlier and cheaper. The only loss
is jobs queued on the dead box *before* it died — and the order itself replicated, so it can be re-fired.

**Unification:** when the print agent runs *inside* the till's on-device agent (4c), it shares the till's
**one** failover list and down-detector — no second mechanism, no second copy of the list. A standalone
agent box (a 2nd local server) carries its own copy.

### 4c. A till may host a print agent

The agent runtime is a deployable batch (`runtime.ts`); 4c makes a **till** one of its hosts — the whole
lifeline for a single-box venue, whose only surviving compute on box death is its tills. A browser PWA
cannot open a raw socket or USB, so this requires the till's **native on-device agent**
([topology §3](2026-08-15-distribution-and-client-topology-design.md); no spec yet). That is the *same*
agent the topology already wants for failover routing and the offline queue — 4c gives it one more job,
it is not a new native component. A USB printer plugged into that till, or an IP printer the till can
reach, then survives box death for as long as the till is up.

## 5. `cloud_poll` printers — supported one day, low priority

**Owner decision (2026-08-26): keep `cloud_poll` on the roadmap but well down the priority list;** local
agents on boxes + tills give more coverage without a hardware dependency. The subsystem already carries
the `cloud_poll` enum value and `poll_*` columns ([printers.ts](2026-08-17-printing-subsystem-design.md)),
so enabling it later is an adapter + a poll endpoint — **no schema change**.

Where it *would* fit, when built: it is the **no-local-compute** route to surviving **box death** — the
printer's firmware dials out and polls, needing no surviving agent at all. That is its only real niche
(a single-box venue that refuses native code on its tills). Its ceiling is fixed by the firmware:

**A `cloud_poll` printer polls exactly one URL, with no built-in failover** — confirmed from the
vendors' own docs. Star CloudPRNT exposes a single **"Server URL (required)"** field —
*"Set a URL to be polled by the client at a certain interval through HTTP POST"* — and **no**
backup/secondary/failover URL. Epson Server Direct Print likewise takes a single server **"URL"**. So the
printer is pinned at config time to **one** of {cloud, box}: pointed at the cloud it survives box death
and dies in an internet outage; pointed at the box it survives an internet outage and dies with the box.
It cannot cover both — that is what the middle-row agent placement (§2) is for. (The URL is one **we**
host — `GET /print-api/cloudprnt/:pollId` — never the printer seller's service; Star's optional hosted
"CloudPRNT Online" is a separate product we do not use.)

*Unverified, flagged (CLAUDE.md §1):* a search summary described an Epson "forwarding" feature as
printer-**to-printer** (another printer prints when one cannot), not server-URL failover — the Epson PDFs
would not render for direct reading. It does not change the single-URL conclusion; confirm from the
manual before relying on it.

## 6. The accepted limit

Box dead **and** internet down simultaneously: no node is reachable, nothing prints until one returns.
We do not engineer around this — it is two independent failures at once, and the only fix (a till that
holds its own outbox and sells fully standalone) is a far-future capability that turns a till into a
node. Documented so a venue knows it, not hidden.

## 7. Cross-cutting: split-brain (bigger than printing)

If two nodes each believe they are the acting primary under a network partition, **two outboxes exist**,
and a till or agent that fans out across both could double-serve a job (and, worse, the same partition
lets the two nodes double-sell). The model's mitigation is that every till **and** every agent picks the
**single** first-reachable node from the **same** ordered list, so they converge rather than fan out —
necessary, but **not sufficient** under a real partition where different clients reach different nodes.

**Owner request (2026-08-26): split-brain needs its own detailed examination across the whole
active-active model — not scoped to printing.** Recorded as a [backlog](../../backlog.md) item under the
distribution/failover track; this section is only the pointer. It touches selling, the fiscal chain
(new-chain-on-partition is already the fiscal safety valve, [failover §8](2026-08-01-local-server-sif-and-failover-design.md)),
payments (`resolvePending` partitioning), and printing alike.

## 8. Sequencing / dependencies — nothing here is build-now

- **`feat/printing-subsystem` (in flight) is untouched.** It ships the single-`agent_id` model; 4a
  relaxes it later, for free (§4a). Do not expand that branch for this design.
- **4a** (un-pin) lands with its consumers, carrying a distinct-agents race test + a security-review of
  the location-scoped authz.
- **4b** (agent failover list) depends on the **till-side failover list** (spec-only) and a cloud node.
- **4c** (till as agent host) depends on the **on-device agent** (no spec yet) — the largest dependency,
  and the one that unlocks the single-box venue's coverage.
- **`cloud_poll`** is a low-priority fast-follow; no schema change to enable.

Order in practice: the on-device-agent spec and the till failover list are the gating unbuilt pieces;
this design is a **requirement into both** (they must host the print-agent runtime and share the list)
plus a small, well-scoped follow-on to the printing subsystem (4a). No implementation plan is written
now — it is written when the gating dependency lands.

## 9. Open questions

- **Un-pin eligibility model (4a):** explicit `printer_agents` join table (per-printer allow-list) vs.
  implicit "any active agent at the location serves `network_tcp`". The join table is more config but
  auditable; the implicit rule is less config but widens the authz boundary silently.
- **Agent node-down detection (4b):** reuse the till's "N consecutive failures then fail over"
  ([topology §3](2026-08-15-distribution-and-client-topology-design.md)) verbatim, or a printing-specific
  threshold? Default: reuse, especially when co-hosted in the till's agent.
- **Epson "forwarding"** (§5) — printer-to-printer vs. server-URL — to confirm from the manual before any
  reliance.
- **Split-brain** (§7) — its own design, tracked separately.

**Delivery latency (decided-deferred).** Plain short-interval polling (1–2s) is sufficient for
receipts and kitchen tickets and is what ships first — the never-block guarantee is about *enqueue*, and
a sub-2s gap before a ticket prints is invisible. If a tighter bound is ever wanted, add a **doorbell
over the same pull endpoint**: a notification that only says *"pull now"* (**SSE preferred over
WebSockets** — server→agent only, plain HTTP, auto-reconnect; WebSockets add a bidirectional channel this
use has no need for), with **the pull staying the source of truth** so the atomic claim, never-block and
single-writer guarantees are untouched, and it **degrades to polling** if the doorbell drops. The
**dedicated single-tenant server** ([failover §9](2026-08-01-local-server-sif-and-failover-design.md))
keeps this cheap — enqueue and the held connection share one process, so no cross-instance pub/sub
(Redis / `LISTEN`-`NOTIFY`) is needed. **Non-breaking to add later**; the only thing to hold to now is
that the pull endpoint is authoritative and any notify channel is a hint over it.

## 10. Provenance

Designed 2026-08-26 against the live tree and the in-flight `feat/printing-subsystem` branch.

**Internal (file:line):** the built single-agent binding + pull scope + authz —
`packages/db/src/schema/printers.ts:59`, `packages/printing/src/runtime.ts:100,104,129-131`,
`packages/printing/src/runtime.race.test.ts` (same-agent race only); the outbox + never-block +
deferred multi-node routing — [printing subsystem design](2026-08-17-printing-subsystem-design.md) §3c,
§4:170-173, §3e; the failover list + new-chain-on-partition —
[local-server SIF + failover design](2026-08-01-local-server-sif-and-failover-design.md) §8; the
browser-cannot-raw-socket + on-device agent + poll-the-cloud rows —
[distribution/client-topology design](2026-08-15-distribution-and-client-topology-design.md) §3, §5
(:262-289); the tunnel is the path *to* the box, not a failover path —
[management dashboard design](2026-08-07-management-dashboard-design.md) §5 (T1 blind tunnel, T3
read-mirror); pre-production drop-recreate / no backfill — CLAUDE.md §3.

**External (vendor, quoted per CLAUDE.md §1):**

| Claim | Source | The source's words |
| --- | --- | --- |
| Star CloudPRNT polls a single self-hosted URL, no failover URL | [Star CloudPRNT Protocol Guide — Client Settings](https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/client.html); [Developer Guide IFBD-HI01X](https://www.starmicronics.com/support/Mannualfolder/IFBD-HI01X_CloudPRNT_for_Developer.pdf) | single **"Server URL (required)"**: *"Set a URL to be polled by the client at a certain interval through HTTP POST"*; no backup/secondary field present |
| Epson Server Direct Print polls a single server URL | [Epson SDP User's Manual M00062910 Rev.K](https://files.support.epson.com/pdf/pos/bulk/server_direct_print_um_en_revk.pdf); [POS Cafe SDP guide](https://poscafe.app/blogs/knowledgebase-order-tickets-kds/epson-server-direct-print) | a single server **"URL"** field; no backup-URL field surfaced (PDF would not render for direct reading — treat the *forwarding* nuance in §5 as unverified) |
