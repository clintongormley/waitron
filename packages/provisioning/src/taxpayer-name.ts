import { and, eq } from "drizzle-orm";
import { taxpayer, type Transaction } from "@waitron/db";

/**
 * Change the taxpayer's legal name, only while the stored name is still `expected`. The country,
 * tax ID and domicile are never touched. It throws no code of its own: `renamed: false` means the
 * stored name was not `expected`, and the caller names that refusal in its own vocabulary.
 */
export async function renameTaxpayer(
  tx: Transaction,
  input: { readonly expected: string; readonly legalName: string },
): Promise<{ renamed: boolean }> {
  const updated = await tx
    .update(taxpayer)
    .set({ legalName: input.legalName })
    .where(and(eq(taxpayer.id, 1), eq(taxpayer.legalName, input.expected)))
    .returning({ id: taxpayer.id });
  return { renamed: updated.length > 0 };
}
