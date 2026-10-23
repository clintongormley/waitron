import { compareSchema } from "./schema.mjs";
import { parseFacts, rowKey, validateCoverage } from "./facts.mjs";
import { isDeepStrictEqual } from "node:util";
import { mappingFailure, validateMappings, applySchemaMappings } from "./mappings.mjs";
export { validateMappings } from "./mappings.mjs";
import { compareKeyed, compareFields, fingerprint } from "./values.mjs";

export function compareFacts(rawExpected, rawActual, rawMappings = [], cell) {
  const expected = parseFacts(rawExpected);
  const actual = parseFacts(rawActual);
  validateCoverage(expected);
  const mappings = validateMappings(rawMappings, cell);
  for (const rule of expected.operationalRules) {
    const table = expected.schema.find((s) => s.kind === "table" && s.name === rule.table);
    const row = expected.rows.find((r) => rowKey(r) === rowKey(rule));
    if (
      table?.protection !== "ordinary" ||
      !row ||
      !isDeepStrictEqual(row.fields[rule.field], rule.before)
    )
      mappingFailure(`operational:${rule.table}.${rule.field}`);
    row.fields[rule.field] = globalThis.structuredClone(rule.after);
  }
  for (const mapping of mappings.filter((m) => m.object.subject === "rows")) {
    const table = expected.schema.find((s) => s.kind === "table" && s.name === mapping.object.key);
    const rows = expected.rows.filter((r) => r.table === mapping.object.key);
    if (
      !table ||
      table.module !== mapping.module ||
      table.protection !== "ordinary" ||
      !rows.length
    )
      mappingFailure(mapping.id);
    if (mapping.exactTransform === "add-null-field") {
      for (const row of rows) {
        if (Object.hasOwn(row.fields, mapping.field)) mappingFailure(`${mapping.id}: field exists`);
        row.fields = { ...row.fields, [mapping.field]: globalThis.structuredClone(mapping.after) };
      }
    } else {
      if (
        mapping.before !== table.name ||
        expected.schema.some((s) => s.kind === "table" && s.name === mapping.after)
      )
        mappingFailure(`${mapping.id}: rename collision`);
      for (const row of rows) row.table = mapping.after;
      for (const relation of expected.relationships) {
        if (relation.fromTable === mapping.before) relation.fromTable = mapping.after;
        if (relation.toTable === mapping.before) relation.toTable = mapping.after;
      }
      for (const category of ["sales", "fiscal", "people", "menus", "events", "issuedF1"])
        for (const ref of expected.coverage[category])
          if (ref.table === mapping.before) ref.table = mapping.after;
    }
  }
  expected.schema = applySchemaMappings(
    expected.schema,
    mappings.filter((m) => m.object.subject === "schema"),
  );
  const diffs = [];
  if (expected.fixtureId !== actual.fixtureId)
    diffs.push(
      ...compareFields(
        "facts",
        "fixture",
        { fixtureId: expected.fixtureId },
        { fixtureId: actual.fixtureId },
      ),
    );
  diffs.push(
    ...compareKeyed("rows", expected.rows, actual.rows, rowKey, (a, b, key) =>
      compareFields("rows", key, a.fields, b.fields),
    ),
  );
  diffs.push(...compareSchema(expected.schema, actual.schema, []));
  for (const [section, keyFor] of [
    ["journals", (j) => j.set],
    ["files", (f) => f.path],
    ["relationships", (r) => r.id],
  ])
    diffs.push(
      ...compareKeyed(section, expected[section], actual[section], keyFor, (a, b, key) =>
        compareFields(section, key, a, b),
      ),
    );
  for (const section of ["identity", "coverage", "newSale"])
    diffs.push(...compareFields(section, section, expected[section], actual[section]));
  diffs.push(
    ...compareKeyed(
      "operationalRules",
      expected.operationalRules,
      actual.operationalRules,
      (r) => fingerprint([r.table, r.key, r.field]),
      (a, b, key) => compareFields("operationalRules", key, a, b),
    ),
  );
  return {
    ok: diffs.length === 0,
    diffs,
    comparedByKind: {
      rows: expected.rows.length,
      fields: expected.rows.reduce((n, r) => n + Object.keys(r.fields).length, 0),
      schema: expected.schema.length,
      journals: expected.journals.length,
      files: expected.files.length,
      relationships: expected.relationships.length,
      identity: Object.keys(expected.identity).length,
      coverage: 1,
      operationalRules: expected.operationalRules.length,
      newSale: Object.keys(expected.newSale).length,
    },
  };
}
