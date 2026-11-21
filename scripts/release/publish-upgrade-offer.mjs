import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isStableVersion,
  signUpgradeOffer,
  verifyReleaseList,
  verifyUpgradeOffer,
} from "../box/release-list.mjs";
import { exactRecord } from "../box/upgrades/contracts.mjs";

const OFFER_TAG = "upgrade-offer";
const OFFER_ASSET = "waitron-offer.json";

function publishedRelease(gh, tag) {
  const json = gh("release", "view", tag, "--json", "tagName,isDraft,isPrerelease,assets");
  const release = JSON.parse(json);
  if (release.tagName !== tag || release.isDraft !== false || !Array.isArray(release.assets))
    throw new Error(`Expected a published release for ${tag}`);
  return release;
}

function download(gh, tag, name) {
  return gh("release", "download", tag, "--pattern", name, "--output", "-");
}

export function publishUpgradeOffer({ ref, sha, serial, attempt, input, privateKey, keys }, gh) {
  const dispatchVersion = ref?.startsWith("refs/tags/v") ? ref.slice("refs/tags/v".length) : null;
  if (!isStableVersion(dispatchVersion))
    throw new Error("Dispatch from a stable numbered release tag");
  if (!exactRecord(input, ["format", "entries", "default"]))
    throw new Error("Expected upgrade offer input with format, entries and default");

  const bytes = signUpgradeOffer({ ...input, kind: "offer", serial }, privateKey);
  const offer = verifyUpgradeOffer(bytes, keys);
  const targets = new Set([offer.default, ...offer.entries.map(({ target }) => target)]);
  targets.delete("none");

  for (const version of new Set([dispatchVersion, ...targets])) {
    const tag = `v${version}`;
    const release = publishedRelease(gh, tag);
    const signed = verifyReleaseList(download(gh, tag, "waitron-release.json"), keys);
    if (signed.version !== version) throw new Error(`The signed release does not match ${tag}`);
    if (version === dispatchVersion && signed.sourceSha !== sha)
      throw new Error("The signed release does not match the dispatch commit");
    if (targets.has(version) && (release.isPrerelease !== false || signed.prerelease))
      throw new Error(`An automatic upgrade cannot target prerelease ${tag}`);
  }

  const exists = publishedRelease(gh, OFFER_TAG).assets.some(({ name }) => name === OFFER_ASSET);
  if (!exists && attempt !== 1) throw new Error("Dispatch a new run to publish a missing offer");
  if (exists) {
    const previous = download(gh, OFFER_TAG, OFFER_ASSET);
    const accepted = verifyUpgradeOffer(previous, keys);
    if (serial === accepted.serial && bytes.equals(previous)) return serial;
    if (serial <= accepted.serial)
      throw new Error("The offer serial was already used or superseded");
  }

  const directory = mkdtempSync(join(tmpdir(), "waitron-offer-"));
  try {
    const path = join(directory, OFFER_ASSET);
    writeFileSync(path, bytes);
    gh("release", "upload", OFFER_TAG, path, ...(exists ? ["--clobber"] : []));
    if (!bytes.equals(download(gh, OFFER_TAG, OFFER_ASSET)))
      throw new Error("The offer read back from GitHub differs from the signed file");
    return serial;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function main(env, cwd, logger = console) {
  const { WAITRON_RELEASE_SIGNING_KEY: privateKey, ...ghEnv } = env;
  try {
    if (!privateKey) throw new Error("Set the release environment signing secret first");
    const keys = ["current.pem", "spare.pem"].map((name) =>
      readFileSync(join(cwd, "deploy/box/release-keys", name), "utf8"),
    );
    const serial = publishUpgradeOffer(
      {
        ref: env.GITHUB_REF,
        sha: env.GITHUB_SHA,
        serial: Number(env.GITHUB_RUN_NUMBER),
        attempt: Number(env.GITHUB_RUN_ATTEMPT),
        input: JSON.parse(env.OFFER_INPUT),
        privateKey,
        keys,
      },
      (...args) =>
        execFileSync("gh", args, { cwd, env: ghEnv, stdio: ["ignore", "pipe", "inherit"] }),
    );
    logger.log(`Verified upgrade offer serial ${serial} on GitHub.`);
    return 0;
  } catch (error) {
    logger.error(`Could not publish the upgrade offer. ${error.message}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = main(process.env, process.cwd());
