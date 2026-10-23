import { parseSchema } from "./schema-model.mjs";
import { isDeepStrictEqual } from "node:util";
import { fail } from "./contracts.mjs";
import { fingerprint, object, text, literal, list, unique } from "./values.mjs";

export const mappingFailure = (detail) => fail("history.mapping", detail);
const source = (v, p) => {
  if (typeof v !== "string" || !/^[0-9a-f]{40}$/.test(v)) mappingFailure(p);
};
const hash = (v, p) => {
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) mappingFailure(p);
};

export function validateMappings(mappings, cell) {
  if (!Array.isArray(mappings)) mappingFailure("mappings array");
  if (!mappings.length) return [];
  if (cell === undefined) mappingFailure("explicit cell context required");
  try {
    object(
      cell,
      {
        sourceEpoch: text,
        sourceSha: source,
        candidateSha: source,
        migrations: list((v, p) => object(v, { hash, module: text }, p)),
        disabledModules: list(text),
      },
      "cell",
    );
    list((m, p) => {
      object(
        m,
        {
          id: text,
          sourceEpoch: text,
          sourceSha: source,
          candidateSha: source,
          migrationHash: hash,
          module: text,
          object: (v, path) => object(v, { subject: literal("rows", "schema"), key: text }, path),
          field: text,
          before: () => {},
          after: () => {},
          exactTransform: literal("add-null-field", "rename-object", "replace-exact"),
          reason: text,
          approvalReceipt: text,
        },
        p,
      );
      if (
        m.sourceEpoch !== cell.sourceEpoch ||
        m.sourceSha !== cell.sourceSha ||
        m.candidateSha !== cell.candidateSha ||
        !cell.migrations.some((x) => x.hash === m.migrationHash && x.module === m.module) ||
        cell.disabledModules.includes(m.module) ||
        [m.object.key, m.field].some((s) => s.includes("*"))
      )
        mappingFailure(m.id);
      if (m.object.subject === "schema") {
        if (
          m.exactTransform !== "replace-exact" ||
          m.field !== "object" ||
          !m.before ||
          !m.after ||
          m.before.module !== m.module ||
          m.after.module !== m.module ||
          m.before.protection !== "ordinary" ||
          m.after.protection !== "ordinary"
        )
          mappingFailure(m.id);
        parseSchema([m.before]);
        parseSchema([m.after]);
      } else if (m.exactTransform === "add-null-field") {
        if (m.before !== null) mappingFailure(m.id);
        object(m.after, { kind: literal("null") }, "mapping.after");
      } else if (m.exactTransform === "rename-object") {
        text(m.before, p);
        text(m.after, p);
        if (
          m.field !== "table" ||
          m.before !== m.object.key ||
          m.before === m.after ||
          m.after.includes("*")
        )
          mappingFailure(m.id);
      } else mappingFailure(m.id);
    })(mappings, "mappings");
    unique(
      mappings.map((m) => m.id),
      "mapping ids",
    );
    unique(
      mappings.map((m) => fingerprint([m.object, m.field])),
      "mapping targets",
    );
  } catch (error) {
    mappingFailure(error.message);
  }
  return globalThis.structuredClone(mappings);
}

export function applySchemaMappings(schema, mappings) {
  const result = globalThis.structuredClone(schema);
  for (const m of mappings) {
    const i = result.findIndex((s) => `${s.kind}:${s.name}` === m.object.key);
    if (i < 0 || !isDeepStrictEqual(result[i], m.before)) mappingFailure(`${m.id}: schema before`);
    result[i] = globalThis.structuredClone(m.after);
  }
  return result;
}
