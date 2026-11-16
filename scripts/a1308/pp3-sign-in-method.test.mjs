import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";

import { run as rewrite } from "./pp3-sign-in-method.mjs";

const script = fileURLToPath(new URL("./pp3-sign-in-method.mjs", import.meta.url));
const roots = [];
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
function fixture(source) {
  const root = mkdtempSync(join(tmpdir(), "wt-pp3-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", root], { env });
  writeFileSync(join(root, "session.test.ts"), source);
  writeFileSync(join(root, "unchanged.test.ts"), "export const untouched = 1;");
  execFileSync("git", ["-C", root, "add", "."], { env });
  return root;
}
const cli = (root) =>
  spawnSync(process.execPath, [script, "--write"], { cwd: root, env, encoding: "utf8" });
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("adds a method to object arguments, preserves existing methods and is idempotent", () => {
  const root = fixture(
    'startManagementSession(tx, { personId }); identity.startManagementSession(tx, { personId }); startManagementSession(tx, { personId, method: "setup" });',
  );
  expect(rewrite({ root })).toEqual(["session.test.ts"]);
  expect(readFileSync(join(root, "session.test.ts"), "utf8")).not.toContain('method: "password"');
  expect(rewrite({ root, write: true })).toEqual(["session.test.ts"]);
  const result = readFileSync(join(root, "session.test.ts"), "utf8");
  expect(result).toBe(
    'startManagementSession(tx, { method: "password", personId }); identity.startManagementSession(tx, { method: "password", personId }); startManagementSession(tx, { personId, method: "setup" });',
  );
  expect(rewrite({ root, write: true })).toEqual([]);
  expect(readFileSync(join(root, "unchanged.test.ts"), "utf8")).toBe("export const untouched = 1;");
  expect(readFileSync(join(root, "session.test.ts"), "utf8")).toBe(result);
});
it("refuses a non-object argument and names its call without writing partial output", () => {
  const source = "startManagementSession(tx, { personId }); startManagementSession(tx, input);";
  const root = fixture(source);
  expect(() => rewrite({ root, write: true })).toThrow("object literal");
  const result = cli(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("session.test.ts:1");
  expect(result.stderr).toContain("object literal");
  expect(readFileSync(join(root, "session.test.ts"), "utf8")).toBe(source);
});

it("writes and reports the fixture paths through the command entry point", async () => {
  const root = fixture("startManagementSession(tx, { personId });");
  const cwd = process.cwd();
  const argv = process.argv;
  const output = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  try {
    process.chdir(root);
    process.argv = [process.execPath, script, "--write"];
    vi.resetModules();
    await import("./pp3-sign-in-method.mjs");
  } finally {
    process.chdir(cwd);
    process.argv = argv;
    stdout.mockRestore();
  }
  expect(output).toEqual(["session.test.ts\n"]);
  expect(readFileSync(join(root, "session.test.ts"), "utf8")).toBe(
    'startManagementSession(tx, { method: "password", personId });',
  );
});
