import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const VITEST = join(
  dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);

function runHarness(legalName: string | undefined) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("WAITRON_CERT_CHECK_")) delete env[name];
  }
  Object.assign(env, {
    WAITRON_CERT_CHECK_PFX_BASE64: "bm90LWEta2V5",
    WAITRON_CERT_CHECK_PASSPHRASE: "test-only",
    // This refusal happens before certificate parsing or the authority request.
    WAITRON_CERT_CHECK_KIND: "invalid-kind",
    WAITRON_CERT_CHECK_ENVIRONMENT: "preproduction",
    WAITRON_CERT_CHECK_NIF: "B12345678",
  });
  if (legalName !== undefined) env.WAITRON_CERT_CHECK_LEGAL_NAME = legalName;
  return spawnSync(
    process.execPath,
    [
      VITEST,
      "run",
      "--config",
      "vitest.preprod.config.ts",
      "--reporter=json",
      "src/aeat-certificate-check.preprod.test.ts",
    ],
    { cwd: join(import.meta.dirname, ".."), env, encoding: "utf8", timeout: 30_000 },
  );
}

describe("the operator certificate-check harness", () => {
  it("uses the English legal-name setting to enable the check", () => {
    const result = runHarness("Example Company");
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout) as { numFailedTests: number };
    expect(report.numFailedTests).toBe(1);
    expect(result.stdout).toContain(
      "WAITRON_CERT_CHECK_KIND must be sello or representante, not invalid-kind",
    );
  });

  it.each([undefined, ""])("skips with the legal name set to %j", (legalName) => {
    const result = runHarness(legalName);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as {
      numPassedTests: number;
      numPendingTests: number;
    };
    expect(report.numPassedTests).toBe(0);
    expect(report.numPendingTests).toBe(1);
  });
});
