# Payment layer 4a — neutral seam + online happy path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `packages/payments` — the provider-neutral payment seam — with the online happy path (`collect`/`void`/`refund`/`partialRefund`) proven end-to-end through a `FakePaymentProvider` into `recordSale`, including the `sale_id` associate-back linkage.

**Architecture:** A new generic English-only package `packages/payments` mirroring the `packages/fiscal` split: a provider-neutral `PaymentProvider` interface + `PaymentResult`/`PaymentState` types, a durable payment-lifecycle store over its own module-owned tables (`payments`, `payment_refunds`), and a DB-backed `FakePaymentProvider` test double. Payment is upstream of `recordSale`: a provider yields a settled tender, `recordSale` chains the sale, and the payment row is associated with the committed sale in the **same** transaction. Core stays entirely ignorant of payments (the FK points module→core, exactly as `registros_facturacion.sale_id` does).

**Tech Stack:** TypeScript (ESM, `"type": "module"`), Drizzle ORM (`drizzle-orm` `^0.45.2`, `drizzle-kit` `^0.31.10`, `pg-core` dialect), Vitest, PGlite for ordinary tests + Testcontainers PostgreSQL for RLS-behavioural tests, exact-decimal money via `@waitron/shared`'s `Decimal`.

## Global Constraints

- **English-only + regime/provider-neutral.** `packages/payments` joins `GENERIC_PACKAGES`; the Spanish-word guard (`packages/db/src/english-only.ts`) applies, and a new `no-provider-vocabulary.test.ts` bans `stripe`/`paymentintent`/`reader`/etc. from the seam. No Spanish identifiers; no provider vocabulary in the neutral package.
- **Exact decimals only** — all money columns are `numeric(12, 2)`; no float ever touches the money path. Amounts cross the interface as `@waitron/shared`'s branded `Decimal` string.
- **T1/T2 discipline** — never hold a DB transaction across a network call. The provider does its own short-transaction bookkeeping; provider methods take **no** `tx` parameter (the deliberate opposite of `FiscalBackend.recordSale(tx, …)`).
- **Dependency direction is module→core.** Payment schema files `import` core tables (`workingOrders`, `sales`) to declare FKs but **never** re-export them (`schema-ownership.test.ts` enforces it). Core never imports `@waitron/payments`. `@waitron/core` is a **dev**-only dependency of this package, for the end-to-end wiring test.
- **RLS + least privilege** — every table `.enableRLS()`, tenant-scoped via `current_tenant_id()`; grants are `SELECT, INSERT, UPDATE` only (no DELETE); RLS behaviour is proven under a **real non-superuser Postgres role**, never PGlite (whose superuser bypasses RLS + privileges).
- **Coverage thresholds** (vitest, cloned from `fiscal-verifactu`): statements/lines/functions ≥ 98, branches ≥ 95. `src/testing/**`, `drizzle/**`, `drizzle.config.ts` excluded from coverage.
- **`git add` only the task's explicit paths** — never `-A`/`.`. Leave any unrelated working-tree changes alone.
- **Migration authorship split** — table migrations are **generated** by `drizzle-kit generate` (never hand-written); the RLS/policy/grant migration is **hand-written** (drizzle-kit does not model policies or privileges).

**Scope note — what is deliberately NOT in 4a** (arrives with its own caller/fake/tests in later plans, per the design's incremental discipline): `payment_policy` table, the `offline`/`accepted_offline`/`settled`/`declined`/`forwarded` states, `PaymentResult.offline`, `reconcile_remediated_at`, `forward()`, `reconcile()`, `authorize`/`capture`/`preAuth`/`incrementalAuth`/`tipAdjust`, and the real Stripe adapter. Do not add them here.

---

## File Structure

**New package `packages/payments/`:**

- `package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts` — scaffold (clones of `fiscal-verifactu`'s, renamed).
- `src/index.ts` — the public barrel (re-exports only).
- `src/provider.ts` — `PaymentProvider` interface + `PaymentResult`/`PaymentState`/`CollectParams`/`ProviderCapabilities` types; side-effect `import "./errors.js"`.
- `src/errors.ts` — `payment.*` code registrations via `declare module "@waitron/shared"`.
- `src/store.ts` — the payment-lifecycle store: `createPayment`, `recordCapture`, `recordFailure`, `recordVoid`, `recordRefund`, `associatePaymentWithSale`, `getPaymentByRef`.
- `src/migrations.ts` — `PAYMENTS_MIGRATIONS` descriptor.
- `src/schema/index.ts` — schema barrel (explicit exports; never a core table).
- `src/schema/payments.ts` — `payments` table + `paymentState` enum.
- `src/schema/payment-refunds.ts` — `payment_refunds` table + `paymentRefundState` enum.
- `src/testing/fake-provider.ts` — `FakePaymentProvider` (DB-backed test double; NOT barrel-exported).
- `src/testing/postgres.ts` — real-Postgres harness (clone of `fiscal-verifactu`'s, runs CORE + PAYMENTS migrations).
- `test/seed.ts` — test seed helper (tenant→location→till→working_order), for FK satisfaction.
- `drizzle/0000_payments.sql` — **generated** table migration.
- `drizzle/0001_payments_rls.sql` — **hand-written** RLS + grants migration.
- Test files: `src/no-provider-vocabulary.test.ts`, `src/errors.reachability.test.ts`, `src/provider.test.ts`, `src/schema-ownership.test.ts`, `src/monetary-columns.test.ts`, `src/store.test.ts`, `src/testing/fake-provider.test.ts`, `src/payments.rls.test.ts`, `src/migrations.test.ts`, `src/wiring.test.ts`.

**Modified in `packages/db/`:**

- `src/english-only.ts` — add `"payments"` to `GENERIC_PACKAGES`.
- `src/english-only.test.ts` — update the two assertions that pin `GENERIC_PACKAGES`.

---

### Task 1: Scaffold `packages/payments` and register it as a generic package

**Files:**
- Create: `packages/payments/package.json`, `packages/payments/tsconfig.json`, `packages/payments/vitest.config.ts`, `packages/payments/drizzle.config.ts`, `packages/payments/src/index.ts`
- Modify: `packages/db/src/english-only.ts`, `packages/db/src/english-only.test.ts`

**Interfaces:**
- Produces: the `@waitron/payments` package (empty barrel) and its place in `GENERIC_PACKAGES`. Nothing else consumes it yet.

- [ ] **Step 1: Update the failing guard assertions first (RED via an existing test).**

In `packages/db/src/english-only.test.ts`, change the two assertions that pin the list:

```ts
  it("scopes itself to the five generic packages", () => {
    expect([...GENERIC_PACKAGES]).toEqual(["db", "core", "fiscal", "shared", "payments"]);
  });
```

(and in the "exempts the two Spanish packages" test, the `GENERIC_PACKAGES.not.toContain(name)` loop is unchanged — it still passes.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/db test english-only`
Expected: FAIL — `GENERIC_PACKAGES` is still `["db","core","fiscal","shared"]`.

- [ ] **Step 3: Add `"payments"` to `GENERIC_PACKAGES`**

In `packages/db/src/english-only.ts`:

```ts
/** English throughout — identifiers and table/column names alike (spec §2). */
export const GENERIC_PACKAGES = ["db", "core", "fiscal", "shared", "payments"] as const;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @waitron/db test english-only`
Expected: PASS. (`sourceFilesIn("payments")` returns `[]` until the package has `src/*.ts`, so no Spanish scan fails yet.)

- [ ] **Step 5: Create the scaffold files.**

`packages/payments/package.json` (clone of `fiscal-verifactu`'s, renamed; drop the `@waitron/verifactu` dep, add `@waitron/core` as a **dev** dependency for the wiring test):

```json
{
  "name": "@waitron/payments",
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
    "db:generate": "drizzle-kit generate",
    "db:generate:custom": "drizzle-kit generate --custom"
  },
  "dependencies": {
    "@waitron/db": "workspace:*",
    "@waitron/shared": "workspace:*",
    "drizzle-orm": "^0.45.2"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.5.4",
    "@testcontainers/postgresql": "^12.0.4",
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "@waitron/core": "workspace:*",
    "drizzle-kit": "^0.31.10",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/payments/tsconfig.json` — **identical** to `packages/fiscal-verifactu/tsconfig.json`:

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

`packages/payments/vitest.config.ts` — **identical** to `packages/fiscal-verifactu/vitest.config.ts` (same thresholds 98/98/98/95, same `coverage.exclude` of `drizzle.config.ts`/`drizzle/**`/`src/testing/**`, same `testTimeout: 120_000` / `hookTimeout: 180_000`, same `.stryker-tmp` exclude). Copy it verbatim.

`packages/payments/drizzle.config.ts` — clone of `fiscal-verifactu`'s, with the journal table renamed:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/schema/index.ts",
  migrations: { table: "__drizzle_migrations_payments", schema: "public" },
});
```

`packages/payments/src/index.ts` (temporary empty barrel; filled by later tasks):

```ts
// The entire public surface of @waitron/payments. Re-exports only — no logic here.
export {};
```

- [ ] **Step 6: Install and typecheck.**

Run: `pnpm install` (registers the new workspace package), then `pnpm --filter @waitron/payments typecheck`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add packages/payments/package.json packages/payments/tsconfig.json packages/payments/vitest.config.ts packages/payments/drizzle.config.ts packages/payments/src/index.ts packages/db/src/english-only.ts packages/db/src/english-only.test.ts pnpm-lock.yaml
git commit -m "feat(payments): scaffold @waitron/payments as a generic package"
```

---

### Task 2: The `no-provider-vocabulary` guard

**Files:**
- Create: `packages/payments/src/no-provider-vocabulary.test.ts`

**Interfaces:**
- Produces: a mechanical guard that fails CI if provider/SDK vocabulary appears as an identifier anywhere in `packages/payments/src` (comments excepted).

- [ ] **Step 1: Write the guard test** (structural clone of `packages/fiscal/src/no-regime-vocabulary.test.ts` — copy that file verbatim, then change only: the `ImportMeta.glob` comment reference, the "discovers" sanity check to name this package's real files, and the `FORBIDDEN` list). Full file:

```ts
import { describe, expect, it } from "vitest";

declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const sources = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("the source glob itself", () => {
  it("discovers provider.ts, store.ts and the fake", () => {
    const names = Object.keys(sources);
    expect(names.some((n) => n.endsWith("provider.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith("store.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith("fake-provider.ts"))).toBe(true);
  });
});

function stripComments(source: string): string {
  const blockBlanked = source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
  return blockBlanked
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

const strippedSources: Record<string, string> = Object.fromEntries(
  Object.entries(sources).map(([path, source]) => [path, stripComments(source)]),
);

function mentionsTerm(source: string, term: string): boolean {
  const capitalised = term.charAt(0).toUpperCase() + term.slice(1);
  const wholeWord = new RegExp(`\\b${term}`, "i");
  return (
    wholeWord.test(source) || source.includes(capitalised) || source.includes(term.toUpperCase())
  );
}

// Provider/SDK vocabulary. A second provider (Adyen, SumUp) brings its own names and its own
// tables and must touch nothing in this neutral package; a term here naming a Stripe/terminal
// concept has leaked across the boundary this guard exists to hold.
const FORBIDDEN = [
  "stripe",
  "adyen",
  "sumup",
  "paymentintent",
  "readerid",
  "reader",
  "terminal",
  "connectiontoken",
  "acquirer",
];

describe("no provider vocabulary appears in packages/payments", () => {
  for (const term of FORBIDDEN) {
    it.each(Object.entries(strippedSources))(`%s does not mention "${term}"`, (_path, source) => {
      expect(mentionsTerm(source, term)).toBe(false);
    });
  }
});

describe("the guard has teeth", () => {
  it("rejects a Stripe identifier", () => {
    expect(mentionsTerm("const stripeClient = makeClient();", "stripe")).toBe(true);
    expect(mentionsTerm("createPaymentIntent(amount)", "paymentintent")).toBe(true);
  });

  it("does not reject ordinary prose that merely ends in the same letters", () => {
    expect(mentionsTerm("the terminal state of the payment", "terminal")).toBe(true);
    expect(mentionsTerm("this is the final settled amount", "terminal")).toBe(false);
  });

  it("blanks a comment mention so it is not counted", () => {
    const source = "/**\n * The Stripe adapter lives in packages/payments-stripe.\n */\nexport const x = 1;";
    expect(mentionsTerm(stripComments(source), "stripe")).toBe(false);
  });
});
```

Note: `"terminal"` is on the FORBIDDEN list; the phrase "terminal state" in prose is fine because prose lives in comments (stripped) — but be careful not to name an identifier `terminalState`. Use `state` / `finalState` in code.

- [ ] **Step 2: Run it — expect a controlled fail** (the "discovers" sanity check fails until `provider.ts`/`store.ts`/`fake-provider.ts` exist).

Run: `pnpm --filter @waitron/payments test no-provider-vocabulary`
Expected: FAIL on the "discovers" test (files not created yet). This is expected; the guard goes green once Tasks 4/6/8 create those files. The teeth tests pass now.

- [ ] **Step 3: Commit**

```bash
git add packages/payments/src/no-provider-vocabulary.test.ts
git commit -m "test(payments): add no-provider-vocabulary guard"
```

---

### Task 3: `payment.*` error codes

**Files:**
- Create: `packages/payments/src/errors.ts`, `packages/payments/src/errors.reachability.test.ts`

**Interfaces:**
- Produces: `payment.not_found`, `payment.refund_exceeds_capture`, `payment.not_voidable` on the shared `ErrorParams` registry — thrown by the store/fake in later tasks.

- [ ] **Step 1: Write the reachability test** (clone of `packages/core/src/errors.reachability.test.ts` — copy verbatim, changing only the package name in messages and the barrel path it imports). It asserts `./errors.js` is transitively reachable from `./index.js`. Read `packages/core/src/errors.reachability.test.ts` and reproduce its structure against `../src/index.js`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/payments test errors.reachability`
Expected: FAIL — `./errors.js` does not exist / is not reachable from the barrel yet.

- [ ] **Step 3: Write `errors.ts`**

```ts
// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared"
// as a real module to augment rather than declaring a fresh ambient one — the same idiom
// packages/core/src/errors.ts and packages/fiscal/src/errors.ts use for their own contributions.
import "@waitron/shared";

/**
 * packages/payments's contribution to the shared error registry, by declaration merging — the
 * DOMAIN-CONCEPT, lowercase, dot-namespaced convention (`payment.*`), never the package name.
 * packages/shared must never change just because a dependent package adds a code; this is how
 * packages/payments adds its own without packages/shared knowing in advance.
 *
 * Reachability: `./provider.ts` does `import "./errors.js"`, and `./index.ts` re-exports
 * `./provider.ts`, so this augmentation is reachable from the public barrel — see
 * `./errors.reachability.test.ts`.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** Thrown by the store / a provider when `paymentRef` names no `payments` row for this tenant
     * and provider — either it never existed, or RLS hid another tenant's row (identical from
     * here). */
    "payment.not_found": { provider: string; paymentRef: string };
    /** Thrown when a refund (or the running total of refunds) would exceed the captured amount. */
    "payment.refund_exceeds_capture": {
      paymentRef: string;
      captured: string;
      requested: string;
      alreadyRefunded: string;
    };
    /** Thrown by `void` when the payment is not in a voidable state (a capture cannot be voided —
     * it must be refunded instead). */
    "payment.not_voidable": { paymentRef: string; state: string };
  }
}
```

- [ ] **Step 4: Add the side-effect import to the barrel** so the reachability test can pass once `provider.ts` exists. For now, add it directly to `src/index.ts`:

```ts
// The entire public surface of @waitron/payments. Re-exports only — no logic here.
import "./errors.js";
export {};
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @waitron/payments test errors.reachability`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/payments/src/errors.ts packages/payments/src/errors.reachability.test.ts packages/payments/src/index.ts
git commit -m "feat(payments): register payment.* error codes"
```

---

### Task 4: The `PaymentProvider` interface + types

**Files:**
- Create: `packages/payments/src/provider.ts`, `packages/payments/src/provider.test.ts`
- Modify: `packages/payments/src/index.ts`

**Interfaces:**
- Produces:
  - `type PaymentState = "captured" | "voided" | "refunded" | "partially_refunded" | "failed"`
  - `interface ProviderCapabilities { partialRefund: boolean }`
  - `interface CollectParams { tenantId: TenantId; tillId: TillId; workingOrderId: WorkingOrderId; amount: Decimal }`
  - `interface PaymentResult { provider: string; paymentRef: string; state: PaymentState; amount: Decimal; settledAt: Date | null }`
  - `interface PaymentProvider { readonly provider: string; readonly capabilities: ProviderCapabilities; collect(p: CollectParams): Promise<PaymentResult>; void(ref: string): Promise<PaymentResult>; refund(ref: string): Promise<PaymentResult>; partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> }`

- [ ] **Step 1: Write a type-level test** (mirrors `packages/fiscal/src/backend.test.ts`'s "the fake satisfies the interface"/type-shape style). Since the fake does not exist yet, this test asserts the type shapes compile and a structural literal satisfies `PaymentResult`:

```ts
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import type { PaymentResult, PaymentState } from "./provider.js";

describe("PaymentResult shape", () => {
  it("accepts a captured online result", () => {
    const r: PaymentResult = {
      provider: "fake",
      paymentRef: "pay-1",
      state: "captured",
      amount: decimal("10.00"),
      settledAt: new Date("2026-07-22T10:00:00Z"),
    };
    expect(r.state satisfies PaymentState).toBe("captured");
    expect(r.settledAt).not.toBeNull();
  });

  it("accepts a failed result with no settlement", () => {
    const r: PaymentResult = {
      provider: "fake",
      paymentRef: "pay-2",
      state: "failed",
      amount: decimal("10.00"),
      settledAt: null,
    };
    expect(r.settledAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/payments test provider`
Expected: FAIL — `./provider.js` does not exist.

- [ ] **Step 3: Write `provider.ts`**

```ts
// Side-effect only: registers this package's `payment.*` codes on the shared `ErrorParams`
// registry (see ./errors.ts) and keeps errors.ts reachable from the public barrel
// (./errors.reachability.test.ts). Nothing in this file throws — it is types only; ./store.ts and
// ./testing/fake-provider.ts do the throwing — but this is the file the barrel re-exports, so it
// carries the side-effect import.
import "./errors.js";
import type { Decimal, TenantId, TillId, WorkingOrderId } from "@waitron/shared";

/**
 * The lifecycle of one electronic tender as this POS understands it, provider-neutral. 4a covers
 * the online single-message path only: `captured` is the terminal success state, `failed` a
 * network refusal, and `voided`/`refunded`/`partially_refunded` the reversals. The offline states
 * (`accepted_offline`, `settled`, …) and the two-phase states (`authorized`) arrive in later plans
 * with the methods that produce them — never reserved here as dead surface.
 */
export type PaymentState = "captured" | "voided" | "refunded" | "partially_refunded" | "failed";

/** What a given provider can do, so the app/UI can gate on it. Grows a flag per capability as the
 * methods that back them land — in 4a the only optional capability is partial refunds. */
export interface ProviderCapabilities {
  partialRefund: boolean;
}

export interface CollectParams {
  tenantId: TenantId;
  tillId: TillId;
  workingOrderId: WorkingOrderId;
  /** Exact decimal, tax-inclusive amount to take on this tender. Split tender is several
   * `collect` calls against one working order, each with its own amount. */
  amount: Decimal;
}

/**
 * The outcome of one provider operation, returned as DATA (never inside the caller's transaction —
 * see `PaymentProvider`). `settledAt` is what feeds `RecordSaleTender.settledAt`: non-null on a
 * `captured` result (the sale may then chain), null on `failed` (the tender stays unsettled and
 * `recordSale` refuses). `paymentRef` is this provider's opaque reference and the join key used to
 * associate the payment with the committed sale afterwards.
 */
export interface PaymentResult {
  provider: string;
  paymentRef: string;
  state: PaymentState;
  amount: Decimal;
  settledAt: Date | null;
}

/**
 * The only thing that crosses between the POS and a payment provider.
 *
 * No method takes a transaction handle — the deliberate opposite of `FiscalBackend.recordSale(tx)`.
 * Every method here makes a network call to the terminal, and holding a DB transaction across a
 * network call is forbidden (T1/T2). Each method does its own short-transaction bookkeeping
 * internally and returns a `PaymentResult`; the caller passes that into `recordSale` as data.
 *
 * Card is the subject. Cash needs no provider (it is recorded directly as a settled tender), so it
 * is deliberately absent. Split tender is N `collect` calls, not a method. `authorize`/`capture`/
 * `preAuth`/`incrementalAuth`/`tipAdjust`/`forward`/`reconcile` are later plans — do not add them
 * here before their design and their fake exist.
 */
export interface PaymentProvider {
  readonly provider: string;
  readonly capabilities: ProviderCapabilities;

  /** Single-message card-present purchase (authorize + capture). Returns `captured` on success,
   * `failed` on a network refusal. */
  collect(params: CollectParams): Promise<PaymentResult>;

  /** Cancel a payment that has not been captured. Throws `payment.not_voidable` if it has. */
  void(ref: string): Promise<PaymentResult>;

  /** Return the full captured amount. */
  refund(ref: string): Promise<PaymentResult>;

  /** Return part of the captured amount. Throws `payment.refund_exceeds_capture` if the running
   * total of refunds would exceed what was captured. */
  partialRefund(ref: string, amount: Decimal): Promise<PaymentResult>;
}
```

- [ ] **Step 4: Wire the barrel** — `src/index.ts`:

```ts
// The entire public surface of @waitron/payments. Re-exports only — no logic here.
export type {
  CollectParams,
  PaymentProvider,
  PaymentResult,
  PaymentState,
  ProviderCapabilities,
} from "./provider.js";
// The fake is NOT re-exported here — packages that need it import it from
// "@waitron/payments/src/testing/fake-provider.js" in test files only, so a production import of
// the package surface cannot reach a test double by autocomplete (mirrors packages/fiscal).
```

(The side-effect `import "./errors.js"` now travels via `provider.ts`; drop the direct one from the barrel.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @waitron/payments test provider errors.reachability`
Expected: PASS (both).

- [ ] **Step 6: Commit**

```bash
git add packages/payments/src/provider.ts packages/payments/src/provider.test.ts packages/payments/src/index.ts
git commit -m "feat(payments): PaymentProvider interface and result types"
```

---

### Task 5: The module schema (`payments`, `payment_refunds`) + generated migration

**Files:**
- Create: `packages/payments/src/schema/payments.ts`, `packages/payments/src/schema/payment-refunds.ts`, `packages/payments/src/schema/index.ts`, `packages/payments/src/schema-ownership.test.ts`, `packages/payments/src/monetary-columns.test.ts`
- Create (generated): `packages/payments/drizzle/0000_payments.sql` + `drizzle/meta/*`

**Interfaces:**
- Produces: the `payments` / `payment_refunds` Drizzle tables and their enums, exported from `schema/index.ts`.

- [ ] **Step 1: Write `schema/payments.ts`**

```ts
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sales, tenants, workingOrders } from "@waitron/db";

/**
 * The lifecycle state of one electronic tender. 4a's online subset: `captured` (money taken),
 * `voided` (an uncaptured payment cancelled), `refunded`/`partially_refunded`, and `failed` (the
 * network refused). Offline and two-phase states are added by later plans via ALTER TYPE, never
 * reserved here. Mirrors `PaymentState` in ../provider.ts.
 */
export const paymentState = pgEnum("payment_state", [
  "captured",
  "voided",
  "refunded",
  "partially_refunded",
  "failed",
]);

/**
 * One row per electronic tender. The module's own MUTABLE lifecycle record — the deliberate
 * opposite of core's immutable `tenders` row, and the reason core carries no payment column at
 * all. `sale_id` is nullable and set post-capture, in the SAME transaction as the sale it belongs
 * to (see `associatePaymentWithSale`), so a committed sale always carries its association; a
 * captured payment with a null `sale_id` on a settled/abandoned order is the orphan `reconcile`
 * (a later plan) exists to find. The FK points module→core exactly as `registros_facturacion` does.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workingOrderId: uuid("working_order_id").notNull(),
    // Nullable: the payment row exists before the sale does (the money moves first). Set to the
    // committed sale in the associate-back step.
    saleId: uuid("sale_id"),
    provider: text("provider").notNull(),
    /** This provider's opaque reference and the idempotency anchor. */
    paymentRef: text("payment_ref").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    state: paymentState("state").notNull(),
    /** Set on `captured`, null otherwise. Feeds `RecordSaleTender.settledAt`. */
    settledAt: timestamp("settled_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite target so payment_refunds can point at a tenant-consistent payment.
    unique("payments_tenant_id_key").on(t.tenantId, t.id),
    // Idempotency: a retried collect cannot double-insert the same provider reference.
    unique("payments_provider_ref_key").on(t.tenantId, t.provider, t.paymentRef),
    // Tenant-consistent FK to the pre-sale entity (also anchors tenant_id).
    foreignKey({
      columns: [t.tenantId, t.workingOrderId],
      foreignColumns: [workingOrders.tenantId, workingOrders.id],
      name: "payments_working_order_fk",
    }).onDelete("restrict"),
    // Nullable composite FK to the committed sale. MATCH SIMPLE: satisfied while sale_id is null.
    foreignKey({
      columns: [t.tenantId, t.saleId],
      foreignColumns: [sales.tenantId, sales.id],
      name: "payments_sale_fk",
    }).onDelete("restrict"),
    index("payments_working_order_idx").on(t.workingOrderId),
    index("payments_sale_idx").on(t.saleId),
    check("payments_amount_ck", sql`${t.amount} > 0`),
  ],
).enableRLS();
```

Note: `tenants` is imported for the FK-through-`workingOrders` tenant anchor only conceptually; drizzle needs no direct `tenants` reference here because the composite FK to `working_orders` carries tenant consistency. If `tenants` ends up unused, remove it from the import to satisfy lint. (Verify with `pnpm --filter @waitron/payments lint` in Step 6.)

- [ ] **Step 2: Write `schema/payment-refunds.ts`**

```ts
import { sql } from "drizzle-orm";
import { check, foreignKey, index, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { payments } from "./payments.js";

/** One refund movement's outcome. 4a: `succeeded` (money returned) or `failed`. */
export const paymentRefundState = pgEnum("payment_refund_state", ["succeeded", "failed"]);

/**
 * One row per refund — a distinct money movement referencing the original capture, never a
 * mutation of it. The aggregate (has the whole capture been returned, or only part?) is reflected
 * on `payments.state` (`refunded` / `partially_refunded`); this table is the itemised trail.
 */
export const paymentRefunds = pgTable(
  "payment_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    provider: text("provider").notNull(),
    paymentRef: text("payment_ref").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    state: paymentRefundState("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
      name: "payment_refunds_payment_fk",
    }).onDelete("restrict"),
    index("payment_refunds_payment_idx").on(t.paymentId),
    check("payment_refunds_amount_ck", sql`${t.amount} > 0`),
  ],
).enableRLS();
```

- [ ] **Step 3: Write `schema/index.ts`** (explicit exports; never a core table — mirrors `fiscal-verifactu/src/schema/index.ts`'s own header verbatim in spirit):

```ts
// The Drizzle snapshot is built from THIS file's exports. Every name is written out explicitly —
// never `export *`, and never a core table — because this list is what `drizzle-kit generate`
// emits a CREATE TABLE for. The schema files above import core tables (`workingOrders`, `sales`,
// `tenants`) to declare foreign keys; they must NEVER be re-exported, or they land in this
// package's snapshot as duplicate CREATE TABLEs that fail at apply time. `schema-ownership.test.ts`
// enforces this.
export { paymentState, payments } from "./payments.js";
export { paymentRefundState, paymentRefunds } from "./payment-refunds.js";
```

- [ ] **Step 4: Write `schema-ownership.test.ts`** (clone of `packages/fiscal-verifactu/src/schema-ownership.test.ts` — read that file and reproduce it, changing the module name and the set of core-table names it forbids re-exporting to `["workingOrders", "sales", "tenants", "tenders", "invoiceSeries"]` and importing `* as schema from "./schema/index.js"`). It asserts none of the core table objects are members of the payments schema barrel.

- [ ] **Step 5: Write `monetary-columns.test.ts`** (clone of `packages/fiscal-verifactu/src/monetary-columns.test.ts` — read it and reproduce, scanning `payments`/`payment_refunds` columns to assert every money column is `numeric(12,2)` and no `real`/`double precision`/float appears).

- [ ] **Step 6: Generate the table migration**

Run: `pnpm --filter @waitron/payments lint && pnpm --filter @waitron/payments exec drizzle-kit generate`
Expected: a new `packages/payments/drizzle/0000_payments.sql` (CREATE TABLE for both tables, enum types, unique constraints, FKs, `ENABLE ROW LEVEL SECURITY`) plus `drizzle/meta/`. Inspect it: it must NOT contain a CREATE TABLE for any core table (`sales`, `working_orders`, `tenants`). If it does, a core table leaked into `schema/index.ts` — fix the re-export.

- [ ] **Step 7: Run the schema tests**

Run: `pnpm --filter @waitron/payments test schema-ownership monetary-columns`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/payments/src/schema packages/payments/src/schema-ownership.test.ts packages/payments/src/monetary-columns.test.ts packages/payments/drizzle
git commit -m "feat(payments): payments + payment_refunds schema and generated migration"
```

---

### Task 6: RLS + grants migration, and the migration bundle

**Files:**
- Create: `packages/payments/drizzle/0001_payments_rls.sql` (hand-written), `packages/payments/src/migrations.ts`, `packages/payments/src/migrations.test.ts`

**Interfaces:**
- Produces: `PAYMENTS_MIGRATIONS` descriptor (consumed by every test harness in later tasks).

- [ ] **Step 1: Write the migration bundle `src/migrations.ts`** (clone of `packages/fiscal-verifactu/src/migrations.ts`, renamed):

```ts
import { fileURLToPath } from "node:url";

/**
 * This package's migration set. Exported as data rather than a function because ordering across
 * packages is the RUNTIME's responsibility — core migrations must run before these, and a
 * descriptor makes the caller state that order out loud (see any harness that pairs
 * CORE_MIGRATIONS with this).
 */
export const PAYMENTS_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_payments",
} as const;
```

- [ ] **Step 2: Write the hand-written RLS migration `drizzle/0001_payments_rls.sql`** (model it on `fiscal-verifactu/drizzle/0006_acks_rls.sql`):

```sql
-- Hand-written, same reason as fiscal-verifactu/drizzle/0006_acks_rls.sql's header: drizzle-kit
-- diffs against its own snapshot and has no concept of policies, FORCE or privileges, so none of
-- this would survive a later `generate` run if it lived in a generated file — and it need not,
-- because a generated migration never touches it again.
--
-- current_tenant_id() is NOT redefined here: it is a shared function created once by
-- packages/db's 0001_tenancy_rls.sql and already lives in `public` by the time this package's
-- migrations run (core runs first — migrations.test.ts proves it).

--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_refunds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "payments_tenant_isolation" ON "payments"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
CREATE POLICY "payment_refunds_tenant_isolation" ON "payment_refunds"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- payments/payment_refunds are MUTABLE (state advances as the payment lifecycle progresses), so
-- they get tenant isolation only, not append-only triggers — the same shape as acks/envio_flujo.
--
-- REVOKE ALL first, not just DELETE: a provisioning script that ran GRANT ALL before this migration
-- would otherwise hand back the privileges being withheld. No DELETE is granted: nothing in the 4a
-- write path removes a row (a reversal is a new refund row + a state change, never a delete).
REVOKE ALL ON "payments" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payments" TO app_user;--> statement-breakpoint
REVOKE ALL ON "payment_refunds" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payment_refunds" TO app_user;
```

- [ ] **Step 3: Register the custom migration in the drizzle journal.** drizzle-kit tracks migrations in `drizzle/meta/_journal.json`. A hand-authored SQL file must be added to the journal so `runMigrations` applies it. Use the repo's established approach: run `pnpm --filter @waitron/payments exec drizzle-kit generate --custom --name payments_rls` to create the empty custom migration + journal entry, then paste the SQL above into the generated `0001_*.sql` file (renaming to `0001_payments_rls.sql` if the tooling used a different suffix, and updating the journal `tag` to match). Verify `drizzle/meta/_journal.json` lists both `0000_*` and the `0001_*` custom entry.

- [ ] **Step 4: Write `migrations.test.ts`** (clone `packages/fiscal-verifactu/src/migrations.test.ts`'s "runs after core" / "fails when run before core" pattern — read it and reproduce). Minimum assertions:
  - Applying `CORE_MIGRATIONS` then `PAYMENTS_MIGRATIONS` on a fresh PGlite DB succeeds and creates `payments`/`payment_refunds`.
  - Applying `PAYMENTS_MIGRATIONS` alone (no core) fails (the FK to `working_orders`/`sales` and `current_tenant_id()` are absent).

```ts
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";

describe("payments migrations", () => {
  it("apply cleanly after core", async () => {
    const db = await createPgliteDb();
    try {
      await runMigrations(db, CORE_MIGRATIONS);
      await runMigrations(db, PAYMENTS_MIGRATIONS);
      const rows = await db.execute<{ to_regclass: string | null }>(
        sql`select to_regclass('public.payments')::text as to_regclass`,
      );
      expect(rows.rows[0].to_regclass).toBe("payments");
    } finally {
      await db.close();
    }
  });

  it("fail when run before core (the FK targets and current_tenant_id() do not exist yet)", async () => {
    const db = await createPgliteDb();
    try {
      await expect(runMigrations(db, PAYMENTS_MIGRATIONS)).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @waitron/payments test migrations`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/payments/src/migrations.ts packages/payments/src/migrations.test.ts packages/payments/drizzle
git commit -m "feat(payments): RLS + grants migration and migration bundle"
```

---

### Task 7: The payment-lifecycle store

**Files:**
- Create: `packages/payments/src/store.ts`, `packages/payments/src/store.test.ts`, `packages/payments/test/seed.ts`
- Modify: `packages/payments/src/index.ts`

**Interfaces:**
- Consumes: `payments`/`payment_refunds` (Task 5), `Transaction` from `@waitron/db`, `Decimal` helpers from `@waitron/shared`, `payment.*` codes (Task 3).
- Produces (all take a `Transaction` and are called within the provider's own short tx, except `associatePaymentWithSale` which runs in the sale tx):
  - `createPayment(tx, { tenantId, workingOrderId, provider, paymentRef, amount }): Promise<void>`
  - `recordCapture(tx, { tenantId, provider, paymentRef, settledAt }): Promise<void>`
  - `recordFailure(tx, { tenantId, provider, paymentRef }): Promise<void>`
  - `recordVoid(tx, { tenantId, provider, paymentRef }): Promise<PaymentRow>`
  - `recordRefund(tx, { tenantId, provider, paymentRef, amount }): Promise<PaymentRow>`
  - `associatePaymentWithSale(tx, { tenantId, provider, paymentRef, saleId }): Promise<void>`
  - `getPaymentByRef(tx, { tenantId, provider, paymentRef }): Promise<PaymentRow | undefined>`
  - `interface PaymentRow { id: string; state: PaymentState; amount: string; saleId: string | null; settledAt: string | null }`

- [ ] **Step 1: Write the seed helper `test/seed.ts`** (creates the FK chain a payment needs). Use raw SQL via `db.execute` so it works on any `Database`:

```ts
import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

export interface Seeded {
  tenantId: string;
  tillId: string;
  workingOrderId: string;
}

/** Seeds tenant → location → till → open working_order and returns their ids. Run as the
 * connection owner (superuser) — RLS is bypassed, so this is pure setup. */
export async function seedWorkingOrder(db: Database, nif = "B00000000"): Promise<Seeded> {
  const t = await db.execute<{ id: string }>(sql`
    insert into tenants (nif, legal_name) values (${nif}, 'Test SL') returning id`);
  const tenantId = t.rows[0].id;
  const l = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Counter', array['es'], 'Retail') returning id`);
  const locationId = l.rows[0].id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Till 1') returning id`);
  const tillId = till.rows[0].id;
  const wo = await db.execute<{ id: string }>(sql`
    insert into working_orders (tenant_id, till_id) values (${tenantId}, ${tillId}) returning id`);
  return { tenantId, tillId, workingOrderId: wo.rows[0].id };
}
```

- [ ] **Step 2: Write the failing store test `store.test.ts`** (behaviours: create→capture sets state+settledAt; associate sets sale_id; refund of full amount → `refunded`; partial refund → `partially_refunded`; over-refund throws `payment.refund_exceeds_capture`; void of a captured payment throws `payment.not_voidable`; `getPaymentByRef` on a missing ref returns undefined). Full test (representative core cases — add the remaining branch cases to reach coverage):

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { AppError } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import {
  associatePaymentWithSale,
  createPayment,
  getPaymentByRef,
  recordCapture,
  recordRefund,
  recordVoid,
} from "./store.js";
import { seedWorkingOrder } from "../test/seed.js";

let db: Database;
beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.execute(sql`truncate payment_refunds, payments cascade`);
});

const SETTLED = new Date("2026-07-22T10:00:00Z");

it("create then capture sets state=captured and settledAt", async () => {
  const s = await seedWorkingOrder(db);
  await db.transaction(async (tx) => {
    await createPayment(tx, { tenantId: s.tenantId, workingOrderId: s.workingOrderId, provider: "fake", paymentRef: "p1", amount: decimal("10.00") });
    await recordCapture(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "p1", settledAt: SETTLED });
  });
  const row = await db.transaction((tx) => getPaymentByRef(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "p1" }));
  expect(row?.state).toBe("captured");
  expect(row?.settledAt).not.toBeNull();
});

it("over-refund throws payment.refund_exceeds_capture", async () => {
  const s = await seedWorkingOrder(db);
  await db.transaction(async (tx) => {
    await createPayment(tx, { tenantId: s.tenantId, workingOrderId: s.workingOrderId, provider: "fake", paymentRef: "p2", amount: decimal("10.00") });
    await recordCapture(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "p2", settledAt: SETTLED });
  });
  await expect(
    db.transaction((tx) => recordRefund(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "p2", amount: decimal("11.00") })),
  ).rejects.toBeInstanceOf(AppError);
});
```

(Add: partial-then-full refund crossing `partially_refunded`→`refunded`; `recordVoid` on a captured payment throwing `payment.not_voidable`; `associatePaymentWithSale` setting `sale_id` — seed a sale via `@waitron/core`'s `recordSale` in Task 10's test rather than here, or insert a `sales` row directly with `seedWorkingOrder`-style raw SQL; `payment.not_found` on an unknown ref for capture/refund/void.)

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @waitron/payments test store`
Expected: FAIL — `./store.js` does not exist.

- [ ] **Step 4: Write `store.ts`**

```ts
import { and, eq, sql } from "drizzle-orm";
import { AppError, addDecimal, compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { payments } from "./schema/payments.js";
import { paymentRefunds } from "./schema/payment-refunds.js";
import type { PaymentState } from "./provider.js";

export interface PaymentRow {
  id: string;
  state: PaymentState;
  amount: string;
  saleId: string | null;
  settledAt: string | null;
}

interface Key {
  tenantId: string;
  provider: string;
  paymentRef: string;
}

export async function createPayment(
  tx: Transaction,
  params: { tenantId: string; workingOrderId: string; provider: string; paymentRef: string; amount: Decimal },
): Promise<void> {
  await tx.insert(payments).values({
    tenantId: params.tenantId,
    workingOrderId: params.workingOrderId,
    provider: params.provider,
    paymentRef: params.paymentRef,
    amount: params.amount,
    state: "captured", // overwritten by recordCapture/recordFailure; a fresh row starts unsettled
    settledAt: null,
  });
  // NOTE: the initial state is set by the caller's next store call in the same tx (recordCapture
  // or recordFailure). We insert with settledAt null and a placeholder state, then immediately
  // transition. (A dedicated `attempting` state is introduced in 4b, where the real adapter has a
  // genuine network gap between insert and outcome; 4a's fake has none, so the two writes share a
  // transaction and the placeholder is never observed.)
}

export async function recordCapture(
  tx: Transaction,
  params: Key & { settledAt: Date },
): Promise<void> {
  await requireRow(tx, params);
  await tx
    .update(payments)
    .set({ state: "captured", settledAt: params.settledAt.toISOString(), updatedAt: sql`now()` })
    .where(keyWhere(params));
}

export async function recordFailure(tx: Transaction, params: Key): Promise<void> {
  await requireRow(tx, params);
  await tx
    .update(payments)
    .set({ state: "failed", settledAt: null, updatedAt: sql`now()` })
    .where(keyWhere(params));
}

export async function recordVoid(tx: Transaction, params: Key): Promise<PaymentRow> {
  const row = await requireRow(tx, params);
  if (row.state !== "captured" && row.state !== "failed") {
    // Only an uncaptured (or failed) payment is voidable in 4a. A captured payment must be
    // refunded, not voided.
  }
  if (row.settledAt !== null) {
    throw new AppError("payment.not_voidable", { paymentRef: params.paymentRef, state: row.state });
  }
  await tx
    .update(payments)
    .set({ state: "voided", updatedAt: sql`now()` })
    .where(keyWhere(params));
  return { ...row, state: "voided" };
}

export async function recordRefund(
  tx: Transaction,
  params: Key & { amount: Decimal },
): Promise<PaymentRow> {
  const row = await requireRow(tx, params);
  if (row.settledAt === null) {
    throw new AppError("payment.not_found", { provider: params.provider, paymentRef: params.paymentRef });
  }
  const prior = await tx
    .select({ amount: paymentRefunds.amount })
    .from(paymentRefunds)
    .where(and(eq(paymentRefunds.tenantId, params.tenantId), eq(paymentRefunds.paymentId, row.id)));
  const alreadyRefunded = sumDecimals(prior.map((r) => decimal(r.amount)));
  const afterThis = addDecimal(alreadyRefunded, params.amount);
  const captured = decimal(row.amount);
  if (compareDecimal(afterThis, captured) > 0) {
    throw new AppError("payment.refund_exceeds_capture", {
      paymentRef: params.paymentRef,
      captured,
      requested: params.amount,
      alreadyRefunded,
    });
  }
  await tx.insert(paymentRefunds).values({
    tenantId: params.tenantId,
    paymentId: row.id,
    provider: params.provider,
    paymentRef: params.paymentRef,
    amount: params.amount,
    state: "succeeded",
  });
  const fully = compareDecimal(afterThis, captured) === 0;
  const state: PaymentState = fully ? "refunded" : "partially_refunded";
  await tx.update(payments).set({ state, updatedAt: sql`now()` }).where(keyWhere(params));
  return { ...row, state };
}

export async function associatePaymentWithSale(
  tx: Transaction,
  params: Key & { saleId: string },
): Promise<void> {
  await requireRow(tx, params);
  await tx
    .update(payments)
    .set({ saleId: params.saleId, updatedAt: sql`now()` })
    .where(keyWhere(params));
}

export async function getPaymentByRef(tx: Transaction, params: Key): Promise<PaymentRow | undefined> {
  const [row] = await tx
    .select({
      id: payments.id,
      state: payments.state,
      amount: payments.amount,
      saleId: payments.saleId,
      settledAt: payments.settledAt,
    })
    .from(payments)
    .where(keyWhere(params));
  return row as PaymentRow | undefined;
}

function keyWhere(params: Key) {
  return and(
    eq(payments.tenantId, params.tenantId),
    eq(payments.provider, params.provider),
    eq(payments.paymentRef, params.paymentRef),
  );
}

async function requireRow(tx: Transaction, params: Key): Promise<PaymentRow> {
  const row = await getPaymentByRef(tx, params);
  if (row === undefined) {
    throw new AppError("payment.not_found", { provider: params.provider, paymentRef: params.paymentRef });
  }
  return row;
}
```

Note on `createPayment`'s placeholder state: to avoid a never-observed placeholder, an implementer may prefer `createPayment` to accept the terminal state directly and drop `recordCapture`/`recordFailure` as separate calls for 4a. Either shape is acceptable as long as the fake commits one row per `collect`; keep whichever passes the tests with cleaner coverage. If the two-call shape leaves the placeholder `state:"captured"` unobservable and it bothers the `monetary`/mutation checks, collapse to a single `insertCaptured` / `insertFailed`. **Decide during Step 4 and keep the store's public names stable for Task 8.**

- [ ] **Step 5: Export the store from the barrel** (`src/index.ts`), adding after the type re-exports:

```ts
export {
  associatePaymentWithSale,
  createPayment,
  getPaymentByRef,
  recordCapture,
  recordFailure,
  recordRefund,
  recordVoid,
} from "./store.js";
export type { PaymentRow } from "./store.js";
export { PAYMENTS_MIGRATIONS } from "./migrations.js";
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @waitron/payments test store`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/payments/src/store.ts packages/payments/src/store.test.ts packages/payments/test/seed.ts packages/payments/src/index.ts
git commit -m "feat(payments): payment-lifecycle store"
```

---

### Task 8: The `FakePaymentProvider` test double

**Files:**
- Create: `packages/payments/src/testing/fake-provider.ts`, `packages/payments/src/testing/fake-provider.test.ts`

**Interfaces:**
- Consumes: the store (Task 7), `PaymentProvider`/`PaymentResult` (Task 4), `Database` from `@waitron/db`.
- Produces: `class FakePaymentProvider implements PaymentProvider` with `constructor(db: Database)` and a test affordance `failNextCollect()`.

- [ ] **Step 1: Write the failing test `testing/fake-provider.test.ts`**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { FakePaymentProvider } from "./fake-provider.js";
import { seedWorkingOrder } from "../../test/seed.js";

let db: Database;
beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.execute(sql`truncate payment_refunds, payments cascade`); });

it("collect returns a captured result with a settledAt and persists it", async () => {
  const s = await seedWorkingOrder(db);
  const provider = new FakePaymentProvider(db);
  const r = await provider.collect({ tenantId: s.tenantId, tillId: s.tillId, workingOrderId: s.workingOrderId, amount: decimal("10.00") });
  expect(r.state).toBe("captured");
  expect(r.settledAt).not.toBeNull();
  expect(r.provider).toBe("fake");
});

it("a failed collect leaves the tender unsettled", async () => {
  const s = await seedWorkingOrder(db);
  const provider = new FakePaymentProvider(db);
  provider.failNextCollect();
  const r = await provider.collect({ tenantId: s.tenantId, tillId: s.tillId, workingOrderId: s.workingOrderId, amount: decimal("10.00") });
  expect(r.state).toBe("failed");
  expect(r.settledAt).toBeNull();
});

it("refund of the full amount marks the payment refunded", async () => {
  const s = await seedWorkingOrder(db);
  const provider = new FakePaymentProvider(db);
  const paid = await provider.collect({ tenantId: s.tenantId, tillId: s.tillId, workingOrderId: s.workingOrderId, amount: decimal("10.00") });
  const refunded = await provider.refund(paid.paymentRef);
  expect(refunded.state).toBe("refunded");
});

it("capabilities advertise partialRefund support", () => {
  expect(new FakePaymentProvider(db).capabilities.partialRefund).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/payments test fake-provider`
Expected: FAIL — `./fake-provider.js` does not exist.

- [ ] **Step 3: Write `testing/fake-provider.ts`**

```ts
import { decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { CollectParams, PaymentProvider, PaymentResult, ProviderCapabilities } from "../provider.js";
import {
  createPayment,
  getPaymentByRef,
  recordCapture,
  recordFailure,
  recordRefund,
  recordVoid,
} from "../store.js";

let counter = 0;
const nextRef = (): string => `fake-${String(++counter).padStart(8, "0")}`;

/**
 * A genuine DB-backed test double, not a stub. It persists to the real `payments`/`payment_refunds`
 * tables through short transactions of its own (it takes no caller transaction — the interface
 * forbids it), so the online path, the associate-back, and RLS behave exactly as a real adapter's
 * would. There is no network; a captured result and its persistence share one transaction, and the
 * outcome is deterministic (configurable via `failNextCollect`). NOT re-exported from the package
 * barrel — a production import cannot reach it.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly provider = "fake";
  readonly capabilities: ProviderCapabilities = { partialRefund: true };
  private failNext = false;

  constructor(private readonly db: Database) {}

  /** Test affordance: makes the next `collect` return a `failed` result. */
  failNextCollect(): void {
    this.failNext = true;
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    const paymentRef = nextRef();
    const willFail = this.failNext;
    this.failNext = false;
    const settledAt = willFail ? null : new Date();
    await this.db.transaction(async (tx) => {
      await createPayment(tx, {
        tenantId: params.tenantId,
        workingOrderId: params.workingOrderId,
        provider: this.provider,
        paymentRef,
        amount: params.amount,
      });
      if (willFail) {
        await recordFailure(tx, { tenantId: params.tenantId, provider: this.provider, paymentRef });
      } else {
        await recordCapture(tx, { tenantId: params.tenantId, provider: this.provider, paymentRef, settledAt: settledAt! });
      }
    });
    return {
      provider: this.provider,
      paymentRef,
      state: willFail ? "failed" : "captured",
      amount: params.amount,
      settledAt,
    };
  }

  async void(ref: string): Promise<PaymentResult> {
    return this.mutate(ref, (tx, tenantId) => recordVoid(tx, { tenantId, provider: this.provider, paymentRef: ref }));
  }

  async refund(ref: string): Promise<PaymentResult> {
    return this.mutate(ref, (tx, tenantId, amount) =>
      recordRefund(tx, { tenantId, provider: this.provider, paymentRef: ref, amount }),
    );
  }

  async partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> {
    return this.mutate(
      ref,
      (tx, tenantId) => recordRefund(tx, { tenantId, provider: this.provider, paymentRef: ref, amount }),
      amount,
    );
  }

  private async mutate(
    ref: string,
    op: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0], tenantId: string, amount: Decimal) => Promise<{ id: string; state: PaymentResult["state"]; amount: string; settledAt: string | null }>,
    amount?: Decimal,
  ): Promise<PaymentResult> {
    // Resolve the tenant from the row (the fake has none in hand). A real adapter is always given
    // the tenant scope by its caller; the fake reads it back so a bare `ref` can drive a test.
    const tenant = await this.tenantOf(ref);
    const row = await this.db.transaction((tx) => op(tx, tenant, amount ?? decimal("0.00")));
    return {
      provider: this.provider,
      paymentRef: ref,
      state: row.state,
      amount: decimal(row.amount),
      settledAt: row.settledAt === null ? null : new Date(row.settledAt),
    };
  }

  private async tenantOf(ref: string): Promise<string> {
    const rows = await this.db.execute<{ tenant_id: string }>(
      // Provider-scoped lookup; `ref` is unique per (tenant, provider, ref).
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- see below
      // The fake owns every row it created; a ref it did not create is a test bug.
      // Using raw SQL to avoid importing the schema object here (keeps the fake thin).
      // NOTE: replace with a store `tenantForRef` helper if the reviewer prefers no raw SQL here.
      (await import("drizzle-orm")).sql`select tenant_id from payments where provider = 'fake' and payment_ref = ${ref} limit 1`,
    );
    return rows.rows[0]!.tenant_id;
  }
}
```

Note: the dynamic `import("drizzle-orm")` inside `tenantOf` is ugly — the implementer should instead add a small `tenantForRef(db, provider, paymentRef)` to `store.ts` (returning the tenant, or throwing `payment.not_found`) and call it here, keeping `sql` imported once at the top of `store.ts`. Prefer that cleaner shape; the version above is only to show intent. **Whatever shape is chosen must keep the fake free of provider vocabulary (Task 2 scans this file).**

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/payments test fake-provider no-provider-vocabulary`
Expected: PASS (the vocabulary guard's "discovers …fake-provider.ts" check now also passes).

- [ ] **Step 5: Commit**

```bash
git add packages/payments/src/testing/fake-provider.ts packages/payments/src/testing/fake-provider.test.ts packages/payments/src/store.ts
git commit -m "feat(payments): DB-backed FakePaymentProvider"
```

---

### Task 9: RLS behaviour under a real non-superuser role

**Files:**
- Create: `packages/payments/src/testing/postgres.ts`, `packages/payments/src/payments.rls.test.ts`

**Interfaces:**
- Consumes: `startRealPostgres`/`connectAs` harness, `withTenant` from `@waitron/db`.
- Produces: proof that the grants + tenant-isolation policies actually hold under a role that does not bypass RLS.

- [ ] **Step 1: Write `testing/postgres.ts`** (clone `packages/fiscal-verifactu/src/testing/postgres.ts` verbatim, changing only the second migration set from `FISCAL_MIGRATIONS` to `PAYMENTS_MIGRATIONS` and its import, and the error-message text to name the payments RLS suite). It must run `CORE_MIGRATIONS` then `PAYMENTS_MIGRATIONS`.

- [ ] **Step 2: Write `payments.rls.test.ts`** (model on `pending-count.rls.test.ts`). It (a) seeds a payment for tenant A as the superuser, (b) connects as `rls_probe` (non-superuser, member of `app_user`), (c) with `app.tenant_id` set to A via `withTenant`, reads the payment back — proving the SELECT grant + policy; (d) with `app.tenant_id` set to a different tenant, reads zero rows — proving isolation; (e) INSERT/UPDATE succeed under the grant. Full file:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { createPayment, getPaymentByRef, recordCapture } from "./store.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedWorkingOrder } from "../test/seed.js";

const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  await admin.execute(
    sql.raw(`create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`),
  );
});

afterAll(async () => {
  await admin.close();
  await pg.stop();
});

describe("payments under real row-level security", () => {
  it("an app_user-role connection reads and writes its own tenant's payment, and only its own", async () => {
    const s = await seedWorkingOrder(admin, "B11111111");
    const other = await seedWorkingOrder(admin, "B22222222");

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // INSERT + UPDATE under the grant + policy, scoped to tenant s.
      await withTenant(probe, s.tenantId, async (tx) => {
        await createPayment(tx, { tenantId: s.tenantId, workingOrderId: s.workingOrderId, provider: "fake", paymentRef: "r1", amount: decimal("10.00") });
        await recordCapture(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "r1", settledAt: new Date() });
      });

      // Readable within its own tenant scope.
      const seen = await withTenant(probe, s.tenantId, (tx) =>
        getPaymentByRef(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "r1" }),
      );
      expect(seen?.state).toBe("captured");

      // Invisible from another tenant's scope — the isolation policy bites.
      const hidden = await withTenant(probe, other.tenantId, (tx) =>
        getPaymentByRef(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: "r1" }),
      );
      expect(hidden).toBeUndefined();
    } finally {
      await probe.close();
    }
  });
});
```

(Confirm `withTenant`'s exact signature from `packages/db/src/tenancy.ts` — it wraps a callback in a transaction with `app.tenant_id` set; adjust the call shape if it differs.)

- [ ] **Step 3: Run it** (requires Docker for Testcontainers)

Run: `pnpm --filter @waitron/payments test payments.rls`
Expected: PASS. If it fails with `permission denied for table payments`, the Task 6 grant is missing/misapplied — fix the migration, not the test.

- [ ] **Step 4: Commit**

```bash
git add packages/payments/src/testing/postgres.ts packages/payments/src/payments.rls.test.ts
git commit -m "test(payments): RLS + grants under a real non-superuser role"
```

---

### Task 10: End-to-end wiring — `collect` → `recordSale` → associate

**Files:**
- Create: `packages/payments/src/wiring.test.ts`

**Interfaces:**
- Consumes: `FakePaymentProvider` (Task 8), `associatePaymentWithSale` (Task 7), `@waitron/core`'s `recordSale`, `@waitron/fiscal`'s fake backend, `@waitron/db` seed pieces.
- Produces: the proof that a payment settles a tender, the sale chains, and the payment is associated with the committed sale **in the same transaction** — the whole point of 4a.

- [ ] **Step 1: Write the end-to-end test `wiring.test.ts`.** It composes the real pieces: take a payment with the fake provider, then in one sale transaction call `recordSale` (with the fiscal fake backend) using the settled tender, then `associatePaymentWithSale` with the returned `saleId`, and assert the payment row now carries that `sale_id`. This is the first consumer of `@waitron/core` (a dev dependency).

Key setup notes for the implementer:
- Use `FakeFiscalBackend` from `@waitron/fiscal/src/testing/fake-backend.js` and call `FakeFiscalBackend.install(db)` in `beforeAll`, then `backend.registerTill(tx, tillId, { tenantId })` for the seeded till before the sale (its `recordSale` refuses an unregistered till).
- Seed an `invoice_series` row for the till (recordSale looks it up); reuse the seed approach in `packages/core`'s own `record-sale.test.ts` — read that file for the exact series/tender/clock fixture shape and mirror it.
- Build `RecordSaleInput` with a single tender `{ method: "card", amount: paid.amount, settledAt: paid.settledAt }` where `paid` is the fake provider's `collect` result. `fiscalBackend: backend.provider`-equivalent string is `"fake"`; supply the `clock` the fiscal fake fixtures use (`steadyClock`).
- Wrap `recordSale` + `associatePaymentWithSale` in ONE `db.transaction`, so the association is atomic with the sale.

```ts
// Representative assertions (fill in the series/till/clock seeding per record-sale.test.ts):
it("settles a tender, chains the sale, and associates the payment atomically", async () => {
  const s = await seedForSale(db, backend); // helper you write: tenant→location→till(registered)→series→working_order
  const provider = new FakePaymentProvider(db);

  const paid = await provider.collect({
    tenantId: s.tenantId, tillId: s.tillId, workingOrderId: s.workingOrderId, amount: decimal("12.10"),
  });
  expect(paid.state).toBe("captured");

  const saleId = await db.transaction(async (tx) => {
    const { saleId } = await recordSale(tx, backend, {
      tenantId: s.tenantId, tillId: s.tillId, seriesId: s.seriesId, workingOrderId: s.workingOrderId,
      locale: "es", invoiceLocales: ["es"], total: "12.10", tipAmount: "0.00",
      lines: [{ lineNo: 1, descriptions: { es: "Item" }, quantity: "1", unitPrice: "10.00", vatRate: "21.00", lineTotal: "10.00" }],
      tenders: [{ method: "card", amount: paid.amount, settledAt: paid.settledAt }],
      fiscalBackend: "fake", clock: steadyClock,
    });
    await associatePaymentWithSale(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: paid.paymentRef, saleId });
    return saleId;
  });

  const row = await db.transaction((tx) => getPaymentByRef(tx, { tenantId: s.tenantId, provider: "fake", paymentRef: paid.paymentRef }));
  expect(row?.saleId).toBe(saleId);
});

it("a failed payment leaves the tender unsettled and recordSale refuses", async () => {
  const s = await seedForSale(db, backend);
  const provider = new FakePaymentProvider(db);
  provider.failNextCollect();
  const paid = await provider.collect({ tenantId: s.tenantId, tillId: s.tillId, workingOrderId: s.workingOrderId, amount: decimal("12.10") });
  await expect(
    db.transaction((tx) => recordSale(tx, backend, {
      /* same input, tenders: [{ method: "card", amount: paid.amount, settledAt: paid.settledAt }] */
    } as never)),
  ).rejects.toMatchObject({ code: "sale.tender_unsettled" });
});
```

- [ ] **Step 2: Run to verify it fails, then passes** as you wire the seeding. Iterate until:

Run: `pnpm --filter @waitron/payments test wiring`
Expected: PASS (both cases).

- [ ] **Step 3: Full package gate**

Run: `pnpm --filter @waitron/payments test && pnpm --filter @waitron/payments typecheck && pnpm --filter @waitron/payments lint && pnpm --filter @waitron/payments test:coverage`
Expected: all green; coverage ≥ thresholds (98/98/98/95). Add targeted tests for any uncovered branch (e.g. `recordFailure`'s not-found path, `partialRefund` crossing into `refunded`).

- [ ] **Step 4: Commit**

```bash
git add packages/payments/src/wiring.test.ts
git commit -m "test(payments): end-to-end collect -> recordSale -> associate"
```

---

## Self-Review

**1. Spec coverage (design §§1–10 → tasks):**
- §2 package layout / guards / GENERIC_PACKAGES / no-provider-vocabulary → Tasks 1, 2. ✔
- §3 interface + `PaymentResult`/`PaymentState` + FakeProvider + T1/T2 (no `tx`) → Tasks 4, 8. ✔
- §4 attach-to-sale, Option B `sale_id` linkage, atomic associate-back → Tasks 5, 7, 10. ✔
- §7 data model (`payments`, `payment_refunds`, enum, idempotency unique), RLS + grants (no DELETE), exact decimals → Tasks 5, 6; monetary guard Task 5. ✔
- §8 refunds/voids (void uncaptured; refund/partialRefund captured) → Tasks 7, 8. ✔
- §9 testing (fake, no-provider-vocabulary, real-PG RLS, T1/T2, schema-ownership, coverage) → Tasks 2, 5, 8, 9. Mutation-testing config is deferred (see gap below).
- §10 4a scope boundary (offline/reconcile/tab-tip/Stripe deferred) → honoured; Scope note forbids them. ✔
- **Gaps intentionally out of 4a:** `payment_policy`, offline states/columns, `forward`/`reconcile`, Stripe adapter, the app-level scheduler, and the role-gate on refunds (identity is sub-project 5). A **`mutation-payments` Stryker config** (design §9) is NOT added in this plan — the required CI checks are `mutation-verifactu`/`mutation-shared` only, and adding a new required check is a CI-config change out of this package's scope; note it for a follow-up.

**2. Placeholder scan:** No "TBD"/"add error handling" placeholders. Two tasks say "clone file X, changing Y" (package.json/tsconfig/vitest/postgres harness/guard clones) — these are exact, complete instructions naming the source file and the precise changes, not placeholders. Test tasks that say "add the remaining branch cases to reach coverage" name the specific branches to cover.

**3. Type consistency:** `PaymentState` (Task 4) = `payments.state` enum (Task 5) minus nothing used in 4a. Store function names (Task 7 `createPayment`/`recordCapture`/`recordFailure`/`recordVoid`/`recordRefund`/`associatePaymentWithSale`/`getPaymentByRef`) are consumed verbatim by the fake (Task 8) and wiring (Task 10). `PaymentResult` fields (`provider`/`paymentRef`/`state`/`amount`/`settledAt`) are produced by the fake and consumed by the wiring test's tender construction. Consistent.
