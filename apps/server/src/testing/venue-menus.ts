import { catalogues, type Transaction } from "@waitron/db";
import { eq } from "drizzle-orm";

export async function venueMenus(
  tx: Transaction,
): Promise<{ id: string; name: string; isDefault: boolean }[]> {
  const rows = await tx
    .select({ id: catalogues.id, name: catalogues.name, isDefault: catalogues.isDefault })
    .from(catalogues)
    .where(eq(catalogues.active, true));
  return rows.sort((a, b) =>
    a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1,
  );
}
