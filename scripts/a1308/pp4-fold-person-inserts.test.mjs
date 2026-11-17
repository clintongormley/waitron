import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { run, rewrite } from "./pp4-fold-person-inserts.mjs";

const imports = 'import { persons } from "@waitron/db";\n';
const path = "apps/server/src/person.test.ts";
const roots = [];
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each([
  "{ displayName: 'Ada' }",
  "[{ displayName: 'Ada' }]",
  "rows",
  "seeds.map(row => ({ ...row }))",
])("wraps insert argument %s once", (input) => {
  const result = rewrite(imports + `db.insert(persons).values(${input}).returning();`, path);
  expect(result).toContain(
    `db.insert(persons).values(withFoldedPersonKeys(${input})).returning();`,
  );
  expect(result).toContain('import { persons, withFoldedPersonKeys } from "@waitron/db";');
  expect(rewrite(result, path)).toBe(result);
});
it("wraps updates and namespace inserts with one import per helper", () => {
  const input =
    'import * as schema from "@waitron/db/schema/identity.js";\n' +
    "db.update(schema.persons).set({ email: null }).where(condition); db.insert(schema.persons).values(row); db.insert(schema.persons).values(other);";
  const result = rewrite(input, path);
  expect(result).toContain(
    "db.update(schema.persons).set(withFoldedPersonChanges({ email: null })).where(condition);",
  );
  expect(result).toContain("db.insert(schema.persons).values(withFoldedPersonKeys(row));");
  expect(result).toContain("db.insert(schema.persons).values(withFoldedPersonKeys(other));");
  expect(result).toContain(
    'import { withFoldedPersonChanges, withFoldedPersonKeys } from "@waitron/db";',
  );
  expect(result.match(/import \{ withFoldedPersonChanges,/g)).toHaveLength(1);
  expect(rewrite(result, path)).toBe(result);
});
it("recognizes aliases and relative schema imports but leaves other tables alone", () => {
  const input =
    'import { persons as people } from "./persons.js";\n' +
    "db.insert(people).values(row); db.insert(orders).values(row);";
  const result = rewrite(input, path);
  expect(result).toContain("db.insert(people).values(withFoldedPersonKeys(row));");
  expect(result).toContain("db.insert(orders).values(row);");
  expect(
    rewrite('import { persons } from "unrelated"; db.insert(persons).values(row);', path),
  ).toBe('import { persons } from "unrelated"; db.insert(persons).values(row);');
});
function fixture(source) {
  const root = mkdtempSync(join(tmpdir(), "wt-pp4-"));
  roots.push(root);
  mkdirSync(join(root, "apps/server/src"), { recursive: true });
  writeFileSync(join(root, path), source);
  execFileSync("git", ["init", "-q", root], { env });
  execFileSync("git", ["-C", root, "add", "."], { env });
  return root;
}
it("reports dry-run paths, writes tracked sources, and is idempotent under a foreign Git environment", () => {
  const root = fixture(imports + "db.insert(persons).values(row);");
  expect(run({ root })).toEqual([path]);
  expect(readFileSync(join(root, path), "utf8")).not.toContain("withFoldedPersonKeys");
  expect(run({ root, write: true })).toEqual([path]);
  const result = readFileSync(join(root, path), "utf8");
  expect(result).toContain("values(withFoldedPersonKeys(row))");
  expect(run({ root, write: true })).toEqual([]);
  const script = fileURLToPath(new URL("./pp4-fold-person-inserts.mjs", import.meta.url));
  const child = spawnSync(process.execPath, [script, "--write"], {
    cwd: root,
    env: { ...env, GIT_DIR: "/nonexistent/pp4" },
    encoding: "utf8",
  });
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toBe("");
});
it("refuses malformed source naming the file before any write", () => {
  const source = imports + "db.insert(persons).values({ displayName: );";
  const root = fixture(source);
  expect(() => run({ root, write: true })).toThrow(path);
  expect(readFileSync(join(root, path), "utf8")).toBe(source);
});

it.each(["db.insert(persons).values()", "db.update(persons).set(...changes)"])(
  "refuses an unwrappable argument: %s",
  (call) => {
    expect(() => rewrite(imports + call, path)).toThrow(`${path}: cannot wrap person`);
  },
);
it("prints rewritten tracked paths through the command entry point", async () => {
  const root = fixture(imports + "db.insert(persons).values(row);");
  const cwd = process.cwd(),
    argv = process.argv,
    output = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  try {
    process.chdir(root);
    process.argv = [
      process.execPath,
      fileURLToPath(new URL("./pp4-fold-person-inserts.mjs", import.meta.url)),
      "--write",
    ];
    vi.resetModules();
    await import("./pp4-fold-person-inserts.mjs");
  } finally {
    process.chdir(cwd);
    process.argv = argv;
    stdout.mockRestore();
  }
  expect(output).toEqual([`${path}\n`]);
  expect(readFileSync(join(root, path), "utf8")).toContain("values(withFoldedPersonKeys(row))");
});
