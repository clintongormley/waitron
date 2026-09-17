import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  table,
  id,
  ts,
  json,
  money,
  quantity,
  rate,
  enumText,
  flag,
  count,
  label,
} from "./columns.js";

const probe = table("probe", {
  pk: id("pk").primaryKey().defaultRandom(),
  at: ts("at"),
  doc: json<{ a: number }>("doc"),
  amount: money("amount"),
  qty: quantity("qty"),
  vat: rate("vat"),
  kind: enumText("kind", ["cash_sale", "manual"] as const),
  on: flag("on"),
  n: count("n"),
  name: label("name"),
});

const columnsOf = () => Object.fromEntries(getTableConfig(probe).columns.map((c) => [c.name, c]));

describe("the column vocabulary emits today's PostgreSQL types", () => {
  it("keeps the exact SQL type of every helper", () => {
    const c = columnsOf();
    expect(c.pk.getSQLType()).toBe("uuid");
    expect(c.at.getSQLType()).toBe("timestamp with time zone");
    expect(c.doc.getSQLType()).toBe("jsonb");
    expect(c.amount.getSQLType()).toBe("numeric(12, 2)");
    expect(c.qty.getSQLType()).toBe("numeric(12, 3)");
    expect(c.vat.getSQLType()).toBe("numeric(5, 2)");
    expect(c.kind.getSQLType()).toBe("text");
    expect(c.on.getSQLType()).toBe("boolean");
    expect(c.n.getSQLType()).toBe("integer");
    expect(c.name.getSQLType()).toBe("text");
  });

  it("gives a timestamp column date mode, not string mode", () => {
    // mode: "date" is what every existing caller uses; string mode would change
    // what every read returns without changing the column type, so the type
    // assertion above cannot catch it.
    expect(columnsOf().at.mapFromDriverValue("2026-09-16T10:00:00Z")).toBeInstanceOf(Date);
  });
});
