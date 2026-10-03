import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect, getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { id, table } from "./columns.js";
import { originChecks, saleSourceColumn, sourceColumn } from "./origin.js";

const probe = table(
  "origin_probe",
  { source: sourceColumn("source").notNull(), deviceId: id("device_id") },
  (t) => originChecks("origin_probe", t.source, t.deviceId),
);
const saleProbe = table(
  "sale_origin_probe",
  { source: saleSourceColumn("source").notNull(), deviceId: id("device_id") },
  (t) => originChecks("sale_origin_probe", t.source, t.deviceId),
);

const render = (fragment: SQL) => new SQLiteSyncDialect().sqlToQuery(fragment).sql;

/** The table's DDL with its checks as drizzle renders them (the way `columns.test.ts` renders one). */
function ddl(t: typeof probe | typeof saleProbe): string {
  const config = getTableConfig(t);
  const checks = config.checks.map(
    (c) => `constraint "${c.name}" check (${render(c.value).replaceAll(`"${config.name}".`, "")})`,
  );
  return `create table "${config.name}" ("source" text not null, "device_id" text, ${checks.join(", ")})`;
}

describe("originChecks", () => {
  it("names the two checks after the table", () => {
    expect(getTableConfig(probe).checks.map((c) => c.name)).toEqual([
      "origin_probe_source_ck",
      "origin_probe_source_device_ck",
    ]);
  });

  it("refuses an unknown source and an unpaired device, and accepts the pairs", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(ddl(probe));
    const insert = db.prepare("insert into origin_probe (source, device_id) values (?, ?)");
    insert.run("device", "d1");
    insert.run("dashboard", null);
    expect(() => insert.run("system", null)).toThrow(/origin_probe_source_ck/);
    expect(() => insert.run("device", null)).toThrow(/origin_probe_source_device_ck/);
    expect(() => insert.run("payment_check", "d1")).toThrow(/origin_probe_source_device_ck/);
  });

  it("a sale table refuses the dashboard", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(ddl(saleProbe));
    const insert = db.prepare("insert into sale_origin_probe (source, device_id) values (?, ?)");
    insert.run("demo_seed", null);
    expect(() => insert.run("dashboard", null)).toThrow(/sale_origin_probe_source_ck/);
  });
});
