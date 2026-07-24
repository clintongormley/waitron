# Payment Mode 2b — Cycle B (on-device Stripe binding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the real on-device Stripe binding behind Cycle A's offline layer, promote `forward` to a first-class `PaymentProvider` method, and make the shared `incidents` dedup race-safe — so the waiter's handheld can accept and forward offline card tenders through the same neutral store.

**Architecture:** Two halves in one cycle. **Neutral** (`@waitron/payments` + `@waitron/core`/`@waitron/db`): `forward` joins the `PaymentProvider` interface; the 2a `StripeTerminalProvider` gains an all-zeros `forward`; a table-wide partial unique index on `incidents` plus `ON CONFLICT DO NOTHING` on both incident writers makes concurrent same-key raises collapse to one open incident. **Adapter** (`@waitron/payments-stripe`): a second provider class `StripeOnDeviceProvider` behind its own narrow `StripeDeviceClient` seam (faked hermetically, real binding coverage-excluded) — gate-up-front `collect`, a T1/T2 `forward` driving the device-local offline queue, connection tokens, and reversals reusing the 2a path.

**Tech Stack:** TypeScript (ESM), drizzle-orm 0.45 (Postgres 18 / PGlite), vitest, testcontainers, the `stripe` SDK ^22.3.2. Money is exact-decimal `numeric(12,2)` throughout — no floats.

## Global Constraints

- **Amounts are exact `Decimal`** across every seam; the only major→minor conversion is `toMinorUnits` in `client.ts`. No float ever touches the money path.
- **T1/T2 discipline:** never hold a DB transaction across a network/device call. Each provider method does its own short transactions.
- **Postgres is `postgres:18-alpine`** in every real-PG harness; `NULLS NOT DISTINCT` (PG 15+) is available with no fallback. Real-PG suites **never skip** (PGlite's superuser bypasses RLS) — they throw when Docker is absent.
- **Coverage thresholds** (CI-only gate, not the pre-push hook): `statements/lines/functions: 98`, `branches: 95`. Run `pnpm --filter <pkg> test:coverage` locally before pushing. Real SDK bindings, `src/testing/**`, `*.sandbox.test.ts`, and barrels are coverage-excluded.
- **Neutral-vocabulary guard:** `@waitron/payments` must contain no provider/SDK vocabulary. The banned substrings include `stripe`, `reader`, `terminal`, `connectiontoken`, `paymentintent`, `acquirer` (blunt case-insensitive substring test). Every new *neutral* identifier must avoid those substrings. All Stripe/device vocabulary lives in `@waitron/payments-stripe`, which is scanned by neither guard.
- **`format:check` (prettier) is a pre-push + CI gate**, separate from per-package `lint` (eslint). Run `pnpm format:check` (or `prettier --write`) before pushing. Design/plan `.md` are `.prettierignore`d.
- **The provider id for both Stripe adapters is the string `"stripe"`** — same PSP/account means one settlement identity for a future `reconcile`; the mechanism (server-driven vs on-device) is not stored. Only the on-device provider ever creates `accepted_offline` rows, so `forward`'s `provider = 'stripe'` scoping is unambiguous.

---

## File Structure

**Neutral — `@waitron/payments`:**
- Modify `packages/payments/src/provider.ts` — add `forward` to the `PaymentProvider` interface; rewrite the two doc comments that say it is deferred.
- Modify `packages/payments/src/store.ts` — add `listAcceptedOffline` (the non-locking read `forward`'s T1 uses).
- Modify `packages/payments/src/index.ts` — export `listAcceptedOffline`.
- Create `packages/payments/src/incident-dedup.concurrency.test.ts` — real-PG proof that concurrent same-key raises collapse to one incident.

**Neutral — `@waitron/core` / `@waitron/db` (the incident invariant):**
- Create `packages/db/drizzle/0009_incidents_open_dedup.sql` (+ its journal/snapshot entries via `db:generate:custom`) — the partial unique index.
- Modify `packages/core/src/incidents.ts` — both writers → `ON CONFLICT DO NOTHING`; rewrite doc comments.
- Modify `packages/core/src/incidents.test.ts` — add dedup tests (incl. the `sale_id IS NULL` / `NULLS NOT DISTINCT` case) and the unconditional-`recordIncident` dedup.

**Adapter — `@waitron/payments-stripe`:**
- Modify `packages/payments-stripe/src/provider.ts` — add the all-zeros `forward` to `StripeTerminalProvider`; delegate its reversals to the shared helper.
- Create `packages/payments-stripe/src/reverse.ts` — `reverseViaStripe(...)`, the shared void/refund/partialRefund path both Stripe providers delegate to (extracted from 2a's `StripeTerminalProvider.reverse`).
- Create `packages/payments-stripe/src/device-client.ts` — the `StripeDeviceClient` interface.
- Create `packages/payments-stripe/src/stripe-device-client.ts` — real impl (coverage-excluded).
- Create `packages/payments-stripe/src/device-provider.ts` — `StripeOnDeviceProvider` + options (reversals delegate to `reverseViaStripe`).
- Create `packages/payments-stripe/src/testing/fake-stripe-device.ts` — `FakeStripeDevice` (scenario-based: `offlineAllowed` is load-bearing).
- Modify `packages/payments-stripe/src/index.ts` — export the new provider, options type, client type, real client.
- Create `packages/payments-stripe/src/device-provider.test.ts` — hermetic collect/forward/reversals + the 2a all-zeros-forward test.
- Create `packages/payments-stripe/src/device.rls.test.ts` — real-PG RLS on the device lifecycle + `listAcceptedOffline`.
- Create `packages/payments-stripe/src/device.wiring.test.ts` — offline-tender-chains-a-sale capstone.
- Modify `packages/payments-stripe/vitest.config.ts` — coverage-exclude `src/stripe-device-client.ts`.
- Create `packages/payments-stripe/src/connection-token.sandbox.test.ts` — server-side nightly sandbox.

---

## Task 1: The race-safe `incidents` dedup primitive

**Files:**
- Create: `packages/db/drizzle/0009_incidents_open_dedup.sql` (+ `meta/_journal.json` + `meta/0009_snapshot.json` entries)
- Modify: `packages/core/src/incidents.ts:46-95`
- Test: `packages/core/src/incidents.test.ts` (extend the existing PGlite suite)

**Interfaces:**
- Consumes: `incidents` table (`packages/db/src/schema/incidents.ts`), `CORE_MIGRATIONS`.
- Produces: `recordIncident(tx, input): Promise<void>` and `recordIncidentOnce(tx, input): Promise<boolean>` — both now dedup on the open-incident key via `ON CONFLICT DO NOTHING`. Signatures unchanged.

- [ ] **Step 1: Generate the empty custom migration scaffold**

Run: `pnpm --filter @waitron/db db:generate:custom -- --name incidents_open_dedup`
Expected: creates `packages/db/drizzle/0009_incidents_open_dedup.sql` (empty), adds an `idx: 9`, `tag: "0009_incidents_open_dedup"` entry to `packages/db/drizzle/meta/_journal.json`, and writes `meta/0009_snapshot.json`.

Verify the file + journal entry exist:
Run: `ls packages/db/drizzle/0009_incidents_open_dedup.sql && grep -c '"0009_incidents_open_dedup"' packages/db/drizzle/meta/_journal.json`
Expected: the path prints and the grep returns `1`. (If drizzle-kit named the file with a random slug instead, rename it to `0009_incidents_open_dedup.sql` and set the matching journal `tag`.)

- [ ] **Step 2: Write the migration SQL**

Write into `packages/db/drizzle/0009_incidents_open_dedup.sql`:

```sql
-- Hand-written (a --custom migration drizzle-kit will never regenerate): a PARTIAL unique index with
-- NULLS NOT DISTINCT cannot be expressed by drizzle-orm 0.45's schema builder — its index builder has
-- .where() but no .nullsNotDistinct() (that lives only on the non-partial unique-CONSTRAINT builder).
-- So it is added here as raw SQL, exactly the way policies/grants are (0008_incidents_privileges.sql).
-- Because it is not in the drizzle schema snapshot, drizzle-kit does not diff it and will never
-- propose dropping it.
--
-- The table-wide invariant: at most ONE open incident per (tenant, till, code, sale). This is what
-- makes recordIncident / recordIncidentOnce's ON CONFLICT DO NOTHING race-free under a concurrent
-- caller (payments Cycle B's on-device forward). NULLS NOT DISTINCT (PG15+; the server is PG18) makes
-- two orphan declines (sale_id IS NULL) on one till collapse to a single open incident, matching
-- recordIncidentOnce's `sale_id IS NOT DISTINCT FROM` dedup semantics. The partial predicate frees the
-- key once an incident is acknowledged, so a genuinely-recurring condition resurfaces.
CREATE UNIQUE INDEX "incidents_open_dedup"
  ON "incidents" ("tenant_id", "till_id", "code", "sale_id")
  NULLS NOT DISTINCT
  WHERE "acknowledged_at" IS NULL;
```

- [ ] **Step 3: Write failing tests for the new dedup behaviour**

Add to `packages/core/src/incidents.test.ts` inside a new `describe`. These mirror the file's existing helpers (`withTenant`, `asAppUser`, `incidentsForTill`, the tenant/till seeding it already does — reuse them exactly as the existing `recordIncidentOnce` group does).

```ts
describe("incidents open-dedup invariant (partial unique index)", () => {
  it("recordIncident (unconditional) de-dups a second OPEN same-key raise to one row", async () => {
    const { tenantId, tillId } = await seedTillForIncidents(); // reuse the suite's existing seeding
    const input = {
      tenantId,
      tillId,
      error: new AppError("chain.verification_failed", { saleId: "s-x" }),
      severity: "error" as const,
      detectedAt: new Date("2026-07-24T10:00:00Z"),
    };
    await withTenant(db, tenantId, (tx) => recordIncident(asAppUser(tx), input));
    await withTenant(db, tenantId, (tx) => recordIncident(asAppUser(tx), input));
    const rows = await incidentsForTill(tillId);
    expect(rows).toHaveLength(1);
  });

  it("de-dups two orphan (sale_id NULL) raises via NULLS NOT DISTINCT", async () => {
    const { tenantId, tillId } = await seedTillForIncidents();
    const raise = () =>
      withTenant(db, tenantId, (tx) =>
        recordIncidentOnce(asAppUser(tx), {
          tenantId,
          tillId,
          // no saleId — orphan
          error: new AppError("payment.offline_forward_declined", { paymentRef: "p1", amount: "1.00" }),
          severity: "error",
          detectedAt: new Date("2026-07-24T10:00:00Z"),
        }),
      );
    const first = await raise();
    const second = await raise();
    expect(first).toBe(true);
    expect(second).toBe(false);
    const rows = await incidentsForTill(tillId);
    expect(rows.filter((r) => r.saleId === null)).toHaveLength(1);
  });

  it("frees the key after acknowledgement (a recurring condition resurfaces)", async () => {
    const { tenantId, tillId } = await seedTillForIncidents();
    const input = {
      tenantId,
      tillId,
      error: new AppError("payment.offline_forward_declined", { paymentRef: "p2", amount: "1.00" }),
      severity: "error" as const,
      detectedAt: new Date("2026-07-24T10:00:00Z"),
    };
    expect(await withTenant(db, tenantId, (tx) => recordIncidentOnce(asAppUser(tx), input))).toBe(true);
    await db.execute(sql`update incidents set acknowledged_at = now() where till_id = ${tillId}`);
    expect(await withTenant(db, tenantId, (tx) => recordIncidentOnce(asAppUser(tx), input))).toBe(true);
  });
});
```

> **Note for the implementer:** the file already seeds a tenant+till for its incident tests and has an `incidentsForTill(till)` owner-read helper. Reuse the exact seeding path those tests use (extract it to a small `seedTillForIncidents()` local if not already one); `chain.verification_failed` and `payment.offline_forward_declined` are both real registered `AppError` codes. Import `AppError` from `@waitron/shared` and `sql` from `drizzle-orm` if not already imported.

- [ ] **Step 4: Run the new tests to verify they FAIL**

Run: `pnpm --filter @waitron/core test -- incidents`
Expected: FAIL — the new dedup assertions fail because the old `recordIncident` inserts a duplicate and the old `recordIncidentOnce` relies on `where not exists` without the index (the orphan case double-inserts).

- [ ] **Step 5: Rewrite both incident writers to use `ON CONFLICT DO NOTHING`**

In `packages/core/src/incidents.ts`, replace `recordIncident` (lines 46-56) and `recordIncidentOnce` (lines 76-95). Also rewrite their doc comments — the old text describing the race and "a future caller must add a partial unique index" no longer applies.

```ts
/**
 * Records a fiscal incident on the caller's transaction, deduplicated to at most one OPEN incident
 * per `(tenant_id, till_id, code, sale_id)` by the `incidents_open_dedup` partial unique index
 * (`ON CONFLICT DO NOTHING`). Always the caller's transaction, never a fresh connection: an incident
 * that committed while its sale rolled back would report a failure for a sale that never existed.
 * Only `.code` and `.params` are written (an `AppError` instance would not survive the jsonb round
 * trip) — the structured-code-plus-params shape spec §9 requires crossing any boundary. Callers with
 * naturally-unique `(sale, code)` keys (record-sale, record-void, the drainer's terminal transitions)
 * never actually conflict; a caller that re-detects a still-open condition (reconcile's drift) now
 * no-ops instead of accumulating a duplicate — the intended table-wide invariant.
 */
export async function recordIncident(tx: Transaction, input: RecordIncidentInput): Promise<void> {
  await tx
    .insert(incidents)
    .values({
      tenantId: input.tenantId,
      tillId: input.tillId,
      saleId: input.saleId ?? null,
      code: input.error.code,
      params: input.error.params,
      severity: input.severity,
      detectedAt: input.detectedAt.toISOString(),
    })
    .onConflictDoNothing();
}

/**
 * Like `recordIncident`, but reports whether it actually inserted (`true`) or de-duped against an
 * existing OPEN incident for the same `(tenant_id, till_id, code, sale_id)` (`false`) — so a periodic
 * caller that re-detects a still-open condition each sweep counts only real raises. Race-free: the
 * `incidents_open_dedup` partial unique index (`NULLS NOT DISTINCT`, `WHERE acknowledged_at IS NULL`)
 * is the arbiter, so two concurrent same-key callers serialise on it and exactly one inserts — the
 * property a concurrent `forward` (payments Cycle B) relies on. Once the prior incident is
 * acknowledged the key is free again and the next detection raises afresh.
 */
export async function recordIncidentOnce(
  tx: Transaction,
  input: RecordIncidentInput,
): Promise<boolean> {
  const saleId = input.saleId ?? null;
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into incidents (tenant_id, till_id, sale_id, code, params, severity, detected_at)
    values (${input.tenantId}, ${input.tillId}, ${saleId}, ${input.error.code},
            ${JSON.stringify(input.error.params)}::jsonb, ${input.severity},
            ${input.detectedAt.toISOString()})
    on conflict ("tenant_id", "till_id", "code", "sale_id") where acknowledged_at is null
    do nothing
    returning id
  `);
  return rows.length > 0;
}
```

- [ ] **Step 6: Run the incidents suite to verify it PASSES**

Run: `pnpm --filter @waitron/core test -- incidents`
Expected: PASS — the new dedup tests pass and every pre-existing `recordIncidentOnce`/`openIncidents`/chain-verification test still passes (the migration applies cleanly on PGlite; `NULLS NOT DISTINCT` is supported by PGlite's PG-16-era engine). If the migration fails to apply on PGlite, that is the one thing to catch here.

- [ ] **Step 7: Verify the fiscal callers still pass (the `recordIncident` change touches drain + reconcile)**

Run: `pnpm --filter @waitron/fiscal-verifactu test`
Expected: PASS — drain raises per terminal transition (unique keys, never conflicts) and reconcile's dedup tests already expect `toHaveLength(1)`. No fiscal test asserts duplicate same-key open incidents.

- [ ] **Step 8: Commit**

```bash
git add packages/db/drizzle/0009_incidents_open_dedup.sql packages/db/drizzle/meta packages/core/src/incidents.ts packages/core/src/incidents.test.ts
git commit -m "feat(incidents): table-wide open-incident dedup via partial unique index + ON CONFLICT"
```

---

## Task 2: The real-PG concurrency proof for the dedup primitive

**Files:**
- Test: `packages/payments/src/incident-dedup.concurrency.test.ts` (new)

**Interfaces:**
- Consumes: `recordIncidentOnce` (`@waitron/core`), `startRealPostgres` (`./testing/postgres.js`), `seedWorkingOrder` (`../test/seed.js`), `withTenant` (`@waitron/db`).
- Produces: nothing (test-only) — validates Task 1 under true concurrency, the property PGlite cannot prove.

- [ ] **Step 1: Write the failing concurrency test**

Create `packages/payments/src/incident-dedup.concurrency.test.ts`. This mirrors the acquired-signal skeleton of `reversal.concurrency.test.ts` (the blocking-lock variant): a holder inserts the incident and holds its transaction open; the waiter's `recordIncidentOnce` for the same key blocks on the `ON CONFLICT` arbiter index until the holder commits, then returns `false` (deduped).

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { AppError, tenantId as brandTenantId, tillId as brandTillId } from "@waitron/shared";
import { recordIncidentOnce } from "@waitron/core";
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

const AT = new Date("2026-07-24T10:00:00Z");

describe("recordIncidentOnce is race-safe: concurrent same-key raises collapse to one open incident", () => {
  it("an orphan (sale_id NULL) raise blocks a concurrent same-key raise, which then de-dups", async () => {
    const s = await seedWorkingOrder(admin, freshNif());
    const raiseInput = {
      tenantId: brandTenantId(s.tenantId),
      tillId: brandTillId(s.tillId),
      // no saleId — orphan; exercises NULLS NOT DISTINCT
      error: new AppError("payment.offline_forward_declined", { paymentRef: "race-1", amount: "1.00" }),
      severity: "error" as const,
      detectedAt: AT,
    };

    const holder = await pg.connect();
    const waiter = await pg.connect();
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));

      // Holder inserts the incident, signals it has, and holds the transaction open.
      holding = withTenant(holder, s.tenantId, async (tx) => {
        const raised = await recordIncidentOnce(tx, raiseInput);
        expect(raised).toBe(true);
        acquire();
        await held;
      });
      await acquired;

      // The waiter's same-key raise blocks on the arbiter index until the holder commits.
      let waiterResolved = false;
      const waiting = withTenant(waiter, s.tenantId, (tx) => recordIncidentOnce(tx, raiseInput)).then(
        (r) => {
          waiterResolved = true;
          return r;
        },
      );
      // It must NOT resolve while the holder holds the row.
      const settledEarly = await Promise.race([
        waiting.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 200)),
      ]);
      expect(settledEarly).toBe(false);
      expect(waiterResolved).toBe(false);

      release();
      await holding;
      const waiterResult = await waiting;
      expect(waiterResult).toBe(false); // deduped against the now-committed incident

      const { rows } = await admin.execute<{ n: string }>(sql`
        select count(*)::text as n from incidents
        where tenant_id = ${s.tenantId} and code = 'payment.offline_forward_declined'
          and sale_id is null and acknowledged_at is null`);
      expect(rows[0].n).toBe("1");
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await waiter.close();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it PASSES against Task 1's index (and would have failed without it)**

Run: `pnpm --filter @waitron/payments test -- incident-dedup.concurrency`
Expected: PASS (requires Docker; the suite throws rather than skips if absent). The proof is meaningful only with Task 1's index in place — without `NULLS NOT DISTINCT` the two orphan raises would both insert and the final count would be `2`.

- [ ] **Step 3: Commit**

```bash
git add packages/payments/src/incident-dedup.concurrency.test.ts
git commit -m "test(payments): real-PG proof that concurrent same-key incident raises collapse to one"
```

---

## Task 3: `listAcceptedOffline` — the non-locking read for a real adapter's `forward`

**Files:**
- Modify: `packages/payments/src/store.ts` (add after `claimAcceptedOffline`, ~line 334)
- Modify: `packages/payments/src/index.ts` (add to the `./store.js` export block)
- Test: `packages/payments/src/store.test.ts` (extend)

**Interfaces:**
- Consumes: `payments` table, `ForwardablePayment` type (both already in `store.ts`).
- Produces: `listAcceptedOffline(tx, provider): Promise<ForwardablePayment[]>` — same rows as `claimAcceptedOffline` but WITHOUT the row lock.

- [ ] **Step 1: Write the failing test**

Add to `packages/payments/src/store.test.ts` (it already runs migrations + seeds; reuse its patterns):

```ts
it("listAcceptedOffline returns this provider's accepted_offline rows without locking them", async () => {
  const s = await seedWorkingOrder(db, freshNif());
  await db.transaction((tx) =>
    insertAcceptedOffline(tx, {
      tenantId: s.tenantId,
      workingOrderId: s.workingOrderId,
      provider: "fake",
      paymentRef: "lst-1",
      amount: decimal("10.00"),
      settledAt: new Date("2026-07-24T10:00:00Z"),
    }),
  );
  const listed = await db.transaction((tx) => listAcceptedOffline(tx, "fake"));
  expect(listed.map((r) => r.paymentRef)).toContain("lst-1");
  expect(listed.find((r) => r.paymentRef === "lst-1")?.saleId).toBeNull();
});
```

Import `listAcceptedOffline` from `./store.js` at the top of the test file.

- [ ] **Step 2: Run it to verify it FAILS**

Run: `pnpm --filter @waitron/payments test -- store`
Expected: FAIL — `listAcceptedOffline` is not exported.

- [ ] **Step 3: Implement `listAcceptedOffline`**

In `packages/payments/src/store.ts`, add directly after `claimAcceptedOffline` (which ends ~line 334):

```ts
/** Like `claimAcceptedOffline` but WITHOUT the row lock — the T1 read a real adapter's `forward` uses
 * to list its pending offline payments before the (device) network sync, so it never holds a lock
 * across the network call (T1/T2). Concurrency safety comes instead from the idempotent, state-guarded
 * `settleForwarded`/`declineForwarded` advances in T2 (each matches only a row still `accepted_offline`)
 * plus the race-safe incident dedup — two concurrent forwards listing the same refs is harmless. The
 * fake's single-transaction `forward` keeps using the locking `claimAcceptedOffline`. */
export async function listAcceptedOffline(
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
    .orderBy(payments.createdAt);
}
```

- [ ] **Step 4: Export it from the barrel**

In `packages/payments/src/index.ts`, add `listAcceptedOffline` to the alphabetised `export { … } from "./store.js"` block (between `insertFailedPayment` and `recordFailedRefund`).

- [ ] **Step 5: Run the store test to verify it PASSES**

Run: `pnpm --filter @waitron/payments test -- store`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/payments/src/store.ts packages/payments/src/index.ts packages/payments/src/store.test.ts
git commit -m "feat(payments): add listAcceptedOffline (non-locking read for a real adapter forward)"
```

---

## Task 4: `forward` joins the `PaymentProvider` interface + 2a all-zeros `forward` + extract the shared reversal helper

**Files:**
- Modify: `packages/payments/src/provider.ts:88-128`
- Modify: `packages/payments-stripe/src/provider.ts` (imports + a new `forward` method; reversals delegate to the shared helper)
- Create: `packages/payments-stripe/src/reverse.ts` (the shared `reverseViaStripe`)
- Test: `packages/payments-stripe/src/provider.test.ts` (add the all-zeros-forward case; its existing reversal tests must still pass after the delegation)

**Interfaces:**
- Consumes: `ForwardResult` (already defined/exported in `provider.ts`); the store reversal helpers (`assertReversible`, `findPaymentByRef`, `recordVoid`, `recordRefund`, `recordFailedRefund`).
- Produces: `PaymentProvider.forward(now: Date): Promise<ForwardResult>` — now a required interface method; `StripeTerminalProvider.forward` returns all-zeros. `reverseViaStripe(db, client, provider, ref, kind, amount): Promise<PaymentResult>` and `interface StripeRefunder` — the shared reversal path both Stripe providers delegate to (Task 6's `StripeOnDeviceProvider` reuses it, honouring the design's "shared, not re-implemented").

- [ ] **Step 1: Write the failing test for the 2a all-zeros forward**

Add to `packages/payments-stripe/src/provider.test.ts` (it already constructs a `StripeTerminalProvider` with `FakeStripe` + PGlite):

```ts
it("forward is a no-op for the server-driven provider (no device-local offline queue)", async () => {
  const provider = new StripeTerminalProvider({
    client: new FakeStripe(),
    db,
    resolveReader: () => Promise.resolve("reader_1"),
  });
  expect(await provider.forward(new Date("2026-07-24T10:00:00Z"))).toEqual({
    nextDueAt: null,
    forwarded: 0,
    declined: 0,
    incidentsRaised: 0,
  });
});
```

- [ ] **Step 2: Run it to verify it FAILS**

Run: `pnpm --filter @waitron/payments-stripe test -- provider`
Expected: FAIL — `provider.forward` does not exist.

- [ ] **Step 3: Add `forward` to the `PaymentProvider` interface + rewrite the deferral comments**

In `packages/payments/src/provider.ts`:

Replace the `ForwardResult` doc comment (lines 82-93 region) so it no longer says "joins `PaymentProvider` in Cycle B" — it IS on the interface now:

```ts
/**
 * The outcome of one `forward(now)` pass — the offline store-and-forward drain, shaped exactly like
 * fiscal's `DrainResult`. `nextDueAt` is the only field a scheduler needs (null = nothing pending);
 * the counts are for a log line. A provider with nothing pending returns
 * `{ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 }`.
 */
export interface ForwardResult {
  nextDueAt: Date | null;
  forwarded: number;
  declined: number;
  incidentsRaised: number;
}
```

Rewrite the `PaymentProvider` interface doc comment's deferral sentence (lines 105-108) — remove the "So is `forward` on THIS interface … do not add it before then." clause and replace with:

```ts
 * Card is the subject. Cash needs no provider (it is recorded directly as a settled tender), so it
 * is deliberately absent. Split tender is N `collect` calls, not a method.
 * `authorize`/`capture`/`preAuth`/`incrementalAuth`/`tipAdjust`/`reconcile` are later plans.
```

Add the `forward` method to the interface body, right after `collect`:

```ts
  collect(params: CollectParams): Promise<PaymentResult>;

  /** Push previously offline-accepted payments to their terminal state. One pass over this provider's
   * `accepted_offline` rows: `settled` when the network cleared it, `declined` (+ one idempotent
   * uncollected-receivable incident, no fiscal change) when it refused. `nextDueAt` drives the caller's
   * cadence (null = nothing pending). A provider with no device-local offline queue answers all-zeros. */
  forward(now: Date): Promise<ForwardResult>;
```

- [ ] **Step 4: Add the all-zeros `forward` to `StripeTerminalProvider`**

In `packages/payments-stripe/src/provider.ts`, add `ForwardResult` to the type import from `@waitron/payments`:

```ts
import type {
  CollectParams,
  ForwardResult,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "@waitron/payments";
```

Add the method to the class (e.g. right after `collect`, before `drive`):

```ts
  /** Server-driven fixed-counter readers have no device-local offline queue, so a
   * `StripeTerminalProvider` never holds `accepted_offline` payments to forward: the pass is always a
   * no-op. Offline store-and-forward is a property of the on-device SDK mechanism
   * (`StripeOnDeviceProvider`), not of the integrated mode in the abstract. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `now` is part of the interface; a no-op forward ignores it
  forward(_now: Date): Promise<ForwardResult> {
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }
```

- [ ] **Step 5: Run typecheck + the provider test**

Run: `pnpm --filter @waitron/payments-stripe typecheck && pnpm --filter @waitron/payments-stripe test -- provider`
Expected: PASS. Typecheck confirms every `PaymentProvider` implementer now supplies `forward` — `FakePaymentProvider` already does; only `StripeTerminalProvider` needed the addition.

- [ ] **Step 6: Run the neutral package's tests (the interface change must not break the fake or its consumers)**

Run: `pnpm --filter @waitron/payments test`
Expected: PASS — `FakePaymentProvider.forward` already satisfies the interface unchanged.

- [ ] **Step 7: Extract the shared reversal helper**

The design requires reversals to be shared between both Stripe providers, "not re-implemented." Extract the exact logic of `StripeTerminalProvider.reverse` (`provider.ts:163-227`) into a module-level function. Create `packages/payments-stripe/src/reverse.ts`:

```ts
import { randomUUID } from "node:crypto";
import { AppError, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { PaymentResult } from "@waitron/payments";
import {
  assertReversible,
  findPaymentByRef,
  recordFailedRefund,
  recordRefund,
  recordVoid,
} from "@waitron/payments";

/** The Stripe refund surface both adapters' clients expose (`StripeClient` and `StripeDeviceClient`
 * declare an identical `refund`). A structural type so `reverseViaStripe` takes either client. */
export interface StripeRefunder {
  refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }>;
}

/** The reversal path shared by BOTH Stripe providers (server-driven 2a and on-device 2b) —
 * void/refund/partialRefund via `stripe.refunds`. Find + read-only reversibility pre-check (T1) BEFORE
 * the network refund, so an invalid local state fails fast without moving money; then persist the
 * outcome (T2). A Stripe-refused refund records a `payment_refunds` failure row and leaves the payment
 * state untouched (still `captured`/`partially_refunded`); an accepted one transitions via
 * `recordVoid`/`recordRefund` (any non-`failed` status, incl. `pending`, is treated optimistically as
 * accepted — async settlement confirmation is the deferred webhook path). On success `partialRefund`
 * reports the amount REFUNDED and `refund`/`void` the captured amount; on a FAILED reversal `amount`
 * echoes the ATTEMPTED amount. Reversal `settledAt` is always null — only `collect` settles a tender.
 * A fresh `randomUUID` idempotency key per call: two INDEPENDENT equal partial refunds each issue a
 * real refund; SAME-reversal retry-safety (a persisted per-reversal id) is deferred, and reconcile
 * backstops Stripe-vs-local drift. */
export async function reverseViaStripe(
  db: Database,
  client: StripeRefunder,
  provider: string,
  ref: string,
  kind: "void" | "refund",
  amount?: Decimal,
): Promise<PaymentResult> {
  const found = await db.transaction(async (tx) => {
    const f = await findPaymentByRef(tx, provider, ref);
    if (f === undefined || f.externalRef === null) {
      throw new AppError("payment.not_found", { provider, paymentRef: ref });
    }
    const externalRef = f.externalRef;
    await assertReversible(tx, { tenantId: f.tenantId, provider, paymentRef: ref, kind, amount });
    return { ...f, externalRef };
  });
  const key = { tenantId: found.tenantId, provider, paymentRef: ref };

  const outcome = await client.refund({
    paymentIntentId: found.externalRef,
    ...(amount ? { amount } : {}),
    idempotencyKey: randomUUID(),
  });

  if (outcome.status === "failed") {
    await db.transaction((tx) =>
      recordFailedRefund(tx, { ...key, amount: amount ?? decimal(found.amount) }),
    );
    return {
      provider,
      paymentRef: ref,
      state: found.state,
      amount: amount ?? decimal(found.amount),
      settledAt: null,
    };
  }

  const row = await db.transaction((tx) =>
    kind === "void"
      ? recordVoid(tx, key)
      : recordRefund(tx, { ...key, amount: amount ?? decimal(found.amount) }),
  );
  return {
    provider,
    paymentRef: ref,
    state: row.state,
    amount: amount ?? decimal(row.amount),
    settledAt: null,
  };
}
```

- [ ] **Step 8: Refactor `StripeTerminalProvider` to delegate to the shared helper**

In `packages/payments-stripe/src/provider.ts`: **delete** the private `reverse` method (`provider.ts:163-227`) and rewrite the three public reversal methods to delegate:

```ts
  void(ref: string): Promise<PaymentResult> {
    return reverseViaStripe(this.opts.db, this.opts.client, PROVIDER, ref, "void");
  }
  refund(ref: string): Promise<PaymentResult> {
    return reverseViaStripe(this.opts.db, this.opts.client, PROVIDER, ref, "refund");
  }
  partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> {
    return reverseViaStripe(this.opts.db, this.opts.client, PROVIDER, ref, "refund", amount);
  }
```

Add the import `import { reverseViaStripe } from "./reverse.js";`. Then **remove the now-unused imports** from `provider.ts` — `assertReversible`, `findPaymentByRef`, `recordFailedRefund`, `recordRefund`, `recordVoid` moved to `reverse.ts`; `AppError` and `decimal` are no longer used by `provider.ts` (collect uses neither). Let `pnpm typecheck`/`lint` confirm exactly which imports are dead and drop them.

- [ ] **Step 9: Run the provider suite — 2a reversals must be unchanged, forward is new**

Run: `pnpm --filter @waitron/payments-stripe typecheck && pnpm --filter @waitron/payments-stripe test -- provider`
Expected: PASS. `provider.test.ts`'s existing void/refund/partialRefund/failed-refund cases prove the delegation is behavior-preserving; the new case proves the all-zeros forward.

- [ ] **Step 10: Commit**

```bash
git add packages/payments/src/provider.ts packages/payments-stripe/src/provider.ts packages/payments-stripe/src/reverse.ts packages/payments-stripe/src/provider.test.ts
git commit -m "feat(payments): promote forward to the PaymentProvider interface; 2a all-zeros forward; extract shared reverseViaStripe"
```

---

## Task 5: The `StripeDeviceClient` seam — interface, fake, real binding, connection tokens

**Files:**
- Create: `packages/payments-stripe/src/device-client.ts`
- Create: `packages/payments-stripe/src/stripe-device-client.ts`
- Create: `packages/payments-stripe/src/testing/fake-stripe-device.ts`
- Modify: `packages/payments-stripe/src/index.ts`
- Test: `packages/payments-stripe/src/testing/fake-stripe-device.test.ts`

**Interfaces:**
- Consumes: `Decimal` (`@waitron/shared`), `toMinorUnits` (`./client.js`), `Stripe` (type).
- Produces: `interface StripeDeviceClient` (`createConnectionToken`, `collectOnDevice`, `syncOfflineQueue`, `refund`) + the `DeviceCollectOutcome` type; `stripeDeviceClient(stripe): StripeDeviceClient`; `class FakeStripeDevice implements StripeDeviceClient` with `nextCollect(scenario: "online" | "offline" | "declined")` (the offline scenario respects `offlineAllowed`), `queueResult({settled, declined})`, `refundFailsNext()`.

- [ ] **Step 1: Write the `StripeDeviceClient` interface**

Create `packages/payments-stripe/src/device-client.ts`:

```ts
import type { Decimal } from "@waitron/shared";

/** Outcome of a device-side collect. `captured` = online single-message capture; `accepted_offline`
 * = the device stored-and-forwarded it while offline (only possible when `offlineAllowed`); `declined`
 * = the card was refused; `network_unavailable` = offline while offline was NOT allowed, so nothing was
 * stored. */
export type DeviceCollectOutcome = "captured" | "accepted_offline" | "declined" | "network_unavailable";

/** The narrow on-device Stripe surface `StripeOnDeviceProvider` depends on — the device SDK operations
 * it needs, not the SDK. The real impl (`./stripe-device-client.ts`) wraps the on-device / Tap-to-Pay
 * bindings and is coverage-excluded; `FakeStripeDevice` (`./testing/`) models it deterministically.
 * Amounts cross as exact `Decimal`. Separate from `StripeClient` (the server-driven 2a seam): each
 * provider names only the calls it uses. */
export interface StripeDeviceClient {
  /** Mint a connection token the on-device SDK needs to initialise (`stripe.terminal.connectionTokens
   * .create`). A server-side call — the one device-init operation with a headless analogue, so the one
   * thing the nightly sandbox exercises. */
  createConnectionToken(): Promise<{ secret: string }>;
  /** Collect on the built-in reader. `offlineAllowed` (computed by the neutral gate) configures the
   * device's offline behaviour: only when true may the SDK store-and-forward. Returns the resolved
   * outcome; `externalRef` is the PaymentIntent id on `captured`/`accepted_offline`. */
  collectOnDevice(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    offlineAllowed: boolean;
  }): Promise<{ outcome: DeviceCollectOutcome; externalRef?: string }>;
  /** Reconcile our pending offline refs against the device-local offline queue: which the device has
   * now forwarded to the network (`settled`) vs. had refused (`declined`). Refs still pending on the
   * device appear in neither list. */
  syncOfflineQueue(refs: string[]): Promise<{ settled: string[]; declined: string[] }>;
  /** Reverse a captured payment (void = full refund with no amount; refund/partialRefund with amount)
   * — a server-side `stripe.refunds.create`, same shape as the 2a `StripeClient.refund`. */
  refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }>;
}
```

- [ ] **Step 2: Write the `FakeStripeDevice` test (failing)**

Create `packages/payments-stripe/src/testing/fake-stripe-device.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { FakeStripeDevice } from "./fake-stripe-device.js";

const params = (offlineAllowed: boolean) => ({
  amount: decimal("10.00"),
  currency: "eur",
  idempotencyKey: "k1",
  offlineAllowed,
});

describe("FakeStripeDevice", () => {
  it("defaults to the online scenario → captured with a pi_ externalRef", async () => {
    const r = await new FakeStripeDevice().collectOnDevice(params(false));
    expect(r.outcome).toBe("captured");
    expect(r.externalRef).toMatch(/^pi_/);
  });

  it("offline scenario yields accepted_offline only when offlineAllowed, else network_unavailable", async () => {
    const f = new FakeStripeDevice();
    f.nextCollect("offline");
    const stored = await f.collectOnDevice(params(true));
    expect(stored.outcome).toBe("accepted_offline");
    expect(stored.externalRef).toMatch(/^pi_/);

    f.nextCollect("offline");
    const refused = await f.collectOnDevice(params(false));
    expect(refused.outcome).toBe("network_unavailable");
    expect(refused.externalRef).toBeUndefined();
  });

  it("declined scenario yields declined; scenario resets to online after one use", async () => {
    const f = new FakeStripeDevice();
    f.nextCollect("declined");
    expect((await f.collectOnDevice(params(true))).outcome).toBe("declined");
    expect((await f.collectOnDevice(params(true))).outcome).toBe("captured");
  });

  it("queueResult scripts the next syncOfflineQueue and resets to empty", async () => {
    const f = new FakeStripeDevice();
    f.queueResult({ settled: ["a"], declined: ["b"] });
    expect(await f.syncOfflineQueue(["a", "b"])).toEqual({ settled: ["a"], declined: ["b"] });
    expect(await f.syncOfflineQueue(["a"])).toEqual({ settled: [], declined: [] });
  });

  it("refundFailsNext fails one refund then succeeds", async () => {
    const f = new FakeStripeDevice();
    f.refundFailsNext();
    expect((await f.refund({ paymentIntentId: "pi_1", idempotencyKey: "r1" })).status).toBe("failed");
    expect((await f.refund({ paymentIntentId: "pi_1", idempotencyKey: "r2" })).status).toBe("succeeded");
  });

  it("createConnectionToken returns a secret", async () => {
    expect((await new FakeStripeDevice().createConnectionToken()).secret).toMatch(/^pst_/);
  });
});
```

- [ ] **Step 3: Run it to verify it FAILS**

Run: `pnpm --filter @waitron/payments-stripe test -- fake-stripe-device`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `FakeStripeDevice`**

Create `packages/payments-stripe/src/testing/fake-stripe-device.ts`:

```ts
import type { Decimal } from "@waitron/shared";
import type { DeviceCollectOutcome, StripeDeviceClient } from "../device-client.js";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++seq).padStart(8, "0")}`;

/** The next collect scenario, distinct from the resolved outcome — because the OFFLINE scenario's
 * outcome depends on `offlineAllowed`, so a test cannot script the outcome directly and still exercise
 * the provider's gate. */
type DeviceScenario = "online" | "offline" | "declined";

/** Deterministic in-memory `StripeDeviceClient` — the hermetic double for the on-device Stripe adapter.
 * NOT barrel-exported (a production import cannot reach it), like `FakeStripe`/`FakePaymentProvider`.
 * Controls: `nextCollect(scenario)` shapes the next `collectOnDevice` (default `online`, one-shot);
 * `queueResult({settled, declined})` scripts the next `syncOfflineQueue` (one-shot); `refundFailsNext`
 * fails the next refund. The OFFLINE scenario faithfully models a real device — it stores-and-forwards
 * (→ `accepted_offline`) only when `offlineAllowed`, otherwise refuses (→ `network_unavailable`) — so
 * the provider's neutral gate is load-bearing: a test only reaches `accepted_offline` by configuring
 * policy so the gate accepts. */
export class FakeStripeDevice implements StripeDeviceClient {
  private scenario: DeviceScenario = "online";
  private nextQueue: { settled: string[]; declined: string[] } = { settled: [], declined: [] };
  private nextRefundFails = false;

  nextCollect(scenario: DeviceScenario): void {
    this.scenario = scenario;
  }
  queueResult(result: { settled: string[]; declined: string[] }): void {
    this.nextQueue = result;
  }
  refundFailsNext(): void {
    this.nextRefundFails = true;
  }

  createConnectionToken(): Promise<{ secret: string }> {
    return Promise.resolve({ secret: nextId("pst") });
  }

  collectOnDevice(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    offlineAllowed: boolean;
  }): Promise<{ outcome: DeviceCollectOutcome; externalRef?: string }> {
    const scenario = this.scenario;
    this.scenario = "online";
    if (scenario === "declined") return Promise.resolve({ outcome: "declined" });
    if (scenario === "offline") {
      // A real device stores-and-forwards only when offline was permitted; otherwise it refuses and
      // nothing is stored. This makes the provider's gate (which computes offlineAllowed) load-bearing.
      return Promise.resolve(
        params.offlineAllowed
          ? { outcome: "accepted_offline", externalRef: nextId("pi") }
          : { outcome: "network_unavailable" },
      );
    }
    return Promise.resolve({ outcome: "captured", externalRef: nextId("pi") });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- refs unused: the fake returns the scripted result verbatim
  syncOfflineQueue(_refs: string[]): Promise<{ settled: string[]; declined: string[] }> {
    const result = this.nextQueue;
    this.nextQueue = { settled: [], declined: [] };
    return Promise.resolve(result);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
  refund(_params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }> {
    const fails = this.nextRefundFails;
    this.nextRefundFails = false;
    return Promise.resolve({ id: nextId("re"), status: fails ? "failed" : "succeeded" });
  }
}
```

- [ ] **Step 5: Implement the real (coverage-excluded) `stripeDeviceClient`**

Create `packages/payments-stripe/src/stripe-device-client.ts`:

```ts
import type Stripe from "stripe";
import { toMinorUnits } from "./client.js";
import type { StripeDeviceClient } from "./device-client.js";

/** The real `StripeDeviceClient`, wrapping the `stripe` SDK's on-device / Tap-to-Pay Terminal API.
 * Coverage-excluded (see vitest.config.ts): a thin call-mapping boundary. Only its SERVER-side calls
 * (`createConnectionToken`, `refund`) have a headless analogue and are exercised by the nightly
 * sandbox; the device-side `collectOnDevice`/`syncOfflineQueue` run inside the device SDK on the
 * handheld (bridged in by the device app — SP7/SP9 deployment work), so here they throw. The hermetic
 * suite proves the provider's own logic through `FakeStripeDevice`, never this file. */
export function stripeDeviceClient(stripe: Stripe): StripeDeviceClient {
  return {
    async createConnectionToken() {
      const token = await stripe.terminal.connectionTokens.create();
      return { secret: token.secret };
    },
    collectOnDevice() {
      throw new Error("on-device collect runs in the device SDK, not the server wrapper (SP7/SP9)");
    },
    syncOfflineQueue() {
      throw new Error("offline-queue sync runs in the device SDK, not the server wrapper (SP7/SP9)");
    },
    async refund({ paymentIntentId, amount, idempotencyKey }) {
      const refund = await stripe.refunds.create(
        { payment_intent: paymentIntentId, ...(amount ? { amount: toMinorUnits(amount) } : {}) },
        { idempotencyKey },
      );
      const status =
        refund.status === "succeeded" || refund.status === "pending" ? refund.status : "failed";
      return { id: refund.id, status };
    },
  };
}
```

- [ ] **Step 6: Export the client surface from the barrel**

Append to `packages/payments-stripe/src/index.ts` (only the client-seam exports — the `StripeOnDeviceProvider` exports are added in Task 6, once that file exists, so each task typechecks in isolation):

```ts
export type { StripeDeviceClient, DeviceCollectOutcome } from "./device-client.js";
export { stripeDeviceClient } from "./stripe-device-client.js";
```

- [ ] **Step 7: Run the fake test + typecheck to verify PASS**

Run: `pnpm --filter @waitron/payments-stripe test -- fake-stripe-device && pnpm --filter @waitron/payments-stripe typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/payments-stripe/src/device-client.ts packages/payments-stripe/src/stripe-device-client.ts packages/payments-stripe/src/testing/fake-stripe-device.ts packages/payments-stripe/src/testing/fake-stripe-device.test.ts packages/payments-stripe/src/index.ts
git commit -m "feat(payments-stripe): StripeDeviceClient seam + FakeStripeDevice + real binding + connection tokens"
```

---

## Task 6: `StripeOnDeviceProvider` — `collect` (gate-up-front), `forward` (T1/T2), reversals

**Files:**
- Create: `packages/payments-stripe/src/device-provider.ts`
- Modify: `packages/payments-stripe/src/index.ts` (add the `device-provider` exports)
- Test: `packages/payments-stripe/src/device-provider.test.ts`

**Interfaces:**
- Consumes: `StripeDeviceClient` (Task 5); `getPaymentPolicy`, `resolveOfflineDecision`, `insertCapturedPayment`, `insertAcceptedOffline`, `insertFailedPayment`, `listAcceptedOffline` (Task 3), `settleForwarded`, `declineForwarded` (`@waitron/payments`); `reverseViaStripe` (Task 4, `./reverse.js`) for reversals; `recordIncidentOnce` (`@waitron/core`); `workingOrders` (`@waitron/db`); brand helpers + `AppError` (`@waitron/shared`); `CollectParams`, `PaymentResult`, `ForwardResult`, `ProviderCapabilities` (`@waitron/payments`).
- Produces: `class StripeOnDeviceProvider implements PaymentProvider`; `interface StripeOnDeviceProviderOptions { client: StripeDeviceClient; db: Database }`; a `connectionToken()` method.

- [ ] **Step 1: Write the hermetic provider test (failing)**

Create `packages/payments-stripe/src/device-provider.test.ts`. Reuse the seed helpers the other suites use (`seedWorkingOrder`, `seedPaymentPolicy`, `freshNif` from `@waitron/payments/test/seed.js`), PGlite, and `CORE_MIGRATIONS`+`PAYMENTS_MIGRATIONS`.

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, getPaymentByRef } from "@waitron/payments";
import { openIncidents } from "@waitron/core";
import { FakeStripeDevice } from "./testing/fake-stripe-device.js";
import { StripeOnDeviceProvider } from "./device-provider.js";
import { freshNif, seedPaymentPolicy, seedWorkingOrder } from "@waitron/payments/test/seed.js";

let db: Database;
beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
}, 60_000);
afterAll(async () => {
  await db.close();
});

const AT = new Date("2026-07-24T10:00:00Z");

function collectParams(s: { tenantId: string; tillId: string; workingOrderId: string }, allowOffline?: boolean) {
  return {
    tenantId: brandTenantId(s.tenantId),
    tillId: brandTillId(s.tillId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    amount: decimal("10.00"),
    ...(allowOffline === undefined ? {} : { allowOffline }),
  };
}

describe("StripeOnDeviceProvider.collect", () => {
  it("online capture writes a captured row with the PI id in external_ref", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const provider = new StripeOnDeviceProvider({ client: new FakeStripeDevice(), db });
    const r = await provider.collect(collectParams(s));
    expect(r.state).toBe("captured");
    expect(r.settledAt).not.toBeNull();
    const row = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef: r.paymentRef }),
    );
    expect(row?.state).toBe("captured");
    expect(row?.externalRef).toMatch(/^pi_/);
  });

  it("accepted_offline (policy allows, consent given, under cap) chains immediately with offline:true", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "50.00");
    const client = new FakeStripeDevice();
    client.nextCollect("offline"); // the gate must ACCEPT (policy + consent + under cap) for the device to store
    const provider = new StripeOnDeviceProvider({ client, db });
    const r = await provider.collect(collectParams(s, true));
    expect(r.state).toBe("accepted_offline");
    expect(r.offline).toBe(true);
    expect(r.settledAt).not.toBeNull();
  });

  it("gate refuses offline (no policy) → device yields network_unavailable → nothing persisted", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    // No policy row → resolveOfflineDecision refuses → offlineAllowed=false is passed to the device →
    // the offline scenario yields network_unavailable. This makes the gate wiring load-bearing.
    const client = new FakeStripeDevice();
    client.nextCollect("offline");
    const provider = new StripeOnDeviceProvider({ client, db });
    const r = await provider.collect(collectParams(s, true));
    expect(r.state).toBe("network_unavailable");
    expect(r.settledAt).toBeNull();
    const rows = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from payments where tenant_id = ${s.tenantId}`,
    );
    expect(rows.rows[0].n).toBe("0");
  });

  it("declined writes a failed row", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const client = new FakeStripeDevice();
    client.nextCollect("declined");
    const provider = new StripeOnDeviceProvider({ client, db });
    const r = await provider.collect(collectParams(s));
    expect(r.state).toBe("failed");
    const row = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef: r.paymentRef }),
    );
    expect(row?.state).toBe("failed");
  });
});

describe("StripeOnDeviceProvider.forward", () => {
  it("settles a cleared offline payment and declines a refused one (+ one incident), empty queue = zeros", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "50.00");
    const client = new FakeStripeDevice();
    const provider = new StripeOnDeviceProvider({ client, db });

    // Two offline-accepted payments (policy accepts + consent + under cap → the device stores).
    client.nextCollect("offline");
    const a = await provider.collect(collectParams(s, true));
    client.nextCollect("offline");
    const b = await provider.collect(collectParams(s, true));

    // The device queue: a cleared, b refused.
    client.queueResult({ settled: [a.paymentRef], declined: [b.paymentRef] });
    const result = await provider.forward(AT);
    expect(result).toMatchObject({ forwarded: 1, declined: 1, incidentsRaised: 1, nextDueAt: null });

    const states = await db.execute<{ payment_ref: string; state: string }>(
      sql`select payment_ref, state from payments where tenant_id = ${s.tenantId} order by created_at`,
    );
    expect(states.rows.find((r) => r.payment_ref === a.paymentRef)?.state).toBe("settled");
    expect(states.rows.find((r) => r.payment_ref === b.paymentRef)?.state).toBe("declined");
    const incidents = await db.transaction((tx) => openIncidents(tx, brandTillId(s.tillId)));
    expect(incidents).toHaveLength(1);
    expect(incidents[0].code).toBe("payment.offline_forward_declined");

    // Empty queue → zeros.
    expect(await provider.forward(AT)).toEqual({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  });
});

describe("StripeOnDeviceProvider reversals", () => {
  it("refunds a captured payment; a Stripe-refused refund leaves state unchanged", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const client = new FakeStripeDevice();
    const provider = new StripeOnDeviceProvider({ client, db });
    const paid = await provider.collect(collectParams(s));

    client.refundFailsNext();
    const failed = await provider.refund(paid.paymentRef);
    expect(failed.state).toBe("captured"); // unchanged — no money moved

    const ok = await provider.refund(paid.paymentRef);
    expect(ok.state).toBe("refunded");
  });
});
```

- [ ] **Step 2: Run it to verify it FAILS**

Run: `pnpm --filter @waitron/payments-stripe test -- device-provider`
Expected: FAIL — `device-provider.js` module not found.

- [ ] **Step 3: Implement `StripeOnDeviceProvider`**

Create `packages/payments-stripe/src/device-provider.ts`:

```ts
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  AppError,
  saleId as brandSaleId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { Database } from "@waitron/db";
import { workingOrders } from "@waitron/db";
import { recordIncidentOnce } from "@waitron/core";
import type {
  CollectParams,
  ForwardResult,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "@waitron/payments";
import {
  declineForwarded,
  getPaymentPolicy,
  insertAcceptedOffline,
  insertCapturedPayment,
  insertFailedPayment,
  listAcceptedOffline,
  resolveOfflineDecision,
  settleForwarded,
} from "@waitron/payments";
import { reverseViaStripe } from "./reverse.js";
import type { StripeDeviceClient } from "./device-client.js";

// Same provider id as the server-driven adapter: one Stripe account = one settlement identity for a
// future reconcile. Only THIS provider ever writes `accepted_offline` rows, so forward's
// `provider = 'stripe'` scoping is unambiguous; the server-driven forward is all-zeros.
const PROVIDER = "stripe";
const CURRENCY = "eur";

export interface StripeOnDeviceProviderOptions {
  client: StripeDeviceClient;
  /** Must be a TENANT-SCOPED `Database` handle (sets `app.tenant_id`) — `collect`/`forward`/`reverse`
   * open their own transactions and rely on RLS scoping from this handle. */
  db: Database;
}

/** The real on-device Stripe `PaymentProvider` (Tap-to-Pay / handheld). `collect` applies the neutral
 * offline gate UP FRONT (configuring the device's offline behaviour) and persists the resolved outcome
 * in ONE short transaction — no `attempting`-first, because the device owns its PaymentIntent/offline
 * queue locally (a crash on our side never loses the device's record; the residual gap is reconcile's
 * `missingLocal`), and `network_unavailable` persists nothing. `forward` drives the device-local
 * offline queue T1/T2. Reversals delegate to the shared `reverseViaStripe` (Task 4). */
export class StripeOnDeviceProvider implements PaymentProvider {
  readonly provider = PROVIDER;
  readonly capabilities: ProviderCapabilities = { partialRefund: true };

  constructor(private readonly opts: StripeOnDeviceProviderOptions) {}

  /** Mint a connection token for the device to initialise its on-device SDK. */
  connectionToken(): Promise<{ secret: string }> {
    return this.opts.client.createConnectionToken();
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    const paymentRef = randomUUID();
    // Gate up front: the neutral policy decides whether offline is permitted for THIS transaction,
    // which configures the device's offline behaviour BEFORE anything is stored.
    const offlineAllowed = await this.opts.db.transaction(async (tx) => {
      const policy = await getPaymentPolicy(tx, params.tenantId);
      return resolveOfflineDecision(policy, params.allowOffline ?? false, params.amount) === "accept";
    });

    const outcome = await this.opts.client.collectOnDevice({
      amount: params.amount,
      currency: CURRENCY,
      idempotencyKey: paymentRef,
      offlineAllowed,
    });

    const common = {
      tenantId: params.tenantId,
      workingOrderId: params.workingOrderId,
      provider: PROVIDER,
      paymentRef,
      amount: params.amount,
    };

    if (outcome.outcome === "network_unavailable") {
      // No money moved and nothing durable is written (Cycle A's offline-refused semantics).
      return {
        provider: PROVIDER,
        paymentRef,
        state: "network_unavailable",
        amount: params.amount,
        settledAt: null,
      };
    }
    if (outcome.outcome === "declined") {
      await this.opts.db.transaction((tx) => insertFailedPayment(tx, common));
      return { provider: PROVIDER, paymentRef, state: "failed", amount: params.amount, settledAt: null };
    }
    const settledAt = new Date();
    if (outcome.outcome === "accepted_offline") {
      await this.opts.db.transaction((tx) =>
        insertAcceptedOffline(tx, { ...common, settledAt, externalRef: outcome.externalRef }),
      );
      return {
        provider: PROVIDER,
        paymentRef,
        state: "accepted_offline",
        amount: params.amount,
        settledAt,
        offline: true,
      };
    }
    // captured (online single-message)
    await this.opts.db.transaction((tx) =>
      insertCapturedPayment(tx, { ...common, settledAt, externalRef: outcome.externalRef }),
    );
    return { provider: PROVIDER, paymentRef, state: "captured", amount: params.amount, settledAt };
  }

  async forward(now: Date): Promise<ForwardResult> {
    // T1 (read, no lock): list our pending offline payments. Never hold a lock across the device sync.
    const pending = await this.opts.db.transaction((tx) => listAcceptedOffline(tx, PROVIDER));
    if (pending.length === 0) {
      return { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
    }

    // Network: ask the device-local offline queue which refs cleared vs. were refused.
    const { settled, declined } = await this.opts.client.syncOfflineQueue(
      pending.map((p) => p.paymentRef),
    );
    const settledSet = new Set(settled);
    const declinedSet = new Set(declined);

    // T2 (write): advance each resolved row (idempotent — matches only rows still accepted_offline)
    // and raise one race-safe incident per decline. Refs still pending on the device are left for a
    // later pass. Under two concurrent forwards the counts may double (both advance the same row, the
    // second a no-op) — a benign log-line inaccuracy the design accepts; the incident count stays
    // exact because recordIncidentOnce reports real inserts.
    return this.opts.db.transaction(async (tx) => {
      let forwarded = 0;
      let declinedCount = 0;
      let incidentsRaised = 0;
      for (const p of pending) {
        const key = { tenantId: p.tenantId, provider: PROVIDER, paymentRef: p.paymentRef };
        if (settledSet.has(p.paymentRef)) {
          await settleForwarded(tx, key);
          forwarded += 1;
        } else if (declinedSet.has(p.paymentRef)) {
          await declineForwarded(tx, key);
          declinedCount += 1;
          const [wo] = await tx
            .select({ tillId: workingOrders.tillId })
            .from(workingOrders)
            .where(
              and(eq(workingOrders.tenantId, p.tenantId), eq(workingOrders.id, p.workingOrderId)),
            );
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
        }
      }
      return { nextDueAt: null, forwarded, declined: declinedCount, incidentsRaised };
    });
  }

  // Reversals delegate to the shared helper (the design's "shared with StripeTerminalProvider, not
  // re-implemented"); the on-device client's `refund` satisfies `StripeRefunder` structurally.
  void(ref: string): Promise<PaymentResult> {
    return reverseViaStripe(this.opts.db, this.opts.client, PROVIDER, ref, "void");
  }
  refund(ref: string): Promise<PaymentResult> {
    return reverseViaStripe(this.opts.db, this.opts.client, PROVIDER, ref, "refund");
  }
  partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> {
    return reverseViaStripe(this.opts.db, this.opts.client, PROVIDER, ref, "refund", amount);
  }
}
```

- [ ] **Step 4: Add the `device-provider` exports to the barrel**

Append to `packages/payments-stripe/src/index.ts`:

```ts
export { StripeOnDeviceProvider } from "./device-provider.js";
export type { StripeOnDeviceProviderOptions } from "./device-provider.js";
```

- [ ] **Step 5: Run the provider test + typecheck to verify PASS**

Run: `pnpm --filter @waitron/payments-stripe typecheck && pnpm --filter @waitron/payments-stripe test -- device-provider`
Expected: PASS. (If `payment.offline_forward_declined` fails to typecheck, ensure the `@waitron/payments` error augmentation is in the compile graph — it is transitively, via the barrel import of the store helpers whose module imports `./errors.js`.)

- [ ] **Step 6: Commit**

```bash
git add packages/payments-stripe/src/device-provider.ts packages/payments-stripe/src/device-provider.test.ts packages/payments-stripe/src/index.ts
git commit -m "feat(payments-stripe): StripeOnDeviceProvider — gate-up-front collect, T1/T2 forward, reversals"
```

---

## Task 7: Real-PG RLS for the on-device lifecycle + `listAcceptedOffline`

**Files:**
- Test: `packages/payments-stripe/src/device.rls.test.ts` (new)

**Interfaces:**
- Consumes: `startRealPostgres` (`./testing/postgres.js`), `withTenant` (`@waitron/db`), `insertAcceptedOffline`, `listAcceptedOffline`, `getPaymentByRef` (`@waitron/payments`), `seedWorkingOrder` (`@waitron/payments/test/seed.js`).
- Produces: nothing (test-only) — proves the device provider's `accepted_offline` lifecycle and the new `listAcceptedOffline` read are tenant-isolated under a real non-superuser role.

- [ ] **Step 1: Write the failing RLS test**

Create `packages/payments-stripe/src/device.rls.test.ts` (mirrors `stripe.rls.test.ts` / `payment-policy.rls.test.ts`; use a distinct probe role name):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { getPaymentByRef, insertAcceptedOffline, listAcceptedOffline } from "@waitron/payments";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedWorkingOrder } from "@waitron/payments/test/seed.js";

const PROBE_ROLE = "rls_probe_device";
const PROBE_PASSWORD = "probe";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  await admin.execute(`create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`);
});
afterAll(async () => {
  await admin.close();
  await pg.stop();
});

const SETTLED = new Date("2026-07-24T10:00:00Z");

describe("on-device accepted_offline lifecycle under real row-level security", () => {
  it("lists and reads its own tenant's offline payment, and only its own", async () => {
    const tenantA = await seedWorkingOrder(admin, "B41111111");
    const tenantB = await seedWorkingOrder(admin, "B42222222");

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const key = { tenantId: tenantA.tenantId, provider: "stripe", paymentRef: "dev-off-1" };

      await withTenant(probe, tenantA.tenantId, (tx) =>
        insertAcceptedOffline(tx, {
          tenantId: tenantA.tenantId,
          workingOrderId: tenantA.workingOrderId,
          provider: "stripe",
          paymentRef: "dev-off-1",
          amount: decimal("10.00"),
          settledAt: SETTLED,
          externalRef: "pi_dev_rls",
        }),
      );

      // listAcceptedOffline under tenant A sees the row.
      const listedA = await withTenant(probe, tenantA.tenantId, (tx) => listAcceptedOffline(tx, "stripe"));
      expect(listedA.map((r) => r.paymentRef)).toContain("dev-off-1");

      const seen = await withTenant(probe, tenantA.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(seen?.state).toBe("accepted_offline");
      expect(seen?.externalRef).toBe("pi_dev_rls");

      // Under tenant B the isolation policy hides A's row from both the read and the list.
      const listedB = await withTenant(probe, tenantB.tenantId, (tx) => listAcceptedOffline(tx, "stripe"));
      expect(listedB.map((r) => r.paymentRef)).not.toContain("dev-off-1");
      const hidden = await withTenant(probe, tenantB.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(hidden).toBeUndefined();
    } finally {
      await probe.close();
    }
  });
});
```

- [ ] **Step 2: Run it to verify PASS**

Run: `pnpm --filter @waitron/payments-stripe test -- device.rls`
Expected: PASS (requires Docker; throws if absent — never skips).

- [ ] **Step 3: Commit**

```bash
git add packages/payments-stripe/src/device.rls.test.ts
git commit -m "test(payments-stripe): real-PG RLS for the on-device offline lifecycle + listAcceptedOffline"
```

---

## Task 8: The on-device wiring capstone

**Files:**
- Test: `packages/payments-stripe/src/device.wiring.test.ts` (new)

**Interfaces:**
- Consumes: `StripeOnDeviceProvider` + `FakeStripeDevice`; `recordSale`, `openIncidents` (`@waitron/core`); `associatePaymentWithSale` (`@waitron/payments`); `FakeFiscalBackend` (`@waitron/fiscal/src/testing/fake-backend.js`); `seedForSale`, `seedPaymentPolicy`, `freshNif` (`@waitron/payments/test/seed.js`).
- Produces: nothing (test-only) — the 2b twin of `offline.wiring.test.ts`.

- [ ] **Step 1: Write the failing capstone test**

Create `packages/payments-stripe/src/device.wiring.test.ts`. It mirrors `packages/payments/src/offline.wiring.test.ts` exactly, but drives the offline tender through `StripeOnDeviceProvider` + `FakeStripeDevice` (`provider: "stripe"`). Reuse that file's `steadyClock` and `buildInput` verbatim (house convention — copy them locally).

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
import { PAYMENTS_MIGRATIONS, associatePaymentWithSale } from "@waitron/payments";
import { FakeStripeDevice } from "./testing/fake-stripe-device.js";
import { StripeOnDeviceProvider } from "./device-provider.js";
import { freshNif, seedForSale, seedPaymentPolicy } from "@waitron/payments/test/seed.js";
import type { SeededForSale } from "@waitron/payments/test/seed.js";

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
  now: () => ({ instant: BASE, offsetMinutes: 60, confident: true, confidence: "anchored", anchorAgeSeconds: 0 }),
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
      { lineNo: 1, descriptions: { es: "Item" }, quantity: "1", unitPrice: "10.00", vatRate: "21.00", lineTotal: "10.00" },
    ],
    tenders: [{ method: "card", amount: "10.00", settledAt }],
    fiscalBackend: "fake",
    clock: steadyClock,
  };
}

describe("on-device offline accept -> recordSale -> associate -> forward decline (sale stays chained)", () => {
  it("chains the sale on an offline-accepted device tender, then a forward-decline raises an incident without un-chaining it", async () => {
    const backend = new FakeFiscalBackend(db);
    const s = await seedForSale(db, backend, freshNif());
    await seedPaymentPolicy(db, s.tenantId, "accept_offline", "50.00");

    const client = new FakeStripeDevice();
    client.nextCollect("offline"); // policy accepts + consent + under cap → the device stores offline
    const provider = new StripeOnDeviceProvider({ client, db });
    const paid = await provider.collect({
      tenantId: brandTenantId(s.tenantId),
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("10.00"),
      allowOffline: true,
    });
    expect(paid.state).toBe("accepted_offline");
    expect(paid.offline).toBe(true);

    const saleId = await db.transaction(async (tx) => {
      const recorded = await recordSale(tx, backend, buildInput(s, paid.settledAt as Date));
      await associatePaymentWithSale(tx, {
        tenantId: s.tenantId,
        provider: "stripe",
        paymentRef: paid.paymentRef,
        saleId: recorded.saleId,
      });
      return recorded.saleId;
    });

    client.queueResult({ settled: [], declined: [paid.paymentRef] });
    const result = await provider.forward(BASE);
    expect(result).toMatchObject({ forwarded: 0, declined: 1, incidentsRaised: 1 });

    const rows = await db.execute<{ state: string; sale_id: string | null }>(
      sql`select state, sale_id from payments where tenant_id = ${s.tenantId}`,
    );
    expect(rows.rows[0].state).toBe("declined");
    expect(rows.rows[0].sale_id).toBe(saleId);
    const sale = await db.execute<{ id: string }>(sql`select id from sales where id = ${saleId}`);
    expect(sale.rows).toHaveLength(1); // NOT voided or removed

    const incidents = await db.transaction((tx) => openIncidents(tx, brandTillId(s.tillId)));
    expect(incidents).toHaveLength(1);
    expect(incidents[0].code).toBe("payment.offline_forward_declined");
    expect(incidents[0].saleId).toBe(saleId);
  });
});
```

- [ ] **Step 2: Run it to verify PASS**

Run: `pnpm --filter @waitron/payments-stripe test -- device.wiring`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/payments-stripe/src/device.wiring.test.ts
git commit -m "test(payments-stripe): on-device offline capstone — tender chains a sale, forward-decline raises an incident without un-chaining"
```

---

## Task 9: Coverage exclusion + the server-side nightly sandbox

**Files:**
- Modify: `packages/payments-stripe/vitest.config.ts:13-29`
- Create: `packages/payments-stripe/src/connection-token.sandbox.test.ts`

**Interfaces:**
- Consumes: `stripeDeviceClient` (Task 5), the `stripe` SDK.
- Produces: coverage-excludes the real device binding; a nightly server-side sandbox check.

- [ ] **Step 1: Coverage-exclude the real device binding**

In `packages/payments-stripe/vitest.config.ts`, add `"src/stripe-device-client.ts"` to the `coverage.exclude` array, right after `"src/stripe-client.ts"`:

```ts
        "src/stripe-client.ts",
        // The real on-device SDK boundary — server-side calls exercised only by the nightly sandbox;
        // the device-side collect/offline-queue run in the device SDK, proven by FakeStripeDevice.
        "src/stripe-device-client.ts",
        "src/testing/**",
```

- [ ] **Step 2: Write the server-side sandbox test**

Create `packages/payments-stripe/src/connection-token.sandbox.test.ts`:

```ts
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { stripeDeviceClient } from "./stripe-device-client.js";

// Nightly-only server-side sandbox for the on-device adapter (.github/workflows/stripe-sandbox.yml).
// The device-side collect / offline queue have no headless analogue (they run in the device SDK) and
// are proven by FakeStripeDevice, so this suite exercises only the server-side call the device fetches:
// connection-token creation. Self-skips without STRIPE_SECRET_KEY, like collect.sandbox.test.ts.
const KEY = process.env.STRIPE_SECRET_KEY;
const d = KEY ? describe : describe.skip;

d("Stripe test-mode sandbox: on-device server-side calls", () => {
  it("creates a connection token", async () => {
    const client = stripeDeviceClient(new Stripe(KEY!));
    const token = await client.createConnectionToken();
    expect(typeof token.secret).toBe("string");
    expect(token.secret.length).toBeGreaterThan(0);
  });
});
```

> No workflow change is needed: `vitest.sandbox.config.ts` includes `src/**/*.sandbox.test.ts`, and the nightly Action runs `pnpm --filter @waitron/payments-stripe test:sandbox`, so this file is picked up automatically. Per-PR CI still excludes `*.sandbox.test.ts` via `vitest.config.ts`.

- [ ] **Step 3: Verify the sandbox file self-skips under the normal run and is excluded from coverage**

Run: `pnpm --filter @waitron/payments-stripe test:coverage`
Expected: PASS at ≥98% statements/lines/functions, ≥95% branches. The sandbox test is excluded from the default run entirely; `stripe-device-client.ts` no longer counts toward coverage.

- [ ] **Step 4: Commit**

```bash
git add packages/payments-stripe/vitest.config.ts packages/payments-stripe/src/connection-token.sandbox.test.ts
git commit -m "test(payments-stripe): coverage-exclude the real device binding + add the server-side connection-token sandbox"
```

---

## Task 10: Full-suite verification across the touched packages

**Files:** none (verification only).

- [ ] **Step 1: Coverage for every touched package**

Run: `pnpm --filter @waitron/core test:coverage && pnpm --filter @waitron/payments test:coverage && pnpm --filter @waitron/payments-stripe test:coverage`
Expected: all PASS at thresholds. (The neutral `@waitron/payments` gained `listAcceptedOffline` — a branchless read; its coverage stays green because `store.test.ts` exercises it. If a brand-new branchless file ever reports a phantom V8 branch under Linux, coverage-exclude it as `manual.ts` was.)

- [ ] **Step 2: Typecheck + lint + format across the repo**

Run: `pnpm -r typecheck && pnpm -r lint && pnpm format:check`
Expected: all PASS. (`format:check` is a separate pre-push/CI gate from `lint`; run `prettier --write` on any offenders.)

- [ ] **Step 3: Full test run (fiscal included — the incidents primitive change)**

Run: `pnpm -r test`
Expected: all PASS, confirming the `incidents` `ON CONFLICT` change is behavior-preserving for `record-sale`/`record-void`/fiscal `drain`/fiscal `reconcile`.

- [ ] **Step 4: Commit (only if any format/lint fixups were applied)**

```bash
git add -A
git commit -m "chore(payments): format/lint fixups for Mode 2b Cycle B"
```

---

## Self-Review

**Spec coverage** (each Cycle B spec item → task):
- `forward` joins the interface → Task 4. All-zeros `StripeTerminalProvider.forward` → Task 4.
- Table-wide incident invariant (partial unique index `NULLS NOT DISTINCT` + `ON CONFLICT DO NOTHING` on both writers) → Task 1. Concurrency proof → Task 2.
- `StripeDeviceClient` + `FakeStripeDevice` + coverage-excluded real binding + connection tokens → Task 5.
- Gate-up-front `collect`, single write, no `attempting`-first, `network_unavailable` persists nothing → Task 6. The gate wiring is load-bearing in the tests because `FakeStripeDevice`'s offline scenario yields `accepted_offline` only when `offlineAllowed` (Task 5).
- T1/T2 `forward`, no new `forwarding` state, `listAcceptedOffline` → Tasks 3 + 6.
- Reversals **shared, not re-implemented** — extracted as `reverseViaStripe` in Task 4; both `StripeTerminalProvider` and `StripeOnDeviceProvider` delegate (Tasks 4 + 6). Honours the design.
- Real-PG RLS → Task 7. Wiring capstone → Task 8. Coverage-exclude + server-side sandbox → Task 9. Full-suite verification → Task 10.

**Placeholder scan:** none — every step has concrete code or an exact command with expected output. The one deferred detail (the exact device-app→backend bridge for the real `collectOnDevice`/`syncOfflineQueue`) is explicitly out of scope (SP7/SP9) and lives behind a coverage-excluded throwing stub, not a plan placeholder.

**Type consistency:** `StripeDeviceClient`'s `collectOnDevice`/`syncOfflineQueue`/`createConnectionToken`/`refund` signatures are identical in the interface (Task 5), the fake (Task 5), the real impl (Task 5), and the provider's calls (Task 6). `DeviceCollectOutcome` is the single source for the four outcome strings. `PROVIDER = "stripe"` is used consistently in the provider, its tests (Tasks 6-8), and matches the global constraint. `ForwardResult`/`CollectParams`/`PaymentResult` come from `@waitron/payments` unchanged. Store helpers are called with their exact existing signatures (`insertAcceptedOffline` etc. take `NewPayment & { settledAt: Date }` where `externalRef?` flows through `insertPayment`).
