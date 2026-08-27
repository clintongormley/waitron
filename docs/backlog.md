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
> Vite+Lit wizard driving 2b's endpoint) is next**. NB 2b is **venue-only** (deviation R1): it stamps +
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
   runtime/`usb`+`network_tcp` transports/ESC/POS/dashboard, security-reviewed). Remaining on the
   track: `cloud_poll` transports (fast-follow), KDS-4 kitchen printing, counter receipt + cash-drawer
   printing, cash-drawer authorization, the expo device kind. Real deli hardware need; mechanical.
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
| 7 | Counter POS | walk-up cash, park/retrieve, manual + integrated card, prepare & collect, layout/receipt editors — operable end to end | receipt/drawer **printing** (top-tier #4) |
| 8 | Reporting | daily close, frozen *cierre Z* (VAT-exact + hash chain + *descuadre*), VAT summary, modelo 303 output+input VAT, DR303 file + download route, purchase-invoice UI | **fiscal remainder (top-tier #3)** |
| 9 | Deployment | distribution & client-topology design (#86) | **cloud trial on-ramp (#5)** + agent/appliance/reroute (#8) |
| 10 | Tabs / table service | TS-1 tables+tabs, TS-2 statuses, TS-3 move/join/merge, TS-4 transfer | **TS-5 split-bill** (fiscal) |
| 11 | Floor plan | FP-1 live floor + FP-2 spatial canvas/editor — complete | — |
| 12 | KDS | KDS-1 stations/routing/tickets, KDS-2 courses/fire, KDS-3 expo; device identity-1 | KDS-4 kitchen printing (#4); expo device kind; device-scoped fire/collect routes (Debt) |
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
- **B — outbound tunnel** (deferred; builds on A). Invert the transport so the box always dials out and
  the cloud's pull rides back down the box-initiated tunnel. Gated on standing up Waitron-cloud infra;
  provable first against a local relay stand-in.
- **C — cloud read-mirror** (deferred; builds on A+B). A "mirror mode" of `apps/server` that pulls +
  applies into its own Postgres and serves the dashboard read-only. **Owns the `dining_tables`
  FK-closure enrolment (the `fkRank` hard-gate)** — the first slice to activate a real ordered-lane
  subscriber. Provable against a second local Postgres + a reader on another port.
- **Multi-tenant transport** — a whole-log reader role.
- **Fiscal-lane / hash-chain sync (H2)** — the `registros`/hash-chain lane, deliberately excluded so
  far; a separate owner-reviewed slice.
- **HARD GATE for the enrollment slice.** It must **enrol `dining_tables`** (correct `fkRank`) before
  activating the `working_orders` subscriber, or a counter-delivery order (`delivery_table_id` FKs
  the un-enrolled `dining_tables`) parks a `23503` and **holds the cursor below it**, stalling the
  ordered lane. Likewise enrol `kitchen_stations` / `ticket_items` when the multi-node/cloud-mirror
  kitchen-sync slice lands (both were built single-writer-per-row).

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

The **printing subsystem is built and security-reviewed** (2026-08-17..26); the consumers below are
still specced-and-planned only. Specs/plans under `docs/superpowers/{specs,plans}/2026-08-17-*`:

- **Printing subsystem** (`printing-subsystem*`) — **BUILT** (`@waitron/printing` + `print-api`
  routes + the Impresoras dashboard): central-managed `printers` plus **print agents** (enrol/revoke
  via a pairing code reusing the device-identity crypto; **pull** jobs from a central `print_jobs`
  **outbox** under `for update skip locked`, **push** to the printer, **report** status), `usb` +
  `network_tcp` transports, an ESC/POS builder, central dashboard management. **Printing never blocks
  a fire/sale** (outbox INSERT only). `cloud_poll` transport is a fast-follow (below); robustness
  follow-ups in *Debt*.
- **KDS-4 kitchen printing** (`kds-4-kitchen-printing*`) — `station_printers` m2m + print-on-fire (an
  outbox INSERT, never blocking) + a kitchen-ticket formatter; a group printer gets one deduped
  consolidated ticket per fire. Thin layer on the subsystem + KDS-1.
- **Counter receipt + cash-drawer** (`counter-receipt-drawer-printing*`) — per-till
  `receipt_printer_id`, per-location `receipt_print_mode`, an ESC/POS `qr()`, a faithful
  `formatReceipt` (re-renders every art. 7.1 / arts. 20–21 element of the *filed* record — fiscal
  record untouched), server-side print-on-sale + a cash-drawer kick + an audited manual open.
- **Cash-drawer authorization** (`cash-drawer-authorization*`) — a per-location `drawer_open_policy`
  and the **first till-side `authorize()`-with-supervisor-override path** + a reusable supervisor-
  override dialog (which on-till config and future till void/refund reuse).
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
  (R1)** — full `instance` role-split deferred (see Debt). **next → slice 2c**: the `apps/setup` Vite+Lit
  wizard consuming 2b's endpoint. **Slice 3 discovery + CA-serving — LANDED #143** (built independent of
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
decided the topology; §14 defers the buildable pieces:

- **Promotion + fencing tooling and the till-side failover list** — boot-time role resolution,
  continuous conflict-detection, the "one primary" invariant.
- **Split-brain needs its own cross-cutting design** — under a partition two nodes can both act as
  primary, giving two outboxes and a double-serve + double-sell risk; the "every till and agent picks
  the single first-reachable node from one shared list" convergence is necessary but **not sufficient**.
  Spans selling, the fiscal chain (new-chain-on-partition is the existing safety valve), payments
  (`resolvePending`) and printing alike — **examine in detail, not scoped to printing** (owner request
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

- **Server-wide safe-JSON-body helper.** `(await c.req.json()) ?? {}` degrades an empty/malformed
  body to an opaque 500 (the `?? {}` only ever caught a literal JSON `null`), across
  `recipe-api`/`catalogue-api`/`me-api`/`workforce-api`/`management-api` (device-api's three routes
  were fixed defensively on #134). A shared `readJsonBody` that `.catch(() => ({}))`s the throw would
  screen the whole surface to a clean 400. Same theme in **both `run` copies** (till-api +
  management-api): an unparseable body → `server.internal` 500; decide 400 across both.
- **Encrypt `totp_secret` at rest** (SP5). Stored plaintext today and `app_user` holds SELECT on
  `persons`, so a `persons` leak exposes every enrolled second factor. Latent (nothing writes it
  yet). The enrollment slice must encrypt via the credentials vault (AES-256-GCM), decrypting on the
  box before `verifyTotp` (keeps the offline-verifiable property).
- **Location-scope the by-id verb family together** (SP6). `getHeldOrder`/`updateHeldOrder`/
  `abandonHeldOrder` and `updateTable`/`deactivateTable`/`openTab` address by (tenant-via-RLS) + id;
  only *list* verbs scope by location. Unreachable today (single-location tenants); when multi-location
  lands, move the whole family at once.

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
