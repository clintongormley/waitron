/**
 * The guard judges field names by a word list. An allow-listed code and key applies at every
 * depth, and a named registry type is reviewed by name.
 *
 * It reads static keys in registry entries and inline log fields, and uses TypeScript to find
 * keys spread into inline log fields and direct AppError details. The scan uses a literal
 * level or a quoted dotted event to select calls with inline fields. Opaque forwarding
 * exceptions match the file, code or event expression, and spread expression.
 * Its limits are computed property names, whole objects passed by reference, AppError
 * subclasses, free text and the watchdog's direct writes to waitron.log.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { PERSONAL_LOG_KEYS } from "../apps/server/src/log-personal-data.js";

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
  [
    "CorrectionAdmission",
    "a regime's answer to whether an invoice may be corrected: a filing state, a reason, an invoice number and date; no person",
  ],
  ["DestinationCleanup", "an enum of clean-up requests: abort_upload or delete_object"],
  ["DestinationOperation", "an enum of archive file store requests"],
  ["Dining", "an enum of how an order is eaten: eat_in or takeaway"],
  ["EquipmentField", "an enum of a device's equipment field names"],
  ["Extract", "TypeScript's own; holds what its arguments name, which the guard reads"],
  [
    "FacturaParams",
    "an invoice as AEAT names it: idEmisorFactura, which is on the list, number and date",
  ],
  ["HomeDevice", "an enum: handheld or till"],
  ["JoinLimit", "an enum of which join limit was reached: address, network, listed or recent"],
  [
    "LineaParams",
    "inherits idEmisorFactura, on the list, from FacturaParams (packages/fiscal-verifactu/src/errors.ts:15); adds AEAT's reply codes and message",
  ],
  ["MemberRef", "a menu section member: a kind and a product or section id"],
  ["Operacion", "an enum of AEAT operations: Alta or Anulacion"],
  ["OrphanRemediation", "an enum of what a reconcile sweep did with an orphaned payment"],
  ["OvertakenEdition", "a menu edition: a version id, a number and an instant"],
  ["ProbeFailure", "an enum of bucket probe failures"],
  ["ProductUsingUnit", "a product's id, name and whether it is active; the name of a thing"],
  ["Readonly", "TypeScript's own; holds what its argument names, which the guard reads"],
  ["Record", "TypeScript's own; holds what its arguments name, which the guard reads"],
  ["ThemeNameRefusal", "an enum: empty, too_long or reserved"],
  ["ThemeRefusalReason", "an enum of why a theme document is refused"],
  ["UnservedBillDish", "a dish's line id, its name, quantity and whether the kitchen has it"],
  ["UnservedDish", "a dish's bill and line ids, its name, quantity and CancellationContext"],
  ["VerifyFailure", "an enum of why a membership document fails verification"],
]);

const HARMLESS_LOG_FIELDS: ReadonlyMap<string, string> = new Map([
  ["discovery.mounted.hostname", "the box's own host name"],
  ["mdns.responding.hostnames", "the box's own host names"],
  ["recovery.venue_held.holderKind", "an enum of which process holds the venue folder"],
  ["recovery.venue_holder_stalled.holderKind", "an enum of which process holds the venue folder"],
  [
    "restore.recovery_key_selected.name",
    "a server key's name: a date and a random code (packages/provisioning/src/server-key-name.ts)",
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
    "clock.corrected.byStaff",
    "true when a staff member confirmed; picks the alert's words and names no one",
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
  ["invoice_correction.split_changed.vatBreakdown", "VAT rates, bases and amounts of tax"],
  ["invoice_correction.split_changed.tax", "an amount of VAT, in euros"],
  ["menu_period.ended.periodName", "the name of a menu period"],
  ["menu_period.name_taken.name", "the name of a menu period"],
  ["menu_publication.time_past.activatesAt", "an instant"],
  ["migrations.set_missing.name", "the name of a migration set"],
  ["payment.provider_in_use.readerNames", "equipment labels from cardReaders.name, not people"],
  ["printer.bluetooth_not_discovered.address", "a Bluetooth address"],
  ["product.name_taken.name", "the name of a product"],
  ["product.offered_as_extra.name", "the name of an extras list"],
  ["product.on_live_menu.name", "the name of a product or a menu"],
  ["provisioning.key_generation_failed.byteLength", "a size in bytes"],
  ["restore.stream_venue_unconfirmed.venueName", "the name of the venue"],
  ["restore.unexpected_entry.name", "the name of an entry in a backup archive"],
  ["restore.unsafe_entry_path.name", "the name of an entry in a backup archive"],
  ["route.dish_not_sent.orderLabel", "an order's label, the name of a thing"],
  ["route.released_at_closed_station.orderLabel", "an order's label, the name of a thing"],
  ["service_zone.not_found.departmentName", "the name of a department"],
  ["service_zone.not_found.name", "the name of a category or product in an import"],
  ["service_zone.not_found.zoneName", "the name of a zone"],
  ["set_menu.holds_dishes.setMenuName", "the set menu's published name"],
  ["set_menu.holds_dishes.dishNames", "the stored dishes' product names"],
  ["set_menu.needed_by_draft.setMenuName", "the set menu's published name"],
  ["set_menu.needed_by_draft.dishNames", "the saved draft dishes' product names"],
  ["set_menu.not_selling.setMenuName", "the set menu's name"],
  ["set_menu.no_place.dishName", "the priced dish's product name"],
  ["set_menu.no_place_on_target.dishName", "the stored dish's product name"],
  ["set_menu.place_taken.dishName", "the stored dish's product name"],
  ["special_day.date_taken.name", "the name of a special day"],
  ["role.name_taken.name", "the name of an access role"],
  ["staff_role.name_taken.name", "the name of a staff role"],
  ["station.name_taken.name", "the name of a station"],
  ["station.thresholds_invalid.name", "the name of a station"],
  ["table.label_taken.label", "a saved table's label, the name of a thing"],
  ["table.label_taken.takenBy", "the name of the table holding the label"],
  ["table.short_name_taken.shortName", "a table's short name"],
  ["table.short_name_taken.takenBy", "the name of the table holding the short name"],
  ["vat_rate.table_invalid.vatClass", "a VAT class: general, reduced, super_reduced or zero"],
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
}

interface Scan {
  isRegistry: boolean;
  registryKeys: RegistryKey[];
  registryTypes: string[];
  unrecognisedEntries: string[];
  logFields: LogField[];
  needsTypes: boolean;
  unreadableSpreads: string[];
}

type Source = string | Scan;

const PERSON_WORDS =
  /email|mail|name|nombre|surname|apellido|phone|tel|mobile|tax|nif|nie|dni|cif|vat|emisor|recipient|destinatario|person|guest|owner|holder|editor|contact|address|label|who|user|staff|operator|waiter|customer|client/i;
const TAX_STEM = /tax|nif|nie|dni|cif|vat/i;
const ID_ENDING = /^(.*?)(?:Id|Ids)$/;
const DOTTED_NAME = /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/;
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

const OPAQUE_FORWARDERS = [
  {
    file: "apps/server/src/box-host-api.ts",
    code: "err.code",
    params: "err.params",
    reason: "The box-host refusal forwards the registered details for the same error code.",
  },
  {
    file: "packages/fiscal-verifactu/src/filing-overview-routes.ts",
    code: '"fiscal.filing_day_unread"',
    params: "error.params",
    reason: "The filing overview forwards details from its selected AppError codes.",
  },
  {
    file: "packages/server-kit/src/error-boundary.ts",
    code: "cause.code",
    params: "cause.params",
    reason: "The error boundary forwards the registered details for the same error code.",
  },
  {
    file: "packages/venue-service/src/season-weeks.ts",
    code: "error.code",
    params: "error.params",
    reason: "The rethrow forwards the registered details and prefixes the field path.",
  },
];

function isJudgedKey(key: string): boolean {
  const id = ID_ENDING.exec(key);
  if (id !== null && !TAX_STEM.test(id[1] ?? "")) return false;
  return PERSON_WORDS.test(key) || key.endsWith("By");
}

function scanSource(source: ts.SourceFile, file: string, checker?: ts.TypeChecker): Scan {
  const result: Scan = {
    isRegistry: false,
    registryKeys: [],
    registryTypes: [],
    unrecognisedEntries: [],
    logFields: [],
    needsTypes: false,
    unreadableSpreads: [],
  };

  function readRegistry(registry: ts.InterfaceDeclaration): void {
    result.isRegistry = true;
    for (const entry of registry.members) {
      if (
        !ts.isPropertySignature(entry) ||
        !ts.isStringLiteral(entry.name) ||
        !DOTTED_NAME.test(entry.name.text)
      ) {
        result.unrecognisedEntries.push(
          entry.getText(source).replace(/[;,]$/, "").replace(/\s+/g, " "),
        );
        continue;
      }
      const code = entry.name.text;
      function visitType(node: ts.Node): void {
        if (ts.isPropertySignature(node)) {
          const key = staticKey(node.name);
          if (key !== undefined) result.registryKeys.push({ code, key });
        }
        if (ts.isTypeReferenceNode(node)) result.registryTypes.push(node.typeName.getText(source));
        if (ts.isTypeQueryNode(node)) result.registryTypes.push(node.exprName.getText(source));
        if (ts.isImportTypeNode(node) && node.qualifier !== undefined) {
          result.registryTypes.push(node.qualifier.getText(source));
        }
        ts.forEachChild(node, visitType);
      }
      if (entry.type !== undefined) visitType(entry.type);
    }
  }

  function readObject(
    object: ts.ObjectLiteralExpression,
    codeOrEvent: ts.Expression | undefined,
    addKey: (name: string, key: string) => void,
    includeDirectFields: boolean,
  ): void {
    const name = stringValue(codeOrEvent) ?? file;
    function visitField(node: ts.Node): void {
      if (ts.isSpreadAssignment(node)) {
        result.needsTypes = true;
        if (checker !== undefined) {
          const type = checker.getTypeAtLocation(node.expression);
          const keys = spreadKeys(checker, type);
          if (keys === undefined) {
            const code = codeOrEvent?.getText(source);
            const params = node.expression.getText(source);
            if (
              OPAQUE_FORWARDERS.some(
                (allowed) =>
                  allowed.file === file && allowed.code === code && allowed.params === params,
              )
            )
              return;

            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            result.unreadableSpreads.push(
              `${name} (${file}:${line}): ${checker.typeToString(type)}`,
            );
          } else {
            for (const key of keys) addKey(name, key);
          }
        }
        return;
      }
      if (
        includeDirectFields &&
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
      ) {
        const key = staticKey(node.name);
        if (key !== undefined) addKey(name, key);
      }
      ts.forEachChild(node, visitField);
    }
    ts.forEachChild(object, visitField);
  }

  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "ErrorParams") readRegistry(node);

    if (ts.isCallExpression(node)) {
      const [level, event, fields] = node.arguments;
      const eventName = stringValue(event);
      if (
        fields !== undefined &&
        ts.isObjectLiteralExpression(fields) &&
        (LOG_LEVELS.has(stringValue(level) ?? "") || DOTTED_NAME.test(eventName ?? ""))
      ) {
        readObject(fields, event, (name, key) => result.logFields.push({ event: name, key }), true);
      }
    }

    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "AppError"
    ) {
      const [code, details] = node.arguments ?? [];
      if (details !== undefined && ts.isObjectLiteralExpression(details)) {
        readObject(
          details,
          code,
          (name, key) => result.registryKeys.push({ code: name, key }),
          false,
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return result;
}

function stringValue(node: ts.Node | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteral(node) ? node.text : undefined;
}

function staticKey(node: ts.PropertyName): string | undefined {
  return ts.isIdentifier(node) ? node.text : stringValue(node);
}

function spreadKeys(checker: ts.TypeChecker, type: ts.Type): string[] | undefined {
  if (type.isUnion()) {
    const keys = new Set<string>();
    for (const member of type.types) {
      const memberKeys = spreadKeys(checker, member);
      if (memberKeys === undefined) return undefined;
      for (const key of memberKeys) keys.add(key);
    }
    return [...keys];
  }
  if ((type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0) return [];
  if (
    ((type.flags & ts.TypeFlags.Object) === 0 && !type.isIntersection()) ||
    checker.getIndexInfosOfType(type).length > 0
  ) {
    return undefined;
  }
  return checker.getPropertiesOfType(type).map((property) => property.getName());
}

function spreadProgram(files: string[], text?: string): ts.Program {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  if (text !== undefined) {
    const getSourceFile = host.getSourceFile;
    host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
      file === files[0]
        ? ts.createSourceFile(file, text, languageVersion)
        : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
  }
  return ts.createProgram(files, options, host);
}

function scanText(file: string, text: string): Scan {
  return scanSource(ts.createSourceFile(join(ROOT, file), text, ts.ScriptTarget.Latest), file);
}

function scanFixture(file: string, source: Source): Scan {
  if (typeof source !== "string") return source;
  const scan = scanText(file, source);
  if (!scan.needsTypes) return scan;

  const path = join(ROOT, file);
  const program = spreadProgram([path], source);
  return scanSource(program.getSourceFile(path)!, file, program.getTypeChecker());
}

function unrecognisedEntries(source: Source): string[] {
  return scanFixture("errors.ts", source).unrecognisedEntries;
}

function registryTypeNames(source: Source): string[] {
  return [...new Set(scanFixture("errors.ts", source).registryTypes)];
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

function typeNames(found: readonly RegistryType[]): string[] {
  return found.map(({ name }) => name);
}

function staleEntries(used: Iterable<string>, allowed: ReadonlyMap<string, string>): string[] {
  const inUse = new Set(used);
  return [...allowed.keys()].filter((entry) => !inUse.has(entry));
}

function registryKeys(source: Source): RegistryKey[] {
  return scanFixture("errors.ts", source).registryKeys;
}

function judgedPairs(keys: readonly RegistryKey[]): RegistryKey[] {
  return keys.filter(({ key }) => isJudgedKey(key));
}

function judgedPairNames(keys: readonly RegistryKey[]): string[] {
  return judgedPairs(keys).map(({ code, key }) => `${code}.${key}`);
}

function refusedPairs(
  keys: readonly RegistryKey[],
  notPersonal: ReadonlyMap<string, string>,
): string[] {
  const refused = judgedPairs(keys)
    .filter(
      (pair) => !PERSONAL_LOG_KEYS.has(pair.key) && !notPersonal.has(`${pair.code}.${pair.key}`),
    )
    .map(({ code, key }) => `${code}.${key}`);
  return [...new Set(refused)];
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

function logFields(file: string, source: Source): LogField[] {
  return scanFixture(file, source).logFields;
}

function refusedLogFields(
  fields: readonly LogField[],
  harmless: ReadonlyMap<string, string>,
): string[] {
  const refused = fields
    .filter(
      (field) =>
        isJudgedKey(field.key) &&
        !PERSONAL_LOG_KEYS.has(field.key) &&
        !harmless.has(`${field.event}.${field.key}`),
    )
    .map(({ event, key }) => `${event}.${key}`);
  return [...new Set(refused)];
}

function judgedLogFieldNames(fields: readonly LogField[]): string[] {
  return fields.filter(({ key }) => isJudgedKey(key)).map(({ event, key }) => `${event}.${key}`);
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

interface TreeSource extends Scan {
  file: string;
}

let tree: readonly TreeSource[] | undefined;

function treeSources(): readonly TreeSource[] {
  if (tree !== undefined) return tree;
  const scans = treeSourceFiles().map((file) => ({
    file,
    ...scanText(file, readFileSync(join(ROOT, file), "utf8")),
  }));
  const candidates = scans.filter(({ needsTypes }) => needsTypes);
  if (candidates.length > 0) {
    const program = spreadProgram(candidates.map(({ file }) => join(ROOT, file)));
    const checker = program.getTypeChecker();
    for (const candidate of candidates) {
      const source = program.getSourceFile(join(ROOT, candidate.file))!;
      Object.assign(candidate, scanSource(source, candidate.file, checker));
    }
  }
  tree = scans;
  return tree;
}

function registrySources(): readonly TreeSource[] {
  return treeSources().filter(({ isRegistry }) => isRegistry);
}

function registry(entries: string): string {
  return `declare module "@waitron/shared" {\n  interface ErrorParams {\n${entries}\n  }\n}\n`;
}

function typesIn(file: string, source: Source): RegistryType[] {
  return registryTypeNames(source).map((name) => ({ file, name }));
}

function refusedIn(text: string): string[] {
  return refusedPairs(registryKeys(text), new Map());
}

describe("error-code details that name a person are masked in the log", () => {
  it("the real registries pass, and every harmless entry still names a judged detail", () => {
    const sources = registrySources();
    const files = sources.map(({ file }) => file);
    expect(files).toContain("packages/shared/src/errors.ts");
    expect(files).toContain("packages/payments-sumup/src/errors.ts");
    const keys = treeSources().flatMap(registryKeys);
    expect(refusedPairs(keys, NOT_PERSONAL)).toEqual([]);
    expect(
      treeSources().flatMap(({ unreadableSpreads }) => unreadableSpreads),
      "Unreadable spreads",
    ).toEqual([]);
    expect(staleEntries(judgedPairNames(keys), NOT_PERSONAL)).toEqual([]);
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

  it("accepts an id and a listed key", () => {
    expect(
      refusedIn(
        registry(
          [
            `"x.y": { personId: string };`,
            `"x.z": { email: string };`,
            `"x.m": { merchants: { code: string; merchantName: string }[] };`,
          ].join("\n"),
        ),
      ),
    ).toEqual([]);
    expect(registryKeys(registry(`"x.y": { personId: string };`))).toEqual([
      { code: "x.y", key: "personId" },
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
    expect(staleEntries(judgedPairNames(keys), notPersonal)).toEqual(["x.gone.label", "x.l.gone"]);
  });

  it("ends the registry at the interface's closing brace", () => {
    const text = `${registry(`"x.k": { tableId: string };`)}function f(guestName: string) { return { ownerEmail: guestName }; }\n`;
    expect(refusedIn(text)).toEqual([]);
    expect(registryKeys(text).map(({ key }) => key)).toEqual(["tableId"]);
  });

  it("refuses a merchant's bare name inside a list", () => {
    expect(refusedIn(registry(`"x.n": { merchants: { code: string; name: string }[] };`))).toEqual([
      "x.n.name",
    ]);
  });

  it("refuses a registry entry that is not a recognised code mark", () => {
    const keys = registrySources().flatMap((source) => unrecognisedEntries(source));
    expect(keys).toEqual([]);
    expect(
      unrecognisedEntries(
        registry(`[X_CODE]: { guestName: string };\n"x.a": { tableId: string };`),
      ),
    ).toEqual(["[X_CODE]: { guestName: string }"]);
    expect(
      unrecognisedEntries(
        registry(
          [
            `"x.a": { tableId: string };`,
            `[X_CODE]: { guestName: string };`,
            `"x.Bad": { ownerEmail: string };`,
          ].join("\n"),
        ),
      ),
    ).toEqual(["[X_CODE]: { guestName: string }", `"x.Bad": { ownerEmail: string }`]);
  });

  it("refuses quoted detail and log keys", () => {
    expect(refusedIn(registry(`"x.quoted": { "guestName": string };`))).toEqual([
      "x.quoted.guestName",
    ]);
    const fields = logFields("x/quoted.ts", `log("warn", "x.logged", { "guestName": guest });`);
    expect(refusedLogFields(fields, new Map())).toEqual(["x.logged.guestName"]);
  });

  it("reads typed spread keys in details and logs and reports unreadable spreads", () => {
    const declaration = `declare const guest: { ownerEmail: string };`;
    expect(refusedIn(`${declaration} new AppError("x.detail", { ...guest });`)).toEqual([
      "x.detail.ownerEmail",
    ]);
    const fields = logFields(
      "x/spread.ts",
      `${declaration} log("warn", "x.logged", { ...guest });`,
    );
    expect(refusedLogFields(fields, new Map())).toEqual(["x.logged.ownerEmail"]);

    const opaque = `declare const guest: Record<string, unknown>;
      log("warn", "x.unreadable", { ...guest });`;
    expect(scanFixture("x/spread.ts", opaque).unreadableSpreads).toEqual([
      "x.unreadable (x/spread.ts:2): Record<string, unknown>",
    ]);

    const restore = treeSources().find(({ file }) => file === "apps/server/src/restore-stream.ts");
    expect(restore).toBeDefined();
    if (restore === undefined) return;
    const restoreKeys = registryKeys(restore)
      .filter(({ code }) => code === "restore.stream_venue_unconfirmed")
      .map(({ key }) => key)
      .sort();
    expect(restoreKeys).toEqual(["legalName", "taxId", "venueName"]);
  });

  it("reads every enumerable spread alternative and reports a union with opaque keys", () => {
    const scan = scanFixture(
      "x/union.ts",
      `declare const guest: { guestName: string } | { ownerEmail: string } | null | undefined;
      declare const maybeGuest: { guestName: string } | Record<string, unknown>;
      log("warn", "x.variants", { ...guest });
      log("warn", "x.opaque", { ...maybeGuest });`,
    );
    expect(refusedLogFields(scan.logFields, new Map()).sort()).toEqual([
      "x.variants.guestName",
      "x.variants.ownerEmail",
    ]);
    expect(scan.unreadableSpreads.map((finding) => finding.split(": ")[0])).toEqual([
      "x.opaque (x/union.ts:4)",
    ]);
  });

  it("allows opaque forwarding at the recorded file, event and spread expression", () => {
    const scan = scanFixture(
      "apps/server/src/box-host-api.ts",
      `declare const err: { code: string; params: Record<string, unknown> };
      declare const other: typeof err;
      log("warn", err.code, { ...err.params });
      log("warn", other.code, { ...err.params });
      log("warn", err.code, { ...other.params });`,
    );
    expect(scan.unreadableSpreads.map((finding) => finding.split(": ")[0])).toEqual([
      "apps/server/src/box-host-api.ts (apps/server/src/box-host-api.ts:4)",
      "apps/server/src/box-host-api.ts (apps/server/src/box-host-api.ts:5)",
    ]);
  });

  it("reports opaque forwarding in a new file", () => {
    const scan = scanFixture(
      "x/new-forwarder.ts",
      `declare const err: { code: string; params: Record<string, unknown> };
      log("warn", err.code, { ...err.params });`,
    );
    expect(scan.unreadableSpreads).toEqual([
      "x/new-forwarder.ts (x/new-forwarder.ts:2): Record<string, unknown>",
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
    const found = registrySources().flatMap((source) => typesIn(source.file, source));
    expect(found.map(({ name }) => name)).toContain("BillEditState");
    expect(unreviewedTypes(found, REVIEWED_TYPES)).toEqual([]);
    expect(staleEntries(typeNames(found), REVIEWED_TYPES)).toEqual([]);
  });

  it("refuses a type nobody has reviewed, naming it and its file", () => {
    const found = typesIn("x/errors.ts", registry(`"x.v": { party: PartySummary };`));
    expect(unreviewedTypes(found, new Map())).toEqual(["PartySummary (x/errors.ts)"]);
  });

  it("refuses an inline import type nobody has reviewed", () => {
    const found = typesIn(
      "x/errors.ts",
      registry(`"x.i": { venue: import("./venue.js").RestoredVenue };`),
    );
    expect(unreviewedTypes(found, new Map())).toEqual(["RestoredVenue (x/errors.ts)"]);
  });

  it("refuses lowercase aliases and type queries in a registry", () => {
    const found = typesIn(
      "x/errors.ts",
      registry(`"x.types": { party: partySummary; people: (typeof personFields)[number] };`),
    );
    expect(unreviewedTypes(found, new Map())).toEqual([
      "partySummary (x/errors.ts)",
      "personFields (x/errors.ts)",
    ]);
  });

  it("reports a reviewed type no registry names", () => {
    const found = typesIn("x/errors.ts", registry(`"x.v": { party: PartySummary };`));
    const reviewed = new Map([
      ["PartySummary", "holds no person"],
      ["GoneType", "holds no person"],
    ]);
    expect(unreviewedTypes(found, reviewed)).toEqual([]);
    expect(staleEntries(typeNames(found), reviewed)).toEqual(["GoneType"]);
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
    const fields = treeSources().flatMap((source) => logFields(source.file, source));
    expect(fields).toContainEqual({ event: "staff_notice.duplicate_key", key: "owner" });
    expect(refusedLogFields(fields, HARMLESS_LOG_FIELDS)).toEqual([]);
    expect(staleEntries(judgedLogFieldNames(fields), HARMLESS_LOG_FIELDS)).toEqual([]);
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

  it("refuses a merchant's bare name inside a list, and accepts its merchantName", () => {
    const text = [
      `log("warn", "x.n", { merchants: [{ code: c, name: n }] });`,
      `log("warn", "x.m", { merchants: [{ code: c, merchantName: n }] });`,
    ].join("\n");
    const fields = logFields("x/merchants.ts", text);
    expect(fields).toContainEqual({ event: "x.m", key: "merchantName" });
    expect(refusedLogFields(fields, new Map())).toEqual(["x.n.name"]);
  });

  it("keys a field of an event that is not a literal by the file's path", () => {
    const text = `log("warn", eventFor(code), { guestName: g });`;
    expect(refusedLogFields(logFields("x/mail.ts", text), new Map())).toEqual([
      "x/mail.ts.guestName",
    ]);
  });

  it("reads log fields with a conditional or variable level and a dotted event", () => {
    const text = [
      `log(ready ? "info" : "warn", "x.conditional", { guestName });`,
      `log(level, "x.variable", { guestName });`,
      `format(level, "undotted", { guestName });`,
    ].join("\n");
    expect(refusedLogFields(logFields("x/mail.ts", text), new Map())).toEqual([
      "x.conditional.guestName",
      "x.variable.guestName",
    ]);
  });

  it("reports a harmless entry no log call uses", () => {
    const fields = logFields("x/mail.ts", `log("info", "x.h", { hostname: host });`);
    const harmless = new Map([
      ["x.h.hostname", "the box's own host name"],
      ["x.gone.hostname", "the box's own host name"],
    ]);
    expect(refusedLogFields(fields, harmless)).toEqual([]);
    expect(staleEntries(judgedLogFieldNames(fields), harmless)).toEqual(["x.gone.hostname"]);
  });
});
