import { describe, expect, it } from "vitest";
import { resolveAccountKey } from "./account-key.js";

describe("resolveAccountKey", () => {
  it("uses an explicitly shared venue key on nodes with different vault keys", () => {
    const shared = Buffer.alloc(32, 7).toString("base64");
    const first = resolveAccountKey(
      { WAITRON_ACCOUNT_KEY: shared },
      { current: { version: 1, key: Buffer.alloc(32, 1) } },
    );
    const second = resolveAccountKey(
      { WAITRON_ACCOUNT_KEY: shared },
      { current: { version: 4, key: Buffer.alloc(32, 2) } },
    );
    expect(first).toEqual(second);
    expect(first).toEqual(Buffer.alloc(32, 7));
  });

  it("derives a stable key for a primary that predates the explicit setting", () => {
    const ring = { current: { version: 1, key: Buffer.alloc(32, 3) } };
    expect(resolveAccountKey({}, ring)).toEqual(resolveAccountKey({}, ring));
    expect(resolveAccountKey({}, ring)).not.toEqual(ring.current.key);
  });

  it("rejects malformed explicit keys", () => {
    expect(() =>
      resolveAccountKey(
        { WAITRON_ACCOUNT_KEY: Buffer.alloc(16).toString("base64") },
        { current: { version: 1, key: Buffer.alloc(32, 1) } },
      ),
    ).toThrowError(expect.objectContaining({ code: "server.config_invalid" }));
  });
});
