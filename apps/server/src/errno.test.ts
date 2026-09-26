import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { errnoOf } from "./errno.js";

describe("errnoOf", () => {
  it("returns a system error's code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "errno-"));
    try {
      const error: unknown = await rm(dir).catch((e: unknown) => e);
      expect(errnoOf(error)).toBe("ERR_FS_EISDIR");
      expect(errnoOf(Object.assign(new Error("operation not permitted"), { code: "EPERM" }))).toBe(
        "EPERM",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns nothing for a code that is not errno-shaped, so a path never reaches a log", () => {
    expect(errnoOf({ code: "secret/path" })).toBeUndefined();
    expect(errnoOf({ code: "EACCES /srv/state/tls" })).toBeUndefined();
  });

  it("returns nothing for a code that is not a string, or no error at all", () => {
    expect(errnoOf({ code: 13 })).toBeUndefined();
    expect(errnoOf(null)).toBeUndefined();
    expect(errnoOf(undefined)).toBeUndefined();
  });
});
