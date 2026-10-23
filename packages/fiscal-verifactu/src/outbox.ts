import type { Transaction } from "@waitron/db";
import type { FiscalOutboxState } from "@waitron/fiscal";
import { sql, type SQL } from "drizzle-orm";
import { lastAcceptedQuery } from "./certificate-card.js";

/** The ids of every `pendiente` record not behind a `detenido` record of its own chain: what the
 * next passes will try. */
function waitingRecords(): SQL {
  return sql`
    select e.registro_id from envios e
    join registros_facturacion r on r.id = e.registro_id
    where e.estado = 'pendiente'
      and not exists (
        select 1 from envios held_envio
        join registros_facturacion held on held.id = held_envio.registro_id
        where held.sif_id = r.sif_id and held.secuencia < r.secuencia
          and held_envio.estado = 'detenido'
      )
  `;
}

async function countWaiting(tx: Transaction): Promise<number> {
  const rows = await tx.execute<{ count: number }>(
    sql`select count(*) as count from (${waitingRecords()})`,
  );
  return rows.rows[0]!.count;
}

export async function readOutbox(tx: Transaction): Promise<FiscalOutboxState> {
  const [accepted] = await lastAcceptedQuery(tx, new Date(0));
  const waiting = await countWaiting(tx);
  return { lastAcceptedAt: accepted?.confirmadoEn?.toISOString() ?? null, waiting };
}

/** In `tx`: counts the waiting records, then sets each one's later wait to `now`. */
export async function retryWaitingRecords(
  tx: Transaction,
  now: Date,
): Promise<{ waiting: number; cleared: number }> {
  const waiting = await countWaiting(tx);
  const cleared = await tx.execute<{ registro_id: string }>(sql`
    update envios set proximo_intento_en = ${now.toISOString()}
    where proximo_intento_en > ${now.toISOString()}
      and registro_id in (${waitingRecords()})
    returning registro_id
  `);
  return { waiting, cleared: cleared.rows.length };
}
