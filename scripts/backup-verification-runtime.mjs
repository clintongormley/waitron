import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { readBuildHourRelease } from "./generate-hour-release.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const sha = (value) => createHash("sha256").update(value).digest("hex");

export function backupVerificationRuntime({ source, release, lockfileDigest, descriptorBytes }) {
  if (
    typeof source !== "string" ||
    !/^[a-f0-9]{40}$/.test(source) ||
    typeof release !== "string" ||
    !/^[!-~]{1,256}$/.test(release) ||
    typeof lockfileDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(lockfileDigest) ||
    !(descriptorBytes instanceof Uint8Array)
  )
    throw new Error("Invalid backup verification build provenance");
  return Object.freeze({
    release,
    revision: source,
    fingerprint: sha(JSON.stringify([1, source, release, lockfileDigest, sha(descriptorBytes)])),
  });
}

export function readBuildBackupVerificationRuntime({
  cwd = ROOT,
  release = readBuildHourRelease({ cwd }),
} = {}) {
  const target = join(cwd, "apps/server/src/backup-verification-target.ts");
  if (release === null || !existsSync(target) || !existsSync(join(cwd, "pnpm-lock.yaml")))
    return null;
  const descriptor = execFileSync(
    process.execPath,
    [
      "--import",
      join(cwd, "apps/server/node_modules/tsx/dist/loader.mjs"),
      "--input-type=module",
      "-e",
      `
import { ALL_MODULES } from ${JSON.stringify(pathToFileURL(join(cwd, "packages/composition/src/index.ts")).href)};
import { buildBackupVerificationTarget } from ${JSON.stringify(pathToFileURL(target).href)};
const target = buildBackupVerificationTarget({modules: ALL_MODULES, migrationsRoot: null, runtime: { release: 'pre-runtime', revision: '${"0".repeat(40)}', fingerprint: '${"0".repeat(64)}' }});
process.stdout.write(JSON.stringify([target.version,target.modules,target.compositionDigest,target.migrationDigest,target.policyDigest]));
  `,
    ],
    {
      cwd,
      encoding: "buffer",
      timeout: 60_000,
      maxBuffer: 1_048_576,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
      ),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return backupVerificationRuntime({
    source: release.sourceCommit,
    release: `waitron-${release.sourceCommit}`,
    lockfileDigest: sha(readFileSync(join(cwd, "pnpm-lock.yaml"))),
    descriptorBytes: descriptor,
  });
}
