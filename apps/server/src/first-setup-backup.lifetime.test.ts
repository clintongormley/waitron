import { archiveHost, key, root } from "../test/hour-recovery-host.js";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Agent } from "undici";
import { expect, it, vi } from "vitest";
import type { Hono } from "hono";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ALL_MODULES } from "@waitron/composition";
import { ensureBoxSecrets } from "./box-secrets.js";
import { freePorts } from "./testing/free-ports.js";
import { startServerOrFirstSetupResolution } from "./first-setup-launch.js";
import { runEntry } from "./node-entry.js";
import { serveRecovery } from "./recovery-listener.js";
import { closeListener } from "./close-listener.js";
import { FRESH } from "./recovery-state.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import * as source from "./first-setup-backup-source.js";

vi.mock("./first-setup-backup-source.js", async (original) => {
  const actual = await original<typeof source>();
  return { ...actual, openFirstSetupBackupSource: vi.fn(actual.openFirstSetupBackupSource) };
});
const prefix = "/setup-api/first-setup/resolution/backup";

it.each(["direct", "supervised", "already-recovery"] as const)(
  "%s listener closure discards its private copy and invalidates the grant",
  async (mode) => {
    const f = await archiveHost();
    await writeFile(join(f.roots.stateDir, "first-setup.json"), "uncheckable retained attempt");
    await ensureBoxSecrets({
      stateDir: f.roots.stateDir,
      hostnames: ["localhost", "waitron.local"],
      now: () => new Date(),
      listIpv4: () => ["127.0.0.1"],
    });
    const into = join(root, "migrations");
    await mkdir(into);
    const sets = manifestSets(),
      options = migrationOptionsFor(sets, null);
    for (const [index, set] of sets.entries())
      await cp(options[index]!.migrationsFolder, join(into, set.name), { recursive: true });
    const [port, landing] = await freePorts(2);
    const environment = {
      WAITRON_ENV: "preproduction",
      WAITRON_STATE_DIR: f.roots.stateDir,
      WAITRON_VENUE_DIR: f.roots.venueDir,
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: String(landing),
      WAITRON_MIGRATIONS_DIR: into,
    };
    const host = createFirstSetupModuleHost({ ...f.roots, environment, modules: ALL_MODULES });
    const inspection = await host.resolution.inspectFirstSetupResolution();
    const agent = new Agent({
      connect: { ca: await readFile(join(f.roots.stateDir, "tls/ca.crt")) },
    });
    let app: Hono | undefined, server: { close(): Promise<void> } | undefined;
    const listen = async (surface: Hono, opts: Parameters<typeof serveRecovery>[1]) => {
      app = surface;
      const listener = await serveRecovery(surface, opts);
      server = { close: () => closeListener(listener) };
      return server;
    };
    const forbidden = async () => {
      throw new Error("ordinary work reached retained roots");
    };
    const socket = new TLSSocket(new Socket());
    try {
      if (mode === "direct")
        server = await startServerOrFirstSetupResolution(
          environment,
          {},
          { serveResolution: listen },
        );
      else
        await runEntry({
          ...f.roots,
          args: [],
          baseEnv: environment,
          statfs: async () => ({ bavail: Number.MAX_SAFE_INTEGER, frsize: 1 }),
          readRecoveryState: async () =>
            mode === "already-recovery" ? { ...FRESH, level: "recovery" } : FRESH,
          writeRecoveryState: forbidden,
          loadBoxEnv: forbidden,
          runStagedRestore: forbidden,
          runStagedReset: forbidden,
          clearReplacedDatabases: forbidden,
          assertNotAhead: forbidden,
          startServer: forbidden,
          serveRecovery: listen,
          installShutdownHandlers: forbidden,
          scheduleStayedUp: forbidden,
          log: () => {},
          exit: () => {},
        });
      const form = new FormData();
      form.set(
        "request",
        JSON.stringify({
          observation: {
            inspectionId: inspection.inspectionId,
            revision: inspection.revision,
            ownerGeneration: inspection.ownerGeneration,
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
      const response = await fetch(`https://127.0.0.1:${port}${prefix}/open`, {
        method: "POST",
        body: form,
        dispatcher: agent,
      } as RequestInit);
      expect(response.status).toBe(200);
      const session = await response.json();
      const selected = await vi.mocked(source.openFirstSetupBackupSource).mock.results.at(-1)!
        .value;
      await expect(access(selected.copy.databasePath)).resolves.toBeUndefined();
      await server!.close();
      server = undefined;
      await expect(access(selected.copy.databasePath)).rejects.toMatchObject({ code: "ENOENT" });
      const replay = await app!.request(
        `https://localhost${prefix}/prepare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: session.sessionId,
            proposal: { action: "clock-challenge" },
          }),
        },
        { incoming: { socket } },
      );
      expect(replay.status).toBe(403);
      expect(await replay.json()).toEqual({ error: { code: "setup.owner_required", params: {} } });
    } finally {
      await server?.close();
      await agent.close();
      socket.destroy();
      for (const result of vi.mocked(source.openFirstSetupBackupSource).mock.results.splice(0)) {
        if (result.type === "return")
          await result.value.then(
            async (selected) => {
              await selected.copy.discard();
              const scratch = dirname(dirname(dirname(selected.copy.databasePath)));
              if (!basename(scratch).startsWith("waitron-backup-proof-"))
                throw new Error("Unexpected proof scratch path");
              await rm(scratch, { recursive: true, force: true });
            },
            () => {},
          );
      }
    }
  },
);
