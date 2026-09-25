import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { KIT_PREFIX, encodeRecoveryKit, parseRecoveryKit, type RecoveryKit } from "./kit.js";

const KIT: RecoveryKit = {
  version: 1,
  venueId: "c0000000-0000-4000-8000-000000000002",
  bucket: {
    endpoint: "https://s3.example.net",
    region: "eu-west-1",
    bucket: "venue-copy",
    prefix: "waitron/",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "not-a-real-secret-0123456789",
  },
  recoveryKey: "recovery-key-one-strong",
  pointerSignerPublicKey: "MCowBQYDK2VwAyEA0000000000000000000000000000000000000000000=",
};

function refusal(text: string): { code: string; params: Record<string, unknown> } {
  try {
    parseRecoveryKit(text);
  } catch (error) {
    if (isAppError(error)) return { code: error.code, params: { ...error.params } };
    throw error;
  }
  throw new Error("parseRecoveryKit accepted it");
}

describe("the recovery kit", () => {
  it("round-trips through its single-string form", () => {
    const text = encodeRecoveryKit(KIT);
    expect(text.startsWith(KIT_PREFIX)).toBe(true);
    // One token, so it survives being copied from the screen as one string.
    expect(/\s/.test(text)).toBe(false);
    expect(parseRecoveryKit(text)).toEqual(KIT);
  });

  it("round-trips a bucket with no endpoint (an Amazon bucket)", () => {
    const amazon = { ...KIT.bucket };
    delete amazon.endpoint;
    const kit: RecoveryKit = { ...KIT, bucket: amazon };
    expect(parseRecoveryKit(encodeRecoveryKit(kit))).toEqual(kit);
  });

  it("finds the kit inside the downloaded file's explanatory text", () => {
    const file = `Waitron recovery kit\nKeep this safe.\n\n${encodeRecoveryKit(KIT)}\n`;
    expect(parseRecoveryKit(file)).toEqual(KIT);
  });

  it("refuses text with no kit in it", () => {
    expect(refusal("hello world")).toEqual({
      code: "backup.stream_kit_invalid",
      params: { reason: "not_found" },
    });
  });

  it("refuses a kit whose body is not the encoded JSON", () => {
    expect(refusal(`${KIT_PREFIX}@@@not-base64-json@@@`)).toEqual({
      code: "backup.stream_kit_invalid",
      params: { reason: "encoding" },
    });
  });

  it("refuses a kit missing a field, and never echoes what it was given", () => {
    const partial: Partial<RecoveryKit> = { ...KIT };
    delete partial.recoveryKey;
    const text = `${KIT_PREFIX}${Buffer.from(JSON.stringify(partial)).toString("base64url")}`;
    const r = refusal(text);
    expect(r).toEqual({ code: "backup.stream_kit_invalid", params: { reason: "shape" } });
    expect(JSON.stringify(r)).not.toContain(KIT.bucket.secretAccessKey);
  });

  it("refuses a field carrying a control character, which would break the Litestream config it is written into", () => {
    const kit = { ...KIT, bucket: { ...KIT.bucket, bucket: "venue\ncopy" } };
    const text = `${KIT_PREFIX}${Buffer.from(JSON.stringify(kit)).toString("base64url")}`;
    expect(refusal(text)).toEqual({
      code: "backup.stream_kit_invalid",
      params: { reason: "shape" },
    });
  });

  it.each([
    ["a bare number", 42],
    ["null", null],
    ["a kit whose bucket is not an object", { ...KIT, bucket: null }],
  ])("refuses a kit that decodes to %s", (_what, value) => {
    const text = `${KIT_PREFIX}${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
    expect(refusal(text)).toEqual({
      code: "backup.stream_kit_invalid",
      params: { reason: "shape" },
    });
  });

  it.each([
    ["a bucket name with capitals and an underscore", { bucket: "Venue_Copy" }],
    ["a prefix path cleaning would change", { prefix: "a/../b" }],
  ])("refuses %s, which Litestream's configuration would refuse", (_what, change) => {
    const kit = { ...KIT, bucket: { ...KIT.bucket, ...change } };
    const text = `${KIT_PREFIX}${Buffer.from(JSON.stringify(kit)).toString("base64url")}`;
    expect(refusal(text)).toEqual({
      code: "backup.stream_kit_invalid",
      params: { reason: "shape" },
    });
  });

  it("refuses an unknown version", () => {
    const text = `${KIT_PREFIX}${Buffer.from(JSON.stringify({ ...KIT, version: 2 })).toString("base64url")}`;
    expect(refusal(text)).toEqual({
      code: "backup.stream_kit_invalid",
      params: { reason: "shape" },
    });
  });
});
