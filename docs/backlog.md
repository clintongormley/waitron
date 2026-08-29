# Backlog — what to work on next, and why

This file answers **"what should I work on?"** It is state, not history: what is built (one line each),
what is open, and the order to take it in. The git log, the PR threads, and the committed
specs/plans in `docs/superpowers/` hold the detail — do not paste receipts back in here.

> **Decluttered 2026-08-26.** The previous version had grown to ~1,800 lines: a 78-entry "Recently
> shipped" wall of per-PR proof-of-work, plus "LANDED #XX" narrative and fiscal-firewall/test-count
> receipts on every open item. All of that is in git history (`git log`, the linked specs, the PR
> threads). This rewrite keeps only what is useful for picking up the next piece of work.

**Companion documents, not duplicated here:**

- **[compliance/action-plan.md](compliance/action-plan.md)** — the legal/administrative track
  (certificates, company formation, the declaración responsable).
- **[compliance/asesor-questions.md](compliance/asesor-questions.md)** — the fiscal-advisor question
  list (see *The advisor gap*).
- **[compliance/asesor-laboral-questions.md](compliance/asesor-laboral-questions.md)** — the
  labour/payroll question list, for a *graduado social / gestoría* (see *The advisor gap*).
- **[superpowers/specs/2026-07-18-pos-architecture-design.md](superpowers/specs/2026-07-18-pos-architecture-design.md)
  §2** — the twenty numbered sub-projects (the strategy; changes rarely).

**Docs land direct to `main`** (2026-08-02): the `main protection` ruleset grants Repository-admin a
bypass, so a docs-only change is pushed straight to `main` — no PR, no CI wait. Branch, `commit -s`,
fast-forward `main`, push. Feature/code still goes through a PR.

**Prioritisation is by soundness, not the calendar** (2026-08-02): Waitron will be finished before the
deli must trade, so the 1-Jan-2027 deadline does not rank one piece above another. Order by
**dependency, correctness, and de-risking the most-reused / most-uncertain foundations first**.
**Never autonomously land anything touching the unrepairable fiscal core (H2)** — hash-chained
records, never-reused invoice numbers.

---

## Priorities (reprioritised 2026-08-26)

One ranked list. **1–5 are the owner-chosen top tier** (2026-08-26); **6–8 are next**; smaller items
follow.

> **Elevated 2026-08-26 (owner): appliance onboarding — free tier (in-repo, no cloud/hardware) — is
> the current *build* focus, ahead of the numbered tier below.** Slices **1a (serve the built SPAs,
> #137) and 1b (setup-mode boot, #139) both LANDED 2026-08-26**. **Slice 2 was split into 2a/2b/2c;
> 2a (self-signed CA/leaf + persisted box secrets) LANDED #141 and 2b (the `/setup-api/provision`
> endpoint — stamp demo/live + `applyVenue` in-process, seal the AEAT cert for live, persist
> `trading.env`, restart into trading) LANDED #142, both 2026-08-27; **slice 2c (the `apps/setup`
> Vite+Lit wizard driving 2b's endpoint) LANDED #146** and **slice 3 (discovery + CA-serving) LANDED
> #143** — the free-tier onboarding path (slices 1–3) is now complete; **next → slice 4** (backup /
> status / break-glass). NB 2b is **venue-only** (deviation R1): it stamps +
> `applyVenue`s into the already-migrated setup DB and does NOT run the full `instance` role-splitting —
> deferred to the appliance-image slice (the DB/roles pre-exist; dev works on the superuser). Rationale:
> it is the one deployment path that needs
> **neither cloud infrastructure nor final hardware** (in-repo, runs on any Node+Postgres host incl. a
> laptop; pure app code) and it unblocks the appliance regardless — whereas the cloud trial (#5),
> sync's cloud-mirror leg (#2), and the appliance *paid* tier all wait on a "Waitron cloud" that **does
> not exist yet** (verified 2026-08-26: no Dockerfile / deploy job / hosting / domain; `apps/server`
> has no container or `start`). #1 (engage a fiscal advisor) is a parallel *human* task, not a
> competing build. The appliance's firmware / OS-image / paid-tier slices (5–7) stay under #8. Spec:
> [appliance-onboarding](superpowers/specs/2026-08-26-appliance-onboarding-design.md).

1. **Engage a fiscal advisor.** Long lead time and it gates fiscal decisions, so start now. The task
   is not just "engage someone": first re-read the whole question list against the current
   (server-as-SIF + cloud) architecture, drop/rewrite what it invalidated, add the questions those
   designs raise, *then* engage. Q14 (precuenta) is still open. See *The advisor gap*.
2. **Sync completion** — cloud-mirror peer + multi-tenant transport + the deferred fiscal-lane
   (H2). Most-reused infra; needs a fresh design pass; the fiscal-lane is the riskiest, owner-gated
   piece. See *Open threads → Sync*.
3. **Reporting fiscal remainder** — rectificativas boxes (40/41), the prorrata rule (44),
   intra-community/import boxes (32–39), plus the two pre-filing caveats a human must clear.
4. **Printing + hardware surface** — the **printing subsystem is built** (agents/printers/outbox/
   runtime/`usb`+`network_tcp` transports/ESC/POS/dashboard, security-reviewed), and so are its
   **kitchen** (KDS-4), **counter-receipt + cash-drawer**, and **cash-drawer authorization**
   consumers. Remaining on the track: `cloud_poll` transports (fast-follow), the expo device kind.
   Real deli hardware need; mechanical.
5. **Cloud trial on-ramp** — the distribution design's zero-hardware demo path (today's same-origin
   PWA pointed at a cloud instance). **Least new *application* code, but not infra-cheap:** there is
   **no cloud / deploy / hosting / domain infrastructure yet** (verified 2026-08-26 — no Dockerfile,
   no deploy job, `apps/server` has no container or `start`), so it is gated on standing up
   first-time Waitron-cloud infra (host + deploy + DNS + TLS + demo-tenant provisioning), plus
   signup/billing for a self-serve version. Buildable in preproduction *once that exists*; that cloud
   infra is shared with sync's cloud-mirror (#2) and the appliance paid tier.
6. **Recipes → stock → procurement** (sub-projects 18→20) — the linchpin greenfield chain: nested
   sub-recipes, plate costing, stock depletion per sale, then inventory + suppliers/POs/goods-in/
   3-way reconcile/reorder.
7. **Table-service completion** — TS-5 split-bill (the one fiscal TS slice, supervised/owner-gated),
   Bookings-1, device-scoped fire/collect routes, the expo device kind, the cloud-poll printing
   transports (Star/Epson).
8. **Distribution / deployment / failover remainder** — identity-config flow-down, the on-device
   agent, the appliance image + AP-mode onboarding, the reroute; SIF promotion/fencing + till-side
   failover.

**Later / smaller:** SumUp card provider · D3 payroll export (integrate-not-build) · accounting
export (SP17) · opening hours & channel sync (SP19) · tip payroll (SP13) · online ordering (SP15) ·
the owner-added table-service extensions (per-seat ordering; multiple tabs per table — both reopen
settled TS/KDS decisions, so specced-with-owner, never landed unattended).

**Cloud services — parked for later review (north star, not yet ranked).** The
[cloud-services inventory](superpowers/specs/2026-08-29-cloud-services-inventory.md) catalogues the
paid cloud offering we are building *towards* (the local-first-core + cloud model) and the decision
rules for what belongs in cloud vs. the open-source ELv2 core (online-only-by-nature **or**
bulk-cost economics; everything else is core, and we do not fight the community for a core feature).
**Cloud features come later** — no Waitron-cloud infra exists yet (gates #5 and sync #2) — but the
inventory records the target so on-prem work is built toward it (e.g. single-writer-per-row for sync,
"make the box reachable" as one capability). **Review/prioritise into real slices when cloud work
starts.**

---

## What's built (state per sub-project)

Architecture §2's twenty sub-projects, plus the cross-cutting infra. "Remaining" is the unstarted or
partial scope; the detail for a live thread is under *Open threads*.

| # | Sub-project | State | Remaining |
| --- | --- | --- | --- |
| 1 | Design system | `@waitron/ui` token layer + primitives (`--wt-*`) | — |
| 2 | Sales spine | Immutable hash-chained sales, per-tenant series, catalogue, tenant model | — |
| 3 | Fiscal layer | Verifactu lib + `FiscalBackend`; settlement, R5 rectificativas, F3 canje, invoice-first | F3 asesor/XSD confirmations (Debt) |
| 4 | Payment layer | `PaymentProvider` + Stripe Terminal, manual card, integrated Stripe, Mode-3 webhook (security) | SumUp provider; webhook `recordSale` hand-off; reconcile remediation UI |
| 5 | Identity | persons/sessions, PIN, `authorize()`, roles/permissions, passkeys | mid-shift-suspension enforce, discount gate, till-refund enforce; **encrypt `totp_secret` at rest** |
| 6 | Locations | provision-a-sellable-venue (`waitron-provision venue`) | multiple locations, edit/deactivate; then location-scope the by-id verb family (Debt) |
| 7 | Counter POS | walk-up cash, park/retrieve, manual + integrated card, prepare & collect, layout/receipt editors, receipt/drawer **printing**, cash-drawer **authorization** — operable end to end | — |
| 8 | Reporting | daily close, frozen *cierre Z* (VAT-exact + hash chain + *descuadre*), VAT summary, modelo 303 output+input VAT, DR303 file + download route, purchase-invoice UI | **fiscal remainder (top-tier #3)** |
| 9 | Deployment | distribution & client-topology design (#86) | **cloud trial on-ramp (#5)** + agent/appliance/reroute (#8) |
| 10 | Tabs / table service | TS-1 tables+tabs, TS-2 statuses, TS-3 move/join/merge, TS-4 transfer | **TS-5 split-bill** (fiscal) |
| 11 | Floor plan | FP-1 live floor + FP-2 spatial canvas/editor — complete | — |
| 12 | KDS | KDS-1 stations/routing/tickets, KDS-2 courses/fire, KDS-3 expo, KDS-4 kitchen printing; device identity-1 | expo device kind; device-scoped fire/collect routes (Debt) |
| 13 | Tips | attribution done (tip on `tenders`) | payroll export (integrate-not-build); card-tips-as-income is a payroll duty |
| 14 | Bookings | Bookings-1 specced + planned | **build it** (part of #7) |
| 15 | Online ordering | — | not started (Later phase) |
| 16 | Workforce | *registro de jornada*, D2 scheduling, roster authoring + approvals, staff request path + portal | D3 payroll export (integrate-not-build) |
| 17 | Accounting export | — | not started (core subset; extends Reporting) |
| 18 | Menu/recipes/allergens | EU-14 allergens, recipe/BOM allergen-inheritance, recipe-authoring UI | **nested sub-recipes, plate costing, stock depletion (#6)** |
| 19 | Opening hours & channel sync | — | not started (Google Business Profile / Maps) |
| 20 | Procurement & inventory | received purchase invoices (`@waitron/purchasing`, feeds modelo 303) | **suppliers/POs/goods-in/stock/3-way reconcile/reorder (#6)**; AI forecast deferred |

**Cross-cutting infra:** sync/replication (outbox + transport + payments fast lane + per-peer
`sync_peers` auth + retention — see *Open threads → Sync*) · SIF topology (`#33`, `node_id` re-key — see *SIF
topology follow-ups*) · device identity-1 · printing subsystem (`@waitron/printing` —
agents/outbox/`usb`+`network_tcp` transports/ESC/POS/Impresoras dashboard) · CI/test infra (scoped CI,
pre-push hook, shared-container test rollout, job-sharding).

---

## Open threads (detail)

### Sync completion (top-tier #2)

Mechanism is decided and slices 1–3 + ops have landed: cross-replication is **application-level** (an
outbox — `sync_log` + a generic capture trigger, apply as the app role under `withTenant`), **not**
native Postgres logical replication (which refuses to write an RLS table under a non-BYPASSRLS role).
Built: commercial-lane outbox, symmetric HTTP-pull transport + **per-peer `sync_peers` auth (#144)**,
payments fast lane, retention sweep + explicit `waitron-sync-evict`. Design +
findings: [app-level-sync](superpowers/specs/2026-08-02-app-level-sync-design.md),
[force-RLS prototype](superpowers/specs/2026-08-02-replication-force-rls-prototype-findings.md),
[container gates](superpowers/specs/2026-08-06-sync-container-gates-findings.md).

The cloud-mirror is three sub-projects (A identity/auth · B outbound tunnel · C cloud read-mirror),
to be proven against a local stand-in cloud. Spec + plan:
[cloud-mirror-peer-identity](superpowers/specs/2026-08-27-sync-cloud-mirror-peer-identity-design.md).

**Remaining, each its own design pass:**

- **Cloud-mirror peer — sub-project A (per-peer identity & auth) LANDED (#144).** Closed the
  `POST /sync-api/cursor` forge gap (under the shared node token any holder could advance any
  subscriber's cursor → silent retention data loss): a DB-backed `sync_peers` registry gives each peer
  its own scrypt bearer token, the source derives `subscriberId` from the token (body field dropped),
  and the shared `WAITRON_SYNC_NODE_TOKEN` is fully retired. `waitron-sync-peer` CLI for enrol/revoke/list.
  Deferred minor: `enrolPeer` doesn't validate non-empty `subscriberId`/`name` at the core (only the
  CLI guards; no reachable gap today).
- **B — outbound tunnel. LANDED (#150).** Inverts the transport: the NAT'd box dials out to a relay
  that blindly splices the cloud's TLS connection to a pooled box-initiated connection, and the box
  proxies to its own HTTPS sync-api — TLS end-to-end, so the relay sees only ciphertext. New
  `@waitron/tunnel` package (`runTunnelClient` + a local relay stand-in), a cloud-side `tunnelHttpClient`
  (dials the relay, validates the box cert via SNI+CA), `loadTunnelConfig` (`WAITRON_TUNNEL_*`,
  fail-closed), guarded boot wiring, and a real-PG e2e proving the cloud pulls through the tunnel while
  the relay stays blind. `runSyncPull` + A's per-peer token unchanged. Spec + plan:
  [cloud-mirror-tunnel](superpowers/specs/2026-08-27-sync-cloud-mirror-tunnel-design.md). Proven against
  a **local relay stand-in** (no cloud hosting/DNS/TLS yet).
  **Deferred to the real T1 relay/client (spec §11), all within B's semi-trusted-relay threat model and
  each self-healing or fail-closed today:** the symmetric box→relay control-frame splice race (a pre-`go`
  `ping` can leak into the cloud's TLS handshake — rare, self-heals via sync retry, no data loss, no
  secret leaked); a max pre-`go` frame-length guard (a newline-less stream grows the client buffer
  unbounded); ignore-`go`-before-`ack`; a registration/handshake timeout (a relay that accepts but never
  `ack`/`reject`/closes parks a pool slot until abort); and a `tunnelHttpClient` disposal seam for C's
  long-running subscriber. SNI-based multi-box routing is also T1's (the stand-in serves one box).
- **C — cloud read-mirror.** Split (owner, 2026-08-27) into **C1 — the `dining_tables` FK-closure
  enrolment — LANDED (#153)** and **C2 — the mirror-mode server**, itself split (owner, 2026-08-28) into
  **C2a — the runtime mechanism — LANDED (#155)** and **C2b — the operator flow — next**.
  - **C1 LANDED (#153).** Enrolled the runtime-mutable FK closure — `dining_tables`, `floor_zones`,
    `table_service_statuses` — into the commercial **ordered** lane (a new mutable / no-watermark /
    no-delete registry shape), renumbered `fkRank` to place `dining_tables` above `working_orders`
    while breaking the `dining_tables ↔ working_orders` cycle at the `tab_id` back-edge, added the
    `0006` echo-gated capture triggers (no new grants), and a **proven-by-deletion** real-PG apply gate
    (plus a settle-cascade test for the `0050` `working_orders → dining_tables` status-clear). This
    closed the ordered-lane hard gate below. Spec + plan:
    [c1-enrolment](superpowers/specs/2026-08-27-sync-cloud-mirror-c1-enrolment-design.md).
  - **C2a — the mirror-mode server mechanism. LANDED (#155).** A third boot path of `apps/server` keyed
    on a new `deployment.mode` (`primary`|`mirror`, migration `0069`, runtime-read from a refreshable
    holder): a mirror pulls the 17 commercial tables through B's `tunnelHttpClient`, applies into its own
    Postgres, and serves the dashboard **read-only** — every non-GET refused with `node.read_only` (a
    method-based gate, so promotion is a flag-flip), served unauthenticated via a boot-seeded read-only
    ambient viewer whose keepalive is throttled and holder-gated (a flag-flip to `primary` ends the
    ambient session + clears the cookie, so no auto-admin outlives promotion). Runs **none** of the
    primary-only workers (fiscal drain, reconcile, sync source, retention, tunnel client). Real-PG e2e
    proves pull-through-tunnel + apply + read-only serve. Spec + plan:
    [c2a-mirror-server](superpowers/specs/2026-08-28-sync-cloud-mirror-c2a-mirror-server-design.md).
    **Deferred (C2b / hosting slice), named so they are not dropped:** (1) the unauthenticated
    ambient-admin dashboard MUST be network-gated before any reachable deployment — accepted local
    stand-in posture, real per-user auth/TLS belongs to the hosting slice; (2) a later slice that syncs
    or provisions `print_agents`/`devices`/`kitchen_stations` MUST revisit the read-only method-gate — a
    few operational GET handlers write (e.g. `GET /print-api/agent/jobs`'s `claimPrintJobs`), inert on a
    mirror today only because those tables are not synced; (3) the promote **action** itself + starting
    the primary-only workers on promotion.
  - **C2b — the operator flow (next).** The primary emits a **"mirror bundle"** (its five identity ids +
    CA + a minted per-peer sync token + relay coords); the setup wizard gains a **primary/mirror** choice
    whose mirror path consumes the bundle, runs an **"adopt existing venue"** provisioning (insert
    `tenants`/`locations`/`nodes`/`tills`/`invoice_series` with the primary's **explicit** ids, **no
    `registerSif`** — re-registering a SIF mints a second unrecoverable hash chain), and moves the
    connection config from C2a's env to DB-stored, wizard-entered config. Its own spec → plan → build;
    provable against a second local Postgres + a reader on another port.
- **Multi-tenant transport** — a whole-log reader role.
- **Fiscal-lane / hash-chain sync (H2)** — the `registros`/hash-chain lane, deliberately excluded so
  far; a separate owner-reviewed slice.
- **HARD GATE — the `dining_tables` enrolment is DONE in C1 (#153).** The ordered lane no longer stalls
  when a counter-delivery order (`delivery_table_id` FKs `dining_tables`) is applied — `dining_tables`
  and its runtime-mutable parents are enrolled with the correct `fkRank`. **Still to do:** enrol
  `kitchen_stations` / `ticket_items` when the multi-node/cloud-mirror kitchen-sync slice lands (both
  were built single-writer-per-row).

### Reporting fiscal remainder (top-tier #3)

Spec: [reporting-desglose-and-modelo303](superpowers/specs/2026-08-08-reporting-desglose-and-modelo303-spec.md).

- **⚠️ Two pre-filing caveats a human must clear before the first LIVE 303 filing** (operational, not
  code): (a) validate the generated DR303 file once against the real AEAT sede "por fichero" uploader
  — we emit común + página 1 + página 3 and **omit página 2** (régimen simplificado, out of scope),
  and cannot verify from here that the uploader accepts a página-2-omitted file; (b) an asesor-fiscal
  must confirm the **prorrata** treatment — `computeInputVat` emits the deducible base in full and
  scales only the cuota by `deductible_proportion`; confirm AEAT expects the base unscaled.
- **Deferred build slices:** rectificativas de facturas recibidas (casilla **40/41** — needs a
  `corrects_purchase_invoice_id` self-FK; relax the app-layer non-negative check for credit-note
  negatives, no DB CHECK forbids them); bienes-de-inversión regularización (**43**); the **prorrata
  rule** that sets `deducible_proportion` (**44**, asesor-driven); intra-community/import boxes
  (**32–39**); a libro-registro / **Pre303** export (optional later — the raw DR303 file is the
  primary output today).
- **Duplicate-invoice-key decision:** `(tenant_id, supplier_tax_id, supplier_invoice_number)` is
  unique-forever today — asesor to confirm per-year vs forever.

### Printing + hardware surface (top-tier #4)

The **printing subsystem is built and security-reviewed** (2026-08-17..26), and its **kitchen**
(KDS-4), **counter-receipt + cash-drawer**, and **cash-drawer authorization** consumers have landed;
the remaining consumers below are specced-and-planned only. Specs/plans under
`docs/superpowers/{specs,plans}/2026-08-17-*`:

- **Printing subsystem** (`printing-subsystem*`) — **BUILT** (`@waitron/printing` + `print-api`
  routes + the Impresoras dashboard): central-managed `printers` plus **print agents** (enrol/revoke
  via a pairing code reusing the device-identity crypto; **pull** jobs from a central `print_jobs`
  **outbox** under `for update skip locked`, **push** to the printer, **report** status), `usb` +
  `network_tcp` transports, an ESC/POS builder, central dashboard management. **Printing never blocks
  a fire/sale** (outbox INSERT only). `cloud_poll` transport is a fast-follow (below); robustness
  follow-ups in *Debt*.
- **KDS-4 kitchen printing** (`kds-4-kitchen-printing*`) — **BUILT**: `station_printers` station→printer
  m2m + print-on-fire (an outbox INSERT, never blocking) + a deduped consolidated group ticket per fire
  + reprint + the dashboard station↔printer mapping UI. Thin layer on the subsystem + KDS-1. Follow-ups:
  **device-mode reprint** — the reprint route is `requireSession`, so an enrolled device-mode KDS station
  display can't reprint (button hidden per design); a future `POST /api/device/orders/:id/reprint`
  (behind `requireDevice`, scoped to the device's bound station) would close it — the kitchen station
  most likely to hit a paper jam is exactly a device-mode display. **Mirrored station-side read** —
  spec §5's read-only "printers serving this station" view on the station-config screen isn't built; the
  backing route `GET /management-api/stations/:sid/printers` already exists, only a
  `DashboardApi.listStationPrinters(stationId)` + a read-only UI line are missing. **Reprint
  timestamp** — reprint stamps the reprint wall-clock time (`enqueueKitchenTickets` sets
  `firedAt = new Date()`), not the original `ticket_items.fired_at`, so a paper-jam reprint's header
  reads a fresh time and any kitchen waiting-time gauge reads short; threading `fired_at` through the
  reprint query (per station/round) would make it true — a small product decision for the owner.
- **Counter receipt + cash-drawer** (`counter-receipt-drawer-printing*`) — **BUILT**: a per-till
  `receipt_printer_id` (also the cash-drawer kick — one device, deli-hardware §6), a per-location
  `receipt_print_mode` (`auto`/`on_request`/`never`), an ESC/POS `qr()`, and a faithful `formatReceipt`
  that re-renders every art. 7.1 / arts. 20–21 element of the *filed* record from the `TillSaleResult`
  — it writes only `print_jobs`/`drawer_opens`, never a `registros`/huella/alta table, and the fiscal
  write path is byte-unchanged by the branch (§4, H2 grep-proven). Server-side **print-on-sale** (an
  outbox INSERT that never blocks the sale) enqueues the receipt post-filing and, for **cash**, appends
  the drawer kick + a `drawer_opens('cash_sale')` row; the **integrated (Stripe Terminal) card** paths
  print a receipt with no kick. Plus a **manual reprint** (`POST /api/sales/:id/reprint` — paper only,
  files nothing, ignores print-mode, no drawer) and a **manual drawer-open** (`POST /api/drawer/open` —
  a `drawer_opens('manual')` row + kick, refused `drawer.no_printer` when the till has no printer), and
  the dashboard's per-till printer picker + per-location print-mode toggle. The
  **`cash.drawer` permission + supervisor-override gate** foreseen here (spec §8 — the manual open was
  session-gated and audited but not yet permission-gated at this slice) is now **BUILT** — see
  **Cash-drawer authorization** below; the remaining fast-follow is the `cloud_poll` transports.
  Deferred UI niceties: the per-till picker
  isn't location-filtered (all active printers, fine for the single-location deli); the print-mode
  toggle is set-only (no read-back route this slice, the `bump_mode` precedent).
- **Cash-drawer authorization** (`cash-drawer-authorization*`) — **BUILT**: a `cash.drawer` permission
  (supervisor+), a per-location `drawer_open_policy` (`gated`/`open`, secure default `gated`) with a
  dashboard toggle, and `POST /api/drawer/open` upgraded to parse a supervisor override and call
  `authorize()` — under `gated` the open is satisfied by the operator's own role OR a supervisor-PIN
  override, stamping `authorized_by`/`via_override` on the `drawer_opens` audit row (a cash-control
  audit trail, not a fiscal record — the branch touches no `registros`/huella/alta path; §4, H2
  grep-proven). Plus a session-guarded `GET /api/drawer/authorizers` (the eligible-supervisor set) and
  a **reusable supervisor-override dialog** on the till (props-in/events-out, driven by an optimistic
  403→dialog→retry flow). This is the **first till route to parse a supervisor OVERRIDE and call
  `authorize()` WITH one** — FP-2's `PUT/DELETE /api/tables/:id/placement` already calls
  `authorize(…"till.configure")` but with NO override — so the override dialog + the override hop are
  the foundation that **on-till config** (device-identity manager-on-till, FP-2 "Editar plano") and
  future till void/refund reuse. The dashboard `drawer_open_policy` toggle is set-only too (no
  read-back route this slice, the print-mode precedent) — since it gates cash access, a read-back
  route is a reasonable follow-up.
- **Cloud-poll transports** — Star CloudPRNT (`printing-cloud-poll-transport*`) and Epson Server
  Direct Print (`printing-epson-server-direct-print*`): a poll→fetch→ack endpoint group off the
  central outbox, token-authed, so a NAT'd printer prints jobs enqueued on any node with no agent.
- **Failover printing** ([design](superpowers/specs/2026-08-26-failover-printing-design.md)) — how
  printing survives a local-box death (the corner the subsystem deferred). Mechanism: USB/IP printers
  driven by local agents on **boxes *and* tills**. **Build-now item — LANDED (#138):**
  the **lease/reclaim for stuck `printing` jobs** (`claimed_at` column + a 60s visibility timeout folded
  into the pull predicate, `PRINT_JOB_LEASE_MS`; at-least-once by design) — the outbox no longer drops a
  job whose agent dies mid-claim; a `printing` row whose claim is older than the lease is reclaimed and
  delivered. Follow-ons: **un-pin an IP printer from its single `agent_id`** (any LAN agent serves;
  distinct-agents race test + location-scoped-authz review); **agents share the till's `[local → cloud]`
  failover list** (no outbox replication needed); **a till hosts a print agent** — the **majority
  (single-box) venue's box-death path (high importance), but the on-device agent it needs requires a
  native app → parked behind the go-native decision**;
  **at-least-once delivery + active failure escalation at the till/KDS** (Slice-B). **`cloud_poll` low
  priority** (single poll URL, no firmware failover — but it *does* confirm physical print). Gated on the
  on-device agent + till failover list.
- **Expo device kind** (`expo-device-kind*`) — an `expo_pass` device so the KDS-3 pass screen runs
  always-on, joining KDS-3 to device-identity.

### Cloud trial on-ramp + distribution/failover (top-tier #5, then #8)

Distribution & client-topology design landed (#86,
[spec](superpowers/specs/2026-08-15-distribution-and-client-topology-design.md)). Direction:
cloud-hosted is a **first-class mode**; production uses **Postgres everywhere** (PGlite demoted to
dev/test/demo, revising architecture §4). Production-cloud-primary is gated on the asesor hosting
question (below).

- **Cloud trial on-ramp (build first)** — today's same-origin PWA pointed at a cloud instance;
  preproduction, shared demo tenant; the zero-hardware trial.
- **Identity-config flow-down** (own spec) — `sessions` and the whole `identity` package are outside
  the sync set, so a failover **logs the user out today**. Identity *config* (persons + credentials)
  must flow to a secondary read-only the way catalogue does; the *session* must **not** replicate
  (write-amplification + single-writer conflict). Re-establishment: PIN-re-prompt v1 → portable
  signed token later.
- The **on-device agent** (own spec/spike) — the enabler for a till to host a print agent, the majority
  (single-box) venue's only box-death printing path (see *Failover printing*); but it **requires a native
  app**, so it is **parked behind the go-native decision** (a per-OS call, distribution §2); the
  **appliance image + AP-mode onboarding** — now designed
  ([spec](superpowers/specs/2026-08-26-appliance-onboarding-design.md) +
  [1a plan](superpowers/plans/2026-08-26-onboarding-slice1a-serve-spas.md)): the browser-based
  first-run flow (network → discovery → HTTPS → secrets → admin → tenant), a free self-signed / paid
  real-cert tier split, a demo/live fiscal fork orthogonal to it, plus backup/break-glass and an
  optional boot passphrase. Free-tier build order (all in-repo, no cloud/hardware): **1a serve the
  built SPAs — LANDED #137** (`spa-api.ts` + boot wiring; `WAITRON_{TILL,DASHBOARD}_APP_DIR`; till at
  `/`, dashboard at `/manage`); **1b setup-mode boot — LANDED #139** (`config.till` optional;
  `setup-api.ts` = `/setup-api/status` + placeholder; `startServer` branches setup vs trading with the
  trading path byte-equivalent; `dev:onboard`); **slice 2 split 2a/2b/2c — 2a LANDED #141** (first
  setup boot mints a self-signed CA + `waitron.local`/IP leaf into a persisted state dir
  `WAITRON_STATE_DIR`, serves the setup surface over HTTPS from it, and generates+persists the vault
  master key in `secrets.env` (the sync node-token mint was retired by #144) — idempotent, atomic writes, `0600`; operator
  `WAITRON_TLS_*` overrides the served cert but the box still generates its secrets; decided:
  persist-config-then-restart transition, `apps/setup` Vite+Lit wizard); **2b LANDED #142** — the
  `POST /setup-api/provision` endpoint: an in-process orchestrator (`provisionVenue` = `stampDeployment`
  demo/live + the landed `applyVenue` → tenant/location/till/node/**SIF/series**), a double-provision
  guard + a synchronous one-shot latch (no duplicate hash chain on a re-POST), the AEAT cert validated
  **before** the mint + sealed into `fiscal.aeat` for a live ES-common venue, admin PIN/password hashed
  at the boundary, `trading.env` persisted (`writeTradingEnv`, 0600 atomic) then a `requestRestart`
  (SIGTERM → supervisor → trading mode); dev launcher sources `secrets.env`/`trading.env`. **Venue-only
  (R1)** — full `instance` role-split deferred (see Debt). **slice 2c — the `apps/setup` Vite+Lit
  wizard — LANDED #146**: a 6-screen in-memory wizard (mode → admin → venue → cert [live+ES-common
  only] → review → provisioning/done) driving 2b's `POST /setup-api/provision`; served in setup mode
  via a new `WAITRON_SETUP_APP_DIR` (`mountSetup` serves the built bundle at `/`, else the inline
  placeholder; trading path untouched); own-shard `test-setup` CI browser lane. The AEAT PFX rides the
  provision body **only for a live provision** (client-gated on `mode === "live"` — a **Critical** review
  catch: never seal a cert onto a demo/preproduction tenant). **next → slice 4** (backup/status/break-glass).
  **Slice 3 discovery + CA-serving — LANDED #143** (built independent of
  2c, on top of 2a's cert): in-process `multicast-dns` advertises `waitron.local` in **both** modes
  (crash-safe — a no-multicast-route box still boots; the responder is acquired LAST in each boot branch
  so no failure path leaks the UDP socket); a new `discovery-api.ts` serves `GET /setup-api/ca.crt` (the
  CA 2a minted) + `GET /setup-api/discovery` + a server-rendered `GET /setup/trust` per-OS page with an
  IP-QR fallback; `BOX_HOSTNAME`/`caCertPath` single-source the hostname + CA path; **`setup-api.ts`
  untouched**. The **automated per-device "is the CA trusted?" check is deferred to a browser-behaviour
  spike** — spec §17/§18's "untrusted-CA origins block SW/PWA/WebAuthn until trusted" is load-bearing and
  unverified, so the trust page instructs + offers the download/QR but does not assert trust state. Then
  **4** backup/status/break-glass. Slices 5–7
  (AP-mode firmware, OS image, paid real-cert/remote) stay firmware/OS/paid. **1b deployment
  constraint (for slices 5–6):** a setup box's `/health` returns **503** by design (no duty loop → not
  trading-healthy); a liveness/supervisor probe must gate on **`/setup-api/status`** (200), not
  `/health`, or it restart-loops an unprovisioned box. *Notes:* SPAs are served as bundles only —
  **installable** PWAs (service worker + manifest) are a later slice; and a pre-existing
  `readOrderFlow`/`buildCardProvider` boot-throw pool-leak in `boot.ts` (a boot that throws after the
  app pool opens doesn't close it; moot in prod — process exits) is a candidate cleanup — slice 3 (#143)
  acquires its mDNS responder LAST so it adds **no** socket leak there, but a generalized top-level boot
  teardown that would also close this `db` leak remains deferred (Copilot raised it on #143). **Other
  slice-3 debt:** two QR libraries now coexist — `qrcode` (`apps/server`) vs `apps/till`'s fiscal-pinned
  `qrcode-generator` — worth unifying into `packages/shared` later. And the
  **reroute** itself (the till reaches any live server — selling is active-active — keeping a stable
  local origin in front).

### Recipes → stock → procurement (next #6)

The **recipe/BOM is the linchpin**: it drives allergen derivation (done), plate costing, and
sales → ingredient consumption → purchasing quantities. Backend allergen-inheritance and the
recipe-authoring UI are built.

- **Recipes remainder:** nested sub-recipes; **plate costing**; **stock depletion per sale** ("150 g
  ham used"); variants; customer-facing browse.
- **Inventory / procurement (SP20), greenfield, downstream of recipes:** suppliers, purchase orders,
  goods-in, stock, 3-way PO↔goods-in↔invoice reconciliation, par-level reorder. The **AI
  demand-forecast reorder is deferred** — build the deterministic system first. Received supplier
  invoices are already captured (`@waitron/purchasing`) and feed the accounting/modelo-303 side.

### Table-service completion (next #7)

The table-service core (TS-1..TS-4), the floor plan (FP-1/FP-2), and the KDS displays (KDS-1/2/3) are
built. Remaining, greenfield + product-heavy → **specced with the owner, run supervised, never landed
unattended**:

- **TS-5 split-bill** — item-split; the **one fiscal TS slice** (each check files its own sale +
  `registro`); dedicated fiscal review. Spec/plan `2026-08-17-table-service-ts5-*`.
- **Bookings-1** — staff-entered reservations (local date+time wall-clock, `booking.manage`-gated,
  dashboard day-list). Core is independent; the seat-opens-a-tab + reserved-on-floor integrations
  build on TS-1 + FP-1. Spec/plan `2026-08-17-bookings-1*`.
- **Device-scoped fire/collect routes** — a KDS device is advance-only today; a `fire_control=kitchen`
  or expo *device* needs server-side `/api/device/*` fire + collect routes.
- **Owner-added, not yet designed** (each reopens a settled decision — do not read the earlier
  "rejected"/"out of scope" wording as final): **per-seat ordering** (a nullable seat/position on
  `working_order_lines`, non-fiscal — must stay out of the huella; seat-aware KDS/running/split
  consumers); **multiple tabs per table** (turns the single `dining_tables.tab_id` back-pointer into
  one-to-many; ripples through `openTab` lock, `listTablesWithState`, TS-3 merge, and the pay path —
  pin the real driver first, since TS-1 §0 held QR/separate-checks/counter don't need it).

### SIF topology follow-ups (from #33)

The [server-as-SIF + failover design](superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md)
decided the topology; §14 defers the buildable pieces. The
[promotion, failover & node-lifecycle design](superpowers/specs/2026-08-29-promotion-failover-and-node-lifecycle-design.md)
(landed 2026-08-29) is the **first pass over that deferred ground**: it decides node role-resolution on
boot/return, physical + membership fencing, per-tab ownership/failover, disposal (durability ≠
convergence), backups + node seeding, AEAT `consultar` recovery, and cloud-failover sizing. Its §9 lists
seven still-open items. The first of those — the **ordered promotion runbook (§9 item 2)** — now has its
own landed design, the
[promotion runbook design](superpowers/specs/2026-08-29-promotion-runbook-design.md) (APPROVED 2026-08-29):
what a human's "make this primary" executes across four targets (local secondary, cloud mirror,
rejoin-as-secondary, and the no-hot-failover **cold restore from backup**). It decides a live in-process
mechanism (mount-and-gate, start the primary-only workers without restarting the sale path), a new
`deployment.singleton_role` axis (the singleton-ownership `role` #33 §8 needs, which `nodes.ts` deferred),
a remote-first authenticated trigger with a local offline fallback + one break-glass secret, and the
fence-then-claim-submitter attestation gate. **Next: its implementation plan → build.** NB C2a built the
`deployment.mode` *seam* but **not** the promote action — nothing refreshes the mode holder or starts the
workers at runtime yet.

- **Promotion + fencing tooling and the till-side failover list** — the promotion-runbook *design* is done
  (its own spec, above), and its **foundation slice is planned**
  ([singleton-role plan](superpowers/plans/2026-08-29-promotion-foundation-singleton-role.md)): the
  `deployment.singleton_role` axis + gating the fiscal pass on it (the dependency-free first slice; later
  slices — promote endpoint/auth, per-target orchestration, cold restore — need the break-glass /
  reserved-SIF / backup foundations that don't exist yet). **Next: build slice F1.** The rest of the
  tooling is still gated on the lifecycle spec's other §9 open items — the membership/rejoin wire-protocol
  (§9.1) and the till-failover detail (§9.5). Boot-time role resolution, continuous conflict-detection,
  the "one primary" invariant.
- **Split-brain** — largely worked through by the 2026-08-29 spec: server-level fencing (physical +
  membership, §3.5), per-tab single-writer ownership with transfer-not-share (§8), and the bounded worst
  case (a detectable/refundable double-bill, never a forked chain, §8.4). Remaining cross-cutting seams
  it names open: the promoted-node (Server 2) side while partitioned (§9.4) and cloud-relay-vs-sink
  (§9.3). Still spans selling, the fiscal chain (new-chain-on-partition is the existing safety valve),
  payments (`resolvePending`) and printing — **examine in detail, not scoped to printing** (owner request
  2026-08-26, raised by [failover-printing design §7](superpowers/specs/2026-08-26-failover-printing-design.md)).
- **The submitter as a relocatable role** — one venue submitter, certificate resolved from wherever
  it runs.
- **Till UX for the timed-out card case** (retry / alternative tender / wait).
- **`CLAUDE.md` §5's "nothing blocks a sale" invariant must be rewritten** — but *in the change that
  implements server-as-SIF*, not before (the current code still honours the old wording).
- The reconcile remediation UI and the orphan-drift hold (both under *Debt*) back the design's
  double-charge-across-failover path (§10) — no new work, but now they have a second caller.
- **New asesor question:** a cloud server that *issues* invoices operates the SIF from a cloud
  location — a stronger form of the §8a hosting question (see *The advisor gap*).

---

## The advisor gap

**No fiscal advisor is engaged**, so the open questions in
[compliance/asesor-questions.md](compliance/asesor-questions.md) have nowhere to go.
[compliance/who-to-ask.md](compliance/who-to-ask.md) is blunt about the market: *"every candidate
turned out to be a marketing page. Assume you will be educating whoever you hire."* — so engaging is
itself a task with a lead time (hence top-tier #1).

**The task is a re-read, then engage.** Two architectural shifts changed the question list:
[#19] (cloud is a sync root, not a shared system of record) and #33 (server-as-SIF). Several older
questions assumed **Waitron hosts the client's fiscal system**, which the cloud design abandoned;
re-read every question against *both* designs, drop/rewrite what they invalidated, and add the
replacements — three ROF (RD 1619/2012) hosting questions written out in
[cloud-storage-model §8a](superpowers/specs/2026-07-31-cloud-storage-model-design.md), plus the
new "cloud server issuing invoices operates the SIF abroad" question — *before* paying for answers.

**What each open question checks against the code:**

| Q | Assumption in the tree | Status |
| --- | --- | --- |
| Q13 (tips outside VAT base) | tip lives on `tenders.tip_amount`, never handed to the fiscal backend — structural | **Closed** on primary source (#37, findings §11) |
| Q15 (short payment = descuento) | a *descuento* agreed at/before issuance is outside the base (LIVA 78.Tres.2º) | **Closed** on primary source (#37, findings §12) |
| Q5(a) (one series per till) | #33 reshaped it — a series belongs to the server-SIF; two concurrent SIFs need **disjoint** series | needs advisor |
| **Q14 (precuenta → amendment log)** | a printed pre-bill may oblige an amendment log | **Open** — no primary text names the restaurant *precuenta* (findings §8); the interpretive hinge |

**Non-fiscal duty surfaced by Q13:** a tip collected through the card terminal is business income
(*ingreso* for Sociedades, *rendimiento del trabajo* with retención) — an accounting/payroll matter
(tracks 13 + 16, integrate-not-build), not the factura or the huella.

**The laboral advisor is a separate track**, with its own question list in
[compliance/asesor-laboral-questions.md](compliance/asesor-laboral-questions.md) (a *graduado social /
gestoría*, not the fiscal asesor). Nothing there blocks the build — the registro-de-jornada floor and
scheduling are built — but two items want confirming before go-live (the digital-registro RD's current
status; the applicable provincial convenio + figures), and the **gestoría's payroll package + import
layout is the one build dependency**: it fixes the D3 export format, so D3 stays deferred until it is
known.

---

## Debt and odd jobs

Deferred follow-ups from finished work. None blocks anything; each makes later work cheaper. The
per-slice UX/perf nits (dashboard pickers, single-flight guards, age-colouring, N+1 read tidies, …)
were dropped in the 2026-08-26 declutter — they live in the PR threads and git history. What remains
here is the cross-cutting or genuinely-decision-bearing work.

**Cross-cutting engineering:**

- **till-api's bare `c.req.json()` sites still 500 on a malformed body.** #145 landed the shared
  `readJsonBody` helper and converted all 51 `?? {}` / exact-`.catch(() => ({})) ?? {}` sites across
  ten route files (recipe/catalogue/me/workforce/management/schedule/purchasing/device/print/till-locale)
  to it, so those surfaces now screen an empty/malformed body to the route's own 4xx — the helper
  coerces only a parse `SyntaxError` and a literal `null`, rethrowing other faults. **Left:** till-api's
  ~19 **bare** `await c.req.json<T>()` sites (no `?? {}`), on the sale/pay critical path — each needs
  per-route validation tracing before adopting the helper. The till **PIN-login** (`POST /api/session`)
  is the twin of the management login #145 hardened (a `null`/malformed body → destructure TypeError /
  parse `SyntaxError` → opaque 500 instead of a clean credential 401). `sync-api`
  (`.catch(() => ({}))` without `?? {}`) and `setup-api` (`.catch(() => null)`) use different-contract
  defensive forms and are correctly left as-is.
- **Encrypt `totp_secret` at rest** (SP5). Stored plaintext today and `app_user` holds SELECT on
  `persons`, so a `persons` leak exposes every enrolled second factor. Latent (nothing writes it
  yet). The enrollment slice must encrypt via the credentials vault (AES-256-GCM), decrypting on the
  box before `verifyTotp` (keeps the offline-verifiable property).
- **No PIN-attempt throttle at the identity layer.** `verifyPersonCredential` has no lockout /
  rate-limit, so an authenticated operator can retry a 4-digit PIN. This is **pre-existing** — the
  same posture the till login (`POST /api/session` → `loginWithPin`) already carries; the cash-drawer
  supervisor override (`POST /api/drawer/open`, cash-drawer-authorization) just adds a second caller of
  the same gate, it did not introduce the gap. Mitigated today by scrypt's per-attempt cost +
  `sameSite:"Strict"` session cookies. A per-person attempt lockout at the identity layer would harden
  login and the override together. (Surfaced by the cash-drawer-authorization whole-branch review.)
- **Location-scope the by-id verb family together** (SP6). `getHeldOrder`/`updateHeldOrder`/
  `abandonHeldOrder` and `updateTable`/`deactivateTable`/`openTab` address by (tenant-via-RLS) + id;
  only *list* verbs scope by location. Unreachable today (single-location tenants); when multi-location
  lands, move the whole family at once.
- **Hoist the receipt's ported money/date/label formatters into `packages/shared`** (from the
  counter-receipt slice, #154). `formatReceipt` (`apps/server/src/receipt-ticket.ts`) hand-ports
  `formatMoney`/`issueDate`/`lineName`/`LABEL`/`LEGEND` from `apps/till` because an
  `apps/server → apps/till` dependency is forbidden — so the paper receipt is kept in lock-step with
  the on-screen ticket by COPY, not by the type system. A fix to one silently skips the other (the
  receipt already carries an NBSP-money normalization the screen lacks). Extract the shared, pure logic
  into `packages/shared`, imported by both apps. Low-risk, low-urgency; small drift surface today.

**Fiscal (deferred, each behind its own review):**

- **The three alta builders are triplicated** — `recordSale`/`recordCorrection`/`recordSubstitution`
  in `packages/fiscal-verifactu/src/backend.ts` repeat the same alta head (`currentSif`/`legalNameFor`,
  the `desglose` map, `cuotaTotal`) and tail (`appendToChain` → `insert(envios)` → `FiscalRecordRef`).
  These are unrepairable-record builders (CLAUDE.md §5), so a de-dup needs its own review + a
  huella-invariance re-run across all three. Safe seam: a helper taking the assembled
  `Omit<AltaInput,"Encadenamiento">` + a `buildDesglose`. Also folds in the identical
  `fechaFromStoredDay` algebra and `recordSubstitution`'s N+1 substituted-ticket loop.
- **Concurrent-corrective race in `settleSale` is untranslated.** If a rectificativa commits between
  the opening read and the `sale_settlements` INSERT, the coverage trigger raises a raw `P0001` that
  `settleSale` does not map to a `sale.*` code. Fail-closed and unreachable in the headless slice
  (needs the till UI to interleave). Fix when reachable: give the trigger a dedicated SQLSTATE (as
  `tenders_reject_post_settlement` got WT002) and translate it.
- **F3 canje open questions (asesor/XSD)** — the foreign `IDOtro` recipient path is refused pending
  the asesor's `IDType` shape; whether a separate F3 series is mandatory (reuses `standard` today);
  cross-SIF F3 is a sound inference not confirmed; `Destinatarios` XSD confirmation before the first
  real filing.

**Provisioning / build:**

- **The `tenant` command is unplanned** and its design carries a defect: the idempotency check "look
  up `tenants` by NIF" cannot work (RLS hides a tenant from a connection that hasn't said which tenant
  it is). Attempt the insert and catch the unique-violation instead.
- **Credential READ path doesn't `validatePayload`.** `getCredential`/`tryGetCredential`
  (`packages/credentials/src/store.ts`) run the shape guard but not `validatePayload`, so a row sealed
  under an older `PURPOSES` field-list returns a missing field as `undefined` rather than being
  rejected — a fail-loudly-vs-keep-serving call to settle before the first consumer relies on it. Plus
  four carried from [#11]: password redaction in `applyInstance` is listed-not-structural (next
  statement added is unsafe by default); `bin.ts`'s `ask()` is coverage-excluded logic; `ApplyDeps`
  and the action list are two sources of truth for the database name.
- **Collapse the per-module drizzle migration chains into per-module baselines** (pre-production
  cleanup, not now). Migrations are already per-module (8 sets in
  `packages/migrations/migrations.manifest.json`); the debt is chain *length* (78 SQL files, 30 in
  `packages/db`), much of it dev churn (`add_node_id` retrofits). Legitimate per CLAUDE.md §3 (nothing
  deployed; end state is all that matters) — but **not** a `drizzle-kit generate` one-liner: the
  valuable migrations are hand-written custom SQL (FORCE RLS, policies, GRANTs, immutability triggers)
  that Drizzle does not emit.
- **Onboarding slice-2a follow-ups** (deferred from #141, none blocking 2b): **(a)** the box's
  self-signed **CA has no `nameConstraints`/`pathLen`** — an unconstrained signer; add
  `nameConstraints` limiting it to `waitron.local` + the box IPs so a leaked `ca.key` can't sign
  arbitrary hostnames (fits with slice-3 trust UX). **(b)** `apps/server/src/self-signed-cert.ts` and
  the test-only `apps/server/src/testing/tls.ts` both define near-identical `CertExtension` +
  `certificate()` node-forge builders (already drifted: `cRLSign` vs `clientAuth`) — three simplify
  agents flagged it; extract the shared `keypair()`/`certificate()`/`CertExtension` into one internal
  module both import (its own PR — touches the mtls fixture + re-runs those suites). **(c)** the leaf's
  validity window is stamped from `now` at first boot with only 1 day of back-slack, so a box that
  mints its cert **before NTP sync** (no RTC) persists a wrong/expired window and there is no renewal
  in 2a — ties to the §13 time-health check and cert renewal (slice 3/4). *(Also: the setup-branch
  boot pool-leak is now guarded (#141); the pre-existing `readOrderFlow`/`buildCardProvider`
  **trading**-branch boot-throw pool-leaks remain, noted in the onboarding §.)*
- **Onboarding slice-2b follow-ups** (deferred from #142, none blocking 2c): **(d)** `provisionVenue`'s
  double-provision guard is a separate transaction from `applyVenue`; the in-process one-shot latch on
  `/setup-api/provision` closes the concurrent case (ONE setup process), so this is defence-in-depth
  only — a DB-level advisory lock (keyed on `tenantId`, spanning guard→stamp→`applyVenue`) would make
  `provisionVenue` safe regardless of caller. **(e)** a `sealAeat`/`persistTrading` I/O failure *after*
  `provisionVenue` succeeds wedges the box (tenant minted, but no `trading.env`; a retry is safely
  refused `setup.already_provisioned` 409, and `/setup-api/status` still reports `provisioned:false`
  with no distinguishing signal) — add a recovery path: on setup boot detect "DB already provisioned for
  this tenant but no `trading.env`" and offer re-derive-`trading.env`+restart, and/or make the wedge
  loud. **(f)** the **trading-branch** `closePools` (`boot.ts`) still closes `db`/`syncDb`/`retentionDb`
  **sequentially**, so a throw from the first skips the rest — the same leak the setup branch fixed via
  `Promise.allSettled` in #142; harden separately (extract one `closeAll(pools)`), NOT touched in 2b to
  keep the trading path byte-identical. **(g) R1 owner-connection:** 2b runs provisioning over
  `config.migrationsDatabaseUrl`, correct only because dev's superuser owns the tables; on a real
  role-split appliance the setup-mode owner connection must be the role that ran `waitron-provision
  instance` (the DB owner), **not** `waitron_migrator` (an `app_user` member with no INSERT on
  `tenants`) — wire it with the deferred appliance instance role-split. And a wizard-only box persists
  that owner connection as `trading.env`'s `DATABASE_URL`, so it runs its trading life on the owner role
  (not least-priv `app_user`) until that retrofit.
- **Onboarding slice-2c follow-ups** (deferred from #146, none blocking; the fiscal surface was verified
  solid by two heavyweight whole-branch reviews + deletion-proofs — cert single-chokepoint, 409s
  no-retry, trading path untouched, secrets never leak). **✅ ALL LANDED: (h) #147, (i)+(l) #148, (j)+(k)+(m) #149, (n)+(o) #151.** **(h) ✅ LANDED #147 — FISCAL, pre-existing (#57):**
  `tenant-id.ts` derives `obligadoTenantId` as a UUIDv5 over `country` + a newline + `taxId`, **not
  case/whitespace normalized**, so `es` vs `ES` (or a `taxId` casing/spacing difference) for the same business derives a
  **different** tenant id → could defeat `provisionVenue`'s double-provision guard across two separate
  wizard sessions (§5 unrecoverable chain duplication). Fix at the **derivation choke point** (normalize
  both `country` and `taxId`), covering the wizard **and** the `instance` CLI — a wizard-only patch was
  deliberately NOT taken (false confidence); 2c's client already trims + ES-guards `country`, which
  narrows but does not close it. (Landed as normalization at the `planVenue` choke point + an `obligadoTenantId` self-normalizing backstop — covering the wizard, the `instance` CLI, and `provision.ts`'s raw-request double-provision guard — with a casing-flip regression test.) **(i) ✅ LANDED #148 — server defence-in-depth:** the provision endpoint calls `sealAeat`
  whenever `aeatCert` is present **without checking `mode`** (a `boot.test.ts` pins that a demo provision
  carrying a cert seals it) — the box should refuse/ignore an AEAT cert when `mode !== "live"`. 2c's
  client gates the cert on live mode (the Critical fix), closing the *reachable* path; this is the
  server-side belt. (Landed as a symmetric gate — a cert is accepted iff `live + ES-common`, else refused `setup.request_invalid`/`aeatCert` before parse; + a live+cert full-boot seal test.) **(j) ✅ LANDED #149 —** a11y: the venue-screen server-routed banner + the client-validation banner could
  co-render (two `role="alert"`); now a single alert region (client-validation takes precedence). **(k) ✅ LANDED #149 —** terminal failure states (`already_provisioning`/`already_provisioned`/
  `deployment.already_stamped`) rendered a bare alert with no next-step; now a "Reload to open the till" / "Reload" action (the two fiscal 409s still offer no retry).
  **(l) ✅ LANDED #148 —** `setup-api.ts`'s provision-error doc comment implied the client sees `setup.provision_failed`;
  that's only the boundary's log *tag* — a crash sends `server.internal` (comment corrected). **(m) ✅ LANDED #149 —**
  altitude: the venue→`cert`/`review` conditional was computed in `venue-screen` (read `draft.mode`); lifted
  into the shell (a screen-agnostic `setup-advance` event; the shell's `#onAdvance` decides cert vs review),
  matching `dashboard-app.ts`'s `#applyMe`. **(n) ✅ LANDED #151 —** hoist the shared `<select>` styling to
  `packages/ui`. **Correction:** the "3rd verbatim copy" premise was wrong — `apps/dashboard` and `apps/setup`
  were identical (form select, `width:100%`) but `apps/till` genuinely differs (touch tap-target: `min-height`,
  no width). Hoisted the dashboard/setup version to `@waitron/ui` as `selectStyles`; till left as-is (documented). **(o) ✅ LANDED #151 —** the 14 raw `new CustomEvent(...)` dispatch
  sites had no typed helper (a mistyped `screen` value compiled + silently misrouted); now `apps/setup/src/events.ts`
  exports typed `dispatchSetup*` helpers (typed on the `Screen` union + `DeepPartial<ProvisionBody>`; event names centralised).

**Payments:**

- **Webhook `recordSale` sale-chaining hand-off** — the Mode-3 inbound Stripe webhook's security half
  is done; chaining a settled webhook into a sale needed the till/working-orders model (now exists).
- Pre-existing `forward` retry backoff; the reconcile remediation UI (also a SIF-failover backstop).
- **Stripe is unprovisioned for the deli** — the code is verified against a live sandbox, but no real
  account exists yet.

**SumUp:**

- **Four unverified questions, one design-invalidating**
  ([sumup provider spec](superpowers/specs/2026-07-30-sumup-card-present-provider-design.md) §7),
  wanted **before** the SumUp provider is built. The load-bearing one: **does the reader still work
  standalone/offline once paired to SumUp's cloud?** If not, the deli-hardware outage path (assumes a
  card can be taken when the internet is down — the whole reason the hardware was chosen) must be
  rewritten. The other three: may we *supply* the idempotency key; are reader webhooks signed like
  online ones; does `void` map onto the refund endpoint.

**CI / test infra:**

- **Job-sharding next lever.** Critical-path jobs are now `test-heavy` (`packages/db`, ~275s) and
  `mutation-verifactu` (~218s), both CPU-bound on one free 4-vCPU runner. To go below ~250s: shard
  db's suite or split `mutation-verifactu`. Rebalance the `LIGHT_A/B_PACKAGES` bins
  (`scripts/changed-scope.mjs`) when a run shows one shard dominating (the partition tests police
  coverage, never balance).
- **The pre-push hook's shell is largely untested** (the deletion guard + range computation are backed
  only by running the real hook); **`test-light` reports `success` without naming what it ran** (make
  the job name its selected packages); **`packages/ui` can hang the `test-ui` shard** (unconfirmed
  cause — if it recurs, per-test timeout + Playwright trace).

**Printing subsystem (robustness follow-ups, each spec-silent, none blocks):**

- **Retry spacing is the agent's batch interval, not a per-job backoff** — `MAX_DELIVERY_ATTEMPTS` (5)
  bounds attempts, but `print_jobs` carries no next-attempt timestamp, so a flapping printer burns the
  cap at loop speed. A time-scheduled backoff needs a new column.
- **The Impresoras editor leaves agent/transport re-binding read-only** — the management API already
  accepts a re-bind (PATCH `agentId`/`transport`/connection fields); wire the inline dashboard edit.

**Localisation (per-user language preference landed #140 — `persons.locale`, live in-app language switch, venue default derived `province → country → English`; the printed/fiscal receipt keeps the *venue* language, structurally separate from the UI locale):**

- **Province → language derivation is the deferred layer.** `PROVINCE_DEFAULT_LOCALE` is empty today, so every province falls through to country — a Cataluña venue shows **Spanish, not Catalan**. It lands with the **first regional catalogue** (add the catalogue + populate the map); `locations.province` is the hook. Same drop-in path adds any third language (a catalogue + one supported-list entry); only `en`/`es` exist today.
- **The venue default is derive-only, not admin-editable.** The chain is `WAITRON_TILL_LOCALE` override → derivation; there is no stored, editable venue locale yet (a natural dashboard-config step). Decide when a venue needs to override the derived default without an env var.
- **Per-device "remember this login-screen language" deliberately not built** — the pre-auth chooser is transient; a possible later nicety.

**Product decisions (defensible before production; decide before it):**

- **The orphan drift gate holds a customer's money pending a human, unbounded** (nothing re-sweeps a
  closed period).
- **`waitron-provision instance` migrates on every run**, which against a trading shop can lock tables
  — should it be gated (flag / refusal / louder confirmation)? Blast radius is one shop under the
  per-venue-database cloud design.
- **The €0 comped-sale settles at the settlement instant, not backdated to `issued_at`.** Till-UX
  question (is a comp ever finalised long after the invoice printed, in invoice-first mode?) — bears
  on the till design, nothing to decide until then.

---

## Reference

**Adding a new real-PG test package** (the shared-container rollout pattern, so it isn't reinvented):
`ProbeRole.inRole` takes `string | readonly string[]` (a multi-membership role is a plain `roles`
entry, no `setup` hook); `cloneTemplate` is exported from `lifecycle.ts` and validates its own
identifiers, so a package needing a fresh DB per test (a `describeEachTarget`-style seam) reuses it —
`packages/db`'s `harness.ts` `postgresTarget` is the reference (clone per test, track, drop all in
`teardown()`); `nextCloneName()` mints the shared clone-name; `useTemplateDb` covers one-clone-per-file.
Template-key naming is **`core_<schema>`** (self-describing about what it migrates, not the package
name). Fork mode is a **per-package call**: (a) the `@vitest/coverage-v8` cross-fork branch-merge bug
needs `singleFork` where a package runs under `pnpm -r` oversubscription; (b) a shared container is
one cluster on a 100-connection budget, so a package whose suites open many backends caps at
`maxForks: 4` instead. `packages/db` is the reason-(b) reference, `packages/payments` the reason-(a)
one. Plan: `docs/superpowers/plans/2026-08-19-shared-test-container.md`.

---

## How to keep this file honest

Update it in the change that makes it stale (CLAUDE.md §7). In particular:

- When a piece lands, move it out of the priorities / *What's built* "Remaining" column — do not add a
  new receipt paragraph. **This is state, not history; the git log is the history.**
- The moment it goes stale most reliably is a **merge**: `/land-branch` carries a step to update this
  file. A merge deletes the branch the in-flight rows named, so refresh them then.
- When a question is closed on primary source, say so and stop calling it blocked.
- Delete finished items. If an entry is growing proof-of-work (test counts, grep receipts,
  "proven by deletion"), that belongs in the PR, not here.
