import { readFile, writeFile } from "node:fs/promises";

const files = [
  "packages/workforce/src/attendance-questions.test.ts",
  "packages/workforce/src/attendance-rota.test.ts",
  "packages/workforce/src/end-of-day.test.ts",
  "packages/workforce/src/end-of-day.obligations.test.ts",
  "packages/workforce/src/attendance-response-commands.test.ts",
  "packages/workforce/src/personal-data.test.ts",
  "packages/workforce/test/attendance-fixture.ts",
  "apps/server/src/attendance-email-worker.test.ts",
  "apps/server/src/attendance-obligations.test.ts",
  "apps/server/src/attendance-restore.test.ts",
  "apps/server/src/attendance-export-api.test.ts",
  "apps/server/src/management-hours-api.test.ts",
  "apps/server/src/personal-data-export-api.workforce.test.ts",
  "apps/server/src/boot.attendance.test.ts",
  "apps/server/src/boot.box-emails.test.ts",
  "apps/server/src/recovery-page-personal-data.test.ts",
];
for (const file of files) {
  const before = await readFile(file, "utf8");
  const after = before.replace(
    /([\w.]+)\s*\.select\(\)\s*\.from\((?:api\.)?attendanceMail\)(?!\s*\.)/g,
    "attendanceMailRows($1)",
  );
  if (after !== before) await writeFile(file, after);
}
