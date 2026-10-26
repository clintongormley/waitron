/**
 * An error code's detail whose name looks like a person's is masked in the log
 * (`apps/server/src/log-personal-data.ts`), or named harmless here with a reason.
 *
 * Weaker than its name: it reads TEXT; it judges a key by a word list, so a key whose name says
 * nothing about a person passes; it judges only keys written in a registry's text, so a throw site
 * that spreads an object can carry keys its registry type does not name (`{ ...prepared.venue }`,
 * `apps/server/src/restore-request.ts:280` and `apps/server/src/restore-stream.ts:378`: if
 * `RestoredVenue`, `apps/server/src/restore-stream.ts:41-45`, gained an `ownerEmail`, the answer and
 * the log line would carry it and this guard would stay green); it never reads free text; and it
 * judges a named type in a registry only by its name, against `REVIEWED_TYPES`, so a person-named
 * key added later inside a type already reviewed passes. Of a log call's fields it reads only an
 * object literal written as the third argument, so it sees no spread or variable passed as the
 * fields; and it does not see `packages/store/src/venue-liveness.ts:174-179`, which writes
 * `waitron.log` without a `Logger`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { PERSONAL_LOG_KEYS, PERSONAL_LOG_PATHS } from "../apps/server/src/log-personal-data.js";
import { blankComments, blankCommentsAndLiterals } from "../packages/shared/src/source-comments.js";

const ROOT = join(import.meta.dirname, "..");

const REVIEWED_TYPES: ReadonlyMap<string, string> = new Map([
  ["AllocationPreview", "a payment's allocation: a choice, money amounts and options; no person"],
  ["Approval", "how an adjustment is approved: a kind, staff role names and a limit; no person"],
  ["Array", "TypeScript's own; holds what its arguments name, which the guard reads"],
  ["BillEditState", "holds editorName, which is on the list, beside ids and revision numbers"],
  ["BucketOperation", "an enum of bucket requests: get, put, list or delete"],
  [
    "BusinessDayClockConflict",
    "ids, department, zone, period, season and special-day names, times and a reason",
  ],
  [
    "CancellationContext",
    "a bill's status and stage and its components' ids, states and quantities",
  ],
  ["DestinationCleanup", "an enum of clean-up requests: abort_upload or delete_object"],
  ["DestinationOperation", "an enum of archive file store requests"],
  ["EquipmentField", "an enum of a device's equipment field names"],
  [
    "FacturaParams",
    "an invoice as AEAT names it: idEmisorFactura, which is on the list, number and date",
  ],
  ["HomeDevice", "an enum: handheld or till"],
  [
    "LineaParams",
    "inherits idEmisorFactura, on the list, from FacturaParams (packages/fiscal-verifactu/src/errors.ts:15); adds AEAT's reply codes and message",
  ],
  ["MemberRef", "a menu section member: a kind and a product or section id"],
  ["MenuUse", "where a menu is used: a kind and zone and period ids"],
  ["Operacion", "an enum of AEAT operations: Alta or Anulacion"],
  ["OrphanRemediation", "an enum of what a reconcile sweep did with an orphaned payment"],
  ["OvertakenEdition", "a menu edition: a version id, a number and an instant"],
  ["ProbeFailure", "an enum of bucket probe failures"],
  ["ProductUsingUnit", "a product's id, name and whether it is active; the name of a thing"],
  ["Readonly", "TypeScript's own; holds what its argument names, which the guard reads"],
  ["Record", "TypeScript's own; holds what its arguments name, which the guard reads"],
  ["ThemeNameRefusal", "an enum: empty, too_long or reserved"],
  ["ThemeRefusalReason", "an enum of why a theme document is refused"],
  ["UnservedDish", "a dish's bill and line ids, its name, quantity and CancellationContext"],
  ["VerifyFailure", "an enum of why a membership document fails verification"],
]);

const HARMLESS_LOG_FIELDS: ReadonlyMap<string, string> = new Map([
  ["discovery.mounted.hostname", "the box's own host name"],
  ["mdns.responding.hostname", "the box's own host name"],
  ["recovery.venue_held.holderKind", "an enum of which process holds the venue folder"],
  ["recovery.venue_holder_stalled.holderKind", "an enum of which process holds the venue folder"],
  [
    "restore.recovery_key_selected.name",
    "a recovery key's name: a date and a random code (apps/server/src/break-glass.ts)",
  ],
  ["staff_notice.duplicate_key.owner", "the id of a notice's source, such as fiscal-outbox"],
  ["staff_notice.source_recovered.owner", "the id of a notice's source, such as fiscal-outbox"],
  ["staff_notice.source_unavailable.owner", "the id of a notice's source, such as fiscal-outbox"],
]);

const NOT_PERSONAL: ReadonlyMap<string, string> = new Map([
  ["adjustment_reason.name_taken.name", "the name of an adjustment reason"],
  ["backup.destination_cleanup_failed.name", 'an error\'s name from a fixed list, or "other"'],
  ["backup.destination_request_failed.name", 'an error\'s name from a fixed list, or "other"'],
  ["backup.stream_request_failed.name", 'an error\'s name from a fixed list, or "other"'],
  ["category.name_taken.name", "the name of a category"],
  [
    "clock.behind_chain_restarted.confirmedBy",
    "an enum of who confirmed: authority, devices or admin",
  ],
  ["course.name_taken.name", "the name of a course"],
  ["credentials.key_invalid.byteLength", "a size in bytes"],
  ["department.name_taken.name", "the name of a department"],
  ["device.equipment_held.holderDeviceName", "the name of a device"],
  [
    "extras.unsupported_product.soldBy",
    "an enum of how a product is sold: weight, fraction or measure",
  ],
  ["floor_plan_set.name_taken.name", "the name of a floor-plan set"],
  ["image.hash_conflict.filename", "an uploaded image's file name"],
  ["menu_period.ended.periodName", "the name of a menu period"],
  ["menu_period.name_taken.name", "the name of a menu period"],
  ["menu_publication.time_past.activatesAt", "an instant"],
  ["migrations.set_missing.name", "the name of a migration set"],
  ["printer.bluetooth_not_discovered.address", "a Bluetooth address"],
  ["printer.bluetooth_not_paired.address", "a Bluetooth address"],
  ["product.name_taken.name", "the name of a product"],
  ["product.offered_as_extra.name", "the name of an extras list"],
  ["product.on_live_menu.name", "the name of a product or a menu"],
  ["provisioning.key_generation_failed.byteLength", "a size in bytes"],
  ["restore.stream_venue_unconfirmed.locationName", "the name of the venue's location"],
  ["restore.unexpected_entry.name", "the name of an entry in a backup archive"],
  ["restore.unsafe_entry_path.name", "the name of an entry in a backup archive"],
  ["route.dish_not_sent.orderLabel", "an order's label, the name of a thing"],
  ["route.released_at_closed_station.orderLabel", "an order's label, the name of a thing"],
  ["service_zone.not_found.departmentName", "the name of a department"],
  ["service_zone.not_found.name", "the name of a category or product in an import"],
  ["service_zone.not_found.zoneName", "the name of a zone"],
  ["special_day.date_taken.name", "the name of a special day"],
  ["staff_role.name_taken.name", "the name of a staff role"],
  ["station.name_taken.name", "the name of a station"],
  ["station.thresholds_invalid.name", "the name of a station"],
  ["table.label_taken.label", "a saved table's label, the name of a thing"],
  ["table.label_taken.takenBy", "the name of the table holding the label"],
  ["table.short_name_taken.shortName", "a table's short name"],
  ["table.short_name_taken.takenBy", "the name of the table holding the short name"],
  ["zone.name_taken.name", "the name of a zone"],
  ["zone.table_in_use.tableName", "the name of a table"],
]);

interface RegistryType {
  file: string;
  name: string;
}

interface LogField {
  event: string;
  key: string;
}

interface RegistryKey {
  code: string;
  key: string;
  parent: string | undefined;
}

const PERSON_WORDS =
  /email|mail|name|nombre|surname|apellido|phone|tel|mobile|tax|nif|nie|dni|cif|vat|emisor|recipient|destinatario|person|guest|owner|holder|editor|contact|address|label|who|user|staff|operator|waiter|customer|client/i;
const TAX_STEM = /tax|nif|nie|dni|cif|vat/i;
const ID_ENDING = /^(.*?)(?:Id|Ids)$/;
const REGISTRY_OPENING = /\binterface\s+ErrorParams\b[^{]*\{/g;
const CODE_MARK = /"([a-z0-9_]+(?:\.[a-z0-9_]+)+)"\s*:/g;
const TYPE_NAME = /\b[A-Z][\w$]*/g;
const LOG_CALL =
  /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\?\.)?\(\s*"(?:debug|info|warn|error)"\s*,/g;
const OBJECT_TOKEN = /[{}()[\]]|[A-Za-z_$][\w$]*/g;
const KEY_OR_BRACE = /([A-Za-z_$][\w$]*)\??\s*:|[{}]/g;

function isJudgedKey(key: string): boolean {
  const id = ID_ENDING.exec(key);
  if (id !== null && !TAX_STEM.test(id[1] ?? "")) return false;
  return PERSON_WORDS.test(key) || key.endsWith("By");
}

function closingBrace(code: string, opening: number): number {
  let depth = 0;
  for (let at = opening; at < code.length; at++) {
    if (code[at] === "{") depth++;
    else if (code[at] === "}" && --depth === 0) return at;
  }
  return code.length;
}

function keysOfEntry(code: string, text: string): RegistryKey[] {
  const keys: RegistryKey[] = [];
  const parents: (string | undefined)[] = [];
  let last: string | undefined;
  for (const match of text.matchAll(KEY_OR_BRACE)) {
    if (match[0] === "{") {
      parents.push(last);
      last = undefined;
    } else if (match[0] === "}") {
      last = parents.pop();
    } else if (match[1] !== undefined) {
      keys.push({ code, key: match[1], parent: parents.at(-1) });
      last = match[1];
    }
  }
  return keys;
}

interface RegistryBody {
  code: string;
  literalsBlank: string;
  bodyStart: number;
  bodyEnd: number;
}

function registryBodies(text: string): RegistryBody[] {
  const code = blankComments(text);
  const literalsBlank = blankCommentsAndLiterals(text);
  return [...code.matchAll(REGISTRY_OPENING)].map((opening) => {
    const bodyStart = opening.index + opening[0].length - 1;
    return { code, literalsBlank, bodyStart, bodyEnd: closingBrace(literalsBlank, bodyStart) };
  });
}

function registryTypeNames(text: string): string[] {
  const names = registryBodies(text).flatMap(({ literalsBlank, bodyStart, bodyEnd }) =>
    [...literalsBlank.slice(bodyStart + 1, bodyEnd).matchAll(TYPE_NAME)].map(([name]) => name),
  );
  return [...new Set(names)];
}

function unreviewedTypes(
  found: readonly RegistryType[],
  reviewed: ReadonlyMap<string, string>,
): string[] {
  const unreviewed = found
    .filter(({ name }) => !reviewed.has(name))
    .map(({ file, name }) => `${name} (${file})`);
  return [...new Set(unreviewed)];
}

function staleTypes(
  found: readonly RegistryType[],
  reviewed: ReadonlyMap<string, string>,
): string[] {
  const named = new Set(found.map(({ name }) => name));
  return [...reviewed.keys()].filter((name) => !named.has(name));
}

function registryKeys(text: string): RegistryKey[] {
  const keys: RegistryKey[] = [];
  for (const { code, literalsBlank, bodyStart, bodyEnd } of registryBodies(text)) {
    const marks = [...code.slice(bodyStart + 1, bodyEnd).matchAll(CODE_MARK)];
    marks.forEach((mark, index) => {
      const from = bodyStart + 1 + mark.index + mark[0].length;
      const to = bodyStart + 1 + (marks[index + 1]?.index ?? bodyEnd - bodyStart - 1);
      keys.push(...keysOfEntry(mark[1] ?? "", literalsBlank.slice(from, to)));
    });
  }
  return keys;
}

function judgedPairs(keys: readonly RegistryKey[]): RegistryKey[] {
  return keys.filter(({ key }) => isJudgedKey(key));
}

function refusedPairs(
  keys: readonly RegistryKey[],
  notPersonal: ReadonlyMap<string, string>,
): string[] {
  const refused = judgedPairs(keys)
    .filter(
      ({ code, key, parent }) =>
        !PERSONAL_LOG_KEYS.has(key) &&
        !(parent !== undefined && PERSONAL_LOG_PATHS.get(parent)?.has(key) === true) &&
        !notPersonal.has(`${code}.${key}`),
    )
    .map(({ code, key }) => `${code}.${key}`);
  return [...new Set(refused)];
}

function stalePairs(
  keys: readonly RegistryKey[],
  notPersonal: ReadonlyMap<string, string>,
): string[] {
  const judged = new Set(judgedPairs(keys).map(({ code, key }) => `${code}.${key}`));
  return [...notPersonal.keys()].filter((pair) => !judged.has(pair));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "testing" ? [] : sourceFiles(path);
    }
    return entry.isFile() && path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

function argumentEnd(text: string, from: number): number {
  let depth = 0;
  for (let at = from; at < text.length; at++) {
    const char = text[at];
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) return at;
      depth--;
    } else if (char === "," && depth === 0) return at;
  }
  return text.length;
}

function objectKeys(text: string): string[] {
  const keys: string[] = [];
  const open: string[] = [];
  for (const match of text.matchAll(OBJECT_TOKEN)) {
    const token = match[0];
    if (token === "{") open.push(text[match.index - 1] === "$" ? "${" : "{");
    else if (token === "(" || token === "[") open.push(token);
    else if (token === "}" || token === ")" || token === "]") open.pop();
    else if (
      open.at(-1) === "{" &&
      /[{,]\s*$/.test(text.slice(0, match.index)) &&
      /^\s*[:,}]/.test(text.slice(match.index + token.length))
    ) {
      keys.push(token);
    }
  }
  return keys;
}

function logFields(file: string, text: string): LogField[] {
  const code = blankComments(text);
  const literalsBlank = blankCommentsAndLiterals(text);
  const fields: LogField[] = [];
  for (const call of code.matchAll(LOG_CALL)) {
    const eventStart = call.index + call[0].length;
    const eventEnd = argumentEnd(literalsBlank, eventStart);
    if (literalsBlank[eventEnd] !== ",") continue;
    const fieldsStart = literalsBlank.slice(eventEnd + 1).search(/\S/) + eventEnd + 1;
    if (literalsBlank[fieldsStart] !== "{") continue;
    const literal = /^"([^"\\]*)"$/.exec(code.slice(eventStart, eventEnd).trim());
    const event = literal?.[1] ?? file;
    const body = literalsBlank.slice(fieldsStart, closingBrace(literalsBlank, fieldsStart) + 1);
    fields.push(...objectKeys(body).map((key) => ({ event, key })));
  }
  return fields;
}

function refusedLogFields(
  fields: readonly LogField[],
  harmless: ReadonlyMap<string, string>,
): string[] {
  const refused = fields
    .filter(
      ({ event, key }) =>
        isJudgedKey(key) && !PERSONAL_LOG_KEYS.has(key) && !harmless.has(`${event}.${key}`),
    )
    .map(({ event, key }) => `${event}.${key}`);
  return [...new Set(refused)];
}

function staleLogFields(
  fields: readonly LogField[],
  harmless: ReadonlyMap<string, string>,
): string[] {
  const judged = new Set(
    fields.filter(({ key }) => isJudgedKey(key)).map(({ event, key }) => `${event}.${key}`),
  );
  return [...harmless.keys()].filter((entry) => !judged.has(entry));
}

function treeSourceFiles(): string[] {
  return ["apps", "packages"]
    .flatMap((top) =>
      readdirSync(join(ROOT, top), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(ROOT, top, entry.name, "src")),
    )
    .filter((src) => existsSync(src))
    .flatMap(sourceFiles)
    .map((path) => relative(ROOT, path))
    .sort();
}

function registryFiles(): string[] {
  return treeSourceFiles().filter((file) =>
    readFileSync(join(ROOT, file), "utf8").includes("interface ErrorParams"),
  );
}

function registry(entries: string): string {
  return `declare module "@waitron/shared" {\n  interface ErrorParams {\n${entries}\n  }\n}\n`;
}

function typesIn(file: string, text: string): RegistryType[] {
  return registryTypeNames(text).map((name) => ({ file, name }));
}

function refusedIn(text: string): string[] {
  return refusedPairs(registryKeys(text), new Map());
}

describe("error-code details that name a person are masked in the log", () => {
  it("the real registries pass, and every harmless entry still names a judged detail", () => {
    const files = registryFiles();
    expect(files).toContain("packages/shared/src/errors.ts");
    expect(files).toContain("packages/payments-sumup/src/errors.ts");
    const keys = files.flatMap((file) => registryKeys(readFileSync(join(ROOT, file), "utf8")));
    expect(refusedPairs(keys, NOT_PERSONAL)).toEqual([]);
    expect(stalePairs(keys, NOT_PERSONAL)).toEqual([]);
  });

  it("refuses a guest's name", () => {
    expect(refusedIn(registry(`"guest.name_taken": { guestName: string };`))).toEqual([
      "guest.name_taken.guestName",
    ]);
  });

  it("judges an id key whose stem names a tax number", () => {
    expect(refusedIn(registry(`"x.w": { customerTaxId: string };`))).toEqual(["x.w.customerTaxId"]);
  });

  it("refuses a key ending By and a key naming a user", () => {
    expect(refusedIn(registry(`"x.b": { takenBy: string };`))).toEqual(["x.b.takenBy"]);
    expect(refusedIn(registry(`"x.u": { userName: string };`))).toEqual(["x.u.userName"]);
  });

  it("accepts an id, a listed key and a child of a listed path", () => {
    expect(
      refusedIn(
        registry(
          [
            `"x.y": { personId: string };`,
            `"x.z": { email: string };`,
            `"x.m": { merchants: { code: string; name: string }[] };`,
          ].join("\n"),
        ),
      ),
    ).toEqual([]);
    expect(registryKeys(registry(`"x.y": { personId: string };`))).toEqual([
      { code: "x.y", key: "personId", parent: undefined },
    ]);
  });

  it("reports a harmless entry whose code or key no longer exists", () => {
    const keys = registryKeys(registry(`"x.l": { label: string };`));
    const notPersonal = new Map([
      ["x.l.label", "the name of a thing"],
      ["x.gone.label", "the name of a thing"],
      ["x.l.gone", "the name of a thing"],
    ]);
    expect(refusedPairs(keys, notPersonal)).toEqual([]);
    expect(stalePairs(keys, notPersonal)).toEqual(["x.gone.label", "x.l.gone"]);
  });

  it("ends the registry at the interface's closing brace", () => {
    const text = `${registry(`"x.k": { tableId: string };`)}function f(guestName: string) { return { ownerEmail: guestName }; }\n`;
    expect(refusedIn(text)).toEqual([]);
    expect(registryKeys(text).map(({ key }) => key)).toEqual(["tableId"]);
  });

  it("bounds the path rule by its parent's braces", () => {
    expect(refusedIn(registry(`"x.n": { merchants: { code: string }[]; name: string };`))).toEqual([
      "x.n.name",
    ]);
  });

  it("ignores keys written in comments", () => {
    expect(
      refusedIn(registry(`"x.c": {\n  /** guestName: a comment */\n  tableId: string;\n};`)),
    ).toEqual([]);
  });
});

describe("named types in an error registry are reviewed", () => {
  it("the real registries name only reviewed types, and every reviewed type is still named", () => {
    const found = registryFiles().flatMap((file) =>
      typesIn(file, readFileSync(join(ROOT, file), "utf8")),
    );
    expect(found.map(({ name }) => name)).toContain("BillEditState");
    expect(unreviewedTypes(found, REVIEWED_TYPES)).toEqual([]);
    expect(staleTypes(found, REVIEWED_TYPES)).toEqual([]);
  });

  it("refuses a type nobody has reviewed, naming it and its file", () => {
    const found = typesIn("x/errors.ts", registry(`"x.v": { party: PartySummary };`));
    expect(unreviewedTypes(found, new Map())).toEqual(["PartySummary (x/errors.ts)"]);
  });

  it("reports a reviewed type no registry names", () => {
    const found = typesIn("x/errors.ts", registry(`"x.v": { party: PartySummary };`));
    const reviewed = new Map([
      ["PartySummary", "holds no person"],
      ["GoneType", "holds no person"],
    ]);
    expect(unreviewedTypes(found, reviewed)).toEqual([]);
    expect(staleTypes(found, reviewed)).toEqual(["GoneType"]);
  });

  it("reads no type name in a string literal or a comment", () => {
    const text = registry(`"x.o": { operacion: "Alta" | "Anulacion" /* see Foo */ };`);
    expect(unreviewedTypes(typesIn("x/errors.ts", text), new Map())).toEqual([]);
    expect(registryTypeNames(registry(`"x.p": { party: PartySummary };`))).toEqual([
      "PartySummary",
    ]);
  });
});

describe("log calls' fields that name a person are masked", () => {
  it("the real tree's log calls pass, and every harmless entry still names a judged field", () => {
    const fields = treeSourceFiles().flatMap((file) =>
      logFields(file, readFileSync(join(ROOT, file), "utf8")),
    );
    expect(fields).toContainEqual({ event: "staff_notice.duplicate_key", key: "owner" });
    expect(refusedLogFields(fields, HARMLESS_LOG_FIELDS)).toEqual([]);
    expect(staleLogFields(fields, HARMLESS_LOG_FIELDS)).toEqual([]);
  });

  it("refuses a person-named field, nested or not, in any call form", () => {
    const text = [
      `log("warn", "x.sent", { guestName });`,
      `log?.("info", "x.mailed", { meta: { recipientEmail: e } });`,
    ].join("\n");
    expect(refusedLogFields(logFields("x/mail.ts", text), new Map())).toEqual([
      "x.sent.guestName",
      "x.mailed.recipientEmail",
    ]);
  });

  it("accepts an id and a listed field", () => {
    const text = `log("info", "x", { personId });\nlog("info", "x", { email });`;
    const fields = logFields("x/mail.ts", text);
    expect(fields).toEqual([
      { event: "x", key: "personId" },
      { event: "x", key: "email" },
    ]);
    expect(refusedLogFields(fields, new Map())).toEqual([]);
  });

  it("keys a field of an event that is not a literal by the file's path", () => {
    const text = `log("warn", eventFor(code), { guestName: g });`;
    expect(refusedLogFields(logFields("x/mail.ts", text), new Map())).toEqual([
      "x/mail.ts.guestName",
    ]);
  });

  it("reports a harmless entry no log call uses", () => {
    const fields = logFields("x/mail.ts", `log("info", "x.h", { hostname: host });`);
    const harmless = new Map([
      ["x.h.hostname", "the box's own host name"],
      ["x.gone.hostname", "the box's own host name"],
    ]);
    expect(refusedLogFields(fields, harmless)).toEqual([]);
    expect(staleLogFields(fields, harmless)).toEqual(["x.gone.hostname"]);
  });
});
