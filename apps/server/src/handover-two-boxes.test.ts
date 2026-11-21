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
  readTaxpayer,
  openVenueDatabase,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { HandoverBinding } from "@waitron/handover";
import { endorseKey, routableServers } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules, type WaitronModule } from "@waitron/module";
import { readHandoverOperation, readHandoverRestriction, readNodeMode } from "@waitron/node-db";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { MODULE_RECORDS_DIR } from "@waitron/store";
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
import { removeStandby } from "./membership-removal.js";
import { mountMembershipRemovalApi } from "./membership-removal-api.js";
import { mountNodeMembershipApi } from "./node-membership-api.js";
import { mountPeerStatusApi } from "./peer-status-api.js";
import { mountReturnRecordsApi } from "./return-records-api.js";
import { runReturnRecordsPass } from "./return-records.js";
import { knownHandoverSuccessor } from "./start-peer-check.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { fiscalRows } from "./testing/fiscal-rows.js";
import {
  boxRequest,
  fiscalRowsOf,
  placeCopy,
  saleOn,
  takeoverRoutes,
} from "./testing/two-box-takeover.js";
import {
  ADMIN_PASSWORD,
  MAIN_URL,
  SPARE_URL,
  joinSpare,
  mirrorBundleApp,
  veriFactuMainBox,
} from "./testing/veri-factu-join.js";

// The new installation's name is chosen against these two clocks; the browser's is `Date.now()`.
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-time-service.js", () => ({
  observeTimeServiceHourClock: async () => ({
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
  const taxpayer = await readTaxpayer(mainBox.db);
  await spareBox.db.run(
    sql`update taxpayer set country = ${taxpayer!.country}, tax_id = ${taxpayer!.taxId}`,
  );
  await writeNodeMembership(spareBox.db, (await readNodeMembership(mainBox.db))!);

  const spareApp = new Hono();
  const spareDeps = { db: spareBox.db, node: spareBox.node, ring: RING, nodeId: spareId };
  mountPeerStatusApi(spareApp, spareDeps, () => undefined);
  mountHandoverDestinationApi(
    spareApp,
    { ...spareDeps, stateDir: spareState, venueDir: spareState, migrationsRoot: null },
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
      venueDir: dirname(mainBox.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file),
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

type OpenStore = Awaited<ReturnType<typeof openVenueDatabase>>;

/** The controlled handover of `joined()` carried through to the spare selling on its placed copy. */
async function controlledTakeover(
  waitUntil: (targetMs: number) => void,
  opened: Array<{ close(): Promise<void> }>,
) {
  const boxes = await joined();
  const { mainId, spareId } = boxes;
  await saleOn(mainBox.db, mainId);
  await boxes.writeSpareRow();
  const started = await boxes.start();
  expect(started.status, JSON.stringify(started.body)).toBe(200);
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
  const modules = enabledModules(ALL_MODULES, await readModuleConfig(spareBox.db));
  await takeoverRoutes({
    store: c,
    nodeId: spareId,
    sourceId: mainId,
    operationId: OP,
    stateDir: spareState,
    venueDir: cVenue,
    modules,
    ring: RING,
    signIn: { email: boxes.main.email, password: ADMIN_PASSWORD },
    waitUntil,
  }).takeOver();
  return { boxes, mainId, spareId, c, cVenue, modules };
}

/** The new main box's real receive route. */
function returnReceiver(store: OpenStore, nodeId: string, modules: readonly WaitronModule[]) {
  const receiver = new Hono();
  mountReturnRecordsApi(
    receiver,
    {
      db: store.venue,
      node: store.node,
      ring: RING,
      nodeId,
      modules,
      requireWritable: () => {},
      wake: () => {},
    },
    () => undefined,
  );
  return receiver;
}

/** The old box's real return pass, its posts answered by `receiver`. */
function oldBoxReturnPass(
  boxes: Awaited<ReturnType<typeof joined>>,
  receiver: Hono,
  sentTo: string[] = [],
) {
  return runReturnRecordsPass({
    db: mainBox.db,
    node: mainBox.node,
    ring: RING,
    nodeId: boxes.mainId,
    modules: boxes.main.modules,
    fetch: ((url: string, init: RequestInit) => {
      sentTo.push(url);
      return receiver.request(new URL(url).pathname, init);
    }) as typeof fetch,
    stopped: () => false,
  });
}

/**
 * A third box, both databases new, joins the main box `store` (whose id is `nodeId`) through the
 * real bundle route; the main box's file is given its row. `start` is the main box's real start
 * route, posting to the new spare's real peer status and destination routes.
 */
async function newSpareJoins(args: {
  store: OpenStore;
  nodeId: string;
  stateDir: string;
  venueDir: string;
  advertisedOrigin: string;
  email: string;
  sessionToken: string;
}) {
  const { store, nodeId } = args;
  const newState = join(scratch, "new-spare-state");
  await mkdir(newState);
  const joinedSpare = await joinSpare(
    { spareBox: resetBox, spareState: newState, ring: RING },
    {
      bundleApp: mirrorBundleApp(
        { db: store.venue, node: store.node, stateDir: args.stateDir, ring: RING },
        nodeId,
        args.advertisedOrigin,
      ),
      email: args.email,
    },
    { spareUrl: "https://new-spare.test" },
  );
  const newId = joinedSpare.spareId;
  // As in `joined()`: the taxpayer and the chart its first copy would bring.
  await seedVenue(resetBox.db);
  const taxpayer = await readTaxpayer(store.venue);
  await resetBox.db.run(
    sql`update taxpayer set country = ${taxpayer!.country}, tax_id = ${taxpayer!.taxId}`,
  );
  await writeNodeMembership(resetBox.db, (await readNodeMembership(store.venue))!);
  const key = await readNodeIdentityKey(store.node, RING, nodeId);
  const [row] = await store.venue.select().from(nodes).where(eq(nodes.id, nodeId));
  await withTransaction(store.venue, (tx) =>
    insertReservedNodeTx(tx, {
      id: newId,
      name: `${row!.name} (standby)`,
      filingModule: row!.filingModule,
      taxModule: row!.taxModule,
      publicKey: joinedSpare.standby.publicKey,
      endorsement: endorseKey(newId, joinedSpare.standby.publicKey, nodeId, key),
    }),
  );

  const newSpareApp = new Hono();
  const newSpareDeps = { db: resetBox.db, node: resetBox.node, ring: RING, nodeId: newId };
  mountPeerStatusApi(newSpareApp, newSpareDeps, () => undefined);
  mountHandoverDestinationApi(
    newSpareApp,
    { ...newSpareDeps, stateDir: newState, venueDir: newState, migrationsRoot: null },
    () => undefined,
  );
  const sourceApp = new Hono();
  mountHandoverSourceStartApi(
    sourceApp,
    {
      db: store.venue,
      node: store.node,
      ring: RING,
      nodeId,
      stateDir: args.stateDir,
      venueDir: args.venueDir,
      migrationsRoot: null,
      advertisedOrigin: args.advertisedOrigin,
      venueCanPromote: true,
      gate: createHandoverGate(),
      stepDownAfterOffer: async () => {},
      peerTimeoutMs: 5000,
      fetch: ((url: string, init: RequestInit) =>
        newSpareApp.request(new URL(url).pathname, init)) as typeof fetch,
    },
    () => undefined,
  );
  const start = async (operationId: string) => {
    // A following spare holds the main box's latest chart, as its copy would bring it.
    await writeNodeMembership(resetBox.db, (await readNodeMembership(store.venue))!);
    const response = await sourceApp.request(
      "/management-api/handover",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${MANAGEMENT_COOKIE}=${args.sessionToken}`,
        },
        body: JSON.stringify({ operationId, destinationNodeId: newId }),
      },
      { incoming: { socket } },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { newId, start };
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
  it("the spare sells and records invoices under its own installation; the old box, reset and joined again under a new id, takes over when the spare is switched off", async () => {
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
      const mainSale = await saleOn(mainBox.db, mainId);
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
      const modules = enabledModules(ALL_MODULES, await readModuleConfig(spareBox.db));
      const oldRows = await fiscalRowsOf(c.venue, mainId);
      const codes = (rows: Record<string, unknown[]>) =>
        (rows.invoice_series as Array<{ id: string; code: string }>).map(({ code }) => code);
      const seriesIds = (rows: Record<string, unknown[]>) =>
        (rows.invoice_series as Array<{ id: string }>).map(({ id }) => id);
      expect(codes(oldRows)).not.toEqual([]);
      expect(Object.values(oldRows).flat()).toContainEqual(mainSale.record);
      const servingPrimary = async (venue: typeof c.venue) =>
        routableServers(await readNodeMembership(venue)).find(
          ({ standing }) => standing === "serving-primary",
        );
      const contactUrlIn = async (venue: typeof c.venue, nodeId: string) =>
        (await readNodeMembership(venue))!.body.nodes.find((n) => n.nodeId === nodeId)!.contactUrl;
      const cUrl = await contactUrlIn(c.venue, spareId);
      expect(cUrl).not.toBe("");
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
      expect(await servingPrimary(c.venue)).toEqual({
        nodeId: spareId,
        url: cUrl,
        standing: "serving-primary",
      });
      const cRows = await fiscalRowsOf(c.venue, spareId);
      expect(codes(cRows)).not.toEqual([]);
      for (const code of codes(cRows)) expect(codes(oldRows)).not.toContain(code);
      expect(JSON.stringify(oldRows)).not.toContain(handedOver.identity);
      const cSale = await saleOn(c.venue, spareId);
      expect(seriesIds(cRows)).toContain(cSale.seriesId);
      expect(cSale.record).toMatchObject({ node_id: spareId });
      expect(cSale.installation).toMatchObject({ node_id: spareId });
      expect(Object.values(cSale.installation)).toContain(handedOver.identity);
      expect(await fiscalRowsOf(c.venue, mainId)).toEqual(oldRows);

      // The old box is reset (both databases new) and joins the new main box under a new id.
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
        { spareUrl: "https://reset.test" },
      );
      const newId = rejoined.spareId;
      expect(newId).not.toBe(mainId);
      expect(newId).not.toBe(spareId);
      expect((await readNodeMode(resetBox.node, newId)).mode).toBe("mirror");
      expect(await fiscalRows(c.venue)).toEqual(cFiscalAtJoin);
      for (const rows of Object.values(await fiscalRows(resetBox.db))) expect(rows).toEqual([]);
      expect(await readdir(resetState)).not.toContain(MODULE_RECORDS_DIR);

      // The main box's join duty writes the new box's row once its store answers (`spare-join.ts`);
      // here the test writes it. The mirror's copy of the venue is a vacuum of the main box's file.
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
      const bVenue = join(scratch, "b-venue");
      await mkdir(bVenue);
      c.venue.run(sql`vacuum into ${join(bVenue, "venue.db")}`);
      resetBox.node.run(sql`vacuum into ${join(bVenue, "node.db")}`);
      const b = await openVenueDatabase(bVenue);
      opened.push(b);
      const bFiscalAtCopy = await fiscalRows(b.venue);
      const bUrl = await contactUrlIn(b.venue, newId);
      expect(bUrl).not.toBe("");

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
        rpId: "box.test",
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
        expectedCopy: copy,
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
      expect(await servingPrimary(b.venue)).toEqual({
        nodeId: newId,
        url: bUrl,
        standing: "serving-primary",
      });
      const bRows = await fiscalRowsOf(b.venue, newId);
      for (const code of codes(bRows))
        expect([...codes(oldRows), ...codes(cRows)]).not.toContain(code);
      expect(JSON.stringify(bFiscalAtCopy)).not.toContain(tookOver.identity);
      const bSale = await saleOn(b.venue, newId);
      expect(seriesIds(bRows)).toContain(bSale.seriesId);
      expect(bSale.record).toMatchObject({ node_id: newId });
      expect(bSale.installation).toMatchObject({ node_id: newId });
      expect(Object.values(bSale.installation)).toContain(tookOver.identity);
      // Every fiscal row B's copy held before its takeover is still there, unchanged.
      const bFiscalAfter = await fiscalRows(b.venue);
      for (const [table, rows] of Object.entries(bFiscalAtCopy))
        for (const row of rows) expect(bFiscalAfter[table]).toContainEqual(row);
    } finally {
      for (const store of opened) await store.close();
    }
  }, 120_000);
});

describe("a former main box removed after its return arrived", () => {
  // A restricted start is run in boot.restricted-quiet.test.ts, and a carry-on refused
  // handover.known_handover in waiting-start.test.ts ("a box with a restriction refuses").
  it("the new main box removes it with no statement, and the old box's next start reads a restriction naming the successor", async () => {
    const realNow = Date.now();
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(realNow);
    const waitUntil = (targetMs: number) => vi.advanceTimersByTime(targetMs + 1 - Date.now());
    const opened: Array<{ close(): Promise<void> }> = [];
    try {
      const { boxes, mainId, spareId, c, modules } = await controlledTakeover(waitUntil, opened);

      const returned = await oldBoxReturnPass(boxes, returnReceiver(c, spareId, modules));
      expect(returned).toBe("confirmed");
      expect((await readHandoverOperation(c.node, spareId, OP))?.state).toBe("return_complete");

      const [person] = c.venue.all<{ id: string }>(
        sql`select id from persons where email = ${boxes.main.email}`,
      );
      const removal = await removeStandby(
        { db: c.venue, node: c.node, ring: RING, nodeId: spareId, log: () => undefined },
        { targetNodeId: mainId, personId: person!.id },
      );
      expect(removal.removed).toBe(true);
      expect(
        (await readNodeMembership(c.venue))!.body.nodes.find((n) => n.nodeId === mainId)?.standing,
      ).toBe("evicted");

      // The reads boot's restricted start and carry-on's refusal take.
      expect(await readHandoverRestriction(mainBox.node, mainId)).toMatchObject({
        successorNodeId: spareId,
      });
      expect(await knownHandoverSuccessor(mainBox.node, mainId)).toBe(spareId);
    } finally {
      for (const store of opened) await store.close();
    }
  }, 120_000);
});

const NEXT_OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("a controlled handover closed by the old box's return", () => {
  it.each([
    ["the new main box's chart reached the old box", true],
    ["the new main box's chart never reached the old box", false],
  ])(
    "%s: the old box's real pass closes the operation, and a handover to a newly joined spare is then accepted",
    async (_, chartPosted) => {
      const realNow = Date.now();
      vi.useFakeTimers({ toFake: ["Date", "performance"] });
      vi.setSystemTime(realNow);
      const waitUntil = (targetMs: number) => vi.advanceTimersByTime(targetMs + 1 - Date.now());
      const opened: Array<{ close(): Promise<void> }> = [];
      try {
        const { boxes, mainId, spareId, c, cVenue, modules } = await controlledTakeover(
          waitUntil,
          opened,
        );
        if (chartPosted) {
          const oldBox = new Hono();
          mountNodeMembershipApi(
            oldBox,
            { db: mainBox.db, node: mainBox.node, nodeId: mainId },
            () => undefined,
          );
          const posted = await oldBox.request("/api/node/membership", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ document: await readNodeMembership(c.venue) }),
          });
          expect(await posted.json()).toEqual({ accepted: true });
        }
        const heldMain = routableServers(await readNodeMembership(mainBox.db)).find(
          ({ standing }) => standing === "serving-primary",
        );
        expect(heldMain?.nodeId).toBe(chartPosted ? spareId : mainId);
        expect(await readHandoverRestriction(mainBox.node, mainId)).toMatchObject({
          successorNodeId: spareId,
        });

        const newSpare = await newSpareJoins({
          store: c,
          nodeId: spareId,
          stateDir: spareState,
          venueDir: cVenue,
          advertisedOrigin: SPARE_URL,
          email: boxes.main.email,
          sessionToken: boxes.main.session.token,
        });
        expect(await newSpare.start(NEXT_OP)).toMatchObject({
          status: 409,
          body: { error: { code: "handover.return_outstanding" } },
        });

        const sentTo: string[] = [];
        expect(await oldBoxReturnPass(boxes, returnReceiver(c, spareId, modules), sentTo)).toBe(
          "confirmed",
        );
        expect(sentTo).not.toEqual([]);
        for (const url of sentTo)
          expect(new URL(url)).toMatchObject({
            host: new URL(SPARE_URL).host,
            port: "",
            pathname: "/api/node/return-records",
          });
        expect(await readHandoverOperation(c.node, spareId, OP)).toMatchObject({
          scenario: "controlled",
          state: "return_complete",
        });

        const next = await newSpare.start(NEXT_OP);
        expect(next.status, JSON.stringify(next.body)).toBe(200);
        expect(await readHandoverOperation(resetBox.node, newSpare.newId, NEXT_OP)).toMatchObject({
          state: "prepared",
        });
      } finally {
        for (const store of opened) await store.close();
      }
    },
    120_000,
  );
});

describe("the owner's case: an emergency switch while the old main box stays off", () => {
  it("Will not return closes the operation, Remove needs the reset statement, and a handover to a newly joined spare is accepted", async () => {
    const realNow = Date.now();
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(realNow);
    const waitUntil = (targetMs: number) => vi.advanceTimersByTime(targetMs + 1 - Date.now());
    const opened: Array<{ close(): Promise<void> }> = [];
    try {
      const boxes = await joined();
      const { mainId, spareId } = boxes;
      const signIn = { email: boxes.main.email, password: ADMIN_PASSWORD };
      await saleOn(mainBox.db, mainId);
      await boxes.writeSpareRow();
      // The spare's copy of the venue is a vacuum of the main box's file.
      const bVenue = join(scratch, "b-venue");
      await mkdir(bVenue);
      mainBox.db.run(sql`vacuum into ${join(bVenue, "venue.db")}`);
      spareBox.node.run(sql`vacuum into ${join(bVenue, "node.db")}`);
      const b = await openVenueDatabase(bVenue);
      opened.push(b);
      const modules = enabledModules(ALL_MODULES, await readModuleConfig(b.venue));

      const declaration = new Hono();
      const emergency = mountHandoverEmergencyApi(declaration, {
        db: b.venue,
        node: b.node,
        nodeId: spareId,
        ring: RING,
        stateDir: spareState,
        venueDir: bVenue,
        modules,
        origin: "https://box.test",
        rpId: "box.test",
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
        expectedCopy: copy,
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
      await takeoverRoutes({
        store: b,
        nodeId: spareId,
        sourceId: mainId,
        operationId: EMERGENCY_OP,
        stateDir: spareState,
        venueDir: bVenue,
        modules,
        ring: RING,
        signIn,
        emergency,
        waitUntil,
      }).takeOver();
      expect(await readHandoverOperation(b.node, spareId, EMERGENCY_OP)).toMatchObject({
        scenario: "emergency",
        state: "activated",
      });

      const servers = new Hono();
      mountMembershipRemovalApi(
        servers,
        {
          db: b.venue,
          node: b.node,
          ring: RING,
          nodeId: spareId,
          reloadStream: async () => {},
        },
        () => undefined,
      );
      const serversRequest = async (path: string, body: unknown) => {
        const response = await servers.request(path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `${MANAGEMENT_COOKIE}=${boxes.main.session.token}`,
          },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: (await response.json()) as unknown };
      };
      const remove = `/management-api/servers/${mainId}/remove`;

      const newSpare = await newSpareJoins({
        store: b,
        nodeId: spareId,
        stateDir: spareState,
        venueDir: bVenue,
        advertisedOrigin: SPARE_URL,
        email: boxes.main.email,
        sessionToken: boxes.main.session.token,
      });
      expect(await newSpare.start(NEXT_OP)).toMatchObject({
        status: 409,
        body: { error: { code: "handover.return_outstanding" } },
      });
      expect((await readHandoverOperation(b.node, spareId, EMERGENCY_OP))?.state).toBe("activated");

      const abandoned = await serversRequest(`/management-api/servers/${mainId}/return-abandoned`, {
        confirmed: true,
      });
      expect(abandoned).toEqual({
        status: 200,
        body: { operationId: EMERGENCY_OP, state: "return_abandoned" },
      });
      expect((await readHandoverOperation(b.node, spareId, EMERGENCY_OP))?.state).toBe(
        "return_abandoned",
      );

      expect(await serversRequest(remove, {})).toMatchObject({
        status: 409,
        body: { error: { code: "membership.reset_statement_required" } },
      });
      const removed = await serversRequest(remove, { resetStatement: true });
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      expect(removed.body).toMatchObject({ removed: true });
      expect(
        (await readNodeMembership(b.venue))!.body.nodes.find((n) => n.nodeId === mainId)?.standing,
      ).toBe("evicted");

      const next = await newSpare.start(NEXT_OP);
      expect(next.status, JSON.stringify(next.body)).toBe(200);
      expect(await readHandoverOperation(resetBox.node, newSpare.newId, NEXT_OP)).toMatchObject({
        state: "prepared",
      });
    } finally {
      for (const store of opened) await store.close();
    }
  }, 120_000);
});
