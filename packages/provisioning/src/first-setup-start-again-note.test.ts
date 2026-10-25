import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import type { DurableJsonIo } from "./durable-host-json.js";
import {
  START_AGAIN_NOTE_FILE,
  raiseStartAgainNote,
  readStartAgainNote,
  startAgainFloorSources,
} from "./first-setup-start-again-note.js";
import {
  START_AGAIN_MARKER_FILE,
  assertNoStartAgainDeletion,
  deleteMarkedAttempt,
  finishStartAgainDeletion,
  markerSize,
  readStartAgainMarker,
  startAgainMarkerFor,
  writeStartAgainMarker,
} from "./first-setup-start-again-deletion.js";

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

const incomplete = { code: "setup.start_again_incomplete", params: {} };
const RECORD = randomUUID();
const ATTEMPT = { attemptId: randomUUID(), frozenDigest: "a".repeat(64) };
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

const VENUE_FILES: Record<string, string> = {
  "venue.db": "main database",
  "node.db": "node database",
  "venue.db-shm": "shared memory",
  "first-setup-claim.json": "{}",
};
const STATE_FILES: Record<string, string> = {
  "module-preparation-state.json": "{}",
  "first-fiscal-documents/a.json": "document",
  [`first-fiscal-documents/.first-setup-${randomUUID()}.tmp`]: "half-written",
  "first-setup-node-key.json": "key",
  "module-operation-public.json": "public",
  [`first-setup-resolutions/${RECORD}/000001.json`]: "record",
  [`first-setup-resolutions/${RECORD}/manifest.json`]: "manifest",
  [`first-setup-resolutions/${RECORD}/.first-setup-${randomUUID()}.tmp`]: "half-written",
  [`first-setup-resolutions/${RECORD}/step-000003/original-1.json`]: "chunk",
  [`first-setup-resolutions/${RECORD}/step-000003/manifest.json`]: "step manifest",
  "first-setup.json": "state",
};
const KEPT_STATE: Record<string, string> = {
  "first-setup-start-again-confirmations/1-x.json": "confirmation",
  "tls/cert.pem": "certificate",
};
const LOCK = /^venue\.(lock|holder)/;

async function attemptFolders(
  venue: Record<string, string> = VENUE_FILES,
  state: Record<string, string> = STATE_FILES,
) {
  const base = await stateDir();
  const roots = { venueDir: join(base, "venue"), stateDir: join(base, "state") };
  const put = async (dir: string, files: Record<string, string>) => {
    for (const [name, text] of Object.entries(files)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), text);
    }
  };
  await mkdir(roots.venueDir, { recursive: true });
  await put(roots.venueDir, venue);
  await put(roots.stateDir, { ...state, ...KEPT_STATE });
  await raiseStartAgainNote(roots.stateDir, { floorMs: 200, lastName: "0CNQT", module: "m" });
  return roots;
}

async function tree(dir: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let names: string[];
  try {
    names = await fs.readdir(join(dir, prefix));
  } catch {
    return result;
  }
  for (const name of names.sort()) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    if (prefix === "" && LOCK.test(name)) continue;
    const info = await fs.lstat(join(dir, relative));
    if (info.isDirectory()) {
      result[`${relative}/`] = "";
      Object.assign(result, await tree(dir, relative));
    } else result[relative] = sha(await readFile(join(dir, relative)));
  }
  return result;
}
const snapshot = async (roots: { venueDir: string; stateDir: string }) => ({
  venue: await tree(roots.venueDir),
  state: await tree(roots.stateDir),
});

async function expectOnlyKept(roots: { venueDir: string; stateDir: string }) {
  expect(Object.keys(await tree(roots.venueDir))).toEqual([]);
  expect(await tree(roots.stateDir)).toEqual({
    [START_AGAIN_NOTE_FILE]: sha(await readFile(join(roots.stateDir, START_AGAIN_NOTE_FILE))),
    "first-setup-start-again-confirmations/": "",
    "first-setup-start-again-confirmations/1-x.json": sha("confirmation"),
    "tls/": "",
    "tls/cert.pem": sha("certificate"),
  });
  expect(await readStartAgainNote(roots.stateDir)).toEqual({
    version: 1,
    floorMs: 200,
    lastName: "0CNQT",
    module: "m",
  });
}

async function marked(roots: { venueDir: string; stateDir: string }) {
  const marker = await startAgainMarkerFor(roots, ATTEMPT);
  await writeStartAgainMarker(roots, marker);
  return marker;
}

function cutAt(cut: number | null, calls: string[] = []) {
  return async (path: string, kind: "file" | "folder") => {
    calls.push(path);
    if (calls.length === cut) throw new Error("power cut");
    await (kind === "file" ? fs.unlink(path) : fs.rmdir(path));
  };
}

async function removalCount() {
  const roots = await attemptFolders();
  const calls: string[] = [];
  await deleteMarkedAttempt(roots, await marked(roots), cutAt(null, calls));
  return calls.length;
}

it("no marker does nothing", async () => {
  const roots = await attemptFolders();
  const before = await snapshot(roots);
  await finishStartAgainDeletion(roots);
  expect(await snapshot(roots)).toEqual(before);
  await expect(assertNoStartAgainDeletion(roots.venueDir)).resolves.toBeUndefined();
  expect(await readStartAgainMarker(roots.venueDir)).toBeNull();
});

it("a marker names every listed file, records the side files' state, and reads back", async () => {
  const roots = await attemptFolders();
  await writeFile(join(roots.venueDir, "venue.db-wal"), "wal bytes");
  const marker = await marked(roots);
  expect(marker.venueDir).toBe(await fs.realpath(roots.venueDir));
  expect(marker.stateDir).toBe(await fs.realpath(roots.stateDir));
  expect(marker.files.map((entry) => `${entry.root}:${entry.name}`).sort()).toEqual(
    [
      ...["venue.db", "node.db", "first-setup-claim.json"].map((name) => `venue:${name}`),
      ...Object.keys(STATE_FILES).map((name) => `state:${name}`),
    ].sort(),
  );
  expect(marker.files.find((entry) => entry.name === "venue.db")).toEqual({
    root: "venue",
    name: "venue.db",
    size: "main database".length,
    sha256: sha("main database"),
  });
  expect(marker.wal).toEqual({
    "venue.db-wal": { size: "wal bytes".length, sha256: sha("wal bytes") },
    "node.db-wal": null,
  });
  expect(await readStartAgainMarker(roots.venueDir)).toEqual(marker);
  await expect(assertNoStartAgainDeletion(roots.venueDir)).rejects.toMatchObject(incomplete);
  await expect(writeStartAgainMarker(roots, marker)).rejects.toMatchObject(incomplete);
});

it.each([
  ["after the marker", 1],
  ["after the first deletion", 2],
  ["after the middle deletion", "middle"],
  ["after the last deletion", null],
] as const)("a marked deletion cut %s is finished", async (_name, cut) => {
  const count = await removalCount();
  const roots = await attemptFolders();
  const marker = await marked(roots);
  const at = cut === "middle" ? Math.ceil(count / 2) : cut;
  const deletion = deleteMarkedAttempt(roots, marker, cutAt(at));
  if (at === null) await deletion;
  else await expect(deletion).rejects.toMatchObject(incomplete);
  expect(await readStartAgainMarker(roots.venueDir)).toEqual(marker);
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
  expect(await readStartAgainMarker(roots.venueDir)).toBeNull();
});

it("an attempt that never chose a name is finished from the marker alone", async () => {
  const roots = await attemptFolders(
    { "first-setup-claim.json": "{}" },
    { "first-setup.json": "state" },
  );
  const marker = await marked(roots);
  expect(marker.files.map((entry) => entry.name).sort()).toEqual([
    "first-setup-claim.json",
    "first-setup.json",
  ]);
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
});

it("a record folder with a step-000003/ subfolder is finished, subfolder first", async () => {
  const roots = await attemptFolders();
  const marker = await marked(roots);
  const calls: string[] = [];
  await deleteMarkedAttempt(roots, marker, cutAt(null, calls));
  const state = await fs.realpath(roots.stateDir);
  const venue = await fs.realpath(roots.venueDir);
  const record = join(state, "first-setup-resolutions", RECORD);
  const at = (path: string) => calls.indexOf(path);
  expect(at(join(venue, "venue.db"))).toBe(0);
  expect(at(join(venue, "node.db"))).toBe(1);
  expect(at(join(venue, "venue.db-shm"))).toBe(2);
  expect(at(join(record, "step-000003", "manifest.json"))).toBeLessThan(
    at(join(record, "step-000003")),
  );
  expect(at(join(record, "step-000003"))).toBeLessThan(at(join(record, "000001.json")));
  expect(at(join(record, "000001.json"))).toBeLessThan(at(record));
  expect(at(record)).toBeLessThan(at(join(state, "first-setup-resolutions")));
  expect(calls.slice(-2)).toEqual([
    join(venue, "first-setup-claim.json"),
    join(state, "first-setup.json"),
  ]);
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
});

it("a leftover .first-setup-<uuid>.tmp in a listed folder is removed with it", async () => {
  const roots = await attemptFolders();
  const marker = await marked(roots);
  expect(marker.files.filter((entry) => entry.name.includes("/.first-setup-"))).toHaveLength(2);
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
});

it("a side file recreated by a read after its main file was deleted is removed", async () => {
  const roots = await attemptFolders();
  await writeFile(join(roots.venueDir, "venue.db-wal"), "recorded wal");
  const marker = await marked(roots);
  await expect(deleteMarkedAttempt(roots, marker, cutAt(4))).rejects.toMatchObject(incomplete);
  await expect(fs.lstat(join(roots.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await writeFile(join(roots.venueDir, "venue.db-wal"), "");
  await writeFile(join(roots.venueDir, "venue.db-shm"), "rewritten by a read");
  await writeFile(join(roots.venueDir, "node.db-shm"), "new");
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
});

it("a zero-length -wal is accepted", async () => {
  const roots = await attemptFolders();
  await marked(roots);
  await writeFile(join(roots.venueDir, "venue.db-wal"), "");
  await writeFile(join(roots.venueDir, "node.db-wal"), "");
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
});

it("folders given through a symbolic link are canonicalised before they are compared with the marker", async () => {
  const roots = await attemptFolders();
  await marked(roots);
  const elsewhere = await stateDir();
  await symlink(dirname(roots.venueDir), join(elsewhere, "link"));
  const linked = {
    venueDir: join(elsewhere, "link", "venue"),
    stateDir: join(elsewhere, "link", "state"),
  };
  await finishStartAgainDeletion(linked);
  await expectOnlyKept(roots);
});

async function walRow(roots: { venueDir: string }) {
  const path = join(roots.venueDir, "venue.db");
  await fs.unlink(path);
  const first = new DatabaseSync(path);
  first.exec("pragma journal_mode = wal; create table t(x); insert into t values (1);");
  first.close();
  return path;
}

it.each<[string, (roots: { venueDir: string; stateDir: string }) => Promise<void>]>([
  ["beside trading.env", (roots) => writeFile(join(roots.stateDir, "trading.env"), "X=1")],
  ["beside a streamed folder", (roots) => mkdir(join(roots.venueDir, ".venue.db-litestream"))],
  [
    "beside an A731 journal",
    (roots) => mkdir(join(roots.stateDir, "first-setup-resolutions", "backup-recovery")),
  ],
  [
    "beside a venue.db whose bytes differ from the marker",
    (roots) => writeFile(join(roots.venueDir, "venue.db"), "main databasf"),
  ],
  [
    "beside a -wal that is neither empty nor the recorded bytes",
    (roots) => writeFile(join(roots.venueDir, "venue.db-wal"), "x"),
  ],
  [
    "beside a file newly added inside first-fiscal-documents/",
    (roots) => writeFile(join(roots.stateDir, "first-fiscal-documents", "b.json"), "new"),
  ],
  [
    "with a marker naming other folders",
    async (roots) => {
      const marker = (await readStartAgainMarker(roots.venueDir))!;
      await writeFile(
        join(roots.venueDir, START_AGAIN_MARKER_FILE),
        JSON.stringify({ ...marker, stateDir: `${marker.stateDir}-other` }),
      );
    },
  ],
  [
    "beside a symbolic link in place of venue.db",
    async (roots) => {
      await fs.unlink(join(roots.venueDir, "venue.db"));
      await symlink(join(roots.stateDir, "first-setup.json"), join(roots.venueDir, "venue.db"));
    },
  ],
  [
    "beside a folder inside first-fiscal-documents/",
    (roots) => mkdir(join(roots.stateDir, "first-fiscal-documents", "inner")),
  ],
  [
    "beside a record subfolder not named step-NNNNNN",
    (roots) => mkdir(join(roots.stateDir, "first-setup-resolutions", RECORD, "other")),
  ],
  [
    "beside a symbolic link inside a record folder",
    (roots) =>
      symlink(
        join(roots.stateDir, "first-setup.json"),
        join(roots.stateDir, "first-setup-resolutions", RECORD, "link.json"),
      ),
  ],
  [
    "beside a file directly in first-setup-resolutions/",
    (roots) => writeFile(join(roots.stateDir, "first-setup-resolutions", "loose.json"), "x"),
  ],
  [
    "beside first-fiscal-documents as a file",
    async (roots) => {
      await rm(join(roots.stateDir, "first-fiscal-documents"), { recursive: true });
      await writeFile(join(roots.stateDir, "first-fiscal-documents"), "x");
    },
  ],
])("a pending deletion %s is refused, and nothing is deleted", async (_name, change) => {
  const roots = await attemptFolders();
  await marked(roots);
  await change(roots);
  const before = await snapshot(roots);
  await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject(incomplete);
  expect(await snapshot(roots)).toEqual(before);
  expect(before.venue[START_AGAIN_MARKER_FILE]).toBeDefined();
});

it("a row written into venue.db-wal after the cut is refused, and nothing is deleted", async () => {
  const roots = await attemptFolders();
  const path = await walRow(roots);
  const main = await readFile(path);
  await marked(roots);
  const writer = new DatabaseSync(path);
  writer.exec("pragma wal_autocheckpoint = 0; insert into t values (2);");
  const wal = await readFile(`${path}-wal`);
  writer.close();
  await writeFile(path, main);
  await writeFile(`${path}-wal`, wal);
  expect(wal.length).toBeGreaterThan(0);
  const before = await snapshot(roots);
  expect(before.venue["venue.db"]).toBe(sha(main));
  await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject(incomplete);
  expect(await snapshot(roots)).toEqual(before);
  const reader = new DatabaseSync(path, { readOnly: true });
  expect(reader.prepare("select count(*) as n from t").get()).toEqual({ n: 2 });
  reader.close();
});

it("a file newly added inside first-fiscal-documents/ stops the folder's rmdir and is kept", async () => {
  const roots = await attemptFolders();
  const marker = await marked(roots);
  const added = join(roots.stateDir, "first-fiscal-documents", "b.json");
  await writeFile(added, "new");
  await expect(deleteMarkedAttempt(roots, marker)).rejects.toMatchObject(incomplete);
  expect(await readFile(added, "utf8")).toBe("new");
  expect(await readStartAgainMarker(roots.venueDir)).toEqual(marker);
});

it("a marker over 1 MiB is refused setup.not_ready before anything is written", async () => {
  const roots = await attemptFolders();
  const marker = await startAgainMarkerFor(roots, ATTEMPT);
  const files = Array.from({ length: 6000 }, (_, index) => ({
    root: "state" as const,
    name: `first-fiscal-documents/${String(index).padStart(100, "0")}.json`,
    size: 1,
    sha256: "b".repeat(64),
  }));
  const large = { ...marker, files: [...marker.files, ...files] };
  expect(markerSize(large)).toBeGreaterThan(1024 * 1024);
  const before = await snapshot(roots);
  await expect(writeStartAgainMarker(roots, large)).rejects.toMatchObject({
    code: "setup.not_ready",
    params: {},
  });
  expect(await snapshot(roots)).toEqual(before);
});

it.each([
  ["state", START_AGAIN_NOTE_FILE],
  ["state", "first-setup-start-again-confirmations/1-x.json"],
  ["state", "tls/cert.pem"],
  ["state", "../venue/venue.db"],
  ["venue", "venue.lock"],
] as const)(
  "a marker that names %s:%s is refused by the writer and by the finisher, and nothing is deleted",
  async (root, name) => {
    const roots = await attemptFolders();
    const marker = await startAgainMarkerFor(roots, ATTEMPT);
    const damaged = {
      ...marker,
      files: [...marker.files, { root, name, size: 1, sha256: "c".repeat(64) }],
    };
    const before = await snapshot(roots);
    await expect(writeStartAgainMarker(roots, damaged)).rejects.toMatchObject(incomplete);
    expect(await snapshot(roots)).toEqual(before);
    await writeFile(join(roots.venueDir, START_AGAIN_MARKER_FILE), JSON.stringify(damaged));
    const written = await snapshot(roots);
    await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject(incomplete);
    await expect(deleteMarkedAttempt(roots, damaged)).rejects.toMatchObject(incomplete);
    expect(await snapshot(roots)).toEqual(written);
  },
);

it("a damaged marker file is refused, not read as absent", async () => {
  const roots = await attemptFolders();
  await writeFile(join(roots.venueDir, START_AGAIN_MARKER_FILE), "{");
  await expect(readStartAgainMarker(roots.venueDir)).rejects.toMatchObject(incomplete);
  await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject(incomplete);
  await expect(assertNoStartAgainDeletion(roots.venueDir)).rejects.toMatchObject(incomplete);
});

it("a pending deletion beside a folder it cannot read is refused, and nothing is deleted", async () => {
  const roots = await attemptFolders();
  await marked(roots);
  const documents = join(roots.stateDir, "first-fiscal-documents");
  await fs.chmod(documents, 0o000);
  try {
    await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject({
      ...incomplete,
      reason: `check failed: EACCES ${join(await fs.realpath(roots.stateDir), "first-fiscal-documents")}`,
    });
  } finally {
    await fs.chmod(documents, 0o700);
  }
  expect(await readStartAgainMarker(roots.venueDir)).not.toBeNull();
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("main database");
});

it("the writer and the deleter refuse folders other than the marker's", async () => {
  const roots = await attemptFolders();
  const other = await attemptFolders();
  const marker = await startAgainMarkerFor(roots, ATTEMPT);
  const before = await snapshot(other);
  await expect(writeStartAgainMarker(other, marker)).rejects.toMatchObject(incomplete);
  await expect(deleteMarkedAttempt(other, marker)).rejects.toMatchObject(incomplete);
  expect(await snapshot(other)).toEqual(before);
});

it("a recorded node.db-wal is finished when its bytes are unchanged", async () => {
  const roots = await attemptFolders();
  await writeFile(join(roots.venueDir, "node.db-wal"), "node wal");
  const marker = await marked(roots);
  expect(marker.wal["node.db-wal"]).toEqual({ size: 8, sha256: sha("node wal") });
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
});

it("an unreadable marker path is refused by the pending-deletion check", async () => {
  const base = await stateDir();
  await writeFile(join(base, "file"), "x");
  await expect(assertNoStartAgainDeletion(join(base, "file"))).rejects.toMatchObject(incomplete);
});

const markerJson = {
  version: 1,
  attemptId: ATTEMPT.attemptId,
  frozenDigest: ATTEMPT.frozenDigest,
  venueDir: "/v",
  stateDir: "/s",
  files: [{ root: "venue", name: "venue.db", size: 1, sha256: "d".repeat(64) }],
  wal: { "venue.db-wal": null, "node.db-wal": null },
};
const file0 = markerJson.files[0]!;
it.each<[string, unknown]>([
  ["an array", []],
  ["a missing key", { ...markerJson, wal: undefined }],
  ["an extra key", { ...markerJson, extra: 1 }],
  ["a wrong version", { ...markerJson, version: 2 }],
  ["an attempt id that is not a UUID", { ...markerJson, attemptId: "x" }],
  ["a digest that is not a hash", { ...markerJson, frozenDigest: "x" }],
  ["a relative venue folder", { ...markerJson, venueDir: "v" }],
  ["a relative state folder", { ...markerJson, stateDir: "s" }],
  ["files that are not a list", { ...markerJson, files: {} }],
  ["side files that are not an object", { ...markerJson, wal: [] }],
  ["side files with an extra name", { ...markerJson, wal: { ...markerJson.wal, x: null } }],
  ["a file entry that is not an object", { ...markerJson, files: [1] }],
  ["a file entry with an extra key", { ...markerJson, files: [{ ...file0, x: 1 }] }],
  ["a file entry with an unknown root", { ...markerJson, files: [{ ...file0, root: "tls" }] }],
  ["a file entry with a numeric name", { ...markerJson, files: [{ ...file0, name: 1 }] }],
  ["a file listed twice", { ...markerJson, files: [file0, file0] }],
  ["a negative size", { ...markerJson, files: [{ ...file0, size: -1 }] }],
  ["a fractional size", { ...markerJson, files: [{ ...file0, size: 1.5 }] }],
  ["a short hash", { ...markerJson, files: [{ ...file0, sha256: "d" }] }],
  ["a numeric hash", { ...markerJson, files: [{ ...file0, sha256: 1 }] }],
  [
    "a side file fingerprint with an extra key",
    {
      ...markerJson,
      wal: { ...markerJson.wal, "node.db-wal": { size: 1, sha256: "d".repeat(64), x: 1 } },
    },
  ],
  [
    "a side file fingerprint that is text",
    { ...markerJson, wal: { ...markerJson.wal, "venue.db-wal": "x" } },
  ],
  [
    "a record file outside a UUID folder",
    {
      ...markerJson,
      files: [{ ...file0, root: "state", name: "first-setup-resolutions/backup-recovery/x.json" }],
    },
  ],
  [
    "a record file two folders down",
    {
      ...markerJson,
      files: [
        { ...file0, root: "state", name: `first-setup-resolutions/${RECORD}/step-000003/x/y.json` },
      ],
    },
  ],
  [
    "a document in a subfolder",
    {
      ...markerJson,
      files: [{ ...file0, root: "state", name: "first-fiscal-documents/x/y.json" }],
    },
  ],
  [
    "an empty path segment",
    { ...markerJson, files: [{ ...file0, root: "state", name: "first-fiscal-documents//y.json" }] },
  ],
  ["a venue name not on the list", { ...markerJson, files: [{ ...file0, name: "venue.db-shm" }] }],
])("a marker with %s is refused as damaged", async (_name, value) => {
  const base = await stateDir();
  await writeFile(join(base, START_AGAIN_MARKER_FILE), JSON.stringify(value));
  await expect(readStartAgainMarker(base)).rejects.toMatchObject(incomplete);
});

it.each([
  ["placed", true],
  ["not placed", false],
])(
  "an attempt whose marker names no venue.db: a venue.db %s after the marker",
  async (_name, placed) => {
    const roots = await attemptFolders(
      { "first-setup-claim.json": "{}" },
      { "first-setup.json": "state" },
    );
    const marker = await marked(roots);
    expect(marker.files.some((entry) => entry.name === "venue.db")).toBe(false);
    if (!placed) {
      await finishStartAgainDeletion(roots);
      await expectOnlyKept(roots);
      return;
    }
    await writeFile(join(roots.venueDir, "venue.db"), "a restored database");
    const before = await snapshot(roots);
    await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject({
      ...incomplete,
      reason: "unlisted file: venue/venue.db",
    });
    expect(await snapshot(roots)).toEqual(before);
  },
);

it("a refusal names the check that failed, in its log-only reason", async () => {
  const roots = await attemptFolders();
  await marked(roots);
  await writeFile(join(roots.venueDir, "venue.db-wal"), "x");
  await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject({
    ...incomplete,
    reason: "unexpected -wal: venue/venue.db-wal",
  });
  await fs.unlink(join(roots.venueDir, "venue.db-wal"));
  await writeFile(join(roots.venueDir, "venue.db"), "main databasf");
  const error: unknown = await finishStartAgainDeletion(roots).catch((caught: unknown) => caught);
  expect(error).toMatchObject({ ...incomplete, reason: "size or hash differs: venue/venue.db" });
  expect(JSON.stringify(error)).not.toContain("reason");
});

it("a deletion that throws names the error's code and path in its reason", async () => {
  const roots = await attemptFolders();
  const marker = await marked(roots);
  const venue = await fs.realpath(roots.venueDir);
  const refuse = async () => {
    throw Object.assign(new Error("refused"), { code: "EACCES" });
  };
  await expect(deleteMarkedAttempt(roots, marker, refuse)).rejects.toMatchObject({
    ...incomplete,
    reason: `deletion failed: EACCES ${join(venue, "venue.db")}`,
  });
});

it("a deletion that meets an unexpected layout names it, and deletes nothing", async () => {
  const roots = await attemptFolders();
  const marker = await marked(roots);
  const link = join(roots.stateDir, "first-fiscal-documents", "link.json");
  await symlink(join(roots.stateDir, "first-setup.json"), link);
  const before = await snapshot(roots);
  await expect(deleteMarkedAttempt(roots, marker)).rejects.toMatchObject({
    ...incomplete,
    reason: `layout unexpected: ${join(await fs.realpath(roots.stateDir), "first-fiscal-documents", "link.json")}`,
  });
  expect(await snapshot(roots)).toEqual(before);
});
