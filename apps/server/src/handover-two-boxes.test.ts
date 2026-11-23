import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TLSSocket } from "node:tls";
import { unzipSync } from "fflate";
import { eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import {
  devices,
  insertReservedNodeTx,
  liveBackupQuery,
  nodes,
  readNodeMembership,
  readTaxpayer,
  openVenueDatabase,
  readDeploymentEnvironment,
  recordActivity,
  withTransaction,
  type DeploymentEnvironment,
  writeNodeMembership,
} from "@waitron/db";
import {
  seedDevice,
  seedDeviceProfiles,
  seedKitchenStation,
  seedVenue,
} from "@waitron/db/testing/seed.js";
import { seedFiredOrder } from "@waitron/reporting/test/fixtures.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { HandoverBinding } from "@waitron/handover";
import { endorseKey, routableServers } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules, type WaitronModule } from "@waitron/module";
import { readHandoverOperation, readHandoverRestriction, readNodeMode } from "@waitron/node-db";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { nodeId as asNodeId } from "@waitron/shared";
import { MODULE_RECORDS_DIR, REPLACED_RESET_FILE } from "@waitron/store";
import { mountDeviceApi } from "./device-api.js";
import { DEVICE_COOKIE } from "./device-session.js";
import {
  acceptFinalCopy,
  readStoredAcceptance,
  verifiedRelinquishment,
} from "./handover-acceptance.js";
import { captureFinalCopy, finalCopyPath } from "./handover-capture.js";
import { compareFinalCopy } from "./handover-compare.js";
import { latestChangeAtMsFromMaxima } from "./handover-emergency-check.js";
import { mountHandoverDestinationApi } from "./handover-destination-api.js";
import { receivedCopyPath } from "./handover-destination-duty.js";
import { mountHandoverEmergencyApi } from "./handover-emergency-api.js";
import { createHandoverGate } from "./handover-gate.js";
import { mountHandoverSourceApi } from "./handover-source-api.js";
import { mountHandoverSourceStartApi } from "./handover-source-start-api.js";
import { stepDown } from "./handover-stepdown.js";
import { advanceHandover } from "./handover-store.js";
import { loadBoxEnv } from "./box-env.js";
import { BOX_LEAF_HOSTNAMES } from "./box-name.js";
import { ensureBoxSecrets, ensureLeaf, reissueBoxLeaf } from "./box-secrets.js";
import { loadConfig } from "./config.js";
import { readModuleConfig } from "./module-config.js";
import { runEntry } from "./node-entry.js";
import { FRESH, type RecoveryState } from "./recovery-state.js";
import { mountResetOrderApi } from "./reset-order-api.js";
import { ASK_AFTER_REFUSAL_MS, startResetOrderDuty } from "./reset-order-duty.js";
import { ALL_MODULES } from "./modules.js";
import { OLD_BOX_DATA_WORDS } from "./i18n/old-box-data.js";
import { sinceRule } from "./old-box-data-since.js";
import { buildOldBoxWorkbook } from "./old-box-data-workbook.js";
import { readNodeIdentityKey } from "./node-identity.js";
import { listServers, removeStandby } from "./membership-removal.js";
import { mountMembershipRemovalApi } from "./membership-removal-api.js";
import { mountNodeMembershipApi } from "./node-membership-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { mountPeerStatusApi } from "./peer-status-api.js";
import { mountReturnRecordsApi } from "./return-records-api.js";
import { runReturnRecordsPass } from "./return-records.js";
import { knownHandoverSuccessor, recordSupersededAtStart } from "./start-peer-check.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { fiscalRows } from "./testing/fiscal-rows.js";
import { row, sheetNamed } from "./testing/xlsx-rows.js";
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
import type { TradingContext } from "./trading-context.js";

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
async function joined(environment: DeploymentEnvironment = "preproduction") {
  const boxes = { mainBox, spareBox, mainState, spareState, ring: RING };
  const main = await veriFactuMainBox(boxes, environment);
  const { modules, mainId, mainKey, session } = main;
  const { standby, spareId } = await joinSpare(boxes, main, { environment });
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

/** The spare declares an emergency switch on a copy of the main box's file and takes over. */
async function emergencyTakeover(
  boxes: Awaited<ReturnType<typeof joined>>,
  waitUntil: (targetMs: number) => void,
  opened: Array<{ close(): Promise<void> }>,
) {
  const { mainId, spareId } = boxes;
  const signIn = { email: boxes.main.email, password: ADMIN_PASSWORD };
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
  return { b, bVenue, modules };
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

/** A sale on the main box of `boxes`, then an emergency switch to its spare while the main box is off. */
async function emergencySwitch(
  boxes: Awaited<ReturnType<typeof joined>>,
  waitUntil: (targetMs: number) => void,
  opened: Array<{ close(): Promise<void> }>,
) {
  await saleOn(mainBox.db, boxes.mainId);
  await boxes.writeSpareRow();
  return emergencyTakeover(boxes, waitUntil, opened);
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
 * After `emergencySwitch`, the old box comes back on: its start check finds itself superseded,
 * saves the newer chart and records the restriction its restricted start reads. Returns the new
 * main box's real return and reset-order routes (`newMain`) and a signed-in request to its real
 * Servers routes.
 */
async function oldBoxBackRestricted(
  boxes: Awaited<ReturnType<typeof joined>>,
  b: OpenStore,
  modules: readonly WaitronModule[],
) {
  const { mainId, spareId } = boxes;
  const oldBox = new Hono();
  mountNodeMembershipApi(
    oldBox,
    { db: mainBox.db, node: mainBox.node, nodeId: mainId },
    () => undefined,
  );
  const posted = await oldBox.request("/api/node/membership", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ document: await readNodeMembership(b.venue) }),
  });
  expect(await posted.json()).toEqual({ accepted: true });
  await recordSupersededAtStart(
    { node: mainBox.node, nodeId: mainId },
    spareId,
    (await readNodeMembership(mainBox.db))!.body.term,
  );

  const newMain = returnReceiver(b, spareId, modules);
  mountResetOrderApi(
    newMain,
    {
      db: b.venue,
      node: b.node,
      ring: RING,
      nodeId: spareId,
      modules,
      reloadStream: async () => {},
    },
    () => undefined,
  );
  const servers = new Hono();
  mountMembershipRemovalApi(
    servers,
    { db: b.venue, node: b.node, ring: RING, nodeId: spareId, reloadStream: async () => {} },
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
  return { newMain, serversRequest };
}

/**
 * The old box set up as a production box, serving its own leaf under its authority, then its
 * restricted start's real reset-order duty, asking `newMain`. Waits until `end` settles or 20
 * seconds pass, then stops the duty.
 */
async function runOldBoxDuty(
  boxes: Awaited<ReturnType<typeof joined>>,
  newMain: Hono,
  options: {
    end: Promise<void>;
    restart: () => void;
    fetch?: typeof fetch;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    returnPass?: () => Promise<unknown>;
    endName: string;
  },
) {
  const leaf = { stateDir: mainState, hostnames: BOX_LEAF_HOSTNAMES, now: () => new Date() };
  await reissueBoxLeaf({ ...leaf, listIpv4: () => [] });
  await ensureLeaf({ ...leaf, listIpv4: () => [] });
  await ensureBoxSecrets(leaf);
  await writeFile(
    join(mainState, "trading.env"),
    `WAITRON_ENV=production\nWAITRON_NODE_ID=${boxes.mainId}\n`,
  );
  const logged: string[] = [];
  const duty = startResetOrderDuty({
    db: mainBox.db,
    node: mainBox.node,
    ring: RING,
    nodeId: boxes.mainId,
    modules: boxes.main.modules,
    stateDir: mainState,
    venueDir: dirname(mainBox.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file),
    returnPass: options.returnPass ?? (() => oldBoxReturnPass(boxes, newMain)),
    fetch:
      options.fetch ??
      (((url: string, init: RequestInit) =>
        newMain.request(new URL(url).pathname, init)) as typeof fetch),
    log: (...line) => logged.push(JSON.stringify(line)),
    restart: options.restart,
    // The duty's waits move the test's clock.
    sleep:
      options.sleep ??
      (async (ms) => {
        vi.advanceTimersByTime(ms);
        await new Promise((resolve) => setImmediate(resolve));
      }),
  });
  let deadline: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      options.end,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () =>
            reject(new Error(`the duty never ${options.endName}; it logged ${logged.join(" ")}`)),
          20_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(deadline);
    await duty.stop();
  }
  return {
    logged,
    answer: duty.answer(),
    mainHoldings: duty.mainHoldings(),
    mainCopy: duty.mainCopy(),
  };
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
      await saleOn(mainBox.db, mainId);
      await boxes.writeSpareRow();
      const { b, bVenue } = await emergencyTakeover(boxes, waitUntil, opened);
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

  it("a till enrolled on the main box still signs in on the box that took over after an emergency switch", async () => {
    const realNow = Date.now();
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(realNow);
    const waitUntil = (targetMs: number) => vi.advanceTimersByTime(targetMs + 1 - Date.now());
    const opened: Array<{ close(): Promise<void> }> = [];
    try {
      const boxes = await joined();
      const { mainId, spareId } = boxes;
      await saleOn(mainBox.db, mainId);
      await boxes.writeSpareRow();
      const cfgOn = (id: string): TradingContext => ({
        nodeId: asNodeId(id),
        locale: "es-ES",
        simplifiedInvoiceLimit: null,
      });
      const [profile] = await seedDeviceProfiles(mainBox.db, {
        name: "Bar till",
        formFactor: "till",
        capabilities: ["take-orders"],
      });
      const enrolled = await enrolDeviceForTest(mainBox.db, cfgOn(mainId), {
        name: "Bar till",
        profileId: profile!.id,
      });
      const cookie = `${DEVICE_COOKIE}=${enrolled.deviceId}.${enrolled.token}`;
      const wrongToken = `${DEVICE_COOKIE}=${enrolled.deviceId}.not-the-token`;
      const me = async (db: typeof mainBox.db, deviceCookie: string) => {
        const app = new Hono();
        mountDeviceApi(
          app,
          { db, cfg: cfgOn(spareId), secureCookies: true, pairingMode: createPairingMode() },
          () => {},
        );
        const response = await app.request("https://waitron.local/api/device/me", {
          headers: { cookie: deviceCookie },
        });
        return { status: response.status, body: (await response.json()) as unknown };
      };
      const signedIn = {
        status: 200,
        body: {
          deviceId: enrolled.deviceId,
          name: "Bar till",
          profileId: profile!.id,
          formFactor: "till",
        },
      };
      const refused = { status: 401, body: { error: { code: "device.unauthorized" } } };

      const { b, bVenue } = await emergencyTakeover(boxes, waitUntil, opened);
      // Renamed on the old main box only, so a read of the wrong file shows the wrong name.
      await withTransaction(mainBox.db, (tx) =>
        tx.update(devices).set({ label: "Old box only" }).where(eq(devices.id, enrolled.deviceId)),
      );
      expect((await readNodeMode(b.node, spareId)).mode).toBe("primary");
      expect(await me(b.venue, cookie)).toMatchObject(signedIn);
      expect(await me(b.venue, wrongToken)).toMatchObject(refused);

      await b.close();
      opened.splice(opened.indexOf(b), 1);
      const reopened = await openVenueDatabase(bVenue);
      opened.push(reopened);
      expect(await me(reopened.venue, cookie)).toMatchObject(signedIn);
      expect(await me(reopened.venue, wrongToken)).toMatchObject(refused);
    } finally {
      for (const store of opened) await store.close();
    }
  }, 120_000);
});

describe("a confirmed return after an emergency switch, then Wipe and remove", () => {
  it("the old main box resets itself, starts on setup's first page and joins the production venue again by code", async () => {
    const realNow = Date.now();
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(realNow);
    const waitUntil = (targetMs: number) => vi.advanceTimersByTime(targetMs + 1 - Date.now());
    const opened: Array<{ close(): Promise<void> }> = [];
    try {
      const boxes = await joined("production");
      const { mainId, spareId } = boxes;
      const { b, modules } = await emergencySwitch(boxes, waitUntil, opened);

      const { newMain, serversRequest } = await oldBoxBackRestricted(boxes, b, modules);
      const listed = async () =>
        (await listServers(b.venue, b.node, spareId)).nodes.find((n) => n.nodeId === mainId);
      expect(await listed()).toMatchObject({
        returnOutstanding: true,
        returnScenario: "emergency",
        reset: null,
        canReset: false,
      });

      expect(await oldBoxReturnPass(boxes, newMain)).toBe("confirmed");
      expect((await readHandoverOperation(b.node, spareId, EMERGENCY_OP))?.state).toBe(
        "return_complete",
      );
      expect(await listed()).toMatchObject({ canReset: true, returnScenario: "emergency" });
      // The return's real `return_complete` step is what a backup starting after it is compared with.
      const backupStarted = (at: number) => async () => ({
        configured: true as const,
        destinations: [
          {
            id: "local",
            lastBackupAt: new Date(at + 20_000).toISOString(),
            lastBackupStartedAt: new Date(at).toISOString(),
            ageSeconds: 0,
            stale: false,
            readErrorCode: null,
          },
        ],
      });
      const backupOf = async (at: number) =>
        (await listServers(b.venue, b.node, spareId, backupStarted(at))).nodes.find(
          (n) => n.nodeId === mainId,
        )?.recoveredRecordsBackup;
      expect(await backupOf(Date.now() - 60_000)).toBe("awaiting-backup");
      expect(await backupOf(Date.now() + 1000)).toBe("backed-up");

      // Wipe and remove.
      const ordered = await serversRequest(`/management-api/servers/${mainId}/reset`, {
        acceptLoss: false,
      });
      expect(ordered.status, JSON.stringify(ordered.body)).toBe(200);
      expect(await listed()).toMatchObject({ reset: "ordered" });

      // The old box's restricted start runs the real duty until it asks for a restart.
      let restartAsked!: () => void;
      const restarted = new Promise<void>((resolve) => (restartAsked = resolve));
      await runOldBoxDuty(boxes, newMain, {
        end: restarted,
        restart: () => restartAsked(),
        endName: "asked for a restart",
      });
      expect(JSON.parse(await readFile(join(mainState, REPLACED_RESET_FILE), "utf8"))).toEqual({
        phase: "wiping",
        setAside: false,
      });
      // The acknowledgement: the new main box removed the old one and cleared it from the list.
      const chart = (await readNodeMembership(b.venue))!.body;
      expect(chart.nodes.some((n) => n.nodeId === mainId)).toBe(false);
      expect(chart.revoked).toContain(mainId);

      // The restart: the real start of the box, on the files the stopped box left.
      const oldVenue = join(mainState, "venue");
      await mkdir(oldVenue);
      mainBox.db.run(sql`vacuum into ${join(oldVenue, "venue.db")}`);
      mainBox.node.run(sql`vacuum into ${join(oldVenue, "node.db")}`);
      const backups = join(scratch, "backups");
      await mkdir(backups);
      await writeFile(join(backups, "one.backup.enc"), "archive");
      let started: NodeJS.ProcessEnv | undefined;
      let state = FRESH;
      const serveRecovery = vi.fn(() => Promise.resolve());
      await runEntry({
        args: [],
        baseEnv: { WAITRON_LOCAL_BACKUPS_DIR: backups },
        stateDir: mainState,
        venueDir: oldVenue,
        logDir: join(scratch, "logs"),
        assertNotAhead: () => Promise.resolve(),
        clearReplacedDatabases: () => Promise.resolve(),
        loadBoxEnv,
        readRecoveryState: () => Promise.resolve(state),
        writeRecoveryState: (_dir: string, next: RecoveryState) => {
          state = next;
          return Promise.resolve();
        },
        withRecoveryLock: <T>(_dir: string, body: () => Promise<T>) => body(),
        startServer: (env: NodeJS.ProcessEnv) => {
          started = env;
          return Promise.resolve({ close: () => Promise.resolve() });
        },
        serveStartClockWaiting: () => Promise.reject(new Error("no restore waits here")),
        serveRecovery,
        installShutdownHandlers: () => {},
        scheduleStayedUp: () => {},
        log: () => {},
        exit: () => {},
      });
      expect(serveRecovery).not.toHaveBeenCalled();
      expect(started).toBeDefined();
      // Setup mode: no venue is named, so the box serves setup's first page.
      expect(started!.WAITRON_NODE_ID).toBeUndefined();
      expect(started!.WAITRON_ENV).toBeUndefined();
      expect(loadConfig(started!, join(scratch, "migrations"), mainState).node).toBeUndefined();
      for (const name of await readdir(oldVenue)) expect(name).not.toMatch(/^(venue|node)\.db/);
      expect(await readdir(mainState)).not.toContain("trading.env");
      expect(await readdir(mainState)).not.toContain(REPLACED_RESET_FILE);
      expect(await readdir(backups)).toEqual([]);

      // It joins the production venue again by code, with no WAITRON_ENV of its own.
      const rejoined = await joinSpare(
        { spareBox: resetBox, spareState: mainState, ring: RING },
        {
          bundleApp: mirrorBundleApp(
            { db: b.venue, node: b.node, stateDir: spareState, ring: RING },
            spareId,
            SPARE_URL,
          ),
          email: boxes.main.email,
        },
        { spareUrl: "https://reset.test", environment: null },
      );
      expect(rejoined.spareId).not.toBe(mainId);
      expect(rejoined.spareId).not.toBe(spareId);
      expect((await readNodeMode(resetBox.node, rejoined.spareId)).mode).toBe("mirror");
      expect(await readDeploymentEnvironment(resetBox.db)).toBe("production");
    } finally {
      for (const store of opened) await store.close();
    }
  }, 120_000);
});

describe("an emergency switch whose return cannot complete, then Wipe and remove accepting the loss", () => {
  it("the old box's page lists what the copy lacks, and the loss order sets its databases aside and raises the alert", async () => {
    const realNow = Date.now();
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(realNow);
    const waitUntil = (targetMs: number) => vi.advanceTimersByTime(targetMs + 1 - Date.now());
    const opened: Array<{ close(): Promise<void> }> = [];
    let clashingRead: { mockRestore(): void } | undefined;
    try {
      const boxes = await joined("production");
      const { mainId, spareId } = boxes;
      const { b, modules } = await emergencySwitch(boxes, waitUntil, opened);
      const copyLatest = await latestChangeAtMsFromMaxima(liveBackupQuery(b.venue));
      expect(copyLatest).not.toBeNull();
      const copyAt = copyLatest!;

      // On the old box, after the copy: a sale, an order with a line sent two minutes after the
      // copy's latest change, and two sign-ins, one after that and one more than ten minutes before.
      vi.advanceTimersByTime(60_000);
      const afterCopy = await saleOn(mainBox.db, mainId);
      const { deviceId } = await seedDevice(mainBox.db);
      const stationId = await seedKitchenStation(mainBox.db, { name: "Kitchen", isDefault: false });
      const { orderId } = await seedFiredOrder(
        mainBox.db,
        { deviceId, nodeId: asNodeId(mainId), stationId },
        { orderNumber: 4242, ageMinutes: 0 },
      );
      const sentAt = new Date(copyAt + 2 * 60_000).toISOString();
      await mainBox.db.run(
        sql`update working_order_lines set sent_at = ${sentAt} where working_order_id = ${orderId}`,
      );
      const LATE_SUBJECT = "11111111-1111-4111-8111-111111111111";
      const EARLY_SUBJECT = "22222222-2222-4222-8222-222222222222";
      for (const [subjectId, atMs] of [
        [LATE_SUBJECT, copyAt + 3 * 60_000],
        [EARLY_SUBJECT, copyAt - 11 * 60_000],
      ] as const)
        await withTransaction(mainBox.db, (tx) =>
          recordActivity(tx, {
            kind: "dashboard.signed_in",
            subjectId,
            personId: null,
            data: { method: "password" },
            at: new Date(atMs),
          }),
        );

      const { newMain, serversRequest } = await oldBoxBackRestricted(boxes, b, modules);
      const listed = async () =>
        (await listServers(b.venue, b.node, spareId)).nodes.find((n) => n.nodeId === mainId);
      expect(await listed()).toMatchObject({
        returnOutstanding: true,
        canReset: false,
        canWipeWithLoss: true,
      });

      // The return cannot complete: the old box sends its pre-copy record changed, so it clashes.
      const seat = boxes.main.modules.find((m) => m.handover?.returnRecords !== undefined)!
        .handover!.returnRecords!;
      const realRead = seat.read.bind(seat);
      const read = vi.spyOn(seat, "read").mockImplementation(async (db, nodeId) => {
        const chains = await realRead(db, nodeId);
        const [preCopy] = (chains[0] as unknown as { records: Array<{ offset_minutos: number }> })
          .records;
        preCopy!.offset_minutos = preCopy!.offset_minutos === 0 ? 60 : 0;
        return chains;
      });
      clashingRead = read;
      expect(await oldBoxReturnPass(boxes, newMain)).toBe("record-clash");
      expect(await listed()).toMatchObject({ returnOutstanding: true, canWipeWithLoss: true });

      // The duty runs until its first answer, which orders nothing.
      let firstAnswer!: () => void;
      const answered = new Promise<void>((resolve) => (firstAnswer = resolve));
      const heard = await runOldBoxDuty(boxes, newMain, {
        end: answered,
        restart: () => {
          throw new Error("no order yet");
        },
        endName: "answered",
        sleep: async (_ms, signal) => {
          firstAnswer();
          await new Promise((resolve) => signal.addEventListener("abort", resolve));
        },
      });
      expect(heard.answer).toMatchObject({ order: null });
      expect(heard.mainCopy).toEqual({ lastChangeAtMs: copyAt });
      expect(heard.mainHoldings).not.toBeNull();

      // The download as the old box's page makes it.
      const since = await sinceRule(mainBox.db, heard.mainCopy);
      expect(since).toEqual({ kind: "copy", fromMs: copyAt - 10 * 60_000 });
      const files = unzipSync(
        await buildOldBoxWorkbook({
          db: mainBox.db,
          modules: boxes.main.modules,
          mainHoldings: heard.mainHoldings,
          madeAt: new Date(),
          language: "en",
          since,
        }),
      );
      const words = OLD_BOX_DATA_WORDS.en;
      const tab = (name: string) => sheetNamed(files, name)!;
      const dataRows = (xml: string) => {
        const rows: string[][] = [];
        for (let n = 3; row(xml, n).length > 0; n++) rows.push(row(xml, n));
        return rows;
      };
      const invoices = dataRows(tab(words.invoiceSheet));
      expect(invoices).toHaveLength(1);
      expect(invoices[0]).toContain(afterCopy.record.num_serie_factura);
      const cutoffTime = `${new Date(copyAt - 10 * 60_000).toISOString().slice(0, 23).replace("T", " ")} UTC`;
      for (const name of [words.ordersSheet, words.hoursSheet, words.activitySheet])
        expect(row(tab(name), 1), name).toEqual([
          words.sinceCopyIntro.replace("{time}", cutoffTime),
        ]);
      expect(row(tab(words.paymentsSheet), 1)).toEqual([
        words.paymentsCopyIntro.replace("{time}", cutoffTime),
      ]);
      expect(dataRows(tab(words.ordersSheet))).toEqual([expect.arrayContaining(["4242", sentAt])]);
      const activity = dataRows(tab(words.activitySheet)).flat();
      expect(activity).toContain(LATE_SUBJECT);
      expect(activity).not.toContain(EARLY_SUBJECT);

      // Wipe and remove, accepting the loss.
      const ordered = await serversRequest(`/management-api/servers/${mainId}/reset`, {
        acceptLoss: true,
      });
      expect(ordered.status, JSON.stringify(ordered.body)).toBe(200);
      expect(ordered.body).toMatchObject({ acceptLoss: true });
      const { orderId: resetOrderId } = ordered.body as { orderId: string };
      expect((await readHandoverOperation(b.node, spareId, EMERGENCY_OP))?.state).toBe(
        "return_abandoned",
      );

      // The duty runs until it asks for a restart; its extra return pass still clashes.
      const passes: unknown[] = [];
      let restartAsked!: () => void;
      const restarted = new Promise<void>((resolve) => (restartAsked = resolve));
      await runOldBoxDuty(boxes, newMain, {
        end: restarted,
        restart: () => restartAsked(),
        endName: "asked for a restart",
        returnPass: async () => passes.push(await oldBoxReturnPass(boxes, newMain)),
      });
      expect(passes).toEqual(["record-clash"]);
      expect(read).toHaveBeenCalled();
      expect(JSON.parse(await readFile(join(mainState, REPLACED_RESET_FILE), "utf8"))).toEqual({
        phase: "wiping",
        setAside: true,
      });
      const chart = (await readNodeMembership(b.venue))!.body;
      expect(chart.nodes.some((n) => n.nodeId === mainId)).toBe(false);
      expect(chart.revoked).toContain(mainId);
      // The post-copy record is still missing here, so the alert is raised, naming the order.
      expect(
        b.venue
          .all<{ params: string }>(
            sql`select params from incidents where code = 'chain.set_aside_on_reset'`,
          )
          .map((incident) => JSON.parse(incident.params) as unknown),
      ).toEqual([expect.objectContaining({ orderId: resetOrderId })]);
    } finally {
      clashingRead?.mockRestore();
      for (const store of opened) await store.close();
    }
  }, 120_000);
});

describe("a confirmed return after an emergency switch, an order to reset, then Remove", () => {
  it("the old main box's next question is refused, and it saves no marker, sends no acknowledgement and does not restart", async () => {
    const realNow = Date.now();
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(realNow);
    const waitUntil = (targetMs: number) => vi.advanceTimersByTime(targetMs + 1 - Date.now());
    const opened: Array<{ close(): Promise<void> }> = [];
    try {
      const boxes = await joined("production");
      const { mainId } = boxes;
      const { b, modules } = await emergencySwitch(boxes, waitUntil, opened);

      const { newMain, serversRequest } = await oldBoxBackRestricted(boxes, b, modules);
      expect(await oldBoxReturnPass(boxes, newMain)).toBe("confirmed");

      const ordered = await serversRequest(`/management-api/servers/${mainId}/reset`, {
        acceptLoss: false,
      });
      expect(ordered.status, JSON.stringify(ordered.body)).toBe(200);

      // Remove, with the reset statement, before the old box has asked.
      const removed = await serversRequest(`/management-api/servers/${mainId}/remove`, {
        resetStatement: true,
      });
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      expect(
        (await readNodeMembership(b.venue))!.body.nodes.find((n) => n.nodeId === mainId)?.standing,
      ).toBe("evicted");

      // Every question the old box sends, and the main box's answer to it.
      const questions: Array<{ body: Record<string, unknown>; status: number; answer: string }> =
        [];
      // The duty's end point: its wait after a refused answer, which starts once that ask has
      // returned and lasts until the duty is stopped; or, had it been ordered, its restart.
      let ended!: () => void;
      const dutyEnded = new Promise<void>((resolve) => (ended = resolve));
      const restart = vi.fn(() => ended());
      const { logged, answer } = await runOldBoxDuty(boxes, newMain, {
        end: dutyEnded,
        restart,
        endName: "waited after a refusal nor restarted",
        fetch: (async (url: string, init: RequestInit) => {
          const response = await newMain.request(new URL(url).pathname, init);
          questions.push({
            body: (JSON.parse(init.body as string) as { body: Record<string, unknown> }).body,
            status: response.status,
            answer: await response.clone().text(),
          });
          return response;
        }) as typeof fetch,
        sleep: async (ms, signal) => {
          if (ms === ASK_AFTER_REFUSAL_MS) {
            ended();
            await new Promise((resolve) => signal.addEventListener("abort", resolve));
            return;
          }
          vi.advanceTimersByTime(ms);
          await new Promise((resolve) => setImmediate(resolve));
        },
      });

      // The old box asked the main box, which refused the question: a removed box has no
      // endorsed key, so its signature does not verify.
      expect(questions.length).toBeGreaterThan(0);
      for (const question of questions) {
        expect(question.body.sourceNodeId).toBe(mainId);
        expect(question.status, question.answer).toBe(409);
        expect(JSON.parse(question.answer)).toMatchObject({
          error: { code: "handover.reset_query_refused", params: { reason: "signature" } },
        });
      }
      expect(logged.some((line) => line.includes("reset-order.refused"))).toBe(true);
      // So the old box saved no marker, sent no acknowledgement and asked for no restart.
      expect(await readdir(mainState)).not.toContain(REPLACED_RESET_FILE);
      expect(questions.filter((question) => "ack" in question.body)).toEqual([]);
      expect(restart).not.toHaveBeenCalled();
      expect(answer).toBeNull();
    } finally {
      for (const store of opened) await store.close();
    }
  }, 120_000);
});
