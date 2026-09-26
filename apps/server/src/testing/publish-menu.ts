import {
  buildMenuDocument,
  menuDocumentHash,
  menuPublications,
  publishMenu,
} from "@waitron/catalogue";
import type { Transaction } from "@waitron/db";

/** Publishes the menu's working state, as the dashboard's preview-then-publish does; the version id. */
export async function publishWorkingMenu(tx: Transaction, menuId: string): Promise<string> {
  const { document } = await buildMenuDocument(tx, menuId);
  return (await publishMenu(tx, menuId, menuDocumentHash(document), "test-publisher")).versionId;
}

/** Publishes every menu that has a live version, so a till sells what the products are now. */
export async function republishMenus(tx: Transaction): Promise<void> {
  const published = await tx.select({ menuId: menuPublications.menuId }).from(menuPublications);
  for (const { menuId } of published) await publishWorkingMenu(tx, menuId);
}
