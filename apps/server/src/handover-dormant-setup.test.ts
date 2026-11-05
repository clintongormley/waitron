// A spare whose venue.db is a real placed copy of M1's database writes its dormant filing setup
// under the switcher's sign-in, from that copy, and a promotion then reads it. Stand-ins: M1's
// stepdown and the transfer of the copy (both real elsewhere); the copy, its signed indicator, its
// acceptance and its placing are the real functions.
import { Socket } from "node:net";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import {
  insertReservedNodeTx,
  locations,
  nodes,
  openVenueDatabase,
  stampDeployment,
  tenants,
  withNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { migratedTableNames, useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import { activatePreparedModuleAllocation } from "@waitron/fiscal-verifactu/src/allocation-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import { TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { hashPassword, persons } from "@waitron/identity";
import { endorseKey } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { readHandoverOperation, recordHandoverRestrictionTx, setNodeMode } from "@waitron/node-db";
import {
  createFirstSetupCoordinator,
  mergeModulePreparationRevisions,
  readModulePreparationHistory,
} from "@waitron/provisioning";
import { locationId } from "@waitron/shared";
import { createDeploymentHolders } from "./deployment-holders.js";
import { acceptFinalCopy, acceptedCopyPath } from "./handover-acceptance.js";
import { captureFinalCopy, finalCopyPath } from "./handover-capture.js";
import { placeAcceptedCopyAtStart, recordCopyPlaced } from "./handover-place-copy.js";
import { handoverPromotionContext, mountHandoverPreparationApi } from "./handover-preparation.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { promoteMirrorToPrimary } from "./promote.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));

const migrations = migrationOptionsFor(manifestSets(), null);
const mainBox = useVenueDb({ migrations, timeoutMs: 60_000 });
const spareBefore = useVenueDb({ migrations, timeoutMs: 60_000 });

const primary = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const standby = { ...primary, nodeId: TENANT_A.nodeId2 };
const OPERATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN = "e1000000-0000-4000-8000-000000000004";
const ADMIN_EMAIL = "admin@venue.test";
const PASSWORD = "synthetic-handover-password";
const MODULE = "fiscal-verifactu";
const FILE = "module-preparation-state.json";
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const binding: OperationBinding = {
  module: MODULE,
  action: "promote",
  eventId: OPERATION,
  sourceId: primary.nodeId,
  targetNodeId: standby.nodeId,
};
const handoverBinding = {
  operationId: OPERATION,
  scenario: "controlled" as const,
  venue: { country: "ES", taxId: "89890001K", environment: "preproduction" as const },
  sourceNodeId: primary.nodeId,
  destinationNodeId: standby.nodeId,
  membership: { term: 1, digest: "a".repeat(64) },
};
const fiscalModules = ALL_MODULES.filter((module) => module.name === MODULE);
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];

let root: string;
let placed: { venue: Database; node: NodeDatabase; close(): Promise<void> } | undefined;
const sockets: TLSSocket[] = [];

const dirs = () => ({
  mainState: join(root, "main-state"),
  spareState: join(root, "spare-state"),
  spareVenue: join(root, "spare-venue"),
});

/** M1's first setup, activated in M1's database, with its selection kept in M1's own file. */
async function firstSetupOnM1() {
  let value: unknown = null;
  const first = { ...binding, action: "setup", eventId: "first", targetNodeId: primary.nodeId };
  const setup = createHourPreparation({
    withState: async (_binding, run) =>
      run({
        get value() {
          return value;
        },
        history: [],
        async replace(next) {
          value = next;
        },
      }),
    monotonicNow: () => performance.now(),
    read: async () => ({
      scope: { taxpayerNif: "89890001K", environment: "preproduction" },
      bases,
      contextKey: "first",
      history: [{ reference: "empty", complete: true, records: [] }],
      clock: compareHourClocks(
        ["box", "browser"].map((source) => ({
          source: source as "box" | "browser",
          result: "usable",
          instantMs: Date.now(),
          uncertaintyMs: 0,
          wallStartedMs: Date.now(),
          wallFinishedMs: Date.now(),
          monotonicStartedMs: 0,
          monotonicFinishedMs: 0,
        })),
        Date.parse("2026-10-15T00:00:00Z"),
      ),
    }),
  });
  await withOperationAuthority(first, ADMIN, async (authority) => {
    let selected = await setup.select({ binding: first, authority, comparisonId: "comparison" });
    if (selected.status === "waiting") {
      vi.advanceTimersByTime(selected.targetMs + 1 - Date.now());
      selected = await setup.select({ binding: first, authority, comparisonId: "comparison" });
    }
    if (selected.status !== "selected") throw new Error("first setup selection");
    await setup.prepare({ binding: first, authority, input: selected.input }, (ready) =>
      withTransaction(mainBox.db, (tx) => activatePreparedModuleAllocation(tx, primary, ready)),
    );
  });
  await mergeModulePreparationRevisions({ stateDir: dirs().mainState }, [
    { binding: first, value },
  ]);
}

/** Two separate boxes, then the real capture, acceptance and placing, leaving M2 on M1's bytes. */
async function placeRealCopy() {
  const { mainState, spareState, spareVenue } = dirs();
  for (const dir of [mainState, spareState, spareVenue]) await mkdir(dir);
  await mainBox.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Handover SL" });
  await mainBox.db.insert(locations).values({
    id: primary.locationId,
    name: "Restaurant",
    invoiceLocales: ["en"],
    operationDescription: "Hospitality",
    timeZone: "Europe/Madrid",
  });
  await mainBox.db.insert(nodes).values({
    id: primary.nodeId,
    locationId: primary.locationId,
    name: "Primary",
    filingModule: "verifactu",
    taxModule: "vat",
  });
  await stampDeployment(mainBox.db, "preproduction");
  await mainBox.db.insert(persons).values({
    id: ADMIN,
    displayName: "Administrator",
    role: "admin",
    passwordHash: hashPassword(PASSWORD),
    email: ADMIN_EMAIL,
  });
  await firstSetupOnM1();
  await establishNodeIdentity({ ownerDb: mainBox.db, node: mainBox.node, ring }, primary.nodeId);

  // M2's own database knows nothing of the venue's people or filing; only its own row and key.
  await spareBefore.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Handover SL" });
  await spareBefore.db.insert(locations).values({
    id: standby.locationId,
    name: "Restaurant",
    invoiceLocales: ["en"],
    operationDescription: "Hospitality",
    timeZone: "Europe/Madrid",
  });
  await spareBefore.db.insert(nodes).values({
    id: standby.nodeId,
    locationId: standby.locationId,
    name: "Standby",
    filingModule: "verifactu",
    taxModule: "vat",
  });
  await establishNodeIdentity(
    { ownerDb: spareBefore.db, node: spareBefore.node, ring },
    standby.nodeId,
  );
  await stampDeployment(spareBefore.db, "preproduction");
  await setNodeMode({ venue: spareBefore.db, node: spareBefore.node }, standby.nodeId, "mirror");

  const spareKey = await readNodeIdentityKey(spareBefore.node, ring, standby.nodeId);
  const mainKey = await readNodeIdentityKey(mainBox.node, ring, primary.nodeId);
  const sparePublic = nodeSigningPublicKey(spareKey);
  await withTransaction(mainBox.db, (tx) =>
    insertReservedNodeTx(tx, {
      id: standby.nodeId,
      locationId: primary.locationId,
      name: "Primary (standby)",
      filingModule: "verifactu",
      taxModule: "vat",
      publicKey: sparePublic,
      endorsement: endorseKey(standby.nodeId, sparePublic, primary.nodeId, mainKey),
    }),
  );

  const mainStore = { node: mainBox.node, nodeId: primary.nodeId };
  await beginHandover(mainStore, handoverBinding, "source");
  await advanceHandover(mainStore, OPERATION, "source_stepped_down", {});
  await withNodeTransaction(mainBox.node, (tx) =>
    recordHandoverRestrictionTx(tx, {
      nodeId: primary.nodeId,
      operationId: OPERATION,
      kind: "handed-over",
      successorNodeId: standby.nodeId,
      membershipTerm: 1,
    }),
  );
  const indicator = await captureFinalCopy(
    {
      venue: mainBox.db,
      node: mainBox.node,
      stateDir: mainState,
      ring,
      nodeId: primary.nodeId,
      modules: fiscalModules,
    },
    OPERATION,
  );

  const spareStore = { node: spareBefore.node, nodeId: standby.nodeId };
  await beginHandover(spareStore, handoverBinding, "destination");
  const received = join(spareState, "received.db");
  await copyFile(finalCopyPath(mainState, OPERATION), received);
  await mkdir(dirname(acceptedCopyPath(spareState, OPERATION)), { recursive: true });
  await acceptFinalCopy(
    { node: spareBefore.node, ring, nodeId: standby.nodeId, stateDir: spareState },
    (await readHandoverOperation(spareBefore.node, standby.nodeId, OPERATION))!,
    indicator,
    received,
  );
  await advanceHandover(spareStore, OPERATION, "filing_assumed", {});

  // The spare's own files, as a stopped box leaves them for the start that places the copy.
  spareBefore.db.run(sql`vacuum into ${join(spareVenue, "venue.db")}`);
  spareBefore.node.run(sql`vacuum into ${join(spareVenue, "node.db")}`);
  const log = () => {};
  const placing = await placeAcceptedCopyAtStart({
    venueDir: spareVenue,
    stateDir: spareState,
    nodeId: standby.nodeId,
    log,
  });
  expect(placing).toMatchObject({ kind: "copy_placed_owed", swapped: true });
  placed = await openVenueDatabase(spareVenue);
  await recordCopyPlaced({
    node: placed.node,
    nodeId: standby.nodeId,
    stateDir: spareState,
    operationId: OPERATION,
    log,
  });
  return placed;
}

function spareService(store: { venue: Database; node: NodeDatabase }) {
  return createNodeOperationPreparation({
    stateDir: dirs().spareState,
    venueDir: dirs().spareVenue,
    db: store.venue,
    nodeDb: store.node,
    node: standby,
    modules: fiscalModules,
    credentialKeyRing: TOTP_KEY_RING,
    coordinator: createFirstSetupCoordinator(),
    environment: {},
  });
}

function spareRoute(
  store: { venue: Database; node: NodeDatabase },
  service: ReturnType<typeof spareService>,
) {
  const app = new Hono();
  mountHandoverPreparationApi(app, {
    node: store.node,
    nodeId: standby.nodeId,
    appDb: store.venue,
    nodePreparation: service,
    requestFromBox: () => false,
  });
  return app;
}

async function post(app: Hono, proposal: unknown) {
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  const response = await app.request(
    `https://box.test/api/node/handover/${OPERATION}/preparation`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        moduleOperation: { binding, input: null },
        signIn: { email: ADMIN_EMAIL, password: PASSWORD },
        proposal,
      }),
    },
    { incoming: { socket } },
  );
  return {
    status: response.status,
    body: (await response.json()) as {
      id: string;
      status: string;
      identity: string;
      input: unknown;
    },
  };
}

function allRows(db: Database): Map<string, string> {
  return new Map(
    migratedTableNames(db).map((table) => [
      table,
      JSON.stringify(db.all(sql.raw(`select * from "${table}" order by rowid`))),
    ]),
  );
}
function changedTables(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...after.keys()].filter((table) => before.get(table) !== after.get(table)).sort();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "handover-dormant-setup-"));
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }));
});
afterEach(async () => {
  vi.useRealTimers();
  external.internet.mockReset();
  while (sockets.length > 0) sockets.pop()?.destroy();
  await placed?.close();
  placed = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("a spare on a real placed copy", () => {
  it("writes its setup at the first good sign-in, selects, and a promotion reads it", async () => {
    const store = await placeRealCopy();
    vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
    await expect(stat(join(dirs().spareState, FILE))).resolves.toBeDefined();
    expect(
      await readModulePreparationHistory({ stateDir: dirs().spareState, venueDir: "" }, MODULE),
    ).toHaveLength(1);

    const service = spareService(store);
    const app = spareRoute(store, service);
    const challenge = await post(app, { action: "clock-challenge" });
    expect(challenge.status, JSON.stringify(challenge.body)).toBe(200);
    const history = await readModulePreparationHistory(
      { stateDir: dirs().spareState, venueDir: "" },
      MODULE,
    );
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      dormant: [
        {
          kind: "hour-dormant",
          binding: { ...binding, action: "reserve" },
          scope: { taxpayerNif: "89890001K", environment: "preproduction" },
          bases,
        },
      ],
    });

    const compared = await post(app, {
      action: "compare-clocks",
      browser: { challengeId: challenge.body.id, instantMs: Date.now() },
    });
    expect(compared.status, JSON.stringify(compared.body)).toBe(200);
    const selected = await post(app, { action: "select", comparisonId: compared.body.id });
    expect(selected.status, JSON.stringify(selected.body)).toBe(200);
    expect(selected.body.status).toBe("selected");

    await service.withPromotion(
      { binding, input: selected.body.input },
      { personId: ADMIN, password: PASSWORD },
      handoverPromotionContext({ scenario: "controlled" }),
      (modules, runner) =>
        promoteMirrorToPrimary(
          {
            db: store.venue,
            node: store.node,
            nodeId: standby.nodeId,
            ring,
            modules,
            holders: createDeploymentHolders("mirror", "secondary"),
            log: () => {},
            persistTradingEnv: async () => {},
            withModuleOperations: runner,
          },
          { oldNodeNeutralised: true },
        ),
    );
    const sif = await store.venue.select().from(registroSif);
    expect(sif.find((row) => row.nodeId === standby.nodeId)?.numeroInstalacion).toBe(
      selected.body.identity,
    );
  }, 60_000);

  it("the step changes these tables and no other, in either file", async () => {
    const store = await placeRealCopy();
    vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
    const venueBefore = allRows(store.venue);
    expect(venueBefore.get("registro_sif")).toBeDefined();
    const nodeBefore = allRows(store.node as unknown as Database);
    expect(nodeBefore.get("node_handover_events")).toContain("copy_placed");
    const fileBefore = await readFile(join(dirs().spareState, FILE));

    const answer = await post(spareRoute(store, spareService(store)), {
      action: "clock-challenge",
    });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);

    expect(await readFile(join(dirs().spareState, FILE))).not.toEqual(fileBefore);
    expect(changedTables(venueBefore, allRows(store.venue))).toEqual(["management_sessions"]);
    expect(changedTables(nodeBefore, allRows(store.node as unknown as Database))).toEqual([]);
  }, 60_000);
});
