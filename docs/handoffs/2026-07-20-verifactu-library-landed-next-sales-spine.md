# Handoff — the Veri\*Factu library landed, next is the sales spine

**Date:** 2026-07-20
**Written against:** `main` at `7938e1b`, immediately after PR #9 merged. This handoff and the
spec's PGlite correction arrived together in PR #10.
**Next work:** write and execute plan 2 (data model + sale write path), then plan 3 (submission).

---

## Read these first, in this order

Most of what matters is committed. This handoff carries what those documents do _not_ say.

1. [`docs/superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md`](../superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md)
   — the spec you are implementing. **§3 now contains a PGlite decision that supersedes SQLite**;
   read that before anything else.
2. [`docs/compliance/verifactu-findings.md`](../compliance/verifactu-findings.md) — **authoritative**
   on regulation. Where it and any other document disagree, this wins.
3. [`docs/superpowers/plans/2026-07-19-verifactu-library.md`](../superpowers/plans/2026-07-19-verifactu-library.md)
   — the plan just executed. Read it as a **format reference** for the plan you are about to write.
4. [`docs/compliance/implementation-provenance.md`](../compliance/implementation-provenance.md) —
   binding. `mdiago/VeriFactu` is AGPL-3.0 and its source is not read.

---

## What landed

**`packages/verifactu`** — the standalone, publishable library. Merged as `7938e1b` (PR #9).

- 305 tests, **100% coverage** on all four metrics, **99.11% mutation score** against a hard
  `break: 90`.
- Reproduces **all three of AEAT's published huella vectors byte-for-byte**, and they form a chain
  (v1 → v2 → v3), so they exercise chaining rather than three isolated hashes.
- XML shape verified element-by-element against AEAT's real XSDs, including namespace prefix
  resolution and `xsd:sequence` ordering.
- Rectificativas (R1–R5) are buildable through the public API, with validation for AEAT rules
  1114/1115/1118.
- `mutation-verifactu` is now a **required status check** on ruleset `19157474`. Verified by
  re-reading the ruleset after writing, not by trusting the 200.

---

## The most important lesson from this session

**Tests cannot catch a self-consistently wrong shape.** Every serious defect found — and there
were five — was found by checking against **AEAT's XSDs and validation-rule catalogue**, never by
running tests. The tests assert our own output, so when the output is wrong in the same way the
test expects, everything is green.

| Defect | How it would have failed |
| --- | --- |
| `RegistroAlta`/`RegistroAnulacion` in the wrong namespace (XSD `ref=` resolves to the _declaring_ namespace) | Every submission rejected |
| `serializeConsulta` missing mandatory `IDVersion` + two mis-prefixed child groups | Every query rejected |
| Mandatory `CalificacionOperacion \| OperacionExenta` choice unenforced — **the README's own example produced an invalid record** | Records rejected on day one |
| Rectificativa support shipped without `ImporteRectificacion` (rule 1118), with a test asserting `validate()` returned `[]` | Corrections rejected, while a test certified them valid |
| XML element order entirely untested — four ordering mutations survived | Misordered document rejected wholesale |

**Consequence for plan 2:** schedule schema-checking against primary sources as a **first-class
task step**, not something a reviewer might think to do.

> **Correction, later on 2026-07-20.** This line originally read "The XSDs are on disk". **They are
> not.** They lived in `.claude/worktrees/`, which is gitignored, and went with the worktree
> teardown — the same failure mode that cost the previous session its progress ledger, now repeated
> for the primary sources. No `.xsd` or AEAT PDF exists anywhere in the repo. Plan 2 re-acquires
> them and **commits them**, so the next teardown cannot repeat this a third time. Until then, any
> task step saying "verify against the XSD" has nothing to verify against.

### Vacuous tests are systemic here, not incidental

The previous session shipped four tests that passed while the behaviour they named was absent.
**This session found seven more, across four different tasks**, despite the per-test red-phase rule
being a Global Constraint in the plan.

The rule did not prevent them. What caught them was **adversarial mutation by a reviewer who had
not written the code** — breaking the behaviour and confirming the test failed. Typical shape: a
fixture value identical under both the correct and the buggy implementation, so the assertion
cannot discriminate. Two concrete instances worth internalising:

- `expect(obj.field).toBeUndefined()` **cannot distinguish an absent key from a key set to
  `undefined`** — which was the exact property under test. Use `Object.hasOwn`.
- A QR test asserting a value was passed through unmodified used a fixture already in canonical
  form, so recomputing it produced an identical string. It passed while the implementation
  reformatted.

**Budget for per-task adversarial mutation in plan 2.** Treat "the implementer says it spot-checked
three tests" as unverified until a reviewer breaks them independently.

---

## The PGlite decision — read §3 of the spec, but here is why it happened

The spec said SQLite for standalone and Postgres for cloud, justified as "identical schema and
identical queries". **Both halves of that turned out false**, and it was discovered by research
before any code was written — which is the only reason it is cheap.

Two research passes (findings in the spec §3) established:

- Drizzle has no dialect-agnostic schema and the maintainers locked the request declining to add
  one. Zero dual-dialect Drizzle projects among 13 surveyed self-hostable apps.
- `better-sqlite3` transactions are **synchronous**; an async callback resumes after rollback with
  its writes in autocommit. For a hash chain that is silent corruption with no error at the call
  site.
- `drizzle-kit` **destroys SQLite triggers** on table rebuild, verified end to end.
- **SQLite has no privilege system** — any writer can `DROP TRIGGER`. The spec requires immutability
  to be a database property _precisely so it does not depend on application code_. SQLite cannot
  deliver that. Postgres can, by revoking `UPDATE`/`DELETE` from a non-owner app role.

**Decision: PGlite (embedded WASM Postgres) for standalone, real Postgres for cloud. One dialect.**
Backup remains "copy one directory", which is the part of the adoption story that actually matters
for multi-year fiscal retention.

**Open risk, deliberately not assumed away:** PGlite is single-connection and fully serialises.
§5's recommended local-server topology makes that node the venue's throughput ceiling. **Plan 2
opens with a benchmark against that topology before any schema work**, so course-correction stays
cheap. This was an explicit user decision, not a default.

---

## Verified technical facts you would otherwise re-derive expensively

All empirically verified this session. Versions checked 2026-07-20, not assumed.

**These are latest-available versions, not what the repo has installed.** Drizzle and PGlite are
not dependencies of this repo at all yet — plan 2 introduces them. Read the table as "what to
install", and check the last column before doing so.

| Package | Version | Note |
| --- | --- | --- |
| `drizzle-orm` | 0.45.2 | `1.0.0-rc.4` exists; rc changes `NodePgDatabase` generics and **removes `journal.json`**. Install the stable 0.45.x. |
| `drizzle-kit` | 0.31.10 | |
| `@electric-sql/pglite` | 0.5.4 | bundles real PostgreSQL 18.3 |
| `vitest` | 4.1.10 | **Do not install this.** The repo is on `^3.0.0`, lockfile 3.2.7. `packages/db` must match, or the workspace carries two Vitest majors. Upgrading all packages to 4 is a separate decision, not a plan-2 side effect. |

The Vitest row previously read as a recommendation and was wrong. Note also that this repo has
**no root Vitest workspace/`projects` config** — each package owns a `vitest.config.ts` and the
root runs `pnpm -r test`, so the 3.2 `workspace`→`projects` deprecation does not apply here.

**Two traps that make database tests vacuous:**

- **PGlite runs as superuser, and superusers bypass RLS. `FORCE ROW LEVEL SECURITY` does not
  override that** — Postgres docs say superusers "always bypass". Measured matrix: superuser
  bypasses with ENABLE _and_ with FORCE; non-superuser owner bypasses with ENABLE, enforced with
  FORCE; non-owner enforced either way. **Every RLS test must run inside `set local role
  app_user`** or the whole tenant-isolation suite passes while asserting nothing.
- **PGlite cannot test lock contention at all.** Concurrent queries serialise onto one backend
  (`pg_backend_pid()` identical). `FOR UPDATE` parses and runs but never blocks. A hand-rolled
  contention test appeared to pass while both statements had merged into one transaction — a false
  pass. **Chain-append concurrency needs a small real-Postgres suite** (Testcontainers) alongside
  the PGlite one.

**RLS mechanics with pooling:**

- `SET LOCAL app.tenant_id = $1` → **syntax error**; `SET LOCAL` takes no bind parameters, so
  interpolating a tenant id is an injection vector. Use `set_config`, which does parameterise:

  ```sql
  select set_config('app.tenant_id', $1, true)
  ```

  Verified: the payload `t1' ; drop table docs; --` returned `[]` and the table survived.
- `SET LOCAL` **outside** a transaction silently does nothing — RLS then sees no tenant and returns
  zero rows. Fail-closed, but confusing.
- Pooling is safe because `node-postgres` pins one client for the whole `transaction()` callback.
- Drizzle's RLS **docs page is wrong**: it shows `pgTable.withRLS(...)`; the shipped types have
  `pgTable(...).enableRLS()`. Trust the types. `FORCE ROW LEVEL SECURITY` is **not supported by
  Drizzle at all** — add it as raw SQL.

**Immutability, and why triggers alone are not enough:**

- The table **owner can disable any trigger** (`ALTER TABLE ... DISABLE TRIGGER`) — verified. So
  the real control is **connecting as a non-owner role with only `GRANT SELECT, INSERT`**; the
  trigger is the backstop. Migrations run as owner, the app does not.
- A row trigger does **not** fire on `TRUNCATE`. A second `BEFORE TRUNCATE ... FOR EACH STATEMENT`
  trigger is required or TRUNCATE walks straight through.
- Drizzle has no trigger support in `pg-core`. Use `drizzle-kit generate --custom` for an empty
  numbered migration. Handwritten SQL survives `generate` because drizzle-kit diffs against its own
  snapshot, which has no concept of triggers.

**Chain-append serialisation, measured on real Postgres, 20 concurrent appends to one chain:**

| Strategy | Committed | Chain intact | Time |
| --- | --- | --- | --- |
| Naive read-then-write | **3/20** | yes (only because of the unique constraint) | — |
| `SELECT … FOR UPDATE` on the chain head | 20/20 | yes | — |
| `pg_advisory_xact_lock` | 20/20 | yes | 18ms |
| SERIALIZABLE + retry | 20/20 | yes | 60ms, 57 attempts |

Recommended: **`UNIQUE (chain_id, sequence)` as the non-negotiable backstop**, plus a chain-head row
with `FOR UPDATE` to serialise proactively (keeps per-tenant parallelism), plus bounded retry on
`23505`. Skip SERIALIZABLE — more attempts, no extra safety once the constraint exists.

**Migration composition across packages** (both verified end to end):

- `out` in `drizzle.config.ts` is a **single string, not an array** (the docs render it as
  `string | string[]` — wrong). One config = one migration folder.
- Recommended: per-package configs with **separate journal tables**
  (`migrate(db, { migrationsFolder, migrationsTable: '__drizzle_migrations_fiscal' })`). Verified
  idempotent, and cross-package FKs still emit correctly.
- **Rule that makes it work:** the fiscal schema file may `import` core tables but must **not
  re-export** them — re-exporting pulls them into fiscal's snapshot and generates a duplicate
  `CREATE TABLE`.
- Ordering is your responsibility at runtime. Add a smoke test running both migration sets against
  an empty database in order.

---

## Plan 2 — decided structure, steps still to write

**Scope check already done: this is two plans, not one.**

- **Plan 2 — data model and the sale write path.** Deliverable: _a sale completes and produces a
  correctly chained, immutable fiscal record._ Synchronous, transactional, DB-centric.
- **Plan 3 — submission.** Outbox drainer, batching, flow control, retry, CSV persistence,
  error-3000 resolution, `Incidencia="S"`, acks, reconciliation. Asynchronous, network-centric.

Plan 2 produces working software without plan 3 — the legally-required record exists and is
chained, and submission has no deadline (findings §2).

### Proposed task decomposition for plan 2

1. **PGlite throughput benchmark against the local-server topology.** Before any schema work. This
   is a spike, not a feature: measure sustained sales across several tills through one PGlite node
   and report. If it fails, the standalone decision changes while nothing is built on it.
2. `packages/db` scaffold: Drizzle + PGlite + real-Postgres test harness, migration runner with
   per-package journal tables, the `describe.each` dual-target test seam.
3. Tenancy schema (`tenants`, `locations`, `tills`) + RLS policies + the `withTenant` seam +
   non-owner app role. **Tests must `set local role app_user` or they assert nothing.**
4. Immutability: triggers + privilege revocation + the `BEFORE TRUNCATE` trigger, with teeth checks
   run **as the app role**.
5. `invoice_series` + strictly-increasing allocation (gaps permitted, reuse never).
6. `working_orders` + `working_order_lines`.
7. `sales` + `sale_lines` + `tenders`, immutable, with `locale`/`invoice_locales` snapshotting.
8. `packages/fiscal`: the `FiscalBackend` interface (spec §6).
9. `packages/fiscal-verifactu`: module-owned schema (`registros_facturacion`, `cadenas`, SIF
   registration, submission sidecar).
10. Till registration + installation-number minting (strictly increasing per (NIF, IdSIF), never
    reused).
11. Chain append + art. 7.i verification, with the `FOR UPDATE` + unique-constraint + retry pattern.
12. `recordSale` — the full write-path transaction (spec §4 steps 1–7).
13. `recordVoid` / anulación.
14. Incident recording — chain-verification failure **records and continues**; nothing blocks a sale.

### Global constraints to carry into the plan

- Node 26 (`.nvmrc`; `engines.node` is the looser `>=24`), pnpm 9.15.0. TypeScript strict,
  `verbatimModuleSyntax`, `.js` import extensions.
- Prettier `printWidth: 100`, `trailingComma: "all"`. `pnpm exec prettier` **fails from the repo
  root** — use `./node_modules/.bin/prettier`.
- **Spanish vocabulary stops at the module boundary.** A lint guard rejects Spanish identifiers in
  the generic packages.
- `packages/verifactu` keeps its zero-in-repo-dependency boundary; nothing here may weaken it.
- Per-test red phase — observe each test failing **individually** before implementing.
- Mutation gating per package: pure-Node packages can afford the per-PR gate that
  `packages/verifactu` now has; browser packages cannot (`packages/ui` stays weekly).
- **Never a production NIF.** Numbering may never be reused, even for test invoices.

---

## Process notes that materially affected this session

- **The subagent-driven flow worked**, and the reviews earned their cost — every serious defect came
  from a reviewer, not from the implementer or the test suite.
- **Put the progress ledger outside the worktree.** It is at
  `.superpowers/sdd/progress.md` in the **main checkout**, deliberately: the previous session lost
  its entire audit trail because the ledger lived inside a gitignored directory in the worktree and
  died with `git worktree remove`.
- **Worktrees here are created by `EnterWorktree` under `.claude/worktrees/`**, not by
  `worktree.py`. `/land-branch`'s registry lookup and teardown step do not apply — use
  `git worktree remove --force` and `git branch -D`.
- **A dead reviewer can leave a mutated source file behind.** One died mid-teeth-check and left
  `huella.ts` modified, producing 13 failures against code nobody had edited. **Check
  `git status --short` after every agent that might mutate files.** That diagnosis also surfaced a
  real bug: Vitest was discovering Stryker's `.stryker-tmp` sandbox — which holds _mutated_ copies
  of the source — as real test files. Fixed in both packages.
- **API connections dropped repeatedly on long agent runs.** Several agents died after doing the
  work but before committing or writing their report. **Instruct agents to commit before writing
  their report**, and verify state directly rather than resuming blindly.
- Local `pnpm mutation` exceeded 10 minutes; in CI it takes ~2m45s. Don't run it locally in an
  agent — let CI gate it.

---

## Where things stand and what needs the user

**Carried by PR #10** (`docs/pglite-decision-and-plan-2`): the spec's PGlite correction, this
handoff, and a round of corrections to both after review — see the Vitest-version and
XSDs-on-disk notes above, each of which would have misled plan 2.

**Nothing else is outstanding.** PR #9 is merged, the worktree is torn down, the ruleset is updated.

**Standing preferences confirmed this session:**

- Do not raise the DGT consulta again. Work on stated assumptions (Q1, Q2 assumed favourable).
- Recommendations over surveys — lead with a pick and the reasoning.
- Findings must be verified empirically, not asserted. Every significant decision this session was
  settled by executing something, not by reasoning from documentation — and twice the documentation
  was simply wrong (Drizzle's RLS page, drizzle-kit's `out` type).
