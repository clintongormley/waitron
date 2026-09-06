import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { StripeOnDeviceProvider, StripeTerminalProvider } from "@waitron/payments-stripe";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { buildCardProvider } from "./boot.js";
import type { CardProvider, TillConfig } from "./till-config.js";

// buildCardProvider only reads the tenant's `payments.stripe` credential and constructs a provider —
// no reader/network call — so PGlite (superuser, one backend) is the right target here: nothing on
// this path depends on the deployment role or on concurrency (what the providers themselves do
// against a real database, as a non-superuser member of `app_user`, is proven in
// `packages/payments-stripe`'s `device.test.ts`, `hosted.test.ts` and `stripe.test.ts`). The two provider
// branches (`stripe_terminal`, `stripe_on_device`) are the ones `boot.test.ts` — which boots against
// a real container with `cardProvider=none` — cannot reach; the `none` branch is covered there.
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  timeoutMs: 60_000,
});
const ring = loadKeyRing(KEY_ENV);

/** A TillConfig for `tenantId` with the given card fields — the fiscal ids are fresh brands the card
 * path never reads, so they carry throwaway uuids. `orderFlow` is irrelevant to `buildCardProvider`. */
function cfgFor(
  tenantId: TenantId,
  cardProvider: CardProvider,
  stripeReaderId?: string,
): TillConfig {
  return {
    tenantId,
    tillId: brandTillId(randomUUID()),
    nodeId: brandNodeId(randomUUID()),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(randomUUID()),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    cardProvider,
    ...(stripeReaderId === undefined ? {} : { stripeReaderId }),
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

/** Seeds a `payments.stripe` credential for a fresh tenant and returns its id. */
async function seedTenantWithStripeKey(secretKey: string): Promise<TenantId> {
  const tenantId = await seedTenant(suite.db);
  await withTenant(suite.db, tenantId, (tx) =>
    putCredential(tx, ring, {
      tenantId,
      purpose: "payments.stripe",
      value: {
        secretKey,
        webhookSecret: "whsec_x",
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/no",
      },
    }),
  );
  return tenantId;
}

function deps() {
  // The injected `makeStripe` never constructs a real SDK client — a `{}` cast is enough because
  // buildCardProvider builds the wrapper and the provider without ever CALLING a Stripe method.
  return {
    db: suite.db,
    ring,
    environment: "preproduction" as const,
    makeStripe: () => ({}) as Stripe,
  };
}

describe("buildCardProvider", () => {
  it("returns undefined for cardProvider 'none' (no credential read at all)", async () => {
    // A tenant with NO Stripe credential: proof the `none` branch short-circuits before any read —
    // a credential lookup here would throw `credentials.missing` instead of returning undefined.
    const tenantId = await seedTenant(suite.db);
    const provider = await buildCardProvider(cfgFor(tenantId, "none"), deps());
    expect(provider).toBeUndefined();
  });

  it("builds a StripeTerminalProvider for cardProvider 'stripe_terminal'", async () => {
    const tenantId = await seedTenantWithStripeKey("sk_test_terminal");
    const provider = await buildCardProvider(cfgFor(tenantId, "stripe_terminal", "tmr_1"), deps());
    expect(provider).toBeInstanceOf(StripeTerminalProvider);
    expect(provider?.provider).toBe("stripe");
  });

  it("builds a StripeOnDeviceProvider for cardProvider 'stripe_on_device'", async () => {
    const tenantId = await seedTenantWithStripeKey("sk_test_device");
    const provider = await buildCardProvider(cfgFor(tenantId, "stripe_on_device"), deps());
    expect(provider).toBeInstanceOf(StripeOnDeviceProvider);
    expect(provider?.provider).toBe("stripe");
  });

  it("fails loudly (does not build a provider) when the till's tenant has no Stripe credential", async () => {
    // The boot-time guard: a terminal cfg whose tenant carries no `payments.stripe` credential must
    // fail the boot here, not on the first card sale — buildCardProvider surfaces the vault's own
    // `credentials.missing` rather than returning a half-built provider.
    const tenantId = await seedTenant(suite.db);
    await expect(
      buildCardProvider(cfgFor(tenantId, "stripe_terminal", "tmr_1"), deps()),
    ).rejects.toMatchObject({ code: "credentials.missing" });
  });
});
