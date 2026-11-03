// The card capture is held by a stand-in card provider passed through `StartServerSeams.cardPool`:
// the simulator holds a capture only on a Demo or Prepare box, and neither of those files with AEAT.
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import type { HandoverBinding } from "@waitron/handover";
import { startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { scheduledRuns } from "@waitron/scheduler";
import { readHandoverRestriction } from "@waitron/node-db";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { StartedServer } from "./boot.js";
import type { StepDownRequest, StepDownResult } from "./handover-stepdown.js";
import { beginHandover } from "./handover-store.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();

/** Every call each outside stand-in received, by `Date.now()` when it was made. */
const outside = vi.hoisted(() => ({
  submits: [] as number[],
  reconciles: [] as number[],
  sweeps: [] as number[],
  holdSubmit: null as Promise<void> | null,
  holdSweep: null as Promise<void> | null,
}));

// The pending-card loop sleeps at most 50 ms between passes, so a loop nobody stopped sweeps again
// inside the window the test holds open after the stepdown.
vi.mock("./pending-card-recovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pending-card-recovery.js")>();
  return {
    ...actual,
    runPendingCardLoop: (...args: Parameters<typeof actual.runPendingCardLoop>) => {
      const [deps] = args;
      return actual.runPendingCardLoop({
        ...deps,
        sleep: (ms, signal) =>
          new Promise<void>((done) => {
            const timer = setTimeout(done, Math.min(ms, 50));
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                done();
              },
              { once: true },
            );
          }),
      });
    },
  };
});

// AEAT's clock reading answers nothing, so the only AEAT traffic is the drain's, through the
// stand-in below.
vi.mock("./clock-watch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clock-watch.js")>();
  return {
    ...actual,
    startClockWatch: (...args: Parameters<typeof actual.startClockWatch>) => {
      const [deps] = args;
      return actual.startClockWatch({
        ...deps,
        backend: new Proxy(deps.backend, {
          get: (target, key) => {
            if (key === "readAuthorityTime") return () => Promise.resolve(null);
            const value: unknown = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      });
    },
  };
});

// The real drain and its loop, with AEAT's transport replaced by a fake that counts submissions
// and holds the first answer, and a batch cap of three so the seeded records are three batches due.
vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => {
      const real = actual.fiscalSlot(...args);
      if (real.id !== "verifactu") return real;
      const drainHere: typeof real.drain = async (
        { db, environment, skipRetryMs, signal },
        now,
      ) => {
        // Imported here: the fiscal package imports this mocked module, so a factory-time import
        // never settles.
        const { drain } = await import("@waitron/fiscal-verifactu");
        const { createFakeAeat } = await import("@waitron/verifactu/testing");
        const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") }).client();
        const client = {
          ...fake,
          submit: async (...submitted: Parameters<typeof fake.submit>) => {
            outside.submits.push(Date.now());
            const hold = outside.holdSubmit;
            outside.holdSubmit = null;
            if (hold !== null) await hold;
            return fake.submit(...submitted);
          },
        };
        return drain(
          {
            db,
            resolveClient: () => Promise.resolve(client),
            skipRetryMs,
            environment,
            maxRegistrosPorEnvio: 3,
            ...(signal === undefined ? {} : { signal }),
          },
          now,
        );
      };
      return { ...real, drain: drainHere };
    },
  };
});

// Stripe's reconciler, counting each call and finding nothing.
vi.mock("@waitron/payments-stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/payments-stripe")>();
  class CountingReconciler {
    readonly provider = "stripe";
    reconcile(period: { from: Date; to: Date }) {
      outside.reconciles.push(Date.now());
      return Promise.resolve({
        period,
        checked: 0,
        unsettled: [],
        lostSettlement: [],
        orphan: [],
        missingLocal: [],
        drift: [],
        incidentsRaised: 0,
        remediated: 0,
        remediationFailures: [],
      });
    }
  }
  return { ...actual, StripeReconciler: CountingReconciler };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations, resetPerTest: false });

const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const DESTINATION = "22222222-2222-4222-8222-222222222222";
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Rejects naming `what` if `promise` has not settled within `ms`. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} still waiting after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** How long the test keeps the server up after releasing AEAT and the sweep, before the sale. */
const WINDOW_MS = 300;

function hold() {
  let release!: () => void;
  const wait = new Promise<void>((done) => (release = done));
  return { release, wait };
}

interface Observed {
  stepdown: { status: number; body: unknown };
  refused: { status: number; body: unknown };
  sale: { status: number; body: Record<string, unknown> };
  salesForOrder: number;
  restarts: number;
  recordedAt: number;
  stepdownAt: number;
  submitsBeforeStepdown: number;
  reconcilesBeforeStepdown: number;
  sweepsBeforeStepdown: number;
}

describe("a card sale in flight when the box steps down", () => {
  let server: StartedServer | undefined;
  let scratch: string | undefined;
  let observed: Observed | undefined;
  // Released before the close, so a case that failed half-way still lets the server stop.
  const releases: (() => void)[] = [];

  beforeAll(async () => {
    beforeServerStarts();
    const venue: BillVenue = await provisionBillVenue(suite.db);
    const nodeId = venue.cfg.nodeId;
    const ring = loadKeyRing(KEY_ENV);
    // Nine records waiting, three batches at the cap; their wait is cleared by Retry now once the
    // stand-ins have each been reached once, so the drain that holds AEAT is a later pass.
    await seedPendingEnvios(suite.db, {
      count: 9,
      identity: { locationId: venue.cfg.locationId, nodeId, nif: "61000002T" },
      entorno: "preproduction",
    });
    // The fixture adds a standard series of its own; the sale files in the venue's.
    await suite.db.execute(
      sql`update invoice_series set retired_at = ${new Date().toISOString()}
          where node_id = ${nodeId} and purpose = 'standard' and id <> ${venue.seriesId}`,
    );
    const later = new Date(Date.now() + 60 * 60_000).toISOString();
    await suite.db.execute(sql`update envios set proximo_intento_en = ${later}`);
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        purpose: "payments.stripe",
        value: {
          secretKey: "sk_test_stepdown",
          webhookSecret: "whsec_stepdown",
          successUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/no",
        },
      }),
    );
    const adminSession = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { personId: venue.adminId }),
    );
    const adminCookie = `${MANAGEMENT_COOKIE}=${adminSession.token}`;
    const binding: HandoverBinding = {
      operationId: OP,
      scenario: "controlled",
      venue: { country: "ES", taxId: "61000002T", environment: "preproduction" },
      sourceNodeId: nodeId,
      destinationNodeId: DESTINATION,
      membership: { term: 3, digest: "a".repeat(64) },
    };
    await beginHandover({ node: suite.node, nodeId }, binding, "source");

    scratch = await mkdtemp(join(tmpdir(), "waitron-stepdown-real-"));
    const migrationsRoot = join(scratch, "migrations");
    for (const [index, set] of manifestSets().entries()) {
      await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    }
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    await suite.db.execute(sql`update card_readers set provider = 'stripe'`);
    // A reconcile recorded twenty days ago leaves every day since a gap, and one period a pass
    // keeps the rest due on every pass, so a pass nobody stopped reconciles again.
    const dayStart = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    );
    const oldPeriod = new Date(dayStart - 20 * 24 * 60 * 60_000);
    await suite.db.insert(scheduledRuns).values({
      duty: "payments.reconcile.stripe",
      periodFrom: oldPeriod.toISOString(),
      periodTo: new Date(oldPeriod.getTime() + 24 * 60 * 60_000).toISOString(),
      state: "succeeded",
      attempts: 1,
    });
    let restarts = 0;
    const restarted = hold();
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const env: Record<string, string> = {
      ...KEY_ENV,
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
      WAITRON_STATE_DIR: scratch,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_NODE_ID: nodeId,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
      WAITRON_MAX_TICK_MS: "600000",
      WAITRON_MIN_TICK_MS: "200",
      WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
      WAITRON_SCHEDULER_MAX_PERIODS_PER_TICK: "1",
    };

    let card: FakePaymentProvider | undefined;
    server = await startServer(env, env, {
      // The venue's readers are Stripe's here, so the till's own credential check passes and the
      // card sweep reaches this stand-in through the held Stripe credential.
      cardPool: ({ db }) => {
        card = new FakePaymentProvider(db);
        Object.defineProperty(card, "provider", { value: "stripe" });
        const resolvePending = card.resolvePending.bind(card);
        card.resolvePending = async (now) => {
          outside.sweeps.push(Date.now());
          const held = outside.holdSweep;
          outside.holdSweep = null;
          if (held !== null) await held;
          return resolvePending(now);
        };
        return {
          get: (providerId) =>
            providerId === "stripe"
              ? Promise.resolve(card!)
              : Promise.reject(new Error(`no stand-in for ${providerId}`)),
          evict: () => {},
        };
      },
      stepdown: {
        mount: (app: Hono, stepDown: (request: StepDownRequest) => Promise<StepDownResult>) => {
          app.post("/test/stepdown", async (c) =>
            c.json(await stepDown({ binding, kind: "handed-over", self: c })),
          );
        },
        restart: () => {
          restarts += 1;
          restarted.release();
        },
      },
    });
    const base = `http://127.0.0.1:${httpPort()}`;
    await vi.waitFor(
      async () => {
        expect((await fetch(`${base}/health`)).status).toBe(200);
      },
      { timeout: 10_000 },
    );
    // Each stand-in is reached before the stepdown, so a zero after it is not a stand-in nobody calls.
    await vi.waitFor(
      () => {
        expect(outside.sweeps.length).toBeGreaterThan(0);
        expect(outside.reconciles.length).toBeGreaterThan(0);
      },
      { timeout: 10_000 },
    );

    const aeat = hold();
    releases.push(aeat.release);
    outside.holdSubmit = aeat.wait;
    const retry = await fetch(`${base}/management-api/fiscal-outbox/retry`, {
      method: "POST",
      headers: {
        cookie: adminCookie,
        origin: "https://dashboard.example",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(retry.status).toBe(200);
    await vi.waitFor(() => expect(outside.submits).toHaveLength(1), { timeout: 10_000 });

    const releaseCard = card!.holdNextCollect();
    releases.push(releaseCard);
    const workingOrderId = randomUUID();
    const paying = fetch(`${base}/api/pay`, {
      method: "POST",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        id: workingOrderId,
        zoneId: venue.zoneId,
        lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
      }),
    });
    await vi.waitFor(() => expect(card!.collectCalls).toHaveLength(1), { timeout: 10_000 });
    // A sweep held across the stepdown: its pass began before the stepdown, so any later sweep
    // is a pass the stopped loop should never have started.
    const sweep = hold();
    releases.push(sweep.release);
    outside.holdSweep = sweep.wait;
    await vi.waitFor(() => expect(outside.holdSweep).toBeNull(), { timeout: 10_000 });

    const before = {
      submitsBeforeStepdown: outside.submits.length,
      reconcilesBeforeStepdown: outside.reconciles.length,
      sweepsBeforeStepdown: outside.sweeps.length,
    };
    const stepdownAt = Date.now();
    const asked = await fetch(`${base}/test/stepdown`, { method: "POST" });
    const stepdown = { status: asked.status, body: await asked.json() };
    const afterBegan = await fetch(`${base}/api/pay`, {
      method: "POST",
      headers: { cookie: venue.cookie2, "content-type": "application/json" },
      body: JSON.stringify({
        id: randomUUID(),
        zoneId: venue.zoneId,
        lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
      }),
    });
    const refused = { status: afterBegan.status, body: await afterBegan.json() };

    aeat.release();
    sweep.release();
    // The held sale keeps the server up, so a drain pass or a card loop nobody stopped would
    // reach its stand-in in this window.
    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS));
    releaseCard();
    const paid = await within(paying, 10_000, "the held sale's answer");
    const sale = { status: paid.status, body: (await paid.json()) as Record<string, unknown> };
    await within(restarted.wait, 10_000, "the restart after the stepdown's close");
    // The stepdown closed the server before it restarted; reading the folder now is after close().
    const restriction = await readHandoverRestriction(suite.node, nodeId);
    const [{ n }] = suite.db.all<{ n: number }>(
      sql`select count(*) as n from sales where working_order_id = ${workingOrderId}`,
    ) as [{ n: number }];
    observed = {
      stepdown,
      refused,
      sale,
      salesForOrder: n,
      restarts,
      recordedAt: restriction!.recordedAt.getTime(),
      stepdownAt,
      ...before,
    };
  }, 120_000);

  afterAll(async () => {
    for (const release of releases) release();
    try {
      if (server !== undefined) await server.close();
    } finally {
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });

  const seen = (): Observed => {
    if (observed === undefined) throw new Error("the stepdown was not observed");
    return observed;
  };

  // Control, run locally and not committed: with the gate's close in `stepDown` replaced by
  // `tradingAdmission.requireRestart()`, this case fails with
  //   expected { error: { …(2) } } to not have property "error"
  // receiving { code: "venue.time_zone_not_ready", params: { reason: "restart_required" } }.
  // The sale's second transaction committing here is also the proof that the trading admission
  // still reads ready while the stepdown waits for admitted work.
  it("the sale admitted before the stepdown commits its second transaction", () => {
    expect(seen().sale.body).not.toHaveProperty("error");
    expect(seen().sale.status).toBe(200);
    expect(seen().sale.body.outcome).toBe("captured");
    expect(seen().salesForOrder).toBe(1);
  });

  it("a till request made after the stepdown began is refused handover.stepping_down", () => {
    expect(seen().refused).toEqual({
      status: 503,
      body: { error: { code: "handover.stepping_down", params: {} } },
    });
  });

  it("AEAT receives no second submission after the restriction is recorded", () => {
    expect(seen().submitsBeforeStepdown).toBe(1);
    expect(outside.submits).toHaveLength(1);
    expect(outside.submits.filter((at) => at >= seen().recordedAt)).toEqual([]);
  });

  // Control, run locally and not committed: with `signalDuties(deps.duties)` in `stepDown` made a
  // no-op, this case fails with
  //   expected [ 1793667767103, 1793667767309 ] to deeply equal []
  // (times vary) on the reconcile line: the held drain pass goes on to reconcile a due gap. With
  // that line removed, the sweep line fails the same way.
  it("the Stripe reconcile and the card sweep are not called after the stepdown began", () => {
    expect(seen().reconcilesBeforeStepdown).toBeGreaterThan(0);
    expect(seen().sweepsBeforeStepdown).toBeGreaterThan(0);
    expect(outside.reconciles.filter((at) => at >= seen().stepdownAt)).toEqual([]);
    expect(outside.sweeps.filter((at) => at >= seen().stepdownAt)).toEqual([]);
  });

  it("the request that asked for the stepdown received its answer, and the box restarts once", () => {
    expect(seen().stepdown).toEqual({ status: 200, body: { restarting: true, replayed: false } });
    expect(seen().restarts).toBe(1);
  });
});
