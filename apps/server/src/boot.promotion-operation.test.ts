import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import {
  invoiceSeries,
  locations,
  nodes,
  tenants,
  readSingletonRole,
  setDeploymentMode,
  stampDeployment,
  writeMirrorConfig,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons, hashPassword } from "@waitron/identity";
import { loadKeyRing } from "@waitron/credentials";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readOperationAuthority } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { startServer, type StartedServer } from "./boot.js";
import { establishNodeIdentity } from "./node-identity.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { freePorts } from "./testing/free-ports.js";

const observed = vi.hoisted(() => ({
  operator: undefined as unknown,
  action: undefined as unknown,
  input: undefined as unknown,
}));
vi.mock("./modules.js", async (original) => {
  const real = await original<typeof import("./modules.js")>();
  return {
    ...real,
    ALL_MODULES: real.ALL_MODULES.map((module) =>
      module.name !== "fiscal-none"
        ? module
        : {
            ...module,
            operations: {
              async prepare(
                operation: import("@waitron/module").ModuleOperationInput,
                run: (ready: import("@waitron/module").ModuleOperationInput) => Promise<unknown>,
              ) {
                observed.input = operation.input;
                return run({ ...operation, input: { independentlyConfirmed: true } });
              },
            },
            provisioning: {
              standby: {
                series: "on-activation",
                async reserve() {
                  return { state: {} };
                },
                async establish() {},
                async activate(
                  tx: import("@waitron/db").Transaction,
                  node: import("@waitron/module").ProvisionedNode,
                  operation?: import("@waitron/module").ModuleOperationInput,
                ) {
                  if (operation === undefined)
                    throw new AppError("module.operation_invalid", { module: module.name });
                  observed.operator = readOperationAuthority(
                    operation.authority,
                    operation.binding,
                  )?.operatorId;
                  observed.action = operation.binding.action;
                  expect(operation.input).toEqual({ independentlyConfirmed: true });
                  await tx.insert(invoiceSeries).values([
                    { nodeId: node.nodeId, code: "A-P000042", purpose: "standard" },
                    { nodeId: node.nodeId, code: "FF-P000042", purpose: "full" },
                    { nodeId: node.nodeId, code: "R-P000042", purpose: "rectificative" },
                  ]);
                },
              },
            },
          },
    ),
  };
});
const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });
const NODE = "f2000000-0000-4000-8000-000000000001";
const LOCATION = "f2000000-0000-4000-8000-000000000002";
const ADMIN = "f2000000-0000-4000-8000-000000000003";
const SOURCE = "f2000000-0000-4000-8000-000000000004";
const PASSWORD = "public-boot-test-admin";
const HASH = hashPassword(PASSWORD);
const KEY = Buffer.alloc(32, 0x25).toString("base64");
const RING = loadKeyRing({ WAITRON_CREDENTIALS_KEY: KEY, WAITRON_CREDENTIALS_KEY_VERSION: "1" });
it.each(["account", "key"])(
  "boot passes authenticated %s promotion input to enabled module activation",
  async (method) => {
    observed.operator = undefined;
    observed.action = undefined;
    observed.input = undefined;
    await suite.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "50000000R", legalName: "Boot Operation SL" });
    await suite.db.insert(locations).values({
      id: LOCATION,
      name: "Restaurant",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
    });
    await suite.db.insert(nodes).values({
      id: NODE,
      locationId: LOCATION,
      name: "Spare",
      filingModule: "none",
      taxModule: "vat",
    });
    await suite.db
      .insert(persons)
      .values({ id: ADMIN, displayName: "Administrator", role: "admin", passwordHash: HASH });
    await stampDeployment(suite.db, "preproduction");
    await setDeploymentMode(suite.db, NODE, "mirror");
    await writeMirrorConfig(suite.db, NODE, {
      relayUrl: "https://127.0.0.1:1/",
      boxHostname: "box.test",
      boxCaPem: "unused-ca",
      originNodeId: SOURCE,
    });
    await establishNodeIdentity({ ownerDb: suite.db, ring: RING }, NODE);
    const credentials =
      method === "account"
        ? { personId: ADMIN, password: PASSWORD }
        : { breakGlass: await mintBreakGlassSecret(suite.db, NODE) };
    const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-promotion-operation-"));
    let server: StartedServer | undefined;
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      for (const [index, set] of manifestSets().entries())
        await cp(migrations[index]!.migrationsFolder, join(scratch, "migrations", set.name), {
          recursive: true,
        });
      await writeFile(
        join(scratch, "modules.json"),
        JSON.stringify({ modules: { "fiscal-verifactu": false } }),
      );
      const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
      const [port] = await freePorts(1);
      server = await startServer({
        WAITRON_VENUE_DIR: dirname(database),
        WAITRON_STATE_DIR: scratch,
        WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_TILL_NODE_ID: NODE,
        WAITRON_TILL_LOCATION_ID: LOCATION,
        WAITRON_CREDENTIALS_KEY: KEY,
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
        WAITRON_ENV: "dev",
        WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
        WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
      });
      const response = await fetch(`http://127.0.0.1:${port}/management-api/promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...credentials,
          oldNodeNeutralised: true,
          moduleOperation: {
            binding: {
              module: "fiscal-none",
              action: "promote",
              eventId: "boot-event",
              sourceId: SOURCE,
              targetNodeId: NODE,
            },
            input: { publicEvidence: "signed" },
          },
        }),
      });
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
      expect(await response.json()).toEqual({ alreadyPrimary: false, restarting: true });
      expect(observed.input).toEqual({ publicEvidence: "signed" });
      expect(observed.action).toBe("promote");
      expect(observed.operator).toEqual(
        method === "account"
          ? ADMIN
          : { kind: "recovery-key", nodeId: NODE, eventId: "boot-event" },
      );
      expect((await suite.db.select().from(invoiceSeries)).map((row) => row.code).sort()).toEqual([
        "A-P000042",
        "FF-P000042",
        "R-P000042",
      ]);
      expect(await readSingletonRole(suite.db, NODE)).toBe("primary");
      await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM"));
    } finally {
      await server?.close();
      kill.mockRestore();
      await rm(scratch, { recursive: true, force: true });
    }
  },
  60_000,
);
