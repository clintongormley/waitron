import { Buffer } from "node:buffer";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { selectUpgradeOffer, signReleaseList, verifyReleaseList } from "./release-list.mjs";

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

const offer = {
  format: 1,
  kind: "offer",
  serial: 7,
  entries: [],
  default: "1.10.0",
};

function signedOffer(changes, key) {
  return Buffer.from(
    JSON.stringify(envelope(JSON.stringify({ ...offer, ...changes }), key)) + "\n",
  );
}

function select(bytes, changes) {
  return selectUpgradeOffer(bytes, trusted, {
    boxId: "box-a",
    installedVersion: "1.9.0",
    previous: null,
    ...changes,
  });
}

describe("a signed upgrade offer", () => {
  it("chooses the first matching group and offers the older default to unnamed boxes", () => {
    const bytes = signedOffer(
      {
        entries: [
          { condition: { installations: ["box-a"] }, target: "2.0.0" },
          { condition: { installations: ["box-a"] }, target: "3.0.0" },
        ],
      },
      spare.privateKey,
    );

    expect(select(bytes)).toEqual({
      version: "2.0.0",
      serial: 7,
      digest: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(select(bytes, { boxId: "unnamed" }).version).toBe("1.10.0");
  });

  it("includes the installed-version floor using numeric version order", () => {
    const bytes = signedOffer({
      entries: [{ condition: { atLeast: "1.10.0" }, target: "2.0.0" }],
      default: "1.9.9",
    });

    expect(select(bytes).version).toBe("1.9.9");
    expect(select(bytes, { installedVersion: "1.10.0" }).version).toBe("2.0.0");
  });

  it("uses a strict percentage cutoff and changes group membership with the target", () => {
    const group = (bucketBelow, target) =>
      signedOffer({ entries: [{ condition: { bucketBelow }, target }], default: "none" });

    expect(select(group(28, "2.0.0")).version).toBeNull();
    expect(select(group(29, "2.0.0")).version).toBe("2.0.0");
    expect(select(group(29, "3.0.0")).version).toBeNull();
  });

  it("keeps the group hash when pausing a percentage offer", () => {
    const bytes = signedOffer({
      entries: [{ condition: { bucketBelow: 29, bucketVersion: "2.0.0" }, target: "none" }],
    });

    expect(select(bytes).version).toBeNull();
    expect(select(bytes, { boxId: "box-b" }).version).toBe("1.10.0");
  });

  it.each(["none", "1.9.0", "1.8.0"])(
    "ends at a matching group target of %s even when the default is newer",
    (target) => {
      const bytes = signedOffer({
        entries: [{ condition: { installations: ["box-a"] }, target }],
      });
      expect(select(bytes).version).toBeNull();
    },
  );

  it("refuses older offers and conflicting same-serial offers after accepting a full pause", () => {
    const pause = signedOffer({ serial: 8, default: "none" });
    const accepted = select(pause);
    expect(accepted).toEqual({
      version: null,
      serial: 8,
      digest: createHash("sha256").update(pause).digest("hex"),
    });
    const previous = { serial: accepted.serial, digest: accepted.digest };

    expect(select(pause, { previous })).toEqual(accepted);
    expect(() => select(signedOffer(), { previous })).toThrow(/serial/i);
    expect(() => select(signedOffer({ serial: 8 }), { previous })).toThrow(/serial/i);
    expect(() => select(Buffer.concat([pause, Buffer.from(" ")]), { previous })).toThrow(/serial/i);
    expect(select(signedOffer({ serial: 9 }), { previous }).version).toBe("1.10.0");
  });

  it("refuses the whole offer if a later rule is unknown", () => {
    const bytes = signedOffer({
      entries: [
        { condition: { installations: ["box-a"] }, target: "2.0.0" },
        { condition: { futureRule: true }, target: "3.0.0" },
      ],
    });

    expect(() => select(bytes)).toThrow(/offer condition/i);
  });

  it.each([
    { format: 2 },
    { kind: "release" },
    { serial: 0 },
    { serial: 2 ** 53 },
    { default: undefined },
    { default: "1.10.0-rc.1" },
  ])("refuses malformed signed offer data (%j)", (fields) => {
    expect(() => select(signedOffer(fields))).toThrow(/offer payload/i);
  });

  it.each([
    { condition: { bucketBelow: 0 }, target: "2.0.0" },
    { condition: { bucketBelow: 100 }, target: "2.0.0" },
    { condition: { bucketBelow: 1.5 }, target: "2.0.0" },
    { condition: { bucketBelow: 30 }, target: "none" },
    { condition: { bucketBelow: 30, bucketVersion: "3.0.0" }, target: "2.0.0" },
    { condition: { installations: [1] }, target: "2.0.0" },
    { condition: { atLeast: "main" }, target: "2.0.0" },
  ])("refuses malformed group conditions (%j)", (entry) => {
    expect(() => select(signedOffer({ entries: [entry] }))).toThrow(/offer condition/i);
  });

  it("refuses offers signed by an untrusted key", () => {
    expect(() => select(signedOffer({}, keyPair().privateKey))).toThrow(/signature/i);
  });

  it("refuses a valid signed offer above 16 KiB", () => {
    const bytes = signedOffer({});
    const atLimit = Buffer.concat([bytes, Buffer.alloc(16_384 - bytes.length, " ")]);
    expect(select(atLimit).version).toBe("1.10.0");
    expect(() => select(Buffer.concat([atLimit, Buffer.from(" ")]))).toThrow(/16 KiB/);
  });
});
