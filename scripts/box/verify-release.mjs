import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyReleaseList } from "./release-list.mjs";

const MAX_BYTES = 16 * 1024;
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function releaseNumbers(tag) {
  const match = typeof tag === "string" && tag.length <= 51 && TAG.exec(tag);
  if (!match) throw new Error("Expected a numbered release tag");
  return match.slice(1).map(BigInt);
}

function requireCurrentOrNewer(candidate, installed) {
  const requested = releaseNumbers(candidate);
  const current = releaseNumbers(installed);
  for (const [index, part] of requested.entries()) {
    if (part < current[index])
      throw new Error(`${candidate} is older than installed release ${installed}`);
    if (part > current[index]) return;
  }
}

async function readRelease(input) {
  const chunks = [];
  let size = 0;
  for await (const chunk of input) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("Release file exceeds 16 KiB");
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
      releaseNumbers(tag);
      const bytes = await readRelease(input);
      const release = verifyReleaseList(bytes, readKeys(directory));
      if (`v${release.version}` !== tag)
        throw new Error(`The signed version does not match ${tag}`);
      logger.log(`${release.sourceSha} ${release.images.app} ${release.images.printAgent}`);
    }
    return 0;
  } catch (error) {
    logger.error(error instanceof SyntaxError ? "Invalid release file" : error.message);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2), process.stdin);
