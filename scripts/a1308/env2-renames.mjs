import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";

// These mix current instructions with dated receipts; edit the current instructions explicitly.
const historicalReceipts = new Set([
  "docs/developers/testing-guide.md",
  "docs/developers/conventions-data.md",
  "docs/developers/aws-backup-rehearsal.md",
]);
const renames = [
  ["WAITRON_SERVER_URL", "WAITRON_PRINT_AGENT_SERVER_URL"],
  ["WAITRON_SETUP_URL", "WAITRON_PRINT_AGENT_SETUP_URL"],
  ["WAITRON_SH_HEALTH_DELAY", "WAITRON_TEST_HEALTH_DELAY"],
  ["WAITRON_SH_MAX_HEALTH_TRIES", "WAITRON_TEST_HEALTH_TRIES"],
  ["WAITRON_BOX_READ_SECONDS", "WAITRON_TEST_READ_SECONDS"],
  ["WAITRON_REQUIRE_STREAM_BINARIES", "WAITRON_REQUIRE_TEST_TOOLS"],
  ["WAITRON_REQUIRE_FULL_DISK", "WAITRON_REQUIRE_TEST_TOOLS"],
  ["WAITRON_PREPROD_PFX_BASE64", "WAITRON_CERT_CHECK_PFX_BASE64"],
  ["WAITRON_PREPROD_PFX_PASSPHRASE", "WAITRON_CERT_CHECK_PASSPHRASE"],
  ["WAITRON_PREPROD_NIF", "WAITRON_CERT_CHECK_NIF"],
  ["WAITRON_PREPROD_NOMBRE", "WAITRON_CERT_CHECK_LEGAL_NAME"],
];

for (const path of execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)) {
  if (
    path.startsWith("docs/superpowers/") ||
    path.startsWith("scripts/a1308/") ||
    historicalReceipts.has(path) ||
    !statSync(path).isFile()
  )
    continue;
  const bytes = readFileSync(path);
  if (bytes.includes(0)) continue;
  const before = bytes.toString("utf8");
  let after = before;
  const pairs = path.startsWith("bench/")
    ? [...renames, ["LITESTREAM_BIN", "WAITRON_LITESTREAM_BIN"]]
    : renames;
  for (const [oldName, newName] of pairs)
    after = after.replace(new RegExp(`(?<![A-Z0-9_])${oldName}(?![A-Z0-9_])`, "g"), newName);
  if (before !== after) {
    writeFileSync(path, after);
    console.log(path);
  }
}
