import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  START_AGAIN_FORGIVE_MS,
  START_AGAIN_FREE_GUESSES,
  START_AGAIN_GUESSES_FILE,
  START_AGAIN_MAX_WAIT_MS,
  beginStartAgainGuess,
  startAgainWaitMs,
} from "./first-setup-start-again-guesses.js";

const dirs: string[] = [];
async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "start-again-guesses-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(async (dir) => {
      await chmod(dir, 0o700);
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

const MINUTE = 60_000;
const T0 = Date.parse("2026-10-26T10:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms);
const counter = async (stateDir: string) =>
  JSON.parse(await readFile(join(stateDir, START_AGAIN_GUESSES_FILE), "utf8"));

/** Tries a wrong password; the refusal's retryAfterSeconds, or null when the try was allowed. */
async function wrong(stateDir: string, attemptId: string, now: Date): Promise<number | null> {
  try {
    const finish = await beginStartAgainGuess(stateDir, attemptId, now);
    await finish("invalid");
    return null;
  } catch (error) {
    expect(error).toMatchObject({ code: "password.throttled" });
    return (error as { params: { retryAfterSeconds: number } }).params.retryAfterSeconds;
  }
}

it("the constants are the decided values", () => {
  expect(START_AGAIN_FREE_GUESSES).toBe(5);
  expect(START_AGAIN_FORGIVE_MS).toBe(15 * MINUTE);
  expect(START_AGAIN_MAX_WAIT_MS).toBe(15 * MINUTE);
});

it("startAgainWaitMs is 0 up to five failures, then 1, 2, 4, 8 minutes, and never more than 15", () => {
  expect([0, 1, 2, 3, 4, 5].map(startAgainWaitMs)).toEqual([0, 0, 0, 0, 0, 0]);
  expect([6, 7, 8, 9, 10, 11, 40, 2000].map(startAgainWaitMs)).toEqual(
    [1, 2, 4, 8, 15, 15, 15, 15].map((minutes) => minutes * MINUTE),
  );
});

it("the count is on disk before the check: begin, then a new begin from a fresh import sees it raised", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  for (let index = 0; index < 6; index++) await beginStartAgainGuess(stateDir, attemptId, at(0));
  expect(await counter(stateDir)).toEqual({
    version: 1,
    attemptId,
    failures: 6,
    lastFailureAt: at(0).toISOString(),
    waitUntil: at(MINUTE).toISOString(),
  });
  vi.resetModules();
  const fresh = await import("./first-setup-start-again-guesses.js");
  await expect(fresh.beginStartAgainGuess(stateDir, attemptId, at(1000))).rejects.toMatchObject({
    code: "password.throttled",
    params: { retryAfterSeconds: 59 },
  });
});

it("a wrong guess past the free ones refuses the next try password.throttled with retryAfterSeconds", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  for (let index = 0; index < START_AGAIN_FREE_GUESSES; index++)
    expect(await wrong(stateDir, attemptId, at(0))).toBeNull();
  expect(await wrong(stateDir, attemptId, at(0))).toBeNull();
  expect(await wrong(stateDir, attemptId, at(30_000))).toBe(30);
  expect(await counter(stateDir)).toMatchObject({ failures: 6 });
  expect(await wrong(stateDir, attemptId, at(MINUTE))).toBeNull();
  expect(await wrong(stateDir, attemptId, at(MINUTE))).toBe(120);
});

it("one wrong guess is forgiven per 15 minutes: a wrong guess every hour for 24 hours never waits", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  for (let hour = 0; hour < 24; hour++)
    expect(await wrong(stateDir, attemptId, at(hour * 60 * MINUTE)), `hour ${hour}`).toBeNull();
  expect(await counter(stateDir)).toMatchObject({ failures: 1, waitUntil: null });
});

it("a guesser at the fastest allowed rate gets five tries and then about four an hour", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  let now = 0;
  const tries: number[] = [];
  while (now < 180 * MINUTE) {
    const retryAfterSeconds = await wrong(stateDir, attemptId, at(now));
    if (retryAfterSeconds === null) tries.push(now / MINUTE);
    else now += retryAfterSeconds * 1000;
  }
  // Five free, the sixth at once, then waits of 1, 2, 4 and 8 minutes, then one every 15 minutes:
  // each 15-minute wait forgives one failure, so the count stays at 10 and the wait at 15.
  expect(tries).toEqual([
    0, 0, 0, 0, 0, 0, 1, 3, 7, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165,
  ]);
  expect(tries.length).toBe(20);
});

it("success sets the count back to 0", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  for (let index = 0; index < 3; index++) await wrong(stateDir, attemptId, at(0));
  const finish = await beginStartAgainGuess(stateDir, attemptId, at(0));
  expect(await counter(stateDir)).toMatchObject({ failures: 4 });
  await finish("success");
  expect(await counter(stateDir)).toEqual({
    version: 1,
    attemptId,
    failures: 0,
    lastFailureAt: null,
    waitUntil: null,
  });
});

it("two tries sent at once are counted one after the other", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  await Promise.all([0, 1, 2].map(() => beginStartAgainGuess(stateDir, attemptId, at(0))));
  expect(await counter(stateDir)).toMatchObject({ failures: 3 });
});

it("a clock set back a year never makes a wait longer than 15 minutes", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  const yearAhead = at(365 * 24 * 60 * MINUTE).toISOString();
  await writeFile(
    join(stateDir, START_AGAIN_GUESSES_FILE),
    JSON.stringify({
      version: 1,
      attemptId,
      failures: 12,
      lastFailureAt: yearAhead,
      waitUntil: yearAhead,
    }),
  );
  expect(await wrong(stateDir, attemptId, at(0))).toBe(15 * 60);
  expect(await wrong(stateDir, attemptId, at(15 * MINUTE - 1000))).toBe(1);
  expect(await wrong(stateDir, attemptId, at(15 * MINUTE))).toBeNull();
  expect(await counter(stateDir)).toMatchObject({
    lastFailureAt: at(15 * MINUTE).toISOString(),
    waitUntil: at(30 * MINUTE).toISOString(),
  });
});

// The writer sets its folder's mode itself, so a read-only state folder is no test: here the
// state folder cannot be made, or the counter's name is taken by a folder.
it.skipIf(process.getuid?.() === 0)("an unwritable counter refuses the try", async () => {
  const attemptId = randomUUID();
  const base = await scratch();
  const blocked = await scratch();
  await mkdir(join(blocked, START_AGAIN_GUESSES_FILE));
  await chmod(base, 0o500);
  for (const stateDir of [join(base, "state"), blocked]) {
    let reached = false;
    await expect(
      beginStartAgainGuess(stateDir, attemptId, at(0)).then(() => {
        reached = true;
      }),
      stateDir,
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(reached).toBe(false);
  }
  expect(await readdir(base)).toEqual([]);
  expect(await readdir(blocked)).toEqual([START_AGAIN_GUESSES_FILE]);
});

it("a damaged counter reads as five failures", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  for (const damaged of [
    "{",
    JSON.stringify({ version: 1, attemptId, failures: -1, lastFailureAt: null, waitUntil: null }),
    JSON.stringify({
      version: 1,
      attemptId,
      failures: 0,
      lastFailureAt: "2026-10-26T10:00:00Z",
      waitUntil: null,
    }),
    JSON.stringify({ version: 2, attemptId, failures: 0, lastFailureAt: null, waitUntil: null }),
    JSON.stringify({ version: 1, attemptId, failures: 0, lastFailureAt: null }),
  ]) {
    await writeFile(join(stateDir, START_AGAIN_GUESSES_FILE), damaged);
    expect(await wrong(stateDir, attemptId, at(0)), damaged).toBeNull();
    expect(await counter(stateDir), damaged).toEqual({
      version: 1,
      attemptId,
      failures: 6,
      lastFailureAt: at(0).toISOString(),
      waitUntil: at(MINUTE).toISOString(),
    });
  }
});

it("another attempt's counter starts at 0", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  await writeFile(
    join(stateDir, START_AGAIN_GUESSES_FILE),
    JSON.stringify({
      version: 1,
      attemptId: randomUUID(),
      failures: 9,
      lastFailureAt: at(0).toISOString(),
      waitUntil: at(8 * MINUTE).toISOString(),
    }),
  );
  expect(await wrong(stateDir, attemptId, at(0))).toBeNull();
  expect(await counter(stateDir)).toEqual({
    version: 1,
    attemptId,
    failures: 1,
    lastFailureAt: at(0).toISOString(),
    waitUntil: null,
  });
});

it("after a success, the next wrong guess counts from 0", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  await (
    await beginStartAgainGuess(stateDir, attemptId, at(0))
  )("success");
  expect(await wrong(stateDir, attemptId, at(MINUTE))).toBeNull();
  expect(await counter(stateDir)).toMatchObject({ failures: 1, waitUntil: null });
});

it("a refused try with nothing to cap writes nothing", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  for (let index = 0; index < 6; index++) await wrong(stateDir, attemptId, at(0));
  const path = join(stateDir, START_AGAIN_GUESSES_FILE);
  const before = { text: await readFile(path, "utf8"), info: await stat(path) };
  expect(await wrong(stateDir, attemptId, at(1000))).toBe(59);
  const info = await stat(path);
  expect(await readFile(path, "utf8")).toBe(before.text);
  expect([info.ino, info.mtimeMs]).toEqual([before.info.ino, before.info.mtimeMs]);
});

it("a capped refusal whose write fails still refuses password.throttled with the wait", async () => {
  const stateDir = await scratch();
  const attemptId = randomUUID();
  const yearAhead = at(365 * 24 * 60 * MINUTE).toISOString();
  await writeFile(
    join(stateDir, START_AGAIN_GUESSES_FILE),
    JSON.stringify({
      version: 1,
      attemptId,
      failures: 12,
      lastFailureAt: yearAhead,
      waitUntil: yearAhead,
    }),
  );
  vi.resetModules();
  vi.doMock("./durable-host-json.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./durable-host-json.js")>()),
    writeDurableHostJson: vi.fn(async () => {
      throw new Error("disk full");
    }),
  }));
  try {
    const failing = await import("./first-setup-start-again-guesses.js");
    await expect(failing.beginStartAgainGuess(stateDir, attemptId, at(0))).rejects.toMatchObject({
      code: "password.throttled",
      params: { retryAfterSeconds: 15 * 60 },
    });
  } finally {
    vi.doUnmock("./durable-host-json.js");
    vi.resetModules();
  }
});
