export type RecordExportValue = string | number | boolean | null;
export type RecordExportAudience = "standard" | "representatives";
export type RecordExportFormat = "pdf" | "csv";
export interface RecordExportInput {
  locationId: string;
  personId?: string;
  period: { start: string; end: string };
  audience: RecordExportAudience;
  locale: "en" | "es";
}
export interface RecordExportSection {
  key: string;
  title: string;
  layout: "table" | "details";
  columns: readonly { key: string; label: string }[];
  rows: readonly { key: string; cells: Readonly<Record<string, RecordExportValue>> }[];
}
export interface RecordExportDocument {
  title: string;
  locale: "en" | "es";
  audience: RecordExportAudience;
  period: { start: string; end: string };
  notes: readonly string[];
  sections: readonly RecordExportSection[];
}
