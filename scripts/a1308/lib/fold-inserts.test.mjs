import { URL } from "node:url";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
  fields: { enabled: "active", retiredId: null },
  raw: {
    childTable: "policies",
    parentTable: "floor_zones",
    key: "zone_id",
    columns: { enabled: "active", retired_id: null },
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
      "await tx.insert(policies).values({ zoneId: Z, retiredId: L, enabled });",
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
    ["nothing to set", "await tx.insert(policies).values({ zoneId: Z, retiredId: L });", ""],
  ])("rewrites %s and is unchanged on a second pass", (_name, input, expected) => {
    const source = imports + input;
    const out = foldInserts(source, path, [rule]);
    expect(out).toEqual({ text: imports + expected, reports: [] });
    expect(foldInserts(out.text, path, [rule])).toEqual(out);
  });

  it("keeps side-effect, default and namespace imports while folding a fixture", () => {
    const source =
      'import "./setup.js";\nimport setup from "./default.js";\nimport * as helpers from "./helpers.js";\n';
    const result = foldInserts(
      source + "await db.insert(policies).values({ zoneId: Z, enabled: true });",
      path,
      [rule],
    );
    expect(result).toEqual({
      text:
        imports +
        source +
        "await db.update(floorZones).set({ active: true }).where(eq(floorZones.id, Z));",
      reports: [],
    });
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

  it.each([
    "packages/db/src/testing/zones.ts",
    "./packages/db/src/testing/zones.ts",
    join(process.cwd(), "packages/db/src/testing/zones.ts"),
  ])("folds several inserts in db helper %s, preserving its default import", (file) => {
    const source =
      'import db, { policies } from "./fixture.js";\n' +
      "await db.insert(policies).values({ zoneId: A, enabled: true });\n" +
      "await db.insert(policies).values({ zoneId: B, enabled: false });";
    const result = foldInserts(source, file, [rule]);
    expect(result).toEqual({
      text:
        'import { eq } from "drizzle-orm";\nimport { floorZones } from "../index.js";\nimport db from "./fixture.js";\n' +
        "await db.update(floorZones).set({ active: true }).where(eq(floorZones.id, A));\n" +
        "await db.update(floorZones).set({ active: false }).where(eq(floorZones.id, B));",
      reports: [],
    });
  });

  it.each(["1", "'a,b'"])(
    "rewrites raw SQL value %s, drops columns, and is idempotent",
    (value) => {
      const source =
        "await tx.execute(sql`insert into policies (zone_id, enabled, retired_id) values (${zone}, " +
        value +
        ", ${retiredValue})`);";
      const out = foldInserts(source, path, [rule]);
      expect(out).toEqual({
        text:
          "await tx.execute(sql`update floor_zones set active = " +
          value +
          " where id = ${zone}`);",
        reports: [],
      });
      expect(foldInserts(out.text, path, [rule])).toEqual(out);
    },
  );

  it("removes a raw insert with only the folded key and stays unchanged on a second pass", () => {
    const source = "await tx.execute(sql`insert into policies (zone_id) values (${Z})`);";
    const out = foldInserts(source, path, [rule]);
    expect(out).toEqual({ text: "", reports: [] });
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

  it.each([
    "await Promise.all([tx.execute(sql`insert into policies (zone_id) values (${Z})`), seedOther(tx)]);",
    "expect(await tx.execute(sql`insert into policies (zone_id) values (${Z})`)).toBeTruthy();",
    "await expect(tx.execute(sql`insert into policies (zone_id, enabled) values (${Z}, 1)`)).rejects.toThrow();",
    "await expectInsertFails(sql`insert into policies (zone_id) values (${Z})`);",
    "if (withPolicy) await db.insert(policies).values({ zoneId: Z });\nawait mustAlwaysRun();",
    "if (withPolicy) await tx.execute(sql`insert into policies (zone_id) values (${Z})`);\nawait mustAlwaysRun();",
    "await expect(db.insert(policies).values({ zoneId: Z, enabled: true })).rejects.toThrow();",
    "db.insert(policies).values({ zoneId: Z, enabled: true }).run();",
    "db.insert(policies).values({ zoneId: Z, enabled: true }).then(done).catch(fail);",
  ])("reports a wrapped or chained insert instead of changing its meaning: %s", (text) => {
    const out = foldInserts(text, path, [rule]);
    expect(out.text).toBe(text);
    expect(out.reports).toEqual([expect.stringContaining(":1:")]);
  });

  it("keeps a parent table already imported through another module", () => {
    const source =
      'import { floorZones } from "./zones.js";\ndb.insert(policies).values({ zoneId: Z, enabled: true });';
    expect(foldInserts(source, path, [rule])).toEqual({
      text: 'import { eq } from "drizzle-orm";\nimport { floorZones } from "./zones.js";\ndb.update(floorZones).set({ active: true }).where(eq(floorZones.id, Z));',
      reports: [],
    });
  });

  it.each([
    'import type { floorZones } from "@waitron/db";',
    'import { type floorZones } from "@waitron/db";',
  ])("reports a type-only table binding for a manual edit: %s", (binding) => {
    const text =
      binding +
      "\ntype Zone = typeof floorZones;\ndb.insert(policies).values({ zoneId: Z, enabled: true });";
    const out = foldInserts(text, path, [rule]);
    expect(out.text).toBe(text);
    expect(out.reports).toEqual([expect.stringContaining("type-only")]);
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
    const lines = [],
      output = console.log;
    console.log = (line) => lines.push(line);
    onTestFinished(() => {
      console.log = output;
    });
    await library.runFoldCli([rule]);
    expect(readFileSync(file, "utf8")).toBe(source);
    expect(lines).toEqual([`${file}: would rewrite`]);
    process.argv = ["node", "fold.mjs", "--write", file];
    await library.runFoldCli([rule]);
    expect(readFileSync(file, "utf8")).toBe(
      imports + "db.update(floorZones).set({ active: true }).where(eq(floorZones.id, Z));",
    );
    await library.runFoldCli([rule]);
    writeFileSync(file, "db.insert(policies).values(rows);");
    lines.length = 0;
    try {
      await library.runFoldCli([rule]);
    } finally {
      console.log = output;
    }
    expect(lines).toEqual([`${file}:1: unsupported insert values`]);
    expect(readFileSync(file, "utf8")).toBe("db.insert(policies).values(rows);");
    const alias = join(root, "fold.mjs");
    const command = join(root, "command.mjs");
    writeFileSync(
      command,
      `import { runFoldCli } from ${JSON.stringify(new URL("./fold-inserts.mjs", import.meta.url).href)};\nawait runFoldCli([{ child: "zoneSalePolicies", parent: "floorZones", key: "zoneId", fields: { paidWhen: "paidWhen" } }]);`,
    );
    symlinkSync(command, alias);
    writeFileSync(
      file,
      imports + 'db.insert(zoneSalePolicies).values({ zoneId: Z, paidWhen: "prepay" });',
    );
    const child = spawnSync(process.execPath, [alias, "--write", file], {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(child.status, child.stderr).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(
      imports + 'db.update(floorZones).set({ paidWhen: "prepay" }).where(eq(floorZones.id, Z));',
    );
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
