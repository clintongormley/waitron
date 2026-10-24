import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import { createFirstSetupBackupWorkspace, type BackupRepairRecord } from "@waitron/provisioning";
import { resolveFirstSetupBackupWorkspace } from "@waitron/provisioning";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { startServerOrFirstSetupResolution } from "./first-setup-launch.js";
import { runEntry } from "./node-entry.js";
import { startServer } from "./boot.js";
import { FRESH } from "./recovery-state.js";
import { lockVenueDatabase } from "@waitron/db";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture(phase: "prepared" | "selected" = "prepared") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "backup-entry-")));
  directories.push(root);
  const roots = { venueDir: join(root, "venue"), stateDir: join(root, "state") };
  for (const path of Object.values(roots)) await mkdir(path);
  const hold = await lockVenueDatabase(roots.venueDir);
  hold.release();
  await writeFile(join(roots.stateDir, "first-setup.json"), "opaque retained attempt");
  await mkdir(join(roots.stateDir, "backup-staging"));
  await writeFile(
    join(roots.stateDir, "backup-staging", "waitron-20261016T120000Z.dump"),
    "retained interrupted dump",
  );
  const recoveryId = randomUUID(),
    base = join(roots.stateDir, "first-setup-resolutions", "backup-recovery", recoveryId);
  const target = {
    recoveryId,
    anchor: roots,
    source: roots,
    target: { venueDir: join(base, "target", "venue"), stateDir: join(base, "target", "state") },
    generation: 1,
  };
  const workspace = createFirstSetupBackupWorkspace(roots);
  const initial = {
    target,
    observation: {
      inspectionId: "a".repeat(64),
      revision: null,
      ownerGeneration: null,
      originalsDigest: await workspace.inspect(recoveryId),
    },
    sourceId: "b".repeat(64),
    activationSourceId: "c".repeat(64),
    binding: {
      module: "synthetic",
      action: "restore" as const,
      eventId: randomUUID(),
      sourceId: "c".repeat(64),
      targetNodeId: randomUUID(),
    },
    input: null,
    retainedEvidenceDigest: "d".repeat(64),
    phase: "prepared" as const,
  };
  let record: BackupRepairRecord = await workspace.append(initial);
  if (phase === "selected") {
    await workspace.append({ ...initial, input: {} });
    await workspace.append({ ...initial, input: {}, phase: "placement-started" });
    record = await workspace.append({ ...initial, input: {}, phase: "restored" });
    await workspace.select(record);
    await writeFile(
      join(target.target.stateDir, "trading.env"),
      "WAITRON_TEST_SETTING=backup-target\n",
    );
  }
  return { roots, target, workspace, record };
}
const stopped = async () => ({ close: async () => {} });
const plenty = async () => ({ bavail: Number.MAX_SAFE_INTEGER, frsize: 1 });

it("shows only public backup progress when the old attempt and module configuration cannot be read", async () => {
  const f = await fixture();
  const admission = await resolveFirstSetupEntry(f.roots, {});
  expect(admission.kind).toBe("resolution");
  if (admission.kind !== "resolution") throw new Error("repair entry missing");
  const response = await admission.app.request("/setup-api/first-setup/resolution/backup/status");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    phase: "prepared",
    recoveryId: f.target.recoveryId,
    proofRequired: true,
  });
  for (const path of ["restore", "restore/bucket", "restore/cloud", "adopt", "provision"])
    expect((await admission.app.request("/setup-api/" + path, { method: "POST" })).status).not.toBe(
      200,
    );
});
it.each(["source", "incomplete-target"])(
  "raw boot refuses %s before creating its database",
  async (kind) => {
    const f = await fixture(),
      roots = kind === "source" ? f.roots : f.target.target;
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      await expect(
        (async () => {
          server = await startServer({
            WAITRON_STATE_DIR: roots.stateDir,
            WAITRON_VENUE_DIR: roots.venueDir,
            WAITRON_HTTP_HOST: "127.0.0.1",
          });
        })(),
      ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
      await expect(stat(join(roots.venueDir, "venue.db"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(join(f.roots.stateDir, "first-setup.json"), "utf8")).toBe(
        "opaque retained attempt",
      );
    } finally {
      await server?.close();
    }
  },
);
it("direct entry carries selected V2 roots even though no V1 workspace binding exists", async () => {
  const f = await fixture("selected");
  let actual: NodeJS.ProcessEnv | undefined;
  const server = await startServerOrFirstSetupResolution(
    { WAITRON_STATE_DIR: f.roots.stateDir, WAITRON_VENUE_DIR: f.roots.venueDir },
    {},
    {
      startServer: async (env) => {
        actual = env;
        return stopped();
      },
    },
  );
  try {
    expect(actual).toMatchObject({
      WAITRON_STATE_DIR: f.target.target.stateDir,
      WAITRON_VENUE_DIR: f.target.target.venueDir,
      WAITRON_TEST_SETTING: "backup-target",
    });
    await expect(stat(join(f.roots.venueDir, "venue.db"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await server.close();
  }
});
it.each(["normal", "recovery"] as const)(
  "supervised %s entry retains original staging and selects the repair surface before staged work",
  async (mode) => {
    const f = await fixture();
    const forbidden = vi.fn(async () => {
      throw new Error("ordinary work reached retained roots");
    });
    let app: Hono | undefined;
    await runEntry({
      ...f.roots,
      args: [],
      baseEnv: {},
      statfs: plenty,
      readRecoveryState: async () => ({ ...FRESH, level: mode }),
      writeRecoveryState: forbidden,
      loadBoxEnv: forbidden,
      runStagedRestore: forbidden,
      runStagedReset: forbidden,
      clearReplacedDatabases: forbidden,
      assertNotAhead: forbidden,
      startServer: forbidden,
      serveRecovery: async (surface) => {
        app = surface;
      },
      installShutdownHandlers: forbidden,
      scheduleStayedUp: forbidden,
      log: () => {},
    });
    expect(forbidden).not.toHaveBeenCalled();
    expect((await app!.request("/setup-api/first-setup/resolution/backup/status")).status).toBe(
      200,
    );
    await expect(
      readFile(join(f.roots.stateDir, "backup-staging", "waitron-20261016T120000Z.dump"), "utf8"),
    ).resolves.toBe("retained interrupted dump");
    expect((await f.workspace.read()).at(-1)).toEqual(f.record);
  },
);
it("rechecks V2 selection under exclusion before starting the selected target", async () => {
  const f = await fixture("selected");
  const admission = await resolveFirstSetupEntry(f.roots, {});
  expect(admission.kind).toBe("normal");
  if (admission.kind !== "normal") throw new Error("selected target missing");
  await writeFile(join(f.roots.stateDir, "first-setup.json"), "changed retained original");
  const body = vi.fn(async () => "must not boot");
  await expect(admission.run(body)).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(body).not.toHaveBeenCalled();
});
it("recognises the same selected handoff when a restarted process is already rooted at its target", async () => {
  const f = await fixture("selected");
  expect(await resolveFirstSetupBackupWorkspace(f.target.target)).toEqual({
    kind: "selected",
    target: f.target,
  });
  const admission = await resolveFirstSetupEntry(f.target.target, {});
  expect(admission.kind).toBe("normal");
  expect(admission.roots).toMatchObject(f.target.target);
});
