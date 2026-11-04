import { sql } from "drizzle-orm";
import { check, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { DeliveryContext, DeliveryResult } from "@waitron/shared";
import {
  count,
  enumCheck,
  enumType,
  flag,
  id,
  json,
  label,
  nowIso,
  table,
  tsString,
} from "./columns.js";

export const documentRequestStatus = enumType(["prepared", "accepted", "refused", "fenced"]);
export const routingDocumentChoice = enumType(["receipt", "invoice"]);

export const documentDeliveryRequests = table(
  "document_delivery_requests",
  {
    nodeId: id("node_id").notNull(),
    recoveryEpoch: id("recovery_epoch").notNull(),
    requestKey: id("request_key").notNull(),
    // Admission must validate these targets; local protocol rows have no cross-class foreign keys.
    saleId: id("sale_id").notNull(),
    personId: id("person_id").notNull(),
    sessionId: id("session_id").notNull(),
    document: routingDocumentChoice("document").notNull(),
    context: json<DeliveryContext>("context").notNull(),
    canonicalIntent: label("canonical_intent").notNull(),
    fingerprint: label("fingerprint").notNull(),
    status: documentRequestStatus("status").notNull(),
    acceptedResult: json<DeliveryResult>("accepted_result"),
    acceptanceOrder: count("acceptance_order"),
    refusalCode: label("refusal_code"),
    acknowledged: flag("acknowledged").notNull().default(false),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId, t.recoveryEpoch, t.requestKey] }),
    index("document_delivery_requests_recovery_idx").on(
      t.nodeId,
      t.recoveryEpoch,
      t.saleId,
      t.acknowledged,
    ),
    check("document_delivery_requests_status_ck", enumCheck(t.status)),
    check("document_delivery_requests_document_ck", enumCheck(t.document)),
    uniqueIndex("document_delivery_requests_acceptance_order_idx").on(
      t.nodeId,
      t.recoveryEpoch,
      t.acceptanceOrder,
    ),
    check(
      "document_delivery_requests_outcome_ck",
      sql`(${t.status} = 'accepted' and ${t.acceptedResult} is not null and ${t.acceptanceOrder} is not null) or (${t.status} <> 'accepted' and ${t.acceptedResult} is null and ${t.acceptanceOrder} is null)`,
    ),
    check(
      "document_delivery_requests_order_ck",
      sql`${t.acceptanceOrder} is null or (${t.acceptanceOrder} between 1 and 9007199254740991 and ${t.acceptanceOrder} = cast(${t.acceptanceOrder} as integer))`,
    ),
  ],
);

export const documentDeliverySequences = table(
  "document_delivery_sequences",
  {
    nodeId: id("node_id").notNull(),
    recoveryEpoch: id("recovery_epoch").notNull(),
    nextAcceptanceOrder: count("next_acceptance_order").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId, t.recoveryEpoch] }),
    check(
      "document_delivery_sequences_order_ck",
      sql`${t.nextAcceptanceOrder} between 1 and 9007199254740991 and ${t.nextAcceptanceOrder} = cast(${t.nextAcceptanceOrder} as integer)`,
    ),
  ],
);
