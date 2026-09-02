# Backlog — what to work on next, and why

This file answers **"what should I work on?"** It is state, not history: what is built (one line each),
what is open, and the order to take it in. The git log, the PR threads, and the committed
specs/plans in `docs/superpowers/` hold the detail — do not paste receipts back in here.

> **Reshaped 2026-09-01.** The owner demo is done; the north star moved from "something to show" to
> "a polished local product + the robustness that completes it". *Priorities* was rebuilt around two
> parallel tracks (UI polish, infra robustness); the finished demo Phase-0/Phase-1 Tier-A/B/C narrative
> was dropped (it is git history); and Track-1 status moved to its own tracker, `ui-review.md`. Detail
> still lives under *Open threads*; a PR number is a locator, never a receipt paragraph.

**Companion documents, not duplicated here:**

- **[ui-review.md](ui-review.md)** — the live tracker for **Track 1** (the UI/UX polish walkthrough):
  which areas are examined, which remain, and the corrections logged against each.
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

**North star: a polished product that runs locally with an intuitive UI — plus the robustness that
makes it a complete product** (owner decision, 2026-09-01). The owner demo is DONE; the goal is no
longer "something to show" but (1) every screen correct and intuitive and (2) finishing
primary/secondary failover, cloud failover, and sync. Two tracks run at once; everything else ranks
beneath them.

- **Track 1 — UI/UX polish & correctness (foreground).** A systematic customer-journey walkthrough of
  every chunk of functionality: each area's current behaviour is shown to the owner, who corrects
  intuitiveness/correctness problems, and the fixes land. **[ui-review.md](ui-review.md) is the
  authoritative tracker** — which areas are examined, which remain, and the corrections against each.
- **Track 2 — robustness / infra (its own track).** Primary/secondary failover, cloud failover, sync
  completion — unfinished, and what makes Waitron a complete product. Run it as a **separate
  interactive session** (its own worktree), in parallel with Track 1, soundness-first — it does not
  have to be unattended/background; the real question is ready-to-build vs gated. Gates + the
  infra-session **start-here menu** are under *Open threads → SIF topology / Sync / Onboarding*.
  **Never land anything touching the unrepairable fiscal core (H2) without owner sign-off** —
  hash-chained records, never-reused invoice numbers.

**Prioritisation is by soundness, not the calendar** (2026-08-02): Waitron will be finished before the
deli must trade, so 1-Jan-2027 ranks nothing above anything. Order by dependency, correctness, and
de-risking the most-reused / most-uncertain foundations first.

**Run path (local; no hardware, cloud, or AEAT cert):** `pnpm dev:setup && pnpm dev` → till
<http://localhost:5190>, dashboard <http://localhost:5191>, setup <http://localhost:5192>, server
:8080. Till PIN **5555**; dashboard **owner@demo.waitron.local / dashPass123**. `dev:setup` seeds a
believable demo restaurant: two menus (~44 products with per-dish images), a floor plan (3 zones / ~16
tables), staff on PIN 5555, and ~28 days of back-dated preproduction sales — English by default,
Spanish via `WAITRON_SEED_LOCALE=es-ES`. ~25 fleshed-out screens on one enforced design system.

### Layout designer & device profiles (NEW — owner-inserted 2026-09-02, spec approved)

A visual, HA-Sections-style **layout designer** with reusable **layout profiles** (tabs → grid →
cards), unification of **tills into the enrolled-device model** (a `till` device kind; hardware binds
per-device; **fiscal SIF/chain stays on the node** — H2-gated, verify-by-container + owner sign-off),
and a dev-only **per-tab device switcher**. Replaces the narrow per-tenant `till_layouts` (dropped,
pre-production). The owner inserted this ahead of resuming Track-2 infra. Design:
[layout-designer-and-device-profiles](superpowers/specs/2026-09-02-layout-designer-and-device-profiles-design.md).

Decomposition + order **A → C → B** (each its own spec → plan):

- **SP-A.1 — profile & card data model — LANDED #194.** Pure `@waitron/layouts` logic: form factors +
  12-card catalogue + capability flags, per-card contract registry (config/permission/capability/
  visibility-states/spans; `SALE_CRITICAL_CARDS` derived), fail-closed `validateProfile` +
  CSS-injection-safe `validateThemeOverride`, built-in default profiles, `profile.invalid`/`theme.invalid`
  error families. No DB/API/rendering/device/fiscal (those are later slices). Plan:
  [sp-a1-data-model](superpowers/plans/2026-09-02-layout-profiles-sp-a1-data-model.md).
- **SP-A.2 — device unification & hardware (NEXT for track A; H2-gated).** `till` device kind, device→profile
  FK + per-device hardware bindings (static; modelled for transient NFC readers), enrolment extension,
  server-side enforcement of the profile capability flags + card required-permission/capability, theme
  storage (tenant + per-profile). **Carries the fiscal §7 gate** — verify by container that `till_id`/`node_id`
  consumers are untouched + owner sign-off before landing. **Fold in the SP-A.1 deferrals below.**
  - *SP-A.1 deferrals to resolve in SP-A.2:* (a) decide whether `validateProfile` folds in
    `validateThemeOverride` so a profile's `theme` round-trips (today it is dropped); (b) add a dedicated
    `bad_capabilities` error reason (cleaner than the current `not_object` overload for a bad capability
    flag, and `bad_tab` for a non-array `cards`); (c) source `THEMEABLE_TOKENS` from the real
    `packages/ui/src/tokens` registry with a cross-package consistency test + the owner's decision on which
    tokens are themeable (SP-A.1 ships a provisional verified-real set); (d) defensively copy the returned
    card `config` (SP-A.1 copies `visibleWhen` but `config` still aliases the input).
- **SP-C — dev per-tab device switcher** — per-tab `sessionStorage` identity + dev-only override header
  + a device-reset route. Small; unblocks side-by-side testing.
- **SP-B — grid editor + rendering** — the HA-Sections editor UI + making screens render from grid
  profiles (wrap the bespoke floor/KDS/table-order screens as cards; phased). The schedule risk. Removes
  the old widget model (`WIDGET_TYPES`/`validateLayout`/`till_layouts`) once rendering swaps over.
- **Follow-ons:** visual theme editor · NFC pairing runtime + payment routing (payments-gated on the
  SumUp questions) · community profile sharing.

### Product work still open (beneath the two tracks)

The demo Phase-0/Phase-1 Tier-A/B/C build is finished (git history); what remains is the open
follow-ons and the still-greenfield product features, ranked beneath Tracks 1 and 2. Landed
sub-projects and their state are in *What's built*; the open detail is under *Open threads*.

**Ordering / menu (SP18):**

- **Counter/walk-up kitchen fire (#193 follow-up) — the next actionable ordering slice.** The
  counter/walk-up basket shows the note/doneness editor and the server persists both on
  `working_order_lines`, but `/api/sales` (`recordTillSale` → `createOpenOrder`) never calls
  `fireLines`, so a note/doneness typed on a counter sale reaches no kitchen surface. The owner
  confirmed counter food DOES go to the kitchen (2026-09-01), so this is real work: make the walk-up
  path fire kitchen tickets (mirror the table/tab round path, snapshotting note/doneness onto
  `ticket_items`) and extend the KDS/expo/print reads to cover counter-fired tickets. Wire/state
  already exist; only the counter fire path + its reads are missing. Keep the fiscal boundary intact
  (note/doneness must NOT reach `sale_lines`/`computeHuella` — same guard as #193).
- **Modifiers / quantity deferred follow-ons** (all landed — #184/#186/#187/#190/#193): on-screen
  expo/station-queue/tab modifier `×N`; extract the shared `#allergens` render across
  basket/station-queue/expo; fold the base-allergen `products` join into the KDS queue select; the
  owner UX call on how an unreviewed dish shows on the KDS vs the till; post-fire tab-line note/doneness
  edit (parked — needs a re-fire endpoint); customer-facing menu surface (parked — its own
  sub-project); the TS-4 partial-transfer modifier-split guard; and the small shared-helper cleanups
  (`kitchen-print` child-line read, `parseOptionalInteger`, `groupByParent`).
- **Menu-management depth (#8)** — greenfield, no owner decision pending: a menu **draft/published**
  state (only an `active` bool today) and **time-of-day / seasonal scheduling**. (Per-till persisted
  menu selection was DROPPED — owner call.)
- **Order-timing follow-ons (#9, spec §13)** — delivery-order floor flash; idle-floor escalation;
  real-time push; station-kind threshold defaults; an unbumped-since-fire neglect metric; a shared
  flash helper.

**Bookings (SP14):** Bookings-1 landed (#180, #182); future, each greenfield — public/online/QR
booking, availability / double-booking prevention, reminders (SMS/email), a customer/CRM entity,
recurring bookings, a calendar grid, deposits.

**Tier C — valuable, defer (behind-the-scenes or post-polish):**

- **Square (and generic CSV) menu import** — full dashboard flow (auth, map catalogue, re-import): a
  switching-cost story for an owner leaving Square. A one-off import is NOT the cheap seed path (spike,
  2026-08-29). Greenfield + external API.
- **Definable roles with selectable privileges** — roles are a fixed 4-value enum + a code-defined
  permission map (`packages/identity/src/permissions.ts`); data-driven RBAC + a role-editor is a large
  backend change.
- **Payment-provider config UI** (Stripe / SumUp / …) — none today (provider is env-stamped, sealed via
  the credentials CLI); also gated on the SumUp offline question (*Debt → SumUp*).
- **AEAT cert / Veri*Factu management UI** — first-run only today (`apps/setup` cert screen);
  `cert-expiry.ts` monitors but there is no view/rotate/renew surface.
- **Hardware config profiles per device kind** — no profile abstraction exists.

### Parked (real, but beneath the two tracks)

- **Engage a fiscal advisor** — a parallel *human* task (long lead time), not a build; worth starting,
  blocks nothing. See *The advisor gap*.
- **Sync completion beyond the landed lanes** (Track 2) — fiscal-lane / hash-chain sync (H2,
  owner-gated), multi-tenant transport, cloud-mirror C-remainder. See *Open threads → Sync*.
- **Reporting *fiscal* remainder** — modelo-303 filing boxes (rectificativas 40/41, prorrata 44,
  intra-community 32–39) + two pre-filing caveats: AEAT filing completeness (asesor-gated), not an owner
  takings view. See *Open threads → Reporting*.
- **Printing cloud-poll transports + expo device kind** — subsystem, KDS, receipt + cash-drawer built;
  the rest is post-polish. See *Open threads → Printing*.
- **Cloud trial on-ramp** — gated on Waitron-cloud infra that does not exist yet. See *Open threads →
  Onboarding*.
- **Recipes → stock → procurement (depth)** — recipe-authoring built; plate costing / stock depletion /
  suppliers/POs is product depth. See *Open threads → Recipes*.
- **Distribution / deployment / failover remainder** (Track 2) — appliance image, on-device agent,
  reroute, SIF promotion/fencing + till-side failover. See *Open threads → SIF topology*.

**Later / smaller:** SumUp card provider (gated, *Debt*) · D3 payroll export (integrate-not-build) ·
accounting export (SP17) · opening hours & channel sync (SP19) · tip payroll (SP13) · online ordering
(SP15) · owner-added table-service extensions (per-seat ordering; multiple tabs per table — reopen
settled TS/KDS decisions, so specced-with-owner, never landed unattended) · **KDS ops polish** (routing
read-back/audit view + station kind; definable kitchen statuses). See *Open threads*.

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
| 5 | Identity | persons/sessions, PIN, `authorize()`, roles/permissions, passkeys, email login, config sync flow-down to a read-only secondary (#195) | mid-shift-suspension enforce, discount gate, till-refund enforce; encrypt `totp_secret` at rest (**now a hard dep of the TOTP-enrollment slice** — #195 replicates it, see *Onboarding*); PIN-attempt throttle |
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

### Sync completion (rest parked; infra-session start-here menu — Track 2)

Mechanism is decided and slices 1–3 + ops + the cloud-mirror A/B/C1/C2a/C2b are landed:
cross-replication is **application-level** (an outbox — `sync_log` + a generic capture trigger, apply as
the app role under `withTenant`), **not** native Postgres logical replication. Built: commercial-lane
outbox, symmetric HTTP-pull transport + per-peer `sync_peers` auth (#144), payments fast lane, retention
sweep + `waitron-sync-evict`; cloud-mirror identity/auth (A, #144), outbound tunnel (B, #150,
`@waitron/tunnel` proven against a local relay stand-in), the `dining_tables` FK-closure enrolment (C1,
#153), the mirror-mode server (C2a, #155 + hardening #164), and the operator flow (C2b, #162 + hardening
#164). Designs + findings under `docs/superpowers/specs/2026-08-{02,27,28,29}-*sync*` and
`*cloud-mirror*`.

**Track 2 infra-session — start-here menu (mapped 2026-09-01).** The infra track runs as its own
interactive session, so "needs supervision" is not a disqualifier — the real question is ready-to-build
vs gated on an unbuilt foundation or an external dependency:

- **Ready to build now:** *none queued.* **Kitchen-sync enrolment LANDED #196** (the FK-closure design
  pass + build; see *Remaining* below for what shipped). Identity-config flow-down also **LANDED #195**:
  `persons` + `webauthn_credentials` now flow down the ordered lane (see *What's built → Identity* and
  the two follow-ups under *Onboarding*). With both landed, the remaining Track-2 items are a design pass
  (membership & rejoin) or foundation-gated (reserved-SIF) — no pure ready-to-build code slice is queued.
- **Highest-leverage next design pass** (spec-only, unblocks the most): the **membership & rejoin
  wire-protocol** (promotion-failover spec §9 item 1) — gates promote Slice 5 + the conflict watcher,
  and is entangled with both open split-brain seams. Owner-reviewed, since it sets topology direction.
- **Foundation-first, then its dependents (fiscal-adjacent, owner-gated):** **reserved-SIF staging**
  mints the installation number + disjoint series → unblocks promote **Slice 3**, the C2a promote
  action, and starting the primary-only workers on promotion.
- **Hard-gated (leave until the gate clears):** break-glass secret mint (→ Slice 2); backup regime
  (→ Slice 4); real cloud hosting/relay (cloud-mirror follow-ups, the T1 relay); the go-native decision
  (on-device agent); and the **owner-gated fiscal H2** hash-chain sync lane — never landed without
  owner sign-off.

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
- **Kitchen-sync enrolment — LANDED #196.** Enrolled the KDS FK closure onto the ordered lane. The
  closure turned out to be **three** tables, not the two named here: `kitchen_stations`, `kitchen_courses`
  (forced in by the KDS-2 course FKs) and `ticket_items`. Hard gate closed — enrolled
  `categories`/`products`/`working_order_lines` carry `station_id`/`course_id` FKs into the kitchen config
  tables, so a routed-menu row would have `23503`-parked and stalled the ordered lane (the C1 shape).
  Same Group-D shape as C1 (no watermark, no delete; `ticket_items` removal rides the
  `working_order_lines` `ON DELETE CASCADE`, reproduced on the subscriber); no new grants; no FK cycle
  (`ticket_items` is an FK leaf). Spec:
  [kitchen-enrolment](superpowers/specs/2026-09-02-sync-kitchen-enrolment-design.md). The `dining_tables`
  HARD GATE remains closed by C1 (#153).

### Reporting fiscal remainder (parked)

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

### Printing + hardware surface (built; remainder parked)

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

**Order routing — BUILT.** Item→station (`products.station_id ??
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

**Coursing editing & kitchen corrections — LANDED (#191).** Server verbs to move a
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

**Parked beneath the two tracks (distribution / failover):**

- **Cloud trial on-ramp** — same-origin PWA pointed at a cloud instance; preproduction, shared demo
  tenant. Gated on Waitron-cloud infra that does not exist yet.
- **Identity-config flow-down — LANDED #195.** `persons` + `webauthn_credentials` now flow down the
  ordered lane (Group-E no-watermark upsert, capture triggers in `0007_sync_identity_capture.sql`,
  origin `nodeId` threaded through every identity-config writer incl. the till + me-api locale routes);
  `sessions`/`management_sessions`/`webauthn_challenges` stay out (proven by deletion). A secondary can
  now authenticate the venue's people on failover; re-establishment is still **PIN-re-prompt v1** (a
  portable signed token is a later slice). PR marked needs-owner-review (replicates credential hashes)
  and landed on owner sign-off. **Two follow-ups the merge left open:**
  - **`totp_secret` at-rest encryption is now a hard dependency of the TOTP-enrollment slice** (SP5,
    *Debt*): flow-down means the (currently-always-NULL) plaintext `totp_secret` would replicate to a
    second box the moment anything writes it — so the enrollment slice **must** land AES-256-GCM at-rest
    encryption *before* it writes the column. This slice is safe only while the column stays unwritten.
  - **The onboarding seed-admin `persons` row captures under the all-zero origin** — `venue-apply`
    provisions under a bare `withTenant` and the seed-admin insert runs before the node's `nodeId` is
    generated later in the same plan, so that first admin's `sync_log` row is all-zero-origin (bounded:
    one row per venue). Whether it must be fixed depends on the secondary-bootstrap model — a mirror
    that adopts a base DB copy (`adoptVenue`/cold-restore) already has the admin (non-issue; residual is
    one unpruned `sync_log` row); a pure-sync-reconstruction mirror would be missing it. **Owner
    decision on the bootstrap model pending**; the fix (generate `nodeId` before the seed and thread it)
    is small if wanted.
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
lead time (a parallel human task — worth starting, but blocks nothing).

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
