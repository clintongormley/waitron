import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCertExpiry } from "./cert-expiry.js";

// Fixture leaf: a self-signed cert generated once with
//   openssl req -x509 -newkey rsa:2048 -keyout /dev/null -nodes \
//     -subj "/CN=waitron.local" -days 3650 -out fixture.pem
// Its actual notAfter is 2036-08-26T13:07:51.000Z (read back via
// `new X509Certificate(pem).validTo`), so the assertions below are exact.
const FIXTURE_PEM = `-----BEGIN CERTIFICATE-----
MIIDETCCAfmgAwIBAgIUXR2PZXVKgwQiVrnQ/Qci32bg/LcwDQYJKoZIhvcNAQEL
BQAwGDEWMBQGA1UEAwwNd2FpdHJvbi5sb2NhbDAeFw0yNjA4MjkxMzA3NTFaFw0z
NjA4MjYxMzA3NTFaMBgxFjAUBgNVBAMMDXdhaXRyb24ubG9jYWwwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQDI1QDlkZGqlcL3VZRZMiE320bvvWt8d5EN
LeySMgeDUZ/0ouUJMpThEcI/3Qqi8jnLc8f60dwdV4cdpi10wRORX2HDXgGFoBjQ
+cGdwAGXhP/9/5dWmai6NFuIMbFkjIrALrgfEkHikfsQ5OqToPnAUNGBBVqAR199
6c2JlHKQX1jA8p89aNU8XSjtZkBUlWP5WiMmF2b7+nEU2df3ZplUtOtjZHHuVxL9
+XQDSirSjllwbYRaeP/JlK90BqzpE2rnLekH5Z+0/QuSxceF7acR2CxYmQMb2i9B
KqVok9LWUCHzVNdWpyv2lAzXOzaS4hhwT0YvMzV+peLerUtv0/RRAgMBAAGjUzBR
MB0GA1UdDgQWBBS+DcjQYlLbSYPFR5w4dgFNaV7vRDAfBgNVHSMEGDAWgBS+DcjQ
YlLbSYPFR5w4dgFNaV7vRDAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUA
A4IBAQBviWwjpi2O3e3t1/8vSfJmfEJlhr8L6ljQxVPqlxNj1wVdmUCP53oyNl4W
dI0YqK6LhuWLK79I0Ki983sPef7EsF+k3V342vfi0J2fELLB/yeSDmhusjd6nnOz
CoI7R2hGi/uJUazoyV7lENejq06xyy2ymz/7zUzHPqp+kBZ94ZWMQ4pPhwOYSmpt
9FXSgsgjr0mhhb2MyBZukfVKnO40Mc8cfHewNVI6zOgb8dtHBxaxsitwSTPPCBpJ
k3UErVZoW0l7rwcBONa2Bz8MBvsp2OZsrPiXN0IYqchpFQwANC7ONW6nnIaXL19I
gzRdhdm/TSERpovs914rORxWIQ+K
-----END CERTIFICATE-----
`;

describe("readCertExpiry", () => {
  it("reports notAfter and whole days remaining against a fixed now", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cert-expiry-"));
    const path = join(dir, "server.crt");
    writeFileSync(path, FIXTURE_PEM);
    const now = new Date("2036-07-27T13:07:51.000Z"); // exactly 30 days before notAfter
    const result = await readCertExpiry(path, now);
    expect(result.notAfter).toBe("2036-08-26T13:07:51.000Z");
    expect(result.daysRemaining).toBe(30);
  });

  it("throws for a missing file", async () => {
    await expect(
      readCertExpiry(join(tmpdir(), "nope-does-not-exist.crt"), new Date()),
    ).rejects.toThrow();
  });
});
