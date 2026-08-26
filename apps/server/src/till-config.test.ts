import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { loadTillConfig, tryLoadTillConfig } from "./till-config.js";

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
    // With no WAITRON_TILL_CARD_* set, the card fields take their defaults: `cardProvider: "none"`,
    // `tipsEnabled: false`, and NO `stripeReaderId` key at all (the optional field is absent, not
    // `undefined`, so `toEqual` would fail if the parser materialised it — the terminal branch is the
    // only one that carries a reader id).
    expect(config).toEqual({
      tenantId: TENANT,
      tillId: TILL,
      nodeId: NODE,
      seriesId: SERIES,
      locationId: LOCATION,
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      cardProvider: "none",
      tipsEnabled: false,
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

  describe("card provider + tips (WAITRON_TILL_CARD_*)", () => {
    it("defaults cardProvider to 'none' and tipsEnabled to false, with no reader id", () => {
      const config = loadTillConfig(base); // no WAITRON_TILL_CARD_* set
      expect(config.cardProvider).toBe("none");
      expect(config.tipsEnabled).toBe(false);
      expect(config.stripeReaderId).toBeUndefined();
    });

    it("treats an empty WAITRON_TILL_CARD_PROVIDER as unset, defaulting to 'none'", () => {
      // Same "absent OR empty string is unset" rule the ids' `required` uses — an operator's
      // `WAITRON_TILL_CARD_PROVIDER=` line falls back to `none` rather than reaching the invalid
      // branch on an empty value.
      const config = loadTillConfig({ ...base, WAITRON_TILL_CARD_PROVIDER: "" });
      expect(config.cardProvider).toBe("none");
      expect(config.stripeReaderId).toBeUndefined();
    });

    it("accepts an explicit 'none'", () => {
      const config = loadTillConfig({ ...base, WAITRON_TILL_CARD_PROVIDER: "none" });
      expect(config.cardProvider).toBe("none");
      expect(config.stripeReaderId).toBeUndefined();
    });

    it("reads stripe_terminal + reader id + tips", () => {
      const config = loadTillConfig({
        ...base,
        WAITRON_TILL_CARD_PROVIDER: "stripe_terminal",
        WAITRON_TILL_STRIPE_READER_ID: "tmr_1",
        WAITRON_TILL_TIPS: "true",
      });
      expect(config.cardProvider).toBe("stripe_terminal");
      expect(config.stripeReaderId).toBe("tmr_1");
      expect(config.tipsEnabled).toBe(true);
    });

    it("reads stripe_on_device and mints no reader id (the device holds its own connection token)", () => {
      const config = loadTillConfig({
        ...base,
        WAITRON_TILL_CARD_PROVIDER: "stripe_on_device",
      });
      expect(config.cardProvider).toBe("stripe_on_device");
      // No reader id required — the on-device flow creates its own connection token, so there is no
      // server-side reader to name (unlike stripe_terminal, which drives a specific reader).
      expect(config.stripeReaderId).toBeUndefined();
    });

    it("enables tips on the literal '1' as well as 'true'", () => {
      const config = loadTillConfig({ ...base, WAITRON_TILL_TIPS: "1" });
      expect(config.tipsEnabled).toBe(true);
    });

    it("leaves tips disabled on any other WAITRON_TILL_TIPS value", () => {
      // Only "true"/"1" enable — a stray "yes" is NOT tips-on, so a typo fails safe (off).
      const config = loadTillConfig({ ...base, WAITRON_TILL_TIPS: "yes" });
      expect(config.tipsEnabled).toBe(false);
    });

    it("refuses a stripe_terminal provider with no reader id (server.till_config_missing)", () => {
      const error = captureThrow(() =>
        loadTillConfig({ ...base, WAITRON_TILL_CARD_PROVIDER: "stripe_terminal" }),
      );
      expect(codeOf(error)).toBe("server.till_config_missing");
      // toEqual (not toMatchObject): the env var NAME is the only field the code may carry, so a
      // leaked reader value alongside `key` would fail here.
      expect(isAppError(error) && error.params).toEqual({ key: "WAITRON_TILL_STRIPE_READER_ID" });
    });

    it("refuses a stripe_terminal provider with an EMPTY reader id (server.till_config_missing)", () => {
      // The `required` "absent OR empty" rule: a `WAITRON_TILL_STRIPE_READER_ID=` line is missing,
      // not a valid empty reader — the same treatment the five ids get.
      const error = captureThrow(() =>
        loadTillConfig({
          ...base,
          WAITRON_TILL_CARD_PROVIDER: "stripe_terminal",
          WAITRON_TILL_STRIPE_READER_ID: "",
        }),
      );
      expect(codeOf(error)).toBe("server.till_config_missing");
      expect(isAppError(error) && error.params).toEqual({ key: "WAITRON_TILL_STRIPE_READER_ID" });
    });

    it("refuses an unknown provider value (server.till_config_invalid)", () => {
      const error = captureThrow(() =>
        loadTillConfig({ ...base, WAITRON_TILL_CARD_PROVIDER: "square" }),
      );
      expect(codeOf(error)).toBe("server.till_config_invalid");
      // The variable NAME only — the rejected value ("square") is never echoed, the same no-leak
      // discipline the id-branding invalid case follows.
      expect(isAppError(error) && error.params).toEqual({ key: "WAITRON_TILL_CARD_PROVIDER" });
    });
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

describe("tryLoadTillConfig", () => {
  it("returns undefined when NONE of the five till ids are set (setup mode)", () => {
    // An unprovisioned box has no venue, so the five WAITRON_TILL_*_ID are absent — that is SETUP
    // MODE, not a misconfiguration, so the load returns undefined rather than throwing. (Boot branches
    // on `config.till === undefined` in a later slice-1b task.)
    expect(tryLoadTillConfig({})).toBeUndefined();
  });

  it("treats all five present-but-empty (VAR=) as none set → undefined", () => {
    // `isUnset` is absent-OR-empty, so an env file writing every WAITRON_TILL_*_ID= blank is still
    // "none set" (setup mode) — the same VAR=-means-unset rule the ids' own `required` applies.
    const allEmpty = Object.fromEntries(ID_VARS.map((v) => [v, ""]));
    expect(tryLoadTillConfig(allEmpty)).toBeUndefined();
  });

  it("loads the full config when ALL five are set (the same shape loadTillConfig returns)", () => {
    // Spot-checks nothing: `toEqual` the whole object, so a wrapper that dropped or reshaped a field
    // relative to `loadTillConfig` (the delegate) would fail here, not slip through on one field.
    expect(tryLoadTillConfig(base)).toEqual({
      tenantId: TENANT,
      tillId: TILL,
      nodeId: NODE,
      seriesId: SERIES,
      locationId: LOCATION,
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      cardProvider: "none",
      tipsEnabled: false,
    });
  });

  describe.each(ID_VARS)("with only %s missing (a partial set)", (missing) => {
    it("throws server.config_invalid { variable, reason: 'till_config_partial' }", () => {
      // Some-but-not-all set is a HALF-CONFIGURED server — a bug, never a setup box — so it throws,
      // naming the (first) missing variable. Only the NAME travels, never a value: the same no-leak
      // discipline the ids' `required`/`brand` paths keep.
      const error = captureThrow(() => tryLoadTillConfig({ ...base, [missing]: undefined }));
      expect(codeOf(error)).toBe("server.config_invalid");
      expect(isAppError(error) && error.params).toEqual({
        variable: missing,
        reason: "till_config_partial",
      });
    });
  });

  it("names the FIRST missing variable (in WAITRON_TILL_{TENANT,TILL,NODE,SERIES,LOCATION}_ID order) when several are absent", () => {
    // NODE and SERIES both absent → NODE is named (it comes first in the list), so an operator fixes
    // them top-down rather than one error at a time from an arbitrary one.
    const error = captureThrow(() =>
      tryLoadTillConfig({
        ...base,
        WAITRON_TILL_NODE_ID: undefined,
        WAITRON_TILL_SERIES_ID: undefined,
      }),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_TILL_NODE_ID",
      reason: "till_config_partial",
    });
  });
});
