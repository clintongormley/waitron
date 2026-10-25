import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
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
