import { archiveHost, key, root, clock } from "../test/hour-recovery-host.js";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request as ownerRequest } from "../test/first-fiscal.js";
import { Agent } from "undici";
import { afterAll, expect, it, vi } from "vitest";
import { ensureBoxSecrets } from "./box-secrets.js";
import { freePorts } from "./testing/free-ports.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { FRESH } from "./recovery-state.js";
import { createFirstSetupBackupWorkspace } from "@waitron/provisioning";
import { createFirstSetupBackupRecovery } from "./first-setup-backup-recovery.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { ALL_MODULES } from "@waitron/composition";

const prefix = "/setup-api/first-setup/resolution/backup";
// tsx caches its transforms under `os.tmpdir()/tsx-<euid>`; each case gives the child its own
// TMPDIR, so without this shared cache every child compiles the whole server again before listening.
let transformCache: string | undefined;
afterAll(async () => {
  if (transformCache !== undefined) await rm(transformCache, { recursive: true, force: true });
});
it.each([
  { level: "normal", signal: "SIGTERM" },
  { level: "normal", signal: "SIGINT" },
  { level: "recovery", signal: "SIGTERM" },
  { level: "recovery", signal: "SIGINT" },
  { level: "normal", signal: "restart" },
] as const)(
  "supervised $level closes private backup proof on $signal",
  async ({ level, signal }) => {
    const f = await archiveHost();
    if (signal !== "restart")
      await writeFile(join(f.roots.stateDir, "first-setup.json"), "uncheckable retained attempt");
    if (level === "recovery")
      await writeFile(
        join(f.roots.stateDir, "recovery.json"),
        JSON.stringify({
          ...FRESH,
          failures: 3,
          level: "recovery",
        }),
      );
    await ensureBoxSecrets({
      stateDir: f.roots.stateDir,
      hostnames: ["localhost", "waitron.local"],
      now: () => new Date(),
      listIpv4: () => ["127.0.0.1"],
    });
    const host = createFirstSetupModuleHost({
      ...f.roots,
      modules: ALL_MODULES,
      environment: { WAITRON_ENV: "preproduction" },
    });
    if (signal === "restart")
      await host.owner.claimFirstSetup(
        {
          environment: "preproduction",
          request: {
            ...ownerRequest,
            legalName: "Retained company",
            location: {
              ...ownerRequest.location,
              name: "Retained venue",
              operationDescription: "Restaurant",
            },
          },
        },
        randomBytes(32).toString("base64url"),
      );
    const inspected = await host.resolution.inspectFirstSetupResolution();
    const observation = {
      inspectionId: inspected.inspectionId,
      revision: inspected.revision,
      ownerGeneration: inspected.ownerGeneration,
    };
    let recoveryId: string | undefined;
    if (signal === "restart") {
      const entries = unpackArchive(decryptArtifact(f.restore.artifact, f.restore.recoveryKey));
      entries.push({
        name: "secrets/module-evidence/fiscal-verifactu/hour-history.json",
        bytes: Buffer.from(
          JSON.stringify({ reference: "prepared-hours", complete: true, records: [] }),
        ),
      });
      const workspace = createFirstSetupBackupWorkspace(f.roots);
      const service = createFirstSetupBackupRecovery({
        ...f.roots,
        host,
        workspace,
        modules: ALL_MODULES,
        environment: "preproduction",
        sources: {
          ...f.restore,
          bucket: { litestreamBin: "/unused", now: () => new Date(), log: () => {} },
        },
        log: () => {},
      });
      try {
        const session = await service.open(
          {
            observation,
            source: {
              kind: "archive",
              artifact: encryptArtifact(packArchive(entries), f.restore.recoveryKey),
              recoveryKey: f.restore.recoveryKey,
              environment: "preproduction",
            },
            nodeRecoverySecret: key.secret,
            context: { oldBoxGone: true, soleRecovery: true },
          },
          { onBox: false },
        );
        const selected = (await recoverySelectPastWaits(
          clock,
          { prepare: (proposal, client) => service.prepare(session.sessionId, proposal, client) },
          { onBox: false },
        )) as { status: string; input: unknown };
        expect(selected.status).toBe("selected");
        const selecting = vi
          .spyOn(workspace, "select")
          .mockRejectedValue(new Error("selection interrupted"));
        try {
          await expect(
            service.commit(session.sessionId, selected.input, { onBox: false }),
          ).rejects.toThrow("selection interrupted");
        } finally {
          selecting.mockRestore();
        }
        recoveryId = session.recoveryId;
      } finally {
        await service.dispose();
      }
    }
    const scratch = join(root, "child-tmp");
    await mkdir(scratch);
    transformCache ??= await mkdtemp(join(tmpdir(), "backup-shutdown-transforms-"));
    await symlink(
      transformCache,
      join(scratch, `tsx-${process.geteuid?.() ?? userInfo().username}`),
    );
    const migrationsRoot = join(root, "migrations");
    await mkdir(migrationsRoot);
    const sets = manifestSets();
    const options = migrationOptionsFor(sets, null);
    for (const [index, set] of sets.entries())
      await cp(options[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    const [port] = await freePorts(1);
    const origin = `https://127.0.0.1:${port}`;
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("WAITRON_")),
    );
    const child = spawn(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        fileURLToPath(new URL("./node-entry.ts", import.meta.url)),
      ],
      {
        env: {
          ...environment,
          TMPDIR: scratch,
          WAITRON_ENV: "preproduction",
          WAITRON_STATE_DIR: f.roots.stateDir,
          WAITRON_VENUE_DIR: f.roots.venueDir,
          WAITRON_HTTP_HOST: "127.0.0.1",
          WAITRON_HTTP_PORT: String(port),
          WAITRON_HTTP_LANDING_PORT: "0",
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    const deadline = setTimeout(() => child.kill("SIGKILL"), 75_000);
    const agent = new Agent({
      connect: { ca: await readFile(join(f.roots.stateDir, "tls/ca.crt")) },
    });
    try {
      await vi.waitFor(
        async () => {
          expect(child.exitCode, output).toBeNull();
          const status = await fetch(origin + prefix + "/status", {
            dispatcher: agent,
          } as RequestInit);
          expect(status.status).toBe(200);
        },
        { timeout: 45_000 },
      );
      const form = new FormData();
      form.set(
        "request",
        JSON.stringify({
          observation: {
            inspectionId: inspected.inspectionId,
            revision: inspected.revision,
            ownerGeneration: inspected.ownerGeneration,
          },
          source: {
            kind: "archive",
            recoveryKey: f.restore.recoveryKey,
            environment: "preproduction",
          },
          nodeRecoverySecret: key.secret,
          context: { oldBoxGone: true, soleRecovery: true },
        }),
      );
      form.set("artifact", new Blob([Uint8Array.from(f.restore.artifact)]), "backup.wbk");
      const opened = await fetch(origin + prefix + (signal === "restart" ? "/resume" : "/open"), {
        method: "POST",
        body:
          signal === "restart"
            ? JSON.stringify({
                observation,
                recoveryId,
                nodeRecoverySecret: key.secret,
                context: { oldBoxGone: true, soleRecovery: true },
              })
            : form,
        headers: {
          Origin: origin,
          ...(signal === "restart" ? { "Content-Type": "application/json" } : {}),
        },
        dispatcher: agent,
      } as RequestInit);
      expect(opened.status, await opened.clone().text()).toBe(200);
      const session = await opened.json();
      expect(session.preview.taxpayer).toEqual({ legalName: "Waitron SL", taxId: "89890001K" });
      expect(
        (await readdir(scratch)).filter((name) => name.startsWith("waitron-backup-proof-")),
      ).toHaveLength(1);
      if (signal === "restart") {
        const committed = await fetch(origin + prefix + "/commit", {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.sessionId, input: session.input }),
          dispatcher: agent,
        } as RequestInit);
        expect(committed.status, await committed.clone().text()).toBe(200);
        expect(await committed.json()).toEqual({ restarting: true });
      } else child.kill(signal);
      expect(await exited, output).toEqual({ code: 0, signal: null });
      expect(
        (await readdir(scratch)).filter((name) => name.startsWith("waitron-backup-proof-")),
      ).toEqual([]);
    } finally {
      clearTimeout(deadline);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      await agent.close();
    }
  },
);
