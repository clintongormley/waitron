import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

async function run(contents) {
  const root = mkdtempSync(join(tmpdir(), "a972-bundles-"));
  try {
    const apps = contents.map((text, index) => {
      const dir = join(root, String(index));
      if (text !== null) {
        mkdirSync(join(dir, "assets"), { recursive: true });
        writeFileSync(join(dir, "index.html"), "<main></main>");
        if (text !== "") writeFileSync(join(dir, "assets", "chunk.js"), text);
      }
      return dir;
    });
    const previousArgs = process.argv;
    const previousExit = process.exitCode;
    const stdout = [];
    const stderr = [];
    const out = vi.spyOn(console, "log").mockImplementation((value) => stdout.push(value));
    const err = vi.spyOn(console, "error").mockImplementation((value) => stderr.push(value));
    try {
      process.argv = [process.execPath, "scripts/check-demo-browser-bundles.mjs", ...apps];
      process.exitCode = undefined;
      vi.resetModules();
      await import("./check-demo-browser-bundles.mjs");
      return {
        status: process.exitCode ?? 0,
        stdout: stdout.join("\n"),
        stderr: stderr.join("\n"),
      };
    } finally {
      process.argv = previousArgs;
      process.exitCode = previousExit;
      out.mockRestore();
      err.mockRestore();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
it("accepts a real identity marker in each app without demo dishes", async () => {
  const result = await run(["Waitron Demo S.L.", "Waitron Demo S.L."]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("2 browser bundles");
});
it.each([null, "", "other application", "Waitron Demo S.L. Croquetes de pernil"])(
  "rejects invalid output %s in either app",
  async (text) => {
    for (const contents of [
      [text, "Waitron Demo S.L."],
      ["Waitron Demo S.L.", text],
    ]) {
      const result = await run(contents);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(
        /missing output|no JavaScript|missing identity|contains demo dish/,
      );
    }
  },
);
it("requires both app directories", async () => {
  const result = await run([]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("two app directories");
});
