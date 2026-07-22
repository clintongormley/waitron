import { integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";

/**
 * Per-tenant (per obligado tributario) flow-control state. Holds when this obligado's NEXT envío
 * may be sent and the current AEAT-supplied wait `t`. Separate from `envios.proximo_intento_en`
 * (per-record retry backoff) because the flow-control race — "send when `t` elapsed OR 1000
 * accumulated, whichever first" — is a per-tenant fact, and the write path defaults each new
 * `envios` row to `now()`, so a per-record column cannot bound the interval between envíos.
 *
 * Lazily created: a tenant with no row here has never sent, which reads as "may send now"; the
 * drainer upserts a row after the first response.
 */
export const envioFlujo = pgTable("envio_flujo", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  // When this obligado's next envío may go. Persisted, never an in-memory timer.
  proximoEnvioEn: timestamp("proximo_envio_en", { withTimezone: true }).notNull(),
  // The last TiempoEsperaEnvio AEAT returned. `\d{0,4}` in the schema → up to 9999; an integer
  // column holds it exactly, where baking it into a timestamptz would not make the seconds
  // re-readable.
  tiempoEsperaSeg: integer("tiempo_espera_seg").notNull(),
}).enableRLS();
