import { expect, it } from "vitest";
import { foldInserts } from "./lib/fold-inserts.mjs";
import { rules } from "./fk1-zone-fixtures.mjs";

const path = "apps/server/src/zones.test.ts";
it.each([
  [
    "service",
    "db.insert(zoneServicePolicies).values({ zoneId: Z, departmentId: D, isCounterDefault: true, locationId: L });",
    "db.update(floorZones).set({ departmentId: D, isCounterDefault: true }).where(eq(floorZones.id, Z));",
  ],
  [
    "sale",
    "db.insert(zoneSalePolicies).values({ zoneId: Z, orderStart: 'counter', paidWhen: 'prepay', collectionNumber: true, receiptPrintMode: 'always' });",
    "db.update(floorZones).set({ orderStart: 'counter', paidWhen: 'prepay', collectionNumber: true, receiptPrintMode: 'always' }).where(eq(floorZones.id, Z));",
  ],
  ["empty sale", "await db.insert(zoneSalePolicies).values({ zoneId: Z });", ""],
  [
    "raw service",
    "tx.execute(sql`insert into zone_service_policies (zone_id, department_id, is_counter_default, location_id) values (${Z}, ${D}, 1, ${L})`);",
    "tx.execute(sql`update floor_zones set department_id = ${D}, is_counter_default = 1 where id = ${Z}`);",
  ],
  [
    "raw sale",
    "tx.execute(sql`insert into zone_sale_policies (zone_id, order_start, paid_when, collection_number, receipt_print_mode) values (${Z}, 'counter', 'prepay', 1, 'always')`);",
    "tx.execute(sql`update floor_zones set order_start = 'counter', paid_when = 'prepay', collection_number = 1, receipt_print_mode = 'always' where id = ${Z}`);",
  ],
  [
    "raw empty sale",
    "await tx.execute(sql`insert into zone_sale_policies (zone_id) values (${Z})`);",
    "",
  ],
])("fk1 folds %s without touching the test tree", (_name, input, expected) => {
  const imports = 'import { eq } from "drizzle-orm";\nimport { floorZones } from "@waitron/db";\n';
  const result = foldInserts(imports + input, path, rules);
  expect(result).toEqual({ text: imports + expected, reports: [] });
  expect(foldInserts(result.text, path, rules)).toEqual(result);
});
