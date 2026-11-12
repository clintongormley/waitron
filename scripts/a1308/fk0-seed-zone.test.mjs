import { expect, it } from "vitest";
import { rewriteSeedZones } from "./fk0-seed-zone.mjs";

const path = "apps/server/src/zones.test.ts";
const header = 'import { seedZone } from "@waitron/db/testing/seed.js";\n';
it.each([
  ["await db.insert(floorZones).values({ name: 'Bar' });", "await seedZone(db, { name: 'Bar' });"],
  [
    "const [zone] = await tx.insert(floorZones).values({ name: 'Bar' }).returning({ id: floorZones.id });",
    "const zone = await seedZone(tx, { name: 'Bar' });",
  ],
  [
    "const [zone] = await db.insert(floorZones).values({ name: 'Bar' }).returning();\nuse(zone!.id);",
    "const zone = await seedZone(db, { name: 'Bar' });\nuse(zone!.id);",
  ],
])("rewrites a plain zone insert and preserves later id reads (%s)", (input, expected) => {
  const result = rewriteSeedZones(input, path);
  expect(result).toEqual({ text: header + expected, reports: [] });
  expect(rewriteSeedZones(result.text, path)).toEqual(result);
});
it("uses the local seed module inside db", () => {
  const result = rewriteSeedZones(
    "await db.insert(floorZones).values({ name: 'Bar' });",
    "packages/db/src/testing/example.test.ts",
  );
  expect(result.text).toContain('import { seedZone } from "./seed.js";');
});
it.each([
  [
    "packages/db/src/schema/floor-zones.test.ts",
    "await db.insert(floorZones).values({ name: 'Bar' });",
  ],
  [path, "// a1308-keep: bare zone insert\nawait db.insert(floorZones).values({ name: 'Bar' });"],
])("leaves deliberate schema inserts untouched (%s)", (file, input) => {
  expect(rewriteSeedZones(input, file)).toEqual({ text: input, reports: [] });
});
it.each([
  "await db.insert(floorZones).values([{ name: 'Bar' }]);",
  "await db.insert(floorZones).values({ ...zone });",
  "await db.insert(floorZones).values({ [key]: 'Bar' });",
  "await db.insert(floorZones).values({ name: 'Bar', unknown: true });",
  "const [zone] = await db.insert(floorZones).values({ name: 'Bar' }).returning();\nuse(zone!.name);",
  "const [zone] = await db.insert(floorZones).values({ name: 'Bar' }).returning({ name: floorZones.name });",
  "await db.insert(floorZones).values({ name: 'Bar' }).onConflictDoNothing();",
  'import type { seedZone } from "@waitron/db/testing/seed.js";\nawait db.insert(floorZones).values({ name: "Bar" });',
  'import { seedZone } from "./another-helper.js";\nawait db.insert(floorZones).values({ name: "Bar" });',
  "function seedZone() {}\nawait db.insert(floorZones).values({ name: 'Bar' });",
  "await db.execute(sql`insert into floor_zones (id, name) values (${Z}, 'Bar')`);",
])("reports an unsupported insert without changing it (%s)", (input) => {
  const result = rewriteSeedZones(input, path);
  expect(result.text).toBe(input);
  expect(result.reports).toHaveLength(1);
  expect(result.reports[0]).toMatch(/^apps\/server\/src\/zones.test.ts:\d+: /);
});
