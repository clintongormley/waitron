import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, table, ts } from "@waitron/db";

/**
 * Flow-control state for the obligado tributario this database belongs to. Holds when the NEXT
 * envío may be sent and the current AEAT-supplied wait `t`. Separate from
 * `envios.proximo_intento_en` (per-record retry backoff) because the flow-control race — "send when
 * `t` elapsed OR 1000 accumulated, whichever first" — is a fact about the whole submission stream,
 * and the write path defaults each new `envios` row to `now()`, so a per-record column cannot bound
 * the interval between envíos.
 *
 * ONE ROW (the `tenant_receipts` / `tenant_themes` shape in `@waitron/db`): `id` is pinned to 1 by
 * `envio_flujo_singleton_ck`, and that id doubles as the `ON CONFLICT` target the drainer upserts
 * against. Lazily created: no row means nothing has ever been sent, which reads as "may send now";
 * the drainer upserts one after the first response.
 */
// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as packages/db/src/schema/sales.ts.
export const envioFlujo = table(
  "envio_flujo",
  {
    id: count("id").primaryKey().notNull().default(1),
    // When the next envío may go. Persisted, never an in-memory timer.
    proximoEnvioEn: ts("proximo_envio_en").notNull(),
    // The last TiempoEsperaEnvio AEAT returned. `\d{0,4}` in the schema → up to 9999; an integer
    // column holds it exactly, where baking it into a timestamptz would not make the seconds
    // re-readable.
    tiempoEsperaSeg: count("tiempo_espera_seg").notNull(),
  },
  /* v8 ignore start */
  (t) => [check("envio_flujo_singleton_ck", sql`${t.id} = 1`)],
  /* v8 ignore stop */
);
