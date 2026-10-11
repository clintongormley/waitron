import { and, eq } from "drizzle-orm";
import { tenants, type Transaction } from "@waitron/db";

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
    .update(tenants)
    .set({ legalName: input.legalName })
    .where(and(eq(tenants.id, 1), eq(tenants.legalName, input.expected)))
    .returning({ id: tenants.id });
  return { renamed: updated.length > 0 };
}
