import { existsSync, readdirSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REPLACED_RESET_FILE, SPARE_SPACE_FILE } from "@waitron/store";
import { runEntry } from "./node-entry.js";
import { FRESH, type RecoveryState } from "./recovery-state.js";
import { writeReplacedResetMarker } from "./replaced-reset.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { leafHostnamesFor } from "./box-name.js";
import { copyMigrationsRoot, httpsVia } from "./testing/boot-harness.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";

vi.mock("@hono/node-server", async () =>
  (await import("./testing/ephemeral-listener.js")).ephemeralHttpMock(),
);

const { startServer, httpPort } = ephemeralServerFixture();

const { seen, watched } = vi.hoisted(() => {
  const seen = { steps: [] as string[] };
  const watched =
    <A extends unknown[], R>(step: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      seen.steps.push(step);
      return fn(...args);
    };
  return { seen, watched };
});

vi.mock("./start-space.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./start-space.js")>();
  return { ...actual, freeSpaceAtStart: watched("free-space", actual.freeSpaceAtStart) };
});
vi.mock("./start-backup-room.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./start-backup-room.js")>();
  return {
    ...actual,
    deleteOldBackupsAtStart: watched("old-backups", actual.deleteOldBackupsAtStart),
  };
});
vi.mock("./spare-space.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./spare-space.js")>();
  return { ...actual, releaseSpare: watched("spare-release", actual.releaseSpare) };
});
vi.mock("./replaced-reset.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./replaced-reset.js")>();
  return { ...actual, finishReplacedReset: watched("wipe", actual.finishReplacedReset) };
});
vi.mock("./recovery-environment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./recovery-environment.js")>();
  return {
    ...actual,
    resumeEnvironmentRecovery: watched("move-resume", actual.resumeEnvironmentRecovery),
  };
});
vi.mock("./first-setup-entry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./first-setup-entry.js")>();
  return { ...actual, resolveFirstSetupEntry: watched("admission", actual.resolveFirstSetupEntry) };
});
vi.mock("./recovery-listener.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./recovery-listener.js")>();
  return {
    ...actual,
    needsConnectionBootstrap: watched("connection-repair", actual.needsConnectionBootstrap),
  };
});

const roots: string[] = [];
afterEach(async () => {
  seen.steps = [];
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Box {
  stateDir: string;
  venueDir: string;
  backupsDir: string;
  logDir: string;
}

/** A replaced box's folders: a venue database, a spare file and a backup, beside its logs. */
async function replacedBox(): Promise<Box> {
  const root = realpathSync(await mkdtemp(join(tmpdir(), "wt-entry-replaced-")));
  roots.push(root);
  const box = {
    stateDir: join(root, "state"),
    venueDir: join(root, "state", "venue"),
    backupsDir: join(root, "backups"),
    logDir: join(root, "logs"),
  };
  for (const dir of Object.values(box)) await mkdir(dir, { recursive: true });
  await writeFile(join(box.venueDir, "venue.db"), "venue rows");
  await writeFile(join(box.stateDir, "trading.env"), "WAITRON_ENV=production\n");
  await writeFile(join(box.stateDir, SPARE_SPACE_FILE), Buffer.alloc(4096, 1));
  await writeFile(join(box.backupsDir, "one.backup.enc"), "archive");
  return box;
}

/** A start whose state is kept in memory, so repeated starts see each other's counts. */
function entry(box: Box, env: NodeJS.ProcessEnv, kept: { state: RecoveryState }) {
  return {
    args: [] as readonly string[],
    baseEnv: env,
    stateDir: box.stateDir,
    venueDir: box.venueDir,
    logDir: box.logDir,
    assertNotAhead: vi.fn(() => Promise.resolve()),
    clearReplacedDatabases: vi.fn(() => Promise.resolve()),
    loadBoxEnv: vi.fn((base: NodeJS.ProcessEnv) => Promise.resolve({ ...base })),
    readRecoveryState: vi.fn(() => Promise.resolve(kept.state)),
    writeRecoveryState: vi.fn((_dir: string, state: RecoveryState) => {
      seen.steps.push("counter");
      kept.state = state;
      return Promise.resolve();
    }),
    withRecoveryLock: <T>(_dir: string, body: () => Promise<T>) => body(),
    startServer: vi.fn(() => Promise.resolve({ close: () => Promise.resolve() })),
    serveStartClockWaiting: () => Promise.reject(new Error("no restore waits here")),
    serveRecovery: vi.fn(() => {
      seen.steps.push("page");
      return Promise.resolve();
    }),
    installShutdownHandlers: vi.fn(),
    scheduleStayedUp: vi.fn(),
    log: vi.fn(),
    exit: vi.fn(),
    // Under the spare's size, so the start releases it.
    statfs: () => Promise.resolve({ bavail: 10, frsize: 1 }),
    freeSpaceFloor: 1,
    spareBytes: 4096,
  };
}

describe("a start holding a replaced box's reset marker", () => {
  it("returns to Setup with the same box certificate and a pending Cloud key rotation", async () => {
    const box = await replacedBox();
    const tunnelDir = join(box.stateDir, "..", "tunnel");
    const migrationsRoot = join(box.stateDir, "..", "migrations");
    await copyMigrationsRoot(migrationsRoot);
    await mkdir(tunnelDir);
    await writeFile(join(tunnelDir, "public-key"), "old public key");
    const tls = await ensureBoxSecrets({
      stateDir: box.stateDir,
      hostnames: leafHostnamesFor("11111111-1111-4111-8111-111111111111"),
      listIpv4: () => [],
      now: () => new Date(),
    });
    const originalCa = await readFile(tls.caCertFile);
    const originalLeaf = await readFile(tls.certFile);
    await writeReplacedResetMarker(box.stateDir, { phase: "wiping", setAside: false });
    const deps = entry(
      box,
      {
        WAITRON_ENV: "preproduction",
        WAITRON_HTTP_HOST: "127.0.0.1",
        WAITRON_HTTP_PORT: "3000",
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_STATE_DIR: box.stateDir,
        WAITRON_VENUE_DIR: box.venueDir,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_TUNNEL_CONTROL_DIR: tunnelDir,
      },
      { state: FRESH },
    );
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    const transport = httpsVia(originalCa);
    try {
      await runEntry({
        ...deps,
        startServer: async (env, base) => (server = await startServer(env, base)),
      });
      expect(deps.serveRecovery).not.toHaveBeenCalled();
      const response = await fetch(
        `https://127.0.0.1:${httpPort()}/setup-api/status`,
        transport.via,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        provisioned: false,
        environment: "preproduction",
      });
      expect(await readFile(tls.caCertFile)).toEqual(originalCa);
      expect(await readFile(tls.certFile)).toEqual(originalLeaf);
      expect(readdirSync(tunnelDir)).toEqual(["rotate-key"]);
    } finally {
      await transport.close();
      await server?.close();
    }
  });

  it("wipes after the space steps and before admission, connection repair, the page and the counter", async () => {
    const box = await replacedBox();
    await writeReplacedResetMarker(box.stateDir, { phase: "wiping", setAside: false });

    await runEntry(entry(box, { WAITRON_LOCAL_BACKUPS_DIR: box.backupsDir }, { state: FRESH }));

    const at = (step: string) => seen.steps.indexOf(step);
    expect(seen.steps.slice(0, 4)).toEqual(["free-space", "old-backups", "spare-release", "wipe"]);
    expect(seen.steps).toContain("admission");
    for (const later of ["admission", "connection-repair", "page", "counter"])
      if (seen.steps.includes(later)) expect(at(later)).toBeGreaterThan(at("wipe"));
    expect(existsSync(join(box.venueDir, "venue.db"))).toBe(false);
    expect(existsSync(join(box.stateDir, REPLACED_RESET_FILE))).toBe(false);
    expect(readdirSync(box.backupsDir)).toEqual([]);
  });

  it.each([
    ["wiping", false],
    ["set_aside_refused", true],
  ] as const)("a marker reading %s resumes the environment Move: %s", async (phase, resumes) => {
    const box = await replacedBox();
    await writeReplacedResetMarker(box.stateDir, { phase, setAside: true });

    await runEntry(entry(box, { WAITRON_LOCAL_BACKUPS_DIR: box.backupsDir }, { state: FRESH }));

    expect(seen.steps.includes("move-resume")).toBe(resumes);
  });

  it("…and a start without the marker resumes it as before", async () => {
    const box = await replacedBox();
    await runEntry(entry(box, {}, { state: FRESH }));
    expect(seen.steps[0]).toBe("move-resume");
    expect(seen.steps).not.toContain("wipe");
  });

  it("empties no backups folder when none is named", async () => {
    const box = await replacedBox();
    await writeReplacedResetMarker(box.stateDir, { phase: "wiping", setAside: false });

    await runEntry(entry(box, { WAITRON_LOCAL_BACKUPS_DIR: "" }, { state: FRESH }));

    expect(existsSync(join(box.stateDir, REPLACED_RESET_FILE))).toBe(false);
    expect(await readFile(join(box.backupsDir, "one.backup.enc"), "utf8")).toBe("archive");
  });

  it("a wipe that keeps failing throws before the counter at every start, and never reaches Restore", async () => {
    const box = await replacedBox();
    await writeReplacedResetMarker(box.stateDir, { phase: "wiping", setAside: false });
    // A file where the backups folder should be: emptying it fails at every start.
    const notAFolder = join(box.backupsDir, "one.backup.enc");
    const kept = { state: FRESH };

    for (let start = 0; start < 6; start += 1) {
      seen.steps = [];
      const d = entry(box, { WAITRON_LOCAL_BACKUPS_DIR: notAFolder }, kept);
      await expect(runEntry(d)).rejects.toMatchObject({ code: "ENOTDIR" });
      expect(seen.steps.at(-1)).toBe("wipe");
      expect(d.serveRecovery).not.toHaveBeenCalled();
      expect(d.startServer).not.toHaveBeenCalled();
      expect(d.log).toHaveBeenCalledWith("error", "replaced-reset.wipe_failed", {
        errorCode: "unknown",
        errno: "ENOTDIR",
      });
    }
    expect(kept.state).toEqual(FRESH);
    expect(existsSync(join(box.stateDir, REPLACED_RESET_FILE))).toBe(true);
  });
});
