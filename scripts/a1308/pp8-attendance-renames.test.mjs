import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
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
it.each([
  "const attendanceDays = attendanceDayWork;",
  'index("attendance_day_work_due_idx"); index("attendance_days_due_idx");',
])("refuses an identifier collision before writing any file: %s", (collision) => {
  const root = fixture({
    "apps/a.ts": old,
    "apps/b.ts": collision,
  });
  expect(() => run({ root, write: true })).toThrow("apps/b.ts");
  expect(readFileSync(join(root, "apps/a.ts"), "utf8")).toBe(old);
});

it("writes and reports through the CLI while leaving deleted, non-file and binary entries alone", async () => {
  const root = fixture({
    "apps/a.ts": old,
    "apps/deleted.ts": old,
    "apps/binary.bin": "\0attendance_day_work",
    "apps/unchanged.ts": "unchanged",
  });
  rmSync(join(root, "apps/deleted.ts"));
  symlinkSync("a.ts", join(root, "apps/link.ts"));
  execFileSync("git", ["-C", root, "add", "apps/link.ts"], { env });
  const argv = process.argv;
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    process.argv = [
      process.execPath,
      fileURLToPath(new URL("./pp8-attendance-renames.mjs", import.meta.url)),
    ];
    vi.resetModules();
    await import("./pp8-attendance-renames.mjs");
    expect(output.mock.calls.map(([line]) => line)).toEqual(["apps/a.ts\n"]);
    expect(readFileSync(join(root, "apps/a.ts"), "utf8")).toBe(old);
    process.argv.push("--write");
    vi.resetModules();
    await import("./pp8-attendance-renames.mjs");
    expect(readFileSync(join(root, "apps/a.ts"), "utf8")).toBe(renamed);
    expect(readFileSync(join(root, "apps/binary.bin"), "utf8")).toBe("\0attendance_day_work");
  } finally {
    process.argv = argv;
    cwd.mockRestore();
    output.mockRestore();
    vi.resetModules();
  }
});
