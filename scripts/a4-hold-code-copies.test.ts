/**
 * The dashboard may not import `@waitron/db` (`scripts/dashboard-browser-purity.test.ts`), and the
 * till does not depend on it (`apps/till/package.json`), so an app that names the A4 hold codes
 * keeps its own copy. This pins each copy listed in `COPIES` to `a4HoldCodes`. The dashboard's type
 * union and the till's list are read as TEXT: the guard sees the literals in the named declaration,
 * not what the app does with a code.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALERT_WORDS } from "../apps/dashboard/src/i18n/alert-messages.js";
import { en as tillEn, es as tillEs } from "../apps/till/src/i18n/strings.js";
import { a4HoldCodes } from "../packages/db/src/schema/invoice-deliveries.js";

const REPO_ROOT = resolve(import.meta.dirname, "..");

/** The string literals of a union-typed `hold?:` member, up to the `;` that ends it. */
function holdUnionCodes(file: string, owner: string): string[] {
  const source = readFileSync(resolve(REPO_ROOT, file), "utf8");
  const start = source.indexOf(`export interface ${owner} {`);
  if (start === -1) throw new Error(`${owner} not found in ${file}`);
  const member = /\n\s*hold\?:([^;]*);/.exec(source.slice(start));
  if (member === null) throw new Error(`${owner}.hold not found in ${file}`);
  return [...member[1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

/** The string literals of `export const <name> = [ ... ] as const;`. */
function constArrayCodes(file: string, name: string): string[] {
  const source = readFileSync(resolve(REPO_ROOT, file), "utf8");
  const list = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const;`).exec(source);
  if (list === null) throw new Error(`${name} not found in ${file}`);
  return [...list[1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

/** The codes a till catalogue words, read from its `invoice.delivery_hold_<code>` keys. */
function tillHoldWords(catalogue: Record<string, string>): string[] {
  const prefix = "invoice.delivery_hold_";
  return Object.keys(catalogue)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
}

const COPIES = [
  {
    name: "the dashboard's PageTestPage hold union",
    codes: () => holdUnionCodes("apps/dashboard/src/api/client.ts", "PageTestPage"),
  },
  {
    name: "the dashboard alerts' printer_hold words",
    codes: () => Object.keys(ALERT_WORDS["printer_hold"]!.words),
  },
  {
    name: "the till's a4HoldCodes list",
    codes: () => constArrayCodes("apps/till/src/api/client.ts", "a4HoldCodes"),
  },
  { name: "the till's English hold words", codes: () => tillHoldWords(tillEn) },
  { name: "the till's Spanish hold words", codes: () => tillHoldWords(tillEs) },
];

describe("every app's copy of the A4 hold codes matches a4HoldCodes", () => {
  it.each(COPIES)("$name names exactly the codes in a4HoldCodes", ({ codes }) => {
    expect([...codes()].sort()).toEqual([...a4HoldCodes].sort());
  });
});
