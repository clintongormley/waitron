import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { isAppError } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type { CardProviderContribution, IncidentSink, PaymentProvider } from "@waitron/payments";
import { SUMUP_CARD_PROVIDER } from "@waitron/payments-sumup";
import { SumUpCloudProvider } from "@waitron/payments-sumup";
import { createCardProviderPool } from "./card-provider-pool.js";

// The pool's own contract (build-once, cache, evict-to-rebuild, unknown-id, propagate-a-build-
// failure) is provider-agnostic, so most cases here use a FAKE CardProviderContribution with a spy
// `build` — deterministic call counting with no vault I/O. One case wires the real SumUp seat over a
// seeded `payments.sumup` credential (PGlite; superuser, single backend — nothing here depends on the
// deployment role) to prove the pool actually threads its deps into a real seat's `build`.
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 3).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  timeoutMs: 60_000,
});
const ring = loadKeyRing(KEY_ENV);

const incidents: IncidentSink = async () => true;

/** A minimal but fully-shaped fake seat: only `build` is exercised by the pool, so every other
 * method is a stub that would fail loudly if the pool ever called it. */
function fakeContribution(
  providerId: string,
  build: CardProviderContribution["build"],
): CardProviderContribution {
  return {
    providerId,
    credentialPurpose: "payments.sumup",
    credentialFields: [],
    readerAdd: { kind: "reference", refLabelKey: "x" },
    connect: () => {
      throw new Error("not used by the pool");
    },
    build,
    readers: {
      canUnpair: false,
      list: async () => [],
      add: () => {
        throw new Error("not used by the pool");
      },
      status: () => {
        throw new Error("not used by the pool");
      },
      remove: () => {
        throw new Error("not used by the pool");
      },
    },
  };
}

function fakeProvider(name: string): PaymentProvider {
  return {
    provider: name,
    capabilities: { partialRefund: false },
    collect: () => {
      throw new Error("not used by the pool");
    },
    forward: () => {
      throw new Error("not used by the pool");
    },
    resolvePending: () => {
      throw new Error("not used by the pool");
    },
    void: () => {
      throw new Error("not used by the pool");
    },
    refund: () => {
      throw new Error("not used by the pool");
    },
    partialRefund: () => {
      throw new Error("not used by the pool");
    },
  };
}

async function seedTenantWithSumUpKey(): Promise<TenantId> {
  const tenantId = await seedTenant(suite.db);
  await withTenant(suite.db, tenantId, (tx) =>
    putCredential(tx, ring, {
      tenantId,
      purpose: "payments.sumup",
      value: {
        apiKey: "sup_sk_x",
        merchantCode: "MABC123",
        affiliateAppId: "-",
        affiliateKey: "-",
      },
    }),
  );
  return tenantId;
}

describe("createCardProviderPool", () => {
  it("builds once and caches: a second get returns the same instance without calling build again", async () => {
    const build = vi.fn(() => fakeProvider("sumup"));
    const pool = createCardProviderPool({
      providers: [fakeContribution("sumup", build)],
      db: suite.db,
      ring,
      tenantId: await seedTenant(suite.db),
      nodeId: "node-1",
      environment: "preproduction",
      incidents,
    });

    const first = await pool.get("sumup");
    const second = await pool.get("sumup");

    expect(second).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("rebuilds after evict — and a negative control proves eviction is what triggers it", async () => {
    const build = vi.fn(() => fakeProvider("sumup"));
    const pool = createCardProviderPool({
      providers: [fakeContribution("sumup", build)],
      db: suite.db,
      ring,
      tenantId: await seedTenant(suite.db),
      nodeId: "node-1",
      environment: "preproduction",
      incidents,
    });

    const first = await pool.get("sumup");
    // Negative control: a second get with NO evict in between must still be the cached instance —
    // if this failed too, the later rebuild would prove nothing about evict specifically.
    const stillCached = await pool.get("sumup");
    expect(stillCached).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);

    pool.evict("sumup");
    const rebuilt = await pool.get("sumup");

    expect(rebuilt).not.toBe(first);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("throws payment.provider_unknown for an id no contribution declares", async () => {
    const pool = createCardProviderPool({
      providers: [fakeContribution("sumup", () => fakeProvider("sumup"))],
      db: suite.db,
      ring,
      tenantId: await seedTenant(suite.db),
      nodeId: "node-1",
      environment: "preproduction",
      incidents,
    });

    await expect(pool.get("redsys")).rejects.toMatchObject({
      code: "payment.provider_unknown",
    });
  });

  it("propagates a build failure and does not cache a broken provider", async () => {
    let attempts = 0;
    const build = vi.fn(() => {
      attempts += 1;
      throw new Error(`build failed (attempt ${attempts})`);
    });
    const pool = createCardProviderPool({
      providers: [fakeContribution("sumup", build)],
      db: suite.db,
      ring,
      tenantId: await seedTenant(suite.db),
      nodeId: "node-1",
      environment: "preproduction",
      incidents,
    });

    await expect(pool.get("sumup")).rejects.toThrow("build failed (attempt 1)");
    // A failed build must not be cached: the next get calls build again rather than replaying (or
    // silently swallowing) the earlier failure.
    await expect(pool.get("sumup")).rejects.toThrow("build failed (attempt 2)");
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("wires the real SumUp seat: get returns a live SumUpCloudProvider built from the sealed credential", async () => {
    const tenantId = await seedTenantWithSumUpKey();
    const pool = createCardProviderPool({
      providers: [SUMUP_CARD_PROVIDER],
      db: suite.db,
      ring,
      tenantId,
      nodeId: "node-1",
      environment: "preproduction",
      incidents,
    });

    const provider = await pool.get("sumup");

    expect(provider).toBeInstanceOf(SumUpCloudProvider);
    expect(provider.provider).toBe("sumup");
    expect(await pool.get("sumup")).toBe(provider);
  });

  it("is a real AppError with a code, not just an object shape", async () => {
    const pool = createCardProviderPool({
      providers: [],
      db: suite.db,
      ring,
      tenantId: await seedTenant(suite.db),
      nodeId: "node-1",
      environment: "preproduction",
      incidents,
    });

    try {
      await pool.get("sumup");
      expect.unreachable("expected pool.get to throw");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) expect(error.code).toBe("payment.provider_unknown");
    }
  });
});
