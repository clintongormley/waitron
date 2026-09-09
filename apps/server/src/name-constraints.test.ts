import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

/**
 * Proves the CA's nameConstraints actually CONSTRAIN, by running openssl rather than reading the DER:
 * a control leaf for `example.com` signed by the same CA must be REFUSED, while a `waitron.local`
 * leaf is accepted. Mirrors the desktop spike (spec §6). Skips cleanly where openssl is absent.
 */
function haveOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(haveOpenssl())("CA name constraints (openssl proof)", () => {
  it("refuses a control leaf outside the permitted subtree, accepts a permitted one", () => {
    const m = mintSelfSignedServerCert({
      hostnames: ["waitron.local"],
      ipAddresses: ["192.168.1.50"],
      now: new Date("2026-09-09T00:00:00Z"),
    });
    // Forge a control leaf for example.com signed by the SAME CA key.
    const caKey = forge.pki.privateKeyFromPem(m.caKeyPem);
    const caCert = forge.pki.certificateFromPem(m.caCertPem);
    const leafKeys = forge.pki.rsa.generateKeyPair(2048);
    const control = forge.pki.createCertificate();
    control.publicKey = leafKeys.publicKey;
    control.serialNumber = "02";
    control.validity.notBefore = new Date("2026-09-08T00:00:00Z");
    control.validity.notAfter = new Date("2027-09-08T00:00:00Z");
    control.setSubject([{ name: "commonName", value: "example.com" }]);
    control.setIssuer(caCert.subject.attributes);
    control.setExtensions([
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [{ type: 2, value: "example.com" }] },
    ]);
    control.sign(caKey, forge.md.sha256.create());

    const dir = mkdtempSync(join(tmpdir(), "waitron-nc-"));
    try {
      writeFileSync(join(dir, "ca.pem"), m.caCertPem);
      writeFileSync(join(dir, "leaf-a.pem"), m.serverCertPem);
      writeFileSync(join(dir, "leaf-b.pem"), forge.pki.certificateToPem(control));
      // Leaf A (waitron.local) verifies.
      const okA = () =>
        execFileSync(
          "openssl",
          ["verify", "-CAfile", join(dir, "ca.pem"), join(dir, "leaf-a.pem")],
          {
            encoding: "utf8",
          },
        );
      expect(okA()).toMatch(/OK/);
      // Leaf B (example.com) is refused for a permitted-subtree violation.
      let failed = false;
      let msg = "";
      try {
        execFileSync(
          "openssl",
          ["verify", "-CAfile", join(dir, "ca.pem"), join(dir, "leaf-b.pem")],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      } catch (e) {
        failed = true;
        msg =
          String((e as { stdout?: string; stderr?: string }).stdout ?? "") +
          String((e as { stdout?: string; stderr?: string }).stderr ?? "");
      }
      expect(failed).toBe(true);
      expect(msg).toMatch(/permitted subtree/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
