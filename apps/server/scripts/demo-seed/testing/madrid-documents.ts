import { madridWithDroppedColumns } from "./madrid-dropped-columns.js";
import { FIRST_DAY_START } from "@waitron/db";
import { stable, type CanonicalMadridSemantics, type MadridColumn } from "./madrid-semantics.js";

export function madridWithDocument(
  original: CanonicalMadridSemantics,
  sourceTable: string,
  fields: Readonly<Record<string, string>>,
  metadata:
    | { mode: "column-flag"; targetTable: string; targetField: string; beforeColumn?: string }
    | {
        module: string;
        version: number;
        revision: number;
        updatedAt: string;
        updatedBy: string | null;
        mode?: "row" | "business-day";
        targetField?: string;
        defaults?: Readonly<Record<string, unknown>>;
      },
): CanonicalMadridSemantics {
  const result = structuredClone(original);
  const source = result.tables[sourceTable]!;
  const rows = Object.values(source.rows);
  if (rows.length > 1) throw new Error(`Madrid document source has two rows: ${sourceTable}`);
  if (metadata.mode === "column-flag") {
    const target = result.tables[metadata.targetTable]!;
    target.columns.splice(
      metadata.beforeColumn === undefined
        ? target.columns.length
        : target.columns.findIndex((column) => column.name === metadata.beforeColumn),
      0,
      {
        name: metadata.targetField,
        type: "INTEGER",
        notnull: 1,
        pk: 0,
        dflt_value: "false",
      },
    );
    for (const row of Object.values(target.rows))
      row[metadata.targetField] = Number(
        rows.length === 1 &&
          Object.entries(fields).every(([from, to]) => rows[0]![from] === row[to]),
      );
    return madridWithDroppedColumns(result, { [sourceTable]: Object.keys(fields) });
  }
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
  const previous = Object.values(result.tables.settings.rows).find(
    (row) => row.module === metadata.module,
  );
  const moved =
    rows.length === 0
      ? {}
      : Object.fromEntries(Object.entries(fields).map(([column, key]) => [key, rows[0]![column]]));
  if (rows.length === 1 || previous !== undefined) {
    const row = {
      module: metadata.module,
      version: metadata.version,
      revision:
        metadata.revision +
        (metadata.mode === "business-day"
          ? Number(
              Object.values(result.tables.location_business_day_settings!.rows)[0]?.revision ?? 0,
            )
          : 0),
      doc: {
        ...metadata.defaults,
        ...(previous?.doc as Record<string, unknown> | undefined),
        ...(metadata.targetField === undefined
          ? moved
          : { [metadata.targetField]: rows.length === 0 ? null : moved }),
      },
      updated_at: metadata.updatedAt,
      updated_by: metadata.updatedBy,
    };
    if (previous !== undefined) delete result.tables.settings.rows[stable(previous)];
    result.tables.settings.rows[stable(row)] = row;
  }
  if (metadata.mode === "row") {
    source.rows = {};
    return result;
  }
  if (metadata.mode === "business-day") {
    const old = result.tables.location_day_cutover_changes!;
    const starts = Object.values(old.rows).map((row) => ({
      effective_business_day: row.effective_business_day,
      day_cutover: row.day_cutover,
    }));
    if (rows.length === 1)
      starts.unshift({
        effective_business_day: FIRST_DAY_START,
        day_cutover: rows[0]!.day_cutover,
      });
    result.tables.day_cutover_changes = {
      columns: old.columns
        .filter(({ name }) => name !== "location_id")
        .map((column) => ({ ...column, pk: column.name === "effective_business_day" ? 1 : 0 })),
      foreignKeys: [],
      rows: Object.fromEntries(
        starts
          .map((row) => [stable(row), row])
          .sort(([a], [b]) => String(a).localeCompare(String(b))),
      ),
    };
    delete result.tables.location_day_cutover_changes;
    delete result.tables.location_business_day_settings;
    fields = { ...fields, day_cutover: "dayCutover" };
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
