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

**Finish the fiscal story before building anything user-facing.**

The reasoning that set this order: the till has to be built against the invoicing model, so building a
counter screen while that model was mid-change meant building it twice. **That premise has now
expired (2026-08-03).** The **SIF topology** is settled (#33) and the four-piece fiscal sequence below
is complete — #55 landed the last of it — so the invoicing model the till builds against is no longer
moving. The fiscal-first ordering has therefore done its job; what comes next is the **"then reassess"**
inflection the fiscal sequence names (keep going fiscal — reporting, daily close — or turn to the
till), and it is deliberately **not decided here** — that is the next reprioritisation's call. The
fiscal work was also the part that cannot be repaired afterwards — invoice numbers are never reused
and records are hash-chained — which is why it went first, where care pays best.

**Prioritisation is by soundness, not the calendar (decided 2026-08-02).** Waitron will be finished
before the deli is ready to trade, so the deli's 1-Jan-2027 legal deadline is *not* a reason to rank
one piece of work above another — order by dependency, correctness, and de-risking the most-reused /
most-uncertain foundations first. The fiscal-first ordering above stands on the **dependency** it
names (the till is built against the invoicing model), not on the deadline. This is the principle
under which the app-level replication mechanism was proven (see the SIF follow-ups) *before* more
feature work resumed.

**The trade being accepted:** there is no application a person can use. Thirteen packages and one
server app exist; `packages/ui` has six primitives and nothing consumes them; there is no
`apps/till`. The system can reconcile a Stripe account and file with AEAT, and cannot ring up a
sandwich. That is a deliberate ordering, not an oversight, but it should be revisited at each
reprioritisation rather than assumed. **(Superseded 2026-08-05:** the Counter POS walk-up cash-sale
slice — `apps/till`, consuming `packages/ui` — **landed as #60**; a person can now ring up a sandwich.
See *Now* and sub-project 7 under *Not started*.**)**

---

## Now

| What | State |
| --- | --- |
| **Sale settlement model** — design | **Merged** (#20) |
| **This backlog** | **Merged** (#21) |
| **Pre-push hook skips deletions** | **Merged** (#23) |
| **Scoped CI** — stop running every check on every push | **Done.** Both merged: #25 (the `ci` gate) and #27 (the scoping). Against the 7m20s baseline: a documentation-only pull request now takes **44s**, and a full unfiltered `push` on `main` **4m12s**. The scope resolution it shipped skipped every package's tests on a root-config pull request; that is fixed under **Debt and odd jobs**, where one follow-up (what `test-light` reports) remains |
| **Scoped pre-push hook** — the same treatment for the local gate | **Merged** (#31). Scopes `typecheck` and `test:coverage` to the changed packages and their dependents, adds the sign-off (DCO) check CI was catching for us, runs `test:coverage` rather than `test`, adds `pnpm install --frozen-lockfile`, and skips `lint` on a documentation-only push. Measured on this machine on 2026-08-01, one crafted push per shape, `TESTCONTAINERS_RYUK_DISABLED=true`, wall clock bracketed in `time.time()` — `main`'s hook (`558c62b`, one run each) → #31's: deletions-only 9ms → 7-9ms (unchanged, #23 already did that); an **unsigned commit 104s and exit 0 → 27-36ms and exit 1**, because `main`'s hook has no sign-off check at all and so charged a full run and then let it through; documentation-only 105s → **3.1-3.5s**; a push to `packages/ui`, which no other package depends on, 105s → **8.2-8.8s**. **It is not faster everywhere.** A `packages/db` push is 112s and a root-config or lockfile push 116s — both SLOWER than `main`'s 105s, because this hook also runs `test:coverage` rather than `test` and installs first. Scoping pays on the leaves, not on the trunk; **Debt and odd jobs** carries the expansion sizes and what the hook still does not cover. **Re-measured the same way on 2026-08-01**, after the tree-wide guards moved into the repo-level project and the hook grew a step for it (two runs per shape): documentation-only **3.17-3.59s** and an unsigned commit **30ms, exit 1**, both unchanged — neither path reaches that step; `packages/ui` **10.75-11.20s**, the whole of the ~2.4s being the step; `packages/db` **113.22-116.81s** and root config **116.48-117.98s**, where it costs nothing at all, because the root `test:coverage` script was already running that project on the global path |
| **Cloud storage model** — design | **Merged** (#19), corrected by **#22** |
| **Local server as SIF, active-active + failover** — design | **Merged** (#33). Promotes the arch-design fallback (the *server* is the SIF, not each till) to the primary model; adds active-active chaining, a single relocatable submitter, human-driven boot-time failover, and an optional dedicated cloud server that can hold any role. **Topology only** — the buildable pieces are follow-ups below |
| **Sale settlement model** — implementation | **Merged** (#39). Piece 1 of the fiscal sequence done: tip and amount-charged off the frozen `sales` row, tip onto `tenders.tip_amount`, append-only `sale_settlements`, one `settleSale` writer (immediate mode calls it in the same transaction, so the two paths cannot drift — design D6). Coverage moved to the `sale_settlements` INSERT plus a `tenders` post-settlement guard (SQLSTATE WT002). [plan](superpowers/plans/2026-08-01-sale-settlement-model.md), [design](superpowers/specs/2026-07-31-sale-settlement-model-design.md) (with a "Ratified in implementation" note recording three decisions settled during the build) |
| **Rectificativas** — implementation | **Merged** (#46). Fiscal sequence **piece 2 done**: R5 corrective invoices for simplified tickets — `corrects_sale_id` link + negative-total allowance, the four AEAT rectificativa columns round-tripped so a filing carries its mandatory `TipoRectificativa`, `recordCorrection` backend + core entry point, and the mandatory separate `rectificative` series guarded. [plan](superpowers/plans/2026-08-02-rectificativas.md). Cross-till/SIF corrections: AEAT permits a correction from a **different SIF** (subsanación/anulación, dev FAQ 4-Dec-2025); the rectificativa extension is a sound **inference** (identity-linkage) pending asesor confirmation — findings §13. R1/B2B and R2–R4/accounting deferred |
| **Workforce — registro de jornada** — implementation | **Merged** (#47). Sub-project 16 legal floor: new `packages/workforce` + `packages/workforce-es`, immutable append-only `time_entries` (role-revocation floor), clock in/out/break, supervisor-gated append-only corrections + registro export, **both-model** overtime (daily-accrual + period-net, convenio-selectable), and a single-active-writer tamper-evidence hash chain. [plan](superpowers/plans/2026-08-02-workforce.md). A migration-isolated parallel lane to the fiscal work |
| **App-level cross-server sync** — design | **Designed** (this session). Application **outbox** (`sync_log` + generic capture trigger, apply as the app role under `withTenant`) — one reusable mechanism, no new DB privilege. Decisions settled with the owner: explicit `server_id` on the commercial tables too, **true active-active** for the deli, and a **payments fast lane**. Built later (the `server_id`/node rekey it waited on **landed as #54**; still needs the feature schemas to settle); 9 container gates first. Spec: [2026-08-02-app-level-sync-design.md](superpowers/specs/2026-08-02-app-level-sync-design.md) |
| **Close Q13 and Q15 on primary source** | **Done** (#37). Q13 (tips) and Q15's core CLOSED on primary/official source ([findings](compliance/verifactu-findings.md) §§11–12); Q14 (precuenta) stays open — see the advisor gap below |
| **Consolidate the session-memory notes** | Not started. They predate this file and now overlap it — see below |
| **Reporting — daily close** (sub-project 8, first slice) | **Merged** (#56). Read-only `@waitron/reporting`: `computeDailyClose(tx, input)` → a per-`(tenant, node, business-day)` close — a VAT summary (base + tax per rate, corrections netted) anchored on **issuance**, and an operational cash-up (by till + tender method) anchored on **settlement**, plus record counts. Derived, no new tables/migration; DST-aware business-day bucketing with a configurable cutover; headless (a till/UI consumes it later). The F3-canje VAT exclusion is confirmed on primary source (FAQ v1.3 §27 — *modelo 303* counts R1–R5, not F3). [design](superpowers/specs/2026-08-04-daily-close-reporting-design.md), [plan](superpowers/plans/2026-08-04-daily-close-reporting.md). Two follow-ups under *Debt* |
| **Locations — provision a sellable venue** (sub-project 6) | **Merged as #57** (2026-08-04). Reshapes fiscal identity to country/territory-driven: `tenants.nif` → `country` (ISO-3166 alpha-2) + `tax_id`, unique on `(country, tax_id)`; `locations` gain `fiscal_territory` + address + `time_zone` (IANA) + `day_cutover`; `nodes` record the resolved `filing_module` + `tax_module`. Adds `resolveFiscalModules` (`"ES-common"` → Veri\*Factu + IVA, **every other territory refused** — new `fiscal.regime_not_implemented`, fired both as a provisioning input refusal and as a runtime hard-error, defence in depth), a deterministic `obligadoTenantId(country, tax_id)` (so insert-and-catch-unique reuse works under RLS without a forbidden NIF lookup), `planVenue` (pure planner) / `applyVenue` (one transaction; idempotent for the obligado via `ON CONFLICT DO NOTHING`, but each run otherwise ADDS a shop — location/till/node/SIF at installation #2/fresh chain), and the `waitron-provision venue` CLI. Retires and **deletes** the stale `apps/server/sql/bootstrap-tenant.sql`. A venue is now provisionable such that `recordSale` can immediately chain a sale. [design](superpowers/specs/2026-08-04-locations-provisioning-design.md), [plan](superpowers/plans/2026-08-04-locations-provisioning.md) |
| **Catalogue — priced products the till can sell** (sub-project 7 unblocker / 18 seed) | **Merged as #59** (2026-08-05). New headless `@waitron/catalogue`: a **catalogue** (named menu) → **products** model a till reads to build a basket. A tenant owns catalogues; products belong to a catalogue; a **location is assigned a catalogue** (N identical delis share one; a deli + restaurant get one each, so the restaurant never sees deli products). **Categories** are a tenant-wide analytics taxonomy **snapshotted onto each sale line** (the no-`product_id` snapshot rule leaves nothing to join back through). Prices are stored **VAT-inclusive (gross)** and reversed to base/cuota by the **difference method** (cuota = gross − base, so `total == Σ(base+cuota)` exactly and the customer is charged the marked/weighed gross to the céntimo). Weighed items are in the model now (`pricing_unit ∈ {each,weight}`); VAT via a semantic `vat_class` → a minimal ES-común IVA rate resolver (21/10/4/0, primary-source receipted). `recordSale` gains an optional caller-supplied `vatBreakdown` (used verbatim; else `buildVatBreakdown` as before) + a line `category`, plus a `sale.total_mismatch` guard — **no fiscal-backend change**. Proven end-to-end (integration test + a demo that ran live: chained `alta A/1`, `total == Σ(base+tax)`). Headless: no till UI, no working-order producer, no management surface. [design](superpowers/specs/2026-08-05-catalogue-model-design.md), [plan](superpowers/plans/2026-08-05-catalogue-model.md). Follow-ups under *Debt* |
| **Counter POS — walk-up cash sale** (sub-project 7, slice 1 / 7a) | **Merged as #60** (2026-08-05). The first thing a person can actually operate: a new browser app **`@waitron/till`** (Lit + Vite) driving a same-origin till HTTP surface in `@waitron/server` (`src/till-api.ts`). Lock-screen PIN login (pre-login staff roster + `POST /api/session`) → a **layout-driven** counter screen composing product-grid / basket / total / pay widgets from a `LayoutDef` → one **cash** tender → a filed Veri\*Factu **ticket** with its AEAT QR → new sale. The server re-prices the basket **authoritatively** (`recordTillSale` — the browser sends no price), files through the real `VerifactuBackend` chain in one transaction, and attributes the sale to the **logged-in operator** (never a browser-sent id). Stands on the three foundations that just landed: Identity (#58) for the roster + PIN login, Catalogue (#59) for priced products, Locations (#57) for the venue the till points at via `WAITRON_TILL_*`. Proven end to end over real Postgres (login → menu → mixed-rate sale → legal ticket + an intact fiscal chain across two sales) and by a runnable `pnpm --filter @waitron/server demo:till` script; `apps/till/README.md` documents the dev run. **Cash only**, no offline/card/hardware/refunds; the layout & receipt **editors** and slices **7b/7c** are later — deferred edges under *Debt and odd jobs* → **Counter POS follow-ups**. [design](superpowers/specs/2026-08-05-counter-pos-walkup-sale-design.md), [plan](superpowers/plans/2026-08-05-counter-pos-walkup-sale.md) |

---

## Next — the fiscal sequence

Four pieces, in this order. **All four have now landed** — 1 (#39), 2 (#46), 3 (F3 canje, #51) and 4
(invoice-first, #55, headless). They were sequenced rather than parallelised because each adds
a migration to `packages/db`, and `packages/db/drizzle/meta/_journal.json` conflicts on every
concurrent branch. The collision is **per package**, not repo-wide — five packages carry their own
`drizzle/` directory and journal (`credentials`, `db`, `fiscal-verifactu`, `payments`, `scheduler`),
so work touching a different package's migrations can still run alongside these.

| # | Piece | Why here |
| --- | --- | --- |
| 1 | **Sale settlement model** — **done (#39)** | Everything else assumes it. Took the tip and the amount charged off the frozen sale row so an invoice can exist before payment does |
| 2 | **Rectificativas** — R5 (simplified tickets) — **done (#46)** | The only lawful way to change an issued invoice. Unblocked piece 4. R1/B2B and R2–R4/accounting deferred (need F1 issuance / the asesor) |
| 3 | **F3 canje** — "can I have a proper invoice?" — **done (#51)** | Was unmodelled, and issuing an ordinary invoice instead would double-declare the sale. Ordinary trade in a restaurant, not an edge case. `recordSubstitution` files a positive-total F3 alta with `FacturasSustituidas` + `Destinatarios`, reading the substituted F2 tickets without annulling them (at-most-once, F2-only, series-purpose-guarded, unsettled) |
| 4 | **Invoice-first mode** — **done (#55, headless)** | The fiscal/DB half shipped earlier (#39): a deferred `recordSale` chains and files the invoice with no payment, `settleSale` closes it later. This slice filled the headless remainder — settling a *corrected* invoice-first sale: migration 0021 nets rectificativas into the `SECURITY DEFINER` coverage function (`due = total + Σcorrections + tips`), `settleSale` nets corrections in lockstep (an app-level check in the same identity), `listOutstandingSales` (`@waitron/core`) excludes correctives / F3 canje substitutes / settled / voided and nets corrections into `amountDue`, and a `settle-invoice-first` demo script walks issue → list → correct → list → settle-at-net → list. The **till UI stays out** (sub-project 7) |

Design and sources for all four:
[2026-07-31-sale-settlement-model-design.md](superpowers/specs/2026-07-31-sale-settlement-model-design.md)
§8, and [compliance/verifactu-findings.md](compliance/verifactu-findings.md) §§7-10. Invoice-first
carries its own design and plan:
[2026-08-03-invoice-first-settlement-design.md](superpowers/specs/2026-08-03-invoice-first-settlement-design.md)
and [2026-08-03-invoice-first-settlement.md](superpowers/plans/2026-08-03-invoice-first-settlement.md).

**Reassessed 2026-08-04 — reporting AND the till track, in parallel.** With the fiscal sequence
complete, the owner chose to run both directions at once: **reporting** (sub-project 8) and the **till
track** (Locations 6 → Identity 5 → Counter POS 7), starting with Locations as the foundational
unblocker (nothing could provision a sellable venue then). Prioritisation stayed by soundness, not the
calendar. Reporting's first slice — the daily close — **landed as #56**; **Locations 6 landed** (merged as #57,
2026-08-04); and **Identity 5's headless first slice has now landed** (merged as #58, 2026-08-05), so
the till track's remaining foundational step is **Counter POS 7** — the first thing a person can
actually operate. See *Now* and *Not started* for each.

---

## SIF topology follow-ups (from #33)

The [server-as-SIF + failover design](superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md)
decided the **topology only**; its §14 defers the buildable pieces, each to its own spec:

- **The sync / replication protocol** between the two local servers and the cloud mirror — the
  largest piece. **Both gating container prototypes are now DONE (2026-08-02) and they DECIDE the
  mechanism: cross-replication must be APPLICATION-LEVEL, not native Postgres logical replication.**
  Proven on real `postgres:18-alpine` and independently re-verified
  ([findings](superpowers/specs/2026-08-02-replication-force-rls-prototype-findings.md)): (1) a
  non-BYPASSRLS app role with the tenant context set INSERTs a foreign server's same-tenant rows
  verbatim under FORCE RLS — app-level apply works; (2) native logical replication's apply worker
  **categorically refuses** to write into any RLS-enabled table under a non-BYPASSRLS role
  (`cannot replicate into relation with row-level security enabled`) — the only native lever is
  BYPASSRLS/superuser, which the deployment-role constraint forbids. The block keys on RLS being
  enabled *at all*, so it hits **all ~8 RLS tables**, not only the fiscal chain. The cheaper fork
  (turn RLS off on the replica copies + native replication) strips the fiscal tables' defense-in-depth
  and is declined deliberately. **The app-level sync layer is now **designed and reviewed** (this session):
  [2026-08-02-app-level-sync-design.md](superpowers/specs/2026-08-02-app-level-sync-design.md). It
  finalises the held first draft (`2026-08-01-sif-sync-replication-protocol-design.md`, branch
  `docs/sif-sync-protocol-design`) with an application **outbox** (`sync_log` + one generic capture
  trigger; apply as the app role under `withTenant`, the proven path), the FK apply-ordering rule
  (origin seq-order is a topological order for free — fixes the held draft's missing `sales`/
  `working_orders`), and one reusable enrolment mechanism. **Owner decisions settled (2026-08-02):**
  explicit `server_id` on the commercial tables too, **true active-active** for the deli, and a
  **payments fast lane**. Carries **9 container prototype gates** (§11 — esp. the capture trigger +
  echo-suppression under FORCE RLS, and non-superuser logical-slot consumption for the native-decode
  backfill option) that come before any build. The `server_id`/node rekey it depended on has **LANDED
  (#54, 2026-08-03, under the term `node`)**, so the sync spec can now assume the `node_id` columns
  exist rather than treating the rekey as a prerequisite.
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
- **#33's "the SIF is the server" premise now has schema support — the rekey LANDED as #54
  (2026-08-03), under the term `node`.** A `nodes` table plus a re-key of the fiscal chain / series /
  SIF identity from `till_id` to a new `node_id`: `registro_sif` (one live SIF per node), `cadenas`
  (chain head `(tenant, node)`), `registros_facturacion` (`(tenant, node, secuencia)`),
  `invoice_series` (`(tenant, node, code)`); `till_id` kept as an informational snapshot on
  `registros_facturacion`/`sales`. **The code says `node`, not `server`** — #33's "server" IS this
  `node` (US "server" = waiter; Waitron's staff concept is `persons`/`employments`, and this is a
  machine). The container prototype the gap called for became the real-PG concurrency gate
  (`chain.node-rekey.concurrency.test.ts`); the huella is byte-identical (`node_id` is our metadata,
  stamped after hashing, never in the hash). Design/plan:
  [2026-08-03-node-id-rekey-design.md](superpowers/specs/2026-08-03-node-id-rekey-design.md). Node
  references are tenant-consistent composite FKs `(tenant_id, node_id) → nodes(tenant_id, id)` on the
  commercial/series tables (`sales`, `working_orders`, `payments`, `invoice_series`); the immutable
  chain tables (`cadenas`/`registro_sif`/`registros_facturacion`) keep plain `node_id` FKs (written
  only through the guarded chain-append path). Scope was **rekey + wire one node per venue**;
  active-active, failover, two concurrent SIFs + disjoint-series, and the submitter role stay out (the
  follow-ups above).
  - **CLOSED (2026-08-04, #57) by Locations sub-project 6 — production node-provisioning is now wired.** The
    earlier gap read "`apps/server/sql/bootstrap-tenant.sql` still creates a till, not a node, and a
    first-class `provision node` CLI is unbuilt … nothing provisions a production node yet." Resolved:
    `waitron-provision venue` now `insert into nodes …` under a location and registers its SIF
    (`applyVenue` → `registerSif`) as part of standing a venue up, and `bootstrap-tenant.sql` was
    **deleted**. `apps/server/src/provision-till.ts` (`provisionNode`) remains the standalone
    registration path for a reimaged or bare node. The file is still named `provision-till.ts`; a
    first-class `provision node` subcommand rename stays a nicety (see the follow-ups below). See *Now*.
  - **Deferred follow-up — `CLAUDE.md` §5's "nothing blocks a sale" rewrite** stays open (see the bullet
    above): this slice changed no sale-blocking behaviour, so the rewrite lands with the server-as-SIF
    *behaviour* (failover), not this schema slice.

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

Nothing below has any code, **except: sub-project 16 (workforce) — *registro de jornada* floor (#47),
D2 scheduling (#50), only D3 remains; sub-project 8 (reporting) — the daily-close first slice landed
(#56); sub-project 6 (Locations) — the provision-a-sellable-venue slice merged
as #57 (2026-08-04); sub-project 5 (Identity) — the headless first slice merged as #58 (2026-08-05)
(persons + sessions, PIN login, `authorize()`, staff API, void/refund authorization); and sub-project 7
(Counter POS) — the walk-up cash-sale slice (7a) merged as #60 (2026-08-05)
(`@waitron/till` + the server till API).**

| Sub-project | Note |
| --- | --- |
| **7 — Counter POS UI** | **Slice 1 (7a — walk-up cash sale) landed as #60** (2026-08-05; see *Now*): `@waitron/till` + the server till API ring one cash sale end to end. Remaining slices: **7b park & retrieve** (hold a working order and pick it up again) and **7c prepare & collect** (kitchen prep states + the working-order **amendment log**, art. 29.2.j LGT — the log rides with 7c deliberately, because nothing writes working orders until park/retrieve produces them, and a log with no producer cannot be shown to work). Slice-1 deferred edges under *Debt and odd jobs* → **Counter POS follow-ups** |
| **5 — Identity** | **Headless first slice merged (#58, 2026-08-05).** `@waitron/identity` owns `persons` + `sessions` (FORCE-RLS tenant isolation, now also scanned by fiscal-verifactu's `inmutabilidad` guard), salted-PIN hashing, a role/permission catalog, `authorize()` (operator session + supervisor `{personId, pin}` override), `loginWithPin` / `endSession`, and a `person.manage`-gated staff API. `recordVoid` / `recordCorrection` now require `sale.void` / `sale.rectify` authorization; `sales.authorized_by` / `sales.operator_id` + `payment_refunds.authorized_by` seams and a `waitron-provision venue` admin seed are in place. Remaining sub-project 5 scope (mid-shift-suspension enforcement, the discount gate, till-refund enforcement, the workforce-gate consolidation, branded ids) is under *Debt and odd jobs* → **Identity follow-ups**. The human-facing call sites (must-be-logged-in to ring, till refunds must be authorized) land with the counter POS (#7) |
| **6 — Locations** | **Provision-a-sellable-venue slice merged (#57)** (2026-08-04; see *Now*) — the foundational till-track unblocker. Country/territory-driven fiscal identity, `resolveFiscalModules` (común → Veri\*Factu + IVA, others refused), `planVenue` / `applyVenue` and the `waitron-provision venue` CLI stand up tenant → location → till → node → SIF → series so `recordSale` can chain a sale; the stale `bootstrap-tenant.sql` was **deleted**. Remaining sub-project 6 scope (multiple locations, editing/deactivation, the #33 SIF-topology deferrals) is under *Debt and odd jobs* → **Locations follow-ups** |
| **8 — Reporting** | **Daily-close first slice DONE (#56)** — `@waitron/reporting`'s `computeDailyClose` (VAT summary + operational cash-up, two anchors). Unstarted next slices: a **frozen/signed *cierre Z*** (numbered, immutable, with counted-cash / opening float / *descuadre* — the derived close deliberately leaves a clean seam for it), date **ranges** + the **monthly VAT return** (*modelo 303*) aggregation, and the reporting **UI** (belongs to the till, sub-project 7) |
| **16 — Workforce** | *Registro de jornada* legal floor **DONE (#47)**; **D2 scheduling DONE (#50)** — `convenio_config` surface (overtime de-hard-coded, single-sourced), shifts + `roster_versions` + `publishRoster`, absences/availability/shift_templates/shift_swaps, an **advisory** guardrail engine (`validateRoster` → `RosterBreach[]`; publish surfaces breaches but proceeds — owner chose warn+override) + a planned-vs-actual read model, and supersede-on-republish (partial unique index, one published roster per `(location, period)`). The overtime *rule* the both-model projection computes stays convenio-driven — an **asesor-laboral** call, not code. Remaining: **D3 payroll export** (integrate-not-build), plus the workforce follow-ups under *Debt and odd jobs*. Deferred edges from the floor: the registro export doesn't yet surface overtime (belongs to the payslip/D3); the correction period-fetch is a ±1-day window (a >1-day-relocation correction is out of the floor's scope, chained but maybe missed by the period fetch). A post-#47 `/finish-branch` review (landed as #52) corrected four floor defects: the registro export rendered UTC instead of local wall-clock; the tamper chain omitted a correction's reason/actor and the capturing till; correction precedence tie-broke on the unhashed `ingest_seq` (a floor-bypasser could reorder corrections undetected) — now on the hashed `sequence_no`; and a `clockIn`/`clockOut` TOCTOU (an unlocked state read before the chain-head lock let two concurrent same-person clock-ins append a double-`in` that undercounts worked time) — now serialized per person with a `persons` row lock proven by a real-PG concurrency test |
| **18 — Menu and allergens** | Allergen declaration is a **launch-day legal duty** (EU 1169/2011, RD 126/2015) |
| 10-15, 17, 19, 20 | Tabs, floor plan, KDS, tip payroll, bookings, online ordering, accounting export, opening hours, procurement |

The two marked **launch-day legal duty** are worth watching: they are not fiscal, they are not
optional, and they are currently as unstarted as the restaurant-phase items they sit beside.

**Card-collected tips are business income (new, 2026-08-01, #37).** A tip taken through the card
terminal — unlike cash handed straight to a waiter — is *ingreso* for the Impuesto sobre Sociedades and
*rendimiento del trabajo* with retención for the employee (IRPF / nómina). It does **not** touch the
factura or the huella (the fiscal path is unchanged and correct — findings §11), but it is a real
accounting/payroll duty for the **tip-payroll (13)** and **workforce (16)** tracks — integrate-not-build,
and it needs the tip attributed to the payer (which the sale-settlement model, piece 1, now does by
putting the tip on `tenders`).

---

## Debt and odd jobs

Carried from finished work. None of it blocks anything; all of it makes later work cheaper.

- **Counter POS follow-ups (sub-project 7, slice 1 / 7a — the walk-up cash sale). None blocking; each
  is a deliberate slice-1 boundary or a small review Minor, deferred rather than dropped.**
  - **TLS termination, LAN binding and serving the built bundle are deployment (#9).** In dev the till
    is served by Vite on loopback over plain HTTP, and the session cookie's `Secure` attribute tracks
    whether the server has TLS configured (`secureCookies: config.tls !== undefined`, `boot.ts`). The
    process is already TLS-**capable** (`tls.ts`, `WAITRON_TLS_*`); what #9 owns is production HTTPS
    with a local-CA trust root, binding to the LAN rather than `127.0.0.1`, and serving the built
    `apps/till` assets (dev runs the Vite server, not a bundle).
  - **Card / Terminal tender.** Slice 1 is **cash only** — `recordTillSale` refuses any non-cash
    method (`sale.unsupported_tender`). Card capture, the timed-out-card UX (retry / alternative
    tender / wait — already noted under the #33 SIF follow-ups), and tips-on-card wiring are a later
    slice.
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
      (CLAUDE.md §5 — the double-file is unrepairable). Deferred to the park/retrieve slice (7b), which
      is where working orders first get a persisted id.
    - **Return priced lines from `POST /api/sales` so the receipt is server-authoritative.** The ticket
      computes each per-line gross CLIENT-side from the login-time `TillProduct.unitPrice` (`lineGross`),
      because the sale response carries only `total` + `vatBreakdown`, no per-line amounts. In slice 1
      the catalogue is fixed at provisioning and cannot change mid-session, so Σ(line grosses) equals the
      server `total`; a future mid-session price edit would break that identity. Have `recordTillSale`
      return priced lines and render those instead (see the LINE-GROSS SOURCE note in
      `till-ticket-view.ts`).
    - **Consolidate the two per-request transactions** on `GET /api/products` and `POST /api/sales`.
      Each currently runs the `requireSession` session lookup in one `withTenant` transaction and the
      work in a second (`recordTillSale` opens its own), so a request pays two round-trips where one
      would do. Efficiency only (flagged in simplify); the `POST /api/sales` half needs `recordTillSale`'s
      transaction boundary reshaped so the caller can supply the already-open tx.
    - **Operator-UI money/locale is hardcoded es-ES.** `formatMoney` in the operator widgets formats in
      es-ES unconditionally — correct for slice 1's single-locale deli, but it must follow the operator
      UI locale once a locale switcher exists. (The RECEIPT is already locale-correct: it formats in the
      independent `invoiceLocale` from `GET /api/till`.)
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
  - **Daily-close VAT report vs the filed desglose diverge for gross-inclusive (catalogue) sales.**
    `@waitron/reporting`'s `computeVatSummary` recomputes cuota **multiplicatively** (`base × rate`,
    `vat-summary.ts`), which reproduces the filed cuota only for a sale filed via `buildVatBreakdown`.
    A catalogue sale files by the **difference method** (`gross − base`), so for such sales the daily
    close (the stated *modelo 303* source, #56) overstates cuota by a rounding céntimo per
    `(invoice, rate)` group and reports a gross matching neither the money taken nor the filed record.
    The filed difference-method desglose is **not persisted queryably** (only inside the hash-chained
    `registros_facturacion`; the per-rate *gross* is not stored), so reporting cannot recompute it —
    closing this needs the filed desglose **persisted** (a `sale_desglose` table, or the sale's
    `vatBreakdown` stored) and read by `computeVatSummary`. Its own slice (schema + migration +
    reporting). **Not reachable in production today** (headless — no catalogue sales until the till,
    #7); the caveat is documented in `vat-summary.ts`. Found by the finish-branch fresh-context review.
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
- **The pre-push hook is scoped now, and its DECISIONS are tested — most of the shell still is not.**
  The hook maps the push's changed paths onto workspace packages and runs `typecheck` and
  `test:coverage` against those packages and their dependents, skipping those two, **`lint`** and
  the repo-level suite entirely on a documentation-only push. `lint` is skipped there on a
  measurement, not a hunch:
  `pnpm exec eslint . --format json` lints zero Markdown files and zero files under `docs/`, so of
  what is in the tree today eslint reads nothing such a push contains. (Only the zeros are recorded
  here — a file count moves on the next commit, and `CLAUDE.md` §2 already carries what a receipt
  that goes stale costs.) The two configurations do not actually agree, and the hook's header
  records the gap: `eslint.config.js` does not ignore `docs/`, so a `docs/**/*.ts` file would be
  linted by `pnpm lint` and skipped by this path.
  `format:check` is NOT skipped, because `.prettierignore` covers `docs/` but not a root-level
  `CLAUDE.md` or `README.md` (`prettier --file-info` says `ignored: true` for the first and
  `ignored: false` for the other two, and a mis-formatted heading appended to `CLAUDE.md` makes
  `prettier --check` exit 1). It also closes two things that reached CI this session: a commit with
  no `Signed-off-by` (`git revert --no-edit` writes none), and coverage thresholds, which the hook
  never ran because `pnpm test` is not `pnpm test:coverage`.

  **How much a scoped push actually saves depends entirely on which package it touched**, and the
  spread is the whole width of the workspace. Expansion sizes, every member measured on 2026-08-01
  with `pnpm --filter "...<pkg>" ls -r --depth -1 --json` (15 members in total):

  | `...<pkg>` selects | packages |
  | --- | --- |
  | `shared` | 12 |
  | `db` | 11 |
  | `fiscal` | 9 |
  | `core` | 8 |
  | `payments` | 6 |
  | `verifactu` | 5 |
  | `credentials`, `fiscal-verifactu`, `scheduler` | 4 |
  | `migrations` | 3 |
  | `payments-stripe` | 2 |
  | `server`, `provisioning`, `ui`, `bench-pglite` | 1 |

  So a `packages/ui` push narrows to one package and finishes in 8.2-8.8s, while a `packages/db` push
  narrows to eleven and takes 112s against the whole workspace's 116s — a 4s saving on a change to a
  package the history touches often (ten commits reach `packages/db` as of `558c62b`; only
  `fiscal-verifactu` at fourteen and `payments` at twelve reach further). Scoping is close to free on
  the leaves and close to worthless on the trunk, and the trunk is not the rare case.

  The classifier `scripts/changed-packages.mjs` is fully tested by the root Vitest project, whose
  `include` covers `scripts/` — one directory since 2026-08-01, when `.github/scripts/` was merged
  into it. **Most of the shell still is not.** The sign-off walk left the hook that day and is
  tested where it landed (`scripts/check-signoff.sh`, twelve assertions in
  `scripts/check-signoff.test.mjs`, spawned the way both callers spawn it); the deletion guard
  (#23) and the range computation are still backed only by having run the real hook against crafted
  stdin and recorded the results — the same evidence #23 had, no better. Three things to know
  before writing a suite for what is left: the root project's `include` has to be widened again to
  reach `.husky/`; root config is linted but never typechecked (`pnpm typecheck` is
  `pnpm -r typecheck`, and `pnpm -r` never visits the workspace root, see `CLAUDE.md` §2); and
  husky runs the hook under `sh -e`, where an unguarded `x=$(false)` or a `grep` outside an `if`
  kills the script silently mid-gate — the hook's own header records that measurement. The shape
  that worked for the sign-off check is worth copying: what is testable is the PREDICATE, once it
  is a file of its own, and the extraction is what made it testable rather than any new harness.

  **Four entries below, and only the first two are live gaps** — both of them the honest answer to
  what a local gate can be, rather than anything left undone. Entries 3 and 4 are closed, kept
  because what replaced each is a rule someone has to know about. The hook's header states the live
  ones in its "NOT RUN HERE" list rather than leaving them for a reader to discover; the first is a
  cost rather than a gap in what runs, and the header's SCOPING paragraph covers it.

  1. A `global` push — root config, `.github/`, `.husky/`, `scripts/`, the lockfile — runs
     `pnpm -r test:coverage` over the whole workspace, which is the 116s in the row above (`-r`
     since 2026-08-01: the repo-level project it used to reach through the root `test:coverage`
     script is a step of its own now, so it runs on scoped pushes too rather than only here). The
     heaviest single package in it is `packages/db`: `pnpm --filter @waitron/db test:coverage` on
     its own measured **38s** on 2026-08-01 (two runs, 37.8s and 38.2s,
     `TESTCONTAINERS_RYUK_DISABLED=true`). It is not 38s OF the 116s — `pnpm -r` runs the members
     concurrently — and it is emphatically not the **189s** in
     `scripts/changed-scope.mjs`, which is a CI-runner figure ("189s of the old 387s test
     step, on its own runner"). An earlier version of this entry quoted that CI number as the local
     one, where it could not fit inside the whole-workspace figure beside it. The whole-workspace
     run is the honest answer for a change that can affect anything, and it is the CI entry below
     that would make it cheap.
  2. The hook still does not run mutation testing or the `bundle-smoke` builds, so a green hook does
     not imply a green CI.
  3. **CLOSED, 2026-08-01 — the two tree-wide guard suites are in the root Vitest project, so no
     scope can skip them.** They were `packages/db/src/guarded-teardowns.test.ts` (scans `packages/`
     and `apps/` from the repository root) and `english-only.test.ts` (scans the eight generic
     packages), and living in `packages/db` meant they only loaded when `packages/db` was in scope:
     `pnpm --filter "...@waitron/ui" ls -r --depth -1 --json` lists `@waitron/ui` alone and
     `--filter "...@waitron/payments"` lists six packages, none of them `@waitron/db`, while CI
     gates `test-heavy` the same way — so on those pull requests their first run was the unfiltered
     `main` merge. Both are now `scripts/*.test.ts`, run by `pnpm vitest run --coverage`: ci.yml's
     ungated `lint` job, and a new pre-push step on every push that is not documentation-only.
     Demonstrated rather than asserted, by feeding the real hook a crafted `packages/ui` push — one
     comment appended to `packages/ui/src/a11y-helpers.ts`, `sh -e .husky/pre-push` fed
     `refs/heads/probe <new> refs/heads/probe <old>` — at `6d30ed2` and again here, both re-run on
     2026-08-01. Both classified it `1 changed code path(s) map to @waitron/ui` and both exited 0,
     10s → 12s. What changed is not the size of one set: BEFORE there was a single test step,
     `tests with coverage (@waitron/ui + dependents)`, 21 files all in `packages/ui`. AFTER, that
     step is unchanged and a new `repo-level suite` step runs AHEAD of it, over **five** files —
     `guarded-teardowns.test.ts` (12 tests), `english-only.test.ts` (180),
     `check-signoff.test.mjs` (16), `changed-scope.test.mjs` (48) and `changed-packages.test.mjs`
     (66), 322 in total. A separate step rather than more files in the scoped one, because this one
     must never be narrowed and that one always is.

     **Three things it left behind.** The suites are TypeScript and nothing typechecks them now
     (`pnpm typecheck` is `pnpm -r typecheck`, which never visits the workspace root, and there is
     no root `tsconfig.json`) — measured in both directions, and deliberately not fixed here because
     the hook's typecheck step is scoped too, so a root `tsconfig.json` would not cover the
     `packages/ui` push this change exists for; the root `vitest.config.ts` carries that receipt and
     what a fix would cost. **Unclaimed**, and worth doing with whatever un-scopes that step rather
     than on its own. `packages/db/src/english-only.ts` stays in `packages/db` — two other
     files reach for it there — so `packages/db`'s coverage config excludes it and the root
     project's `coverage.include` names it, which is the one arrangement that measures it exactly
     once. And `packages/db`'s weekly, ungated `mutation-db` job still mutates it
     (`stryker.config.json` mutates `src/**/*.ts`), while the suite that exercises it no longer runs
     under that job at all: Stryker's vitest runner is pointed at `packages/db/vitest.config.ts`,
     whose `include` is Vitest's default, so it loads `packages/db`'s own suites and nothing else.
     The only one of those that still imports the module is `src/schema/series.test.ts`, and it
     imports `findSpanish` alone. So this is not "expect the score to fall", which is what this
     entry said first — **the module effectively loses mutation testing**. The receipt is the
     coverage run with the exclusion lifted: `english-only.ts` measures 92.25 statements and
     **66.66 functions** there (2026-08-01), so two of its six functions are never executed in that
     package, and a mutant in code no test executes cannot be killed. Nothing picks it up elsewhere
     either — there is no Stryker config at the repository root and no root `mutation` script
     (`find . -iname '*stryker*' ! -path '*/node_modules/*'` lists five configs, all under
     `packages/`), so `scripts/english-only.test.ts` is not a mutation target anywhere. **Unclaimed**;
     closing it means either a root Stryker project or narrowing `mutate` to drop the file
  4. **CLOSED, 2026-08-01 — a scope of only script-less packages no longer makes the test step a
     silent no-op.** It was one: `pnpm --filter "...@waitron/bench-pglite" test:coverage` prints
     `None of the selected packages has a "test:coverage" script` and exits **0**, so the hook
     reported the step as passed. Both gates now run a `scope is runnable` check first — one
     `pnpm <the same filters> ls`, piped into `node scripts/changed-packages.mjs runnable
     test:coverage` — which fails on a selection that would run nothing. The rule to know: a
     workspace member that deliberately has no tests must be named in `PACKAGES_WITHOUT_TESTS`
     (`scripts/changed-scope.mjs`), or every scoped run that selects it fails. `@waitron/bench-pglite`
     is the only one, `changed-scope.test.mjs` pins the list against the real workspace in both
     directions, and the `light` gate discounts it too, so a bench-only pull request now skips
     `test-light` rather than provisioning a runner to select nothing
- **CI SKIPPED `test-heavy` and both mutation runs on a root-config-only pull request — fixed on
  2026-08-01 by [#32](https://github.com/clintongormley/waitron/pull/32), which rewrote this entry
  in the same change.** Worth keeping because the SHAPE recurs: two mechanisms answering the same
  question, and the one nobody exercised drifting in the quiet direction.

  **What it was.** `ci.yml`'s `changes` job resolved scope with
  `pnpm --filter "...[origin/$BASE_REF]" ls --depth -1 --json`, and a change belonging to no
  workspace member resolves to the workspace ROOT — the one member that runs no tests. Reproduced in
  a `git clone --no-hardlinks` of this repository (a clone, because that filter matches nothing in a
  worktree — `CLAUDE.md` §2), one commit on top of `main` per shape:

  | commit touches | that filter listed | gates |
  | --- | --- | --- |
  | `tsconfig.base.json` | `["waitron"]` | `heavy=false light=true verifactu=false shared=false` |
  | `pnpm-lock.yaml` | `["waitron"]` | identical |
  | `packages/ui/src/index.ts` | `["@waitron/ui"]` | `heavy=false light=true …` (control: narrowing was right) |
  | `packages/shared/src/errors.ts` | 12 packages | `heavy=true … shared=true` (control) |

  `test-light` was gated `true` and did get a runner, but selected nothing: pnpm does not run a
  filtered script in the workspace root without `--include-workspace-root`, and
  `pnpm --filter "waitron" --no-sort format:check` prints `No projects matched the filters in "…"`
  and exits **0**. Add the ungated `lint` job running only the repo-level Vitest project, and **no
  package's test suite ran at all** on a root-config-only or lockfile-only pull request.

  **What replaced it.** The `changes` job now runs `scripts/changed-packages.mjs` — the same script,
  the same call, that `.husky/pre-push` runs — which attributes each changed path to the workspace
  member whose directory contains it and answers `scope=global` for anything outside every member.
  Expanding a changed package to its DEPENDENTS is still pnpm's (`--filter "...<pkg>"`); only the
  attribution moved. The docs gate `code=` comes out of the same call, so the two verdicts cannot
  disagree. Verified by running `ci.yml`'s own step scripts — read out of the workflow file, not
  transcribed — against crafted commits in a clone, with a `pnpm` shim capturing what the shards
  would run:

  | commit touches | `scope` | `test-heavy` | `test-light` selects | mutations |
  | --- | --- | --- | --- | --- |
  | `tsconfig.base.json` | `global` | RUNS | 13 packages | both RUN |
  | `pnpm-lock.yaml` | `global` | RUNS | 13 packages | both RUN |
  | `packages/ui/src/index.ts` | `packages` | skipped | `...@waitron/ui` | both skipped |
  | `packages/shared/src/errors.ts` | `packages` | RUNS | 11 packages | `shared` RUNS |
  | `docs/backlog.md` | `documentation` | skipped (`code=false`) | skipped | both skipped |
  | `bench/pglite-throughput/**` | `packages` | skipped | skipped (`light=false`) | both skipped |
  | a `push` on `main` | forced `global` | RUNS | 13 packages | both RUN |
  | a `push` with an all-zero `before` | `global` | RUNS | 13 packages | both RUN |

  Two negative controls ran too: a crafted new member declaring no `test:coverage` script made the
  `test-light` step exit **1** naming it, and deleting each of the four new checks in turn failed
  the tests written for it.

  **Dated pointer, 2026-08-01:** the table above measured the TWO-shard arrangement and its numbers
  no longer hold — `packages/ui` was split into a `test-ui` shard later the same day (see the
  `packages/ui` hang entry below). Left as written rather than restated, because it is the record of
  what that verification run actually produced. Under three shards the `test-light selects` column
  drops by one everywhere it says 13, and the `packages/ui/src/index.ts` row changes shape rather
  than degree: `test-ui` RUNS and `test-light` is **skipped** outright, because `light` now means
  "the scope holds a package with no shard of its own" and a ui-only scope holds none.

  **Verified on real GitHub Actions**, run `30692329110` on
  [#32](https://github.com/clintongormley/waitron/pull/32) (`fix/ci-scope-fail-open`, merged as
  `6d30ed2`) — which touches only root-level paths, so it is exactly the shape that used to run
  nothing. `changes` printed `scope=global`, and `test-heavy` (3m30s), `mutation-verifactu` (3m28s)
  and `mutation-shared` (56s) all **ran**. Under the mechanism this replaces, all three would have
  been skipped
- **`packages/ui` hung the whole-workspace `test-light` shard TWICE, on 2026-08-01. Mitigated the
  same day by giving it its own `test-ui` shard — but the mitigation is unproven and can only be
  judged from future runs.** The previous version of this entry recorded one occurrence, declined to
  call it a shape, and named the fix to reach for if it recurred. It recurred, and that is the fix.

  **First two runs with the shard in place, both green.** Run `30699486147` (head `e34d467`):
  `test-ui` 12:20:50 → 12:21:35, **45s**, and `test-light` — now thirteen packages rather than
  fourteen, with no Playwright step at all — 12:20:50 → 12:24:12, 3m22s. Run `30699812104`
  (head `350f071`, the merged tip): all ten jobs green, 4m23s wall clock. Two green runs are not proof
  against a hang that took two attempts to recur, so this stays open; the number to watch is
  `test-ui`'s own duration, since a hang now shows up there rather than taking twelve other packages
  with it. If it does hang there, the cause is inside the suite rather than contention, and the next
  move is a per-test timeout plus a Playwright trace.

  **Both runs, read back with `gh api repos/clintongormley/waitron/actions/runs/<id>/…` rather than
  `gh run view --json`, which reports only the LATEST attempt and shows the first of these as a
  success:**

  | Run | Pull request | `test-light` | Outcome |
  | --- | --- | --- | --- |
  | `30692329110` attempt 1 | [#32](https://github.com/clintongormley/waitron/pull/32), head `e695a44` | 08:44:09 → 09:13:22 | cancelled after ~29m |
  | `30697414129` | [#35](https://github.com/clintongormley/waitron/pull/35), head `add4097` | 11:18:11 → 11:38:08 | cancelled after ~20m |

  **What the two job logs agree on, and it is more than the first entry had.** In both,
  `playwright install --with-deps chromium` had already finished — its step group closed and the
  next step opened, 08:44:29→08:44:41 and 11:18:31→11:18:43 — so it is not the install. In both,
  exactly **twelve** packages printed `test:coverage: Done` and `packages/ui` was the only selected
  package that never did. In both, `packages/ui` got *part* way: it printed individual passing test
  files and then stopped, last output 08:47:04 and 11:21:23. And in both, the runner's shutdown
  named **`chrome-headless-shell`** among the orphan processes it had to terminate — so the browser
  was still alive, and still attached, when the job was killed. Attempt 2 of the first run, same
  commit, went green in 3m58s.

  **What is still NOT measured: the cause.** `pnpm --filter "!@waitron/db" --no-sort test:coverage`
  started thirteen packages at once, several spinning up their own Testcontainers Postgres, so
  contention starving a browser suite remains the plausible story — plausible, not demonstrated.
  Nothing establishes that isolating `packages/ui` removes it, and a shard of its own would not help
  at all if the cause is internal to that suite. **Treat this as open until several `test-ui` runs
  have passed**; if it hangs there too, the cause is in the suite and the next thing to reach for is
  a per-test timeout and a Playwright trace, not more isolation.

  **What the split does buy with certainty**, whatever the cause: a wedged browser can no longer
  take twelve other packages' results down with it, and `test-light` no longer resolves, caches or
  installs Chromium at all — about 12s of cache-warm install per run, plus the two steps before it,
  read off the two job logs above. Giving it its own shard rather than dropping `--no-sort`, because
  §1.1 of the design measured the sort order as pure cost.

  **The guard that came with it**, because splitting a shard is where a package silently stops being
  tested: `scripts/ci-workflow.test.mjs` extracts every shard's real `--filter` arguments from
  `ci.yml`, hands them to the real `pnpm ls`, and asserts the three shards cover every member
  declaring `test:coverage` **exactly once** — none twice, none falling through. It also asserts
  every job appears in `ci`'s `needs`, and that every `SCOPE_GATES` entry is both declared as a
  `changes` output and read by some job's `if:`. Proven by deletion in five directions; deleting the
  `test-ui` job alone fails it with `expected [ '@waitron/ui' ] to deeply equal []`
- **CLOSED, 2026-08-01 — the sign-off (DCO) check is one script both gates call.** It was two
  byte-identical copies of `grep -qiE '^Signed-off-by: .+ <.+@.+>'` and of the loop around it, in
  `.husky/pre-push`'s `check_signoff` and `licence.yml`'s `dco` job. Now `scripts/check-signoff.sh`:
  shas on stdin, the failing commits on stdout as `git log --oneline` renders them, exit 1 if any.
  Each caller keeps what was never shared — CI builds the range from the pull request and wraps the
  lines in `::error::` annotations, the hook accumulates a range per pushed ref and indents them.

  **Three things to know before touching it.** It is `sh`, not `.mjs`, and that is about the
  callers: the `dco` job installs nothing (no pnpm, no setup-node), and the hook runs this step
  first, before `pnpm install`, with no node needed — re-run on 2026-08-01 under
  `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin`, where it still named the offending commit and still
  exited 1. The job's `name:` — `Every commit is signed off` — IS the required-status-check context
  in ruleset 19899160, so renaming the job silently unhooks branch protection. And
  `scripts/check-signoff.test.mjs` tests both halves: twelve assertions spawning the script against
  throwaway git repositories, and three that run the `dco` step's shell EXTRACTED from `licence.yml`
  rather than transcribed, which is the only part of CI that can be exercised without pushing
- **`errors.reachability.test.ts` does not test reachability.** Proven by deletion. Eight packages
  carry a copy. Closing it needs a `tsc`-based downstream probe or a narrowed `include`. See
  `CLAUDE.md` §4 — do not cite these tests as evidence in the meantime
- **Two cosmetic nits from a 2026-07-31 review pass.** (1)
  `packages/provisioning/src/instance-state.ts` builds `any(array[...])` by string concatenation from
  `INSTANCE_ROLES` where drizzle would bind a `$1` array — the one `sql.raw` site in the repo with a
  real parameterised alternative unused. **No live risk** (module constant, ordinary `SELECT`), purely
  cosmetic. (2) Four `~10-line` copies of the comment-stripper (`english-only.ts`'s private
  `blankBlockComments`/`dropLineComment`, plus a `stripComments` each in `fiscal`/`payments`'s
  vocabulary tests and `scripts/guarded-teardowns.test.ts`). The earlier divergence — a copy that had
  dropped the URL guard — was fixed in-tree and every copy now carries a URL-guard regression test; the
  two vocabulary tests carry a documented decision **not** to consolidate (`english-only.ts` sits on
  neither the barrel nor the `exports` map, so reuse would need a deep non-barrel import or an export
  addition — "neither is worth it"). Residual is only "four small strippers"; dedupe **only** if a
  shared home appears. Neither blocks anything
- **CI ran every check on every push — done, both PRs merged.** A Markdown-only change cost the same
  7m20s as a migration. Designed in
  [2026-07-31-scoped-ci-design.md](superpowers/specs/2026-07-31-scoped-ci-design.md), built to
  [2026-07-31-scoped-ci.md](superpowers/plans/2026-07-31-scoped-ci.md). **Two PRs, deliberately** —
  renaming `test` in the same PR that introduces the gate would block on a required check that can no
  longer report. [#25](https://github.com/clintongormley/waitron/pull/25) added the aggregate `ci`
  job, and ruleset 19899160 now requires `ci` alone rather than five job ids;
  [#27](https://github.com/clintongormley/waitron/pull/27) added the `changes` gate, the
  `static-analysis` split, the two-way test shard, and scoping for both mutation jobs and both test
  shards. Measured — every row is a `CI`-workflow run, and only the last is a `push` on `main`; the
  other three are `pull_request` runs on the branch named beside them:

  | Change | Wall clock | Run |
  | --- | --- | --- |
  | documentation only | **44s** | `30664369447` — [#30](https://github.com/clintongormley/waitron/pull/30), on `docs/backlog-scoped-ci-landed` |
  | one package, or CI/root config | **1m26s** | `30655777867` — on `feat/ci-scoped-testing` |
  | a dependency of `packages/db` | 4m17s | `30652426111` — on the throwaway `probe/dependency` |
  | **any code, merged to `main`** — full suite, nothing skipped | **4m12s** | `30663706544` — the `push` run for #27 |

  That last row is the safety net and is not optional: the package scoping is exactly right about
  package-graph coupling and blind to everything else — a root config, a shared fixture, an
  environment variable — so `main` re-runs everything unfiltered and a too-narrow scope surfaces
  within minutes of landing rather than never. A documentation-only merge skips there too, which is
  why the docs gate and the scoping are two separate decisions
- **`test-light` reports `success` without saying what it ran.** The larger half of this entry is
  **done**: the shard now gates on a `light` boolean emitted from the `changes` job's existing
  single `pnpm ls`, so a resolved scope that is empty, or that holds nothing but packages with a
  shard of their own (`OWN_SHARD_PACKAGES` — `@waitron/db` and, since the split below,
  `@waitron/ui`), skips it instead of provisioning a runner and running `pnpm install` before
  finding nothing to do — 48s of run `30653487133` (18:01:36 → 18:02:24, its longest job) for zero
  test execution. That run's 48s included a `playwright install --with-deps chromium`, which
  `test-light` no longer does at all; the browser steps moved to `test-ui`. What is **still
  open** is the reporting half: a `test-light` that ran two packages and one that ran the whole
  workspace both report `success`, and only the step log tells them apart. **The `@waitron/bench-pglite`
  half of this entry is closed** (2026-08-01): the `light` gate now discounts every member listed in
  `PACKAGES_WITHOUT_TESTS`, so a change touching only that package gives `light=false` and skips the
  shard rather than provisioning a runner to print `None of the selected packages has a
  "test:coverage" script` and exit 0; and the shard's new `runnable` guard fails on any selection
  that would run nothing. What remains is only the reporting — make the job NAME the packages it
  selected, rather than leaving `success` to mean either. Found by the base-to-tip review of PR 2,
  not by any per-task pass
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
