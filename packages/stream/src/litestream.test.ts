import { describe, expect, it } from "vitest";
import { hasCode, isAppError } from "@waitron/shared";
import type { BucketConfig } from "./index.js";
import {
  DEFAULT_LITESTREAM_BIN,
  LITESTREAM_VERSION,
  litestreamConfig,
  litestreamMetaDir,
  replicaUrl,
  resolveLitestreamBin,
} from "./litestream.js";

const BUCKET: BucketConfig = {
  region: "eu-south-2",
  bucket: "venue-copies",
  prefix: "",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret-example",
};

describe("the Litestream configuration", () => {
  it("pins the version every measurement was taken on", () => {
    expect(LITESTREAM_VERSION).toBe("0.5.17");
  });

  it("names the credentials by variable and holds no secret", () => {
    const text = litestreamConfig({
      dbPath: "/var/lib/waitron/state/venue/venue.db",
      replicaUrl: "s3://venue-copies/venues/v1/gen-0-a-20260923T120000Z?region=eu-south-2",
    });
    expect(text).toBe(
      [
        "access-key-id: ${WAITRON_STREAM_ACCESS_KEY_ID}",
        "secret-access-key: ${WAITRON_STREAM_SECRET_ACCESS_KEY}",
        "snapshot:",
        "  interval: 24h",
        "  retention: 168h",
        "l0-retention: 5m",
        "",
        "dbs:",
        '  - path: "/var/lib/waitron/state/venue/venue.db"',
        "    replica:",
        '      url: "s3://venue-copies/venues/v1/gen-0-a-20260923T120000Z?region=eu-south-2"',
        "",
      ].join("\n"),
    );
  });

  // Litestream expands `${VAR}` over the whole file's text before parsing it (its docs, and
  // `-no-expand-env`), so a `$` in any other value would be read as a variable.
  it("refuses a value holding a dollar sign", () => {
    let refusal: unknown;
    try {
      litestreamConfig({ dbPath: "/srv/$HOME/venue.db", replicaUrl: "s3://b/p?region=r" });
    } catch (error) {
      refusal = error;
    }
    expect(isAppError(refusal) && hasCode(refusal, "backup.stream_config_unsafe")).toBe(true);
  });

  it("puts the endpoint and region in the replica address only when there is one", () => {
    expect(replicaUrl(BUCKET, "v1", "gen-0-a-20260923T120000Z")).toBe(
      "s3://venue-copies/venues/v1/gen-0-a-20260923T120000Z?region=eu-south-2",
    );
    expect(
      replicaUrl(
        { ...BUCKET, endpoint: "https://s3.example.net" },
        "v1",
        "gen-0-a-20260923T120000Z",
      ),
    ).toBe(
      "s3://venue-copies/venues/v1/gen-0-a-20260923T120000Z?region=eu-south-2&endpoint=https%3A%2F%2Fs3.example.net",
    );
  });

  // The object store adds the owner's prefix to every key (Task 5's `bucketKey`), and Litestream
  // talks to the bucket itself, so its address must carry the prefix the same way — normalised the
  // same way, or the two would write to different folders.
  it("puts the generation under the owner's prefix, normalised as the object store normalises it", () => {
    for (const prefix of ["waitron/", "waitron", "/waitron/"]) {
      expect(replicaUrl({ ...BUCKET, prefix }, "v1", "gen-0-a-20260923T120000Z")).toBe(
        "s3://venue-copies/waitron/venues/v1/gen-0-a-20260923T120000Z?region=eu-south-2",
      );
    }
  });

  it("finds the binary from WAITRON_LITESTREAM_BIN, and on PATH when that is unset or empty", () => {
    expect(resolveLitestreamBin({ WAITRON_LITESTREAM_BIN: "/opt/litestream" })).toBe(
      "/opt/litestream",
    );
    expect(resolveLitestreamBin({})).toBe(DEFAULT_LITESTREAM_BIN);
    expect(resolveLitestreamBin({ WAITRON_LITESTREAM_BIN: "" })).toBe("litestream");
  });

  it("names Litestream's own state directory beside the database", () => {
    expect(litestreamMetaDir("/data/venue/venue.db")).toBe("/data/venue/.venue.db-litestream");
  });
});
