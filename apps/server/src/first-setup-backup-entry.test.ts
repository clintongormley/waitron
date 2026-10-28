import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
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
import { resolveFirstSetupBackupEntry } from "./first-setup-backup-entry.js";

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

it("does not admit a selected target after its completion record disappears", async () => {
  const f = await fixture("selected");
  const admission = await resolveFirstSetupBackupEntry(f.roots);
  expect(admission.kind).toBe("selected");
  if (admission.kind !== "selected") throw new Error("selected entry missing");
  const last = (await f.workspace.read()).at(-1)!;
  await unlink(
    join(
      f.roots.stateDir,
      "first-setup-resolutions",
      "backup-recovery",
      f.target.recoveryId,
      `${String(last.sequence).padStart(6, "0")}.json`,
    ),
  );
  let ran = false;
  await expect(
    admission.run(async () => {
      ran = true;
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect(ran).toBe(false);
});

it("retains malformed V2 discovery on the repair surface", async () => {
  const f = await fixture();
  const path = join(f.roots.stateDir, "first-setup-resolutions", "backup-recovery", "current.json");
  await writeFile(path, "private malformed witness");
  const entry = await resolveFirstSetupEntry(f.roots, {});
  expect(entry.kind).toBe("resolution");
  if (entry.kind !== "resolution") throw new Error("repair entry missing");
  try {
    const response = await entry.app.request("/setup-api/first-setup/resolution/backup/status");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ phase: "uncertain", proofRequired: true });
    expect(await readFile(path, "utf8")).toBe("private malformed witness");
  } finally {
    await entry.dispose();
  }
});

it("treats an unreadable V2 namespace as repair-only", async () => {
  const f = await fixture();
  const parent = join(f.roots.stateDir, "first-setup-resolutions");
  await chmod(parent, 0);
  try {
    await expect(lstat(join(parent, "backup-recovery"))).rejects.toMatchObject({ code: "EACCES" });
    expect(await resolveFirstSetupBackupEntry(f.roots)).toEqual({ kind: "repair", roots: f.roots });
  } finally {
    await chmod(parent, 0o700);
  }
});

it("retains an empty V2 namespace as uncertain repair evidence", async () => {
  const f = await fixture();
  for (const root of Object.values(f.roots)) {
    const path = join(root, "first-setup-resolutions", "backup-recovery");
    await rm(path, { recursive: true });
    await mkdir(path);
  }
  expect(await resolveFirstSetupBackupEntry(f.roots)).toEqual({ kind: "repair", roots: f.roots });
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"), "utf8")).toBe(
    "opaque retained attempt",
  );
});

/** A supervised start of `f`'s box with the staged steps stubbed and the server's env recorded. */
async function superviseSelected(
  f: Awaited<ReturnType<typeof fixture>>,
  over: Partial<Parameters<typeof runEntry>[0]> = {},
) {
  let env: NodeJS.ProcessEnv | undefined;
  let surface: Hono | undefined;
  const statfsCalls: string[] = [];
  await runEntry({
    ...f.roots,
    args: [],
    baseEnv: { WAITRON_STATE_DIR: f.roots.stateDir, WAITRON_VENUE_DIR: f.roots.venueDir },
    statfs: async (dir) => {
      statfsCalls.push(dir);
      return plenty();
    },
    readRecoveryState: async () => FRESH,
    writeRecoveryState: async () => {},
    loadBoxEnv: async (base) => base,
    runStagedRestore: async () => false,
    runStagedReset: async () => false,
    clearReplacedDatabases: async () => {},
    assertNotAhead: async () => {},
    startServer: async (started) => {
      env = started;
      return stopped();
    },
    serveRecovery: async (app) => {
      surface = app;
    },
    installShutdownHandlers: () => {},
    scheduleStayedUp: () => {},
    log: () => {},
    ...over,
  });
  return { env, surface, statfsCalls };
}

it("a start running from a selected backup recovery writes the spare in the configured state folder, not the recovery's target folder", async () => {
  const f = await fixture("selected");
  await superviseSelected(f, { spareBytes: 4096 });
  expect((await stat(join(f.roots.stateDir, "spare-space"))).size).toBe(4096);
  await expect(stat(join(f.target.target.stateDir, "spare-space"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("a supervised start after a finished backup recovery runs the server on the restored target", async () => {
  const f = await fixture("selected");
  const backup = await resolveFirstSetupBackupEntry(f.roots);
  if (backup.kind !== "selected") throw new Error("selected entry missing");
  const target = { stateDir: backup.roots.stateDir, venueDir: backup.roots.venueDir };
  expect(target).toEqual(f.target.target);
  const dump = join(target.stateDir, "backup-staging", "waitron-20261020T000000Z.dump");
  await mkdir(join(target.stateDir, "backup-staging"));
  await writeFile(dump, "cut-off copy");
  const { env, surface, statfsCalls } = await superviseSelected(f);
  expect(surface).toBeUndefined();
  expect(env).toMatchObject({
    WAITRON_STATE_DIR: target.stateDir,
    WAITRON_VENUE_DIR: target.venueDir,
  });
  expect(statfsCalls).toEqual(expect.arrayContaining([target.stateDir, target.venueDir]));
  await expect(stat(dump)).rejects.toMatchObject({ code: "ENOENT" });
});

it("a supervised start after a finished backup recovery judges the floor on the original folders too", async () => {
  const f = await fixture("selected");
  const original = new Set([f.roots.stateDir, f.roots.venueDir]);
  const diskFull = Object.assign(new Error("database or disk is full"), { errcode: 13 });
  const { env, surface } = await superviseSelected(f, {
    statfs: async (dir) => (original.has(dir) ? { bavail: 1, frsize: 1 } : plenty()),
    withRecoveryLock: () => Promise.reject(diskFull),
  });
  expect(env).toBeUndefined();
  expect(await (await surface!.request("/")).text()).toContain(
    "The box&#39;s disk is full, so Waitron cannot save anything.",
  );
});

/** `f`'s folders reached through a symbolic link, so they are not spelled canonically. */
async function linkedRoots(f: Awaited<ReturnType<typeof fixture>>) {
  const parent = await mkdtemp(join(tmpdir(), "backup-entry-link-"));
  directories.push(parent);
  const link = join(parent, "box");
  await symlink(dirname(f.roots.venueDir), link);
  return { venueDir: join(link, "venue"), stateDir: join(link, "state") };
}

const RETAINED_DUMP = ["backup-staging", "waitron-20261016T120000Z.dump"] as const;

it.each(["canonical", "symlinked"] as const)(
  "a supervised start serving a backup recovery's repair keeps the original folder's retained dump (%s folders)",
  async (spelling) => {
    const f = await fixture();
    const roots = spelling === "canonical" ? f.roots : await linkedRoots(f);
    const { env, surface } = await superviseSelected(f, { ...roots, baseEnv: {} });
    expect(env).toBeUndefined();
    expect(surface).toBeDefined();
    expect(await readFile(join(f.roots.stateDir, ...RETAINED_DUMP), "utf8")).toBe(
      "retained interrupted dump",
    );
  },
);

it("a refused start beside a finished backup recovery keeps the original folder's retained dump (symlinked folders)", async () => {
  const f = await fixture("selected");
  await mkdir(join(f.roots.stateDir, "first-setup-workspaces"));
  const roots = await linkedRoots(f);
  const logDir = join(dirname(roots.stateDir), "..", "logs");
  const { env, surface } = await superviseSelected(f, { ...roots, baseEnv: {}, logDir });
  expect(env).toBeUndefined();
  expect(surface).toBeDefined();
  expect(await readFile(join(f.roots.stateDir, ...RETAINED_DUMP), "utf8")).toBe(
    "retained interrupted dump",
  );
});
