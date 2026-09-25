import { describe, expect, it } from "vitest";
import { hasCode, isAppError } from "@waitron/shared";
import type { BucketConfig } from "./index.js";
import {
  DEFAULT_LITESTREAM_BIN,
  LITESTREAM_VERSION,
  checkLitestreamSettings,
  litestreamConfig,
  litestreamEnv,
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

function refusalOf(action: () => unknown): { code: string; params: unknown } | undefined {
  try {
    action();
  } catch (error) {
    if (isAppError(error) && hasCode(error, "backup.stream_config_unsafe")) {
      return { code: error.code, params: error.params };
    }
    throw error;
  }
  return undefined;
}

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
        "access-key-id: '${WAITRON_STREAM_ACCESS_KEY_ID}'",
        "secret-access-key: '${WAITRON_STREAM_SECRET_ACCESS_KEY}'",
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
    expect(
      refusalOf(() =>
        litestreamConfig({ dbPath: "/srv/$HOME/venue.db", replicaUrl: "s3://b/p?region=r" }),
      ),
    ).toEqual({ code: "backup.stream_config_unsafe", params: { field: "dbPath" } });
  });

  // Litestream substitutes the variables into the file's TEXT and then parses it, so each key lands
  // in the YAML as written. Unquoted, a secret holding " #" loses everything from the "#", and one
  // starting "*" or holding ": " stops the file parsing at all.
  it("lands a key holding YAML's own characters inside a single-quoted scalar, whole", () => {
    const hostile = { accessKeyId: "*abc", secretAccessKey: "abc #def: g&!@" };
    const env = litestreamEnv(hostile);
    expect(env).toEqual({
      WAITRON_STREAM_ACCESS_KEY_ID: "*abc",
      WAITRON_STREAM_SECRET_ACCESS_KEY: "abc #def: g&!@",
    });
    const expanded = litestreamConfig({ dbPath: "/d/venue.db", replicaUrl: "s3://b/p?region=r" })
      .replace(/\$\{(\w+)\}/g, (_, name: string) => env[name] ?? "")
      .split("\n");
    expect(expanded.slice(0, 2)).toEqual([
      "access-key-id: '*abc'",
      "secret-access-key: 'abc #def: g&!@'",
    ]);
  });

  // Only a quote ends a single-quoted scalar, and a line break folds it; YAML 1.1, which Litestream's
  // parser reads, also breaks lines at U+0085, U+2028 and U+2029. Printable ASCII is the whole of
  // what is let through.
  it.each([
    ["accessKeyId", { accessKeyId: "ab'c", secretAccessKey: "s" }],
    ["secretAccessKey", { accessKeyId: "a", secretAccessKey: "s'" }],
    ["secretAccessKey", { accessKeyId: "a", secretAccessKey: "s\nsnapshot: x" }],
    ["secretAccessKey", { accessKeyId: "a", secretAccessKey: "s\r" }],
    ["accessKeyId", { accessKeyId: "a\u2028b", secretAccessKey: "s" }],
    ["accessKeyId", { accessKeyId: "a\u0085b", secretAccessKey: "s" }],
    ["secretAccessKey", { accessKeyId: "a", secretAccessKey: "\u00e9" }],
  ])("refuses a %s a single-quoted scalar cannot hold whole", (field, keys) => {
    expect(refusalOf(() => litestreamEnv(keys))).toEqual({
      code: "backup.stream_config_unsafe",
      params: { field },
    });
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

  // Litestream reads the address with Go's url.Parse and then path.Clean, so the path must survive
  // both unchanged: a raw "#" or "?" would end the path there, and an empty, "." or ".." segment
  // would be cleaned into a different folder than the object store writes to.
  it("encodes each path segment, so a # or ? in the prefix stays in the path", () => {
    expect(replicaUrl({ ...BUCKET, prefix: "a#b" }, "v1", "gen-0-a-20260923T120000Z")).toBe(
      "s3://venue-copies/a%23b/venues/v1/gen-0-a-20260923T120000Z?region=eu-south-2",
    );
    expect(replicaUrl({ ...BUCKET, prefix: "a?b/c%d" }, "v1", "gen-0-a-20260923T120000Z")).toBe(
      "s3://venue-copies/a%3Fb/c%25d/venues/v1/gen-0-a-20260923T120000Z?region=eu-south-2",
    );
  });

  // encodeURIComponent throws a bare URIError on half a surrogate pair; a whole pair encodes.
  it("refuses a prefix holding half a surrogate pair, and encodes a whole one", () => {
    expect(
      refusalOf(() =>
        replicaUrl({ ...BUCKET, prefix: "a\uD800b" }, "v1", "gen-0-a-20260923T120000Z"),
      ),
    ).toEqual({ code: "backup.stream_config_unsafe", params: { field: "prefix" } });
    expect(
      replicaUrl({ ...BUCKET, prefix: "a\uD83D\uDE00b" }, "v1", "gen-0-a-20260923T120000Z"),
    ).toBe("s3://venue-copies/a%F0%9F%98%80b/venues/v1/gen-0-a-20260923T120000Z?region=eu-south-2");
  });

  it.each(["a//b", "a/../b", "..", "./a", "a/."])(
    "refuses a prefix path cleaning would change: %j",
    (prefix) => {
      expect(
        refusalOf(() => replicaUrl({ ...BUCKET, prefix }, "v1", "gen-0-a-20260923T120000Z")),
      ).toEqual({
        code: "backup.stream_config_unsafe",
        params: { field: "prefix" },
      });
    },
  );

  // The bucket is the address's host, where a "/", "?" or "#" would end it and move the rest into
  // the path, query or fragment Litestream reads.
  it.each(["venue/copies", "venue?copies", "venue#copies", "Venue-Copies", "venue_copies", ""])(
    "refuses a bucket name holding more than S3's bucket-name characters: %j",
    (bucket) => {
      expect(
        refusalOf(() => replicaUrl({ ...BUCKET, bucket }, "v1", "gen-0-a-20260923T120000Z")),
      ).toEqual({ code: "backup.stream_config_unsafe", params: { field: "bucket" } });
    },
  );

  it("accepts a bucket name of lowercase letters, digits, dots and hyphens", () => {
    expect(
      replicaUrl({ ...BUCKET, bucket: "venue.copies-2" }, "v1", "gen-0-a-20260923T120000Z"),
    ).toBe("s3://venue.copies-2/venues/v1/gen-0-a-20260923T120000Z?region=eu-south-2");
  });

  // The settings routes run this before probing, so a bucket Litestream would refuse is refused at
  // Save rather than when the copy starts.
  it.each([
    ["bucket", { bucket: "Venue_Copy" }],
    ["prefix", { prefix: "a/../b" }],
    ["secretAccessKey", { secretAccessKey: "s'" }],
  ] as const)("checks the settings as a whole, naming the %s", (field, change) => {
    expect(refusalOf(() => checkLitestreamSettings({ ...BUCKET, ...change }))).toEqual({
      code: "backup.stream_config_unsafe",
      params: { field },
    });
  });

  it("passes settings Litestream can use", () => {
    expect(() =>
      checkLitestreamSettings({
        ...BUCKET,
        prefix: "waitron/",
        endpoint: "https://s3.example.net",
      }),
    ).not.toThrow();
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
