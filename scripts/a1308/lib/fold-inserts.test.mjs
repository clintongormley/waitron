import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import * as library from "./fold-inserts.mjs";
import { foldInserts } from "./fold-inserts.mjs";

const path = "apps/server/src/fold.test.ts";
const rule = {
  child: "policies",
  parent: "floorZones",
  key: "zoneId",
  fields: { enabled: "active", locationId: null },
  raw: {
    childTable: "policies",
    parentTable: "floor_zones",
    key: "zone_id",
    columns: { enabled: "active", location_id: null },
  },
};
const imports = 'import { eq } from "drizzle-orm";\nimport { floorZones } from "@waitron/db";\n';

describe("foldInserts", () => {
  it.each([
    [
      "one field",
      "db.insert(policies).values({ zoneId: Z, enabled: true });",
      "db.update(floorZones).set({ active: true }).where(eq(floorZones.id, Z));",
    ],
    [
      "dropped field",
      "await tx.insert(policies).values({ zoneId: Z, locationId: L, enabled });",
      "await tx.update(floorZones).set({ active: enabled }).where(eq(floorZones.id, Z));",
    ],
    [
      "conflict clause",
      "db.insert(policies).values({ zoneId: Z, enabled: false }).onConflictDoNothing();",
      "db.update(floorZones).set({ active: false }).where(eq(floorZones.id, Z));",
    ],
    [
      "conflict update",
      "db.insert(policies).values({ zoneId: Z, enabled: true }).onConflictDoUpdate({ target: policies.zoneId, set: { enabled: false } });",
      "db.update(floorZones).set({ active: true }).where(eq(floorZones.id, Z));",
    ],
    ["nothing to set", "await tx.insert(policies).values({ zoneId: Z, locationId: L });", ""],
  ])("rewrites %s and is unchanged on a second pass", (_name, input, expected) => {
    const source = imports + input;
    const out = foldInserts(source, path, [rule]);
    expect(out).toEqual({ text: imports + expected, reports: [] });
    expect(foldInserts(out.text, path, [rule])).toEqual(out);
  });

  it("adds a constant and uses the named parent key", () => {
    const out = foldInserts(imports + "db.insert(policies).values({ zoneId });", path, [
      { ...rule, parentKey: "key", constants: { active: "false" } },
    ]);
    expect(out.text).toBe(
      imports + "db.update(floorZones).set({ active: false }).where(eq(floorZones.key, zoneId));",
    );
    expect(out.reports).toEqual([]);
  });

  it.each([
    "[{ zoneId: Z, enabled: true }]",
    "{ zoneId: Z, ...values }",
    "{ [key]: Z, enabled: true }",
    "{ enabled: true }",
    "{ zoneId: Z, unexpected: true }",
  ])("reports unsupported values %s without changing them", (values) => {
    const source = `db.insert(policies).values(${values});`;
    const out = foldInserts(source, path, [rule]);
    expect(out.text).toBe(source);
    expect(out.reports).toEqual([expect.stringMatching(/^apps\/server\/src\/fold.test.ts:1: /)]);
  });

  it("reports returning rather than discarding the result", () => {
    const source =
      "const rows = await db.insert(policies).values({ zoneId: Z, enabled: true }).returning();";
    const out = foldInserts(source, path, [rule]);
    expect(out.text).toBe(source);
    expect(out.reports).toEqual([expect.stringContaining("returning")]);
  });

  it("adds the parent and eq imports, removing only an unused child import", () => {
    const source =
      'import { policies, other } from "@waitron/db";\nawait db.insert(policies).values({ zoneId: Z, enabled: true });\nread(other);';
    const out = foldInserts(source, path, [rule]);
    expect(out.text).toContain('import { eq } from "drizzle-orm";');
    expect(out.text).toContain('import { other, floorZones } from "@waitron/db";');
    expect(out.text).not.toContain("policies");
    expect(out.text).toContain("read(other);");
    expect(out.reports).toEqual([]);
  });

  it("keeps a child import still used by a read", () => {
    const source =
      'import { policies } from "@waitron/db";\nawait db.insert(policies).values({ zoneId: Z, enabled: true });\nread(policies);';
    expect(foldInserts(source, path, [rule]).text).toContain("policies");
  });

  it("folds several inserts in a db helper, preserving its default import", () => {
    const source =
      'import db, { policies } from "./fixture.js";\n' +
      "await db.insert(policies).values({ zoneId: A, enabled: true });\n" +
      "await db.insert(policies).values({ zoneId: B, enabled: false });";
    const result = foldInserts(source, "packages/db/src/testing/zones.ts", [rule]);
    expect(result).toEqual({
      text:
        'import { eq } from "drizzle-orm";\nimport { floorZones } from "../index.js";\nimport db from "./fixture.js";\n' +
        "await db.update(floorZones).set({ active: true }).where(eq(floorZones.id, A));\n" +
        "await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, B));",
      reports: [],
    });
  });

  it("rewrites raw SQL substitutions, drops columns, and is idempotent", () => {
    const source =
      "await tx.execute(sql`insert into policies (zone_id, enabled, location_id) values (${zone}, 1, ${location})`);";
    const out = foldInserts(source, path, [rule]);
    expect(out).toEqual({
      text: "await tx.execute(sql`update floor_zones set active = 1 where id = ${zone}`);",
      reports: [],
    });
    expect(foldInserts(out.text, path, [rule])).toEqual(out);
  });

  it.each([
    "insert into policies (zone_id, enabled) values (${zone}, coalesce(1, 0))",
    "insert into policies (zone_id, enabled) values (${zone})",
    "delete from policies where zone_id = ${zone}",
  ])("reports unsupported raw SQL: %s", (query) => {
    const source = `tx.execute(sql\`${query}\`);`;
    const out = foldInserts(source, path, [rule]);
    expect(out.text).toBe(source);
    expect(out.reports).toEqual([expect.stringContaining(":1:")]);
  });

  it.each([
    "apps/server/src/live.ts",
    "packages/db/src/schema/floor-zones.test.ts",
    "/tmp/candidate/packages/db/src/schema/floor-zones.test.ts",
  ])("leaves %s alone", (file) => {
    const text = "db.insert(policies).values({ zoneId: Z, enabled: true });";
    expect(foldInserts(text, file, [rule])).toEqual({ text, reports: [] });
  });

  it("previews the command line, writes on request, and reports manual sites", async () => {
    const root = mkdtempSync(join(tmpdir(), "fold-cli-"));
    const saved = process.argv;
    onTestFinished(() => {
      process.argv = saved;
      rmSync(root, { recursive: true, force: true });
    });
    const file = join(root, "fixture.test.ts");
    const source = imports + "db.insert(policies).values({ zoneId: Z, enabled: true });";
    writeFileSync(file, source);
    process.argv = ["node", "fold.mjs", file];
    await library.runFoldCli([rule]);
    expect(readFileSync(file, "utf8")).toBe(source);
    process.argv = ["node", "fold.mjs", "--write", file];
    await library.runFoldCli([rule]);
    expect(readFileSync(file, "utf8")).toBe(
      imports + "db.update(floorZones).set({ active: true }).where(eq(floorZones.id, Z));",
    );
    await library.runFoldCli([rule]);
    writeFileSync(file, "db.insert(policies).values(rows);");
    const lines = [];
    const output = console.log;
    console.log = (line) => lines.push(line);
    try {
      await library.runFoldCli([rule]);
    } finally {
      console.log = output;
    }
    expect(lines).toEqual([`${file}:1: unsupported insert values`]);
    expect(readFileSync(file, "utf8")).toBe("db.insert(policies).values(rows);");
  });

  it("runs an extra rewrite only on fixture files", async () => {
    const root = mkdtempSync(join(tmpdir(), "fold-extra-")),
      saved = process.argv;
    onTestFinished(() => {
      process.argv = saved;
      rmSync(root, { recursive: true, force: true });
    });
    const test = join(root, "fixture.test.ts"),
      live = join(root, "live.ts");
    for (const file of [test, live]) writeFileSync(file, "before");
    process.argv = ["node", "fold.mjs", "--write", test, live];
    await library.runFoldCli([], () => ({ text: "after", reports: [] }));
    expect(readFileSync(test, "utf8")).toBe("after");
    expect(readFileSync(live, "utf8")).toBe("before");
  });
});
