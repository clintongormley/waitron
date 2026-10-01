export interface ClassificationEntry {
  id: string;
  name: string;
}
/** What a sale line is reported under: its category and each category above it, root first. */
export interface SaleLineClassification {
  reporting: ClassificationEntry[];
}
