import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, cp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { Agent } from "undici";
import { afterEach, expect, it, vi } from "vitest";
import { invoiceSeries, openVenueDatabase, readDeploymentEnvironment } from "@waitron/db";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { startServer, type StartedServer } from "./boot.js";
import { runEntry } from "./node-entry.js";
import { loadBoxEnv } from "./box-env.js";
import { readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { initialSetupInput } from "./testing/allocated-provision.js";
import { freePorts } from "./testing/free-ports.js";
import { request, firstFiscalFixture, MODULE, PASSWORD } from "../test/first-fiscal.js";
import type { ModuleOperationHost } from "@waitron/module";
import { firstFiscalPublicDigest } from "./first-fiscal-delivery.js";

vi.mock("@waitron/composition", async (original) => {
  const actual = await original<typeof import("@waitron/composition")>();
  return {
    ...actual,
    ALL_MODULES: actual.ALL_MODULES.map((module) =>
      module.name !== "fiscal-verifactu"
        ? module
        : {
            ...module,
            provisioning: {
              ...module.provisioning,
              initialSetup: {
                ...module.provisioning!.initialSetup!,
                configure: (bound: ModuleOperationHost) => ({
                  ...module.provisioning!.initialSetup!.configure!(bound),
                  resolutionEvidence: () => ({
                    files: [
                      "WAITRON_FISCAL_CUSTODIAN_FILE",
                      "WAITRON_FISCAL_CONFIRMATION_FILE",
                    ].map((key) => bound.environment[key]!),
                    directories: [],
                  }),
                }),
              },
            },
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
const dirs: string[] = [];
function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
  answers: readonly (readonly [string, string])[] = [],
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      args,
      { env, timeout: 20000 },
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stdout, stderr }));
        else resolve({ stdout, stderr });
      },
    );
    if (answers.length === 0) child.stdin?.end();
    else {
      let output = "";
      const answered = new Map<string, number>();
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        for (const [question, answer] of answers) {
          const count = output.split(question).length - 1;
          for (let n = answered.get(question) ?? 0; n < count; n++)
            child.stdin?.write(`${answer}\n`);
          answered.set(question, count);
        }
      });
    }
  });
}
afterEach(async () => {
  vi.useRealTimers();
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
  "%s launch binds its passed/file-merged module evidence and activates owned hour setup despite conflicting process.env",
  async (kind) => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime("2026-10-16T11:40:00Z");
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
      const challenge = await post("preparation", {
        module: MODULE,
        proposal: { action: "clock-challenge" },
      });
      await post("preparation", {
        module: MODULE,
        proposal: {
          action: "compare-clocks",
          browser: { challengeId: challenge.preparation.id, instantMs: Date.now() },
        },
      });
      await post("candidates", {
        module: MODULE,
        proposal: { answer: "no" },
        ...(await post("reconfirm", { password: PASSWORD, purpose: "block-use" })),
      });
      const exported = await fetch(`https://127.0.0.1:${f.port}/setup-api/first-setup/request`, {
        dispatcher: agent,
        headers: headers(),
      } as RequestInit);
      expect(exported.status).toBe(200);
      const input = (await exported.json()).modules[0].request.input;
      f.input.nodeId = claim.state.nodeId;
      await post("input", { module: MODULE, input });
      const staged = await post(
        "node-key",
        await post("reconfirm", { password: PASSWORD, purpose: "block-use" }),
      );
      const statement = {
        kind: "waitron-recovery-document",
        installationCodes: [input.allocation.installationIdentity],
        version: 1,
        scope: { taxpayerNif: request.taxId, softwareId: "W1", environment: "preproduction" },
        taxpayerName: request.legalName,
        venueName: request.location.name,
        createdAt: new Date().toISOString(),
        nodeKey: { nodeId: staged.stage.nodeId, name: staged.stage.name },
      };
      const reference = {
        module: MODULE,
        stageId: staged.stage.stageId,
        inputDigest: firstFiscalPublicDigest(input),
        bindingDigest: firstFiscalPublicDigest(statement),
        documentDigest: "d".repeat(64),
      };
      await post("recovery-document", { ...reference, statement });
      await post("recovery-document-kept", {
        ...reference,
        kept: true,
        ...(await post("reconfirm", { password: PASSWORD, purpose: "activation" })),
      });
      const outside = ['{"synthetic":"public-source"}', '{"synthetic":"outside-history"}'];
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
        ).toEqual([{ nodeId: f.input.nodeId, environment: "preproduction", identity: "06RB" }]);
      } finally {
        await db.close();
      }
    } finally {
      await agent?.close();
      await server?.close();
    }
  },
);
it("the built owned CLI refuses JSON authority, completes preproduction, and refuses an outstanding wizard marker", async () => {
  const f = await launchFixture();
  const path = join(f.root, "initial.json");
  await writeFile(path, JSON.stringify(f.input));
  const binary = join(f.root, "provision.mjs");
  await runCli(
    [
      "--input-type=module",
      "--eval",
      `import { bundle } from "../../scripts/bundle-node.mjs";
    bundle([{ entry: "../../packages/provisioning/src/bin.ts", outfile: ${JSON.stringify(binary)} }], {
      release: {
        sourceCommit: "${"a".repeat(40)}",
        committedAt: "2026-10-15T00:00:00.000Z",
        instantMs: Date.parse("2026-10-15T00:00:00Z"),
        generator: "scripts/generate-hour-release.mjs:v1",
        generatorSha256: "${"b".repeat(64)}",
      },
    });`,
    ],
    process.env,
  );
  const clock = join(f.root, "clock.mjs");
  await writeFile(
    clock,
    `import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
https.request = () => { throw new Error("synthetic offline clock"); };
syncBuiltinESMExports();
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : ["2026-10-16T11:40:00Z"])); }
  static now() { return RealDate.parse("2026-10-16T11:40:00Z"); }
};
Object.defineProperty(performance, "now", { value: () => 0 });
`,
  );
  const args = [
    "--import",
    clock,
    binary,
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
    "--recovery-pdf",
    join(f.root, "kept-recovery.pdf"),
    "--yes",
  ];
  const env = {
    ...process.env,
    ...f.base,
    ...f.evidenceEnv,
    WAITRON_INITIAL_VENUE_INPUT: "",
    WAITRON_ADVERTISED_ORIGIN: "https://olivo.example.test:3443",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_ADMIN_PASSWORD: "synthetic-password",
    WAITRON_ADMIN_PIN: "4826",
  };
  await applyMigrations(f.base.WAITRON_VENUE_DIR, migrationOptionsFor(manifestSets(), null));
  await expect(runCli(args, { ...env, WAITRON_INITIAL_VENUE_INPUT: path })).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("provisioning.initial_input_invalid"),
  });
  const child = await runCli(args, env, [
    ["address line 2 (blank if none): ", ""],
    ["The box's displayed date and time are correct? [y/N]: ", "yes"],
    [
      "Has anyone set up a Waitron box for this business in the last hour? [no/yes/unknown]: ",
      "no",
    ],
    ["Confirm setup password: ", "synthetic-password"],
    ["Have you kept this recovery PDF? [y/N]: ", "yes"],
  ]);
  const stored = await openVenueDatabase(f.base.WAITRON_VENUE_DIR);
  try {
    const allocations = await stored.venue.select().from(fiscalAllocations);
    expect(allocations.map((row) => row.installationIdentity)).toEqual(["06RB"]);
    const series = await stored.venue.select().from(invoiceSeries);
    expect(
      series
        .map((row) => ({ code: row.code, next: row.nextNumber }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    ).toEqual([
      { code: "A-06RB", next: 1 },
      { code: "FF-06RB", next: 1 },
      { code: "R-06RB", next: 1 },
    ]);
    expect(await readDeploymentEnvironment(stored.venue)).toBe("preproduction");
    expect(child.stdout).toContain(`node:     ${allocations[0]!.nodeId}`);
  } finally {
    await stored.close();
  }
  const claimed = await firstFiscalFixture();
  try {
    const blocked = [...args];
    blocked[blocked.indexOf("--venue-dir") + 1] = claimed.venueDir;
    const claimedState = await readFile(join(claimed.stateDir, "first-setup.json"));
    const marker = await readFile(join(claimed.venueDir, "first-setup-claim.json"));
    const ownState = await readFile(join(f.stateDir, "first-setup.json"));
    await expect(runCli(blocked, env)).rejects.toMatchObject({
      code: 1,
      stderr: "setup.attempt_conflict {}\n",
    });
    expect(await readFile(join(claimed.stateDir, "first-setup.json"))).toEqual(claimedState);
    expect(await readFile(join(claimed.venueDir, "first-setup-claim.json"))).toEqual(marker);
    expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(ownState);
    await expect(readFile(join(claimed.venueDir, "venue.db"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await claimed.dispose();
  }
});
