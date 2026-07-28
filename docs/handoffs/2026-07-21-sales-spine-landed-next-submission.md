# Handoff — the sales spine landed, next is submission (plan 3)

**Date:** 2026-07-21
**Main:** `7e8054b` — "feat: sales spine — data model + write path (plan 2) (#12)", squash-merged.
**Next work:** plan 3 — submission (outbox drainer, batching, flow control, retry, CSV, error-3000,
acks, reconciliation). And a tracked follow-up list that mostly *belongs inside* plan 3 — see below.

This handoff carries what the committed docs do **not**. Most of what matters is on `main`.

---

## Read these first, in this order

1. [`docs/superpowers/plans/2026-07-20-sales-spine-data-model.md`](../superpowers/plans/2026-07-20-sales-spine-data-model.md)
   — the executed plan. Its **`## Execution errata`** section (near the end) lists defects execution
   found in the plan's *own illustrative code*; read it before re-running anything from the plan.
2. [`docs/superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md`](../superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md)
   — the design. §7 is the submission design plan 3 implements.
3. [`docs/compliance/verifactu-findings.md`](../compliance/verifactu-findings.md) — **authoritative**
   on regulation; wins over every other document. §2 (no submission deadline, but hourly-retry duty)
   and §5.4 (requirements not yet built) are the plan-3 surface.
4. [`docs/compliance/implementation-provenance.md`](../compliance/implementation-provenance.md) —
   binding. `mdiago/VeriFactu` is AGPL-3.0 and its source is not read.

---

## What landed

The full **sales spine**: seven packages, a sale that produces a correctly chained, immutable,
atomic Veri\*Factu fiscal record, proven end-to-end against real tables.

| Package | What it holds |
| --- | --- |
| `packages/shared` | `AppError` (typed code+params, **domain-concept dotted codes**), branded ids, exact-decimal money |
| `packages/db` | Drizzle + PGlite (standalone) / real Postgres (cloud), **one dialect**. Tenancy+RLS, immutability (privilege revocation + triggers), `invoice_series`, `working_orders`, `sales`/`sale_lines`/`tenders`, `sale_voids`, `incidents`. Dual-target (PGlite + Testcontainers) harness. Migrations `0000`–`0008`. |
| `packages/fiscal` | Regime-neutral `FiscalBackend` interface (+ genuine fake), `TrustedClock` |
| `packages/fiscal-verifactu` | Spanish schema (`registros_facturacion`, `cadenas`, `registro_sif`, `contadores_instalacion`, `envios`), till/SIF registration, chain append, art. 7.i verification, the real `VerifactuBackend`. Migrations `0000`–`0001` (own folder + journal). |
| `packages/core` | `recordSale` (spec §4 write path), `recordVoid` (interleaved anulación) |
| `packages/verifactu` | (plan 1, unchanged) — now also carries `schemas/` (the AEAT XSDs/WSDL, committed) |

Executed as 18 subagent-driven tasks, each with an independent adversarial review + fix loop, then a
whole-branch review, a 4-angle cleanup pass, and finish→CI→land. Full per-task audit trail was in
`.superpowers/sdd/progress.md` (gitignored — **it did not travel**; this handoff is the durable
extract).

---

## The most important thing for the next session

**`FiscalBackend.pendingCount(tillId)` has no `tenantId` and is unverified under real RLS.** Under a
plain `app_user` connection with no tenant GUC it silently returns **0** — and that method backs the
**art. 16.4 legally-required unsent-count display**. There is no caller yet, so it is latent, not
live. But it **must be fixed before the unsent-count UI is wired to it**, and the fix is an interface
change (`checkIntegrity` has the same gap). **Plan 3 is the first real consumer of both** (the
drainer reports pending counts; reconciliation calls checkIntegrity-shaped reads), so the natural
place to do the `tenantId` interface revision is *as part of plan 3*, not as a standalone chore.

---

## Tracked follow-ups (were in the gitignored ledger — this is the durable copy)

Roughly by value. Items 1–3 are best folded into plan 3 rather than done separately.

1. **Write-path perf — 4 duplicate per-sale round trips.** `checkIntegrity`/`verifyChain` fetch the
   SIF row, the chain-head (`FOR UPDATE`), and the predecessor registro; `appendToChain` then
   **re-fetches all three** in the same transaction. Plus a `tenantIdForTill` query that exists only
   because `checkIntegrity(tx, tillId)` lacks `tenantId`. ~0.5–0.8ms each. The fix threads the
   already-fetched/locked state through — **which touches `chain.ts`'s append/savepoint/retry loop
   (concurrency-critical, Testcontainers-proven), so it needs the concurrency suite re-verified.**
   Deliberately NOT done in the pre-PR cleanup for that reason.
2. **Interface revision: add `tenantId` to `FiscalBackend.checkIntegrity` AND `pendingCount`** — the
   compliance item above. One considered change; re-verify RLS behaviour. Bundle with #1.
3. **`formatAmountExact(string)` in `packages/verifactu`**, and route `VerifactuBackend`/`vat.ts`
   through it. `VerifactuBackend.recordSale` currently does `Number(sale.total)` into the
   number-typed `AltaInput` — safe today (recovers the exact 2dp within `numeric(12,2)` range) but a
   latent float-boundary coupling, the plan-1 one-cent-divergence class. Also removes a third
   independently-maintained copy of `@waitron/shared/money.ts`'s BigInt decimal codec (`vat.ts`).
4. **Port the `tenant_id`-keyed RLS auto-discovery guard into `packages/db`.** `packages/db`'s
   immutability guard discovers tables by `reject_mutation()` trigger (immutable only);
   `packages/fiscal-verifactu` already has a *widened* `tenant_id`-keyed version. Current `packages/db`
   mutable tenant tables are all functionally guarded (bespoke leak tests), so this is future-proofing
   a *new* table, not a live gap.
5. **Consolidate `isUniqueViolation`** — byte-identical in `packages/db/src/unique-violation.ts` and
   `packages/fiscal-verifactu/src/chain.ts`. It is **public API** in fiscal-verifactu (barrel export +
   pin + 4 direct tests), so do it as its own small API-tidy PR (migrate the 4 tests). The db author
   already documented the deliberate deferral.
6. **Extract the `errors.reachability.test.ts` graph-walker (byte-identical ×4) and the two-tenant
   seed helper** to shared test infra. Watch the coverage/dependency-edge questions (a shared
   test-util used only by downstream packages).
7. **`borjamrd/verifactu-conformance` harness** — user-decided (2026-07-21): its own branch, **after**
   this. **Pin a version, don't float**; verify the source exists before wiring (the XSD lesson). It
   is *not* wired today — `packages/verifactu` tests against 3 hand-transcribed AEAT vectors only.

---

## Verified facts you would otherwise re-derive expensively (CI / harness / tooling)

All empirically confirmed this session.

- **The pre-push hook passes in ~50s; CI's `test` job is different and stricter.** The hook runs
  `pnpm test`; CI runs `pnpm -r test:coverage` **with `REQUIRE_DOCKER=1`** — which *forces* the
  Testcontainers/real-Postgres suites to run (no soft-skip) and enforces coverage thresholds. **A
  green pre-push does not mean green CI.** This is exactly what bit PR #12 (see below).
- **`createPostgresDb` must attach a pool `'error'` listener** (fixed in `cc5f531`, now on main). A
  node-postgres `Pool` with no `'error'` handler turns an idle-client termination (a container stop
  → SQLSTATE `57P01`, or in prod an ECONNRESET/failover) into an **uncaught exception that crashes
  the process**. The concurrency suite's container teardown surfaced it as 3 unhandled errors that
  failed CI even though all tests passed. If you add another pg-pool construction site, it needs the
  same handler.
- **Required status checks (ruleset `19157474`):** `static-analysis`, `typecheck`, `test`,
  `mutation-verifactu`, `mutation-shared`. **`mutation-db` is deliberately NOT required** — it lives
  in `mutation.yml` (schedule + `workflow_dispatch` only, never `pull_request`), so requiring it
  would deadlock every merge. A new pure-Node package can add a per-PR `mutation-<pkg>` gate in
  `ci.yml`; a Docker/PGlite-heavy package should use the weekly `mutation.yml` model (Stryker reruns
  the suite per mutant, and every DB test boots a WASM Postgres).
- **Copilot could not review PR #12** — the ~30k-line diff exceeds its 20,000-line cap. It returned
  a non-blocking "couldn't review" comment. **A branch this size gets no Copilot coverage.** If that
  matters, sub-project PRs need to be smaller.
- **The husky pre-push hook runs the full gate on a branch-*deletion* push** (no code) and fails —
  a hook wart. Deleting a remote branch needs `git push origin --delete <b> --no-verify` (legitimate:
  a ref deletion ships nothing). **Worth a one-line hook fix to skip delete-refs.**
- **Testcontainers cost:** each test *file* starts its own `postgres:18-alpine` container; the full
  run is ~16 container starts. Accepted, inherent to the `Target` design; a CI-cost/flake watch item.
- **Worktrees here are `worktree.py` (`~/workspace/worktrees/`), registered** — so `/land-branch`'s
  registry lookup and teardown worked normally (unlike the plan-1 handoff's note about
  `.claude/worktrees`). Docker was up throughout; the concurrency suites need it.

---

## Decisions made this session (not obvious from the code)

- **Error codes are domain-concept** (`sale.*`, `chain.*`, `clock.*`, `sif.*`, `series.*`,
  `shared.*`), never package-prefixed — they are translation keys, and a package prefix leaks
  structure into the UI (spec §9). Registered per-package via `declare module "@waitron/shared"`
  (declaration merging *must* be per-package) with a barrel-reachability test. **Follow this for any
  new code in plan 3.**
- **Fiscal amounts are `text`, not `numeric`** (`registros_facturacion.cuota_total`/`importe_total`).
  The huella hashes the exact serialised literal; `verifyHuella` re-reads the stored literal and
  hashes it byte-for-byte, and `numeric(12,2)` both re-renders and *overflows* a 12-integer-digit
  AEAT-legal amount (`ImporteSgn12.2Type` is 12+2). `offset_minutos` is a separate column because
  `timestamptz` destroys the original offset the huella covers. **The `envios` sidecar and any plan-3
  persistence must respect this — never round-trip a hashed value through a JS number or `numeric`.**
- **`VerifactuBackend` was built as part of Task 16** by explicit user decision — the plan's File
  Structure named it but no task step built it. It wires `registerSif`/`appendToChain`/`verifyChain`/
  the `envios` row into the `FiscalBackend` interface. Plan 3's drainer will hang off the same class.
- **No fiscal condition blocks a sale** — a chain-verification failure records an `incidents` row and
  the sale completes (AEAT: invoicing *«NUNCA debe interrumpirse»*). This is pinned by inverting it
  (making it throw → a named test fails). **Plan 3 must preserve this**: a submission failure,
  outage, or expired cert has *no effect on selling* — the outbox drains later.

---

## Plan 3 — the shape (from spec §7, not yet planned in detail)

The `envios` sidecar table already exists (1:1 with a registro, written `pendiente` by the write
path, **drained by nobody yet**). Plan 3 builds the drainer against it. The high-consequence,
already-verified design points (spec §7 is dense and primary-source-checked — re-read it):

- **Batched per obligado tributario, ≤1000 records/envío** (`maxOccurs="1000"`, codes 4113/4114).
  Multi-SIF within one tenant is allowed; the batching key is the **tenant**, not the till.
- **Flow control is a race, not a fixed delay** — send when `t` (server-supplied, init 60s) elapses
  *or* 1000 records accumulate, whichever first. Driven by `next_attempt_at` in the DB, never an
  in-memory timer (survives restarts — findings §5.4).
- **The CSV must be persisted in the same transaction as the submission response** — it is
  unrecoverable afterward (no CSV element exists in the consulta response). Highest-consequence line.
- **Error 3000 inverts** — the outer `Incorrecto` hides a `RegistroDuplicado` whose stored state may
  be `Correcta`. Resolve via Route A (the block) + Route B (consulta, compare *our* huella against
  the stored one). `packages/verifactu` already parses both response types with **separate** enums.
- **`Incidencia="S"`**, acks flowing downstream, reconciliation via consulta (paginated), and the
  art. 16.4 hourly-retry duty. `pendingCount` is the unsent-count read (fix its `tenantId` first).

Real AEAT submission is still gated on a certificate + preproduction access (spec §11) — plan 3 is
built and tested against the faithful fake, exactly as `packages/verifactu`'s client already is.

---

## Where things stand / what needs the user

- **Nothing is broken or outstanding on `main`.** PR #12 landed green; the worktree is torn down;
  local + remote branches deleted.
- **Standing preferences confirmed this session:** recommendations over surveys; verify empirically,
  not by assertion (this session the review loop caught a numeric/text Critical, a fail-open on the
  audit surface, a silently-inert RLS recipe, and several vacuous tests — *none* caught by the test
  suites, all by adversarial reviewers re-running mutations); the `borjamrd` conformance suite is a
  tracked follow-up on its own branch, pinned.
- **Open decision for next session:** do plan 3 as one plan, or split it (submission client + drainer
  vs reconciliation)? Spec §7 is large. Recommend brainstorming the split before writing the plan —
  and fold the `pendingCount`/`checkIntegrity` `tenantId` revision and the write-path round-trip
  dedup into it rather than tracking them separately.
