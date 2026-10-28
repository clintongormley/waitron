import { catalogues, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { foldName } from "./name-uniqueness.js";
import "./errors.js";

export async function assertMenuNameFree(
  tx: Transaction,
  name: string,
  menuId?: string,
): Promise<void> {
  const rows = await tx.select({ id: catalogues.id, name: catalogues.name }).from(catalogues);
  // Existing duplicate names must not prevent edits to the menu's presentation.
  if (menuId !== undefined && rows.some((row) => row.id === menuId && row.name === name)) return;
  if (rows.some((row) => row.id !== menuId && foldName(row.name) === foldName(name)))
    throw new AppError("menu.name_taken", { field: "name" });
}
