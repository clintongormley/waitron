import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { cleanupCommandFor } from "../src/testing/aws-rehearsal-receipt.js";
import { parseCleanupArgs, runCleanup } from "./aws-rehearsal-cleanup.js";

describe("aws-rehearsal-cleanup script", () => {
  it.each([
    ["no arguments", []],
    ["a missing value", ["--receipt"]],
    ["an extra argument", ["--receipt", "/tmp/r.json", "--force"]],
    ["another flag", ["--bucket", "x"]],
    ["an empty value", ["--receipt", ""]],
  ])("refuses %s", (_label, argv) => {
    expect(parseCleanupArgs(argv)).toBeNull();
  });

  it("accepts exactly --receipt <path>", () => {
    expect(parseCleanupArgs(["--receipt", "/tmp/r.json"])).toEqual({ receipt: "/tmp/r.json" });
  });

  it("exits 2 with a usage message on bad arguments and never starts a cleanup", async () => {
    const lines: string[] = [];
    const cleanup = vi.fn();
    expect(await runCleanup(["--receipt"], { cleanup, error: (l) => lines.push(l) })).toBe(2);
    expect(cleanup).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("usage:");
  });

  it("exits 0 or 1 by the cleanup's result, and prints only an error's message", async () => {
    const lines: string[] = [];
    const error = (line: string) => lines.push(line);
    expect(
      await runCleanup(["--receipt", "/r.json"], { cleanup: async () => ({ ok: true }), error }),
    ).toBe(0);
    expect(
      await runCleanup(["--receipt", "/r.json"], { cleanup: async () => ({ ok: false }), error }),
    ).toBe(1);
    const thrown = new Error("refused: names the bucket only");
    expect(
      await runCleanup(["--receipt", "/r.json"], {
        cleanup: async () => {
          throw thrown;
        },
        error,
      }),
    ).toBe(1);
    expect(lines).toEqual(["refused: names the bucket only"]);
  });

  it("is the script the run's cleanup command names", () => {
    const command = cleanupCommandFor("eu-north-1", "/tmp/aws-rehearsal-x.json");
    const named = /exec tsx (\S+) --receipt /.exec(command)?.[1];
    expect(named).toBe("scripts/aws-rehearsal-cleanup.ts");
    const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    expect(existsSync(join(serverRoot, named!))).toBe(true);
  });
});
