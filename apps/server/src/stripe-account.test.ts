import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import { isAppError, type AppError } from "@waitron/shared";
import { defaultMakeStripe, stripeAccountResolver, stripeSecretKeyFrom } from "./stripe-account.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  timeoutMs: 60_000,
});
const ring = loadKeyRing(KEY_ENV);

describe("stripeAccountResolver", () => {
  it("builds the account from the tenant's own secret key", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        purpose: "payments.stripe",
        value: {
          secretKey: "sk_test_tenant_one",
          webhookSecret: "whsec_x",
          successUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/no",
        },
      }),
    );

    const keys: string[] = [];
    const resolve = stripeAccountResolver({
      db: suite.db,
      ring,
      environment: "preproduction",
      makeStripe: (secretKey) => {
        keys.push(secretKey);
        return {} as Stripe;
      },
    });

    const account = await resolve();
    // A Stripe account is standalone (one per merchant, no Connect), so a client built from the wrong
    // key settles real money against the wrong merchant with no error anywhere.
    expect(keys).toEqual(["sk_test_tenant_one"]);
    expect(typeof account.report.listSettlements).toBe("function");
    expect(typeof account.refund.refund).toBe("function");
  });

  it("surfaces the vault's own code when the tenant has no Stripe credential", async () => {
    await seedTenant(suite.db);
    const resolve = stripeAccountResolver({
      db: suite.db,
      ring,
      environment: "preproduction",
      makeStripe: () => ({}) as Stripe,
    });
    const error = await captureError(() => resolve());
    expect(isAppError(error) && error.code).toBe("credentials.missing");
  });
});

describe("stripeSecretKeyFrom", () => {
  const REF = { purpose: "payments.stripe" };

  // Driven directly rather than through a forged database row: `putCredential` refuses a payload
  // missing `secretKey`, and the pure function IS the read-side guard.
  it("fails loudly on a payload sealed without a secretKey, rather than passing undefined to Stripe", () => {
    expect(() => stripeSecretKeyFrom({ webhookSecret: "whsec_x" }, REF, "production")).toThrow(
      /server.credential_unusable/,
    );
  });

  it("returns the key when present", () => {
    expect(stripeSecretKeyFrom({ secretKey: "sk_test_x" }, REF, "preproduction")).toBe("sk_test_x");
  });

  it("refuses a test key on a production deployment", async () => {
    const error = await captureError(() =>
      Promise.resolve(stripeSecretKeyFrom({ secretKey: "sk_test_abc123" }, REF, "production")),
    );
    expect(error).toMatchObject({ code: "payment.credential_environment_mismatch" });
    expect((error as AppError).params).toEqual({
      keyEnvironment: "preproduction",
      hostEnvironment: "production",
    });
  });

  it("refuses a live key on a pre-production deployment", async () => {
    const error = await captureError(() =>
      Promise.resolve(stripeSecretKeyFrom({ secretKey: "sk_live_abc123" }, REF, "preproduction")),
    );
    expect(error).toMatchObject({
      code: "payment.credential_environment_mismatch",
      params: { keyEnvironment: "production", hostEnvironment: "preproduction" },
    });
  });

  it("never echoes the key, or any prefix of it, in the error", async () => {
    const error = await captureError(() =>
      Promise.resolve(stripeSecretKeyFrom({ secretKey: "sk_test_SUPERSECRET" }, REF, "production")),
    );
    expect(JSON.stringify(error)).not.toContain("SUPERSECRET");
    expect(JSON.stringify(error)).not.toContain("sk_test");
  });

  it("accepts a matching pair", () => {
    expect(stripeSecretKeyFrom({ secretKey: "sk_live_ok" }, REF, "production")).toBe("sk_live_ok");
    expect(stripeSecretKeyFrom({ secretKey: "sk_test_ok" }, REF, "preproduction")).toBe(
      "sk_test_ok",
    );
  });

  it("accepts a key whose mode it cannot tell, rather than guessing", () => {
    // Restricted keys (`rk_`) and any future prefix: refusing what we cannot classify would break a
    // working deployment to enforce a check we cannot actually perform.
    expect(stripeSecretKeyFrom({ secretKey: "rk_live_x" }, REF, "production")).toBe("rk_live_x");
  });
});

describe("defaultMakeStripe", () => {
  it("builds a real SDK client from the key, with no network call", () => {
    // The constructor is synchronous and does no I/O — `boot.ts` wires this in directly (unlike
    // every other test in this file, which injects a fake), so this is its only test subject.
    expect(defaultMakeStripe("sk_test_covered").balanceTransactions).toBeDefined();
  });
});
