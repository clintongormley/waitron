import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import {
  invoiceSeries,
  locations,
  nodes,
  tenants,
  stampDeployment,
  setDeploymentMode,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { tenantCredentials } from "@waitron/credentials";
import { managementSessions } from "@waitron/identity";
import type { ModuleOperationInput, WaitronModule } from "@waitron/module";
import { startServer, type StartedServer } from "./boot.js";
import {
  readPendingAdoption,
  writePendingAdoption,
  type PendingAdoption,
} from "./finish-adoption.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("./modules.js", async (original) => {
  const real = await original<typeof import("./modules.js")>();
  return {
    ...real,
    ALL_MODULES: real.ALL_MODULES.map((module) =>
      module.name !== "fiscal-none"
        ? module
        : ({
            ...module,
            operations: {
              async prepare<T>(
                operation: ModuleOperationInput,
                run: (prepared: ModuleOperationInput) => Promise<T>,
              ): Promise<T> {
                return run(operation);
              },
            },
            provisioning: {
              standby: {
                series: "on-activation",
                async reserve() {
                  return { state: {} };
                },
                async establish() {},
              },
            },
          } satisfies WaitronModule),
    ),
  };
});
const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });
const LOCATION = "a8000000-0000-4000-8000-000000000001";
const PRIMARY = "a8000000-0000-4000-8000-000000000002";
const STANDBY = "a8000000-0000-4000-8000-000000000003";
it("boot retains allocation-dependent adoption as pending without an ambient session or selling identity", async () => {
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "50000000R", legalName: "Boot Adoption SL" });
  await suite.db.insert(locations).values({
    id: LOCATION,
    name: "Venue",
    invoiceLocales: ["en"],
    operationDescription: "Hospitality",
  });
  await suite.db.insert(nodes).values({
    id: PRIMARY,
    locationId: LOCATION,
    name: "Primary",
    filingModule: "none",
    taxModule: "vat",
  });
  await stampDeployment(suite.db, "preproduction");
  await setDeploymentMode(suite.db, STANDBY, "mirror");
  const pending: PendingAdoption = {
    locationId: LOCATION,
    originNodeId: PRIMARY,
    standby: { nodeId: STANDBY, publicKey: "synthetic-public", privateKey: "synthetic-private" },
    nodeName: "Spare",
    filingModule: "none",
    taxModule: "vat",
    reserved: { modules: { "fiscal-none": {} }, series: [], endorsement: {} as never },
  };
  const scratch = await mkdtemp(join(tmpdir(), "boot-adoption-allocation-"));
  let server: StartedServer | undefined;
  try {
    for (const [index, set] of manifestSets().entries())
      await cp(migrations[index]!.migrationsFolder, join(scratch, "migrations", set.name), {
        recursive: true,
      });
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-verifactu": false } }),
    );
    await writePendingAdoption(scratch, pending);
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const [port] = await freePorts(1);
    server = await startServer({
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_STATE_DIR: scratch,
      WAITRON_LOG_DIR: join(scratch, "logs"),
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_TILL_NODE_ID: STANDBY,
      WAITRON_TILL_LOCATION_ID: LOCATION,
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_ENV: "dev",
    });
    await vi.waitFor(async () => {
      const lines = (await readFile(join(scratch, "logs", "waitron.log"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { level: string; event: string; code?: string });
      expect(
        lines
          .filter((line) => line.event.startsWith("adoption."))
          .map(({ level, event, code }) => ({ level, event, code })),
      ).toEqual([
        { level: "error", event: "adoption.establish_failed", code: "module.operation_invalid" },
      ]);
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/box/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ adoption: "pending" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await readPendingAdoption(scratch)).toEqual(pending);
    expect((await suite.db.select().from(nodes)).map((node) => node.id)).toEqual([PRIMARY]);
    expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
    expect(await suite.db.select().from(managementSessions)).toEqual([]);
    expect(await suite.db.select().from(tenantCredentials)).toEqual([]);
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);
