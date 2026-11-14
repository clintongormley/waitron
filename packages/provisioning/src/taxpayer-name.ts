import { and, eq } from "drizzle-orm";
import { recordActivity, taxpayer, type Transaction } from "@waitron/db";

/**
 * Change the taxpayer's legal name, only while the stored name is still `expected`. The country,
 * tax ID and domicile are never touched. It throws no code of its own: `renamed: false` means the
 * stored name was not `expected`, and the caller names that refusal in its own vocabulary.
 */
export async function renameTaxpayer(
  tx: Transaction,
  input: { readonly expected: string; readonly legalName: string; readonly personId: string | null },
): Promise<{ renamed: boolean }> {
  const updated = await tx
    .update(taxpayer)
    .set({ legalName: input.legalName })
    .where(and(eq(taxpayer.id, 1), eq(taxpayer.legalName, input.expected)))
    .returning({ id: taxpayer.id });
  if (updated.length > 0)
    await recordActivity(tx, { kind: "taxpayer.legal_name_changed", subjectId: "1", personId: input.personId, data: { from: input.expected, to: input.legalName } });
  return { renamed: updated.length > 0 };
}
