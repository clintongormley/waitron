import {
  recomputeMadridHashes,
  stable,
  type CanonicalMadridSemantics,
} from "./madrid-semantics.js";

export function madridWithRenamedTables(
  original: CanonicalMadridSemantics,
  renames: Readonly<Record<string, string>>,
): CanonicalMadridSemantics {
  const result = structuredClone(original);
  for (const [old, next] of Object.entries(renames)) {
    if (!Object.hasOwn(result.tables, old) || Object.hasOwn(result.tables, next))
      throw new Error(`unused or invalid Madrid table rename: ${old} -> ${next}`);
    result.tables = Object.fromEntries(
      Object.entries(result.tables).map(([name, table]) => [name === old ? next : name, table]),
    );
    for (const table of Object.values(result.tables))
      for (const key of table.foreignKeys) if (key.table === old) key.table = next;
  }
  const alias = (value: string): string => {
    if (!/^@[a-z_]+:\[/.test(value)) return value;
    const colon = value.indexOf(":");
    const table = value.slice(1, colon);
    const parts = JSON.parse(value.slice(colon + 1)) as unknown[];
    return `@${renames[table] ?? table}:${stable(parts.map((part) => (typeof part === "string" ? alias(part) : part)))}`;
  };
  if (
    ["catalogues", "menus", "sessions", "management_sessions", "management_account_actions"].some(
      (name) => Object.hasOwn(renames, name),
    )
  ) {
    recomputeMadridHashes(result, { alias });
    result.tables = Object.fromEntries(
      Object.entries(result.tables).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return result;
}
