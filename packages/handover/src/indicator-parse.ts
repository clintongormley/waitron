import { AppError } from "@waitron/shared";
import { parseBinding } from "./binding.js";
import "./errors.js";
import type { FinalStateIndicator } from "./indicator.js";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const WHERE = ["node.db", "venue.db", "state", "venue-folder"];
const CLASS = ["transferred", "source-only", "destination-owned", "rebuildable"];
const REVISION_BINDING_KEYS = ["module", "action", "eventId", "sourceId", "targetNodeId"];

function refuse(field: string): never {
  throw new AppError("handover.indicator_mismatch", { field });
}

function isObject(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

function objectWith(
  raw: unknown,
  field: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isObject(raw)) refuse(field);
  const prefix = field === "indicator" ? "" : `${field}.`;
  for (const key of required) if (!Object.hasOwn(raw, key)) refuse(`${prefix}${key}`);
  for (const key of Object.keys(raw)) {
    if (!required.includes(key) && !optional.includes(key)) refuse(`${prefix}${key}`);
  }
  return raw;
}

function listAt(raw: unknown, field: string): unknown[] {
  if (!Array.isArray(raw)) refuse(field);
  return raw;
}

function text(raw: unknown, field: string): void {
  if (typeof raw !== "string" || raw === "") refuse(field);
}

function digest(raw: unknown, field: string): void {
  if (typeof raw !== "string" || !SHA256_HEX.test(raw)) refuse(field);
}

function atLeast(raw: unknown, floor: number, field: string): void {
  if (!Number.isSafeInteger(raw) || (raw as number) < floor) refuse(field);
}

function schemaEntry(raw: unknown, field: string): string {
  const entry = objectWith(raw, field, ["set", "version", "journalSha256"]);
  text(entry.set, `${field}.set`);
  atLeast(entry.version, 0, `${field}.version`);
  digest(entry.journalSha256, `${field}.journalSha256`);
  return entry.set as string;
}

function moduleEntry(raw: unknown, field: string): string {
  const entry = objectWith(raw, field, ["name", "version"]);
  text(entry.name, `${field}.name`);
  text(entry.version, `${field}.version`);
  return entry.name as string;
}

function namedOnce(
  raws: readonly unknown[],
  field: string,
  key: string,
  check: (raw: unknown, field: string) => string,
): void {
  const seen = new Set<string>();
  raws.forEach((raw, index) => {
    const name = check(raw, `${field}.${index}`);
    if (seen.has(name)) refuse(`${field}.${index}.${key}`);
    seen.add(name);
  });
}

// As strict as `module-preparation-state.ts`'s own reader: M2 merges these into its file, and a
// revision that reader refuses would fail every later module operation on M2.
function revision(raw: unknown, field: string): void {
  const entry = objectWith(raw, field, ["binding", "value"]);
  const binding = objectWith(entry.binding, `${field}.binding`, REVISION_BINDING_KEYS);
  for (const key of REVISION_BINDING_KEYS) {
    const value = binding[key];
    if (typeof value !== "string" || value.trim() === "") refuse(`${field}.binding.${key}`);
  }
}

function nodeLocalRow(raw: unknown, field: string): Record<string, unknown> {
  const row = objectWith(
    raw,
    field,
    ["item", "where", "class", "treatment"],
    ["sha256", "ringVersions", "revisions"],
  );
  text(row.item, `${field}.item`);
  if (!WHERE.includes(row.where as string)) refuse(`${field}.where`);
  if (!CLASS.includes(row.class as string)) refuse(`${field}.class`);
  text(row.treatment, `${field}.treatment`);
  const named = `nodeLocal.${row.item as string}`;
  if (row.sha256 !== undefined && row.sha256 !== null) digest(row.sha256, `${named}.sha256`);
  if (row.ringVersions !== undefined) {
    listAt(row.ringVersions, `${named}.ringVersions`).forEach((version, index) => {
      atLeast(version, 1, `${named}.ringVersions.${index}`);
    });
  }
  if (row.revisions !== undefined) {
    listAt(row.revisions, `${named}.revisions`).forEach((entry, index) => {
      revision(entry, `${named}.revisions.${index}`);
    });
  }
  return row;
}

// Each is what a later check reads, so its absence must not read as a value both boxes share.
const REQUIRED_STATE_FIELDS: readonly (readonly [string, string])[] = [
  ["backup.env", "sha256"],
  ["modules.json", "sha256"],
  ["secrets.env", "ringVersions"],
  ["module-preparation-state.json", "revisions"],
];

function nodeLocal(raw: unknown): void {
  const seen = new Map<string, Record<string, unknown>>();
  listAt(raw, "nodeLocal").forEach((entry, index) => {
    const row = nodeLocalRow(entry, `nodeLocal.${index}`);
    const key = `${row.where as string}/${row.item as string}`;
    if (seen.has(key)) refuse(`nodeLocal.${index}.item`);
    seen.set(key, row);
  });
  for (const [item, field] of REQUIRED_STATE_FIELDS) {
    const row = seen.get(`state/${item}`);
    if (row === undefined) refuse(`nodeLocal.${item}`);
    if (!Object.hasOwn(row, field)) refuse(`nodeLocal.${item}.${field}`);
  }
}

/**
 * The body of a signed final-state indicator, refused unless it has the whole shape. A valid
 * signature says only who sent the body, and nothing in `verifyEnvelope` reads its fields.
 */
export function parseIndicator(raw: unknown): FinalStateIndicator {
  const body = objectWith(raw, "indicator", [
    "binding",
    "snapshot",
    "nodeLocal",
    "modulesSummary",
    "capturedAtMs",
  ]);
  try {
    parseBinding(body.binding);
  } catch {
    refuse("binding");
  }
  const snapshot = objectWith(body.snapshot, "snapshot", ["sha256", "bytes", "schema", "modules"]);
  digest(snapshot.sha256, "snapshot.sha256");
  atLeast(snapshot.bytes, 0, "snapshot.bytes");
  namedOnce(listAt(snapshot.schema, "snapshot.schema"), "snapshot.schema", "set", schemaEntry);
  namedOnce(listAt(snapshot.modules, "snapshot.modules"), "snapshot.modules", "name", moduleEntry);
  nodeLocal(body.nodeLocal);
  if (!isObject(body.modulesSummary)) refuse("modulesSummary");
  if (!Number.isSafeInteger(body.capturedAtMs)) refuse("capturedAtMs");
  return body as unknown as FinalStateIndicator;
}
