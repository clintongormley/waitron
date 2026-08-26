# Failover printing — surviving a local-box death without a cloud tunnel

**Date:** 2026-08-26. **Status:** design (decision-capture; approved section-by-section with the owner).
**Track:** printing + hardware surface (top-tier #4) × distribution/failover (#5/#8). **Runs SUPERVISED.**

This records **how printing survives a failover** — the local box dying and a cloud (or second local)
node taking over — a corner the [printing subsystem design](2026-08-17-printing-subsystem-design.md)
explicitly deferred (§4: *"single-node works now; full multi-node routing lands when replication
does"*). It is **mostly decision-capture**: its failover mechanisms are follow-ons to work that is
either **in flight** (the base printing subsystem, `feat/printing-subsystem` — schema + agent runtime +
transports committed) or **unbuilt** (the till-side failover list, spec-only; the on-device agent, no
spec yet, [backlog](../../backlog.md) top-tier #8). **One exception is build-now:** a base-subsystem
correctness fix — the print-job **lease** (§5, Gap 1) — that should land in the in-flight branch **before
it merges**, because it drops jobs today. Everything else disrupts none of that branch (§9).

The originating question: *the snitun/relay tunnel that reaches the box dies with the box, so does
printing depend on it?* No — printing survives failover through the **outbox + pull-agent** model the
printing subsystem already carries, not through the tunnel. This design fills in the failover corner of
that model, and the guarantee (§5) that nothing is dropped on the way.

## 1. The one-line answer

Printing survives a box death when a **print agent** running on **something other than the dead box** —
a second local box, or a till — pulls the failed-over node's queued jobs (dialing outbound) and
pushes them to a USB or IP printer it can reach. The tunnel is never involved: it is the path *to* the
box, and failover is precisely the case where we have given up on the box.

## 2. The failure model — what survives what (operator-facing)

There are **two independent failures**, and they are covered by **opposite** mechanisms. This matrix is
not just internal lore — it ships as **operator guidance** on the dashboard's printer surface, so a
venue can see what its current setup survives.

| Printer + agent placement | **Box dies** (internet up) | **Internet down** (box alive) |
| --- | --- | --- |
| USB/IP printer, agent runs **only on the on-prem box** | ✗ agent died with the box | ✓ box is the acting node; all on the LAN |
| USB/IP printer, agent **also on a 2nd box or a till** | ✓ surviving agent pulls from the cloud, pushes to the printer | ✓ box is acting node; local agent pulls locally |
| `cloud_poll` printer pointed at the **cloud** (§6) | ✓ polls the cloud, now the acting node | ✗ it lives on the internet |

The middle row — an agent on **something that outlives the box** — is the only single-printer setup that
survives **both** common failures, and it is the chosen default (§3). A venue with **two local boxes**
gets that redundancy for free — but **most venues run a single box**, and their surviving host on box
death is a **till**. That makes the till print-agent (§4c) the **primary** box-death-survival path for
the typical venue, not an optional extra. It is gated, though: the on-device agent it needs **requires a
native app**, so it moves with the go-native decision rather than ahead of it (§4c).

**The uncovered corner (accepted):** box dead **and** internet down *at the same time* → no acting node
is reachable by anything, so nothing prints until one returns. Rare — box death and ISP death are
independent — and it is the honest limit of "try hard, accept we sometimes can't." Closing it would need
a till holding its own local outbox and selling standalone (a far-future "till as standalone node"), out
of scope here. See §7.

## 3. The chosen mechanism — local print agents driving USB/IP printers

**Owner decision (2026-08-26): the primary failover-printing mechanism is USB/IP printers driven by
local print agents that run on **local servers and tills**.** The till matters especially — most venues
run a single box, so a till is their only surviving compute on box death (§4c). That placement — an agent
on more than one surviving host — is what delivers the middle row above. `cloud_poll` printers are
**supported one day but low priority** (§6), not the recommended path.

This is the printing subsystem's existing model, extended by the deltas in §4. Nothing here invents a new subsystem: the agent runtime
(`packages/printing/src/runtime.ts`, a testable pull → push → report batch) already exists; the deltas
change *where an agent may run* and *which printers it may serve*.

**The connection is outbound-only: the agent polls, the server never pushes.** All three legs — pull
(`GET /print-api/agent/jobs`), push to the printer, report (`POST …/result`) — are initiated by the
agent dialing out. That direction is exactly why a **cloud** server works despite the shop's NAT: the
cloud never has to reach into the LAN (which NAT would block,
[topology §5](2026-08-15-distribution-and-client-topology-design.md)) — it only answers connections the
agent opened, the same outbound-only pattern as the sync pull and the relay tunnel. On failover the
agent simply re-aims its outbound poll at the next node in the list (§4b); nothing has to reconfigure to
*reach* the agent, because nothing ever reached it.

## 4. The deltas (against the code now on `feat/printing-subsystem`)

### 4a. Un-pin an IP printer from a single serving agent

**Built today:** `printers.agent_id` is a single bare uuid (`printers.ts:59`); the pull claims only
`p.agent_id = ${agentId}` (`runtime.ts:100`), and that `agent_id` predicate is **both** the routing key
**and** the authorization scope (`runtime.ts:129-131`: *"an agent can only report on jobs served by its
OWN printers"*). So an IP printer is bound to one agent; if that agent's box dies, its printers are
stranded even though any other LAN box could reach them.

**Change:** a `network_tcp` printer becomes servable by a **set of eligible agents** — any active agent
at its location — so a surviving agent (2nd box / till) delivers when the box's agent dies. **USB stays
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
not apply. Land 4a with 4b, not before them. Open: the eligibility model — an explicit `printer_agents`
join table vs. an implicit "any active agent at the location serves `network_tcp`" rule (§10).

### 4b. Agents pull from the till's `[local → cloud]` failover list

An agent walks the **same ordered node list the till uses** (`[primary → secondary → cloud]`,
[failover §8](2026-08-01-local-server-sif-and-failover-design.md); the till-side list is itself spec-only
today, [backlog](../../backlog.md) #8) and pulls from the first reachable node.

**This does *not* require the outbox to be replicated across nodes.** On failover the till fires to the
cloud and the cloud **enqueues into its own outbox**; an agent that has also failed over to pull from
that same node consumes the job it created — creation and delivery happen on **one** acting node. The
printing spec deferred *general* multi-node routing (a job enqueued on A, delivered from B) to
replication ([§4:170-173](2026-08-17-printing-subsystem-design.md)); **failover is the narrower
"everyone converges on one acting node" case**, which is why it lands earlier and cheaper. Jobs queued on
the dead box before it died are stranded — recovered by re-firing from the replicated *order*, not the
outbox (§5).

**Unification:** when the print agent later runs *inside* the till's on-device agent (4c), it shares the
till's **one** failover list and down-detector — no second mechanism, no second copy of the list. A
standalone agent box (a 2nd local server) carries its own copy.

### 4c. A till may host a print agent — *the single-box venue's box-death lifeline (high priority)*

**Owner decision (2026-08-26): high priority.** Most venues run a **single box**, so a till is their
**only** surviving compute on box death — which makes hosting a print agent on the till the primary
box-death-survival path for the typical venue, not an optional extra. (An earlier note this same day
deferred it; corrected once the single-box majority was back in view.)

This makes a **till** one of the runtime's hosts. A browser PWA cannot open a raw socket or USB, so it
requires the till's **native on-device agent**
([topology §2](2026-08-15-distribution-and-client-topology-design.md); **no spec yet**) — the *same*
agent the topology already wants for failover routing and the offline queue, given one more job, not a
new native component. A USB printer plugged into that till, or an IP printer it can reach, then survives
box death for as long as the till is up.

**What actually gates it — the native app.** The on-device agent is not a standalone spec you can just
move up the queue: it **requires a native app** on the till (a browser PWA cannot open a raw socket or
USB), and going native is a **per-OS strategic decision** the topology design frames on its own
([topology §2, PWA-vs-native](2026-08-15-distribution-and-client-topology-design.md)). So the till
print-agent is **parked behind the go-native decision** — high in *importance* (the majority venue's
box-death path) but unable to precede the native app. Until that lands, a single-box venue's only
box-death options are a second box (most won't have) or `cloud_poll` (demoted), so **interim single-box
venues have no till path to box-death printing** — an honest consequence of the native-app gate.

## 5. Delivery guarantee — no job dropped silently

The outbox already *tracks* outcomes — `queued → printing → done` (`delivered_at` set) or `failed`
(`last_error`, `attempts++`), a `failed` job retried to a 5-attempt cap (`print-jobs.ts`, `runtime.ts`).
Tracking is necessary but **not sufficient**: two verified gaps let a kitchen ticket or a bill vanish
unnoticed. And "confirmation of completion" here is **not** a synchronous ack the fire waits on — that
would block the sale (CLAUDE.md §5, never-block). It is an **asynchronous guarantee**: every job reaches
`done`, or a human is **actively told** it did not.

**Gap 1 — a job stuck in `printing` is orphaned forever (VERIFIED, base-subsystem).** The pull selects
only `queued` or `failed` jobs (`runtime.ts:97-104`); a `printing` job is never re-selected, and
`print_jobs` carries **no `claimed_at`/lease column** (`print-jobs.ts`). So an agent that claims a job
(`queued → printing`) and then dies — a crash mid-service, or the box dying while holding the claim —
leaves that job in `printing`, **never retried, never delivered, never flagged.** This drops jobs in
**normal operation**, not only failover, and a boot-time self-reset in the agent loop cannot fix it (a
dead box's agent never boots; the job must move to *another* agent). The `RECLAIM NUANCE` comment
(`runtime.ts:147`) reasons about `failed`-retry idempotency, not this. **Fix — a lease:** stamp
`claimed_at` on claim; a node-side sweep (or the pull predicate itself) returns `printing` jobs older
than a lease (~30–60 s) to retryable. A standard visibility-timeout. **This is a base-subsystem
correctness fix and should land in `feat/printing-subsystem` before it merges** (§9) — not in a later
failover slice, because it drops jobs today.

**At-least-once, deliberately.** The lease reclaim can reprint a job that *did* print but whose `done`
report was lost (the agent died just after the physical print). For a ticket a **duplicate is a nuisance;
a drop is a missed order**, so we choose **at-least-once** and accept the rare duplicate — the opposite
of what a payment would choose. (A per-claim token would tighten it, but the outbox carries none; out of
scope, `runtime.ts:147`.)

**Gap 2 — a terminally `failed` job is only *passively* surfaced.** After the cap a job is `failed` and
appears on the management dashboard's failing-printer surface
([printing §6](2026-08-17-printing-subsystem-design.md)) — which nobody watches during a rush. **Fix —
active escalation to the operator who fired it, at the till/KDS:** *"ticket didn't print — reprint /
acknowledge / hand-write it,"* with the dashboard as the secondary view. This is the human half of the
guarantee and is **Slice-B (KDS) + counter-receipt** work, not the base subsystem.

**Failover re-fire — reconcile from the order, not the outbox.** Jobs stranded `queued`/`printing` on a
dead box do not exist on the acting node, and we deliberately do **not** replicate the outbox (§4b).
Instead the KDS/fire layer on the acting node **re-derives what still needs printing from the replicated
*order* state** (un-acked fires) and re-enqueues — the order is the reliable source, and this is what
"it can be re-fired" (§4b) actually requires. Slice-B territory; flagged here.

**The honest ceiling — `done` ≠ paper in hand.** On a raw `network_tcp`/`usb` printer a successful push
means **the transport accepted the bytes**, not that the ticket physically printed: a printer out of
paper, jammed, or powered off *after* accepting the socket can swallow a job that still reports `done` —
raw ESC/POS returns no printer-side ack. The one transport that **does** confirm physical completion is
**`cloud_poll`**: the CloudPRNT / Server-Direct-Print protocol has the printer signal completion back
after printing (Star's `POST`-poll → `GET`-job → **`DELETE`-complete** leg,
[distribution §16](2026-08-15-distribution-and-client-topology-design.md)) — a genuine point in its
favour despite the demotion (§6). For raw printers, surface printer **health** (paper-out / cover-open,
where the printer reports it via status-back) rather than claim per-job physical confirmation.

## 6. `cloud_poll` printers — supported one day, low priority

**Owner decision (2026-08-26): keep `cloud_poll` on the roadmap but well down the priority list;** local
agents on boxes (and later tills) give more coverage without a hardware dependency. The subsystem already
carries the `cloud_poll` enum value and `poll_*` columns
([printers.ts](2026-08-17-printing-subsystem-design.md)), so enabling it later is an adapter + a poll
endpoint — **no schema change**.

Where it *would* fit, when built: it is the **no-local-compute** route to surviving **box death** — the
printer's firmware dials out and polls, needing no surviving agent at all, and it **confirms physical
completion** (§5). That is its niche (a single-box venue that refuses native code on its tills). Its
ceiling is fixed by the firmware:

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

## 7. The accepted limit

Box dead **and** internet down simultaneously: no node is reachable, nothing prints until one returns.
We do not engineer around this — it is two independent failures at once, and the only fix (a till that
holds its own outbox and sells fully standalone) is a far-future capability that turns a till into a
node. Documented so a venue knows it, not hidden.

## 8. Cross-cutting: split-brain (bigger than printing)

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

## 9. Sequencing / dependencies

- **Build-now, in the base branch (correctness):** the **lease reclaim** for stuck `printing` jobs
  (§5, Gap 1). It drops jobs today, in normal operation, so it is not a failover follow-on — it should
  land in `feat/printing-subsystem` **before merge**, with a test that a job whose claimer never reports
  is reclaimed and delivered (proven by deletion of the reclaim). Everything below stays off that branch.
- **Two-box venues** are covered by print agents on **local servers** (4a un-pin + 4b node list) — a
  second box gives box-death redundancy for free.
- **Single-box venues are the majority**, and their box-death printing survival comes from **4c** (a
  till hosting the agent) — high *importance*. But 4c gates on the **on-device agent**, which **requires
  a native app**; going native is a separate per-OS decision (topology §2). So 4c is **parked behind the
  go-native decision**, not a near-term build — interim single-box venues rely on a second box or
  `cloud_poll` for box-death printing, or accept the gap (§2).
- **4a** (un-pin) lands with 4b, carrying a distinct-agents race test + a security-review of the
  location-scoped authz.
- **4b** (agent failover list) depends on the **till-side failover list** (spec-only) and a cloud node.
- **Gap 2 escalation + order-derived re-fire** (§5) — **Slice-B (KDS) + counter-receipt** work.
- **`cloud_poll`** — low priority; no schema change to enable.

Order in practice: the lease is the only build-now item, and it belongs in the base branch. 4a/4b
(agents on local servers + the shared failover list) are the next printing-specific follow-ons; the till
path (4c) waits behind the **go-native decision** (via the on-device agent), so it advances only when
that does. No implementation plan is written for the follow-ons now.

## 10. Open questions

- **Un-pin eligibility model (4a):** explicit `printer_agents` join table (per-printer allow-list) vs.
  implicit "any active agent at the location serves `network_tcp`". The join table is more config but
  auditable; the implicit rule is less config but widens the authz boundary silently.
- **Lease duration + sweep home (§5):** the reclaim window (~30–60 s), and whether the sweep is a
  separate tick or folded into the pull predicate (`status='printing' AND claimed_at < now()-lease` made
  eligible). Long enough not to reclaim a slow-but-live push; short enough that a real drop is caught
  within a service.
- **Agent node-down detection (4b):** reuse the till's "N consecutive failures then fail over"
  ([topology §3](2026-08-15-distribution-and-client-topology-design.md)) verbatim, or a printing-specific
  threshold? Default: reuse, especially when co-hosted in the till's agent.
- **Epson "forwarding"** (§6) — printer-to-printer vs. server-URL — to confirm from the manual before any
  reliance.
- **Split-brain** (§8) — its own design, tracked separately.

**Delivery latency (decided-deferred).** Plain short-interval polling (1–2 s) is sufficient for
receipts and kitchen tickets and is what ships first — the never-block guarantee is about *enqueue*, and
a sub-2 s gap before a ticket prints is invisible. If a tighter bound is ever wanted, add a **doorbell
over the same pull endpoint**: a notification that only says *"pull now"* (**SSE preferred over
WebSockets** — server→agent only, plain HTTP, auto-reconnect; WebSockets add a bidirectional channel this
use has no need for), with **the pull staying the source of truth** so the atomic claim, never-block and
single-writer guarantees are untouched, and it **degrades to polling** if the doorbell drops. The
**dedicated single-tenant server** ([failover §9](2026-08-01-local-server-sif-and-failover-design.md))
keeps this cheap — enqueue and the held connection share one process, so no cross-instance pub/sub
(Redis / `LISTEN`-`NOTIFY`) is needed. **Non-breaking to add later**; the only thing to hold to now is
that the pull endpoint is authoritative and any notify channel is a hint over it.

## 11. Provenance

Designed 2026-08-26 against the live tree and the in-flight `feat/printing-subsystem` branch.

**Internal (file:line):** the built single-agent binding + pull scope + authz —
`packages/db/src/schema/printers.ts:59`, `packages/printing/src/runtime.ts:100,104,129-131`,
`packages/printing/src/runtime.race.test.ts` (same-agent race only); the outbox status lifecycle, the
`queued`/`failed`-only pull, the absent lease column, and the `RECLAIM NUANCE` (failed-retry, not
stuck-`printing`) — `packages/db/src/schema/print-jobs.ts` (no `claimed_at`),
`packages/printing/src/runtime.ts:97-104,147`; the outbox + never-block + deferred multi-node routing —
[printing subsystem design](2026-08-17-printing-subsystem-design.md) §3c, §4:170-173, §3e, §6 (dashboard
failing-printer surface); the failover list + new-chain-on-partition —
[local-server SIF + failover design](2026-08-01-local-server-sif-and-failover-design.md) §8; the
on-device agent + PWA-vs-native native-app cost, the browser-cannot-raw-socket + poll-the-cloud rows,
and CloudPRNT `DELETE`-complete —
[distribution/client-topology design](2026-08-15-distribution-and-client-topology-design.md) §2
(agent + native), §5 (bridge / NAT, :262-289), §16; the tunnel is the path *to* the box, not a failover
path —
[management dashboard design](2026-08-07-management-dashboard-design.md) §5 (T1 blind tunnel, T3
read-mirror); pre-production drop-recreate / no backfill — CLAUDE.md §3.

**External (vendor, quoted per CLAUDE.md §1):**

| Claim | Source | The source's words |
| --- | --- | --- |
| Star CloudPRNT polls a single self-hosted URL, no failover URL | [Star CloudPRNT Protocol Guide — Client Settings](https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/client.html); [Developer Guide IFBD-HI01X](https://www.starmicronics.com/support/Mannualfolder/IFBD-HI01X_CloudPRNT_for_Developer.pdf) | single **"Server URL (required)"**: *"Set a URL to be polled by the client at a certain interval through HTTP POST"*; no backup/secondary field present |
| Epson Server Direct Print polls a single server URL | [Epson SDP User's Manual M00062910 Rev.K](https://files.support.epson.com/pdf/pos/bulk/server_direct_print_um_en_revk.pdf); [POS Cafe SDP guide](https://poscafe.app/blogs/knowledgebase-order-tickets-kds/epson-server-direct-print) | a single server **"URL"** field; no backup-URL field surfaced (PDF would not render for direct reading — treat the *forwarding* nuance in §6 as unverified) |
