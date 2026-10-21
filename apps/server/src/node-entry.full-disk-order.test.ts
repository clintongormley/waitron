import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FRESH } from "./recovery-state.js";
import { runEntry } from "./node-entry.js";

const watch = vi.hoisted(() => ({ leftover: "", seen: [] as boolean[] }));

vi.mock("./first-setup-entry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./first-setup-entry.js")>();
  return {
    ...original,
    resolveFirstSetupEntry: vi.fn(
      async (...args: Parameters<typeof original.resolveFirstSetupEntry>) => {
        watch.seen.push(existsSync(watch.leftover));
        return original.resolveFirstSetupEntry(...args);
      },
    ),
  };
});

const dirs: string[] = [];
afterEach(async () => {
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
