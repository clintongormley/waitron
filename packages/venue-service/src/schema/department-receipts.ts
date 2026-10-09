import { foreignKey } from "drizzle-orm/sqlite-core";
import { id, json, nowIso, table, tsString } from "@waitron/db";
import type { DepartmentReceiptConfig, ReceiptLogoRasters } from "@waitron/shared";
import { departments } from "./service.js";

export const departmentReceipts = table(
  "department_receipts",
  {
    departmentId: id("department_id").primaryKey(),
    receipt: json<DepartmentReceiptConfig>("receipt").notNull(),
    logoRasters: json<ReceiptLogoRasters>("logo_rasters"),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "department_receipts_department_fk",
    }),
  ],
);
