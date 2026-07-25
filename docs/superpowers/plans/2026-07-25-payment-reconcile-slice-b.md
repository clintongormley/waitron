# Payment `reconcile()` — Slice B (the Stripe adapter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three vendor ports Slice A left open, so the payment reconciliation sweep runs against a real Stripe account — a settlement-report source, a session↔PaymentIntent bridge that makes hosted rows matchable, and a resolver that finally lets a hosted orphan be auto-reversed.

**Architecture:** A fourth narrow client seam (`StripeReportClient`) alongside the existing three, with a `Fake*` double and a coverage-excluded real binding. `StripeReconciler` implements Slice A's `PaymentReconciler` and delegates to the neutral `reconcilePayments`, resolving a per-tenant Stripe client the way `StripeTerminalProvider` resolves a reader.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), the `stripe` SDK v22, drizzle-orm 0.45, PostgreSQL 18, PGlite for behavioural tests, Testcontainers for RLS, vitest 3.

**Spec:** [`docs/superpowers/specs/2026-07-25-payment-reconcile-slice-b-design.md`](../specs/2026-07-25-payment-reconcile-slice-b-design.md)
**Slice A's contract:** [`2026-07-25-payment-reconcile-design.md`](../specs/2026-07-25-payment-reconcile-design.md)

## Global Constraints

- **Everything lands in `packages/payments-stripe`** plus the two docs files. **`packages/payments` is NOT touched** — Slice A's contract is consumed unchanged through its barrel.
- **This package is NOT vocabulary-scanned.** `no-provider-vocabulary.test.ts` globs only `packages/payments`, so `Stripe`, `PaymentIntent`, `Checkout`, `reader` etc. are used freely here. Do not import the neutral package's restrictions.
- **Money is exact decimal.** Amounts cross the seam as `Decimal`; conversion uses the existing `toMinorUnits`/`fromMinorUnits` in `client.ts` and nothing else. **Never `Number()` an amount** beyond those two functions.
- **Compare GROSS, not net.** `balance_transaction.amount` is the gross charge; `net` is after Stripe's fee. Our `payments.amount` is what the customer paid, so mapping `net` would report every payment as `drift` by the fee amount.
- **T1/T2:** no database transaction may be held across a network call. The report source performs no database work at all; the sweep owns the transactions.
- **Additive only on shared code:** `reverseViaStripe` is used by both other Stripe providers. The resolver parameter is optional with an identity default so their behaviour is byte-identical.
- Real-SDK binding files are **coverage-excluded** with a comment naming why, exactly like `stripe-client.ts` / `stripe-device-client.ts` / `stripe-hosted-client.ts`.
- **Fakes live in `src/testing/` and are never barrel-exported** — a production import must not reach a test double.
- Coverage gate: 98/98/98/95. `pnpm format:check` (prettier) is a separate gate from `lint` (eslint).

**How to run tests in this environment (important):** the real-Postgres suites hang unless prefixed with `TESTCONTAINERS_RYUK_DISABLED=true` (a local Docker-registry stall; never commit it). Prefer targeted runs:

```
pnpm --filter @waitron/payments-stripe exec vitest run src/<file>.test.ts
```

Never use `run_in_background` for tests; pass an explicit long Bash timeout instead.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/report-client.ts` | **Create** — the `StripeReportClient` seam + its data types |
| `src/testing/fake-stripe-report.ts` | **Create** — deterministic double, records requested windows |
| `src/report-source.ts` | **Create** — `stripeSettlementReport()`: the two passes → `SettlementRecord[]` |
| `src/reconciler.ts` | **Create** — `StripeReconciler implements PaymentReconciler` |
| `src/stripe-report-client.ts` | **Create** — the real SDK binding (coverage-excluded) |
| `src/reverse.ts` | **Modify** — additive `resolveProcessorRef` parameter |
| `src/hosted-client.ts`, `src/stripe-hosted-client.ts`, `src/hosted-provider.ts`, `src/testing/fake-stripe-hosted.ts` | **Modify** — `metadata` on session create |
| `src/index.ts` | **Modify** — barrel exports |
| `vitest.config.ts` | **Modify** — coverage-exclude the new real binding |

---

### Task 1: The `StripeReportClient` seam and its fake

**Files:**

- Create: `packages/payments-stripe/src/report-client.ts`
- Create: `packages/payments-stripe/src/testing/fake-stripe-report.ts`
- Test: `packages/payments-stripe/src/testing/fake-stripe-report.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `StripeReportClient`, `StripeSettlement`, `StripeSessionRef`, and `FakeStripeReport`. Tasks 2, 3, 5 and 6 build on them.

- [ ] **Step 1: Write the failing fake test**

Create `packages/payments-stripe/src/testing/fake-stripe-report.test.ts`, modelled on the existing `fake-stripe-hosted.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeStripeReport } from "./fake-stripe-report.js";

const WINDOW = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

describe("FakeStripeReport", () => {
  it("returns the configured settlements and records the window it was asked for", async () => {
    const fake = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_1", chargeId: "ch_1", amountMinor: 1250, settledAt: new Date(0) },
      ],
    });
    expect(await fake.listSettlements(WINDOW)).toHaveLength(1);
    expect(fake.settlementWindows).toEqual([WINDOW]);
  });

  it("returns the configured sessions and records their window separately", async () => {
    const fake = new FakeStripeReport({
      sessions: [{ sessionId: "cs_1", paymentIntentId: "pi_1" }],
    });
    expect(await fake.listCheckoutSessions(WINDOW)).toEqual([
      { sessionId: "cs_1", paymentIntentId: "pi_1" },
    ]);
    expect(fake.sessionWindows).toEqual([WINDOW]);
    expect(fake.settlementWindows).toEqual([]);
  });

  it("resolves a session to its payment intent, and to null when unknown", async () => {
    const fake = new FakeStripeReport({
      sessions: [{ sessionId: "cs_1", paymentIntentId: "pi_1" }],
    });
    expect(await fake.paymentIntentForSession("cs_1")).toBe("pi_1");
    expect(await fake.paymentIntentForSession("cs_missing")).toBeNull();
  });

  it("defaults every collection to empty", async () => {
    const fake = new FakeStripeReport();
    expect(await fake.listSettlements(WINDOW)).toEqual([]);
    expect(await fake.listCheckoutSessions(WINDOW)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/testing/fake-stripe-report.test.ts`
Expected: FAIL — `Cannot find module './fake-stripe-report.js'`.

- [ ] **Step 3: Write the seam**

Create `packages/payments-stripe/src/report-client.ts`. Match the doc-comment density of `hosted-client.ts` (explain *why* each call exists, not what it does):

```ts
/** One settled charge as the audit reads it. `amountMinor` is the GROSS charge in minor units —
 * deliberately not `net`: `net` is after Stripe's fee, and our `payments.amount` is what the customer
 * paid, so reconciling against `net` would classify every single payment as a drift by the fee. */
export interface StripeSettlement {
  paymentIntentId: string | null;
  chargeId: string;
  amountMinor: number;
  settledAt: Date;
}

/** One Checkout Session, reduced to what the audit needs: the id a hosted `payments` row stores in
 * `external_ref`, the PaymentIntent the settlement ledger keys by, and the identifiers we stamped
 * into the session's metadata at creation. */
export interface StripeSessionRef {
  sessionId: string;
  paymentIntentId: string | null;
  hint?: { workingOrderId: string; paymentRef: string };
}

/** The narrow Stripe surface the reconcile adapter depends on — the three calls it makes, not the
 * SDK. The real impl (`./stripe-report-client.ts`) wraps the balance-transaction, Checkout-session
 * and session-retrieve APIs and is coverage-excluded; `FakeStripeReport` (`./testing/`) models it
 * deterministically. Separate from `StripeClient`/`StripeDeviceClient`/`StripeHostedClient`: each
 * seam names only the calls its own consumer uses. */
export interface StripeReportClient {
  /** Settled charges in the window — the settlement ledger the audit compares our books against.
   * Paged to exhaustion by the implementation, so the caller sees one flat list. */
  listSettlements(window: { from: Date; to: Date }): Promise<StripeSettlement[]>;
  /** Checkout Sessions created in the window. Two jobs: bridging PaymentIntent → Session id (a hosted
   * payment stores the SESSION id, while the settlement ledger only ever knows the PaymentIntent), and
   * carrying back the metadata that lets a settlement with no local row be attributed to a till. */
  listCheckoutSessions(window: { from: Date; to: Date }): Promise<StripeSessionRef[]>;
  /** The PaymentIntent behind one Checkout Session, or null when it has none (never paid). The
   * reversal path's resolver: a hosted payment stores a session id, and the refund API needs the
   * PaymentIntent. */
  paymentIntentForSession(sessionId: string): Promise<string | null>;
}
```

- [ ] **Step 4: Write the fake**

Create `packages/payments-stripe/src/testing/fake-stripe-report.ts`:

```ts
import type {
  StripeReportClient,
  StripeSessionRef,
  StripeSettlement,
} from "../report-client.js";

/** A deterministic in-memory `StripeReportClient` — the hermetic double for the reconcile adapter.
 * NOT barrel-exported (a production import cannot reach it), like `FakeStripe`/`FakeStripeDevice`/
 * `FakeStripeHosted`. It records every window it is asked for, so a test can assert the session pass
 * is widened backwards by the settlement lag — a silent regression there would leave hosted payments
 * unmatched and reading as `unsettled` for ever. */
export class FakeStripeReport implements StripeReportClient {
  readonly settlementWindows: { from: Date; to: Date }[] = [];
  readonly sessionWindows: { from: Date; to: Date }[] = [];
  private readonly settlements: StripeSettlement[];
  private readonly sessions: StripeSessionRef[];

  constructor(config: { settlements?: StripeSettlement[]; sessions?: StripeSessionRef[] } = {}) {
    this.settlements = config.settlements ?? [];
    this.sessions = config.sessions ?? [];
  }

  listSettlements(window: { from: Date; to: Date }): Promise<StripeSettlement[]> {
    this.settlementWindows.push(window);
    return Promise.resolve(this.settlements);
  }

  listCheckoutSessions(window: { from: Date; to: Date }): Promise<StripeSessionRef[]> {
    this.sessionWindows.push(window);
    return Promise.resolve(this.sessions);
  }

  paymentIntentForSession(sessionId: string): Promise<string | null> {
    const found = this.sessions.find((s) => s.sessionId === sessionId);
    return Promise.resolve(found?.paymentIntentId ?? null);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/testing/fake-stripe-report.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @waitron/payments-stripe typecheck`

```bash
git add packages/payments-stripe/src/report-client.ts packages/payments-stripe/src/testing/fake-stripe-report.ts packages/payments-stripe/src/testing/fake-stripe-report.test.ts
git commit -m "feat(payments-stripe): the StripeReportClient seam + its fake"
```

---

### Task 2: The settlement report source

**Files:**

- Create: `packages/payments-stripe/src/report-source.ts`
- Test: `packages/payments-stripe/src/report-source.test.ts`

**Interfaces:**

- Consumes: Task 1's `StripeReportClient`, `StripeSettlement`, `StripeSessionRef`, `FakeStripeReport`; `fromMinorUnits` from `./client.js`; `SettlementRecord`/`ReconcilePeriod` types from `@waitron/payments`.
- Produces: `stripeSettlementReport(client: StripeReportClient, settlementLagMs: number): SettlementReportSource` — used by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `packages/payments-stripe/src/report-source.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decimal, tenantId as brandTenantId } from "@waitron/shared";
import { DEFAULT_SETTLEMENT_LAG_MS } from "@waitron/payments";
import { stripeSettlementReport } from "./report-source.js";
import { FakeStripeReport } from "./testing/fake-stripe-report.js";

const TENANT = brandTenantId("11111111-1111-1111-1111-111111111111");
const WINDOW = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-09T00:00:00Z") };
const SETTLED_AT = new Date("2026-07-02T10:00:00Z");

describe("stripeSettlementReport", () => {
  it("carries the payment intent and charge ids as references", async () => {
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_1", chargeId: "ch_1", amountMinor: 1250, settledAt: SETTLED_AT },
      ],
    });
    const [record] = await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(
      TENANT,
      WINDOW,
    );
    expect(record.references).toEqual(["pi_1", "ch_1"]);
    expect(record.amount).toBe(decimal("12.50"));
    expect(record.settledAt).toEqual(SETTLED_AT);
    expect(record.hint).toBeUndefined();
  });

  it("adds the checkout session id when one maps to the payment intent", async () => {
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_1", chargeId: "ch_1", amountMinor: 1250, settledAt: SETTLED_AT },
      ],
      sessions: [{ sessionId: "cs_1", paymentIntentId: "pi_1" }],
    });
    const [record] = await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(
      TENANT,
      WINDOW,
    );
    // The session id is what a HOSTED payments row stores in external_ref; without it every hosted
    // payment reads as `unsettled` for ever and every hosted settlement as `missingLocal`.
    expect(record.references).toEqual(["pi_1", "ch_1", "cs_1"]);
  });

  it("carries the session metadata through as the attribution hint", async () => {
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_1", chargeId: "ch_1", amountMinor: 500, settledAt: SETTLED_AT },
      ],
      sessions: [
        {
          sessionId: "cs_1",
          paymentIntentId: "pi_1",
          hint: { workingOrderId: "wo-1", paymentRef: "ref-1" },
        },
      ],
    });
    const [record] = await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(
      TENANT,
      WINDOW,
    );
    expect(record.hint).toEqual({ workingOrderId: "wo-1", paymentRef: "ref-1" });
  });

  it("omits a null payment intent from the references rather than emitting a null id", async () => {
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: null, chargeId: "ch_1", amountMinor: 100, settledAt: SETTLED_AT },
      ],
    });
    const [record] = await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(
      TENANT,
      WINDOW,
    );
    expect(record.references).toEqual(["ch_1"]);
  });

  it("widens the session window BACKWARDS by the settlement lag, leaving the ledger window alone", async () => {
    const client = new FakeStripeReport();
    await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(TENANT, WINDOW);
    // The ledger pass asks for exactly the window the sweep gave it...
    expect(client.settlementWindows).toEqual([WINDOW]);
    // ...while the session pass reaches further back, because a session created BEFORE the window
    // can have its charge settle inside it.
    expect(client.sessionWindows[0].from).toEqual(
      new Date(WINDOW.from.getTime() - DEFAULT_SETTLEMENT_LAG_MS),
    );
    expect(client.sessionWindows[0].to).toEqual(WINDOW.to);
  });

  it("converts minor units exactly, including amounts a float would mangle", async () => {
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_1", chargeId: "ch_1", amountMinor: 1010, settledAt: SETTLED_AT },
        { paymentIntentId: "pi_2", chargeId: "ch_2", amountMinor: 7, settledAt: SETTLED_AT },
      ],
    });
    const records = await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(
      TENANT,
      WINDOW,
    );
    expect(records.map((r) => r.amount)).toEqual([decimal("10.10"), decimal("0.07")]);
  });

  it("returns an empty report without inventing records", async () => {
    const client = new FakeStripeReport();
    expect(
      await stripeSettlementReport(client, DEFAULT_SETTLEMENT_LAG_MS).fetch(TENANT, WINDOW),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/report-source.test.ts`
Expected: FAIL — `Cannot find module './report-source.js'`.

- [ ] **Step 3: Implement the report source**

Create `packages/payments-stripe/src/report-source.ts`:

```ts
import type { ReconcilePeriod, SettlementRecord, SettlementReportSource } from "@waitron/payments";
import type { TenantId } from "@waitron/shared";
import { fromMinorUnits } from "./client.js";
import type { StripeReportClient } from "./report-client.js";

/**
 * The Stripe half of the reconciliation audit: turn one tenant's Stripe account into the neutral
 * `SettlementRecord[]` the sweep classifies against.
 *
 * Two paged passes per sweep, never one per record — the settlement ledger, and the Checkout
 * Sessions that bridge it to our hosted rows. Both are whole-window calls, so cost is flat in the
 * number of settlements.
 *
 * Tenant scoping is structural rather than a filter: `client` is resolved per tenant by the caller
 * and a standalone Stripe account holds exactly one tenant's money, which is how this implementation
 * honours `SettlementReportSource`'s contract that a source return only `tenantId`'s settlements.
 */
export function stripeSettlementReport(
  client: StripeReportClient,
  settlementLagMs: number,
): SettlementReportSource {
  return {
    async fetch(_tenantId: TenantId, window: ReconcilePeriod): Promise<SettlementRecord[]> {
      // The ledger pass takes the sweep's window as given — the sweep has already widened it
      // forwards by the lag, because a payment captured at the end of a period settles after it.
      const settlements = await client.listSettlements(window);

      // The session pass reaches further BACK instead: a session created before the period can have
      // its charge settle inside it, and an unmapped hosted payment has no matchable reference at
      // all — it would read as `unsettled` for ever, and its settlement as `missingLocal`.
      const sessions = await client.listCheckoutSessions({
        from: new Date(window.from.getTime() - settlementLagMs),
        to: window.to,
      });
      const byPaymentIntent = new Map(
        sessions
          .filter((s) => s.paymentIntentId !== null)
          .map((s) => [s.paymentIntentId as string, s]),
      );

      return settlements.map((settlement) => {
        const session =
          settlement.paymentIntentId === null
            ? undefined
            : byPaymentIntent.get(settlement.paymentIntentId);
        return {
          // Every id that could be a local `external_ref`: the PaymentIntent (terminal/on-device
          // rows), the charge, and the Checkout Session (hosted rows) when one maps.
          references: [
            ...(settlement.paymentIntentId === null ? [] : [settlement.paymentIntentId]),
            settlement.chargeId,
            ...(session === undefined ? [] : [session.sessionId]),
          ],
          amount: fromMinorUnits(settlement.amountMinor),
          settledAt: settlement.settledAt,
          ...(session?.hint === undefined ? {} : { hint: session.hint }),
        };
      });
    },
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/report-source.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint, typecheck, commit**

Run: `pnpm --filter @waitron/payments-stripe lint && pnpm --filter @waitron/payments-stripe typecheck`

```bash
git add packages/payments-stripe/src/report-source.ts packages/payments-stripe/src/report-source.test.ts
git commit -m "feat(payments-stripe): the settlement report source (ledger + session bridge)"
```

---

### Task 3: `StripeReconciler`

**Files:**

- Create: `packages/payments-stripe/src/reconciler.ts`
- Test: `packages/payments-stripe/src/reconciler.test.ts`

**Interfaces:**

- Consumes: Task 2's `stripeSettlementReport`; `reconcilePayments`, `DEFAULT_SETTLEMENT_LAG_MS`, `PaymentReconciler`, `PaymentReconcileResult`, `ReconcilePeriod` from `@waitron/payments`; `recordIncidentOnce` from `@waitron/core`; `reverseViaStripe` from `./reverse.js`.
- Produces: `StripeReconciler`, `StripeReconcilerOptions`. Tasks 5–7 build on them.

- [ ] **Step 1: Write the failing tests**

Create `packages/payments-stripe/src/reconciler.test.ts`. It drives the REAL neutral sweep against PGlite, so it is the proof that the adapter and Slice A fit together:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal, tenantId as brandTenantId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, insertCapturedPayment, insertInitiated } from "@waitron/payments";
import { seedWorkingOrder, freshNif } from "@waitron/payments/test/seed.js";
import { StripeReconciler } from "./reconciler.js";
import { FakeStripeReport } from "./testing/fake-stripe-report.js";

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
  await db.execute("truncate incidents, payment_refunds, payments cascade");
});

const NOW = new Date("2026-07-25T12:00:00Z");
const OLD = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

function reconciler(client: FakeStripeReport): StripeReconciler {
  return new StripeReconciler({ db, resolveClient: () => Promise.resolve(client) });
}

describe("StripeReconciler", () => {
  it("audits the settlement identity, not one capture mechanism", () => {
    expect(reconciler(new FakeStripeReport()).provider).toBe("stripe");
  });

  it("matches a terminal row by its payment intent and reports no mismatch", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const saleless = await withTenant(db, seeded.tenantId, (tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "stripe",
        paymentRef: "ref-terminal",
        externalRef: "pi_terminal",
        amount: decimal("10.00"),
        settledAt: OLD,
      }),
    );
    void saleless;
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_terminal", chargeId: "ch_1", amountMinor: 1000, settledAt: OLD },
      ],
    });
    const result = await reconciler(client).reconcile(
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.checked).toBe(1);
    expect(result.unsettled).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.missingLocal).toEqual([]);
  });

  it("matches a HOSTED row by its checkout session id, which the ledger never carries", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await withTenant(db, seeded.tenantId, (tx) =>
      insertInitiated(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "stripe",
        paymentRef: "ref-hosted",
        externalRef: "cs_hosted",
        amount: decimal("10.00"),
      }),
    );
    const now = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) };
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_hosted", chargeId: "ch_2", amountMinor: 1000, settledAt: OLD },
      ],
      sessions: [{ sessionId: "cs_hosted", paymentIntentId: "pi_hosted" }],
    });
    const result = await reconciler(client).reconcile(brandTenantId(seeded.tenantId), now, NOW);
    // The bridge worked: the local `initiated` row was matched, so this is the missed-webhook
    // class rather than an unrecognised settlement.
    expect(result.lostSettlement).toHaveLength(1);
    expect(result.missingLocal).toEqual([]);
  });

  it("reports a settlement with no local row as missingLocal", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_ghost", chargeId: "ch_ghost", amountMinor: 1000, settledAt: OLD },
      ],
    });
    const result = await reconciler(client).reconcile(
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.missingLocal).toHaveLength(1);
    expect(result.missingLocal[0].references).toEqual(["pi_ghost", "ch_ghost"]);
  });

  it("resolves a per-tenant client for every sweep", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const asked: string[] = [];
    const client = new FakeStripeReport();
    const r = new StripeReconciler({
      db,
      resolveClient: (tenantId) => {
        asked.push(tenantId);
        return Promise.resolve(client);
      },
    });
    await r.reconcile(brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(asked).toEqual([seeded.tenantId]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/reconciler.test.ts`
Expected: FAIL — `Cannot find module './reconciler.js'`.

- [ ] **Step 3: Implement the reconciler**

Create `packages/payments-stripe/src/reconciler.ts`:

```ts
import { recordIncidentOnce } from "@waitron/core";
import type { Database } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
import {
  DEFAULT_SETTLEMENT_LAG_MS,
  reconcilePayments,
} from "@waitron/payments";
import type {
  PaymentReconcileResult,
  PaymentReconciler,
  ReconcilePeriod,
} from "@waitron/payments";
import type { StripeReportClient } from "./report-client.js";
import { stripeSettlementReport } from "./report-source.js";
import { reverseViaStripe } from "./reverse.js";

const PROVIDER = "stripe";

export interface StripeReconcilerOptions {
  db: Database;
  /** The tenant's own Stripe account surface. A FUNCTION, not a fixed client: a reconciler is built
   * once and swept across many tenants, while the accounts are standalone (one per merchant, no
   * Connect), so the resolved client IS the tenant scoping the report source's contract demands.
   * Mirrors `StripeTerminalProviderOptions.resolveReader`; provisioning stays deferred. */
  resolveClient: (tenantId: TenantId) => Promise<StripeReportClient>;
  /** How long the processor may legitimately take to report a settlement. Defaults to the neutral
   * layer's own seven days. */
  settlementLagMs?: number;
}

/**
 * The Stripe implementation of the reconciliation audit — ONE reconciler for the whole settlement
 * identity. All three Stripe adapters (server-driven terminal, on-device, and hosted Checkout) write
 * `provider = "stripe"`, so this single sweep audits every payment any of them took: that is exactly
 * why the audit hangs off its own interface instead of `PaymentProvider`, whose hosted implementer
 * does not exist.
 *
 * The method is a delegation: the neutral `reconcilePayments` owns the algorithm, and this wires its
 * three vendor ports — the report source, a reversal that can address a hosted payment, and the
 * incident sink.
 */
export class StripeReconciler implements PaymentReconciler {
  readonly provider = PROVIDER;

  constructor(private readonly opts: StripeReconcilerOptions) {}

  async reconcile(
    tenantId: TenantId,
    period: ReconcilePeriod,
    now: Date,
  ): Promise<PaymentReconcileResult> {
    const client = await this.opts.resolveClient(tenantId);
    const settlementLagMs = this.opts.settlementLagMs ?? DEFAULT_SETTLEMENT_LAG_MS;
    return reconcilePayments(
      {
        db: this.opts.db,
        provider: PROVIDER,
        report: stripeSettlementReport(client, settlementLagMs),
        reverse: (paymentRef) => this.reverse(client, paymentRef),
        incidents: recordIncidentOnce,
        settlementLagMs,
      },
      tenantId,
      period,
      now,
    );
  }

  /** Task 5 gives this the hosted-session resolver. */
  private async reverse(client: StripeReportClient, paymentRef: string): Promise<void> {
    void client;
    await reverseViaStripe(this.opts.db, client as never, PROVIDER, paymentRef, "refund");
  }
}
```

> The `reverse` body above is deliberately provisional — Task 5 replaces it, adds the resolver, and fixes the client typing. Do not attempt to make it correct here; Task 3's tests never exercise a reversal.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/reconciler.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/payments-stripe/src/reconciler.ts packages/payments-stripe/src/reconciler.test.ts
git commit -m "feat(payments-stripe): StripeReconciler wiring the neutral sweep"
```

---

### Task 4: Session metadata — the attribution hint

**Files:**

- Modify: `packages/payments-stripe/src/hosted-client.ts`, `src/stripe-hosted-client.ts`, `src/hosted-provider.ts`, `src/testing/fake-stripe-hosted.ts`
- Test: `packages/payments-stripe/src/hosted-provider.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `createCheckoutSession` gains a required `metadata: { working_order_id: string; payment_ref: string }` parameter, and `StripeHostedProvider.initiate` supplies it. Task 8's sandbox asserts it round-trips.

- [ ] **Step 1: Write the failing test**

Append to `packages/payments-stripe/src/hosted-provider.test.ts`, following the file's existing style (it asserts what the fake was called with):

```ts
  it("stamps the working order and payment ref into the session metadata", async () => {
    // These are what let a settlement with NO local row be attributed to a till and raise an
    // incident: an `initiate` that crashes after the network call leaves exactly that state, and
    // hosted capture is the only mode that can produce it (the others write `attempting` first).
    const client = new FakeStripeHosted();
    const provider = new StripeHostedProvider({ client, db });
    const seeded = await seedWorkingOrder(db, freshNif());
    await provider.initiate({
      tenantId: brandTenantId(seeded.tenantId),
      workingOrderId: brandWorkingOrderId(seeded.workingOrderId),
      amount: decimal("12.50"),
      paymentRef: "ref-meta",
    });
    expect(client.lastCreate?.metadata).toEqual({
      working_order_id: seeded.workingOrderId,
      payment_ref: "ref-meta",
    });
  });
```

Add whatever imports that test needs to the file, following its existing import block.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/hosted-provider.test.ts`
Expected: FAIL — `lastCreate` does not exist on `FakeStripeHosted`.

- [ ] **Step 3: Add `metadata` to the seam**

In `packages/payments-stripe/src/hosted-client.ts`, extend `createCheckoutSession`'s parameter object with:

```ts
    /** Our own identifiers, stamped onto the session so the reconciliation audit can attribute a
     * settlement that has NO local row back to a till. Only the hosted create carries this: an
     * `initiate` crash between the network call and the row write is the one way a settlement can
     * exist with nothing local, and terminal/on-device both commit an `attempting` row first. */
    metadata: { working_order_id: string; payment_ref: string };
```

- [ ] **Step 4: Thread it through the fake and the real binding**

In `src/testing/fake-stripe-hosted.ts`, stop ignoring the parameter — record it so tests can assert it:

```ts
  /** The last `createCheckoutSession` params, so a test can assert what was stamped. */
  lastCreate: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    metadata: { working_order_id: string; payment_ref: string };
  } | null = null;

  createCheckoutSession(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
    metadata: { working_order_id: string; payment_ref: string };
  }): Promise<{ id: string; url: string }> {
    this.lastCreate = params;
    const id = nextId("cs");
    return Promise.resolve({ id, url: `https://checkout.stripe.test/${id}` });
  }
```

Remove the now-unneeded eslint-disable and underscore prefix on that method.

In `src/stripe-hosted-client.ts`, pass it to the SDK — both on the session and, so it survives onto the PaymentIntent, via `payment_intent_data`:

```ts
        {
          mode: "payment",
          metadata: params.metadata,
          payment_intent_data: { metadata: params.metadata },
          success_url: config.successUrl,
          // …unchanged…
        },
```

- [ ] **Step 5: Supply it from the provider**

In `src/hosted-provider.ts`'s `initiate`, add to the `createCheckoutSession` call:

```ts
      metadata: { working_order_id: params.workingOrderId, payment_ref: params.paymentRef },
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/hosted-provider.test.ts src/hosted.wiring.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/payments-stripe/src/hosted-client.ts packages/payments-stripe/src/stripe-hosted-client.ts packages/payments-stripe/src/hosted-provider.ts packages/payments-stripe/src/testing/fake-stripe-hosted.ts packages/payments-stripe/src/hosted-provider.test.ts
git commit -m "feat(payments-stripe): stamp working order + payment ref into session metadata"
```

---

### Task 5: The reversal resolver hook

**Files:**

- Modify: `packages/payments-stripe/src/reverse.ts`, `src/reconciler.ts`
- Test: `packages/payments-stripe/src/provider.test.ts` (where `reverseViaStripe` is already exercised), `src/reconciler.test.ts`

**Interfaces:**

- Consumes: Task 1's `StripeReportClient.paymentIntentForSession`, Task 3's `StripeReconciler`.
- Produces: `reverseViaStripe(..., resolveProcessorRef?)` and a `StripeReconciler.reverse` that can address a hosted payment.

- [ ] **Step 1: Write the failing tests**

Add to `packages/payments-stripe/src/provider.test.ts` (it already has `reverseViaStripe` coverage — follow its existing setup):

```ts
  it("passes the stored external ref to the processor unchanged by default", async () => {
    // The identity default is what keeps the terminal and on-device callers byte-identical.
    const { db, client, key } = await capturedPayment("pi_plain");
    await reverseViaStripe(db, client, "stripe", key.paymentRef, "refund");
    expect(client.lastRefund?.paymentIntentId).toBe("pi_plain");
  });

  it("resolves the external ref through the supplied resolver before refunding", async () => {
    const { db, client, key } = await capturedPayment("cs_hosted");
    await reverseViaStripe(db, client, "stripe", key.paymentRef, "refund", undefined, async (ref) =>
      ref === "cs_hosted" ? "pi_resolved" : ref,
    );
    // A hosted payment stores the SESSION id; the refund API needs the PaymentIntent, and before
    // this hook every hosted orphan reversal failed permanently.
    expect(client.lastRefund?.paymentIntentId).toBe("pi_resolved");
  });
```

Add to `src/reconciler.test.ts`:

```ts
  it("auto-reverses a hosted orphan by resolving its session to a payment intent", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await withTenant(db, seeded.tenantId, (tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "stripe",
        paymentRef: "ref-hosted-orphan",
        externalRef: "cs_orphan",
        amount: decimal("10.00"),
        settledAt: OLD,
      }),
    );
    await db.execute(
      `update working_orders set status = 'abandoned' where id = '${seeded.workingOrderId}'`,
    );
    const client = new FakeStripeReport({
      settlements: [
        { paymentIntentId: "pi_orphan", chargeId: "ch_o", amountMinor: 1000, settledAt: OLD },
      ],
      sessions: [{ sessionId: "cs_orphan", paymentIntentId: "pi_orphan" }],
    });
    const result = await reconciler(client, refunder).reconcile(
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.remediated).toBe(1);
    expect(result.remediationFailures).toEqual([]);
    expect(refunder.lastRefund?.paymentIntentId).toBe("pi_orphan");
  });
```

`reconciler()` needs a second parameter for the refunding client — extend the helper, and construct a `FakeStripe` (the existing refund double) for it. Wire it through `StripeReconcilerOptions` as a `refunder` alongside `resolveClient`, or resolve both from one object; choose the shape that keeps the options honest and say why in a comment.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/provider.test.ts src/reconciler.test.ts`
Expected: FAIL — `reverseViaStripe` takes no resolver; the hosted orphan's reversal fails.

- [ ] **Step 3: Add the resolver parameter**

In `packages/payments-stripe/src/reverse.ts`, add a final optional parameter and use it. Extend the existing doc comment to record why it exists and why it is optional:

```ts
export async function reverseViaStripe(
  db: Database,
  client: StripeRefunder,
  provider: string,
  ref: string,
  kind: "void" | "refund",
  amount?: Decimal,
  /** Maps the payment's stored `external_ref` to the identifier the processor's refund API needs.
   * Defaults to identity, so the terminal and on-device callers behave exactly as before. Reconcile
   * supplies a real one: a hosted payment stores its Checkout Session id, while `stripe.refunds`
   * addresses a PaymentIntent — which is why every hosted orphan reversal used to fail permanently. */
  resolveProcessorRef: (externalRef: string) => Promise<string> = (externalRef) =>
    Promise.resolve(externalRef),
): Promise<PaymentResult> {
```

and change the refund call's id to the resolved value:

```ts
  const processorRef = await resolveProcessorRef(found.externalRef);
  const outcome = await client.refund({
    paymentIntentId: processorRef,
    ...(amount ? { amount } : {}),
    idempotencyKey: randomUUID(),
  });
```

Resolve it **after** `assertReversible` and **outside** any transaction — it is a network call.

- [ ] **Step 4: Wire it in the reconciler**

Replace Task 3's provisional `reverse` in `src/reconciler.ts` with one that resolves a hosted session id and refunds through the real refund client. A session that resolves to no PaymentIntent throws `payment.not_found`, which the sweep already turns into one aggregated `reconcile_remediation_failed` with the marker stamped — the correct outcome for a session that was never paid.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run src/provider.test.ts src/reconciler.test.ts src/device-provider.test.ts`
Expected: PASS — including the device provider, which proves the identity default left the other callers alone.

- [ ] **Step 6: Commit**

```bash
git add packages/payments-stripe/src/reverse.ts packages/payments-stripe/src/reconciler.ts packages/payments-stripe/src/provider.test.ts packages/payments-stripe/src/reconciler.test.ts
git commit -m "feat(payments-stripe): resolve a hosted session to its payment intent when reversing"
```

---

### Task 6: The real SDK binding and the package surface

**Files:**

- Create: `packages/payments-stripe/src/stripe-report-client.ts`
- Modify: `packages/payments-stripe/src/index.ts`, `vitest.config.ts`
- Test: `packages/payments-stripe/src/index.test.ts` if one exists; otherwise assert the surface in `src/wiring.test.ts`

**Interfaces:**

- Consumes: Task 1's seam types.
- Produces: `stripeReportClient(stripe: Stripe): StripeReportClient`, and the barrel exports Slice B's consumers need.

- [ ] **Step 1: Write the real binding**

Create `packages/payments-stripe/src/stripe-report-client.ts`, mirroring `stripe-hosted-client.ts`'s structure and its coverage-exclusion rationale:

```ts
import type Stripe from "stripe";
import type {
  StripeReportClient,
  StripeSessionRef,
  StripeSettlement,
} from "./report-client.js";

/** The real `StripeReportClient`, wrapping the balance-transaction and Checkout-session APIs.
 * Coverage-excluded (see vitest.config.ts): a thin call-mapping boundary whose logic is the SDK's,
 * exercised by the nightly sandbox. Both list calls page to exhaustion via `autoPagingEach`, so a
 * busy tenant's report is never silently truncated — a truncated ledger would read as missing
 * settlements and manufacture false `unsettled` findings. */
export function stripeReportClient(stripe: Stripe): StripeReportClient {
  return {
    async listSettlements(window): Promise<StripeSettlement[]> {
      const out: StripeSettlement[] = [];
      await stripe.balanceTransactions
        .list({
          created: { gte: unix(window.from), lt: unix(window.to) },
          type: "charge",
          expand: ["data.source"],
          limit: 100,
        })
        .autoPagingEach((bt) => {
          const charge = bt.source as Stripe.Charge | null;
          out.push({
            paymentIntentId:
              charge === null || typeof charge.payment_intent !== "string"
                ? null
                : charge.payment_intent,
            chargeId: charge?.id ?? "",
            // GROSS, never `bt.net`: net is after Stripe's fee, and our stored amount is what the
            // customer paid, so reconciling against net would flag every payment as drift.
            amountMinor: bt.amount,
            settledAt: new Date(bt.created * 1000),
          });
        });
      return out;
    },

    async listCheckoutSessions(window): Promise<StripeSessionRef[]> {
      const out: StripeSessionRef[] = [];
      await stripe.checkout.sessions
        .list({ created: { gte: unix(window.from), lt: unix(window.to) }, limit: 100 })
        .autoPagingEach((session) => {
          const workingOrderId = session.metadata?.working_order_id;
          const paymentRef = session.metadata?.payment_ref;
          out.push({
            sessionId: session.id,
            paymentIntentId:
              typeof session.payment_intent === "string" ? session.payment_intent : null,
            ...(workingOrderId !== undefined && paymentRef !== undefined
              ? { hint: { workingOrderId, paymentRef } }
              : {}),
          });
        });
      return out;
    },

    async paymentIntentForSession(sessionId): Promise<string | null> {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      return typeof session.payment_intent === "string" ? session.payment_intent : null;
    },
  };
}

/** Stripe's list filters take UNIX seconds, not milliseconds or ISO strings. */
function unix(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}
```

- [ ] **Step 2: Coverage-exclude it**

In `packages/payments-stripe/vitest.config.ts`, add to `coverage.exclude`, next to its three siblings:

```ts
        // The real balance-transaction / Checkout-session SDK boundary — paging and field mapping
        // exercised only by the nightly sandbox; the report source's own logic is proven through
        // FakeStripeReport.
        "src/stripe-report-client.ts",
```

- [ ] **Step 3: Export the surface**

In `packages/payments-stripe/src/index.ts`, add the reconcile surface, following the file's existing grouping and ordering:

```ts
export { StripeReconciler } from "./reconciler.js";
export type { StripeReconcilerOptions } from "./reconciler.js";
export { stripeSettlementReport } from "./report-source.js";
export { stripeReportClient } from "./stripe-report-client.js";
export type { StripeReportClient, StripeSessionRef, StripeSettlement } from "./report-client.js";
```

The fakes stay unexported.

- [ ] **Step 4: Assert the surface**

Add a runtime check alongside the package's existing surface assertions (type-only checks are erased at runtime and cannot catch a dropped export):

```ts
  it("re-exports the reconcile surface from the package root", () => {
    expect(typeof StripeReconciler).toBe("function");
    expect(typeof stripeSettlementReport).toBe("function");
    expect(typeof stripeReportClient).toBe("function");
  });
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run && pnpm --filter @waitron/payments-stripe typecheck && pnpm --filter @waitron/payments-stripe lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/payments-stripe/src/stripe-report-client.ts packages/payments-stripe/src/index.ts packages/payments-stripe/vitest.config.ts packages/payments-stripe/src/wiring.test.ts packages/payments-stripe/src/index.test.ts
git commit -m "feat(payments-stripe): real report-client binding + package surface"
```

---

### Task 7: Real-Postgres RLS suite

**Files:**

- Create: `packages/payments-stripe/src/reconcile.rls.test.ts`

**Interfaces:** consumes `StripeReconciler`, `FakeStripeReport`, `startRealPostgres`. Produces nothing.

- [ ] **Step 1: Write the suite**

Create `packages/payments-stripe/src/reconcile.rls.test.ts`, modelled on the existing `hosted.rls.test.ts` (same probe-role setup, same `execute(string)` note, a UNIQUE probe role name such as `rls_probe_reconcile`). It must prove the sweep runs end to end through `StripeReconciler` as a non-superuser member of `app_user`: seed a captured `stripe` payment on an abandoned working order as admin, sweep as the probe, and assert the orphan is found, the incident inserted and the marker stamped. PGlite connects as superuser and bypasses `FORCE ROW LEVEL SECURITY`, so this is the only place the grants and policies the adapter's sweep depends on are actually exercised.

- [ ] **Step 2: Run it**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/payments-stripe exec vitest run src/reconcile.rls.test.ts`
Expected: PASS. A missing privilege is a real finding — fix it with a GRANT migration, never by weakening the test or switching to the superuser connection. Docker being absent must THROW, never skip.

- [ ] **Step 3: Commit**

```bash
git add packages/payments-stripe/src/reconcile.rls.test.ts
git commit -m "test(payments-stripe): reconcile through StripeReconciler under real RLS"
```

---

### Task 8: The nightly sandbox suite

**Files:**

- Create: `packages/payments-stripe/src/reconcile.sandbox.test.ts`

**Interfaces:** consumes `stripeReportClient`. Produces nothing.

- [ ] **Step 1: Write the suite**

Create `packages/payments-stripe/src/reconcile.sandbox.test.ts`, modelled on the existing `checkout.sandbox.test.ts`: env-gated on `STRIPE_SECRET_KEY` exactly as its siblings are, excluded from PR runs by the `*.sandbox.test.ts` glob, and run only by the nightly workflow.

It must prove the two things only a real account can: that `listCheckoutSessions` reads back a session **created with metadata** and surfaces it as the `hint`, and that `paymentIntentForSession` returns null for a session that was never paid (a real, reachable state — the customer abandoned it). Creating a genuinely *settled* charge needs a completed payment, which a headless test cannot drive; assert what is reachable and say in a comment why the settled-charge half is not.

- [ ] **Step 2: Verify it is excluded from the normal run**

Run: `pnpm --filter @waitron/payments-stripe exec vitest run 2>&1 | grep -c sandbox`
Expected: `0` — the sandbox suite must not run in the PR suite.

- [ ] **Step 3: Run it against the sandbox if a key is present**

Run: `STRIPE_SECRET_KEY=$STRIPE_SANDBOX_SECRET_KEY pnpm --filter @waitron/payments-stripe exec vitest run --config vitest.sandbox.config.ts` (skip if the key is unset locally; the nightly workflow runs it).

- [ ] **Step 4: Commit**

```bash
git add packages/payments-stripe/src/reconcile.sandbox.test.ts
git commit -m "test(payments-stripe): nightly sandbox coverage for the report client"
```

---

### Task 9: Coverage, docs and the final gates

**Files:**

- Modify: `docs/superpowers/specs/2026-07-22-payment-layer-design.md`, `docs/superpowers/specs/2026-07-25-payment-reconcile-design.md`

- [ ] **Step 1: Run the coverage gate**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/payments-stripe test:coverage`
Expected: ≥ 98/98/98/95.

If it falls short: add the missing test to the suite that owns the behaviour; delete an unreachable defensive branch rather than adding an untestable test (it would fail the branch gate); and only a genuine v8 artifact justifies a `coverage.exclude`, with a comment naming it.

- [ ] **Step 2: Update the two design docs**

In `docs/superpowers/specs/2026-07-25-payment-reconcile-design.md`:

- §11's hosted-reversal bullet is now **wrong** — it says a hosted orphan's reversal fails and raises `reconcile_remediation_failed`. Replace it with a note that Slice B closed this via `reverseViaStripe`'s optional `resolveProcessorRef`, which maps a Checkout Session id to its PaymentIntent.
- §10's Slice B paragraph: mark it landed and correct it to what shipped — balance transactions (not payouts) for immediacy, session metadata only for the hint, and the resolver hook.

In `docs/superpowers/specs/2026-07-22-payment-layer-design.md`, §10 item 5: record that reconcile is complete for Stripe (both slices).

- [ ] **Step 3: Format, lint, typecheck, whole-repo test**

Run: `pnpm format:check` (fix with `npx prettier --write` on what it names), then `pnpm --filter @waitron/payments-stripe lint`, `pnpm -r typecheck`, and `TESTCONTAINERS_RYUK_DISABLED=true pnpm -r test`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(payments): record reconcile Slice B in the design specs"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §1 `StripeReconciler`, per-tenant `resolveClient` | 3 |
| §2 the `StripeReportClient` seam | 1, 6 |
| §3 two paged passes, references, gross-not-net, widened session window | 2, 6 |
| §4 session metadata → hint | 4 |
| §5 additive `resolveProcessorRef`, hosted reversal | 5 |
| §6 testing (fake, report source, reconciler, reverse, RLS, sandbox, coverage) | 1–9 |
| §7 out of scope | not implemented, by design |

**Type consistency:** `StripeReportClient`, `StripeSettlement`, `StripeSessionRef` (Task 1) are used under those names in Tasks 2, 3, 5, 6. `stripeSettlementReport(client, settlementLagMs)` (Task 2) is called with exactly that shape in Task 3. `resolveProcessorRef` is the seventh parameter of `reverseViaStripe` in both Task 5's tests and its implementation.

**Known intentional gap:** Task 3's `reverse` is provisional and knowingly mistyped (`client as never`); Task 5 replaces it. Task 3's tests never exercise a reversal, so it is green at both points — but Task 5 must not be skipped.
