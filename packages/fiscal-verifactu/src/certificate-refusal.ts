import type { Transaction } from "@waitron/db";
import { firstCodeInCauseChain } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { latestInstall } from "./certificate-record.js";

const NOT_ACCEPTED = "fiscal.certificate_not_accepted";

/** Whether `mtlsFetch`'s refusal of the certificate is somewhere in `error`'s cause chain. */
export function certificateNotAccepted(error: unknown): boolean {
  return firstCodeInCauseChain(error, (code) => code === NOT_ACCEPTED) !== null;
}

/** Keeps the first time while the refused fingerprint is unchanged. A row it creates opens the
 * gate from `at`, as `openTechnicalIncident`'s does. */
export async function markCertificateRefused(
  tx: Transaction,
  fingerprint: string,
  at: Date,
): Promise<void> {
  await tx.execute(sql`
    insert into verifactu_sending_state
      (id, proximo_envio_en, tiempo_espera_seg, certificate_refused_fingerprint, certificate_refused_at)
    values (1, ${at.toISOString()}, 0, ${fingerprint}, ${at.toISOString()})
    on conflict (id) do update set
      certificate_refused_at = case
        when certificate_refused_fingerprint = excluded.certificate_refused_fingerprint
        then certificate_refused_at else excluded.certificate_refused_at end,
      certificate_refused_fingerprint = excluded.certificate_refused_fingerprint
  `);
}

export async function clearCertificateRefusal(tx: Transaction): Promise<void> {
  await tx.execute(sql`
    update verifactu_sending_state
    set certificate_refused_fingerprint = null, certificate_refused_at = null
    where id = 1 and certificate_refused_fingerprint is not null
  `);
}

/** When AEAT first refused the certificate whose fingerprint is `fingerprint`, or null when it has
 * not. Compared by certificate, never by date, so a new install hides an older refusal at once. */
export async function certificateRefusedAt(
  tx: Transaction,
  fingerprint: string,
): Promise<Date | null> {
  const { rows } = await tx.execute<{ at: string }>(sql`
    select certificate_refused_at as at from verifactu_sending_state
    where id = 1 and certificate_refused_fingerprint = ${fingerprint}
  `);
  return rows[0] === undefined ? null : new Date(rows[0].at);
}

/** `certificateRefusedAt` for the certificate `latestInstall` finds, reading the install only when
 * a refusal is marked. */
export async function currentCertificateRefusedAt(
  tx: Transaction,
  nodeId: string,
): Promise<Date | null> {
  const { rows } = await tx.execute<{ fingerprint: string; at: string }>(sql`
    select certificate_refused_fingerprint as fingerprint, certificate_refused_at as at
    from verifactu_sending_state
    where id = 1 and certificate_refused_fingerprint is not null
  `);
  const mark = rows[0];
  if (mark === undefined) return null;
  const install = await latestInstall(tx, nodeId);
  return install?.fingerprint === mark.fingerprint ? new Date(mark.at) : null;
}
