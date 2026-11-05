// A spare whose venue.db is a real placed copy of M1's database writes its dormant filing setup
// under the switcher's sign-in, from that copy, and a promotion then reads it.
import { Socket } from "node:net";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, NodeDatabase } from "@waitron/db";
import { migratedTableNames, useVenueDb } from "@waitron/db/testing/venue-db.js";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createFirstSetupCoordinator, readModulePreparationHistory } from "@waitron/provisioning";
import { createDeploymentHolders } from "./deployment-holders.js";
import { handoverPromotionContext, mountHandoverPreparationApi } from "./handover-preparation.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { promoteMirrorToPrimary } from "./promote.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import {
  ADMIN,
  ADMIN_EMAIL,
  OPERATION,
  MODULE,
  PASSWORD,
  bases,
  binding,
  fiscalModules,
  placedSpareFixture,
  ring,
  standby,
  type PlacedSpare,
} from "./testing/handover-placed-copy.js";

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

const FILE = "module-preparation-state.json";

let root: string;
let placed: PlacedSpare | undefined;
const sockets: TLSSocket[] = [];

const dirs = () => ({
  mainState: join(root, "main-state"),
  spareState: join(root, "spare-state"),
  spareVenue: join(root, "spare-venue"),
});
const fixture = placedSpareFixture({ mainBox, spareBefore, dirs });

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
    const store = (placed = await fixture.placeRealCopy());
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
    const store = (placed = await fixture.placeRealCopy());
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
