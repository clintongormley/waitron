import { CORE_MIGRATIONS, saveSettings, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { expect, it } from "vitest";
import * as payments from "./index.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("defaults providers to On and keeps both switches off before the first save", async () => {
  expect(payments.PAYMENTS_SETTINGS).toBeDefined();
  expect(await payments.readPaymentsSettings(suite.db)).toEqual({
    doc: { providers: {}, tipsEnabled: false, testProviders: false, otherCardMachines: [] },
    revision: 0,
  });
  expect(payments.PAYMENTS_SETTINGS.parse({ providers: { stripe: false, sumup: true } })).toEqual({
    ok: true,
    doc: {
      providers: { stripe: false, sumup: true },
      tipsEnabled: false,
      testProviders: false,
      otherCardMachines: [],
    },
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
      doc: {
        providers: { stripe: false },
        tipsEnabled: true,
        testProviders: true,
        otherCardMachines: [{ id: "m1", name: "Bar terminal", paysInto: "other" }],
      },
      expectedRevision: 0,
      personId: null,
    }),
  );
  expect(await payments.readPaymentsSettings(suite.db)).toEqual({
    doc: {
      providers: { stripe: false },
      tipsEnabled: true,
      testProviders: true,
      otherCardMachines: [{ id: "m1", name: "Bar terminal", paysInto: "other" }],
    },
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

it("transfers the tips switch and the other card machines", () => {
  expect(payments.PAYMENTS_SETTINGS.transfers).toEqual(["tipsEnabled", "otherCardMachines"]);
});

it("keeps a valid list of other card machines", () => {
  const otherCardMachines = [
    { id: "m1", name: "Bar terminal", paysInto: "connected_account" },
    { id: "m2", name: "x".repeat(60), paysInto: "other" },
  ];
  expect(payments.PAYMENTS_SETTINGS.parse({ providers: {}, otherCardMachines })).toEqual({
    ok: true,
    doc: { providers: {}, tipsEnabled: false, testProviders: false, otherCardMachines },
  });
});

const machine = { id: "m1", name: "Bar terminal", paysInto: "other" };
it.each([
  ["a null list", null],
  ["a list that is not an array", { m1: machine }],
  ["an entry that is not an object", ["m1"]],
  ["an entry with an unknown key", [{ ...machine, colour: "red" }]],
  ["an entry without an id", [{ name: machine.name, paysInto: "other" }]],
  ["an empty id", [{ ...machine, id: "" }]],
  ["a non-string id", [{ ...machine, id: 1 }]],
  ["a blank name", [{ ...machine, name: "   " }]],
  ["a non-string name", [{ ...machine, name: 7 }]],
  ["a name over 60 characters", [{ ...machine, name: "x".repeat(61) }]],
  ["a name with spaces at either end", [{ ...machine, name: " Bar terminal " }]],
  ["another destination", [{ ...machine, paysInto: "bank" }]],
  ["a repeated id", [machine, { ...machine, name: "Terrace" }]],
  ["a repeated name", [machine, { ...machine, id: "m2", name: "bar TERMINAL" }]],
  [
    "a name repeated in another Unicode spelling",
    [
      { ...machine, name: "Sal\u00f3n" },
      { ...machine, id: "m2", name: "Salo\u0301n" },
    ],
  ],
])("refuses other card machines with %s", (_label, otherCardMachines) => {
  expect(payments.PAYMENTS_SETTINGS.parse({ providers: {}, otherCardMachines })).toEqual({
    ok: false,
    field: "otherCardMachines",
  });
});
