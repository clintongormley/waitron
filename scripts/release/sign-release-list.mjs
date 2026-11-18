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
  let next = "check that both public key files can be read";
  try {
    const privateKey = env.WAITRON_RELEASE_SIGNING_KEY;
    const current = readKey(join(keysDir, "current.pem"));
    const spare = readKey(join(keysDir, "spare.pem"));
    if (!privateKey && current === undefined && spare === undefined) {
      console.log("Release signing is not configured.");
      return;
    }
    next = "set the signing secret and both public keys";
    if (!privateKey || !current || !spare) throw new Error("Incomplete signing configuration");

    next = "check the key format or release inputs";
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
    next = "verify with the trusted public keys and check that they are distinct";
    verifyReleaseList(bytes, [current, spare]);
    next = "check that the output path is writable and unused";
    writeFileSync(output, bytes, { flag: "wx" });
  } catch {
    console.error(`Could not sign the release. Please ${next}.`);
    process.exitCode = 1;
  }
}

writeReleaseList(process.argv[2], process.argv[3], process.env);
