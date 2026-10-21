import { mkdtemp, mkdir, realpath, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import * as entry from "./node-entry.js";
import { FRESH } from "./recovery-state.js";
import { firstFiscalFixture } from "../test/first-fiscal.js";
import { randomUUID } from "node:crypto";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  selectFirstSetupWorkspace,
} from "@waitron/provisioning";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function torn() {
  const root = await mkdtemp(join(tmpdir(), "resolution-entry-"));
  dirs.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  await mkdir(stateDir);
  await mkdir(venueDir);
  await writeFile(join(venueDir, "first-setup-claim.json"), "{}");
  await writeFile(join(stateDir, "restore-request.json"), "retained restore");
  await writeFile(join(stateDir, "reset-request.json"), "retained reset");
  return { root, stateDir, venueDir };
}
const stopped = () => Promise.resolve({ close: async () => {} });
/** Keeps the start's free-space step out of cases that do not test it, whatever the temp folder holds. */
const plentyOfSpace = async () => ({ bavail: Number.MAX_SAFE_INTEGER, frsize: 1 });

async function replacement() {
  const f = await firstFiscalFixture();
  const anchor = { stateDir: await realpath(f.stateDir), venueDir: await realpath(f.venueDir) };
  const resolutionId = randomUUID(),
    workspaceId = randomUUID();
  const base = join(anchor.stateDir, "first-setup-workspaces", workspaceId);
  const binding = {
    anchorStateDir: anchor.stateDir,
    anchorVenueDir: anchor.venueDir,
    stateDir: join(base, "state"),
    venueDir: join(base, "venue"),
    resolutionId,
    workspaceId,
    selectionGeneration: 1,
  };
  const records = createFirstSetupResolutionStore({
    ...anchor,
    coordinator: createFirstSetupCoordinator(),
  });
  const prepared = await records.prepare(
    {
      resolutionId,
      attemptId: f.ownerAttempt.attemptId,
      observedRevision: f.ownerAttempt.revision,
      observedOwnerGeneration: 1,
      database: "missing",
      authority: "original-password",
      register: {
        kind: "current-master",
        status: "Unknown",
        custodian: "Elena",
        reference: "c".repeat(64),
        consultedAt: "2026-10-16T02:00:00.000Z",
      },
      action: "retire",
      nextWorkspace: binding,
    },
    [
      {
        name: "state/first-setup.json",
        bytes: await readFile(join(anchor.stateDir, "first-setup.json")),
      },
      {
        name: "venue/first-setup-claim.json",
        bytes: await readFile(join(anchor.venueDir, "first-setup-claim.json")),
      },
      { name: "venue/venue.db", bytes: null },
    ],
  );
  await selectFirstSetupWorkspace(anchor, await records.apply(prepared));
  return { ...f, anchor, binding };
}

it("direct entry serves resolution before strict boot or creating a missing database", async () => {
  const f = await torn();
  const boot = vi.fn(stopped);
  let app: Hono | undefined;
  const server = await entry.startServerOrFirstSetupResolution(
    {
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_VENUE_DIR: f.venueDir,
    },
    {},
    {
      startServer: boot,
      serveResolution: async (surface: Hono) => {
        app = surface;
        return stopped();
      },
    },
  );
  await server.close();
  expect(boot).not.toHaveBeenCalled();
  expect((await app!.request("/setup-api/first-setup/resolution")).status).toBe(200);
  expect(await (await app!.request("/setup-api/first-setup/status")).json()).toEqual({
    claimed: true,
    resolution: true,
  });
  for (const path of [
    "/setup-api/provision",
    "/setup-api/restore",
    "/setup-api/first-setup/claim",
    "/retry",
    "/api/till/session",
  ])
    expect((await app!.request(path, { method: "POST" })).status).toBe(404);
  await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(f.stateDir, "restore-request.json"), "utf8")).toBe("retained restore");
});

it.each([FRESH, { ...FRESH, level: "recovery" as const, failures: 3 }])(
  "supervised entry gives resolution precedence over level $level and all staged work",
  async (recovery) => {
    const f = await torn();
    const forbidden = vi.fn(async () => {
      throw new Error("ordinary boot reached");
    });
    let app: Hono | undefined;
    await entry.runEntry({
      ...f,
      args: [],
      statfs: plentyOfSpace,
      baseEnv: {},
      readRecoveryState: async () => recovery,
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
      scheduleStayedUp: forbidden,
      installShutdownHandlers: forbidden,
      log: () => {},
    });
    expect(forbidden).not.toHaveBeenCalled();
    expect((await app!.request("/setup-api/first-setup/resolution")).status).toBe(200);
    expect((await app!.request("/retry", { method: "POST" })).status).toBe(404);
    await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(f.stateDir, "reset-request.json"), "utf8")).toBe("retained reset");
  },
);

it("a strictly paired attempt with a missing database reaches resolution without creating it", async () => {
  const f = await firstFiscalFixture();
  try {
    let app: Hono | undefined;
    const boot = vi.fn(stopped);
    await entry.startServerOrFirstSetupResolution(
      { WAITRON_STATE_DIR: f.stateDir, WAITRON_VENUE_DIR: f.venueDir },
      {},
      {
        startServer: boot,
        serveResolution: async (surface: Hono) => {
          app = surface;
          return stopped();
        },
      },
    );
    expect(boot).not.toHaveBeenCalled();
    expect(await (await app!.request("/setup-api/first-setup/resolution")).json()).toMatchObject({
      pair: "valid",
      database: "missing",
      password: "checkable",
    });
    await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

it("direct entry boots the checked replacement using only its settings", async () => {
  const f = await replacement();
  try {
    await writeFile(
      join(f.binding.stateDir, "trading.env"),
      "WAITRON_TEST_SETTING=new-workspace\n",
    );
    let actual: NodeJS.ProcessEnv | undefined;
    await entry.startServerOrFirstSetupResolution(
      { WAITRON_STATE_DIR: f.anchor.stateDir, WAITRON_VENUE_DIR: f.anchor.venueDir },
      {},
      {
        startServer: async (env) => {
          actual = env;
          return stopped();
        },
      },
    );
    expect(actual).toMatchObject({
      WAITRON_STATE_DIR: f.binding.stateDir,
      WAITRON_VENUE_DIR: f.binding.venueDir,
      WAITRON_TEST_SETTING: "new-workspace",
    });
    await expect(stat(join(f.anchor.venueDir, "venue.db"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await f.dispose();
  }
});

it("supervised entry stages and boots only the checked replacement", async () => {
  const f = await replacement();
  try {
    const effects: string[] = [];
    await entry.runEntry({
      ...f.anchor,
      args: [],
      statfs: plentyOfSpace,
      baseEnv: {},
      readRecoveryState: async (path) => {
        effects.push(`recovery:${path}`);
        return FRESH;
      },
      writeRecoveryState: async (path) => {
        effects.push(`counter:${path}`);
      },
      withRecoveryLock: async (_path, body) => body(),
      loadBoxEnv: async (base, path) => {
        effects.push(`env:${path}`);
        return base;
      },
      runStagedRestore: async (deps) => {
        effects.push(`restore:${deps.venueDir}:${deps.stateDir}`);
        return false;
      },
      runStagedReset: async (deps) => {
        effects.push(`reset:${deps.venueDir}:${deps.stateDir}`);
        return false;
      },
      clearReplacedDatabases: async (path) => {
        effects.push(`cleanup:${path}`);
      },
      assertNotAhead: async (path) => {
        effects.push(`ahead:${path}`);
      },
      startServer: async (env) => {
        effects.push(`boot:${env.WAITRON_VENUE_DIR}:${env.WAITRON_STATE_DIR}`);
        return stopped();
      },
      serveRecovery: async () => {
        throw new Error("unexpected resolution");
      },
      scheduleStayedUp: () => {},
      installShutdownHandlers: () => {},
      log: () => {},
    });
    expect(effects).toEqual([
      `recovery:${f.binding.stateDir}`,
      `recovery:${f.binding.stateDir}`,
      `counter:${f.binding.stateDir}`,
      `restore:${f.binding.venueDir}:${f.binding.stateDir}`,
      `reset:${f.binding.venueDir}:${f.binding.stateDir}`,
      `cleanup:${f.binding.venueDir}`,
      `ahead:${f.binding.venueDir}`,
      `env:${f.binding.stateDir}`,
      `boot:${f.binding.venueDir}:${f.binding.stateDir}`,
    ]);
    await expect(stat(join(f.anchor.venueDir, "venue.db"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await f.dispose();
  }
});

it("direct entry still boots a normal unclaimed workspace", async () => {
  const f = await torn();
  await rm(join(f.venueDir, "first-setup-claim.json"));
  const boot = vi.fn(stopped);
  await entry.startServerOrFirstSetupResolution(
    { WAITRON_STATE_DIR: f.stateDir, WAITRON_VENUE_DIR: f.venueDir },
    {},
    { startServer: boot },
  );
  expect(boot).toHaveBeenCalledOnce();
});

it("an ordinary filesystem refusal still belongs to strict boot", async () => {
  const f = await torn();
  const file = join(f.root, "file");
  await writeFile(file, "ordinary path error");
  const boot = vi.fn(async () => {
    throw new Error("strict filesystem refusal");
  });
  await expect(
    entry.startServerOrFirstSetupResolution(
      { WAITRON_STATE_DIR: f.stateDir, WAITRON_VENUE_DIR: join(file, "venue") },
      {},
      { startServer: boot },
    ),
  ).rejects.toThrow("strict filesystem refusal");
  expect(boot).toHaveBeenCalledOnce();
});

it("rechecks the unfinished database after taking the startup locks", async () => {
  const f = await firstFiscalFixture();
  try {
    const path = join(f.venueDir, "venue.db");
    await suite.db.archiveTo(path);
    const admission = await resolveFirstSetupEntry(f, {});
    expect(admission.kind).toBe("normal");
    if (admission.kind !== "normal") throw new Error("expected ordinary owner setup");
    await rm(path);
    const boot = vi.fn(stopped);
    await expect(admission.run(boot)).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
    expect(boot).not.toHaveBeenCalled();
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

it("a completed marker cannot make a missing committed database look like a new installation", async () => {
  const f = await firstFiscalFixture();
  try {
    let state = (await f.store.read())!;
    for (const change of [
      { kind: "activation-started" },
      { kind: "committed", result: {} },
      { kind: "publication" },
      { kind: "complete" },
    ] as const)
      state = await f.store.update(state.frozen.attemptId, state.revision, change);
    expect((await f.store.readResumable())?.publicationComplete).toBe(true);
    let app: Hono | undefined;
    const boot = vi.fn(stopped);
    await entry.startServerOrFirstSetupResolution(
      { WAITRON_STATE_DIR: f.stateDir, WAITRON_VENUE_DIR: f.venueDir },
      {},
      {
        startServer: boot,
        serveResolution: async (surface) => {
          app = surface;
          return stopped();
        },
      },
    );
    expect(boot).not.toHaveBeenCalled();
    expect((await app!.request("/setup-api/first-setup/resolution")).status).toBe(200);
    await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

it.each(["venue-selection", "state-selection", "target-backlink"])(
  "losing the %s never falls back to the retired database",
  async (missing) => {
    const f = await replacement();
    try {
      const path =
        missing === "venue-selection"
          ? join(f.anchor.venueDir, "first-setup-selection.json")
          : missing === "state-selection"
            ? join(f.anchor.stateDir, "first-setup-selection.json")
            : join(f.binding.venueDir, "first-setup-workspace.json");
      await rm(path);
      const boot = vi.fn(stopped);
      let app: Hono | undefined;
      await entry.startServerOrFirstSetupResolution(
        { WAITRON_STATE_DIR: f.anchor.stateDir, WAITRON_VENUE_DIR: f.anchor.venueDir },
        {},
        {
          startServer: boot,
          serveResolution: async (surface) => {
            app = surface;
            return stopped();
          },
        },
      );
      expect(boot).not.toHaveBeenCalled();
      expect((await app!.request("/setup-api/first-setup/status")).status).toBe(200);
      await expect(stat(join(f.anchor.venueDir, "venue.db"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(stat(join(f.binding.venueDir, "venue.db"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await f.dispose();
    }
  },
);

it("changing a selected workspace after discovery refuses before staged work", async () => {
  const f = await replacement();
  try {
    const admission = await resolveFirstSetupEntry(f.anchor, {});
    expect(admission.kind).toBe("normal");
    if (admission.kind !== "normal") throw new Error("expected checked target");
    await writeFile(join(f.binding.venueDir, "first-setup-retirement.json"), "{}");
    const stages = vi.fn(stopped);
    await expect(admission.run(stages)).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
    expect(stages).not.toHaveBeenCalled();
  } finally {
    await f.dispose();
  }
});

function startupLockFromAnotherProcess(venueDir: string) {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1]);
try {
  db.exec("pragma busy_timeout = 0");
  try { db.exec("begin immediate"); process.stdout.write("AVAILABLE"); }
  catch (error) {
    if (error.errcode !== 5) throw error;
    process.stdout.write("HELD");
  }
} finally { db.close(); }`,
      join(venueDir, "venue.lock"),
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

it.each([
  { selected: false, failure: false },
  { selected: false, failure: true },
  { selected: true, failure: false },
  { selected: true, failure: true },
])(
  "startup holds and releases its real locks: selected=$selected failure=$failure",
  async ({ selected, failure }) => {
    const selectedFixture = selected ? await replacement() : null;
    const f = selectedFixture ?? (await firstFiscalFixture());
    try {
      const anchor = selectedFixture?.anchor ?? f;
      const target = selectedFixture?.binding ?? f;
      if (!selected) await suite.db.archiveTo(join(f.venueDir, "venue.db"));
      const paths = [...new Set([anchor.venueDir, target.venueDir])];
      const originals = await readFile(join(f.stateDir, "first-setup.json"));
      const admission = await resolveFirstSetupEntry(anchor, {});
      expect(admission.kind).toBe("normal");
      if (admission.kind !== "normal") throw new Error("expected startup admission");
      const sentinel = new Error("synthetic startup failure");
      const start = admission.run(async () => {
        for (const path of paths) expect(startupLockFromAnotherProcess(path)).toBe("HELD");
        if (failure) throw sentinel;
        return "startup completed";
      });
      if (failure) await expect(start).rejects.toBe(sentinel);
      else await expect(start).resolves.toBe("startup completed");
      for (const path of paths) expect(startupLockFromAnotherProcess(path)).toBe("AVAILABLE");
      expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(originals);
      if (selected) {
        await expect(stat(join(anchor.venueDir, "venue.db"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(stat(join(target.venueDir, "venue.db"))).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
    } finally {
      await f.dispose();
    }
  },
);

it.each(["activation-started", "abandoned", "uncertain"] as const)(
  "startup rechecks a newly %s attempt before entering its callback",
  async (kind) => {
    const f = await firstFiscalFixture();
    try {
      await suite.db.archiveTo(join(f.venueDir, "venue.db"));
      const admission = await resolveFirstSetupEntry(f, {});
      expect(admission.kind).toBe("normal");
      if (admission.kind !== "normal") throw new Error("expected startup admission");
      const state = (await f.store.read())!;
      await f.store.update(state.frozen.attemptId, state.revision, { kind });
      const retained = await readFile(join(f.stateDir, "first-setup.json"));
      let entered = false;
      await expect(
        admission.run(async () => {
          entered = true;
        }),
      ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
      expect(entered).toBe(false);
      expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(retained);
      expect(startupLockFromAnotherProcess(f.venueDir)).toBe("AVAILABLE");
    } finally {
      await f.dispose();
    }
  },
);

it.each(["anchor", "selected"] as const)(
  "startup refuses a busy %s venue before its callback and releases earlier locks",
  async (busy) => {
    const f = await replacement();
    let blocker: DatabaseSync | undefined;
    try {
      const admission = await resolveFirstSetupEntry(f.anchor, {});
      expect(admission.kind).toBe("normal");
      if (admission.kind !== "normal") throw new Error("expected startup admission");
      const path = busy === "anchor" ? f.anchor.venueDir : f.binding.venueDir;
      blocker = new DatabaseSync(join(path, "venue.lock"));
      blocker.exec("begin immediate");
      let entered = false;
      await expect(
        admission.run(async () => {
          entered = true;
        }),
      ).rejects.toMatchObject({ code: "provisioning.database_in_use" });
      expect(entered).toBe(false);
      if (busy === "selected")
        expect(startupLockFromAnotherProcess(f.anchor.venueDir)).toBe("AVAILABLE");
      blocker.close();
      blocker = undefined;
      for (const venueDir of [f.anchor.venueDir, f.binding.venueDir]) {
        expect(startupLockFromAnotherProcess(venueDir)).toBe("AVAILABLE");
        await expect(stat(join(venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      blocker?.close();
      await f.dispose();
    }
  },
);
