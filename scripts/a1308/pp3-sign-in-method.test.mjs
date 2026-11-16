import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const script = fileURLToPath(new URL("./pp3-sign-in-method.mjs", import.meta.url));
const roots = [];
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
function fixture(source) {
  const root = mkdtempSync(join(tmpdir(), "wt-pp3-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", root], { env });
  writeFileSync(join(root, "session.test.ts"), source);
  execFileSync("git", ["-C", root, "add", "."], { env });
  return root;
}
const run = (root) =>
  spawnSync(process.execPath, [script, "--write"], { cwd: root, env, encoding: "utf8" });
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("adds a method to object arguments, preserves existing methods and is idempotent", () => {
  const root = fixture(
    'startManagementSession(tx, { personId }); startManagementSession(tx, { personId, method: "setup" });',
  );
  expect(run(root).status).toBe(0);
  const result = readFileSync(join(root, "session.test.ts"), "utf8");
  expect(result).toBe(
    'startManagementSession(tx, { method: "password", personId }); startManagementSession(tx, { personId, method: "setup" });',
  );
  expect(run(root).status).toBe(0);
  expect(readFileSync(join(root, "session.test.ts"), "utf8")).toBe(result);
});
it("refuses a non-object argument and names its call without writing partial output", () => {
  const source = "startManagementSession(tx, { personId }); startManagementSession(tx, input);";
  const root = fixture(source);
  const result = run(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("session.test.ts:1");
  expect(result.stderr).toContain("object literal");
  expect(readFileSync(join(root, "session.test.ts"), "utf8")).toBe(source);
});
