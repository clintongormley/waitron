import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { loadNodeIdentity, tryLoadNodeIdentity } from "./node-config.js";
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

describe("node inputs", () => {
  it("an environment choice does not establish node identity", () => {
    const env = { WAITRON_ENV: "dev" };
    expect(tryLoadNodeIdentity(env)).toBeUndefined();
    const config = loadConfig(env, "/migrations", "/state");
    expect(config.node).toBeUndefined();
    expect(config.devMode).toBe(true);
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
});
