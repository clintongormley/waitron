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

---

## Current direction

**Finish the fiscal story before building anything user-facing.**

The reasoning: the till has to be built against the invoicing model, and that model is mid-change.
(The **SIF topology** — which node is the SIF, and how a venue keeps trading through a server death —
is now settled by #33; the fiscal sequence below is the rest of the model still moving.)
Building a counter screen now means building it twice. The fiscal work is also the part that cannot
be repaired afterwards — invoice numbers are never reused and records are hash-chained — so it is
where care pays best.

**The trade being accepted:** there is no application a person can use. Thirteen packages and one
server app exist; `packages/ui` has six primitives and nothing consumes them; there is no
`apps/till`. The system can reconcile a Stripe account and file with AEAT, and cannot ring up a
sandwich. That is a deliberate ordering, not an oversight, but it should be revisited at each
reprioritisation rather than assumed.

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
| **Close Q13 and Q15 on primary source** | **Done** (#37). Q13 (tips) and Q15's core CLOSED on primary/official source ([findings](compliance/verifactu-findings.md) §§11–12); Q14 (precuenta) stays open — see the advisor gap below |
| **Consolidate the session-memory notes** | Not started. They predate this file and now overlap it — see below |

---

## Next — the fiscal sequence

Four pieces, in this order. **Piece 1 landed (#39); piece 2 (rectificativas) is now the head of the
queue.** They are sequenced rather than parallelised because each adds a
migration to `packages/db`, and `packages/db/drizzle/meta/_journal.json` conflicts on every
concurrent branch. The collision is **per package**, not repo-wide — five packages carry their own
`drizzle/` directory and journal (`credentials`, `db`, `fiscal-verifactu`, `payments`, `scheduler`),
so work touching a different package's migrations can still run alongside these.

| # | Piece | Why here |
| --- | --- | --- |
| 1 | **Sale settlement model** — **done (#39)** | Everything else assumes it. Took the tip and the amount charged off the frozen sale row so an invoice can exist before payment does |
| 2 | **Rectificativas** — sustitución and diferencias — **next** | The only lawful way to change an issued invoice. Blocks piece 4 |
| 3 | **F3 canje** — "can I have a proper invoice?" | Unmodelled today, and issuing an ordinary invoice instead would double-declare the sale. Ordinary trade in a restaurant, not an edge case |
| 4 | **Invoice-first mode** | Cannot be offered to staff until 2 exists: a disputed bill, a short payment and a "take a fiver off" all need a rectificativa |

Design and sources for all four:
[2026-07-31-sale-settlement-model-design.md](superpowers/specs/2026-07-31-sale-settlement-model-design.md)
§8, and [compliance/verifactu-findings.md](compliance/verifactu-findings.md) §§7-10.

**Then reassess.** The next question after piece 4 is whether to keep going fiscal (reporting, daily
close) or turn to the till. Do not answer it here in advance.

---

## SIF topology follow-ups (from #33)

The [server-as-SIF + failover design](superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md)
decided the **topology only**; its §14 defers the buildable pieces, each to its own spec:

- **The sync / replication protocol** between the two local servers and the cloud mirror — the
  largest. Partitioned-write active-active with full cross-replication (not multi-master); it must be
  prototyped against the real migrations, not assumed from config. **A first-draft spec exists**
  ([2026-08-01-sif-sync-replication-protocol-design.md](superpowers/specs/2026-08-01-sif-sync-replication-protocol-design.md),
  branch `docs/sif-sync-protocol-design`, held — not PR'd), reviewed against the schema. It raised two
  things: a gap in #33 itself (below), and one of its own — its ownership map omits `sales` and
  `working_orders`, which the two apply paths carry NOT-NULL foreign keys into, so the next draft needs
  a "parent rows replicate before their referents" apply-ordering rule. Two container prototypes gate
  it: whether a foreign `registro` INSERTs under FORCE RLS as a non-BYPASSRLS `withTenant` role, and
  whether native logical replication can satisfy FORCE RLS at all (decides application-level sync vs.
  native).
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
- **#33's "the SIF is the server" premise has no schema support yet — but the schema shape is now
  decided (2026-08-01).** Every fiscal key is per `till_id` today: `registro_sif` (one live identity
  per till), `cadenas` (chain head keyed `(tenant, till)`), `registros_facturacion` (`(tenant, till,
  secuencia)`, `till_id NOT NULL`), `invoice_series` (`(tenant, till, code)`), and `tills` carries no
  server column — verified against the schema on 2026-08-01. **Decision: add an explicit `server_id`
  column and re-key the fiscal chain / series / SIF identity to the server. Do NOT reuse `till_id` as a
  stand-in for "server"** — overloading a legally-load-bearing, unrepairable identity with a second
  meaning is the dishonest option. **No backwards-compatibility or migration** — Waitron is
  pre-production, schema changes drop and recreate (`CLAUDE.md` §3). The rekey still needs a
  **container prototype against `record-sale.ts`'s series↔till check and the chain-append path** before
  build, to confirm they behave under server-keying. This is the gap #33 left open; the server-as-SIF
  implementation spec must carry the rekey, and the sync/replication spec (held) can now assume the
  `server_id` column rather than treating `till_id`-as-server as an open option.

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

Nothing below has any code.

| Sub-project | Note |
| --- | --- |
| **7 — Counter POS UI** | The till. Also owns the working-order amendment log (art. 29.2.j LGT), deferred here deliberately: nothing writes working orders yet, and a log with no producer cannot be shown to work |
| **5 — Identity** | Users, roles, permissions. The refund/void role gate waits on it |
| **6 — Locations** | Venue and till registration, series assignment |
| **8 — Reporting** | Daily close, VAT summary |
| **16 — Workforce** | The *registro de jornada* is a **launch-day legal duty**, not a nicety |
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
     and `apps/` from the repository root) and `english-only.test.ts` (scans the seven generic
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
- **Payments follow-ups** — the webhook HTTP endpoint (its own cycle: per-tenant signature
  verification needs the tenant, which is only knowable from the unverified payload), `forward`
  retry backoff, the reconcile remediation UI
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
  validate ordering, `rotate` coupled to `PURPOSES`. Four more carried from
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
