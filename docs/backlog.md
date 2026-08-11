# Backlog — what is in flight, what is next, and why

**Last reprioritised: 2026-08-02.** This file is the answer to "what should I work on?". It is
committed rather than held in a session's memory so that it can be diffed, reviewed, and checked
against the tree — memory notes drift, and several currently point at pull request numbers that no
longer exist (the repository was recreated for the licence change and numbering restarted at #1).

Two companion documents, deliberately not duplicated here:

- **[compliance/action-plan.md](compliance/action-plan.md)** — the legal and administrative track:
  certificates, company formation, the declaración responsable. **The deli must be filing by
  1 January 2027.**
- **[superpowers/specs/2026-07-18-pos-architecture-design.md](superpowers/specs/2026-07-18-pos-architecture-design.md)
  §2** — the twenty numbered sub-projects. That table is the strategy and does not change often.
  This file is the current state and changes constantly.

**Docs land direct to `main` (2026-08-02):** the `main protection` ruleset grants the Repository-admin
role a bypass (mode "always"), so a docs-only change can be pushed straight to `main` — no PR, no CI
wait. Branch, `commit -s`, fast-forward `main`, push. Reserve it for docs; feature/code still goes
through a PR (where CI + Copilot run). The other rules (no force-push, no deletion) still apply.

## Current direction

**Reprioritised 2026-08-07 — Menu & allergens (18) and the reporting *cierre Z* (8), in parallel.**

The fiscal-first ordering has done its job. The **fiscal sequence** is complete (settlement #39,
rectificativas #46, F3 canje #51, invoice-first #55), the **SIF topology** is settled (#33, `node_id`
re-key #54), and the **operable Counter POS** is built end to end — walk-up cash #60,
park/retrieve #61, manual card #62, prepare & collect #63, integrated Stripe card #64. A person can
ring up a
sandwich, hold an order, take cash or card, and hand over a legal Veri\*Factu ticket. The invoicing
model the till builds against is no longer moving, and the unrepairable fiscal work — hash-chained
records, never-reused invoice numbers — is done, which is where care paid best.

With both the fiscal story and the operable till complete, the owner chose the next two slices, and
**both have now landed their first cut** (2026-08-07):

- **Menu & allergens (sub-project 18)** — a launch-day legal duty (EU 1169/2011, RD 126/2015).
  **Slice 1 (EU-14 allergen declaration end-to-end) LANDED as #65.** Recipes/BOM (the linchpin),
  variants, and customer-facing browse are the unstarted remainder; the allergen list stays a
  food-safety-advisor call.
- **Reporting — *cierre Z* (sub-project 8)** — the frozen/signed daily close (numbered, immutable,
  counted-cash / opening float / *descuadre*). `computeDailyClose` (#56) deliberately left the seam,
  and it is now filled: **8a VAT-exact close LANDED as #66, 8b frozen cierre Z LANDED as #68.** The
  unstarted reporting remainder (date ranges, *modelo 303*, the reporting UI) is under *Not started*.

The two ran in parallel at the feature level without incident: the anticipated
`packages/db/drizzle/meta/_journal.json` collision was avoided by sequencing the migrations
(0031 allergens → 0032 8a → 0033 8b) as each branch landed. The **management dashboard** slice-1 auth
floor is now **COMPLETE** — 1d (passkeys) LANDED as #71, so all four sub-slices are in; the
**autonomous campaign** (below) is the active focus.

**Management dashboard added 2026-08-07 (building).** The owner's off-premises management console —
designed and fully planned this session
([spec](superpowers/specs/2026-08-07-management-dashboard-design.md); plans
[1a](superpowers/plans/2026-08-07-dashboard-slice1a-identity-auth-foundation.md),
[1b](superpowers/plans/2026-08-07-dashboard-slice1b-server-management-api.md),
[1c](superpowers/plans/2026-08-07-dashboard-slice1c-dashboard-app.md),
[1d](superpowers/plans/2026-08-07-dashboard-slice1d-passkeys.md)). It is a **local-server app**
(`apps/dashboard`) consuming the existing headless APIs, with **remote access decoupled as a pluggable
transport** (tunnel-first, snitun-pattern reimplemented in Node; Spain-hosted cloud removes ROF art.
22.2). Slice 1 = staff admin + an offline-verifiable **passkey / password+TOTP** auth floor, delivered
as four sub-slices (identity → server API → dashboard app → passkeys). **1a (identity auth foundation)
LANDED as #67** (2026-08-07): the `management_sessions` table with FORCE RLS, the password/TOTP
credentials + verifier seam (`loginManager`/`authorizeManager`, passkey plugs in at 1d), the session
lifecycle (idle timeout + mid-session `persons.status` re-check), the staff mutations repointed off
till sessions, and a `person.manage`-gated `listPersons` — `@waitron/identity` at 100% coverage.
**1b (server management API) LANDED as #69** (2026-08-08): the slice-1a auth exposed over HTTP as a
`/management-api/*` Hono route group on `apps/server` (a `waitron_management_session` cookie,
login/logout, `person.manage`-gated staff CRUD), plus `setPassword` in `@waitron/identity`. **1c (the
dashboard app) LANDED as #70** (2026-08-08): `apps/dashboard`, a Lit/Vite browser console — a boot
session probe → login (roster + password + optional TOTP) or the staff screen (list + create person),
on `@waitron/ui` primitives with a11y in both themes, plus its own Chromium CI shard. **1d (passkeys)
LANDED as #71** (2026-08-08): WebAuthn as the phishing-resistant primary login — two FORCE-RLS tables
(`webauthn_credentials`/`webauthn_challenges`), the `@simplewebauthn/server` v13 ceremonies plugged
into the 1a verifier seam (auth gates on `person.suspended` like `loginManager`), four
`/management-api/passkey/*` routes (register GATED, auth UNGATED), and the `@simplewebauthn/browser`
UI. Challenges are single-use (consume-first locking `DELETE`) + TTL-bounded; only the public key +
a monotonic counter are stored; Copilot's two concurrency findings (single-use race + counter
regression) were fixed with a real-PG concurrency test. **Slice 1 (the auth floor) is now COMPLETE.**
Slice-1a/1b/1c/1d follow-ups are under *Debt and odd jobs*; the first-admin-password provisioning gap
that blocked a true first login is now **CLOSED (#72)** — `venue` seeds the admin's dashboard password.

**Prioritisation is by soundness, not the calendar (decided 2026-08-02).** Waitron will be finished
before the deli is ready to trade, so the deli's 1-Jan-2027 legal deadline is *not* a reason to rank
one piece of work above another — order by dependency, correctness, and de-risking the most-reused /
most-uncertain foundations first.

**Autonomous campaign armed (2026-08-08).** While the owner is away (Sun 2026-08-09 → Fri 2026-08-14;
the weekly quota renews Tue 01:00) an unattended launchd-driven run works an ordered, pre-specced
queue — **sync slice 1** (commercial outbox, **LANDED #74**), **reporting** (date-range + *modelo 303*), the
**catalogue / menu management UI** (with product images), the **layout & receipt editors**, and
interleaved small follow-ups — each via `finish-branch` → `land-branch`. The plan, ordered queue, and
guardrails (never auto-land the unrepairable fiscal core; never land on a red gate; one item in flight
at a time) are recorded in
[superpowers/specs/2026-08-08-autonomous-campaign-plan.md](superpowers/specs/2026-08-08-autonomous-campaign-plan.md);
the per-item specs/plans are dated `2026-08-08`. Landed items move to *Recently shipped* as the run
merges them; anything it cannot safely finish is left as an open PR marked `blocked` or
`needs-owner-review`.

---

## Now

| What | State |
| --- | --- |
| **Management dashboard** — owner's off-premises console | **Slice 1 COMPLETE — 1a (#67) + 1b (#69) + 1c (#70) + 1d (passkeys, #71) all LANDED.** The auth floor (staff admin + passkey / password+TOTP login) is done; **remote-access transport** (tunnel/snitun-pattern) is a future slice. Slice-1a/1b/1c/1d follow-ups under *Debt and odd jobs* — the biggest, **1c row-edit actions, LANDED (#73)**, so the dashboard now manages staff (role/suspend/reactivate/PIN/password), not only list+create; the first-admin-password provisioning gap is now **CLOSED (#72)**, so a real first dashboard login works |

---

## Recently shipped

One line per landed PR, newest first. The git log, the linked designs/plans, and the
[architecture design](superpowers/specs/2026-07-18-pos-architecture-design.md) §2 table hold the
detail — **this file is not a history** (see *How to keep this file honest*). Open follow-ups from
these live under *Debt and odd jobs*; their designs/plans stay in `docs/superpowers/`.

- **#74** Sync slice 1 — commercial-lane outbox — a new `@waitron/sync` package: a `sync_log` outbox fed by a generic `sync_capture` AFTER-trigger on all 14 commercial-lane tables (sales/lines/tenders/settlements/substitutions/voids, payments/refunds/policy, catalogues/categories/products, working-orders/lines), an **idempotent, seq-ordered apply loop** (whole-row `jsonb_populate_record` restore bound as `$1`; `ON CONFLICT` non-regression; 23503 FK-deferral; an **environment handshake** that reads `deployment.environment` and refuses to cross it), bounded **retention** (`pruneSyncLog` holds the log at the slowest subscriber's cursor — `min(last_applied_seq)` across ALL `sync_cursor` rows, alive **or** down, per origin) and per-`(subscriber, origin)` **lag** reporting, plus origin attribution via an **additive** `withTenant(…, { nodeId })` threaded through the server working-order write paths. Migrations 0000 (`sync_log`/`sync_cursor` FORCE-RLS + per-tenant policy + `sync_tailer`) and 0001 (a dedicated `sync_retention` role + whole-log permissive policy — a per-tenant tailer cannot prune cross-tenant). **The fiscal-lane boundary is HARD and was respected (H2):** commercial tables only; the fiscal `registros`/hash-chain lane is a separate owner-reviewed slice. Reviews: the finish-branch two-lens pass fixed a false "`sync_tailer` sees unfiltered" claim (§1) and **documented, for the owner, two transport-slice constraints** — business-rule BEFORE triggers fire un-gated on the apply path (a redelivery-wedge that cannot occur in this single-batch slice) and the all-zero default `origin_id` shared across sources; **Copilot** caught a false `to_jsonb`-keeps-numeric-as-a-JSON-string migration comment (verified on postgres:18-alpine it is a JSON **number**; the `jsonb_populate_record` round-trip preserves `1.50::numeric` byte-for-byte) and a `lag` `Number()`→`bigint` precision loss past 2^53−1 — both fixed (TDD), replied on-thread, resolved. sync **91 tests @ 100%**. **Campaign queue item #1**, landed this session. The transport/network layer, redelivery handling, and fiscal-lane sync remain (see *SIF topology follow-ups*).
- **#73** Dashboard slice 1c — staff row-edit actions — wires the staff list's per-row "Editar" (a live-but-unheard `edit-person` seam since #70) to the four existing slice-1b mutations via a new `<dashboard-person-edit>` dialog: role change, suspend/reactivate, reset-PIN, set-password, each committed **independently** (a role change never forces a PIN retype). The screen turns each bubbling/composed domain event into the matching `DashboardApi` call, reloads, and re-resolves the open dialog's person from the fresh list; a shared single-flight guard drops a re-fired action; secrets are masked (`type=password`) and reset on close. **Browser-only** — `@waitron/identity`/`apps/server` unchanged. The role `<select>` is reconciled to state in `updated()`: a `.value` bound before its options fails a non-default preset (the backlog's latent-picker bug) and a `?selected` attribute keeps a dirtied pick after a revert-on-close+reopen — **both failure modes proven by deletion**. The finish-branch two-lens review (fresh-context reviewer verified findings empirically vs real Lit 3 in Chromium) caught the select reopen-desync + an error banner rendered **behind** the modal backdrop (now surfaced inside the dialog's own top layer) + plaintext secret fields (now masked) + a false "Escape/backdrop" comment (`wt-dialog` has no backdrop light-dismiss). **Copilot** caught three more, all the same stale-claim class the `?selected`→`updated()` swap introduced (`editingPerson` not cleared on close → invariant false + latent stale-id; a stale preset-test comment) — all fixed, replied on-thread, resolved. Dashboard suite 100 tests @ **100/98.9/100/100**, axe clean both themes. **Campaign queue item #10**, landed this session (subagents used for the two reviews; build inline). Deferred edges under *Debt* below.
- **#72** First venue admin's initial dashboard password — `waitron-provision venue` now seeds the first admin's dashboard **password** (`persons.password_hash`) alongside the till PIN, closing the bootstrap deadlock where a first management-dashboard login was impossible (every credential path except the provisioning seed — `setPassword`, passkey enrollment — is gated on an already-authenticated session). The password is read from `WAITRON_ADMIN_PASSWORD` (env or echo-off prompt, never argv), validated `assertPasswordLength` ≥8, and hashed at the CLI boundary; threaded `VenueRequest.admin` → `seed-admin` action → the `applyVenue` insert, mirroring the PIN. **No schema migration** (the nullable `persons.password_hash` column already existed) and **no grant change** (`applyVenue` runs as the table owner). A gap-closing e2e proves `loginManager` succeeds after `venue` under `app_user`+RLS (and by deletion). Both runbooks corrected (document `WAITRON_ADMIN_PASSWORD`, list all five secrets, fix the stale worked example that omitted `--admin-name`/the PIN env var). Making the field required broke 10 `apps/server` `VenueRequest` consumers (4 demos + 6 tests) — caught by the pre-push gate (the plan enumerated the provisioning fixtures but missed the cross-package ones), all fixed. Copilot: run the e2e login under the app role. Owner decisions: password required; no force-change-on-first-login. (SDD executed inline — the account's weekly limit blocked subagents mid-run.)
- **#71** Dashboard slice 1d — passkeys (WebAuthn) — the final auth-floor sub-slice: passkeys as the phishing-resistant primary management-dashboard login, plugged into the slice-1a verifier seam. `@waitron/identity` gains two tenant-scoped **FORCE-RLS** tables (`webauthn_credentials`/`webauthn_challenges`; 0007 tables / 0008 hand-written RLS) and the `@simplewebauthn/server` v13 ceremonies (register + auth; auth ends in `startManagementSession` and gates on `person.suspended` like `loginManager`); `apps/server` gains config (`WAITRON_MANAGEMENT_RP_ID`/`_ORIGIN`) + four `/management-api/passkey/*` routes (**register GATED, auth UNGATED**, auth/verify sets the cookie); `apps/dashboard` gains four client methods + `@simplewebauthn/browser` v13 ("Entrar con passkey" / "Añadir passkey"). Only the public key + counter are stored (never a private key); challenges are single-use + `CHALLENGE_TTL_MS`-bounded. Whole-branch review twin-caught a suspended-person auth gap + an unauthenticated-500 behind a false "library maps codes" comment; the finish-branch two-lens review caught three §1 comment overstatements (incl. a "swept" claim the simplify pass left in the sibling migration); **Copilot caught two real concurrency findings** — challenge single-use under concurrency (fixed with a consume-first locking `DELETE … RETURNING` + a deterministic real-PG lock-timeout test) and a counter that could REGRESS under concurrent logins (fixed with a monotonic `counter < newCounter` guard, weakening clone detection). identity 125 tests @ 100%. The crypto is verify-mocked in unit/route tests — a real-ceremony virtual-authenticator test is a follow-up (below).
- **#70** Dashboard slice 1c — dashboard app — `apps/dashboard`, a browser management console (Lit 3 + Vite 6 + Vitest browser-mode/Playwright-Chromium) consuming slice-1b's `/management-api/*`: a `DashboardApi` client (browser-local types, paths/verbs matched exactly to the routes), a boot session probe → login screen (roster + password + optional TOTP → `logged-in`) / staff screen (list + create dialog → `createPerson` → reload) + logout, all wrapped so no async path is an unhandled rejection; built on `@waitron/ui` primitives + `var(--wt-*)` tokens with an axe `.a11y.test.ts` per screen in both themes; its own `test-dashboard` Chromium CI shard (wired into the `ci` aggregate). All source files 100% coverage. Whole-branch review caught a create-dialog reopen bug; the finish-branch two-lens review twin-caught a create-form-not-reset bug (duplicate/reused-PIN hazard) + added a create single-flight guard. Headless server backend is 1b; UI actions for row-edit are a fast-follow (see below).
- **#69** Dashboard slice 1b — server management API — the slice-1a identity auth exposed over HTTP as a `/management-api/*` Hono route group on `apps/server` mirroring `mountTillApi`: a `waitron_management_session` cookie (httpOnly / SameSite=Strict / Secure-iff-TLS), login/logout, and `person.manage`-gated staff CRUD (list/create/patch/reset-pin/set-password), plus `setPassword` in `@waitron/identity` (an admin grants dashboard access). New `management.request_invalid` body-shape code; every handler scoped to the one venue tenant via `withTenant` + `asAppUser`. Real-PG e2e incl. a **differential** cross-tenant isolation proof (fails if `asAppUser` is dropped) + refusal proofs (unauth 401, wrong-password 401 + no cookie, staff-role 403). Finish-branch fixed a null/non-object-body → 500 class (now the routes' own 4xx), the PATCH type-screening gap (`role`/`status` now 400 not pgEnum-500) + its false errors.ts doc, and three overstating comments; a Copilot NIF-collision flag was verified a **false positive** (one PG container per file → isolated DBs). Headless — the UI is 1c.
- **#68** Frozen *cierre Z* (sub-project 8, slice 8b) — immutable numbered `daily_closes` (0033, the immutability recipe: `REVOKE ALL` + `GRANT SELECT,INSERT` + append-only/anti-TRUNCATE triggers + FORCE RLS + tenant policy) freezing a snapshot of the derived close, a per-node `daily_close_chain` head that `recordDailyClose` advances in the **same transaction** as the close (single-active-writer `FOR UPDATE`, `UNIQUE(scope, sequence_no)` backstop), per-till counted-cash vs expected reconciliation → `cash_variance` (*descuadre*), and `verifyDailyCloseChain` which re-walks a `(tenant, node)` chain reporting the first break (`sequence`/`genesis`/`broken_link`/`hash_mismatch`/`tail_truncation`/`missing_head`). Headless; English schema tokens (`daily_closes`/`cash_variance`/`entry_hash`), Spanish *cierre Z*/*descuadre* UI-only. Copilot caught a tamper-detection gap in review — a deleted chain head with surviving closes read as `ok:true`; now caught as `missing_head`, proven by deletion in a real-PG test.
- **#66** VAT-exact daily close (sub-project 8, slice 8a) — `sales.vat_breakdown jsonb NOT NULL` (0032) written from the *same* variable each sale-creating backend files (one source, cannot diverge from the huella); `computeVatSummary` reads it (`cross join lateral`, rate normalised as `numeric(5,2)::text`) so the daily close is exact per-rate for catalogue difference-method sales. No `computeHuella` change. Prerequisite for the frozen cierre Z (8b).
- **#65** Menu & allergens (sub-project 18, slice 1) — EU-14 allergen declaration end-to-end: taxonomy + `validateAllergens` + `allergen.*` codes (`@waitron/catalogue`), a nullable `products.allergens jsonb` (0031), catalogue-ops threading, `/api/products` + `TillProduct` exposure, en/es names, a till **allergen screen** (matrix + operator lookup + print) with the `null`=PENDING-never-allergen-free invariant, and a demo. Legal basis (RD 126/2015 Art. 6.5) verified on primary source. Deferred: a `@media print` stylesheet so Print isolates the allergen sheet (convenience-only). Further sub-project-18 scope (recipes/BOM, variants, customer-facing browse) not started.
- **#64** Counter POS — integrated card terminal (Stripe Terminal / Tap-to-Pay): split-transaction pay (collect outside the fiscal tx), working-order-derived capture idempotency + lost-response recovery, `POST /api/pay`.
- **#63** Counter POS 7c — prepare & collect: line-add price-snapshot lock, placing, per-location pay-timing (prepay / invoice-first / ticket-then-pay), amendment log, prep surface.
- **#62** Counter POS — manual (*datáfono*) card tender + captured `payments` row.
- **#61** Counter POS 7b — park & retrieve across registers + sale idempotency.
- **#60** Counter POS 7a — walk-up cash sale; new `@waitron/till` + the server till API.
- **#59** Catalogue — priced products (gross-inclusive, difference-method VAT).
- **#58** Identity — headless first slice (persons/sessions, PIN login, `authorize()`).
- **#57** Locations — provision a sellable venue (country/territory fiscal identity, `waitron-provision venue`).
- **#56** Reporting — daily-close first slice (`computeDailyClose`).
- **#55** Invoice-first settlement — headless remainder (settle a corrected invoice-first sale).
- **#54** `node_id` re-key — SIF / chain / series keyed to `nodes`, not `till_id`.
- **#52** Workforce floor — four review-fix corrections (UTC render, tamper-chain gaps, clock TOCTOU).
- **#51** F3 canje — "can I have a proper invoice?" (`recordSubstitution`).
- **#50** Workforce D2 — scheduling (rosters, guardrails, planned-vs-actual).
- **#49** Payments — Mode 3 inbound Stripe webhook (security half).
- **#47** Workforce — *registro de jornada* legal floor.
- **#46** Rectificativas — R5 corrective invoices.
- **#39** Sale settlement model — tip/amount off the frozen sale, `settleSale`.
- **#37** Fiscal Q13/Q15 closed on primary source.
- **#33** Local server as SIF, active-active + failover (topology only; buildable pieces under *SIF topology follow-ups*).
- **#31** Scoped pre-push hook · **#27 / #25** Scoped CI · **#23** Pre-push skips deletions · **#32** CI scope fail-open fix.
- **#22 / #19** Cloud storage model · **#21** This backlog · **#20** Sale settlement design.
- Plus provisioning / CI / docs PRs (e.g. #11, #16, #35, #44) — the git log is the full record.

**The fiscal sequence is complete** — its four pieces (#39 settlement, #46 rectificativas, #51 F3
canje, #55 invoice-first) are all above. They were sequenced rather than parallelised
because each adds a `packages/db` migration and `packages/db/drizzle/meta/_journal.json` conflicts on
every concurrent branch touching that package (the collision is per-package; five packages carry their
own `drizzle/`). Designs and sources:
[settlement](superpowers/specs/2026-07-31-sale-settlement-model-design.md) §8,
[verifactu-findings](compliance/verifactu-findings.md) §§7-10,
[invoice-first](superpowers/specs/2026-08-03-invoice-first-settlement-design.md).

---

## SIF topology follow-ups (from #33)

The [server-as-SIF + failover design](superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md)
decided the **topology only**; its §14 defers the buildable pieces, each to its own spec:

- **The sync / replication protocol** between the two local servers and the cloud mirror — the
  largest unbuilt piece. **Designed and reviewed**
  ([spec](superpowers/specs/2026-08-02-app-level-sync-design.md)); the mechanism is decided:
  cross-replication is **application-level** (an outbox — `sync_log` + a generic capture trigger,
  apply as the app role under `withTenant`), **not** native Postgres logical replication, which
  categorically refuses to write into an RLS-enabled table under a non-BYPASSRLS role (proven on real
  Postgres — [findings](superpowers/specs/2026-08-02-replication-force-rls-prototype-findings.md)).
  Its **9 container gates RAN 2026-08-06 — all pass, outbox validated with no new privilege**
  ([findings](superpowers/specs/2026-08-06-sync-container-gates-findings.md)). Owner decisions:
  explicit `server_id` on the commercial tables, **true active-active** for the deli, a **payments
  fast lane** — with `envios`/`acks` ordered-lane-only (no monotonic column). The `node_id` re-key it
  depended on landed (#54), so the columns already exist. **Slice 1 — the commercial-lane outbox
  (capture triggers + idempotent seq-ordered apply + bounded retention/lag + origin attribution) —
  LANDED as #74** (2026-08-11, `@waitron/sync`). What remains: the **transport/network layer** that
  moves batches between nodes; **redelivery handling** (this slice's `applyBatch` is single-batch, so
  the un-gated business-rule BEFORE triggers on the apply path and the shared all-zero default
  `origin_id` are documented transport-slice constraints, not bugs here); and the **fiscal-lane sync**
  (the `registros`/hash-chain lane, a separate owner-reviewed slice — H2, deliberately excluded from
  slice 1).
- **Promotion + fencing tooling and the till-side failover list** — boot-time role resolution,
  continuous conflict-detection, the "one primary" invariant.
- **The submitter as a relocatable role** — one venue submitter, certificate resolved from wherever
  it runs.
- **Till UX for the timed-out card case** (retry / alternative tender / wait).

Also left open by that design:

- **`CLAUDE.md` §5's "nothing blocks a sale" invariant must be rewritten** — but *in the change that
  implements server-as-SIF*, not before, because the current code still honours the old wording.
  Deferred deliberately; recorded here so it is not lost.
- **A new asesor question** — a cloud server that *issues* invoices (cloud-primary or standalone)
  operates the SIF from a cloud location, a stronger form of the §8a hosting question (RD 1619/2012
  arts. 22.2 / 19.4). See the design's §13, and the advisor gap below.
- The **reconcile remediation UI** and the **orphan-drift hold** (both already under *Debt and odd
  jobs*) are the backstop for the design's double-charge-across-failover path (§10) — no new work, but
  now they have a second caller.

---

## The advisor gap

**No fiscal advisor is engaged.** The four open questions in
[compliance/asesor-questions.md](compliance/asesor-questions.md) therefore have nowhere to go, which
makes "blocked on the asesor" a wish rather than a queue.

Two of the four are not idle curiosity — they check assumptions **already built into the code**:

| Q | Assumption already in the tree | If the answer is no |
| --- | --- | --- |
| **Q13** *(CLOSED #37)* | Tips are outside the VAT base and appear on no invoice — the tip lives on `tenders.tip_amount` (moved off the sale by #39), and `record-sale.ts` / `settle-sale.ts` hand the fiscal backend only the sale `total` (never the tip), so it never reaches the huella — a structural absence, not a dedicated test | Confirmed (findings §11): the tip does **not** enter the hash |
| **Q5(a)** | One invoice series per till | The numbering scheme's foundation moves — and #33 already reshapes it (a series belongs to the server-SIF; two concurrent SIFs need disjoint series), see the SIF follow-ups above |
| Q14 | A printed pre-bill obliges an amendment log | Changes the till design, not existing code. **Still open** — no primary text names the *precuenta* (findings §8) |
| Q15 *(core CLOSED #37)* | Short payment accepted before issuance is a discount | Confirmed (findings §12): a *descuento* agreed at/before the operation is outside the base (LIVA art. 78.Tres.2º) |

**Engaging someone is itself a task, and it has a lead time.**
[compliance/who-to-ask.md](compliance/who-to-ask.md) is blunt about the market: *"No Spanish advisory
firm with demonstrated technical depth on encadenamiento or RRSIF architecture was verified — every
candidate turned out to be a marketing page. Assume you will be educating whoever you hire."*

### Read this before engaging anyone: some questions are premised on an architecture we abandoned

[#19](https://github.com/clintongormley/waitron/pull/19) (*"The cloud is a sync root, not a shared
system of record"*, merged 2026-07-31) put a banner at the top of `asesor-questions.md` warning that
several questions assume **Waitron hosts the client's fiscal system**. Under the design it
establishes, the cloud never holds the key ring, the certificate stays on the client's own local
server, and that server always submits. Q11 and Q12 are named as affected, and its instruction is
blunt: *«re-read every question against the new architecture before paying for answers»* — a question
built on the old premise buys an answer to a situation that will not exist.

**So the advisor task is not just "engage someone".** It is: re-read the whole list against the
current architecture, drop or rewrite what the cloud design invalidated, add the replacement
questions that design raises, *then* engage.

**Which replacement questions, corrected 2026-07-31.** An earlier version of this paragraph named
one: *"does the RRSIF reach a backup archive that is not itself a SIF?"* **Do not ask that.**
[#22](https://github.com/clintongormley/waitron/pull/22) retired it — the RRSIF governs invoicing
*systems*, and an archive issues nothing, so the cloud spec had already answered its own question.
Worse, it pointed at the regulation least likely to apply. The rules that do govern records once they
exist are in the **ROF** (RD 1619/2012), and the three real questions are written out in
[the cloud storage design](superpowers/specs/2026-07-31-cloud-storage-model-design.md) §8a: whether we
count as a *tercero* holding records on the client's behalf, whether that puts a prior-notification
duty on every client whose records we keep outside Spain, and whether the online-access requirement
binds us or only them.

**One of those may decide where the cloud is allowed to run**, which makes it worth answering before
anything is built rather than after — see the same spec's §10.

Q13, Q14 and Q15 post-date that design and do not depend on hosting, so they are unaffected.

**A second architectural shift, 2026-08-01 (#33).** The
[server-as-SIF design](superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md) makes
**Q1** moot (the server is the SIF, so a till need not qualify as one) and leaves the closed **Q2**
(relayed submission) non-load-bearing. It **reshapes Q5(a)**: a series now belongs to the
*server*-SIF, and the two concurrent SIFs must issue under **disjoint** series or their records
collide on the identity triple. And it **raises a new hosting question** — a cloud server that
*issues* invoices (cloud-primary / standalone) operates the SIF abroad, a stronger form of the §8a
question above. `asesor-questions.md` carries a dated note; the full re-read this section calls for now
has two designs to read against, not one.

### Q13 and Q15 closed on primary source (done 2026-08-01, #37); Q14 still open

Closed following the Q5(b) precedent — primary/official source rather than waiting on an advisor. Q13
(tips) and Q15's core are recorded in [verifactu-findings.md](compliance/verifactu-findings.md) §§11–12
and marked closed in `asesor-questions.md`. In short: a voluntary tip is not *contraprestación*, so it
is outside the VAT base whether paid in cash or on the same card capture (the test is *voluntariedad*,
not payment method); a short payment agreed as payment-in-full before the factura issues is a
*descuento* outside the base (LIVA art. 78.Tres.2º).

- **Q14 (precuenta) stays open** — a bounded search found no primary text naming the restaurant
  *precuenta*, only the general prefactura doctrine (findings §8). Whether AEAT's
  *albaranes / proformas / prefacturas* list is exhaustive is the interpretive hinge; it is one for
  the advisor.
- **New non-fiscal duty surfaced by Q13's card-present analysis:** a tip collected through the card
  terminal (unlike cash handed straight to a waiter) is business income — *ingreso* for the Impuesto
  sobre Sociedades and *rendimiento del trabajo* with retención for the employee. It does **not** touch
  the factura or the huella; it is an accounting/payroll matter, recorded under *Not started* below.
- **Provenance caveat** (carried in the findings): PETETE was unreachable (TLS), so the DGT consultas
  were read via faithful legal-database reproductions; art. 78.Tres.2º was read at an official AEAT
  source. Confirm the consulta wording on PETETE if an advisor engages. Correction landed in #37: DGT
  **2174-03 is a *general* consulta, not vinculante** — the binding restatements are V3095-17 / V1808-22.

---

## Not started

Most of the till track now has code — see *Recently shipped* (sub-projects 5 Identity, 6 Locations,
7 Counter POS, 8 Reporting, 16 Workforce, 18 Menu & allergens all have landed slices). What remains
genuinely unstarted is below. The two 2026-08-07 reprioritised slices have both landed their first cut
(allergens #65; *cierre Z* 8a #66 + 8b #68); the **management dashboard** slice-1 auth floor is
**COMPLETE** (1a #67 → 1b #69 → 1c #70 → 1d passkeys #71), and the **autonomous campaign** is now the
active work (see *Now* / *Current direction*).

| Sub-project | Note |
| --- | --- |
| **7 — Counter POS** | **Operable counter POS complete** — 7a walk-up cash (#60), 7b park/retrieve + idempotency (#61), manual card (#62), 7c prepare & collect (#63), integrated Stripe card (#64); all in *Recently shipped*. **Remaining:** the layout & receipt **editors** (the counter screen is layout-driven from a `LayoutDef` with empty per-widget config bags) and a **SumUp** card provider (a future vendor beside Stripe). Deferred edges under *Debt and odd jobs* → **Counter POS follow-ups** (7a / 7b / 7c / integrated card) |
| **5 — Identity** | **Headless first slice merged (#58, 2026-08-05).** `@waitron/identity` owns `persons` + `sessions` (FORCE-RLS tenant isolation, now also scanned by fiscal-verifactu's `inmutabilidad` guard), salted-PIN hashing, a role/permission catalog, `authorize()` (operator session + supervisor `{personId, pin}` override), `loginWithPin` / `endSession`, and a `person.manage`-gated staff API. `recordVoid` / `recordCorrection` now require `sale.void` / `sale.rectify` authorization; `sales.authorized_by` / `sales.operator_id` + `payment_refunds.authorized_by` seams and a `waitron-provision venue` admin seed are in place. Remaining sub-project 5 scope (mid-shift-suspension enforcement, the discount gate, till-refund enforcement, the workforce-gate consolidation, branded ids) is under *Debt and odd jobs* → **Identity follow-ups**. The human-facing call sites (must-be-logged-in to ring, till refunds must be authorized) land with the counter POS (#7) |
| **6 — Locations** | **Provision-a-sellable-venue slice merged (#57)** (2026-08-04; see *Now*) — the foundational till-track unblocker. Country/territory-driven fiscal identity, `resolveFiscalModules` (común → Veri\*Factu + IVA, others refused), `planVenue` / `applyVenue` and the `waitron-provision venue` CLI stand up tenant → location → till → node → SIF → series so `recordSale` can chain a sale; the stale `bootstrap-tenant.sql` was **deleted**. Remaining sub-project 6 scope (multiple locations, editing/deactivation, the #33 SIF-topology deferrals) is under *Debt and odd jobs* → **Locations follow-ups** |
| **8 — Reporting** | **Daily-close first slice done (#56)** — `@waitron/reporting`'s `computeDailyClose`. ***Cierre Z* (frozen/signed daily close) DONE** — 8a VAT-exact close (#66, `sales.vat_breakdown`), 8b immutable numbered `daily_closes` + per-node hash chain + per-till *descuadre* (#68); both in *Recently shipped*. Further unstarted slices: date **ranges** + the **monthly VAT return** (*modelo 303*) aggregation, and the reporting **UI** (belongs to the till, #7). Reporting follow-ups + the catalogue-desglose divergence are under *Debt* |
| **16 — Workforce** | *Registro de jornada* legal floor **DONE (#47)**; **D2 scheduling DONE (#50)** — `convenio_config` surface (overtime de-hard-coded, single-sourced), shifts + `roster_versions` + `publishRoster`, absences/availability/shift_templates/shift_swaps, an **advisory** guardrail engine (`validateRoster` → `RosterBreach[]`; publish surfaces breaches but proceeds — owner chose warn+override) + a planned-vs-actual read model, and supersede-on-republish (partial unique index, one published roster per `(location, period)`). The overtime *rule* the both-model projection computes stays convenio-driven — an **asesor-laboral** call, not code. Remaining: **D3 payroll export** (integrate-not-build), plus the workforce follow-ups under *Debt and odd jobs*. Deferred edges from the floor: the registro export doesn't yet surface overtime (belongs to the payslip/D3); the correction period-fetch is a ±1-day window (a >1-day-relocation correction is out of the floor's scope, chained but maybe missed by the period fetch). A post-#47 `/finish-branch` review (landed as #52) corrected four floor defects: the registro export rendered UTC instead of local wall-clock; the tamper chain omitted a correction's reason/actor and the capturing till; correction precedence tie-broke on the unhashed `ingest_seq` (a floor-bypasser could reorder corrections undetected) — now on the hashed `sequence_no`; and a `clockIn`/`clockOut` TOCTOU (an unlocked state read before the chain-head lock let two concurrent same-person clock-ins append a double-`in` that undercounts worked time) — now serialized per person with a `persons` row lock proven by a real-PG concurrency test |
| **18 — Menu and allergens** | **Slice 1 (EU-14 allergen declaration) DONE (#65)** — taxonomy + `validateAllergens` + `allergen.*` codes (`@waitron/catalogue`), `products.allergens jsonb` (0031), `/api/products` + `TillProduct` exposure, en/es names, a till allergen screen (matrix + operator lookup + print), a demo; in *Recently shipped*. Allergen declaration is a **launch-day legal duty** (EU 1169/2011, RD 126/2015). **Remaining:** recipes/BOM (the linchpin), variants, customer-facing browse; the allergen list stays a food-safety-advisor call. Deferred `@media print` sheet-isolation edge under *Debt* |
| 10-15, 17, 19, 20 | Tabs, floor plan, KDS, tip payroll, bookings, online ordering, accounting export, opening hours, procurement |

**#18 (allergens) is a launch-day legal duty** — not fiscal, not optional — which is why its first
slice was picked next and landed (#65). The registro de jornada, the other launch-day legal floor,
already landed (#47).

**Card-collected tips are business income (new, 2026-08-01, #37).** A tip taken through the card
terminal — unlike cash handed straight to a waiter — is *ingreso* for the Impuesto sobre Sociedades and
*rendimiento del trabajo* with retención for the employee (IRPF / nómina). It does **not** touch the
factura or the huella (the fiscal path is unchanged and correct — findings §11), but it is a real
accounting/payroll duty for the **tip-payroll (13)** and **workforce (16)** tracks — integrate-not-build,
and it needs the tip attributed to the payer (which the sale-settlement model, piece 1, now does by
putting the tip on `tenders`).

**Owner-flagged remaining UI work (2026-08-08).** A "what UI is left?" review named four surfaces to
keep on the radar. The split that matters is backend-vs-greenfield — only the first is a "build the UI"
task today:

- **Shift-planning dashboard UI** (sub-project 16) — the scheduling *engine* landed headless (#50:
  rosters, `publishRoster`, the advisory guardrail engine, planned-vs-actual, shift swaps). What is
  missing is the **dashboard surface** to author/publish rosters, surface `RosterBreach[]` on publish,
  and run the manager **approve/reject swaps** flow (backlog notes that approve/reject slice as latent).
  The one item here where "do the UI" is the actual next task — buildable now against #50.
- **Recipes / BOM** (sub-project 18) — **the linchpin**, and greenfield (no backend, no UI). Unlocks
  stock depletion per sale, allergen *inheritance* from ingredients, and plate costing. Backend-first;
  **declined for the autonomous window** (too many product + food-safety decisions to model unsupervised).
- **Stock-taking / inventory** (sub-project 20) — greenfield; downstream of recipes (a sale only becomes
  "150 g ham used" through the recipe).
- **Supplies ordering / procurement** (sub-project 20) — greenfield; sits on inventory. **AI-assisted
  reorder is explicitly deferred.**

---

## Debt and odd jobs

Carried from finished work. None of it blocks anything; all of it makes later work cheaper.

- **Dashboard slice 1a follow-ups (#67, identity auth foundation). None blocking; each deferred with a
  reason during the SDD build / finish-branch / Copilot review chain.**
  - **`totp_secret` is stored PLAINTEXT and `app_user` holds SELECT on `persons`.** A TOTP secret must
    be recoverable to verify (can't be hashed like the PIN/password), so a `persons` leak would expose
    every enrolled second factor. Latent — nothing writes `totp_secret` in 1a. **The enrollment slice
    must encrypt `totp_secret` at rest via the credentials vault (AES-256-GCM), decrypting on the box
    before `verifyTotp`** (keeps the offline-verifiable property). A comment on the column records it.
  - **otplib is pinned to `^12.0.1`, whose transitive deps are deprecated (v13 guidance).** Copilot
    flagged it; **v13 is a breaking API change** (restructured `authenticator` export — `totp.ts` fails
    at import), so it needs a `totp.ts` rewrite + re-probe of v13's fail-closed behaviour — its own small
    follow-up, not a dep bump. Warnings are install-time only; CI is green.
  - **Deferred (untouched by 1b, which was the HTTP-API layer only — these touch the session internals /
    `authorize.ts`):** stamp `ended_at` when a management session expires (today the idle timeout is
    enforced at read time — matters once a `(tenant_id, person_id) WHERE ended_at IS NULL` open-session
    lookup is added); fold `resolveManagementSession`'s SELECT-then-UPDATE into one `UPDATE … RETURNING`
    (a low-frequency dashboard path, correctness-sensitive — its own TDD'd optimisation); extract a shared
    `assertPermission(role, permission)` and dedup the `not_found→suspended` lookup against the till's
    `verifyPersonCredential` (both touch `authorize.ts`, which 1a/1b deliberately left untouched); add a
    NEGATIVE `WITH CHECK` test (cross-tenant INSERT refusal) to `management-sessions.rls.test.ts` (the
    sibling `sessions.rls` doesn't test it either).
- **Dashboard slice 1b follow-ups (#69, server management API). None blocking; each deferred with a
  reason during the SDD build / simplify / finish-branch / Copilot review chain.**
  - **Share the `run` error boundary.** `management-api.ts` and `till-api.ts` carry byte-identical `run`
    boundaries differing only in their `STATUS` map and the log tag (`management.failed` / `till.failed`);
    extract a `createErrorBoundary(status, tag)` both call. Deferred from simplify as a cross-file refactor
    of shared infra (touches till-api.ts) that wants its own reviewed change.
  - **PATCH `/staff/:id` re-runs authz per field + double-`UPDATE`.** A combined `{role, status}` PATCH
    calls `authorizeManager` (→ `resolveManagementSession` SELECT+UPDATE) twice and issues two
    `UPDATE persons`; authorize once up front + one combined `UPDATE`. Low-frequency admin path — the
    direct analogue of the till-api "consolidate the two per-request transactions" item.
  - **Enum-membership validation gap (by-design typeof-only).** create + PATCH `typeof`-screen `role`/`status`
    but NOT enum membership, so a valid-typed-but-invalid `role:"chef"` reaches the `person_role` pgEnum →
    opaque 500 (and `status:"frozen"` → silent 204). Safe (pgEnum rejects, no corruption/leak) and
    consistent across both routes. A stricter 400 belongs with the validation/tax-module layer, not a
    one-off here.
  - **Malformed (UNPARSEABLE) JSON body → 500 (cross-cutting).** A body that fails `c.req.json()` throws a
    SyntaxError → opaque `server.internal` 500 via `run`, shared verbatim with till-api's `run`. Whether it
    should be 400 is a decision to make across BOTH `run` copies. (The parseable-but-`null`/non-object case
    WAS fixed in #69 → the routes' own 4xx.)
  - **Minors (non-blocking):** the `setPassword` negative test's "password_hash unchanged" re-read runs
    after a rolled-back tx so it can't catch a hypothetical write-before-reject — the load-bearing proof is
    the thrown code + a gate-deletion proof (`setPassword` authorizes before it writes), and the four sibling
    negative tests share the pattern (Copilot, held); `run`'s `?? 400` unmapped-code fallback is honestly
    uncovered (every code a route throws is in `STATUS`) until a future route throws an unmapped one.
  - **Test-infra flaky (not 1b-specific, surfaced by #69's CI):** `packages/fiscal-verifactu`'s
    `drain — batching (the 1001-split)` test can exceed its 30s `testTimeout` under a contended CI shard
    (measured 32s in CI, ~1.2s locally). A heavy 1001-record test; bump its per-test timeout or shrink the
    fixture. Passes on re-run — a flaky timeout, not a regression.
- **Dashboard slice 1c follow-ups (#70, dashboard app). None blocking; each deferred with a reason
  during the SDD build / simplify / finish-branch / Copilot review chain.**
  - **Row-edit ACTIONS — DONE (#73).** The staff list's "Editar" now opens a `<dashboard-person-edit>`
    dialog wired to `updatePerson`/`resetPin`/`setPassword` (role / suspend / reactivate / reset-PIN /
    set-password, each committed independently). What #73 deliberately left, all small:
    - **Single-flight silently drops a *different* second action.** The shared `#editing` guard
      serialises all four edit actions, so clicking e.g. "Guardar rol" then "Restablecer PIN" within
      one round-trip drops the second with no feedback (deliberate "one edit mutation at a time"; no
      corruption — the operator just retries). Per-action guarding, or a queued/toast signal, would
      close it.
    - **Secrets linger in the open dialog until close.** PIN/password fields are masked and reset on
      close, but a *successful* action keeps the dialog open (unlike create, which closes on success),
      so the just-set secret stays in its field until the operator closes. Clear-secret-field-on-success
      needs the screen (which knows success) to signal the widget.
    - **Self-lockout is not guarded.** Neither the UI nor the server stops an admin suspending or
      demoting *themselves*; `resolveManagementSession` re-checks status, so they'd be logged out next
      request (recoverable via provisioning, nothing deployed). A UI guard needs the screen to know the
      logged-in `personId`, which it doesn't track yet.
  - **No i18n layer.** The app (now incl. the edit dialog's labels/`error` codes from #73) renders raw
    error CODES and inline Spanish literals; a follow-up should add an `i18n/` layer mapping codes →
    localised copy, exactly as `apps/till/src/i18n` does (the till's precedent). Also: a session that
    expires mid-use surfaces the raw `management_session.required` key with no re-login flow — the shell
    never re-probes (server enforcement is intact; this is UX).
  - **Double `listStaff()` on cold load.** The shell's session probe and the staff screen each fetch the
    roster on a logged-in cold load (the probe discards its result). Thread the probed list down (an
    initial-people property, or lift `people` into the shell) to drop one `/management-api/staff` round
    trip. Real but low-cost for a small admin app.
  - **Create-error renders behind the modal (create ONLY now).** A rejected `createPerson` keeps the
    dialog open (for retry — correct) but the `role="alert"` banner sits behind the backdrop, so a
    sighted operator may not see WHY it failed (screen readers still announce it). **#73 fixed this for
    the EDIT dialog** (errorKey passed down as `.error`, rendered in the modal's own top layer, page
    banner suppressed while it's open) — do the same for the create form. `wt-dialog` has no backdrop
    light-dismiss, confirmed while wiring #73.
  - **Minors:** the `<select>.value` is bound before its `<option>` children in `login-screen`/`person-form`
    (renders right today only because the default equals the first option — the latent EDIT-a-non-default
    bug **#73's edit picker avoided** via an `updated()` `.value` reconcile; the login/create pickers
    still carry it); no top-level `<main>` landmark in the shell (consistent with `apps/till`; axe
    passes); `staff-list`'s `people` prop-doc still says "the app owns" (harmless imprecision); and
    `apps/dashboard` declares `@waitron/shared` but still doesn't import it — **1d/#73 did not use it
    either (confirmed 2026-08-08), so drop the dep.**
- **Dashboard slice 1d follow-ups (#71, passkeys). None blocking; each deferred with a reason during
  the SDD build / simplify / finish-branch / Copilot review chain.**
  - **Real-ceremony integration test — the biggest gap.** Unit/route tests MOCK `@simplewebauthn`'s
    `verify*`, so they prove OUR wiring (RLS, gating, single-use, counter, suspension) but never the
    crypto. The true end-to-end proof is a Playwright **virtual authenticator** (CDP
    `addVirtualAuthenticator`) driving `@simplewebauthn/browser` against the real
    `@simplewebauthn/server` verify — belongs with the dashboard's browser shard (`test-dashboard`).
  - **`transports` column is declared but never written.** `webauthn_credentials.transports` is in the
    schema but nothing populates it. Either write it at registration (`credential.transports`, useful as
    an `excludeCredentials`/`allowCredentials` hint) or drop the column. Populate-or-drop.
  - **RP-ID / origin misconfig is undiagnosable in production.** `WAITRON_MANAGEMENT_RP_ID`/`_ORIGIN`
    default to `localhost` / `http://localhost:5191` for dev+tests; a wrong origin now surfaces as a
    clean 401 (was a 500), but the real fix is to make both **required at boot** in production so a
    misconfig fails loudly at startup, not as a mystery 401 per login.
  - **`userVerification` policy not pinned.** `generate*Options` default to `"preferred"` while the
    `verify*` calls require UV (the safe direction — fails closed). For a phishing-resistant PRIMARY
    login, pin both generate and verify to `"required"` explicitly.
  - **Duplicate `credential_id` on the gated register route → opaque 500.** A second registration of the
    same `(tenant_id, credential_id)` raises `23505` → `server.internal` 500, breaking the "every
    surfaced code is a 4xx" invariant. Near-unreachable (route is gated + `excludeCredentials` makes a
    compliant authenticator refuse), but catch `23505` → a mapped `passkey.*`/`management.request_invalid`
    to close it.
  - **Residual harmless double-session (out of scope, documented).** Two DISTINCT concurrent auth
    ceremonies (different challenge handles) for the same person can each mint a session — both belong to
    the legitimately-authenticated owner, the same race as `loginManager`, no trust boundary crossed. The
    single-use fix (#71) closes the SAME-handle race; this different-handle case is left as harmless.
  - **i18n** — passkey button labels + status/error keys render raw, folded into the slice-wide i18n
    follow-up above (shared with 1c).
- **Counter POS follow-ups (sub-project 7, slice 1 / 7a — the walk-up cash sale). None blocking; each
  is a deliberate slice-1 boundary or a small review Minor, deferred rather than dropped.**
  - **TLS termination, LAN binding and serving the built bundle are deployment (#9).** In dev the till
    is served by Vite on loopback over plain HTTP, and the session cookie's `Secure` attribute tracks
    whether the server has TLS configured (`secureCookies: config.tls !== undefined`, `boot.ts`). The
    process is already TLS-**capable** (`tls.ts`, `WAITRON_TLS_*`); what #9 owns is production HTTPS
    with a local-CA trust root, binding to the LAN rather than `127.0.0.1`, and serving the built
    `apps/till` assets (dev runs the Vite server, not a bundle).
  - **Card / Terminal tender.** **Manual (unintegrated) card DONE — landed as #62** (the *datáfono*
    case: card run on a separate terminal, recorded on the till as a `card` tender + a captured
    `payments` row). What remains is the **INTEGRATED** terminal: driving a real reader (Stripe
    Terminal / SumUp) with network capture, the **timed-out-card UX** (retry / alternative tender /
    wait — already noted under the #33 SIF follow-ups), and **tips-on-card** wiring. A separate slice;
    the hardware choice (SumUp Solo vs Stripe Terminal) is itself open, and `packages/payments-stripe`
    already carries the provider adapters.
  - **Bank datáfono (Redsys / TPV-PC) — a SECOND topology, not "the same shape" as the cloud readers
    (investigation, 2026-08-06).** A bank-branded datáfono in Spain almost always routes through
    **Redsys** (the network the major Spanish banks share), so a single Redsys adapter would in
    principle integrate terminals across many banks at once — the strategic upside, and why a bank's
    own terminal is reachable at all. Two caveats to "support Redsys → every bank datáfono works":
    **most, not all** Spanish acquiring runs on Redsys (Comercia/Worldline, Adyen and bank-specific
    stacks exist — an *inference*, not source-confirmed here), and each venue's terminal only
    integrates once its **acquiring bank enables the integrated mode and issues the merchant
    credentials** (merchant code + terminal id + merchant key), so it is contracted per merchant, not
    a blanket unlock. **The engineering catch the deli-hardware design understates:** the integrated
    Redsys product is **"TPV-PC" (TPVpc)**, a **USB-cable-attached local device** — the till software
    talks to a terminal plugged into the counter and the *terminal* holds the line to Redsys. That is
    the OPPOSITE topology to Stripe/SumUp/Square, which our `PaymentProvider` / `provider.collect` seam
    assumes: our *server* makes an HTTPS call out to the processor's *cloud*, which relays to the
    reader. So [the deli-hardware design](superpowers/specs/2026-07-30-deli-hardware-design.md) §8's
    "Adyen or **Redsys** later on the same shape" is optimistic for the USB case — the
    `PaymentProvider` **interface** (collect → outcome-as-data) can stay, but the **implementation** is
    a local-device driver that must run **till-side** (where the cable is), not on `apps/server`, a
    local agent/bridge no cloud adapter needs. And unlike Stripe/SumUp, TPV-PC's integration spec is
    obtained **from the acquiring bank on request** (not openly published); real integrations go
    through prebuilt connectors (Odoo/Sage/QFgest each ship a TPVpc module). Integrated datáfonos *can*
    also connect over the **local network (ethernet/wifi)**; the classic Redsys TPV-PC these sources
    describe is **USB**, matching an in-person sighting of one wired to a till. **Not scoped** — its
    own investigation/spec if pursued, *after* the Stripe integrated slice; the Stripe/SumUp cloud
    readers stay the first vendors. Sources (read 2026-08-06): TPV-PC connects by USB, amount pushed
    automatically, results/refunds return to the POS —
    [Odoo `edyma_pos_dataphone`](https://apps.odoo.com/apps/modules/18.0/edyma_pos_dataphone) and
    [tpvnorte "cómo conectar el datáfono al TPV"](https://tpvnorte.com/tpv/como-conectar-el-datafono-al-tpv/)
    (cable USB/serial vs. local-network vs. software-integrated); module integration —
    [QFgest TPV-PC](https://www.qfgest.net/product/modulo-de-integracion-con-tpv-pc-de-redsys/) and
    [Sage 50 TPVpc](https://communityhub.sage.com/es/sage-50/f/discusion-general/225898/configurar-tpvpc-redsys-pinpads);
    Redsys network / Android POS / TPV-Virtual —
    [redsys.es products](https://redsys.es/en/products-and-services).
  - **Offline-first store-and-forward.** The till needs the server reachable; there is no local queue
    that rings while disconnected and forwards later. It belongs with the app-level sync subsystem
    (the `sync_log` design), not the till alone.
  - **Scale + printer hardware.** No electronic-scale weight capture (the weighed quantity is typed),
    no receipt-printer or cash-drawer drivers. When the printed ticket lands, its print stylesheet
    must size the **Veri\*Factu QR at 30–40 mm** per **art. 21.1** — recorded here so the print slice
    does not rediscover the size rule (confirm the exact instrument/article against primary source
    before it ships).
  - **Refunds / voids / corrections UI.** The fiscal backends exist (`recordVoid` / `recordCorrection`,
    authorization-gated by Identity #58), but the till has no operator surface to trigger a refund,
    void or R5 rectificativa. Lands with Identity's human-facing call sites (see *Identity follow-ups*).
  - **The layout & receipt editors + per-widget config.** The counter screen is layout-driven from a
    `LayoutDef` and every placed widget already carries a `config: Record<string, unknown>` bag
    (`apps/till/src/layout.ts`), but slice 1 ships a fixed layout with **empty** config bags and
    nothing reads them — the editor that authors layouts and the per-widget config it would write are
    a later slice. The seam is present but unread.
  - **One till per server.** `boot.ts` resolves a single `WAITRON_TILL_*` identity; multiple tills
    served by one server (and the roster/session model that implies) is later.
  - **Small review Minors (none blocking):**
    - **Normalize the real-Postgres test filename.** `apps/server/src/till-api.realpg.test.ts` uses a
      one-off `.realpg.test.ts` suffix where the package's other container suites are `*.rls.test.ts`
      (`pass.rls`, `webhook.rls`); rename for consistency (it is not a `.preprod` suite, which
      `vitest.config.ts` excludes).
    - **`#boot` has no `catch` → unhandled rejection.** `till-app.ts`'s `firstUpdated` fires
      `void this.#boot()`, and `#boot` `await`s `this.api.getTill()` with no `try/catch`
      (`apps/till/src/till-app.ts:90`), so a server unreachable at boot surfaces as an unhandled promise
      rejection rather than a handled "cannot reach the till" state. Wrap it the way `#onConfirmPayment`
      already wraps its await.
    - **Basket remove control is below the touch target.** The per-line remove button renders at
      `size="sm"` (`apps/till/src/widgets/basket.ts:101`), under the 44 px minimum a touch POS wants —
      bump it for finger use.
    - **Add a basket drift-guard regression test for a rounding-sensitive weighed line.** The store's
      running-total / drift guard lacks a regression test pinning a weighed line whose gross rounds in
      a way that could drift the displayed total from the authoritative re-price.
  - **Whole-branch review deferrals (surfaced by the pre-merge review; none blocking):**
    - **Server-side sale idempotency for the lost-response retry.** The walk-up-sale PR added a
      CLIENT-side single-flight guard (`till-app`'s `submitting`), which stops a double-tap firing a
      second `POST /api/sales`. It does NOT cover the case where the request succeeded on the server
      but the RESPONSE was lost (dropped link, tab reload) and the operator re-rings: that is a fresh
      request the client cannot dedupe. The server fix is a client-generated `workingOrderId` threaded
      through `POST /api/sales` plus a `UNIQUE(tenant_id, working_order_id)` on `sales`, so a retried
      identical sale collides instead of filing a second chained `registros_facturacion` record
      (CLAUDE.md §5 — the double-file is unrepairable). **DONE — landed in 7b (#61):**
      `payWorkingOrder` keys idempotency on a client-minted `workingOrderId` + `UNIQUE(tenant_id,
      working_order_id)` on `sales`, replaying an already-settled order (files nothing) and catching a
      concurrent `23505` as a replay; three DB backstops (UNIQUE + PK + the state trigger) stand behind
      it, proven on real Postgres.
    - **Return priced lines from `POST /api/sales` so the receipt is server-authoritative.** The ticket
      computes each per-line gross CLIENT-side from the login-time `TillProduct.unitPrice` (`lineGross`),
      because the sale response carries only `total` + `vatBreakdown`, no per-line amounts. In slice 1
      the catalogue is fixed at provisioning and cannot change mid-session, so Σ(line grosses) equals the
      server `total`; a future mid-session price edit would break that identity. Have `recordTillSale`
      return priced lines and render those instead (see the LINE-GROSS SOURCE note in
      `till-ticket-view.ts`). **Partly addressed in 7b (#61):** the idempotent-**replay** ticket is now
      server-authoritative — `FiscalBackend.filedReceiptFor` returns the filed QR + difference-method
      breakdown read back from the registro; the **first-file** ticket still computes per-line gross
      client-side, so this remains for the normal path.
    - **Consolidate the two per-request transactions** on `GET /api/products` and `POST /api/sales`.
      Each currently runs the `requireSession` session lookup in one `withTenant` transaction and the
      work in a second (`recordTillSale` opens its own), so a request pays two round-trips where one
      would do. Efficiency only (flagged in simplify); the `POST /api/sales` half needs `recordTillSale`'s
      transaction boundary reshaped so the caller can supply the already-open tx.
    - **Operator-UI money/locale is hardcoded es-ES.** `formatMoney` in the operator widgets formats in
      es-ES unconditionally — correct for slice 1's single-locale deli, but it must follow the operator
      UI locale once a locale switcher exists. (The RECEIPT is already locale-correct: it formats in the
      independent `invoiceLocale` from `GET /api/till`.)
- **Counter POS follow-ups (sub-project 7, slice 2 / 7b — park & retrieve, merged #61). None blocking;
  surfaced by the 14-task / whole-branch / simplify / two-lens / Copilot review chain and left
  deliberately.**
  - **Re-hold of a retrieved-and-edited order is not wired.** `updateHeldOrder` / `PUT
    /api/working-orders/:id` / the client's `updateWorkingOrder` are built, tested and spec'd, but the
    till UI never calls them: the Hold button always calls `parkOrder`, which on a RETRIEVED order's id
    PK-collides (`23505` → a graceful `held.park_error`). So retrieve → edit → **re-hold** fails (retrieve
    → edit → **pay** works). Wire the Hold handler to call `updateHeldOrder` when the order already exists
    server-side (was retrieved). Surfaced by simplify (a built-but-uncalled vertical).
  - **Park itself is not idempotent.** A re-sent `POST /api/working-orders` PK-collides on the
    client-minted id → opaque 500 (the first park succeeded and the order IS in the held list). No fiscal
    effect; could catch the `23505` and replay the existing order like `payWorkingOrder` does. The route
    comment now states this accurately (Copilot, #61).
  - **The by-id lookups are tenant-scoped (RLS) but not node-scoped.** `getHeldOrder` /
    `updateHeldOrder` / `abandonHeldOrder` filter by id + tenant, not `node_id` (only `listHeldOrders` is
    node-scoped). NOT a live misattribution path (filing under the paying node is correct; the UI only
    ever surfaces this node's ids via the node-scoped list). Add `eq(nodeId, cfg.nodeId)` fail-closed for
    symmetry.
  - **A non-UUID working-order id → opaque 500 instead of 4xx.** The `:id` routes (and `POST /api/sales`'s
    `workingOrderId`) pass the client string straight into `eq(workingOrders.id, id)` against a `uuid`
    column, so a malformed value `22P02`s → 500. Reuse `isUuid()` (the session-cookie guard in
    `till-session.ts`) to return a 4xx. Newly reachable because these ids are now client-supplied.
  - **Small tidies:** the walk-up concurrency test omits the `Set(pids).size===2` distinct-backend
    assertion the parked test carries; `till-api.ts` re-declares the park/update request-body shapes inline
    instead of reusing the exported `ParkOrderRequest` / `UpdateHeldOrderRequest`; `client.ts`'s
    `parkOrder` return type is an inline anonymous object rather than a named interface.
  - **Operator-UI money/locale still hardcoded es-ES** (carried from 7a, unchanged by 7b — the operator
    widgets' `formatMoney` is es-ES; the receipt is already locale-correct via `invoiceLocale`).
- **Counter POS follow-ups (sub-project 7, slice 7c — prepare & collect + line-add snapshot, merged #63). None
  blocking; surfaced by the 11-task / whole-branch / fix-wave / 4-lens-simplify / final-fresh-context review chain
  and left deliberately.**
  - **`ticket_then_pay` / `invoice_first` send-to-prep + cancel-placed have NO till UI control.** `sendToPrep` /
    `advancePrep` / `cancelPlacedOrder` and their `/api/working-orders/:id/...` routes are built, tested and
    spec'd, but no counter-screen button *sends* a placed order to prep or cancels it outside the prep-queue
    widget's own advance flow. Wire the placed-order controls. Surfaced by the whole-branch review
    (built-but-uncalled server verbs).
  - **The receipt shows a weighed line's filed quantity without its unit of measure** — `0.32`, not `0.320 kg`.
    The filed `sale_lines.quantity` is correct; only the till's receipt rendering drops the `pricing_unit`. Carry
    the unit through to the receipt line. Surfaced by the fresh-context review.
  - **`placeOrder` is not idempotent-replay-symmetric with `payWorkingOrder`.** A re-sent place on an
    already-`placed` order throws `order.not_open` (caught and swallowed only on the edited-retrieved-basket
    re-sync path), where `payWorkingOrder` replays a settled order cleanly. No fiscal effect (placing files
    nothing in `ticket_then_pay`/`invoice_first`, and prepay issuance is guarded by the sale-idempotency UNIQUE),
    but the asymmetry is a latent 500 on a lost-response place retry. Make place catch its own `not_open` and
    replay the existing placed order.
  - **DRY / efficiency defers (from the 4-lens simplify, judged out-of-scope for the merge; all cosmetic, none
    change behaviour):** `appendOrderAmendment` re-locks the order where a `lock-already-held` skip flag would
    avoid a redundant `SELECT … FOR UPDATE` inside `placeOrder`; `collectOrder` reads the sale row twice (branch
    on flow, then build the receipt); the `lockOrderExpecting(state)` guard is inlined at three call sites and
    wants extracting; the till's tender-pay button + `lineName`/`productName` rendering duplicate across
    cash/card/place; `trimQuantity` is copy-pasted rather than shared; the prep-queue widget CSS duplicates the
    basket widget's; and `#layoutFor` reallocates its layout object per render.
- **Counter POS follow-ups (sub-project 7, the integrated card terminal, merged #64). None blocking; all
  fiscally safe; surfaced by the 10-task / whole-branch / 4-lens-simplify / Copilot review chain and left
  deliberately.**
  - **Normalise the P3 lock order (a fiscally-safe recover-vs-collect deadlock).** In a narrow lost-T2 retry
    window a retry routes to `finalizeRecovery`/`finalizeSettleRecovery` (which take `working_orders FOR UPDATE`
    then the chain-head lock) while the original is still in `finalizeCapture`/`finalizeSettle` (chain-head lock
    first, `working_orders` last) — a lock-order inversion that can `40P01` deadlock. **Fiscally safe**: the
    deadlock aborts one tx atomically; `40P01` is neither a unique nor an `already_settled` violation so it maps to
    `server.internal` 500, the till retries, P1 sees `settled` and replays cleanly — no double-charge (Stripe
    `wo_` key), no double-file (`sales_working_order_id_key`), no orphan. UNVERIFIED (reasoned from the lock
    acquisition order, not reproduced in a container). Fix: normalise all four P3 paths to `SELECT working_orders
    FOR UPDATE` first + a settled-recheck-replay (matching `finalizeRecovery`/`collectOrder`); this also lets the
    `finalizeCapture` "only serialisation" comment drop its caveat.
  - **Void pre-check before the network collect (invoice-first).** `readOutstandingSaleForOrder` does not exclude a
    *voided* sale (mirrors the pre-existing `collectOrder` non-exclusion), so a voided-while-`placed` invoice-first
    order routes to `settle` → **P2 charges the card** → `finalizeSettle`'s `settleSale` throws `sale.voided` → an
    orphaned captured payment (reconcile's class; no wrong fiscal record). Fails safe, but — unlike `collectOrder`,
    which never networks — the integrated path takes the money *before* refusing. Fix: a void pre-check in P1
    **before** P2 `collect`. (Shared with `collectOrder`'s own non-exclusion.)
  - **Unify the four `finalize*` functions.** `finalizeCapture`/`finalizeRecovery`/`finalizeSettle`/
    `finalizeSettleRecovery` duplicate the record/settle + associate + transition + ticket-readback shape
    near-verbatim (and duplicate `fileImmediateSale` + `collectOrder`'s invoice-first block). Deferred from the
    4-lens simplify **deliberately** — it is the unrecoverable fiscal core, so it wants a dedicated TDD'd +
    reviewed refactor, not a finish-branch edit. Deeper form: two shared helpers ("file a new sale" / "settle an
    existing sale") parameterised on the tender + the payment-linking strategy.
  - **DRY / test-coverage defers (cosmetic / non-blocking, from simplify + the whole-branch review):** merge P1's
    two sequential SELECTs (`readOutstandingSaleForOrder` + `findCapturedPaymentForWorkingOrder`, different tables,
    same key) into one round trip on the park/place-and-pay path; factor `tender-pay`'s `#renderIdleCollect`/
    `#renderIdlePay` shared fragment (pre-existing 7c, deepened); add a `stripe_on_device`
    different-WO→different-key test (task-1 minor); add a WT002/aborted-tx interleaving test for `finalizeSettle`'s
    outside-catch (F2); add a corrected-invoice-first (`corrections > 0`) `amountDue` test (F3 — the arithmetic is
    correct-by-construction, only the coverage is missing).
- **Catalogue follow-ups (sub-project 7/18 seed, `feat/catalogue-model`). None blocking; deferred by
  the slice's headless YAGNI boundary (design §9) or surfaced by its whole-branch review.**
  - **`products.catalogue_id`/`category_id` are single-column FKs**, so a product could reference
    *another tenant's* catalogue — the referenced tenant is not RLS-checked at FK validation (the
    product's own `tenant_id` is). Brief-specified, and RLS + the app only ever supplying own-tenant
    ids is the primary defence, so **no wrong fiscal filing is reachable** (the sale is filed under the
    operating tenant; `listAvailableProducts` joins stay within RLS scope). But it **deviates from the
    codebase's own convention** — `sale_lines`/`working_order_lines` use composite `(tenant_id, id)`
    FKs precisely so a line cannot point at another tenant's row independently of RLS. Cheap
    belt-and-suspenders in pre-production: a `UNIQUE(tenant_id, id)` on `catalogues`/`categories` +
    composite FKs from `products`. Flagged by the base-to-tip review; non-blocking.
  - **Daily-close VAT report vs the filed desglose — CLOSED by #66 (stale entry pruned 2026-08-08).**
    This entry described `computeVatSummary` recomputing cuota **multiplicatively** and so overstating
    difference-method (catalogue) cuota, with the filed desglose "not persisted queryably". #66 (slice
    8a) retired both: it persisted the filed per-rate breakdown to `sales.vat_breakdown` (0032) written
    from the same variable that enters the huella, and `computeVatSummary` now **reads** it
    (`packages/reporting/src/vat-summary.ts:9,28` — `cross join lateral jsonb_array_elements(vat_breakdown)`),
    so the reported cuota is the exact filed value. The per-rate *gross* stays unstored but is unneeded
    (`gross = base + tax`; *modelo 303* has no gross box). This was a stale receipt contradicting the
    #66 line under *Recently shipped* — see `CLAUDE.md` §1 "a behaviour change retires every receipt".
  - **Difference-method rounding — AEAT acceptance CLOSED on primary source (FAQ §20, 4 Dec 2025);
    one residual + configurability remain.** The AEAT developer FAQ documents the only `ImporteTotal`
    validation: `ImporteTotal == Σ(BaseImponible + CuotaRepercutida + CuotaRecargoEquivalencia)` with a
    **±10.00 € tolerance** and a **warning, not a rejection** (= `verifactu/src/validate.ts`'s
    `TOTAL_TOLERANCE = 10`). The difference method makes that identity hold **exactly**, and the FAQ
    itself describes no `CuotaRepercutida == base×rate` check. **Now fully CLOSED on primary source:**
    the companion `Validaciones_Errores_Veri-Factu.pdf` (v1.2.2 §15.7) *does* validate per-line
    `CuotaRepercutida = base × rate`, but with a **±10,00 € tolerance**, *aviso not rechazo* (§16/§17
    likewise). The difference-method deviation is *céntimos* — three orders of magnitude inside a
    ten-euro tolerance — so it passes all three validations trivially, and the rounding *locus* is
    **fiscally irrelevant for acceptance**. No asesor needed; recorded in
    `docs/compliance/verifactu-faq-notes.md` §20. (§15.8 also caps an F2 ticket at Σ(base+cuota) ≤
    3.000 € — a till/#7 concern.) **Remaining is only configurability:** price basis, rounding *locus*
    (line-item vs tax-group), and precision are a
    **tax-module property** — the #57 `resolveFiscalModules`/`nodes.tax_module` seam — so a non-ES
    regime (IGIC/IPSI, other country) carries its own rules; this slice hardcodes ES-común/IVA as the
    first piece of that module. The rounding *mode* (half-away-from-zero = *redondeo al alza*) stays
    fixed in `@waitron/shared` until an authority needs banker's (YAGNI). Spec §8 records both.
  - **RLS test hardening (finish-branch review, low risk).** `operations.rls.test.ts` proves
    cross-tenant isolation by deletion on `catalogues` and `products` but not `categories` (the 0027
    policy is byte-identical), and `assignCatalogueToLocation` is exercised only under PGlite
    (superuser) — safe because `app_user` holds UPDATE on `locations` (0001), but not proven under the
    non-superuser probe. Add a `categories` isolation assertion and a real-PG `assignCatalogueToLocation`.
  - **Category analytics splits on rename.** The sale line snapshots the category *name*, so renaming
    a category splits one analytics bucket across the rename in roll-ups (inherent to snapshotting a
    label; a stable snapshotted code/id would avoid it). A design-acknowledged tradeoff, surfaces only
    when category-based reports land (deferred with reporting).
  - **Deferred by design (§9), each attaches when its consumer exists:** no management UI/CLI/HTTP
    (→ dashboard); catalogue **sync** — the `catalogues.version` column is the seam, present but not
    bumped — and per-location price/availability overrides (→ sync slice); allergens/variants/recipes
    (→ #18); scale hardware, weight-entry UI, barcode (→ a later till slice); category-based **reports**
    (the snapshot lands now; GROUP-BY comes with reporting); the `catalogue.manage` **permission
    enforcement** (→ with the till's call sites, like the discount seam).
- **Locations follow-ups (sub-project 6, merged as #57, 2026-08-04). None
  blocking; all deferred by the slice's YAGNI boundary (design §8) or inherited from #33.**
  - **The #33 SIF-topology deferrals stand.** The slice is single-node-per-location, one `venue`
    invocation per shop. Still deferred: **active-active, failover, two concurrent SIFs + disjoint
    series, and the relocatable submitter**; **update / rename / deactivate** of any entity (tenant,
    location, till, node, series — the flow only inserts-and-reuses); and **multiple locations created in
    one invocation**.
  - **A full IGIC/IPSI tax module is unbuilt.** común is IVA, so only `{ filing: "verifactu", tax: "iva" }`
    is wired; `resolveFiscalModules` refuses every other territory (`fiscal.regime_not_implemented`) and
    the `nodes.tax_module` column + the `tax` seam are there for a later module, but no IGIC/IPSI tax
    computation exists.
  - **Cross-country establishments are out of scope.** The slice assumes a location sits in the tenant's
    country; a location registered in a different country than the tenant (design §8) is unbuilt.
  - **`WAITRON_ID_SISTEMA = "W1"` is a PLACEHOLDER** (`packages/provisioning/src/fiscal-modules.ts:46`).
    It is Waitron's own AEAT-registered software identifier (≤ 2 chars, FAQ §4) and reaches every filed
    registro via `registro_sif.id_sistema_informatico`; the real registered value **must be set before
    any live filing**. `"W1"` compiles and is length-valid, so nothing fails until a real filing — it
    will not surface on its own.
  - **The `id_sistema` length rule and its error code are duplicated across two packages — converge
    before drift.** The ≤ 2-char check lives in three places: `packages/verifactu`'s `validate` rule
    `ID_SISTEMA_LENGTH` (no production caller), `apps/server/src/provision-till.ts`'s
    `ID_SISTEMA_MAX_LENGTH = 2` + `assertUsableIdSistema` (throwing `sif.id_sistema_invalid`), and
    `@waitron/provisioning`'s `assertUsableIdSistema` (throwing `provisioning.id_sistema_invalid`). The
    two error codes are a **deliberate** duplication today — `apps/server` cannot import
    `@waitron/provisioning`'s registry, so it re-declares the code with the identical
    `{ value, maxLength }` shape (`packages/provisioning/src/errors.ts` documents why). Now that both the
    standalone `provisionNode` path (`provision-till.ts`) and the `venue` CLI register a node's SIF, the
    two length rules and the two codes should converge onto one home — folded in when `provision-till.ts`
    is renamed to the deferred first-class `provision node` subcommand. Non-blocking, but error codes are
    **never renamed once shipped** (`CLAUDE.md` §3), so settle it before a real filing exists.
  - **Three code-quality cleanups surfaced by the #57 finish-branch review, none applied (all
    non-blocking).** (1) `applyVenue`'s `registerSifForNode` re-reads the tenant's `tax_id` with a
    `SELECT` although the value is already in scope from the `ensure-tenant` action — kept
    **deliberately** as the "read the obligado's NIF from the authoritative tenant row, never an
    argument" fiscal-safety pattern `provisionNode` uses; dropping the read is an optional
    micro-optimisation, not a bug. (2) The plan-summary + confirm block is duplicated between
    `instance()` and `venue()` in `packages/provisioning/src/cli.ts` — a `printPlanAndConfirm` helper
    would dedup it, deferred to avoid churning the pre-existing, separately-tested `instance` command.
    (3) The identical `VenueRequest` is hand-built across four `packages/provisioning/src/*.test.ts`
    files — a shared `venueRequest()` builder in `packages/provisioning/src/testing/` would dedup it.
- **Identity follow-ups (sub-project 5, headless first slice merged as #58). None blocking;
  all deferred by the slice's headless boundary (spec §13) or surfaced by its reviews.**
  - **Mid-shift operator suspension is not enforced on the operator path.** `authorize()`'s
    operator-holds branch (`packages/identity/src/authorize.ts:39-49`) grants on the session
    person's **role alone** and never re-reads `persons.status`, so a manager suspended mid-shift
    while holding an OPEN session can still self-authorize voids/refunds. Spec-faithful (§13 defers
    session lifecycle to #7; suspension today means "refuse login", enforced on `loginWithPin` and on
    the override path — `authorize.ts:60`) and not exploitable in the headless slice, which has no
    long-lived till sessions yet. Revisit with #7's session-lifecycle / mid-shift-revocation policy.
  - **PIN-only supervisor override** (type a PIN, resolve the person) is a #7 UX nicety. The override
    currently takes `{ personId, pin }` because a salted PIN cannot be uniquely looked up by value.
  - **The discount gate** has no write path yet: `sale.discount` is in the permission catalog
    (`packages/identity/src/permissions.ts:10`) but nothing applies a discount until #7 builds
    sale-entry. It attaches when that call site exists.
  - **Enforcement of `sales.operator_id` / `payment_refunds.authorized_by`** (must-be-logged-in to
    ring; till refunds must be authorized) is seams only — the columns and the optional attribution
    exist, but no human call site gates on them yet. Lands with #7's call sites.
  - **Consolidate workforce's `approveCorrection` gate onto `authorize()`.** It still throws the
    shipped `correction.not_permitted` code (`packages/workforce/src/clocking.ts:255`) — **never
    renamed once shipped** (`CLAUDE.md` §3) — so fold it in only when a `workforce.correction.approve`
    permission can be added **beside** the old code, not in place of it.
  - **Branded `PersonId` / `SessionId` in `@waitron/shared`.** This slice uses plain `string` for both;
    branding them is optional consistency with the repo's other branded ids.
  - **`seed-admin` provisioning edges (surfaced by the finish-branch reviews; both non-blocking).**
    (1) A tenant whose sole seeded admin is later **suspended** cannot be re-seeded by re-running
    `waitron-provision venue` — the `where not exists (… role='admin')` idempotency counts a suspended
    admin as present, and no active session could `person.manage` to reactivate it, so recovery is a
    privileged DB action. Inherent to suspend-not-delete + one-seeded-admin. (2) Two concurrent
    `applyVenue` runs for the same tenant could each pass `where not exists` under READ COMMITTED and
    insert two admins (no unique constraint enforces one) — realistic risk ~nil (provisioning is a
    serial operator CLI action), consequence a spare non-fiscal admin row.
- **The stale-hardcoded-list class (two instances fixed in #58).** A cross-package test
  that pins a repo-wide manifest/scope list goes stale the moment a member is added, and scoped CI
  hides it because the changing task's scope never runs the pinning package. Adding `identity` to
  `packages/migrations/migrations.manifest.json` and to `english-only.ts`'s `GENERIC_PACKAGES` left
  `packages/fiscal-verifactu/src/vocabulary-scope.test.ts` (pins `GENERIC_PACKAGES`) and
  `packages/provisioning/src/instance-apply.rls.test.ts` (pins the manifest's `migratedSets`) red;
  both were fixed on this branch. See the receipted `CLAUDE.md` §2 entry. When you add a member to a
  repo-wide list, grep every package for a test that pins it and run the WHOLE workspace's suites.
- **Reporting follow-ups (#56), both surfaced by the finish-branch review, neither blocking.**
  (1) **Lift `percentOf` into `@waitron/shared`.** `@waitron/reporting`'s local `taxOf` is now the third
  copy of `divideDecimal(multiplyDecimal(base, rate), "100", MONEY_SCALE)` (the others in
  `packages/core/src/vat.ts` and `apps/server/scripts/record-one-sale.ts`). The clean fix is a
  cross-package hoist (touches `core` + `shared`), so it wants its own small PR rather than riding in on
  the reporting feature — kept a local copy deliberately to keep that PR self-contained. (2) **A sargable
  business-day filter.** `businessDayClause` wraps the column in `(col AT TIME ZONE tz - cutover)::date`,
  which cannot use the `(tenant_id, issued_at)` index, so the aggregates scan the tenant slice. The
  rewrite to half-open UTC bounds (`col >= start AND col < end`) is index-usable, but has a DST subtlety
  (`start + interval '1 day'` is wrong on a transition day — compute `end` from the next day's local
  cutover) and only the VAT query has a matching index anyway (cash-up/voids would also need new
  indexes). **Gated on scale**, consistent with the 'sargable reconcile period filter' entry below.
- **The pre-push hook's shell is largely untested (unclaimed).** The classifier
  `scripts/changed-packages.mjs` and the sign-off check are tested; the deletion guard and the range
  computation are backed only by running the real hook against crafted stdin. Before writing a suite:
  the root Vitest project doesn't typecheck, and husky runs the hook under `sh -e` where an unguarded
  `x=$(false)` kills it mid-gate. Also note a green hook ≠ a green CI — it runs neither **mutation
  testing** nor the **`bundle-smoke`** builds (CI-only), and a `global` push runs `pnpm -r
  test:coverage` over the whole workspace (~116s). Full receipts in `CLAUDE.md` §2/§6. Non-blocking.
- **`packages/ui` can hang the `test-light` shard — watch `test-ui`.** It hung the whole-workspace
  shard twice on 2026-08-01 (a wedged `chrome-headless-shell` under Testcontainers contention,
  plausible-not-proven); mitigated by giving `packages/ui` its own `test-ui` shard so a hang can no
  longer take twelve other packages down with it. **Still open** — the cause is unconfirmed; if it
  hangs in `test-ui` too, the cause is inside the suite and the next move is a per-test timeout + a
  Playwright trace. Guarded by `scripts/ci-workflow.test.mjs` (the three shards cover every
  `test:coverage` member exactly once).
- **`test-light` reports `success` without naming what it ran.** The skip-empty-scope half is done;
  what remains is the *reporting* — a shard that ran two packages and one that ran the whole workspace
  both report `success`, and only the step log tells them apart. Make the job name the packages it
  selected. Non-blocking.
- **`errors.reachability.test.ts` does not test reachability.** Proven by deletion. Eight packages
  carry a copy. Closing it needs a `tsc`-based downstream probe or a narrowed `include`. See
  `CLAUDE.md` §4 — do not cite these tests as evidence in the meantime
- **`packages/db`'s test suite is 189s**, mostly one Testcontainers Postgres per suite. It is now its
  own CI shard (`test-heavy`), which stops it blocking the other packages but does not make it any
  shorter. Sharing a container across suites beats every CI-config change combined, but it means
  changing `useRealPostgres` / `describeEachTarget` — the harness that guarantees RLS and lock
  contention are observed under a non-superuser role, which PGlite cannot show. A test-correctness
  change wearing a performance change's clothes; its own branch, its own review
- **Payments follow-ups** — the Mode 3 inbound Stripe webhook endpoint's **security half is DONE
  (#49)**: `POST /webhooks/stripe/:tenantId`, per-tenant signature verification, tenant resolution,
  settle. What remains on it is the **`recordSale` sale-chaining hand-off**, deferred because it
  needs the till / working-orders model before a settled webhook can chain a sale (the `server_id`/node
  rekey it also needed **landed as #54**). Also still open: the pre-existing `forward` retry backoff and the reconcile remediation UI
- **Workforce follow-ups (D2, #50)** — none blocking. (1) **Swap-workflow hardening** (Copilot,
  deferred): `acceptSwap` has no "requested-only" status guard, and `requestSwap` doesn't verify the
  return shift is owned by `toPerson`. Latent today — the manager approve/reject slice that produces
  the `approved` / `rejected` statuses isn't built and nothing consumes swaps yet; closing the first
  guard needs a new permanent error code + TDD. (2) **Guardrail advisory notes:** `break_owed` /
  `night_work` breaches surface obligations on ordinary shifts (callers filter by `kind`), and
  `weekly_rest` under-reports at roster edges **by design** (documented safe — judging edge weeks
  needs the roster period boundaries passed in). (3) **Supersede** self-join could be a single
  `UPDATE … RETURNING` (deferred — concurrency-critical; the partial unique index is the real
  serialiser, pinned by the concurrency test)
- **An open product question** — the orphan drift gate holds a customer's money pending a human, and
  the hold is unbounded today because nothing re-sweeps a closed period. Defensible before
  production; deserves a decision before it
- **A second open product question** — `waitron-provision instance` now applies any pending database
  migrations every time it runs ([#16](https://github.com/clintongormley/waitron/pull/16)), and
  `status` tells operators to re-run it. Against a shop that is trading, that can lock tables until
  the migration finishes. Whether it should be gated — a flag, a refusal, a louder confirmation —
  is undecided. **Smaller than it first looked:** the cloud design (#19) gives every venue its own
  database and its own server, so the blast radius is one shop rather than every customer at once,
  which is what an earlier framing of this question assumed
- **A deferred design question from the sale-settlement model (#39)** — the €0, tenderless "fully
  comped sale" path is built and settles at the settlement instant (`new Date()`), deliberately NOT
  backdated to the invoice's `issued_at` (which in invoice-first mode is when the invoice printed, not
  when the comp was finalised). What is unresolved is a till-UX question, not a fiscal one: is a comp
  ever *finalised long after the invoice printed* — the invoice-first case — a real flow a server would
  perform, or only a theoretical one? It bears on piece 4 (invoice-first mode) and sub-project 7 (the
  till); nothing needs deciding until the till is designed. Recorded so it is not lost
- **Fiscal follow-ups** — a partial index on `acks`, a sargable reconcile period filter. Both gated
  on scale that does not exist yet
- **Provisioning and credentials follow-ups** — test-infra duplication, `bin.ts` connect-before-
  validate ordering, `rotate` coupled to `PURPOSES`. A sibling of that last one, still undecided:
  the credential READ path (`getCredential` / `tryGetCredential`,
  `packages/credentials/src/store.ts`) runs the shape guard (object, non-null, non-array) but not
  `validatePayload`, so a row sealed under an older `PURPOSES` field-list is returned with a missing
  field as `undefined` rather than rejected — a fail-loudly-vs-keep-serving design call worth
  settling before the first consumer relies on it (migrated from a since-deleted memory note,
  2026-08-02). Four more carried from
  [#11](https://github.com/clintongormley/waitron/pull/11), none claimed: password redaction in
  `applyInstance` is enforced by listing the statements that carry a secret rather than structurally,
  so the next statement added is unsafe by default; `bin.ts`'s `ask()` is real logic on the
  coverage-excluded side and has already shipped one bug; `ApplyDeps.database` and the action list are
  two sources of truth for the same database name; and an order-tracking test fixture is duplicated in
  two suites
- **The `tenant` command is unplanned**, and its design carries a known defect: the
  [provisioning tool design](superpowers/specs/2026-07-29-provisioning-tool-design.md) §4 gives its
  idempotency check as "look up `tenants` by NIF", which cannot work — the row-level security policy
  hides a tenant from a connection that has not already said which tenant it is, which a lookup
  *preceding* that knowledge cannot do. Attempt the insert and catch the unique-violation instead.
  The spec carries a dated note; the mechanism still needs replacing
- **Stripe is unprovisioned for the deli.** The payments code is complete and verified against a live
  sandbox, but no real account exists for the venue that has to be trading by January
- **Four SumUp questions are unverified, and one of them can invalidate a design already on `main`.**
  They are listed in
  [the SumUp provider design](superpowers/specs/2026-07-30-sumup-card-present-provider-design.md) §7
  under *"do not build on these without checking"*, so nothing is lost — but nothing points at them
  from here either, and they want answering **before** the SumUp provider is built rather than during.
  The load-bearing one is whether the card reader still works standalone and offline once it has been
  paired to SumUp's cloud service. If it does not, the outage path in
  [the deli hardware design](superpowers/specs/2026-07-30-deli-hardware-design.md) §5 has to be
  rewritten — that document assumes a card can still be taken when the internet is down, which is the
  whole reason the hardware was chosen. The other three: whether we may *supply* the idempotency key
  rather than only read it back, whether reader webhooks are signed the same way online ones are, and
  whether `void` maps onto the refund endpoint. Both specs carry provenance tables; **this entry
  deliberately restates no external fact of its own** — including the comparison with Square's API and
  the card rates, which are sourced in the hardware design (§7 and its provenance table) and are the
  kind of vendor claim that goes stale silently if copied into a second place. Read them there. The
  rates in particular are already flagged there as needing confirmation against an actual contract,
  not a pricing page
- **The three alta builders in `packages/fiscal-verifactu/src/backend.ts` are now triplicated.**
  `recordSale`, `recordCorrection` and `recordSubstitution` (the last added by the F3 canje branch) each
  repeat the same alta-assembly **head** — `currentSif` / `legalNameFor`, the `desglose` map with
  `CalificacionOperacion: "S1"`, and `cuotaTotal = sumDecimals(vatBreakdown.map(tax))` — and the same
  **tail** — `appendToChain(… { tipo: "alta", saleId, entorno, input }, sif)` → `tx.insert(envios)` →
  the `FiscalRecordRef` return. Deferred, not skipped: these are UNREPAIRABLE-record builders (CLAUDE.md
  §5), so a de-dup refactor needs its own review and a huella-invariance re-run across all three
  (CLAUDE.md §4) rather than riding in on a feature branch. The safe seam if done later is a helper
  taking the already-assembled `Omit<AltaInput, "Encadenamiento">` and running the shared tail (zero
  huella risk — nothing about what is hashed moves), plus a small `buildDesglose(vatBreakdown)` for the
  head. The per-method bodies (`TipoFactura`, the rectificativa vs `FacturasSustituidas`/`Destinatarios`
  fields, positive vs negative totals) stay where they are. **Two more duplications the F3 branch
  surfaced, deferred with the same triplet:** the `fechaFromStoredDay` offset-cancellation algebra
  (recovering the fiscal date from a stored day) is now identical across all three builders, and
  `recordSubstitution`'s substituted-ticket loop reads each F2 ticket one query at a time — an N+1 a
  single `sale_id = ANY(...)` collapses. All of it lands together, behind the same review and
  huella-invariance re-runs across the three builders
- **F3 canje open questions (#51) — asesor / XSD.** Four, none blocking a build: the piece is done
  and its `Destinatarios` shape was verified against the committed AEAT schema, but confirm each
  before a real F3 is filed. (1) The foreign `IDOtro` recipient path is typed but **refused at the
  backend** pending the asesor's `IDType` shape. (2) Whether a **separate F3 series is mandatory** is
  unconfirmed — `recordSubstitution` reuses the `standard` series today. (3) Cross-SIF F3 (a canje
  against a ticket issued by another SIF) is a sound **inference**, not confirmed. (4) An asesor / XSD
  confirmation of the `Destinatarios` shape is still wanted before the first real filing
- **A concurrent-corrective race in settlement is untranslated.** If a rectificativa commits between
  `settleSale`'s opening read and its `sale_settlements` INSERT, the coverage trigger recomputes the
  net and raises a raw Postgres `P0001` (the trigger's `RAISE EXCEPTION` carries no dedicated
  SQLSTATE), which `settleSale` does not translate to a clean `sale.*` code — it catches only WT002
  and the `sale_settlements` unique violation. **Fail-closed** (the settlement rolls back; nothing
  wrong is written) and **unreachable in the headless slice** — it needs same-sale correction and
  settlement interleaving, which only the till UI (sub-project 7) makes possible. The fix, when it
  becomes reachable: give the coverage `RAISE EXCEPTION` a dedicated SQLSTATE, the same way
  `tenders_reject_post_settlement` got WT002, and translate it in `settleSale`
- **Collapse the per-module drizzle migration chains into per-module baselines (pre-production
  cleanup, not now).** Migrations are already **per-module** — 8 independent sets in
  `packages/migrations/migrations.manifest.json`, each package with its own `drizzle/` dir, numbered
  sequence and `__drizzle_migrations_*` tracking table, replayed in manifest order by
  `packages/migrations/src/apply.ts`. The debt is the **length** of each chain: 78 source SQL files
  across the eight sets, 30 in `packages/db` alone (`0000`–`0029` as of 2026-08-06), a real fraction
  of them pure development churn — `0016_add_node_id.sql` is `ADD COLUMN`/`ADD CONSTRAINT` retrofitting
  `node_id` onto tables that in a fresh build could be born with it, and the payments/fiscal
  `add_node_id`+`rekey` pairs are the same shape. CLAUDE.md §3 makes a collapse legitimate: nothing is
  deployed, schema drops and recreates, CI builds fresh, so **nothing depends on the history — only the
  end state**. This is a build refactor, not a fiscal operation.
  - **Not a `drizzle-kit generate` one-liner.** The valuable migrations are hand-written custom SQL —
    `FORCE ROW LEVEL SECURITY`, `CREATE POLICY`, GRANTs, the immutability triggers — that Drizzle does
    **not** emit (`packages/db/drizzle/0017_nodes_rls.sql`'s header says so in as many words). A naive
    "delete all, regenerate" gives the `CREATE TABLE`s and **silently drops every FORCE RLS, policy and
    grant** — the §1 "reading is not verification" trap, invisible to eyeballing and catastrophic. Each
    baseline is a careful hand-fold: generated final DDL **plus** the interleaved custom SQL, arriving
    at the same end state, plus regenerated `meta/_journal.json` + snapshots so the next
    `drizzle-kit generate` diffs against a real baseline rather than a stale one. The migrations also
    double as documentation (the `0017` header is an essay on why a grant is SELECT-only, with a dated
    re-audit) — the collapse must carry that commentary forward, not just the DDL.
  - **Verification is the actual work, and the safety net already exists.** A collapse touches every
    package, so per §4 it must be proven against the **whole unfiltered suite**, not scoped shards. The
    fiscal `inmutabilidad` guard scans every `tenant_id`-bearing table for FORCE RLS + policy; the
    RLS-isolation, `english-only` and reachability guards back it. A dropped clause turns a guard
    **red** (recoverable) rather than corrupting a chain (not) — which is exactly why this is safe to
    do here and would not be in production.
  - **Timing: once, late in the pre-production window — not a priority now.** The churn is cosmetic: a
    fresh build applies all 78 in seconds, and the only real cost is cognitive (replaying the chain to
    see the actual schema). The right trigger is *after the last foundational reshape lands*. The
    `node_id` re-key (#54) was one such reshape and left the corrective migrations above; replication
    is still-pending shared infra (single-writer-per-row groundwork) that may touch many tables, so
    collapsing now risks paying the fold-and-verify cost twice. Collapse **once**, near the end of
    pre-production.
  - **Unit:** per-module baselines (a single `0000_baseline.sql` per set), matching the manifest — not
    one repo-wide file, which would fight the per-set tracking tables. **Cheaper middle option** if
    relief is wanted sooner: squash only the corrective churn (fold the `add_node_id`/`rekey` sequences
    back into their originating table migrations) and leave the custom RLS migrations as separate
    readable units.

---

## Task: consolidate the session-memory notes against this file

The per-topic memory entries were the only record of priorities before this file existed, and now
they overlap it. Left alone they will disagree with it, and memory is the copy nobody can review.

Three specific problems, all present today:

- **Dangling references.** Entries cite pull requests up to #35. The repository was recreated for the
  licence change and numbering restarted at #1, so those point at nothing. Commit SHAs in them
  dangle for the same reason.
- **Overlap.** Several are titled "follow-ups" and hold exactly what the **Debt and odd jobs**
  section above now holds.
- **A known contradiction.** One entry records that `CLAUDE.md` still says the opposite of it.

What to do: move anything that is genuinely a *task* into this file, keep in memory only what memory
is for — durable preferences and hard-won lessons that change how work is done — and delete the
rest. Strip or annotate the dead PR numbers wherever the surrounding fact is still worth keeping.

**A worked precedent, 2026-07-31.** The same treatment was applied to a session handoff rather than a
memory note, and it is the shape to copy. `docs/handoffs/2026-07-31-migrate-gate-landed.md`
listed six loose ends in a file that is **not committed** — `docs/handoffs/` is gitignored, so
everything in it disappears the moment someone tidies up, which `CLAUDE.md` §6 tells them to do once
the work is finished. Its unclaimed items are now in the sections above; its history is in the git
log; the file was deleted. Two of its items had also gone stale in ways only a check against the tree
would reveal — one had already shipped, and one open question had been narrowed by a later design
decision. **Do not migrate a note without first checking each item against the current tree**; the
value is in what has changed since it was written, not in the copying.

---

## How to keep this file honest

Update it in the change that makes it stale, the same rule `CLAUDE.md` §7 applies to itself. In
particular:

- When a piece lands, move it out of **Next** rather than leaving it to be discovered.
- When a question is closed on primary source, say so and stop calling it blocked.
- Delete finished items. This is not a history; the git log is.
