# Payment Mode 2b — Cycle A (neutral offline store-and-forward layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the provider-neutral offline store-and-forward layer to `@waitron/payments` — offline lifecycle states, a per-tenant offline policy, the offline-acceptance gate, and a `forward()` drain — proven end-to-end with the `FakePaymentProvider` and real-Postgres tests, with no device SDK and no webhooks.

**Architecture:** Extend the existing Postgres-backed payment store (§5 semantics of the umbrella design). `collect` may return an `accepted_offline` tender (`settled_at` set, so the sale chains immediately) when the network is down AND the tenant policy + a per-transaction opt-in + an amount cap all allow it; otherwise it returns a durable-nothing `network_unavailable`. `forward(now)` later advances `accepted_offline` rows to `settled` (cleared) or `declined` (refused), and a decline raises one idempotent incident without touching the immutable sale. `forward` is implemented on `FakePaymentProvider` this cycle; it joins the `PaymentProvider` interface in Cycle B when a real adapter implements it (the `drain`/`reconcile`-were-absent-until-implemented precedent).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Drizzle ORM (`pg-core`), drizzle-kit migrations, Vitest, PGlite (hermetic) + Testcontainers Postgres (RLS/concurrency), `@waitron/shared` exact-decimal helpers, `@waitron/core` incidents (test-only, via the fake).

## Global Constraints

- **Neutral vocabulary guard (`no-provider-vocabulary.test.ts`).** No identifier in `packages/payments/src/**` (comments are stripped, code is not) may contain, in any casing/compound: `stripe`, `adyen`, `sumup`, `paymentintent`, `readerid`, `reader`, `terminal` (even "terminal state" — use `settled`/`final`), `connectiontoken`, `acquirer`. All new names here (`accepted_offline`, `settled`, `declined`, `forward`, `offline_mode`, `offline_amount_cap`, `network_unavailable`, `resolveOfflineDecision`, `insertAcceptedOffline`, `claimAcceptedOffline`, `settleForwarded`, `declineForwarded`) are compliant.
- **Exact decimal, never float.** Every money column is `numeric(12, 2)`; money crosses code as `Decimal` (`@waitron/shared`), never a JS number. `monetary-columns.test.ts` enforces this.
- **Currency + localisation (project-wide).** Single currency per tenant — no currency column; `offline_amount_cap` is money in the tenant's currency (multi-currency/FX is deferred project-wide). Never store user-facing English or formatted values: the `payment.offline_forward_declined` incident is a structured `code` + `params` the UI localises, like every other incident.
- **T1/T2.** No method holds a DB transaction across a network call. (`FakePaymentProvider` has no network, so its `collect`/`forward` may use single short transactions; a real adapter in Cycle B splits them.)
- **RLS tests never skip.** Real-Postgres RLS/concurrency suites throw (never `it.skip`) when Docker is absent — PGlite runs as superuser and bypasses `FORCE ROW LEVEL SECURITY`. Use `startRealPostgres()` from `src/testing/postgres.ts`.
- **The fake is never barrel-exported.** `src/index.ts` must not re-export `FakePaymentProvider`; test files import it from `./testing/fake-provider.js` directly.
- **`@waitron/core` stays a devDependency of `@waitron/payments`.** Only the test-only fake imports it (for `recordIncidentOnce`). Do NOT move it to `dependencies`. The production barrel (`src/index.ts`) never imports `@waitron/core`.
- **`format:check` (prettier) and `lint` (eslint) are push/CI gates, separate from the tests.** Run `pnpm --filter @waitron/payments lint` and `pnpm format:check` (or `prettier --write`) before the final commit of each task.
- **Migrations are ordered core-first.** Nothing enforces it at runtime; test harnesses run `CORE_MIGRATIONS` then `PAYMENTS_MIGRATIONS` explicitly.
- **Worktree:** all work happens in `/Users/<user>/workspace/worktrees/waitron-payments-2b-offline-layer`. Commit there. Run package commands as `pnpm --filter @waitron/payments <script>`.

---

### Task 1: Schema & migrations — offline enum states + `payment_policy` table

**Files:**
- Modify: `packages/payments/src/schema/payments.ts` (append 3 enum values)
- Modify: `packages/payments/src/provider.ts` (widen the `PaymentState` union to match the pgEnum)
- Create: `packages/payments/src/schema/payment-policy.ts`
- Modify: `packages/payments/src/schema/index.ts` (export `paymentPolicy`)
- Create (generated): `packages/payments/drizzle/0004_payment_offline.sql` (enum ADD VALUE + CREATE TABLE), plus `meta/` snapshot + `_journal.json` entry
- Create (custom): `packages/payments/drizzle/0005_payment_policy_rls.sql`
- Modify (test): `packages/payments/src/migrations.test.ts`, `packages/payments/src/monetary-columns.test.ts`

**Interfaces:**
- Produces: `PaymentState` (both the pgEnum and the TS union in `provider.ts`) gains `accepted_offline`, `settled`, `declined`; the `paymentPolicy` table (`tenant_id` PK, `offline_mode text`, `offline_amount_cap numeric(12,2)`, timestamps); `PAYMENTS_MIGRATIONS` now applies through `0005`.

- [ ] **Step 1: Write the failing migration assertions**

Add to `packages/payments/src/migrations.test.ts` (inside the existing `describe`):

```ts
it("adds accepted_offline, settled and declined to the payment_state enum", async () => {
  const db = await createPgliteDb();
  try {
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, PAYMENTS_MIGRATIONS);
    const rows = await db.execute<{ enumlabel: string }>(sql`
      select e.enumlabel from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'payment_state'
    `);
    const labels = rows.rows.map((r) => r.enumlabel);
    expect(labels).toEqual(
      expect.arrayContaining(["accepted_offline", "settled", "declined"]),
    );
  } finally {
    await db.close();
  }
});

it("creates the payment_policy table with a numeric(12,2) offline_amount_cap", async () => {
  const db = await createPgliteDb();
  try {
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, PAYMENTS_MIGRATIONS);
    const table = await db.execute<{ to_regclass: string | null }>(
      sql`select to_regclass('public.payment_policy')::text as to_regclass`,
    );
    expect(table.rows[0].to_regclass).toBe("payment_policy");
    const col = await db.execute<{ data_type: string; numeric_precision: number; numeric_scale: number }>(sql`
      select data_type, numeric_precision, numeric_scale
      from information_schema.columns
      where table_name = 'payment_policy' and column_name = 'offline_amount_cap'
    `);
    expect(col.rows[0].data_type).toBe("numeric");
    expect(col.rows[0].numeric_precision).toBe(12);
    expect(col.rows[0].numeric_scale).toBe(2);
  } finally {
    await db.close();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/payments test -- migrations`
Expected: FAIL — the new enum values and `payment_policy` do not exist yet.

- [ ] **Step 3: Append the enum values in the schema**

In `packages/payments/src/schema/payments.ts`, change the `paymentState` array to append the three offline states at the END (append-only keeps the generated `ALTER TYPE ADD VALUE` clean; the DB value-order is cosmetic):

```ts
export const paymentState = pgEnum("payment_state", [
  "attempting",
  "captured",
  "voided",
  "refunded",
  "partially_refunded",
  "failed",
  // Cycle A offline lifecycle — appended (DB value-order is cosmetic; the lifecycle order is
  // documented in the design). accepted_offline -> (forward) -> settled | declined.
  "accepted_offline",
  "settled",
  "declined",
]);
```

Then widen the matching TS union in `packages/payments/src/provider.ts` **in this same task** — the pgEnum and the union must stay in sync, because Drizzle infers `payments.state`'s type from the pgEnum and the store assigns that into `PaymentRow.state: PaymentState`; leaving the union at six values fails THIS task's typecheck. Replace the `PaymentState` union:

```ts
export type PaymentState =
  | "attempting"
  | "captured"
  | "voided"
  | "refunded"
  | "partially_refunded"
  | "failed"
  | "accepted_offline"
  | "settled"
  | "declined";
```

(`PaymentResult.state` stays `PaymentState` for now — Task 3 widens it to the return-only `PaymentResultState`.)

- [ ] **Step 4: Create the `payment_policy` schema**

Create `packages/payments/src/schema/payment-policy.ts`:

```ts
import { sql } from "drizzle-orm";
import { check, foreignKey, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";

/**
 * Per-tenant offline-acceptance policy — exactly one row per tenant. `offline_mode` governs whether
 * the offline opt-in is ever available (`accept_offline` | `cash_only`); `offline_amount_cap` bounds
 * even an opted-in acceptance. Modelled as explicit configuration, never inferred from connectivity
 * (mirrors Veri*Factu-mode being explicit per-tenant config). The ABSENCE of a row is fail-safe: no
 * row means no offline acceptance at all (see `resolveOfflineDecision`). Mutable config, so tenant
 * isolation only (no append-only trigger); cascades with its tenant, being pure per-tenant config.
 */
export const paymentPolicy = pgTable(
  "payment_policy",
  {
    tenantId: uuid("tenant_id").primaryKey(),
    offlineMode: text("offline_mode").notNull(),
    offlineAmountCap: numeric("offline_amount_cap", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "payment_policy_tenant_fk",
    }).onDelete("cascade"),
    check("payment_policy_offline_mode_ck", sql`${t.offlineMode} in ('accept_offline', 'cash_only')`),
    check("payment_policy_cap_ck", sql`${t.offlineAmountCap} >= 0`),
  ],
).enableRLS();
```

- [ ] **Step 5: Export it from the schema barrel**

In `packages/payments/src/schema/index.ts`, add (never `export *`, never a core table):

```ts
export { paymentPolicy } from "./payment-policy.js";
```

- [ ] **Step 6: Generate the enum + table migrations, then hand-write the RLS one**

Run generate for the schema changes (the enum values and the new table land in ONE migration — safe together because `payment_policy` uses `text` for `offline_mode`, never the `payment_state` enum, so the `ALTER TYPE … ADD VALUE`s are never *used* in the transaction that adds them; the same shape `0003` already proved), then hand-write the RLS one:

```bash
pnpm --filter @waitron/payments db:generate --name payment_offline
pnpm --filter @waitron/payments db:generate:custom --name payment_policy_rls
```

- The first produces `0004_payment_offline.sql` containing three `ALTER TYPE "public"."payment_state" ADD VALUE '…'` statements AND `CREATE TABLE "payment_policy" (…)` with its FK + CHECKs + `ALTER TABLE "payment_policy" ENABLE ROW LEVEL SECURITY;`.
- The second produces an EMPTY `0005_payment_policy_rls.sql`. Fill it with exactly:

```sql
-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as
-- 0001_payments_rls.sql: drizzle-kit has no concept of policies, FORCE, or privileges.
-- current_tenant_id() already exists (packages/db 0001_tenancy_rls.sql; core runs first).

--> statement-breakpoint
ALTER TABLE "payment_policy" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "payment_policy_tenant_isolation" ON "payment_policy"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- Mutable config (offline_mode/cap change over time) → tenant isolation only, no append-only
-- trigger. REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted
-- grant. No DELETE: config is updated in place, never row-deleted.
REVOKE ALL ON "payment_policy" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payment_policy" TO app_user;
```

(Contingency — only if Step 9's `migrations.test.ts` fails to apply `0004` with an "ALTER TYPE … ADD VALUE cannot run inside a transaction block" error: split it. Delete `0004` and its `meta/_journal.json` entry, stage ONLY the enum change and run `db:generate --name payment_offline_states` (enum-only `0004`), then create `payment-policy.ts` + the barrel export and run `db:generate --name payment_policy` (table-only `0005`), and renumber the custom RLS migration to `0006`. The RLS SQL below is identical either way.)

- [ ] **Step 7: Extend the monetary-columns guard for the cap**

In `packages/payments/src/monetary-columns.test.ts`, add `paymentPolicy` to the import and a dedicated assertion (the existing loop keys on a column literally named `amount`, which the cap is not):

```ts
import { paymentPolicy, paymentRefunds, payments } from "./schema/index.js";
```

Add inside the top-level `describe`:

```ts
it("payment_policy.offline_amount_cap is numeric(12, 2) in the Drizzle schema", () => {
  const cap = Object.values(getTableColumns(paymentPolicy)).find(
    (c) => c.name === "offline_amount_cap",
  );
  expect(cap).toBeDefined(); // positive control
  expect(cap?.columnType).toBe("PgNumeric");
  expect((cap as { precision?: number } | undefined)?.precision).toBe(12);
  expect((cap as { scale?: number } | undefined)?.scale).toBe(2);
  expect(cap?.getSQLType()).toBe("numeric(12, 2)");
});
```

(The existing "no real/double precision/float anywhere" scan already covers the generated `0004` SQL.)

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/payments test -- migrations monetary-columns`
Expected: PASS (all migration + monetary assertions green).

- [ ] **Step 9: Typecheck, lint, format, commit**

```bash
pnpm --filter @waitron/payments typecheck
pnpm --filter @waitron/payments lint
pnpm format:check
git add packages/payments/src/schema packages/payments/src/provider.ts packages/payments/drizzle packages/payments/src/migrations.test.ts packages/payments/src/monetary-columns.test.ts
git commit -m "feat(payments): offline payment_state values + payment_policy table (2b-A task 1)"
```

---

### Task 2: The offline-acceptance gate — `getPaymentPolicy` + `resolveOfflineDecision`

**Files:**
- Create: `packages/payments/src/policy.ts`
- Create (test): `packages/payments/src/policy.test.ts`
- Modify: `packages/payments/src/index.ts` (barrel)

**Interfaces:**
- Consumes: `paymentPolicy` (Task 1), `@waitron/shared` (`Decimal`, `decimal`, `compareDecimal`).
- Produces:
  - `interface PaymentPolicyRow { offlineMode: "accept_offline" | "cash_only"; offlineAmountCap: string }`
  - `getPaymentPolicy(tx: Transaction, tenantId: string): Promise<PaymentPolicyRow | undefined>`
  - `resolveOfflineDecision(policy: PaymentPolicyRow | undefined, allowOffline: boolean, amount: Decimal): "accept" | "refuse"`

- [ ] **Step 1: Write the failing gate tests**

Create `packages/payments/src/policy.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { getPaymentPolicy, resolveOfflineDecision } from "./policy.js";
import type { PaymentPolicyRow } from "./policy.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const ACCEPT: PaymentPolicyRow = { offlineMode: "accept_offline", offlineAmountCap: "50.00" };
const CASH_ONLY: PaymentPolicyRow = { offlineMode: "cash_only", offlineAmountCap: "50.00" };

describe("resolveOfflineDecision (the pure gate)", () => {
  it("refuses when the staff did not opt in, whatever the policy", () => {
    expect(resolveOfflineDecision(ACCEPT, false, decimal("10.00"))).toBe("refuse");
  });
  it("refuses (fail-safe) when the tenant has no policy row", () => {
    expect(resolveOfflineDecision(undefined, true, decimal("10.00"))).toBe("refuse");
  });
  it("refuses when the policy is cash_only", () => {
    expect(resolveOfflineDecision(CASH_ONLY, true, decimal("10.00"))).toBe("refuse");
  });
  it("refuses when the amount exceeds the cap", () => {
    expect(resolveOfflineDecision(ACCEPT, true, decimal("50.01"))).toBe("refuse");
  });
  it("accepts at exactly the cap with opt-in under accept_offline", () => {
    expect(resolveOfflineDecision(ACCEPT, true, decimal("50.00"))).toBe("accept");
  });
  it("accepts below the cap", () => {
    expect(resolveOfflineDecision(ACCEPT, true, decimal("10.00"))).toBe("accept");
  });
});

describe("getPaymentPolicy", () => {
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
    await db.execute(sql`truncate payment_policy cascade`);
  });

  it("returns undefined for a tenant with no policy row", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const row = await db.transaction((tx) => getPaymentPolicy(tx, s.tenantId));
    expect(row).toBeUndefined();
  });

  it("reads back a tenant's policy row", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    await db.execute(sql`
      insert into payment_policy (tenant_id, offline_mode, offline_amount_cap)
      values (${s.tenantId}, 'accept_offline', '75.00')`);
    const row = await db.transaction((tx) => getPaymentPolicy(tx, s.tenantId));
    expect(row).toEqual({ offlineMode: "accept_offline", offlineAmountCap: "75.00" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/payments test -- policy`
Expected: FAIL — `./policy.js` does not exist.

- [ ] **Step 3: Implement `policy.ts`**

Create `packages/payments/src/policy.ts`:

```ts
import { eq } from "drizzle-orm";
import { compareDecimal, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { paymentPolicy } from "./schema/payment-policy.js";

/** A tenant's offline policy as the store reads it back. `offlineAmountCap` is the raw
 * numeric-column string (never a float). */
export interface PaymentPolicyRow {
  offlineMode: "accept_offline" | "cash_only";
  offlineAmountCap: string;
}

/** Read a tenant's offline policy row, or `undefined` when none is configured. A missing row is
 * meaningful: `resolveOfflineDecision` treats it as fail-safe (refuse). */
export async function getPaymentPolicy(
  tx: Transaction,
  tenantId: string,
): Promise<PaymentPolicyRow | undefined> {
  const [row] = await tx
    .select({
      offlineMode: paymentPolicy.offlineMode,
      offlineAmountCap: paymentPolicy.offlineAmountCap,
    })
    .from(paymentPolicy)
    .where(eq(paymentPolicy.tenantId, tenantId));
  return row as PaymentPolicyRow | undefined;
}

/**
 * The pure offline-acceptance gate. Given the tenant's policy (or `undefined` when unconfigured),
 * the per-transaction staff consent, and the amount, decide whether an offline card may be accepted.
 * Fail-safe: no consent, no policy row, `cash_only`, or over the cap all refuse. Only a configured
 * `accept_offline` tenant, with explicit consent, at or under the cap accepts. Nothing goes offline
 * silently — three independent gates must all pass.
 */
export function resolveOfflineDecision(
  policy: PaymentPolicyRow | undefined,
  allowOffline: boolean,
  amount: Decimal,
): "accept" | "refuse" {
  if (!allowOffline) return "refuse";
  if (policy === undefined) return "refuse";
  if (policy.offlineMode !== "accept_offline") return "refuse";
  // compareDecimal(amount, cap) > 0 means amount > cap → over the cap → refuse.
  if (compareDecimal(amount, decimal(policy.offlineAmountCap)) > 0) return "refuse";
  return "accept";
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/payments/src/index.ts`, add:

```ts
export { getPaymentPolicy, resolveOfflineDecision } from "./policy.js";
export type { PaymentPolicyRow } from "./policy.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/payments test -- policy`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
pnpm --filter @waitron/payments typecheck && pnpm --filter @waitron/payments lint && pnpm format:check
git add packages/payments/src/policy.ts packages/payments/src/policy.test.ts packages/payments/src/index.ts
git commit -m "feat(payments): offline-acceptance policy read + gate (2b-A task 2)"
```

---

### Task 3: Offline `collect` — types, `insertAcceptedOffline`, and the fake's offline path

**Files:**
- Modify: `packages/payments/src/provider.ts` (types)
- Modify: `packages/payments/src/store.ts` (`insertAcceptedOffline`)
- Modify: `packages/payments/src/testing/fake-provider.ts` (`offlineNextCollect`, offline `collect`)
- Modify: `packages/payments/src/index.ts` (barrel)
- Modify (test): `packages/payments/src/testing/fake-provider.test.ts`

**Interfaces:**
- Consumes: `getPaymentPolicy`, `resolveOfflineDecision` (Task 2); `insertPayment` (private, in `store.ts`); the `PaymentState` union already widened in Task 1.
- Produces:
  - `type PaymentResultState = PaymentState | "network_unavailable"` (return-only).
  - `CollectParams.allowOffline?: boolean`; `PaymentResult.state: PaymentResultState`; `PaymentResult.offline?: boolean`.
  - `insertAcceptedOffline(tx, params: NewPayment & { settledAt: Date }): Promise<void>`.
  - `FakePaymentProvider.offlineNextCollect(): void` — the next `collect` simulates an outage.

- [ ] **Step 1: Write the failing fake offline tests**

Add to `packages/payments/src/testing/fake-provider.test.ts`. First extend the `collect` helper to pass `allowOffline`, then add the describe block:

```ts
async function collect(
  provider: FakePaymentProvider,
  s: Seeded,
  amount = "10.00",
  allowOffline?: boolean,
) {
  return provider.collect({
    tenantId: brandTenantId(s.tenantId),
    tillId: brandTillId(s.tillId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    amount: decimal(amount),
    ...(allowOffline === undefined ? {} : { allowOffline }),
  });
}

async function setPolicy(s: Seeded, mode: "accept_offline" | "cash_only", cap: string) {
  await db.execute(sql`
    insert into payment_policy (tenant_id, offline_mode, offline_amount_cap)
    values (${s.tenantId}, ${mode}, ${cap})`);
}

describe("FakePaymentProvider.collect offline", () => {
  it("accepts offline when policy allows, staff opt in, and amount is within the cap", async () => {
    const s = await seedTenant();
    await setPolicy(s, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db);
    provider.offlineNextCollect();
    const r = await collect(provider, s, "10.00", true);
    expect(r.state).toBe("accepted_offline");
    expect(r.offline).toBe(true);
    expect(r.settledAt).not.toBeNull();
    const row = await db.transaction((tx) => findPaymentByRef(tx, "fake", r.paymentRef));
    expect(row?.state).toBe("accepted_offline");
    expect(row?.settledAt).not.toBeNull();
  });

  it("returns network_unavailable and writes nothing when staff did not opt in", async () => {
    const s = await seedTenant();
    await setPolicy(s, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db);
    provider.offlineNextCollect();
    const r = await collect(provider, s, "10.00", false);
    expect(r.state).toBe("network_unavailable");
    expect(r.settledAt).toBeNull();
    const row = await db.transaction((tx) => findPaymentByRef(tx, "fake", r.paymentRef));
    expect(row).toBeUndefined();
  });

  it("returns network_unavailable when there is no policy row (fail-safe)", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(db);
    provider.offlineNextCollect();
    const r = await collect(provider, s, "10.00", true);
    expect(r.state).toBe("network_unavailable");
  });

  it("returns network_unavailable over the cap", async () => {
    const s = await seedTenant();
    await setPolicy(s, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db);
    provider.offlineNextCollect();
    const r = await collect(provider, s, "50.01", true);
    expect(r.state).toBe("network_unavailable");
  });

  it("offlineNextCollect is one-shot — the next collect is a normal online capture", async () => {
    const s = await seedTenant();
    await setPolicy(s, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db);
    provider.offlineNextCollect();
    await collect(provider, s, "10.00", true);
    const online = await collect(provider, s, "10.00", true);
    expect(online.state).toBe("captured");
  });
});
```

Add `sql` to the imports at the top of the file if not present:

```ts
import { sql } from "drizzle-orm";
```

(It is already imported — confirm.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/payments test -- fake-provider`
Expected: FAIL — `offlineNextCollect` is not a function / `accepted_offline` never produced.

- [ ] **Step 3: Widen the provider types**

In `packages/payments/src/provider.ts` (the `PaymentState` union was already widened in Task 1 — do NOT touch it here):

Add below the `PaymentState` union:

```ts
/**
 * What a `collect` result may REPORT, which is wider than what is PERSISTED: `network_unavailable`
 * is returned when the network is down and offline acceptance is refused, but nothing durable is
 * written (no money moved), so it is deliberately NOT a `payment_state` enum value — it lives only
 * here, on the return path.
 */
export type PaymentResultState = PaymentState | "network_unavailable";
```

In `CollectParams`, add:

```ts
  /** Per-transaction staff consent to accept this card offline if the network is down (default
   * false). Even when true, acceptance still requires the tenant policy to allow it and the amount
   * to be within the cap — offline is never automatic. */
  allowOffline?: boolean;
```

In `PaymentResult`, change `state` to `PaymentResultState` and add `offline`:

```ts
  state: PaymentResultState;
  amount: Decimal;
  /** True only on an `accepted_offline` result: the card was accepted while the network was down and
   * awaits `forward()`. `settledAt` carries the acceptance time, so the sale chains immediately. */
  offline?: boolean;
  settledAt: Date | null;
```

Update the `PaymentProvider` interface doc comment where it lists later-plan methods so it names the current reality (no code change to the interface itself — `forward` does not join it this cycle):

```ts
 * `authorize`/`capture`/`preAuth`/`incrementalAuth`/`tipAdjust`/`reconcile` are later plans. So is
 * `forward` on THIS interface: `FakePaymentProvider` implements a concrete `forward` in Cycle A, but
 * the interface method is added in Cycle B when a real adapter implements it too (a required method
 * here would not compile against StripeTerminalProvider, which does not) — do not add it before then.
```

Then fix the existing type test `packages/payments/src/provider.test.ts`: its first case does
`r.state satisfies PaymentState`, which no longer typechecks now that `PaymentResult.state` is the
wider `PaymentResultState`. Import `PaymentResultState` and change that one line:

```ts
import type { PaymentResult, PaymentResultState } from "./provider.js";
```
```ts
    expect(r.state satisfies PaymentResultState).toBe("captured");
```

Optionally add a case asserting the new shape (keeps the file's coverage honest):

```ts
  it("accepts an offline-accepted result carrying the offline flag", () => {
    const r: PaymentResult = {
      provider: "fake",
      paymentRef: "pay-3",
      state: "accepted_offline",
      amount: decimal("10.00"),
      settledAt: new Date("2026-07-22T10:00:00Z"),
      offline: true,
    };
    expect(r.offline).toBe(true);
    expect(r.settledAt).not.toBeNull();
  });

  it("accepts a network_unavailable result (return-only, nothing settled)", () => {
    const r: PaymentResult = {
      provider: "fake",
      paymentRef: "pay-4",
      state: "network_unavailable",
      amount: decimal("10.00"),
      settledAt: null,
    };
    expect(r.state).toBe("network_unavailable");
  });
```

- [ ] **Step 4: Add `insertAcceptedOffline` to the store**

In `packages/payments/src/store.ts`, add next to `insertCapturedPayment` (it reuses the private `insertPayment`):

```ts
/** Insert an offline-accepted payment — state=accepted_offline, settledAt SET (the acceptance
 * time that feeds `RecordSaleTender.settledAt`, so the sale chains immediately). `forward()` later
 * advances it to `settled` or `declined`. Written only when the offline gate accepted. */
export async function insertAcceptedOffline(
  tx: Transaction,
  params: NewPayment & { settledAt: Date },
): Promise<void> {
  await insertPayment(tx, params, "accepted_offline", params.settledAt.toISOString());
}
```

Export it from `packages/payments/src/index.ts` (alongside the other store functions):

```ts
  insertAcceptedOffline,
```

- [ ] **Step 5: Implement the fake's offline path**

In `packages/payments/src/testing/fake-provider.ts`:

Add to the imports:

```ts
import { getPaymentPolicy, resolveOfflineDecision } from "../policy.js";
import { insertAcceptedOffline } from "../store.js";
```

Add the field and affordance to the class:

```ts
  private offlineNext = false;

  /** Test affordance: makes the next `collect` simulate a network outage, so it exercises the
   * offline gate (accept → accepted_offline, or refuse → network_unavailable) instead of an online
   * capture. One-shot, like `failNextCollect`. */
  offlineNextCollect(): void {
    this.offlineNext = true;
  }
```

At the very top of `collect`, branch to the offline path before the online logic:

```ts
  async collect(params: CollectParams): Promise<PaymentResult> {
    const paymentRef = nextRef();
    if (this.offlineNext) {
      this.offlineNext = false;
      return this.collectOffline(params, paymentRef);
    }
    // ...existing online body unchanged, reusing `paymentRef`...
```

(Move the existing `const paymentRef = nextRef();` line: `paymentRef` is now declared once at the top and reused by both branches — delete the old declaration further down.)

Add the private method:

```ts
  /** The offline branch of `collect`: read the tenant policy, apply the neutral gate. On "accept"
   * write an `accepted_offline` row (settledAt = acceptance time) and report `offline: true`; on
   * "refuse" write NOTHING and report `network_unavailable` (no money moved). */
  private async collectOffline(
    params: CollectParams,
    paymentRef: string,
  ): Promise<PaymentResult> {
    const decision = await this.db.transaction(async (tx) => {
      const policy = await getPaymentPolicy(tx, params.tenantId);
      return resolveOfflineDecision(policy, params.allowOffline ?? false, params.amount);
    });
    if (decision === "refuse") {
      return {
        provider: this.provider,
        paymentRef,
        state: "network_unavailable",
        amount: params.amount,
        settledAt: null,
      };
    }
    const settledAt = new Date();
    await this.db.transaction((tx) =>
      insertAcceptedOffline(tx, {
        tenantId: params.tenantId,
        workingOrderId: params.workingOrderId,
        provider: this.provider,
        paymentRef,
        amount: params.amount,
        settledAt,
      }),
    );
    return {
      provider: this.provider,
      paymentRef,
      state: "accepted_offline",
      amount: params.amount,
      settledAt,
      offline: true,
    };
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/payments test -- fake-provider`
Expected: PASS (offline + existing online cases).

- [ ] **Step 7: Typecheck (catches any narrower `PaymentState` consumer), lint, format, commit**

```bash
pnpm --filter @waitron/payments typecheck && pnpm --filter @waitron/payments lint && pnpm format:check
git add packages/payments/src/provider.ts packages/payments/src/store.ts packages/payments/src/testing/fake-provider.ts packages/payments/src/testing/fake-provider.test.ts packages/payments/src/index.ts
git commit -m "feat(payments): offline collect (accepted_offline / network_unavailable) via the fake (2b-A task 3)"
```

---

### Task 4: `forward()` — store helpers, the fake's drain, and the decline incident

**Files:**
- Modify: `packages/payments/src/provider.ts` (`ForwardResult`)
- Modify: `packages/payments/src/errors.ts` (`payment.offline_forward_declined`)
- Modify: `packages/payments/src/store.ts` (`ForwardablePayment`, `claimAcceptedOffline`, `settleForwarded`, `declineForwarded`)
- Modify: `packages/payments/src/testing/fake-provider.ts` (`forward`, `declineForwardFor`, the till lookup + incident)
- Modify: `packages/payments/src/index.ts` (barrel)
- Modify (test): `packages/payments/src/testing/fake-provider.test.ts`

**Interfaces:**
- Consumes: `recordIncidentOnce` (`@waitron/core`); brand fns (`@waitron/shared`); `workingOrders` (`@waitron/db`).
- Produces:
  - `interface ForwardResult { nextDueAt: Date | null; forwarded: number; declined: number; incidentsRaised: number }`.
  - `interface ForwardablePayment { tenantId: string; paymentRef: string; workingOrderId: string; saleId: string | null; amount: string }`.
  - `claimAcceptedOffline(tx, provider): Promise<ForwardablePayment[]>` (FOR UPDATE SKIP LOCKED).
  - `settleForwarded(tx, key): Promise<void>`; `declineForwarded(tx, key): Promise<void>` (each matches only a still-`accepted_offline` row → idempotent).
  - `FakePaymentProvider.forward(now): Promise<ForwardResult>`; `FakePaymentProvider.declineForwardFor(ref): void`.
  - Error `payment.offline_forward_declined: { paymentRef: string; amount: string }`.

- [ ] **Step 1: Write the failing forward tests**

Add to `packages/payments/src/testing/fake-provider.test.ts`. These need a real till + associated sale so the decline incident carries a `till_id`/`sale_id`; reuse `seedSale` + `associatePaymentWithSale`:

```ts
import { openIncidents } from "@waitron/core";
import { associatePaymentWithSale } from "../store.js";
import { seedSale } from "../../test/seed.js";
import { tillId as brandTillId2 } from "@waitron/shared"; // if brandTillId not already imported, reuse it

// helper: offline-accept a payment for `s`, then associate it to a fresh sale, returning the ref.
async function acceptOfflineAndAssociate(
  provider: FakePaymentProvider,
  s: Seeded,
  amount = "10.00",
): Promise<string> {
  provider.offlineNextCollect();
  const r = await collect(provider, s, amount, true);
  const saleId = await seedSale(db, s);
  await db.transaction((tx) =>
    associatePaymentWithSale(tx, {
      tenantId: s.tenantId,
      provider: "fake",
      paymentRef: r.paymentRef,
      saleId,
    }),
  );
  return r.paymentRef;
}

describe("FakePaymentProvider.forward", () => {
  it("settles an accepted_offline payment the network clears", async () => {
    const s = await seedTenant();
    await setPolicy(s, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db);
    const ref = await acceptOfflineAndAssociate(provider, s);
    const result = await provider.forward(new Date());
    expect(result).toMatchObject({ forwarded: 1, declined: 0, incidentsRaised: 0, nextDueAt: null });
    const row = await db.transaction((tx) => findPaymentByRef(tx, "fake", ref));
    expect(row?.state).toBe("settled");
  });

  it("declines a payment the network refuses, raising one incident, without touching the sale", async () => {
    const s = await seedTenant();
    await setPolicy(s, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db);
    const ref = await acceptOfflineAndAssociate(provider, s);
    provider.declineForwardFor(ref);
    const result = await provider.forward(new Date());
    expect(result).toMatchObject({ forwarded: 0, declined: 1, incidentsRaised: 1 });
    const row = await db.transaction((tx) => findPaymentByRef(tx, "fake", ref));
    expect(row?.state).toBe("declined");
    const incidents = await db.transaction((tx) => openIncidents(tx, brandTillId(s.tillId)));
    expect(incidents).toHaveLength(1);
    expect(incidents[0].code).toBe("payment.offline_forward_declined");
  });

  it("is idempotent — a second forward advances nothing and raises no duplicate incident", async () => {
    const s = await seedTenant();
    await setPolicy(s, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(db);
    const ref = await acceptOfflineAndAssociate(provider, s);
    provider.declineForwardFor(ref);
    await provider.forward(new Date());
    const second = await provider.forward(new Date());
    expect(second).toMatchObject({ forwarded: 0, declined: 0, incidentsRaised: 0 });
    const incidents = await db.transaction((tx) => openIncidents(tx, brandTillId(s.tillId)));
    expect(incidents).toHaveLength(1);
  });

  it("returns all-zeros when there is nothing to forward", async () => {
    const provider = new FakePaymentProvider(db);
    const result = await provider.forward(new Date());
    expect(result).toEqual({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  });
});
```

(Consolidate imports — `brandTillId`, `sql`, `openIncidents`, `associatePaymentWithSale`, `seedSale`, `findPaymentByRef` — into the existing import groups; do not add the illustrative `brandTillId2` alias.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/payments test -- fake-provider`
Expected: FAIL — `forward`/`declineForwardFor` not defined.

- [ ] **Step 3: Add `ForwardResult` to `provider.ts`**

```ts
/**
 * The outcome of one `forward(now)` pass — the offline store-and-forward drain, shaped exactly like
 * fiscal's `DrainResult`. `nextDueAt` is the only field a scheduler needs (null = nothing pending);
 * the counts are for a log line. Implemented by `FakePaymentProvider` in Cycle A; joins
 * `PaymentProvider` in Cycle B (see the interface doc). A provider with nothing pending returns
 * `{ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 }`.
 */
export interface ForwardResult {
  nextDueAt: Date | null;
  forwarded: number;
  declined: number;
  incidentsRaised: number;
}
```

- [ ] **Step 4: Add the incident error code**

In `packages/payments/src/errors.ts`, add inside the `ErrorParams` interface:

```ts
    /** Raised as an INCIDENT (never thrown) by a `forward` pass when the network refuses a
     * previously offline-accepted payment. The sale already chained and is immutable, so this is a
     * staff-facing uncollected-receivable / bad-debt notice for the till, not a fiscal reversal. */
    "payment.offline_forward_declined": { paymentRef: string; amount: string };
```

- [ ] **Step 5: Add the forward store helpers**

In `packages/payments/src/store.ts`, add (import `workingOrders` is NOT needed here — the till lookup lives in the fake; these helpers only touch `payments`):

```ts
/** One accepted-offline payment claimed for a forward pass. `saleId` is null only for an orphan
 * (accepted but never associated); the fake/adapter uses `workingOrderId` to find the till for the
 * decline incident. */
export interface ForwardablePayment {
  tenantId: string;
  paymentRef: string;
  workingOrderId: string;
  saleId: string | null;
  amount: string;
}

/** Claim this provider's accepted-offline payments for a forward pass, locking each row FOR UPDATE
 * SKIP LOCKED so concurrent `forward` passes partition the queue and never double-advance a row.
 * State IS the queue (no outbox table). Ordered by `created_at` for a stable pass. */
export async function claimAcceptedOffline(
  tx: Transaction,
  provider: string,
): Promise<ForwardablePayment[]> {
  return tx
    .select({
      tenantId: payments.tenantId,
      paymentRef: payments.paymentRef,
      workingOrderId: payments.workingOrderId,
      saleId: payments.saleId,
      amount: payments.amount,
    })
    .from(payments)
    .where(and(eq(payments.provider, provider), eq(payments.state, "accepted_offline")))
    .orderBy(payments.createdAt)
    .for("update", { skipLocked: true });
}

/** Advance a forwarded offline payment to `settled` (the network cleared it). Matches only a row
 * still `accepted_offline`, so re-running a completed forward is a no-op (idempotent). */
export async function settleForwarded(tx: Transaction, params: Key): Promise<void> {
  await tx
    .update(payments)
    .set({ state: "settled", updatedAt: sql`now()` })
    .where(and(keyWhere(params), eq(payments.state, "accepted_offline")));
}

/** Advance a forwarded offline payment to `declined` (the network refused). Matches only a row
 * still `accepted_offline` (idempotent). The uncollected-receivable incident is raised by the
 * caller (the `forward` implementation), not here — keeping `@waitron/core` out of this neutral
 * store, exactly as fiscal's `drain` raises incidents in the adapter, not in `packages/fiscal`. */
export async function declineForwarded(tx: Transaction, params: Key): Promise<void> {
  await tx
    .update(payments)
    .set({ state: "declined", updatedAt: sql`now()` })
    .where(and(keyWhere(params), eq(payments.state, "accepted_offline")));
}
```

Export the four names from `packages/payments/src/index.ts` (functions in the `store.js` export block, and the type):

```ts
  claimAcceptedOffline,
  declineForwarded,
  settleForwarded,
```
```ts
export type { ForwardablePayment, PaymentRecord, PaymentRow } from "./store.js";
```

- [ ] **Step 6: Implement the fake's `forward`**

In `packages/payments/src/testing/fake-provider.ts`:

Add imports:

```ts
import { and, eq } from "drizzle-orm";
import { recordIncidentOnce } from "@waitron/core";
import {
  saleId as brandSaleId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { workingOrders } from "@waitron/db";
import {
  claimAcceptedOffline,
  declineForwarded,
  settleForwarded,
} from "../store.js";
import type { ForwardResult } from "../provider.js";
```

Add the decline-set field + affordance:

```ts
  private readonly declineForwardRefs = new Set<string>();

  /** Test affordance: the next `forward` will DECLINE (network-refuse) this payment ref instead of
   * settling it, exercising the decline → incident path. */
  declineForwardFor(ref: string): void {
    this.declineForwardRefs.add(ref);
  }
```

Add the method:

```ts
  /**
   * The offline store-and-forward drain: claim this provider's `accepted_offline` rows (FOR UPDATE
   * SKIP LOCKED) and advance each. Refs flagged via `declineForwardFor` are declined (→ `declined`,
   * plus one idempotent uncollected-receivable incident for the till); all others settle (→
   * `settled`). No network here, so claim + advance + incident share one transaction; a real adapter
   * (Cycle B) splits them T1/T2. `nextDueAt` is null — the fake has nothing time-scheduled.
   */
  async forward(now: Date): Promise<ForwardResult> {
    return this.db.transaction(async (tx) => {
      const claimed = await claimAcceptedOffline(tx, this.provider);
      let forwarded = 0;
      let declined = 0;
      let incidentsRaised = 0;
      for (const p of claimed) {
        const key = { tenantId: p.tenantId, provider: this.provider, paymentRef: p.paymentRef };
        if (this.declineForwardRefs.has(p.paymentRef)) {
          await declineForwarded(tx, key);
          declined += 1;
          const [wo] = await tx
            .select({ tillId: workingOrders.tillId })
            .from(workingOrders)
            .where(and(eq(workingOrders.tenantId, p.tenantId), eq(workingOrders.id, p.workingOrderId)));
          const raised = await recordIncidentOnce(tx, {
            tenantId: brandTenantId(p.tenantId),
            tillId: brandTillId(wo.tillId),
            ...(p.saleId === null ? {} : { saleId: brandSaleId(p.saleId) }),
            error: new AppError("payment.offline_forward_declined", {
              paymentRef: p.paymentRef,
              amount: p.amount,
            }),
            severity: "error",
            detectedAt: now,
          });
          if (raised) incidentsRaised += 1;
        } else {
          await settleForwarded(tx, key);
          forwarded += 1;
        }
      }
      return { nextDueAt: null, forwarded, declined, incidentsRaised };
    });
  }
```

(`AppError` is already imported at the top of the fake.)

- [ ] **Step 7: Export `ForwardResult` from the barrel**

In `packages/payments/src/index.ts`, add `ForwardResult` to the `provider.js` type re-export list:

```ts
export type {
  CollectParams,
  ForwardResult,
  PaymentProvider,
  PaymentResult,
  PaymentResultState,
  PaymentState,
  ProviderCapabilities,
} from "./provider.js";
```

(Also add `PaymentResultState` here if not already exported from Task 3 — it belongs on the public surface.)

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/payments test -- fake-provider`
Expected: PASS (settle, decline+incident, idempotency, empty).

- [ ] **Step 9: Typecheck, lint, format, commit**

```bash
pnpm --filter @waitron/payments typecheck && pnpm --filter @waitron/payments lint && pnpm format:check
git add packages/payments/src/provider.ts packages/payments/src/errors.ts packages/payments/src/store.ts packages/payments/src/testing/fake-provider.ts packages/payments/src/testing/fake-provider.test.ts packages/payments/src/index.ts
git commit -m "feat(payments): forward() offline drain + decline incident via the fake (2b-A task 4)"
```

---

### Task 5: Real-Postgres RLS — `payment_policy` and offline payments under a probe role

**Files:**
- Create (test): `packages/payments/src/payment-policy.rls.test.ts`

**Interfaces:**
- Consumes: `startRealPostgres`, `withTenant`, `getPaymentPolicy`, `insertAcceptedOffline`, `getPaymentByRef`, `seedWorkingOrder`.

- [ ] **Step 1: Write the RLS test**

Create `packages/payments/src/payment-policy.rls.test.ts` (mirrors `payments.rls.test.ts` — non-superuser role, `withTenant` scope, cross-tenant hidden):

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { getPaymentByRef, getPaymentPolicy, insertAcceptedOffline } from "./store.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedWorkingOrder } from "../test/seed.js";

const PROBE_ROLE = "rls_probe_policy";
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

const SETTLED = new Date("2026-07-23T10:00:00Z");

describe("payment_policy + offline payments under real row-level security", () => {
  it("an app_user role reads its own tenant's policy and offline payment, and only its own", async () => {
    const tenantA = await seedWorkingOrder(admin, "B31111111");
    const tenantB = await seedWorkingOrder(admin, "B32222222");
    // Seed A's policy as superuser (RLS bypassed for setup).
    await admin.execute(sql`
      insert into payment_policy (tenant_id, offline_mode, offline_amount_cap)
      values (${tenantA.tenantId}, 'accept_offline', '40.00')`);

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // INSERT an accepted_offline payment as rls_probe, scoped to A — proves INSERT grant + WITH CHECK.
      await withTenant(probe, tenantA.tenantId, (tx) =>
        insertAcceptedOffline(tx, {
          tenantId: tenantA.tenantId,
          workingOrderId: tenantA.workingOrderId,
          provider: "fake",
          paymentRef: "off-1",
          amount: decimal("10.00"),
          settledAt: SETTLED,
        }),
      );

      // Read policy + payment scoped to A — proves SELECT grant + USING.
      const policyA = await withTenant(probe, tenantA.tenantId, (tx) =>
        getPaymentPolicy(tx, tenantA.tenantId),
      );
      expect(policyA).toEqual({ offlineMode: "accept_offline", offlineAmountCap: "40.00" });
      const payA = await withTenant(probe, tenantA.tenantId, (tx) =>
        getPaymentByRef(tx, { tenantId: tenantA.tenantId, provider: "fake", paymentRef: "off-1" }),
      );
      expect(payA?.state).toBe("accepted_offline");

      // Same reads scoped to B — the isolation policy hides A's rows.
      const policyB = await withTenant(probe, tenantB.tenantId, (tx) =>
        getPaymentPolicy(tx, tenantA.tenantId),
      );
      expect(policyB).toBeUndefined();
      const payB = await withTenant(probe, tenantB.tenantId, (tx) =>
        getPaymentByRef(tx, { tenantId: tenantA.tenantId, provider: "fake", paymentRef: "off-1" }),
      );
      expect(payB).toBeUndefined();
    } finally {
      await probe.close();
    }
  });
});
```

- [ ] **Step 2: Run it (needs Docker)**

Run: `pnpm --filter @waitron/payments test -- payment-policy.rls`
Expected: PASS. (If it THROWS "requires a running Docker daemon", start Docker and rerun — never skip.)

- [ ] **Step 3: Lint, format, commit**

```bash
pnpm --filter @waitron/payments lint && pnpm format:check
git add packages/payments/src/payment-policy.rls.test.ts
git commit -m "test(payments): real-PG RLS for payment_policy + offline payments (2b-A task 5)"
```

---

### Task 6: Real-Postgres concurrency — `claimAcceptedOffline` SKIP LOCKED partitions the queue

**Files:**
- Create (test): `packages/payments/src/forward.concurrency.test.ts`

**Interfaces:**
- Consumes: `startRealPostgres`, `withTenant`, `insertAcceptedOffline`, `claimAcceptedOffline`, `seedWorkingOrder`.

- [ ] **Step 1: Write the concurrency test**

Create `packages/payments/src/forward.concurrency.test.ts`. Seed two `accepted_offline` rows. The holder locks exactly ONE of them (a raw `for update skip locked limit 1`) and holds its transaction open; the waiter's real `claimAcceptedOffline` must then return exactly the OTHER row — proving concurrent forwards get disjoint, **non-empty** partitions (never the same row twice) and never block. Mirrors `reversal.concurrency.test.ts`'s holder/waiter + acquired-signal. (If SKIP LOCKED were absent, the waiter would block on the locked row and the test would hang to timeout.)

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { claimAcceptedOffline, insertAcceptedOffline } from "./store.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

let pg: RealPostgres;
let admin: import("@waitron/db").Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
});
afterAll(async () => {
  await admin.close();
  await pg.stop();
});

const SETTLED = new Date("2026-07-23T10:00:00Z");

describe("claimAcceptedOffline SKIP LOCKED partitions the queue across concurrent forwards", () => {
  it("a concurrent claim skips the row the holder locked and returns exactly the other", async () => {
    const seeded = await seedWorkingOrder(admin, freshNif());
    for (const ref of ["q1", "q2"]) {
      await admin.transaction((tx) =>
        insertAcceptedOffline(tx, {
          tenantId: seeded.tenantId,
          workingOrderId: seeded.workingOrderId,
          provider: "fake",
          paymentRef: ref,
          amount: decimal("10.00"),
          settledAt: SETTLED,
        }),
      );
    }

    const holder = await pg.connect();
    const waiter = await pg.connect();
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));
      let lockedRef = "";
      // Holder locks exactly ONE accepted_offline row and holds the transaction open.
      holding = withTenant(holder, seeded.tenantId, async (tx) => {
        const locked = await tx.execute<{ payment_ref: string }>(sql`
          select payment_ref from payments
          where provider = 'fake' and state = 'accepted_offline'
          order by created_at limit 1 for update skip locked`);
        lockedRef = locked.rows[0].payment_ref;
        acquire();
        await held;
      });
      await acquired;

      // The waiter's real claimAcceptedOffline runs WHILE the holder holds its lock. SKIP LOCKED
      // means it returns immediately (never blocks) with exactly the row the holder did NOT lock.
      const secondClaim = await withTenant(waiter, seeded.tenantId, (tx) =>
        claimAcceptedOffline(tx, "fake"),
      );
      const secondRefs = secondClaim.map((r) => r.paymentRef);

      expect(secondRefs).not.toContain(lockedRef); // never the locked row
      expect(secondRefs).toEqual(["q1", "q2"].filter((r) => r !== lockedRef)); // exactly the other
      expect(secondRefs).toHaveLength(1);

      release();
      await holding;
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await waiter.close();
    }
  });
});
```

- [ ] **Step 2: Run it (needs Docker)**

Run: `pnpm --filter @waitron/payments test -- forward.concurrency`
Expected: PASS.

- [ ] **Step 3: Lint, format, commit**

```bash
pnpm --filter @waitron/payments lint && pnpm format:check
git add packages/payments/src/forward.concurrency.test.ts
git commit -m "test(payments): real-PG SKIP LOCKED partitioning for forward (2b-A task 6)"
```

---

### Task 7: Capstone wiring — offline accept → sale chains → forward decline → incident, sale immutable

**Files:**
- Create (test): `packages/payments/src/offline.wiring.test.ts`

**Interfaces:**
- Consumes: `recordSale` + `RecordSaleInput` + `openIncidents` (`@waitron/core`), `FakeFiscalBackend` + `TrustedClock` (`@waitron/fiscal`), `FakePaymentProvider`, `associatePaymentWithSale`, `seedForSale`.

- [ ] **Step 1: Write the capstone test**

Create `packages/payments/src/offline.wiring.test.ts`. This proves the full §5 offline flow AND that a later forward-decline does NOT un-chain the immutable sale:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { openIncidents, recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { associatePaymentWithSale } from "./store.js";
import { FakePaymentProvider } from "./testing/fake-provider.js";
import { freshNif, seedForSale } from "../test/seed.js";
import type { SeededForSale } from "../test/seed.js";

let db: Database;
beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
  await FakeFiscalBackend.install(db);
}, 60_000);
afterAll(async () => {
  await db.close();
});

const BASE = new Date("2026-03-01T13:05:00+01:00");
const steadyClock: TrustedClock = {
  now: () => ({
    instant: BASE,
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("steadyClock: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

function buildInput(s: SeededForSale, settledAt: Date): RecordSaleInput {
  return {
    tenantId: brandTenantId(s.tenantId),
    tillId: brandTillId(s.tillId),
    seriesId: brandSeriesId(s.seriesId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    locale: "es",
    invoiceLocales: ["es"],
    total: "10.00",
    tipAmount: "0.00",
    lines: [
      {
        lineNo: 1,
        descriptions: { es: "Item" },
        quantity: "1",
        unitPrice: "10.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
    ],
    tenders: [{ method: "card", amount: "10.00", settledAt }],
    fiscalBackend: "fake",
    clock: steadyClock,
  };
}

describe("offline accept -> recordSale -> associate -> forward decline (sale stays chained)", () => {
  it("chains the sale on an offline-accepted tender, then a forward-decline raises an incident without un-chaining it", async () => {
    const backend = new FakeFiscalBackend(db);
    const s = await seedForSale(db, backend, freshNif());
    await db.execute(sql`
      insert into payment_policy (tenant_id, offline_mode, offline_amount_cap)
      values (${s.tenantId}, 'accept_offline', '50.00')`);

    // 1. Offline accept BEFORE the sale transaction (there is an acceptance step, unlike manual mode).
    const provider = new FakePaymentProvider(db);
    provider.offlineNextCollect();
    const paid = await provider.collect({
      tenantId: brandTenantId(s.tenantId),
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("10.00"),
      allowOffline: true,
    });
    expect(paid.state).toBe("accepted_offline");
    expect(paid.offline).toBe(true);
    expect(paid.settledAt).not.toBeNull();

    // 2. The settled tender chains the sale; associate the payment in the same transaction.
    const saleId = await db.transaction(async (tx) => {
      const recorded = await recordSale(tx, backend, buildInput(s, paid.settledAt as Date));
      await associatePaymentWithSale(tx, {
        tenantId: s.tenantId,
        provider: "fake",
        paymentRef: paid.paymentRef,
        saleId: recorded.saleId,
      });
      return recorded.saleId;
    });

    // 3. Later, the network refuses the forwarded payment.
    provider.declineForwardFor(paid.paymentRef);
    const result = await provider.forward(BASE);
    expect(result).toMatchObject({ forwarded: 0, declined: 1, incidentsRaised: 1 });

    // The payment is declined; the SALE is untouched (immutable — same row, still present).
    const rows = await db.execute<{ state: string; sale_id: string | null }>(sql`
      select state, sale_id from payments where tenant_id = ${s.tenantId}`);
    expect(rows.rows[0].state).toBe("declined");
    expect(rows.rows[0].sale_id).toBe(saleId);
    const sale = await db.execute<{ id: string }>(
      sql`select id from sales where id = ${saleId}`,
    );
    expect(sale.rows).toHaveLength(1); // the sale was NOT voided or removed

    // One staff-facing incident exists for the till.
    const incidents = await db.transaction((tx) => openIncidents(tx, brandTillId(s.tillId)));
    expect(incidents).toHaveLength(1);
    expect(incidents[0].code).toBe("payment.offline_forward_declined");
    expect(incidents[0].saleId).toBe(saleId);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @waitron/payments test -- offline.wiring`
Expected: PASS.

- [ ] **Step 3: Full suite, typecheck, lint, format, commit**

```bash
pnpm --filter @waitron/payments test
pnpm --filter @waitron/payments typecheck && pnpm --filter @waitron/payments lint && pnpm format:check
git add packages/payments/src/offline.wiring.test.ts
git commit -m "test(payments): offline capstone — accept, chain, forward-decline, sale immutable (2b-A task 7)"
```

---

## Final verification (before finish-branch)

- [ ] `pnpm --filter @waitron/payments test` — all suites green (incl. real-PG RLS/concurrency with Docker running; a transient Docker outage clears on `gh run rerun <id> --failed`, not a code issue).
- [ ] `pnpm --filter @waitron/payments typecheck` — no errors (widening `PaymentState`/`PaymentResult.state` must not have broken any narrower consumer).
- [ ] `pnpm --filter @waitron/payments lint` and `pnpm format:check` — both clean.
- [ ] `no-provider-vocabulary.test.ts`, `schema-ownership.test.ts`, `monetary-columns.test.ts` — green (new vocabulary is neutral; barrel re-exports no core table; the cap is `numeric(12,2)`).
- [ ] `@waitron/core` is still under `devDependencies` in `packages/payments/package.json` (only the test-only fake imports it); `src/index.ts` imports nothing from `@waitron/core`.
- [ ] `FakePaymentProvider` is NOT re-exported from `src/index.ts`.
- [ ] Repo-wide `pnpm -r typecheck` — confirms `payments-stripe` still compiles (it does not implement `forward`; the interface deliberately did not gain it this cycle).

## Coverage / gaps note

- **Not in this cycle (Cycle B / deferred, per the design's "Out of scope"):** the real on-device Stripe binding (connection tokens, device-side collect, device-local `forward` queue, nightly sandbox); adding `forward` to the `PaymentProvider` interface; webhooks + untenanted `(provider, external_ref)` resolution; the `forward`/`reconcile` scheduler (`apps/*`); reversing an offline `settled` payment (the reversal guards still admit only `captured`/`partially_refunded`); capture-mode config (SP7); the reversal role-gate (SP5); the till UI (SP7).
