# Backlog — what to work on next, and why

This file answers **"what should I work on?"** It is state, not history: what is built (one line each),
what is open, and the order to take it in. The git log, the PR threads, and the committed
specs/plans in `docs/superpowers/` hold the detail — do not paste receipts back in here.

> **Pruned 2026-09-12.** Landed work is one line with its PR number as a locator. What a review seat
> caught, how something was proven, and which tests were written stay in the PR thread and
> `~/workspace/tools/process-log.md`. The 2026-09-05 three-track cut (Tracks A / B / C) is gone as a
> structure; its still-open items moved into the four tracks below.

**Companion documents, not duplicated here:**

- **[ui-review.md](ui-review.md)** — the live tracker for the UI/UX polish walkthrough: which areas
  are examined, which remain, and the corrections logged against each.
- **[compliance/action-plan.md](compliance/action-plan.md)** — the legal/administrative track
  (certificates, company formation, the declaración responsable).
- **[compliance/asesor-questions.md](compliance/asesor-questions.md)** — the fiscal-advisor question
  list (see *The advisor gap*).
- **[compliance/asesor-laboral-questions.md](compliance/asesor-laboral-questions.md)** — the
  labour/payroll question list, for a *graduado social / gestoría* (see *The advisor gap*).
- **[superpowers/specs/2026-07-18-pos-architecture-design.md](superpowers/specs/2026-07-18-pos-architecture-design.md)
  §2** — the twenty numbered sub-projects (the strategy; changes rarely).

---

## How the order is decided

- **Soundness, not the calendar** (2026-08-02). Waitron will be finished before the deli must trade,
  so 1-Jan-2027 ranks nothing above anything. Order by dependency, correctness, and de-risking the
  most-reused or most-uncertain foundations first.
- **Never autonomously land anything touching the unrepairable fiscal core** — hash-chained records,
  never-reused invoice numbers. Fiscal-adjacent work in any track takes owner sign-off at land.
- **North star (2026-09-08): an end-to-end working ON-PREM venue** — a blank box to selling,
  printing, paying and closing — then a warm mirror it can fail over to. Waitron Cloud is a separate
  closed-source project for later; nothing is built for it now, but every decision must keep a node
  usable in the cloud unchanged.
- **Docs land direct to `main`** (2026-08-02): the `main protection` ruleset grants Repository-admin a
  bypass, so a docs-only change is branched, `commit -s`, fast-forwarded and pushed — no PR, no CI
  wait. Feature and code changes still go through a PR.
- **Residency:** cloud instances will be hosted in Spain (owner, 2026-09-05), so asesor Q16 does not
  arise.

**The shape we build for:**

- **One venue and one taxpayer per operational node group** (2026-09-09). One active primary, one or
  more warm mirrors, human promotion. Restaurant/bar and deli can be departments within the same
  venue and share preparation. A taxpayer with independent venues has separate node groups; shared
  cloud management sits above them.
- **A mirror is on prem or in the cloud and is reached the same way** — URL + credentials over the
  same replication link. A cloud mirror is reached over WireGuard, so two containers on one machine
  joined by WireGuard IS the cloud test.
- **A node is two containers, app + Postgres**, with named volumes for state, logs and backups. The
  cloud scales by many containers per server, never by multi-tenancy.
- **Product images live in Postgres and are served from it** (2026-09-08). Replication, backup,
  restore and a cloud move are then one mechanism. The URL is content-addressed and served
  `immutable`, so each device fetches each image once until its bytes change; a disk cache can be
  added later without a design change.
- **Backups leave the primary.** Destinations in build order: the mirror, an S3-compatible bucket,
  Google Drive (2026-09-08). All three hang off the existing `StorageBackend` seat.

**Cloud-compatibility rules** — a change that breaks one is a design question, never a default:

1. Peers are reached by URL + credentials only. No LAN discovery, no shared-subnet assumption.
2. Adopt, promote, rejoin and backup are ONE code path wherever the node sits.
3. Every two-node test runs twice: over the plain LAN and over the WireGuard fixture
   (`@waitron/db/testing/two-node-wireguard.ts`, #275).
4. Everything a node keeps outside Postgres is a named volume, and every secret can come from the
   environment as well as a file.
5. The print agent is its own process on the venue's LAN, dialling OUT to the primary by URL. It is
   the one piece that must stay on prem when the primary is in the cloud.

---

## What to work on next

Ranked 2026-09-12, with the reason for each place. The six push steps below are the dependency
order; this list is what to pick up first inside it.

1. **A box a real operator can set up without a terminal.** After a re-image the box serves a NEW
   self-signed CA, the browser silently keeps trusting the old one, and "provision now" fails at TLS
   with no in-page remedy. Cost: a full box-setup dead-end on 2026-09-11, escaped only by deleting a
   keychain entry by hand. Everything else about the box works, so this is what stands between us and
   an installable product. Detail under push step 1.

2. **Nothing checks a fiscal record against AEAT's rules before it is chained or sent** —
   `packages/verifactu/src/validate.ts` holds 25 checks and no production file calls it, confirmed by
   experiment. Wrong values land in an append-only hash-chained table that cannot be edited, and the
   fields at risk are exactly the ones a setup operator types. Highest correctness risk in the tree.
   It travels with the wizard items that feed it — the series codes, the till name, and "what this
   location does" — all under *Open threads → Setup wizard*.

3. **An operator surface for things that went wrong.** The `incidents` table has four producers and
   no reader, and the dashboard has no notification surface at all. A rejected filing, a payment
   drift, a stalled print agent, a failed backup and a stale set of backups are all invisible. Several
   other items end "…waits for the notification surface", so this unblocks more than itself.

4. **A printer on another subnet cannot be added at all.** #319 removed the manual host:port form and
   neither discovery pass crosses a subnet, which is exactly the owner's home setup. Small, and it
   blocks real use today. Detail under push step 3.

5. **The three displays walked end to end** (push step 2) — till, handheld and KDS against a real
   box, tracked in [ui-review.md](ui-review.md). Includes the till not loading its menu until a manual
   refresh.

6. **The two remaining by-id read classes** — request-supplied table ids
   (`moveTab`/`joinTable`/`assertTableAvailable`) and the `ticket_items` reads in
   `bumpCourseReady`/`advanceTicketItem`/`advanceTicket`. Same class as the cross-tenant leak the
   run-it seat caught on till-reroute S3; CLAUDE.md §3 makes it a rule.

7. **The on-prem mirror** (push step 6) — the second half of the north star, and the largest single
   remaining piece.

Everything else ranks beneath these.

---

## The on-prem push, in order

Each step is its own brainstorm → spec → plan → PR; fiscal-adjacent steps take owner sign-off at
land.

### 1. A node as containers, and a from-scratch primary

**Built:** the two containers + `deploy/compose.yml` + named volumes (#285); `deploy/waitron.sh`'s
`install` and `reset` commands, which replaced `prepare.sh`/`install.sh`/`try-branch.sh` (#314,
[design](superpowers/specs/2026-09-11-waitron-sh-box-command-design.md)); the boot-time database-shape
check; the recovery supervisor and the box serving its own leaf over HTTPS in every mode; the CI
`image` job, scoped to `deploy/` changes on a PR with a nightly run (#288); boot-failure
diagnosability — a recovery page of curated operator text keyed by error code, and an
ahead-of-image database check (#310); the enum-upgrade repair and its two root guards (#307); real
hardware bringup fixes (#302); `linux/amd64`-only images (#325); the backup + recovery-key wizard
(#295); guided node onboarding, all four modes (#296). Proven end to end 2026-09-09: blank box →
phone setup → provision → trading over HTTPS → enrolled till → a recorded preproduction sale.

**Open, in order:**

- ***Onboarding must surface the CA-trust step*** (owner, 2026-09-11 — see *What to work on next*).
  The plain-HTTP landing page on :80 serves and links `/ca.crt`, but nothing routes the operator
  through trusting it, and the provisioning failure path says only "Provisioning failed. You can try
  again." Two traps the fix has to survive: modern browsers auto-upgrade a typed `http://<host>` to
  HTTPS, so telling an operator to open `http://<host>/ca.crt` lands them on the app instead
  (`curl` works; a browser flow needs the trust page reached before any HTTPS visit, or a
  QR/`file:` hand-off); and re-imaging leaves the OLD CA in the operator's OS keychain, so the
  recovery needed deleting that entry AND fully quitting Chrome. No box screen says any of this.
  Its own spec and branch.
- **Off-box backup destinations** — mirror, then S3, then Drive. Only `LocalFsBackend` exists.
- **Whole-state-volume capture** — the archive captures a curated list today; capture the whole state
  directory except an explicit exclusion set, with a completeness guard that fails when a new
  top-level entry is neither captured nor excluded. Detail under *Open threads → Backup & restore*.
- **The recovery spec** — a degraded-but-trading mode and the module-contract field it needs.
- **The bootable USB installer** — runs `waitron.sh install` unattended. Open questions it owns:
  whether the stick carries the images so install needs no internet, unattended updates for a box we
  did not sell, AP-mode WiFi onboarding.
- **Core release points 1 to 6 cannot upgrade at all.** The core journal's entries 2 to 6 carry `when`
  values below entry 1's and drizzle picks what to apply from `max(created_at)`; no edit to the
  journal repairs it, because a database at point 2 and one at point 3 need opposite values.
  `migrations.incomplete` makes the failure loud rather than silent. The only real repair is a
  squashed baseline — **an owner decision nobody has taken**.
- **Four paths still migrate a live database with no ahead-of-image check** (`instance-apply.ts`,
  `restore.ts`, `rejoin-command.ts`, `dev-setup.ts`); only the boot path has one.
- **The recovery page's secret bound is a convention, not a guard.** #310 masks URL credentials on
  every line the rotating log sink writes — the connection-string shape and nothing else. A secret in
  any other shape still reaches the unauthenticated page through the log tail, bounded only by the
  convention that an `AppError`'s params carry none.
- *Small, none blocking:* the amd64-only publish has **not yet run** (`publish` is `code`-gated and
  #325 touched only docs and CI) — check `docker manifest inspect ghcr.io/clintongormley/waitron:main`
  after the next code merge to `main`; re-adding a platform means re-adding `docker/setup-qemu-action`;
  `waitron.sh` pulls with `--ignore-pull-failures`, so a box with no manifest entry for its
  architecture would fail silently at pull and break later at `up`; the app and print-agent images
  share one GHA cache scope; the shutdown REJECT path gates its failure-log flush before exit, so a
  `close()` rejection plus a stalled stdout pipe is an uncovered hang.

### 2. Device onboarding and the three displays

Till, handheld and KDS working; kiosk optional (most waiters use their own phones).

**Built:** the installable-till web manifest, the name-constrained CA, the plain-HTTP trust/landing
page, the screen wake lock and per-profile inactivity timeout, and the HTTPS trust detector (#290);
the seeded 300 s inactivity default for handheld and counter till with the counter till idle-logging
out by default (#293); enrolment by pairing mode and numeric match (#287); the device profile model,
`device_kind` gone (#231, #269).

**Open:**

- **The three displays actually walked end to end** — the [ui-review.md](ui-review.md) areas.
- **The till does not load its menu until a manual refresh** (owner, 2026-09-09, from the
  blank-box-to-selling run): a freshly enrolled handheld showed no menu until reload, and a dashboard
  menu change did not appear live. A till-app fix; the box and sale path worked.
- **Android/iOS on-device install and trust rows** — real phones on the shop WiFi, the owner's to run.
- **Register/device follow-ups:** the dev `?dev` chooser shows `label · kind` rather than
  `name · profile · register`; the Spanish form-factor label differs between two pickers
  (`canvas_editor.form_factor.till` = "TPV" vs `device_profiles.form_factor.till` = "Caja
  registradora") — an owner copy decision; `WAITRON_TILL_TILL_ID` still seeds a "Caja 1" register while
  a till enrol auto-creates its own; the device-management routes build their `devices ⨝
  device_profiles` read inline in the HTTP layer, where a `listDevices` store verb belongs.
- *Small:* an `int4InRange` helper collapsing four int4-bounds parsers; an options object for the
  positional `create/updateDeviceProfile` verbs; a shared `SeedDeviceProfileInput`; a
  `BRAND_PRIMARY_HEX` constant (the theme colour is literal in three places).

### 3. The printer agent process, then USB and IP printers end to end

**Built:** the db-free `@waitron/print-agent` foundation (#282) and the agent process — wire client,
poll loop, container host, join-and-accept over the shared `join_requests` table (#289); the box
running the agent container beside the server with a hot-plug-safe `/dev:/dev:ro` mount, live-verified
(#308); on-node auto-enrolment over loopback (#311); central printer provisioning — the serving agent
derived from live capability, printers keyed on a stable local key, all three transports discoverable
(#304); the port-9100 sweep for printers that announce nothing (#313); scan results matched against
registered printers (#318); printer settings tables and modal editors (#319); printer configuration
tabs, queue and history (#327); disabled printers re-addable and a receipt preview (#321).

**Open:**

- **A printer on another subnet than the box cannot be added at all** — see *What to work on next*.
  Neither discovery pass crosses a subnet and #319 removed the manual host:port form. A configurable
  extra-subnet list or a dashboard "probe this address" button restores it; build one of those first.
- **Timestamps across the printers and devices screens show UTC, never the venue's time zone.**
  `formatIsoMinute` (`apps/dashboard/src/date-utils.ts:27`) builds its text by slicing the ISO string.
  That is the pairing window's "Open until…", and equally every last-seen, created-at and job
  timestamp. One shared formatter, not a per-call-site patch.
- **A sweep in flight keeps connecting after the discovery window closes** (measured on #313: 189 of
  253 connects started after expiry). Pass the deadline through `Host.scan` in
  `packages/print-agent`, which every fake host implements.
- **Printer discovery and the Bluetooth model** (owner, 2026-09-11, own spec/branch): network and USB
  discovery is dashboard-driven while Bluetooth scan-and-pair lives on the agent's own `:9110` page —
  move the scan and pair trigger into the dashboard reusing the same window and poll, so all printer
  setup is one surface. And honour OS pairing: a Bluetooth printer bonds to one host, so the agent
  should surface its host's already-bonded printers through the existing `paired()` seam rather than
  reinvent pairing. Prereq: the box's Bluetooth radio path is still hardware-unconfirmed.
- **The virtual PDF printer** and a `print_jobs` retention sweep — nothing deletes a job today.
- **The mirror's print agent is deferred** — a mirror agent cannot reach the primary over TLS (it
  trusts only its local box CA) and needs to for job-pull regardless, so it is gated on a separate
  cross-box print-agent TLS effort. The vouch (signed dormant key + endorsement chain) slots into the
  same route later.
- **Nothing physical has been verified since #327:** printer discovery, paper output, cross-box
  operation, and whether a device knock reaches the box while the Add agent dialog is open. Also
  unmeasured: the five-line feed before the cut (chosen, not measured — the next test print confirms
  it clears the text), physical Bluetooth discovery, and the receipt preview against printed paper.
- *Small:* choose and test one reset-on-dismiss policy for armed destructive row actions across
  printers and agents; the seen-status is as of the last read, not a live presence light; existing
  `?disabled=${busy}` buttons are not migrated to `loading`; retry spacing is the agent's batch
  interval rather than a per-job backoff, so a flapping printer burns `MAX_DELIVERY_ATTEMPTS` at loop
  speed (needs a next-attempt column).

### 4. Payments: card readers

**Built:** Stripe Terminal; the SumUp Cloud API provider (#309); the refund minor-units fix, proven on
the live reader (#312); card payment proof on the receipt (#315, since moved onto a separate slip by
#324); provider and reader configuration from the dashboard, several providers and readers at once
(#323); adoption of readers already paired at the provider, plus battery/connection/firmware/last-seen
status (#329).

**Open:**

- **The SumUp Solo experiments** ([runbook](research/2026-09-10-sumup-solo-experiments.md)).
  Question 4 — does the reader still work standalone once paired to SumUp's cloud — governs whether
  the deli's card-outage path holds; if it fails, the deli-hardware outage design must be rewritten.
  The other three: whether we may supply the idempotency key, whether reader webhooks are signed, and
  whether `void` maps onto the refund endpoint.
- **The printer-cradle experiment** (owner, 2026-09-12; hardware not yet owned). Whether the Solo's
  cradle auto-prints a slip on a Cloud-API-initiated checkout cannot be settled from the API —
  SumUp's published OpenAPI contains zero occurrences of `print` and
  `CreateReaderCheckoutRequest` has no receipt option, so we can neither request a print nor suppress
  one. State the failing case first (the cradle stays silent and the only paper is ours), with a
  standalone-mode payment as the control. If it does auto-print, it supplies the per-payer payment
  slip for free. Also unread: `GET /v1.1/receipts/{transaction_id}`, which returns `acquirer_data`
  and an untyped `emv_data` — richer than the four fields the adapter keeps.
- **What #329 left open:** adding or adopting a reader does not shut out a provider disconnect
  happening at the same moment (an accepted race on the pairing, adoption and add paths alike);
  Stripe's reader list is one page and is not paginated; nothing warns about a low battery (waiting on
  the notification surface); status never refreshes by itself, and adding polling later must go
  through the passive-session controller, never a bare timer.
- **Slice 2 — the handheld NFC/QR link** (pay a table order from a phone), and restoring
  `stripe_on_device` (Tap-to-Pay). Redsys and bank terminals are parked; the research sits in the
  design spec. Routing a walk-up reader versus Tap-to-Pay to different providers waits on this slice.
- **Stripe does not fill `CardDetails`**, so a Stripe card sale prints `Tarjeta` with no
  scheme/PAN/auth. Needs an extra charge read; gated on the deli having a Stripe account, which it
  does not.
- **The SumUp reconciler** — the settlement-report audit and orphan self-heal. `resolvePending` is the
  interim backstop; without an affiliate key a create whose response is lost cannot be correlated and
  the sweep resolves it `failed`, raising `payment.pending_outcome_unactionable` for a human. Prefer
  configuring the affiliate key; the reconciler is what self-heals it.
- **A SumUp API drift-detection suite** — every reader flow can be exercised without a physical reader
  via a Virtual Solo on a sandbox merchant account, so a CI job can pair, checkout, capture, read the
  transaction and refund, pinning the fields the adapter depends on. The Virtual Solo auto-approves,
  so decline and wrong-PIN paths stay in the human sandbox suite. Would have caught the #312
  refund-unit bug. Needs a sandbox account and a CI secret.
- *Small:* bound the HTTP body read as well as the header wait in `sumup-client.ts` (move
  `clearTimeout` after `res.text()`); lift `reverseViaStripe` and `reverseViaSumUp` into one neutral
  `@waitron/payments` reversal primitive when both vendors can be reviewed together.
- **Note for any reconciler:** a SumUp refund is a separate `type: REFUND` transaction with its own
  id, linked by `transaction_code`, plus a `REFUND` event on the original. The original's top-level
  `status` never flips — it stays `SUCCESSFUL` with `refunded_amount` null.

### 5. The in-app walkthrough

Tables, sales, kitchen, bookings, tips, shifts — mostly built; [ui-review.md](ui-review.md) is the
tracker. Plus the counter kitchen fire and the pricing adjustments under *Product work still open*.

### 6. The on-prem mirror

Shortly after the single box works: adopt, promote, the fiscal-certificate distribution rebuild,
rejoin and re-admission, replication status and alarms, and the two-node end-to-end proof over LAN and
over WireGuard. The mechanism is native Postgres logical replication (#280); the membership,
promotion and rejoin arc is complete. What remains is under *Open threads → Replication, membership &
failover*, and the largest named pieces are:

- **Status, alarms and the operator surface for native replication** — numbers and alarms off
  `pg_stat_subscription` / `pg_stat_subscription_stats` and `pg_replication_slots.wal_status`; the
  operator SKIP runbook for a stalled subscription (an `ENABLE ALWAYS` reject-mutation refusal, or a
  `multiple_unique_conflicts` natural-key clash → `ALTER SUBSCRIPTION … SKIP`); a management route for
  the post-drain disable of a carrier's narrowed subscription; the standby-first migration check, which
  replaces the deleted SP-2b park gate; and **orphaned-slot reclamation** — the kept
  `dropReplicationSlot` verb is tested and has no caller, and is what reclaims a slot a retired or dead
  box left behind.
- **Fiscal-certificate distribution — landed #279, reverted #281; rebuild on the native-replication
  adopt flow.** #279 sealed the dormant certificate at a synchronous adopt; #280 made adopt an
  asynchronous initial COPY, so the tenant row arrives later and the one-time break-glass secret is
  gone by then. **Open design question:** how the dormant certificate is protected when the seal must
  happen after the copy. Spec and plan kept:
  [design](superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md),
  [plan](superpowers/plans/2026-09-07-fiscal-cert-distribution.md). Beside it sits **the vault-ring
  question**: `tenant_credentials` is classified `local`, and a blob sealed under one node's ring
  cannot be opened under another's, so `fiscal.aeat` and `payments.stripe` do not travel to a standby
  at all — a shared-ring design is what would let a promoted standby decrypt them.
- **Node-role collapse** — derive ONE `NodeRole` at boot from the membership document (today spread
  across `deployment.mode`, `singleton_role`, membership standing and a boot-captured `fenced` flag)
  and pick one rule: every role change is a restart, or the worker-lifecycle manager — not both.
- **Printer failover** — in its on-prem form this is the standalone print agent following the primary
  (step 3). A till hosting a print agent, the single-box venue's box-death path, needs an on-device
  agent and so is parked behind the go-native decision.

---

## Tracks — who owns which files

Four tracks so four sessions can run without editing the same files. Each track is its own worktree.

- **Track 1 — devices & UI** (push steps 2 and 5). Owns `apps/till`, `apps/dashboard`, `apps/setup`'s
  screens, the device/session/enrol routes in `apps/server`, `packages/layouts`, `packages/ui`,
  `packages/identity`.
- **Track P — platform & packaging** (push step 1). Owns the Dockerfiles and compose,
  `packages/provisioning`, `apps/server`'s config/boot wiring, backup, media, TLS and certificate
  code, `packages/credentials`.
- **Track H — hardware** (push steps 3 and 4). Owns `packages/printing`, `packages/print-agent` and
  `apps/print-agent`, `packages/payments*`, the printer and payment routes in `apps/server`.
- **Track R — replication & failover** (push step 6). Owns `packages/sync`, `packages/membership`,
  `packages/db`'s harness, `apps/server`'s promote / rejoin / box / membership code, CLAUDE.md §2–§5.

**Coordination rules** (each already paid for):

- **Concurrency follows measured headroom, never a count** (CLAUDE.md §2). Before a heavy run check
  free memory and the heaviest processes, then scale to what is free. The shape that caused the
  2026-08-30 force-quits was several sessions' browser runs beside a backgrounded whole-workspace
  `pnpm -r test:coverage`. Real-PG suites racing on Docker ports show as `EADDRINUSE` and pass on
  retry — a flake, not a reason to serialise.
- **Whoever lands second rebases — only on a code-file overlap or a GitHub conflict.** A PR that is
  merely `BEHIND` lands as is with `gh pr merge --squash --admin` (CLAUDE.md §6). Module-owned
  migrations are regenerated on rebase per CLAUDE.md §3's recipe.
- **Shared files:** `apps/server/src/boot.ts`, `CLAUDE.md`, `packages/db`'s core schema and
  migrations, the dashboard printers screen, and this file (each track edits its own items).
- **Comment thinning on touch only** (CLAUDE.md §1); no sweep in any track.
- **Update this file as items land**, in the same PR.

**Back burner — cloud (docs only, no build):** Waitron Cloud itself; the control plane; cloud-only
redundancy (a managed/HA Postgres host versus a second cloud node); the cloud trial on-ramp; WireGuard
on the box image and `@waitron/tunnel`'s retirement; the cloud-standby end-to-end proof; the tax-model
system (no non-Spanish venue is in scope).

**Per-tenant cloud provisioning is not this repository.** The customer signs up, Waitron Cloud — a
separate closed-source service, not started — spawns the instance, sets up WireGuard and hands back a
URL and credentials; this repo only ever *talks to* a provisioned instance. **Do not restart the
cloud-standby work until the Waitron↔Waitron-Cloud boundary contract is settled.** The proof to run
then: on-prem primary → adopt → mirror → human promotion → tills reroute to the promoted cloud → the
venue sells and files. Its run-it proof is a two-host local simulation on the #275 WireGuard fixture;
the software arc is already proven in-process by till-reroute S6.

**If your demo database predates #329, run `wa-wt reset demo`.** The card-reader migration was edited
to create `disabled_at`, so an existing schema is not upgraded by it; the reset discards the demo data.
The same applies to any dev or demo database created before #307, which changed `0014`'s drizzle hash
and so fails the ahead-of-image check.

**Run path (local; no hardware, cloud, or AEAT cert):** `wa-wt demo <worktree-name>` → till
<http://localhost:5190>, dashboard <http://localhost:5191>, setup <http://localhost:5192>, server
:8080. The till enrols itself on first load in dev mode. Till PIN **5555**; dashboard
**owner@demo.waitron.local / dashPass123**. `dev:setup` seeds three menus (~44 products with images),
a floor plan (5 zones / ~16 tables), staff on PIN 5555, and ~28 days of back-dated preproduction sales
— English by default, Spanish via `WAITRON_SEED_LOCALE=es-ES`. Use `wa-wt onboarding <worktree-name>`
for a fresh shipping-style onboarding wizard; `wa-wt reset demo|onboarding [worktree-name]` wipes and
rebuilds that target.

---

## Recently landed, with something still open

Each of these is done; only the named remainder is work.

- **User admin on the shared dashboard controls — #328.** Not verified: the review reached the
  overlapping-dialog state by firing events from code, so nobody has shown a real pointer can get
  there. The list keeps its in-browser paging and search; the replacement is the database-backed table
  item below.
- **User management's core operator slice — #298.** Still open: passkey-based reauthentication for an
  account with no password; an operator screen that stores Google provider credentials in the vault.
  Turnstile and SMS verification belong to the later optional remote-access offering. Wording
  follow-up: the till still renders `person.suspended` as "Account suspended" — align its English and
  Spanish with the dashboard's Disabled terminology (`apps/till/src/i18n/strings.ts`).
- **Dashboard login shortcuts — #305** and **sign-in refinements — #317.** Still open, all device
  checks before deployment: native passkey prompts on real hardware, a physical authenticator QR scan
  and ceremony, live SMTP through `startServer`, and whether a deployment's intermediary cache honours
  the login route's `Vary: Accept-Language` (no cache hardening was added). Two review findings were
  kept on purpose: the passkey offer after a recovery-code sign-in asks for an authenticator code with
  no recovery-code switch (Skip avoids a dead end), and a fresh Remember tick binds to whichever
  identity the person then authenticates as, so the typed email and the saved one can differ.
- **Venue operations management tabs — #320** and **dashboard live updates — #322.** Subscription
  names travel with their server sources and are guarded by `scripts/live-subscriptions.test.ts`; the
  guard catches unknown names, not missing SQL dependencies or disabled-module combinations.
- **Receipts, payment slips and duplicates — #324**, with the split-bill UI (TS-5) landing beside it.
  **Nothing physical was tested** — no real printer produced a slip, a duplicate or a drawer pulse, so
  every paper claim rests on tests and rendered bytes. First chance to close that is the next session
  at the box with the Epson TM-T88III. Named out of scope, each its own future item: **bilingual
  receipts** (`invoice_locales` is configured and snapshotted but rendered by neither document);
  making **one-original-per-invoice structural** rather than procedural — `POST
  /api/sales/:id/receipt` has no limit and no idempotency, so two calls after collection produced
  three unmarked originals of one invoice, and art. 14.1 says that document has exactly one original
  (cheapest containment: make the route idempotent per sale, and put the invoice number on the slip);
  and a **per-tender payment slip** when one sale is settled by several cards. That last needs a
  multi-tender pay path — `settleSale` already accepts `tenders[]`, but `payWorkingOrder` takes a
  single `tender` and `readTenderBlock` assumes one per sale (`apps/server/src/till-sale.ts`). Art.
  11.1 constrains how long an invoice may sit open waiting for the last payer.

---

## Open work not yet in a push step

**User and profile follow-ups from the owner's walkthrough** (2026-09-12, not started).

1. *Keep the display name in step with the person's name as it is typed.* The create form copies only
   the FIRST names into Display name and stops copying the moment anyone edits that box
   (`apps/dashboard/src/widgets/person-form.ts`); the admin's Edit user form and Your profile copy
   nothing (`apps/dashboard/src/widgets/person-edit.ts`,
   `apps/dashboard/src/screens/profile-screen.ts`). Wanted in all three: while someone types, if
   Display name is empty or still reads exactly the first names and last names joined by a space,
   rewrite it to the new joined pair. A display name somebody typed themselves is left alone.

2. *Your profile calls the display name just "Name".* It shows and edits the same `displayName` the
   admin screens label "Display name" / "Nombre visible", using the `profile.name` string
   (`apps/dashboard/src/i18n/strings.ts`). One field, one label, in both languages.

3. *The admin's Edit user form has no Language.* A person's stored interface language (`locale`) can
   only be chosen on Your profile, so an admin setting someone else up cannot pick the language that
   person will first see. Add the same chooser to the admin editor.

4. *Nothing checks that a typed value makes sense — a phone number accepts "abc".* Seen while editing
   a user, but the gap is general: a person's telephone travels from the form to the database as free
   text with no format check. The dashboard field never puts an error on it
   (`apps/dashboard/src/widgets/person-edit.ts:102`), the server only checks it is a string
   (`apps/server/src/management-api.ts:1053`), and the database only refuses an empty one
   (`packages/identity/src/schema/persons.ts:93`). The shared Forms contract
   (`docs/developers/design-system.md` → Forms) says how to SHOW a field error but never says a value
   has to be checked at all. The country packs already hold the seat: `CountryPack.telephone` is a
   validator slot (`packages/country/src/country.ts:47`) and Spain fills it with `validateSpanishPhone`
   (`packages/country-es/src/spain.ts:91`) — nothing calls it. Wanted: use the pack's rule where there
   is one, and where there is not, an optional `+` and country code then digits only, with spaces
   removed before checking; in the browser for the immediate message and again at the server boundary.
   Open questions: whether the stored value is normalised or kept as typed; whether a number already in
   the database that does not pass blocks an unrelated edit to the same person; and which other fields
   follow — the packs carry tax-identifier and postal-code validators too, and the tax identifier is
   fiscal.

5. *Dropdown options appear in whatever order the code lists them, and there is no shared select.* The
   Role chooser on both forms renders a hardcoded list in privilege order
   (`apps/dashboard/src/widgets/person-form.ts:16`, `apps/dashboard/src/widgets/person-edit.ts:14`).
   **Owner decision (2026-09-12): build a `wt-select` in `packages/ui`** — every screen writes its own
   raw `<select>` today, so a written rule alone would be followed unevenly and could not be guarded.
   It sorts by the label the person reads, in the interface language's own alphabet (`Intl.Collator`),
   and carries the rest of the Forms contract the way `wt-input` does. Lists deliberately in a
   lifecycle order need a way to say so. Then migrate the existing screens onto it. Worth fixing at the
   same time: `wt-data-table` sorts rows with `localeCompare` and no locale argument
   (`packages/ui/src/components/wt-data-table.ts:143`), so table sorting follows the browser's language
   rather than the one the person chose.

**Roles are something an admin can add and edit; the four built-ins are only defaults** (owner
decision, 2026-09-12, design not written). A person's role is a PostgreSQL enum with four values
(`packages/identity/src/schema/persons.ts:21`). The seam is already in the right place: no call site
gates on a role string — every one asks for a PERMISSION, and one map turns a role into its permission
set (`packages/identity/src/permissions.ts`) — and a session reads the person's role from the database
on each request rather than from a cookie (`packages/identity/src/management-session.ts:70`), so an
edited role takes effect at once. What changes is that roles and their permissions become rows the
admin owns, per tenant, with the four seeded as defaults. No compatibility code is needed.

The design turns on the **ladder**. The four roles are ordered, and a module contributes a permission
by naming only the lowest role that should hold it (`grantedFrom`, `packages/module/src/module.ts:64`);
identity spreads it to that role and every role above. A role an admin invents has no position on that
ladder, so either every custom role declares where it sits, or the module contract stops naming a role
and names a permission group instead. Pick one before writing schema.
`packages/composition/src/role-parity.ts` proves at compile time that the module contract's roles and
identity's roles are the same list; whatever replaces the union has to keep an equivalent tie.

The rest, once that is settled: **who may edit a role** — `person.admin` already exists because
assigning the admin role decides who controls every permission, and editing roles needs the same
protection plus a rule that nobody can mint or widen a role beyond what they hold, and a venue must
never be left with nobody who can administer roles; **a role in use** — deleting or narrowing one
changes what live sessions may do on their next request, so decide whether a role with people in it
can be deleted at all; **storage** — a table, not an enum, since naming a new enum value in the
transaction that adds it is the trap that bricked a box (CLAUDE.md §2); the table belongs in
identity's own migration set, carries `tenant_id` and needs a classification entry (CLAUDE.md §3);
and **names** — the four built-ins are translated from a fixed table (`roleName`,
`apps/dashboard/src/i18n/domain.ts:180`), so a venue's list will mix translated built-ins with
untranslated custom ones.

**Tell people by email when their account's security changes** (owner, 2026-09-12, not started).
Waitron only emails somebody when it wants them to click something: the sender handles invitation,
password reset and email change, and every one carries an action link
(`apps/server/src/account-email.ts`, `AccountActionPurpose` in
`packages/identity/src/account-action.ts`). Nothing is sent after the fact, so a person whose password
is changed, or who has a passkey or authenticator added or removed, learns nothing — which is the
ordinary way somebody notices an account has been taken over. Wanted: a notification-only message (no
link, one line on what to do if it was not them) for password changed, passkey added or removed,
authenticator enrolled or removed, recovery codes regenerated, email address changed, and Google login
connected or disconnected. Open questions: whether an email-address change notifies the OLD address as
well as the new one; what the message says when an admin made the change; and whether a burst of
changes is grouped into one email.

**Shared database-backed table paging, search and sorting** (owner decision, 2026-09-12; user admin
first). Large lists should query the database from the first page regardless of row count. Extend
`wt-data-table` with reusable paging, sorting and loading controls; each screen supplies its query and
domain filters while its API applies search, filters, ordering and row limits in the database. Start
with 50 users per page and a server-enforced maximum. Search and sorting must cover the whole matching
dataset, so you can find a user outside the displayed page. Debounce typed searches, reset the page
when filters change, ignore superseded responses and preserve passive live refreshes. Verify bounded
responses with a large dataset and stable ordering across pages. Deliberately kept out of #328.

**A notification surface for the dashboard** (owner-raised 2026-09-08; see *What to work on next*).
Nothing exists today — the dashboard cannot tell a manager that something happened while they were not
looking at the screen it happened on. First concrete consumer: "2 devices tried to join in the last 10
minutes" when pairing mode is shut, which otherwise renders inline beside the toggle and is invisible
from anywhere else. Other feeders once it exists: a stalled fiscal outbox or an AEAT rejection, a print
agent that has stopped pulling, a stuck print job past its lease, a failed or stale backup, a standby
that has fallen behind, a low reader battery, a low-stock or purchase-order event. Wants a decision on
scope before it is designed — a transient toast versus a persisted per-person read/unread inbox,
whether it replicates (`state`) or is this node's alone (`local`), and whether anything ever pushes
rather than polls. It is the reader half of the `incidents` item under *Open threads*.

---

## Standing decisions

From the 2026-09-05 whole-project design review and since. They supersede older spec text where they
conflict.

- **One tenant per database everywhere, the cloud included.** A tenant is one taxpayer
  (`country` + `tax_id`; `packages/provisioning/src/tenant-id.ts` derives its id) holding all of its
  locations. The cloud is a dedicated instance per tenant, hosted in Spain; the shared multi-tenant
  cloud store and the multi-tenant transport are dropped. Density comes from many isolated instances
  per host. The only multi-tenant pieces are a small control plane and the preproduction trial demo.
- **Warm standby plus human promotion; active-active is shelved.** Active-active would have to cover
  orders, kitchen progress and every live-service surface, not just selling. Nothing was deleted for
  it: branch **`shelved/active-active`** (= `main` at `c65d3cbe`, 2026-09-05) is the snapshot to
  return to.
- **Modules are core to the product** (opt-in domains, third-party modules later); fiscal is swappable
  by jurisdiction (Veri\*Factu / TicketBAI / none). CLAUDE.md §3 carries the two rules: new domains
  land as modules, and no new core table without a stated reason.
- **Register and device are both kept.** A register (`tills`; UI "register"/"caja") is the drawer
  counted at close; a device is the screen. Several devices ring into one register.
- **Rerouting lives in the till web app** for every device kind; the device credential stays an
  httpOnly cookie. A native agent is built for hardware only, printing first.
- **No relay.** Replication rides the box↔own-cloud-instance WireGuard link; remote access is the
  instance forwarding the box's name down the link without terminating TLS. `@waitron/tunnel` retires
  once that link carries replication.
- **Comments carry invariants, not history** (CLAUDE.md §1). The coverage bar is negotiable with a
  reason.

---

## Layout designer & device profiles — built; follow-ons open

A visual canvas editor with reusable canvases, tills unified into the enrolled-device model, and a
dev-only per-tab device switcher.
[Design](superpowers/specs/2026-09-02-layout-designer-and-device-profiles-design.md); the sub-project
specs and plans sit beside it. Landed across #194–#234, #246 and #269.

**Open:**

- **The aggregated device-profile bundle** — relocating till, station and hardware onto the profile
  and adding area, order-routing and printer-target: the larger "profile" the rename reserved the word
  for.
- **Truly-real card renders in the editor** — needs a neutral browser-safe shared card package both
  apps import (extracting the till widgets off their live stores and props). #223's silhouettes are
  the placeholder. A separate, larger initiative.
- **Visual theme editor** · **NFC pairing runtime and payment routing** (gated on the SumUp Solo
  experiments) · **community canvas sharing**.
- **Location-consistency guard** — nothing enforces that a sale-capable device's register lives in the
  box's configured location, so a mis-provisioned device could stamp a fiscal record's operation
  description with a different site. Add a guard at enrol or first sale.
- *Recorded, not blocking:* a handheld's Order tab is directly tappable with no active table; the
  boot-into-floor prefetch in `#onLoggedIn` is unreached by any shipped canvas; the station screen's
  own device-mode enrol sub-view is unreachable via the app but left in place; the default counter
  canvas has no prep-queue rail.

---

## Module system — framework and exemplars built; follow-ons open

Each domain is an optional, swappable module owning its own schema and migrations, replication
classification, UI, vocabulary, theme, privileges and cronjobs, plugged into a generic core that
imports nothing domain-specific.
[Architecture](superpowers/specs/2026-09-04-module-system-architecture-design.md). Enablement is an
on-box `modules.json` reconciled at boot (default-on; soft-disable keeps data); each node runs its own
migrations, because replication copies rows, not DDL.

**Built:** the module contract and migration source, enablement and reconcile, versioned ordering,
adopt-bootstrap, package-owned enrolment and the graph-honesty guard, the schema-version handshake
(#212–#230); fiscal as a module (#238, #240, #245, #248) and `fiscal-none` (#262); bookings as the
first UI-bearing module (#270, #273); country packs (#292).

**Open:**

- **SP-4 — the module UI surface on the TILL** (card-registry inversion, self-sourcing cards, fiscal's
  cards). The dashboard half is done by bookings SP2.
- **`modules.json` has no flow-down channel** from a primary to its standby — the file is on-box and
  only the adopt-time snapshot flows. Bookings is the first genuinely toggleable module, so the live
  case to design against now exists.
- **A toggleable module that is load-bearing** (identity, payments — still statically wired) fails
  boot loudly if disabled, until the wiring inversion and core extraction.
- **Provisioning's migrate path still runs the linear full `manifestSets()`** — route it through the
  resolver once it gains per-module enablement.
- **The graph-honesty guard's SPI-edge detector** matches `EXECUTE FUNCTION sync_capture`
  specifically, and that function no longer exists. Generalise it to every cross-module
  `EXECUTE FUNCTION` edge (which would also cover `reject_mutation`) or delete the branch.
- **Migrate the remaining core dashboard screens onto the module UI seat** incrementally, and migrate
  core screens off the coarse `requiresManager` gate onto permission ids.
- **Country-pack follow-ons:** build the authenticated Waitron-hosted address relay and its first
  provider adapter (manual entry remains the offline path); apply phone normalization to bookings; add
  a supplier country/identifier scheme before validating purchasing tax IDs; apply a pack's declared
  module preset when country-specific module toggling is needed; implement the currently refused
  foral, Canary, Ceuta and Melilla fiscal jurisdictions.
- **`fiscal-none` left-behinds:** de-dup the `tls.ts` mTLS test fixture (byte-copied because
  `apps/server` cannot import the regime) into a neutral shared testing home; remove the inert
  `VerifactuBackendOptions.resolveClient`/`skipRetryMs`; the browser setup wizard offers `ES-common`
  only, so a GB or no-regime venue is CLI-provisionable but not wizard-reachable — a territory picker
  is its own UI change. Also make provisioning's tests regime-agnostic against `fiscal-none` and drop
  the production-only test exemption.
- **Test-helper debt:** a `provisionTestVenue(db, overrides)` helper for `apps/server` (sixty-odd
  suites repeat the same venue request plus `applyVenue(planVenue(…))`); consolidate the duplicated
  `boot.*.test.ts` helpers (`withCapturedStdout`/`waitForEvent`/`freePort`/`poll`/`seedIdentity`) into
  the same `apps/server/src/testing/` home; the ~300-line two-clone apply-harness duplication across
  the `fiscal-*.test.ts` suites wants a shared `useFiscalMirrorPair()`.
- *Small, each stated in code or spec:* `tenant.not_found` has no production thrower — keep or remove
  is an owner call; `mirror-bundle.ts`'s `r.series ?? []` branch is un-exercised and un-injectable;
  `packages/verifactu` states the software-id cap as a bare `2` while `ID_SISTEMA_MAX_LENGTH` lives in
  `fiscal-verifactu` — export the cap when either is next touched; the SP-3d restore is a
  stopped-server procedure, so overlapping a live SIF registration deadlocks (`40P01`) — revisit
  locking before the hook runs on a live database; `insertNodeSeriesTx`'s held-code check is
  SELECT-then-INSERT; and `readStandardSeriesIdTx` filters by tenant while `readNodeEndorsement`
  documents the opposite.
- **Reconsider the backup container against off-the-shelf tools** (a brainstorm, not a mandate):
  `WBA1` plus `artifact-cipher.ts` holds the whole dump in memory and is restorable only by Waitron
  code, where `pg_dump | age` into a tar is the obvious alternative.

---

## Product work still open

**Ordering and menu:**

- **Venue departments and menu model — ordering and management slice landed #297.** One venue contains
  Restaurant/bar and Deli departments with their own zones, menus and service defaults while sharing
  products and preparation stations.
  [Design](superpowers/specs/2026-09-09-venue-departments-and-menus-design.md) and
  [plan](superpowers/plans/2026-09-09-venue-departments-and-menus.md). **Remaining:** remove the legacy
  product/menu price and fixed-station compatibility fields; custom per-menu modifier authoring (new
  offers copy the product's active choices today); enforcement of department hours and calendar
  exceptions; workforce assignments; immutable department attribution and reporting; batched venue
  readiness and offer queries; a replication smoke test. Same legal seller is the working assumption,
  to confirm before go-live.
- **Menu-management depth (#8)** — greenfield, no owner decision pending: a menu **draft/published**
  state (only an `active` bool today) and **time-of-day / seasonal scheduling**. Per-till persisted
  menu selection was dropped.
- **Order-timing follow-ons** — delivery-order floor flash; idle-floor escalation; real-time push;
  station-kind threshold defaults; an unbumped-since-fire neglect metric; a shared flash helper.
- **Modifier follow-ons** — on-screen expo/station-queue/tab modifier `×N`; extract the shared
  `#allergens` render across basket, station queue and expo; fold the base-allergen `products` join
  into the KDS queue select; the owner UX call on how an unreviewed dish shows on the KDS versus the
  till; post-fire tab-line note and doneness edit (parked — needs a re-fire endpoint); the TS-4
  partial-transfer modifier-split guard; the small shared-helper cleanups.
- **Counter/walk-up kitchen fire** — the #193 follow-up, and the next piece of menu work.

**Pricing adjustments** (owner-added 2026-09-03), both gated on the discount permission — decide the
authorised-role rule and whether a reason code is captured:

- **Reduce or zero the price of an order line** — an authorised per-line override of a locked
  catalogue price, down to €0. A €0-comp *sale* path exists; a per-line reduction does not.
- **Apply a discount to a whole order** — percentage or amount spread across all lines. Needs the
  distribution rule across lines and VAT rates.
- *Fiscal:* a *descuento* agreed at or before issuance is outside the VAT base (Q15, closed on primary
  source), so a reduction must reach the line **before** `computeHuella`, not as an after-the-fact
  adjustment. H2-adjacent — specced with the owner, never landed unattended.

**Bookings:** Bookings-1 landed and is now the `@waitron/bookings` module. Future, each greenfield:
public/online/QR booking, availability and double-booking prevention, reminders, a customer/CRM
entity, recurring bookings, a calendar grid, deposits.

**Wages / labour cost (SP16)** — a **wage-computation engine** turning the hours a person actually
worked (the built *registro de jornada*) and the hours they are scheduled to work (built D2
scheduling) into money owed, showing accrued-so-far versus still-pending for a pay period. Distinct
from the deferred D3 payroll *export*, which hands finished figures to the gestoría.

The core is a **per-person pay-rule set**. The owner's two examples: a waiter contracted for 35 h/week
at €10/h base, €12/h on weekends or nights, +30% on public holidays and €10/h on sick leave — hourly
with condition modifiers; and a waiter on a fixed monthly salary for 35 contracted hours with extra
hours paid per hour. So the model expresses, per person, a base (hourly rate *or* fixed salary for N
contracted hours) plus rate overrides keyed to conditions of the hour worked — weekend, night, public
holiday (flat rate or percentage uplift) — and non-worked paid states such as sick leave. Computing a
shift's pay means classifying each of its hours and applying the matching rule; accrued versus pending
falls out of summing over recorded jornada rows and over the schedule.

- **Gated on the laboral advisor.** The rates and multipliers are governed by the applicable
  provincial convenio colectivo (minimum hourly rates, the legal night-hours window, holiday and
  overtime uplifts). Hold rates as **editable data**, never hardcoded convenio numbers. A public
  holidays calendar (national, autonómico and local) is also needed — its own small data source.
- **Not fiscal.** Wages touch no invoice, huella or chain, so none of the H2 constraints apply.

**Later, smaller, or parked:** Square and generic CSV menu import (a switching-cost story; a one-off
import is not the cheap seed path) · AEAT certificate and Veri\*Factu management UI (first-run only
today; `cert-expiry.ts` monitors but there is no view/rotate/renew surface — the cert-distribution
rebuild adds the endpoint it would call) · accounting export (SP17) · opening hours and channel sync
(SP19) · the **tax-model system** — today the `tax` slot in the country-pack territory→module registry
(`ES-common → {filing:"verifactu", tax:"vat"}`) is an INERT label stamped into `nodes.tax_module` and
nothing branches on it; the intended shape is that the tax MODEL (VAT/GST calculation, receipt layout,
inclusive-versus-exclusive pricing) is generic and lives in `core`, while the fiscal module supplies
the rates and the per-jurisdiction display label — a prerequisite for any non-ES venue that charges tax
· tip payroll (SP13) · online ordering (SP15) · per-seat ordering and multiple tabs per table
(each reopens a settled decision — specced with the owner, never landed unattended) · KDS ops polish
(routing read-back and audit view, station kind, definable kitchen statuses) · recipes depth (nested
sub-recipes, plate costing, stock depletion, variants, customer-facing browse) · inventory and
procurement (SP20 — suppliers, purchase orders, goods-in, stock, 3-way reconcile, par-level reorder;
the AI demand forecast is deferred until the deterministic system exists).

**Parked, real, beneath the tracks:** engaging a fiscal advisor (a parallel human task with a long
lead time; blocks nothing) · the reporting fiscal remainder (modelo-303 filing boxes, asesor-gated) ·
printing cloud-poll transports and the expo device kind · the cloud trial on-ramp (gated on Waitron
Cloud) · the distribution remainder (appliance image, on-device agent, the cloud standby's live link).
[Box maintenance and remote support](superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md)
records proposed per-box owner credentials, temporary support access and WireGuard/SSH connectivity —
a discussion, not an approved spec; a shared support endpoint for customers without a cloud instance
remains an open decision. The
[cloud-services inventory](superpowers/specs/2026-08-29-cloud-services-inventory.md) catalogues the
paid offering and the cloud-versus-core decision rule; review it into real slices when cloud work
starts.

---

## What's built (state per sub-project)

Architecture §2's twenty sub-projects, plus the cross-cutting infra. "Remaining" is the unstarted or
partial scope; the detail for a live thread is under *Open threads*.

| # | Sub-project | State | Remaining |
| --- | --- | --- | --- |
| 1 | Design system | `@waitron/ui` token layer + primitives (`--wt-*`); brand assets (#284); the till web-app manifest and its icons | `wt-select` (see *Open work*) |
| 2 | Sales spine | Immutable hash-chained sales, per-tenant series, catalogue, tenant model | — |
| 3 | Fiscal layer | Verifactu lib + `FiscalBackend`; settlement, R5 rectificativas, F3 canje, invoice-first; fiscal is a module (`fiscal-verifactu`, `fiscal-none`) | record validation before chaining (*Open threads*); F3 asesor/XSD confirmations; cert distribution to a promoted node |
| 4 | Payment layer | `PaymentProvider` + Stripe Terminal, manual card, integrated Stripe, Mode-3 webhook, SumUp Cloud API (#309); dashboard provider/reader configuration (#323, #329) | webhook `recordSale` hand-off; reconcile remediation UI; the handheld NFC/QR link |
| 5 | Identity | persons/sessions, PIN (+ per-device throttle), `authorize()`, roles/permissions, passkeys, email-first dashboard login, emailed invitations and password resets, encrypted TOTP and recovery codes, user admin (#298, #328); identity state replicates to a standby | admin-editable roles; mid-shift-suspension enforce; discount gate; till-refund enforce |
| 6 | Locations | provision-a-sellable-venue (`waitron-provision venue`); departments, zones and menus (#297) | multiple locations, edit/deactivate; then location-scope the by-id verb family |
| 7 | Counter POS | walk-up cash, park/retrieve, manual + integrated card, prepare & collect, canvas/receipt editors, receipt/drawer printing, cash-drawer authorization — operable end to end | — |
| 8 | Reporting | daily close, frozen *cierre Z*, VAT summary, modelo 303 output+input VAT + DR303 file/download, purchase-invoice UI; dashboard sales screen + business-overview home | fiscal filing remainder parked |
| 9 | Deployment | distribution & client-topology design; the box as two containers with `waitron.sh` install/reset (#285, #314); guided node onboarding (#296); till reroute S1–S6; promotion endpoint (#272) | cloud standby live link + the Waitron Cloud boundary; USB installer; appliance parked |
| 10 | Tabs / table service | TS-1 tables+tabs, TS-2 statuses, TS-3 move/join/merge, TS-4 transfer, till action-flow wiring, TS-5 split-bill (#324) | core COMPLETE; owner-added extensions parked |
| 11 | Floor plan | FP-1 live floor + FP-2 spatial canvas/editor | — |
| 12 | KDS / devices | KDS-1 stations/routing/tickets, KDS-2 courses/fire, KDS-3 expo, KDS-4 kitchen printing, order-timing alerts; device identity + profiles (#199, #231, #269) | routing audit view; expo device kind; device-scoped fire/collect routes |
| 13 | Tips | attribution stored (`tenders.tip_amount`) — UI collection ONLY on the integrated-card idle screen | tip-collection UI for cash / manual card / handheld; payroll export (integrate-not-build) |
| 14 | Bookings | Bookings-1, now the `@waitron/bookings` module (#270, #273) | public/online/QR, availability, reminders, CRM, recurring, calendar grid, deposits |
| 15 | Online ordering | — | not started (later phase) |
| 16 | Workforce | *registro de jornada* (chain per node since #268), D2 scheduling, roster authoring + approvals, staff request path + portal | **wage-computation engine** (build, convenio-gated); D3 payroll export (integrate-not-build) |
| 17 | Accounting export | — | not started (core subset; extends Reporting) |
| 18 | Menu/recipes/allergens | EU-14 allergens, recipe/BOM allergen inheritance, recipe-authoring UI, product images, location↔menu membership, ordering modifiers and option groups, per-option and dish-line quantity, modifier↔allergen overlays, dietary classification, order-line customisation | **counter/walk-up kitchen fire — next**; menu draft/publish + schedule; customer-facing menu surface parked; nested sub-recipes / plate costing / stock depletion parked |
| 19 | Opening hours & channel sync | — | not started (Google Business Profile / Maps) |
| 20 | Procurement & inventory | received purchase invoices (`@waitron/purchasing`, feeds modelo 303) | suppliers/POs/goods-in/stock/3-way reconcile/reorder (parked); AI forecast deferred |

**Cross-cutting infra:** replication (native Postgres logical replication since #280 — the application
outbox, its HTTP transport, per-peer auth and retention sweep are deleted) · membership, promotion and
rejoin (the arc is complete) · backup and restore (BR-1..BR-4 plus the wizard) · SIF topology (`#33`,
`node_id` re-key) · the module system · the printing subsystem (`@waitron/printing` plus the db-free
`@waitron/print-agent`) · CI and test infra (scoped CI, pre-push hook, shared-container tests,
job-sharding, root scope) · localisation (per-user `persons.locale`, live language switch, venue-default
derivation) · logging and diagnostics (Slice 1).

---

## Open threads (detail)

### Setup wizard — what the walkthrough found

Owner walkthrough 2026-09-12, none started. Each names what the wizard does today.

1. *The certificate page tells a Spanish operator nothing about getting the file.* It says only
   "Upload the certificate file and enter its passphrase" and accepts `.pfx` / `.p12`
   (`apps/setup/src/screens/cert-screen.ts`). Getting to that file means exporting it from wherever the
   FNMT certificate was installed — the Windows certificate store, the macOS Keychain, or Firefox's own
   store — each a different sequence of dialogs. Wanted: detect which system the browser is running on
   and show the steps for that one, the others behind a link. Screenshots only if somebody owns keeping
   them current.

2. *A mistyped address during setup gives a blank page.* The setup box serves the wizard at the origin
   root with no history fallback, so anything that is not a real file answers a bare 404 with an empty
   body — `/manage`, for instance, which is the dashboard's address once the box is trading (`mountSpa`
   in `apps/server/src/spa-api.ts`, mounted with no `navigationPath`). Wanted: redirect to "/". A
   redirect, not a catch-all serving `index.html` for every path, which would hide a genuinely missing
   asset. Leave the API routes and `/assets/` answering as they do.

3. *The first operator's Password and PIN boxes have no way to see what was typed.* Both are plain
   password fields (`apps/setup/src/screens/admin-screen.ts`) while the same wizard's certificate
   passphrase already carries a reveal control, and the dashboard carries the icon version with an
   action-specific accessible label. Add the dashboard's icon control to both, and use it on the
   certificate screen too so the wizard does not show two different reveal buttons.

4. *Every form mistake on the shop page produces the same sentence.* Whatever is wrong, the banner
   lists every possible problem at once (`apps/setup/src/screens/venue-screen.ts`), and bad fields carry
   an `invalid` flag and nothing else. That is the shared form contract the dashboard already follows
   (CLAUDE.md §3), so say per field what failed — a tax ID that is not valid for the country, a postal
   code that does not sit in the chosen province, too few or too many invoice languages, two identical
   series codes — and leave the summary as a summary.

5. *The demo path demands real business details nobody will use.* Reaching a demo box means filling in
   the whole shop form, the tax ID has to pass the country's validity check and the postal code has to
   match the province (`REQUIRED_TEXT_FIELDS` and `#next` in `venue-screen.ts`), so somebody trying
   Waitron out has to invent a valid Spanish NIF. Wanted for demo only: ask for the operator's own
   details plus the location's name and address, and fill everything else with sensible made-up values
   they can change later. Live and Prepare keep asking for everything.
   **The tax ID is generated, and it is a company one** (owner, 2026-09-12). Both shapes are a checksum
   over the digits (`packages/country-es/src/spain.ts`), so the demo path computes the control character
   rather than asking. Ran both of the owner's examples through the real validator: the company number
   `B-4943574-6` comes back valid, normalized to `B49435746`, kind `entity`, and the same digits with any
   other control character are rejected — that is the shape a restaurant holds, so use it. A personal DNI
   also passes but belongs to a person. A generated number is safe only because a demo box files nothing
   to AEAT, so the generator must never be reachable from Prepare or Live. Remaining design question:
   whether the screen skips fields or the shell patches defaults into the draft, and how the review step
   shows what was chosen.

**Till name and the two series codes: explain them, default them, and check them** (owner asked what
they are and what may be typed in them, 2026-09-12; not started).

- *"Till name" really is the till, not the filing identity — and the wizard probably should not ask for
  it at all.* It inserts a row in `tills` (`create-till`, `packages/provisioning/src/venue-plan.ts`).
  The node — the SIF that owns the fiscal chain and files to AEAT — is created alongside it and named
  automatically after the location, so nobody is ever asked to name the filing identity. The till name
  is an operator-facing label that never reaches AEAT; it is what a Z report prints beside each
  register. The reason to drop the question: a `till`-form-factor device ALWAYS creates its own
  register, named after the device (`createRegister`, `apps/server/src/device.ts`), and never binds an
  existing one — so the wizard's register is left over unless a handheld claims it, and a handheld must
  be given an existing register to ring against (`requireLiveRegister`). No dashboard screen creates a
  register. Wanted: prefill it ("Caja 1", which every seed uses) or drop the question and let the
  dashboard create registers. Not a rename: `applyVenue`'s completeness guard and the handheld binding
  both move with it.
- *The two series codes should be defaulted rather than optional.* A series row must exist — the plan
  always emits both `create-series` actions — so "optional" has to mean a default the operator can
  override, not a field that may be left empty. Do not ask for them at all on the demo path.
- *What may a series code contain?* The database takes any non-empty text, unique per node
  (`invoice_series_code_ck`, `packages/db/src/schema/series.ts`). On the wire the code is joined to the
  counter as `<code>/<number>` (`formatInvoiceNumber`, `packages/core/src/record-sale.ts`), and that
  whole string must be 1–60 characters from `A-Z a-z 0-9 / _ . -` — our own deliberately narrow
  charset, so the QR and form encodings cannot disagree; AEAT itself permits printable ASCII
  (`packages/verifactu/src/validate.ts`). The practical ceiling on the code alone is 38 characters
  (`MAX_BASE_CODE_LENGTH`, `packages/fiscal-verifactu/src/reserved-series.ts`), because a cold restore
  appends `-<installation number>` and the counter needs room.
- *Nothing checks any of that at setup, and the cost lands in an append-only table.* The server requires
  only a non-empty string (`asString`, `apps/server/src/setup-api.ts`). **Ran it** on PGlite through the
  real write path: with the series code `Serie A`, `recordSale` wrote `num_serie_factura = "Serie A/1"`
  into `registros_facturacion` — immutable and hash-chained. **Ran the validator** on that string: it
  fails `NUMSERIE_CHARSET`, so AEAT would reject every record carrying it.
- *What to default them to.* Avoid a trailing `-<digits>`, the shape the restore path claims. **Ran it:**
  `stripOwnSuffixes` removes a trailing `-<number>` when that number is a registered installation number,
  and installation numbers start at 1, so both `Fa-1` and `Fa-00001` reduce to `Fa` and come back from a
  restore as `Fa-2`. Zero-padding also misleads, since the counter is appended after a slash. Two codes
  that survive both and read correctly to a Spanish accountant: **`FS`** (factura simplificada, which is
  what a till issues — every till sale is `TipoFactura` F2) and **`FR`** (factura rectificativa).
- *Who changes a series code, and when?* In practice the system does: a cold restore or standby
  activation retires the live series and opens disjoint ones by suffixing the installation number
  (`deriveReservedSeriesCodes`). An operator would only change it to match an accountant's existing
  scheme. Nothing in the dashboard can change or add a series today.

Wanted: prefill the till name, default both codes, drop all three from the demo path, and refuse at the
wizard and at the server boundary a code the fiscal record would later reject — charset, the
38-character base, and the existing "the two must differ" rule, each with its own message. Every field
on this screen also wants an explanation of what it is for; `wt-help-tooltip` is the shared control.

**"What this location does" is the wrong question for a required tax-agency field** (owner asked why we
ask it, 2026-09-12; not started). The answer is stored on the location (`operation_description`,
`NOT NULL`, `packages/db/src/schema/tenants.ts`) and copied onto every invoice record Waitron files as
AEAT's `DescripcionOperacion`. AEAT's only rules are at most 500 characters and no control characters.
Three problems:

- *The wording asks for the wrong thing.* AEAT wants a description of the transaction being invoiced;
  the question invites a description of the business, so an operator writes "Deli and coffee shop" and
  that becomes the description of every sale. Our own fixture has the right shape — "Venta en
  establecimiento" (`apps/server/src/testing/venue-fixtures.ts`).
- *It is a constant, not a question.* The same string is filed on every sale from that location forever
  and goes to the Spanish tax agency, so it should be Spanish regardless of which invoice languages the
  venue picked — a setting with a sensible default, not a blank box on the way in.
- *Nothing can change it afterwards.* The only write outside setup is the Prepare-to-Live configuration
  transfer; no dashboard screen edits it. So the promise on the same wizard screen — "You can change
  these later" — is false for this field.

Wanted: a default, better wording explaining what the tax agency does with it, and a dashboard screen
that can change it. Design question: where the default belongs. It is not really a country fact —
`DescripcionOperacion` is a Veri\*Factu field and a no-filing regime has no equivalent — so it probably
belongs to the fiscal contribution rather than `CountryPack`, which carries no defaults seat of this
kind.

### Nothing checks a fiscal record against AEAT's rules before it is chained or sent

Found 2026-09-12 while answering a question about series codes; confirmed by experiment; not fixed.
`packages/verifactu/src/validate.ts` holds 25 checks — the NIF's length, `NumSerieFactura`'s length and
charset, date and hash formats, XML control characters in free-text fields, the amount patterns, the
VAT breakdown's line count, `DescripcionOperacion`'s 500-character cap, the total cross-checks — and
`validate` is exported from the package barrel. No production file calls it.

**The experiment**, since a text search alone would not be enough (§1): made `validate` throw on its
first line, then ran two suites. `@waitron/fiscal-verifactu` passed whole — including the end-to-end
write path, the correction and canje paths, the drain, and the real-PostgreSQL replication fidelity
cases — so no production path in the package that writes and submits records calls it. The control in
the other direction: `@waitron/verifactu`'s own tests fail with the same sabotage in place, so it was
reachable and detectable. The file was restored.

Why it matters: the fields a validator would catch are exactly the ones an operator types and nothing
else re-checks. One was proved end to end in the same session — a series code of `Serie A` produced
`num_serie_factura = "Serie A/1"` in `registros_facturacion`, append-only and hash-chained, and that
string fails the charset rule AEAT would apply. The legal name, the operation description and the tax
identifier reach the same records by the same route, and a record AEAT rejects cannot be edited
afterwards.

Open questions: where the check belongs — before the chain append (refusing the sale, though fiscal §5
says nothing external may block one, and this check is local rather than external), at the boundary
where the operator's value is accepted, or both; whether the drain should refuse to send a record it
knows is invalid or let AEAT's rejection be the signal; whether warning-severity issues behave
differently from errors; and whether a guard that this stays wired belongs with the other root guards,
since an exported function with no caller is exactly what a text-walking guard can see.

### Incidents are written by four things and displayed by nothing

Found 2026-09-12 while designing the record-validation fix; its own branch by owner decision.
`openIncidents` (`packages/core/src/incidents.ts`) is the only function that reads the `incidents`
table, and nothing calls it — a whole-repo search outside tests finds only its definition and the
barrel that exports it. No dashboard screen, till screen or report mentions incidents; the diagnostics
screen is a live log tail, a different thing. Meanwhile four producers write them: the fiscal drain
when AEAT rejects a record, the payments reconciler on drift, the Stripe device provider, and the card
provider pool. `apps/server/src/pass.ts` states the intended audience in its own comment — "an operator
grepping `drain.complete` (or the `incidents` table directly)" — and a real venue's operator has no
terminal.

Wanted: one operator surface serving every producer, which is why it is not folded into the
record-validation branch — a screen shaped around that branch's two arithmetic warnings would be the
wrong shape for the four already waiting. Design questions: whether it is its own screen or part of
diagnostics; who may see it (the drain's rejections are fiscal, the reconciler's are money); whether an
incident can be acknowledged or only observed; and how it reaches somebody who is not looking at the
dashboard — which is the notification surface under *Open work*.

### Logging, diagnostics & one-touch bug report (Slice 1 landed #192)

A "report a problem at the touch of a button" system for non-technical staff, feeding a **staff →
manager → vendor** pipeline. Eventual vendor destination is GitHub issues; for now a bundle only needs
to be copy-pastable. [Design](superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md),
[plan](superpowers/plans/2026-08-31-logging-diagnostics-foundation.md).

- **Slice 2 — one-touch bug report (next).** A `bug_reports` table (tenant-scoped, classified `local`,
  grants in its module's set), a capture endpoint that FREEZES a self-contained bundle (client trail
  `snapshot()` + `LogReader.byRequestIds()` + environment), a `wt-report-dialog` and "Report a problem"
  trigger in the till and dashboard chrome, and a copy-pastable GitHub-ready markdown serialiser.
- **Slice 3 — triage and forwarding.** A dashboard *Problem reports* screen and automated GitHub-issue
  creation (needs a stored token in `@waitron/credentials`).
- **Hardening carried out of Slice 1, to do in Slice 2** (when the trail is actually forwarded):
  enforce a key-name allowlist on the client trail's redaction (it filters by value *type* only today,
  so an arbitrary secret string under any key would pass) and scrub `message`/`stack` from rejected
  Errors; `maskPath` masks UUID and all-numeric segments only — mask non-UUID PII segments such as a
  slug or email too; route the dashboard's boot-probe-fail, post-login and logout transitions through
  the nav trail; roll the trail and report button out to `apps/setup`.

### Replication, membership & failover

**Mechanism (since #280):** native Postgres logical replication. Every module classifies its tables
`ledger` / `state` / `local` (CLAUDE.md §3); the table owner (`waitron_migrator`) creates the
`_ledger`/`_state` publications; a standby subscribes over the box↔cloud link; promotion and return run
on `pg_replication_slots` with the fence-LSN drain watermark; settings are primary-wins by
construction. The application outbox, its HTTP transport, the config-conflict gate and the
drain/disposal guard are deleted. The membership, promotion and rejoin arc is complete (#197–#272): a
standby holds its full dormant identity from JOIN — own nodeId, membership keypair, reserved
installation number and disjoint series — and promotion never mints a chain.

**Open residuals, each its own slice:**

- **Re-admission `sell-only → serving-secondary`** — the primary-minted un-fence that makes a rejoined
  box sell again (no self-promotion). Must retire the node's previous chart entry and delete its live
  `fiscal.aeat` row, keeping only the dormant copy.
- **The membership chart grows without bound.** It APPENDS while `MAX_NODES = 8`
  (`packages/membership/src/verify.ts`) makes every verifier refuse a longer document as `malformed`,
  and every wipe-and-re-adopt mints a fresh nodeId — so roughly eight disaster-recovery re-adopts leave
  a document no node accepts, with no self-heal. Re-admission must retire the previous entry, not add
  one.
- **Chart hygiene:** a post-setup change to `WAITRON_ADVERTISED_ORIGIN` is never re-published (nothing
  refreshes the node's own entry at boot), and a node that promotes while absent from the chart appends
  itself address-less, which `routableServers` drops — so no till is told to dial it.
- **Resume-at-restore marker** — a mid-flow failure after the wipe still needs operator recovery (the
  data is safe: the drained tail is on the carrier and the backup artifact exists). Self-recovery needs
  a persisted wiped-state marker to tell a wiped-mid-restore box from a never-provisioned one.
- **Worker-lifecycle manager** (promote Slice 3) — in-process promotion without the restart; the
  node-role collapse decides restart-always versus manager.
- **Power-loss durability and the selling gate.** `writeFileAtomic` does NOT fsync while the
  point-of-no-return is a durable pg commit, so a power cut between the pre-PONR env write and the
  commit could reboot a box `mode=primary` still carrying the primary's series. Close it by fsync-ing
  the env write or resolving the series at boot — and selling must gate on REBOOT COMPLETION, not the
  PONR commit.
- **Still owed after the cert-distribution rebuild:** the restore-onto-cloud re-encrypt (restore an
  on-prem backup onto a fresh cloud node, re-encrypting the vault to the env key — two v1 keys cannot
  share a ring); a dashboard promote UI; an a11y test for the break-glass panel.
- **The same-site cookie browser receipt is still owed** (till reroute plan Task 10). The node-`fetch`
  e2e does not enforce SameSite, so cross-subdomain cookie delivery is unit-proven only. Needs
  interactive Chrome + mkcert + `/etc/hosts`; run it manually or fold it into the two-host proof before
  relying on it in production.
- **Richer daily close** — one close run by the primary across all tills, grouped by till plus a venue
  total (cash-up is per-till drawer, VAT is per-NIF).
- **Mirror fidelity** — `adoptVenue` nulled `locations.catalogue_id` and `tills.receipt_printer_id`
  under the outbox adopt; re-check what the native initial COPY leaves before building anything.
  **First-contact trust bootstrap** for an untrusted-network primary is gated on real hosting.
- **Carry-ins, accepted or to be stated in a threat model:** the primary burns an installation number
  per bundle fetch (gaps permitted, admin-authed); provision and adopt are assumed mutually exclusive
  per box; `establishNodeIdentity` must run once per node before any document is signed (a re-establish
  orphans signed documents); the membership private key is decryptable by the `app_user` pool, as
  `fiscal.aeat` is; a provision failure after `provision()` mints the tenant and chain is unrecoverable
  and needs a re-image; on the first boot after returning, a node runs as its stale-held-doc primary
  until the membership reconciliation restarts it; restart-based fencing leaves a one-tick window in
  which one more fiscal pass could file on the superseded chain.
- **Split-brain** — worked through by the promotion/failover spec and the fence-LSN drain. The
  remaining seam is the promoted node's side while partitioned, which spans selling, the fiscal chain,
  payments (`resolvePending`) and printing — **examine in detail, not scoped to printing** (owner,
  2026-08-26).
- **Till UX for the timed-out card case** — retry, alternative tender, or wait.

### Backup & restore — BR-1..BR-4 and the wizard landed; carry-forwards open

[Design](superpowers/specs/2026-09-04-backup-restore-regime-design.md); the restore hook is
[SP-3d](superpowers/specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md); the wizard is
[#295](superpowers/specs/2026-09-09-backup-recovery-key-wizard-design.md). Landed: the storage
abstraction, fan-out and AES-256-GCM artifact encryption; the single encrypted archive and the module
`backup` contribution; the restore consumer; a filing node's restore minting a fresh chain and disjoint
series; and the dashboard wizard that turns backups on, mints and shows the recovery key, sets the
schedule and retention, and rotates the key. The image still ships with backups OFF, deliberately — the
operator turns them on through the wizard.

**Open:**

- **Whole-state-volume capture** (its own §5-reviewed slice). The archive captures a curated list —
  the fatal `RECOVERY_FILES` plus the optional `backup.env` and `modules.json`. The deeper change:
  capture the whole state directory EXCEPT an explicit exclusion set (`backup-staging/`,
  `restore-staging/`, `logs/`, the per-hardware `instance.env` and `recovery.json`), with a
  **completeness guard** that fails when a new top-level state entry is neither captured nor excluded —
  a curated list goes stale, and `modules.json` was a live example of exactly that gap. Touches BR-2,
  BR-3 and the recovery bundle.
- **The cold-restore operator surface** (promote Slice 4): connection rebinding, advertised origin, an
  authenticated entry.
- **The "backups off or stale" reminder** belongs in the notification surface; the wizard only makes
  the state reportable. When a nightly report job exists, the box-chosen backup slot should fire after
  it rather than anchoring on `day_cutover` plus a margin.
- *Carry-forwards, named rather than gaps:* an abort-aware per-destination timeout (lands with the
  first network backend); a stale-`.tmp` sweep; confirm the `StorageBackend` key path-traversal guard
  landed with BR-3's manifest-driven `get(key)` (BR-3 guards entry NAMES; the key guard was a BR-1
  deferral); a working-backup boot success-path integration test; scope the flat `resolvers` map by
  module when a second `nonDbState` module lands; a `packArchive` pack-time entries bound; a
  manifest-shape coded refusal (it fails safe under GCM auth today); generalise archive entry routing
  off declared source ids when a second non-DB source lands.

### Reporting — the fiscal remainder (parked)

[Spec](superpowers/specs/2026-08-08-reporting-desglose-and-modelo303-spec.md).

- **Two pre-filing caveats a human must clear before the first LIVE 303 filing** (operational, not
  code): validate the generated DR303 file once against the real AEAT sede "por fichero" uploader — we
  emit común + página 1 + página 3 and omit página 2 (régimen simplificado, out of scope), and cannot
  verify from here that the uploader accepts a página-2-omitted file; and an asesor fiscal must confirm
  the **prorrata** treatment — `computeInputVat` emits the deducible base in full and scales only the
  cuota by `deductible_proportion`.
- **Deferred build slices:** rectificativas de facturas recibidas (casilla 40/41 — needs a
  `corrects_purchase_invoice_id` self-FK; relax the app-layer non-negative check for credit-note
  negatives); bienes-de-inversión regularización (43); the prorrata rule that sets
  `deducible_proportion` (44, asesor-driven); intra-community and import boxes (32–39); a libro-registro
  / Pre303 export.
- **Duplicate-invoice-key decision:** `(tenant_id, supplier_tax_id, supplier_invoice_number)` is
  unique-forever today — asesor to confirm per-year versus forever.

### Printing — the remainder beyond push step 3

- **Cloud-poll transports** — Star CloudPRNT and Epson Server Direct Print: a poll→fetch→ack endpoint
  group off the central outbox, token-authed, so a NAT'd printer prints with no agent. Low priority,
  but it does confirm physical print.
- **KDS-4 follow-ups:** device-mode reprint (a `POST /api/device/orders/:id/reprint` behind
  `requireDevice`, scoped to the device's bound station); the mirrored station-side read (the backing
  route exists; only a `DashboardApi.listStationPrinters` and a UI line are missing); the reprint
  timestamp (a reprint stamps the reprint wall-clock, not the original `ticket_items.fired_at`).
- **Read-back routes:** the per-till printer picker is not location-filtered; the print-mode toggle is
  set-only; the `drawer_open_policy` toggle is set-only, which matters because it gates cash access.
- **Expo device kind** — an `expo_pass` device so the KDS-3 pass screen runs always-on.
- **The Impresoras editor leaves agent and transport re-binding read-only** — the management API
  already accepts a re-bind; wire the inline dashboard edit.

### KDS operations — routing, timings and status config

**Order routing is built** (item→station, station→printer, receipt→printer), so "drinks → bar, food →
kitchen, grill → grill" is configurable by composition today. **Gaps, low priority:** a routing
read-back / audit view (the station selects are set-only — the most useful to close, and a
demo-config friction point); no station `type`/`kind` (bar/kitchen/grill/pass is name-only
convention); single-target only (no fan-out, no per-modifier or per-time rules).

**Status config.** Table and service statuses are built with full CRUD. Kitchen statuses are partial:
`bump_mode` and `fire_control` are configurable fixed enums, but a **user-definable kitchen-status
list** does not exist — kitchen tickets run a fixed queued→preparing→bumped lifecycle. Low priority.

**Deferred from coursing and kitchen corrections (#191), each its own slice, owner decisions
2026-09-01:**

- **Moved dishes must keep their kitchen status.** `moveTabLines` deletes and reinserts a line under a
  new id, so its `ticket_items` row cascade-drops and a cooking dish vanishes from the KDS at the
  destination. The ticket must TRAVEL with the line (re-point `working_order_line_id`/`working_order_id`
  to the destination, preserving `fired_at`, state, station and course); it keeps its existing status
  and is NOT re-fired. No test covers a fired line's ticket fate across a move today.
- **Hold-on-send without courses, plus a venue disable setting.** The hold toggle only renders when the
  venue has at least one kitchen course, though the server holds null-course lines fine. Make it
  available by default independent of courses, plus a venue-level setting to disable it.
- **FP-1 renders a child modifier line as its own empty-named tab row.** #191 suppressed its meaningless
  per-line actions, but the blank row remains — needs a `parent_line_id`/`product_id`-aware render.
- **Device-scoped fire/collect routes** — a KDS device is advance-only today; a `fire_control=kitchen`
  or expo *device* needs server-side `/api/device/*` fire and collect routes.

### Constraints for the parked firmware slices (AP-mode / OS image / paid real cert)

- **A setup box's `/health` returns 503 by design** (no duty loop, so not trading-healthy); a liveness
  or supervisor probe must gate on `/setup-api/status` (200), or it restart-loops an unprovisioned box.
- **The name-constrained-CA model does NOT protect a personal Android phone** (spike run 2026-09-08):
  a user-installed root is trusted for every name on Android (server-log confirmed), while desktop
  Chrome and iOS/Safari honour the constraint. Keep the constraint, but for BYOD Android either accept
  broad trust in the box CA or use the public-certificate path — an owner call before go-live. The
  service-worker/PWA/WebAuthn-blocked-until-trusted behaviour and an iOS device are still to measure.
- **The box image carries the replication cluster settings and the WireGuard link:** `wal_level=logical`,
  `track_commit_timestamp=on`, `max_slot_wal_keep_size`, the `waitron_repl` bootstrap, and `pg_hba`
  admitting it only from the peer's WireGuard address.
- **Handheld: kiosk mode is optional, never required** (owner, 2026-09-08) — most waiters use their own
  phones, so the baseline is an installed home-screen web app plus the till's staff PIN. Later options,
  none built: Chromium `--kiosk` in the box image, Fully Kiosk resale for dedicated tablets, Android
  Management API enrolment as a Waitron Cloud feature. No app-store commission applies to a POS app
  taking payment for physical goods.
- **Identity on a standby:** `persons` and `webauthn_credentials` are `state`, so a standby can
  authenticate the venue's people on failover; re-establishment is still PIN-re-prompt v1, with a
  portable signed token as a later slice.
- **On-device agent** (own spec/spike) — the enabler for a till to host a print agent, the single-box
  venue's only box-death printing path. Requires a native app, so parked behind the go-native decision.

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
[cloud-storage-model §8a](superpowers/specs/2026-07-31-cloud-storage-model-design.md) — *before*
paying for answers.

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

**New for the labour advisor (swap design §4.4):** whether a location's exported working-time record
may show per-node chains (the chain is keyed per node since #268).

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
standby replicates it off-box), yet no one has mapped our obligations as a whole. Pieces exist in
isolation — the biometric-clock-in DPIA (workforce plan §2.4, AEPD 2023 guidance; biometrics off by
default), and data export/portability flagged as a GDPR duty in
[cloud-services-inventory](superpowers/specs/2026-08-29-cloud-services-inventory.md) — but nothing
answers the whole-system question. **The task is to scope it before engaging a DPO/lawyer:**
(1) build a data map (what personal data, where — box vs cloud standby, how long retained);
(2) settle the **controller vs processor** split — is Waitron an *encargado del tratamiento* for the
venue's data, and does that need a DPA (the *encargo de tratamiento a efectos del RGPD* question
already sitting in [asesor-questions §RGPD](compliance/asesor-questions.md)); (3) the venue-facing
duties (privacy notice, lawful basis/consent, subject-access + erasure + portability, breach
notification, retention limits) and which of them Waitron must *build* vs the venue must *operate*.
Blocks nothing today, but the retention/erasure/export mechanics become build work once scoped, so
it wants doing before go-live rather than after.

---
---

## Debt and odd jobs

Deferred follow-ups from finished work. None blocks anything; each makes later work cheaper. Per-slice
nits live in the PR threads; what remains here is cross-cutting or decision-bearing.

**Hazards — read before you trip one:**

- **Do not run `pnpm --filter @waitron/db db:generate`** (live since #270). It proposes
  `DROP TABLE "bookings" CASCADE` — a live table `@waitron/bookings` owns — because that table left
  core's schema barrel but stayed in core's snapshot chain.
- **`pnpm install` prints exactly one warning and nobody has looked at it.** #326 removed the
  `Failed to create bin` noise; what remains is a cyclic workspace dependency among `bookings`,
  `migrations`, `fiscal-verifactu`, `sync`, `provisioning` and `composition`. It predates all of this
  and was simply invisible among the others, but it is now the only noise an install makes, so it is
  the next thing anyone will ask about. Unknown whether the cycle is real or an artefact of the
  composition list depending on the modules it names.

**Cross-cutting engineering:**

- **`report-api.ts` runs three concurrent queries on ONE `withTenant` transaction**
  (`Promise.all([computeDailyClose, computeTopSellers, countOpenTables])`, also `daily-close`). pg@8
  queues them — serial, correct, no speedup, a deprecation warning — and it BREAKS in pg@9. Replace
  with sequential awaits or one combined query before pg@9 lands.
- **Permission-based dashboard navigation** (owner, 2026-09-09). Module navigation already filters by
  `me.permissions`, but the built-in `NAV_GROUPS` in `apps/dashboard/src/dashboard-app.ts` mostly use
  role checks. Map every built-in destination to its server permission, hide unavailable items and
  empty groups, and use the same rule for direct URLs and the initial landing screen. Keep Your profile
  available to everyone signed in.
- **Dashboard-wide location context.** The dashboard can manage several locations, but location choice
  lives inside individual screens — menus, roster and planned-vs-actual each mount their own
  `dashboard-location-picker`. Add one persistent location dropdown to the authenticated banner and
  make location-scoped screens consume it. First classify every screen and API as tenant-wide or
  location-scoped so the selector never narrows tenant-wide work by accident; preserve the choice
  across navigation and refresh. A single-location install may collapse the control to a label but
  must use the same context.
- **Location-scope the by-id verb family together** (SP6). `getHeldOrder`/`updateHeldOrder`/
  `abandonHeldOrder` and `updateTable`/`deactivateTable`/`openTab` address by tenant and id; only
  *list* verbs scope by location. Unreachable today (single-location tenants); when multi-location
  lands, move the whole family at once.
- **Two by-id read classes are still unscoped** (see *What to work on next*): request-supplied TABLE-id
  reads (`moveTab`/`joinTable`'s `toTableId`, `assertTableAvailable`) and `ticket_items` by-id reads
  and updates in `bumpCourseReady`/`advanceTicketItem`/`advanceTicket`.
- **till-api's bare `c.req.json()` sites still 500 on a malformed body.** #145 converted the `?? {}`
  sites across ten route files to the shared `readJsonBody`. Left: till-api's ~19 bare
  `await c.req.json<T>()` sites on the sale and pay critical path, each needing per-route validation
  tracing first. The till PIN-login (`POST /api/session`) is the twin of the management login #145
  hardened — a null or malformed body gives an opaque 500 instead of a clean 401. `setup-api` uses a
  different-contract defensive form and is correctly left alone.
- **Handheld live updates (SSE/WebSocket).** The app is pull-only (refetch after each round, serve and
  fire, plus manual refresh), so two waiters on the same table see stale data until a refetch. A live
  push channel would be the first real-time piece in the app — a sizable new subsystem, out of step
  with the pull-only architecture; specced separately when it matters.
- **Configurable per-device layout / face-set editor.** The handheld ships a fixed phone face-set as a
  declarative constant (`HANDHELD_FACES`). Additive: persist a face-set per device profile with a
  fallback to the constant, add a dashboard editor mirroring the canvas editor, and — the heavier,
  separable half — make the table-order screen itself canvas-driven the way the counter screen is.
- **Tip-collection UI, and empty-tab pay-error clarity.** A tip can be stored per tender
  (`tenders.tip_amount`) but the only surface that COLLECTS one is the integrated-Stripe-reader idle
  screen, so cash, manual card and the handheld have no tip field — building it is a design decision
  (where the tip is entered per tender type, cash-rounding versus card add-on, how it reaches
  `tenders.tip_amount`). Separately, `#onPayTab` maps every server code to one `sale.error` key, so a
  genuinely empty tab's actionable `sale.empty_basket` reads as "Could not complete the sale, try
  again" — that flattening is what hid the #189 root cause while debugging.
- **Unify string resolution behind one language-negotiation resolver.** Several divergent name and
  label resolvers with different fallbacks (`localizedName`, `lineName`, the hardcoded
  `descriptions["es"]` in `product-list`/`recipe-screen`, `t()`/`pickLocale`). The write side landed
  (#171). Remaining, latent and harmless today: a shared region-tolerant `negotiate()` (RFC 4647
  lookup); de-hardcode the literal `"es"` to the venue's primary language; give `t()` its missing
  language-subtag tier; a first-class presentational venue-default UI language distinct from fiscal
  `invoiceLocales`; authoring-time locale-completeness validation; and write-side header drift —
  `sales.locale`/`sales.invoice_locales` are stamped by `recordSale` from boot-time `cfg` rather than
  from `locations.invoice_locales` like the line re-key, so a config drift can file a header
  inconsistent with its lines.
  [Design](superpowers/specs/2026-08-30-localization-fallback-negotiation-design.md). Also: the country
  pack supplies province→language derivation, but the apps ship only Spanish and English catalogues, so
  a Catalan preference falls back to Spanish. The venue default is derive-only, not admin-editable; and
  the dashboard's `es-ES` module default still needs the flip the till got in #170 (check whether the
  dashboard money formatter has the same "doesn't follow the UI locale" bug).
- **Two stale lock-order claims in `apps/server/src/working-order.ts`.** The `unjoinTable` docstring
  says it "MATCHES the sale/settle path and mergeTabs" — true today, but a twin to keep in step; and
  the `mergeTabs` docstring says the `dining_tables` lock "seq-scans" because `tab_id` is unindexed,
  which `EXPLAIN` as `app_user` contradicts (`LockRows → Sort → Bitmap Heap Scan` on the tenant index).
  Thin both on next touch.
- **Hoist the receipt's ported money/date/label formatters into `packages/shared`.** `formatReceipt`
  (`apps/server/src/receipt-ticket.ts`) hand-ports `formatMoney`/`issueDate`/`lineName`/`LABEL`/`LEGEND`
  from `apps/till` because an `apps/server → apps/till` dependency is forbidden, so the paper receipt is
  kept in lock-step with the on-screen ticket by COPY (already a small drift: the receipt carries an
  NBSP-money normalization the screen lacks).
- **Account follow-ups.** Design an encrypted retry queue for invitation and password-reset email (the
  account design defers automatic retries and forbids storing raw bearer tokens in a plain queue).
  Scope routine passwordless email login and SMS before adding either. Add passkey-backed
  reauthentication and passkey removal for passwordless accounts before treating profile login-method
  management as complete.
- **Remote-access bot protection** (owner, 2026-09-09). Add Cloudflare Turnstile as part of the
  optional remote-access offering: protect internet-facing login and recovery, validate tokens on the
  server, and preserve restaurant-local login during internet outages. Do not infer trusted local
  access from caller-controlled headers. No Turnstile in the local-only product.
- *Minor:* two QR libraries coexist — `qrcode` in `apps/server` versus `apps/till`'s fiscal-pinned
  `qrcode-generator` — unify into `packages/shared` later; and a generalized top-level boot teardown
  for the `readOrderFlow`/`buildCardProvider` boot-throw pool leak in `boot.ts` (moot in production).

**Fiscal (each behind its own review):**

- **The three alta builders are triplicated** — `recordSale`/`recordCorrection`/`recordSubstitution` in
  `packages/fiscal-verifactu/src/backend.ts` repeat the same alta head and tail. Unrepairable-record
  builders (CLAUDE.md §5), so a de-dup needs its own review and a huella-invariance re-run across all
  three. Safe seam: a helper taking the assembled `Omit<AltaInput,"Encadenamiento">` plus a
  `buildDesglose`; it also folds in the `fechaFromStoredDay` algebra and `recordSubstitution`'s N+1
  loop.
- **A concurrent-corrective race in `settleSale` is untranslated.** If a rectificativa commits between
  the opening read and the `sale_settlements` INSERT, the coverage trigger raises a raw `P0001` that
  `settleSale` does not map to a `sale.*` code. Fail-closed and unreachable in the headless slice.
  Fix when reachable: give the trigger a dedicated SQLSTATE and translate it.
- **F3 canje open questions (asesor/XSD)** — the foreign `IDOtro` recipient path is refused pending the
  asesor's `IDType` shape; whether a separate F3 series is mandatory (it reuses `standard` today);
  cross-SIF F3 is a sound inference, not confirmed; `Destinatarios` XSD confirmation before the first
  real filing.
- **Left behind by the RLS-drop chain:** `sales_assert_tenders_cover`'s "even though the definer sees
  every row" clause is now false — kept byte-verbatim so the equivalence proof stays empty; thin it on
  the first change to that function. `scripts/schema-equivalence-fold.test.py` is a manual command run
  by no gate.

**Provisioning / build:**

- **The `tenant` command is unplanned.** Its idempotency check should attempt the insert and catch the
  unique violation rather than look up `tenants` by NIF first — a read-then-write is the race, and with
  one tenant per database the guard is really `assertNoForeignTenant`.
- **The credential READ path does not `validatePayload`.** `getCredential`/`tryGetCredential`
  (`packages/credentials/src/store.ts`) run the shape guard but not `validatePayload`, so a row sealed
  under an older `PURPOSES` field list returns a missing field as `undefined` rather than being
  rejected — a fail-loudly versus keep-serving call to settle before the first consumer relies on it.
  Plus: password redaction in `applyInstance` is listed rather than structural; `bin.ts`'s `ask()` is
  coverage-excluded logic; `ApplyDeps` and the action list are two sources of truth for the database
  name.
- **Two near-identical node-forge certificate builders** — `apps/server/src/self-signed-cert.ts` and
  the test-only `testing/tls.ts` both define `CertExtension` and `certificate()` (already drifted, and
  the fiscal module carries a third byte-copy). Extract one internal module; its own PR, since it
  touches the mTLS fixture.
- **A box that mints its certificate before NTP sync persists a wrong validity window** — stamped from
  `now` with one day of back-slack, with no renewal path yet. Ties to the time-health check and
  certificate renewal.
- **Provisioning hardening carried from onboarding 2b:** a DB-level advisory lock keyed on `tenantId`
  spanning guard→stamp→`applyVenue` would make `provisionVenue` safe regardless of caller; a
  `sealAeat`/`persistTrading` I/O failure AFTER `provisionVenue` succeeds wedges the box (tenant minted,
  no `trading.env`) and needs a recovery path or a loud wedge; the trading-branch `closePools` closes
  `db`, `replicationDb` and `backupDb` sequentially, so a throw from the first skips the rest — extract
  one `closeAll(pools)`; and a wizard-only box persists its owner connection as `trading.env`'s
  `DATABASE_URL`, so it runs its trading life on the owner role rather than least-privilege `app_user`
  until the role-split retrofit.

**Payments:**

- **The webhook `recordSale` chaining hand-off** — the Mode-3 inbound Stripe webhook's security half is
  done; chaining a settled webhook into a sale needed the till and working-orders model, which now
  exists.
- Pre-existing `forward` retry backoff; the reconcile remediation UI (also a SIF-failover backstop).
- **Stripe is unprovisioned for the deli** — the code is verified against a live sandbox, but no real
  account exists.

**Bizum (parked research, 2026-08-30 — revisit when payment providers are built):**

- **Bizum is account-to-account, not a card.** Merchant Bizum runs through **Redsys** or a PSP. The
  Redsys TPV Virtual API is one standard integration for every Spanish bank (cards plus Bizum via
  `Ds_Merchant_Paymethods="z"`) — no per-bank build. Redsys-direct Bizum is roughly 0.4–0.6%; Stripe
  Bizum is 4.99% + €0.40 (rule out except as a stopgap); SumUp does not support Bizum at all.
- **In person:** dynamic QR works today; Bizum Pay NFC tap launched 18 May 2026, phased to roughly full
  rollout late 2026.
- **The open question that picks the architecture** (unverified): can a SumUp or Stripe
  Tap-to-Pay-on-phone reader accept a Bizum Pay NFC tap? If not, the Bizum tap needs a bank datáfono on
  Redsys rails rather than the waiter's phone. Resolve before designing any in-person Bizum UX.

**CI / test infra:**

- **Two unexplained test-infra incidents, each seen once.** (a) Eleven UI suites failed to load with
  "Vitest failed to find the current suite/runner" after a rebase (2026-09-11); an unchanged full UI
  coverage run and the following push hook passed. On recurrence, retain the failed log and inspect the
  browser module graph before changing caches or retrying. (b) A test PostgreSQL container started with
  no published port (2026-09-12): `docker inspect` showed PostgreSQL healthy and the request to publish
  a port present, while the ports Docker had actually assigned were empty. On recurrence, capture
  `docker inspect` of the stuck container before killing it and check whether the Docker Desktop VM had
  exhausted its ephemeral ports. For both: a passing re-run is not the repair (standing rule — a flaky
  test is fixed at the root).
- **Bookings' intermittent browser freeze remains unexplained after #291.** The dedicated job,
  serialization and outer deadline landed and CI passed, but the freeze was never reproduced locally.
  Inspect subsequent `test-bookings` runs; on recurrence retain the unfinished-file logs and capture a
  browser trace before retrying. The PostgreSQL network stall and the browser freeze are separate
  investigations.
- **`replication-arc`'s isolation was reverted** because vitest `projects` are incompatible with
  `--shard`; it relies on the cluster mutex and boot retry. If it flakes on CI's `test-server` it needs
  a `--shard`-compatible isolation.
- **Job-sharding levers.** `test-heavy` and `test-server` are sharded three ways; vitest `--shard`
  splits by FILE COUNT, so imbalance is the real limit and bumping the matrix means changing
  `shard: [1..N]` and the `--shard=i/N` denominator together, with N at or below the package's
  test-file count. The next critical-path candidate is `mutation-verifactu`; rebalance the
  `LIGHT_A/B_PACKAGES` bins when a run shows one light shard dominating.
- **A hung real-PG suite leaks its cluster containers** (Ryuk is off locally), starving the next run.
  `pnpm reap` only removes labelled containers older than two hours, so a fresh leak survives — inspect
  creation times, ownership and attached volumes, then remove only your own confirmed leftovers.
- *Small:* the pre-push hook's shell is largely untested (the deletion guard and range computation are
  backed only by running the real hook); `test-light` reports success without naming what it ran;
  `packages/ui` can hang the `test-ui` shard, cause unconfirmed (on recurrence, a per-test timeout plus
  a Playwright trace); and the classifier's fourth output line `root=` is emitted and read by no
  consumer.

**Product decisions (defensible before production; decide before it):**

- **The orphan drift gate holds a customer's money pending a human, unbounded** — nothing re-sweeps a
  closed period.
- **`waitron-provision instance` migrates on every run**, which against a trading shop can lock tables.
  Should it be gated — a flag, a refusal, a louder confirmation? Blast radius is one shop.
- **The €0 comped sale settles at the settlement instant, not backdated to `issued_at`.** A till-UX
  question: is a comp ever finalised long after the invoice printed, in invoice-first mode?
- **A human account always keeps an email.** The Users form offers no remove-email action and clearing
  an existing email is rejected by `setEmail`. This is the account rule now, rather than a missing UI
  path; till use still authenticates with the person's PIN.

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
`docs/superpowers/plans/2026-08-19-shared-test-container.md`. A two-node replication suite uses
`packages/db/src/testing/two-node.ts`, or `two-node-wireguard.ts` when the link itself is under test.

**Dev stack from a worktree.** `wa-wt demo|onboarding <worktree-name>` and
`wa-wt reset demo|onboarding [worktree-name]` — the rule is in
CLAUDE.md §6; detail in [ui-review.md](ui-review.md) → _Running the stack from a worktree_.


## How to keep this file honest

Update it in the change that makes it stale (CLAUDE.md §7). In particular:

- When a piece lands, move it out of the priorities / *What's built* "Remaining" column — do not add a
  new receipt paragraph. **This is state, not history; the git log is the history.**
- The moment it goes stale most reliably is a **merge**: `/land-branch` carries a step to update this
  file. A merge deletes the branch the in-flight rows named, so refresh them then.
- When a question is closed on primary source, say so and stop calling it blocked.
- Delete finished items. If an entry is growing proof-of-work (test counts, grep receipts, "proven by
  deletion", what a review seat caught), that belongs in the PR thread and the process log, not here.
