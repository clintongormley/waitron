import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SETUP_OPERATION_FILE } from "@waitron/store";
import { withUnfinishedJoinEnvironment } from "./unfinished-join.js";

let stateDir: string;
beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "unfinished-join-"));
});
afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

async function writeRecord(fields: Record<string, unknown> | string): Promise<void> {
  const path = join(stateDir, SETUP_OPERATION_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    typeof fields === "string"
      ? fields
      : JSON.stringify({
          version: 1,
          id: "op-1",
          kind: "adopt",
          requestHash: "hash",
          phase: "venue_committed",
          data: { environment: "production" },
          updatedAt: "2026-11-21T12:00:00.000Z",
          ...fields,
        }),
  );
}

it.each([undefined, ""])(
  "takes an unfinished join's environment when WAITRON_ENV is %j",
  async (raw) => {
    await writeRecord({});
    const env = { WAITRON_STATE_DIR: stateDir, ...(raw === undefined ? {} : { WAITRON_ENV: raw }) };
    expect(await withUnfinishedJoinEnvironment(env, "/unused")).toEqual({
      WAITRON_STATE_DIR: stateDir,
      WAITRON_ENV: "production",
    });
  },
);

it("reads the record under the default state root when WAITRON_STATE_DIR is unset", async () => {
  await writeRecord({ data: { environment: "preproduction" } });
  expect((await withUnfinishedJoinEnvironment({}, stateDir)).WAITRON_ENV).toBe("preproduction");
});

it("leaves a WAITRON_ENV that is set alone", async () => {
  await writeRecord({});
  const env = { WAITRON_STATE_DIR: stateDir, WAITRON_ENV: "preproduction" };
  expect(await withUnfinishedJoinEnvironment(env, "/unused")).toBe(env);
});

it.each([
  ["no record", null],
  ["a first setup's record", { kind: "provision" }],
  ["a join before its first write", { phase: "started" }],
  ["a finished join", { phase: "complete" }],
  ["a record naming no environment", { data: {} }],
  ["a record naming another word", { data: { environment: "dev" } }],
  ["an unreadable record", "{"],
] as const)("leaves the environment unset for %s", async (_what, record) => {
  if (record !== null) await writeRecord(record);
  const env = { WAITRON_STATE_DIR: stateDir };
  expect(await withUnfinishedJoinEnvironment(env, "/unused")).toBe(env);
});
