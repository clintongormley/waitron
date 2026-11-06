export interface HistoricalSet {
  name: string;
  migrationsFolder: string;
  migrationsTable: string;
  appendOnlyTables: string[];
  database?: "venue" | "node";
  requires: string[];
}
export function historicalSets(): HistoricalSet[];
export function historicalSet(name: string): HistoricalSet;
