import { eq } from "drizzle-orm";
import { buildMenuDocument, menuDocumentHash, menuReleases, publishMenu } from "@waitron/menu";
import { persons, withFoldedPersonKeys } from "@waitron/db";
import type { Transaction } from "@waitron/db";

/** Publishes the menu's working state, as the dashboard's preview-then-publish does; the version id. */
export async function publishWorkingMenu(tx: Transaction, menuId: string): Promise<string> {
  await tx
    .insert(persons)
    .values(
      withFoldedPersonKeys({
        id: "test-publisher",
        displayName: "Test publisher",
        status: "suspended",
      }),
    )
    .onConflictDoNothing({ target: persons.id });
  const { document } = await buildMenuDocument(tx, menuId);
  return (await publishMenu(tx, menuId, menuDocumentHash(document), "test-publisher")).versionId;
}

/** Publishes every menu that has a live version, so a till sells what the products are now. */
export async function republishMenus(tx: Transaction): Promise<void> {
  const published = await tx
    .select({ menuId: menuReleases.menuId })
    .from(menuReleases)
    .where(eq(menuReleases.state, "live"));
  for (const { menuId } of published) await publishWorkingMenu(tx, menuId);
}
