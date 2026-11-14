import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TLSSocket } from "node:tls";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import {
  insertReservedNodeTx,
  nodes,
  readNodeMembership,
  readTenant,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { HandoverBinding } from "@waitron/handover";
import { endorseKey, signDocumentBody } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules } from "@waitron/module";
import { readHandoverOperation, readNodeMode, recordHandoverRestrictionTx } from "@waitron/node-db";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { captureFinalCopy, finalCopyPath } from "./handover-capture.js";
import { compareFinalCopy } from "./handover-compare.js";
import { mountHandoverDestinationApi } from "./handover-destination-api.js";
import { receivedCopyPath } from "./handover-destination-duty.js";
import { createHandoverGate } from "./handover-gate.js";
import { mountHandoverSourceStartApi } from "./handover-source-start-api.js";
import { advanceHandover } from "./handover-store.js";
import { readModuleConfig } from "./module-config.js";
import { ALL_MODULES } from "./modules.js";
import { mountPeerStatusApi } from "./peer-status-api.js";
import { MAIN_URL, joinSpare, veriFactuMainBox } from "./testing/veri-factu-join.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const migrations = migrationOptionsFor(manifestSets(), null);
const mainBox = useVenueDb({ migrations, timeoutMs: 60_000 });
const spareBox = useVenueDb({ migrations, timeoutMs: 60_000 });

let mainState: string;
let spareState: string;
let socket: TLSSocket;

beforeEach(async () => {
  mainState = await mkdtemp(join(tmpdir(), "handover-two-main-"));
  spareState = await mkdtemp(join(tmpdir(), "handover-two-spare-"));
  socket = new TLSSocket(new Socket());
});
afterEach(async () => {
  socket.destroy();
  await rm(mainState, { recursive: true, force: true });
  await rm(spareState, { recursive: true, force: true });
});

/**
 * A main box and a spare on two separate databases, joined by the real bundle route and the real
 * `adoptFromPrimary`, with Veri*Factu switched on. It does not copy the venue, so the spare is given
 * by hand the taxpayer and the chart its first copy will bring (A947 3b's Task 6.3).
 */
async function joined() {
  const boxes = { mainBox, spareBox, mainState, spareState, ring: RING };
  const main = await veriFactuMainBox(boxes);
  const { modules, mainId, mainKey, session } = main;
  const { standby, spareId } = await joinSpare(boxes, main);
  expect((await readNodeMode(spareBox.node, spareId)).mode).toBe("mirror");

  await seedVenue(spareBox.db);
  const tenant = await readTenant(mainBox.db);
  await spareBox.db.run(
    sql`update tenants set country = ${tenant!.country}, tax_id = ${tenant!.taxId}`,
  );
  // Today's chart does not vouch for a joined box's key, so a real start answers
  // `destination_unreachable`; A947 3b's Tasks 4.4 and 5.4 add this endorsement.
  const { body: joinedChart } = (await readNodeMembership(mainBox.db))!;
  const body = { ...joinedChart, term: joinedChart.term + 1 };
  const vouching = {
    body,
    signerNodeId: mainId,
    signature: signDocumentBody(body, mainKey),
    endorsements: [endorseKey(spareId, standby.publicKey, mainId, mainKey)],
  };
  await writeNodeMembership(mainBox.db, vouching);
  await writeNodeMembership(spareBox.db, vouching);

  const spareApp = new Hono();
  const spareDeps = { db: spareBox.db, node: spareBox.node, ring: RING, nodeId: spareId };
  mountPeerStatusApi(spareApp, spareDeps, () => undefined);
  mountHandoverDestinationApi(
    spareApp,
    { ...spareDeps, stateDir: spareState, migrationsRoot: null },
    () => undefined,
  );

  const gate = createHandoverGate();
  const mainStore = { node: mainBox.node, nodeId: mainId };
  // Stands in for the real stepdown, which restarts the process.
  const stepDownAfterOffer = vi.fn(async (_c: unknown, binding: HandoverBinding) => {
    await advanceHandover(mainStore, binding.operationId, "source_stepped_down", {});
    await withNodeTransaction(mainBox.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId: mainId,
        operationId: binding.operationId,
        kind: "handed-over",
        successorNodeId: spareId,
        membershipTerm: binding.membership.term,
      }),
    );
  });
  const mainApp = new Hono();
  mainApp.use("*", gate.middleware);
  mountHandoverSourceStartApi(
    mainApp,
    {
      db: mainBox.db,
      node: mainBox.node,
      ring: RING,
      nodeId: mainId,
      stateDir: mainState,
      migrationsRoot: null,
      advertisedOrigin: MAIN_URL,
      venueCanPromote: true,
      gate,
      stepDownAfterOffer,
      peerTimeoutMs: 5000,
      fetch: ((url: string, init: RequestInit) =>
        spareApp.request(new URL(url).pathname, init)) as typeof fetch,
    },
    () => undefined,
  );
  mainApp.post("/sale", (c) => c.json({ sold: true }));

  const start = async () => {
    const response = await mainApp.request(
      "/management-api/handover",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${MANAGEMENT_COOKIE}=${session.token}`,
        },
        body: JSON.stringify({
          operationId: OP,
          destinationNodeId: spareId,
        }),
      },
      { incoming: { socket } },
    );
    return { status: response.status, body: await response.json() };
  };

  /** The spare's row in the main box's file as A947 3b's Task 6.2 plans it, on the key it sent. */
  const writeSpareRow = async () => {
    const [main] = await mainBox.db.select().from(nodes).where(eq(nodes.id, mainId));
    await withTransaction(mainBox.db, (tx) =>
      insertReservedNodeTx(tx, {
        id: spareId,
        name: `${main!.name} (standby)`,
        filingModule: main!.filingModule,
        taxModule: main!.taxModule,
        publicKey: standby.publicKey,
        endorsement: endorseKey(spareId, standby.publicKey, mainId, mainKey),
      }),
    );
  };

  const compareOnTheSpare = async () => {
    const indicator = await captureFinalCopy(
      {
        venue: mainBox.db,
        node: mainBox.node,
        stateDir: mainState,
        ring: RING,
        nodeId: mainId,
        modules,
      },
      OP,
    );
    const path = receivedCopyPath(spareState, OP);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(finalCopyPath(mainState, OP), path);
    return compareFinalCopy(
      {
        db: spareBox.db,
        node: spareBox.node,
        ring: RING,
        nodeId: spareId,
        stateDir: spareState,
        modules: enabledModules(ALL_MODULES, await readModuleConfig(spareBox.db)),
        migrationsRoot: null,
      },
      (await readHandoverOperation(spareBox.node, spareId, OP))!,
      indicator,
      path,
      { found: {} },
    );
  };

  return {
    mainId,
    spareId,
    gate,
    mainApp,
    start,
    writeSpareRow,
    compareOnTheSpare,
    stepDownAfterOffer,
  };
}

describe("a main box and a spare on two separate databases", () => {
  it("refuses while selling until the main box's file holds the spare's row, and then the copy is accepted", async () => {
    const boxes = await joined();

    // Failing case: 200 and a `prepared` row, with the copy later refused and the old box stopped.
    expect(await boxes.start()).toEqual({
      status: 409,
      body: {
        error: {
          code: "handover.destination_not_joined",
          params: { destinationNodeId: boxes.spareId },
        },
      },
    });
    expect(boxes.stepDownAfterOffer).not.toHaveBeenCalled();
    expect(boxes.gate.isClosed()).toBe(false);
    expect(await readHandoverOperation(mainBox.node, boxes.mainId, OP)).toBeNull();
    expect(await readHandoverOperation(spareBox.node, boxes.spareId, OP)).toBeNull();
    expect((await boxes.mainApp.request("/sale", { method: "POST" })).status).toBe(200);

    await boxes.writeSpareRow();
    const answer = await boxes.start();
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(boxes.stepDownAfterOffer).toHaveBeenCalledTimes(1);
    expect(await readHandoverOperation(spareBox.node, boxes.spareId, OP)).toMatchObject({
      state: "prepared",
    });
    expect(await boxes.compareOnTheSpare()).toEqual({ ok: true });
  }, 60_000);
});
