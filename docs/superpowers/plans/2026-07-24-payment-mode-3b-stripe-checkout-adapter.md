# Mode 3 Slice B — Stripe Checkout adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the real Stripe Checkout adapter behind Slice A's neutral `AsyncPaymentProvider` — `StripeHostedProvider.initiate()` mints a Checkout Session and writes an `initiated` row; `verifyAndParse()` verifies a webhook signature and maps `checkout.session.completed`/`expired` into the neutral `InboundSettlement`.

**Architecture:** A third provider class in `@waitron/payments-stripe` (beside `StripeTerminalProvider` (2a) and `StripeOnDeviceProvider` (2b)), implementing the neutral `AsyncPaymentProvider` interface from `@waitron/payments`. It talks to Stripe through a **new narrow injected seam** `StripeHostedClient` (mirroring the existing `StripeDeviceClient`), with a real SDK binding (`stripeHostedClient`, coverage-excluded) and a deterministic `FakeStripeHosted` double. The sale-chaining orchestration stays app-level (deferred) and is proven by a wiring capstone, exactly as Slice A did.

**Tech Stack:** TypeScript, pnpm workspace, `stripe` SDK v22, Drizzle ORM, Vitest, PGlite + Testcontainers (real Postgres), `@waitron/payments` (neutral store + async interface), `@waitron/core` (recordSale, dev-dep in tests).

## Global Constraints

- **`@waitron/payments-stripe` is the VENDOR package** — English, Stripe vocabulary **allowed** (it is in NEITHER `GENERIC_PACKAGES` nor `EXEMPT_PACKAGES`, so `english-only`/`no-provider-vocabulary` never scan it). Do NOT add it to either list. The neutral-vocabulary ban applies only to `@waitron/payments`.
- **Provider id is `"stripe"`** — shared with 2a/2b (one settlement identity). Declare `const PROVIDER = "stripe"`.
- **Currency is hardcoded `"eur"`** at the adapter boundary (`const CURRENCY = "eur"`) — single-currency-per-tenant; revisit at multi-currency. Consistent with `StripeTerminalProvider`.
- **`verifyAndParse` is SYNCHRONOUS** — `verifyAndParse(payload: string, signature: string): InboundSettlement | null` (signature verification is local crypto, not a network call). It must NOT return a Promise.
- **The `db` handle in provider options must be TENANT-SCOPED** (sets `app.tenant_id`) — `initiate` opens its own transaction and relies on RLS scoping from that handle. Copy the doc-comment shape from `StripeTerminalProviderOptions.db`.
- **The real SDK binding (`stripe-hosted-client.ts`) is coverage-excluded** — add it to `packages/payments-stripe/vitest.config.ts`'s `coverage.exclude`, exactly like `stripe-client.ts`/`stripe-device-client.ts`. It is exercised ONLY by the nightly sandbox.
- **Coverage thresholds: statements ≥98 / lines ≥98 / functions ≥98 / branches ≥95.** `src/testing/**`, `src/index.ts`, `src/**/*.sandbox.test.ts`, and the three real SDK bindings are excluded. One task owns the `test:coverage` run.
- **`FakeStripeHosted` lives under `src/testing/` and is NOT barrel-exported** — a production import must not reach a test double (like `FakeStripe`/`FakeStripeDevice`).
- **`format:check` (prettier) is a SEPARATE gate from `lint` (eslint)** — run prettier before committing.
- **The nightly sandbox reads `process.env.STRIPE_SECRET_KEY`** and self-skips when absent (`describe.skip`). The `.github/workflows/stripe-sandbox.yml` maps `STRIPE_SANDBOX_SECRET_KEY` → `STRIPE_SECRET_KEY` and runs `test:sandbox` (which globs `*.sandbox.test.ts`), so a new `*.sandbox.test.ts` auto-joins — **no workflow edit needed** (verify the glob during Task 4).

---

## File Structure

- **Create `src/hosted-client.ts`** — the `StripeHostedClient` seam interface + the `ParsedHostedEvent` return type. Narrow: only the two calls the provider makes. Mirrors `device-client.ts`.
- **Create `src/hosted-provider.ts`** — `StripeHostedProvider implements AsyncPaymentProvider` + `StripeHostedProviderOptions`. The covered adapter logic (`initiate`, `verifyAndParse`).
- **Create `src/stripe-hosted-client.ts`** — the real `StripeHostedClient` wrapping the `stripe` SDK (`checkout.sessions.create`, `webhooks.constructEvent`). Coverage-excluded.
- **Create `src/testing/fake-stripe-hosted.ts`** — deterministic `FakeStripeHosted` double + a static `event(...)` payload builder. Not barrel-exported.
- **Modify `src/client.ts`** — add `fromMinorUnits` (the inverse of `toMinorUnits`).
- **Modify `src/index.ts`** — export the seam type, the real binding factory, the provider + its options.
- **Modify `vitest.config.ts`** — add `src/stripe-hosted-client.ts` to `coverage.exclude`.
- **Create `src/hosted-provider.test.ts`** — hermetic unit tests (FakeStripeHosted): initiate writes an `initiated` row; verifyAndParse settled/expired/unknown→null/bad-sig→throws.
- **Create `src/hosted.wiring.test.ts`** — the capstone: initiate → verifyAndParse → resolveTenant → withTenant{ settleInitiated + recordSale + associate }.
- **Create `src/hosted.rls.test.ts`** — real-PG: `initiate` persists under a genuine non-superuser role; the untenanted `resolvePaymentTenant` crosses to it.
- **Create `src/checkout.sandbox.test.ts`** — nightly: a real test-mode `checkout.sessions.create`.
- **Modify `src/client.test.ts`** — add `fromMinorUnits` round-trip tests.

---

## Task 1: `fromMinorUnits` + the `StripeHostedClient` seam + `FakeStripeHosted`

**Files:**
- Modify: `packages/payments-stripe/src/client.ts`
- Create: `packages/payments-stripe/src/hosted-client.ts`
- Create: `packages/payments-stripe/src/testing/fake-stripe-hosted.ts`
- Test: `packages/payments-stripe/src/client.test.ts` (modify), `packages/payments-stripe/src/testing/fake-stripe-hosted.test.ts` (create)

**Interfaces:**
- Consumes: `toMinorUnits`, `Decimal`, `decimal`, `toScale` from existing code; `Decimal` from `@waitron/shared`.
- Produces:
  - `fromMinorUnits(minor: number): Decimal` (in `client.ts`)
  - `interface ParsedHostedEvent { type: string; sessionId: string; amountTotalMinor: number | null; createdAt: Date }` (in `hosted-client.ts`)
  - `interface StripeHostedClient { createCheckoutSession(params: { amount: Decimal; currency: string; idempotencyKey: string }): Promise<{ id: string; url: string }>; constructWebhookEvent(payload: string, signature: string): ParsedHostedEvent }` (in `hosted-client.ts`)
  - `class FakeStripeHosted implements StripeHostedClient` with static `FakeStripeHosted.event(e: { sessionId: string; type: string; amountTotalMinor?: number | null; createdAt?: Date }): string` and instance `failSignatureNext(): void` (in `testing/fake-stripe-hosted.ts`)

- [ ] **Step 1: Write the failing `fromMinorUnits` test**

Add to `packages/payments-stripe/src/client.test.ts` (append inside the existing file; it already imports `decimal` and asserts `toMinorUnits`):

```typescript
import { fromMinorUnits, toMinorUnits } from "./client.js";

describe("fromMinorUnits", () => {
  it("converts integer minor units to an exact scale-2 Decimal", () => {
    expect(fromMinorUnits(1210)).toBe("12.10");
    expect(fromMinorUnits(5)).toBe("0.05");
    expect(fromMinorUnits(0)).toBe("0.00");
    expect(fromMinorUnits(100000)).toBe("1000.00");
  });

  it("round-trips with toMinorUnits", () => {
    for (const s of ["0.00", "0.05", "12.10", "1000.00", "9999999999.99"]) {
      expect(fromMinorUnits(toMinorUnits(decimal(s)))).toBe(s);
    }
  });
});
```

*(If `client.test.ts` does not already import `decimal`/`describe`/`expect`/`it`, add them: `import { describe, expect, it } from "vitest";` and `import { decimal } from "@waitron/shared";`.)*

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/payments-stripe test client.test.ts`
Expected: FAIL — `fromMinorUnits` is not exported.

- [ ] **Step 3: Implement `fromMinorUnits` in `client.ts`**

Append to `packages/payments-stripe/src/client.ts`:

```typescript
import { decimal } from "@waitron/shared";

/** Exact minor→major conversion — the inverse of `toMinorUnits`. Stripe reports settled amounts as
 * integer minor units (`amount_total`, cents); this rebuilds the exact scale-2 `Decimal` for the
 * neutral `InboundSettlement`. Integer arithmetic only (never a float): the string is built from the
 * absolute integer, split at the last two digits. */
export function fromMinorUnits(minor: number): Decimal {
  const cents = Math.trunc(Math.abs(minor));
  const s = String(cents).padStart(3, "0");
  const whole = s.slice(0, -2);
  const frac = s.slice(-2);
  return decimal(`${minor < 0 ? "-" : ""}${whole}.${frac}`);
}
```

*(Note: `client.ts` currently imports only `toScale` and `type Decimal` from `@waitron/shared`; add `decimal` to the value import.)*

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @waitron/payments-stripe test client.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the `StripeHostedClient` seam**

Create `packages/payments-stripe/src/hosted-client.ts`:

```typescript
import type { Decimal } from "@waitron/shared";

/** One inbound Stripe webhook event, parsed into the narrow shape `StripeHostedProvider.verifyAndParse`
 * needs — so the provider's mapping logic is hermetic (no `stripe` types leak into it). `type` is the
 * Stripe event type (e.g. `"checkout.session.completed"`); `sessionId` is the Checkout Session id
 * (`event.data.object.id`, our `external_ref`); `amountTotalMinor` is `amount_total` (cents), null when
 * the event carries none; `createdAt` is `event.created` as a Date. */
export interface ParsedHostedEvent {
  type: string;
  sessionId: string;
  amountTotalMinor: number | null;
  createdAt: Date;
}

/** The narrow hosted-checkout Stripe surface `StripeHostedProvider` depends on — the two calls it
 * makes, not the SDK. The real impl (`./stripe-hosted-client.ts`) wraps `stripe.checkout.sessions
 * .create` + `stripe.webhooks.constructEvent` and is coverage-excluded; `FakeStripeHosted`
 * (`./testing/`) models it deterministically. Amounts cross as exact `Decimal`. Separate from
 * `StripeClient`/`StripeDeviceClient` (each provider names only the calls it uses). */
export interface StripeHostedClient {
  /** Mint a hosted Checkout Session for one working order. Returns the session id (our `external_ref`)
   * and the hosted-page url. `idempotencyKey` (the caller's `payment_ref`) makes a retried initiate
   * return the SAME session rather than a duplicate. */
  createCheckoutSession(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ id: string; url: string }>;
  /** Verify the webhook signature (THROWS on a bad signature) and return the parsed event. Synchronous:
   * signature verification is local HMAC, not a network call. */
  constructWebhookEvent(payload: string, signature: string): ParsedHostedEvent;
}
```

- [ ] **Step 6: Create `FakeStripeHosted` with a failing test**

Create `packages/payments-stripe/src/testing/fake-stripe-hosted.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { FakeStripeHosted } from "./fake-stripe-hosted.js";

describe("FakeStripeHosted", () => {
  it("createCheckoutSession returns a cs_ id and a url", async () => {
    const client = new FakeStripeHosted();
    const s = await client.createCheckoutSession({
      amount: decimal("12.10"),
      currency: "eur",
      idempotencyKey: "pay-1",
    });
    expect(s.id).toMatch(/^cs_/);
    expect(s.url).toContain(s.id);
  });

  it("constructWebhookEvent parses an event() payload", () => {
    const payload = FakeStripeHosted.event({
      sessionId: "cs_abc",
      type: "checkout.session.completed",
      amountTotalMinor: 1210,
      createdAt: new Date("2026-03-01T13:05:00Z"),
    });
    const e = new FakeStripeHosted().constructWebhookEvent(payload, "good");
    expect(e.type).toBe("checkout.session.completed");
    expect(e.sessionId).toBe("cs_abc");
    expect(e.amountTotalMinor).toBe(1210);
    expect(e.createdAt.toISOString()).toBe("2026-03-01T13:05:00.000Z");
  });

  it("constructWebhookEvent throws on a bad signature when failSignatureNext is armed", () => {
    const client = new FakeStripeHosted();
    client.failSignatureNext();
    const payload = FakeStripeHosted.event({ sessionId: "cs_x", type: "checkout.session.completed" });
    expect(() => client.constructWebhookEvent(payload, "bad")).toThrow(/signature/i);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @waitron/payments-stripe test fake-stripe-hosted.test.ts`
Expected: FAIL — `FakeStripeHosted` does not exist.

- [ ] **Step 8: Implement `FakeStripeHosted`**

Create `packages/payments-stripe/src/testing/fake-stripe-hosted.ts`:

```typescript
import type { Decimal } from "@waitron/shared";
import type { ParsedHostedEvent, StripeHostedClient } from "../hosted-client.js";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${String(++seq).padStart(8, "0")}`;

/** A deterministic in-memory `StripeHostedClient` — the hermetic double for the hosted-checkout
 * adapter. NOT barrel-exported (a production import cannot reach it), like `FakeStripe`/
 * `FakeStripeDevice`. `createCheckoutSession` mints a `cs_` id + a url containing it. `constructWebhook
 * Event` trusts the payload (JSON built by the static `event()` helper) rather than verifying a real
 * signature; `failSignatureNext()` makes the next call throw, modelling a bad signature. */
export class FakeStripeHosted implements StripeHostedClient {
  private nextSigFails = false;

  /** Build the JSON payload a `constructWebhookEvent` call decodes — the fake's analogue of a raw
   * Stripe webhook body. `amountTotalMinor` defaults to null, `createdAt` to the epoch. */
  static event(e: {
    sessionId: string;
    type: string;
    amountTotalMinor?: number | null;
    createdAt?: Date;
  }): string {
    return JSON.stringify({
      type: e.type,
      sessionId: e.sessionId,
      amountTotalMinor: e.amountTotalMinor ?? null,
      createdAt: (e.createdAt ?? new Date(0)).toISOString(),
    });
  }

  /** Arm the next `constructWebhookEvent` to throw (a bad-signature simulation). One-shot. */
  failSignatureNext(): void {
    this.nextSigFails = true;
  }

  // `params` is part of the public contract (the real adapter needs amount/currency/idempotencyKey);
  // this fake only mints a deterministic id. Underscore-prefixed so tsc's noUnusedParameters leaves it
  // alone; the eslint-disable matches the FakeStripe/FakeStripeDevice convention in this package.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
  createCheckoutSession(_params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ id: string; url: string }> {
    const id = nextId("cs");
    return Promise.resolve({ id, url: `https://checkout.stripe.test/${id}` });
  }

  // `signature` is part of the public contract (the real impl verifies it); this fake only uses it to
  // decide whether to simulate a failure via `failSignatureNext`.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see comment above
  constructWebhookEvent(payload: string, _signature: string): ParsedHostedEvent {
    if (this.nextSigFails) {
      this.nextSigFails = false;
      throw new Error("fake: invalid webhook signature");
    }
    const raw = JSON.parse(payload) as {
      type: string;
      sessionId: string;
      amountTotalMinor: number | null;
      createdAt: string;
    };
    return {
      type: raw.type,
      sessionId: raw.sessionId,
      amountTotalMinor: raw.amountTotalMinor,
      createdAt: new Date(raw.createdAt),
    };
  }
}
```

- [ ] **Step 9: Export the seam type from the barrel**

In `packages/payments-stripe/src/index.ts`, add (keep the fake OUT):

```typescript
export type { StripeHostedClient, ParsedHostedEvent } from "./hosted-client.js";
export { fromMinorUnits } from "./client.js";
```

- [ ] **Step 10: Run the fake test + typecheck**

Run: `pnpm --filter @waitron/payments-stripe test fake-stripe-hosted.test.ts && pnpm --filter @waitron/payments-stripe typecheck`
Expected: PASS, no type errors.

- [ ] **Step 11: Commit**

```bash
cd /Users/<user>/workspace/repos/waitron
pnpm --filter @waitron/payments-stripe exec prettier --write src/client.ts src/client.test.ts src/hosted-client.ts src/testing/fake-stripe-hosted.ts src/testing/fake-stripe-hosted.test.ts src/index.ts
git add packages/payments-stripe/src/client.ts packages/payments-stripe/src/client.test.ts packages/payments-stripe/src/hosted-client.ts packages/payments-stripe/src/testing/fake-stripe-hosted.ts packages/payments-stripe/src/testing/fake-stripe-hosted.test.ts packages/payments-stripe/src/index.ts
git commit -m "feat(payments-stripe): Mode 3 Slice B — fromMinorUnits + StripeHostedClient seam + FakeStripeHosted"
```

---

## Task 2: `StripeHostedProvider` (initiate + verifyAndParse)

**Files:**
- Create: `packages/payments-stripe/src/hosted-provider.ts`
- Modify: `packages/payments-stripe/src/index.ts`
- Test: `packages/payments-stripe/src/hosted-provider.test.ts`

**Interfaces:**
- Consumes: `StripeHostedClient`, `ParsedHostedEvent` (Task 1); `fromMinorUnits` (Task 1); `FakeStripeHosted` (Task 1); `insertInitiated`, `getPaymentByRef` from `@waitron/payments`; `AsyncPaymentProvider`, `InitiateParams`, `InitiateResult`, `InboundSettlement` from `@waitron/payments`; `Database` from `@waitron/db`; `Decimal` from `@waitron/shared`.
- Produces:
  - `interface StripeHostedProviderOptions { client: StripeHostedClient; db: Database }`
  - `class StripeHostedProvider implements AsyncPaymentProvider` — `provider = "stripe"`, `initiate`, `verifyAndParse`.

- [ ] **Step 1: Write the failing provider test**

Create `packages/payments-stripe/src/hosted-provider.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  tenantId as brandTenantId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, getPaymentByRef } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import type { Seeded } from "@waitron/payments/test/seed.js";
import { FakeStripeHosted } from "./testing/fake-stripe-hosted.js";
import { StripeHostedProvider } from "./hosted-provider.js";

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

async function seed(): Promise<Seeded> {
  return seedWorkingOrder(db, freshNif());
}

describe("StripeHostedProvider.initiate", () => {
  it("mints a session and writes an initiated row with external_ref = session id", async () => {
    const s = await seed();
    const provider = new StripeHostedProvider({ client: new FakeStripeHosted(), db });
    const paymentRef = randomUUID();

    const res = await provider.initiate({
      tenantId: brandTenantId(s.tenantId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef,
    });

    expect(res.ref).toBe(paymentRef);
    expect(res.externalRef).toMatch(/^cs_/);
    expect(res.url).toContain(res.externalRef);

    const row = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef }),
    );
    expect(row?.state).toBe("initiated");
    expect(row?.externalRef).toBe(res.externalRef);
    expect(row?.settledAt).toBeNull();
    expect(row?.saleId).toBeNull();
  });
});

describe("StripeHostedProvider.verifyAndParse", () => {
  const provider = () => new StripeHostedProvider({ client: new FakeStripeHosted(), db });

  it("maps checkout.session.completed to a settled InboundSettlement", () => {
    const payload = FakeStripeHosted.event({
      sessionId: "cs_123",
      type: "checkout.session.completed",
      amountTotalMinor: 1210,
      createdAt: new Date("2026-03-01T13:05:00Z"),
    });
    const ev = provider().verifyAndParse(payload, "good");
    expect(ev).toEqual({
      provider: "stripe",
      externalRef: "cs_123",
      outcome: "settled",
      amount: "12.10",
      settledAt: new Date("2026-03-01T13:05:00Z"),
    });
  });

  it("maps checkout.session.expired to an expired InboundSettlement", () => {
    const payload = FakeStripeHosted.event({ sessionId: "cs_9", type: "checkout.session.expired" });
    const ev = provider().verifyAndParse(payload, "good");
    expect(ev?.outcome).toBe("expired");
    expect(ev?.externalRef).toBe("cs_9");
  });

  it("returns null for an event we do not act on", () => {
    const payload = FakeStripeHosted.event({ sessionId: "cs_9", type: "payment_intent.created" });
    expect(provider().verifyAndParse(payload, "good")).toBeNull();
  });

  it("throws on a bad signature (does not swallow it)", () => {
    const client = new FakeStripeHosted();
    client.failSignatureNext();
    const p = new StripeHostedProvider({ client, db });
    const payload = FakeStripeHosted.event({ sessionId: "cs_9", type: "checkout.session.completed" });
    expect(() => p.verifyAndParse(payload, "bad")).toThrow(/signature/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/payments-stripe test hosted-provider.test.ts`
Expected: FAIL — `StripeHostedProvider` does not exist.

- [ ] **Step 3: Implement `StripeHostedProvider`**

Create `packages/payments-stripe/src/hosted-provider.ts`:

```typescript
import type { Database } from "@waitron/db";
import type {
  AsyncPaymentProvider,
  InboundSettlement,
  InitiateParams,
  InitiateResult,
} from "@waitron/payments";
import { insertInitiated } from "@waitron/payments";
import type { StripeHostedClient } from "./hosted-client.js";
import { fromMinorUnits } from "./client.js";

const PROVIDER = "stripe";
const CURRENCY = "eur";

export interface StripeHostedProviderOptions {
  client: StripeHostedClient;
  /** Must be a TENANT-SCOPED `Database` handle (one that sets `app.tenant_id`): `initiate` opens its
   * own transaction to write the `initiated` row and relies on RLS scoping from this handle. The
   * inbound webhook path is untenanted and resolves its tenant separately (Slice A's
   * `resolvePaymentTenant`), so it does NOT use this handle — see the wiring test. */
  db: Database;
}

/** The real Stripe **Checkout** `AsyncPaymentProvider` (Mode 3, hosted/out-of-band). `initiate` mints a
 * Checkout Session (network) then writes an `initiated` `payments` row with `external_ref = session.id`
 * — the id the later `checkout.session.completed` webhook carries. A crash between the network call and
 * the write leaves an orphaned session (no local row), which `reconcile` backstops (deferred). The
 * webhook itself is handled by `verifyAndParse` (signature-verified, mapped to the neutral
 * `InboundSettlement`); the settle→recordSale→associate chaining is the app-level orchestrator's job
 * (deferred), proven here by the wiring capstone. Reversals of a hosted payment are out of scope for
 * this slice (the `external_ref` is the session id, not the PaymentIntent id). */
export class StripeHostedProvider implements AsyncPaymentProvider {
  readonly provider = PROVIDER;

  constructor(private readonly opts: StripeHostedProviderOptions) {}

  async initiate(params: InitiateParams): Promise<InitiateResult> {
    // Network first — the session id is only known after creation, and it IS our external_ref.
    // idempotencyKey = the caller's payment_ref, so a retried initiate returns the same session.
    const session = await this.opts.client.createCheckoutSession({
      amount: params.amount,
      currency: CURRENCY,
      idempotencyKey: params.paymentRef,
    });
    // Persist the initiated row (tenant-scoped via the injected db handle). The (tenant, provider,
    // payment_ref) unique makes a retried initiate a no-op-or-throw, and external_ref = session.id
    // is the webhook resolve/settle key.
    await this.opts.db.transaction((tx) =>
      insertInitiated(tx, {
        tenantId: params.tenantId,
        workingOrderId: params.workingOrderId,
        provider: PROVIDER,
        paymentRef: params.paymentRef,
        externalRef: session.id,
        amount: params.amount,
      }),
    );
    return { ref: params.paymentRef, externalRef: session.id, url: session.url };
  }

  verifyAndParse(payload: string, signature: string): InboundSettlement | null {
    // Throws on a bad signature — deliberately not swallowed (the caller returns a 4xx).
    const event = this.opts.client.constructWebhookEvent(payload, signature);
    const outcome =
      event.type === "checkout.session.completed"
        ? "settled"
        : event.type === "checkout.session.expired"
          ? "expired"
          : null;
    if (outcome === null) return null;
    return {
      provider: PROVIDER,
      externalRef: event.sessionId,
      outcome,
      amount: fromMinorUnits(event.amountTotalMinor ?? 0),
      settledAt: event.createdAt,
    };
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @waitron/payments-stripe test hosted-provider.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Export the provider from the barrel**

In `packages/payments-stripe/src/index.ts`, add:

```typescript
export { StripeHostedProvider } from "./hosted-provider.js";
export type { StripeHostedProviderOptions } from "./hosted-provider.js";
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @waitron/payments-stripe typecheck`
Expected: clean.

```bash
cd /Users/<user>/workspace/repos/waitron
pnpm --filter @waitron/payments-stripe exec prettier --write src/hosted-provider.ts src/hosted-provider.test.ts src/index.ts
git add packages/payments-stripe/src/hosted-provider.ts packages/payments-stripe/src/hosted-provider.test.ts packages/payments-stripe/src/index.ts
git commit -m "feat(payments-stripe): Mode 3 Slice B — StripeHostedProvider (initiate + verifyAndParse)"
```

---

## Task 3: the wiring capstone (initiate → webhook → settle → recordSale → associate)

**Files:**
- Test: `packages/payments-stripe/src/hosted.wiring.test.ts`

**Interfaces:**
- Consumes: `StripeHostedProvider`, `FakeStripeHosted` (Tasks 1-2); `resolvePaymentTenant`, `settleInitiated`, `associatePaymentWithSale`, `getPaymentByRef`, `PAYMENTS_MIGRATIONS` from `@waitron/payments`; `recordSale`, `RecordSaleInput` from `@waitron/core`; `FakeFiscalBackend`, `TrustedClock` from `@waitron/fiscal`; `withTenant` from `@waitron/db`; `seedForSale`, `freshNif`, `SeededForSale` from `@waitron/payments/test/seed.js`.
- Produces: nothing (test only).

- [ ] **Step 1: Write the capstone test**

Create `packages/payments-stripe/src/hosted.wiring.test.ts`. This mirrors `packages/payments/src/async.wiring.test.ts` but drives it through the real `StripeHostedProvider`, and mirrors this package's own `wiring.test.ts` for the `steadyClock`/`buildInput`/seed shape (both reproduced locally — house convention):

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import type { TrustedClock } from "@waitron/fiscal";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import {
  PAYMENTS_MIGRATIONS,
  associatePaymentWithSale,
  getPaymentByRef,
  resolvePaymentTenant,
  settleInitiated,
} from "@waitron/payments";
import { freshNif, seedForSale } from "@waitron/payments/test/seed.js";
import type { SeededForSale } from "@waitron/payments/test/seed.js";
import { FakeStripeHosted } from "./testing/fake-stripe-hosted.js";
import { StripeHostedProvider } from "./hosted-provider.js";

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

function buildInput(s: SeededForSale, tender: { amount: string; settledAt: Date | null }): RecordSaleInput {
  return {
    tenantId: brandTenantId(s.tenantId),
    tillId: brandTillId(s.tillId),
    seriesId: brandSeriesId(s.seriesId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    locale: "es",
    invoiceLocales: ["es"],
    total: "12.10",
    tipAmount: "0.00",
    lines: [
      { lineNo: 1, descriptions: { es: "Item" }, quantity: "1", unitPrice: "10.00", vatRate: "21.00", lineTotal: "10.00" },
    ],
    tenders: [{ method: "card", amount: tender.amount, settledAt: tender.settledAt }],
    fiscalBackend: "fake",
    clock: steadyClock,
  };
}

describe("stripe hosted: initiate -> webhook -> settle -> recordSale -> associate (end to end)", () => {
  it("initiates, settles from the completed webhook, chains the sale, and associates the payment", async () => {
    const backend = new FakeFiscalBackend(db);
    const s = await seedForSale(db, backend, freshNif());
    const provider = new StripeHostedProvider({ client: new FakeStripeHosted(), db });
    const paymentRef = randomUUID();

    // 1. initiate — mints the session, writes the initiated row (working order stays open).
    const init = await provider.initiate({
      tenantId: brandTenantId(s.tenantId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef,
    });

    // 2. The inbound webhook arrives (verified + parsed to the neutral event).
    const payload = FakeStripeHosted.event({
      sessionId: init.externalRef,
      type: "checkout.session.completed",
      amountTotalMinor: 1210,
      createdAt: BASE,
    });
    const event = provider.verifyAndParse(payload, "good");
    expect(event?.outcome).toBe("settled");

    // 3. The (deferred) app-level orchestrator: resolve the tenant untenanted, then settle + chain +
    //    associate in one tenant-scoped transaction.
    const tenantId = await resolvePaymentTenant(db, event!.provider, event!.externalRef);
    expect(tenantId).toBe(s.tenantId);

    const saleId = await withTenant(db, tenantId!, async (tx) => {
      const row = await settleInitiated(tx, {
        provider: event!.provider,
        externalRef: event!.externalRef,
        settledAt: event!.settledAt,
      });
      expect(row).not.toBeNull();
      const recorded = await recordSale(tx, backend, buildInput(s, { amount: "12.10", settledAt: event!.settledAt }));
      await associatePaymentWithSale(tx, {
        tenantId: tenantId!,
        provider: "stripe",
        paymentRef,
        saleId: recorded.saleId,
      });
      return recorded.saleId;
    });

    // 4. After commit: the payment is captured, associated, and still carries the session external_ref.
    const finalRow = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef }),
    );
    expect(finalRow?.state).toBe("captured");
    expect(finalRow?.saleId).toBe(saleId);
    expect(finalRow?.externalRef).toBe(init.externalRef);
  });
});
```

- [ ] **Step 2: Run it (capstone — expected PASS on first run)**

Run: `pnpm --filter @waitron/payments-stripe test hosted.wiring.test.ts`
Expected: PASS. This is an integration test over already-implemented pieces — it should pass on the first run. If it FAILS, debug the wiring against `packages/payments/src/async.wiring.test.ts` (same orchestration shape); do NOT weaken the assertions (captured + associated + one sale).

- [ ] **Step 3: Commit**

```bash
cd /Users/<user>/workspace/repos/waitron
pnpm --filter @waitron/payments-stripe exec prettier --write src/hosted.wiring.test.ts
git add packages/payments-stripe/src/hosted.wiring.test.ts
git commit -m "test(payments-stripe): Mode 3 Slice B — hosted capstone (initiate -> webhook -> settle -> recordSale -> associate)"
```

---

## Task 4: the real `stripeHostedClient` binding + nightly sandbox

**Files:**
- Create: `packages/payments-stripe/src/stripe-hosted-client.ts`
- Modify: `packages/payments-stripe/src/index.ts`, `packages/payments-stripe/vitest.config.ts`
- Test: `packages/payments-stripe/src/checkout.sandbox.test.ts`

**Interfaces:**
- Consumes: `StripeHostedClient`, `ParsedHostedEvent` (Task 1); `toMinorUnits` (existing `client.ts`); `Stripe` (the `stripe` SDK); `StripeHostedProvider` (Task 2) in the sandbox test.
- Produces: `stripeHostedClient(stripe: Stripe, config: { successUrl: string; cancelUrl: string; webhookSecret: string }): StripeHostedClient`.

- [ ] **Step 1: Implement the real binding (coverage-excluded — no hermetic test)**

Create `packages/payments-stripe/src/stripe-hosted-client.ts`:

```typescript
import type Stripe from "stripe";
import { toMinorUnits } from "./client.js";
import type { ParsedHostedEvent, StripeHostedClient } from "./hosted-client.js";

/** The real `StripeHostedClient`, wrapping the `stripe` SDK's Checkout + webhooks API. Coverage-excluded
 * (see vitest.config.ts): a thin call-mapping boundary whose logic is the SDK's. `createCheckoutSession`
 * is exercised by the nightly sandbox (real test-mode); `constructWebhookEvent` verifies a real
 * signature (proven by the hermetic run through `FakeStripeHosted`, never this file).
 *
 * `config` is deployment-injected (SP7/SP9): `successUrl`/`cancelUrl` are where the hosted page returns
 * the customer, and `webhookSecret` is the endpoint's signing secret. Provisioning them is out of scope
 * here, exactly as reader provisioning and per-tenant keys were throughout 2a/2b. */
export function stripeHostedClient(
  stripe: Stripe,
  config: { successUrl: string; cancelUrl: string; webhookSecret: string },
): StripeHostedClient {
  return {
    async createCheckoutSession({ amount, currency, idempotencyKey }) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          success_url: config.successUrl,
          cancel_url: config.cancelUrl,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: toMinorUnits(amount),
                product_data: { name: "Order" },
              },
            },
          ],
        },
        { idempotencyKey },
      );
      if (session.url === null) {
        // A `mode: "payment"` session always has a hosted url; guard defensively so the caller never
        // gets a null url masquerading as a valid one.
        throw new Error("stripe: checkout session has no url");
      }
      return { id: session.id, url: session.url };
    },
    constructWebhookEvent(payload, signature): ParsedHostedEvent {
      const event = stripe.webhooks.constructEvent(payload, signature, config.webhookSecret);
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        type: event.type,
        sessionId: session.id,
        amountTotalMinor: session.amount_total,
        createdAt: new Date(event.created * 1000),
      };
    },
  };
}
```

- [ ] **Step 2: Coverage-exclude the real binding**

In `packages/payments-stripe/vitest.config.ts`, add `"src/stripe-hosted-client.ts",` to the `coverage.exclude` array, right after the `"src/stripe-device-client.ts",` line, with a matching comment:

```typescript
        // The real Checkout/webhooks SDK boundary — createCheckoutSession exercised only by the
        // nightly sandbox; constructWebhookEvent's mapping is proven through FakeStripeHosted.
        "src/stripe-hosted-client.ts",
```

- [ ] **Step 3: Export the binding from the barrel**

In `packages/payments-stripe/src/index.ts`, add:

```typescript
export { stripeHostedClient } from "./stripe-hosted-client.js";
```

- [ ] **Step 4: Write the nightly sandbox test**

Create `packages/payments-stripe/src/checkout.sandbox.test.ts` (self-skips without `STRIPE_SECRET_KEY`, matching `collect.sandbox.test.ts`):

```typescript
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  tenantId as brandTenantId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { PAYMENTS_MIGRATIONS, getPaymentByRef } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { stripeHostedClient } from "./stripe-hosted-client.js";
import { StripeHostedProvider } from "./hosted-provider.js";

// Nightly-only suite (.github/workflows/stripe-sandbox.yml). Creates a REAL Stripe test-mode Checkout
// Session — the one place this package's coverage touches the actual Checkout SDK boundary rather than
// FakeStripeHosted. `stripe-hosted-client.ts` is coverage-excluded precisely because this suite is its
// only exerciser. Self-skips with no STRIPE_SECRET_KEY (deliberate — real-API fidelity on a cadence,
// not correctness the PR gate depends on; the hermetic run already proves the provider's logic).
const KEY = process.env.STRIPE_SECRET_KEY;
const d = KEY ? describe : describe.skip;

d("Stripe test-mode sandbox: hosted Checkout Session", () => {
  let db: Database;

  beforeAll(async () => {
    db = await createPgliteDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, PAYMENTS_MIGRATIONS);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("creates a real test-mode Checkout Session and writes an initiated row", async () => {
    const s = await seedWorkingOrder(db, freshNif());
    const provider = new StripeHostedProvider({
      client: stripeHostedClient(new Stripe(KEY!), {
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/cancel",
        webhookSecret: "whsec_unused_here",
      }),
      db,
    });
    const paymentRef = randomUUID();

    const res = await provider.initiate({
      tenantId: brandTenantId(s.tenantId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("12.10"),
      paymentRef,
    });

    expect(res.externalRef).toMatch(/^cs_/);
    expect(res.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const row = await db.transaction((tx) =>
      getPaymentByRef(tx, { tenantId: s.tenantId, provider: "stripe", paymentRef }),
    );
    expect(row?.state).toBe("initiated");
    expect(row?.externalRef).toBe(res.externalRef);
  });
});
```

- [ ] **Step 5: Confirm the sandbox test is picked up by the sandbox config, excluded from the hermetic run, and typechecks**

Run: `pnpm --filter @waitron/payments-stripe test 2>&1 | tail -5` — the hermetic run must NOT execute `checkout.sandbox.test.ts` (it matches the `src/**/*.sandbox.test.ts` exclude in `vitest.config.ts`).
Run: `pnpm --filter @waitron/payments-stripe typecheck`
Expected: hermetic run green and excludes the sandbox test; typecheck clean. **No workflow/config change needed:** `vitest.sandbox.config.ts` already uses `include: ["src/**/*.sandbox.test.ts"]` (a glob) and `.github/workflows/stripe-sandbox.yml` maps `STRIPE_SANDBOX_SECRET_KEY` → `STRIPE_SECRET_KEY`, so `checkout.sandbox.test.ts` auto-joins the nightly run.

- [ ] **Step 6: Commit**

```bash
cd /Users/<user>/workspace/repos/waitron
pnpm --filter @waitron/payments-stripe exec prettier --write src/stripe-hosted-client.ts src/checkout.sandbox.test.ts src/index.ts vitest.config.ts
git add packages/payments-stripe/src/stripe-hosted-client.ts packages/payments-stripe/src/checkout.sandbox.test.ts packages/payments-stripe/src/index.ts packages/payments-stripe/vitest.config.ts
git commit -m "feat(payments-stripe): Mode 3 Slice B — real stripeHostedClient binding + nightly checkout sandbox"
```

---

## Task 5: real-PG RLS test + coverage close-out + repo-wide gates

**Files:**
- Test: `packages/payments-stripe/src/hosted.rls.test.ts`

**Interfaces:**
- Consumes: `StripeHostedProvider`, `FakeStripeHosted` (Tasks 1-2); `resolvePaymentTenant`, `getPaymentByRef`, `PAYMENTS_MIGRATIONS` from `@waitron/payments`; `withTenant` from `@waitron/db`; `startRealPostgres` from `./testing/postgres.js`; `seedWorkingOrder`, `freshNif` from `@waitron/payments/test/seed.js`.
- Produces: nothing (test only).

- [ ] **Step 1: Read the existing real-PG harness for this package**

Read `packages/payments-stripe/src/testing/postgres.ts` and `packages/payments-stripe/src/stripe.rls.test.ts` to reuse the exact `startRealPostgres` / `connectAs(PROBE_ROLE, PROBE_PASSWORD)` shape (a non-superuser LOGIN role `in role app_user`). This suite THROWS rather than skips when Docker is absent — do not weaken that.

- [ ] **Step 2: Write the real-PG RLS test**

Create `packages/payments-stripe/src/hosted.rls.test.ts`. **Follow `stripe.rls.test.ts`'s pattern exactly:** `initiate` opens its OWN transaction on `this.opts.db`, so — as that file documents at lines 40-46 — it CANNOT have `app.tenant_id` set on it from outside. So this suite does NOT call `provider.initiate`; it exercises the SAME store call `initiate` makes (`insertInitiated`) directly under `withTenant(probe, …)`, proving (a) the tenant-isolation policy holds for an `initiated` `stripe` row under a real non-superuser role, and (b) the untenanted `resolvePaymentTenant` seam crosses to it by `(provider, session id)` with NO GUC set — the genuine inbound-webhook case:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { getPaymentByRef, insertInitiated, resolvePaymentTenant } from "@waitron/payments";
import { seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";

const PROBE_ROLE = "rls_probe_hosted";
const PROBE_PASSWORD = "probe";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  // `execute(string)` runs verbatim (drizzle wraps a plain string in sql.raw internally), so this
  // needs no drizzle-orm import — payments-stripe does not depend on it. Mirrors stripe.rls.test.ts.
  await admin.execute(
    `create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`,
  );
}, 180_000);

afterAll(async () => {
  await admin.close();
  await pg.stop();
});

describe("hosted initiated rows under real row-level security", () => {
  it("isolates an initiated stripe row by tenant and resolves it untenanted by session id", async () => {
    const a = await seedWorkingOrder(admin, "B31111111");
    const b = await seedWorkingOrder(admin, "B32222222");
    const key = { tenantId: a.tenantId, provider: "stripe", paymentRef: "hosted-r1" };
    const sessionId = "cs_rls_hosted";

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The store call initiate makes — written as rls_probe, scoped to tenant A via withTenant.
      // `insertInitiated`'s NewPayment fields are plain strings (no branding needed here).
      await withTenant(probe, a.tenantId, (tx) =>
        insertInitiated(tx, {
          tenantId: a.tenantId,
          workingOrderId: a.workingOrderId,
          provider: "stripe",
          paymentRef: "hosted-r1",
          externalRef: sessionId,
          amount: decimal("12.10"),
        }),
      );

      // Tenant A sees it; tenant B (SAME key) does not — isolation holds under a real RLS role.
      const seen = await withTenant(probe, a.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(seen?.state).toBe("initiated");
      expect(seen?.externalRef).toBe(sessionId);
      const hidden = await withTenant(probe, b.tenantId, (tx) => getPaymentByRef(tx, key));
      expect(hidden).toBeUndefined();

      // The inbound-webhook case: resolve the tenant from (provider, session id) with NO GUC set. A
      // plain unscoped read returns nothing (isolation fails closed); the SECURITY DEFINER seam
      // crosses and returns ONLY the tenant id.
      const resolved = await resolvePaymentTenant(probe, "stripe", sessionId);
      expect(resolved).toBe(a.tenantId);
    } finally {
      await probe.close();
    }
  });
});
```

- [ ] **Step 3: Run the RLS test (requires Docker)**

Run: `pnpm --filter @waitron/payments-stripe test hosted.rls.test.ts`
Expected: PASS under a real Postgres container. If Docker is unavailable the suite THROWS (by design) — ensure Docker is running; do not skip.

- [ ] **Step 4: Coverage close-out (this task owns it)**

Run: `pnpm --filter @waitron/payments-stripe test:coverage`
Expected: all tests green; coverage statements ≥98 / lines ≥98 / functions ≥98 / branches ≥95. The new covered code is `hosted-provider.ts` (initiate + verifyAndParse) and `client.ts`'s `fromMinorUnits` — exercised by Tasks 1-3 + this task. `stripe-hosted-client.ts` (excluded), `testing/**` (excluded), `checkout.sandbox.test.ts` (excluded) do not count. If a specific line/branch is uncovered, add the missing assertion to the OWNING test — do NOT lower a threshold or add an exclusion without a documented v8-artifact reason.

- [ ] **Step 5: Repo-wide gates**

Run: `pnpm format:check` (prettier — the separate gate), `pnpm --filter @waitron/payments-stripe lint`, `pnpm --filter @waitron/payments-stripe typecheck`.
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/<user>/workspace/repos/waitron
pnpm --filter @waitron/payments-stripe exec prettier --write src/hosted.rls.test.ts
git add packages/payments-stripe/src/hosted.rls.test.ts
git commit -m "test(payments-stripe): Mode 3 Slice B — real-PG RLS test (initiate persists + untenanted resolve)"
```

---

## Design-doc update (fold into the last task's commit or its own)

- [ ] Update `docs/superpowers/specs/2026-07-22-payment-layer-design.md`'s §10 item 4: mark **Slice B landed**, mirroring how Slice A was marked. Commit with the plan's final task or as a small `docs(payments)` commit.

---

## Out of scope for Slice B (unchanged deferrals)

- The `apps/*` webhook **HTTP endpoint** + signing-secret/success-cancel-URL **provisioning** (a deployment concern; the orchestration logic is proven by the wiring capstone).
- **`reconcile()`** for the async provider (the backstop for missed/late webhooks, and the `initiate` crash window).
- **Reversals of a hosted payment** — the `external_ref` is the Checkout Session id, not the PaymentIntent id, so the existing `reverseViaStripe` path cannot address the processor without a session→PI resolution; deferred (a hosted capture is still an ordinary `captured` row for reporting/association).
- **QR-vs-link presentation** — an app/UI concern over the returned `url`.
