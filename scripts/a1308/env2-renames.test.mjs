import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";

it("merges the named inputs once while preserving longer names, binary files and historical text", async () => {
  const originalCwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "env2-renames-"));
  for (const key of Object.keys(process.env))
    if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  const input = [
    "WAITRON_SERVER_URL",
    "WAITRON_SETUP_URL",
    "WAITRON_SH_HEALTH_DELAY",
    "WAITRON_SH_MAX_HEALTH_TRIES",
    "WAITRON_BOX_READ_SECONDS",
    "WAITRON_REQUIRE_STREAM_BINARIES",
    "WAITRON_REQUIRE_FULL_DISK",
    "WAITRON_PREPROD_PFX_BASE64",
    "WAITRON_PREPROD_PFX_PASSPHRASE",
    "WAITRON_PREPROD_NIF",
    "WAITRON_PREPROD_NOMBRE",
    "LITESTREAM_BIN",
    "XWAITRON_SERVER_URL WAITRON_SERVER_URL_EXTRA WAITRON_PRINT_AGENT_SERVER_URL",
  ].join("\n");
  const expected = [
    "WAITRON_PRINT_AGENT_SERVER_URL",
    "WAITRON_PRINT_AGENT_SETUP_URL",
    "WAITRON_TEST_HEALTH_DELAY",
    "WAITRON_TEST_HEALTH_TRIES",
    "WAITRON_TEST_READ_SECONDS",
    "WAITRON_REQUIRE_TEST_TOOLS",
    "WAITRON_REQUIRE_TEST_TOOLS",
    "WAITRON_CERT_CHECK_PFX_BASE64",
    "WAITRON_CERT_CHECK_PASSPHRASE",
    "WAITRON_CERT_CHECK_NIF",
    "WAITRON_CERT_CHECK_LEGAL_NAME",
    "LITESTREAM_BIN",
    "XWAITRON_SERVER_URL WAITRON_SERVER_URL_EXTRA WAITRON_PRINT_AGENT_SERVER_URL",
  ].join("\n");
  const protectedFiles = [
    "docs/superpowers/plan.md",
    "scripts/a1308/another-rename.mjs",
    "docs/developers/testing-guide.md",
    "docs/developers/conventions-data.md",
    "docs/developers/aws-backup-rehearsal.md",
  ];
  const write = (path, bytes) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  };
  try {
    execFileSync("git", ["init", "-q", root]);
    write("apps/config.ts", input);
    write("bench/config.mjs", input);
    write("unchanged.txt", "no retired names");
    write("binary.dat", Buffer.from("WAITRON_SERVER_URL\0"));
    for (const path of protectedFiles) write(path, input);
    symlinkSync("apps", join(root, "directory-link"));
    execFileSync("git", ["-C", root, "add", "."]);
    process.chdir(root);
    await import("./env2-renames.mjs");
    expect(readFileSync("apps/config.ts", "utf8")).toBe(expected);
    expect(readFileSync("bench/config.mjs", "utf8")).toBe(
      expected.replace("\nLITESTREAM_BIN\n", "\nWAITRON_LITESTREAM_BIN\n"),
    );
    for (const path of protectedFiles) expect(readFileSync(path, "utf8")).toBe(input);
    expect(readFileSync("binary.dat")).toEqual(Buffer.from("WAITRON_SERVER_URL\0"));
    expect(readFileSync("unchanged.txt", "utf8")).toBe("no retired names");
    execFileSync("git", ["add", "."]);
    vi.resetModules();
    await import("./env2-renames.mjs");
    expect(execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" })).toBe("");
  } finally {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(root, { recursive: true, force: true });
  }
});
