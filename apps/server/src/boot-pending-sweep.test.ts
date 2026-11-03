import { describe, expect, it, vi } from "vitest";
import type { CollectionOwners, ForwardResult, PaymentProvider } from "@waitron/payments";
import { nodeId } from "@waitron/shared";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, putCredential } from "@waitron/credentials";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  connectedCardProviderSweep,
  sweepOwners,
  pendingCardPass,
  withAutomaticCardRecovery,
  withPendingSweep,
  withStalePaymentRelease,
} from "./boot.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import type { PassReport } from "./pass.js";

// `withPendingSweep` returns the inner pass's report verbatim, so `/health` is untouched by a sweep
// that runs, logs or throws.

const REPORT: PassReport = { duties: [], nextDueAt: null };
const OWNERS: CollectionOwners = {
  nodeId: nodeId("11111111-1111-4111-8111-111111111111"),
  takenOverFrom: [],
  unowned: true,
};

describe("pendingCardPass", () => {
  it.each([true, false])(
    "a signal raised during the sweep runs none of the later steps (signalled: %s)",
    async (signalled) => {
      const controller = new AbortController();
      const ran: string[] = [];
      let settledWith: AbortSignal | undefined;
      const empty: ForwardResult = {
        nextDueAt: null,
        forwarded: 0,
        declined: 0,
        incidentsRaised: 0,
      };
      const pass = pendingCardPass(
        {
          sweepProviders: async () => [
            fakeProvider("stripe", async () => {
              if (signalled) controller.abort();
              return empty;
            }),
          ],
          owners: () => OWNERS,
          recover: async () => {
            ran.push("recover");
            return { filed: 0, errors: [] };
          },
          release: async () => {
            ran.push("release");
            return 0;
          },
          settle: async (signal) => {
            ran.push("settle");
            settledWith = signal;
            return {
              received: 0,
              failed: 0,
              mismatched: 0,
              refundsCompleted: 0,
              refundsFailed: 0,
              refundsUnresolved: 0,
              pending: 0,
              errors: [],
            };
          },
          getRole: () => "primary",
          log: vi.fn(),
        },
        controller.signal,
      );
      expect(await pass(new Date())).toEqual(REPORT);
      expect(ran).toEqual(signalled ? [] : ["recover", "release", "settle"]);
      if (!signalled) expect(settledWith).toBe(controller.signal);
    },
  );
});

describe("automatic recovery in the pending-card pass", () => {
  it("recovers after the sweep and before releasing stale marks", async () => {
    const order: string[] = [];
    const log = vi.fn();
    const pass = withStalePaymentRelease(
      withAutomaticCardRecovery(
        async () => {
          order.push("sweep");
          return REPORT;
        },
        async () => {
          order.push("recover");
          return { filed: 1, errors: [] };
        },
        () => "primary",
        log,
      ),
      async () => {
        order.push("release");
        return 0;
      },
      log,
    );
    expect(await pass(new Date())).toBe(REPORT);
    expect(order).toEqual(["sweep", "recover", "release"]);
    expect(log).toHaveBeenCalledWith("info", "payment.automatic_recovery", { filed: 1 });
  });

  it("leaves nonprimary filing alone and reads the role again each pass", async () => {
    let role: "primary" | "secondary" = "secondary";
    const recover = vi.fn(async () => ({ filed: 0, errors: [] }));
    const pass = withAutomaticCardRecovery(
      async () => REPORT,
      recover,
      () => role,
      () => {},
    );
    expect(await pass(new Date())).toBe(REPORT);
    expect(recover).not.toHaveBeenCalled();
    role = "primary";
    expect(await pass(new Date())).toBe(REPORT);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("logs each retained error and contains a failed recovery without replacing the report", async () => {
    const log = vi.fn();
    const recover = vi
      .fn(async () => ({ filed: 0, errors: [{ paymentId: "p1", error: "filing refused" }] }))
      .mockRejectedValueOnce(new Error("read refused"));
    const pass = withAutomaticCardRecovery(
      async () => REPORT,
      recover,
      () => "primary",
      log,
    );
    expect(await pass(new Date())).toBe(REPORT);
    expect(log).toHaveBeenCalledWith("warn", "payment.automatic_recovery_failed", {
      error: "Error: read refused",
    });
    expect(await pass(new Date())).toBe(REPORT);
    expect(log).toHaveBeenCalledWith("warn", "payment.automatic_recovery_failed", {
      paymentId: "p1",
      error: "filing refused",
    });
  });
});

/** `withPendingSweep` reads only `provider` and `resolvePending`. */
function fakeProvider(
  provider: string,
  resolvePending: () => Promise<ForwardResult>,
): PaymentProvider {
  return { provider, resolvePending } as unknown as PaymentProvider;
}

describe("sweepOwners", () => {
  const box = nodeId("22222222-2222-4222-8222-222222222222");

  it("on the primary: this box, nobody taken over, and the rows naming no box", () => {
    expect(sweepOwners(box, "primary")).toEqual({ nodeId: box, takenOverFrom: [], unowned: true });
  });

  it("on a secondary: this box only, never the rows naming no box", () => {
    expect(sweepOwners(box, "secondary")).toEqual({
      nodeId: box,
      takenOverFrom: [],
      unowned: false,
    });
  });
});

describe("withPendingSweep", () => {
  it("is a no-op (returns the inner report, logs nothing) when the enumerator yields no providers", async () => {
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();
    const wrapped = withPendingSweep(
      inner,
      async () => [],
      () => OWNERS,
      log,
    );
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
      () => OWNERS,
      log,
    )(now);

    expect(report).toBe(REPORT);
    expect(resolvePending).toHaveBeenCalledTimes(1);
    expect(resolvePending).toHaveBeenCalledWith(now, OWNERS, undefined);
    expect(log).toHaveBeenCalledWith("info", "resolve_pending.complete", {
      provider: "sumup",
      captured: 2,
      failed: 1,
      incidentsRaised: 0,
      nextDueAt: "2026-09-10T12:01:00.000Z",
    });
  });

  it("hands its signal to each provider's sweep", async () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    const empty: ForwardResult = { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
    const resolvePending = vi.fn(async () => empty);
    const signal = new AbortController().signal;
    await withPendingSweep(
      async () => REPORT,
      async () => [fakeProvider("stripe", resolvePending)],
      () => OWNERS,
      vi.fn(),
      signal,
    )(now);
    expect(resolvePending).toHaveBeenCalledWith(now, OWNERS, signal);
  });

  it("sweeps EVERY enumerated provider (the simulator + a pooled provider), each once", async () => {
    const empty: ForwardResult = { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
    const sim = vi.fn(async () => empty);
    const stripe = vi.fn(async () => empty);
    const log = vi.fn();
    await withPendingSweep(
      async () => REPORT,
      async () => [fakeProvider("simulator", sim), fakeProvider("stripe", stripe)],
      () => OWNERS,
      log,
    )(new Date());
    expect(sim).toHaveBeenCalledTimes(1);
    expect(stripe).toHaveBeenCalledTimes(1);
  });

  it("one provider's resolvePending throwing does NOT stop the others being swept (T12b)", async () => {
    const empty: ForwardResult = { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
    const aThrows = vi.fn(async () => {
      throw new Error("A boom");
    });
    const bSweeps = vi.fn(async () => empty);
    const log = vi.fn();

    const report = await withPendingSweep(
      async () => REPORT,
      async () => [fakeProvider("providerA", aThrows), fakeProvider("providerB", bSweeps)],
      () => OWNERS,
      log,
    )(new Date());

    expect(report).toBe(REPORT);
    expect(aThrows).toHaveBeenCalledTimes(1);
    expect(bSweeps).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("warn", "resolve_pending.failed", {
      provider: "providerA",
      error: "Error: A boom",
    });
    expect(log).toHaveBeenCalledWith("info", "resolve_pending.complete", {
      provider: "providerB",
      captured: 0,
      failed: 0,
      incidentsRaised: 0,
      nextDueAt: null,
    });
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
      () => OWNERS,
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
      () => OWNERS,
      log,
    )(new Date());

    expect(report).toBe(REPORT);
    expect(log).toHaveBeenCalledWith("warn", "resolve_pending.failed", {
      provider: "sumup",
      error: "Error: sweep boom",
    });
  });

  it("logs resolve_pending.failed and returns the inner report when the ENUMERATOR itself throws", async () => {
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();
    const report = await withPendingSweep(
      inner,
      async () => {
        throw new Error("enumerate boom");
      },
      () => OWNERS,
      log,
    )(new Date());
    expect(report).toBe(REPORT);
    expect(log).toHaveBeenCalledWith("warn", "resolve_pending.failed", {
      error: "Error: enumerate boom",
    });
  });

  it("contains a SYNCHRONOUS throw from the enumerator, exactly like a rejection", async () => {
    // Thrown when the enumerator is CALLED, not on a returned promise: a bare `.catch()` misses it.
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();
    const report = await withPendingSweep(
      inner,
      (() => {
        throw new Error("sync boom");
      }) as unknown as () => Promise<readonly PaymentProvider[]>,
      () => OWNERS,
      log,
    )(new Date());
    expect(report).toBe(REPORT);
    expect(log).toHaveBeenCalledWith("warn", "resolve_pending.failed", {
      error: "Error: sync boom",
    });
  });

  it("reads the owners again on each pass, so a change of role is seen at the next pass", async () => {
    const box = nodeId("33333333-3333-4333-8333-333333333333");
    let role: "primary" | "secondary" = "secondary";
    const resolvePending = vi.fn(async () => ({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    }));
    const pass = withPendingSweep(
      async () => REPORT,
      async () => [fakeProvider("sumup", resolvePending)],
      () => sweepOwners(box, role),
      () => {},
    );
    const now = new Date();
    await pass(now);
    role = "primary";
    await pass(now);
    expect(resolvePending.mock.calls).toEqual([
      [now, sweepOwners(box, "secondary"), undefined],
      [now, sweepOwners(box, "primary"), undefined],
    ]);
  });

  it("contains a throwing owners reader: no provider is swept and the inner report is returned", async () => {
    const resolvePending = vi.fn(async () => ({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    }));
    const log = vi.fn();
    const report = await withPendingSweep(
      async () => REPORT,
      async () => [fakeProvider("sumup", resolvePending)],
      () => {
        throw new Error("owners boom");
      },
      log,
    )(new Date());
    expect(report).toBe(REPORT);
    expect(resolvePending).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("warn", "resolve_pending.failed", {
      error: "Error: owners boom",
    });
  });
});

// `connectedCardProviderSweep` gates on a sealed credential being present, so it needs a real
// database; the pool is faked.
const suite = useVenueDb({
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

function recordingPool(): {
  pool: CardProviderPool;
  gets: string[];
} {
  const gets: string[] = [];
  const pool: CardProviderPool = {
    get: (providerId) => {
      gets.push(providerId);
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
  return { pool, gets };
}

describe("connectedCardProviderSweep", () => {
  it("sweeps a pooled provider only when the tenant has its sealed credential (negative control: none → not swept)", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
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
      pool,
      contributions: CONTRIBUTIONS,
      simulator: undefined,
    })();

    expect(gets).toEqual(["stripe"]);
    expect(providers.map((p) => p.provider)).toEqual(["stripe"]);
  });

  it("includes the demo/prepare simulator, and yields ONLY it when no credential is sealed", async () => {
    await seedTenant(suite.db);
    const { pool, gets } = recordingPool();
    const simulator = fakeProvider("simulator", async () => ({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    }));

    const providers = await connectedCardProviderSweep({
      db: suite.db,
      pool,
      contributions: CONTRIBUTIONS,
      simulator,
    })();

    expect(gets).toEqual([]);
    expect(providers).toEqual([simulator]);
  });
});

describe("withStalePaymentRelease", () => {
  it("releases in-flight marks after the inner pass, logs how many, and returns the inner report", async () => {
    const now = new Date("2026-09-26T12:00:00.000Z");
    const order: string[] = [];
    const inner = vi.fn(async () => {
      order.push("pass");
      return REPORT;
    });
    const release = vi.fn(async () => {
      order.push("release");
      return 2;
    });
    const log = vi.fn();

    expect(await withStalePaymentRelease(inner, release, log)(now)).toBe(REPORT);

    expect(inner).toHaveBeenCalledWith(now);
    expect(order).toEqual(["pass", "release"]);
    expect(log).toHaveBeenCalledWith("info", "payment_attempt.released", { released: 2 });
  });

  it("logs nothing when there was nothing to release", async () => {
    const log = vi.fn();

    await withStalePaymentRelease(
      async () => REPORT,
      async () => 0,
      log,
    )(new Date());

    expect(log).not.toHaveBeenCalled();
  });

  it("a failed release is logged and never breaks the pass", async () => {
    const log = vi.fn();

    const report = await withStalePaymentRelease(
      async () => REPORT,
      () => Promise.reject(new Error("disk I/O error")),
      log,
    )(new Date());

    expect(report).toBe(REPORT);
    expect(log).toHaveBeenCalledWith("warn", "payment_attempt.release_failed", {
      error: "Error: disk I/O error",
    });
  });
});
