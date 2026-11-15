import { sql } from "drizzle-orm";
import { check, unique } from "drizzle-orm/sqlite-core";
import { count, flag, id, json, label, newId, table } from "../columns.js";

export const units = table(
  "units",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    seedKey: label("seed_key"),
    staffName: label("staff_name").notNull(),
    staffAbbreviation: label("staff_abbreviation").notNull(),
    name: json<Record<string, string>>("name").notNull(),
    abbreviation: json<Record<string, string>>("abbreviation").notNull(),
    precision: count("precision").notNull(),
    // A plain text column beside its own check constraint below, NOT the enumText/enumCheck pair:
    // that pair narrows the column's TypeScript type to the union of its values, which is a
    // caller-facing change. enumText's own note in packages/db/src/schema/columns.ts has the table.
    hardwareUnit: label("hardware_unit"),
    // A dish sold in a unit that measures an amount takes no extras.
    measure: flag("measure").notNull().default(false),
  },
  (t) => [
    unique("units_seed_key_key").on(t.seedKey),
    check("units_precision_ck", sql`${t.precision} between 0 and 3`),
    check("units_hardware_unit_ck", sql`${t.hardwareUnit} in ('kg', 'g', 'mg')`),
  ],
);
