import { compareFields, compareKeyed } from "./values.mjs";
import { parseSchema, sqlTokens } from "./schema-model.mjs";
export { parseSchema, sqlTokens } from "./schema-model.mjs";
import { mappingFailure, validateMappings, applySchemaMappings } from "./mappings.mjs";

function normalized(value, field = "") {
  if (
    typeof value === "string" &&
    ["rawSql", "body", "defaultSql", "predicate", "checks", "expressions"].includes(field)
  )
    return sqlTokens(value);
  if (Array.isArray(value)) return value.map((v) => normalized(v, field));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalized(v, k)]));
  return value;
}

export function compareSchema(expected, actual, rawMappings = [], cell) {
  const mappings = validateMappings(rawMappings, cell);
  if (mappings.some((m) => m.object.subject !== "schema"))
    mappingFailure("schema-only mappings required");
  const mapped = applySchemaMappings(parseSchema(expected), mappings);
  return compareKeyed(
    "schema",
    parseSchema(mapped),
    parseSchema(actual),
    (v) => `${v.kind}:${v.name}`,
    (a, b, key) => compareFields("schema", key, normalized(a), normalized(b)),
  );
}
