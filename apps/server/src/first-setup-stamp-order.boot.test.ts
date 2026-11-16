import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { Agent } from "undici";
import { AppError } from "@waitron/shared";
import { emptyDrainResult } from "@waitron/fiscal";
import { ownedHourSetup } from "../test/owned-hour-setup.js";
import { request, PASSWORD } from "../test/first-fiscal.js";
import { expectStartAgainDeleted } from "../test/start-again-deleted.js";
import { startServerOrFirstSetupResolution } from "./node-entry.js";
import * as moduleHost from "./module-operation-host.js";
import * as readiness from "./fiscal-readiness.js";
import { START_AGAIN_ROUTES } from "./setup-first-fiscal-api.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { listener } from "./testing/ephemeral-listener.js";
import { createHourTestClock, type HourTestClock } from "./testing/hour-test-clock.js";
import { useTestProducer } from "./testing/test-producer.js";

vi.mock("@hono/node-server", async () =>
  (await import("./testing/ephemeral-listener.js")).ephemeralHttpMock(),
);
vi.mock("./module-operation-host.js", { spy: true });
vi.mock("./fiscal-readiness.js", { spy: true });
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const time = vi.hoisted(() => ({ clock: undefined as unknown as HourTestClock }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-time-service.js", () => ({
  observeTimeServiceHourClock: async () => ({
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
useTestProducer();
const { startServer, httpPort } = ephemeralServerFixture();
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("a refused Live activation restarts on its original host and clears through Start again", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "first-setup-stamp-")));
  dirs.push(root);
  const roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  const migrations = join(root, "migrations");
  await copyMigrationsRoot(migrations);
  const testClock = createHourTestClock(Date.now());
  time.clock = testClock;
  const env = {
    WAITRON_ENV: "preproduction",
    WAITRON_STATE_DIR: roots.stateDir,
    WAITRON_VENUE_DIR: roots.venueDir,
    WAITRON_MIGRATIONS_DIR: migrations,
    WAITRON_HTTP_HOST: "127.0.0.1",
    WAITRON_HTTP_PORT: "3000",
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_MANAGEMENT_RP_ID: "localhost",
    WAITRON_MANAGEMENT_ORIGIN: "https://localhost",
  };
  const actual = await vi.importActual<typeof moduleHost>("./module-operation-host.js");
  let injected = false;
  const factory = vi
    .spyOn(moduleHost, "createFirstSetupModuleHost")
    .mockImplementation((options) => {
      const host = actual.createFirstSetupModuleHost(options);
      const update = host.store.update.bind(host.store);
      vi.spyOn(host.store, "update").mockImplementation((...args) => {
        if (!injected && args[2].kind === "activation-started") {
          injected = true;
          throw new AppError("storage.disk_full", {});
        }
        return update(...args);
      });
      return host;
    });
  vi.spyOn(readiness, "createFiscalReadinessStore").mockReturnValue({
    run: async () => ({ status: "ready" }),
    assertReady: async () => {},
  } as never);
  const restart = vi.spyOn(process, "kill").mockReturnValue(true);
  let server: { close(): Promise<void> } | undefined, agent: Agent | undefined;
  try {
    server = await startServer(env, {}, { testClock });
    agent = new Agent({ connect: { ca: await readFile(join(roots.stateDir, "tls/ca.crt")) } });
    const transport: typeof fetch = (input, init) =>
      fetch(input, { ...init, dispatcher: agent } as RequestInit);
    const base = () => `https://127.0.0.1:${httpPort()}`;
    const post = async (path: string, body: unknown, headers = {}) => {
      const response = await transport(`${base()}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const owner = await ownedHourSetup(transport, base(), request, PASSWORD, undefined, testClock);
    expect(
      await post(
        "/setup-api/provision",
        {
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
        },
        owner.headers,
      ),
    ).toMatchObject({ status: 507, body: { error: { code: "storage.disk_full" } } });
    expect(injected).toBe(true);
    await server.close();
    server = undefined;
    factory.mockRestore();
    const launch = async () => {
      listener.port = undefined;
      const handle = await startServerOrFirstSetupResolution(env, env, {
        startServer: (environment, base) => startServer(environment, base, { testClock }),
        requestRestart: () => {
          process.kill(process.pid, "SIGTERM");
        },
      });
      server = handle;
      await vi.waitFor(() => expect(listener.port).toBeDefined());
    };
    await launch();
    const status = await transport(`${base()}/setup-api/status`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ provisioned: false });
    const inspect = async () => {
      const response = await transport(`${base()}${START_AGAIN_ROUTES.inspect.path}`);
      expect(response.status).toBe(200);
      const { inspectionId, revision, ownerGeneration } = await response.json();
      return { inspectionId, revision, ownerGeneration };
    };
    expect((await post(START_AGAIN_ROUTES.stop.path, await inspect())).status).toBe(200);
    await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
    await server!.close();
    server = undefined;
    const database = new DatabaseSync(join(roots.venueDir, "venue.db"));
    try {
      expect(
        database.prepare("select environment from deployment where id = 1").get(),
      ).toBeUndefined();
    } finally {
      database.close();
    }
    await launch();
    const ids = await inspect();
    expect((await post(START_AGAIN_ROUTES.summary.path, ids)).status).toBe(200);
    expect((await post(START_AGAIN_ROUTES.startAgain.path, ids)).status).toBe(200);
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(2));
    await server!.close();
    server = undefined;
    await expectStartAgainDeleted(roots);
  } finally {
    await server?.close();
    await agent?.close();
  }
});
