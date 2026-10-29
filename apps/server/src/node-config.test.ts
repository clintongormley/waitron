import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { loadNodeIdentity, tryLoadNodeIdentity } from "./node-config.js";
import { loadTillAppSettings } from "./till-config.js";
import { loadConfig } from "./config.js";

const NODE = "33333333-3333-4333-8333-333333333333";
const OTHER = "55555555-5555-4555-8555-555555555555";

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("independent node and app inputs", () => {
  it("node identity excludes app preferences", () => {
    expect(
      loadNodeIdentity({
        WAITRON_NODE_ID: NODE,
        WAITRON_TILL_LOCALE: "ca-ES",
        WAITRON_TILL_TIPS: "1",
      }),
    ).toStrictEqual({ nodeId: NODE });
  });

  it("app settings do not establish node identity", () => {
    const env = { WAITRON_TILL_LOCALE: "ca-ES", WAITRON_TILL_TIPS: "true" };
    expect(loadTillAppSettings(env)).toStrictEqual({
      locale: "ca-ES",
      invoiceLocales: ["ca-ES"],
      localeOverride: "ca-ES",
      tipsEnabled: true,
    });
    expect(tryLoadNodeIdentity(env)).toBeUndefined();
    const config = loadConfig(env, "/migrations", "/state");
    expect(config.node).toBeUndefined();
    expect(config.tillApp).toStrictEqual(loadTillAppSettings(env));
    expect(config).not.toHaveProperty("till");
  });

  it.each([undefined, ""])(
    "absent or empty node %s is optional only at the setup boundary",
    (raw) => {
      const env = { WAITRON_NODE_ID: raw };
      expect(tryLoadNodeIdentity(env)).toBeUndefined();
      const error = thrown(() => loadNodeIdentity(env));
      expect(isAppError(error) && error.code).toBe("server.node_config_missing");
      expect(isAppError(error) && error.params).toStrictEqual({ key: "WAITRON_NODE_ID" });
    },
  );

  it.each(["not-a-uuid", "pasted-private-key-keep-out-of-errors"])(
    "refuses malformed node %s without carrying its value",
    (secret) => {
      for (const reader of [loadNodeIdentity, tryLoadNodeIdentity]) {
        const error = thrown(() => reader({ WAITRON_NODE_ID: secret }));
        expect(isAppError(error) && error.code).toBe("server.node_config_invalid");
        expect(isAppError(error) && error.params).toStrictEqual({ key: "WAITRON_NODE_ID" });
        expect(error).toBeInstanceOf(Error);
        const details = error as Error;
        expect(
          [JSON.stringify(error), details.message, String(details.cause)].join(" "),
        ).not.toContain(secret);
        expect(details.cause).toBeUndefined();
      }
    },
  );

  it("ignores retired identities alone and beside a distinct current node", () => {
    const retired = {
      [["WAITRON", "TILL", "NODE", "ID"].join("_")]: OTHER,
      [["WAITRON", "TILL", "LOCATION", "ID"].join("_")]: NODE,
    };
    expect(tryLoadNodeIdentity(retired)).toBeUndefined();
    expect(loadNodeIdentity({ ...retired, WAITRON_NODE_ID: NODE })).toStrictEqual({ nodeId: NODE });
  });

  it.each([undefined, "", "es-ES", "ca-ES", "zz-ZZ"])(
    "keeps raw locale %s distinct from its default",
    (raw) => {
      const locale = raw === undefined || raw === "" ? "es-ES" : raw;
      expect(loadTillAppSettings({ WAITRON_TILL_LOCALE: raw })).toStrictEqual({
        locale,
        invoiceLocales: [locale],
        localeOverride: raw === "" ? undefined : raw,
        tipsEnabled: false,
      });
    },
  );

  it.each([undefined, "", "true", "1", "false", "0", "yes"])(
    "enables tips only for true or 1 (%s)",
    (raw) => {
      expect(loadTillAppSettings({ WAITRON_TILL_TIPS: raw }).tipsEnabled).toBe(
        raw === "true" || raw === "1",
      );
    },
  );
});
