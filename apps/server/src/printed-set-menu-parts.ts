/** What {@link withPrintedParts} reads of a filed row. */
export interface PartRow {
  setMenuRole: "set_menu" | "dish" | null;
  setMenuPart: number | null;
}

/**
 * The filed rows as a document prints them. A dish's set-menu part makes it a covered dish (lettered,
 * no amount) only beside its divided set menu's own row; elsewhere the part is dropped and the row
 * prints its amount. A filed dish names no set menu, so the test is whether the document holds any
 * divided set menu's row: a whole credit and a replacement copy it, and a partial correction never
 * holds it, since that row files 0.00 and no amount can be taken off it.
 */
export function withPrintedParts<T extends PartRow>(rows: readonly T[]): T[] {
  if (rows.some((row) => row.setMenuRole === "set_menu" && row.setMenuPart !== null))
    return [...rows];
  return rows.map((row) => (row.setMenuPart === null ? row : { ...row, setMenuPart: null }));
}
