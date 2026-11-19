import { installationFixture } from "../test/cloud-installation-fixture.js";
import { seedModuleSettings } from "../test/module-settings.js";
import { saveCloudVenueId, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { sql } from "drizzle-orm";
import { dirname, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import * as jobs from "./cloud-worker.js";
import { freePorts } from "./testing/free-ports.js";
import type { StartedServer } from "./boot.js";

const served = vi.hoisted(() => ({ staff: undefined as Hono["fetch"] | undefined }));
vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  const mocked = await ephemeralHttpMock();
  return {
    ...mocked,
    serve: (
      options: Parameters<typeof mocked.serve>[0],
      listen: Parameters<typeof mocked.serve>[1],
    ) => {
      if (options.createServer) served.staff = options.fetch as Hono["fetch"];
      return mocked.serve(options, listen);
    },
  };
});
const { startServer } = ephemeralServerFixture();
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("starts on the first installed Cloud chain, follows a rename across restart, and denies withdrawn access", async () => {
  let hostname = "staff.first.example.test";
  const f = await installationFixture(undefined, {
    remoteAccess: () => ({ state: "ready", configuration: { staffHostname: hostname } }),
  });
  let running: StartedServer | undefined;
  let worker: Parameters<typeof jobs.cloudConnectionJob>[0] | undefined;
  const realJob = jobs.cloudConnectionJob;
  const job = vi.spyOn(jobs, "cloudConnectionJob").mockImplementation((options) => {
    worker = options;
    return { ...realJob(options), applies: () => false };
  });
  try {
    const venue = await setupVenue(suite.db);
    await seedModuleSettings(suite.db, { "fiscal-none": false });
    await withTransaction(suite.db, (tx) => saveCloudVenueId(tx, f.venueId));
    await f.client.refresh();
    const migrations = join(f.stateDir, "migrations");
    await copyMigrationsRoot(migrations);
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const [staffPort] = await freePorts(1);
    const env = {
      WAITRON_ENV: "dev",
      WAITRON_NODE_ID: venue.cfg.nodeId,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_MIGRATIONS_DIR: migrations,
      WAITRON_CLOUD_ORIGIN: f.options.origin,
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_STAFF_PORT: String(staffPort),
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    };
    const install = async () => {
      const material = mintSelfSignedServerCert({
        now: new Date(),
        hostnames: [hostname],
        ipAddresses: [],
      });
      await mkdir(join(f.stateDir, "cloud"), { recursive: true });
      await writeFile(join(f.stateDir, "cloud/staff.key"), material.serverKeyPem, { mode: 0o600 });
      await writeFile(join(f.stateDir, "cloud/staff.crt"), material.serverCertPem);
    };
    const ask = (name = hostname) =>
      served.staff!(
        new Request(`https://${name}/management-api/session/me`, {
          headers: { cookie: venue.managerCookie },
        }),
      );
    running = await startServer(env, env);
    expect(served.staff).toBeUndefined();
    await install();
    expect(worker?.onStaffCertificate).toBeTypeOf("function");
    await worker!.onStaffCertificate!(new AbortController().signal);
    expect((await ask()).status).toBe(200);
    const availability = await served.staff!(
      new Request(`https://${hostname}/public/availability`),
    );
    expect(availability.status).toBe(200);
    expect(await availability.json()).toEqual({ available: true });
    hostname = "staff.next.example.test";
    await f.client.refresh();
    expect((await ask("staff.first.example.test")).status).toBe(200);
    await running.close();
    running = undefined;
    running = await startServer(env, env);
    expect((await ask("staff.first.example.test")).status).toBe(200);
    await install();
    await worker!.onStaffCertificate!(new AbortController().signal);
    expect((await ask()).status).toBe(200);
    expect((await ask("staff.first.example.test")).status).toBe(404);
    await f.client.setRemoteAccess(false, async () => {});
    expect((await ask()).status).toBe(404);
    expect(
      (await served.staff!(new Request(`https://${hostname}/public/availability`))).status,
    ).toBe(404);
    await f.client.setRemoteAccess(true, async () => {});
    expect((await ask()).status).toBe(200);
    await f.client.revoke(async () => {});
    expect((await ask()).status).toBe(404);
  } finally {
    await running?.close();
    job.mockRestore();
    await f.close();
  }
}, 60000);
