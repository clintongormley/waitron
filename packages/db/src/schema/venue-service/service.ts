import type { DepartmentReceiptConfig, ReceiptLogoRasters } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { mediaImages } from "../media/images.js";
import { enumCheck, flag, id, json, label, newId, nowIso, table, tsString } from "../columns.js";
import { deviceProfiles } from "../device-profiles.js";
import { sales } from "../sales.js";
import {
  collectionNumber,
  dining,
  diningPolicy,
  orderStart,
  paidWhen,
} from "../sale-rule-types.js";

export const departments = table(
  "departments",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    tradingName: label("trading_name").notNull(),
    isDefault: flag("is_default").notNull().default(false),
    active: flag("active").notNull().default(true),
    needsClearing: flag("needs_clearing").notNull().default(false),
    lateSendNeedsManager: flag("late_send_needs_manager").notNull().default(false),
    orderStart: orderStart("order_start").notNull().default("counter"),
    paidWhen: paidWhen("paid_when").notNull().default("prepay"),
    collectionNumber: collectionNumber("collection_number").notNull().default("none"),
    printTradingName: flag("print_trading_name").notNull().default(true),
    dining: diningPolicy("dining").notNull().default("eat_in"),
    diningStartsAs: dining("dining_starts_as").notNull().default("eat_in"),
    transferDeskProfileId: id("transfer_desk_profile_id"),
    operationDescription: label("operation_description"),
    receiptText:
      json<Omit<DepartmentReceiptConfig, "logo" | "operationDescription">>("receipt_text"),
    receiptLogoImageId: id("receipt_logo_image_id"),
    receiptLogoRasters: json<ReceiptLogoRasters>("receipt_logo_rasters"),
    receiptUpdatedAt: tsString("receipt_updated_at"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    check("departments_order_start_ck", enumCheck(t.orderStart)),
    check("departments_paid_when_ck", enumCheck(t.paidWhen)),
    check("departments_collection_number_ck", enumCheck(t.collectionNumber)),
    check("departments_dining_ck", enumCheck(t.dining)),
    check("departments_dining_starts_as_ck", enumCheck(t.diningStartsAs)),
    foreignKey({
      columns: [t.transferDeskProfileId],
      foreignColumns: [deviceProfiles.id],
      name: "departments_transfer_desk_profile_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.receiptLogoImageId],
      foreignColumns: [mediaImages.id],
      name: "departments_receipt_logo_fk",
    }).onDelete("restrict"),
    uniqueIndex("departments_name_key")
      .on(t.name)
      .where(sql`${t.active} = 1`),
    uniqueIndex("departments_one_default_key")
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
  ],
);

export const saleReceiptHeaders = table(
  "sale_receipt_headers",
  {
    saleId: id("sale_id").primaryKey(),
    departmentId: id("department_id"),
    tradingName: label("trading_name").notNull(),
    printTradingName: flag("print_trading_name").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "sale_receipt_headers_sale_fk",
    }),
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "sale_receipt_headers_department_fk",
    }),
  ],
);
