# Printing subsystem — central-managed printers, distributed agents, transport-pluggable

**Date:** 2026-08-17. **Status:** design (approved section-by-section with the owner); plan alongside.
**Track:** foundational infra (a new sub-project), the first of a two-slice **kitchen-printers** ask:
**Slice A** (this) is the printing subsystem; **Slice B** ([KDS-4 kitchen printing](2026-08-17-kds-4-kitchen-printing-design.md))
routes stations to printers on top. **Runs SUPERVISED**. **Hardware-touching** (the first real peripheral
in the tree). Largely **independent** of the table-service track — printing is shared infra that KDS
kitchen tickets, and later customer-receipt printing + the cash drawer, all consume.

**There is no printing of any kind in the tree today** — the customer receipt is a screen-only Lit
component (`apps/till/src/screens/till-ticket-view.ts`), and a whole-repo grep found **zero**
ESC/POS / thermal / network-print / print-agent code or config. The deli-hardware design
(`docs/superpowers/specs/2026-07-30-deli-hardware-design.md` §6) **specifies but never built** a
`ReceiptPrinter` = **ESC/POS over TCP:9100, driven by the on-prem server** (a browser PWA cannot open a
raw socket — distribution design `:262-271`); the one existing hardware device, the card reader, is
driven **server-side / via a server-minted token, never from the browser**. This subsystem realizes that
peripheral seam, generalised to the topology the owner requires.

## 0. Owner decisions this subsystem is built on (2026-08-17)

- **Three transport types**, one abstraction: `usb`, `network_tcp` (local IP, ESC/POS over :9100), and
  `cloud_poll` (Star **CloudPRNT** / Epson **Server Direct Print** — the printer firmware dials out and
  polls for jobs). **Build the two local transports first** (`usb` + `network_tcp`); the abstraction
  carries `cloud_poll` from day one, its adapter is a **fast-follow**.
- **Central management, distributed execution.** All config, the outbox, and status are **central** (one
  dashboard), even though the actual printing runs on **local print agents** — e.g. the on-prem box, or a
  separate box a USB printer is plugged into.
- **A print agent** = a local process that **enrols and is managed centrally** (a pairing code, revocable
  — reusing the device-identity **crypto/pairing primitives** but its **own** `print_agents` table, since
  it binds to printers not stations), **pulls** its printers' jobs from the central outbox (dialing
  **outbound** — NAT-friendly, matching the on-prem-always-dials topology), **pushes** to the physical
  printer, and **reports** status back.
- **Delivery decoupled from creation via an outbox** — so any node (**local or cloud**) can enqueue a
  job and the right agent (or a self-polling `cloud_poll` printer) delivers it. **Printing must never
  block a fire or a sale** (CLAUDE.md §5) — the outbox is that guarantee.

## 1. Scope

**In:** `print_agents` (+ pairing-code enrolment/auth, central revoke); `printers` config (transport +
serving agent + connection + `ticket_scope` + active); a `print_jobs` **outbox** + `enqueuePrintJob`; the
**agent runtime** (a pull→push→report loop) with the **`usb` + `network_tcp`** transports behind a
fake-sink-testable interface; a reusable **ESC/POS builder**; the agent HTTP API (device-authed pull +
report); a **dashboard** central-management surface (agents, printers, live status); retry + the
never-block invariant.

**Out:** the **`cloud_poll`** transport adapter + its poll endpoint (fast-follow — the abstraction is
built for it); **KDS station→printer routing + kitchen-ticket formatting** (Slice B); **customer-receipt
printing + the cash-drawer kick** (later consumers of this subsystem); the **multi-node sync** of the
outbox (single-node works now; §4); real-printer verification (manual, per the deli-hardware approach).

## 2. Data model

All non-fiscal, pre-production (**no backfill**). Tenant + location scoped.

### 2a. `print_agents` (+ `print_agent_pairing_codes`)

Modelled on the device-identity design (its own tables, its `hashSecret`/`verifySecret` scrypt token,
its WebAuthn-challenge-style single-use TTL pairing code — see
[device identity-1](2026-08-17-device-identity-1-station-enrolment-design.md) §2), because a print agent
is the same "enrol a trusted local box centrally, revoke it centrally" problem, just bound to printers.

```text
print_agents
------------
id, tenant_id, location_id, name, token_hash (scrypt), active (revoke),
enrolled_at, last_seen_at                        UNIQUE (tenant_id, id)

print_agent_pairing_codes
-------------------------
id, tenant_id, location_id, code_sha256 (indexed, high-entropy), label, created_at   -- single-use, TTL-from-created_at
```

FORCE RLS + policies + grants (custom migration; `SELECT,INSERT,UPDATE` on agents, `SELECT,INSERT,DELETE`
on pairing codes for single-use redemption). Enumerated by `inmutabilidad`.

### 2b. `printers`

```text
printers
--------
id, tenant_id, location_id
name           text NOT NULL
transport      print_transport NOT NULL     -- pgEnum ['usb','network_tcp','cloud_poll']
agent_id       uuid NULL  composite FK (tenant_id, agent_id) → print_agents   -- usb/network_tcp (null for cloud_poll)
host           text NULL      -- network_tcp
port           int  NULL      -- network_tcp (default 9100)
usb_path       text NULL      -- usb (device identifier on the agent's box)
poll_id        text NULL      -- cloud_poll (the printer's poll identifier)
poll_token_hash text NULL     -- cloud_poll (scrypt; the printer authenticates its poll)
ticket_scope   print_ticket_scope NOT NULL DEFAULT 'station'   -- pgEnum ['station','order'] (consumed by Slice B)
active         bool NOT NULL DEFAULT true    UNIQUE (tenant_id, id)
```

A CHECK (or app validation) that the transport's required fields are present (`agent_id`+`usb_path` for
usb; `agent_id`+`host` for network_tcp; `poll_id` for cloud_poll). FORCE RLS + grants.

### 2c. `print_jobs` (the outbox)

```text
print_jobs
----------
id, tenant_id, location_id
printer_id     uuid  composite FK (tenant_id, printer_id) → printers
payload        bytea NOT NULL       -- OPAQUE bytes (Slice B fills with ESC/POS; the subsystem never inspects them)
status         print_job_status NOT NULL DEFAULT 'queued'   -- pgEnum ['queued','printing','done','failed']
attempts       int NOT NULL DEFAULT 0
last_error     text NULL
created_at     timestamptz NOT NULL DEFAULT now()
delivered_at   timestamptz NULL
INDEX (tenant_id, printer_id, status)       -- the agent's pull scan
```

FORCE RLS + grants. **Built single-writer-per-row** (memory: replication is shared infra) — see §4.

## 3. Behaviour

### 3a. Agent enrolment + auth (reuse device-identity primitives)

Central: `POST /management-api/print-agents/codes` (`printer.manage`, §7) → a high-entropy pairing code
(shown once). Agent: `POST /print-api/agent/enrol { code }` → single-use redeem (locking
`DELETE … RETURNING`, TTL), mint a scrypt-hashed token, return it (the agent stores it). `requireAgent`
(a Bearer guard, the `sync-api.ts:80-88` constant-time shape, verified via `verifySecret`) authenticates
the pull/report calls; a revoked (`active=false`) agent fails instantly. **No new crypto** —
`hashSecret`/`verifySecret`/`randomBytes`/`sha256`/`timingSafeEqual`.

### 3b. Enqueue (the never-block guarantee)

`enqueuePrintJob(tx, cfg, printerId, payload: Uint8Array) → { jobId }` — a single INSERT (`queued`).
**That is all a caller does** — it never opens a socket, never waits on hardware, so a fire/sale is never
blocked by a printer (CLAUDE.md §5). Any node (local or cloud) may enqueue.

### 3c. The agent runtime (pull → push → report)

A deployable process (the on-prem server can host it; a separate box runs a standalone copy). Its loop,
per its printers (`usb`/`network_tcp` only — `cloud_poll` self-polls, §3e):

1. **pull** — `GET /print-api/agent/jobs` (`requireAgent`) → the `queued` jobs for the agent's printers,
   atomically marked `printing` (a locking `UPDATE … RETURNING`, so two agent instances don't double-print).
2. **push** — write `payload` to the printer via the transport adapter:
   - `network_tcp`: open a TCP socket to `host:port` (default 9100), write bytes, close (the
     deli-hardware `ReceiptPrinter`).
   - `usb`: write bytes to `usb_path` on the agent's box.
   Both sit behind a **`Transport.send(printer, bytes)`** interface with a **byte-capturing fake sink**
   for tests (the deli-hardware verification approach; real hardware is manual).
3. **report** — `POST /print-api/agent/jobs/:id/result { status: 'done'|'failed', error? }` → set
   `status`/`delivered_at`/`last_error`, `attempts++`. A `failed` job is retried (bounded backoff); a
   down printer never stalls the queue for other printers.

### 3d. ESC/POS builder (`@waitron/printing`)

A small, reusable command builder — `init`, `text`, `line`, `feed`, `cut`, and the **cash-drawer kick**
sequence (deli-hardware §6: the drawer is a printer capability) — producing the `payload` bytes.
Slice B (and later the receipt/drawer consumers) use it; the subsystem itself only moves bytes.

### 3e. `cloud_poll` (fast-follow, designed-for)

A `cloud_poll` printer has no agent; its firmware polls a vendor endpoint (`GET /print-api/cloudprnt/:pollId`,
authenticated by `poll_token_hash`) that returns a `queued` job in the vendor format + accepts a status
POST. Built next; the enum value, the `poll_*` columns, and the outbox already carry it.

## 4. Topology — central management, local/cloud routing, sync

- **Central**: `print_agents`, `printers`, `print_jobs`, and status all live centrally and are managed in
  the **one dashboard** (§6). Execution is distributed across agents.
- **Outbound-only agents**: an agent **pulls** (dials out) — it never accepts an inbound connection, so it
  works behind NAT on any local box (matching the on-prem-always-dials-out topology, memory
  [[sync-cloud-mirror-connection-direction]]).
- **Local or cloud**: because delivery is decoupled via the outbox, a job enqueued on the **cloud** node
  is delivered by the **local** agent that pulls it (and vice-versa); a `cloud_poll` printer self-delivers
  regardless of node. **Single-node venues work today** (one node, one outbox). Full multi-node routing
  lands when the **app-level replication** does (a deferred subsystem) — so `print_jobs` is built
  **single-writer-per-row**: the enqueuer owns creation; the delivery transition (`printing`→`done/failed`)
  is owned by the pulling path. The plan states the ownership precisely; it does not build replication.

## 5. Fiscal safety (H2)

**None** — but the **never-block invariant is load-bearing** (CLAUDE.md §5): enqueue is a single INSERT,
all hardware I/O is the async agent loop, so a slow/broken/absent printer can **never** delay a fire or a
sale. A test pins that `enqueuePrintJob` performs no network I/O and returns without contacting a printer.
Nothing touches `record-sale.ts` / the alta builders (grep receipt).

## 6. Client — dashboard central management (`apps/dashboard`)

A **Impresoras** (Printers) surface (list+form pattern): **agents** (enrol via a pairing code shown once ·
revoke · last-seen), **printers** (name · transport · serving agent · connection fields · `ticket_scope` ·
active · a **test-print** button that enqueues a known payload), and **live job/printer status** (last
delivered, failing printers). `printer.manage`-gated; `@waitron/ui`; both-theme a11y. `DashboardApi` gains
the agent/printer/job methods.

## 7. Conventions

- **English identifiers** — `print_agents`, `printers`, `print_jobs`, `print_transport`, `usb_path`,
  `poll_id`, `ticket_scope`, `print_ticket_scope`, `print_job_status`. No new `SPANISH_WORDS`; UI copy en/es
  ("Impresora", "Imprimir").
- **Domain error codes** — `printer.not_found`, `printer.invalid_config`, `agent.not_found`,
  `agent.unauthorized`, `agent.pairing_invalid`/`_expired`. `import "./errors.js"`. Never renamed.
- **Permission** — a new **`printer.manage`** (admin + manager, mirroring `purchase.manage`); the agent
  API is device-authed (`requireAgent`), not permission-gated. **Churn:** update `permissions.test.ts`.
- **Reuse crypto, write none** — `hashSecret`/`verifySecret`, `timingSafeEqual`, `randomBytes`, `sha256`.
- **Security review before build** — an agent-auth + outbox subsystem; a review pass (the `security-review`
  skill) precedes merge.
- No backwards-compat / data-migration code (pre-production).

## 8. Testing

- **Real Postgres** — RLS on all four tables (by deletion) + negative `WITH CHECK`; the pairing single-use
  race (concurrent redeem → one agent); the pull `UPDATE … RETURNING` **double-pull race** (two agent
  instances → each job delivered once, proven by deletion of the lock); a revoked agent fails
  `requireAgent`; `inmutabilidad` green.
- **PGlite / unit** — `enqueuePrintJob` INSERTs a `queued` job and does **no I/O** (the never-block
  assertion); the agent loop pulls→pushes to a **byte-capturing fake sink**→reports (asserting the exact
  bytes reach the sink); `failed` retries with backoff; a down printer doesn't block another's queue; the
  ESC/POS builder emits the expected command bytes (init/text/cut/kick).
- **Security** — the agent token is never returned except once at enrol / never logged; `verifySecret` used
  (no `===`); revoke is immediate. The `security-review` pass (§7) runs before merge.
- **Dashboard** — agents enrol (code shown once) + revoke; printers CRUD incl. `printer.invalid_config`
  (missing transport fields); the test-print enqueues; status renders. `.a11y` both themes.
- **Fiscal** — the H2 grep + the never-block test.
- Coverage **98/98/98/95** (db, server, `@waitron/printing`), **95/95/90/88** (dashboard). Run
  `packages/db` unfiltered; `TESTCONTAINERS_RYUK_DISABLED=true` locally.

## 9. Sequencing / dependencies

- **Largely independent** — needs `locations`/`persons`, the crypto primitives (`secret-hash.ts`, which
  exist), the route-mount + cookie/bearer patterns, and `@waitron/ui`. It does **not** need the
  table-service track, so it can build early. (It shares device-identity's crypto *pattern* but not its
  tables, so it does **not** inherit device-identity's KDS-1 dependency.)
- **Consumers**: **Slice B** (KDS kitchen printing) and later **customer-receipt printing** + the
  **cash-drawer** kick sit on this. `cloud_poll` is the immediate fast-follow.
- **Replication**: the outbox fully routes across nodes once app-level replication lands; single-node
  works now.

## 10. Provenance

Designed against the live tree on 2026-08-17 via the deli-hardware + distribution + device-identity
grounding (cited): the receipt is screen-only (`till-ticket-view.ts:84-319`), **no** print code anywhere
(whole-repo grep); the ESC/POS-over-TCP:9100 + on-prem-server + fake-sink recommendation (deli-hardware
`:21,151-161`); the browser-cannot-raw-socket + three-bridge topology (distribution `:250-291`); the card
reader as the server-side/token hardware precedent (`packages/payments-stripe/src/device-provider.ts:107-110`);
the reusable crypto/pairing primitives (`packages/identity/src/secret-hash.ts:24-48`, `passkey.ts:49-93`,
`sync-api.ts:80-88`); the permission list (`permissions.ts:7-57`); the route-mount pattern (`boot.ts:340-394`).
The `cloud_poll` vendor protocols (Star CloudPRNT / Epson Server Direct Print) and the multi-node outbox
sync are named as future/fast-follow, to be grounded when built (CLAUDE.md §1).
