import { mkdtemp, readFile, rm } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import { invoiceSeries, withTransaction, type Database } from "@waitron/db";
import { migratedTableNames, useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALLOCATED_FISCAL_STANDBY, FISCAL_CLASSIFICATION } from "@waitron/fiscal-verifactu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { withPreparedModuleOperations } from "@waitron/module";
import { readNodeMode } from "@waitron/node-db";
import { MODULE_PREPARATION_STATE_FILE } from "@waitron/store";
import { createFirstSetupCoordinator, readModulePreparationHistory } from "@waitron/provisioning";
import { createDeploymentHolders } from "./deployment-holders.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { promoteMirrorToPrimary } from "./promote.js";
import { mountPromoteApi } from "./promote-api.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import {
  ADMIN,
  MODULE,
  PASSWORD as SPARE_PASSWORD,
  bases,
  binding,
  fiscalModules,
  placedSpareFixture,
  primary,
  ring as SPARE_RING,
  standby,
  type PlacedSpare,
} from "./testing/handover-placed-copy.js";
import { joinSpare, veriFactuMainBox } from "./testing/veri-factu-join.js";

const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const FISCAL_TABLES = [...FISCAL_CLASSIFICATION.map(({ table }) => table), "invoice_series"];

const migrations = migrationOptionsFor(manifestSets(), null);
const mainBox = useVenueDb({ migrations, timeoutMs: 60_000 });
const spareBox = useVenueDb({ migrations, timeoutMs: 60_000 });

function fiscalRows(db: Database): Record<string, unknown[]> {
  return Object.fromEntries(
    FISCAL_TABLES.map((table) => [
      table,
      db.all(sql.raw(`select * from "${table}" order by rowid`)),
    ]),
  );
}
async function fileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

describe("a Veri*Factu venue's spare joins", () => {
  let mainState: string;
  let spareState: string;
  beforeEach(async () => {
    mainState = await mkdtemp(join(tmpdir(), "spare-join-fiscal-main-"));
    spareState = await mkdtemp(join(tmpdir(), "spare-join-fiscal-spare-"));
  });
  afterEach(async () => {
    await rm(mainState, { recursive: true, force: true });
    await rm(spareState, { recursive: true, force: true });
  });

  it("a Veri*Factu venue's join writes no fiscal row and no dormant setup", async () => {
    const boxes = { mainBox, spareBox, mainState, spareState, ring: RING };
    const main = await veriFactuMainBox(boxes);
    expect(main.modules.map((module) => module.name)).toContain("fiscal-verifactu");
    const preparation = (dir: string) => fileOrNull(join(dir, MODULE_PREPARATION_STATE_FILE));
    const before = {
      main: fiscalRows(mainBox.db),
      spare: fiscalRows(spareBox.db),
      mainFile: await preparation(mainState),
      spareFile: await preparation(spareState),
    };
    expect(before.main.invoice_series).not.toEqual([]);

    const { bundle, spareId } = await joinSpare(boxes, main);

    expect((await readNodeMode(spareBox.node, spareId)).mode).toBe("mirror");
    expect(bundle.reservedIdentity.series).toEqual([]);
    expect(fiscalRows(mainBox.db)).toEqual(before.main);
    expect(fiscalRows(spareBox.db)).toEqual(before.spare);
    expect(await preparation(mainState)).toBe(before.mainFile);
    expect(await preparation(spareState)).toBe(before.spareFile);
  }, 60_000);
});

describe("a spare holding a copy of a Veri*Factu venue", () => {
  let root: string;
  let placed: PlacedSpare | undefined;
  const sockets: TLSSocket[] = [];
  const dirs = () => ({
    mainState: join(root, "main-state"),
    spareState: join(root, "spare-state"),
    spareVenue: join(root, "spare-venue"),
  });
  const fixture = placedSpareFixture({ mainBox, spareBefore: spareBox, dirs });
  const credentials = { personId: ADMIN, password: SPARE_PASSWORD };
  const context = { oldNodeNeutralised: true, noParallelRecovery: true };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "spare-join-fiscal-copy-"));
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

  /** The spare's own preparation service and its promotion route, on the copy it holds. */
  function spareSide(store: PlacedSpare) {
    const service = createNodeOperationPreparation({
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
    const app = new Hono();
    mountPromoteApi(app, {
      appDb: store.venue,
      nodeDb: store.node,
      nodeId: standby.nodeId,
      credentialKeyRing: TOTP_KEY_RING,
      modules: fiscalModules,
      nodePreparation: service,
      run: async (attestation, runner) => {
        const result = await promoteMirrorToPrimary(
          {
            db: store.venue,
            node: store.node,
            nodeId: standby.nodeId,
            ring: SPARE_RING,
            modules: fiscalModules,
            holders: createDeploymentHolders("mirror", "secondary"),
            log: () => {},
            persistTradingEnv: async () => {},
            withModuleOperations: runner,
          },
          attestation,
        );
        return { ...result, restarting: !result.alreadyPrimary };
      },
    });
    const send = async (path: string, body: Record<string, unknown>) => {
      const socket = new TLSSocket(new Socket());
      sockets.push(socket);
      const response = await app.request(
        `https://box.test/management-api/promote${path}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...context, ...credentials, ...body }),
        },
        { incoming: { socket } },
      );
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    const prepare = (proposal: unknown) =>
      send("/preparation", { moduleOperation: { binding, input: null }, proposal });
    return { service, send, prepare };
  }

  const preparationHistory = () =>
    readModulePreparationHistory({ stateDir: dirs().spareState, venueDir: "" }, MODULE);
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

  /** Reserve then establish, on the spare, under the administrator's sign-in. */
  async function admit(store: PlacedSpare, service: ReturnType<typeof spareSide>["service"]) {
    const admission = { ...binding, action: "reserve", eventId: "admission" };
    let state: unknown;
    await service.withOperation(
      { binding: admission, input: { kind: "hour-dormant", version: 1 } },
      credentials,
      {},
      (modules, operations) =>
        withPreparedModuleOperations(modules, operations, standby.nodeId, "reserve", (ready) =>
          withTransaction(store.venue, async (tx) => {
            state = (
              await ALLOCATED_FISCAL_STANDBY.reserve(tx, primary, standby, ready.get(MODULE))
            ).state;
          }),
        ),
    );
    await service.withOperation(
      { binding: { ...admission, action: "establish" }, input: state },
      credentials,
      {},
      (modules, operations) =>
        withPreparedModuleOperations(modules, operations, standby.nodeId, "establish", (ready) =>
          withTransaction(store.venue, (tx) =>
            ALLOCATED_FISCAL_STANDBY.establish(tx, standby, state, ready.get(MODULE)),
          ),
        ),
    );
    return admission;
  }

  it("the promotion preparation route refuses a spare with no dormant setup and writes nothing", async () => {
    const store = (placed = await fixture.placeEmergencyCopy());
    vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
    expect(await preparationHistory()).toEqual([]);
    const venueBefore = allRows(store.venue);
    const nodeBefore = allRows(store.node as unknown as Database);

    const answer = await spareSide(store).prepare({ action: "clock-challenge" });

    expect(answer).toEqual({
      status: 400,
      body: {
        error: { code: "sif.allocation_invalid", params: { reason: "reservation_mismatch" } },
      },
    });
    // The sign-in's own ended session is the one row the attempt leaves.
    expect(changedTables(venueBefore, allRows(store.venue))).toEqual(["management_sessions"]);
    expect(changedTables(nodeBefore, allRows(store.node as unknown as Database))).toEqual([]);
    expect(await preparationHistory()).toEqual([]);
  }, 60_000);

  it("on the spare, under a person's sign-in, reserve then establish writes a dormant setup that a promotion then reads", async () => {
    const store = (placed = await fixture.placeEmergencyCopy());
    vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
    const spare = spareSide(store);
    const admission = await admit(store, spare.service);
    expect(await preparationHistory()).toEqual([
      expect.objectContaining({
        dormant: [
          expect.objectContaining({
            kind: "hour-dormant",
            binding: admission,
            scope: { taxpayerNif: "89890001K", environment: "preproduction" },
            bases,
          }),
        ],
      }),
    ]);

    const challenge = await spare.prepare({ action: "clock-challenge" });
    expect(challenge.status, JSON.stringify(challenge.body)).toBe(200);
    const compared = await spare.prepare({
      action: "compare-clocks",
      browser: { challengeId: challenge.body.id, instantMs: Date.now() },
    });
    expect(compared.status, JSON.stringify(compared.body)).toBe(200);
    const selected = await spare.prepare({ action: "select", comparisonId: compared.body.id });
    expect(selected.body).toMatchObject({ status: "selected", bases });
    const promoted = await spare.send("", {
      moduleOperation: { binding, input: selected.body.input },
    });
    expect(promoted, JSON.stringify(promoted.body)).toMatchObject({
      status: 200,
      body: { alreadyPrimary: false },
    });
    const opened = await store.venue
      .select()
      .from(invoiceSeries)
      .where(eq(invoiceSeries.nodeId, standby.nodeId));
    expect(opened.map(({ code, purpose, nextNumber }) => ({ code, purpose, nextNumber }))).toEqual(
      bases.map((base) => ({
        ...base,
        code: `${base.code}-${String(selected.body.identity)}`,
        nextNumber: 1,
      })),
    );
  }, 60_000);
});
