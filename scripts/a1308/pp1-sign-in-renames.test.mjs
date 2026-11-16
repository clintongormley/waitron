import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { run } from "./pp1-sign-in-renames.mjs";

const roots = [];
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "wt-pp1-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", root], { env });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  execFileSync("git", ["-C", root, "add", "."], { env });
  return root;
}
const read = (root, path) => readFileSync(join(root, path), "utf8");
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("renames the three tables, bindings, files and constraints", () => {
  const root = fixture({
    "packages/db/src/schema/identity/sessions.ts":
      'export const sessions = table("sessions", index("sessions_open_idx"));',
    "packages/db/src/schema/identity/management-sessions.ts":
      'export const managementSessions = table("management_sessions", index("management_sessions_open_idx"));',
    "packages/db/src/schema/identity/management-account-actions.ts":
      'export const managementAccountActions = table("management_account_actions");',
    "packages/db/src/classification.ts":
      '["sessions", "management_sessions", "management_account_actions"]',
    "apps/server/src/query.ts":
      'import { sessions, managementSessions } from "@waitron/db"; select(sessions, managementSessions); sql`from sessions s join devices d`; sql`from "sessions"`; sql`select * from sessions where id = 1`;',
    "packages/db/drizzle/0000_baseline.sql": "from sessions",
  });
  run({ root, write: true });
  expect(existsSync(join(root, "packages/db/src/schema/identity/sessions.ts"))).toBe(false);
  expect(read(root, "packages/db/src/schema/identity/till-sessions.ts")).toBe(
    'export const tillSessions = table("till_sessions", index("till_sessions_open_idx"));',
  );
  expect(read(root, "packages/db/src/schema/identity/dashboard-sessions.ts")).toBe(
    'export const dashboardSessions = table("dashboard_sessions", index("dashboard_sessions_open_idx"));',
  );
  expect(read(root, "packages/db/src/schema/identity/account-actions.ts")).toBe(
    'export const accountActions = table("account_actions");',
  );
  expect(read(root, "packages/db/src/classification.ts")).toBe(
    '["till_sessions", "dashboard_sessions", "account_actions"]',
  );
  expect(read(root, "apps/server/src/query.ts")).toBe(
    'import { tillSessions, dashboardSessions } from "@waitron/db"; select(tillSessions, dashboardSessions); sql`from till_sessions s join devices d`; sql`from "till_sessions"`; sql`select * from till_sessions where id = 1`;',
  );
  expect(read(root, "packages/db/drizzle/0000_baseline.sql")).toBe("from sessions");
});

it("renames re-exports, relative imports and namespace accesses", () => {
  const root = fixture({
    "packages/db/src/schema/identity/index.ts": 'export { sessions } from "./sessions.js";',
    "packages/identity/src/index.ts": 'export { sessions } from "@waitron/db";',
    "packages/db/src/index.ts": 'export { sessions } from "./schema/index.js";',
    "packages/identity/src/use.ts":
      'import { sessions } from "../../db/src/schema/identity/sessions.js"; export { sessions }; select(sessions);',
    "packages/identity/src/check.ts":
      'import * as schema from "@waitron/db/schema/identity.js"; import * as api from "../src/index.js"; select(schema.sessions, api.sessions);',
    "packages/identity/src/index.test.ts": 'import * as api from "./index.js"; api.sessions;',
  });
  run({ root, write: true });
  expect(read(root, "packages/db/src/schema/identity/index.ts")).toBe(
    'export { tillSessions } from "./till-sessions.js";',
  );
  expect(read(root, "packages/identity/src/index.ts")).toBe(
    'export { tillSessions } from "@waitron/db";',
  );
  expect(read(root, "packages/db/src/index.ts")).toBe(
    'export { tillSessions } from "./schema/index.js";',
  );
  expect(read(root, "packages/identity/src/use.ts")).toBe(
    'import { tillSessions } from "../../db/src/schema/identity/till-sessions.js"; export { tillSessions }; select(tillSessions);',
  );
  expect(read(root, "packages/identity/src/check.ts")).toContain(
    "select(schema.tillSessions, api.tillSessions)",
  );
  expect(read(root, "packages/identity/src/index.test.ts")).toBe(
    'import * as api from "./index.js"; api.tillSessions;',
  );
});

it("keeps unrelated session properties, inner bindings and excluded files", () => {
  const unchanged = 'section("sessions"); counted("sessions", n);';
  const root = fixture({
    "apps/server/src/use.ts":
      'import { sessions } from "@waitron/db"; select(sessions); const row = { sessions: 3 }; row.sessions; function inner(sessions) { return sessions; }',
    "packages/workforce-es/src/record-export.ts": unchanged,
    "packages/store/src/index.test.ts": "sql`create table sessions (id text)`;",
    "apps/server/src/device-delete.ts": unchanged,
    "apps/server/src/device-api.delete.test.ts":
      'import { sessions } from "@waitron/identity"; select(sessions); counted("sessions", n);',
    "apps/dashboard/src/a.ts": "managementSessions;",
  });
  run({ root, write: true });
  expect(read(root, "apps/server/src/use.ts")).toBe(
    'import { tillSessions } from "@waitron/db"; select(tillSessions); const row = { sessions: 3 }; row.sessions; function inner(sessions) { return sessions; }',
  );
  expect(read(root, "packages/workforce-es/src/record-export.ts")).toBe(unchanged);
  expect(read(root, "packages/store/src/index.test.ts")).toBe(
    "sql`create table sessions (id text)`;",
  );
  expect(read(root, "apps/dashboard/src/a.ts")).toBe("managementSessions;");
  expect(read(root, "apps/server/src/device-api.delete.test.ts")).toBe(
    'import { tillSessions } from "@waitron/identity"; select(tillSessions); counted("sessions", n);',
  );
});

it("renames account-only SQL and attendance imports while retaining frozen evidence", () => {
  const root = fixture({
    "apps/server/src/account-mail.test.ts": "sql`select * from management_account_actions`;",
    "packages/country-es/test-fixtures/demo/original-exporter.ts.txt":
      'case "management_sessions": break;',
    "apps/server/src/attendance-export-api.test.ts":
      'import { managementSessions } from "@waitron/db"; section("sessions"); select(managementSessions);',
    "packages/identity/src/personal-data.coverage.test.ts":
      'const CLASSIFIED = { sessions: { in: ["id"] } }; ["sessions"];',
  });
  run({ root, write: true });
  expect(read(root, "apps/server/src/account-mail.test.ts")).toBe(
    "sql`select * from account_actions`;",
  );
  expect(read(root, "packages/country-es/test-fixtures/demo/original-exporter.ts.txt")).toBe(
    'case "management_sessions": break;',
  );
  expect(read(root, "apps/server/src/attendance-export-api.test.ts")).toBe(
    'import { dashboardSessions } from "@waitron/db"; section("sessions"); select(dashboardSessions);',
  );
  expect(read(root, "packages/identity/src/personal-data.coverage.test.ts")).toBe(
    'const CLASSIFIED = { till_sessions: { in: ["id"] } }; ["till_sessions"];',
  );
});

it("previews without writing and changes no bytes on a second write", () => {
  const root = fixture({ "packages/db/src/classification.ts": '["sessions"]' });
  expect(run({ root })).toEqual(["packages/db/src/classification.ts"]);
  expect(read(root, "packages/db/src/classification.ts")).toBe('["sessions"]');
  run({ root, write: true });
  expect(run({ root, write: true })).toEqual([]);
  expect(read(root, "packages/db/src/classification.ts")).toBe('["till_sessions"]');
});

it("ports templates and schema paths while retaining captured demo keys", () => {
  const root = fixture({
    "apps/server/src/day.ts":
      'const source = sql`sessions`; sql`from sessions where id = ${id}`; sql`select ${id} from sessions`; sql.raw(`select id from sessions`); "with x as (select id from sessions) select * from x";',
    "packages/db/mutation-costs.json":
      '{"src/schema/identity/sessions.ts":1,"src/schema/identity/management-sessions.ts":2,"src/schema/identity/management-account-actions.ts":3}',
    "packages/country-es/test-fixtures/demo/madrid-before-move.en.json": '{"sessions":[]}',
    "apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts":
      'const tableRenames = { management_sessions: "dashboard_sessions" };',
    "apps/server/src/unused.ts": "const unchanged = 1;",
  });
  run({ root, write: true });
  expect(read(root, "apps/server/src/day.ts")).toBe(
    'const source = sql`till_sessions`; sql`from till_sessions where id = ${id}`; sql`select ${id} from till_sessions`; sql.raw(`select id from till_sessions`); "with x as (select id from till_sessions) select * from x";',
  );
  expect(JSON.parse(read(root, "packages/db/mutation-costs.json"))).toEqual({
    "src/schema/identity/till-sessions.ts": 1,
    "src/schema/identity/dashboard-sessions.ts": 2,
    "src/schema/identity/account-actions.ts": 3,
  });
  expect(read(root, "packages/country-es/test-fixtures/demo/madrid-before-move.en.json")).toBe(
    '{"sessions":[]}',
  );
  expect(read(root, "apps/server/src/unused.ts")).toBe("const unchanged = 1;");
  expect(read(root, "apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts")).toBe(
    'const tableRenames = { management_sessions: "dashboard_sessions" };',
  );
});

it("renames database snapshot table keys while preserving device impact keys", () => {
  const root = fixture({
    "apps/server/src/device-delete.db.test.ts":
      'const snapshot = { sessions: [] }; snapshot.sessions; [["sessions", "device_id"]]; const impact = { key: "sessions" };',
  });
  run({ root, write: true });
  expect(read(root, "apps/server/src/device-delete.db.test.ts")).toBe(
    'const snapshot = { till_sessions: [] }; snapshot.till_sessions; [["till_sessions", "device_id"]]; const impact = { key: "sessions" };',
  );
});

it("keeps prose and shorthand property keys while renaming the imported table value", () => {
  const root = fixture({
    "apps/server/src/a.ts":
      'import { sessions } from "@waitron/db"; export const schema = { sessions }; "Pick up from sessions you missed"; "Sign out of all table sessions"; "select id from sessions";',
  });
  run({ root, write: true });
  expect(read(root, "apps/server/src/a.ts")).toBe(
    'import { tillSessions } from "@waitron/db"; export const schema = { sessions: tillSessions }; "Pick up from sessions you missed"; "Sign out of all table sessions"; "select id from till_sessions";',
  );
});

it("the CLI previews by default and writes only with --write", async () => {
  const root = fixture({ "packages/db/src/classification.ts": '["sessions"]' });
  const argv = process.argv;
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    process.argv = ["node", fileURLToPath(new URL("./pp1-sign-in-renames.mjs", import.meta.url))];
    vi.resetModules();
    await import("./pp1-sign-in-renames.mjs");
    expect(output.mock.calls.map(([line]) => line).join("")).toBe(
      "packages/db/src/classification.ts\n",
    );
    expect(read(root, "packages/db/src/classification.ts")).toBe('["sessions"]');
    process.argv.push("--write");
    vi.resetModules();
    await import("./pp1-sign-in-renames.mjs");
    expect(read(root, "packages/db/src/classification.ts")).toBe('["till_sessions"]');
  } finally {
    process.argv = argv;
    cwd.mockRestore();
    output.mockRestore();
    vi.resetModules();
  }
});

it.each([
  ["sessions", "tillSessions"],
  ["managementSessions", "dashboardSessions"],
  ["managementAccountActions", "accountActions"],
])("refuses a %s collision before writing anything", (oldName, newName) => {
  const root = fixture({
    "apps/server/src/a.ts": "sql`from management_sessions`;",
    "apps/server/src/collision.ts": `import { ${oldName} } from "@waitron/db"; const ${newName} = 1;`,
  });
  expect(() => run({ root, write: true })).toThrow("apps/server/src/collision.ts");
  expect(read(root, "apps/server/src/a.ts")).toBe("sql`from management_sessions`;");
});
