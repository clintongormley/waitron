import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCertExpiry } from "./cert-expiry.js";
import { FIXTURE_CERT_NOT_AFTER, FIXTURE_CERT_PEM } from "./testing/tls-fixture.js";

describe("readCertExpiry", () => {
  it("reports notAfter and whole days remaining against a fixed now", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cert-expiry-"));
    const path = join(dir, "server.crt");
    writeFileSync(path, FIXTURE_CERT_PEM);
    const now = new Date("2036-07-27T13:07:51.000Z"); // exactly 30 days before notAfter
    const result = await readCertExpiry(path, now);
    expect(result.notAfter).toBe(FIXTURE_CERT_NOT_AFTER);
    expect(result.daysRemaining).toBe(30);
  });

  it("throws for a missing file", async () => {
    await expect(
      readCertExpiry(join(tmpdir(), "nope-does-not-exist.crt"), new Date()),
    ).rejects.toThrow();
  });
});
