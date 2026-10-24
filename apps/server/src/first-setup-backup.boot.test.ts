import { archiveHost, key, root } from "../test/hour-recovery-host.js";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Agent } from "undici";
import { expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ALL_MODULES } from "@waitron/composition";
import { ensureBoxSecrets } from "./box-secrets.js";
import { freePorts } from "./testing/free-ports.js";
import { startServerOrFirstSetupResolution } from "./first-setup-launch.js";
import { runEntry } from "./node-entry.js";
import { serveRecovery } from "./recovery-listener.js";
import { closeListener } from "./close-listener.js";
import { FRESH } from "./recovery-state.js";
import { startServer } from "./boot.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupBackupWorkspace } from "@waitron/provisioning";
import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";

const prefix = "/setup-api/first-setup/resolution/backup";
async function migrations() {
  const into = join(root, "migrations");
  await mkdir(into);
  const options = migrationOptionsFor(manifestSets(), null);
  for (const [index, set] of manifestSets().entries())
    await cp(options[index]!.migrationsFolder, join(into, set.name), { recursive: true });
  return into;
}
it.each(["direct", "supervised", "already-recovery"] as const)(
  "%s serves authenticated backup proof on TLS and only public guidance on HTTP",
  async (mode) => {
    const f = await archiveHost();
    await writeFile(join(f.roots.stateDir, "first-setup.json"), "uncheckable retained attempt");
    await ensureBoxSecrets({
      stateDir: f.roots.stateDir,
      hostnames: ["localhost", "waitron.local"],
      now: () => new Date(),
      listIpv4: () => ["127.0.0.1"],
    });
    const [port, landing] = await freePorts(2);
    const environment = {
      WAITRON_ENV: "preproduction",
      WAITRON_STATE_DIR: f.roots.stateDir,
      WAITRON_VENUE_DIR: f.roots.venueDir,
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: String(landing),
      WAITRON_MIGRATIONS_DIR: await migrations(),
    };
    const host = createFirstSetupModuleHost({ ...f.roots, modules: ALL_MODULES, environment });
    const inspected = await host.resolution.inspectFirstSetupResolution();
    const original = await readFile(join(f.roots.stateDir, "first-setup.json"));
    const forbidden = vi.fn(async () => {
      throw new Error("ordinary start reached retained data");
    });
    let server: { close(): Promise<void> } | undefined;
    const agent = new Agent({
      connect: { ca: await readFile(join(f.roots.stateDir, "tls/ca.crt")) },
    });
    try {
      if (mode === "direct")
        server = await startServerOrFirstSetupResolution(
          environment,
          {},
          { requestRestart: () => {} },
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
          serveRecovery: async (app, options) => {
            const listener = await serveRecovery(app, options);
            server = { close: () => closeListener(listener) };
          },
          installShutdownHandlers: forbidden,
          scheduleStayedUp: forbidden,
          log: () => {},
          exit: () => {},
        });
      const origin = `https://127.0.0.1:${port}`;
      const send = (path: string, init: RequestInit) =>
        fetch(origin + prefix + path, { ...init, dispatcher: agent } as RequestInit);
      const status = await send("/status", {});
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({ phase: "unstarted", proofRequired: true });
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
      const opened = await send("/open", {
        method: "POST",
        headers: { Origin: origin },
        body: form,
      });
      expect(opened.status).toBe(200);
      const session = await opened.json();
      expect(session.preview.taxpayer).toEqual({ legalName: "Waitron SL", taxId: "89890001K" });
      expect(JSON.stringify(session)).not.toContain(key.secret);
      const closed = await send("/close", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      expect(closed.status).toBe(200);
      expect(await closed.json()).toEqual({ closed: true });
      const guidance = await fetch(`http://127.0.0.1:${landing}/setup/trust`);
      expect(guidance.status).toBe(200);
      expect(await guidance.text()).not.toContain(key.secret);
      const unsafe = await fetch(`http://127.0.0.1:${landing}${prefix}/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
        body: "private proof",
      });
      expect(unsafe.status).not.toBe(200);
      expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(original);
      expect(forbidden).not.toHaveBeenCalled();
    } finally {
      await server?.close();
      await agent.close();
    }
  },
);

it("ordinary setup boot mounts backup repair with its existing host", async () => {
  const f = await archiveHost();
  await writeFile(
    join(f.roots.stateDir, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  const [port] = await freePorts(1);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const agent = new Agent({ connect: { rejectUnauthorized: false } });
  try {
    server = await startServer({
      WAITRON_ENV: "dev",
      WAITRON_STATE_DIR: f.roots.stateDir,
      WAITRON_VENUE_DIR: f.roots.venueDir,
      WAITRON_MIGRATIONS_DIR: await migrations(),
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
    });
    let response: Response | undefined;
    await vi.waitFor(async () => {
      response = await fetch(`https://127.0.0.1:${port}${prefix}/status`, {
        dispatcher: agent,
      } as RequestInit);
      expect(response.status).toBe(200);
    });
    expect(await response!.json()).toEqual({ phase: "unstarted", proofRequired: true });
    const host = createFirstSetupModuleHost({
      ...f.roots,
      modules: ALL_MODULES,
      environment: { WAITRON_ENV: "dev" },
    });
    const inspected = await host.resolution.inspectFirstSetupResolution();
    const entries = unpackArchive(decryptArtifact(f.restore.artifact, f.restore.recoveryKey));
    entries.push({
      name: "secrets/module-evidence/fiscal-verifactu/hour-history.json",
      bytes: Buffer.from(
        JSON.stringify({ reference: "prepared-hours", complete: true, records: [] }),
      ),
    });
    const artifact = encryptArtifact(packArchive(entries), f.restore.recoveryKey);
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
    form.set("artifact", new Blob([Uint8Array.from(artifact)]), "backup.wbk");
    const origin = `https://127.0.0.1:${port}`;
    const opened = await fetch(origin + prefix + "/open", {
      method: "POST",
      body: form,
      dispatcher: agent,
    } as RequestInit);
    expect(opened.status).toBe(200);
    const session = await opened.json();
    const prepared = await fetch(origin + prefix + "/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.sessionId,
        proposal: { action: "clock-challenge" },
      }),
      dispatcher: agent,
    } as RequestInit);
    expect(prepared.status).toBe(200);
    expect(await prepared.json()).toMatchObject({ id: expect.any(String) });
    const workspace = createFirstSetupBackupWorkspace(f.roots);
    const before = (await workspace.read()).at(-1)!;
    expect(before.phase).toBe("prepared");
    const originals = JSON.parse(
      await readFile(
        join(
          f.roots.stateDir,
          "first-setup-resolutions",
          "backup-recovery",
          before.target.recoveryId,
          "originals.json",
        ),
        "utf8",
      ),
    ) as { entries: { path: string; kind: string; digest: string | null }[] };
    await server.close();
    server = undefined;
    const changed: string[] = [];
    for (const entry of originals.entries)
      if (entry.kind === "file") {
        const bytes = await readFile(entry.path).catch(() => null);
        if (bytes === null || createHash("sha256").update(bytes).digest("hex") !== entry.digest)
          changed.push(entry.path.replace(root, "<fixture>"));
      }
    expect(changed).toEqual([]);
    expect((await workspace.read()).at(-1)).toEqual(before);
  } finally {
    await server?.close();
    await agent.close();
  }
});
