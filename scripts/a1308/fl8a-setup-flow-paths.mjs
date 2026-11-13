import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const paths = new Map([
  ["first-setup.json", "flows/setup/record.json"],
  ["first-setup-node-key.json", "flows/setup/node-key.json"],
  ["module-operation-public.json", "flows/setup/public-evidence.json"],
  ["fiscal-readiness.json", "flows/setup/readiness.json"],
  ["setup-operation.json", "flows/setup/operation.json"],
  ["first-fiscal-documents", "flows/setup/documents"],
  ["configuration-import.json", "flows/setup/import/marker.json"],
  ["configuration-import.artifact", "flows/setup/import/artifact"],
  ["configuration-import.key", "flows/setup/import/key"],
  ["first-setup-start-again-guesses.json", "flows/setup/start-again-guesses.json"],
]);
const helpers = new Set([
  "apps/server/test/start-again-deleted.ts",
  "apps/server/test/start-again-held-fixture.ts",
  "apps/server/test/stop-route-server.ts",
  "packages/provisioning/test/start-again-attempt.ts",
  "packages/provisioning/test/recovery-document-file.ts",
  "scripts/waitron-sh.test.mjs",
]);
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => /^(apps|packages)\/.*\.test\.ts$/.test(file) || helpers.has(file));

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const changed = source.replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*?\1/g, (literal) => {
    for (const [oldPath, newPath] of paths) {
      const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      literal = literal.replace(new RegExp(`(["'\x60/])${escaped}(?=["'\x60/])`, "g"), `$1${newPath}`);
    }
    return literal;
  });
  if (source !== changed) {
    writeFileSync(file, changed);
    process.stdout.write(`${file}\n`);
  }
}
