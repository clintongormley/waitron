import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Agent } from "undici";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { invoiceSeries, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createCatalogue, createProduct } from "@waitron/catalogue";
import { emptyDrainResult } from "@waitron/fiscal";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules } from "@waitron/module";
import {
  applyVenue,
  initialVenueApplyInput,
  planVenue,
  venueFiscalSelection,
} from "@waitron/provisioning";
import { request, PASSWORD } from "../test/first-fiscal.js";
import { ownedHourSetup } from "../test/owned-hour-setup.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { startServer, type StartedServer } from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import {
  buildConfigurationBundle,
  decodeConfigurationBundle,
  encodeConfigurationBundle,
} from "./configuration-transfer.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { mountSetup } from "./setup-api.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";

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
                required: (environment: string) => environment === "production",
                validate: () => {},
                seal: async () => {},
              },
              drain: async () => ({ ...emptyDrainResult(), recordsAccepted: 1 }),
            },
          },
    ),
  };
});
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => {
    const now = Date.now(),
      mono = performance.now();
    return {
      source: "internet",
      result: "usable",
      instantMs: now,
      uncertaintyMs: 500,
      wallStartedMs: now,
      wallFinishedMs: now,
      monotonicStartedMs: mono,
      monotonicFinishedMs: mono,
    };
  },
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const source = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const roots: string[] = [];
let clockInstant = 0;
let clockMonotonic = 0;
function setClock(instant: string) {
  clockInstant = Date.parse(instant);
  clockMonotonic = performance.now();
  vi.setSystemTime(clockInstant);
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setClock("2026-10-16T11:40:00Z");
  vi.spyOn(Date, "now").mockImplementation(
    () => clockInstant + Math.trunc(performance.now() - clockMonotonic),
  );
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function configurationArtifact() {
  setClock("2026-10-16T10:40:00Z");
  const root = await mkdtemp(join(tmpdir(), "hour-import-source-"));
  roots.push(root);
  const host = createFirstSetupModuleHost({
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    modules: ALL_MODULES,
    environment: {},
    database: () => source.db,
  });
  const app = new Hono();
  mountSetup(app, { environment: "preproduction", devMode: true, firstFiscal: host }, () => {});
  const owned = await ownedHourSetup(
    async (input, init) => app.request(String(input), init),
    "https://source.test",
    request,
    PASSWORD,
  );
  const state = (await host.store.read())!;
  const selected = enabledModules(
    host.modules,
    venueFiscalSelection(host.modules, "ES-common").config,
  );
  await stampDeployment(source.db, "preproduction");
  const created = await host.coordinator.run(() =>
    applyVenue(planVenue(state.frozen.request, selected), {
      db: source.db,
      modules: selected,
      ...initialVenueApplyInput(owned.initialOperations),
    }),
  );
  await withTransaction(source.db, async (tx) => {
    await tx.update(invoiceSeries).set({ nextNumber: 42 });
    const catalogue = await createCatalogue(tx, { name: "Imported menu" });
    await createProduct(tx, {
      catalogueId: catalogue.id,
      categoryId: null,
      name: "Imported gazpacho",
      pricingUnit: "each",
      unitPrice: "7.25",
      vatClass: "general",
    });
  });
  expect(
    (await source.db.select().from(invoiceSeries)).map(({ code, nextNumber }) => ({
      code,
      nextNumber,
    })),
  ).toEqual([
    { code: "A-06RA", nextNumber: 42 },
    { code: "FF-06RA", nextNumber: 42 },
    { code: "R-06RA", nextNumber: 42 },
  ]);
  setClock("2026-10-16T11:40:00Z");
  const bundle = await buildConfigurationBundle(
    source.db,
    {
      ...created,
      sourceOperatorId: (await source.db.select().from(persons))[0]!.id,
    },
    selected,
    new Date("2026-10-15T12:00:00Z"),
    await schemaVersionsByModule(source.db, selected),
  );
  for (const name of [
    "invoice_series",
    "fiscal_allocations",
    "registros_facturacion",
    "registro_sif",
  ])
    expect(bundle.tables).not.toHaveProperty(name);
  return {
    artifact: encodeConfigurationBundle(bundle, "import passphrase"),
    sourceNodeId: created.nodeId,
    sourceAdministratorId: state.frozen.administratorId,
  };
}

it.each([
  { environment: "preproduction", newTaxpayer: false, change: "none" },
  { environment: "preproduction", newTaxpayer: true, change: "none" },
  { environment: "production", newTaxpayer: false, change: "none" },
  { environment: "production", newTaxpayer: true, change: "none" },
  { environment: "preproduction", newTaxpayer: false, change: "replacement" },
  { environment: "preproduction", newTaxpayer: false, change: "missing" },
] as const)(
  "$environment hour setup imports configuration with fresh counters ($newTaxpayer, $change)",
  async ({ environment, newTaxpayer, change }) => {
    const { artifact, sourceNodeId, sourceAdministratorId } = await configurationArtifact();
    const root = await mkdtemp(join(tmpdir(), "hour-import-"));
    roots.push(root);
    const stateDir = join(root, "state"),
      venueDir = join(root, "venue"),
      migrations = join(root, "migrations");
    await mkdir(stateDir);
    await copyMigrationsRoot(migrations);
    const [port] = await freePorts(1);
    const env = {
      WAITRON_ENV: environment === "preproduction" ? "dev" : "production",
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
      server = await startServer(env);
      agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
      const base = `https://127.0.0.1:${port}`;
      const transport: typeof fetch = (input, init) =>
        fetch(input, { ...init, dispatcher: agent } as RequestInit);
      const staged = await transport(`${base}/setup-api/configuration`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-waitron-export-passphrase": "import passphrase",
        },
        body: new Uint8Array(artifact).buffer,
      });
      expect({ status: staged.status, body: await staged.json() }).toMatchObject({
        status: 200,
        body: { counts: { products: 1 } },
      });
      const target = {
        ...request,
        ...(newTaxpayer ? { taxId: "B12345674", legalName: "New Olivo SL" } : {}),
      };
      const owned = await ownedHourSetup(transport, base, target, PASSWORD, {
        configurationImport: true,
        newTaxpayer,
      });
      const preparation = await readFile(join(stateDir, "module-preparation-state.json"), "utf8");
      const live = {
        mode: "live",
        ...(environment !== "production"
          ? {}
          : {
              aeatCert: { pfxBase64: "c3ludGhldGlj", passphrase: "synthetic", certKind: "sello" },
              email: {
                server: "smtp.example.test",
                port: 465,
                encryption: "tls",
                user: "test",
                password: "test",
                from: "owner@example.test",
              },
            }),
      };
      if (environment === "production") {
        const readiness = await transport(`${base}/setup-api/fiscal-test`, {
          method: "POST",
          headers: owned.headers,
          body: JSON.stringify(live),
        });
        expect({ status: readiness.status, body: await readiness.json() }).toMatchObject({
          status: 200,
          body: { status: "accepted" },
        });
      }
      if (change === "replacement") {
        const replaced = decodeConfigurationBundle(artifact, "import passphrase");
        replaced.createdAt = "2026-10-16T12:00:00.000Z";
        await writeFile(
          join(stateDir, "configuration-import.artifact"),
          encodeConfigurationBundle(replaced, "import passphrase"),
        );
      } else if (change === "missing") await rm(join(stateDir, "configuration-import.json"));
      const response = await transport(`${base}/setup-api/provision`, {
        method: "POST",
        headers: owned.headers,
        body: JSON.stringify(live),
      });
      const result = { status: response.status, body: await response.json() };
      if (change === "none")
        expect(result).toMatchObject({
          status: 200,
          body: { provisioned: true, restarting: true },
        });
      else
        expect(result).toMatchObject({
          status: change === "replacement" ? 409 : 400,
          body: {
            error: {
              code: change === "replacement" ? "setup.attempt_conflict" : "setup.request_invalid",
            },
          },
        });
      expect(await readFile(join(stateDir, "module-preparation-state.json"), "utf8")).toBe(
        preparation,
      );
      await server.close();
      server = undefined;
      const disk = new DatabaseSync(join(venueDir, "venue.db"), { readOnly: true });
      try {
        if (change !== "none") {
          expect(disk.prepare("select count(*) as n from tenants").get()?.n).toBe(0);
          expect(disk.prepare("select count(*) as n from fiscal_allocations").get()?.n).toBe(0);
          expect(disk.prepare("select count(*) as n from products").get()?.n).toBe(0);
        } else {
          expect(disk.prepare("select name from products").all()).toEqual([
            { name: "Imported gazpacho" },
          ]);
          expect(disk.prepare("select tax_id as taxId from tenants").all()).toEqual([
            { taxId: target.taxId },
          ]);
          expect(
            disk
              .prepare(
                "select code, purpose, next_number as nextNumber from invoice_series order by purpose",
              )
              .all(),
          ).toEqual([
            { code: "FF-06RB", purpose: "full", nextNumber: 1 },
            { code: "R-06RB", purpose: "rectificative", nextNumber: 1 },
            { code: "A-06RB", purpose: "standard", nextNumber: 1 },
          ]);
          expect(
            disk
              .prepare(
                "select environment, installation_identity as identity from fiscal_allocations",
              )
              .all(),
          ).toEqual([{ environment, identity: "06RB" }]);
          expect(disk.prepare("select count(*) as n from registros_facturacion").get()?.n).toBe(0);
          expect(disk.prepare("select id from nodes").all()).not.toContainEqual({
            id: sourceNodeId,
          });
          expect(disk.prepare("select id from persons").all()).not.toContainEqual({
            id: sourceAdministratorId,
          });
        }
      } finally {
        disk.close();
      }
      const saved = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
      expect(saved.status).toBe(change === "none" ? "complete" : "consumption-intent");
      expect(saved.frozen.configurationImport).toEqual({
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        newTaxpayer,
      });
      if (change === "none") {
        await expect(readFile(join(stateDir, "configuration-import.json"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        server = await startServer(await loadBoxEnv(env, stateDir), env);
        expect((await transport(`${base}/health`)).status).toBe(200);
        expect((await transport(`${base}/setup-api/first-setup/status`)).status).toBe(404);
        await server.close();
        server = undefined;
        const restarted = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
        expect(restarted.frozen).toEqual(saved.frozen);
        expect(restarted.result).toEqual(saved.result);
      }
    } finally {
      await server?.close();
      await agent?.close();
    }
  },
);
