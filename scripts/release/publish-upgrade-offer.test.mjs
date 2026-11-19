import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { selectUpgradeOffer, signReleaseList } from "../box/release-list.mjs";
import { main, publishUpgradeOffer } from "./publish-upgrade-offer.mjs";

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

function signedRelease(tag, metadata = {}) {
  const signed = signReleaseList(
    {
      format: 1,
      kind: "release",
      version: metadata.signedVersion ?? tag.slice(1),
      prerelease: metadata.signedPrerelease ?? false,
      sourceSha: metadata.signedSha ?? sourceSha,
      platform: "linux/amd64",
      images: {
        app: `sha256:${"a".repeat(64)}`,
        printAgent: `sha256:${"b".repeat(64)}`,
        tunnel: `sha256:${"c".repeat(64)}`,
      },
    },
    privateKey,
  );
  return metadata.signedPadding
    ? Buffer.concat([signed, Buffer.alloc(metadata.signedPadding, " ")])
    : signed;
}

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
      return signedRelease(tag, metadata);
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
      attempt: 1,
      input,
      privateKey,
      keys,
      ...overrides,
    },
    repository.run,
  );
}

describe("publish a signed upgrade offer", () => {
  it("refuses an old rerun after a pause is removed", () => {
    const scratch = mkdtempSync(join(tmpdir(), "publish-offer-test-"));
    try {
      const keyDir = join(scratch, "deploy/box/release-keys");
      mkdirSync(keyDir, { recursive: true });
      writeFileSync(join(keyDir, "current.pem"), publicKey);
      writeFileSync(join(keyDir, "spare.pem"), spare);
      writeFileSync(join(scratch, "waitron-release.json"), signedRelease(dispatchTag));
      writeFileSync(
        join(scratch, "gh"),
        `#!/usr/bin/env node
const { copyFileSync, readFileSync } = require("node:fs");
if (process.env.WAITRON_RELEASE_SIGNING_KEY || process.env.GH_TOKEN !== "stand-in-token") process.exit(2);
const [resource, action, tag, ...flags] = process.argv.slice(2);
if (resource !== "release") process.exit(3);
if (action === "view") console.log(JSON.stringify({ tagName: tag, isDraft: false, assets: [], isPrerelease: false }));
else if (action === "download") process.stdout.write(readFileSync(flags[1]));
else if (action === "upload" && tag === "upgrade-offer") copyFileSync(flags[0], "waitron-offer.json");
else process.exit(4);
`,
        { mode: 0o700 },
      );
      const env = {
        PATH: scratch + delimiter + process.env.PATH,
        GITHUB_REF: `refs/tags/${dispatchTag}`,
        GITHUB_SHA: sourceSha,
        GITHUB_RUN_NUMBER: "9",
        GITHUB_RUN_ID: "800001",
        GITHUB_RUN_ATTEMPT: "1",
        OFFER_INPUT: JSON.stringify(pause),
        GH_TOKEN: "stand-in-token",
        WAITRON_RELEASE_SIGNING_KEY: privateKey,
      };
      const logger = { log: vi.fn(), error: vi.fn() };
      expect(main(env, scratch, logger)).toBe(0);
      const path = join(scratch, offerName);
      const box = { boxId: "pilot-box", installedVersion: "1.2.0" };
      expect(selectUpgradeOffer(readFileSync(path), keys, box)).toMatchObject({
        serial: 9,
        version: null,
      });

      unlinkSync(path);
      const rerun = {
        ...env,
        GITHUB_RUN_NUMBER: "3",
        GITHUB_RUN_ATTEMPT: "2",
        OFFER_INPUT: JSON.stringify({ ...pause, default: "1.4.0" }),
      };
      expect(main(rerun, scratch, logger)).toBe(1);
      expect(existsSync(path)).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/dispatch a new run/i));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("reports a missing signing secret before loading keys", () => {
    const logger = { log: vi.fn(), error: vi.fn() };
    expect(main({}, "/missing-keys", logger)).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/release environment signing secret/i),
    );
  });

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
    [{ ...offer, serial: 1 }, /format, entries and default/i],
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

  it("refuses to publish when the signing secret matches neither trusted key", () => {
    const repository = github();
    const otherKey = generateKeyPairSync("ed25519").privateKey.export({
      type: "pkcs8",
      format: "pem",
    });
    expect(() => dispatch(repository, pause, { privateKey: otherKey })).toThrow(
      /invalid release signature/i,
    );
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
    expect(dispatch(repository, pause, { serial: 8, attempt: 2 })).toBe(8);
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
