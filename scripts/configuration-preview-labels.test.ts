/**
 * Every module that copies tables in a configuration export has English and Spanish words on
 * setup's "Review configuration" screen, and every module that marks a table for reconnection has
 * words for what to reconnect.
 *
 * Weaker than its name: it checks that each module has an entry in the screen's two label maps and
 * that the entry's text is not blank in either language — not that the words describe the
 * module's tables, nor that the screen draws from these maps; a module outside `ALL_MODULES` is
 * not checked.
 */
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { en, es } from "../apps/setup/src/i18n/strings.js";
import {
  PREVIEW_MODULE_LABELS,
  PREVIEW_RECONNECT_LABELS,
} from "../apps/setup/src/screens/configuration-preview-labels.js";

const catalogues: Record<string, Record<string, string>> = { en, es };
const transferring = ALL_MODULES.flatMap((module) =>
  module.configurationTransfer?.kind === "tables"
    ? [{ name: module.name, tables: module.configurationTransfer.tables }]
    : [],
);
const reconnecting = transferring.filter((module) =>
  module.tables.some((table) => table.reconnect === true),
);

describe.each(Object.keys(catalogues))("configuration preview words in %s", (language) => {
  const words = (labels: Record<string, string>, name: string) => {
    expect(Object.keys(labels)).toContain(name);
    return catalogues[language]![labels[name]!]?.trim();
  };

  it.each(transferring.map((module) => module.name))("names module %s", (name) => {
    expect(words(PREVIEW_MODULE_LABELS, name)).toBeTruthy();
  });

  it.each(reconnecting.map((module) => module.name))("names what %s reconnects", (name) => {
    expect(words(PREVIEW_RECONNECT_LABELS, name)).toBeTruthy();
  });
});

it("finds modules that transfer tables and one that reconnects hardware", () => {
  expect(transferring.map((module) => module.name)).toContain("core");
  expect(reconnecting.map((module) => module.name)).toContain("core");
});
