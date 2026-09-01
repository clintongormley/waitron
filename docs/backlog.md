# Backlog — what to work on next, and why

This file answers **"what should I work on?"** It is state, not history: what is built (one line each),
what is open, and the order to take it in. The git log, the PR threads, and the committed
specs/plans in `docs/superpowers/` hold the detail — do not paste receipts back in here.

> **Decluttered 2026-08-31.** Collapsed the demo Phase-0/Phase-1 threads and the sync/onboarding
> sections back to state after a large landing burst (#160–#185): landed work moved to *What's built*,
> and the `LANDED (#XXX)` mechanism narrative + proof-of-work (test counts, grep-proofs, review
> findings) went back to git history where it belongs. A PR number is kept only as a locator, never a
> receipt paragraph.

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

## Priorities

**North star: a working frontend to demo to a restaurant owner** (owner decision, 2026-08-29) —
runnable on a dev laptop, on-prem, or cloud; **the demo needs none of the cloud sync,
primary/secondary failover, or appliance-hardware track.** Rank by what a restaurant owner will
notice, not by infra completeness. The soundness-first ordering still governs the *infra* work (under
*Parked*), just beneath the demo until there is something to show.

**Run path:** `pnpm dev:setup && pnpm dev` boots a real till + dashboard on real Postgres — cash +
manual-card sales, live fiscal chaining, no hardware, no cloud, no AEAT cert (till PIN 5555 /
dashboard 1234). `dev:setup` seeds a believable demo restaurant: two menus (~44 products with
per-dish images), a floor plan (3 zones / ~16 tables), staff on PIN 5555, and ~28 days of back-dated
preproduction sales — English by default, Spanish via `WAITRON_SEED_LOCALE=es-ES`. ~25 fleshed-out
screens on one enforced design system.

### Phase 0 — self-contained in-flight threads — COMPLETE

- **Onboarding Slice 4** (backup / status / break-glass) — **DONE** (4a #159, 4b-i #161, 4b-ii #163,
  4b-iii cold-restore runbook, 4c break-glass #166). Onboarding slices 5–7 (AP-mode firmware / OS
  image / paid real-cert) stay parked. Detail + remaining follow-ups under *Open threads → Onboarding*.
- **Sync cloud-mirror C2b** (operator flow) — **DONE** (#162). Deferred follow-ups under *Open
  threads → Sync*.
- **Promotion Slice 1** (local secondary → primary, in-process) — **DONE** (#160). The remaining
  promote-action slices stay **PARKED** (gated on unbuilt foundations — break-glass mint, reserved-SIF,
  backup regime; the demo never touches them). Detail under *Open threads → SIF topology*.

### Phase 1 — the demo build (ranked)

Tiers A/B/C = "an owner notices in five minutes / an owner will ask / defer past a first demo or
behind-the-scenes".

**Tier A — an owner notices in the first five minutes — COMPLETE.** Sales screen + business-overview
home (#167); grouped sidebar + email login (#172) with admin-email captured at onboarding (#175);
split/move/merge (#174) + TS-5 split-bill (#178, #181); tableside handheld ordering + cash-at-table
(#173, #176). See *What's built* rows 7/8/10/12. **Remaining is only deferred follow-ups:** handheld
live updates and the per-device layout editor (both under *Debt → cross-cutting engineering*).

**Tier B — an owner will ask; product-defining:**

- **#7 Ordering modifiers / variants** — LANDED (#184). **Open follow-ons, each its own slice:**
  - **Modifier ↔ allergen association** — LANDED (#187). Per-option add/remove EU-14 overlay on
    `option_group_items` (nullable `add_allergens`/`remove_allergens`, migration 0085) folded by one
    shared pure `deriveAsServedAllergens` (**Cautious** policy: an unreviewed base stays pending &
    removes are ignored, a remove clears may_contain, an add wins a conflict); surfaced on the till
    order line (client-side deep import) + the KDS/expo tickets (server) + dashboard authoring.
    **Non-fiscal**, pinned by a huella-invariance test (legally load-bearing, EU 1169/2011). Rebased
    onto #186 (both touch `option_group_items`). **Open follow-ons:** (a) **owner UX call** — a plain
    modifier-less *unreviewed* dish shows "not fully reviewed" on the KDS but is suppressed on the till
    (the KDS errs safe, spec says pending shows "on every surface"; pinned by a test — align the two if
    the owner prefers); (b) extract the shared `#allergens` render + CSS across
    basket/station-queue/expo (~90 lines duplicated); (c) fold the base-allergen `products` join into
    the main KDS queue select (one fewer read).
  - **Dietary classification** — LANDED (#190). Contains-meat/fish tags + vegan/vegetarian
    (derived from a per-ingredient `dietary_origin`) + halal/kosher (manual), with a per-dish manual
    override and per-option as-served overlays; surfaced on the till menu diet filter + basket +
    expo/KDS badges + the dashboard recipe/product/option authoring UIs. **Cautious** posture: an
    unreviewed ingredient reads diet "unknown", never a false positive. The
    **customer-facing menu surface stays PARKED** (its own future sub-project); the published product
    `diet` field is ready for it.
  - **Order-line customisation** — LANDED (#193). Per-line free-text `note` ("hold the mayo",
    "hold the onions") reachable on EVERY basket line via a per-line editor (fast-add preserved) + a
    `doneness` picker (rare…well_done) that appears only for meat dishes (gated on the dietary
    `diet.contains` ∋ meat — consumes #190's `meat` origin). Both are **KITCHEN-only, NON-FISCAL**:
    snapshotted onto `ticket_items` at fire, never in `sale_lines`/the huella (pinned by a
    huella-invariance guard). Rendered on the till basket, station queue, expo, and printed kitchen
    ticket. Deferred follow-up (post-fire tab-line edit): editing note/doneness on an ALREADY-SENT
    tab line (post-fire drawer `TabLine`) is NOT supported — it would need a new server endpoint +
    re-fire semantics; today both are set at the ordering stage, before send. Parked.
  - **Counter/walk-up kitchen fire — NEXT (follow-up to #193, run after a context clear).** The
    COUNTER/walk-up basket shows the note/doneness editor and the server validates + persists both on
    `working_order_lines`, but the walk-up `/api/sales` path (`recordTillSale` → `createOpenOrder`)
    **never calls `fireLines`**, so a note/doneness typed on a counter sale reaches no kitchen surface
    (KDS/expo/printed ticket). The owner confirmed (2026-09-01) that **counter food DOES go to the
    kitchen**, so this is real work, not a UI-hide. Make the counter/walk-up sale path fire kitchen
    tickets (mirror how the table/tab round path funnels into `fireLines`, snapshotting note/doneness
    onto `ticket_items` at fire), then extend the KDS/expo/print reads to cover counter-fired tickets.
    Wire/state plumbing already exists (note/doneness on the wire `SaleLine`, `working_order_lines`,
    and the snapshot columns); only the **counter fire path + its reads** are missing. Surfaced by the
    #193 whole-branch review; verify the fiscal boundary stays intact (counter fire must NOT thread
    note/doneness into `sale_lines`/`computeHuella` — same guard as #193).
  - **Per-option quantity** ("extra shot ×2", author-capped by `option_group_items.max_quantity`,
    priced per dish) **+ dish-line quantity** (a −/N/+ stepper on each basket line, no auto-merge of
    identical lines) — LANDED (#186). Deferred follow-ons: on-screen **expo / station-queue / tab**
    modifier `×N` (needs the server queue reads to carry the option count — the printed kitchen ticket
    already shows it); `min_select`/`required` now count the SUMMED per-option quantity like
    `max_select` (one consistent tally — only differs from distinct-count when `min_select > 1`;
    revisit if a menu ever needs distinct-count minimums).
  - **Small deferred cleanups** — share `kitchen-print`'s child-line read with `working-order.ts`'s
    `readModifiersByParent`; lift `catalogue-api`'s `parseOptionalInteger` + the dashboard pick-list
    add/move/remove into shared helpers; hoist the `groupByParent` receipt/till mirror to
    `packages/shared`.
  - **TS-4 partial-transfer guard** — when the unwired partial-transfer UI lands, `transferLines` must
    keep refusing a modifier child split from its parent (today `tab.transfer_modifier_line`; the picker
    just doesn't expose partial yet).
- **#8 Menu-management depth** — Slice A (location↔menu membership dashboard) LANDED (#177, #179).
  **Remaining (both greenfield, no owner decision pending):** a menu **draft/published** state (only an
  `active` bool today) and **time-of-day / seasonal scheduling**. (Per-till persisted menu selection was
  DROPPED — owner call; a switch stays temporary.)
- **#9 Order-timing alerts** (overdue / forgotten) — LANDED (#185). **Deferred follow-ups** (spec §13):
  delivery-order floor flash (`timingBand` is tab-scoped); idle-floor escalation (floor advances a band
  only on its next refetch); real-time push; station-kind threshold defaults; an unbumped-since-fire
  neglect metric; a shared flash helper.
- **#6 Reservations (Bookings-1)** — LANDED (#180, #182). **Future** (Tier-B/C, each greenfield):
  public/online/QR booking, availability/double-booking prevention, reminders (SMS/email), a
  customer/CRM entity, recurring bookings, a calendar grid, deposits.

**Tier C — valuable, but defer past a first demo or behind-the-scenes:**

10. **Square (and generic CSV) menu import — as a product feature.** The full dashboard flow (auth to a
    Square account, map its catalogue, ongoing re-import) — a switching-cost story for an owner leaving
    Square. Spike outcome (2026-08-29): a one-off import is NOT the cheap seed path (the demo menu was
    hand-authored). MISSING; greenfield + external API.
11. **Definable roles with selectable privileges.** Roles are a fixed 4-value enum + a code-defined
    permission map (`packages/identity/src/permissions.ts`); data-driven RBAC + a role-editor is a large
    backend change. Demoable on the fixed roles for now.
12. **Payment-provider config UI** (Stripe / SumUp / …). No dashboard UI today (provider is env-stamped,
    sealed via the credentials CLI) and no SumUp integration at all; also gated on the unanswered SumUp
    offline question (*Debt → SumUp*). Behind-the-scenes for a demo.
13. **AEAT cert / Veri*Factu management UI.** First-run only today (`apps/setup` cert screen);
    `cert-expiry.ts` monitors but there is no view/rotate/renew surface. Behind-the-scenes.
14. **Hardware config profiles per device kind.** No profile abstraction exists; lowest demo value.

### Parked below the demo (real, but not until there's something to show)

- **Engage a fiscal advisor** — a parallel *human* task (long lead time), not a build; worth starting,
  blocks nothing in the demo. See *The advisor gap*.
- **Sync completion beyond C2b** — fiscal-lane / hash-chain sync (H2, owner-gated), multi-tenant
  transport, cloud-mirror C-remainder follow-ups. See *Open threads → Sync*.
- **Reporting *fiscal* remainder** — modelo-303 filing boxes (rectificativas 40/41, prorrata 44,
  intra-community 32–39) + two pre-filing caveats. Distinct from the demo sales screen (Tier A #1):
  AEAT filing completeness (asesor-gated), not an owner takings view. See *Open threads → Reporting*.
- **Printing cloud-poll transports + expo device kind** — the subsystem, KDS, receipt + cash-drawer are
  built; a single-printer demo needs none of the rest. See *Open threads → Printing*.
- **Cloud trial on-ramp** — gated on Waitron-cloud infra that does not exist yet; the demo runs in dev.
  See *Open threads → Onboarding*.
- **Recipes → stock → procurement (depth)** — recipe-authoring is built; plate costing / stock
  depletion / suppliers/POs is post-demo product depth. See *Open threads → Recipes*.
- **Distribution / deployment / failover remainder** — appliance image, on-device agent, reroute, SIF
  promotion/fencing + till-side failover. See *Open threads → SIF topology*.

**Later / smaller:** SumUp card provider (gated, *Debt*) · D3 payroll export (integrate-not-build) ·
accounting export (SP17) · opening hours & channel sync (SP19) · tip payroll (SP13) · online ordering
(SP15) · the owner-added table-service extensions (per-seat ordering; multiple tabs per table — both
reopen settled TS/KDS decisions, so specced-with-owner, never landed unattended) · **KDS ops polish**
(routing read-back/audit view + station kind; definable kitchen statuses). See *Open threads*.

**Cloud services — parked for later review.** The
[cloud-services inventory](superpowers/specs/2026-08-29-cloud-services-inventory.md) catalogues the
paid cloud offering we build *towards* (local-first-core + cloud) and the decision rules for cloud vs.
the open-source ELv2 core (online-only-by-nature **or** bulk-cost economics; everything else is core).
No Waitron-cloud infra exists yet (gates the cloud trial + sync); on-prem work is built toward the
inventory (single-writer-per-row for sync, "make the box reachable" as one capability). Review into
real slices when cloud work starts.

---

## What's built (state per sub-project)

Architecture §2's twenty sub-projects, plus the cross-cutting infra. "Remaining" is the unstarted or
partial scope; the detail for a live thread is under *Open threads*.

| # | Sub-project | State | Remaining |
| --- | --- | --- | --- |
| 1 | Design system | `@waitron/ui` token layer + primitives (`--wt-*`) | — |
| 2 | Sales spine | Immutable hash-chained sales, per-tenant series, catalogue, tenant model | — |
| 3 | Fiscal layer | Verifactu lib + `FiscalBackend`; settlement, R5 rectificativas, F3 canje, invoice-first | F3 asesor/XSD confirmations (Debt) |
| 4 | Payment layer | `PaymentProvider` + Stripe Terminal, manual card, integrated Stripe, Mode-3 webhook | SumUp provider; webhook `recordSale` hand-off; reconcile remediation UI |
| 5 | Identity | persons/sessions, PIN, `authorize()`, roles/permissions, passkeys, email login | mid-shift-suspension enforce, discount gate, till-refund enforce; encrypt `totp_secret` at rest; PIN-attempt throttle |
| 6 | Locations | provision-a-sellable-venue (`waitron-provision venue`) | multiple locations, edit/deactivate; then location-scope the by-id verb family (Debt) |
| 7 | Counter POS | walk-up cash, park/retrieve, manual + integrated card, prepare & collect, layout/receipt editors, receipt/drawer printing, cash-drawer authorization — operable end to end | — |
| 8 | Reporting | daily close, frozen *cierre Z*, VAT summary, modelo 303 output+input VAT + DR303 file/download, purchase-invoice UI; dashboard sales screen + business-overview home (#167) | fiscal filing remainder parked |
| 9 | Deployment | distribution & client-topology design (#86); onboarding slices 1–4 complete | cloud trial + agent/appliance/reroute parked (slices 5–7) |
| 10 | Tabs / table service | TS-1 tables+tabs, TS-2 statuses, TS-3 move/join/merge, TS-4 transfer, till action-flow wiring (#174), TS-5 split-bill (#178, #181) | core COMPLETE (TS-1..TS-5); owner-added extensions parked (*Open threads → Table-service*) |
| 11 | Floor plan | FP-1 live floor + FP-2 spatial canvas/editor | — |
| 12 | KDS / devices | KDS-1 stations/routing/tickets, KDS-2 courses/fire, KDS-3 expo, KDS-4 kitchen printing, order-timing alerts (#185); device identity-1 (enrol/revoke); handheld + till device kinds (#173, #176) | routing audit view; expo device kind; device-scoped fire/collect routes (*Open threads → KDS / Table-service*) |
| 13 | Tips | attribution stored (`tenders.tip_amount`) — but UI collection ONLY on the integrated-card idle screen | tip-collection UI for cash / manual card / handheld (none today, *Debt*); payroll export (integrate-not-build) |
| 14 | Bookings | Bookings-1 (#180, #182) — staff-entered reservations + seat-opens-a-tab + floor badge + dashboard day-list | public/online/QR, availability, reminders, CRM, recurring, calendar grid, deposits (Future) |
| 15 | Online ordering | — | not started (Later phase) |
| 16 | Workforce | *registro de jornada*, D2 scheduling, roster authoring + approvals, staff request path + portal | D3 payroll export (integrate-not-build) |
| 17 | Accounting export | — | not started (core subset; extends Reporting) |
| 18 | Menu/recipes/allergens | EU-14 allergens, recipe/BOM allergen-inheritance, recipe-authoring UI, product images, location↔menu membership UI (#177), ordering modifiers / option groups (#184), per-option + dish-line quantity (#186), modifier↔allergen overlays (#187), dietary classification (contains-meat/fish, veg/vegan, halal/kosher; #190), order-line customisation (kitchen-only line note + meat doneness) | **counter/walk-up kitchen fire (#193 follow-up) — NEXT**; menu draft/publish + schedule (#8); customer-facing menu surface parked; post-fire tab-line note/doneness edit parked; nested sub-recipes / plate costing / stock depletion parked |
| 19 | Opening hours & channel sync | — | not started (Google Business Profile / Maps) |
| 20 | Procurement & inventory | received purchase invoices (`@waitron/purchasing`, feeds modelo 303) | suppliers/POs/goods-in/stock/3-way reconcile/reorder (parked); AI forecast deferred |

**Cross-cutting infra:** sync/replication (outbox + transport + payments fast lane + per-peer
`sync_peers` auth + retention) · SIF topology (`#33`, `node_id` re-key) · device identity-1 · printing
subsystem (`@waitron/printing` — agents/outbox/`usb`+`network_tcp` transports/ESC/POS/Impresoras
dashboard) · CI/test infra (scoped CI, pre-push hook, shared-container test rollout, job-sharding) ·
localisation (per-user `persons.locale`, live language switch, venue-default derivation) · logging &
diagnostics foundation (Slice 1 #192 — durable rotating logs, request-id correlation, `debug`
verbosity + manager diagnostic-mode viewer, `@waitron/diagnostics` client trail + crash capture;
Slices 2–3 in *Open threads*).

---

## Open threads (detail)

### Logging, diagnostics & one-touch bug report (Slice 1 LANDED #192; Slices 2–3 next)

A "report a problem at the touch of a button" system for non-technical staff, feeding a
**staff → manager → vendor** pipeline. Eventual vendor destination is **GitHub issues**; for now a
bundle only needs to be **copy-pastable** (no cloud-sync dependency). Spec/plan:
`docs/superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md` +
`docs/superpowers/plans/2026-08-31-logging-diagnostics-foundation.md`.

**Slice 1 — logging foundation — LANDED #192.** Server: `debug` level + runtime threshold filtering,
in-memory verbosity controller (auto-reverting diagnostic mode), rotating disk log sink
(`<stateDir>/logs`) + tail-bounded reader, request-id middleware (route-pattern logging, never
bodies/query/concrete paths), error-boundary request-id enrichment, `diagnostics.view` permission +
three gated `/management-api/diagnostics` endpoints, boot wiring. Client: new zero-dep
`@waitron/diagnostics` (ring buffer + value-type redaction guard, injected-target crash capture,
instrumented fetch) wired into till + dashboard, plus a manager-only live-log viewer screen. Redaction
holds end-to-end; nothing blocks a sale.

**Slice 2 — one-touch bug report (NEXT).** `bug_reports` table (tenant-scoped: FORCE RLS + isolation
policy + grants; run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after adding it), a
capture endpoint that **freezes** a self-contained bundle (client trail `snapshot()` +
`LogReader.byRequestIds()` + environment), a `wt-report-dialog` + "Report a problem" trigger in the
till and dashboard chrome, and a copy-pastable GitHub-ready markdown serialiser.

**Slice 3 — triage & forwarding.** Dashboard *Problem reports* screen (list, view, copy, status
transitions) and automated GitHub-issue creation (needs a stored token in `@waitron/credentials`).

**Deferred hardening carried out of Slice 1 (do in Slice 2, when the trail is actually forwarded):**
- Enforce a **key-name allowlist** on the client trail's redaction (today it filters by value *type*
  only — objects/bodies dropped, but an arbitrary secret *string* under any key would pass); and
  scrub `message`/`stack` captured from rejected Errors.
- `maskPath` masks UUID + all-numeric path segments only — mask non-UUID/non-numeric PII segments
  (a slug/email) too before the trail leaves the box.
- Route the dashboard's boot-probe-fail / post-login / logout screen transitions through the nav
  trail (Slice 1 logs only `#selectScreen` sidebar clicks).
- Roll the trail + report button out to `apps/setup`.

### Sync completion (C2b LANDED #162; rest parked below the demo)

Mechanism is decided and slices 1–3 + ops + the cloud-mirror A/B/C1/C2a/C2b are landed:
cross-replication is **application-level** (an outbox — `sync_log` + a generic capture trigger, apply as
the app role under `withTenant`), **not** native Postgres logical replication. Built: commercial-lane
outbox, symmetric HTTP-pull transport + per-peer `sync_peers` auth (#144), payments fast lane, retention
sweep + `waitron-sync-evict`; cloud-mirror identity/auth (A, #144), outbound tunnel (B, #150,
`@waitron/tunnel` proven against a local relay stand-in), the `dining_tables` FK-closure enrolment (C1,
#153), the mirror-mode server (C2a, #155 + hardening #164), and the operator flow (C2b, #162 + hardening
#164). Designs + findings under `docs/superpowers/specs/2026-08-{02,27,28,29}-*sync*` and
`*cloud-mirror*`.

**Remaining, each its own design pass:**

- **Cloud-mirror follow-ups (deferred).** From B (spec §11, within the semi-trusted-relay threat model,
  each self-healing or fail-closed today): the box→relay control-frame splice race; a max pre-`go`
  frame-length guard; ignore-`go`-before-`ack`; a registration/handshake timeout; a `tunnelHttpClient`
  disposal seam for C's long-running subscriber; SNI-based multi-box routing — all owed to the real T1
  relay/client. From C2a: the promote **action** + starting the primary-only workers on promotion
  (gated on reserved-SIF staging — see *SIF topology*). From C2b: **mirror fidelity** — `adoptVenue`
  nulls `locations.catalogue_id` + `tills.receipt_printer_id` (correct today; restoring them needs
  config replication); and the **first-contact trust bootstrap** for an untrusted-network primary (gated
  on real hosting). Plan:
  [cloud-mirror-hardening](superpowers/plans/2026-08-29-cloud-mirror-hardening-followups.md).
- **Multi-tenant transport** — a whole-log reader role.
- **Fiscal-lane / hash-chain sync (H2)** — the `registros`/hash-chain lane, deliberately excluded so
  far; a separate owner-reviewed slice.
- **Kitchen-sync enrolment** — enrol `kitchen_stations` / `ticket_items` when the multi-node/cloud-mirror
  kitchen-sync slice lands (both were built single-writer-per-row). The `dining_tables` HARD GATE is
  closed by C1 (#153).

### Reporting fiscal remainder (parked below the demo)

Spec: [reporting-desglose-and-modelo303](superpowers/specs/2026-08-08-reporting-desglose-and-modelo303-spec.md).

- **⚠️ Two pre-filing caveats a human must clear before the first LIVE 303 filing** (operational, not
  code): (a) validate the generated DR303 file once against the real AEAT sede "por fichero" uploader —
  we emit común + página 1 + página 3 and **omit página 2** (régimen simplificado, out of scope), and
  cannot verify from here that the uploader accepts a página-2-omitted file; (b) an asesor-fiscal must
  confirm the **prorrata** treatment — `computeInputVat` emits the deducible base in full and scales only
  the cuota by `deductible_proportion`; confirm AEAT expects the base unscaled.
- **Deferred build slices:** rectificativas de facturas recibidas (casilla **40/41** — needs a
  `corrects_purchase_invoice_id` self-FK; relax the app-layer non-negative check for credit-note
  negatives, no DB CHECK forbids them); bienes-de-inversión regularización (**43**); the **prorrata rule**
  that sets `deducible_proportion` (**44**, asesor-driven); intra-community/import boxes (**32–39**); a
  libro-registro / **Pre303** export (optional later).
- **Duplicate-invoice-key decision:** `(tenant_id, supplier_tax_id, supplier_invoice_number)` is
  unique-forever today — asesor to confirm per-year vs forever.

### Printing + hardware surface (built; remainder parked below the demo)

The printing subsystem is built and security-reviewed, with kitchen (KDS-4), counter-receipt +
cash-drawer, and cash-drawer authorization consumers landed. Specs/plans under
`docs/superpowers/{specs,plans}/2026-08-17-*` and the failover-printing design. **Remaining:**

- **Cloud-poll transports** — Star CloudPRNT (`printing-cloud-poll-transport*`) and Epson Server Direct
  Print (`printing-epson-server-direct-print*`): a poll→fetch→ack endpoint group off the central outbox,
  token-authed, so a NAT'd printer prints jobs with no agent. (Low priority — single poll URL, no
  firmware failover, but it *does* confirm physical print.)
- **Failover printing** ([design](superpowers/specs/2026-08-26-failover-printing-design.md)) — the
  lease/reclaim for stuck jobs LANDED (#138). Follow-ons: un-pin an IP printer from its single `agent_id`
  (any LAN agent serves; distinct-agents race test + location-scoped-authz review); agents share the
  till's `[local → cloud]` failover list (no outbox replication needed); **a till hosts a print agent**
  (the majority single-box venue's box-death path — high importance, but needs an on-device agent → a
  native app → **parked behind the go-native decision**); at-least-once delivery + active failure
  escalation at the till/KDS (Slice-B).
- **KDS-4 follow-ups:** **device-mode reprint** (a `POST /api/device/orders/:id/reprint` behind
  `requireDevice`, scoped to the device's bound station — the kitchen station most likely to hit a paper
  jam is exactly a device-mode display); **mirrored station-side read** (spec §5's read-only "printers
  serving this station" view — the backing route exists, only a `DashboardApi.listStationPrinters` + UI
  line are missing); **reprint timestamp** (reprint stamps the reprint wall-clock, not the original
  `ticket_items.fired_at`, so a reprint header reads a fresh time — thread `fired_at` through).
- **Counter-receipt deferred niceties:** the per-till printer picker isn't location-filtered; the
  print-mode toggle is set-only (no read-back route).
- **Cash-drawer:** the `drawer_open_policy` toggle is set-only — a read-back route is a reasonable
  follow-up since it gates cash access.
- **Expo device kind** (`expo-device-kind*`) — an `expo_pass` device so the KDS-3 pass screen runs
  always-on, joining KDS-3 to device-identity.

### KDS operations — routing, order timings & status config

**Order routing — BUILT, composes into the demo.** Item→station (`products.station_id ??
categories.station_id ??` the location default; snapshotted at fire, fails loud `station.no_default`),
station→printer (`station_printers` m2m + per-printer scope), receipt→printer (per-till
`receipt_printer_id` + per-location `receipt_print_mode`). "drinks → bar, food → kitchen, grill → grill"
is configurable today by composition. **Gaps (low priority):** a **routing read-back / audit view** (the
station selects are set-only — the most useful to close, a demo-config friction point); **no station
`type`/`kind`** (bar/kitchen/grill/pass is name-only convention); **single-target only** (no fan-out,
no per-modifier/per-time rules).

**Order timings — LANDED** (Tier B #9, #185). Deferred follow-ups listed under *Phase 1 → Tier B #9*.

**Status config.** Table/service statuses — BUILT (TS-2, full CRUD). Kitchen statuses — PARTIAL:
`bump_mode` (line/ticket) + `fire_control` (waiter/kitchen) are configurable fixed enums; a
**user-definable kitchen-status list** (the table-status editor's equivalent) does NOT exist — kitchen
tickets run a fixed queued→preparing→bumped lifecycle. Low priority (owner, 2026-08-29).

**Coursing editing & kitchen corrections — PR #191 (open, ready to land).** Server verbs to move a
held line's course (`setLineCourse`), fire specific held lines / send-all (`sendLines`), hold lines on
send, un-send a not-started line (`recallLines`), and VOID/RECALLED correction slips on recall & void;
till UI for per-line course move, a round-builder hold toggle, and state-gated Send/Recall/Cancel with
a consequence-naming cancel confirm. Non-fiscal throughout (`working_order_lines`/`ticket_items`/print
outbox only). `setLineCourse`/`recallLines` take a `ticket_items … FOR UPDATE` lock so they serialize
against a concurrent `fireCourse` (real-PG race tests). **Deferred follow-ups (each its own slice —
owner decisions 2026-09-01):**

- **Moved dishes keep their kitchen status.** `moveTabLines` (TS-3/TS-4 transfer/merge) deletes+reinserts
  a line under a new id, so its `ticket_items` row cascade-drops — a cooking dish vanishes from the KDS
  at the destination. Decision: the ticket must TRAVEL with the line (re-point
  `working_order_line_id`/`working_order_id` to the destination, preserving `fired_at`/`state`/station/
  course); it keeps its EXISTING status, it is NOT re-fired. No test covers a fired line's ticket fate
  across a move today.
- **Hold-on-send without courses + a venue disable setting.** The hold toggle only renders when the
  venue has ≥1 kitchen course (it lives in the courses-gated per-line strip), though the server holds
  null-course lines fine. Decision: hold-on-send is available BY DEFAULT independent of courses (ungate
  the toggle — render it whenever a round is in progress), PLUS a venue-level setting to DISABLE
  hold-on-send for venues that don't want it.
- **FP-1 renders a child modifier line as its own empty-named tab row.** Pre-existing display shape;
  #191 suppresses its meaningless per-line actions/pickers via a `productId === null` guard, but the
  blank row itself remains — needs a `parent_line_id`/`product_id`-aware tab-lines render (nest the
  modifier under its parent, or skip it).

### Onboarding, cloud trial & distribution/failover (Phase 0 4b/4c COMPLETE; rest parked)

Distribution & client-topology design landed (#86,
[spec](superpowers/specs/2026-08-15-distribution-and-client-topology-design.md)): cloud-hosted is a
**first-class mode**; production uses **Postgres everywhere** (PGlite demoted to dev/test/demo).
Onboarding free-tier slices 1–4 are complete (#137–#166); spec
[appliance-onboarding](superpowers/specs/2026-08-26-appliance-onboarding-design.md). Slice 2b is
venue-only (R1) — the full `instance` role-split is deferred to the appliance image (*Debt →
Provisioning/build*).

**Cold-restore follow-up (from 4b-iii):** `register-till`/`registerSif` do NOT freshen the invoice
**series**, but AEAT dedup keys on `(NIF, series, date, número)` (not the installation number), so the
design's "disjoint series on re-mint" is unmet — a same-day post-backup invoice-number **collision**
risk (non-catastrophic, backstopped by AEAT error `3000`; NOT the chain fork). Add a **disjoint-series
option** for the cold-restore re-registration path.

**Load-bearing constraints for the firmware slices (5–7, parked — AP-mode / OS image / paid real-cert):**

- **A setup box's `/health` returns 503 by design** (no duty loop → not trading-healthy); a
  liveness/supervisor probe must gate on **`/setup-api/status`** (200), or it restart-loops an
  unprovisioned box.
- **The per-device "is the CA trusted?" check is deferred to a browser-behaviour spike** — spec §17/§18's
  "untrusted-CA origins block SW/PWA/WebAuthn until trusted" is load-bearing and unverified; the trust
  page instructs + offers the download/QR but does not assert trust state.

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
fiscal-pinned `qrcode-generator` — unify into `packages/shared` later; and a generalized top-level boot
teardown for the pre-existing `readOrderFlow`/`buildCardProvider` boot-throw pool-leak in `boot.ts`
(moot in prod) remains deferred.

### Recipes → stock → procurement (post-demo depth)

The **recipe/BOM is the linchpin**: it drives allergen derivation (done), dietary classification
(done — per-ingredient `dietary_origin` → product `diet`, #190), plate costing, and
sales → ingredient consumption → purchasing quantities. Backend allergen-inheritance and the
recipe-authoring UI are built.

- **Recipes remainder:** nested sub-recipes; **plate costing**; **stock depletion per sale**; variants;
  customer-facing browse.
- **Inventory / procurement (SP20), greenfield, downstream of recipes:** suppliers, purchase orders,
  goods-in, stock, 3-way PO↔goods-in↔invoice reconciliation, par-level reorder. The **AI demand-forecast
  reorder is deferred** — build the deterministic system first. Received supplier invoices are already
  captured (`@waitron/purchasing`) and feed the accounting/modelo-303 side.

### Table-service completion (core TS-1..TS-5 + Bookings-1 LANDED; rest parked)

The table-service core (TS-1..TS-5), the floor plan (FP-1/FP-2), the KDS displays (KDS-1/2/3), and
Bookings-1 are built. Remaining, greenfield + product-heavy → **specced with the owner, run supervised,
never landed unattended:**

- **Device-scoped fire/collect routes** — a KDS device is advance-only today; a `fire_control=kitchen`
  or expo *device* needs server-side `/api/device/*` fire + collect routes.
- **Owner-added, not yet designed** (each reopens a settled decision — do not read the earlier
  "rejected"/"out of scope" wording as final): **per-seat ordering** (a nullable seat/position on
  `working_order_lines`, non-fiscal — must stay out of the huella; seat-aware KDS/running/split
  consumers); **multiple tabs per table** (turns the single `dining_tables.tab_id` back-pointer into
  one-to-many; ripples through `openTab` lock, `listTablesWithState`, TS-3 merge, and the pay path — pin
  the real driver first, since TS-1 §0 held QR/separate-checks/counter don't need it).

### SIF topology follow-ups (from #33)

The [server-as-SIF + failover design](superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md)
decided the topology; §14 defers the buildable pieces. The
[promotion, failover & node-lifecycle design](superpowers/specs/2026-08-29-promotion-failover-and-node-lifecycle-design.md)
is the first pass over that ground (node role-resolution, physical + membership fencing, per-tab
ownership/failover, disposal, AEAT `consultar` recovery, cloud-failover sizing); its §9 lists seven
still-open items. The [promotion runbook design](superpowers/specs/2026-08-29-promotion-runbook-design.md)
(APPROVED) is what a human's "make this primary" executes across four targets. The
`deployment.singleton_role` foundation (#158) + Slice 1 (local secondary → primary, in-process, #160) +
the re-gating of the singleton duties onto `isSingletonPrimary` (#168) are landed.

- **Promote-action remaining slices** (plan:
  `docs/superpowers/plans/2026-08-29-promote-action-slice-1-local-secondary.md`), each gated on an
  unbuilt foundation: **Slice 2** — the authenticated endpoint + break-glass auth + the real runtime
  admin connection (gated on the break-glass mint; the write today uses `migrationsDatabaseUrl`,
  dev-correct only); **Slice 3** — mirror→primary + the worker-lifecycle manager that starts the
  primary-only workers on an in-process promotion (gated on reserved-SIF staging); **Slice 4** — cold
  restore (gated on the backup regime); **Slice 5** — rejoin-as-secondary + the conflict watcher (gated
  on the membership wire-protocol).
- **Split-brain** — largely worked through by the 2026-08-29 spec (server-level fencing §3.5, per-tab
  single-writer ownership §8, bounded worst case §8.4). Remaining seams: the promoted-node side while
  partitioned (§9.4) and cloud-relay-vs-sink (§9.3). Spans selling, the fiscal chain, payments
  (`resolvePending`) and printing — **examine in detail, not scoped to printing** (owner, 2026-08-26).
- **The submitter as a relocatable role** — one venue submitter, certificate resolved from wherever it
  runs.
- **Till UX for the timed-out card case** (retry / alternative tender / wait).
- **`CLAUDE.md` §5's "nothing blocks a sale" invariant must be rewritten** — but *in the change that
  implements server-as-SIF*, not before (the current code still honours the old wording).
- The reconcile remediation UI and the orphan-drift hold (both under *Debt*) back the design's
  double-charge-across-failover path (§10).
- **New asesor question:** a cloud server that *issues* invoices operates the SIF from a cloud location —
  a stronger form of the §8a hosting question (see *The advisor gap*).
- **Odd job:** consolidate the duplicated `boot.*.test.ts` helpers
  (`withCapturedStdout`/`waitForEvent`/`freePort`/`poll`/`seedIdentity`) into a shared
  `apps/server/src/testing/` module.

---

## The advisor gap

**No fiscal advisor is engaged**, so the open questions in
[compliance/asesor-questions.md](compliance/asesor-questions.md) have nowhere to go.
[compliance/who-to-ask.md](compliance/who-to-ask.md) is blunt: *"every candidate turned out to be a
marketing page. Assume you will be educating whoever you hire."* — so engaging is itself a task with a
lead time (a parallel human task — worth starting, but blocks nothing in the demo).

**The task is a re-read, then engage.** Two architectural shifts changed the question list: [#19] (cloud
is a sync root, not a shared system of record) and #33 (server-as-SIF). Several older questions assumed
**Waitron hosts the client's fiscal system**, which the cloud design abandoned; re-read every question
against *both* designs, drop/rewrite what they invalidated, and add the replacements — three ROF (RD
1619/2012) hosting questions in
[cloud-storage-model §8a](superpowers/specs/2026-07-31-cloud-storage-model-design.md), plus the new
"cloud server issuing invoices operates the SIF abroad" question — *before* paying for answers.

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
layout is the one build dependency** (it fixes the D3 export format, so D3 stays deferred until known).

---

## Debt and odd jobs

Deferred follow-ups from finished work. None blocks anything; each makes later work cheaper. Per-slice
UX/perf nits live in the PR threads and git history; what remains here is cross-cutting or
genuinely-decision-bearing.

**Cross-cutting engineering:**

- **Handheld live updates (SSE/WebSocket).** Deferred from the order-only handheld slice (#173, owner,
  2026-08-30). The app is pull-only today (refetch after each round/serve/fire + manual refresh), so two
  waiters on the same table see stale data until a refetch (the server still guards append-only rounds +
  price-locks). A live push channel — the first real-time in the app — gives live multi-waiter +
  KDS-status-to-handheld updates. Sizable new subsystem, out of step with the pull-only architecture;
  specced separately when it matters.
- **Configurable per-device layout / face-set editor.** Deferred from the same slice. The handheld ships
  a fixed phone face-set as a declarative constant (`HANDHELD_FACES`) keyed by device kind; the owner
  wants this configurable long-term. Additive (pre-production): persist a face-set per device (or kind)
  with a fallback to the constant (the `getLayout`-returns-defaults precedent), add a dashboard editor
  mirroring the layout editor, and — the heavier, separable half — make the **table-order screen itself**
  layout-driven the way the counter screen already is.
- **Tip-collection UI + empty-tab pay-error clarity (till/handheld).** Two payment-UX gaps surfaced
  landing #189. (1) **No tip field for cash, manual card, or the handheld** (row 13): a tip can be stored
  per tender (`tenders.tip_amount`) but the only surface that COLLECTS one is the integrated-Stripe-reader
  idle screen (`till-tender-pay` `#renderCardExtras`, gated on `cardProvider !== "none"` + `tipsEnabled`).
  Building it is a design decision — where the tip is entered per tender type, cash-rounding vs
  card-add-on, and how it reaches `tenders.tip_amount` on the `pay-tab`/`confirm-payment` path. (2)
  **Empty-tab pay shows a generic banner** — `#onPayTab` (`apps/till/src/till-app.ts`) maps every server
  code to one `sale.error` key, so a genuinely empty tab's actionable `sale.empty_basket` reads as "Could
  not complete the sale, try again" (this flattening is what hid the #189 root cause while debugging).
  Surface the specific code with a clearer message.
- **Unify string resolution behind one language-negotiation resolver (#167).** Several divergent
  name/label resolvers (`localizedName`, `lineName`, `product-list`/`recipe-screen`'s hardcoded
  `descriptions["es"]`, `t()`/`pickLocale`) with different fallbacks. Write-side LANDED (#171: venues
  author bare `es`, re-keyed to full-tag `invoice_locales` at the fiscal-line write). **Remaining
  (latent, harmless today):** (1) a shared region-tolerant `negotiate()` (RFC 4647 lookup); (2)
  de-hardcode `product-list.ts`/`recipe-screen.ts`'s literal `"es"` to the venue's primary language; (3)
  give `t()` its missing language-subtag tier; (4) a first-class presentational venue-default UI language
  distinct from fiscal `invoiceLocales`. Plus **authoring-time locale-completeness validation** (a
  product missing a venue invoice-locale's translation graceful-fills rather than being caught at save)
  and **write-side header drift** (`sales.locale`/`sales.invoice_locales` are still stamped by
  `recordSale` from boot-time `cfg`, not from `locations.invoice_locales` like the line re-key — a config
  drift can file a header inconsistent with its lines). **Design:**
  `docs/superpowers/specs/2026-08-30-localization-fallback-negotiation-design.md`. Also: **province →
  language derivation** (`PROVINCE_DEFAULT_LOCALE` is empty, so a Cataluña venue shows Spanish not
  Catalan — lands with the first regional catalogue; `locations.province` is the hook); the **venue
  default is derive-only, not admin-editable** yet; and the **dashboard's `es-ES` module default**
  (`apps/dashboard/src/i18n/t.ts:7` + `#venueLocale`) still needs the same flip the till got in #170
  (check whether the dashboard money formatter has the same "doesn't follow the UI locale" bug).
- **till-api's bare `c.req.json()` sites still 500 on a malformed body.** #145 converted the 51 `?? {}`
  sites across ten route files to the shared `readJsonBody` helper. **Left:** till-api's ~19 **bare**
  `await c.req.json<T>()` sites (no `?? {}`), on the sale/pay critical path — each needs per-route
  validation tracing before adopting the helper. The till **PIN-login** (`POST /api/session`) is the twin
  of the management login #145 hardened (a `null`/malformed body → opaque 500 instead of a clean 401).
  `sync-api` / `setup-api` use different-contract defensive forms and are correctly left as-is.
- **Encrypt `totp_secret` at rest** (SP5). Stored plaintext today and `app_user` holds SELECT on
  `persons`, so a `persons` leak exposes every enrolled second factor. Latent (nothing writes it yet).
  The enrollment slice must encrypt via the credentials vault (AES-256-GCM), decrypting on the box before
  `verifyTotp` (keeps the offline-verifiable property).
- **No PIN-attempt throttle at the identity layer.** `verifyPersonCredential` has no lockout /
  rate-limit, so an authenticated operator can retry a 4-digit PIN. **Pre-existing** (the same posture the
  till login already carries; the cash-drawer supervisor override just adds a second caller). Mitigated
  today by scrypt's per-attempt cost + `sameSite:"Strict"` cookies. A per-person attempt lockout at the
  identity layer would harden login and the override together.
- **Location-scope the by-id verb family together** (SP6). `getHeldOrder`/`updateHeldOrder`/
  `abandonHeldOrder` and `updateTable`/`deactivateTable`/`openTab` address by (tenant-via-RLS) + id; only
  *list* verbs scope by location. Unreachable today (single-location tenants); when multi-location lands,
  move the whole family at once.
- **Hoist the receipt's ported money/date/label formatters into `packages/shared`** (from #154).
  `formatReceipt` (`apps/server/src/receipt-ticket.ts`) hand-ports `formatMoney`/`issueDate`/`lineName`/
  `LABEL`/`LEGEND` from `apps/till` because an `apps/server → apps/till` dependency is forbidden — so the
  paper receipt is kept in lock-step with the on-screen ticket by COPY, not by the type system (already a
  small drift: the receipt carries an NBSP-money normalization the screen lacks). Extract the shared pure
  logic into `packages/shared`. Low-risk, low-urgency.

**Fiscal (deferred, each behind its own review):**

- **The three alta builders are triplicated** — `recordSale`/`recordCorrection`/`recordSubstitution`
  in `packages/fiscal-verifactu/src/backend.ts` repeat the same alta head + tail. Unrepairable-record
  builders (CLAUDE.md §5), so a de-dup needs its own review + a huella-invariance re-run across all three.
  Safe seam: a helper taking the assembled `Omit<AltaInput,"Encadenamiento">` + a `buildDesglose`; also
  folds in the `fechaFromStoredDay` algebra and `recordSubstitution`'s N+1 loop.
- **Concurrent-corrective race in `settleSale` is untranslated.** If a rectificativa commits between the
  opening read and the `sale_settlements` INSERT, the coverage trigger raises a raw `P0001` that
  `settleSale` does not map to a `sale.*` code. Fail-closed and unreachable in the headless slice (needs
  the till UI to interleave). Fix when reachable: give the trigger a dedicated SQLSTATE and translate it.
- **F3 canje open questions (asesor/XSD)** — the foreign `IDOtro` recipient path is refused pending the
  asesor's `IDType` shape; whether a separate F3 series is mandatory (reuses `standard` today); cross-SIF
  F3 is a sound inference not confirmed; `Destinatarios` XSD confirmation before the first real filing.

**Provisioning / build:**

- **The `tenant` command is unplanned** and its design carries a defect: the idempotency check "look up
  `tenants` by NIF" cannot work (RLS hides a tenant from a connection that hasn't said which tenant it
  is). Attempt the insert and catch the unique-violation instead.
- **Credential READ path doesn't `validatePayload`.** `getCredential`/`tryGetCredential`
  (`packages/credentials/src/store.ts`) run the shape guard but not `validatePayload`, so a row sealed
  under an older `PURPOSES` field-list returns a missing field as `undefined` rather than being rejected —
  a fail-loudly-vs-keep-serving call to settle before the first consumer relies on it. Plus four carried
  from [#11]: password redaction in `applyInstance` is listed-not-structural; `bin.ts`'s `ask()` is
  coverage-excluded logic; `ApplyDeps` and the action list are two sources of truth for the database name.
- **Collapse the per-module drizzle migration chains into per-module baselines** (pre-production cleanup,
  not now). Migrations are per-module (8 sets); the debt is chain *length* (much of it dev churn). Not a
  `drizzle-kit generate` one-liner — the valuable migrations are hand-written custom SQL (FORCE RLS,
  policies, GRANTs, immutability triggers) that Drizzle does not emit.
- **Onboarding slice-2a follow-ups** (from #141, none blocking): **(a)** the box's self-signed CA has no
  `nameConstraints`/`pathLen` — add `nameConstraints` limiting it to `waitron.local` + the box IPs;
  **(b)** `apps/server/src/self-signed-cert.ts` and the test-only `testing/tls.ts` both define
  near-identical `CertExtension` + `certificate()` node-forge builders (already drifted) — extract the
  shared builder into one internal module (its own PR — touches the mtls fixture); **(c)** the leaf's
  validity window is stamped from `now` with 1 day back-slack, so a box that mints its cert **before NTP
  sync** (no RTC) persists a wrong window and there is no renewal in 2a — ties to the time-health check +
  cert renewal (slice 3/4).
- **Onboarding slice-2b follow-ups** (from #142, none blocking): **(d)** a DB-level advisory lock (keyed
  on `tenantId`, spanning guard→stamp→`applyVenue`) would make `provisionVenue` safe regardless of caller
  (defence-in-depth over today's in-process latch); **(e)** a `sealAeat`/`persistTrading` I/O failure
  *after* `provisionVenue` succeeds wedges the box (tenant minted, no `trading.env`) — add a recovery path
  (detect "DB provisioned but no `trading.env`" and offer re-derive+restart, and/or make the wedge loud);
  **(f)** the **trading-branch** `closePools` (`boot.ts`) still closes `db`/`syncDb`/`retentionDb`
  sequentially (a throw from the first skips the rest — extract one `closeAll(pools)`); **(g) R1
  owner-connection:** 2b runs provisioning over `config.migrationsDatabaseUrl`, correct only because
  dev's superuser owns the tables — on a real role-split appliance the setup-mode owner connection must be
  the DB-owner role (wire with the deferred appliance instance role-split), and a wizard-only box persists
  that connection as `trading.env`'s `DATABASE_URL`, so it runs its trading life on the owner role (not
  least-priv `app_user`) until that retrofit.

**Payments:**

- **Webhook `recordSale` sale-chaining hand-off** — the Mode-3 inbound Stripe webhook's security half is
  done; chaining a settled webhook into a sale needed the till/working-orders model (now exists).
- Pre-existing `forward` retry backoff; the reconcile remediation UI (also a SIF-failover backstop).
- **Stripe is unprovisioned for the deli** — the code is verified against a live sandbox, but no real
  account exists yet.

**SumUp:**

- **Four unverified questions, one design-invalidating**
  ([sumup provider spec](superpowers/specs/2026-07-30-sumup-card-present-provider-design.md) §7), wanted
  **before** the SumUp provider is built. The load-bearing one: **does the reader still work
  standalone/offline once paired to SumUp's cloud?** If not, the deli-hardware outage path (assumes a card
  can be taken when the internet is down) must be rewritten. The other three: may we *supply* the
  idempotency key; are reader webhooks signed like online ones; does `void` map onto the refund endpoint.

**Bizum (parked research, 2026-08-30 — no decision, revisit when payment providers are built):**

- **Bizum is account-to-account, not a card.** Merchant Bizum runs through **Redsys** or a PSP. The
  **Redsys TPV Virtual API is one standard integration for every Spanish bank** (cards + Bizum via
  `Ds_Merchant_Paymethods="z"`) — no per-bank build. Redsys-direct Bizum ≈ 0.4–0.6%; **Stripe Bizum is
  4.99% + €0.40** (rule out except as a stopgap); **SumUp does not support Bizum at all**.
- **In-person:** dynamic QR works today; **Bizum Pay NFC tap** launched 18 May 2026 (phased, ~full
  rollout late 2026) — customer taps their phone on a merchant NFC terminal.
- **Open question that picks the architecture** (unverified): can a SumUp/Stripe **Tap-to-Pay-on-phone**
  reader accept a **Bizum Pay NFC** tap? If no, the Bizum tap needs a bank datáfono on Redsys rails, not
  the waiter's phone. Resolve before designing any in-person Bizum UX.

**CI / test infra:**

- **Job-sharding next lever.** Critical-path jobs are `test-heavy` (`packages/db`, ~275s) and
  `mutation-verifactu` (~218s), both CPU-bound on one free 4-vCPU runner. To go below ~250s: shard db's
  suite or split `mutation-verifactu`. Rebalance the `LIGHT_A/B_PACKAGES` bins
  (`scripts/changed-scope.mjs`) when a run shows one shard dominating.
- **The pre-push hook's shell is largely untested** (the deletion guard + range computation are backed
  only by running the real hook); **`test-light` reports `success` without naming what it ran** (make the
  job name its selected packages); **`packages/ui` can hang the `test-ui` shard** (unconfirmed cause — if
  it recurs, per-test timeout + Playwright trace).

**Printing subsystem (robustness follow-ups, each spec-silent, none blocks):**

- **Retry spacing is the agent's batch interval, not a per-job backoff** — `MAX_DELIVERY_ATTEMPTS` (5)
  bounds attempts, but `print_jobs` carries no next-attempt timestamp, so a flapping printer burns the
  cap at loop speed. A time-scheduled backoff needs a new column.
- **The Impresoras editor leaves agent/transport re-binding read-only** — the management API already
  accepts a re-bind; wire the inline dashboard edit.

**Product decisions (defensible before production; decide before it):**

- **The orphan drift gate holds a customer's money pending a human, unbounded** (nothing re-sweeps a
  closed period).
- **`waitron-provision instance` migrates on every run**, which against a trading shop can lock tables —
  should it be gated (flag / refusal / louder confirmation)? Blast radius is one shop under the
  per-venue-database cloud design.
- **The €0 comped-sale settles at the settlement instant, not backdated to `issued_at`.** Till-UX
  question (is a comp ever finalised long after the invoice printed, in invoice-first mode?).
- **No UI path to REMOVE a person's email** (Tier A #2 follow-up). The Users form's Save-email is disabled
  when blank, and clearing an existing email is rejected by `setEmail` (`person.email_invalid`) — add a
  clear-email path (a dedicated `clearEmail`/null-accepting `setEmail`) if a venue ever needs it.

---

## Reference

**Adding a new real-PG test package** (the shared-container rollout pattern, so it isn't reinvented):
`ProbeRole.inRole` takes `string | readonly string[]` (a multi-membership role is a plain `roles` entry,
no `setup` hook); `cloneTemplate` is exported from `lifecycle.ts` and validates its own identifiers, so a
package needing a fresh DB per test (a `describeEachTarget`-style seam) reuses it — `packages/db`'s
`harness.ts` `postgresTarget` is the reference (clone per test, track, drop all in `teardown()`);
`nextCloneName()` mints the shared clone-name; `useTemplateDb` covers one-clone-per-file. Template-key
naming is **`core_<schema>`** (self-describing about what it migrates, not the package name). Fork mode is
a **per-package call**: (a) the `@vitest/coverage-v8` cross-fork branch-merge bug needs `singleFork` where
a package runs under `pnpm -r` oversubscription; (b) a shared container is one cluster on a 100-connection
budget, so a package whose suites open many backends caps at `maxForks: 4`. `packages/db` is the
reason-(b) reference, `packages/payments` the reason-(a) one. Plan:
`docs/superpowers/plans/2026-08-19-shared-test-container.md`.

---

## How to keep this file honest

Update it in the change that makes it stale (CLAUDE.md §7). In particular:

- When a piece lands, move it out of the priorities / *What's built* "Remaining" column — do not add a
  new receipt paragraph. **This is state, not history; the git log is the history.**
- The moment it goes stale most reliably is a **merge**: `/land-branch` carries a step to update this
  file. A merge deletes the branch the in-flight rows named, so refresh them then.
- When a question is closed on primary source, say so and stop calling it blocked.
- Delete finished items. If an entry is growing proof-of-work (test counts, grep receipts, "proven by
  deletion"), that belongs in the PR, not here.
