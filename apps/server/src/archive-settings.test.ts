import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { putCredential, loadKeyRing } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { isAppError } from "@waitron/shared";
import { venuePrefix } from "@waitron/stream";
import {
  ARCHIVE_PURPOSE,
  archiveNamespace,
  parseArchiveSettings,
  readArchiveSettings,
  resolveArchiveChoice,
  writeArchiveSettings,
  type ArchiveSettings,
} from "./archive-settings.js";
import type { StreamSettings } from "./stream-host.js";

const VENUE = "c0000000-0000-4000-8000-000000000002";
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const originalStreamSecret = "stream-secret-original";
const stream: StreamSettings = {
  venueId: VENUE,
  bucket: {
    endpoint: "https://s3.example.test",
    region: "eu-north-1",
    bucket: "owner-bucket",
    prefix: "waitron",
    accessKeyId: "AKIASTREAM",
    secretAccessKey: originalStreamSecret,
  },
};

const custom = {
  kind: "custom-s3",
  endpoint: "https://other.example.test",
  region: "eu-west-1",
  bucket: "archive-bucket",
  prefix: "box",
  accessKeyId: "AKIACUSTOM",
  secretAccessKey: "custom-secret",
};

function settingsWith(destinations: ArchiveSettings["destinations"]): ArchiveSettings {
  return {
    revision: "6f1c2a43-8a49-4d0f-9b51-4d4f4c7c2a10",
    enabled: true,
    destinations,
    schedule: { kind: "interval", ms: 86_400_000 },
    retention: { count: 7, days: 30 },
    destinationTimeoutMs: 900_000,
  };
}

function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

const isSettingsInvalid = (e: unknown) =>
  isAppError(e) && e.code === "backup.archive_settings_invalid";

function refusal(run: () => unknown): { code: string; params: unknown } {
  try {
    run();
  } catch (error) {
    const e = error as { code: string; params: unknown };
    return { code: e.code, params: e.params };
  }
  throw new Error("expected a refusal");
}

describe("archiveNamespace", () => {
  it("puts the venue's archives under the selected prefix", () => {
    expect(archiveNamespace("waitron", VENUE)).toBe(`waitron/archives/${VENUE}/`);
    expect(archiveNamespace("/a/b/", VENUE)).toBe(`a/b/archives/${VENUE}/`);
  });

  it("uses archives/<venue>/ at the bucket root", () => {
    expect(archiveNamespace("", VENUE)).toBe(`archives/${VENUE}/`);
    expect(archiveNamespace("/", VENUE)).toBe(`archives/${VENUE}/`);
  });

  it.each(["a//b", "a/./b", "../b", "a/..", "a\u0000b", "a\u007fb", "a\u0085b"])(
    "refuses the prefix %j",
    (prefix) => {
      expect(refusal(() => archiveNamespace(prefix, VENUE))).toEqual({
        code: "backup.request_invalid",
        params: { field: "prefix" },
      });
    },
  );

  it.each([
    ["a right-to-left override", "a‮b"],
    ["a byte-order mark", "﻿a"],
    ["a zero-width space", "a​b"],
    ["a line separator", "a b"],
    ["a paragraph separator", "a b"],
    ["a lone high surrogate", "a\ud800b"],
    ["a lone low surrogate", "a\udc00"],
  ])("refuses a prefix holding %s", (_name, prefix) => {
    expect(refusal(() => archiveNamespace(prefix, VENUE))).toEqual({
      code: "backup.request_invalid",
      params: { field: "prefix" },
    });
  });

  it("accepts a prefix holding a whole character outside the basic plane", () => {
    expect(archiveNamespace("a\u{1f600}b", VENUE)).toBe(`a\u{1f600}b/archives/${VENUE}/`);
  });

  it.each(["", "a/b", "-a", "a.b"])("refuses the venue id %j", (venueId) => {
    expect(refusal(() => archiveNamespace("p", venueId))).toEqual({
      code: "backup.request_invalid",
      params: { field: "venueId" },
    });
  });
});

describe("resolveArchiveChoice", () => {
  const ctx = { venueId: VENUE, stream, held: null };

  it("resolves a local folder to an absolute path under the primary id", () => {
    expect(resolveArchiveChoice({ kind: "local-fs", dir: "backups" }, ctx)).toEqual({
      kind: "local-fs",
      id: "primary",
      dir: resolve("backups"),
    });
  });

  it.each(["", "   "])(
    "refuses a local folder of %j, which would be the working directory",
    (dir) => {
      expect(refusal(() => resolveArchiveChoice({ kind: "local-fs", dir }, ctx))).toEqual({
        code: "backup.request_invalid",
        params: { field: "dir" },
      });
    },
  );

  it("snapshots the stream bucket's settings, secret included", () => {
    const saved = resolveArchiveChoice({ kind: "stream-bucket" }, ctx);
    if (saved.kind !== "s3") throw new Error("expected a bucket");
    expect(saved.bucket.secretAccessKey).toBe(originalStreamSecret);
    expect(saved).toEqual({ kind: "s3", id: "bucket", venueId: VENUE, bucket: stream.bucket });
    expect(saved.bucket).not.toBe(stream.bucket);
  });

  it("refuses the stream bucket when no stream is configured", () => {
    expect(
      refusal(() => resolveArchiveChoice({ kind: "stream-bucket" }, { ...ctx, stream: null })).code,
    ).toBe("backup.stream_not_configured");
  });

  it.each([
    "",
    "venues",
    "archives",
    `venues/${VENUE}`,
    `archives/${VENUE}`,
    `x/archives/${VENUE}/venues`,
    `x/venues/${VENUE}/archives`,
  ])("keeps the stream bucket at prefix %j apart from its archives", (prefix) => {
    const at = { ...stream, bucket: { ...stream.bucket, prefix } };
    expect(resolveArchiveChoice({ kind: "stream-bucket" }, { ...ctx, stream: at }).kind).toBe("s3");
  });

  it("keeps a stream at the bucket root apart from its archives", () => {
    const rooted = { ...stream, bucket: { ...stream.bucket, prefix: "" } };
    const saved = resolveArchiveChoice({ kind: "stream-bucket" }, { ...ctx, stream: rooted });
    if (saved.kind !== "s3") throw new Error("expected a bucket");
    expect(archiveNamespace(saved.bucket.prefix, saved.venueId)).toBe(`archives/${VENUE}/`);
  });

  it("refuses an archive prefix inside the stream's venue folder", () => {
    const body = {
      ...custom,
      endpoint: stream.bucket.endpoint,
      region: stream.bucket.region,
      bucket: stream.bucket.bucket,
      prefix: `waitron/venues/${VENUE}/old`,
    };
    expect(refusal(() => resolveArchiveChoice(body, ctx))).toEqual({
      code: "backup.archive_namespace_overlap",
      params: {},
    });
  });

  it("refuses an archive folder that contains the stream's venue folder", () => {
    const nested = { ...stream, bucket: { ...stream.bucket, prefix: `data/archives/${VENUE}` } };
    const body = {
      ...custom,
      endpoint: stream.bucket.endpoint,
      region: stream.bucket.region,
      bucket: stream.bucket.bucket,
      prefix: "data",
    };
    expect(refusal(() => resolveArchiveChoice(body, { ...ctx, stream: nested })).code).toBe(
      "backup.archive_namespace_overlap",
    );
  });

  const inStreamVenue = {
    ...custom,
    region: stream.bucket.region,
    bucket: stream.bucket.bucket,
    prefix: `waitron/venues/${VENUE}/old`,
  };

  it.each([
    "https://s3.example.test/",
    "HTTPS://S3.EXAMPLE.TEST",
    "https://S3.example.test",
    "https://s3.example.test:443",
  ])("refuses the stream's endpoint spelled %j", (endpoint) => {
    expect(refusal(() => resolveArchiveChoice({ ...inStreamVenue, endpoint }, ctx)).code).toBe(
      "backup.archive_namespace_overlap",
    );
  });

  describe("on AWS's own endpoint", () => {
    const aws = { ...stream, bucket: without(stream.bucket, "endpoint") };

    it.each(["https://s3.eu-north-1.amazonaws.com", "https://s3.amazonaws.com/"])(
      "refuses %j as the same place as no endpoint",
      (endpoint) => {
        const body = { ...inStreamVenue, endpoint };
        expect(refusal(() => resolveArchiveChoice(body, { ...ctx, stream: aws })).code).toBe(
          "backup.archive_namespace_overlap",
        );
      },
    );

    it("refuses no endpoint as the same place as the regional AWS endpoint", () => {
      const regional = {
        ...stream,
        bucket: { ...stream.bucket, endpoint: "https://s3.eu-north-1.amazonaws.com" },
      };
      const body = without(inStreamVenue, "endpoint");
      expect(refusal(() => resolveArchiveChoice(body, { ...ctx, stream: regional })).code).toBe(
        "backup.archive_namespace_overlap",
      );
    });

    it("allows another endpoint in the same-named bucket", () => {
      expect(resolveArchiveChoice(inStreamVenue, { ...ctx, stream: aws }).kind).toBe("s3");
    });
  });

  it.each([
    ["the stream's venues folder itself", "waitron/venues"],
    ["another venue's stream folder", "waitron/venues/d0000000-0000-4000-8000-000000000009"],
    ["the folder @waitron/stream names for this venue", `waitron/${venuePrefix(VENUE)}x`],
  ])("refuses an archive prefix inside %s", (_name, prefix) => {
    const body = { ...inStreamVenue, endpoint: stream.bucket.endpoint, prefix };
    expect(refusal(() => resolveArchiveChoice(body, ctx)).code).toBe(
      "backup.archive_namespace_overlap",
    );
  });

  it("allows the same prefix in a different bucket", () => {
    const body = { ...custom, prefix: `waitron/venues/${VENUE}/old` };
    expect(resolveArchiveChoice(body, ctx).kind).toBe("s3");
  });

  it("resolves a custom bucket", () => {
    const bucket = without(custom, "kind");
    expect(resolveArchiveChoice(custom, ctx)).toEqual({
      kind: "s3",
      id: "bucket",
      venueId: VENUE,
      bucket,
    });
  });

  it.each([undefined, ""])("refuses a first custom save with secret %j", (secretAccessKey) => {
    expect(refusal(() => resolveArchiveChoice({ ...custom, secretAccessKey }, ctx))).toEqual({
      code: "backup.request_invalid",
      params: { field: "secretAccessKey" },
    });
  });

  describe("with a custom bucket already held", () => {
    const first = resolveArchiveChoice(custom, ctx);
    const held = settingsWith([first]);

    it("keeps the held secret when the bucket is unchanged", () => {
      const saved = resolveArchiveChoice({ ...custom, secretAccessKey: "" }, { ...ctx, held });
      if (saved.kind !== "s3") throw new Error("expected a bucket");
      expect(saved.bucket.secretAccessKey).toBe("custom-secret");
    });

    it.each([
      ["endpoint", "https://moved.example.test"],
      ["region", "eu-south-1"],
      ["bucket", "moved-bucket"],
      ["prefix", "elsewhere"],
      ["accessKeyId", "AKIAMOVED"],
    ])("refuses an empty secret once the %s has moved", (field, value) => {
      const body = { ...custom, secretAccessKey: "", [field]: value };
      expect(refusal(() => resolveArchiveChoice(body, { ...ctx, held }))).toEqual({
        code: "backup.request_invalid",
        params: { field: "secretAccessKey" },
      });
    });

    it("refuses an empty secret for another venue's archives", () => {
      const other = { ...ctx, venueId: "d0000000-0000-4000-8000-000000000009", held };
      expect(
        refusal(() => resolveArchiveChoice({ ...custom, secretAccessKey: "" }, other)),
      ).toEqual({
        code: "backup.request_invalid",
        params: { field: "secretAccessKey" },
      });
    });

    it("refuses an empty secret once the endpoint is removed", () => {
      const body = without({ ...custom, secretAccessKey: "" }, "endpoint");
      expect(refusal(() => resolveArchiveChoice(body, { ...ctx, held })).params).toEqual({
        field: "secretAccessKey",
      });
    });
  });

  it.each([
    [null, "destination"],
    [[], "destination"],
    ["local-fs", "destination"],
    [{ kind: "google-drive" }, "destination"],
    [{ kind: "local-fs", dir: 5 }, "dir"],
    [{ kind: "local-fs", dir: ["/a"] }, "dir"],
    [{ kind: "local-fs", dir: "/a", extra: 1 }, "destination"],
    [{ kind: "stream-bucket", prefix: "x" }, "destination"],
    [{ ...custom, region: 1 }, "region"],
    [{ ...custom, bucket: null }, "bucket"],
    [{ ...custom, accessKeyId: ["AKIA"] }, "accessKeyId"],
    [{ ...custom, secretAccessKey: 12 }, "secretAccessKey"],
    [{ ...custom, unexpected: "x" }, "destination"],
  ])("refuses %j naming %s", (body, field) => {
    expect(refusal(() => resolveArchiveChoice(body, ctx))).toEqual({
      code: "backup.request_invalid",
      params: { field },
    });
  });
});

describe("parseArchiveSettings", () => {
  const local = { kind: "local-fs" as const, id: "primary", dir: "/var/backups" };
  const bucket = resolveArchiveChoice(custom, { venueId: VENUE, stream: null, held: null });
  const valid = settingsWith([local, bucket]);

  it("reads back what it was given", () => {
    expect(parseArchiveSettings(JSON.stringify(valid))).toEqual(valid);
  });

  it("reads a wall-clock schedule", () => {
    const s = {
      ...valid,
      schedule: { kind: "wall-clock", days: [1, 3], at: { hour: 2, minute: 30 } },
    };
    expect(parseArchiveSettings(JSON.stringify(s))).toEqual(s);
  });

  const tampered: [string, (s: Record<string, unknown>) => unknown][] = [
    ["an extra key", (s) => ({ ...s, extra: 1 })],
    ["a missing key", (s) => without(s, "enabled")],
    ["enabled as a string", (s) => ({ ...s, enabled: "true" })],
    ["a non-UUID revision", (s) => ({ ...s, revision: "1" })],
    ["no destinations", (s) => ({ ...s, destinations: [] })],
    ["destinations as an object", (s) => ({ ...s, destinations: {} })],
    ["a null destination", (s) => ({ ...s, destinations: [null] })],
    ["duplicate ids", (s) => ({ ...s, destinations: [local, { ...local, dir: "/other" }] })],
    ["two buckets", (s) => ({ ...s, destinations: [bucket, { ...bucket, id: "second" }] })],
    [
      "two ids sharing one folder",
      (s) => ({ ...s, destinations: [local, { ...local, id: "second" }] }),
    ],
    ["a relative dir", (s) => ({ ...s, destinations: [{ ...local, dir: "rel" }] })],
    [
      "a bucket with an extra key",
      (s) => ({
        ...s,
        destinations: [{ ...bucket, bucket: { ...(bucket as { bucket: object }).bucket, x: "y" } }],
      }),
    ],
    [
      "a bucket with a number region",
      (s) => ({
        ...s,
        destinations: [
          { ...bucket, bucket: { ...(bucket as { bucket: object }).bucket, region: 1 } },
        ],
      }),
    ],
    ["a bad venue id", (s) => ({ ...s, destinations: [{ ...bucket, venueId: "a/b" }] })],
    ["schedule null", (s) => ({ ...s, schedule: null })],
    ["schedule an array", (s) => ({ ...s, schedule: [] })],
    ["an interval of zero", (s) => ({ ...s, schedule: { kind: "interval", ms: 0 } })],
    ["an interval as a string", (s) => ({ ...s, schedule: { kind: "interval", ms: "1000" } })],
    [
      "a weekday of 7",
      (s) => ({
        ...s,
        schedule: { kind: "wall-clock", days: [7], at: "auto" },
      }),
    ],
    [
      "an hour of 24",
      (s) => ({
        ...s,
        schedule: { kind: "wall-clock", days: "daily", at: { hour: 24, minute: 0 } },
      }),
    ],
    ["a retention count of zero", (s) => ({ ...s, retention: { count: 0, days: 30 } })],
    ["a fractional retention", (s) => ({ ...s, retention: { count: 1.5, days: 30 } })],
    ["a timeout under 30 s", (s) => ({ ...s, destinationTimeoutMs: 29_999 })],
    ["a timeout over 24 h", (s) => ({ ...s, destinationTimeoutMs: 86_400_001 })],
  ];

  it.each(tampered)("refuses %s with the domain code", (_name, tamper) => {
    const json = JSON.stringify(tamper(valid as unknown as Record<string, unknown>));
    const { code, params } = refusal(() => parseArchiveSettings(json));
    expect(code).toBe("backup.archive_settings_invalid");
    expect(JSON.stringify(params)).not.toContain("custom-secret");
  });

  const storedBucket = (bucket as { bucket: Record<string, unknown> }).bucket;
  it.each([
    ["an endpoint that is not a URL", { endpoint: "not a url" }],
    ["an ftp endpoint", { endpoint: "ftp://s3.example.test" }],
    ["an upper-case bucket name", { bucket: "UP_PER" }],
    ["a prefix with outer spaces", { prefix: " sp " }],
  ])("refuses a stored bucket with %s as the request path would", (_name, change) => {
    const s = { ...valid, destinations: [{ ...bucket, bucket: { ...storedBucket, ...change } }] };
    expect(refusal(() => parseArchiveSettings(JSON.stringify(s)))).toEqual({
      code: "backup.archive_settings_invalid",
      params: { reason: "bucket" },
    });
  });

  it.each(["/a/../b", "/var/backups/", "/a//b", "/a/./b"])(
    "refuses a stored folder %j that is not already resolved",
    (dir) => {
      const s = { ...valid, destinations: [{ ...local, dir }] };
      expect(refusal(() => parseArchiveSettings(JSON.stringify(s)))).toEqual({
        code: "backup.archive_settings_invalid",
        params: { reason: "destination" },
      });
    },
  );

  it("refuses one folder stored twice with and without a trailing slash", () => {
    const s = { ...valid, destinations: [local, { ...local, id: "second", dir: "/var/backups/" }] };
    expect(refusal(() => parseArchiveSettings(JSON.stringify(s))).code).toBe(
      "backup.archive_settings_invalid",
    );
  });

  it("refuses text that is not JSON", () => {
    expect(refusal(() => parseArchiveSettings("{not json")).code).toBe(
      "backup.archive_settings_invalid",
    );
  });
});

describe("stored archive settings", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });
  const bucket = resolveArchiveChoice(custom, { venueId: VENUE, stream: null, held: null });
  const input = without(settingsWith([bucket]), "revision");

  it("reads nothing before anything is stored", async () => {
    expect(await readArchiveSettings(suite.db, ring)).toBeNull();
  });

  it("mints a new revision on every write and reads back the latest", async () => {
    const first = await withTransaction(suite.db, (tx) => writeArchiveSettings(tx, ring, input));
    const second = await withTransaction(suite.db, (tx) => writeArchiveSettings(tx, ring, input));
    expect(second.revision).not.toBe(first.revision);
    expect(second).toEqual({ ...input, revision: second.revision });
    expect(await readArchiveSettings(suite.db, ring)).toEqual(second);
  });

  it("refuses to store settings that do not validate", async () => {
    await expect(
      withTransaction(suite.db, (tx) =>
        writeArchiveSettings(tx, ring, { ...input, destinations: [] }),
      ),
    ).rejects.toSatisfy(isSettingsInvalid);
    expect(await readArchiveSettings(suite.db, ring)).toBeNull();
  });

  it("refuses a tampered stored record with the domain code", async () => {
    const written = await withTransaction(suite.db, (tx) => writeArchiveSettings(tx, ring, input));
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        purpose: ARCHIVE_PURPOSE,
        value: { settings: JSON.stringify({ ...written, enabled: 1 }) },
      }),
    );
    await expect(readArchiveSettings(suite.db, ring)).rejects.toSatisfy(isSettingsInvalid);
  });
});
