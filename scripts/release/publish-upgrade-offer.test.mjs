import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { selectUpgradeOffer, signReleaseList } from "../box/release-list.mjs";
import { publishUpgradeOffer } from "./publish-upgrade-offer.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
});
const spare = generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" });
const keys = [publicKey, spare];
const offerTag = "upgrade-offer";
const offerName = "waitron-offer.json";
const dispatchTag = "v1.4.0";
const sourceSha = "a".repeat(40);
const groups = [{ condition: { installations: ["pilot-box"] }, target: "1.4.0" }];
const offer = { format: 1, entries: groups, default: "1.3.0" };
const pause = { format: 1, entries: [], default: "none" };

function github({ existing, releases = {}, badDownload, badReadback = false } = {}) {
  let published = existing;
  const uploads = [];

  function run(...args) {
    const [release, operation, tag, ...flags] = args;
    expect(release).toBe("release");
    const metadata = { tagName: tag, isDraft: false, isPrerelease: false, ...releases[tag] };
    if (operation === "view") {
      expect(flags).toEqual(["--json", "tagName,isDraft,isPrerelease,assets"]);
      const name = tag === offerTag ? offerName : "waitron-release.json";
      const assets = tag === offerTag && !published ? [] : [{ name }];
      return Buffer.from(JSON.stringify({ assets, ...metadata }));
    }
    if (operation === "download") {
      if (tag === badDownload) throw new Error("GitHub read failed");
      expect(flags).toEqual([
        "--pattern",
        tag === offerTag ? offerName : "waitron-release.json",
        "--output",
        "-",
      ]);
      if (tag === offerTag) {
        expect(published).toBeDefined();
        return badReadback && uploads.length
          ? Buffer.concat([published, Buffer.from(" ")])
          : published;
      }
      const signed = signReleaseList(
        {
          format: 1,
          kind: "release",
          version: metadata.signedVersion ?? tag.slice(1),
          prerelease: metadata.signedPrerelease ?? false,
          sourceSha: metadata.signedSha ?? sourceSha,
          platform: "linux/amd64",
          images: { app: `sha256:${"a".repeat(64)}`, printAgent: `sha256:${"b".repeat(64)}` },
        },
        privateKey,
      );
      return metadata.signedPadding
        ? Buffer.concat([signed, Buffer.alloc(metadata.signedPadding, " ")])
        : signed;
    }
    expect([operation, tag, basename(flags[0])]).toEqual(["upload", offerTag, offerName]);
    expect(flags.slice(1)).toEqual(published ? ["--clobber"] : []);
    published = readFileSync(flags[0]);
    uploads.push(published);
  }

  return { run, uploads };
}

function dispatch(repository, input = offer, overrides = {}) {
  return publishUpgradeOffer(
    {
      ref: `refs/tags/${dispatchTag}`,
      sha: sourceSha,
      serial: 7,
      input,
      privateKey,
      keys,
      ...overrides,
    },
    repository.run,
  );
}

describe("publish a signed upgrade offer", () => {
  it("uploads the offer once and boxes can verify the group version and older default", () => {
    const repository = github();
    expect(dispatch(repository)).toBe(7);
    expect(repository.uploads).toHaveLength(1);
    const [bytes] = repository.uploads;
    expect(
      selectUpgradeOffer(bytes, keys, { boxId: "pilot-box", installedVersion: "1.2.0" }).version,
    ).toBe("1.4.0");
    expect(
      selectUpgradeOffer(bytes, keys, { boxId: "other-box", installedVersion: "1.2.0" }).version,
    ).toBe("1.3.0");
  });

  it.each([
    [{ ...offer, format: 2 }, /upgrade offer/i],
    [{ ...offer, entries: [{ condition: { all: true }, target: "1.4.0" }] }, /condition/i],
    [
      {
        ...offer,
        entries: [{ condition: { installations: ["a".repeat(16_384)] }, target: "none" }],
      },
      /16 KiB/,
    ],
  ])("refuses unsupported or oversized input before upload (%#)", (input, error) => {
    const repository = github();
    expect(() => dispatch(repository, input)).toThrow(error);
    expect(repository.uploads).toHaveLength(0);
  });

  it.each([
    ["refs/heads/v1.4.0", /numbered release tag/],
    ["refs/tags/v1.4.x", /numbered release tag/],
  ])("refuses dispatch from %s", (ref, error) => {
    const repository = github();
    expect(() => dispatch(repository, pause, { ref })).toThrow(error);
    expect(repository.uploads).toHaveLength(0);
  });

  it("checks that even a pause is dispatched from the commit named in the signed release", () => {
    const repository = github({ releases: { [dispatchTag]: { signedSha: "b".repeat(40) } } });
    expect(() => dispatch(repository, pause)).toThrow(/signed release.*commit/i);
    expect(repository.uploads).toHaveLength(0);
  });

  it.each([
    [{ isDraft: true }, /published release/i],
    [{ isPrerelease: true }, /prerelease/i],
    [{ signedPrerelease: true }, /prerelease/i],
    [{ signedVersion: "1.2.0" }, /signed release/i],
    [{ signedPadding: 16_384 }, /16 KiB/],
  ])("refuses an ineligible target before upload (%#)", (metadata, error) => {
    const repository = github({ releases: { "v1.3.0": metadata } });
    expect(() => dispatch(repository)).toThrow(error);
    expect(repository.uploads).toHaveLength(0);
  });

  it("reads back the exact bytes even when the changed bytes still verify", () => {
    const repository = github({ badReadback: true });
    expect(() => dispatch(repository)).toThrow(/read back/i);
    expect(repository.uploads).toHaveLength(1);
  });

  it("refuses to replace an asset it could not read", () => {
    const initial = github();
    dispatch(initial);
    const repository = github({ existing: initial.uploads[0], badDownload: offerTag });
    expect(() => dispatch(repository, pause, { serial: 8 })).toThrow(/read failed/i);
    expect(repository.uploads).toHaveLength(0);
  });

  it("refuses to overwrite an offer with an invalid signature", () => {
    const initial = github();
    dispatch(initial);
    const envelope = JSON.parse(initial.uploads[0]);
    envelope.signature = Buffer.alloc(64).toString("base64url");
    const repository = github({ existing: Buffer.from(JSON.stringify(envelope)) });
    expect(() => dispatch(repository, pause, { serial: 8 })).toThrow(/invalid release signature/i);
    expect(repository.uploads).toHaveLength(0);
  });

  it("replaces the offer with a higher-serial pause and never uploads a retry or stale offer", () => {
    const initial = github();
    dispatch(initial);
    const repository = github({ existing: initial.uploads[0] });

    expect(dispatch(repository, pause, { serial: 8 })).toBe(8);
    expect(dispatch(repository, pause, { serial: 8 })).toBe(8);
    expect(() => dispatch(repository, offer, { serial: 8 })).toThrow(/serial/i);
    expect(() => dispatch(repository, offer, { serial: 7 })).toThrow(/serial/i);
    expect(repository.uploads).toHaveLength(1);
    expect(
      selectUpgradeOffer(repository.uploads[0], keys, {
        boxId: "pilot-box",
        installedVersion: "1.2.0",
      }),
    ).toMatchObject({ version: null, serial: 8 });
  });
});
