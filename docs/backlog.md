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

**Sequencing — what unblocks what (2026-09-05).** Four sessions run at once: Track 1 (UI, the
`ui-review.md` walkthrough) plus the three design-review tracks A/B/C (*Whole-project design review*
below). Two structures are known to be out of date and must not be built on:

1. **FORCE RLS + the multi-role set + the unsquashed migrations** (Track A item 3). Every new table
   written before it lands gets policies, grants and an `*.rls.test.ts` that are deleted weeks
   later, and migration numbers collide on every rebase (#165). **Rule: no new table anywhere —
   core or module — until Track A item 3 lands.** UI corrections are polish and need none; anything
   that does is parked behind A3. Track A therefore goes first and fast: coverage split (an
   afternoon) → prototype (a day) → A3 starts immediately; it is the long pole for everyone.
   **2026-09-05:** the split LANDED (#239), the prototype has reported (item 2), item 4's spec is
   drafted and awaits owner review — A3 is next, and carries the swap's schema half (S0).
2. **The module framework's UI seats** (cards, permissions, i18n arriving with a module) are
   unproven until Track C's `fiscal-none` + bookings-as-a-module land. New product domains wait for
   them and land as modules; polishing existing screens does not.

Three **decisions** shape UI work and cost nothing to take now (docs-only brainstorms, build later):
Route A vs B for the till reroute (it decides the till's auth model — **taken 2026-09-05**,
[`2026-09-05-till-reroute-route-decision.md`](superpowers/specs/2026-09-05-till-reroute-route-decision.md));
`tills` vs `devices` (device
management and the till-enrol screen, [owner]); and the relay choice (ours or off-the-shelf, which
shapes the control plane — **taken 2026-09-05**, neither:
[`2026-09-05-relay-decision.md`](superpowers/specs/2026-09-05-relay-decision.md)). **All three are Track B's first job** — its "decisions first" line below —
taken before Track B builds anything; Track 1 and Track C consume them. **Track 1 therefore works areas 2–18 now
and leaves area 1 (setup wizard — its provisioning paths move under Track B item 2) and area 19
(device management) until those decisions are recorded.** Everything else in the four tracks
proceeds in parallel under the coordination rules in the design-review section (serialised pushes;
whoever lands second rebases).

**MVP for go-live (owner decision 2026-09-05).** A primary server, on-prem OR in the cloud:

- **On-prem primary + a redundant CLOUD server** for failover with human promotion. A second LOCAL
  box is beyond the MVP (the earlier "two boxes + cloud" answer is the post-MVP target, not the
  go-live bar). Internet-down: the primary keeps selling (CLAUDE.md §5) and the standby falls behind
  until the link returns; box-down AND internet-down together means no failover — accepted for the
  MVP.
- **Cloud-only primary + redundancy**, from either **(a)** a Postgres host that comes with redundancy
  (managed/HA Postgres — newly allowed; relaxes promotion-failover §7.2's "no managed-database
  dependency" for this mode only) or **(b)** a second cloud server on the built mirror + promotion
  mechanism (promotion-failover §7.4). (a) is infrastructure HA of ONE node and needs a design look
  at what the server keeps on local disk (env files, media, the box-secret vault) plus a singleton
  lease so two app processes never both submit; (b) is the built path applied cloud-to-cloud, no
  tunnel.

What the MVP needs that is NOT built (Track B/C order, *Whole-project design review*): real relay
hosting (the tunnel is proven only against a local stand-in), a per-tenant cloud instance
provisioning path, the authenticated promotion endpoint, till reroute to the promoted cloud, a
printing path when the primary is dead or the server is cloud-only (a poll-the-cloud printer or a
local relay, distribution §5), and the control plane. **Residency: cloud instances are hosted in
Spain (owner decision 2026-09-05)**, so asesor Q16 — an invoice-issuing SIF operating from abroad —
does not arise for either cloud mode; the control plane's region is Spain by decision, not a
per-tenant choice.

**Prioritisation is by soundness, not the calendar** (2026-08-02): Waitron will be finished before the
deli must trade, so 1-Jan-2027 ranks nothing above anything. Order by dependency, correctness, and
de-risking the most-reused / most-uncertain foundations first.

**Run path (local; no hardware, cloud, or AEAT cert):** `pnpm dev:setup && pnpm dev` → till
<http://localhost:5190>, dashboard <http://localhost:5191>, setup <http://localhost:5192>, server
:8080. Till PIN **5555**; dashboard **owner@demo.waitron.local / dashPass123**. `dev:setup` seeds a
believable demo restaurant: two menus (~44 products with per-dish images), a floor plan (3 zones / ~16
tables), staff on PIN 5555, and ~28 days of back-dated preproduction sales — English by default,
Spanish via `WAITRON_SEED_LOCALE=es-ES`. ~25 fleshed-out screens on one enforced design system.

### Whole-project design review (2026-09-05) — decisions taken; execution in three parallel tracks

A base-to-tip review of the code and every Track-2 spec, with the owner answering the review's
questions. Landed from it: CLAUDE.md §1 comment rule + §6 model-selection trial (#233), the
rules-first CLAUDE.md rewrite (#235, 972 → 415 lines, stale facts fixed, four memory-only traps
folded in), the model rule relocated to the shared global `~/.claude/CLAUDE.md` with only the
waitron yardstick kept in-repo (#236), and the
`/finish-branch` rewrite (run-it reviewer + convention reviewer; SDD's final whole-branch review
dropped as a duplicate). **Owner decisions recorded (they supersede older spec text where they
conflict):**

- **No database will ever hold two tenants** (a throwaway preproduction demo aside). The
  multi-tenant SaaS goal is gone; a box is single-tenant, on-prem or cloud. Supersedes cloud-storage
  §9's "one shared cloud database". **Confirmed and extended 2026-09-05 (owner decision): ONE TENANT
  PER DATABASE everywhere, the cloud included.** A tenant is the obligado (`country` + `tax_id`, one
  NIF; `packages/provisioning/src/tenant-id.ts` derives its id) holding all of its locations. The
  cloud is a dedicated instance per tenant — the shape the built cloud mirror already has — as a warm
  mirror today or as a primary (hosted in Spain, so Q16 does not arise); the shared multi-tenant cloud store
  (cloud-storage §2/§9) is DROPPED, and with it the parked *multi-tenant transport* (whole-log reader
  role). Density comes from many isolated instances per host, never from a shared database. The only
  multi-tenant pieces are a small control plane (accounts, subscriptions, instances, WireGuard
  credentials + public names, rollout — not yet designed) and the preproduction trial demo; the
  stateless tunnel relay is gone (decision 2026-09-05, `2026-09-05-relay-decision.md`). Consequence
  for recommendation 1 below: the last consumer of FORCE RLS is gone; the replication prototype was
  the only remaining gate on dropping it — **cleared 2026-09-05** (Track A item 2).
- **The deli gets two boxes + cloud failover on day one** and must survive internet-down, box-down
  and printer-down. Redundancy is mandatory. **Active-active is SHELVED for the foreseeable future
  (owner decision 2026-09-05): the deli runs warm standby + human promotion.** The owner's reason:
  active-active would have to cover orders, kitchen progress and every other live-service surface,
  not just selling. The same-day assessment found the operational half unbuilt — no join path that
  produces a second *selling* box in a venue (the only join is the read-only cloud-mirror adopt), the
  sync source mounted only on the singleton primary (`apps/server/src/boot.ts`, `mountSyncApi` gate)
  so a selling secondary's rows would never leave the box, no till reroute, no open-tab handoff, and
  `dining_tables` as a two-writer row — while the node-keyed fiscal half (own chain/series per node,
  verbatim fiscal replication, one submitter) is built and is what warm standby reuses. This resolves
  the sync design §12 / one-server-buy-list contradiction. Nothing is deleted for it: what exists
  stays on `main` under the warm-standby build, and branch **`shelved/active-active`** (= `main` at
  `c65d3cbe`, 2026-09-05) is the snapshot to return to. Dated pointers: sync design §12, server-as-SIF
  §4 + §13, promotion-failover §8, distribution §3. **MVP narrowing (same day):** the go-live bar is
  one on-prem box + a cloud standby, or cloud-only + redundancy (*Priorities → MVP for go-live*); the
  second local box is post-MVP.
- **Modules are core to the product** (opt-in domains, third-party modules later). Fiscal must be
  swappable by jurisdiction (Veri\*Factu / TicketBAI / none). Two rules agreed: **new domains land
  as modules from now**, and **no new table enters the core migration set without a stated reason**.
- Comments carry invariants, not history (CLAUDE.md §1). Coverage bar is negotiable with a reason.

**Execution — three parallel sessions (owner decision 2026-09-05).** The owner accepted the
remaining recommendations for execution and asked for them to run as three independent sessions,
each in its own worktree (`worktree.py new`), split so that no two tracks edit the same files at the
same time. Track B here *is* Priorities' Track 2. Each item is still its own brainstorm → spec →
plan → PR; items marked **[owner]** never land unattended.

**Track A — data layer** (sequential; owns `packages/*/drizzle/`, `packages/db` tenancy + test
harness, `packages/provisioning`, `packages/sync` role plumbing, every `*.rls.test.ts`, every
`vitest.config.ts`, CLAUDE.md §2–§4):

1. **Coverage split — LANDED #239 (2026-09-05):** 98/98/98/95 kept on `verifactu`, `fiscal-verifactu`,
   `core`, `db`, `sync`, `payments`; the 90/90/85/85 floor everywhere else (the four browser
   packages' 95/95/90/88 was above the floor on every axis, so they took the floor).
   The root project (the classifiers) keeps the high bar — a judgement call flagged at review.
   `scripts/coverage-thresholds.test.ts` pins which package holds which bar; CLAUDE.md §2 updated.
2. **Native logical replication prototype — DONE 2026-09-05: all of (a)–(d) PASS, (e) measured.**
   Findings: [native-replication-post-rls-prototype-findings](superpowers/specs/2026-09-05-native-replication-post-rls-prototype-findings.md)
   — real migrations applied as a non-superuser OWNER (`rolsuper = f`), RLS stripped, two
   `postgres:18-alpine` nodes bidirectional with `origin = none`. Both 2026-08-02 gates (RLS refusing
   the apply worker; the non-owner `SET ROLE`) are gone on that schema. **Decision rule applied: stop
   adding outbox features; item 4 is next.** Nine findings the swap spec must carry, the two that
   change code: `ENABLE ALWAYS` on the immutability triggers (the apply worker skips `tgenabled = O`
   triggers and copied a corrupted publisher's UPDATE silently until it was set), and a bounded
   `max_slot_wal_keep_size` (a dead standby otherwise fills the primary's disk — the one failure that
   would stop sales). Also: `FOR ALL TABLES` is superuser-only, so each module publishes an explicit
   table list; additive DDL is subscriber-first and the missing-column stall is loud and self-heals;
   `time_entries.ingest_seq` does not replicate; one superuser provisioning step for the `REPLICATION`
   role. **Cross-track (Track C):** module SP-2b's schema-version gate (LANDED #230) rests on
   "deliberate rejection of native logical replication"; item 4's spec retires it (its §5).
3. **Drop FORCE RLS + the multi-role set — [owner] at land** (one PR chain; the largest change on
   this list; gated on item 2 only because the answer changes what the sync layer must be). Keep
   `tenant_id` columns + composite FKs, the owner-vs-`app_user` split (the append-only guarantee rests
   on the app never owning the tables), and `withTenant` as the transaction primitive with its
   `app.tenant_id` set_config hollowed out. Drop every `ENABLE/FORCE ROW LEVEL SECURITY` + `CREATE
   POLICY`, `current_tenant_id()`, the per-tenant `sync_log` fencing (the whole reason
   `sync_tailer`/`sync_retention` exist), the NOLOGIN function roles, the RLS-only halves of
   `asAppUser`/`ProbeRole` and of `fiscal-verifactu`'s `inmutabilidad` suite, and the 115
   `*.rls.test.ts` suites (read each first — privilege facts move to plain grant tests). Do it as a
   **new baseline migration set per module** — this is the migration squash (111 files → per-module
   baselines; the hand-written immutability triggers + grants carried verbatim). Re-examine what
   `instance-plan.ts` refuses (superuser still yes: the triggers must not be bypassable). **Receipt
   before merge:** on `postgres:18-alpine` as `app_user`, `UPDATE registros_facturacion` fails
   (`42501`) and `INSERT` succeeds. Measure real-PG test-file count (190 today) + full-suite wall
   clock before/after.
4. **Outbox → native replication swap spec — DRAFTED 2026-09-05, awaiting owner review:**
   [outbox-to-native-replication-swap-design](superpowers/specs/2026-09-05-outbox-to-native-replication-swap-design.md).
   Owner decisions in it: full replacement (no hybrid); no third-party overlay (WireGuard box ↔ its
   own cloud instance, SSH fallback — the same link Track B's relay decision retires the relay for); a
   returned box drains its ledger back, never its settings, and is then wiped and re-adopted; live-
   service rows are classed like settings (§4.3); and **the working-time chain is rekeyed per node**
   like the fiscal chain (§4.4) — a prerequisite for S3/S4 and its own brainstorm + PR (workforce);
   the labour advisor is asked only whether a location's exported record may show per-node chains.
   Slices S0–S7 in §14; S0 (no `sync_*`, `ENABLE ALWAYS` on the append-only triggers,
   `track_commit_timestamp`, `max_slot_wal_keep_size`) rides item 3's baseline. Next step once the
   owner approves the spec: the implementation plan, then S1.

**Track B — failover** (sequential; = Priorities' Track 2; owns `apps/till`, `apps/server`'s boot /
promote / till-session / read-only gate / box-* / rejoin, `packages/membership`, `packages/printing`,
and the single config-conflict-gate trim in `packages/sync`):

**Decisions first (docs-only brainstorms, before any build):** (i) Route A vs B (item 1's opening) —
**TAKEN 2026-09-05**: rerouting lives in the till web app for every device kind; the device
credential stays an httpOnly cookie and reaches every host as a tenant-domain cookie (paid tier) or a
primary-issued one-time ticket (LAN-only second box, post-MVP); the native agent is built from the
start for hardware only (printing first) and never carries browser traffic
([`2026-09-05-till-reroute-route-decision.md`](superpowers/specs/2026-09-05-till-reroute-route-decision.md));
(ii) the relay choice — ours or off-the-shelf (item 2's opening, moved here from Track C) —
**TAKEN 2026-09-05: no relay.** Replication rides the box↔own-cloud-instance WireGuard link (owner
decision, Track A session); remote access is the instance forwarding the box's name down the link
without terminating TLS; `@waitron/tunnel` + its wiring are retired with item 2's build
([`2026-09-05-relay-decision.md`](superpowers/specs/2026-09-05-relay-decision.md)); (iii) `tills` vs `devices` — the decision half of item 7, pulled
forward because Track 1's area 19 waits on it; the build and its H2 receipt stay after Track A's
squash. Record each in this file as it is taken.

1. **Till reroute** — the first slice, because nothing server-side in the failover arc is usable
   until a till can reach the second box. Route DECIDED 2026-09-05 (the decisions-first line above):
   the auth model does not change — the device cookie stays httpOnly and gains a tenant-domain scope;
   `devices`/`tills`/`device_profiles`/`canvases` must replicate first (config-class, no new table);
   the promoted cloud serves tills on its public name; the app never talks to the local agent. Then:
   static ordered server list cached on the till (the membership document's `contactUrl`s),
   N-consecutive-failure detection with hysteresis, a manual "switch server" control, PIN re-prompt on
   switch (v1; portable signed token later), idempotency key on settle/pay. Carry the warm-standby
   cleanups: the `dining_tables` enrolment comment says single-writer-by-construction (drop the
   "mixed config/runtime" deferral); the config-conflict gate keeps only the fence-window case; R3a's
   two deferrals (till reads routed through the display-data node; selling gated on REBOOT completion,
   not the PONR). Rewrite CLAUDE.md §5's "nothing blocks a sale" wording in the same change.
2. **The cloud standby, end to end (MVP)** — the box↔cloud-instance WireGuard link (relay DECIDED
   2026-09-05: none; `@waitron/tunnel`, `WAITRON_TUNNEL_*` and the tunnel-aware dispatcher are
   deleted once the link carries replication, never before — the decisions-first line above), a
   per-tenant cloud instance provisioning path (the instance also forwards the box's remote name
   down the link without terminating TLS), then prove by RUNNING: on-prem primary → adopt →
   mirror → human promotion → tills reroute to the promoted cloud → the venue sells and files. A
   second LOCAL box is post-MVP; when it comes, the same adopt path over the LAN with no relay is the
   candidate (wizard mode 4 wraps it).
3. **Promotion runbook Slice 2** — the authenticated promote endpoint + break-glass mint + the real
   runtime admin connection (the write today uses `migrationsDatabaseUrl`); then **re-admission** of a
   rejoined, wiped-and-restored box as the standby (R3 follow-up (b)) and the resume-at-restore marker
   (R3 follow-up (a)).
4. **Cloud-only redundancy (MVP) — brainstorm** (a) one node on a managed/HA Postgres host vs (b) a
   second cloud node on the built mirror mechanism. (a) needs an inventory of what the server keeps
   on local disk (`writeFileAtomic` env files, `mediaDir`, the box-secret vault, backup state) and a
   singleton lease so a restarted or relocated app process never runs a second submitter; (b) is
   Track B item 2 without the tunnel. Pick per deployment; both may ship.
5. **Printer failover** (`2026-08-26-failover-printing-design.md`) — MVP-critical for cloud-only and
   for a promoted cloud standby (a cloud server cannot reach a LAN printer).
6. **Node-role collapse** — derive ONE `NodeRole` at boot from the membership document (today spread
   across `deployment.mode`, `singleton_role`, membership standing and the boot-captured `fenced`
   flag) and pick one rule: every role change is a restart, or the worker-lifecycle manager Slice 3
   keeps deferring — not both; a small worker registry replaces `startServer`'s hand-rolled
   AbortController-per-worker (`boot.ts`, 1,665 lines). **After Track A item 3 lands** — both edit
   `boot.ts`'s role-pool wiring.
7. **`tills` vs `devices` — [owner]** (SP-A.2 follow-up 2): the brainstorm is taken up front (the
   "decisions first" line above); the build — full fiscal trace, a new H2 receipt for what an
   immutable record's `till_id` holds — after Track A's squash.

**Track C — product / modules** (sequential; owns `packages/fiscal*`, the module framework packages,
every NEW module package, `apps/dashboard` module screens, `apps/server/src/modules.ts`, and the
control-plane docs):

1. **Finish fiscal as a module:** SP-3b vocabulary, SP-3c gated-provisioning seam, SP-3d
   backup/restore hook (= BR-4) — the queued slices under *Waitron module system*.
2. **`fiscal-none` module** (tiny; the UK case; forces every chain/huella/`entorno` assumption
   through the `FiscalBackend` seam — a better pluggability proof than TicketBAI). Put the two agreed
   rules (new domains land as modules; no new core table without a stated reason) into CLAUDE.md §3
   in this PR.
3. **Bookings as the first UI-bearing module** (own package, own tables, own dashboard screen):
   proves cards, permissions and i18n arriving with a module — fiscal never exercises them.
4. **Control plane brainstorm — NEW (owner-added 2026-09-05).** With one tenant per database and a
   dedicated cloud instance per tenant, the only multi-tenant service Waitron will run is a small
   control plane: accounts (a customer of ours, a concept the schema does not have — a tenant is a
   taxpayer, and one customer may own several), subscriptions, instances (which box/VM serves which
   tenant, its version; region is Spain by decision), a WireGuard keypair + endpoint per box and the
   box's public names (no relay tokens — the relay is gone, decision 2026-09-05), and version
   rollout per tenant. Density comes from many isolated instances per host, never a shared database.
   Track B's relay decision is taken (2026-09-05, `2026-09-05-relay-decision.md` §3); still open
   there and this brainstorm's to settle: one name or two for LAN-vs-remote reach.
   Docs-only until designed; nothing here is on the sale path.
5. **Reconsider the backup container against off-the-shelf** (brainstorm, not a mandate): `WBA1` +
   `artifact-cipher.ts` (whole-dump in memory, restorable only by Waitron code — `pg_dump | age`,
   tar). The tunnel/relay half of this question moved to Track B's "decisions first" line (taken
   2026-09-05: no relay).
6. **De-triplicate the three alta builders — [owner]** in `fiscal-verifactu/src/backend.ts`
   (`recordSale` / `recordCorrection` / `recordSubstitution`; already under *Debt → Fiscal*): needs
   the huella-invariance re-run across all three.

**Coordination rules for the three sessions** (each paid for already, CLAUDE.md §2/§4):

- **Serialise pushes and browser-mode test runs.** Never two pre-push hooks at once — Tracks B and
  C both touch browser packages (real headless Chromium; two overlapping gates force-quit the machine
  on 2026-08-30) and Track A's real-PG suites race on Docker ports. Before `git push` or a local
  `test:coverage`, `pgrep -f .husky/pre-push` must print nothing; wait if it does.
- **No new CORE migration in Tracks B/C until Track A's squash lands** (the module rule already
  forbids it without a stated reason). Module-owned migrations (Track C) are regenerated on rebase
  per CLAUDE.md §3's recipe; whoever lands second rebases.
- **Shared files:** `apps/server/src/boot.ts` (A deletes role pools; B refactors workers → B6 waits
  for A3), `packages/sync`'s apply gate (A's roles vs B's one-case trim → B does it after A3 or takes
  the rebase), `CLAUDE.md` (A: §2–§4, B: §5, C: §3 — textual rebases), and this file (each track
  edits its own sections plus this list; conflicts are textual).
- **Comment thinning on touch only** (CLAUDE.md §1); no sweep in any track.
- **Update this list as items land**, in the same PR.

### Layout designer & device profiles (NEW — owner-inserted 2026-09-02, spec approved)

A visual, HA-Sections-style **layout designer** with reusable **layout profiles** (tabs → grid →
cards), unification of **tills into the enrolled-device model** (a `till` device kind; hardware binds
per-device; **fiscal SIF/chain stays on the node** — H2-gated, verify-by-container + owner sign-off),
and a dev-only **per-tab device switcher**. Replaces the narrow per-tenant `till_layouts` (dropped,
pre-production). The owner inserted this ahead of resuming Track-2 infra. Design:
[layout-designer-and-device-profiles](superpowers/specs/2026-09-02-layout-designer-and-device-profiles-design.md).

Decomposition + order **A → C → B** (each its own spec → plan). **A and C are landed; SP-B (grid
editor + rendering) is the sole remaining sub-project of this track.**

- **SP-A.1 — profile & card data model — LANDED #194.** Pure `@waitron/layouts` logic: form factors +
  12-card catalogue + capability flags, per-card contract registry (config/permission/capability/
  visibility-states/spans; `SALE_CRITICAL_CARDS` derived), fail-closed `validateProfile` +
  CSS-injection-safe `validateThemeOverride`, built-in default profiles, `profile.invalid`/`theme.invalid`
  error families. No DB/API/rendering/device/fiscal (those are later slices). Plan:
  [sp-a1-data-model](superpowers/plans/2026-09-02-layout-profiles-sp-a1-data-model.md).
- **SP-A.2 — device unification & hardware — LANDED #199 (2026-09-03; owner signed off the H2 receipt).**
  Shipped: `till` device kind, device→profile FK + static per-device hardware
  bindings, enrolment extension (carries profile/`till_id`/hardware; `device.till_required`/
  `device.binding_invalid`), management API for profiles + tenant theme, server-side capability enforcement
  (`assertDeviceCapability` for pay/drawer; `assertNotHandheld` kept for place/reprint/collect/cancel),
  theme storage, dashboard Add-device UI, `apps/till` till-enrol screen, `dev:setup` mints a till code.
  The fiscal cutover — a sale's `till_id` now resolves from the authenticated device — passed its §7/§16.4
  container+mutation receipt (`till_id` inert to the huella; `nodeId`/series stay on the node; only
  `sales.till_id` moved). SP-A.1 deferrals (a)-(d) all folded in.
  - *SP-A.2 follow-ups (deferred, pre-production-only edges):*
    1. **Location-consistency guard** — a sale-capable device's assigned register (`till_id`) should live
       in the box's configured location; nothing enforces `device.till.location == cfg.locationId` today, so
       a mis-provisioned device could stamp a fiscal record's operation-description with a different site.
       Add a guard at enrol or first sale. Not reachable in dev; no crash.
    2. **Register-identity redesign (own spec, H2).** Owner question 2026-09-03: should the durable `tills`
       table be subsumed into the device/enrollment (the enrollment *is* the register), with a generated
       register identifier stamped instead of a `tills.id`? `till_id` is confirmed fiscally informational
       (chain/series keyed on the NODE, `series.ts:19`), BUT `tills` is referenced by ~7 tables + provisioning
       + the sync/replication bundle, and changing what an immutable record's `till_id` holds needs a new H2
       receipt — a real initiative, not a cleanup. Needs its own brainstorm + full fiscal trace; capture the
       "a moved till is a new register" philosophy there.
- **SP-C — dev per-tab device switcher — LANDED #201 (2026-09-03).** Shipped: a third `WAITRON_ENV=dev`
  value that maps to `environment=preproduction` for all fiscal/AEAT/Stripe/DB-stamp code (no migration,
  fiscal enum untouched) and additionally sets a new `config.devMode`; a dev-override header
  `x-waitron-dev-device: <deviceId>` honoured ONLY under `devMode` at the single chokepoint `tryReadDevice`
  (no token check, RLS/`active`-scoped, header-wins-over-cookie, no cookie fallback); dev-only
  `GET`/`POST /api/dev/devices` (list + mint-and-adopt) and `POST /api/device/reset`; the `?dev` chooser
  (`apps/till`) with per-tab `sessionStorage` identity + a fetch-wrapper header injector; `dev:setup` now
  emits `WAITRON_ENV=dev` (venue still stamped/behaves preproduction). Fail-closed (inert outside dev) is
  pinned by config-unit + real-PG override + HTTP e2e (preproduction→401), and the fiscal boundary by a
  sale-under-override receipt test (`sales.till_id` follows the overridden device; `nodeId`/series/huella
  unchanged). **Security note:** a review pass caught that `POST /api/device/reset` as first written was an
  unauthenticated, always-mounted, CSRF-able cookie-clear that could 401 a live till's sales (§5); it is
  now **devMode-gated (404 in production)**, and the spec (§4.4) + plan (Task 3) carry dated corrections
  superseding their original "mounted always" text. Design:
  [sp-c-dev-device-switcher](superpowers/specs/2026-09-03-sp-c-dev-device-switcher-design.md); plan:
  [sp-c plan](superpowers/plans/2026-09-03-sp-c-dev-device-switcher.md). No SP-C follow-ups deferred.
- **SP-B — grid editor + rendering — B1 #204; B2 (#206+#207); B3 split into B3.1 (LANDED #209, 2026-09-04) + B3.2 (LANDED #213, 2026-09-04: Phase A profile→canvas rename + Phase B the canvas editor UI); B4 LANDED #218 (2026-09-04). SP-B B1–B4 build sequence complete. Editor-polish follow-on batch also LANDED (2026-09-05): fresh-display KDS enrol #221, pointer drag/move/resize #222, representative card silhouettes #223. Larger follow-ons still open below (visual theme editor, truly-real card renders, NFC pairing, community sharing; device profile LANDED #231).**
  The HA-Sections editor UI plus making screens render from grid profiles (wrap the bespoke
  floor/KDS/table-order screens as cards; phased). The schedule risk. Removes the old widget model
  (`WIDGET_TYPES`/`validateLayout`/`till_layouts`) once rendering swaps over. Design:
  [sp-b-grid-editor-and-rendering](superpowers/specs/2026-09-03-sp-b-grid-editor-and-rendering-design.md);
  B1 plan: [sp-b1-grid-renderer-and-counter](superpowers/plans/2026-09-03-sp-b1-grid-renderer-and-counter.md).
  Decisions (brainstorm 2026-09-03): **rendering-first slicing** — **B1** grid renderer + counter
  renders from profile · **B2** wrap the four bespoke screens as full-span cards + tabs/drill-in nav
  (**owner split into B2.1 + B2.2**, spec + two plans below) · **B3** dashboard grid editor (placeholder
  tiles *for v1*; live renders a committed follow-on) + API client + reassign-profile route · **B4**
  drop old widget model + rehome receipt into a new `tenant_receipts` table. **Fluid width only** (no
  column reflow; orientation = form-factor). Not H2, but must preserve the sale path. SP-B2 design:
  [sp-b2-till-tab-shell](superpowers/specs/2026-09-03-sp-b2-till-tab-shell-and-card-wrap-design.md);
  B2.1 plan: [sp-b2-1-tab-shell](superpowers/plans/2026-09-03-sp-b2-1-tab-shell-and-light-card-wrap.md);
  B2.2 plan: [sp-b2-2-heavy-screen-wrap](superpowers/plans/2026-09-04-sp-b2-2-heavy-screen-wrap.md).
  - **B1 LANDED #204:** `GET /api/till` resolves a `ProfileDef` for every enrolled device (explicit →
    else form-factor default via `deviceFormFactor`; cookieless unchanged); till-local `ProfileDef`
    mirror + `till-card-grid` fluid renderer; the counter renders from its profile `counter` tab with
    the region model kept as a fallback (removed in B4); `till-app` boots the counter into its profile.
    Owner call: the default counter drops the prep-queue rail (SP-A's `DEFAULT_PROFILES.till` has no
    prep-queue card) — **shipped as-is**; revisit default-profile content separately if wanted.
  - **B2.1 LANDED #206 (2026-09-03):** the `till-tab-shell` (tab bar from `profile.tabs` + relocated
    header chrome + a `drill` overlay slot) and a transient **drill-in nav stack** in `till-app` that
    replaces the `screen`-enum for the authenticated operator surface **when a profile is present**;
    the legacy `screen`-enum stays as a fallback (removed in B4). Every tab renders through
    `till-card-grid`, which gained the three visibility axes — **capability→absent** (with a hard
    `tender-pay` cash carve-out that always renders), **permission→locked** (`inert` dimmed cell; only
    `table-layout-editor`/`till.configure`), and **`visibleWhen` fail-OPEN** for uncomputable state.
    **expo** and **floor-plan** are wrapped as embedded full-span cards (an `embedded` prop suppresses
    their own header/Back). The four B1-review follow-ups (a)-(d) are all folded in — note (d) is now
    fail-**open** (was fail-closed). Not fiscal; the sale path was verified end-to-end through the
    shell. Reachability kept profile-neutral (station/expo/schedule reachable as affordance drill-ins;
    default-profile content + capability-driven reachability deferred to the B3 editor).
  - **B2.2 LANDED #207 (2026-09-04):** the two **heavy** screens — **station** (kds-board) and
    **table-order** — are wrapped as embedded cards (their own header/Back suppressed via the same
    `embedded` seam expo/floor use; body-function controls — station's view-toggle, table-order's
    drawer-handle — kept in an always-present actions bar). `till-card-grid` now renders `kds-board` →
    `<till-station-screen embedded>` (device-mode/enrol props threaded) and `table-order` →
    `<till-table-order-screen embedded>`; **only `notifications` still renders `nothing`**. The first
    **reachable** `kds-board` capability→absent skip is un-skipped and proven by deletion. The profile
    shell is **re-enabled for handheld + kds** (`#shellActive()` fence dropped): owner call 2026-09-04 —
    **handheld = full shell header** (operator + Logout) with **no** Station/Expo/Schedule affordances;
    **kds = kiosk** (a `tab-shell` `kiosk` flag suppresses the whole operator header). Handheld
    table-order **mount duality**: opening a table switches to the **Order tab card** (a till keeps the
    B2.1 open-table drill); the return to floor is the **Floor-tab tap**. Not fiscal; the sale path is
    untouched (counter tab + `tender-pay` unchanged; table-order's embedded `tender-pay`/`pay-tab`
    intact). Coverage held 95/95/90/88 (1201 till tests).
  - **B2.2 review fixes (folded into #207):** two handheld post-transaction paths written when
    handheld/kds were legacy-only were corrected — `#onNewSale` now lands on the device's **home tab**
    (`profile.tabs[0]`, not a hardcoded `"counter"` a handheld has no tab for) and refreshes a stale
    floor after a tab settlement; `#onLoggedIn`'s floor prefetch is guarded on `!#floorLoaded` so a
    handheld login loads the floor once, not twice. A speculative dead `#onBackToFloor` branch (+ its
    synthetic-event test) was removed in the simplify pass (the embedded card suppresses its Back, so
    `back-to-floor` is only reachable from a till drill).
  - **B2.2 deferrals (recorded, not blocking):** a handheld's **Order tab is directly tappable with no
    active table**, showing an empty table-order surface — accepted as the authored-profile behaviour
    (the owner authors `order` as a tab); revisit in the B3 editor if it wants a guard. A pre-existing
    `till-floor-screen` doc comment that names `#goToScreen`'s face-set gate as the `back-to-counter`
    guard is now slightly inaccurate for the shell path but **unreachable** (the embedded floor card
    sets `canExitToCounter=false`) — left as-is (unedited file).
  - **B2.1 deferrals (still recorded):** the boot-into-floor prefetch block in `#onLoggedIn` (the
    `#inShell()` + `#tabNeedsFloorData(firstTab)` reload) is now guarded on `!#floorLoaded`, so it is
    **still unreached by any shipped profile** — the handheld (phone) IS floor-first but its login loads
    the floor via `#onShowFloor` first (setting the flag), and no non-handheld floor-first profile
    exists yet; add a deletion-proof when the B3 editor lets the owner author one. The redundant "STILL
    hides" held-orders test in `card-grid.test.ts` (harmless) remains.
  - **B3 owner-split into B3.1 (plumbing) + B3.2 (editor), 2026-09-04.** The mechanical plumbing (route +
    client + reassign control) front-loads value and de-risks the hard editor UI, mirroring the B2 split.
    B3.1 plan: [sp-b3-1-reassign-plumbing](superpowers/plans/2026-09-04-sp-b3-1-reassign-plumbing.md).
  - **B3.1 LANDED #209 (2026-09-04):** an owner can **reassign** an enrolled device to a different layout
    profile — or clear it back to the form-factor default — from the dashboard Devices screen, without
    re-enrolling. `POST /management-api/devices/:id/assign-profile` (gated `device.manage`, in
    `device-api.ts` beside the sibling device routes — owner call, departing from §8's `PUT`/`till.configure`;
    same roles). A bad/foreign profile → `device.binding_invalid` via the composite FK
    `devices_layout_profile_fk` translated by `bindingFkField` (atomic, tenant-isolated — no read-then-write
    race; Copilot-hardened from an initial `getProfile` pre-check). `GET /management-api/devices` now returns
    `layoutProfileId`; the dashboard grows `reassignDevice` + a per-active-row profile `<select>`. The five
    profile-CRUD endpoints (list/get/create/update/delete) already existed server-side (verified) — untouched;
    the editor that calls them is B3.2. No migration / no new grant / not fiscal. B3.1's fuller value lands
    with B3.2 (authored profiles to choose from).
  - **B3.2 (LANDED #213, 2026-09-04):** the dashboard **canvas editor**, split into its
    own Phase A + Phase B (owner call 2026-09-04, distinct from the B3.1/B3.2 split above). Design:
    [sp-b3-2-canvas-editor-design](superpowers/specs/2026-09-04-sp-b3-2-canvas-editor-design.md); plans:
    [sp-b3-2a-profile-to-canvas-rename](superpowers/plans/2026-09-04-sp-b3-2a-profile-to-canvas-rename.md),
    [sp-b3-2b-canvas-editor](superpowers/plans/2026-09-04-sp-b3-2b-canvas-editor.md). Parent design §8 (now
    carries a dated pointer to the rename).
    - **Phase A — `profile` → `canvas` rename, LANDED #213 (behaviour-preserving).** Today's
      "layout profile" is renamed **canvas**, reserving "profile" for a future, bigger device profile
      (capabilities are staying on the canvas record **transitionally** — see the deferral below). Renamed:
      table `layout_profiles`→`canvases` (RENAME migration, not drop/recreate — an FK-target constraint
      can't be dropped); type `ProfileDef`→`CanvasDef`; error codes `profile.*`→`canvas.*`; the
      `devices`/`device_pairing_codes` `layout_profile_id` column→`canvas_id`; routes
      `/management-api/profiles[/:id]`→`/management-api/canvases[/:id]` and
      `/management-api/devices/:id/assign-profile`→`/assign-canvas`; the till's `TillInfo.profile`/`/api/till`
      `profile` key→`canvas`, including the SP-C dev-switcher's till-side mirror (`DevProfile`→`DevCanvas`,
      not in the original task inventory, caught in review); the dashboard client type
      `LayoutProfile`→`Canvas`. No behaviour change, no new grant, no new table. Whole-workspace
      `pnpm test` green after the final task (30 packages / 10038 tests).
    - **Phase B — the canvas editor UI, LANDED #213.** The management dashboard's
      `dashboard-canvas-editor-screen` (nav `nav.canvases`): a **list mode** (create-from-default-per-form-factor,
      duplicate, delete, with a per-row `<canvas-grid-preview>` thumbnail of the first tab) and an
      **editor mode** (tab bar with add-tab/tab-settings, the placeholder-tile canvas, a card palette from
      `CARD_CONTRACTS`, and a property panel per card/tab/canvas — colSpan/rowSpan steppers, per-card
      config + `visibleWhen` toggles + permission/capability warnings, tab title/columns/last-tab-guarded
      delete, canvas name/form-factor/capabilities). Client-side `validateCanvas` mirror (a DB-free
      deep-import of the pure `@waitron/layouts` `card-contract`/`canvas` modules, drift-guarded) + a local
      contract mirror keep the #70 bundle rule (the dashboard never runtime-imports `@waitron/layouts`;
      `definition` crosses the client boundary as `unknown`, defensively parsed). +4 API-client methods
      (`listCanvases`/`getCanvas`/`createCanvas`/`updateCanvas`/`deleteCanvas`). a11y-clean in both themes
      (the tab bar is a plain button group with `aria-current`, **not** an ARIA `tablist` — `wt-button`
      wraps a native button, so `role="tab"` on the host nests interactive controls; fixed in B8). Dashboard
      `test:coverage` green (1285 tests, 95/95/90/88). This was the SP-B **schedule risk** (the
      product-facing UI). Built tasks B1–B8; a11y + final gate = B8.
    - **Deferred follow-ons from Phase B:**
      - **Pointer drag / move / resize — LANDED #222 (2026-09-05).** Direct-manipulation drag-to-reorder
        (Pointer Events, threshold + drop indicator, emits `move-card`) + corner-handle resize (snaps to
        whole columns/rows, emits `resize-card`) on the editor tiles; the property-panel steppers + ↑/↓ stay
        as the keyboard/a11y path. The preview stays a pure view emitting intents; the screen owns mutation.
      - **Live card renders — LANDED #223 (2026-09-05, representative, NOT the real cards).** The real till
        widgets can't be reused (they live in `apps/till`, need live POS stores + ~30 props, and importing
        them or `@waitron/layouts` breaches the #70 bundle rule), so #223 ships dashboard-local static
        *representative silhouettes* per card type (`card-preview.ts`: exhaustive switch, memoized) — a
        recognizable shape per type, no data, decorative (`pointer-events:none`/`aria-hidden`) so the drag/
        resize seam still works. **Still open — truly-real cards** would need a neutral browser-safe shared
        card package both apps import (extracting the till widgets off their live stores/props): a separate,
        larger initiative, not started.
      - **Visual theme editor** (also listed under Follow-ons below).
      - (Clone/duplicate already shipped in Phase B — no longer a follow-on.)
    - **Deferred follow-on — device profile — LANDED #231 (2026-09-05).** The
      **skeleton + capabilities** slice of the future bundle. A first-class **`device_profiles`** table
      (`name` + a nullable `canvasId` FK + a validated `capabilities` jsonb array) with FORCE RLS +
      tenant-isolation + the composite `(tenant_id, canvas_id) → canvases` FK; the device now carries a
      **`device_profile_id`** and its old `canvas_id` was **dropped** (0110), so the binding is a single
      chain **device → device profile → canvas** — a device with no profile falls back to the form-factor
      default canvas and empty capabilities (fail-closed firewall). **Capabilities relocated off the
      canvas onto the profile** (`CanvasDef` no longer carries a `capabilities` field; the `/api/till`
      payload returns `capabilities` as a sibling of `canvas`). CRUD `/management-api/device-profiles`
      routes + a dashboard device-profile editor screen + the devices screen assigning a profile;
      enrolment/reassign thread `device_profile_id`; `dev:setup` seeds a default "Counter" profile and
      stamps it on the till pairing code. Spec
      [device-profile-design](superpowers/specs/2026-09-05-device-profile-design.md). **Still
      per-device (NOT relocated):** till / station / hardware. **Still deferred:** area / order-routing /
      printer-target aggregation. **Deferred follow-ons this slice leaves open** — the follow-on batch
      LANDED #234 (2026-09-05) closed (b), (c) and (d); **(a) the
      aggregated bundle is now the sole deferred item:**
      - **(a) The aggregated bundle** — relocating till / station / hardware onto the profile and adding
        area / order-routing / printer-target, the larger "profile" the SP-B rename reserved the word for.
      - **(b) Tenant-facing default profiles — LANDED #234 (2026-09-05).** `provisionVenue` now
        seeds every new tenant a starter device-profile set (find-or-create by name, locale-resolved
        names, `canvasId: null` → the form-factor default canvas), authored by the seeded admin on the
        caller's tenant-scoped tx; `DEFAULT_DEVICE_PROFILES` shared with the dev seed.
      - **(c) The SP-C dev-switcher device-profile picker — LANDED #234 (2026-09-05).** The dev
        role can switch which profile the current device carries from the in-app switcher; dev-minted
        devices now carry a `deviceProfileId`.
      - **(d) A clean 4xx on an in-use delete — LANDED #234 (2026-09-05).** Both stores now
        translate the FK `ON DELETE RESTRICT` `23001` restrict_violation into a clean 409 —
        `device_profile.in_use` (`device-profile-store.ts`) / `canvas.in_use` (`canvas-store.ts`) —
        matched on the referencing constraint so an unrelated RESTRICT is never mislabelled.
  - **B4 LANDED #218 (2026-09-04):** dropped the old widget model and rehomed the non-fiscal
    receipt trim. **Removed:** `WIDGET_TYPES`/`WidgetInstance`/`LayoutDef`/`Region`/`WIDGET_CONFIG`/
    `validateLayout`/`store.ts`/`DEFAULT_LAYOUT` from `@waitron/layouts`; the till's region render
    (`#renderScreen`/`#layoutFor` and the legacy `screen`-enum fallback); the old dashboard widget
    editor; the `layout` field of `GET /api/till`; the `layout.invalid` error code; the
    `till_layouts` table (0105 DROP); the old `@waitron/layouts` widget exports and the
    `/management-api/layout` routes. **Rehomed:** the non-fiscal receipt trim into a new
    `tenant_receipts` table — **0103** create + **0104** custom RLS (FORCE ROW LEVEL SECURITY +
    `tenant_receipts_tenant_isolation` policy + SELECT/INSERT/UPDATE grants to `app_user`) — behind a
    `receipt-store` (`getReceipt`/`putReceipt`) and `GET /management-api/receipt` (the dashboard
    receipt editor repointed at it). **Counter render:** `GET /api/till` now always resolves a canvas
    for every request — including cookieless, which falls back to the `till` form-factor default —
    so the counter renders from a canvas only; the sale-path invariant is preserved by guaranteeing a
    canvas is present *before* the region fallback was removed. **Not fiscal** — `nodeId`/chain/series
    untouched. (The one behaviour change surfaced is recorded as the deferred follow-on immediately
    below.)
  - **SP-B4 deferred follow-on — fresh-display KDS enrol flow — LANDED #221 (2026-09-05).** Fixed with the
    enrol-overlay approach: the lock screen's *set up as kitchen display* affordance now opens a standalone
    pairing-code enrol overlay (an `enrolling` state), symmetric with the till/handheld `setup` paths, and a
    redeemed code re-boots so the `kds_station` cookie boots the display into the kiosk shell — post-enrol
    routing stays in `#boot`, not the screen. The rule-of-three that this surfaced was collapsed too: the
    two standalone enrol screens (`till-enrol-screen`, `till-handheld-enrol-screen`) became one
    `till-device-enrol-screen` parameterised by `kind`, and `till-app`'s two `…Enrolling` booleans became one
    `enrolling` enum (net −139 lines). The station screen's own device-mode enrol sub-view is now unreachable
    via the app but left in place — a possible later cleanup.
- **Follow-ons:** visual theme editor · NFC pairing runtime + payment routing (payments-gated on the
  SumUp questions) · community profile sharing.

### Waitron module system (NEW — 2026-09-04; architecture landed on main; framework + fiscal exemplar)

Turn each domain into an optional, swappable **module** owning its own schema+migrations, sync enrolment,
UI cards, vocabulary, theme, privileges and cronjobs, plugged into a generic core that imports nothing
domain-specific (composition-root DI + an open registry set). Emerged from the H2 fiscal-sync work hitting
the english-only guard: the generic sync layer *imports* domain schema, so the owner ruled to invert it —
the generic mechanism knows nothing; each domain declares its own. Generalised across schema/sync/UI/
vocabulary. **H2 fiscal-record sync is now SP-3 of this initiative**, not a standalone track. Architecture:
[module-system-architecture](superpowers/specs/2026-09-04-module-system-architecture-design.md).

**Scope (owner, 2026-09-04): framework + fiscal exemplar.** Prove the framework on fiscal (the swappability
driver — country-selected: Spain → `fiscal-verifactu`). Extracting the other core-trapped domains
(kitchen/catalogue/tables/…) into modules, and the runtime **code-distribution** mechanism (signed bundles
across nodes; fiscal is its first future consumer), are **designed seams, deferred**.

**Key model decisions** (in the architecture spec): enablement = an on-box desired-state module config file
reconciled against the `deployment` stamp at boot; the module set is deployment-wide (bootstrapped at adopt,
flowed down from the primary, applied on reboot); **soft-disable keeps data**; each node runs its OWN
migrations (sync replicates rows, not DDL) with a **schema-version handshake** so a subscriber never applies
rows newer than its migrated schema (owner chose this over DDL-over-sync).

**Decomposition (each its own spec → plan → PR):**

- **SP-1a — module contract + migration source inversion — LANDED #212 (2026-09-04).** `@waitron/module`
  (`WaitronModule` + `orderedMigrationSets`), `expected/appliedSchemaVersion` primitives, `ALL_MODULES`
  (nine descriptors) in the composition root, boot deriving its migration list from `ALL_MODULES`
  (behaviour-preserving; manifest kept as a live source for provisioning/dev/bundling, the two encodings held
  equal by a pin). **Descriptors are centralized for SP-1a** (generic fields only); **package-ownership
  begins in SP-2** (first domain content). Copilot caught two real ones no other layer did (a false
  `name`==table-suffix claim; `drizzle-orm` had to become a production dep). Spec:
  [sp-1a](superpowers/specs/2026-09-04-module-sp1a-contract-and-migration-source.md).
- **SP-1b — enablement + reconcile — LANDED #215 (2026-09-04).** On-box `modules.json` (sparse override
  map, **default-on**: a module is enabled unless explicitly `false`) → boot filters the **trading-mode**
  migration list by the enabled set (setup still migrates all) + a drift log; `provisionVenue` **refuses**
  venue provisioning when a `provision-only` module (fiscal) is disabled — step 0, before any DB write.
  Key deviations from the architecture, both deliberate: actual state is **derived** from
  `appliedSchemaVersion` (**no `deployment` column** — nothing to keep consistent), and the fiscal gate is
  a **loud refusal**, not a working fiscal-less venue — `applyVenue` mandates a SIF (`venue-apply.ts`), so
  that path is SP-3. The SP-1a migrate/seed forward-warning is addressed by gating the seed (refusal) and
  showing the migrate-path divergence benign (over-migration lands as soft-disable), source-unification
  deferred to SP-3. Error code `module.mandatory_not_disableable` is tier-driven (names no module).
  Behaviour-preserving by default. Copilot approved; both its comments (409 status mapping; drop an
  unreceipted privilege claim) applied. **Deferred follow-ups:** (a) only the `provision-only` tier is
  guarded — a **toggleable** module that is actually load-bearing (identity/sync/payments, still
  statically wired) fails boot loudly if disabled, until the SP-2/SP-4 wiring inversion + core-extraction;
  (b) the trading filter also runs in **mirror** mode, so **SP-1d** must keep a mirror's enabled set
  consistent with its primary's; (c) **each module will own its own testing** — add `testing` to the
  module contract at **SP-2** (owner steer 2026-09-04). Spec/plan:
  [sp-1b](superpowers/specs/2026-09-04-module-sp1b-enablement-and-reconcile.md).
- **SP-1c — versioned migration ordering — LANDED #217 (2026-09-04).** `orderedMigrationSets` rewritten from
  `modules.map(...)` into a pure resolve-validate-and-order: it validates every declared `requires` edge
  (semver-range compatibility via the newly-pinned `semver` dep, dependency presence, malformed-range
  rejection), detects cycles, and returns the sets in a **stable topological order** (Kahn's algorithm, input
  order as the tie-break — reproduces the manifest order, so SP-1a's pin still holds and now also proves the
  sort). `requires` populated on the nine descriptors from the **verified** cross-set graph. Four new
  `module.*` codes (`dependency_missing`/`dependency_cycle`/`incompatible_version`/`requires_invalid`).
  Behaviour-preserving; schema-version gate **deferred** (owner call — topo order already guarantees
  core-before-dependents within one boot; the cross-node gate is SP-2). The **dependency-presence** check is
  the one part tripping today: SP-1b's `modules.json` can disable `identity` with `workforce` still on, which
  SP-1c now refuses at boot (`module.dependency_missing`) before migrating — proven by a real-PG boot test.
  **Key review find:** the first-pass graph was FK-only and missed `sync → {identity, payments}` — `sync`
  attaches to those modules' tables via `CREATE TRIGGER … ON`, not FKs; fixed, and recorded as a durable
  CLAUDE.md §3 lesson (grep both FK `REFERENCES` and `CREATE TRIGGER … ON` when deriving a module graph).
  Copilot approved (5 minor doc/comment nits, all applied). **Deferred, surfaced not built:** (a) a
  graph-honesty guard that scans the drizzle SQL and asserts each descriptor's `requires` names every FK/
  trigger dependency — deferred to **SP-2** where descriptor package-ownership begins and the guard has a
  natural home; until then §3's table is the receipt; (b) provisioning's migrate path still runs the linear
  full `manifestSets()` (already a valid order) — must route through the resolver once it gains per-module
  enablement; (c) folding `requires.core` into `requires.modules` to drop the special-case + `core: "*"`
  boilerplate — declined here (changes the SP-1a owner-reviewed contract shape; `core` is deliberately the
  special mandatory root), a candidate if the contract is revisited later. Spec/plan:
  [sp-1c](superpowers/specs/2026-09-04-module-sp1c-versioned-ordering.md).
- **SP-1d — cross-node config replication.** Adopt-bootstrap half **LANDED #220 (2026-09-05):** a
  mirror inherits the primary's
  enabled-module set at adopt — the primary's `modules.json` overrides ride the existing
  mirror-bundle handshake (`MirrorBundle.moduleOverrides`, minted fresh at assemble time), and
  `adoptFromPrimary` re-validates them against the mirror's own `ALL_MODULES` (fail-closed) and
  writes the mirror's own `modules.json` before it first enters trading mode. New:
  `serializeModuleConfig` (`@waitron/module`), `writeModuleConfig` (`apps/server`). No schema
  change, no new error code, no DB row — SP-1b's on-box-file decision preserved; the bundle
  carries a snapshot, not a live channel. Honest scope: on a fresh mirror this does **not** prevent
  a migration wedge (setup already migrates every table); it makes the mirror's enabled **set**
  equal the primary's, for honest reconcile drift today and SP-2's per-enabled-module pull
  tomorrow. **Ongoing flow-down deferred**, with two receipts: (a) no config channel exists to
  carry a later primary-side change — sync replicates tenant rows, `modules.json` is an on-box
  file, and `deployment`/`mirror_config` are non-tenant singletons that can't ride the RLS lane;
  (b) nothing is disableable today (eight effectively-core modules, fiscal always-on), so there is
  no live case to prove flow-down against yet. Folds into **SP-2**'s scope, built alongside the
  first genuinely-toggleable module. Spec:
  [sp-1d](superpowers/specs/2026-09-04-module-sp1d-adopt-bootstrap-design.md).
- **SP-2a — sync enrolment inversion + graph-honesty guard — LANDED #227 (2026-09-05).** SP-2 split
  into two slices (owner decision 2026-09-05, SP-2b below). Every domain package declares its own sync **enrolment** via the new leaf
  `@waitron/sync-enrolment` (`enrol()` derives each entry's table + column list off the owning
  package's own Drizzle schema, so it cannot drift); `@waitron/sync` imports no domain schema and
  drops `@waitron/payments` entirely, keeping `@waitron/identity` **only** for `peers.ts`'s scrypt
  helper (a pre-existing #144 non-schema coupling, not enrolment). Package-owned enrolment lands for
  core/identity/payments; `apps/server`'s composition root assembles the injected set and wires it
  into the sync runtime. Picks up SP-1c's deferred graph-honesty guard
  (`scripts/module-graph-honesty.test.ts`, matching `CREATE TRIGGER` and `CREATE CONSTRAINT TRIGGER`
  against every package's `drizzle/*.sql`) plus a real-PG completeness pin (the assembled enrolment's
  table set equals the tables actually carrying an installed `sync_capture` trigger).
  Behaviour-preserving — same 22 tables, identical generated apply SQL. Spec:
  [sp-2a](superpowers/specs/2026-09-05-module-sp2a-sync-inversion-design.md).
  **Deferred follow-up (Option B, spec §2e):** `@waitron/sync` still depends on `@waitron/identity`
  for `peers.ts`'s scrypt helpers (`hashSecret`/`verifySecret`, `secret-hash.ts` — a #144 non-schema
  coupling). Relocating those to a leaf (`@waitron/shared`) would let `@waitron/sync` depend on **no**
  domain package at all — a real improvement, but it touches `@waitron/identity`'s public surface and
  every `hashSecret` consumer, so it was out of scope for this schema-inversion slice. Small,
  unclaimed, do-anytime.
- **SP-2b — schema-version handshake + park gate — LANDED #230 (2026-09-05).** `/sync-api/hello` gains
  `moduleVersions: Record<string, number>`, a boot snapshot of each module's **applied** (not
  shipped) schema version. A subscriber compares its own applied version per module and **parks**
  (never applies, never drops) a row whose owning module the source has migrated ahead of it,
  funnelled through the existing at-least-once `deferred`/park machinery (`apply.ts`) — the lane
  cursor holds strictly below the parked seq and redelivers it once the subscriber reboots and
  migrates; convergence is the rolling reboot. Module identity at apply time comes from a
  `table → module` map (`MODULE_BY_TABLE`) built at the composition root and threaded into
  `applyBatch` alongside the version maps — SP-2a's `EnrolledTable` type and its threading are
  untouched. Closes the silent-corruption hazard: `jsonb_populate_record` drops a JSON key with no
  matching column, so an unparked source-ahead row would look complete but lose data — proven by
  deletion (remove the version check and an ahead-module's row applies with its new column silently
  gone). No migration, no new error code (a `versionParked` counter + log line instead — the park is
  a normal operational state, not an error), behaviour-preserving with no version skew (equal
  versions never park; an older peer that omits `moduleVersions` gates nothing). Spec:
  [sp-2b](superpowers/specs/2026-09-05-module-sp2b-schema-version-gate-design.md).
  **Deferred, same ruling as the gate itself (spec §2/§7.1): the "pull only your enabled modules"
  source filter.** Cursor-unsafe with today's single per-lane cursor — excluding a module's tables
  source-side while the cursor still advances past the excluded rows would delete history a
  subscriber can never recover if it later re-enables that module — and there is no live case
  (nothing is genuinely toggleable, SP-1b/SP-1d). Built alongside the first genuinely-toggleable
  module, designed against the enablement lifecycle then.
- **SP-3 — fiscal as a module (= H2's fiscal-record lane)** + vocabulary + gated provisioning; swappable. The
  standalone H2 spec/plan (branch `feat/h2-fiscal-record-sync`, never merged) are reference material for this.
  SP-3 was split into **four slices** (owner decision 2026-09-05, during the SP-3a brainstorm), each its
  own spec→plan→PR under the architecture-spec umbrella: **3a** sync lane, **3b** vocabulary, **3c**
  gated-provisioning seam, **3d** backup/restore hook (= BR-4, folded into SP-3 by owner decision).
  - **SP-3a — fiscal-record sync lane — LANDED #238 (2026-09-05).** Enrols the six fiscal tables
    (`registros_facturacion` insert-only + `registro_sif`/`cadenas`/`envios`/`envio_flujo`/`acks`
    watermark-upsert) onto the sync ordered lane via a package-owned `FISCAL_ENROLMENT`
    (`@waitron/sync-enrolment`); fiscal **owns its capture DDL** (`0014_fiscal_sync_capture.sql`, calling
    sync's `sync_capture()` SPI — owner principle: fiscal independent, API-only), giving a `fiscal → sync`
    module edge that **reordered the manifest so fiscal migrates last** and extended the graph-honesty
    guard to detect the SPI edge. Fiscal rows apply **verbatim** on a mirror (no huella recompute;
    immutability honoured — a stray mutation as the apply role is `42501` (grant), `WT001` only for a
    bypassing superuser, verified on `postgres:18`); `contadores_instalacion` not enrolled; SP-2b
    module-version park wired. Six real-PG proven-by-deletion gates in `apps/server`. Consequence: because
    `0014` calls the sync SPI, fiscal's migrations no longer run standalone, so its PGlite harnesses migrate
    the full manifest (a **dev-only** `@waitron/migrations` cycle; prod graph acyclic). Copilot's 5 findings
    all applied. Spec:
    [sp-3a](superpowers/specs/2026-09-05-module-sp3a-fiscal-record-lane-design.md); plan:
    [sp-3a plan](superpowers/plans/2026-09-05-module-sp3a-fiscal-record-lane.md).
    - *Deferred (surfaced by the whole-branch review, NOT done — do-anytime):* (a) the ~300-line two-clone
      apply-harness duplication across the four `apps/server/src/fiscal-*.rls.test.ts` suites → extract a
      shared `useFiscalMirrorPair()` helper (kept per-suite for now to avoid a vacuous-pass risk in the
      fiscal gates); (b) generalise the graph-honesty SPI detector from the `sync_capture`-specific match to
      **all** trigger `EXECUTE FUNCTION` cross-module edges — would also catch the currently-undetected
      `reject_mutation` (fiscal→core, workforce→core) edges, verified safe on today's tree; (c) micro-opts
      (guard `stripSql` runs 6× per file; parallelise source/target seeds).
    - *Flake stabilised, not just re-run (owner directive):* the CI `test-server` shard's documented
      `boot.test.ts` 503-not-200 flake (a wall-clock `/health` readiness race) was root-caused and fixed
      with condition-based-waiting (`fetchHealthOk` poll-until-200); ci.yml now uploads shard blobs on
      failure so a future flake names its exact test. Sibling `mirror-e2e.rls.test.ts:~381` remains a
      candidate if it recurs. See memory `test-server-e2e-timing-flakes`.
  - **SP-3b — module-owned vocabulary (NEXT candidate).** Move fiscal's Spanish terms out of the centralized
    `packages/db/src/english-only.ts` (`EXEMPT_PACKAGES`/`SPANISH_WORDS`) into the fiscal module's own
    `vocabulary` seat. Independent of 3a.
  - **SP-3c — module-owned gated provisioning.** Sever the direct `@waitron/provisioning →
    @waitron/fiscal-verifactu` import; route `registerSif` through the descriptor's `provisioningSeeds` seat
    and make `makeFiscalBackend`'s choice module-driven (Spain stays hardwired-but-clean via the existing
    `resolveFiscalModules` registry — country-selection stays out of scope).
  - **SP-3d — fiscal backup/restore contribution (= BR-4).** Fill the module `backup.restore` seat with the
    fresh-chain / disjoint-series behaviour that lets a restored box trade again as primary (cold-DR),
    never resuming the dead chain. Unblocked by SP-3a's module seams (see the Backup & restore section).
- **SP-4 — module UI surface** (card-registry inversion + self-sourcing cards + fiscal's cards) — **after
  B3.2** (shares `@waitron/layouts` / `apps/till` card-grid).

With SP-1a + SP-1b + SP-1c landed, SP-1d's adopt-bootstrap half landed (#220), SP-2a landed (#227),
and **SP-2b landed (#230)** — **SP-2 (the full sync inversion + schema-version gate) is complete.** SP-2a
unblocked SP-3 (H2's fiscal-record lane rides SP-2a's sync inversion) and delivered SP-1c's deferred
graph-honesty guard; SP-2b closes the cross-node schema-skew hazard the rolling-reboot convergence
model depends on. **Ongoing flow-down and the enabled-set pull filter both stay deferred** (same
receipt each time: nothing is genuinely toggleable yet, so there is no live case to build either
against) — both are built alongside the first genuinely-toggleable module. **SP-3a (fiscal-record sync
lane) LANDED #238 (2026-09-05)** — H2's fiscal-record lane is delivered. Next module slices are
**SP-3b (vocabulary) / SP-3c (gated-provisioning seam) / SP-3d (backup-restore hook = BR-4)**, all
independent; **SP-4** waits for B3.2.

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

**Pricing adjustments (NEW — owner-added 2026-09-03):** two related, unbuilt capabilities on the
ordering/sale flow, both gated on the already-anticipated **discount permission** (the "discount gate"
noted under *What's built → Identity* remaining — decide the authorised-role rule and whether a
reason/reason-code is captured):

- **Reduce or zero the price of an order line** — an authorised operator override of a single line's
  price (a comped or reduced dish), down to €0. A line price comes locked from the catalogue today; this
  adds a manual per-line override. (A €0-comp *sale* path exists — *Debt → Product decisions* — but not a
  per-line reduction.)
- **Apply a discount to a whole order** — an order-level discount (percentage or amount) spread across
  all lines, distinct from a per-line override. Needs the distribution rule across lines/VAT rates.

  *Fiscal:* a *descuento* agreed at/before issuance is outside the VAT base (Q15, closed on primary
  source — *The advisor gap*), so a reduction/discount must reach the line **before** `computeHuella`,
  not as an after-the-fact adjustment. H2-adjacent — specced with the owner, not landed unattended.

**Bookings (SP14):** Bookings-1 landed (#180, #182); future, each greenfield — public/online/QR
booking, availability / double-booking prevention, reminders (SMS/email), a customer/CRM entity,
recurring bookings, a calendar grid, deposits.

**Wages / labour cost (SP16, NEW — owner-added 2026-09-04):** a **wage-computation engine** that turns
the hours a person actually worked (the built *registro de jornada*, #47) and the hours they are
scheduled to work (built D2 scheduling) into money owed, and shows the owner **accrued-so-far vs
still-pending** for a pay period. This is a *build* item and is **distinct from the deferred D3 payroll
*export*** (integrate-not-build — that hands the finished figures to the gestoría's package). The engine
is what produces those figures; the export is what ships them out.

The core is a **per-person pay-rule set**, because two staff on the same floor are paid on different
models. Worked examples the owner gave: waiter X is contracted for 35 h/week at €10/h base, €12/h on
weekends or nights, +30% on public holidays, and €10/h while on sick leave — a purely **hourly** model
with condition modifiers. Waiter Y is a **fixed monthly salary** for the contracted 35 h/week, with
extra hours beyond that paid per-hour. So the rule model must express, per person: a base
(hourly-rate *or* fixed-salary-for-N-contracted-hours), plus rate overrides keyed to **conditions of the
hour worked** — weekend, night, public holiday (flat rate *or* a percentage uplift), and non-worked
paid states such as **sick leave** (*baja*). Computing a shift's pay means classifying each of its hours
(which day, which hours count as night, is it a holiday) and applying the matching rule. "Actual vs
pending" then falls out: sum the rules over recorded jornada rows for earned-to-date, over the schedule
for the projected remainder.

- **Dependencies / gates.** Sits on top of registro de jornada (#47) and D2 scheduling (both built), so
  the hours data already exists. But the *rates and multipliers themselves are governed by the
  applicable provincial convenio colectivo* (minimum hourly rates, the legal night-hours window, holiday
  and overtime uplifts), which is a **laboral-advisor / gestoría** dependency already flagged under *The
  advisor gap* (the convenio figures + the gestoría's payroll import layout are the two open laboral
  items). The engine should hold rates as **editable data**, not hardcode convenio numbers, so the owner
  or gestoría sets them. A public-holidays calendar (national + autonomía + local) is also needed to
  classify holiday hours — its own small data source.
- **Not fiscal.** Wages touch no invoice, huella, or chain — this is an accounting/HR concern (the same
  track as the tip-as-income note under *The advisor gap*), so it carries none of the H2 constraints.
- **Scope to brainstorm when picked up:** the rule data model (per-person contract + condition
  overrides), the hour-classification logic (night window, weekend, holiday calendar), sick-leave and
  other paid-non-worked states, the accrued-vs-pending period view, and where it feeds D3.

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
- **Sync completion beyond the landed lanes** (Track 2) — fiscal-lane / hash-chain sync (H2, **now SP-3
  of the module system** above), cloud-mirror C-remainder (multi-tenant transport DROPPED 2026-09-05 —
  one tenant per database). See *Open threads → Sync*.
- **Reporting *fiscal* remainder** — modelo-303 filing boxes (rectificativas 40/41, prorrata 44,
  intra-community 32–39) + two pre-filing caveats: AEAT filing completeness (asesor-gated), not an owner
  takings view. See *Open threads → Reporting*.
- **Printing cloud-poll transports + expo device kind** — subsystem, KDS, receipt + cash-drawer built;
  the rest is post-polish. See *Open threads → Printing*.
- **Cloud trial on-ramp** — gated on Waitron-cloud infra that does not exist yet. See *Open threads →
  Onboarding*.
- **Guided onboarding wizard (four setup modes)** — a non-technical first-run chooser (demo /
  pre-production / production-from-pre-production / add-a-node) + per-mode wizards, wrapping the existing
  dev/demo/provisioning/adopt paths, plus Square/CSV migration as a step. See *Open threads →
  Onboarding*.
- **Recipes → stock → procurement (depth)** — recipe-authoring built; plate costing / stock depletion /
  suppliers/POs is product depth. See *Open threads → Recipes*.
- **Distribution / deployment / failover remainder** (Track 2) — appliance image, on-device agent,
  reroute, SIF promotion/fencing + till-side failover. See *Open threads → SIF topology*.

**Later / smaller:** SumUp card provider (gated, *Debt*) · wage-computation engine (build,
convenio-gated — *Wages / labour cost* above) · D3 payroll export (integrate-not-build) ·
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
| 16 | Workforce | *registro de jornada*, D2 scheduling, roster authoring + approvals, staff request path + portal | **wage-computation engine** (per-person pay rules, accrued-vs-pending — build, convenio-gated; *Priorities → Wages / labour cost*); D3 payroll export (integrate-not-build) |
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

**Track 2 infra-session — start-here menu (mapped 2026-09-01; SUPERSEDED 2026-09-05 — Track B's
ordered list under *Priorities → Whole-project design review* is the menu now; the notes below are
the state each landed slice left behind).** The infra track runs as its own
interactive session, so "needs supervision" is not a disqualifier — the real question is ready-to-build
vs gated on an unbuilt foundation or an external dependency:

- **Ready to build now:** *none queued.* **Kitchen-sync enrolment LANDED #196** (the FK-closure design
  pass + build; see *Remaining* below for what shipped). Identity-config flow-down also **LANDED #195**:
  `persons` + `webauthn_credentials` now flow down the ordered lane (see *What's built → Identity* and
  the two follow-ups under *Onboarding*). With Slices 1 (#197), 2 (storage, #198), 3 (distribution,
  #202) and **4 (setup/adopt, #203) shipped**, membership adoption is now **LIVE** (boot reads a real
  trust set from `nodes.public_key`; the Slice-3 empty-seam no-op is gone). **Slice 5 (promotion
  integration) was reframed by the owner on 2026-09-03 into the reserved standby identity & membership
  promotion arc** (spec:
  [reserved-standby-identity-and-promotion](superpowers/specs/2026-09-03-reserved-standby-identity-and-promotion-design.md)):
  a standby gets its full **dormant identity at join** (own nodeId + membership keypair + reserved
  installation número + disjoint series), activated on promotion with no connectivity needed; the primary
  is the sole allocator; dormancy falls out of node-keying (no new schema). Decomposed **R1 → R2 → R3**,
  with **H2** (fiscal-record sync to mirrors) sequenced, not gated. **R1 (document lifecycle — seed the
  term-0 document at setup + mint the next document on local-secondary promotion) LANDED #205** (plan:
  [membership-promotion-r1-document-lifecycle](superpowers/plans/2026-09-03-membership-promotion-r1-document-lifecycle.md)):
  `buildNextMembershipDocument`/`nextStandings` (pure, `@waitron/membership`),
  `writeNodeMembershipTx`/`setSingletonRoleTx` (`@waitron/db`), `seedTermZeroMembership` +
  `mintNextMembershipDocument` (`apps/server`), and `promoteLocalSecondaryToPrimary` minting the next
  document with the singleton flip + document write in ONE owner transaction. **R2 (reserve the cloud's
  dormant identity at adopt) LANDED #208** (plan:
  [membership-promotion-r2-reserved-identity](superpowers/plans/2026-09-04-membership-promotion-r2-reserved-identity.md)):
  the adopt handshake now round-trips the standby's generated nodeId + Ed25519 public key to the primary,
  which (sole allocator) mints a reserved installation número, derives disjoint series
  (`deriveReservedSeriesCodes` = `<primaryCode>-<número>`), and endorses the key; the cloud persists a
  **dormant** identity in one owner tx — own `nodes` row (new nullable `nodes.endorsement jsonb`, migration
  0099), reserved `registro_sif` with the primary's number + fresh empty `cadenas` head, reserved
  `invoice_series`, sealed private key — all inert (`config.till.nodeId` unchanged, mirror still read-only).
  New fiscal primitives `reserveInstallationNumber`/`writeReservedSif` (single-writer preserved);
  idempotent establish (spec §8, `membership.node_key` sentinel). **Two owner-review decisions:** disjoint
  series code scheme (AEAT error 3000 is the sole cross-node backstop); endorsement on `nodes.endorsement`
  not the vault. **R3 reframed on the owner's call (2026-09-04): the cloud takes its OWN id from JOIN, not at
  promotion** — split into **R3a → R3b** (design refined:
  [membership-promotion-r3-cloud-promotion](superpowers/specs/2026-09-04-membership-promotion-r3-cloud-promotion-design.md)).
  **R3a (split identity at join) LANDED #210** (plan:
  [membership-promotion-r3a-split-identity](superpowers/plans/2026-09-04-membership-promotion-r3a-split-identity.md)):
  a cloud mirror now runs under its OWN nodeId from adopt (never impersonating the primary's) — `config.till.nodeId`
  = own id, peer token enrolled for it, the primary's id persisted as new `mirror_config.origin_node_id` (custom
  migration 0100) and used as the pull origin, the boot "subscriber==origin" assumption retired (the sync protocol
  was already `(subscriber,origin,lane)`-split). Mirror stays read-only. Owner-steered report fix: reports resolve a
  `dataNodeId` (origin on a mirror), and the **overview is now venue-wide** (loosened the READ type
  `DailyCloseInput.nodeId` to optional; the fiscal WRITE `recordDailyClose` keeps a required node — verified a
  per-SIF close can't go venue-wide). **R3b (cloud promotion) LANDED #211** (2026-09-04; plan:
  [membership-promotion-r3b-cloud-promotion](superpowers/plans/2026-09-04-membership-promotion-r3b-cloud-promotion.md)):
  a read-only mirror promotes to primary IN-PROCESS on the identity it already holds (restart-into-primary) —
  a mode/role flip (`mode→primary` BEFORE `singleton→primary`, respecting `deployment_role_valid_ck`) + the
  endorsed **term-guarded** promotion document + the corrected `config.till.seriesId` (the cloud's OWN reserved
  standard series via `readStandardSeriesId`, was the primary's inert one). **The R3 sharp edge is closed:** the
  document write goes through `persistNodeMembershipIfNewerTx` INSIDE the PONR owner transaction, and a
  non-strictly-newer term aborts the whole transaction (`promotion.membership_superseded`), so the flip never
  commits against a superseded chart. **No SIF activation / re-mint** — the reserved `registro_sif` is already
  live (`revocado_en IS NULL`), so `currentSif` returns it as the live selling chain and the primary-only workers
  start once the box reboots `mode=primary`. New db primitives `persistNodeMembershipIfNewerTx` /
  `setDeploymentModeTx` / `readStandardSeriesId` (fail-loud on >1 standard series); new codes
  `promotion.membership_superseded`, `series.no_standard_for_node`. **Owner decision (2026-09-04): the corrected
  `trading.env` is persisted BEFORE the PONR** (inert on a still-read-only mirror), closing the PROCESS-crash
  window a persist-after-PONR left. **New carry-in — power-loss durability:** `writeFileAtomic` does NOT fsync
  (atomic visibility only, `fs-atomic.ts`) while the PONR is a durable pg commit, so a power cut between the
  pre-PONR env write and the commit could reboot the box `mode=primary` still carrying the primary's series;
  benign in R3b (nothing sells against a promoted cloud until till-reroute), close it by fsync-ing the env write
  (cross-cutting — adopt/provision share `writeFileAtomic`, cross-platform fsync care needed) or resolving the
  series at boot. **H2 (fiscal-record sync to mirrors)** independent. **Carry-ins (unchanged):** the primary
  burns an installation número per bundle-**fetch** (spec §7 gaps-permitted, admin-authed); the idempotency
  guard assumes provision/adopt are mutually exclusive per box (true today). **Two new deferrals from R3a:** (i) **till-side read routing** — the till/KDS node-scoped reads
  (`listHeldOrders`/`listStationQueue`/`listExpoQueue`) still filter `working_orders`/`ticket_items` by the OWN id, so
  they'd return empty on a mirror; unreachable today (the read-only gate 403s till login, guarded by a test), but the
  till-reroute slice that gives tills access to a promoted mirror MUST route these through the display-data node
  first — and MUST gate selling on REBOOT COMPLETION (the corrected series in effect), not on the PONR commit,
  since a promoted-not-yet-rebooted box briefly opens writes in-process under the stale series (see R3b's
  power-loss carry-in above). (ii) **richer daily close** — a single close run by the primary across all tills, grouped by till + a venue
  total (its own slice; fiscal nuance: cash-up is per-till drawer, VAT is per-NIF). Slice 6 (rejoin) and Slice 7 (conflict surface) follow the arc. **Owner directive
  (2026-09-03): stop deferring work because it touches fiscal code** — H2 / reserved-SIF / promotion are
  in the build sequence now, no longer "owner-gated / never land unattended" (correctness rigor on the
  §5 unrecoverable invariants + owner review-at-land are unchanged; only the scheduling gate is lifted).
- **Membership & rejoin wire-protocol — Slice 1 (document foundation) LANDED #197** (design landed
  2026-09-02, owner-review still pending). Spec:
  [membership-and-rejoin-wire-protocol](superpowers/specs/2026-09-02-membership-and-rejoin-wire-protocol-design.md);
  Slice-1 plan: [document-foundation](superpowers/plans/2026-09-02-membership-slice-1-document-foundation.md).
  Resolves promotion-failover §9 item 1. **#197 shipped `@waitron/membership`** (pure leaf, deps
  `@waitron/shared` only, 64 tests / 100% cov): the signed, self-verifying membership document — canonical
  serialization, Ed25519 sign/verify, endorsement-chain trust rooted at setup, `verifyMembershipDocument`
  (strict-shape — a verified document IS exactly its signed content, spec §3), `acceptMembershipDocument`
  (the authentic + strictly-newer fence; demote-never-promote). `MAX_ENDORSEMENTS`/`MAX_NODES` = 8.
  **Slice 2 (storage) LANDED #198** (plan:
  [membership-slice-2-storage](superpowers/plans/2026-09-03-membership-slice-2-storage.md)): the
  `node_membership` whole-DB singleton (`id=1`, `term bigint`, `document jsonb`, `updated_at` — no
  `tenant_id`/RLS, mirrors `mirror_config`; migration `0096_node_membership.sql`, renumbered from 0088 on
  rebase over #199's 0088–0095) + `readNodeMembership`/`writeNodeMembership` accessors on `@waitron/db`
  (type-only dep on `@waitron/membership`). Owner decisions: `GRANT SELECT` to `app_user` only, owner-role
  writes; plain-upsert dumb setter (accept fence stays in `@waitron/membership`); `term` reconciled by
  deriving the column from `document.body.term` on write. **Slices remaining, each its own plan:**
  (3) **distribution** over `/sync-api/hello` + local adoption **LANDED #202** (plan:
  [membership-slice-3-distribution](superpowers/plans/2026-09-03-membership-slice-3-distribution.md));
  (4) **setup/adopt** trust establishment **LANDED #203**; (5) **promotion
  integration** — local-secondary mint **LANDED (R1 #205)**, reserved-SIF-at-adopt **LANDED (R2 #208)**,
  split-identity-at-join **LANDED (R3a #210)**, cloud promotion **LANDED (R3b #211)** — Slice 5 COMPLETE
  (see the membership arc above; residuals: power-loss durability + till-reroute);
  (6) **rejoin — drain-then-restore** — **R1 (fence-on-rejoin) LANDED #214** (2026-09-04);
  **R2 (drain-as-source + disposal guard) LANDED #219** (2026-09-05); **R3 split** (2026-09-05) into
  **retire/evict (decommission) LANDED #224** (2026-09-05, no restore) and **wipe-and-restore
  (rejoin-as-secondary) LANDED #237** (2026-09-05; fiscal-adjacent, owner-signed-off at land); (7) **conflict
  surface** (config down-only + ops conflict log) **LANDED #229** (2026-09-05). Slice 6 rejoin arc
  COMPLETE (fence R1 / drain R2 / retire-evict / conflict-surface / wipe-and-restore R3).
  **Slice 6 R1 (fence-on-rejoin) LANDED #214** (2026-09-04): a returned/superseded node that holds or
  adopts a membership document marking it **sell-only/evicted** now boots **FENCED**. Two mechanisms
  cooperate: a **demote-only** `singleton_role → secondary` reconciliation at boot (owner-pool write,
  `deployment_role_valid_ck` permits `(primary, secondary)` per 0071) suppresses the singleton duties
  (submitter/reconciler/config-writer go quiet once `isSingletonPrimary` is false), and the
  **read-only gate — generalized from mirror-only to a boolean predicate** — blocks *all* write verbs
  on a fenced node (a superset of the §7 config-write class). A superseding doc arriving via gossip
  **while running** triggers **restart-into-fenced**. The decision is **membership-standing-driven,
  not axis-driven** — deliberately, because `mode=mirror` hard-requires `mirror_config` and
  `role=secondary` is an active-selling local secondary, so neither axis alone means "fenced". New
  app helpers `isFenced` / `shouldFenceRestart` (`apps/server`); pure `standingOf` /
  `isFencedStanding` in `@waitron/membership`. **No migration** (no schema change; `inmutabilidad` /
  FORCE-RLS / `english-only` unaffected — all standings are already English). **Carry-forwards:**
  - **R2 (drain-as-source + disposal guard) LANDED #219** (2026-09-05). A fenced (`sell-only`) node now serves an
    **own-origin drain source** — `mountSyncApi` gained `ownOriginOnly`, which forces `originId=self`
    on `/sync-api/log`, so the current primary (the **carrier**) drains `originId=<returned>` with the
    existing pull loop (no carrier-side code; the two boxes are static mutual peers). The read-only
    gate gained a single-route **`POST /sync-api/cursor` exemption** (the carrier's cursor report — the
    disposal guard's only input; writes `sync_cursor`, no tenant_id/RLS), so a future mutating
    `/sync-api/` route is not auto-exempted — it hits the fence and fails loud (403). A fenced node stays
    fully fenced otherwise
    (`isSingletonPrimary` false — submitter/reconciler/config-writer + retention off; write verbs still
    403). Producer-side **disposal guard** `readDrainProgress` (`@waitron/sync`): own-origin high-water
    `seq` per lane vs the carrier's reported `sync_cursor` (subscriber=carrier, origin=self, lane),
    ANDed across lanes (lane-agnostic via new `SYNC_LANES`); `drained` iff the carrier caught up on
    every own-carrying lane. Carrier = the `serving-primary` in the held doc (`servingPrimaryNodeId`,
    `@waitron/membership`). Surfaced on **box-status `disposal`** (applicable only when fenced).
    **No migration** (serves/reads existing `sync_log`/`sync_cursor`/`node_membership`); the node stays
    **`sell-only`** — R2 mints no document. **Cloud-as-carrier is out of scope** (relay-vs-sink open
    item, parent §9).
  - **Retire/evict — the decommission path — LANDED #224** (2026-09-05). A box leaving for good: drain
    (R2 ✓) → **self-evict** → physical disposal, no restore. A fully-drained fenced (`sell-only`) node
    mints a `sell-only`→`evicted` membership document signed with its **OWN** identity key (a
    self-demotion — safe under wire-protocol §5; the departing node's key is in every former peer's trust
    set, so the carrier verifies + adopts it via the existing `/sync-api/hello` gossip, no carrier-side
    code) and persists it term-guarded. App pool only (`evicted` flips no deployment axis). New
    `evictNode` producer in `@waitron/membership` (the counterpart to `nextStandings`); `retireSelf` +
    `POST /api/box/retire` (management-authenticated, let through the read-only gate on a fenced node by a
    single named exemption, mirror-gated off) in `apps/server`. Ordered guards:
    idempotent-evicted → `not_fenced` → `no_carrier` → `carrier_changed` → `not_drained` → mint → persist;
    term-guarded persist → `node.retire_superseded` on a gossip-adopt race. **No migration.** The two
    R2-review facts held: (i) gates on the disposal guard's `drained` **boolean**, never on comparing
    `carrierAppliedSeq >= ownTailSeq` (MAX vs MIN, legitimately differ while `drained:true`); (ii)
    `node.retire_no_carrier` (fenced, undrainable) is distinct from `node.retire_not_fenced` (N/A,
    serving). **`node.retire_carrier_changed` guard (I1, whole-branch review):** a fenced node does NOT
    restart on a carrier change, so `retireSelf` re-derives the current carrier from the fresh held chart
    and refuses when it differs from the boot-captured carrier the drain reader keys on — never evicts a
    node whose tail reached only a *stale* survivor (fiscal-unrecoverable). **Carrier-side reaction to
    `evicted` (stop pulling) is out of scope** — the carrier learns via gossip and the box is then
    disposed (its pull just goes unreachable).
  - **R3 (wipe-and-restore, spec §6 step 4) — the rejoin-as-secondary path — LANDED #237**
    (2026-09-05; fiscal-adjacent, owner-signed-off at land). Design:
    [membership-rejoin-r3-wipe-and-restore](superpowers/specs/2026-09-05-membership-rejoin-r3-wipe-and-restore-design.md).
    Drain (R2 ✓, reusing R2's lane-agnostic disposal guard, `readDrainProgress`) → discard the diverged
    DB → restore the current primary's baseline → reboot FENCED (sell-only), streaming the primary's
    log as a clean subscriber; re-admission to `serving-secondary` is a separate, deferred slice (no
    self-promotion — demote-never-promote). New operator CLI `waitron-rejoin`
    (`rejoin-command.ts`/`bin-rejoin.ts`) drives `rejoinAsSecondary`
    (`apps/server/src/rejoin.ts`, guard ladder `not_fenced`/`no_carrier`/`not_drained`) through
    `dropAndCreateDatabase` (DROP+CREATE wipe, `db-wipe.ts`), then BR-3's `restoreFromArtifact`
    (DB+media, new `skipSecrets` flag keeps the rejoining node's OWN identity), then reboot fenced (R1
    #214). Same producer as before (`pg-dump.ts`/`backup-sweep.ts`, `row_security=off`, so the
    `sync_log`-in-backup half is satisfied). **Fiscal safety rides the drain guarantee, unchanged:** the
    disposal guard measures the enrolled `sync_log` tail only — the per-node fiscal chain
    (`registros_facturacion`) is deliberately NOT in `sync_log` today, so this same lane-agnostic guard
    auto-covers the fiscal chain with no R3 change once H2/SP-3 enrols it onto a lane. A real-PG e2e
    found + fixed a wiped-but-not-restored DR bug: `restoreFromArtifact` assumed its staging/media/state
    roots already existed; a rejoin left the DB wiped with nothing restored into it. Fixed by having
    restore create those roots itself before its guard runs. The whole-branch review then hardened the
    pre-wipe guard ladder to refuse before the irreversible wipe for a wrong recovery key / incompatible
    artifact (validate-before-wipe), a `DATABASE_URL` vs `WAITRON_RESTORE_DATABASE_URL` target mismatch,
    and a stale-carrier two-read window (read `node_membership` once); Copilot round closed
    (0700 restore dirs, pool-close-on-refusal).
    - **R3 follow-ups (deferred, owner-flagged):** (a) **automatic resume-at-restore** — a mid-flow
      failure AFTER the wipe still needs operator recovery (data is safe: drained tail on the carrier +
      the backup artifact); self-recovery needs a persisted wiped-state marker to tell a wiped-mid-restore
      box from a never-provisioned one — an owner design call, not built. R3 only PREVENTS the preventable
      pre-wipe failures. (b) **re-admission `sell-only → serving-secondary`** — the un-fence that makes the
      rejoined box sell again; a separate primary-minted slice (no self-promotion — demote-never-promote).
      (c) tiny: `restore.ts`'s "Exposed for R3" comments on the composable steps now describe a path R3
      didn't take (it uses `validateArtifact`/`writeValidated`) — harmless, thin when next touched.
  - **Slice 7 (conflict surface) LANDED #229** (2026-09-05). Primary-wins for config-class rows: on the
    carrier draining a returned/fenced node, a config-class row whose `originId` is not the current
    serving-primary is REJECTED (not applied — the primary's config stands) and RECORDED to the new
    append-only ops table `sync_config_conflicts` (whole-DB, NO tenant_id/RLS — `sync_cursor` precedent;
    SELECT to the NOLOGIN `sync_tailer` only, INSERT to app_user, so app_user never reads a cross-tenant
    `row_image`). Built on the post-#227 **inverted** enrolment model: config-class is a per-table
    `EnrolledTable.configClass` set in each package's own `enrol()` (exactly the 10 pure-config tables;
    `dining_tables` excluded as mixed config/runtime), and the apply gate reads it off the injected
    dispatch entry. The gate reads a **live** serving-primary (per-batch getter updated in
    `adoptMembership`), so a promotion without a restart does not leave it stale. Surfaced as a count on
    box-status (via the `sync_tailer` pool). Note the branch was reset + reworked onto the inverted model
    after #227 (SP-2a) landed mid-build. **Documented residuals** (bounded, fail-safe, deferred to the
    interactive-merge/ops path, spec §7/§9): (i) a runtime child FK-referencing a fence-window config
    parent parks on 23503 → that origin's drain stalls → retire refuses (child never dropped, no fiscal
    data loss); (ii) a clean primary→primary handover with config still pending in the old primary's
    outbox rejects those rows after gossip flips the serving-primary (recorded, not lost); (iii) the
    conflict count is cumulative/unclearable until the ops-resolve path lands; (iv) a duplicate conflict
    row can be recorded on a crash+redelivery (append-only log, tolerable); (v) no index on
    `sync_config_conflicts` (a `count(*)` needs none). **The interactive per-field merge + an ops-resolve
    (clear/review) surface are the natural follow-on** (§9 item 2).
  - **Bounded residual (accepted, spec §8.4):** on the first boot after returning, the node runs as
    its **stale-held-doc primary** until the pull delivers the superseding doc and restarts it (≈ one
    pull interval). Deliberately **not** boot-into-read-only-until-confirmed — that would black out a
    genuinely isolated returning node with no reachable peer (§5.1).
  - **Bounded one-tick restart window (accepted, honesty note — not a defect):** the runtime
    adopt→restart path leaves a bounded **one-tick** window — the node persists the fencing document,
    then a next-tick `SIGTERM` reboots it into the fenced posture, so one more fiscal pass could file on
    the now-known-superseded chain before the reboot lands. This is inherent to restart-based fencing —
    the same mechanism R3b promotion uses — and is consistent with spec §8.4; the node is **fully fenced
    on reboot**.
  - **The `evicted` producer landed with retire/evict (#224):** `evictNode` (`@waitron/membership`)
    mints the `sell-only`→`evicted` edit, self-signed by the departing node at retire time. `nextStandings`
    (the promotion producer) still never emits `evicted` — deliberately; it demotes the outgoing primary
    to `sell-only`, and eviction is the separate decommission producer.
  - **Carry-forward for the promotion-runbook / promote-action slice (fiscal, flagged at R1 land by a
    finish-branch reviewer):** R1 reconciles a fenced node to `(mode='primary', singleton_role='secondary')`
    — the SAME axis pair as a healthy "local secondary" — so `promoteLocalSecondaryToPrimary` (which today
    checks only `mode!=='mirror'` and `singletonRole!=='primary'`, `promote.ts`) cannot tell a fenced node
    from a promotable one. Invoked against a fenced node it would `nextStandings(self→serving-primary)`,
    self-sign a new doc, and flip `singleton_role` back to `primary` **live** (no restart) — resuming the
    fiscal duties while the HTTP read-only gate stays shut only because `fenced` is a boot-captured closure
    — the "two submitters under one NIF" the design exists to prevent. **Unreachable today** (that promote
    is in-process/test-only with no endpoint, and the design gates it behind `FenceAttestation`/`assertFenced`
    + the still-open promotion runbook, wire-protocol §5/§9). **The fence-check part LANDED #225**
    (2026-09-05): both `promoteLocalSecondaryToPrimary` and `promoteMirrorToPrimary` now call
    `assertNotFenced(held, nodeId)` (consulting `isFenced`/`standingOf`) before the point-of-no-return,
    refusing `promotion.node_fenced` — defense-in-depth landed ahead of the promote endpoint (Slice 2). What
    REMAINS of this carry-forward: the promotion runbook / authenticated endpoint itself. Same shape as the
    wide reviewer's note that a fenced node adopting an *un-fencing* doc persists it without re-promoting in
    place — R1 never produces such a doc (re-admission is wipe-and-restore), so the in-place transition is out
    of scope until the R3 eviction/re-admission producers exist.
  **Slice 3 (distribution) LANDED #202** (2026-09-03): `/sync-api/hello` now serves `{ nodeId, environment,
  membership }` (the held signed document or `null`); the pull worker threads that field out of the
  handshake it already makes each tick and hands it to an injected **best-effort** `adoptMembership`
  callback (same contract as `reportCursor`, so `@waitron/sync` stays transport-only, no membership/db
  dep); `apps/server/membership-adopt.ts` verifies authenticity then persists via the new typed
  `persistNodeMembershipIfNewer` accessor on `@waitron/db` (a term-guarded `onConflictDoUpdate({setWhere})`,
  the atomic monotonic backstop for the two-lane race — a **sibling** to the still-dumb
  `writeNodeMembership`); migration `0097_node_membership_write_grant.sql` adds the #198-deferred
  `GRANT INSERT, UPDATE` (no DELETE). Boot wires adoption with an **inert empty trust-set seam** (`{}`), so
  production adoption is a no-op (every doc `untrusted_signer`) **until Slice 4 fills the trust set** — the
  mechanism is proven live only via a fixture-trust-set e2e. **Follow-ups from #202 (carry into Slice 4+):**
  (a) the **#198 write-grant deferral is now resolved** (0097 grants app_user INSERT/UPDATE). (b) `adoptMembership`
  makes the **atomic persist the sole authority on "strictly newer"** — it reports `accepted` iff the guarded
  upsert changed the row (a Copilot-caught TOCTOU: the earlier read-then-accept could report a document
  adopted that a concurrent higher term had already superseded); it no longer pre-reads the term (an
  efficiency finding, resolved by the same change). (c) `acceptMembershipDocument` (the read-based Slice-1
  fence) is **no longer used by the adoption path** — it remains the general-purpose fence for
  non-persisting callers (e.g. a till deciding routing, Slice 5+); when a persisting caller needs the
  two-part test, the atomic guard is the race-safe way to enforce the "newer" half. (d) boot's thin
  `adoptMembership` wrapper closure is **not directly unit-tested** (boot tests use unreachable peers so the
  drain throws before the callback fires; the module it calls is 100% covered + e2e-proven) — a candidate
  boot-wiring assertion for a later slice.
  **Slice 4 (setup/adopt) LANDED #203** (2026-09-03): each node gets an Ed25519 identity at setup, so boot
  reads the trust set LIVE (`readMembershipTrustSet(localSyncDb, till.tenantId)`) — the Slice-3 empty seam
  is gone and adoption is no longer inert. Shipped: `nodes.public_key` nullable trust-anchor column
  (generated migration `0098`; `app_user` gains nothing — the read rides the pre-existing table-level
  SELECT, writes stay owner-role); `@waitron/db` accessors `setNodePublicKey` / `setNodePublicKeyTx`
  (tx-taking core) / `readMembershipTrustSet` (→ `TrustSet`, skips keyless nodes); the `membership.node_key`
  credentials vault purpose (private key sealed under the box key, `sync.mirror_token` pattern);
  `apps/server/src/node-identity.ts` — `establishNodeIdentity` generates a keypair and seals the private
  key + stamps the public key in **ONE transaction** (they are one logical change), `readNodeIdentityKey`
  the Slice-5 signer's entry point (exercised now by a sign/verify pairing proof); wired into
  `/setup-api/provision` (deps-gated) + boot. **Adopt needed no code change** — the cloud mirror inherits
  the primary's key through the node row `adoptVenue` already replicates (value-asserting `adopt.rls`
  proof). **Owner decisions:** trust anchors ONLY — the **endorsement chain is DEFERRED** (no consumer
  until promotion; the cloud mirror runs as the primary's nodeId, never signs, seals no key); public keys
  on `nodes.public_key`; private key in the credentials vault. **Follow-ups from #203 (carry into Slice 5+):**
  (a) a provision failure AFTER `provision()` mints the tenant/chain is **unrecoverable** → re-image (the
  existing `sealAeat`-window class, widened by one step; recovery is the cold-recovery/re-image posture).
  (b) **Slice 5 must guard `establishNodeIdentity` to run once per node** before any document is signed —
  a re-establish mints a fresh keypair and would orphan a previously-signed document. (c) the membership
  private key is **decryptable by the `app_user` pool** (same as `sync.mirror_token`/`fiscal.aeat`) —
  Slice 5's threat model should state it. (d) finish-phase review made the seal+stamp atomic (was an
  incidental two-transaction split) and caught a §1 false claim in that fix's own comment ("app_user holds
  neither" is false for `tenant_credentials` — it holds full DML there per `0001`); both corrected. Not
  applied: a shared `seedLocation` test helper (the inline location-insert is the repo's convention across
  ~90 test files — a separate repo-wide cleanup, not this slice).
  **Follow-ups recorded from #197:** two efficiency micro-opts were consciously skipped in
  `resolveSignerKey` (re-verify-across-passes; same-endorser key re-parse) — constant-bounded by
  `MAX_ENDORSEMENTS`, revisit only if the cap grows; the break-glass-rooted (option B)
  signing hardening stays deferred with break-glass.
- **Reserved-SIF staging — DONE via R2 (#208).** The reservation of the standby's installation number +
  disjoint series now happens at cloud **adopt** (not a separate staging step), keyed to the standby's own
  dormant nodeId. What remains is **R3** activating it (switch the runtime node id, activate the SIF, start
  the primary-only workers on promotion) + the C2a promote action — see the membership arc above.
- **Hard-gated (leave until the gate clears):** break-glass secret mint (→ Slice 2); the **restore
  consumer** (backup regime BR-3 — clears R3 rejoin + promote Slice 4; BR-1 producer/encryption LANDED
  #226); real cloud hosting/relay (cloud-mirror follow-ups, the T1 relay — _2026-09-05: no relay; the
  box's WireGuard link to its own cloud instance, `2026-09-05-relay-decision.md`_ — **MVP-critical since
  2026-09-05, Track B item 2**); the go-native decision
  (on-device agent); and the **owner-gated fiscal H2** hash-chain sync lane — never landed without
  owner sign-off.

### Backup & restore regime (BR-1 #226 + BR-2 #228 + BR-3 #232 LANDED; only BR-4 remains — now = SP-3d, UNBLOCKED by SP-3a #238)

A generic core backup/restore service (storage-media plugins + module hooks), decomposed BR-1..BR-4.
Design: [backup-restore-regime](superpowers/specs/2026-09-04-backup-restore-regime-design.md); BR-1 plan:
[br-1](superpowers/plans/2026-09-05-backup-restore-br1-storage-fanout-encryption.md).

- **BR-1 — storage abstraction + fan-out + encryption — LANDED #226 (2026-09-05).** Grew the single-dir
  `pg_dump` backup into a pluggable, multi-destination, **encrypted** backup: `StorageBackend` +
  `LocalFsBackend` (atomic `put` via `writeFileAtomic`); an artifact cipher (AES-256-GCM over the dump,
  operator recovery key `WAITRON_BACKUP_RECOVERY_KEY` — never the box key, so a backup survives box
  destruction; version-selected **frozen** `KDF_BY_VERSION` + GCM-AAD-authenticated header, self-describing
  so a future scrypt hardening never strands old artifacts); a destinations list (rejecting duplicate
  ids/dirs, fail-closed); a fan-out orchestrator (dump→encrypt **once**→put to every destination in
  parallel, best-effort per destination→prune each; staging under `<stateDir>/backup-staging`, 0600);
  per-destination freshness on `GET /api/box/status`. No restore, no module contributions.
  - *BR-1 deferrals (named, not gaps):* abort-aware **per-destination timeout** (v1 is `LocalFsBackend`-only;
    a hanging destination isn't abandoned mid-tick — same between-ticks abort model as the sibling
    sync/tunnel/retention workers; lands with the first network s3/sftp backend) · stale-`.tmp` sweep
    (bounded, cosmetic) · **path-traversal containment guard on `StorageBackend` key** — unreachable in v1
    (keys generated internally), **must land with BR-3's first manifest-driven `get(key)`**.
- **BR-2 — manifest + module `backup` contribution — LANDED #228 (2026-09-05).** A backup is now a single
  encrypted **archive** `waitron-<ts>.backup.enc` = `encryptArtifact(packArchive([manifest.json, db.dump,
  media/…, secrets/…]))`. Shipped: the `backup` contribution kind on `WaitronModule` (`{ nonDbState?,
  restore? }`, open-set; `core` declares the content-addressed media store); `packArchive`/`unpackArchive`
  (bounds-checked container); `buildManifest` (module→migrated-schema-version + environment, via a shared
  `schemaVersionsByModule` also used by boot's drift probe, read over the **privileged** backup pool);
  `collectModuleNonDbState`; the orchestrator collects manifest+secrets+media **before** the dump
  (fail-fast, no wasted dump) and encrypts once. Rebased cleanly onto **SP-2** (`core` carries both `sync`
  and `backup`). `restore` stays a seat (BR-3/BR-4).
  - *BR-2 carry-forwards:* **BR-3 must add path-traversal guards on archive entry NAMES at unpack-to-disk
    time** (like `unpackBundleToDir`/`state-secrets.ts`), plus BR-1's deferred `StorageBackend`-key guard.
    Deferred edges (note-only): a working-backup boot success-path integration test; scope the flat
    `resolvers` map by module when a 2nd `nonDbState` module lands; `packArchive` pack-time `entries.length`
    bound.
- **BR-3 — the restore consumer — LANDED #232 (2026-09-05).** `decrypt` → `unpackArchive` → **compatibility
  gate** (env + module schema-version vs the restoring binary) → **entry-name path-traversal guard**
  (lexical + realpath, shared with `unpackBundleToDir`, all entries before any write) → `pg_restore`
  (`--no-owner`, password via `PGPASSWORD` env not argv) into a fresh DB → restore media/secrets → invoke
  module restore hooks (empty v1). Composable steps (`restoreDatabase`/`restoreMedia`/`restoreSecrets`/
  `invokeRestoreHooks`) + full `restoreFromArtifact` + a `restore` CLI verb. **Fiscal-safe by construction:**
  restores the ledger **verbatim**, mints **no** chain, makes the box **no** trade-readier — a real
  in-container fiscal receipt proves a `registros_facturacion` row restores AND stays immutable (post-restore
  UPDATE rejected, `WT001`). A review-caught **Critical** (a failed `pg_restore` leaked the admin password to
  the terminal) was closed at the root + two sanitizing layers. **Owner-flagged at land (PR #232) for the
  fiscal-adjacency.** **Clears the R3-rejoin `pg_restore` gate + promote-Slice-4.**
  - *BR-3 carry-forwards:* **R3-rejoin composes** `restoreDatabase`+`restoreMedia` (skipping secrets to keep
    its own identity) then re-fences (R1 #214). Deferred: a DROP-DATABASE/wipe primitive (v1 targets a
    pre-created fresh DB); a manifest-shape coded refusal (fails safe under GCM auth today); generalizing
    entry routing off declared source ids (a fail-visible `restore.unexpected_entry` reject is in; full
    generalization when a 2nd non-DB `nonDbState` source lands).
- **BR-4 — fiscal restore hook (fresh chain / disjoint series) — the ONLY remaining backup-regime slice;
  now scoped as SP-3d (folded into SP-3, owner decision 2026-09-05). UNBLOCKED — SP-3a (#238) landed the
  fiscal module seams it was gated on.** Fills the empty v1 restore-hook seat BR-3 ships (the module
  `backup.restore` seat); mints a fresh chain / disjoint series so a restored box trades again as primary
  without resuming the dead chain; unblocks promote-Slice-4 cold-DR trading-again-as-primary. Owner-gated
  (H2). Built as SP-3d — see the module-system section's SP-3 breakdown.

**Remaining, each its own design pass:**

- **Cloud-mirror follow-ups (deferred).** _2026-09-05: the B items below retire with `@waitron/tunnel`
  (`2026-09-05-relay-decision.md`); do not build them._ From B (spec §11, within the semi-trusted-relay threat model,
  each self-healing or fail-closed today): the box→relay control-frame splice race; a max pre-`go`
  frame-length guard; ignore-`go`-before-`ack`; a registration/handshake timeout; a `tunnelHttpClient`
  disposal seam for C's long-running subscriber; SNI-based multi-box routing — all owed to the real T1
  relay/client. From C2a: the promote **action** + starting the primary-only workers on promotion
  (gated on reserved-SIF staging — see *SIF topology*). From C2b: **mirror fidelity** — `adoptVenue`
  nulls `locations.catalogue_id` + `tills.receipt_printer_id` (correct today; restoring them needs
  config replication); and the **first-contact trust bootstrap** for an untrusted-network primary (gated
  on real hosting). Plan:
  [cloud-mirror-hardening](superpowers/plans/2026-08-29-cloud-mirror-hardening-followups.md).
- ~~**Multi-tenant transport** — a whole-log reader role.~~ **DROPPED 2026-09-05** (one tenant per
  database, cloud included — *Whole-project design review*): a source never serves more than one
  tenant's log.
- **Fiscal-lane / hash-chain sync (H2) → now SP-3 of the module system** (see the module-system section
  above). Enrol the six fiscal tables — `registros_facturacion` insert-only + `registro_sif`/`cadenas`/
  `envios`/`envio_flujo`/`acks` — onto the ordered lane; verbatim, immutability honoured on the subscriber;
  transport-agnostic. The standalone H2 spec/plan live on branch `feat/h2-fiscal-record-sync` (never merged)
  as reference material; SP-3 delivers it as the fiscal module's own sync enrolment, riding SP-2's inversion.
- **Disposal guard: durability ≠ convergence (open, from the H2 design review 2026-09-04).** The failover
  disposal guard (promotion-failover §5.1) retires a node "once its owned partition has fully replicated to
  at least one surviving node (peer *or* cloud)." That counts a tail that reached **only the passive cloud
  sink** as safe to dispose — durable, but **not converged**: the cloud is a sink not a relay, so a
  surviving/promoted *local* primary never receives it. Candidate tightening: require **the node that
  carries the partition forward** (current primary for a secondary/mirror; promoted successor for a
  primary) to have drained the tail, not merely *some* survivor. Facet of the relay-vs-sink (§9 item 3) +
  convergence-gap (item 4) questions; belongs with the disposal-guard / promote-action tooling. H2
  unaffected — it only makes the fiscal `sync_log.seq` measurable. Dated note recorded at
  promotion-failover §5.1.
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

**Guided onboarding wizard — four setup modes (NEW — owner-added 2026-09-04).** Onboarding today is a
developer path (`pnpm dev:setup`, env vars, the provisioning CLIs); the owner wants a **simple first-run
chooser** so a non-technical installer is never overwhelmed and never "runs away". On installing a new
node, present a small menu of **four intents**, then a dedicated wizard that guides each one to
completion:

1. **Set up a demo** — load the demo seed, enable **dev mode** for devices, **no real POS payments**,
   **nothing filed** to AEAT. Maps to `WAITRON_ENV=dev` (fiscally = preproduction, `config.devMode` on
   — SP-C #201) + the `dev:setup` seed (~44-product menu, floor plan, staff, back-dated sales). Mostly
   built already; the wizard is the friendly wrapper over it.
2. **Set up a new pre-production system** — empty DB, **test cards** for POS, fiscal records **submitted
   to AEAT's pre-production** endpoint. Maps to `WAITRON_ENV=preproduction` (the default) + the
   `venue`/`instance` provisioning path (onboarding slices 1–4, #137–#166).
3. **Set up a new production system, copying from an existing pre-production system** — a real venue goes
   live reusing the configuration it already tuned in pre-production. **Fiscal caution (§5): one database
   per environment — a pre-production DB is _never promoted_.** Its `invoice_series` / hash-chain must
   **not** carry over (pre-prod sales would leave a permanent hole in the production series, which is
   exactly what Veri\*Factu detects, and a chain cannot be migrated). So this wizard copies
   **configuration only** — catalogue/menus, floor plan, staff, devices, layout profiles, hardware
   bindings, printer/payment config — into a **fresh production DB with a brand-new fiscal chain +
   series**. Needs a defined config **export/import** surface (what copies vs. what is minted fresh);
   H2-adjacent, so specced with the owner, never landed unattended.
4. **Add a node to an existing system** — a second box joins an already-running venue. Maps to the
   **membership adopt** arc (cloud-mirror adopt / reserved-standby identity R2 #208 → R3, the membership
   slices under *Sync*) plus the reroute/failover work (Track 2). Largely a wizard over infra already
   being built.

Plus **data migration from common systems (e.g. Square)** to lower the switching cost for an owner
leaving another POS — this is the existing *Square (and generic CSV) menu import* item
(*Priorities → Tier C*; a one-off import is NOT the cheap seed path, spike 2026-08-29), which the wizard
would surface as an optional step inside modes 2/3.

**Scope to brainstorm when picked up:** the first-run chooser UI (`apps/setup`), the four wizard flows,
the config export/import surface for mode 3 (and its fresh-chain guarantee), how each mode sets
`WAITRON_ENV` / `devMode` / provisioning, and where the Square/CSV importer slots in. Modes 1–2 are
mostly a UX wrapper over built paths; modes 3–4 carry the real new work.

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
  tenant. Gated on Waitron-cloud infra that does not exist yet — which, since 2026-09-05, means a
  per-tenant instance fleet plus the control plane (*Whole-project design review → Track C item 4*),
  not a shared multi-tenant store.
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
- **The reroute** — the till reaches the serving box and fails over to the promoted standby (warm
  standby since 2026-09-05; selling is no longer active-active) behind a stable local origin.

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
  restore (gated on the backup regime's BR-3 restore consumer; BR-1 LANDED #226); **Slice 5** — rejoin-as-secondary + the conflict watcher (gated
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

> **2026-09-05 — Q16 closed by decision, not by the asesor.** Cloud instances are hosted in Spain, so
> an invoice-issuing SIF never operates from abroad and the question does not arise for the MVP's
> cloud modes. Do not send it. The outside-Spain / outside-EU conservation questions in cloud-storage
> §8a are moot for the same reason — every copy is kept in Spain.

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

**Data protection (RGPD/GDPR) is a third track — never scoped end-to-end.** Waitron stores personal
data (customers via loyalty/receipts, staff via `persons` + registro de jornada, and the cloud
mirror replicates it off-box), yet no one has mapped our obligations as a whole. Pieces exist in
isolation — the biometric-clock-in DPIA (workforce plan §2.4, AEPD 2023 guidance; biometrics off by
default), and data export/portability flagged as a GDPR duty in
[cloud-services-inventory](superpowers/specs/2026-08-29-cloud-services-inventory.md) — but nothing
answers the whole-system question. **The task is to scope it before engaging a DPO/lawyer:**
(1) build a data map (what personal data, where — box vs cloud mirror, how long retained);
(2) settle the **controller vs processor** split — is Waitron an *encargado del tratamiento* for the
venue's data, and does that need a DPA (the *encargo de tratamiento a efectos del RGPD* question
already sitting in [asesor-questions §RGPD](compliance/asesor-questions.md)); (3) the venue-facing
duties (privacy notice, lawful basis/consent, subject-access + erasure + portability, breach
notification, retention limits) and which of them Waitron must *build* vs the venue must *operate*.
Blocks nothing today, but the retention/erasure/export mechanics become build work once scoped, so
it wants doing before go-live rather than after.

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

- **`test-heavy` and `test-server` are sharded THREE WAYS** (LANDED #216). They were the two
  critical-path jobs — 374s (`packages/db`) and 341s (`apps/server`) on the unfiltered `main` run
  33890775789 — and, being single packages, could only be split by sharding their test FILES with
  vitest `--shard=i/N` (a matrix job), each shard emitting a partial-coverage `blob`, with a paired
  `test-heavy-merge` / `test-server-merge` job merging the blobs (`vitest --merge-reports`) and
  enforcing the package's thresholds on the total. The `test:shard` / `test:merge` package scripts
  carry the mechanism; `scripts/ci-workflow.test.mjs` pins the matrix↔denominator↔merge wiring AND the
  script shapes. **Measured on PR #216's run 33908208779:** test-heavy 374s → shards 136/220/89s +
  merge 24s ≈ **244s**; test-server 341s → shards 139/131/131s + merge 35s ≈ **174s**. The merge tax
  is much cheaper on the CI runner (24s/35s) than the ~80s laptop figure. **The real limit is
  IMBALANCE, not the merge:** vitest `--shard` splits by FILE COUNT, not duration, so test-heavy came
  out 89/136/220s — one shard drew the slow files — and there is no duration-based split. Bumping the
  matrix (`shard: [1..N]` AND the `--shard=i/N` denominator, together) can't fix imbalance and must keep
  N at or below the package's test-file count, or an empty shard exits 1 ("No test files found") even
  with thresholds suppressed.
- **Job-sharding — remaining lever.** With db/server sharded, the next critical-path candidate is
  `mutation-verifactu` (~218s, one free 4-vCPU runner); split it if a run shows it dominating. Rebalance
  the `LIGHT_A/B_PACKAGES` bins (`scripts/changed-scope.mjs`) when a run shows one light shard dominating.
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
reason-(b) reference, `packages/payments` the reason-(a) one — but both carry the HIGH coverage bar, so
a new package that copies either config must set the `90/90/85/85` floor (CLAUDE.md §2), or
`scripts/coverage-thresholds.test.ts` fails it in the ungated `lint` job. Plan:
`docs/superpowers/plans/2026-08-19-shared-test-container.md`.

---

**Dev stack from a worktree.** `apps/server/.env` is per-database (copy it from the main checkout;
`worktree.py new` does not), and every `pnpm dev*` from a worktree needs `COMPOSE_PROJECT_NAME=waitron`
or compose starts a second `db` named after the directory on the same port. Detail + the
`dev:reset` rule: [ui-review.md](ui-review.md) → *Running the stack from a worktree*. Fold into
CLAUDE.md §6 with the next PR that touches it (a root `CLAUDE.md` edit takes the normal PR flow).

## How to keep this file honest

Update it in the change that makes it stale (CLAUDE.md §7). In particular:

- When a piece lands, move it out of the priorities / *What's built* "Remaining" column — do not add a
  new receipt paragraph. **This is state, not history; the git log is the history.**
- The moment it goes stale most reliably is a **merge**: `/land-branch` carries a step to update this
  file. A merge deletes the branch the in-flight rows named, so refresh them then.
- When a question is closed on primary source, say so and stop calling it blocked.
- Delete finished items. If an entry is growing proof-of-work (test counts, grep receipts, "proven by
  deletion"), that belongs in the PR, not here.
