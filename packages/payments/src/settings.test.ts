import { CORE_MIGRATIONS, saveSettings, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { expect, it } from "vitest";
import * as payments from "./index.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("defaults providers to On and keeps both switches off before the first save", async () => {
  expect(payments.PAYMENTS_SETTINGS).toBeDefined();
  expect(await payments.readPaymentsSettings(suite.db)).toEqual({
    doc: { providers: {}, tipsEnabled: false, testProviders: false },
    revision: 0,
  });
  expect(payments.PAYMENTS_SETTINGS.parse({ providers: { stripe: false, sumup: true } })).toEqual({
    ok: true,
    doc: { providers: { stripe: false, sumup: true }, tipsEnabled: false, testProviders: false },
  });
});
it.each(
  [
    null,
    [],
    {},
    { providers: null },
    { providers: [] },
    { providers: { stripe: "false" } },
    { providers: {}, extra: true },
  ].map((value) => [value]),
)("refuses malformed provider settings %j", (value) => {
  expect(payments.PAYMENTS_SETTINGS).toBeDefined();
  expect(payments.PAYMENTS_SETTINGS.parse(value).ok).toBe(false);
});

it("saves both switches with the explicit provider choice", async () => {
  await withTransaction(suite.db, (tx) =>
    saveSettings(tx, payments.PAYMENTS_SETTINGS, {
      doc: { providers: { stripe: false }, tipsEnabled: true, testProviders: true },
      expectedRevision: 0,
      personId: null,
    }),
  );
  expect(await payments.readPaymentsSettings(suite.db)).toEqual({
    doc: { providers: { stripe: false }, tipsEnabled: true, testProviders: true },
    revision: 1,
  });
});

it.each([
  ["tipsEnabled", "yes"],
  ["testProviders", null],
])("names a malformed %s switch", (field, value) => {
  expect(payments.PAYMENTS_SETTINGS.parse({ providers: {}, [field]: value })).toEqual({
    ok: false,
    field,
  });
});
