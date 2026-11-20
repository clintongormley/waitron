import { makeAuthority as makeCertificateAuthority } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VenueResult } from "@waitron/provisioning";
import { readRecoveryPacks, type Database } from "@waitron/db";
import { readRecoveryPackPdf } from "@waitron/recovery-pack";
import { AppError } from "@waitron/shared";
import { PDFDocument } from "pdf-lib";
import * as invoiceFont from "./invoice-font.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { parseModuleConfig } from "@waitron/module";
import { NODE_FILE, VENUE_FILE } from "@waitron/store";
import { FISCAL_SERVER_KEY_AS_TYPED } from "@waitron/fiscal-verifactu";
import { readRecoveryKeyName } from "@waitron/node-db";
import { buildManifest } from "./backup-manifest.js";
import { verifyBreakGlass } from "./break-glass.js";
import { readRecoveryDocumentEvidence } from "./recovery-document-evidence.js";
import { readRecoveryCopyPreview } from "./recovery-backup-preview.js";
import type { DeploymentEnvironment } from "./config.js";
import { createFiscalReadinessStore } from "./fiscal-readiness.js";
import { fiscalReadinessInput } from "./fiscal-readiness-runner.js";
import { ALL_MODULES } from "./modules.js";
import {
  provisionVenue,
  recoverProvisionedVenue,
  venueModuleConfig,
  type ProvisionRequest,
} from "./provision.js";
import type { Logger, LogLevel } from "./logger.js";
import { mountSetup, type SetupDeps } from "./setup-api.js";
import { createSetupOperationStore, type SetupOperationStore } from "./setup-operation.js";
import * as breakGlass from "./break-glass.js";
import { STUB_NODE } from "./testing/node-copy.js";

type Mode = "demo" | "prepare" | "live";
type Box = { environment: DeploymentEnvironment; devMode: boolean; installationOrigin?: "usb" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00.000Z"));
});
afterEach(() => vi.useRealTimers());

const PRODUCTION_BOX: Box = { environment: "production", devMode: false };
const PREPRODUCTION_BOX: Box = { environment: "preproduction", devMode: false };
const DEV_BOX: Box = { environment: "preproduction", devMode: true };
let secureSocket: TLSSocket;
beforeEach(() => {
  secureSocket = new TLSSocket(new Socket());
});
afterEach(() => secureSocket.destroy());

const certificate = makeCertificateAuthority().issue({ passphrase: "cert-secret" });
const CERT = {
  pfxBase64: certificate.pfx.toString("base64"),
  passphrase: "cert-secret",
  certKind: "sello",
} as const;

const INITIAL_OPERATIONS = {
  nodeId: "44444444-4444-4444-4444-444444444444",
  administratorId: "88888888-8888-4888-8888-888888888888",
  inputs: [
    { module: "fiscal-verifactu", eventId: "event-1", sourceId: "source-1", input: { any: 1 } },
  ],
};

function venueResult(): VenueResult {
  return {
    nodeId: "44444444-4444-4444-4444-444444444444",
    seriesIds: ["66666666-6666-6666-6666-666666666666"],
    seeded: [],
  };
}

function body(mode: Mode): Record<string, unknown> {
  return {
    mode,
    venue: {
      country: "ES",
      taxId: "50000000R",
      legalName: "Waitron Dev SL",
      taxpayerDomicile: "Calle Fiscal 8, 28013 Madrid",
      name: "Sala principal",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "Retail counter sales",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      seriesCode: "A",
      fullSeriesCode: "FF",
      rectificativeSeriesCode: "R",
      admin: {
        displayName: "Administrator",
        firstNames: "Anna Mary",
        lastNames: "Smith Green",
        pin: "1357",
        password: "correct-horse-battery",
        email: "admin@waitron.dev",
      },
    },
    ...(mode !== "demo"
      ? {
          email: {
            server: "smtp.example.test",
            port: 587,
            encryption: "starttls",
            from: "venue@example.test",
          },
        }
      : {}),
  };
}

/** A Live body a production-stamped request accepts: it also needs the AEAT certificate. */
function liveProductionBody(): Record<string, unknown> {
  return { ...body("live"), aeatCert: CERT };
}

function harness(box: Box, provision?: (req: ProvisionRequest) => Promise<VenueResult>) {
  const received: ProvisionRequest[] = [];
  const lines: Array<{ level: LogLevel; event: string; fields?: Record<string, unknown> }> = [];
  const log: Logger = (level, event, fields) => {
    lines.push({ level, event, fields });
  };
  const deps: SetupDeps = {
    installationOrigin: box.installationOrigin,
    environment: box.environment,
    devMode: box.devMode,
    provision: vi.fn(async (req: ProvisionRequest) => {
      received.push(req);
      return provision === undefined ? venueResult() : provision(req);
    }),
    recoverProvision: vi.fn(async () => venueResult()),
    seedDemo: vi.fn(async () => {}),
    establishIdentity: vi.fn(async () => {}),
    seedMembership: vi.fn(async () => {}),
    db: { withWriteLock: async () => {} } as unknown as Database,
    node: STUB_NODE,
    ring: {} as unknown as KeyRing,
    persistTrading: vi.fn(async () => {}),
    requestRestart: vi.fn(),
    assertFiscalReady: vi.fn().mockResolvedValue(undefined),
  };
  const app = new Hono();
  mountSetup(app, deps, log);
  const post = (payload: unknown) =>
    app.request(
      "https://box.test/setup-api/provision",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      { incoming: { socket: secureSocket } },
    );
  const throwawayLines = () => lines.filter((line) => line.event === "setup.throwaway_allocation");
  return { post, received, throwawayLines, deps };
}

describe("POST /setup-api/provision — which requests the route marks for a throwaway allocation", () => {
  beforeEach(() => {
    vi.spyOn(breakGlass, "mintBreakGlassKey").mockResolvedValue({
      secret: Buffer.alloc(24, 7).toString("base64url"),
      name: "2026-10-16 · ABCD",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])(
    "refuses USB Demo before provisioning or seeding (supplied operations: %s)",
    async (supplied) => {
      const { post, received, deps } = harness({ ...PREPRODUCTION_BOX, installationOrigin: "usb" });
      const response = await post({
        ...body("demo"),
        ...(supplied ? { initialOperations: INITIAL_OPERATIONS } : {}),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "setup.mode_not_allowed", params: { installationOrigin: "usb" } },
      });
      expect(received).toEqual([]);
      expect(deps.seedDemo).not.toHaveBeenCalled();
    },
  );

  it.each(["prepare", "live"] as const)("admits USB %s", async (mode) => {
    const { post, received } = harness({ ...PREPRODUCTION_BOX, installationOrigin: "usb" });
    expect((await post(mode === "live" ? liveProductionBody() : body(mode))).status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].environment).toBe(mode === "live" ? "production" : "preproduction");
  });

  it("retains the production refusal on a USB production box", async () => {
    const { post, received } = harness({ ...PRODUCTION_BOX, installationOrigin: "usb" });
    const response = await post(body("demo"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "setup.mode_not_allowed", params: { environment: "production" } },
    });
    expect(received).toEqual([]);
  });

  it.each<[string, Mode]>([
    ["Demo", "demo"],
    ["Preparation", "prepare"],
  ])("marks %s on a non-production box, and logs the throwaway after success", async (_l, mode) => {
    const { post, received, throwawayLines } = harness(PREPRODUCTION_BOX);

    expect((await post(body(mode))).status).toBe(200);

    expect(received).toHaveLength(1);
    expect(received[0].environment).toBe("preproduction");
    expect(received[0].initialAllocation).toEqual({
      kind: "throwaway",
      hostEnvironment: "preproduction",
    });
    expect(received[0]).not.toHaveProperty("initialOperations");
    expect(throwawayLines()).toEqual([
      { level: "info", event: "setup.throwaway_allocation", fields: { mode } },
    ]);
  });

  it.each<[string, Mode, boolean]>([
    ["Demo without supplied operations", "demo", false],
    ["Demo with supplied operations", "demo", true],
    ["Preparation without supplied operations", "prepare", false],
    ["Preparation with supplied operations", "prepare", true],
  ])(
    "refuses %s on a WAITRON_ENV=production box before provisioning",
    async (_l, mode, supplied) => {
      const { post, received, throwawayLines } = harness(PRODUCTION_BOX);

      const res = await post({
        ...body(mode),
        ...(supplied ? { initialOperations: INITIAL_OPERATIONS } : {}),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: {
          code: "setup.mode_not_allowed",
          params: { environment: "production" },
        },
      });
      expect(received).toEqual([]);
      expect(throwawayLines()).toEqual([]);
    },
  );

  it.each<[string, Box]>([
    ["a WAITRON_ENV=production box", PRODUCTION_BOX],
    ["a preproduction box that is not a dev box", PREPRODUCTION_BOX],
  ])("does not mark Live on %s; the request is stamped production", async (_l, box) => {
    const { post, received, throwawayLines } = harness(box);

    expect((await post(liveProductionBody())).status).toBe(200);

    expect(received).toHaveLength(1);
    expect(received[0].environment).toBe("production");
    expect(received[0]).not.toHaveProperty("initialAllocation");
    expect(throwawayLines()).toEqual([]);
  });

  it("marks Live on a dev box, whose request is stamped preproduction", async () => {
    const { post, received, throwawayLines } = harness(DEV_BOX);

    expect((await post(body("live"))).status).toBe(200);

    expect(received[0].environment).toBe("preproduction");
    expect(received[0].initialAllocation).toEqual({
      kind: "throwaway",
      hostEnvironment: "preproduction",
    });
    expect(throwawayLines()).toEqual([
      { level: "info", event: "setup.throwaway_allocation", fields: { mode: "live" } },
    ]);
  });

  it.each<[string, Box, Mode]>([
    ["Demo on a preproduction box", PREPRODUCTION_BOX, "demo"],
    ["Preparation on a preproduction box", PREPRODUCTION_BOX, "prepare"],
    ["Demo on a dev box", DEV_BOX, "demo"],
    ["Preparation on a dev box", DEV_BOX, "prepare"],
    ["Live on a dev box", DEV_BOX, "live"],
  ])("never marks a request that carries initialOperations (%s)", async (_l, box, mode) => {
    const { post, received, throwawayLines } = harness(box);

    expect((await post({ ...body(mode), initialOperations: INITIAL_OPERATIONS })).status).toBe(200);

    expect(received[0]).not.toHaveProperty("initialAllocation");
    expect(received[0].initialOperations).toEqual(INITIAL_OPERATIONS);
    expect(throwawayLines()).toEqual([]);
  });

  it.each<[string, Box]>([
    ["a production box", PRODUCTION_BOX],
    ["a preproduction box", PREPRODUCTION_BOX],
  ])(
    "never marks a production Live request that carries initialOperations on %s",
    async (_l, box) => {
      const { post, received } = harness(box);

      expect(
        (await post({ ...liveProductionBody(), initialOperations: INITIAL_OPERATIONS })).status,
      ).toBe(200);

      expect(received[0].environment).toBe("production");
      expect(received[0]).not.toHaveProperty("initialAllocation");
    },
  );

  it("ignores a forged initialAllocation field on a Live body from a non-dev box", async () => {
    const { post, received, throwawayLines } = harness(PREPRODUCTION_BOX);

    const forged = {
      ...liveProductionBody(),
      initialAllocation: { kind: "throwaway", hostEnvironment: "preproduction" },
    };
    expect((await post(forged)).status).toBe(200);

    expect(received[0].environment).toBe("production");
    expect(received[0]).not.toHaveProperty("initialAllocation");
    expect(throwawayLines()).toEqual([]);
  });

  it("a forged initialAllocation field cannot replace the route's own marker", async () => {
    const { post, received } = harness(PREPRODUCTION_BOX);

    const forged = {
      ...body("demo"),
      initialAllocation: { kind: "throwaway", hostEnvironment: "production", extra: true },
    };
    expect((await post(forged)).status).toBe(200);

    expect(received[0].initialAllocation).toEqual({
      kind: "throwaway",
      hostEnvironment: "preproduction",
    });
  });
});

describe("POST /setup-api/provision with the real provisionVenue", () => {
  const venueDb = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
  const moduleConfig = venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "ES-common");
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
  let stateDir: string;
  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "waitron-setup-api-throwaway-"));
  });
  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  function facts() {
    return {
      taxpayer: venueDb.db.all(sql`select tax_id from taxpayer`),
      deployment: venueDb.db.all(sql`select environment from deployment`),
      allocations: venueDb.db.all(sql`select taxpayer_nif, environment from fiscal_allocations`),
      sif: venueDb.db.all(sql`select numero_instalacion from registro_sif`),
      series: venueDb.db.all(sql`select code, purpose, next_number from invoice_series`),
    };
  }

  function expectThrowawayVenue(environment: string) {
    expect(venueDb.db.all(sql`select numero_instalacion from registro_sif`)).toEqual([
      { numero_instalacion: "0CNNW" },
    ]);
    expect(
      venueDb.db.all(sql`select taxpayer_nif, environment, allocation_key from fiscal_allocations`),
    ).toEqual([
      {
        taxpayer_nif: "50000000R",
        environment: "preproduction",
        allocation_key: expect.stringMatching(/^throwaway-/),
      },
    ]);
    expect(venueDb.db.all(sql`select code, purpose from invoice_series order by code`)).toEqual([
      { code: "A-0CNNW", purpose: "standard" },
      { code: "FF-0CNNW", purpose: "full" },
      { code: "R-0CNNW", purpose: "rectificative" },
    ]);
    expect(venueDb.db.all(sql`select environment from deployment`)).toEqual([{ environment }]);
  }

  function emptyVenue() {
    expect(facts()).toEqual({ taxpayer: [], deployment: [], allocations: [], sif: [], series: [] });
  }

  const provisionDeps = () => ({
    ownerDb: venueDb.db,
    moduleConfig,
    database: "waitron",
    stateDir,
  });

  /** `fiscalGate`: "box" refuses as a box with no accepted fiscal test does (the gate `boot.ts`
   * wires, with no evidence on disk); "passed" lets the request through as an accepted test would. */
  function realApp(
    box: Box,
    {
      fiscalGate = "box",
      provision = (req: ProvisionRequest) => provisionVenue(provisionDeps(), req),
      persistTrading = async () => {},
      operations = createSetupOperationStore(stateDir),
      requestRestart = () => {},
      log = () => {},
      recoveryPackEvidence = (module) =>
        readRecoveryDocumentEvidence({ stateDir, venueDir: stateDir }, module),
    }: {
      fiscalGate?: "box" | "passed";
      provision?: (req: ProvisionRequest) => Promise<VenueResult>;
      persistTrading?: SetupDeps["persistTrading"];
      operations?: SetupOperationStore;
      requestRestart?: SetupDeps["requestRestart"];
      log?: Logger;
      recoveryPackEvidence?: NonNullable<SetupDeps["recoveryPackEvidence"]>;
    } = {},
  ) {
    const app = new Hono();
    mountSetup(
      app,
      {
        environment: box.environment,
        devMode: box.devMode,
        db: venueDb.db,
        node: venueDb.node,
        ring,
        recoveryPackEvidence,
        operations,
        provision,
        recoverProvision: (req) => recoverProvisionedVenue(venueDb.db, req),
        seedDemo: async () => {},
        establishIdentity: async () => {},
        seedMembership: async () => {},
        persistTrading,
        requestRestart,
        assertFiscalReady:
          fiscalGate === "passed"
            ? async () => {}
            : async ({ request, contribution, secret }) =>
                createFiscalReadinessStore(
                  stateDir,
                  async () => ({ status: "uncertain" }),
                  ring.current.key,
                ).assertReady(
                  fiscalReadinessInput({
                    venue: request.venue,
                    contribution,
                    secret,
                    moduleVersions: {},
                    applicationVersion: "test",
                  }),
                ),
      },
      log,
    );
    return (payload: unknown, { secure = true, origin = "https://box.test", headers = {} } = {}) =>
      app.request(
        `${secure ? "https" : "http"}://box.test/setup-api/provision`,
        {
          method: "POST",
          headers: { "content-type": "application/json", origin, ...headers },
          body: JSON.stringify(payload),
        },
        { incoming: { socket: secure ? secureSocket : undefined } },
      );
  }

  it("Demo with no initialOperations makes a throwaway venue without a server key", async () => {
    const res = await realApp(PREPRODUCTION_BOX)(body("demo"));

    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ provisioned: true, restarting: true });
    expectThrowawayVenue("preproduction");
    const [{ id }] = venueDb.db.all<{ id: string }>(sql`select id from nodes`);
    expect(await readRecoveryKeyName(venueDb.node, id)).toBeNull();
  });

  it("gives Preparation a recorded PDF with a usable server key only on first success", async () => {
    const request = body("prepare");
    const res = await realApp(PREPRODUCTION_BOX)(request);
    expect(res.status).toBe(200);
    expectThrowawayVenue("preproduction");
    const { breakGlassSecret, breakGlassKeyName, recoveryPackPdf, ...result } = await res.json();
    const [{ id }] = venueDb.db.all<{ id: string }>(sql`select id from nodes`);
    expect(typeof breakGlassKeyName).toBe("string");
    const secret = FISCAL_SERVER_KEY_AS_TYPED(breakGlassSecret);
    expect(typeof secret).toBe("string");
    expect(await verifyBreakGlass(venueDb.node, id, secret!)).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(recoveryPackPdf).toEqual(expect.any(String));
    const pdf = await readRecoveryPackPdf(Buffer.from(recoveryPackPdf, "base64"));
    const [pack] = await readRecoveryPacks(venueDb.db, id);
    expect(pdf).toMatchObject({ number: 1, serverKeyName: breakGlassKeyName });
    expect(pdf.serverKey).toMatchObject({
      nodeKey: { nodeId: id, name: breakGlassKeyName, secret },
    });
    expect(pack).toMatchObject({
      number: 1,
      madeAt: new Date(pdf.madeAt),
      receivedAt: null,
      parts: expect.arrayContaining([
        { part: "server-key", state: "included", keyName: breakGlassKeyName, carriedKey: true },
      ]),
    });

    const copyDir = join(stateDir, "selected");
    await mkdir(copyDir);
    const databasePath = join(copyDir, VENUE_FILE);
    const nodePath = join(copyDir, NODE_FILE);
    await venueDb.db.archiveTo(databasePath);
    await venueDb.node.archiveTo(nodePath);
    const manifest = await buildManifest({
      db: venueDb.db,
      node: venueDb.node,
      modules: ALL_MODULES,
      environment: "preproduction",
      now: new Date(),
    });
    expect(
      await readRecoveryCopyPreview(
        {
          databasePath,
          manifest,
          nodeDump: await readFile(nodePath),
          discard: async () => {},
          secretEntries: [
            { name: "secrets/trading.env", bytes: Buffer.from(`WAITRON_NODE_ID=${id}\n`) },
          ],
        },
        "selected",
        { modules: ALL_MODULES, migrationsRoot: null },
      ),
    ).toMatchObject({
      nodeRecoveryKeyName: breakGlassKeyName,
      fiscalSelection: {
        country: "ES",
        fiscalTerritory: "ES-common",
        module: "fiscal-verifactu",
        timeZone: "Europe/Madrid",
      },
    });

    expect(result).toEqual({ provisioned: true, restarting: true, breakGlassKeyInBackups: true });
    expect((await createSetupOperationStore(stateDir).read())?.data).toEqual(result);
    const replayed = await realApp(PREPRODUCTION_BOX)(request);
    expect(replayed.status).toBe(200);
    expect(await replayed.json()).toEqual(result);
    expect(await readRecoveryKeyName(venueDb.node, id)).toBe(breakGlassKeyName);
  });

  it("draws the pack in the visible setup language when the browser prefers an unsupported one", async () => {
    const response = await realApp(PREPRODUCTION_BOX)(body("prepare"), {
      headers: { "accept-language": "fr-FR", "x-waitron-recovery-pack-locale": "en-GB" },
    });
    expect(response.status).toBe(200);
    const { recoveryPackPdf } = await response.json();
    const pack = await PDFDocument.load(Buffer.from(recoveryPackPdf, "base64"));
    expect(pack.getTitle()).toBe("Waitron recovery pack");
  });

  it("delivers the text key without a pack record when PDF drawing fails", async () => {
    const fonts = vi
      .spyOn(invoiceFont, "loadRecoveryPackFonts")
      .mockRejectedValueOnce(new AppError("recovery.pack_invalid", { reason: "shape" }));
    const log = vi.fn<Logger>();
    try {
      const response = await realApp(PREPRODUCTION_BOX, { log })(body("prepare"));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).not.toHaveProperty("recoveryPackPdf");
      const [{ id }] = venueDb.db.all<{ id: string }>(sql`select id from nodes`);
      expect(await readRecoveryPacks(venueDb.db, id)).toEqual([]);
      const secret = FISCAL_SERVER_KEY_AS_TYPED(result.breakGlassSecret);
      expect(typeof secret).toBe("string");
      expect(await verifyBreakGlass(venueDb.node, id, secret!)).toBe(true);
      expect(log).toHaveBeenCalledWith("warn", "setup.recovery_pack_drawing_failed", {
        reason: "recovery.pack_invalid",
      });
    } finally {
      fonts.mockRestore();
    }
  });

  it("still delivers a usable key when the recovery document evidence cannot be read", async () => {
    const log = vi.fn<Logger>();
    const response = await realApp(PREPRODUCTION_BOX, {
      log,
      recoveryPackEvidence: async () => {
        throw new Error("evidence unreadable");
      },
    })(body("prepare"));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).not.toHaveProperty("recoveryPackPdf");
    const [{ id }] = venueDb.db.all<{ id: string }>(sql`select id from nodes`);
    expect(await readRecoveryPacks(venueDb.db, id)).toEqual([]);
    const secret = FISCAL_SERVER_KEY_AS_TYPED(result.breakGlassSecret);
    expect(typeof secret).toBe("string");
    expect(await verifyBreakGlass(venueDb.node, id, secret!)).toBe(true);
    expect(log).toHaveBeenCalledWith("warn", "setup.recovery_pack_drawing_failed", {
      reason: "unexpected",
    });
  });

  it.each([
    [false, "http://box.test", "setup.connection_insecure"],
    [true, "https://other.test", "setup.owner_required"],
  ])("refuses Preparation before writing on secure=%s from %s", async (secure, origin, code) => {
    const response = await realApp(PREPRODUCTION_BOX)(body("prepare"), { secure, origin });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code, params: {} } });
    emptyVenue();
    expect(await createSetupOperationStore(stateDir).read()).toBeNull();
  });

  it("returns a new usable Preparation pack after retrying a failure before publication", async () => {
    const request = body("prepare");
    let keyAtFirstPublication: string | null = null;
    const post = realApp(PREPRODUCTION_BOX, {
      persistTrading: vi
        .fn<NonNullable<SetupDeps["persistTrading"]>>()
        .mockImplementationOnce(async ({ nodeId }) => {
          keyAtFirstPublication = await readRecoveryKeyName(venueDb.node, nodeId);
          throw new Error("write refused");
        })
        .mockResolvedValue(undefined),
    });
    const refused = await post(request);
    expect(refused.status).toBe(500);
    const refusal = await refused.json();
    expect(refusal).not.toHaveProperty("breakGlassSecret");
    expect(refusal).not.toHaveProperty("recoveryPackPdf");
    expect(typeof keyAtFirstPublication).toBe("string");

    const retried = await post(request);
    expect(retried.status).toBe(200);
    const { breakGlassSecret, breakGlassKeyName, recoveryPackPdf } = await retried.json();
    expect(typeof breakGlassSecret).toBe("string");
    expect(breakGlassKeyName).not.toBe(keyAtFirstPublication);
    expect(await readRecoveryPackPdf(Buffer.from(recoveryPackPdf, "base64"))).toMatchObject({
      number: 2,
      serverKeyName: breakGlassKeyName,
    });
    const [{ id }] = venueDb.db.all<{ id: string }>(sql`select id from nodes`);
    expect(
      await verifyBreakGlass(venueDb.node, id, FISCAL_SERVER_KEY_AS_TYPED(breakGlassSecret)!),
    ).toBe(true);
  });

  it("keeps the published key when the operation completion write fails", async () => {
    const request = body("prepare");
    const store = createSetupOperationStore(stateDir);
    const requestRestart = vi.fn();
    const post = realApp(PREPRODUCTION_BOX, {
      requestRestart,
      operations: {
        ...store,
        run(kind, hash, body, hold) {
          return store.run(
            kind,
            hash,
            async (operation) => {
              operation.complete = async () => {
                throw new Error("operation completion write refused");
              };
              return body(operation);
            },
            hold,
          );
        },
      },
    });
    const refused = await post(request);
    expect(refused.status).toBe(500);
    expect(await refused.json()).not.toHaveProperty("breakGlassSecret");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(requestRestart).not.toHaveBeenCalled();
    expect((await store.read())?.phase).toBe("publishing");
    const [{ id }] = venueDb.db.all<{ id: string }>(sql`select id from nodes`);
    const key = await readRecoveryKeyName(venueDb.node, id);
    expect(typeof key).toBe("string");

    const retried = await realApp(PREPRODUCTION_BOX)(request);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({
      provisioned: true,
      restarting: true,
      breakGlassKeyInBackups: true,
    });
    expect(await readRecoveryKeyName(venueDb.node, id)).toBe(key);
    expect((await store.read())?.phase).toBe("complete");
  });

  it("Live on a dev box with no initialOperations makes a throwaway venue", async () => {
    const res = await realApp(DEV_BOX)(body("live"));

    expect(res.status, await res.clone().text()).toBe(200);
    expectThrowawayVenue("preproduction");
  });

  it.each<[string, Box]>([
    ["a WAITRON_ENV=production box", PRODUCTION_BOX],
    ["a preproduction box that is not a dev box", PREPRODUCTION_BOX],
  ])(
    "%s refuses Live with no initialOperations at the fiscal-test gate, writing nothing",
    async (_l, box) => {
      const res = await realApp(box)(liveProductionBody());

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "setup.fiscal_test_required", params: { module: "verifactu" } },
      });
      emptyVenue();
    },
  );

  it.each<[string, Box]>([
    ["a WAITRON_ENV=production box", PRODUCTION_BOX],
    ["a preproduction box that is not a dev box", PREPRODUCTION_BOX],
  ])(
    "%s, past the fiscal-test gate, has Live with no initialOperations refused by the allocation path, leaving only the production stamp",
    async (_l, box) => {
      const res = await realApp(box, { fiscalGate: "passed" })(liveProductionBody());

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: {
          code: "sif.allocation_invalid",
          params: { reason: "reauthentication_required" },
        },
      });
      // provisionVenue stamps before applyVenue's transaction opens (its doc comment).
      expect(facts()).toEqual({
        taxpayer: [],
        deployment: [{ environment: "production" }],
        allocations: [],
        sif: [],
        series: [],
      });
    },
  );

  it("a committed Demo whose first response was lost replays to 200 with the same venue", async () => {
    let first = true;
    const post = realApp(PREPRODUCTION_BOX, {
      provision: async (req) => {
        const result = await provisionVenue(provisionDeps(), req);
        if (first) {
          first = false;
          throw new Error("lost-response-after-commit");
        }
        return result;
      },
    });

    expect((await post(body("demo"))).status).toBe(500);
    expectThrowawayVenue("preproduction");
    const before = facts();
    const ledger = venueDb.db.all(sql`select * from fiscal_allocations`);

    const replayed = await post(body("demo"));

    expect(replayed.status, await replayed.clone().text()).toBe(200);
    expect(await replayed.json()).toEqual({ provisioned: true, restarting: true });
    expect(facts()).toEqual(before);
    expect(venueDb.db.all(sql`select * from fiscal_allocations`)).toEqual(ledger);
    expect((await createSetupOperationStore(stateDir).read())?.phase).toBe("complete");
  });
});
