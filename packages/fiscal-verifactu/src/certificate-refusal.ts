import type { Transaction } from "@waitron/db";
import type { VerifactuClient } from "@waitron/verifactu";
import { sql } from "drizzle-orm";

/** Keeps the first time while the refused revision is unchanged. Updates only an existing row:
 * the failure transaction opens the technical incident, which creates it, first. */
export async function markCertificateRefused(
  tx: Transaction,
  revision: string,
  now: Date,
): Promise<void> {
  await tx.execute(sql`
    update verifactu_sending_state set
      certificate_refused_at = case when certificate_refused_revision = ${revision}
        then certificate_refused_at else ${now.toISOString()} end,
      certificate_refused_revision = ${revision}
    where id = 1
  `);
}

export async function clearCertificateRefusal(tx: Transaction): Promise<void> {
  await tx.execute(sql`
    update verifactu_sending_state
    set certificate_refused_revision = null, certificate_refused_at = null
    where id = 1 and certificate_refused_revision is not null
  `);
}

/** When AEAT first refused the certificate whose vault revision is `revision`, or null when it has
 * not. Compared by revision, never by date, so a new install hides an older refusal at
 * once. */
export async function certificateRefusedAt(
  tx: Transaction,
  revision: string | null,
): Promise<Date | null> {
  if (revision === null) return null;
  const { rows } = await tx.execute<{ at: string }>(sql`
    select certificate_refused_at as at from verifactu_sending_state
    where id = 1 and certificate_refused_revision = ${revision}
  `);
  return rows[0] === undefined ? null : new Date(rows[0].at);
}

/** A drain's client, naming the vault revision of the certificate it sends with when it knows. */
export type DrainClient = VerifactuClient & { readonly certificateRevision?: string | null };
