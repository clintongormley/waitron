import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { openVenueDatabase, runMigrations } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { TRADING_ENV_FILE, VENUE_DIR_NAME } from "@waitron/store";
import { decryptArtifact, readArtifactHeader } from "./artifact-cipher.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { setupVenue } from "./testing/venue-fixtures.js";

it.each([
  ["capture", /Run this fixture with Node network permission denied/],
  ["restore", /ENOENT.*input\.backup\.enc/],
])("%s enforces its own fixture boundary", (command, error) => {
  const root = mkdtempSync(join(tmpdir(), "cloud-integration-backup-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/cloud-backup-fixture.ts"],
    {
      env: { ...process.env, CLOUD_TEST_ROOT: root },
      input: JSON.stringify({ command, recoveryKey: "A".repeat(43) }),
      encoding: "utf8",
      timeout: 20_000,
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(1);
  expect(child.stderr).toMatch(error);
});

it("capture writes the Cloud copy production makes: frame version 1 under Cloud's key", async () => {
  // Resolved, because the permission flag compares paths after macOS's `/var` link.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cloud-integration-backup-")));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const store = await openVenueDatabase(join(root, VENUE_DIR_NAME));
  try {
    for (const options of migrationOptionsFor(manifestSets(), null)) {
      await runMigrations(store.venue, options);
    }
    await setupVenue(store.venue);
  } finally {
    await store.close();
  }
  await mkdir(join(root, "tls"), { recursive: true });
  for (const rel of RECOVERY_FILES) await writeFile(join(root, rel), `dummy ${rel}`);
  await writeFile(
    join(root, TRADING_ENV_FILE),
    `WAITRON_NODE_ID=${randomUUID()}\nWAITRON_ENV=preproduction\n`,
  );
  const recoveryKey = randomBytes(32).toString("base64url");
  const child = spawnSync(
    process.execPath,
    [
      "--permission",
      "--allow-fs-read=*",
      `--allow-fs-write=${root}`,
      "--allow-worker",
      "--allow-child-process",
      "--allow-addons",
      "--import",
      "tsx",
      "scripts/cloud-backup-fixture.ts",
    ],
    {
      env: { ...process.env, CLOUD_TEST_ROOT: root, TSX_DISABLE_CACHE: "1" },
      input: JSON.stringify({ command: "capture", recoveryKey }),
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  expect(child.status, child.stderr).toBe(0);
  const bytes = await readFile(join(root, "captured.backup.enc"));
  expect(readArtifactHeader(bytes)).toEqual({ version: 1 });
  expect(() => decryptArtifact(bytes, recoveryKey)).not.toThrow();
}, 90_000);
