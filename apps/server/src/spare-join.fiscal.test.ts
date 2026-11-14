import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import { stampDeployment, withTransaction, writeNodeMembership, type Database } from "@waitron/db";
import { migratedTableNames, useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALLOCATED_FISCAL_STANDBY, FISCAL_CLASSIFICATION } from "@waitron/fiscal-verifactu";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules, withPreparedModuleOperations } from "@waitron/module";
import { readNodeMode } from "@waitron/node-db";
import { MODULE_PREPARATION_STATE_FILE } from "@waitron/store";
import {
  createFirstSetupCoordinator,
  planVenue,
  readModulePreparationHistory,
} from "@waitron/provisioning";
import { applyAllocatedTestVenue } from "@waitron/provisioning/testing/allocated-venue";
import { adoptFromPrimary, type AdoptCredential } from "./adopt.js";
import { replaceBackupSettings } from "./backup-env-writer.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";
import { readModuleConfig, writeModuleConfig } from "./module-config.js";
import { ALL_MODULES } from "./modules.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { promoteMirrorToPrimary } from "./promote.js";
import { mountPromoteApi } from "./promote-api.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
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
import { holdRecoveryKey } from "./testing/recovery-key.js";

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
const MAIN_URL = "https://main.test";
const SPARE_URL = "https://spare.test";
const PASSWORD = "correct horse";
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
  let socket: TLSSocket;
  beforeEach(async () => {
    mainState = await mkdtemp(join(tmpdir(), "spare-join-fiscal-main-"));
    spareState = await mkdtemp(join(tmpdir(), "spare-join-fiscal-spare-"));
    socket = new TLSSocket(new Socket());
  });
  afterEach(async () => {
    socket.destroy();
    await rm(mainState, { recursive: true, force: true });
    await rm(spareState, { recursive: true, force: true });
  });

  /** A Veri*Factu main box, ready for the real bundle route. */
  async function filingMainBox() {
    const modules = enabledModules(ALL_MODULES, await readModuleConfig(mainState));
    expect(modules.map((module) => module.name)).toContain("fiscal-verifactu");
    const venue = await applyAllocatedTestVenue(
      planVenue(
        {
          country: "ES",
          taxId: "81000001K",
          legalName: "Spare Join SL",
          name: "Main box",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          operationDescription: "Sale",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
          seriesCode: "FA",
          rectificativeSeriesCode: "RF",
          admin: {
            displayName: "Owner",
            pinHash: hashPin("1234"),
            passwordHash: hashPassword(PASSWORD),
            email: "owner@example.test",
          },
        },
        modules,
      ),
      { db: mainBox.db, modules },
    );
    await stampDeployment(mainBox.db, "preproduction");
    await mkdir(join(mainState, "tls"), { recursive: true });
    const authority = mintSelfSignedServerCert({
      hostnames: ["waitron.local"],
      ipAddresses: [],
      now: new Date(),
    });
    await writeFile(join(mainState, "tls", "ca.crt"), authority.caCertPem);
    await writeFile(join(mainState, "tls", "ca.key"), authority.caKeyPem);
    await holdRecoveryKey(mainState);
    const mainId: string = venue.nodeId;
    await establishNodeIdentity({ ownerDb: mainBox.db, node: mainBox.node, ring: RING }, mainId);
    const mainKey = await readNodeIdentityKey(mainBox.node, RING, mainId);
    await writeNodeMembership(
      mainBox.db,
      signedMembershipDoc(1, {
        signerNodeId: mainId,
        keyPair: { publicKey: nodeSigningPublicKey(mainKey), privateKey: mainKey },
        nodes: [{ nodeId: mainId, contactUrl: MAIN_URL, standing: "serving-primary" }],
      }),
    );
    const session = await openManagementSession(mainBox.db, "admin");
    const [{ email }] = (
      await mainBox.db.execute<{ email: string }>(
        sql`select email from persons where id = ${session.personId}`,
      )
    ).rows as [{ email: string }];
    await withTransaction(mainBox.db, (tx) => setFreshManagementSignIn(tx, session.token));
    const app = new Hono();
    mountMirrorBundleApi(app, {
      appDb: mainBox.db,
      node: mainBox.node,
      ring: RING,
      stateDir: mainState,
      boxHostname: "waitron.local",
      advertisedOrigin: MAIN_URL,
      designated: { nodeId: mainId },
      accountKey: Buffer.alloc(32, 9).toString("base64"),
      credentialKeyRing: TOTP_KEY_RING,
      wakeSpareJoin: () => {},
    });
    return { app, email };
  }

  async function join_(main: Awaited<ReturnType<typeof filingMainBox>>) {
    let bundle: MirrorBundle | undefined;
    let spareId = "";
    await adoptFromPrimary(
      {
        ownerDb: spareBox.db,
        ownerNode: spareBox.node,
        ring: RING,
        persistCredentialsRing: async () => {},
        fetchBundle: async (_url, credential: AdoptCredential, sent) => {
          const response = await main.app.request("/management-api/mirror-bundle", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: credential.email,
              password: credential.password,
              standbyNodeId: sent.nodeId,
              standbyPublicKey: sent.publicKey,
              standbyContactUrl: sent.contactUrl,
              standbyStoreUrl: sent.storeUrl,
              standbyAt: sent.at,
            }),
          });
          const body = await response.json();
          expect(response.status, JSON.stringify(body)).toBe(200);
          bundle = body as MirrorBundle;
          return bundle;
        },
        advertisedOrigin: SPARE_URL,
        spareStorePort: 7443,
        environment: "preproduction",
        persistTrading: async (args) => {
          spareId = args.nodeId;
        },
        persistBackupSettings: (settings) => replaceBackupSettings(spareState, settings),
        persistModuleConfig: (config) => writeModuleConfig(spareState, config),
        stateDir: spareState,
        database: "spare",
        listIpv4: () => [],
        now: () => new Date(),
      },
      { primaryUrl: MAIN_URL, credential: { email: main.email, password: PASSWORD } },
      { beforeFirstWrite: async () => {} },
    );
    return { bundle: bundle!, spareId };
  }

  it("a Veri*Factu venue's join writes no fiscal row and no dormant setup", async () => {
    const main = await filingMainBox();
    const preparation = (dir: string) => fileOrNull(join(dir, MODULE_PREPARATION_STATE_FILE));
    const before = {
      main: fiscalRows(mainBox.db),
      spare: fiscalRows(spareBox.db),
      mainFile: await preparation(mainState),
      spareFile: await preparation(spareState),
    };
    expect(before.main.registro_sif).toHaveLength(1);

    const { bundle, spareId } = await join_(main);

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

  it("a spare with no dormant setup cannot be switched on and writes nothing", async () => {
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
    const [sif] = await store.venue
      .select()
      .from(registroSif)
      .where(eq(registroSif.nodeId, standby.nodeId));
    expect(sif?.numeroInstalacion).toBe(selected.body.identity);
  }, 60_000);
});
