import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { lockVenueDatabase } from "@waitron/db";
import { STATE_LAYOUT } from "@waitron/store";
import { FIRST_SETUP_HOST_FILES } from "./first-setup-state.js";
import {
  beginEnvironmentMove,
  resumeEnvironmentMove,
  finishEnvironmentMove,
} from "./environment-recovery-move.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const stateDir = await fs.mkdtemp(join(tmpdir(), "environment-move-"));
  dirs.push(stateDir);
  const venueDir = join(stateDir, "venue");
  await fs.mkdir(venueDir);
  return { stateDir: await fs.realpath(stateDir), venueDir: await fs.realpath(venueDir) };
}
async function put(path: string, bytes = path) {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, bytes);
}

it("sets aside registered venue state, keeps unrelated files and preserves first-setup claims", async () => {
  const roots = await fixture();
  const keep = [
    "spare-space",
    "spare-space.released",
    "recovery.lock",
    "setup-operation.lock",
    "first-setup-start-again-guesses.json",
    "recovery.json",
    "logs",
    "tls",
    "records",
    "venue",
    "environment-recovery-move.json",
  ];
  const stateNames = [
    ...new Set([...STATE_LAYOUT.map((entry) => entry.name), ...FIRST_SETUP_HOST_FILES]),
  ].filter((name) => !keep.includes(name) && name !== "backup-room-note.json");
  for (const name of stateNames) await put(join(roots.stateDir, name, "retained"));
  const venueNames = [
    "venue.db-wal",
    "venue.db-shm",
    "venue.db-journal",
    "venue.db",
    "node.db-wal",
    "node.db-shm",
    "node.db-journal",
    "node.db",
    ".venue.db-litestream",
    "first-setup-claim.json",
    "first-setup-workspaces",
    "first-setup-selection.json",
    "first-setup-retirement.json",
    "first-setup-workspace.json",
  ];
  for (const name of venueNames) await put(join(roots.venueDir, name), `old ${name}`);
  for (const name of [
    "tls/server.key",
    "logs/waitron.log",
    "records/previous",
    "unknown.txt",
    "spare-space",
  ])
    await put(join(roots.stateDir, name));
  await put(join(roots.stateDir, "backup-room-note.json"));
  const hold = await lockVenueDatabase(roots.venueDir);
  hold.release();
  const lockBytes = await fs.readFile(join(roots.venueDir, "venue.lock"));
  const result = await beginEnvironmentMove(roots);
  for (const name of stateNames) {
    expect(await fs.readFile(join(result.folders.state, name, "retained"), "utf8")).toBe(
      join(roots.stateDir, name, "retained"),
    );
    await expect(fs.lstat(join(roots.stateDir, name))).rejects.toMatchObject({ code: "ENOENT" });
  }
  for (const name of venueNames)
    expect(await fs.readFile(join(result.folders.venue, name), "utf8")).toBe(`old ${name}`);
  for (const name of [
    "tls/server.key",
    "logs/waitron.log",
    "records/previous",
    "unknown.txt",
    "spare-space",
  ])
    expect(await fs.readFile(join(roots.stateDir, name), "utf8")).toBe(join(roots.stateDir, name));
  expect(await fs.readFile(join(roots.venueDir, "venue.lock"))).toEqual(lockBytes);
  await expect(fs.lstat(join(roots.stateDir, "backup-room-note.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect((await resumeEnvironmentMove(roots))?.folders).toEqual(result.folders);
  await finishEnvironmentMove(roots.stateDir);
  expect(await resumeEnvironmentMove(roots)).toBeNull();
});

it("moves joined TLS authority with its saved backup destination", async () => {
  const roots = await fixture();
  await put(join(roots.stateDir, "tls/joined.json"), "joined");
  await put(join(roots.stateDir, "tls/server.key"), "old authority");
  await put(join(roots.stateDir, "backup.env"), "old bucket");
  const result = await beginEnvironmentMove(roots);
  expect(await fs.readFile(join(result.folders.state, "tls/server.key"), "utf8")).toBe(
    "old authority",
  );
  expect(await fs.readFile(join(result.folders.state, "backup.env"), "utf8")).toBe("old bucket");
  await expect(fs.lstat(join(roots.stateDir, "tls"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("resumes a cut Move and refuses to overwrite a destination", async () => {
  const roots = await fixture();
  await put(join(roots.venueDir, "venue.db"), "database");
  await put(join(roots.stateDir, "secrets.env"), "ring");
  let moved = 0;
  await expect(
    beginEnvironmentMove(roots, {
      ...fs,
      rename: async (from, to) => {
        if (!from.includes(".first-setup-set-aside-probe-") && ++moved === 2)
          throw new Error("power cut");
        await fs.rename(from, to);
      },
    }),
  ).rejects.toMatchObject({ code: "setup.environment_move_unfinished" });
  const result = await resumeEnvironmentMove(roots);
  expect(await fs.readFile(join(result!.folders.state, "secrets.env"), "utf8")).toBe("ring");
  expect(await fs.readFile(join(result!.folders.venue, "venue.db"), "utf8")).toBe("database");
  await put(join(roots.venueDir, "venue.db"), "new source");
  await expect(resumeEnvironmentMove(roots)).rejects.toMatchObject({
    code: "setup.environment_move_unfinished",
  });
  expect(await fs.readFile(join(result!.folders.venue, "venue.db"), "utf8")).toBe("database");
});

it("reports both locations when the roots use separate filesystems", async () => {
  const roots = await fixture();
  await put(join(roots.venueDir, "venue.db"), "database");
  await put(join(roots.stateDir, "secrets.env"), "ring");
  const result = await beginEnvironmentMove(roots, {
    ...fs,
    lstat: (async (...args: Parameters<typeof fs.lstat>) => {
      const info = await fs.lstat(...args);
      if (args[0] === roots.venueDir)
        Object.defineProperty(info, "dev", { value: Number(info.dev) + 1 });
      return info;
    }) as typeof fs.lstat,
  });
  expect(result.setAside?.state).toMatch(/^records\/set-aside\/[^/]+\/state$/);
  expect(result.setAside?.venue).toMatch(/^first-setup-set-aside\/[^/]+$/);
  expect(await fs.readFile(join(result.folders.venue, "venue.db"), "utf8")).toBe("database");
});
