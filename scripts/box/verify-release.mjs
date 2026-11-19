import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_SIGNED_RELEASE_BYTES,
  compareReleaseVersions,
  isNumberedVersion,
  verifyReleaseList,
} from "./release-list.mjs";

function versionFromTag(tag) {
  const version = typeof tag === "string" && tag.startsWith("v") ? tag.slice(1) : null;
  if (!isNumberedVersion(version)) throw new Error("Expected a numbered release tag");
  return version;
}

function requireCurrentOrNewer(candidate, installed) {
  if (compareReleaseVersions(versionFromTag(candidate), versionFromTag(installed)) < 0)
    throw new Error(`${candidate} is older than installed release ${installed}`);
}

async function readRelease(input) {
  const chunks = [];
  let size = 0;
  for await (const chunk of input) {
    size += chunk.length;
    if (size > MAX_SIGNED_RELEASE_BYTES) throw new Error("Release file exceeds 16 KiB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function readKeys(directory) {
  try {
    return ["current.pem", "spare.pem"].map((name) => readFileSync(join(directory, name), "utf8"));
  } catch {
    throw new Error("Could not read both retained release keys");
  }
}

export async function main(args, input, directory = import.meta.dirname, logger = console) {
  try {
    if (args[0] === "--check-version") {
      requireCurrentOrNewer(args[1], args[2]);
    } else {
      const tag = args[0];
      const version = versionFromTag(tag);
      const bytes = await readRelease(input);
      const release = verifyReleaseList(bytes, readKeys(directory));
      if (release.version !== version) throw new Error(`The signed version does not match ${tag}`);
      logger.log(`${release.sourceSha} ${release.images.app} ${release.images.printAgent}`);
    }
    return 0;
  } catch (error) {
    logger.error(error instanceof SyntaxError ? "Invalid release file" : error.message);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2), process.stdin);
