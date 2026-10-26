import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  START_AGAIN_ADMIN,
  START_AGAIN_ADMIN_PASSWORD,
  startAgainAttempt,
  type StartAgainAttempt,
} from "../test/start-again-attempt.js";
import { writeStartAgainChoice } from "./first-setup-start-again-choice.js";
import { chooseStartAgainLeftovers } from "./first-setup-start-again-choose.js";
import { START_AGAIN_GUESSES_FILE } from "./first-setup-start-again-guesses.js";
import { surveyStartAgainLeftovers } from "./first-setup-start-again-leftovers.js";

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

const children: ChildProcess[] = [];
const dirs: string[] = [];
async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "start-again-choose-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  afterSurvey = undefined;
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const T0 = Date.parse("2026-10-26T10:00:00.000Z");
const MINUTE = 60_000;
const WRONG = "not-the-password";
// Taking a venue lock makes venue.lock if it is absent, and writes the other two, which its
// release deletes, whoever asks for the lock.
const LOCK_OWNED = /^(venue\.lock|venue\.holder\.json|venue\.lock-journal)/;

/** A Start again a cut left, with a venue.db the box did not create: a survey of kind `choice`. */
async function found(): Promise<StartAgainAttempt & { listed: string }> {
  const attempt = await startAgainAttempt(await scratch());
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
      if (LOCK_OWNED.test(name) || (relative === "" && name === START_AGAIN_GUESSES_FILE)) continue;
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
  expect(wrong).toMatchObject({ status: "rejected", reason: { code: "setup.owner_required" } });
  expect(right.status === "rejected" && (right.reason as { code?: string }).code).not.toBe(
    "setup.owner_required",
  );
  expect(overlapped).toBe(false);
  // Either may go first. Whichever did, its whole try ended before the other's guess was counted:
  // the correct try's reset never wipes a wrong guess counted after it.
  expect(await counter(f.roots.stateDir)).toMatchObject({
    failures: order[0] === START_AGAIN_ADMIN_PASSWORD ? 1 : 0,
  });
});
