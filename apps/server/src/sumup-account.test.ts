import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import { decimal } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sumupClientOptionsFrom, sumupClientResolver } from "./sumup-account.js";
import type { SumUpAccountDeps } from "./sumup-account.js";

// sumupClientResolver only reads the tenant's `payments.sumup` credential and constructs a client —
// no network call (the injected `fetch` observes the requests). PGlite (superuser, one backend) is the
// right target: nothing here depends on the deployment role or on concurrency. Mirrors
// boot-card-provider.test.ts's seeded-credential shape and stripe-account's read-site validation test.
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  timeoutMs: 60_000,
});
const ring = loadKeyRing(KEY_ENV);

/** A `fetch` that records the URL and body of every call and answers with SumUp's create-checkout
 * success shape, so the resolver builds a real client that never touches the network. */
function recordingFetch(seen: string[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(String(url));
    seen.push(typeof init?.body === "string" ? init.body : "");
    return new Response(
      JSON.stringify({ data: { checkout_id: "c", client_transaction_id: "x" } }),
      { status: 201 },
    );
  }) as unknown as typeof fetch;
}

function deps(overrides: Partial<SumUpAccountDeps> = {}): SumUpAccountDeps {
  return { db: suite.db, ring, ...overrides };
}

/** Seeds a `payments.sumup` credential for a fresh tenant and returns its id. */
async function seedTenantWithSumUp(value: {
  apiKey: string;
  merchantCode: string;
  affiliateAppId: string;
  affiliateKey: string;
}): Promise<TenantId> {
  const tenantId = await seedTenant(suite.db);
  await withTenant(suite.db, tenantId, (tx) =>
    putCredential(tx, ring, { tenantId, purpose: "payments.sumup", value }),
  );
  return tenantId;
}

describe("sumupClientResolver", () => {
  it("builds a client from the tenant's sealed payments.sumup credential, with the affiliate block", async () => {
    const tenantId = await seedTenantWithSumUp({
      apiKey: "sup_sk_x",
      merchantCode: "MABC123",
      affiliateAppId: "com.waitron.pos",
      affiliateKey: "aff-key",
    });
    const seen: string[] = [];
    const client = await sumupClientResolver(deps({ fetch: recordingFetch(seen) }))(tenantId);
    await client.createCheckout({
      readerId: "rdr_1",
      amount: decimal("1.00"),
      currency: "EUR",
      description: "d",
      foreignTransactionId: "ref",
    });
    expect(seen[0]).toContain("/v0.1/merchants/MABC123/readers/rdr_1/checkout");
    expect(seen[1]).toContain('"foreign_transaction_id":"ref"');
  });

  it("omits the affiliate block when both affiliate fields are the literal '-'", async () => {
    const tenantId = await seedTenantWithSumUp({
      apiKey: "sup_sk_x",
      merchantCode: "MABC123",
      affiliateAppId: "-",
      affiliateKey: "-",
    });
    const seen: string[] = [];
    const client = await sumupClientResolver(deps({ fetch: recordingFetch(seen) }))(tenantId);
    await client.createCheckout({
      readerId: "rdr_1",
      amount: decimal("1.00"),
      currency: "EUR",
      description: "d",
      foreignTransactionId: "ref",
    });
    expect(seen[1]).not.toContain("affiliate");
  });

  it("throws server.credential_unusable when apiKey is missing from the sealed payload", () => {
    // putCredential cannot seal an empty required field, so a stale/hand-forged payload is driven
    // directly through the pure validator — the stripeSecretKeyFrom convention.
    expect(() =>
      sumupClientOptionsFrom(
        { merchantCode: "MABC123", affiliateAppId: "-", affiliateKey: "-" },
        { tenantId: "t", purpose: "payments.sumup" },
      ),
    ).toThrow(/server.credential_unusable/);
  });

  it("throws credentials.missing when the tenant has no payments.sumup credential", async () => {
    const tenantId = await seedTenant(suite.db);
    await expect(sumupClientResolver(deps())(tenantId)).rejects.toMatchObject({
      code: "credentials.missing",
    });
  });
});
