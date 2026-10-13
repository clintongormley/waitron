import { describe, expect, it } from "vitest";
import {
  ARCHIVE_PACK_PREFIX,
  decodeArchiveRecoveryPack,
  encodeArchiveRecoveryPack,
  type ArchiveRecoveryPack,
} from "./archive-recovery-pack.js";

const SECRET = "secret-access-key-value";
const RECOVERY = "recovery-key-value";

function pack(): ArchiveRecoveryPack {
  return {
    version: 1,
    format: "WBK1",
    venueId: "venue-1",
    bucket: {
      endpoint: "https://s3.example.test",
      region: "eu-west-1",
      bucket: "owner-bucket",
      prefix: "waitron",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: SECRET,
    },
    archivePrefix: "waitron/archives/venue-1/",
    recoveryKey: RECOVERY,
  };
}

function token(value: unknown): string {
  return ARCHIVE_PACK_PREFIX + Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function without(value: ArchiveRecoveryPack, key: keyof ArchiveRecoveryPack): unknown {
  const copy: Partial<ArchiveRecoveryPack> = { ...value };
  delete copy[key];
  return copy;
}

function refusal(run: () => unknown): { code: string; message: string; params: unknown } {
  try {
    run();
  } catch (error) {
    return error as { code: string; message: string; params: unknown };
  }
  throw new Error("expected a refusal");
}

function expectRefused(run: () => unknown, reason: "not_found" | "encoding" | "shape") {
  const error = refusal(run);
  expect(error).toMatchObject({ code: "backup.archive_pack_invalid", params: { reason } });
  const shown = `${error.message} ${JSON.stringify(error.params)}`;
  expect(shown).not.toContain(SECRET);
  expect(shown).not.toContain(RECOVERY);
}

describe("archive recovery pack", () => {
  it("round-trips through the downloadable file", () => {
    const file = encodeArchiveRecoveryPack(pack());
    expect(decodeArchiveRecoveryPack(file)).toEqual(pack());
  });

  it("writes explanatory lines and the token on its own line", () => {
    const lines = encodeArchiveRecoveryPack(pack()).trimEnd().split("\n");
    const tokenLine = lines.find((line) => line.startsWith(ARCHIVE_PACK_PREFIX));
    expect(tokenLine).toBe(token(pack()));
    const prose = lines.filter((line) => line !== tokenLine).join("\n");
    expect(prose).toContain("waitron-restore restore --from-archive");
    expect(prose).toContain("--archive-key");
    expect(prose).not.toContain(SECRET);
    expect(prose).not.toContain(RECOVERY);
  });

  it("decodes the bare token", () => {
    expect(decodeArchiveRecoveryPack(token(pack()))).toEqual(pack());
  });

  it("decodes a pack at the bucket root with no endpoint", () => {
    const bucket: Partial<ArchiveRecoveryPack["bucket"]> = { ...pack().bucket };
    delete bucket.endpoint;
    const root = {
      ...pack(),
      bucket: { ...bucket, prefix: "" },
      archivePrefix: "archives/venue-1/",
    };
    expect(decodeArchiveRecoveryPack(token(root))).toEqual(root);
  });

  // An archive Save and the environment's destinations both accept a folder of "-".
  it("round-trips a pack whose selected folder is a hyphen", () => {
    const hyphen = {
      ...pack(),
      bucket: { ...pack().bucket, prefix: "-" },
      archivePrefix: "-/archives/venue-1/",
    };
    expect(decodeArchiveRecoveryPack(encodeArchiveRecoveryPack(hyphen))).toEqual(hyphen);
  });

  it.each([
    ["a C1 control character", "valid-recovery-\u0085-key-value"],
    ["a C0 control character", "valid-recovery-\u0007-key-value"],
  ])("round-trips a recovery key holding %s byte for byte", (_label, recoveryKey) => {
    const decoded = decodeArchiveRecoveryPack(
      encodeArchiveRecoveryPack({ ...pack(), recoveryKey }),
    );
    expect(Buffer.from(decoded.recoveryKey, "utf8")).toEqual(Buffer.from(recoveryKey, "utf8"));
  });

  it("refuses a file holding two packs", () => {
    const other: ArchiveRecoveryPack = {
      ...pack(),
      venueId: "venue-2",
      archivePrefix: "waitron/archives/venue-2/",
    };
    const text = encodeArchiveRecoveryPack(pack()) + encodeArchiveRecoveryPack(other);
    expectRefused(() => decodeArchiveRecoveryPack(text), "shape");
  });

  it("refuses text holding no token", () => {
    expectRefused(() => decodeArchiveRecoveryPack("just some words"), "not_found");
  });

  it("refuses a token that is not base64url JSON", () => {
    expectRefused(() => decodeArchiveRecoveryPack(`${ARCHIVE_PACK_PREFIX}!!!not-json`), "encoding");
  });

  it("refuses a valid token followed by characters outside base64url", () => {
    expectRefused(() => decodeArchiveRecoveryPack(`${token(pack())}!!!***`), "encoding");
  });

  it.each<[string, unknown]>([
    ["an extra key", { ...pack(), extra: true }],
    ["a missing key", without(pack(), "format")],
    ["the wrong version", { ...pack(), version: 2 }],
    ["the wrong format", { ...pack(), format: "WBK2" }],
    ["an archive prefix outside the namespace", { ...pack(), archivePrefix: "elsewhere/" }],
    [
      "a venue id with a slash",
      { ...pack(), venueId: "a/b", archivePrefix: "waitron/archives/a/b/" },
    ],
    [
      "a parent step in the selected prefix",
      {
        ...pack(),
        bucket: { ...pack().bucket, prefix: "a/../b" },
        archivePrefix: "a/../b/archives/venue-1/",
      },
    ],
    ["a null bucket", { ...pack(), bucket: null }],
    ["an extra bucket key", { ...pack(), bucket: { ...pack().bucket, extra: "x" } }],
    [
      "a bucket missing its secret",
      { ...pack(), bucket: { ...pack().bucket, secretAccessKey: "" } },
    ],
    ["an empty endpoint", { ...pack(), bucket: { ...pack().bucket, endpoint: "" } }],
    ["an empty recovery key", { ...pack(), recoveryKey: "" }],
    ["a recovery key under the length floor", { ...pack(), recoveryKey: "eleven-char" }],
    ["a recovery key that is not text", { ...pack(), recoveryKey: 7 }],
    ["a non-text venue id", { ...pack(), venueId: 7 }],
    ["an array", [pack()]],
    ["null", null],
  ])("refuses %s", (_label, value) => {
    expectRefused(() => decodeArchiveRecoveryPack(token(value)), "shape");
  });

  it("refuses to encode a pack it could not decode", () => {
    expectRefused(
      () => encodeArchiveRecoveryPack({ ...pack(), archivePrefix: "elsewhere/" }),
      "shape",
    );
  });
});
