import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, cp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { Agent } from "undici";
import { afterEach, expect, it, vi } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { startServer, type StartedServer } from "./boot.js";
import { runEntry } from "./node-entry.js";
import { loadBoxEnv } from "./box-env.js";
import { readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { initialSetupInput } from "./testing/allocated-provision.js";
import { freePorts } from "./testing/free-ports.js";
import { request, firstFiscalFixture, MODULE, PASSWORD } from "../test/first-fiscal.js";
import { publicFirstFiscalInput } from "../test/first-fiscal-public.js";

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
              // Qualify local owner activation and evidence retention without an AEAT submission.
              activationReadiness: "not-applicable",
              activationReadinessTarget: undefined,
            },
          },
    ),
  };
});

const dirs: string[] = [];
function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      args,
      { env, timeout: 60000 },
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stdout, stderr }));
        else resolve({ stdout, stderr });
      },
    );
    child.stdin?.end();
  });
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function launchFixture(ownerSetup = false) {
  const root = await mkdtemp(join(tmpdir(), "fiscal-launch-"));
  dirs.push(root);
  const stateDir = join(root, "state");
  await mkdir(stateDir);
  const input = await initialSetupInput(stateDir, request);
  const evidenceEnv = Object.fromEntries(
    [
      "WAITRON_FISCAL_CUSTODIAN_FILE",
      "WAITRON_FISCAL_CONFIRMATION_FILE",
      "WAITRON_FISCAL_CUSTODIAN_FINGERPRINT",
    ].map((key) => [key, process.env[key]]),
  );
  vi.unstubAllEnvs();
  for (const key of Object.keys(evidenceEnv)) vi.stubEnv(key, "wrong-ambient-value");
  const [port] = await freePorts(1);
  const migrationsRoot = join(root, "migrations");
  for (const [i, set] of manifestSets().entries())
    await cp(
      migrationOptionsFor(manifestSets(), null)[i]!.migrationsFolder,
      join(migrationsRoot, set.name),
      { recursive: true },
    );
  const base = {
    WAITRON_STATE_DIR: stateDir,
    WAITRON_VENUE_DIR: join(root, "venue"),
    WAITRON_HTTP_HOST: "127.0.0.1",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: ownerSetup ? "dev" : "preproduction",
  };
  return { root, stateDir, input, evidenceEnv, base, port };
}
it.each(["direct", "supervised"])(
  "%s launch retains its passed/file-merged fiscal evidence and activates owner setup despite conflicting process.env",
  async (kind) => {
    const f = await launchFixture(true);
    let server: StartedServer | undefined;
    const killed = vi.spyOn(process, "kill").mockReturnValue(true);
    let agent: Agent | undefined;
    try {
      if (kind === "direct") server = await startServer({ ...f.base, ...f.evidenceEnv });
      else {
        await writeFile(
          join(f.stateDir, "backup.env"),
          Object.entries(f.evidenceEnv)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n") + "\n",
        );
        await runEntry({
          args: [],
          baseEnv: f.base,
          stateDir: f.stateDir,
          venueDir: f.base.WAITRON_VENUE_DIR,
          migrationsRoot: f.base.WAITRON_MIGRATIONS_DIR,
          loadBoxEnv,
          readRecoveryState,
          writeRecoveryState,
          startServer: async (env, base) => (server = await startServer(env, base)),
          serveRecovery: async () => {
            throw new Error("launch entered recovery");
          },
          installShutdownHandlers: () => {},
          scheduleStayedUp: () => {},
          log: () => {},
        });
      }
      expect(server).toBeDefined();
      agent = new Agent({ connect: { ca: await readFile(join(f.stateDir, "tls", "ca.crt")) } });
      let capability = "";
      let state: { attemptId: string; revision: number; ownerGeneration: number };
      const headers = () =>
        capability
          ? {
              "X-Waitron-Setup-Owner": capability,
              "X-Waitron-Setup-Attempt": state.attemptId,
              "X-Waitron-Setup-Revision": String(state.revision),
              "X-Waitron-Setup-Generation": String(state.ownerGeneration),
            }
          : {};
      const post = async (action: string, body: unknown) => {
        const response = await fetch(
          `https://127.0.0.1:${f.port}/setup-api/first-setup/${action}`,
          {
            dispatcher: agent,
            method: "POST",
            headers: { "content-type": "application/json", ...headers() },
            body: JSON.stringify(body),
          } as RequestInit,
        );
        const result = await response.json();
        expect({ status: response.status, body: result }).toEqual({
          status: 200,
          body: expect.any(Object),
        });
        if (result.state !== undefined) state = result.state;
        return result;
      };
      const claim = await post("claim", {
        clientClaimNonce: randomBytes(32).toString("base64url"),
        venue: request,
      });
      capability = claim.capability;
      await post("candidates", {
        module: MODULE,
        proposal: { serials: [1] },
        ...(await post("reconfirm", { password: PASSWORD, purpose: "block-use" })),
      });
      const exported = await fetch(`https://127.0.0.1:${f.port}/setup-api/first-setup/request`, {
        dispatcher: agent,
        headers: headers(),
      } as RequestInit);
      expect(exported.status).toBe(200);
      const signed = publicFirstFiscalInput((await exported.json()).modules[0].request);
      f.input.nodeId = claim.state.nodeId;
      await post("input", { module: MODULE, input: signed.input });
      await post("enrol", {
        module: MODULE,
        publicKey: signed.key,
        comparison: signed.key.fingerprint,
      });
      await post("current-master", {
        module: MODULE,
        statement: signed.current,
        ...(await post("reconfirm", { password: PASSWORD, purpose: "activation" })),
      });
      const outside = [signed.key, signed.current].map((value) => JSON.stringify(value));
      for (const [index, key] of [
        "WAITRON_FISCAL_CUSTODIAN_FILE",
        "WAITRON_FISCAL_CONFIRMATION_FILE",
      ].entries())
        await writeFile(f.evidenceEnv[key]!, outside[index]!);
      const inspected = await fetch(
        `https://127.0.0.1:${f.port}/setup-api/first-setup/resolution`,
        { dispatcher: agent } as RequestInit,
      );
      expect(inspected.status).toBe(200);
      expect(
        (await inspected.json()).artifacts.filter((entry: { name: string }) =>
          entry.name.startsWith("outside-evidence-"),
        ),
      ).toEqual(
        outside.map((bytes, index) => ({
          name: `outside-evidence-${index}`,
          status: "present",
          digest: createHash("sha256").update(bytes).digest("hex"),
        })),
      );
      const response = await fetch(`https://127.0.0.1:${f.port}/setup-api/provision`, {
        dispatcher: agent,
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify({ mode: "live" }),
      } as RequestInit);
      const result = await response.json();
      expect({ status: response.status, body: result }).toEqual({
        status: 200,
        body: {
          provisioned: true,
          restarting: true,
          openingHours: { departmentId: expect.any(String) },
        },
      });
      await vi.waitFor(() => expect(killed).toHaveBeenCalledWith(process.pid, "SIGTERM"));
      await server!.close();
      server = undefined;
      const db = await openVenueDatabase(f.base.WAITRON_VENUE_DIR);
      try {
        const rows = await db.venue.select().from(fiscalAllocations);
        expect(
          rows.map((row) => ({
            nodeId: row.nodeId,
            environment: row.environment,
            identity: row.installationIdentity,
          })),
        ).toEqual([{ nodeId: f.input.nodeId, environment: "preproduction", identity: "S000001" }]);
      } finally {
        await db.close();
      }
    } finally {
      await agent?.close();
      await server?.close();
    }
  },
);
it("the real CLI public-input-file path works with explicit environment and refuses an outstanding wizard marker", async () => {
  const f = await launchFixture();
  const path = join(f.root, "initial.json");
  await writeFile(path, JSON.stringify(f.input));
  const args = [
    "--import",
    "tsx",
    resolve("../../packages/provisioning/src/bin.ts"),
    "venue",
    "--venue-dir",
    f.base.WAITRON_VENUE_DIR,
    "--country",
    "ES",
    "--tax-id",
    request.taxId,
    "--legal-name",
    request.legalName,
    "--taxpayer-domicile",
    "Mayor 1, Madrid",
    "--address-line2",
    "",
    "--location-name",
    "Olivo",
    "--territory",
    "ES-common",
    "--locale",
    "es-ES",
    "--operation-description",
    "Restaurante",
    "--address-line1",
    "Mayor 1",
    "--postal-code",
    "28001",
    "--city",
    "Madrid",
    "--province",
    "Madrid",
    "--time-zone",
    "Europe/Madrid",
    "--day-cutover",
    "06:00",
    "--series-code",
    "A",
    "--rectificative-code",
    "R",
    "--admin-name",
    "Elena",
    "--admin-email",
    "elena@example.test",
    "--yes",
  ];
  const env = {
    ...process.env,
    ...f.base,
    ...f.evidenceEnv,
    WAITRON_INITIAL_VENUE_INPUT: path,
    WAITRON_ADMIN_PASSWORD: "synthetic-password",
    WAITRON_ADMIN_PIN: "4826",
  };
  await applyMigrations(f.base.WAITRON_VENUE_DIR, migrationOptionsFor(manifestSets(), null));
  const child = await runCli(args, env);
  expect(child.stdout).toContain("S000001");
  const claimed = await firstFiscalFixture();
  try {
    const blocked = [...args];
    blocked[blocked.indexOf("--venue-dir") + 1] = claimed.venueDir;
    await expect(runCli(blocked, env)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("setup.attempt_uncertain"),
    });
  } finally {
    await claimed.dispose();
  }
});
