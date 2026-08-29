import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readCertExpiry } from "./cert-expiry.js";
import { FIXTURE_CERT_NOT_AFTER, FIXTURE_CERT_PEM } from "./testing/tls-fixture.js";

describe("readCertExpiry", () => {
  // The fixture leaf's notAfter is 2036-08-26T13:07:51.000Z; every case dates `now` relative to it.
  let certPath: string;
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "cert-expiry-"));
    certPath = join(dir, "server.crt");
    writeFileSync(certPath, FIXTURE_CERT_PEM);
  });

  it("reports notAfter and whole days remaining against a fixed now", async () => {
    const now = new Date("2036-07-27T13:07:51.000Z"); // exactly 30 days before notAfter
    const result = await readCertExpiry(certPath, now);
    expect(result.notAfter).toBe(FIXTURE_CERT_NOT_AFTER);
    expect(result.daysRemaining).toBe(30);
  });

  it("floors a fractional remaining day (1.5 days → 1)", async () => {
    // 2036-08-25T01:07:51Z is 1.5 days before the fixture notAfter.
    const c = await readCertExpiry(certPath, new Date("2036-08-25T01:07:51.000Z"));
    expect(c.daysRemaining).toBe(1);
  });

  it("floors sub-day remaining to 0 (~12h left)", async () => {
    const c = await readCertExpiry(certPath, new Date("2036-08-26T01:07:51.000Z"));
    expect(c.daysRemaining).toBe(0);
  });

  it("returns a negative daysRemaining for an already-expired leaf", async () => {
    // 2h after notAfter → -0.083 day → floor -1.
    const c = await readCertExpiry(certPath, new Date("2036-08-26T15:07:51.000Z"));
    expect(c.daysRemaining).toBe(-1);
  });

  it("throws for a missing file", async () => {
    await expect(
      readCertExpiry(join(tmpdir(), "nope-does-not-exist.crt"), new Date()),
    ).rejects.toThrow();
  });
});
