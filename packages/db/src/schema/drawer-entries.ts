import { sql } from "drizzle-orm";
import { check, foreignKey, unique } from "drizzle-orm/sqlite-core";
import { billPayments } from "./bill-payments.js";
import { count, enumCheck, enumText, id, json, money, newId, table, tsString } from "./columns.js";
import { devices } from "./devices.js";
import { persons } from "./identity/persons.js";
import { nodes } from "./nodes.js";
import { printers } from "./printers.js";
import { refunds } from "./refunds.js";

export const drawerEntries = table(
  "drawer_entries",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    printerId: id("printer_id").notNull(),
    nodeId: id("node_id").notNull(),
    sequence: count("sequence").notNull(),
    recordedAt: tsString("recorded_at").notNull(),
    personId: id("person_id").notNull(),
    deviceId: id("device_id"),
    kind: enumText("kind", [
      "cash_payment",
      "card_payment",
      "cash_refund",
      "cash_in",
      "cash_out",
      "count",
      "recount",
      "finish",
    ]).notNull(),
    amount: money("amount").notNull(),
    billPaymentId: id("bill_payment_id"),
    refundId: id("refund_id"),
    firstCountId: id("first_count_id"),
    facts: json<Record<string, string | number | boolean | null>>("facts"),
  },
  (t) => [
    foreignKey({ columns: [t.printerId], foreignColumns: [printers.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.nodeId], foreignColumns: [nodes.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.personId], foreignColumns: [persons.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.deviceId], foreignColumns: [devices.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.billPaymentId], foreignColumns: [billPayments.id] }).onDelete(
      "restrict",
    ),
    foreignKey({ columns: [t.refundId], foreignColumns: [refunds.id] }).onDelete("restrict"),
    foreignKey({ columns: [t.firstCountId], foreignColumns: [t.id] }).onDelete("restrict"),
    unique("drawer_entries_printer_sequence_key").on(t.printerId, t.sequence),
    unique("drawer_entries_bill_payment_key").on(t.billPaymentId),
    unique("drawer_entries_refund_key").on(t.refundId),
    check("drawer_entries_kind_ck", enumCheck(t.kind)),
    check(
      "drawer_entries_target_ck",
      sql`
      (${t.billPaymentId} is not null) = (${t.kind} in ('cash_payment', 'card_payment'))
      and (${t.refundId} is not null) = (${t.kind} = 'cash_refund')
      and (${t.firstCountId} is not null) = (${t.kind} in ('recount', 'finish'))
    `,
    ),
    check(
      "drawer_entries_amount_ck",
      sql`
      typeof(${t.amount}) = 'integer'
      and (${t.kind} not in ('cash_payment', 'card_payment', 'cash_in') or ${t.amount} > 0)
      and (${t.kind} not in ('cash_refund', 'cash_out') or ${t.amount} < 0)
    `,
    ),
  ],
);
