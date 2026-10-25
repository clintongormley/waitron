import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import type { DurableJsonIo } from "./durable-host-json.js";
import {
  START_AGAIN_NOTE_FILE,
  raiseStartAgainNote,
  readStartAgainNote,
  startAgainFloorSources,
} from "./first-setup-start-again-note.js";

const dirs: string[] = [];
async function stateDir() {
  const dir = await mkdtemp(join(tmpdir(), "start-again-note-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const refused = { code: "setup.attempt_invalid", params: {} };

it("a missing note is no floor", async () => {
  const dir = await stateDir();
  expect(await readStartAgainNote(dir)).toBeNull();
  expect(startAgainFloorSources(null)).toEqual([]);
});

it("a missing state folder is no floor", async () => {
  const dir = await stateDir();
  expect(await readStartAgainNote(join(dir, "absent"))).toBeNull();
});

it("a note round-trips exactly", async () => {
  const dir = await stateDir();
  const written = await raiseStartAgainNote(dir, {
    floorMs: 1792154580000,
    lastName: "0CNQT",
    module: "fiscal-verifactu",
  });
  const note = {
    version: 1 as const,
    floorMs: 1792154580000,
    lastName: "0CNQT",
    module: "fiscal-verifactu",
  };
  expect(written).toEqual(note);
  expect(await readStartAgainNote(dir)).toEqual(note);
  expect(JSON.parse(await readFile(join(dir, START_AGAIN_NOTE_FILE), "utf8"))).toEqual(note);
  expect(startAgainFloorSources(note)).toEqual([
    { reference: "start-again-note", complete: true, records: [], timeFloorMs: 1792154580000 },
  ]);
});

it("raising never lowers the floor", async () => {
  const dir = await stateDir();
  await raiseStartAgainNote(dir, { floorMs: 200, lastName: "first", module: "m" });
  const kept = await raiseStartAgainNote(dir, { floorMs: 100, lastName: "second", module: "n" });
  const first = { version: 1, floorMs: 200, lastName: "first", module: "m" };
  expect(kept).toEqual(first);
  expect(await readStartAgainNote(dir)).toEqual(first);
  await raiseStartAgainNote(dir, { floorMs: 200, lastName: "equal", module: "n" });
  expect(await readStartAgainNote(dir)).toEqual(first);
  const raised = await raiseStartAgainNote(dir, { floorMs: 300, lastName: "third", module: "n" });
  expect(raised).toEqual({ version: 1, floorMs: 300, lastName: "third", module: "n" });
  expect(await readStartAgainNote(dir)).toEqual(raised);
});

it.each([
  ["empty", ""],
  ["partial", '{"version":1,'],
  ["an array", "[]"],
  ["a wrong version", '{"version":2,"floorMs":1,"lastName":"a","module":"m"}'],
  ["a missing key", '{"version":1,"floorMs":1,"lastName":"a"}'],
  ["an extra key", '{"version":1,"floorMs":1,"lastName":"a","module":"m","x":1}'],
  ["a text floor", '{"version":1,"floorMs":"1","lastName":"a","module":"m"}'],
  ["a numeric name", '{"version":1,"floorMs":1,"lastName":1,"module":"m"}'],
  ["a numeric module", '{"version":1,"floorMs":1,"lastName":"a","module":1}'],
  ["an empty object", "{}"],
  ["an empty name", '{"version":1,"floorMs":1,"lastName":"","module":"m"}'],
  [
    "a name over 64 characters",
    JSON.stringify({ version: 1, floorMs: 1, lastName: "a".repeat(65), module: "m" }),
  ],
  ["a fractional floor", '{"version":1,"floorMs":1.5,"lastName":"a","module":"m"}'],
  ["an empty module", '{"version":1,"floorMs":1,"lastName":"a","module":""}'],
  [
    "a module that is not a module id",
    '{"version":1,"floorMs":1,"lastName":"a","module":"Fiscal/x"}',
  ],
  [
    "oversized",
    JSON.stringify({ version: 1, floorMs: 1, lastName: "a".repeat(5000), module: "m" }),
  ],
])("an unreadable note is refused, not read as absent: %s", async (_name, text) => {
  const dir = await stateDir();
  await writeFile(join(dir, START_AGAIN_NOTE_FILE), text);
  await expect(readStartAgainNote(dir)).rejects.toMatchObject(refused);
  await expect(
    raiseStartAgainNote(dir, { floorMs: 1, lastName: "a", module: "m" }),
  ).rejects.toMatchObject(refused);
  expect(await readFile(join(dir, START_AGAIN_NOTE_FILE), "utf8")).toBe(text);
});

it("a note that is a folder is refused, not read as absent", async () => {
  const dir = await stateDir();
  await mkdir(join(dir, START_AGAIN_NOTE_FILE));
  await expect(readStartAgainNote(dir)).rejects.toMatchObject(refused);
});

it("a raise to a floor that is not a whole number is refused and writes nothing", async () => {
  const dir = await stateDir();
  await expect(
    raiseStartAgainNote(dir, { floorMs: 1.5, lastName: "a", module: "m" }),
  ).rejects.toMatchObject(refused);
  expect(await readStartAgainNote(dir)).toBeNull();
});

it("a symbolic link in place of the note is refused, not followed", async () => {
  const dir = await stateDir();
  const target = join(dir, "elsewhere.json");
  await writeFile(target, JSON.stringify({ version: 1, floorMs: 1, lastName: "a", module: "m" }));
  await symlink(target, join(dir, START_AGAIN_NOTE_FILE));
  await expect(readStartAgainNote(dir)).rejects.toMatchObject(refused);
  await expect(
    raiseStartAgainNote(dir, { floorMs: 2, lastName: "b", module: "m" }),
  ).rejects.toMatchObject(refused);
});

it.each([
  ["an empty name", { floorMs: 2, lastName: "", module: "m" }],
  ["an empty module", { floorMs: 2, lastName: "a", module: "" }],
])("a raise with %s is refused and leaves the note as it was", async (_name, next) => {
  const dir = await stateDir();
  await raiseStartAgainNote(dir, { floorMs: 1, lastName: "a", module: "m" });
  await expect(raiseStartAgainNote(dir, next)).rejects.toMatchObject(refused);
  expect(await readStartAgainNote(dir)).toEqual({
    version: 1,
    floorMs: 1,
    lastName: "a",
    module: "m",
  });
});

it("an equal floor writes nothing", async () => {
  const dir = await stateDir();
  const path = join(dir, START_AGAIN_NOTE_FILE);
  await raiseStartAgainNote(dir, { floorMs: 200, lastName: "first", module: "m" });
  const before = { bytes: await readFile(path), info: await stat(path) };
  await raiseStartAgainNote(dir, { floorMs: 200, lastName: "other", module: "n" });
  const after = await stat(path);
  expect(await readFile(path)).toEqual(before.bytes);
  expect(after.mtimeMs).toBe(before.info.mtimeMs);
  expect(after.ino).toBe(before.info.ino);
});

it("a later floor replaces the note whole", async () => {
  const dir = await stateDir();
  await raiseStartAgainNote(dir, { floorMs: 200, lastName: "first", module: "m" });
  await raiseStartAgainNote(dir, { floorMs: 300, lastName: "second", module: "n" });
  expect(JSON.parse(await readFile(join(dir, START_AGAIN_NOTE_FILE), "utf8"))).toEqual({
    version: 1,
    floorMs: 300,
    lastName: "second",
    module: "n",
  });
});

function cutIo(cut: "rename" | "after-rename"): DurableJsonIo {
  let renamed = false;
  return {
    mkdir: fs.mkdir,
    lstat: fs.lstat,
    chmod: fs.chmod,
    unlink: fs.unlink,
    async rename(from, to) {
      if (cut === "rename") throw new Error("power cut before rename");
      await fs.rename(from, to);
      renamed = true;
    },
    async open(path, flags, mode) {
      if (renamed) throw new Error("power cut after rename");
      return fs.open(path, flags, mode);
    },
  };
}

it("a write cut before its rename leaves the old note readable", async () => {
  const dir = await stateDir();
  await raiseStartAgainNote(dir, { floorMs: 200, lastName: "first", module: "m" });
  await expect(
    raiseStartAgainNote(dir, { floorMs: 300, lastName: "second", module: "m" }, cutIo("rename")),
  ).rejects.toMatchObject(refused);
  expect(await readStartAgainNote(dir)).toEqual({
    version: 1,
    floorMs: 200,
    lastName: "first",
    module: "m",
  });
  expect((await fs.readdir(dir)).sort()).toEqual([START_AGAIN_NOTE_FILE]);
});

it("a write cut after its rename leaves the new one", async () => {
  const dir = await stateDir();
  await raiseStartAgainNote(dir, { floorMs: 200, lastName: "first", module: "m" });
  await expect(
    raiseStartAgainNote(
      dir,
      { floorMs: 300, lastName: "second", module: "m" },
      cutIo("after-rename"),
    ),
  ).rejects.toMatchObject(refused);
  expect(await readStartAgainNote(dir)).toEqual({
    version: 1,
    floorMs: 300,
    lastName: "second",
    module: "m",
  });
  expect((await fs.readdir(dir)).sort()).toEqual([START_AGAIN_NOTE_FILE]);
});

it("the module offers no way to delete the note", async () => {
  const exported = Object.keys(await import("./first-setup-start-again-note.js")).sort();
  expect(exported).toEqual([
    "START_AGAIN_NOTE_FILE",
    "raiseStartAgainNote",
    "readStartAgainNote",
    "startAgainFloorSources",
  ]);
});
