import { stable, type CanonicalMadridSemantics, type MadridColumn } from "./madrid-semantics.js";

export function madridWithDocument(
  original: CanonicalMadridSemantics,
  sourceTable: string,
  fields: Readonly<Record<string, string>>,
  metadata: {
    module: string;
    version: number;
    revision: number;
    updatedAt: string;
    updatedBy: string | null;
  },
): CanonicalMadridSemantics {
  const result = structuredClone(original);
  const source = result.tables[sourceTable]!;
  const rows = Object.values(source.rows);
  if (rows.length > 1) throw new Error(`Madrid document source has two rows: ${sourceTable}`);
  const columns: MadridColumn[] = [
    "module",
    "version",
    "revision",
    "doc",
    "updated_at",
    "updated_by",
  ].map((name) => ({
    name,
    type: ["version", "revision"].includes(name) ? "INTEGER" : "TEXT",
    notnull: name === "updated_by" ? 0 : 1,
    pk: name === "module" ? 1 : 0,
    dflt_value: null,
  }));
  result.tables.settings ??= {
    columns,
    foreignKeys: [
      {
        id: 0,
        seq: 0,
        table: "persons",
        from: "updated_by",
        to: "id",
        on_update: "NO ACTION",
        on_delete: "RESTRICT",
        match: "NONE",
      },
    ],
    rows: {},
  };
  if (rows.length === 1) {
    const row = {
      module: metadata.module,
      version: metadata.version,
      revision: metadata.revision,
      doc: Object.fromEntries(
        Object.entries(fields).map(([column, key]) => [key, rows[0]![column]]),
      ),
      updated_at: metadata.updatedAt,
      updated_by: metadata.updatedBy,
    };
    result.tables.settings.rows[stable(row)] = row;
  }
  source.columns = source.columns.filter((column) => !Object.hasOwn(fields, column.name));
  source.rows = Object.fromEntries(
    Object.entries(source.rows).map(([key, row]) => [
      key,
      Object.fromEntries(Object.entries(row).filter(([column]) => !Object.hasOwn(fields, column))),
    ]),
  );
  return result;
}
