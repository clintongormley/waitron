import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { run } from "./pp8-attendance-renames.mjs";

const roots = [];
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
const old =
  "attendance_day_work attendance_day_work_due_idx attendanceDayWork attendance_response_commands attendance_response_commands_action_ck attendanceResponseCommands attendanceDayWorker";
const renamed =
  "attendance_days attendance_days_due_idx attendanceDays attendance_answers attendance_answers_action_ck attendanceAnswers attendanceDayWorker";
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "pp8-rename-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", root], { env });
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync("git", ["-C", root, "add", "."], { env });
  return root;
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it("renames schemas, imports, SQL and subscription names once, keeping historical inputs", () => {
  const paths = ["packages/workforce/src/schema.ts", "apps/server/src/read.ts", "scripts/guard.ts"];
  const preserved = [
    "packages/workforce/drizzle/0000_baseline.sql",
    "packages/country-es/test-fixtures/demo/before.json",
    "scripts/a1308/earlier.mjs",
  ];
  const root = fixture(Object.fromEntries([...paths, ...preserved].map((path) => [path, old])));
  vi.stubEnv("GIT_DIR", "/missing/foreign-git-dir");
  expect(run({ root })).toEqual([...paths].sort());
  expect(readFileSync(join(root, paths[0]), "utf8")).toBe(old);
  expect(run({ root, write: true })).toEqual([...paths].sort());
  for (const path of paths) expect(readFileSync(join(root, path), "utf8")).toBe(renamed);
  for (const path of preserved) expect(readFileSync(join(root, path), "utf8")).toBe(old);
  expect(run({ root, write: true })).toEqual([]);
});
it("refuses an identifier collision before writing any file", () => {
  const root = fixture({
    "apps/a.ts": old,
    "apps/b.ts": "const attendanceDays = attendanceDayWork;",
  });
  expect(() => run({ root, write: true })).toThrow("apps/b.ts");
  expect(readFileSync(join(root, "apps/a.ts"), "utf8")).toBe(old);
});
