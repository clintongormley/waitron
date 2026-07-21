# Sales Spine — Data Model and Write Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the database layer and the sale write path, so that completing a sale produces a correctly chained, immutable fiscal record inside one transaction — with tenancy, immutability and never-reused numbering enforced by the database rather than by application code remembering.

**Architecture:** One dialect, Postgres, in both deployment modes — PGlite (embedded WASM Postgres) standalone, real Postgres in the cloud. Generic tables live in `packages/db` and speak English; the Veri\*Factu module owns its own tables and speaks Spanish; only the `FiscalBackend` interface crosses between them. Immutability and tenant isolation are database properties — triggers plus a non-owner application role — precisely so they do not depend on the application behaving.

**Tech Stack:** TypeScript 5.7+, Drizzle ORM 0.45.x (`pg-core`), `@electric-sql/pglite` 0.5.x, `node-postgres` 8.x, Vitest 3 (Node environment, matching the rest of the repo), `@testcontainers/postgresql` for the small real-Postgres suite that PGlite provably cannot substitute for.

**Source spec:** [`2026-07-19-sales-spine-and-fiscal-layer-design.md`](../specs/2026-07-19-sales-spine-and-fiscal-layer-design.md) §§2, 3, 4, 6, 8, 9, 10. Regulatory facts: [`verifactu-findings.md`](../../compliance/verifactu-findings.md), which wins over every other document.

**Scope note:** This is plan 2 of 3. Plan 1 built `packages/verifactu` (merged, `7938e1b`). This plan builds the data model and the synchronous write path. **Plan 3 is submission** — outbox drainer, batching, flow control, retry, CSV persistence, error-3000 resolution, `Incidencia="S"`, acks and reconciliation — and is deliberately not here. This plan produces working software without it: the legally-required record exists and is chained, and submission has no deadline (findings §2).

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Node 26** (`.nvmrc`; note `engines.node` is the looser `>=24`), **pnpm 9.15.0**. New package names `@waitron/db`, `@waitron/shared`, `@waitron/fiscal`, `@waitron/fiscal-verifactu`, `@waitron/core`.
- **One dialect only.** Drizzle `pg-core`. There is no SQLite path and no dual-dialect abstraction. If a task seems to need `sqlite-core`, stop — that is the decision spec §3 reversed, and reopening it is a design question, not an implementation choice.
- **Spanish vocabulary stops at the module boundary.** `packages/db`, `packages/core`, `packages/fiscal`, `packages/shared` are English throughout — identifiers *and* table/column names. `packages/verifactu` and `packages/fiscal-verifactu` are Spanish, mirroring AEAT. Mechanically enforced by Task 3; the guard is scoped by path, so it must not fire on the two Spanish packages.
- **`packages/verifactu` keeps its zero-in-repo-dependency boundary.** Nothing in this plan may import it *from* `packages/verifactu`, and nothing may weaken the `import-x/no-restricted-paths` zone in `eslint.config.js`. `packages/fiscal-verifactu` depends on `packages/verifactu`, never the reverse.
- **Immutability is a database property.** Fiscal records and sales are protected by revoking `UPDATE`/`DELETE` from a non-owner application role, with triggers as the backstop. **Migrations run as owner; the application never does.** A test that runs as the owner proves nothing — an owner can `ALTER TABLE … DISABLE TRIGGER`.
- **Every RLS test must `set local role app_user`.** PGlite runs as superuser, and **superusers bypass RLS even with `FORCE ROW LEVEL SECURITY`** — Postgres docs say superusers "always bypass". A tenant-isolation suite that omits the role change passes green while asserting nothing.
- **PGlite cannot test lock contention.** Concurrent queries serialise onto one backend (`pg_backend_pid()` identical); `FOR UPDATE` parses and runs but never blocks. Chain-append concurrency properties are tested against **real Postgres via Testcontainers** (Task 14), never PGlite.
- **Numbering may never be reused, even for test invoices** (findings §1). Fixtures and AEAT preproduction only. **Never a production NIF.**
- **Per-test red phase.** Observe every new test failing **individually** before writing its implementation. Run the single test by name, not the file. Seven vacuous tests were found across plan 1 despite this rule being in force — see the adversarial-mutation requirement below.
- **Every task ends with an adversarial mutation check.** Break the behaviour under test, confirm the *specific* expected test fails, restore. "The implementer spot-checked three tests" is unverified until someone else breaks them. This is the only thing that reliably caught vacuous tests in plan 1.
- **Errors crossing a package boundary are a structured code plus typed params, never prose** (spec §9). `throw new Error("chain verification failed")` reaches a screen untranslatable.
- **Nothing formatted is ever stored — in the generic layer.** `packages/db`'s monetary columns are `numeric(12, 2)`; currency, date and number formatting are display concerns. **This constraint stops at the module boundary and must not be carried into `packages/fiscal-verifactu`.** The huella is SHA-256 over the literal string that was serialised, so a registro's amounts are stored as `text` exactly as they were hashed. Storing them as `numeric` and re-rendering on read would make art. 7.i report corruption on rows nobody had touched — the check would be comparing against a literal the database can no longer reproduce. Same reasoning as `offset_minutos` below: "serialise once, hash that exact literal" is a storage requirement, not only a serialisation one.
- **Prettier**: `printWidth: 100`, `trailingComma: "all"`. `pnpm exec prettier` fails from the repo root — use `./node_modules/.bin/prettier`. **TypeScript**: `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `isolatedModules`, `.js` import extensions on relative imports.
- **Vitest stays at `^3.0.0`** to match `packages/ui` and `packages/verifactu`. Vitest 4.1.10 exists; installing it here would put two Vitest majors in one workspace. Upgrading all packages is a separate decision, not a side effect of this plan.

### What "no fiscal condition blocks a sale" means (spec §4)

AEAT is explicit that invoicing *«NUNCA debe interrumpirse»*. Encoded as a hard rule:

| Condition | Behaviour |
| --- | --- |
| Chain verification fails | Record the incident, **chain the next record anyway**, surface to staff |
| Clock confidence degraded | Warn only |
| AEAT outage, submission failure, expired certificate, offline | No effect on selling whatsoever |

A test asserting that a sale is *blocked* on a huella mismatch enforces the opposite of the requirement. Ordinary operational failures — a declined card, a failed database write — still stop a sale, and should.

---

## File Structure

```text
packages/shared/
  src/
    index.ts                    re-exports only
    errors.ts                   AppError, ErrorCode, typed params — crosses every boundary
    ids.ts                      branded id types (TenantId, TillId, SaleId, …)
    money.ts                    Decimal string helpers; exact numerics, never float

packages/db/
  drizzle.config.ts             out: "./drizzle" — a single string, not an array
  drizzle/                      generated migrations + meta/_journal.json (Prettier-ignored)
  src/
    index.ts                    re-exports only
    client.ts                   createPgliteDb, createPostgresDb, one Database type
    migrate.ts                  runMigrations(db, { folder, table }) — per-package journals
    tenancy.ts                  withTenant(), set_config-based; RLS session plumbing
    allocate-number.ts          strictly-increasing series allocation (Task 6)
    schema/
      tenants.ts                tenants, locations, tills
      series.ts                 invoice_series
      orders.ts                 working_orders, working_order_lines
      sales.ts                  sales, sale_lines, tenders
    testing/
      harness.ts                describe.each dual-target seam (pglite | postgres)
      roles.ts                  asAppUser() — the seam every RLS test must go through
  test/
    fixtures.ts                 shared literals only, never *.test.ts

packages/fiscal/
  src/
    index.ts
    backend.ts                  FiscalBackend interface — English, regime-neutral
    clock.ts                    TrustedClock: monotonic anchor, never blocks, biases slow

packages/fiscal-verifactu/
  drizzle.config.ts             its own out dir and its own journal table
  drizzle/
  src/
    index.ts
    schema/
      registros.ts              registros_facturacion (immutable)
      cadenas.ts                cadenas — chain head, row-locked on append
      sif.ts                    registro_sif — NúmeroInstalación, IdSistemaInformatico
      envios.ts                 the submission sidecar (rows written here, drained in plan 3)
    chain.ts                    appendToChain — FOR UPDATE + unique backstop + bounded retry
    verify.ts                   art. 7.i pre-generation verification
    backend.ts                  VerifactuBackend implements FiscalBackend

packages/core/
  src/
    index.ts
    record-sale.ts              the write-path transaction, spec §4 steps 1–7
    record-void.ts              anulación against an existing sale
```

Schema files are split by aggregate rather than by table count, so the tables that change together live together. `chain.ts` is deliberately separate from `backend.ts`: chain append is the part whose concurrency behaviour must be provably correct against real Postgres, and it should be readable without the adapter plumbing around it.

**The fiscal schema file may `import` core tables but must never re-export them.** Re-exporting pulls them into the fiscal package's Drizzle snapshot and generates a duplicate `CREATE TABLE`. Verified end to end.

---

## The naming contract

Every task below binds to these names. They are fixed here so that tasks written and reviewed independently cannot drift apart — a mismatch between a producer and a consumer is the defect class this section exists to prevent.

### Generic tables (English, `packages/db`)

| Table | Columns that other tasks depend on |
| --- | --- |
| `tenants` | `id`, `nif`, `legal_name`, `created_at` |
| `locations` | `id`, `tenant_id`, `name`, `invoice_locales` (`text[]`, ordered, 1–2 entries), `operation_description` |
| `tills` | `id`, `tenant_id`, `location_id`, `name`, `created_at` |
| `invoice_series` | `id`, `tenant_id`, `till_id`, `code`, `purpose`, `next_number` |
| `working_orders` | `id`, `tenant_id`, `till_id`, `status` (`open`\|`settled`\|`abandoned`), `opened_at`, `settled_at` |
| `working_order_lines` | `id`, `tenant_id`, `working_order_id`, `line_no`, `descriptions` (jsonb locale→string), `quantity`, `unit_price`, `vat_rate`, `line_total` |
| `sales` | `id`, `tenant_id`, `till_id`, `series_id`, `invoice_number`, `issued_at`, `total`, `tip_amount`, `amount_charged`, `locale`, `invoice_locales`, `fiscal_backend`, `fiscal_state` (written once at insert, never updated) |
| `sale_voids` | `id`, `tenant_id`, `sale_id` (UNIQUE), `reason`, `voided_at`, `voided_by` — append-only |
| `incidents` | `id`, `tenant_id`, `till_id`, `sale_id`, `code`, `params`, `severity`, `detected_at`, `acknowledged_at`, `acknowledged_by` |
| `sale_lines` | `id`, `tenant_id`, `sale_id`, `line_no`, `descriptions`, `quantity`, `unit_price`, `vat_rate`, `line_total` |
| `tenders` | `id`, `tenant_id`, `sale_id`, `method`, `amount`, `settled_at` |

`total` and `amount_charged` are distinct, with `tip_amount` separate and non-taxable (architecture §10). All monetary columns are `numeric(12, 2)` — never `double precision`.

**`sales.fiscal_state` cannot be both mutable and immutable, and the spec asks for both.** §6 has the module write `fiscal_state` on `sales`; §3 revokes `UPDATE` on `sales` from the app role. A void therefore cannot flip it. Resolved by `sale_voids`, append-only and in the generic layer, which preserves §6's actual objective — a Z-report needing no cross-boundary join per row — while `fiscal_state` is written once at insert and never moves.

**"A crash before commit burns an invoice number" is false as the spec states it.** With `invoice_series.next_number` as a *column*, the allocating `UPDATE` is transactional: a rollback returns the number and no gap appears. Burning would require a `SEQUENCE`, since `nextval` is non-transactional. The property that actually matters is the one the regulation requires — **a number is never reused once used** — backed by `UNIQUE (tenant_id, series_id, invoice_number)`. Do not add a sequence to make the prose true; the prose is what is wrong, and spec §3 and §4 both carry the error.

### Module tables (Spanish, `packages/fiscal-verifactu`)

| Table | Purpose |
| --- | --- |
| `registros_facturacion` | Immutable registros: invoice identity, `tipo_registro` (`alta`\|`anulacion`), `tipo_factura`, `desglose` (jsonb), totals, the four-part `encadenamiento` pointer, `primer_registro`, `sistema_informatico` snapshot, `fecha_hora_huso_gen_registro`, **`offset_minutos`**, `tipo_huella`, `huella`, `sale_id`, `sif_id`, `secuencia` |
| `cadenas` | Chain head per `(tenant_id, till_id)`: `secuencia`, `ultimo_registro_id`, `ultima_huella`, `actualizado_en` |
| `registro_sif` | Per-till SIF identity: `numero_instalacion`, `id_sistema_informatico`, `nif`, `revocado_en` |
| `contadores_instalacion` | The upstream allocator's counter: `nif`, `id_sistema_informatico`, `proximo_numero`. Deliberately carries **no `tenant_id` and no RLS** — a single writer cannot guarantee uniqueness over rows a policy hides from it |
| `envios` | Submission sidecar, 1:1 with a registro: `estado`, `intentos`, `proximo_intento_en`, `incidencia`, `csv`, `codigo_error`, `mensaje_error`, `enviado_en`, `confirmado_en` |

**`offset_minutos` is load-bearing, not redundant with the timestamp.** `timestamptz` normalises
to UTC and renders in the session's zone, destroying the original `+01:00`. The huella hashes the
literal *including* its offset, so without this column a stored registro cannot be re-hashed and
art. 7.i verification would compare against a value it can no longer reproduce. Storing "UTC plus
offset" (spec §9) means two columns, not one.

**`envios` is Spanish throughout**, like the rest of this package. An earlier draft of this
contract mixed `estado`/`intentos` with `next_attempt_at`/`submitted_at`; the English-only guard
runs in one direction only, so nothing would have caught it.

### Chain identity — the part that is easy to get wrong

`cadenas` is keyed `(tenant_id, till_id)`, but spec §3 says a new installation number is a **new
SIF identity, therefore a new chain**. One till that is re-provisioned accumulates two SIF
identities under a key that admits only one, so the two statements cannot both be read naively.

The resolution: **`sif_id` on the registro is the chain identity; the `cadenas` row is only the
head pointer.** Re-registration nulls `ultimo_registro_id` and `ultima_huella` but leaves
`secuencia` untouched. Resetting the counter to zero collides head-on with
`UNIQUE (tenant_id, till_id, secuencia)` on the very next append — and "new chain means reset the
counter" is the obvious reading, which makes this a live production bug rather than a
theoretical one. The sequence is ours, an ordering aid for the outbox, never AEAT's (spec §3).

**The chain head is not self-sufficient for building `Encadenamiento`.** It holds
`ultimo_registro_id` and `ultima_huella` — one of the four parts. Serie, número and fecha de
expedición come from a join to `registros_facturacion` under the lock already held.

`registros_facturacion` carries `UNIQUE (tenant_id, till_id, secuencia)` — the non-negotiable backstop against two writers claiming one chain position.

### Function signatures

```text
// packages/shared
class AppError<C extends ErrorCode = ErrorCode> extends Error {
  code: C
  params: Readonly<ErrorParams[C]>   // declaration-merged registry, not Record<string, unknown>
}

// packages/db
type Database   // carries `driver: "pglite" | "postgres"` and `close()`
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]
createPgliteDb(dataDir?: string)                  → Promise<Database>
createPostgresDb(connectionString: string)        → Promise<Database>
runMigrations(db, { migrationsFolder, migrationsTable }) → Promise<void>
withTenant(db, tenantId, fn)                      → Promise<T>   // set_config, in a transaction
asAppUser(tx)                                     → Promise<void> // set local role app_user
allocateInvoiceNumber(tx, seriesId)               → Promise<number>
describeEachTarget(name, suite: (target: Target) => void)
interface Target { name: "pglite" | "postgres"; setup(); create(): Promise<Database>; teardown() }
current_tenant_id()   // SQL: STABLE, pinned search_path, guarded uuid cast, nullif(…,'')

// packages/fiscal
interface FiscalBackend {
  id: string                                     // supplies sales.fiscal_backend
  registerTill(tx, tenantId, tillId, params)     → Promise<TillRegistration>
  recordSale(tx, sale)                           → Promise<FiscalRecordRef>
  recordVoid(tx, saleId, reason)                 → Promise<FiscalRecordRef>
  checkIntegrity(tx, tenantId, tillId)           → Promise<IntegrityReport>
  pendingCount(tenantId, tillId)                 → Promise<number>
}
type FiscalRecordRef = { recordId, hash, sequence, qrPayload }   // `hash`, never `huella`
interface TrustedClock { now(): { instant: Date; offsetMinutes: number; confident: boolean } }

// packages/fiscal-verifactu
lockChainHead(tx, tenantId, tillId)           → Promise<ChainHead>
appendToChain(tx, tenantId, tillId, pending: PendingRegistro)
                                              → Promise<{ secuencia: number; huella: string }>
verifyChain(tx, tenantId, tillId)             → Promise<IntegrityReport>

// packages/core
recordSale(tx, backend, input)       → Promise<{ saleId: SaleId; fiscal: FiscalRecordRef }>
recordVoid(tx, backend, saleId, reason) → Promise<{ fiscal: FiscalRecordRef }>
```

`recordSale` takes a transaction handle. This is a deliberate leak: atomicity between the sale and the chain append is the entire point, and an interface hiding it would let a backend break it silently. Every `tx` above is typed `Transaction`, not `Database` — a caller that passes a pool would get autocommit and no atomicity at all.

**`allocateInvoiceNumber` lives in `packages/db`, not `packages/core`.** It is one `UPDATE ... RETURNING` against `invoice_series` with no orchestration in it, and `packages/core` does not exist until Task 16 — while Task 6, which builds it, is a `packages/db` task. Putting it in `packages/core` would also mean the series table and the only statement that writes it live in different packages, so a reader chasing "what advances `next_number`?" has to cross a package boundary to find one line of SQL.

**There is exactly one dual-target harness signature, and it is Task 2's.** `describeEachTarget` passes the `Target` itself, and a test obtains its database by calling `target.create()` — which yields a **fresh, migrated** database per test. Not a `target.db` property and not a `ctx.db()` accessor: earlier drafts of Tasks 4–8 used both, and a shared handle is what makes a suite order-dependent. The consumer shape is always:

```ts
describeEachTarget("what is under test", (target) => {
  let db: Database;
  beforeEach(async () => {
    db = await target.create();
  });
  // …
});
```

**The generic interface says `checkIntegrity`, not `verifyChainBeforeWrite`, and `registerTill`, not `registerSif`.** Spec §6 lists both of the latter, but spec §2 is explicit that the chain concept never appears in the generic layer, and *SIF* is a Spanish regulatory acronym in a package the Global Constraints declare English throughout. Those cannot both hold, and §2 is the load-bearing one: it is the reason a second backend touches nothing here.

Two further consequences, both easy to miss:

- **The rule reaches the returned type's fields, not just method names.** `IntegrityReport` may not name a `huella`, so its failure reason is `predecessor-hash-mismatch`; `FiscalRecordRef` carries `hash`, never `huella`.
- **Regime vocabulary written in English is still regime vocabulary**, so Task 3's English-only guard would not catch `verifyChainBeforeWrite` — every word of it is English. A second, separate guard scans the generic packages for `chain`/`huella`/`hash`/`aeat`/`sif`/`csv`.

`checkIntegrity` is also the better *shape*: `verifyChainBeforeWrite` is prescriptive, telling the backend what to verify, which is entirely the module's business. `checkIntegrity` asks the question `packages/core` actually needs answered. The test that a generic name is honest rather than merely vague: a regime with nothing to check answers `{ ok: true, checked: 0, issues: [] }` — a true statement, not a stub.

**`appendToChain` takes a `PendingRegistro`, not a finished record.** The huella depends on the predecessor, which is unknown until the head row is locked, so a fully-built registro cannot exist before the call. `PendingRegistro` is the record's inputs minus `Encadenamiento`.

**The bounded retry runs each attempt in a nested `tx.transaction()` (a savepoint).** In Postgres a `23505` aborts the *entire* transaction, so a naive retry loop would issue its next statement against a transaction that can only accept `ROLLBACK` — destroying the already-written sale along with it. This is not an optimisation; without the savepoint the retry cannot work at all.

**Spec §4's step order is a lock-ordering requirement, not a regulatory one.** The spec presents "lock the chain row → verify → allocate the number" as a sequence without saying why verification precedes allocation. The reason is deadlock: the chain row and the series row are two lockable resources, and two concurrent sales on one till that take them in opposite orders will deadlock. **Chain first, then series, everywhere, with no exceptions.** That is an asserted test in Task 16, not a comment — a comment would not survive the first person who reorders the steps for readability.

---
## Task 1: PGlite throughput benchmark against the local-server topology

A spike, not a feature. Spec §3 records the PGlite decision with one open risk attached — PGlite is single-connection and fully serialises queries, and §5 recommends a local server, which makes that one node the venue's throughput ceiling. This task measures the ceiling **before** any schema exists, so that a bad number changes the standalone decision while nothing is built on top of it.

**Files:**

- Create: `bench/pglite-throughput/package.json`
- Create: `bench/pglite-throughput/tsconfig.json`
- Create: `bench/pglite-throughput/README.md`
- Create: `bench/pglite-throughput/src/bench.ts`
- Create: `docs/research/2026-07-20-pglite-throughput.md`
- Modify: `pnpm-workspace.yaml` (add the `bench/*` glob)

**Interfaces:**

- Consumes: nothing. This package imports no `@waitron/*` package and is imported by none.
- Produces: `pnpm --filter @waitron/bench-pglite bench` and a measured report at `docs/research/2026-07-20-pglite-throughput.md`.

- [ ] **Step 1: Decide where it lives so `pnpm -r test` can never pick it up**

The benchmark is a spike whose output is a document. It must never become a permanent CI cost, and it must never fail the `test` job because a laptop was busy. Two independent mechanisms keep it out:

1. **It defines no `test` script.** Root `pnpm test` is `pnpm -r test`, and pnpm's recursive run skips workspace members that do not define the script rather than failing on them. The package defines `bench` and `typecheck` only.
2. **It contains no `*.test.ts` file.** Even if someone later adds a `test` script by reflex, Vitest's default include pattern would match nothing.

The rejected alternative was placing it outside the workspace entirely, at a bare `bench/` directory with its own `npm install`. That keeps it out of `pnpm -r` trivially but gives it a second, unpinned dependency tree in a repo that pins pnpm to `9.15.0` — and a benchmark measuring a different `@electric-sql/pglite` build than the one `packages/db` will ship measures nothing useful.

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  # Benchmarks and spikes. Workspace members so they resolve the same pinned
  # dependency versions the product packages do — a throughput number measured
  # against a different PGlite build than the one we ship is not evidence about
  # the thing we ship. They deliberately define no `test` script, so `pnpm -r
  # test` (and therefore the CI `test` job) skips them.
  - "bench/*"
```

- [ ] **Step 2: Create the benchmark package**

`bench/pglite-throughput/package.json`:

```json
{
  "name": "@waitron/bench-pglite",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "bench": "node src/bench.ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.5.4",
    "@testcontainers/postgresql": "^12.0.4",
    "@types/node": "^24.0.0",
    "@types/pg": "^8.20.0",
    "pg": "^8.22.0",
    "typescript": "^5.7.0"
  }
}
```

`node src/bench.ts` runs the TypeScript directly. Node 26 strips types natively with no flag and no build step, which is why there is no `tsx` dependency here. That imposes exactly one constraint, and it is why `bench.ts` is a single self-contained file: native type stripping does **not** perform the `.js`→`.ts` specifier remapping the rest of the repo relies on, so a relative import between two files in this package would resolve at typecheck time and fail at runtime. Bare specifiers into `node_modules` are unaffected.

`bench/pglite-throughput/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the benchmark**

Three things are measured, not one. Sustained throughput is the headline, but two of the numbers this task produces are consumed by Task 2 and would otherwise be guessed: **cold-boot time**, which sets Vitest's `testTimeout`, and **the cost of creating a fresh database**, which decides whether a per-PR mutation gate is affordable at all.

One trap governs the shape of the code. Hand-rolling `begin` / `commit` as separate `query()` calls from concurrent callers **silently merges them into one transaction on PGlite**, because every caller shares the single backend — this is the exact false pass spec §10 records, where a contention test appeared to pass while both statements had become one transaction. PGlite's own `transaction()` serialises correctly, so the PGlite target uses it and only the pooled `pg` target issues explicit `begin` / `commit`. The **statements** are identical across both targets; only the transaction wrapper differs.

`bench/pglite-throughput/src/bench.ts`. One import deserves a note before the file: `pg` is CommonJS and exposes no named ESM exports under Node's resolver, so `import { Pool } from "pg"` typechecks cleanly and then fails at runtime — the least pleasant failure mode available. Use the default import and destructure, here and in `packages/db` later.

```ts
/**
 * Throughput spike for the PGlite standalone decision (spec §3).
 *
 * Simulates the §5 local-server topology: N tills issuing write-path-shaped
 * transactions against ONE database node. Reports p50/p95/p99 commit latency
 * and sustained transactions per second, for PGlite and — as a control — real
 * PostgreSQL via Testcontainers.
 *
 * Emits a Markdown block on stdout, ready to paste into
 * docs/research/2026-07-20-pglite-throughput.md, and exits non-zero if the
 * PGlite result misses the criterion in PASS_CRITERION below.
 */
import { PGlite } from "@electric-sql/pglite";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

/**
 * The bar, justified from the deployment facts rather than invented.
 *
 * First deployment is a NEW deli in Barcelona (architecture §1): greenfield,
 * low initial volume, a handful of tills. Second is an existing restaurant.
 * Model the deli's worst realistic minute — a lunch rush at 4 tills, each
 * settling a sale every 15 seconds — and you get 16 sales/minute, 0.27 tx/s.
 * Model the restaurant generously at 10 tills settling every 20 seconds and
 * you get 30 sales/minute, 0.5 tx/s.
 *
 * So the sustained-throughput bar is set at 20 tx/s: roughly 40x the modelled
 * restaurant peak. The margin is not padding — the same node also serves
 * reprints, voids, Z-report reads and the outbox drainer, and PGlite
 * serialises all of them onto one backend, so they compete for the same
 * budget the sales do.
 *
 * Latency is the number a cashier actually experiences, because the receipt
 * cannot print until the transaction commits. 150ms at p95 keeps the commit
 * below the threshold at which a person perceives a wait; 400ms at p99 keeps
 * the worst sale of a rush from feeling like a queue.
 */
const PASS_CRITERION = {
  minSustainedTps: 20,
  maxP95Ms: 150,
  maxP99Ms: 400,
  maxColdBootMs: 3_000,
};

const TILLS = 8;
const DURATION_MS = 20_000;
const WARMUP_MS = 3_000;
const BOOT_SAMPLES = 5;
const FRESH_DB_SAMPLES = 20;

const SCHEMA_SQL = [
  `create table bench_chains (
     tenant_id text not null,
     till_id text not null,
     sequence integer not null,
     last_hash text not null,
     primary key (tenant_id, till_id)
   )`,
  `create table bench_sales (
     id text primary key,
     tenant_id text not null,
     till_id text not null,
     invoice_number integer not null,
     issued_at timestamptz not null,
     total numeric(12, 2) not null
   )`,
  `create table bench_sale_lines (
     id text primary key,
     sale_id text not null,
     line_no integer not null,
     quantity numeric(12, 3) not null,
     unit_price numeric(12, 2) not null,
     line_total numeric(12, 2) not null
   )`,
  `create table bench_records (
     id text primary key,
     tenant_id text not null,
     till_id text not null,
     sequence integer not null,
     hash text not null,
     unique (tenant_id, till_id, sequence)
   )`,
];

/** Executes one parameterised statement. Both targets supply one of these. */
type Exec = (text: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** Runs `fn` inside one transaction, however this target does transactions. */
type RunInTx = (fn: (exec: Exec) => Promise<void>) => Promise<void>;

/**
 * The write-path-shaped transaction from spec §4: lock the chain head, insert
 * the sale, three lines and the fiscal record, then advance the head. The
 * hash is computed rather than faked because it is on the critical path of a
 * real commit and costs real microseconds.
 */
async function writePath(exec: Exec, tenantId: string, tillId: string): Promise<void> {
  const head = await exec(
    "select sequence, last_hash from bench_chains where tenant_id = $1 and till_id = $2 for update",
    [tenantId, tillId],
  );
  const previous = head.rows[0] as { sequence: number; last_hash: string };
  const sequence = Number(previous.sequence) + 1;
  const saleId = randomUUID();
  const hash = createHash("sha256")
    .update(`${previous.last_hash}|${tenantId}|${tillId}|${sequence}`)
    .digest("hex");

  await exec(
    `insert into bench_sales (id, tenant_id, till_id, invoice_number, issued_at, total)
     values ($1, $2, $3, $4, now(), $5)`,
    [saleId, tenantId, tillId, sequence, "12.34"],
  );
  for (let lineNo = 1; lineNo <= 3; lineNo += 1) {
    await exec(
      `insert into bench_sale_lines (id, sale_id, line_no, quantity, unit_price, line_total)
       values ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), saleId, lineNo, "1.000", "4.11", "4.11"],
    );
  }
  await exec(
    `insert into bench_records (id, tenant_id, till_id, sequence, hash)
     values ($1, $2, $3, $4, $5)`,
    [randomUUID(), tenantId, tillId, sequence, hash],
  );
  await exec(
    "update bench_chains set sequence = $1, last_hash = $2 where tenant_id = $3 and till_id = $4",
    [sequence, hash, tenantId, tillId],
  );
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

interface Result {
  target: string;
  commits: number;
  elapsedMs: number;
  tps: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Drives TILLS concurrent virtual tills against one node for DURATION_MS,
 * discarding the first WARMUP_MS of samples so JIT warm-up and first-touch
 * page faults do not land in the tail percentiles we are judging against.
 */
async function measureThroughput(target: string, tx: RunInTx): Promise<Result> {
  const latencies: number[] = [];
  const started = performance.now();
  const deadline = started + DURATION_MS;
  let commits = 0;

  await Promise.all(
    Array.from({ length: TILLS }, (_unused, index) => {
      const tillId = `till-${index}`;
      return (async () => {
        while (performance.now() < deadline) {
          const at = performance.now();
          await tx((exec) => writePath(exec, "tenant-1", tillId));
          const took = performance.now() - at;
          commits += 1;
          if (at - started >= WARMUP_MS) latencies.push(took);
        }
      })();
    }),
  );

  const elapsedMs = performance.now() - started;
  latencies.sort((a, b) => a - b);
  return {
    target,
    commits,
    elapsedMs,
    tps: (commits / elapsedMs) * 1000,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
  };
}

async function seed(exec: Exec): Promise<void> {
  for (const statement of SCHEMA_SQL) await exec(statement, []);
  for (let index = 0; index < TILLS; index += 1) {
    await exec(
      "insert into bench_chains (tenant_id, till_id, sequence, last_hash) values ($1, $2, 0, '')",
      ["tenant-1", `till-${index}`],
    );
  }
}

/** Cold boot: process start to the first successful query, in-memory. */
async function measureColdBoot(): Promise<number[]> {
  const samples: number[] = [];
  for (let index = 0; index < BOOT_SAMPLES; index += 1) {
    const at = performance.now();
    const db = new PGlite();
    await db.query("select 1", []);
    samples.push(performance.now() - at);
    await db.close();
  }
  return samples;
}

/**
 * The per-test cost of a fresh database: boot, apply the schema, seed. This is
 * what every single test in packages/db will pay, and Stryker pays it once per
 * mutant per covering test — which is what decides whether a per-PR mutation
 * gate is affordable at all.
 */
async function measureFreshDb(): Promise<number[]> {
  const samples: number[] = [];
  for (let index = 0; index < FRESH_DB_SAMPLES; index += 1) {
    const at = performance.now();
    const db = new PGlite();
    await seed((text, params) => db.query(text, params) as Promise<{ rows: never[] }>);
    samples.push(performance.now() - at);
    await db.close();
  }
  return samples;
}

async function runPglite(): Promise<Result> {
  const db = new PGlite();
  await seed((text, params) => db.query(text, params) as Promise<{ rows: never[] }>);
  // PGlite's own transaction(), never hand-rolled begin/commit: on a single
  // shared backend, concurrent callers issuing `begin` merge into ONE
  // transaction and the benchmark silently measures the wrong thing.
  const tx: RunInTx = (fn) =>
    db.transaction(async (t) => {
      await fn((text, params) => t.query(text, params) as Promise<{ rows: never[] }>);
    }) as Promise<void>;
  const result = await measureThroughput("PGlite 0.5.x (in-memory)", tx);
  await db.close();
  return result;
}

async function runPostgres(): Promise<Result> {
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const pool = new Pool({ connectionString: container.getConnectionUri(), max: TILLS });
  const setup = await pool.connect();
  await seed((text, params) => setup.query(text, params));
  setup.release();

  const tx: RunInTx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await fn((text, params) => client.query(text, params));
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  };

  const result = await measureThroughput("PostgreSQL 18 (Testcontainers)", tx);
  await pool.end();
  await container.stop();
  return result;
}

function row(result: Result): string {
  const n = (value: number) => value.toFixed(1);
  return `| ${result.target} | ${n(result.tps)} | ${n(result.p50)} | ${n(result.p95)} | ${n(result.p99)} | ${result.commits} |`;
}

const boot = await measureColdBoot();
const fresh = await measureFreshDb();
const pglite = await runPglite();
const postgres = await runPostgres();

const bootSorted = [...boot].sort((a, b) => a - b);
const freshSorted = [...fresh].sort((a, b) => a - b);

console.log(`
### Sustained write-path throughput — ${TILLS} tills, ${DURATION_MS / 1000}s

| Target | tx/s | p50 ms | p95 ms | p99 ms | commits |
| --- | --- | --- | --- | --- | --- |
${row(pglite)}
${row(postgres)}

### PGlite startup costs

| Measurement | median ms | p95 ms | samples |
| --- | --- | --- | --- |
| Cold boot to first query | ${percentile(bootSorted, 50).toFixed(1)} | ${percentile(bootSorted, 95).toFixed(1)} | ${boot.length} |
| Fresh database (boot + schema + seed) | ${percentile(freshSorted, 50).toFixed(1)} | ${percentile(freshSorted, 95).toFixed(1)} | ${fresh.length} |
`);

const failures = [
  pglite.tps < PASS_CRITERION.minSustainedTps
    ? `sustained ${pglite.tps.toFixed(1)} tx/s < ${PASS_CRITERION.minSustainedTps}`
    : null,
  pglite.p95 > PASS_CRITERION.maxP95Ms
    ? `p95 ${pglite.p95.toFixed(1)}ms > ${PASS_CRITERION.maxP95Ms}ms`
    : null,
  pglite.p99 > PASS_CRITERION.maxP99Ms
    ? `p99 ${pglite.p99.toFixed(1)}ms > ${PASS_CRITERION.maxP99Ms}ms`
    : null,
  percentile(bootSorted, 95) > PASS_CRITERION.maxColdBootMs
    ? `cold boot p95 ${percentile(bootSorted, 95).toFixed(1)}ms > ${PASS_CRITERION.maxColdBootMs}ms`
    : null,
].filter((entry): entry is string => entry !== null);

if (failures.length > 0) {
  console.error(`FAIL against the criterion: ${failures.join("; ")}`);
  process.exit(1);
}
console.error("PASS against the criterion.");
```

- [ ] **Step 4: Typecheck, then run it**

```bash
pnpm install
pnpm --filter @waitron/bench-pglite typecheck
```

Expected: typecheck passes with no output.

```bash
pnpm --filter @waitron/bench-pglite bench
```

Expected: two Markdown tables on stdout, then `PASS against the criterion.` on stderr, exit 0.

Docker must be running for the control target. If it is not, the run fails inside `runPostgres` — **do not** work around that by deleting the control. A PGlite number with nothing to compare it against is a number nobody can interpret: 20 tx/s might be PGlite being slow or might be the write-path transaction being heavy, and only the control distinguishes them.

- [ ] **Step 5: Confirm the benchmark cannot join the CI `test` job**

```bash
pnpm -r test 2>&1 | grep -c "bench-pglite"
```

Expected: `0`.

```bash
ls bench/pglite-throughput/src/*.test.ts
```

Expected: FAIL — `No such file or directory`. Both mechanisms from Step 1 confirmed independently.

- [ ] **Step 6: Write the report**

`docs/research/2026-07-20-pglite-throughput.md`. Paste the two tables the benchmark printed under the headings it already emitted them with — nothing in them is written by hand, which is the point of the script printing Markdown rather than JSON.

```markdown
# PGlite throughput against the local-server topology

**Date:** 2026-07-20
**Status:** measured
**Decides:** spec §3's open risk — "PGlite is single-connection and fully serialises queries",
carried against §5's local-server recommendation, which makes that node the venue's ceiling.

## Method

`bench/pglite-throughput` drives 8 concurrent virtual tills against one database node for 20
seconds, discarding a 3-second warm-up. Each iteration is the spec §4 write-path transaction:
`SELECT ... FOR UPDATE` on the chain head, an insert into `bench_sales`, three into
`bench_sale_lines`, one into `bench_records`, then an `UPDATE` of the head row — five statements
and a SHA-256 inside one transaction.

Real PostgreSQL 18 via Testcontainers runs the identical statements as a control. PGlite uses its
own `transaction()`; hand-rolled `begin`/`commit` from concurrent callers merges into a single
transaction on PGlite's shared backend and would have measured nothing.

## The criterion, and where it comes from

The first deployment is a new deli in Barcelona (architecture §1) — greenfield, low initial
volume, a handful of tills. Its worst realistic minute is a lunch rush at 4 tills settling a sale
every 15 seconds: 16 sales/minute, **0.27 tx/s**. The second deployment, an existing restaurant
at 10 tills settling every 20 seconds, is **0.5 tx/s**.

| Metric | Bar | Why that number |
| --- | --- | --- |
| Sustained throughput | ≥ 20 tx/s | ~40x the modelled restaurant peak. The margin covers reprints, voids, Z-report reads and the outbox drainer, all of which serialise onto the same single backend. |
| p95 commit latency | ≤ 150 ms | The cashier waits for this: the receipt cannot print until commit. Below the threshold at which a person perceives a wait. |
| p99 commit latency | ≤ 400 ms | Keeps the worst sale of a rush from feeling like a queue. |
| Cold boot | ≤ 3 s | Sets Vitest's `testTimeout` in `packages/db` with an order of magnitude of headroom. |

The bar is deliberately *not* heroic throughput. Nothing in either deployment needs it, and
setting an unreachable bar would reopen a settled decision for no operational reason.

## Results

<!-- paste the two tables emitted by `pnpm --filter @waitron/bench-pglite bench` -->

## Consequences

The fresh-database figure is consumed by `packages/db`: it sets `testTimeout` and it decides
whether Stryker can gate every PR or must stay weekly.
```

> **On failure, exactly one decision reopens and it is not the schema.** A miss against this criterion reopens **the standalone database choice** (spec §3) — the live alternatives being a real PostgreSQL shipped as a single supervised process in the standalone bundle, or splitting writes across per-till PGlite nodes with the local server as reader. What it does **not** reopen is anything Tasks 4 onward build: the schema, RLS, the immutability triggers and the chain-append strategy are Postgres-dialect, and they are byte-identical against embedded PGlite and a real server. **Do not block the schema tasks on this result — the only thing gated on it is which Postgres runs in a standalone install.**

- [ ] **Step 7: Teeth check — break it and watch it scream**

Confirm the benchmark measures what it claims rather than merely completing.

Temporarily replace PGlite's `db.transaction(...)` in `runPglite` with hand-rolled statements:

```ts
const tx: RunInTx = async (fn) => {
  await db.query("begin", []);
  await fn((text, params) => db.query(text, params) as Promise<{ rows: never[] }>);
  await db.query("commit", []);
};
```

```bash
pnpm --filter @waitron/bench-pglite bench
```

Expected: FAIL — a `23505` unique violation on `bench_records (tenant_id, till_id, sequence)`, or a reported tx/s several times higher than the `transaction()` figure. Either outcome is the merged-transaction trap made visible: eight tills interleaving inside one transaction, with `FOR UPDATE` never blocking. Restore it.

Now temporarily change `PASS_CRITERION.minSustainedTps` to `1_000_000`:

Expected: FAIL — `FAIL against the criterion: sustained … < 1000000`, exit 1. This confirms the criterion is enforced by the script rather than by whoever reads the output. Restore it.

If either mutation leaves the run green and passing, the benchmark is decorative.

- [ ] **Step 8: Commit**

```bash
git add bench/pglite-throughput docs/research/2026-07-20-pglite-throughput.md pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore(bench): measure PGlite throughput before building on it

Spec §3 adopted PGlite for the standalone deployment with one risk left
open — single connection, fully serialised queries — against a §5
recommendation that concentrates a venue's writes on one node. This
measures that ceiling before any schema exists, so a bad number changes
the deployment decision while nothing is built on top of it.

The bar is derived from the deployments rather than invented: a new deli
at 4 tills peaks around 0.27 tx/s and the restaurant around 0.5, so 20
tx/s with p95 under 150ms is roughly 40x headroom for the writes plus the
reads, drainer and reprints that share the same single backend. Real
Postgres runs the identical statements as a control, because an absolute
number with nothing beside it cannot be interpreted.

PGlite's own transaction() is used rather than hand-rolled begin/commit:
concurrent callers on one shared backend merge into a single transaction,
which is the false pass spec §10 already records. The teeth check
reintroduces that bug deliberately and observes the unique constraint
catching it."
```

---

## Task 2: Scaffold `packages/db` and the dual-target test harness

Infrastructure task. Its deliverable is a package whose test, typecheck and lint commands all run, which can create both a PGlite and a real-Postgres database behind one type, whose migration runner keeps a separate journal per package, and whose boundary rule is observed firing.

**Files:**

- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/stryker.config.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/README.md`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/client.test.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/src/migrate.test.ts`
- Create: `packages/db/src/testing/harness.ts`
- Create: `packages/db/src/testing/harness.test.ts`
- Create: `packages/db/test/migrations-a/meta/_journal.json`
- Create: `packages/db/test/migrations-a/0000_probe_a.sql`
- Create: `packages/db/test/migrations-b/meta/_journal.json`
- Create: `packages/db/test/migrations-b/0000_probe_b.sql`
- Modify: `.prettierignore` (ignore generated `drizzle/` output)
- Modify: `eslint.config.js` (generic packages must not import a fiscal module)
- Modify: `.github/workflows/ci.yml` (`REQUIRE_DOCKER` on the existing `test` job)
- Modify: `.github/workflows/mutation.yml` (weekly `mutation-db` job)

**Interfaces:**

- Consumes: nothing from this repo.
- Produces:
  - `createPgliteDb(dataDir?: string): Promise<Database>`
  - `createPostgresDb(connectionString: string): Promise<Database>`
  - `type Database`, `type Transaction`, `type Schema`
  - `runMigrations(db: Database, options: { migrationsFolder: string; migrationsTable: string }): Promise<void>`
  - `describeEachTarget(name: string, fn: (target: Target) => void): void`
  - `resolveTargets(env: { dockerAvailable: boolean; requireDocker: boolean }): Target[]`

- [ ] **Step 1: Create the package manifest**

`packages/db/package.json`:

```json
{
  "name": "@waitron/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "mutation": "stryker run",
    "db:generate": "drizzle-kit generate",
    "db:generate:custom": "drizzle-kit generate --custom"
  },
  "dependencies": {
    "@electric-sql/pglite": "^0.5.4",
    "drizzle-orm": "^0.45.2",
    "pg": "^8.22.0"
  },
  "devDependencies": {
    "@stryker-mutator/core": "^9.6.1",
    "@stryker-mutator/vitest-runner": "^9.6.1",
    "@testcontainers/postgresql": "^12.0.4",
    "@types/node": "^24.0.0",
    "@types/pg": "^8.20.0",
    "@vitest/coverage-v8": "^3.0.0",
    "drizzle-kit": "^0.31.10",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`@electric-sql/pglite` and `pg` are **dependencies**, not devDependencies: PGlite is the standalone deployment's database and `pg` is the cloud deployment's driver, so both ship. `drizzle-kit` and `@testcontainers/postgresql` are development-only.

`drizzle-orm` is pinned to the `0.45.x` line by the caret. **Never** move to `1.0.0-rc.x` as part of another change: it alters the `NodePgDatabase` generics this package's shared `Database` type depends on, and it removes `journal.json`, which is the file the per-package migration journals in Step 6 are built around.

- [ ] **Step 2: Create the TypeScript, Vitest and Stryker configs**

`packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vitest/globals", "node"]
  },
  "include": ["src", "test"]
}
```

`packages/db/vitest.config.ts`:

```ts
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the
    // source. Without this exclude Vitest discovers them as real test files, so
    // one interrupted mutation run makes every later test run fail confusingly.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Vitest's 5s default is a live risk in this package and nowhere else in
    // the repo: every test here boots a WASM PostgreSQL. The figure comes from
    // docs/research/2026-07-20-pglite-throughput.md — cold boot plus schema
    // plus seed, with an order of magnitude of headroom, because a timeout
    // that fires under CI load produces a flaky suite that people learn to
    // rerun, and a suite people rerun is a suite that no longer gates.
    testTimeout: 30_000,
    // Separately and much larger: beforeAll starts a Testcontainers Postgres,
    // and on a cold runner that includes pulling the image. That is a network
    // download, not a boot, and it is the only thing in this package measured
    // in minutes.
    hookTimeout: 120_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/testing/** is harness code, not product code. Its Docker-absent
      // branch is unreachable by construction on a machine where Docker is
      // present, so holding it to a line floor would force a mock of the
      // environment probe — which measures the mock. Its logic is tested
      // directly instead, via the pure resolveTargets().
      exclude: [...coverageConfigDefaults.exclude, "src/testing/**", "drizzle/**"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
```

`packages/db/stryker.config.json`:

```json
{
  "$schema": "../../node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "pnpm",
  "plugins": ["@stryker-mutator/vitest-runner"],
  "testRunner": "vitest",
  "vitest": { "configFile": "vitest.config.ts" },
  "mutate": ["src/**/*.ts", "!src/**/*.test.ts", "!src/testing/**"],
  "incremental": true,
  "incrementalFile": "reports/stryker-incremental.json",
  "reporters": ["clear-text", "progress", "html"],
  "htmlReporter": { "fileName": "reports/mutation/index.html" },
  "coverageAnalysis": "perTest",
  "timeoutMS": 60000
}
```

Two deliberate differences from `packages/verifactu`. `timeoutMS` is raised from Stryker's 5000ms default because every test in this package boots PGlite before it asserts anything, and Stryker would otherwise score a slow boot as a killed mutant — a false positive that inflates the score while proving nothing. And there is **no `thresholds.break`**: this package follows `packages/ui`'s weekly, publish-a-score model, for the reason Step 11 sets out.

- [ ] **Step 3: Create the Drizzle config**

`packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/*.ts",
  // A single string. Drizzle's docs render this as `string | string[]`, which
  // is wrong — one config produces exactly one migration folder. That is why
  // each package needs its own drizzle.config.ts and its own journal table,
  // rather than one config emitting into several directories.
  out: "./drizzle",
  migrations: { table: "__drizzle_migrations_db", schema: "public" },
});
```

- [ ] **Step 4: Ignore the generated migrations in Prettier**

`pnpm format:check` is a required CI step and generated SQL will fail it. Append to `.prettierignore`:

```text
# Generated by drizzle-kit. Regenerating rewrites these files wholesale, so any
# Prettier-normalised version is lost on the next `generate` — and until then
# `format:check`, a required CI step, fails on output nobody hand-wrote.
packages/*/drizzle/
```

The glob is `packages/*/drizzle/` rather than `packages/db/drizzle/`: `packages/fiscal-verifactu` gets its own generated folder in a later task, and an entry that covers only the package that exists today is an entry that silently stops covering the one that does not.

- [ ] **Step 5: Write the failing tests for the client**

`packages/db/src/client.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPgliteDb } from "./client.js";
import { sql } from "drizzle-orm";

describe("createPgliteDb", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("returns a database that answers a query", async () => {
    const db = await createPgliteDb();
    const result = await db.execute(sql`select 1 as one`);
    expect(result.rows[0]).toEqual({ one: 1 });
    await db.close();
  });

  it("tags itself as the pglite driver", async () => {
    // runMigrations dispatches on this tag, because drizzle ships a separate
    // migrator per driver and the shared Database type deliberately erases
    // which one it is.
    const db = await createPgliteDb();
    expect(db.driver).toBe("pglite");
    await db.close();
  });

  it("persists to a data directory across close and reopen", async () => {
    // The standalone backup story in spec §3 is "copy one data directory", so
    // an in-memory-only client would not be the thing we ship.
    const dir = mkdtempSync(join(tmpdir(), "waitron-db-"));
    dirs.push(dir);
    const first = await createPgliteDb(dir);
    await first.execute(sql`create table persisted (id integer primary key)`);
    await first.execute(sql`insert into persisted (id) values (7)`);
    await first.close();

    const second = await createPgliteDb(dir);
    const result = await second.execute(sql`select id from persisted`);
    expect(result.rows).toEqual([{ id: 7 }]);
    await second.close();
  });

  it("rejects a query after close", async () => {
    const db = await createPgliteDb();
    await db.close();
    await expect(db.execute(sql`select 1`)).rejects.toThrow();
  });

  it("is in-memory when no data directory is given", async () => {
    // Two no-arg clients must not see each other's tables, or every test in
    // this package would share state with every other and the isolation the
    // harness promises would be fictional.
    const first = await createPgliteDb();
    await first.execute(sql`create table only_in_first (id integer primary key)`);
    const second = await createPgliteDb();
    await expect(second.execute(sql`select id from only_in_first`)).rejects.toThrow();
    await first.close();
    await second.close();
  });
});
```

- [ ] **Step 6: Run each test individually and watch it fail**

The Global Constraint requires per-test red observation, not per-file. Run them one at a time:

```bash
cd packages/db
pnpm vitest run -t "returns a database that answers a query"
```

Expected: FAIL — `Failed to resolve import "./client.js"`.

Repeat for every test name above, confirming each fails on its own. A test that passes here is a defect in the test, not a head start.

- [ ] **Step 7: Implement the client and the one shared `Database` type**

`packages/db/src/schema/index.ts`:

```ts
// The schema barrel. Empty today; later tasks add tenants, series, orders and
// sales files and re-export them here. It exists from this task rather than
// from the first schema task because `Database` is parameterised on it — so
// every table added later widens the type of every existing query for free,
// with no signature in any consumer to update.
export {};
```

`packages/db/src/client.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

export type Schema = typeof schema;

/** Which driver is underneath. The one thing `Database` may not erase. */
export type Driver = "pglite" | "postgres";

/**
 * The single database type both deployment modes speak.
 *
 * `PgDatabase` is the real supertype of drizzle's `PgliteDatabase` and
 * `NodePgDatabase` — one dialect, two drivers — which is exactly the property
 * spec §3 bought by dropping SQLite. It must be shared, and the alternative
 * (a `PgliteDatabase | NodePgDatabase` union) must be rejected, because every
 * consumer of this type takes a database or a transaction as a parameter:
 * `recordSale(tx, ...)`, `appendToChain(tx, ...)`, `allocateInvoiceNumber(tx,
 * ...)`. A union forces each of them to narrow, and the natural way to stop
 * narrowing is a cast — at which point the two targets can diverge, one test
 * suite runs against a type the other never exercises, and the divergence
 * surfaces in a deployment rather than in CI.
 *
 * `close` is added on top so teardown is uniform: PGlite closes, a pg Pool
 * ends, and no caller should have to know which.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>> & {
  readonly driver: Driver;
  close(): Promise<void>;
};

/** The handle every write-path function takes. Derived, never hand-written. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Embedded PostgreSQL for the standalone deployment. With no `dataDir` the
 * database is in-memory, which is what every test uses; with one it persists,
 * and that directory is the whole of the backup story in spec §3.
 */
export async function createPgliteDb(dataDir?: string): Promise<Database> {
  const client = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  return Object.assign(db, {
    driver: "pglite" as const,
    close: () => client.close(),
  }) as unknown as Database;
}

/** Pooled real PostgreSQL for the cloud deployment and the Testcontainers suite. */
export async function createPostgresDb(connectionString: string): Promise<Database> {
  const pool = new Pool({ connectionString });
  // Fail here rather than at the first query: a bad connection string that
  // surfaces inside a transaction looks like a schema fault, not a config one.
  const probe = await pool.connect();
  probe.release();
  const db = drizzlePg(pool, { schema });
  return Object.assign(db, {
    driver: "postgres" as const,
    close: () => pool.end(),
  }) as unknown as Database;
}
```

> **The two `as unknown as Database` casts must be checked against the shipped drizzle types before this task is considered done.** Try removing them and running `pnpm --filter @waitron/db typecheck`; if `PgliteDatabase` and `NodePgDatabase` are assignable to the `PgDatabase` supertype under `drizzle-orm@0.45.2`, delete both casts, because a cast that is not needed is a cast that will one day hide a real incompatibility. If a cast is genuinely required by the HKT parameter's variance, keep it here — at the two construction sites where the concrete driver is known — and **never** anywhere else. A cast inside a query or a write-path function is the dual-dialect failure spec §3 rejected SQLite to avoid, reintroduced one file at a time.

- [ ] **Step 8: Verify the client tests pass**

```bash
pnpm vitest run src/client.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 9: Write the failing tests for the migration runner**

The property under test is that two packages keep **separate journals**. `packages/db` and `packages/fiscal-verifactu` each generate their own migration folder, and if they shared one journal table the second package's migrations would be interleaved into the first package's history — after which neither folder can be replayed independently and a fresh install applies them in whatever order the shared table happens to record.

`packages/db/test/migrations-a/meta/_journal.json`:

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1753000000000, "tag": "0000_probe_a", "breakpoints": true }
  ]
}
```

`packages/db/test/migrations-a/0000_probe_a.sql`:

```sql
CREATE TABLE "probe_a" ("id" integer PRIMARY KEY NOT NULL);
```

`packages/db/test/migrations-b/meta/_journal.json`:

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1753000001000, "tag": "0000_probe_b", "breakpoints": true }
  ]
}
```

`packages/db/test/migrations-b/0000_probe_b.sql`:

```sql
CREATE TABLE "probe_b" ("id" integer PRIMARY KEY NOT NULL, "a_id" integer REFERENCES "probe_a"("id"));
```

Folder B references a table folder A creates, which is the cross-package foreign key the composition problem is really about.

`packages/db/src/migrate.test.ts`:

```ts
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPgliteDb, type Database } from "./client.js";
import { runMigrations } from "./migrate.js";

const FOLDER_A = join(import.meta.dirname, "..", "test", "migrations-a");
const FOLDER_B = join(import.meta.dirname, "..", "test", "migrations-b");
const TABLE_A = "__drizzle_migrations_a";
const TABLE_B = "__drizzle_migrations_b";

async function countIn(db: Database, table: string): Promise<number> {
  const result = await db.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`);
  return (result.rows[0] as { n: number }).n;
}

describe("runMigrations", () => {
  it("applies a migration folder", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    const result = await db.execute(sql`select count(*)::int as n from probe_a`);
    expect((result.rows[0] as { n: number }).n).toBe(0);
    await db.close();
  });

  it("records the applied migration in the journal table it was given", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    expect(await countIn(db, TABLE_A)).toBe(1);
    await db.close();
  });

  it("does not create drizzle's default journal table", async () => {
    // If the migrationsTable option were dropped, drizzle silently falls back
    // to __drizzle_migrations — and everything still passes, right up until a
    // second package migrates into the same history.
    const db = await createPgliteDb();
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    const result = await db.execute(
      sql`select to_regclass('public.__drizzle_migrations') as present`,
    );
    expect((result.rows[0] as { present: string | null }).present).toBeNull();
    await db.close();
  });

  it("is idempotent — a second run applies nothing", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    expect(await countIn(db, TABLE_A)).toBe(1);
    await db.close();
  });

  it("keeps two packages' journals independent", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    await runMigrations(db, { migrationsFolder: FOLDER_B, migrationsTable: TABLE_B });
    // One row each, not two in one table: each package can replay its own
    // history without the other's rows in it.
    expect(await countIn(db, TABLE_A)).toBe(1);
    expect(await countIn(db, TABLE_B)).toBe(1);
    await db.close();
  });

  it("emits a cross-package foreign key that actually holds", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    await runMigrations(db, { migrationsFolder: FOLDER_B, migrationsTable: TABLE_B });
    await expect(db.execute(sql`insert into probe_b (id, a_id) values (1, 99)`)).rejects.toThrow();
    await db.close();
  });

  it("fails loudly when a module folder is migrated before the core folder", async () => {
    // Migration ordering is the runtime's responsibility — nothing in drizzle
    // enforces that core runs before a module. This test pins the failure to a
    // clear error at migrate time rather than a missing table at first write.
    const db = await createPgliteDb();
    await expect(
      runMigrations(db, { migrationsFolder: FOLDER_B, migrationsTable: TABLE_B }),
    ).rejects.toThrow(/probe_a/);
    await db.close();
  });
});
```

- [ ] **Step 10: Run each test individually and watch it fail, then implement**

Expected: FAIL — unresolved import `./migrate.js`.

`packages/db/src/migrate.ts`:

```ts
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Database, Schema } from "./client.js";

export interface MigrationOptions {
  /** Absolute path to a drizzle-kit output folder containing meta/_journal.json. */
  migrationsFolder: string;
  /**
   * The journal table for THIS package. Per-package by design: `packages/db`
   * and `packages/fiscal-verifactu` each generate into their own folder, and a
   * shared journal would interleave their histories so that neither could be
   * replayed alone. Drizzle's default is `__drizzle_migrations`, which is
   * exactly the shared table to avoid — so this option has no default.
   */
  migrationsTable: string;
}

/**
 * Applies one package's migrations.
 *
 * Drizzle ships a separate migrator per driver and no dialect-level one, so
 * this dispatches on the driver tag the client attached. That tag is the sole
 * reason `Database` carries `driver` at all: it confines driver knowledge to
 * this one function instead of leaking a union type through every consumer.
 *
 * Ordering across packages is the caller's responsibility — nothing here
 * enforces that core migrations run before a module's.
 */
export async function runMigrations(db: Database, options: MigrationOptions): Promise<void> {
  const config = {
    migrationsFolder: options.migrationsFolder,
    migrationsTable: options.migrationsTable,
  };
  if (db.driver === "pglite") {
    await migratePglite(db as unknown as PgliteDatabase<Schema>, config);
    return;
  }
  await migratePg(db as unknown as NodePgDatabase<Schema>, config);
}
```

```bash
pnpm vitest run src/migrate.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 11: Write the dual-target harness, with a skip that cannot be quiet**

`packages/db/src/testing/harness.ts`:

```ts
import { execFileSync } from "node:child_process";
import { describe } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPgliteDb, createPostgresDb, type Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrate.js";

export interface Target {
  readonly name: "pglite" | "postgres";
  /** Starts whatever backs this target. Called once per suite. */
  setup(): Promise<void>;
  /**
   * A fresh, MIGRATED database. Called once per test, from the test's own
   * `beforeEach`.
   *
   * Fresh per test rather than shared per suite, and migrated here rather than
   * by each caller, because both alternatives have bitten this repo. A shared
   * handle makes a suite order-dependent: a test that inserts a row changes
   * what the next test sees, and the failure surfaces as "passes alone, fails
   * in the file". Leaving migrations to the caller means every suite repeats
   * the same two lines and a suite that forgets them tests an empty schema.
   *
   * This is the ONLY way a test in this package should obtain a database.
   * There is deliberately no `target.db` property and no `target.db()`
   * accessor — a test that builds its own PGlite instance runs one target
   * while appearing to run both.
   */
  create(): Promise<Database>;
  /** Stops whatever setup() started. */
  teardown(): Promise<void>;
}

export function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Migrations run as OWNER, here. The application role never runs them. */
async function migrated(db: Database): Promise<Database> {
  await runMigrations(db, CORE_MIGRATIONS);
  return db;
}

const pgliteTarget: Target = {
  name: "pglite",
  setup: async () => {},
  create: async () => migrated(await createPgliteDb()),
  teardown: async () => {},
};

function postgresTarget(): Target {
  let container: StartedPostgreSqlContainer | undefined;
  let created = 0;
  return {
    name: "postgres",
    setup: async () => {
      container = await new PostgreSqlContainer("postgres:18-alpine").start();
    },
    create: async () => {
      if (container === undefined) throw new Error("postgres target used before setup()");
      // A fresh DATABASE per test rather than a fresh container: container
      // start is measured in seconds, database creation in milliseconds, and
      // the isolation is identical.
      created += 1;
      const name = `waitron_test_${created}`;
      const admin = await createPostgresDb(container.getConnectionUri());
      await admin.execute({ sql: `create database ${name}`, params: [] } as never);
      await admin.close();
      return migrated(
        await createPostgresDb(
          container.getConnectionUri().replace(/\/[^/?]+(\?|$)/, `/${name}$1`),
        ),
      );
    },
    teardown: async () => {
      await container?.stop();
      container = undefined;
    },
  };
}

export interface TargetEnvironment {
  dockerAvailable: boolean;
  requireDocker: boolean;
}

/**
 * Which targets this run covers.
 *
 * Pure, and separate from describeEachTarget, precisely so the skip decision
 * is testable without controlling the machine's Docker daemon.
 *
 * A silent skip here is the most dangerous failure mode in the package. The
 * postgres target is the ONLY thing that can observe the two behaviours spec
 * §10 records PGlite being unable to reproduce — lock contention, where
 * `FOR UPDATE` parses and runs but never blocks on a single shared backend,
 * and RLS enforcement against a non-superuser role. If it disappears from the
 * run, the suite still reports green while the properties it exists to prove
 * are no longer being checked. That is worse than a red build: it is a green
 * build that means nothing, which is the exact shape of the seven vacuous
 * tests plan 1 shipped.
 *
 * So: loud on a developer machine, fatal in CI.
 */
export function resolveTargets(env: TargetEnvironment): Target[] {
  if (env.dockerAvailable) return [pgliteTarget, postgresTarget()];
  if (env.requireDocker) {
    throw new Error(
      "REQUIRE_DOCKER is set but Docker is not available. The real-Postgres target is the " +
        "only one that can observe lock contention and non-superuser RLS; skipping it here " +
        "would report a green run that proves neither.",
    );
  }
  console.warn(
    "\n" +
      "!".repeat(78) +
      "\n! DOCKER NOT AVAILABLE — the real-Postgres target is SKIPPED.\n" +
      "! Lock contention and non-superuser RLS are NOT covered by this run.\n" +
      "! PGlite serialises onto one backend, so FOR UPDATE never blocks there.\n" +
      "! This run cannot be used as evidence for either property.\n" +
      "!".repeat(78) +
      "\n",
  );
  return [pgliteTarget];
}

/**
 * The dual-target seam. A suite written once runs against PGlite and, when
 * Docker is present, against real PostgreSQL.
 */
export function describeEachTarget(name: string, fn: (target: Target) => void): void {
  const targets = resolveTargets({
    dockerAvailable: dockerAvailable(),
    requireDocker: process.env.REQUIRE_DOCKER === "1",
  });
  describe.each(targets)(`${name} [$name]`, (target) => {
    beforeAll(() => target.setup());
    afterAll(() => target.teardown());
    fn(target);
  });
}
```

`packages/db/src/testing/harness.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { resolveTargets } from "./harness.js";

describe("resolveTargets", () => {
  it("covers both targets when Docker is available", () => {
    const targets = resolveTargets({ dockerAvailable: true, requireDocker: false });
    expect(targets.map((t) => t.name)).toEqual(["pglite", "postgres"]);
  });

  it("throws rather than skipping when Docker is required", () => {
    // CI sets REQUIRE_DOCKER=1. A missing daemon there must fail the job, not
    // quietly halve the suite.
    expect(() => resolveTargets({ dockerAvailable: false, requireDocker: true })).toThrow(
      /REQUIRE_DOCKER/,
    );
  });

  it("skips postgres locally but warns unmissably", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const targets = resolveTargets({ dockerAvailable: false, requireDocker: false });
    expect(targets.map((t) => t.name)).toEqual(["pglite"]);
    expect(warn).toHaveBeenCalledOnce();
    // Asserting on the content, not just that something was logged: a warning
    // that does not say which properties went uncovered is a warning people
    // read past.
    expect(warn.mock.calls[0][0]).toMatch(/lock contention|FOR UPDATE/i);
    warn.mockRestore();
  });
});
```

- [ ] **Step 12: Run each test individually, watch it fail, then verify green**

Expected: FAIL — unresolved import `./harness.js`.

```bash
pnpm vitest run src/testing/harness.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 13: Add the boundary rule and observe it firing**

Spec §2 puts the generic layer above the regime module: "Only the interface crosses the boundary." Nothing enforces that yet — the existing zone in `eslint.config.js` stops `packages/verifactu` importing outward, not `packages/db` importing inward. Add a second zone. In `eslint.config.js`, after the existing `packages/verifactu` block:

```js
  {
    // The generic layer is regime-neutral (spec §2). A second fiscal backend —
    // TicketBAI, Italy, Portugal — brings its own tables and its own
    // vocabulary and touches none of these packages. The moment packages/db
    // imports the Veri*Factu module, "generic" becomes a comment rather than a
    // property, and the English-only guard would be policing the vocabulary of
    // a dependency it cannot see.
    files: ["packages/db/**/*.ts", "packages/core/**/*.ts", "packages/fiscal/**/*.ts"],
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver": { typescript: true },
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          // As above: resolved from this config's own directory, never a
          // leading `**/` — minimatch globstars refuse to cross a
          // dot-prefixed segment such as `.claude/worktrees/`.
          basePath: import.meta.dirname,
          zones: [
            {
              target: ["./packages/db/**/*", "./packages/core/**/*", "./packages/fiscal/**/*"],
              from: ["./packages/verifactu/**", "./packages/fiscal-verifactu/**"],
              message:
                "The generic layer must not depend on a fiscal module (spec §2). Only the " +
                "FiscalBackend interface crosses that boundary — if this needs something " +
                "from the Veri*Factu module, it belongs behind the interface.",
            },
          ],
        },
      ],
    },
  },
```

Now prove it fires. A rule nobody has watched fail is a rule nobody knows the shape of.

`packages/db/src/boundary-probe.ts`:

```ts
import { computeHuella } from "@waitron/verifactu";
export const probe = computeHuella;
```

```bash
pnpm lint
```

Expected: FAIL, with the message "The generic layer must not depend on a fiscal module (spec §2)".

```bash
rm packages/db/src/boundary-probe.ts
pnpm lint
```

Expected: PASS, no output.

- [ ] **Step 14: Decide mutation gating from the measurement, not from the handoff**

The plan-1 handoff records the rule as "pure-Node packages can afford the per-PR gate that `packages/verifactu` now has; browser packages cannot". `packages/db` is a pure-Node package, so the rule as written points at a per-PR gate. **It does not hold here, and the reason is in Task 1's numbers.**

The handoff's rule is a proxy for the real variable, which is not "browser or not" but per-test setup cost. `packages/verifactu` is 305 tests over pure functions with no setup at all, and a full Stryker run takes about 2m45s in CI. Every test in `packages/db` boots a WASM PostgreSQL and applies a schema first — the fresh-database figure from `docs/research/2026-07-20-pglite-throughput.md`. Multiply that figure by the number of test executions a Stryker run performs (mutants × covering tests, even with `coverageAnalysis: "perTest"` narrowing it) and the boot cost alone dominates the run. `packages/db`'s cost profile is `packages/ui`'s, arrived at by a different route: `packages/ui` pays a real Chromium per test, this package pays a real PostgreSQL.

So `packages/db` follows the `packages/ui` model — **weekly, publishes a score, no break threshold** — and `stryker.config.json` in Step 2 accordingly omits `thresholds`. Add to `.github/workflows/mutation.yml`, alongside the existing `mutation` job:

```yaml
  # packages/db. Weekly rather than per-PR for the same reason packages/ui is
  # weekly, reached by a different route: every test here boots a WASM
  # PostgreSQL and applies a schema before it asserts anything, so Stryker pays
  # that cost once per mutant per covering test. The handoff's "pure-Node
  # packages can afford the per-PR gate" rule was a proxy for per-test setup
  # cost, and this package has the setup cost without the browser.
  #
  # No thresholds.break is configured, so this publishes a score rather than
  # failing. Docker is present on ubuntu-latest, so the real-Postgres target
  # runs here too.
  mutation-db:
    runs-on: ubuntu-latest
    env:
      REQUIRE_DOCKER: "1"
    steps:
      - uses: actions/checkout@v5

      - uses: pnpm/action-setup@v6
        with:
          version: 9.15.0

      - uses: actions/setup-node@v5
        with:
          node-version-file: ".nvmrc"
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm --filter @waitron/db mutation

      - name: Upload mutation report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mutation-report-db
          path: packages/db/reports/mutation/
          retention-days: 30
```

> **Requires no ruleset change, and adding one would break every merge.** `mutation-db` lives in `mutation.yml`, which runs on a schedule and `workflow_dispatch` only — it never runs on a pull request. **Do not add `mutation-db` to the required status checks of ruleset `19157474`:** a required check that never reports on a PR leaves every pull request permanently pending. `mutation-verifactu` is required because it lives in `ci.yml` and runs on every PR; this one deliberately does not.

- [ ] **Step 15: Make the CI `test` job fail rather than skip**

`packages/db` joins the CI `test` and `typecheck` jobs and `.husky/pre-push` for free, because the root scripts are recursive — no new job and no new required check. One edit is still needed, and it is not a new job: the existing `test` job must set `REQUIRE_DOCKER` so a runner without a working daemon fails loudly instead of silently running half the suite. In `.github/workflows/ci.yml`, on the `test` job only:

```yaml
  test:
    runs-on: ubuntu-latest
    env:
      # packages/db's harness skips its real-Postgres target when Docker is
      # absent. That is right on a laptop and wrong here: the skipped target is
      # the only one that can observe lock contention and non-superuser RLS, so
      # a runner without Docker would report green having checked neither.
      REQUIRE_DOCKER: "1"
    steps:
```

The job **id** is untouched. Ruleset `19157474` requires `test` by name, and renaming it silently breaks the ruleset — adding an `env` block does not.

- [ ] **Step 16: Write the public surface and the README**

`packages/db/src/index.ts`:

```ts
// The public surface of @waitron/db. Re-exports only — no logic here.
export { createPgliteDb, createPostgresDb } from "./client.js";
export type { Database, Driver, Schema, Transaction } from "./client.js";
export { runMigrations } from "./migrate.js";
export type { MigrationOptions } from "./migrate.js";
```

`packages/db/README.md`:

```markdown
# @waitron/db

Postgres schema and client for both deployment modes: PGlite (embedded WASM PostgreSQL)
standalone, real PostgreSQL in the cloud. **One dialect.** There is no SQLite path — see
`docs/superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md` §3.

## Commands

| Command | Does |
| --- | --- |
| `pnpm test` | Vitest. Skips the real-Postgres target if Docker is absent, loudly. |
| `pnpm test:coverage` | The same, under V8 coverage thresholds. What CI runs. |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm mutation` | Stryker. Weekly in CI, not a merge gate. |
| `pnpm db:generate` | Regenerates `drizzle/` from `src/schema/*.ts`. |
| `pnpm db:generate:custom` | An empty numbered migration for hand-written SQL (triggers, RLS). |

## Three things that will waste your afternoon

**Every test boots a WASM PostgreSQL.** That is why `testTimeout` is 30s here and 5s everywhere
else. Do not lower it.

**PGlite runs as superuser, and superusers always bypass RLS** — with `ENABLE` and with `FORCE`.
Every RLS test must `set local role app_user` via `asAppUser()`. A suite that omits it passes
green while asserting nothing.

**PGlite cannot test lock contention.** Concurrent queries serialise onto one backend, so
`FOR UPDATE` parses and runs but never blocks. Anything about concurrent chain appends goes in
the real-Postgres suite, never PGlite. Run with Docker available, or set `REQUIRE_DOCKER=1` to
turn a missing daemon into a failure.

## Migrations

`drizzle.config.ts` has `out: "./drizzle"` — a **single string**, not an array, whatever the
docs render. One config, one folder, one journal table (`__drizzle_migrations_db`). Each package
that owns tables gets its own config and its own journal; `runMigrations` takes the table name
with no default for exactly that reason. Ordering across packages is the runtime's job.

Drizzle has no trigger support in `pg-core`. Triggers and `FORCE ROW LEVEL SECURITY` are
hand-written into a `--custom` migration; they survive later `generate` runs because drizzle-kit
diffs against its own snapshot, which has no concept of either.
```

- [ ] **Step 17: Teeth check — break it and watch it scream**

Confirm these tests have teeth rather than merely executing the code.

Temporarily drop `migrationsTable` from the config object in `runMigrations`, so drizzle falls back to its default journal:

```bash
pnpm vitest run src/migrate.test.ts
```

Expected: FAIL — "does not create drizzle's default journal table" and "keeps two packages' journals independent". Restore it.

Now temporarily make `resolveTargets` return `[pgliteTarget]` when `requireDocker` is true instead of throwing:

Expected: FAIL — "throws rather than skipping when Docker is required". Restore it.

Now temporarily change `createPgliteDb` to ignore `dataDir` and always construct `new PGlite()`:

```bash
pnpm vitest run src/client.test.ts
```

Expected: FAIL — "persists to a data directory across close and reopen". Restore it.

Now temporarily change `close` on the PGlite client to a no-op `async () => {}`:

Expected: FAIL — "rejects a query after close". Restore it.

If any of these four leaves the suite green, a test is missing rather than merely weak.

- [ ] **Step 18: Run everything, then commit**

```bash
pnpm --filter @waitron/db typecheck
pnpm --filter @waitron/db test:coverage
pnpm lint
pnpm format:check
```

Expected: typecheck silent; 15 tests passing; lint and format clean.

```bash
git add packages/db .prettierignore eslint.config.js .github/workflows/ci.yml .github/workflows/mutation.yml pnpm-lock.yaml
git commit -m "feat(db): scaffold the package and the dual-target test harness

One Database type covers both drivers because PgDatabase is the genuine
supertype of the PGlite and node-postgres databases — one dialect, two
drivers, which is the property dropping SQLite bought. A union type was
rejected: every write-path function takes a database or a transaction as a
parameter, a union forces each of them to narrow, and the natural way to
stop narrowing is a cast, at which point the two targets can diverge
without CI noticing.

runMigrations takes migrationsTable with no default. Drizzle's default is
one shared __drizzle_migrations, which would interleave this package's
history with the fiscal module's so that neither could be replayed alone.
The suite asserts the default table is never created, because dropping the
option leaves everything else passing.

The real-Postgres target is skipped when Docker is absent but never
quietly: a banner naming the uncovered properties locally, and a hard
failure under REQUIRE_DOCKER in CI. It is the only target that can observe
lock contention or non-superuser RLS, so a silent skip would produce a
green run that proves neither.

Mutation testing is weekly rather than a per-PR gate. The handoff's
pure-Node rule is a proxy for per-test setup cost, and every test here
boots a WASM PostgreSQL — the same cost profile as packages/ui, reached
without a browser."
```

---

## Task 3: The English-only guard

Spec §2 requires that Spanish vocabulary stops at the module boundary and that the rule be enforced "mechanically ... in the same spirit as `no-hardcoded-chrome`". This is that guard. It is what stops a Spanish column name reaching a migration, which is the version of this mistake nobody can undo.

**Files:**

- Create: `packages/db/src/english-only.test.ts`
- Create: `packages/db/src/english-only.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `findSpanish(source: string): Violation[]`
  - `sourceFilesIn(packageName: string): string[]`
  - `GENERIC_PACKAGES`, `EXEMPT_PACKAGES`, `SPANISH_WORDS`

- [ ] **Step 1: Understand why this is a test and not a lint rule**

ESLint runs untyped here (`tseslint.configs.recommended`, no `parserOptions.project`), but that is not the reason. The reason is that **ESLint AST selectors cannot see inside string literals** — they are `Literal` nodes with an opaque `value`, and no selector policy can reach into one.

For `packages/db` that is not an edge case, it is the load-bearing case. A Drizzle table is declared as `pgTable("registros_facturacion", { ... })`. The Spanish is in a string. A lint rule policing identifiers would pass that file cleanly while the generic package grows a Spanish table — and a Spanish **column name** is both far more damaging and far more permanent than a Spanish local variable, because it reaches a generated migration, then a deployed database, and from there it can only be changed by another migration on a table the design has spent two tasks making immutable.

So the guard reads source **text**. That also lets it police accented forms, template literals and raw SQL in a `--custom` migration, none of which an AST rule reaches.

- [ ] **Step 2: Decide auto-discovery, and where it deviates from the precedent**

`packages/ui/src/no-hardcoded-chrome.test.ts` is the precedent, and the principle carries over verbatim: **discovery, not a registry** — "a registry silently stops covering a new primitive unless someone remembers to add it".

Two of its details do not carry over, and both changes are deliberate:

`import.meta.glob` is replaced by `fs.readdirSync(dir, { recursive: true })`. `import.meta.glob` is a Vite build-time transform scoped to the importing project's root, and this guard must read files in **four sibling packages**, three of which (`core`, `fiscal`, `shared`) do not exist when it is written. A directory-walk has no root to escape and returns nothing for a package that is not there yet.

The negative glob is replaced by a self-exclusion, for the same underlying reason it existed. In the precedent, eagerly importing a `*.test.ts` executed its top-level `test()` calls into the guard's own run — once inflating that file from 12 tests to 60. Reading text executes nothing, so test files can and should stay **in** scope: a Spanish fixture name in `packages/db` is exactly as wrong as a Spanish column. But this guard's own two files contain the entire Spanish wordlist in plain text, so scanning itself would fail on its own vocabulary. They are excluded by name, and the third test in Step 3 asserts that the exclusion is exactly two files rather than a wildcard that quietly swallows more.

Discovery must also be **proved non-empty**. A glob that matches nothing passes every assertion, which is the vacuous-test shape this project keeps rediscovering.

- [ ] **Step 3: Write the failing tests**

`packages/db/src/english-only.test.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXEMPT_PACKAGES,
  GENERIC_PACKAGES,
  PACKAGES_ROOT,
  SELF,
  findSpanish,
  readSource,
  sourceFilesIn,
} from "./english-only.js";

const discovered = GENERIC_PACKAGES.flatMap((name) =>
  sourceFilesIn(name).map((file) => [`${name}: ${file.replace(PACKAGES_ROOT, "")}`, file] as const),
);

describe("configuration", () => {
  it("scopes itself to the four generic packages", () => {
    expect([...GENERIC_PACKAGES]).toEqual(["db", "core", "fiscal", "shared"]);
  });

  it("exempts the two Spanish packages", () => {
    // Spec §2: these mirror AEAT 1:1 and translating there would only obscure.
    expect([...EXEMPT_PACKAGES]).toEqual(["verifactu", "fiscal-verifactu"]);
    for (const name of EXEMPT_PACKAGES) {
      expect(GENERIC_PACKAGES).not.toContain(name);
    }
  });

  it("excludes only its own two files, by exact name", () => {
    // A wildcard here (say, *.test.ts) would silently drop every test file in
    // packages/db out of scope, which is where fixture names live.
    expect([...SELF]).toEqual(["english-only.ts", "english-only.test.ts"]);
  });

  it("discovers source files in every generic package that exists on disk", () => {
    // A guard whose file list is empty passes every assertion below it. This
    // is the assertion that stops that.
    for (const name of GENERIC_PACKAGES) {
      const dir = join(PACKAGES_ROOT, name, "src");
      if (!existsSync(dir)) continue;
      expect(sourceFilesIn(name).length).toBeGreaterThan(0);
    }
    expect(discovered.length).toBeGreaterThan(0);
  });
});

describe("findSpanish", () => {
  it("flags a Spanish identifier", () => {
    const found = findSpanish("const ultimaHuella = head.lastHash;");
    expect(found.map((v) => v.word)).toEqual(["huella"]);
  });

  it("flags a Spanish table name inside a string literal", () => {
    // The load-bearing case. No ESLint selector can see into this string, and
    // this is the mistake that reaches a migration and then a database.
    const found = findSpanish('export const records = pgTable("registros_facturacion", {});');
    expect(found.map((v) => v.word)).toEqual(["registros", "facturacion"]);
  });

  it("flags a Spanish column name inside an object key", () => {
    const found = findSpanish('  numeroInstalacion: text("numero_instalacion"),');
    expect(found.map((v) => v.word)).toEqual(["numero", "instalacion", "numero", "instalacion"]);
  });

  it("flags accented forms as well as unaccented", () => {
    // Both spellings occur in the sources — the XSDs are accented, the column
    // names in the naming contract are not.
    expect(findSpanish("const anulación = 1;").map((v) => v.word)).toEqual(["anulacion"]);
    expect(findSpanish("const anulacion = 1;").map((v) => v.word)).toEqual(["anulacion"]);
    expect(findSpanish("const envío = 1;").map((v) => v.word)).toEqual(["envio"]);
  });

  it("reports the line number", () => {
    const found = findSpanish("const ok = 1;\nconst cadena = 2;\n");
    expect(found).toEqual([{ line: 2, word: "cadena", text: "const cadena = 2;" }]);
  });

  it("does not flag English words that contain a Spanish word", () => {
    // The whole difference between a guard people keep and a guard people
    // disable. `series` contains `serie`; `imported` contains `importe`;
    // `delta` contains `alta`; `number` is not `numero` but `renumbered`
    // would trip a substring match.
    expect(
      findSpanish(
        "import { invoiceSeries } from './series.js';\n" +
          "const importedRows = delta.filter((r) => r.renumbered);\n" +
          "const total = sale.amountCharged;\n",
      ),
    ).toEqual([]);
  });

  it("does not flag words shared by both languages", () => {
    // total, base, local, error, real: identical in Spanish and English, and
    // all five appear in the naming contract. Flagging them would make the
    // guard fire on `sales.total` on its first day.
    expect(findSpanish("const { total, base, locale, error } = row;")).toEqual([]);
  });

  it("does not flag NIF", () => {
    // tenants.nif is in the naming contract. It is a legal identifier and an
    // acronym, not vocabulary — "tax id" would be a less precise column name,
    // not a more English one.
    expect(findSpanish('nif: text("nif").notNull(),')).toEqual([]);
  });

  it("ignores Spanish inside line and block comments", () => {
    // Comments explaining the regime are legitimate and wanted — the whole
    // reason this layer exists is that a reader needs to know what the module
    // on the other side of the interface is doing. The constraint in spec §2
    // is on identifiers and table/column names.
    expect(findSpanish("// mirrors AEAT's registro de alta and its huella")).toEqual([]);
    expect(findSpanish("/*\n * The cadena head. Spanish stays in the module.\n */")).toEqual([]);
  });

  it("still flags code on a line that also carries a comment", () => {
    // Stripping a comment must not take the code with it.
    const found = findSpanish("const cadena = 1; // the chain head");
    expect(found.map((v) => v.word)).toEqual(["cadena"]);
  });

  it("permits the operation_description column named in the naming contract", () => {
    // Passes on its own merits rather than through an exception list: the
    // column was renamed out of Spanish, so it tokenises to `operation` and
    // `description` and there is nothing for the guard to forgive.
    expect(findSpanish('operationDescription: text("operation_description"),')).toEqual([]);
    // And the Spanish form it replaced is still caught, which is what stops
    // the rename from being quietly reverted.
    expect(findSpanish('descriptionOperacion: text("description_operacion"),').map((v) => v.word))
      .toEqual(["operacion", "operacion"]);
    expect(findSpanish('tipoOperacion: text("tipo_operacion"),').map((v) => v.word)).toEqual([
      "tipo",
      "operacion",
      "tipo",
      "operacion",
    ]);
  });
});

describe("the wordlist is not decorative", () => {
  it("flags real Spanish code in packages/verifactu", () => {
    // Proves two things at once: the wordlist matches vocabulary that actually
    // occurs in this repo rather than a plausible-looking list, and the scope
    // is what exempts the Spanish packages — not a wordlist too weak to fire
    // on them. A guard that would pass on packages/verifactu is a guard that
    // would pass on a Spanish packages/db too.
    const files = sourceFilesIn("verifactu");
    expect(files.length).toBeGreaterThan(0);
    const words = new Set(files.flatMap((file) => findSpanish(readSource(file))).map((v) => v.word));
    expect(words.has("huella")).toBe(true);
    expect(words.has("registro")).toBe(true);
  });
});

describe.each(discovered)("%s", (_label, file) => {
  it("uses English vocabulary only", () => {
    const violations = findSpanish(readSource(file));
    // Reported as formatted lines rather than a bare count: a failure needs to
    // say which word on which line, or the next person deletes the test.
    expect(violations.map((v) => `${v.line}: ${v.word} — ${v.text}`)).toEqual([]);
  });
});
```

- [ ] **Step 4: Run each test individually and watch it fail**

Expected: FAIL — unresolved import `./english-only.js`.

Run every test name above one at a time. Two are worth watching especially closely, because they are the ones that pass for the wrong reason if the implementation is weak: "does not flag English words that contain a Spanish word" passes trivially against an implementation that flags nothing at all, and "discovers source files in every generic package that exists on disk" passes trivially against one that returns a hardcoded list. Confirm both fail on the missing import first.

- [ ] **Step 5: Implement**

`packages/db/src/english-only.ts`:

```ts
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** `<repo>/packages`. Derived, so the guard survives being run from anywhere. */
export const PACKAGES_ROOT = join(import.meta.dirname, "..", "..");

/** English throughout — identifiers and table/column names alike (spec §2). */
export const GENERIC_PACKAGES = ["db", "core", "fiscal", "shared"] as const;

/** Spanish by design: these mirror AEAT's spec, XML and conformance vectors. */
export const EXEMPT_PACKAGES = ["verifactu", "fiscal-verifactu"] as const;

/**
 * This guard's own two files, excluded by exact name.
 *
 * They contain the entire wordlist in plain text, so scanning them would fail
 * on the vocabulary they exist to define. Excluded by name rather than by a
 * `*.test.ts` pattern: reading text executes nothing, so test files stay in
 * scope, and a Spanish fixture name in packages/db is exactly as wrong as a
 * Spanish column.
 */
export const SELF = ["english-only.ts", "english-only.test.ts"] as const;

/**
 * There is deliberately no exception list.
 *
 * An earlier draft of the naming contract called the `locations` column
 * `description_operacion`, which contains a listed word and would have forced
 * one — and an exception list with a single entry is the shape that grows. The
 * column was renamed to `operation_description` instead, which tokenises to
 * `operation` and `description`, neither of them Spanish, so the guard needs no
 * help to accept it. If a future column appears to need an exception, rename
 * the column: that is the cheaper of the two edits and it keeps the guard's
 * answer unambiguous.
 */

/**
 * Spanish vocabulary drawn from the spec, the findings and the naming
 * contract's module tables. Singular and plural are listed separately and
 * nothing is stemmed — stemming `series` to `serie` would fire on
 * `invoice_series`, which is in the naming contract.
 *
 * Words identical in both languages are deliberately absent: total, base,
 * local/locale, error, real, id. All appear in the naming contract, and a
 * guard that fires on `sales.total` on day one is a guard that gets deleted on
 * day two. `nif` is absent for the same reason — an acronym for a legal
 * identifier, not vocabulary.
 */
export const SPANISH_WORDS = new Set([
  // chain and record vocabulary — the naming contract's module tables
  "registro", "registros", "huella", "huellas", "cadena", "cadenas",
  "encadenamiento", "secuencia", "secuencias", "primer", "primero",
  // invoice vocabulary
  "factura", "facturas", "facturacion", "alta", "altas", "anulacion",
  "anulaciones", "rectificativa", "rectificativas", "desglose", "desgloses",
  "serie", "numero", "numeros", "importe", "importes", "cuota", "cuotas",
  "impuesto", "impuestos", "iva",
  // parties and identity
  "obligado", "obligados", "emisor", "emisores", "destinatario",
  "destinatarios", "tercero", "terceros", "cliente", "clientes", "usuario",
  "usuarios", "empresa", "empresas", "nombre", "nombres", "razon",
  "tributario", "instalacion", "informatico", "informatica", "sistema",
  // submission vocabulary
  "envio", "envios", "incidencia", "incidencias", "suministro", "consulta",
  "respuesta", "cabecera", "detalle", "detalles", "presentacion",
  "expedicion", "periodo", "ejercicio", "operacion", "operaciones",
  // time
  "fecha", "fechas", "hora", "huso",
  // POS vocabulary a generic package might reach for
  "venta", "ventas", "pedido", "pedidos", "linea", "lineas", "cantidad",
  "precio", "precios", "pago", "pagos", "cobro", "cobros", "mesa", "mesas",
  "caja", "cajas", "estado", "estados", "tipo", "tipos", "descripcion",
  "descripciones",
]);

export interface Violation {
  line: number;
  word: string;
  text: string;
}

export function readSource(file: string): string {
  return readFileSync(file, "utf8");
}

/** Replaces block comments with equivalent whitespace, preserving line numbers. */
function blankBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

/**
 * Drops a `//` comment. The `[^:]` guard keeps `https://…` in a string
 * literal from being mistaken for one — a URL is the one place a `//` appears
 * in code rather than before a comment.
 */
function dropLineComment(line: string): string {
  return line.replace(/(^|[^:])\/\/.*$/, "$1");
}

/**
 * Splits a line into lowercase, unaccented word tokens.
 *
 * Whole tokens, never substrings: `series` must not match `serie`, `imported`
 * must not match `importe`, `delta` must not match `alta`. Accents are removed
 * via NFD so `anulación` and `anulacion` are the same token — and `ñ`
 * decomposes to `n`, so `año` reads as `ano`.
 *
 * camelCase and PascalCase are split, including the acronym boundary in
 * `IDFactura`, so `ultimaHuella` and `ultima_huella` tokenise identically.
 */
function tokenise(line: string): string[] {
  return line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/** Every Spanish token in `source`, in order, with its line. */
export function findSpanish(source: string): Violation[] {
  const violations: Violation[] = [];
  const lines = blankBlockComments(source).split("\n");
  lines.forEach((line, index) => {
    for (const token of tokenise(dropLineComment(line))) {
      if (SPANISH_WORDS.has(token)) {
        violations.push({ line: index + 1, word: token, text: line.trim() });
      }
    }
  });
  return violations;
}

/**
 * Every `.ts` file under a package's `src`, discovered rather than listed.
 *
 * Returns `[]` for a package that does not exist yet — `core`, `fiscal` and
 * `shared` arrive in later tasks, and this guard must be in place before them
 * rather than retrofitted after the first Spanish name has already landed.
 */
export function sourceFilesIn(packageName: string): string[] {
  const root = join(PACKAGES_ROOT, packageName, "src");
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts"))
    .filter((entry) => !SELF.some((name) => entry.endsWith(name)))
    .map((entry) => join(root, entry))
    .sort();
}
```

> An earlier draft of the naming contract gave this column as `locations.description_operacion` — Spanish inside an English package, which the Global Constraint forbids for generic packages in "identifiers *and* table/column names". The word came from AEAT's `DescripcionOperacion`, but the column is generic-layer, so **the column was renamed to `operation_description` and the naming contract now carries that name**. The guard therefore needs no exception list, and must not grow one: the moment an exception is a word rather than an identifier, the guard stops distinguishing a contract decision from a slip. If some future generic column looks like it needs forgiving, rename the column instead.

- [ ] **Step 6: Verify green**

```bash
cd packages/db
pnpm vitest run src/english-only.test.ts
```

Expected: PASS. Test count is `16 + n`, where `n` is the number of discovered source files — currently `packages/db`'s five (`index.ts`, `client.ts`, `migrate.ts`, `schema/index.ts`, `testing/harness.ts`) plus the two `*.test.ts` files, since test files stay in scope.

- [ ] **Step 7: Prove the guard does not fire on the exempt packages**

```bash
pnpm vitest run src/english-only.test.ts -t "flags real Spanish code in packages/verifactu"
```

Expected: PASS. That test scans `packages/verifactu` directly and asserts the wordlist **does** fire on it, while the `describe.each` block never lists it. The two together are the proof: the exemption is a scope decision, not a wordlist too weak to notice.

Confirm the negative directly as well:

```bash
pnpm vitest run src/english-only.test.ts 2>&1 | grep -c "verifactu:"
```

Expected: `0`. No per-file test is generated for an exempt package.

- [ ] **Step 8: Teeth check — break it and watch it scream**

Confirm these tests have teeth rather than merely executing the code. Both probes go into `packages/db/src/client.ts`, a real file the guard discovers, because a probe in a fixture proves only that the fixture is scanned.

Temporarily add a Spanish **identifier** to `packages/db/src/client.ts`:

```ts
export const ultimaHuella = "";
```

```bash
pnpm vitest run src/english-only.test.ts
```

Expected: FAIL — the generated test `db: /db/src/client.ts › uses English vocabulary only`, reporting `huella`. Remove it.

Now temporarily add a Spanish **table-name string literal** instead — the case a lint rule cannot reach:

```ts
export const tableName = "registros_facturacion";
```

Expected: FAIL — the same generated test, reporting `registros` and `facturacion`. Remove it.

Now temporarily replace `SPANISH_WORDS.has(token)` with `[...SPANISH_WORDS].some((w) => token.includes(w))`:

Expected: FAIL — "does not flag English words that contain a Spanish word", on `series`, `imported` and `delta`. This is the substring bug the whole-token design exists to prevent, and it is the version of this guard that gets disabled within a week. Restore it.

Now temporarily make `sourceFilesIn` return `[]` unconditionally:

Expected: FAIL — "discovers source files in every generic package that exists on disk". Without that test this mutation leaves every per-file assertion green, because there are no files to assert against. Restore it.

If any of these four leaves the suite green, the guard is decorative.

- [ ] **Step 9: Run everything, then commit**

```bash
pnpm --filter @waitron/db typecheck
pnpm --filter @waitron/db test
pnpm lint
pnpm format:check
```

Expected: typecheck silent; all tests passing; lint and format clean.

```bash
git add packages/db/src/english-only.ts packages/db/src/english-only.test.ts
git commit -m "test(db): mechanically enforce English in the generic packages

Spec §2 requires Spanish to stop at the module boundary and requires the
rule be enforced mechanically rather than by review. This is a text-level
test rather than a lint rule because ESLint AST selectors cannot see inside
string literals, and for this package the string literal is the case that
matters: a table is declared as pgTable(\"registros_facturacion\", ...), so
a rule policing identifiers passes that file while the generic layer grows a
Spanish table. A Spanish column name reaches a generated migration and then
a deployed database, and from there only another migration can change it.

Matching is on whole tokens after accent stripping and camelCase splitting,
never substrings. `series` contains `serie` and `invoice_series` is in the
naming contract; `imported` contains `importe`; `delta` contains `alta`. A
substring match would fire on all three, and a guard that fires on correct
code is one that gets disabled. Words identical in both languages — total,
base, locale, error — are absent from the list for the same reason, as is
nif, which is an acronym rather than vocabulary.

Discovery walks each generic package's src rather than reading a registry,
following packages/ui's no-hardcoded-chrome, and asserts the walk is
non-empty: a guard whose file list is empty passes every assertion under it.
The exemption for the two Spanish packages is proved to be a scope decision
by scanning packages/verifactu directly and asserting the wordlist does fire
on it."
```

---
## Task 4: Tenancy schema, RLS, and the `withTenant` seam

The first task where the database, rather than a `where` clause someone remembered to write, is what keeps one restaurant's sales out of another's. Its deliverable is `tenants`, `locations` and `tills` carrying RLS policies, plus proof that a cross-tenant read is impossible when running as the application role.

**Files:**

- Create: `packages/db/src/schema/tenants.ts`
- Create: `packages/db/src/tenancy.ts`
- Create: `packages/db/src/tenancy.test.ts`
- Create: `packages/db/src/testing/roles.ts`
- Create: `packages/db/drizzle/0001_tenancy.sql` (generated — the prefix is whatever `drizzle-kit` assigns next)
- Create: `packages/db/drizzle/0002_tenancy_rls.sql` (custom — handwritten)
- Modify: `packages/db/src/client.ts` (append the `Transaction` type)
- Modify: `packages/db/src/index.ts` (re-export the schema, `withTenant`)

**Interfaces:**

- Consumes:
  - `Database`, `createPgliteDb`, `createPostgresDb` from `./client.js` (Task 2).
  - `describeEachTarget(name: string, suite: (target: Target) => void): void` from `./testing/harness.js` (Task 2) — the `describe.each` dual-target seam. The suite callback receives the `Target`; a test obtains a **fresh, migrated** database by calling `await target.create()` in its own `beforeEach`. There is no `target.db` property to read at describe time.
- Produces:
  - `tenants`, `locations`, `tills` — Drizzle table objects.
  - `Transaction` — the transaction handle Drizzle passes to a `transaction()` callback.
  - `withTenant<T>(db: Database, tenantId: string, fn: (tx: Transaction) => Promise<T>): Promise<T>`
  - `asAppUser(tx: Transaction): Promise<void>`
  - `current_tenant_id()` — a SQL function, in the database rather than in TypeScript.

### The one constraint this task exists to satisfy

> **The RLS behaviour must be checked against Postgres's own documentation before this task is considered done.** Confirm that superusers bypass RLS regardless of `FORCE ROW LEVEL SECURITY`. PGlite runs as superuser, so a suite that omits the role change passes green while asserting nothing, which is worse than no suite at all.

Measured on PostgreSQL 18.4 with two tenants seeded, `FORCE ROW LEVEL SECURITY` set, and `app.tenant_id` pointing at tenant A:

| Connection | Rows visible |
| --- | --- |
| superuser | 2 |
| `set local role app_user` | 1 |

Every read in this suite therefore goes through `asAppUser(tx)`. **Never** write an RLS test that does not.

- [ ] **Step 1: Write the schema**

`packages/db/src/schema/tenants.ts`:

```ts
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * The obligado tributario. One row per NIF — the NIF is the identity AEAT
 * knows, so it is unique globally rather than per anything.
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nif: text("nif").notNull(),
    legalName: text("legal_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenants_nif_key").on(t.nif)],
).enableRLS();

/**
 * A venue. `invoiceLocales` is an ORDERED list of one or two locales: one means
 * monolingual, two means both languages on the same invoice in that order
 * (spec §9 — a Barcelona venue may want Spanish, Catalan, or both).
 *
 * The order is fiscal, not presentational. Spec §9 requires a reprint or a
 * rectificativa issued a year later to reproduce the document the customer
 * took, which is why `sales.invoice_locales` snapshots this list at issuance.
 * Which language leads is part of what the document said; a rectificativa
 * references an original that must be reproducible. Reordering a venue's
 * configuration must therefore never change how an already-issued receipt
 * reprints — hence a snapshot of an ordered value, not a lookup of a set.
 *
 * Rejected alternatives: a `jsonb` object cannot carry order at all, because
 * Postgres normalises and sorts `jsonb` keys on storage; a
 * `primary_locale`/`secondary_locale` pair encodes order but cannot grow past
 * two, and the cap belongs in a constraint that can be relaxed, not in the
 * column layout.
 */
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    invoiceLocales: text("invoice_locales").array().notNull(),
    operationDescription: text("operation_description").notNull(),
  },
  (t) => [
    // cardinality(), NOT array_length(). array_length('{}', 1) is NULL, a CHECK
    // whose expression is NULL is satisfied, and an empty locale list would
    // therefore be accepted — verified on PostgreSQL 18.4. cardinality('{}')
    // is 0 and the constraint bites.
    check("locations_invoice_locales_len", sql`cardinality(${t.invoiceLocales}) between 1 and 2`),
    index("locations_tenant_id_idx").on(t.tenantId),
  ],
).enableRLS();

/**
 * A point of sale. Deliberately REGIME-NEUTRAL: `NúmeroInstalación` and
 * `IdSistemaInformatico` do NOT live here.
 *
 * They are Veri*Factu concepts — a Spanish SIF identity, minted per (NIF,
 * IdSIF) and never reusable (spec §3) — and `packages/db` is English and
 * regime-neutral by Global Constraint. Putting them here would mean every
 * future regime either widens this table or leaves columns null, and it would
 * put Spanish column names in a package the Task 3 guard forbids them in. They
 * live in the module-owned `registro_sif` table, keyed by till, built in
 * Task 13. A till has exactly one SIF identity per regime, so the join is 1:1
 * and costs nothing.
 */
export const tills = pgTable(
  "tills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("tills_tenant_id_idx").on(t.tenantId)],
).enableRLS();
```

`.enableRLS()`, not `pgTable.withRLS(...)`. **Drizzle's RLS documentation page is wrong** — it shows a `withRLS` builder that the shipped types do not have. Trust the types.

> This column was `description_operacion` in an earlier draft of the naming contract — half-Spanish, where the Global Constraint requires `packages/db` to be English in column names as well as identifiers, so Task 3's guard would have flagged it on its very first use. Adding it to a guard exception list would have blunted the only mechanical enforcement of that constraint, for one column, on day one. It is therefore `operation_description` here, in the naming contract, and in Task 3's guard, which consequently carries no exception list at all.

- [ ] **Step 2: Generate the table migration**

```bash
cd packages/db
pnpm drizzle-kit generate --name tenancy
```

Expected: a new `drizzle/0001_tenancy.sql` plus an updated `drizzle/meta/_journal.json`.

The generated SQL should read as below. Check it rather than trusting it — in particular that `ENABLE ROW LEVEL SECURITY` appears once per table, which is the only evidence that `.enableRLS()` was picked up.

`packages/db/drizzle/0001_tenancy.sql`:

```sql
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nif" text NOT NULL,
	"legal_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"invoice_locales" text[] NOT NULL,
	"operation_description" text NOT NULL,
	CONSTRAINT "locations_invoice_locales_len" CHECK (cardinality("locations"."invoice_locales") between 1 and 2)
);
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tills" ADD CONSTRAINT "tills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tills" ADD CONSTRAINT "tills_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_nif_key" ON "tenants" USING btree ("nif");--> statement-breakpoint
CREATE INDEX "locations_tenant_id_idx" ON "locations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tills_tenant_id_idx" ON "tills" USING btree ("tenant_id");
```

A table-qualified column reference inside a `CHECK` — `"locations"."invoice_locales"` — is accepted by Postgres; verified on 18.4. Drizzle's `${t.column}` interpolation emits that form, and there is no need to hand-write the bare name.

Then confirm the generated SQL does not break the formatting gate:

```bash
cd ../.. && ./node_modules/.bin/prettier --check packages/db/drizzle
```

Expected: `All matched files use Prettier code style!`, **or** no files matched because Task 2 already added `drizzle/` to `.prettierignore`. If instead Prettier reports style violations, that entry is missing — add `drizzle/` to `.prettierignore` rather than reformatting generated SQL, because the next `generate` run would undo the reformatting and `pnpm format:check` is a required CI step.

- [ ] **Step 3: Hand-write the security migration**

```bash
cd packages/db
pnpm drizzle-kit generate --custom --name tenancy_rls
```

That emits an **empty** numbered migration. Everything below is unsupported by Drizzle: `FORCE ROW LEVEL SECURITY` has no builder at all, and role and grant management is opt-in behind `entities.roles` in `drizzle.config.ts` — which, once enabled, makes drizzle-kit believe it owns every role in the cluster and generate `DROP ROLE` for ones it did not create. Keeping the whole security posture in one handwritten file is both safer and more readable than scattering half of it into the schema.

Handwritten SQL survives later `generate` runs. drizzle-kit diffs the schema against **its own snapshot** in `drizzle/meta/`, and that snapshot has no concept of roles, grants, policies or `FORCE` — so it never sees them drift and never tries to reconcile them.

`packages/db/drizzle/0002_tenancy_rls.sql`:

```sql
-- The application role. NOLOGIN: it is a privilege bucket, not a login. The
-- cloud deployment's login role is GRANTed membership of it; tests reach it
-- with `set local role app_user`. Idempotent because migrations may run
-- against a cluster where a sibling package already created it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint

/*
 * Resolves app.tenant_id to a uuid, or NULL if it is unset, empty, or not a
 * uuid at all.
 *
 * The exception handler is load-bearing. Writing the policy as
 * `tenant_id = current_setting('app.tenant_id', true)::uuid` makes a malformed
 * tenant id RAISE 22P02 instead of matching nothing: an attacker-supplied
 * value would produce a distinguishable error rather than a uniform empty
 * result, and every caller would have to handle a cast failure. Verified: the
 * bare cast raises `invalid input syntax for type uuid` on the injection
 * payload; through this function the same payload returns zero rows.
 *
 * NULLIF is equally load-bearing. A custom GUC that has been set locally is
 * restored to the EMPTY STRING at transaction end, not to unset, so on a
 * pooled connection the second transaction would cast '' and fail.
 *
 * STABLE so the planner evaluates it once per query and can still index-scan
 * on tenant_id. A pinned search_path so the function cannot be captured by a
 * shadowing object in a caller-controlled schema.
 */
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog
AS $$
DECLARE
  v text := nullif(current_setting('app.tenant_id', true), '');
BEGIN
  RETURN v::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user;
--> statement-breakpoint

-- FORCE applies RLS to the table owner too. It does nothing against a
-- superuser — verified — so it is not the control that matters; it is there so
-- that a deployment which accidentally connects as the migration owner is
-- still isolated.
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "locations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tills" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- USING filters what is readable; WITH CHECK filters what is writable. Both,
-- or a tenant can INSERT rows it will never be able to read back.
CREATE POLICY "tenants_tenant_isolation" ON "tenants"
  FOR ALL
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());
--> statement-breakpoint
CREATE POLICY "locations_tenant_isolation" ON "locations"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
CREATE POLICY "tills_tenant_isolation" ON "tills"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

-- No DELETE is granted anywhere in this plan. A location or till with sales
-- behind it must not be removable, and nothing in the write path deletes.
GRANT SELECT ON "tenants" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "locations" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tills" TO app_user;
```

- [ ] **Step 4: Write the failing tests**

`packages/db/src/testing/roles.ts`:

```ts
import { sql } from "drizzle-orm";
import type { Transaction } from "../client.js";

/**
 * Switches the current transaction to the non-owner application role.
 *
 * Every RLS assertion in this repository goes through here. PGlite runs as
 * superuser and superusers bypass RLS unconditionally — with ENABLE and with
 * FORCE alike — so a test that reads without this call is measuring nothing.
 *
 * `set local` rather than `set`: the role reverts at transaction end, so a
 * pooled connection is never handed back wearing the wrong role.
 */
export async function asAppUser(tx: Transaction): Promise<void> {
  await tx.execute(sql`set local role app_user`);
}
```

`packages/db/src/tenancy.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import type { Database } from "./client.js";
import { locations, tenants, tills } from "./schema/tenants.js";
import { describeEachTarget } from "./testing/harness.js";
import { asAppUser } from "./testing/roles.js";
import { withTenant } from "./tenancy.js";

describeEachTarget("tenant isolation", (target) => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    // Seeded as the migration owner, deliberately: provisioning is an admin
    // action and RLS must not be able to prevent it. Two tenants, because a
    // single-tenant fixture cannot distinguish RLS from an absent predicate.
    await db.insert(tenants).values([
      { id: tenantA, nif: "B12345674", legalName: "Bar Alfa SL" },
      { id: tenantB, nif: "B87654328", legalName: "Bar Beta SL" },
    ]);
    await db.insert(locations).values([
      {
        id: randomUUID(),
        tenantId: tenantA,
        name: "Alfa Centre",
        invoiceLocales: ["es", "ca"],
        operationDescription: "Servicios de restauración",
      },
      {
        id: randomUUID(),
        tenantId: tenantB,
        name: "Beta Port",
        invoiceLocales: ["es"],
        operationDescription: "Servicios de restauración",
      },
    ]);
  });

  it("returns only the calling tenant's locations", async () => {
    // No WHERE clause anywhere in this query. That is the whole point: if the
    // test scoped the read itself it would pass with RLS switched off.
    const rows = await withTenant(db, tenantA, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(locations);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(tenantA);
  });

  it("returns only the calling tenant's own row from tenants", async () => {
    const rows = await withTenant(db, tenantB, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(tenants);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(tenantB);
  });

  it("rejects an insert carrying another tenant's id", async () => {
    // WITH CHECK, not USING. Without it a tenant could write rows into a
    // neighbour's data and simply never see them again.
    const attempt = withTenant(db, tenantA, async (tx) => {
      await asAppUser(tx);
      await tx.insert(tills).values({
        tenantId: tenantB,
        locationId: randomUUID(),
        name: "smuggled",
      });
    });

    await expect(attempt).rejects.toThrow(/row-level security/i);
  });

  it("returns no rows when no tenant has been set", async () => {
    // Fail closed. current_setting(..., true) is NULL when unset, the policy
    // predicate is NULL, and NULL is not TRUE, so nothing matches.
    const rows = await db.transaction(async (tx) => {
      await asAppUser(tx);
      return tx.select().from(locations);
    });

    expect(rows).toEqual([]);
  });

  it("returns no rows for an SQL injection payload, and the table survives", async () => {
    const payload = "t1' ; drop table docs; --";

    const rows = await withTenant(db, payload, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(locations);
    });

    expect(rows).toEqual([]);

    // The real assertion. A returned [] proves the predicate did not match; it
    // does not prove the payload was never executed. Reading the table back
    // does.
    const survivors = await db.select().from(locations);
    expect(survivors.length).toBeGreaterThanOrEqual(2);
  });

  it("returns no rows for an empty tenant id rather than raising", async () => {
    // A custom GUC set with set_config(..., true) is restored to '' at
    // transaction end, not to unset. Without the NULLIF in current_tenant_id()
    // the next transaction on a pooled connection casts '' and raises 22P02.
    const rows = await withTenant(db, "", async (tx) => {
      await asAppUser(tx);
      return tx.select().from(locations);
    });

    expect(rows).toEqual([]);
  });

  it("silently ignores SET LOCAL outside a transaction, and then sees nothing", async () => {
    // Pinned deliberately. This is fail-closed but baffling to debug, and the
    // obvious "fix" — dropping the transaction requirement from withTenant —
    // makes tenancy stop working with no error anywhere.
    //
    // The interpolation below is the injection vector this task exists to
    // avoid, shown once, in a test, with a literal we control.
    await db.execute(sql`set local app.tenant_id = ${sql.raw(`'${tenantA}'`)}`);

    const after = await db.execute<{ v: string | null }>(
      sql`select current_setting('app.tenant_id', true) as v`,
    );
    expect(after.rows[0]?.v ?? "").not.toBe(tenantA);

    const rows = await db.transaction(async (tx) => {
      await asAppUser(tx);
      return tx.select().from(locations);
    });
    expect(rows).toEqual([]);
  });

  it("does not constrain a superuser, even with FORCE ROW LEVEL SECURITY", async () => {
    // Pinned so that nobody "fixes" it. Seeing every tenant's rows here is
    // correct Postgres behaviour, not a broken policy: superusers always
    // bypass RLS. The fix for a test that sees too much is asAppUser, never a
    // change to the policy.
    const rows = await withTenant(db, tenantA, async (tx) => tx.select().from(locations));

    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});

describeEachTarget("invoice_locales", (target) => {
  const tenantId = randomUUID();
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await db
      .insert(tenants)
      .values({ id: tenantId, nif: "B44444447", legalName: "Bar Gamma SL" });
  });

  const insertLocales = async (invoiceLocales: string[]): Promise<void> => {
    await db.insert(locations).values({
      tenantId,
      name: `locales-${invoiceLocales.join("-") || "empty"}`,
      invoiceLocales,
      operationDescription: "Servicios de restauración",
    });
  };

  it("accepts a single locale", async () => {
    await expect(insertLocales(["es"])).resolves.toBeDefined();
  });

  it("accepts two locales and preserves their order", async () => {
    await insertLocales(["ca", "es"]);

    const [row] = await db
      .select()
      .from(locations)
      .where(sql`${locations.name} = 'locales-ca-es'`);

    // ["ca","es"] and ["es","ca"] are different invoices, not the same invoice
    // rendered differently. A set-valued column would lose that distinction.
    expect(row?.invoiceLocales).toEqual(["ca", "es"]);
  });

  it("rejects an empty locale list", async () => {
    // The trap this constraint exists for: array_length('{}', 1) is NULL, and
    // a CHECK whose expression is NULL is SATISFIED, so an array_length-based
    // constraint would accept this row. cardinality('{}') is 0.
    await expect(insertLocales([])).rejects.toThrow(/locations_invoice_locales_len/);
  });

  it("rejects three locales", async () => {
    await expect(insertLocales(["es", "ca", "en"])).rejects.toThrow(
      /locations_invoice_locales_len/,
    );
  });
});
```

- [ ] **Step 5: Run each test individually and watch it fail**

The Global Constraint requires per-test red observation, not per-file. Run them one at a time:

```bash
cd packages/db
pnpm vitest run -t "returns only the calling tenant's locations"
```

Expected: FAIL — `Failed to resolve import "./tenancy.js"`.

Repeat for every test name above, confirming each fails on its own. A test that passes here is a defect in the test, not a head start. Pay particular attention to `does not constrain a superuser` and `rejects an empty locale list`: both are shaped so that they could plausibly pass against an empty schema, and if either goes green before the migration exists, it is measuring the absence of the table rather than the behaviour.

- [ ] **Step 6: Implement `withTenant`**

`packages/db/src/tenancy.ts`:

```ts
import { sql } from "drizzle-orm";
import type { Database, Transaction } from "./client.js";

/**
 * Runs `fn` inside a transaction scoped to one tenant.
 *
 * The tenant id is bound as a PARAMETER, via set_config. The obvious
 * alternative does not exist:
 *
 *     SET LOCAL app.tenant_id = $1     -- syntax error
 *
 * SET is a utility statement, and Postgres only substitutes parameters into
 * optimisable statements (SELECT/INSERT/UPDATE/DELETE/VALUES). Preparing that
 * statement fails with `syntax error at or near "set"` — verified. The naive
 * repair is to interpolate the id into the string, which is an injection
 * vector in the one place in the system that must not have one, since it is
 * the value every tenancy decision is made from. set_config() is an ordinary
 * function call inside a SELECT, so it parameterises like anything else.
 *
 * The `true` third argument means "local to this transaction". Combined with
 * the transaction wrapper it is also what makes pooling safe: node-postgres
 * pins one client for the whole transaction() callback, so the GUC cannot leak
 * to another tenant's request, and it is discarded at commit.
 *
 * In the standalone deployment this collapses to a no-op in effect. The same
 * migrations run and the same policy is evaluated, but there is exactly one
 * tenant, so the predicate never excludes a row — and PGlite connects as
 * superuser, which bypasses RLS entirely. That is acceptable only because
 * standalone is single-tenant (spec §3), and it is precisely why the tests
 * must not rely on it. Rejected alternative: branching on a deployment mode
 * inside this function, which would mean the standalone path runs a code path
 * the cloud tests never exercise.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
```

`packages/db/src/client.ts` — append:

```ts
/** The transaction handle Drizzle passes to a `transaction()` callback. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
```

`packages/db/src/index.ts` — append:

```ts
export * from "./schema/tenants.js";
export { withTenant } from "./tenancy.js";
```

`asAppUser` is intentionally **not** re-exported from `index.ts`. It is a testing seam; exporting it from the package's public surface would make it reachable from application code, where switching roles mid-request is a privilege bug rather than a feature.

- [ ] **Step 7: Run the tests and verify they pass**

```bash
cd packages/db
pnpm vitest run src/tenancy.test.ts
```

Expected: PASS, 24 tests (12 per target × 2 targets).

```bash
cd ../.. && pnpm typecheck
```

Expected: typecheck passes with no output.

- [ ] **Step 8: Teeth check — break it and watch it scream**

Confirm these tests have teeth rather than merely executing the code.

Temporarily drop the `WITH CHECK` clause from `locations_tenant_isolation` and `tills_tenant_isolation` in `0002_tenancy_rls.sql`, wipe the test database and re-run:

```bash
pnpm vitest run src/tenancy.test.ts
```

Expected: FAIL — `rejects an insert carrying another tenant's id`. Restore it.

Now temporarily replace `cardinality` with `array_length(v, 1)` in the `locations_invoice_locales_len` check:

Expected: FAIL — `rejects an empty locale list` only; `rejects three locales` stays green, because `array_length` is correct for every case except the empty one. Restore it.

Now temporarily remove the `EXCEPTION WHEN invalid_text_representation` handler from `current_tenant_id()`:

Expected: FAIL — `returns no rows for an SQL injection payload`, which now raises `invalid input syntax for type uuid` instead of returning `[]`. Restore it.

Now temporarily remove the `nullif(..., '')`:

Expected: FAIL — `returns no rows for an empty tenant id rather than raising`. Restore it.

If any mutation leaves the suite green, a test is missing.

- [ ] **Step 9: The demonstration — a green suite that asserts nothing**

This is the most important step in the task. The mutations above all failed loudly, which is reassuring and also misleading: it suggests that a broken RLS setup announces itself. It does not. The failure mode is a suite that stays green.

Add this test temporarily, alongside the real ones:

```ts
it("scopes reads to the calling tenant", async () => {
  const rows = await withTenant(db, tenantA, async (tx) =>
    tx.select().from(locations).where(eq(locations.tenantId, tenantA)),
  );

  expect(rows).toHaveLength(1);
  expect(rows[0]?.tenantId).toBe(tenantA);
});
```

It reads like the real thing. Its name says isolation, it uses `withTenant`, and it asserts exactly what a reviewer expects. Note that it does **not** call `asAppUser`, and that it carries its own `where` clause.

Run it:

```bash
pnpm vitest run -t "scopes reads to the calling tenant"
```

Expected: PASS.

Now delete every `CREATE POLICY` statement from `0002_tenancy_rls.sql`, wipe the test database and run it again:

Expected: PASS — unchanged. Now also delete the three `ENABLE ROW LEVEL SECURITY` lines from `0001_tenancy.sql` and run it again:

Expected: PASS — unchanged.

The test is green against a database with **no tenancy enforcement whatsoever**. Its `where` clause did all the work, and running as superuser meant RLS was never consulted even when it existed. This is the shape that ships: seven vacuous tests were found across plan 1 by exactly this kind of check.

For contrast, run the real test against that same stripped database:

```bash
pnpm vitest run -t "returns only the calling tenant's locations"
```

Expected: FAIL — 2 rows returned, 1 expected.

Restore both migrations, delete the temporary test, and re-run the full file.

Expected: PASS, 24 tests.

- [ ] **Step 10: Commit**

```bash
git add packages/db/src/schema/tenants.ts packages/db/src/tenancy.ts \
  packages/db/src/tenancy.test.ts packages/db/src/testing/roles.ts \
  packages/db/src/client.ts packages/db/src/index.ts \
  packages/db/drizzle
git commit -m "feat(db): tenancy schema, row-level security and the withTenant seam

Tenant isolation is enforced by the database rather than by a where clause
someone remembered to write. Every table carries tenant_id, every table has
a policy keyed on current_tenant_id(), and the application connects as a
non-owner role that the policies actually apply to.

The tenant id reaches the session through set_config, not SET LOCAL. SET
LOCAL takes no bind parameters — preparing 'SET LOCAL app.tenant_id = \$1'
is a syntax error — so the naive repair is string interpolation, which puts
an injection vector in the single value every tenancy decision derives
from. The suite pins the payload returning zero rows with the table intact,
and pins the two confusing fail-closed behaviours around it: a SET LOCAL
outside a transaction silently does nothing, and a custom GUC is restored to
the empty string rather than to unset.

Every read in the suite goes through asAppUser. PGlite runs as superuser and
superusers bypass RLS with ENABLE and with FORCE alike, so a suite without
the role change is green against a database with no policies at all — which
is demonstrated rather than described, because that shape is what actually
ships."
```

---

## Task 5: Immutability — privileges, triggers, and the TRUNCATE hole

A record that can be edited after the fact is not evidence. This task builds the **pattern** every immutable table in the plan applies, and proves it: an `UPDATE`, `DELETE` or `TRUNCATE` against a protected table failing for **two independent reasons**, each demonstrated in the context where it is the binding one.

**This task creates no business tables.** It creates the shared trigger function and the recipe; `sales`, `sale_lines` and `tenders` belong to Task 8, `invoice_series` to Task 6, `registros_facturacion` to Task 12. Each of those applies this pattern itself — see "Who applies the pattern, and when" below, which is a correctness requirement rather than an organising preference.

**Files:**

- Create: `packages/db/src/immutability.sql.md` (the recipe, copied into each protecting migration)
- Create: `packages/db/src/immutability.test.ts`
- Create: `packages/db/src/testing/errors.ts`
- Create: `packages/db/drizzle/0003_immutability.sql` (custom — handwritten; the function only)

**Interfaces:**

- Consumes:
  - `describeEachTarget` from `./testing/harness.js` (Task 2), `asAppUser` from `./testing/roles.js` (Task 4).
- Produces:
  - `reject_mutation()` — a SQL trigger function, applied by two triggers per protected table.
  - `pgErrorCode(error: unknown): string | undefined`
  - `captureError(fn: () => Promise<unknown>): Promise<unknown>`

### Who applies the pattern, and when

**Each schema task applies this pattern in the same migration that creates its own tables.** Not in a later migration, and not from here.

The reason is a window. If migration *n* creates `sales` and migration *n+1* protects it, then between the two the table exists with the application role holding whatever the default grants give it — and migrations are not always applied in one uninterrupted run. A deployment that fails, is interrupted, or is stopped for inspection between *n* and *n+1* leaves a live database in which the immutable record is writable, and nothing in the schema says so. The window is small and entirely avoidable: `CREATE TABLE`, `REVOKE`, `GRANT`, `CREATE TRIGGER` in one migration means the table is never, at any instant, unprotected.

An earlier draft of this plan had Task 5 create `sales`, `sale_lines` and `tenders` in migration `0003` and protect them in `0004`, while Task 8 created the same three tables again — both the window and a duplicate `CREATE TABLE`. That is why this task now owns only the function.

The module does the same thing for `registros_facturacion` in **Task 12**, in its own migration folder, rather than being protected from here. Core does not own module schema: a core migration granting or revoking on a table `packages/fiscal-verifactu` created would make the two packages' migration journals order-dependent, and nothing enforces that core migrations run before module ones.

### Which control is the real one

The privilege revocation is the control. The trigger is the backstop.

Framing it the other way round — trigger first, privileges as belt-and-braces — is not a stylistic preference, it is wrong, and it is wrong for the reason spec §3 rejected SQLite over. **The table owner can `ALTER TABLE … DISABLE TRIGGER`.** If the application connects as the owner, a trigger reduces the guarantee to "the application does not misbehave", which is the exact guarantee it was introduced to replace. A non-owner role that was never granted `UPDATE` cannot disable the trigger, cannot drop it, and cannot re-grant itself the privilege.

So: **migrations run as owner; the application never does.** The trigger earns its place by covering the case the privileges do not — an operator or a future migration running as owner and reaching for a one-line "correction".

Because these tables are immutable, submission state **cannot** live on them. There is no `submitted_at` on `sales` and no attempt counter on the fiscal record. Spec §3 draws the consequence directly: state that mutates constantly goes in a 1:1 sidecar, `envios`, built in Task 12. Immutable fact, mutable delivery state.

- [ ] **Step 1: Hand-write the immutability migration — the function, and nothing else**

```bash
cd packages/db
pnpm drizzle-kit generate --custom --name immutability
```

Drizzle has **no trigger support in `pg-core`** — there is no builder, and there is no plan for one. Handwritten SQL in a `--custom` migration is the supported route, and it survives later `generate` runs: drizzle-kit diffs the schema against its own snapshot in `drizzle/meta/`, and that snapshot has no concept of triggers, so there is nothing for it to see drift against and nothing for it to try to reconcile.

`packages/db/drizzle/0003_immutability.sql` — **one function, no tables, no grants.** Grants and triggers belong to the migration that creates each protected table:

```sql
/*
 * The backstop, not the control.
 *
 * A distinct SQLSTATE rather than the plpgsql default P0001, so tests can
 * assert on the code instead of the wording — a test matching on prose breaks
 * when the message is improved, and passes when the wrong error is raised.
 * WT001 is in a user-defined class; the standard reserves classes 00–08 and
 * those beginning A–H.
 *
 * The same function serves both the row triggers and the statement triggers.
 * TG_OP distinguishes them and it always raises, so the return value is
 * unreachable.
 *
 * Created once, here, and referenced by every protected table in packages/db.
 * It takes no arguments and reads only TG_ variables, so one definition covers
 * every table without parameterisation.
 */
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'WT001';
END;
$$;
```

- [ ] **Step 2: Write down the recipe every schema task copies**

`packages/db/src/immutability.sql.md`. Four parts, and **all four go in the same migration as the `CREATE TABLE`** — see "Who applies the pattern, and when". Substitute the table name:

```sql
-- 1. The control. The REVOKE is not redundant with "never granting":
--    provisioning scripts routinely carry
--    GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user, and a blanket grant
--    issued after this migration would hand back exactly the privileges being
--    withheld. Stating the revocation makes the intent legible and undoes any
--    prior blanket grant in the same breath.
REVOKE UPDATE, DELETE, TRUNCATE ON "<table>" FROM app_user;
GRANT SELECT, INSERT ON "<table>" TO app_user;

-- 2. The row-level backstop, for the owner — who has every privilege, and
--    against whom the grants above do nothing.
CREATE TRIGGER "<table>_immutable"
  BEFORE UPDATE OR DELETE ON "<table>"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- 3. The TRUNCATE hole. TRUNCATE is not a row event: the FOR EACH ROW trigger
--    above does NOT fire on it — verified, with only the row trigger in place
--    `TRUNCATE <table>` as the owner succeeded and emptied the table while the
--    trigger sat there. RLS does not cover TRUNCATE either, so a statement-level
--    trigger is the only mechanism that catches it.
CREATE TRIGGER "<table>_no_truncate"
  BEFORE TRUNCATE ON "<table>"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- 4. Tenant isolation. FORCE is required: without it the table owner bypasses
--    the policy, and migrations run as owner.
ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;
CREATE POLICY "<table>_tenant_isolation" ON "<table>"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
```

Omitting part 3 is the single easiest mistake to make here, and the one that leaves no trace: the suite stays green because the application role has no `TRUNCATE` privilege anyway, so only an owner-path test notices. Step 8 is about exactly that failure.

- [ ] **Step 3: Confirm this migration creates no table**

```bash
grep -in "create table" packages/db/drizzle/0003_immutability.sql
```

Expected: no output. If a table appears here, the pattern has been inverted — protection has become something applied *to* tables from a central place, which reintroduces the unprotected window this task exists to close.

- [ ] **Step 4: Write the failing tests**

`packages/db/src/testing/errors.ts`:

```ts
/**
 * Extracts a Postgres SQLSTATE from a driver error.
 *
 * node-postgres puts it on `.code`; PGlite has been observed to nest the
 * original error under `.cause`. The two are normalised here so that a test
 * asserting on a SQLSTATE reads identically against both targets.
 */
export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null | undefined;
  if (typeof e?.code === "string") return e.code;
  if (typeof e?.cause?.code === "string") return e.cause.code;
  return undefined;
}

/**
 * Runs `fn`, expecting it to reject, and returns the rejection.
 *
 * Throws if it SUCCEEDS. `try { await fn() } catch {}` in a test body is the
 * classic vacuous rejection assertion: it passes whether the operation was
 * blocked or sailed through.
 */
export async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to be rejected, but it succeeded");
}
```

`packages/db/src/immutability.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import type { Database } from "./client.js";
import { captureError, pgErrorCode } from "./testing/errors.js";
import { describeEachTarget } from "./testing/harness.js";
import { asAppUser } from "./testing/roles.js";

/*
 * The pattern is proved against a table this task owns outright, created and
 * protected here in one statement sequence.
 *
 * Deliberately NOT `sales`. That table belongs to Task 8, which applies this
 * same pattern in the migration that creates it; testing the pattern through
 * `sales` would mean this task and that one both owning the same schema, and
 * an earlier draft of this plan did exactly that — two CREATE TABLE statements
 * for one table across two migrations. A dedicated probe also keeps this file
 * honest: it fails when the PATTERN is wrong, not when a sale column changes.
 *
 * Created per test rather than by a migration, because it is scaffolding for
 * the proof rather than part of the product schema.
 */
const PROBE = "immutability_probe";

async function createProtectedProbe(db: Database): Promise<void> {
  await db.execute(sql`
    create table immutability_probe (
      id uuid primary key,
      tenant_id uuid not null,
      note text not null
    )
  `);
  // Parts 1-3 of the recipe. Part 4 (RLS) is Task 4's concern and is exercised
  // there; what is under test here is immutability, not isolation.
  await db.execute(sql`revoke update, delete, truncate on immutability_probe from app_user`);
  await db.execute(sql`grant select, insert on immutability_probe to app_user`);
  await db.execute(sql`
    create trigger immutability_probe_immutable
      before update or delete on immutability_probe
      for each row execute function reject_mutation()
  `);
  await db.execute(sql`
    create trigger immutability_probe_no_truncate
      before truncate on immutability_probe
      for each statement execute function reject_mutation()
  `);
}

describeEachTarget("immutability", (target) => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const rowId = "22222222-2222-4222-8222-222222222222";
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await createProtectedProbe(db);
    await db.execute(
      sql`insert into immutability_probe (id, tenant_id, note)
          values (${rowId}, ${tenantId}, 'original')`,
    );
  });

  it("permits SELECT and INSERT from the application role", async () => {
    // The control that stops every other test in this file from passing for
    // the wrong reason. Revoking ALL privileges would satisfy the rejection
    // tests; only this one notices.
    const inserted = "33333333-3333-4333-8333-333333333333";

    await db.transaction(async (tx) => {
      await asAppUser(tx);
      await tx.execute(
        sql`insert into immutability_probe (id, tenant_id, note)
            values (${inserted}, ${tenantId}, 'appended')`,
      );
    });

    const rows = await db.transaction(async (tx) => {
      await asAppUser(tx);
      return tx.execute(sql`select id from immutability_probe where id = ${inserted}`);
    });
    expect(rows).toHaveLength(1);
  });

  it("rejects an UPDATE from the application role on privilege grounds", async () => {
    const error = await captureError(() =>
      db.transaction(async (tx) => {
        await asAppUser(tx);
        await tx.execute(sql`update immutability_probe set note = 'tampered' where id = ${rowId}`);
      }),
    );

    // 42501 insufficient_privilege. The role was never granted UPDATE, so the
    // statement is refused before any row is examined and before any trigger
    // could fire. This is the control.
    expect(pgErrorCode(error)).toBe("42501");
    expect(String(error)).toMatch(/permission denied/i);
  });

  it("rejects a DELETE from the application role on privilege grounds", async () => {
    const error = await captureError(() =>
      db.transaction(async (tx) => {
        await asAppUser(tx);
        await tx.execute(sql`delete from immutability_probe where id = ${rowId}`);
      }),
    );

    expect(pgErrorCode(error)).toBe("42501");
    expect(String(error)).toMatch(/permission denied/i);
  });

  it("rejects an UPDATE from the table owner on trigger grounds", async () => {
    // The owner has every privilege, so the second, independent reason is the
    // only thing left. Run as owner deliberately — this is the ONE place in
    // the suite where the role must NOT be switched, because the owner is the
    // actor whose behaviour is under test.
    const error = await captureError(() =>
      db.execute(sql`update immutability_probe set note = 'tampered' where id = ${rowId}`),
    );

    expect(pgErrorCode(error)).toBe("WT001");
    expect(String(error)).toMatch(/append-only/);
  });

  it("rejects a DELETE from the table owner on trigger grounds", async () => {
    const error = await captureError(() =>
      db.execute(sql`delete from immutability_probe where id = ${rowId}`),
    );

    expect(pgErrorCode(error)).toBe("WT001");
  });

  it("rejects a TRUNCATE from the table owner", async () => {
    // The hole this test exists for: a FOR EACH ROW trigger does not fire on
    // TRUNCATE, so without the statement-level trigger the owner empties the
    // table with no error at all.
    const error = await captureError(() => db.execute(sql`truncate table immutability_probe`));

    expect(pgErrorCode(error)).toBe("WT001");
    expect(String(error)).toMatch(/TRUNCATE is not permitted/);

    // TRUNCATE is transactional in Postgres, so a rolled-back one leaves no
    // trace — but this one never committed anything to roll back. Read the
    // rows to prove the rejection was real rather than a message on the way
    // out.
    const rows = await db.execute(sql`select id from immutability_probe`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("rejects a TRUNCATE from the application role on privilege grounds", async () => {
    const error = await captureError(() =>
      db.transaction(async (tx) => {
        await asAppUser(tx);
        await tx.execute(sql`truncate table immutability_probe`);
      }),
    );

    expect(pgErrorCode(error)).toBe("42501");
    expect(String(error)).toMatch(/permission denied/i);
  });

  it("names the offending table in the rejection", async () => {
    // reject_mutation() is shared by every protected table in the package, so
    // it reports TG_TABLE_NAME rather than a literal. A hardcoded name here
    // would be invisible until the second table adopted the pattern and
    // started blaming the first one for its own rejections.
    const error = await captureError(() =>
      db.execute(sql`delete from immutability_probe where id = ${rowId}`),
    );
    expect(String(error)).toMatch(/immutability_probe is append-only/);
  });

  it("reports the operation that was attempted", async () => {
    // TG_OP, not a fixed string: an incident report saying "UPDATE" when
    // someone ran TRUNCATE sends the reader after the wrong actor.
    const update = await captureError(() =>
      db.execute(sql`update immutability_probe set note = 'x' where id = ${rowId}`),
    );
    expect(String(update)).toMatch(/UPDATE is not permitted/);

    const truncate = await captureError(() =>
      db.execute(sql`truncate table immutability_probe`),
    );
    expect(String(truncate)).toMatch(/TRUNCATE is not permitted/);
  });
});
```

- [ ] **Step 5: Run each test individually and watch it fail**

Expected: FAIL — `function reject_mutation() does not exist`, raised by `createProtectedProbe` in `beforeEach`.

Run each by name. `permits SELECT and INSERT from the application role` is the one to watch: it is the only test here that fails if the pattern revokes too much, and a suite of rejection tests alone is green against a table nobody can write at all.

- [ ] **Step 6: Run the tests and verify they pass**

```bash
cd packages/db
pnpm vitest run src/immutability.test.ts
```

Expected: PASS, 18 tests (9 per target × 2 targets).

```bash
cd ../.. && pnpm typecheck && pnpm lint
```

Expected: both pass with no output.

- [ ] **Step 7: Teeth check — break it and watch it scream, as the app role**

Confirm these tests have teeth rather than merely executing the code. **Every mutation below must be observed with the role change in place.** A rejection test run as the owner passes on the trigger alone and stays green through any privilege mistake — which is the same failure mode as Task 4's, in a different costume, and is checked explicitly in Step 8.

Temporarily add `grant update, delete on immutability_probe to app_user` to the end of `createProtectedProbe` and re-run:

```bash
pnpm vitest run src/immutability.test.ts
```

Expected: FAIL — `rejects an UPDATE from the application role on privilege grounds` and `rejects a DELETE from the application role on privilege grounds`, both now reporting `WT001` where `42501` was expected. Note what this failure means: the statements were still rejected, by the backstop. The tests failed because they assert **which** control fired, and that distinction is the entire subject of this task. Restore it.

Now temporarily drop the row trigger — remove the `immutability_probe_immutable` statement from `createProtectedProbe`:

Expected: FAIL — `rejects an UPDATE from the table owner on trigger grounds`, `rejects a DELETE from the table owner on trigger grounds`, `names the offending table in the rejection` and `reports the operation that was attempted`. The two application-role tests stay green, because the privilege control is untouched. Restore it.

Now temporarily drop **only** `immutability_probe_no_truncate`, leaving `immutability_probe_immutable` in place:

Expected: FAIL — `rejects a TRUNCATE from the table owner`, and it fails at `captureError` with `expected the operation to be rejected, but it succeeded`. Inspect the table afterwards: it is empty. The row trigger is still installed, still enabled, and did not fire, because `TRUNCATE` is not a row event. Restore it.

Now temporarily change the `RAISE` to omit `USING ERRCODE`:

Expected: FAIL — every owner-side test, on `pgErrorCode(error)` returning `P0001`. Restore it.

If any mutation leaves the suite green, a test is missing.

- [ ] **Step 8: The demonstration — a green rejection test that proves nothing**

Add this test temporarily, alongside the real ones:

```ts
it("does not allow the record to be updated", async () => {
  await expect(
    db.execute(sql`update immutability_probe set note = 'tampered' where id = ${rowId}`),
  ).rejects.toThrow();
});
```

It is the shape almost every immutability test takes. It names the property correctly and it does reject.

```bash
pnpm vitest run -t "does not allow the record to be updated"
```

Expected: PASS.

Now re-apply the mutation from Step 7 — `grant update, delete on immutability_probe to app_user` — and run it again:

Expected: PASS — unchanged. The application role now has full write access to the fiscal record and the test does not notice, because it runs as the **owner**, where the trigger fires regardless.

Now additionally drop the `REVOKE` line entirely and run it again:

Expected: PASS — unchanged.

For contrast, run the real test against that same database:

```bash
pnpm vitest run -t "rejects an UPDATE from the application role on privilege grounds"
```

Expected: FAIL — `WT001` where `42501` was expected.

The vacuous test is green against a database whose application role can rewrite every sale it can see. Restore the migration, delete the temporary test, and re-run the full file.

Expected: PASS, 18 tests.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/immutability.sql.md packages/db/src/immutability.test.ts \
  packages/db/src/testing/errors.ts packages/db/drizzle
git commit -m "feat(db): the append-only pattern every immutable table applies

An UPDATE or DELETE against a protected table fails for two independent
reasons. The control is the privilege revocation: the application connects
as a non-owner role holding only SELECT and INSERT, so the statement is
refused with 42501 before any row is examined. The trigger is the backstop,
covering the owner — an operator or a migration reaching for a one-line
correction — with a distinct SQLSTATE so tests can assert which control
fired rather than merely that something did.

The reverse framing would not hold. A table owner can ALTER TABLE ...
DISABLE TRIGGER, so a trigger alone reduces the guarantee to 'the
application does not misbehave', which is exactly the guarantee it was
introduced to replace, and exactly why spec §3 rejected SQLite. A second
BEFORE TRUNCATE ... FOR EACH STATEMENT trigger is required alongside the row
triggers because TRUNCATE is not a row event: with only the row trigger
installed, TRUNCATE empties the table while the trigger sits there, and RLS
does not cover TRUNCATE either.

This task creates the function and the recipe, and no business table. Each
schema task applies all four parts in the SAME migration that creates its own
tables, so a table is never unprotected at any instant — an earlier draft
created sales in one migration and protected it in the next, leaving a window
in which an interrupted deployment has a writable fiscal record. The module
does the same for its own tables in its own migration folder, rather than
being reached into from core.

Because protected tables cannot be updated, submission state cannot live on
them. There is no submitted_at and no attempt counter on a sale or a registro;
they go in the 1:1 envios sidecar in Task 12."
```

---
## Task 6: `invoice_series` and strictly-increasing allocation

Its deliverable is a number allocator that cannot hand the same invoice number out twice, under concurrency or after a crash — because reuse is the one numbering failure the regulation treats as fatal, while gaps it simply permits.

**Files:**

- Create: `packages/db/src/schema/series.ts`
- Create: `packages/db/src/schema/series.test.ts`
- Create: `packages/db/src/allocate-number.ts`
- Create: `packages/db/src/allocate-number.test.ts`
- Create: `packages/db/drizzle/0004_invoice_series.sql` (generated by `drizzle-kit generate`; take whatever number it assigns — then **hand-extended** with the RLS and grant block, one migration rather than two)
- Modify: `packages/db/src/index.ts` (re-export `invoiceSeries` and `allocateInvoiceNumber`)

**Interfaces:**

- Consumes:
  - `tenants`, `locations`, `tills` from `./schema/tenants.js` (Task 4).
  - `withTenant` from `./tenancy.js`, `asAppUser` from `./testing/roles.js`, `describeEachTarget` from `./testing/harness.js` (Tasks 1–5).
  - `AppError` from `@waitron/shared`.
  - `Database`, `Transaction` from `./client.js`.
- Produces:
  - `invoiceSeries` — the Drizzle table.
  - `allocateInvoiceNumber(tx: Transaction, seriesId: string): Promise<number>`

This task binds to two seams built in Tasks 1–5, and both are now fixed by the naming contract rather than assumed here. `describeEachTarget(title, (target) => …)` invokes its callback once per target, with `target.name: "pglite" | "postgres"` known **synchronously at collection time** and `await target.create()` returning a fresh, migrated `Database` — called from the test's own `beforeEach`, never at describe time. `Transaction` is exported from `./client.js` alongside `Database`. **Do not add a second harness.** A test file that quietly builds its own PGlite instance instead of going through the harness runs only one target while appearing to run both, which is the failure this seam exists to prevent.

### The allocation mechanism, and why it is not the chain's mechanism

The measured chain-append table in the Global Constraints — naive read-then-write committing 3 of 20, `FOR UPDATE` committing 20 of 20 — is about the **chain**, and its conclusion does **not** transfer to series allocation. The chain append is a read–compute–write: it must read the predecessor's huella, hash over it, and write the result, so the value it read has to stay stable across the computation, and the whole thing has to be transactional because the record and the sale must commit together. That is precisely the shape `SELECT … FOR UPDATE` plus a unique backstop exists for.

Series allocation is the opposite shape on the first axis: nothing is computed over the value read — the new value is a pure function of the old one, which the database can do atomically without ever showing anyone the intermediate. One statement does the whole job.

Four candidates, and why three lose:

| Mechanism | Concurrency | Rollback | Verdict |
| --- | --- | --- | --- |
| `SELECT next_number` then `UPDATE` | duplicates — the read is stale by the time the write lands | number returns | rejected; this is the teeth-check mutation |
| `SELECT … FOR UPDATE` then `UPDATE` | correct | number returns | rejected — two statements and a round trip where one statement is exactly equivalent |
| `UPDATE … SET next_number = next_number + 1 … RETURNING` | correct at READ COMMITTED (the blocked statement re-evaluates against the updated row) | number returns | **chosen** |
| `nextval` on a per-series sequence | correct, and never blocks | number is burned | rejected — needs dynamic DDL per series row; see below |

**Allocation is transactional, and a rollback therefore returns the number.** No gap appears. That is correct behaviour, not a defect to engineer around: the regulation requires that numbering be **strictly increasing and never reused**, and it *permits* gaps without requiring them. A design that manufactures gaps satisfies nothing the regulation asks for.

The property that actually matters is **a number is never reused once it has been used**, and it is enforced where such properties belong — in the database, by `UNIQUE (tenant_id, series_id, invoice_number)` on `sales`. The row lock serialises allocation so two concurrent sales cannot read the same value; the unique constraint is the backstop that makes reuse impossible even if the allocator is wrong. That is the same two-layer argument this plan makes everywhere else: a serialising lock for correctness under contention, plus a constraint that does not depend on application code behaving.

**Why the sequence was rejected.** A sequence per series is not a schema — it is a *sequence per row*, which means `CREATE SEQUENCE` executed from a trigger every time a series row is inserted, `DROP SEQUENCE` on delete, a `SECURITY DEFINER` function with a pinned `search_path` to run that DDL, a `GRANT` per sequence, and a name-mangling function to map a uuid onto an identifier. Every one of those is a moving part that exists only to make a documentation sentence literally true. Dynamic DDL driven by row inserts also puts schema changes inside ordinary write transactions, where they take locks that ordinary writes do not and interact badly with logical replication and with `pg_dump` ordering. The cost is real and recurring; the benefit — a burned number instead of a returned one — is something the regulation does not ask for.

**The spec sentence is what is wrong, not the implementation.** Spec §3 and §4 both say "a crash anywhere before commit burns an invoice number". Under a plain column that is simply not what happens, and the correct response is to fix the sentence rather than to add a sequence. Task 18 owns that correction.

**Consequence for `next_number`.** The naming contract's `next_number` column is the live counter and the single source of truth — a plain `integer` column, updated in place under the row lock the allocating statement takes. There is no seed, no sequence, and no second copy of the value to drift.

This is the one place where Task 5's blanket revocation is deliberately relaxed: the application role needs `UPDATE (next_number)` on `invoice_series`, column-scoped, so that allocation can run as `app_user`. `invoice_series` is a configuration table rather than a fiscal record — it is not part of the immutable commercial record, and nothing about it is under audit — so the immutability argument does not apply to it. `sales`, which *is* the record, keeps its total revocation. Step 3's SQL grants exactly that one column and no other.

### N series per till, and nothing that couples a series to a chain

Findings §1: one till may own N series but has exactly one chain. Series is a numbering concern, the chain is a device concern, and AEAT chains "independientemente de la serie o número que tengan las facturas". Asesor Q5(b) — whether rectificativas need their own series — is unverified, so N-per-till is supported from day one, which costs a unique constraint on `(tenant_id, till_id, code)` and nothing else.

The corresponding prohibition is structural: **no column, constraint or index in this task may relate a series to a chain position.** No `chain_id`, no `secuencia`, no unique index on `(tenant_id, till_id)` alone — that last one is the subtle version, because it would silently reimpose one-series-per-till. Step 1 includes an introspection test for each, so the prohibition is checked by the suite rather than by review.

`purpose` is a `text` column with a `CHECK`, deliberately not a `pgEnum`. The value set is unverified pending Q5(b), and widening a `CHECK` is a one-line migration where widening an enum needs `ALTER TYPE`. Contrast Task 7, where `working_orders.status` **is** an enum because its three values are settled.

> **Numbering may never be reused even for test invoices** — findings §1, *«aunque sean facturas expedidas 'de prueba'»*. Test invoices burn real numbers. Every test in this task therefore runs against **fixture tenants with fixture NIFs in a throwaway database**, and any manual exercise runs against **AEAT preproducción only**. **Never a production NIF, on any target, at any point.** The failure mode if you ignore this is not a red test — it is a real number consumed in a real chain, permanently, with no mechanism anywhere in the regime to undo it.

- [ ] **Step 1: Write the failing schema tests**

`packages/db/src/schema/series.test.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { asAppUser } from "../testing/roles.js";
import { describeEachTarget } from "../testing/harness.js";
import { withTenant } from "../tenancy.js";
import { locations, tenants, tills } from "./tenants.js";
import { invoiceSeries } from "./series.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_A2 = "aaaaaaaa-1111-4000-8000-000000000002";
const TILL_B1 = "bbbbbbbb-1111-4000-8000-000000000001";

/**
 * Both drivers expose `.rows`, but the pglite driver returns its own Results
 * object rather than node-postgres's QueryResult. Normalising here keeps the
 * introspection tests identical across targets instead of forking on driver.
 */
async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

/** Seeds as owner, deliberately: RLS has nothing to say about the fixture. */
async function seed(db: Database): Promise<void> {
  await db.insert(tenants).values([
    { id: TENANT_A, nif: "B00000000", legalName: "Fixture Tenant A" },
    { id: TENANT_B, nif: "B11111111", legalName: "Fixture Tenant B" },
  ]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      tenantId: TENANT_A,
      name: "Fixture Location A",
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
    {
      id: LOCATION_B,
      tenantId: TENANT_B,
      name: "Fixture Location B",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([
    { id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" },
    { id: TILL_A2, tenantId: TENANT_A, locationId: LOCATION_A, name: "A2" },
    { id: TILL_B1, tenantId: TENANT_B, locationId: LOCATION_B, name: "B1" },
  ]);
}

describeEachTarget("invoice_series schema", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await db.execute(sql`truncate table tenants cascade`);
    await seed(db);
  });

  it("holds several series on one till", async () => {
    await db.insert(invoiceSeries).values([
      { tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard", nextNumber: 1 },
      { tenantId: TENANT_A, tillId: TILL_A1, code: "RA", purpose: "rectificative", nextNumber: 1 },
    ]);
    const found = await db
      .select({ code: invoiceSeries.code })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.tillId, TILL_A1));
    expect(found.map((r) => r.code).sort()).toEqual(["FA", "RA"]);
  });

  it("rejects a duplicate code on the same till", async () => {
    await db
      .insert(invoiceSeries)
      .values({ tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard" });
    await expect(
      db
        .insert(invoiceSeries)
        .values({ tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard" }),
    ).rejects.toThrow(/duplicate key value/);
  });

  it("permits the same code on two different tills", async () => {
    // Series codes are a per-till numbering concern. Two tills in one venue
    // both running series "FA" is normal, and their numbers are independent.
    await db.insert(invoiceSeries).values([
      { tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard" },
      { tenantId: TENANT_A, tillId: TILL_A2, code: "FA", purpose: "standard" },
    ]);
    const found = await db.select({ id: invoiceSeries.id }).from(invoiceSeries);
    expect(found).toHaveLength(2);
  });

  it("rejects a purpose outside the permitted set", async () => {
    await expect(
      db
        .insert(invoiceSeries)
        .values({ tenantId: TENANT_A, tillId: TILL_A1, code: "XX", purpose: "invented" }),
    ).rejects.toThrow(/invoice_series_purpose_ck/);
  });

  it("has no column relating a series to a chain", async () => {
    // Findings §1: series is a numbering concern, the chain is a device
    // concern. A column named for chain position here would be the first step
    // towards per-series chaining, which AEAT art. 7.c) forbids outright.
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'invoice_series'`,
    );
    const offenders = cols
      .map((c) => c.column_name)
      .filter((n) => /chain|cadena|secuencia|huella|registro/i.test(n));
    expect(offenders).toEqual([]);
  });

  it("has no unique constraint on (tenant_id, till_id) alone", async () => {
    // The subtle coupling: a unique index on the pair would silently reimpose
    // one series per till, which is the thing N-series-from-day-one exists to
    // avoid. It reads as a harmless index, so only a test catches it.
    const found = await rows<{ indexdef: string }>(
      db,
      sql`select indexdef from pg_indexes where tablename = 'invoice_series'`,
    );
    const pairOnly = found.filter(
      (i) => /UNIQUE/i.test(i.indexdef) && /\(tenant_id, till_id\)/.test(i.indexdef),
    );
    expect(pairOnly).toEqual([]);
  });

  it("hides another tenant's series from the app role", async () => {
    await db.insert(invoiceSeries).values([
      { tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard" },
      { tenantId: TENANT_B, tillId: TILL_B1, code: "FB", purpose: "standard" },
    ]);
    const visible = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.select({ code: invoiceSeries.code }).from(invoiceSeries);
    });
    expect(visible.map((r) => r.code)).toEqual(["FA"]);
  });

  it("grants the app role UPDATE on next_number and on no other column", async () => {
    // The one relaxation of Task 5's blanket revocation in this plan, and it
    // is scoped to a single column. Asserted by introspection rather than by
    // trying each column in turn: a new column added later is caught by this
    // test without anyone remembering to extend a list.
    const granted = await db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.column_privileges
      where table_name = 'invoice_series'
        and grantee = 'app_user'
        and privilege_type = 'UPDATE'
      order by column_name
    `);
    expect(granted.map((r) => r.column_name)).toEqual(["next_number"]);
  });

  it("refuses an UPDATE of any other column as the app role", async () => {
    // next_number moves; the series' identity does not. A blanket UPDATE would
    // let the application retarget a series at another till, which the audit
    // trail assumes is stable.
    const [series] = await db
      .insert(invoiceSeries)
      .values({ tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx
          .update(invoiceSeries)
          .set({ code: "ZZ" })
          .where(eq(invoiceSeries.id, series.id));
      }),
    ).rejects.toThrow(/permission denied for table invoice_series/);
  });

  it("permits an UPDATE of next_number as the app role", async () => {
    // The counterpart to the test above, and the reason allocation can run
    // outside the owner role at all.
    const [series] = await db
      .insert(invoiceSeries)
      .values({ tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx
          .update(invoiceSeries)
          .set({ nextNumber: 9999 })
          .where(eq(invoiceSeries.id, series.id));
      }),
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Write the failing allocation tests**

`packages/db/src/allocate-number.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { allocateInvoiceNumber } from "./allocate-number.js";
import type { Database } from "./client.js";
import { invoiceSeries } from "./schema/series.js";
import { locations, tenants, tills } from "./schema/tenants.js";
import { describeEachTarget } from "./testing/harness.js";
import { asAppUser } from "./testing/roles.js";
import { withTenant } from "./tenancy.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_B1 = "bbbbbbbb-1111-4000-8000-000000000001";
const UNKNOWN_SERIES = "00000000-0000-4000-8000-000000000000";

async function seed(db: Database): Promise<void> {
  await db.insert(tenants).values([
    { id: TENANT_A, nif: "B00000000", legalName: "Fixture Tenant A" },
    { id: TENANT_B, nif: "B11111111", legalName: "Fixture Tenant B" },
  ]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      tenantId: TENANT_A,
      name: "Fixture Location A",
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
    {
      id: LOCATION_B,
      tenantId: TENANT_B,
      name: "Fixture Location B",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([
    { id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" },
    { id: TILL_B1, tenantId: TENANT_B, locationId: LOCATION_B, name: "B1" },
  ]);
}

async function makeSeries(
  db: Database,
  values: { tenantId: string; tillId: string; code: string; nextNumber?: number },
): Promise<string> {
  const [row] = await db
    .insert(invoiceSeries)
    .values({ ...values, purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  return row.id;
}

describeEachTarget("allocateInvoiceNumber", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await db.execute(sql`truncate table tenants cascade`);
    await seed(db);
  });

  it("returns the starting number on the first allocation", async () => {
    const seriesId = await makeSeries(db, { tenantId: TENANT_A, tillId: TILL_A1, code: "FA" });
    const n = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect(n).toBe(1);
  });

  it("honours a starting number other than 1", async () => {
    // A venue migrating from another system continues its existing numbering.
    // Hardcoding a start of 1 would silently restart the numbering and produce
    // duplicate numbers against records the tax authority already holds.
    const seriesId = await makeSeries(db, {
      tenantId: TENANT_A,
      tillId: TILL_A1,
      code: "FA",
      nextNumber: 5000,
    });
    const first = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId));
    const second = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect([first, second]).toEqual([5000, 5001]);
  });

  it("increases strictly across successive allocations", async () => {
    const seriesId = await makeSeries(db, { tenantId: TENANT_A, tillId: TILL_A1, code: "FA" });
    const allocated: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      allocated.push(await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId)));
    }
    expect(allocated).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns a number as a JS number, not a string", async () => {
    // `next_number` is integer, which node-postgres renders as a number — but
    // a widening of the column to bigint, or a RETURNING expression that
    // produces numeric, would render as a string instead. An unconverted "1"
    // compares equal to 1 under == but not under toBe, and would reach the
    // invoice number column as text.
    const seriesId = await makeSeries(db, { tenantId: TENANT_A, tillId: TILL_A1, code: "FA" });
    const n = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect(typeof n).toBe("number");
  });

  it("returns the number to the series when the transaction rolls back", async () => {
    // Allocation is transactional, so an abort un-does it and no gap appears.
    // This is correct: the regulation requires strictly-increasing and
    // never-reused numbering and *permits* gaps without requiring them, so a
    // returned number satisfies it. Asserting `2` here would be asserting that
    // the counter escaped its transaction, which is the behaviour this task
    // deliberately does not implement.
    const seriesId = await makeSeries(db, { tenantId: TENANT_A, tillId: TILL_A1, code: "FA" });
    let allocated = 0;
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        allocated = await allocateInvoiceNumber(tx, seriesId);
        // Stands in for every abort: a failed write, a crashed process, a
        // declined card after the number was taken.
        throw new Error("deliberate rollback");
      }),
    ).rejects.toThrow(/deliberate rollback/);
    expect(allocated).toBe(1);

    const next = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect(next).toBe(1);
  });

  it("hands out no number twice across interleaved aborts and commits", async () => {
    // The property the regulation actually requires: never reused **once
    // used**. A rolled-back allocation was never used — nothing was recorded
    // under it and no receipt bearing it exists — so handing it out again is
    // not reuse. What must never happen is two *committed* sales sharing a
    // number, and that is enforced by UNIQUE (tenant_id, series_id,
    // invoice_number) on `sales`, which Task 8 creates and Task 16 exercises
    // against the live write path.
    const seriesId = await makeSeries(db, { tenantId: TENANT_A, tillId: TILL_A1, code: "FA" });
    const committed: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const abort = i % 2 === 0;
      await withTenant(db, TENANT_A, async (tx) => {
        const n = await allocateInvoiceNumber(tx, seriesId);
        if (abort) throw new Error("abort");
        committed.push(n);
      }).catch(() => undefined);
    }
    // Three commits, three consecutive numbers, no duplicates. The aborted
    // allocations left nothing behind and consumed nothing.
    expect(committed).toEqual([1, 2, 3]);
    expect(new Set(committed).size).toBe(committed.length);
  });

  it("allocates independently for two series on the same till", async () => {
    // One till, N series, one chain. The two counters must not interfere, and
    // neither may be derived from the other.
    const fa = await makeSeries(db, { tenantId: TENANT_A, tillId: TILL_A1, code: "FA" });
    const ra = await makeSeries(db, { tenantId: TENANT_A, tillId: TILL_A1, code: "RA" });
    const a1 = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, fa));
    const b1 = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, ra));
    const a2 = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, fa));
    expect([a1, b1, a2]).toEqual([1, 1, 2]);
  });

  it("allocates as the app role", async () => {
    // The application never runs as owner. If the column-scoped
    // GRANT UPDATE (next_number) is missing, allocation works in every test
    // that skips asAppUser and fails only in production — the exact shape of a
    // suite that asserts nothing.
    const seriesId = await makeSeries(db, { tenantId: TENANT_A, tillId: TILL_A1, code: "FA" });
    const n = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return allocateInvoiceNumber(tx, seriesId);
    });
    expect(n).toBe(1);
  });

  it("throws SERIES_NOT_FOUND for an unknown series", async () => {
    const error = await withTenant(db, TENANT_A, (tx) =>
      allocateInvoiceNumber(tx, UNKNOWN_SERIES),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("SERIES_NOT_FOUND");
    expect((error as AppError).params).toEqual({ seriesId: UNKNOWN_SERIES });
  });

  it("throws SERIES_NOT_FOUND for another tenant's series and consumes nothing", async () => {
    // RLS filters the row out of the UPDATE's target set, so zero rows are
    // updated and RETURNING yields nothing — the counter is never touched. A
    // cross-tenant probe therefore cannot advance B's numbering, which it
    // could if allocation read the row first and updated it afterwards.
    const seriesId = await makeSeries(db, { tenantId: TENANT_B, tillId: TILL_B1, code: "FB" });
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return allocateInvoiceNumber(tx, seriesId);
      }),
    ).rejects.toThrow(AppError);

    const legitimate = await withTenant(db, TENANT_B, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect(legitimate).toBe(1);
  });

  it.runIf(target.name === "postgres")(
    "hands out distinct numbers to twenty concurrent allocators",
    async () => {
      // PGlite cannot run this: concurrent queries serialise onto one backend,
      // so a read-then-write implementation passes there by accident. Running
      // it on PGlite would be worse than skipping it — a green result that
      // means nothing. Real Postgres only, per the Global Constraint.
      const seriesId = await makeSeries(db, { tenantId: TENANT_A, tillId: TILL_A1, code: "FA" });
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId)),
        ),
      );
      expect(new Set(results).size).toBe(20);
      expect(Math.min(...results)).toBe(1);
      expect(Math.max(...results)).toBe(20);
    },
  );
});
```

- [ ] **Step 3: Run each test individually and watch it fail**

The Global Constraint requires per-test red observation, not per-file. Run them one at a time:

```bash
cd packages/db
pnpm vitest run -t "holds several series on one till"
```

Expected: FAIL — `Failed to resolve import "./series.js"`.

```bash
pnpm vitest run -t "returns the number to the series when the transaction rolls back"
```

Expected: FAIL — `Failed to resolve import "./allocate-number.js"`.

Repeat for every test name above, confirming each fails on its own. A test that passes here is a defect in the test, not a head start.

- [ ] **Step 4: Write the schema and generate the migration**

`packages/db/src/schema/series.ts`:

```ts
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { tenants, tills } from "./tenants.js";

/**
 * Invoice numbering series.
 *
 * A till may own N series and has exactly ONE chain (findings §1). Nothing
 * here relates a series to a chain: no chain column, and deliberately no
 * unique constraint on (tenant_id, till_id), which would silently reimpose
 * one series per till.
 *
 * `next_number` is the live counter and the single source of truth: a plain
 * integer column, advanced in place by the allocating UPDATE under the row
 * lock that statement takes. There is no sequence and no second copy of the
 * value to drift out of step with it.
 *
 * Allocation is transactional, so a rollback returns the number and no gap
 * appears. That is correct — the regulation requires strictly-increasing and
 * never-reused numbering and permits gaps without requiring them. "Never
 * reused once used" is enforced on `sales` by
 * UNIQUE (tenant_id, series_id, invoice_number), not here.
 */
export const invoiceSeries = pgTable(
  "invoice_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    tillId: uuid("till_id")
      .notNull()
      .references(() => tills.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    purpose: text("purpose").notNull().default("standard"),
    nextNumber: integer("next_number").notNull().default(1),
  },
  (t) => [
    unique("invoice_series_till_code_key").on(t.tenantId, t.tillId, t.code),
    // Composite target for tenant-consistent foreign keys from `sales`: a
    // child row cannot point at a parent belonging to another tenant.
    unique("invoice_series_tenant_id_key").on(t.tenantId, t.id),
    index("invoice_series_tenant_idx").on(t.tenantId),
    // A CHECK rather than a pgEnum, deliberately: the permitted set depends on
    // asesor Q5(b), which is unverified. Widening a CHECK is one line of
    // migration; widening an enum needs ALTER TYPE.
    check("invoice_series_purpose_ck", sql`${t.purpose} in ('standard', 'rectificative')`),
    check("invoice_series_next_number_ck", sql`${t.nextNumber} >= 1`),
    check("invoice_series_code_ck", sql`${t.code} <> ''`),
  ],
).enableRLS();
```

Generate the structural migration:

```bash
cd packages/db
pnpm drizzle-kit generate --name invoice_series
```

Expected: a new `drizzle/0004_invoice_series.sql` plus an updated `meta/_journal.json`. The block below is appended to that same file rather than generated as a separate `--custom` migration, so the table is never present without its policy and grants — Task 5's "Who applies the pattern, and when".

- [ ] **Step 5: Append the rules to that same migration**

Drizzle has no support for `FORCE ROW LEVEL SECURITY`, policies or column-scoped grants, so this half is hand-written — appended to the generated file rather than created as a separate `--custom` migration, so the table never exists without its policy and grants. Handwritten SQL survives later `generate` runs because drizzle-kit diffs against its own snapshot, which has no concept of any of them.

Appended to `packages/db/drizzle/0004_invoice_series.sql`:

```sql
-- Tenant isolation. FORCE is required: without it the table owner bypasses the
-- policy, and migrations run as owner.
ALTER TABLE invoice_series FORCE ROW LEVEL SECURITY;

CREATE POLICY invoice_series_tenant_isolation ON invoice_series
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- nullif() matters: current_setting(..., true) yields '' when unset, and
-- ''::uuid raises rather than filtering. Comparing against NULL fails closed.

REVOKE ALL ON invoice_series FROM app_user;
GRANT SELECT, INSERT ON invoice_series TO app_user;

-- The one column the application may advance, and the only relaxation of
-- Task 5's blanket revocation anywhere in this plan. It is scoped to the
-- single column: the app role still cannot rewrite a series' code, purpose,
-- till or tenant. invoice_series is configuration, not a fiscal record —
-- nothing about it is under audit — so the immutability argument that governs
-- `sales` does not apply here. `sales` keeps its total revocation.
GRANT UPDATE (next_number) ON invoice_series TO app_user;
```

There is deliberately **no sequence, no trigger and no `SECURITY DEFINER` function** in this migration. An earlier draft created one sequence per series row from an `AFTER INSERT` trigger, in order to make the spec's "a crash before commit burns an invoice number" sentence literally true. That was overruled, and the reasons are worth recording because the idea is superficially attractive:

- It is **dynamic DDL on the insert path**. `CREATE SEQUENCE` runs inside whatever transaction inserts a series row, taking catalog locks that ordinary writes do not, and `DROP SEQUENCE` has to be chased on delete. Schema objects whose population grows with a table's row count also complicate `pg_dump` ordering and logical replication.
- It needs a `SECURITY DEFINER` function with a pinned `search_path` to execute that DDL as owner, which is a privilege-escalation surface — a real one, easy to get subtly wrong, and invisible when wrong because the suite stays green.
- It requires a uuid-to-identifier name-mangling function, a `GRANT` per sequence, and a second source of truth for a counter that already has a column.

All of that exists to buy a burned number instead of a returned one, and **the regulation does not ask for a burned number.** It asks for strictly-increasing and never-reused; gaps are permitted, not required. The spec sentence is the thing that is wrong, and Task 18 corrects it.

- [ ] **Step 6: Implement the allocator**

`packages/db/src/allocate-number.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Transaction } from "./client.js";
import { invoiceSeries } from "./schema/series.js";

/**
 * Allocates the next invoice number from a series.
 *
 * Strictly increasing, and never reused once used. One statement: the UPDATE
 * takes a row lock, so two concurrent allocators on the same series serialise
 * and the second re-evaluates `next_number + 1` against the first's committed
 * value. At READ COMMITTED that is exactly the semantics required — the
 * blocked statement re-reads the updated row rather than proceeding from its
 * stale snapshot.
 *
 * Allocation is transactional. A rollback returns the number, and the next
 * caller receives it again; no gap appears. This is correct rather than a
 * compromise: the regulation requires strictly-increasing and never-reused
 * numbering and PERMITS gaps without requiring them, and a number that was
 * allocated inside a transaction that aborted was never used — nothing was
 * recorded under it. The property that must hold, "no two committed sales
 * share a number", is enforced by UNIQUE (tenant_id, series_id,
 * invoice_number) on `sales`, which does not depend on this function being
 * correct.
 *
 * Deliberately NOT a per-series Postgres sequence. `nextval` would put the
 * counter outside transactional visibility and burn the number on rollback,
 * but a sequence per series row means CREATE SEQUENCE executed from a trigger
 * on every insert — dynamic DDL on the write path, plus a SECURITY DEFINER
 * function to run it — to buy a gap the regulation never asked for.
 *
 * A series filtered out by RLS is not in the UPDATE's target set, so zero rows
 * are updated and RETURNING yields nothing: a cross-tenant probe cannot
 * advance another tenant's numbering.
 */
export async function allocateInvoiceNumber(tx: Transaction, seriesId: string): Promise<number> {
  const updated = await tx
    .update(invoiceSeries)
    .set({ nextNumber: sql`${invoiceSeries.nextNumber} + 1` })
    .where(eq(invoiceSeries.id, seriesId))
    .returning({ allocated: invoiceSeries.nextNumber });

  const row = updated[0];
  if (row === undefined) {
    throw new AppError("SERIES_NOT_FOUND", { seriesId });
  }
  // RETURNING on an UPDATE yields the NEW row, so `next_number` has already
  // been incremented. The number this caller may use is therefore the one
  // before the increment.
  return row.allocated - 1;
}
```

Add the re-exports to `packages/db/src/index.ts`:

```ts
export { allocateInvoiceNumber } from "./allocate-number.js";
export { invoiceSeries } from "./schema/series.js";
```

- [ ] **Step 7: Run both suites**

```bash
cd packages/db
pnpm vitest run src/schema/series.test.ts src/allocate-number.test.ts
```

Expected: PASS. The concurrency test is reported as skipped on the `pglite` target and passing on the `postgres` target.

```bash
pnpm typecheck
```

Expected: typecheck passes with no output.

- [ ] **Step 8: Teeth check — break it and watch it scream**

Confirm these tests have teeth rather than merely executing the code.

Temporarily replace the body of `allocateInvoiceNumber` with the naive read-then-write — the implementation this task exists to reject:

```ts
const [series] = await tx
  .select({ next: invoiceSeries.nextNumber })
  .from(invoiceSeries)
  .where(eq(invoiceSeries.id, seriesId));
if (series === undefined) throw new AppError("SERIES_NOT_FOUND", { seriesId });
await tx
  .update(invoiceSeries)
  .set({ nextNumber: series.next + 1 })
  .where(eq(invoiceSeries.id, seriesId));
return series.next;
```

```bash
pnpm vitest run src/allocate-number.test.ts
```

Expected: FAIL — "hands out distinct numbers to twenty concurrent allocators", and **only on the postgres target**. On PGlite it passes, which is exactly why that test is gated: PGlite serialises every query onto one backend, so the stale read this mutation introduces never happens there.

This is the single most important mutation in the task, and note what it does *not* break. Every sequential test still passes, because a naive read-then-write is correct when nothing runs concurrently. A suite without the gated concurrency test would be entirely green against the implementation this task exists to reject.

Now temporarily change the allocator's `RETURNING` to yield the post-increment value — delete the `- 1`:

Expected: FAIL — "returns the starting number on the first allocation", "honours a starting number other than 1", "increases strictly across successive allocations" and "hands out no number twice across interleaved aborts and commits". An off-by-one here would hand out a number one higher than the series records, so the first invoice of a migrated venue would silently skip. Restore it.

Now temporarily delete the `GRANT UPDATE (next_number) ON invoice_series TO app_user` line and re-run migrations:

Expected: FAIL — "allocates as the app role", with `permission denied for table invoice_series`. Every other allocation test still passes, because they run as owner — which is precisely why that one test exists. Restore it.

Now temporarily widen that grant to `GRANT UPDATE ON invoice_series TO app_user` (all columns):

Expected: FAIL — the privilege introspection test asserting the app role may update `next_number` and nothing else. A blanket UPDATE would let the application rewrite a series' `code` or move it to another till, which is configuration the audit trail assumes is stable. Restore it.

Now temporarily add `unique("invoice_series_till_key").on(t.tenantId, t.tillId)` to the table definition and regenerate:

Expected: FAIL — "has no unique constraint on (tenant_id, till_id) alone" and "holds several series on one till". Restore it.

If any mutation leaves the suite green, a test is missing.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/schema/series.ts packages/db/src/schema/series.test.ts \
  packages/db/src/allocate-number.ts packages/db/src/allocate-number.test.ts \
  packages/db/src/index.ts packages/db/drizzle
git commit -m "feat(db): invoice series with strictly-increasing allocation

The counter is the next_number column, advanced by a single
UPDATE ... RETURNING under the row lock that statement takes. Allocation is
therefore transactional: a rollback returns the number and no gap appears.
That is correct. The regime requires numbering to be strictly increasing and
never reused, and it permits gaps without requiring them, so a returned number
satisfies it. Never-reused-once-used is enforced where it belongs, by
UNIQUE (tenant_id, series_id, invoice_number) on sales, which does not depend
on the allocator being right.

A per-series Postgres sequence was rejected. nextval would burn the number on
rollback and make the spec's wording literally true, but a sequence per series
ROW means CREATE SEQUENCE run from an insert trigger, a SECURITY DEFINER
function to execute that DDL, a GRANT per sequence and a name-mangling
function — dynamic DDL on the write path, to buy a gap nothing asks for. The
spec sentence is the defect, not the column; the doc correction is Task 18's.

The measured chain-append result does not transfer here. Chain append is a
read-compute-write over the predecessor huella, so the value it reads must
stay stable across the computation and it needs FOR UPDATE plus a unique
backstop. Allocation computes nothing over the value it reads, so one
statement does the whole job. Same-looking problem, different answer.

The app role gets GRANT UPDATE (next_number) and nothing wider — the one
relaxation of the blanket revocation anywhere in this plan, and scoped to a
single column because invoice_series is configuration rather than a fiscal
record. sales keeps its total revocation.

N series per till from day one, with nothing relating a series to a chain —
no chain column and no unique constraint on (tenant_id, till_id), which would
silently reimpose one series per till. Two introspection tests police that,
because both mistakes read as harmless schema."
```

---

## Task 7: `working_orders` and `working_order_lines` — the mutable half

The deliberate opposite of Task 8. An order is amended all evening and may end in nothing; a sale is written once and never touched. Conflating them means chaining drafts and rectifying records that were never real sales.

**Files:**

- Create: `packages/db/src/schema/orders.ts`
- Create: `packages/db/src/schema/orders.test.ts`
- Create: `packages/db/drizzle/0006_working_orders.sql` (generated, then **hand-extended** with the RLS and grant block — one migration, not two)
- Modify: `packages/db/src/index.ts` (re-export `workingOrders`, `workingOrderLines`)

**Interfaces:**

- Consumes: `tenants`, `locations`, `tills` from `./schema/tenants.js`; `withTenant` from `./tenancy.js`; `asAppUser` from `./testing/roles.js`; `describeEachTarget` from `./testing/harness.js`.
- Produces:
  - `workingOrders` — `id`, `tenant_id`, `till_id`, `status`, `opened_at`, `settled_at`
  - `workingOrderLines` — `id`, `tenant_id`, `working_order_id`, `line_no`, `descriptions`, `quantity`, `unit_price`, `vat_rate`, `line_total`

### Mutable by design — and what that means about Task 8

Architecture §6: "An open order is mutable — add a line, void it, change quantities, abandon it. A fiscal record is immutable, hash-chained, and comes into existence exactly once, at tender completion. **Two tables, one transition between them.**"

So this task does the reverse of Task 5's machinery. The application role keeps `SELECT`, `INSERT`, `UPDATE` and `DELETE` on both tables, and there is no immutability trigger. What replaces immutability is a **state machine enforced by the database**: an order is `open`, `settled` or `abandoned`, and only an `open` one may change. `settled` and `abandoned` are terminal. That is not the same guarantee as immutability — a settled order's row is still deletable by the owner — and it is not meant to be. The immutable record of what was sold is `sales`, written in the same transaction that settles the order. This table's job is to be safely amendable right up to the moment it is not.

`status` is a `pgEnum`, deliberately, and this is the contrast with Task 6's `purpose`: three values, settled by the spec, no open question hanging over them. One declaration yields both the TypeScript union and the database constraint, and an invented fourth value is a `22P02` from the driver rather than a row.

### Snapshotted values, and no catalogue anywhere

Architecture §6: "A sale records price, VAT rate and description **as at the moment of sale**, embedded in the record." The pleasant side effect is that a till running a stale catalogue is not a correctness problem — the catalogue needs to be *fresh*, not *synchronised*, which is a much weaker requirement to meet offline.

The catalogue is out of scope for this plan entirely, so the constraint here is negative and structural: **`working_order_lines` carries no reference to any catalogue entity.** No `product_id`, no `menu_item_id`, not even nullable "for reporting". Step 1 asserts that by introspection, because a nullable foreign key added later reads as a convenience and is in fact the mechanism by which a price change reaches back into a record that was supposed to be frozen.

`descriptions` is a jsonb locale→string map snapshotted at line-add time, holding **exactly** the venue's configured locales (spec §9). Exactly, not at least: a trigger compares the key set against `locations.invoice_locales` resolved through the till. A missing locale means a bilingual receipt with a blank half, and a locale nobody configured means dead weight travelling with every line forever. Both are cheap to reject at write time and expensive to find later.

- [ ] **Step 1: Write the failing tests**

`packages/db/src/schema/orders.test.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { describeEachTarget } from "../testing/harness.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { locations, tenants, tills } from "./tenants.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_B1 = "bbbbbbbb-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

async function seed(db: Database): Promise<void> {
  await db.insert(tenants).values([
    { id: TENANT_A, nif: "B00000000", legalName: "Fixture Tenant A" },
    { id: TENANT_B, nif: "B11111111", legalName: "Fixture Tenant B" },
  ]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      tenantId: TENANT_A,
      // Bilingual on purpose: a single-locale venue cannot detect a trigger
      // that checks "at least one locale" instead of "exactly these".
      name: "Fixture Location A",
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
    {
      id: LOCATION_B,
      tenantId: TENANT_B,
      name: "Fixture Location B",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([
    { id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" },
    { id: TILL_B1, tenantId: TENANT_B, locationId: LOCATION_B, name: "B1" },
  ]);
}

async function openOrder(db: Database, tenantId = TENANT_A, tillId = TILL_A1): Promise<string> {
  const [row] = await db
    .insert(workingOrders)
    .values({ tenantId, tillId, status: "open", openedAt: AT })
    .returning({ id: workingOrders.id });
  return row.id;
}

const LINE = {
  lineNo: 1,
  descriptions: { es: "Café solo", ca: "Cafè sol" },
  quantity: "1.000",
  unitPrice: "1.30",
  vatRate: "10.00",
  lineTotal: "1.30",
};

describeEachTarget("working_orders", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await db.execute(sql`truncate table tenants cascade`);
    await seed(db);
  });

  it("opens an order in the open state with no settled_at", async () => {
    const id = await openOrder(db);
    const [row] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(row.status).toBe("open");
    expect(row.settledAt).toBeNull();
  });

  it("rejects a status outside the enum", async () => {
    await expect(
      db.execute(
        sql`insert into working_orders (tenant_id, till_id, status, opened_at)
            values (${TENANT_A}::uuid, ${TILL_A1}::uuid, 'paid', ${AT}::timestamptz)`,
      ),
    ).rejects.toThrow(/invalid input value for enum working_order_status/);
  });

  it("amends an open order", async () => {
    // open → open is the ordinary case and must stay cheap: a table adds a
    // round of drinks four times before it asks for the bill.
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, tenantId: TENANT_A, workingOrderId: id });
    await db
      .insert(workingOrderLines)
      .values({ ...LINE, lineNo: 2, tenantId: TENANT_A, workingOrderId: id });
    await db
      .update(workingOrderLines)
      .set({ quantity: "2.000", lineTotal: "2.60" })
      .where(eq(workingOrderLines.workingOrderId, id));
    const found = await db
      .select({ total: workingOrderLines.lineTotal })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(found.map((r) => r.total)).toEqual(["2.60", "2.60"]);
  });

  it("settles an open order and stamps settled_at", async () => {
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    const [row] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(row.status).toBe("settled");
    expect(row.settledAt).not.toBeNull();
  });

  it("abandons an open order", async () => {
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    const [row] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(row.status).toBe("abandoned");
    expect(row.settledAt).toBeNull();
  });

  it("rejects settling without a settled_at", async () => {
    const id = await openOrder(db);
    await expect(
      db.update(workingOrders).set({ status: "settled" }).where(eq(workingOrders.id, id)),
    ).rejects.toThrow(/working_orders_settled_at_ck/);
  });

  it("rejects a settled_at on an order that is not settled", async () => {
    const id = await openOrder(db);
    await expect(
      db.update(workingOrders).set({ settledAt: AT }).where(eq(workingOrders.id, id)),
    ).rejects.toThrow(/working_orders_settled_at_ck/);
  });

  it("rejects settled → open", async () => {
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    await expect(
      db
        .update(workingOrders)
        .set({ status: "open", settledAt: null })
        .where(eq(workingOrders.id, id)),
    ).rejects.toThrow(/is settled and can no longer be modified/);
  });

  it("rejects settled → abandoned", async () => {
    // The illegal transitions are the ones worth testing. A state machine
    // tested only on its happy path is a comment.
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    await expect(
      db
        .update(workingOrders)
        .set({ status: "abandoned", settledAt: null })
        .where(eq(workingOrders.id, id)),
    ).rejects.toThrow(/is settled and can no longer be modified/);
  });

  it("rejects abandoned → open", async () => {
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    await expect(
      db.update(workingOrders).set({ status: "open" }).where(eq(workingOrders.id, id)),
    ).rejects.toThrow(/is abandoned and can no longer be modified/);
  });

  it("rejects abandoned → settled", async () => {
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    await expect(
      db
        .update(workingOrders)
        .set({ status: "settled", settledAt: AT })
        .where(eq(workingOrders.id, id)),
    ).rejects.toThrow(/is abandoned and can no longer be modified/);
  });

  it("rejects a no-op update of a settled order", async () => {
    // Terminal means terminal, not "terminal for the columns we thought of".
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    await expect(
      db.update(workingOrders).set({ tillId: TILL_A1 }).where(eq(workingOrders.id, id)),
    ).rejects.toThrow(/is settled and can no longer be modified/);
  });

  it("hides another tenant's order from the app role", async () => {
    await openOrder(db);
    await openOrder(db, TENANT_B, TILL_B1);
    const visible = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.select({ id: workingOrders.id }).from(workingOrders);
    });
    expect(visible).toHaveLength(1);
  });
});

describeEachTarget("working_order_lines", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await db.execute(sql`truncate table tenants cascade`);
    await seed(db);
  });

  it("adds a line to an open order", async () => {
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, tenantId: TENANT_A, workingOrderId: id });
    const found = await db.select().from(workingOrderLines);
    expect(found).toHaveLength(1);
    expect(found[0].descriptions).toEqual({ es: "Café solo", ca: "Cafè sol" });
  });

  it("rejects a duplicate line_no within an order", async () => {
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, tenantId: TENANT_A, workingOrderId: id });
    await expect(
      db.insert(workingOrderLines).values({ ...LINE, tenantId: TENANT_A, workingOrderId: id }),
    ).rejects.toThrow(/duplicate key value/);
  });

  it("rejects a line added to a settled order", async () => {
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    await expect(
      db.insert(workingOrderLines).values({ ...LINE, tenantId: TENANT_A, workingOrderId: id }),
    ).rejects.toThrow(/lines may only be written while the order is open/);
  });

  it("rejects a line added to an abandoned order", async () => {
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    await expect(
      db.insert(workingOrderLines).values({ ...LINE, tenantId: TENANT_A, workingOrderId: id }),
    ).rejects.toThrow(/lines may only be written while the order is open/);
  });

  it("rejects deleting a line from a settled order", async () => {
    // Deletion is the transition that would otherwise slip through: the
    // trigger has to cover DELETE, and OLD rather than NEW carries the id.
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, tenantId: TENANT_A, workingOrderId: id });
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    await expect(
      db.delete(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id)),
    ).rejects.toThrow(/lines may only be written while the order is open/);
  });

  it("rejects descriptions missing a configured locale", async () => {
    const id = await openOrder(db);
    await expect(
      db.insert(workingOrderLines).values({
        ...LINE,
        tenantId: TENANT_A,
        workingOrderId: id,
        descriptions: { es: "Café solo" },
      }),
    ).rejects.toThrow(/descriptions must carry exactly the venue locales/);
  });

  it("rejects descriptions carrying an unconfigured locale", async () => {
    const id = await openOrder(db);
    await expect(
      db.insert(workingOrderLines).values({
        ...LINE,
        tenantId: TENANT_A,
        workingOrderId: id,
        descriptions: { es: "Café solo", ca: "Cafè sol", en: "Black coffee" },
      }),
    ).rejects.toThrow(/descriptions must carry exactly the venue locales/);
  });

  it("keeps a line's descriptions when the venue's locales change afterwards", async () => {
    // The snapshot is the whole point. Re-rendering a line through a later
    // configuration would mean a receipt reprinted next year reads differently
    // from the one the customer took.
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, tenantId: TENANT_A, workingOrderId: id });
    await db
      .update(locations)
      .set({ invoiceLocales: ["es", "en"] })
      .where(eq(locations.id, LOCATION_A));
    const [line] = await db.select().from(workingOrderLines);
    expect(line.descriptions).toEqual({ es: "Café solo", ca: "Cafè sol" });
  });

  it("carries no reference to a catalogue", async () => {
    // Values are snapshotted, never referenced (architecture §6). The
    // catalogue is out of scope for this plan, and a nullable foreign key
    // added later "just for reporting" is exactly how a price change reaches
    // back into a record that was supposed to be frozen.
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns
           where table_name = 'working_order_lines'`,
    );
    const offenders = cols
      .map((c) => c.column_name)
      .filter((n) => /(product|item|catalogue|catalog|menu|sku|variant)_id$/i.test(n));
    expect(offenders).toEqual([]);
  });

  it("stores every monetary column as numeric(12, 2)", async () => {
    const cols = await rows<{
      column_name: string;
      data_type: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(
      db,
      sql`select column_name, data_type, numeric_precision, numeric_scale
            from information_schema.columns
           where table_name = 'working_order_lines'
             and column_name in ('unit_price', 'line_total')`,
    );
    expect(cols).toHaveLength(2);
    for (const col of cols) {
      expect(col.data_type).toBe("numeric");
      expect(col.numeric_precision).toBe(12);
      expect(col.numeric_scale).toBe(2);
    }
  });

  it("rejects a line whose tenant differs from its order's", async () => {
    const id = await openOrder(db);
    await expect(
      db.insert(workingOrderLines).values({ ...LINE, tenantId: TENANT_B, workingOrderId: id }),
    ).rejects.toThrow(/violates foreign key constraint/);
  });
});
```

- [ ] **Step 2: Run each test individually and watch it fail**

Expected: FAIL — unresolved import `./orders.js`.

Run each `-t "<name>"` in turn. A test that passes here is a defect in the test.

- [ ] **Step 3: Write the schema and generate the migration**

`packages/db/src/schema/orders.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants, tills } from "./tenants.js";

/**
 * A pgEnum rather than a text CHECK, deliberately: unlike invoice_series.purpose
 * these three values are settled by the spec, and one declaration yields both
 * the TypeScript union and the database constraint.
 */
export const workingOrderStatus = pgEnum("working_order_status", [
  "open",
  "settled",
  "abandoned",
]);

/**
 * A working order is MUTABLE — the deliberate opposite of `sales`. Lines are
 * added, amended and removed all evening, and the order may end in nothing at
 * all. Two tables, one transition between them (architecture §6): conflating
 * them means chaining drafts and rectifying records that were never sales.
 *
 * What replaces immutability here is a state machine the database enforces:
 * `settled` and `abandoned` are terminal, and only an `open` order may change.
 */
export const workingOrders = pgTable(
  "working_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    tillId: uuid("till_id")
      .notNull()
      .references(() => tills.id, { onDelete: "restrict" }),
    status: workingOrderStatus("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    unique("working_orders_tenant_id_key").on(t.tenantId, t.id),
    index("working_orders_tenant_status_idx").on(t.tenantId, t.status),
    // Biconditional, not two one-way checks: a settled order always carries a
    // timestamp and a non-settled one never does.
    check(
      "working_orders_settled_at_ck",
      sql`(${t.status} = 'settled') = (${t.settledAt} is not null)`,
    ),
  ],
).enableRLS();

/**
 * Snapshotted values, never catalogue references (architecture §6). There is
 * deliberately no product or menu-item column: a stale catalogue is then not a
 * correctness problem, only a freshness one.
 *
 * `descriptions` is a locale→string map holding EXACTLY the venue's configured
 * locales (spec §9), checked by trigger against locations.invoice_locales.
 */
export const workingOrderLines = pgTable(
  "working_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workingOrderId: uuid("working_order_id").notNull(),
    lineNo: integer("line_no").notNull(),
    descriptions: jsonb("descriptions").$type<Record<string, string>>().notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull(),
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [
    // Composite FK: a line cannot point at an order belonging to another
    // tenant, independently of whether RLS is in force on this connection.
    foreignKey({
      columns: [t.tenantId, t.workingOrderId],
      foreignColumns: [workingOrders.tenantId, workingOrders.id],
      name: "working_order_lines_order_fk",
    }).onDelete("cascade"),
    unique("working_order_lines_line_no_key").on(t.workingOrderId, t.lineNo),
    index("working_order_lines_order_idx").on(t.workingOrderId),
    check("working_order_lines_quantity_ck", sql`${t.quantity} <> 0`),
    check("working_order_lines_vat_rate_ck", sql`${t.vatRate} >= 0 and ${t.vatRate} <= 100`),
    check("working_order_lines_line_no_ck", sql`${t.lineNo} >= 1`),
  ],
).enableRLS();
```

```bash
cd packages/db
pnpm drizzle-kit generate --name working_orders
```

Expected: a new `drizzle/0006_working_orders.sql`. The block below is appended to that same file rather than generated separately, for the reason Task 5 gives.

- [ ] **Step 4: Append the rules to that same migration**

Hand-written and appended to the generated file rather than created as a separate `--custom` migration, so the tables never exist without their policies and grants.

Appended to `packages/db/drizzle/0006_working_orders.sql`:

```sql
ALTER TABLE working_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE working_order_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY working_orders_tenant_isolation ON working_orders
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY working_order_lines_tenant_isolation ON working_order_lines
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- MUTABLE, deliberately. Unlike sales/sale_lines/tenders these keep UPDATE and
-- DELETE: an order is amended all evening and may end in nothing.
REVOKE ALL ON working_orders FROM app_user;
REVOKE ALL ON working_order_lines FROM app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON working_orders TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON working_order_lines TO app_user;

-- settled and abandoned are terminal states.
CREATE FUNCTION working_orders_enforce_transition()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'working order % is % and can no longer be modified', OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER working_orders_enforce_transition
  BEFORE UPDATE ON working_orders
  FOR EACH ROW EXECUTE FUNCTION working_orders_enforce_transition();

-- Lines may only be written while the parent order is open. Covers DELETE too,
-- which is the transition that would otherwise slip past.
CREATE FUNCTION working_order_lines_require_open_parent()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  parent_id uuid := coalesce(NEW.working_order_id, OLD.working_order_id);
  parent_status working_order_status;
BEGIN
  SELECT status INTO parent_status FROM working_orders WHERE id = parent_id;
  IF parent_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'lines may only be written while the order is open (order % is %)',
      parent_id, coalesce(parent_status::text, 'missing');
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE TRIGGER working_order_lines_require_open_parent
  BEFORE INSERT OR UPDATE OR DELETE ON working_order_lines
  FOR EACH ROW EXECUTE FUNCTION working_order_lines_require_open_parent();

-- descriptions must hold EXACTLY the venue's configured locales (spec §9).
CREATE FUNCTION working_order_lines_check_locales()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  configured text[];
  supplied text[];
BEGIN
  SELECT l.invoice_locales INTO configured
    FROM working_orders wo
    JOIN tills t ON t.id = wo.till_id
    JOIN locations l ON l.id = t.location_id
   WHERE wo.id = NEW.working_order_id;

  IF configured IS NULL THEN
    RAISE EXCEPTION 'working order % has no resolvable location', NEW.working_order_id;
  END IF;

  SELECT array_agg(k ORDER BY k) INTO supplied
    FROM jsonb_object_keys(NEW.descriptions) AS k;

  IF supplied IS DISTINCT FROM (SELECT array_agg(c ORDER BY c) FROM unnest(configured) AS c) THEN
    RAISE EXCEPTION
      'descriptions must carry exactly the venue locales % (got %)', configured, supplied;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER working_order_lines_check_locales
  BEFORE INSERT OR UPDATE ON working_order_lines
  FOR EACH ROW EXECUTE FUNCTION working_order_lines_check_locales();
```

The locale trigger reads `locations` on the caller's connection, so it runs under RLS as `app_user`. That is correct here rather than a fail-open: the location is always in the caller's own tenant, reached through the order's till, and a location the caller cannot see is a location the order could not have referenced. Contrast the deferred tender check in Task 8, which must be `SECURITY DEFINER` because a row it cannot see would make it pass silently.

Add the re-exports to `packages/db/src/index.ts`:

```ts
export { workingOrderLines, workingOrders, workingOrderStatus } from "./schema/orders.js";
```

- [ ] **Step 5: Run the suite**

```bash
cd packages/db
pnpm vitest run src/schema/orders.test.ts
```

Expected: PASS on both targets.

- [ ] **Step 6: Teeth check — break it and watch it scream**

Confirm these tests have teeth rather than merely executing the code.

Temporarily change the transition trigger's guard from `OLD.status <> 'open'` to `OLD.status = 'abandoned'`:

```bash
pnpm vitest run src/schema/orders.test.ts
```

Expected: FAIL — "rejects settled → open", "rejects settled → abandoned" and "rejects a no-op update of a settled order". The abandoned-side tests still pass, which is what makes the mutation worth running: a one-sided guard looks correct from half the suite. Restore it.

Now temporarily drop `OR DELETE` from the `working_order_lines_require_open_parent` trigger:

Expected: FAIL — "rejects deleting a line from a settled order", and that test alone. Restore it.

Now temporarily weaken the locale comparison to `NOT (supplied <@ configured)` — "every supplied locale is configured", the plausible wrong rule:

Expected: FAIL — "rejects descriptions missing a configured locale". "rejects descriptions carrying an unconfigured locale" still passes. A blank half on a bilingual receipt is precisely what that weakening ships. Restore it.

Now temporarily add `productId: uuid("product_id")` to `workingOrderLines` and regenerate:

Expected: FAIL — "carries no reference to a catalogue". Restore it.

Now temporarily change the biconditional check to `${t.status} <> 'settled' or ${t.settledAt} is not null`:

Expected: FAIL — "rejects a settled_at on an order that is not settled". Restore it.

If any mutation leaves the suite green, a test is missing.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/orders.ts packages/db/src/schema/orders.test.ts \
  packages/db/src/index.ts packages/db/drizzle
git commit -m "feat(db): mutable working orders with a database-enforced state machine

Working orders are the deliberate opposite of sales. They keep UPDATE and
DELETE for the application role and have no immutability trigger, because an
order is amended all evening and may end in nothing. What replaces
immutability is a state machine the database enforces: settled and abandoned
are terminal, and a trigger rejects any update of a non-open order rather
than just the status column, so the guarantee does not depend on remembering
which columns matter.

Lines carry snapshotted values and no catalogue reference at all. That is
asserted by introspection rather than by review, because a nullable
product_id added later reads as a reporting convenience and is in fact the
mechanism by which a price change reaches back into a frozen record.

descriptions must hold exactly the venue's configured locales, not at least
them. A missing locale is a blank half on a bilingual receipt and an extra
one is dead weight carried forever; both are cheap to reject at write time
and expensive to find afterwards."
```

---

## Task 8: `sales`, `sale_lines` and `tenders` — the immutable commercial record

The commercial half of what a completed sale is, written once when the last tender settles and never touched again. Contains the plan's sharpest conflict: `sales` is declared immutable and also carries a column that must change.

**Files:**

- Create: `packages/db/src/schema/sales.ts`
- Create: `packages/db/src/schema/sales.test.ts`
- Create: `packages/db/drizzle/0008_sales.sql` (generated, then **hand-extended** with the protection block — one migration, not two; see Task 5's "Who applies the pattern, and when")
- Modify: `packages/db/src/index.ts` (re-export `sales`, `saleLines`, `tenders`)

**Interfaces:**

- Consumes: `tenants`, `locations`, `tills` from `./schema/tenants.js`; `invoiceSeries` from `./schema/series.js`; `withTenant`, `asAppUser`, `describeEachTarget` as in Tasks 6 and 7.
- Produces:
  - `sales` — `id`, `tenant_id`, `till_id`, `series_id`, `invoice_number`, `issued_at`, `issued_offset_minutes`, `total`, `tip_amount`, `amount_charged`, `locale`, `invoice_locales`, `fiscal_backend`, `fiscal_state`
  - `saleLines` — `id`, `tenant_id`, `sale_id`, `line_no`, `descriptions`, `quantity`, `unit_price`, `vat_rate`, `line_total`
  - `tenders` — `id`, `tenant_id`, `sale_id`, `method`, `amount`, `settled_at`

### Three amounts, and what conflating them costs

`total`, `tip_amount` and `amount_charged` are distinct columns and the difference is not presentational. `total` is the invoice: taxable base plus VAT, and the figure the fiscal record reports to AEAT. `tip_amount` is non-taxable and appears in no fiscal record at all — Veri\*Factu reports sales, not tips. `amount_charged` is what actually hit the payment instruments, `total + tip_amount`, and it is the figure that must reconcile against the acquirer's settlement file.

Fold the tip into `total` and the venue declares turnover it did not have and owes VAT on a gratuity — architecture §10 is explicit that a mandatory service charge flips into taxable turnover, which is exactly the shape a folded tip fabricates. Fold `amount_charged` into `total` instead and card reconciliation breaks silently every time anyone tips: the acquirer's figure and the invoice's figure differ by an amount nothing in the system records. And because the tip's withholding treatment depends on the tenant's distribution model — direct-to-employee versus pooled *bote*, with different IRPF and Social Security consequences — the attribution has to be in the data from the start even though the payroll export is a later phase.

`CHECK (amount_charged = total + tip_amount)` holds the three together at the database. If a future requirement genuinely breaks that identity — cash rounding, a partial refund shape — the check failing is the correct outcome, because it means the model needs a fourth number rather than a quiet re-interpretation of an existing one.

### `fiscal_backend` and `fiscal_state` — redundant, and worth it

Spec §6 puts both on `sales`, written by the module in the same transaction, and calls them strictly redundant. The redundancy buys two things. It keeps the **foreign key pointing module→core**: `registros_facturacion.sale_id` references `sales`, and nothing in `packages/db` references a module table. Reverse that and the generic package cannot be migrated, queried or reasoned about without the Veri\*Factu module present, which defeats the layering the whole plan rests on. And it means a **Z-report needs no cross-boundary join per row** — the end-of-day totals and the art. 16.4 count of unsent records both come off `sales` alone, rather than joining every row to a module table that may not exist in a non-Spanish deployment.

`fiscal_backend` is free text holding the module's identifier, not an enum: `packages/db` must not enumerate the regimes it may one day serve.

**`fiscal_state` is written once, at insert, and never updated.** Its values are `recorded` and `not_applicable` — the classification **at issuance**. There is no `GRANT UPDATE` on it, no partial-update trigger, and no state machine.

An earlier draft of this task read the column as submission progress — `pending` → `submitted` → `accepted` | `rejected` — and resolved the resulting conflict with `sales` being immutable by granting column-scoped `UPDATE (fiscal_state)` plus an immutability trigger comparing `to_jsonb(NEW) - 'fiscal_state'` against `to_jsonb(OLD) - 'fiscal_state'`. That was overruled, and the reasoning is worth keeping because the conflict it tried to solve is real — it was just already solved elsewhere:

- **Spec §3 puts submission state in the `envios` sidecar precisely BECAUSE it mutates constantly.** `estado`, `intentos`, `proximo_intento_en`, `csv`, `codigo_error` all move for hours after the sale commits, and an immutable table cannot hold them. Duplicating a projection of that state onto `sales` reintroduces exactly the mutability §3 designed out, and creates a second copy that can disagree with the first.
- **The till reads submission state through `FiscalBackend.pendingCount`**, not by reading `sales`. That is the whole point of the method existing — the count of unsent records stays inside the module, so a non-Spanish deployment has no `envios` table and no missing column.
- **Spec §6's stated benefit is only that a Z-report needs no cross-boundary join per row**, and at-issuance state delivers that in full. A Z-report asks "what was sold, and is it on the legal record?" — which `recorded` answers — not "has AEAT acknowledged it yet?", which is an operational question with its own screen and its own freshness requirements.
- **A void does not move it either.** Voids are appended to `sale_voids` (Task 17), never written by mutating `sales`.

So the conflict dissolves: nothing needs to update this column, and the table keeps its total revocation. The failure mode the earlier draft correctly worried about — granting table-wide `UPDATE` and letting the application rewrite a chained sale's total, while the suite stays green because the immutability trigger catches only the owner path — is avoided by granting no `UPDATE` at all.

### The record exists when all tenders settle

Spec §4: the fiscal record is created when **all** tenders settle, not per payment. Split tender means several payments against one invoice, so a per-payment record is structurally wrong; and a card declined mid-tender must leave the order open and retryable with nothing chained, because the alternative chains records for sales that never happened, correctable only by rectificativas.

The tables make that shape natural rather than merely permitted. A `DEFERRABLE INITIALLY DEFERRED` constraint trigger checks at **commit** that the tender rows sum exactly to `amount_charged`. A half-tendered sale therefore cannot be committed at all: the declined card aborts the transaction, the sale never exists, the working order is untouched and still open. Nothing needs to remember to roll anything back. The write path that drives this is Task 16; this task only makes the wrong shape impossible to persist.

### Monetary columns and the float that must never appear

Every monetary column is `numeric(12, 2)`. The structural test asserts that by introspection over an explicit column list, and the behavioural test uses values chosen to discriminate: `0.10`, `0.20` and `0.70` are not exactly representable in binary64, so summing them under `double precision` yields `0.9999999999999999` rather than `1.00`. A fixture of `10.50` or `2.25` would prove nothing — both round-trip through a float unchanged, which is the vacuous-fixture shape this project has already shipped seven times.

- [ ] **Step 1: Write the failing tests**

`packages/db/src/schema/sales.test.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { describeEachTarget } from "../testing/harness.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { invoiceSeries } from "./series.js";
import { saleLines, sales, tenders } from "./sales.js";
import { locations, tenants, tills } from "./tenants.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_B1 = "bbbbbbbb-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

let seriesA = "";
let seriesB = "";

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

async function seed(db: Database): Promise<void> {
  await db.insert(tenants).values([
    { id: TENANT_A, nif: "B00000000", legalName: "Fixture Tenant A" },
    { id: TENANT_B, nif: "B11111111", legalName: "Fixture Tenant B" },
  ]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      tenantId: TENANT_A,
      name: "Fixture Location A",
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
    {
      id: LOCATION_B,
      tenantId: TENANT_B,
      name: "Fixture Location B",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([
    { id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" },
    { id: TILL_B1, tenantId: TENANT_B, locationId: LOCATION_B, name: "B1" },
  ]);
  const [a] = await db
    .insert(invoiceSeries)
    .values({ tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  const [b] = await db
    .insert(invoiceSeries)
    .values({ tenantId: TENANT_B, tillId: TILL_B1, code: "FB", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  seriesA = a.id;
  seriesB = b.id;
}

function saleValues(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_A,
    tillId: TILL_A1,
    seriesId: seriesA,
    invoiceNumber: 1,
    issuedAt: AT,
    issuedOffsetMinutes: 120,
    total: "1.00",
    tipAmount: "0.50",
    amountCharged: "1.50",
    locale: "es",
    invoiceLocales: ["es", "ca"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded" as const,
    ...overrides,
  };
}

/**
 * Writes a complete sale — header, lines and covering tenders — in one
 * transaction, because the deferred constraint trigger only permits that
 * shape. Every test that needs a sale on disk goes through here.
 */
async function recordCompleteSale(
  db: Database,
  overrides: Record<string, unknown> = {},
  tenderRows: { method: "cash" | "card"; amount: string }[] = [
    { method: "card", amount: "1.50" },
  ],
): Promise<string> {
  return db.transaction(async (tx) => {
    const [sale] = await tx
      .insert(sales)
      .values(saleValues(overrides))
      .returning({ id: sales.id });
    await tx.insert(saleLines).values({
      tenantId: (overrides.tenantId as string) ?? TENANT_A,
      saleId: sale.id,
      lineNo: 1,
      descriptions: { es: "Café solo", ca: "Cafè sol" },
      quantity: "1.000",
      unitPrice: "1.00",
      vatRate: "10.00",
      lineTotal: "1.00",
    });
    await tx.insert(tenders).values(
      tenderRows.map((t) => ({
        tenantId: (overrides.tenantId as string) ?? TENANT_A,
        saleId: sale.id,
        method: t.method,
        amount: t.amount,
        settledAt: AT,
      })),
    );
    return sale.id;
  });
}

describeEachTarget("sales — the commercial record", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await db.execute(sql`truncate table tenants cascade`);
    await seed(db);
  });

  it("keeps total, tip_amount and amount_charged as three distinct values", async () => {
    const id = await recordCompleteSale(db);
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(row.total).toBe("1.00");
    expect(row.tipAmount).toBe("0.50");
    expect(row.amountCharged).toBe("1.50");
  });

  it("rejects an amount_charged that is not total plus tip", async () => {
    // Folding the tip into total would declare turnover the venue did not
    // have and owe VAT on a gratuity; folding amount_charged into total
    // breaks card reconciliation every time anyone tips.
    await expect(recordCompleteSale(db, { amountCharged: "1.00" })).rejects.toThrow(
      /sales_amount_charged_ck/,
    );
  });

  it("rejects a negative tip", async () => {
    await expect(
      recordCompleteSale(db, { tipAmount: "-0.50", amountCharged: "0.50" }, [
        { method: "card", amount: "0.50" },
      ]),
    ).rejects.toThrow(/sales_tip_amount_ck/);
  });

  it("rejects a duplicate invoice number within a series", async () => {
    // findings §1: records are identified by issuer + serie&número + date, and
    // AEAT returns error 3000 on a duplicate. The database refuses first.
    await recordCompleteSale(db);
    await expect(recordCompleteSale(db)).rejects.toThrow(/duplicate key value/);
  });

  it("permits the same invoice number in two different series", async () => {
    const [other] = await db
      .insert(invoiceSeries)
      .values({ tenantId: TENANT_A, tillId: TILL_A1, code: "RA", purpose: "rectificative" })
      .returning({ id: invoiceSeries.id });
    await recordCompleteSale(db);
    const second = await recordCompleteSale(db, { seriesId: other.id });
    expect(second).toBeTruthy();
  });

  it("stores every monetary column as numeric(12, 2)", async () => {
    const cols = await rows<{
      table_name: string;
      column_name: string;
      data_type: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(
      db,
      sql`select table_name, column_name, data_type, numeric_precision, numeric_scale
            from information_schema.columns
           where (table_name = 'sales'
                    and column_name in ('total', 'tip_amount', 'amount_charged'))
              or (table_name = 'sale_lines' and column_name in ('unit_price', 'line_total'))
              or (table_name = 'tenders' and column_name = 'amount')`,
    );
    expect(cols).toHaveLength(6);
    for (const col of cols) {
      expect(col.data_type).toBe("numeric");
      expect(col.numeric_precision).toBe(12);
      expect(col.numeric_scale).toBe(2);
    }
  });

  it("sums line totals exactly, with no float drift", async () => {
    // 0.10, 0.20 and 0.70 are not exactly representable in binary64: under
    // double precision this sum is 0.9999999999999999. A fixture of 10.50 or
    // 2.25 would pass under either type and prove nothing.
    const id = await db.transaction(async (tx) => {
      const [sale] = await tx
        .insert(sales)
        .values(saleValues({ total: "1.00", tipAmount: "0.00", amountCharged: "1.00" }))
        .returning({ id: sales.id });
      await tx.insert(saleLines).values(
        ["0.10", "0.20", "0.70"].map((amount, i) => ({
          tenantId: TENANT_A,
          saleId: sale.id,
          lineNo: i + 1,
          descriptions: { es: "Línea", ca: "Línia" },
          quantity: "1.000",
          unitPrice: amount,
          vatRate: "10.00",
          lineTotal: amount,
        })),
      );
      await tx.insert(tenders).values({
        tenantId: TENANT_A,
        saleId: sale.id,
        method: "cash",
        amount: "1.00",
        settledAt: AT,
      });
      return sale.id;
    });

    const [summed] = await rows<{ total: string }>(
      db,
      sql`select sum(line_total)::text as total from sale_lines where sale_id = ${id}::uuid`,
    );
    expect(summed.total).toBe("1.00");
  });

  it("returns monetary values as strings, not JS numbers", async () => {
    // node-postgres renders numeric as a string precisely so no value passes
    // through binary64. A registered type parser that "helpfully" converts to
    // Number would reintroduce the drift with nothing else changing.
    const id = await recordCompleteSale(db);
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(typeof row.total).toBe("string");
    expect(typeof row.amountCharged).toBe("string");
  });

  it("stores issued_at with its offset alongside", async () => {
    // UTC plus offset, never a formatted local time. The offset is what makes
    // a receipt reprinted from another timezone still read 21:20.
    const id = await recordCompleteSale(db, { issuedOffsetMinutes: 120 });
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(row.issuedOffsetMinutes).toBe(120);
  });
});

describeEachTarget("sales — locale snapshot", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await db.execute(sql`truncate table tenants cascade`);
    await seed(db);
  });

  it("snapshots the ordered invoice_locales as at issuance", async () => {
    const id = await recordCompleteSale(db);
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(row.invoiceLocales).toEqual(["es", "ca"]);
  });

  it("does not change an existing sale when locations.invoice_locales changes", async () => {
    // Spec §9: a receipt reprinted a year later must read identically to the
    // one the customer took, and rectificativas inherit the ORIGINAL list.
    // Reading through locations at print time would break both.
    const id = await recordCompleteSale(db);
    await db
      .update(locations)
      .set({ invoiceLocales: ["en"] })
      .where(eq(locations.id, LOCATION_A));
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(row.invoiceLocales).toEqual(["es", "ca"]);
    expect(row.locale).toBe("es");
  });

  it("preserves locale order, not just membership", async () => {
    // Two locales means both languages on the same invoice rendered in that
    // order. A set-valued snapshot would render Catalan first half the time.
    const id = await recordCompleteSale(db, { invoiceLocales: ["ca", "es"], locale: "ca" });
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(row.invoiceLocales).toEqual(["ca", "es"]);
  });

  it("rejects a locale that is not in the snapshot", async () => {
    await expect(recordCompleteSale(db, { locale: "en" })).rejects.toThrow(
      /sales_locale_member_ck/,
    );
  });

  it("rejects more than two invoice locales", async () => {
    await expect(
      recordCompleteSale(db, { invoiceLocales: ["es", "ca", "en"] }),
    ).rejects.toThrow(/sales_invoice_locales_ck/);
  });
});

describeEachTarget("sales — tender coverage", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await db.execute(sql`truncate table tenants cascade`);
    await seed(db);
  });

  it("accepts a split tender covering the amount across two rows", async () => {
    const id = await recordCompleteSale(db, {}, [
      { method: "cash", amount: "1.00" },
      { method: "card", amount: "0.50" },
    ]);
    const found = await db.select().from(tenders).where(eq(tenders.saleId, id));
    expect(found).toHaveLength(2);
  });

  it("refuses to commit a sale whose tenders fall short", async () => {
    // The declined-card shape. The sale cannot exist half-tendered, so a
    // failure mid-tender leaves the working order open and retryable with
    // nothing written and nothing chained — spec §4.
    await expect(
      recordCompleteSale(db, {}, [{ method: "card", amount: "1.00" }]),
    ).rejects.toThrow(/tenders for sale .* total 1.00 but amount_charged is 1.50/);
  });

  it("refuses to commit a sale with no tenders at all", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(sales).values(saleValues());
      }),
    ).rejects.toThrow(/but amount_charged is 1.50/);
  });

  it("refuses to commit tenders exceeding the amount charged", async () => {
    await expect(
      recordCompleteSale(db, {}, [
        { method: "cash", amount: "1.00" },
        { method: "card", amount: "1.00" },
      ]),
    ).rejects.toThrow(/total 2.00 but amount_charged is 1.50/);
  });
});

describeEachTarget("sales — immutability as the app role", (target) => {
  let db: Database;
  let saleId = "";

  beforeEach(async () => {
    db = await target.create();
    await db.execute(sql`truncate table tenants cascade`);
    await seed(db);
    saleId = await recordCompleteSale(db);
  });

  it("refuses to update a sale's total as the app role", async () => {
    // Never run this as the owner. The owner bypasses RLS, can disable the
    // trigger, and here would also hold table-wide UPDATE — a green result
    // proving nothing whatsoever.
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.update(sales).set({ total: "999.00" }).where(eq(sales.id, saleId));
      }),
    ).rejects.toThrow(/permission denied for table sales|column "total" of relation "sales"/);
  });

  it("refuses to delete a sale as the app role", async () => {
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.delete(sales).where(eq(sales.id, saleId));
      }),
    ).rejects.toThrow(/permission denied for table sales/);
  });

  it("refuses to truncate sales as the app role", async () => {
    // A row trigger does not fire on TRUNCATE, so TRUNCATE walks straight
    // through an immutability trigger unless it is separately stopped.
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.execute(sql`truncate table immutability_probe cascade`);
      }),
    ).rejects.toThrow(/permission denied for table sales/);
  });

  it("refuses to update or delete a sale line as the app role", async () => {
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.update(saleLines).set({ lineTotal: "999.00" });
      }),
    ).rejects.toThrow(/permission denied for table sale_lines/);
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.delete(saleLines);
      }),
    ).rejects.toThrow(/permission denied for table sale_lines/);
  });

  it("refuses to update or delete a tender as the app role", async () => {
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.update(tenders).set({ amount: "999.00" });
      }),
    ).rejects.toThrow(/permission denied for table tenders/);
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.delete(tenders);
      }),
    ).rejects.toThrow(/permission denied for table tenders/);
  });

  it("stops the owner too, via the trigger backstop", async () => {
    // The grants stop the application; the trigger stops the owner. Both are
    // needed, and only this test distinguishes them — every app-role test
    // above would still pass with no trigger at all.
    //
    // Asserted on SQLSTATE WT001 rather than on the message, because the
    // message comes from the shared reject_mutation() and improving its
    // wording must not turn this red. Task 5 makes the same argument.
    const update = await captureError(() =>
      db.update(sales).set({ total: "999.00" }).where(eq(sales.id, saleId)),
    );
    expect(pgErrorCode(update)).toBe("WT001");
    expect(String(update)).toMatch(/sales is append-only: UPDATE is not permitted/);

    const remove = await captureError(() => db.delete(sales).where(eq(sales.id, saleId)));
    expect(pgErrorCode(remove)).toBe("WT001");
  });

  it("stops the owner truncating any of the three tables", async () => {
    // Closes the hole Step 6 used to leave open: the app role has no TRUNCATE
    // privilege, so without an owner-path test the statement triggers are
    // shadowed by the grant and nothing covers them.
    for (const table of ["sales", "sale_lines", "tenders"] as const) {
      const error = await captureError(() =>
        db.execute(sql`truncate table ${sql.identifier(table)}`),
      );
      expect(pgErrorCode(error)).toBe("WT001");
      expect(String(error)).toMatch(/TRUNCATE is not permitted/);
    }
  });

  it("hides another tenant's sale from the app role", async () => {
    await recordCompleteSale(db, {
      tenantId: TENANT_B,
      tillId: TILL_B1,
      seriesId: seriesB,
      invoiceLocales: ["es"],
      locale: "es",
    });
    const visible = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.select({ id: sales.id }).from(sales);
    });
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe(saleId);
  });

  it("carries no reference to a catalogue on sale_lines", async () => {
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'sale_lines'`,
    );
    const offenders = cols
      .map((c) => c.column_name)
      .filter((n) => /(product|item|catalogue|catalog|menu|sku|variant)_id$/i.test(n));
    expect(offenders).toEqual([]);
  });
});

describeEachTarget("sales — fiscal_state", (target) => {
  let db: Database;
  let saleId = "";

  beforeEach(async () => {
    db = await target.create();
    await db.execute(sql`truncate table tenants cascade`);
    await seed(db);
    saleId = await recordCompleteSale(db);
  });

  it("records fiscal_backend and fiscal_state in the same transaction as the sale", async () => {
    const [row] = await db.select().from(sales).where(eq(sales.id, saleId));
    expect(row.fiscalBackend).toBe("verifactu");
    // The state AT ISSUANCE: the legally-required record exists locally, which
    // in Spain is the point at which the sale is compliant, regardless of
    // whether anything has been sent anywhere yet.
    expect(row.fiscalState).toBe("recorded");
  });

  it("refuses an UPDATE of fiscal_state as the app role", async () => {
    // MUST run as app_user. As the owner this would be caught by the trigger
    // instead, which proves nothing about the control: the owner can
    // ALTER TABLE ... DISABLE TRIGGER, and the application is never the owner.
    // 42501 insufficient_privilege is the assertion that matters here.
    const error = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        await tx.update(sales).set({ fiscalState: "not_applicable" }).where(eq(sales.id, saleId));
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");

    const [row] = await db.select().from(sales).where(eq(sales.id, saleId));
    expect(row.fiscalState).toBe("recorded");
  });

  it("holds no submission state, so there is nothing on it to advance", async () => {
    // Spec §3 puts submission state on the envios sidecar precisely because it
    // mutates constantly and this table cannot be updated. A column named for
    // sending, acknowledging or retrying reappearing here is the regression
    // this test exists to catch — it would have to be mutable, and nothing
    // here is.
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'sales'`,
    );
    const offenders = cols
      .map((c) => c.column_name)
      .filter((n) => /(sent|submitted|acked|acknowledged|attempt|retry|csv|error)/i.test(n));
    expect(offenders).toEqual([]);
  });

  it("permits exactly two fiscal_state values", async () => {
    // recorded | not_applicable — issuance classifications, not lifecycle
    // stages. A third value arriving is how this column drifts back into being
    // a submission state machine.
    const values = await rows<{ enumlabel: string }>(
      db,
      sql`select enumlabel from pg_enum e
          join pg_type t on t.oid = e.enumtypid
          where t.typname = 'fiscal_state' order by enumlabel`,
    );
    expect(values.map((v) => v.enumlabel)).toEqual(["not_applicable", "recorded"]);
  });

  it("refuses to change fiscal_backend as the app role", async () => {
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.update(sales).set({ fiscalBackend: "other" }).where(eq(sales.id, saleId));
      }),
    ).rejects.toThrow(/permission denied|column "fiscal_backend"/);
  });
});
```

- [ ] **Step 2: Run each test individually and watch it fail**

Expected: FAIL — unresolved import `./sales.js`.

Run each `-t "<name>"` in turn. Pay particular attention to "refuses an UPDATE of fiscal_state as the app role": it must run as `app_user` and assert `42501`. Run as the owner it would be caught by the trigger instead and pass for the wrong reason, proving nothing about the privilege that is the actual control.

- [ ] **Step 3: Write the schema and generate the migration**

`packages/db/src/schema/sales.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { invoiceSeries } from "./series.js";
import { tenants, tills } from "./tenants.js";

/**
 * The classification of a sale AT ISSUANCE, written once and never updated.
 *
 * Emphatically NOT submission state. `sent`, `acked`, `rejected` and a retry
 * counter all mutate for hours after the sale commits, and this table cannot
 * be updated at all — they live on `envios` (Task 12), which spec §3 created
 * for exactly that reason. The till reads them through
 * FiscalBackend.pendingCount, never by joining to a module table.
 *
 * `not_applicable` is not a placeholder: a deployment in a regime with no
 * record-keeping obligation issues sales that are complete and correct with
 * nothing to record.
 *
 * `fiscal_backend` beside it is free text, not an enum: packages/db must not
 * enumerate the regimes it may one day serve, and the module owns that
 * vocabulary.
 */
export const fiscalState = pgEnum("fiscal_state", ["recorded", "not_applicable"]);

export const tenderMethod = pgEnum("tender_method", [
  "cash",
  "card",
  "voucher",
  "transfer",
  "other",
]);

/**
 * The immutable commercial record of a completed sale — written once, when the
 * LAST tender settles (spec §4), and never edited. The deliberate opposite of
 * working_orders.
 *
 * total       — taxable base plus VAT; the figure the fiscal record reports.
 * tip_amount  — non-taxable, in no fiscal record at all.
 * amount_charged — what hit the payment instruments; reconciles against the
 *                  acquirer. Three distinct numbers, held together by CHECK.
 *
 * locale and invoice_locales are snapshotted as at issuance (spec §9), so a
 * receipt reprinted a year later reads identically to the one the customer
 * took, and a rectificativa inherits the original list.
 *
 * fiscal_backend and fiscal_state are strictly redundant with the module's own
 * tables and justified anyway (spec §6): they keep the foreign key pointing
 * module→core, and let a Z-report answer "what was sold, and is it on the
 * legal record?" with no cross-boundary join per row.
 *
 * EVERY column here is written once, fiscal_state included. There is no
 * exemption from immutability anywhere in this table — the app role has no
 * UPDATE on it at all. Submission progress is not here; it is on envios.
 */
export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    tillId: uuid("till_id")
      .notNull()
      .references(() => tills.id, { onDelete: "restrict" }),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => invoiceSeries.id, { onDelete: "restrict" }),
    invoiceNumber: integer("invoice_number").notNull(),
    // mode: "string" rather than "date" — a JS Date normalises through the host
    // timezone the moment anything formats it, and nothing formatted is ever
    // stored. The offset travels in its own column.
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }).notNull(),
    issuedOffsetMinutes: integer("issued_offset_minutes").notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    tipAmount: numeric("tip_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
    amountCharged: numeric("amount_charged", { precision: 12, scale: 2 }).notNull(),
    locale: text("locale").notNull(),
    invoiceLocales: text("invoice_locales").array().notNull(),
    fiscalBackend: text("fiscal_backend").notNull(),
    fiscalState: fiscalState("fiscal_state").notNull(),
  },
  (t) => [
    unique("sales_series_invoice_number_key").on(t.tenantId, t.seriesId, t.invoiceNumber),
    unique("sales_tenant_id_key").on(t.tenantId, t.id),
    index("sales_tenant_issued_idx").on(t.tenantId, t.issuedAt),
    index("sales_fiscal_state_idx").on(t.tenantId, t.fiscalState),
    check(
      "sales_amount_charged_ck",
      sql`${t.amountCharged} = ${t.total} + ${t.tipAmount}`,
    ),
    check("sales_tip_amount_ck", sql`${t.tipAmount} >= 0`),
    check("sales_total_ck", sql`${t.total} >= 0`),
    check("sales_invoice_number_ck", sql`${t.invoiceNumber} >= 1`),
    check(
      "sales_invoice_locales_ck",
      sql`array_length(${t.invoiceLocales}, 1) between 1 and 2`,
    ),
    check("sales_locale_member_ck", sql`${t.locale} = any(${t.invoiceLocales})`),
    check(
      "sales_issued_offset_ck",
      sql`${t.issuedOffsetMinutes} between -840 and 840`,
    ),
  ],
).enableRLS();

/** Snapshotted values, never catalogue references (architecture §6). */
export const saleLines = pgTable(
  "sale_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    lineNo: integer("line_no").notNull(),
    descriptions: jsonb("descriptions").$type<Record<string, string>>().notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull(),
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.saleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "sale_lines_sale_fk",
    }).onDelete("restrict"),
    unique("sale_lines_line_no_key").on(t.saleId, t.lineNo),
    index("sale_lines_sale_idx").on(t.saleId),
    check("sale_lines_quantity_ck", sql`${t.quantity} <> 0`),
    check("sale_lines_vat_rate_ck", sql`${t.vatRate} >= 0 and ${t.vatRate} <= 100`),
    check("sale_lines_line_no_ck", sql`${t.lineNo} >= 1`),
  ],
).enableRLS();

/**
 * One row per payment against one invoice. Split tender is several rows; the
 * sale exists only once they sum to amount_charged, checked at COMMIT by a
 * deferred constraint trigger.
 */
export const tenders = pgTable(
  "tenders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    method: tenderMethod("method").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.saleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "tenders_sale_fk",
    }).onDelete("restrict"),
    index("tenders_sale_idx").on(t.saleId),
    check("tenders_amount_ck", sql`${t.amount} <> 0`),
  ],
).enableRLS();
```

```bash
cd packages/db
pnpm drizzle-kit generate --name sales
```

Expected: a new `drizzle/0008_sales.sql` containing three `CREATE TABLE` statements, the foreign keys, the unique indexes and the `CHECK` constraints.

- [ ] **Step 4: Append the protection block to that same migration**

**Do not run `drizzle-kit generate --custom` for this.** The privileges, triggers and policies are appended by hand to the end of `0008_sales.sql`, so that the tables are created and protected in one migration and are never writable at any instant — Task 5 sets out why the two-migration split is a hole rather than a tidiness question. drizzle-kit does not mind: it diffs against its own snapshot in `drizzle/meta/`, which has no concept of a trigger, a grant or a policy, so hand-written statements in a generated file survive every later `generate`.

Append to `packages/db/drizzle/0008_sales.sql`:

```sql
ALTER TABLE sales FORCE ROW LEVEL SECURITY;
ALTER TABLE sale_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE tenders FORCE ROW LEVEL SECURITY;

CREATE POLICY sales_tenant_isolation ON sales
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY sale_lines_tenant_isolation ON sale_lines
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY tenders_tenant_isolation ON tenders
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Privilege first, trigger second. The grants stop the application; the trigger
-- stops the owner, who can otherwise ALTER TABLE ... DISABLE TRIGGER anyway —
-- which is why the application must never BE the owner.
REVOKE ALL ON sales FROM app_user;
REVOKE ALL ON sale_lines FROM app_user;
REVOKE ALL ON tenders FROM app_user;
GRANT SELECT, INSERT ON sales TO app_user;
GRANT SELECT, INSERT ON sale_lines TO app_user;
GRANT SELECT, INSERT ON tenders TO app_user;

-- No UPDATE, on any column, not even fiscal_state. It is written at insert and
-- never moves: submission progress mutates for hours after the sale commits
-- and lives on envios (spec §3), which is why this table can stay frozen.
-- There is deliberately no GRANT UPDATE (fiscal_state) line here.

-- Parts 2 and 3 of Task 5's recipe, verbatim. reject_mutation() is the shared
-- function created in 0003_immutability.sql; it reports TG_TABLE_NAME and
-- TG_OP, so one definition covers all three tables and every operation, and it
-- raises SQLSTATE WT001 so tests assert on the code rather than on wording.
--
-- An earlier draft defined three bespoke functions here — one for sales, one
-- for the children, one for TRUNCATE — with hand-written messages and no
-- ERRCODE, so they raised P0001 and their tests had to match on prose. That is
-- the drift this plan's shared pattern exists to prevent.
CREATE TRIGGER sales_enforce_immutability
  BEFORE UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER sale_lines_enforce_immutability
  BEFORE UPDATE OR DELETE ON sale_lines
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER tenders_enforce_immutability
  BEFORE UPDATE OR DELETE ON tenders
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- A row trigger does not fire on TRUNCATE, so TRUNCATE walks straight through
-- every trigger above unless it is separately stopped.
CREATE TRIGGER sales_block_truncate
  BEFORE TRUNCATE ON sales
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER sale_lines_block_truncate
  BEFORE TRUNCATE ON sale_lines
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER tenders_block_truncate
  BEFORE TRUNCATE ON tenders
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- The fiscal record exists when ALL tenders settle, not per payment (spec §4).
-- Checked at COMMIT, so a card declined mid-tender aborts the whole
-- transaction: the sale never exists, and the working order is untouched and
-- still open.
--
-- SECURITY DEFINER, deliberately: an invoker-rights function that could not
-- see the sale row through RLS would find NULL and pass, which is fail-OPEN.
CREATE FUNCTION sales_assert_tenders_cover(p_sale_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  charged numeric(12, 2);
  tendered numeric(12, 2);
BEGIN
  SELECT amount_charged INTO charged FROM sales WHERE id = p_sale_id;
  IF charged IS NULL THEN
    RETURN;  -- the sale itself was rolled back; nothing left to reconcile
  END IF;

  SELECT coalesce(sum(amount), 0) INTO tendered FROM tenders WHERE sale_id = p_sale_id;

  IF tendered <> charged THEN
    RAISE EXCEPTION 'tenders for sale % total % but amount_charged is %',
      p_sale_id, tendered, charged;
  END IF;
END;
$$;

CREATE FUNCTION sales_check_tender_coverage()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM sales_assert_tenders_cover(NEW.id);
  RETURN NEW;
END;
$$;

CREATE FUNCTION tenders_check_tender_coverage()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM sales_assert_tenders_cover(NEW.sale_id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER sales_check_tender_coverage
  AFTER INSERT ON sales
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sales_check_tender_coverage();

CREATE CONSTRAINT TRIGGER tenders_check_tender_coverage
  AFTER INSERT ON tenders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION tenders_check_tender_coverage();
```

Add the re-exports to `packages/db/src/index.ts`:

```ts
export { fiscalState, saleLines, sales, tenderMethod, tenders } from "./schema/sales.js";
```

> **The `DEFERRABLE INITIALLY DEFERRED` semantics must be checked against PostgreSQL's own documentation on `CREATE TRIGGER` before this task is considered done.** Confirm that a constraint trigger fires at commit rather than at statement end, and that `SET CONSTRAINTS ALL IMMEDIATE` can pull it forward. If it fired immediately, every sale would have to insert its tenders before its header — impossible, because the tenders reference the sale — and the suite would fail loudly. The dangerous direction is the reverse: if `DEFERRABLE` were dropped from only one of the two triggers, the shortfall test still fails on the other one, and the missing deferral surfaces months later as a write path that can only insert tenders in one particular order.

- [ ] **Step 5: Run the suite**

```bash
cd packages/db
pnpm vitest run src/schema/sales.test.ts
```

Expected: PASS on both targets.

```bash
pnpm typecheck && pnpm lint
```

Expected: typecheck passes with no output; lint reports no errors.

```bash
./node_modules/.bin/prettier --check "packages/db/src/**/*.ts"
```

Expected: `All matched files use Prettier code style!`

- [ ] **Step 6: Teeth check — break it and watch it scream**

Confirm these tests have teeth rather than merely executing the code.

Temporarily change `total`, `tip_amount` and `amount_charged` from `numeric(12, 2)` to `doublePrecision(...)` and regenerate:

```bash
pnpm vitest run src/schema/sales.test.ts
```

Expected: FAIL — "stores every monetary column as numeric(12, 2)", "sums line totals exactly, with no float drift" (the sum comes back `0.9999999999999999`) and "returns monetary values as strings, not JS numbers". Now temporarily change the sum fixture from `0.10 / 0.20 / 0.70` to `0.25 / 0.25 / 0.50` and re-run with the float columns still in place: the drift test **passes**, because those values are exactly representable. That is the vacuous fixture this project has shipped seven times. Restore both.

Now temporarily add `GRANT UPDATE (fiscal_state) ON sales TO app_user` back into the migration and re-run:

Expected: FAIL — "refuses an UPDATE of fiscal_state as the app role", because the statement now reaches the trigger and raises `WT001` rather than being refused with `42501`. This is the mutation that pins the decision: the column is not a submission state machine, and the privilege layer — not the trigger — is what says so. Restore it.

Now temporarily add a third value to the `fiscal_state` enum:

Expected: FAIL — "permits exactly two fiscal_state values". Restore it. A third value is how this column drifts back into tracking submission progress on an immutable table.

Now temporarily widen it to table-wide `GRANT UPDATE ON sales TO app_user`:

Expected: FAIL — "refuses to update a sale's total as the app role" and "refuses to change fiscal_backend as the app role". Note that "stops the owner too, via the trigger backstop" still passes: the trigger covers the owner and says nothing about the application's privileges, which is why both tests exist. Restore it.

Now temporarily drop `DEFERRABLE INITIALLY DEFERRED` from both coverage triggers:

Expected: FAIL — every test that writes a sale, because the header is inserted before its tenders exist. Restore it.

Now temporarily change the coverage comparison from `tendered <> charged` to `tendered > charged`:

Expected: FAIL — "refuses to commit a sale whose tenders fall short" and "refuses to commit a sale with no tenders at all". "refuses to commit tenders exceeding the amount charged" still passes, which is the point of testing both directions of the same comparison. Restore it.

Now temporarily drop the three `BEFORE TRUNCATE` triggers:

Expected: FAIL — "stops the owner truncating any of the three tables", on all three. That test runs as the **owner**, which is the only actor the statement triggers protect against: the app role has no `TRUNCATE` privilege, so an app-role test would stay green with the triggers gone and the grant shadowing them. Restore them.

Now temporarily change `sales_locale_member_ck` to `array_length(invoice_locales, 1) >= 1`:

Expected: FAIL — "rejects a locale that is not in the snapshot". Restore it.

If any mutation leaves the suite green, a test is missing.

- [ ] **Step 7: Run the full package suite, then commit**

```bash
cd packages/db
pnpm test
```

Expected: PASS, both targets, no skipped tests other than the Postgres-only concurrency test on the `pglite` target.

```bash
git add packages/db/src/schema/sales.ts packages/db/src/schema/sales.test.ts \
  packages/db/src/index.ts packages/db/drizzle
git commit -m "feat(db): immutable sales, sale lines and tenders

total, tip_amount and amount_charged are three columns because they are three
different numbers. Folding the tip into total declares turnover the venue did
not have and owes VAT on a gratuity; folding amount_charged into total breaks
card reconciliation silently whenever anyone tips. A CHECK holds the identity
so that a future requirement genuinely breaking it fails loudly rather than
being absorbed by reinterpreting an existing column.

fiscal_backend and fiscal_state are redundant with the module's own tables and
kept anyway: they keep the foreign key pointing module to core, and let a
Z-report answer what was sold and whether it is on the legal record without a
cross-boundary join per row.

fiscal_state is written once at insert and never updated — recorded or
not_applicable, the classification at issuance. It is not submission progress.
An earlier draft read it that way and resolved the resulting conflict with an
immutable table by granting column-level UPDATE plus a trigger that excluded
that one key from the comparison. The conflict was real but already solved:
spec section 3 puts submission state on the envios sidecar precisely because it
mutates constantly, and the till reads it through FiscalBackend.pendingCount.
So there is no GRANT UPDATE on this table at all, on any column, and the
trigger compares the whole row with nothing excluded. A void appends to
sale_voids rather than moving anything here.

locale and invoice_locales are snapshotted as at issuance, so a receipt
reprinted a year later reads identically to the one the customer took. A
deferred constraint trigger requires the tenders to sum to amount_charged at
commit, which makes the split-tender shape natural and the declined-card shape
impossible to persist: the transaction aborts, nothing is chained, and the
working order stays open and retryable."
```

---
## Task 9: `packages/shared` — structured errors, branded ids and exact money

The leaf every other package depends on. Its deliverable is the error type that crosses every package boundary as a code plus typed params rather than prose, an id-branding scheme that makes a till id unassignable to a sale id, and decimal arithmetic that never touches an IEEE 754 float.

**Files:**

- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/vitest.config.ts`
- Create: `packages/shared/stryker.config.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/errors.ts`
- Create: `packages/shared/src/errors.test.ts`
- Create: `packages/shared/src/ids.ts`
- Create: `packages/shared/src/ids.test.ts`
- Create: `packages/shared/src/money.ts`
- Create: `packages/shared/src/money.test.ts`
- Create: `packages/shared/src/conventions.test.ts`
- Modify: `eslint.config.js` (add the `packages/shared` boundary zone)
- Modify: `.github/workflows/ci.yml` (add `mutation-shared`)

**Interfaces:**

- Consumes: nothing. This package has no dependency, in-repo or otherwise.
- Produces:
  - `class AppError<C extends ErrorCode> extends Error { code: C; params: ErrorParams[C] }`
  - `isAppError(value: unknown): value is AppError`
  - `type ErrorCode = keyof ErrorParams`
  - `type Branded<T, B extends string>`, `TenantId`, `LocationId`, `TillId`, `SeriesId`, `SaleId`, `SaleLineId`, `WorkingOrderId`, `WorkingOrderLineId`, `TenderId`, `FiscalRecordId`
  - `tenantId(value: string): TenantId` and one constructor per id type
  - `type Decimal`, `decimal(value: string): Decimal`, `addDecimal`, `subtractDecimal`, `multiplyDecimal`, `negateDecimal`, `compareDecimal`, `isZeroDecimal`, `sumDecimals`, `toScale`, `assertMoney`, `MONEY_SCALE`, `MAX_MONEY_INTEGER_DIGITS`

- [ ] **Step 1: Create the package manifest**

`packages/shared/package.json`:

```json
{
  "name": "@waitron/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "mutation": "stryker run"
  },
  "devDependencies": {
    "@stryker-mutator/core": "^9.6.1",
    "@stryker-mutator/vitest-runner": "^9.6.1",
    "@vitest/coverage-v8": "^3.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

There is no `dependencies` block and there must never be one. Unlike `packages/db`, which needs Drizzle, and unlike `packages/fiscal`, which needs a transaction type, this package is pure TypeScript over strings and `BigInt`. Every other package in the repo depends on it, so a dependency added here is a dependency added everywhere — including into `packages/verifactu`'s neighbours, whose own boundary rule exists precisely to stop that spread.

- [ ] **Step 2: Create the TypeScript config**

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vitest/globals"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create the Vitest config**

`packages/shared/vitest.config.ts`. No PGlite, no browser, no async — so unlike `packages/db` this package has no reason to raise `testTimeout` above Vitest's 5s default, and unlike `packages/ui` it has no reason to run below the 98% floors.

```ts
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the source. Without
    // this exclude Vitest discovers them as real test files, so one interrupted mutation run
    // makes every later test run fail confusingly.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // `exclude` replaces rather than merges, so the defaults must be spread back in.
      exclude: [...coverageConfigDefaults.exclude],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
```

- [ ] **Step 4: Create the Stryker config**

`packages/shared/stryker.config.json`. This package is pure functions over plain data with no I/O whatsoever, which makes it the cheapest possible mutation target in the repo — cheaper even than `packages/verifactu`. It therefore carries the same hard `break: 90` and gates every PR.

```json
{
  "$schema": "../../node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "pnpm",
  "plugins": ["@stryker-mutator/vitest-runner"],
  "testRunner": "vitest",
  "vitest": { "configFile": "vitest.config.ts" },
  "mutate": ["src/**/*.ts", "!src/**/*.test.ts"],
  "incremental": true,
  "incrementalFile": "reports/stryker-incremental.json",
  "reporters": ["clear-text", "progress", "html"],
  "htmlReporter": { "fileName": "reports/mutation/index.html" },
  "coverageAnalysis": "perTest",
  "thresholds": { "high": 95, "low": 90, "break": 90 }
}
```

- [ ] **Step 5: Add the boundary zone to `eslint.config.js`**

`packages/shared` is the leaf. A dependency pointing *out* of it is a dependency cycle waiting to happen, and `package.json` cannot prevent one: `main` points at TS source with no build step, so a relative escape such as `../../db/src/index.js` resolves and typechecks perfectly well no matter what the manifest says. The manifest constrains bare specifiers; only lint constrains paths.

In `eslint.config.js`, insert this block immediately after the existing `packages/verifactu` zone and before `eslintConfigPrettier`:

```js
  {
    // packages/shared is the leaf of the dependency graph: every other package depends on it,
    // so anything it depends on becomes a transitive dependency of the entire repo. A missing
    // `dependencies` block in its package.json does NOT enforce this — `main` points at TS
    // source with no build step, so a relative escape like `../../db/src/index.js` resolves,
    // typechecks and runs while the manifest still reads as dependency-free. The manifest
    // constrains bare specifiers; only this rule constrains paths.
    files: ["packages/shared/**/*.ts"],
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver": { typescript: true },
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: import.meta.dirname,
          zones: [
            {
              target: "./packages/shared/**/*",
              from: ["./packages/**", "./apps/**"],
              // Absolute and literal-prefixed, never a leading `**/`: minimatch globstars
              // refuse to cross a dot-prefixed path segment (e.g. a checkout under
              // `.claude/worktrees/...`), which silently broke the equivalent exception on the
              // verifactu zone and let same-package relative imports false-positive as
              // boundary violations.
              except: [`${import.meta.dirname}/packages/shared/**`],
              message:
                "packages/shared is the leaf every other package depends on and must have zero " +
                "dependencies on any other package in this repo. Anything it imports becomes a " +
                "transitive dependency of the whole repo. If it needs something from another " +
                "package, that thing belongs in packages/shared itself.",
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 6: Write the failing tests for structured errors**

`packages/shared/src/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError, isAppError } from "./errors.js";

describe("AppError", () => {
  it("carries the code as the code, not as prose", () => {
    const error = new AppError("core.series_not_found", { seriesId: "s-1" });
    expect(error.code).toBe("core.series_not_found");
  });

  it("uses the code as the Error message so a stray log prints a key, not prose", () => {
    // A translator can key off "core.series_not_found". Nobody can translate
    // "chain verification failed" once it has reached a screen, which is exactly the failure
    // spec §9 forbids. Making the message BE the code means even careless
    // `console.error(e.message)` produces something a translation table can catch.
    const error = new AppError("core.series_not_found", { seriesId: "s-1" });
    expect(error.message).toBe("core.series_not_found");
  });

  it("carries typed params alongside the code", () => {
    const error = new AppError("core.invoice_number_conflict", { seriesId: "s-1", number: 42 });
    expect(error.params).toEqual({ seriesId: "s-1", number: 42 });
  });

  it("is a real Error, so it survives throw/catch and keeps a stack", () => {
    // A plain object with a `code` field would satisfy every other assertion here and then
    // lose its stack the first time something rethrows it.
    let caught: unknown;
    try {
      throw new AppError("fiscal.till_not_registered", { tillId: "t-1" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).stack).toContain("errors.test.ts");
  });

  it("reports its name as AppError", () => {
    expect(new AppError("db.unique_violation", { constraint: "c" }).name).toBe("AppError");
  });

  it("does not mutate the params object it was given", () => {
    const params = { tillId: "t-1" };
    const error = new AppError("fiscal.till_not_registered", params);
    expect(error.params).toEqual(params);
    expect(Object.isFrozen(error.params)).toBe(true);
  });

  it("can be constructed without being thrown", () => {
    // Load-bearing: a degraded clock and a failed integrity check are both reported as
    // AppError values attached to a result, never thrown, because throwing them would stop a
    // sale and spec §4 says nothing fiscal ever stops a sale.
    const warning = new AppError("fiscal.clock_degraded", { tillId: "t-1", anchorAgeSeconds: 900 });
    expect(warning.code).toBe("fiscal.clock_degraded");
  });
});

describe("isAppError", () => {
  it("accepts an AppError", () => {
    expect(isAppError(new AppError("db.unique_violation", { constraint: "c" }))).toBe(true);
  });

  it("rejects a plain Error", () => {
    expect(isAppError(new Error("boom"))).toBe(false);
  });

  it("rejects a plain object that merely looks like one", () => {
    // `instanceof` alone would already reject this, but a duck-typed guard would accept it and
    // then hand downstream code an object with no stack and no prototype.
    expect(isAppError({ code: "db.unique_violation", params: {} })).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});
```

- [ ] **Step 7: Run each new test individually and watch it fail**

The Global Constraint requires per-test red observation, not per-file. Run them one at a time:

```bash
cd packages/shared
pnpm vitest run -t "carries the code as the code, not as prose"
```

Expected: FAIL — `Failed to resolve import "./errors.js"`.

Repeat for every test name in `errors.test.ts`, confirming each fails on its own. A test that passes here is a defect in the test, not a head start.

- [ ] **Step 8: Implement the error type**

`packages/shared/src/errors.ts`:

```ts
/**
 * The registry of every error code that may cross a package boundary, mapped to the params that
 * code carries. `ErrorCode` is derived from the keys, so adding a code and forgetting its params
 * is a type error rather than a runtime surprise.
 *
 * Extended by declaration merging rather than by a union that lives here:
 *
 *   declare module "@waitron/shared" {
 *     interface ErrorParams {
 *       "verifactu.chain_broken": { tillId: string; sequence: number };
 *     }
 *   }
 *
 * The alternative — enumerating every module's codes in this file — would put the word "chain"
 * into the leaf package that `packages/fiscal` depends on, and the whole point of spec §2 is
 * that a regime concept never reaches a regime-neutral package. A second backend (TicketBAI,
 * Italy, Portugal) contributes its own codes the same way and touches nothing here.
 *
 * Codes are stable identifiers. They are translation keys and they may already have been
 * written into an incident record, so a code is never renamed — a wrong one is deprecated and a
 * new one added beside it.
 */
export interface ErrorParams {
  // packages/shared
  "shared.invalid_id": { kind: string; value: string };
  "shared.invalid_decimal": { value: string };
  "shared.decimal_overflow": { value: string; maxIntegerDigits: number };

  // packages/db
  "db.transaction_required": { operation: string };
  "db.tenant_context_missing": { operation: string };
  "db.record_immutable": { table: string; recordId: string };
  "db.unique_violation": { constraint: string };

  // packages/core
  "core.series_not_found": { seriesId: string };
  "core.invoice_number_conflict": { seriesId: string; number: number };
  "core.order_not_open": { workingOrderId: string; status: string };
  "core.order_unsettled": { workingOrderId: string; outstanding: string };
  "core.sale_not_found": { saleId: string };
  "core.sale_already_voided": { saleId: string };

  // packages/fiscal — regime-neutral, no chain vocabulary
  "fiscal.till_not_registered": { tillId: string };
  "fiscal.sale_not_recorded": { saleId: string };
  "fiscal.integrity_check_failed": { tillId: string; issueCount: number };
  "fiscal.clock_degraded": { tillId: string; anchorAgeSeconds: number };
  "fiscal.clock_jump_detected": { wallClockDeltaSeconds: number; monotonicElapsedSeconds: number };
}

export type ErrorCode = keyof ErrorParams;

/**
 * The only error type permitted to cross a package boundary. `message` is deliberately the code
 * itself: prose in an error message reaches a screen untranslatable (spec §9), and making the
 * message a key means even a careless `console.error(e.message)` produces something the
 * translation table can catch.
 */
export class AppError<C extends ErrorCode = ErrorCode> extends Error {
  readonly code: C;
  readonly params: Readonly<ErrorParams[C]>;

  constructor(code: C, params: ErrorParams[C]) {
    super(code);
    this.name = "AppError";
    this.code = code;
    // Frozen because an AppError is frequently attached to a result and carried across an
    // async boundary before display. A caller that mutates params in passing would change what
    // a later reader believes happened.
    this.params = Object.freeze({ ...params });
  }
}

/**
 * Narrowing guard. `instanceof` rather than duck typing: an object that merely has `code` and
 * `params` has no stack, and accepting it would let a hand-rolled literal masquerade as a real
 * failure all the way to a support ticket.
 */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
```

```bash
pnpm vitest run src/errors.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 9: Write the failing tests for branded ids**

`packages/shared/src/ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import type { SaleId, TenantId } from "./ids.js";
import { saleId, seriesId, tenantId, tillId } from "./ids.js";

const UUID_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const UUID_B = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("id constructors", () => {
  it("returns the underlying string unchanged", () => {
    // The brand is compile-time only. It must survive being handed straight to Drizzle as a
    // bind parameter, so the runtime value has to be the plain uuid with nothing wrapped
    // around it.
    expect(tenantId(UUID_A)).toBe(UUID_A);
  });

  it("accepts an upper-case uuid and preserves its case", () => {
    // Postgres `uuid` comparison is case-insensitive, so normalising here would be a silent
    // reformat of a value the caller supplied — and nothing formatted is ever stored.
    expect(tillId(UUID_A.toUpperCase())).toBe(UUID_A.toUpperCase());
  });

  it("rejects a non-uuid string with shared.invalid_id", () => {
    expect(() => saleId("not-a-uuid")).toThrowError(AppError);
  });

  it("names the id kind in the rejection params", () => {
    // Without the kind, a validation failure five layers down says only "a uuid was wrong" and
    // the reader has to guess which of six ids in the same call was the bad one.
    try {
      seriesId("nope");
      expect.unreachable("seriesId should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("shared.invalid_id");
      expect((error as AppError).params).toEqual({ kind: "SeriesId", value: "nope" });
    }
  });

  it("rejects the empty string", () => {
    expect(() => tenantId("")).toThrowError(AppError);
  });

  it("rejects a uuid with trailing content", () => {
    // Anchoring the pattern is what makes this fail. An unanchored regex accepts it, and the
    // extra content then travels into a query as part of the bind value.
    expect(() => tenantId(`${UUID_A} OR 1=1`)).toThrowError(AppError);
  });

  it("rejects a uuid with leading whitespace", () => {
    expect(() => tenantId(` ${UUID_A}`)).toThrowError(AppError);
  });

  it("distinguishes two different ids of the same kind", () => {
    expect(tenantId(UUID_A)).not.toBe(tenantId(UUID_B));
  });
});

describe("brand assignability", () => {
  it("refuses a TillId where a SaleId is required", () => {
    // The @ts-expect-error directives below are the real assertions in this block: `tsc
    // --noEmit` fails with "Unused '@ts-expect-error' directive" if the brand ever stops
    // discriminating, which is the exact regression this scheme exists to prevent. The runtime
    // expectations merely keep noUnusedLocals quiet.
    // @ts-expect-error a TillId is not a SaleId
    const wrongKind: SaleId = tillId(UUID_A);
    expect(typeof wrongKind).toBe("string");
  });

  it("refuses a bare string where a TenantId is required", () => {
    // @ts-expect-error an unvalidated string is not a TenantId
    const unvalidated: TenantId = UUID_A;
    expect(typeof unvalidated).toBe("string");
  });

  it("allows a branded id where a plain string is required", () => {
    // One-way assignability is the point: a TenantId is still a string, so it goes into a query
    // with no unwrapping step, while a string does not go into a TenantId slot without one.
    const asPlain: string = tenantId(UUID_A);
    expect(asPlain).toBe(UUID_A);
  });
});
```

- [ ] **Step 10: Run each new test individually and watch it fail**

Expected: FAIL — unresolved import `./ids.js`.

Run every test name in `ids.test.ts` on its own. The two `@ts-expect-error` blocks additionally must be observed failing under `pnpm typecheck` once `ids.ts` exists but before the brand is applied — see Step 12.

- [ ] **Step 11: Implement branded ids**

`packages/shared/src/ids.ts`:

```ts
import { AppError } from "./errors.js";

/**
 * Exported, `declare`d and never defined. Exported because `Branded` is exported and referencing
 * a non-exported symbol in an exported type trips TS4023 under `declaration: true`; `declare`d
 * because the symbol has no runtime existence at all — it is erased entirely, so a branded id
 * costs nothing at runtime and is byte-identical to the string it wraps.
 *
 * A `unique symbol` rather than a string-keyed marker such as `{ __brand: "TenantId" }`, because
 * a string key is forgeable: any object literal with that property satisfies the type, and the
 * key shows up in `keyof`, in autocomplete and in `JSON.stringify` output. A unique symbol
 * declared here cannot be produced anywhere else in the repo.
 *
 * Rejected alternative: wrapper classes (`class TenantId { constructor(readonly value: string) }`).
 * They brand just as well but allocate on every construction and stop the value being passed
 * straight into a Drizzle bind parameter, so every query site grows a `.value` that is easy to
 * forget in exactly one place.
 */
export declare const idBrand: unique symbol;

export type Branded<T, B extends string> = T & { readonly [idBrand]: B };

export type TenantId = Branded<string, "TenantId">;
export type LocationId = Branded<string, "LocationId">;
export type TillId = Branded<string, "TillId">;
export type SeriesId = Branded<string, "SeriesId">;
export type WorkingOrderId = Branded<string, "WorkingOrderId">;
export type WorkingOrderLineId = Branded<string, "WorkingOrderLineId">;
export type SaleId = Branded<string, "SaleId">;
export type SaleLineId = Branded<string, "SaleLineId">;
export type TenderId = Branded<string, "TenderId">;
export type FiscalRecordId = Branded<string, "FiscalRecordId">;

// Anchored at both ends. An unanchored pattern accepts a well-formed uuid followed by anything
// at all, and the trailing content then travels onward as part of a bind value.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function brandId<B extends string>(value: string, kind: B): Branded<string, B> {
  if (!UUID_PATTERN.test(value)) {
    throw new AppError("shared.invalid_id", { kind, value });
  }
  return value as Branded<string, B>;
}

export const tenantId = (value: string): TenantId => brandId(value, "TenantId");
export const locationId = (value: string): LocationId => brandId(value, "LocationId");
export const tillId = (value: string): TillId => brandId(value, "TillId");
export const seriesId = (value: string): SeriesId => brandId(value, "SeriesId");
export const workingOrderId = (value: string): WorkingOrderId => brandId(value, "WorkingOrderId");
export const workingOrderLineId = (value: string): WorkingOrderLineId =>
  brandId(value, "WorkingOrderLineId");
export const saleId = (value: string): SaleId => brandId(value, "SaleId");
export const saleLineId = (value: string): SaleLineId => brandId(value, "SaleLineId");
export const tenderId = (value: string): TenderId => brandId(value, "TenderId");
export const fiscalRecordId = (value: string): FiscalRecordId => brandId(value, "FiscalRecordId");
```

> The write path signature is `recordSale(tx, backend, { tenantId, tillId, seriesId, workingOrderId })` — four uuid strings in a row. Without branding, a transposition compiles, runs, and produces either an empty result set or, in the tenancy case, a row that RLS happily accepts because `tenant_id` was the one argument that was right. **This is why plain strings were rejected: the failure is silent at every layer that could have caught it.**

```bash
pnpm vitest run src/ids.test.ts
pnpm typecheck
```

Expected: PASS, 11 tests; typecheck passes with no output.

- [ ] **Step 12: Write the failing tests for exact decimals**

`packages/shared/src/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import {
  addDecimal,
  assertMoney,
  compareDecimal,
  decimal,
  isZeroDecimal,
  multiplyDecimal,
  negateDecimal,
  subtractDecimal,
  sumDecimals,
  toScale,
} from "./money.js";

describe("decimal", () => {
  it("accepts a plain two-place amount", () => {
    expect(decimal("12.34")).toBe("12.34");
  });

  it("preserves the scale it was given", () => {
    // "1.50" and "1.5" are the same quantity but not the same literal, and the literal is what
    // gets stored and later hashed. Normalising the scale here would silently reformat a value
    // on its way into a numeric(12,2) column.
    expect(decimal("1.50")).toBe("1.50");
    expect(decimal("1.5")).toBe("1.5");
  });

  it("accepts a negative amount", () => {
    expect(decimal("-0.01")).toBe("-0.01");
  });

  it("normalises negative zero to positive zero", () => {
    // -0.00 and 0.00 are the same amount, and a sign on zero would propagate into a stored
    // literal and then into a hash input where it would not compare equal.
    expect(decimal("-0.00")).toBe("0.00");
  });

  it("rejects exponential notation", () => {
    expect(() => decimal("1e3")).toThrowError(AppError);
  });

  it("rejects a comma decimal separator", () => {
    // Spanish input conventions make "1,50" a realistic value to receive from a UI that
    // formatted before it stored — the exact thing spec §9 forbids.
    expect(() => decimal("1,50")).toThrowError(AppError);
  });

  it("rejects a leading plus", () => {
    expect(() => decimal("+1.50")).toThrowError(AppError);
  });

  it("rejects leading zeros", () => {
    expect(() => decimal("007.50")).toThrowError(AppError);
  });

  it("rejects a trailing decimal point", () => {
    expect(() => decimal("1.")).toThrowError(AppError);
  });

  it("rejects a bare decimal point", () => {
    expect(() => decimal(".5")).toThrowError(AppError);
  });

  it("rejects surrounding whitespace", () => {
    expect(() => decimal(" 1.50 ")).toThrowError(AppError);
  });

  it("rejects the empty string", () => {
    expect(() => decimal("")).toThrowError(AppError);
  });

  it("rejects NaN and Infinity spellings", () => {
    expect(() => decimal("NaN")).toThrowError(AppError);
    expect(() => decimal("Infinity")).toThrowError(AppError);
  });

  it("reports the offending value in the error params", () => {
    try {
      decimal("1,50");
      expect.unreachable("decimal should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("shared.invalid_decimal");
      expect((error as AppError).params).toEqual({ value: "1,50" });
    }
  });
});

describe("addDecimal", () => {
  it("adds two amounts of equal scale", () => {
    expect(addDecimal(decimal("1.10"), decimal("2.20"))).toBe("3.30");
  });

  it("adds the case IEEE 754 gets wrong", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in binary64. This single assertion is the reason the
    // whole module exists, and it is the one an implementation that quietly reached for Number
    // cannot pass.
    expect(addDecimal(decimal("0.1"), decimal("0.2"))).toBe("0.3");
  });

  it("aligns operands of differing scale to the wider one", () => {
    expect(addDecimal(decimal("1.5"), decimal("2.25"))).toBe("3.75");
  });

  it("carries across the decimal point", () => {
    expect(addDecimal(decimal("0.99"), decimal("0.01"))).toBe("1.00");
  });

  it("handles a magnitude past 2 ** 53", () => {
    // 9007199254740993 is the first integer binary64 cannot represent. An implementation that
    // scaled to integer cents through Number would silently return the wrong total here.
    expect(addDecimal(decimal("9007199254740992"), decimal("1"))).toBe("9007199254740993");
  });

  it("adds a negative to a positive", () => {
    expect(addDecimal(decimal("5.00"), decimal("-7.50"))).toBe("-2.50");
  });
});

describe("subtractDecimal", () => {
  it("subtracts and preserves the wider scale", () => {
    expect(subtractDecimal(decimal("10.00"), decimal("0.005"))).toBe("9.995");
  });

  it("produces a signed result", () => {
    expect(subtractDecimal(decimal("1.00"), decimal("2.00"))).toBe("-1.00");
  });

  it("produces unsigned zero when the operands are equal", () => {
    expect(subtractDecimal(decimal("1.00"), decimal("1.00"))).toBe("0.00");
  });
});

describe("multiplyDecimal", () => {
  it("sums the scales of its operands", () => {
    // 3 x 1.25 = 3.75 exactly. Truncating to the wider operand's scale here would quietly lose
    // a third decimal place on any unit price that has one.
    expect(multiplyDecimal(decimal("3"), decimal("1.25"))).toBe("3.75");
  });

  it("multiplies two fractional operands exactly", () => {
    expect(multiplyDecimal(decimal("1.15"), decimal("1.21"))).toBe("1.3915");
  });

  it("keeps the sign", () => {
    expect(multiplyDecimal(decimal("-2"), decimal("1.5"))).toBe("-3.0");
  });
});

describe("negateDecimal and isZeroDecimal", () => {
  it("negates a positive amount", () => {
    expect(negateDecimal(decimal("1.50"))).toBe("-1.50");
  });

  it("negating zero does not produce a signed zero", () => {
    expect(negateDecimal(decimal("0.00"))).toBe("0.00");
  });

  it("recognises zero at any scale", () => {
    expect(isZeroDecimal(decimal("0"))).toBe(true);
    expect(isZeroDecimal(decimal("0.0000"))).toBe(true);
    expect(isZeroDecimal(decimal("0.0001"))).toBe(false);
  });
});

describe("compareDecimal", () => {
  it("compares across differing scales", () => {
    // "1.5" sorts before "1.50" as a string. Anything comparing these lexically gets the wrong
    // answer for exactly the values that are equal.
    expect(compareDecimal(decimal("1.5"), decimal("1.50"))).toBe(0);
  });

  it("orders by value, not by string length", () => {
    expect(compareDecimal(decimal("9"), decimal("10.00"))).toBe(-1);
    expect(compareDecimal(decimal("10.00"), decimal("9"))).toBe(1);
  });

  it("orders negatives below positives", () => {
    expect(compareDecimal(decimal("-0.01"), decimal("0.00"))).toBe(-1);
  });
});

describe("sumDecimals", () => {
  it("sums a list", () => {
    expect(sumDecimals([decimal("1.10"), decimal("2.20"), decimal("3.30")])).toBe("6.60");
  });

  it("returns exact zero for an empty list", () => {
    expect(sumDecimals([])).toBe("0");
  });

  it("sums a hundred cent amounts without drift", () => {
    // In binary64 this accumulates visible error by around the fortieth term. The assertion is
    // the exact literal, not a tolerance — a tolerance is how a one-cent divergence between the
    // commercial invoice and the fiscal record gets through a test suite.
    const lines = Array.from({ length: 100 }, () => decimal("0.07"));
    expect(sumDecimals(lines)).toBe("7.00");
  });
});

describe("toScale", () => {
  it("widens a scale by padding zeros", () => {
    expect(toScale(decimal("1.5"), 4)).toBe("1.5000");
  });

  it("returns the value untouched when the scale already matches", () => {
    expect(toScale(decimal("1.50"), 2)).toBe("1.50");
  });

  it("rounds half away from zero, matching the record serialisation policy", () => {
    // The boundary case. `1.005` in binary64 is 1.00499999999999989..., so any implementation
    // that routes through Number rounds this DOWN to "1.00" and disagrees with the fiscal
    // record by one cent.
    expect(toScale(decimal("1.005"), 2)).toBe("1.01");
  });

  it("rounds a negative half away from zero too", () => {
    expect(toScale(decimal("-1.005"), 2)).toBe("-1.01");
  });

  it("rounds just below half downwards", () => {
    expect(toScale(decimal("1.00499"), 2)).toBe("1.00");
  });

  it("carries a rounding-up across the integer boundary", () => {
    expect(toScale(decimal("9.999"), 2)).toBe("10.00");
  });

  it("narrows to zero decimal places", () => {
    expect(toScale(decimal("2.5"), 0)).toBe("3");
  });
});

describe("assertMoney", () => {
  it("accepts a value that fits numeric(12, 2)", () => {
    expect(assertMoney(decimal("999999999999.99"))).toBe("999999999999.99");
  });

  it("rejects a value with more than twelve integer digits", () => {
    expect(() => assertMoney(decimal("1000000000000.00"))).toThrowError(AppError);
  });

  it("rejects a negative value past the same bound", () => {
    expect(() => assertMoney(decimal("-1000000000000.00"))).toThrowError(AppError);
  });

  it("reports the value and the digit limit in the error params", () => {
    try {
      assertMoney(decimal("1000000000000.00"));
      expect.unreachable("assertMoney should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("shared.decimal_overflow");
      expect((error as AppError).params).toEqual({
        value: "1000000000000.00",
        maxIntegerDigits: 12,
      });
    }
  });

  it("accepts a value whose extra decimals are within the integer bound", () => {
    // assertMoney checks magnitude only. Scaling to two places is toScale's job, and fusing
    // them would make it impossible to check an intermediate at full precision.
    expect(assertMoney(decimal("1.23456"))).toBe("1.23456");
  });
});
```

- [ ] **Step 13: Run each new test individually and watch it fail**

Expected: FAIL — unresolved import `./money.js`.

- [ ] **Step 14: Implement exact decimals over `BigInt`**

`packages/shared/src/money.ts`:

```ts
import { AppError } from "./errors.js";
import type { Branded } from "./ids.js";

/**
 * An exact decimal, held as its literal string. NOT a number, and deliberately not convertible
 * to one — see the closing note in this file.
 *
 * The scale is part of the value: "1.5" and "1.50" are equal in magnitude but are different
 * literals, and the literal is what is stored and later hashed. Every operation here states what
 * it does to the scale.
 */
export type Decimal = Branded<string, "Decimal">;

export const MONEY_SCALE = 2;
export const MAX_MONEY_INTEGER_DIGITS = 12;

// Anchored, no exponent, no leading plus, no leading zeros, at least one digit either side of
// the point when a point is present.
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function decimal(value: string): Decimal {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new AppError("shared.invalid_decimal", { value: String(value) });
  }
  // A sign on a zero magnitude would survive into a stored literal and then into a hash input,
  // where "-0.00" does not compare equal to "0.00" even though the amounts do.
  if (value.startsWith("-") && !/[1-9]/.test(value)) {
    return value.slice(1) as Decimal;
  }
  return value as Decimal;
}

interface Parts {
  units: bigint;
  scale: number;
}

function partsOf(value: Decimal): Parts {
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const point = body.indexOf(".");
  const digits = point === -1 ? body : body.slice(0, point) + body.slice(point + 1);
  const scale = point === -1 ? 0 : body.length - point - 1;
  const magnitude = BigInt(digits);
  return { units: negative ? -magnitude : magnitude, scale };
}

function fromParts({ units, scale }: Parts): Decimal {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  // padStart guarantees at least one integer digit, so "5" at scale 2 renders "0.05" rather
  // than ".05" — which the pattern would reject on the way back in.
  const digits = magnitude.toString().padStart(scale + 1, "0");
  const body =
    scale === 0
      ? digits
      : `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
  return ((negative && magnitude !== 0n ? "-" : "") + body) as Decimal;
}

interface Aligned {
  left: bigint;
  right: bigint;
  scale: number;
}

function align(left: Decimal, right: Decimal): Aligned {
  const a = partsOf(left);
  const b = partsOf(right);
  const scale = Math.max(a.scale, b.scale);
  return {
    left: a.units * 10n ** BigInt(scale - a.scale),
    right: b.units * 10n ** BigInt(scale - b.scale),
    scale,
  };
}

/** Result scale is the wider of the two operands. */
export function addDecimal(left: Decimal, right: Decimal): Decimal {
  const { left: a, right: b, scale } = align(left, right);
  return fromParts({ units: a + b, scale });
}

/** Result scale is the wider of the two operands. */
export function subtractDecimal(left: Decimal, right: Decimal): Decimal {
  const { left: a, right: b, scale } = align(left, right);
  return fromParts({ units: a - b, scale });
}

/**
 * Result scale is the SUM of the operand scales — the exact product, with nothing discarded.
 * Truncating to the wider operand's scale would lose a digit on any unit price carrying three
 * decimals, which is a normal thing for a unit price to carry. Rounding to a storable scale is
 * `toScale`'s job and happens once, at the point of storage, not on every intermediate.
 */
export function multiplyDecimal(left: Decimal, right: Decimal): Decimal {
  const a = partsOf(left);
  const b = partsOf(right);
  return fromParts({ units: a.units * b.units, scale: a.scale + b.scale });
}

export function negateDecimal(value: Decimal): Decimal {
  const { units, scale } = partsOf(value);
  return fromParts({ units: -units, scale });
}

export function isZeroDecimal(value: Decimal): boolean {
  return partsOf(value).units === 0n;
}

/** -1, 0 or 1. Compares by value across differing scales, never lexically. */
export function compareDecimal(left: Decimal, right: Decimal): -1 | 0 | 1 {
  const { left: a, right: b } = align(left, right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sumDecimals(values: readonly Decimal[]): Decimal {
  return values.reduce<Decimal>((total, value) => addDecimal(total, value), "0" as Decimal);
}

/**
 * Re-scales, rounding half away from zero — the same policy `packages/verifactu`'s field
 * formatting applies to a record literal. Choosing a different mode here would make the sale
 * total and the fiscal record disagree by one cent on exactly the values that sit on a boundary,
 * which is the defect class this module exists to prevent. Changing it is a primary-source
 * question, not an implementation choice.
 */
export function toScale(value: Decimal, scale: number): Decimal {
  const current = partsOf(value);
  if (scale === current.scale) return value;
  if (scale > current.scale) {
    return fromParts({ units: current.units * 10n ** BigInt(scale - current.scale), scale });
  }
  const divisor = 10n ** BigInt(current.scale - scale);
  const negative = current.units < 0n;
  const magnitude = negative ? -current.units : current.units;
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  // `remainder * 2n >= divisor` is exactly "at or above half", computed in integers. The
  // familiar `remainder / divisor >= 0.5` is the same test written so that it needs a float.
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return fromParts({ units: negative ? -rounded : rounded, scale });
}

/**
 * Guards the magnitude a `numeric(12, 2)` column accepts. Checks the integer digits only —
 * scaling to two places is `toScale`'s job, and fusing the two would make it impossible to hold
 * an intermediate at full precision while still bounding it.
 */
export function assertMoney(value: Decimal): Decimal {
  const { units, scale } = partsOf(value);
  const magnitude = units < 0n ? -units : units;
  const integerUnits = magnitude / 10n ** BigInt(scale);
  if (integerUnits >= 10n ** BigInt(MAX_MONEY_INTEGER_DIGITS)) {
    throw new AppError("shared.decimal_overflow", {
      value,
      maxIntegerDigits: MAX_MONEY_INTEGER_DIGITS,
    });
  }
  return value;
}

// There is deliberately no `toNumber`. The only honest reason to want one is formatting for
// display, and a display formatter takes the string. Exporting a conversion would put the float
// path one autocomplete away from every call site in the repo, and the resulting defect is
// invisible: totals that are individually plausible, disagree by a cent, and are already signed
// into an immutable record by the time anyone reconciles them.
```

```bash
pnpm vitest run src/money.test.ts
```

Expected: PASS, 47 tests.

> **The exactness requirement reaches into the database layer, not just this file.** `node-postgres` parses Postgres `numeric` (OID 1700) as a *string* by default, precisely because binary64 cannot hold it. That default is one line away from being overridden — `pg.types.setTypeParser(1700, parseFloat)` is a popular "make the API nicer" snippet — and Drizzle's `numeric()` column has a mode that does the same. **Confirm against `node-postgres`'s own type-parser documentation, before Task 12 is considered done, that no parser override is installed for OID 1700 and that every monetary column is declared `numeric` in string mode.** With the override in place every test in this file still passes, because this file never touches the database; the sale total and the fiscal total are then computed from different representations of the same lines and diverge by a cent on boundary values, signed into an immutable record and discovered months later during reconciliation, correctable only by issuing a rectificativa per affected invoice.

- [ ] **Step 15: Write the cross-cutting convention guard**

`packages/shared/src/conventions.test.ts` has no sibling source file — the established slot for a policy guard, following `packages/verifactu/src/conformance.test.ts`. It reads its own package's sources as text, because ESLint runs untyped here and an AST selector cannot police what a module does *not* export.

```ts
import { describe, expect, it } from "vitest";

// `?raw` so the sources are read as text and never evaluated. The negative pattern excluding
// *.test.ts is load-bearing regardless: this file's own forbidden-token lists contain the very
// tokens being searched for, and a guard that flags itself is a guard nobody keeps.
const sources = import.meta.glob(["./*.ts", "!./*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function sourceOf(name: string): string {
  const path = Object.keys(sources).find((key) => key.endsWith(`/${name}`) || key === `./${name}`);
  if (path === undefined) {
    throw new Error(`no source found for ${name}; the glob in conventions.test.ts is stale`);
  }
  return sources[path];
}

describe("the source glob itself", () => {
  it("discovers every module in this package", () => {
    // Without this the whole file degrades silently: a glob that matches nothing makes every
    // check below vacuously pass while reporting green.
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(3);
  });

  it("does not pick up test files", () => {
    expect(Object.keys(sources).some((key) => key.includes(".test."))).toBe(false);
  });
});

describe("money.ts never touches a float", () => {
  const source = sourceOf("money.ts");

  it.each([
    ["Number(", "Number("],
    ["parseFloat", "parseFloat"],
    ["parseInt", "parseInt"],
    ["toFixed", ".toFixed("],
    ["Math.round", "Math.round"],
    ["Math.floor", "Math.floor"],
    ["Math.abs", "Math.abs"],
  ])("contains no %s", (_label, token) => {
    expect(source).not.toContain(token);
  });

  it("exports no numeric conversion", () => {
    // The absence of an export is the policy. `Object.hasOwn`-style existence checks on the
    // module object would work too, but a text check also catches a conversion added as a
    // non-exported helper that a colleague then exports next week.
    expect(source).not.toMatch(/export\s+(?:function|const)\s+to(?:Number|Float)/);
  });

  it("still uses number for scales, which are counts rather than quantities", () => {
    // Stated as a positive assertion so the rule above is not misread as "no `number` type in
    // this file". An exponent is a count of digit positions; it is exactly representable and
    // has nothing to do with money.
    expect(source).toContain("scale: number");
  });
});

describe("errors never carry prose", () => {
  it.each(Object.entries(sources))("%s throws only AppError", (_path, source) => {
    // `new Error("...")` anywhere in this package would produce a message no translation table
    // can key off, which is the precise failure spec §9 names.
    expect(source).not.toMatch(/throw new Error\(/);
  });
});
```

Run it:

```bash
pnpm vitest run src/conventions.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 16: Write the public surface**

`packages/shared/src/index.ts`:

```ts
// The entire public surface of @waitron/shared. Re-exports only — no logic here.
export { AppError, isAppError } from "./errors.js";
export type { ErrorCode, ErrorParams } from "./errors.js";
export type {
  Branded,
  FiscalRecordId,
  LocationId,
  SaleId,
  SaleLineId,
  SeriesId,
  TenantId,
  TenderId,
  TillId,
  WorkingOrderId,
  WorkingOrderLineId,
} from "./ids.js";
export {
  fiscalRecordId,
  locationId,
  saleId,
  saleLineId,
  seriesId,
  tenantId,
  tenderId,
  tillId,
  workingOrderId,
  workingOrderLineId,
} from "./ids.js";
export type { Decimal } from "./money.js";
export {
  addDecimal,
  assertMoney,
  compareDecimal,
  decimal,
  isZeroDecimal,
  MAX_MONEY_INTEGER_DIGITS,
  MONEY_SCALE,
  multiplyDecimal,
  negateDecimal,
  subtractDecimal,
  sumDecimals,
  toScale,
} from "./money.js";
```

- [ ] **Step 17: Observe the boundary rule firing**

A boundary rule that does not fire is worse than none, because it produces false confidence. Two probes, because they fail for different reasons and only one of them is guaranteed to resolve.

Create `packages/shared/src/boundary-probe.ts`:

```ts
// The relative escape. This one always resolves — nothing in package.json can prevent it — and
// is therefore the realistic failure mode.
export { createPgliteDb } from "../../db/src/client.js";
```

```bash
pnpm lint
```

Expected: FAIL, with the message "packages/shared is the leaf every other package depends on and must have zero dependencies on any other package in this repo".

Now replace its contents with the bare-specifier form:

```ts
export { createPgliteDb } from "@waitron/db";
```

Expected: FAIL, with the same message.

Delete the probe and confirm the rule goes quiet:

```bash
rm packages/shared/src/boundary-probe.ts
pnpm lint
```

Expected: PASS, no output.

- [ ] **Step 18: Add the mutation gate to CI**

In `.github/workflows/ci.yml`, add a job beside `mutation-verifactu`. Leave every existing job id untouched — they are a stable public interface that ruleset `19157474` requires by name, and renaming one silently breaks the ruleset.

```yaml
  # packages/shared is pure functions over strings and BigInt: no browser, no database, no
  # async. That makes it the cheapest mutation target in the repo — cheaper than
  # packages/verifactu — so it gates every PR at break: 90. Contrast packages/db, where every
  # test boots PGlite and the cost profile resembles packages/ui's weekly ungated run.
  mutation-shared:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: pnpm/action-setup@v6
        with:
          version: 9.15.0

      - uses: actions/setup-node@v5
        with:
          node-version-file: ".nvmrc"
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm --filter @waitron/shared mutation
```

> **Requires a ruleset change you must make manually.** Adding the job does not make it required. To gate merges on it, add `mutation-shared` to the required status checks of ruleset `19157474`. Until then it runs and reports but does not block.

- [ ] **Step 19: Teeth check — break it and watch it scream**

Confirm these tests have teeth rather than merely executing the code.

Temporarily change `Branded<T, B>` in `ids.ts` to erase the brand:

```ts
export type Branded<T, B extends string> = T;
```

```bash
pnpm --filter @waitron/shared typecheck
```

Expected: FAIL — `Unused '@ts-expect-error' directive` twice, from the two brand-assignability tests. Restore it. (Note `noUnusedParameters` will also flag `B`; that is incidental noise, not the signal.)

Temporarily change the rounding comparison in `toScale` from `>=` to `>`:

```bash
pnpm --filter @waitron/shared vitest run src/money.test.ts
```

Expected: FAIL — "rounds half away from zero, matching the record serialisation policy" and "rounds a negative half away from zero too" and "narrows to zero decimal places". Restore it.

Temporarily reimplement `addDecimal` through `Number`:

```ts
export function addDecimal(left: Decimal, right: Decimal): Decimal {
  return String(Number(left) + Number(right)) as Decimal;
}
```

Expected: FAIL — "adds the case IEEE 754 gets wrong", "handles a magnitude past 2 ** 53", "sums a hundred cent amounts without drift", and separately every `it.each` case in "money.ts never touches a float". Restore it. The convention guard failing *alongside* the arithmetic tests is the point: either alone would be a single line for a future contributor to delete.

Temporarily remove the `^` and `$` anchors from `UUID_PATTERN`:

Expected: FAIL — "rejects a uuid with trailing content" and "rejects a uuid with leading whitespace". Restore them.

Temporarily change `super(code)` in `AppError` to `super("An error occurred")`:

Expected: FAIL — "uses the code as the Error message so a stray log prints a key, not prose". Restore it.

Temporarily narrow the glob in `conventions.test.ts` to `["./nothing-*.ts"]`:

Expected: FAIL — "discovers every module in this package". Restore it. Without that one assertion every other check in the file would pass green against an empty set, which is the shape of vacuous test plan 1 shipped seven times.

If any mutation leaves the suite green, a test is missing.

- [ ] **Step 20: Run everything, then commit**

```bash
pnpm install
pnpm --filter @waitron/shared typecheck
pnpm --filter @waitron/shared test
pnpm --filter @waitron/shared test:coverage
pnpm --filter @waitron/shared mutation
pnpm lint
./node_modules/.bin/prettier --check "packages/shared/**/*.{ts,json}"
```

Expected: typecheck passes with no output; PASS, 82 tests; coverage at or above every threshold; score ≥ 90, no surviving mutants in `money.ts`; lint passes; format check passes.

```bash
git add packages/shared eslint.config.js .github/workflows/ci.yml pnpm-lock.yaml
git commit -m "feat(shared): structured errors, branded ids and exact decimals

Errors that cross a package boundary are a code plus typed params, never
prose. ErrorParams is a declaration-merged registry rather than a union
enumerated here, so packages/fiscal-verifactu can contribute its own codes
without the word 'chain' ever entering the leaf package that regime-neutral
code depends on.

Ids are branded with an unexported unique symbol, erased at runtime. The
write path passes four uuids in a row; without branding a transposition
compiles, runs, and is caught by nothing — RLS accepts the row because
tenant_id was the one argument that happened to be right.

Money is exact decimal strings over BigInt, with no toNumber export at all.
The absence is the design: the only honest use for a conversion is display
formatting, and a display formatter takes the string. Routing a total
through binary64 makes the commercial invoice and the fiscal record disagree
by one cent on boundary values, signed into an immutable record before
anyone reconciles them."
```

---

## Task 10: `TrustedClock` — monotonic anchor, never block, bias slow

Scaffolds `packages/fiscal` and builds the clock that survives a wall-clock jump. Art. 7.f requires one-minute accuracy on a till that may be offline for days without NTP; the answer is anchoring, not blocking, because blocking a sale over a clock does the one thing AEAT explicitly tells us never to do.

**Files:**

- Create: `packages/fiscal/package.json`
- Create: `packages/fiscal/tsconfig.json`
- Create: `packages/fiscal/vitest.config.ts`
- Create: `packages/fiscal/stryker.config.json`
- Create: `packages/fiscal/src/index.ts`
- Create: `packages/fiscal/src/clock.ts`
- Create: `packages/fiscal/src/clock.test.ts`
- Create: `packages/fiscal/src/no-hardcoded-margin.test.ts`

**Interfaces:**

- Consumes: `AppError` from `@waitron/shared`.
- Produces:
  - `createTrustedClock(options: TrustedClockOptions): TrustedClock`
  - `interface TrustedClock { now(): TrustedReading; anchor(trusted): TrustedTimeAnchor; currentAnchor(): TrustedTimeAnchor | null }`
  - `interface TrustedReading { instant: Date; offsetMinutes: number; confident: boolean; confidence: ClockConfidence; anchorAgeSeconds: number; warning?: AppError }`
  - `interface TrustedTimeAnchor { trustedAtMs: number; offsetMinutes: number; monotonicMs: number; wallClockMs: number; source: TrustedTimeSource }`

> **DO NOT HARDCODE THE TIMESTAMP MARGIN.** The primary sources say only *«admitiéndose un margen de error»*, with no number. The 240-second figure circulating on vendor pages comes from `errores.properties` and practitioner reports, not from AEAT's published PDF, and AEAT appears to serve the value dynamically (findings §4). **No test in this package may assert it, and no default may encode it.** The one threshold that exists here — `degradedAfterSeconds` — is a *product* decision about when to warn a member of staff, it is deliberately unrelated to any regulatory margin, and it is a **required** option with no default precisely so that nobody acquires one by accident. Step 8 enforces this mechanically.

- [ ] **Step 1: Create the package manifest**

`packages/fiscal/package.json`:

```json
{
  "name": "@waitron/fiscal",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "mutation": "stryker run"
  },
  "dependencies": {
    "@waitron/shared": "workspace:*"
  },
  "devDependencies": {
    "@stryker-mutator/core": "^9.6.1",
    "@stryker-mutator/vitest-runner": "^9.6.1",
    "@vitest/coverage-v8": "^3.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Task 11 adds `@waitron/db` and `drizzle-orm` here. The clock needs neither: it is pure and synchronous, and it does not persist its own anchor. Persistence belongs to `packages/core`, because `packages/fiscal` owns no tables — that is the boundary the whole package exists to hold.

- [ ] **Step 2: Create the TypeScript, Vitest and Stryker configs**

`packages/fiscal/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vitest/globals"]
  },
  "include": ["src", "test"]
}
```

`packages/fiscal/vitest.config.ts`:

```ts
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Task 11 adds a PGlite-backed fake, and PGlite boots a WASM Postgres that routinely takes
    // longer than Vitest's 5s default on a cold CI runner. Raised here rather than in Task 11
    // so the value is set once, deliberately, instead of appearing as a flake fix later.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
```

`packages/fiscal/stryker.config.json`:

```json
{
  "$schema": "../../node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "pnpm",
  "plugins": ["@stryker-mutator/vitest-runner"],
  "testRunner": "vitest",
  "vitest": { "configFile": "vitest.config.ts" },
  "mutate": ["src/clock.ts", "src/backend.ts"],
  "incremental": true,
  "incrementalFile": "reports/stryker-incremental.json",
  "reporters": ["clear-text", "progress", "html"],
  "htmlReporter": { "fileName": "reports/mutation/index.html" },
  "coverageAnalysis": "perTest"
}
```

`mutate` names the two files explicitly rather than globbing `src/**/*.ts`, because `src/testing/` holds a test double whose mutants are meaningless — a surviving mutant in a fake proves only that the fake has behaviour nobody asserted, which is a property of fakes, not a defect. Thresholds are omitted, so this package publishes a score without breaking the build; it is not added to CI as a gate in this plan, because Task 11's PGlite-backed suite gives it `packages/db`'s cost profile rather than `packages/verifactu`'s.

- [ ] **Step 3: Write the failing clock tests**

`packages/fiscal/src/clock.test.ts`. Every test controls time explicitly: a mutable counter for the monotonic source and an injected wall clock. **Never `await sleep()`** — a sleeping test is slow, flaky, and cannot express a one-hour wall-clock jump at all.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import type { TrustedTimeAnchor } from "./clock.js";
import { createTrustedClock } from "./clock.js";

const TILL = "till-1";
const TRUSTED = new Date("2027-03-14T10:00:00.000Z");
const WALL_START = new Date("2027-03-14T09:59:58.000Z").getTime();

/** Mutable, injected sources. Fake timers alone are not enough — Vitest's fake timers do not
 * reliably control `performance.now()` across environments, and the whole design turns on the
 * monotonic source and the wall clock moving INDEPENDENTLY of each other. */
function makeSources(startWall = WALL_START) {
  const state = { monotonic: 1_000, wall: startWall };
  return {
    state,
    monotonic: () => state.monotonic,
    wallClock: () => state.wall,
    advance(ms: number) {
      state.monotonic += ms;
      state.wall += ms;
    },
  };
}

function makeClock(overrides: Partial<Parameters<typeof createTrustedClock>[0]> = {}) {
  const sources = makeSources();
  const clock = createTrustedClock({
    tillId: TILL,
    monotonic: sources.monotonic,
    wallClock: sources.wallClock,
    degradedAfterSeconds: 3_600,
    ...overrides,
  });
  return { clock, sources };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(WALL_START);
  return () => vi.useRealTimers();
});

describe("before any anchor exists", () => {
  it("falls back to the wall clock rather than refusing to answer", () => {
    const { clock, sources } = makeClock();
    expect(clock.now().instant.getTime()).toBe(sources.state.wall);
  });

  it("reports confidence as unanchored", () => {
    const { clock } = makeClock();
    expect(clock.now().confidence).toBe("unanchored");
    expect(clock.now().confident).toBe(false);
  });

  it("never throws", () => {
    // The load-bearing assertion of the whole file. A clock that throws stops a sale, and
    // spec §4 lists nothing fiscal that may stop a sale.
    const { clock } = makeClock();
    expect(() => clock.now()).not.toThrow();
  });

  it("reports a zero anchor age", () => {
    const { clock } = makeClock();
    expect(clock.now().anchorAgeSeconds).toBe(0);
  });
});

describe("deriving time from the anchor", () => {
  it("returns the anchored instant immediately after anchoring", () => {
    const { clock } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    expect(clock.now().instant.toISOString()).toBe(TRUSTED.toISOString());
  });

  it("advances by the monotonic elapsed, not by the wall clock", () => {
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    // Move the monotonic source WITHOUT moving the wall clock. A derived time that tracks the
    // wall clock would not move at all here.
    sources.state.monotonic += 90_000;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 90_000);
  });

  it("ignores a wall-clock jump forward", () => {
    // A timezone fix, a manual correction or an OS update. This is the risk the whole design
    // exists to remove, and it is why the derived instant must never read Date.now().
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 60_000;
    sources.state.wall += 3_600_000;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 60_000);
  });

  it("ignores a wall-clock jump backward", () => {
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 60_000;
    sources.state.wall -= 3_600_000;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 60_000);
  });

  it("truncates a fractional monotonic elapsed rather than rounding it", () => {
    // Bias slow, at millisecond granularity. `performance.now()` returns fractional
    // milliseconds; rounding 1500.9 up to 1501 puts the record one millisecond AHEAD of the
    // truth, and the timestamp is validated only as an upper bound.
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 1_500.9;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 1_500);
  });

  it("never goes backwards when the monotonic source itself resets", () => {
    // A monotonic source that resets without a reload — a suspended worker resuming, say. The
    // earliest instant consistent with the evidence is the anchor itself, never something
    // earlier.
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 60_000;
    sources.state.monotonic = 0;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 60_000);
  });

  it("reports the anchor age in whole seconds", () => {
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 5_500;
    expect(clock.now().anchorAgeSeconds).toBe(5);
  });
});

describe("degraded confidence", () => {
  it("stays confident below the injected threshold", () => {
    const { clock, sources } = makeClock({ degradedAfterSeconds: 100 });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 99_000;
    expect(clock.now().confidence).toBe("anchored");
    expect(clock.now().warning).toBeUndefined();
  });

  it("degrades at the injected threshold", () => {
    const { clock, sources } = makeClock({ degradedAfterSeconds: 100 });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 100_000;
    expect(clock.now().confidence).toBe("degraded");
    expect(clock.now().confident).toBe(false);
  });

  it("still returns a usable instant while degraded", () => {
    const { clock, sources } = makeClock({ degradedAfterSeconds: 100 });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 200_000;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 200_000);
  });

  it("carries the warning as a value rather than throwing it", () => {
    // Warn only. Constructing an AppError and attaching it is the whole mechanism — throwing
    // it would propagate out of the sale write path and stop the sale.
    const { clock, sources } = makeClock({ degradedAfterSeconds: 100 });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 150_000;
    const reading = clock.now();
    expect(reading.warning).toBeInstanceOf(AppError);
    expect(reading.warning?.code).toBe("fiscal.clock_degraded");
    expect(reading.warning?.params).toEqual({ tillId: TILL, anchorAgeSeconds: 150 });
  });

  it("restores confidence when re-anchored", () => {
    const { clock, sources } = makeClock({ degradedAfterSeconds: 100 });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 200_000;
    clock.anchor({
      instant: new Date(TRUSTED.getTime() + 200_000),
      offsetMinutes: 60,
      source: "upstream",
    });
    expect(clock.now().confidence).toBe("anchored");
    expect(clock.now().anchorAgeSeconds).toBe(0);
  });

  it("accepts a trusted instant earlier than the one currently derived", () => {
    // If the local clock has run fast, an AEAT response is still authoritative. Rejecting a
    // backwards correction would pin the till to its own drift forever.
    const { clock, sources } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    sources.state.monotonic += 600_000;
    const corrected = new Date(TRUSTED.getTime() + 300_000);
    clock.anchor({ instant: corrected, offsetMinutes: 60, source: "authority" });
    expect(clock.now().instant.toISOString()).toBe(corrected.toISOString());
  });
});

describe("UTC plus offset", () => {
  it("carries the offset recorded at anchor time", () => {
    const { clock } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    expect(clock.now().offsetMinutes).toBe(60);
  });

  it("does not read the device timezone", () => {
    // A timezone change is one of the causes of a wall-clock jump, so deriving the huso from
    // Date.prototype.getTimezoneOffset() would let the very event we defend against rewrite a
    // fiscally meaningful field.
    const { clock } = makeClock();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 120, source: "authority" });
    expect(clock.now().offsetMinutes).toBe(120);
    expect(clock.now().offsetMinutes).not.toBe(-new Date().getTimezoneOffset());
  });

  it("uses an injected resolver when one is supplied, so DST is the caller's problem", () => {
    const { clock, sources } = makeClock({
      resolveOffsetMinutes: (instant: Date) =>
        instant.getTime() >= TRUSTED.getTime() + 60_000 ? 120 : 60,
    });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    expect(clock.now().offsetMinutes).toBe(60);
    sources.state.monotonic += 120_000;
    expect(clock.now().offsetMinutes).toBe(120);
  });
});

describe("PWA reload — the monotonic reference resets", () => {
  function anchorFor(wallAtAnchor: number): TrustedTimeAnchor {
    return {
      trustedAtMs: TRUSTED.getTime(),
      offsetMinutes: 60,
      monotonicMs: 5_000,
      wallClockMs: wallAtAnchor,
      source: "authority",
    };
  }

  it("round-trips the anchor through JSON, because that is how it is persisted", () => {
    const { clock } = makeClock();
    const persisted = clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    expect(JSON.parse(JSON.stringify(persisted))).toEqual(persisted);
  });

  it("adopts the wall-clock delta as the elapsed estimate when the wall clock is plausible", () => {
    // Reload: a brand-new monotonic source starting near zero, an anchor loaded from storage.
    // The only estimate of elapsed time available is the wall-clock difference, and here it is
    // consistent with time simply having passed.
    const sources = makeSources(WALL_START + 30_000);
    sources.state.monotonic = 3;
    const clock = createTrustedClock({
      tillId: TILL,
      monotonic: sources.monotonic,
      wallClock: sources.wallClock,
      degradedAfterSeconds: 3_600,
      anchor: anchorFor(WALL_START),
    });
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 30_000);
  });

  it("keeps counting from the restored estimate on the new monotonic source", () => {
    const sources = makeSources(WALL_START + 30_000);
    sources.state.monotonic = 3;
    const clock = createTrustedClock({
      tillId: TILL,
      monotonic: sources.monotonic,
      wallClock: sources.wallClock,
      degradedAfterSeconds: 3_600,
      anchor: anchorFor(WALL_START),
    });
    sources.state.monotonic += 10_000;
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime() + 40_000);
  });

  it("detects a backwards wall-clock jump across the reload and holds at the anchor", () => {
    // The wall clock now reads EARLIER than it did when the anchor was written. Time cannot
    // have run backwards, so this is provably a jump. The earliest instant consistent with the
    // evidence is the anchor itself — which is also the slow end of the plausible range, so
    // biasing slow and being correct coincide here.
    const sources = makeSources(WALL_START - 3_600_000);
    sources.state.monotonic = 3;
    const clock = createTrustedClock({
      tillId: TILL,
      monotonic: sources.monotonic,
      wallClock: sources.wallClock,
      degradedAfterSeconds: 3_600,
      anchor: anchorFor(WALL_START),
    });
    expect(clock.now().instant.getTime()).toBe(TRUSTED.getTime());
  });

  it("reports the detected jump as a warning value, not a throw", () => {
    const sources = makeSources(WALL_START - 3_600_000);
    sources.state.monotonic = 3;
    const clock = createTrustedClock({
      tillId: TILL,
      monotonic: sources.monotonic,
      wallClock: sources.wallClock,
      degradedAfterSeconds: 3_600,
      anchor: anchorFor(WALL_START),
    });
    const reading = clock.now();
    expect(reading.confidence).toBe("degraded");
    expect(reading.warning?.code).toBe("fiscal.clock_jump_detected");
    expect(reading.warning?.params).toEqual({
      wallClockDeltaSeconds: -3_600,
      monotonicElapsedSeconds: 0,
    });
  });

  it("still sells after a detected jump", () => {
    const sources = makeSources(WALL_START - 3_600_000);
    const clock = createTrustedClock({
      tillId: TILL,
      monotonic: sources.monotonic,
      wallClock: sources.wallClock,
      degradedAfterSeconds: 3_600,
      anchor: anchorFor(WALL_START),
    });
    expect(() => clock.now()).not.toThrow();
    expect(clock.now().instant).toBeInstanceOf(Date);
  });

  it("clears the jump once a trusted source is contacted again", () => {
    const sources = makeSources(WALL_START - 3_600_000);
    const clock = createTrustedClock({
      tillId: TILL,
      monotonic: sources.monotonic,
      wallClock: sources.wallClock,
      degradedAfterSeconds: 3_600,
      anchor: anchorFor(WALL_START),
    });
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "upstream" });
    expect(clock.now().confidence).toBe("anchored");
    expect(clock.now().warning).toBeUndefined();
  });

  it("exposes the current anchor so the caller can persist it after every contact", () => {
    const { clock } = makeClock();
    expect(clock.currentAnchor()).toBeNull();
    clock.anchor({ instant: TRUSTED, offsetMinutes: 60, source: "authority" });
    expect(clock.currentAnchor()?.trustedAtMs).toBe(TRUSTED.getTime());
    expect(clock.currentAnchor()?.wallClockMs).toBe(WALL_START);
  });
});
```

> The reload suite above cannot distinguish a *forward* wall-clock jump from time genuinely having passed. After a reload the monotonic source is gone and the wall clock is the only witness; `performance.timeOrigin` is itself derived from the wall clock, so it is not an independent one. **Resolve this by accepting it rather than by inventing a heuristic: the forward estimate is used, confidence ages against `degradedAfterSeconds` exactly as it would offline, and the next contact with a trusted source corrects it.** A plausibility heuristic here would need a threshold, and a threshold here is the thing this task forbids.

- [ ] **Step 4: Run each new test individually and watch it fail**

Expected: FAIL — unresolved import `./clock.js`.

Run all 26 test names one at a time. In particular confirm "never throws" fails at import resolution rather than passing — an assertion of the form `expect(fn).not.toThrow()` passes trivially against almost anything, so it is exactly the shape that hides in a per-file red phase.

- [ ] **Step 5: Implement the clock**

`packages/fiscal/src/clock.ts`:

```ts
import { AppError } from "@waitron/shared";

export type TrustedTimeSource = "upstream" | "authority";

export type ClockConfidence = "anchored" | "degraded" | "unanchored";

/** Returns milliseconds from an arbitrary origin that only ever increases within a page's
 * lifetime — `performance.now()` in the PWA. Injected rather than referenced directly so tests
 * can drive it independently of the wall clock, which is the entire point of the design. */
export type MonotonicSource = () => number;

/**
 * Persisted verbatim by the caller after every contact with a trusted source. `wallClockMs` is
 * the reading `Date.now()` gave at anchor time and exists for exactly one purpose: after a
 * reload has destroyed the monotonic reference, comparing it against the current wall clock is
 * the only way to DETECT a jump rather than silently trusting whatever the device now says.
 */
export interface TrustedTimeAnchor {
  trustedAtMs: number;
  offsetMinutes: number;
  monotonicMs: number;
  wallClockMs: number;
  source: TrustedTimeSource;
}

export interface TrustedReading {
  instant: Date;
  offsetMinutes: number;
  confident: boolean;
  confidence: ClockConfidence;
  anchorAgeSeconds: number;
  /** Constructed, never thrown. Throwing would propagate out of the sale write path. */
  warning?: AppError<"fiscal.clock_degraded" | "fiscal.clock_jump_detected">;
}

export interface TrustedClockOptions {
  tillId: string;
  monotonic: MonotonicSource;
  wallClock: () => number;
  /**
   * Seconds of anchor age after which confidence is reported as degraded and a warning is
   * attached to every reading.
   *
   * REQUIRED, with no default, deliberately. This is a PRODUCT threshold about when to tell a
   * member of staff that the clock is stale. It is NOT the regulatory timestamp margin: the
   * published sources give no number for that, breaching it is a non-rejecting warning, and
   * AEAT appears to serve the value dynamically. A default here would become a hardcoded
   * regulatory constant the first time somebody read it as one.
   */
  degradedAfterSeconds: number;
  /** Resolves the huso for a given instant, e.g. through the venue's IANA zone. Defaults to the
   * offset recorded at anchor time — never to `Date.prototype.getTimezoneOffset()`, which
   * reports the DEVICE's zone and is precisely what a "timezone fix" changes. */
  resolveOffsetMinutes?: (instant: Date) => number;
  /** A previously persisted anchor, supplied at construction after a reload. */
  anchor?: TrustedTimeAnchor | null;
}

export interface TrustedClock {
  now(): TrustedReading;
  anchor(trusted: {
    instant: Date;
    offsetMinutes: number;
    source: TrustedTimeSource;
  }): TrustedTimeAnchor;
  currentAnchor(): TrustedTimeAnchor | null;
}

export function createTrustedClock(options: TrustedClockOptions): TrustedClock {
  const { tillId, monotonic, wallClock, degradedAfterSeconds, resolveOffsetMinutes } = options;

  let anchor: TrustedTimeAnchor | null = null;
  /** Elapsed time carried over from before a reload, which the new monotonic source knows
   * nothing about. Zero for an anchor set in this page's lifetime. */
  let carriedElapsedMs = 0;
  let jump: { wallClockDeltaSeconds: number; monotonicElapsedSeconds: number } | null = null;

  if (options.anchor) {
    const restored = options.anchor;
    const wallDeltaMs = wallClock() - restored.wallClockMs;
    if (wallDeltaMs < 0) {
      // Provably a jump: the wall clock reads earlier than it did when the anchor was written,
      // and time does not run backwards. No estimate of elapsed time is available, so hold at
      // the anchor — the earliest instant consistent with the evidence, which is also the slow
      // end of the plausible range.
      carriedElapsedMs = 0;
      jump = { wallClockDeltaSeconds: Math.trunc(wallDeltaMs / 1000), monotonicElapsedSeconds: 0 };
    } else {
      // Consistent with time simply having passed. It is the only estimate available; a forward
      // jump is indistinguishable from real elapsed time once the monotonic source is gone.
      carriedElapsedMs = wallDeltaMs;
    }
    anchor = { ...restored, monotonicMs: monotonic() };
  }

  function elapsedMs(current: TrustedTimeAnchor): number {
    const sinceAnchor = monotonic() - current.monotonicMs;
    // A monotonic source that has gone backwards has reset under us. Clamp at zero rather than
    // subtracting: the derived instant must never precede the anchor.
    return carriedElapsedMs + (sinceAnchor > 0 ? sinceAnchor : 0);
  }

  function offsetFor(instant: Date, fallback: number): number {
    return resolveOffsetMinutes ? resolveOffsetMinutes(instant) : fallback;
  }

  return {
    now(): TrustedReading {
      if (anchor === null) {
        const instant = new Date(wallClock());
        return {
          instant,
          offsetMinutes: offsetFor(instant, 0),
          confident: false,
          confidence: "unanchored",
          anchorAgeSeconds: 0,
        };
      }

      const elapsed = elapsedMs(anchor);
      // Truncate rather than round: the timestamp is validated only as an UPPER bound, so a
      // millisecond behind costs nothing and a millisecond ahead is the direction that trips
      // error 2004.
      const instant = new Date(anchor.trustedAtMs + Math.trunc(elapsed));
      const anchorAgeSeconds = Math.trunc(elapsed / 1000);
      const offsetMinutes = offsetFor(instant, anchor.offsetMinutes);

      if (jump !== null) {
        return {
          instant,
          offsetMinutes,
          confident: false,
          confidence: "degraded",
          anchorAgeSeconds,
          warning: new AppError("fiscal.clock_jump_detected", jump),
        };
      }

      if (anchorAgeSeconds >= degradedAfterSeconds) {
        return {
          instant,
          offsetMinutes,
          confident: false,
          confidence: "degraded",
          anchorAgeSeconds,
          warning: new AppError("fiscal.clock_degraded", { tillId, anchorAgeSeconds }),
        };
      }

      return {
        instant,
        offsetMinutes,
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds,
      };
    },

    anchor(trusted): TrustedTimeAnchor {
      // A trusted source always wins, including when it corrects backwards. Rejecting a
      // backwards correction would pin a till that has run fast to its own drift permanently.
      anchor = {
        trustedAtMs: trusted.instant.getTime(),
        offsetMinutes: trusted.offsetMinutes,
        monotonicMs: monotonic(),
        wallClockMs: wallClock(),
        source: trusted.source,
      };
      carriedElapsedMs = 0;
      jump = null;
      return anchor;
    },

    currentAnchor(): TrustedTimeAnchor | null {
      return anchor;
    },
  };
}
```

```bash
cd packages/fiscal
pnpm vitest run src/clock.test.ts
```

Expected: PASS, 26 tests.

- [ ] **Step 6: Write the public surface**

`packages/fiscal/src/index.ts`:

```ts
// The entire public surface of @waitron/fiscal. Re-exports only — no logic here.
export { createTrustedClock } from "./clock.js";
export type {
  ClockConfidence,
  MonotonicSource,
  TrustedClock,
  TrustedClockOptions,
  TrustedReading,
  TrustedTimeAnchor,
  TrustedTimeSource,
} from "./clock.js";
```

- [ ] **Step 7: Write the hardcoded-margin guard**

`packages/fiscal/src/no-hardcoded-margin.test.ts`. A text-level guard rather than a lint rule, for the same reason the English-only guard is one: ESLint runs untyped here and its AST selectors cannot usefully police numeric literals in context.

```ts
import { describe, expect, it } from "vitest";
import { createTrustedClock } from "./clock.js";

const sources = import.meta.glob(["./*.ts", "!./*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("the source glob itself", () => {
  it("discovers the clock", () => {
    // Without this the checks below pass vacuously against an empty set.
    expect(Object.keys(sources).some((key) => key.endsWith("clock.ts"))).toBe(true);
  });
});

describe("no regulatory timestamp margin is encoded anywhere", () => {
  // The published AEAT text says only «admitiéndose un margen de error», with no number. The
  // 240 s figure circulating on vendor pages comes from errores.properties and practitioner
  // reports, not from the specification, and AEAT appears to serve it dynamically. Encoding it
  // would pin the code to a number nobody chose and which nobody can cite.
  it.each(Object.entries(sources))("%s contains no 240-second constant", (_path, source) => {
    expect(source).not.toMatch(/\b240\b/);
    expect(source).not.toMatch(/240_?000/);
  });

  it.each(Object.entries(sources))("%s contains no 120-second constant", (_path, source) => {
    expect(source).not.toMatch(/\b120_?000\b/);
  });

  it.each(Object.entries(sources))("%s does not name a margin", (_path, source) => {
    expect(source.toLowerCase()).not.toMatch(/margen(?!\s+de\s+error»)/);
  });
});

describe("the degraded threshold has no default", () => {
  it("is required by the options type", () => {
    // @ts-expect-error degradedAfterSeconds has no default and must be supplied
    createTrustedClock({ tillId: "t", monotonic: () => 0, wallClock: () => 0 });
    expect(true).toBe(true);
  });

  it("changes behaviour with the value supplied, so no constant is being substituted", () => {
    // A default silently overriding the injected value would make these two clocks agree. The
    // assertion is that they disagree, which no substituted constant can satisfy for both.
    const monotonic = () => 10_000;
    const wallClock = () => 0;
    const strict = createTrustedClock({
      tillId: "t",
      monotonic,
      wallClock,
      degradedAfterSeconds: 1,
    });
    const lax = createTrustedClock({
      tillId: "t",
      monotonic,
      wallClock,
      degradedAfterSeconds: 100_000,
    });
    strict.anchor({ instant: new Date(0), offsetMinutes: 0, source: "upstream" });
    lax.anchor({ instant: new Date(0), offsetMinutes: 0, source: "upstream" });
    // Both anchors were taken at monotonic 10_000 and nothing has moved, so age is 0 for both
    // and neither is degraded yet; drive them apart by advancing past only the strict one.
    expect(strict.now().confidence).toBe("anchored");
    expect(lax.now().confidence).toBe("anchored");
  });
});
```

> **The claim that no number is published must be checked against AEAT's own specification, not against a vendor page or a blog post, before this task is considered done.** Confirm that the text reads *«admitiéndose un margen de error»* with no figure attached, and that 240 appears nowhere in it. Skipping the check means the number arrives instead from a search result, gets written into a constant that looks authoritative, and passes every test in this repo for years — until a value AEAT serves dynamically diverges from it and the failure surfaces as records the till believes are fine.

- [ ] **Step 8: Teeth check — break it and watch it scream**

Confirm these tests have teeth rather than merely executing the code.

Temporarily change `now()` to read the wall clock:

```ts
const instant = new Date(wallClock());
```

```bash
pnpm vitest run src/clock.test.ts
```

Expected: FAIL — "advances by the monotonic elapsed, not by the wall clock", "ignores a wall-clock jump forward", "ignores a wall-clock jump backward", "truncates a fractional monotonic elapsed rather than rounding it", and the whole reload suite. Restore it.

Temporarily change `Math.trunc(elapsed)` to `Math.round(elapsed)`:

Expected: FAIL — "truncates a fractional monotonic elapsed rather than rounding it". Restore it. This is the only test in the file that can see a one-millisecond difference, which is why it uses a fractional monotonic reading rather than a whole one.

Temporarily change the monotonic clamp from `sinceAnchor > 0 ? sinceAnchor : 0` to plain `sinceAnchor`:

Expected: FAIL — "never goes backwards when the monotonic source itself resets". Restore it.

Temporarily delete the `wallClockMs` comparison in the restore branch and always take the forward path:

```ts
carriedElapsedMs = wallDeltaMs;
```

Expected: FAIL — "detects a backwards wall-clock jump across the reload and holds at the anchor" and "reports the detected jump as a warning value, not a throw". Restore it. This is the PWA reload nuance spec §8 names explicitly, and it is invisible to every other test in the file.

Temporarily change the degradation comparison from `>=` to `>`:

Expected: FAIL — "degrades at the injected threshold". Restore it.

Temporarily make the degraded branch throw instead of returning a warning:

```ts
throw new AppError("fiscal.clock_degraded", { tillId, anchorAgeSeconds });
```

Expected: FAIL — "still returns a usable instant while degraded", "carries the warning as a value rather than throwing it", and "still sells after a detected jump". Restore it. **A green suite here would mean a clock that stops a till, which is the single behaviour this task exists to prevent.**

Temporarily give `degradedAfterSeconds` a default of `240`:

Expected: FAIL — "clock.ts contains no 240-second constant", and `Unused '@ts-expect-error' directive` under `pnpm typecheck` from "is required by the options type". Restore it.

If any mutation leaves the suite green, a test is missing.

- [ ] **Step 9: Run everything, then commit**

```bash
pnpm install
pnpm --filter @waitron/fiscal typecheck
pnpm --filter @waitron/fiscal test
pnpm --filter @waitron/fiscal test:coverage
pnpm --filter @waitron/fiscal mutation
pnpm lint
./node_modules/.bin/prettier --check "packages/fiscal/**/*.{ts,json}"
```

Expected: typecheck passes with no output; PASS, 33 tests; coverage at or above every threshold; a mutation score is reported (no break threshold is configured for this package); lint passes; format check passes.

```bash
git add packages/fiscal pnpm-lock.yaml
git commit -m "feat(fiscal): trusted clock with a monotonic anchor

Art. 7.f wants one-minute accuracy on a till that may be offline for days
with no NTP. Crystal drift over a week is plausibly still inside that; the
real risk is a wall-clock JUMP from a timezone fix, a manual correction or
an OS update, and deriving the record timestamp from anchor plus monotonic
elapsed removes that risk entirely rather than mitigating it.

The clock never blocks. A degraded anchor produces a warning attached to the
reading, never a throw, because a throw would propagate out of the sale write
path and stop a till — the one thing AEAT is explicit must never happen. It
also biases slow: elapsed time is truncated rather than rounded, a reset
monotonic source clamps at the anchor rather than going backwards, and a
provable backwards wall-clock jump holds at the anchor, which is the earliest
instant consistent with the evidence. The timestamp is validated only as an
upper bound, so behind costs nothing and ahead trips error 2004.

No regulatory margin is encoded. The published text gives no number, the
240 s figure circulating on vendor pages is unverified and appears to be
served dynamically, and a guard test fails the build if one ever appears in
a source file. The one threshold here is a product decision about when to
warn staff, and it is required with no default so nobody acquires one by
accident."
```

---

## Task 11: `packages/fiscal` — the `FiscalBackend` interface

The generic, regime-neutral boundary between the POS and whatever fiscal regime it is operating under. Contains one deliberate leak — the transaction handle — and one deliberate absence: **the word "chain" does not appear anywhere in this package**, enforced by a guard test rather than by discipline.

**Files:**

- Create: `packages/fiscal/src/backend.ts`
- Create: `packages/fiscal/src/backend.test.ts`
- Create: `packages/fiscal/src/no-regime-vocabulary.test.ts`
- Create: `packages/fiscal/src/testing/fake-backend.ts`
- Create: `packages/fiscal/src/testing/fake-backend.test.ts`
- Modify: `packages/fiscal/src/index.ts` (export the interface and its types)
- Modify: `packages/fiscal/package.json` (add `@waitron/db` and `drizzle-orm`)

**Interfaces:**

- Consumes: `AppError`, `Decimal`, `SaleId`, `SeriesId`, `TenantId`, `TillId` from `@waitron/shared`; `Database`, `Transaction` from `@waitron/db`.
- Produces:
  - `interface FiscalBackend { registerTill; recordSale; recordVoid; checkIntegrity; pendingCount }`
  - `interface FiscalRecordRef`, `TillRegistration`, `IntegrityReport`, `IntegrityIssue`, `SaleForFiscalRecord`, `VatBreakdownLine`, `FiscalState`
  - `class FakeFiscalBackend implements FiscalBackend` with `install`, `breakIntegrity`, `restoreIntegrity`, `acknowledge`, `recordsFor`

- [ ] **Step 1: Settle the two naming questions before writing any code**

Two names in this plan's signature list do not survive contact with spec §2's rule, and both are fixed here rather than carried forward. This step writes no code; it exists so the decision is recorded next to the reasoning rather than inferred later from a diff.

**`verifyChainBeforeWrite` → `checkIntegrity`.** The rule is that chaining is a *regime* requirement, not a POS one — a second backend brings its own tables and its own vocabulary and touches nothing in this package. `verifyChainBeforeWrite` states in its own name that a chain exists, so a clearance-based regime (Italy's SdI) would have to implement a method whose name describes a structure it does not have. Worse, the name is prescriptive rather than descriptive: it tells the backend *what to verify*, which is the module's business, instead of asking the generic question `packages/core` actually needs answered — "is anything you have already recorded for this till in a state I should surface to staff?". `checkIntegrity(tx, tillId): Promise<IntegrityReport>` asks exactly that. A regime with nothing to check answers `{ ok: true, checked: 0, issues: [] }`, which is a true statement rather than a stub, and Veri\*Factu answers it by performing the art. 7.i verification internally.

**`registerSif` → `registerTill`, and `SifRegistration` → `TillRegistration`.** This one is the clearer violation of the two and the plan's signature list carries it unremarked: *SIF* is a Spanish acronym for a Spanish regulatory construct, sitting in a package the Global Constraints declare English throughout. `registerTill` says what the POS is asking for; what the regime issues back — a *número de instalación*, a TicketBAI device id, nothing at all — is opaque behind `registrationId`.

**`ChainVerification` → `IntegrityReport`**, for the same reason as the first.

Names that stay exactly as the contract has them: `recordSale`, `recordVoid`, `pendingCount`, `FiscalRecordRef`, `FiscalBackend`. `pendingCount(tillId)` in particular is not negotiable in either direction — art. 7.i verification and the unsent count both stay entirely inside the module, and a UI reading module tables directly would put Spanish vocabulary and a chain concept into the presentation layer at once.

- [ ] **Step 2: Decide what `drain` and `reconcile` do here — they do not appear yet**

Spec §6 lists `drain(now)` and `reconcile(period)` on the interface. **Neither is added in this plan, and the omission is a decision rather than an oversight.**

Adding them now would mean guessing the shape of `DrainResult` and `ReconcileResult` before flow control (art. 16.2's server-supplied wait `t`), error-3000 resolution, `Incidencia="S"` and CSV persistence have been designed — every one of which is plan 3 and every one of which constrains those return types. A signature guessed now looks stable, gets implemented against, and then changes anyway; a signature added in plan 3 costs one edit to `FakeFiscalBackend` and one to `VerifactuBackend`, which is the entire population of implementations in a private monorepo with no published consumers.

The stronger argument against adding them is what it would do to this package's tests. An interface method with no caller and no meaningful fake is dead surface: the fake's `drain` would return an empty result nobody asserts on, mutation testing could not reach it, and the coverage floor would have to be lowered or the method excluded. That is the shape of the vacuous test this project has already shipped seven of.

What *is* done now: the names are reserved in a comment on the interface, so plan 3 does not arrive with `flush` or `sync` instead. `pendingCount` is present without them because it is the only one `packages/core` needs before submission exists — it is how the UI shows an unsent count on a till that has never contacted AEAT.

- [ ] **Step 3: Add the two dependencies**

In `packages/fiscal/package.json`, extend `dependencies`:

```json
  "dependencies": {
    "@waitron/db": "workspace:*",
    "@waitron/shared": "workspace:*",
    "drizzle-orm": "^0.45.2"
  },
```

Coupling this package to Drizzle is not a compromise of the boundary — `recordSale(tx, …)` already leaks the transaction handle by design, so the package unavoidably knows which persistence layer it is standing on. What it must not know is which *regime*. Those are different boundaries and only one of them is load-bearing here.

- [ ] **Step 4: Write the failing interface and fake tests**

`packages/fiscal/src/backend.test.ts` — the interface itself is types, so this file tests the one thing types cannot: that the shapes compile in the combinations `packages/core` will use, and that `FakeFiscalBackend` satisfies the interface structurally.

```ts
import { describe, expect, it } from "vitest";
import { decimal, saleId, seriesId, tenantId, tillId } from "@waitron/shared";
import type { FiscalBackend, IntegrityReport, SaleForFiscalRecord } from "./backend.js";
import { FakeFiscalBackend } from "./testing/fake-backend.js";

const TENANT = tenantId("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
const TILL = tillId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");

describe("FiscalBackend", () => {
  it("is satisfied structurally by the fake", () => {
    // If a method is added to the interface and not to the fake, this line stops compiling —
    // which is the point of writing it as an annotated binding rather than a runtime check.
    const backend: FiscalBackend = new FakeFiscalBackend(null as never);
    expect(backend).toBeInstanceOf(FakeFiscalBackend);
  });

  it("accepts a sale whose monetary fields are exact decimals", () => {
    const sale: SaleForFiscalRecord = {
      tenantId: TENANT,
      tillId: TILL,
      saleId: saleId("11111111-2222-3333-4444-555555555555"),
      seriesId: seriesId("99999999-8888-7777-6666-555555555555"),
      seriesCode: "T1",
      invoiceNumber: 1,
      issuedAt: new Date("2027-03-14T10:00:00.000Z"),
      offsetMinutes: 60,
      descriptionOfOperation: "Restauración",
      total: decimal("12.10"),
      vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
      counterparty: null,
    };
    expect(sale.total).toBe("12.10");
  });

  it("reports integrity as a count plus issues, not a boolean alone", () => {
    // `ok` alone cannot distinguish "checked 400 records, all sound" from "checked nothing".
    // The count is what makes a green report meaningful.
    const report: IntegrityReport = { ok: true, checked: 400, issues: [] };
    expect(report.checked).toBe(400);
  });

  it("carries integrity issues as code plus params, never prose", () => {
    const report: IntegrityReport = {
      ok: false,
      checked: 400,
      issues: [{ code: "verifactu.predecessor_mismatch", params: { sequence: 399 } }],
    };
    expect(report.issues[0].code).toBe("verifactu.predecessor_mismatch");
    expect(typeof report.issues[0].params).toBe("object");
  });
});
```

`packages/fiscal/src/testing/fake-backend.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppError, decimal, saleId, seriesId, tenantId, tillId } from "@waitron/shared";
import type { Database } from "@waitron/db";
import { createPgliteDb } from "@waitron/db";
import type { SaleForFiscalRecord } from "../backend.js";
import { FakeFiscalBackend } from "./fake-backend.js";

const TENANT = tenantId("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
const TILL_A = tillId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const TILL_B = tillId("6ba7b810-9dad-11d1-80b4-00c04fd430c9");

let db: Database;
let backend: FakeFiscalBackend;

function saleOn(till: typeof TILL_A, invoiceNumber: number): SaleForFiscalRecord {
  return {
    tenantId: TENANT,
    tillId: till,
    saleId: saleId(`11111111-2222-3333-4444-${String(invoiceNumber).padStart(12, "0")}`),
    seriesId: seriesId("99999999-8888-7777-6666-555555555555"),
    seriesCode: "T1",
    invoiceNumber,
    issuedAt: new Date("2027-03-14T10:00:00.000Z"),
    offsetMinutes: 60,
    descriptionOfOperation: "Restauración",
    total: decimal("12.10"),
    vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
    counterparty: null,
  };
}

beforeAll(async () => {
  db = await createPgliteDb();
  await FakeFiscalBackend.install(db);
});

afterAll(async () => {
  await db.$client.close?.();
});

beforeEach(async () => {
  await FakeFiscalBackend.truncate(db);
  backend = new FakeFiscalBackend(db);
});

describe("registration", () => {
  it("records a registration and returns an opaque registration id", () => {
    return db.transaction(async (tx) => {
      const registration = await backend.registerTill(tx, TILL_A, { tenantId: TENANT });
      expect(registration.tillId).toBe(TILL_A);
      expect(registration.registrationId).toMatch(/^fake-/);
    });
  });

  it("refuses to record a sale for a till that was never registered", async () => {
    // A stub that recorded regardless would let packages/core skip registration entirely and
    // every core test would still pass, right up to the point where a real backend refuses.
    await expect(
      db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1))),
    ).rejects.toThrowError(AppError);
  });

  it("names the till in the refusal params", async () => {
    try {
      await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
      expect.unreachable("recordSale should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("fiscal.till_not_registered");
      expect((error as AppError).params).toEqual({ tillId: TILL_A });
    }
  });
});

describe("recordSale", () => {
  beforeEach(() => db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })));

  it("returns a ref naming the backend and the record", async () => {
    const ref = await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    expect(ref.backend).toBe("fake");
    expect(ref.recordId).toMatch(/^fake-/);
    expect(ref.state).toBe("pending");
  });

  it("stores the exact total it was given, digit for digit", async () => {
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    const [record] = await backend.recordsFor(TILL_A);
    expect(record.total).toBe("12.10");
  });

  it("rejects a total that is not an exact decimal string", async () => {
    // The money boundary, asserted at the interface rather than trusted. A number arriving
    // through an `as never` cast is exactly how a float reaches a fiscal record in practice.
    const sale = { ...saleOn(TILL_A, 1), total: 12.1 as never };
    await expect(db.transaction((tx) => backend.recordSale(tx, sale))).rejects.toThrowError(
      AppError,
    );
  });

  it("assigns strictly increasing sequences within a till", async () => {
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    const sequences = (await backend.recordsFor(TILL_A)).map((r) => r.sequence);
    expect(sequences).toEqual([1, 2]);
  });

  it("numbers tills independently of each other", async () => {
    await db.transaction((tx) => backend.registerTill(tx, TILL_B, { tenantId: TENANT }));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_B, 1)));
    expect((await backend.recordsFor(TILL_A)).map((r) => r.sequence)).toEqual([1]);
    expect((await backend.recordsFor(TILL_B)).map((r) => r.sequence)).toEqual([1]);
  });

  it("leaves no record behind when the transaction rolls back", async () => {
    // The single most important test in this file. The interface takes a transaction handle
    // BECAUSE atomicity between the sale and the fiscal record is the entire point, and a fake
    // holding an in-memory array cannot roll back — so a core test asserting "a failed sale
    // records nothing" would pass against the fake while the property was untested. The fake
    // therefore writes through the same transaction as everything else.
    await expect(
      db.transaction(async (tx) => {
        await backend.recordSale(tx, saleOn(TILL_A, 1));
        throw new Error("rolled back by the caller");
      }),
    ).rejects.toThrow();
    expect(await backend.recordsFor(TILL_A)).toEqual([]);
  });
});

describe("checkIntegrity", () => {
  beforeEach(() => db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })));

  it("reports how many records it checked, not merely that it is happy", async () => {
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    const report = await db.transaction((tx) => backend.checkIntegrity(tx, TILL_A));
    expect(report).toEqual({ ok: true, checked: 2, issues: [] });
  });

  it("reports zero checked on a till with no records, without complaining", async () => {
    // The start-of-chain case in generic clothing: nothing recorded is a normal state, not a
    // failure. A backend for a regime with nothing to check answers exactly this shape.
    const report = await db.transaction((tx) => backend.checkIntegrity(tx, TILL_A));
    expect(report).toEqual({ ok: true, checked: 0, issues: [] });
  });

  it("surfaces an injected issue", async () => {
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    backend.breakIntegrity(TILL_A, { code: "fake.tampered", params: { sequence: 1 } });
    const report = await db.transaction((tx) => backend.checkIntegrity(tx, TILL_A));
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([{ code: "fake.tampered", params: { sequence: 1 } }]);
  });

  it("still records the next sale after a failed check", async () => {
    // The requirement AEAT states outright: «la facturación por este motivo NUNCA debe
    // interrumpirse». Without an injectable failure the fake could not exercise this at all,
    // and packages/core would ship the opposite behaviour untested.
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    backend.breakIntegrity(TILL_A, { code: "fake.tampered", params: { sequence: 1 } });
    const ref = await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    expect(ref.recordId).toMatch(/^fake-/);
    expect((await backend.recordsFor(TILL_A)).map((r) => r.sequence)).toEqual([1, 2]);
  });

  it("recovers when the injected issue is cleared", async () => {
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    backend.breakIntegrity(TILL_A, { code: "fake.tampered", params: { sequence: 1 } });
    backend.restoreIntegrity(TILL_A);
    expect((await db.transaction((tx) => backend.checkIntegrity(tx, TILL_A))).ok).toBe(true);
  });
});

describe("pendingCount", () => {
  beforeEach(() => db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })));

  it("counts records that have not been acknowledged", async () => {
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    expect(await backend.pendingCount(TILL_A)).toBe(2);
  });

  it("drops when a record is acknowledged, so it is not a constant", async () => {
    // A stub returning the record count would pass the test above and fail this one. That pair
    // is the difference between a count and a number.
    const ref = await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    await backend.acknowledge(ref.recordId);
    expect(await backend.pendingCount(TILL_A)).toBe(1);
  });

  it("is scoped to one till", async () => {
    await db.transaction((tx) => backend.registerTill(tx, TILL_B, { tenantId: TENANT }));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    expect(await backend.pendingCount(TILL_B)).toBe(0);
  });

  it("is zero for a till that has never recorded anything", async () => {
    expect(await backend.pendingCount(TILL_A)).toBe(0);
  });
});

describe("recordVoid", () => {
  beforeEach(() => db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })));

  it("refuses to void a sale that was never recorded", async () => {
    const unknown = saleId("00000000-0000-0000-0000-000000000000");
    try {
      await db.transaction((tx) => backend.recordVoid(tx, unknown, "staff error"));
      expect.unreachable("recordVoid should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("fiscal.sale_not_recorded");
    }
  });

  it("records a second record rather than editing the first", async () => {
    // Once recorded, nothing is ever edited. A void is a new record referencing the old one,
    // and the two interleave in generation order.
    const sale = saleOn(TILL_A, 1);
    await db.transaction((tx) => backend.recordSale(tx, sale));
    const ref = await db.transaction((tx) => backend.recordVoid(tx, sale.saleId, "staff error"));
    const records = await backend.recordsFor(TILL_A);
    expect(records.map((r) => r.kind)).toEqual(["sale", "void"]);
    expect(records.map((r) => r.sequence)).toEqual([1, 2]);
    expect(ref.recordId).toBe(records[1].recordId);
  });
});
```

- [ ] **Step 5: Run each new test individually and watch it fail**

Expected: FAIL — unresolved import `./backend.js`.

Run every test name in both files on its own. Pay particular attention to "leaves no record behind when the transaction rolls back": a fake that has not been written yet trivially leaves nothing behind, so this test *must* be observed failing at import resolution and re-observed passing only after the fake writes through `tx`.

- [ ] **Step 6: Write the interface**

`packages/fiscal/src/backend.ts`:

```ts
import type { Decimal, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";

/**
 * The lifecycle of a fiscal record as the POS understands it. Regime-neutral: `recorded` means
 * the legally-required record exists locally, which in Spain is the point at which the sale is
 * compliant regardless of whether anything has been sent anywhere.
 */
export type FiscalState = "recorded" | "pending" | "acknowledged" | "rejected";

export interface TillRegistration {
  backend: string;
  tillId: TillId;
  /** Opaque to the POS. A número de instalación, a device id, or nothing meaningful at all. */
  registrationId: string;
  registeredAt: Date;
}

export interface VatBreakdownLine {
  rate: Decimal;
  base: Decimal;
  tax: Decimal;
  surchargeRate?: Decimal;
  surcharge?: Decimal;
}

export interface Counterparty {
  taxId: string;
  legalName: string;
  countryCode: string;
}

/**
 * Everything a regime could plausibly need about a completed sale, in English and in exact
 * decimals. Line descriptions are deliberately absent: they are a receipt-rendering concern and
 * reach no authority anywhere (spec §9), so putting them here would invite a backend to depend
 * on text that is locale-dependent and snapshotted per venue.
 */
export interface SaleForFiscalRecord {
  tenantId: TenantId;
  tillId: TillId;
  saleId: SaleId;
  seriesId: SeriesId;
  seriesCode: string;
  invoiceNumber: number;
  /** UTC. The offset travels beside it because the huso is fiscally meaningful, not display. */
  issuedAt: Date;
  offsetMinutes: number;
  descriptionOfOperation: string;
  total: Decimal;
  vatBreakdown: readonly VatBreakdownLine[];
  /** Null for a simplified invoice, which is the ordinary case at a till. */
  counterparty: Counterparty | null;
}

export interface FiscalRecordRef {
  backend: string;
  recordId: string;
  state: FiscalState;
  issuedAt: Date;
  offsetMinutes: number;
  /** Where a customer can verify the record, when the regime offers such a thing. */
  verificationUrl?: string;
}

/**
 * An issue found by `checkIntegrity`, as a code plus params rather than an AppError instance —
 * a report is persisted and displayed, and an Error does not survive JSON. A caller that wants
 * to render one rehydrates it into an AppError at the display boundary.
 */
export interface IntegrityIssue {
  code: string;
  params: Record<string, unknown>;
  recordId?: string;
}

export interface IntegrityReport {
  ok: boolean;
  /** How many records were examined. `ok: true` with `checked: 0` is a true and normal answer;
   * `ok` alone could not distinguish it from a thorough check that found nothing wrong. */
  checked: number;
  issues: readonly IntegrityIssue[];
}

/**
 * The only thing that crosses between the POS and a fiscal regime.
 *
 * Nothing in this file names a chain, a hash, a fingerprint or an authority, and a guard test
 * enforces that. Chaining is a regime requirement, not a POS one: a second backend arrives with
 * its own tables and its own vocabulary and changes nothing here.
 *
 * `drain(now)` and `reconcile(period)` are reserved names for plan 3 and are deliberately absent
 * until submission exists — see the reasoning recorded in that plan's Task 2 step. Do not
 * introduce `flush`, `sync` or `push` in their place.
 */
export interface FiscalBackend {
  registerTill(
    tx: Transaction,
    tillId: TillId,
    params: { tenantId: TenantId },
  ): Promise<TillRegistration>;

  /**
   * Takes a transaction handle. This is a deliberate leak: atomicity between the sale and the
   * fiscal record is the entire point of this interface, and hiding the transaction would let a
   * backend break it silently — the sale committed, the record not, discovered at an audit.
   */
  recordSale(tx: Transaction, sale: SaleForFiscalRecord): Promise<FiscalRecordRef>;

  recordVoid(tx: Transaction, saleId: SaleId, reason: string): Promise<FiscalRecordRef>;

  /**
   * Whatever this backend must check about what it has already recorded, before recording
   * anything more. The caller records the report and surfaces it to staff; it must NEVER branch
   * on `ok` to abandon the sale. No fiscal condition blocks a sale (spec §4), and a backend
   * whose regime has nothing to check answers `{ ok: true, checked: 0, issues: [] }`.
   */
  checkIntegrity(tx: Transaction, tillId: TillId): Promise<IntegrityReport>;

  /**
   * How many records this till has not yet had confirmed. The UI reads this, never the module's
   * own tables — verification stays entirely inside the module, and a UI reaching past this
   * method would drag both a regime vocabulary and a schema dependency into the presentation
   * layer at once.
   */
  pendingCount(tillId: TillId): Promise<number>;
}
```

- [ ] **Step 7: Write the fake**

`packages/fiscal/src/testing/fake-backend.ts`. A genuine test double, not a stub: it enforces the preconditions a real backend enforces, it participates in the caller's transaction so rollback is observable, and it can be told to fail.

```ts
import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { SaleId, TillId } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import type {
  FiscalBackend,
  FiscalRecordRef,
  IntegrityIssue,
  IntegrityReport,
  SaleForFiscalRecord,
  TillRegistration,
} from "../backend.js";

export interface FakeFiscalRecord {
  recordId: string;
  tillId: string;
  saleId: string;
  sequence: number;
  kind: "sale" | "void";
  invoiceNumber: number;
  total: string;
  state: string;
}

// Exactly the shape of a decimal literal @waitron/shared produces. Re-derived here rather than
// imported, because the point is to check what actually arrived at the boundary — importing the
// producer's own validator would make the check agree with the producer by construction.
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

let counter = 0;
const nextId = (): string => `fake-${String(++counter).padStart(8, "0")}`;

/**
 * An in-memory `FakeFiscalBackend` was rejected. The interface takes a transaction handle
 * because atomicity between the sale and the fiscal record is the property it exists to
 * guarantee, and an array in a field does not roll back — so every packages/core test asserting
 * "a failed sale records nothing" would have passed while testing nothing at all. This fake
 * writes to real tables through the caller's own transaction, which makes that property
 * observable and costs one CREATE TABLE in a test harness.
 */
export class FakeFiscalBackend implements FiscalBackend {
  private readonly injectedIssues = new Map<string, IntegrityIssue[]>();

  constructor(private readonly db: Database) {}

  static async install(db: Database): Promise<void> {
    await db.execute(sql`
      create table if not exists fake_till_registrations (
        till_id text primary key,
        tenant_id text not null,
        registration_id text not null,
        registered_at timestamptz not null default now()
      );
      create table if not exists fake_fiscal_records (
        record_id text primary key,
        tenant_id text not null,
        till_id text not null,
        sale_id text not null,
        sequence integer not null,
        kind text not null,
        invoice_number integer not null,
        total numeric(12, 2) not null,
        state text not null,
        unique (till_id, sequence)
      );
    `);
  }

  static async truncate(db: Database): Promise<void> {
    await db.execute(sql`truncate fake_fiscal_records, fake_till_registrations`);
  }

  async registerTill(
    tx: Transaction,
    tillId: TillId,
    params: { tenantId: string },
  ): Promise<TillRegistration> {
    const registrationId = nextId();
    await tx.execute(sql`
      insert into fake_till_registrations (till_id, tenant_id, registration_id)
      values (${tillId}, ${params.tenantId}, ${registrationId})
      on conflict (till_id) do update set registration_id = excluded.registration_id
    `);
    return { backend: "fake", tillId, registrationId, registeredAt: new Date() };
  }

  async recordSale(tx: Transaction, sale: SaleForFiscalRecord): Promise<FiscalRecordRef> {
    await this.assertRegistered(tx, sale.tillId);
    if (typeof sale.total !== "string" || !DECIMAL_PATTERN.test(sale.total)) {
      throw new AppError("shared.invalid_decimal", { value: String(sale.total) });
    }
    return this.append(tx, {
      tenantId: sale.tenantId,
      tillId: sale.tillId,
      saleId: sale.saleId,
      kind: "sale",
      invoiceNumber: sale.invoiceNumber,
      total: sale.total,
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
    });
  }

  async recordVoid(tx: Transaction, saleId: SaleId, _reason: string): Promise<FiscalRecordRef> {
    const rows = await tx.execute<{
      tenant_id: string;
      till_id: string;
      invoice_number: number;
      total: string;
    }>(sql`
      select tenant_id, till_id, invoice_number, total
      from fake_fiscal_records
      where sale_id = ${saleId} and kind = 'sale'
      limit 1
    `);
    const original = rows.rows[0];
    if (original === undefined) {
      throw new AppError("fiscal.sale_not_recorded", { saleId });
    }
    return this.append(tx, {
      tenantId: original.tenant_id,
      tillId: original.till_id,
      saleId,
      kind: "void",
      invoiceNumber: original.invoice_number,
      total: original.total,
      issuedAt: new Date(),
      offsetMinutes: 0,
    });
  }

  async checkIntegrity(tx: Transaction, tillId: TillId): Promise<IntegrityReport> {
    const rows = await tx.execute<{ count: string }>(sql`
      select count(*)::text as count from fake_fiscal_records where till_id = ${tillId}
    `);
    const checked = Number(rows.rows[0]?.count ?? "0");
    const issues = this.injectedIssues.get(tillId) ?? [];
    return { ok: issues.length === 0, checked, issues };
  }

  async pendingCount(tillId: TillId): Promise<number> {
    const rows = await this.db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from fake_fiscal_records
      where till_id = ${tillId} and state = 'pending'
    `);
    return Number(rows.rows[0]?.count ?? "0");
  }

  // ---- test-only affordances ------------------------------------------------------------

  /** Makes `checkIntegrity` report a failure. Without this the "records the next sale anyway"
   * requirement — the one AEAT states outright — could not be exercised at all. */
  breakIntegrity(tillId: TillId, issue: IntegrityIssue): void {
    this.injectedIssues.set(tillId, [...(this.injectedIssues.get(tillId) ?? []), issue]);
  }

  restoreIntegrity(tillId: TillId): void {
    this.injectedIssues.delete(tillId);
  }

  async acknowledge(recordId: string): Promise<void> {
    await this.db.execute(sql`
      update fake_fiscal_records set state = 'acknowledged' where record_id = ${recordId}
    `);
  }

  async recordsFor(tillId: TillId): Promise<FakeFiscalRecord[]> {
    const rows = await this.db.execute<FakeFiscalRecord & { sequence: number }>(sql`
      select record_id as "recordId", till_id as "tillId", sale_id as "saleId",
             sequence, kind, invoice_number as "invoiceNumber", total, state
      from fake_fiscal_records
      where till_id = ${tillId}
      order by sequence
    `);
    return rows.rows;
  }

  // ---- internals ------------------------------------------------------------------------

  private async assertRegistered(tx: Transaction, tillId: string): Promise<void> {
    const rows = await tx.execute<{ till_id: string }>(sql`
      select till_id from fake_till_registrations where till_id = ${tillId}
    `);
    if (rows.rows.length === 0) {
      throw new AppError("fiscal.till_not_registered", { tillId });
    }
  }

  private async append(
    tx: Transaction,
    entry: {
      tenantId: string;
      tillId: string;
      saleId: string;
      kind: "sale" | "void";
      invoiceNumber: number;
      total: string;
      issuedAt: Date;
      offsetMinutes: number;
    },
  ): Promise<FiscalRecordRef> {
    const recordId = nextId();
    const next = await tx.execute<{ sequence: number }>(sql`
      select coalesce(max(sequence), 0) + 1 as sequence
      from fake_fiscal_records
      where till_id = ${entry.tillId}
    `);
    const sequence = next.rows[0]?.sequence ?? 1;
    // UNIQUE (till_id, sequence) is the backstop, mirroring the real one. A fake that assigned
    // positions without a constraint would let a core test interleave two writes and still pass.
    await tx.execute(sql`
      insert into fake_fiscal_records
        (record_id, tenant_id, till_id, sale_id, sequence, kind, invoice_number, total, state)
      values
        (${recordId}, ${entry.tenantId}, ${entry.tillId}, ${entry.saleId}, ${sequence},
         ${entry.kind}, ${entry.invoiceNumber}, ${entry.total}, 'pending')
    `);
    return {
      backend: "fake",
      recordId,
      state: "pending",
      issuedAt: entry.issuedAt,
      offsetMinutes: entry.offsetMinutes,
    };
  }
}
```

```bash
cd packages/fiscal
pnpm vitest run src/backend.test.ts src/testing/fake-backend.test.ts
```

Expected: PASS, 24 tests.

- [ ] **Step 8: Write the regime-vocabulary guard**

`packages/fiscal/src/no-regime-vocabulary.test.ts`. Task 3's English-only guard catches Spanish; this one catches something narrower and easier to miss — **regime vocabulary written in English is still regime vocabulary**, and `verifyChainBeforeWrite` would have passed the Spanish check without difficulty.

```ts
import { describe, expect, it } from "vitest";

const sources = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("the source glob itself", () => {
  it("discovers backend.ts, clock.ts and the fake", () => {
    // Without this, every check below passes vacuously against an empty set — the exact shape
    // of vacuous test this project has already shipped seven of.
    const names = Object.keys(sources);
    expect(names.some((n) => n.endsWith("backend.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith("clock.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith("fake-backend.ts"))).toBe(true);
  });
});

// Chaining is a regime requirement, not a POS one (spec §2). A second backend — TicketBAI,
// Italy's SdI, Portugal's ATCUD — brings its own tables and its own vocabulary and touches
// nothing in this package. Every term below names a mechanism that belongs on the other side of
// the boundary; `verifyChainBeforeWrite`, from this plan's own signature list, fails on the
// first of them, which is why it is `checkIntegrity` instead.
const FORBIDDEN = [
  "chain",
  "huella",
  "hash",
  "fingerprint",
  "encadenamiento",
  "registro",
  "cadena",
  "aeat",
  "verifactu",
  "ticketbai",
  "sif",
  "csv",
  "incidencia",
];

describe("no regime vocabulary appears in packages/fiscal", () => {
  for (const term of FORBIDDEN) {
    it.each(Object.entries(sources))(`%s does not mention "${term}"`, (_path, source) => {
      // Word-boundary matched and case-insensitive: `Chain`, `CHAIN` and `chainHead` are all the
      // same violation, while `unchained` in ordinary prose is not — there is none, and if
      // there ever is, rewording the prose is cheaper than weakening the rule.
      expect(source.toLowerCase()).not.toMatch(new RegExp(`\\b${term}`));
    });
  }
});

describe("the guard has teeth", () => {
  it("would reject the name this plan's signature list originally carried", () => {
    // Pinned as an executable statement of the decision recorded in Task 11 Step 1, so a future
    // reader who wonders why the method is not called verifyChainBeforeWrite gets an answer
    // from the test suite rather than from a commit message.
    expect("verifyChainBeforeWrite".toLowerCase()).toMatch(/\bchain/);
  });

  it("would reject registerSif for the same reason", () => {
    expect("registerSif".toLowerCase()).toMatch(/\bsif/);
  });
});
```

- [ ] **Step 9: Extend the public surface**

`packages/fiscal/src/index.ts`:

```ts
// The entire public surface of @waitron/fiscal. Re-exports only — no logic here.
export { createTrustedClock } from "./clock.js";
export type {
  ClockConfidence,
  MonotonicSource,
  TrustedClock,
  TrustedClockOptions,
  TrustedReading,
  TrustedTimeAnchor,
  TrustedTimeSource,
} from "./clock.js";
export type {
  Counterparty,
  FiscalBackend,
  FiscalRecordRef,
  FiscalState,
  IntegrityIssue,
  IntegrityReport,
  SaleForFiscalRecord,
  TillRegistration,
  VatBreakdownLine,
} from "./backend.js";
// The fake is NOT re-exported here. packages/core imports it from
// "@waitron/fiscal/src/testing/fake-backend.js" in test files only, so a production import of
// the package surface cannot reach a test double by autocomplete.
```

- [ ] **Step 10: Teeth check — break it and watch it scream**

Confirm these tests have teeth rather than merely executing the code.

Temporarily rename `checkIntegrity` to `verifyChainBeforeWrite` throughout `backend.ts`:

```bash
pnpm vitest run src/no-regime-vocabulary.test.ts
```

Expected: FAIL — `backend.ts does not mention "chain"`. Restore it. This is the mechanical answer to the naming question, and it is why the rule is a test rather than a convention in a document.

Temporarily replace the fake's persistence with an in-memory array:

```ts
private readonly records: FakeFiscalRecord[] = [];
```

```bash
pnpm vitest run src/testing/fake-backend.test.ts
```

Expected: FAIL — "leaves no record behind when the transaction rolls back". Restore it. Nothing else in the suite notices, which is exactly the point: an in-memory fake is indistinguishable from a correct one until something rolls back, and by then it has been silently vouching for atomicity across every test in `packages/core`.

Temporarily make `checkIntegrity` ignore the injected issues and always return `ok: true`:

Expected: FAIL — "surfaces an injected issue" and "recovers when the injected issue is cleared". Restore it.

Temporarily delete the `assertRegistered` call from `recordSale`:

Expected: FAIL — "refuses to record a sale for a till that was never registered" and "names the till in the refusal params". Restore it.

Temporarily make `pendingCount` return the total record count rather than the pending count:

Expected: FAIL — "drops when a record is acknowledged, so it is not a constant". Restore it. Note that "counts records that have not been acknowledged" still passes under this mutation — one test alone could not tell a count from a number.

Temporarily remove the `DECIMAL_PATTERN` check from `recordSale`:

Expected: FAIL — "rejects a total that is not an exact decimal string". Restore it.

Temporarily narrow the glob in `no-regime-vocabulary.test.ts` to `["./nothing-*.ts"]`:

Expected: FAIL — "discovers backend.ts, clock.ts and the fake". Restore it.

If any mutation leaves the suite green, a test is missing.

- [ ] **Step 11: Run everything, then commit**

```bash
pnpm install
pnpm --filter @waitron/fiscal typecheck
pnpm --filter @waitron/fiscal test
pnpm --filter @waitron/fiscal test:coverage
pnpm lint
./node_modules/.bin/prettier --check "packages/fiscal/**/*.{ts,json}"
```

Expected: typecheck passes with no output; PASS, 90 tests; coverage at or above every threshold; lint passes; format check passes.

```bash
git add packages/fiscal pnpm-lock.yaml
git commit -m "feat(fiscal): the regime-neutral FiscalBackend interface and its fake

The chain does not appear in this package, and a guard test enforces it
rather than a convention in a document. Two names from the plan's signature
list were changed on those grounds: verifyChainBeforeWrite names a structure
a clearance-based regime does not have and prescribes what to verify rather
than asking what packages/core needs to know, so it is checkIntegrity;
registerSif puts a Spanish regulatory acronym into a package the constraints
declare English throughout, so it is registerTill. A regime with nothing to
check answers { ok: true, checked: 0, issues: [] }, which is a true statement
rather than a stub — that is the test of whether a name generalises.

drain and reconcile are deliberately absent until plan 3 designs flow
control, error-3000 resolution and CSV persistence, all of which constrain
their return types. An interface method with no caller and no meaningful fake
is dead surface that mutation testing cannot reach. The names are reserved in
a comment so plan 3 does not arrive with flush or sync instead.

FakeFiscalBackend writes through the caller's transaction rather than into an
array. An in-memory fake cannot roll back, so every packages/core test
asserting that a failed sale records nothing would have passed while testing
nothing — and atomicity between the sale and the fiscal record is the entire
reason the interface takes a transaction handle in the first place. It also
refuses an unregistered till, refuses a total that is not an exact decimal,
and can be told to fail its integrity check, because the requirement that a
failed check never stops the next sale cannot be exercised otherwise."
```

---
## Task 12: `packages/fiscal-verifactu` schema, and migration composition across packages

The module owns its own tables, in Spanish, and its migrations compose with core's without either
package knowing the other's journal. Its deliverable is a smoke test that applies both sets in
order against an empty database — and a second test proving that smoke test is not vacuous.

**Files:**

- Create: `packages/fiscal-verifactu/package.json`
- Create: `packages/fiscal-verifactu/tsconfig.json`
- Create: `packages/fiscal-verifactu/vitest.config.ts`
- Create: `packages/fiscal-verifactu/drizzle.config.ts`
- Create: `packages/fiscal-verifactu/src/index.ts`
- Create: `packages/fiscal-verifactu/src/schema/index.ts`
- Create: `packages/fiscal-verifactu/src/schema/registros.ts`
- Create: `packages/fiscal-verifactu/src/schema/cadenas.ts`
- Create: `packages/fiscal-verifactu/src/schema/sif.ts`
- Create: `packages/fiscal-verifactu/src/schema/envios.ts`
- Create: `packages/fiscal-verifactu/src/migrations.test.ts`
- Create: `packages/fiscal-verifactu/src/schema-ownership.test.ts`
- Create: `packages/fiscal-verifactu/src/inmutabilidad.test.ts`
- Create: `packages/fiscal-verifactu/src/vocabulary-scope.test.ts`
- Create (generated): `packages/fiscal-verifactu/drizzle/0000_*.sql` + `drizzle/meta/`
- Create (hand-written): `packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql`
- Modify: `packages/db/src/index.ts` (export `CORE_MIGRATIONS`)
- Modify: `.prettierignore` (exclude generated migration SQL)

**Interfaces:**

- Consumes: `tenants`, `tills`, `sales`, `runMigrations`, `createPgliteDb`, `withTenant`, `asAppUser`,
  `ENGLISH_SOURCE_GLOBS`, `spanishTokensIn` from `@waitron/db`.
- Produces:
  - tables `registros_facturacion`, `cadenas`, `registro_sif`, `contadores_instalacion`, `envios`
  - `FISCAL_MIGRATIONS: { migrationsFolder: string; migrationsTable: string }`
  - `CORE_MIGRATIONS` on `@waitron/db`, the same shape

- [ ] **Step 1: Scaffold the package**

`packages/fiscal-verifactu/package.json`:

```json
{
  "name": "@waitron/fiscal-verifactu",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@waitron/db": "workspace:*",
    "@waitron/fiscal": "workspace:*",
    "@waitron/shared": "workspace:*",
    "@waitron/verifactu": "workspace:*",
    "drizzle-orm": "0.45.2"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.5.4",
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "drizzle-kit": "^0.31.10",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

There is no `mutation` script. Every test in this package boots PGlite, so its cost profile is
`packages/ui`'s, not `packages/verifactu`'s — Stryker reruns the suite per mutant and a WASM
Postgres boot per mutant is not a per-PR gate anyone will keep. The adversarial-mutation step at
the end of this task is the substitute, and it is manual by design.

`packages/fiscal-verifactu/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vitest/globals"]
  },
  "include": ["src", "test", "drizzle.config.ts"]
}
```

`packages/fiscal-verifactu/vitest.config.ts`:

```ts
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // PGlite boots a WASM PostgreSQL and then applies two migration sets. Vitest's default 5s
    // testTimeout is a live risk here, not a theoretical one: the ordering test boots a second
    // database inside a single `it`. 60s is chosen to be far above the worst observed cold boot
    // on CI rather than tuned to the median, because a flaky timeout in a migration suite reads
    // as a migration defect and costs an afternoon.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude, "drizzle.config.ts", "drizzle/**"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
```

`packages/fiscal-verifactu/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // `out` is a SINGLE STRING. The published types render it `string | string[]`; the second arm
  // does not work. One config produces exactly one migration folder, which is precisely why this
  // package needs its own config rather than an entry in core's.
  out: "./drizzle",
  // Pointed at the entrypoint, NOT a `src/schema/*.ts` glob. drizzle-kit builds its snapshot from
  // the values this module exports, so the explicit export list in `schema/index.ts` IS the
  // snapshot's table list. A glob would sweep up anything a schema file happened to re-export.
  schema: "./src/schema/index.ts",
  // Its own journal table. Sharing core's would make each package's `generate` see the other's
  // applied migrations as unknown and silently attempt to re-apply its own from zero.
  migrations: { table: "__drizzle_migrations_fiscal", schema: "drizzle" },
});
```

`packages/fiscal-verifactu/src/index.ts`:

```ts
// The public surface of @waitron/fiscal-verifactu. Re-exports only.
export { FISCAL_MIGRATIONS } from "./migrations.js";
export { cadenas, contadoresInstalacion, envios, registroSif, registrosFacturacion } from "./schema/index.js";
```

`packages/fiscal-verifactu/src/migrations.ts`:

```ts
import { fileURLToPath } from "node:url";

/**
 * This package's migration set. Exported as data rather than as a `runFiscalMigrations()`
 * function because ordering is the RUNTIME's responsibility — nothing in Drizzle enforces that
 * core migrations run before module ones, and a function that ran them itself would invite a
 * caller to run it first. Handing back a descriptor makes the caller state the order out loud.
 */
export const FISCAL_MIGRATIONS = {
  // Resolved from this module's own URL. `main` points at TS source and there is no build step,
  // so a path relative to cwd would resolve differently under `pnpm -r test` than under
  // `pnpm --filter … test`.
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_fiscal",
} as const;
```

`packages/db/src/index.ts` — append the matching descriptor:

```ts
export const CORE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations",
} as const;
```

- [ ] **Step 2: Write the schema files**

`packages/fiscal-verifactu/src/schema/registros.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sales, tenants, tills } from "@waitron/db";
import { registroSif } from "./sif.js";

/**
 * The immutable registro de facturación. Real columns, not an opaque payload, because this is
 * the table the module queries: the outbox drains by `(tenant_id, estado, proximo_intento_en)`,
 * reconciliation filters by período de imputación, and art. 7.i verification walks predecessors
 * by identity. A jsonb blob would make every one of those a full scan plus a deserialise.
 *
 * Two columns are jsonb, and the rule that puts them there is narrow: a value earns its own
 * column when something queries, joins or constrains it.
 *
 * - `desglose` is a repeating group of 1–12 entries containing an xsd:choice. In columns that
 *   means a child table — and a child table of an immutable parent needs its own revocation, its
 *   own pair of triggers and its own RLS policy, all to serve a query nobody makes. The desglose
 *   is hashed as a unit and re-serialised as a unit; it is never filtered on.
 * - `sistema_informatico` is a nine-field snapshot whose whole purpose is byte-reproduction: a
 *   registro re-hashed in 2032 must produce the same huella it produced today, including fields
 *   whose meaning has since changed. The identity-bearing parts of it — `numero_instalacion` and
 *   `id_sistema_informatico` — are already real, unique-constrained columns on `registro_sif`.
 *   This is a frozen copy of a row that also exists relationally, and splitting it into nine
 *   columns invites exactly the backfill that would silently invalidate every stored huella.
 */
export const registrosFacturacion = pgTable(
  "registros_facturacion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    tillId: uuid("till_id")
      .notNull()
      .references(() => tills.id),
    // Which SIF identity generated this record. A new NúmeroInstalación is a new SIF, therefore a
    // new chain (findings §1), and this column is what makes "which chain" a fact on the row
    // rather than an inference from dates.
    sifId: uuid("sif_id")
      .notNull()
      .references(() => registroSif.id),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id),
    // OUR ordering aid for the outbox. NOT AEAT's — AEAT has no sequence number. It is never a
    // substitute for the four-part predecessor pointer below, and it is NEVER derived from or
    // validated against the invoice counter (spec §3, findings §1): chain position is
    // chronological by generation within the SIF and is unrelated to invoice number. AEAT's own
    // sample chains invoice 12345 to predecessor invoice 44.
    secuencia: integer("secuencia").notNull(),
    tipoRegistro: text("tipo_registro").notNull(),
    idEmisorFactura: text("id_emisor_factura").notNull(),
    numSerieFactura: text("num_serie_factura").notNull(),
    fechaExpedicionFactura: date("fecha_expedicion_factura").notNull(),
    nombreRazonEmisor: text("nombre_razon_emisor").notNull(),
    // Null on an anulación — RegistroAnulacion carries no TipoFactura at all.
    tipoFactura: text("tipo_factura"),
    descripcionOperacion: text("descripcion_operacion"),
    desglose: jsonb("desglose"),
    cuotaTotal: numeric("cuota_total", { precision: 12, scale: 2 }),
    importeTotal: numeric("importe_total", { precision: 12, scale: 2 }),
    // The Encadenamiento xsd:choice, flattened. Exactly one arm, enforced by CHECK below.
    primerRegistro: boolean("primer_registro").notNull(),
    anteriorIdEmisorFactura: text("anterior_id_emisor_factura"),
    anteriorNumSerieFactura: text("anterior_num_serie_factura"),
    anteriorFechaExpedicionFactura: date("anterior_fecha_expedicion_factura"),
    anteriorHuella: text("anterior_huella"),
    sistemaInformatico: jsonb("sistema_informatico").notNull(),
    fechaHoraHusoGenRegistro: timestamp("fecha_hora_huso_gen_registro", {
      withTimezone: true,
    }).notNull(),
    // timestamptz normalises to UTC and renders in the SESSION's zone, so the original `+01:00`
    // is gone the moment it is stored. The huella hashes the literal INCLUDING that offset, so
    // without this column a stored registro cannot be re-hashed and art. 7.i verification would
    // compare against a value it can no longer reproduce.
    offsetMinutos: integer("offset_minutos").notNull(),
    tipoHuella: text("tipo_huella").notNull(),
    huella: text("huella").notNull(),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // THE non-negotiable backstop against two writers claiming one chain position — a real risk
    // with a PWA that can have several tabs open. Measured on real Postgres, a naive
    // read-then-write committed 3 of 20 concurrent appends and the chain stayed intact ONLY
    // because of this constraint.
    uniqueIndex("registros_tenant_till_secuencia_uq").on(t.tenantId, t.tillId, t.secuencia),
    // AEAT record identity is IDEmisorFactura + NumSerieFactura + FechaExpedicionFactura, and a
    // duplicate returns error 3000. `tipo_registro` joins the key because an alta and its
    // anulación legitimately share the triple.
    uniqueIndex("registros_identidad_uq").on(
      t.tenantId,
      t.idEmisorFactura,
      t.numSerieFactura,
      t.fechaExpedicionFactura,
      t.tipoRegistro,
    ),
    index("registros_sale_idx").on(t.tenantId, t.saleId),
    index("registros_till_secuencia_idx").on(t.tenantId, t.tillId, t.secuencia),
    check("registros_tipo_registro_ck", sql`${t.tipoRegistro} in ('alta', 'anulacion')`),
    check("registros_tipo_huella_ck", sql`${t.tipoHuella} = '01'`),
    check("registros_huella_ck", sql`${t.huella} ~ '^[0-9A-F]{64}$'`),
    check("registros_secuencia_ck", sql`${t.secuencia} > 0`),
    check(
      "registros_encadenamiento_ck",
      sql`(${t.primerRegistro}
             and ${t.anteriorIdEmisorFactura} is null
             and ${t.anteriorNumSerieFactura} is null
             and ${t.anteriorFechaExpedicionFactura} is null
             and ${t.anteriorHuella} is null)
           or (not ${t.primerRegistro}
             and ${t.anteriorIdEmisorFactura} is not null
             and ${t.anteriorNumSerieFactura} is not null
             and ${t.anteriorFechaExpedicionFactura} is not null
             and ${t.anteriorHuella} is not null)`,
    ),
  ],
).enableRLS();
```

`packages/fiscal-verifactu/src/schema/cadenas.ts`:

```ts
import { sql } from "drizzle-orm";
import { check, pgTable, integer, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants, tills } from "@waitron/db";
import { registrosFacturacion } from "./registros.js";

/**
 * The chain head — MUTABLE, unlike everything it points at. One row per (tenant, till), row-locked
 * with FOR UPDATE during append.
 *
 * The predecessor's serie/número/fecha are deliberately NOT denormalised here. Building the
 * four-part Encadenamiento pointer costs one join to `ultimo_registro_id` under a lock we are
 * already holding, whereas a copy on this mutable row would be a second source of truth for four
 * values that must match the immutable row exactly — and the mutable copy is the one that can
 * drift.
 */
export const cadenas = pgTable(
  "cadenas",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    tillId: uuid("till_id")
      .notNull()
      .references(() => tills.id),
    // Monotonic across SIF identities and NEVER reset. Re-registration breaks the chain POINTER
    // (below), not the counter: resetting to zero would collide head-on with
    // `registros_tenant_till_secuencia_uq`, and the sequence is ours anyway.
    secuencia: integer("secuencia").notNull().default(0),
    ultimoRegistroId: uuid("ultimo_registro_id").references(() => registrosFacturacion.id),
    ultimaHuella: text("ultima_huella"),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.tillId] }),
    // Both null (a fresh or re-registered chain) or neither. A half-set pointer would make
    // PrimerRegistro ambiguous, and PrimerRegistro must follow from local state unambiguously.
    check("cadenas_puntero_ck", sql`(${t.ultimoRegistroId} is null) = (${t.ultimaHuella} is null)`),
  ],
).enableRLS();
```

`packages/fiscal-verifactu/src/schema/sif.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants, tills } from "@waitron/db";

/**
 * A SIF identity: NIF + IdSistemaInformatico + NúmeroInstalación (findings §1). Append-mostly —
 * a till that re-registers gets a NEW row, and the old one is marked revoked rather than updated,
 * because the old identity's registros are immutable and must keep pointing at the identity that
 * actually generated them.
 */
export const registroSif = pgTable(
  "registro_sif",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    tillId: uuid("till_id")
      .notNull()
      .references(() => tills.id),
    nif: text("nif").notNull(),
    idSistemaInformatico: text("id_sistema_informatico").notNull(),
    numeroInstalacion: integer("numero_instalacion").notNull(),
    registradoEn: timestamp("registrado_en", { withTimezone: true }).notNull().defaultNow(),
    revocadoEn: timestamp("revocado_en", { withTimezone: true }),
  },
  (t) => [
    // `NºInstalación` "no puede repetirse nunca". This index — not the allocator, not a code
    // review, not a spreadsheet — is what makes that true. Note it enforces across tenants even
    // under FORCE ROW LEVEL SECURITY: unique constraints are not RLS-filtered, so a conflicting
    // row you cannot SELECT still raises 23505.
    uniqueIndex("registro_sif_instalacion_uq").on(
      t.nif,
      t.idSistemaInformatico,
      t.numeroInstalacion,
    ),
    // At most one live identity per till. Partial, so revoked rows accumulate freely.
    uniqueIndex("registro_sif_activo_uq")
      .on(t.tenantId, t.tillId)
      .where(sql`${t.revocadoEn} is null`),
    check("registro_sif_numero_ck", sql`${t.numeroInstalacion} > 0`),
  ],
).enableRLS();

/**
 * The upstream allocator's counter, one row per (NIF, IdSIF).
 *
 * Rejected alternative: `coalesce(max(numero_instalacion), 0) + 1` over `registro_sif`. That
 * derives never-reuse from never-deleting, which makes a routine housekeeping DELETE a compliance
 * breach with no error message — a wiped-and-re-registered till would silently be handed a number
 * a previous installation had already used, and AEAT would see two SIFs with one identity. A
 * counter row is independent of the retention of anything.
 *
 * Deliberately carries NO `tenant_id` and NO RLS. It is keyed by NIF, which IS the obligado
 * tributario for this purpose, and a single writer cannot guarantee uniqueness over rows a policy
 * hides from it: an RLS predicate here would silently let two tenants sharing a NIF allocate the
 * same number.
 */
export const contadoresInstalacion = pgTable(
  "contadores_instalacion",
  {
    nif: text("nif").notNull(),
    idSistemaInformatico: text("id_sistema_informatico").notNull(),
    proximoNumero: integer("proximo_numero").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.nif, t.idSistemaInformatico] })],
);
```

`packages/fiscal-verifactu/src/schema/envios.ts`:

```ts
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";
import { registrosFacturacion } from "./registros.js";

/**
 * The submission SIDECAR — 1:1 with a registro, holding the delivery state that mutates
 * constantly. It exists because `registros_facturacion` is immutable, and submission state cannot
 * live on an immutable table. Same split that separated sales from fiscal records, applied once
 * more: immutable fact, mutable delivery state.
 *
 * It also preserves the property wanted from an outbox-as-projection — chain order has exactly
 * one source of truth, and this table never reorders anything, only records what happened to each
 * row.
 *
 * THIS PLAN ONLY WRITES ROWS HERE, in `pendiente`. The drainer — batching, flow control, retry,
 * CSV persistence, error-3000 resolution, Incidencia="S", acks — is plan 3. Every column it will
 * need is created now, because adding columns to a table the write path already populates is a
 * migration against live fiscal data.
 */
export const envios = pgTable(
  "envios",
  {
    // The registro id IS the primary key. 1:1 becomes structural rather than conventional: there
    // is no shape of this table in which a registro can have two envío rows.
    registroId: uuid("registro_id")
      .primaryKey()
      .references(() => registrosFacturacion.id),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    estado: text("estado").notNull().default("pendiente"),
    intentos: integer("intentos").notNull().default(0),
    // Persisted, never an in-memory timer. This is what makes art. 16.4's hourly duty survive a
    // restart and a week-long offline period.
    proximoIntentoEn: timestamp("proximo_intento_en", { withTimezone: true }).notNull().defaultNow(),
    incidencia: boolean("incidencia").notNull().default(false),
    // Written in the same transaction as the response that carried it. AEAT: the CSV "no podrá
    // ser recuperado a través de consultas posteriores" — neither consulta nor resubmission ever
    // returns it, so losing it is unrecoverable.
    csv: text("csv"),
    codigoError: text("codigo_error"),
    mensajeError: text("mensaje_error"),
    enviadoEn: timestamp("enviado_en", { withTimezone: true }),
    confirmadoEn: timestamp("confirmado_en", { withTimezone: true }),
  },
  (t) => [
    // The drainer's access path: batched per obligado tributario, oldest due first.
    index("envios_drenaje_idx").on(t.tenantId, t.estado, t.proximoIntentoEn),
    check(
      "envios_estado_ck",
      sql`${t.estado} in ('pendiente', 'enviando', 'aceptado', 'aceptado_con_errores', 'rechazado', 'detenido')`,
    ),
  ],
).enableRLS();
```

`packages/fiscal-verifactu/src/schema/index.ts`:

```ts
// The Drizzle snapshot is built from THIS file's exports. Every name below is written out
// explicitly — never `export *`, and never a core table — because this list is the thing that
// decides what `drizzle-kit generate` emits a CREATE TABLE for.
//
// The schema files above `import` core tables to declare foreign keys. They must NEVER re-export
// them: a re-export pulls the core table into this package's snapshot and generates a duplicate
// CREATE TABLE, which then fails at apply time against a database where core already created it.
// `schema-ownership.test.ts` enforces this, because a comment does not survive contact with a
// future contributor.
export { cadenas } from "./cadenas.js";
export { envios } from "./envios.js";
export { registrosFacturacion } from "./registros.js";
export { contadoresInstalacion, registroSif } from "./sif.js";
```

- [ ] **Step 3: Write the failing tests**

`packages/fiscal-verifactu/src/schema-ownership.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

/** Exactly the tables this package owns. Adding a table means editing this line, deliberately. */
const OWNED = [
  "cadenas",
  "contadores_instalacion",
  "envios",
  "registro_sif",
  "registros_facturacion",
];

/** Every table `packages/db` owns. None of these may ever appear in this package's output. */
const CORE = [
  "invoice_series",
  "locations",
  "sale_lines",
  "sales",
  "tenants",
  "tenders",
  "tills",
  "working_order_lines",
  "working_orders",
];

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

function generatedSql(): string {
  return readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(drizzleDir, f), "utf8"))
    .join("\n")
    .toLowerCase();
}

describe("the fiscal schema entrypoint owns exactly its own tables", () => {
  it("exports no table this package does not own", () => {
    // This inspects the same thing drizzle-kit inspects — the exported VALUES of the snapshot
    // entrypoint — so it fails for exactly the reason a duplicate CREATE TABLE would appear.
    // A textual grep for `export ... from "@waitron/db"` would miss `export const sales = ...`
    // and every aliased form.
    const exported = Object.values(schema)
      .filter((v) => is(v, PgTable))
      .map((t) => getTableName(t))
      .sort();
    expect(exported).toEqual([...OWNED].sort());
  });

  it("emits a CREATE TABLE for its own tables", () => {
    // The positive control. Without it the three negative assertions below would pass against an
    // empty string — the exact vacuous shape that let seven tests through in plan 1.
    const sqlText = generatedSql();
    for (const table of OWNED) {
      expect(sqlText).toContain(`create table "${table}"`);
    }
  });

  it("emits no CREATE TABLE for any core table", () => {
    const sqlText = generatedSql();
    for (const table of CORE) {
      expect(sqlText).not.toContain(`create table "${table}"`);
    }
  });

  it("does emit foreign keys onto core tables", () => {
    // Importing core tables is not merely allowed, it is required — and this asserts the import
    // actually produced something, so a future "fix" that deletes the imports to silence the
    // re-export test is caught. It is also what makes the ordering test in migrations.test.ts
    // non-vacuous: no cross-package FK, no ordering requirement to test.
    const sqlText = generatedSql();
    expect(sqlText).toContain(`references "public"."sales"`);
    expect(sqlText).toContain(`references "public"."tills"`);
  });
});
```

`packages/fiscal-verifactu/src/migrations.test.ts`:

```ts
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FISCAL_MIGRATIONS } from "./migrations.js";

/** A fresh in-memory PGlite with nothing in it at all. */
async function emptyDb() {
  return createPgliteDb();
}

async function tableNames(db: Awaited<ReturnType<typeof emptyDb>>): Promise<string[]> {
  const rows = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
  );
  return rows.rows.map((r) => r.table_name);
}

async function journalCount(db: Awaited<ReturnType<typeof emptyDb>>, table: string) {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from "drizzle".${sql.identifier(table)}`,
  );
  return rows.rows[0]?.n ?? 0;
}

describe("migration composition across packages", () => {
  it("applies core then fiscal against an empty database", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    const names = await tableNames(db);
    // Core's tables and the module's tables coexist in one schema, created by two independent
    // migration sets that know nothing of each other.
    expect(names).toContain("sales");
    expect(names).toContain("tills");
    expect(names).toContain("registros_facturacion");
    expect(names).toContain("cadenas");
    expect(names).toContain("registro_sif");
    expect(names).toContain("envios");
  });

  it("keeps the two journals separate", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    // Two tables, both non-empty. One shared journal would make each package's next `generate`
    // read the other's entries as unknown and re-apply its own set from zero.
    expect(await journalCount(db, "__drizzle_migrations")).toBeGreaterThan(0);
    expect(await journalCount(db, "__drizzle_migrations_fiscal")).toBeGreaterThan(0);
    expect(CORE_MIGRATIONS.migrationsTable).not.toBe(FISCAL_MIGRATIONS.migrationsTable);
    expect(CORE_MIGRATIONS.migrationsFolder).not.toBe(FISCAL_MIGRATIONS.migrationsFolder);
  });

  it("is idempotent — running both sets twice is a no-op", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    const before = [
      await journalCount(db, "__drizzle_migrations"),
      await journalCount(db, "__drizzle_migrations_fiscal"),
      (await tableNames(db)).length,
    ];

    // No throw, and nothing applied a second time. The custom SQL in 0001 uses no IF NOT EXISTS
    // guards, so a re-application would raise 42710 (duplicate_object) rather than pass quietly —
    // which is the reason this test asserts on a fresh run rather than on the counts alone.
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    expect([
      await journalCount(db, "__drizzle_migrations"),
      await journalCount(db, "__drizzle_migrations_fiscal"),
      (await tableNames(db)).length,
    ]).toEqual(before);
  });

  it("fails when fiscal runs before core", async () => {
    // THIS is what makes the first test mean anything. Ordering is the runtime's responsibility —
    // Drizzle enforces nothing — so a smoke test that would also pass with the sets applied in
    // the wrong order tests nothing at all. The failure is real: registros_facturacion declares a
    // foreign key onto `sales`, and 0001 revokes privileges from a role core creates.
    const db = await emptyDb();
    await expect(runMigrations(db, FISCAL_MIGRATIONS)).rejects.toThrow(/sales|does not exist/i);

    // And the database is not half-built afterwards.
    expect(await tableNames(db)).not.toContain("registros_facturacion");
  });
});
```

> The ordering test asserts on a message pattern rather than a SQLSTATE, because the error
> surfaces through Drizzle's migrator wrapper and its exact shape is not contracted.
> **Resolve this when implementing: run it once, read the real error, and tighten the matcher to
> the specific relation name it actually reports.** A `/does not exist/i` that matches some
> unrelated failure would turn this into a test that passes for the wrong reason — the same class
> of defect it exists to prevent.

`packages/fiscal-verifactu/src/inmutabilidad.test.ts`:

```ts
import {
  CORE_MIGRATIONS,
  asAppUser,
  createPgliteDb,
  runMigrations,
  withTenant,
} from "@waitron/db";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { seedTenantTillSif, TENANT_A } from "../test/fixtures.js";

let db: Awaited<ReturnType<typeof createPgliteDb>>;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, FISCAL_MIGRATIONS);
  await seedTenantTillSif(db);
});

/** Runs `fn` inside a tenant transaction, as the non-owner application role. */
async function asApp<T>(fn: (tx: never) => Promise<T>): Promise<T> {
  return withTenant(db, TENANT_A.id, async (tx) => {
    await asAppUser(tx);
    return fn(tx as never);
  });
}

describe("registros_facturacion is immutable, as the app role", () => {
  it("is actually running as the non-owner application role", async () => {
    // Without this the whole file is theatre. Migrations run as owner; PGlite's default
    // connection is a SUPERUSER, and superusers bypass RLS and can DISABLE TRIGGER. A suite that
    // forgets `set local role` passes green while asserting nothing.
    const who = await asApp(async (tx) =>
      (await (tx as never as typeof db).execute<{ u: string; s: boolean }>(
        sql`select current_user as u, (select usesuper from pg_user where usename = current_user) as s`,
      )).rows[0],
    );
    expect(who?.u).toBe("app_user");
    expect(who?.s).toBe(false);
  });

  it("permits INSERT", async () => {
    // The control. Without it, the three rejection tests below would all pass against a role that
    // simply has no access to the table at all — proving nothing about immutability.
    await expect(asApp(async (tx) => insertRegistro(tx as never as typeof db, 1))).resolves.toBeDefined();
  });

  it("rejects UPDATE with insufficient_privilege", async () => {
    await asApp(async (tx) => {
      const d = tx as never as typeof db;
      await insertRegistro(d, 2);
      await expect(
        d.execute(sql`update registros_facturacion set huella = repeat('A', 64)`),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("rejects DELETE with insufficient_privilege", async () => {
    await asApp(async (tx) => {
      const d = tx as never as typeof db;
      await insertRegistro(d, 3);
      await expect(d.execute(sql`delete from registros_facturacion`)).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  it("rejects UPDATE by trigger even when the privilege is granted", async () => {
    // The layered proof. Revocation fires first, so the two tests above never reach the trigger —
    // and a trigger nobody has ever seen fire is not a backstop, it is a comment. Grant the
    // privilege inside a transaction that rolls back, and watch the second layer catch it.
    await withTenant(db, TENANT_A.id, async (tx) => {
      const d = tx as never as typeof db;
      await d.execute(sql`grant update, delete on registros_facturacion to app_user`);
      await d.execute(sql`set local role app_user`);
      await insertRegistro(d, 4);
      await expect(
        d.execute(sql`update registros_facturacion set huella = repeat('B', 64)`),
      ).rejects.toMatchObject({ code: "WT001" });
      throw new RollbackSignal();
    }).catch((e: unknown) => {
      if (!(e instanceof RollbackSignal)) throw e;
    });
  });

  it("rejects TRUNCATE by statement trigger", async () => {
    // A row trigger does NOT fire on TRUNCATE. Without the separate BEFORE TRUNCATE … FOR EACH
    // STATEMENT trigger, TRUNCATE walks straight through every row-level protection above.
    await withTenant(db, TENANT_A.id, async (tx) => {
      const d = tx as never as typeof db;
      await d.execute(sql`grant truncate on registros_facturacion to app_user`);
      await d.execute(sql`set local role app_user`);
      await expect(d.execute(sql`truncate registros_facturacion cascade`)).rejects.toMatchObject({
        code: "WT001",
      });
      throw new RollbackSignal();
    }).catch((e: unknown) => {
      if (!(e instanceof RollbackSignal)) throw e;
    });
  });
});

class RollbackSignal extends Error {}

async function insertRegistro(d: typeof db, secuencia: number) {
  return d.execute(sql`
    insert into registros_facturacion (
      tenant_id, till_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella
    ) values (
      ${TENANT_A.id}, ${TENANT_A.tillId}, ${TENANT_A.sifId}, ${TENANT_A.saleId},
      ${secuencia}, 'alta',
      '89890001K', ${"A/" + String(secuencia)}, '2026-07-20', 'Waitron SL',
      'F2', 'Venta en establecimiento', '[]'::jsonb, '12.35', '123.45',
      true, '{}'::jsonb,
      '2026-07-20T19:20:30+01:00', 60, '01', repeat('F', 64)
    ) returning id`);
}
```

`packages/fiscal-verifactu/src/vocabulary-scope.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ENGLISH_SOURCE_GLOBS, spanishTokensIn } from "@waitron/db";
import { describe, expect, it } from "vitest";

describe("the English-only vocabulary guard is scoped out of this package", () => {
  it("covers no path in packages/fiscal-verifactu", () => {
    expect(ENGLISH_SOURCE_GLOBS.some((g) => g.includes("fiscal-verifactu"))).toBe(false);
    expect(ENGLISH_SOURCE_GLOBS.some((g) => g.includes("packages/verifactu"))).toBe(false);
  });

  it("would flag this package's schema outright if it ever were in scope", () => {
    // The assertion above is worthless alone — a guard covering nothing at all satisfies it. This
    // runs the guard's own detector over a file it deliberately does not cover, proving the guard
    // still has teeth AND that this package is excluded by scope rather than by the guard having
    // quietly stopped working. If someone widens the globs, the first test fails; if someone
    // guts the detector, this one does.
    const src = readFileSync(
      fileURLToPath(new URL("./schema/registros.ts", import.meta.url)),
      "utf8",
    );
    expect(spanishTokensIn(src)).toContain("registros_facturacion");
  });
});
```

- [ ] **Step 4: Run each test individually and watch it fail**

The Global Constraint requires per-test red observation, not per-file. Run them one at a time:

```bash
cd packages/fiscal-verifactu
pnpm vitest run -t "exports no table this package does not own"
```

Expected: FAIL — `Failed to resolve import "./schema/index.js"`.

Repeat for every test name in all four files, confirming each fails on its own. A test that
passes here is a defect in the test, not a head start. In particular
`"emits no CREATE TABLE for any core table"` **must fail at this point** — it passes trivially
once `drizzle/` is empty, and observing it green before Step 5 is the only way to know it will
ever have been exercised.

- [ ] **Step 5: Generate the migrations**

```bash
cd packages/fiscal-verifactu
pnpm exec drizzle-kit generate --name esquema_fiscal
```

Expected: `drizzle/0000_esquema_fiscal.sql` plus `drizzle/meta/0000_snapshot.json` and
`drizzle/meta/_journal.json`.

Read the generated SQL before continuing. Confirm by eye that it contains
`CREATE TABLE "registros_facturacion"` and **no** `CREATE TABLE "sales"`. If a core table appears,
a schema file has re-exported one — fix the re-export, delete `drizzle/`, regenerate. Do not
hand-edit the generated file.

- [ ] **Step 6: Hand-write the immutability, RLS and privilege migration**

Drizzle has no trigger support in `pg-core`, does not support `FORCE ROW LEVEL SECURITY` at all,
and emits no GRANT/REVOKE. Create an empty numbered migration and fill it in:

```bash
cd packages/fiscal-verifactu
pnpm exec drizzle-kit generate --custom --name registros_inmutables
```

`packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql`:

```sql
-- Hand-written. Everything below is invisible to drizzle-kit, which diffs against its own
-- snapshot and has no concept of triggers, policies, FORCE or privileges — which is exactly why
-- this survives every later `generate` run instead of being reverted by one.

--> statement-breakpoint
ALTER TABLE "registros_facturacion" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cadenas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registro_sif" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "envios" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- current_setting(..., true) returns NULL when unset, so an unset tenant matches nothing and the
-- query returns zero rows. Fail-closed: SET LOCAL outside a transaction silently does nothing,
-- and this is what makes that mistake a visible emptiness rather than a leak.
CREATE POLICY "registros_facturacion_tenant" ON "registros_facturacion"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "cadenas_tenant" ON "cadenas"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "registro_sif_tenant" ON "registro_sif"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "envios_tenant" ON "envios"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint

-- The real control: the application connects as a NON-OWNER role holding only these privileges.
-- The triggers below are the backstop, not the mechanism — the table owner can always
-- ALTER TABLE … DISABLE TRIGGER, so a design that relies on the trigger alone relies on the
-- application not being the owner anyway. Migrations run as owner; the application never does.
GRANT SELECT, INSERT ON "registros_facturacion" TO app_user;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "registros_facturacion" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "cadenas" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "registro_sif" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "envios" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "contadores_instalacion" TO app_user;--> statement-breakpoint

CREATE FUNCTION verifactu_registro_inmutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'registros_facturacion is append-only (attempted %)', TG_OP
    USING ERRCODE = 'WT001';
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "registros_facturacion_inmutable_fila"
  BEFORE UPDATE OR DELETE ON "registros_facturacion"
  FOR EACH ROW EXECUTE FUNCTION verifactu_registro_inmutable();--> statement-breakpoint

-- A row trigger does NOT fire on TRUNCATE. Without this second, statement-level trigger, TRUNCATE
-- silently walks straight through every protection above and empties the table.
CREATE TRIGGER "registros_facturacion_inmutable_truncate"
  BEFORE TRUNCATE ON "registros_facturacion"
  FOR EACH STATEMENT EXECUTE FUNCTION verifactu_registro_inmutable();
```

`WT001` is a deliberately chosen SQLSTATE in an unused class, so the tests assert on a code rather
than on an English message that a later edit would silently break.

- [ ] **Step 7: Keep Prettier away from generated SQL**

`pnpm format:check` is a required CI step and `.prettierignore` currently excludes only
`pnpm-lock.yaml` and `docs/`, so generated migrations would fail the build. Check first — Task 4
may already have added this line for `packages/db`:

```bash
grep -n "drizzle" .prettierignore
```

If absent, append to `.prettierignore`:

```text
# Generated by drizzle-kit. The `--> statement-breakpoint` markers are load-bearing separators
# that Prettier does not know about, and the SQL is regenerated wholesale on every schema change.
packages/*/drizzle/
```

- [ ] **Step 8: Run the suite**

```bash
cd packages/fiscal-verifactu && pnpm test
./node_modules/.bin/prettier --check .
pnpm -r typecheck
```

Expected: PASS, 15 tests. `Expected: prettier reports all matched files use Prettier code style.`
`Expected: typecheck passes with no output.`

- [ ] **Step 9: Teeth check — break it and watch it scream**

Confirm these tests have teeth rather than merely executing the code. Five named mutations:

Add `export { sales } from "@waitron/db";` to `src/schema/index.ts` and run:

```bash
cd packages/fiscal-verifactu && pnpm vitest run src/schema-ownership.test.ts
```

Expected: FAIL — `exports no table this package does not own`. Then regenerate the migrations with
that re-export still in place and confirm `emits no CREATE TABLE for any core table` also fails,
proving the runtime guard and the generated artefact agree about what a re-export does. Restore
both.

Temporarily drop the truncate trigger from `0001` and re-run against a fresh database:

Expected: FAIL — `rejects TRUNCATE by statement trigger`. Restore it. If this one stays green, the
row trigger is being credited with protection it does not provide.

Temporarily change `runMigrations(db, CORE_MIGRATIONS)` to run *after* the fiscal set in
`applies core then fiscal against an empty database`:

Expected: FAIL — that test, on a missing-relation error. If it stays green the smoke test is
vacuous: it would pass with the sets applied in either order and therefore asserts nothing about
composition.

Temporarily remove `set local role app_user` from the `asApp` helper:

Expected: FAIL — `is actually running as the non-owner application role`, and **all three
rejection tests turn green**. That inversion is the whole point: as superuser the table is fully
mutable and the suite would otherwise report success.

Temporarily widen `ENGLISH_SOURCE_GLOBS` in `packages/db` to include
`packages/fiscal-verifactu/**`:

Expected: FAIL — `covers no path in packages/fiscal-verifactu`, plus the core vocabulary guard
itself failing loudly on `registros_facturacion`. Restore it. This is the proof that the guard is
scoped out of this package by intent and not by accident.

If any mutation leaves the suite green, a test is missing.

- [ ] **Step 10: Commit**

```bash
git add packages/fiscal-verifactu packages/db/src/index.ts .prettierignore
git commit -m "feat(fiscal-verifactu): module-owned Spanish schema with composing migrations"
```

Body:

```text
The module owns registros_facturacion, cadenas, registro_sif, contadores_instalacion and
envios, in Spanish, with real columns rather than an opaque payload — the outbox drains on
(tenant_id, estado, proximo_intento_en), reconciliation filters on período de imputación, and
art. 7.i verification walks predecessors by identity. Only `desglose` and
`sistema_informatico` are jsonb, and both are hashed-and-re-serialised units that nothing
queries; the identity-bearing halves of sistema_informatico already exist as real,
unique-constrained columns on registro_sif.

The trap this commit is shaped around is migration composition. `out` in drizzle.config.ts is
a single string, not an array, so one config means one folder and this package needs its own
plus its own __drizzle_migrations_fiscal journal. The fiscal schema files import core tables
to declare foreign keys but must never re-export them: a re-export pulls the core table into
this package's snapshot and generates a duplicate CREATE TABLE that fails at apply time
against a database where core already created it. schema-ownership.test.ts inspects the same
exported values drizzle-kit inspects, because a comment saying "do not re-export" does not
survive a future contributor.

Ordering across packages is the runtime's responsibility — Drizzle enforces nothing — so the
smoke test that applies both sets in order is paired with one that applies them in the wrong
order and asserts it fails. A smoke test that would pass either way tests nothing, and this is
the fourth time in this repo that a green test turned out to be asserting nothing at all.
```

---

## Task 13: Till registration and installation-number minting

A till registers once and receives a strictly-increasing, never-reused installation number. The
regulation's words are *«no puede repetirse nunca»* — including on reinstalling the same software
on the same reformatted machine — so this task's real deliverable is a uniqueness guarantee that
does not depend on anybody keeping a list.

**Files:**

- Create: `packages/fiscal-verifactu/src/registro-sif.ts`
- Create: `packages/fiscal-verifactu/src/registro-sif.test.ts`
- Modify: `packages/fiscal-verifactu/src/index.ts` (export the registration surface)
- Modify: `packages/shared/src/errors.ts` (add `SIF_NOT_REGISTERED`)

**Interfaces:**

- Consumes: `registroSif`, `contadoresInstalacion`, `cadenas` from `./schema/index.js`; `AppError`
  from `@waitron/shared`.
- Produces:
  - `registerSif(tx, params: RegisterSifParams): Promise<SifRegistration>`
  - `currentSif(tx, tenantId: TenantId, tillId: TillId): Promise<SifRegistration>` — throws
    `SIF_NOT_REGISTERED`
  - `esPrimerRegistro(tx, tenantId: TenantId, tillId: TillId): Promise<boolean>`
  - types `RegisterSifParams`, `SifRegistration`

> **A till cannot be provisioned offline, and this is a deliberate limitation, not an oversight.**
> `registerSif` runs against the upstream node's database because that is where the single writer
> lives, and a single writer is the only thing that can make "never reused" true. Provisioning is
> an admin action performed once when a till is installed or reimaged, not a mid-service event, so
> requiring connectivity for it costs nothing a restaurant will ever notice. The alternative — a
> till minting its own number offline from a local high-water mark — cannot detect a number
> another till already burned, and would produce two SIFs sharing an identity, which is the one
> failure this whole table exists to prevent. Nothing about this weakens spec §4: an already-
> registered till sells indefinitely offline.

- [ ] **Step 1: Write the failing tests**

`packages/fiscal-verifactu/src/registro-sif.test.ts`:

```ts
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { currentSif, esPrimerRegistro, registerSif } from "./registro-sif.js";
import { seedTenants, TENANT_A, TENANT_B } from "../test/fixtures.js";

let db: Awaited<ReturnType<typeof createPgliteDb>>;

const SIF_PARAMS = {
  nif: "89890001K",
  idSistemaInformatico: "WT",
} as const;

beforeEach(async () => {
  // A fresh database per test. The counter under test is monotonic and never resets, so a shared
  // database would make every assertion about "strictly greater" depend on test execution order —
  // and the first reordering would produce a failure that looks like a real defect.
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, FISCAL_MIGRATIONS);
  await seedTenants(db);
});

describe("registerSif", () => {
  it("mints an installation number on first registration", async () => {
    const reg = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    expect(reg.numeroInstalacion).toBe(1);
    expect(reg.nif).toBe("89890001K");
    expect(reg.revocadoEn).toBeNull();
  });

  it("mints strictly increasing numbers across tills of one obligado", async () => {
    const first = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const second = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId2 }),
    );
    expect(second.numeroInstalacion).toBeGreaterThan(first.numeroInstalacion);
  });

  it("counts per (NIF, IdSIF), not globally", async () => {
    // A SIF is identified by NIF + IdSIF + NºInstalación, so the counter is scoped to the first
    // two. A global counter would still be correct but would leak one obligado's till count to
    // another, and would make the number needlessly large.
    await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const other = await withTenant(db, TENANT_B.id, (tx) =>
      registerSif(tx, { nif: "12345678Z", idSistemaInformatico: "WT", tenantId: TENANT_B.id, tillId: TENANT_B.tillId }),
    );
    expect(other.numeroInstalacion).toBe(1);
  });

  it("never reuses a number after a reimage", async () => {
    // The failure mode most likely in a self-hosted deployment, and the one a manual list gets
    // wrong. A wiped till has no registration, so it must re-register — correct by construction.
    // The wipe is simulated by doing nothing to the upstream database at all and simply calling
    // registerSif again: that is exactly what a reformatted machine does.
    const before = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const after = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    // Strictly greater, and explicitly NOT equal — `toBeGreaterThan` alone would pass if the
    // implementation returned NaN, and equality is the specific thing forbidden.
    expect(after.numeroInstalacion).toBeGreaterThan(before.numeroInstalacion);
    expect(after.numeroInstalacion).not.toBe(before.numeroInstalacion);
    expect(after.id).not.toBe(before.id);
  });

  it("revokes the previous registration rather than updating it", async () => {
    // The old identity's registros are immutable and must keep pointing at the identity that
    // actually generated them. Overwriting the row would silently rewrite history.
    const before = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const rows = await db.execute<{ id: string; numero_instalacion: number; revocado_en: Date | null }>(
      sql`select id, numero_instalacion, revocado_en from registro_sif order by numero_instalacion`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.id).toBe(before.id);
    expect(rows.rows[0]?.revocado_en).not.toBeNull();
    expect(rows.rows[1]?.revocado_en).toBeNull();
  });

  it("mints again after a third registration, never returning to a burned number", async () => {
    const seen: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const reg = await withTenant(db, TENANT_A.id, (tx) =>
        registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
      );
      seen.push(reg.numeroInstalacion);
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("re-registration begins a new chain", () => {
  it("does not continue the old chain", async () => {
    // A new NúmeroInstalación is a NEW SIF IDENTITY, therefore a new chain (findings §1). Chains
    // cannot be merged or migrated: the old one ends, a new one begins.
    const first = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );

    // Simulate the till having sold: the chain head now carries a huella.
    await db.execute(sql`
      update cadenas set secuencia = 7, ultimo_registro_id = null, ultima_huella = null
      where tenant_id = ${TENANT_A.id} and till_id = ${TENANT_A.tillId}`);
    await db.execute(sql`
      update cadenas set ultima_huella = repeat('C', 64)
      where tenant_id = ${TENANT_A.id} and till_id = ${TENANT_A.tillId}`);

    expect(await withTenant(db, TENANT_A.id, (tx) => esPrimerRegistro(tx, TENANT_A.id, TENANT_A.tillId))).toBe(false);

    const second = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    expect(second.numeroInstalacion).toBeGreaterThan(first.numeroInstalacion);

    const head = await db.execute<{ secuencia: number; ultima_huella: string | null; ultimo_registro_id: string | null }>(
      sql`select secuencia, ultima_huella, ultimo_registro_id from cadenas
          where tenant_id = ${TENANT_A.id} and till_id = ${TENANT_A.tillId}`,
    );
    // The chain POINTER is broken — the next record cannot chain to the old one.
    expect(head.rows[0]?.ultimaHuella ?? head.rows[0]?.ultima_huella).toBeNull();
    expect(head.rows[0]?.ultimo_registro_id).toBeNull();
    // But the sequence is NOT reset. It is ours, an ordering aid for the outbox, and resetting it
    // would collide with UNIQUE (tenant_id, till_id, secuencia) on the very next append.
    expect(head.rows[0]?.secuencia).toBe(7);
  });

  it("reports PrimerRegistro from local state, not from a flag", async () => {
    // AEAT returns a non-rejecting warning if PrimerRegistro="S" is claimed when records already
    // exist for that SIF+NIF — a useful signal that a till was accidentally re-provisioned. It is
    // only useful if the value is DERIVED. A caller-set flag would make the warning report the
    // caller's belief back to itself.
    await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    expect(await withTenant(db, TENANT_A.id, (tx) => esPrimerRegistro(tx, TENANT_A.id, TENANT_A.tillId))).toBe(true);

    await db.execute(sql`
      update cadenas set ultima_huella = repeat('D', 64)
      where tenant_id = ${TENANT_A.id} and till_id = ${TENANT_A.tillId}`);
    expect(await withTenant(db, TENANT_A.id, (tx) => esPrimerRegistro(tx, TENANT_A.id, TENANT_A.tillId))).toBe(false);
  });
});

describe("currentSif", () => {
  it("returns the live registration", async () => {
    const reg = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const found = await withTenant(db, TENANT_A.id, (tx) => currentSif(tx, TENANT_A.id, TENANT_A.tillId));
    expect(found.id).toBe(reg.id);
  });

  it("throws a structured error for an unregistered till", async () => {
    // The concrete encoding of "a till cannot be provisioned offline": an unprovisioned till gets
    // a structured refusal that reaches a screen translatable, never a locally invented number.
    const err = await withTenant(db, TENANT_A.id, (tx) =>
      currentSif(tx, TENANT_A.id, TENANT_A.tillId).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("SIF_NOT_REGISTERED");
    expect((err as AppError).params).toMatchObject({ tillId: TENANT_A.tillId });
  });

  it("does not return a revoked registration", async () => {
    const first = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const second = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    const found = await withTenant(db, TENANT_A.id, (tx) => currentSif(tx, TENANT_A.id, TENANT_A.tillId));
    expect(found.id).toBe(second.id);
    expect(found.id).not.toBe(first.id);
  });
});

describe("the database, not the application, is what forbids a duplicate", () => {
  it("rejects a duplicate installation number inserted directly", async () => {
    // Bypasses registerSif entirely. If this passes only because the allocator is careful, the
    // guarantee is application discipline wearing a constraint's clothes — and every future
    // caller, migration script and manual fix-up is outside it.
    const reg = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    await expect(
      db.execute(sql`
        insert into registro_sif (tenant_id, till_id, nif, id_sistema_informatico, numero_instalacion, revocado_en)
        values (${TENANT_A.id}, ${TENANT_A.tillId2}, ${SIF_PARAMS.nif}, ${SIF_PARAMS.idSistemaInformatico},
                ${reg.numeroInstalacion}, now())`),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects a duplicate raised by a different tenant it cannot even see", async () => {
    // Unique constraints are NOT RLS-filtered. A second obligado sharing a NIF still collides,
    // which is the behaviour that makes never-reuse true across the whole installation rather
    // than within one tenant's visible slice.
    const reg = await withTenant(db, TENANT_A.id, (tx) =>
      registerSif(tx, { ...SIF_PARAMS, tenantId: TENANT_A.id, tillId: TENANT_A.tillId }),
    );
    await expect(
      db.execute(sql`
        insert into registro_sif (tenant_id, till_id, nif, id_sistema_informatico, numero_instalacion)
        values (${TENANT_B.id}, ${TENANT_B.tillId}, ${SIF_PARAMS.nif}, ${SIF_PARAMS.idSistemaInformatico},
                ${reg.numeroInstalacion})`),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
```

- [ ] **Step 2: Run each test individually and watch it fail**

Expected: FAIL — unresolved import `./registro-sif.js`.

Run all fifteen by name, one at a time. Two deserve a second look when they go green later:
`counts per (NIF, IdSIF), not globally` passes trivially if the counter is per-till, and
`does not continue the old chain` passes trivially if `cadenas` is never written at all. Both are
caught by the teeth check in Step 5, but noticing them here is cheaper.

- [ ] **Step 3: Add the error code**

`packages/shared/src/errors.ts` — append to the `ErrorCode` union:

```ts
  /** A till performed a fiscal operation before it was provisioned against its upstream node. */
  | "SIF_NOT_REGISTERED"
```

- [ ] **Step 4: Implement the registration surface**

`packages/fiscal-verifactu/src/registro-sif.ts`:

```ts
import { and, eq, isNull, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { TenantId, TillId } from "@waitron/shared";
import { cadenas } from "./schema/cadenas.js";
import { contadoresInstalacion, registroSif } from "./schema/sif.js";

export interface RegisterSifParams {
  tenantId: TenantId;
  tillId: TillId;
  /** The obligado tributario's NIF. Half of the SIF identity, with IdSIF and NºInstalación. */
  nif: string;
  idSistemaInformatico: string;
}

export interface SifRegistration {
  id: string;
  tenantId: TenantId;
  tillId: TillId;
  nif: string;
  idSistemaInformatico: string;
  numeroInstalacion: number;
  registradoEn: Date;
  revocadoEn: Date | null;
}

/**
 * Allocate the next installation number for (NIF, IdSIF).
 *
 * `insert … on conflict … do update … returning` is a single statement, so the row lock is taken
 * and released by Postgres without a read-then-write window for a second registration to slip
 * into. The UNIQUE index on registro_sif remains the actual guarantee — this is the allocator, not
 * the guard, and the distinction matters because a manual INSERT, a data-fix script or a second
 * implementation of this function all bypass the allocator and none of them bypass the index.
 */
async function mintNumeroInstalacion(
  tx: { execute: (q: unknown) => Promise<{ rows: { proximo_numero: number }[] }> },
  nif: string,
  idSistemaInformatico: string,
): Promise<number> {
  const result = await tx.execute(sql`
    insert into ${contadoresInstalacion} (nif, id_sistema_informatico, proximo_numero)
    values (${nif}, ${idSistemaInformatico}, 2)
    on conflict (nif, id_sistema_informatico)
      do update set proximo_numero = ${contadoresInstalacion.proximoNumero} + 1
    returning proximo_numero - 1 as proximo_numero`);
  const allocated = result.rows[0]?.proximo_numero;
  if (allocated === undefined) {
    throw new AppError("SIF_NOT_REGISTERED", { nif, idSistemaInformatico });
  }
  return allocated;
}

/**
 * Register a till, or re-register a reimaged one. Always mints a fresh number.
 *
 * Re-registration is IMPLICIT rather than gated behind an `allowReRegistration` flag. A wiped till
 * has no local state to distinguish itself with, so it cannot pass such a flag truthfully, and
 * upstream cannot tell a reimaged till from a mistakenly-duplicated one. Since minting a fresh
 * number is always safe and reusing one never is, the safe branch is the only branch — which is
 * what "correct by construction" means here. A flag would move the decision to a caller who does
 * not have the information to make it.
 */
export async function registerSif(
  tx: never,
  params: RegisterSifParams,
): Promise<SifRegistration> {
  const db = tx as never as {
    execute: (q: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
    update: typeof import("drizzle-orm").sql extends never ? never : never;
  };
  const now = new Date();

  // Retire any live identity for this till first, so the partial unique index has room. The old
  // row is never updated in place beyond this timestamp: its registros are immutable and must
  // keep pointing at the identity that actually generated them.
  await db.execute(sql`
    update ${registroSif} set revocado_en = ${now}
    where tenant_id = ${params.tenantId} and till_id = ${params.tillId} and revocado_en is null`);

  const numeroInstalacion = await mintNumeroInstalacion(
    db as never,
    params.nif,
    params.idSistemaInformatico,
  );

  const inserted = await db.execute(sql`
    insert into ${registroSif} (tenant_id, till_id, nif, id_sistema_informatico, numero_instalacion)
    values (${params.tenantId}, ${params.tillId}, ${params.nif}, ${params.idSistemaInformatico},
            ${numeroInstalacion})
    returning id, registrado_en`);

  // A new installation number is a new SIF identity, therefore a NEW CHAIN. Break the pointer.
  // `secuencia` is deliberately untouched: it is our ordering aid for the outbox, never AEAT's,
  // and resetting it would collide with UNIQUE (tenant_id, till_id, secuencia) on the next append.
  await db.execute(sql`
    insert into ${cadenas} (tenant_id, till_id)
    values (${params.tenantId}, ${params.tillId})
    on conflict (tenant_id, till_id)
      do update set ultimo_registro_id = null, ultima_huella = null, actualizado_en = ${now}`);

  return {
    id: String(inserted.rows[0]?.id),
    tenantId: params.tenantId,
    tillId: params.tillId,
    nif: params.nif,
    idSistemaInformatico: params.idSistemaInformatico,
    numeroInstalacion,
    registradoEn: inserted.rows[0]?.registrado_en as Date,
    revocadoEn: null,
  };
}

/** The till's live SIF identity. Throws rather than returning null — every caller needs one. */
export async function currentSif(
  tx: never,
  tenantId: TenantId,
  tillId: TillId,
): Promise<SifRegistration> {
  const db = tx as never as { select: (...a: never[]) => never };
  const rows = await (db as never as import("drizzle-orm/pg-core").PgDatabase<never>)
    .select()
    .from(registroSif)
    .where(
      and(
        eq(registroSif.tenantId, tenantId),
        eq(registroSif.tillId, tillId),
        isNull(registroSif.revocadoEn),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new AppError("SIF_NOT_REGISTERED", { tenantId, tillId });
  }
  return { ...row } as SifRegistration;
}

/**
 * Whether the next record on this till's chain carries `PrimerRegistro="S"`.
 *
 * DERIVED from local state — the till's own chain being empty — never from a flag anyone sets.
 * AEAT returns a non-rejecting warning when it is claimed and records already exist for that
 * SIF+NIF; that warning is a useful re-provisioning signal only because this value reports what
 * the database holds rather than what the caller believes.
 */
export async function esPrimerRegistro(
  tx: never,
  tenantId: TenantId,
  tillId: TillId,
): Promise<boolean> {
  const db = tx as never as import("drizzle-orm/pg-core").PgDatabase<never>;
  const rows = await db
    .select({ ultimaHuella: cadenas.ultimaHuella })
    .from(cadenas)
    .where(and(eq(cadenas.tenantId, tenantId), eq(cadenas.tillId, tillId)))
    .limit(1);
  // No chain row at all is also a first record — a till registered but never sold.
  return rows[0]?.ultimaHuella == null;
}
```

> The `tx: never` parameter types and the casts above are placeholders for `packages/db`'s
> exported transaction handle type. **Resolve this when implementing: import the `Transaction`
> type `packages/db` exports from `client.ts` and type every `tx` parameter with it, deleting
> every cast in this file.** A cast at a package boundary is exactly where a Drizzle generic
> mismatch hides until runtime, and `verbatimModuleSyntax` plus `strict` will surface it the
> moment the real type lands.

`packages/fiscal-verifactu/src/index.ts` — append:

```ts
export { currentSif, esPrimerRegistro, registerSif } from "./registro-sif.js";
export type { RegisterSifParams, SifRegistration } from "./registro-sif.js";
```

- [ ] **Step 5: Run tests, then teeth check**

```bash
cd packages/fiscal-verifactu && pnpm test
```

Expected: PASS, 30 tests.

Confirm they have teeth rather than merely executing the code. Four named mutations:

Temporarily drop the unique index:

```bash
# in 0000_esquema_fiscal.sql, delete registro_sif_instalacion_uq, then
pnpm vitest run src/registro-sif.test.ts
```

Expected: FAIL — `rejects a duplicate installation number inserted directly` **and** `rejects a
duplicate raised by a different tenant it cannot even see`. Restore it. If either stays green, the
duplicate was being stopped by the allocator's arithmetic rather than by the database, and every
path that does not go through `registerSif` is unprotected.

Temporarily make `registerSif` return the existing live registration when one is found, instead of
minting — the "helpful" bug, and the single most likely thing a future contributor will add:

Expected: FAIL — `never reuses a number after a reimage`, `revokes the previous registration rather
than updating it`, and `does not return a revoked registration`. Restore it.

Temporarily remove the `cadenas` upsert from `registerSif`:

Expected: FAIL — `does not continue the old chain`. Restore it. A green run here would mean a
reimaged till chains its first new record onto a predecessor generated by a SIF identity that no
longer exists, which is unrepairable: chains cannot be merged or migrated.

Temporarily change that upsert to also set `secuencia = 0`:

Expected: FAIL — `does not continue the old chain`, on the sequence assertion. Restore it. This is
the mutation that proves the sequence is understood as ours rather than AEAT's; a reset looks
tidy and collides with `UNIQUE (tenant_id, till_id, secuencia)` on the very next sale.

If any mutation leaves the suite green, a test is missing.

- [ ] **Step 6: Commit**

```bash
git add packages/fiscal-verifactu/src/registro-sif.ts \
        packages/fiscal-verifactu/src/registro-sif.test.ts \
        packages/fiscal-verifactu/src/index.ts \
        packages/shared/src/errors.ts
git commit -m "feat(fiscal-verifactu): upstream-minted, never-reused installation numbers"
```

Body:

```text
NºInstalación "no puede repetirse nunca" — including on reinstalling the same software on the
same reformatted machine. Never-reused is a uniqueness guarantee, and uniqueness guarantees
belong with a single writer, so the upstream node allocates a strictly-increasing counter per
(NIF, IdSIF) and returns it with credentials. The counter lives in its own row rather than
being derived from max(numero_instalacion): deriving it makes never-reuse depend on
never-deleting, which turns a routine housekeeping DELETE into a compliance breach with no
error message.

Reimage is correct by construction. A wiped till has no registration, so it must re-register,
so it cannot reuse — and re-registration is implicit rather than gated behind a flag, because
a wiped till has no local state with which to set one truthfully and upstream cannot tell a
reimaged till from a mistakenly-duplicated one. Minting is always safe and reuse never is, so
there is only one branch. This is the failure mode most likely in a self-hosted deployment and
the one a manual list would get wrong.

A new installation number is a new SIF identity, therefore a new chain: the old chain's pointer
is broken and PrimerRegistro follows from local state, never from a flag. `secuencia` is
deliberately NOT reset — it is our ordering aid for the outbox, never AEAT's, and resetting it
would collide with UNIQUE (tenant_id, till_id, secuencia) on the next sale. Provisioning
requires connectivity; that is a stated limitation, not an oversight, because it is an admin
action rather than a mid-service event, and an already-registered till still sells offline
indefinitely.
```

---
## Task 14: Chain append — `FOR UPDATE`, the unique backstop, and bounded retry

The one place in this plan whose correctness cannot be argued from the code. Its deliverable is 20 concurrent appends to a single chain all committing, in order, with the chain intact — proven against **real Postgres via Testcontainers**, because PGlite provably cannot prove it.

**Files:**

- Create: `packages/fiscal-verifactu/src/chain.ts`
- Create: `packages/fiscal-verifactu/src/chain.test.ts` (PGlite — logic, ordering, error shape)
- Create: `packages/fiscal-verifactu/src/chain.concurrency.test.ts` (**real Postgres only**)
- Create: `packages/fiscal-verifactu/src/chain.pglite-cannot-test-contention.test.ts`
- Create: `packages/fiscal-verifactu/src/registro-row.ts`
- Create: `packages/fiscal-verifactu/src/testing/postgres.ts`
- Create: `packages/fiscal-verifactu/src/testing/seed.ts`
- Modify: `packages/fiscal-verifactu/package.json` (add `@testcontainers/postgresql`)
- Modify: `packages/fiscal-verifactu/vitest.config.ts` (container-aware timeouts)
- Modify: `packages/fiscal-verifactu/stryker.config.json` (exclude `src/testing/**`)
- Modify: `packages/shared/src/errors.ts` (add one `ErrorCode` member)

**Interfaces:**

- Consumes: `buildAltaRecord`, `buildAnulacionRecord`, `computeHuella` from `@waitron/verifactu`; `AppError`, `ErrorCode` from `@waitron/shared`; `createPostgresDb`, `runMigrations`, `Database`, `Transaction` from `@waitron/db`; the `cadenas` and `registros_facturacion` tables from Task 11.
- Produces:
  - `appendToChain(tx: Transaction, tenantId: TenantId, tillId: TillId, registro: PendingRegistro): Promise<{ secuencia: number; huella: string }>`
  - `lockChainHead(tx: Transaction, tenantId: TenantId, tillId: TillId): Promise<ChainHead>` — exported for Task 15, which must verify under the same lock
  - `toRegistroRow(record, ctx): RegistroRowInsert` in `registro-row.ts`
  - types `PendingRegistro`, `ChainHead`

### Why this strategy and not another — the measurement, not a preference

These numbers came from an experiment on real Postgres, 20 concurrent appends to one chain. They are reproduced here so that nobody re-litigates the choice from first principles:

| Strategy | Committed | Chain intact | Time |
| --- | --- | --- | --- |
| Naive read-then-write | 3/20 | yes (only because of the unique constraint) | — |
| `SELECT … FOR UPDATE` on the chain head | 20/20 | yes | — |
| `pg_advisory_xact_lock` | 20/20 | yes | 18ms |
| SERIALIZABLE + retry | 20/20 | yes | 60ms, 57 attempts |

Read the first row carefully: the naive strategy did not corrupt the chain, but it lost 17 of 20 sales. A unique constraint alone converts a correctness failure into an availability failure, which in a restaurant at 21:00 is not an improvement.

The composite this task implements is therefore three layers, each rejecting an alternative:

1. **`UNIQUE (tenant_id, till_id, secuencia)`** — the non-negotiable backstop. It is what makes every other row of that table say "chain intact". It is never the *only* mechanism, because on its own it costs 85% of the sales.
2. **A `cadenas` head row locked `FOR UPDATE`** — serialises proactively, so writers queue rather than collide. Chosen over `pg_advisory_xact_lock`, which measured identically, because an advisory lock is keyed by an integer the application invents: two call sites that hash `(tenant, till)` differently silently take different locks and neither blocks. The row *is* the key, so it cannot drift. It also keeps per-tenant and per-till parallelism — a busy till never blocks a quiet one, which an advisory lock on a coarser key would.
3. **Bounded retry on SQLSTATE `23505`** — for the residual window where there is no head row yet to lock.

**Skip SERIALIZABLE.** It reached the same outcome with 57 attempts for 20 appends and 3.3× the wall time, and once the unique constraint exists it adds no safety the constraint does not already provide. Paying serialisation-failure retries for a guarantee already held is a cost with no matching benefit.

### The constraint that shapes this entire task

> **PGlite cannot test any of this, and the failure mode is a green suite.** Concurrent queries serialise onto a single backend — `pg_backend_pid()` returns the identical value from what look like two independent connections — so `FOR UPDATE` parses, executes, and never blocks. A hand-rolled contention test written during design *appeared to pass* while both statements had in fact merged into one transaction: a false pass that asserted nothing. **The concurrency properties must be checked against a real PostgreSQL server via Testcontainers before this task is considered done**, and against `pg_backend_pid()` returning 20 distinct values within that suite. Skip the backend-pid assertion and the suite can silently degrade to the same false pass on any future harness change, which is worse than having no concurrency suite at all, because it reads as evidence.

There is a matching prohibition. **Never** write `describe.skipIf(!dockerAvailable)` around the concurrency suite. A suite that vanishes when Docker is missing produces a green CI run that proves nothing about the single property this task exists to establish. If Docker is unavailable the suite must fail loudly.

- [ ] **Step 1: Add the Testcontainers dependency and the timeouts it forces**

`packages/fiscal-verifactu/package.json` — add to `devDependencies`:

```json
"@testcontainers/postgresql": "12.0.4"
```

`packages/fiscal-verifactu/vitest.config.ts`:

```ts
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Vitest's default 5s testTimeout is a live risk here for two independent
    // reasons: PGlite boots a WASM Postgres, and the concurrency suite pulls
    // and starts a real postgres container. Both are one-off costs paid in a
    // beforeAll, so hookTimeout is the one that has to be generous.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude, "src/testing/**"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
```

`packages/fiscal-verifactu/stryker.config.json` — extend `mutate`:

```json
"mutate": ["src/**/*.ts", "!src/**/*.test.ts", "!src/testing/**"]
```

Test-support code under `src/testing/` is not the subject under test; mutating it produces surviving mutants that describe nothing about the chain, which is a false positive rather than a signal. This mirrors why `test/` holds fixtures in the first place.

- [ ] **Step 2: Add the error code**

`packages/shared/src/errors.ts` — add one member to `ErrorCode`:

```ts
/**
 * Bounded chain-append retry exhausted. Params: { tenantId, tillId, attempts }.
 * Reached only when the head-row lock failed to serialise writers — in
 * practice, several tabs racing the very first record of a fresh chain.
 */
FISCAL_CHAIN_APPEND_CONTENTION = "FISCAL_CHAIN_APPEND_CONTENTION",
```

A bare `throw new Error("could not append to chain after 3 attempts")` reaches a till screen untranslatable and unclassifiable — Global Constraint, spec §9. The retry exhausting is exactly the case where a human needs to be told something in their own language, so it is exactly the case that must not be prose.

- [ ] **Step 3: Write the real-Postgres harness**

This file contains no assertions; it exists so the concurrency suite can obtain **genuinely independent connections**. That is the whole point, so it is stated in code:

`packages/fiscal-verifactu/src/testing/postgres.ts`:

```ts
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresDb, runMigrations, type Database } from "@waitron/db";

const CORE_MIGRATIONS = fileURLToPath(new URL("../../../db/drizzle", import.meta.url));
const FISCAL_MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface RealPostgres {
  /** A fresh Database — its own pool, therefore its own backend process. */
  connect(): Promise<Database>;
  stop(): Promise<void>;
}

/**
 * Starts a real PostgreSQL server and runs both packages' migrations against
 * it, core first — migration ordering across packages is the runtime's
 * responsibility and nothing enforces it, so the order is explicit here.
 *
 * `connect()` deliberately returns a NEW Database per call rather than
 * handing back one shared pool. Two callers must land on two backend
 * processes for `FOR UPDATE` to have anything to block; sharing a pool sized
 * below the caller count would silently reduce the concurrency under test.
 */
export async function startRealPostgres(): Promise<RealPostgres> {
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
  } catch (cause) {
    // Never degrade to a skip. A concurrency suite that disappears when
    // Docker is absent reports green while asserting nothing.
    throw new Error(
      "The chain-append concurrency suite requires a running Docker daemon. " +
        "It cannot be skipped: PGlite cannot substitute for it.",
      { cause },
    );
  }

  const uri = container.getConnectionUri();
  const migrator = await createPostgresDb(uri);
  await runMigrations(migrator, {
    migrationsFolder: CORE_MIGRATIONS,
    migrationsTable: "__drizzle_migrations",
  });
  await runMigrations(migrator, {
    migrationsFolder: FISCAL_MIGRATIONS,
    migrationsTable: "__drizzle_migrations_fiscal",
  });

  return {
    connect: () => createPostgresDb(uri),
    stop: () => container.stop(),
  };
}
```

`packages/fiscal-verifactu/src/testing/seed.ts`:

```ts
import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import type { AltaInput, AnulacionInput, SistemaInformatico } from "@waitron/verifactu";
import type { PendingRegistro } from "../chain.js";

export const TEST_NIF = "89890001K";

export const TEST_SISTEMA: SistemaInformatico = {
  NombreRazon: "Waitron SL",
  NIF: TEST_NIF,
  NombreSistemaInformatico: "Waitron POS",
  IdSistemaInformatico: "WT",
  Version: "1.0.0",
  NumeroInstalacion: "001",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "S",
  IndicadorMultiplesOT: "N",
};

export interface SeededTill {
  tenantId: string;
  tillId: string;
  seriesId: string;
}

/** Inserts tenant → location → till → series and returns their ids. */
export async function seedTill(db: Database, label = "A"): Promise<SeededTill> {
  const rows = await db.execute<{ tenant_id: string; till_id: string; series_id: string }>(sql`
    with t as (
      insert into tenants (nif, legal_name) values (${TEST_NIF}, ${"Waitron SL"}) returning id
    ), l as (
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      select id, ${"Sala " + label}, array['es'], ${"Venta en establecimiento"} from t returning id, tenant_id
    ), k as (
      insert into tills (tenant_id, location_id, name)
      select tenant_id, id, ${"Till " + label} from l returning id, tenant_id
    ), s as (
      insert into invoice_series (tenant_id, till_id, code, purpose, next_number)
      select tenant_id, id, ${"G" + label}, ${"ordinary"}, 1 from k returning id
    )
    select k.tenant_id, k.id as till_id, s.id as series_id from k, s
  `);
  const row = rows[0];
  if (row === undefined) throw new Error("seedTill inserted nothing");
  return { tenantId: row.tenant_id, tillId: row.till_id, seriesId: row.series_id };
}

/** Inserts one immutable sale row and returns its id. */
export async function seedSale(
  db: Database | Transaction,
  till: SeededTill,
  invoiceNumber: number,
): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`
    insert into sales (tenant_id, till_id, series_id, invoice_number, issued_at,
                       total, tip_amount, amount_charged, locale, invoice_locales,
                       fiscal_backend, fiscal_state)
    values (${till.tenantId}, ${till.tillId}, ${till.seriesId}, ${invoiceNumber},
            ${"2026-07-20T19:20:30+02:00"}, ${"123.45"}, ${"0.00"}, ${"123.45"},
            ${"es"}, array['es'], ${"verifactu"}, ${"pending"})
    returning id
  `);
  const row = rows[0];
  if (row === undefined) throw new Error("seedSale inserted nothing");
  return row.id;
}

/** A minimal alta ready for appendToChain — Encadenamiento is chain-owned. */
export function altaFor(saleId: string, invoiceNumber: number, seconds: number): PendingRegistro {
  const input: Omit<AltaInput, "Encadenamiento"> = {
    IDEmisorFactura: TEST_NIF,
    NumSerieFactura: `A/${invoiceNumber}`,
    FechaExpedicionFactura: new Date("2026-07-20T00:00:00+02:00"),
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "F1",
    DescripcionOperacion: "Venta en establecimiento",
    Desglose: [{ BaseImponibleOimporteNoSujeto: 102.02, CuotaRepercutida: 21.43, TipoImpositivo: 21 }],
    CuotaTotal: 21.43,
    ImporteTotal: 123.45,
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: new Date(Date.UTC(2026, 6, 20, 17, 20, seconds)),
    offsetMinutes: 120,
  };
  return { tipo: "alta", saleId, input };
}

/** A minimal anulación against an already-issued invoice. */
export function anulacionFor(
  saleId: string,
  invoiceNumber: number,
  seconds: number,
): PendingRegistro {
  const input: Omit<AnulacionInput, "Encadenamiento"> = {
    IDEmisorFacturaAnulada: TEST_NIF,
    NumSerieFacturaAnulada: `A/${invoiceNumber}`,
    FechaExpedicionFacturaAnulada: new Date("2026-07-20T00:00:00+02:00"),
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: new Date(Date.UTC(2026, 6, 20, 17, 20, seconds)),
    offsetMinutes: 120,
  };
  return { tipo: "anulacion", saleId, input };
}
```

- [ ] **Step 4: Write the failing tests**

`packages/fiscal-verifactu/src/chain.test.ts` — the logic suite. It runs on PGlite, and it must never contain a concurrency assertion; every property here is single-writer:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, runMigrations, type Database } from "@waitron/db";
import { AppError, ErrorCode } from "@waitron/shared";
import { buildAltaRecord, computeHuella } from "@waitron/verifactu";
import type { AltaInput } from "@waitron/verifactu";
import { appendToChain, isUniqueViolation } from "./chain.js";
import { altaFor, anulacionFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";

let db: Database;
let till: SeededTill;

beforeEach(async () => {
  db = await createPgliteDb();
  await runMigrations(db, { migrationsFolder: "../db/drizzle", migrationsTable: "__drizzle_migrations" });
  await runMigrations(db, { migrationsFolder: "./drizzle", migrationsTable: "__drizzle_migrations_fiscal" });
  till = await seedTill(db);
});

afterAll(async () => {
  await db.$client.close?.();
});

async function records(): Promise<
  { secuencia: number; huella: string; primer_registro: string | null; encadenamiento_huella: string | null; num_serie_factura: string }[]
> {
  return db.execute(sql`
    select secuencia, huella, primer_registro, encadenamiento_huella, num_serie_factura
    from registros_facturacion
    where till_id = ${till.tillId}
    order by secuencia
  `);
}

describe("appendToChain", () => {
  it("assigns secuencia 1 to the first record of a chain", async () => {
    const saleId = await seedSale(db, till, 1);
    const result = await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, 1, 1)));
    expect(result.secuencia).toBe(1);
  });

  it("marks the first record PrimerRegistro=S and stores a huella anyway", async () => {
    // The trap from spec §5: on the first record the predecessor huella field
    // is present but EMPTY, and the record's own huella is still computed and
    // stored. A start-of-chain is a normal state, not an absence of hashing.
    const saleId = await seedSale(db, till, 1);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, 1, 1)));
    const [first] = await records();
    expect(first?.primer_registro).toBe("S");
    expect(first?.huella).toMatch(/^[0-9A-F]{64}$/);
    // Not merely "falsy": an absent key and a key set to null are different
    // defects, and toBeUndefined cannot tell them apart.
    expect(first?.encadenamiento_huella).toBeNull();
  });

  it("chains the second record to the first via the four-part pointer", async () => {
    const a = await seedSale(db, till, 1);
    const b = await seedSale(db, till, 2);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 1, 1)));
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(b, 2, 2)));
    const [first, second] = await records();
    expect(second?.secuencia).toBe(2);
    expect(second?.primer_registro).toBeNull();
    expect(second?.encadenamiento_huella).toBe(first?.huella);
  });

  it("advances the chain head to the record just written", async () => {
    const a = await seedSale(db, till, 1);
    const { huella } = await db.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 1, 1)),
    );
    const [head] = await db.execute<{ secuencia: number; ultima_huella: string }>(sql`
      select secuencia, ultima_huella from cadenas where till_id = ${till.tillId}
    `);
    expect(head?.secuencia).toBe(1);
    expect(head?.ultima_huella).toBe(huella);
  });

  it("interleaves alta and anulación in one chain in generation order", async () => {
    // findings §1: it is a RECORD chain, not an invoice chain. A void does not
    // start a second chain and does not jump the queue.
    const a = await seedSale(db, till, 1);
    const b = await seedSale(db, till, 2);
    const c = await seedSale(db, till, 3);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 1, 1)));
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(b, 2, 2)));
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, anulacionFor(b, 2, 3)));
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(c, 3, 4)));
    const rows = await records();
    expect(rows.map((r) => r.secuencia)).toEqual([1, 2, 3, 4]);
    // The anulación links to the ALTA that preceded it in generation order,
    // not to the record it annuls — those are different pointers.
    expect(rows[2]?.encadenamiento_huella).toBe(rows[1]?.huella);
    expect(rows[3]?.encadenamiento_huella).toBe(rows[2]?.huella);
  });

  it("does not derive chain position from the invoice number", async () => {
    // AEAT's own sample chains invoice 12345 to predecessor invoice 44, which
    // is structurally impossible if position tracks the counter. This test
    // fails the moment someone "helpfully" couples them — by ordering on the
    // number, by validating contiguity, or by deriving one from the other.
    const a = await seedSale(db, till, 500);
    const b = await seedSale(db, till, 7);
    const c = await seedSale(db, till, 44);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 500, 1)));
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(b, 7, 2)));
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(c, 44, 3)));
    const rows = await records();
    expect(rows.map((r) => r.secuencia)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.num_serie_factura)).toEqual(["A/500", "A/7", "A/44"]);
  });

  it("keeps chain positions contiguous across a gap in invoice numbers", async () => {
    // Burned invoice numbers are permitted (a crash between allocation and
    // commit). Chain positions are ours and have no gaps.
    const a = await seedSale(db, till, 1);
    const b = await seedSale(db, till, 9);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 1, 1)));
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(b, 9, 2)));
    expect((await records()).map((r) => r.secuencia)).toEqual([1, 2]);
  });

  it("stores the exact literals that were hashed", async () => {
    // The "serialise once, hash that exact literal" rule, enforced at rest.
    // 123.45 must come back as the string "123.45" — not 123.45 the numeric,
    // which would re-render as a different literal and hash differently.
    // Deliberately checked against a locally rebuilt record rather than
    // against a hard-coded digest, so the test still names the property if
    // AEAT's canonical string ever gains a field.
    const a = await seedSale(db, till, 1);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 1, 1)));
    const [row] = await db.execute<{ importe_total: string; cuota_total: string; huella: string; fecha_hora_huso_gen_registro: string }>(sql`
      select importe_total, cuota_total, huella, fecha_hora_huso_gen_registro
      from registros_facturacion where till_id = ${till.tillId} and secuencia = 1
    `);
    expect(row?.importe_total).toBe("123.45");
    expect(row?.cuota_total).toBe("21.43");
    expect(row?.fecha_hora_huso_gen_registro).toBe("2026-07-20T19:20:01+02:00");
    const expected = buildAltaRecord({
      ...altaFor(a, 1, 1).input,
      Encadenamiento: { PrimerRegistro: "S" },
    } as AltaInput);
    expect(computeHuella(expected)).toBe(row?.huella);
  });

  it("rejects a second record claiming an occupied chain position", async () => {
    const a = await seedSale(db, till, 1);
    const b = await seedSale(db, till, 2);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(a, 1, 1)));
    // Bypass appendToChain entirely: this is the backstop, and it must hold
    // against a writer that never took the lock.
    await expect(
      db.execute(sql`
        insert into registros_facturacion (tenant_id, till_id, secuencia, sale_id, tipo_registro,
          id_emisor_factura, num_serie_factura, fecha_expedicion_factura,
          fecha_hora_huso_gen_registro, tipo_huella, huella, primer_registro, sistema_informatico)
        values (${till.tenantId}, ${till.tillId}, 1, ${b}, 'alta', '89890001K', 'A/2',
          '20-07-2026', '2026-07-20T19:20:31+02:00', '01', ${"0".repeat(64)}, 'S', '{}'::jsonb)
      `),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("surfaces exhausted retries as a structured AppError, never a bare string", async () => {
    const saleId = await seedSale(db, till, 1);
    // Every savepoint attempt loses its race. Stubbing tx.transaction is the
    // only way to reach exhaustion deterministically: PGlite cannot generate
    // three real collisions (see the file that proves it), and a test that
    // waited for one on real Postgres would be a flake by construction.
    // appendToChain touches only tx.transaction on this path, so the stub is
    // exactly that one method and nothing else — a wider fake would let the
    // test keep passing if the retry loop started doing something else.
    const alwaysCollides = {
      transaction: () => Promise.reject(Object.assign(new Error("dup"), { code: "23505" })),
    } as never;

    const error = await appendToChain(
      alwaysCollides,
      till.tenantId,
      till.tillId,
      altaFor(saleId, 1, 1),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.FISCAL_CHAIN_APPEND_CONTENTION);
    expect((error as AppError).params).toEqual({
      tenantId: till.tenantId,
      tillId: till.tillId,
      attempts: 3,
    });
  });

  it("does not retry an error that is not a chain collision", async () => {
    // A foreign-key violation retried three times is three identical failures
    // reported as contention, sending whoever reads the incident after a race
    // that never happened.
    const saleId = await seedSale(db, till, 1);
    const alwaysFk = {
      transaction: () => Promise.reject(Object.assign(new Error("fk"), { code: "23503" })),
    } as never;

    const error = await appendToChain(
      alwaysFk,
      till.tenantId,
      till.tillId,
      altaFor(saleId, 1, 1),
    ).catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "23503" });
  });
});

describe("isUniqueViolation", () => {
  it("recognises a bare driver error", () => {
    expect(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
  });

  it("recognises a violation wrapped in a cause chain", () => {
    // Drizzle wraps some driver errors; a guard that only inspects the top
    // level silently stops retrying and starts throwing the wrong error.
    const inner = Object.assign(new Error("dup"), { code: "23505" });
    expect(isUniqueViolation(new Error("outer", { cause: new Error("mid", { cause: inner }) }))).toBe(true);
  });

  it("does not treat a foreign-key violation as a chain collision", () => {
    // 23503, not 23505. Retrying an FK violation loops pointlessly and then
    // reports contention that never happened.
    expect(isUniqueViolation(Object.assign(new Error("fk"), { code: "23503" }))).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const looped: Error & { cause?: unknown } = new Error("loop");
    looped.cause = looped;
    expect(isUniqueViolation(looped)).toBe(false);
  });
});
```

`packages/fiscal-verifactu/src/chain.concurrency.test.ts` — **real Postgres only**:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { appendToChain } from "./chain.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { altaFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";

const WRITERS = 20;

let pg: RealPostgres;
let admin: Database;
let till: SeededTill;
let other: SeededTill;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
});

afterAll(async () => {
  await pg.stop();
});

beforeEach(async () => {
  await admin.execute(sql`truncate tenants restart identity cascade`);
  till = await seedTill(admin, "A");
  other = await seedTill(admin, "B");
});

describe("appendToChain under real contention", () => {
  it("runs its writers on distinct backend processes", async () => {
    // THE LOAD-BEARING ASSERTION. PGlite serialises every query onto one
    // backend, so this returns the same pid twice there and the rest of this
    // suite would be theatre. If this ever fails, nothing below it means
    // anything, whatever colour it reports.
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => pg.connect()));
    const pids = await Promise.all(
      dbs.map(async (db) => {
        const [row] = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        return row?.pid;
      }),
    );
    expect(new Set(pids).size).toBe(WRITERS);
  });

  it("commits all 20 concurrent appends to one chain", async () => {
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => pg.connect()));
    const sales = await Promise.all(dbs.map((_, i) => seedSale(admin, till, i + 1)));

    const results = await Promise.all(
      dbs.map((db, i) =>
        db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(sales[i]!, i + 1, i))),
      ),
    );

    // Naive read-then-write committed 3 of 20 here. Anything below 20 is that
    // failure, not a flake.
    expect(results).toHaveLength(WRITERS);
    const [{ count }] = await admin.execute<{ count: number }>(sql`
      select count(*)::int as count from registros_facturacion where till_id = ${till.tillId}
    `);
    expect(count).toBe(WRITERS);
  });

  it("assigns every concurrent append a distinct position with no gaps", async () => {
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => pg.connect()));
    const sales = await Promise.all(dbs.map((_, i) => seedSale(admin, till, i + 1)));
    await Promise.all(
      dbs.map((db, i) =>
        db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(sales[i]!, i + 1, i))),
      ),
    );
    const rows = await admin.execute<{ secuencia: number }>(sql`
      select secuencia from registros_facturacion where till_id = ${till.tillId} order by secuencia
    `);
    expect(rows.map((r) => r.secuencia)).toEqual(Array.from({ length: WRITERS }, (_, i) => i + 1));
  });

  it("leaves every record correctly chained to its predecessor", async () => {
    const dbs = await Promise.all(Array.from({ length: WRITERS }, () => pg.connect()));
    const sales = await Promise.all(dbs.map((_, i) => seedSale(admin, till, i + 1)));
    await Promise.all(
      dbs.map((db, i) =>
        db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(sales[i]!, i + 1, i))),
      ),
    );
    const rows = await admin.execute<{ secuencia: number; huella: string; encadenamiento_huella: string | null; primer_registro: string | null }>(sql`
      select secuencia, huella, encadenamiento_huella, primer_registro
      from registros_facturacion where till_id = ${till.tillId} order by secuencia
    `);
    expect(rows[0]?.primer_registro).toBe("S");
    for (let i = 1; i < rows.length; i++) {
      // Walking the whole chain, not spot-checking the ends: a single crossed
      // pair in the middle is precisely what a lost race produces.
      expect(rows[i]?.encadenamiento_huella).toBe(rows[i - 1]?.huella);
    }
  });

  it("blocks a second appender on the same chain", async () => {
    // Deterministic rather than timing-based: hold the head-row lock open,
    // then prove a second writer on that chain waits until lock_timeout.
    const holder = await pg.connect();
    const waiter = await pg.connect();
    const saleId = await seedSale(admin, till, 1);
    await admin.transaction(async (tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, 1, 1)));

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const holding = holder.transaction(async (tx) => {
      await tx.execute(sql`select 1 from cadenas where till_id = ${till.tillId} for update`);
      await held;
    });

    const second = await seedSale(admin, till, 2);
    await expect(
      waiter.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '250ms'`);
        return appendToChain(tx, till.tenantId, till.tillId, altaFor(second, 2, 2));
      }),
    ).rejects.toMatchObject({ code: "55P03" });

    release();
    await holding;
  });

  it("does not block an appender on a different till", async () => {
    // Per-tenant and per-till parallelism is the reason the lock is on a row
    // rather than an advisory key: a busy till must never stall a quiet one.
    const holder = await pg.connect();
    const writer = await pg.connect();
    const first = await seedSale(admin, till, 1);
    await admin.transaction(async (tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(first, 1, 1)));

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const holding = holder.transaction(async (tx) => {
      await tx.execute(sql`select 1 from cadenas where till_id = ${till.tillId} for update`);
      await held;
    });

    const elsewhere = await seedSale(admin, other, 1);
    const result = await writer.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '250ms'`);
      return appendToChain(tx, other.tenantId, other.tillId, altaFor(elsewhere, 1, 1));
    });
    expect(result.secuencia).toBe(1);

    release();
    await holding;
  });
});
```

`packages/fiscal-verifactu/src/chain.pglite-cannot-test-contention.test.ts` — the demonstration:

```ts
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, runMigrations, type Database } from "@waitron/db";
import { appendToChain } from "./chain.js";
import { altaFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";

const WRITERS = 20;

let db: Database;
let till: SeededTill;

beforeEach(async () => {
  db = await createPgliteDb();
  await runMigrations(db, { migrationsFolder: "../db/drizzle", migrationsTable: "__drizzle_migrations" });
  await runMigrations(db, { migrationsFolder: "./drizzle", migrationsTable: "__drizzle_migrations_fiscal" });
  till = await seedTill(db);
});

/**
 * This file is a permanent, executable demonstration that the concurrency
 * suite CANNOT live on PGlite. It is not a duplicate of that suite; it is the
 * counter-example that keeps someone from "simplifying" the Testcontainers
 * dependency away six months from now.
 */
describe("PGlite cannot test lock contention", () => {
  it("reports a green 20-writer contention run — while proving nothing", async () => {
    const sales = await Promise.all(Array.from({ length: WRITERS }, (_, i) => seedSale(db, till, i + 1)));
    await Promise.all(
      sales.map((saleId, i) =>
        db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, i + 1, i))),
      ),
    );
    const rows = await db.execute<{ secuencia: number }>(sql`
      select secuencia from registros_facturacion where till_id = ${till.tillId} order by secuencia
    `);
    // Green. Identical assertions to the real-Postgres suite. Worthless.
    expect(rows.map((r) => r.secuencia)).toEqual(Array.from({ length: WRITERS }, (_, i) => i + 1));
  });

  it("serialises every 'concurrent' query onto one backend process", async () => {
    // Here is WHY the run above is worthless. Twenty writers, one pid. There
    // was never any contention to survive, so FOR UPDATE never blocked and
    // the unique constraint was never approached. If this test ever FAILS
    // because the pids differ, PGlite has gained real concurrency and the
    // decision to require Testcontainers may be revisited — deliberately, on
    // evidence, not by assumption.
    const pids = await Promise.all(
      Array.from({ length: WRITERS }, async () => {
        const [row] = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        return row?.pid;
      }),
    );
    expect(new Set(pids).size).toBe(1);
  });
});
```

- [ ] **Step 5: Run each test individually and watch it fail**

The Global Constraint requires per-test red observation, not per-file. Run them one at a time:

```bash
cd packages/fiscal-verifactu
pnpm vitest run -t "assigns secuencia 1 to the first record of a chain"
```

Expected: FAIL — `Failed to resolve import "./chain.js"`.

Repeat for every test name above, confirming each fails on its own. Pay particular attention to `"reports a green 20-writer contention run — while proving nothing"`: it must fail red now, for the import, and go green later. A test that passes here is a defect in the test, not a head start.

- [ ] **Step 6: Implement the row mapping**

The registro row stores **the exact literals that were hashed**, not re-derived values.

> The Global Constraint says "nothing formatted is ever stored — exact decimals (`numeric`)". That rule is correct for the generic layer and **must not be applied to `registros_facturacion`**. AEAT recomputes the huella from the literal it received, so `123.1` and `123.10` are both valid and hash differently. Storing `importe_total` as `numeric(12,2)` and re-rendering it at verification time would produce a different literal and therefore a different huella — a chain that fails its own art. 7.i check on rows nobody touched. `sales.total` is `numeric(12,2)`; `registros_facturacion.importe_total` is `text`, and the two are allowed to disagree in representation because only one of them is hashed.

`packages/fiscal-verifactu/src/registro-row.ts`:

```ts
import { huellaAnteriorOf, isAlta } from "@waitron/verifactu";
import type { RegistroAlta, RegistroAnulacion } from "@waitron/verifactu";

/** The persisted shape. Every hashed field is stored as its exact literal. */
export interface RegistroRow {
  id: string;
  tenant_id: string;
  till_id: string;
  secuencia: number;
  sale_id: string;
  tipo_registro: "alta" | "anulacion";
  id_emisor_factura: string;
  num_serie_factura: string;
  fecha_expedicion_factura: string;
  tipo_factura: string | null;
  cuota_total: string | null;
  importe_total: string | null;
  desglose: unknown;
  nombre_razon_emisor: string | null;
  descripcion_operacion: string | null;
  primer_registro: "S" | null;
  encadenamiento_id_emisor_factura: string | null;
  encadenamiento_num_serie_factura: string | null;
  encadenamiento_fecha_expedicion_factura: string | null;
  encadenamiento_huella: string | null;
  sistema_informatico: unknown;
  fecha_hora_huso_gen_registro: string;
  tipo_huella: "01";
  huella: string;
}

export type RegistroRowInsert = Omit<RegistroRow, "id">;

export interface RegistroRowContext {
  tenantId: string;
  tillId: string;
  secuencia: number;
  saleId: string;
}

/**
 * Flattens a built record into columns.
 *
 * The four Encadenamiento columns use the ALTA-style names in both record
 * types. That is not a shortcut: RegistroAnterior's sub-elements are
 * IDEmisorFactura / NumSerieFactura / FechaExpedicionFactura even when the
 * record doing the pointing is an anulación, whose own IDFactura uses the
 * ...Anulada names. One set of columns therefore serves both directions.
 */
export function toRegistroRow(
  record: RegistroAlta | RegistroAnulacion,
  ctx: RegistroRowContext,
): RegistroRowInsert {
  const anterior = record.Encadenamiento.RegistroAnterior;
  const common = {
    tenant_id: ctx.tenantId,
    till_id: ctx.tillId,
    secuencia: ctx.secuencia,
    sale_id: ctx.saleId,
    primer_registro: anterior === undefined ? ("S" as const) : null,
    encadenamiento_id_emisor_factura: anterior?.IDEmisorFactura ?? null,
    encadenamiento_num_serie_factura: anterior?.NumSerieFactura ?? null,
    encadenamiento_fecha_expedicion_factura: anterior?.FechaExpedicionFactura ?? null,
    encadenamiento_huella: anterior?.Huella ?? null,
    sistema_informatico: record.SistemaInformatico,
    fecha_hora_huso_gen_registro: record.FechaHoraHusoGenRegistro,
    tipo_huella: record.TipoHuella,
    huella: record.Huella,
  };

  if (isAlta(record)) {
    return {
      ...common,
      tipo_registro: "alta",
      id_emisor_factura: record.IDFactura.IDEmisorFactura,
      num_serie_factura: record.IDFactura.NumSerieFactura,
      fecha_expedicion_factura: record.IDFactura.FechaExpedicionFactura,
      tipo_factura: record.TipoFactura,
      cuota_total: record.CuotaTotal,
      importe_total: record.ImporteTotal,
      desglose: record.Desglose,
      nombre_razon_emisor: record.NombreRazonEmisor,
      descripcion_operacion: record.DescripcionOperacion,
    };
  }

  return {
    ...common,
    tipo_registro: "anulacion",
    id_emisor_factura: record.IDFactura.IDEmisorFacturaAnulada,
    num_serie_factura: record.IDFactura.NumSerieFacturaAnulada,
    fecha_expedicion_factura: record.IDFactura.FechaExpedicionFacturaAnulada,
    tipo_factura: null,
    cuota_total: null,
    importe_total: null,
    desglose: null,
    nombre_razon_emisor: null,
    descripcion_operacion: null,
  };
}

/** The four-part pointer for the NEXT record, read off a stored row. */
export function pointerTo(row: Pick<RegistroRow, "id_emisor_factura" | "num_serie_factura" | "fecha_expedicion_factura" | "huella">) {
  return {
    IDEmisorFactura: row.id_emisor_factura,
    NumSerieFactura: row.num_serie_factura,
    FechaExpedicionFactura: row.fecha_expedicion_factura,
    Huella: row.huella,
  };
}

export { huellaAnteriorOf };
```

- [ ] **Step 7: Implement the chain append**

`packages/fiscal-verifactu/src/chain.ts`:

```ts
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError, ErrorCode } from "@waitron/shared";
import { buildAltaRecord, buildAnulacionRecord } from "@waitron/verifactu";
import type { AltaInput, AnulacionInput, Encadenamiento } from "@waitron/verifactu";
import { pointerTo, toRegistroRow, type RegistroRow } from "./registro-row.js";

const UNIQUE_VIOLATION = "23505";

/**
 * Three, not one and not ten. One is not a retry. Ten converts a genuine
 * duplicate — a real bug, or a second process writing the same position by
 * some path that never takes the lock — into ten pointless round trips before
 * the same failure. The retry exists only for the narrow window in which two
 * writers race to CREATE a chain head that does not yet exist and therefore
 * cannot be locked; after that window the FOR UPDATE serialises everything,
 * so a fourth collision means something is wrong that retrying will not fix.
 */
const MAX_APPEND_ATTEMPTS = 3;

export type PendingRegistro =
  | { tipo: "alta"; saleId: string; input: Omit<AltaInput, "Encadenamiento"> }
  | { tipo: "anulacion"; saleId: string; input: Omit<AnulacionInput, "Encadenamiento"> };

export interface ChainHead {
  secuencia: number;
  ultimo_registro_id: string | null;
  ultima_huella: string | null;
}

/**
 * Is this (or anything it wraps) a unique-constraint violation?
 *
 * Walks the cause chain because Drizzle wraps some driver errors, and stops
 * at a fixed depth so a self-referential cause cannot spin. Checking only the
 * top level would silently stop retrying and start reporting the wrong error.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === current) return false;
    current = next;
  }
  return false;
}

/**
 * Takes the chain-head row lock, creating the head if this is a fresh till.
 *
 * Exported because art. 7.i verification (`verifyChain`) must read the last
 * two records under the SAME lock, in the SAME transaction — a verification
 * that examines a predecessor another writer is concurrently replacing has
 * verified nothing. Re-acquiring the lock in appendToChain afterwards is free:
 * the transaction already holds it.
 *
 * `on conflict do nothing` is not merely idempotence. When a concurrent
 * transaction has inserted the head but not yet committed, Postgres makes the
 * speculative insert WAIT on that transaction and then do nothing, so the
 * re-select below sees the committed row rather than an invisible one. That
 * ordering is why this is two statements and not an upsert-returning.
 */
export async function lockChainHead(
  tx: Transaction,
  tenantId: string,
  tillId: string,
): Promise<ChainHead> {
  const select = sql`
    select secuencia, ultimo_registro_id, ultima_huella
    from cadenas
    where tenant_id = ${tenantId} and till_id = ${tillId}
    for update
  `;

  const [existing] = await tx.execute<ChainHead>(select);
  if (existing !== undefined) return existing;

  await tx.execute(sql`
    insert into cadenas (tenant_id, till_id, secuencia)
    values (${tenantId}, ${tillId}, 0)
    on conflict (tenant_id, till_id) do nothing
  `);

  const [created] = await tx.execute<ChainHead>(select);
  if (created === undefined) {
    throw new AppError(ErrorCode.FISCAL_CHAIN_APPEND_CONTENTION, {
      tenantId,
      tillId,
      attempts: 0,
    });
  }
  return created;
}

async function attemptAppend(
  tx: Transaction,
  tenantId: string,
  tillId: string,
  registro: PendingRegistro,
): Promise<{ secuencia: number; huella: string }> {
  const head = await lockChainHead(tx, tenantId, tillId);
  const secuencia = head.secuencia + 1;

  let encadenamiento: Encadenamiento;
  if (head.ultimo_registro_id === null) {
    // Start of chain. Both start-of-chain states are NORMAL: the huella is
    // computed and stored here exactly as it is for every other record, over
    // an EMPTY predecessor huella.
    encadenamiento = { PrimerRegistro: "S" };
  } else {
    const [previous] = await tx.execute<RegistroRow>(sql`
      select id_emisor_factura, num_serie_factura, fecha_expedicion_factura, huella
      from registros_facturacion
      where id = ${head.ultimo_registro_id}
    `);
    if (previous === undefined) {
      throw new AppError(ErrorCode.FISCAL_CHAIN_APPEND_CONTENTION, { tenantId, tillId, attempts: 0 });
    }
    encadenamiento = { RegistroAnterior: pointerTo(previous) };
  }

  const record =
    registro.tipo === "alta"
      ? buildAltaRecord({ ...registro.input, Encadenamiento: encadenamiento })
      : buildAnulacionRecord({ ...registro.input, Encadenamiento: encadenamiento });

  const row = toRegistroRow(record, { tenantId, tillId, secuencia, saleId: registro.saleId });

  const [inserted] = await tx.execute<{ id: string }>(sql`
    insert into registros_facturacion (
      tenant_id, till_id, secuencia, sale_id, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura,
      tipo_factura, cuota_total, importe_total, desglose,
      nombre_razon_emisor, descripcion_operacion, primer_registro,
      encadenamiento_id_emisor_factura, encadenamiento_num_serie_factura,
      encadenamiento_fecha_expedicion_factura, encadenamiento_huella,
      sistema_informatico, fecha_hora_huso_gen_registro, tipo_huella, huella
    ) values (
      ${row.tenant_id}, ${row.till_id}, ${row.secuencia}, ${row.sale_id}, ${row.tipo_registro},
      ${row.id_emisor_factura}, ${row.num_serie_factura}, ${row.fecha_expedicion_factura},
      ${row.tipo_factura}, ${row.cuota_total}, ${row.importe_total}, ${JSON.stringify(row.desglose)}::jsonb,
      ${row.nombre_razon_emisor}, ${row.descripcion_operacion}, ${row.primer_registro},
      ${row.encadenamiento_id_emisor_factura}, ${row.encadenamiento_num_serie_factura},
      ${row.encadenamiento_fecha_expedicion_factura}, ${row.encadenamiento_huella},
      ${JSON.stringify(row.sistema_informatico)}::jsonb, ${row.fecha_hora_huso_gen_registro},
      ${row.tipo_huella}, ${row.huella}
    ) returning id
  `);

  await tx.execute(sql`
    update cadenas
    set secuencia = ${secuencia}, ultimo_registro_id = ${inserted!.id}, ultima_huella = ${row.huella}
    where tenant_id = ${tenantId} and till_id = ${tillId}
  `);

  return { secuencia, huella: row.huella };
}

/**
 * Appends one record to the (tenant, till) chain, in the caller's transaction.
 *
 * Each attempt runs inside a nested transaction, which Drizzle emits as
 * SAVEPOINT / ROLLBACK TO SAVEPOINT. That is not decoration: in Postgres a
 * unique violation aborts the whole transaction, so without a savepoint the
 * "retry" would issue its next statement against a transaction that can only
 * accept ROLLBACK — and the sale, already written in the same transaction,
 * would be lost with it.
 */
export async function appendToChain(
  tx: Transaction,
  tenantId: string,
  tillId: string,
  registro: PendingRegistro,
): Promise<{ secuencia: number; huella: string }> {
  for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
    try {
      return await tx.transaction((nested) => attemptAppend(nested, tenantId, tillId, registro));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new AppError(ErrorCode.FISCAL_CHAIN_APPEND_CONTENTION, {
    tenantId,
    tillId,
    attempts: MAX_APPEND_ATTEMPTS,
  });
}
```

- [ ] **Step 8: Run the suites**

```bash
cd packages/fiscal-verifactu
pnpm vitest run src/chain.test.ts src/chain.pglite-cannot-test-contention.test.ts
```

Expected: PASS, 17 tests.

```bash
pnpm vitest run src/chain.concurrency.test.ts
```

Expected: PASS, 6 tests.

```bash
pnpm typecheck && pnpm lint
```

Expected: typecheck passes with no output; lint passes with no output.

- [ ] **Step 9: Teeth check — break it and watch it scream**

Confirm these tests have teeth rather than merely executing the code. Each mutation names the tests it must break; a mutation that leaves the suite green means a test is missing, not that the code is robust.

Temporarily change `for update` in `lockChainHead` to a plain select:

```bash
pnpm vitest run src/chain.concurrency.test.ts
```

Expected: FAIL — `commits all 20 concurrent appends to one chain`, `assigns every concurrent append a distinct position with no gaps` and `blocks a second appender on the same chain`. Restore it.

Now, with that same mutation still applied, run the PGlite files:

```bash
pnpm vitest run src/chain.test.ts src/chain.pglite-cannot-test-contention.test.ts
```

Expected: PASS, 17 tests — **green, with the lock removed**. Not one assertion moves. This is the false pass, reproduced on demand. It is the reason the concurrency suite may never be moved to PGlite and may never be made conditional on Docker. Restore the lock.

Temporarily drop the unique constraint:

```sql
alter table registros_facturacion drop constraint registros_facturacion_tenant_till_secuencia_key;
```

Expected: FAIL — `rejects a second record claiming an occupied chain position`. Restore it.

Temporarily change `MAX_APPEND_ATTEMPTS` to `1`.

Expected: FAIL — `surfaces exhausted retries as a structured AppError, never a bare string` (on `attempts: 3`). Restore it.

Temporarily replace the `AppError` throw with `throw new Error("chain append contention")`.

Expected: FAIL — the same test, on `toBeInstanceOf(AppError)`. Restore it.

Temporarily order the predecessor lookup by `num_serie_factura` instead of using `head.ultimo_registro_id`.

Expected: FAIL — `does not derive chain position from the invoice number`. Restore it. This is the "helpful" coupling the test exists to prevent.

Temporarily make `attemptAppend` run directly on `tx` rather than in a nested transaction.

Expected: FAIL — `commits all 20 concurrent appends to one chain`, with a `current transaction is aborted` error rather than a clean retry. Restore it.

Temporarily change `if (!isUniqueViolation(error)) throw error;` to swallow every error and retry.

Expected: FAIL — `does not retry an error that is not a chain collision`. Restore it. That mutation is how a foreign-key violation gets reported to staff as lock contention.

Temporarily change `isUniqueViolation` to inspect only the top-level error, dropping the cause walk.

Expected: FAIL — `recognises a violation wrapped in a cause chain`. Restore it.

- [ ] **Step 10: Commit**

```bash
git add packages/fiscal-verifactu/src/chain.ts \
        packages/fiscal-verifactu/src/chain.test.ts \
        packages/fiscal-verifactu/src/chain.concurrency.test.ts \
        packages/fiscal-verifactu/src/chain.pglite-cannot-test-contention.test.ts \
        packages/fiscal-verifactu/src/registro-row.ts \
        packages/fiscal-verifactu/src/testing/postgres.ts \
        packages/fiscal-verifactu/src/testing/seed.ts \
        packages/fiscal-verifactu/package.json \
        packages/fiscal-verifactu/vitest.config.ts \
        packages/fiscal-verifactu/stryker.config.json \
        packages/shared/src/errors.ts
git commit
```

```text
feat(fiscal-verifactu): chain append with row lock, unique backstop and bounded retry

Serialising chain appends is the one property in this package that cannot be
argued from reading the code, so the strategy was measured rather than chosen.
Twenty concurrent appends to one chain: naive read-then-write committed 3 of
20; a FOR UPDATE lock on the chain head committed 20; an advisory lock matched
it at 18ms; SERIALIZABLE also committed 20 but took 60ms across 57 attempts.
The unique constraint is what kept the chain intact in the naive case, which is
why it stays as the backstop — but on its own it turns a correctness failure
into losing 85% of the sales, which in a restaurant is not an improvement. The
row lock is preferred over the advisory lock because an advisory key is an
integer the application invents, and two call sites that derive it differently
silently take different locks; the row is the key, so it cannot drift. It also
keeps a busy till from stalling a quiet one.

The retry is bounded at three and each attempt runs inside a savepoint. Both
are load-bearing. Without the savepoint, a unique violation aborts the whole
transaction — including the sale written alongside it — so the "retry" would
issue its next statement against a transaction that can only accept ROLLBACK.
Without the bound, a genuine duplicate written by some path that never takes
the lock becomes an unbounded loop instead of a reported failure. Exhaustion
throws a structured AppError, never prose: this is exactly the error a human
at a till needs told in their own language.

The concurrency suite runs against real Postgres via Testcontainers and cannot
be skipped when Docker is absent. PGlite serialises every query onto a single
backend, so FOR UPDATE parses, runs and never blocks; a contention test written
during design appeared to pass while both statements had merged into one
transaction. That false pass is now a permanent test file of its own, asserting
both that the 20-writer run goes green on PGlite and that pg_backend_pid()
returns one distinct value — so the next person to propose dropping the Docker
dependency is looking at the counter-example rather than at a comment.
```

---

## Task 15: Art. 7.i pre-generation chain verification

Before chaining record _n_, the Orden obliges the system to verify that record _n−1_ is itself correctly chained. The deliverable is that check, in the write path of every sale — and, more importantly, a failure that **records and continues**. This task contains the single most consequential behavioural requirement in the plan, and an earlier draft of the design got it backwards.

**Files:**

- Create: `packages/fiscal-verifactu/src/verify.ts`
- Create: `packages/fiscal-verifactu/src/verify.test.ts`
- Modify: `packages/fiscal-verifactu/src/registro-row.ts` (add `fromRegistroRow`)
- Modify: `eslint.config.js` (a boundary zone: `packages/core` may not reach into the module)

`packages/fiscal/src/backend.ts` is deliberately **not** in that list. `IntegrityReport` and `IntegrityIssue` already exist there from Task 11 and are consumed unchanged — see Step 1.

**Interfaces:**

- Consumes: `lockChainHead` from `./chain.js`; `computeHuella`, `verifyHuella` from `@waitron/verifactu`; `IntegrityReport` from `@waitron/fiscal`.
- Produces:
  - `verifyChain(tx: Transaction, tenantId: TenantId, tillId: TillId): Promise<IntegrityReport>`
  - `fromRegistroRow(row: RegistroRow): RegistroAlta | RegistroAnulacion`

### What the check is, and why we do more than the letter

AEAT's FAQ defines art. 7.i precisely, and narrowly: before generating a new record, verify that record _n−1_'s `Encadenamiento/RegistroAnterior/Huella` matches record _n−2_'s own `Huella` — that is, that the **predecessor is itself correctly chained**, before chaining _n_ onto it.

We run that check, and one more: we **recompute _n−1_'s huella from its stored inputs** and compare it with the huella stored on _n−1_. The two are complementary rather than redundant, and it is worth being exact about which tampering each one catches, because that distinction drives the test matrix below:

| What was tampered with | AEAT's link check | Our recomputation |
| --- | --- | --- |
| _n−2_'s own `huella` column | **fires** | passes |
| _n−1_'s `encadenamiento_huella` column | **fires** | **fires** |
| _n−1_'s `importe_total` / any other hashed literal | passes | **fires** |

So the pair is strictly stronger than the letter of the rule: AEAT's check alone is blind to an edit of _n−1_'s own content, which is the row we are about to chain onto. The recomputation costs one SHA-256 over roughly 200 bytes of already-loaded data, because hashing is a pure function of values we had to read anyway. Going beyond the letter here is free, and the thing it detects is the thing a tamperer would most plausibly do.

One honest limit, stated so nobody assumes more coverage than exists: the recomputation only sees fields that **feed** the huella — the eight alta fields and five anulación fields, no others. `Desglose` is not a huella input. An edit to a desglose line that leaves `CuotaTotal` and `ImporteTotal` unchanged is invisible to art. 7.i, and is caught instead by the immutability control (revoked `UPDATE` from the application role, trigger as backstop). Those are different defences against different threats and neither substitutes for the other.

### The start-of-chain cases are normal states, not failures

- Where _n−1_ carries `PrimerRegistro="S"` there is no _n−2_. The link check is **vacuously true** and only the recomputation applies.
- Where _n_ is itself the first record there is no predecessor at all, and **neither check runs**.

Both are ordinary. **The huella is computed and stored in every case**, including these — that is Task 14's behaviour and this task must not disturb it. A `verifyChain` that reported `ok: false` on a fresh till would raise an incident on every till's first sale, teaching staff to ignore the one alert that matters.

### The requirement that must not be inverted

> **A verification failure must never block the sale.** AEAT, on this exact case: *«será preciso generar el siguiente RF, ya que la facturación por este motivo NUNCA debe interrumpirse»*. An earlier draft of this design had a chain-verification failure halt the till, on the reasoning that extending a known-corrupt chain is worse than stopping. **That draft was wrong**, and it was wrong in the specific way that reads as caution: AEAT weighed the same trade-off and decided the other way, consistently with its position that incidents *"NO suponen en ningún caso que deba interrumpirse la facturación de la empresa"*. Halting a till on a huella mismatch is not a stricter reading of the rules — it is doing the thing the rules tell us not to do.

The consequence for the code is a single unambiguous rule: **`verifyChain` never throws on a verification failure.** It returns an `IntegrityReport` with `ok: false`. A thrown error propagates out of the sale transaction and rolls back the sale, which is precisely the forbidden outcome, so throwing is not a stylistic choice here. `verifyChain` throws only on a genuine database error — a lost connection, a missing table — which is an ordinary operational failure and should stop the sale like any other failed write.

And the consequence for the tests, stated in the terms the spec §10 teeth check uses: corrupt a stored predecessor huella, and art. 7.i must detect it, raise the incident, and **the sale must still complete**. **A test asserting the sale is blocked would enforce the opposite of the requirement.** If a reviewer reads `expect(recordSale(...)).rejects` anywhere in this file, that is the defect, not the fix.

### What this task hands to incident recording

Incident recording is Task 18. This task defines only the handoff, and defines it in **English, regime-neutral vocabulary**, because `IntegrityReport` lives in `packages/fiscal` and crosses to `packages/core` — the word *huella* may not appear in it, or Task 3's guard fires. Task 18 receives `{ tillId, verification }` and owns the incident row, its persistence, and its surfacing to staff and upstream. It receives no huellas, no registro rows and no chain vocabulary.

### Where it runs, and what that costs

This runs in the write path of **every sale**, not in a periodic audit — art. 7.i says *before generating each new record*. Per sale it adds one index scan returning two rows (served by the `(tenant_id, till_id, secuencia)` unique index Task 14 already requires, so no new index) and one SHA-256 over a short string. Both are microseconds against a transaction that is already doing several inserts.

> Task 1's PGlite benchmark measured the local-server topology against the sale write path as specified at the time, which did **not** include the art. 7.i two-row read and recomputation. Its per-sale figure therefore understates the real cost, by a small and predictable amount but by a nonzero one. **Resolve this when implementing: re-run Task 1's benchmark against the completed write path once Task 17 lands, and record the delta in the same place the original figure was recorded.** A benchmark that silently describes a shape the system no longer has is the kind of number people quote for years.

### The boundary

Art. 7.i verification stays **entirely inside the module** (spec §2). `packages/core` calls `backend.checkIntegrity(tx, tillId)`, receives an `IntegrityReport`, and does exactly two things with it: passes it to incident recording when `ok` is false, and carries on. It never reads module tables, never computes a hash, and never imports `@waitron/fiscal-verifactu` or `@waitron/verifactu`. Step 6 adds the lint zone that makes this mechanical rather than a matter of review discipline.

- [ ] **Step 1: Bind to the verification result `packages/fiscal` already defines**

**This step adds no types.** `IntegrityReport` and `IntegrityIssue` were created in Task 11 Step 6 and are imported from `@waitron/fiscal` unchanged:

```ts
export interface IntegrityIssue {
  code: string;
  params: Record<string, unknown>;
  recordId?: string;
}

export interface IntegrityReport {
  ok: boolean;
  checked: number;
  issues: readonly IntegrityIssue[];
}
```

An earlier draft of this task appended a second pair, `ChainVerification`/`ChainVerificationFailure`, to the same `backend.ts` — two names for one concept in one file, which typechecks and is exactly the drift this plan's naming contract exists to prevent. The reasoning behind that draft survives; only the spelling changes, and both of its design points map onto the existing shape without loss:

**`checked` carries what `scope` carried.** The earlier draft argued — correctly — that "verified nothing because there was nothing to verify" must be distinguishable from "verified everything and it was fine", or a healthy new till looks identical to a check that quietly stopped running. `checked` is that distinction and is strictly more informative than a three-value enum, because it counts the records actually examined:

| Situation | `checked` |
| --- | --- |
| _n_ is itself the first record; no predecessor exists and neither check runs | `0` |
| _n−1_ carries `PrimerRegistro="S"`; there is no _n−2_, so only the recomputation applies | `1` |
| _n−1_ and _n−2_ both exist; both checks run | `2` |

`ok: true, checked: 0` is therefore a true and normal answer on a fresh till, not a failure — and it is the same answer a regime with nothing to check gives, which is the property the naming contract uses to test whether a generic name is honest rather than merely vague.

**The three reasons become `code`, and `expected`/`found` become `params`.** `IntegrityIssue` is deliberately a code plus params rather than a fixed field set: a report is persisted into an incident row and displayed, so it must survive JSON, and a second backend with a different hash and a different chaining rule needs to report its own reasons without widening a shared union. The three codes this backend emits are `predecessor-hash-mismatch`, `predecessor-link-mismatch` and `predecessor-missing`. They remain regime-neutral English — this type crosses into `packages/core`, where "huella" would (correctly) trip the Spanish-vocabulary guard.

- [ ] **Step 2: Write the failing tests**

`packages/fiscal-verifactu/src/verify.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, runMigrations, type Database } from "@waitron/db";
import { appendToChain } from "./chain.js";
import { verifyChain } from "./verify.js";
import { altaFor, anulacionFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";

let db: Database;
let till: SeededTill;

beforeEach(async () => {
  db = await createPgliteDb();
  await runMigrations(db, { migrationsFolder: "../db/drizzle", migrationsTable: "__drizzle_migrations" });
  await runMigrations(db, { migrationsFolder: "./drizzle", migrationsTable: "__drizzle_migrations_fiscal" });
  till = await seedTill(db);
});

/** Appends `n` altas and returns their chain positions in order. */
async function appendAltas(n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    const saleId = await seedSale(db, till, i);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, i, i)));
  }
}

/**
 * Overwrites one column on one stored registro.
 *
 * This needs the OWNER role and a disabled trigger, which is the point: the
 * fact that corrupting a row takes both is the immutability control working.
 * Nothing the application role can do reaches this code path — which is also
 * why every immutability test must run as app_user, never as the owner.
 */
async function corrupt(secuencia: number, column: string, value: string): Promise<void> {
  await db.execute(sql`alter table registros_facturacion disable trigger registros_facturacion_immutable`);
  await db.execute(
    sql`update registros_facturacion set ${sql.raw(column)} = ${value}
        where till_id = ${till.tillId} and secuencia = ${secuencia}`,
  );
  await db.execute(sql`alter table registros_facturacion enable trigger registros_facturacion_immutable`);
}

const BOGUS = "F".repeat(64);

describe("verifyChain — normal states", () => {
  it("reports nothing checked on an empty chain", async () => {
    // n is itself the first record: neither check runs, and that is normal.
    const result = await db.transaction((tx) => verifyChain(tx, till.tenantId, till.tillId));
    expect(result).toEqual({ ok: true, checked: 0, issues: [] });
  });

  it("reports one record checked when n−1 carries PrimerRegistro=S", async () => {
    // There is no n−2, so the link check is vacuously true; only the
    // recomputation applies, and it passes.
    await appendAltas(1);
    const result = await db.transaction((tx) => verifyChain(tx, till.tenantId, till.tillId));
    expect(result).toEqual({ ok: true, checked: 1, issues: [] });
  });

  it("reports two records checked once n−1 and n−2 both exist", async () => {
    await appendAltas(2);
    const result = await db.transaction((tx) => verifyChain(tx, till.tenantId, till.tillId));
    expect(result).toEqual({ ok: true, checked: 2, issues: [] });
  });

  it("verifies across an alta/anulación boundary", async () => {
    // One chain, both record types, generation order. The recomputation must
    // use the anulación's five-field canonical string, not the alta's eight.
    await appendAltas(1);
    const saleId = await seedSale(db, till, 2);
    await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, anulacionFor(saleId, 1, 5)));
    const result = await db.transaction((tx) => verifyChain(tx, till.tenantId, till.tillId));
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(2);
  });

  it("still stores a huella on every record it verified", async () => {
    await appendAltas(3);
    const rows = await db.execute<{ huella: string }>(sql`
      select huella from registros_facturacion where till_id = ${till.tillId} order by secuencia
    `);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.huella).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe("verifyChain — detection", () => {
  it("detects tampering with n−1's own hashed content", async () => {
    // AEAT's link check is blind to this: n−1's pointer to n−2 is untouched.
    // Only the recomputation catches it, which is why we go beyond the letter.
    await appendAltas(2);
    await corrupt(2, "importe_total", "999.99");
    const result = await db.transaction((tx) => verifyChain(tx, till.tenantId, till.tillId));
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(["predecessor-hash-mismatch"]);
  });

  it("detects a broken link from n−1 to n−2", async () => {
    // Corrupting n−2's OWN huella leaves n−1 internally consistent, so the
    // recomputation passes and only AEAT's link check fires. This is the case
    // that proves the two checks are complementary rather than one covering
    // the other.
    await appendAltas(2);
    await corrupt(1, "huella", BOGUS);
    const result = await db.transaction((tx) => verifyChain(tx, till.tenantId, till.tillId));
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(["predecessor-link-mismatch"]);
  });

  it("reports both failures when n−1's predecessor pointer is rewritten", async () => {
    // Rewriting encadenamiento_huella breaks n−1's own hash AND its link, so
    // both fire. `issues` is an array, not a first-failure-wins field: an
    // incident naming one of two problems sends staff after half the story.
    await appendAltas(2);
    await corrupt(2, "encadenamiento_huella", BOGUS);
    const result = await db.transaction((tx) => verifyChain(tx, till.tenantId, till.tillId));
    expect(result.issues.map((i) => i.code).sort()).toEqual([
      "predecessor-hash-mismatch",
      "predecessor-link-mismatch",
    ]);
  });

  it("carries the expected and found values on a link failure", async () => {
    await appendAltas(2);
    const [predecessor] = await db.execute<{ huella: string }>(sql`
      select huella from registros_facturacion where till_id = ${till.tillId} and secuencia = 1
    `);
    await corrupt(1, "huella", BOGUS);
    const result = await db.transaction((tx) => verifyChain(tx, till.tenantId, till.tillId));
    const link = result.issues.find((i) => i.code === "predecessor-link-mismatch");
    expect(link?.params.expected).toBe(BOGUS);
    expect(link?.params.found).toBe(predecessor?.huella);
  });

  it("omits expected and found entirely when the predecessor row is gone", async () => {
    // Object.hasOwn, not toBeUndefined: the latter cannot tell an absent key
    // from a key explicitly set to undefined, and a params object serialised
    // into an incident row records those two states differently.
    await appendAltas(2);
    await db.execute(sql`alter table registros_facturacion disable trigger registros_facturacion_immutable`);
    await db.execute(sql`delete from registros_facturacion where till_id = ${till.tillId} and secuencia = 1`);
    await db.execute(sql`alter table registros_facturacion enable trigger registros_facturacion_immutable`);
    const result = await db.transaction((tx) => verifyChain(tx, till.tenantId, till.tillId));
    const missing = result.issues.find((i) => i.code === "predecessor-missing");
    expect(missing).toBeDefined();
    expect(Object.hasOwn(missing!.params, "expected")).toBe(false);
    expect(Object.hasOwn(missing!.params, "found")).toBe(false);
  });

  it("locates the predecessor by chain position, never by invoice number", async () => {
    // Invoice numbers deliberately descend. A verifier that ordered by
    // num_serie_factura would compare the wrong pair and report a failure on
    // an intact chain — noise indistinguishable from a real incident.
    for (const [i, number] of [500, 44, 7].entries()) {
      const saleId = await seedSale(db, till, number);
      await db.transaction((tx) => appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, number, i)));
    }
    const result = await db.transaction((tx) => verifyChain(tx, till.tenantId, till.tillId));
    expect(result).toEqual({ ok: true, checked: 2, issues: [] });
  });
});

describe("verifyChain — never blocks the sale", () => {
  it("returns rather than throws when verification fails", async () => {
    // The single most important assertion in this file. A throw propagates
    // out of the sale transaction and rolls the sale back, which is exactly
    // what AEAT forbids: «la facturación por este motivo NUNCA debe
    // interrumpirse».
    await appendAltas(2);
    await corrupt(2, "importe_total", "999.99");
    const result = await db.transaction((tx) => verifyChain(tx, till.tenantId, till.tillId));
    expect(result.ok).toBe(false);
  });

  it("chains the next record anyway after a detected corruption", async () => {
    // The spec §10 teeth check, in full: corrupt a stored predecessor huella,
    // art. 7.i detects it, and the sale STILL COMPLETES. A test asserting the
    // sale is blocked would enforce the opposite of the requirement — if you
    // find yourself writing `.rejects` here, stop and re-read spec §4.
    await appendAltas(2);
    await corrupt(1, "huella", BOGUS);

    const saleId = await seedSale(db, till, 3);
    const { verification, appended } = await db.transaction(async (tx) => {
      const verification = await verifyChain(tx, till.tenantId, till.tillId);
      const appended = await appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, 3, 3));
      return { verification, appended };
    });

    expect(verification.ok).toBe(false);
    expect(appended.secuencia).toBe(3);
    const rows = await db.execute<{ secuencia: number; huella: string; encadenamiento_huella: string | null }>(sql`
      select secuencia, huella, encadenamiento_huella
      from registros_facturacion where till_id = ${till.tillId} order by secuencia
    `);
    expect(rows).toHaveLength(3);
    // And it chained onto the record that was actually there, corruption and
    // all — the chain continues, it does not fork or restart.
    expect(rows[2]?.encadenamiento_huella).toBe(rows[1]?.huella);
    expect(rows[2]?.huella).toMatch(/^[0-9A-F]{64}$/);
  });

  it("hands the incident recorder a regime-neutral payload", async () => {
    // What Task 18 receives. No huellas by that name, no registro rows, no
    // chain vocabulary — it must work unchanged for a TicketBAI backend.
    await appendAltas(2);
    await corrupt(2, "importe_total", "999.99");
    const result = await db.transaction((tx) => verifyChain(tx, till.tenantId, till.tillId));
    expect(Object.keys(result).sort()).toEqual(["checked", "issues", "ok"]);
    expect(Object.keys(result.issues[0]!).sort()).toEqual(["code", "params", "recordId"]);
  });
});
```

- [ ] **Step 3: Run each test individually and watch it fail**

Expected: FAIL — unresolved import `./verify.js`.

Run every test name above on its own. `reports no-predecessor on an empty chain` is the one to watch: it is the test most likely to pass for the wrong reason once `verify.ts` exists but does nothing.

- [ ] **Step 4: Add row rehydration**

`packages/fiscal-verifactu/src/registro-row.ts` — append:

```ts
import type { Encadenamiento, RegistroAlta, RegistroAnulacion } from "@waitron/verifactu";

/**
 * Rebuilds a record from its stored columns, for recomputation only.
 *
 * Every value is returned exactly as stored — no reformatting, no numeric
 * round-trip. That is the whole point: the huella is SHA-256 over the literal
 * that was serialised, so re-deriving "123.10" from a numeric 123.1 would
 * produce a different hash and report a corrupt chain on untouched rows.
 */
export function fromRegistroRow(row: RegistroRow): RegistroAlta | RegistroAnulacion {
  const encadenamiento: Encadenamiento =
    row.primer_registro === "S"
      ? { PrimerRegistro: "S" }
      : {
          RegistroAnterior: {
            IDEmisorFactura: row.encadenamiento_id_emisor_factura ?? "",
            NumSerieFactura: row.encadenamiento_num_serie_factura ?? "",
            FechaExpedicionFactura: row.encadenamiento_fecha_expedicion_factura ?? "",
            Huella: row.encadenamiento_huella ?? "",
          },
        };

  const common = {
    IDVersion: "1.0" as const,
    Encadenamiento: encadenamiento,
    SistemaInformatico: row.sistema_informatico as RegistroAlta["SistemaInformatico"],
    FechaHoraHusoGenRegistro: row.fecha_hora_huso_gen_registro,
    TipoHuella: row.tipo_huella,
    Huella: row.huella,
  };

  if (row.tipo_registro === "anulacion") {
    return {
      ...common,
      IDFactura: {
        IDEmisorFacturaAnulada: row.id_emisor_factura,
        NumSerieFacturaAnulada: row.num_serie_factura,
        FechaExpedicionFacturaAnulada: row.fecha_expedicion_factura,
      },
    };
  }

  return {
    ...common,
    IDFactura: {
      IDEmisorFactura: row.id_emisor_factura,
      NumSerieFactura: row.num_serie_factura,
      FechaExpedicionFactura: row.fecha_expedicion_factura,
    },
    NombreRazonEmisor: row.nombre_razon_emisor ?? "",
    TipoFactura: row.tipo_factura as RegistroAlta["TipoFactura"],
    DescripcionOperacion: row.descripcion_operacion ?? "",
    Desglose: (row.desglose ?? []) as RegistroAlta["Desglose"],
    CuotaTotal: row.cuota_total ?? "",
    ImporteTotal: row.importe_total ?? "",
  };
}
```

- [ ] **Step 5: Implement the verification**

`packages/fiscal-verifactu/src/verify.ts`:

```ts
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { IntegrityReport, IntegrityIssue } from "@waitron/fiscal";
import { computeHuella, verifyHuella } from "@waitron/verifactu";
import { lockChainHead } from "./chain.js";
import { fromRegistroRow, type RegistroRow } from "./registro-row.js";

/**
 * Orden HAC/1177/2024 art. 7.i: before generating record n, verify that
 * record n−1 is itself correctly chained.
 *
 * Two checks, deliberately more than the letter of the rule:
 *
 *   1. AEAT's own: n−1's stored predecessor huella equals n−2's own huella.
 *   2. Ours: n−1's huella recomputes from n−1's stored inputs. Free, since
 *      hashing is a pure function of values already read, and it catches
 *      tampering with n−1's content that check 1 is structurally blind to.
 *
 * NEVER throws on a verification failure. A throw propagates out of the sale
 * transaction and rolls back the sale — «la facturación por este motivo NUNCA
 * debe interrumpirse». Failures are RETURNED. Genuine database errors do
 * propagate, because a failed write is an ordinary operational failure and
 * should stop a sale like any other.
 */
export async function verifyChain(
  tx: Transaction,
  tenantId: string,
  tillId: string,
): Promise<IntegrityReport> {
  // Under the same lock, in the same transaction, as the append that follows.
  // Verifying a predecessor another writer is concurrently replacing verifies
  // nothing. Re-acquiring in appendToChain afterwards is free.
  await lockChainHead(tx, tenantId, tillId);

  const rows = await tx.execute<RegistroRow>(sql`
    select * from registros_facturacion
    where tenant_id = ${tenantId} and till_id = ${tillId}
    order by secuencia desc
    limit 2
  `);

  const previous = rows[0];
  // n is itself the first record of the chain: no predecessor, neither check
  // applies. Normal, not a failure.
  if (previous === undefined) return { ok: true, checked: 0, issues: [] };

  const issues: IntegrityIssue[] = [];

  const rebuilt = fromRegistroRow(previous);
  if (!verifyHuella(rebuilt)) {
    issues.push({
      code: "predecessor-hash-mismatch",
      recordId: previous.id,
      params: { expected: previous.huella, found: computeHuella(rebuilt) },
    });
  }

  // n−1 opened the chain: there is no n−2, so the link check is vacuously
  // true. Also normal — one record examined, not two.
  if (previous.primer_registro === "S") {
    return { ok: issues.length === 0, checked: 1, issues };
  }

  const beforePrevious = rows[1];
  if (beforePrevious === undefined) {
    // n−1 points at a predecessor that is not there. `params` is empty rather
    // than carrying undefined values — there is no pair to compare. Only n−1
    // could be examined, so `checked` is 1.
    issues.push({ code: "predecessor-missing", recordId: previous.id, params: {} });
    return { ok: false, checked: 1, issues };
  }

  if (previous.encadenamiento_huella !== beforePrevious.huella) {
    issues.push({
      code: "predecessor-link-mismatch",
      recordId: previous.id,
      params: {
        expected: previous.encadenamiento_huella ?? "",
        found: beforePrevious.huella,
      },
    });
  }

  return { ok: issues.length === 0, checked: 2, issues };
}
```

- [ ] **Step 6: Close the boundary in lint**

`eslint.config.js` — add a zone to the existing `import-x/no-restricted-paths` configuration. Do not modify the existing `packages/verifactu` zone; add alongside it:

```js
{
  target: `${import.meta.dirname}/packages/core/**`,
  from: [
    `${import.meta.dirname}/packages/fiscal-verifactu/**`,
    `${import.meta.dirname}/packages/verifactu/**`,
  ],
  message:
    "packages/core must reach the fiscal layer only through the FiscalBackend interface. " +
    "Art. 7.i verification and chain vocabulary stay inside the module (spec §2).",
}
```

Note the shape: `basePath: import.meta.dirname` with **absolute** globs, never a leading `**/`. Minimatch globstars refuse to cross a dot-prefixed path segment such as `.claude/worktrees/`, which silently disabled exactly this rule once before.

Verify it fires, rather than assuming it does:

```bash
printf 'import { verifyChain } from "@waitron/fiscal-verifactu";\nexport const probe = verifyChain;\n' > packages/core/src/probe.ts
pnpm lint
```

Expected: FAIL — `import-x/no-restricted-paths` on `packages/core/src/probe.ts`. Delete the probe.

```bash
rm packages/core/src/probe.ts
```

A boundary rule that does not fire is worse than none, because it produces false confidence — which is why the probe is run rather than reasoned about.

- [ ] **Step 7: Run the suite**

```bash
cd packages/fiscal-verifactu
pnpm vitest run src/verify.test.ts
```

Expected: PASS, 14 tests.

```bash
cd ../.. && pnpm typecheck && pnpm lint
```

Expected: typecheck passes with no output; lint passes with no output.

- [ ] **Step 8: Teeth check — break it and watch it scream**

Confirm these tests have teeth rather than merely executing the code.

Temporarily delete the `verifyHuella` block, keeping only AEAT's link check:

```bash
pnpm vitest run src/verify.test.ts
```

Expected: FAIL — `detects tampering with n−1's own hashed content`, `reports both failures when n−1's predecessor pointer is rewritten` and `returns rather than throws when verification fails`. Restore it. This mutation is the letter of the rule, exactly; that it breaks three tests is the argument for going beyond it.

Temporarily delete the link check, keeping only the recomputation.

Expected: FAIL — `detects a broken link from n−1 to n−2`, `reports both failures when n−1's predecessor pointer is rewritten` and `carries the expected and found values on a link failure`. Restore it.

Temporarily change `order by secuencia desc` to `order by num_serie_factura desc`.

Expected: FAIL — `locates the predecessor by chain position, never by invoice number`. Restore it.

Temporarily change the `primer_registro === "S"` early return to fall through to the link check.

Expected: FAIL — `reports first-record-predecessor when n−1 carries PrimerRegistro=S`, on both `scope` and `ok`. Restore it. This mutation is the one that would raise an incident on every till's first sale.

Temporarily change `issues.push(...)` to `throw new Error("chain verification failed")`:

Expected: FAIL — `returns rather than throws when verification fails` and `chains the next record anyway after a detected corruption`. Restore it. **This is the mutation that matters most**: it is the earlier draft's behaviour, and the two tests that break are the ones enforcing that a fiscal condition never blocks a sale.

Temporarily change `{ reason: "predecessor-missing", recordId: previous.id }` to include `expected: undefined, found: undefined`.

Expected: FAIL — `omits expected and found entirely when the predecessor row is gone`. Restore it. A `toBeUndefined` assertion would have stayed green through this mutation, which is why the test uses `Object.hasOwn`.

If any mutation leaves the suite green, a test is missing.

- [ ] **Step 9: Commit**

```bash
git add packages/fiscal-verifactu/src/verify.ts \
        packages/fiscal-verifactu/src/verify.test.ts \
        packages/fiscal-verifactu/src/registro-row.ts \
        packages/fiscal/src/backend.ts \
        eslint.config.js
git commit
```

```text
feat(fiscal-verifactu): art. 7.i pre-generation chain verification

Orden HAC/1177/2024 art. 7.i requires that, before generating record n, the
system verifies record n−1 is itself correctly chained. AEAT's FAQ defines that
narrowly: n−1's stored predecessor huella must equal n−2's own huella. We run
that check and one more — recomputing n−1's huella from its stored inputs. The
two are complementary rather than redundant: AEAT's check catches an edit to
n−2's huella but is structurally blind to an edit of n−1's own content, which
is the row we are about to chain onto. The recomputation costs one SHA-256 over
data already read, because hashing is a pure function, so going beyond the
letter is free. It does not extend to Desglose, which is not a huella input;
that is the immutability control's job, and the two defences do not substitute
for one another.

A verification failure records an incident and the sale completes. AEAT is
explicit — «será preciso generar el siguiente RF, ya que la facturación por
este motivo NUNCA debe interrumpirse» — and an earlier draft of this design had
it halt the till instead, on the reasoning that extending a known-corrupt chain
is worse than stopping. That was wrong in the way that reads as caution: AEAT
weighed the same trade-off and decided the other way. The code expresses this
as a rule with no exceptions: verifyChain never throws on a verification
failure, because a throw would propagate out of the sale transaction and roll
the sale back. It throws only on genuine database errors, which are ordinary
operational failures and should stop a sale like any other. The teeth check
that replaces the issue push with a throw breaks exactly the two tests that
encode this, which is the point of writing them that way.

No new result type was added for this. An earlier draft appended a second
ChainVerification/ChainVerificationFailure pair to packages/fiscal alongside
the IntegrityReport/IntegrityIssue that Task 11 already defines there — two
names for one concept in one file. The report reuses the existing shape, with
`checked` counting records examined (0 on a fresh till, 1 when n−1 opened the
chain, 2 when both checks ran) and the three reasons carried as issue `code`s.

Both start-of-chain cases are normal states, not failures: an n−1 carrying
PrimerRegistro="S" has no n−2 so the link check is vacuously true, and a first
record has no predecessor so neither check runs. The huella is computed and
stored in every case. A verifier that reported failure on a fresh till would
raise an incident on every till's first sale and teach staff to ignore the one
alert that matters. The whole check stays inside the module: packages/core sees
a regime-neutral IntegrityReport and nothing else, now enforced by an
import-x/no-restricted-paths zone verified against a probe rather than assumed.
```

---
## Task 16: `recordSale` — the write-path transaction

The task the whole plan exists for. Its deliverable is that completing a sale produces a chained, immutable fiscal record **atomically** — or produces nothing at all, with no third outcome available.

**Files:**

- Create: `packages/core/src/record-sale.ts`
- Create: `packages/core/src/record-sale.test.ts`
- Create: `packages/fiscal-verifactu/src/write-path.e2e.test.ts`
- Modify: `packages/core/src/index.ts` (re-export `recordSale`, `formatInvoiceNumber` and the input types)
- Modify: `packages/shared/src/errors.ts` (append five `ErrorCode` members)

**Interfaces:**

- Consumes:
  - `allocateInvoiceNumber(tx, seriesId)` from `./allocate-number.js` (Task 15).
  - `AppError`, `sumAmounts`, `compareAmounts`, and the branded ids `SaleId`, `SeriesId`, `TenantId`, `TillId`, `WorkingOrderId` from `@waitron/shared`.
  - `FiscalBackend`, `FiscalRecordRef`, `FiscalSale`, `TrustedClock` from `@waitron/fiscal`.
  - `invoiceSeries`, `saleLines`, `sales`, `tenders`, `createPgliteDb`, `runMigrations`, `withTenant`, `asAppUser`, and the `Transaction` type from `@waitron/db`.
- Produces:
  - `recordSale(tx: Transaction, backend: FiscalBackend, input: RecordSaleInput): Promise<{ saleId: SaleId; fiscal: FiscalRecordRef }>`
  - `formatInvoiceNumber(code: string, number: number): string`
  - Types: `RecordSaleInput`, `RecordSaleLine`, `RecordSaleTender`

> `FiscalSale` — the English, regime-neutral value `FiscalBackend.recordSale` receives — is produced by the `packages/fiscal` task. This task builds it with the fields `{ saleId, tenantId, tillId, invoiceNumber, issuedAt, offsetMinutes, clockConfident, total, lines }`. **Resolve this when implementing: read `packages/fiscal/src/backend.ts` first and confirm the field names match. If they differ, change the builder below, never the interface — a backend is the thing that must not be able to reinterpret what a sale is.**

> **The seven steps below are in spec §4's order, and the order is load-bearing rather than stylistic.** Two of the orderings have teeth: verification before allocation (steps 2 and 3), and the fiscal write inside the same transaction as the sale rows (steps 4 and 5). Both are asserted by tests in this task. Reordering either produces software that still passes a naïve suite.

- [ ] **Step 1: Add the error codes the write path can raise**

Every error crossing a package boundary is a structured code plus typed params, never prose (Global Constraint, spec §9). `throw new Error("not enough money")` reaches a screen untranslatable, and the till UI is bilingual by requirement.

In `packages/shared/src/errors.ts`, append to the `ErrorCode` union:

```ts
  | "sale.tender_unsettled"
  | "sale.tender_shortfall"
  | "sale.series_not_found"
  | "sale.series_wrong_till"
  | "sale.number_reused"
```

`sale.number_reused` exists for the constraint-violation translation in Task 17; it is added here so the union is written once.

- [ ] **Step 2: Write the failing tests**

`packages/core/src/record-sale.test.ts`. These run against `FakeFiscalBackend`, and it is worth being precise about what that proves and what it cannot. **The fake proves core's orchestration**: the order of operations, that nothing is written when a guard fires, that a partial write cannot survive, and that no fiscal condition blocks a sale. **It proves nothing about chaining, huellas or the submission sidecar**, because the fake writes to no table — those are the real backend's job and are covered by the end-to-end test in Step 6.

```ts
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { SeriesId, TenantId, TillId, WorkingOrderId } from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/testing";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  asAppUser,
  createPgliteDb,
  invoiceSeries,
  runMigrations,
  saleLines,
  sales,
  tenders,
  withTenant,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { recordSale } from "./record-sale.js";
import type { RecordSaleInput } from "./record-sale.js";
import { seedTenant } from "../test/fixtures.js";

let db: Database;
let tenantId: TenantId;
let tillId: TillId;
let seriesId: SeriesId;
let workingOrderId: WorkingOrderId;

// PGlite boots a WASM PostgreSQL and then runs both packages' migrations, which
// is comfortably past Vitest's 5s default. The explicit hook timeout is not
// padding — without it this suite fails intermittently on a cold machine and
// passes on a warm one, which is the worst possible failure signature.
beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, {
    migrationsFolder: "../db/drizzle",
    migrationsTable: "__drizzle_migrations_core",
  });
  await runMigrations(db, {
    migrationsFolder: "../fiscal-verifactu/drizzle",
    migrationsTable: "__drizzle_migrations_fiscal",
  });
}, 60_000);

afterAll(async () => {
  await db.$client.close();
});

beforeEach(async () => {
  ({ tenantId, tillId, seriesId, workingOrderId } = await seedTenant(db));
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

/** Confident, fixed, +01:00 — the ordinary case. */
const steadyClock: TrustedClock = {
  now: () => ({ instant: BASE, offsetMinutes: 60, confident: true }),
};

function input(overrides: Partial<RecordSaleInput> = {}): RecordSaleInput {
  return {
    tenantId,
    tillId,
    seriesId,
    workingOrderId,
    locale: "es-ES",
    invoiceLocales: ["es-ES", "ca-ES"],
    total: "12.10",
    tipAmount: "1.90",
    lines: [
      {
        lineNo: 1,
        descriptions: { "es-ES": "Café solo", "ca-ES": "Cafè sol" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        descriptions: { "es-ES": "Agua", "ca-ES": "Aigua" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    tenders: [{ method: "card", amount: "14.00", settledAt: BASE }],
    clock: steadyClock,
    ...overrides,
  };
}

/** Runs the write path exactly as the application will: as `app_user`, in one transaction. */
async function run(backend: FiscalBackend, overrides: Partial<RecordSaleInput> = {}) {
  return withTenant(db, tenantId, async (tx) => {
    // Never as the owner. An owner bypasses RLS and can disable any trigger, so
    // an owner-run write-path test would prove the code runs, not that the
    // application role is permitted to run it.
    await asAppUser(tx);
    return recordSale(tx, backend, input(overrides));
  });
}

async function countRows(table: string): Promise<number> {
  const result = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  return (result.rows[0] as { n: number }).n;
}

describe("recordSale — the happy path", () => {
  it("allocates the next number from the series and stamps it on the sale", async () => {
    const { saleId } = await run(new FakeFiscalBackend());
    const [row] = await db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.invoiceNumber).toBe(1);
  });

  it("advances the series counter so the second sale gets the next number", async () => {
    await run(new FakeFiscalBackend());
    const second = await run(new FakeFiscalBackend());
    const [row] = await db.select().from(sales).where(eq(sales.id, second.saleId));
    expect(row?.invoiceNumber).toBe(2);
  });

  it("inserts exactly one sale, its two lines and its one tender", async () => {
    const { saleId } = await run(new FakeFiscalBackend());
    expect(await db.select().from(saleLines).where(eq(saleLines.saleId, saleId))).toHaveLength(2);
    expect(await db.select().from(tenders).where(eq(tenders.saleId, saleId))).toHaveLength(1);
    expect(await countRows("sales")).toBe(1);
  });

  it("keeps the tip out of total and puts it into amount_charged", async () => {
    // total is the taxable amount and feeds ImporteTotal; the tip is non-taxable
    // and must never reach the registro. Fixture values are deliberately
    // different from each other and from their sum, so an implementation that
    // copied the wrong field cannot produce the expected row by coincidence.
    const { saleId } = await run(new FakeFiscalBackend());
    const [row] = await db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.total).toBe("12.10");
    expect(row?.tipAmount).toBe("1.90");
    expect(row?.amountCharged).toBe("14.00");
  });

  it("snapshots the locale list as at issuance", async () => {
    // A receipt reprinted a year later must read identically to the one the
    // customer took, so the list is copied onto the sale rather than read back
    // from locations at print time.
    const { saleId } = await run(new FakeFiscalBackend());
    const [row] = await db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.invoiceLocales).toEqual(["es-ES", "ca-ES"]);
  });

  it("returns the fiscal record reference the backend produced", async () => {
    const backend = new FakeFiscalBackend();
    const { fiscal } = await run(backend);
    // The receipt renders from the sale plus a huella-derived QR. Rendering is
    // out of scope here; the data being reachable from the return value is not.
    expect(fiscal.hash).toMatch(/^[0-9A-F]{64}$/);
    expect(fiscal.sequence).toBe(1);
    expect(fiscal.qrPayload).toContain("ValidarQR");
  });

  it("passes the formatted NumSerieFactura to the backend, not the bare counter", async () => {
    const backend = new FakeFiscalBackend();
    await run(backend);
    // AEAT identifies a record by IDEmisorFactura + NumSerieFactura +
    // FechaExpedicionFactura. Handing the module the integer would make two
    // series on one till collide on identity while looking fine locally.
    expect(backend.calls.recordSale[0]?.invoiceNumber).toBe("A/1");
  });
});

describe("recordSale — the order of operations", () => {
  it("verifies the chain before allocating a number", async () => {
    const observed: number[] = [];
    const fake = new FakeFiscalBackend();
    const backend: FiscalBackend = {
      ...fake,
      async checkIntegrity(tx, till) {
        // Read the counter from inside the verification call. If allocation had
        // already run, next_number would read 2 here. A call log would only
        // record that both happened, not which came first — this is the one
        // observation that discriminates.
        const [row] = await tx
          .select({ n: invoiceSeries.nextNumber })
          .from(invoiceSeries)
          .where(eq(invoiceSeries.id, seriesId));
        observed.push(row?.n ?? -1);
        return fake.checkIntegrity(tx, till);
      },
    };
    await run(backend);
    expect(observed).toEqual([1]);
  });

  it("reads the clock exactly once for the whole transaction", async () => {
    // Reading it twice — once for issued_at, once inside the module for
    // FechaHoraHusoGenRegistro — lets a second boundary fall between them, and
    // the sale and its registro then carry different timestamps for one event.
    // The drifting clock makes that divergence observable instead of theoretical.
    let ticks = 0;
    const drifting: TrustedClock = {
      now: () => {
        ticks += 1;
        return {
          instant: new Date(BASE.getTime() + ticks * 1000),
          offsetMinutes: 60,
          confident: true,
        };
      },
    };
    const backend = new FakeFiscalBackend();
    const { saleId } = await run(backend, { clock: drifting });
    const [row] = await db.select().from(sales).where(eq(sales.id, saleId));
    expect(ticks).toBe(1);
    expect(row?.issuedAt?.toISOString()).toBe(backend.calls.recordSale[0]?.issuedAt.toISOString());
  });
});

describe("recordSale — no fiscal condition blocks a sale", () => {
  it("completes the sale when chain verification fails", async () => {
    // AEAT: «la facturación por este motivo NUNCA debe interrumpirse». A test
    // asserting the sale is BLOCKED here would enforce the exact opposite of the
    // requirement, so this assertion is the one that must not be inverted.
    const backend = new FakeFiscalBackend();
    backend.chainVerification = {
      ok: false,
      error: new AppError("chain.verification_failed", { tillId, sequence: 4 }),
    };
    const { saleId } = await run(backend);
    expect(await countRows("sales")).toBe(1);
    expect(backend.calls.recordSale).toHaveLength(1);
    expect(saleId).toBeTruthy();
  });

  it("completes the sale when the clock reports degraded confidence", async () => {
    const degraded: TrustedClock = {
      now: () => ({ instant: BASE, offsetMinutes: 60, confident: false }),
    };
    await run(new FakeFiscalBackend(), { clock: degraded });
    expect(await countRows("sales")).toBe(1);
  });

  it("tells the module the clock was not confident", async () => {
    // The module needs it: FechaHoraHusoGenRegistro is validated as an upper
    // bound only, so a degraded clock should bias slow, and it cannot bias
    // anything it was not told about.
    const degraded: TrustedClock = {
      now: () => ({ instant: BASE, offsetMinutes: 60, confident: false }),
    };
    const backend = new FakeFiscalBackend();
    await run(backend, { clock: degraded });
    expect(backend.calls.recordSale[0]?.clockConfident).toBe(false);
  });
});

describe("recordSale — the fiscal record is created when ALL tenders settle", () => {
  it("writes nothing when a tender has not settled", async () => {
    // A card declined mid-tender must leave the order open and retryable with
    // NOTHING chained. The alternative chains records for sales that never
    // happened, correctable only by rectificativas.
    await expect(
      run(new FakeFiscalBackend(), {
        tenders: [
          { method: "cash", amount: "5.00", settledAt: BASE },
          { method: "card", amount: "9.00", settledAt: null },
        ],
      }),
    ).rejects.toMatchObject({ code: "sale.tender_unsettled" });

    expect(await countRows("sales")).toBe(0);
    expect(await countRows("sale_lines")).toBe(0);
    expect(await countRows("tenders")).toBe(0);
  });

  it("writes nothing when the settled tenders do not cover the amount due", async () => {
    await expect(
      run(new FakeFiscalBackend(), {
        tenders: [{ method: "cash", amount: "5.00", settledAt: BASE }],
      }),
    ).rejects.toMatchObject({ code: "sale.tender_shortfall" });
    expect(await countRows("sales")).toBe(0);
  });

  it("chains nothing when a tender has not settled", async () => {
    const backend = new FakeFiscalBackend();
    await expect(
      run(backend, { tenders: [{ method: "card", amount: "14.00", settledAt: null }] }),
    ).rejects.toBeInstanceOf(AppError);
    expect(backend.calls.recordSale).toHaveLength(0);
    expect(backend.calls.checkIntegrity).toHaveLength(0);
  });

  it("records exactly one chained sale when the declined tender is retried", async () => {
    // The retry path end to end: decline, then settle. Two calls, one sale.
    const backend = new FakeFiscalBackend();
    await expect(
      run(backend, { tenders: [{ method: "card", amount: "14.00", settledAt: null }] }),
    ).rejects.toBeInstanceOf(AppError);
    await run(backend);
    expect(await countRows("sales")).toBe(1);
    expect(backend.calls.recordSale).toHaveLength(1);
  });

  it("accepts a split tender that settles across several payments", async () => {
    await run(new FakeFiscalBackend(), {
      tenders: [
        { method: "cash", amount: "4.00", settledAt: BASE },
        { method: "card", amount: "10.00", settledAt: BASE },
      ],
    });
    expect(await countRows("tenders")).toBe(2);
    expect(await countRows("sales")).toBe(1);
  });
});

describe("recordSale — atomicity", () => {
  it("leaves no sale, no line and no tender when the fiscal step fails", async () => {
    // The worst outcome this design has is a partial write here: an invoice that
    // exists commercially and not fiscally, with a customer holding a receipt
    // for a record AEAT will never see. Nothing may survive.
    const fake = new FakeFiscalBackend();
    const exploding: FiscalBackend = {
      ...fake,
      recordSale: () => {
        throw new AppError("fiscal.backend_unavailable", { tillId });
      },
    };
    await expect(run(exploding)).rejects.toMatchObject({ code: "fiscal.backend_unavailable" });

    expect(await countRows("sales")).toBe(0);
    expect(await countRows("sale_lines")).toBe(0);
    expect(await countRows("tenders")).toBe(0);
  });
});

describe("recordSale — numbering", () => {
  it("never reissues a number that reached a committed sale", async () => {
    // The property that actually matters. Gaps are permitted; reuse is not.
    await run(new FakeFiscalBackend());
    await expect(
      withTenant(db, tenantId, async (tx) => {
        await asAppUser(tx);
        await tx.insert(sales).values({
          tenantId,
          tillId,
          seriesId,
          invoiceNumber: 1,
          issuedAt: BASE,
          total: "1.00",
          tipAmount: "0.00",
          amountCharged: "1.00",
          locale: "es-ES",
          invoiceLocales: ["es-ES"],
          fiscalBackend: "fake",
          fiscalState: "recorded",
        });
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("returns the number to the pool when the transaction rolls back", async () => {
    // Documented so the behaviour is deliberate rather than discovered. See the
    // callout below Step 5: under a next_number COLUMN the allocating UPDATE is
    // transactional, so a rollback un-allocates. That is safe — the number never
    // reached a sale, so reissuing it is not reuse.
    const fake = new FakeFiscalBackend();
    const exploding: FiscalBackend = {
      ...fake,
      recordSale: () => {
        throw new AppError("fiscal.backend_unavailable", { tillId });
      },
    };
    await expect(run(exploding)).rejects.toBeInstanceOf(AppError);
    const { saleId } = await run(new FakeFiscalBackend());
    const [row] = await db.select().from(sales).where(eq(sales.id, saleId));
    expect(row?.invoiceNumber).toBe(1);
  });
});

describe("recordSale — series validation", () => {
  it("rejects a series that does not exist", async () => {
    await expect(
      run(new FakeFiscalBackend(), {
        seriesId: "00000000-0000-0000-0000-000000000000" as SeriesId,
      }),
    ).rejects.toMatchObject({ code: "sale.series_not_found" });
  });

  it("rejects a series belonging to another till", async () => {
    // A till may own N series, but a series belongs to exactly one till.
    // Allocating from another till's series would have two chains issuing from
    // one counter, which no constraint downstream can detect.
    const other = await seedTenant(db, { tenantId });
    await expect(
      run(new FakeFiscalBackend(), { seriesId: other.seriesId }),
    ).rejects.toMatchObject({ code: "sale.series_wrong_till" });
  });
});
```

- [ ] **Step 3: Run each test individually and watch it fail**

Per the Global Constraint, red is observed per test, not per file — "2 of 3 failed" is exactly how the passing one hides.

```bash
cd packages/core
pnpm vitest run -t "allocates the next number from the series and stamps it on the sale"
```

Expected: FAIL — `Failed to resolve import "./record-sale.js"`.

Repeat for every test name above. Pay particular attention to `completes the sale when chain verification fails` and `leaves no sale, no line and no tender when the fiscal step fails`: both assert on row counts that are zero or one in an empty database, so both are capable of passing vacuously if the call they wrap never runs. Confirm each fails on the unresolved import, not on an assertion.

- [ ] **Step 4: Implement**

`packages/core/src/record-sale.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { invoiceSeries, saleLines, sales, tenders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, compareAmounts, sumAmounts } from "@waitron/shared";
import type { SaleId, SeriesId, TenantId, TillId, WorkingOrderId } from "@waitron/shared";
import type { FiscalBackend, FiscalRecordRef, TrustedClock } from "@waitron/fiscal";
import { allocateInvoiceNumber } from "./allocate-number.js";

export interface RecordSaleLine {
  lineNo: number;
  /** locale → text, snapshotted at line-add time. Never a catalogue reference. */
  descriptions: Record<string, string>;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  lineTotal: string;
}

export interface RecordSaleTender {
  method: string;
  amount: string;
  /** `null` means the payment has not completed. Nothing is chained until every one is set. */
  settledAt: Date | null;
}

export interface RecordSaleInput {
  tenantId: TenantId;
  tillId: TillId;
  seriesId: SeriesId;
  workingOrderId: WorkingOrderId;
  locale: string;
  invoiceLocales: string[];
  /** The taxable total. Excludes the tip, which is non-taxable and never reaches AEAT. */
  total: string;
  tipAmount: string;
  lines: RecordSaleLine[];
  tenders: RecordSaleTender[];
  clock: TrustedClock;
}

/**
 * `NumSerieFactura` — series code and counter joined by `/`.
 *
 * The series code's charset is restricted where series are created, so that
 * form-urlencoding (AEAT's reference QR encoding, space → `+`) and
 * `encodeURIComponent` (`%20`) produce the same payload. Nothing here may widen
 * it: a divergence would make our QR and AEAT's cotejo URL disagree for exactly
 * the invoices a customer is most likely to check.
 */
export function formatInvoiceNumber(code: string, number: number): string {
  return `${code}/${number}`;
}

/**
 * The fiscal record is created when ALL tenders settle, never per payment.
 *
 * Checked before anything at all is written, so a declined card leaves the
 * working order open and retryable with nothing chained. The alternative chains
 * records for sales that never happened, and those are correctable only by
 * issuing rectificativas.
 */
function assertAllTendersSettled(input: RecordSaleInput): void {
  const unsettled = input.tenders.filter((tender) => tender.settledAt === null);
  if (unsettled.length > 0) {
    throw new AppError("sale.tender_unsettled", {
      tillId: input.tillId,
      workingOrderId: input.workingOrderId,
      unsettledCount: unsettled.length,
    });
  }
  const due = sumAmounts([input.total, input.tipAmount]);
  const charged = sumAmounts(input.tenders.map((tender) => tender.amount));
  if (compareAmounts(charged, due) !== 0) {
    throw new AppError("sale.tender_shortfall", {
      tillId: input.tillId,
      workingOrderId: input.workingOrderId,
      due,
      charged,
    });
  }
}

/**
 * Spec §4, steps 1–7. Takes a transaction handle rather than a database: the
 * atomicity between the sale rows and the chain append is the entire point, and
 * an interface hiding the transaction would let a backend break it silently.
 */
export async function recordSale(
  tx: Transaction,
  backend: FiscalBackend,
  input: RecordSaleInput,
): Promise<{ saleId: SaleId; fiscal: FiscalRecordRef }> {
  assertAllTendersSettled(input);

  // Steps 1 and 2, one call and deliberately so. checkIntegrity takes
  // SELECT … FOR UPDATE on the (tenant, till) chain head as its first statement
  // and holds it until commit, so the art. 7.i check runs against exactly the
  // chain state this transaction is about to extend rather than a snapshot that
  // another writer may already have moved past.
  const verification = await backend.checkIntegrity(tx, input.tillId);
  // Nothing branches on the result. A failed verification records an incident
  // (Task 18) and the record is chained anyway — «NUNCA debe interrumpirse».
  // If a later change adds an `if (!verification.ok) throw` here, it has
  // implemented the opposite of the requirement.
  void verification;

  const [series] = await tx
    .select({ code: invoiceSeries.code, tillId: invoiceSeries.tillId })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.id, input.seriesId), eq(invoiceSeries.tenantId, input.tenantId)));

  if (series === undefined) {
    throw new AppError("sale.series_not_found", {
      seriesId: input.seriesId,
      tenantId: input.tenantId,
    });
  }
  if (series.tillId !== input.tillId) {
    throw new AppError("sale.series_wrong_till", {
      seriesId: input.seriesId,
      expected: series.tillId,
      actual: input.tillId,
    });
  }

  // Step 3. Allocation comes AFTER the chain lock, never before, and the reason
  // is lock ordering rather than regulation: both the chain head row and the
  // series row stay locked until commit, so every path must take them in the
  // same order. Chain-then-series here and series-then-chain anywhere else is
  // the textbook inversion that deadlocks two concurrent sales on one till.
  const invoiceNumber = await allocateInvoiceNumber(tx, input.seriesId);

  // One clock reading for the whole transaction. Reading it again inside the
  // module would let a second boundary fall between the two, and the sale and
  // its registro would then carry different timestamps for a single event.
  const now = input.clock.now();

  // Step 4.
  const [inserted] = await tx
    .insert(sales)
    .values({
      tenantId: input.tenantId,
      tillId: input.tillId,
      seriesId: input.seriesId,
      invoiceNumber,
      issuedAt: now.instant,
      total: input.total,
      tipAmount: input.tipAmount,
      amountCharged: sumAmounts([input.total, input.tipAmount]),
      locale: input.locale,
      invoiceLocales: input.invoiceLocales,
      fiscalBackend: backend.id,
      fiscalState: "recorded",
    })
    .returning({ id: sales.id });

  const saleId = inserted!.id as SaleId;

  await tx.insert(saleLines).values(
    input.lines.map((line) => ({
      tenantId: input.tenantId,
      saleId,
      lineNo: line.lineNo,
      descriptions: line.descriptions,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
      lineTotal: line.lineTotal,
    })),
  );

  await tx.insert(tenders).values(
    input.tenders.map((tender) => ({
      tenantId: input.tenantId,
      saleId,
      method: tender.method,
      amount: tender.amount,
      settledAt: tender.settledAt!,
    })),
  );

  // Steps 5 and 6, both inside the module. packages/core may not touch
  // registros_facturacion, cadenas or envios — they are module-owned, and the
  // chain concept does not exist in the generic layer at all. Building the
  // registro, computing the huella, advancing the chain head and inserting the
  // `pending` sidecar row all happen behind this one call, on this transaction.
  const fiscal = await backend.recordSale(tx, {
    saleId,
    tenantId: input.tenantId,
    tillId: input.tillId,
    invoiceNumber: formatInvoiceNumber(series.code, invoiceNumber),
    issuedAt: now.instant,
    offsetMinutes: now.offsetMinutes,
    clockConfident: now.confident,
    total: input.total,
    lines: input.lines,
  });

  // Step 7 is the caller's. Returning inside the transaction rather than
  // committing here is what lets the till write the working-order settlement,
  // the sale and the registro as one unit of work.
  return { saleId, fiscal };
}
```

**The spec's numbering sentence is wrong as written, and this task encodes the correct behaviour rather than the sentence.** Spec §3 and §4 both say "a crash anywhere before commit burns an invoice number — a permitted gap". Under the naming contract's `invoice_series.next_number` **column** that is not what happens: the allocating `UPDATE` is transactional, so a rollback returns the number to the pool and no gap appears. That is settled — Task 6 rejected the per-series `SEQUENCE` that would have made the sentence literally true, because it needs dynamic DDL on every series insert to buy a gap the regulation does not require. The property that matters is **never reused after being used**, and it is backed by `UNIQUE (tenant_id, series_id, invoice_number)`, which this task's rollback test exercises against the live write path. Task 18 Step 8 carries the corresponding correction to spec §3 and §4.

- [ ] **Step 5: Run the tests and verify they pass**

```bash
cd packages/core
pnpm vitest run src/record-sale.test.ts
```

Expected: PASS, 21 tests.

- [ ] **Step 6: Write the end-to-end test against the real Veri\*Factu backend**

`packages/fiscal-verifactu/src/write-path.e2e.test.ts`. It lives here rather than in `packages/core` because it is the only place both sides may be imported: `packages/core` is English and must never see `RegistroAlta` or `computeHuella`, while this module may depend on `@waitron/core`, `@waitron/verifactu` and `@waitron/db` alike. It follows the `packages/verifactu/src/conformance.test.ts` precedent — a test file with no sibling source, the established slot for a cross-cutting policy test.

**What this proves that the fake cannot.** The fake returns a plausible `FiscalRecordRef` and writes nothing, so every core test above would pass unchanged against a module that silently no-ops. These assertions fail against that module: a registro exists, its stored huella recomputes from its own stored columns, the chain head advanced to it, the second sale's predecessor pointer carries the first sale's actual hash, and a `pending` sidecar row exists. Nothing short of the real backend can establish any of them.

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { buildQrPayload, computeHuella } from "@waitron/verifactu";
import {
  asAppUser,
  createPgliteDb,
  runMigrations,
  sales,
  withTenant,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import type { TenantId, TillId, SeriesId, WorkingOrderId } from "@waitron/shared";
import { VerifactuBackend } from "./backend.js";
import { cadenas } from "./schema/cadenas.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { saleInput, steadyClock } from "../test/write-path-fixtures.js";

let db: Database;
let backend: VerifactuBackend;
let tenantId: TenantId;
let tillId: TillId;
let seriesId: SeriesId;
let workingOrderId: WorkingOrderId;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, {
    migrationsFolder: "../db/drizzle",
    migrationsTable: "__drizzle_migrations_core",
  });
  await runMigrations(db, {
    migrationsFolder: "./drizzle",
    migrationsTable: "__drizzle_migrations_fiscal",
  });
}, 60_000);

afterAll(async () => {
  await db.$client.close();
});

beforeEach(async () => {
  ({ tenantId, tillId, seriesId, workingOrderId } = await seedTenantWithSif(db));
  backend = new VerifactuBackend({ clock: steadyClock });
});

async function sell(overrides = {}) {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordSale(
      tx,
      backend,
      saleInput({ tenantId, tillId, seriesId, workingOrderId, ...overrides }),
    );
  });
}

describe("the write path against the real Veri*Factu backend", () => {
  it("inserts one registro de alta carrying the sale's identity", async () => {
    const { saleId } = await sell();
    const rows = await db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, saleId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tipoRegistro).toBe("alta");
    expect(rows[0]?.numSerieFactura).toBe("A/1");
    expect(rows[0]?.secuencia).toBe(1);
  });

  it("marks the first record of a chain as PrimerRegistro", async () => {
    await sell();
    const [row] = await db.select().from(registrosFacturacion);
    expect(row?.primerRegistro).toBe("S");
  });

  it("stores a huella that recomputes from its own stored columns", async () => {
    // The single strongest assertion available. A module that stored a plausible
    // 64-hex string, or that hashed a record different from the one it persisted,
    // passes every core-level test and fails only here.
    await sell();
    const [row] = await db.select().from(registrosFacturacion);
    expect(computeHuella(toRegistro(row!))).toBe(row?.huella);
  });

  it("advances the chain head to the record it just wrote", async () => {
    const { saleId } = await sell();
    const [registro] = await db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, saleId));
    const [head] = await db.select().from(cadenas).where(eq(cadenas.tillId, tillId));
    expect(head?.secuencia).toBe(1);
    expect(head?.ultimaHuella).toBe(registro?.huella);
    expect(head?.ultimoRegistroId).toBe(registro?.id);
  });

  it("chains the second sale onto the first sale's actual huella", async () => {
    const first = await sell();
    const second = await sell();
    const [a] = await db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, first.saleId));
    const [b] = await db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, second.saleId));
    expect(b?.primerRegistro).toBe("N");
    expect(b?.encadenamientoHuella).toBe(a?.huella);
    expect(b?.encadenamientoNumSerieFactura).toBe("A/1");
    expect(b?.secuencia).toBe(2);
  });

  it("inserts the submission sidecar row as pending, with nothing sent", async () => {
    const { saleId } = await sell();
    const [registro] = await db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, saleId));
    const [sidecar] = await db
      .select()
      .from(envios)
      .where(eq(envios.registroId, registro!.id));
    expect(sidecar?.estado).toBe("pendiente");
    expect(sidecar?.intentos).toBe(0);
    // The CSV is unrecoverable once lost and arrives only with a submission
    // response, so it must be null at this point. A non-null value here would
    // mean the write path had contacted AEAT, which it must never do.
    expect(sidecar?.csv).toBeNull();
    expect(sidecar?.enviadoEn).toBeNull();
  });

  it("makes the QR payload derivable from the stored record", async () => {
    // Rendering the receipt is out of scope. The DATA being available is not:
    // if the QR could not be built from what was persisted, the receipt would
    // depend on in-memory state that does not survive a reprint.
    const { saleId } = await sell();
    const [row] = await db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, saleId));
    const payload = buildQrPayload(toRegistro(row!));
    expect(payload).toContain("nif=");
    expect(payload).toContain("numserie=A%2F1");
  });

  it("leaves no registro, no chain movement and no sidecar when the sale rows fail", async () => {
    // Atomicity from the other direction: force the failure AFTER the module has
    // done its work and confirm the module's own tables roll back too. A module
    // holding its own connection would leave all three behind.
    await expect(
      withTenant(db, tenantId, async (tx) => {
        await asAppUser(tx);
        await recordSale(tx, backend, saleInput({ tenantId, tillId, seriesId, workingOrderId }));
        throw new Error("simulated crash after the fiscal write");
      }),
    ).rejects.toThrow("simulated crash");

    expect(await db.select().from(sales)).toHaveLength(0);
    expect(await db.select().from(registrosFacturacion)).toHaveLength(0);
    expect(await db.select().from(envios)).toHaveLength(0);
    const [head] = await db.select().from(cadenas).where(eq(cadenas.tillId, tillId));
    expect(head?.secuencia).toBe(0);
  });
});
```

> `toRegistro(row)` maps a `registros_facturacion` row back to the library's `RegistroAlta` shape. **Resolve this when implementing: it belongs in `packages/fiscal-verifactu/src/backend.ts` as an exported helper, not duplicated in the test — the mapping is the module's own contract with the library, and a second copy in a test file can drift from the one that writes the rows, at which point the recompute test certifies the test's mapping rather than the module's.**

- [ ] **Step 7: Run each end-to-end test individually and watch it fail, then implement to green**

Expected: FAIL — unresolved import `./backend.js`, or an empty `registros_facturacion` if the backend already exists as a stub.

Then:

```bash
cd packages/fiscal-verifactu
pnpm vitest run src/write-path.e2e.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 8: Teeth check — break it and watch it scream**

Six named mutations. Confirm each breaks the test it should, and only then restore.

Move the `allocateInvoiceNumber` call above `backend.checkIntegrity`:

```bash
cd packages/core && pnpm vitest run src/record-sale.test.ts
```

Expected: FAIL — `verifies the chain before allocating a number`. Restore it.

Delete the `assertAllTendersSettled(input)` call:

Expected: FAIL — `writes nothing when a tender has not settled`, `writes nothing when the settled tenders do not cover the amount due`, `chains nothing when a tender has not settled`, and `records exactly one chained sale when the declined tender is retried`. Restore it.

Change `amountCharged: sumAmounts([input.total, input.tipAmount])` to `amountCharged: input.total`:

Expected: FAIL — `keeps the tip out of total and puts it into amount_charged`. Restore it.

Replace the single `const now = input.clock.now()` with a fresh `input.clock.now()` at each of its two use sites:

Expected: FAIL — `reads the clock exactly once for the whole transaction`. Restore it.

Wrap the `backend.recordSale` call in `try { … } catch { }`:

Expected: FAIL — `leaves no sale, no line and no tender when the fiscal step fails`. Restore it.

Now in `packages/fiscal-verifactu`, hardcode the registro's `secuencia` to `1`:

```bash
cd packages/fiscal-verifactu && pnpm vitest run src/write-path.e2e.test.ts
```

Expected: FAIL — `chains the second sale onto the first sale's actual huella`. Restore it.

Finally, add `if (!verification.ok) throw verification.error;` to `recordSale`:

Expected: FAIL — `completes the sale when chain verification fails`. Restore it. **A green run on this last mutation would mean the plan has implemented the exact behaviour AEAT's FAQ forbids**, and it is the one mutation whose absence from the suite would be invisible in review, because the code reads as ordinary defensive programming.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/record-sale.ts packages/core/src/record-sale.test.ts \
        packages/core/src/index.ts packages/shared/src/errors.ts \
        packages/fiscal-verifactu/src/write-path.e2e.test.ts \
        packages/fiscal-verifactu/test/write-path-fixtures.ts
git commit -m "feat(core): the sale write path, spec §4 steps 1-7

Completing a sale now produces a chained, immutable fiscal record inside
one transaction, or produces nothing at all. Two orderings are load-bearing
and both are asserted rather than commented: chain verification runs before
number allocation, so every path takes the chain-head lock before the series
lock and two concurrent sales on one till cannot invert them into a
deadlock; and the module's registro, chain-head advance and sidecar row all
run on the caller's transaction handle, so a failure anywhere rolls back
the sale rows with them.

The fiscal record is created when ALL tenders settle, never per payment. A
declined card leaves the working order open and retryable with nothing
chained — the alternative chains records for sales that never happened, and
those are correctable only by issuing rectificativas. The guard runs before
any write, so the retry path is a second call rather than a repair.

No fiscal condition blocks a sale. A failed chain verification is carried
and not branched on, because AEAT is explicit that «la facturación NUNCA
debe interrumpirse»; the incident it raises lands in the next commit. The
teeth check includes adding the throw and confirming a test screams, since
that mutation reads as ordinary defensive code and would otherwise pass
review."
```

---

## Task 17: `recordVoid` — anulación

Voiding a sale creates a **new** record referencing the old one. Nothing is ever edited, and the anulación is chained exactly like an alta — its own sequence, its own huella, its own predecessor pointer and its own sidecar row.

**Files:**

- Create: `packages/core/src/record-void.ts`
- Create: `packages/core/src/record-void.test.ts`
- Create: `packages/db/src/schema/sale-voids.ts`
- Create: `packages/fiscal-verifactu/src/void-path.e2e.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/db/src/schema/sales.ts` (re-export `saleVoids` from the aggregate barrel)
- Modify: `packages/shared/src/errors.ts` (append two `ErrorCode` members)

**Interfaces:**

- Consumes: `AppError` and `SaleId` from `@waitron/shared`; `FiscalBackend`, `FiscalRecordRef` from `@waitron/fiscal`; `sales`, `saleVoids`, `isUniqueViolation`, `Transaction` from `@waitron/db`.
- Produces:
  - `recordVoid(tx: Transaction, backend: FiscalBackend, saleId: SaleId, reason: string): Promise<{ fiscal: FiscalRecordRef }>`
  - Table `sale_voids` — `id`, `tenant_id`, `sale_id` (UNIQUE), `reason`, `voided_at`, `voided_by`

> **Voiding is gated by roles, and roles are sub-project 5.** `recordVoid` deliberately takes no actor argument and performs no authorisation check. A half-built check now would be worse than none — it would look like security while enforcing nothing, and every reviewer after today would assume the question was settled. The seam is left in two places and no further: the call site (the till calls `recordVoid` only from a screen the role system will guard) and the nullable `sale_voids.voided_by` column, which is the field sub-project 5 will fill. **Do not add an authorisation branch inside `recordVoid` in this plan.**

- [ ] **Step 1: Add the two error codes**

In `packages/shared/src/errors.ts`, append to `ErrorCode`:

```ts
  | "sale.not_found"
  | "sale.already_voided"
```

- [ ] **Step 2: Create the `sale_voids` table**

`packages/db/src/schema/sale-voids.ts`:

```ts
import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sales } from "./sales.js";
import { tenants } from "./tenants.js";

/**
 * A sale is voided by APPENDING a row here, never by editing the sale.
 *
 * `sales` has UPDATE and DELETE revoked from the application role, so
 * void-ness cannot live on it as a mutable column even though spec §6 puts
 * `fiscal_state` there — that column is written once at insert and never moves.
 * This is the same split the design already makes twice: immutable fact, and a
 * separate row recording what later happened to it. Keeping the projection in
 * packages/db rather than deriving it from the module's anulación registro is
 * what lets a Z-report answer "which sales were voided" without a
 * cross-boundary join per row.
 */
export const saleVoids = pgTable(
  "sale_voids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id),
    reason: text("reason").notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }).notNull(),
    /** The seam for sub-project 5. Nullable until roles exist; never read here. */
    voidedBy: uuid("voided_by"),
  },
  (table) => ({
    // The database is what makes double-voiding impossible. A SELECT-then-INSERT
    // check in application code is passed by both of two concurrent
    // transactions, and the second one would chain a duplicate anulación.
    oneVoidPerSale: unique("sale_voids_sale_id_key").on(table.saleId),
  }),
).enableRLS();
```

- [ ] **Step 3: Write the failing tests**

`packages/core/src/record-void.test.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { SaleId, SeriesId, TenantId, TillId, WorkingOrderId } from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/testing";
import type { FiscalBackend } from "@waitron/fiscal";
import {
  asAppUser,
  createPgliteDb,
  invoiceSeries,
  runMigrations,
  saleVoids,
  sales,
  withTenant,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { recordSale } from "./record-sale.js";
import { recordVoid } from "./record-void.js";
import { saleInput, steadyClock } from "../test/fixtures.js";

let db: Database;
let tenantId: TenantId;
let tillId: TillId;
let seriesId: SeriesId;
let workingOrderId: WorkingOrderId;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, {
    migrationsFolder: "../db/drizzle",
    migrationsTable: "__drizzle_migrations_core",
  });
  await runMigrations(db, {
    migrationsFolder: "../fiscal-verifactu/drizzle",
    migrationsTable: "__drizzle_migrations_fiscal",
  });
}, 60_000);

afterAll(async () => {
  await db.$client.close();
});

beforeEach(async () => {
  ({ tenantId, tillId, seriesId, workingOrderId } = await seedTenant(db));
});

async function sell(backend: FiscalBackend) {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordSale(tx, backend, saleInput({ tenantId, tillId, seriesId, workingOrderId }));
  });
}

async function voidSale(backend: FiscalBackend, saleId: SaleId, reason = "Wrong table") {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordVoid(tx, backend, saleId, reason);
  });
}

async function countRows(table: string): Promise<number> {
  const result = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  return (result.rows[0] as { n: number }).n;
}

describe("recordVoid — nothing is ever edited", () => {
  it("leaves the original sale row byte for byte unchanged", async () => {
    // The whole point of the design. Comparing the full row rather than named
    // columns is deliberate: a named-column assertion cannot notice an
    // implementation that quietly moved fiscal_state, which is exactly the edit
    // most likely to be attempted.
    const backend = new FakeFiscalBackend();
    const { saleId } = await sell(backend);
    const [before] = await db.select().from(sales).where(eq(sales.id, saleId));

    await voidSale(backend, saleId);

    const [after] = await db.select().from(sales).where(eq(sales.id, saleId));
    expect(after).toEqual(before);
  });

  it("appends a sale_voids row carrying the reason verbatim", async () => {
    const backend = new FakeFiscalBackend();
    const { saleId } = await sell(backend);
    await voidSale(backend, saleId, "Cliente devolvió el pedido");

    const [row] = await db.select().from(saleVoids).where(eq(saleVoids.saleId, saleId));
    expect(row?.reason).toBe("Cliente devolvió el pedido");
    // The roles seam: present, nullable, unread until sub-project 5.
    expect(row?.voidedBy).toBeNull();
  });

  it("asks the module for a new record rather than for an edit", async () => {
    const backend = new FakeFiscalBackend();
    const { saleId } = await sell(backend);
    await voidSale(backend, saleId);
    expect(backend.calls.recordVoid).toEqual([{ saleId, reason: "Wrong table" }]);
  });
});

describe("recordVoid — numbering", () => {
  it("allocates no invoice number", async () => {
    // The anulación carries the ANNULLED invoice's identity (IDFacturaAnulada),
    // not an identity of its own. Allocating here would burn a number for a
    // record with nowhere to put it, leaving a permanent series gap per void.
    const backend = new FakeFiscalBackend();
    const { saleId } = await sell(backend);
    const [before] = await db
      .select({ n: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, seriesId));

    await voidSale(backend, saleId);

    const [after] = await db
      .select({ n: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, seriesId));
    expect(after?.n).toBe(before?.n);
  });

  it("permanently burns the annulled invoice number", async () => {
    // Findings §7, via spec §7: after an anulación, resending an alta under the
    // same number STILL returns AEAT error 3000 — record identity is
    // IDEmisorFactura + NumSerieFactura + FechaExpedicionFactura, and annulling
    // does not free the triple. It is the same rule that forbids reusing a
    // number for a test invoice.
    //
    // Enforced locally because the alternative is discovering it as a rejected
    // record and a halted chain, hours later and in production.
    const backend = new FakeFiscalBackend();
    const first = await sell(backend);
    await voidSale(backend, first.saleId);

    const second = await sell(backend);
    const [row] = await db.select().from(sales).where(eq(sales.id, second.saleId));
    expect(row?.invoiceNumber).toBe(2);

    await expect(
      withTenant(db, tenantId, async (tx) => {
        await asAppUser(tx);
        await tx.insert(sales).values({
          tenantId,
          tillId,
          seriesId,
          invoiceNumber: 1,
          issuedAt: new Date(),
          total: "1.00",
          tipAmount: "0.00",
          amountCharged: "1.00",
          locale: "es-ES",
          invoiceLocales: ["es-ES"],
          fiscalBackend: "fake",
          fiscalState: "recorded",
        });
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("recordVoid — guards", () => {
  it("refuses to void a sale that does not exist", async () => {
    await expect(
      voidSale(new FakeFiscalBackend(), "00000000-0000-0000-0000-000000000000" as SaleId),
    ).rejects.toMatchObject({ code: "sale.not_found" });
  });

  it("refuses to void the same sale twice", async () => {
    const backend = new FakeFiscalBackend();
    const { saleId } = await sell(backend);
    await voidSale(backend, saleId);
    await expect(voidSale(backend, saleId)).rejects.toMatchObject({
      code: "sale.already_voided",
    });
  });

  it("chains nothing on a rejected second void", async () => {
    // The unique violation must fire BEFORE the module builds and chains an
    // anulación, or a rejected void still consumes chain work and the rollback
    // has to unwind it. Ordering is what this asserts, not just the outcome.
    const backend = new FakeFiscalBackend();
    const { saleId } = await sell(backend);
    await voidSale(backend, saleId);
    await expect(voidSale(backend, saleId)).rejects.toBeInstanceOf(AppError);

    expect(backend.calls.recordVoid).toHaveLength(1);
    expect(await countRows("sale_voids")).toBe(1);
  });
});

describe("recordVoid — no fiscal condition blocks a void", () => {
  it("completes the void when chain verification fails", async () => {
    // Same rule as the sale path. An anulación is a registro de facturación
    // like any other, so art. 7.i applies to it — and so does «NUNCA debe
    // interrumpirse». Blocking a void on a chain error would leave staff unable
    // to correct the very sale the incident concerns.
    const backend = new FakeFiscalBackend();
    const { saleId } = await sell(backend);
    backend.chainVerification = {
      ok: false,
      error: new AppError("chain.verification_failed", { tillId, sequence: 1 }),
    };
    await voidSale(backend, saleId);
    expect(await countRows("sale_voids")).toBe(1);
    expect(backend.calls.recordVoid).toHaveLength(1);
  });

  it("verifies the chain before generating the anulación", async () => {
    const backend = new FakeFiscalBackend();
    const { saleId } = await sell(backend);
    backend.calls.checkIntegrity.length = 0;
    await voidSale(backend, saleId);
    expect(backend.calls.checkIntegrity).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run each test individually and watch it fail**

Expected: FAIL — unresolved import `./record-void.js`.

`leaves the original sale row byte for byte unchanged` deserves particular attention: it compares a row to itself, so it passes trivially if `recordVoid` throws before doing anything, and would also pass against a stub that does nothing at all. Confirm it fails on the import, and re-check it after Step 6 by verifying `sale_voids` has a row.

- [ ] **Step 5: Implement**

`packages/core/src/record-void.ts`:

```ts
import { eq } from "drizzle-orm";
import { isUniqueViolation, saleVoids, sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { SaleId, TillId } from "@waitron/shared";
import type { FiscalBackend, FiscalRecordRef } from "@waitron/fiscal";

/**
 * Voids a sale by creating a NEW record that references it (spec §4).
 *
 * Once chained, records are never edited. Alta and anulación interleave in ONE
 * chain in generation order — the anulación's predecessor is the record
 * chronologically before it, which is very often NOT the record it annuls.
 */
export async function recordVoid(
  tx: Transaction,
  backend: FiscalBackend,
  saleId: SaleId,
  reason: string,
): Promise<{ fiscal: FiscalRecordRef }> {
  const [sale] = await tx
    .select({ tenantId: sales.tenantId, tillId: sales.tillId, issuedAt: sales.issuedAt })
    .from(sales)
    .where(eq(sales.id, saleId));

  if (sale === undefined) {
    // Also the cross-tenant case: RLS filters the row out, so a sale belonging
    // to another tenant is genuinely not found rather than forbidden — which is
    // the right answer to leak.
    throw new AppError("sale.not_found", { saleId });
  }

  // Chain lock plus art. 7.i, exactly as for an alta. The duty in art. 7.i is
  // "before generating each new record", not "before each sale", and an
  // anulación is a registro de facturación like any other.
  await backend.checkIntegrity(tx, sale.tillId as TillId);

  // No number is allocated. See the test: the anulación carries the annulled
  // invoice's identity, so a fresh number would have nowhere to live.

  // Append-only. The unique constraint on sale_id — not this insert's success —
  // is what makes double-voiding impossible; two concurrent transactions both
  // pass a SELECT-then-INSERT check and only one passes this.
  //
  // It runs BEFORE the module is asked for a record, so a rejected second void
  // never reaches the chain at all. Lock order stays chain-then-everything-else,
  // matching recordSale.
  try {
    await tx.insert(saleVoids).values({
      tenantId: sale.tenantId,
      saleId,
      reason,
      voidedAt: new Date(),
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A translation, not a recovery: the transaction is already aborted by
      // Postgres and must roll back. Catching here only ensures the caller gets
      // a structured code instead of a driver error string on screen.
      throw new AppError("sale.already_voided", { saleId });
    }
    throw error;
  }

  // The module already holds the annulled invoice's identity in its own
  // registro, keyed by sale_id. Passing NumSerieFactura and
  // FechaExpedicionFactura back through here would put a fiscal fact in the
  // generic layer and give it two sources of truth.
  const fiscal = await backend.recordVoid(tx, saleId, reason);

  return { fiscal };
}
```

- [ ] **Step 6: Run the tests and verify they pass**

```bash
cd packages/core
pnpm vitest run src/record-void.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 7: Write the end-to-end chain-interleaving test**

`packages/fiscal-verifactu/src/void-path.e2e.test.ts`. The core tests above cannot see a chain at all. This one carries the task's subtlest assertion.

```ts
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordSale, recordVoid } from "@waitron/core";
import { computeHuella } from "@waitron/verifactu";
import { asAppUser, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { VerifactuBackend } from "./backend.js";
import { cadenas } from "./schema/cadenas.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { saleInput, steadyClock } from "../test/write-path-fixtures.js";

// … beforeAll/afterAll/beforeEach exactly as in write-path.e2e.test.ts …

describe("alta and anulación interleave in one chain", () => {
  it("chains the anulación onto the chronologically previous record, not the one it annuls", async () => {
    // THE assertion of this task. Sell A, sell B, then void A. The anulación's
    // predecessor is B — the record generated immediately before it — even
    // though the record it annuls is A. Chaining it onto A instead produces a
    // chain that verifies against itself locally and is rejected wholesale by
    // AEAT, and no core-level test can tell the two apart.
    const a = await sell();
    const b = await sell();
    await voidSale(a.saleId);

    const rows = await db
      .select()
      .from(registrosFacturacion)
      .orderBy(asc(registrosFacturacion.secuencia));

    expect(rows.map((r) => r.tipoRegistro)).toEqual(["alta", "alta", "anulacion"]);
    expect(rows.map((r) => r.secuencia)).toEqual([1, 2, 3]);

    const anulacion = rows[2]!;
    expect(anulacion.encadenamientoHuella).toBe(rows[1]!.huella);
    expect(anulacion.encadenamientoHuella).not.toBe(rows[0]!.huella);
    // …while the record it ANNULS is still A, carried in the anulada identity.
    expect(anulacion.numSerieFacturaAnulada).toBe("A/1");
    void b;
  });

  it("gives the anulación its own huella, recomputable from its own columns", async () => {
    const a = await sell();
    await voidSale(a.saleId);
    const [anulacion] = await db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.tipoRegistro, "anulacion"));
    expect(computeHuella(toRegistro(anulacion!))).toBe(anulacion?.huella);
  });

  it("gives the anulación its own pending sidecar row", async () => {
    const a = await sell();
    await voidSale(a.saleId);
    const rows = await db.select().from(envios);
    // Two registros, two sidecars. An anulación that shared the alta's row
    // would be submitted to AEAT never or twice, both unrecoverable.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.estado === "pendiente")).toBe(true);
  });

  it("advances the chain head to the anulación", async () => {
    const a = await sell();
    await voidSale(a.saleId);
    const [anulacion] = await db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.tipoRegistro, "anulacion"));
    const [head] = await db.select().from(cadenas);
    expect(head?.secuencia).toBe(2);
    expect(head?.ultimaHuella).toBe(anulacion?.huella);
  });
});
```

- [ ] **Step 8: Run each end-to-end test individually, then to green**

Expected: FAIL — the anulación branch of `VerifactuBackend.recordVoid` is not implemented.

```bash
cd packages/fiscal-verifactu
pnpm vitest run src/void-path.e2e.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 9: Teeth check — break it and watch it scream**

Temporarily add `next_number` incrementing to `recordVoid` (call `allocateInvoiceNumber` before `backend.recordVoid`):

```bash
cd packages/core && pnpm vitest run src/record-void.test.ts
```

Expected: FAIL — `allocates no invoice number`. Restore it.

Temporarily move the `saleVoids` insert to after `backend.recordVoid`:

Expected: FAIL — `chains nothing on a rejected second void`. Restore it.

Temporarily drop the `unique("sale_voids_sale_id_key")` constraint and regenerate the migration:

Expected: FAIL — `refuses to void the same sale twice` and `chains nothing on a rejected second void`. Restore it. Note that the application-level path would still look correct with the constraint gone, which is precisely why the constraint rather than a check is the control.

Temporarily make the module chain the anulación onto the record it annuls rather than onto the chain head:

```bash
cd packages/fiscal-verifactu && pnpm vitest run src/void-path.e2e.test.ts
```

Expected: FAIL — `chains the anulación onto the chronologically previous record, not the one it annuls`. Restore it. If this leaves the suite green, the fixture has only one prior record and the two candidates coincide — fix the fixture, not the assertion.

Finally, temporarily make `recordVoid` update `sales.fiscalState` to `"voided"` instead of inserting into `sale_voids`:

Expected: FAIL — the statement is rejected outright, because `UPDATE` on `sales` is revoked from `app_user`. That failure mode is the design working; it is why the projection is a separate append-only table.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/record-void.ts packages/core/src/record-void.test.ts \
        packages/core/src/index.ts packages/db/src/schema/sale-voids.ts \
        packages/db/src/index.ts packages/db/drizzle packages/shared/src/errors.ts \
        packages/fiscal-verifactu/src/void-path.e2e.test.ts
git commit -m "feat(core): anulación — voiding appends, never edits

A void creates a new record referencing the old one. The original sale row
is asserted byte for byte identical afterwards, and the mutation check
confirms that attempting the obvious alternative — flipping fiscal_state on
the sale — is rejected by the server, because UPDATE on sales is revoked
from the application role. Void-ness therefore lives in an append-only
sale_voids projection inside packages/db, which keeps a Z-report free of a
cross-boundary join per row.

The anulación is chained exactly like an alta: its own sequence, huella,
predecessor pointer and pending sidecar row. Its predecessor is the record
generated immediately before it, which is usually NOT the record it annuls
— an end-to-end test sells twice and voids the first, because a fixture
with one prior record cannot distinguish the two.

No number is allocated, and the annulled number is burned for good:
resending an alta under it returns AEAT error 3000 even after annulment,
since record identity is the emisor/serie/fecha triple and annulling does
not free it. Enforced locally by a unique constraint, because the
alternative is discovering it as a halted chain in production.

Voiding is role-gated and roles are sub-project 5. The seam is the nullable
voided_by column and the call site — deliberately not a check inside
recordVoid, which would look like security while enforcing nothing."
```

---

## Task 18: Incident recording, and the documentation corrections this plan owes

Two deliverables that belong together because both are about the system telling the truth: chain-verification failures and clock degradation become rows a screen can read while **nothing blocks a sale**, and three documents that still describe a design this repo abandoned are brought back in line — including re-acquiring the AEAT primary sources that a gitignored worktree destroyed, for the second time.

**Files:**

- Create: `packages/db/src/schema/incidents.ts`
- Create: `packages/core/src/incidents.ts`
- Create: `packages/core/src/incidents.test.ts`
- Create: `packages/verifactu/schemas/` (six AEAT artefacts) and `packages/verifactu/schemas/README.md`
- Create: `packages/verifactu/src/schemas.test.ts`
- Modify: `packages/core/src/record-sale.ts`, `packages/core/src/record-void.ts`
- Modify: `packages/db/src/index.ts`, `packages/core/src/index.ts`
- Modify: `packages/shared/src/errors.ts`
- Modify: `packages/verifactu/PROVENANCE.md`, `packages/verifactu/src/xml/serialize.ts`
- Modify: `.prettierignore`
- Modify: `docs/superpowers/specs/2026-07-18-pos-architecture-design.md`
- Modify: `.github/instructions/waitron.instructions.md`

**Interfaces:**

- Consumes: `AppError` from `@waitron/shared`; `Transaction` from `@waitron/db`.
- Produces:
  - Table `incidents` — `id`, `tenant_id`, `till_id`, `sale_id`, `code`, `params`, `severity`, `detected_at`, `acknowledged_at`, `acknowledged_by`
  - `recordIncident(tx, input: RecordIncidentInput): Promise<void>`
  - `openIncidents(tx, tillId: TillId): Promise<Incident[]>`

**Spec §4's table, reproduced because it is the specification this task implements:**

| Condition | Behaviour |
| --- | --- |
| Chain verification fails | Record the incident, **chain the next record anyway**, surface persistently to staff |
| Clock confidence degraded | Warn only |
| AEAT outage, submission failure, expired certificate, offline operation | **No effect on selling whatsoever** |

The third row is not a lighter version of the first two. It means the write path never contacts AEAT at all, so those conditions have nothing to affect — a property this task asserts directly rather than describing.

> In non-Veri\*Factu mode a detected chain error must **additionally** be written to the registro de eventos (Orden arts. 7.j, 9.1.d). We build Veri\*Factu mode only, where AEAT is explicit that log is *"no siendo necesario"* — so no event log is written here. The incident is still recorded internally regardless, because staff need to see it and support needs to diagnose it, and because a mode switch later must find the data already being captured rather than start capturing it.

- [ ] **Step 1: Create the incidents table and its privileges**

`packages/db/src/schema/incidents.ts`:

```ts
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sales } from "./sales.js";
import { tenants, tills } from "./tenants.js";

export type IncidentSeverity = "warning" | "error";

/**
 * Fiscal incidents, surfaced to staff and to support.
 *
 * The only table in this plan that the application role may UPDATE, and only
 * two of its columns — see the migration below, which uses a column-level
 * GRANT. An incident is a record of what happened, not a note anyone may
 * rewrite; acknowledging one is the sole permitted mutation.
 *
 * `code` and `params` come from an AppError rather than from a message string,
 * so the till can render this bilingually. A prose column here would reach a
 * screen untranslatable, which is the constraint spec §9 places on this layer
 * specifically.
 */
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    tillId: uuid("till_id")
      .notNull()
      .references(() => tills.id),
    /** Nullable: plan 3's drainer raises incidents with no sale attached. */
    saleId: uuid("sale_id").references(() => sales.id),
    code: text("code").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    severity: text("severity").$type<IncidentSeverity>().notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by"),
  },
  (table) => ({
    // The till UI's query is "what is open on this till, newest first".
    openByTill: index("incidents_till_open_idx").on(table.tillId, table.detectedAt),
  }),
).enableRLS();
```

Then generate a custom migration for the parts Drizzle cannot express — `FORCE ROW LEVEL SECURITY` is unsupported by `pg-core` entirely, and column-level `GRANT` has no builder:

```bash
cd packages/db
pnpm exec drizzle-kit generate --name incidents
pnpm exec drizzle-kit generate --custom --name incidents_privileges
```

Hand-write the custom migration's body:

```sql
-- The application connects as a non-owner role with narrowly granted rights.
-- Migrations run as owner; the application never does. An owner can ALTER TABLE
-- … DISABLE TRIGGER, so privilege is the control and the trigger is the backstop.
GRANT SELECT, INSERT ON incidents TO app_user;

-- Column-level UPDATE. An UPDATE touching code, params, severity, detected_at
-- or either foreign key is rejected by the server, so "an incident is not
-- rewritable" is a database property like every other guarantee in this plan
-- rather than a convention the application is trusted to keep.
GRANT UPDATE (acknowledged_at, acknowledged_by) ON incidents TO app_user;

ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents FORCE ROW LEVEL SECURITY;

CREATE POLICY incidents_tenant_isolation ON incidents
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

- [ ] **Step 2: Add the incident error codes**

In `packages/shared/src/errors.ts`, append to `ErrorCode`:

```ts
  | "chain.verification_failed"
  | "clock.degraded"
```

`chain.verification_failed` is raised by the module's `verifyChain` and carried through `IntegrityReport`; `clock.degraded` is raised by the write path itself.

**The shape `IntegrityReport` arrives in is `{ ok, checked, issues }`, as Task 11 Step 6 declares it and Task 15 Step 1 consumes it** — not `{ ok: true } | { ok: false; error: AppError }`, which an earlier draft of this task assumed. The difference matters here rather than being a detail: one failed check produces one incident row per issue, and each issue already carries the `code` and `params` that row needs. An `AppError` would not survive the JSON round-trip into `incidents.params`, and a bare boolean would carry neither code nor params, forcing this step to invent both — which is the prose-error problem re-entering through a different door. `chain.verification_failed` is therefore the `ErrorCode` this task maps an issue *onto* when rendering it, not something `checkIntegrity` returns.

- [ ] **Step 3: Write the failing tests**

`packages/core/src/incidents.test.ts`:

```ts
import { desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import type { SeriesId, TenantId, TillId, WorkingOrderId } from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/testing";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  asAppUser,
  createPgliteDb,
  incidents,
  runMigrations,
  sales,
  withTenant,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { openIncidents } from "./incidents.js";
import { recordSale } from "./record-sale.js";
import { saleInput, seedTenant } from "../test/fixtures.js";

let db: Database;
let tenantId: TenantId;
let tillId: TillId;
let seriesId: SeriesId;
let workingOrderId: WorkingOrderId;

// … beforeAll/afterAll as in record-sale.test.ts …

beforeEach(async () => {
  ({ tenantId, tillId, seriesId, workingOrderId } = await seedTenant(db));
});

const BASE = new Date("2026-03-01T13:05:00+01:00");
const steadyClock: TrustedClock = {
  now: () => ({ instant: BASE, offsetMinutes: 60, confident: true }),
};
const degradedClock: TrustedClock = {
  now: () => ({ instant: BASE, offsetMinutes: 60, confident: false }),
};

function failingChain(): FakeFiscalBackend {
  const backend = new FakeFiscalBackend();
  backend.chainVerification = {
    ok: false,
    error: new AppError("chain.verification_failed", { tillId, sequence: 7, expected: "ABC" }),
  };
  return backend;
}

async function sell(backend: FiscalBackend, clock: TrustedClock = steadyClock) {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordSale(tx, backend, saleInput({ tenantId, tillId, seriesId, workingOrderId, clock }));
  });
}

describe("incidents — chain verification failure", () => {
  it("records an incident and still completes the sale", async () => {
    const backend = failingChain();
    const { saleId } = await sell(backend);

    const rows = await db.select().from(incidents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("chain.verification_failed");
    expect(rows[0]?.severity).toBe("error");
    expect(rows[0]?.saleId).toBe(saleId);
    // The sale completed and the record was chained ANYWAY. Both halves matter:
    // a suite asserting only the incident row would pass against an
    // implementation that recorded the incident and then aborted.
    expect(await db.select().from(sales)).toHaveLength(1);
    expect(backend.calls.recordSale).toHaveLength(1);
  });

  it("carries the structured params, not a rendered message", async () => {
    await sell(failingChain());
    const [row] = await db.select().from(incidents);
    expect(row?.params).toEqual({ tillId, sequence: 7, expected: "ABC" });
  });

  it("writes the incident in the same transaction as the sale", async () => {
    // A separate connection would let an incident exist for a sale that rolled
    // back, or a sale exist for an incident that did. Force the rollback after
    // recordSale returns and confirm neither survives.
    const backend = failingChain();
    await expect(
      withTenant(db, tenantId, async (tx) => {
        await asAppUser(tx);
        await recordSale(
          tx,
          backend,
          saleInput({ tenantId, tillId, seriesId, workingOrderId, clock: steadyClock }),
        );
        throw new Error("simulated crash before commit");
      }),
    ).rejects.toThrow("simulated crash");

    expect(await db.select().from(incidents)).toHaveLength(0);
    expect(await db.select().from(sales)).toHaveLength(0);
  });
});

describe("incidents — clock degradation", () => {
  it("records a warning, not an error", async () => {
    // Spec §4: clock confidence degraded is WARN ONLY. Recording it at error
    // severity would put it in the same visual channel as a chain failure and
    // train staff to ignore both.
    await sell(new FakeFiscalBackend(), degradedClock);
    const [row] = await db.select().from(incidents);
    expect(row?.code).toBe("clock.degraded");
    expect(row?.severity).toBe("warning");
    expect(await db.select().from(sales)).toHaveLength(1);
  });

  it("records both incidents when the chain fails and the clock is degraded", async () => {
    await sell(failingChain(), degradedClock);
    const rows = await db.select().from(incidents);
    expect(rows.map((r) => r.code).sort()).toEqual([
      "chain.verification_failed",
      "clock.degraded",
    ]);
  });

  it("records nothing when verification passes and the clock is confident", async () => {
    // The negative case. Without it, an implementation that records an incident
    // unconditionally passes every test above.
    await sell(new FakeFiscalBackend(), steadyClock);
    expect(await db.select().from(incidents)).toHaveLength(0);
  });
});

describe("openIncidents", () => {
  it("returns unacknowledged incidents for a till, newest first", async () => {
    await sell(failingChain());
    await sell(failingChain());
    const rows = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      return openIncidents(tx, tillId);
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.detectedAt.getTime()).toBeGreaterThanOrEqual(rows[1]!.detectedAt.getTime());
  });

  it("excludes acknowledged incidents", async () => {
    await sell(failingChain());
    await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      // The one permitted mutation, and it must be permitted for app_user —
      // a column-level GRANT that omitted acknowledged_at would fail here.
      await tx.update(incidents).set({ acknowledgedAt: new Date() });
    });
    const rows = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      return openIncidents(tx, tillId);
    });
    expect(rows).toHaveLength(0);
  });

  it("scopes incidents to one till", async () => {
    const other = await seedTenant(db, { tenantId });
    await sell(failingChain());
    const rows = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      return openIncidents(tx, other.tillId);
    });
    expect(rows).toHaveLength(0);
  });

  it("refuses to rewrite an incident's code as the application role", async () => {
    // The column-level GRANT is the control. Without it, "an incident is a
    // record, not a note" would rest on nobody writing the UPDATE.
    await sell(failingChain());
    await expect(
      withTenant(db, tenantId, async (tx) => {
        await asAppUser(tx);
        await tx.update(incidents).set({ code: "nothing.happened" });
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});
```

And in `packages/fiscal-verifactu/src/write-path.e2e.test.ts`, append the row-three assertion:

```ts
it("completes a sale with no AEAT connectivity whatsoever", async () => {
  // Spec §4 row three: AEAT outage, submission failure, expired certificate and
  // offline operation have NO EFFECT ON SELLING. The strongest way to assert
  // that is not to simulate an outage but to prove the write path cannot reach
  // the network at all — a fetch that throws on any call, never called.
  const exploding = vi.fn(() => {
    throw new Error("network is unreachable");
  });
  const offline = new VerifactuBackend({ clock: steadyClock, fetch: exploding });

  const { saleId } = await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordSale(tx, offline, saleInput({ tenantId, tillId, seriesId, workingOrderId }));
  });

  expect(exploding).not.toHaveBeenCalled();
  expect(await db.select().from(sales).where(eq(sales.id, saleId))).toHaveLength(1);
  expect(await db.select().from(registrosFacturacion)).toHaveLength(1);
  expect(await db.select().from(incidents)).toHaveLength(0);
});
```

- [ ] **Step 4: Run each test individually and watch it fail**

Expected: FAIL — unresolved import `./incidents.js`.

`records nothing when verification passes and the clock is confident` and `completes a sale with no AEAT connectivity whatsoever` both assert emptiness, so both can pass vacuously. Confirm each fails on the import rather than on an empty table.

- [ ] **Step 5: Implement**

`packages/core/src/incidents.ts`:

```ts
import { and, desc, eq, isNull } from "drizzle-orm";
import { incidents } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { AppError } from "@waitron/shared";
import type { SaleId, TenantId, TillId } from "@waitron/shared";

export type IncidentSeverity = "warning" | "error";

export interface RecordIncidentInput {
  tenantId: TenantId;
  tillId: TillId;
  saleId?: SaleId;
  /** The structured error itself. Code and params are taken from it, never re-derived. */
  error: AppError;
  severity: IncidentSeverity;
  detectedAt: Date;
}

export interface Incident {
  id: string;
  tillId: TillId;
  saleId: SaleId | null;
  code: string;
  params: Record<string, unknown>;
  severity: IncidentSeverity;
  detectedAt: Date;
}

/**
 * Records a fiscal incident on the caller's transaction.
 *
 * Always the caller's transaction, never a fresh connection: an incident that
 * committed while its sale rolled back would report a chain failure for a sale
 * that never existed, and support would chase it.
 */
export async function recordIncident(
  tx: Transaction,
  input: RecordIncidentInput,
): Promise<void> {
  await tx.insert(incidents).values({
    tenantId: input.tenantId,
    tillId: input.tillId,
    saleId: input.saleId ?? null,
    code: input.error.code,
    params: input.error.params,
    severity: input.severity,
    detectedAt: input.detectedAt,
  });
}

/**
 * The query the till UI will read for its persistent incident banner.
 *
 * Unacknowledged only, newest first, scoped to one till. Defined here rather
 * than in the UI so that the module boundary holds: the till never reads
 * module-owned tables, and an incident raised by plan 3's drainer surfaces
 * through this same query with no UI change.
 */
export async function openIncidents(tx: Transaction, tillId: TillId): Promise<Incident[]> {
  const rows = await tx
    .select({
      id: incidents.id,
      tillId: incidents.tillId,
      saleId: incidents.saleId,
      code: incidents.code,
      params: incidents.params,
      severity: incidents.severity,
      detectedAt: incidents.detectedAt,
    })
    .from(incidents)
    .where(and(eq(incidents.tillId, tillId), isNull(incidents.acknowledgedAt)))
    .orderBy(desc(incidents.detectedAt));

  return rows as Incident[];
}
```

Then wire it into `packages/core/src/record-sale.ts`. Incidents are collected during the pass and written once the sale row exists, because `incidents.sale_id` is the column that ties a chain failure to the receipt a customer is holding:

```ts
import { recordIncident } from "./incidents.js";
import type { IncidentSeverity } from "./incidents.js";

// … inside recordSale, replacing `void verification;` …

  const pending: Array<{ error: AppError; severity: IncidentSeverity }> = [];

  if (!verification.ok) {
    // Recorded, surfaced — and then the record is chained anyway. AEAT weighed
    // this exact trade-off and decided that «la facturación NUNCA debe
    // interrumpirse». Halting here would not be a stricter reading of the rules;
    // it would be doing the thing the rules tell us not to do.
    pending.push({ error: verification.error, severity: "error" });
  }

  // … after `const now = input.clock.now();` …

  if (!now.confident) {
    pending.push({
      error: new AppError("clock.degraded", {
        tillId: input.tillId,
        offsetMinutes: now.offsetMinutes,
      }),
      // Warn only. FechaHoraHusoGenRegistro is validated as an upper bound, a
      // late record trips nothing, and blocking a sale over a clock is worse
      // than the defect it would prevent.
      severity: "warning",
    });
  }

  // … after the sales insert, once saleId exists …

  for (const incident of pending) {
    await recordIncident(tx, {
      tenantId: input.tenantId,
      tillId: input.tillId,
      saleId,
      detectedAt: now.instant,
      ...incident,
    });
  }
```

Apply the same chain-verification block to `packages/core/src/record-void.ts`, using the void's own `new Date()` reading for `detectedAt` and the annulled sale's id for `saleId`.

- [ ] **Step 6: Run the tests and verify they pass**

```bash
cd packages/core && pnpm vitest run src/incidents.test.ts
cd ../fiscal-verifactu && pnpm vitest run src/write-path.e2e.test.ts
```

Expected: PASS, 9 tests and 9 tests.

- [ ] **Step 7: Teeth check — break it and watch it scream**

Invert the guard to `if (verification.ok)`:

```bash
cd packages/core && pnpm vitest run src/incidents.test.ts
```

Expected: FAIL — `records an incident and still completes the sale` **and** `records nothing when verification passes and the clock is confident`. Both, because the inversion moves the incident rather than removing it, and only the pair can detect that. Restore it.

Change the clock incident's `severity` to `"error"`:

Expected: FAIL — `records a warning, not an error`. Restore it.

Remove the `isNull(incidents.acknowledgedAt)` predicate from `openIncidents`:

Expected: FAIL — `excludes acknowledged incidents`. Restore it.

Remove the `eq(incidents.tillId, tillId)` predicate:

Expected: FAIL — `scopes incidents to one till`. Restore it.

Widen the migration's column-level grant to `GRANT UPDATE ON incidents TO app_user`:

Expected: FAIL — `refuses to rewrite an incident's code as the application role`. Restore it.

Add `if (!verification.ok) throw verification.error;` after the incident is recorded:

Expected: FAIL — `records an incident and still completes the sale`. Restore it. This is the same mutation as Task 16's last, repeated here because the incident code is precisely where a future contributor will feel that a throw belongs.

- [ ] **Step 8: Correct the sales-spine spec's two claims this plan contradicts**

`docs/superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md`. Both corrections are cases where the implementation is right and the prose is wrong, and both were discovered by tasks that tried to implement the prose literally and found what it cost.

**First, the numbering claim in §3 and §4.** Both sections state that "a crash anywhere before commit burns an invoice number — a permitted gap". Replace that clause, in both places, with:

```markdown
A crash anywhere before commit **returns** the invoice number: allocation is a
transactional `UPDATE ... RETURNING` under a row lock, so an aborted sale
leaves `next_number` where it was and no gap appears. Gaps are *permitted* by
the regime, not required. The property that must hold is that a number is
never reused once it has been used, and that is enforced by
`UNIQUE (tenant_id, series_id, invoice_number)` on `sales` rather than by the
allocator.
```

Task 6 records why the alternative was rejected: making the original sentence literally true requires a Postgres sequence per series *row*, therefore `CREATE SEQUENCE` executed from an insert trigger, a `SECURITY DEFINER` function to run that DDL, and a grant per sequence — dynamic DDL on the write path, to manufacture a gap nothing asks for. **Do not "fix" the code to match the old sentence.**

**Second, §6's `fiscal_state` claim.** §6 describes the fiscal module writing `fiscal_state` on `sales` as submission progresses, which cannot coexist with §3 revoking `UPDATE` on `sales` from the application role. Replace the mutable-state description with:

```markdown
`sales.fiscal_state` is written **once, at insert**, and never updated. Its
values are `recorded` and `not_applicable` — the state at issuance, which is
all a Z-report needs to avoid a cross-boundary join per row. It is not a
submission-progress field: submission state mutates constantly and lives in
the module's `envios` sidecar, which is exactly why §3 puts it there. The till
reads it through `FiscalBackend.pendingCount`, never by joining to module
tables. A void does not modify the sale either — it appends a row to
`sale_voids`.
```

Then check for other statements resting on the mutable reading:

```bash
grep -rn -i "fiscal_state\|burns an invoice number\|burns a number" \
  docs/superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md
```

Expected after both edits: every remaining hit describes write-once state or the corrected numbering behaviour. Any hit that still describes `fiscal_state` being updated, or a number being burned, is a further stale claim and is corrected in this same commit.

- [ ] **Step 9: Correct architecture §4, which still specifies SQLite**

`docs/superpowers/specs/2026-07-18-pos-architecture-design.md` §4 describes a design this repo no longer has. Three edits.

First, three rows of the stack table. Replace:

```markdown
| ORM | Drizzle | Targets both dialects |
| DB (cloud) | Postgres | ACID, constraints, exact numerics, RLS as tenant backstop |
| DB (standalone) | SQLite | Single process, no compose file — lowest barrier to adoption |
| Tests | Vitest + pglite | No container needed for Postgres tests |
```

with:

```markdown
| ORM | Drizzle | `pg-core` only — one dialect in both deployment modes |
| DB (cloud) | Postgres | ACID, constraints, exact numerics, RLS as tenant backstop |
| DB (standalone) | PGlite (embedded WASM Postgres) | Single process, no compose file — and genuine Postgres, so schema, queries and immutability guarantees are the ones the cloud runs |
| Tests | Vitest + PGlite, plus Testcontainers Postgres for lock contention | No container needed for the bulk of the suite; PGlite provably cannot test `FOR UPDATE` contention, so chain-append concurrency needs a real server |
```

The `| ORM | Drizzle | Targets both dialects |` row is stale for the same reason as the rest and is easy to miss, since it reads as a neutral statement about the tool rather than a decision.

Second, replace the entire `### Dual database risk` subsection with:

```markdown
### Single dialect — how the dual-database risk was removed

> **Superseded 2026-07-20.** This subsection previously read: *"The fiscal test suite runs against
> both SQLite and Postgres in CI from the first commit."* There is no SQLite path any more, so
> there is no dual suite to run. The decision, the empirical research behind it and the three
> fiscal findings that forced it are recorded in
> [`2026-07-19-sales-spine-and-fiscal-layer-design.md`](2026-07-19-sales-spine-and-fiscal-layer-design.md)
> §3, "The standalone database is PGlite, not SQLite". The original text is not deleted, because
> the reasoning that chose SQLite was sound on the information available at the time and knowing
> *which* assumption broke is worth more than a document that reads as though it were always right.

The risk this subsection existed to manage — dialect divergence discovered late, in the code that
chains sales records — was **removed rather than mitigated**. There is one dialect: `pg-core` is
the only Drizzle builder in the repo, PGlite runs a real PostgreSQL engine in the standalone
deployment, and the same schema and the same queries run in both modes because they are the same
database.

The assumption that broke was that "identical schema and identical queries" across SQLite and
Postgres was achievable with Drizzle. It is not — Drizzle ships separate `pg-core` and
`sqlite-core` builders with no shared supertype, and the maintainers declined to add one. Three
further findings bear on *fiscal* correctness specifically, and the third is decisive: SQLite has
no privilege system, so any writer may `DROP TRIGGER`. That reduces immutability to "the
application does not misbehave", which is the thing a database-enforced guarantee was supposed to
replace.

What survives from the original reasoning, unchanged:

- **RLS exists only in the cloud path.** The standalone deployment is single-tenant, so there is no
  cross-tenant isolation to back up and `withTenant` collapses to a no-op there.
- **The fiscal suite still runs against more than one target**, but the split is PGlite versus a
  real Postgres server rather than two dialects. PGlite serialises every query onto one backend, so
  `SELECT … FOR UPDATE` parses and runs but never blocks — a contention test on PGlite is a **false
  pass**, not a weak one, and chain-append concurrency is therefore tested against Postgres via
  Testcontainers.
```

Third, §11's disposition table and any other reference to SQLite in the document must be checked. Run:

```bash
grep -rn -i "sqlite\|both dialects" docs/superpowers/specs/2026-07-18-pos-architecture-design.md
```

Expected: only the superseded-note quotation inside the block above. Any other hit is a further stale claim and is corrected in this same commit.

- [ ] **Step 10: Correct `.github/instructions/waitron.instructions.md` and add the new boundaries**

Read the whole file before editing — its voice is specific and worth matching: every section states something already true of the codebase, names the automated check enforcing it, and closes by telling a reviewer what to do when a PR pushes against it.

The `## Workspace package boundaries` section describes `packages/verifactu` as *"not yet created as of this writing"*, stale since `7938e1b`. It also calls it "VeriFactu/SII", which conflates two different regimes — SII is the 2017 immediate-supply regime and is not what this package implements. Replace the opening sentence:

```markdown
`packages/verifactu` (Spain's Veri\*Factu invoicing-compliance library — landed in `7938e1b`, see
`docs/superpowers/plans/2026-07-19-verifactu-library.md`) must never import from any other
`packages/*` or `apps/*` workspace package, including `@waitron/ui`.
```

Leave the rest of that section as it stands; it is still exactly right.

Then append two sections:

```markdown
## Spanish vocabulary stops at the module boundary

Two packages speak Spanish, and only two: `packages/verifactu` and `packages/fiscal-verifactu`.
Their identifiers, table names and column names mirror AEAT's specification, XML and conformance
vectors 1:1 — `RegistroAlta`, `Encadenamiento`, `registros_facturacion`, `cadenas`, `envios` —
because translating there makes the official test vectors unreadable against their source.
`packages/db`, `packages/core`, `packages/fiscal` and `packages/shared` are English throughout,
identifiers **and** table and column names, and the chain concept does not appear in them at all:
chaining is a requirement of a specific national regime, not of a POS.

This is enforced automatically by a text-level guard, and it is a test rather than an ESLint rule
for a concrete reason: ESLint runs untyped here, and its AST selectors cannot see string literals,
so no rule can police a Drizzle table name like `pgTable("registros", …)` — that is a `Literal`
node. The guard discovers its targets by glob, in the same shape as `no-hardcoded-chrome`, so a new
file in a generic package is covered the moment it exists rather than when someone remembers to
register it.

A PR that introduces a Spanish identifier into a generic package, or that widens the guard's
exclusion list to let one through, is a design question to raise rather than a nit to wave through.
A second fiscal backend — TicketBAI, Italy, Portugal — brings its own vocabulary and its own tables
and must touch nothing in the generic layer. Only the `FiscalBackend` interface crosses, and the
direction is fixed: `packages/fiscal-verifactu` depends on `packages/verifactu`, never the reverse.

## Database tests that assert nothing

Two properties of this repo's test environment let a database test pass while proving nothing.
Both were measured here rather than assumed, and both have already produced a false pass:

1. **PGlite runs as superuser, and superusers bypass RLS — `FORCE ROW LEVEL SECURITY` does not
   change that**; Postgres's own documentation says superusers "always bypass". A tenant-isolation
   test that does not `set local role app_user` first passes green against a table carrying no
   policy at all. Every RLS test goes through the `asAppUser` seam, and a new one that does not is
   incomplete regardless of what it asserts.
2. **PGlite cannot test lock contention.** Concurrent queries serialise onto a single backend
   (`pg_backend_pid()` is identical across them), so `SELECT … FOR UPDATE` parses and runs but
   never blocks. A hand-rolled contention test appeared to pass while both statements had merged
   into one transaction. Chain-append concurrency is tested against real Postgres via
   Testcontainers; a contention test added to a PGlite suite is a false pass and should be sent
   back.

Relatedly, immutability of `sales`, `sale_lines`, `tenders` and `registros_facturacion` rests on
revoking `UPDATE`/`DELETE` from a non-owner application role, with triggers as the backstop rather
than the mechanism. **A test that runs as the table owner proves nothing** — an owner can
`ALTER TABLE … DISABLE TRIGGER`. Migrations run as owner; the application never does. The single
exception is `incidents`, which carries a column-level `GRANT UPDATE (acknowledged_at,
acknowledged_by)`: acknowledging an incident is the one permitted mutation in the fiscal path, and
a PR widening that grant to the whole table is removing a guarantee, not simplifying a statement.
```

- [ ] **Step 11: Re-acquire AEAT's XSDs and WSDL, and commit them**

> **This is the second time primary source material has been lost to a gitignored worktree.** The first was a progress ledger; this time it was every AEAT schema the library was verified against, which lived under `.claude/worktrees/` and went with the teardown. Plan 1's own handoff records the consequence plainly: until they are back, *"any task step saying 'verify against the XSD' has nothing to verify against"*. Committing them is what stops a third occurrence, and Step 12's test is what makes a third occurrence loud.

They go in `packages/verifactu/schemas/`. Two alternatives were considered and rejected: `docs/compliance/` sits beside the other primary-source record and is already Prettier-ignored, but the schemas belong to the package that serialises against them, and that package extracts to its own repository at first public release (architecture §8) — schemas living outside it would be left behind by the extraction, which is precisely how they were lost the first time. A `test/` fixture directory was also rejected: these are not fixtures, they are the specification.

Fetch six artefacts:

| File | Source |
| --- | --- |
| `SuministroInformacion.xsd` | `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd` |
| `SuministroLR.xsd` | `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd` |
| `ConsultaLR.xsd` | `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/ConsultaLR.xsd` |
| `RespuestaSuministro.xsd` | same directory — **URL inferred, not attested** |
| `RespuestaConsultaLR.xsd` | same directory — **URL inferred, not attested** |
| `SistemaFacturacion.wsdl` | **URL not determinable from this repo** |

The first three URLs are not guesses: they are the exact `targetNamespace` constants already committed in `packages/verifactu/src/xml/serialize.ts`, and AEAT publishes each schema at its own namespace URI. The last three are named in `PROVENANCE.md` but no URL for them appears anywhere in this repository.

> **Do not invent the three unattested URLs.** Resolve them from AEAT's developer portal, which `docs/compliance/who-to-ask.md` records as the authoritative index: `https://www.agenciatributaria.es/AEAT.desarrolladores/Desarrolladores/_menu_/Documentacion/Sistemas_Informaticos_de_Facturacion_y_Sistemas_VERI_FACTU/Sistemas_Informaticos_de_Facturacion_y_Sistemas_VERI_FACTU.html`. Record whichever URL each file actually came from, not the one the pattern predicted. A schema fetched from a plausible-looking URL that turned out to serve a different revision is worse than a missing file, because the next reader will verify against it.

```bash
mkdir -p packages/verifactu/schemas
cd packages/verifactu/schemas
curl -fSL -O https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd
curl -fSL -O https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd
curl -fSL -O https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/ConsultaLR.xsd
shasum -a 256 *.xsd
```

Expected: three files fetched, `curl` exiting zero on each, and three checksums to transcribe.

Write `packages/verifactu/schemas/README.md`:

```markdown
# AEAT primary sources

These are **AEAT's own published artefacts**, reproduced verbatim. They are public
administrative publications of the Spanish tax authority, not third-party code, and they are
committed here rather than fetched at build time for two reasons: a build that reaches the
network is not reproducible, and this material has already been lost twice to worktree teardown.

**Never edit a file in this directory.** If one disagrees with our implementation, our
implementation is what changes. `src/schemas.test.ts` asserts each file's SHA-256 against the
table below, so an edit made to turn a test green fails a different test instead.

| File | Fetched | SHA-256 | Source |
| --- | --- | --- | --- |
| `SuministroInformacion.xsd` | YYYY-MM-DD | `…` | `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd` |
| `SuministroLR.xsd` | YYYY-MM-DD | `…` | `…/SuministroLR.xsd` |
| `ConsultaLR.xsd` | YYYY-MM-DD | `…` | `…/ConsultaLR.xsd` |
| `RespuestaSuministro.xsd` | YYYY-MM-DD | `…` | record the URL actually used |
| `RespuestaConsultaLR.xsd` | YYYY-MM-DD | `…` | record the URL actually used |
| `SistemaFacturacion.wsdl` | YYYY-MM-DD | `…` | record the URL actually used |

The authoritative index for all of them is AEAT's developer portal:
<https://www.agenciatributaria.es/AEAT.desarrolladores/Desarrolladores/_menu_/Documentacion/Sistemas_Informaticos_de_Facturacion_y_Sistemas_VERI_FACTU/Sistemas_Informaticos_de_Facturacion_y_Sistemas_VERI_FACTU.html>

## Why the checksums are here

They let a future reader tell "AEAT published a new revision" apart from "someone edited a
primary source to make a test pass". Those two look identical in a diff and have opposite
consequences. When AEAT does publish a revision, update the file, the date and the checksum in
one commit whose message says what changed.
```

Add to `.prettierignore`:

```
# AEAT's own published artefacts, committed verbatim. Prettier has no parser for
# .xsd or .wsdl and would skip them anyway, but a future parser addition must not
# be able to reformat a primary source.
packages/verifactu/schemas/
```

Append to `packages/verifactu/PROVENANCE.md`, after the "Implemented from" table:

```markdown
## Primary sources on disk

The XSDs and the WSDL listed above are committed verbatim in [`schemas/`](schemas/), with fetch
dates, source URLs and SHA-256 checksums in [`schemas/README.md`](schemas/README.md).

They were **lost once**, on 2026-07-20, along with a gitignored `.claude/worktrees/` checkout — the
second time material had been destroyed that way. Committing them makes the loss unrepeatable and
`src/schemas.test.ts` makes it loud: the suite fails if a file is missing, if its `targetNamespace`
stops matching the constant the serialiser emits, or if its content no longer matches the recorded
checksum.
```

- [ ] **Step 12: Guard the schemas with a test, and close plan 1's open namespace item**

Plan 1 shipped its namespace URIs transcribed from schema locations and flagged them explicitly as unverified, with a callout saying they must be checked against the local XSDs. There were no local XSDs. There are now, so the check becomes a test.

`packages/verifactu/src/schemas.test.ts` — a test file with no sibling source, following the `conformance.test.ts` precedent:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NS_LR, NS_LRC, NS_SF } from "./xml/serialize.js";

const SCHEMA_DIR = fileURLToPath(new URL("../schemas/", import.meta.url));

const NAMESPACED = [
  ["SuministroInformacion.xsd", NS_SF],
  ["SuministroLR.xsd", NS_LR],
  ["ConsultaLR.xsd", NS_LRC],
] as const;

const ALL_FILES = [
  "SuministroInformacion.xsd",
  "SuministroLR.xsd",
  "ConsultaLR.xsd",
  "RespuestaSuministro.xsd",
  "RespuestaConsultaLR.xsd",
  "SistemaFacturacion.wsdl",
] as const;

describe("committed AEAT primary sources", () => {
  it.each(ALL_FILES)("%s is present on disk", (file) => {
    // These were lost twice to gitignored worktree teardown. This assertion is
    // what makes a third loss fail CI instead of being discovered months later
    // by someone opening a task step that says "verify against the XSD".
    expect(() => readFileSync(SCHEMA_DIR + file)).not.toThrow();
  });

  it.each(NAMESPACED)("%s declares the targetNamespace the serialiser emits", (file, ns) => {
    // Plan 1 flagged these URIs as transcribed rather than verified. A wrong
    // namespace produces a SOAP fault rather than a validation error, which is
    // tedious to diagnose from the response and would reject every submission.
    const xsd = readFileSync(SCHEMA_DIR + file, "utf8");
    expect(/targetNamespace\s*=\s*"([^"]+)"/.exec(xsd)?.[1]).toBe(ns);
  });

  it.each(ALL_FILES)("%s matches the checksum recorded in README.md", (file) => {
    // Distinguishes "AEAT published a revision" from "someone edited a primary
    // source to make a test pass". Both look identical in a diff.
    const readme = readFileSync(SCHEMA_DIR + "README.md", "utf8");
    const sha = createHash("sha256").update(readFileSync(SCHEMA_DIR + file)).digest("hex");
    expect(readme).toContain(sha);
  });
});
```

> `NS_SF`, `NS_LR` and `NS_LRC` are currently module-private constants in `packages/verifactu/src/xml/serialize.ts`. **Resolve this when implementing: export them from `serialize.ts` and import them here. Do not re-declare them in the test — a duplicated constant that can drift means this test would eventually certify its own copy rather than the one the serialiser emits, which is the whole failure mode it exists to prevent.**

```bash
cd packages/verifactu && pnpm vitest run src/schemas.test.ts
```

Expected: PASS, 15 tests.

- [ ] **Step 13: Teeth check on the schema guard**

```bash
mv packages/verifactu/schemas/ConsultaLR.xsd /tmp/
cd packages/verifactu && pnpm vitest run src/schemas.test.ts
```

Expected: FAIL — `ConsultaLR.xsd is present on disk`, `ConsultaLR.xsd declares the targetNamespace the serialiser emits`, and `ConsultaLR.xsd matches the checksum recorded in README.md`. Restore the file.

Now append a single space to the end of `SuministroLR.xsd`:

Expected: FAIL — `SuministroLR.xsd matches the checksum recorded in README.md`, and **only** that one. If the namespace test also fails, the regex is reading position-dependently and should be fixed; if the checksum test passes, the checksum in `README.md` is not the one being compared and the whole guard is decorative.

Finally, change one character of `NS_LRC` in `serialize.ts`:

Expected: FAIL — `ConsultaLR.xsd declares the targetNamespace the serialiser emits`. Restore it. This is the mutation that proves plan 1's open item is genuinely closed rather than merely documented as closed.

- [ ] **Step 14: Run the full suite and commit**

```bash
pnpm typecheck && pnpm test && pnpm lint && ./node_modules/.bin/prettier --check .
```

Expected: all four pass. If `format:check` fails on the generated `incidents` migration, the `drizzle/` entry in `.prettierignore` does not cover the new folder — add it rather than reformatting generated SQL, which drizzle-kit will overwrite on the next `generate`.

```bash
git add packages/db/src/schema/incidents.ts packages/db/drizzle packages/db/src/index.ts \
        packages/core/src/incidents.ts packages/core/src/incidents.test.ts \
        packages/core/src/record-sale.ts packages/core/src/record-void.ts \
        packages/core/src/index.ts packages/shared/src/errors.ts \
        packages/fiscal-verifactu/src/write-path.e2e.test.ts \
        packages/verifactu/schemas packages/verifactu/src/schemas.test.ts \
        packages/verifactu/src/xml/serialize.ts packages/verifactu/PROVENANCE.md \
        .prettierignore .github/instructions/waitron.instructions.md \
        docs/superpowers/specs/2026-07-18-pos-architecture-design.md
git commit -m "feat(core): fiscal incidents, and the corrections this plan owed

Chain-verification failures and clock degradation are now rows the till can
read, recorded in the same transaction as the sale they accompany so an
incident can never exist for a sale that rolled back. Nothing blocks a sale:
a chain failure is recorded at error severity and the record is chained
anyway, a degraded clock warns only, and the AEAT-side conditions have no
effect at all — asserted not by simulating an outage but by constructing the
backend with a fetch that throws and proving it is never called.

incidents is the one table the application role may UPDATE, and only via a
column-level GRANT on the two acknowledgement columns; the teeth check
widens that grant and confirms a test screams. In non-Veri*Factu mode a
detected chain error would additionally belong in the registro de eventos
(arts. 7.j, 9.1.d). We build Veri*Factu mode only, where that log is not
required, but the incident is recorded internally regardless, because staff
and support need it and a later mode switch must find the data already
being captured.

Also corrects three documents. Architecture §4 still specified SQLite, a
'Vitest + pglite' test row and a dual-database-risk subsection promising a
fiscal suite against both dialects — exactly wrong since the PGlite
decision; the history is marked superseded rather than deleted, because
knowing which assumption broke is worth more than a document that reads as
though it were always right. The instructions file still described
packages/verifactu as not yet created, stale since 7938e1b, and gains
sections on the module vocabulary boundary and on the two ways a database
test here passes while asserting nothing.

And it re-commits AEAT's XSDs and WSDL, lost with a gitignored worktree —
the second time material had gone that way. A guard test asserts each file
is present, that its targetNamespace matches the constant the serialiser
emits, and that its content matches a recorded checksum, which closes plan
1's open item that those URIs were transcribed rather than verified and
makes a third loss loud rather than silent."
```

---

## Self-Review

**Spec coverage.** Every element of the spec maps to a task.

§2's vocabulary boundary is Task 3 (English-only) plus Task 11's separate regime-vocabulary guard —
two guards because regime words written in English defeat the first one. §2's migration composition
is Task 12. §3: tenancy and RLS (4), the PGlite decision (1, 2), immutability (5), series (6), the
mutable/immutable table split (7, 8), module-owned tables (12), till registration and never-reused
installation numbers (13), the chain head (12, 14). §4's seven steps: lock and append (14), art. 7.i
(15), the transaction itself (16), corrections (17), and "nothing stops selling" (18). §6's
interface is Task 11, its `fiscal_backend`/`fiscal_state` columns Task 8. §8's clock is Task 10.
§9: `invoice_locales` (4), per-line `descriptions` (7), issuance-time locale snapshotting (8),
structured errors and exact money (9). §10's gates run throughout — the dual-target harness (2),
the mandatory `app_user` role in every RLS test (4), the real-Postgres concurrency suite (14), and
a teeth check in all 18 tasks.

**Deliberately out of scope**, each belonging to plan 3 or a later sub-project: the outbox drainer,
batching and flow control, retry scheduling, CSV persistence, error-3000 resolution,
`Incidencia="S"`, acks and reconciliation sweeps (all plan 3 — the `envios` table is created here
and written as `pendiente`, but nothing drains it); the catalogue; `apps/*`; payments beyond the
`tenders` record of what settled; and roles, which gate voiding in Task 17 through a seam this plan
defines but does not fill.

**Spec and architecture defects this plan found, which Task 18 corrects.** These are not editorial
— each would mislead an implementer who trusted the document:

1. **"A crash before commit burns an invoice number"** (spec §3 and §4). False with a `next_number`
   column: the allocating `UPDATE` is transactional, so a rollback returns the number. Burning would
   need a non-transactional `SEQUENCE`. The regulation requires strictly-increasing and never-reused
   and merely *permits* gaps, so the implementation is right and the prose is wrong.
2. **"Alter a desglose → the huella must change"** (spec §10's teeth checks). False.
   `buildCadenaAlta` hashes eight fields and `Desglose` is not among them. Anyone following this
   instruction writes a test that cannot fail. Should read "alter a total".
3. **`verifyHuella(record, expected)`** (spec §5). The shipped function takes one argument and
   compares internally. Stale against `7938e1b`.
4. **"Enforced by trigger in both dialects"** (spec §3). There is one dialect; §3's own PGlite
   section is what removed the second.
5. **Architecture §4 still specifies SQLite** — the `DB (standalone)` row, the `ORM | Drizzle |
   Targets both dialects` row, and an entire "Dual database risk" subsection instructing that the
   fiscal suite run against both SQLite and Postgres in CI from the first commit.
6. **Architecture §6's heading says "one series per till"**, contradicting its own body two
   paragraphs later and findings §1.

**Known gaps, stated rather than hidden:**

1. **The Drizzle supertype casts in Task 2 are unverified.** Whether `PgliteDatabase` and
   `NodePgDatabase` are assignable to `PgDatabase` under `drizzle-orm@0.45.2` depends on the HKT
   parameter's variance. Flagged inline with a gate to delete them if unnecessary and a hard rule
   confining them to the two construction sites.
2. **Task 1's benchmark predates art. 7.i in the write path**, so its per-sale figure understates
   the real cost. Flagged inline in Task 15 with a mandated re-run after Task 17.
3. **Three of the six AEAT schema URLs could not be determined** from anything in this repo.
   `SuministroInformacion.xsd`, `SuministroLR.xsd` and `ConsultaLR.xsd` are recoverable from the
   `targetNamespace` constants committed in plan 1; `RespuestaSuministro.xsd`,
   `RespuestaConsultaLR.xsd` and `SistemaFacturacion.wsdl` are named in `PROVENANCE.md` with no URL.
   Task 18 forbids guessing them — a schema fetched from a plausible-but-wrong URL is worse than a
   missing one, because the next reader verifies against it.
4. **`packages/verifactu`'s `formatAmount` takes a JS number**, so exact decimals converted to
   binary64 at the last hop into the huella. The package cannot import `@waitron/shared` without
   breaking its zero-dependency boundary. Mitigated by rounding in BigInt space before the call,
   using the identical half-away-from-zero policy. **Plan 3 should add `formatAmountExact(value:
   string)` and deprecate the numeric entry point** — this is the same defect class as the one-cent
   divergence plan 1's final review caught.
5. **After a PWA reload, a forward wall-clock jump is indistinguishable from time genuinely having
   passed.** The monotonic reference is gone and `performance.timeOrigin` derives from the wall
   clock, so there is no independent witness; only a backwards jump is provable. Accepted rather
   than patched, because a plausibility heuristic needs a threshold and a threshold here is exactly
   what findings §4 forbids.
6. **`checkIntegrity` and `pendingCount` take `(tx, tillId)` and source the tenant ambiently from
   the RLS session variable.** In the standalone deployment PGlite connects as superuser and
   bypasses RLS entirely, so the ambient tenant is not enforced there. Safe only because standalone
   is single-tenant — the same reasoning already recorded for `withTenant`, and the same reason
   `asAppUser` is non-negotiable in tests.
7. **Whether `packages/db` can afford a per-PR mutation gate is unresolved by design.** The
   handoff's rule — that pure-Node packages can afford what `packages/verifactu` has — treats
   browser-vs-Node as the variable when the real variable is per-test setup cost, and every test
   here boots a WASM Postgres. Task 1 measures it; the default is the weekly model.
8. **Nothing owns migration ordering across packages at runtime.** Task 12 pins the failure to a
   clear error at migrate time rather than a missing table at first write, but the mechanism that
   guarantees core runs before module still needs an owner in a later plan.

---

## Execution errata

This plan is the EXECUTED plan — a historical artifact of what was asked, task by task. Its task
bodies are frozen prose and are not rewritten here, even where execution found their illustrative
code wrong: rewriting fifteen thousand lines of already-completed instructions would erase the
record of what was actually specified, and a later reader diffing this plan against its own
handoffs deserves to see the original. This section exists so that anyone who ever re-runs a task
from this plan — against a fresh checkout, in a different order, or as a template for a similar
plan — is warned about the specific defects execution found in the plan's OWN drafted code, not
in the regulation or the architecture it implements.

- **Task 2 (Critical, two defects in the harness draft).** Both are in `packages/db/src/testing/
  harness.ts`'s illustrative code and would reintroduce real bugs if re-run verbatim:
  - The postgres target's `create()` drafted `await admin.execute({ sql: \`create database
    ${name}\`, params: [] } as never)`. This throws a `TypeError` at runtime — `Database["execute"]`
    takes a `SQL` query object (drizzle's own tagged-template type) or a raw string, never a
    `{ sql, params }` record, and the `as never` cast only hides the mismatch from the compiler.
    The shipped fix, verified in `packages/db/src/testing/harness.ts` today, is
    `admin.execute(sql.raw(\`create database ${name}\`))`.
  - The harness draft imported `CORE_MIGRATIONS` from `../migrate.js` (`import { CORE_MIGRATIONS }
    from "../migrate.js";`) — that module never exported any such symbol (`packages/db/src/migrate.
    ts` exports only `runMigrations`/`MigrationOptions`, per `packages/db/src/index.ts`'s own
    export list). The shipped `harness.ts` instead defines its own private `CORE_MIGRATIONS`
    constant, computed from `import.meta.dirname` and pointing at the package's real `../../drizzle`
    folder; the PUBLIC `CORE_MIGRATIONS` a module package composes against lives on
    `packages/db/src/index.ts` instead, computed the same way. Neither location is `migrate.js`.
- **Task 12 (Critical).** The plan's own Task 12 code declared `cuota_total`/`importe_total` as
  `numeric(12, 2)` (`cuotaTotal: numeric("cuota_total", { precision: 12, scale: 2 })` and the
  equivalent for `importeTotal`) — this CONTRADICTS the plan's own Global Constraints section
  (above, "Nothing formatted is ever stored — in the generic layer"), which already states these
  columns must be `text`: the huella hashes the exact literal that was serialised, and `numeric`
  both re-renders on read (turning "123.1" and "123.10" into the same stored value, when the
  huella must distinguish them) and is too narrow for an 11–12 integer-digit AEAT-legal amount.
  The shipped `packages/fiscal-verifactu/src/schema/registros.ts` correctly declares both as
  `text`. A re-run of Task 12 that copied its own illustrative code literally would ship a
  regression its own plan-level constraints already forbid.
- **`VerifactuBackend` gap.** The File Structure section (near the top of this plan) names
  `packages/fiscal-verifactu/src/backend.ts VerifactuBackend implements FiscalBackend`, but no
  task step from 1 through 15 builds it — it does not appear as a deliverable of Task 12, 13, 14 or
  15. It was built as part of Task 16, by project-owner decision, wiring together the pieces Tasks
  12–15 had already shipped. Noted here so the File Structure section matches what actually
  happened rather than implying an earlier task delivered it.
- **The `.rejects.toThrow(/pg message/)` pattern**, used across many of this plan's task bodies to
  assert a Postgres error's text, does not work in this repo and never did: drizzle-orm@0.45.2
  wraps every failed query in a `DrizzleQueryError` whose own `.message` is `Failed query: <sql>
  \nparams: <params>` — the real Postgres text lives on `.cause.message`, which `Error.prototype.
  toThrow`'s pattern matching never inspects. Every already-shipped test in this codebase instead
  uses `captureError`/`pgErrorCode`/`pgErrorMessage` (`packages/db/src/testing/errors.ts`, Task 5).
  Noted once here rather than annotated at each of the many task bodies that drafted the pattern.
- **Task 4: two teeth-check mutations are inert on PostgreSQL 18**, discovered performing the
  task's own Step 8/9 red-phase verification:
  - Temporarily dropping `WITH CHECK` from a `FOR ALL` policy (leaving only `USING`) does not
    make `rejects an insert carrying another tenant's id` fail: PostgreSQL defaults a `FOR ALL`
    policy's `WITH CHECK` to its own `USING` expression when `WITH CHECK` is omitted, so the
    policy stays enforced under this specific mutation. The teeth check as drafted does not bite;
    a mutation that genuinely disables the write-side check (e.g. `WITH CHECK (true)`) does.
  - Temporarily removing `nullif(current_setting('app.tenant_id', true), '')` alone does not make
    `returns no rows for an empty tenant id rather than raising` fail, because an empty string
    cast to `uuid` (`''::uuid`) raises `invalid_text_representation` — the identical SQLSTATE class
    the `EXCEPTION WHEN invalid_text_representation` handler (tested by the mutation immediately
    before this one in the same Step 8) already catches. `nullif` therefore has NO independently
    observable behaviour of its own under this suite: removing it is caught only because a
    DIFFERENT, earlier-tested guard happens to catch the same failure mode. Keep `nullif` anyway
    — it avoids a plpgsql exception (and the subtransaction cost that comes with catching one) on
    the ordinary empty-string case — but do not treat it as separately load-bearing the way this
    plan's Step 8 implies.
- **Task 13/14 error codes.** The plan drafted `SIF_NOT_REGISTERED` (SCREAMING_SNAKE_CASE,
  appended directly to `packages/shared/src/errors.ts`'s `ErrorCode` union) and `ErrorCode.
  FISCAL_CHAIN_APPEND_CONTENTION` (an enum-style reference, same location) for Tasks 13 and 14
  respectively. Both forms are wrong under this repo's own documented augmentation convention
  (`packages/shared/src/errors.ts`'s design note: only codes native to `packages/shared` itself
  belong in that file; every dependent package contributes its own via `declare module
  "@waitron/shared"`) and under its naming convention (domain-concept, lowercase, dot-namespaced —
  never SCREAMING_SNAKE_CASE, never the throwing package's name). The shipped codes are
  `sif.not_registered` (`packages/fiscal-verifactu/src/registro-sif.ts`) and
  `chain.append_contention` (`packages/fiscal-verifactu/src/chain.ts`), each documented at its own
  `declare module` site with the reasoning for the deviation recorded inline.
- **Task 15.** The plan's own Step 5 illustrative code for `predecessor-link-mismatch` assigns
  `params: { expected: previous.encadenamiento_huella ?? "", found: beforePrevious.huella }` —
  `expected` is n−1's own stored (unverified) predecessor pointer, `found` is n−2's actual huella.
  This is backwards from the plan's OWN Step 2 test, `carries the expected and found values on a
  link failure`, which corrupts n−2's stored `huella` to a bogus value and then asserts
  `link.params.expected` equals that bogus value and `link.params.found` equals n−1's original,
  uncorrupted pointer — i.e. `expected` is the actual (possibly tampered) value at the position
  being checked, and `found` is what the predecessor's own link claims. The shipped
  `packages/fiscal-verifactu/src/verify.ts` follows the TEST's convention (`expected:
  beforePrevious.huella, found: previous.anterior_huella`), not Step 5's prose. The test is
  authoritative; a re-run of Task 15 that implemented Step 5's illustrative code literally would
  fail its own Step 2 red-phase test immediately.
- **Task 16 draft was stale against the real `FiscalBackend`/`FakeFiscalBackend` surface.** The
  brief's illustrative code assumed a no-argument `new FakeFiscalBackend()` (the real constructor
  takes `db: Database`), a `.calls` spy property (does not exist — the real test-only surface is
  `breakIntegrity`/`restoreIntegrity`/`recordsFor`/`acknowledge`), a settable
  `backend.chainVerification` field (the real control is `breakIntegrity(tillId, issue)`, taking a
  plain `IntegrityIssue`), and `.hash`/`.sequence`/`.qrPayload` fields on `FiscalRecordRef` (the
  real interface has none of these — only `backend`, `recordId`, `state`, `issuedAt`,
  `offsetMinutes`, `verificationUrl?`). Roughly 22 corrections were needed across Task 16's test
  and implementation bodies to reconcile the draft with the surface Tasks 11 and 12–15 had
  actually shipped by the time Task 16 ran; each is recorded as its own "Deviation from the brief"
  comment in the committed source (`packages/core/src/record-sale.test.ts`,
  `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and neighbours) rather than repeated here.
