import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FRESH } from "./recovery-state.js";
import { SPARE_SPACE_BYTES } from "./spare-space.js";
import { runEntry } from "./node-entry.js";

const watch = vi.hoisted(() => ({
  leftover: "",
  seen: [] as boolean[],
  spare: [] as unknown[],
  spareFile: "",
  backupEntry: null as unknown,
  room: [] as { leftover: boolean; spare: boolean; deps: unknown }[],
}));

vi.mock("./first-setup-backup-entry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./first-setup-backup-entry.js")>();
  return {
    ...original,
    resolveFirstSetupBackupEntry: vi.fn(
      async (...args: Parameters<typeof original.resolveFirstSetupBackupEntry>) =>
        (watch.backupEntry as Awaited<ReturnType<typeof original.resolveFirstSetupBackupEntry>>) ??
        original.resolveFirstSetupBackupEntry(...args),
    ),
  };
});

vi.mock("./start-backup-room.js", () => ({
  deleteOldBackupsAtStart: vi.fn(async (deps: unknown) => {
    watch.room.push({
      leftover: existsSync(watch.leftover),
      spare: existsSync(watch.spareFile),
      deps,
    });
  }),
}));

vi.mock("./first-setup-entry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./first-setup-entry.js")>();
  return {
    ...original,
    resolveFirstSetupEntry: vi.fn(
      async (...args: Parameters<typeof original.resolveFirstSetupEntry>) => {
        watch.seen.push(existsSync(watch.leftover));
        watch.spare.push(args[4]);
        return original.resolveFirstSetupEntry(...args);
      },
    ),
  };
});

const dirs: string[] = [];
afterEach(async () => {
  watch.seen = [];
  watch.spare = [];
  watch.leftover = "";
  watch.spareFile = "";
  watch.backupEntry = null;
  watch.room = [];
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("deletes the leftovers before first-setup resolution runs", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "wt-entry-order-"));
  dirs.push(logDir);
  watch.leftover = join(logDir, "waitron.log.2");
  await writeFile(watch.leftover, "old lines");
  const stateDir = await mkdtemp(join(tmpdir(), "wt-entry-order-state-"));
  const venueDir = await mkdtemp(join(tmpdir(), "wt-entry-order-venue-"));
  dirs.push(stateDir, venueDir);

  await runEntry({
    args: [],
    baseEnv: {},
    stateDir,
    venueDir,
    assertNotAhead: vi.fn(() => Promise.resolve()),
    clearReplacedDatabases: vi.fn(() => Promise.resolve()),
    lockVenue: vi.fn(() => Promise.resolve({ release: () => {} })),
    loadBoxEnv: vi.fn((base: NodeJS.ProcessEnv) => Promise.resolve({ ...base })),
    readRecoveryState: vi.fn(() => Promise.resolve(FRESH)),
    writeRecoveryState: vi.fn(() => Promise.resolve()),
    withRecoveryLock: (_stateDir, body) => body(),
    startServer: vi.fn(() => Promise.resolve({ close: () => Promise.resolve() })),
    serveRecovery: vi.fn(() => Promise.resolve()),
    installShutdownHandlers: vi.fn(),
    scheduleStayedUp: vi.fn(),
    log: vi.fn(),
    logDir,
    statfs: () => Promise.resolve({ bavail: 10, frsize: 1 }),
    freeSpaceFloor: 1000,
  });

  expect(watch.seen).toEqual([false]);
});

it("deletes the spare before first-setup resolution runs", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "wt-entry-order-state-"));
  const venueDir = await mkdtemp(join(tmpdir(), "wt-entry-order-venue-"));
  const logDir = await mkdtemp(join(tmpdir(), "wt-entry-order-"));
  dirs.push(stateDir, venueDir, logDir);
  watch.leftover = join(stateDir, "spare-space");
  await writeFile(watch.leftover, Buffer.alloc(4096, 1));

  await runEntry({
    args: [],
    baseEnv: {},
    stateDir,
    venueDir,
    assertNotAhead: vi.fn(() => Promise.resolve()),
    clearReplacedDatabases: vi.fn(() => Promise.resolve()),
    lockVenue: vi.fn(() => Promise.resolve({ release: () => {} })),
    loadBoxEnv: vi.fn((base: NodeJS.ProcessEnv) => Promise.resolve({ ...base })),
    readRecoveryState: vi.fn(() => Promise.resolve(FRESH)),
    writeRecoveryState: vi.fn(() => Promise.resolve()),
    withRecoveryLock: (_stateDir, body) => body(),
    startServer: vi.fn(() => Promise.resolve({ close: () => Promise.resolve() })),
    serveRecovery: vi.fn(() => Promise.resolve()),
    installShutdownHandlers: vi.fn(),
    scheduleStayedUp: vi.fn(),
    log: vi.fn(),
    logDir,
    statfs: () => Promise.resolve({ bavail: 1024 * 1024, frsize: 1 }),
    spareBytes: 4096,
  });

  expect(watch.seen).toEqual([false]);
});

it.each([
  ["with a log folder given", true],
  ["with none, its default under the state folder", false],
])(
  "a start hands first-setup resolution the configured state, venue and log folders, %s",
  async (_name, withLogDir) => {
    const stateDir = await mkdtemp(join(tmpdir(), "wt-entry-order-state-"));
    const venueDir = await mkdtemp(join(tmpdir(), "wt-entry-order-venue-"));
    const logDir = await mkdtemp(join(tmpdir(), "wt-entry-order-"));
    dirs.push(stateDir, venueDir, logDir);
    const statfs = () => Promise.resolve({ bavail: 2 ** 40, frsize: 1 });

    await runEntry({
      args: [],
      baseEnv: {},
      stateDir,
      venueDir,
      assertNotAhead: vi.fn(() => Promise.resolve()),
      clearReplacedDatabases: vi.fn(() => Promise.resolve()),
      lockVenue: vi.fn(() => Promise.resolve({ release: () => {} })),
      loadBoxEnv: vi.fn((base: NodeJS.ProcessEnv) => Promise.resolve({ ...base })),
      readRecoveryState: vi.fn(() => Promise.resolve(FRESH)),
      writeRecoveryState: vi.fn(() => Promise.resolve()),
      withRecoveryLock: (_stateDir, body) => body(),
      startServer: vi.fn(() => Promise.resolve({ close: () => Promise.resolve() })),
      serveRecovery: vi.fn(() => Promise.resolve()),
      installShutdownHandlers: vi.fn(),
      scheduleStayedUp: vi.fn(),
      log: vi.fn(),
      ...(withLogDir ? { logDir } : {}),
      statfs,
    });

    expect(watch.spare).toEqual([
      {
        stateDir,
        venueDir,
        logDir: withLogDir ? logDir : join(stateDir, "logs"),
        statfs,
      },
    ]);
  },
);

function roomEntryDeps(
  dirs: { stateDir: string; venueDir: string; logDir: string },
  spare: { spareBytes?: number } = { spareBytes: 4096 },
) {
  return {
    args: [],
    baseEnv: { WAITRON_TEST_MARK: "base" },
    ...dirs,
    assertNotAhead: vi.fn(() => Promise.resolve()),
    clearReplacedDatabases: vi.fn(() => Promise.resolve()),
    lockVenue: vi.fn(() => Promise.resolve({ release: () => {} })),
    readVenueHolder: vi.fn(() => null),
    loadBoxEnv: vi.fn((base: NodeJS.ProcessEnv) => Promise.resolve({ ...base })),
    readRecoveryState: vi.fn(() => Promise.resolve(FRESH)),
    writeRecoveryState: vi.fn(() => Promise.resolve()),
    withRecoveryLock: <T>(_stateDir: string, body: () => Promise<T>) => body(),
    startServer: vi.fn(() => Promise.resolve({ close: () => Promise.resolve() })),
    serveRecovery: vi.fn(() => Promise.resolve()),
    installShutdownHandlers: vi.fn(),
    scheduleStayedUp: vi.fn(),
    log: vi.fn(),
    statfs: () => Promise.resolve({ bavail: 10, frsize: 1 }),
    freeSpaceFloor: 1000,
    ...spare,
    now: () => new Date("2026-10-29T10:00:00Z"),
  };
}

async function roomDirs() {
  const stateDir = await mkdtemp(join(tmpdir(), "wt-entry-order-state-"));
  const venueDir = await mkdtemp(join(tmpdir(), "wt-entry-order-venue-"));
  const logDir = await mkdtemp(join(tmpdir(), "wt-entry-order-"));
  dirs.push(stateDir, venueDir, logDir);
  watch.leftover = join(logDir, "waitron.log.2");
  await writeFile(watch.leftover, "old lines");
  watch.spareFile = join(stateDir, "spare-space");
  await writeFile(watch.spareFile, Buffer.alloc(4096, 1));
  return { stateDir, venueDir, logDir };
}

it("deletes old backups after the leftovers are deleted and before the spare is released", async () => {
  const roots = await roomDirs();
  const deps = roomEntryDeps(roots);

  await runEntry(deps);

  expect(watch.room).toEqual([
    {
      leftover: false,
      spare: true,
      deps: expect.objectContaining({
        stateDir: roots.stateDir,
        venueDir: roots.venueDir,
        baseEnv: deps.baseEnv,
        loadBoxEnv: deps.loadBoxEnv,
        spareBytes: 4096,
        floor: 1000,
        statfs: deps.statfs,
        lockVenue: deps.lockVenue,
        readVenueHolder: deps.readVenueHolder,
        now: deps.now,
        log: deps.log,
      }),
    },
  ]);
  expect(existsSync(watch.spareFile)).toBe(false);
});

it("the backup step's spare size defaults to the spare file's", async () => {
  const roots = await roomDirs();
  const deps = roomEntryDeps(roots, {});

  await runEntry(deps);

  expect(watch.room).toEqual([
    expect.objectContaining({
      deps: expect.objectContaining({ spareBytes: SPARE_SPACE_BYTES }),
    }),
  ]);
});

it.each(["repair", "selected"] as const)(
  "a start with a %s backup recovery deletes no old backups",
  async (kind) => {
    const roots = await roomDirs();
    const target = await roomDirs();
    watch.backupEntry =
      kind === "repair"
        ? { kind, roots: { stateDir: roots.stateDir, venueDir: roots.venueDir } }
        : {
            kind,
            roots: { stateDir: target.stateDir, venueDir: target.venueDir },
            run: <T>(body: () => Promise<T>) => body(),
          };

    await runEntry(roomEntryDeps(roots)).catch(() => {});

    expect(watch.room).toEqual([]);
  },
);
