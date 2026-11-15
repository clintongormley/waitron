import { expect, it } from "vitest";
import { readSettings } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { BACKUP_SETTINGS } from "./backup-settings-document.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("defaults backup choices to empty parts without transferring this box's destinations", async () => {
  expect(await readSettings(suite.db, BACKUP_SETTINGS)).toEqual({
    doc: { archive: null, stream: null },
    revision: 0,
  });
  expect(BACKUP_SETTINGS.transfers).toBe(false);
});

it.each([
  [null, "archive"],
  [[], "archive"],
  [3, "archive"],
  [{ archive: 3, stream: null }, "archive"],
  [{ archive: null, stream: false }, "stream"],
  [{ archive: null, stream: null, x: 1 }, "x"],
])("refuses a malformed outer backup document: %j", (doc, field) => {
  expect(BACKUP_SETTINGS.parse(doc)).toEqual({ ok: false, field });
});

it("leaves the stored parts' checks to their readers", () => {
  expect(BACKUP_SETTINGS.parse({ archive: {}, stream: {} })).toEqual({
    ok: true,
    doc: { archive: {}, stream: {} },
  });
});
