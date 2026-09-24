/** One diner answer on the wire: which options list was asked, and which of its labels was chosen. */
export type OptionSelection = { listId: string; labelId: string };

/**
 * The answer as it is frozen onto an order line — the list's three names and the chosen label's
 * three names, copied by value. Nothing here points back at the list or label by id, so editing or
 * deleting a list cannot rewrite a saved order.
 */
export type OptionSnapshot = {
  listName: Record<string, string>;
  listCustomerName: Record<string, string> | null;
  listKitchenName: string | null;
  labelName: Record<string, string>;
  labelCustomerName: Record<string, string> | null;
  labelKitchenName: string | null;
};
