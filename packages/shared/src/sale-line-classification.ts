/** A category or a label as it stood when a sale line was recorded: its id, and its name then. */
export type ClassificationEntry = { id: string; name: string };

/**
 * How a line's product was classified: its main reporting category chain from the root to the
 * leaf (empty when Uncategorised), and its labels sorted by id.
 */
export type SaleLineClassification = {
  reporting: ClassificationEntry[];
  labels: ClassificationEntry[];
};
