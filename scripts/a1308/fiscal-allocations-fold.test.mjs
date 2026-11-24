import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
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
