import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { signReleaseList, verifyReleaseList } from "../box/release-list.mjs";

function readKey(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function writeReleaseList(keysDir, output, env) {
  const privateKey = env.WAITRON_RELEASE_SIGNING_KEY;
  const current = readKey(join(keysDir, "current.pem"));
  const spare = readKey(join(keysDir, "spare.pem"));
  if (!privateKey && current === undefined && spare === undefined) {
    console.log("Release signing is not configured.");
    return;
  }
  if (!privateKey || !current || !spare)
    throw new Error("Set the release signing secret and commit both trusted public keys.");

  const bytes = signReleaseList(
    {
      format: 1,
      kind: "release",
      version: env.RELEASE_VERSION,
      prerelease: false,
      sourceSha: env.RELEASE_SOURCE_SHA,
      platform: "linux/amd64",
      images: { app: env.RELEASE_APP_DIGEST, printAgent: env.RELEASE_PRINT_AGENT_DIGEST },
    },
    privateKey,
  );
  verifyReleaseList(bytes, [current, spare]);
  writeFileSync(output, bytes, { flag: "wx" });
}

try {
  writeReleaseList(process.argv[2], process.argv[3], process.env);
} catch {
  console.error(
    "Could not sign the release. Check the release inputs, signing secret and both public keys.",
  );
  process.exitCode = 1;
}
