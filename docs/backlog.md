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
| **Scoped CI** — stop running every check on every push | **Done.** Both merged: #25 (the `ci` gate) and #27 (the scoping). Against the 7m20s baseline: a documentation-only pull request now takes **44s**, and a full unfiltered `push` on `main` **4m12s**. The scope resolution it shipped skipped every package's tests on a root-config pull request; that is fixed under **Debt and odd jobs**, where one follow-up (what `test-light` reports) remains |
| **Scoped pre-push hook** — the same treatment for the local gate | **Merged** (#31). Scopes `typecheck` and `test:coverage` to the changed packages and their dependents, adds the sign-off (DCO) check CI was catching for us, runs `test:coverage` rather than `test`, adds `pnpm install --frozen-lockfile`, and skips `lint` on a documentation-only push. Measured on this machine on 2026-08-01, one crafted push per shape, `TESTCONTAINERS_RYUK_DISABLED=true`, wall clock bracketed in `time.time()` — `main`'s hook (`558c62b`, one run each) → #31's: deletions-only 9ms → 7-9ms (unchanged, #23 already did that); an **unsigned commit 104s and exit 0 → 27-36ms and exit 1**, because `main`'s hook has no sign-off check at all and so charged a full run and then let it through; documentation-only 105s → **3.1-3.5s**; a push to `packages/ui`, which no other package depends on, 105s → **8.2-8.8s**. **It is not faster everywhere.** A `packages/db` push is 112s and a root-config or lockfile push 116s — both SLOWER than `main`'s 105s, because this hook also runs `test:coverage` rather than `test` and installs first. Scoping pays on the leaves, not on the trunk; **Debt and odd jobs** carries the expansion sizes and what the hook still does not cover |
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

- **The pre-push hook is scoped now, and its DECISIONS are tested — the shell itself still is not.**
  The hook maps the push's changed paths onto workspace packages and runs `typecheck` and
  `test:coverage` against those packages and their dependents, skipping those two **and `lint`**
  entirely on a documentation-only push. `lint` is skipped there on a measurement, not a hunch:
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
  into it. **The shell is not.** The
  deletion guard (#23), the range computation and the sign-off loop are all backed only by having
  run the real hook against crafted stdin and recorded the results — the same evidence #23 had, no
  better. Three things to know before writing a suite for the shell: the root project's `include`
  has to be widened again to reach `.husky/`; root config is linted but never typechecked
  (`pnpm typecheck` is `pnpm -r typecheck`, and `pnpm -r` never visits the workspace root, see
  `CLAUDE.md` §2); and husky runs the hook under `sh -e`, where an unguarded `x=$(false)` or a
  `grep` outside an `if` kills the script silently mid-gate — the hook's own header records that
  measurement.

  **Four entries below. Two are the honest answer (1 and 2), one is a follow-up (3), and the fourth
  is closed** — gap 4 was closed on 2026-08-01 and is kept here because what replaced it is a rule
  someone has to know about. (An earlier version of this line counted three honest answers and a
  follow-up, which is four live gaps — while the fourth entry it was counting says in its own first
  words that it is closed.) The hook's header states the last three in its "NOT RUN HERE" list
  rather than leaving them for a reader to discover; the first is a cost rather than a gap in what
  runs, and the header's SCOPING paragraph covers it.

  1. A `global` push — root config, `.github/`, `.husky/`, `scripts/`, the lockfile — runs
     `pnpm test:coverage` for the whole workspace, which is the 116s in the row above. The heaviest
     single package in it is `packages/db`: `pnpm --filter @waitron/db test:coverage` on its own
     measured **38s** on 2026-08-01 (two runs, 37.8s and 38.2s,
     `TESTCONTAINERS_RYUK_DISABLED=true`). It is not 38s OF the 116s — `pnpm -r` runs the members
     concurrently — and it is emphatically not the **189s** in
     `scripts/changed-scope.mjs`, which is a CI-runner figure ("189s of the old 387s test
     step, on its own runner"). An earlier version of this entry quoted that CI number as the local
     one, where it could not fit inside the whole-workspace figure beside it. The whole-workspace
     run is the honest answer for a change that can affect anything, and it is the CI entry below
     that would make it cheap.
  2. The hook still does not run mutation testing or the `bundle-smoke` builds, so a green hook does
     not imply a green CI.
  3. **The scoping retires `packages/db`'s two cross-package guard suites on most pushes — a
     regression this branch introduces locally, not a design choice.**
     `packages/db/src/guarded-teardowns.test.ts` scans `packages/` and `apps/` from the repository
     root (it is the only file under either tree that resolves the repo root, grepped on
     2026-08-01), and `english-only.test.ts` scans the seven generic packages. Both live in
     `packages/db`, so both run only when `packages/db` is in scope. Measured on 2026-08-01:
     `pnpm --filter "...@waitron/ui" ls -r --depth -1 --json` lists `@waitron/ui` alone, and
     `--filter "...@waitron/payments"` lists six packages, none of them `@waitron/db`. Before this
     branch the hook ran `pnpm test` unscoped (`git show 558c62b:.husky/pre-push`, line 82), so both
     ran on every push. CI does not make it up on the pull request either — `test-heavy` is gated on
     `@waitron/db` being in scope — so their first run is the unfiltered `main` merge. This is
     `CLAUDE.md` §2's "a filtered test run does not load a package's guard suites" one level up: the
     filter is over PACKAGES now rather than over test names. Widening the scope back out is the
     wrong fix, because it gives up the whole change to buy two suites: a guard that polices
     `packages/` and `apps/` reads as belonging in the root Vitest project — whose `include` already
     has to be widened to cover `.husky/` (see above) — rather than in a package most changes do not
     reach. Moving them there takes both suites out of `packages/db`'s coverage accounting, which is
     enough of a change to want its own branch
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
  2026-08-01, in the change that rewrote this entry.** Worth keeping because the SHAPE recurs: two
  mechanisms answering the same question, and the one nobody exercised drifting in the quiet
  direction.

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

  **Verified on real GitHub Actions**, run `30692329110` on this pull request — which touches only
  root-level paths, so it is exactly the shape that used to run nothing. `changes` printed
  `scope=global`, and `test-heavy` (3m30s), `mutation-verifactu` (3m28s) and `mutation-shared` (56s)
  all **ran**. Under the mechanism this replaces, all three would have been skipped
- **`packages/ui` hung the whole-workspace `test-light` shard once, on 2026-08-01, and it has not
  recurred.** Recorded rather than ruled a flake, because this change makes the shard it hung in run
  far more often. Attempt 1 of run `30692329110`: twelve of the thirteen packages finished — the last
  was `packages/payments` at 08:47:36 — and then nothing at all was printed for **25 minutes**, until
  the run was cancelled at 09:13:20. The one package that never reported was `packages/ui`, the only
  Chromium/Playwright suite; its `playwright install --with-deps chromium` step had already
  succeeded. Attempt 2, same commit, same command: **3m58s, green**.
  `pnpm --filter "!@waitron/db" --no-sort test:coverage` starts all thirteen at once, several of them
  spinning up their own Testcontainers Postgres, so a browser suite is the plausible loser under
  contention — plausible, not measured, and one occurrence is not a shape (`CLAUDE.md` §7). What
  makes it worth a line: before this fix a root-config pull request ran none of that shard, so the
  fix increases exposure to whatever this is. If it recurs, the shape to reach for is giving
  `packages/ui` its own shard rather than dropping `--no-sort`, since the sort order is what §1.1 of
  the design measured as pure cost
- **The sign-off (DCO) check is implemented twice.** `.husky/pre-push`'s `check_signoff` and
  `licence.yml`'s `dco` job carry the same `grep -qiE '^Signed-off-by: .+ <.+@.+>'` over the same
  per-commit loop. The PREDICATE is byte-identical; the reporting is not — CI emits `::error::`
  annotations and carries its own `git rev-list` failure branch, while the hook accumulates a list
  and hands it to `run_step`. That duplication is
  deliberate for now — the hook's copy was written to match CI's exactly, and the two agreeing is
  the whole point — but the way to keep them agreeing is one script both call, not two copies and a
  comment. Held back from `feat/scoped-pre-push-hook` because extracting it edits a workflow that
  branch otherwise never touches
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
  | documentation only | **44s** | `30664369447` — this pull request, on `docs/backlog-scoped-ci-landed` |
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
  single `pnpm ls`, so a resolved scope that is empty, or that holds nothing but `@waitron/db`,
  skips it instead of provisioning a runner, running `pnpm install` and
  `playwright install --with-deps chromium` before finding nothing to do — 48s of run
  `30653487133` (18:01:36 → 18:02:24, its longest job) for zero test execution. What is **still
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
