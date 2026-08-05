import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { loadTillConfig } from "./till-config.js";

// Distinct per field so a mis-wired mapping (e.g. locationId reading the series variable) fails the
// happy-path assertion rather than passing by coincidence — every id is the SAME shape but a
// DIFFERENT value. Version/variant nibbles are irrelevant: the brand only checks 8-4-4-4-12 hex.
const TENANT = "11111111-1111-4111-8111-111111111111";
const TILL = "22222222-2222-4222-8222-222222222222";
const NODE = "33333333-3333-4333-8333-333333333333";
const SERIES = "44444444-4444-4444-8444-444444444444";
const LOCATION = "55555555-5555-4555-8555-555555555555";

const base = {
  WAITRON_TILL_TENANT_ID: TENANT,
  WAITRON_TILL_TILL_ID: TILL,
  WAITRON_TILL_NODE_ID: NODE,
  WAITRON_TILL_SERIES_ID: SERIES,
  WAITRON_TILL_LOCATION_ID: LOCATION,
};

/** The env-var name each id is sourced from — the same list `loadTillConfig` walks. Table-driven so
 * every id, including the later-folded-in `locationId` (WAITRON_TILL_LOCATION_ID), gets the missing
 * and invalid cases without five copies of each. */
const ID_VARS = [
  "WAITRON_TILL_TENANT_ID",
  "WAITRON_TILL_TILL_ID",
  "WAITRON_TILL_NODE_ID",
  "WAITRON_TILL_SERIES_ID",
  "WAITRON_TILL_LOCATION_ID",
] as const;

function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : `not an AppError: ${String(error)}`;
}

/** `loadTillConfig` is synchronous, so no `captureError` promise wrapper: run it, return whatever it
 * throws, and fail loudly if it does not throw at all (a silent pass would hide a removed guard). */
function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected loadTillConfig to throw, but it returned");
}

describe("loadTillConfig", () => {
  it("brands the five ids from their env vars and defaults locale to es-ES", () => {
    const config = loadTillConfig(base);
    // toEqual, not toMatchObject: it also asserts there is no SIXTH id field and nothing extra —
    // the branded ids are plain strings at runtime, so each is compared against its raw value.
    expect(config).toEqual({
      tenantId: TENANT,
      tillId: TILL,
      nodeId: NODE,
      seriesId: SERIES,
      locationId: LOCATION,
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
    });
  });

  it("reads WAITRON_TILL_LOCALE and reflects it in invoiceLocales", () => {
    const config = loadTillConfig({ ...base, WAITRON_TILL_LOCALE: "ca-ES" });
    expect(config.locale).toBe("ca-ES");
    expect(config.invoiceLocales).toEqual(["ca-ES"]);
  });

  it("treats an empty WAITRON_TILL_LOCALE as unset, defaulting to es-ES", () => {
    // Same "absent OR empty string is unset" rule the five ids' `required` uses — an operator's
    // `WAITRON_TILL_LOCALE=` line must not push an empty locale into `invoiceLocales`, which
    // downstream invoice rendering consumes.
    const config = loadTillConfig({ ...base, WAITRON_TILL_LOCALE: "" });
    expect(config.locale).toBe("es-ES");
    expect(config.invoiceLocales).toEqual(["es-ES"]);
  });

  describe.each(ID_VARS)("%s", (key) => {
    it("throws server.till_config_missing when unset", () => {
      const error = captureThrow(() => loadTillConfig({ ...base, [key]: undefined }));
      expect(codeOf(error)).toBe("server.till_config_missing");
      // toEqual (not toMatchObject) so a value leaked alongside `key` would fail the test: the env
      // var NAME is the only field either code is allowed to carry.
      expect(isAppError(error) && error.params).toEqual({ key });
    });

    it("throws server.till_config_missing when empty", () => {
      const error = captureThrow(() => loadTillConfig({ ...base, [key]: "" }));
      expect(codeOf(error)).toBe("server.till_config_missing");
      expect(isAppError(error) && error.params).toEqual({ key });
    });

    it("throws server.till_config_invalid on a non-uuid value", () => {
      const error = captureThrow(() => loadTillConfig({ ...base, [key]: "nope" }));
      expect(codeOf(error)).toBe("server.till_config_invalid");
      expect(isAppError(error) && error.params).toEqual({ key });
    });
  });
});
