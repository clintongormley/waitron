import * as filesystem from "node:fs/promises";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { Agent } from "undici";
import { emptyDrainResult } from "@waitron/fiscal";
import { startServer, type StartedServer } from "./boot.js";
import { startServerOrFirstSetupResolution } from "./node-entry.js";
import { loadBoxEnv } from "./box-env.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { request, PASSWORD, MODULE } from "../test/first-fiscal.js";
import { firstFiscalPublicDigest } from "./first-fiscal-delivery.js";
import {
  createHourTestClock,
  selectPastWaits,
  type HourTestClock,
} from "./testing/hour-test-clock.js";
import { useTestProducer } from "./testing/test-producer.js";

useTestProducer();
vi.mock("./fiscal-readiness.js", { spy: true });
vi.mock("node:fs/promises", { spy: true });
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const time = vi.hoisted(() => ({ clock: undefined as unknown as HourTestClock }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: time.clock.wall(),
    uncertaintyMs: 500,
    wallStartedMs: time.clock.wall(),
    wallFinishedMs: time.clock.wall(),
    monotonicStartedMs: time.clock.monotonic(),
    monotonicFinishedMs: time.clock.monotonic(),
  }),
}));
vi.mock("@waitron/composition", async (original) => {
  const actual = await original<typeof import("@waitron/composition")>();
  return {
    ...actual,
    ALL_MODULES: actual.ALL_MODULES.map((module) =>
      module.name !== "fiscal-verifactu"
        ? module
        : {
            ...module,
            fiscal: {
              ...module.fiscal!,
              provisioningSecret: {
                required: () => true,
                validate: () => {},
                seal: async () => {},
              },
              drain: async () => emptyDrainResult(),
            },
          },
    ),
  };
});
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("keeps starting after a real first setup grows beyond 128 MiB", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "first-setup-growth-")));
  dirs.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue"),
    migrations = join(root, "migrations");
  await copyMigrationsRoot(migrations);
  const [port] = await freePorts(1);
  const testClock = createHourTestClock(Date.now());
  time.clock = testClock;
  const env = {
    WAITRON_ENV: "production",
    WAITRON_STATE_DIR: stateDir,
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_MIGRATIONS_DIR: migrations,
    WAITRON_HTTP_HOST: "127.0.0.1",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_MANAGEMENT_RP_ID: "localhost",
    WAITRON_MANAGEMENT_ORIGIN: "https://localhost",
  };
  let server: StartedServer | undefined, agent: Agent | undefined;
  vi.spyOn(process, "kill").mockReturnValue(true);
  try {
    server = await startServer(env, {}, { testClock });
    agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
    let capability = "",
      state: { attemptId: string; revision: number; ownerGeneration: number };
    const headers = () =>
      capability
        ? {
            "X-Waitron-Setup-Owner": capability,
            "X-Waitron-Setup-Attempt": state.attemptId,
            "X-Waitron-Setup-Revision": String(state.revision),
            "X-Waitron-Setup-Generation": String(state.ownerGeneration),
          }
        : {};
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`https://127.0.0.1:${port}${path}`, {
        dispatcher: agent,
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify(body),
      } as RequestInit);
      return { status: response.status, body: await response.json() };
    };
    const claim = await post("/setup-api/first-setup/claim", {
      venue: request,
    });
    expect(claim.status).toBe(200);
    state = claim.body.state;
    capability = claim.body.capability;
    const live = {
      mode: "live",
      aeatCert: { pfxBase64: "c3ludGhldGlj", passphrase: "synthetic", certKind: "sello" },
      email: {
        server: "smtp.example.test",
        port: 465,
        encryption: "tls",
        user: "test",
        password: "test",
        from: "owner@example.test",
      },
    };
    const readiness = await post("/setup-api/fiscal-test", live);
    expect(readiness).toEqual({ status: 200, body: { status: "uncertain" } });
    const chosen = await selectPastWaits(testClock, async () => {
      const challenge = await post("/setup-api/first-setup/preparation", {
        module: MODULE,
        proposal: { action: "clock-challenge" },
      });
      expect(challenge.status).toBe(200);
      const comparison = await post("/setup-api/first-setup/preparation", {
        module: MODULE,
        proposal: {
          action: "compare-clocks",
          browser: { challengeId: challenge.body.preparation.id, instantMs: testClock.wall() },
        },
      });
      expect(comparison.status).toBe(200);
      const reconfirm = await post("/setup-api/first-setup/reconfirm", {
        password: PASSWORD,
        purpose: "block-use",
      });
      expect(reconfirm.status).toBe(200);
      const answer = await post("/setup-api/first-setup/candidates", {
        module: MODULE,
        proposal: { comparisonId: comparison.body.preparation.id },
        ...reconfirm.body,
      });
      return { ...answer, preparation: answer.body.preparation };
    });
    expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
    expect(chosen.preparation).toBeUndefined();
    state = chosen.body.state;
    const response = await fetch(`https://127.0.0.1:${port}/setup-api/first-setup/request`, {
      dispatcher: agent,
      headers: headers(),
    } as RequestInit);
    const exported = await response.json();
    const prepared = exported.modules.find((entry: { module: string }) => entry.module === MODULE)
      .request.input;
    const imported = await post("/setup-api/first-setup/input", {
      module: MODULE,
      input: prepared,
    });
    expect(imported.status).toBe(200);
    state = imported.body.state;
    const staged = await post("/setup-api/first-setup/node-key", {
      reconfirmation: (
        await post("/setup-api/first-setup/reconfirm", {
          password: PASSWORD,
          purpose: "block-use",
        })
      ).body.reconfirmation,
    });
    expect(staged.status).toBe(200);
    const statement = {
      kind: "waitron-recovery-document",
      version: 1,
      scope: { taxpayerNif: request.taxId, softwareId: "W1", environment: "production" },
      taxpayerName: request.legalName,
      venueName: request.name,
      createdAt: new Date().toISOString(),
      nodeKey: { nodeId: staged.body.stage.nodeId, name: staged.body.stage.name },
    };
    const document = {
      module: MODULE,
      stageId: staged.body.stage.stageId,
      inputDigest: firstFiscalPublicDigest(prepared),
      bindingDigest: firstFiscalPublicDigest(statement),
      documentDigest: firstFiscalPublicDigest({ syntheticPdf: true, statement }),
    };
    expect(
      (
        await post("/setup-api/first-setup/recovery-document", {
          ...document,
          statement,
        })
      ).status,
    ).toBe(200);
    const reconfirmActivation = await post("/setup-api/first-setup/reconfirm", {
      password: PASSWORD,
      purpose: "activation",
    });
    expect(
      (
        await post("/setup-api/first-setup/recovery-document-kept", {
          ...document,
          kept: true,
          ...reconfirmActivation.body,
        })
      ).status,
    ).toBe(200);
    const readinessModule = await import("./fiscal-readiness.js");
    vi.spyOn(readinessModule, "createFiscalReadinessStore").mockReturnValue({
      run: async () => ({ status: "ready" }),
      assertReady: async () => {},
    } as never);
    const activated = await post("/setup-api/provision", live);
    expect(activated, JSON.stringify(activated.body)).toMatchObject({
      status: 200,
      body: { provisioned: true },
    });
    await server.close();
    server = undefined;
    const completed = await readFile(join(stateDir, "first-setup.json"), "utf8");
    expect(JSON.parse(completed).status).toBe("complete");

    const databasePath = join(venueDir, "venue.db");
    const before = (await stat(databasePath)).size;
    expect(before).toBeLessThan(128 * 1024 * 1024);
    const merged = await loadBoxEnv(env, stateDir);
    const restart = async () => {
      const handle = await startServerOrFirstSetupResolution(merged, env, {
        startServer: (environment, base) => startServer(environment, base, { testClock }),
      });
      try {
        const status = await fetch(`https://127.0.0.1:${port}/setup-api/status`, {
          dispatcher: agent,
        } as RequestInit);
        expect(status.status).toBe(404);
        expect(
          (await fetch(`https://127.0.0.1:${port}/health`, { dispatcher: agent } as RequestInit))
            .status,
        ).toBe(200);
      } finally {
        await handle.close();
      }
    };
    await restart();
    const fileIo = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const databaseReads: string[] = [];
    vi.spyOn(filesystem, "open").mockImplementation(async (...args) => {
      const handle = await fileIo.open(...args);
      if ([databasePath, `${databasePath}-wal`].includes(String(args[0]))) {
        vi.spyOn(handle, "readFile").mockImplementation(async () => {
          databaseReads.push("readFile");
          throw new Error("whole database read forbidden during startup");
        });
        vi.spyOn(handle, "createReadStream").mockImplementation(() => {
          databaseReads.push("createReadStream");
          throw new Error("whole database stream forbidden during startup");
        });
      }
      return handle;
    });
    await restart();
    expect(databaseReads).toEqual([]);
    const database = new DatabaseSync(databasePath);
    let images = 0;
    try {
      const bytes = Buffer.alloc(1024 * 1024);
      const insert = database.prepare("insert into media_image_blobs (hash, bytes) values (?, ?)");
      while ((await stat(databasePath)).size <= 128 * 1024 * 1024) {
        bytes.writeUInt32LE(images++);
        insert.run(createHash("sha256").update(bytes).digest("hex"), bytes);
        database.exec("pragma wal_checkpoint(truncate)");
      }
      expect(database.prepare("pragma quick_check").get()).toEqual({ quick_check: "ok" });
    } finally {
      database.close();
    }
    expect((await stat(databasePath)).size).toBeGreaterThan(128 * 1024 * 1024);
    console.info(
      JSON.stringify({
        growth: {
          before,
          after: (await stat(databasePath)).size,
          images,
          bytesPerImage: 1024 * 1024,
        },
      }),
    );
    await restart();
    await restart();
    expect(databaseReads).toEqual([]);
    expect(await readFile(join(stateDir, "first-setup.json"), "utf8")).toBe(completed);
  } finally {
    await server?.close();
    await agent?.close();
  }
});
