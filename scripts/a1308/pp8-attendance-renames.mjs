import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pairs = [
  ["attendance_day_work", "attendance_days"],
  ["attendanceDayWork", "attendanceDays"],
  ["attendance_response_commands", "attendance_answers"],
  ["attendanceResponseCommands", "attendanceAnswers"],
];
export function run({ root = process.cwd(), write = false } = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const files = execFileSync("git", ["ls-files", "-z", "apps", "packages", "scripts"], {
    cwd: root,
    env,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const changes = [];
  for (const path of files) {
    if (
      path.includes("/drizzle/") ||
      path.startsWith("scripts/a1308/") ||
      path.startsWith("packages/country-es/test-fixtures/") ||
      path === "apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts" ||
      !existsSync(join(root, path)) ||
      !lstatSync(join(root, path)).isFile()
    )
      continue;
    const bytes = readFileSync(join(root, path));
    if (bytes.includes(0)) continue;
    const before = bytes.toString("utf8");
    let after = before;
    for (const [from, to] of pairs) {
      const source = new RegExp(`\\b${from}${from.includes("_") ? "(?=_|\\b)" : "\\b"}`, "g");
      if (!source.test(before)) continue;
      if (new RegExp(`\\b${to}${from.includes("_") ? "(?=_|\\b)" : "\\b"}`).test(before))
        throw new Error(`Identifier collision: ${path}`);
      after = after.replace(source, to);
    }
    if (after !== before) changes.push({ path, text: after });
  }
  if (write) for (const { path, text } of changes) writeFileSync(join(root, path), text);
  return changes.map(({ path }) => path);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const path of run({ write: process.argv.includes("--write") }))
    process.stdout.write(`${path}\n`);
}
