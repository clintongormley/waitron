export interface ClassificationEntry {
  id: string;
  name: string;
}
/** The id a custom item's line is reported under instead of a category's; its entry has no name,
 * because each surface names it. */
export const CUSTOM_ITEMS_CLASSIFICATION_ID = "custom_items";
/** What a sale line is reported under: its category and each category above it, root first, or a
 * custom item's one entry. */
export interface SaleLineClassification {
  reporting: ClassificationEntry[];
}
