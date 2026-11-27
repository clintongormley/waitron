import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, id, label, table, ts } from "@waitron/db";

/**
 * Flow-control state for the obligado tributario this database belongs to. Separate from
 * `verifactu_submissions.proximo_intento_en` (per-record retry backoff) because the flow-control race — "send when
 * `t` elapsed OR 1000 accumulated, whichever first" — is a fact about the whole submission stream,
 * and the write path defaults each new `verifactu_submissions` row to `now()`, so a per-record column cannot bound
 * the interval between envíos.
 *
 * ONE ROW: `id` is pinned to 1 by `verifactu_sending_state_singleton_ck`, and that id doubles as the
 * `ON CONFLICT` target the drainer upserts against. Lazily created; no row reads as "may send now".
 */
export const verifactuSendingState = table(
  "verifactu_sending_state",
  {
    id: count("id").primaryKey().notNull().default(1),
    // When the next envío may go. Persisted, never an in-memory timer.
    proximoEnvioEn: ts("proximo_envio_en").notNull(),
    // The last TiempoEsperaEnvio AEAT returned, in seconds: `\d{0,4}` in AEAT's XSD, so at most
    // 9999.
    tiempoEsperaSeg: count("tiempo_espera_seg").notNull(),
    // A response may close only the interruption its own request observed.
    technicalIncidentToken: id("technical_incident_token"),
    // The fingerprint of the certificate AEAT last refused at the door, and the first pass that saw
    // it. A reader shows the mark only while the latest install names that fingerprint.
    certificateRefusedFingerprint: label("certificate_refused_fingerprint"),
    certificateRefusedAt: ts("certificate_refused_at"),
  },
  (t) => [
    check("verifactu_sending_state_singleton_ck", sql`${t.id} = 1`),
    check(
      "verifactu_sending_state_certificate_refused_ck",
      sql`(${t.certificateRefusedFingerprint} is null) = (${t.certificateRefusedAt} is null)`,
    ),
  ],
);
