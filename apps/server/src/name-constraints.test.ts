import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { mintSelfSignedServerCert, reissueServerLeaf } from "./self-signed-cert.js";
import { certChain, fixtureBoxKeys } from "./testing/box-tls.js";

it("keeps an intermediate signing key distinct from the downloaded root", () => {
  const material = mintSelfSignedServerCert({
    hostnames: ["waitron.local"],
    ipAddresses: ["192.168.1.50"],
    now: new Date("2026-11-26T00:00:00Z"),
  });
  const root = forge.pki.certificateFromPem(material.caCertPem);
  const [signerBlock, keyBlock] = forge.pem.decode(material.caKeyPem);
  expect(signerBlock?.type).toBe("CERTIFICATE");
  expect(keyBlock?.type).toBe("RSA PRIVATE KEY");
  const signer = forge.pki.certificateFromPem(forge.pem.encode(signerBlock!));
  const key = forge.pki.privateKeyFromPem(forge.pem.encode(keyBlock!));
  const rootKey = root.publicKey as forge.pki.rsa.PublicKey;
  const signerKey = signer.publicKey as forge.pki.rsa.PublicKey;
  expect(key.n.equals(rootKey.n)).toBe(false);
  expect(key.n.equals(signerKey.n)).toBe(true);
  expect(root.verify(signer)).toBe(true);
  expect(forge.pem.decode(material.caCertPem)).toHaveLength(1);
  expect(forge.pem.decode(material.serverCertPem).map((block) => block.body)).toEqual([
    expect.any(String),
    signerBlock!.body,
  ]);
});

describe.runIf(spawnSync("openssl", ["version"]).status === 0)(
  "box signer name constraints",
  () => {
    it("accepts box names and private IPs and refuses names and IPs outside the permitted subtrees", () => {
      const now = new Date();
      const keys = fixtureBoxKeys();
      const rootKeys = keys();
      const signerKeys = keys();
      const leafKeys = keys();
      const mintKeys = [rootKeys, signerKeys, leafKeys].values();
      const material = mintSelfSignedServerCert({
        hostnames: ["waitron.local"],
        ipAddresses: ["192.168.1.50"],
        now,
        keypair: () => mintKeys.next().value!,
      });
      const [signerPem] = certChain(material.caKeyPem);
      const control = forge.pki.certificateFromPem(signerPem!);
      control.setExtensions(control.extensions.filter((entry) => entry.id !== "2.5.29.30"));
      control.sign(rootKeys.privateKey, forge.md.sha256.create());

      const dir = mkdtempSync(join(tmpdir(), "waitron-nc-"));
      const verify = (leaf: string, intermediate: string, flag: string, name: string) => {
        writeFileSync(join(dir, "leaf.pem"), leaf);
        writeFileSync(join(dir, "intermediate.pem"), intermediate);
        return spawnSync(
          "openssl",
          [
            "verify",
            "-purpose",
            "sslserver",
            "-CAfile",
            "ca.pem",
            "-untrusted",
            "intermediate.pem",
            flag,
            name,
            "leaf.pem",
          ],
          { cwd: dir, encoding: "utf8" },
        );
      };
      try {
        writeFileSync(join(dir, "ca.pem"), material.caCertPem);
        const [allowedLeaf] = certChain(material.serverCertPem);
        expect(verify(allowedLeaf!, signerPem!, "-verify_hostname", "waitron.local").status).toBe(
          0,
        );
        expect(verify(allowedLeaf!, signerPem!, "-verify_ip", "192.168.1.50").status).toBe(0);
        for (const [input, flag, name] of [
          [{ hostnames: ["outside.test"], ipAddresses: [] }, "-verify_hostname", "outside.test"],
          [
            { hostnames: ["waitron.local"], ipAddresses: ["192.0.2.15"] },
            "-verify_ip",
            "192.0.2.15",
          ],
        ] as const) {
          const leaf = reissueServerLeaf({
            ...material,
            now,
            keypair: () => leafKeys,
            hostnames: [...input.hostnames],
            ipAddresses: [...input.ipAddresses],
          });
          const [leafPem] = certChain(leaf.serverCertPem);
          const refused = verify(leafPem!, signerPem!, flag, name);
          expect(refused.status).not.toBe(0);
          expect(refused.stderr).toMatch(/permitted subtree/i);
          expect(verify(leafPem!, forge.pki.certificateToPem(control), flag, name).status).toBe(0);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);
