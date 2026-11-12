import {
  recomputeMadridHashes,
  stable,
  type CanonicalMadridSemantics,
} from "./madrid-semantics.js";

export interface MadridNameChange {
  table: string;
  row: string;
  column: string;
  old: unknown;
  new: string;
}

const NAME_COLUMNS: Record<string, readonly string[]> = {
  products: ["name", "name_key", "kitchen_name"],
  catalogues: ["name"],
  sections: ["internal_name"],
  categories: ["name"],
  option_lists: ["name", "kitchen_name"],
  option_labels: ["name", "kitchen_name"],
  extra_lists: ["name", "kitchen_name"],
  units: ["staff_name", "staff_abbreviation"],
  kitchen_stations: ["name"],
  printers: ["name"],
  special_days: ["name"],
  menu_periods: ["name"],
};

/** Apply only the reviewed name cells to the original capture; dependent ids and publication
 * hashes follow those cells. Customer wording and every other row value remain in the capture. */
export function madridWithNameChanges(
  original: CanonicalMadridSemantics,
  changes: MadridNameChange[],
): CanonicalMadridSemantics {
  const result = structuredClone(original);
  const directIds = new Map<string, string>();
  const changed = new Map<string, Record<string, string>>();
  const seen = new Set<string>();
  for (const change of changes) {
    const { table, row: key, column, old, new: value } = change;
    const row = result.tables[table]?.rows[key];
    const cell = `${table}/${key}/${column}`;
    if (
      !NAME_COLUMNS[table]?.includes(column) ||
      !row ||
      !Object.hasOwn(row, column) ||
      row[column] !== old ||
      old === value ||
      seen.has(cell)
    )
      throw new Error(`unused or invalid Madrid name change: ${cell}`);
    seen.add(cell);
    row[column] = value;
    changed.set(key, { ...changed.get(key), [column]: value });
  }
  // Only these identity classes include a changed plain name in their semantic key.
  for (const [key, fields] of changed) {
    const table = key.slice(1, key.indexOf(":"));
    const column =
      table === "sections" ? "internal_name" : table === "units" ? "staff_name" : "name";
    if (table === "products" || table === "option_labels" || fields[column] === undefined) continue;
    const parts = JSON.parse(key.slice(key.indexOf(":") + 1)) as unknown[];
    parts[parts.length - 1] = fields[column];
    directIds.set(key, `@${table}:${stable(parts)}`);
  }
  const alias = (value: string): string => {
    const direct = directIds.get(value) ?? value;
    if (!/^@[a-z_]+:\[/.test(direct)) return direct;
    const colon = direct.indexOf(":");
    const parts = JSON.parse(direct.slice(colon + 1)) as unknown[];
    return (
      direct.slice(0, colon + 1) +
      stable(parts.map((part) => (typeof part === "string" ? alias(part) : part)))
    );
  };
  recomputeMadridHashes(result, {
    alias,
    editDocumentRow: (row) => {
      const key = String(row.productId ?? row.sectionId ?? row.id);
      const fields = changed.get(key);
      if (fields) {
        const columns = {
          name: "name",
          kitchenName: "kitchen_name",
          internalName: "internal_name",
          staffName: "staff_name",
          staffAbbreviation: "staff_abbreviation",
        };
        for (const [field, column] of Object.entries(columns))
          if (Object.hasOwn(row, field) && fields[column] !== undefined)
            row[field] = fields[column];
        if (row.presentation !== null && typeof row.presentation === "object") {
          const presentation = { ...row.presentation } as Record<string, unknown>;
          if (fields.name !== undefined) presentation.name = fields.name;
          if (fields.kitchen_name !== undefined) presentation.kitchenName = fields.kitchen_name;
          row.presentation = presentation;
        }
      }
      if (Object.hasOwn(row, "menuName"))
        row.menuName = changed.get(String(row.menuId))?.name ?? row.menuName;
    },
  });
  return result;
}
