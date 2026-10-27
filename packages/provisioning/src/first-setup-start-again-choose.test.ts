import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fsPromises from "node:fs/promises";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  START_AGAIN_ADMIN,
  START_AGAIN_ADMIN_PASSWORD,
  startAgainAttempt,
  type StartAgainAttempt,
} from "../test/start-again-attempt.js";
import {
  readStartAgainChoices,
  START_AGAIN_CHOICES_DIR,
  writeStartAgainChoice,
} from "./first-setup-start-again-choice.js";
import { chooseStartAgainLeftovers, rootRelativePath } from "./first-setup-start-again-choose.js";
import { START_AGAIN_GUESSES_FILE } from "./first-setup-start-again-guesses.js";
import {
  START_AGAIN_CONFIRMATIONS_DIR,
  writeStartAgainConfirmation,
} from "./first-setup-start-again-confirmation.js";
import { surveyStartAgainLeftovers } from "./first-setup-start-again-leftovers.js";
import { START_AGAIN_SET_ASIDE_DIR } from "./first-setup-start-again-names.js";
import { readStartAgainNote } from "./first-setup-start-again-note.js";
import type { SetAsideIo } from "./first-setup-start-again-set-aside.js";

/** Runs once after the next survey, standing in for a change between the survey and what follows. */
let afterSurvey: (() => Promise<void>) | undefined;
vi.mock("./first-setup-start-again-leftovers.js", async (original) => {
  const real = await original<typeof import("./first-setup-start-again-leftovers.js")>();
  return {
    ...real,
    surveyStartAgainLeftovers: async (
      roots: Parameters<typeof real.surveyStartAgainLeftovers>[0],
    ) => {
      const survey = await real.surveyStartAgainLeftovers(roots);
      const hook = afterSurvey;
      afterSurvey = undefined;
      await hook?.();
      return survey;
    },
  };
});

/**
 * `write`: the next note raise writes through a folder that refuses to open its temporary file;
 * `throw`: it rejects with a plain error instead, as no current step after the record does.
 */
let failNoteWrite: false | "write" | "throw" | "throwAt" = false;
vi.mock("./first-setup-start-again-note.js", async (original) => {
  const real = await original<typeof import("./first-setup-start-again-note.js")>();
  return {
    ...real,
    raiseStartAgainNote: (...args: Parameters<typeof real.raiseStartAgainNote>) => {
      const mode = failNoteWrite;
      failNoteWrite = false;
      if (mode === false) return real.raiseStartAgainNote(...args);
      if (mode === "throw") return Promise.reject(Object.assign(new Error("EIO"), { code: "EIO" }));
      if (mode === "throwAt")
        return Promise.reject(
          Object.assign(new Error("EIO"), { code: "EIO", path: join(args[0], "note", "x.json") }),
        );
      const [stateDir, next] = args;
      return real.raiseStartAgainNote(stateDir, next, {
        ...fsPromises,
        open: () => Promise.reject(Object.assign(new Error("EIO"), { code: "EIO" })),
      });
    },
  };
});

const children: ChildProcess[] = [];
const dirs: string[] = [];
async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "start-again-choose-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  afterSurvey = undefined;
  failNoteWrite = false;
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const T0 = Date.parse("2026-10-26T10:00:00.000Z");
const MINUTE = 60_000;
const WRONG = "not-the-password";
// Taking a venue lock makes venue.lock if it is absent, and writes the other two, which its
// release deletes, whoever asks for the lock.
const LOCK_OWNED = /^(venue\.lock|venue\.holder\.json|venue\.lock-journal)$/;

/** A Start again a cut left, with a venue.db the box did not create: a survey of kind `choice`. */
async function found(
  options: Parameters<typeof startAgainAttempt>[1] = {},
): Promise<StartAgainAttempt & { listed: string }> {
  const attempt = await startAgainAttempt(await scratch(), options);
  await writeFile(join(attempt.roots.venueDir, "venue.db"), "found database");
  const survey = await surveyStartAgainLeftovers(attempt.roots);
  if (survey?.kind !== "choice") throw new Error(`expected choice, got ${JSON.stringify(survey)}`);
  return { ...attempt, listed: survey.digest };
}

/** Bytes, inode, size and time of everything under both folders, the counter left out. */
async function folders(roots: StartAgainAttempt["roots"]) {
  const out: Record<string, string> = {};
  const visit = async (root: string, relative: string) => {
    for (const name of (await readdir(join(root, relative))).sort()) {
      if (relative === "" && root === roots.venueDir && LOCK_OWNED.test(name)) continue;
      if (relative === "" && root === roots.stateDir && name === START_AGAIN_GUESSES_FILE) continue;
      const path = relative === "" ? name : `${relative}/${name}`;
      const info = await lstat(join(root, path), { bigint: true });
      if (info.isDirectory()) {
        out[`${root}:${path}`] = `folder ${info.ino}`;
        await visit(root, path);
      } else
        out[`${root}:${path}`] =
          `${info.ino} ${info.size} ${info.mtimeNs} ` +
          createHash("sha256")
            .update(await readFile(join(root, path)))
            .digest("hex");
    }
  };
  await visit(roots.venueDir, "");
  await visit(roots.stateDir, "");
  return out;
}

const counter = async (stateDir: string) =>
  JSON.parse(await readFile(join(stateDir, START_AGAIN_GUESSES_FILE), "utf8")) as {
    failures: number;
    waitUntil: string | null;
  };
const counterExists = (stateDir: string) =>
  lstat(join(stateDir, START_AGAIN_GUESSES_FILE)).then(
    () => true,
    () => false,
  );

const HOLD = `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1]);
db.exec("pragma busy_timeout = 0");
db.exec("begin immediate");
process.stdout.write("held");
setInterval(() => db, 1000);`;

function holdFromAnotherProcess(directory: string): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", HOLD, join(directory, "venue.lock")],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(child);
  return new Promise((resolve, reject) => {
    let err = "";
    child.stderr!.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.stdout!.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("held")) resolve(child);
    });
    child.on("exit", (code) => reject(new Error(`holder exited early (${code}): ${err}`)));
  });
}

async function keepRecord(f: StartAgainAttempt) {
  const survey = await surveyStartAgainLeftovers(f.roots);
  if (survey?.kind !== "choice") throw new Error("expected choice");
  await writeStartAgainChoice(f.roots.stateDir, {
    at: new Date(T0 - MINUTE).toISOString(),
    attemptId: survey.attemptId,
    frozenDigest: survey.frozenDigest,
    markerSha256: survey.markerSha256,
    choice: "keep",
    administrator: { administratorId: f.administratorId, ...START_AGAIN_ADMIN },
    ownerGeneration: 1,
    listed: { digest: survey.digest, units: survey.units },
    setAside: null,
    noteFloorMs: null,
  });
}

it("a wrong password is refused setup.owner_required, counted, and changes no file of either folder except the counter", async () => {
  const f = await found();
  const before = await folders(f.roots);
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: WRONG,
      choice: "move",
      listed: f.listed,
      now: () => new Date(T0),
    }),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(await counter(f.roots.stateDir)).toMatchObject({ failures: 1, waitUntil: null });
  expect(await folders(f.roots)).toEqual(before);
});

it("the sixth wrong password makes the next try wait, and a new call — a restart — still waits", async () => {
  const f = await found();
  const verify = vi.fn(async () => false);
  const tryAt = (call: typeof chooseStartAgainLeftovers, ms: number) =>
    call({
      roots: f.roots,
      password: WRONG,
      choice: "keep",
      listed: f.listed,
      now: () => new Date(T0 + ms),
      verify,
    });
  for (let n = 1; n <= 6; n += 1)
    await expect(tryAt(chooseStartAgainLeftovers, n)).rejects.toMatchObject({
      code: "setup.owner_required",
    });
  await expect(tryAt(chooseStartAgainLeftovers, 10)).rejects.toMatchObject({
    code: "password.throttled",
  });
  vi.resetModules();
  const restarted = (await import("./first-setup-start-again-choose.js")).chooseStartAgainLeftovers;
  expect(restarted).not.toBe(chooseStartAgainLeftovers);
  await expect(tryAt(restarted, 20)).rejects.toMatchObject({
    code: "password.throttled",
    params: { retryAfterSeconds: 60 },
  });
  expect(verify).toHaveBeenCalledTimes(6);
});

it("a digest from an older page is refused setup.start_again_files_changed and costs no guess", async () => {
  const f = await found();
  const verify = vi.fn(async () => true);
  await writeFile(join(f.roots.venueDir, "venue.db"), "other bytes, a later write");
  const before = await folders(f.roots);
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: START_AGAIN_ADMIN_PASSWORD,
      choice: "move",
      listed: f.listed,
      now: () => new Date(T0),
      verify,
    }),
  ).rejects.toMatchObject({ code: "setup.start_again_files_changed" });
  expect(verify).not.toHaveBeenCalled();
  expect(await counterExists(f.roots.stateDir)).toBe(false);
  expect(await folders(f.roots)).toEqual(before);
});

it("a guess counter that cannot be written refuses setup.attempt_invalid before the password is checked, and records and moves nothing", async () => {
  const f = await found();
  // A folder where the counter file goes: the counter writer refuses to write over it.
  await mkdir(join(f.roots.stateDir, START_AGAIN_GUESSES_FILE));
  const verify = vi.fn(async () => true);
  const before = await folders(f.roots);
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: START_AGAIN_ADMIN_PASSWORD,
      choice: "move",
      listed: f.listed,
      now: () => new Date(T0),
      verify,
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(verify).not.toHaveBeenCalled();
  await expect(lstat(join(f.roots.stateDir, START_AGAIN_CHOICES_DIR))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(lstat(join(f.roots.stateDir, START_AGAIN_SET_ASIDE_DIR))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(lstat(join(f.roots.venueDir, START_AGAIN_SET_ASIDE_DIR))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe("found database");
  expect(await folders(f.roots)).toEqual(before);
});

it("files changed between the password and the lock: refused, nothing changed", async () => {
  const f = await found();
  let after: Record<string, string> | undefined;
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: START_AGAIN_ADMIN_PASSWORD,
      choice: "move",
      listed: f.listed,
      now: () => new Date(T0),
      verify: async () => {
        await writeFile(join(f.roots.venueDir, "venue.db"), "other bytes, longer than before");
        after = await folders(f.roots);
        return true;
      },
    }),
  ).rejects.toMatchObject({ code: "setup.start_again_files_changed" });
  expect(await folders(f.roots)).toEqual(after);
});

it("a correct password sets the counter back to 0", async () => {
  const f = await found();
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: WRONG,
      choice: "move",
      listed: f.listed,
      now: () => new Date(T0),
    }),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  await chooseStartAgainLeftovers({
    roots: f.roots,
    password: START_AGAIN_ADMIN_PASSWORD,
    choice: "keep",
    listed: f.listed,
    now: () => new Date(T0 + 1),
  }).catch(() => undefined);
  expect(await counter(f.roots.stateDir)).toMatchObject({ failures: 0, waitUntil: null });
});

it("checks the password against the setup record's own verifier", async () => {
  const f = await found();
  const verify = vi.fn(async () => false);
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: "typed",
      choice: "move",
      listed: f.listed,
      now: () => new Date(T0),
      verify,
    }),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  const record = JSON.parse(await readFile(join(f.roots.stateDir, "first-setup.json"), "utf8"));
  expect(verify).toHaveBeenCalledWith("typed", record.ownerVerifier);
});

it("a box whose setup record changed refuses setup.not_ready", async () => {
  const f = await found();
  const path = join(f.roots.stateDir, "first-setup.json");
  await writeFile(path, `${await readFile(path, "utf8")} `);
  const verify = vi.fn(async () => true);
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: START_AGAIN_ADMIN_PASSWORD,
      choice: "move",
      listed: f.listed,
      now: () => new Date(T0),
      verify,
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(verify).not.toHaveBeenCalled();
  expect(await counterExists(f.roots.stateDir)).toBe(false);
});

it("a setup record changed after the survey refuses setup.not_ready and costs no guess", async () => {
  const f = await found();
  const path = join(f.roots.stateDir, "first-setup.json");
  const verify = vi.fn(async () => true);
  afterSurvey = async () => writeFile(path, "{}");
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: START_AGAIN_ADMIN_PASSWORD,
      choice: "move",
      listed: f.listed,
      now: () => new Date(T0),
      verify,
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(verify).not.toHaveBeenCalled();
  expect(await counterExists(f.roots.stateDir)).toBe(false);
});

it("a setup record for another attempt, written after the survey, refuses setup.not_ready", async () => {
  const f = await found();
  const other = await startAgainAttempt(await scratch());
  const record = JSON.parse(
    await readFile(join(other.roots.stateDir, "first-setup.json"), "utf8"),
  ) as Record<string, unknown>;
  const verify = vi.fn(async () => true);
  afterSurvey = async () =>
    writeFile(
      join(f.roots.stateDir, "first-setup.json"),
      JSON.stringify({ ...record, venueDir: f.roots.venueDir, stateDir: f.roots.stateDir }),
    );
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: START_AGAIN_ADMIN_PASSWORD,
      choice: "move",
      listed: f.listed,
      now: () => new Date(T0),
      verify,
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(verify).not.toHaveBeenCalled();
  expect(await counterExists(f.roots.stateDir)).toBe(false);
});

it("a box with no Start again marker refuses setup.not_ready", async () => {
  const f = await found();
  await rm(join(f.roots.venueDir, "first-setup-deleting.json"));
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: START_AGAIN_ADMIN_PASSWORD,
      choice: "move",
      listed: f.listed,
      now: () => new Date(T0),
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
});

it("a kept box refuses setup.start_again_kept and costs no guess", async () => {
  const f = await found();
  await keepRecord(f);
  const verify = vi.fn(async () => true);
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: START_AGAIN_ADMIN_PASSWORD,
      choice: "move",
      listed: f.listed,
      now: () => new Date(T0),
      verify,
    }),
  ).rejects.toMatchObject({ code: "setup.start_again_kept" });
  expect(verify).not.toHaveBeenCalled();
  expect(await counterExists(f.roots.stateDir)).toBe(false);
});

it("a Keep recorded between the password and the lock refuses setup.start_again_kept, nothing changed", async () => {
  const f = await found();
  let after: Record<string, string> | undefined;
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: START_AGAIN_ADMIN_PASSWORD,
      choice: "move",
      listed: f.listed,
      now: () => new Date(T0),
      verify: async () => {
        await keepRecord(f);
        after = await folders(f.roots);
        return true;
      },
    }),
  ).rejects.toMatchObject({ code: "setup.start_again_kept" });
  expect(await folders(f.roots)).toEqual(after);
});

it("another process holding the venue folder refuses provisioning.database_in_use, nothing changed", async () => {
  const f = await found();
  await holdFromAnotherProcess(f.roots.venueDir);
  const before = await folders(f.roots);
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: START_AGAIN_ADMIN_PASSWORD,
      choice: "move",
      listed: f.listed,
      now: () => new Date(T0),
    }),
  ).rejects.toMatchObject({ code: "provisioning.database_in_use" });
  expect(await folders(f.roots)).toEqual(before);
});

it("two tries sent at once are counted one after the other", async () => {
  const f = await found();
  let checking = 0;
  let overlapped = false;
  const order: string[] = [];
  const verify = async (password: string) => {
    order.push(password);
    checking += 1;
    if (checking > 1) overlapped = true;
    await new Promise((resolve) => setTimeout(resolve, 20));
    checking -= 1;
    return password === START_AGAIN_ADMIN_PASSWORD;
  };
  const send = (password: string) =>
    chooseStartAgainLeftovers({
      roots: f.roots,
      password,
      choice: "keep",
      listed: f.listed,
      now: () => new Date(T0),
      verify,
    });
  const [right, wrong] = await Promise.allSettled([send(START_AGAIN_ADMIN_PASSWORD), send(WRONG)]);
  expect(right).toEqual({ status: "fulfilled", value: { choice: "keep" } });
  expect(overlapped).toBe(false);
  // Either may go first. A wrong try that went first is counted and then reset by the correct
  // one; one that came after the Keep is refused as kept before its guess is counted.
  if (order[0] === WRONG) {
    expect(order).toEqual([WRONG, START_AGAIN_ADMIN_PASSWORD]);
    expect(wrong).toMatchObject({ status: "rejected", reason: { code: "setup.owner_required" } });
  } else {
    expect(order).toEqual([START_AGAIN_ADMIN_PASSWORD]);
    expect(wrong).toMatchObject({ status: "rejected", reason: { code: "setup.start_again_kept" } });
  }
  expect(await counter(f.roots.stateDir)).toMatchObject({ failures: 0, waitUntil: null });
});

const PROBE = ".first-setup-set-aside-probe-";
const realIo: SetAsideIo = { lstat, mkdir, rmdir, rename };
const errno = (code: string) => Object.assign(new Error(code), { code });
const choose = (
  f: StartAgainAttempt & { listed: string },
  choice: "keep" | "move",
  options: { io?: SetAsideIo; password?: string } = {},
) =>
  chooseStartAgainLeftovers({
    roots: f.roots,
    password: options.password ?? START_AGAIN_ADMIN_PASSWORD,
    choice,
    listed: f.listed,
    now: () => new Date(T0),
    ...(options.io && { io: options.io }),
  });
const choiceSurvey = async (f: StartAgainAttempt) => {
  const survey = await surveyStartAgainLeftovers(f.roots);
  if (survey?.kind !== "choice") throw new Error("expected choice");
  return survey;
};
const recordsOf = async (f: StartAgainAttempt) =>
  readStartAgainChoices(f.roots.stateDir, {
    attemptId: f.attemptId,
    frozenDigest: f.frozenDigest,
  });
const withoutChoices = (snapshot: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => !key.includes(`:${START_AGAIN_CHOICES_DIR}`)),
  );
const absent = (path: string) => expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });

it("Keep writes one record with who, when, what and which files, and moves nothing", async () => {
  const f = await found();
  const survey = await choiceSurvey(f);
  const before = await folders(f.roots);
  const state = JSON.parse(await readFile(join(f.roots.stateDir, "first-setup.json"), "utf8"));

  expect(await choose(f, "keep")).toEqual({ choice: "keep" });

  const records = await recordsOf(f);
  expect(records).toEqual([
    {
      version: 1,
      at: new Date(T0).toISOString(),
      attemptId: f.attemptId.toLowerCase(),
      frozenDigest: f.frozenDigest,
      markerSha256: survey.markerSha256,
      choice: "keep",
      administrator: { administratorId: f.administratorId, ...START_AGAIN_ADMIN },
      ownerGeneration: state.ownerGeneration,
      listed: { digest: survey.digest, units: survey.units },
      setAside: null,
      noteFloorMs: null,
    },
  ]);
  const after = await folders(f.roots);
  expect(withoutChoices(after)).toEqual(before);
  expect(
    Object.keys(after).filter((key) => key.includes(`:${START_AGAIN_CHOICES_DIR}`)),
  ).toHaveLength(2);
});

it("after Keep, a later Move is refused setup.start_again_kept and moves nothing", async () => {
  const f = await found();
  await choose(f, "keep");
  const before = await folders(f.roots);
  await expect(choose(f, "move")).rejects.toMatchObject({ code: "setup.start_again_kept" });
  expect(await folders(f.roots)).toEqual(before);
  expect((await recordsOf(f)).map((record) => record.choice)).toEqual(["keep"]);
});

it("Move writes the record before the first rename, and raises the note to the moved files' floor before it", async () => {
  const f = await found({
    note: { floorMs: T0 - 60 * MINUTE, lastName: "AB123", module: "probe" },
  });
  const survey = await choiceSurvey(f);
  expect(survey.noteFloorMs).not.toBeNull();
  expect(survey.noteFloorMs!).toBeGreaterThan(T0 - 60 * MINUTE);
  const seen: { records: string[]; note: unknown }[] = [];
  const io: SetAsideIo = {
    ...realIo,
    rename: async (from, to) => {
      if (!from.includes(PROBE) && seen.length === 0)
        seen.push({
          records: await readdir(join(f.roots.stateDir, START_AGAIN_CHOICES_DIR)),
          note: await readStartAgainNote(f.roots.stateDir),
        });
      await rename(from, to);
    },
  };

  await choose(f, "move", { io });

  expect(seen).toHaveLength(1);
  expect(seen[0]!.records).toHaveLength(1);
  expect(seen[0]!.note).toEqual({
    version: 1,
    floorMs: survey.noteFloorMs,
    lastName: "AB123",
    module: "probe",
  });
  const [record] = await recordsOf(f);
  expect(record).toMatchObject({ choice: "move", noteFloorMs: survey.noteFloorMs });
});

it("Move then finishes Start again: the marker and the marked files are gone, the moved files are at the destination unchanged, and A1042's confirmation records are byte-identical", async () => {
  const f = await found();
  await writeStartAgainConfirmation(f.roots.stateDir, {
    at: new Date(T0 - 2 * MINUTE).toISOString(),
    attemptId: f.attemptId,
    database: "missing",
    administrator: { ...START_AGAIN_ADMIN },
    ownerGeneration: 1,
    shown: { reached: "claimed", lastName: null },
  });
  const confirmations = join(f.roots.stateDir, START_AGAIN_CONFIRMATIONS_DIR);
  const confirmationBytes = async () =>
    Promise.all(
      (await readdir(confirmations)).sort().map(async (name) => ({
        name,
        bytes: (await readFile(join(confirmations, name))).toString("base64"),
      })),
    );
  const confirmed = await confirmationBytes();
  const moved = await lstat(join(f.roots.venueDir, "venue.db"), { bigint: true });

  const result = await choose(f, "move");

  const [record] = await recordsOf(f);
  expect(result).toEqual({ choice: "move", setAside: record!.setAside });
  await absent(join(f.roots.venueDir, "first-setup-deleting.json"));
  await absent(join(f.roots.venueDir, "first-setup-claim.json"));
  await absent(join(f.roots.stateDir, "first-setup.json"));
  await absent(join(f.roots.venueDir, "venue.db"));
  const at = join(f.roots.stateDir, record!.setAside!.venue, "venue.db");
  const there = await lstat(at, { bigint: true });
  expect([there.ino, there.size, there.mtimeNs]).toEqual([moved.ino, moved.size, moved.mtimeNs]);
  expect(await readFile(at, "utf8")).toBe("found database");
  expect(await confirmationBytes()).toEqual(confirmed);
  expect(confirmed).toHaveLength(1);
});

it("another mount point: the probe refuses setup.start_again_set_aside_unavailable, no record is written, and a Keep after it succeeds", async () => {
  const f = await found();
  const before = await folders(f.roots);
  const io: SetAsideIo = {
    ...realIo,
    rename: async (from, to) => {
      if (from.includes(PROBE)) throw errno("EXDEV");
      await rename(from, to);
    },
  };
  await expect(choose(f, "move", { io })).rejects.toMatchObject({
    code: "setup.start_again_set_aside_unavailable",
  });
  expect(await recordsOf(f)).toEqual([]);
  expect(await folders(f.roots)).toEqual(before);

  expect(await choose(f, "keep")).toEqual({ choice: "keep" });
  expect((await recordsOf(f)).map((record) => record.choice)).toEqual(["keep"]);
});

it("a record that cannot be written refuses setup.attempt_invalid and moves nothing", async () => {
  const f = await found();
  const elsewhere = await scratch();
  // A folder the record writer refuses to write through: a link in place of the choices folder.
  await symlink(elsewhere, join(f.roots.stateDir, START_AGAIN_CHOICES_DIR));
  const source = await lstat(join(f.roots.venueDir, "venue.db"), { bigint: true });
  const renamed: string[] = [];
  const io: SetAsideIo = {
    ...realIo,
    rename: async (from, to) => {
      if (!from.includes(PROBE)) renamed.push(from);
      await rename(from, to);
    },
  };

  await expect(choose(f, "move", { io })).rejects.toMatchObject({ code: "setup.attempt_invalid" });

  expect(renamed).toEqual([]);
  expect(await readdir(elsewhere)).toEqual([]);
  const still = await lstat(join(f.roots.venueDir, "venue.db"), { bigint: true });
  expect([still.ino, still.size, still.mtimeNs]).toEqual([source.ino, source.size, source.mtimeNs]);
  expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe("found database");
  await expect(lstat(join(f.roots.venueDir, "first-setup-deleting.json"))).resolves.toBeDefined();
});

it("a record that cannot be written after the set-aside folders were made removes those empty folders and changes nothing else", async () => {
  const f = await found();
  const before = await folders(f.roots);
  const elsewhere = await scratch();
  const choicesLink = join(f.roots.stateDir, START_AGAIN_CHOICES_DIR);
  await symlink(elsewhere, choicesLink);

  await expect(choose(f, "move")).rejects.toMatchObject({ code: "setup.attempt_invalid" });

  await unlink(choicesLink);
  await absent(join(f.roots.stateDir, START_AGAIN_SET_ASIDE_DIR));
  await absent(join(f.roots.venueDir, START_AGAIN_SET_ASIDE_DIR));
  expect(await readdir(elsewhere)).toEqual([]);
  expect(await folders(f.roots)).toEqual(before);
});

it.each([
  ["symlink", (path: string, elsewhere: string) => symlink(elsewhere, path)],
  ["file", (path: string) => writeFile(path, "not a folder")],
] as const)(
  "a %s at the state folder's set-aside name refuses the Move setup.start_again_set_aside_unavailable, writes no record and moves nothing; a Keep after it succeeds",
  async (kind, place) => {
    const f = await found();
    const before = await folders(f.roots);
    const elsewhere = await scratch();
    const placed = join(f.roots.stateDir, START_AGAIN_SET_ASIDE_DIR);
    await place(placed, elsewhere);

    await expect(choose(f, "move")).rejects.toMatchObject({
      code: "setup.start_again_set_aside_unavailable",
      reason: `set-aside failed: ${kind} state/${START_AGAIN_SET_ASIDE_DIR}`,
    });

    expect(await recordsOf(f)).toEqual([]);
    expect(await readdir(elsewhere)).toEqual([]);
    expect(await choose(f, "keep")).toEqual({ choice: "keep" });
    // The link goes before the snapshot, which cannot read through it; the Keep added only its record.
    await unlink(placed);
    expect(withoutChoices(await folders(f.roots))).toEqual(withoutChoices(before));
  },
);

it("an empty set-aside folder that was there before the Move survives a failed record write", async () => {
  const f = await found();
  const base = join(f.roots.stateDir, START_AGAIN_SET_ASIDE_DIR);
  await mkdir(base);
  const before = await folders(f.roots);
  const choicesLink = join(f.roots.stateDir, START_AGAIN_CHOICES_DIR);
  await symlink(await scratch(), choicesLink);

  await expect(choose(f, "move")).rejects.toMatchObject({ code: "setup.attempt_invalid" });

  await unlink(choicesLink);
  expect(await folders(f.roots)).toEqual(before);
  expect((await lstat(base)).isDirectory()).toBe(true);
});

it("a set-aside folder holding another stem's folder keeps it after a failed record write", async () => {
  const f = await found();
  const other = join(f.roots.stateDir, START_AGAIN_SET_ASIDE_DIR, "1761472800000-other");
  await mkdir(other, { recursive: true });
  const before = await folders(f.roots);
  const choicesLink = join(f.roots.stateDir, START_AGAIN_CHOICES_DIR);
  await symlink(await scratch(), choicesLink);

  await expect(choose(f, "move")).rejects.toMatchObject({ code: "setup.attempt_invalid" });

  await unlink(choicesLink);
  expect(await folders(f.roots)).toEqual(before);
});

it("a set-aside folder that cannot be removed after a failed record write stays, and the record's refusal is the one answered", async () => {
  const f = await found();
  const choicesLink = join(f.roots.stateDir, START_AGAIN_CHOICES_DIR);
  await symlink(await scratch(), choicesLink);
  const refused: string[] = [];
  const io: SetAsideIo = {
    ...realIo,
    rmdir: async (path) => {
      if (!path.toString().includes(PROBE)) {
        refused.push(path.toString());
        throw errno("EBUSY");
      }
      await rmdir(path);
    },
  };

  await expect(choose(f, "move", { io })).rejects.toMatchObject({ code: "setup.attempt_invalid" });

  expect(refused.length).toBeGreaterThan(0);
  for (const path of refused) expect((await lstat(path)).isDirectory()).toBe(true);
});

it("a Move whose second rename fails after its record is written is refused setup.start_again_move_unfinished, keeping the rename's cause, with the record in place", async () => {
  const base = await found();
  await writeFile(join(base.roots.venueDir, "venue.db-wal"), "found pages");
  const f = { ...base, listed: (await choiceSurvey(base)).digest };
  let renames = 0;
  const io: SetAsideIo = {
    ...realIo,
    rename: async (from, to) => {
      if (!from.includes(PROBE) && ++renames === 2) throw errno("EIO");
      await rename(from, to);
    },
  };

  await expect(choose(f, "move", { io })).rejects.toMatchObject({
    code: "setup.start_again_move_unfinished",
    reason: "set-aside failed: EIO venue/venue.db",
  });

  expect((await recordsOf(f)).map((record) => record.choice)).toEqual(["move"]);
  await absent(join(f.roots.venueDir, "venue.db-wal"));
  expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe("found database");
});

it("a Move whose finisher refuses after every piece moved is refused setup.start_again_move_unfinished, keeping the finisher's cause", async () => {
  const f = await found();
  const io: SetAsideIo = {
    ...realIo,
    rename: async (from, to) => {
      await rename(from, to);
      // A side file the finisher did not expect, appearing once the only piece is aside.
      if (!from.includes(PROBE)) await writeFile(join(f.roots.venueDir, "venue.db-wal"), "late");
    },
  };

  const refused = await choose(f, "move", { io }).then(
    () => null,
    (error: unknown) => error as { code?: string; reason?: string },
  );

  expect(refused).toMatchObject({ code: "setup.start_again_move_unfinished" });
  expect(refused?.reason).toContain("venue.db-wal");
  const [record] = await recordsOf(f);
  expect(record).toMatchObject({ choice: "move" });
  expect(await readFile(join(f.roots.stateDir, record!.setAside!.venue, "venue.db"), "utf8")).toBe(
    "found database",
  );
});

it("a Move whose note cannot be written after its record is refused setup.start_again_move_unfinished, and moves nothing", async () => {
  const f = await found({
    note: { floorMs: T0 - 60 * MINUTE, lastName: "AB123", module: "probe" },
  });
  expect((await choiceSurvey(f)).noteFloorMs).not.toBeNull();
  failNoteWrite = "write";

  await expect(choose(f, "move")).rejects.toMatchObject({
    code: "setup.start_again_move_unfinished",
    reason: "setup.attempt_invalid",
  });

  expect((await recordsOf(f)).map((record) => record.choice)).toEqual(["move"]);
  expect((await readStartAgainNote(f.roots.stateDir))?.floorMs).toBe(T0 - 60 * MINUTE);
  expect(await readFile(join(f.roots.venueDir, "venue.db"), "utf8")).toBe("found database");
});

it("a plain error after the Move's record is refused setup.start_again_move_unfinished, naming its errno", async () => {
  const f = await found({
    note: { floorMs: T0 - 60 * MINUTE, lastName: "AB123", module: "probe" },
  });
  failNoteWrite = "throw";

  await expect(choose(f, "move")).rejects.toMatchObject({
    code: "setup.start_again_move_unfinished",
    reason: "move failed: EIO",
  });
  expect((await recordsOf(f)).map((record) => record.choice)).toEqual(["move"]);
});

it("rootRelativePath names a path under either root by its root, and leaves out any other", () => {
  const roots = { stateDir: "/box/state", venueDir: "/box/venue" };
  const at = (path?: unknown) => Object.assign(new Error("io"), { path });
  expect(rootRelativePath(roots, at("/box/state/a/b.json"))).toBe("state/a/b.json");
  expect(rootRelativePath(roots, at("/box/venue/venue.db"))).toBe("venue/venue.db");
  expect(rootRelativePath(roots, at("/box/statement/x"))).toBeUndefined();
  expect(rootRelativePath(roots, at("/elsewhere/x"))).toBeUndefined();
  expect(rootRelativePath(roots, at())).toBeUndefined();
  expect(rootRelativePath(roots, "not an error")).toBeUndefined();
});

it("a plain error naming a path after the Move's record carries that path relative to its root", async () => {
  const f = await found({
    note: { floorMs: T0 - 60 * MINUTE, lastName: "AB123", module: "probe" },
  });
  failNoteWrite = "throwAt";

  await expect(choose(f, "move")).rejects.toMatchObject({
    code: "setup.start_again_move_unfinished",
    reason: "move failed: EIO state/note/x.json",
  });
});

it("no log call and no thrown error carries the administrator's name or email", async () => {
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
  try {
    const errors: unknown[] = [];
    const caught = (promise: Promise<unknown>) =>
      promise.then(
        () => undefined,
        (error: unknown) => errors.push(error),
      );
    const f = await found();
    await caught(choose(f, "move", { password: WRONG }));
    await caught(
      choose(f, "move", {
        io: {
          ...realIo,
          rename: async () => {
            throw errno("EXDEV");
          },
        },
      }),
    );
    const g = await found();
    await symlink(await scratch(), join(g.roots.stateDir, START_AGAIN_CHOICES_DIR));
    await caught(choose(g, "keep"));
    await caught(choose(f, "keep"));
    await caught(choose(f, "move"));
    const h = await found();
    await caught(choose(h, "move"));
    await caught(choose(h, "move"));
    expect(errors.map((error) => (error as { code?: string }).code)).toEqual([
      "setup.owner_required",
      "setup.start_again_set_aside_unavailable",
      "setup.attempt_invalid",
      "setup.start_again_kept",
      "setup.not_ready",
    ]);
    const said = JSON.stringify([
      ...errors.map((error) => ({
        ...(error as object),
        message: (error as Error).message,
        stack: (error as Error).stack,
        // Not enumerable.
        reason: (error as { reason?: string }).reason,
        cause: String((error as Error).cause),
      })),
      ...spies.flatMap((spy) => spy.mock.calls),
    ]);
    for (const personal of [START_AGAIN_ADMIN.displayName, START_AGAIN_ADMIN.email])
      expect(said).not.toContain(personal);
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
