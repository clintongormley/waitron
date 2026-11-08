import { spawn, spawnSync } from "node:child_process";
import nativeFs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { cp, mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  openVenueDatabase,
  readStandardSeriesId,
  sales,
  nodes,
  locations,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import {
  fiscalAllocations,
  registrosFacturacion,
  VerifactuBackend,
} from "@waitron/fiscal-verifactu";
import { recordSale } from "@waitron/core";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { orderedMigrationSets, type WaitronModule } from "@waitron/module";
import { fakeSetlessModule } from "@waitron/module/src/testing/fake-module.js";
import { AppError, seriesId as brandSeriesId } from "@waitron/shared";
import { applyMigrations, migrationOptionsFor } from "@waitron/migrations";
import { ALL_MODULES } from "./modules.js";
import {
  restoreFromArtifactFile,
  runRestoreHooks,
  type PlacementDeps,
  type RestoreOperationRunner,
} from "./restore.js";
import { runStagedRestore } from "./restore-request.js";
import { writeStreamRestore } from "./restore-stream.js";
import { stagedHourCrash } from "./testing/staged-hour-crash.js";

vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let fixture: Awaited<ReturnType<typeof stagedHourCrash>> | undefined;
async function stage(kind: "archive" | "stream") {
  fixture = await stagedHourCrash(suite, kind, "emergency-offline-restore");
  const originalRecords = await suite.db.select().from(registrosFacturacion);
  expect(originalRecords).toHaveLength(1);
  return { ...fixture, originalRecords };
}
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  await fixture?.cleanup();
  fixture = undefined;
});
async function markPlaced(stateDir: string) {
  const path = join(stateDir, "restore-request.json");
  const marker = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...marker, placementStarted: true }));
  return path;
}

it("refuses a resumed database from a newer image before migration or hour admission", async () => {
  const f = await stage("archive");
  await f.seedDestination();
  const target = await openVenueDatabase(f.venueDir);
  try {
    await target.venue.run(
      sql`insert into __drizzle_migrations_db (hash, created_at) values (${"f".repeat(64)}, 99999999999999)`,
    );
  } finally {
    await target.close();
  }
  const markerPath = await markPlaced(f.stateDir);
  const journal = f.journal();
  await expect(f.run()).rejects.toMatchObject({ code: "provisioning.database_ahead" });
  expect(f.journal()).toBe(journal);
  expect(JSON.parse(await readFile(markerPath, "utf8")).placementStarted).toBe(true);
});

it("restarts a marked restore without a placed database after authenticating its selected source", async () => {
  const f = await stage("archive");
  await markPlaced(f.stateDir);
  const journal = f.journal();
  await expect(f.run()).resolves.toBe(true);
  await expectFinishedRetry(f, journal);
});

it.each([
  ["archive", "settings"],
  ["stream", "settings"],
  ["archive", "credentials"],
  ["stream", "credentials"],
] as const)(
  "keeps the committed %s activation when the %s write throws before completion",
  async (kind, fault) => {
    const f = await stage(kind);
    const failure = Object.assign(new Error("injected post-commit write failure"), { code: "EIO" });
    const target = join(f.stateDir, fault === "settings" ? "trading.env" : "credentials.key");
    const originalRename = nativeFs.rename;
    vi.spyOn(nativeFs, "rename").mockImplementation(async (...args) => {
      if (String(args[0]) === `${target}.incoming` && String(args[1]) === target) throw failure;
      return originalRename(...args);
    });
    syncBuiltinESMExports();
    await expect(f.run()).rejects.toBe(failure);
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    const committed = await f.snapshot();
    expect(committed.allocations).toHaveLength(2);
    expect(committed.records).toEqual(f.originalRecords);
    expect(await readdir(f.stateDir)).toContain("restore-request.json");
    expect(
      JSON.parse(await readFile(join(f.stateDir, "restore-request.json"), "utf8")),
    ).toHaveProperty("placementStarted", true);
    expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(f.key.secret);
    await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await f.advanceCounters();
    const advanced = await f.snapshot();
    await expect(f.run()).resolves.toBe(true);
    expect(await f.snapshot()).toEqual(advanced);
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(f.node.nodeId);
    await expect(readFile(join(f.stateDir, "restore-request.node-key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await f.run()).toBe(false);
  },
);

/** Every call of `nativeFs[method]` that `matches` picks throws `failure` until the mocks are
 * restored. */
function failEvery(
  method: "copyFile" | "rename" | "writeFile",
  matches: (...args: string[]) => boolean,
  failure: Error,
) {
  const original = nativeFs[method] as (...args: unknown[]) => Promise<unknown>;
  vi.spyOn(nativeFs, method).mockImplementation((async (...args: unknown[]) => {
    if (matches(...args.map(String))) throw failure;
    return original(...args);
  }) as never);
  syncBuiltinESMExports();
}

const enospc = () =>
  Object.assign(new Error("injected full disk before placement"), { code: "ENOSPC" });

const beforePlacement = {
  "the first-start marker cannot be written": (f: Awaited<ReturnType<typeof stage>>) =>
    failEvery(
      "writeFile",
      (path) => path === join(f.stateDir, "rebuild-first-start.json.tmp"),
      enospc(),
    ),
  "the copy for the admission check cannot be written": () =>
    failEvery("copyFile", (_from, to) => to.includes("restore-admission-"), enospc()),
};

it.each(
  (["archive", "stream"] as const).flatMap((kind) =>
    Object.keys(beforePlacement).map(
      (name) => [kind, name as keyof typeof beforePlacement] as const,
    ),
  ),
)(
  "a started %s request whose restore stops before placement because %s gets its marker back and the next start finishes it",
  async (kind, name) => {
    const inject = beforePlacement[name];
    const f = await stage(kind);
    const markerPath = join(f.stateDir, "restore-request.json");
    const before = await readFile(markerPath, "utf8");
    inject(f);
    await expect(f.run()).rejects.toMatchObject({ code: "ENOSPC" });
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    expect(await readFile(markerPath, "utf8")).toBe(before);
    expect(await readdir(f.venueDir)).not.toContain("venue.db");
    await expect(f.run()).resolves.toBe(true);
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(f.node.nodeId);
  },
);

it("a started request whose database move leaves the old one set aside gets its marker back and the next start finishes it", async () => {
  const f = await stage("archive");
  await f.seedDestination();
  const markerPath = join(f.stateDir, "restore-request.json");
  const before = await readFile(markerPath, "utf8");
  const venueFile = join(f.venueDir, "venue.db");
  failEvery(
    "rename",
    (_from, to) => to === venueFile,
    Object.assign(new Error("injected placement failure"), { code: "EIO" }),
  );
  await expect(f.run()).rejects.toMatchObject({
    code: "restore.placement_failed",
    params: { kept: "set_aside" },
  });
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  expect(await readFile(markerPath, "utf8")).toBe(before);
  await expect(f.run()).resolves.toBe(true);
  expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(f.node.nodeId);
  expect((await f.snapshot()).allocations).toHaveLength(2);
});

// The identity's way back failing does not keep "placement started": nothing a module step commits
// has run, so the next start places the archive afresh, and the old identity stays set aside.
it("a started request whose old identity cannot be put back after a placement failure gets its marker back", async () => {
  const f = await stage("archive");
  await f.seedDestination();
  const previousIdentity = `WAITRON_NODE_ID=${f.node.nodeId}\nWAITRON_ENV=preproduction\n# old box\n`;
  await writeFile(join(f.stateDir, "trading.env"), previousIdentity, { mode: 0o600 });
  const markerPath = join(f.stateDir, "restore-request.json");
  const before = await readFile(markerPath, "utf8");
  const venueFile = join(f.venueDir, "venue.db");
  const replaced = join(f.stateDir, "trading.env.replaced");
  failEvery(
    "rename",
    (from, to) => (from === `${venueFile}.incoming` && to === venueFile) || from === replaced,
    Object.assign(new Error("injected placement failure"), { code: "EIO" }),
  );
  await expect(f.run()).rejects.toMatchObject({
    code: "restore.placement_failed",
    params: { kept: "previous" },
  });
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(replaced, "utf8")).toBe(previousIdentity);
  expect(await readFile(markerPath, "utf8")).toBe(before);
  await expect(f.run()).resolves.toBe(true);
  expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).not.toBe(previousIdentity);
  expect(await readFile(replaced, "utf8")).toBe(previousIdentity);
});

const throwingHook: WaitronModule = {
  ...fakeSetlessModule("synthetic-failing-restore", "core"),
  backup: {
    restore: async () => {
      throw new AppError("module.operation_invalid", { module: "synthetic-failing-restore" });
    },
  },
} as WaitronModule;

const afterPlacement = {
  "its migration fails": {
    inject: (f: Awaited<ReturnType<typeof stage>>): Partial<PlacementDeps> => ({
      migrate: async (directory, options) => {
        if (directory === f.venueDir)
          throw new AppError("migrations.apply_failed", { set: "__drizzle_migrations_db" });
        return applyMigrations(directory, options);
      },
    }),
    code: "migrations.apply_failed",
    fiscalHookRan: false,
  },
  // Last, so the fiscal hook has run in the same transaction before this one throws.
  "a module's restore hook throws": {
    inject: (): Partial<PlacementDeps> => ({ modules: [...ALL_MODULES, throwingHook] }),
    code: "restore.hook_failed",
    fiscalHookRan: true,
  },
};

it.each(
  (["archive", "stream"] as const).flatMap((kind) =>
    Object.keys(afterPlacement).map((name) => [kind, name as keyof typeof afterPlacement] as const),
  ),
)(
  "a started %s request whose restore stops after placement because %s gets its marker back and the next start finishes it",
  async (kind, name) => {
    const f = await stage(kind);
    await f.seedDestination();
    const previousIdentity = `WAITRON_NODE_ID=${f.node.nodeId}\nWAITRON_ENV=preproduction\n# old box\n`;
    await writeFile(join(f.stateDir, "trading.env"), previousIdentity, { mode: 0o600 });
    const markerPath = join(f.stateDir, "restore-request.json");
    const before = await readFile(markerPath, "utf8");
    const fault = afterPlacement[name];
    const injected = fault.inject(f);
    const journal = f.journal();
    const hooksDone: unknown[] = [];
    await expect(
      runStagedRestore(
        {
          ...f.restore,
          log: (_level, event, fields) => {
            if (event === "restore.hook.done") hooksDone.push(fields?.module);
          },
        },
        (deps) => restoreFromArtifactFile({ ...deps, ...injected }),
        (args) => writeStreamRestore({ ...args, ...injected }),
      ),
    ).rejects.toMatchObject({ code: fault.code });
    expect(hooksDone.includes("fiscal-verifactu")).toBe(fault.fiscalHookRan);
    expect(await readFile(markerPath, "utf8")).toBe(before);
    expect(f.journal()).toBe(journal);
    const placed = await f.snapshot();
    expect(placed.allocations.map((row) => row.installationIdentity)).toEqual(["0CNNW"]);
    await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const replaced = join(f.stateDir, "trading.env.replaced");
    expect(await readFile(replaced, "utf8")).toBe(previousIdentity);
    await expect(f.run()).resolves.toBe(true);
    const restored = await f.snapshot();
    expect(restored.allocations.map((row) => row.installationIdentity)).toEqual(["0CNNW", "0CNQR"]);
    expect(restored.records).toEqual(f.originalRecords);
    expect(restored.registrations).toHaveLength(2);
    const selected: { code: string }[] =
      JSON.parse(before).recoveryOperation.input.allocation.series;
    expect(
      restored.series
        .filter((row) => row.retiredAt === null)
        .map((row) => row.code)
        .sort(),
    ).toEqual(selected.map((row) => row.code).sort());
    const identity = await readFile(join(f.stateDir, "trading.env"), "utf8");
    expect(identity).toContain(f.node.nodeId);
    expect(identity).not.toBe(previousIdentity);
    expect(await readFile(replaced, "utf8")).toBe(previousIdentity);
    expect(await f.run()).toBe(false);
  },
);

it.each(["archive", "stream"] as const)(
  "a started %s request that fails after its restore hooks committed keeps placement started, and the next start finishes it by a checked replay",
  async (kind) => {
    const f = await stage(kind);
    await f.seedDestination();
    const failure = new Error("injected failure closing the committed database");
    const openDb: PlacementDeps["openDb"] = async (directory) => {
      const store = await openVenueDatabase(directory);
      return {
        db: store.venue,
        node: store.node,
        close: async () => {
          await store.close();
          if (directory === f.venueDir) throw failure;
        },
      };
    };
    await expect(
      runStagedRestore(
        { ...f.restore },
        (deps) => restoreFromArtifactFile({ ...deps, openDb }),
        (args) => writeStreamRestore({ ...args, openDb }),
      ),
    ).rejects.toBe(failure);
    expect(
      JSON.parse(await readFile(join(f.stateDir, "restore-request.json"), "utf8")),
    ).toHaveProperty("placementStarted", true);
    const committed = await f.snapshot();
    expect(committed.allocations.map((row) => row.installationIdentity)).toEqual([
      "0CNNW",
      "0CNQR",
    ]);
    await expect(f.run()).resolves.toBe(true);
    expect(await f.snapshot()).toEqual(committed);
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(f.node.nodeId);
  },
);

it.each(["archive", "stream"] as const)(
  "a started %s request whose restore runner fails after its save went through keeps placement started, and the next start finishes it by a checked replay",
  async (kind) => {
    const f = await stage(kind);
    await f.seedDestination();
    const failure = new Error("injected failure after the runner's save");
    const failAfter = (runner: RestoreOperationRunner | undefined): RestoreOperationRunner => {
      const wrapped: RestoreOperationRunner = async (context, run) => {
        await runner!(context, run);
        throw failure;
      };
      if (runner?.checkBeforePlacement !== undefined)
        wrapped.checkBeforePlacement = runner.checkBeforePlacement;
      return wrapped;
    };
    await expect(
      runStagedRestore(
        { ...f.restore },
        (deps) =>
          restoreFromArtifactFile({
            ...deps,
            withModuleOperations: failAfter(deps.withModuleOperations),
          }),
        (args) =>
          writeStreamRestore({
            ...args,
            withModuleOperations: failAfter(args.withModuleOperations),
          }),
      ),
    ).rejects.toBe(failure);
    expect(
      JSON.parse(await readFile(join(f.stateDir, "restore-request.json"), "utf8")),
    ).toHaveProperty("placementStarted", true);
    const committed = await f.snapshot();
    expect(committed.allocations.map((row) => row.installationIdentity)).toEqual([
      "0CNNW",
      "0CNQR",
    ]);
    await expect(f.run()).resolves.toBe(true);
    expect(await f.snapshot()).toEqual(committed);
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(f.node.nodeId);
  },
);

async function expectFinishedRetry(f: Awaited<ReturnType<typeof stage>>, journal: string) {
  expect(f.journal()).toBe(journal);
  const active = await f.snapshot();
  expect(active.records).toEqual(f.originalRecords);
  expect(active.allocations.map((row) => row.installationIdentity)).toEqual(["0CNNW", "0CNQR"]);
  expect(active.allocations.slice(0, 1)).toEqual(await suite.db.select().from(fiscalAllocations));
  expect(active.allocations.filter((row) => row.eventKey === f.binding.eventId)).toHaveLength(1);
  expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(f.node.nodeId);
  const files = await readdir(f.stateDir);
  for (const file of [
    "restore-request.json",
    "restore-request.node-key",
    "restore-request.artifact",
    "restore-request.key",
    "restore-request.db",
    "restore-request.entries",
    "restore-request.placement.db",
  ])
    expect(files).not.toContain(file);
  await expect(f.run()).resolves.toBe(false);
  expect(await f.snapshot()).toEqual(active);
}

it.each(["archive", "stream"] as const)(
  "restarts a marked %s placement when its authenticated destination has no committed activation",
  async (kind) => {
    const f = await stage(kind);
    await cp(f.databasePath, join(f.venueDir, "venue.db"));
    await suite.node.archiveTo(join(f.venueDir, "node.db"));
    await markPlaced(f.stateDir);
    const original = await f.snapshot();
    expect(original.allocations.map((row) => row.installationIdentity)).toEqual(["0CNNW"]);
    const journal = f.journal();
    await expect(f.run()).resolves.toBe(true);
    await expectFinishedRetry(f, journal);
    expect((await f.snapshot()).allocations.slice(0, 1)).toEqual(original.allocations);
  },
);

it("migrates a behind-schema destination before deciding whether placement can restart", async () => {
  const f = await stage("archive");
  const destination = await openVenueDatabase(f.venueDir);
  await destination.close();
  await markPlaced(f.stateDir);
  const journal = f.journal();
  await expect(f.run()).resolves.toBe(true);
  await expectFinishedRetry(f, journal);
});

it("restarts over a destination that contains only another node", async () => {
  const f = await stage("archive");
  await applyMigrations(f.venueDir, migrationOptionsFor(orderedMigrationSets(ALL_MODULES), null));
  const destination = await openVenueDatabase(f.venueDir);
  try {
    const other = (await suite.db.select().from(nodes)).find((row) => row.id !== f.node.nodeId)!;
    await destination.venue.insert(locations).values(await suite.db.select().from(locations));
    await destination.venue.insert(nodes).values(other);
  } finally {
    await destination.close();
  }
  await markPlaced(f.stateDir);
  const journal = f.journal();
  await expect(f.run()).resolves.toBe(true);
  await expectFinishedRetry(f, journal);
});

it("keeps a started stream request when its fresh placement copy cannot be written", async () => {
  const f = await stage("stream");
  await f.seedDestination();
  const markerPath = await markPlaced(f.stateDir);
  const marker = await readFile(markerPath, "utf8");
  const source = await readFile(join(f.stateDir, "restore-request.db"));
  failEvery(
    "copyFile",
    (_from, to) => to === join(f.stateDir, "restore-request.placement.db"),
    enospc(),
  );
  await expect(f.run()).rejects.toMatchObject({ code: "ENOSPC" });
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  expect(await readFile(markerPath, "utf8")).toBe(marker);
  expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(f.key.secret);
  expect(await readFile(join(f.stateDir, "restore-request.db"))).toEqual(source);
  const journal = f.journal();
  await expect(f.run()).resolves.toBe(true);
  await expectFinishedRetry(f, journal);
});

it("keeps a request when the original marker cannot be restored after an uncommitted failure", async () => {
  const f = await stage("archive");
  let writes = 0;
  const markerPath = join(f.stateDir, "restore-request.json");
  const rename = nativeFs.rename;
  vi.spyOn(nativeFs, "rename").mockImplementation(async (...args) => {
    if (String(args[1]) === markerPath && ++writes === 2) throw enospc();
    return rename(...args);
  });
  syncBuiltinESMExports();
  const failure = enospc();
  const restore = async () => {
    throw failure;
  };
  await expect(runStagedRestore(f.restore, restore)).rejects.toMatchObject({ code: "ENOSPC" });
  expect(writes).toBe(2);
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  expect(JSON.parse(await readFile(markerPath, "utf8")).placementStarted).toBe(true);
  expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(f.key.secret);
  const journal = f.journal();
  await expect(f.run()).resolves.toBe(true);
  await expectFinishedRetry(f, journal);
});

it("retains a started request when the destination path is not a regular file", async () => {
  const f = await stage("archive");
  await mkdir(join(f.venueDir, "venue.db"));
  const markerPath = await markPlaced(f.stateDir);
  const marker = await readFile(markerPath, "utf8");
  await expect(f.run()).rejects.toMatchObject({ code: "module.operation_invalid" });
  expect(await readFile(markerPath, "utf8")).toBe(marker);
  expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(f.key.secret);
});

it("refuses a destination link before opening or migrating its target", async () => {
  const f = await stage("archive");
  const target = join(f.root, "linked.db");
  const original = Buffer.alloc(0);
  await writeFile(target, original);
  await symlink(target, join(f.venueDir, "venue.db"));
  const markerPath = await markPlaced(f.stateDir);
  const marker = await readFile(markerPath, "utf8");
  const journal = f.journal();
  await expect(f.run()).rejects.toMatchObject({ code: "module.operation_invalid" });
  expect((await readFile(target)).byteLength).toBe(original.byteLength);
  expect(await readFile(markerPath, "utf8")).toBe(marker);
  expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(f.key.secret);
  expect(f.journal()).toBe(journal);
});

it("keeps a corrupt destination as evidence and retries the same request after it is moved aside", async () => {
  const f = await stage("archive");
  const file = join(f.venueDir, "venue.db");
  const corrupt = Buffer.from("not a SQLite database");
  await writeFile(file, corrupt);
  const markerPath = await markPlaced(f.stateDir);
  const marker = await readFile(markerPath, "utf8");
  const journal = f.journal();
  await expect(f.run()).rejects.toMatchObject({ code: "ERR_SQLITE_ERROR", errcode: 26 });
  await expect(f.nextEvent()).rejects.toMatchObject({ code: "module.operation_invalid" });
  expect(await readFile(markerPath, "utf8")).toBe(marker);
  expect(await readFile(file)).toEqual(corrupt);
  expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(f.key.secret);
  const kept = join(f.venueDir, "venue.db.unreadable");
  await rename(file, kept);
  await expect(f.run()).resolves.toBe(true);
  expect(await readFile(kept)).toEqual(corrupt);
  await expectFinishedRetry(f, journal);
});

it("refuses a changed target node before reading destination recovery state", async () => {
  const f = await stage("archive");
  await f.seedDestination();
  const markerPath = await markPlaced(f.stateDir);
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  marker.recoveryOperation.binding.targetNodeId = "00000000-0000-4000-8000-000000000001";
  const altered = JSON.stringify(marker);
  await writeFile(markerPath, altered);
  const original = await f.snapshot();
  const journal = f.journal();
  await expect(f.run()).rejects.toMatchObject({ code: "module.operation_invalid" });
  expect(await readFile(markerPath, "utf8")).toBe(altered);
  expect(await f.snapshot()).toEqual(original);
  expect(f.journal()).toBe(journal);
});

it("refuses a destination with the selected node but invalid recovery facts", async () => {
  const f = await stage("archive");
  await applyMigrations(f.venueDir, migrationOptionsFor(orderedMigrationSets(ALL_MODULES), null));
  const destination = await openVenueDatabase(f.venueDir);
  try {
    await destination.venue.insert(locations).values(await suite.db.select().from(locations));
    await destination.venue
      .insert(nodes)
      .values((await suite.db.select().from(nodes)).find((row) => row.id === f.node.nodeId)!);
  } finally {
    await destination.close();
  }
  const markerPath = await markPlaced(f.stateDir);
  const marker = await readFile(markerPath, "utf8");
  const original = await f.snapshot();
  await expect(f.run()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "event_mismatch" },
  });
  expect(await readFile(markerPath, "utf8")).toBe(marker);
  expect(await f.snapshot()).toEqual(original);
});

it("refuses and retains staging without a module recovery-state reader", async () => {
  const f = await stage("archive");
  await f.seedDestination();
  const markerPath = await markPlaced(f.stateDir);
  const marker = await readFile(markerPath, "utf8");
  const original = await f.snapshot();
  const operations = ALL_MODULES.find((module) => module.name === f.binding.module)!.operations!;
  const reader = operations.readRecoveryState!;
  delete operations.readRecoveryState;
  try {
    await expect(f.run()).rejects.toMatchObject({ code: "module.operation_invalid" });
  } finally {
    operations.readRecoveryState = reader;
  }
  expect(await readFile(markerPath, "utf8")).toBe(marker);
  expect(await f.snapshot()).toEqual(original);
  expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(f.key.secret);
});

it.each(["unknown", "throw"] as const)(
  "refuses and retains staging when activation state is %s",
  async (state) => {
    const f = await stage("archive");
    await f.seedDestination();
    const markerPath = await markPlaced(f.stateDir);
    const marker = await readFile(markerPath, "utf8");
    const original = await f.snapshot();
    const operations = ALL_MODULES.find((module) => module.name === f.binding.module)!.operations!;
    const read = vi.spyOn(operations, "readRecoveryState");
    if (state === "throw")
      read.mockRejectedValueOnce(
        new AppError("module.operation_invalid", { module: f.binding.module }),
      );
    else read.mockResolvedValueOnce({ priorActivation: "unknown" } as never);
    await expect(f.run()).rejects.toMatchObject({ code: "module.operation_invalid" });
    expect(await readFile(markerPath, "utf8")).toBe(marker);
    expect(await f.snapshot()).toEqual(original);
    expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(f.key.secret);
  },
);

it.each(["archive", "stream"] as const)(
  "keeps the committed %s activation after a process is killed before publishing trading settings",
  async (kind) => {
    const f = await stage(kind);
    const previousIdentity = `# existing physical box\nWAITRON_NODE_ID=${f.node.nodeId}\nWAITRON_ENV=preproduction\n`;
    await writeFile(join(f.stateDir, "trading.env"), previousIdentity, { mode: 0o600 });
    await f.seedDestination();
    const output = await killRestore(f, "before-publication");
    expect(output).not.toContain(f.key.secret);
    expect(output).not.toContain(f.encryptionKey);
    await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const markerPath = join(f.stateDir, "restore-request.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    const committed = await f.snapshot();
    expect(committed.allocations).toHaveLength(2);
    expect(committed.allocations.map((row) => row.installationIdentity)).toEqual([
      "0CNNW",
      "0CNQR",
    ]);
    const copy = await openVenueDatabase(f.venueDir);
    try {
      await runRestoreHooks({
        db: copy.venue,
        nodeDb: copy.node,
        node: f.node,
        modules: ALL_MODULES,
        log: () => {},
        withModuleOperations: f.service.runner(marker.recoveryOperation.input, { refresh: true }),
        resumeOperation: f.binding,
      });
      expect(await copy.venue.select().from(fiscalAllocations)).toEqual(committed.allocations);
    } finally {
      await copy.close();
    }
    const expectRetained = async () => {
      expect(await f.snapshot()).toEqual(committed);
      expect(JSON.parse(await readFile(markerPath, "utf8")).placementStarted).toBe(true);
      await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    };
    const journal = f.journal();
    await writeFile(f.journalPath, JSON.stringify({ version: 1, revisions: [] }));
    await expect(f.run()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_missing" },
    });
    await expectRetained();
    await writeFile(f.journalPath, journal);
    await writeFile(join(f.stateDir, "restore-request.node-key"), "wrong-node-key");
    await expect(f.run()).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    await expectRetained();
    await writeFile(join(f.stateDir, "restore-request.node-key"), f.key.secret);
    const originalMarker = await readFile(markerPath, "utf8");
    await writeFile(
      markerPath,
      JSON.stringify({
        ...marker,
        recoveryOperation: {
          ...marker.recoveryOperation,
          binding: { ...marker.recoveryOperation.binding, sourceId: "different-copy" },
        },
      }),
    );
    await expect(f.run()).rejects.toMatchObject({
      code: "server.config_invalid",
      params: { reason: "source_mismatch" },
    });
    await expectRetained();
    await writeFile(markerPath, originalMarker);
    await f.advanceCounters();
    const advanced = await f.snapshot();
    await expect(f.run()).resolves.toBe(true);
    expect(await f.snapshot()).toEqual(advanced);
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).toContain(f.node.nodeId);
    expect(await readFile(join(f.stateDir, "trading.env"), "utf8")).not.toContain(
      ["WAITRON", "LOCATION", "ID"].join("_") + "=",
    );
    expect(await readFile(join(f.stateDir, "trading.env.replaced"), "utf8")).toBe(previousIdentity);
    expect(await f.run()).toBe(false);
    const selling = await openVenueDatabase(f.venueDir);
    let networkCalls = 0;
    try {
      expect(
        await selling.venue
          .select({ locationId: nodes.locationId })
          .from(nodes)
          .where(eq(nodes.id, f.node.nodeId)),
      ).toEqual([{ locationId: f.node.locationId }]);
      const backend = new VerifactuBackend({
        db: selling.venue,
        deploymentEnvironment: "preproduction",
        clock: steadyClock,
        resolveClient: async () => {
          networkCalls++;
          throw new Error("recovery test has no network");
        },
      });
      const seriesId = await readStandardSeriesId(selling.venue, f.node.nodeId);
      const result = await withTransaction(selling.venue, (tx) =>
        recordSale(
          tx,
          backend,
          saleInput({ nodeId: f.node.nodeId, seriesId: brandSeriesId(seriesId) }),
        ),
      );
      const [sale] = await selling.venue.select().from(sales).where(eq(sales.id, result.saleId));
      expect(sale?.invoiceNumber).toBe(917);
      const rows = await selling.venue.select().from(registrosFacturacion);
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.saleId !== result.saleId)).toEqual(f.originalRecords);
      const allocation = (await selling.venue.select().from(fiscalAllocations)).find(
        (row) => row.eventKey === f.binding.eventId,
      )!;
      const issued = rows.find((row) => row.saleId === result.saleId);
      expect(issued).toMatchObject({
        saleId: result.saleId,
        sifId: allocation.sifId,
        primerRegistro: true,
        secuencia: 2,
      });
      expect(issued!.numSerieFactura).toBe(
        `${allocation.allocation.series.find((series) => series.purpose === "standard")!.code}/917`,
      );
      expect(networkCalls).toBe(0);
    } finally {
      await selling.close();
    }
  },
);

async function killRestore(f: Awaited<ReturnType<typeof stage>>, phase: string) {
  const migrationsRoot = join(f.root, "migrations");
  const sets = orderedMigrationSets(ALL_MODULES);
  const options = migrationOptionsFor(sets, null);
  for (let i = 0; i < options.length; i++)
    await cp(options[i]!.migrationsFolder, join(migrationsRoot, sets[i]!.name), {
      recursive: true,
    });
  const entry = join(f.root, "crash-entry.mjs");
  const binary = join(f.root, "crash-binary.mjs");
  const preload = join(f.root, "synthetic-clock.mjs");
  await writeFile(
    preload,
    `import https from "node:https";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
const OriginalDate = Date;
const started = OriginalDate.now();
const fixed = OriginalDate.parse("2026-10-16T12:40:00Z");
globalThis.Date = class extends OriginalDate {
  constructor(...args) { super(...(args.length ? args : [fixed + OriginalDate.now() - started])); }
  static now() { return fixed + OriginalDate.now() - started; }
};
https.request = (url, options, receive) => {
  if (url.protocol !== "https:" || options.method !== "HEAD" || options.rejectUnauthorized !== true) throw new Error("unexpected clock request");
  const request = new EventEmitter();
  request.end = () => receive({ headers: { date: new Date().toUTCString() }, statusCode: 200, destroy() {} });
  return request;
};
syncBuiltinESMExports();
`,
  );
  await writeFile(
    entry,
    `
import nativeFs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { writeSync } from "node:fs";
import { runStagedRestore } from ${JSON.stringify(resolve("src/restore-request.ts"))};
const [stateDir, venueDir, migrationsRoot, phase] = process.argv.slice(2);
const wait = async () => { console.log("RECOVERY_CRASH_GATE"); await new Promise(() => { setInterval(() => {}, 1000); }); };
if (phase === "staged" || phase === "hour-selected") await wait();
const original = nativeFs.rename;
nativeFs.rename = async (from, to) => {
  if (phase === "before-publication" && String(to) === join(stateDir, "trading.env")) await wait();
  return original(from, to);
};
syncBuiltinESMExports();
await runStagedRestore({ stateDir, venueDir, migrationsRoot, log: (_level, event, fields) => {
  if (phase === "before-commit" && event === "restore.hook.done" && fields?.module === "fiscal-verifactu") { writeSync(1,"RECOVERY_CRASH_GATE\\n"); process.kill(process.pid,"SIGSTOP"); }
} });
if (phase === "before-first-sale") await wait();
throw new Error("publication gate was not reached");
`,
  );
  const buildScript = join(f.root, "build-command.mjs");
  await writeFile(
    buildScript,
    `import { bundle } from ${JSON.stringify(new URL("../../../scripts/bundle-node.mjs", import.meta.url).href)};
bundle([{ entry: ${JSON.stringify(entry)}, outfile: ${JSON.stringify(binary)} }], { release: { sourceCommit: "${"a".repeat(40)}", committedAt: "2026-10-15T00:00:00.000Z", instantMs: Date.parse("2026-10-15T00:00:00Z"), generator: "scripts/generate-hour-release.mjs:v1", generatorSha256: "${"b".repeat(64)}" } });
`,
  );
  const built = spawnSync(process.execPath, [buildScript], { encoding: "utf8", timeout: 30_000 });
  expect(built.status, built.stderr).toBe(0);
  const child = spawn(
    process.execPath,
    ["--import", preload, binary, f.stateDir, f.venueDir, migrationsRoot, phase],
    { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    },
  );
  let output = "";
  const ready = new Promise<void>((resolveReady) => {
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("RECOVERY_CRASH_GATE\n")) resolveReady();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
  });
  const deadline = AbortSignal.timeout(15_000);
  const timedOut = new Promise<never>((_resolve, reject) => {
    deadline.addEventListener("abort", () => reject(new Error(`crash gate timed out: ${output}`)), {
      once: true,
    });
  });
  try {
    await Promise.race([
      ready,
      timedOut,
      exited.then((result) => {
        throw new Error(`child exited before gate: ${JSON.stringify(result)} ${output}`);
      }),
    ]);
    expect(child.pid).toBeGreaterThan(0);
    expect(child.kill("SIGKILL")).toBe(true);
    await expect(exited).resolves.toEqual({ code: null, signal: "SIGKILL" });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
  return output;
}

it.each(["archive", "stream"] as const)(
  "a %s restore stopped after staging can start normally",
  async (kind) => {
    const f = await stage(kind);
    const journal = f.journal();
    await killRestore(f, "staged");
    expect(f.journal()).toBe(journal);
    await expect(f.run()).resolves.toBe(true);
    expect((await f.snapshot()).records).toEqual(f.originalRecords);
  },
);
it.each(["archive", "stream"] as const)(
  "a completed %s restore stopped before its first sale does not activate twice",
  async (kind) => {
    const f = await stage(kind);
    await killRestore(f, "before-first-sale");
    const before = await f.snapshot();
    const journal = f.journal();
    await expect(f.run()).resolves.toBe(false);
    expect(f.journal()).toBe(journal);
    expect(await f.snapshot()).toEqual(before);
    expect(before.allocations).toHaveLength(2);
    expect(before.records).toEqual(f.originalRecords);
  },
);
for (const kind of ["archive", "stream"] as const)
  for (const phase of ["hour-selected", "before-commit"]) {
    it(`retains the ${kind} spent hour when killed at ${phase} without a local committed result`, async () => {
      const f = await stage(kind);
      await killRestore(f, phase);
      const journal = f.journal();
      expect(journal).toContain("0CNQR");
      const priorIntent = JSON.parse(journal).revisions;
      if (phase === "before-commit") {
        const original = await f.snapshot();
        expect(original.allocations.map((row) => row.installationIdentity)).toEqual(["0CNNW"]);
        expect(original.records).toEqual(f.originalRecords);
        await expect(f.run()).resolves.toBe(true);
        await expectFinishedRetry(f, journal);
        expect((await f.snapshot()).allocations.slice(0, 1)).toEqual(original.allocations);
        return;
      }
      // The settle wait alone ends at 12:40, the killed restore's name (0CNQR).
      vi.setSystemTime(new Date("2026-10-16T12:38:00Z"));
      await expect(f.nextEvent()).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "minute_in_use", allowedFromMs: Date.parse("2026-10-16T12:41:00Z") },
      });
      expect(f.journal()).toBe(journal);
      await f.freshStage();
      await expect(f.run()).resolves.toBe(true);
      expect(JSON.parse(f.journal()).revisions.slice(0, priorIntent.length)).toEqual(priorIntent);
      const active = await f.snapshot();
      expect(active.allocations).toHaveLength(2);
      expect(active.allocations.map((row) => row.installationIdentity)).toEqual(["0CNNW", "0CNSM"]);
      expect(active.allocations[1]!.eventKey).toBe("fresh-after-interruption");
      expect(active.records).toEqual(f.originalRecords);
    });
  }
