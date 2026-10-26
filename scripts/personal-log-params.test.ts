/**
 * An error code's detail whose name looks like a person's is masked in the log
 * (`apps/server/src/log-personal-data.ts`), or named harmless here with a reason.
 *
 * Weaker than its name: it reads TEXT; it judges a key by a word list, so a key whose name says
 * nothing about a person passes; it judges only keys written in a registry's text, so a throw site
 * that spreads an object can carry keys its registry type does not name (`{ ...prepared.venue }`,
 * `apps/server/src/restore-request.ts:280` and `apps/server/src/restore-stream.ts:378`: if
 * `RestoredVenue`, `apps/server/src/restore-stream.ts:41-45`, gained an `ownerEmail`, the answer and
 * the log line would carry it and this guard would stay green); and it never reads free text.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { PERSONAL_LOG_KEYS, PERSONAL_LOG_PATHS } from "../apps/server/src/log-personal-data.js";
import { blankComments, blankCommentsAndLiterals } from "../packages/shared/src/source-comments.js";

const ROOT = join(import.meta.dirname, "..");

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

function registryKeys(text: string): RegistryKey[] {
  const code = blankComments(text);
  const literalsBlank = blankCommentsAndLiterals(text);
  const keys: RegistryKey[] = [];
  for (const opening of code.matchAll(REGISTRY_OPENING)) {
    const bodyStart = opening.index + opening[0].length - 1;
    const bodyEnd = closingBrace(literalsBlank, bodyStart);
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

function registryFiles(): string[] {
  return ["apps", "packages"]
    .flatMap((top) =>
      readdirSync(join(ROOT, top), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(ROOT, top, entry.name, "src")),
    )
    .filter((src) => existsSync(src))
    .flatMap(sourceFiles)
    .filter((path) => readFileSync(path, "utf8").includes("interface ErrorParams"))
    .map((path) => relative(ROOT, path))
    .sort();
}

function registry(entries: string): string {
  return `declare module "@waitron/shared" {\n  interface ErrorParams {\n${entries}\n  }\n}\n`;
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
