import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CORE_MIGRATIONS, tenants } from "@waitron/db";
import * as filesystem from "node:fs/promises";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { mkdtemp, readFile, rm, symlink, cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { Agent } from "undici";
import { emptyDrainResult } from "@waitron/fiscal";
import { startServer, type StartedServer } from "./boot.js";
import * as trading from "./trading-config.js";
import { parseEnvFile } from "./env-file.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { request, PASSWORD, MODULE } from "../test/first-fiscal.js";
import { firstFiscalPublicDigest } from "./first-fiscal-delivery.js";
import { DatabaseSync } from "node:sqlite";

vi.mock("./trading-config.js", { spy: true });
vi.mock("node:fs/promises", { spy: true });
vi.mock("./fiscal-readiness.js", { spy: true });
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => {
    const wall = Date.now(),
      monotonic = performance.now();
    return {
      source: "internet",
      result: "usable",
      instantMs: wall,
      uncertaintyMs: 500,
      wallStartedMs: wall,
      wallFinishedMs: wall,
      monotonicStartedMs: monotonic,
      monotonicFinishedMs: monotonic,
    };
  },
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
const existing = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it.each(["trading", "completion-state", "completion-marker"])(
  "real HTTPS claim readiness stays preproduction and %s interruption restarts a separate process in owner setup",
  async (point) => {
    const root = await mkdtemp(join(tmpdir(), "first-fiscal-boot-"));
    dirs.push(root);
    const stateDir = join(root, "state"),
      venueDir = join(root, "venue"),
      migrations = join(root, "migrations");
    await copyMigrationsRoot(migrations);
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
    const original = (
      await vi.importActual<typeof import("./trading-config.js")>("./trading-config.js")
    ).writeTradingEnv;
    let injected = false;
    try {
      server = await startServer(env);
      agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
      const nonce = randomBytes(32).toString("base64url");
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
        clientClaimNonce: nonce,
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
      const challenge = await post("/setup-api/first-setup/preparation", {
        module: MODULE,
        proposal: { action: "clock-challenge" },
      });
      expect(challenge.status).toBe(200);
      const comparison = await post("/setup-api/first-setup/preparation", {
        module: MODULE,
        proposal: {
          action: "compare-clocks",
          browser: { challengeId: challenge.body.preparation.id, instantMs: Date.now() },
        },
      });
      expect(comparison.status).toBe(200);
      if (comparison.body.preparation.clock.requiresConfirmation) {
        const confirmed = await post("/setup-api/first-setup/preparation", {
          module: MODULE,
          proposal: {
            action: "confirm-clock",
            comparisonId: comparison.body.preparation.id,
          },
        });
        expect(confirmed.status).toBe(200);
      }
      const reconfirm = await post("/setup-api/first-setup/reconfirm", {
        password: PASSWORD,
        purpose: "block-use",
      });
      expect(reconfirm.status).toBe(200);
      const chosen = await post("/setup-api/first-setup/candidates", {
        module: MODULE,
        proposal: { answer: "no" },
        ...reconfirm.body,
      });
      expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
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
        installationCodes: [prepared.allocation.installationIdentity],
        version: 1,
        scope: { taxpayerNif: request.taxId, softwareId: "W1", environment: "production" },
        taxpayerName: request.legalName,
        venueName: request.location.name,
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
      // Readiness returned uncertain, so this test injects only that outside response; its real local
      // throwaway activation and the real production activation remain in the boot call chain.
      const readinessModule = await import("./fiscal-readiness.js");
      const ready = vi.spyOn(readinessModule, "createFiscalReadinessStore").mockReturnValue({
        run: async () => ({ status: "ready" }),
        assertReady: async () => {},
      } as never);
      vi.spyOn(trading, "writeTradingEnv").mockImplementation(async (...args) => {
        const result = await original(...args);
        if (!injected && point === "trading") {
          injected = true;
          throw new Error("after actual trading publication");
        }
        return result;
      });
      const fileIo = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
        const target = String(to);
        if (
          !injected &&
          ((point === "completion-state" && target.endsWith("/first-setup.json")) ||
            (point === "completion-marker" && target.endsWith("/first-setup-claim.json")))
        ) {
          const value = JSON.parse(await fileIo.readFile(from, "utf8"));
          if (value.status === "complete") {
            injected = true;
            throw new Error("before " + point);
          }
        }
        return fileIo.rename(from, to);
      });
      const activated = await post("/setup-api/provision", live);
      expect(activated.status).toBe(point === "trading" ? 500 : 409);
      expect(injected).toBe(true);
      ready.mockRestore();
      await server.close();
      server = undefined;
      const persisted = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
      expect(persisted.status).toBe(
        point === "trading"
          ? "committed"
          : point === "completion-state"
            ? "publication"
            : "complete",
      );
      const tradingEnv = parseEnvFile(await readFile(join(stateDir, "trading.env"), "utf8"));
      expect(tradingEnv.WAITRON_TILL_NODE_ID).toBe(claim.body.state.nodeId);
      const childFile = join(root, "restart-child.mjs");
      await cp(resolve("src/assets"), join(root, "assets"), { recursive: true });
      await symlink(resolve("node_modules"), join(root, "node_modules"));
      await build({
        entryPoints: [resolve("src/bin.ts")],
        outfile: childFile,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node24",
        external: ["sharp"],
        banner: {
          js: "import { createRequire as __waitronCreateRequire } from 'node:module'; const require = __waitronCreateRequire(import.meta.url);",
        },
        logLevel: "silent",
      });
      const secrets = parseEnvFile(await readFile(join(stateDir, "secrets.env"), "utf8"));
      const child = spawn(process.execPath, [childFile], {
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith("WAITRON_")),
          ),
          ...env,
          ...secrets,
          ...tradingEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const closed = once(child, "close");
      let output = "";
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });
      try {
        await new Promise<void>((resolveReady, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("restart child did not listen: " + output)),
            30000,
          );
          const finish = () => clearTimeout(timeout);
          child.stdout.on("data", (chunk) => {
            output += String(chunk);
            if (output.includes('"event":"recovery.listening"')) {
              finish();
              resolveReady();
            }
          });
          child.once("error", (error) => {
            finish();
            reject(error);
          });
          child.once("exit", () => {
            finish();
            reject(new Error("restart child exited before listening: " + output));
          });
        });
        const childStatus = await fetch(`https://127.0.0.1:${port}/setup-api/first-setup/status`, {
          dispatcher: agent,
        } as RequestInit);
        expect(childStatus.status).toBe(200);
        expect(await childStatus.json()).toEqual({ claimed: true, resolution: true });
      } finally {
        if (child.pid !== undefined && child.exitCode === null) child.kill("SIGTERM");
        await closed;
      }
      server = await startServer({ ...env, ...tradingEnv });
      const resumedStatus = await fetch(`https://127.0.0.1:${port}/setup-api/first-setup/status`, {
        dispatcher: agent,
      } as RequestInit);
      expect(resumedStatus.status).toBe(200);
      expect(await resumedStatus.json()).toEqual({ claimed: true });
      const resumed = await post("/setup-api/first-setup/resume", {
        clientClaimNonce: nonce,
        password: PASSWORD,
      });
      expect(resumed.status).toBe(200);
      expect(resumed.body.state.attemptId).toBe(claim.body.state.attemptId);
      await server.close();
      server = undefined;
      await rm(join(stateDir, "first-setup.json"));
      await rm(join(venueDir, "first-setup-claim.json"));
      server = await startServer(env);
      const lost = await post("/setup-api/first-setup/claim", {
        clientClaimNonce: randomBytes(32).toString("base64url"),
        venue: request,
      });
      expect(lost.status).toBe(409);
      await expect(readFile(join(stateDir, "first-setup.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await server.close();
      server = undefined;
      const db = new DatabaseSync(join(venueDir, "venue.db"), { readOnly: true });
      try {
        expect(db.prepare("select count(*) as n from fiscal_allocations").get()?.n).toBe(1);
        expect(db.prepare("select count(*) as n from registros_facturacion").get()?.n).toBe(0);
        expect(db.prepare("select next_number from invoice_series").all()).toEqual([
          { next_number: 1 },
          { next_number: 1 },
          { next_number: 1 },
        ]);
      } finally {
        db.close();
      }
    } finally {
      await server?.close();
      await agent?.close();
    }
  },
);

it("refuses a fresh owner claim when only a taxpayer survives in the database", async () => {
  const root = await mkdtemp(join(tmpdir(), "first-fiscal-survivor-"));
  dirs.push(root);
  const venueDir = join(root, "venue"),
    stateDir = join(root, "state"),
    migrations = join(root, "migrations");
  await mkdir(venueDir);
  await copyMigrationsRoot(migrations);
  await existing.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: request.taxId, legalName: request.legalName });
  await existing.db.archiveTo(join(venueDir, "venue.db"));
  const [port] = await freePorts(1);
  let server: StartedServer | undefined, agent: Agent | undefined;
  try {
    server = await startServer({
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
    agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
    const response = await fetch(`https://127.0.0.1:${port}/setup-api/first-setup/claim`, {
      dispatcher: agent,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientClaimNonce: randomBytes(32).toString("base64url"),
        venue: request,
      }),
    } as RequestInit);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("setup.attempt_conflict");
    await expect(readFile(join(stateDir, "first-setup.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await server?.close();
    await agent?.close();
  }
});
