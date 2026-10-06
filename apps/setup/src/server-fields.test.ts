import { afterEach, expect, it } from "vitest";
import { setLocale } from "./i18n/t.js";
import { SERVER_FIELDS } from "./server-fields.js";

afterEach(() => setLocale("en-GB"));

it("tells the operator about a refused field in the wizard's language, read when shown", () => {
  expect(SERVER_FIELDS.seriesCode?.message).toBe(
    "Use letters, numbers, and the characters / _ . and - only, up to 38 characters.",
  );
  setLocale("es-ES");
  expect(SERVER_FIELDS.seriesCode?.message).toBe(
    "Usa solo letras, números y los caracteres / _ . y - (hasta 38 caracteres).",
  );
  expect(SERVER_FIELDS.legalName?.message).toMatch(/^Usa 120 caracteres como máximo/);
  expect(SERVER_FIELDS["location.operationDescription"]?.message).toMatch(
    /^Usa 500 caracteres como máximo/,
  );
});

it("explains a setup-only domicile refusal without changing the fiscal field map", async () => {
  const { VENUE_SERVER_FIELDS } = await import("./server-fields.js");
  expect(VENUE_SERVER_FIELDS?.taxpayerDomicile?.key).toBe("taxpayerDomicile");
  expect(VENUE_SERVER_FIELDS?.taxpayerDomicile?.message).toMatch(/.+/);
  const english = VENUE_SERVER_FIELDS?.taxpayerDomicile?.message;
  setLocale("es-ES");
  expect(VENUE_SERVER_FIELDS?.taxpayerDomicile?.message).not.toBe(english);
  expect(VENUE_SERVER_FIELDS?.fullSeriesCode?.message).toBe(SERVER_FIELDS.fullSeriesCode?.message);
});
