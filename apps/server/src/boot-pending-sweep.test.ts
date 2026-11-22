import { describe, expect, it, vi } from "vitest";
import type { CollectionOwners, ForwardResult, PaymentProvider } from "@waitron/payments";
import { nodeId } from "@waitron/shared";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import { connectedCardProviderSweep, sweepOwners } from "./boot.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import type { JobPassResult } from "./job-runner.js";
import type { Logger } from "./logger.js";
import { testCardFollowUp } from "./testing/card-follow-up.js";

const REPORT: JobPassResult = { nextDueAt: null };
const OWNERS: CollectionOwners = {
  nodeId: nodeId("11111111-1111-4111-8111-111111111111"),
  takenOverFrom: [],
  unowned: true,
};

describe("card follow-up order", () => {
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
      const provider = fakeProvider("sumup", async () => {
        ran.push("sweep");
        if (signalled) controller.abort();
        return empty;
      });
      provider.fillMissingCardDetails = async () => {
        ran.push("details");
        return null;
      };
      const job = testCardFollowUp(
        {
          sweepProviders: async () => [provider],
          owners: () => OWNERS,
          settle: async (signal) => {
            ran.push("settle");
            settledWith = signal;
            return {
              received: 0,
              failed: 0,
              pending: 0,
              errors: [],
            };
          },
          recoverRefunds: async () => {
            ran.push("refunds");
            return { pending: 0, nextDueAt: null };
          },
        },
        { log: vi.fn() },
      );
      expect(await job.pass({ now: new Date(), signal: controller.signal })).toEqual(REPORT);
      expect(ran).toEqual(signalled ? ["sweep"] : ["sweep", "settle", "details", "refunds"]);
      if (!signalled) expect(settledWith).toBe(controller.signal);
    },
  );
});

function fakeProvider(
  provider: string,
  resolvePending: () => Promise<ForwardResult>,
): PaymentProvider {
  return { provider, resolvePending } as unknown as PaymentProvider;
}

describe("sweepOwners", () => {
  const box = nodeId("22222222-2222-4222-8222-222222222222");

  it("on the primary: this box, nobody taken over, and the rows naming no box", () => {
    expect(sweepOwners(box, "primary", [])).toEqual({
      nodeId: box,
      takenOverFrom: [],
      unowned: true,
    });
  });

  it("on a secondary: this box only, never the rows naming no box", () => {
    expect(sweepOwners(box, "secondary", [])).toEqual({
      nodeId: box,
      takenOverFrom: [],
      unowned: false,
    });
  });
});

function sweepPass(
  afterDetails: (now: Date) => Promise<JobPassResult>,
  sweepProviders: () => Promise<readonly PaymentProvider[]>,
  owners: () => CollectionOwners,
  log: Logger,
  signal: AbortSignal = new AbortController().signal,
) {
  return (now: Date) =>
    testCardFollowUp(
      {
        sweepProviders,
        owners,
        recoverRefunds: async () => ({ pending: 0, ...(await afterDetails(now)) }),
      },
      { log },
    ).pass({ now, signal });
}

describe("sweepPass", () => {
  it.each([null, 10, 40])("keeps the earlier due time (%s)", async (innerSeconds) => {
    const now = new Date("2026-11-21T11:00:00Z");
    const controller = new AbortController();
    const due = new Date("2026-11-21T11:00:20Z");
    const log = vi.fn();
    const provider = fakeProvider("sumup", async () => ({
      forwarded: 1,
      declined: 0,
      incidentsRaised: 0,
      nextDueAt: null,
    }));
    const detail = { paymentRef: "payment-a", attempts: 2, ageSeconds: 31 };
    provider.fillMissingCardDetails = async (owners, report, signal) => {
      expect(owners).toBe(OWNERS);
      expect(signal).toBe(controller.signal);
      report({ outcome: "filled", ...detail });
      return due;
    };
    const report = await sweepPass(
      async () => ({
        ...REPORT,
        nextDueAt: innerSeconds === null ? null : new Date(now.getTime() + innerSeconds * 1_000),
      }),
      async () => [provider],
      () => OWNERS,
      log,
      controller.signal,
    )(now);
    expect(report.nextDueAt).toEqual(innerSeconds === 10 ? new Date("2026-11-21T11:00:10Z") : due);
    expect(log).toHaveBeenCalledWith("info", "payment.card_details_filled", {
      provider: "sumup",
      ...detail,
    });
  });

  it("logs only the error code when the detail pass throws", async () => {
    const log = vi.fn();
    const provider = fakeProvider("sumup", async () => ({
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
      nextDueAt: null,
    }));
    provider.fillMissingCardDetails = async () => {
      throw new Error("SQL bind parameters: 0421, A123");
    };
    const report = await sweepPass(
      async () => REPORT,
      async () => [provider],
      () => OWNERS,
      log,
    )(new Date());
    expect(report).toEqual(REPORT);
    expect(log).toHaveBeenCalledWith("warn", "payment.card_details_failed", {
      provider: "sumup",
      errorCode: "unknown",
    });
  });

  it("reports no due work and logs nothing when the enumerator yields no providers", async () => {
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();
    const wrapped = sweepPass(
      inner,
      async () => [],
      () => OWNERS,
      log,
    );
    expect(await wrapped(new Date())).toEqual(REPORT);
    expect(log).not.toHaveBeenCalled();
  });

  it("calls resolvePending once per provider, logs resolve_pending.complete, and schedules the provider retry", async () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    const nextDueAt = new Date("2026-09-10T12:01:00.000Z");
    const result: ForwardResult = { nextDueAt, forwarded: 2, declined: 1, incidentsRaised: 0 };
    const resolvePending = vi.fn(async () => result);
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();

    const report = await sweepPass(
      inner,
      async () => [fakeProvider("sumup", resolvePending)],
      () => OWNERS,
      log,
    )(now);

    expect(report.nextDueAt).toEqual(nextDueAt);
    expect(resolvePending).toHaveBeenCalledTimes(1);
    expect(resolvePending).toHaveBeenCalledWith(now, OWNERS, expect.any(AbortSignal));
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
    await sweepPass(
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
    await sweepPass(
      async () => REPORT,
      async () => [fakeProvider("simulator", sim), fakeProvider("stripe", stripe)],
      () => OWNERS,
      log,
    )(new Date());
    expect(sim).toHaveBeenCalledTimes(1);
    expect(stripe).toHaveBeenCalledTimes(1);
  });

  it("one provider's resolvePending throwing does NOT stop the others being swept", async () => {
    const empty: ForwardResult = { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
    const aThrows = vi.fn(async () => {
      throw new Error("A boom");
    });
    const bSweeps = vi.fn(async () => empty);
    const log = vi.fn();

    const pass = sweepPass(
      async () => REPORT,
      async () => [fakeProvider("providerA", aThrows), fakeProvider("providerB", bSweeps)],
      () => OWNERS,
      log,
    )(new Date());

    await expect(pass).rejects.toBeInstanceOf(AggregateError);
    expect(aThrows).toHaveBeenCalledTimes(1);
    expect(bSweeps).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("warn", "resolve_pending.failed", {
      provider: "providerA",
      error: "Error: A boom",
    });
    expect(log).toHaveBeenCalledWith("debug", "resolve_pending.complete", {
      provider: "providerB",
      captured: 0,
      failed: 0,
      incidentsRaised: 0,
      nextDueAt: null,
    });
  });

  it.each([
    { nextDueAt: null, level: "debug", loggedDueAt: null },
    {
      nextDueAt: new Date("2026-09-10T12:01:00.000Z"),
      level: "info",
      loggedDueAt: "2026-09-10T12:01:00.000Z",
    },
  ])(
    "logs a sweep with nextDueAt $loggedDueAt at $level",
    async ({ nextDueAt, level, loggedDueAt }) => {
      const result: ForwardResult = { nextDueAt, forwarded: 0, declined: 0, incidentsRaised: 0 };
      const log = vi.fn();
      await sweepPass(
        async () => REPORT,
        async () => [fakeProvider("stripe", async () => result)],
        () => OWNERS,
        log,
      )(new Date());
      expect(log).toHaveBeenCalledWith(level, "resolve_pending.complete", {
        provider: "stripe",
        captured: 0,
        failed: 0,
        incidentsRaised: 0,
        nextDueAt: loggedDueAt,
      });
    },
  );

  it("logs and reports a rejected resolvePending after the later work", async () => {
    const resolvePending = vi.fn(async () => {
      throw new Error("sweep boom");
    });
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();

    const pass = sweepPass(
      inner,
      async () => [fakeProvider("sumup", resolvePending)],
      () => OWNERS,
      log,
    )(new Date());

    await expect(pass).rejects.toBeInstanceOf(AggregateError);
    expect(log).toHaveBeenCalledWith("warn", "resolve_pending.failed", {
      provider: "sumup",
      error: "Error: sweep boom",
    });
  });

  it("logs and reports a failed provider enumeration after the later work", async () => {
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();
    const pass = sweepPass(
      inner,
      async () => {
        throw new Error("enumerate boom");
      },
      () => OWNERS,
      log,
    )(new Date());
    await expect(pass).rejects.toBeInstanceOf(AggregateError);
    expect(log).toHaveBeenCalledWith("warn", "resolve_pending.failed", {
      error: "Error: enumerate boom",
    });
  });

  it("contains a SYNCHRONOUS throw from the enumerator, exactly like a rejection", async () => {
    // Thrown when the enumerator is CALLED, not on a returned promise: a bare `.catch()` misses it.
    const inner = vi.fn(async () => REPORT);
    const log = vi.fn();
    const pass = sweepPass(
      inner,
      (() => {
        throw new Error("sync boom");
      }) as unknown as () => Promise<readonly PaymentProvider[]>,
      () => OWNERS,
      log,
    )(new Date());
    await expect(pass).rejects.toBeInstanceOf(AggregateError);
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
    const pass = sweepPass(
      async () => REPORT,
      async () => [fakeProvider("sumup", resolvePending)],
      () => sweepOwners(box, role, []),
      () => {},
    );
    const now = new Date();
    await pass(now);
    role = "primary";
    await pass(now);
    expect(resolvePending.mock.calls).toEqual([
      [now, sweepOwners(box, "secondary", []), expect.any(AbortSignal)],
      [now, sweepOwners(box, "primary", []), expect.any(AbortSignal)],
    ]);
  });

  it("reports a throwing owners reader without sweeping a provider", async () => {
    const resolvePending = vi.fn(async () => ({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    }));
    const log = vi.fn();
    const pass = sweepPass(
      async () => REPORT,
      async () => [fakeProvider("sumup", resolvePending)],
      () => {
        throw new Error("owners boom");
      },
      log,
    )(new Date());
    await expect(pass).rejects.toBeInstanceOf(AggregateError);
    expect(resolvePending).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("warn", "resolve_pending.failed", {
      error: "Error: owners boom",
    });
  });
});

// `connectedCardProviderSweep` gates on a sealed credential being present, so it needs a real
// database; the pool is faked.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
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
  it("sweeps a pooled provider only when the taxpayer has its sealed credential (negative control: none → not swept)", async () => {
    await seedTaxpayer(suite.db);
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        personId: null,
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
    await seedTaxpayer(suite.db);
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
