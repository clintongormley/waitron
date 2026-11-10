import { catalogues, readVenue, type Transaction } from "@waitron/db";
import { eq } from "drizzle-orm";

export async function venueMenus(
  tx: Transaction,
): Promise<{ id: string; name: string; isDefault: boolean }[]> {
  const { defaultCatalogueId } = await readVenue(tx);
  const rows = await tx
    .select({ id: catalogues.id, name: catalogues.name })
    .from(catalogues)
    .where(eq(catalogues.active, true));
  return rows
    .map((row) => ({ ...row, isDefault: row.id === defaultCatalogueId }))
    .sort((a, b) =>
      a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1,
    );
}
