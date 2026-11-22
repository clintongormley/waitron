import { columnsFromOverrides } from "@waitron/menu";
import type { IncludeFolderOverrides } from "@waitron/shared";
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

export function madridWithMenuSettings(
  original: CanonicalMadridSemantics,
  updatedAt: string,
): CanonicalMadridSemantics {
  const defaults = original.tables.catalogue_settings;
  const marker = original.tables.unit_seed_states;
  if (defaults === undefined || marker === undefined)
    throw new Error("Madrid menu settings source is missing");
  const markers = Object.values(marker.rows);
  if (markers.length !== Object.keys(defaults.rows).length || markers.length > 1)
    throw new Error("Madrid menu settings source rows differ");
  const result = madridWithDocument(
    original,
    "catalogue_settings",
    {
      default_product_vat_class: "defaultProductVatClass",
      default_color: "defaultColor",
    },
    {
      module: "menu",
      version: 1,
      revision: 1,
      updatedAt,
      updatedBy: null,
      mode: "row",
      defaults: { starterUnitsCreated: markers.length === 1, defaultTakeawayVatRate: null },
    },
  );
  delete result.tables.catalogue_settings;
  delete result.tables.unit_seed_states;
  return result;
}

export function madridWithProductUnits(
  original: CanonicalMadridSemantics,
): CanonicalMadridSemantics {
  const result = structuredClone(original);
  const assignments = result.tables.product_units;
  const products = result.tables.products;
  if (!assignments || !products) throw new Error("missing captured product units");
  const position = products.columns.findIndex((column) => column.name === "pricing_unit");
  if (position < 0) throw new Error("missing captured pricing unit");
  const column = assignments.columns.find((column) => column.name === "unit_id")!;
  products.columns.splice(position, 1, { ...column, notnull: 0 });
  const byProduct = new Map(
    Object.values(assignments.rows).map((row) => [row.product_id, row.unit_id]),
  );
  for (const row of Object.values(products.rows)) {
    row.unit_id = byProduct.get(row.id) ?? null;
    delete row.pricing_unit;
  }
  const keys = assignments.foreignKeys.filter((key) => key.from === "unit_id");
  const parentKeys = products.foreignKeys.filter(
    (key) => key.from === "parent_id" || (key.from === "menu_id" && key.table === "products"),
  );
  const otherKeys = products.foreignKeys.filter((key) => !parentKeys.includes(key));
  const ids = new Map<string, number>();
  products.foreignKeys = [...parentKeys, ...keys, ...otherKeys].map((key) => {
    const group = `${key.table}:${key.id}`;
    if (!ids.has(group)) ids.set(group, ids.size);
    return { ...key, id: ids.get(group)! };
  });
  delete result.tables.product_units;
  return result;
}

export function madridWithOptionDefaults(
  original: CanonicalMadridSemantics,
): CanonicalMadridSemantics {
  const result = structuredClone(original);
  const lists = result.tables.option_lists!;
  const labels = result.tables.option_labels!;
  const defaults = new Map(Object.values(lists.rows).map((row) => [row.id, row.default_label_id]));
  lists.columns = lists.columns.filter((column) => column.name !== "default_label_id");
  for (const row of Object.values(lists.rows)) delete row.default_label_id;
  labels.columns.push({
    name: "is_default",
    type: "INTEGER",
    notnull: 1,
    pk: 0,
    dflt_value: "false",
  });
  for (const row of Object.values(labels.rows))
    row.is_default = defaults.get(row.list_id) === row.id ? 1 : 0;
  return result;
}

export function madridWithSectionColumns(
  original: CanonicalMadridSemantics,
): CanonicalMadridSemantics {
  const result = structuredClone(original);
  const sections = result.tables.sections!;
  sections.columns.find((column) => column.name === "internal_name")!.notnull = 0;
  for (const row of Object.values(sections.rows))
    if (row.role === "menu_root") row.internal_name = null;
  const members = result.tables.section_members!;
  const position = members.columns.findIndex((column) => column.name === "folder_overrides");
  members.columns.splice(
    position,
    1,
    ...[
      "folder_names",
      "folder_image",
      "folder_image_fixed",
      "folder_color",
      "folder_color_fixed",
    ].map((name) => ({
      name,
      type: name.endsWith("_fixed") ? "INTEGER" : "TEXT",
      notnull: name.endsWith("_fixed") ? 1 : 0,
      pk: 0,
      dflt_value: name.endsWith("_fixed") ? "false" : null,
    })),
  );
  for (const row of Object.values(members.rows)) {
    const columns = columnsFromOverrides(row.folder_overrides as IncludeFolderOverrides);
    delete row.folder_overrides;
    Object.assign(row, {
      folder_names: columns.folderNames,
      folder_image: columns.folderImage,
      folder_image_fixed: Number(columns.folderImageFixed),
      folder_color: columns.folderColor,
      folder_color_fixed: Number(columns.folderColorFixed),
    });
  }
  return result;
}
