/** One diner answer on the wire: which options list was asked, and which of its labels was chosen. */
export type OptionSelection = { listId: string; labelId: string };

/**
 * The answer as it is frozen onto an order line — the list's three names and the chosen label's
 * three names, copied by value. A working order also holds the original list's id so a new list
 * cannot take over its answer. The copied names survive a list change or deletion.
 */
export type OptionSnapshot = {
  listId?: string;
  listName: Record<string, string>;
  listCustomerName: Record<string, string> | null;
  listKitchenName: string | null;
  labelName: Record<string, string>;
  labelCustomerName: Record<string, string> | null;
  labelKitchenName: string | null;
};

export function optionSnapshotNames(snapshot: OptionSnapshot): Omit<OptionSnapshot, "listId"> {
  const names = { ...snapshot };
  delete names.listId;
  return names;
}
