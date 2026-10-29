import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { loadNodeIdentity, tryLoadNodeIdentity } from "./node-config.js";
import { loadTillAppSettings } from "./till-config.js";

const NODE = "33333333-3333-4333-8333-333333333333";
const LOCATION = "55555555-5555-4555-8555-555555555555";

const base = {
  WAITRON_NODE_ID: NODE,
};

const ID_VARS = ["WAITRON_NODE_ID"] as const;

function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : `not an AppError: ${String(error)}`;
}

/** `loadNodeIdentity` is synchronous, so no `captureError` promise wrapper: run it, return whatever it
 * throws, and fail loudly if it does not throw at all (a silent pass would hide a removed guard). */
function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected loadNodeIdentity to throw, but it returned");
}

describe("loadNodeIdentity", () => {
  it("boots from the node without a location or cached series", () => {
    const identity = { ...base };
    const loaded = tryLoadNodeIdentity(identity);
    expect(loaded).toMatchObject({ nodeId: NODE });
    expect(loaded).not.toHaveProperty("seriesId");
  });

  it("ignores a stale series variable instead of accepting it as runtime selection", () => {
    const loaded = loadNodeIdentity({ ...base, WAITRON_TILL_SERIES_ID: "stale" });
    expect(loaded).not.toHaveProperty("seriesId");
    expect(loaded.nodeId).toBe(NODE);
  });

  it("brands the node id from its env var and defaults locale to es-ES", () => {
    const config = loadNodeIdentity(base);
    // toEqual, not toMatchObject: it also asserts nothing extra — no `cardProvider`/`stripeReaderId`/
    // `sumupReaderId` key at all.
    expect(config).toEqual({
      nodeId: NODE,
    });
    expect(loadTillAppSettings(base)).toEqual({
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      tipsEnabled: false,
    });
  });

  it("leaves localeOverride undefined when WAITRON_TILL_LOCALE is unset (while locale defaults to es-ES)", () => {
    // An unset `WAITRON_TILL_LOCALE` leaves `localeOverride` undefined, so the country-pack resolver
    // falls through to geography, even as `locale` defaults to `es-ES` beside it.
    const config = loadTillAppSettings(base);
    expect(config.localeOverride).toBeUndefined();
    expect(config.locale).toBe("es-ES");
  });

  it("reads WAITRON_TILL_LOCALE and reflects it in invoiceLocales + localeOverride", () => {
    const config = loadTillAppSettings({ ...base, WAITRON_TILL_LOCALE: "ca-ES" });
    expect(config.locale).toBe("ca-ES");
    expect(config.invoiceLocales).toEqual(["ca-ES"]);
    // The raw env, carried through unchanged as the venue-default override.
    expect(config.localeOverride).toBe("ca-ES");
  });

  it("treats an empty WAITRON_TILL_LOCALE as unset, defaulting to es-ES (and localeOverride undefined)", () => {
    // An operator's `WAITRON_TILL_LOCALE=` line must not push an empty locale into `invoiceLocales`,
    // nor an empty override into the venue-default derivation.
    const config = loadTillAppSettings({ ...base, WAITRON_TILL_LOCALE: "" });
    expect(config.locale).toBe("es-ES");
    expect(config.invoiceLocales).toEqual(["es-ES"]);
    expect(config.localeOverride).toBeUndefined();
  });

  describe("tips (WAITRON_TILL_TIPS)", () => {
    it("defaults tipsEnabled to false", () => {
      const config = loadTillAppSettings(base); // no WAITRON_TILL_TIPS set
      expect(config.tipsEnabled).toBe(false);
    });

    it("enables tips on the literal '1' as well as 'true'", () => {
      const config = loadTillAppSettings({ ...base, WAITRON_TILL_TIPS: "1" });
      expect(config.tipsEnabled).toBe(true);
    });

    it("leaves tips disabled on any other WAITRON_TILL_TIPS value", () => {
      // A stray "yes" is NOT tips-on, so a typo fails safe (off).
      const config = loadTillAppSettings({ ...base, WAITRON_TILL_TIPS: "yes" });
      expect(config.tipsEnabled).toBe(false);
    });
  });

  it("needs no WAITRON_TILL_TILL_ID, and does not read one that is set", () => {
    expect(loadNodeIdentity(base)).not.toHaveProperty("tillId");
    expect(loadNodeIdentity({ ...base, WAITRON_TILL_TILL_ID: "nope" })).toEqual(
      loadNodeIdentity(base),
    );
  });

  describe("the env card selection is gone (Task 12 cutover)", () => {
    it("ignores WAITRON_TILL_CARD_PROVIDER / *_READER_ID entirely (no card field, no throw)", () => {
      // A card sale routes to its reader's provider through the pool, so these variables are ignored.
      const config = loadNodeIdentity({
        ...base,
        WAITRON_TILL_CARD_PROVIDER: "stripe_terminal",
        WAITRON_TILL_STRIPE_READER_ID: "tmr_1",
        WAITRON_TILL_SUMUP_READER_ID: "rdr_1",
      });
      expect("cardProvider" in config).toBe(false);
      expect("stripeReaderId" in config).toBe(false);
      expect("sumupReaderId" in config).toBe(false);
    });

    it("does not throw on a value that once was rejected", () => {
      expect(() =>
        loadNodeIdentity({ ...base, WAITRON_TILL_CARD_PROVIDER: "square" }),
      ).not.toThrow();
    });
  });

  describe.each(ID_VARS)("%s", (key) => {
    it("throws server.node_config_missing when unset", () => {
      const error = captureThrow(() => loadNodeIdentity({ ...base, [key]: undefined }));
      expect(codeOf(error)).toBe("server.node_config_missing");
      // toEqual (not toMatchObject) so a value leaked alongside `key` would fail the test: the env
      // var NAME is the only field either code is allowed to carry.
      expect(isAppError(error) && error.params).toEqual({ key });
    });

    it("throws server.node_config_missing when empty", () => {
      const error = captureThrow(() => loadNodeIdentity({ ...base, [key]: "" }));
      expect(codeOf(error)).toBe("server.node_config_missing");
      expect(isAppError(error) && error.params).toEqual({ key });
    });

    it("throws server.node_config_invalid on a non-uuid value", () => {
      const error = captureThrow(() => loadNodeIdentity({ ...base, [key]: "nope" }));
      expect(codeOf(error)).toBe("server.node_config_invalid");
      expect(isAppError(error) && error.params).toEqual({ key });
    });
  });
});

describe("tryLoadNodeIdentity", () => {
  it("ignores retired identity keys instead of booting with the wrong box identity", () => {
    const retired = {
      [["WAITRON", "TILL", "NODE", "ID"].join("_")]: LOCATION,
      [["WAITRON", "TILL", "LOCATION", "ID"].join("_")]: NODE,
    };
    expect(tryLoadNodeIdentity(retired)).toBeUndefined();
    expect(tryLoadNodeIdentity({ ...retired, ...base })).toEqual(loadNodeIdentity(base));
  });

  it("returns undefined when the node id is unset (setup mode)", () => {
    // An unprovisioned box has no venue: that is SETUP MODE, not a misconfiguration.
    expect(tryLoadNodeIdentity({})).toBeUndefined();
  });

  it("treats the retired series key alone as setup mode", () => {
    expect(tryLoadNodeIdentity({ WAITRON_TILL_SERIES_ID: "stale" })).toBeUndefined();
  });

  it("treats the node id present-but-empty (VAR=) as none set → undefined", () => {
    const allEmpty = Object.fromEntries(ID_VARS.map((v) => [v, ""]));
    expect(tryLoadNodeIdentity(allEmpty)).toBeUndefined();
  });

  it("loads the full config when the node is set (the same shape loadNodeIdentity returns)", () => {
    // Spot-checks nothing: `toEqual` the whole object, so a wrapper that dropped or reshaped a field
    // relative to `loadNodeIdentity` (the delegate) would fail here, not slip through on one field.
    expect(tryLoadNodeIdentity(base)).toEqual({
      nodeId: NODE,
    });
    expect(loadTillAppSettings(base)).toEqual({
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      tipsEnabled: false,
    });
  });

  it("reads a lone WAITRON_TILL_TILL_ID as setup mode, not as a partial set", () => {
    expect(
      tryLoadNodeIdentity({ WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222" }),
    ).toBeUndefined();
  });

  it("refuses a malformed node instead of silently entering setup", () => {
    const error = captureThrow(() => tryLoadNodeIdentity({ WAITRON_NODE_ID: "nope" }));
    expect(codeOf(error)).toBe("server.node_config_invalid");
    expect(isAppError(error) && error.params).toEqual({ key: "WAITRON_NODE_ID" });
  });
});
