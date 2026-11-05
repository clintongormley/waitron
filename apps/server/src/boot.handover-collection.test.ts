import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import { seedDevice, seedNode, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb, type VenueDb } from "@waitron/db/testing/venue-db.js";
import { insertHandoverActivationTx } from "@waitron/handover";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
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
import { setupVenue } from "./testing/venue-fixtures.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
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

/**
 * Registers, in the calling `describe`, one real start of a folder holding an open card payment for
 * this box, for two earlier boxes and for a bystander. The sweep reaches a stand-in provider through
 * the held Stripe credential, and the start runs until the sweep has passed once.
 */
function observeStart(options: { tookOver: boolean }): () => Observed {
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
    const owners: Record<string, NodeId> = { own: box, first, second, bystander };
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
      if (!options.tookOver) return;
      for (const [sourceNodeId, destinationNodeId] of [
        [first, second],
        [second, box],
      ] as const) {
        await insertHandoverActivationTx(tx, {
          operationId: randomUUID(),
          scenario: "controlled",
          sourceNodeId,
          destinationNodeId,
          evidence: {} as never,
          personId: randomUUID(),
          activatedAt: new Date().toISOString(),
        });
      }
    });
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
      WAITRON_MAX_TICK_MS: "600000",
      WAITRON_MIN_TICK_MS: "200",
      WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
    };

    const calls: Record<string, number> = {};
    let sweeps = 0;
    server = await startServer(env, env, {
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
          sweeps += 1;
          return { nextDueAt: null, forwarded: rows.length, declined: 0, incidentsRaised: 0 };
        }) as typeof card.resolvePending;
        return { get: () => Promise.resolve(card), evict: () => {} };
      },
    });
    await vi.waitFor(() => expect(sweeps).toBeGreaterThanOrEqual(1), {
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
  const observed = observeStart({ tookOver: true });

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
  const observed = observeStart({ tookOver: false });

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
