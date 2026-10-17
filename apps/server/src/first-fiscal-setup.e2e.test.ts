import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Agent } from "undici";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { emptyDrainResult } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyHistoricalTestVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue, venueFiscalSelection } from "@waitron/provisioning";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { enabledModules } from "@waitron/module";
import { createCatalogue, createProduct } from "@waitron/catalogue";
import { startServer, type StartedServer } from "./boot.js";
import { runEntry } from "./node-entry.js";
import { loadBoxEnv } from "./box-env.js";
import { readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { firstFiscalPublicDigest } from "./first-fiscal-delivery.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import {
  buildConfigurationBundle,
  encodeConfigurationBundle,
  decodeConfigurationBundle,
} from "./configuration-transfer.js";
import { request, PASSWORD, MODULE } from "../test/first-fiscal.js";

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
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const instant = Date.parse("2026-10-16T11:40:00Z"),
    monotonic = performance.now();
  vi.setSystemTime(instant);
  vi.spyOn(Date, "now").mockImplementation(
    () => instant + Math.trunc(performance.now() - monotonic),
  );
});
const selected = enabledModules(ALL_MODULES, venueFiscalSelection(ALL_MODULES, "ES-common").config);
const source = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function configurationArtifact() {
  const { password: _password, pin: _pin, ...admin } = request.admin;
  void _password;
  void _pin;
  const created = await applyHistoricalTestVenue(
    planVenue(
      {
        ...request,
        admin: { ...admin, passwordHash: hashPassword(PASSWORD), pinHash: hashPin("4826") },
      },
      selected,
    ),
    { db: source.db, modules: selected },
  );
  await withTransaction(source.db, async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Prepared menu" });
    await createProduct(tx, {
      catalogueId: catalogue.id,
      categoryId: null,
      name: "Prepared gazpacho",
      pricingUnit: "each",
      unitPrice: "7.25",
      vatClass: "general",
    });
  });
  const bundle = await buildConfigurationBundle(
    source.db,
    { ...created, sourceOperatorId: (await source.db.select().from(persons))[0]!.id },
    selected,
    new Date("2026-10-15T12:00:00Z"),
    await schemaVersionsByModule(source.db, selected),
  );
  return encodeConfigurationBundle(bundle, "synthetic import passphrase");
}

it.each([
  { newTaxpayer: false, change: "none", launch: "direct" },
  { newTaxpayer: false, change: "none", launch: "supervised" },
  { newTaxpayer: true, change: "none", launch: "direct" },
  { newTaxpayer: true, change: "none", launch: "supervised" },
  { newTaxpayer: false, change: "replacement", launch: "direct" },
  { newTaxpayer: false, change: "missing", launch: "direct" },
  { newTaxpayer: false, change: "none", launch: "direct", readinessAfterImport: true },
])(
  "$launch owned Live setup binds staged menu: new taxpayer $newTaxpayer, $change, readiness after import $readinessAfterImport",
  async ({ newTaxpayer, change, launch, readinessAfterImport }) => {
    const artifact = await configurationArtifact();
    const root = await mkdtemp(join(tmpdir(), "first-fiscal-joint-"));
    dirs.push(root);
    const stateDir = join(root, "state"),
      venueDir = join(root, "venue"),
      migrations = join(root, "migrations");
    await copyMigrationsRoot(migrations);
    await mkdir(stateDir);
    const [port] = await freePorts(1);
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
      if (launch === "direct") server = await startServer(env);
      else
        await runEntry({
          args: [],
          baseEnv: env,
          stateDir,
          venueDir,
          migrationsRoot: migrations,
          loadBoxEnv,
          readRecoveryState,
          writeRecoveryState,
          startServer: async (merged, base) => (server = await startServer(merged, base)),
          serveRecovery: async () => {
            throw new Error("unexpected recovery mode");
          },
          installShutdownHandlers: () => {},
          scheduleStayedUp: () => {},
          log: () => {},
        });
      expect(server).toBeDefined();
      agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
      const url = `https://127.0.0.1:${port}`;
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
        const response = await fetch(url + path, {
          dispatcher: agent,
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers() },
          body: JSON.stringify(body),
        } as RequestInit);
        return { status: response.status, body: await response.json() };
      };
      if (launch === "direct" && !newTaxpayer && change === "none") {
        const absent = await post("/setup-api/first-setup/claim", {
          clientClaimNonce: randomBytes(32).toString("base64url"),
          venue: request,
          configurationImport: true,
        });
        expect(absent).toMatchObject({
          status: 400,
          body: {
            error: { code: "setup.request_invalid", params: { field: "configurationImport" } },
          },
        });
        await expect(readFile(join(stateDir, "first-setup.json"))).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
      const staged = await fetch(url + "/setup-api/configuration", {
        dispatcher: agent,
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-waitron-export-passphrase": "synthetic import passphrase",
        },
        body: new Uint8Array(artifact).buffer,
      } as RequestInit);
      expect({ status: staged.status, body: await staged.json() }).toMatchObject({
        status: 200,
        body: { counts: { products: 1 } },
      });
      const venue = {
        ...request,
        ...(newTaxpayer ? { taxId: "B12345674", legalName: "New Olivo SL" } : {}),
      };
      if (launch === "direct" && !newTaxpayer && change === "none") {
        for (const [candidate, newTaxpayer, field] of [
          [request, true, "taxId"],
          [{ ...request, taxId: "B12345674" }, false, "configurationImport"],
        ] as const) {
          const refused = await post("/setup-api/first-setup/claim", {
            clientClaimNonce: randomBytes(32).toString("base64url"),
            venue: candidate,
            configurationImport: true,
            newTaxpayer,
          });
          expect(refused).toMatchObject({
            status: 400,
            body: { error: { code: "setup.request_invalid", params: { field } } },
          });
          await expect(readFile(join(stateDir, "first-setup.json"))).rejects.toMatchObject({
            code: "ENOENT",
          });
        }
      }
      const claim = await post("/setup-api/first-setup/claim", {
        clientClaimNonce: randomBytes(32).toString("base64url"),
        venue,
        configurationImport: true,
        newTaxpayer,
      });
      expect(claim).toMatchObject({
        status: 200,
        body: { state: { venue: { taxId: venue.taxId } } },
      });
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
      if (!readinessAfterImport) {
        const readiness = await post("/setup-api/fiscal-test", live);
        expect(readiness).toEqual({
          status: 200,
          body: { status: "accepted", testedAt: expect.any(String) },
        });
      }
      const reconfirm = async (purpose: string) => {
        const response = await post("/setup-api/first-setup/reconfirm", {
          password: PASSWORD,
          purpose,
        });
        expect(response.status).toBe(200);
        return response.body;
      };
      const challenge = await post("/setup-api/first-setup/preparation", {
        module: MODULE,
        proposal: { action: "clock-challenge" },
      });
      expect(challenge.status).toBe(200);
      const comparison = await post("/setup-api/first-setup/preparation", {
        module: MODULE,
        proposal: {
          action: "compare-clocks",
          browser: {
            challengeId: challenge.body.preparation.id,
            instantMs: Date.now(),
          },
        },
      });
      expect(comparison.status).toBe(200);
      const candidates = await post("/setup-api/first-setup/candidates", {
        module: MODULE,
        proposal: { answer: "no" },
        ...(await reconfirm("block-use")),
      });
      expect(candidates.status).toBe(200);
      state = candidates.body.state;
      const exported = await fetch(url + "/setup-api/first-setup/request", {
        dispatcher: agent,
        headers: headers(),
      } as RequestInit);
      expect(exported.status).toBe(200);
      const prepared = (await exported.json()).modules[0].request;
      expect(prepared).toMatchObject({
        kind: "waitron-hour-setup",
        status: "selected",
        identity: "06RB",
      });
      const imported = await post("/setup-api/first-setup/input", {
        module: MODULE,
        input: prepared.input,
      });
      expect(imported.status).toBe(200);
      state = imported.body.state;
      const keyStage = await post("/setup-api/first-setup/node-key", await reconfirm("block-use"));
      expect(keyStage.status).toBe(200);
      const statement = {
        kind: "waitron-recovery-document",
        version: 1,
        scope: { taxpayerNif: venue.taxId, softwareId: "W1", environment: "production" },
        taxpayerName: venue.legalName,
        venueName: venue.location.name,
        createdAt: new Date().toISOString(),
        nodeKey: { nodeId: keyStage.body.stage.nodeId, name: keyStage.body.stage.name },
      };
      const delivery = {
        module: MODULE,
        stageId: keyStage.body.stage.stageId,
        inputDigest: firstFiscalPublicDigest(prepared.input),
        bindingDigest: firstFiscalPublicDigest(statement),
        documentDigest: firstFiscalPublicDigest({ syntheticPdf: true, statement }),
      };
      expect(
        (await post("/setup-api/first-setup/recovery-document", { ...delivery, statement })).status,
      ).toBe(200);
      expect(
        (
          await post("/setup-api/first-setup/recovery-document-kept", {
            ...delivery,
            kept: true,
            ...(await reconfirm("activation")),
          })
        ).status,
      ).toBe(200);
      if (readinessAfterImport) {
        expect(await post("/setup-api/fiscal-test", live)).toEqual({
          status: 200,
          body: { status: "accepted", testedAt: expect.any(String) },
        });
      }
      if (change === "replacement") {
        const replacement = decodeConfigurationBundle(artifact, "synthetic import passphrase");
        replacement.createdAt = "2026-10-16T12:00:00.000Z";
        await writeFile(
          join(stateDir, "configuration-import.artifact"),
          encodeConfigurationBundle(replacement, "synthetic import passphrase"),
        );
      } else if (change === "missing") {
        await rm(join(stateDir, "configuration-import.json"));
      }
      if (change === "none" && launch === "direct" && !newTaxpayer) {
        const { email: _email, ...beforeEmail } = live;
        void _email;
        expect(await post("/setup-api/provision", beforeEmail)).toMatchObject({
          status: 400,
          body: { error: { code: "setup.email_required", params: { field: "email" } } },
        });
      }
      const activated = await post("/setup-api/provision", live);
      if (change !== "none") {
        expect(activated).toMatchObject({
          status: change === "replacement" ? 409 : 400,
          body: {
            error: {
              code: change === "replacement" ? "setup.attempt_conflict" : "setup.request_invalid",
            },
          },
        });
        const disk = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
        expect(disk.status).toBe("consumption-intent");
        expect(disk.consumptionIntent).toBe(true);
        expect(await readFile(join(stateDir, "configuration-import.artifact"))).not.toHaveLength(0);
        await server!.close();
        server = undefined;
        const untouched = new DatabaseSync(join(venueDir, "venue.db"), { readOnly: true });
        try {
          expect(untouched.prepare("select count(*) as n from tenants").get()?.n).toBe(0);
          expect(untouched.prepare("select count(*) as n from fiscal_allocations").get()?.n).toBe(
            0,
          );
        } finally {
          untouched.close();
        }
        return;
      }
      expect(activated).toMatchObject({ status: 200, body: { provisioned: true } });
      await server!.close();
      server = undefined;
      const db = new DatabaseSync(join(venueDir, "venue.db"), { readOnly: true });
      try {
        expect(db.prepare("select name from products").all()).toEqual([
          { name: "Prepared gazpacho" },
        ]);
        expect(db.prepare("select tax_id as taxId from tenants").all()).toEqual([
          { taxId: venue.taxId },
        ]);
        expect(db.prepare("select count(*) as n from fiscal_allocations").get()?.n).toBe(1);
        expect(db.prepare("select count(*) as n from registros_facturacion").get()?.n).toBe(0);
      } finally {
        db.close();
      }
      const readinessDirs = (await readdir(stateDir)).filter((name) =>
        name.startsWith("fiscal-readiness-db-"),
      );
      expect(readinessDirs).toHaveLength(1);
      const isolated = new DatabaseSync(join(stateDir, readinessDirs[0]!, "venue.db"), {
        readOnly: true,
      });
      try {
        expect(isolated.prepare("select environment from deployment").all()).toEqual([
          { environment: "preproduction" },
        ]);
        expect(isolated.prepare("select id from nodes").all()).not.toContainEqual({
          id: claim.body.state.nodeId,
        });
        expect(
          isolated.prepare("select id from persons where role = 'admin'").all(),
        ).not.toContainEqual({ id: claim.body.state.administratorId });
        expect(isolated.prepare("select environment from fiscal_allocations").all()).toEqual([
          { environment: "preproduction" },
        ]);
        expect(isolated.prepare("select count(*) as n from registros_facturacion").get()?.n).toBe(
          1,
        );
        expect(
          isolated
            .prepare("select count(*) as n from products where name = 'Prepared gazpacho'")
            .get()?.n,
        ).toBe(0);
      } finally {
        isolated.close();
      }
      const persisted = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
      expect(persisted.status).toBe("complete");
      expect(persisted.frozen.configurationImport).toEqual({
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        newTaxpayer,
      });
      await expect(readFile(join(stateDir, "configuration-import.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const merged = await loadBoxEnv(env, stateDir);
      server = await startServer(merged, env);
      const health = await fetch(url + "/health", { dispatcher: agent } as RequestInit);
      expect(health.status).toBe(200);
      const setup = await fetch(url + "/setup-api/first-setup/status", {
        dispatcher: agent,
      } as RequestInit);
      expect(setup.status).toBe(404);
      await server.close();
      server = undefined;
      const restarted = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
      expect(restarted.frozen).toEqual(persisted.frozen);
      expect(restarted.result).toEqual(persisted.result);
    } finally {
      await server?.close();
      await agent?.close();
    }
  },
);

it("accepts real retained readiness before the wizard collects email settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "first-fiscal-before-email-"));
  dirs.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue"),
    migrations = join(root, "migrations");
  await copyMigrationsRoot(migrations);
  const [port] = await freePorts(1);
  const server = await startServer({
    WAITRON_ENV: "production",
    WAITRON_STATE_DIR: stateDir,
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_MIGRATIONS_DIR: migrations,
    WAITRON_HTTP_HOST: "127.0.0.1",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_MANAGEMENT_RP_ID: "localhost",
    WAITRON_MANAGEMENT_ORIGIN: "https://localhost",
  });
  const agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
  try {
    const url = `https://127.0.0.1:${port}`;
    const claimed = await fetch(url + "/setup-api/first-setup/claim", {
      dispatcher: agent,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientClaimNonce: randomBytes(32).toString("base64url"),
        venue: request,
      }),
    } as RequestInit);
    expect(claimed.status).toBe(200);
    const claim = await claimed.json();
    const response = await fetch(url + "/setup-api/fiscal-test", {
      dispatcher: agent,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waitron-Setup-Owner": claim.capability,
        "X-Waitron-Setup-Attempt": claim.state.attemptId,
        "X-Waitron-Setup-Revision": String(claim.state.revision),
        "X-Waitron-Setup-Generation": String(claim.state.ownerGeneration),
      },
      body: JSON.stringify({
        mode: "live",
        firstSetup: { attemptId: claim.state.attemptId, revision: claim.state.revision },
        aeatCert: { pfxBase64: "c3ludGhldGlj", passphrase: "synthetic", certKind: "sello" },
      }),
    } as RequestInit);
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 200,
      body: { status: "accepted", testedAt: expect.any(String) },
    });
    const retained = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
    expect(retained.status).toBe("claimed");
    expect(retained.consumptionIntent).toBe(false);
  } finally {
    await server.close();
    await agent.close();
  }
});
