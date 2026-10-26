import { eq } from "drizzle-orm";
import { tenants, type Transaction } from "@waitron/db";
import {
  AppError,
  privacyContactProblem,
  privacyContactValue,
  type PrivacyContactField,
} from "@waitron/shared";
import "./errors.js";

export interface PrivacyContact {
  privacyNoticeUrl: string | null;
  privacyEmail: string | null;
}

/** One privacy contact value as the Privacy card's save takes it: NFC and trimmed, empty is
 * null; a value the shared rule refuses throws `venue.detail_invalid { field, reason }`. */
export function privacyContactChecked(field: PrivacyContactField, raw: string): string | null {
  const value = privacyContactValue(raw);
  const problem = privacyContactProblem(field, value);
  if (problem !== undefined) throw new AppError("venue.detail_invalid", { field, reason: problem });
  return value;
}

/** The taxpayer row's privacy contact, or null when there is no taxpayer row. */
export async function readPrivacyContact(tx: Transaction): Promise<PrivacyContact | null> {
  const [row] = await tx
    .select({ privacyNoticeUrl: tenants.privacyNoticeUrl, privacyEmail: tenants.privacyEmail })
    .from(tenants)
    .where(eq(tenants.id, 1));
  return row ?? null;
}

/**
 * Writes the given columns alone, on the taxpayer row; returns the stored pair, or null when there
 * is no taxpayer row. It drops keys whose value is `undefined` first; with no value left it writes
 * nothing and returns `readPrivacyContact(tx)`, because drizzle's `.set()` throws `No values to
 * set` for `{}` and for `{ privacyEmail: undefined }` alike. Takes checked values: it throws no
 * code of its own.
 */
export async function savePrivacyContact(
  tx: Transaction,
  changes: Partial<PrivacyContact>,
): Promise<PrivacyContact | null> {
  const values: Partial<PrivacyContact> = {};
  if (changes.privacyNoticeUrl !== undefined) values.privacyNoticeUrl = changes.privacyNoticeUrl;
  if (changes.privacyEmail !== undefined) values.privacyEmail = changes.privacyEmail;
  if (Object.keys(values).length === 0) return readPrivacyContact(tx);
  const [row] = await tx
    .update(tenants)
    .set(values)
    .where(eq(tenants.id, 1))
    .returning({ privacyNoticeUrl: tenants.privacyNoticeUrl, privacyEmail: tenants.privacyEmail });
  return row ?? null;
}
