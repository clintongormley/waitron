import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import type { CreateCheckoutOutcome, SumUpClient } from "./client.js";
import { sumupClient } from "./sumup-client.js";
import { SumUpCloudProvider } from "./provider.js";

// Runs only on the owner's laptop with the paired Solo in reach; never in CI (no `.github`
// workflow calls `test:sandbox` for this package). It is the receipt for the runbook's experiments
// 0.6, 2a and 4a through the adapter rather than curl
// (docs/research/2026-09-10-sumup-solo-experiments.md).
const API_KEY = process.env.SUMUP_API_KEY;
const MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE;
const READER_ID = process.env.SUMUP_READER_ID;
const AFFILIATE_APP_ID = process.env.SUMUP_AFFILIATE_APP_ID;
const AFFILIATE_KEY = process.env.SUMUP_AFFILIATE_KEY;

// Self-skipping: the three required env vars come from the runbook's plug-in checklist (§7), not
// from CI secrets.
const configured = Boolean(API_KEY && MERCHANT_CODE && READER_ID);
const d = configured ? describe : describe.skip;

d("SumUp live sandbox: collect against the paired Solo", () => {
  const pg = usePgliteDb({
    migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
    timeoutMs: 120_000,
  });

  it("drives a real reader checkout to captured, then refunds it", async () => {
    const rawClient = sumupClient({
      apiKey: API_KEY!,
      merchantCode: MERCHANT_CODE!,
      ...(AFFILIATE_APP_ID && AFFILIATE_KEY
        ? { affiliate: { appId: AFFILIATE_APP_ID, key: AFFILIATE_KEY } }
        : {}),
    });

    // The adapter never exposes SumUp's `client_transaction_id` past `collect()` (only OUR
    // `payment_ref` survives to the caller) — wrap `createCheckout` just to capture it, so
    // assertion (a) below can drive the single-transaction lookup directly, the same call the
    // adapter's own poll makes.
    let clientTransactionId: string | undefined;
    const client: SumUpClient = {
      ...rawClient,
      async createCheckout(p) {
        const outcome: CreateCheckoutOutcome = await rawClient.createCheckout(p);
        if (outcome.accepted) clientTransactionId = outcome.clientTransactionId;
        return outcome;
      },
    };

    const s = await seedWorkingOrder(pg.db, freshNif());
    const provider = new SumUpCloudProvider({
      client,
      db: pg.db,
      tenantId: brandTenantId(s.tenantId),
      nodeId: "11111111-1111-4111-8111-111111111111",
      resolveReader: () => Promise.resolve(READER_ID!),
      incidents: () => Promise.resolve(true),
      // Default poll (120 attempts × 1s = 2 minutes) — the real window a tap needs, not the
      // hermetic suites' near-zero one.
    });

    console.log("TAP THE CARD NOW");
    const result = await provider.collect({
      tenantId: brandTenantId(s.tenantId),
      tillId: brandTillId(s.tillId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("1.00"),
    });

    expect(result.state).toBe("captured");
    expect(result.settledAt).not.toBeNull();

    // (a) `findTransaction` used the single-retrieve endpoint (`GET /v2.1/.../transactions?
    // client_transaction_id=`), NOT `/transactions/history`'s `{items: […]}` list shape. A
    // wrong endpoint shape here would either 404 (findTransaction would have thrown, failing the
    // collect above) or hand back a list whose top-level `id`/`status`/`amount` are undefined —
    // assert them present and correctly typed on a direct call with the same query the adapter's
    // poll used.
    expect(clientTransactionId).toBeDefined();
    const found = await rawClient.findTransaction({
      clientTransactionId: clientTransactionId!,
    });
    expect(found).not.toBeNull();
    expect(typeof found!.id).toBe("string");
    expect(found!.status).toBe("SUCCESSFUL");
    expect(found!.amount).toEqual(decimal("1.00"));

    // (b) The refund round-trips through the exact `id` findTransaction returned above —
    // `reverseViaSumUp` addresses the refund endpoint by `payments.externalRef`, which
    // `captureAttempting` stamped from `found.id`. If SumUp's refund endpoint actually keyed on
    // `transaction_code` instead of `id`, this refund would 404 and the client maps that to
    // `status: "refused"` (client.ts), which surfaces here as `state !== "refunded"` — the
    // silent-failure signal for a wrong id shape, not merely a business decline.
    const refunded = await provider.refund(result.paymentRef);
    expect(refunded.state).toBe("refunded");

    // (c) The create body carried `description: "waitron <workingOrderId>"` alongside the
    // required amount/currency fields (client.ts's `createCheckout`), and the Reader Checkout
    // accepted it — proven by the captured collect above: a rejected extra field would have
    // failed the create and never reached a poll at all.
  }, 180_000);
});
