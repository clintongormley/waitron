import { archiveHost, key, root, clock, node } from "../test/hour-recovery-host.js";
import { randomBytes } from "node:crypto";
import { cp, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { generateNodeKeyPair } from "@waitron/membership";
import { encodeRecoveryKit } from "@waitron/stream";
import { ALL_MODULES } from "@waitron/composition";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createFirstSetupBackupWorkspace } from "@waitron/provisioning";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { firstSetupBackupRecoveryFor } from "./first-setup-backup-entry.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { request } from "../test/first-fiscal.js";
import { closeListener } from "./close-listener.js";
import { freePorts } from "./testing/free-ports.js";

const services: ReturnType<typeof firstSetupBackupRecoveryFor>[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
  vi.unstubAllGlobals();
});
async function claimedAttempt(environment: Readonly<Record<string, string | undefined>> = {}) {
  const f = await archiveHost();
  const roots = {
    venueDir: await realpath(f.roots.venueDir),
    stateDir: await realpath(f.roots.stateDir),
  };
  const current = createFirstSetupModuleHost({ ...roots, environment: {}, modules: ALL_MODULES });
  await current.owner.claimFirstSetup(
    {
      environment: "preproduction",
      request: {
        ...request,
        location: { ...request.location, operationDescription: "Restaurant" },
      },
    },
    randomBytes(32).toString("base64url"),
  );
  const into = join(root, "migrations");
  await mkdir(into);
  const sets = manifestSets(),
    migrations = migrationOptionsFor(sets, null);
  for (const [index, set] of sets.entries())
    await cp(migrations[index]!.migrationsFolder, join(into, set.name), { recursive: true });
  const service = firstSetupBackupRecoveryFor(
    roots,
    {
      WAITRON_MIGRATIONS_DIR: into,
      ...environment,
    },
    current,
    () => {},
  );
  services.push(service);
  return { ...f, anchor: roots, roots, current, service };
}

it.each(["not a URL", "http://example.test", "https://example.test/path"])(
  "keeps public repair available with invalid Cloud origin %s",
  async (WAITRON_CLOUD_ORIGIN) => {
    const f = await archiveHost();
    await writeFile(join(f.roots.stateDir, "first-setup.json"), "uncheckable attempt");
    const pending = resolveFirstSetupEntry(f.roots, { WAITRON_CLOUD_ORIGIN });
    await expect(pending).resolves.toMatchObject({ kind: "resolution" });
    const entry = await pending;
    expect(entry.kind).toBe("resolution");
    if (entry.kind !== "resolution") throw new Error("repair surface missing");
    const response = await entry.app.request("/setup-api/first-setup/resolution/backup/status");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ phase: "unstarted", proofRequired: true });
    await entry.dispose();
  },
);

it("uses the factory's bounded S3 adapter and preserves a missing-pointer refusal", async () => {
  const f = await claimedAttempt();
  const [port] = await freePorts(1);
  const paths: string[] = [];
  const listener = createServer((request, response) => {
    paths.push(request.url!);
    response.writeHead(404, { "Content-Type": "application/xml" });
    response.end("<Error><Code>NoSuchKey</Code></Error>");
  });
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(port, "127.0.0.1", resolve);
  });
  try {
    const signer = generateNodeKeyPair();
    const kit = {
      version: 1 as const,
      venueId: node.locationId,
      bucket: {
        endpoint: `http://127.0.0.1:${port}`,
        region: "local",
        bucket: "copy",
        prefix: "",
        accessKeyId: "synthetic",
        secretAccessKey: "synthetic",
      },
      recoveryKey: "bucket-key",
      pointerSignerPublicKey: signer.publicKey,
    };
    const inspection = await f.current.resolution.inspectFirstSetupResolution();
    await expect(
      f.service.open(
        {
          observation: {
            inspectionId: inspection.inspectionId,
            revision: inspection.revision,
            ownerGeneration: inspection.ownerGeneration,
          },
          source: { kind: "bucket", kit: encodeRecoveryKit(kit), environment: "preproduction" },
          nodeRecoverySecret: key.secret,
          context: { oldBoxGone: true, soleRecovery: true },
        },
        { onBox: false },
      ),
    ).rejects.toMatchObject({ code: "restore.stream_pointer_missing" });
    expect(paths).toEqual(expect.arrayContaining([expect.stringContaining(node.locationId)]));
    expect(await createFirstSetupBackupWorkspace(f.anchor).read()).toEqual([]);
  } finally {
    await closeListener(listener);
  }
});

it("authenticates an archive despite a malformed unrelated Cloud origin", async () => {
  const f = await claimedAttempt({ WAITRON_CLOUD_ORIGIN: "broken Cloud origin" });
  const inspection = await f.current.resolution.inspectFirstSetupResolution();
  const session = await f.service.open(
    {
      observation: {
        inspectionId: inspection.inspectionId,
        revision: inspection.revision,
        ownerGeneration: inspection.ownerGeneration,
      },
      source: {
        kind: "archive",
        artifact: f.restore.artifact,
        recoveryKey: f.restore.recoveryKey,
        environment: "preproduction",
      },
      nodeRecoverySecret: key.secret,
      context: { oldBoxGone: true, soleRecovery: true },
    },
    { onBox: false },
  );
  expect(session.preview.taxpayer).toEqual({ legalName: "Waitron SL", taxId: "89890001K" });
  await f.service.close(session.sessionId);
  await expect(f.service.cloudStart()).rejects.toMatchObject({
    code: "server.config_invalid",
    params: { variable: "WAITRON_CLOUD_ORIGIN" },
  });
  expect(await createFirstSetupBackupWorkspace(f.anchor).read()).toEqual([]);
});

it("enables configured preproduction Cloud approval without enabling production", async () => {
  const f = await claimedAttempt();
  let calls = 0;
  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
    calls++;
    const { payload } = JSON.parse(String(init?.body)) as { payload: string };
    const requestId = (JSON.parse(Buffer.from(payload, "base64url").toString()) as string[])[2];
    return Response.json({
      requestId,
      state: "awaiting_owner",
      expiresAt: new Date(clock.wall() + 900000).toISOString(),
      operationId: null,
    });
  });
  for (const environment of ["preproduction", "production"] as const) {
    const service = firstSetupBackupRecoveryFor(
      f.roots,
      { WAITRON_ENV: environment, WAITRON_CLOUD_ORIGIN: "https://cloud.example.test" },
      f.current,
      () => {},
    );
    services.push(service);
    if (environment === "preproduction")
      expect(await service.cloudStart()).toMatchObject({ state: "awaiting_owner" });
    else await expect(service.cloudStart()).rejects.toMatchObject({ code: "setup.not_ready" });
  }
  expect(calls).toBe(1);
});
