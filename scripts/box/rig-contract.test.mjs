import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RIG_CASES, createRun, parseRigArgs } from "./rig-contract.mjs";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const scratch = async () => {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "b3-rig-")));
  roots.push(root);
  return root;
};
const refused = (reason) => expect.objectContaining({ code: "rig.refused", reason });

describe("parseRigArgs", () => {
  it("parses --case layout --run-dir <abs> in either order", () => {
    expect(parseRigArgs(["--case", "layout", "--run-dir", "/tmp/run-1"])).toEqual({
      caseName: "layout",
      runDir: "/tmp/run-1",
    });
    expect(parseRigArgs(["--run-dir", "/tmp/run-1", "--case", "layout"])).toEqual({
      caseName: "layout",
      runDir: "/tmp/run-1",
    });
  });

  it("accepts every listed case", () => {
    expect(RIG_CASES).toEqual([
      "layout",
      "seal-a",
      "seal-b",
      "seal-d",
      "seal-f",
      "seal-g",
      "seal-i",
      "preboot-local",
      "preboot-headless",
      "preboot-two-boxes",
      "preboot-tamper",
    ]);
    for (const caseName of RIG_CASES)
      expect(parseRigArgs(["--case", caseName, "--run-dir", "/tmp/r"]).caseName).toBe(caseName);
  });

  it.each([
    [
      "/dev/sdb as the run folder",
      ["--case", "layout", "--run-dir", "/dev/sdb"],
      "device-argument",
    ],
    [
      "an extra /dev/nvme0n1 argument",
      ["--case", "layout", "--run-dir", "/tmp/r", "/dev/nvme0n1"],
      "device-argument",
    ],
    ["a /dev/ argument before an unknown one", ["--bogus", "/dev/sda"], "device-argument"],
    [
      "an unknown option",
      ["--case", "layout", "--run-dir", "/tmp/r", "--force"],
      "argument-unknown",
    ],
    ["a bare value", ["layout"], "argument-unknown"],
    [
      "--case given twice",
      ["--case", "layout", "--case", "layout", "--run-dir", "/tmp/r"],
      "argument-repeated",
    ],
    [
      "--run-dir given twice",
      ["--run-dir", "/tmp/r", "--case", "layout", "--run-dir", "/tmp/r"],
      "argument-repeated",
    ],
    ["no arguments", [], "argument-missing"],
    ["--case missing", ["--run-dir", "/tmp/r"], "argument-missing"],
    ["--run-dir missing", ["--case", "layout"], "argument-missing"],
    ["--case without a value", ["--run-dir", "/tmp/r", "--case"], "argument-missing"],
    ["--run-dir without a value", ["--case", "layout", "--run-dir"], "argument-missing"],
    ["a case not listed", ["--case", "seal-c", "--run-dir", "/tmp/r"], "case-unknown"],
    ["a relative run folder", ["--case", "layout", "--run-dir", "tmp/r"], "run-dir-relative"],
    ["an empty run folder", ["--case", "layout", "--run-dir", ""], "run-dir-relative"],
    ['"/tmp/x/../y"', ["--case", "layout", "--run-dir", "/tmp/x/../y"], "run-dir-unsafe"],
    ["a trailing slash", ["--case", "layout", "--run-dir", "/tmp/r/"], "run-dir-unsafe"],
    ["a NUL", ["--case", "layout", "--run-dir", "/tmp/r\0x"], "run-dir-unsafe"],
    ["the root folder", ["--case", "layout", "--run-dir", "/"], "run-dir-unsafe"],
  ])("%s → refused", (_name, argv, reason) => {
    expect(() => parseRigArgs(argv)).toThrow(refused(reason));
  });
});

describe("createRun", () => {
  it("fresh path → a 0700 folder holding an empty ledger", async () => {
    const runDir = join(await scratch(), "run");
    const run = await createRun(runDir);
    const stat = await fs.lstat(runDir, { bigint: true });
    expect(run).toEqual({ runDir, rootId: `${stat.dev}:${stat.ino}` });
    expect(Number(stat.mode) & 0o777).toBe(0o700);
    expect(await fs.readFile(join(runDir, "ledger.json"), "utf8")).toBe(
      JSON.stringify({ version: 1, runDir, resources: [] }) + "\n",
    );
    expect((await fs.lstat(join(runDir, "ledger.json"))).mode & 0o777).toBe(0o600);
    expect(await fs.readdir(runDir)).toEqual(["ledger.json"]);
  });

  it("existing empty folder → run-dir-exists, with its mode unchanged", async () => {
    const runDir = join(await scratch(), "run");
    await fs.mkdir(runDir, { mode: 0o755 });
    await fs.chmod(runDir, 0o755);
    await expect(createRun(runDir)).rejects.toThrow(refused("run-dir-exists"));
    expect((await fs.lstat(runDir)).mode & 0o777).toBe(0o755);
    expect(await fs.readdir(runDir)).toEqual([]);
  });

  it("existing non-empty folder → run-dir-exists, with its file unchanged", async () => {
    const runDir = join(await scratch(), "run");
    await fs.mkdir(runDir);
    await fs.writeFile(join(runDir, "ledger.json"), "kept");
    await expect(createRun(runDir)).rejects.toThrow(refused("run-dir-exists"));
    expect(await fs.readFile(join(runDir, "ledger.json"), "utf8")).toBe("kept");
    expect(await fs.readdir(runDir)).toEqual(["ledger.json"]);
  });

  it("missing parent → run-dir-parent-missing, and nothing created", async () => {
    const root = await scratch();
    await expect(createRun(join(root, "absent", "run"))).rejects.toThrow(
      refused("run-dir-parent-missing"),
    );
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("a parent that is a file → the file system's own error, nothing created", async () => {
    const root = await scratch();
    await fs.writeFile(join(root, "file"), "");
    await expect(createRun(join(root, "file", "run"))).rejects.toMatchObject({ code: "ENOTDIR" });
    expect(await fs.readdir(root)).toEqual(["file"]);
  });

  it.each([
    ["tmp/run", "run-dir-relative"],
    ["/tmp/x/../y", "run-dir-unsafe"],
    ["/", "run-dir-unsafe"],
  ])("%s → %s before any file call", async (runDir, reason) => {
    await expect(createRun(runDir)).rejects.toThrow(refused(reason));
  });
});
