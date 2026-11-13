import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { stampDeployment, withTransaction, writeNodeMembership } from "@waitron/db";
import { seedDevice, seedNode, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb, type VenueDb } from "@waitron/db/testing/venue-db.js";
import { insertHandoverActivationTx } from "@waitron/handover";
import type { NodeStanding } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setNodeMode, setSingletonRole, writeMirrorLink } from "@waitron/node-db";
import {
  captureAttempting,
  insertAttempting,
  listAttempting,
  payments,
  type CollectionOwners,
} from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { decimal, deviceOrigin, type NodeId } from "@waitron/shared";
import type { StartedServer } from "./boot.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { establishNodeIdentity } from "./node-identity.js";
import { setupVenue } from "./testing/venue-fixtures.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const loop = vi.hoisted(() => ({ passesFinished: 0 }));

// A sweep that must not happen has no call to wait for, so every case waits for a whole pass of the
// pending-card loop, which holds the sweep, to finish.
vi.mock("./pending-card-recovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pending-card-recovery.js")>();
  return {
    ...actual,
    runPendingCardLoop: (...[deps]: Parameters<typeof actual.runPendingCardLoop>) =>
      actual.runPendingCardLoop({
        ...deps,
        pass: async (now) => {
          const report = await deps.pass(now);
          loop.passesFinished += 1;
          return report;
        },
      }),
  };
});

const { beforeServerStarts, startServer } = ephemeralServerFixture();

const migrations = migrationOptionsFor(manifestSets(), null);
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

interface Observed {
  /** How many times the sweep's one pass asked the provider about each payment. */
  calls: Record<string, number>;
  /** The state of each payment after the server closed, by name. */
  states: Record<string, string>;
}

function venueFile(suite: VenueDb): string {
  return suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
}

type BoxName = "own" | "first" | "second" | "bystander";

interface StartCase {
  /** Each earlier handover, as `[source, destination]`. */
  activations: readonly (readonly [BoxName, BoxName])[];
  /** The chart this box holds, naming `own` and `second`; no chart when absent. */
  chart?: { own: NodeStanding; second: NodeStanding };
  mirror?: boolean;
  localSecondary?: boolean;
}

/**
 * Registers, in the calling `describe`, one real start of a folder holding an open card payment for
 * this box, for two earlier boxes and for a bystander. A sweep reaches a stand-in provider through
 * the held Stripe credential, and the start runs until a pass of the pending-card loop has finished.
 */
function observeStart(options: StartCase): () => Observed {
  const suite = useVenueDb({ migrations, resetPerTest: false });
  let server: StartedServer | undefined;
  let scratch: string | undefined;
  let observed: Observed | undefined;

  beforeAll(async () => {
    beforeServerStarts();
    const venue = await setupVenue(suite.db);
    const box = venue.cfg.nodeId;
    const [first, second, bystander] = [
      await seedNode(suite.db),
      await seedNode(suite.db),
      await seedNode(suite.db),
    ];
    const { deviceId } = await seedDevice(suite.db);
    const order = await seedWorkingOrder(suite.db, { source: "device", deviceId });
    const owners: Record<BoxName, NodeId> = { own: box, first, second, bystander };
    await withTransaction(suite.db, async (tx) => {
      for (const [paymentRef, nodeId] of Object.entries(owners)) {
        await insertAttempting(tx, {
          origin: deviceOrigin(deviceId),
          workingOrderId: order.id,
          nodeId,
          provider: "stripe",
          paymentRef,
          amount: decimal("10.00"),
        });
      }
      for (const [source, destination] of options.activations) {
        await insertHandoverActivationTx(tx, {
          operationId: randomUUID(),
          scenario: "controlled",
          sourceNodeId: owners[source],
          destinationNodeId: owners[destination],
          evidence: {} as never,
          personId: randomUUID(),
          activatedAt: new Date().toISOString(),
        });
      }
    });
    if (options.chart !== undefined) {
      // A box its chart lists holds its signing key.
      await establishNodeIdentity(
        { ownerDb: suite.db, node: suite.node, ring: loadKeyRing(KEY_ENV) },
        box,
      );
      await writeNodeMembership(
        suite.db,
        signedMembershipDoc(1, {
          signerNodeId: second,
          nodes: [
            { nodeId: box, contactUrl: "https://own.example", standing: options.chart.own },
            {
              nodeId: second,
              contactUrl: "https://second.example",
              standing: options.chart.second,
            },
          ],
        }),
      );
    }
    const nodeHandles = { venue: suite.db, node: suite.node };
    await stampDeployment(suite.db, "preproduction");
    if (options.mirror === true) {
      await setNodeMode(nodeHandles, box, "mirror");
      await writeMirrorLink(suite.node, box, {
        originUrl: "https://127.0.0.1:1/",
        boxHostname: "box.test",
        boxCaPem: "unused",
        originNodeId: first,
      });
    }
    if (options.localSecondary === true) await setSingletonRole(nodeHandles, box, "secondary");
    const ring = loadKeyRing(KEY_ENV);
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        purpose: "payments.stripe",
        value: {
          secretKey: "sk_test_collection",
          webhookSecret: "whsec_collection",
          successUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/no",
        },
      }),
    );
    scratch = await mkdtemp(join(tmpdir(), "waitron-boot-handover-collection-"));
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
    const env: Record<string, string> = {
      ...KEY_ENV,
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
      WAITRON_STATE_DIR: scratch,
      WAITRON_VENUE_DIR: dirname(venueFile(suite)),
      WAITRON_NODE_ID: box,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
    };

    const calls: Record<string, number> = {};
    loop.passesFinished = 0;
    server = await startServer(env, env, {
      timings: { maxTickMs: 600000, minTickMs: 200 },
      peerCheck: () => Promise.resolve({ result: "proceed", successorNodeId: null }),
      cardPool: ({ db }) => {
        const card = new FakePaymentProvider(db);
        Object.defineProperty(card, "provider", { value: "stripe" });
        card.resolvePending = (async (now: Date, collection: CollectionOwners) => {
          const rows = await withTransaction(db, (tx) => listAttempting(tx, "stripe", collection));
          for (const { paymentRef } of rows) {
            calls[paymentRef] = (calls[paymentRef] ?? 0) + 1;
            await withTransaction(db, (tx) =>
              captureAttempting(tx, {
                provider: "stripe",
                paymentRef,
                settledAt: now,
                externalRef: `ext-${paymentRef}`,
              }),
            );
          }
          return { nextDueAt: null, forwarded: rows.length, declined: 0, incidentsRaised: 0 };
        }) as typeof card.resolvePending;
        return { get: () => Promise.resolve(card), evict: () => {} };
      },
    });
    await vi.waitFor(() => expect(loop.passesFinished).toBeGreaterThanOrEqual(1), {
      timeout: 20_000,
      interval: 100,
    });
    await server.close();
    server = undefined;
    const rows = await suite.db
      .select({ paymentRef: payments.paymentRef, state: payments.state })
      .from(payments);
    observed = {
      calls,
      states: Object.fromEntries(rows.map((row) => [row.paymentRef, row.state])),
    };
  }, 60_000);

  afterAll(async () => {
    try {
      if (server !== undefined) await server.close();
    } finally {
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });

  return () => {
    if (observed === undefined) throw new Error("the start was not observed");
    return observed;
  };
}

describe("a start of a box that took over from a box which took over from another", () => {
  const observed = observeStart({
    activations: [
      ["first", "second"],
      ["second", "own"],
    ],
  });

  it("sweeps its own and both earlier boxes' open payments, once each, and not a bystander's", () => {
    expect(observed().calls).toEqual({ own: 1, first: 1, second: 1 });
    expect(observed().states).toEqual({
      own: "captured",
      first: "captured",
      second: "captured",
      bystander: "attempting",
    });
  });
});

describe("control: the same folder with no activation rows", () => {
  const observed = observeStart({ activations: [] });

  it("sweeps only its own", () => {
    expect(observed().calls).toEqual({ own: 1 });
    expect(observed().states).toEqual({
      own: "captured",
      first: "attempting",
      second: "attempting",
      bystander: "attempting",
    });
  });
});

const OLD_BOX_HISTORY = [
  ["first", "own"],
  ["own", "second"],
] as const;

describe("an old box fenced by its held chart, with no restriction row", () => {
  const observed = observeStart({
    activations: OLD_BOX_HISTORY,
    chart: { own: "sell-only", second: "serving-primary" },
  });

  it("asks the provider about nothing, its own payments and earlier boxes' stay open", () => {
    expect(observed().calls).toEqual({});
    expect(observed().states).toEqual({
      own: "attempting",
      first: "attempting",
      second: "attempting",
      bystander: "attempting",
    });
  });
});

describe("control: the same history, with a chart that has this box healthy and primary", () => {
  const observed = observeStart({
    activations: OLD_BOX_HISTORY,
    chart: { own: "serving-primary", second: "serving-secondary" },
  });

  it("sweeps its own, and the box it took over from", () => {
    expect(observed().calls).toEqual({ own: 1, first: 1 });
  });
});

describe("a mirror before its activation, holding a payment naming itself", () => {
  const observed = observeStart({ activations: [["first", "second"]], mirror: true });

  it("asks the provider about nothing", () => {
    expect(observed().calls).toEqual({});
    expect(observed().states).toEqual({
      own: "attempting",
      first: "attempting",
      second: "attempting",
      bystander: "attempting",
    });
  });
});

describe("control: a local secondary with no chart fencing it", () => {
  const observed = observeStart({ activations: [], localSecondary: true });

  it("still sweeps its own", () => {
    expect(observed().calls).toEqual({ own: 1 });
  });
});
