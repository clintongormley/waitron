import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { main, transformSource } from "./drop-location-id.mjs";

const options = {
  tables: ["shifts"],
  helperProps: ["seedKitchenStation.locationId"],
  helperArgs: ["seedNode#1"],
};
const fixtures = [
  [
    "exported venue",
    'import { venueLocationId } from "@waitron/db";\nexport const venueId = await venueLocationId(db);\ndb.insert(shifts).values({ locationId: venueId, personId });',
    'import { venueLocationId } from "@waitron/db";\nexport const venueId = await venueLocationId(db);\ndb.insert(shifts).values({ personId });',
  ],
  [
    "next property comment",
    "db.insert(shifts).values({\n  locationId: venue,\n  // The person who works it.\n  personId,\n});",
    "db.insert(shifts).values({\n  // The person who works it.\n  personId,\n});",
  ],
  [
    "listed insert",
    "db.insert(shifts).values({ personId, locationId: venue, startsAt });",
    "db.insert(shifts).values({ personId, startsAt });",
  ],
  [
    "unlisted insert",
    "db.insert(printers).values({ locationId: venue });",
    "db.insert(printers).values({ locationId: venue });",
  ],
  [
    "array insert",
    "db.insert(shifts).values([{ locationId, personId }, { personId, locationId }]);",
    "db.insert(shifts).values([{ personId }, { personId }]);",
  ],
  [
    "update",
    "db.update(shifts).set({ locationId: venue, personId });",
    "db.update(shifts).set({ personId });",
  ],
  [
    "multiline",
    "db.insert(shifts).values({\n  personId,\n  locationId: venue,\n  startsAt,\n});",
    "db.insert(shifts).values({\n  personId,\n  startsAt,\n});",
  ],
  [
    "conflict",
    "db.insert(shifts).values({ locationId, personId }).onConflictDoUpdate({ target: [shifts.personId, shifts.locationId], set: { startsAt } });",
    "db.insert(shifts).values({ personId }).onConflictDoUpdate({ target: [shifts.personId], set: { startsAt } });",
  ],
  [
    "conflict nothing",
    "db.insert(shifts).values({ personId }).onConflictDoNothing({ target: [shifts.locationId, shifts.personId] });",
    "db.insert(shifts).values({ personId }).onConflictDoNothing({ target: [shifts.personId] });",
  ],
  [
    "helper property",
    "seedKitchenStation(db, { locationId, name });",
    "seedKitchenStation(db, { name });",
  ],
  ["helper argument", "seedNode(db, venueId);", "seedNode(db);"],
  ["non-last helper argument", "seedNode(db, venueId, other);", "seedNode(db, venueId, other);"],
  [
    "property helper",
    "fixture.seedKitchenStation(db, { locationId });",
    "fixture.seedKitchenStation(db, { });",
  ],
  [
    "unused venue",
    'import { venueLocationId, withTransaction } from "@waitron/db";\nconst venueId = await venueLocationId(db);\ndb.insert(shifts).values({ locationId: venueId, personId });',
    'import { withTransaction } from "@waitron/db";\ndb.insert(shifts).values({ personId });',
  ],
  [
    "unused import",
    'import { locationId } from "./fixture.js";\nconst venueId = (await locationId(db))!;\ndb.insert(shifts).values({ locationId: venueId, personId });',
    "db.insert(shifts).values({ personId });",
  ],
  [
    "single multiline property",
    "db.insert(shifts).values({\n  locationId,\n});",
    "db.insert(shifts).values({\n});",
  ],
  ["last declaration", "const venueId = await venueLocationId(db);", ""],
  [
    "keep other declarations",
    "const other = read();\nlet venueId;\nconst a = 1, b = 2;",
    "const other = read();\nlet venueId;\nconst a = 1, b = 2;",
  ],
  [
    "keep default import",
    'import db, { venueLocationId } from "@waitron/db";',
    'import db, { } from "@waitron/db";',
  ],
  [
    "keep used import",
    'import { venueLocationId } from "@waitron/db";\nread(venueLocationId);',
    'import { venueLocationId } from "@waitron/db";\nread(venueLocationId);',
  ],
  [
    "default imports",
    'import db from "@waitron/db";\nimport * as ns from "./fixture.js";',
    'import db from "@waitron/db";\nimport * as ns from "./fixture.js";',
  ],
  [
    "other conflict keys",
    "db.insert(shifts).values({ personId }).onConflictDoUpdate({ target: key, set: { personId } });",
    "db.insert(shifts).values({ personId }).onConflictDoUpdate({ target: key, set: { personId } });",
  ],
  [
    "property initializer",
    "const venueId = (fixture.locationId as string);\ndb.insert(shifts).values({ locationId: venueId, personId });",
    "db.insert(shifts).values({ personId });",
  ],
  [
    "unused brand",
    'import { brandLocationId, LocationId, other } from "./fixture.js";\nconst venueId = brandLocationId("id");\ndb.insert(shifts).values({ locationId: venueId });',
    'import { other } from "./fixture.js";\ndb.insert(shifts).values({ });',
  ],
];

describe("location-column codemod", () => {
  it.each(fixtures)("rewrites %s and a second run changes nothing", (_name, source, expected) => {
    const first = transformSource("fixture.ts", source, options);
    expect(first.source).toBe(expected);
    expect(transformSource("fixture.ts", first.source, options).source).toBe(expected);
  });
  it("keeps a declaration still used elsewhere and reports the remaining read", () => {
    const source =
      "const venueId = await venueLocationId(db);\ndb.insert(shifts).values({ locationId: venueId, personId });\nread(venueId);";
    const result = transformSource("fixture.ts", source, options);
    expect(result.source).toContain("const venueId = await venueLocationId(db)");
    expect(result.source).toContain("read(venueId)");
    expect(result.report).toEqual([
      "fixture.ts:1: hand edit: const venueId = await venueLocationId(db);",
    ]);
  });
  it.each([
    "packages/fiscal-verifactu/src/write-path.e2e.test.ts",
    "packages/fiscal-verifactu/src/inmutabilidad.test.ts",
  ])("never rewrites %s", (path) => {
    const source = "db.insert(shifts).values({ locationId });";
    expect(transformSource(path, source, options)).toEqual({
      source,
      report: [`${path}: fiscal pair file: never rewritten`],
    });
  });
  it("reports raw SQL and leaves dynamic values and unlisted updates alone", () => {
    const source =
      "db.execute(sql`select location_id from shifts`);\ndb.insert(shifts).values(rows);\ndb.update(printers).set({ locationId });";
    const result = transformSource("fixture.ts", source, options);
    expect(result.source).toBe(source);
    expect(result.report).toEqual([
      "fixture.ts:1: hand edit: db.execute(sql`select location_id from shifts`);",
      "fixture.ts:3: hand edit: db.update(printers).set({ locationId });",
    ]);
  });
  it("the command previews without writing, applies selected helpers and tables, then is idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "a1308-location-"));
    try {
      const path = join(dir, "fixture.ts");
      const source =
        "db.insert(shifts).values({ locationId, personId });\nseedNode(db, venue);\nseedKitchenStation(db, { locationId });";
      writeFileSync(path, source);
      const args = [
        "scripts/a1308/drop-location-id.mjs",
        "--tables",
        "shifts",
        "--helper-prop",
        "seedKitchenStation.locationId",
        "--helper-arg",
        "seedNode#1",
        path,
      ];
      const preview = spawnSync(process.execPath, args, { encoding: "utf8" });
      expect(preview.status).toBe(0);
      expect(preview.stdout).toContain("db.insert(shifts).values({ personId })");
      expect(readFileSync(path, "utf8")).toBe(source);
      const applied = spawnSync(process.execPath, [...args, "--write"], { encoding: "utf8" });
      expect(applied.status).toBe(0);
      const written = readFileSync(path, "utf8");
      expect(written).toBe(
        "db.insert(shifts).values({ personId });\nseedNode(db);\nseedKitchenStation(db, { });",
      );
      expect(spawnSync(process.execPath, [...args, "--write"], { encoding: "utf8" }).status).toBe(
        0,
      );
      expect(readFileSync(path, "utf8")).toBe(written);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it("the runner previews and writes files while reporting leftovers", () => {
    const dir = mkdtempSync(join(tmpdir(), "a1308-location-runner-"));
    const output = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      const path = join(dir, "fixture.ts");
      const input =
        "db.insert(shifts).values({ locationId, personId });\nseedNode(db, venue);\nseedKitchenStation(db, { locationId });\nread(locationId);";
      writeFileSync(path, input);
      const args = [
        "--tables",
        "shifts",
        "--helper-prop",
        "seedKitchenStation.locationId",
        "--helper-arg",
        "seedNode#1",
        path,
      ];
      main(args);
      expect(readFileSync(path, "utf8")).toBe(input);
      expect(output.join("")).toContain("db.insert(shifts).values({ personId })");
      expect(output.join("")).toContain(`${path}:4: hand edit: read(locationId);`);
      main([...args, "--write"]);
      const written = readFileSync(path, "utf8");
      expect(written).toBe(
        "db.insert(shifts).values({ personId });\nseedNode(db);\nseedKitchenStation(db, { });\nread(locationId);",
      );
      main([...args, "--write"]);
      expect(readFileSync(path, "utf8")).toBe(written);
    } finally {
      stdout.mockRestore();
      rmSync(dir, { recursive: true });
    }
  });
  it("runs as a command when started through a symlinked directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "a1308-location-link-"));
    try {
      symlinkSync(import.meta.dirname, join(dir, "linked"));
      const missing = join(dir, "missing.ts");
      const run = spawnSync(
        process.execPath,
        [join(dir, "linked", "drop-location-id.mjs"), missing],
        { encoding: "utf8" },
      );
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`ENOENT: no such file or directory, open '${missing}'`);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

it("drops old-table keys before renaming imports and uses, while keeping property names and strings", () => {
  const input =
    'import { oldTable, oldTable as renamed } from "db";\nawait db.insert(oldTable).values({ locationId: venue, day });\nconst view = { oldTable: oldTable, text: "oldTable" };\nview.oldTable;\nconst short = { oldTable };';
  const opts = { tables: ["oldTable"], renameIdentifiers: ["oldTable=newTable"] };
  const expected =
    'import { newTable, newTable as renamed } from "db";\nawait db.insert(newTable).values({ day });\nconst view = { oldTable: newTable, text: "oldTable" };\nview.oldTable;\nconst short = { oldTable: newTable };';
  const first = transformSource("fixture.ts", input, opts).source;
  expect(first).toBe(expected);
  expect(transformSource("fixture.ts", first, opts).source).toBe(expected);
});
