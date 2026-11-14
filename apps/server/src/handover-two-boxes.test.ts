import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TLSSocket } from "node:tls";
import { eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import {
  insertReservedNodeTx,
  nodes,
  readNodeMembership,
  readTenant,
  openVenueDatabase,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { HandoverBinding } from "@waitron/handover";
import { endorseKey, signDocumentBody } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules } from "@waitron/module";
import { readHandoverOperation, readNodeMode } from "@waitron/node-db";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { MODULE_PREPARATION_STATE_FILE } from "@waitron/store";
import {
  acceptFinalCopy,
  readStoredAcceptance,
  verifiedRelinquishment,
} from "./handover-acceptance.js";
import { captureFinalCopy, finalCopyPath } from "./handover-capture.js";
import { compareFinalCopy } from "./handover-compare.js";
import { mountHandoverDestinationApi } from "./handover-destination-api.js";
import { receivedCopyPath } from "./handover-destination-duty.js";
import { mountHandoverEmergencyApi } from "./handover-emergency-api.js";
import { createHandoverGate } from "./handover-gate.js";
import { mountHandoverSourceApi } from "./handover-source-api.js";
import { mountHandoverSourceStartApi } from "./handover-source-start-api.js";
import { stepDown } from "./handover-stepdown.js";
import { advanceHandover } from "./handover-store.js";
import { readModuleConfig } from "./module-config.js";
import { ALL_MODULES } from "./modules.js";
import { readNodeIdentityKey } from "./node-identity.js";
import { mountPeerStatusApi } from "./peer-status-api.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import {
  boxRequest,
  filingOf,
  fiscalRows,
  placeCopy,
  saleOn,
  takeoverRoutes,
} from "./testing/two-box-takeover.js";
import {
  ADMIN_PASSWORD,
  MAIN_URL,
  SPARE_URL,
  holdBoxSecrets,
  joinSpare,
  mirrorBundleApp,
  veriFactuMainBox,
} from "./testing/veri-factu-join.js";

// The new installation's name is chosen against these two clocks; the browser's is `Date.now()`.
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMERGENCY_OP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const migrations = migrationOptionsFor(manifestSets(), null);
const mainBox = useVenueDb({ migrations, timeoutMs: 60_000 });
const spareBox = useVenueDb({ migrations, timeoutMs: 60_000 });
/** The formerly serving box after its reset: both databases new. */
const resetBox = useVenueDb({ migrations, timeoutMs: 60_000 });

let mainState: string;
let spareState: string;
let scratch: string;
let socket: TLSSocket;

beforeEach(async () => {
  mainState = await mkdtemp(join(tmpdir(), "handover-two-main-"));
  spareState = await mkdtemp(join(tmpdir(), "handover-two-spare-"));
  scratch = await mkdtemp(join(tmpdir(), "handover-two-scratch-"));
  socket = new TLSSocket(new Socket());
});
afterEach(async () => {
  socket.destroy();
  await rm(mainState, { recursive: true, force: true });
  await rm(spareState, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
  vi.useRealTimers();
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
  // The real stepdown; the restart it asks for is not run.
  const stepDownAfterOffer = vi.fn(async (self: Context, binding: HandoverBinding) => {
    await stepDown(
      {
        ...mainStore,
        gate,
        duties: { aborts: [], closers: [] },
        close: async () => {},
        restart: () => {},
        log: () => {},
      },
      { binding, kind: "handed-over", self },
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

  const captureAndCompare = async () => {
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
    const outcome = await compareFinalCopy(
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
    return { outcome, indicator, path };
  };
  const compareOnTheSpare = async () => (await captureAndCompare()).outcome;

  /**
   * The destination duty's steps after the download: the real compare and acceptance, its post of
   * the acceptance to the stepped-down box's real source route, and the relinquishment that answer
   * carries. The transfer is the in-process copy `captureAndCompare` makes.
   */
  const acceptOnTheSpare = async () => {
    const { outcome, indicator, path } = await captureAndCompare();
    expect(outcome).toEqual({ ok: true });
    const spareStore = { db: spareBox.db, node: spareBox.node, ring: RING, nodeId: spareId };
    await acceptFinalCopy(
      { ...spareStore, stateDir: spareState },
      (await readHandoverOperation(spareBox.node, spareId, OP))!,
      indicator,
      path,
    );
    const steppedDown = new Hono();
    mountHandoverSourceApi(
      steppedDown,
      {
        venue: mainBox.db,
        node: mainBox.node,
        ring: RING,
        nodeId: mainId,
        stateDir: mainState,
        modules,
      },
      () => undefined,
    );
    const acceptance = await readStoredAcceptance(spareStore, OP);
    const answer = await steppedDown.request(`/api/node/handover/${OP}/acceptance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: acceptance,
    });
    const text = await answer.text();
    expect(answer.status, text).toBe(200);
    const operation = (await readHandoverOperation(spareBox.node, spareId, OP))!;
    const relinquishment = await verifiedRelinquishment(spareStore, operation, acceptance, text);
    expect(relinquishment).not.toBeNull();
    await advanceHandover(spareStore, OP, "filing_assumed", {}, relinquishment!);
  };

  return {
    main,
    mainId,
    spareId,
    standby,
    gate,
    mainApp,
    start,
    writeSpareRow,
    compareOnTheSpare,
    acceptOnTheSpare,
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

describe("a controlled handover to the joined spare, then the old box back by emergency switch", () => {
  it("the spare sells and files under its own installation; the old box, reset and joined again under a new id, takes over when the spare is switched off", async () => {
    const realNow = Date.now();
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(realNow);
    const waitUntil = (targetMs: number) => vi.advanceTimersByTime(targetMs + 1 - Date.now());
    const opened: Array<{ close(): Promise<void> }> = [];
    try {
      // Controlled handover: the real start, stepdown, acceptance and relinquishment.
      const boxes = await joined();
      const { mainId, spareId } = boxes;
      const signIn = { email: boxes.main.email, password: ADMIN_PASSWORD };
      await boxes.writeSpareRow();
      const started = await boxes.start();
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      expect((await boxes.mainApp.request("/sale", { method: "POST" })).status).not.toBe(200);
      await boxes.acceptOnTheSpare();
      const cVenue = join(scratch, "c-venue");
      await mkdir(cVenue);
      const c = await placeCopy({
        spare: { venue: spareBox.db, node: spareBox.node },
        venueDir: cVenue,
        stateDir: spareState,
        nodeId: spareId,
        operationId: OP,
      });
      opened.push(c);
      const modules = enabledModules(ALL_MODULES, await readModuleConfig(spareState));
      const oldFiling = await filingOf(c.venue, mainId);
      expect(oldFiling.installations).toHaveLength(1);
      const handedOver = await takeoverRoutes({
        store: c,
        nodeId: spareId,
        sourceId: mainId,
        operationId: OP,
        stateDir: spareState,
        venueDir: cVenue,
        modules,
        ring: RING,
        signIn,
        waitUntil,
      }).takeOver();
      expect((await readNodeMode(c.node, spareId)).mode).toBe("primary");
      const cFiling = await filingOf(c.venue, spareId);
      expect(cFiling.installations.map(({ name }) => name)).toEqual([handedOver.identity]);
      expect(handedOver.identity).not.toBe(oldFiling.installations[0]!.name);
      for (const { code } of cFiling.series)
        expect(oldFiling.series.map((row) => row.code)).not.toContain(code);
      const cSale = await saleOn(c.venue, spareId);
      expect(cFiling.series.map(({ id }) => id)).toContain(cSale.seriesId);
      expect(cSale.record).toMatchObject({
        nodeId: spareId,
        sifId: cFiling.installations[0]!.id,
      });
      expect(await filingOf(c.venue, mainId)).toEqual(oldFiling);

      // The old box is reset (both databases new) and joins the new main box under a new id.
      await holdBoxSecrets(spareState);
      const resetState = join(scratch, "reset-state");
      await mkdir(resetState);
      const cBundle = mirrorBundleApp(
        { db: c.venue, node: c.node, stateDir: spareState, ring: RING },
        spareId,
        SPARE_URL,
      );
      const cFiscalAtJoin = await fiscalRows(c.venue);
      const rejoined = await joinSpare(
        { spareBox: resetBox, spareState: resetState, ring: RING },
        { bundleApp: cBundle, email: boxes.main.email },
        { primaryUrl: SPARE_URL, spareUrl: "https://reset.test" },
      );
      const newId = rejoined.spareId;
      expect(newId).not.toBe(mainId);
      expect(newId).not.toBe(spareId);
      expect((await readNodeMode(resetBox.node, newId)).mode).toBe("mirror");
      expect(await fiscalRows(c.venue)).toEqual(cFiscalAtJoin);
      for (const rows of Object.values(await fiscalRows(resetBox.db))) expect(rows).toEqual([]);
      expect(await readdir(resetState)).not.toContain(MODULE_PREPARATION_STATE_FILE);

      // Stand-ins, as `joined` has them for the first join: the new box's row and the chart
      // vouching for its key; then its mirror copy of the venue.
      const cKey = await readNodeIdentityKey(c.node, RING, spareId);
      const [cRow] = await c.venue.select().from(nodes).where(eq(nodes.id, spareId));
      await withTransaction(c.venue, (tx) =>
        insertReservedNodeTx(tx, {
          id: newId,
          name: `${cRow!.name} (standby)`,
          filingModule: cRow!.filingModule,
          taxModule: cRow!.taxModule,
          publicKey: rejoined.standby.publicKey,
          endorsement: endorseKey(newId, rejoined.standby.publicKey, spareId, cKey),
        }),
      );
      const { body: cChart } = (await readNodeMembership(c.venue))!;
      const chartBody = { ...cChart, term: cChart.term + 1 };
      await writeNodeMembership(c.venue, {
        body: chartBody,
        signerNodeId: spareId,
        signature: signDocumentBody(chartBody, cKey),
        endorsements: [endorseKey(newId, rejoined.standby.publicKey, spareId, cKey)],
      });
      const cFiscalAtSwitchOff = await fiscalRows(c.venue);
      const bVenue = join(scratch, "b-venue");
      await mkdir(bVenue);
      c.venue.run(sql`vacuum into ${join(bVenue, "venue.db")}`);
      resetBox.node.run(sql`vacuum into ${join(bVenue, "node.db")}`);
      const b = await openVenueDatabase(bVenue);
      opened.push(b);
      const cChainOnB = await filingOf(b.venue, spareId);

      // C is switched off; B declares the emergency and takes over on the copy it holds.
      const declaration = new Hono();
      const emergency = mountHandoverEmergencyApi(declaration, {
        db: b.venue,
        node: b.node,
        nodeId: newId,
        ring: RING,
        stateDir: resetState,
        venueDir: bVenue,
        modules,
        origin: "https://box.test",
        credentialKeyRing: TOTP_KEY_RING,
        fetch: async () => {
          throw Object.assign(new Error("switched off"), { code: "ECONNREFUSED" });
        },
      });
      const preview = await boxRequest(declaration, "/api/node/handover/emergency/preview", {
        signIn,
      });
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      const { copy } = preview.body as { copy: { identifier: string; lastChangeAtMs: number } };
      const declared = await boxRequest(declaration, "/api/node/handover/emergency/declare", {
        operationId: EMERGENCY_OP,
        expectedCopy: { identifier: copy.identifier, lastChangeAtMs: copy.lastChangeAtMs },
        signIn,
        statements: {
          sourceSwitchedOff: true,
          noParallelRecovery: true,
          missingTailAccepted: true,
        },
        reason: "The main box is switched off",
        locale: "en",
      });
      expect(declared.status, JSON.stringify(declared.body)).toBe(200);
      const tookOver = await takeoverRoutes({
        store: b,
        nodeId: newId,
        sourceId: spareId,
        operationId: EMERGENCY_OP,
        stateDir: resetState,
        venueDir: bVenue,
        modules,
        ring: RING,
        signIn,
        emergency,
        waitUntil,
      }).takeOver();
      expect((await readNodeMode(b.node, newId)).mode).toBe("primary");
      const bFiling = await filingOf(b.venue, newId);
      expect(bFiling.installations.map(({ name }) => name)).toEqual([tookOver.identity]);
      expect([handedOver.identity, oldFiling.installations[0]!.name]).not.toContain(
        tookOver.identity,
      );
      const bSale = await saleOn(b.venue, newId);
      expect(bFiling.series.map(({ id }) => id)).toContain(bSale.seriesId);
      expect(bSale.record).toMatchObject({ nodeId: newId, sifId: bFiling.installations[0]!.id });
      expect(await filingOf(b.venue, spareId)).toEqual(cChainOnB);
      expect(await fiscalRows(c.venue)).toEqual(cFiscalAtSwitchOff);
    } finally {
      for (const store of opened) await store.close();
    }
  }, 120_000);
});
