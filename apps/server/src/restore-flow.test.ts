import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as atomic from "./fs-atomic.js";
import {
  attachmentPath,
  dropAttachments,
  endRestoreFlow,
  firstStartPending,
  publishRestoreFlow,
  readRestoreFlow,
  updateRestoreFlow,
  type RestoreFlowRecord,
} from "./restore-flow.js";

let stateDir: string;
const staged: RestoreFlowRecord = {
  version: 1,
  phase: "staged",
  request: { version: 1, environment: "preproduction" },
};
const firstStart: RestoreFlowRecord = {
  version: 1,
  phase: "first-start",
  firstStart: { source: "archive" },
};
beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "restore-flow-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(stateDir, { recursive: true, force: true });
});

it("publishes the record and its attachments together", async () => {
  await publishRestoreFlow(stateDir, staged, async (folder) => {
    await writeFile(join(folder, "artifact"), "archive", { mode: 0o600 });
    expect(await readRestoreFlow(stateDir)).toBeNull();
  });
  expect(await readRestoreFlow(stateDir)).toEqual(staged);
  expect(await readFile(attachmentPath(stateDir, "artifact"), "utf8")).toBe("archive");
  expect((await stat(join(stateDir, "flows", "restore"))).mode & 0o777).toBe(0o700);
  expect((await stat(join(stateDir, "flows", "restore", "record.json"))).mode & 0o777).toBe(0o600);
  expect(await readdir(join(stateDir, "scratch"))).toEqual([]);
});

it("cleans a failed attachment without replacing the waiting restore", async () => {
  await publishRestoreFlow(stateDir, staged, async (folder) => {
    await writeFile(join(folder, "key"), "old key");
  });
  const failure = new Error("attachment failed");
  await expect(
    publishRestoreFlow(stateDir, staged, async (folder) => {
      await writeFile(join(folder, "key"), "partial key");
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await readRestoreFlow(stateDir)).toEqual(staged);
  expect(await readFile(attachmentPath(stateDir, "key"), "utf8")).toBe("old key");
  expect(await readdir(join(stateDir, "scratch"))).toEqual([]);
});

it("removes private staging files when the flows folder cannot be created", async () => {
  await writeFile(join(stateDir, "flows"), "unusable folder");
  await expect(
    publishRestoreFlow(stateDir, staged, async (folder) => {
      await writeFile(join(folder, "key"), "private key");
      await writeFile(join(folder, "node-key"), "private node key");
    }),
  ).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readdir(join(stateDir, "scratch"))).toEqual([]);
});

it("replaces a waiting restore without retaining its old attachments", async () => {
  await publishRestoreFlow(stateDir, staged, async (folder) => {
    await writeFile(join(folder, "key"), "old key");
  });
  await publishRestoreFlow(stateDir, firstStart, async (folder) => {
    await writeFile(join(folder, "artifact"), "new archive");
  });
  expect(await readRestoreFlow(stateDir)).toEqual(firstStart);
  expect(await readdir(join(stateDir, "flows", "restore"))).toEqual(["artifact", "record.json"]);
  expect(await readFile(attachmentPath(stateDir, "artifact"), "utf8")).toBe("new archive");
  expect(await readdir(join(stateDir, "scratch"))).toEqual([]);
});

it("updates the record while keeping the attachment bytes", async () => {
  await publishRestoreFlow(stateDir, staged, async (folder) => {
    await writeFile(join(folder, "artifact"), "kept archive");
  });
  const placing: RestoreFlowRecord = { ...staged, phase: "placing" };
  await updateRestoreFlow(stateDir, placing);
  expect(await readRestoreFlow(stateDir)).toEqual(placing);
  expect(await readFile(attachmentPath(stateDir, "artifact"), "utf8")).toBe("kept archive");
});

it("drops every attachment and keeps the first-start record", async () => {
  await publishRestoreFlow(stateDir, firstStart, async (folder) => {
    for (const name of ["artifact", "key", "venue.db", "entries", "placement.db", "node-key"]) {
      await writeFile(join(folder, name), name);
    }
  });
  await dropAttachments(stateDir);
  expect(await readdir(join(stateDir, "flows", "restore"))).toEqual(["record.json"]);
  expect(await readRestoreFlow(stateDir)).toEqual(firstStart);
});

it("ends only the restore and leaves no attachment in scratch", async () => {
  await publishRestoreFlow(stateDir, firstStart, async (folder) => {
    await writeFile(join(folder, "key"), "key");
  });
  await mkdir(join(stateDir, "flows", "other"));
  await endRestoreFlow(stateDir);
  expect(await readRestoreFlow(stateDir)).toBeNull();
  expect(await readdir(join(stateDir, "flows"))).toEqual(["other"]);
  expect(await readdir(join(stateDir, "scratch"))).toEqual([]);
});

it("syncs the published folder and both renamed parents before removing the ended flow", async () => {
  const sync = atomic.syncFolderHolding;
  const observed: { folder: string; children: string[] }[] = [];
  vi.spyOn(atomic, "syncFolderHolding").mockImplementation(async (path) => {
    await sync(path);
    observed.push({
      folder: relative(stateDir, dirname(path)),
      children: await readdir(dirname(path)),
    });
  });
  await publishRestoreFlow(stateDir, firstStart, async (folder) => {
    await writeFile(join(folder, "key"), "key");
  });
  await endRestoreFlow(stateDir);
  expect(observed).toEqual([
    { folder: "flows", children: ["restore"] },
    { folder: "scratch", children: [expect.stringMatching(/^restore-flow-ended-/)] },
    { folder: "flows", children: [] },
  ]);
  expect(await readdir(join(stateDir, "scratch"))).toEqual([]);
});

it("reports the first start independently of a waiting request", async () => {
  await publishRestoreFlow(
    stateDir,
    { ...staged, firstStart: { source: "archive" } },
    async () => {},
  );
  expect(await firstStartPending(stateDir)).toEqual({ source: "archive" });
  await updateRestoreFlow(stateDir, firstStart);
  expect(await firstStartPending(stateDir)).toEqual({ source: "archive" });
});

it("treats an unreadable flow as an unknown pending first start", async () => {
  expect(await firstStartPending(stateDir)).toBeNull();
  await publishRestoreFlow(stateDir, firstStart, async () => {});
  await writeFile(join(stateDir, "flows", "restore", "record.json"), "{ torn");
  expect(await firstStartPending(stateDir)).toEqual({ source: "unknown" });
});
