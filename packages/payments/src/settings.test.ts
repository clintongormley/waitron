import { expect, it } from "vitest";
import * as payments from "./index.js";

it("defaults providers to On and retains explicit Off without transferring the setting", () => {
  expect(payments.PAYMENTS_SETTINGS).toBeDefined();
  expect(payments.PAYMENTS_SETTINGS.defaults()).toEqual({ providers: {} });
  expect(payments.PAYMENTS_SETTINGS.transfers).toBe(false);
  expect(payments.PAYMENTS_SETTINGS.parse({ providers: { stripe: false, sumup: true } })).toEqual({
    ok: true,
    doc: { providers: { stripe: false, sumup: true } },
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
