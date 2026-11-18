import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signReleaseList, verifyReleaseList } from "./release-list.mjs";

const keyPair = () =>
  generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
const current = keyPair();
const spare = keyPair();
const trusted = [current.publicKey, spare.publicKey];
const release = {
  format: 1,
  kind: "release",
  version: "1.2.3",
  prerelease: false,
  sourceSha: "c".repeat(40),
  platform: "linux/amd64",
  images: { app: "sha256:" + "a".repeat(64), printAgent: "sha256:" + "b".repeat(64) },
};

function envelope(payload, privateKey = current.privateKey) {
  const bytes = Buffer.from(payload);
  return {
    payload: bytes.toString("base64url"),
    signature: sign(null, bytes, privateKey).toString("base64url"),
  };
}

describe("the signed release file", () => {
  it.each([current, spare])("verifies a file signed with either trusted key", ({ privateKey }) => {
    const bytes = signReleaseList(release, privateKey);
    expect(verifyReleaseList(bytes, trusted)).toEqual(release);
  });

  it("counts equivalent PEM encodings as one trusted key", () => {
    const bytes = signReleaseList(release, current.privateKey);
    const crlf = current.publicKey.replaceAll("\n", "\r\n");
    expect(verifyReleaseList(bytes, [crlf])).toEqual(release);
    expect(() => verifyReleaseList(bytes, [current.publicKey, crlf])).toThrow(/distinct/i);
  });

  it("uses only Ed25519 keys", () => {
    const ec = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const bytes = signReleaseList(release, current.privateKey);
    expect(() => signReleaseList(release, ec.privateKey)).toThrow(/Ed25519/i);
    expect(() => verifyReleaseList(bytes, [ec.publicKey])).toThrow(/Ed25519/i);
  });

  it("refuses non-object release data and a public key in the signing slot", () => {
    expect(() => signReleaseList(null, current.privateKey)).toThrow(/payload/i);
    expect(() => signReleaseList(release, current.publicKey)).toThrow(/PKCS#8/i);
  });

  it("writes identical bytes for the same release and key", () => {
    const { images, ...rest } = release;
    expect(
      signReleaseList(
        { images: { printAgent: images.printAgent, app: images.app }, ...rest },
        current.privateKey,
      ),
    ).toEqual(signReleaseList(release, current.privateKey));
  });

  it("accepts a signature over the exact bytes even when the JSON has whitespace", () => {
    const signed = envelope(JSON.stringify(release, null, 2));
    expect(verifyReleaseList(Buffer.from(JSON.stringify(signed)), trusted)).toEqual(release);
  });

  it("refuses a signature made with a different key", () => {
    const foreign = signReleaseList(release, keyPair().privateKey);
    expect(() => verifyReleaseList(foreign, trusted)).toThrow(/signature/i);
  });

  it("refuses a valid release payload substituted under the original signature", () => {
    const signed = envelope(JSON.stringify(release));
    signed.payload = Buffer.from(JSON.stringify({ ...release, version: "1.2.4" })).toString(
      "base64url",
    );
    expect(() => verifyReleaseList(Buffer.from(JSON.stringify(signed)), trusted)).toThrow(
      /signature/i,
    );
  });

  it.each([
    { format: 2 },
    { kind: "rollout" },
    { version: "1.2.3-rc.1" },
    { prerelease: "false" },
    { sourceSha: "main" },
    { platform: "linux/arm64" },
    { images: { app: release.images.app } },
    { images: { ...release.images, printAgent: "latest" } },
    { images: { ...release.images, printAgent: release.images.app } },
  ])("refuses signed bytes with an invalid release field (%j)", (change) => {
    const invalid = { ...release, ...change };
    const signed = envelope(JSON.stringify(invalid));
    expect(() => verifyReleaseList(Buffer.from(JSON.stringify(signed)), trusted)).toThrow(
      /payload/i,
    );
    expect(() => signReleaseList(invalid, current.privateKey)).toThrow(/payload/i);
  });

  it.each([{}, { payload: "", signature: "" }])(
    "refuses a missing envelope field (%j)",
    (invalid) => {
      expect(() => verifyReleaseList(Buffer.from(JSON.stringify(invalid)), trusted)).toThrow(
        /envelope/i,
      );
    },
  );

  it("refuses a malformed encoding before attempting signature verification", () => {
    const signed = envelope(JSON.stringify(release));
    signed.signature += "=";
    expect(() => verifyReleaseList(Buffer.from(JSON.stringify(signed)), trusted)).toThrow(
      /envelope/i,
    );
  });
});
