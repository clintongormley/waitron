import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import type { IncidentSink } from "@waitron/payments";
import { tenantId as brandTenantId } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  STRIPE_CARD_PROVIDER,
  createStripeCardProvider,
  deferredStripeClient,
  secretKeyFromSealed,
} from "./card-provider.js";

// PGlite (superuser, one backend) is the right target: the seat reads a sealed credential and maps
// Stripe SDK calls through an injected `makeStripe`, so nothing here depends on the deployment role
// or on concurrency. Mirrors payments-sumup's card-provider.test.ts.
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  timeoutMs: 60_000,
});
const ring = loadKeyRing(KEY_ENV);

const FOUR_FIELDS = {
  secretKey: "sk_test_key",
  webhookSecret: "whsec_x",
  successUrl: "https://example.test/ok",
  cancelUrl: "https://example.test/no",
};

/** Records every secret key `makeStripe` is handed and every reader id retrieved/cancelled, so a
 * test can prove which key scoped the call and which reader was verified. */
interface FakeCalls {
  secretKeys: string[];
  accountsRetrieved: number;
  readersRetrieved: string[];
  cancelled: string[];
}

function freshCalls(): FakeCalls {
  return { secretKeys: [], accountsRetrieved: 0, readersRetrieved: [], cancelled: [] };
}

/** A `(secretKey) => Stripe` seam double exposing only the calls the card-provider seat makes:
 * `accounts.retrieve(null)` for connect, `terminal.readers.retrieve/cancelAction` for readers and
 * the deferred client. Nothing here reaches the network. */
function fakeMakeStripe(
  opts: {
    account?: () => Promise<unknown>;
    reader?: (id: string) => Promise<unknown>;
  },
  calls: FakeCalls,
): (secretKey: string) => Stripe {
  return (secretKey: string) => {
    calls.secretKeys.push(secretKey);
    return {
      accounts: {
        retrieve: async () => {
          calls.accountsRetrieved += 1;
          return (opts.account ?? (async () => ({ id: "acct_default" })))();
        },
      },
      terminal: {
        readers: {
          retrieve: async (id: string) => {
            calls.readersRetrieved.push(id);
            return (
              opts.reader ??
              (async (rid: string) => ({ id: rid, status: "online", device_type: "bbpos" }))
            )(id);
          },
          cancelAction: async (id: string) => {
            calls.cancelled.push(id);
          },
        },
      },
    } as unknown as Stripe;
  };
}

async function seedStripe(value: Record<string, string>): Promise<TenantId> {
  const tenantId = await seedTenant(suite.db);
  await withTenant(suite.db, tenantId, (tx) =>
    putCredential(tx, ring, { tenantId, purpose: "payments.stripe", value }),
  );
  return tenantId;
}

describe("STRIPE_CARD_PROVIDER seat metadata", () => {
  it("declares the provider id, purpose, form fields and reader-add mode", () => {
    expect(STRIPE_CARD_PROVIDER.providerId).toBe("stripe");
    expect(STRIPE_CARD_PROVIDER.credentialPurpose).toBe("payments.stripe");
    expect(STRIPE_CARD_PROVIDER.readerAdd).toEqual({
      kind: "reference",
      refLabelKey: "payments.stripe.reader_id",
    });
    const fields = STRIPE_CARD_PROVIDER.credentialFields;
    const names = fields.map((f) => f.name);
    expect(names).toEqual(["secretKey", "webhookSecret", "successUrl", "cancelUrl"]);
    expect(fields.find((f) => f.name === "secretKey")?.secret).toBe(true);
    expect(fields.find((f) => f.name === "webhookSecret")?.secret).toBe(true);
    expect(fields.find((f) => f.name === "successUrl")?.secret).toBe(false);
    expect(fields.find((f) => f.name === "cancelUrl")?.secret).toBe(false);
  });
});

describe("STRIPE_CARD_PROVIDER.connect", () => {
  it("verifies the key and returns the account display name plus the four-field sealed payload", async () => {
    const calls = freshCalls();
    const seat = createStripeCardProvider(
      fakeMakeStripe(
        {
          account: async () => ({
            id: "acct_x",
            settings: { dashboard: { display_name: "Deli Bar" } },
          }),
        },
        calls,
      ),
    );
    const result = await seat.connect({ environment: "preproduction" }, FOUR_FIELDS);
    expect(result).toEqual({
      merchantName: "Deli Bar",
      sealedPayload: {
        secretKey: "sk_test_key",
        webhookSecret: "whsec_x",
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/no",
      },
    });
    expect(calls.secretKeys).toEqual(["sk_test_key"]);
    expect(calls.accountsRetrieved).toBe(1);
  });

  it("falls back to the account id when the account has no display name", async () => {
    const seat = createStripeCardProvider(
      fakeMakeStripe(
        { account: async () => ({ id: "acct_noname", settings: null }) },
        freshCalls(),
      ),
    );
    const result = await seat.connect({ environment: "preproduction" }, FOUR_FIELDS);
    expect(result.merchantName).toBe("acct_noname");
  });

  it("throws provider_credential_rejected when the key is rejected by Stripe", async () => {
    const seat = createStripeCardProvider(
      fakeMakeStripe(
        {
          account: async () => {
            throw new Error("Invalid API Key provided");
          },
        },
        freshCalls(),
      ),
    );
    await expect(seat.connect({ environment: "preproduction" }, FOUR_FIELDS)).rejects.toMatchObject(
      { code: "payment.provider_credential_rejected" },
    );
  });

  it("throws provider_credential_rejected when no secret key was entered", async () => {
    const calls = freshCalls();
    const seat = createStripeCardProvider(fakeMakeStripe({}, calls));
    await expect(
      seat.connect({ environment: "preproduction" }, { webhookSecret: "w" }),
    ).rejects.toMatchObject({ code: "payment.provider_credential_rejected" });
    // The bad-credential is caught before any network call.
    expect(calls.accountsRetrieved).toBe(0);
  });

  it("throws credential_environment_mismatch for a test key on a production host, before any call", async () => {
    const calls = freshCalls();
    const seat = createStripeCardProvider(fakeMakeStripe({}, calls));
    await expect(
      seat.connect(
        {
          environment: "production",
          tenantId: brandTenantId("11111111-1111-4111-8111-111111111111"),
        },
        FOUR_FIELDS,
      ),
    ).rejects.toMatchObject({
      code: "payment.credential_environment_mismatch",
      params: { keyEnvironment: "preproduction", hostEnvironment: "production" },
    });
    expect(calls.accountsRetrieved).toBe(0);
  });
});

describe("STRIPE_CARD_PROVIDER.build", () => {
  it("builds a StripeTerminalProvider from the sealed credential", async () => {
    const tenantId = await seedStripe(FOUR_FIELDS);
    const incidents: IncidentSink = () => Promise.resolve(true);
    const seat = createStripeCardProvider(fakeMakeStripe({}, freshCalls()));
    const provider = seat.build({
      db: suite.db,
      ring,
      tenantId,
      nodeId: "11111111-1111-4111-8111-111111111111",
      environment: "preproduction",
      resolveReader: () => Promise.resolve("rdr_1"),
      incidents,
    });
    expect(provider.provider).toBe("stripe");
  });
});

describe("STRIPE_CARD_PROVIDER.readers", () => {
  async function readerDeps(makeStripe: (secretKey: string) => Stripe) {
    const tenantId = await seedStripe(FOUR_FIELDS);
    return { deps: { db: suite.db, ring, tenantId }, seat: createStripeCardProvider(makeStripe) };
  }

  it("add verifies the reader id exists and returns it paired", async () => {
    const calls = freshCalls();
    const { deps, seat } = await readerDeps(
      fakeMakeStripe(
        { reader: async (id) => ({ id, status: "online", device_type: "bbpos" }) },
        calls,
      ),
    );
    const result = await seat.readers.add(deps, { name: "Counter", reference: "tmr_abc" });
    expect(result).toEqual({ providerRef: "tmr_abc", status: "paired" });
    expect(calls.readersRetrieved).toEqual(["tmr_abc"]);
    // The tenant's own key scoped the call.
    expect(calls.secretKeys).toEqual(["sk_test_key"]);
  });

  it("add rejects a call with no reader reference (a caller-contract violation)", async () => {
    const { deps, seat } = await readerDeps(fakeMakeStripe({}, freshCalls()));
    await expect(seat.readers.add(deps, { name: "Counter" })).rejects.toThrow(/reference/);
  });

  it("status maps an online reader and its detail", async () => {
    const { deps, seat } = await readerDeps(
      fakeMakeStripe(
        { reader: async (id) => ({ id, status: "online", device_type: "stripe_s700" }) },
        freshCalls(),
      ),
    );
    const result = await seat.readers.status(deps, "tmr_abc");
    expect(result.online).toBe(true);
    expect(result.detail).toBe("stripe_s700");
    // A reference reader is paired the instant it is added, so status always reports paired.
    expect(result.pairingStatus).toBe("paired");
  });

  it("status maps an offline reader", async () => {
    const { deps, seat } = await readerDeps(
      fakeMakeStripe(
        { reader: async (id) => ({ id, status: "offline", device_type: "bbpos" }) },
        freshCalls(),
      ),
    );
    const result = await seat.readers.status(deps, "tmr_abc");
    expect(result.online).toBe(false);
  });

  it("status tolerates a failing retrieve, reporting offline rather than crashing", async () => {
    const { deps, seat } = await readerDeps(
      fakeMakeStripe(
        {
          reader: async () => {
            throw new Error("No such reader");
          },
        },
        freshCalls(),
      ),
    );
    const result = await seat.readers.status(deps, "tmr_gone");
    expect(result.online).toBe(false);
    expect(typeof result.detail).toBe("string");
  });

  it("remove is a no-op that makes no vendor call", async () => {
    const calls = freshCalls();
    const { deps, seat } = await readerDeps(fakeMakeStripe({}, calls));
    await expect(seat.readers.remove(deps, "tmr_abc")).resolves.toBeUndefined();
    // No credential read and no Stripe client construction: the reader stays registered at Stripe.
    expect(calls.secretKeys).toEqual([]);
  });
});

describe("secretKeyFromSealed", () => {
  it("returns the secret key from a well-formed payload", () => {
    expect(
      secretKeyFromSealed(
        { secretKey: "sk_test_x" },
        brandTenantId("11111111-1111-4111-8111-111111111111"),
      ),
    ).toBe("sk_test_x");
  });

  it("rejects a sealed payload missing the secret key", () => {
    expect(() =>
      secretKeyFromSealed(
        { webhookSecret: "w" },
        brandTenantId("11111111-1111-4111-8111-111111111111"),
      ),
    ).toThrow(/payment.provider_credential_rejected/);
  });

  it("throws credential_environment_mismatch for a live key on a pre-production host", () => {
    expect(() =>
      secretKeyFromSealed(
        { secretKey: "sk_live_x" },
        brandTenantId("11111111-1111-4111-8111-111111111111"),
        "preproduction",
      ),
    ).toThrow(/payment.credential_environment_mismatch/);
  });
});

describe("deferredStripeClient", () => {
  it("reads the sealed credential on first use and dispatches through the resolved client", async () => {
    const tenantId = await seedStripe(FOUR_FIELDS);
    const calls = freshCalls();
    const client = deferredStripeClient({
      db: suite.db,
      ring,
      tenantId,
      environment: "preproduction",
      makeStripe: fakeMakeStripe({}, calls),
    });
    await client.cancelReaderAction("tmr_abc");
    expect(calls.secretKeys).toEqual(["sk_test_key"]);
    expect(calls.cancelled).toEqual(["tmr_abc"]);
    // A second call reuses the cached client rather than reading the credential again.
    await client.cancelReaderAction("tmr_def");
    expect(calls.secretKeys).toEqual(["sk_test_key"]);
  });

  it("does not cache a failed read, so a later call retries once the credential exists", async () => {
    const tenantId = await seedTenant(suite.db); // no payments.stripe credential yet
    const calls = freshCalls();
    const client = deferredStripeClient({
      db: suite.db,
      ring,
      tenantId,
      environment: "preproduction",
      makeStripe: fakeMakeStripe({}, calls),
    });
    await expect(client.cancelReaderAction("tmr_abc")).rejects.toMatchObject({
      code: "credentials.missing",
    });
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, ring, { tenantId, purpose: "payments.stripe", value: FOUR_FIELDS }),
    );
    await client.cancelReaderAction("tmr_abc");
    expect(calls.cancelled).toEqual(["tmr_abc"]);
  });
});
