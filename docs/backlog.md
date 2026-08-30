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

## Priorities (reprioritised 2026-08-29)

**North star: a working frontend to demo to a restaurant owner** (owner decision, 2026-08-29) —
runnable on a dev laptop, on-prem, or cloud; **the demo needs none of the cloud sync,
primary/secondary failover, or appliance-hardware track.** Rank by what a restaurant owner will
notice, not by infra completeness. The prior soundness-first ordering still governs the *infra* work
(below, under *Parked*) — it is just parked beneath the demo until there is something to show.

**The demo is closer than it looks** (frontend maturity + run path verified 2026-08-29):
`pnpm dev:setup && pnpm dev` boots a real till + dashboard on real Postgres — cash + manual-card
sales, live fiscal chaining, **no hardware, no cloud, no AEAT cert** (till PIN 5555 / dashboard 1234).
**`dev:setup` now seeds a believable demo restaurant** (was the top Tier-A item; DONE): **two menus** (~44 products)
with **per-dish images**, a **floor plan** (3 zones / ~16 tables), **staff on PIN 5555**, and **~28
days of back-dated preproduction sales** so the reports screens aren't blank — **English by default**,
Spanish via `WAITRON_SEED_LOCALE=es-ES`. ~25 fleshed-out screens on one enforced design system.
Already built and demo-ready: counter + table-service ordering, KDS fire/expo, payment, **menu editing
with images**, floor-plan editor, **layout designer**, rostering, recipes, purchases, **printer** and
**device** enrolment, **staff CRUD**, and the **server onboarding wizard**. What is missing is a
bounded set of gaps an owner will hit — not a rough frontend.

### Phase 0 — tie off the two self-contained in-flight threads, then pivot (owner, 2026-08-29)

- **Onboarding 4b/4c** — 4b backup/recovery (incl. cold-restore/fresh-chain), then 4c loopback
  break-glass. *Open threads → Onboarding, cloud trial & distribution/failover.*
- **Sync cloud-mirror C2b — the operator flow — LANDED (#162)** (mirror-bundle + wizard primary/mirror
  choice + adopt-existing-venue; four deferred follow-ups recorded under *Open threads → Sync*).
- **Promotion — Slice 1 (local secondary → primary, in-process) LANDED (#160)** (owner chose to land it
  now, overriding the demo-first park). The **remaining** promote-action slices stay
  **PARKED**: gated on unbuilt foundations (break-glass mint, reserved-SIF, backup regime), the demo never
  touches them, resume post-demo. Design + #158 foundation landed. *Open threads → SIF topology.*

### Phase 1 — the demo build (ranked)

Ranked by owner-impact ÷ cost; each carries its BUILT / PARTIAL / MISSING status inline (verified
2026-08-29). Tiers A/B/C = "an owner notices in five minutes / an owner will ask / defer past a first
demo or behind-the-scenes".

**Tier A — an owner notices these missing in the first five minutes:**

1. **Sales/takings screen + a real dashboard home — LANDED (#167).** Non-staff now land on a
   **business-overview home** (takings today + tips + gross, sales/corrections/voids counts, open vs
   total tables, top sellers), and a **Sales screen** gives the single-day daily close (per-till tender
   breakdown, VAT by rate, cash-up, counts) and a period roll-up. Backed by a new `report.view`
   permission (supervisor+manager), three node-scoped `/management-api/reports/` routes
   (overview/daily-close/period), and a new `computeTopSellers` reporting query. **Covers was dropped**
   — no guest count is captured anywhere and fabricating one is forbidden (house rule); the home shows
   only real figures. *The menu-import seed (#165) fills every screen.* Grouped **sidebar** + **email
   login** are still to-do (was bundled here; now item 2).
2. **Admin-site professionalization.** (a) The dashboard's **flat row of 14 tabs**
   (`dashboard-app.ts:374`) becomes a grouped **sidebar** — also the enabler for every new admin screen
   below without the top bar overflowing; (b) **email + password login**, dropping the prepopulated
   roster dropdown (`login-screen.ts:177`) the owner flagged as wrong (password auth already exists;
   needs an email field on persons + a login-screen change). NEW.
3. **Resolve the greyed-out Split/Move buttons** (`till-table-order-screen.ts:585`). Cheap half: wire
   **move/transfer** (TS-3/TS-4 backend already built) into the till. Then **TS-5 split-bill** — the
   one **fiscal, owner-gated, supervised** slice (each check files its own sale + registro); specced +
   planned (`2026-08-17-table-service-ts5-*`).
4. **Tableside / handheld ordering + per-device layouts.** **The waiter's tableside experience — a
   centrepiece of a restaurant demo** (owner, 2026-08-29: "this is what waiters will use tableside").
   One venue-wide layout today (only CSS stacking on narrow screens); no phone/handheld/till device
   kinds (`device_kind` enum = `kds_station` only). Needs new device kinds + a device→layout
   association + a layout-editor dimension, rendering the existing table-order flow on a handheld.
   **Pairs with modifiers (#7)** — a waiter taking "burger, no onions" at the table needs them. The
   biggest Tier-A item; sequence it after the quick wins. MISSING.

**Tier B — an owner will ask; product-defining:**

6. **Reservations (Bookings-1).** Staff-entered, day-list; specced + planned
   (`2026-08-17-bookings-1*`). MISSING today (only a "Reserved" floor *status* exists). Supervised.
7. **Ordering modifiers / variants** ("burger with options"). A **data-model gap** — products are flat
   (`packages/catalogue`, no modifier/option-group concept). Needs its own spec; greenfield. **Pairs
   with tableside ordering (#4).** NEW.
8. **Menu-management depth.** The **live multi-menu till foundation landed**: a location has a
   **default catalogue plus other accessible catalogues** (`location_catalogues`), and the till lists
   the **union** of their products and **switches menus live, client-side**. Missing the pieces that
   make it a fuller owner story: a **dashboard route to manage `location_catalogues` membership** (which
   menus a location may sell is fixed at seed/provisioning today); **per-till persisted menu selection**
   (the switch is client-side only, not remembered); a **draft/published** state (only an `active` bool
   today); and **time-of-day / seasonal scheduling**. PARTIAL → complete.
9. **Order timings — overdue / forgotten-order alerting** (owner-elevated 2026-08-29). The KDS
   station queue **already ages every order** (colour buckets fresh <5 / warm <10 / hot ≥10 min +
   minute label, `station-queue.ts:405-434`), so the base already demos. This adds the *feature*:
   **owner-configurable thresholds** (5/10 are hardcoded), **active overdue/forgotten alerting +
   escalation** (today it's passive colour — no alert when an order crosses a line or sits unbumped),
   and a **manager/expo overview** of overdue orders across stations. PARTIAL → complete. Detail:
   *Open threads → KDS operations*.

**Tier C — valuable, but defer past a first demo or behind-the-scenes:**

10. **Square (and generic CSV) menu import — as a product feature.** The full dashboard flow (auth to a
    Square account, map its catalogue, ongoing re-import) — a strong switching-cost story for an owner
    leaving Square. **Spike outcome (2026-08-29): a one-off Square import is NOT the cheap seed path —
    the demo menu was hand-authored instead.** The polished product feature remains **deferred** (this
    tier). MISSING; greenfield + external API.
11. **Definable roles with selectable privileges.** Roles are a fixed 4-value enum + a code-defined
    permission map (`packages/identity/src/permissions.ts`); data-driven RBAC + a role-editor is a
    large backend change. Demoable on the fixed roles for now.
12. **Payment-provider config UI** (Stripe / SumUp / …). No dashboard UI today (provider is env-stamped
    + sealed via the credentials CLI) and **no SumUp integration at all**; also gated on the unanswered
    SumUp offline question (*Debt → SumUp*). Behind-the-scenes for a demo.
13. **AEAT cert / Veri*Factu management UI.** First-run only today (`apps/setup` cert screen);
    `cert-expiry.ts` monitors but there is no view/rotate/renew surface. Behind-the-scenes.
14. **Hardware config profiles per device kind.** No profile abstraction exists; lowest demo value.

### Parked below the demo (de-prioritised 2026-08-29 — real, but not until there's something to show)

Formerly the numbered top tier; the demo needs none of it.

- **Engage a fiscal advisor** — a parallel *human* task (long lead time), not a build; still worth
  starting, blocks nothing in the demo. See *The advisor gap*.
- **Sync completion beyond C2b** — fiscal-lane / hash-chain sync (H2, owner-gated), multi-tenant
  transport. See *Open threads → Sync*.
- **Reporting *fiscal* remainder** — modelo-303 filing boxes (rectificativas 40/41, prorrata 44,
  intra-community 32–39) + two pre-filing caveats. **Distinct from the demo sales screen (Tier A #1):**
  AEAT filing completeness (asesor-gated), not an owner takings view. See *Open threads → Reporting
  fiscal remainder*.
- **Printing cloud-poll transports + expo device kind** — the subsystem, KDS, receipt + cash-drawer
  are all built; a single-printer demo needs none of the rest. See *Open threads → Printing*.
- **Cloud trial on-ramp** — gated on Waitron-cloud infra that **does not exist yet**; the demo runs in
  dev. See *Open threads → Onboarding, cloud trial & distribution/failover*.
- **Recipes → stock → procurement (depth)** — recipe-authoring is built; plate costing / stock
  depletion / suppliers/POs is post-demo product depth. See *Open threads → Recipes*.
- **Distribution / deployment / failover remainder** — appliance image, on-device agent, reroute,
  SIF promotion/fencing + till-side failover. See *Open threads → SIF topology*.

**Later / smaller:** SumUp card provider (gated, *Debt*) · D3 payroll export (integrate-not-build) ·
accounting export (SP17) · opening hours & channel sync (SP19) · tip payroll (SP13) · online ordering
(SP15) · the owner-added table-service extensions (per-seat ordering; multiple tabs per table — both
reopen settled TS/KDS decisions, so specced-with-owner, never landed unattended) · **KDS ops polish**
(routing read-back/audit view + station kind; definable kitchen statuses — the order-timing *feature*
is demo Tier B #9, the aging colour-code already ships; see *Open threads → KDS operations*).

**Cloud services — parked for later review (north star, not yet ranked).** The
[cloud-services inventory](superpowers/specs/2026-08-29-cloud-services-inventory.md) catalogues the
paid cloud offering we are building *towards* (the local-first-core + cloud model) and the decision
rules for what belongs in cloud vs. the open-source ELv2 core (online-only-by-nature **or**
bulk-cost economics; everything else is core, and we do not fight the community for a core feature).
**Cloud features come later** — no Waitron-cloud infra exists yet (gates the cloud trial + sync) — but the
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
| 8 | Reporting | daily close, frozen *cierre Z* (VAT-exact + hash chain + *descuadre*), VAT summary, modelo 303 output+input VAT, DR303 file + download route, purchase-invoice UI; **+ `computeTopSellers`, `currentBusinessDay`, 3 dashboard `/reports/` routes (#167)** | **wired to the dashboard — sales screen + business-overview home LANDED (#167)**; fiscal filing remainder parked |
| 9 | Deployment | distribution & client-topology design (#86) | onboarding 4b/4c (Phase 0); cloud trial + agent/appliance/reroute parked |
| 10 | Tabs / table service | TS-1 tables+tabs, TS-2 statuses, TS-3 move/join/merge, TS-4 transfer | **TS-5 split-bill + wire TS-3/4 move into the till → demo Tier A #3** |
| 11 | Floor plan | FP-1 live floor + FP-2 spatial canvas/editor — complete | — |
| 12 | KDS / devices | KDS-1 stations/routing/tickets (item→station→printer routing + station-queue order-aging fresh/warm/hot), KDS-2 courses/fire, KDS-3 expo, KDS-4 kitchen printing; device identity-1 (enrol/revoke, `kds_station` kind only) | **handheld/till device kinds → demo Tier A #4**; order timings → demo Tier B #9; routing audit view (*Open threads → KDS operations*); expo device kind; device-scoped fire/collect routes (Debt) |
| 13 | Tips | attribution done (tip on `tenders`) | payroll export (integrate-not-build); card-tips-as-income is a payroll duty |
| 14 | Bookings | Bookings-1 specced + planned | **build it → demo Tier B #6** |
| 15 | Online ordering | — | not started (Later phase) |
| 16 | Workforce | *registro de jornada*, D2 scheduling, roster authoring + approvals, staff request path + portal | D3 payroll export (integrate-not-build) |
| 17 | Accounting export | — | not started (core subset; extends Reporting) |
| 18 | Menu/recipes/allergens | EU-14 allergens, recipe/BOM allergen-inheritance, recipe-authoring UI, product images | **ordering modifiers (demo Tier B #7) + menu draft/schedule/assign (Tier B #8)**; nested sub-recipes / plate costing / stock depletion parked |
| 19 | Opening hours & channel sync | — | not started (Google Business Profile / Maps) |
| 20 | Procurement & inventory | received purchase invoices (`@waitron/purchasing`, feeds modelo 303) | suppliers/POs/goods-in/stock/3-way reconcile/reorder (parked, post-demo); AI forecast deferred |

**Cross-cutting infra:** sync/replication (outbox + transport + payments fast lane + per-peer
`sync_peers` auth + retention — see *Open threads → Sync*) · SIF topology (`#33`, `node_id` re-key — see *SIF
topology follow-ups*) · device identity-1 · printing subsystem (`@waitron/printing` —
agents/outbox/`usb`+`network_tcp` transports/ESC/POS/Impresoras dashboard) · CI/test infra (scoped CI,
pre-push hook, shared-container test rollout, job-sharding).

---

## Open threads (detail)

### Sync completion (Phase 0: C2b LANDED #162; rest parked below the demo)

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
  **C2a — the runtime mechanism — LANDED (#155)** and **C2b — the operator flow — LANDED (#162)**.
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
    **Hardening follow-ups — (1) + (2) LANDED (#164); (3) still deferred:** (1) the unauthenticated
    ambient-admin dashboard is now network-gated — a fail-closed boot guard (`server.mirror_bind_exposed`)
    refuses a non-loopback bind under `mode='mirror'` unless an explicit `WAITRON_MIRROR_ALLOW_EXPOSED`
    opt-in is set (real per-user auth/TLS is still owed to the hosting slice); (2) the read-only
    method-gate hole is closed — `mountPrintApi`/`mountDeviceApi` are no longer mounted under
    `mode='mirror'`, so the write-behind-a-GET (`GET /print-api/agent/jobs`'s `claimPrintJobs`) is
    404-unreachable rather than merely inert by table-absence (a later slice that RE-mounts those groups
    on a mirror must convert this boot gate to a request-time gate — promotion-runbook §3a, and read-only-
    gate.ts's own header records the tradeoff); (3) STILL DEFERRED — the promote **action** itself +
    starting the primary-only workers on promotion (gated on reserved-SIF staging).
  - **C2b — the operator flow. LANDED (#162).** The primary emits a **"mirror bundle"** from an
    admin-gated `POST /management-api/mirror-bundle` (new `mirror.create` permission): the venue's five
    identity ids + full parent rows + CA + relay coords + a freshly-minted per-peer sync token. The setup
    wizard gains a **primary/mirror** role screen → connect-to-primary screen whose mirror path POSTs
    `/setup-api/adopt`, runs **`adoptVenue`** (insert `tenants`/`locations`/`nodes`/`tills`/`invoice_series`
    with the primary's **explicit** ids, **no `registerSif`** — re-registering forks the unrepairable hash
    chain), seals the token in the mirror's **own** vault (`sync.mirror_token` purpose), writes a
    `mirror_config` singleton, and restarts into C2a's mirror mode. Connection config moved from env to
    DB+vault. Spec + plan:
    [c2b-operator-flow](superpowers/specs/2026-08-29-sync-cloud-mirror-c2b-operator-flow-design.md).
    **Deferred follow-ups — (1) + (2) LANDED (#164); (3) + (4) still deferred:** (1) `WAITRON_SYNC_DATABASE_URL`
    is now threaded through adopt into `trading.env` — a wizard-adopted mirror gets its sync-pool URL, and
    adopt fails LOUD (`server.config_missing`) if the deploy env lacks it, rather than silently at reboot;
    (2) the blind SSRF on `/setup-api/adopt`'s `primaryUrl` is closed — `assertSafePrimaryUrl`
    (`mirror.primary_url_invalid`, backed by Node's `node:net` BlockList) rejects non-http/https schemes and
    private/link-local/CGNAT/metadata/IPv4-compatible(::/96)/IPv4-mapped literal IPs, loopback over http/https,
    non-loopback DNS/public-IP https-only (literal-IP SSRF only — DNS-rebinding is #4's concern);
    (3) STILL DEFERRED — mirror fidelity: `adoptVenue` nulls the two out-of-scope FK columns
    (`locations.catalogue_id`, `tills.receipt_printer_id`); the nulling is deliberately correct, restoring
    the pointers needs config replication (carry catalogues in the bundle or sync `locations`); (4) STILL
    DEFERRED — the first-contact trust bootstrap for an untrusted-network primary (gated on real hosting;
    constraint recorded in the spec §9 and `mirror-bundle-fetch.ts`). Plan:
    [cloud-mirror-hardening](superpowers/plans/2026-08-29-cloud-mirror-hardening-followups.md).
- **Multi-tenant transport** — a whole-log reader role.
- **Fiscal-lane / hash-chain sync (H2)** — the `registros`/hash-chain lane, deliberately excluded so
  far; a separate owner-reviewed slice.
- **HARD GATE — the `dining_tables` enrolment is DONE in C1 (#153).** The ordered lane no longer stalls
  when a counter-delivery order (`delivery_table_id` FKs `dining_tables`) is applied — `dining_tables`
  and its runtime-mutable parents are enrolled with the correct `fkRank`. **Still to do:** enrol
  `kitchen_stations` / `ticket_items` when the multi-node/cloud-mirror kitchen-sync slice lands (both
  were built single-writer-per-row).

### Reporting fiscal remainder (parked below the demo)

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

### Printing + hardware surface (built; remainder parked below the demo)

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

### KDS operations — routing, order timings & status config

Grouped operational-config findings (verified 2026-08-29), mostly already BUILT; the gaps are
low-priority unless noted.

**Order routing — BUILT, composes into the demo.** Three layers, each with a working UI:

- **Item → station:** `products.station_id` (per-product override) `??` `categories.station_id`
  (category default) `??` the location's single `is_default` station; resolved + **snapshotted** at
  fire time (`working-order.ts:677`), fails loud `station.no_default` (food is never silently dropped).
  Set via the product form + category manager; stations CRUD'd on the kitchen screen. One item → one
  station.
- **Station → printer:** `station_printers` m2m (KDS-4) + per-printer station toggles on the Impresoras
  screen; `printers.ticket_scope` picks a per-station ticket vs one consolidated PASE/pass ticket.
- **Receipt → printer:** per-till `receipt_printer_id` (= the cash-drawer kick) + per-location
  `receipt_print_mode` (`auto`/`on_request`/`never`).
- So "drinks → bar printer, food → kitchen printer, grill → grill station" is configurable **today** by
  composition (create stations → attach printers → route categories/products). **Gaps (low priority):**
  a **routing read-back / audit view** (the station selects are set-only — no consolidated "which items
  go where"; the most useful to close, a demo-config friction point); **no station `type`/`kind`**
  (bar/kitchen/grill/pass is name-only convention, not data); **single-target only** (no fan-out to
  kitchen AND expo, no per-modifier/per-time rules — post-demo).

**Order timings — PARTIAL** (owner wants "spot orders taking too long / forgotten", 2026-08-29). The
till KDS **station queue already ages every order** — coloured by how long its oldest line has waited,
buckets **fresh <5 min / warm <10 / hot ≥10** with an "N min" label (`station-queue.ts:405-434`,
injectable clock), so the demo already SHOWS slow orders. **Missing to make it a feature:**
owner-**configurable thresholds** (5/10 are hardcoded), **active overdue/forgotten alerting +
escalation** (today it's passive colour — no alert when an order crosses a line or sits unbumped), and
a **manager/expo overview** of overdue orders across stations (the dashboard has no "orders taking too
long" view). Base aging demos today; the enhancement is **elevated to demo Tier B #9** (owner,
2026-08-29).

**Status config.** **Table/service statuses — BUILT** (TS-2 `service-status-screen`: full CRUD of
label / colour / order / active). **Kitchen statuses — PARTIAL:** `bump_mode` (line/ticket) +
`fire_control` (waiter/kitchen) are configurable fixed enums on the kitchen screen; a
**user-definable kitchen-status list** (the table-status editor's equivalent) does NOT exist — kitchen
tickets run a fixed queued→preparing→bumped lifecycle. Low priority (owner, 2026-08-29).

### Onboarding, cloud trial & distribution/failover (Phase 0: onboarding 4b/4c; rest parked)

Distribution & client-topology design landed (#86,
[spec](superpowers/specs/2026-08-15-distribution-and-client-topology-design.md)): cloud-hosted is a
**first-class mode**; production uses **Postgres everywhere** (PGlite demoted to dev/test/demo).

**Onboarding free-tier — slices 1–3 + 4a LANDED** (#137/#139/#141/#142/#143/#146/#159): the browser
first-run flow — serve the built SPAs → setup-mode boot → self-signed CA + persisted box secrets →
`POST /setup-api/provision` (demo/live fork, AEAT cert sealed for live only) → discovery + trust page
→ box-status/time-health. Spec:
[appliance-onboarding](superpowers/specs/2026-08-26-appliance-onboarding-design.md). **Slice 2b is
venue-only (R1)** — the full `instance` role-split is deferred to the appliance image (see *Debt →
Provisioning/build*).

**Phase 0 remainder — onboarding 4b then 4c:**

- **4b split 4b-i / 4b-ii / 4b-iii.**
  - **4b-i — recovery bundle + the 4a follow-ups — LANDED #161**: an operator downloads a
    passphrase-encrypted **recovery bundle** of the box's unrecoverable secret files — `secrets.env`
    (vault master key) + `trading.env` (venue identity) + the `tls/` CA/leaf quartet, **not** the DB —
    via the management-gated `POST /api/box/recovery-bundle`, and opens it with `waitron-recovery
    unpack`. Envelope: scrypt (N=2¹⁷, OWASP 2024) + AES-256-GCM, 12-char passphrase floor,
    hostile-envelope-hardened, path-traversal-guarded on unpack. Folds in the **4a follow-ups**: *(i)*
    an `apps/server` test pinning box-status's boot closure `withTenant`-wrapping through a real
    `sync_tailer` pool; *(ii)* surface **`singleton_role`** (#158) alongside `mode` in box-status;
    *(iii)* keep `collectBoxStatus`'s `replicationLag` **fail-loud**; *(iv)* a fractional-day
    cert-expiry test case. (The recovery route maps `recovery.state_incomplete` to HTTP **500** — a
    box that lost its own secret files is a server fault — but per the `error-boundary` convention an
    `AppError` is logged at `warn` regardless of the mapped status; only an unexpected non-`AppError`
    takes the `error`/opaque-500 branch.)
  - **4b-ii — scheduled DB backup — LANDED #163**. A scheduled worker takes one `pg_dump`
    (`--format=custom`, so the whole DB incl. `sync_log`) into `WAITRON_BACKUP_DIR` each tick, prunes
    to the newest `WAITRON_BACKUP_RETAIN` dumps (default 7), and wires the newest dump's age +
    staleness into box-status's `backup` field (`{ configured, lastBackupAt, ageSeconds, stale }`;
    never-run reads stale-by-definition). Decision held: **`pg_dump`, not WAL/continuous archiving**
    (too much overhead, owner call). **Opt-in + fail-closed** the same way sync/tunnel are:
    `WAITRON_BACKUP_DIR` is the off-switch (unset/empty → backup off), and when it IS set a privileged
    `WAITRON_BACKUP_DATABASE_URL` is **required** — a blank one throws `server.config_invalid` and
    fails boot loud (never resolves to the "empty connection string is a valid connection string" trap,
    §3). PRIMARY-only (a mirror's primary owns the duty — same `!isMirror` gate as retention).
  - **4b-ii correctness crux + deferred dependency.** A boot-time **RLS probe**
    (`assertBackupCanReadFiscal`) refuses to enable backup unless the backup connection is
    `rolsuper OR rolbypassrls`: under FORCE ROW LEVEL SECURITY a non-bypassing role's `pg_dump` either
    ERRORS loudly (default `row_security=off`) or, run `--enable-row-security`, SILENTLY emits a
    per-tenant-truncated (empty) fiscal dump — the unrecoverable failure. The probe is the correctness
    guard (prove-by-deletion with real roles). **Deferred dependency, prominent:** no BYPASSRLS/superuser
    role exists in the production role model yet — the privileged backup connection is **operator-supplied**,
    and provisioning that role is deferred to the **parked appliance-provisioning layer** (the same place
    the real runtime admin connection is deferred). In dev/CI it is the container superuser.
  - **4b-ii fail-safe (§5) + follow-ups.** A misconfigured or unreachable backup connection — a fenced
    role, a dead `WAITRON_BACKUP_DATABASE_URL`, any probe error — leaves backup **OFF** with a logged
    `backup.disabled_rls_fenced`, and **never aborts boot or blocks trading** (nothing may block a sale,
    §5); only config-SHAPE errors (dir set, url blank) fail boot loud (fail-closed, like sync/tunnel).
    Follow-ups noted: the `realPgDump` JS wrapper is **v8-ignored** (its correctness proven via a
    docker-exec `pg_dump` smoke, not the wrapper itself — same posture `time-health.ts`'s `defaultRun`
    takes); and the boot probe has **no connect-timeout**, so a hung backup DB would stall boot exactly
    as any boot-time DB query does — worth a bounded connect later.
  - **4b-iii — cold-restore / fresh-chain runbook — WRITTEN** (docs-only, lands direct to main):
    `docs/superpowers/plans/2026-08-30-onboarding-slice4b-iii-cold-restore-runbook.md` turns
    promotion-runbook §5d into a concrete operator procedure against the *built* tooling — restore the
    4b-ii `pg_dump` (`pg_restore`), unpack the 4b-i recovery bundle (`waitron-recovery unpack`), pass
    the environment handshake, then **mint a FRESH SIF via `register-till` (NOT the wizard, which
    `setup.already_provisioned` blocks) BEFORE the first sale** so the box cannot resume the restored
    chain (the one unrecoverable huella fork), go live `(primary,primary)`, reconcile the lost tail at
    month-end (`consultar`, not a go-live gate). Confirmed: no code needed — the box cannot self-detect
    a restore (a normal restart also continues the chain), so the fresh-SIF ordering is
    operator-enforced by design, and the fresh-chain machinery (`registerSif` — new installation number
    + chain-head reset) already exists. **Gap surfaced (follow-up):** `register-till`/`registerSif` do
    NOT freshen the invoice **series**, but AEAT dedup keys on `(NIF, series, date, número)` (not the
    installation number), so the design's "disjoint series on re-mint" is unmet — a same-day post-backup
    invoice-number **collision** risk (non-catastrophic, backstopped by AEAT error `3000`; NOT the chain
    fork). **Follow-up: a disjoint-series option for the cold-restore re-registration path.**
- **4c — break-glass — implemented on `feat/onboarding-4c-break-glass`** (a post-merge docs commit
  flips this to LANDED). An on-box **`waitron-break-glass`** CLI (the "local console" of spec §12/§17,
  resolved 2026-08-30 to a loopback CLI; held-button/recovery-boot are firmware, parked) resets a
  locked-out admin's dashboard **password (+ PIN) and reactivates** a suspended admin, for the box's
  single `WAITRON_TILL_TENANT_ID`, targeting `role='admin'` (0 → error, N → refuse + `--person`).
  Gate: physical shell + the box's `DATABASE_URL`; the new credential rides **env, never argv**; the
  ungated reset is **confined to the CLI command** (no reusable identity export), runs `withTenant`
  under the app role's RLS, and prints a `break-glass: reset admin <id> …` line to stdout (never the
  secret) — **no chain impact.** Passkey-revocation out of scope; a durable admin-action audit record
  (the CLI only writes stdout today) is a noted follow-up. **Factory reset stays design-only**
  (chain-destructive; `docs/superpowers/plans/2026-08-30-onboarding-slice4c-factory-reset-design.md`).
  **→ Slice 4 (onboarding backup / status / break-glass) is now COMPLETE: 4a #159, 4b-i #161, 4b-ii
  #163, 4b-iii runbook, 4c. Remaining onboarding slices 5–7 (AP-mode firmware / OS image / paid
  real-cert) stay parked (firmware/OS/paid).**

**Load-bearing constraints for the firmware slices (5–7, parked — AP-mode / OS image / paid
real-cert):**

- **A setup box's `/health` returns 503 by design** (no duty loop → not trading-healthy); a
  liveness/supervisor probe must gate on **`/setup-api/status`** (200), or it restart-loops an
  unprovisioned box.
- **The per-device "is the CA trusted?" check is deferred to a browser-behaviour spike** — spec
  §17/§18's "untrusted-CA origins block SW/PWA/WebAuthn until trusted" is load-bearing and unverified;
  the trust page instructs + offers the download/QR but does not assert trust state.

**Parked below the demo (distribution / failover):**

- **Cloud trial on-ramp** — same-origin PWA pointed at a cloud instance; preproduction, shared demo
  tenant. Gated on Waitron-cloud infra that does not exist yet.
- **Identity-config flow-down** (own spec) — `sessions` + the `identity` package are outside the sync
  set, so a failover **logs the user out today**. Identity *config* must flow to a read-only secondary
  the way catalogue does; the *session* must not replicate. Re-establishment: PIN-re-prompt v1 →
  portable signed token later.
- **On-device agent** (own spec/spike) — the enabler for a till to host a print agent (a single-box
  venue's only box-death printing path); **requires a native app**, so **parked behind the go-native
  decision**.
- **The reroute** — the till reaches any live server (selling is active-active) behind a stable local
  origin.

*Minor debt (from #143):* two QR libraries coexist — `qrcode` (`apps/server`) vs `apps/till`'s
fiscal-pinned `qrcode-generator` — unify into `packages/shared` later; and a generalized top-level
boot teardown for the pre-existing `readOrderFlow`/`buildCardProvider` boot-throw pool-leak in
`boot.ts` (moot in prod — process exits) remains deferred.

### Recipes → stock → procurement (post-demo depth)

The **recipe/BOM is the linchpin**: it drives allergen derivation (done), plate costing, and
sales → ingredient consumption → purchasing quantities. Backend allergen-inheritance and the
recipe-authoring UI are built.

- **Recipes remainder:** nested sub-recipes; **plate costing**; **stock depletion per sale** ("150 g
  ham used"); variants; customer-facing browse.
- **Inventory / procurement (SP20), greenfield, downstream of recipes:** suppliers, purchase orders,
  goods-in, stock, 3-way PO↔goods-in↔invoice reconciliation, par-level reorder. The **AI
  demand-forecast reorder is deferred** — build the deterministic system first. Received supplier
  invoices are already captured (`@waitron/purchasing`) and feed the accounting/modelo-303 side.

### Table-service completion (TS-5 + Bookings-1 pulled into the demo; rest parked)

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
fence-then-claim-submitter attestation gate. **Its implementation plan is written, and the first slice —
local secondary → primary, in-process — LANDED (#160).** C2a built the
`deployment.mode` *seam*; this slice adds the runtime **holder refresh** (`deployment-holders.ts`) and the
in-process `promoteLocalSecondaryToPrimary` (`promote.ts`), so a fence-attested local-secondary promote
flips `singleton_role` live and the fiscal drain/reconcile pass starts on the next tick with **no restart**
(a real-PG e2e proves the tills answer throughout). Still deferred: the mirror→primary **mode** flip that
opens the read-only gate live, and starting the singleton-role-gated workers (sync source / retention /
backup / tunnel, re-gated onto `singleton_role` in #168) at runtime (Slice 3).

- **Promotion + fencing tooling and the till-side failover list** — the promotion-runbook *design* is done
  (its own spec, above), and its **foundation slice LANDED (#158)**: the `deployment.singleton_role` axis
  (migration `0071` + accessors + the `(mirror, primary)` CHECK + the `setDeploymentMode('mirror')`
  co-set) and the `singletonPass` helper gating the fiscal drain/reconcile pass on it (read per-pass, so a
  future promotion flips it with no restart). The fiscal pass moved to the new axis first (#158); the sync
  source / retention / backup / tunnel + the mirror-bundle endpoint followed (#168, below). The read-only
  gate / ambient viewer / device+print mounts stay on `mode` (a mirror serves read-only; a sell-only
  secondary still sells). Fixes the active-active correctness bug (a local secondary would otherwise run
  the AEAT submitter — and, before #168, duplicate the source/retention/backup/tunnel duties); today's
  primary + C2a mirror are byte-identical.
  The promote *action* is being built slice by slice (plan:
  `docs/superpowers/plans/2026-08-29-promote-action-slice-1-local-secondary.md`). **Slice 1 — local
  secondary → primary, in-process — LANDED (#160):** the fence-attestation
  gate + the idempotent `promoteLocalSecondaryToPrimary` (owner-write `singleton_role`→primary + live holder
  refresh; fiscal pass starts next tick, no restart), exposed as an in-process `StartedServer` method,
  real-PG e2e proven. **Remaining slices, each gated on an unbuilt foundation:** Slice 2 — the authenticated
  endpoint + break-glass auth + the real runtime admin connection (gated on the break-glass mint; the write
  today uses `migrationsDatabaseUrl`, dev-correct only — see spec §4); Slice 3 — mirror→primary + the
  worker-lifecycle manager (gated on reserved-SIF staging, §3f.1); Slice 4 — cold restore (gated on the
  backup regime, §5d/§9); Slice 5 — rejoin-as-secondary + the conflict watcher (gated on the membership
  wire-protocol, §9.1). **The #158 follow-on — re-gating the singleton duties — LANDED (#168):** the sync
  source, retention sweep, scheduled backup, tunnel client, and the retention-dependent mirror-bundle
  endpoint now gate on a boot-time `isSingletonPrimary` (`singleton_role='primary'`), not on `mode`, so a
  sell-only local secondary (`primary`,`secondary`) runs NONE of them — fixing the active-active
  duplication for those duties (the other #158 follow-on, the `(primary, secondary)` boot assertion, was
  already e2e-proven by `boot.promote.test.ts`, and `boot.singleton.rls.test.ts` now pins the duty gates
  directly). Still boot-time, not live: starting these on an in-process promotion is Slice 3's
  worker-lifecycle manager. **Follow-up (odd job):** consolidate the duplicated `boot.*.test.ts` helpers
  (`withCapturedStdout`/`waitForEvent`, and the pre-existing `freePort`/`poll`/`seedIdentity`) into a
  shared `apps/server/src/testing/` module. The rest of the
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
itself a task with a lead time (a parallel human task — worth starting, but blocks nothing in the demo).

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

- **Localized `descriptions` maps are keyed inconsistently across the tree (#167).** Grep on
  2026-08-30: `descriptions: { "es-ES"` appears ~123× (full BCP-47 tag, the invoice/receipt path —
  `receipt-ticket.ts`/`kitchen-print.ts` look up `descriptions[invoiceLocale]`) vs `descriptions: { es`
  ~62× (short subtag, the catalogue/product path — `product-list.ts`/`recipe-screen.ts` look up
  `descriptions["es"]`). So there are **three near-identical resolvers** with divergent key assumptions.
  #167's dashboard `localizedName` now tries full-tag → short-subtag → first-value, which is robust to
  both, but the underlying inconsistency is unresolved: **(1)** pick ONE key convention at the data
  layer (what products/`sale_lines` actually store), and **(2)** route `product-list.ts`/`recipe-screen.ts`
  through the shared `localizedName` (generalizing its fallback arg) so one resolver serves all. Latent
  bug for genuinely bilingual venues (`invoiceLocales` of two langs is a first-class config); harmless
  while venues are single-locale.

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
- **Onboarding slice-2c follow-ups (h–o) — ALL LANDED** (#147–#151, 2026-08-27..28); deleted from
  here as finished. Detail in those PR threads.

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
