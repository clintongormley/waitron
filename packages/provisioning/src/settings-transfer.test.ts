import { configurationBundle } from "../test/configuration-bundle.js";
import { validateConfigurationBundle } from "./configuration-transfer.js";
import { expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { CORE_MIGRATIONS, readSettings, saveSettings, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import {
  checkImportedSettings,
  exportSettingsDocuments,
  importSettingsDocuments,
  transferredDocuments,
} from "./settings-transfer.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const adjustments = ALL_MODULES.find((m) => m.name === "adjustments")!;
const definition = adjustments.settings![0]!;
const doc = { maxBillComp: 4000 };
const entries = { adjustments: { version: 1, doc } };
const save = (value: object = doc) =>
  withTransaction(suite.db, async (tx) =>
    saveSettings(tx, definition, {
      doc: value,
      expectedRevision: (await readSettings(tx, definition)).revision,
      personId: null,
    }),
  );
const imported = (value = entries) =>
  withTransaction(suite.db, (tx) => importSettingsDocuments(tx, value, ALL_MODULES));

it("exports each saved transferring document at the code's version", async () => {
  await save();
  expect(await exportSettingsDocuments(suite.db, ALL_MODULES)).toEqual(entries);
});
it("exports nothing for a document never saved", async () => {
  expect(await exportSettingsDocuments(suite.db, ALL_MODULES)).toEqual({});
});
it("leaves out a document that does not transfer", async () => {
  await save();
  const modules = [{ ...adjustments, settings: [{ ...definition, transfers: false }] }];
  expect(transferredDocuments(modules)).toEqual([]);
  expect(await exportSettingsDocuments(suite.db, modules)).toEqual({});
  await withTransaction(suite.db, (tx) => importSettingsDocuments(tx, {}, modules));
  expect(await readSettings(suite.db, definition)).toEqual({ doc, revision: 1 });
});
it.each([
  [{ nope: { version: 1, doc } }, "setup.request_invalid", { field: "settings" }],
  [{ adjustments: { version: 2, doc } }, "setup.configuration_newer", {}],
  [{ adjustments: { version: 0, doc } }, "setup.configuration_outdated", {}],
])("refuses an unknown key or another version before writing: %j", async (value, code, params) => {
  await save();
  expect(() => checkImportedSettings(value, ALL_MODULES)).toThrow(
    expect.objectContaining({ code, params }),
  );
  await withTransaction(suite.db, async (tx) => {
    await expect(importSettingsDocuments(tx, value, ALL_MODULES)).rejects.toMatchObject({
      code,
      params,
    });
    expect(await readSettings(tx, definition)).toEqual({ doc, revision: 1 });
  });
  expect(await readSettings(suite.db, definition)).toEqual({ doc, revision: 1 });
});
it.each([["owner"], ["manager", "manager"], [], "manager", undefined].map((value) => [value]))(
  "refuses bad approvers before writing: %j",
  async (billApproverRoles) => {
    await save();
    const value = { adjustments: { version: 1, doc: { ...doc, billApproverRoles } } };
    await withTransaction(suite.db, async (tx) => {
      await expect(importSettingsDocuments(tx, value, ALL_MODULES)).rejects.toMatchObject({
        code: "setup.request_invalid",
        params: { field: "settings.adjustments.billApproverRoles" },
      });
      expect(await readSettings(tx, definition)).toEqual({ doc, revision: 1 });
    });
    expect(await readSettings(suite.db, definition)).toEqual({ doc, revision: 1 });
  },
);
it("imports by replacing the transferring rows, revision 1, no saver", async () => {
  await save({ ...doc, maxBillComp: 1000 });
  await save({ ...doc, maxBillComp: 2000 });
  await imported();
  expect(await readSettings(suite.db, definition)).toEqual({ doc, revision: 1 });
  expect(
    suite.db.execute(sql`select updated_by from settings where module = 'adjustments'`).rows,
  ).toEqual([{ updated_by: null }]);
});
it("an export with no adjustments key resets the target to the defaults", async () => {
  await save();
  await withTransaction(suite.db, (tx) => importSettingsDocuments(tx, {}, ALL_MODULES));
  expect(await readSettings(suite.db, definition)).toEqual({
    doc: { maxBillComp: null },
    revision: 0,
  });
});

it("validates documents before the configuration is staged", () => {
  const bundle = {
    ...configurationBundle(),
    settings: { adjustments: { version: 1, doc: { ...doc, maxBillComp: -1 } } },
  };
  expect(() => validateConfigurationBundle(bundle, [adjustments], {})).toThrow(
    expect.objectContaining({
      code: "setup.request_invalid",
      params: { field: "settings.adjustments.maxBillComp" },
    }),
  );
});
it("keeps the module mismatch refusal ahead of document checking", () => {
  const bundle = {
    ...configurationBundle(),
    modules: { absent: 1 },
    settings: { absent: { version: 1, doc: {} } },
  };
  expect(() => validateConfigurationBundle(bundle, [], {})).toThrow(
    expect.objectContaining({
      code: "setup.configuration_parts_differ",
      params: { exportOnly: ["absent"], serverOnly: [] },
    }),
  );
});
