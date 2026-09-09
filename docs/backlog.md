# Backlog — what to work on next, and why

This file answers **"what should I work on?"** It is state, not history: what is built (one line each),
what is open, and the order to take it in. The git log, the PR threads, and the committed
specs/plans in `docs/superpowers/` hold the detail — do not paste receipts back in here.

> **Pruned 2026-09-08** against the 2026-09-05 whole-project design review: every landed item is one
> line with its PR number as a locator; the per-PR narrative (what each review seat caught, test
> counts, yardstick rows) now lives only in the PR threads and `~/workspace/tools/process-log.md`.
> The review's gitignored execution brief (`docs/handoffs/2026-09-05-design-review-cleanups.md`) was
> deleted the same day — every item in it had landed or is listed here.

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

**North star (owner decision 2026-09-08): an end-to-end working ON-PREM venue — a blank box to
selling, printing, paying and closing — then a warm mirror it can fail over to.** Waitron Cloud is
a separate closed-source project for later; nothing is built for it now, but every decision must
keep a node usable in the cloud unchanged (the rules below). This supersedes the 2026-09-05 "MVP for
go-live" options: go-live is an on-prem primary plus an on-prem mirror; a cloud mirror is the same
mechanism reached over WireGuard, when Waitron Cloud exists.

**The shape we build for:**

- **One tenant per node.** One primary, one or more warm mirrors, human promotion. A node belongs to
  one taxpayer; no database ever holds two.
- **A mirror is on prem or in the cloud and is reached the same way** — URL + credentials over the
  same replication link. The only difference is that a cloud mirror is reached over WireGuard, so
  two containers on one machine joined by WireGuard IS the cloud test.
- **A node is two containers, app + Postgres**, with named volumes for state, logs and backups. The
  cloud scales by many containers per server, never by multi-tenancy.
- **Product images live in Postgres and are served from it** (owner, 2026-09-08). Replication,
  backup, restore and a cloud move are then one mechanism; there is no image volume and nothing to
  sync to a mirror. DB load is not a concern at venue scale: the URL is content-addressed and served
  `immutable`, so each device fetches each image ONCE until its bytes change (a till's first boot is
  ~44 small reads; a busy service issues none), and the server keeps a small in-memory cache in
  front. Postgres stays the only source of truth, so a disk cache can be added later without a
  design change if it is ever needed.
- **Backups leave the primary.** Destinations in build order: the mirror (the primary pushes each
  encrypted archive to every mirror), an S3-compatible bucket, Google Drive (owner, 2026-09-08). All
  three hang off the existing `StorageBackend` seat (BR-1).

**Cloud-compatibility rules** — a change that breaks one is a design question, never a default:

1. Peers are reached by URL + credentials only. No LAN discovery, no shared-subnet assumption.
2. Adopt, promote, rejoin and backup are ONE code path wherever the node sits.
3. Every two-node test runs twice: over the plain LAN and over the WireGuard fixture
   (`@waitron/db/testing/two-node-wireguard.ts`, #275).
4. Everything a node keeps outside Postgres is a named volume, and every secret can come from the
   environment as well as a file.
5. The print agent is its own process on the venue's LAN, dialling OUT to the primary by URL. It
   never assumes the primary is local — it is the one piece that must stay on prem when the primary
   is in the cloud.

**The on-prem push, in order** (each step its own brainstorm → spec → plan → PR; fiscal-adjacent
steps take owner sign-off at land):

1. **A node as containers, and a from-scratch primary. Container packaging LANDED #285** — the
   two containers + `deploy/compose.yml` + named volumes,
   `deploy/prepare.sh`, the entrypoint that ensures the database shape on every boot, the
   recovery-supervisor half (an escalating failure counter that serves a page over the box's own leaf
   when boot fails), the box serving its own leaf over HTTPS in ALL modes (setup, recovery AND
   trading — a trading-mode plain-HTTP bug the run-it proof caught, design §11), and the CI `image`
   job that builds, smokes the real host-network compose and publishes to GHCR gated on the full
   suite. The build + smoke were later scoped (#288): on a PR they run only when `deploy/` changed,
   on a push to `main`/tag still on `code` (so `publish` is unaffected), with the steps in a reusable
   `image-smoke.yml` also driven by a nightly + on-request `image-nightly.yml`.
   Proven end to end on 2026-09-09: a blank box → phone setup → provision → trading over HTTPS
   → enrolled till → a recorded preproduction sale (design §11). **Still open under this step:** the
   first-run chooser's modes 1–2 (*Onboarding*, the four-mode wizard) and backup off the primary
   (mirror → S3 → Drive; only `LocalFsBackend` exists).
   **A prepared box takes NO backups until a human edits `/opt/waitron/.env`.** The image
   deliberately does not set `WAITRON_BACKUP_DIR` (node-containers design §3.1): `loadBackupConfig`
   is fail-closed, so a destination without `WAITRON_BACKUP_DATABASE_URL` and
   `WAITRON_BACKUP_RECOVERY_KEY` throws at boot — baking the path alone would kill a box on its
   first restart into trading, right after the wizard. So the trio is `.env`-only, and NOTHING in
   the plug-in-and-open-your-phone flow asks for it. That matters because the recorded posture is
   COLD RECOVERY — restore from backup plus a fresh chain is what gets a venue trading again — and a
   box with backups off has nothing to restore. The natural fix is the wizard: mint the recovery key
   there and SHOW it, because a silently generated recovery key is not a recovery key. Until then a
   box is one disk failure from having no way back.

2. **Device onboarding and the three displays** — till, handheld and KDS working, kiosk optional
   (owner 2026-09-08; most waiters use their own phones). **Installable-till build + LAN-HTTPS
   LANDED #290**
   ([2026-09-08-lan-https-install-and-name-constraints-spike.md](superpowers/specs/2026-09-08-lan-https-install-and-name-constraints-spike.md)):
   the web manifest, the name-constrained CA (leaf SANs filtered to the permitted set), the
   plain-HTTP trust/landing page on port 80, the screen wake lock + a per-profile inactivity timeout
   (KDS exempt; §8), and the HTTPS trust detector. The desktop spike rows passed; Android/iOS
   **on-device install + trust rows remain the owner's** (real phones on the shop WiFi). **Still open
   under this step:** the three displays actually walked end to end (the `ui-review.md` areas), and
   the register/device follow-ups (Track B item 7). Owner decisions to confirm from #290: the seeded
   300 s handheld inactivity default (till/KDS null), and whether the counter till also idle-logs-out
   (today any non-KDS profile with a timeout does). The auto-logout label ships English-default
   ("Auto-logout after (minutes)") and i18n'ed; only the `es` translation wording is provisional.
3. **The printer agent process, then USB and IP printers end to end. LANDED #289** — the db-free `@waitron/print-agent` wire client + poll loop and the
   `apps/print-agent` container host, joining a venue over the shared `join_requests` table
   (device-join-and-accept-design.md §7). Standalone, containerised, follows the primary like the
   till. Printer failover in its on-prem form rides on it.
4. **Payments: card readers.** Stripe Terminal is built. SumUp is built only after its four questions
   are answered — **SENT to SumUp 2026-09-08, awaiting reply**
   ([research/2026-09-08-sumup-questions.md](research/2026-09-08-sumup-questions.md)); question 4 (offline
   after pairing) is design-invalidating, so the build waits on it.
5. **The in-app walkthrough** — tables, sales, kitchen, bookings, tips, shifts: mostly built;
   [ui-review.md](ui-review.md) is the tracker. Plus the counter kitchen fire and the pricing
   adjustments under *Product work still open*.
6. **The on-prem mirror, shortly after the single box works:** adopt, promote, the
   fiscal-certificate distribution rebuild, rejoin and re-admission, replication status + alarms
   (Track A step 5's on-prem half), the two-node end-to-end proof over LAN and over WireGuard.

**Parallel tracks (owner, 2026-09-08: many fronts at once).** The six steps above are the dependency
order; the work is cut into four tracks by file ownership so four sessions can run without editing
the same files. Each track is its own worktree; the coordination rules at the end of the
design-review section apply.

- **Track 1 — devices & UI** (push steps 2 and 5). Owns `apps/till`, `apps/dashboard`, `apps/setup`'s
  screens, the device/session/enrol routes in `apps/server`, `packages/layouts`, `packages/ui`,
  `packages/identity`. Work: device onboarding and the three displays, kiosk, the register/device
  follow-ups, the `ui-review.md` walkthrough, counter kitchen fire, pricing adjustments, the two open
  by-id read-leak classes. (The installable-till build — manifest, trust flow, wake lock, per-profile
  inactivity timeout — **LANDED #290**.) *Follow-ups from #290 (small, unowned):* an `int4InRange`
  helper collapsing the four int4-bounds parsers; an options-object for the growing positional
  `create/updateDeviceProfile` verbs; a shared `SeedDeviceProfileInput` type; a `BRAND_PRIMARY_HEX`
  constant (the theme colour is literal in three places).
  **Till menu does not load until a manual refresh** (owner, 2026-09-09, from the blank-box-to-selling
  run-it proof): a freshly enrolled handheld showed no menu until the operator reloaded, and a
  dashboard menu change did not appear live. The till should load / live-refresh its catalogue after
  enrolment and after a menu change without a manual reload — a till-app fix, not the box (the box +
  sale path themselves worked).
- **Track P — platform & packaging** (push step 1). Owns the Dockerfiles/compose, `packages/provisioning`,
  `apps/server`'s config/boot wiring/backup-*/media/tls + certificate code, `packages/credentials`.
  Work: the two containers + volumes **LANDED #285** (see Priorities item 1);
  the named next Track P specs are **the recovery spec** (a degraded-but-trading mode + the
  module-contract field it needs — design §9.1/§12, Track C's files) and **the bootable USB
  installer** (it runs `prepare.sh` unattended — design §12; open questions it owns: whether the stick
  carries the images so install needs no internet, unattended updates for a box we did not sell,
  AP-mode WiFi onboarding). Then: the from-scratch primary and first-run modes 1–2, images into
  Postgres, backup destinations (mirror → S3 → Drive). (The name-constrained CA + plain-HTTP landing
  page + the LAN-HTTPS spike's desktop half **LANDED #290** — Track 1's slice, but it touched these
  Track P files; the phone rows are the owner's.) *Follow-ups from #290:* the recovery-mode landing
  listener (a `// TODO(recovery)` breadcrumb in `boot.ts`); filtering `box-reach`'s advertised
  reach-URLs/QR through the same permitted-subtree predicate the leaf SANs now use (a Tailscale/link-local-only
  box could otherwise advertise an `https://<ip>/` its cert can't cover — not a regression); and the
  parked IPv6-LAN-SAN / public-address self-sign residuals (the C1 leaf-SAN filter now drops out-of-set
  addresses rather than invalidating the whole cert). Owed to Track H: the box's
  compose runs the print-agent container beside the server with `WAITRON_SERVER_URL` set to the
  server's service address, so the same-box agent joins with nothing typed (print-agent spec §2.2).
- **Track H — hardware** (push steps 3 and 4). Owns `packages/printing`, `packages/print-agent` +
  `apps/print-agent` (new), `packages/payments*`, the printer/payment routes in `apps/server`. Work, in
  order: **1.** the print agent process — spec
  [2026-09-08-print-agent-process-design.md](superpowers/specs/2026-09-08-print-agent-process-design.md),
  plan [2026-09-08-print-agent-process.md](superpowers/plans/2026-09-08-print-agent-process.md).
  **LANDED #289:** the db-free `@waitron/print-agent` wire client + poll loop,
  the `apps/print-agent` container host + LAN setup page, the server knock/status/accept routes, the
  dashboard "print agents waiting to join" UI, and an e2e. Enrolment is join-and-accept over the
  **shared** `join_requests` table
  ([2026-09-08-device-join-and-accept-design.md](superpowers/specs/2026-09-08-device-join-and-accept-design.md)
  §7) — a second consumer of the device slice #287's mechanism, not the pairing-code enrolment this
  spec's §2.3 originally described. Retired: `print_agent_pairing_codes`,
  `generateAgentCode`/`enrolAgent`, `POST /print-api/agent/enrol`,
  `POST /management-api/print-agents/codes`, and the `agent.pairing_*` error codes.
  *#289 whole-branch review — the Codex run-it seat caught two behavioural bugs reading missed and
  both were fixed in the branch: the loop pulled from a wrong-ENVIRONMENT server (§5) — now gated on an
  eligible in-env primary; and "restart to get a fresh code" was false — the verification number is now
  persisted so a restart-while-pending still shows it (revised the in-memory-only choice).*
  *#289 review deferred (non-blocking):* a shared `parseBearer`/selector-split helper (three ad-hoc
  Bearer splits in `apps/server`); a `parseHttpOrigin` dedup between `apps/print-agent`'s `config.ts`
  and `setup-page.ts`; the dashboard join-and-accept logic → a shared Lit `ReactiveController` IF a
  third join surface appears; and two stale device-#287 comments to sweep (`enrol-rate-limit.test.ts:13`
  "pairing-code DELETE", `apps/dashboard/src/api/client.ts:577` "redeemed its pairing code").
  **Foundation LANDED #282** (2026-09-08): `@waitron/print-agent`, a db-free package holding the
  ESC/POS transports moved out of `@waitron/printing`, the wire client's `probeNode`, and the
  follow-the-primary router — plus the `import-x/no-restricted-paths` zone that actually enforces the
  db-free invariant (an empty `dependencies` block does not: a relative escape resolves, typechecks
  and runs, measured at review).
  *Deferred follow-up (2026-09-08 review):* `packages/print-agent`'s `Router` merge and tie-break
  closely duplicate `apps/till/src/api/server-router.ts` — about thirty lines worth a shared home
  when the agent LOOP lands. Not now: `apps/till` belongs to Track 1 and has an active branch, and
  the two have already diverged on purpose (this one skips a foreign environment and pins that
  environment from the configured address; the till does neither).
  *#282's deferred minors: one CLOSED, one still open.* **Closed by #283** — `client.ts`'s two unhit
  branches (a `null` response body; a non-`Error` rejection) are pinned, 89.28% → 96.87%. Chasing them
  surfaced a real hole and fixed it: the client's one contract is that no network condition reaches
  the caller as an exception, but the catch block ended in `String(error)`, which invokes `toString` —
  an object with a hostile `toString` escaped the catch and the caller's `await`. Probed before
  fixing: a `Symbol` rejection is fine (`String(sym)` is specified), an object with a throwing
  `toString` was not. **Deliberately NOT chased to 100%** (owner, 2026-09-08): the one branch left is
  the `finally`'s exception-propagation entry, which V8 counts but which is unreachable now that the
  catch cannot throw. The `finally` itself runs on all six exits — removing it would mean six
  `clearTimeout` calls and a leaked timer the day someone adds a seventh. Do not "fix" this number.
  *Still open:* `packages/printing/src/printers.ts:9,57-58` carries an `import type` plus a separate
  `export type … from` for one symbol, where a single `export type { PrintTransport }` would keep the
  doc comment attached in editor hover.
  **2.** the virtual PDF printer + a
  `print_jobs` retention sweep (spec §7); **3.** **central printer provisioning redesign** — **spec
  written 2026-09-09**,
  [2026-09-09-central-printer-provisioning-design.md](superpowers/specs/2026-09-09-central-printer-provisioning-design.md);
  **plan next.** Subsumes the bare "un-pin IP printers" (failover-printing §4a). The brainstorm
  extended the recorded owner decisions: **the serving agent is DERIVED from live capability, never
  stored** (`printers.agent_id` removed for EVERY transport, not just IP) — IP served by any box in
  the venue, USB/Bluetooth by the box currently reporting the device's stable key; printers keyed on
  `local_key` (USB **serial** / BT **MAC**, survives reboot/replug), the agent resolves key→device
  path/channel at print time; the report is authorised by a new `print_jobs.claimed_by`. **All three
  local transports are discoverable** (IP via mDNS + a 9100 sweep, pre-filling manual host:port entry —
  MAC-keyed IP deferred), and **active discovery runs only inside a dashboard-opened window** (cheap
  presence-of-registered-devices stays always-on for serving); the discovered inventory + window are
  IN-MEMORY on the server (no new tables). **Bluetooth is IN SCOPE now** (was parked) as a third live
  transport with box-local pairing on the agent setup page. No printer drivers (raw ESC/POS; page
  printers out of scope → the PDF path). At-least-once reclaim accepted for MVP (per-claim token
  later). Security-review item (the authz boundary moves to venue/visible-keys). Real-hardware receipts
  (USB + BT) booked for 2026-09-10 on the arriving printer; they settle the §7 container-access /
  enumeration unknowns. Replaces the manual create form (agent dropdown) with a transport-aware flow +
  a discovered-printers list.
  **4.** SumUp once its questions are answered. The manual receipt for 1 is the owner's HP
  LaserJet at `192.168.20.56:9100` (TCP path only — not an ESC/POS device).
- **Track R — replication & failover** (push step 6; the former Tracks A + B). Owns
  `packages/sync`, `packages/membership`, `packages/db`'s harness, `apps/server`'s promote / rejoin /
  box-* / membership code, `CLAUDE.md` §2–§5. Work: the on-prem mirror end to end, the cert-distribution
  rebuild, re-admission, replication status + alarms, node-role collapse, every two-node suite run
  over LAN and WireGuard.

The former Track C's remaining items are hygiene done when passing (the alta de-dup [owner], the
backup-container rethink, dashboard screens onto the module seat, the graph-honesty detector) and
sit with whichever track touches the file. Fiscal-adjacent work in any track still takes owner
sign-off at land.

**Back burner — cloud (docs only, no build):** Waitron Cloud itself, the control plane (Track C
item 4), cloud-only redundancy (Track B item 4), the cloud trial on-ramp, WireGuard on the box
image and `@waitron/tunnel`'s retirement (Track A step 5's cloud half), the cloud-standby e2e
(Track B item 2), the tax-model system (Track C item 7 — no non-Spanish venue is in scope).

**Prioritisation is by soundness, not the calendar** (2026-08-02): Waitron will be finished before the
deli must trade, so 1-Jan-2027 ranks nothing above anything. Order by dependency, correctness, and
de-risking the most-reused / most-uncertain foundations first. **Residency:** cloud instances will be
hosted in Spain (owner decision 2026-09-05), so asesor Q16 does not arise.

**Run path (local; no hardware, cloud, or AEAT cert):** `pnpm dev:setup && pnpm dev` → till
<http://localhost:5190>, dashboard <http://localhost:5191>, setup <http://localhost:5192>, server
:8080. The till enrols itself on first load in dev mode — no code, no approval step. Till PIN **5555**;
dashboard **owner@demo.waitron.local / dashPass123**. `dev:setup` seeds a believable demo
restaurant: two menus (~44 products with per-dish images), a floor plan (3 zones / ~16 tables), staff
on PIN 5555, and ~28 days of back-dated preproduction sales — English by default, Spanish via
`WAITRON_SEED_LOCALE=es-ES`. From a worktree, start the stack with `wa-wt <name>` (CLAUDE.md §6).

### Whole-project design review (2026-09-05) — decisions taken; execution in three parallel tracks

> **Reprioritised 2026-09-08.** The on-prem push above is the order of work and its four tracks
> (1 / P / H / R) are the sessions. The three tracks below are the 2026-09-05 cut, kept for their
> open items: Tracks A + B now run as Track R, Track C's remainder is hygiene done when passing.
> Cloud-only items are marked **BACK BURNER** and are not built until Waitron Cloud starts.

A base-to-tip review of the code and every Track-2 spec, with the owner answering the review's
questions. Its process outcomes have all landed and live in the rule files, not here: CLAUDE.md §1's
comment rule and the rules-first rewrite (#233, #235), the model-selection rule in the global
`~/.claude/CLAUDE.md` with only the waitron yardstick in-repo (#236, settled 2026-09-06 after two
cost revisions: Opus 4.8 drives, Fable is opt-in for brainstorms, dispatched seats run on Opus 5,
Codex Astra holds `/finish-branch`'s run-it seat, Copilot is off — #242/#243/#251/#253/#256; the
seat probe is `superpowers/specs/2026-09-05-model-seats-experiment.md`, the per-PR log
`~/workspace/tools/process-log.md`), inert root config (#252) and root-scope CI/hook (#254).

**Owner decisions (they supersede older spec text where they conflict):**

- **ONE TENANT PER DATABASE everywhere, the cloud included.** A tenant is one taxpayer (`country` +
  `tax_id`; `packages/provisioning/src/tenant-id.ts` derives its id) holding all of its locations.
  The cloud is a dedicated instance per tenant (warm mirror today, or a primary, hosted in Spain);
  the shared multi-tenant cloud store (cloud-storage §2/§9) and the parked multi-tenant transport are
  DROPPED. Density comes from many isolated instances per host. The only multi-tenant pieces are a
  small control plane (Track C item 4) and the preproduction trial demo. The stateless tunnel relay
  is gone (`2026-09-05-relay-decision.md`). This removed the last consumer of FORCE RLS.
- **Warm standby + human promotion; active-active is SHELVED for the foreseeable future.** The
  owner's reason: active-active would have to cover orders, kitchen progress and every other
  live-service surface, not just selling. Nothing was deleted for it: what exists stays on `main`
  under the warm-standby build, and branch **`shelved/active-active`** (= `main` at `c65d3cbe`,
  2026-09-05) is the snapshot to return to. Dated pointers: sync design §12, server-as-SIF §4 + §13,
  promotion-failover §8, distribution §3. The go-live bar is *MVP for go-live* above.
- **Modules are core to the product** (opt-in domains, third-party modules later); fiscal is
  swappable by jurisdiction (Veri\*Factu / TicketBAI / none). CLAUDE.md §3 carries the two rules:
  new domains land as modules; no new core table without a stated reason.
- Comments carry invariants, not history (CLAUDE.md §1). The coverage bar is negotiable with a reason.

**Execution — three parallel sessions**, each in its own worktree, split so no two tracks edit the
same files at once. Each item is its own brainstorm → spec → plan → PR; items marked **[owner]**
never land unattended.

**Track A — data layer** (sequential; owns `packages/*/drizzle/`, `packages/db` tenancy + test
harness, `packages/provisioning`, `packages/sync`, every `vitest.config.ts`, CLAUDE.md §2–§4):

1. **Coverage split — LANDED #239.** 98/98/98/95 on six packages, the 90/90/85/85 floor elsewhere;
   `scripts/coverage-thresholds.test.ts` pins which package holds which bar (CLAUDE.md §2).
2. **Native logical replication prototype — DONE 2026-09-05.** Findings:
   [native-replication-post-rls-prototype-findings](superpowers/specs/2026-09-05-native-replication-post-rls-prototype-findings.md).
   Both 2026-08-02 gates (RLS refusing the apply worker; the non-owner `SET ROLE`) were ownership and
   RLS questions, both gone. The two findings that changed code — `ENABLE ALWAYS` on the
   append-only triggers and a bounded `max_slot_wal_keep_size` — landed with steps 1 and 4 below.
3. **Drop FORCE RLS + the multi-role set, squash the migrations, delete the outbox — steps 1–4
   LANDED; step 5 open.** Design:
   [drop-rls-squash-and-outbox-deletion-design](superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md)
   (one chain; item 4's swap slices are its steps 2–5; ONE owner signature, on step 4).
   - **Step 1 LANDED #255:** per-module baselines, RLS and the seven helper roles gone, `withTenant`
     hollowed to the transaction primitive, the `*.rls.test.ts` suites replaced by per-module grant
     suites + `privileges.test.ts`, CLAUDE.md §2–§4 rewritten. Proof: old migrations vs new
     baselines, `pg_dump --schema-only`, normalised diff EMPTY. Plan:
     `superpowers/plans/2026-09-05-drop-rls-step1-baselines.md`. Follow-up (#258/#260): the mirror
     adopt path shares the one-tenant guard (`assertNoForeignTenant`, `provisioning.foreign_tenant`).
   - **Step 2 LANDED #271:** the `ledger`/`state`/`local` classification contract (`classify()`,
     `@waitron/sync-enrolment`), the two root guards (`classification-complete`,
     `append-only-enable-always`), publication lists derived from the classification, the two-node
     fixture (`packages/db/src/testing/two-node.ts`). Plan:
     `superpowers/plans/2026-09-07-outbox-swap-s1-classification.md`.
   - **Working-time chain per-node rekey LANDED #268** (the S3/S4 prerequisite, swap §4.4):
     `workforce_chains`/`time_entries` keyed to (`tenant`, `node`, `location`), a hashed
     per-chain-monotonic `recorded_at` replacing the non-replicating `ingest_seq`, and a
     cold-restored box CONTINUES its chain (no reset — CLAUDE.md §5). Design/plan:
     `superpowers/{specs,plans}/2026-09-07-workforce-chain-per-node-rekey*.md`.
   - **Step 3 LANDED #274:** the provisioning capability — `@waitron/sync`
     `publications.ts`/`subscriptions.ts`, `@waitron/provisioning`'s `REPLICATION_ROLE` +
     `replicationBootstrapStatements` + `assertReplicationReady`, `sqlStateOf`/`quoteLiteral` in
     `@waitron/shared`, the `wireguardPublicKey` bundle field. Plan:
     `superpowers/plans/2026-09-07-outbox-swap-s2-provisioning.md`.
   - **Step 4 LANDED #280 (2026-09-08, the owner-signature PR):** promotion/return run on
     `pg_replication_slots` with the fence-LSN drain watermark; the promoted node's own subscription
     narrows to `ledger`; `waitron-provision instance` creates the database `OWNER waitron_migrator`
     and migrates AS it (`provisioning.database_not_owned` guards it); adopt is
     subscribe-disabled → boot-time finish → enable; `rejoin` wipes via `DROP DATABASE … WITH (FORCE)`
     then re-adopts; a returned box reconciles membership via `GET /management-api/membership` before
     selling; `tenant_credentials` is `local`. DELETED: the `sync_*` tables, every capture trigger,
     the enrolment seat, `sync-api.ts` + siblings, the pull/retention workers, the SP-2b park gate;
     `sync.*` codes deprecated, never renamed. The dev stack is replication-ready (`wa-wt reset` is
     the live smoke, CLAUDE.md §6). Plan:
     `superpowers/plans/2026-09-07-outbox-swap-s4-s5-promotion-and-deletion.md`.
   - **Step 5 (OPEN) — status, alarms and the operator surface for native replication (swap S6 + S7).**
     The first five bullets are the on-prem half (push step 6); the last three are the cloud half —
     **BACK BURNER**, except that the WireGuard test fixture stays in every two-node suite (rule 3):
     - status-page numbers + alarms off `pg_stat_subscription` / `pg_stat_subscription_stats` (the
       `confl_*` columns, lag, `pg_replication_slots.wal_status`);
     - the operator **SKIP runbook** for a stalled subscription (an `ENABLE ALWAYS` reject-mutation
       refusal, or a `multiple_unique_conflicts` natural-key clash → `ALTER SUBSCRIPTION … SKIP`);
     - **orphaned-slot reclamation** on the cloud — the kept `dropReplicationSlot` verb (tested, no
       caller yet) reclaims a slot a retired/dead box left behind;
     - a **management route for the post-drain disable** of the carrier's narrowed subscription;
     - the **standby-first migration check** (a subscriber lagging a schema migration parks loudly
       until it migrates) — replaces the deleted SP-2b park gate; `schemaVersionsByModule` survives;
     - **WireGuard on the box image** + `pg_hba` admitting `waitron_repl` only from the peer's
       WireGuard address, and the SSH reverse-tunnel fallback (with Track B item 2);
     - **`@waitron/tunnel` retirement** (with Track B item 2) once the link carries replication;
     - the **vault-ring question**: `tenant_credentials` is `local`, and a blob sealed under one node's
       ring cannot be opened under another's, so `fiscal.aeat`/`payments.stripe` do not travel to a
       standby — Track B item 2's shared-ring design is what would let a promoted standby decrypt them.
   - **Left behind by the chain (open, none on the sale path):** `sales_assert_tenders_cover`'s "even
     though the definer sees every row" clause is now false — kept byte-verbatim so the equivalence
     proof stays EMPTY; thin it on the first change to that function. `scripts/schema-equivalence-fold.test.py`
     is a manual command run by no gate. Step-3 minors: a test-helper node-shape consolidation, a
     `createPublications` sequential-await, an `array[…]` `sql.raw` in a pg test.
4. **Outbox → native replication swap design — APPROVED 2026-09-05; delivered as item 3's steps 2–5:**
   [outbox-to-native-replication-swap-design](superpowers/specs/2026-09-05-outbox-to-native-replication-swap-design.md).
   Owner decisions in it: full replacement (no hybrid); no third-party overlay (WireGuard box ↔ its
   own cloud instance, SSH fallback); a returned box drains its ledger back, never its settings, and
   is then wiped and re-adopted; live-service rows are classed like settings (§4.3); the working-time
   chain is rekeyed per node like the fiscal chain (§4.4). The labour advisor is asked only whether a
   location's exported record may show per-node chains.

**Track B — failover** (sequential; = Priorities' Track 2; owns `apps/till`, `apps/server`'s boot /
promote / till-session / read-only gate / box-* / rejoin, `packages/membership`, `packages/printing`):

**Decisions (all TAKEN 2026-09-05, docs-only):** (i) **till-reroute route** — rerouting lives in the
till web app for every device kind; the device credential stays an httpOnly cookie reaching every host
as a tenant-domain cookie (paid tier) or a primary-issued one-time ticket (LAN-only second box,
post-MVP); a native agent is built for hardware only (printing first)
([`2026-09-05-till-reroute-route-decision.md`](superpowers/specs/2026-09-05-till-reroute-route-decision.md));
(ii) **no relay** — replication rides the box↔own-cloud-instance WireGuard link; remote access is the
instance forwarding the box's name down the link without terminating TLS; `@waitron/tunnel` retires
with item 2 ([`2026-09-05-relay-decision.md`](superpowers/specs/2026-09-05-relay-decision.md));
(iii) **register and device, keep both** — register (`tills`; UI "register"/"caja") = the drawer
counted at close, device = the screen; several devices ring into one register; `till_id`'s meaning is
unchanged, so no new H2 receipt
([`2026-09-05-register-and-device-model-decision.md`](superpowers/specs/2026-09-05-register-and-device-model-decision.md)).

1. **Till reroute — S1–S6 ALL LANDED** (#244, #257, #259, #261, #264, #265; design
   [`2026-09-05-till-reroute-design.md`](superpowers/specs/2026-09-05-till-reroute-design.md), plan
   [`2026-09-05-till-reroute.md`](superpowers/plans/2026-09-05-till-reroute.md)). The till FOLLOWS
   THE PRIMARY: `ServerRouter` probes `GET /api/node` on every venue server and points at the one
   accepting sales (no manual switch; a status line + "check again"); on a move it drops the operator,
   locks and re-boots against the new target keeping the working order in memory; a network-level
   failure of a fiscal request shows `sale.unconfirmed`; CORS + a `WAITRON_TENANT_DOMAIN` device
   cookie; till/KDS reads are venue-wide (a promoted node inherits the venue's open tabs), each read
   scoping its own tenant (CLAUDE.md §3). The two-node e2e
   (`apps/server/src/till-reroute-e2e.test.ts`) and the router contract test share one `/api/node`
   fixture.
   - **STILL OWED — plan Task 10's same-site cookie browser receipt.** The node-`fetch` e2e does NOT
     enforce SameSite, so cross-subdomain cookie delivery is unit-proven only (`cookieDomainFor`).
     Needs interactive Chrome + mkcert + `/etc/hosts`; run it manually or fold it into item 2's
     two-host proof before relying on it in production.
   - **Two membership-chart findings from S1, for the re-admission design (item 3's owed list):**
     (i) the chart APPENDS without bound while `MAX_NODES = 8` (`packages/membership/src/verify.ts`)
     makes every verifier refuse a longer document as `malformed`, and every wipe-and-re-adopt mints
     a FRESH nodeId — roughly eight disaster-recovery re-adopts leave a document no node accepts, with
     no self-heal; re-admission must retire the previous entry, not add one. (ii) A post-setup change
     to `WAITRON_ADVERTISED_ORIGIN` is never re-published (nothing refreshes the node's own entry at
     boot), and a node that promotes while absent from the chart appends itself address-less
     (`nextStandings`), which `routableServers` drops — no till is told to dial it.
2. **The cloud standby, end to end — BACK BURNER (owner 2026-09-08; parked since 2026-09-07).** Its on-prem twin — a LAN mirror, proven over LAN and over the WireGuard fixture — is push step 6. (a) The transport
   is Track A's: item 2 consumes native replication + the WireGuard link, it does not build them; the
   link's first code is the two-host TEST fixture (#275: `@waitron/db/testing/two-node-wireguard.ts`
   joins two Postgres nodes over a real kernel-WireGuard tunnel, NET_ADMIN only, and `sync`'s
   `replication-over-tunnel.pg.test` proves a copy across it), nothing on the live path yet — that is
   Track A step 5's box-image work, built together with this item. (b) **Per-tenant cloud
   provisioning is NOT this repo** — it belongs to **Waitron Cloud**, a separate closed-source
   service (not started): the customer signs up, Waitron Cloud spawns the instance + sets up WireGuard
   and hands back a URL + credentials; this repo only *talks to* a provisioned instance. (c) The
   run-it proof will be a two-host LOCAL simulation on the #275 fixture — the standby e2e on it is
   unbuilt; the software arc is already proven in-process (till-reroute S6). **Do not restart until
   the Waitron↔Waitron-Cloud boundary contract is settled.** The proof to run then: on-prem primary →
   adopt → mirror → human promotion → tills reroute to the promoted cloud → the venue sells and files.
   A second LOCAL box is post-MVP; the same adopt path over the LAN is the candidate (wizard mode 4).
3. **Promotion Slice 2 — the authenticated endpoint — LANDED #272.** `POST /management-api/promote`
   with two-path auth (admin `node.promote` OR an offline break-glass secret, scrypt-verified on
   `deployment.break_glass_verifier`, minted at adopt, shown once in the setup UI) and
   `WAITRON_ADMIN_DATABASE_URL` (fail-closed). A promoted cloud **sells + chains on its own reserved
   SIF but does NOT file** until cert distribution lands — `awaitingFiscalCertificate` on box-status,
   never silent (owner: sell-now-file-later). Break-glass is authorization only (the 2026-08-29 runbook
   §4 key-ring job is retired). Design/plan: `superpowers/{specs,plans}/2026-09-07-promote-endpoint-slice-2*.md`.
   - **Fiscal-certificate distribution — LANDED #279, REVERTED #281 (2026-09-08); REBUILD on the
     native-replication adopt flow.** #279 sealed the dormant cert at the SYNCHRONOUS adopt (tenant row
     in hand, break-glass secret in hand); #280 made adopt an ASYNCHRONOUS native initial COPY (the
     tenant row arrives later; the reserved-identity establish moved to a boot-time finish worker), so
     the seal has no tenant row to FK to and the one-time break-glass secret is gone by then. Owner
     decision: land the swap as the foundation, rebuild this as a follow-up. **Open design question:**
     how the dormant cert is protected when the seal must happen after the copy. Spec + plan KEPT:
     [`2026-09-07-fiscal-cert-distribution-design.md`](superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md),
     [`2026-09-07-fiscal-cert-distribution.md`](superpowers/plans/2026-09-07-fiscal-cert-distribution.md)
     — dormant `fiscal.aeat.dormant` unwrapped inside the promotion transaction (or via
     `/management-api/fiscal-certificate/unlock`); an install/replace endpoint as the renewal path and
     lost-break-glass fallback; cloud nodes take the vault key from the ENVIRONMENT (no `secrets.env`)
     so a backup yields no usable cert; `fiscalCertificate: live|dormant|none` on box-status; an unlock
     failure withholds FILING, never SELLING.
   - **STILL OWED after the rebuild (separate slices):** the **restore-onto-cloud re-encrypt** (design
     §4.3: restore an on-prem backup onto a fresh cloud node, re-encrypting the vault to the env key —
     `reencryptVault`, two v1 keys cannot share a ring); **re-admission** of a rejoined
     wiped-and-restored box as the standby — must DELETE the re-admitted node's live `fiscal.aeat` row
     and hold only the dormant copy (design §8), and retire its previous chart entry (item 1's finding
     (i)); the **resume-at-restore marker** (a wiped-mid-restore box vs a never-provisioned one); the
     **worker-lifecycle manager** (promote Slice 3 — in-process promotion, no restart; see item 6); a
     **dashboard promote UI**; an **a11y test** for the break-glass panel. Minors: the
     `fiscal.certificate_dormant_stored` log event was dropped (adopt has no logger); a `boot.promote`
     corrupt-case test asserts the failure event but not `reason==="corrupt"`.
4. **Cloud-only redundancy — BACK BURNER (brainstorm when Waitron Cloud starts).** (a) one node on a managed/HA Postgres host vs (b) a
   second cloud node on the built mirror mechanism. (a) needs an inventory of what the server keeps
   on local disk (`writeFileAtomic` env files, `mediaDir`, the box-secret vault, backup state) and a
   singleton lease so a restarted or relocated app process never runs a second submitter; (b) is
   item 2 without the tunnel. Pick per deployment; both may ship.
5. **Printer failover** (`2026-08-26-failover-printing-design.md`) — in its on-prem form it is the
   standalone print agent following the primary (push step 3); the cloud-primary case is the same
   agent, which is why it must stay on the LAN (rule 5).
6. **Node-role collapse — UNBLOCKED (Track A's `boot.ts` edits are done).** Derive ONE `NodeRole` at
   boot from the membership document (today spread across `deployment.mode`, `singleton_role`,
   membership standing and the boot-captured `fenced` flag) and pick one rule: every role change is a
   restart, or the worker-lifecycle manager (promote Slice 3) — not both; a small worker registry
   replaces `startServer`'s hand-rolled AbortController-per-worker.
7. **Register/device model — the no-migration half LANDED #269** (design
   [`2026-09-07-device-enrolment-and-login-design.md`](superpowers/specs/2026-09-07-device-enrolment-and-login-design.md)):
   the device **profile** is the single description of a device — `device_kind` is gone, a device's
   kind derives from its profile's `form_factor`; a `till`-form-factor enrol auto-creates its own
   register; `tills(tenant_id, location_id, name)` is unique per venue; the shift session is keyed to
   the device's register; a per-(device, person) PIN throttle (`pin.throttled`).
   - **LANDED #287 (2026-09-09) — enrolment by pairing mode + numeric match.** devMode auto-accepts,
     so the dev till enrols on first knock (the retired `DEMO` pairing code is gone). **Live repo-wide
     hazard this surfaced:** **do not run `pnpm --filter @waitron/db db:generate`** — it proposes
     `DROP TABLE "bookings" CASCADE`, a live table `@waitron/bookings` owns, because that table left
     core's schema barrel in #270 but stayed in core's snapshot chain. Design approved 2026-09-08,
     [`2026-09-08-device-join-and-accept-design.md`](superpowers/specs/2026-09-08-device-join-and-accept-design.md),
     which supersedes §2 of the design above). The pairing code goes: the admin opens a venue-wide
     fifteen-minute *pairing mode*, the device asks to join carrying only a name and shows a two-digit
     number, and the admin taps the matching one of three in the dashboard and picks the profile and
     binding there. `device_pairing_codes` → `join_requests`; enrolment moves from an
     unauthenticated route to a `device.manage` session (it writes — a till enrol creates a register);
     `dev-pairing.ts` and the `DEMO` code die, with devMode auto-accepting. **Both pairing-code tables
     become ONE generic `join_requests` table** (`local`, a `kind` of `device` | `print_agent`) shared
     with the print agent — one window, one gesture, one table, both surfaces. **Sequenced FIRST**
     (owner, 2026-09-08): this slice builds the shared mechanism generically, against the harder
     consumer, and Track H item 1 lands a second consumer on top (spec §12).
   - *Follow-ups (pre-production edges, not blocking):* (a) the dev `?dev` chooser rows show
     `label · kind`, not `name · profile · register` (`GET /api/dev/devices` returns only ids + kind);
     (b) **owner copy decision:** the Spanish form-factor label differs across two pickers
     (`canvas_editor.form_factor.till` = "TPV" vs `device_profiles.form_factor.till` = "Caja
     registradora"); (c) `WAITRON_TILL_TILL_ID`/provisioning still seeds a "Caja 1" register while a
     till enrol auto-creates its own — dedupe deferred by the decision doc; (d) the hardware PATCH
     validates `card_provider` and `card_reader_id` independently — the "reader id only for
     `stripe_terminal`" rule lives only in the dashboard UI; move it server-side if it is a real
     invariant; (e) the device-management routes build their `devices ⨝ device_profiles` read inline
     in the HTTP layer — a `listDevices` store verb would restore the layer.
   - *Test-infra follow-ups (from #286, the two-node cluster flake this slice's push surfaced):* the
     heavy two-node replication suites (`replication-fidelity`, `replication-subscribe`,
     `replication-over-tunnel`, `replication-arc`) hung for 300s under the full local run.
     #286 added a boot retry + bounded timeouts (`two-node.ts`), a `groupOrder` isolation
     project for `fiscal-verifactu`'s two-node file, and a cross-process cluster mutex
     (`packages/db/src/testing/cluster-mutex.ts`, one live cluster machine-wide). Open edges: (f)
     `apps/server`'s `replication-arc` isolation was reverted because vitest `projects` are
     incompatible with `--shard` — it relies on the mutex + retry; if it flakes on CI's `test-server`,
     it needs a `--shard`-compatible isolation. (g) **In progress, `test-load` (2026-09-09):**
     give Sync and Bookings dedicated CI jobs, cap the remaining bins and local package runs,
     serialize Bookings' Node/browser projects, restore fiscal-verifactu's effective outer fork
     cap (the #286 project move started 17 workers locally), and enforce outer deadlines. The supplied CI logs
     leave Bookings browser files unfinished while Sync completes; local runs also reproduced Sync/fiscal migration stalls. A standalone query probe traced
     those to dual Docker network interfaces; the fixtures now use one network and unique peer names. [Evidence and verification](superpowers/specs/2026-09-09-test-load-design.md). (h) A hung real-PG suite LEAKS its
     running cluster containers (Ryuk off), starving the next run; `pnpm reap` only removes labelled
     containers older than 2h, so a fresh leak survives — inspect creation times, ownership and attached volumes, then remove only your own
     confirmed leftovers before re-validating. (i) `staff-screen.test.ts` (dashboard, browser mode) flaked once on CI
     with `vi.mock("@simplewebauthn/browser")` not applying (`mockClear is not a function` across the
     whole suite); passed on re-run and locally. If recurrent, it is a vitest browser-mode
     module-mock-hoisting issue to fix, not re-run.

**Track C — product / modules** (sequential; owns `packages/fiscal*`, the module framework packages,
`packages/composition`, every NEW module package, `apps/dashboard` module screens,
`apps/server/src/modules.ts`, and the control-plane docs):

1. **Fiscal as a module — COMPLETE** (SP-3a #238, SP-3b #240, SP-3c #245, SP-3d #248; see *Waitron
   module system*).
2. **`fiscal-none` module — LANDED #262** (spec `2026-09-06-module-fiscal-none-design.md`). The no-op
   regime fills the fiscal slot with an empty runtime-duty seat and records nothing; provisioning
   selects the fiscal module by territory (`GB-vat`→none, `ES-common`→verifactu) through one
   `venueFiscalSelection` seam; `apps/server` imports NO regime package and `scripts/module-seams.test.ts`'s
   `DEFERRED_RUNTIME_PASS` allowlist is EMPTY.
   - *Left behind (none on the sale path):* de-dup the `tls.ts` mTLS test fixture (byte-copied into
     `@waitron/fiscal-verifactu/src/testing/` because `apps/server` cannot import the regime) into a
     neutral shared testing home; remove the inert `VerifactuBackendOptions.resolveClient`/`skipRetryMs`
     (dozens of construction sites pass an inert resolver); the browser setup wizard offers `ES-common`
     only, so a GB/no-regime venue is CLI/test-provisionable but not wizard-reachable (a territory picker
     is its own UI change); the Task-8 provision-only gate keeps a synthetic-module test for the
     `provision_only_disabled` branch (no real non-fiscal provision-only module exists).
   - **English-only generic guard — LANDED #266.** Owner principle (2026-09-07): Spanish only in
     Spain-specific modules (verifactu, workforce-es, reporting = modelo 303); core/generic code is
     English — identifiers, strings AND comments. The guard scans comments (quotations intact);
     `provisioning`/`tunnel`/`payments-stripe`/`ui`/`migrations`/`fiscal-none` are scanned, `reporting`
     is not. The inert tax-model slot value went `iva`→`vat` (item 7). Design:
     `superpowers/specs/2026-09-07-english-only-generic-english-design.md`. *Remaining follow-on:* make
     provisioning's tests regime-agnostic against `fiscal-none` and drop the production-only test
     exemption (spec §6 step 5).
3. **Bookings as the first UI-bearing module — SP1 LANDED #270, SP2 LANDED #273.** SP1: `@waitron/bookings`
   owns its tables (own migration set), verbs + routes behind a typed `routes` seat `boot.ts` mounts
   generically, a `permissions` seat (`booking.manage`), a `floorAnnotations` seat, classification
   `state`; request + cookie helpers lifted to `@waitron/server-kit`. Floor coverage bar (a domain
   module, like workforce). SP2: the reusable dashboard module-UI seat — a module ships a
   `DashboardContribution` from a `./dashboard` browser sub-path (screen + nav + i18n + permission
   gate), `@waitron/dashboard-modules` is the browser twin of `ALL_MODULES`, `@waitron/dashboard-kit`
   holds the i18n/code-message registries + request primitive, `getMe` returns effective `permissions`
   + enabled `modules`; guarded by `scripts/dashboard-browser-purity.test.ts` + a Vite-build backstop.
   Specs/plans: `superpowers/{specs,plans}/2026-09-07-module-bookings-sp{1,2}*.md`.
   - **§3 by-id read-leak family — fixed in three PRs** (#270 the booking verbs + `openTab`; #276
     `createOpenOrder`'s delivery-table pre-check; #278 `lockOpenTab`/`assertTabOpen`/`mergeTabs`/
     `moveTabLines`/`parkOrder`'s replay/the eleven `till-sale.ts` reads — helpers now take `cfg`, not
     a bare `tenantId`). **Still open, SEPARATE classes:** (i) request-supplied TABLE-id reads —
     `moveTab`/`joinTable`'s `toTableId`, `assertTableAvailable`; (ii) `ticket_items` by-id
     reads/updates in `bumpCourseReady`/`advanceTicketItem`/`advanceTicket` (still `_cfg`, unscoped —
     the KDS §3 class).
   - *Design notes for SP2+:* `CoreServices` is one shared interface every module receives whole — when
     a second core verb is needed, prefer per-module narrow required-services interfaces;
     `floorAnnotations` is single-purpose (`{reservedTime}`) — generalise only when a second annotator
     appears. `floor.ts`'s per-poll `locations.time_zone` read is left as-is (#277 memoized the
     formatter only).
   - **Follow-ons SP2 unblocks:** migrate the other ~22 core dashboard screens onto the seat
     incrementally; migrate core screens off the coarse `requiresManager` gate onto permission ids.
   - **CI (2026-09-09, `test-load` in progress):** repeated hangs left Bookings browser files
     unfinished after its database files passed. The branch gives Bookings a dedicated job,
     serializes Node/browser projects and browser files, and adds an outer job deadline.
     [Evidence and verification](superpowers/specs/2026-09-09-test-load-design.md).
4. **Control plane brainstorm — BACK BURNER (Waitron Cloud).** With one tenant per database and a
   dedicated cloud instance per tenant, the only multi-tenant service Waitron runs is a small control
   plane: accounts (a customer of ours — one customer may own several taxpayers), subscriptions,
   instances (which box/VM serves which tenant, its version; region Spain), a WireGuard keypair +
   endpoint per box and the box's public names, version rollout per tenant. Still open from the relay
   decision (§3): one name or two for LAN-vs-remote reach. Docs-only until designed.
5. **Reconsider the backup container against off-the-shelf** (brainstorm, not a mandate): `WBA1` +
   `artifact-cipher.ts` (whole-dump in memory, restorable only by Waitron code — `pg_dump | age`,
   tar).
6. **De-triplicate the three alta builders — [owner]** in `fiscal-verifactu/src/backend.ts`
   (`recordSale` / `recordCorrection` / `recordSubstitution`; also under *Debt → Fiscal*): needs the
   huella-invariance re-run across all three.
7. **Tax-model system — BACK BURNER (no non-Spanish venue in scope; owner 2026-09-07).** Today the `tax` slot in provisioning's territory→module
   registry (`ES-common → {filing:"verifactu", tax:"vat"}`) is an INERT label stamped into
   `nodes.tax_module` and copied at adoption — nothing branches on it. Intended shape: the tax MODEL
   (VAT / GST — calculation, receipt layout, inclusive-vs-exclusive pricing) is GENERIC and lives in
   `core` with helpers; the fiscal module supplies the applicable RATES and the per-jurisdiction
   DISPLAY LABEL (`«IVA»` in Spain, "VAT" in the UK — a locale property; both are the VAT model).
   Prerequisite for a non-ES venue that charges tax; `GB-vat` carries `tax:"none"` until then.
   Surfaced in `2026-09-07-english-only-generic-english-design.md` §4.

**Coordination rules for the parallel sessions** (refreshed 2026-09-08; each paid for already):

- **Concurrency follows measured headroom, never a count** (CLAUDE.md §2, owner 2026-09-06). Before a
  heavy run check free memory and the heaviest processes, then scale to what is free. The one shape
  that caused the 2026-08-30 force-quits was several sessions' browser-mode runs beside a backgrounded
  whole-workspace `pnpm -r test:coverage`. Real-PG suites racing on Docker ports show as `EADDRINUSE`
  and pass on retry — a flake, not a reason to serialise.
- **Whoever lands second rebases — only on a code-file overlap or a GitHub conflict.** A PR that is
  merely `BEHIND` lands as is with `gh pr merge --squash --admin` (CLAUDE.md §6). Module-owned
  migrations are regenerated on rebase per CLAUDE.md §3's recipe.
- **Shared files:** `apps/server/src/boot.ts` (P: config/boot wiring; 1: device/session routes; R:
  promote/rejoin; H: one dep at the `mountPrintApi` call), `CLAUDE.md` (R: §2–§5 — textual rebases),
  `packages/db`'s core schema + migrations (H's print-agent slice regenerates one pair: `print_agents`
  columns, `print_agent_pairing_codes` dropped — CLAUDE.md §3's recipe on rebase), the dashboard
  printers screen (Track 1's app; H edits that one screen + its client/strings for Accept/Deny), and
  this file (each track edits its own items plus this list).
- **Comment thinning on touch only** (CLAUDE.md §1); no sweep in any track.
- **Update this list as items land**, in the same PR.

### Layout designer & device profiles (owner-inserted 2026-09-02) — BUILT; follow-ons open

A visual, HA-Sections-style **canvas editor** with reusable canvases, tills unified into the
enrolled-device model (the fiscal SIF/chain stays on the node — its H2 receipt was signed off at
#199), and a dev-only per-tab device switcher. Design:
[layout-designer-and-device-profiles](superpowers/specs/2026-09-02-layout-designer-and-device-profiles-design.md);
the sub-project specs/plans sit beside it under `2026-09-0{2,3,4,5}-sp-*` and
`2026-09-05-device-profile-design.md`.

**Landed:** SP-A.1 data model #194 · SP-A.2 device unification + hardware #199 · SP-C dev device
switcher #201 (a third `WAITRON_ENV=dev` value = preproduction + `config.devMode`; the
`x-waitron-dev-device` override honoured only under `devMode`; `POST /api/device/reset` devMode-gated)
· SP-B: B1 grid renderer #204, B2.1 tab shell #206, B2.2 heavy-screen wrap #207, B3.1 reassign
plumbing #209, B3.2 profile→canvas rename + the canvas editor #213, B4 old widget model dropped +
`tenant_receipts` #218 · editor polish: fresh-display KDS enrol #221, pointer drag/resize #222,
representative card silhouettes #223 · device profile (`device_profiles`; device → profile → canvas;
capabilities on the profile) #231 + its follow-on batch #234 · fixed dev pairing code `DEMO` #246 ·
`device_kind` gone, kind derives from the profile's `form_factor` #269 (Track B item 7).

**Open follow-ons:**

- **The aggregated device-profile bundle** — relocating till / station / hardware onto the profile and
  adding area / order-routing / printer-target: the larger "profile" the SP-B rename reserved the word
  for.
- **Truly-real card renders in the editor** — needs a neutral browser-safe shared card package both
  apps import (extracting the till widgets off their live stores/props); #223's silhouettes are the
  placeholder. A separate, larger initiative.
- **Visual theme editor** · **NFC pairing runtime + payment routing** (payments-gated on the SumUp
  questions) · **community canvas sharing**.
- **Location-consistency guard** (SP-A.2 follow-up 1): nothing enforces that a sale-capable device's
  register lives in the box's configured location, so a mis-provisioned device could stamp a fiscal
  record's operation description with a different site. Add a guard at enrol or first sale.
- **Recorded, not blocking:** a handheld's Order tab is directly tappable with no active table
  (authored-profile behaviour; revisit if the editor wants a guard); the boot-into-floor prefetch in
  `#onLoggedIn` is unreached by any shipped canvas — add a deletion-proof when the editor lets the owner
  author a non-handheld floor-first canvas; the station screen's own device-mode enrol sub-view is
  unreachable via the app but left in place; the default counter canvas has no prep-queue rail (owner
  shipped as-is — revisit default content separately).

### Waitron module system (2026-09-04) — framework + fiscal exemplar BUILT; follow-ons open

Each domain is an optional, swappable **module** owning its own schema + migrations, replication
classification, UI, vocabulary, theme, privileges and cronjobs, plugged into a generic core that
imports nothing domain-specific (composition-root DI + an open registry set). Architecture:
[module-system-architecture](superpowers/specs/2026-09-04-module-system-architecture-design.md).
**Scope (owner):** framework + fiscal exemplar; extracting the other core-trapped domains
(kitchen/catalogue/tables/…) and the runtime code-distribution mechanism (signed bundles across nodes)
are designed seams, deferred. **Key decisions:** enablement = an on-box `modules.json` reconciled at
boot (default-on; soft-disable keeps data); each node runs its OWN migrations (replication copies rows,
not DDL), with the standby-first migration check (Track A step 5) as the schema-skew guard.

**Landed (each its own spec/plan under `2026-09-0{4,5,6}-module-sp*`):** SP-1a module contract +
migration source #212 · SP-1b enablement + reconcile #215 · SP-1c versioned ordering #217 · SP-1d
adopt-bootstrap of the enabled set #220 · SP-2a package-owned enrolment + the graph-honesty guard #227
· SP-2b schema-version handshake #230 (its park machinery was deleted with the outbox in #280; the
producer `schemaVersionsByModule` survives) · SP-3a fiscal-record lane #238 (its capture DDL deleted in
#280 — fiscal rows now travel by classification with `ENABLE ALWAYS` reject-mutation triggers) · SP-3b
vocabulary #240 · SP-3c gated provisioning + `@waitron/composition` #245 · SP-3d backup/restore hook
(= BR-4) #248 · `fiscal-none` #262 · bookings SP1/SP2 #270/#273 (Track C).

**Open:**

- **SP-4 — module UI surface on the TILL** (card-registry inversion + self-sourcing cards + fiscal's
  cards): unblocked now B3.2 has landed; the dashboard half is done by bookings SP2.
- **Ongoing flow-down of `modules.json`** from a primary to its standby has no channel (the file is
  on-box; only the adopt-time snapshot flows, #220). Bookings (#270) is the first genuinely
  toggleable module, so the live case to design against now exists. The old "pull only your enabled
  modules" source filter is moot — native replication copies by classification.
- **SP-1b (a):** a toggleable module that is actually load-bearing (identity/payments, still statically
  wired) fails boot loudly if disabled, until the wiring inversion + core extraction.
- **SP-1c (b):** provisioning's migrate path still runs the linear full `manifestSets()` — route it
  through the resolver once it gains per-module enablement. (c) folding `requires.core` into
  `requires.modules` was declined (`core` is deliberately the mandatory root).
- **Graph-honesty guard:** its SPI-edge detector matches `EXECUTE FUNCTION sync_capture` specifically
  (`scripts/module-graph-honesty.test.ts` header), and that function no longer exists — generalise it
  to every cross-module `EXECUTE FUNCTION` edge (which would also cover `reject_mutation`) or delete
  the SPI branch. CLAUDE.md §3 records that no module creates a cross-set trigger today.
- **SP-3a (a):** the ~300-line two-clone apply-harness duplication across the `apps/server/src/fiscal-*.test.ts`
  suites → a shared `useFiscalMirrorPair()` helper (kept per-suite so far to avoid a vacuous pass).
- **SP-3c left-behinds:** (a) a `provisionTestVenue(db, overrides)` helper for `apps/server`'s tests
  (sixty-odd suites repeat the same venue request + `applyVenue(planVenue(…))` pair; its own small PR,
  `apps/server/src/testing/` is the home); (b) `tenant.not_found` has no production thrower — keep or
  remove is an owner call; (c) `mirror-bundle.ts`'s `r.series ?? []` branch is un-exercised and
  un-injectable; (d) `packages/verifactu` states the software-id cap as a bare `2` while
  `ID_SISTEMA_MAX_LENGTH` lives in `fiscal-verifactu/src/registro-sif.ts` — export the cap from
  `packages/verifactu` when either is next touched.
- **SP-3d left-behinds (each stated in code or spec):** (a) two restores of one artifact in the same
  second, or on a clock behind the prior restore, compute the same floor (spec §3.5 accepts it); (b)
  the restore is a stopped-server procedure — overlapping a live SIF registration deadlocks (`40P01`);
  revisit locking before the hook runs on a live database; (c) only the last `trading.env.replaced` is
  kept; (d) `wrapHookError` drops the inner error; (e) `restore.test.ts` shares one PGlite across its
  describes and leaves a SIF live; (f) `readStandardSeriesIdTx` filters by tenant while
  `readNodeEndorsement` documents the opposite; (g) `insertNodeSeriesTx`'s held-code check is
  SELECT-then-INSERT; (h) the real-PG e2e reports green without Docker with only a loud skip line.
- **Closed 2026-09-08 (measured):** SP-2a's Option B — `@waitron/sync` depends on no domain package
  now (`peers.ts` and the scrypt coupling went with the outbox).

### Product work still open (beneath the two tracks)

The demo Phase-0/Phase-1 Tier-A/B/C build is finished (git history); what remains is the open
follow-ons and the still-greenfield product features, ranked beneath Tracks 1 and 2. Landed
sub-projects and their state are in *What's built*; the open detail is under *Open threads*.

**Dashboard (cross-cutting):**

- **A notification surface for the dashboard (owner-raised 2026-09-08) — nothing exists today.** The
  dashboard has no way to tell a manager that something happened while they were not looking at the
  screen it happened on. First concrete consumer: "2 devices tried to join in the last 10 minutes"
  when pairing mode is shut
  ([join-and-accept §3.3](superpowers/specs/2026-09-08-device-join-and-accept-design.md)), which
  otherwise renders inline beside the toggle and is invisible from anywhere else. Other obvious
  feeders once it exists: a stalled fiscal outbox or AEAT rejection, a print agent that has stopped
  pulling, a stuck print job past its lease, a failed backup, a standby that has fallen behind, a
  low-stock or purchase-order event. Wants a decision on scope before it is designed — a transient
  toast versus a persisted, per-person read/unread inbox, whether it replicates (a `state` table) or
  is this node's alone (`local`), and whether anything ever pushes rather than polls.

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

**Pricing adjustments (owner-added 2026-09-03):** two related, unbuilt capabilities on the
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

**Bookings (SP14):** Bookings-1 landed (#180, #182) and is now the `@waitron/bookings` module (#270,
#273); future, each greenfield — public/online/QR booking, availability / double-booking prevention,
reminders (SMS/email), a customer/CRM entity, recurring bookings, a calendar grid, deposits.

**Wages / labour cost (SP16, owner-added 2026-09-04):** a **wage-computation engine** that turns
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
  backend change. (Bookings SP2's `getMe` permission set is the first step off the coarse role gate.)
- **Payment-provider config UI** (Stripe / SumUp / …) — none today (provider is env-stamped, sealed via
  the credentials CLI); also gated on the SumUp offline question (*Debt → SumUp*).
- **AEAT cert / Veri*Factu management UI** — first-run only today (`apps/setup` cert screen);
  `cert-expiry.ts` monitors but there is no view/rotate/renew surface. The cert-distribution rebuild
  (Track B item 3) adds the install/replace endpoint this UI would call.

### Parked (real, but beneath the two tracks)

- **Engage a fiscal advisor** — a parallel *human* task (long lead time), not a build; worth starting,
  blocks nothing. See *The advisor gap*.
- **Reporting *fiscal* remainder** — modelo-303 filing boxes (rectificativas 40/41, prorrata 44,
  intra-community 32–39) + two pre-filing caveats: AEAT filing completeness (asesor-gated), not an owner
  takings view. See *Open threads → Reporting*.
- **Printing cloud-poll transports + expo device kind** — subsystem, KDS, receipt + cash-drawer built;
  the rest is post-polish. See *Open threads → Printing*.
- **Cloud trial on-ramp** — gated on Waitron Cloud (the per-tenant instance fleet + control plane),
  which does not exist yet. See *Open threads → Onboarding*.
- **Guided onboarding wizard (four setup modes)** — a non-technical first-run chooser (demo /
  pre-production / production-from-pre-production / add-a-node) + per-mode wizards, wrapping the existing
  dev/demo/provisioning/adopt paths, plus Square/CSV migration as a step. See *Open threads →
  Onboarding*.
- **Recipes → stock → procurement (depth)** — recipe-authoring built; plate costing / stock depletion /
  suppliers/POs is product depth. See *Open threads → Recipes*.
- **Distribution / deployment remainder** — appliance image, on-device agent, the cloud standby's
  live link (Track A step 5 / Track B item 2). See *Open threads → Onboarding* and *SIF topology*.

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
Since 2026-09-05 the hosting shape is a dedicated instance per tenant provisioned by Waitron Cloud (a
separate service); on-prem work is built toward the inventory. Review into real slices when cloud
work starts.

---

## What's built (state per sub-project)

Architecture §2's twenty sub-projects, plus the cross-cutting infra. "Remaining" is the unstarted or
partial scope; the detail for a live thread is under *Open threads*.

| # | Sub-project | State | Remaining |
| --- | --- | --- | --- |
| 1 | Design system | `@waitron/ui` token layer + primitives (`--wt-*`); brand assets (#284) — running-waiter mark, WAiTRON wordmark, lockup, and the favicon/app-icon set all three apps serve from `packages/ui/brand/public` | the till web-app manifest + its 192/512 icons now exist (installable-till + LAN-HTTPS branch), generated by `build-icons.mjs` from the mark |
| 2 | Sales spine | Immutable hash-chained sales, per-tenant series, catalogue, tenant model | — |
| 3 | Fiscal layer | Verifactu lib + `FiscalBackend`; settlement, R5 rectificativas, F3 canje, invoice-first; fiscal is a module (`fiscal-verifactu`, `fiscal-none`) | F3 asesor/XSD confirmations (Debt); cert distribution to a promoted node (Track B item 3) |
| 4 | Payment layer | `PaymentProvider` + Stripe Terminal, manual card, integrated Stripe, Mode-3 webhook | SumUp provider; webhook `recordSale` hand-off; reconcile remediation UI |
| 5 | Identity | persons/sessions, PIN (+ per-device throttle #269), `authorize()`, roles/permissions, passkeys, email login; `persons` + `webauthn_credentials` are `state` (replicate to a standby) | mid-shift-suspension enforce, discount gate, till-refund enforce; encrypt `totp_secret` at rest (a hard dep of the TOTP-enrollment slice — the column replicates) |
| 6 | Locations | provision-a-sellable-venue (`waitron-provision venue`) | multiple locations, edit/deactivate; then location-scope the by-id verb family (Debt) |
| 7 | Counter POS | walk-up cash, park/retrieve, manual + integrated card, prepare & collect, canvas/receipt editors, receipt/drawer printing, cash-drawer authorization — operable end to end | — |
| 8 | Reporting | daily close, frozen *cierre Z*, VAT summary, modelo 303 output+input VAT + DR303 file/download, purchase-invoice UI; dashboard sales screen + business-overview home (#167) | fiscal filing remainder parked |
| 9 | Deployment | distribution & client-topology design (#86); onboarding slices 1–4; till reroute S1–S6; promotion endpoint (#272) | cloud standby live link + Waitron Cloud boundary (Track B item 2); agent/appliance parked |
| 10 | Tabs / table service | TS-1 tables+tabs, TS-2 statuses, TS-3 move/join/merge, TS-4 transfer, till action-flow wiring (#174), TS-5 split-bill (#178, #181) | core COMPLETE; owner-added extensions parked (*Open threads → Table-service*) |
| 11 | Floor plan | FP-1 live floor + FP-2 spatial canvas/editor | — |
| 12 | KDS / devices | KDS-1 stations/routing/tickets, KDS-2 courses/fire, KDS-3 expo, KDS-4 kitchen printing, order-timing alerts (#185); device identity + profiles (#199, #231, #269) | routing audit view; expo device kind; device-scoped fire/collect routes (*Open threads → KDS / Table-service*) |
| 13 | Tips | attribution stored (`tenders.tip_amount`) — but UI collection ONLY on the integrated-card idle screen | tip-collection UI for cash / manual card / handheld (none today, *Debt*); payroll export (integrate-not-build) |
| 14 | Bookings | Bookings-1 (#180, #182), now the `@waitron/bookings` module (#270, #273) | public/online/QR, availability, reminders, CRM, recurring, calendar grid, deposits (Future) |
| 15 | Online ordering | — | not started (Later phase) |
| 16 | Workforce | *registro de jornada* (chain per node since #268), D2 scheduling, roster authoring + approvals, staff request path + portal | **wage-computation engine** (per-person pay rules, accrued-vs-pending — build, convenio-gated; *Wages / labour cost*); D3 payroll export (integrate-not-build) |
| 17 | Accounting export | — | not started (core subset; extends Reporting) |
| 18 | Menu/recipes/allergens | EU-14 allergens, recipe/BOM allergen-inheritance, recipe-authoring UI, product images, location↔menu membership UI (#177), ordering modifiers / option groups (#184), per-option + dish-line quantity (#186), modifier↔allergen overlays (#187), dietary classification (#190), order-line customisation (kitchen-only line note + meat doneness) | **counter/walk-up kitchen fire (#193 follow-up) — NEXT**; menu draft/publish + schedule (#8); customer-facing menu surface parked; post-fire tab-line note/doneness edit parked; nested sub-recipes / plate costing / stock depletion parked |
| 19 | Opening hours & channel sync | — | not started (Google Business Profile / Maps) |
| 20 | Procurement & inventory | received purchase invoices (`@waitron/purchasing`, feeds modelo 303) | suppliers/POs/goods-in/stock/3-way reconcile/reorder (parked); AI forecast deferred |

**Cross-cutting infra:** replication (native Postgres logical replication since #280 — the
application outbox, its HTTP transport, per-peer auth and retention sweep are deleted) · membership +
promotion + rejoin (the whole arc, *Open threads → Replication, membership & failover*) · backup &
restore (BR-1..BR-4) · SIF topology (`#33`, `node_id` re-key) · module system · printing subsystem
(`@waitron/printing` — agents/outbox/ESC/POS builder/Impresoras dashboard — plus
`@waitron/print-agent`, the db-free home the `usb`+`network_tcp` transports moved to) ·
CI/test infra (scoped CI, pre-push hook, shared-container test rollout, job-sharding, root scope) ·
localisation (per-user `persons.locale`, live language switch, venue-default derivation) · logging &
diagnostics foundation (Slice 1 #192).

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

**Slice 2 — one-touch bug report (NEXT).** `bug_reports` table (tenant-scoped, classified `local`
— a report never needs to replicate — with its grants in its module's set, CLAUDE.md §3), a
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

### Replication, membership & failover (state)

**Mechanism (since #280, Track A item 3 step 4):** native Postgres logical replication. Every module
classifies its tables `ledger` / `state` / `local` (CLAUDE.md §3); the table owner
(`waitron_migrator`) creates the `_ledger`/`_state` publications; a standby subscribes over the
box↔cloud link; promotion and return run on `pg_replication_slots` with the fence-LSN drain
watermark; settings are primary-wins by construction (a returned box's `state` publication is never
subscribed during the drain window). The application outbox, its HTTP transport, the config-conflict
gate and the drain/disposal guard are deleted; the 2026-08 sync/cloud-mirror specs record what was
true when written. What CARRIED FORWARD from the cloud-mirror work: the peer identity/auth model
(#144), the outbound link (`@waitron/tunnel`, #150 — retired once the WireGuard link carries
replication, Track A step 5), the mirror-mode server + operator flow (C2a/C2b).

**Membership + promotion + rejoin — the arc is COMPLETE** (spec
[membership-and-rejoin-wire-protocol](superpowers/specs/2026-09-02-membership-and-rejoin-wire-protocol-design.md);
[reserved-standby-identity-and-promotion](superpowers/specs/2026-09-03-reserved-standby-identity-and-promotion-design.md);
[membership-promotion-r3-cloud-promotion](superpowers/specs/2026-09-04-membership-promotion-r3-cloud-promotion-design.md);
[membership-rejoin-r3-wipe-and-restore](superpowers/specs/2026-09-05-membership-rejoin-r3-wipe-and-restore-design.md);
plans beside them): the signed self-verifying document #197 · storage #198 · distribution #202
(the gossip carrier is deleted; a returned box now reconciles via `GET /management-api/membership`
at boot) · setup/adopt trust establishment #203 · promotion R1 term-0 seed + local-secondary mint
#205, R2 dormant identity reserved at adopt #208, R3a own nodeId from join #210, R3b in-process cloud
promotion (term-guarded, PONR in one owner tx, `trading.env` persisted before the PONR) #211 ·
`assertNotFenced` on both promote paths #225 · rejoin R1 fence-on-rejoin #214, R2 drain-as-source #219
(replaced by the fence-LSN watermark), retire/evict #224, wipe-and-restore #237 · conflict surface
#229 (deleted; primary-wins by construction) · the authenticated promote endpoint #272 · till reroute
S1–S6 (Track B item 1). A standby holds its full dormant identity from JOIN (own nodeId + membership
keypair + reserved installation number + disjoint series); promotion never mints a chain.

**Open residuals (each its own slice; the first three are Track B item 3's owed list):**

- **Re-admission `sell-only → serving-secondary`** — the primary-minted un-fence that makes a rejoined
  box sell again (no self-promotion — demote-never-promote). Must retire the node's previous chart
  entry (the `MAX_NODES = 8` growth, Track B item 1 finding (i)) and delete its live `fiscal.aeat`
  row (cert-distribution design §8). A fenced node adopting an un-fencing document today persists it
  without re-promoting in place — fine while no producer emits one.
- **Resume-at-restore marker** — a mid-flow failure AFTER the wipe still needs operator recovery
  (data is safe: drained tail on the carrier + the backup artifact); self-recovery needs a persisted
  wiped-state marker to tell a wiped-mid-restore box from a never-provisioned one.
- **Worker-lifecycle manager** (promote Slice 3) — in-process promotion without the restart; Track B
  item 6 decides restart-always vs manager.
- **Power-loss durability + the selling gate.** `writeFileAtomic` does NOT fsync (`fs-atomic.ts`)
  while the PONR is a durable pg commit, so a power cut between the pre-PONR env write and the commit
  could reboot a box `mode=primary` still carrying the primary's series. Close it by fsync-ing the env
  write (adopt/provision share the helper) or resolving the series at boot — and selling must gate on
  REBOOT COMPLETION (the corrected series in effect), not the PONR commit.
- **Chart hygiene** (Track B item 1 finding (ii)): re-publish the node's own entry at boot so a
  changed `WAITRON_ADVERTISED_ORIGIN` reaches the chart; a promoting node absent from the chart must
  not append itself address-less.
- **Richer daily close** — one close run by the primary across all tills, grouped by till + a venue
  total (cash-up is per-till drawer, VAT is per-NIF; `recordDailyClose` keeps a required node).
- **Mirror fidelity** — `adoptVenue` nulled `locations.catalogue_id` + `tills.receipt_printer_id`
  under the outbox adopt; re-check what the native initial COPY (#280) leaves before building
  anything. **First-contact trust bootstrap** for an untrusted-network primary — gated on real hosting.
- **Carry-ins, accepted or to state in a threat model:** the primary burns an installation número per
  bundle-FETCH (gaps permitted, admin-authed); provision and adopt are assumed mutually exclusive per
  box; `establishNodeIdentity` must run once per node before any document is signed (a re-establish
  orphans signed documents); the membership private key is decryptable by the `app_user` pool (same
  as `fiscal.aeat`); a provision failure AFTER `provision()` mints the tenant/chain is unrecoverable
  → re-image; on the first boot after returning, a node runs as its stale-held-doc primary until the
  membership reconciliation restarts it (bounded, §8.4); restart-based fencing leaves a one-tick
  window in which one more fiscal pass could file on the superseded chain.

### Backup & restore regime — BR-1..BR-4 ALL LANDED; carry-forwards open

Design: [backup-restore-regime](superpowers/specs/2026-09-04-backup-restore-regime-design.md); the
restore hook: [SP-3d design](superpowers/specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md).
**Landed:** BR-1 storage abstraction + fan-out + AES-256-GCM artifact encryption under the operator
recovery key `WAITRON_BACKUP_RECOVERY_KEY` #226 · BR-2 the single encrypted archive (manifest + dump +
media + secrets) and the module `backup` contribution #228 · BR-3 the restore consumer (compatibility
gate, entry-name path-traversal guard, `pg_restore` into a fresh DB, module hooks) #232 · BR-4 = SP-3d
(a filing node's restore mints a fresh chain + disjoint series, identity written last) #248. Rejoin
(#237) composes `validateArtifact` + `writeValidated` around its wipe and keeps its own identity.
The promote-Slice-4 **operator surface** for a cold restore (connection rebinding, advertised origin,
an authenticated entry — SP-3d spec §2) is still open.

**Carry-forwards (named, not gaps):** an abort-aware **per-destination timeout** (lands with the first
network s3/sftp backend); a stale-`.tmp` sweep; confirm the **`StorageBackend` key path-traversal
guard** landed with BR-3's manifest-driven `get(key)` (BR-3 guards entry NAMES; the key guard was a
BR-1 deferral); a working-backup boot success-path integration test; scope the flat `resolvers` map
by module when a second `nonDbState` module lands; a `packArchive` pack-time entries bound; a
manifest-shape coded refusal (fails safe under GCM auth today); generalising archive entry routing
off declared source ids when a second non-DB source lands. The SP-3d left-behinds are on the module
system's list.

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
`docs/superpowers/{specs,plans}/2026-08-17-*` and the failover-printing design. **The agent PROCESS
now EXISTS** — Track H item 1
([2026-09-08-print-agent-process-design.md](superpowers/specs/2026-09-08-print-agent-process-design.md))
LANDED #289: the db-free `@waitron/print-agent` wire client + poll loop, the
`apps/print-agent` container host + LAN setup page, the server knock/status/accept routes, the
dashboard "print agents waiting to join" UI, and an e2e. Enrolment is join-and-accept over the
**shared** `join_requests` table
([2026-09-08-device-join-and-accept-design.md](superpowers/specs/2026-09-08-device-join-and-accept-design.md)
§7) — a second consumer of the device slice #287's mechanism, not the pairing-code enrolment this
spec's §2.3 originally described. Retired: `print_agent_pairing_codes`,
`generateAgentCode`/`enrolAgent`, `POST /print-api/agent/enrol`,
`POST /management-api/print-agents/codes`, and the `agent.pairing_*` error codes. Item 2 is the
virtual PDF printer + `print_jobs` retention (nothing deletes a job today). **Remaining after those:**

- **Cloud-poll transports** — Star CloudPRNT (`printing-cloud-poll-transport*`) and Epson Server Direct
  Print (`printing-epson-server-direct-print*`): a poll→fetch→ack endpoint group off the central outbox,
  token-authed, so a NAT'd printer prints jobs with no agent. (Low priority — single poll URL, no
  firmware failover, but it *does* confirm physical print.)
- **Failover printing** ([design](superpowers/specs/2026-08-26-failover-printing-design.md)) — the
  lease/reclaim for stuck jobs LANDED (#138). Follow-ons: un-pin an IP printer from its single `agent_id`
  (any LAN agent serves; distinct-agents race test + location-scoped-authz review); agents share the
  till's `[local → cloud]` failover list; **a till hosts a print agent** (the majority single-box
  venue's box-death path — high importance, but needs an on-device agent → a native app → **parked
  behind the go-native decision**); at-least-once delivery + active failure escalation at the till/KDS
  (Slice-B). MVP-critical for a cloud primary or a promoted cloud standby (Track B item 5).
- **KDS-4 follow-ups:** **device-mode reprint** (a `POST /api/device/orders/:id/reprint` behind
  `requireDevice`, scoped to the device's bound station); **mirrored station-side read** (spec §5's
  read-only "printers serving this station" view — the backing route exists, only a
  `DashboardApi.listStationPrinters` + UI line are missing); **reprint timestamp** (reprint stamps the
  reprint wall-clock, not the original `ticket_items.fired_at` — thread `fired_at` through).
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

**Order timings — LANDED** (Tier B #9, #185). Deferred follow-ups under *Product work → Ordering*.

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

### Onboarding, cloud trial & distribution (Phase 0 4b/4c COMPLETE; rest parked)

Distribution & client-topology design landed (#86,
[spec](superpowers/specs/2026-08-15-distribution-and-client-topology-design.md)): cloud-hosted is a
**first-class mode**; production uses **Postgres everywhere** (PGlite demoted to dev/test/demo).
Onboarding free-tier slices 1–4 are complete (#137–#166); spec
[appliance-onboarding](superpowers/specs/2026-08-26-appliance-onboarding-design.md). Slice 2b is
venue-only (R1) — the full `instance` role-split is deferred to the appliance image (*Debt →
Provisioning/build*).

**Guided onboarding wizard — four setup modes (owner-added 2026-09-04).** Onboarding today is a
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
   **configuration only** — catalogue/menus, floor plan, staff, devices, canvases, hardware
   bindings, printer/payment config — into a **fresh production DB with a brand-new fiscal chain +
   series**. Needs a defined config **export/import** surface (what copies vs. what is minted fresh);
   H2-adjacent, so specced with the owner, never landed unattended.
4. **Add a node to an existing system** — a second box joins an already-running venue. Maps to the
   **membership adopt** arc (the standby's dormant identity at join, *Replication, membership &
   failover*) plus till reroute (landed). Largely a wizard over infra already built; a second LOCAL box
   is post-MVP.

Plus **data migration from common systems (e.g. Square)** to lower the switching cost for an owner
leaving another POS — this is the existing *Square (and generic CSV) menu import* item
(*Priorities → Tier C*; a one-off import is NOT the cheap seed path, spike 2026-08-29), which the wizard
would surface as an optional step inside modes 2/3. The territory picker `fiscal-none` needs (a
GB/no-regime venue is not wizard-reachable today) belongs in modes 2/3 too.

**Scope to brainstorm when picked up:** the first-run chooser UI (`apps/setup`), the four wizard flows,
the config export/import surface for mode 3 (and its fresh-chain guarantee), how each mode sets
`WAITRON_ENV` / `devMode` / provisioning, and where the Square/CSV importer slots in. Modes 1–2 are
mostly a UX wrapper over built paths; modes 3–4 carry the real new work.

**Constraints for the firmware slices (5–7, parked — AP-mode / OS image / paid real-cert):**

- **A setup box's `/health` returns 503 by design** (no duty loop → not trading-healthy); a
  liveness/supervisor probe must gate on **`/setup-api/status`** (200), or it restart-loops an
  unprovisioned box.
- **The name-constrained-CA model does NOT protect a personal Android phone** (spike RUN 2026-09-08,
  [2026-09-08-lan-https-install-and-name-constraints-spike.md](superpowers/specs/2026-09-08-lan-https-install-and-name-constraints-spike.md)
  §7): a user-installed root is trusted for every name on Android (server-log-confirmed), while desktop
  Chrome and iOS/Safari honour the constraint (§6). Keep the constraint (it helps desktop + iOS), but
  for BYOD Android either accept broad trust in the box CA or use the public-certificate path
  (bring-your-own-domain now, cloud broker later) — an owner call before go-live. The
  SW/PWA/WebAuthn-blocked-until-trusted behaviour (spec §17/§18) and an iOS device are still to measure. The same spike should
  check that Chrome and Safari honour a NAME-CONSTRAINED root, since waiters will install the box's
  CA on their own phones
  ([2026-09-08-handheld-app-store-and-kiosk-findings.md](superpowers/specs/2026-09-08-handheld-app-store-and-kiosk-findings.md) §3).
- **The box image carries the replication cluster settings and the WireGuard link** (Track A step 5):
  `wal_level=logical`, `track_commit_timestamp=on`, `max_slot_wal_keep_size`, the `waitron_repl`
  bootstrap, `pg_hba` admitting it only from the peer's WireGuard address.

**Parked beneath the two tracks (distribution / failover):**

- **Handheld: kiosk mode is optional, never required; most waiters use their own phones** (owner,
  2026-09-08). Baseline = installed home-screen web app + the till's staff PIN. The till now ships a
  **web app manifest** (installable-till + LAN-HTTPS branch: `apps/till/src/manifest.ts` + 192/512 icons),
  and the box serves HTTPS + a plain-HTTP trust/landing page, so the PWA-install step works once the box
  CA is trusted; the on-device Android/iOS install rows remain the owner's to run. Later options, none built: Chromium
  `--kiosk` in the box image (the node as a counter till), Fully Kiosk resale for dedicated tablets
  (check reseller terms), Android Management API enrolment as a Waitron Cloud feature. No app-store
  commission applies to a POS app taking payment for physical goods. Survey + decisions:
  [2026-09-08-handheld-app-store-and-kiosk-findings.md](superpowers/specs/2026-09-08-handheld-app-store-and-kiosk-findings.md).
- **Cloud trial on-ramp** — same-origin PWA pointed at a cloud instance; preproduction, shared demo
  tenant. Gated on Waitron Cloud (a per-tenant instance fleet plus the control plane, Track C item 4).
- **Identity on a standby:** `persons` + `webauthn_credentials` are `state`, so a standby can
  authenticate the venue's people on failover; re-establishment is still **PIN-re-prompt v1** (a
  portable signed token is a later slice). **`totp_secret` at-rest encryption is a hard dependency of
  the TOTP-enrollment slice** (SP5, *Debt*): the (always-NULL today) plaintext column would replicate
  the moment anything writes it, so the enrollment slice must land AES-256-GCM at-rest encryption
  *before* it writes the column.
- **On-device agent** (own spec/spike) — the enabler for a till to host a print agent (a single-box
  venue's only box-death printing path); **requires a native app**, so **parked behind the go-native
  decision**.

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
decided the topology. The
[promotion, failover & node-lifecycle design](superpowers/specs/2026-08-29-promotion-failover-and-node-lifecycle-design.md)
is the first pass over that ground; its §9 lists the then-open items, most now closed by the
membership arc (dated pointers in the spec). The [promotion runbook design](superpowers/specs/2026-08-29-promotion-runbook-design.md)
(APPROVED) is what a human's "make this primary" executes. Landed: `deployment.singleton_role` (#158),
promote Slice 1 local secondary → primary (#160), the singleton duties re-gated on `isSingletonPrimary`
(#168), Slice 2 the authenticated endpoint (#272).

- **Promote-action remaining slices:** **Slice 3** — the worker-lifecycle manager (in-process
  promotion without the restart; Track B item 6 decides whether it is built at all); **Slice 4** — the
  cold-restore operator surface (mechanism landed with SP-3d #248; remaining per its spec §2:
  connection rebinding, advertised origin, an authenticated entry); **Slice 5** — re-admission of a
  rejoined box (*Replication, membership & failover*).
- **Split-brain** — worked through by the 2026-08-29 spec (server-level fencing §3.5, bounded worst
  case §8.4) and the fence-LSN drain (#280); the cloud is now a subscriber and drain carrier, not a
  sink. Remaining seam: the promoted-node side while partitioned (§9.4). Spans selling, the fiscal
  chain, payments (`resolvePending`) and printing — **examine in detail, not scoped to printing**
  (owner, 2026-08-26).
- **The submitter as a relocatable role** — one venue submitter, certificate resolved from wherever it
  runs: this is the cert-distribution rebuild (Track B item 3).
- **Till UX for the timed-out card case** (retry / alternative tender / wait).
- The reconcile remediation UI and the orphan-drift hold (both under *Debt*) back the design's
  double-charge-across-failover path (§10).
- **Odd job:** consolidate the duplicated `boot.*.test.ts` helpers
  (`withCapturedStdout`/`waitForEvent`/`freePort`/`poll`/`seedIdentity`) into a shared
  `apps/server/src/testing/` module (the same home as SP-3c's `provisionTestVenue` helper).

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

## Debt and odd jobs

Deferred follow-ups from finished work. None blocks anything; each makes later work cheaper. Per-slice
UX/perf nits live in the PR threads and git history; what remains here is cross-cutting or
genuinely-decision-bearing.

**Cross-cutting engineering:**

- **Two stale lock-order claims in `apps/server/src/working-order.ts`** (found by the 2026-09-05
  model-seats probe, verified against main): the `unjoinTable` docstring says it "MATCHES the
  sale/settle path and mergeTabs" — true today, but a twin to keep in step; and the `mergeTabs`
  docstring says the `dining_tables` lock "seq-scans" because `tab_id` is unindexed — `EXPLAIN` as
  `app_user` shows `LockRows → Sort → Bitmap Heap Scan` on the tenant index, so the mechanism claim is
  false (the conclusion, identical order for both backends, is not re-proven either way). Thin both on
  next touch (§1: state what is measured).
- **`report-api.ts` runs three concurrent queries on ONE `withTenant` transaction**
  (`Promise.all([computeDailyClose(tx), computeTopSellers(tx), countOpenTables(tx)])`, also
  `daily-close`). pg@8 queues them (serial, correct, no speedup, a deprecation warning); it BREAKS in
  pg@9. Replace with sequential awaits or one combined query before pg@9 lands.
- **Handheld live updates (SSE/WebSocket).** Deferred from the order-only handheld slice (#173, owner,
  2026-08-30). The app is pull-only today (refetch after each round/serve/fire + manual refresh), so two
  waiters on the same table see stale data until a refetch (the server still guards append-only rounds +
  price-locks). A live push channel — the first real-time in the app — gives live multi-waiter +
  KDS-status-to-handheld updates. Sizable new subsystem, out of step with the pull-only architecture;
  specced separately when it matters.
- **Configurable per-device layout / face-set editor.** Deferred from the same slice. The handheld ships
  a fixed phone face-set as a declarative constant (`HANDHELD_FACES`); the owner wants this configurable
  long-term. Additive (pre-production): persist a face-set per device profile with a fallback to the
  constant, add a dashboard editor mirroring the canvas editor, and — the heavier, separable half — make
  the **table-order screen itself** canvas-driven the way the counter screen already is.
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
  (`apps/dashboard/src/i18n/t.ts` + `#venueLocale`) still needs the same flip the till got in #170
  (check whether the dashboard money formatter has the same "doesn't follow the UI locale" bug).
- **till-api's bare `c.req.json()` sites still 500 on a malformed body.** #145 converted the `?? {}`
  sites across ten route files to the shared `readJsonBody` helper. **Left:** till-api's ~19 **bare**
  `await c.req.json<T>()` sites (no `?? {}`), on the sale/pay critical path — each needs per-route
  validation tracing before adopting the helper. The till **PIN-login** (`POST /api/session`) is the twin
  of the management login #145 hardened (a `null`/malformed body → opaque 500 instead of a clean 401).
  `setup-api` uses a different-contract defensive form and is correctly left as-is.
- **Encrypt `totp_secret` at rest** (SP5). Stored plaintext today and `app_user` holds SELECT on
  `persons`, so a `persons` leak exposes every enrolled second factor. Latent (nothing writes it yet).
  The enrollment slice must encrypt via the credentials vault (AES-256-GCM), decrypting on the box before
  `verifyTotp` (keeps the offline-verifiable property).
- **Location-scope the by-id verb family together** (SP6). `getHeldOrder`/`updateHeldOrder`/
  `abandonHeldOrder` and `updateTable`/`deactivateTable`/`openTab` address by tenant + id; only
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
  folds in the `fechaFromStoredDay` algebra and `recordSubstitution`'s N+1 loop. (Track C item 6.)
- **Concurrent-corrective race in `settleSale` is untranslated.** If a rectificativa commits between the
  opening read and the `sale_settlements` INSERT, the coverage trigger raises a raw `P0001` that
  `settleSale` does not map to a `sale.*` code. Fail-closed and unreachable in the headless slice (needs
  the till UI to interleave). Fix when reachable: give the trigger a dedicated SQLSTATE and translate it.
- **F3 canje open questions (asesor/XSD)** — the foreign `IDOtro` recipient path is refused pending the
  asesor's `IDType` shape; whether a separate F3 series is mandatory (reuses `standard` today); cross-SIF
  F3 is a sound inference not confirmed; `Destinatarios` XSD confirmation before the first real filing.

**Provisioning / build:**

- **The `tenant` command is unplanned.** Its idempotency check should attempt the insert and catch the
  unique-violation rather than look up `tenants` by NIF first (a read-then-write is the race, and with
  one tenant per database the guard is really `assertNoForeignTenant`).
- **Credential READ path doesn't `validatePayload`.** `getCredential`/`tryGetCredential`
  (`packages/credentials/src/store.ts`) run the shape guard but not `validatePayload`, so a row sealed
  under an older `PURPOSES` field-list returns a missing field as `undefined` rather than being rejected —
  a fail-loudly-vs-keep-serving call to settle before the first consumer relies on it. Plus four carried
  from [#11]: password redaction in `applyInstance` is listed-not-structural; `bin.ts`'s `ask()` is
  coverage-excluded logic; `ApplyDeps` and the action list are two sources of truth for the database name.
- **Onboarding slice-2a follow-ups** (from #141, none blocking): **(a) DONE** (installable-till + LAN-HTTPS branch) —
  the box CA now carries a critical `nameConstraints` (permitted `waitron.local` + `localhost` + the RFC1918
  ranges + loopback) and `pathLen:0`; the leaf's IP SANs are filtered to that permitted set at mint, so an
  out-of-set interface address (Tailscale `100.64/10`, link-local `169.254`, a public IP) is dropped rather
  than invalidating the whole cert. Not honoured on Android user roots (spike §7); kept for desktop/iOS.
  **(b)** `apps/server/src/self-signed-cert.ts` and the test-only `testing/tls.ts` both define
  near-identical `CertExtension` + `certificate()` node-forge builders (already drifted; and the fiscal
  module now carries a third byte-copy, Track C item 2) — extract the shared builder into one internal
  module (its own PR — touches the mtls fixture); **(c)** the leaf's validity window is stamped from
  `now` with 1 day back-slack, so a box that mints its cert **before NTP sync** (no RTC) persists a
  wrong window and there is no renewal in 2a — ties to the time-health check + cert renewal (slice 3/4).
- **Onboarding slice-2b follow-ups** (from #142, none blocking): **(d)** a DB-level advisory lock (keyed
  on `tenantId`, spanning guard→stamp→`applyVenue`) would make `provisionVenue` safe regardless of caller
  (defence-in-depth over today's in-process latch); **(e)** a `sealAeat`/`persistTrading` I/O failure
  *after* `provisionVenue` succeeds wedges the box (tenant minted, no `trading.env`) — add a recovery path
  (detect "DB provisioned but no `trading.env`" and offer re-derive+restart, and/or make the wedge loud);
  **(f)** the **trading-branch** `closePools` (`boot.ts`) closes its pools (`db`, `replicationDb`,
  `backupDb`) sequentially — a throw from the first skips the rest — extract one `closeAll(pools)`;
  **(g) R1 owner-connection:** 2b runs provisioning over `config.migrationsDatabaseUrl`, correct only
  because dev's superuser owns the tables — on a real role-split appliance the setup-mode owner
  connection must be the migrator role (`withRole(uri, waitron_migrator)`, CLAUDE.md §3), and a
  wizard-only box persists that connection as `trading.env`'s `DATABASE_URL`, so it runs its trading
  life on the owner role (not least-priv `app_user`) until that retrofit.

**Payments:**

- **Webhook `recordSale` sale-chaining hand-off** — the Mode-3 inbound Stripe webhook's security half is
  done; chaining a settled webhook into a sale needed the till/working-orders model (now exists).
- Pre-existing `forward` retry backoff; the reconcile remediation UI (also a SIF-failover backstop).
- **Stripe is unprovisioned for the deli** — the code is verified against a live sandbox, but no real
  account exists yet.

**SumUp:**

- **Four unverified questions, one design-invalidating**
  ([sumup provider spec](superpowers/specs/2026-07-30-sumup-card-present-provider-design.md) §7;
  the send-ready form is [research/2026-09-08-sumup-questions.md](research/2026-09-08-sumup-questions.md),
  **SENT 2026-09-08, awaiting reply**), wanted **before** the SumUp provider is built. The decisive one: **does the reader still work
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

- **`test-heavy` and `test-server` are sharded three ways** (#216; mechanism in CLAUDE.md §2). Vitest
  `--shard` splits by FILE COUNT, not duration, so imbalance is the real limit; bumping the matrix means
  changing `shard: [1..N]` AND the `--shard=i/N` denominator together, with N at or below the package's
  test-file count (an empty shard exits 1).
- **Job-sharding — remaining lever.** The next critical-path candidate is `mutation-verifactu`
  (~218s, one free 4-vCPU runner); split it if a run shows it dominating. Rebalance the
  `LIGHT_A/B_PACKAGES` bins (`scripts/changed-scope.mjs`) when a run shows one light shard dominating —
  the recurring Bookings hangs are addressed by the dedicated job in `test-load` (Track C item 3).
- **The pre-push hook's shell is largely untested** (the deletion guard + range computation are backed
  only by running the real hook); **`test-light` reports `success` without naming what it ran** (make the
  job name its selected packages); **`packages/ui` can hang the `test-ui` shard** (unconfirmed cause — if
  it recurs, per-test timeout + Playwright trace). The classifier's fourth output line `root=` is emitted
  and read by no consumer (the hook routes on `scope=root`).

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
  one-tenant-per-database design.
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
`docs/superpowers/plans/2026-08-19-shared-test-container.md`. A two-node replication suite uses
`packages/db/src/testing/two-node.ts`, or `two-node-wireguard.ts` when the link itself is under test.

**Dev stack from a worktree.** `wa-wt <worktree-name>` / `wa-wt reset [name]` — the rule is in
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
