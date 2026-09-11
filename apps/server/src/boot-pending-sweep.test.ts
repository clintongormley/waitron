import { describe, expect, it, vi } from "vitest";
import type { ForwardResult, PaymentProvider } from "@waitron/payments";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { TenantId, TillId } from "@waitron/shared";
import { connectedCardProviderSweep, withPendingSweep } from "./boot.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import type { PassReport } from "./pass.js";

// `withPendingSweep` is a PURE wrapper over the loop's `pass` — a stubbed `inner` and a fake provider
// enumerator suffice (no container). It runs each connected card provider's `resolvePending` around
// the singleton fiscal pass and returns the INNER report verbatim, so the `/health` contract is
// untouched by a sweep that runs, logs, or throws. `connectedCardProviderSweep` (the enumerator boot
// wires in) is the credential-gated part that DOES need a database — its own describe below uses
// PGlite and a fake pool.

const REPORT: PassReport = { duties: [], nextDueAt: null };

/** A `PaymentProvider`-shaped double: `withPendingSweep` reads only `provider` (the name it logs) and
 * calls `resolvePending`. */
function fakeProvider(
  provider: string,
  resolvePending: () => Promise<ForwardResult>,
): PaymentProvider {
  return { provider, resolvePending } as unknown as PaymentProvider;
}

describe("withPendingSweep", () => {
  it("is a no-op (returns the inner report, logs nothing) when the enumerator yields no providers", async () => {
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();
    const wrapped = withPendingSweep(inner, async () => [], log);
    expect(await wrapped(new Date())).toBe(REPORT);
    expect(log).not.toHaveBeenCalled();
  });

  it("calls resolvePending once per provider, logs resolve_pending.complete, and returns the inner report verbatim", async () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    const nextDueAt = new Date("2026-09-10T12:01:00.000Z");
    const result: ForwardResult = { nextDueAt, forwarded: 2, declined: 1, incidentsRaised: 0 };
    const resolvePending = vi.fn(async () => result);
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();

    const report = await withPendingSweep(
      inner,
      async () => [fakeProvider("sumup", resolvePending)],
      log,
    )(now);

    expect(report).toBe(REPORT);
    expect(resolvePending).toHaveBeenCalledTimes(1);
    expect(resolvePending).toHaveBeenCalledWith(now);
    expect(log).toHaveBeenCalledWith("info", "resolve_pending.complete", {
      provider: "sumup",
      captured: 2,
      failed: 1,
      incidentsRaised: 0,
      nextDueAt: "2026-09-10T12:01:00.000Z",
    });
  });

  it("sweeps EVERY enumerated provider (the simulator + a pooled provider), each once", async () => {
    const empty: ForwardResult = { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
    const sim = vi.fn(async () => empty);
    const stripe = vi.fn(async () => empty);
    const log = vi.fn();
    await withPendingSweep(
      async () => REPORT,
      async () => [fakeProvider("simulator", sim), fakeProvider("stripe", stripe)],
      log,
    )(new Date());
    expect(sim).toHaveBeenCalledTimes(1);
    expect(stripe).toHaveBeenCalledTimes(1);
  });

  it("logs nextDueAt as null when a sweep reports nothing pending", async () => {
    const result: ForwardResult = {
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    };
    const log = vi.fn();
    await withPendingSweep(
      async () => REPORT,
      async () => [fakeProvider("stripe", async () => result)],
      log,
    )(new Date());
    expect(log).toHaveBeenCalledWith("info", "resolve_pending.complete", {
      provider: "stripe",
      captured: 0,
      failed: 0,
      incidentsRaised: 0,
      nextDueAt: null,
    });
  });

  it("logs resolve_pending.failed and still returns the inner report when a resolvePending rejects", async () => {
    const resolvePending = vi.fn(async () => {
      throw new Error("sweep boom");
    });
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();

    const report = await withPendingSweep(
      inner,
      async () => [fakeProvider("sumup", resolvePending)],
      log,
    )(new Date());

    // A sweep failure never breaks the pass — the inner report is returned unchanged.
    expect(report).toBe(REPORT);
    expect(log).toHaveBeenCalledWith("warn", "resolve_pending.failed", {
      provider: "sumup",
      error: "Error: sweep boom",
    });
  });

  it("logs resolve_pending.failed and returns the inner report when the ENUMERATOR itself throws", async () => {
    // Enumerating (a credential read / pool build) can fail; that must not propagate into the pass.
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();
    const report = await withPendingSweep(
      inner,
      async () => {
        throw new Error("enumerate boom");
      },
      log,
    )(new Date());
    expect(report).toBe(REPORT);
    expect(log).toHaveBeenCalledWith("warn", "resolve_pending.failed", {
      error: "Error: enumerate boom",
    });
  });
});

// `connectedCardProviderSweep` gates on a SEALED CREDENTIAL, so it needs a real (PGlite) database +
// a `tenant_credentials` table. PGlite is right here: the enumerator only reads the credential
// PRESENCE (metadata, no decrypt) and pool behaviour is faked, so nothing depends on the deployment
// role or on concurrency.
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  timeoutMs: 60_000,
});
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const CONTRIBUTIONS = [
  { providerId: "stripe", credentialPurpose: "payments.stripe" as const },
  { providerId: "sumup", credentialPurpose: "payments.sumup" as const },
];

/** Records every `pool.get` call and the reader resolver it was handed, and returns a fake provider
 * named after the requested id. */
function recordingPool(): {
  pool: CardProviderPool;
  gets: string[];
  resolvers: ((t: TenantId, i: TillId) => Promise<string>)[];
} {
  const gets: string[] = [];
  const resolvers: ((t: TenantId, i: TillId) => Promise<string>)[] = [];
  const pool: CardProviderPool = {
    get: (providerId, resolveReader) => {
      gets.push(providerId);
      resolvers.push(resolveReader);
      return Promise.resolve(
        fakeProvider(providerId, async () => ({
          nextDueAt: null,
          forwarded: 0,
          declined: 0,
          incidentsRaised: 0,
        })),
      );
    },
    evict: () => {},
  };
  return { pool, gets, resolvers };
}

describe("connectedCardProviderSweep", () => {
  it("sweeps a pooled provider only when the tenant has its sealed credential (negative control: none → not swept)", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, ring, {
        tenantId,
        purpose: "payments.stripe",
        value: {
          secretKey: "sk_test_x",
          webhookSecret: "whsec_x",
          successUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/no",
        },
      }),
    );
    const { pool, gets } = recordingPool();

    const providers = await connectedCardProviderSweep({
      db: suite.db,
      tenantId,
      pool,
      contributions: CONTRIBUTIONS,
      simulator: undefined,
    })();

    // Stripe is connected → fetched + swept; SumUp has NO sealed credential → never fetched (control).
    expect(gets).toEqual(["stripe"]);
    expect(providers.map((p) => p.provider)).toEqual(["stripe"]);
  });

  it("includes the demo/prepare simulator, and yields ONLY it when no credential is sealed", async () => {
    const tenantId = await seedTenant(suite.db);
    const { pool, gets } = recordingPool();
    const simulator = fakeProvider("simulator", async () => ({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    }));

    const providers = await connectedCardProviderSweep({
      db: suite.db,
      tenantId,
      pool,
      contributions: CONTRIBUTIONS,
      simulator,
    })();

    expect(gets).toEqual([]); // no connected pooled provider
    expect(providers).toEqual([simulator]);
  });

  it("hands pool.get a reader resolver that THROWS if ever called (a sweep must never collect)", async () => {
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
    const { pool, resolvers } = recordingPool();

    await connectedCardProviderSweep({
      db: suite.db,
      tenantId,
      pool,
      contributions: CONTRIBUTIONS,
      simulator: undefined,
    })();

    expect(resolvers).toHaveLength(1);
    expect(() => resolvers[0]!("t" as TenantId, "i" as TillId)).toThrow(
      /must never resolve a reader/,
    );
  });
});
