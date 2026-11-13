import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { stageRestoreRequest } from "./restore-request.js";
import { stageResetRequest } from "./reset-request.js";

vi.mock("node:fs/promises", { spy: true });
const dirs: string[] = [];
afterEach(async () => {
  vi.mocked(fs.open).mockReset();
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

it.each([
  [
    "flows/restore/record.json",
    (dir: string) =>
      stageRestoreRequest(dir, {
        artifact: new Uint8Array([1]),
        recoveryKey: "key",
        environment: "preproduction",
      }),
  ],
  ["reset-request.json", (dir: string) => stageResetRequest(dir, "operation-1")],
] as const)("disarms %s when its publication fails at folder sync", async (marker, stage) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "staged-request-durability-"));
  dirs.push(dir);
  await fs.writeFile(join(dir, "flows/setup/operation.json"), "existing progress");
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    if (
      String(args[0]) === (marker.includes("/") ? join(dir, "flows") : dir) &&
      existsSync(join(dir, marker))
    )
      throw Object.assign(new Error("folder sync failed"), { code: "EIO" });
    return actual.open(...args);
  });
  await expect(stage(dir)).rejects.toMatchObject({ code: "EIO" });
  await expect(fs.readFile(join(dir, marker))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(join(dir, "flows/setup/operation.json"), "utf8")).toBe("existing progress");
});

it("refuses publication when the downloaded stream database cannot be flushed", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "stream-flush-"));
  dirs.push(dir);
  const databasePath = join(dir, "download.db");
  await fs.writeFile(databasePath, "downloaded database");
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.open).mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const file = await actual.open(...args);
    if (String(args[0]).endsWith("/venue.db") && args[1] === "r")
      vi.spyOn(file, "sync").mockRejectedValue(
        Object.assign(new Error("flush failed"), { code: "EIO" }),
      );
    return file;
  });
  await expect(
    stageRestoreRequest(dir, {
      kind: "stream",
      databasePath,
      entries: [],
      environment: "preproduction",
    }),
  ).rejects.toMatchObject({ code: "EIO" });
  await expect(fs.readFile(join(dir, "flows/restore/record.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
