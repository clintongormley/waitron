import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { START_AGAIN_ADMIN, startAgainAttempt } from "../test/start-again-attempt.js";
import {
  readStartAgainChoices,
  startAgainChoiceStem,
  writeStartAgainChoice,
  type StartAgainChoiceRecord,
} from "./first-setup-start-again-choice.js";
import { finishStartAgainDeletion } from "./first-setup-start-again-deletion.js";
import { surveyStartAgainLeftovers } from "./first-setup-start-again-leftovers.js";
import { START_AGAIN_SET_ASIDE_DIR } from "./first-setup-start-again-names.js";
import { readStartAgainNote } from "./first-setup-start-again-note.js";
import {
  moveStartAgainUnits,
  prepareSetAside,
  resumeStartAgainSetAside,
  setAsideDestinations,
  setAsideFolderPaths,
  type SetAsideIo,
} from "./first-setup-start-again-set-aside.js";

const dirs: string[] = [];
async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "start-again-set-aside-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Roots = { venueDir: string; stateDir: string };
const RECORDS = "first-setup-resolutions";
const LOCKS = [
  "venue.lock",
  "venue.lock-journal",
  "venue.holder.json",
  "migrations.lock",
  "recovery.lock",
];
const PROBE = ".first-setup-set-aside-probe-";
const realIo: SetAsideIo = {
  lstat: fs.lstat,
  mkdir: fs.mkdir,
  rmdir: fs.rmdir,
  rename: fs.rename,
};

async function put(path: string, bytes: string | Buffer) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

const errno = (code: string) => Object.assign(new Error(code), { code });

/** Every path under the folder with its type and inode, sorted. */
async function snapshot(root: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (relative: string) => {
    const full = join(root, relative);
    const info = await lstat(full, { bigint: true });
    out.push(`${relative}:${info.isDirectory() ? "folder" : "file"}:${info.ino}`);
    if (info.isDirectory())
      for (const child of (await readdir(full)).sort())
        await visit(relative === "" ? child : `${relative}/${child}`);
  };
  await visit("");
  return out.sort();
}

/** Bytes, inode, size and modification time of every file and folder under each listed path. */
async function fingerprints(root: string, paths: readonly string[]) {
  const out: Record<string, unknown> = {};
  const visit = async (relative: string) => {
    const full = join(root, relative);
    const info = await lstat(full, { bigint: true });
    if (info.isDirectory()) {
      out[relative] = { ino: info.ino };
      for (const child of await readdir(full)) await visit(`${relative}/${child}`);
    } else
      out[relative] = {
        ino: info.ino,
        size: info.size,
        mtimeNs: info.mtimeNs,
        bytes: (await readFile(full)).toString("base64"),
      };
  };
  for (const path of paths) await visit(path);
  return out;
}

function choiceOf(survey: Awaited<ReturnType<typeof surveyStartAgainLeftovers>>) {
  if (survey === null || survey.kind !== "choice")
    throw new Error(`expected choice, got ${JSON.stringify(survey)}`);
  return survey;
}

/** Steps 1 and 2 as Task 5b will run them: destinations, prepare, the record; returns it read back. */
async function prepared(
  roots: Roots,
  administratorId: string,
  options: { io?: SetAsideIo; destinationsIo?: SetAsideIo; at?: string } = {},
): Promise<StartAgainChoiceRecord> {
  const survey = choiceOf(await surveyStartAgainLeftovers(roots));
  const at = options.at ?? new Date().toISOString();
  const stem = startAgainChoiceStem({ at, attemptId: survey.attemptId });
  const setAside = await setAsideDestinations(roots, stem, options.destinationsIo);
  await prepareSetAside(roots, survey.units, setAside, options.io);
  await writeStartAgainChoice(roots.stateDir, {
    at,
    attemptId: survey.attemptId,
    frozenDigest: survey.frozenDigest,
    markerSha256: survey.markerSha256,
    choice: "move",
    administrator: { administratorId, ...START_AGAIN_ADMIN },
    ownerGeneration: 0,
    listed: { digest: survey.digest, units: survey.units },
    setAside,
    noteFloorMs: survey.noteFloorMs,
  });
  const records = await readStartAgainChoices(roots.stateDir, survey);
  return records.at(-1)!;
}

const stemOf = (record: StartAgainChoiceRecord) => startAgainChoiceStem(record);

it("units move unchanged into a new folder: same bytes, same inode, same file times, relative paths kept", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  const found = `${RECORDS}/${randomUUID()}`;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await put(join(roots.stateDir, found, "step-000001", "step.json"), "{}");
  await put(join(roots.venueDir, ".venue.db-litestream", "generations", "a.wal"), "one");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  await writeFile(join(roots.venueDir, "venue.db-wal"), "found pages");
  await writeFile(join(roots.venueDir, "venue.db-shm"), "found index");
  const stateBefore = await fingerprints(roots.stateDir, ["trading.env", found]);
  const venueBefore = await fingerprints(roots.venueDir, [
    ".venue.db-litestream",
    "venue.db",
    "venue.db-wal",
    "venue.db-shm",
  ]);

  const record = await prepared(roots, attempt.administratorId);
  expect(record.setAside).toEqual({
    state: `${START_AGAIN_SET_ASIDE_DIR}/${stemOf(record)}/state`,
    venue: `${START_AGAIN_SET_ASIDE_DIR}/${stemOf(record)}/venue`,
  });
  await moveStartAgainUnits(roots, record);

  const stateAside = join(roots.stateDir, record.setAside!.state);
  const venueAside = join(roots.stateDir, record.setAside!.venue);
  expect(await fingerprints(stateAside, ["trading.env", found])).toEqual(stateBefore);
  expect(
    await fingerprints(venueAside, [
      ".venue.db-litestream",
      "venue.db",
      "venue.db-wal",
      "venue.db-shm",
    ]),
  ).toEqual(venueBefore);
  for (const path of ["trading.env", found])
    await expect(lstat(join(roots.stateDir, path))).rejects.toMatchObject({ code: "ENOENT" });
  for (const path of [".venue.db-litestream", "venue.db", "venue.db-wal", "venue.db-shm"])
    await expect(lstat(join(roots.venueDir, path))).rejects.toMatchObject({ code: "ENOENT" });
  // The record folder's own parent stays: it was not part of the unit.
  expect((await lstat(join(roots.stateDir, RECORDS))).isDirectory()).toBe(true);
});

it("a database whose -wal holds committed rows moves whole, -wal first, and opens with every row", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  const work = await scratch();
  const source = new DatabaseSync(join(work, "w.db"));
  try {
    source.exec("pragma journal_mode = wal; pragma wal_autocheckpoint = 0;");
    source.exec("create table t (n integer)");
    const insert = source.prepare("insert into t (n) values (?)");
    for (let n = 0; n < 50; n++) insert.run(n);
    // Copied while the writer is open, so the rows are in the -wal and not yet in the main file.
    await copyFile(join(work, "w.db"), join(roots.venueDir, "venue.db"));
    await copyFile(join(work, "w.db-wal"), join(roots.venueDir, "venue.db-wal"));
  } finally {
    source.close();
  }
  const count = (path: string) => {
    const url = pathToFileURL(path);
    url.searchParams.set("mode", "ro");
    const db = new DatabaseSync(url, { readOnly: true });
    try {
      return (db.prepare("select count(*) as n from t").get() as { n: number }).n;
    } catch {
      return null;
    } finally {
      db.close();
    }
  };
  // Control: the main file alone holds no table yet, so every row is in the -wal.
  const mainOnly = await scratch();
  await copyFile(join(roots.venueDir, "venue.db"), join(mainOnly, "venue.db"));
  expect(count(join(mainOnly, "venue.db"))).toBeNull();

  const renames: string[] = [];
  const io: SetAsideIo = {
    ...realIo,
    rename: async (from, to) => {
      renames.push(from.slice(roots.venueDir.length + 1));
      await fs.rename(from, to);
    },
  };
  const record = await prepared(roots, attempt.administratorId, { io });
  renames.length = 0;
  await moveStartAgainUnits(roots, record, io);

  expect(renames).toEqual(["venue.db-wal", "venue.db"]);
  expect(count(join(roots.stateDir, record.setAside!.venue, "venue.db"))).toBe(50);
});

it("an existing stem folder refuses setup.attempt_conflict and moves nothing", async () => {
  const base = await scratch();
  const attempt = await startAgainAttempt(base);
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  const survey = choiceOf(await surveyStartAgainLeftovers(roots));
  const stem = startAgainChoiceStem({ at: new Date().toISOString(), attemptId: survey.attemptId });
  await mkdir(join(roots.stateDir, START_AGAIN_SET_ASIDE_DIR, stem), { recursive: true });
  const before = await snapshot(base);
  const setAside = await setAsideDestinations(roots, stem);

  await expect(prepareSetAside(roots, survey.units, setAside)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await snapshot(base)).toEqual(before);
});

it("an existing destination file is never overwritten", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  const record = await prepared(roots, attempt.administratorId);
  const occupied = join(roots.stateDir, record.setAside!.state, "trading.env");
  await writeFile(occupied, "someone else's");

  await expect(moveStartAgainUnits(roots, record)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "set-aside failed: EEXIST state/trading.env",
  });
  expect(await readFile(occupied, "utf8")).toBe("someone else's");
  expect(await readFile(join(roots.stateDir, "trading.env"), "utf8")).toBe("X=1\n");
});

it("the probe's EXDEV refuses setup.start_again_set_aside_unavailable, removes only the empty folders it made, and moves nothing", async () => {
  const base = await scratch();
  const attempt = await startAgainAttempt(base);
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  const before = await snapshot(base);
  const survey = choiceOf(await surveyStartAgainLeftovers(roots));
  const stem = startAgainChoiceStem({ at: new Date().toISOString(), attemptId: survey.attemptId });
  const setAside = await setAsideDestinations(roots, stem);
  const probes: string[] = [];
  const io: SetAsideIo = {
    ...realIo,
    rename: async (from, to) => {
      probes.push(from);
      if (from.endsWith(`${PROBE}${stem}`) && from.startsWith(roots.venueDir)) throw errno("EXDEV");
      await fs.rename(from, to);
    },
  };

  await expect(prepareSetAside(roots, survey.units, setAside, io)).rejects.toMatchObject({
    code: "setup.start_again_set_aside_unavailable",
  });
  expect(probes.some((from) => from.startsWith(roots.venueDir))).toBe(true);
  expect(await snapshot(base)).toEqual(before);
});

it("any other probe failure removes the same folders and refuses with that error", async () => {
  const base = await scratch();
  const attempt = await startAgainAttempt(base);
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  const before = await snapshot(base);
  const survey = choiceOf(await surveyStartAgainLeftovers(roots));
  const stem = startAgainChoiceStem({ at: new Date().toISOString(), attemptId: survey.attemptId });
  const setAside = await setAsideDestinations(roots, stem);
  const io: SetAsideIo = {
    ...realIo,
    rename: async () => {
      throw errno("EPERM");
    },
  };

  await expect(prepareSetAside(roots, survey.units, setAside, io)).rejects.toMatchObject({
    code: "EPERM",
  });
  expect(await snapshot(base)).toEqual(before);
});

it("a probe whose rmdir fails after its rename is removed from where it went, with the folders made", async () => {
  const base = await scratch();
  const attempt = await startAgainAttempt(base);
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  const before = await snapshot(base);
  const survey = choiceOf(await surveyStartAgainLeftovers(roots));
  const stem = startAgainChoiceStem({ at: new Date().toISOString(), attemptId: survey.attemptId });
  const setAside = await setAsideDestinations(roots, stem);
  let failed = false;
  const io: SetAsideIo = {
    ...realIo,
    rmdir: (async (path: string) => {
      if (!failed && path.endsWith(`${PROBE}${stem}`)) {
        failed = true;
        throw errno("EIO");
      }
      await fs.rmdir(path);
    }) as typeof fs.rmdir,
  };

  await expect(prepareSetAside(roots, survey.units, setAside, io)).rejects.toMatchObject({
    code: "EIO",
  });
  expect(await snapshot(base)).toEqual(before);
});

it("on one filesystem venue units go under the state folder's set-aside folder; on two, under the venue folder's own", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  const venueDev = (async (path: string, options?: unknown) => {
    const info = await fs.lstat(path, options as never);
    if (path === roots.venueDir)
      Object.defineProperty(info, "dev", { value: Number(info.dev) + 1 });
    return info;
  }) as typeof fs.lstat;
  const destinationsIo: SetAsideIo = { ...realIo, lstat: venueDev };
  const stem = `${Date.now()}-${attempt.attemptId}`;
  expect(await setAsideDestinations(roots, stem)).toEqual({
    state: `${START_AGAIN_SET_ASIDE_DIR}/${stem}/state`,
    venue: `${START_AGAIN_SET_ASIDE_DIR}/${stem}/venue`,
  });
  expect(await setAsideDestinations(roots, stem, destinationsIo)).toEqual({
    state: `${START_AGAIN_SET_ASIDE_DIR}/${stem}/state`,
    venue: `${START_AGAIN_SET_ASIDE_DIR}/${stem}`,
  });

  const record = await prepared(roots, attempt.administratorId, { destinationsIo });
  await moveStartAgainUnits(roots, record);

  const stem2 = stemOf(record);
  expect(
    await readFile(join(roots.venueDir, START_AGAIN_SET_ASIDE_DIR, stem2, "venue.db"), "utf8"),
  ).toBe("found database");
  expect(
    await readFile(
      join(roots.stateDir, START_AGAIN_SET_ASIDE_DIR, stem2, "state", "trading.env"),
      "utf8",
    ),
  ).toBe("X=1\n");
  expect(await readdir(join(roots.stateDir, START_AGAIN_SET_ASIDE_DIR, stem2))).toEqual(["state"]);
});

it("a leftover probe folder from a cut is removed by the next prepare, and nothing else is", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  const old = `1700000000000-${attempt.attemptId}`;
  const leftovers = [
    join(roots.stateDir, `${PROBE}${old}`),
    join(roots.venueDir, `${PROBE}${old}`),
    join(roots.stateDir, START_AGAIN_SET_ASIDE_DIR, old, "state", `${PROBE}${old}`),
    join(roots.stateDir, START_AGAIN_SET_ASIDE_DIR, old, "venue", `${PROBE}${old}`),
    join(roots.venueDir, START_AGAIN_SET_ASIDE_DIR, old, `${PROBE}${old}`),
  ];
  for (const path of leftovers) await mkdir(path, { recursive: true });
  const kept = [
    join(roots.stateDir, `${PROBE}not-a-stem`),
    join(roots.stateDir, "an-empty-folder"),
    join(roots.stateDir, START_AGAIN_SET_ASIDE_DIR, old, "state"),
    join(roots.venueDir, START_AGAIN_SET_ASIDE_DIR, old),
  ];
  for (const path of kept) await mkdir(path, { recursive: true });
  const full = join(roots.venueDir, `${PROBE}1700000000001-${attempt.attemptId}`);
  await put(join(full, "someone.txt"), "kept");
  const file = join(roots.stateDir, `${PROBE}1700000000002-${attempt.attemptId}`);
  await writeFile(file, "a file, not a probe");

  await prepared(roots, attempt.administratorId);

  for (const path of leftovers)
    await expect(lstat(path), path).rejects.toMatchObject({ code: "ENOENT" });
  for (const path of kept) expect((await lstat(path)).isDirectory(), path).toBe(true);
  expect(await readFile(join(full, "someone.txt"), "utf8")).toBe("kept");
  expect(await readFile(file, "utf8")).toBe("a file, not a probe");
});

it("the note is raised to the record's floor, keeping its last name and module; with no note nothing is written", async () => {
  const noted = await startAgainAttempt(await scratch(), {
    note: { floorMs: 60_000, lastName: "0CNQT", module: "probe" },
  });
  await writeFile(join(noted.roots.stateDir, "trading.env"), "X=1\n");
  const record = await prepared(noted.roots, noted.administratorId);
  expect(record.noteFloorMs).toBeGreaterThan(60_000);
  await moveStartAgainUnits(noted.roots, record);
  expect(await readStartAgainNote(noted.roots.stateDir)).toEqual({
    version: 1,
    floorMs: record.noteFloorMs,
    lastName: "0CNQT",
    module: "probe",
  });

  const bare = await startAgainAttempt(await scratch());
  await writeFile(join(bare.roots.stateDir, "trading.env"), "X=1\n");
  expect(await readStartAgainNote(bare.roots.stateDir)).toBeNull();
  await moveStartAgainUnits(bare.roots, await prepared(bare.roots, bare.administratorId));
  expect(await readStartAgainNote(bare.roots.stateDir)).toBeNull();

  // Only folders found: no file time, no floor, and the note is left as it was.
  const folders = await startAgainAttempt(await scratch(), {
    note: { floorMs: 60_000, lastName: "0CNQT", module: "probe" },
  });
  await mkdir(join(folders.roots.venueDir, ".venue.db-litestream"));
  const empty = await prepared(folders.roots, folders.administratorId);
  expect(empty.noteFloorMs).toBeNull();
  await moveStartAgainUnits(folders.roots, empty);
  expect((await readStartAgainNote(folders.roots.stateDir))!.floorMs).toBe(60_000);
});

it("venue.lock, venue.holder.json and recovery.lock are never moved or unlinked", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  for (const name of LOCKS) {
    await writeFile(join(roots.venueDir, name), "");
    await writeFile(join(roots.stateDir, name), "");
  }
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  const inodes = async () =>
    Promise.all(
      LOCKS.flatMap((name) => [roots.venueDir, roots.stateDir].map((dir) => join(dir, name))).map(
        async (path) => [path, (await lstat(path, { bigint: true })).ino] as const,
      ),
    );
  const before = await inodes();

  await moveStartAgainUnits(roots, await prepared(roots, attempt.administratorId));

  expect(await inodes()).toEqual(before);
});

it("after a move, finishStartAgainDeletion deletes only the marked files", async () => {
  const attempt = await startAgainAttempt(await scratch(), {
    before: async ({ venueDir }) => writeFile(join(venueDir, "node.db"), ""),
  });
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  const record = await prepared(roots, attempt.administratorId);
  await moveStartAgainUnits(roots, record);

  await finishStartAgainDeletion(roots);

  await expect(lstat(join(roots.venueDir, "first-setup-deleting.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  for (const marked of ["node.db", "first-setup-claim.json"])
    await expect(lstat(join(roots.venueDir, marked))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(join(roots.stateDir, "first-setup.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(join(roots.stateDir, record.setAside!.state, "trading.env"), "utf8")).toBe(
    "X=1\n",
  );
  expect(await readFile(join(roots.stateDir, record.setAside!.venue, "venue.db"), "utf8")).toBe(
    "found database",
  );
  expect(await readdir(join(roots.stateDir, "first-setup-start-again-choices"))).toEqual([
    `${stemOf(record)}.json`,
  ]);
});

it("a keep record moves nothing and refuses setup.attempt_invalid", async () => {
  const base = await scratch();
  const attempt = await startAgainAttempt(base);
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  const record = await prepared(roots, attempt.administratorId);
  const before = await snapshot(base);

  await expect(
    moveStartAgainUnits(roots, { ...record, choice: "keep", setAside: null, noteFloorMs: null }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(await snapshot(base)).toEqual(before);
});

it("a piece whose rename fails refuses setup.start_again_incomplete naming it, and moves nothing more", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  await writeFile(join(roots.venueDir, "venue.db-wal"), "found pages");
  const record = await prepared(roots, attempt.administratorId);
  const io: SetAsideIo = {
    ...realIo,
    rename: async (from, to) => {
      if (from === join(roots.venueDir, "venue.db-wal")) throw errno("EIO");
      await fs.rename(from, to);
    },
  };

  await expect(moveStartAgainUnits(roots, record, io)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "set-aside failed: EIO venue/venue.db-wal",
  });
  // The state unit sorts first and moved; the database stays whole at its source.
  expect(await readFile(join(roots.stateDir, record.setAside!.state, "trading.env"), "utf8")).toBe(
    "X=1\n",
  );
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("found database");
  expect(await readFile(join(roots.venueDir, "venue.db-wal"), "utf8")).toBe("found pages");
});

it("a set-aside folder that cannot be listed, or a stem folder that cannot be made, refuses with its error and leaves no folder made", async () => {
  const base = await scratch();
  const attempt = await startAgainAttempt(base);
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  const survey = choiceOf(await surveyStartAgainLeftovers(roots));
  const stem = startAgainChoiceStem({ at: new Date().toISOString(), attemptId: survey.attemptId });
  const setAside = await setAsideDestinations(roots, stem);
  const before = await snapshot(base);
  const io: SetAsideIo = {
    ...realIo,
    mkdir: (async (path: string, options?: unknown) => {
      if (path.endsWith(stem)) throw errno("EIO");
      return fs.mkdir(path, options as never);
    }) as typeof fs.mkdir,
  };
  await expect(prepareSetAside(roots, survey.units, setAside, io)).rejects.toMatchObject({
    code: "EIO",
  });
  expect(await snapshot(base)).toEqual(before);

  // A file where a stem folder would be is not listed; a folder that cannot be read refuses.
  await put(join(roots.stateDir, START_AGAIN_SET_ASIDE_DIR, "a-file"), "");
  const locked = join(roots.stateDir, START_AGAIN_SET_ASIDE_DIR, "locked");
  await mkdir(locked);
  await fs.chmod(locked, 0o000);
  try {
    await expect(prepareSetAside(roots, survey.units, setAside)).rejects.toMatchObject({
      code: "EACCES",
    });
  } finally {
    await fs.chmod(locked, 0o700);
  }
  await expect(lstat(join(roots.stateDir, START_AGAIN_SET_ASIDE_DIR, stem))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("a leftover probe that cannot be removed for another reason refuses with that error", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await mkdir(join(roots.stateDir, `${PROBE}1700000000000-${attempt.attemptId}`));
  const survey = choiceOf(await surveyStartAgainLeftovers(roots));
  const stem = startAgainChoiceStem({ at: new Date().toISOString(), attemptId: survey.attemptId });
  const setAside = await setAsideDestinations(roots, stem);
  const io: SetAsideIo = {
    ...realIo,
    rmdir: (async () => {
      throw errno("EBUSY");
    }) as typeof fs.rmdir,
  };
  await expect(prepareSetAside(roots, survey.units, setAside, io)).rejects.toMatchObject({
    code: "EBUSY",
  });
});

it("a destination folder that cannot be made, or a destination that cannot be looked at, refuses naming it", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  const record = await prepared(roots, attempt.administratorId);
  const mkdirFails: SetAsideIo = {
    ...realIo,
    mkdir: (async () => {
      throw errno("ENOSPC");
    }) as typeof fs.mkdir,
  };
  await expect(moveStartAgainUnits(roots, record, mkdirFails)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: `set-aside failed: ENOSPC state/${record.setAside!.state}`,
  });
  const lstatFails: SetAsideIo = {
    ...realIo,
    lstat: (async (path: string, options?: unknown) => {
      if (path.endsWith("trading.env")) throw errno("EACCES");
      return fs.lstat(path, options as never);
    }) as typeof fs.lstat,
  };
  await expect(moveStartAgainUnits(roots, record, lstatFails)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "set-aside failed: EACCES state/trading.env",
  });
  expect(await readFile(join(roots.stateDir, "trading.env"), "utf8")).toBe("X=1\n");
});

it("a folder the clean-up cannot remove stays, and the refusal is still the probe's", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  const survey = choiceOf(await surveyStartAgainLeftovers(roots));
  const stem = startAgainChoiceStem({ at: new Date().toISOString(), attemptId: survey.attemptId });
  const setAside = await setAsideDestinations(roots, stem);
  const io: SetAsideIo = {
    ...realIo,
    rename: async () => {
      throw errno("EXDEV");
    },
    rmdir: (async (path: string) => {
      if (path.endsWith(stem)) throw errno("EIO");
      await fs.rmdir(path);
    }) as typeof fs.rmdir,
  };
  await expect(prepareSetAside(roots, survey.units, setAside, io)).rejects.toMatchObject({
    code: "setup.start_again_set_aside_unavailable",
  });
  expect(await readdir(join(roots.stateDir, START_AGAIN_SET_ASIDE_DIR, stem))).toEqual([]);
});

it("a venue destination in the venue folder that cannot be made refuses naming it there, and an error with no code names it unknown", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  const destinationsIo: SetAsideIo = {
    ...realIo,
    lstat: (async (path: string, options?: unknown) => {
      const info = await fs.lstat(path, options as never);
      if (path === roots.venueDir)
        Object.defineProperty(info, "dev", { value: Number(info.dev) + 1 });
      return info;
    }) as typeof fs.lstat,
  };
  const record = await prepared(roots, attempt.administratorId, { destinationsIo });
  await expect(
    moveStartAgainUnits(roots, record, {
      ...realIo,
      mkdir: (async () => {
        throw errno("ENOSPC");
      }) as typeof fs.mkdir,
    }),
  ).rejects.toMatchObject({
    reason: `set-aside failed: ENOSPC venue/${record.setAside!.venue}`,
  });
  await expect(
    moveStartAgainUnits(roots, record, {
      ...realIo,
      rename: async () => {
        throw new Error("no code");
      },
    }),
  ).rejects.toMatchObject({ reason: "set-aside failed: unknown venue/venue.db" });
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("found database");
});

/** A rename that throws on its `n`th call, as a cut there would leave the folders. */
function cutAt(n: number): SetAsideIo {
  let calls = 0;
  return {
    ...realIo,
    rename: async (from, to) => {
      if (++calls === n) throw errno("EIO");
      await fs.rename(from, to);
    },
  };
}

async function cutMove(roots: Roots, record: StartAgainChoiceRecord, n: number) {
  await expect(moveStartAgainUnits(roots, record, cutAt(n))).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
  });
}

const VENUE_FOUND = [".venue.db-litestream", "venue.db", "venue.db-wal", "venue.db-shm"];

async function foundEverywhere(roots: Roots) {
  const found = `${RECORDS}/${randomUUID()}`;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await put(join(roots.stateDir, found, "step-000001", "step.json"), "{}");
  await put(join(roots.venueDir, ".venue.db-litestream", "generations", "a.wal"), "one");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  await writeFile(join(roots.venueDir, "venue.db-wal"), "found pages");
  await writeFile(join(roots.venueDir, "venue.db-shm"), "found index");
  return {
    stateFound: ["trading.env", found],
    state: await fingerprints(roots.stateDir, ["trading.env", found]),
    venue: await fingerprints(roots.venueDir, VENUE_FOUND),
  };
}

/** Everything found is in the record's folders, unchanged, gone from its source, in one stem folder. */
async function expectAllAside(
  roots: Roots,
  record: StartAgainChoiceRecord,
  before: Awaited<ReturnType<typeof foundEverywhere>>,
) {
  const folders = setAsideFolderPaths(roots, record.setAside!);
  expect(await fingerprints(folders.state, before.stateFound)).toEqual(before.state);
  expect(await fingerprints(folders.venue, VENUE_FOUND)).toEqual(before.venue);
  for (const path of before.stateFound)
    await expect(lstat(join(roots.stateDir, path))).rejects.toMatchObject({ code: "ENOENT" });
  for (const path of VENUE_FOUND)
    await expect(lstat(join(roots.venueDir, path))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(join(roots.stateDir, START_AGAIN_SET_ASIDE_DIR))).toEqual([stemOf(record)]);
}

it("setAsideFolderPaths resolves a record's folders: beside the state units on one filesystem, in the venue folder on two", () => {
  const roots = { stateDir: "/s", venueDir: "/v" };
  expect(
    setAsideFolderPaths(roots, {
      state: `${START_AGAIN_SET_ASIDE_DIR}/1-x/state`,
      venue: `${START_AGAIN_SET_ASIDE_DIR}/1-x/venue`,
    }),
  ).toEqual({
    state: `/s/${START_AGAIN_SET_ASIDE_DIR}/1-x/state`,
    venue: `/s/${START_AGAIN_SET_ASIDE_DIR}/1-x/venue`,
  });
  expect(
    setAsideFolderPaths(roots, {
      state: `${START_AGAIN_SET_ASIDE_DIR}/1-x/state`,
      venue: `${START_AGAIN_SET_ASIDE_DIR}/1-x`,
    }),
  ).toEqual({
    state: `/s/${START_AGAIN_SET_ASIDE_DIR}/1-x/state`,
    venue: `/v/${START_AGAIN_SET_ASIDE_DIR}/1-x`,
  });
});

it("a cut after the record and before the first rename: the resume moves everything into the record's folder", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  const before = await foundEverywhere(roots);
  const record = await prepared(roots, attempt.administratorId);
  await cutMove(roots, record, 1);

  expect(await resumeStartAgainSetAside(roots)).toBe("resumed");

  await expectAllAside(roots, record, before);
});

it("a cut after a database's -wal moved: the resume moves -shm and venue.db into the same folder as the -wal, and the moved database opens with every row", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  const work = await scratch();
  const source = new DatabaseSync(join(work, "w.db"));
  try {
    source.exec("pragma journal_mode = wal; pragma wal_autocheckpoint = 0;");
    source.exec("create table t (n integer)");
    const insert = source.prepare("insert into t (n) values (?)");
    for (let n = 0; n < 50; n++) insert.run(n);
    for (const suffix of ["", "-wal", "-shm"])
      await copyFile(join(work, `w.db${suffix}`), join(roots.venueDir, `venue.db${suffix}`));
  } finally {
    source.close();
  }
  const record = await prepared(roots, attempt.administratorId);
  await cutMove(roots, record, 2);
  const aside = setAsideFolderPaths(roots, record.setAside!).venue;
  expect(await readdir(aside)).toEqual(["venue.db-wal"]);

  expect(await resumeStartAgainSetAside(roots)).toBe("resumed");

  expect((await readdir(aside)).sort()).toEqual(["venue.db", "venue.db-shm", "venue.db-wal"]);
  for (const suffix of ["", "-wal", "-shm"])
    await expect(lstat(join(roots.venueDir, `venue.db${suffix}`))).rejects.toMatchObject({
      code: "ENOENT",
    });
  const url = pathToFileURL(join(aside, "venue.db"));
  url.searchParams.set("mode", "ro");
  const db = new DatabaseSync(url, { readOnly: true });
  try {
    expect((db.prepare("select count(*) as n from t").get() as { n: number }).n).toBe(50);
  } finally {
    db.close();
  }
});

// Six pieces in move order: the record folder, trading.env, .venue.db-litestream, -wal, -shm, venue.db.
it.each([1, 2, 3, 4, 5, 6])(
  "a cut at rename %i: the resume finishes the rest, into one folder",
  async (n) => {
    const attempt = await startAgainAttempt(await scratch());
    const { roots } = attempt;
    const before = await foundEverywhere(roots);
    const record = await prepared(roots, attempt.administratorId);
    await cutMove(roots, record, n);

    expect(await resumeStartAgainSetAside(roots)).toBe("resumed");

    await expectAllAside(roots, record, before);
  },
);

it("a resume after a move that finished finds everything already moved and renames nothing", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  const before = await foundEverywhere(roots);
  const record = await prepared(roots, attempt.administratorId);
  await moveStartAgainUnits(roots, record);
  const renames: string[] = [];
  const io: SetAsideIo = {
    ...realIo,
    rename: async (from, to) => {
      renames.push(from);
      await fs.rename(from, to);
    },
  };

  expect(await resumeStartAgainSetAside(roots, io)).toBe("resumed");

  expect(renames).toEqual([]);
  await expectAllAside(roots, record, before);
});

it("a cut before the note was raised: the resume raises it", async () => {
  const attempt = await startAgainAttempt(await scratch(), {
    note: { floorMs: 60_000, lastName: "0CNQT", module: "probe" },
  });
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  const record = await prepared(roots, attempt.administratorId);
  expect((await readStartAgainNote(roots.stateDir))!.floorMs).toBe(60_000);

  expect(await resumeStartAgainSetAside(roots)).toBe("resumed");

  expect(await readStartAgainNote(roots.stateDir)).toEqual({
    version: 1,
    floorMs: record.noteFloorMs,
    lastName: "0CNQT",
    module: "probe",
  });
  expect(
    await readFile(join(setAsideFolderPaths(roots, record.setAside!).state, "trading.env"), "utf8"),
  ).toBe("X=1\n");
});

it("the resume removes leftover probe folders a cut left", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  const record = await prepared(roots, attempt.administratorId);
  const probe = join(
    setAsideFolderPaths(roots, record.setAside!).state,
    `${PROBE}${stemOf(record)}`,
  );
  await mkdir(probe);

  expect(await resumeStartAgainSetAside(roots)).toBe("resumed");

  await expect(lstat(probe)).rejects.toMatchObject({ code: "ENOENT" });
});

it("a piece changed between the cut and the resume: the resume stops and moves nothing more", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await foundEverywhere(roots);
  const record = await prepared(roots, attempt.administratorId);
  // The record folder, trading.env, .venue.db-litestream and the -wal moved; -shm is next.
  await cutMove(roots, record, 5);
  await writeFile(join(roots.venueDir, "venue.db-shm"), "rewritten by someone");
  const renames: string[] = [];
  const io: SetAsideIo = {
    ...realIo,
    rename: async (from, to) => {
      renames.push(from);
      await fs.rename(from, to);
    },
  };

  expect(await resumeStartAgainSetAside(roots, io)).toBe("stopped");

  expect(renames).toEqual([]);
  expect(await readFile(join(roots.venueDir, "venue.db-shm"), "utf8")).toBe("rewritten by someone");
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("found database");
  expect(await readdir(setAsideFolderPaths(roots, record.setAside!).venue)).toEqual([
    ".venue.db-litestream",
    "venue.db-wal",
  ]);
});

it("a moved piece changed in the set-aside folder, or present at both ends, stops the resume", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  const record = await prepared(roots, attempt.administratorId);
  await cutMove(roots, record, 2);
  const folders = setAsideFolderPaths(roots, record.setAside!);
  await writeFile(join(folders.state, "trading.env"), "rewritten");

  expect(await resumeStartAgainSetAside(roots)).toBe("stopped");
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("found database");

  // The original back at its source and a copy at the destination: neither end is clear.
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  expect(await resumeStartAgainSetAside(roots)).toBe("stopped");
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("found database");
});

it("a piece still at its source with something else at its destination stops the resume, and nothing is overwritten", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  const record = await prepared(roots, attempt.administratorId);
  await cutMove(roots, record, 1);
  const occupied = join(setAsideFolderPaths(roots, record.setAside!).state, "trading.env");
  await writeFile(occupied, "someone else's");

  expect(await resumeStartAgainSetAside(roots)).toBe("stopped");

  expect(await readFile(occupied, "utf8")).toBe("someone else's");
  expect(await readFile(join(roots.stateDir, "trading.env"), "utf8")).toBe("X=1\n");
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("found database");
});

it("a piece gone from both ends, or one with an extra entry, stops the resume", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await put(join(roots.venueDir, ".venue.db-litestream", "generations", "a.wal"), "one");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  const record = await prepared(roots, attempt.administratorId);
  await cutMove(roots, record, 1);
  await writeFile(join(roots.venueDir, ".venue.db-litestream", "extra"), "new");

  expect(await resumeStartAgainSetAside(roots)).toBe("stopped");
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("found database");

  await rm(join(roots.venueDir, ".venue.db-litestream"), { recursive: true });
  expect(await resumeStartAgainSetAside(roots)).toBe("stopped");
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("found database");
});

it("a piece replaced by a link stops the resume, and the link is not moved", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  const record = await prepared(roots, attempt.administratorId);
  await cutMove(roots, record, 1);
  await rm(join(roots.stateDir, "trading.env"));
  await fs.symlink(join(roots.venueDir, "venue.db"), join(roots.stateDir, "trading.env"));

  expect(await resumeStartAgainSetAside(roots)).toBe("stopped");

  expect((await lstat(join(roots.stateDir, "trading.env"))).isSymbolicLink()).toBe(true);
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("found database");
});

it("a rename that fails at the resume refuses setup.start_again_incomplete with reason set-aside failed: EXDEV venue/venue.db, and moves nothing more", async () => {
  const base = await scratch();
  const attempt = await startAgainAttempt(base);
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  const record = await prepared(roots, attempt.administratorId);
  // trading.env moved; the cut came at venue.db, the last piece.
  await cutMove(roots, record, 2);
  const before = await snapshot(base);
  const io: SetAsideIo = {
    ...realIo,
    rename: async (from, to) => {
      if (from === join(roots.venueDir, "venue.db")) throw errno("EXDEV");
      await fs.rename(from, to);
    },
  };

  await expect(resumeStartAgainSetAside(roots, io)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "set-aside failed: EXDEV venue/venue.db",
  });
  // The resume held the venue lock, whose file stays; nothing else changed.
  const after = await snapshot(base);
  expect(after.filter((line) => line.startsWith("venue/venue.lock:"))).toHaveLength(1);
  expect(after.filter((line) => !line.startsWith("venue/venue.lock:"))).toEqual(before);
  // The next start tries again.
  expect(await resumeStartAgainSetAside(roots)).toBe("resumed");
  expect(
    await readFile(join(setAsideFolderPaths(roots, record.setAside!).venue, "venue.db"), "utf8"),
  ).toBe("found database");
});

it("a symlink put at the state folder's set-aside name after the record makes the resume refuse, and moves nothing", async () => {
  const base = await scratch();
  const attempt = await startAgainAttempt(base);
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  await prepared(roots, attempt.administratorId);
  const setAside = join(roots.stateDir, START_AGAIN_SET_ASIDE_DIR);
  const elsewhere = join(base, "elsewhere");
  await fs.rename(setAside, elsewhere);
  await fs.symlink(elsewhere, setAside);
  const [stem] = await readdir(elsewhere);
  await mkdir(join(elsewhere, stem!, `${PROBE}1-${randomUUID()}`));
  const before = await snapshot(elsewhere);

  await expect(resumeStartAgainSetAside(roots)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: `set-aside failed: symlink state/${START_AGAIN_SET_ASIDE_DIR}`,
  });

  expect(await snapshot(elsewhere)).toEqual(before);
  expect(await readFile(join(roots.stateDir, "trading.env"), "utf8")).toBe("X=1\n");
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("found database");
});

it.each(["", "/state", "/venue"])(
  "a symlink put at the stem folder%s after the record makes the resume refuse, and moves nothing",
  async (below) => {
    const base = await scratch();
    const attempt = await startAgainAttempt(base);
    const { roots } = attempt;
    await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
    await writeFile(join(roots.venueDir, "venue.db"), "found database");
    const record = await prepared(roots, attempt.administratorId);
    const stem = dirname(record.setAside!.state);
    const linked = join(roots.stateDir, `${stem}${below}`);
    const elsewhere = join(base, "elsewhere");
    await fs.rename(linked, elsewhere);
    await fs.symlink(elsewhere, linked);
    // Named as a probe a cut left: the clean-up must not reach it through the link.
    await mkdir(join(elsewhere, `${PROBE}1-${randomUUID()}`));
    const before = await snapshot(elsewhere);

    await expect(resumeStartAgainSetAside(roots)).rejects.toMatchObject({
      code: "setup.start_again_incomplete",
      reason: `set-aside failed: symlink state/${stem}${below}`,
    });

    expect(await snapshot(elsewhere)).toEqual(before);
    expect(await readFile(join(roots.stateDir, "trading.env"), "utf8")).toBe("X=1\n");
    expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("found database");
  },
);

it("a symlink put at a nested piece's parent inside the destination makes the resume refuse, and its target stays empty", async () => {
  const base = await scratch();
  const attempt = await startAgainAttempt(base);
  const { roots } = attempt;
  const found = `${RECORDS}/${randomUUID()}`;
  await put(join(roots.stateDir, found, "step-000001", "step.json"), "{}");
  const record = await prepared(roots, attempt.administratorId);
  const elsewhere = join(base, "elsewhere");
  await mkdir(elsewhere);
  await fs.symlink(elsewhere, join(setAsideFolderPaths(roots, record.setAside!).state, RECORDS));

  await expect(resumeStartAgainSetAside(roots)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: `set-aside failed: symlink state/${found}`,
  });

  expect(await readdir(elsewhere)).toEqual([]);
  expect(await readFile(join(roots.stateDir, found, "step-000001", "step.json"), "utf8")).toBe(
    "{}",
  );
});

/** A Move of a file found inside a folder the attempt made, so the piece has parent folders of its own. */
async function nestedFoundMove(base: string) {
  const parent = `${RECORDS}/${randomUUID()}`;
  const attempt = await startAgainAttempt(base, {
    before: (roots) => put(join(roots.stateDir, parent, "owned.json"), "owned"),
  });
  const piece = `${parent}/found.json`;
  await writeFile(join(attempt.roots.stateDir, piece), "found bytes");
  const record = await prepared(attempt.roots, attempt.administratorId);
  expect(record.listed.units.flatMap((unit) => unit.pieces)).toEqual([piece]);
  return { roots: attempt.roots, record, parent, piece };
}

const withoutLock = (lines: string[]) =>
  lines.filter((line) => !line.startsWith("venue/venue.lock:"));

it("a link put in place of a piece's parent folder at its source makes the resume refuse and moves nothing; with the real folder back, the resume moves the piece", async () => {
  const base = await scratch();
  const { roots, record, parent, piece } = await nestedFoundMove(base);
  const elsewhere = join(base, "elsewhere");
  await fs.rename(join(roots.stateDir, parent), elsewhere);
  await fs.symlink(elsewhere, join(roots.stateDir, parent));
  const before = await snapshot(base);

  await expect(resumeStartAgainSetAside(roots)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: `set-aside failed: symlink state/${piece}`,
  });

  expect(withoutLock(await snapshot(base))).toEqual(withoutLock(before));
  expect(await readFile(join(elsewhere, "found.json"), "utf8")).toBe("found bytes");

  await fs.unlink(join(roots.stateDir, parent));
  await fs.rename(elsewhere, join(roots.stateDir, parent));
  expect(await resumeStartAgainSetAside(roots)).toBe("resumed");
  expect(
    await readFile(join(setAsideFolderPaths(roots, record.setAside!).state, piece), "utf8"),
  ).toBe("found bytes");
});

it("a link put in place of a moved piece's parent folder in the set-aside folder makes the resume refuse, though what it leads to matches the record; with the real folder back, the resume finds it moved", async () => {
  const base = await scratch();
  const { roots, record, parent, piece } = await nestedFoundMove(base);
  await moveStartAgainUnits(roots, record);
  const moved = join(setAsideFolderPaths(roots, record.setAside!).state, parent);
  const elsewhere = join(base, "elsewhere");
  await fs.rename(moved, elsewhere);
  await fs.symlink(elsewhere, moved);
  const before = await snapshot(base);

  await expect(resumeStartAgainSetAside(roots)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: `set-aside failed: symlink state/${piece}`,
  });

  expect(withoutLock(await snapshot(base))).toEqual(withoutLock(before));

  await fs.unlink(moved);
  await fs.rename(elsewhere, moved);
  expect(await resumeStartAgainSetAside(roots)).toBe("resumed");
  expect(await readFile(join(moved, "found.json"), "utf8")).toBe("found bytes");
});

it("a piece that cannot be looked at refuses naming it", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  const record = await prepared(roots, attempt.administratorId);
  await mkdir(setAsideFolderPaths(roots, record.setAside!).state, { recursive: true });
  const io: SetAsideIo = {
    ...realIo,
    lstat: (async (path: string, options?: unknown) => {
      if (path.endsWith("trading.env")) throw errno("EACCES");
      return fs.lstat(path, options as never);
    }) as typeof fs.lstat,
  };

  await expect(resumeStartAgainSetAside(roots, io)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "set-aside failed: EACCES state/trading.env",
  });
});

it("no move record, or only a keep record: none, and nothing touched", async () => {
  const none = await startAgainAttempt(await scratch());
  await rm(join(none.roots.venueDir, "first-setup-deleting.json"));
  expect(await resumeStartAgainSetAside(none.roots)).toBe("none");

  const base = await scratch();
  const attempt = await startAgainAttempt(base, {
    note: { floorMs: 60_000, lastName: "0CNQT", module: "probe" },
  });
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await mkdir(join(roots.stateDir, `${PROBE}1700000000000-${attempt.attemptId}`));
  const before = await snapshot(base);
  expect(await resumeStartAgainSetAside(roots)).toBe("none");
  expect(await snapshot(base)).toEqual(before);

  const survey = choiceOf(await surveyStartAgainLeftovers(roots));
  await writeStartAgainChoice(roots.stateDir, {
    at: new Date().toISOString(),
    attemptId: survey.attemptId,
    frozenDigest: survey.frozenDigest,
    markerSha256: survey.markerSha256,
    choice: "keep",
    administrator: { administratorId: attempt.administratorId, ...START_AGAIN_ADMIN },
    ownerGeneration: 0,
    listed: { digest: survey.digest, units: survey.units },
    setAside: null,
    noteFloorMs: null,
  });
  const kept = await snapshot(base);
  expect(await resumeStartAgainSetAside(roots)).toBe("none");
  expect(await snapshot(base)).toEqual(kept);
  expect((await readStartAgainNote(roots.stateDir))!.floorMs).toBe(60_000);
});

it("two move records: the latest is resumed, into its own folder", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  const record = await prepared(roots, attempt.administratorId, {
    at: new Date(Date.now() - 60_000).toISOString(),
  });
  const later = await prepared(roots, attempt.administratorId);
  await cutMove(roots, later, 1);

  expect(await resumeStartAgainSetAside(roots)).toBe("resumed");

  expect(
    await readFile(join(setAsideFolderPaths(roots, later.setAside!).state, "trading.env"), "utf8"),
  ).toBe("X=1\n");
  await expect(
    lstat(join(setAsideFolderPaths(roots, record.setAside!).state, "trading.env")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

/** A WAL-mode venue.db closed cleanly, so no -wal or -shm is beside it. */
async function cleanWalDatabase(path: string) {
  const db = new DatabaseSync(path);
  try {
    db.exec("pragma journal_mode = wal; create table t (n integer)");
  } finally {
    db.close();
  }
}

/** Another process commits rows and exits without closing: the rows stay in a new -wal. */
function writeAndExitWithoutClosing(path: string) {
  const script = [
    'const { DatabaseSync } = require("node:sqlite");',
    "const db = new DatabaseSync(process.argv[1]);",
    'db.exec("pragma wal_autocheckpoint = 0");',
    'const insert = db.prepare("insert into t (n) values (?)");',
    "for (let n = 0; n < 50; n++) insert.run(n);",
    "process.exit(0);",
  ].join("\n");
  execFileSync(process.execPath, ["-e", script, path], { stdio: "ignore" });
}

const mainFileOf = async (path: string) => {
  const info = await lstat(path, { bigint: true });
  return [info.ino, info.size, info.mtimeNs];
};

it("a -wal that appears beside a recorded database after the record: the Move refuses naming it and leaves the database at its source", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  const database = join(roots.venueDir, "venue.db");
  await cleanWalDatabase(database);
  const record = await prepared(roots, attempt.administratorId);
  expect(record.listed.units.map((unit) => unit.pieces)).toEqual([["venue.db"]]);
  const before = await mainFileOf(database);
  writeAndExitWithoutClosing(database);
  // Control: the main file looks exactly as recorded; only the new -wal holds the rows.
  expect(await mainFileOf(database)).toEqual(before);
  expect((await lstat(`${database}-wal`)).size).toBeGreaterThan(0);

  await expect(moveStartAgainUnits(roots, record)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "set-aside failed: unrecorded venue/venue.db-wal",
  });
  for (const suffix of ["", "-wal", "-shm"])
    expect((await lstat(`${database}${suffix}`)).isFile()).toBe(true);
  expect(await readdir(setAsideFolderPaths(roots, record.setAside!).venue)).toEqual([]);
});

it("a -wal that appears beside a recorded database after a cut: the resume stops and leaves the database at its source", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  const database = join(roots.venueDir, "venue.db");
  await cleanWalDatabase(database);
  const record = await prepared(roots, attempt.administratorId);
  await cutMove(roots, record, 1);
  const before = await mainFileOf(database);
  writeAndExitWithoutClosing(database);
  expect(await mainFileOf(database)).toEqual(before);

  expect(await resumeStartAgainSetAside(roots)).toBe("stopped");

  for (const suffix of ["", "-wal", "-shm"])
    expect((await lstat(`${database}${suffix}`)).isFile()).toBe(true);
  expect(await readdir(setAsideFolderPaths(roots, record.setAside!).venue)).toEqual([]);
});

it("a rename that fails at the resume with later pieces still to move refuses naming it, and the later pieces stay at their source", async () => {
  const base = await scratch();
  const attempt = await startAgainAttempt(base);
  const { roots } = attempt;
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  await writeFile(join(roots.venueDir, "venue.db-wal"), "found pages");
  await writeFile(join(roots.venueDir, "venue.db-shm"), "found index");
  const record = await prepared(roots, attempt.administratorId);
  await cutMove(roots, record, 1);
  const io: SetAsideIo = {
    ...realIo,
    rename: async (from, to) => {
      if (from === join(roots.venueDir, "venue.db-wal")) throw errno("EXDEV");
      await fs.rename(from, to);
    },
  };

  await expect(resumeStartAgainSetAside(roots, io)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "set-aside failed: EXDEV venue/venue.db-wal",
  });
  expect(await readFile(join(roots.venueDir, "venue.db-shm"), "utf8")).toBe("found index");
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("found database");
  expect(await readdir(setAsideFolderPaths(roots, record.setAside!).venue)).toEqual([]);
});

it("a side file beside a database that cannot be looked at refuses naming it, and the database stays", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  const record = await prepared(roots, attempt.administratorId);
  const io: SetAsideIo = {
    ...realIo,
    lstat: (async (path: string, options?: unknown) => {
      if (path === join(roots.venueDir, "venue.db-shm")) throw errno("EACCES");
      return fs.lstat(path, options as never);
    }) as typeof fs.lstat,
  };

  await expect(moveStartAgainUnits(roots, record, io)).rejects.toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "set-aside failed: EACCES venue/venue.db-shm",
  });
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("found database");
});
