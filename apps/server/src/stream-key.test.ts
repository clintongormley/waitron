import { describe, expect, it } from "vitest";
import { deriveStreamKey } from "./stream-key.js";

describe("the bucket copy's key", () => {
  it("derives a separate 32-byte key bound to the venue", () => {
    const key = deriveStreamKey("backup-key-for-test-0123456789", "venue-1");
    expect(key).toBe("eZOKn+2qHfg5lh9N8KukguwiEexVtiKGzbtZJFj3c8s=");
    expect(Buffer.from(key, "base64")).toHaveLength(32);
    expect(deriveStreamKey("backup-key-for-test-0123456789", "venue-2")).not.toBe(key);
    expect(deriveStreamKey("replacement-backup-key-0123456789", "venue-1")).not.toBe(key);
  });
});
