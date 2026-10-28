import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FRESH } from "./recovery-state.js";
import { runEntry } from "./node-entry.js";

const watch = vi.hoisted(() => ({ leftover: "", seen: [] as boolean[], spare: [] as unknown[] }));

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
