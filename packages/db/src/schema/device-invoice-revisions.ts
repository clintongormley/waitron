import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, id, table } from "./columns.js";
import { devices } from "./devices.js";

export const deviceInvoiceRevisions = table(
  "device_invoice_revisions",
  {
    deviceId: id("device_id")
      .primaryKey()
      .references(() => devices.id, { onDelete: "restrict" }),
    revision: count("revision").notNull(),
  },
  (t) => [
    check(
      "device_invoice_revisions_revision_ck",
      sql`${t.revision} between 0 and 9007199254740991 and ${t.revision} = cast(${t.revision} as integer)`,
    ),
  ],
);
