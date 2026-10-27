import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { startAgainAttempt } from "../test/start-again-attempt.js";
import { finishStartAgainDeletion } from "./first-setup-start-again-deletion.js";
import {
  START_AGAIN_ENTRY_LIMIT,
  START_AGAIN_FLOOR_MARGIN_MS,
  classifyStartAgainRefusal,
  startAgainSetAsideFloorMs,
  surveyStartAgainLeftovers,
  type StartAgainSurvey,
} from "./first-setup-start-again-leftovers.js";

vi.mock("node:fs/promises", { spy: true });

const dirs: string[] = [];
async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "start-again-leftovers-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Roots = { venueDir: string; stateDir: string };
const RECORDS = "first-setup-resolutions";
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

async function put(path: string, bytes: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

function choice(survey: StartAgainSurvey | null) {
  expect(survey).not.toBeNull();
  if (survey!.kind !== "choice") throw new Error(`expected choice, got ${JSON.stringify(survey)}`);
  return survey!;
}

const unitAt = (survey: StartAgainSurvey | null, path: string) => {
  const unit = choice(survey).units.find((candidate) => candidate.path === path);
  expect(unit, path).toBeDefined();
  return unit!;
};

it("the owner's example: a venue.db placed after the marker is one database unit", async () => {
  const attempt = await startAgainAttempt(await scratch());
  const { roots } = attempt;
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  await writeFile(join(roots.venueDir, "venue.db-wal"), "found pages");
  await writeFile(join(roots.venueDir, "venue.db-shm"), "found index");
  const survey = choice(await surveyStartAgainLeftovers(roots));
  expect(survey.attemptId).toBe(attempt.attemptId);
  expect(survey.frozenDigest).toBe(attempt.frozenDigest);
  expect(survey.markerSha256).toBe(
    sha(await readFile(join(roots.venueDir, "first-setup-deleting.json"))),
  );
  expect(survey.units).toHaveLength(1);
  const [unit] = survey.units;
  expect(unit).toMatchObject({ root: "venue", path: "venue.db", why: "not-created" });
  expect(unit!.pieces).toEqual(["venue.db-wal", "venue.db-shm", "venue.db"]);
  expect(unit!.entries.map((entry) => entry.path)).toEqual([
    "venue.db",
    "venue.db-shm",
    "venue.db-wal",
  ]);
  const info = await stat(join(roots.venueDir, "venue.db"), { bigint: true });
  expect(unit!.entries[0]).toEqual({
    path: "venue.db",
    type: "file",
    ino: info.ino.toString(),
    size: "14",
    mtimeNs: info.mtimeNs.toString(),
  });
  expect(survey.digest).toBe(
    sha(JSON.stringify([survey.attemptId, survey.frozenDigest, survey.markerSha256, survey.units])),
  );
});

it("an unexpected -wal makes the marked venue.db and its side files one unit", async () => {
  const { roots } = await startAgainAttempt(await scratch(), {
    before: async ({ venueDir }) => writeFile(join(venueDir, "venue.db"), "attempt database"),
  });
  await writeFile(join(roots.venueDir, "venue.db-wal"), "pages written later");
  await writeFile(join(roots.venueDir, "venue.db-journal"), "a journal");
  const survey = choice(await surveyStartAgainLeftovers(roots));
  expect(survey.units).toHaveLength(1);
  expect(survey.units[0]).toMatchObject({ root: "venue", path: "venue.db", why: "changed" });
  expect(survey.units[0]!.pieces).toEqual(["venue.db-wal", "venue.db-journal", "venue.db"]);
});

it("a changed node.db is its own database unit beside a found venue.db", async () => {
  const { roots } = await startAgainAttempt(await scratch(), {
    before: async ({ venueDir }) => writeFile(join(venueDir, "node.db"), "attempt node"),
  });
  await writeFile(join(roots.venueDir, "node.db"), "a changed node");
  await writeFile(join(roots.venueDir, "venue.db"), "found database");
  const survey = choice(await surveyStartAgainLeftovers(roots));
  expect(survey.units.map((unit) => [unit.root, unit.path, unit.why, unit.pieces])).toEqual([
    ["venue", "node.db", "changed", ["node.db"]],
    ["venue", "venue.db", "not-created", ["venue.db"]],
  ]);
});

it("a refused-artifact folder is one unit with every entry under it", async () => {
  const { roots } = await startAgainAttempt(await scratch());
  await put(join(roots.venueDir, ".venue.db-litestream", "generations", "a.wal"), "one");
  await put(join(roots.venueDir, ".venue.db-litestream", "b.wal"), "two");
  const unit = unitAt(await surveyStartAgainLeftovers(roots), ".venue.db-litestream");
  expect(unit).toMatchObject({ root: "venue", why: "not-created" });
  expect(unit.pieces).toEqual([".venue.db-litestream"]);
  expect(unit.entries.map((entry) => [entry.path, entry.type, entry.size])).toEqual([
    [".venue.db-litestream", "folder", null],
    [".venue.db-litestream/b.wal", "file", "3"],
    [".venue.db-litestream/generations", "folder", null],
    [".venue.db-litestream/generations/a.wal", "file", "3"],
  ]);
  expect(unit.entries.filter((entry) => entry.type === "folder").map((e) => e.mtimeNs)).toEqual([
    null,
    null,
  ]);
});

it("an unlisted record folder is the unit, not its files", async () => {
  const { roots } = await startAgainAttempt(await scratch());
  const found = `${RECORDS}/${randomUUID()}`;
  await put(join(roots.stateDir, found, "record.json"), "{}");
  await put(join(roots.stateDir, found, "step-000001", "step.json"), "{}");
  const survey = choice(await surveyStartAgainLeftovers(roots));
  expect(survey.units.map((unit) => [unit.root, unit.path, unit.pieces])).toEqual([
    ["state", found, [found]],
  ]);
  expect(survey.units[0]!.entries.map((entry) => entry.path)).toEqual([
    found,
    `${found}/record.json`,
    `${found}/step-000001`,
    `${found}/step-000001/step.json`,
  ]);
});

it("an unlisted file inside a marked record folder is its own unit, and an unlisted step folder there is the unit", async () => {
  const marked = `${RECORDS}/${randomUUID()}`;
  const { roots } = await startAgainAttempt(await scratch(), {
    before: async ({ stateDir }) => {
      await put(join(stateDir, marked, "record.json"), "{}");
      await put(join(stateDir, marked, "step-000001", "step.json"), "{}");
    },
  });
  await writeFile(join(roots.stateDir, marked, "later.json"), "{}");
  await writeFile(join(roots.stateDir, marked, "step-000001", "later.json"), "{}");
  await put(join(roots.stateDir, marked, "step-000002", "found.json"), "{}");
  const survey = choice(await surveyStartAgainLeftovers(roots));
  expect(survey.units.map((unit) => [unit.path, unit.pieces])).toEqual([
    [`${marked}/later.json`, [`${marked}/later.json`]],
    [`${marked}/step-000001/later.json`, [`${marked}/step-000001/later.json`]],
    [`${marked}/step-000002`, [`${marked}/step-000002`]],
  ]);
});

async function withFoundDatabase(options: Parameters<typeof startAgainAttempt>[1] = {}) {
  const attempt = await startAgainAttempt(await scratch(), options);
  await writeFile(join(attempt.roots.venueDir, "venue.db"), "found database");
  return attempt.roots;
}

it("the setup record changed, or gone, explains instead", async () => {
  const changed = await withFoundDatabase();
  await writeFile(join(changed.stateDir, "first-setup.json"), "{}");
  expect(await surveyStartAgainLeftovers(changed)).toEqual({
    kind: "explain",
    reason: "setup record changed",
  });

  const gone = await withFoundDatabase();
  await rm(join(gone.stateDir, "first-setup.json"));
  expect(await surveyStartAgainLeftovers(gone)).toEqual({
    kind: "explain",
    reason: "setup record gone",
  });
});

it("a setup record parseFirstSetupState refuses explains", async () => {
  const roots = await withFoundDatabase({
    before: async ({ stateDir }) =>
      writeFile(join(stateDir, "first-setup.json"), JSON.stringify({ synthetic: "attempt" })),
  });
  expect(await surveyStartAgainLeftovers(roots)).toEqual({
    kind: "explain",
    reason: "setup record unparseable",
  });
});

it("a marker that does not name the setup record explains", async () => {
  const roots = await withFoundDatabase();
  const path = join(roots.venueDir, "first-setup-deleting.json");
  const marker = JSON.parse(await readFile(path, "utf8"));
  marker.files = marker.files.filter((file: { name: string }) => file.name !== "first-setup.json");
  await writeFile(path, JSON.stringify(marker));
  await rm(join(roots.stateDir, "first-setup.json"));
  await writeFile(join(roots.stateDir, "first-setup.json"), "{}");
  expect(await surveyStartAgainLeftovers(roots)).toEqual({
    kind: "explain",
    reason: "setup record not marked",
  });
});

it("a unit holding venue.lock explains", async () => {
  for (const name of [
    "venue.lock",
    "venue.lock-journal",
    "venue.holder.json",
    "migrations.lock",
    "recovery.lock",
  ]) {
    const { roots } = await startAgainAttempt(await scratch());
    await put(join(roots.stateDir, "first-setup-workspaces", "w1", "target", name), "");
    expect(await surveyStartAgainLeftovers(roots), name).toEqual({
      kind: "explain",
      reason: `unit holds a lock file: state/first-setup-workspaces/w1/target/${name}`,
    });
  }
});

it("a link explains, whether the finisher's walk or the survey's finds it", async () => {
  const walked = (await startAgainAttempt(await scratch())).roots;
  await mkdir(join(walked.stateDir, "first-fiscal-documents"));
  await symlink("/etc/hosts", join(walked.stateDir, "first-fiscal-documents", "link.json"));
  expect(await surveyStartAgainLeftovers(walked)).toMatchObject({
    kind: "explain",
    reason: expect.stringMatching(/^layout unexpected: .*first-fiscal-documents\/link\.json$/),
  });

  const surveyed = (await startAgainAttempt(await scratch())).roots;
  await mkdir(join(surveyed.venueDir, ".venue.db-litestream"));
  await symlink("/etc/hosts", join(surveyed.venueDir, ".venue.db-litestream", "link"));
  expect(await surveyStartAgainLeftovers(surveyed)).toEqual({
    kind: "explain",
    reason: "unit holds a link or special file: venue/.venue.db-litestream/link",
  });

  const side = (await startAgainAttempt(await scratch())).roots;
  await writeFile(join(side.venueDir, "venue.db"), "found database");
  await symlink("/etc/hosts", join(side.venueDir, "venue.db-shm"));
  expect(await surveyStartAgainLeftovers(side)).toEqual({
    kind: "explain",
    reason: "unit holds a link or special file: venue/venue.db-shm",
  });
});

it("more than START_AGAIN_ENTRY_LIMIT entries explains", async () => {
  const { roots } = await startAgainAttempt(await scratch());
  const folder = join(roots.venueDir, ".venue.db-litestream");
  await mkdir(folder);
  const names = Array.from({ length: START_AGAIN_ENTRY_LIMIT - 1 }, (_, index) => `f${index}`);
  for (let start = 0; start < names.length; start += 500)
    await Promise.all(
      names.slice(start, start + 500).map((name) => writeFile(join(folder, name), "")),
    );
  // The folder and its files are exactly the limit.
  expect((await surveyStartAgainLeftovers(roots))?.kind).toBe("choice");
  await writeFile(join(folder, "one-more"), "");
  expect(await surveyStartAgainLeftovers(roots)).toEqual({
    kind: "explain",
    reason: "too many entries",
  });
}, 60_000);

it("the digest changes when a listed file's bytes, a folder's contents or an inode change, and not when nothing changes", async () => {
  const { roots } = await startAgainAttempt(await scratch());
  const database = join(roots.venueDir, "venue.db");
  await writeFile(database, "found database");
  const old = new Date("2026-10-26T10:00:00Z");
  await utimes(database, old, old);
  await put(join(roots.venueDir, ".venue.db-litestream", "a.wal"), "one");
  const digest = async () => choice(await surveyStartAgainLeftovers(roots)).digest;

  const first = await digest();
  expect(await digest()).toBe(first);

  await writeFile(database, "FOUND DATABASE");
  const rewritten = await digest();
  expect(rewritten).not.toBe(first);

  await writeFile(join(roots.venueDir, ".venue.db-litestream", "b.wal"), "two");
  const added = await digest();
  expect(added).not.toBe(rewritten);

  const before = await stat(database);
  const replacement = join(roots.venueDir, "replacement");
  await writeFile(replacement, "FOUND DATABASE");
  await utimes(replacement, before.atime, before.mtime);
  await rename(replacement, database);
  expect(await digest()).not.toBe(added);
});

it("the inode alone changes the digest", async () => {
  const { roots } = await startAgainAttempt(await scratch());
  const database = join(roots.venueDir, "venue.db");
  await writeFile(database, "found database");
  const when = new Date("2026-10-26T10:00:00Z");
  await utimes(database, when, when);
  const first = choice(await surveyStartAgainLeftovers(roots));
  const replacement = join(roots.venueDir, "replacement");
  await writeFile(replacement, "found database");
  await utimes(replacement, when, when);
  await rename(replacement, database);
  const second = choice(await surveyStartAgainLeftovers(roots));
  expect(second.units[0]!.entries[0]!.mtimeNs).toBe(first.units[0]!.entries[0]!.mtimeNs);
  expect(second.units[0]!.entries[0]!.size).toBe(first.units[0]!.entries[0]!.size);
  expect(second.units[0]!.entries[0]!.ino).not.toBe(first.units[0]!.entries[0]!.ino);
  expect(second.digest).not.toBe(first.digest);
});

it("on a box with a note, the note floor is the newest moved file time plus 150 s, rounded up to the minute", async () => {
  expect(START_AGAIN_FLOOR_MARGIN_MS).toBe(150_000);
  const { roots } = await startAgainAttempt(await scratch(), {
    note: { floorMs: Date.parse("2026-10-26T00:00:00Z"), lastName: "AB123", module: "probe" },
  });
  const database = join(roots.venueDir, "venue.db");
  const wal = join(roots.venueDir, "venue.db-wal");
  await writeFile(database, "found database");
  await writeFile(wal, "found pages");
  const at = (iso: string) => new Date(iso);
  await utimes(database, at("2026-10-26T16:40:00Z"), at("2026-10-26T16:40:00Z"));
  await utimes(wal, at("2026-10-26T16:52:10Z"), at("2026-10-26T16:52:10Z"));
  const survey = choice(await surveyStartAgainLeftovers(roots));
  const expected = Date.parse("2026-10-26T16:55:00Z");
  expect(survey.noteFloorMs).toBe(expected);
  expect(startAgainSetAsideFloorMs(survey.units)).toBe(expected);

  await utimes(wal, at("2026-10-26T16:52:30Z"), at("2026-10-26T16:52:30Z"));
  expect(choice(await surveyStartAgainLeftovers(roots)).noteFloorMs).toBe(expected);

  await utimes(wal, at("2026-10-26T16:52:30.001Z"), at("2026-10-26T16:52:30.001Z"));
  expect(choice(await surveyStartAgainLeftovers(roots)).noteFloorMs).toBe(
    Date.parse("2026-10-26T16:56:00Z"),
  );
});

it("on a box with no note, the note floor is null even when a found file is dated hours ahead", async () => {
  const { roots } = await startAgainAttempt(await scratch());
  const database = join(roots.venueDir, "venue.db");
  await writeFile(database, "found database");
  const ahead = new Date(Date.now() + 5 * 60 * 60_000);
  await utimes(database, ahead, ahead);
  const survey = choice(await surveyStartAgainLeftovers(roots));
  expect(startAgainSetAsideFloorMs(survey.units)).toBeGreaterThan(ahead.getTime());
  expect(survey.noteFloorMs).toBeNull();
});

it("the note floor is null when no unit holds a file", async () => {
  const { roots } = await startAgainAttempt(await scratch());
  await mkdir(join(roots.stateDir, "first-setup-workspaces", "empty"), { recursive: true });
  const survey = choice(await surveyStartAgainLeftovers(roots));
  expect(survey.units.map((unit) => unit.path)).toEqual(["first-setup-workspaces"]);
  expect(survey.noteFloorMs).toBeNull();
  expect(startAgainSetAsideFloorMs([])).toBeNull();
});

it("no marker, no survey", async () => {
  const base = await scratch();
  await mkdir(join(base, "venue"));
  await mkdir(join(base, "state"));
  expect(
    await surveyStartAgainLeftovers({
      venueDir: join(base, "venue"),
      stateDir: join(base, "state"),
    }),
  ).toBeNull();
});

async function moveOut(roots: Roots, survey: StartAgainSurvey, aside: string) {
  for (const unit of choice(survey).units)
    for (const piece of unit.pieces) {
      const target = join(aside, unit.root, piece);
      await mkdir(dirname(target), { recursive: true });
      await rename(join(unit.root === "venue" ? roots.venueDir : roots.stateDir, piece), target);
    }
}

async function files(dir: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true }))
    if (entry.isFile()) result.push(join(entry.parentPath, entry.name).slice(dir.length + 1));
  return result.sort();
}

it("moving every unit by hand leaves the finisher nothing to refuse", async () => {
  const marked = `${RECORDS}/${randomUUID()}`;
  const { roots } = await startAgainAttempt(await scratch(), {
    before: async ({ venueDir, stateDir }) => {
      await writeFile(join(venueDir, "venue.db"), "attempt database");
      await writeFile(join(venueDir, "node.db"), "attempt node");
      await writeFile(join(stateDir, "first-setup-node-key.json"), "{}");
      await put(join(stateDir, marked, "record.json"), "{}");
    },
  });
  const found = `${RECORDS}/${randomUUID()}`;
  await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  await put(join(roots.venueDir, ".venue.db-litestream", "a.wal"), "one");
  await writeFile(join(roots.stateDir, "first-setup-node-key.json"), '{"changed":true}');
  await writeFile(join(roots.venueDir, "venue.db"), "a changed database");
  await writeFile(join(roots.venueDir, "venue.db-wal"), "pages");
  await writeFile(join(roots.venueDir, "venue.db-shm"), "index");
  await writeFile(join(roots.venueDir, "node.db-wal"), "node pages");
  await put(join(roots.stateDir, "first-fiscal-documents", "extra.json"), "{}");
  await writeFile(join(roots.stateDir, marked, "later.json"), "{}");
  await put(join(roots.stateDir, found, "step-000001", "step.json"), "{}");

  const survey = choice(await surveyStartAgainLeftovers(roots));
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  expect(survey.units.map((unit) => `${unit.root}/${unit.path}`)).toEqual([
    "state/first-fiscal-documents/extra.json",
    "state/first-setup-node-key.json",
    ...[`state/${marked}/later.json`, `state/${found}`].sort(order),
    "state/trading.env",
    "venue/.venue.db-litestream",
    "venue/node.db",
    "venue/venue.db",
  ]);
  const aside = await scratch();
  await moveOut(roots, survey, aside);
  const keep = await files(roots.stateDir);
  expect(keep).toContain("first-setup.json");

  await finishStartAgainDeletion(roots);

  expect(await files(roots.stateDir)).toEqual(
    keep.filter((name) => name !== "first-setup.json" && !name.startsWith(`${RECORDS}/`)),
  );
  expect(
    (await readdir(roots.venueDir)).filter((name) => !/^venue\.(lock|holder)/.test(name)),
  ).toEqual([]);
  expect(await files(aside)).toEqual(
    [
      "state/first-fiscal-documents/extra.json",
      "state/first-setup-node-key.json",
      `state/${found}/step-000001/step.json`,
      `state/${marked}/later.json`,
      "state/trading.env",
      "venue/.venue.db-litestream/a.wal",
      "venue/node.db",
      "venue/node.db-wal",
      "venue/venue.db",
      "venue/venue.db-shm",
      "venue/venue.db-wal",
    ].sort(),
  );
});

it("classifyStartAgainRefusal gives files_found with the finisher's reason, and gives the finisher's error back unchanged otherwise", async () => {
  const roots = await withFoundDatabase();
  const refused = await finishStartAgainDeletion(roots).then(
    () => null,
    (error: unknown) => error as AppError,
  );
  expect(refused).toBeInstanceOf(AppError);
  const classified = await classifyStartAgainRefusal(roots, refused!);
  expect(classified.error.code).toBe("setup.start_again_files_found");
  expect(classified.error.params).toEqual({});
  expect(classified.error.reason).toBe("unlisted file: venue/venue.db");
  expect(classified.survey).toEqual(await surveyStartAgainLeftovers(roots));

  const explained = await withFoundDatabase();
  await writeFile(join(explained.stateDir, "first-setup.json"), "{}");
  const unchanged = await finishStartAgainDeletion(explained).then(
    () => null,
    (error: unknown) => error as AppError,
  );
  expect(unchanged).toBeInstanceOf(AppError);
  const back = await classifyStartAgainRefusal(explained, unchanged!);
  expect(back.error).toBe(unchanged);
  expect(back.survey).toBeUndefined();

  const other = new AppError("setup.not_ready", {}, { reason: "something else" });
  const otherBack = await classifyStartAgainRefusal(roots, other);
  expect(otherBack.error).toBe(other);
  expect(otherBack.survey).toBeUndefined();

  const unreadable = await withFoundDatabase();
  await writeFile(join(unreadable.venueDir, "first-setup-deleting.json"), "not json");
  const damaged = new AppError("setup.start_again_incomplete", {}, { reason: "marker damaged" });
  const damagedBack = await classifyStartAgainRefusal(unreadable, damaged);
  expect(damagedBack.error).toBe(damaged);
  expect(damagedBack.survey).toBeUndefined();
});

it("a marker naming another attempt or another frozen request than the setup record explains", async () => {
  for (const field of ["attemptId", "frozenDigest"] as const) {
    const roots = await withFoundDatabase();
    const path = join(roots.venueDir, "first-setup-deleting.json");
    const marker = JSON.parse(await readFile(path, "utf8"));
    marker[field] = field === "attemptId" ? randomUUID() : sha("another request");
    await writeFile(path, JSON.stringify(marker));
    expect(await surveyStartAgainLeftovers(roots), field).toEqual({
      kind: "explain",
      reason: "setup record names another attempt",
    });
  }
});

it.skipIf(process.getuid?.() === 0)(
  "a found folder the box cannot look inside explains, and the refusal is given back unchanged",
  async () => {
    const roots = await withFoundDatabase();
    const folder = join(roots.venueDir, ".venue.db-litestream");
    await put(join(folder, "a.wal"), "one");
    await chmod(folder, 0o600);
    try {
      expect(await surveyStartAgainLeftovers(roots)).toEqual({
        kind: "explain",
        reason: `check failed: EACCES ${join(folder, "a.wal")}`,
      });
      const refused = new AppError(
        "setup.start_again_incomplete",
        {},
        { reason: "refused artifact present: venue/.venue.db-litestream" },
      );
      expect((await classifyStartAgainRefusal(roots, refused)).error).toBe(refused);
    } finally {
      await chmod(folder, 0o700);
    }
  },
);

it("a refusal without a reason classifies without one", async () => {
  const roots = await withFoundDatabase();
  const classified = await classifyStartAgainRefusal(
    roots,
    new AppError("setup.start_again_incomplete", {}),
  );
  expect(classified.error.code).toBe("setup.start_again_files_found");
  expect(classified.error.reason).toBeUndefined();
  expect(classified.survey?.kind).toBe("choice");
});

it.skipIf(process.getuid?.() === 0)(
  "a refusal with nothing found explains, and the refusal is given back unchanged",
  async () => {
    const { roots } = await startAgainAttempt(await scratch(), {
      before: async ({ stateDir }) =>
        put(join(stateDir, "first-fiscal-documents", "doc.json"), "{}"),
    });
    const folder = join(roots.stateDir, "first-fiscal-documents");
    await chmod(folder, 0o555);
    try {
      const refused = await finishStartAgainDeletion(roots).then(
        () => null,
        (error: unknown) => error as AppError,
      );
      expect(refused).toBeInstanceOf(AppError);
      expect(refused!.code).toBe("setup.start_again_incomplete");
      expect(refused!.reason).toMatch(/^deletion failed: EACCES /);
      expect(await surveyStartAgainLeftovers(roots)).toEqual({
        kind: "explain",
        reason: "nothing found",
      });
      const back = await classifyStartAgainRefusal(roots, refused!);
      expect(back.error).toBe(refused);
      expect(back.survey).toBeUndefined();
    } finally {
      await chmod(folder, 0o755);
    }
  },
);

it("an entry under a unit that cannot be found when looked at explains instead of being skipped", async () => {
  const { roots } = await startAgainAttempt(await scratch());
  const folder = join(roots.venueDir, ".venue.db-litestream");
  await put(join(folder, "a.wal"), "one");
  await put(join(folder, "b.wal"), "two");
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.lstat).mockImplementation((async (...args: Parameters<typeof actual.lstat>) => {
    if (String(args[0]) === join(folder, "b.wal"))
      throw Object.assign(new Error("ENOENT: no such file or directory"), {
        code: "ENOENT",
        path: String(args[0]),
      });
    return actual.lstat(...args);
  }) as typeof fs.lstat);
  try {
    expect(await surveyStartAgainLeftovers(roots)).toEqual({
      kind: "explain",
      reason: "unit entry not found: venue/.venue.db-litestream/b.wal",
    });
  } finally {
    vi.mocked(fs.lstat).mockReset();
  }
});

it("a -wal with no main file makes a not-created database unit", async () => {
  const { roots } = await startAgainAttempt(await scratch());
  await writeFile(join(roots.venueDir, "venue.db-wal"), "pages with no database");
  const survey = choice(await surveyStartAgainLeftovers(roots));
  expect(survey.units.map((unit) => [unit.root, unit.path, unit.why, unit.pieces])).toEqual([
    ["venue", "venue.db", "not-created", ["venue.db-wal"]],
  ]);
});
