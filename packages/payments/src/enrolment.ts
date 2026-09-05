import { type EnrolledTable, enrol } from "@waitron/sync-enrolment";
import { paymentPolicy, paymentRefunds, payments } from "./schema/index.js";

/** Payments' sync enrolment (SP-2a). payments/payment_refunds ride the FAST lane (shrinking the
 * double-charge exposure of active-active selling); payment_policy is one row per tenant, so its
 * conflict key is (tenant_id). Metadata verbatim from the former central ENROLLED; columns derived. */
export const PAYMENTS_ENROLMENT: readonly EnrolledTable[] = [
  enrol(payments, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 3,
    lane: "fast",
  }),
  enrol(paymentRefunds, {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 4,
    lane: "fast",
  }),
  // payment_policy is config-class (membership Slice 7, R-S7-1): the tenant's payment configuration
  // flows DOWN-only from the serving-primary. payments/payment_refunds above are runtime (default false).
  enrol(paymentPolicy, {
    mode: "watermark-upsert",
    conflictKey: ["tenant_id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
    configClass: true,
  }),
];
