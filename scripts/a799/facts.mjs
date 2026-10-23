import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";
import { fail, parseWorkInputs } from "./contracts.mjs";
import { parseSchema } from "./schema.mjs";
import {
  invalid,
  object,
  text,
  natural,
  literal,
  nullable,
  list,
  unique,
  fingerprint,
} from "./values.mjs";

function integer(v, p) {
  text(v, p);
  if (
    !/^(0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(v) ||
    BigInt(v) < -9223372036854775808n ||
    BigInt(v) > 9223372036854775807n
  )
    invalid(p);
}
export function hash(v, p) {
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) invalid(p);
}
function base64(v, p) {
  if (typeof v !== "string" || Buffer.from(v, "base64").toString("base64") !== v) invalid(p);
}
export function typed(v, p) {
  const fields = {
    null: {},
    integer: { decimal: integer },
    real: {
      ieee754Hex: (s, path) => {
        if (
          typeof s !== "string" ||
          !/^[0-9a-f]{16}$/.test(s) ||
          !Number.isFinite(Buffer.from(s, "hex").readDoubleBE())
        )
          invalid(path);
      },
    },
    text: { base64 },
    blob: { base64 },
  };
  if (!Object.hasOwn(fields, v?.kind)) invalid(p);
  object(v, { kind: literal(...Object.keys(fields)), ...fields[v.kind] }, p);
}

/** Integer input is a decimal string; REAL input is its eight big-endian IEEE-754 bytes. */
export function encodeTyped(storageType, rawBytes) {
  let result;
  if (storageType === "null") {
    if (rawBytes !== null) invalid("storage.null");
    result = { kind: "null" };
  } else if (storageType === "integer") result = { kind: "integer", decimal: rawBytes };
  else if (["text", "blob", "real"].includes(storageType)) {
    if (!(rawBytes instanceof Uint8Array)) invalid("storage.bytes");
    result =
      storageType === "real"
        ? { kind: "real", ieee754Hex: Buffer.from(rawBytes).toString("hex") }
        : { kind: storageType, base64: Buffer.from(rawBytes).toString("base64") };
  } else invalid("storage.type");
  typed(result, "storage");
  return result;
}
const tuple = list(typed, 1);
const ref = (v, p) => object(v, { table: text, key: tuple }, p);
export const rowKey = (r) => `${r.table}:${fingerprint(r.key)}`;
function fields(v, p) {
  if (v === null || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length === 0)
    invalid(p);
  for (const [k, value] of Object.entries(v)) {
    text(k, p);
    typed(value, `${p}.${k}`);
  }
}
const row = (v, p) => object(v, { table: text, key: tuple, fields }, p);
const path = (v, p) => {
  text(v, p);
  if (
    v.includes("\\") ||
    v.includes("\0") ||
    v.includes(":") ||
    v.split("/").some((s) => !s || s === "." || s === "..")
  )
    invalid(p);
};
const file = (v, p) => {
  object(v, { path, sha256: hash, bytes: natural, mode: natural }, p);
  if (v.mode > 511) invalid(p);
};
const relationship = (v, p) => {
  object(
    v,
    {
      id: text,
      fromTable: text,
      fromKey: tuple,
      fromColumns: list(text, 1),
      toTable: text,
      toKey: nullable(tuple),
      toColumns: list(text, 1),
    },
    p,
  );
  if (v.fromColumns.length !== v.toColumns.length) invalid(p);
};
const issued = (v, p) =>
  object(
    v,
    {
      table: text,
      key: tuple,
      typeField: text,
      numberField: text,
      number: typed,
      nameField: text,
      name: typed,
      addressField: text,
      address: typed,
    },
    p,
  );
const coverage = (v, p) =>
  object(
    v,
    {
      sales: list(ref),
      fiscal: list(ref),
      people: list(ref),
      menus: list(ref),
      events: list(ref),
      issuedF1: list(issued),
      optional: (o, where) =>
        object(
          o,
          {
            module: text,
            state: literal("disabled-retained", "never-enabled"),
            tables: list(text, 1),
          },
          where,
        ),
    },
    p,
  );
const identityFields = Object.fromEntries(
  [
    "node",
    "keyHash",
    "sif",
    "installation",
    "series",
    "nextNumber",
    "fiscalHead",
    "workforceHead",
  ].map((k) => [k, typed]),
);
const newSaleFields = Object.fromEntries(
  ["quantity", "unitPrice", "total", "tender", "change"].map((k) => [k, typed]),
);
const rule = (v, p) =>
  object(
    v,
    {
      table: text,
      key: tuple,
      field: text,
      before: typed,
      after: typed,
      cause: text,
      approvalReceipt: text,
    },
    p,
  );

/** Parses already-decoded objects, without treating their provenance as authenticated. */
export function parseFacts(value) {
  object(
    value,
    {
      version: literal(1),
      fixtureId: text,
      rows: list(row),
      schema: parseSchema,
      journals: (v) => {
        parseWorkInputs(v, [], []);
      },
      files: list(file),
      relationships: list(relationship),
      coverage,
      identity: (v, p) => object(v, identityFields, p),
      operationalRules: list(rule),
      newSale: (v, p) => object(v, newSaleFields, p),
    },
    "facts",
  );
  for (const [section, key] of [
    ["rows", rowKey],
    ["files", (f) => f.path],
    ["relationships", (r) => r.id],
    ["operationalRules", (r) => fingerprint([r.table, r.key, r.field])],
  ])
    unique(value[section].map(key), section);
  const tables = new Set(value.schema.filter((s) => s.kind === "table").map((s) => s.name));
  for (const r of value.rows)
    if (!tables.has(r.table)) invalid(`rows.${r.table}: undeclared table`);
  return globalThis.structuredClone(value);
}

export function validateCoverage(rawFacts) {
  const facts = parseFacts(rawFacts);
  const rows = new Map(facts.rows.map((r) => [rowKey(r), r]));
  const bad = (detail) => fail("history.coverage", detail);
  for (const category of ["sales", "fiscal", "people", "menus", "events", "issuedF1"]) {
    const refs = facts.coverage[category];
    if (!refs.length) bad(category);
    unique(refs.map(rowKey), `coverage.${category}`);
    for (const r of refs) {
      if (!rows.has(rowKey(r))) bad(`${category}:${rowKey(r)}`);
      if (
        category === "fiscal" &&
        !facts.schema.some(
          (s) => s.kind === "table" && s.name === r.table && s.protection === "fiscal",
        )
      )
        bad(`${category}:${rowKey(r)}`);
    }
  }
  for (const invoice of facts.coverage.issuedF1) {
    const fields = rows.get(rowKey(invoice)).fields;
    const nonemptyText = (v) => v.kind === "text" && Buffer.from(v.base64, "base64").length > 0;
    if (
      !isDeepStrictEqual(fields[invoice.typeField], { kind: "text", base64: "RjE=" }) ||
      !facts.coverage.sales.some((r) => rowKey(r) === rowKey(invoice)) ||
      !nonemptyText(invoice.number) ||
      !nonemptyText(invoice.name) ||
      !nonemptyText(invoice.address) ||
      !isDeepStrictEqual(fields[invoice.numberField], invoice.number) ||
      !isDeepStrictEqual(fields[invoice.nameField], invoice.name) ||
      !isDeepStrictEqual(fields[invoice.addressField], invoice.address)
    )
      bad(`issuedF1:${rowKey(invoice)}`);
  }
  const off = facts.coverage.optional;
  unique(off.tables, "coverage.optional.tables");
  for (const name of off.tables) {
    const schema = facts.schema.find((s) => s.kind === "table" && s.name === name);
    const present = facts.rows.some((r) => r.table === name);
    if (
      off.state === "disabled-retained"
        ? !schema || schema.module !== off.module || schema.protection !== "disabled" || !present
        : schema !== undefined || present
    )
      bad(`optional:${name}`);
  }
}
