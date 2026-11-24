import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { expect, it, vi } from "vitest";
import { rewriteSource } from "./fiscal-allocations-fold.mjs";

it("repoints bare reads and removes an unused table import", () => {
  const input = [
    'import { fiscalAllocations, verifactuIdentities } from "@waitron/fiscal-verifactu";',
    "const rows = await copy.venue.select().from(fiscalAllocations);",
    "const also = (await db.select().from(fiscalAllocations))[0];",
    "const identities = db.select().from(verifactuIdentities);",
  ].join("\n");
  const expected = [
    'import { allocationRows } from "@waitron/fiscal-verifactu/test/allocation-rows.js";',
    'import { verifactuIdentities } from "@waitron/fiscal-verifactu";',
    "const rows = await allocationRows(copy.venue);",
    "const also = (await allocationRows(db))[0];",
    "const identities = db.select().from(verifactuIdentities);",
  ].join("\n");
  const path = "apps/server/src/fixture.test.ts";
  expect(rewriteSource(path, input)).toEqual({ text: expected, manual: [] });
  expect(rewriteSource(path, expected)).toEqual({ text: expected, manual: [] });
});

it("keeps filtered reads, projections and SQL visible for manual conversion", () => {
  const input = [
    'import { fiscalAllocations } from "./schema/allocations.js";',
    "const all = db.select().from(fiscalAllocations);",
    "const one = db.select().from(fiscalAllocations).where(scope);",
    "const projected = db.select({ key: fiscalAllocations.eventKey }).from(fiscalAllocations);",
    "const raw = sql`select * from fiscal_allocations`;",
  ].join("\n");
  const expected = [
    'import { allocationRows } from "../test/allocation-rows.js";',
    'import { fiscalAllocations } from "./schema/allocations.js";',
    "const all = allocationRows(db);",
    ...input.split("\n").slice(2),
  ].join("\n");
  expect(rewriteSource("packages/fiscal-verifactu/src/example.test.ts", input)).toEqual({
    text: expected,
    manual: [2, 4, 5, 6],
  });
});

it("checks a working tree with an unstaged TypeScript deletion", () => {
  const root = mkdtempSync(join(tmpdir(), "allocation-fold-"));
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
    );
    const options = { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
    execFileSync("git", ["init", "--quiet"], options);
    mkdirSync(join(root, "packages"));
    const source = join(root, "packages/retired.ts");
    writeFileSync(source, "export const fiscalAllocations = {};");
    execFileSync("git", ["add", "packages/retired.ts"], options);
    rmSync(source);
    const script = fileURLToPath(new URL("./fiscal-allocations-fold.mjs", import.meta.url));
    expect(() => execFileSync(process.execPath, [script, "--check"], options)).not.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("checks and rewrites a repository when launched through a symlink", async () => {
  const root = mkdtempSync(join(tmpdir(), "allocation-fold-"));
  const argv = process.argv;
  const cwd = process.cwd();
  const exitCode = process.exitCode;
  const reports = vi.spyOn(console, "log").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
    );
    const options = { cwd: root, env, stdio: "ignore" };
    execFileSync("git", ["init", "--quiet"], options);
    mkdirSync(join(root, "apps"));
    const source = join(root, "apps/example.test.ts");
    const manual = join(root, "apps/report.ts");
    const input =
      'import { fiscalAllocations } from "@waitron/fiscal-verifactu";\n' +
      "const rows = db.select().from(fiscalAllocations);\n";
    const raw = 'const read = "select * from fiscal_allocations";\n';
    writeFileSync(source, input);
    writeFileSync(manual, raw);
    writeFileSync(join(root, "apps/ordinary.ts"), "const ordinary = 1;\n");
    execFileSync("git", ["add", "apps"], options);
    const launch = join(root, "fold.mjs");
    symlinkSync(fileURLToPath(new URL("./fiscal-allocations-fold.mjs", import.meta.url)), launch);
    process.chdir(root);

    async function run(...args) {
      process.argv = [process.execPath, launch, ...args];
      vi.resetModules();
      await import("./fiscal-allocations-fold.mjs");
      return process.exitCode;
    }

    expect(await run("--check")).toBe(1);
    expect(readFileSync(source, "utf8")).toBe(input);
    expect(errors).toHaveBeenCalledWith(
      "apps/example.test.ts: bare allocation reads still need rewriting",
    );
    expect(await run()).toBe(0);
    expect(readFileSync(source, "utf8")).toBe(
      'import { allocationRows } from "@waitron/fiscal-verifactu/test/allocation-rows.js";\n' +
        "const rows = allocationRows(db);\n",
    );
    expect(readFileSync(manual, "utf8")).toBe(raw);
    expect(reports).toHaveBeenCalledWith(
      "apps/report.ts:1: allocation reference needs a hand edit",
    );
    expect(await run("--check")).toBe(0);
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
    process.chdir(cwd);
    reports.mockRestore();
    errors.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});
