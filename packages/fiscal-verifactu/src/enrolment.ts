import { type EnrolledTable, enrol } from "@waitron/sync-enrolment";
import {
  acks,
  cadenas,
  envioFlujo,
  envios,
  registroSif,
  registrosFacturacion,
} from "./schema/index.js";

/**
 * The fiscal module's sync enrolment (SP-3a = H2's fiscal-record lane). All six tables ride the
 * ORDERED lane — the fiscal chain is indifferent to replication lag, and envios/acks carry no
 * monotonic column so they are fast-lane-ineligible regardless. Metadata verbatim from the H2 §3
 * table; columns are DERIVED by enrol() off the owning Drizzle schema so they cannot drift. No new
 * grant: app_user already holds precisely the DML each mode needs (see the plan's Global Constraints).
 */
export const FISCAL_ENROLMENT: readonly EnrolledTable[] = [
  // The immutable ledger. INSERT-ONLY, grant-enforced: app_user holds only SELECT,INSERT
  // (0001_fiscal_baseline_sql.sql), so ON CONFLICT (id) DO NOTHING issues no UPDATE — and a stray one
  // would be refused by the grant (42501) before the append-only BEFORE UPDATE OR DELETE trigger fires
  // (WT001 is the backstop for a privilege-bypassing superuser). Replicated verbatim — huella,
  // the four anterior_* pointers and entorno copy as opaque bytes; nothing recomputes a hash.
  enrol(registrosFacturacion, {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 5,
    lane: "ordered",
  }),
  // The SIF identity. Append-mostly: a re-registered node gets a NEW row; the old one is revoked
  // in-place (revocado_en set), which is the UPDATE. No monotonic column — ordered by the seq cursor.
  enrol(registroSif, {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 4,
    lane: "ordered",
  }),
  // The mutable chain head, one row per (tenant, node). actualizado_en is a monotonic watermark. On
  // a mirror the apply stream is the only writer of a foreign chain's head, so it is single-writer
  // there and lockChainHead's FOR UPDATE (an origin-side concern) does not apply.
  enrol(cadenas, {
    mode: "watermark-upsert",
    conflictKey: ["tenant_id", "node_id"],
    watermarkColumn: "actualizado_en",
    captureOps: ["insert", "update"],
    fkRank: 6,
    lane: "ordered",
  }),
  // The submission sidecar (1:1 with a registro; estado mutates). Ordered by the seq cursor.
  enrol(envios, {
    mode: "watermark-upsert",
    conflictKey: ["registro_id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 6,
    lane: "ordered",
  }),
  // Per-tenant flow-control state (PK tenant_id). Ordered by the seq cursor. NOT config-class — it
  // is per-tenant runtime state written on the serving primary, not venue configuration.
  enrol(envioFlujo, {
    mode: "watermark-upsert",
    conflictKey: ["tenant_id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 2,
    lane: "ordered",
  }),
  // The ack outbox — the ONE fiscal table that DELETES (a delivered ack in a terminal state is
  // pruned), so it captures delete too. app_user holds DELETE (0001_fiscal_baseline_sql.sql).
  enrol(acks, {
    mode: "watermark-upsert",
    conflictKey: ["registro_id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    fkRank: 6,
    lane: "ordered",
  }),
];
