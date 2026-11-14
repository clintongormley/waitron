import { expect, it } from "vitest";
import { CORE_MIGRATIONS, readSettings } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import * as provisioning from "@waitron/provisioning";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("defaults the non-transferring mail document to no sender", async () => {
  expect(provisioning).toHaveProperty("MAIL_SETTINGS");
  const { MAIL_SETTINGS } = provisioning;
  expect(await readSettings(suite.db, MAIL_SETTINGS)).toEqual({ doc: { from: null }, revision: 0 });
  expect(MAIL_SETTINGS.transfers).toBe(false);
});

it.each([null, [], {}, { from: 3 }, { from: false }])(
  "refuses an invalid mail sender document: %j",
  (doc) => {
    expect(provisioning).toHaveProperty("MAIL_SETTINGS");
    expect(provisioning.MAIL_SETTINGS.parse(doc)).toEqual({ ok: false, field: "from" });
  },
);

it.each([null, "", "Bar <bar@example.test>"])(
  "keeps a sender without validating its address: %j",
  (from) => {
    expect(provisioning).toHaveProperty("MAIL_SETTINGS");
    expect(provisioning.MAIL_SETTINGS.parse({ from })).toEqual({ ok: true, doc: { from } });
  },
);
