import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { readBucketConfig } from "./bucket-config.js";
import type { BucketConfig } from "./s3-store.js";

const INPUT = {
  endpoint: "https://s3.example.net",
  region: "eu-west-1",
  bucket: "venue-copy",
  prefix: "waitron/",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "not-a-real-secret-0123456789",
};

class Refused extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

const refuse = (field: keyof BucketConfig): never => {
  throw new Refused(field);
};

function refusedField(raw: unknown): string {
  try {
    readBucketConfig(raw, refuse);
  } catch (error) {
    if (error instanceof Refused) return error.field;
    throw error;
  }
  throw new Error("readBucketConfig accepted it");
}

describe("readBucketConfig", () => {
  it("reads every field, and a blank endpoint and prefix as none", () => {
    expect(readBucketConfig(INPUT, refuse)).toEqual(INPUT);
    expect(readBucketConfig({ ...INPUT, endpoint: "", prefix: "" }, refuse)).toEqual({
      region: INPUT.region,
      bucket: INPUT.bucket,
      prefix: "",
      accessKeyId: INPUT.accessKeyId,
      secretAccessKey: INPUT.secretAccessKey,
    });
  });

  it("reads a missing prefix as none", () => {
    expect(readBucketConfig({ ...INPUT, prefix: undefined }, refuse)).toEqual({
      ...INPUT,
      prefix: "",
    });
  });

  // The vault's marker for no prefix; the settings routes refuse it (`streamSettingsPayload`).
  it('passes a prefix of "-" through', () => {
    expect(readBucketConfig({ ...INPUT, prefix: "-" }, refuse)).toEqual({ ...INPUT, prefix: "-" });
  });

  it.each([
    ["region", { region: "" }],
    ["region", { region: undefined }],
    ["bucket", { bucket: 7 }],
    ["accessKeyId", { accessKeyId: "AKIA\nEXAMPLE" }],
    ["secretAccessKey", { secretAccessKey: "secret\u007f" }],
    ["prefix", { prefix: " waitron/" }],
    ["endpoint", { endpoint: "s3.example.net" }],
    ["endpoint", { endpoint: "ftp://s3.example.net" }],
  ])("names the %s it refuses", (field, change) => {
    expect(refusedField({ ...INPUT, ...change })).toBe(field);
  });

  it("refuses input that is not an object by its first required field", () => {
    expect(refusedField(null)).toBe("region");
  });

  it("lets Litestream's own refusal through, naming the field", () => {
    let caught: unknown;
    try {
      readBucketConfig({ ...INPUT, bucket: "Venue_Copy" }, refuse);
    } catch (error) {
      caught = error;
    }
    expect(isAppError(caught) && { code: caught.code, params: caught.params }).toEqual({
      code: "backup.stream_config_unsafe",
      params: { field: "bucket" },
    });
  });
});
