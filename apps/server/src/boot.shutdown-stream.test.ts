import { mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import { withTransaction, openVenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { FakeLitestream } from "@waitron/stream/testing/fake-litestream.js";
import { SwitchableStore } from "@waitron/stream/testing/switchable-store.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { writeStreamSettings } from "./stream-host.js";
import { createJobRunner } from "./job-runner.js";
import { installShutdownHandlers } from "./run-server.js";
import { seedModuleSettings } from "../test/module-settings.js";
import { ensureBoxSecrets } from "./box-secrets.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});
vi.mock("./job-runner.js", async (load) => {
  const actual = await load<typeof import("./job-runner.js")>();
  return { ...actual, createJobRunner: vi.fn(actual.createJobRunner) };
});
vi.mock("@waitron/db", async (load) => {
  const actual = await load<typeof import("@waitron/db")>();
  return { ...actual, openVenueDatabase: vi.fn(actual.openVenueDatabase) };
});

const { startServer } = ephemeralServerFixture();
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 120_000,
});

it("stops Litestream within its reserved window even while preliminary jobs hold shutdown", async () => {
  const venue = await setupVenue(suite.db);
  await seedModuleSettings(suite.db, { "fiscal-none": false });
  const scratch = await mkdtemp(join(tmpdir(), "waitron-shutdown-stream-"));
  await ensureBoxSecrets({ stateDir: scratch, hostnames: ["localhost"], now: () => new Date() });
  await writeFile(join(scratch, "trading.env"), "");
  const sources = migrationOptionsFor(manifestSets(), null);
  for (const [i, set] of manifestSets().entries())
    await cp(sources[i]!.migrationsFolder, join(scratch, "migrations", set.name), {
      recursive: true,
    });
  const ringEnv = {
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  };
  const ring = loadKeyRing(ringEnv);
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, venue.cfg.nodeId);
  await seedTermZeroMembership(
    { db: suite.db, node: suite.node, ring },
    venue.cfg.nodeId,
    "https://localhost",
  );
  await withTransaction(suite.db, (tx) =>
    writeStreamSettings(
      tx,
      ring,
      {
        region: "eu-west-1",
        bucket: "copies",
        prefix: "",
        accessKeyId: "A",
        secretAccessKey: "S",
      },
      null,
    ),
  );
  const venueDir = dirname(suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file);
  const env = {
    ...ringEnv,
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_PORT: "8080",
    WAITRON_STATE_DIR: scratch,
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_NODE_ID: venue.cfg.nodeId,
    WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
    WAITRON_ENV: "preproduction",
    WAITRON_BACKUP_RECOVERY_KEY: "backup-key-for-test-0123456789",
  };
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  let entered!: () => void;
  const stoppingJobs = new Promise<void>((done) => {
    entered = done;
  });
  const actual = await vi.importActual<typeof import("./job-runner.js")>("./job-runner.js");
  vi.mocked(createJobRunner)
    .mockReset()
    .mockImplementationOnce((deps) => {
      const runner = actual.createJobRunner(deps);
      return {
        ...runner,
        stopJobs: async () => {
          entered();
          await held;
          await runner.stopJobs();
        },
      };
    });
  const binary = new FakeLitestream();
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let closing: Promise<void> | undefined;
  try {
    server = await startServer(env, env, {
      stream: { spawn: binary.spawn, store: new SwitchableStore(() => new Date()) },
    });
    await vi.waitFor(() => expect(binary.running()).toBeDefined(), { timeout: 10_000 });
    const opened = await vi.mocked(openVenueDatabase).mock.results.at(-1)!.value;
    const closeStore = vi.spyOn(opened, "close");
    const output = vi.spyOn(process.stdout, "write");
    const child = binary.running()!;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const handlers = new Map<string, () => void>();
    installShutdownHandlers(
      { close: () => (closing = server!.close()) },
      {
        on: (signal, handler) => {
          handlers.set(signal, handler);
        },
        write: (_line, done) => done(),
        exit: () => {},
        now: () => new Date(),
      },
    );
    handlers.get("SIGTERM")!();
    await stoppingJobs;
    await vi.advanceTimersByTimeAsync(3_399);
    expect(child.killed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.killed).toBe(true);
    expect(closeStore).not.toHaveBeenCalled();
    expect(output.mock.calls.map(([line]) => String(line)).join("")).toContain(
      '"step":"jobRunner"',
    );
    release();
    vi.useRealTimers();
    await closing;
    expect(closeStore).toHaveBeenCalledOnce();
    output.mockRestore();
  } finally {
    release();
    vi.useRealTimers();
    await closing;
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);
