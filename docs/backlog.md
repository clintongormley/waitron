# Backlog — what is in flight, what is next, and why

**Last reprioritised: 2026-07-31.** This file is the answer to "what should I work on?". It is
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
| **Scoped CI** — stop running every check on every push | **Done.** Both merged: #25 (the `ci` gate) and #27 (the scoping). Measured on `main`: a docs-only change 44s against the 7m20s baseline, a full unfiltered `main` run 4m12s. Two follow-ups remain under **Debt and odd jobs** |
| **Cloud storage model** — design | **Merged** (#19), corrected by **#22** |
| **Sale settlement model** — implementation plan | Not written. **The next build step** |
| **Close Q13 and Q15 on primary source** | Not started. Cheaper than hiring — see below |
| **Consolidate the session-memory notes** | Not started. They predate this file and now overlap it — see below |

---

## Next — the fiscal sequence

Four pieces, in this order. They are sequenced rather than parallelised because each adds a
migration to `packages/db`, and `packages/db/drizzle/meta/_journal.json` conflicts on every
concurrent branch. The collision is **per package**, not repo-wide — five packages carry their own
`drizzle/` directory and journal (`credentials`, `db`, `fiscal-verifactu`, `payments`, `scheduler`),
so work touching a different package's migrations can still run alongside these.

| # | Piece | Why here |
| --- | --- | --- |
| 1 | **Sale settlement model** | Everything else assumes it. Takes the tip and the amount charged off the frozen sale row so an invoice can exist before payment does |
| 2 | **Rectificativas** — sustitución and diferencias | The only lawful way to change an issued invoice. Blocks piece 4 |
| 3 | **F3 canje** — "can I have a proper invoice?" | Unmodelled today, and issuing an ordinary invoice instead would double-declare the sale. Ordinary trade in a restaurant, not an edge case |
| 4 | **Invoice-first mode** | Cannot be offered to staff until 2 exists: a disputed bill, a short payment and a "take a fiver off" all need a rectificativa |

Design and sources for all four:
[2026-07-31-sale-settlement-model-design.md](superpowers/specs/2026-07-31-sale-settlement-model-design.md)
§8, and [compliance/verifactu-findings.md](compliance/verifactu-findings.md) §§7-10.

**Then reassess.** The next question after piece 4 is whether to keep going fiscal (reporting, daily
close) or turn to the till. Do not answer it here in advance.

---

## The advisor gap

**No fiscal advisor is engaged.** The four open questions in
[compliance/asesor-questions.md](compliance/asesor-questions.md) therefore have nowhere to go, which
makes "blocked on the asesor" a wish rather than a queue.

Two of the four are not idle curiosity — they check assumptions **already built into the code**:

| Q | Assumption already in the tree | If the answer is no |
| --- | --- | --- |
| **Q13** | Tips are outside the VAT base and appear on no invoice — `sales.tip_amount`, `record-sale.ts`, and a test pinning that the tip does not enter the huella | Every invoice modelled so far understates its base, and the tip has to enter the hash |
| **Q5(a)** | One invoice series per till | The numbering scheme's foundation moves |
| Q14 | A printed pre-bill obliges an amendment log | Changes the till design, not existing code |
| Q15 | Short payment is a discount | Changes the till design, not existing code |

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

### Task: try to close Q13 and Q15 on primary source first

**Q5(b) was closed without asking anyone** — RD 1619/2012 art. 6.1.a) states it plainly, and reading
the BOE took minutes. Two of the remaining questions may go the same way, and that is worth an
afternoon before committing to a relationship the research above says will need managing.

- **Q13 (tips).** Every secondary source cites **DGT consulta vinculante 2174-03**, and none of them
  was read at source. Start there, in [PETETE](https://petete.tributos.hacienda.gob.es/consultas/).
  Highest value of the four: the answer is already assumed by the schema, by `record-sale.ts`, and by
  a test pinning tips out of the huella.
- **Q15 (short payment).** Discount versus bad debt is well-trodden ground in DGT doctrine; the
  card-present wrinkle — one capture exceeding the invoice — may not be.
- **Q14 (precuenta)** is the one least likely to yield, since it turns on whether AEAT's
  *prefactura* list is exhaustive, which is an interpretive question rather than a stated rule.

Record whatever is found in [compliance/verifactu-findings.md](compliance/verifactu-findings.md)
and mark the question closed in `asesor-questions.md`, following the Q5(b) precedent — do not leave a
closed question sitting in the open list.

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

---

## Debt and odd jobs

Carried from finished work. None of it blocks anything; all of it makes later work cheaper.

- **The git hooks are still untested — but they now have somewhere to go.** The "nothing repo-level
  can be tested" debt is closed: root `vitest.config.ts` exists, added by the scoped-CI work below,
  and root `pnpm test` is now `vitest run && pnpm -r test`. Its `include` currently covers
  `.github/scripts/` only. What has **not** happened is the hook test itself: the pre-push deletion
  guard (#23) is still backed only by having run the real hook against four kinds of stdin and
  recorded the results, not by a suite that would catch someone re-breaking it. Two things to know
  before writing one — the root project's `include` has to be widened to reach `.husky/`, and root
  config is linted but never typechecked (`pnpm typecheck` is `pnpm -r typecheck`, and `pnpm -r`
  never visits the workspace root; see `CLAUDE.md` §2)
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
  shards. Measured, in descending order of how often you will meet them:

  | Change | Wall clock | Run |
  | --- | --- | --- |
  | documentation only | **44s** | `30652341473` |
  | one package, or CI/root config | **~1m30s** | `30655777867` |
  | a dependency of `packages/db` | 4m17s | `30652426111` |
  | **any code, merged to `main`** — full suite, nothing skipped | **4m12s** | `30663706576` |

  That last row is the safety net and is not optional: the package scoping is exactly right about
  package-graph coupling and blind to everything else — a root config, a shared fixture, an
  environment variable — so `main` re-runs everything unfiltered and a too-narrow scope surfaces
  within minutes of landing rather than never. A documentation-only merge skips there too, which is
  why the docs gate and the scoping are two separate decisions
- **`test-light` reports `success` without saying what it ran.** The larger half of this entry is
  **done**: the shard now gates on a `light` boolean emitted from the `changes` job's existing
  single `pnpm ls`, so a resolved scope that is empty, or that holds nothing but `@waitron/db`,
  skips it instead of provisioning a runner, running `pnpm install` and
  `playwright install --with-deps chromium` before finding nothing to do — 48s of run
  `30653487133` (18:01:36 → 18:02:24, its longest job) for zero test execution. What is **still
  open** is the reporting half: a `test-light` that ran two packages and one that ran the whole
  workspace both report `success`, and only the step log tells them apart. One scope the new gate
  does not help with, for the same reason — it answers "is a package other than `@waitron/db` in
  scope?", not "does any selected package have a `test:coverage` script?". `@waitron/bench-pglite`
  has no such script, so a change touching only it gives `light=true` and the step still prints
  `None of the selected packages has a "test:coverage" script`, exit 0 (run in this workspace:
  `pnpm --filter "@waitron/bench-pglite" --filter "!@waitron/db" --no-sort test:coverage`). Both
  remaining halves are the same fix — make the job name the packages it selected. Found by the
  base-to-tip review of PR 2, not by any per-task pass
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
