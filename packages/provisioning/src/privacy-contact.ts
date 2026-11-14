import { readSettings, saveSettings, VENUE_SETTINGS, type Transaction } from "@waitron/db";
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

export async function readPrivacyContact(tx: Transaction): Promise<PrivacyContact | null> {
  const saved = await readSettings(tx, VENUE_SETTINGS);
  if (saved.revision === 0) return null;
  return { privacyNoticeUrl: saved.doc.privacyNoticeUrl, privacyEmail: saved.doc.privacyEmail };
}

export async function savePrivacyContact(
  tx: Transaction,
  changes: Partial<PrivacyContact>,
  personId: string | null,
): Promise<PrivacyContact | null> {
  const saved = await readSettings(tx, VENUE_SETTINGS);
  if (saved.revision === 0) return null;
  const values: Partial<PrivacyContact> = {};
  if (changes.privacyNoticeUrl !== undefined) values.privacyNoticeUrl = changes.privacyNoticeUrl;
  if (changes.privacyEmail !== undefined) values.privacyEmail = changes.privacyEmail;
  if (Object.keys(values).length > 0)
    await saveSettings(tx, VENUE_SETTINGS, { doc: { ...saved.doc, ...values }, expectedRevision: saved.revision, personId });
  return { privacyNoticeUrl: values.privacyNoticeUrl === undefined ? saved.doc.privacyNoticeUrl : values.privacyNoticeUrl,
    privacyEmail: values.privacyEmail === undefined ? saved.doc.privacyEmail : values.privacyEmail };
}
